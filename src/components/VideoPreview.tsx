import React, { useRef, useEffect, useMemo, useState } from 'react';
import { VideoObjType, VideoClip, Track, TrackType } from '../types';

interface VideoPreviewProps {
  clips: VideoObjType;
  tracks: Track[];
  currentTime: number;
  isPlaying: boolean;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ clips, tracks, currentTime, isPlaying }) => {
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1280);

  // Reference width for scaling (matches export resolution)
  const REFERENCE_WIDTH = 1280;
  const scaleFactor = containerWidth / REFERENCE_WIDTH;

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
    );
  }, [clips, tracks, currentTime]);

  const getClipStyle = (clip: VideoClip, zIndex: number, isActive: boolean) => {
    const rawTransform = clip.transform || {
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: { x: 1, y: 1 },
      opacity: 1,
      crop: { top: 0, right: 0, bottom: 0, left: 0 }
    };
    const transform = {
      ...rawTransform,
      rotation: typeof rawTransform.rotation === 'number' 
        ? rawTransform.rotation 
        : (rawTransform.rotation as any)?.z || 0
    };
    const filters = clip.filters || { brightness: 1, saturation: 1, contrast: 1 };
    
    const posX = transform.position.x * scaleFactor;
    const posY = transform.position.y * scaleFactor;
    const posZ = transform.position.z; // Extra z-offset on top of track z-index

    const scaleX = transform.scale.x * (transform.flipHorizontal ? -1 : 1);
    const scaleY = transform.scale.y * (transform.flipVertical ? -1 : 1);

    return {
      zIndex: zIndex + posZ,
      opacity: isActive ? transform.opacity : 0,
      pointerEvents: isActive ? 'auto' : 'none' as any,
      filter: `brightness(${filters.brightness}) saturate(${filters.saturation}) contrast(${filters.contrast || 1})`,
      transform: `
        translate3d(${posX}px, ${posY}px, 0)
        rotateZ(${transform.rotation}deg)
        scale(${scaleX}, ${scaleY})
      `,
      clipPath: transform.crop ? `inset(${transform.crop.top}% ${transform.crop.right}% ${transform.crop.bottom}% ${transform.crop.left}%)` : undefined,
      transition: 'opacity 0.2s ease',
    };
  };

  useEffect(() => {
    clips.forEach((clip) => {
      const video = videoRefs.current[clip.id];
      if (!video) return;

      const isActive = activeClips.some(c => c.id === clip.id);
      const track = tracks.find(t => t.id === clip.trackId);

      if (isActive && track && !track.isLocked) {
        const localTime = (currentTime - clip.timelinePosition.start) + clip.sourceStart;

        if (Math.abs(video.currentTime - localTime) > 0.1) {
          video.currentTime = localTime;
        }

        // Only play audio if it's an audio, video, or screen track and not muted
        const isMuted = track.isMuted || (track.type !== TrackType.AUDIO && track.type !== TrackType.VIDEO && track.type !== TrackType.SCREEN);
        video.muted = isMuted;
        
        // Apply volume property
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
  }, [activeClips, currentTime, isPlaying, clips, tracks]);

  return (
    <div 
      ref={containerRef}
      className="relative aspect-video mx-auto h-full bg-black overflow-hidden shadow-2xl border border-white/5"
    >
      {/* Video/Audio/Image Pool */}
      {clips.map((clip) => {
        const trackIndex = tracks.findIndex(t => t.id === clip.trackId);
        const isActive = activeClips.some(c => c.id === clip.id);
        // Higher track index in the array means lower in the timeline UI.
        // We want the top-most track (index 0) to have the highest z-index.
        const zIndex = tracks.length - trackIndex;

        if (clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO || clip.type === TrackType.SCREEN) {
          const style = getClipStyle(clip, zIndex, isActive);
          return (
            <video
              key={clip.id}
              ref={(el) => (videoRefs.current[clip.id] = el)}
              src={clip.videoUrl}
              className="absolute inset-0 w-full h-full object-cover"
              style={style}
              playsInline
            />
          );
        }
        if (clip.type === TrackType.IMAGE) {
          const style = getClipStyle(clip, zIndex, isActive);
          return (
            <img
              key={clip.id}
              src={clip.thumbnailUrl}
              className="absolute inset-0 w-full h-full object-contain"
              style={style}
              referrerPolicy="no-referrer"
            />
          );
        }
        if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
          if (!isActive) return null;
          const style = getClipStyle(clip, zIndex, isActive);
          const baseFontSize = clip.style?.fontSize || 48;
          const scaledFontSize = baseFontSize * scaleFactor;

          return (
            <div
              key={clip.id}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={style}
            >
              <div
                className={`px-4 py-2 rounded text-center ${clip.type === TrackType.SUBTITLE ? 'bg-black/60' : ''}`}
                style={{
                  fontSize: `${scaledFontSize}px`,
                  fontWeight: clip.style?.fontWeight || 'normal',
                  fontStyle: clip.style?.fontStyle || 'normal',
                  fontStretch: clip.style?.fontStretch || 'normal',
                  lineHeight: clip.style?.lineHeight || 'normal',
                  fontFamily: clip.style?.fontFamily || 'sans-serif',
                  color: clip.style?.color || '#ffffff',
                  backgroundColor: clip.style?.backgroundColor || 'transparent',
                  padding: `${8 * scaleFactor}px ${16 * scaleFactor}px`,
                  borderRadius: `${4 * scaleFactor}px`,
                  marginBottom: clip.type === TrackType.SUBTITLE ? `${40 * scaleFactor}px` : undefined,
                }}
              >
                {clip.content}
              </div>
            </div>
          );
        }
        return null;
      })}

      {/* Empty State */}
      {activeClips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-[100]">
          <p className="text-gray-600 text-sm font-medium">No active clips</p>
        </div>
      )}
    </div>
  );
};
