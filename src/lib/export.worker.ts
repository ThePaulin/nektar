/// <reference lib="webworker" />

import * as MP4Box from 'mp4box';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4ArrayBufferTarget } from 'mp4-muxer';
import { Track, TrackType, VideoClip } from '../types';
import { buildExportPlan, EXPORT_FPS, EXPORT_HEIGHT, EXPORT_SAMPLE_RATE, EXPORT_WIDTH } from './export-shared';
import { WebGPURenderer } from './renderer-webgpu';

type ExportFormat = 'webm' | 'mp4';

interface ExportAudioPayload {
  sampleRate: number;
  left: ArrayBuffer;
  right: ArrayBuffer;
}

interface ExportJobMessage {
  type: 'start-export';
  clips: VideoClip[];
  tracks: Track[];
  exportRange: { start: number; end: number };
  format: ExportFormat;
  audio?: ExportAudioPayload;
}

interface ExportAssetMessage {
  type: 'progress' | 'done' | 'error' | 'log';
  progress?: number;
  message?: string;
  buffer?: ArrayBuffer;
  mimeType?: string;
}

interface DecodedVideoAsset {
  frames: VideoFrame[];
  width: number;
  height: number;
  currentIndex: number;
}

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

async function decodeMp4VideoAsset(url: string): Promise<DecodedVideoAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const mp4boxFile = (MP4Box as any).createFile();
  const samples: any[] = [];
  let videoTrack: any = null;

  const trackReady = new Promise<void>((resolve, reject) => {
    mp4boxFile.onReady = (info: any) => {
      videoTrack = info.tracks.find((track: any) => track.video && track.codec);
      if (!videoTrack) {
        reject(new Error(`No video track found in ${url}`));
        return;
      }

      mp4boxFile.onSamples = (_trackId: number, _user: unknown, extractedSamples: any[]) => {
        samples.push(...extractedSamples);
      };

      mp4boxFile.setExtractionOptions(videoTrack.id, null, { nbSamples: 1000, rapAlignement: false });
      mp4boxFile.start();
      resolve();
    };

    mp4boxFile.onError = (error: string) => reject(new Error(error));
  });

  const mp4Buffer = arrayBuffer as ArrayBuffer & { fileStart?: number };
  mp4Buffer.fileStart = 0;
  mp4boxFile.appendBuffer(mp4Buffer);
  await trackReady;
  mp4boxFile.flush();

  const frames: VideoFrame[] = [];
  let decoder: VideoDecoder | null = null;

  try {
    const config: VideoDecoderConfig = {
      codec: videoTrack.codec,
      codedWidth: videoTrack.video?.width ?? EXPORT_WIDTH,
      codedHeight: videoTrack.video?.height ?? EXPORT_HEIGHT,
    };

    const description = serializeDescription(samples[0]?.description);
    if (description) {
      config.description = description;
    }

    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      throw new Error(`Unsupported video codec: ${videoTrack.codec}`);
    }

    decoder = new VideoDecoder({
      output: (frame) => {
        frames.push(frame);
      },
      error: (error) => {
        throw error;
      },
    });

    decoder.configure(config);

    for (const sample of samples) {
      if (!sample.data) continue;
      const timestamp = Math.round(((sample.pts ?? sample.cts ?? sample.dts) * 1_000_000) / sample.timescale);
      const duration = Math.max(1, Math.round((sample.duration * 1_000_000) / sample.timescale));
      decoder.decode(
        new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp,
          duration,
          data: sample.data,
        })
      );
    }

    await decoder.flush();

    return {
      frames,
      width: videoTrack.video?.width ?? EXPORT_WIDTH,
      height: videoTrack.video?.height ?? EXPORT_HEIGHT,
      currentIndex: 0,
    };
  } catch (error) {
    frames.forEach((frame) => frame.close());
    throw error;
  } finally {
    decoder?.close();
  }
}

async function loadImageAsset(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const blob = await response.blob();
  return createImageBitmap(blob);
}

function selectFrame(asset: DecodedVideoAsset, localTime: number): VideoFrame | null {
  if (asset.frames.length === 0) return null;

  while (asset.currentIndex + 1 < asset.frames.length) {
    const nextFrame = asset.frames[asset.currentIndex + 1];
    const nextTime = nextFrame.timestamp / 1_000_000;
    if (nextTime > localTime) break;
    asset.currentIndex += 1;
  }

  return asset.frames[Math.min(asset.currentIndex, asset.frames.length - 1)] ?? null;
}

