import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from '@/src/components/ExportDialog';
import { TrackType } from '@/src/types';
import { makeClip, makeTrack } from '../factories/editor';

type WorkerMessage = {
  type?: string;
  clips?: unknown;
  tracks?: unknown;
  exportRange?: unknown;
  format?: string;
};

function installNativeExportMocks(mode: 'success' | 'error') {
  const instances: Array<{
    lastMessage: WorkerMessage | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
  }> = [];

  class MockWorker {
    lastMessage: WorkerMessage | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;

    constructor(_url: URL, _options?: WorkerOptions) {
      instances.push(this);
    }

    postMessage(message: WorkerMessage) {
      this.lastMessage = message;

      if (mode === 'error') {
        queueMicrotask(() => {
          this.onmessage?.(
            new MessageEvent('message', {
              data: { type: 'error', message: 'Worker export failed' },
            }),
          );
        });
        return;
      }

      queueMicrotask(() => {
        this.onmessage?.(
          new MessageEvent('message', {
            data: { type: 'progress', progress: 42 },
          }),
        );
      });

      window.setTimeout(() => {
        this.onmessage?.(
          new MessageEvent('message', {
            data: {
              type: 'done',
              buffer: new ArrayBuffer(16),
              mimeType: 'video/webm',
              fileExtension: 'webm',
            },
          }),
        );
      }, 20);
    }

    addEventListener(type: string, handler: EventListener) {
      if (type === 'message') {
        this.onmessage = handler as (event: MessageEvent) => void;
      }

      if (type === 'error') {
        this.onerror = handler as (event: ErrorEvent) => void;
      }
    }

    removeEventListener() {}

    terminate() {}
  }

  Object.defineProperty(MockWorker, 'isConfigSupported', {
    configurable: true,
    value: vi.fn(async (config: unknown) => ({ supported: false, config })),
  });

  vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
  vi.stubGlobal('OffscreenCanvas', class MockOffscreenCanvas {});
  vi.stubGlobal('VideoEncoder', class MockVideoEncoder {
    static isConfigSupported = vi.fn(async (config: unknown) => ({ supported: false, config }));
  });
  vi.stubGlobal('AudioEncoder', class MockAudioEncoder {
    static isConfigSupported = vi.fn(async (config: unknown) => ({ supported: false, config }));
  });
  vi.stubGlobal('AudioDecoder', class MockAudioDecoder {});
  vi.stubGlobal('VideoFrame', class MockVideoFrame {});
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {},
  });

  return { instances };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as Navigator & { gpu?: unknown }).gpu;
});

describe('ExportDialog', () => {
  it('starts a native export, updates progress, and downloads the result', async () => {
    const user = userEvent.setup();
    const { instances } = installNativeExportMocks('success');
    const createdAnchors: HTMLAnchorElement[] = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === 'a') {
        createdAnchors.push(element as HTMLAnchorElement);
      }
      return element;
    }) as typeof document.createElement);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    render(
      <ExportDialog
        clips={[
          makeClip({
            id: 1,
            trackId: 'track-1',
            type: TrackType.VIDEO,
            label: 'Primary Clip',
            videoUrl: 'https://example.com/video.mp4',
            timelinePosition: { start: 0, end: 5 },
          }),
        ]}
        tracks={[
          makeTrack({
            id: 'track-1',
            type: TrackType.VIDEO,
            name: 'Video Track',
          }),
        ]}
        totalDuration={5}
        exportRange={{ start: 0, end: 5 }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Ready to Export')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WebM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MP4' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'WebM' }));
    await user.click(screen.getByRole('button', { name: 'Start Export' }));

    await waitFor(() => {
      expect(instances).toHaveLength(1);
      expect(instances[0].lastMessage?.format).toBe('webm');
    });

    expect(await screen.findByText(/42% Complete/)).toBeInTheDocument();
    expect(await screen.findByText('Export Successful!')).toBeInTheDocument();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createdAnchors).toHaveLength(1);
    expect(createdAnchors[0].download).toBe('sequence-export-1700000000000.webm');
  });

  it('shows an error when the worker reports export failure', async () => {
    const user = userEvent.setup();
    installNativeExportMocks('error');

    render(
      <ExportDialog
        clips={[]}
        tracks={[
          makeTrack({
            id: 'track-1',
            type: TrackType.VIDEO,
            name: 'Video Track',
          }),
        ]}
        totalDuration={5}
        exportRange={{ start: 0, end: 5 }}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start Export' }));

    expect(await screen.findByText('Export Failed')).toBeInTheDocument();
    expect(screen.getByText('AudioContext is not defined')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });
});
