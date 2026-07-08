import 'fake-indexeddb/auto';
import { vi } from 'vitest';

const noop = () => {};

export function installBrowserMocks() {
  if (typeof window === 'undefined') {
    return;
  }

  class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;

    postMessage(message: { type?: string; cubeString?: string; id?: string }) {
      if (message.type === 'PARSE_LUT') {
        queueMicrotask(() => {
          this.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'LUT_PARSED',
                data: {
                  name: 'Mock LUT',
                  size: 2,
                  data: new Float32Array(32),
                },
              },
            }),
          );
        });
      }
    }

    addEventListener(type: string, handler: EventListener) {
      if (type === 'message') {
        this.onmessage = handler as (event: MessageEvent) => void;
      }
    }

    removeEventListener() {
      noop();
    }

    terminate() {
      noop();
    }
  }

  class MockMediaRecorder {
    static isTypeSupported() {
      return true;
    }

    mimeType = 'video/webm';
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;

    start() {
      this.ondataavailable?.({
        data: new Blob(['media'], { type: this.mimeType }),
      } as BlobEvent);
    }

    stop() {
      this.onstop?.();
    }

    pause() {
      noop();
    }

    resume() {
      noop();
    }
  }

  class MockAudioContext {
    state = 'running';

    createMediaStreamSource() {
      return {
        connect: noop,
      };
    }

    createAnalyser() {
      return {
        fftSize: 256,
        frequencyBinCount: 128,
        getByteFrequencyData: (data: Uint8Array) => data.fill(0),
      };
    }

    createMediaStreamDestination() {
      return {
        stream: mediaStream,
      };
    }

    resume() {
      return Promise.resolve();
    }

    close() {
      return Promise.resolve();
    }
  }

  const mediaTrack = {
    addEventListener: noop,
    removeEventListener: noop,
    stop: noop,
  };
  class MockMediaStream {
    private readonly tracks: Array<any>;

    constructor(tracks: Array<any> = [mediaTrack]) {
      this.tracks = tracks;
    }

    getTracks() {
      return this.tracks;
    }

    getAudioTracks() {
      return this.tracks.filter((track) => track.kind !== 'video');
    }

    getVideoTracks() {
      return this.tracks.filter((track) => track.kind !== 'audio');
    }

    addTrack(track: any) {
      this.tracks.push(track);
    }

    removeTrack(track: any) {
      const index = this.tracks.indexOf(track);
      if (index !== -1) this.tracks.splice(index, 1);
    }
  }

  const mediaStream = {
    getTracks: () => [mediaTrack],
    getAudioTracks: () => [mediaTrack],
    getVideoTracks: () => [mediaTrack],
  } as unknown as MediaStream;

  const mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(mediaStream),
    getDisplayMedia: vi.fn().mockResolvedValue(mediaStream),
    enumerateDevices: vi.fn().mockResolvedValue([
      {
        deviceId: 'camera-1',
        groupId: 'group-camera-1',
        kind: 'videoinput',
        label: 'FaceTime Camera',
      },
      {
        deviceId: 'camera-2',
        groupId: 'group-camera-2',
        kind: 'videoinput',
        label: 'USB Camera',
      },
      {
        deviceId: 'mic-1',
        groupId: 'group-mic-1',
        kind: 'audioinput',
        label: 'Built-in Microphone',
      },
      {
        deviceId: 'mic-2',
        groupId: 'group-mic-2',
        kind: 'audioinput',
        label: 'USB Microphone',
      },
    ]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: MockWorker,
  });

  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value: MockMediaRecorder,
  });

  Object.defineProperty(globalThis, 'MediaStream', {
    configurable: true,
    writable: true,
    value: MockMediaStream,
  });

  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: MockAudioContext,
  });

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices,
  });

  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:mock-url'),
  });

  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, 'alert', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });

  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: class {
      observe() {
        noop();
      }

      disconnect() {
        noop();
      }
    },
  });

  HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
    if (type === '2d') {
      return {
        fillRect: noop,
        clearRect: noop,
        drawImage: noop,
        save: noop,
        restore: noop,
        translate: noop,
        rotate: noop,
        scale: noop,
        putImageData: noop,
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }),
        set fillStyle(_value: string) {
          noop();
        },
        set globalAlpha(_value: number) {
          noop();
        },
      };
    }

    return null;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
