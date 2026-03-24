import React from 'react';
import { VideoClip, TrackType } from '../types';
import { 
  Sliders, Move, Rotate3d, Crop, Volume2, 
  Sun, Droplets, Ghost, Layers, Maximize,
  ChevronDown, ChevronUp, RefreshCcw,
  Type, Palette, AlignLeft, Bold, Italic,
  StretchHorizontal, ArrowDownUp
} from 'lucide-react';

interface ClipPropertiesPanelProps {
  clip: VideoClip;
  onUpdate: (id: number, updates: Partial<VideoClip>) => void;
}

const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
  'Playfair Display', 'Oswald', 'Source Code Pro', 'Space Grotesk', 'Outfit'
];

export const ClipPropertiesPanel: React.FC<ClipPropertiesPanelProps> = ({ clip, onUpdate }) => {
  const isVideoOrImage = clip.type === TrackType.VIDEO || clip.type === TrackType.IMAGE || clip.type === TrackType.SCREEN;
  const isAudio = clip.type === TrackType.AUDIO;
  const isText = clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE;
  const hasTransform = isVideoOrImage || isText;

  const defaultTransform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    opacity: 1,
    crop: { top: 0, right: 0, bottom: 0, left: 0 }
  };

  const defaultFilters = {
    brightness: 1,
    saturation: 1,
    contrast: 1
  };

  const transform = clip.transform || defaultTransform;
  const filters = clip.filters || defaultFilters;
  const volume = clip.volume !== undefined ? clip.volume : 1;

  const updateTransform = (updates: any) => {
    onUpdate(clip.id, {
      transform: { ...transform, ...updates }
    });
  };

  const updateFilters = (updates: any) => {
    onUpdate(clip.id, {
      filters: { ...filters, ...updates }
    });
  };

  const updateStyle = (updates: any) => {
    onUpdate(clip.id, {
      style: { ...clip.style, ...updates }
    });
  };

  const updateVolume = (val: number) => {
    onUpdate(clip.id, { volume: val });
  };

  const resetTransform = () => {
    onUpdate(clip.id, { transform: defaultTransform });
  };

  const resetFilters = () => {
    onUpdate(clip.id, { filters: defaultFilters });
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200 w-72 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 text-gray-900">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
        <div className="flex items-center space-x-2">
          <Sliders size={18} className="text-blue-600" />
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Clip Properties</h2>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Info Section */}
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Selected Clip</p>
          <p className="text-xs font-medium text-gray-700 truncate">{clip.label}</p>
        </div>

        {/* Text Content Section */}
        {isText && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center space-x-2">
              <AlignLeft size={14} className="text-gray-500" />
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Content</h3>
            </div>
            <textarea
              value={clip.content || ''}
              onChange={(e) => onUpdate(clip.id, { content: e.target.value })}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all min-h-[80px] resize-none"
              placeholder="Enter text..."
            />
          </div>
        )}

        {/* Typography Section */}
        {isText && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center space-x-2">
              <Type size={14} className="text-gray-500" />
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Typography</h3>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-400 font-medium">Font Family</label>
                <select
                  value={clip.style?.fontFamily || 'Inter'}
                  onChange={(e) => updateStyle({ fontFamily: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none"
                >
                  {GOOGLE_FONTS.map(font => (
                    <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-gray-400 font-medium">Size</label>
                    <span className="text-[10px] text-gray-500">{clip.style?.fontSize || 48}px</span>
                  </div>
                  <input
                    type="range"
                    min="8" max="200"
                    value={clip.style?.fontSize || 48}
                    onChange={(e) => updateStyle({ fontSize: parseInt(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-400 font-medium">Weight</label>
                  <select
                    value={clip.style?.fontWeight || 400}
                    onChange={(e) => updateStyle({ fontWeight: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none"
                  >
                    <option value="100">Thin</option>
                    <option value="300">Light</option>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">SemiBold</option>
                    <option value="700">Bold</option>
                    <option value="900">Black</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-400 font-medium">Color</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={clip.style?.color || '#ffffff'}
                      onChange={(e) => updateStyle({ color: e.target.value })}
                      className="w-6 h-6 bg-transparent border-none cursor-pointer rounded overflow-hidden"
                    />
                    <input
                      type="text"
                      value={clip.style?.color || '#ffffff'}
                      onChange={(e) => updateStyle({ color: e.target.value })}
                      className="flex-grow bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] text-gray-900 font-mono outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-400 font-medium">Line Height</label>
                  <input
                    type="number"
                    step="0.1"
                    value={clip.style?.lineHeight || 1.2}
                    onChange={(e) => updateStyle({ lineHeight: parseFloat(e.target.value) })}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-400 font-medium">Style</label>
                  <select
                    value={clip.style?.fontStyle || 'normal'}
                    onChange={(e) => updateStyle({ fontStyle: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none"
                  >
                    <option value="normal">Normal</option>
                    <option value="italic">Italic</option>
                    <option value="oblique">Oblique</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-400 font-medium">Stretch</label>
                  <select
                    value={clip.style?.fontStretch || 'normal'}
                    onChange={(e) => updateStyle({ fontStretch: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none"
                  >
                    <option value="normal">Normal</option>
                    <option value="condensed">Condensed</option>
                    <option value="expanded">Expanded</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transform Section */}
        {hasTransform && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Move size={14} className="text-gray-500" />
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Transform</h3>
              </div>
              <button 
                onClick={resetTransform}
                className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600 transition-colors"
                title="Reset Transform"
              >
                <RefreshCcw size={12} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-400 font-medium">Position X</label>
                <input 
                  type="number" 
                  value={transform.position.x}
                  onChange={(e) => updateTransform({ position: { ...transform.position, x: Number(e.target.value) } })}
                  className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-400 font-medium">Position Y</label>
                <input 
                  type="number" 
                  value={transform.position.y}
                  onChange={(e) => updateTransform({ position: { ...transform.position, y: Number(e.target.value) } })}
                  className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-400 font-medium">Position Z (Layer)</label>
                <input 
                  type="number" 
                  value={transform.position.z}
                  onChange={(e) => updateTransform({ position: { ...transform.position, z: Number(e.target.value) } })}
                  className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-400 font-medium">Scale (X & Y)</label>
                <input 
                  type="range" 
                  min="0.1" max="5" step="0.01"
                  value={transform.scale.x}
                  onChange={(e) => updateTransform({ scale: { x: Number(e.target.value), y: Number(e.target.value) } })}
                  className="w-full accent-blue-600"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-400 font-medium">Opacity</label>
                <input 
                  type="range" 
                  min="0" max="1" step="0.01"
                  value={transform.opacity}
                  onChange={(e) => updateTransform({ opacity: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-gray-50">
              <div className="flex items-center space-x-2">
                <Rotate3d size={14} className="text-gray-500" />
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Rotation</h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] text-gray-400">X</label>
                  <input 
                    type="number" 
                    value={transform.rotation.x}
                    onChange={(e) => updateTransform({ rotation: { ...transform.rotation, x: Number(e.target.value) } })}
                    className="w-full px-1 py-1 text-[10px] text-gray-900 border border-gray-200 rounded outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-gray-400">Y</label>
                  <input 
                    type="number" 
                    value={transform.rotation.y}
                    onChange={(e) => updateTransform({ rotation: { ...transform.rotation, y: Number(e.target.value) } })}
                    className="w-full px-1 py-1 text-[10px] text-gray-900 border border-gray-200 rounded outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-gray-400">Z</label>
                  <input 
                    type="number" 
                    value={transform.rotation.z}
                    onChange={(e) => updateTransform({ rotation: { ...transform.rotation, z: Number(e.target.value) } })}
                    className="w-full px-1 py-1 text-[10px] text-gray-900 border border-gray-200 rounded outline-none"
                  />
                </div>
              </div>
            </div>

            {isVideoOrImage && (
              <div className="space-y-3 pt-2 border-t border-gray-50">
                <div className="flex items-center space-x-2">
                  <Crop size={14} className="text-gray-500" />
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Crop (%)</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-400">Top</label>
                    <input 
                      type="number" min="0" max="100"
                      value={transform.crop?.top || 0}
                      onChange={(e) => updateTransform({ crop: { ...(transform.crop || {top:0,right:0,bottom:0,left:0}), top: Number(e.target.value) } })}
                      className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-400">Bottom</label>
                    <input 
                      type="number" min="0" max="100"
                      value={transform.crop?.bottom || 0}
                      onChange={(e) => updateTransform({ crop: { ...(transform.crop || {top:0,right:0,bottom:0,left:0}), bottom: Number(e.target.value) } })}
                      className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-400">Left</label>
                    <input 
                      type="number" min="0" max="100"
                      value={transform.crop?.left || 0}
                      onChange={(e) => updateTransform({ crop: { ...(transform.crop || {top:0,right:0,bottom:0,left:0}), left: Number(e.target.value) } })}
                      className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-400">Right</label>
                    <input 
                      type="number" min="0" max="100"
                      value={transform.crop?.right || 0}
                      onChange={(e) => updateTransform({ crop: { ...(transform.crop || {top:0,right:0,bottom:0,left:0}), right: Number(e.target.value) } })}
                      className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters Section */}
        {isVideoOrImage && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Droplets size={14} className="text-gray-500" />
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Visual Filters</h3>
              </div>
              <button 
                onClick={resetFilters}
                className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600 transition-colors"
                title="Reset Filters"
              >
                <RefreshCcw size={12} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-gray-400 font-medium">Brightness</label>
                  <span className="text-[10px] text-gray-500">{Math.round(filters.brightness * 100)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="2" step="0.01"
                  value={filters.brightness}
                  onChange={(e) => updateFilters({ brightness: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-gray-400 font-medium">Saturation</label>
                  <span className="text-[10px] text-gray-500">{Math.round(filters.saturation * 100)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="2" step="0.01"
                  value={filters.saturation}
                  onChange={(e) => updateFilters({ saturation: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-gray-400 font-medium">Contrast</label>
                  <span className="text-[10px] text-gray-500">{Math.round((filters.contrast || 1) * 100)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="2" step="0.01"
                  value={filters.contrast || 1}
                  onChange={(e) => updateFilters({ contrast: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>
          </div>
        )}

        {/* Audio Section */}
        {(isVideoOrImage || isAudio) && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center space-x-2">
              <Volume2 size={14} className="text-gray-500" />
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Audio</h3>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-gray-400 font-medium">Volume</label>
                <span className="text-[10px] text-gray-500">{Math.round(volume * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0" max="1" step="0.01"
                value={volume}
                onChange={(e) => updateVolume(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
