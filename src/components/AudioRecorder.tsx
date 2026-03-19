import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Circle, X } from 'lucide-react';

interface AudioRecorderProps {
  onRecordingComplete: (audioUrl: string, duration: number, blob: Blob) => void;
  onStartRecording?: () => void;
  onClose?: () => void;
  isActive?: boolean;
  isArmed?: boolean;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete, onStartRecording, onClose, isActive = true, isArmed = true }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
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
    async function setupAudio() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
        setStream(mediaStream);

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
        console.error("Error accessing microphone:", err);
        alert("Could not access microphone. Please ensure permissions are granted.");
        onClose?.();
      }
    }

    setupAudio();

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

    const mimeType = 'audio/webm;codecs=opus';
    const options = MediaRecorder.isTypeSupported(mimeType)
      ? { mimeType }
      : {};

    chunksRef.current = [];
    const mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const mimeType = mediaRecorder.mimeType || 'audio/webm';
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
    <div className="relative aspect-video w-fit h-full aspect-video flex flex-col bg-[#111] overflow-hidden border border-white/10 shadow-2xl rounded-xl min-h-0">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-black/60 to-transparent z-10 flex items-center justify-between px-3">
        <div className="flex items-center space-x-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-[9px] font-bold text-white uppercase tracking-wider">
            {isRecording ? 'Recording Audio' : 'Audio'}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Audio Visualizer Area */}
      <div className="flex-1 w-full relative bg-black flex flex-col items-center justify-center overflow-hidden min-h-0">
        {/* Background pulses based on audio level */}
        <div
          className="absolute inset-0 bg-blue-600/5 transition-opacity duration-75"
          style={{ opacity: audioLevel * 0.5 }}
        />

        <div className="relative flex items-center justify-center w-full px-6">
          {/* Left Level Meter */}
          <div className="absolute left-4 flex flex-col space-y-0.5 h-24 justify-center">
            {[...Array(12)].map((_, i) => {
              const level = (12 - i) / 12;
              const isActive = audioLevel > level;
              return (
                <div
                  key={i}
                  className={`w-3 h-1 rounded-sm transition-colors duration-75 ${isActive
                    ? i < 3 ? 'bg-red-500' : i < 6 ? 'bg-yellow-500' : 'bg-emerald-500'
                    : 'bg-white/5'
                    }`}
                />
              );
            })}
          </div>

          <div className="relative flex items-center justify-center">
            {/* Pulsing circles */}
            <div
              className="absolute w-24 h-24 bg-blue-600/20 rounded-full transition-transform duration-75"
              style={{ transform: `scale(${1 + audioLevel * 0.5})` }}
            />
            <div
              className="absolute w-16 h-16 bg-blue-600/40 rounded-full transition-transform duration-75"
              style={{ transform: `scale(${1 + audioLevel * 0.3})` }}
            />

            <div className="relative z-10 w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-600/40">
              <Mic size={24} className="text-white" />
            </div>
          </div>

          {/* Right Level Meter */}
          <div className="absolute right-4 flex flex-col space-y-0.5 h-24 justify-center">
            {[...Array(12)].map((_, i) => {
              const level = (12 - i) / 12;
              const isActive = audioLevel > level;
              return (
                <div
                  key={i}
                  className={`w-3 h-1 rounded-sm transition-colors duration-75 ${isActive
                    ? i < 3 ? 'bg-red-500' : i < 6 ? 'bg-yellow-500' : 'bg-emerald-500'
                    : 'bg-white/5'
                    }`}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center shrink-0">
          <span className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">Microphone Active</span>
          <div className="mt-1.5 flex space-x-1 h-3 items-end">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="w-0.5 bg-blue-500 rounded-full transition-all duration-75"
                style={{
                  height: `${Math.max(20, audioLevel * 100 * (1 - Math.abs(i - 4.5) / 5))}%`,
                  opacity: 0.3 + audioLevel * 0.7
                }}
              />
            ))}
          </div>
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
      <div className="absolute bottom-0 right-0 h-12 bg-transparent border-t border-white/5 flex items-center justify-end px-4">
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
