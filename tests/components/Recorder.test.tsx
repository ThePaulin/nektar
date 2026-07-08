import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder } from '@/src/components/AudioRecorder';
import { Recorder } from '@/src/components/Recorder';
import { TrackType } from '@/src/types';

describe('Recorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.nektarDesktop = undefined;
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Electron/37.0.0 Safari/537.36',
    });
  });

  async function openRecordingSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Recording settings' }));
  }

  it('hides recorder settings controls behind the settings button', async () => {
    const user = userEvent.setup();

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.VIDEO}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Recording settings' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Camera device' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Microphone audio source' })).not.toBeInTheDocument();

    await openRecordingSettings(user);

    expect(await screen.findByRole('combobox', { name: 'Camera device' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Microphone audio source' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: 'Camera device' })).not.toBeInTheDocument();
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
    await openRecordingSettings(user);
    expect(await screen.findByRole('combobox', { name: 'Camera device' })).toHaveValue('camera-1');
    expect(screen.getByRole('combobox', { name: 'Microphone audio source' })).toHaveValue('mic-1');

    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
            frameRate: { ideal: 30, max: 30 },
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

    await openRecordingSettings(user);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Camera device' }), 'camera-2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Microphone audio source' }), 'mic-2');
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

  it('refreshes the camera and microphone lists after access is granted', async () => {
    const user = userEvent.setup();
    const enumerateDevices = vi.spyOn(navigator.mediaDevices, 'enumerateDevices');
    enumerateDevices
      .mockResolvedValueOnce([
        {
          deviceId: 'camera-1',
          groupId: 'group-camera-1',
          kind: 'videoinput',
          label: 'FaceTime Camera',
        },
        {
          deviceId: 'mic-1',
          groupId: 'group-mic-1',
          kind: 'audioinput',
          label: 'Built-in Microphone',
        },
      ] as MediaDeviceInfo[])
      .mockResolvedValue([
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
      ] as MediaDeviceInfo[]);

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.VIDEO}
      />,
    );

    await openRecordingSettings(user);
    const cameraSelect = await screen.findByRole('combobox', { name: 'Camera device' }) as HTMLSelectElement;
    const microphoneSelect = screen.getByRole('combobox', { name: 'Microphone audio source' }) as HTMLSelectElement;

    expect(Array.from(cameraSelect.options).map((option) => option.textContent)).toEqual(['FaceTime Camera']);
    expect(Array.from(microphoneSelect.options).map((option) => option.textContent)).toEqual(['Built-in Microphone']);

    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(Array.from((screen.getByRole('combobox', { name: 'Camera device' }) as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
        'FaceTime Camera',
        'USB Camera',
      ]);
      expect(Array.from((screen.getByRole('combobox', { name: 'Microphone audio source' }) as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
        'Built-in Microphone',
        'USB Microphone',
      ]);
    });
  });

  it('tries screen capture before opening macOS screen settings for denied preflight status', async () => {
    const user = userEvent.setup();
    const openScreenRecordingSettings = vi.fn().mockResolvedValue(true);
    const getScreenAccessStatus = vi.fn().mockResolvedValue('denied');
    const getDisplayMedia = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

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

    expect(await screen.findByRole('button', { name: 'Grant Access' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(getDisplayMedia).toHaveBeenCalled();
    });
    expect(openScreenRecordingSettings).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Open Screen Settings' }));
    expect(openScreenRecordingSettings).toHaveBeenCalled();
  });

  it('requests screen capture without audio on macOS', async () => {
    const user = userEvent.setup();
    const getScreenAccessStatus = vi.fn().mockResolvedValue('granted');
    const stream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [{ onended: null as (() => void) | null, stop: vi.fn() }],
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

  it('requests screen capture with display audio when system audio is enabled', async () => {
    const user = userEvent.setup();
    const getScreenAccessStatus = vi.fn().mockResolvedValue('granted');
    const stream = {
      getTracks: () => [],
      getAudioTracks: () => [{ kind: 'audio', stop: vi.fn() }],
      getVideoTracks: () => [{ kind: 'video', onended: null as (() => void) | null, stop: vi.fn() }],
    } as unknown as MediaStream;
    const getDisplayMedia = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockResolvedValue(stream);

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

    await openRecordingSettings(user);
    await user.click(await screen.findByTitle('Enable system audio'));
    await user.click(screen.getByRole('button', { name: 'Grant Access' }));

    await waitFor(() => {
      expect(getDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: true,
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

    await openRecordingSettings(user);
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

  it('keeps the permission prompt hidden if overlay screen capture ends while recording', async () => {
    const user = userEvent.setup();
    const screenTrack = {
      kind: 'video',
      readyState: 'live',
      onended: null as (() => void) | null,
      stop: vi.fn(),
    };
    const screenStream = {
      getTracks: () => [screenTrack],
      getAudioTracks: () => [],
      getVideoTracks: () => [screenTrack],
    } as unknown as MediaStream;

    vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockResolvedValue(screenStream);
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      writable: true,
      value: vi.fn(() => new MediaStream([{ kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack])),
    });

    render(
      <Recorder
        onRecordingComplete={vi.fn()}
        trackType={TrackType.VIDEO}
      />,
    );

    await user.click(screen.getByTitle('Overlay Mode'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Recording' })).not.toBeDisabled();
    });

    await user.click(screen.getByRole('button', { name: 'Start Recording' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    screenTrack.readyState = 'ended';
    screenTrack.onended?.();

    expect(screen.queryByText('Permissions Required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
});

describe('AudioRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.nektarDesktop = undefined;
  });

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
