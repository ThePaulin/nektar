import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Square, Circle, X, Monitor, Layers, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Mic, Volume2, VolumeX, Settings } from 'lucide-react';

import {
  RecordingCompletePayload,
  RecordingAudioSource,
  RecordingOverlayRect,
  RecordingProgressPayload,
  RecordingSource,
  RecordingStartPayload,
  TrackType,
} from '../types';
import {
  CameraStreamOptions,
  DisplaySourceOption,
  describeMediaPermissionError,
  listDisplaySources,
  listRecordingDevices,
  MediaAccessStatus,
  RecordingDeviceOption,
  requestCameraStream,
  requestMicrophoneStream,
  ScreenStreamOptions,
  requestScreenStream,
} from '../lib/media-permissions';

interface RecorderProps {
  onRecordingComplete: (payload: RecordingCompletePayload) => void;
  onStartRecording?: (payload: RecordingStartPayload) => void;
  onStopRecording?: () => void;
  onRecordingProgress?: (payload: RecordingProgressPayload) => void;
  onRecordingPause?: () => void;
  onRecordingResume?: () => void;
  onClose?: () => void;
  isActive?: boolean;
  isArmed?: boolean;
  trackType?: TrackType;
}

type OverlayX = 'left' | 'right';
type OverlayY = 'top' | 'center' | 'bottom';

interface RecordingAudioConfig {
  enabled: boolean;
  muted: boolean;
  volume: number;
  warning: string | null;
}

function getSelectedDeviceId<T extends { deviceId: string }>(current: string, devices: T[]) {
  if (current && devices.some((device) => device.deviceId === current)) return current;
  return devices[0]?.deviceId || '';
}

function getSelectedSourceId<T extends { id: string }>(current: string, sources: T[]) {
  if (current && sources.some((source) => source.id === current)) return current;
  return sources[0]?.id || '';
}

