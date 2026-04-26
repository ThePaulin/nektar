import { Track, TrackType, VideoClip, VideoObjType } from '@/src/types';

export function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    name: 'Video 1',
    type: TrackType.VIDEO,
    isVisible: true,
    isLocked: false,
    isMuted: false,
    isArmed: true,
    order: 0,
    ...overrides,
  };
}

export function makeClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 1,
    trackId: 'track-1',
    label: 'Clip 1',
    type: TrackType.VIDEO,
    videoUrl: 'https://example.com/video.mp4',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    duration: 10,
    sourceStart: 0,
    timelinePosition: {
      start: 0,
      end: 10,
    },
    ...overrides,
  };
}

export function makeEditorState(overrides?: {
  clips?: VideoObjType;
  tracks?: Track[];
}) {
  return {
    tracks: overrides?.tracks ?? [makeTrack()],
    clips: overrides?.clips ?? [makeClip()],
  };
}
