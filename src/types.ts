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

export type DesktopExportMode = 'browser' | 'desktop-ffmpeg';

export interface DesktopExportRange {
  start: number;
  end: number;
}

export interface DesktopExportAsset {
  assetId: string;
  kind: 'video' | 'audio' | 'image';
  sourceUrl?: string;
  originalName: string;
  mimeType?: string;
  buffer?: ArrayBuffer;
}

export interface DesktopExportClipAssetRef {
  assetId: string;
}

export interface DesktopExportClip {
  id: number;
  trackId: string;
  label: string;
  type: TrackType;
  duration: number;
  sourceStart: number;
  timelinePosition: TimelinePosition;
  volume: number;
  content?: string;
  style?: VideoClip['style'];
  transform?: VideoClip['transform'];
  assetRef?: DesktopExportClipAssetRef;
}

export interface DesktopExportRequest {
  format: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  range: DesktopExportRange;
  clips: DesktopExportClip[];
  tracks: Track[];
  assets: DesktopExportAsset[];
}

export interface DesktopExportProgress {
  jobId: string;
  progress: number;
  stage: 'materialize' | 'download' | 'ffmpeg' | 'finalize' | 'completed' | 'error';
  message?: string;
}

export interface DesktopExportResult {
  jobId: string;
  outputPath: string;
  outputFileName: string;
  workspaceDir: string;
  format: 'mp4' | 'webm';
}
