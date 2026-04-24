/// <reference lib="webworker" />

import * as MP4Box from 'mp4box';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4ArrayBufferTarget } from 'mp4-muxer';
import { Track, TrackType, VideoClip } from '../types';
import { buildExportPlan, EXPORT_FPS, EXPORT_HEIGHT, EXPORT_SAMPLE_RATE, EXPORT_WIDTH } from './export-shared';
import { WebGPURenderer } from './renderer-webgpu';

type ExportFormat = 'webm' | 'mp4';

interface ExportJobMessage {
  type: 'start-export';
  clips: VideoClip[];
  tracks: Track[];
  exportRange: { start: number; end: number };
  format: ExportFormat;
}

interface ExportAssetMessage {
  type: 'progress' | 'done' | 'error';
  progress?: number;
  message?: string;
  buffer?: ArrayBuffer;
  mimeType?: string;
  fileExtension?: string;
}

interface MediaSample {
  timestamp: number;
  duration: number;
  data: Uint8Array;
  isSync: boolean;
}

interface LoadedVideoTrack {
  codec: string;
  width: number;
  height: number;
  description?: ArrayBuffer;
  samples: MediaSample[];
}

interface LoadedAudioTrack {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer;
  samples: MediaSample[];
}

interface LoadedMediaAsset {
  video?: LoadedVideoTrack;
  audio?: LoadedAudioTrack;
}

interface DecodedVideoAsset {
  samples: MediaSample[];
  codec: string;
  width: number;
  height: number;
  description?: ArrayBuffer;
  decoder: VideoDecoder | null;
  decoderError: Error | null;
  frames: VideoFrame[];
  decodeIndex: number;
  selectedIndex: number;
  pendingDecode?: Promise<void>;
}

interface DecodedAudioAsset {
  sampleRate: number;
  numberOfChannels: number;
  left: Float32Array;
  right: Float32Array;
}

interface EncoderChoice {
  format: ExportFormat;
  videoCodec: string;
  audioCodec: string;
  mimeType: string;
  fileExtension: string;
  videoConfig: VideoEncoderConfig;
  audioConfig: AudioEncoderConfig;
}

type EncoderCandidate = Omit<EncoderChoice, 'videoConfig' | 'audioConfig'>;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function postProgress(progress: number, message?: string) {
  ctx.postMessage({ type: 'progress', progress, message } satisfies ExportAssetMessage);
}

function serializeDescription(description: any): ArrayBuffer | undefined {
  if (!description || typeof description.write !== 'function') return undefined;

  try {
    const stream = new (MP4Box as any).DataStream(2048);
    description.write(stream);
    const length = typeof stream.getPosition === 'function' ? stream.getPosition() : stream.byteLength;
    return stream.buffer.slice(0, length);
  } catch (error) {
    console.warn('[ExportWorker] Failed to serialize codec description:', error);
    return undefined;
  }
}

function sampleTimestampUs(sample: any) {
  const timeScale = sample.timescale || 1;
  const value = sample.pts ?? sample.cts ?? sample.dts ?? 0;
  return Math.round((value * 1_000_000) / timeScale);
}

function toError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error) return new Error(error);
  return new Error(fallbackMessage);
}

function throwIfCodecError(error: Error | null | undefined) {
  if (error) {
    throw error;
  }
}

function buildAudioDecoderConfigs(track: LoadedAudioTrack): AudioDecoderConfig[] {
  const base = { codec: track.codec };
  const withLayout = {
    ...(track.sampleRate > 0 ? { sampleRate: track.sampleRate } : {}),
    ...(track.numberOfChannels > 0 ? { numberOfChannels: track.numberOfChannels } : {}),
  };
  const configs: AudioDecoderConfig[] = [];

  if (track.description) {
    configs.push({ ...base, ...withLayout, description: track.description });
    configs.push({ ...base, description: track.description });
  }

  configs.push({ ...base, ...withLayout });
  configs.push(base);

  return configs;
}

