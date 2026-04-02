import React, { useRef, useEffect, useState } from 'react';
import { motion, Reorder } from 'motion/react';
import {
  Plus, Scissors, Trash2, ZoomIn, ZoomOut, Download, CheckCircle2,
  Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, MoreVertical, Copy, Trash,
  ChevronUp, ChevronDown, Radio, GripVertical
} from 'lucide-react';
import { VideoClip, VideoObjType, Track, TrackType } from '../types';
import { ThumbnailStrip } from './ThumbnailStrip';

interface TimelineProps {
  clips: VideoObjType;
  tracks: Track[];
  selectedTrackId: string;
  currentTime: number;
  onTimeChange: (time: number) => void;
  onClipsUpdate?: (updates: { id: number; newStart: number; newTrackId?: string }[]) => void;
  onClipTrim?: (clipId: number, side: 'left' | 'right', newTime: number) => void;
  onClipRename?: (clipId: number, newLabel: string) => void;
  onClipContentUpdate?: (clipId: number, newContent: string) => void;
  onClipUpdate?: (clipId: number, updates: Partial<VideoClip>) => void;
  onClipDownload?: (clip: VideoClip) => void;
  onManipulationStart?: () => void;
  onManipulationEnd?: () => void;
  onSplit?: () => void;
  onDelete?: () => void;
  onRippleDelete?: () => void;
  selectedClipIds?: number[];
  downloadedClipIds?: number[];
  onSelectionChange?: (ids: number[]) => void;
  onTrackSelect: (id: string) => void;
  onTrackUpdate: (id: string, updates: Partial<Track>) => void;
  onTrackDelete: (id: string) => void;
  onTrackDuplicate: (id: string) => void;
  onTrackMove: (id: string, direction: 'up' | 'down') => void;
  onTracksReorder: (newTracks: Track[]) => void;
  onAddTrack: (type: TrackType) => void;
  onAddTextClip?: (type: TrackType.TEXT | TrackType.SUBTITLE, startTime?: number, trackId?: string) => void;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (value: number) => void;
  trackHeightMode: TrackHeightMode;
  onTrackHeightModeChange: (mode: TrackHeightMode) => void;
  totalDuration?: number;
  exportRange: { start: number; end: number };
  onExportRangeChange: (range: { start: number; end: number }) => void;
}

const TRACK_HEADER_WIDTH = 200;

type TrackHeightMode = 'sm' | 'md' | 'lg';

const TRACK_HEIGHTS: Record<TrackHeightMode, number> = {
  sm: 48,
  md: 80,
  lg: 120
};

const FPS = 30;
const FRAME_DURATION = 1 / FPS;

const snapToFrame = (time: number) => Math.round(time * FPS) / FPS;

