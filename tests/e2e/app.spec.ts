import { expect, test } from '@playwright/test';

const seededTracks = [
  { id: 'track-1', name: 'Video 1', type: 'video', isVisible: true, isLocked: false, isMuted: false, isArmed: true, order: 0 },
  { id: 'track-2', name: 'Audio 1', type: 'audio', isVisible: true, isLocked: false, isMuted: false, isArmed: true, order: 1 },
];

const seededClip = {
  id: 99,
  trackId: 'track-1',
  label: 'Saved Clip',
  type: 'video',
  videoUrl: 'blob:seeded-video',
  thumbnailUrl: 'blob:seeded-thumb',
  duration: 8,
  sourceStart: 0,
  timelinePosition: { start: 0, end: 8 },
};

async function installAppMocks(page: import('@playwright/test').Page, options?: { seedSession?: boolean }) {
  await page.addInitScript(
    ({ seedSession, tracks, clip }) => {
      class MockWorker {
        onmessage = null;
        postMessage(message) {
          if (message.type === 'PARSE_LUT' && this.onmessage) {
            this.onmessage({
              data: {
                type: 'LUT_PARSED',
                data: {
                  name: 'Mock LUT',
                  size: 2,
                  data: new Float32Array(32),
                },
              },
            });
          }
        }
        addEventListener(type, handler) {
          if (type === 'message') this.onmessage = handler;
        }
        removeEventListener() {}
        terminate() {}
      }

      class MockMediaRecorder {
        mimeType: string;
        ondataavailable: ((event: { data: Blob }) => void) | null;
        onstop: (() => void) | null;
        static isTypeSupported() {
          return true;
        }
        constructor() {
          this.mimeType = 'video/webm';
          this.ondataavailable = null;
          this.onstop = null;
        }
        start() {
          this.ondataavailable?.({ data: new Blob(['media'], { type: this.mimeType }) });
        }
        stop() {
          this.onstop?.();
        }
        pause() {}
        resume() {}
      }

      const mediaStream = {
        getTracks: () => [{ stop() {} }],
        getAudioTracks: () => [{ stop() {} }],
        getVideoTracks: () => [{ stop() {} }],
      };

      Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: MockWorker });
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: MockMediaRecorder });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => mediaStream,
          getDisplayMedia: async () => mediaStream,
        },
      });

      window.URL.createObjectURL = () => `blob:mock-${Math.random().toString(36).slice(2)}`;
      window.URL.revokeObjectURL = () => {};
      window.alert = () => {};
      window.HTMLMediaElement.prototype.load = function load() {};
      window.HTMLMediaElement.prototype.play = async function play() {};
      Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => false });
      Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
      Object.defineProperty(window.HTMLMediaElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 });
      Object.defineProperty(window.HTMLMediaElement.prototype, 'videoHeight', { configurable: true, get: () => 720 });
      Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 10 });

      const originalCreateElement = document.createElement.bind(document);
      document.createElement = function createElement(tagName, options) {
        const element = originalCreateElement(tagName, options);
        if (tagName === 'video' || tagName === 'audio') {
          setTimeout(() => {
            element.dispatchEvent(new Event('loadedmetadata'));
            element.dispatchEvent(new Event('canplay'));
          }, 0);
        }
        return element;
      };

      HTMLCanvasElement.prototype.getContext = (function getContext(type: string) {
        if (type === '2d') {
          return {
            fillRect() {},
            clearRect() {},
            drawImage() {},
            save() {},
            restore() {},
            translate() {},
            rotate() {},
            scale() {},
            putImageData() {},
            createImageData(width, height) {
              return {
                data: new Uint8ClampedArray(width * height * 4),
                width,
                height,
              };
            },
            set fillStyle(_value) {},
            set globalAlpha(_value) {},
          };
        }
        return null;
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      window.ResizeObserver = ResizeObserver as typeof window.ResizeObserver;

      if (seedSession) {
        const request = indexedDB.open('VideoEditorDB', 3);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
          if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['clips', 'tracks'], 'readwrite');
          tx.objectStore('clips').put(clip);
          tracks.forEach((track) => tx.objectStore('tracks').put(track));
        };
      }
    },
    { seedSession: !!options?.seedSession, tracks: seededTracks, clip: seededClip },
  );
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', async (dialog) => dialog.dismiss());
});

test('restores a saved session from IndexedDB', async ({ page }) => {
  await installAppMocks(page, { seedSession: true });
  await page.goto('/');

  await expect(page.getByText('Restore Session?')).toBeVisible();
  await page.getByRole('button', { name: 'Continue Editing' }).click();
  await expect(page.getByText('Saved Clip')).toBeVisible();
});

test('creates a text clip', async ({ page }) => {
  await installAppMocks(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Text' }).click();
  await expect(page.getByText('Text 1')).toBeVisible();
  await page.getByRole('button', { name: 'Create New' }).click();
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const openRequest = indexedDB.open('VideoEditorDB', 3);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          openRequest.onsuccess = () => resolve(openRequest.result);
          openRequest.onerror = () => reject(openRequest.error);
        });

        const tx = db.transaction('clips', 'readonly');
        const store = tx.objectStore('clips');
        const all = await new Promise<any[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        return all.some((clip) => clip.label === 'New Text' && clip.type === 'text');
      });
    })
    .toBe(true);
});

test('duplicates and deletes a text track', async ({ page }) => {
  await installAppMocks(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Text' }).click();
  await expect(page.getByText('Text 1')).toBeVisible();

  await page.getByTitle('Duplicate Track').last().click();
  await expect(page.getByText('Text 1 (Copy)')).toBeVisible();

  await page.getByTitle('Delete Track').last().click();
  await expect(page.getByText('Text 1 (Copy)')).toHaveCount(0);
});

test('opens the single-file export dialog', async ({ page }) => {
  await installAppMocks(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByText('Single Video File (mp4/webm)').click();
  await expect(page.getByText('Ready to Export')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Export' })).toBeVisible();
});
