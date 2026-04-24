import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4ArrayBufferTarget } from 'mp4-muxer';
import { VideoObjType, Track, TrackType, VideoClip } from '../types';
import { EXPORT_FPS, EXPORT_HEIGHT, EXPORT_SAMPLE_RATE, EXPORT_WIDTH } from '../lib/export-shared';

type ExportFormat = 'webm' | 'mp4';

interface ExportDialogProps {
  clips: VideoObjType;
  tracks: Track[];
  totalDuration: number;
  exportRange: { start: number; end: number };
  onClose: () => void;
}

interface ExportResult {
  buffer: ArrayBuffer;
  mimeType: string;
  fileExtension: string;
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

function canUseNativeWorkerExport() {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioDecoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'gpu' in navigator
  );
}

function canUseLegacyCanvasExport() {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

function downloadBlob(buffer: ArrayBuffer, mimeType: string, filename: string) {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

async function chooseEncoderChoice(requestedFormat: ExportFormat): Promise<EncoderChoice> {
  const candidate: EncoderCandidate = requestedFormat === 'mp4'
    ? { format: 'mp4', videoCodec: 'avc1.42E01F', audioCodec: 'mp4a.40.2', mimeType: 'video/mp4', fileExtension: 'mp4' }
    : { format: 'webm', videoCodec: 'vp09.00.10.08', audioCodec: 'opus', mimeType: 'video/webm', fileExtension: 'webm' };

  const videoCodecCandidates = requestedFormat === 'mp4'
    ? ['avc1.42E01F', 'avc1.42E01E', 'avc1.4D401F', 'avc1.640028']
    : [candidate.videoCodec];
  const latencyModeCandidates: Array<'realtime' | 'quality' | undefined> = requestedFormat === 'mp4'
    ? ['realtime', 'quality', undefined]
    : ['quality', 'realtime', undefined];

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

function closeAudioContext(audioContext: AudioContext | null) {
  if (!audioContext) return Promise.resolve();
  return audioContext.close().catch(() => undefined);
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ clips, tracks, exportRange, onClose }) => {
  const [status, setStatus] = useState<'idle' | 'exporting' | 'completed' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>(
    typeof MediaRecorder !== 'undefined' && (
      MediaRecorder.isTypeSupported('video/mp4') ||
      MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
    ) ? 'mp4' : 'webm'
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoElementsRef = useRef<Record<number, HTMLVideoElement>>({});
  const imageElementsRef = useRef<Record<number, HTMLImageElement>>({});

  const cleanupLegacyAssets = () => {
    Object.values(videoElementsRef.current as Record<string, HTMLVideoElement>).forEach((video) => {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Ignore cleanup errors from detached elements.
      }
    });

    videoElementsRef.current = {};
    imageElementsRef.current = {};
  };

  const runWorkerExport = async (): Promise<ExportResult> => {
    let exportWorker: Worker | null = null;

    try {
      exportWorker = new Worker(new URL('../lib/export.worker.ts', import.meta.url), { type: 'module' });

      return await new Promise<ExportResult>((resolve, reject) => {
        exportWorker!.onmessage = (event: MessageEvent<any>) => {
          const data = event.data;
          if (!data || typeof data !== 'object') return;

          if (data.type === 'progress' && typeof data.progress === 'number') {
            setProgress(data.progress);
            return;
          }

          if (data.type === 'done' && data.buffer && data.mimeType) {
            resolve({
              buffer: data.buffer,
              mimeType: data.mimeType,
              fileExtension: data.fileExtension || format,
            });
            return;
          }

          if (data.type === 'error') {
            reject(new Error(data.message || 'Worker export failed'));
          }
        };

        exportWorker!.onerror = (event) => {
          reject(event.error || new Error(event.message));
        };

        exportWorker!.postMessage({
          type: 'start-export',
          clips,
          tracks,
          exportRange,
          format,
        });
      });
    } finally {
      exportWorker?.terminate();
    }
  };

  const runLegacyExport = async (): Promise<ExportResult> => {
    if (!canUseLegacyCanvasExport()) {
      throw new Error('Your browser is missing the features required for the compatibility export path.');
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error('Legacy export canvas is unavailable.');
    }

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }

    const offscreenCanvas = offscreenCanvasRef.current;
    canvas.width = EXPORT_WIDTH;
    canvas.height = EXPORT_HEIGHT;
    offscreenCanvas.width = EXPORT_WIDTH;
    offscreenCanvas.height = EXPORT_HEIGHT;

    const ctx = canvas.getContext('2d', { alpha: false });
    const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
    if (!ctx || !offscreenCtx) {
      throw new Error('Failed to initialize the compatibility export canvas.');
    }

    const visibleTrackIds = new Set(tracks.filter((track) => track.isVisible).map((track) => track.id));
    const exportClips = clips.filter(
      (clip) => visibleTrackIds.has(clip.trackId) &&
        clip.timelinePosition.end > exportRange.start &&
        clip.timelinePosition.start < exportRange.end
    );
    const exportDuration = Math.max(0, exportRange.end - exportRange.start);
    if (exportDuration <= 0) {
      throw new Error('Invalid export range. Duration must be greater than 0.');
    }

    const trackIndexById = new Map(tracks.map((track, index) => [track.id, index]));
    setProgress(5);

    await Promise.all(
      exportClips.map(async (clip, index) => {
        if ((clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) && clip.videoUrl) {
          const video = document.createElement('video');
          video.src = clip.videoUrl;
          video.muted = true;
          video.playsInline = true;
          video.crossOrigin = 'anonymous';
          video.preload = 'auto';

          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };

            const timeout = window.setTimeout(finish, 5000);
            const onLoaded = () => {
              window.clearTimeout(timeout);
              finish();
            };

            video.addEventListener('loadedmetadata', onLoaded, { once: true });
            video.addEventListener('error', onLoaded, { once: true });
          });

          videoElementsRef.current[clip.id] = video;
        } else if (clip.type === TrackType.IMAGE && clip.thumbnailUrl) {
          const image = new Image();
          image.src = clip.thumbnailUrl;
          image.crossOrigin = 'anonymous';

          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };

            const timeout = window.setTimeout(finish, 5000);
            const onDone = () => {
              window.clearTimeout(timeout);
              finish();
            };

            image.addEventListener('load', onDone, { once: true });
            image.addEventListener('error', onDone, { once: true });
          });

          imageElementsRef.current[clip.id] = image;
        }

        if (index === exportClips.length - 1 || index % 4 === 0) {
          setProgress(5 + ((index + 1) / Math.max(1, exportClips.length)) * 10);
        }
      })
    );

    setProgress(18);
    let audioContext: AudioContext | null = null;

    try {
      audioContext = new AudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const offlineContext = new OfflineAudioContext(
        2,
        Math.max(1, Math.ceil(exportDuration * EXPORT_SAMPLE_RATE)),
        EXPORT_SAMPLE_RATE
      );

      await Promise.all(
        exportClips
          .filter((clip) => clip.videoUrl && (clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO || clip.type === TrackType.SCREEN))
          .map(async (clip) => {
            const track = tracks.find((candidate) => candidate.id === clip.trackId);
            if (track?.isMuted) return;

            try {
              const response = await fetch(clip.videoUrl!);
              if (!response.ok) {
                throw new Error(`Failed to fetch ${clip.videoUrl}: ${response.status}`);
              }

              const arrayBuffer = await response.arrayBuffer();
              const audioBuffer = await audioContext!.decodeAudioData(arrayBuffer.slice(0));
              const source = offlineContext.createBufferSource();
              const gainNode = offlineContext.createGain();

              source.buffer = audioBuffer;
              gainNode.gain.value = clip.volume !== undefined ? clip.volume : 1;

              source.connect(gainNode);
              gainNode.connect(offlineContext.destination);

              const clipStartInExport = Math.max(0, clip.timelinePosition.start - exportRange.start);
              const clipEndInExport = Math.min(exportDuration, clip.timelinePosition.end - exportRange.start);
              if (clipEndInExport <= clipStartInExport) return;

              const trimBeforeClip = Math.max(0, exportRange.start - clip.timelinePosition.start);
              const offset = Math.max(0, clip.sourceStart + trimBeforeClip);
              const duration = clipEndInExport - clipStartInExport;
              if (duration > 0) {
                source.start(clipStartInExport, offset, duration);
              }
            } catch (clipError) {
              console.warn(`[Export] Failed to prerender audio for clip ${clip.id}:`, clipError);
            }
          })
      );

      setProgress(24);
      const renderedAudioBuffer = await offlineContext.startRendering();
      const encoderChoice = await chooseEncoderChoice(format);

      const muxer = encoderChoice.format === 'mp4'
        ? new MP4Muxer({
            target: new MP4ArrayBufferTarget(),
            video: { codec: 'avc', width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
            audio: { codec: 'aac', sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: 2 },
            fastStart: 'in-memory',
          })
        : new WebMMuxer({
            target: new WebMArrayBufferTarget(),
            video: { codec: 'V_VP9', width: EXPORT_WIDTH, height: EXPORT_HEIGHT, frameRate: EXPORT_FPS },
            audio: { codec: 'A_OPUS', sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: 2 },
          });

      let videoEncoderError: Error | null = null;
      const videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: (codecError) => {
          videoEncoderError = toError(codecError, 'Video encoding failed.');
        },
      });

      let audioEncoderError: Error | null = null;
      const audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
        error: (codecError) => {
          audioEncoderError = toError(codecError, 'Audio encoding failed.');
        },
      });

      videoEncoder.configure({
        ...encoderChoice.videoConfig,
        framerate: EXPORT_FPS,
      });
      audioEncoder.configure({
        ...encoderChoice.audioConfig,
        sampleRate: EXPORT_SAMPLE_RATE,
      });

      const frameDurationUs = Math.round(1_000_000 / EXPORT_FPS);
      const totalFrames = Math.max(1, Math.round(exportDuration * EXPORT_FPS));

      const seekClip = async (clip: VideoClip, time: number) => {
        const video = videoElementsRef.current[clip.id];
        if (!video) return;

        const clipLocalTime = Math.max(0, time - clip.timelinePosition.start + clip.sourceStart);
        const maxTime = Number.isFinite(video.duration) && video.duration > 0
          ? Math.max(0, video.duration - 0.001)
          : clipLocalTime;
        const targetTime = Math.max(0, Math.min(maxTime, clipLocalTime));

        if (Math.abs(video.currentTime - targetTime) < 0.01) {
          return;
        }

        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };

          const timeout = window.setTimeout(finish, 1000);
          const onSeeked = () => {
            window.clearTimeout(timeout);
            finish();
          };

          video.addEventListener('seeked', onSeeked, { once: true });
          video.currentTime = targetTime;
        });
      };

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        const time = exportRange.start + frameIndex / EXPORT_FPS;
        const timestamp = frameIndex * frameDurationUs;

        if (frameIndex === totalFrames - 1 || frameIndex % 15 === 0) {
          setProgress(30 + ((frameIndex + 1) / totalFrames) * 55);
        }

        const activeClips = exportClips
          .filter((clip) => time >= clip.timelinePosition.start && time < clip.timelinePosition.end)
          .sort((left, right) => {
            const rightTrackIndex = Number(trackIndexById.get(right.trackId) ?? 0);
            const leftTrackIndex = Number(trackIndexById.get(left.trackId) ?? 0);
            return rightTrackIndex - leftTrackIndex;
          });

        await Promise.all(
          activeClips
            .filter((clip) => clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN)
            .map((clip) => seekClip(clip, time))
        );

        offscreenCtx.fillStyle = '#000000';
        offscreenCtx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

        for (const clip of activeClips) {
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
          const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };

          offscreenCtx.save();
          offscreenCtx.globalAlpha = transform.opacity ?? 1;
          offscreenCtx.translate(EXPORT_WIDTH / 2 + (transform.position.x || 0), EXPORT_HEIGHT / 2 + (transform.position.y || 0));
          offscreenCtx.rotate(((typeof transform.rotation === 'number' ? transform.rotation : 0) * Math.PI) / 180);
          offscreenCtx.scale(
            (transform.scale?.x || 1) * (transform.flipHorizontal ? -1 : 1),
            (transform.scale?.y || 1) * (transform.flipVertical ? -1 : 1)
          );

          if (clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) {
            const video = videoElementsRef.current[clip.id];
            if (video && video.videoWidth > 0 && video.videoHeight > 0) {
              const sx = (crop.left / 100) * video.videoWidth;
              const sy = (crop.top / 100) * video.videoHeight;
              const sw = video.videoWidth * (1 - (crop.left + crop.right) / 100);
              const sh = video.videoHeight * (1 - (crop.top + crop.bottom) / 100);
              offscreenCtx.drawImage(video, sx, sy, sw, sh, -EXPORT_WIDTH / 2, -EXPORT_HEIGHT / 2, EXPORT_WIDTH, EXPORT_HEIGHT);
            }
          } else if (clip.type === TrackType.IMAGE) {
            const image = imageElementsRef.current[clip.id];
            if (image && image.width > 0 && image.height > 0) {
              const sx = (crop.left / 100) * image.width;
              const sy = (crop.top / 100) * image.height;
              const sw = image.width * (1 - (crop.left + crop.right) / 100);
              const sh = image.height * (1 - (crop.top + crop.bottom) / 100);
              offscreenCtx.drawImage(image, sx, sy, sw, sh, -EXPORT_WIDTH / 2, -EXPORT_HEIGHT / 2, EXPORT_WIDTH, EXPORT_HEIGHT);
            }
          } else if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
            const fontSize = clip.style?.fontSize || 48;
            const fontFamily = clip.style?.fontFamily || 'sans-serif';
            const fontWeight = clip.style?.fontWeight || 'normal';
            const fontStyle = clip.style?.fontStyle || 'normal';
            const fontStretch = clip.style?.fontStretch ? `${clip.style.fontStretch} ` : '';

            offscreenCtx.font = `${fontStyle} ${fontWeight} ${fontStretch}${fontSize}px ${fontFamily}`.replace(/\s+/g, ' ').trim();
            offscreenCtx.fillStyle = clip.style?.color || '#ffffff';
            offscreenCtx.textAlign = 'center';
            offscreenCtx.textBaseline = 'middle';

            if (clip.type === TrackType.SUBTITLE || (clip.style?.backgroundColor && clip.style.backgroundColor !== 'transparent')) {
              const textWidth = offscreenCtx.measureText(clip.content || '').width;
              offscreenCtx.fillStyle = clip.style?.backgroundColor || 'rgba(0,0,0,0.6)';
              offscreenCtx.fillRect(-textWidth / 2 - 20, -fontSize / 2 - 10, textWidth + 40, fontSize + 20);
              offscreenCtx.fillStyle = clip.style?.color || '#ffffff';
            }

            const offsetY = clip.type === TrackType.SUBTITLE ? (EXPORT_HEIGHT / 2 - 80) : 0;
            offscreenCtx.fillText(clip.content || '', 0, offsetY);
          }

          offscreenCtx.restore();
        }

        ctx.drawImage(offscreenCanvas, 0, 0);

        const frame = new VideoFrame(offscreenCanvas, {
          timestamp,
          duration: frameDurationUs,
        });

        try {
          videoEncoder.encode(frame);
        } finally {
          frame.close();
        }

        throwIfCodecError(videoEncoderError);
        throwIfCodecError(audioEncoderError);
      }

      setProgress(88);
      const leftChannel = renderedAudioBuffer.getChannelData(0);
      const rightChannel = renderedAudioBuffer.numberOfChannels > 1
        ? renderedAudioBuffer.getChannelData(1)
        : leftChannel;
      const audioChunkSamples = Math.max(8192, Math.round(EXPORT_SAMPLE_RATE / 4));

      for (let start = 0; start < renderedAudioBuffer.length; start += audioChunkSamples) {
        const frames = Math.min(audioChunkSamples, renderedAudioBuffer.length - start);
        const interleaved = new Float32Array(frames * 2);

        for (let index = 0; index < frames; index += 1) {
          interleaved[index * 2] = leftChannel[start + index] ?? 0;
          interleaved[index * 2 + 1] = rightChannel[start + index] ?? 0;
        }

        const audioData = new AudioData({
          format: 'f32',
          sampleRate: EXPORT_SAMPLE_RATE,
          numberOfFrames: frames,
          numberOfChannels: 2,
          timestamp: Math.round((start / EXPORT_SAMPLE_RATE) * 1_000_000),
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

      setProgress(96);
      await videoEncoder.flush();
      await audioEncoder.flush();
      throwIfCodecError(videoEncoderError);
      throwIfCodecError(audioEncoderError);

      videoEncoder.close();
      audioEncoder.close();
      muxer.finalize();

      const target = muxer.target as WebMArrayBufferTarget | MP4ArrayBufferTarget;
      return {
        buffer: target.buffer,
        mimeType: encoderChoice.mimeType,
        fileExtension: encoderChoice.fileExtension,
      };
    } finally {
      cleanupLegacyAssets();
      await closeAudioContext(audioContext);
    }
  };

  const startExport = async () => {
    setStatus('exporting');
    setProgress(0);
    setError(null);

    let result: ExportResult | null = null;
    let workerError: unknown = null;

    try {
      if (canUseNativeWorkerExport()) {
        try {
          result = await runWorkerExport();
        } catch (primaryError) {
          workerError = primaryError;
          if (!canUseLegacyCanvasExport()) {
            throw primaryError;
          }

          console.warn('[Export] Worker export failed, falling back to compatibility export:', primaryError);
          setProgress(0);
          result = await runLegacyExport();
        }
      } else {
        if (!canUseLegacyCanvasExport()) {
          throw new Error('Your browser is missing the features required for export.');
        }

        result = await runLegacyExport();
      }

      downloadBlob(result.buffer, result.mimeType, `sequence-export-${Date.now()}.${result.fileExtension}`);
      setProgress(100);
      setStatus('completed');
    } catch (exportError) {
      if (workerError) {
        console.error('[Export] Compatibility export also failed:', exportError);
      } else {
        console.error('[Export] Export failed:', exportError);
      }

      const resolvedError = exportError instanceof Error ? exportError : workerError instanceof Error ? workerError : new Error('Export failed');
      setError(resolvedError.message);
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Export Sequence</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-8 flex flex-col items-center text-center">
          {status === 'idle' && (
            <>
              <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                <Download size={40} className="text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Export</h3>
              <p className="text-gray-500 mb-6">
                Render the selected range at 1080p or higher using the browser export pipeline.
              </p>

              <div className="flex bg-gray-100 p-1 rounded-xl w-full mb-8">
                <button
                  onClick={() => setFormat('webm')}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${format === 'webm' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  WebM
                </button>
                <button
                  onClick={() => setFormat('mp4')}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${format === 'mp4' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  MP4
                </button>
              </div>

              <button
                onClick={startExport}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
              >
                Start Export
              </button>
            </>
          )}

          {status === 'exporting' && (
            <>
              <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 relative">
                <Loader2 size={40} className="text-blue-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-blue-600">{Math.round(progress)}%</span>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Exporting Sequence...</h3>
              <p className="text-gray-500 mb-8">
                Please keep this window open while the exporter renders your video.
              </p>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                <motion.div
                  className="h-full bg-blue-600"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 font-medium">{Math.round(progress)}% Complete</span>
            </>
          )}

          {status === 'completed' && (
            <>
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 size={40} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Export Successful!</h3>
              <p className="text-gray-500 mb-8">
                Your video has been exported and should be downloading automatically.
              </p>
              <button
                onClick={onClose}
                className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all"
              >
                Close
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6">
                <AlertCircle size={40} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Export Failed</h3>
              <p className="text-red-500 mb-8">{error}</p>
              <button
                onClick={startExport}
                className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                Try Again
              </button>
            </>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </motion.div>
    </div>
  );
};
