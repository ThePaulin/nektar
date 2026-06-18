import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder } from '@/src/components/AudioRecorder';
import { Recorder } from '@/src/components/Recorder';
import { TrackType } from '@/src/types';

describe('Recorder', () => {
  beforeEach(() => {
    window.nektarDesktop = undefined;
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Electron/37.0.0 Safari/537.36',
    });
  });

  it('waits for an explicit camera grant before requesting camera and microphone access', async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.VIDEO}
      />,
    );

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start Recording' })).toBeDisabled();
    expect(await screen.findByRole('combobox', { name: 'Camera device' })).toHaveValue('camera-1');
    expect(screen.getByRole('combobox', { name: 'Microphone device' })).toHaveValue('mic-1');

    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            deviceId: { exact: 'camera-1' },
          }),
          audio: false,
        }),
      );
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: expect.objectContaining({
            deviceId: { exact: 'mic-1' },
            echoCancellation: true,
          }),
          video: false,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Recording' })).not.toBeDisabled();
    });
  });

  it('passes selected camera and microphone devices to capture constraints', async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.VIDEO}
      />,
    );

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Camera device' }), 'camera-2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Microphone device' }), 'mic-2');
    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            deviceId: { exact: 'camera-2' },
          }),
          audio: false,
        }),
      );
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: expect.objectContaining({
            deviceId: { exact: 'mic-2' },
            echoCancellation: true,
          }),
          video: false,
        }),
      );
    });
  });

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
        copyResult: async () => 'mock-output.mp4',
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
        copyResult: async () => 'mock-output.mp4',
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
          video: expect.objectContaining({
            cursor: 'always',
          }),
          audio: false,
        }),
      );
    });
  });

  it('passes selected desktop screen source through the Electron bridge', async () => {
    const user = userEvent.setup();
    const getScreenAccessStatus = vi.fn().mockResolvedValue('granted');
    const setDisplaySource = vi.fn().mockResolvedValue(undefined);
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
        copyResult: async () => 'mock-output.mp4',
      },
      desktopSystem: {
        pickSavePath: async () => null,
        getScreenAccessStatus,
        openScreenRecordingSettings: async () => false,
        listDisplaySources: async () => [
          { id: 'screen-1', name: 'Built-in Display' },
          { id: 'window-1', name: 'Presentation Window' },
        ],
        setDisplaySource,
      },
    };

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.SCREEN}
      />,
    );

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Screen source' }), 'window-1');
    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(setDisplaySource).toHaveBeenCalledWith('window-1');
      expect(getDisplayMedia).toHaveBeenCalled();
    });
  });

  it('does not request camera access for overlay mode when screen capture is denied', async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');
    const getDisplayMedia = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.VIDEO}
      />,
    );

    await user.click(screen.getByTitle('Overlay Mode'));

    await waitFor(() => {
      expect(getDisplayMedia).toHaveBeenCalled();
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByText(/screen permission was blocked/i)).toBeInTheDocument();
  });
});

describe('AudioRecorder', () => {
  it('requests microphone access only after the user grants access', async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');

    render(
      <AudioRecorder
        onRecordingComplete={vi.fn()}
      />,
    );

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start Recording' })).toBeDisabled();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Microphone device' }), 'mic-2');

    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: expect.objectContaining({
            deviceId: { exact: 'mic-2' },
            echoCancellation: true,
          }),
          video: false,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Recording' })).not.toBeDisabled();
    });
  });
});
