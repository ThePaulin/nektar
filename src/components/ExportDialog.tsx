import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { ExportOptions, ExportProgressStage, Track, VideoObjType } from '../types';
import { exportTimeline } from '../lib/export/timeline-exporter';

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
  const [stage, setStage] = useState<ExportProgressStage>('prepare');
  const cancelRequestedRef = useRef(false);

  const isMp4Supported = MediaRecorder.isTypeSupported('video/mp4') || MediaRecorder.isTypeSupported('video/mp4;codecs=avc1');
  const [format, setFormat] = useState<'webm' | 'mp4'>(isMp4Supported ? 'mp4' : 'webm');

  const startExport = async () => {
    cancelRequestedRef.current = false;
    setStatus('exporting');
    setProgress(0);
    setError(null);
    setStage('prepare');

    const options: ExportOptions = {
      format,
      width: 1280,
      height: 720,
      fps: 30,
      range: exportRange,
      onCancel: () => cancelRequestedRef.current,
      onProgress: (nextProgress, nextStage) => {
        setProgress(nextProgress * 100);
        setStage(nextStage);
      },
    };

    try {
      const result = await exportTimeline({ clips, tracks, options });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sequence-export-${Date.now()}.${result.format}`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unknown error occurred during export.';
      if (message === 'Export cancelled') {
        setStatus('idle');
        setProgress(0);
        setError(null);
        return;
      }
      console.error('Export error:', err);
      setError(message);
      setStatus('error');
    }
  };

  const handleCancel = () => {
    cancelRequestedRef.current = true;
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
          <button onClick={status === 'exporting' ? handleCancel : onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
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
                Export {Math.round(totalDuration)}s timeline clips for the selected range.
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
              <p className="text-gray-500 mb-3 capitalize">
                Current stage: {stage}
              </p>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                <motion.div
                  className="h-full bg-blue-600"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 font-medium mb-6">{Math.round(progress)}% Complete</span>
              <button
                onClick={handleCancel}
                className="w-full py-3 bg-gray-100 text-gray-900 rounded-xl font-bold hover:bg-gray-200 transition-all"
              >
                Cancel Export
              </button>
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
      </motion.div>
    </div>
  );
};
