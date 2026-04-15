import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { VideoObjType, VideoClip, Track, TrackType, LUTData } from '../types';
import { WebGLLUT } from '../lib/webgl-lut';
import { WebGPURenderer } from '../lib/renderer-webgpu';

interface VideoPreviewProps {
  clips: VideoObjType;
  tracks: Track[];
  currentTime: number;
  isPlaying: boolean;
  showLutPreview?: boolean;
}

const PLAYBACK_WIDTH = 1280;
const PLAYBACK_HEIGHT = 720;
const BUFFER_WINDOW = 15; // Reduced from 30 to 15 to save memory/decoders

export const VideoPreview: React.FC<VideoPreviewProps> = ({ 
  clips, 
  tracks, 
  currentTime, 
  isPlaying, 
  showLutPreview = true 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});
  const imageRefs = useRef<{ [key: string]: HTMLImageElement | null }>({});
  const requestRef = useRef<number>(0);
  const webglLutRef = useRef<WebGLLUT | null>(null);
  const webgpuRendererRef = useRef<WebGPURenderer | null>(null);
  const [useWebGPU, setUseWebGPU] = useState(false);
  const [lutTextures, setLutTextures] = useState<{ [key: string]: any }>({});
  const [offscreenCanvas, setOffscreenCanvas] = useState<HTMLCanvasElement | null>(null);
  const lutProcessingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const lutDataMap = useMemo(() => {
    const map: { [key: string]: LUTData } = {};
    tracks.forEach(track => {
      if (track.lutConfig?.data) {
        map[track.id] = track.lutConfig.data;
      }
    });
    return map;
  }, [tracks]);

  // Initialize renderers
  useEffect(() => {
    const initRenderers = async () => {
      console.log("Initializing renderers, canvasRef:", !!canvasRef.current);
      
      // Always initialize offscreen canvas for fallback
      const offscreen = document.createElement('canvas');
      offscreen.width = PLAYBACK_WIDTH;
      offscreen.height = PLAYBACK_HEIGHT;
      setOffscreenCanvas(offscreen);

      if (canvasRef.current) {
        try {
          const renderer = new WebGPURenderer();
          const success = await renderer.init(canvasRef.current);
          console.log("WebGPU initialization success:", success);
          if (success) {
            webgpuRendererRef.current = renderer;
            setUseWebGPU(true);
            console.log("WebGPU Preview Renderer initialized");
          } else {
            // Fallback to WebGL for LUTs
            const lutCanvas = document.createElement('canvas');
            lutCanvas.width = PLAYBACK_WIDTH;
            lutCanvas.height = PLAYBACK_HEIGHT;
            lutProcessingCanvasRef.current = lutCanvas;
            webglLutRef.current = new WebGLLUT(lutCanvas);
            console.log("WebGL LUT Fallback initialized");
          }
        } catch (e) {
          console.error("Renderer initialization error:", e);
        }
      }
    };
    initRenderers();
  }, []);

  // Update LUT textures when LUT data changes
  useEffect(() => {
    if (useWebGPU && webgpuRendererRef.current) {
      const newTextures: { [key: string]: any } = {};
      Object.entries(lutDataMap).forEach(([trackId, data]) => {
        const texture = webgpuRendererRef.current!.createLutTexture(data);
        if (texture) newTextures[trackId] = texture;
      });
      setLutTextures(newTextures);
    }
  }, [lutDataMap, useWebGPU]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !canvasRef.current) return;
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const containerAspect = container.clientWidth / container.clientHeight;
      const videoAspect = PLAYBACK_WIDTH / PLAYBACK_HEIGHT;

      if (containerAspect > videoAspect) {
        canvas.style.height = '100%';
        canvas.style.width = 'auto';
      } else {
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Get active clips for each visible track
  const activeClips = useMemo(() => {
    const visibleTrackIds = tracks.filter(t => t.isVisible).map(t => t.id);
    return clips.filter(clip =>
      visibleTrackIds.includes(clip.trackId) &&
      currentTime >= clip.timelinePosition.start &&
      currentTime <= clip.timelinePosition.end
    ).sort((a, b) => {
      const indexA = tracks.findIndex(t => t.id === a.trackId);
      const indexB = tracks.findIndex(t => t.id === b.trackId);
      return indexB - indexA; // Bottom tracks first for canvas drawing
    });
  }, [clips, tracks, currentTime]);

  // Main rendering loop
  const render = useCallback((force = false) => {
    if (useWebGPU && webgpuRendererRef.current) {
      try {
        webgpuRendererRef.current.render(
          activeClips,
          tracks,
          videoRefs.current,
          imageRefs.current,
          lutTextures,
          showLutPreview
        );
      } catch (e) {
        console.error("WebGPU render error:", e);
        setUseWebGPU(false); // Fallback to Canvas2D
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !offscreenCanvas) {
      if (isPlaying) console.log("Missing canvas or offscreenCanvas", !!canvas, !!offscreenCanvas);
      return;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    const oCtx = offscreenCanvas.getContext('2d', { alpha: false });
    if (!ctx || !oCtx) return;

    if (offscreenCanvas.width !== PLAYBACK_WIDTH) {
      offscreenCanvas.width = PLAYBACK_WIDTH;
      offscreenCanvas.height = PLAYBACK_HEIGHT;
    }

    // Draw to offscreen buffer first
    oCtx.fillStyle = '#000000';
    oCtx.fillRect(0, 0, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);

    let allVideosReady = true;

    // Draw active clips to offscreen
    activeClips.forEach((clip) => {
      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || !track.isVisible) return;

      const transform = {
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
        scale: { x: 1, y: 1 },
        opacity: 1,
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        ...(clip.transform || {})
      };
      
      const rotation = typeof transform.rotation === 'number' 
        ? transform.rotation 
        : (transform.rotation as any)?.z || 0;

      oCtx.save();
      oCtx.translate(PLAYBACK_WIDTH / 2 + (transform.position.x || 0), PLAYBACK_HEIGHT / 2 + (transform.position.y || 0));
      oCtx.rotate((rotation * Math.PI) / 180);
      oCtx.scale(
        (transform.scale?.x || 1) * (transform.flipHorizontal ? -1 : 1),
        (transform.scale?.y || 1) * (transform.flipVertical ? -1 : 1)
      );
      oCtx.globalAlpha = transform.opacity ?? 1;

      if (clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) {
        const video = videoRefs.current[clip.id];
        const hasError = !!video?.error;
        
        const isReady = video && (video.readyState >= 1 || hasError) && (video.videoWidth > 0 || hasError);
        const isPerfectlyReady = video && video.readyState >= 2;
        
        if (isReady && !hasError) {
          const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };
          const sx = (crop.left / 100) * video.videoWidth;
          const sy = (crop.top / 100) * video.videoHeight;
          const sw = video.videoWidth * (1 - (crop.left + crop.right) / 100);
          const sh = video.videoHeight * (1 - (crop.top + crop.bottom) / 100);

          const parentTrack = track.parentId ? tracks.find(t => t.id === track.parentId) : null;
          const effectiveTrack = parentTrack || track;
          const lutData = lutDataMap[effectiveTrack.id];
          
          if (showLutPreview && effectiveTrack.lutConfig?.enabled && lutData && webglLutRef.current) {
            const isCameraSubTrack = track.isSubTrack && track.subTrackType === 'camera';
            const isStandardVideo = !track.isSubTrack && track.type === TrackType.VIDEO;
            
            if (isCameraSubTrack || isStandardVideo) {
              const isScreen = clip.type === TrackType.SCREEN;
              const hasOverlay = !!clip.overlayRect;
              
              let shouldApply = true;
              let useRect = false;
              
              if (isScreen) {
                if (hasOverlay) {
                  useRect = true;
                } else {
                  shouldApply = false;
                }
              }

              if (shouldApply) {
                webglLutRef.current.apply(
                  video,
                  lutData,
                  effectiveTrack.lutConfig.intensity,
                  useRect ? clip.overlayRect : undefined,
                  video.videoWidth,
                  video.videoHeight,
                  transform.crop
                );
                oCtx.drawImage(lutProcessingCanvasRef.current!, -PLAYBACK_WIDTH/2, -PLAYBACK_HEIGHT/2, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);
              } else {
                oCtx.drawImage(video, sx, sy, sw, sh, -PLAYBACK_WIDTH/2, -PLAYBACK_HEIGHT/2, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);
              }
            } else {
              oCtx.drawImage(video, sx, sy, sw, sh, -PLAYBACK_WIDTH/2, -PLAYBACK_HEIGHT/2, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);
            }
          } else {
            oCtx.drawImage(video, sx, sy, sw, sh, -PLAYBACK_WIDTH/2, -PLAYBACK_HEIGHT/2, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);
          }
        }
        
        if (!hasError && !isPerfectlyReady) {
          allVideosReady = false;
        }
      } else if (clip.type === TrackType.IMAGE) {
        const img = imageRefs.current[clip.id];
        if (img && img.complete) {
          const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };
          const sx = (crop.left / 100) * img.width;
          const sy = (crop.top / 100) * img.height;
          const sw = img.width * (1 - (crop.left + crop.right) / 100);
          const sh = img.height * (1 - (crop.top + crop.bottom) / 100);
          oCtx.drawImage(img, sx, sy, sw, sh, -PLAYBACK_WIDTH/2, -PLAYBACK_HEIGHT/2, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);
        }
      } else if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
        const baseFontSize = clip.style?.fontSize || 48;
        const playbackFontSize = baseFontSize * (PLAYBACK_WIDTH / 1280);
        
        oCtx.font = `${clip.style?.fontWeight || 'normal'} ${playbackFontSize}px ${clip.style?.fontFamily || 'sans-serif'}`;
        oCtx.fillStyle = clip.style?.color || '#ffffff';
        oCtx.textAlign = 'center';
        oCtx.textBaseline = 'middle';

        if (clip.type === TrackType.SUBTITLE || (clip.style?.backgroundColor && clip.style.backgroundColor !== 'transparent')) {
          const textWidth = oCtx.measureText(clip.content || '').width;
          oCtx.fillStyle = clip.style?.backgroundColor || 'rgba(0,0,0,0.6)';
          const paddingX = 16 * (PLAYBACK_WIDTH / 1280);
          const paddingY = 8 * (PLAYBACK_WIDTH / 1280);
          
          oCtx.fillRect(-textWidth/2 - paddingX, -playbackFontSize/2 - paddingY, textWidth + paddingX*2, playbackFontSize + paddingY*2);
          oCtx.fillStyle = clip.style?.color || '#ffffff';
        }
        
        const offsetY = clip.type === TrackType.SUBTITLE ? (720/2 - 80) * (PLAYBACK_HEIGHT/720) : 0;
        oCtx.fillText(clip.content || '', 0, offsetY);
      }

      oCtx.restore();
    });

    if (isPlaying || allVideosReady || force || activeClips.length > 0) {
      ctx.drawImage(offscreenCanvas, 0, 0);
    }
  }, [activeClips, tracks, isPlaying, offscreenCanvas, lutDataMap, showLutPreview, useWebGPU, lutTextures]);

  // Force a render when any video element is ready
  const handleVideoReady = useCallback(() => {
    if (!isPlaying) {
      render(true);
    }
  }, [isPlaying, render]);

  // Sync video elements time and playback state
  useEffect(() => {
    clips.forEach((clip) => {
      if (clip.type !== TrackType.VIDEO && clip.type !== TrackType.AUDIO && clip.type !== TrackType.SCREEN) return;
      
      const video = videoRefs.current[clip.id];
      if (!video) return;

      const isActive = activeClips.some(c => c.id === clip.id);
      const track = tracks.find(t => t.id === clip.trackId);

      if (isActive && track) {
        const localTime = (currentTime - clip.timelinePosition.start) + clip.sourceStart;
        const threshold = isPlaying ? 0.2 : 0.03; // Slightly looser threshold during playback
        if (Math.abs(video.currentTime - localTime) > threshold) {
          video.currentTime = localTime;
        }

        const isMuted = track.isMuted || (track.type !== TrackType.AUDIO && track.type !== TrackType.VIDEO && track.type !== TrackType.SCREEN);
        video.muted = isMuted;
        
        if (!isMuted) {
          video.volume = clip.volume !== undefined ? clip.volume : 1;
        }

        if (isPlaying && video.paused) {
          video.play().catch((e) => console.warn("Playback error:", e));
        } else if (!isPlaying && !video.paused) {
          video.pause();
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
      }
    });

    if (!isPlaying) {
      render(true);
    }
  }, [activeClips, currentTime, isPlaying, clips, tracks, render]);

  const renderRef = useRef(render);
  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      renderRef.current();
      if (isPlaying) {
        requestRef.current = requestAnimationFrame(loop);
      }
    };
    
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(loop);
    }

    return () => {
      active = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying]);

  const pooledClips = useMemo(() => {
    return clips.filter(clip => 
      currentTime >= clip.timelinePosition.start - BUFFER_WINDOW &&
      currentTime <= clip.timelinePosition.end + BUFFER_WINDOW
    );
  }, [clips, currentTime]);

  return (
    <div 
      ref={containerRef}
      className="relative aspect-video mx-auto h-full bg-black overflow-hidden shadow-2xl border border-white/5"
    >
      <canvas
        ref={canvasRef}
        width={PLAYBACK_WIDTH}
        height={PLAYBACK_HEIGHT}
        className="w-full h-full object-contain"
      />

      <div className="absolute top-3 right-3 z-[110] pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-2 py-1 rounded flex items-center space-x-1.5">
          <div className={`w-1.5 h-1.5 ${useWebGPU ? 'bg-emerald-500' : 'bg-amber-500'} rounded-full animate-pulse`} />
          <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">
            {useWebGPU ? 'WebGPU' : 'Canvas2D'} {PLAYBACK_HEIGHT}p
          </span>
        </div>
      </div>

      <div className="invisible absolute pointer-events-none overflow-hidden w-0 h-0">
        {pooledClips.map((clip) => {
          if (clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO || clip.type === TrackType.SCREEN) {
            return (
              <video
                key={clip.id}
                ref={(el) => (videoRefs.current[clip.id] = el)}
                src={clip.videoUrl}
                playsInline
                crossOrigin="anonymous"
                onSeeked={handleVideoReady}
                onLoadedData={handleVideoReady}
                onLoadedMetadata={handleVideoReady}
                onCanPlay={handleVideoReady}
                onCanPlayThrough={handleVideoReady}
                onPlaying={handleVideoReady}
                onWaiting={handleVideoReady}
              />
            );
          }
          if (clip.type === TrackType.IMAGE) {
            return (
              <img
                key={clip.id}
                ref={(el) => (imageRefs.current[clip.id] = el)}
                src={clip.thumbnailUrl}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
              />
            );
          }
          return null;
        })}
      </div>

      {activeClips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-[100]">
          <p className="text-gray-600 text-sm font-medium">No active clips</p>
        </div>
      )}
    </div>
  );
};
