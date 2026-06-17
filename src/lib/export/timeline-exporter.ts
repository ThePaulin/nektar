import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4ArrayBufferTarget } from 'mp4-muxer';
import {
  ExportAsset,
  ExportOptions,
  ExportResult,
  PreparedExportClip,
  PreparedExportScene,
  ResolvedClipTransform,
  Track,
  TrackType,
  VideoClip,
  VideoObjType,
} from '../../types';
import { ExportMediaCache } from './media-cache';
import { renderMixedAudio } from './audio-mixer';
import { FrameRenderer } from './frame-renderer';

const STAGE_PROGRESS_RANGE: Record<'prepare' | 'audio' | 'render' | 'finalize', { start: number; end: number }> = {
  prepare: { start: 0, end: 0.2 },
  audio: { start: 0.2, end: 0.35 },
  render: { start: 0.35, end: 0.95 },
  finalize: { start: 0.95, end: 1 },
};

function resolveFetchUrl(sourceUrl: string) {
  return /^https?:\/\//.test(sourceUrl)
    ? `/api/proxy?url=${encodeURIComponent(sourceUrl)}`
    : sourceUrl;
}

function getAssetKey(clip: VideoClip) {
  if (clip.type === TrackType.IMAGE) {
    if (clip.blobId) return `image:${clip.blobId}`;
    return `image:${clip.thumbnailUrl || clip.id}`;
  }

  if (clip.blobId) return `media:${clip.blobId}`;
  return `media:${clip.videoUrl || clip.id}`;
}

function resolveTransform(clip: VideoClip): ResolvedClipTransform {
  return {
    position: {
      x: clip.transform?.position.x || 0,
      y: clip.transform?.position.y || 0,
      z: clip.transform?.position.z || 0,
    },
    rotation: clip.transform?.rotation || 0,
    flipHorizontal: clip.transform?.flipHorizontal || false,
    flipVertical: clip.transform?.flipVertical || false,
    scale: {
      x: clip.transform?.scale.x || 1,
      y: clip.transform?.scale.y || 1,
    },
    opacity: clip.transform?.opacity ?? 1,
    crop: {
      top: clip.transform?.crop?.top || 0,
      right: clip.transform?.crop?.right || 0,
      bottom: clip.transform?.crop?.bottom || 0,
      left: clip.transform?.crop?.left || 0,
    },
  };
}

export function prepareExportScene({
  clips,
  tracks,
  options,
}: {
  clips: VideoObjType;
  tracks: Track[];
  options: ExportOptions;
}): PreparedExportScene {
  const visibleTracks = tracks.filter((track) => track.isVisible);
  const visibleTrackIds = new Set(visibleTracks.map((track) => track.id));
  const trackOrder = new Map(
    tracks.map((track, index) => [track.id, index]),
  );
  const assetMap = new Map<string, ExportAsset>();
  const preparedClips: PreparedExportClip[] = [];

  clips.forEach((clip) => {
    if (!visibleTrackIds.has(clip.trackId)) return;

    const exportStart = Math.max(options.range.start, clip.timelinePosition.start);
    const exportEnd = Math.min(options.range.end, clip.timelinePosition.end);
    if (exportEnd <= exportStart) return;

    let assetKey: string | undefined;
    let sourceUrl: string | undefined;
    let kind: ExportAsset['kind'] | undefined;

    if (clip.type === TrackType.IMAGE && clip.thumbnailUrl) {
      assetKey = getAssetKey(clip);
      sourceUrl = clip.thumbnailUrl;
      kind = 'image';
    }

    if ((clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO || clip.type === TrackType.SCREEN) && clip.videoUrl) {
      assetKey = getAssetKey(clip);
      sourceUrl = clip.videoUrl;
      kind = 'media';
    }

    if (assetKey && sourceUrl && kind && !assetMap.has(assetKey)) {
      assetMap.set(assetKey, {
        key: assetKey,
        kind,
        sourceUrl,
        fetchUrl: resolveFetchUrl(sourceUrl),
        blobId: clip.blobId,
        hasAudio: clip.type !== TrackType.IMAGE && clip.type !== TrackType.TEXT && clip.type !== TrackType.SUBTITLE,
      });
    }

    preparedClips.push({
      clip,
      assetKey,
      timelineStart: clip.timelinePosition.start,
      timelineEnd: clip.timelinePosition.end,
      exportStart,
      exportEnd,
      sourceOffset: clip.sourceStart + (exportStart - clip.timelinePosition.start),
      volume: clip.volume ?? 1,
      isMuted: tracks.find((track) => track.id === clip.trackId)?.isMuted ?? false,
      trackOrder: trackOrder.get(clip.trackId) ?? Number.MAX_SAFE_INTEGER,
      transform: resolveTransform(clip),
    });
  });

  preparedClips.sort((a, b) => a.trackOrder - b.trackOrder || a.exportStart - b.exportStart || a.clip.id - b.clip.id);

  return {
    range: options.range,
    duration: Math.round((options.range.end - options.range.start) * options.fps) / options.fps,
    width: options.width,
    height: options.height,
    fps: options.fps,
    assets: Array.from(assetMap.values()),
    clips: preparedClips,
  };
}

