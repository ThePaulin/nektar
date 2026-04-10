import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Square, Circle, X, Monitor, Layers, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';

import { TrackType, RecordingSource } from '../types';

interface RecorderProps {
  onRecordingComplete: (
    videoUrl: string, 
    duration: number, 
    blob: Blob, 
    overlayRect?: { x: number; y: number; width: number; height: number }, 
    source?: RecordingSource,
    multiRecordings?: { source: RecordingSource, url: string, blob: Blob, width?: number, height?: number }[]
  ) => void;
  onStartRecording?: () => void;
  onClose?: () => void;
  isActive?: boolean;
  isArmed?: boolean;
  trackType?: TrackType;
}

type OverlayX = 'left' | 'right';
type OverlayY = 'top' | 'center' | 'bottom';

export const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete, onStartRecording, onClose, isActive = true, isArmed = true, trackType }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
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
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const compositionFrameRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const onRecordingCompleteRef = useRef(onRecordingComplete);
  const onStartRecordingRef = useRef(onStartRecording);

  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete;
    onStartRecordingRef.current = onStartRecording;
  }, [onRecordingComplete, onStartRecording]);

  const stopStreams = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    }
  }, [cameraStream, screenStream]);

  const setupCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Setup visualizer
      if (!audioContextRef.current) {
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
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access camera. Please ensure permissions are granted.");
    }
  };

  const setupScreen = async () => {
    try {
      const constraints: any = {
        video: { 
          cursor: "always",
          displaySurface: "browser"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      setScreenStream(stream);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }
      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null);
        if (recordingSource === 'screen' || recordingSource === 'overlay') {
          setRecordingSource('camera');
        }
      };
    } catch (err) {
      console.error("Error accessing screen:", err);
    }
  };

  useEffect(() => {
    if (recordingSource === 'camera' || (recordingSource === 'overlay' && !cameraStream)) {
      if (!cameraStream) setupCamera();
    }
    // Removed automatic setupScreen from useEffect as it requires user gesture
  }, [recordingSource]);

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
      stopStreams();
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (compositionFrameRef.current) cancelAnimationFrame(compositionFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (workerRef.current) {
        workerRef.current.postMessage({ action: 'stop' });
        workerRef.current.terminate();
      }
      URL.revokeObjectURL(workerUrl);
    };
  }, []);

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
        onRecordingCompleteRef.current(url, 5, blob, undefined, recordingSource);
      }
    }, 'image/png');
  };

  const startRecording = () => {
    if (onStartRecordingRef.current) onStartRecordingRef.current();
    if (trackType === TrackType.IMAGE) {
      takePhoto();
      return;
    }
    let streamToRecord: MediaStream | null = null;

    if (recordingSource === 'camera') {
      streamToRecord = cameraStream;
    } else if (recordingSource === 'screen') {
      streamToRecord = screenStream;
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
      // Add audio from camera/screen
      const audioTracks: MediaStreamTrack[] = [];
      if (cameraStream) audioTracks.push(...cameraStream.getAudioTracks());
      if (screenStream) audioTracks.push(...screenStream.getAudioTracks());

      if (audioTracks.length > 0) {
        if (audioTracks.length === 1) {
          canvasStream.addTrack(audioTracks[0]);
        } else {
          // Mix multiple audio tracks
          try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const destination = audioCtx.createMediaStreamDestination();
            
            audioTracks.forEach(track => {
              const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
              source.connect(destination);
            });
            
            canvasStream.addTrack(destination.stream.getAudioTracks()[0]);
          } catch (err) {
            console.error("Error mixing audio:", err);
            // Fallback to just camera audio if mixing fails
            canvasStream.addTrack(audioTracks[0]);
          }
        }
      }
      
      streamToRecord = canvasStream;
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
        if (e.data.size > 0) chunks.push(e.data);
      };

      recordersRef.current.push({ source, recorder, chunks });
      recorder.start();
    };

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

          const main = recordings.find(r => r.source === 'overlay') || recordings[0];

          let overlayRect;
          if (recordingSource === 'overlay') {
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

            overlayRect = { x, y, width: overlaySize, height: overlaySize };
          }

          onRecordingCompleteRef.current(
            main.url,
            accumulatedTimeRef.current,
            main.blob,
            overlayRect,
            recordingSource,
            recordings
          );
          if (compositionFrameRef.current) cancelAnimationFrame(compositionFrameRef.current);
          if (workerRef.current) workerRef.current.postMessage({ action: 'stop' });
        }
      };
    });

    setIsRecording(true);
    setIsPaused(false);
    setRecordingTime(0);
    accumulatedTimeRef.current = 0;
    startTimeRef.current = Date.now();

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
    }
  };

  const resumeRecording = () => {
    if (recordersRef.current.length > 0 && isPaused) {
      recordersRef.current.forEach(r => r.recorder.resume());
      setIsPaused(false);
      setIsRecording(true);
      startTimeRef.current = Date.now();

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
  }, [isRecording, isPaused, cameraStream, screenStream, recordingSource, isActive]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
                  onClick={() => setRecordingSource('camera')}
                  className={`p-1 rounded-md transition-colors ${recordingSource === 'camera' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  title="Camera Only"
                >
                  <Camera size={12} />
                </button>
                <button
                  onClick={() => {
                    setRecordingSource('screen');
                    if (!screenStream) setupScreen();
                  }}
                  className={`p-1 rounded-md transition-colors ${recordingSource === 'screen' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  title="Screen Only"
                >
                  <Monitor size={12} />
                </button>
                <button
                  onClick={() => {
                    setRecordingSource('overlay');
                    if (!cameraStream) setupCamera();
                    if (!screenStream) setupScreen();
                  }}
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
        {((recordingSource === 'camera' && !cameraStream) || 
          (recordingSource === 'screen' && !screenStream) || 
          (recordingSource === 'overlay' && (!cameraStream || !screenStream))) && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/30">
              {recordingSource === 'camera' ? <Camera size={24} className="text-blue-400" /> : <Monitor size={24} className="text-blue-400" />}
            </div>
            <h3 className="text-sm font-bold text-white mb-2">Permissions Required</h3>
            <p className="text-[10px] text-gray-400 max-w-[200px] mb-4">
              We need access to your {recordingSource === 'camera' ? 'camera' : recordingSource === 'screen' ? 'screen' : 'camera and screen'} to start recording.
            </p>
            <button
              onClick={() => {
                if (recordingSource === 'camera' || recordingSource === 'overlay') setupCamera();
                if (recordingSource === 'screen' || recordingSource === 'overlay') setupScreen();
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-600/20"
            >
              Grant Access
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
              disabled={!isArmed || (recordingSource === 'screen' && !screenStream) || (recordingSource === 'overlay' && (!screenStream || !cameraStream))}
              className={`group flex items-center space-x-2 ${trackType === TrackType.IMAGE ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20' : 'bg-red-600 hover:bg-red-700 shadow-red-600/20'} ${(!isArmed || (recordingSource === 'screen' && !screenStream) || (recordingSource === 'overlay' && (!screenStream || !cameraStream))) ? 'opacity-30 cursor-not-allowed' : 'opacity-90 hover:opacity-100'} text-white px-4 py-1.5 rounded-full transition-all hover:scale-105 shadow-lg`}
              title={!isArmed ? "Track must be armed to record" : (recordingSource !== 'camera' && !screenStream) ? "Screen permission required" : ""}
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

