import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { VideoObjType, VideoClip, Track, TrackType } from '../types';
import { parseCubeLUT, createHaldLUTCanvas } from '../lib/lut';
import { WebGLLUT } from '../lib/webgl-lut';

interface VideoPreviewProps {
  clips: VideoObjType;
  tracks: Track[];
  currentTime: number;
  isPlaying: boolean;
  showLutPreview?: boolean;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ clips, tracks, currentTime, isPlaying, showLutPreview = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});
  const imageRefs = useRef<{ [key: number]: HTMLImageElement | null }>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1280);
  const requestRef = useRef<number>();
  const [lutDataMap, setLutDataMap] = useState<{ [key: string]: { url: string, size: number, data: Float32Array } }>({});
  const webglLutRef = useRef<WebGLLUT | null>(null);
  const lutProcessingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load LUTs
  useEffect(() => {
    const loadLuts = async () => {
      const tracksWithLut = tracks.filter(t => t.lutConfig?.enabled && t.lutConfig.url);
      const newLutDataMap: { [key: string]: { url: string, size: number, data: Float32Array } } = {};
      
      await Promise.all(tracksWithLut.map(async (track) => {
        const url = track.lutConfig!.url!;
        if (lutDataMap[track.id]?.url === url) {
          newLutDataMap[track.id] = lutDataMap[track.id];
          return;
        }
        try {
          const response = await fetch(url);
          const cubeString = await response.text();
          const lutData = parseCubeLUT(cubeString);
          newLutDataMap[track.id] = { url, size: lutData.size, data: lutData.data };
        } catch (e) {
          console.warn(`[Preview] Failed to load LUT for track ${track.id}:`, e);
        }
      }));
      
      setLutDataMap(newLutDataMap);
    };
    loadLuts();
  }, [tracks]);

  // Initialize WebGL LUT processor
  useEffect(() => {
    if (!lutProcessingCanvasRef.current) {
      lutProcessingCanvasRef.current = document.createElement('canvas');
      lutProcessingCanvasRef.current.width = 854;
      lutProcessingCanvasRef.current.height = 480;
    }
    if (!webglLutRef.current && lutProcessingCanvasRef.current) {
      webglLutRef.current = new WebGLLUT(lutProcessingCanvasRef.current);
    }
  }, []);

  // Offscreen buffer for flicker-free rendering
  const offscreenCanvas = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 854; // PLAYBACK_WIDTH
    canvas.height = 480; // PLAYBACK_HEIGHT
    return canvas;
  }, []);

  // Playback resolution (optimized for performance)
  const PLAYBACK_WIDTH = 854;
  const PLAYBACK_HEIGHT = 480;
  
  // Reference width for scaling (matches export resolution)
  const REFERENCE_WIDTH = 1280;
  const REFERENCE_HEIGHT = 720;
  const scaleFactor = containerWidth / REFERENCE_WIDTH;

  // Windowed media pool: only load clips near the playhead to save memory/CPU
  const BUFFER_WINDOW = 30; // 30 seconds
  const pooledClips = useMemo(() => {
    return clips.filter(clip => 
      currentTime >= clip.timelinePosition.start - BUFFER_WINDOW &&
      currentTime <= clip.timelinePosition.end + BUFFER_WINDOW
    );
  }, [clips, currentTime]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
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
    const canvas = canvasRef.current;
    if (!canvas || !offscreenCanvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    const oCtx = offscreenCanvas.getContext('2d', { alpha: false });
    if (!ctx || !oCtx) return;

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

      const filters = clip.filters || { brightness: 1, saturation: 1, contrast: 1 };

      oCtx.save();
      oCtx.globalAlpha = transform.opacity;

      if (filters.brightness !== 1 || filters.saturation !== 1 || (filters.contrast !== undefined && filters.contrast !== 1)) {
        oCtx.filter = `brightness(${filters.brightness}) saturate(${filters.saturation}) contrast(${filters.contrast || 1})`;
      }

      const scaleX_res = PLAYBACK_WIDTH / REFERENCE_WIDTH;
      const scaleY_res = PLAYBACK_HEIGHT / REFERENCE_HEIGHT;

      oCtx.translate(
        (transform.position.x * scaleX_res) + (PLAYBACK_WIDTH / 2),
        (transform.position.y * scaleY_res) + (PLAYBACK_HEIGHT / 2)
      );
      
      oCtx.rotate(rotation * Math.PI / 180);
      oCtx.scale(
        transform.scale.x * (transform.flipHorizontal ? -1 : 1),
        transform.scale.y * (transform.flipVertical ? -1 : 1)
      );

      if (clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) {
        const video = videoRefs.current[clip.id];
        // Lower readyState requirement when paused to show frames while seeking
        const isReady = video && (isPlaying ? video.readyState >= 2 : video.readyState >= 1 && video.videoWidth > 0);
        
        if (isReady) {
          const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };
          const sx = (crop.left / 100) * video.videoWidth;
          const sy = (crop.top / 100) * video.videoHeight;
          const sw = video.videoWidth * (1 - (crop.left + crop.right) / 100);
          const sh = video.videoHeight * (1 - (crop.top + crop.bottom) / 100);

          const parentTrack = track.parentId ? tracks.find(t => t.id === track.parentId) : null;
          const effectiveTrack = parentTrack || track;
          const lutData = lutDataMap[effectiveTrack.id];
          
          if (showLutPreview && effectiveTrack.lutConfig?.enabled && lutData && webglLutRef.current) {
            // Apply LUT using WebGL
            const isCameraSubTrack = track.isSubTrack && track.subTrackType === 'camera';
            const isStandardVideo = !track.isSubTrack && track.type === TrackType.VIDEO;
            
            // Only apply LUT to camera sub-track or standard video tracks
            if (isCameraSubTrack || isStandardVideo) {
              const isScreen = clip.type === TrackType.SCREEN;
              const hasOverlay = !!clip.overlayRect;
              
              let shouldApply = true;
              let useRect = false;
              
              if (isScreen) {
                if (hasOverlay) {
                  useRect = true;
                } else {
                  shouldApply = false; // Ignore screen recordings without overlay
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
              // Screen sub-track or other: no LUT
              oCtx.drawImage(video, sx, sy, sw, sh, -PLAYBACK_WIDTH/2, -PLAYBACK_HEIGHT/2, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);
            }
          } else {
            oCtx.drawImage(video, sx, sy, sw, sh, -PLAYBACK_WIDTH/2, -PLAYBACK_HEIGHT/2, PLAYBACK_WIDTH, PLAYBACK_HEIGHT);
          }
        } else if (clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) {
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
        const playbackFontSize = baseFontSize * (PLAYBACK_WIDTH / REFERENCE_WIDTH);
        
        oCtx.font = `${clip.style?.fontWeight || 'normal'} ${playbackFontSize}px ${clip.style?.fontFamily || 'sans-serif'}`;
        oCtx.fillStyle = clip.style?.color || '#ffffff';
        oCtx.textAlign = 'center';
        oCtx.textBaseline = 'middle';

        if (clip.type === TrackType.SUBTITLE || (clip.style?.backgroundColor && clip.style.backgroundColor !== 'transparent')) {
          const textWidth = oCtx.measureText(clip.content || '').width;
          oCtx.fillStyle = clip.style?.backgroundColor || 'rgba(0,0,0,0.6)';
          const paddingX = 16 * (PLAYBACK_WIDTH / REFERENCE_WIDTH);
          const paddingY = 8 * (PLAYBACK_WIDTH / REFERENCE_WIDTH);
          
          oCtx.fillRect(-textWidth/2 - paddingX, -playbackFontSize/2 - paddingY, textWidth + paddingX*2, playbackFontSize + paddingY*2);
          oCtx.fillStyle = clip.style?.color || '#ffffff';
        }
        
        const offsetY = clip.type === TrackType.SUBTITLE ? (REFERENCE_HEIGHT/2 - 80) * (PLAYBACK_HEIGHT/REFERENCE_HEIGHT) : 0;
        oCtx.fillText(clip.content || '', 0, offsetY);
      }

      oCtx.restore();
    });

    // Atomic update: only copy to main canvas if we're playing (best effort)
    // or if we're paused and all videos are ready (perfect frame)
    // or if forced (e.g. scrubbing)
    if (isPlaying || allVideosReady || force) {
      ctx.drawImage(offscreenCanvas, 0, 0);
    }
  }, [activeClips, tracks, isPlaying, offscreenCanvas, lutDataMap, showLutPreview]);

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

        // Use a larger drift threshold during playback to avoid redundant seeks
        const threshold = isPlaying ? 0.3 : 0.05;
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

    // If paused, trigger a render
    if (!isPlaying) {
      render(true);
    }
  }, [activeClips, currentTime, isPlaying, clips, tracks, render]);

  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      render();
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
  }, [isPlaying, render]);

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

      {/* Playback Quality Badge */}
      <div className="absolute top-3 right-3 z-[110] pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-2 py-1 rounded flex items-center space-x-1.5">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">480p Playback</span>
        </div>
      </div>

      {/* Hidden Media Pool (Windowed) */}
      <div className="hidden">
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

      {/* Empty State */}
      {activeClips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-[100]">
          <p className="text-gray-600 text-sm font-medium">No active clips</p>
        </div>
      )}
    </div>
  );
};
