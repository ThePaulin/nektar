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

        // Only play audio if it's an audio or video track and not muted
        video.muted = track.isMuted || (track.type !== TrackType.AUDIO && track.type !== TrackType.VIDEO);

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

        if (clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO) {
          return (
            <video
              key={clip.id}
              ref={(el) => (videoRefs.current[clip.id] = el)}
              src={clip.videoUrl}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${isActive && clip.type === TrackType.VIDEO ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              style={{ zIndex }}
              playsInline
            />
          );
        }
        if (clip.type === TrackType.IMAGE) {
          return (
            <img
              key={clip.id}
              src={clip.thumbnailUrl}
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              style={{ zIndex }}
              referrerPolicy="no-referrer"
            />
          );
        }
        if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
          if (!isActive) return null;

          const posX = (clip.style?.position?.x || 0) * scaleFactor;
          const posY = (clip.style?.position?.y || 0) * scaleFactor;
          const baseFontSize = clip.style?.fontSize || 48;
          const scaledFontSize = baseFontSize * scaleFactor;

          return (
            <div
              key={clip.id}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                zIndex,
                transform: `
                  translate(${posX}px, ${posY}px)
                  scale(${clip.style?.scale || 1})
                  rotate(${clip.style?.rotation || 0}deg)
                `
              }}
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