export const Recorder: React.FC<RecorderProps> = ({
  onRecordingComplete,
  onStartRecording,
  onStopRecording,
  onRecordingProgress,
  onRecordingPause,
  onRecordingResume,
  onClose,
  isActive = true,
  isArmed = true,
  trackType,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [systemAudioStream, setSystemAudioStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const systemAudioStreamRef = useRef<MediaStream | null>(null);
  const isRecordingRef = useRef(false);
  const isPausedRef = useRef(false);
  const recordingSourceRef = useRef<RecordingSource>(trackType === TrackType.SCREEN ? 'screen' : 'camera');
  const [recordingSource, setRecordingSource] = useState<RecordingSource>(trackType === TrackType.SCREEN ? 'screen' : 'camera');
  const [overlayX, setOverlayX] = useState<OverlayX>('right');
  const [overlayY, setOverlayY] = useState<OverlayY>('bottom');
  const [recordingTime, setRecordingTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recordersRef = useRef<{ source: RecordingSource, recorder: MediaRecorder, chunks: Blob[] }[]>([]);
  const startTimeRef = useRef<number>(0);
  const accumulatedTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recordingAudioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const compositionFrameRef = useRef<number | null>(null);
  const cameraRestartTimerRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const partialUrlsRef = useRef<Partial<Record<RecordingSource, string>>>({});
  const livePreviewStreamsRef = useRef<Partial<Record<RecordingSource, MediaStream>>>({});
  const [audioLevel, setAudioLevel] = useState(0);
  const [cameraDevices, setCameraDevices] = useState<RecordingDeviceOption[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<RecordingDeviceOption[]>([]);
  const [displaySources, setDisplaySources] = useState<DisplaySourceOption[]>([]);
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState('');
  const [selectedMicrophoneDeviceId, setSelectedMicrophoneDeviceId] = useState('');
  const [selectedDisplaySourceId, setSelectedDisplaySourceId] = useState('');
  const [microphoneConfig, setMicrophoneConfig] = useState<RecordingAudioConfig>({
    enabled: true,
    muted: false,
    volume: 1,
    warning: null,
  });
  const [systemAudioConfig, setSystemAudioConfig] = useState<RecordingAudioConfig>({
    enabled: false,
    muted: false,
    volume: 1,
    warning: null,
  });
  const [screenAccessStatus, setScreenAccessStatus] = useState<MediaAccessStatus>('unknown');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const isMacOS = /mac/i.test(navigator.userAgent);

  const onRecordingCompleteRef = useRef(onRecordingComplete);
  const onStartRecordingRef = useRef(onStartRecording);
  const onStopRecordingRef = useRef(onStopRecording);
  const onRecordingProgressRef = useRef(onRecordingProgress);
  const onRecordingPauseRef = useRef(onRecordingPause);
  const onRecordingResumeRef = useRef(onRecordingResume);

  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete;
    onStartRecordingRef.current = onStartRecording;
    onStopRecordingRef.current = onStopRecording;
    onRecordingProgressRef.current = onRecordingProgress;
    onRecordingPauseRef.current = onRecordingPause;
    onRecordingResumeRef.current = onRecordingResume;
  }, [onRecordingComplete, onStartRecording, onStopRecording, onRecordingProgress, onRecordingPause, onRecordingResume]);

  useEffect(() => {
    cameraStreamRef.current = cameraStream;
  }, [cameraStream]);

  useEffect(() => {
    screenStreamRef.current = screenStream;
  }, [screenStream]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    recordingSourceRef.current = recordingSource;
  }, [recordingSource]);

  useEffect(() => {
    microphoneStreamRef.current = microphoneStream;
  }, [microphoneStream]);

  useEffect(() => {
    systemAudioStreamRef.current = systemAudioStream;
  }, [systemAudioStream]);

  const revokePartialUrls = useCallback(() => {
    (Object.values(partialUrlsRef.current) as Array<string | undefined>).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    partialUrlsRef.current = {};
  }, []);

  const stopStreams = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
      setCameraStream(null);
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
      microphoneStreamRef.current = null;
      setMicrophoneStream(null);
    }
    if (systemAudioStreamRef.current) {
      systemAudioStreamRef.current.getTracks().forEach(track => track.stop());
      systemAudioStreamRef.current = null;
      setSystemAudioStream(null);
    }
  }, []);

  const stopScreenStream = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    if (systemAudioStreamRef.current) {
      systemAudioStreamRef.current.getTracks().forEach(track => track.stop());
      systemAudioStreamRef.current = null;
      setSystemAudioStream(null);
    }
  }, []);

  const refreshDeviceLists = useCallback(async () => {
    const [recordingDevicesResult, displaySourcesResult] = await Promise.allSettled([
      listRecordingDevices(),
      listDisplaySources(),
    ]);

    if (recordingDevicesResult.status === 'fulfilled') {
      const { cameras, microphones } = recordingDevicesResult.value;
      setCameraDevices(cameras);
      setMicrophoneDevices(microphones);
      setSelectedCameraDeviceId((current) => getSelectedDeviceId(current, cameras));
      setSelectedMicrophoneDeviceId((current) => getSelectedDeviceId(current, microphones));
    } else {
      console.error("Error listing recording devices:", recordingDevicesResult.reason);
    }

    if (displaySourcesResult.status === 'fulfilled') {
      const sources = displaySourcesResult.value;
      setDisplaySources(sources);
      setSelectedDisplaySourceId((current) => getSelectedSourceId(current, sources));
    } else {
      console.error("Error listing display sources:", displaySourcesResult.reason);
    }
  }, []);

  const refreshScreenAccessStatus = useCallback(async () => {
    const desktopSystem = window.nektarDesktop?.desktopSystem;
    if (!desktopSystem?.getScreenAccessStatus) {
      return 'unknown' as MediaAccessStatus;
    }

    try {
      const status = await desktopSystem.getScreenAccessStatus();
      const hasLiveScreenCapture = !!screenStreamRef.current?.getVideoTracks().some((track) => track.readyState !== 'ended');
      if (hasLiveScreenCapture && (status === 'denied' || status === 'restricted')) {
        setScreenAccessStatus('granted');
        return 'granted' as MediaAccessStatus;
      }

      setScreenAccessStatus(status);
      return status;
    } catch (err) {
      console.error("Error checking screen access status:", err);
      return 'unknown' as MediaAccessStatus;
    }
  }, []);

  const stopAudioVisualizer = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    analyserRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setAudioLevel(0);
  }, []);

  const stopMicrophoneStream = useCallback(() => {
    if (!microphoneStreamRef.current) return;
    microphoneStreamRef.current.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
    setMicrophoneStream(null);
    stopAudioVisualizer();
  }, [stopAudioVisualizer]);

  const stopCameraStream = useCallback(() => {
    if (!cameraStreamRef.current) return;
    const stream = cameraStreamRef.current;

    if (videoRef.current?.srcObject === stream) {
      videoRef.current.srcObject = null;
      videoRef.current.load();
    }

    stream.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    stopAudioVisualizer();
  }, [stopAudioVisualizer]);

  const startAudioVisualizer = useCallback((stream: MediaStream) => {
    stopAudioVisualizer();

    if (stream.getAudioTracks().length === 0) {
      return;
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const updateVisualizer = () => {
      if (analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(average / 128);
      }
      animationFrameRef.current = requestAnimationFrame(updateVisualizer);
    };
    updateVisualizer();
  }, [stopAudioVisualizer]);

  const playPreview = async (video: HTMLVideoElement | null) => {
    if (!video) return;

    try {
      await video.play();
    } catch {
      // Muted local previews can still fail in headless tests or unfocused tabs.
    }
  };

  const setupCamera = async (options: CameraStreamOptions = {}) => {
    try {
      setCameraError(null);

      const stream = await requestCameraStream({
        cameraDeviceId: options.cameraDeviceId ?? selectedCameraDeviceId,
      });
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.load();
        await playPreview(videoRef.current);
      }

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        cameraStreamRef.current = null;
        setCameraStream(null);
      });

      void refreshDeviceLists();
      return true;
    } catch (err) {
      console.error("Error accessing camera:", err);
      setCameraError(describeMediaPermissionError(err, 'camera'));
      return false;
    }
  };

  const setupMicrophone = async (deviceId = selectedMicrophoneDeviceId, forceEnabled = false) => {
    if (!forceEnabled && !microphoneConfig.enabled) return false;

    try {
      setMicrophoneConfig((current) => ({ ...current, warning: null }));
      const stream = await requestMicrophoneStream({ microphoneDeviceId: deviceId });
      microphoneStreamRef.current = stream;
      setMicrophoneStream(stream);
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        microphoneStreamRef.current = null;
        setMicrophoneStream(null);
        stopAudioVisualizer();
      });
      startAudioVisualizer(stream);
      void refreshDeviceLists();
      return true;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setMicrophoneConfig((current) => ({
        ...current,
        warning: describeMediaPermissionError(err, 'microphone'),
      }));
      return false;
    }
  };

  const setupScreen = async (options: ScreenStreamOptions = {}) => {
    try {
      await refreshScreenAccessStatus();
      setScreenError(null);
      setSystemAudioConfig((current) => ({ ...current, warning: null }));

      const result = await requestScreenStream(isMacOS, {
        displaySourceId: options.displaySourceId ?? selectedDisplaySourceId,
        includeSystemAudio: options.includeSystemAudio ?? systemAudioConfig.enabled,
      });
      const stream = result.videoStream;

      setScreenAccessStatus('granted');
      setScreenError(null);
      screenStreamRef.current = stream;
      setScreenStream(stream);
      if (systemAudioStreamRef.current) {
        systemAudioStreamRef.current.getTracks().forEach(track => track.stop());
      }
      systemAudioStreamRef.current = result.systemAudioStream ?? null;
      setSystemAudioStream(result.systemAudioStream ?? null);
      setSystemAudioConfig((current) => ({
        ...current,
        warning: result.systemAudioWarning ?? null,
      }));
      void refreshDeviceLists();
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await playPreview(screenVideoRef.current);
      }
      stream.getVideoTracks()[0].onended = () => {
        if (isRecordingRef.current || isPausedRef.current) {
          setScreenError(null);
          return;
        }

        screenStreamRef.current = null;
        setScreenStream(null);
        if (systemAudioStreamRef.current) {
          systemAudioStreamRef.current.getTracks().forEach(track => track.stop());
          systemAudioStreamRef.current = null;
          setSystemAudioStream(null);
        }
        setScreenError(null);
        if (recordingSourceRef.current === 'screen' || recordingSourceRef.current === 'overlay') {
          setRecordingSource('camera');
        }
      };
      return true;
    } catch (err) {
      console.error("Error accessing screen:", err);
      setScreenError(describeMediaPermissionError(err, 'screen'));
      await refreshScreenAccessStatus();
      return false;
    }
  };

  useEffect(() => {
    const workerCode = `
      let timer = null;
      self.onmessage = (e) => {
        if (e.data.action === 'start') {
          if (timer) clearInterval(timer);
          timer = setInterval(() => {
            self.postMessage('tick');
          }, 1000 / e.data.fps);
        } else if (e.data.action === 'stop') {
          if (timer) clearInterval(timer);
          timer = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    workerRef.current = new Worker(workerUrl);

    return () => {
      if (cameraRestartTimerRef.current) {
        window.clearTimeout(cameraRestartTimerRef.current);
        cameraRestartTimerRef.current = null;
      }
      stopStreams();
      if (timerRef.current) clearInterval(timerRef.current);
      stopAudioVisualizer();
      if (recordingAudioContextRef.current) {
        void recordingAudioContextRef.current.close();
        recordingAudioContextRef.current = null;
      }
      if (compositionFrameRef.current) cancelAnimationFrame(compositionFrameRef.current);
      if (workerRef.current) {
        workerRef.current.postMessage({ action: 'stop' });
        workerRef.current.terminate();
      }
      revokePartialUrls();
      URL.revokeObjectURL(workerUrl);
    };
  }, [revokePartialUrls, stopAudioVisualizer, stopStreams]);

  const getOverlayRect = useCallback((): RecordingOverlayRect | undefined => {
    if (recordingSource !== 'overlay') return undefined;

    const width = 1920;
    const height = 1080;
    const overlaySize = 400;
    let x = 0;
    let y = 0;

    if (overlayX === 'left') x = 50;
    else x = width - overlaySize - 50;

    if (overlayY === 'top') y = 50;
    else if (overlayY === 'center') y = (height - overlaySize) / 2;
    else y = height - overlaySize - 50;

    return { x, y, width: overlaySize, height: overlaySize };
  }, [overlayX, overlayY, recordingSource]);

  const getElapsedDuration = useCallback(() => {
    if (isRecording) {
      return accumulatedTimeRef.current + (Date.now() - startTimeRef.current) / 1000;
    }
    return accumulatedTimeRef.current;
  }, [isRecording]);

  const emitRecordingProgress = useCallback(
    (activeSource: RecordingSource) => {
      const recordings = recordersRef.current.map((entry) => {
        const blob = new Blob(entry.chunks, { type: entry.recorder.mimeType || 'video/webm' });
        const currentUrl = partialUrlsRef.current[entry.source];
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        const url = URL.createObjectURL(blob);
        partialUrlsRef.current[entry.source] = url;

        let width;
        let height;
        if (entry.source === 'camera' && videoRef.current) {
          width = videoRef.current.videoWidth;
          height = videoRef.current.videoHeight;
        } else if (entry.source === 'screen' && screenVideoRef.current) {
          width = screenVideoRef.current.videoWidth;
          height = screenVideoRef.current.videoHeight;
        } else if (entry.source === 'overlay') {
          width = 1920;
          height = 1080;
        }

        return {
          source: entry.source,
          url,
          blob,
          width,
          height,
        };
      });

      onRecordingProgressRef.current?.({
        duration: getElapsedDuration(),
        source: activeSource,
        overlayRect: getOverlayRect(),
        recordings,
        liveSources: [
          ...(cameraStream ? [{ source: 'camera' as RecordingSource, stream: cameraStream }] : []),
          ...(screenStream ? [{ source: 'screen' as RecordingSource, stream: screenStream }] : []),
          ...(activeSource === 'overlay' && livePreviewStreamsRef.current.overlay ? [{ source: 'overlay' as RecordingSource, stream: livePreviewStreamsRef.current.overlay }] : []),
        ],
      });
    },
    [cameraStream, getElapsedDuration, getOverlayRect, screenStream],
  );

  useEffect(() => {
    void refreshDeviceLists();
    refreshScreenAccessStatus();

    const handleWindowFocus = () => {
      void refreshScreenAccessStatus();
      void refreshDeviceLists();
    };
    const handleDeviceChange = () => {
      void refreshDeviceLists();
    };

    window.addEventListener('focus', handleWindowFocus);
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, [refreshDeviceLists, refreshScreenAccessStatus]);

  const takePhoto = () => {
    if (!videoRef.current && !screenVideoRef.current && !canvasRef.current) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 1280;
    let height = 720;

    if (recordingSource === 'overlay' && canvasRef.current) {
      width = canvasRef.current.width;
      height = canvasRef.current.height;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(canvasRef.current, 0, 0);
    } else if (recordingSource === 'camera' && videoRef.current) {
      width = videoRef.current.videoWidth;
      height = videoRef.current.videoHeight;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(videoRef.current, 0, 0);
    } else if (recordingSource === 'screen' && screenVideoRef.current) {
      width = screenVideoRef.current.videoWidth;
      height = screenVideoRef.current.videoHeight;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(screenVideoRef.current, 0, 0);
    }

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        onRecordingCompleteRef.current({
          duration: 5,
          source: recordingSource,
          recordings: [{ source: recordingSource, url, blob, width, height }],
        });
      }
    }, 'image/png');
  };

  const closeRecordingAudioContext = () => {
    if (recordingAudioContextRef.current) {
      void recordingAudioContextRef.current.close();
      recordingAudioContextRef.current = null;
    }
  };

  const getAudioGain = (source: RecordingAudioSource) => {
    const config = source === 'microphone' ? microphoneConfig : systemAudioConfig;
    if (!config.enabled) return null;
    return config.muted ? 0 : config.volume;
  };

  const createMixedAudioTrack = () => {
    closeRecordingAudioContext();

    const audioSources: Array<{ stream: MediaStream; source: RecordingAudioSource; gain: number }> = [];
    const microphoneGain = getAudioGain('microphone');
    const systemGain = getAudioGain('system');

    if (microphoneGain !== null && microphoneStreamRef.current?.getAudioTracks().length) {
      audioSources.push({ stream: microphoneStreamRef.current, source: 'microphone', gain: microphoneGain });
    }

    if (systemGain !== null && systemAudioStreamRef.current?.getAudioTracks().length) {
      audioSources.push({ stream: systemAudioStreamRef.current, source: 'system', gain: systemGain });
    }

    if (audioSources.length === 0) return null;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();

      audioSources.forEach(({ stream, gain }) => {
        const sourceNode = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        const gainNode = audioContext.createGain();
        gainNode.gain.value = gain;
        sourceNode.connect(gainNode);
        gainNode.connect(destination);
      });

      recordingAudioContextRef.current = audioContext;
      return destination.stream.getAudioTracks()[0] ?? null;
    } catch (err) {
      console.error("Error mixing recording audio:", err);
      return audioSources.find((entry) => entry.gain > 0)?.stream.getAudioTracks()[0] ?? null;
    }
  };

  const createRecordingStream = (videoStream: MediaStream) => {
    const mixedAudioTrack = createMixedAudioTrack();
    return new MediaStream([
      ...videoStream.getVideoTracks(),
      ...(mixedAudioTrack ? [mixedAudioTrack] : []),
    ]);
  };

  const startRecording = () => {
    if (trackType === TrackType.IMAGE) {
      takePhoto();
      return;
    }
    let streamToRecord: MediaStream | null = null;

    if (recordingSource === 'camera') {
      streamToRecord = cameraStream ? createRecordingStream(cameraStream) : null;
      if (cameraStream) livePreviewStreamsRef.current.camera = cameraStream;
    } else if (recordingSource === 'screen') {
      streamToRecord = screenStream ? createRecordingStream(screenStream) : null;
      if (screenStream) livePreviewStreamsRef.current.screen = screenStream;
    } else if (recordingSource === 'overlay') {
      if (!canvasRef.current || !videoRef.current || !screenVideoRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = 1920;
      const height = 1080;
      canvas.width = width;
      canvas.height = height;

      const drawOverlay = () => {
        if (!screenVideoRef.current || !videoRef.current || !ctx) return;

        // Ensure videos are playing even in background
        if (screenVideoRef.current.paused) screenVideoRef.current.play().catch(() => {});
        if (videoRef.current.paused) videoRef.current.play().catch(() => {});

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // Draw screen with object-fit: contain logic
        const screenWidth = screenVideoRef.current.videoWidth;
        const screenHeight = screenVideoRef.current.videoHeight;
        if (screenWidth > 0 && screenHeight > 0) {
          const screenRatio = screenWidth / screenHeight;
          const canvasRatio = width / height;
          
          let drawWidth, drawHeight, dx, dy;
          if (screenRatio > canvasRatio) {
            drawWidth = width;
            drawHeight = width / screenRatio;
            dx = 0;
            dy = (height - drawHeight) / 2;
          } else {
            drawHeight = height;
            drawWidth = height * screenRatio;
            dx = (width - drawWidth) / 2;
            dy = 0;
          }
          ctx.drawImage(screenVideoRef.current, dx, dy, drawWidth, drawHeight);
        }

        // Draw camera overlay (400x400 square)
        const overlaySize = 400;
        let x = 0;
        let y = 0;

        if (overlayX === 'left') x = 50;
        else x = width - overlaySize - 50;

        if (overlayY === 'top') y = 50;
        else if (overlayY === 'center') y = (height - overlaySize) / 2;
        else y = height - overlaySize - 50;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, overlaySize, overlaySize);
        ctx.clip();
        
        // Center crop the camera video
        const camWidth = videoRef.current.videoWidth;
        const camHeight = videoRef.current.videoHeight;
        if (camWidth > 0 && camHeight > 0) {
          const minDim = Math.min(camWidth, camHeight);
          const sx = (camWidth - minDim) / 2;
          const sy = (camHeight - minDim) / 2;
          ctx.drawImage(videoRef.current, sx, sy, minDim, minDim, x, y, overlaySize, overlaySize);
        }
        ctx.restore();

        // Only use requestAnimationFrame if not using worker
        if (!workerRef.current) {
          compositionFrameRef.current = requestAnimationFrame(drawOverlay);
        }
      };

      if (workerRef.current) {
        workerRef.current.onmessage = (e) => {
          if (e.data === 'tick') drawOverlay();
        };
        workerRef.current.postMessage({ action: 'start', fps: 30 });
      } else {
        drawOverlay();
      }
      
      const canvasStream = canvas.captureStream(30);
      const mixedAudioTrack = createMixedAudioTrack();
      if (mixedAudioTrack) canvasStream.addTrack(mixedAudioTrack);
      
      streamToRecord = canvasStream;
      livePreviewStreamsRef.current.overlay = canvasStream;
    }

    const startStreamRecorder = (stream: MediaStream, source: RecordingSource) => {
      const mimeTypes = [
        'video/mp4;codecs="avc1.640028"',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
          emitRecordingProgress(recordingSource);
        }
      };

      recordersRef.current.push({ source, recorder, chunks });
      recorder.start(500);
    };

    revokePartialUrls();
    recordersRef.current = [];
    if (recordingSource === 'overlay') {
      if (cameraStream) startStreamRecorder(cameraStream, 'camera');
      if (screenStream) startStreamRecorder(screenStream, 'screen');
      if (streamToRecord) startStreamRecorder(streamToRecord, 'overlay');
    } else {
      if (streamToRecord) startStreamRecorder(streamToRecord, recordingSource);
    }

    // Setup onstop for all recorders
    let stoppedCount = 0;
    recordersRef.current.forEach(item => {
      item.recorder.onstop = () => {
        stoppedCount++;
        if (stoppedCount === recordersRef.current.length) {
          const recordings = recordersRef.current.map(r => {
            const blob = new Blob(r.chunks, { type: r.recorder.mimeType || 'video/mp4' });
            let width, height;
            if (r.source === 'camera' && videoRef.current) {
              width = videoRef.current.videoWidth;
              height = videoRef.current.videoHeight;
            } else if (r.source === 'screen' && screenVideoRef.current) {
              width = screenVideoRef.current.videoWidth;
              height = screenVideoRef.current.videoHeight;
            } else if (r.source === 'overlay') {
              width = 1920;
              height = 1080;
            }
            return {
              source: r.source,
              blob,
              url: URL.createObjectURL(blob),
              width,
              height
            };
          });

          onRecordingCompleteRef.current(
            {
              duration: accumulatedTimeRef.current,
              source: recordingSource,
              overlayRect: getOverlayRect(),
              recordings,
            }
          );
          if (compositionFrameRef.current) cancelAnimationFrame(compositionFrameRef.current);
          if (workerRef.current) workerRef.current.postMessage({ action: 'stop' });
          closeRecordingAudioContext();
        }
      };
    });

    setIsRecording(true);
    setIsPaused(false);
    setRecordingTime(0);
    accumulatedTimeRef.current = 0;
    startTimeRef.current = Date.now();
    onStartRecordingRef.current?.({
      source: recordingSource,
      overlayRect: getOverlayRect(),
      liveSources: [
        ...(cameraStream ? [{ source: 'camera' as RecordingSource, stream: cameraStream }] : []),
        ...(screenStream ? [{ source: 'screen' as RecordingSource, stream: screenStream }] : []),
        ...(recordingSource === 'overlay' && streamToRecord ? [{ source: 'overlay' as RecordingSource, stream: streamToRecord }] : []),
      ],
    });

    timerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setRecordingTime(accumulatedTimeRef.current + elapsed);
    }, 100);
  };

  const stopRecording = () => {
    if (recordersRef.current.length > 0 && (isRecording || isPaused)) {
      if (isRecording) {
        accumulatedTimeRef.current += (Date.now() - startTimeRef.current) / 1000;
      }
      onStopRecordingRef.current?.();
      recordersRef.current.forEach(r => r.recorder.stop());
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const pauseRecording = () => {
    if (recordersRef.current.length > 0 && isRecording && !isPaused) {
      recordersRef.current.forEach(r => r.recorder.pause());
      accumulatedTimeRef.current += (Date.now() - startTimeRef.current) / 1000;
      setIsPaused(true);
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      onRecordingPauseRef.current?.();
    }
  };

  const resumeRecording = () => {
    if (recordersRef.current.length > 0 && isPaused) {
      recordersRef.current.forEach(r => r.recorder.resume());
      setIsPaused(false);
      setIsRecording(true);
      startTimeRef.current = Date.now();
      onRecordingResumeRef.current?.();

      timerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setRecordingTime(accumulatedTimeRef.current + elapsed);
      }, 100);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      const key = e.key.toLowerCase();
      if (key === 'r') {
        e.preventDefault();
        if (e.shiftKey) {
          if (isRecording) pauseRecording();
          else if (isPaused) resumeRecording();
        } else {
          if (isRecording || isPaused) {
            stopRecording();
          } else {
            startRecording();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, isPaused, cameraStream, screenStream, microphoneStream, systemAudioStream, microphoneConfig, systemAudioConfig, recordingSource, isActive]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const needsScreenSettings =
    (recordingSource === 'screen' || recordingSource === 'overlay') &&
    (screenAccessStatus === 'denied' || screenAccessStatus === 'restricted') &&
    !!screenError;

  const isMissingRequiredStream =
    (recordingSource === 'camera' && !cameraStream) ||
    (recordingSource === 'screen' && !screenStream) ||
    (recordingSource === 'overlay' && (!cameraStream || !screenStream));
  const isRecordingActive = isRecording || isPaused;
  const shouldShowPermissionOverlay = isMissingRequiredStream && !isRecordingActive;

  const handleGrantAccess = async () => {
    setIsRequestingAccess(true);

    if ((recordingSource === 'screen' || recordingSource === 'overlay') && !screenStream) {
      if (needsScreenSettings) {
        await window.nektarDesktop?.desktopSystem?.openScreenRecordingSettings?.();
        setIsRequestingAccess(false);
        return;
      }

      const grantedScreen = await setupScreen();
      if (!grantedScreen) {
        setIsRequestingAccess(false);
        return;
      }
    }

    if ((recordingSource === 'camera' || recordingSource === 'overlay') && !cameraStream) {
      await setupCamera();
    }

    if (microphoneConfig.enabled && !microphoneStreamRef.current) {
      await setupMicrophone();
    }

    setIsRequestingAccess(false);
  };

  useEffect(() => {
    if (!isSettingsPanelOpen) return;

    const handleSettingsKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSettingsPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleSettingsKeyDown);
    return () => window.removeEventListener('keydown', handleSettingsKeyDown);
  }, [isSettingsPanelOpen]);

  useEffect(() => {
    if (isRecording) setIsSettingsPanelOpen(false);
  }, [isRecording]);

  const selectRecordingSource = (source: RecordingSource) => {
    setRecordingSource(source);

    if (source === 'camera' && !cameraStream) {
      void (async () => {
        const grantedCamera = await setupCamera();
        if (grantedCamera && microphoneConfig.enabled && !microphoneStreamRef.current) {
          await setupMicrophone();
        }
      })();
      return;
    }

    if (source === 'screen' && !screenStream) {
      void (async () => {
        const grantedScreen = await setupScreen();
        if (grantedScreen && microphoneConfig.enabled && !microphoneStreamRef.current) {
          await setupMicrophone();
        }
      })();
      return;
    }

    if (source === 'overlay') {
      void (async () => {
        if (!screenStream) {
          const grantedScreen = await setupScreen();
          if (!grantedScreen) return;
        }

        if (!cameraStream) {
          const grantedCamera = await setupCamera();
          if (grantedCamera && microphoneConfig.enabled && !microphoneStreamRef.current) {
            await setupMicrophone();
          }
        } else if (microphoneConfig.enabled && !microphoneStreamRef.current) {
          await setupMicrophone();
        }
      })();
    }
  };

  const handleCameraDeviceChange = (deviceId: string) => {
    setSelectedCameraDeviceId(deviceId);
    if (isRecording || isPaused) return;
    if (!cameraStream || (recordingSource !== 'camera' && recordingSource !== 'overlay')) return;

    stopCameraStream();
    // Give USB/UVC hardware time to close the previous capture session before
    // opening the newly selected device. Reopening in the same task can yield a
    // live-but-black track on devices such as the DJI Osmo Pocket 3.
    if (cameraRestartTimerRef.current) window.clearTimeout(cameraRestartTimerRef.current);
    cameraRestartTimerRef.current = window.setTimeout(() => {
      cameraRestartTimerRef.current = null;
      void setupCamera({ cameraDeviceId: deviceId });
    }, 250);
  };

  const handleMicrophoneDeviceChange = (deviceId: string) => {
    setSelectedMicrophoneDeviceId(deviceId);
    if (isRecording || isPaused) return;

    stopMicrophoneStream();
    if (microphoneConfig.enabled) {
      void setupMicrophone(deviceId);
    }
  };

  const handleDisplaySourceChange = (sourceId: string) => {
    setSelectedDisplaySourceId(sourceId);
    if (isRecording || isPaused) return;
    if (!screenStream || (recordingSource !== 'screen' && recordingSource !== 'overlay')) return;

    stopScreenStream();
    void setupScreen({ displaySourceId: sourceId });
  };

  const handleMicrophoneEnabledChange = (enabled: boolean) => {
    setMicrophoneConfig((current) => ({ ...current, enabled, warning: null }));
    if (isRecording || isPaused) return;

    if (!enabled) {
      stopMicrophoneStream();
      return;
    }

    void setupMicrophone(selectedMicrophoneDeviceId, true);
  };

  const handleSystemAudioEnabledChange = (enabled: boolean) => {
    setSystemAudioConfig((current) => ({ ...current, enabled, warning: null }));
    if (isRecording || isPaused) return;

    if (!enabled) {
      if (systemAudioStreamRef.current) {
        systemAudioStreamRef.current.getTracks().forEach(track => track.stop());
        systemAudioStreamRef.current = null;
        setSystemAudioStream(null);
      }
      return;
    }

    if (screenStreamRef.current && (recordingSource === 'screen' || recordingSource === 'overlay')) {
      stopScreenStream();
      void setupScreen({ includeSystemAudio: true });
    }
  };

  const canEditDevices = !isRecording && !isPaused && !isRequestingAccess;
  const showCameraSelector = recordingSource === 'camera' || recordingSource === 'overlay';
  const showDisplaySelector = recordingSource === 'screen' || recordingSource === 'overlay';
  const hasDesktopDisplaySourcePicker = !!window.nektarDesktop?.desktopSystem?.listDisplaySources && displaySources.length > 0;

  return (
    <div className="relative w-fit h-full max-h-[400px] flex flex-col bg-[#111] border border-white/10 shadow-2xl overflow-hidden rounded-xl min-h-0">
      {/* Video Preview */}
      <div className="h-full w-fit aspect-video relative bg-black flex items-center justify-center min-h-0 overflow-hidden">
        {/* Header */}
        <div className="absolute h-10 bg-gradient-to-b from-black/60 to-transparent top-0 left-0 right-0 z-[60] flex items-center justify-between px-3">
          <div className="flex items-center space-x-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-[9px] font-bold text-white uppercase tracking-wider">
              {isRecording ? 'Recording' : recordingSource === 'camera' ? 'Camera' : recordingSource === 'screen' ? 'Screen' : 'Overlay'}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {!isRecording && (
              <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
                <button
                  onClick={() => selectRecordingSource('camera')}
                  className={`p-1 rounded-md transition-colors ${recordingSource === 'camera' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  title="Camera Only"
                >
                  <Camera size={12} />
                </button>
                <button
                  onClick={() => selectRecordingSource('screen')}
                  className={`p-1 rounded-md transition-colors ${recordingSource === 'screen' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  title="Screen Only"
                >
                  <Monitor size={12} />
                </button>
                <button
                  onClick={() => selectRecordingSource('overlay')}
                  className={`p-1 rounded-md transition-colors ${recordingSource === 'overlay' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  title="Overlay Mode"
                >
                  <Layers size={12} />
                </button>
              </div>
            )}
            {onClose && (
              <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="absolute top-11 left-3 z-[55] pointer-events-auto">
          <button
            type="button"
            aria-label="Recording settings"
            aria-expanded={isSettingsPanelOpen}
            onClick={() => setIsSettingsPanelOpen((current) => !current)}
            disabled={isRecording || isPaused}
            className={`rounded-md border border-white/10 p-1.5 text-white transition-colors disabled:opacity-50 ${isSettingsPanelOpen ? 'bg-blue-600' : 'bg-black/70 hover:bg-white/10'}`}
            title="Recording settings"
          >
            <Settings size={14} />
          </button>
        </div>

        {isSettingsPanelOpen && (
          <div className="absolute top-20 left-3 z-[56] w-[min(360px,calc(100%-24px))] max-h-[calc(100%-6.5rem)] overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-black/85 p-3 text-white shadow-2xl backdrop-blur-md pointer-events-auto [scrollbar-color:rgba(255,255,255,0.25)_transparent] [scrollbar-width:thin]">
            <div className="space-y-3">
              {(showCameraSelector || showDisplaySelector) && (
                <div className="space-y-2">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Video</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {showCameraSelector && (
                      <select
                        aria-label="Camera device"
                        title="Camera device"
                        value={selectedCameraDeviceId}
                        onChange={(event) => handleCameraDeviceChange(event.target.value)}
                        disabled={!canEditDevices}
                        className="min-w-0 max-w-[220px] bg-black/70 border border-white/10 rounded-md px-2 py-1 text-[10px] text-white outline-none disabled:opacity-50"
                      >
                        {cameraDevices.length === 0 ? (
                          <option value="">Camera</option>
                        ) : (
                          cameraDevices.map((device) => (
                            <option key={device.deviceId || device.label} value={device.deviceId}>
                              {device.label}
                            </option>
                          ))
                        )}
                      </select>
                    )}
                    {showDisplaySelector && hasDesktopDisplaySourcePicker && (
                      <select
                        aria-label="Screen source"
                        title="Screen source"
                        value={selectedDisplaySourceId}
                        onChange={(event) => handleDisplaySourceChange(event.target.value)}
                        disabled={!canEditDevices}
                        className="min-w-0 max-w-[240px] bg-black/70 border border-white/10 rounded-md px-2 py-1 text-[10px] text-white outline-none disabled:opacity-50"
                      >
                        {displaySources.length === 0 ? (
                          <option value="">Screen/window</option>
                        ) : (
                          displaySources.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.name}
                            </option>
                          ))
                        )}
                      </select>
                    )}
                    {showDisplaySelector && !hasDesktopDisplaySourcePicker && (
                      <button
                        type="button"
                        onClick={() => {
                          void setupScreen();
                        }}
                        disabled={!canEditDevices}
                        className="bg-black/70 border border-white/10 rounded-md px-2 py-1 text-[10px] text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                      >
                        Choose screen/window/tab...
                      </button>
                    )}
                  </div>
                </div>
              )}

              {trackType !== TrackType.IMAGE && (
                <div className="space-y-2 border-t border-white/10 pt-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Audio</div>
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-white">
                    <button
                      type="button"
                      onClick={() => handleMicrophoneEnabledChange(!microphoneConfig.enabled)}
                      disabled={!canEditDevices}
                      className={`p-1 rounded transition-colors disabled:opacity-50 ${microphoneConfig.enabled ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400'}`}
                      title={microphoneConfig.enabled ? 'Disable microphone audio' : 'Enable microphone audio'}
                    >
                      <Mic size={12} />
                    </button>
                    <select
                      aria-label="Microphone audio source"
                      title="Microphone audio source"
                      value={selectedMicrophoneDeviceId}
                      onChange={(event) => handleMicrophoneDeviceChange(event.target.value)}
                      disabled={!canEditDevices || !microphoneConfig.enabled}
                      className="min-w-0 max-w-[170px] bg-transparent text-[10px] text-white outline-none disabled:opacity-50"
                    >
                      {microphoneDevices.length === 0 ? (
                        <option value="">Microphone</option>
                      ) : (
                        microphoneDevices.map((device) => (
                          <option key={device.deviceId || device.label} value={device.deviceId}>
                            {device.label}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() => setMicrophoneConfig((current) => ({ ...current, muted: !current.muted }))}
                      disabled={!canEditDevices || !microphoneConfig.enabled}
                      className="p-1 rounded text-gray-300 hover:bg-white/10 disabled:opacity-50"
                      title={microphoneConfig.muted ? 'Unmute microphone' : 'Mute microphone'}
                    >
                      {microphoneConfig.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    </button>
                    <input
                      aria-label="Microphone audio level"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={microphoneConfig.volume}
                      onChange={(event) => setMicrophoneConfig((current) => ({ ...current, volume: Number(event.target.value) }))}
                      disabled={!canEditDevices || !microphoneConfig.enabled}
                      className="w-16 accent-blue-600 disabled:opacity-50"
                    />
                    <span className="w-8 text-right text-[9px] text-gray-400">{Math.round(microphoneConfig.volume * 100)}%</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-white">
                    <button
                      type="button"
                      onClick={() => handleSystemAudioEnabledChange(!systemAudioConfig.enabled)}
                      disabled={!canEditDevices}
                      className={`p-1 rounded transition-colors disabled:opacity-50 ${systemAudioConfig.enabled ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400'}`}
                      title={systemAudioConfig.enabled ? 'Disable system audio' : 'Enable system audio'}
                    >
                      <Monitor size={12} />
                    </button>
                    <span className="text-[10px] font-medium text-gray-200">System audio</span>
                    <button
                      type="button"
                      onClick={() => setSystemAudioConfig((current) => ({ ...current, muted: !current.muted }))}
                      disabled={!canEditDevices || !systemAudioConfig.enabled || !systemAudioStream}
                      className="p-1 rounded text-gray-300 hover:bg-white/10 disabled:opacity-50"
                      title={systemAudioConfig.muted ? 'Unmute system audio' : 'Mute system audio'}
                    >
                      {systemAudioConfig.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    </button>
                    <input
                      aria-label="System audio level"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={systemAudioConfig.volume}
                      onChange={(event) => setSystemAudioConfig((current) => ({ ...current, volume: Number(event.target.value) }))}
                      disabled={!canEditDevices || !systemAudioConfig.enabled || !systemAudioStream}
                      className="w-16 accent-blue-600 disabled:opacity-50"
                    />
                    <span className="w-8 text-right text-[9px] text-gray-400">{Math.round(systemAudioConfig.volume * 100)}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hidden Canvas for Composition */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Video Elements */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`
            ${recordingSource === 'camera' ? 'w-full h-full object-cover' : ''}
            ${recordingSource === 'screen' ? 'hidden' : ''}
            ${recordingSource === 'overlay' ? 'absolute z-30 w-1/4 aspect-square object-cover border-2 border-blue-500 rounded-lg shadow-xl' : ''}
            ${recordingSource === 'overlay' && overlayX === 'left' ? 'left-4' : ''}
            ${recordingSource === 'overlay' && overlayX === 'right' ? 'right-4' : ''}
            ${recordingSource === 'overlay' && overlayY === 'top' ? 'top-12' : ''}
            ${recordingSource === 'overlay' && overlayY === 'center' ? 'top-1/2 -translate-y-1/2' : ''}
            ${recordingSource === 'overlay' && overlayY === 'bottom' ? 'bottom-16' : ''}
          `}
        />
        <video
          ref={screenVideoRef}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-contain ${recordingSource === 'camera' ? 'hidden' : ''}`}
        />

        {/* Permission Overlay */}
        {shouldShowPermissionOverlay && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/30">
              {recordingSource === 'camera' ? <Camera size={24} className="text-blue-400" /> : <Monitor size={24} className="text-blue-400" />}
            </div>
            <h3 className="text-sm font-bold text-white mb-2">Permissions Required</h3>
            <p className="text-[10px] text-gray-400 max-w-[200px] mb-4">
              We need access to your {recordingSource === 'camera' ? 'camera and microphone' : recordingSource === 'screen' ? 'screen' : 'camera, microphone, and screen'} to start recording.
            </p>
            {needsScreenSettings && (
              <p className="text-[10px] text-amber-300 max-w-[220px] mb-4">
                Enable Screen Recording for Nektar in System Settings, then fully quit and reopen the app.
              </p>
            )}
            {cameraError && (recordingSource === 'camera' || recordingSource === 'overlay') && (
              <p className="text-[10px] text-rose-300 max-w-[240px] mb-4">
                {cameraError}
              </p>
            )}
            {screenError && !needsScreenSettings && (
              <p className="text-[10px] text-rose-300 max-w-[240px] mb-4">
                {screenError}
              </p>
            )}
            <button
              onClick={() => {
                void handleGrantAccess();
              }}
              disabled={isRequestingAccess}
              className={`px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-600/20 ${isRequestingAccess ? 'opacity-60 cursor-wait' : 'hover:bg-blue-500'}`}
            >
              {isRequestingAccess ? 'Requesting...' : needsScreenSettings ? 'Open Screen Settings' : 'Grant Access'}
            </button>
          </div>
        )}

        {/* Overlay Controls */}
        {!isRecording && recordingSource === 'overlay' && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center space-y-2 bg-black/60 p-2 rounded-xl backdrop-blur-md border border-white/10">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1">
                <button onClick={() => setOverlayX('left')} className={`p-1 rounded ${overlayX === 'left' ? 'bg-blue-600' : 'bg-white/10'}`}><ChevronLeft size={12} /></button>
                <button onClick={() => setOverlayX('right')} className={`p-1 rounded ${overlayX === 'right' ? 'bg-blue-600' : 'bg-white/10'}`}><ChevronRight size={12} /></button>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center space-x-1">
                <button onClick={() => setOverlayY('top')} className={`p-1 rounded ${overlayY === 'top' ? 'bg-blue-600' : 'bg-white/10'}`}><ChevronUp size={12} /></button>
                <button onClick={() => setOverlayY('center')} className={`p-1 rounded ${overlayY === 'center' ? 'bg-blue-600' : 'bg-white/10'}`}><div className="w-3 h-3 border border-current rounded-sm" /></button>
                <button onClick={() => setOverlayY('bottom')} className={`p-1 rounded ${overlayY === 'bottom' ? 'bg-blue-600' : 'bg-white/10'}`}><ChevronDown size={12} /></button>
              </div>
            </div>
            <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Overlay Position</span>
          </div>
        )}

        {/* Audio Level Overlay */}
        <div className="absolute bottom-3 left-3 z-40 flex space-x-0.5 h-8 items-end bg-black/40 p-1.5 rounded-lg backdrop-blur-md border border-white/10">
          {[...Array(8)].map((_, i) => {
            const level = i / 8;
            const isActive = audioLevel > level;
            return (
              <div
                key={i}
                className={`w-1 rounded-full transition-all duration-75 ${isActive
                  ? i > 6 ? 'bg-red-500' : i > 4 ? 'bg-yellow-500' : 'bg-emerald-500'
                  : 'bg-white/10'
                  }`}
                style={{ height: isActive ? `${20 + audioLevel * 80}%` : '3px' }}
              />
            );
          })}
        </div>

        {microphoneConfig.warning && !shouldShowPermissionOverlay && (
          <div className="absolute bottom-3 right-3 z-40 max-w-[220px] bg-amber-950/80 px-2 py-1 rounded-md border border-amber-500/30 text-[9px] text-amber-100">
            {microphoneConfig.warning}
          </div>
        )}

        {systemAudioConfig.warning && !shouldShowPermissionOverlay && (
          <div className="absolute bottom-12 right-3 z-40 max-w-[240px] bg-amber-950/80 px-2 py-1 rounded-md border border-amber-500/30 text-[9px] text-amber-100">
            {systemAudioConfig.warning}
          </div>
        )}

        {(isRecording || isPaused) && (
          <div className="absolute top-3 right-3 z-40 bg-black/60 px-2 py-0.5 rounded-md backdrop-blur-md border border-white/10">
            <span className="text-xs font-mono font-bold text-white tabular-nums">
              {formatDuration(recordingTime)}
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 right-0 h-12 bg-transparent border-t border-white/5 flex items-center justify-center px-4">
        <div className="flex items-center space-x-3">
          {!isRecording && !isPaused ? (
            <button
              onClick={startRecording}
              disabled={!isArmed || shouldShowPermissionOverlay}
              className={`group flex items-center space-x-2 ${trackType === TrackType.IMAGE ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20' : 'bg-red-600 hover:bg-red-700 shadow-red-600/20'} ${(!isArmed || shouldShowPermissionOverlay) ? 'opacity-30 cursor-not-allowed' : 'opacity-90 hover:opacity-100'} text-white px-4 py-1.5 rounded-full transition-all hover:scale-105 shadow-lg`}
              title={!isArmed ? "Track must be armed to record" : isMissingRequiredStream ? "Recording permission required" : ""}
            >
              {trackType === TrackType.IMAGE ? <Camera size={12} fill="currentColor" /> : <Circle size={8} fill="currentColor" />}
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {trackType === TrackType.IMAGE ? 'Take Photo' : 'Start Recording'}
              </span>
            </button>
          ) : (
            <>
              <button
                onClick={isPaused ? resumeRecording : pauseRecording}
                className={`group flex items-center space-x-2 ${isPaused ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/10 hover:bg-white/20'} text-white px-4 py-1.5 rounded-full transition-all hover:scale-105 shadow-lg`}
              >
                {isPaused ? <Circle size={8} fill="currentColor" /> : <div className="flex space-x-1"><div className="w-1 h-3 bg-white rounded-full" /><div className="w-1 h-3 bg-white rounded-full" /></div>}
                <span className="text-[10px] font-bold uppercase tracking-wider">{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                onClick={stopRecording}
                className="group flex items-center space-x-2 bg-white text-black px-4 py-1.5 rounded-full transition-all hover:scale-105 shadow-lg"
              >
                <Square size={8} fill="currentColor" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Stop</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
