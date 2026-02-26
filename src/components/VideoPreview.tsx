import React, { useRef, useEffect, useMemo } from 'react';
import { VideoObjType, VideoClip } from '../types';

interface VideoPreviewProps {
  clips: VideoObjType;
  currentTime: number;
  isPlaying: boolean;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ clips, currentTime, isPlaying }) => {
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});

  // Find the clip that is currently active at the playhead position
  const activeClip = useMemo(() => {
    return clips.find(
      (clip) => currentTime >= clip.timelinePosition.start && currentTime <= clip.timelinePosition.end
    );
  }, [clips, currentTime]);

  useEffect(() => {
    // Handle all video elements
    clips.forEach((clip) => {
      const video = videoRefs.current[clip.id];
      if (!video) return;

      const isActive = activeClip?.id === clip.id;

      if (isActive) {
        // Calculate local time within the clip, accounting for sourceStart
        const localTime = (currentTime - clip.timelinePosition.start) + clip.sourceStart;
        
        // Only sync if the difference is significant to avoid jitter
        if (Math.abs(video.currentTime - localTime) > 0.1) {
          video.currentTime = localTime;
        }

        // Handle playback state
        if (isPlaying && video.paused) {
          video.play().catch((e) => console.warn("Autoplay blocked or interrupted:", e));
        } else if (!isPlaying && !video.paused) {
          video.pause();
        }
      } else {
        // Pause and reset inactive videos
        if (!video.paused) {
          video.pause();
        }
      }
    });
  }, [activeClip, currentTime, isPlaying, clips]);

  return (
    <div className="relative w-full h-full bg-black rounded-xl overflow-hidden shadow-2xl border border-white/5">
      {/* Video Pool */}
      {clips.map((clip) => (
        <video
          key={clip.id}
          ref={(el) => (videoRefs.current[clip.id] = el)}
          src={clip.videoUrl}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${
            activeClip?.id === clip.id ? 'opacity-100 z-10' : 'opacity-0 z-0'
          }`}
          muted // Muted for easier browser autoplay compliance
          playsInline
        />
      ))}

      {/* Empty State / Gap in Timeline */}
      {!activeClip && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-20">
          <p className="text-gray-600 text-sm font-medium">No clip at this position</p>
        </div>
      )}
    </div>
  );
};
