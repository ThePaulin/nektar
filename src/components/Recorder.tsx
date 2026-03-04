import React, { useState, useRef, useEffect } from 'react';
import { Camera, Square, Circle, X } from 'lucide-react';

interface RecorderProps {
  onRecordingComplete: (videoUrl: string, duration: number, blob: Blob) => void;
  onStartRecording?: () => void;
  onClose?: () => void;
}

export const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete, onStartRecording, onClose }) => {
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
      const key = e.key.toLowerCase();
      if (key === 'r') {
        e.preventDefault();
        if (e.shiftKey) {
          if (isRecording) pauseRecording();
          else if (isPaused) resumeRecording();
        } else {
          if (!isRecording && !isPaused) {
            startRecording();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, isPaused, stream]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full flex flex-col bg-[#111] rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
      {/* Header */}
      <div className="h-12 bg-gradient-to-b from-black/60 to-transparent z-10 flex items-center justify-between px-4">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-[10px] font-medium text-white uppercase tracking-wider">
            {isRecording ? 'Recording' : 'Camera Preview'}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Video Preview */}
      <div className="relative aspect-video bg-black flex items-center justify-center">
        <video 
          ref={videoRef} 
          autoPlay 
          muted 
          playsInline 
          className="w-full h-full object-cover"
        />
        
        {(isRecording || isPaused) && (
          <div className="absolute top-4 right-4 bg-black/60 px-2 py-1 rounded-md backdrop-blur-md border border-white/10">
            <span className="text-sm font-mono font-bold text-white tabular-nums">
              {formatDuration(recordingTime)}
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="h-20 bg-[#111] flex items-center justify-center space-x-3 border-t border-white/5">
        {!isRecording && !isPaused ? (
          <button 
            onClick={startRecording}
            className="group flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-full transition-all hover:scale-105 shadow-lg shadow-red-600/20"
          >
            <Circle size={16} fill="currentColor" />
            <span className="text-xs font-bold uppercase tracking-tight">Start Recording</span>
          </button>
        ) : (
          <>
            <button 
              onClick={isPaused ? resumeRecording : pauseRecording}
              className={`group flex items-center space-x-2 ${isPaused ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/10 hover:bg-white/20'} text-white px-6 py-2.5 rounded-full transition-all hover:scale-105 shadow-lg`}
            >
              {isPaused ? <Circle size={16} fill="currentColor" /> : <div className="flex space-x-1"><div className="w-1 h-4 bg-white rounded-full" /><div className="w-1 h-4 bg-white rounded-full" /></div>}
              <span className="text-xs font-bold uppercase tracking-tight">{isPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button 
              onClick={stopRecording}
              className="group flex items-center space-x-2 bg-white text-black px-6 py-2.5 rounded-full transition-all hover:scale-105 shadow-lg"
            >
              <Square size={16} fill="currentColor" />
              <span className="text-xs font-bold uppercase tracking-tight">Stop</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
