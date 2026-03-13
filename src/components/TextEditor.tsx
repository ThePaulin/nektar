import React from 'react';
import { VideoClip, TrackType } from '../types';
import {
  Type,
  Palette,
  Maximize,
  RotateCw,
  Move,
  AlignLeft,
  Bold,
  Italic,
  StretchHorizontal,
  ArrowDownUp
} from 'lucide-react';

interface TextEditorProps {
  clip: VideoClip;
  onUpdate: (clipId: number, updates: Partial<VideoClip>) => void;
}

const GOOGLE_FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Playfair Display',
  'Oswald',
  'Source Code Pro',
  'Space Grotesk',
  'Outfit'
];

export const TextEditor: React.FC<TextEditorProps> = ({ clip, onUpdate }) => {
  const handleStyleChange = (updates: any) => {
    onUpdate(clip.id, {
      style: {
        ...clip.style,
        ...updates
      }
    });
  };

  const handlePositionChange = (axis: 'x' | 'y', value: number) => {
    handleStyleChange({
      position: {
        ...clip.style?.position,
        [axis]: value
      }
    });
  };

  return (
    <div className="w-full h-full bg-[#111] border border-white/10 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-300">
      <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Type size={18} className="text-blue-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Text Properties</h3>
        </div>
        <span className="text-[10px] bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase">
          {clip.type}
        </span>
      </div>

      <div className="h-full flex-grow overflow-y-auto p-6 space-y-8 custom-scrollbar">
        {/* Text Content */}
        <div className="space-y-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 flex items-center space-x-2">
            <AlignLeft size={12} />
            <span>Content</span>
          </label>
          <textarea
            value={clip.content || ''}
            onChange={(e) => onUpdate(clip.id, { content: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-600/50 transition-all min-h-[100px] resize-none"
            placeholder="Enter your text here..."
          />
        </div>

        <div className="grid grid-cols-2 gap-8">
          {/* Font Family */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Font Family</label>
            <select
              value={clip.style?.fontFamily || 'Inter'}
              onChange={(e) => handleStyleChange({ fontFamily: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-600/50"
            >
              {GOOGLE_FONTS.map(font => (
                <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
              ))}
            </select>
          </div>

          {/* Color */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 flex items-center space-x-2">
              <Palette size={12} />
              <span>Color</span>
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={clip.style?.color || '#ffffff'}
                onChange={(e) => handleStyleChange({ color: e.target.value })}
                className="w-10 h-10 bg-transparent border-none cursor-pointer rounded overflow-hidden"
              />
              <input
                type="text"
                value={clip.style?.color || '#ffffff'}
                onChange={(e) => handleStyleChange({ color: e.target.value })}
                className="flex-grow bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono"
              />
            </div>
          </div>
        </div>

        {/* Font Properties */}
        <div className="space-y-4">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Typography</label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-400">Size</span>
                <span className="text-[10px] font-mono text-blue-400">{clip.style?.fontSize || 48}px</span>
              </div>
              <input
                type="range"
                min="8"
                max="200"
                value={clip.style?.fontSize || 48}
                onChange={(e) => handleStyleChange({ fontSize: parseInt(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-400">Weight</span>
                <span className="text-[10px] font-mono text-blue-400">{clip.style?.fontWeight || 400}</span>
              </div>
              <select
                value={clip.style?.fontWeight || 400}
                onChange={(e) => handleStyleChange({ fontWeight: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white"
              >
                <option value="100">Thin (100)</option>
                <option value="300">Light (300)</option>
                <option value="400">Regular (400)</option>
                <option value="500">Medium (500)</option>
                <option value="600">SemiBold (600)</option>
                <option value="700">Bold (700)</option>
                <option value="900">Black (900)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <span className="text-[10px] text-gray-400 flex items-center space-x-1">
                <Italic size={10} />
                <span>Style</span>
              </span>
              <select
                value={clip.style?.fontStyle || 'normal'}
                onChange={(e) => handleStyleChange({ fontStyle: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white"
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-gray-400 flex items-center space-x-1">
                <StretchHorizontal size={10} />
                <span>Stretch</span>
              </span>
              <select
                value={clip.style?.fontStretch || 'normal'}
                onChange={(e) => handleStyleChange({ fontStretch: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white"
              >
                <option value="normal">Normal</option>
                <option value="condensed">Condensed</option>
                <option value="expanded">Expanded</option>
              </select>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-gray-400 flex items-center space-x-1">
                <ArrowDownUp size={10} />
                <span>Line Height</span>
              </span>
              <input
                type="number"
                step="0.1"
                value={clip.style?.lineHeight || 1.2}
                onChange={(e) => handleStyleChange({ lineHeight: parseFloat(e.target.value) })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white"
              />
            </div>
          </div>
        </div>

        {/* Transform Properties */}
        <div className="space-y-6 pt-4 border-t border-white/5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Transform</label>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-400 flex items-center space-x-1">
                  <Maximize size={10} />
                  <span>Scale</span>
                </span>
                <span className="text-[10px] font-mono text-blue-400">{clip.style?.scale || 1}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                value={clip.style?.scale || 1}
                onChange={(e) => handleStyleChange({ scale: parseFloat(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-400 flex items-center space-x-1">
                  <RotateCw size={10} />
                  <span>Rotation</span>
                </span>
                <span className="text-[10px] font-mono text-blue-400">{clip.style?.rotation || 0}°</span>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                value={clip.style?.rotation || 0}
                onChange={(e) => handleStyleChange({ rotation: parseInt(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-400 flex items-center space-x-1">
                  <Move size={10} />
                  <span>Position X</span>
                </span>
                <span className="text-[10px] font-mono text-blue-400">{clip.style?.position?.x || 0}px</span>
              </div>
              <input
                type="range"
                min="-500"
                max="500"
                value={clip.style?.position?.x || 0}
                onChange={(e) => handlePositionChange('x', parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-400 flex items-center space-x-1">
                  <Move size={10} />
                  <span>Position Y</span>
                </span>
                <span className="text-[10px] font-mono text-blue-400">{clip.style?.position?.y || 0}px</span>
              </div>
              <input
                type="range"
                min="-500"
                max="500"
                value={clip.style?.position?.y || 0}
                onChange={(e) => handlePositionChange('y', parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
