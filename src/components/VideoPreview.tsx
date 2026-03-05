import React, { useRef, useEffect, useMemo } from 'react';
import { VideoObjType, VideoClip, Track, TrackType } from '../types';

interface VideoPreviewProps {
  clips: VideoObjType;
  tracks: Track[];
  currentTime: number;
  isPlaying: boolean;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ clips, tracks, currentTime, isPlaying }) => {
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});

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
    <div className="relative w-full h-full bg-black rounded-xl overflow-hidden shadow-2xl border border-white/5">
      {/* Video/Audio/Image Pool */}
      {clips.map((clip) => {
        const trackIndex = tracks.findIndex(t => t.id === clip.trackId);
        const isActive = activeClips.some(c => c.id === clip.id);

        if (clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO) {
          return (
            <video
              key={clip.id}
              ref={(el) => (videoRefs.current[clip.id] = el)}
              src={clip.videoUrl}
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${
                isActive && clip.type === TrackType.VIDEO ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              style={{ zIndex: trackIndex }}
              playsInline
            />
          );
        }
        if (clip.type === TrackType.IMAGE) {
          return (
            <img
              key={clip.id}
              src={clip.thumbnailUrl}
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${
                isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              style={{ zIndex: trackIndex }}
              referrerPolicy="no-referrer"
            />
          );
        }
        if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
          if (!isActive) return null;
          
          return (
            <div 
              key={clip.id}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ zIndex: trackIndex + 100 }}
            >
              <div 
                className={`px-4 py-2 rounded text-center ${clip.type === TrackType.SUBTITLE ? 'bg-black/60 mb-10' : ''}`}
                style={{
                  fontSize: `${clip.style?.fontSize || 24}px`,
                  color: clip.style?.color || '#ffffff',
                  backgroundColor: clip.style?.backgroundColor || 'transparent',
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
        <div className="absolute inset-0 flex items-center justify-center bg-black z-[200]">
          <p className="text-gray-600 text-sm font-medium">No active clips</p>
        </div>
      )}
    </div>
  );
};
