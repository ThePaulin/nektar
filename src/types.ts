export enum TrackType {
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  SUBTITLE = 'subtitle',
  IMAGE = 'image',
}

export interface TimelinePosition {
  start: number;
  end: number;
}

export interface VideoClip {
  id: number;
  trackId: string;
  label: string;
  type: TrackType;
  videoUrl?: string; // For video/audio
  thumbnailUrl?: string;
  duration: number; // Original source duration
  sourceStart: number; // Where in the source video this clip starts
  timelinePosition: TimelinePosition;
  blobId?: string; // ID for IndexedDB blob storage
  content?: string; // For text/subtitles
  style?: {
    fontSize?: number;
    fontWeight?: string | number;
    fontStyle?: string;
    fontStretch?: string;
    lineHeight?: number | string;
    fontFamily?: string;
    color?: string;
    backgroundColor?: string;
    position?: { x: number; y: number };
    scale?: number;
    rotation?: number;
  };
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  isVisible: boolean;
  isLocked: boolean;
  isMuted: boolean;
}

export type VideoObjType = VideoClip[];

export type RecordingMode = 'insert' | 'append';
