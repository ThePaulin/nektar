import { videoDB } from '../services/db';
import {
  DesktopExportAsset,
  DesktopExportProgress,
  DesktopExportRequest,
  DesktopExportResult,
  DesktopExportRange,
  Track,
  TrackType,
  VideoClip,
} from '../types';
import {
  buildTextRenderMetrics,
  EXPORT_FPS,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  resolveClipTransformForRender,
} from './export-shared';

function getAssetKind(type: TrackType) {
  if (type === TrackType.IMAGE) return 'image';
  if (type === TrackType.AUDIO) return 'audio';
  return 'video';
}

function getAssetId(clip: VideoClip) {
  if (clip.blobId) return `blob:${clip.blobId}`;
  if (clip.type === TrackType.IMAGE) return `image:${clip.thumbnailUrl || clip.id}`;
  return `media:${clip.videoUrl || clip.id}`;
}

function inferOriginalName(clip: VideoClip) {
  const source = clip.videoUrl || clip.thumbnailUrl || clip.label || `clip-${clip.id}`;
  const cleanSource = source.split('?')[0];
  return cleanSource.split('/').pop() || `clip-${clip.id}`;
}

async function buildDesktopAssets(clips: VideoClip[]): Promise<DesktopExportAsset[]> {
  const assets = new Map<string, DesktopExportAsset>();

  for (const clip of clips) {
    const sourceUrl = clip.type === TrackType.IMAGE ? clip.thumbnailUrl : clip.videoUrl;
    if (!sourceUrl) continue;

    const assetId = getAssetId(clip);
    if (assets.has(assetId)) continue;

    const asset: DesktopExportAsset = {
      assetId,
      kind: getAssetKind(clip.type),
      sourceUrl,
      originalName: inferOriginalName(clip),
    };

    if (clip.blobId) {
      const blob = await videoDB.getBlob(clip.blobId);
      if (blob) {
        asset.mimeType = blob.type || undefined;
        asset.buffer = await blob.arrayBuffer();
      }
    }

    assets.set(assetId, asset);
  }

  return [...assets.values()];
}

export function isDesktopExportAvailable() {
  return !!window.nektarDesktop?.desktopExport;
}

export async function getDesktopExportAvailability() {
  const desktopExport = window.nektarDesktop?.desktopExport;
  if (!desktopExport) return false;

  try {
    return await desktopExport.isAvailable();
  } catch {
    return false;
  }
}

export function onDesktopExportProgress(listener: (progress: DesktopExportProgress) => void) {
  return window.nektarDesktop?.desktopExport.onProgress(listener) || (() => undefined);
}

export async function buildDesktopExportRequest({
  clips,
  tracks,
  exportRange,
  format,
}: {
  clips: VideoClip[];
  tracks: Track[];
  exportRange: DesktopExportRange;
  format: 'mp4' | 'webm';
}): Promise<DesktopExportRequest> {
  const visibleTrackIds = new Set(tracks.filter((track) => track.isVisible).map((track) => track.id));
  const exportClips = clips.filter((clip) =>
    visibleTrackIds.has(clip.trackId) &&
    clip.timelinePosition.end > exportRange.start &&
    clip.timelinePosition.start < exportRange.end,
  );
  const assets = await buildDesktopAssets(exportClips);

  return {
    format,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    fps: EXPORT_FPS,
    range: exportRange,
    tracks,
    clips: exportClips.map((clip) => ({
      id: clip.id,
      trackId: clip.trackId,
      label: clip.label,
      type: clip.type,
      duration: clip.duration,
      sourceStart: clip.sourceStart,
      timelinePosition: clip.timelinePosition,
      volume: clip.volume ?? 1,
      content: clip.content,
      style: clip.style
        ? {
            ...clip.style,
            fontSize: buildTextRenderMetrics(clip, EXPORT_WIDTH, EXPORT_HEIGHT).fontSize,
          }
        : undefined,
      transform: clip.transform
        ? resolveClipTransformForRender(clip.transform, EXPORT_WIDTH, EXPORT_HEIGHT)
        : undefined,
      assetRef: (clip.videoUrl || clip.thumbnailUrl) ? { assetId: getAssetId(clip) } : undefined,
    })),
    assets,
  };
}

export async function startDesktopExport(request: DesktopExportRequest) {
  const desktopExport = window.nektarDesktop?.desktopExport;
  if (!desktopExport) {
    throw new Error('Desktop FFmpeg export is not available in this environment.');
  }
  const { jobId } = await desktopExport.start(request);
  return jobId;
}

export async function getDesktopExportResult(jobId: string): Promise<DesktopExportResult> {
  const desktopExport = window.nektarDesktop?.desktopExport;
  if (!desktopExport) {
    throw new Error('Desktop FFmpeg export is not available in this environment.');
  }
  return desktopExport.getResult(jobId);
}

export async function copyDesktopExportResult(jobId: string, targetPath: string) {
  const desktopExport = window.nektarDesktop?.desktopExport;
  if (!desktopExport) {
    throw new Error('Desktop FFmpeg export is not available in this environment.');
  }
  return desktopExport.copyResult(jobId, targetPath);
}

export async function pickDesktopExportSavePath(defaultPath: string) {
  const desktopSystem = window.nektarDesktop?.desktopSystem;
  if (!desktopSystem) {
    throw new Error('Desktop save dialog is not available in this environment.');
  }
  return desktopSystem.pickSavePath(defaultPath);
}

export async function cancelDesktopExport(jobId: string) {
  const desktopExport = window.nektarDesktop?.desktopExport;
  if (!desktopExport) return;
  await desktopExport.cancel(jobId);
}