async function runExport(message: ExportJobMessage) {
  const { clips, tracks, exportRange, format, audio } = message;
  const plan = buildExportPlan(clips, tracks, exportRange);
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

  const trackById = plan.trackById;
  const videoAssets = new Map<number, DecodedVideoAsset>();
  const imageAssets = new Map<number, ImageBitmap>();
  const lutTextures: Record<string, GPUTexture> = {};

  const visibleTracks = plan.visibleTracks.filter((track) => track.isVisible);
  const lutTracks = visibleTracks.filter((track) => track.lutConfig?.enabled && track.lutConfig.url);
  const videoClips = plan.exportClips.filter((clip) => clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN);
  const imageClips = plan.exportClips.filter((clip) => clip.type === TrackType.IMAGE);

  postProgress(5, 'Loading LUTs');
  if (useWebGPU) {
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
  }

  postProgress(12, 'Decoding sources');
  await Promise.all(
    videoClips.map(async (clip, index) => {
      const asset = await decodeMp4VideoAsset(clip.videoUrl ?? '');
      videoAssets.set(clip.id, asset);
      postProgress(12 + (index / Math.max(1, videoClips.length)) * 20, `Decoded ${index + 1}/${videoClips.length} videos`);
    })
  );

  await Promise.all(
    imageClips.map(async (clip, index) => {
      const bitmap = await loadImageAsset(clip.thumbnailUrl ?? '');
      imageAssets.set(clip.id, bitmap);
      postProgress(32 + (index / Math.max(1, imageClips.length)) * 5, `Loaded ${index + 1}/${imageClips.length} images`);
    })
  );

  const sampleRate = audio?.sampleRate ?? EXPORT_SAMPLE_RATE;
  const audioBuffer = audio
    ? {
        left: new Float32Array(audio.left),
        right: new Float32Array(audio.right),
      }
    : null;

  const muxer = format === 'mp4'
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

  const videoCodec = format === 'mp4' ? 'avc1.42E01F' : 'vp09.00.10.08';
  const audioCodec = format === 'mp4' ? 'mp4a.40.2' : 'opus';

  videoEncoder.configure({
    codec: videoCodec,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    bitrate: 12_000_000,
    framerate: plan.fps,
    latencyMode: 'quality',
  });
  audioEncoder.configure({
    codec: audioCodec,
    sampleRate,
    numberOfChannels: 2,
    bitrate: 128_000,
  });

  const videoSourceMap: Record<number, HTMLVideoElement | VideoFrame | null> = {};
  const imageSourceMap: Record<number, HTMLImageElement | ImageBitmap | null> = {};
  const frameDurationUs = Math.round(1_000_000 / plan.fps);

  for (let frameIndex = 0; frameIndex < plan.framePlans.length; frameIndex += 1) {
    const framePlan = plan.framePlans[frameIndex];
    const timestamp = frameIndex * frameDurationUs;

    if (frameIndex % 30 === 0 || frameIndex === plan.framePlans.length - 1) {
      postProgress(35 + ((frameIndex + 1) / Math.max(1, plan.totalFrames)) * 60, `Rendering ${frameIndex + 1}/${plan.totalFrames}`);
    }

    for (const clip of framePlan.activeClips) {
      const localTime = framePlan.time - clip.timelinePosition.start + clip.sourceStart;
      if (clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) {
        const asset = videoAssets.get(clip.id);
        videoSourceMap[clip.id] = asset ? selectFrame(asset, localTime) : null;
      } else if (clip.type === TrackType.IMAGE) {
        imageSourceMap[clip.id] = imageAssets.get(clip.id) ?? null;
      }
    }

    renderer.render(
      framePlan.activeClips,
      tracks,
      videoSourceMap,
      imageSourceMap,
      lutTextures,
      true,
      trackById
    );

    compositeCtx.fillStyle = '#000000';
    compositeCtx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    compositeCtx.drawImage(gpuCanvas, 0, 0);

    for (const clip of framePlan.activeClips) {
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
      compositeCtx.font = `${clip.style?.fontWeight || 'normal'} ${baseFontSize}px ${clip.style?.fontFamily || 'sans-serif'}`;
      compositeCtx.fillStyle = clip.style?.color || '#ffffff';
      compositeCtx.textAlign = 'center';
      compositeCtx.textBaseline = 'middle';

      if (clip.type === TrackType.SUBTITLE || (clip.style?.backgroundColor && clip.style.backgroundColor !== 'transparent')) {
        const textWidth = compositeCtx.measureText(clip.content || '').width;
        compositeCtx.fillStyle = clip.style?.backgroundColor || 'rgba(0,0,0,0.6)';
        compositeCtx.fillRect(-textWidth / 2 - 20, -baseFontSize / 2 - 10, textWidth + 40, baseFontSize + 20);
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

    if (audioBuffer) {
      const startSample = Math.floor(frameIndex * (sampleRate / plan.fps));
      const endSample = Math.floor((frameIndex + 1) * (sampleRate / plan.fps));
      const sampleCount = Math.max(0, endSample - startSample);
      if (sampleCount > 0) {
        const interleaved = new Float32Array(sampleCount * 2);
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
          interleaved[sampleIndex * 2] = audioBuffer.left[startSample + sampleIndex] ?? 0;
          interleaved[sampleIndex * 2 + 1] = audioBuffer.right[startSample + sampleIndex] ?? 0;
        }

        const audioData = new AudioData({
          format: 'f32',
          sampleRate,
          numberOfFrames: sampleCount,
          numberOfChannels: 2,
          timestamp,
          data: interleaved,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
    }
  }

  postProgress(96, 'Finalizing encoders');
  await videoEncoder.flush();
  await audioEncoder.flush();
  videoEncoder.close();
  audioEncoder.close();
  muxer.finalize();

  const target = muxer.target as WebMArrayBufferTarget | MP4ArrayBufferTarget;
  const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
  const buffer = target.buffer;

  for (const asset of videoAssets.values()) {
    asset.frames.forEach((frame) => frame.close());
  }
  for (const bitmap of imageAssets.values()) {
    bitmap.close();
  }

  ctx.postMessage({ type: 'done', buffer, mimeType } satisfies ExportAssetMessage, [buffer]);
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
