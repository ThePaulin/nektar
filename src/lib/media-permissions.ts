export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
export type MediaPermissionKind = 'camera' | 'microphone' | 'screen';

export interface CameraStreamResult {
  stream: MediaStream;
  microphoneAvailable: boolean;
  audioWarning: string | null;
}

const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

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

export async function requestCameraStream(): Promise<CameraStreamResult> {
  const mediaDevices = getUserMediaDevices();

  try {
    await ensureDesktopMediaAccess('camera');
    await ensureDesktopMediaAccess('microphone');

    const stream = await mediaDevices.getUserMedia({
      video: CAMERA_CONSTRAINTS,
      audio: MICROPHONE_CONSTRAINTS,
    });

    return {
      stream,
      microphoneAvailable: stream.getAudioTracks().length > 0,
      audioWarning: stream.getAudioTracks().length > 0 ? null : 'Camera access is ready, but no microphone track was provided.',
    };
  } catch (error) {
    let videoOnlyStream: MediaStream | null = null;

    try {
      await ensureDesktopMediaAccess('camera');
      videoOnlyStream = await mediaDevices.getUserMedia({
        video: CAMERA_CONSTRAINTS,
        audio: false,
      });
    } catch {
      throw error;
    }

    if (videoOnlyStream.getVideoTracks().length === 0) {
      stopStream(videoOnlyStream);
      throw new Error('No video track was returned for the selected camera source.');
    }

    return {
      stream: videoOnlyStream,
      microphoneAvailable: false,
      audioWarning: describeMediaPermissionError(error, 'microphone'),
    };
  }
}

export async function requestMicrophoneStream() {
  const mediaDevices = getUserMediaDevices();
  await ensureDesktopMediaAccess('microphone');

  const stream = await mediaDevices.getUserMedia({
    audio: MICROPHONE_CONSTRAINTS,
    video: false,
  });

  if (stream.getAudioTracks().length === 0) {
    stopStream(stream);
    throw new Error('No audio track was returned for the selected microphone source.');
  }

  return stream;
}

export async function requestScreenStream(isMacOS: boolean) {
  const mediaDevices = getDisplayMediaDevices();
  const constraints: DisplayMediaStreamOptions = {
    video: {
      cursor: 'always',
    } as MediaTrackConstraints,
    audio: isMacOS ? false : MICROPHONE_CONSTRAINTS,
  };

  let stream: MediaStream;

  try {
    stream = await mediaDevices.getDisplayMedia(constraints);
  } catch (error) {
    if (isMacOS || constraints.audio === false) {
      throw error;
    }

    stream = await mediaDevices.getDisplayMedia({
      ...constraints,
      audio: false,
    });
  }

  if (stream.getVideoTracks().length === 0) {
    stopStream(stream);
    throw new Error('No video track was returned for the selected screen source.');
  }

  return stream;
}
