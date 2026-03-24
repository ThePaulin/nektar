import { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import JSZip from 'jszip';
import { Timeline } from './components/Timeline';
import { VideoPreview } from './components/VideoPreview';
import { ExportDialog } from './components/ExportDialog';
import { Recorder } from './components/Recorder';
import { AudioRecorder } from './components/AudioRecorder';
import { ClipPropertiesPanel } from './components/ClipPropertiesPanel';
import { TrackActionArea } from './components/TrackActionArea';
import { VideoObjType, VideoClip, RecordingMode, Track, TrackType } from './types';
import { videoDB } from './services/db';
import {
  Play, Pause, SkipBack, SkipForward, Video, Download, Undo2, Redo2, Radio,
  ChevronDown, Archive, FileVideo, History, Trash2, AlertCircle, X, Upload,
  MousePointer2, ArrowRightToLine, Plus, Layers, Music, Type as TypeIcon, Subtitles, Image as ImageIcon
} from 'lucide-react';

const TIMELINE_MAX_HEIGHT: number = 623;
const TIMELINE_MIN_HEIGHT: number = 315;

const INITIAL_TRACKS: Track[] = [
  { id: 'track-1', name: 'Video 1', type: TrackType.VIDEO, isVisible: true, isLocked: false, isMuted: false, isArmed: true, order: 0 },
  { id: 'track-2', name: 'Audio 1', type: TrackType.AUDIO, isVisible: true, isLocked: false, isMuted: false, isArmed: true, order: 1 },
];

const MOCK_CLIPS: VideoObjType = [
  {
    id: 1,
    trackId: 'track-1',
    label: "Big Buck Bunny",
    type: TrackType.VIDEO,
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
    trackId: 'track-1',
    label: "Elephant's Dream",
    type: TrackType.VIDEO,
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    thumbnailUrl: "https://picsum.photos/seed/elephant/200/120",
    duration: 15,
    sourceStart: 0,
    timelinePosition: {
      start: 15,
      end: 30,
    }
  }
];

export default function App() {
  const [clips, setClips] = useState<VideoObjType>([]);
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [selectedTrackId, setSelectedTrackId] = useState<string>(INITIAL_TRACKS[0].id);
  const [isInitialized, setIsInitialized] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('insert');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(500);
  const [isResizing, setIsResizing] = useState(false);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [pendingRestoredClips, setPendingRestoredClips] = useState<VideoObjType | null>(null);
  const [pendingRestoredTracks, setPendingRestoredTracks] = useState<Track[] | null>(null);
  const [past, setPast] = useState<VideoObjType[]>([]);
  const [future, setFuture] = useState<VideoObjType[]>([]);
  const [tempState, setTempState] = useState<VideoObjType | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<number[]>([]);
  const [downloadedClipIds, setDownloadedClipIds] = useState<number[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const [currentTime, setCurrentTime] = useState(0);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40);
  const [trackHeightMode, setTrackHeightMode] = useState<'sm' | 'md' | 'lg'>('md');
  const [exportRange, setExportRange] = useState<{ start: number; end: number }>({ start: 0, end: 60 });
  const [totalDuration, setTotalDuration] = useState(60);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const maxEnd = Math.max(60, ...clips.map(c => c.timelinePosition.end));
    setTotalDuration(Math.round(maxEnd * 30) / 30);
  }, [clips]);

  useEffect(() => {
    const checkDB = async () => {
      try {
        const storedClips = await videoDB.getClips();
        const storedTracks = await videoDB.getTracks();
        if (storedClips && storedClips.length > 0) {
          setPendingRestoredClips(storedClips);
          setPendingRestoredTracks(storedTracks && storedTracks.length > 0 ? storedTracks : INITIAL_TRACKS);
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
      if (isInitialized) {
        try {
          await Promise.all([
            videoDB.saveAllClips(clips),
            videoDB.saveTracks(tracks),
            videoDB.saveSettings('currentTime', currentTime),
            videoDB.saveSettings('exportRange', exportRange),
            videoDB.saveSettings('downloadedClipIds', downloadedClipIds),
            videoDB.saveSettings('timelineHeight', timelineHeight),
            videoDB.saveSettings('selectedTrackId', selectedTrackId),
            videoDB.saveSettings('recordingMode', recordingMode),
            videoDB.saveSettings('pixelsPerSecond', pixelsPerSecond),
            videoDB.saveSettings('trackHeightMode', trackHeightMode),
          ]);
        } catch (err: any) {
          console.error("Failed to sync metadata to IndexedDB:", err);
          if (err.name === "QuotaExceededError") {
            setStorageError("Storage quota exceeded. Metadata sync failed.");
          }
        }
      }
    };
    syncMetadata();
  }, [clips, tracks, currentTime, exportRange, downloadedClipIds, timelineHeight, selectedTrackId, recordingMode, pixelsPerSecond, trackHeightMode, isInitialized]);

  const handleRestore = async () => {
    if (!pendingRestoredClips) return;

    setIsLoading(true);
    setLoadingMessage('Restoring session...');
    try {
      const restoredClips = await Promise.all(pendingRestoredClips.map(async (clip) => {
        if (clip.blobId) {
          const blob = await videoDB.getBlob(clip.blobId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            const isImage = clip.type === TrackType.IMAGE;
            return {
              ...clip,
              videoUrl: isImage ? undefined : url,
              thumbnailUrl: isImage ? url : clip.thumbnailUrl
            };
          }
        }
        return clip;
      }));

      if (pendingRestoredTracks) {
        setTracks(pendingRestoredTracks.sort((a, b) => a.order - b.order));
      }
      setClips(restoredClips);

      // Restore settings
      const [restoredTime, restoredRange, restoredDownloads, restoredHeight, restoredTrackId, restoredRecMode, restoredPixelsPerSecond, restoredTrackHeightMode] = await Promise.all([
        videoDB.getSettings('currentTime'),
        videoDB.getSettings('exportRange'),
        videoDB.getSettings('downloadedClipIds'),
        videoDB.getSettings('timelineHeight'),
        videoDB.getSettings('selectedTrackId'),
        videoDB.getSettings('recordingMode'),
        videoDB.getSettings('pixelsPerSecond'),
        videoDB.getSettings('trackHeightMode'),
      ]);

      if (restoredTime !== undefined) setCurrentTime(restoredTime);
      if (restoredRange !== undefined) setExportRange(restoredRange);
      if (restoredDownloads !== undefined) setDownloadedClipIds(restoredDownloads);
      if (restoredHeight !== undefined) setTimelineHeight(restoredHeight);
      if (restoredTrackId !== undefined) setSelectedTrackId(restoredTrackId);
      if (restoredRecMode !== undefined) setRecordingMode(restoredRecMode);
      if (restoredPixelsPerSecond !== undefined) setPixelsPerSecond(restoredPixelsPerSecond);
      if (restoredTrackHeightMode !== undefined) setTrackHeightMode(restoredTrackHeightMode);

      setPast([]);
      setFuture([]);
      setShowRestorePrompt(false);
      setIsInitialized(true);
    } catch (err) {
      console.error("Failed to restore session:", err);
      handleStartFresh();
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleStartFresh = async () => {
    setIsLoading(true);
    setLoadingMessage('Starting fresh...');
    try {
      await videoDB.clearAll();
      setClips(MOCK_CLIPS);
      setTracks(INITIAL_TRACKS);
      setCurrentTime(0);
      setExportRange({ start: 0, end: 60 });
      setDownloadedClipIds([]);
      setTimelineHeight(500);
      setSelectedTrackId(INITIAL_TRACKS[0].id);
      setRecordingMode('insert');
      setPixelsPerSecond(40);
      setTrackHeightMode('md');
      setPast([]);
      setFuture([]);
      setShowRestorePrompt(false);
      setIsInitialized(true);
    } catch (err) {
      console.error("Failed to clear DB:", err);
      setClips(MOCK_CLIPS);
      setIsInitialized(true);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const pushToHistory = useCallback((newClips: VideoObjType) => {
    setPast((prev) => [...prev, clips]);
    setClips(newClips);
    setFuture([]);
  }, [clips]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const isTrackLocked = (trackId: string) => {
    return tracks.find(t => t.id === trackId)?.isLocked || false;
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const targetTrack = tracks.find(t => t.id === selectedTrackId);
    if (!targetTrack) return;

    if (targetTrack.isLocked) {
      alert('This track is locked and cannot be modified.');
      return;
    }

    // Validate file type based on track type
    if (targetTrack.type === TrackType.VIDEO && !file.type.startsWith('video/')) {
      alert('Please select a valid video file for a video track.');
      return;
    }
    if (targetTrack.type === TrackType.AUDIO && !file.type.startsWith('audio/')) {
      alert('Please select a valid audio file for an audio track.');
      return;
    }
    if (targetTrack.type === TrackType.IMAGE && !file.type.startsWith('image/')) {
      alert('Please select a valid image file for an image track.');
      return;
    }

    setIsLoading(true);
    setLoadingMessage(`Importing ${file.name}...`);

    const startTime = getModeStartTime();

    try {
      const videoUrl = URL.createObjectURL(file);

      let duration = 5; // Default for images

      if (targetTrack.type === TrackType.VIDEO || targetTrack.type === TrackType.AUDIO) {
        // Get duration
        duration = await new Promise<number>((resolve, reject) => {
          const media = document.createElement(targetTrack.type === TrackType.VIDEO ? 'video' : 'audio');
          media.preload = 'metadata';
          media.src = videoUrl;
          media.onloadedmetadata = () => {
            resolve(media.duration);
          };
          media.onerror = () => {
            reject(new Error('Failed to load media metadata.'));
          };
        });
      }

      const newId = Date.now();
      const blobId = `blob_${newId}`;

      const newClip: VideoClip = {
        id: newId,
        trackId: selectedTrackId,
        label: file.name.split('.')[0],
        type: targetTrack.type,
        videoUrl: targetTrack.type !== TrackType.IMAGE ? videoUrl : undefined,
        thumbnailUrl: targetTrack.type === TrackType.IMAGE ? videoUrl : `https://picsum.photos/seed/${newId}/200/120`,
        duration,
        sourceStart: 0,
        timelinePosition: {
          start: startTime,
          end: startTime + Math.min(duration, 5),
        },
        blobId,
      };

      const clipDuration = newClip.timelinePosition.end - newClip.timelinePosition.start;
      let updatedClips = [...clips];
      if (recordingMode === 'insert' || recordingMode === 'append') {
        updatedClips = updatedClips.map(clip => {
          if (clip.trackId === selectedTrackId && clip.timelinePosition.start >= startTime) {
            return {
              ...clip,
              timelinePosition: {
                start: clip.timelinePosition.start + clipDuration,
                end: clip.timelinePosition.end + clipDuration
              }
            };
          }
          return clip;
        });
      }

      await videoDB.saveClip(newClip, file);
      const finalClips = resolveOverlaps(newClip, [...updatedClips, newClip]);
      pushToHistory(finalClips);
      setSelectedClipIds([newId]);
      setStorageError(null);
    } catch (err: any) {
      console.error("Failed to import clip:", err);
      setStorageError("Failed to import clip. Your browser storage might be full or the file is corrupted.");
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
          setCurrentTime(Math.round(totalDuration * 30) / 30);
          setIsPlaying(false);
        } else {
          setCurrentTime(Math.round(elapsed * 30) / 30);
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

  const resolveOverlaps = (updatedClip: VideoClip, allClips: VideoObjType, ignoreIds: number[] = []): VideoObjType => {
    const uStart = updatedClip.timelinePosition.start;
    const uEnd = updatedClip.timelinePosition.end;

    return allClips.map(clip => {
      if (clip.id === updatedClip.id) return updatedClip;
      if (ignoreIds.includes(clip.id)) return clip;
      if (clip.trackId !== updatedClip.trackId) return clip;

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

  const getModeStartTime = useCallback(() => {
    if (recordingMode === 'insert') {
      return currentTime;
    } else {
      // For append mode, we find the end of the last clip on the selected track
      const trackClips = clips.filter(c => c.trackId === selectedTrackId);
      if (trackClips.length > 0) {
        return Math.max(...trackClips.map(c => c.timelinePosition.end));
      }
      return 0;
    }
  }, [recordingMode, currentTime, clips, selectedTrackId]);

  const handleStartRecording = () => {
    const targetTrack = tracks.find(t => t.id === selectedTrackId);
    if (!targetTrack) return;

    if (targetTrack.type === TrackType.VIDEO || targetTrack.type === TrackType.AUDIO) {
      if (!targetTrack.isArmed) {
        alert('Track must be armed for recording. Please arm the track first.');
        return;
      }
    }

    setIsPlaying(false);
    const startTime = getModeStartTime();
    setRecordingStartTime(startTime);
    if (recordingMode === 'append') {
      setCurrentTime(startTime);
    }
  };

  const handleRecordingComplete = async (videoUrl: string, duration: number, blob: Blob) => {
    const targetTrack = tracks.find(t => t.id === selectedTrackId);
    if (!targetTrack) return;

    if (targetTrack.isLocked) {
      alert('This track is locked and cannot be modified.');
      return;
    }

    const newId = Date.now();
    const blobId = `blob_${newId}`;
    const isImage = targetTrack.type === TrackType.IMAGE;
    const finalDuration = isImage ? 5 : duration;

    const newClip: VideoClip = {
      id: newId,
      trackId: selectedTrackId,
      type: targetTrack.type,
      label: isImage ? `Photo ${new Date().toLocaleTimeString()}` : `Recording ${new Date().toLocaleTimeString()}`,
      videoUrl: isImage ? undefined : videoUrl,
      thumbnailUrl: isImage ? videoUrl : `https://picsum.photos/seed/${newId}/200/120`,
      duration: finalDuration,
      sourceStart: 0,
      timelinePosition: {
        start: recordingStartTime,
        end: recordingStartTime + finalDuration,
      },
      blobId,
    };

    // If in insert or append mode, shift all subsequent clips forward on the same track
    let updatedClips = [...clips];
    if (recordingMode === 'insert' || recordingMode === 'append') {
      updatedClips = updatedClips.map(clip => {
        if (clip.trackId === selectedTrackId && clip.timelinePosition.start >= recordingStartTime) {
          return {
            ...clip,
            timelinePosition: {
              start: clip.timelinePosition.start + finalDuration,
              end: clip.timelinePosition.end + finalDuration
            }
          };
        }
        return clip;
      });
    }

    // Save to IndexedDB (both metadata and blob)
    setIsLoading(true);
    setLoadingMessage('Saving recording...');
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
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }

    // Apply resolveOverlaps to handle any remaining edge cases (like clips that spanned the insertion point)
    const finalClips = resolveOverlaps(newClip, [...updatedClips, newClip]);
    pushToHistory(finalClips);
    setSelectedClipIds([newId]);
  };

  const handleClipsUpdate = (updates: { id: number; newStart: number; newTrackId?: string }[]) => {
    // Check if any of the clips are on locked tracks
    const isAnyClipLocked = updates.some(u => {
      const clip = clips.find(c => c.id === u.id);
      if (!clip) return false;
      if (isTrackLocked(clip.trackId)) return true;
      if (u.newTrackId && isTrackLocked(u.newTrackId)) return true;
      return false;
    });

    if (isAnyClipLocked) return;

    setClips((prev) => {
      let nextClips = [...prev];
      const updateIds = updates.map(u => u.id);
      const updatedClips: VideoClip[] = [];

      updates.forEach(({ id, newStart, newTrackId }) => {
        const index = nextClips.findIndex(c => c.id === id);
        if (index !== -1) {
          const clip = nextClips[index];
          const duration = clip.timelinePosition.end - clip.timelinePosition.start;
          const clampedStart = Math.max(0, newStart);
          const updated = {
            ...clip,
            trackId: newTrackId || clip.trackId,
            timelinePosition: {
              start: clampedStart,
              end: clampedStart + duration,
            },
          };
          nextClips[index] = updated;
          updatedClips.push(updated);
        }
      });

      // Resolve overlaps for each updated clip against non-moving clips
      updatedClips.forEach(updatedClip => {
        nextClips = resolveOverlaps(updatedClip, nextClips, updateIds);
      });

      return nextClips;
    });
  };

  const handleAddTrack = (type: TrackType) => {
    const newTrack: Track = {
      id: `track-${Date.now()}`,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${tracks.filter(t => t.type === type).length + 1}`,
      type,
      isVisible: true,
      isLocked: false,
      isMuted: false,
      isArmed: type === TrackType.VIDEO || type === TrackType.AUDIO || type === TrackType.SCREEN || type === TrackType.IMAGE,
      order: tracks.length,
    };
    setTracks([...tracks, newTrack]);
    setSelectedTrackId(newTrack.id);
  };

  const handleDeleteTrack = (trackId: string) => {
    if (tracks.length <= 1) return;
    const remainingTracks = tracks.filter(t => t.id !== trackId).map((t, i) => ({
      ...t,
      order: i
    }));
    setTracks(remainingTracks);
    setClips(clips.filter(c => c.trackId !== trackId));
    if (selectedTrackId === trackId) {
      setSelectedTrackId(remainingTracks[0]?.id || '');
    }
  };

  const handleDuplicateTrack = (trackId: string) => {
    const trackToDup = tracks.find(t => t.id === trackId);
    if (!trackToDup) return;

    const newTrackId = `track-${Date.now()}`;
    const newTrack: Track = {
      ...trackToDup,
      id: newTrackId,
      name: `${trackToDup.name} (Copy)`,
      order: tracks.length,
    };

    const newClips = clips
      .filter(c => c.trackId === trackId)
      .map(c => ({
        ...c,
        id: Date.now() + Math.random(),
        trackId: newTrackId,
      }));

    setTracks([...tracks, newTrack]);
    pushToHistory([...clips, ...newClips]);
    setSelectedTrackId(newTrackId);
    setSelectedClipIds(newClips.map(c => c.id));
  };

  const handleUpdateTrack = (trackId: string, updates: Partial<Track>) => {
    setTracks(tracks.map(t => t.id === trackId ? { ...t, ...updates } : t));
  };

  const handleAddTextClip = async (type: TrackType.TEXT | TrackType.SUBTITLE, startTimeOverride?: number, trackIdOverride?: string) => {
    const finalTrackId = trackIdOverride || selectedTrackId;
    const targetTrack = tracks.find(t => t.id === finalTrackId && t.type === type);
    if (!targetTrack) {
      alert(`Please select a ${type} track first.`);
      return;
    }

    if (targetTrack.isLocked) {
      alert('This track is locked and cannot be modified.');
      return;
    }

    const newId = Date.now();
    const startTime = getModeStartTime();
    const actualStartTime = Math.max(0, startTimeOverride !== undefined ? startTimeOverride : startTime);
    const newClip: VideoClip = {
      id: newId,
      trackId: finalTrackId,
      label: type === TrackType.TEXT ? 'New Text' : 'New Subtitle',
      type,
      content: type === TrackType.TEXT ? 'Enter text here' : 'Enter subtitle here',
      duration: 5,
      sourceStart: 0,
      timelinePosition: {
        start: actualStartTime,
        end: actualStartTime + 5,
      },
      style: {
        fontSize: 48,
        color: '#ffffff',
        backgroundColor: 'transparent',
      }
    };

    const clipDuration = newClip.timelinePosition.end - newClip.timelinePosition.start;
    let updatedClips = [...clips];
    if (recordingMode === 'insert' || recordingMode === 'append') {
      updatedClips = updatedClips.map(clip => {
        if (clip.trackId === finalTrackId && clip.timelinePosition.start >= actualStartTime) {
          return {
            ...clip,
            timelinePosition: {
              start: clip.timelinePosition.start + clipDuration,
              end: clip.timelinePosition.end + clipDuration
            }
          };
        }
        return clip;
      });
    }

    try {
      await videoDB.saveClip(newClip);
      setStorageError(null);
    } catch (err) {
      console.error("Failed to save text clip to IndexedDB:", err);
    }

    const finalClips = resolveOverlaps(newClip, [...updatedClips, newClip]);
    pushToHistory(finalClips);
    setSelectedClipIds([newId]);
  };

  const handleClipTrim = (clipId: number, side: 'left' | 'right', newTime: number) => {
    const clipToTrim = clips.find(c => c.id === clipId);
    if (clipToTrim && isTrackLocked(clipToTrim.trackId)) return;

    setClips((prev) => {
      const clip = prev.find(c => c.id === clipId);
      if (!clip) return prev;

      let updatedClip: VideoClip;

      const isMedia = clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO;

      if (side === 'left') {
        const maxStart = clip.timelinePosition.end - 0.1; // Min 0.1s duration
        const clampedStart = Math.max(0, Math.min(newTime, maxStart));
        const delta = clampedStart - clip.timelinePosition.start;

        if (isMedia) {
          // Ensure we don't trim before source start
          if (clip.sourceStart + delta < 0) return prev;
          // Ensure we don't trim past source end
          if (clip.sourceStart + delta > clip.duration) return prev;
        }

        updatedClip = {
          ...clip,
          sourceStart: isMedia ? clip.sourceStart + delta : clip.sourceStart,
          timelinePosition: {
            ...clip.timelinePosition,
            start: clampedStart,
          },
        };
      } else {
        const minEnd = clip.timelinePosition.start + 0.1;
        const clampedEnd = Math.max(newTime, minEnd);
        const duration = clampedEnd - clip.timelinePosition.start;

        if (isMedia) {
          // Ensure we don't trim past source end
          if (clip.sourceStart + duration > clip.duration) return prev;
        }

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
      if (isTrackLocked(clipToSplit.trackId)) {
        alert('This track is locked and cannot be modified.');
        return;
      }
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
      setSelectedClipIds([secondClip.id]);
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

    // Filter out clips on locked tracks
    clipsToDelete = clipsToDelete.filter(c => !isTrackLocked(c.trackId));

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
    let clipsToDelete: VideoClip[] = [];

    if (selectedClipIds.length > 0) {
      clipsToDelete = clips.filter(c => selectedClipIds.includes(c.id));
    } else {
      const clipUnderPlayhead = clips.find(
        (c) => currentTime >= c.timelinePosition.start && currentTime <= c.timelinePosition.end
      );
      if (clipUnderPlayhead) clipsToDelete = [clipUnderPlayhead];
    }

    // Filter out clips on locked tracks
    clipsToDelete = clipsToDelete.filter(c => !isTrackLocked(c.trackId));

    if (clipsToDelete.length > 0) {
      let newState = [...clips];

      // Sort clips to delete by start time descending to shift correctly
      const sortedToDelete = [...clipsToDelete].sort((a, b) => b.timelinePosition.start - a.timelinePosition.start);

      sortedToDelete.forEach(clip => {
        const duration = clip.timelinePosition.end - clip.timelinePosition.start;
        const start = clip.timelinePosition.start;

        newState = newState.filter(c => c.id !== clip.id).map(c => {
          if (c.trackId === clip.trackId && c.timelinePosition.start >= start) {
            return {
              ...c,
              timelinePosition: {
                start: Math.max(0, c.timelinePosition.start - duration),
                end: Math.max(0, c.timelinePosition.end - duration)
              }
            };
          }
          return c;
        });

        // Cleanup IndexedDB
        const otherClipsUsingBlob = newState.some(c => c.blobId === clip.blobId);
        videoDB.deleteClip(clip.id, !otherClipsUsingBlob ? clip.blobId : undefined);
      });

      pushToHistory(newState);
      setSelectedClipIds([]);
    }
  };

  const handleClipRename = (clipId: number, newLabel: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip && isTrackLocked(clip.trackId)) return;
    const newState = clips.map(c => c.id === clipId ? { ...c, label: newLabel } : c);
    pushToHistory(newState);
  };

  const handleClipContentUpdate = (clipId: number, newContent: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip && isTrackLocked(clip.trackId)) return;
    const newState = clips.map(c => c.id === clipId ? { ...c, content: newContent } : c);
    pushToHistory(newState);
  };

  const handleClipUpdate = (clipId: number, updates: Partial<VideoClip>) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip && isTrackLocked(clip.trackId)) return;
    const newState = clips.map(c => c.id === clipId ? { ...c, ...updates } : c);
    pushToHistory(newState);
  };

  const handleClipDownload = async (clip: VideoClip) => {
    setIsLoading(true);
    setLoadingMessage(`Downloading ${clip.label}...`);
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
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleMoveTrack = (id: string, direction: 'up' | 'down') => {
    const index = tracks.findIndex(t => t.id === id);
    if (index === -1) return;

    const newTracks = [...tracks];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < tracks.length) {
      const temp = newTracks[index];
      newTracks[index] = newTracks[targetIndex];
      newTracks[targetIndex] = temp;
      
      // Update order property for all tracks based on their new positions
      const orderedTracks = newTracks.map((track, i) => ({
        ...track,
        order: i
      }));
      
      setTracks(orderedTracks);
    }
  };

  const handleReorderTracks = (newTracks: Track[]) => {
    const orderedTracks = newTracks.map((track, i) => ({
      ...track,
      order: i
    }));
    setTracks(orderedTracks);
  };

  const handleExportZip = async () => {
    setIsExportMenuOpen(false);
    setIsLoading(true);
    setLoadingMessage('Preparing ZIP export...');
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

    // Add project manifest with track hierarchy
    const projectManifest = {
      version: "1.0",
      exportDate: new Date().toISOString(),
      tracks: tracks.map((t, idx) => ({
        ...t,
        layerPriority: tracks.length - idx // Top track has highest priority
      })),
      clips: clips.map(c => ({
        ...c,
        layerPriority: tracks.length - tracks.findIndex(t => t.id === c.trackId)
      }))
    };
    zip.file("project.json", JSON.stringify(projectManifest, null, 2));

    await Promise.all(downloadPromises);

    if (folder && Object.keys(folder.files).length > 0) {
      setLoadingMessage('Generating ZIP file...');
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
    setIsLoading(false);
    setLoadingMessage('');
  };

  const handleExportSingle = () => {
    console.log(`[App] Opening export dialog with range: ${exportRange.start}s to ${exportRange.end}s`);
    setIsExporting(true);
    setIsExportMenuOpen(false);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Escape: Deselect all and blur inputs
      if (key === 'escape') {
        setSelectedClipIds([]);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        return;
      }

      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isShift = e.shiftKey;
      const isAlt = e.altKey;
      const isMod = e.ctrlKey || e.metaKey;

      // Mod + I: Import clip
      if (key === 'i' && isMod && !isAlt) {
        e.preventDefault();
        handleImportClick();
      }

      // Mod + A: Select All
      if (key === 'a' && isMod && !isShift && !isAlt) {
        e.preventDefault();
        setSelectedClipIds(clips.map(c => c.id));
      }

      const selectedTrack = tracks.find(t => t.id === selectedTrackId);
      const isAudioOrVideoTrack = selectedTrack?.type === TrackType.AUDIO || selectedTrack?.type === TrackType.VIDEO;

      // Alt + I: Insert Mode
      if (key === 'i' && isShift && isAudioOrVideoTrack) {
        e.preventDefault();
        setRecordingMode('insert');
      }

      // Alt + A: Append Mode
      if (key === 'a' && isShift && isAudioOrVideoTrack) {
        e.preventDefault();
        setRecordingMode('append');
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
      if (isMod && key === 'z') {
        e.preventDefault();
        if (isShift) redo();
        else undo();
      }
      if (isMod && key === 'y') {
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
    clips,
    tracks,
    selectedTrackId,
    currentTime,
    recordingMode,
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
    handleClipDownload,
    handleImportClick
  ]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = window.innerHeight - e.clientY;

      // handle min height allowed
      if (newHeight < TIMELINE_MIN_HEIGHT) {
        setTimelineHeight(TIMELINE_MIN_HEIGHT);
        return;
      }

      // handle max height allowed
      if (newHeight > TIMELINE_MAX_HEIGHT) {
        setTimelineHeight(TIMELINE_MAX_HEIGHT);
        return;
      }

      // default case (handle allowed height range)
      setTimelineHeight(Math.max(150, Math.min(window.innerHeight - 200, newHeight)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div className="min-h-screen bg-[#1A1A1A] text-white flex flex-col font-sans overscroll-none">
      {/* Restore Session Prompt */}
      {showRestorePrompt && (
        <div className="fixed inset-0 z-[400] bg-black/80 flex items-center justify-center p-4 backdrop-blur-md">
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
      <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#111] shrink-0">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
              <Video size={18} className="text-white" />
            </div>
            <h1 className="text-sm font-semibold tracking-tight">Studio Recorder</h1>
          </div>

          {selectedClipIds.length > 0 && (
            <div className="flex items-center space-x-2 bg-blue-600/20 text-blue-400 px-2 py-1 rounded border border-blue-600/30 animate-in fade-in duration-300">
              <span className="text-[10px] font-bold uppercase tracking-wider">{selectedClipIds.length} selected</span>
              <button
                onClick={() => setSelectedClipIds([])}
                className="hover:text-white transition-colors"
                title="Deselect All (Esc)"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Undo/Redo Controls */}
          <div className="flex items-center space-x-1 border-l border-white/10 pl-6">
            <button
              onClick={undo}
              disabled={past.length === 0}
              className="p-2 hover:bg-white/5 rounded-md transition-colors text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
              title="Undo (Ctrl/Cmd + Z)"
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={redo}
              disabled={future.length === 0}
              className="p-2 hover:bg-white/5 rounded-md transition-colors text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
              title="Redo (Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y)"
            >
              <Redo2 size={18} />
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Recording Mode Toggles */}
          <div className="flex items-center bg-white/5 rounded-md p-0.5 border border-white/10">
            <button
              onClick={() => setRecordingMode('insert')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-sm text-[10px] font-medium transition-all ${recordingMode === 'insert'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
                }`}
              title="Insert Mode (Shift+I): Record at playhead"
            >
              <MousePointer2 size={12} />
              <span>Insert</span>
            </button>
            <button
              onClick={() => setRecordingMode('append')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-sm text-[10px] font-medium transition-all ${recordingMode === 'append'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
                }`}
              title="Append Mode (Shift+A): Record at end of timeline"
            >
              <ArrowRightToLine size={12} />
              <span>Append</span>
            </button>
          </div>

          <button
            onClick={handleImportClick}
            className="flex items-center space-x-2 bg-white/5 hover:bg-white/10 text-gray-300 px-3 py-1.5 rounded-md text-xs font-medium border border-white/10 transition-colors"
            title="Import Video (Ctrl/Cmd + I)"
          >
            <Upload size={14} />
            <span>Import</span>
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
                    <span className="font-medium">Single Video File (mp4/webm)</span>
                    <span className="text-[10px] text-gray-500">Combined timeline sequence</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Loader */}
      {isLoading && (
        <div className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-8 flex flex-col items-center space-y-4 shadow-2xl animate-in zoom-in duration-300">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 border-4 border-blue-600/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-sm font-medium text-white">{loadingMessage || 'Processing...'}</span>
              <span className="text-[10px] text-gray-500 mt-1">Please wait a moment</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-grow min-h-0 flex items-start justify-end p-4 bg-gradient-to-b from-[#1A1A1A] to-[#0D0D0D] overflow-hidden"
      >
        <div className="relative w-full flex justify-end overflow-hidden items-start gap-8"

          style={{ height: `${((window.innerHeight ?? 0) - timelineHeight)}px` }}
        >
          {/* Left Side: Recorder or Info Card */}
          <div className="h-full w-full max-h-[300px] min-h-0 flex justify-end slide-in-from-left duration-500">
            {selectedClipIds.length === 1 ? (
              <div className="w-full h-full flex justify-center overflow-y-auto">
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#111] rounded-xl border border-white/5">
                  <div className="p-6 bg-white/5 rounded-2xl border border-white/10 mb-4">
                    {(() => {
                      const clip = clips.find(c => c.id === selectedClipIds[0]);
                      if (clip?.type === TrackType.VIDEO) return <Video size={24} className="text-blue-500/50" />;
                      if (clip?.type === TrackType.AUDIO) return <Music size={24} className="text-emerald-500/50" />;
                      if (clip?.type === TrackType.TEXT || clip?.type === TrackType.SUBTITLE) return <TypeIcon size={24} className="text-blue-400/50" />;
                      return <ImageIcon size={24} className="text-amber-500/50" />;
                    })()}
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">{clips.find(c => c.id === selectedClipIds[0])?.label}</h3>
                  <p className="text-gray-500 text-xs uppercase tracking-widest font-bold">{clips.find(c => c.id === selectedClipIds[0])?.type} Clip Selected</p>
                </div>
              </div>
            ) : (
              <div className="w-fit h-full  overflow-hidden">
                {(() => {
                  const targetTrack = tracks.find(t => t.id === selectedTrackId);
                  if (!targetTrack) return null;

                  if (targetTrack.type === TrackType.VIDEO || targetTrack.type === TrackType.SCREEN) {
                    return targetTrack.isArmed ? (
                      <Recorder
                        onRecordingComplete={handleRecordingComplete}
                        onStartRecording={handleStartRecording}
                        isActive={true}
                        isArmed={true}
                        trackType={targetTrack.type}
                      />
                    ) : (
                      <TrackActionArea
                        track={targetTrack}
                        recordingMode={recordingMode}
                        onImport={handleImportClick}
                        onAddText={() => { }}
                        onArm={() => handleUpdateTrack(targetTrack.id, { isArmed: true })}
                      />
                    );
                  }

                  if (targetTrack.type === TrackType.AUDIO) {
                    return targetTrack.isArmed ? (
                      <AudioRecorder
                        onRecordingComplete={handleRecordingComplete}
                        onStartRecording={handleStartRecording}
                        isActive={true}
                        isArmed={true}
                      />
                    ) : (
                      <TrackActionArea
                        track={targetTrack}
                        recordingMode={recordingMode}
                        onImport={handleImportClick}
                        onAddText={() => { }}
                        onArm={() => handleUpdateTrack(targetTrack.id, { isArmed: true })}
                      />
                    );
                  }

                  if (targetTrack.type === TrackType.IMAGE) {
                    return targetTrack.isArmed ? (
                      <Recorder
                        onRecordingComplete={handleRecordingComplete}
                        onStartRecording={handleStartRecording}
                        isActive={true}
                        isArmed={true}
                        trackType={targetTrack.type}
                      />
                    ) : (
                      <TrackActionArea
                        track={targetTrack}
                        recordingMode={recordingMode}
                        onImport={handleImportClick}
                        onAddText={() => { }}
                        onArm={() => handleUpdateTrack(targetTrack.id, { isArmed: true })}
                      />
                    );
                  }

                  if (targetTrack.type === TrackType.TEXT || targetTrack.type === TrackType.SUBTITLE) {
                    return (
                      <TrackActionArea
                        track={targetTrack}
                        recordingMode={recordingMode}
                        onImport={() => { }}
                        onAddText={() => handleAddTextClip(targetTrack.type as TrackType.TEXT | TrackType.SUBTITLE)}
                        onArm={() => handleUpdateTrack(targetTrack.id, { isArmed: true })}
                      />
                    );
                  }

                  return null;
                })()}
              </div>
            )}
          </div>

          {/* Right Side: Video Preview Area & Properties */}
          <div className="flex h-full shrink-0">
            <div className="w-fit h-full flex flex-col items-center justify-start">
              <div className="h-full w-fit group overflow-hidden border border-white/10 shadow-2xl">
                <VideoPreview
                  clips={clips}
                  tracks={tracks}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                />
              </div>
            </div>

            {/* Properties Panel */}
            {selectedClipIds.length === 1 && clips.find(c => c.id === selectedClipIds[0]) && (
              <ClipPropertiesPanel 
                clip={clips.find(c => c.id === selectedClipIds[0])!}
                onUpdate={handleClipUpdate}
              />
            )}
          </div>
        </div>
      </main >

      {/* Resize Handle */}
      < div
        className="h-1 bg-white/5 hover:bg-blue-600/50 cursor-row-resize transition-colors z-[100] shrink-0"
        onMouseDown={() => setIsResizing(true)
        }
      />

      {/* Timeline Section */}
      <section className="bg-white text-black overflow-hidden shrink-0" style={{ height: `${timelineHeight}px` }}>
        <div className="h-full max-h-full overflow-hidden">
          <Timeline
            clips={clips}
            tracks={tracks}
            selectedTrackId={selectedTrackId}
            onTrackSelect={setSelectedTrackId}
            onTrackUpdate={handleUpdateTrack}
            onTrackDelete={handleDeleteTrack}
            onTrackDuplicate={handleDuplicateTrack}
            onTrackMove={handleMoveTrack}
            onTracksReorder={handleReorderTracks}
            onAddTrack={handleAddTrack}
            onAddTextClip={handleAddTextClip}
            currentTime={currentTime}
            onTimeChange={(time) => {
              const clampedTime = Math.max(0, time);
              setCurrentTime(clampedTime);
              if (isPlaying) setIsPlaying(false);
            }}
            onClipsUpdate={handleClipsUpdate}
            onClipTrim={handleClipTrim}
            onClipRename={handleClipRename}
            onClipContentUpdate={handleClipContentUpdate}
            onClipUpdate={handleClipUpdate}
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
            exportRange={exportRange}
            onExportRangeChange={setExportRange}
            pixelsPerSecond={pixelsPerSecond}
            onPixelsPerSecondChange={setPixelsPerSecond}
            trackHeightMode={trackHeightMode}
            onTrackHeightModeChange={setTrackHeightMode}
          />
        </div>
      </section>

      {isExporting && (
        <ExportDialog
          clips={clips}
          tracks={tracks}
          totalDuration={totalDuration}
          exportRange={exportRange}
          onClose={() => setIsExporting(false)}
        />
      )}

      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="video/*,audio/*,image/*"
        className="hidden"
      />
    </div >
  );
}
