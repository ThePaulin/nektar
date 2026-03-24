import React from 'react';
import { Upload, Plus, Video, Music, Image as ImageIcon, Type as TypeIcon, MousePointer2, ArrowRightToLine, Monitor } from 'lucide-react';
import { Track, TrackType, RecordingMode } from '../types';

interface TrackActionAreaProps {
  track: Track;
  recordingMode: RecordingMode;
  onImport: () => void;
  onAddText: () => void;
  onArm?: () => void;
}

export const TrackActionArea: React.FC<TrackActionAreaProps> = ({
  track,
  recordingMode,
  onImport,
  onAddText,
  onArm,
}) => {
  const isVideo = track.type === TrackType.VIDEO;
  const isAudio = track.type === TrackType.AUDIO;
  const isImage = track.type === TrackType.IMAGE;
  const isScreen = track.type === TrackType.SCREEN;
  const isText = track.type === TrackType.TEXT || track.type === TrackType.SUBTITLE;

  const getIcon = () => {
    if (isVideo) return <Video size={16} className="text-blue-500/50" />;
    if (isAudio) return <Music size={16} className="text-emerald-500/50" />;
    if (isImage) return <ImageIcon size={16} className="text-amber-500/50" />;
    if (isText) return <TypeIcon size={16} className="text-purple-500/50" />;
    if (isScreen) return <Monitor size={16} className="text-indigo-500/50" />;
    return null;
  };

  const getTitle = () => {
    if (isVideo) return "Import Video";
    if (isAudio) return "Import Audio";
    if (isImage) return "Import Image";
    if (isScreen) return "Screen Recording";
    if (isText) return track.type === TrackType.TEXT ? "New Text Instance" : "New Subtitle Instance";
    return "";
  };

  const getDescription = () => {
    const modeText = recordingMode === 'insert' ? "at current playhead" : "at end of track";
    if (isText) return `Add a new ${track.type} clip ${modeText}`;
    if (isScreen) return `Record your screen ${modeText}`;
    return `Upload a ${track.type} file to this track ${modeText}`;
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 min-h-0 bg-[#111] border border-white/5 rounded-xl group transition-all hover:border-white/10 overflow-y-auto">
      <div className="flex flex-col items-center justify-center w-full max-h-full py-2">
        <div className="relative mb-2 shrink-0">
          <div className="absolute inset-0 bg-blue-500/10 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative p-2 bg-white/5 rounded-2xl border border-white/10">
            {getIcon()}
          </div>
        </div>

        <h3 className="text-base sm:text-lg font-bold text-white mb-1 shrink-0 text-center leading-tight">{getTitle()}</h3>
        <p className="text-gray-500 text-[10px] sm:text-xs text-center max-w-[240px] mb-4 leading-tight shrink opacity-80 min-h-0 overflow-hidden">
          {getDescription()}
        </p>

        <div className="flex flex-col items-center space-y-2 w-full max-w-[180px] shrink-0">
          <button
            onClick={isText ? onAddText : isScreen ? onArm : onImport}
            className="w-full flex items-center justify-center space-x-2 bg-white text-black py-2 rounded-lg font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg text-xs sm:text-sm"
          >
            {isText ? <Plus size={14} /> : isScreen ? <Monitor size={14} /> : <Upload size={14} />}
            <span>{isText ? "Create New" : isScreen ? "Start Recording" : "Choose File"}</span>
          </button>

          <div className="flex items-center space-x-2 px-2 py-1 bg-white/5 rounded-md border border-white/5">
            {recordingMode === 'insert' ? (
              <>
                <MousePointer2 size={10} className="text-blue-400" />
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-gray-400">Insert Mode</span>
              </>
            ) : (
              <>
                <ArrowRightToLine size={10} className="text-blue-400" />
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-gray-400">Append Mode</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

