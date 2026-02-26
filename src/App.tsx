import { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { Timeline } from './components/Timeline';
import { VideoPreview } from './components/VideoPreview';
import { Recorder } from './components/Recorder';
import { VideoObjType, VideoClip } from './types';
import { videoDB } from './services/db';
import { Play, Pause, SkipBack, SkipForward, Video, Download, Undo2, Redo2, Radio, ChevronDown, Archive, FileVideo, History, Trash2, AlertCircle, X } from 'lucide-react';

const MOCK_CLIPS: VideoObjType = [
  {
    id: 1,
    label: "Big Buck Bunny",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    thumbnailUrl: "https://picsum.photos/seed/bunny/200/120",
    duration: 10,
    sourceStart: 0,
    timelinePosition: {
      start: 2,
      end: 12,
    }
  },
  {
    id: 2,
    label: "Elephant's Dream",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    thumbnailUrl: "https://picsum.photos/seed/elephant/200/120",
    duration: 15,
    sourceStart: 0,
    timelinePosition: {
      start: 15,
      end: 30,
    }
  },
  {
    id: 3,
    label: "For Bigger Blazes",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    thumbnailUrl: "https://picsum.photos/seed/blaze/200/120",
    duration: 8,
    sourceStart: 0,
    timelinePosition: {
      start: 35,
      end: 43,
    }
  }
];

export default function App() {
  const [clips, setClips] = useState<VideoObjType>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRecordingMode, setIsRecordingMode] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [pendingRestoredClips, setPendingRestoredClips] = useState<VideoObjType | null>(null);
  const [past, setPast] = useState<VideoObjType[]>([]);
  const [future, setFuture] = useState<VideoObjType[]>([]);
  const [tempState, setTempState] = useState<VideoObjType | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<number[]>([]);
  const [downloadedClipIds, setDownloadedClipIds] = useState<number[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRef = useRef<number | null>(null);
  const totalDuration = 60;

  useEffect(() => {
    const checkDB = async () => {
      try {
        const storedClips = await videoDB.getClips();
        if (storedClips && storedClips.length > 0) {
          setPendingRestoredClips(storedClips);
          setShowRestorePrompt(true);
        } else {
          setClips(MOCK_CLIPS);
          setIsInitialized(true);
        }
      } catch (err) {
        console.error("Failed to check IndexedDB:", err);
        setClips(MOCK_CLIPS);
        setIsInitialized(true);
      }
    };
    checkDB();
  }, []);

  // Sync metadata to DB on changes
  useEffect(() => {
    const syncMetadata = async () => {
      if (isInitialized && clips.length > 0) {
        try {
          await videoDB.saveAllClips(clips);
        } catch (err: any) {
          console.error("Failed to sync metadata to IndexedDB:", err);
          if (err.name === "QuotaExceededError") {
            setStorageError("Storage quota exceeded. Metadata sync failed.");
          }
        }
      }
    };
    syncMetadata();
  }, [clips, isInitialized]);

  const handleRestore = async () => {
    if (!pendingRestoredClips) return;
    
    try {
      const restoredClips = await Promise.all(pendingRestoredClips.map(async (clip) => {
        if (clip.blobId) {
          const blob = await videoDB.getBlob(clip.blobId);
          if (blob) {
            return { ...clip, videoUrl: URL.createObjectURL(blob) };
          }
        }
        return clip;
      }));
      
      setClips(restoredClips);
      setPast([]);
      setFuture([]);
      setShowRestorePrompt(false);
      setIsInitialized(true);
    } catch (err) {
      console.error("Failed to restore session:", err);
      handleStartFresh();
    }
  };

  const handleStartFresh = async () => {
    try {
      await videoDB.clearAll();
      setClips(MOCK_CLIPS);
      setPast([]);
      setFuture([]);
      setShowRestorePrompt(false);
      setIsInitialized(true);
    } catch (err) {
      console.error("Failed to clear DB:", err);
      setClips(MOCK_CLIPS);
      setIsInitialized(true);
    }
  };

  const pushToHistory = useCallback((newClips: VideoObjType) => {
    setPast((prev) => [...prev, clips]);
    setClips(newClips);
    setFuture([]);
  }, [clips]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    
    setFuture((prev) => [clips, ...prev]);
    setClips(previous);
    setPast(newPast);
  }, [past, clips]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    
    setPast((prev) => [...prev, clips]);
    setClips(next);
    setFuture(newFuture);
  }, [future, clips]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    if (isPlaying) {
      const startTime = Date.now() - (currentTime * 1000);
      const tick = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= totalDuration) {
          setCurrentTime(totalDuration);
          setIsPlaying(false);
        } else {
          setCurrentTime(elapsed);
          playbackRef.current = requestAnimationFrame(tick);
        }
      };
      playbackRef.current = requestAnimationFrame(tick);
    } else if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
    }

    return () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => setIsPlaying(!isPlaying);
  const reset = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleManipulationStart = () => {
    setTempState(clips);
  };

  const handleManipulationEnd = () => {
    if (tempState && JSON.stringify(tempState) !== JSON.stringify(clips)) {
      setPast((prev) => [...prev, tempState]);
      setFuture([]);
    }
    setTempState(null);
  };

  const resolveOverlaps = (updatedClip: VideoClip, allClips: VideoObjType): VideoObjType => {
    const uStart = updatedClip.timelinePosition.start;
    const uEnd = updatedClip.timelinePosition.end;

    return allClips.map(clip => {
      if (clip.id === updatedClip.id) return updatedClip;

      const cStart = clip.timelinePosition.start;
      const cEnd = clip.timelinePosition.end;

      // No overlap
      if (uStart >= cEnd || uEnd <= cStart) return clip;

      // Full overlap
      if (uStart <= cStart && uEnd >= cEnd) {
        return { ...clip, timelinePosition: { start: cStart, end: cStart } }; // Will be filtered
      }

      // Overlap from left (Updated clip covers the start of existing clip)
      if (uStart <= cStart && uEnd < cEnd) {
        const overlap = uEnd - cStart;
        return {
          ...clip,
          sourceStart: clip.sourceStart + overlap,
          timelinePosition: { start: uEnd, end: cEnd }
        };
      }

      // Overlap from right (Updated clip covers the end of existing clip)
      if (uStart > cStart && uEnd >= cEnd) {
        return {
          ...clip,
          timelinePosition: { start: cStart, end: uStart }
        };
      }

      // Middle overlap (Updated clip is inside existing clip)
      // Contract the side that is "closer" or just the right side to avoid splitting during drag
      if (uStart > cStart && uEnd < cEnd) {
        return {
          ...clip,
          timelinePosition: { start: cStart, end: uStart }
        };
      }

      return clip;
    }).filter(c => c.timelinePosition.end > c.timelinePosition.start);
  };

  const handleRecordingComplete = async (videoUrl: string, duration: number, blob: Blob) => {
    const newId = Date.now();
    const blobId = `blob_${newId}`;
    const newClip: VideoClip = {
      id: newId,
      label: `Recording ${new Date().toLocaleTimeString()}`,
      videoUrl,
      thumbnailUrl: `https://picsum.photos/seed/${newId}/200/120`,
      duration,
      sourceStart: 0,
      timelinePosition: {
        start: recordingStartTime,
        end: recordingStartTime + duration,
      },
      blobId,
    };

    // Save to IndexedDB (both metadata and blob)
    try {
      await videoDB.saveClip(newClip, blob);
      setStorageError(null);
    } catch (err: any) {
      console.error("Failed to save recording to IndexedDB:", err);
      if (err.name === "QuotaExceededError") {
        setStorageError("Storage quota exceeded. Please delete some clips to save new recordings.");
      } else {
        setStorageError("Failed to save recording. Your browser storage might be full or restricted.");
      }
    }

    pushToHistory([...clips, newClip]);
    setIsRecordingMode(false);
  };

  const handleClipUpdate = (clipId: number, newStart: number) => {
    setClips((prev) => {
      const clip = prev.find(c => c.id === clipId);
      if (!clip) return prev;
      
      const duration = clip.timelinePosition.end - clip.timelinePosition.start;
      const updatedClip = {
        ...clip,
        timelinePosition: {
          start: newStart,
          end: newStart + duration,
        },
      };
      
      return resolveOverlaps(updatedClip, prev);
    });
  };

  const handleClipTrim = (clipId: number, side: 'left' | 'right', newTime: number) => {
    setClips((prev) => {
      const clip = prev.find(c => c.id === clipId);
      if (!clip) return prev;

      let updatedClip: VideoClip;

      if (side === 'left') {
        const maxStart = clip.timelinePosition.end - 0.1; // Min 0.1s duration
        const clampedStart = Math.max(0, Math.min(newTime, maxStart));
        const delta = clampedStart - clip.timelinePosition.start;
        
        // Ensure we don't trim before source start
        if (clip.sourceStart + delta < 0) return prev;
        // Ensure we don't trim past source end
        if (clip.sourceStart + delta > clip.duration) return prev;

        updatedClip = {
          ...clip,
          sourceStart: clip.sourceStart + delta,
          timelinePosition: {
            ...clip.timelinePosition,
            start: clampedStart,
          },
        };
      } else {
        const minEnd = clip.timelinePosition.start + 0.1;
        const clampedEnd = Math.max(newTime, minEnd);
        const duration = clampedEnd - clip.timelinePosition.start;
        
        // Ensure we don't trim past source end
        if (clip.sourceStart + duration > clip.duration) return prev;

        updatedClip = {
          ...clip,
          timelinePosition: {
            ...clip.timelinePosition,
            end: clampedEnd,
          },
        };
      }

      return resolveOverlaps(updatedClip, prev);
    });
  };

  const handleSplit = () => {
    const clipToSplit = clips.find(
      (c) => currentTime > c.timelinePosition.start && currentTime < c.timelinePosition.end
    );

    if (clipToSplit) {
      const splitPoint = currentTime;
      const firstClipEnd = splitPoint;
      const secondClipStart = splitPoint;
      const offsetInClip = splitPoint - clipToSplit.timelinePosition.start;

      const firstClip = {
        ...clipToSplit,
        timelinePosition: {
          ...clipToSplit.timelinePosition,
          end: firstClipEnd,
        },
      };

      const secondClip = {
        ...clipToSplit,
        id: Math.max(...clips.map(c => c.id)) + 1,
        sourceStart: clipToSplit.sourceStart + offsetInClip,
        timelinePosition: {
          start: secondClipStart,
          end: clipToSplit.timelinePosition.end,
        },
      };

      const newState = [
        ...clips.filter((c) => c.id !== clipToSplit.id),
        firstClip,
        secondClip,
      ].sort((a, b) => a.timelinePosition.start - b.timelinePosition.start);

      pushToHistory(newState);
    }
  };

  const handleDelete = () => {
    let clipsToDelete: VideoClip[] = [];
    
    if (selectedClipIds.length > 0) {
      clipsToDelete = clips.filter(c => selectedClipIds.includes(c.id));
    } else {
      const clipUnderPlayhead = clips.find(
        (c) => currentTime >= c.timelinePosition.start && currentTime <= c.timelinePosition.end
      );
      if (clipUnderPlayhead) clipsToDelete = [clipUnderPlayhead];
    }

    if (clipsToDelete.length > 0) {
      const deleteIds = clipsToDelete.map(c => c.id);
      const newState = clips.filter((c) => !deleteIds.includes(c.id));
      
      clipsToDelete.forEach(clip => {
        const otherClipsUsingBlob = newState.some(c => c.blobId === clip.blobId);
        videoDB.deleteClip(clip.id, !otherClipsUsingBlob ? clip.blobId : undefined);
      });
      
      pushToHistory(newState);
      setSelectedClipIds([]);
    }
  };

  const handleRippleDelete = () => {
    let clipToDelete: VideoClip | undefined;
    
    if (selectedClipIds.length === 1) {
      clipToDelete = clips.find(c => c.id === selectedClipIds[0]);
    } else if (selectedClipIds.length === 0) {
      clipToDelete = clips.find(
        (c) => currentTime >= c.timelinePosition.start && currentTime <= c.timelinePosition.end
      );
    } else {
      // Ripple delete with multiple selection is ambiguous, 
      // let's just do it for the first one or ignore for now.
      // For simplicity, we'll only support ripple delete for single selection.
      return;
    }

    if (clipToDelete) {
      const duration = clipToDelete.timelinePosition.end - clipToDelete.timelinePosition.start;
      const newState = clips
        .filter((c) => c.id !== clipToDelete.id)
        .map((c) => {
          if (c.timelinePosition.start >= clipToDelete.timelinePosition.end) {
            return {
              ...c,
              timelinePosition: {
                start: c.timelinePosition.start - duration,
                end: c.timelinePosition.end - duration,
              },
            };
          }
          return c;
        });
      
      const otherClipsUsingBlob = newState.some(c => c.blobId === clipToDelete!.blobId);
      videoDB.deleteClip(clipToDelete.id, !otherClipsUsingBlob ? clipToDelete.blobId : undefined);
      
      pushToHistory(newState);
      setSelectedClipIds([]);
    }
  };

  const handleClipRename = (clipId: number, newLabel: string) => {
    const newState = clips.map(c => c.id === clipId ? { ...c, label: newLabel } : c);
    pushToHistory(newState);
  };

  const handleClipDownload = async (clip: VideoClip) => {
    try {
      const isExternal = clip.videoUrl.startsWith('http');
      const downloadUrl = isExternal 
        ? `/api/proxy?url=${encodeURIComponent(clip.videoUrl)}`
        : clip.videoUrl;

      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error('Network response was not ok');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clip.label.replace(/\s+/g, '_')}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadedClipIds(prev => prev.includes(clip.id) ? prev : [...prev, clip.id]);
    } catch (err) {
      console.warn('Proxy download failed, falling back to direct link:', err);
      const a = document.createElement('a');
      a.href = clip.videoUrl;
      a.download = `${clip.label.replace(/\s+/g, '_')}.mp4`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadedClipIds(prev => prev.includes(clip.id) ? prev : [...prev, clip.id]);
    }
  };

  const handleExportZip = async () => {
    setIsExportMenuOpen(false);
    const zip = new JSZip();
    const folder = zip.folder("exported_clips");
    let hasErrors = false;
    
    const downloadPromises = clips.map(async (clip, index) => {
      try {
        const isExternal = clip.videoUrl.startsWith('http');
        const downloadUrl = isExternal 
          ? `/api/proxy?url=${encodeURIComponent(clip.videoUrl)}`
          : clip.videoUrl;

        console.log(`[Export] Fetching clip ${clip.id} from ${downloadUrl}`);
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server responded with ${response.status}: ${errorText}`);
        }
        const blob = await response.blob();
        folder?.file(`${index + 1}_${clip.label.replace(/\s+/g, '_')}.mp4`, blob);
      } catch (err: any) {
        console.error(`[Export] Failed to add clip ${clip.id} to zip:`, err.message);
        hasErrors = true;
      }
    });

    await Promise.all(downloadPromises);

    if (folder && Object.keys(folder.files).length > 0) {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = "timeline_export.zip";
      a.click();
      URL.revokeObjectURL(url);
      
      // Mark all clips as downloaded
      setDownloadedClipIds(prev => {
        const newIds = [...prev];
        clips.forEach(c => {
          if (!newIds.includes(c.id)) newIds.push(c.id);
        });
        return newIds;
      });

      if (hasErrors) {
        alert("Some external clips could not be included in the ZIP due to server restrictions. Your recordings were included successfully.");
      }
    } else {
      alert("Could not export ZIP. Please try downloading clips individually.");
    }
    
    setIsExportMenuOpen(false);
  };

  const handleExportSingle = () => {
    alert("Single video file export requires server-side processing or FFmpeg.wasm. For this demo, please use the 'Compressed Folder' option to get all your clips.");
    setIsExportMenuOpen(false);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const key = e.key.toLowerCase();
      const isShift = e.shiftKey;
      const isAlt = e.altKey || e.metaKey; // metaKey for Mac Cmd

      // r: Start recording
      if (key === 'r' && !isShift) {
        e.preventDefault();
        if (!isRecordingMode) setIsRecordingMode(true);
      }

      // p: Play/Pause
      if (key === 'p') {
        e.preventDefault();
        if (isShift && isAlt) {
          // Shift + Alt + p: Play from start of current clip
          let targetClip: VideoClip | undefined;
          if (selectedClipIds.length > 0) {
            targetClip = clips.find(c => c.id === selectedClipIds[0]);
          } else {
            targetClip = clips.find(c => currentTime >= c.timelinePosition.start && currentTime <= c.timelinePosition.end);
          }
          if (targetClip) {
            setCurrentTime(targetClip.timelinePosition.start);
            setIsPlaying(true);
          }
        } else if (isShift) {
          // Shift + p: Play from start of timeline
          setCurrentTime(0);
          setIsPlaying(true);
        } else {
          // p: Toggle play
          togglePlay();
        }
      }

      // Space: Toggle play (standard)
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }

      // x: Delete
      if (key === 'x') {
        e.preventDefault();
        if (isShift) handleRippleDelete();
        else handleDelete();
      }

      // d: Download
      if (key === 'd') {
        e.preventDefault();
        if (isShift) {
          handleExportZip();
        } else {
          let targetClip: VideoClip | undefined;
          if (selectedClipIds.length > 0) {
            targetClip = clips.find(c => c.id === selectedClipIds[0]);
          } else {
            targetClip = clips.find(c => currentTime >= c.timelinePosition.start && currentTime <= c.timelinePosition.end);
          }
          if (targetClip) handleClipDownload(targetClip);
        }
      }

      // Shift + e: Export single (mp4)
      if (key === 'e' && isShift) {
        e.preventDefault();
        handleExportSingle();
      }

      // s: Split
      if (key === 's') {
        e.preventDefault();
        handleSplit();
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (isShift) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        redo();
      }

      // Navigation
      if (key === 'arrowleft') {
        e.preventDefault();
        const step = isShift ? 1 : 0.1;
        setCurrentTime(prev => Math.max(0, prev - step));
      }
      if (key === 'arrowright') {
        e.preventDefault();
        const step = isShift ? 1 : 0.1;
        setCurrentTime(prev => Math.min(totalDuration, prev + step));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isRecordingMode, 
    clips, 
    currentTime, 
    selectedClipIds, 
    isPlaying, 
    totalDuration, 
    togglePlay, 
    handleDelete, 
    handleRippleDelete, 
    handleSplit, 
    undo, 
    redo, 
    handleExportZip, 
    handleExportSingle, 
    handleClipDownload
  ]);

  return (
    <div className="min-h-screen bg-[#1A1A1A] text-white flex flex-col font-sans">
      {/* Restore Session Prompt */}
      {showRestorePrompt && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 bg-blue-600/20 rounded-xl">
                <History className="text-blue-400" size={24} />
              </div>
              <h2 className="text-xl font-bold">Restore Session?</h2>
            </div>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              We found an existing project from your last visit. Would you like to continue editing or start a new project?
            </p>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={handleRestore}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center space-x-2"
              >
                <span>Continue Editing</span>
              </button>
              <button 
                onClick={handleStartFresh}
                className="w-full bg-white/5 hover:bg-red-600/10 text-gray-400 hover:text-red-400 py-3 rounded-xl font-medium transition-all flex items-center justify-center space-x-2 group"
              >
                <Trash2 size={16} className="group-hover:animate-bounce" />
                <span>Start from Scratch</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Storage Error Banner */}
      {storageError && (
        <div className="bg-red-600 text-white px-4 py-2 text-sm flex justify-between items-center animate-in slide-in-from-top duration-300">
          <div className="flex items-center space-x-2">
            <AlertCircle size={16} />
            <span>{storageError}</span>
          </div>
          <button 
            onClick={() => setStorageError(null)}
            className="p-1 hover:bg-white/20 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#111]">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
              <Video size={18} className="text-white" />
            </div>
            <h1 className="text-sm font-semibold tracking-tight">Studio Recorder</h1>
          </div>
          
          {/* Undo/Redo Controls */}
          <div className="flex items-center space-x-1 border-l border-white/10 pl-6">
            <button 
              onClick={undo}
              disabled={past.length === 0}
              className="p-2 hover:bg-white/5 rounded-md transition-colors text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={18} />
            </button>
            <button 
              onClick={redo}
              disabled={future.length === 0}
              className="p-2 hover:bg-white/5 rounded-md transition-colors text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 size={18} />
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button 
            onClick={() => {
              setIsPlaying(false);
              setRecordingStartTime(currentTime);
              setIsRecordingMode(true);
            }}
            className="flex items-center space-x-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 px-3 py-1.5 rounded-md text-xs font-medium border border-red-500/20 transition-colors"
          >
            <Radio size={14} className="animate-pulse" />
            <span>Record</span>
          </button>
          <button className="text-xs text-gray-400 hover:text-white transition-colors">Project Settings</button>
          
          <div className="relative">
            <button 
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-colors"
            >
              <Download size={14} />
              <span>Export</span>
              <ChevronDown size={14} className={`transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isExportMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[110] py-1 overflow-hidden">
                <button 
                  onClick={handleExportZip}
                  className="w-full flex items-center space-x-3 px-4 py-2.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                >
                  <Archive size={16} className="text-blue-400" />
                  <div className="flex flex-col">
                    <span className="font-medium">Compressed Folder (.zip)</span>
                    <span className="text-[10px] text-gray-500">All clips as separate files</span>
                  </div>
                </button>
                <button 
                  onClick={handleExportSingle}
                  className="w-full flex items-center space-x-3 px-4 py-2.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors text-left border-t border-white/5"
                >
                  <FileVideo size={16} className="text-emerald-400" />
                  <div className="flex flex-col">
                    <span className="font-medium">Single Video File (.mp4)</span>
                    <span className="text-[10px] text-gray-500">Combined timeline sequence</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow flex flex-col items-center justify-center p-8 bg-gradient-to-b from-[#1A1A1A] to-[#0D0D0D]">
        {/* Video Preview Area */}
        <div className="w-full max-w-4xl aspect-video relative group">
          <VideoPreview 
            clips={clips} 
            currentTime={currentTime} 
            isPlaying={isPlaying} 
          />
          
          {/* Overlay Play Button (Visible on hover or when paused) */}
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/20 group-hover:bg-black/40 transition-colors pointer-events-none">
              <div 
                className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 scale-110 pointer-events-auto cursor-pointer" 
                onClick={togglePlay}
              >
                <Play size={32} className="ml-1" />
              </div>
            </div>
          )}
        </div>

        {/* Playback Controls */}
        <div className="mt-8 flex items-center space-x-8">
          <div className="flex items-center space-x-4">
            <button onClick={reset} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-white">
              <SkipBack size={20} />
            </button>
            <button 
              onClick={togglePlay}
              className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors shadow-lg"
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
            </button>
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-white">
              <SkipForward size={20} />
            </button>
          </div>
        </div>
      </main>

      {/* Timeline Section */}
      <section className="bg-white text-black">
        <Timeline 
          clips={clips} 
          currentTime={currentTime} 
          onTimeChange={(time) => {
            setCurrentTime(time);
            if (isPlaying) setIsPlaying(false);
          }}
          onClipUpdate={handleClipUpdate}
          onClipTrim={handleClipTrim}
          onClipRename={handleClipRename}
          onClipDownload={handleClipDownload}
          onManipulationStart={handleManipulationStart}
          onManipulationEnd={handleManipulationEnd}
          onSplit={handleSplit}
          onDelete={handleDelete}
          onRippleDelete={handleRippleDelete}
          selectedClipIds={selectedClipIds}
          onSelectionChange={setSelectedClipIds}
          downloadedClipIds={downloadedClipIds}
          totalDuration={totalDuration}
        />
      </section>

      {/* Recorder Overlay */}
      {isRecordingMode && (
        <Recorder 
          onRecordingComplete={handleRecordingComplete}
          onClose={() => setIsRecordingMode(false)}
        />
      )}
    </div>
  );
}
