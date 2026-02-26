export interface TimelinePosition {
  start: number;
  end: number;
}

export interface VideoClip {
  id: number;
  label: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: number; // Original source duration
  sourceStart: number; // Where in the source video this clip starts
  timelinePosition: TimelinePosition;
  blobId?: string; // ID for IndexedDB blob storage
}

export type VideoObjType = VideoClip[];
