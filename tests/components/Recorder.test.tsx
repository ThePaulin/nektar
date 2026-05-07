import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Recorder } from '@/src/components/Recorder';
import { TrackType } from '@/src/types';

describe('Recorder', () => {
  it('opens macOS screen settings when screen access has already been denied', async () => {
    const user = userEvent.setup();
    const openScreenRecordingSettings = vi.fn().mockResolvedValue(true);
    const getScreenAccessStatus = vi.fn().mockResolvedValue('denied');
    const getDisplayMedia = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia');

    window.nektarDesktop = {
      desktopExport: {
        isAvailable: async () => false,
        start: async () => ({ jobId: 'job-1' }),
        cancel: async () => undefined,
        onProgress: () => () => undefined,
        getResult: async () => {
          throw new Error('not implemented');
        },
      },
      desktopSystem: {
        pickSavePath: async () => null,
        getScreenAccessStatus,
        openScreenRecordingSettings,
      },
    };

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.SCREEN}
      />,
    );

    await waitFor(() => {
      expect(getScreenAccessStatus).toHaveBeenCalled();
    });

    expect(await screen.findByRole('button', { name: 'Open Screen Settings' })).toBeInTheDocument();

    await user.click(screen.getByTitle('Screen Only'));
    await user.click(screen.getByRole('button', { name: 'Open Screen Settings' }));

    expect(openScreenRecordingSettings).toHaveBeenCalled();
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it('requests screen capture without audio on macOS', async () => {
    const user = userEvent.setup();
    const getScreenAccessStatus = vi.fn().mockResolvedValue('granted');
    const stream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [{ onended: null as (() => void) | null }],
    } as unknown as MediaStream;
    const getDisplayMedia = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockResolvedValue(stream);

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Electron/37.0.0 Safari/537.36',
    });

    window.nektarDesktop = {
      desktopExport: {
        isAvailable: async () => false,
        start: async () => ({ jobId: 'job-1' }),
        cancel: async () => undefined,
        onProgress: () => () => undefined,
        getResult: async () => {
          throw new Error('not implemented');
        },
      },
      desktopSystem: {
        pickSavePath: async () => null,
        getScreenAccessStatus,
        openScreenRecordingSettings: async () => false,
      },
    };

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.SCREEN}
      />,
    );

    await waitFor(() => {
      expect(getScreenAccessStatus).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(getDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: false,
        }),
      );
    });
  });
});
