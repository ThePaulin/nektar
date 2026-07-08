export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
export type MediaPermissionKind = 'camera' | 'microphone' | 'screen';

export interface RecordingDeviceOption {
  deviceId: string;
  groupId: string;
  kind: 'audioinput' | 'videoinput';
  label: string;
}

export interface DisplaySourceOption {
  id: string;
  name: string;
}

export interface CameraStreamOptions {
  cameraDeviceId?: string | null;
}

export interface MicrophoneStreamOptions {
  microphoneDeviceId?: string | null;
}

export interface ScreenStreamOptions {
  displaySourceId?: string | null;
  includeSystemAudio?: boolean;
}

export interface ScreenStreamResult {
  videoStream: MediaStream;
  systemAudioStream?: MediaStream;
  systemAudioWarning?: string | null;
}

const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  aspectRatio: { ideal: 16 / 9 },
  // Camera-class UVC devices such as the DJI Osmo Pocket 3 advertise higher
  // frame-rate modes that are not decoded reliably by every Chromium build.
  // Prefer their broadly supported 30 fps mode for capture and preview.
  frameRate: { ideal: 30, max: 30 },
};

const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function withDeviceId(
  constraints: MediaTrackConstraints,
  deviceId?: string | null,
): MediaTrackConstraints {
  if (!deviceId) return constraints;
  return {
    ...constraints,
    deviceId: { exact: deviceId },
  };
}

function getUserMediaDevices() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException(
      'Media capture requires a secure context such as HTTPS, localhost, or the desktop app.',
      'SecurityError',
    );
  }

  return navigator.mediaDevices;
}

function getDisplayMediaDevices() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new DOMException(
      'Screen capture requires a browser or desktop app that supports display media capture.',
      'NotFoundError',
    );
  }

  return navigator.mediaDevices;
}

export function describeMediaPermissionError(error: unknown, kind: MediaPermissionKind) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const label = kind === 'screen' ? 'screen' : kind === 'camera' ? 'camera' : 'microphone';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return `${label[0].toUpperCase()}${label.slice(1)} permission was blocked. Allow access in the browser or system settings, then try again.`;
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `No ${label} source was found. Connect or enable one, then try again.`;
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `The ${label} is unavailable. It may be in use by another app or blocked by the operating system.`;
  }

  if (name === 'AbortError') {
    return `${label[0].toUpperCase()}${label.slice(1)} capture was cancelled before it could start.`;
  }

  if (name === 'InvalidStateError') {
    return kind === 'screen'
      ? 'Screen sharing must be started from the active app window.'
      : `${label[0].toUpperCase()}${label.slice(1)} capture could not start from the current page state.`;
  }

  if (name === 'OverconstrainedError') {
    return `No ${label} source matched the requested recording settings.`;
  }

  if (name === 'SecurityError' || name === 'TypeError') {
    return 'Media capture requires a secure browser context such as HTTPS, localhost, or the desktop app.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Unable to access the ${label}.`;
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

export async function listRecordingDevices(): Promise<{
  cameras: RecordingDeviceOption[];
  microphones: RecordingDeviceOption[];
}> {
  const mediaDevices = getUserMediaDevices();

  if (!mediaDevices.enumerateDevices) {
    return { cameras: [], microphones: [] };
  }

  const devices = await mediaDevices.enumerateDevices();
  const cameraDevices = devices.filter((device) => device.kind === 'videoinput');
  const microphoneDevices = devices.filter((device) => device.kind === 'audioinput');

  return {
    cameras: cameraDevices.map((device, index) => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      kind: 'videoinput',
      label: device.label || `Camera ${index + 1}`,
    })),
    microphones: microphoneDevices.map((device, index) => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      kind: 'audioinput',
      label: device.label || `Microphone ${index + 1}`,
    })),
  };
}

export async function listDisplaySources(): Promise<DisplaySourceOption[]> {
  return window.nektarDesktop?.desktopSystem?.listDisplaySources?.() ?? [];
}

async function ensureDesktopMediaAccess(kind: 'camera' | 'microphone') {
  const desktopSystem = window.nektarDesktop?.desktopSystem;
  if (!desktopSystem?.requestMediaAccess) return;

  const status = await desktopSystem.getMediaAccessStatus?.(kind);
  if (status === 'denied' || status === 'restricted') {
    throw new DOMException(`${kind} permission is blocked by the operating system.`, 'NotAllowedError');
  }

  if (status === 'granted') return;

  const granted = await desktopSystem.requestMediaAccess(kind);
  if (!granted) {
    throw new DOMException(`${kind} permission was not granted.`, 'NotAllowedError');
  }
}

export async function requestCameraStream(options: CameraStreamOptions = {}) {
  const mediaDevices = getUserMediaDevices();
  let videoStream: MediaStream | null = null;

  try {
    await ensureDesktopMediaAccess('camera');
    videoStream = await mediaDevices.getUserMedia({
      video: withDeviceId(CAMERA_CONSTRAINTS, options.cameraDeviceId),
      audio: false,
    });
  } catch (error) {
    if (videoStream) stopStream(videoStream);
    throw error;
  }

  if (videoStream.getVideoTracks().length === 0) {
    stopStream(videoStream);
    throw new Error('No video track was returned for the selected camera source.');
  }

  return videoStream;
}

export async function requestMicrophoneStream(options: MicrophoneStreamOptions = {}) {
  const mediaDevices = getUserMediaDevices();
  await ensureDesktopMediaAccess('microphone');

  const stream = await mediaDevices.getUserMedia({
    audio: withDeviceId(MICROPHONE_CONSTRAINTS, options.microphoneDeviceId),
    video: false,
  });

  if (stream.getAudioTracks().length === 0) {
    stopStream(stream);
    throw new Error('No audio track was returned for the selected microphone source.');
  }

  return stream;
}

export async function requestScreenStream(_isMacOS: boolean, options: ScreenStreamOptions = {}): Promise<ScreenStreamResult> {
  const mediaDevices = getDisplayMediaDevices();
  await window.nektarDesktop?.desktopSystem?.setDisplaySource?.(options.displaySourceId ?? null);

  const constraints: DisplayMediaStreamOptions = {
    video: {
      cursor: 'always',
    } as MediaTrackConstraints,
    audio: options.includeSystemAudio ? true : false,
  };

  let stream: MediaStream;
  let systemAudioWarning: string | null = null;

  try {
    stream = await mediaDevices.getDisplayMedia(constraints);
  } catch (error) {
    if (!options.includeSystemAudio) {
      throw error;
    }

    systemAudioWarning = `System audio could not be captured. ${describeMediaPermissionError(error, 'screen')}`;
    stream = await mediaDevices.getDisplayMedia({
      ...constraints,
      audio: false,
    });
  }

  if (stream.getVideoTracks().length === 0) {
    stopStream(stream);
    throw new Error('No video track was returned for the selected screen source.');
  }

  const videoStream = new MediaStream(stream.getVideoTracks());
  const audioTracks = stream.getAudioTracks();

  return {
    videoStream,
    systemAudioStream: audioTracks.length > 0 ? new MediaStream(audioTracks) : undefined,
    systemAudioWarning: options.includeSystemAudio
      ? systemAudioWarning ?? (audioTracks.length === 0 ? 'System audio is unavailable for the selected screen source.' : null)
      : null,
  };
}
