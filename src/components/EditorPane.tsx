import React, { useState, useEffect } from 'react';
import { Clipboard, Trash2, Plus, Image as ImageIcon, Video, Music, Type, FileText } from 'lucide-react';
import { TrackType, Track, VideoClip, RecordingMode } from '../types';
import { Recorder } from './Recorder';
import { AudioRecorder } from './AudioRecorder';
import { TextEditor } from './TextEditor';

interface EditorPaneProps {
  selectedTrackId: string;
  tracks: Track[];
  clips: VideoClip[];
  selectedClipIds: number[];
  currentTime: number;
  recordingMode: RecordingMode;
  onRecordingComplete: (url: string, duration: number, blob: Blob) => void;
  onStartRecording: () => void;
  onClipUpdate: (clipId: number, updates: Partial<VideoClip>) => void;
  onAddClip: (clip: Partial<VideoClip>) => void;
  onImportClick: () => void;
}

export const EditorPane: React.FC<EditorPaneProps> = ({
  selectedTrackId,
  tracks,
  clips,
  selectedClipIds,
  currentTime,
  recordingMode,
  onRecordingComplete,
  onStartRecording,
  onClipUpdate,
  onAddClip,
  onImportClick,
}) => {
  const [clipboardContent, setClipboardContent] = useState<string | null>(null);
  const selectedTrack = tracks.find(t => t.id === selectedTrackId);
  const selectedClip = clips.find(c => selectedClipIds.length === 1 && c.id === selectedClipIds[0]);

  // Check clipboard periodically or on focus
  const checkClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setClipboardContent(text.trim() || null);
    } catch (err) {
      // Clipboard access might be denied
      setClipboardContent(null);
    }
  };

  useEffect(() => {
    window.addEventListener('focus', checkClipboard);
    checkClipboard();
    return () => window.removeEventListener('focus', checkClipboard);
  }, []);

  const isUrl = clipboardContent ? /^(https?:\/\/[^\s]+)$/.test(clipboardContent) : false;
  const isRelevant = clipboardContent && selectedTrack && (
    ((selectedTrack.type === TrackType.VIDEO || selectedTrack.type === TrackType.AUDIO || selectedTrack.type === TrackType.IMAGE) && isUrl) ||
    (selectedTrack.type === TrackType.TEXT || selectedTrack.type === TrackType.SUBTITLE)
  );

  const handlePaste = () => {
    if (!clipboardContent || !selectedTrack || !isRelevant) return;

    if (selectedTrack.type === TrackType.VIDEO || selectedTrack.type === TrackType.AUDIO) {
      onAddClip({
        type: selectedTrack.type,
        videoUrl: clipboardContent,
        label: `Pasted ${selectedTrack.type}`,
        duration: 10,
      });
    } else if (selectedTrack.type === TrackType.IMAGE) {
      onAddClip({
        type: TrackType.IMAGE,
        videoUrl: clipboardContent,
        label: 'Pasted Image',
        duration: 5,
      });
    } else if (selectedTrack.type === TrackType.TEXT || selectedTrack.type === TrackType.SUBTITLE) {
      onAddClip({
        type: selectedTrack.type,
        content: clipboardContent,
        label: `Pasted ${selectedTrack.type}`,
        duration: 5,
      });
    }
  };

  const handleClearClipboard = () => {
    setClipboardContent(null);
    // Note: We can't easily clear the system clipboard for security reasons, 
    // but we can clear our local state.
  };

  const renderContent = () => {
    // If a text clip is selected, show the text editor
    if (selectedClip && (selectedClip.type === TrackType.TEXT || selectedClip.type === TrackType.SUBTITLE)) {
      return (
        <div className="w-full h-full flex justify-center overflow-y-auto">
          <TextEditor clip={selectedClip} onUpdate={onClipUpdate} />
        </div>
      );
    }

    if (!selectedTrack) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center text-gray-500 space-y-4">
          <div className="p-4 rounded-full bg-white/5">
            <Plus size={48} className="opacity-20" />
          </div>
          <p className="text-sm font-medium">Select a track to start adding content</p>
        </div>
      );
    }

    return (
      <div className="h-full w-full flex flex-col space-y-6">
        {/* Track Info & Mode */}
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-blue-600/20 text-blue-400">
              {selectedTrack.type === TrackType.VIDEO && <Video size={20} />}
              {selectedTrack.type === TrackType.AUDIO && <Music size={20} />}
              {selectedTrack.type === TrackType.IMAGE && <ImageIcon size={20} />}
              {(selectedTrack.type === TrackType.TEXT || selectedTrack.type === TrackType.SUBTITLE) && <Type size={20} />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{selectedTrack.name}</h3>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">{selectedTrack.type} Track</p>
            </div>
          </div>
          
          <div className="flex items-center bg-black/40 rounded-full p-1 border border-white/10">
            <div className="px-3 py-1 text-[10px] font-bold text-blue-400 uppercase tracking-tighter">
              {recordingMode} Mode
            </div>
          </div>
        </div>

        {/* Action Area */}
        <div className="flex-grow flex flex-col space-y-4">
          {selectedTrack.type === TrackType.VIDEO && (
            <div className="aspect-video w-full rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              <Recorder
                onRecordingComplete={onRecordingComplete}
                onStartRecording={onStartRecording}
                isActive={true}
              />
            </div>
          )}

          {selectedTrack.type === TrackType.AUDIO && (
            <div className="aspect-video w-full rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-[#111]">
              <AudioRecorder
                onRecordingComplete={onRecordingComplete}
                onStartRecording={onStartRecording}
                isActive={true}
              />
            </div>
          )}

          {selectedTrack.type === TrackType.IMAGE && (
            <div 
              onClick={onImportClick}
              className="aspect-video w-full rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center space-y-4 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer group"
            >
              <div className="p-4 rounded-full bg-white/5 group-hover:scale-110 transition-transform">
                <ImageIcon size={48} className="text-gray-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white">Import Image</p>
                <p className="text-xs text-gray-500">Click to browse or drag and drop</p>
              </div>
            </div>
          )}

          {(selectedTrack.type === TrackType.TEXT || selectedTrack.type === TrackType.SUBTITLE) && !selectedClip && (
            <button
              onClick={() => onAddClip({ type: selectedTrack.type, label: `New ${selectedTrack.type}`, duration: 5 })}
              className="aspect-video w-full rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center space-y-4 bg-white/5 hover:bg-white/10 transition-colors group"
            >
              <div className="p-4 rounded-full bg-white/5 group-hover:scale-110 transition-transform">
                <Plus size={48} className="text-gray-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white">Add New {selectedTrack.type === TrackType.TEXT ? 'Text' : 'Subtitle'}</p>
                <p className="text-xs text-gray-500">Create a new instance at playhead</p>
              </div>
            </button>
          )}

          {/* Clipboard Actions */}
          {clipboardContent && (
            <div className={`p-4 rounded-xl border space-y-3 animate-in fade-in slide-in-from-bottom-2 transition-colors ${isRelevant ? 'bg-blue-600/10 border-blue-500/20' : 'bg-gray-600/10 border-white/5 opacity-60'}`}>
              <div className="flex items-center justify-between">
                <div className={`flex items-center space-x-2 ${isRelevant ? 'text-blue-400' : 'text-gray-500'}`}>
                  <Clipboard size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {isRelevant ? 'Found in Clipboard' : 'Clipboard Content (Not compatible)'}
                  </span>
                </div>
                <button 
                  onClick={handleClearClipboard}
                  className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="flex-grow min-w-0">
                  <p className="text-xs text-gray-300 line-clamp-2 font-mono bg-black/20 p-2 rounded border border-white/5">
                    {clipboardContent}
                  </p>
                </div>
                {isRelevant && (
                  <button
                    onClick={handlePaste}
                    className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 shadow-lg shadow-blue-600/20 flex items-center space-x-2"
                  >
                    <Plus size={14} />
                    <span>Paste to Track</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-fit max-w-[600px] slide-in-from-left duration-500">
      {renderContent()}
    </div>
  );
};