export function mapStageProgress(stage: keyof typeof STAGE_PROGRESS_RANGE, progress: number) {
  const range = STAGE_PROGRESS_RANGE[stage];
  const normalized = Math.max(0, Math.min(1, progress));
  return range.start + (range.end - range.start) * normalized;
}

export async function exportTimeline({
  clips,
  tracks,
  options,
}: {
  clips: VideoObjType;
  tracks: Track[];
  options: ExportOptions;
}): Promise<ExportResult> {
  if (!('VideoEncoder' in window) || !('AudioEncoder' in window) || !('VideoFrame' in window)) {
    throw new Error('Your browser does not support WebCodecs. Please use a modern browser like Chrome or Edge.');
  }

  const scene = prepareExportScene({ clips, tracks, options });
  if (scene.duration <= 0) {
    throw new Error('Invalid export range. Duration must be greater than 0.');
  }

  const mediaCache = new ExportMediaCache(scene.assets);
  try {
    options.onProgress?.(0, 'prepare');
    await mediaCache.prepare({
      needsAudio: true,
      onProgress: (progress) => options.onProgress?.(mapStageProgress('prepare', progress), 'prepare'),
    });
    await mediaCache.videoFrameCache.prepare(scene.range);

    const mixedAudio = await renderMixedAudio({
      scene,
      mediaCache,
      onProgress: (progress) => options.onProgress?.(mapStageProgress('audio', progress), 'audio'),
    });

    const sampleRate = mixedAudio?.sampleRate || 44100;
    const muxer = options.format === 'mp4'
      ? new MP4Muxer({
          target: new MP4ArrayBufferTarget(),
          video: { codec: 'avc', width: options.width, height: options.height },
          audio: { codec: 'aac', sampleRate, numberOfChannels: 2 },
          fastStart: 'in-memory',
        })
      : new WebMMuxer({
          target: new WebMArrayBufferTarget(),
          video: { codec: 'V_VP9', width: options.width, height: options.height, frameRate: options.fps },
          audio: { codec: 'A_OPUS', sampleRate, numberOfChannels: 2 },
        });

    const videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: (error) => {
        throw error;
      },
    });
    const audioEncoder = new AudioEncoder({
      output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
      error: (error) => {
        throw error;
      },
    });

    if (options.format === 'mp4') {
      videoEncoder.configure({
        codec: 'avc1.42E01F',
        width: options.width,
        height: options.height,
        bitrate: 12_000_000,
        framerate: options.fps,
        latencyMode: 'quality',
      });
      audioEncoder.configure({
        codec: 'mp4a.40.2',
        sampleRate,
        numberOfChannels: 2,
        bitrate: 128_000,
      });
    } else {
      videoEncoder.configure({
        codec: 'vp09.00.10.08',
        width: options.width,
        height: options.height,
        bitrate: 12_000_000,
        framerate: options.fps,
        latencyMode: 'quality',
      });
      audioEncoder.configure({
        codec: 'opus',
        sampleRate,
        numberOfChannels: 2,
        bitrate: 128_000,
      });
    }

    const renderer = new FrameRenderer(scene, mediaCache);
    const totalFrames = Math.round(scene.duration * options.fps);
    const frameDuration = 1 / options.fps;

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (options.onCancel?.()) {
        throw new Error('Export cancelled');
      }

      const actualTime = scene.range.start + frameIndex * frameDuration;
      const canvas = await renderer.renderFrame(actualTime);
      const timestamp = Math.round(frameIndex * frameDuration * 1_000_000);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: Math.round(frameDuration * 1_000_000),
      });
      videoEncoder.encode(frame);
      frame.close();

      if (mixedAudio) {
        const startSample = Math.floor(frameIndex * frameDuration * sampleRate);
        const endSample = Math.floor((frameIndex + 1) * frameDuration * sampleRate);
        const numSamples = endSample - startSample;
        if (numSamples > 0) {
          const interleavedData = new Float32Array(numSamples * 2);
          const left = mixedAudio.getChannelData(0);
          const right = mixedAudio.getChannelData(1);
          for (let sampleIndex = 0; sampleIndex < numSamples; sampleIndex += 1) {
            interleavedData[sampleIndex * 2] = left[startSample + sampleIndex] || 0;
            interleavedData[sampleIndex * 2 + 1] = right[startSample + sampleIndex] || 0;
          }
          const audioData = new AudioData({
            format: 'f32',
            sampleRate,
            numberOfFrames: numSamples,
            numberOfChannels: 2,
            timestamp,
            data: interleavedData,
          });
          audioEncoder.encode(audioData);
          audioData.close();
        }
      }

      options.onProgress?.(mapStageProgress('render', (frameIndex + 1) / Math.max(totalFrames, 1)), 'render');
    }

    options.onProgress?.(mapStageProgress('finalize', 0), 'finalize');
    await videoEncoder.flush();
    await audioEncoder.flush();
    videoEncoder.close();
    audioEncoder.close();
    muxer.finalize();

    const { buffer } = muxer.target as WebMArrayBufferTarget | MP4ArrayBufferTarget;
    options.onProgress?.(mapStageProgress('finalize', 1), 'finalize');

    return {
      blob: new Blob([buffer], { type: options.format === 'mp4' ? 'video/mp4' : 'video/webm' }),
      format: options.format,
      duration: scene.duration,
    };
  } finally {
    await mediaCache.close();
  }
}
