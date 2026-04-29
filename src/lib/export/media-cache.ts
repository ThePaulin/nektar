import { ExportAsset, PreparedExportClip } from '../../types';

type PreparedAssetState = {
  asset: ExportAsset;
  videoElement?: HTMLVideoElement;
  imageElement?: HTMLImageElement;
  audioBuffer?: AudioBuffer | null;
};

function waitForEvent(
  target: HTMLMediaElement | HTMLImageElement,
  successEvent: string,
  errorEvent: string,
  timeoutMs = 5000,
) {
  return new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      target.removeEventListener(successEvent, onSuccess);
      target.removeEventListener(errorEvent, onError);
      resolve();
    };
    const onSuccess = () => finish();
    const onError = () => finish();
    const timeout = window.setTimeout(finish, timeoutMs);

    target.addEventListener(successEvent, onSuccess, { once: true });
    target.addEventListener(errorEvent, onError, { once: true });
  });
}

export class VideoFrameCache {
  private pendingSeeks = new Map<string, Promise<void>>();
  private lastSeekTimes = new Map<string, number>();

  constructor(private readonly assets: Map<string, PreparedAssetState>) {}

  async prepare(_timeRange: { start: number; end: number }) {
    return;
  }

  async seek(assetKey: string, mediaTime: number) {
    const state = this.assets.get(assetKey);
    const video = state?.videoElement;
    if (!video) return;

    const normalizedTime = Math.max(0, mediaTime);
    const lastSeekTime = this.lastSeekTimes.get(assetKey);
    if (lastSeekTime !== undefined && Math.abs(lastSeekTime - normalizedTime) < 0.001) {
      const pending = this.pendingSeeks.get(assetKey);
      if (pending) {
        await pending;
      }
      return;
    }

    if (Math.abs(video.currentTime - normalizedTime) < 0.001) {
      this.lastSeekTimes.set(assetKey, normalizedTime);
      return;
    }

    const pending = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        this.pendingSeeks.delete(assetKey);
        resolve();
      };
      const timeout = window.setTimeout(finish, 1000);
      const onSeeked = () => {
        if ('requestVideoFrameCallback' in video) {
          (video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
          }).requestVideoFrameCallback?.(() => finish());
          window.setTimeout(finish, 100);
          return;
        }
        requestAnimationFrame(() => finish());
        window.setTimeout(finish, 100);
      };

      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = normalizedTime;
    });

    this.lastSeekTimes.set(assetKey, normalizedTime);
    this.pendingSeeks.set(assetKey, pending);
    await pending;
  }

  getReadyElement(assetKey: string) {
    return this.assets.get(assetKey)?.videoElement;
  }
}

export class ExportMediaCache {
  private readonly assetStates = new Map<string, PreparedAssetState>();
  private audioContext: AudioContext | null = null;
  readonly videoFrameCache: VideoFrameCache;

  constructor(assets: ExportAsset[]) {
    assets.forEach((asset) => {
      this.assetStates.set(asset.key, { asset });
    });
    this.videoFrameCache = new VideoFrameCache(this.assetStates);
  }

  async prepare({
    needsAudio,
    onProgress,
  }: {
    needsAudio: boolean;
    onProgress?: (progress: number) => void;
  }) {
    const assets = Array.from(this.assetStates.values());
    if (needsAudio && !this.audioContext) {
      this.audioContext = new AudioContext();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    }

    for (let index = 0; index < assets.length; index += 1) {
      const state = assets[index];
      const { asset } = state;

      if (asset.kind === 'image') {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = asset.fetchUrl;
        await waitForEvent(image, 'load', 'error');
        state.imageElement = image;
        asset.width = image.naturalWidth;
        asset.height = image.naturalHeight;
      } else {
        const video = document.createElement('video');
        video.src = asset.fetchUrl;
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        await waitForEvent(video, 'loadedmetadata', 'error');
        state.videoElement = video;
        asset.width = video.videoWidth;
        asset.height = video.videoHeight;
        asset.duration = Number.isFinite(video.duration) ? video.duration : undefined;

        if (needsAudio && asset.hasAudio && this.audioContext) {
          try {
            const response = await fetch(asset.fetchUrl);
            const arrayBuffer = await response.arrayBuffer();
            state.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
          } catch (error) {
            console.warn('[Export] Failed to decode audio asset:', asset.key, error);
            state.audioBuffer = null;
          }
        }
      }

      onProgress?.((index + 1) / Math.max(assets.length, 1));
    }
  }

  async close() {
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  getAsset(key: string) {
    return this.assetStates.get(key)?.asset;
  }

  getVideoElement(key: string) {
    return this.assetStates.get(key)?.videoElement;
  }

  getImageElement(key: string) {
    return this.assetStates.get(key)?.imageElement;
  }

  getAudioBuffer(key: string) {
    return this.assetStates.get(key)?.audioBuffer ?? null;
  }

  getReadyVideoElement(key: string) {
    return this.videoFrameCache.getReadyElement(key);
  }

  async primeVideoFrames(clips: PreparedExportClip[], actualTime: number, fps: number) {
    const seeks = new Map<string, number>();
    clips.forEach((clip) => {
      if (!clip.assetKey) return;
      if (clip.clip.type !== 'video' && clip.clip.type !== 'screen') return;
      seeks.set(clip.assetKey, clip.sourceOffset + (actualTime - clip.exportStart));
    });

    await Promise.all(
      Array.from(seeks.entries()).map(([assetKey, mediaTime]) =>
        this.videoFrameCache.seek(assetKey, mediaTime + 1 / (fps * 1000)),
      ),
    );
  }
}
