export enum TrackType {
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  SUBTITLE = 'subtitle',
  IMAGE = 'image',
  SCREEN = 'screen',
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
  volume?: number; // 0 to 1
  transform?: {
    position: { x: number; y: number; z: number };
    rotation: number;
    flipHorizontal?: boolean;
    flipVertical?: boolean;
    scale: { x: number; y: number };
    opacity: number;
    crop?: { top: number; right: number; bottom: number; left: number };
  };
  filters?: {
    brightness: number;
    saturation: number;
    contrast?: number;
  };
  style?: {
    fontSize?: number;
    fontWeight?: string | number;
    fontStyle?: string;
    fontStretch?: string;
    lineHeight?: number | string;
    fontFamily?: string;
    color?: string;
    backgroundColor?: string;
  };
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  isVisible: boolean;
  isLocked: boolean;
  isMuted: boolean;
  isArmed: boolean;
  order: number;
}

export type VideoObjType = VideoClip[];

export type RecordingMode = 'insert' | 'append';
