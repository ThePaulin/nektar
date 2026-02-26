import React, { useState, useRef, useEffect } from 'react';
import { Camera, Square, Circle, X } from 'lucide-react';

interface RecorderProps {
  onRecordingComplete: (videoUrl: string, duration: number, blob: Blob) => void;
  onClose: () => void;
}

export const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete, onClose }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

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
        onClose();
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
      const actualDuration = (Date.now() - startTimeRef.current) / 1000;
      const mimeType = mediaRecorder.mimeType || 'video/mp4';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      onRecordingComplete(url, actualDuration, blob);
    };

    mediaRecorder.start();
    setIsRecording(true);
    setIsPaused(false);
    setRecordingTime(0);
    startTimeRef.current = Date.now();
    
    timerRef.current = window.setInterval(() => {
      setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 100);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isPaused)) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
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
      // Adjust start time to account for pause duration if needed, 
      // but simple timer might be enough for this demo
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 0.1);
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
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-8 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl bg-[#111] rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="absolute top-0 inset-x-0 h-14 bg-gradient-to-b from-black/60 to-transparent z-10 flex items-center justify-between px-6">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-xs font-medium text-white uppercase tracking-wider">
              {isRecording ? 'Recording' : 'Camera Preview'}
            </span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Video Preview */}
        <div className="aspect-video bg-black flex items-center justify-center">
          <video 
            ref={videoRef} 
            autoPlay 
            muted 
            playsInline 
            className="w-full h-full object-cover"
          />
          
          {isRecording && (
            <div className="absolute top-20 right-8 bg-black/60 px-3 py-1.5 rounded-md backdrop-blur-md border border-white/10">
              <span className="text-xl font-mono font-bold text-white tabular-nums">
                {formatDuration(recordingTime)}
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="h-24 bg-[#111] flex items-center justify-center space-x-4 border-t border-white/5">
          {!isRecording && !isPaused ? (
            <button 
              onClick={startRecording}
              className="group flex items-center space-x-3 bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-full transition-all hover:scale-105 shadow-lg shadow-red-600/20"
            >
              <Circle size={20} fill="currentColor" />
              <span className="font-bold uppercase tracking-tight">Start Recording</span>
            </button>
          ) : (
            <>
              <button 
                onClick={isPaused ? resumeRecording : pauseRecording}
                className={`group flex items-center space-x-3 ${isPaused ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/10 hover:bg-white/20'} text-white px-8 py-3 rounded-full transition-all hover:scale-105 shadow-lg`}
              >
                {isPaused ? <Circle size={20} fill="currentColor" /> : <div className="flex space-x-1"><div className="w-1.5 h-5 bg-white rounded-full" /><div className="w-1.5 h-5 bg-white rounded-full" /></div>}
                <span className="font-bold uppercase tracking-tight">{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button 
                onClick={stopRecording}
                className="group flex items-center space-x-3 bg-white text-black px-8 py-3 rounded-full transition-all hover:scale-105 shadow-lg"
              >
                <Square size={20} fill="currentColor" />
                <span className="font-bold uppercase tracking-tight">Stop</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