export const Timeline: React.FC<TimelineProps> = ({
  clips,
  tracks,
  selectedTrackId,
  currentTime,
  onTimeChange,
  onClipsUpdate,
  onClipTrim,
  onClipRename,
  onClipDownload,
  onManipulationStart,
  onManipulationEnd,
  onSplit,
  onDelete,
  onRippleDelete,
  selectedClipIds = [],
  downloadedClipIds = [],
  onSelectionChange,
  onTrackSelect,
  onTrackUpdate,
  onTrackDelete,
  onTrackDuplicate,
  onTrackMove,
  onTracksReorder,
  onAddTrack,
  onAddTextClip,
  onClipContentUpdate,
  onClipUpdate,
  pixelsPerSecond,
  onPixelsPerSecondChange,
  trackHeightMode,
  onTrackHeightModeChange,
  totalDuration = 60,
  exportRange,
  onExportRangeChange,
}) => {
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [draggingExportMarker, setDraggingExportMarker] = useState<'start' | 'end' | null>(null);
  const [draggingClipId, setDraggingClipId] = useState<number | null>(null);
  const [trimmingClipId, setTrimmingClipId] = useState<{ id: number; side: 'left' | 'right' } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [editingClipId, setEditingClipId] = useState<number | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [trackEditValue, setTrackEditValue] = useState('');
  const [snappedPoint, setSnappedPoint] = useState<number | null>(null);
  const [initialDragPositions, setInitialDragPositions] = useState<{ [id: number]: { start: number; trackId: string } }>({});
  const [selectionRect, setSelectionRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const trackHeight = TRACK_HEIGHTS[trackHeightMode];
  const [hasDragged, setHasDragged] = useState(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const initialSelectionRef = useRef<number[]>([]);

  const SNAP_THRESHOLD_PX = 10;

  useEffect(() => {
    const timelineEl = timelineRootRef.current;
    if (!timelineEl) return;

    const handleWheel = (e: WheelEvent) => {
      // If we are scrolling horizontally
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const tracksEl = tracksScrollRef.current;
        if (tracksEl) {
          // Prevent default to block browser navigation gestures
          e.preventDefault();
          // Manually update scroll position
          tracksEl.scrollLeft += e.deltaX;
        }
      }
    };

    timelineEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => timelineEl.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (tracksScrollRef.current) {
      const viewportWidth = tracksScrollRef.current.clientWidth;
      const playheadPos = currentTime * pixelsPerSecond;
      const newScrollLeft = playheadPos - viewportWidth / 2;
      tracksScrollRef.current.scrollLeft = newScrollLeft;
      if (headerScrollRef.current) {
        headerScrollRef.current.scrollLeft = newScrollLeft;
      }
    }
  }, [pixelsPerSecond]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor(Math.round((seconds % 1) * FPS));
    return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  const handlePlayheadDrag = (e: MouseEvent | TouchEvent) => {
    if (isDraggingPlayhead && tracksScrollRef.current) {
      const rect = tracksScrollRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left + tracksScrollRef.current.scrollLeft;
      let newTime = snapToFrame(Math.max(0, Math.min(totalDuration, x / pixelsPerSecond)));

      const snapPoints = [0, totalDuration, ...clips.flatMap(c => [c.timelinePosition.start, c.timelinePosition.end])];
      let foundSnap = false;
      for (const point of snapPoints) {
        if (Math.abs(newTime * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
          newTime = point;
          setSnappedPoint(point);
          foundSnap = true;
          break;
        }
      }
      if (!foundSnap) setSnappedPoint(null);

      onTimeChange(newTime);
    }
  };

  const handleExportMarkerDrag = (e: MouseEvent | TouchEvent) => {
    if (draggingExportMarker && tracksScrollRef.current) {
      const rect = tracksScrollRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left + tracksScrollRef.current.scrollLeft;
      let newTime = snapToFrame(Math.max(0, Math.min(totalDuration, x / pixelsPerSecond)));

      if (draggingExportMarker === 'start') {
        onExportRangeChange({ ...exportRange, start: Math.min(newTime, exportRange.end) });
      } else {
        onExportRangeChange({ ...exportRange, end: Math.max(newTime, exportRange.start) });
      }
    }
  };

  const handleClipDrag = (e: MouseEvent | TouchEvent) => {
    if (draggingClipId !== null && tracksScrollRef.current && onClipsUpdate) {
      const anchorInitial = initialDragPositions[draggingClipId];
      if (!anchorInitial) return;

      setHasDragged(true);
      const rect = tracksScrollRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const x = clientX - rect.left + tracksScrollRef.current.scrollLeft;
      const y = clientY - rect.top;

      let newAnchorStart = snapToFrame((x - dragOffset) / pixelsPerSecond);
      if (isNaN(newAnchorStart)) return;

      // Snapping logic
      const otherClips = clips.filter(c => !selectedClipIds.includes(c.id));
      const snapPoints = [0, currentTime, ...otherClips.flatMap(c => [c.timelinePosition.start, c.timelinePosition.end])].filter(p => !isNaN(p));
      const anchorClip = clips.find(c => c.id === draggingClipId);

      let foundSnap = false;
      if (anchorClip) {
        const duration = anchorClip.timelinePosition.end - anchorClip.timelinePosition.start;
        for (const point of snapPoints) {
          if (Math.abs(newAnchorStart * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
            newAnchorStart = point;
            setSnappedPoint(point);
            foundSnap = true;
            break;
          }
          if (Math.abs((newAnchorStart + duration) * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
            newAnchorStart = point - duration;
            setSnappedPoint(point);
            foundSnap = true;
            break;
          }
        }
      }
      if (!foundSnap) setSnappedPoint(null);

      let deltaX = newAnchorStart - anchorInitial.start;

      // Clamp deltaX so that no selected clip starts before 0
      const minStart = Math.min(...selectedClipIds.map(id => initialDragPositions[id]?.start || 0));
      if (minStart + deltaX < 0) {
        deltaX = -minStart;
      }

      // Track switching logic
      const trackIndex = Math.floor(y / trackHeight);
      const targetTrack = tracks[trackIndex];
      
      // Prevent moving to a locked track
      if (targetTrack && targetTrack.isLocked) return;

      let newTrackId = anchorInitial.trackId;

      if (targetTrack && anchorClip && targetTrack.type === anchorClip.type) {
        newTrackId = targetTrack.id;
      }

      const updates = selectedClipIds.map((id): { id: number; newStart: number; newTrackId?: string } | null => {
        const initial = initialDragPositions[id];
        if (!initial) return null;

        return {
          id,
          newStart: initial.start + deltaX,
          newTrackId: id === draggingClipId ? newTrackId : undefined
        };
      }).filter((u): u is { id: number; newStart: number; newTrackId?: string } => u !== null);

      onClipsUpdate(updates);
    }
  };

  const handleTrimDrag = (e: MouseEvent | TouchEvent) => {
    if (trimmingClipId !== null && tracksScrollRef.current && onClipTrim) {
      const rect = tracksScrollRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left + tracksScrollRef.current.scrollLeft;
      let newTime = snapToFrame(x / pixelsPerSecond);

      const snapPoints = [0, currentTime, ...clips.flatMap(c => c.id !== trimmingClipId.id ? [c.timelinePosition.start, c.timelinePosition.end] : [])];
      let foundSnap = false;
      for (const point of snapPoints) {
        if (Math.abs(newTime * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
          newTime = point;
          setSnappedPoint(point);
          foundSnap = true;
          break;
        }
      }
      if (!foundSnap) setSnappedPoint(null);

      onClipTrim(trimmingClipId.id, trimmingClipId.side, Math.max(0, newTime));
    }
  };

  const handleClipSelection = (e: React.MouseEvent | MouseEvent, clipId: number) => {
    if (!onSelectionChange) return selectedClipIds;

    const isSelected = selectedClipIds.includes(clipId);
    let currentSelectedIds = [...selectedClipIds];

    if (e.shiftKey) {
      if (isSelected) {
        currentSelectedIds = selectedClipIds.filter(id => id !== clipId);
      } else {
        currentSelectedIds = [...selectedClipIds, clipId];
      }
    } else {
      if (!isSelected) {
        currentSelectedIds = [clipId];
      }
    }

    onSelectionChange(currentSelectedIds);
    return currentSelectedIds;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelecting || !tracksScrollRef.current || !selectionStartRef.current) return;

      const rect = tracksScrollRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + tracksScrollRef.current.scrollLeft;
      const y = e.clientY - rect.top;

      const startX = selectionStartRef.current.x;
      const startY = selectionStartRef.current.y;

      setSelectionRect({ startX, startY, endX: x, endY: y });

      if (onSelectionChange) {
        const x1 = Math.min(startX, x);
        const x2 = Math.max(startX, x);
        const y1 = Math.min(startY, y);
        const y2 = Math.max(startY, y);

        const marqueeSelectedIds = clips.filter(clip => {
          const track = tracks.find(t => t.id === clip.trackId);
          if (track?.isLocked) return false;

          const clipX1 = clip.timelinePosition.start * pixelsPerSecond;
          const clipX2 = clip.timelinePosition.end * pixelsPerSecond;

          const trackIndex = tracks.findIndex(t => t.id === clip.trackId);
          const clipY1 = trackIndex * trackHeight;
          const clipY2 = clipY1 + trackHeight;

          return (
            clipX1 < x2 &&
            clipX2 > x1 &&
            clipY1 < y2 &&
            clipY2 > y1
          );
        }).map(c => c.id);

        if (e.shiftKey) {
          const combined = Array.from(new Set([...initialSelectionRef.current, ...marqueeSelectedIds]));
          onSelectionChange(combined);
        } else {
          onSelectionChange(marqueeSelectedIds);
        }
      }
    };

    const handleMouseUp = () => {
      setIsSelecting(false);
      setSelectionRect(null);
      selectionStartRef.current = null;
      initialSelectionRef.current = [];
    };

    if (isSelecting) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSelecting, clips, pixelsPerSecond, onSelectionChange, tracks]);

  useEffect(() => {
    const onPlayheadMouseUp = () => {
      setIsDraggingPlayhead(false);
      setSnappedPoint(null);
    };

    const onExportMarkerMouseUp = () => {
      setDraggingExportMarker(null);
    };

    const onClipMouseUp = () => {
      if (!hasDragged && draggingClipId !== null && onSelectionChange) {
        onSelectionChange([draggingClipId]);
      }
      setDraggingClipId(null);
      setSnappedPoint(null);
      setHasDragged(false);
      onManipulationEnd?.();
    };

    const onTrimMouseUp = () => {
      setTrimmingClipId(null);
      setSnappedPoint(null);
      onManipulationEnd?.();
    };

    if (isDraggingPlayhead) {
      window.addEventListener('mousemove', handlePlayheadDrag);
      window.addEventListener('mouseup', onPlayheadMouseUp);
    }
    if (draggingExportMarker) {
      window.addEventListener('mousemove', handleExportMarkerDrag);
      window.addEventListener('mouseup', onExportMarkerMouseUp);
    }
    if (draggingClipId !== null) {
      window.addEventListener('mousemove', handleClipDrag);
      window.addEventListener('mouseup', onClipMouseUp);
    }
    if (trimmingClipId !== null) {
      window.addEventListener('mousemove', handleTrimDrag);
      window.addEventListener('mouseup', onTrimMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handlePlayheadDrag);
      window.removeEventListener('mouseup', onPlayheadMouseUp);
      window.removeEventListener('mousemove', handleExportMarkerDrag);
      window.removeEventListener('mouseup', onExportMarkerMouseUp);
      window.removeEventListener('mousemove', handleClipDrag);
      window.removeEventListener('mouseup', onClipMouseUp);
      window.removeEventListener('mousemove', handleTrimDrag);
      window.removeEventListener('mouseup', onTrimMouseUp);
    };
  }, [isDraggingPlayhead, draggingClipId, trimmingClipId, pixelsPerSecond, handlePlayheadDrag, handleClipDrag, handleTrimDrag, hasDragged, onSelectionChange, onManipulationEnd]);

  const getTickInterval = () => {
    if (pixelsPerSecond < 10) return 10;
    if (pixelsPerSecond < 20) return 5;
    if (pixelsPerSecond < 50) return 2;
    if (pixelsPerSecond < 100) return 1;
    return 0.5;
  };

  const tickInterval = getTickInterval();
  const ticks = [];
  for (let i = 0; i <= totalDuration; i += tickInterval) {
    ticks.push(i);
  }

  const handleZoom = (newZoom: number) => {
    const clampedZoom = Math.max(5, Math.min(500, newZoom));
    onPixelsPerSecondChange(clampedZoom);
  };

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    if (headerScrollRef.current) {
      const rect = headerScrollRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + headerScrollRef.current.scrollLeft;
      let newTime = snapToFrame(Math.max(0, Math.min(totalDuration, x / pixelsPerSecond)));

      // Handle Command/Ctrl + Click for Start Marker
      if (e.metaKey || e.ctrlKey) {
        onExportRangeChange({ ...exportRange, start: Math.min(newTime, exportRange.end) });
        return;
      }

      // Handle Alt + Click for End Marker
      if (e.altKey) {
        onExportRangeChange({ ...exportRange, end: Math.max(newTime, exportRange.start) });
        return;
      }

      // Snapping logic
      const snapPoints = [0, totalDuration, ...clips.flatMap(c => [c.timelinePosition.start, c.timelinePosition.end])];
      let foundSnap = false;
      for (const point of snapPoints) {
        if (Math.abs(newTime * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
          newTime = point;
          setSnappedPoint(point);
          foundSnap = true;
          break;
        }
      }
      if (!foundSnap) setSnappedPoint(null);

      onTimeChange(newTime);
      setIsDraggingPlayhead(true);
    }
  };

  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    if (tracksScrollRef.current) {
      const rect = tracksScrollRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + tracksScrollRef.current.scrollLeft;
      const y = e.clientY - rect.top;

      const snappedTime = snapToFrame(Math.max(0, Math.min(totalDuration, x / pixelsPerSecond)));
      onTimeChange(snappedTime);

      setIsSelecting(true);
      selectionStartRef.current = { x, y };
      initialSelectionRef.current = e.shiftKey ? [...selectedClipIds] : [];
      setSelectionRect({ startX: x, startY: y, endX: x, endY: y });

      if (onSelectionChange && !e.shiftKey) {
        onSelectionChange([]);
      }
    }
  };

  const handleTracksScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const startEditing = (clip: VideoClip) => {
    setEditingClipId(clip.id);
    setEditValue(clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE ? (clip.content || '') : clip.label);
  };

  const saveEdit = (clipId: number) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
      const newLabel = editValue.slice(0, 20) + (editValue.length > 20 ? '...' : '');
      if (onClipUpdate) {
        onClipUpdate(clipId, { content: editValue, label: newLabel });
      } else {
        if (onClipContentUpdate) onClipContentUpdate(clipId, editValue);
        if (onClipRename) onClipRename(clipId, newLabel);
      }
    } else {
      if (editValue.trim()) {
        if (onClipUpdate) {
          onClipUpdate(clipId, { label: editValue.trim() });
        } else if (onClipRename) {
          onClipRename(clipId, editValue.trim());
        }
      }
    }
    setEditingClipId(null);
  };

  const startEditingTrack = (track: Track) => {
    setEditingTrackId(track.id);
    setTrackEditValue(track.name);
  };

  const saveTrackEdit = (trackId: string) => {
    if (trackEditValue.trim()) {
      onTrackUpdate(trackId, { name: trackEditValue.trim() });
    }
    setEditingTrackId(null);
  };

  return (
    <div
      ref={timelineRootRef}
      className={`relative flex flex-col w-full bg-[#F5F5F5] border-t border-gray-200 select-none h-full overflow-hidden overscroll-x-none touch-pan-y ${isDraggingPlayhead || draggingClipId !== null || trimmingClipId !== null || isSelecting ? 'cursor-grabbing' : ''
        }`}
    >
      {/* Header Row */}
      <div className="flex h-8 shrink-0 border-b border-gray-300 z-[80]">
        <div className="w-[200px] shrink-0 bg-gray-50 border-r border-gray-200 flex items-center px-3">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tracks</span>
        </div>
        <div
          ref={headerScrollRef}
          className="flex-1 overflow-hidden overscroll-x-none relative bg-[#F5F5F5] cursor-pointer"
          onMouseDown={handleRulerMouseDown}
        >
          <div style={{ width: totalDuration * pixelsPerSecond + 100 }} className="h-full relative">
            {/* Export Range Highlight */}
            <div
              className="absolute top-0 bottom-0 bg-blue-500/10 pointer-events-none"
              style={{
                left: exportRange.start * pixelsPerSecond,
                width: (exportRange.end - exportRange.start) * pixelsPerSecond
              }}
            />
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute flex flex-col items-center bottom-0"
                style={{ left: tick * pixelsPerSecond }}
              >
                <div className="relative">
                  <span className="absolute bottom-0 text-[10px] text-gray-500 mb-1">{formatTime(tick)}</span>
                </div>
                <div className="w-px h-2 bg-gray-300" />
              </div>
            ))}

            {/* Export Start Marker */}
            <div
              className="absolute top-0 h-full z-[90] flex flex-col items-center"
              style={{ left: exportRange.start * pixelsPerSecond }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setDraggingExportMarker('start');
              }}
            >
              <div className="w-3 h-3 bg-blue-500 rotate-45 -translate-x-1/2 mt-1 cursor-col-resize shadow-sm" />
              <div className="w-px h-full bg-blue-500/30" />
            </div>

            {/* Export End Marker */}
            <div
              className="absolute top-0 h-full z-[90] flex flex-col items-center"
              style={{ left: exportRange.end * pixelsPerSecond }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setDraggingExportMarker('end');
              }}
            >
              <div className="w-3 h-3 bg-blue-500 rotate-45 -translate-x-1/2 mt-1 cursor-col-resize shadow-sm" />
              <div className="w-px h-full bg-blue-500/30" />
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="pb-[2%] flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full">
          {/* Sidebar Body */}
          <div className="w-[200px] shrink-0 bg-white border-r border-gray-200 flex flex-col">
            <Reorder.Group
              axis="y"
              values={tracks}
              onReorder={onTracksReorder}
              className="flex flex-col"
            >
              {tracks.map((track) => (
                <Reorder.Item
                  key={track.id}
                  value={track}
                  onDragStart={() => setDraggingTrackId(track.id)}
                  onDragEnd={() => setDraggingTrackId(null)}
                  whileDrag={{ 
                    scale: 1.01, 
                    backgroundColor: "#f8fafc",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                    zIndex: 50
                  }}
                  className="border-b border-gray-100 px-3 flex flex-col justify-center space-y-1 cursor-pointer transition-all hover:bg-gray-50 bg-white relative"
                  style={{
                    height: trackHeight,
                    backgroundColor: selectedTrackId === track.id ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                  }}
                  onClick={() => onTrackSelect(track.id)}
                >
                  {draggingTrackId === track.id && (
                    <div className="absolute inset-0 border-2 border-blue-500/50 pointer-events-none z-10" />
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 overflow-hidden">
                      <div className="cursor-grab active:cursor-grabbing p-0.5 text-gray-300 hover:text-gray-500 transition-colors">
                        <GripVertical size={12} />
                      </div>
                      {editingTrackId === track.id ? (
                        <input
                          autoFocus
                          className="bg-white/10 border-none outline-none text-xs font-medium text-blue-600 w-full rounded px-1"
                          value={trackEditValue}
                          onChange={(e) => setTrackEditValue(e.target.value)}
                          onBlur={() => saveTrackEdit(track.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveTrackEdit(track.id);
                            }
                            if (e.key === 'Escape') {
                              setEditingTrackId(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className={`text-xs font-medium truncate cursor-text hover:text-blue-500 transition-colors ${selectedTrackId === track.id ? 'text-blue-600' : 'text-gray-700'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectedTrackId === track.id) {
                              startEditingTrack(track);
                            } else {
                              onTrackSelect(track.id);
                            }
                          }}
                        >
                          {track.name}
                        </span>
                      )}
                    </div>
                    <div className={`flex items-center space-x-1 ${trackHeightMode === 'sm' ? 'scale-90 origin-right' : ''}`}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onTrackUpdate(track.id, { isVisible: !track.isVisible }); }}
                        className={`p-1 rounded hover:bg-gray-200 transition-colors ${track.isVisible ? 'text-gray-400' : 'text-blue-500'}`}
                      >
                        {track.isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onTrackUpdate(track.id, { isLocked: !track.isLocked }); }}
                        className={`p-1 rounded hover:bg-gray-200 transition-colors ${track.isLocked ? 'text-amber-500' : 'text-gray-400'}`}
                      >
                        {track.isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                      </button>
                      {(track.type === TrackType.VIDEO || track.type === TrackType.AUDIO || track.type === TrackType.IMAGE || track.type === TrackType.SCREEN) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onTrackUpdate(track.id, { isArmed: !track.isArmed }); }}
                          className={`p-1 rounded hover:bg-gray-200 transition-colors ${track.isArmed ? 'text-red-500' : 'text-gray-400'}`}
                          title={track.isArmed ? "Disarm Track" : "Arm for Recording"}
                        >
                          <Radio size={12} className={track.isArmed ? "animate-pulse" : ""} />
                        </button>
                      )}
                      {track.type === TrackType.AUDIO && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onTrackUpdate(track.id, { isMuted: !track.isMuted }); }}
                          className={`p-1 rounded hover:bg-gray-200 transition-colors ${track.isMuted ? 'text-red-500' : 'text-gray-400'}`}
                        >
                          {track.isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`flex items-center space-x-2 ${trackHeightMode === 'sm' ? 'scale-90 origin-left' : ''}`}>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase font-bold">
                      {track.type}
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onTrackMove(track.id, 'up'); }}
                        disabled={tracks.indexOf(track) === 0}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Move Track Up"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onTrackMove(track.id, 'down'); }}
                        disabled={tracks.indexOf(track) === tracks.length - 1}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Move Track Down"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onTrackDuplicate(track.id); }}
                      className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                      title="Duplicate Track"
                    >
                      <Copy size={10} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onTrackDelete(track.id); }}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                      title="Delete Track"
                    >
                      <Trash size={10} />
                    </button>
                  </div>
                </Reorder.Item>
              ))}
            </Reorder.Group>
            {/* redundant section removed
            <div className="p-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onAddTrack(TrackType.VIDEO)}
                  className="flex items-center justify-center space-x-1 py-1.5 px-2 rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-[10px] font-medium"
                >
                  <Plus size={10} />
                  <span>Video</span>
                </button>
                <button
                  onClick={() => onAddTrack(TrackType.AUDIO)}
                  className="flex items-center justify-center space-x-1 py-1.5 px-2 rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-[10px] font-medium"
                >
                  <Plus size={10} />
                  <span>Audio</span>
                </button>
                <button
                  onClick={() => onAddTrack(TrackType.TEXT)}
                  className="flex items-center justify-center space-x-1 py-1.5 px-2 rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-[10px] font-medium"
                >
                  <Plus size={10} />
                  <span>Text</span>
                </button>
                <button
                  onClick={() => onAddTrack(TrackType.IMAGE)}
                  className="flex items-center justify-center space-x-1 py-1.5 px-2 rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-[10px] font-medium"
                >
                  <Plus size={10} />
                  <span>Image</span>
                </button>
              </div>
            </div> 
            */}
          </div>
          {/* Tracks Area */}
          <div
            ref={tracksScrollRef}
            className="flex-1 relative overflow-x-auto overflow-y-hidden overscroll-x-none touch-pan-y scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
            onMouseDown={handleTimelineMouseDown}
            onScroll={handleTracksScroll}
          >
            <div
              className="relative min-h-full"
              style={{ width: totalDuration * pixelsPerSecond + 100 }}
            >
              {/* Tracks Area */}
              <div className="relative">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className={`relative border-b border-gray-200/50 transition-all ${selectedTrackId === track.id ? 'bg-blue-50/20' : ''} ${track.isLocked ? 'bg-gray-100/5' : ''} ${draggingTrackId === track.id ? 'bg-blue-500/5 ring-1 ring-inset ring-blue-500/20' : ''}`}
                    style={{ height: trackHeight }}
                    onDoubleClick={(e) => {
                      if (track.isLocked) return;
                      if (track.type === TrackType.TEXT || track.type === TrackType.SUBTITLE) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const startTime = snapToFrame(x / pixelsPerSecond);
                        onTimeChange(startTime);
                        onTrackSelect(track.id);
                        onAddTextClip?.(track.type as TrackType.TEXT | TrackType.SUBTITLE, startTime, track.id);
                      }
                    }}
                  >
                    {/* Drop Indicator Lines */}
                    {draggingTrackId === track.id && (
                      <>
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-50 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 z-50 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                        <div className="absolute inset-0 bg-blue-500/5 pointer-events-none" />
                      </>
                    )}
                    {/* Grid Lines */}
                    <div className="absolute inset-0 pointer-events-none">
                      {ticks.map((tick) => (
                        <div
                          key={`grid-${track.id}-${tick}`}
                          className="absolute top-0 bottom-0 w-px bg-gray-200/30"
                          style={{ left: tick * pixelsPerSecond }}
                        />
                      ))}
                    </div>

                    {/* Clips for this track */}
                    {clips.filter(c => c.trackId === track.id).map((clip) => {
                      const isSelected = selectedClipIds.includes(clip.id);
                      const start = clip.timelinePosition.start;
                      const end = clip.timelinePosition.end;
                      const duration = end - start;

                      if (isNaN(start) || isNaN(end)) return null;

                      return (
                        <div
                          key={clip.id}
                          className={`absolute top-2 bg-black rounded-md border-2 overflow-hidden group shadow-lg transition-[border-color,transform,shadow,ring] ${track.isLocked ? 'border-gray-700 opacity-60 cursor-not-allowed grayscale-[0.5]' :
                            draggingClipId === clip.id ? 'border-blue-500 z-40 scale-[1.02] shadow-blue-500/30 !transition-none cursor-grabbing' :
                              isSelected ? 'border-blue-500 z-30 shadow-blue-500/40 ring-2 ring-blue-500/20 cursor-grab' : 'border-gray-800 cursor-grab active:cursor-grabbing'
                            }`}
                          style={{
                            left: start * pixelsPerSecond,
                            width: duration * pixelsPerSecond,
                            height: trackHeight - 16
                          }}
                          onMouseDown={(e) => {
                            if (track.isLocked) return;
                            e.stopPropagation();
                            e.preventDefault();

                            const currentSelectedIds = handleClipSelection(e, clip.id);
                            const rect = e.currentTarget.getBoundingClientRect();
                            setDragOffset(e.clientX - rect.left);
                            setDraggingClipId(clip.id);

                            const positions: { [id: number]: { start: number; trackId: string } } = {};
                            clips.forEach(c => {
                              if (currentSelectedIds.includes(c.id)) {
                                positions[c.id] = { start: c.timelinePosition.start, trackId: c.trackId };
                              }
                            });
                            setInitialDragPositions(positions);
                            onManipulationStart?.();
                          }}
                          onDoubleClick={(e) => {
                            if (track.isLocked) return;
                            e.stopPropagation();
                            startEditing(clip);
                          }}
                          onKeyDown={(e) => {
                            if (track.isLocked) return;
                            if (e.key === 'Enter' && selectedClipIds.includes(clip.id) && editingClipId === null) {
                              e.stopPropagation();
                              startEditing(clip);
                            }
                          }}
                          tabIndex={0}
                        >
                          {track.isLocked && (
                            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 pointer-events-none">
                              <Lock size={16} className="text-white/40" />
                            </div>
                          )}
                          {clip.type === TrackType.VIDEO || clip.type === TrackType.IMAGE || clip.type === TrackType.SCREEN ? (
                            <ThumbnailStrip
                              videoUrl={clip.videoUrl || clip.thumbnailUrl || ''}
                              duration={clip.duration}
                              sourceStart={clip.sourceStart}
                              pixelsPerSecond={pixelsPerSecond}
                              clipWidth={duration * pixelsPerSecond}
                            />
                          ) : (
                            <div className={`w-full h-full flex items-center justify-center ${clip.type === TrackType.AUDIO ? 'bg-emerald-900/40' :
                              clip.type === TrackType.TEXT ? 'bg-purple-900/40' : 'bg-amber-900/40'
                              }`}>
                              <span className="text-[10px] text-white/50 font-bold uppercase tracking-widest">{clip.type}</span>
                            </div>
                          )}

                          <div className={`absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center space-x-1.5 group/label transition-colors ${isSelected ? 'bg-blue-600' : ''
                            }`}>
                            {isSelected && <CheckCircle2 size={10} className="text-white" />}
                            {editingClipId === clip.id ? (
                              <input
                                autoFocus
                                className="bg-transparent border-none outline-none w-24 text-white"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => saveEdit(clip.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    saveEdit(clip.id);
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingClipId(null);
                                  }
                                }}
                              />
                            ) : (
                              <span
                                className="cursor-text hover:text-blue-400 transition-colors"
                                onClick={(e) => { e.stopPropagation(); startEditing(clip); }}
                              >
                                {clip.label}
                              </span>
                            )}
                          </div>

                          <button
                            className={`absolute top-1 right-1 p-1 bg-black/60 rounded opacity-0 group-hover:opacity-100 transition-all z-50 ${downloadedClipIds.includes(clip.id) ? 'text-emerald-400' : 'text-white/60 hover:text-white hover:bg-blue-600'
                              }`}
                            onClick={() => onClipDownload?.(clip)}
                          >
                            <Download size={12} />
                          </button>

                          <div className="absolute bottom-1 right-1 text-white/60 text-[10px] font-mono">
                            {duration.toFixed(1)}s
                          </div>

                          <div className={`absolute inset-0 border-2 pointer-events-none transition-all duration-200 ${isSelected ? 'border-blue-500 bg-blue-500/10' : 'border-transparent group-hover:border-blue-500/30'
                            }`} />

                          <div
                            className={`absolute left-0 top-0 bottom-0 w-2 bg-blue-500/0 ${track.isLocked ? '' : 'group-hover:bg-blue-500/40 cursor-col-resize'} z-50 transition-colors`}
                            onMouseDown={(e) => {
                              if (track.isLocked) return;
                              e.stopPropagation();
                              handleClipSelection(e, clip.id);
                              setTrimmingClipId({ id: clip.id, side: 'left' });
                              onManipulationStart?.();
                            }}
                          />
                          <div
                            className={`absolute right-0 top-0 bottom-0 w-2 bg-blue-500/0 ${track.isLocked ? '' : 'group-hover:bg-blue-500/40 cursor-col-resize'} z-50 transition-colors`}
                            onMouseDown={(e) => {
                              if (track.isLocked) return;
                              e.stopPropagation();
                              handleClipSelection(e, clip.id);
                              setTrimmingClipId({ id: clip.id, side: 'right' });
                              onManipulationStart?.();
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Spacer to match sidebar buttons */}
                <div className="h-24" />

                {/* Marquee Selection Rect */}
                {selectionRect && (
                  <div
                    className="absolute border border-blue-500 bg-blue-500/10 z-[60] pointer-events-none"
                    style={{
                      left: Math.min(selectionRect.startX, selectionRect.endX),
                      top: Math.min(selectionRect.startY, selectionRect.endY),
                      width: Math.abs(selectionRect.endX - selectionRect.startX),
                      height: Math.abs(selectionRect.endY - selectionRect.startY),
                    }}
                  />
                )}
                {/* Snapping Indicator Line */}
                {snappedPoint !== null && !isNaN(snappedPoint) && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-blue-400/50 z-[80] pointer-events-none"
                    style={{ left: snappedPoint * pixelsPerSecond }}
                  />
                )}
              </div>

              {/* Playhead */}
              {!isNaN(currentTime) && (
                <div
                  className="absolute top-0 bottom-0 z-[100] pointer-events-none"
                  style={{ left: currentTime * pixelsPerSecond }}
                >
                  <div
                    className="absolute top-0 -translate-x-1/2 w-3 h-4 bg-blue-600 rounded-b-sm cursor-col-resize pointer-events-auto"
                    onMouseDown={(e) => { e.stopPropagation(); setIsDraggingPlayhead(true); }}
                  />
                  <div className="w-px h-full bg-blue-600" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Controls Footer */}
      <div className="fixed z-[101] w-[100%] bottom-0 h-10 border-t border-gray-200 bg-white flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center space-x-6">

          {/* Add tracks section */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-gray-100 rounded-md p-0.5 mr-4">
              <button
                onClick={() => onAddTrack(TrackType.VIDEO)}
                className="px-2 py-1 text-[10px] font-bold uppercase hover:bg-white rounded transition-all"
                title="Add Video Track"
              >
                + Video
              </button>
              <button
                onClick={() => onAddTrack(TrackType.AUDIO)}
                className="px-2 py-1 text-[10px] font-bold uppercase hover:bg-white rounded transition-all"
                title="Add Audio Track"
              >
                + Audio
              </button>
              <button
                onClick={() => onAddTrack(TrackType.TEXT)}
                className="px-2 py-1 text-[10px] font-bold uppercase hover:bg-white rounded transition-all"
                title="Add Text Track"
              >
                + Text
              </button>
              <button
                onClick={() => onAddTrack(TrackType.SUBTITLE)}
                className="px-2 py-1 text-[10px] font-bold uppercase hover:bg-white rounded transition-all"
                title="Add Subtitle Track"
              >
                + Sub
              </button>
              <button
                onClick={() => onAddTrack(TrackType.IMAGE)}
                className="px-2 py-1 text-[10px] font-bold uppercase hover:bg-white rounded transition-all"
                title="Add Image Track"
              >
                + Img
              </button>
              <button
                onClick={() => onAddTrack(TrackType.SCREEN)}
                className="px-2 py-1 text-[10px] font-bold uppercase hover:bg-white rounded transition-all"
                title="Add Screen Track"
              >
                + Screen
              </button>
            </div>

          </div>

          <div className="flex items-center space-x-2 border-l border-gray-200 pl-6">
            <div className="flex items-center bg-gray-100 rounded-md p-0.5 mr-4">
              {(['sm', 'md', 'lg'] as TrackHeightMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onTrackHeightModeChange(mode)}
                  className={`px-2 py-1 text-[10px] font-bold uppercase rounded transition-all ${trackHeightMode === mode
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                    }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              onClick={() => handleZoom(pixelsPerSecond * 0.8)}
              className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors"
            >
              <ZoomOut size={16} />
            </button>
            <input
              type="range"
              min="5"
              max="500"
              value={pixelsPerSecond}
              onChange={(e) => handleZoom(Number(e.target.value))}
              className="w-32 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <button
              onClick={() => handleZoom(pixelsPerSecond * 1.2)}
              className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors"
            >
              <ZoomIn size={16} />
            </button>
          </div>
        </div>

        <div className="flex justify-between items-center">

          <span className="text-xs font-mono text-gray-600 w-24">
            {formatTime(currentTime)} / {formatTime(totalDuration)}
          </span>

          <div className="flex items-center space-x-2">
            <button
              onClick={onSplit}
              className="p-1.5 hover:bg-gray-100 rounded text-gray-500 transition-colors"
              title="Split"
            >
              <Scissors size={14} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 hover:bg-gray-100 rounded text-red-500 transition-colors"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={onRippleDelete}
              className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors border border-red-100"
              title="Ripple Delete"
            >
              <div className="flex items-center space-x-1">
                <Trash2 size={14} />
                <span className="text-[10px] font-bold uppercase">Ripple</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
