import React, { useState, useRef, useEffect } from 'react';
import { Camera, Square, Circle, X } from 'lucide-react';

interface RecorderProps {
  onRecordingComplete: (videoUrl: string, duration: number, blob: Blob) => void;
  onStartRecording?: () => void;
  onClose?: () => void;
  isActive?: boolean;
  isArmed?: boolean;
}

export const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete, onStartRecording, onClose, isActive = true, isArmed = true }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const accumulatedTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const onRecordingCompleteRef = useRef(onRecordingComplete);
  const onStartRecordingRef = useRef(onStartRecording);

  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete;
    onStartRecordingRef.current = onStartRecording;
  }, [onRecordingComplete, onStartRecording]);

  useEffect(() => {
    async function setupCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: true
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }

        // Setup visualizer
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(mediaStream);
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
            setAudioLevel(average / 128); // Normalize to 0-1 approx
          }
          animationFrameRef.current = requestAnimationFrame(updateVisualizer);
        };
        updateVisualizer();
      } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Could not access camera. Please ensure permissions are granted.");
        onClose?.();
      }
    }

    setupCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  const startRecording = () => {
    if (!stream) return;

    const mimeType = 'video/mp4;codecs="avc1.640028"';
    const options = MediaRecorder.isTypeSupported(mimeType)
      ? { mimeType }
      : {}; // Fallback to default if specific codec not supported

    chunksRef.current = [];
    const mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const mimeType = mediaRecorder.mimeType || 'video/mp4';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      onRecordingCompleteRef.current(url, accumulatedTimeRef.current, blob);
    };

    mediaRecorder.start();
    setIsRecording(true);
    setIsPaused(false);
    setRecordingTime(0);
    accumulatedTimeRef.current = 0;
    startTimeRef.current = Date.now();

    if (onStartRecordingRef.current) onStartRecordingRef.current();

    timerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setRecordingTime(accumulatedTimeRef.current + elapsed);
    }, 100);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isPaused)) {
      if (isRecording) {
        accumulatedTimeRef.current += (Date.now() - startTimeRef.current) / 1000;
      }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      accumulatedTimeRef.current += (Date.now() - startTimeRef.current) / 1000;
      setIsPaused(true);
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isPaused) {
      mediaRecorderRef.current.resume();
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
  }, [isRecording, isPaused, stream, isActive]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative w-fit h-full max-h-[300px] flex flex-col bg-[#111] border border-white/10 shadow-2xl overflow-hidden rounded-xl min-h-0">
      {/* Video Preview */}
      <div className="h-full w-fit aspect-video relative bg-black flex items-center justify-center min-h-0 overflow-hidden">
        {/* Header */}
        <div className="absolute h-10 bg-gradient-to-b from-black/60 to-transparent top-0 left-0 right-0 z-10 flex items-center justify-between px-3">
          <div className="flex items-center space-x-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-[9px] font-bold text-white uppercase tracking-wider">
              {isRecording ? 'Recording' : 'Camera'}
            </span>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Audio Level Overlay */}
        <div className="absolute bottom-3 left-3 flex space-x-0.5 h-8 items-end bg-black/40 p-1.5 rounded-lg backdrop-blur-md border border-white/10">
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
          <div className="absolute top-3 right-3 bg-black/60 px-2 py-0.5 rounded-md backdrop-blur-md border border-white/10">
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
              disabled={!isArmed}
              className={`group flex items-center space-x-2 bg-red-600 ${!isArmed ? 'opacity-30 cursor-not-allowed' : 'opacity-90 hover:opacity-100 hover:bg-red-700'} text-white px-4 py-1.5 rounded-full transition-all hover:scale-105 shadow-lg shadow-red-600/20`}
              title={!isArmed ? "Track must be armed to record" : ""}
            >
              <Circle size={8} fill="currentColor" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Start Recording</span>
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
