import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Scissors, Trash2, ZoomIn, ZoomOut, Download, CheckCircle2 } from 'lucide-react';
import { VideoClip, VideoObjType } from '../types';
import { ThumbnailStrip } from './ThumbnailStrip';

interface TimelineProps {
  clips: VideoObjType;
  currentTime: number;
  onTimeChange: (time: number) => void;
  onClipUpdate?: (clipId: number, newStart: number) => void;
  onClipTrim?: (clipId: number, side: 'left' | 'right', newTime: number) => void;
  onClipRename?: (clipId: number, newLabel: string) => void;
  onClipDownload?: (clip: VideoClip) => void;
  onManipulationStart?: () => void;
  onManipulationEnd?: () => void;
  onSplit?: () => void;
  onDelete?: () => void;
  onRippleDelete?: () => void;
  selectedClipIds?: number[];
  downloadedClipIds?: number[];
  onSelectionChange?: (ids: number[]) => void;
  initialPixelsPerSecond?: number;
  totalDuration?: number;
}

export const Timeline: React.FC<TimelineProps> = ({
  clips,
  currentTime,
  onTimeChange,
  onClipUpdate,
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
  initialPixelsPerSecond = 40,
  totalDuration = 60, // Default 60 seconds
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [draggingClipId, setDraggingClipId] = useState<number | null>(null);
  const [trimmingClipId, setTrimmingClipId] = useState<{ id: number; side: 'left' | 'right' } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(initialPixelsPerSecond);
  const [editingClipId, setEditingClipId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const SNAP_THRESHOLD_PX = 10;

  // Playhead centering logic on zoom
  useEffect(() => {
    if (containerRef.current) {
      const viewportWidth = containerRef.current.clientWidth;
      const playheadPos = currentTime * pixelsPerSecond;
      const newScrollLeft = playheadPos - viewportWidth / 2;
      containerRef.current.scrollLeft = newScrollLeft;
    }
  }, [pixelsPerSecond]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    if (pixelsPerSecond > 100) {
      return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + containerRef.current.scrollLeft;
      const newTime = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
      onTimeChange(newTime);
      
      // Clear selection when clicking background
      if (onSelectionChange) {
        onSelectionChange([]);
      }
    }
  };

  const handlePlayheadDrag = (e: MouseEvent | TouchEvent) => {
    if (isDraggingPlayhead && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left + containerRef.current.scrollLeft;
      const newTime = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
      onTimeChange(newTime);
    }
  };

  const handleClipDrag = (e: MouseEvent | TouchEvent) => {
    if (draggingClipId !== null && containerRef.current && onClipUpdate) {
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left + containerRef.current.scrollLeft;
      let newStart = (x - dragOffset) / pixelsPerSecond;

      // Snapping logic
      const snapPoints = [0, currentTime, ...clips.flatMap(c => c.id !== draggingClipId ? [c.timelinePosition.start, c.timelinePosition.end] : [])];
      const currentClip = clips.find(c => c.id === draggingClipId);
      if (currentClip) {
        const duration = currentClip.timelinePosition.end - currentClip.timelinePosition.start;
        for (const point of snapPoints) {
          if (Math.abs(newStart * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
            newStart = point;
            break;
          }
          if (Math.abs((newStart + duration) * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
            newStart = point - duration;
            break;
          }
        }
      }

      onClipUpdate(draggingClipId, Math.max(0, newStart));
    }
  };

  const handleTrimDrag = (e: MouseEvent | TouchEvent) => {
    if (trimmingClipId !== null && containerRef.current && onClipTrim) {
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left + containerRef.current.scrollLeft;
      let newTime = x / pixelsPerSecond;

      // Snapping for trim
      const snapPoints = [0, currentTime, ...clips.flatMap(c => c.id !== trimmingClipId.id ? [c.timelinePosition.start, c.timelinePosition.end] : [])];
      for (const point of snapPoints) {
        if (Math.abs(newTime * pixelsPerSecond - point * pixelsPerSecond) < SNAP_THRESHOLD_PX) {
          newTime = point;
          break;
        }
      }

      onClipTrim(trimmingClipId.id, trimmingClipId.side, Math.max(0, newTime));
    }
  };

  useEffect(() => {
    if (isDraggingPlayhead) {
      window.addEventListener('mousemove', handlePlayheadDrag);
      window.addEventListener('mouseup', () => setIsDraggingPlayhead(false));
      window.addEventListener('touchmove', handlePlayheadDrag);
      window.addEventListener('touchend', () => setIsDraggingPlayhead(false));
    }
    if (draggingClipId !== null) {
      window.addEventListener('mousemove', handleClipDrag);
      window.addEventListener('mouseup', () => {
        setDraggingClipId(null);
        onManipulationEnd?.();
      });
      window.addEventListener('touchmove', handleClipDrag);
      window.addEventListener('touchend', () => {
        setDraggingClipId(null);
        onManipulationEnd?.();
      });
    }
    if (trimmingClipId !== null) {
      window.addEventListener('mousemove', handleTrimDrag);
      window.addEventListener('mouseup', () => {
        setTrimmingClipId(null);
        onManipulationEnd?.();
      });
      window.addEventListener('touchmove', handleTrimDrag);
      window.addEventListener('touchend', () => {
        setTrimmingClipId(null);
        onManipulationEnd?.();
      });
    }
    return () => {
      window.removeEventListener('mousemove', handlePlayheadDrag);
      window.removeEventListener('mouseup', () => setIsDraggingPlayhead(false));
      window.removeEventListener('touchmove', handlePlayheadDrag);
      window.removeEventListener('touchend', () => setIsDraggingPlayhead(false));
      window.removeEventListener('mousemove', handleClipDrag);
      window.removeEventListener('mouseup', () => setDraggingClipId(null));
      window.removeEventListener('touchmove', handleClipDrag);
      window.removeEventListener('touchend', () => setDraggingClipId(null));
      window.removeEventListener('mousemove', handleTrimDrag);
      window.removeEventListener('mouseup', () => setTrimmingClipId(null));
      window.removeEventListener('touchmove', handleTrimDrag);
      window.removeEventListener('touchend', () => setTrimmingClipId(null));
    };
  }, [isDraggingPlayhead, draggingClipId, trimmingClipId, pixelsPerSecond, handlePlayheadDrag, handleClipDrag, handleTrimDrag]);

  // Generate ruler ticks dynamically based on zoom
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
    setPixelsPerSecond(clampedZoom);
  };

  return (
    <div className="flex flex-col w-full bg-[#F5F5F5] border-t border-gray-200 select-none">
      {/* Ruler */}
      <div 
        ref={containerRef}
        className="relative h-48 overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
        onClick={handleTimelineClick}
      >
        <div 
          className="relative h-full" 
          style={{ width: totalDuration * pixelsPerSecond + 100 }}
        >
          {/* Time Ticks */}
          <div className="flex items-end h-8 border-b border-gray-300">
            {ticks.map((tick) => (
              <div 
                key={tick} 
                className="absolute flex flex-col items-center"
                style={{ left: tick * pixelsPerSecond }}
              >
                <span className="text-[10px] text-gray-500 mb-1">{formatTime(tick)}</span>
                <div className="w-px h-2 bg-gray-300" />
              </div>
            ))}
          </div>

          {/* Tracks Area */}
          <div className="relative mt-4 h-28">
            {/* Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {ticks.map((tick) => (
                <div 
                  key={`grid-${tick}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-200/50"
                  style={{ left: tick * pixelsPerSecond }}
                />
              ))}
            </div>

            {/* Clips Container */}
            <div className="absolute inset-0">
              {clips.map((clip) => {
                const isSelected = selectedClipIds.includes(clip.id);
                return (
                  <div
                    key={clip.id}
                    className={`absolute h-20 top-4 bg-black rounded-md border-2 overflow-hidden group shadow-lg cursor-grab active:cursor-grabbing transition-all ${
                      draggingClipId === clip.id ? 'border-blue-500 z-40 scale-[1.02] shadow-blue-500/30' : 
                      isSelected ? 'border-blue-500 z-30 shadow-blue-500/40 ring-2 ring-blue-500/20' : 'border-gray-800'
                    }`}
                    style={{
                      left: clip.timelinePosition.start * pixelsPerSecond,
                      width: (clip.timelinePosition.end - clip.timelinePosition.start) * pixelsPerSecond,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      
                      // Handle Selection
                      if (onSelectionChange) {
                        if (e.shiftKey || e.metaKey || e.ctrlKey) {
                          if (isSelected) {
                            onSelectionChange(selectedClipIds.filter(id => id !== clip.id));
                          } else {
                            onSelectionChange([...selectedClipIds, clip.id]);
                          }
                        } else {
                          if (!isSelected) {
                            onSelectionChange([clip.id]);
                          }
                        }
                      }

                      const rect = e.currentTarget.getBoundingClientRect();
                      setDragOffset(e.clientX - rect.left);
                      setDraggingClipId(clip.id);
                      onManipulationStart?.();
                    }}
                  >
                  <ThumbnailStrip 
                    videoUrl={clip.videoUrl}
                    duration={clip.duration}
                    sourceStart={clip.sourceStart}
                    pixelsPerSecond={pixelsPerSecond}
                    clipWidth={(clip.timelinePosition.end - clip.timelinePosition.start) * pixelsPerSecond}
                  />
                  
                  {/* Clip Label/ID */}
                  <div 
                    className={`absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center space-x-1.5 group/label transition-colors ${
                      isSelected ? 'bg-blue-600' : ''
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {isSelected && <CheckCircle2 size={10} className="text-white" />}
                    {editingClipId === clip.id ? (
                      <input
                        autoFocus
                        className="bg-transparent border-none outline-none w-24 text-white"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                          if (editValue.trim() && onClipRename) {
                            onClipRename(clip.id, editValue.trim());
                          }
                          setEditingClipId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (editValue.trim() && onClipRename) {
                              onClipRename(clip.id, editValue.trim());
                            }
                            setEditingClipId(null);
                          }
                        }}
                      />
                    ) : (
                      <span 
                        className="cursor-text hover:text-blue-400 transition-colors"
                        onClick={() => {
                          setEditingClipId(clip.id);
                          setEditValue(clip.label);
                        }}
                      >
                        {clip.label}
                      </span>
                    )}
                  </div>

                  {/* Individual Download Button */}
                  <button
                    className={`absolute top-1 right-1 p-1 bg-black/60 rounded opacity-0 group-hover:opacity-100 transition-all z-50 ${
                      downloadedClipIds.includes(clip.id) 
                        ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/40' 
                        : 'text-white/60 hover:text-white hover:bg-blue-600'
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onClipDownload?.(clip)}
                    title={downloadedClipIds.includes(clip.id) ? "Downloaded" : "Download Clip"}
                  >
                    <Download size={12} />
                  </button>

                  {/* Clip Duration Label */}
                  <div className="absolute bottom-1 right-1 text-white/60 text-[10px] font-mono">
                    {(clip.timelinePosition.end - clip.timelinePosition.start).toFixed(1)}s
                  </div>

                  {/* Selection Overlay */}
                  <div className={`absolute inset-0 border-2 pointer-events-none transition-all duration-200 ${
                    isSelected 
                      ? 'border-blue-500 bg-blue-500/10' 
                      : 'border-transparent group-hover:border-blue-500/30'
                  }`} />
                  
                  {/* Subtle Top Accent for Selection */}
                  {isSelected && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-400 z-50" />
                  )}

                  {/* Trim Handles */}
                  <div 
                    className="absolute left-0 top-0 bottom-0 w-2 bg-blue-500/0 group-hover:bg-blue-500/40 cursor-col-resize z-50 transition-colors"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setTrimmingClipId({ id: clip.id, side: 'left' });
                      onManipulationStart?.();
                    }}
                  />
                  <div 
                    className="absolute right-0 top-0 bottom-0 w-2 bg-blue-500/0 group-hover:bg-blue-500/40 cursor-col-resize z-50 transition-colors"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setTrimmingClipId({ id: clip.id, side: 'right' });
                      onManipulationStart?.();
                    }}
                  />
                </div>
              )})}
            </div>
          </div>

          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 z-50 pointer-events-none"
            style={{ left: currentTime * pixelsPerSecond }}
          >
            {/* Playhead Handle */}
            <div 
              className="absolute top-0 -translate-x-1/2 w-3 h-4 bg-blue-600 rounded-b-sm cursor-col-resize pointer-events-auto"
              onMouseDown={(e) => {
                e.stopPropagation();
                setIsDraggingPlayhead(true);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                setIsDraggingPlayhead(true);
              }}
            />
            {/* Playhead Line */}
            <div className="w-px h-full bg-blue-600" />
          </div>
        </div>
      </div>

      {/* Timeline Controls Footer */}
      <div className="h-10 border-t border-gray-200 bg-white flex items-center px-4 justify-between">
        <div className="flex items-center space-x-6">
          <span className="text-xs font-mono text-gray-600 w-24">
            {formatTime(currentTime)} / {formatTime(totalDuration)}
          </span>
          
          {/* Zoom Controls */}
          <div className="flex items-center space-x-2 border-l border-gray-200 pl-6">
            <button 
              onClick={() => handleZoom(pixelsPerSecond * 0.8)}
              className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors"
              title="Zoom Out"
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
              title="Zoom In"
            >
              <ZoomIn size={16} />
            </button>
            <span className="text-[10px] text-gray-400 font-mono ml-2">
              {Math.round((pixelsPerSecond / 40) * 100)}%
            </span>
          </div>
        </div>
        
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
  );
};