async function configureAudioDecoder(decoder: AudioDecoder, track: LoadedAudioTrack) {
  const candidates = buildAudioDecoderConfigs(track);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    let support: AudioDecoderSupport;

    try {
      support = await AudioDecoder.isConfigSupported(candidate);
    } catch (error) {
      lastError = toError(error, `Failed to inspect audio decoder support for ${track.codec}.`);
      continue;
    }

    if (!support.supported) continue;

    for (const config of [support.config, candidate]) {
      try {
        decoder.configure(config);
        return;
      } catch (error) {
        lastError = toError(error, `Failed to configure audio decoder for ${track.codec}.`);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Unsupported audio codec: ${track.codec}`);
}

async function configureVideoDecoder(decoder: VideoDecoder, asset: DecodedVideoAsset) {
  const config: VideoDecoderConfig = {
    codec: asset.codec,
    codedWidth: asset.width,
    codedHeight: asset.height,
  };

  if (asset.description) {
    config.description = asset.description;
  }

  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`Unsupported video codec: ${asset.codec}`);
  }

  let configureError: Error | null = null;
  for (const candidate of [support.config, config]) {
    try {
      decoder.configure(candidate);
      return;
    } catch (error) {
      configureError = toError(error, `Failed to configure video decoder for ${asset.codec}.`);
    }
  }

  throw configureError ?? new Error(`Failed to configure video decoder for ${asset.codec}.`);
}

async function chooseEncoderChoice(requestedFormat: ExportFormat): Promise<EncoderChoice> {
  const candidate: EncoderCandidate = requestedFormat === 'mp4'
    ? { format: 'mp4', videoCodec: 'avc1.42E01F', audioCodec: 'mp4a.40.2', mimeType: 'video/mp4', fileExtension: 'mp4' }
    : { format: 'webm', videoCodec: 'vp09.00.10.08', audioCodec: 'opus', mimeType: 'video/webm', fileExtension: 'webm' };

  const videoCodecCandidates = requestedFormat === 'mp4'
    ? ['avc1.42E01F', 'avc1.42E01E', 'avc1.4D401F', 'avc1.640028']
    : [candidate.videoCodec];
  const latencyModeCandidates: Array<'realtime' | 'quality' | undefined> = requestedFormat === 'mp4'
    ? ['realtime', 'quality', undefined]
    : ['realtime', 'quality', undefined];
  const audioConfigCandidates: AudioEncoderConfig[] = [
    {
      codec: candidate.audioCodec,
      sampleRate: EXPORT_SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: 128_000,
    },
    {
      codec: candidate.audioCodec,
      sampleRate: EXPORT_SAMPLE_RATE,
      bitrate: 128_000,
    } as AudioEncoderConfig,
  ];

  for (const videoCodec of videoCodecCandidates) {
    for (const latencyMode of latencyModeCandidates) {
      const videoConfig: VideoEncoderConfig = {
        codec: videoCodec,
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        bitrate: 12_000_000,
        framerate: EXPORT_FPS,
        ...(latencyMode ? { latencyMode } : {}),
      };

      const videoSupported = await VideoEncoder.isConfigSupported(videoConfig);
      if (!videoSupported.supported) continue;

      for (const audioConfig of audioConfigCandidates) {
        const audioSupported = await AudioEncoder.isConfigSupported(audioConfig);
        if (!audioSupported.supported) continue;

        return {
          ...candidate,
          videoCodec,
          videoConfig: videoSupported.config,
          audioConfig: audioSupported.config,
        };
      }
    }
  }

  throw new Error(`${requestedFormat.toUpperCase()} export is not supported in this browser.`);
}

async function loadMediaAsset(url: string): Promise<LoadedMediaAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const mp4boxFile = (MP4Box as any).createFile();
  const videoSamples: MediaSample[] = [];
  const audioSamples: MediaSample[] = [];
  let videoDescription: ArrayBuffer | undefined;
  let audioDescription: ArrayBuffer | undefined;
  let videoTrack: any = null;
  let audioTrack: any = null;

  const ready = new Promise<void>((resolve, reject) => {
    mp4boxFile.onReady = (info: any) => {
      videoTrack = info.tracks.find((track: any) => track.video && track.codec);
      audioTrack = info.tracks.find((track: any) => track.audio && track.codec);

      if (!videoTrack && !audioTrack) {
        reject(new Error(`No decodable tracks found in ${url}`));
        return;
      }

      mp4boxFile.onSamples = (trackId: number, _user: unknown, extractedSamples: any[]) => {
        if (videoTrack && trackId === videoTrack.id) {
          for (const sample of extractedSamples) {
            if (!sample.data) continue;
            if (!videoDescription) {
              videoDescription = serializeDescription(sample.description);
            }
            videoSamples.push({
              timestamp: sampleTimestampUs(sample),
              duration: Math.max(1, Math.round(((sample.duration || 1) * 1_000_000) / (sample.timescale || 1))),
              data: new Uint8Array(sample.data),
              isSync: !!sample.is_sync,
            });
          }
        }

        if (audioTrack && trackId === audioTrack.id) {
          for (const sample of extractedSamples) {
            if (!sample.data) continue;
            if (!audioDescription) {
              audioDescription = serializeDescription(sample.description);
            }
            audioSamples.push({
              timestamp: sampleTimestampUs(sample),
              duration: Math.max(1, Math.round(((sample.duration || 1) * 1_000_000) / (sample.timescale || 1))),
              data: new Uint8Array(sample.data),
              isSync: !!sample.is_sync,
            });
          }
        }
      };

      if (videoTrack) {
        mp4boxFile.setExtractionOptions(videoTrack.id, null, { nbSamples: 1000, rapAlignement: false });
      }
      if (audioTrack) {
        mp4boxFile.setExtractionOptions(audioTrack.id, null, { nbSamples: 1000, rapAlignement: false });
      }
      mp4boxFile.start();
      resolve();
    };

    mp4boxFile.onError = (error: string) => reject(new Error(error));
  });

  const mp4Buffer = arrayBuffer as ArrayBuffer & { fileStart?: number };
  mp4Buffer.fileStart = 0;
  mp4boxFile.appendBuffer(mp4Buffer);
  await ready;
  mp4boxFile.flush();

  const result: LoadedMediaAsset = {};

  if (videoTrack) {
    const videoInfo = videoTrack.video || {};
    result.video = {
      codec: videoTrack.codec,
      width: videoInfo.width ?? videoInfo.coded_width ?? EXPORT_WIDTH,
      height: videoInfo.height ?? videoInfo.coded_height ?? EXPORT_HEIGHT,
      description: videoDescription,
      samples: videoSamples,
    };
  }

  if (audioTrack) {
    const audioInfo = audioTrack.audio || {};
    result.audio = {
      codec: audioTrack.codec,
      sampleRate: audioInfo.sample_rate ?? audioInfo.sampleRate ?? EXPORT_SAMPLE_RATE,
      numberOfChannels: audioInfo.channel_count ?? audioInfo.channelCount ?? 2,
      description: audioDescription,
      samples: audioSamples,
    };
  }

  return result;
}

async function loadImageAsset(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return createImageBitmap(await response.blob());
}

function createVideoAssetState(track: LoadedVideoTrack): DecodedVideoAsset {
  return {
    samples: track.samples,
    codec: track.codec,
    width: track.width,
    height: track.height,
    description: track.description,
    decoder: null,
    decoderError: null,
    frames: [],
    decodeIndex: 0,
    selectedIndex: 0,
  };
}

async function ensureVideoDecoder(asset: DecodedVideoAsset) {
  if (asset.decoder) return;
  throwIfCodecError(asset.decoderError);

  asset.decoder = new VideoDecoder({
    output: (frame) => {
      if (asset.decoderError) {
        frame.close();
        return;
      }
      asset.frames.push(frame);
    },
    error: (error) => {
      asset.decoderError = toError(error, `Failed to decode video for ${asset.codec}.`);
    },
  });

  try {
    await configureVideoDecoder(asset.decoder, asset);
    throwIfCodecError(asset.decoderError);
  } catch (error) {
    asset.decoder.close();
    asset.decoder = null;
    throw error;
  }
}

async function ensureVideoFrames(asset: DecodedVideoAsset, targetTime: number, lookAheadSeconds = 1) {
  await ensureVideoDecoder(asset);
  throwIfCodecError(asset.decoderError);

  if (asset.pendingDecode) {
    await asset.pendingDecode;
  }

  const targetTimestamp = Math.round((targetTime + lookAheadSeconds) * 1_000_000);
  asset.pendingDecode = (async () => {
    while (asset.decodeIndex < asset.samples.length && asset.samples[asset.decodeIndex].timestamp <= targetTimestamp) {
      const sample = asset.samples[asset.decodeIndex];
      asset.decoder!.decode(
        new EncodedVideoChunk({
          type: sample.isSync ? 'key' : 'delta',
          timestamp: sample.timestamp,
          duration: sample.duration,
          data: sample.data,
        })
      );
      asset.decodeIndex += 1;
      throwIfCodecError(asset.decoderError);
    }

    await asset.decoder!.flush();
    throwIfCodecError(asset.decoderError);

    const trimThreshold = Math.round(Math.max(0, targetTime - 2) * 1_000_000);
    let removed = 0;
    while (asset.frames.length > 1 && asset.frames[0].timestamp < trimThreshold) {
      const frame = asset.frames.shift();
      frame?.close();
      removed += 1;
    }

    if (removed > 0) {
      asset.selectedIndex = Math.max(0, asset.selectedIndex - removed);
    }
  })();

  await asset.pendingDecode;
  asset.pendingDecode = undefined;
}

function selectVideoFrame(asset: DecodedVideoAsset, localTime: number): VideoFrame | null {
  if (asset.frames.length === 0) return null;

  while (asset.selectedIndex + 1 < asset.frames.length) {
    const nextFrame = asset.frames[asset.selectedIndex + 1];
    const nextTime = nextFrame.timestamp / 1_000_000;
    if (nextTime > localTime) break;
    asset.selectedIndex += 1;
  }

  return asset.frames[Math.min(asset.selectedIndex, asset.frames.length - 1)] ?? null;
}

async function decodeAudioTrack(track: LoadedAudioTrack): Promise<DecodedAudioAsset> {
  const leftChunks: Float32Array[] = [];
  const rightChunks: Float32Array[] = [];
  let totalFrames = 0;
  let decoderError: Error | null = null;

  const decoder = new AudioDecoder({
    output: (audioData) => {
      if (decoderError) {
        audioData.close();
        return;
      }

      const frameCount = audioData.numberOfFrames;
      const left = new Float32Array(frameCount);
      const right = new Float32Array(frameCount);

      audioData.copyTo(left, { planeIndex: 0 });
      if (audioData.numberOfChannels > 1) {
        audioData.copyTo(right, { planeIndex: 1 });
      } else {
        right.set(left);
      }

      leftChunks.push(left);
      rightChunks.push(right);
      totalFrames += frameCount;
      audioData.close();
    },
    error: (error) => {
      decoderError = toError(error, `Failed to decode audio for ${track.codec}.`);
    },
  });

  try {
    await configureAudioDecoder(decoder, track);
    throwIfCodecError(decoderError);

    for (const sample of track.samples) {
      decoder.decode(
        new EncodedAudioChunk({
          type: sample.isSync ? 'key' : 'delta',
          timestamp: sample.timestamp,
          duration: sample.duration,
          data: sample.data,
        })
      );
      throwIfCodecError(decoderError);
    }

    await decoder.flush();
    throwIfCodecError(decoderError);
  } finally {
    try {
      decoder.close();
    } catch {
      // Decoder failures may close the codec before cleanup runs.
    }
  }

  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  let offset = 0;
  for (let index = 0; index < leftChunks.length; index += 1) {
    left.set(leftChunks[index], offset);
    right.set(rightChunks[index], offset);
    offset += leftChunks[index].length;
  }

  return {
    sampleRate: track.sampleRate,
    numberOfChannels: track.numberOfChannels,
    left,
    right,
  };
}

function mixAudioTrack(
  masterLeft: Float32Array,
  masterRight: Float32Array,
  decoded: DecodedAudioAsset,
  clip: VideoClip,
  exportRange: { start: number; end: number },
  exportSampleRate: number,
  gain: number
) {
  const exportDuration = Math.max(0, exportRange.end - exportRange.start);
  const clipStart = Math.max(0, clip.timelinePosition.start - exportRange.start);
  const clipEnd = Math.min(exportDuration, clip.timelinePosition.end - exportRange.start);
  if (clipEnd <= clipStart) return;

  const sourceOffset = clip.sourceStart;
  const targetStart = Math.max(0, Math.floor(clipStart * exportSampleRate));
  const targetEnd = Math.min(masterLeft.length, Math.ceil(clipEnd * exportSampleRate));
  const sourceStart = Math.max(0, sourceOffset * decoded.sampleRate);
  const sourceLimit = decoded.left.length - 1;

  for (let targetIndex = targetStart; targetIndex < targetEnd; targetIndex += 1) {
    const exportTime = targetIndex / exportSampleRate;
    const sourcePosition = sourceStart + (exportTime - clipStart) * decoded.sampleRate;
    const sourceIndex = Math.max(0, Math.min(sourceLimit, sourcePosition));
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(sourceLimit, lower + 1);
    const mix = sourceIndex - lower;

    const left = decoded.left[lower] * (1 - mix) + decoded.left[upper] * mix;
    const right = decoded.right[lower] * (1 - mix) + decoded.right[upper] * mix;
    masterLeft[targetIndex] += left * gain;
    masterRight[targetIndex] += right * gain;
  }
}

function createActiveClipCursor(plan: ReturnType<typeof buildExportPlan>) {
  const events = plan.clipEvents.slice();
  const active = new Map<number, VideoClip>();
  const ordered: VideoClip[] = [];
  let eventIndex = 0;

  const compareClips = (left: VideoClip, right: VideoClip) => {
    const leftOrder = plan.trackOrderById.get(left.trackId) ?? 0;
    const rightOrder = plan.trackOrderById.get(right.trackId) ?? 0;
    if (leftOrder !== rightOrder) return rightOrder - leftOrder;
    if (left.timelinePosition.start !== right.timelinePosition.start) {
      return left.timelinePosition.start - right.timelinePosition.start;
    }
    return left.id - right.id;
  };

  return {
    advanceTo(time: number) {
      let changed = false;
      while (eventIndex < events.length && events[eventIndex].time <= time + 1e-6) {
        const event = events[eventIndex];
        if (event.kind === 'start') {
          active.set(event.clip.id, event.clip);
        } else {
          active.delete(event.clip.id);
        }
        changed = true;
        eventIndex += 1;
      }

      if (changed) {
        ordered.length = 0;
        for (const clip of active.values()) ordered.push(clip);
        ordered.sort(compareClips);
      }
    },
    getActiveClips() {
      return ordered;
    },
  };
}

async function runExport(message: ExportJobMessage) {
  const { clips, tracks, exportRange, format } = message;
  const plan = buildExportPlan(clips, tracks, exportRange);
  const encoderChoice = await chooseEncoderChoice(format);

  const gpuCanvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT);
  const compositeCanvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT);
  const compositeCtx = compositeCanvas.getContext('2d', { alpha: false });
  if (!compositeCtx) {
    throw new Error('Failed to get export composite canvas context');
  }

  const renderer = new WebGPURenderer();
  const useWebGPU = await renderer.init(gpuCanvas);
  if (!useWebGPU) {
    throw new Error('WebGPU is required for the worker export path');
  }

  const mediaCache = new Map<string, Promise<LoadedMediaAsset>>();
  const imageCache = new Map<string, Promise<ImageBitmap>>();
  const videoAssetsByClipId = new Map<number, DecodedVideoAsset>();
  const audioAssetsByUrl = new Map<string, Promise<DecodedAudioAsset | null>>();
  const imageAssetsByClipId = new Map<number, ImageBitmap>();
  const lutTextures: Record<string, GPUTexture> = {};
  const trackById = plan.trackById;

  const getMediaAsset = (url: string) => {
    let asset = mediaCache.get(url);
    if (!asset) {
      asset = loadMediaAsset(url);
      mediaCache.set(url, asset);
    }
    return asset;
  };

  const getImageAsset = (url: string) => {
    let asset = imageCache.get(url);
    if (!asset) {
      asset = loadImageAsset(url);
      imageCache.set(url, asset);
    }
    return asset;
  };

  const visibleTracks = plan.visibleTracks.filter((track) => track.isVisible);
  const lutTracks = visibleTracks.filter((track) => track.lutConfig?.enabled && track.lutConfig.url);
  const videoOrAudioClips = plan.exportClips.filter((clip) => clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN || clip.type === TrackType.AUDIO);
  const imageClips = plan.exportClips.filter((clip) => clip.type === TrackType.IMAGE);

  postProgress(5, 'Loading LUTs');
  for (const track of lutTracks) {
    try {
      const response = await fetch(track.lutConfig!.url);
      const cubeString = await response.text();
      const lutData = (await import('./lut')).parseCubeLUT(cubeString);
      const texture = renderer.createLutTexture(lutData);
      if (texture) {
        lutTextures[track.id] = texture;
      }
    } catch (error) {
      console.warn(`[ExportWorker] Failed to load LUT for track ${track.id}:`, error);
    }
  }

  postProgress(12, 'Loading media');
  await Promise.all([
    ...videoOrAudioClips
      .filter((clip) => clip.videoUrl)
      .map(async (clip) => {
        const media = await getMediaAsset(clip.videoUrl!);
        if (media.video) {
          videoAssetsByClipId.set(clip.id, createVideoAssetState(media.video));
        }
      }),
    ...imageClips
      .filter((clip) => clip.thumbnailUrl)
      .map(async (clip) => {
        imageAssetsByClipId.set(clip.id, await getImageAsset(clip.thumbnailUrl!));
      }),
  ]);

  postProgress(28, 'Decoding audio');
  const exportDuration = plan.exportDuration;
  const sampleRate = EXPORT_SAMPLE_RATE;
  const masterFrameCount = Math.max(1, Math.ceil(exportDuration * sampleRate));
  const masterLeft = new Float32Array(masterFrameCount);
  const masterRight = new Float32Array(masterFrameCount);

  await Promise.all(
    videoOrAudioClips
      .filter((clip) => clip.videoUrl)
      .map(async (clip) => {
        const track = trackById.get(clip.trackId);
        if (track?.isMuted) return;

        const media = await getMediaAsset(clip.videoUrl!);
        if (!media.audio) return;

        let decoded = audioAssetsByUrl.get(clip.videoUrl!);
        if (!decoded) {
          decoded = media.audio ? decodeAudioTrack(media.audio).catch((error) => {
            console.warn(`[ExportWorker] Failed to decode audio for ${clip.videoUrl}:`, error);
            return null;
          }) : Promise.resolve(null);
          audioAssetsByUrl.set(clip.videoUrl!, decoded);
        }

        const audio = await decoded;
        if (!audio) return;

        mixAudioTrack(
          masterLeft,
          masterRight,
          audio,
          clip,
          exportRange,
          sampleRate,
          clip.volume !== undefined ? clip.volume : 1
        );
      })
  );

  const muxer = encoderChoice.format === 'mp4'
    ? new MP4Muxer({
        target: new MP4ArrayBufferTarget(),
        video: { codec: 'avc', width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
        audio: { codec: 'aac', sampleRate, numberOfChannels: 2 },
        fastStart: 'in-memory',
      })
    : new WebMMuxer({
        target: new WebMArrayBufferTarget(),
        video: { codec: 'V_VP9', width: EXPORT_WIDTH, height: EXPORT_HEIGHT, frameRate: plan.fps },
        audio: { codec: 'A_OPUS', sampleRate, numberOfChannels: 2 },
      });

  let videoEncoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (error) => {
      videoEncoderError = toError(error, 'Video encoding failed.');
    },
  });

  let audioEncoderError: Error | null = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
    error: (error) => {
      audioEncoderError = toError(error, 'Audio encoding failed.');
    },
  });

  videoEncoder.configure({
    ...encoderChoice.videoConfig,
    framerate: plan.fps,
  });

  audioEncoder.configure({
    ...encoderChoice.audioConfig,
    sampleRate,
  });

  const cursor = createActiveClipCursor(plan);
  const videoSourceMap: Record<number, VideoFrame | null> = {};
  const imageSourceMap: Record<number, ImageBitmap | null> = {};
  const frameDurationUs = Math.round(1_000_000 / plan.fps);
  const textLayoutCache = new Map<number, { signature: string; width: number }>();

  for (let frameIndex = 0; frameIndex < plan.totalFrames; frameIndex += 1) {
    const time = exportRange.start + frameIndex / plan.fps;
    const timestamp = frameIndex * frameDurationUs;

    if (frameIndex % 30 === 0 || frameIndex === plan.totalFrames - 1) {
      postProgress(30 + ((frameIndex + 1) / Math.max(1, plan.totalFrames)) * 60, `Rendering ${frameIndex + 1}/${plan.totalFrames}`);
    }

    cursor.advanceTo(time);
    const activeClips = cursor.getActiveClips();
    const videoClips = activeClips.filter((clip) => clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN);

    await Promise.all(
      videoClips.map(async (clip) => {
        const media = clip.videoUrl ? await getMediaAsset(clip.videoUrl) : null;
        const asset = videoAssetsByClipId.get(clip.id);
        if (!media?.video || !asset) return;

        const localTime = time - clip.timelinePosition.start + clip.sourceStart;
        await ensureVideoFrames(asset, localTime);
        videoSourceMap[clip.id] = selectVideoFrame(asset, localTime);
      })
    );

    for (const clip of activeClips) {
      if (clip.type === TrackType.IMAGE) {
        imageSourceMap[clip.id] = imageAssetsByClipId.get(clip.id) ?? null;
      }
    }

    renderer.render(activeClips, tracks, videoSourceMap, imageSourceMap, lutTextures, true, trackById);

    compositeCtx.fillStyle = '#000000';
    compositeCtx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    compositeCtx.drawImage(gpuCanvas, 0, 0);

    for (const clip of activeClips) {
      if (clip.type !== TrackType.TEXT && clip.type !== TrackType.SUBTITLE) continue;

      const transform = {
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
        scale: { x: 1, y: 1 },
        opacity: 1,
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        ...(clip.transform || {}),
      };

      compositeCtx.save();
      compositeCtx.globalAlpha = transform.opacity ?? 1;
      compositeCtx.translate(EXPORT_WIDTH / 2 + (transform.position.x || 0), EXPORT_HEIGHT / 2 + (transform.position.y || 0));

      const baseFontSize = clip.style?.fontSize || 48;
      const fontFamily = clip.style?.fontFamily || 'sans-serif';
      const fontWeight = clip.style?.fontWeight || 'normal';
      const fontStyle = clip.style?.fontStyle || 'normal';
      const fontStretch = clip.style?.fontStretch ? `${clip.style.fontStretch} ` : '';
      const fontSignature = `${fontStyle}|${fontWeight}|${fontStretch}${baseFontSize}|${fontFamily}|${clip.content || ''}|${clip.style?.backgroundColor || ''}|${clip.style?.color || ''}`;
      const cached = textLayoutCache.get(clip.id);
      let measuredWidth = cached?.signature === fontSignature ? cached.width : 0;

      compositeCtx.font = `${fontStyle} ${fontWeight} ${fontStretch}${baseFontSize}px ${fontFamily}`.replace(/\s+/g, ' ').trim();
      compositeCtx.fillStyle = clip.style?.color || '#ffffff';
      compositeCtx.textAlign = 'center';
      compositeCtx.textBaseline = 'middle';

      if (clip.type === TrackType.SUBTITLE || (clip.style?.backgroundColor && clip.style.backgroundColor !== 'transparent')) {
        if (!measuredWidth) {
          measuredWidth = compositeCtx.measureText(clip.content || '').width;
          textLayoutCache.set(clip.id, { signature: fontSignature, width: measuredWidth });
        }

        compositeCtx.fillStyle = clip.style?.backgroundColor || 'rgba(0,0,0,0.6)';
        compositeCtx.fillRect(-measuredWidth / 2 - 20, -baseFontSize / 2 - 10, measuredWidth + 40, baseFontSize + 20);
        compositeCtx.fillStyle = clip.style?.color || '#ffffff';
      }

      const offsetY = clip.type === TrackType.SUBTITLE ? (EXPORT_HEIGHT / 2 - 80) : 0;
      compositeCtx.fillText(clip.content || '', 0, offsetY);
      compositeCtx.restore();
    }

    const frame = new VideoFrame(compositeCanvas, {
      timestamp,
      duration: frameDurationUs,
    });
    videoEncoder.encode(frame);
    frame.close();
    throwIfCodecError(videoEncoderError);
    throwIfCodecError(audioEncoderError);
  }

  postProgress(95, 'Encoding audio');
  const audioChunkSamples = Math.max(8192, Math.round(sampleRate / 4));
  for (let start = 0; start < masterFrameCount; start += audioChunkSamples) {
    const frames = Math.min(audioChunkSamples, masterFrameCount - start);
    const interleaved = new Float32Array(frames * 2);
    for (let index = 0; index < frames; index += 1) {
      interleaved[index * 2] = masterLeft[start + index] ?? 0;
      interleaved[index * 2 + 1] = masterRight[start + index] ?? 0;
    }

    const audioData = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: 2,
      timestamp: Math.round((start / sampleRate) * 1_000_000),
      data: interleaved,
    });
    try {
      audioEncoder.encode(audioData);
    } finally {
      audioData.close();
    }
    throwIfCodecError(videoEncoderError);
    throwIfCodecError(audioEncoderError);
  }

  postProgress(98, 'Finalizing encoders');
  await videoEncoder.flush();
  await audioEncoder.flush();
  throwIfCodecError(videoEncoderError);
  throwIfCodecError(audioEncoderError);
  videoEncoder.close();
  audioEncoder.close();
  muxer.finalize();

  const target = muxer.target as WebMArrayBufferTarget | MP4ArrayBufferTarget;
  const mimeType = encoderChoice.mimeType;
  const buffer = target.buffer;

  for (const asset of videoAssetsByClipId.values()) {
    asset.frames.forEach((frame) => frame.close());
  }
  for (const bitmap of imageAssetsByClipId.values()) {
    bitmap.close();
  }

  ctx.postMessage({ type: 'done', buffer, mimeType, fileExtension: encoderChoice.fileExtension } satisfies ExportAssetMessage, [buffer]);
}

ctx.onmessage = async (event: MessageEvent<ExportJobMessage>) => {
  const message = event.data;

  if (message.type !== 'start-export') return;

  try {
    await runExport(message);
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies ExportAssetMessage);
  }
};
