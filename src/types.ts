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
  overlayRect?: { x: number; y: number; width: number; height: number };
  isPlaceholder?: boolean;
  childClipIds?: number[];
  isRecording?: boolean;
  recordingSessionId?: string;
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

export interface LUTData {
  size: number;
  data: Float32Array;
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
  parentId?: string;
  isSubTrack?: boolean;
  subTrackType?: 'camera' | 'screen';
  lutConfig?: {
    url: string;
    intensity: number;
    enabled: boolean;
    name?: string;
    data?: LUTData;
  };
}

export type VideoObjType = VideoClip[];

export type RecordingMode = 'insert' | 'append';
export type RecordingSource = 'camera' | 'screen' | 'overlay';

export interface RecordingOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingMediaSnapshot {
  source: RecordingSource;
  url: string;
  blob: Blob;
  width?: number;
  height?: number;
}

export interface RecordingLiveSource {
  source: RecordingSource;
  stream: MediaStream;
}

export interface RecordingStartPayload {
  source: RecordingSource;
  overlayRect?: RecordingOverlayRect;
  liveSources?: RecordingLiveSource[];
}

export interface RecordingProgressPayload {
  duration: number;
  source: RecordingSource;
  overlayRect?: RecordingOverlayRect;
  recordings: RecordingMediaSnapshot[];
  liveSources?: RecordingLiveSource[];
}

export interface RecordingCompletePayload extends RecordingProgressPayload {}

export interface DraftClipTemplate {
  id: number;
  trackId: string;
  type: TrackType;
  label: string;
  source?: RecordingSource;
  duration: number;
  sourceStart: number;
  thumbnailUrl?: string;
  overlayRect?: RecordingOverlayRect;
  isPlaceholder?: boolean;
  childClipIds?: number[];
}

export interface RecordingSession {
  id: string;
  startTime: number;
  duration: number;
  isActive: boolean;
  isPaused: boolean;
  source: RecordingSource;
  overlayRect?: RecordingOverlayRect;
  affectedTrackIds: string[];
  draftTemplates: DraftClipTemplate[];
  originalClips: VideoObjType;
  partialRecordings: Partial<Record<RecordingSource, RecordingMediaSnapshot>>;
  liveSources: Partial<Record<RecordingSource, RecordingLiveSource>>;
}
