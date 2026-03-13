import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { VideoObjType, Track, TrackType, VideoClip } from '../types';

interface ExportDialogProps {
  clips: VideoObjType;
  tracks: Track[];
  totalDuration: number;
  exportRange: { start: number; end: number };
  onClose: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ clips, tracks, totalDuration, exportRange, onClose }) => {
  const [status, setStatus] = useState<'idle' | 'exporting' | 'completed' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoElementsRef = useRef<{ [key: number]: HTMLVideoElement }>({});
  const imageElementsRef = useRef<{ [key: number]: HTMLImageElement }>({});

  const isMp4Supported = MediaRecorder.isTypeSupported('video/mp4') || MediaRecorder.isTypeSupported('video/mp4;codecs=avc1');
  const [format, setFormat] = useState<'webm' | 'mp4'>(isMp4Supported ? 'mp4' : 'webm');

  const startExport = async () => {
    setStatus('exporting');
    setProgress(0);
    setError(null);
    chunksRef.current = [];

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Initialize offscreen canvas for double buffering
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    const offscreenCanvas = offscreenCanvasRef.current;
    const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx || !offscreenCtx) return;

    // Set canvas size (720p for better performance in browser)
    canvas.width = 1280;
    canvas.height = 720;
    offscreenCanvas.width = 1280;
    offscreenCanvas.height = 720;

    try {
      // 1. Preload all required videos and images
      const visibleTrackIds = tracks.filter(t => t.isVisible).map(t => t.id);
      const exportClips = clips.filter(c => visibleTrackIds.includes(c.trackId));

      await Promise.all(exportClips.map(async (clip) => {
        if (clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO) {
          const video = document.createElement('video');
          video.src = clip.videoUrl!;
          video.muted = true;
          video.playsInline = true;
          video.crossOrigin = 'anonymous';
          // Pre-load enough to get metadata
          await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve;
            video.onerror = reject;
          });
          videoElementsRef.current[clip.id] = video;
        } else if (clip.type === TrackType.IMAGE) {
          const img = new Image();
          img.src = clip.thumbnailUrl!;
          img.crossOrigin = 'anonymous';
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
          imageElementsRef.current[clip.id] = img;
        }
      }));

      // 2. Setup MediaRecorder
      const mimeType = format === 'mp4' 
        ? (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1' : 'video/mp4')
        : 'video/webm;codecs=vp9,opus';
      
      // Setup Audio
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      
      // Connect all audio clips
      exportClips.forEach(clip => {
        if (clip.type === TrackType.AUDIO || clip.type === TrackType.VIDEO) {
          const video = videoElementsRef.current[clip.id];
          const track = tracks.find(t => t.id === clip.trackId);
          if (video && track && !track.isMuted) {
            video.muted = false;
            const source = audioCtx.createMediaElementSource(video);
            source.connect(dest);
          }
        }
      });

      let recorder: MediaRecorder;
      let writer: WritableStreamDefaultWriter<VideoFrame> | null = null;

      // Use MediaStreamTrackGenerator for deterministic timing if supported
      if ('MediaStreamTrackGenerator' in window && 'VideoFrame' in window) {
        const trackGenerator = new (window as any).MediaStreamTrackGenerator({ kind: 'video' });
        writer = trackGenerator.writable.getWriter();
        
        const combinedStream = new MediaStream([
          trackGenerator,
          ...dest.stream.getAudioTracks()
        ]);

        recorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: 8000000
        });
      } else {
        // Fallback to canvas capture stream (less accurate duration)
        const stream = canvas.captureStream(30);
        const combinedStream = new MediaStream([
          ...stream.getVideoTracks(),
          ...dest.stream.getAudioTracks()
        ]);

        recorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: 8000000
        });
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sequence-export-${Date.now()}.${format}`;
        a.click();
        setStatus('completed');
      };

      recorder.start(100);
      // Give the recorder a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. Render loop
      const fps = 30;
      const frameDuration = 1 / fps;
      const exportDuration = Math.round((exportRange.end - exportRange.start) * 30) / 30;
      
      if (exportDuration <= 0) {
        throw new Error("Invalid export range. Duration must be greater than 0.");
      }

      const totalFrames = Math.round(exportDuration * fps);
      console.log(`[Export] Start: ${exportRange.start}s, End: ${exportRange.end}s`);
      console.log(`[Export] Duration: ${exportDuration}s, Total Frames: ${totalFrames}`);
      console.log(`[Export] Using MediaStreamTrackGenerator: ${!!writer}`);

      const exportStartTime = Date.now();

      for (let i = 0; i < totalFrames; i++) {
        // Calculate precise time for this frame, snapped to 30fps grid
        const actualTime = Math.round((exportRange.start + i * frameDuration) * 30) / 30;
        
        if (i % 30 === 0 || i === totalFrames - 1) {
          console.log(`[Export] Rendering frame ${i + 1}/${totalFrames} at ${actualTime.toFixed(3)}s`);
        }
        
        // Clear offscreen canvas
        offscreenCtx.fillStyle = '#000000';
        offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

        // Find active clips at this time
        const activeClips = exportClips.filter(c => 
          actualTime >= c.timelinePosition.start && 
          actualTime <= c.timelinePosition.end
        ).sort((a, b) => {
          const indexA = tracks.findIndex(t => t.id === a.trackId);
          const indexB = tracks.findIndex(t => t.id === b.trackId);
          return indexB - indexA; 
        });

        // Draw each clip to offscreen canvas
        for (const clip of activeClips) {
          const track = tracks.find(t => t.id === clip.trackId);
          if (!track || !track.isVisible) continue;

          if (clip.type === TrackType.VIDEO) {
            const video = videoElementsRef.current[clip.id];
            if (video) {
              const localTime = (actualTime - clip.timelinePosition.start) + clip.sourceStart;
              video.currentTime = localTime;
              
              // Wait for seek and ensure frame is ready
              await new Promise(resolve => {
                const onSeeked = () => {
                  video.removeEventListener('seeked', onSeeked);
                  if (video.readyState >= 2) {
                    resolve(null);
                  } else {
                    video.addEventListener('canplay', () => resolve(null), { once: true });
                  }
                };
                video.addEventListener('seeked', onSeeked);
                // Safety timeout
                setTimeout(resolve, 150);
              });
              
              offscreenCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
            }
          } else if (clip.type === TrackType.IMAGE) {
            const img = imageElementsRef.current[clip.id];
            if (img) {
              offscreenCtx.drawImage(img, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
            }
          } else if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
            offscreenCtx.save();
            const posX = (clip.style?.position?.x || 0) + offscreenCanvas.width / 2;
            const posY = (clip.style?.position?.y || 0) + offscreenCanvas.height / 2;
            const scale = clip.style?.scale || 1;
            const rotation = (clip.style?.rotation || 0) * Math.PI / 180;

            offscreenCtx.translate(posX, posY);
            offscreenCtx.scale(scale, scale);
            offscreenCtx.rotate(rotation);

            const fontSize = clip.style?.fontSize || 48;
            offscreenCtx.font = `${clip.style?.fontWeight || 'normal'} ${fontSize}px ${clip.style?.fontFamily || 'sans-serif'}`;
            offscreenCtx.fillStyle = clip.style?.color || '#ffffff';
            offscreenCtx.textAlign = 'center';
            offscreenCtx.textBaseline = 'middle';

            if (clip.type === TrackType.SUBTITLE) {
              const textWidth = offscreenCtx.measureText(clip.content || '').width;
              offscreenCtx.fillStyle = 'rgba(0,0,0,0.6)';
              offscreenCtx.fillRect(-textWidth/2 - 20, -fontSize/2 - 10, textWidth + 40, fontSize + 20);
              offscreenCtx.fillStyle = clip.style?.color || '#ffffff';
            } else if (clip.style?.backgroundColor && clip.style.backgroundColor !== 'transparent') {
              const textWidth = offscreenCtx.measureText(clip.content || '').width;
              offscreenCtx.fillStyle = clip.style.backgroundColor;
              offscreenCtx.fillRect(-textWidth/2 - 20, -fontSize/2 - 10, textWidth + 40, fontSize + 20);
              offscreenCtx.fillStyle = clip.style?.color || '#ffffff';
            }

            offscreenCtx.fillText(clip.content || '', 0, 0);
            offscreenCtx.restore();
          }
        }

        // Copy offscreen to main canvas in ONE operation to prevent flickering
        ctx.drawImage(offscreenCanvas, 0, 0);

        // Push frame to generator if available
        if (writer) {
          const frame = new VideoFrame(canvas, { 
            timestamp: (i * frameDuration) * 1000000,
            duration: frameDuration * 1000000
          });
          await writer.write(frame);
          frame.close();
        }

        const currentProgress = ((i + 1) / totalFrames) * 100;
        setProgress(Math.min(100, currentProgress));
        
        // Regulate speed to be at most real-time to help MediaRecorder stay in sync
        // This is especially important if MediaRecorder ignores frame timestamps
        const expectedElapsed = (i + 1) * frameDuration * 1000;
        const actualElapsed = Date.now() - exportStartTime;
        if (actualElapsed < expectedElapsed) {
          await new Promise(resolve => setTimeout(resolve, expectedElapsed - actualElapsed));
        }

        // If not using generator, we need a small additional delay for MediaRecorder to capture the canvas
        if (!writer) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      console.log(`[Export] Render loop finished. Total frames rendered: ${totalFrames}`);
      const finalElapsed = (Date.now() - exportStartTime) / 1000;
      console.log(`[Export] Render took ${finalElapsed.toFixed(2)}s for ${exportDuration}s content`);

      if (writer) {
        await writer.close();
      }
      
      // Stop all tracks to signal the end of the stream
      recorder.stream.getTracks().forEach(track => track.stop());
      
      // Give the recorder a moment to process the last frames
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      // Cleanup
      await audioCtx.close();

    } catch (err) {
      console.error("Export error:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred during export.");
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Export Sequence</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-8 flex flex-col items-center text-center">
          {status === 'idle' && (
            <>
              <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                <Download size={40} className="text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Export</h3>
              <p className="text-gray-500 mb-6">
                Choose your preferred format and combine all tracks into a single video file.
              </p>
              
              <div className="flex bg-gray-100 p-1 rounded-xl w-full mb-8">
                <button
                  onClick={() => setFormat('webm')}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${format === 'webm' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  WebM
                </button>
                <button
                  onClick={() => setFormat('mp4')}
                  disabled={!isMp4Supported}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${format === 'mp4' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'} ${!isMp4Supported ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  MP4 {!isMp4Supported && '(Not Supported)'}
                </button>
              </div>

              <button
                onClick={startExport}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
              >
                Start Export
              </button>
            </>
          )}

          {status === 'exporting' && (
            <>
              <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 relative">
                <Loader2 size={40} className="text-blue-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-blue-600">{Math.round(progress)}%</span>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Exporting Sequence...</h3>
              <p className="text-gray-500 mb-8">
                Please keep this window open while we process your video.
              </p>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                <motion.div
                  className="h-full bg-blue-600"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 font-medium">{Math.round(progress)}% Complete</span>
            </>
          )}

          {status === 'completed' && (
            <>
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 size={40} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Export Successful!</h3>
              <p className="text-gray-500 mb-8">
                Your video has been exported and should be downloading automatically.
              </p>
              <button
                onClick={onClose}
                className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all"
              >
                Close
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6">
                <AlertCircle size={40} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Export Failed</h3>
              <p className="text-red-500 mb-8">{error}</p>
              <button
                onClick={startExport}
                className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                Try Again
              </button>
            </>
          )}
        </div>

        {/* Hidden Canvas for Rendering */}
        <canvas ref={canvasRef} className="hidden" />
      </motion.div>
    </div>
  );
};
