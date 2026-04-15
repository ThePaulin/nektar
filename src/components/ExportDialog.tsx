import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { VideoObjType, Track, TrackType, VideoClip } from '../types';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4ArrayBufferTarget } from 'mp4-muxer';
import { parseCubeLUT, LUTData } from '../lib/lut';

// WebGPU Shader for Compositing
const COMPOSITE_SHADER = `
  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) texCoord: vec2<f32>,
  };

  struct Uniforms {
    transform: mat3x3<f32>,
    opacity: f32,
    lut_intensity: f32,
    has_lut: u32,
    is_overlay: u32,
    overlay_rect: vec4<f32>, // x, y, w, h
    crop: vec4<f32>, // top, right, bottom, left
  };

  @group(0) @binding(0) var<uniform> u: Uniforms;

  @vertex
  fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 4>(
      vec2<f32>(-1.0,  1.0),
      vec2<f32>( 1.0,  1.0),
      vec2<f32>(-1.0, -1.0),
      vec2<f32>( 1.0, -1.0)
    );
    var tex = array<vec2<f32>, 4>(
      vec2<f32>(0.0, 0.0),
      vec2<f32>(1.0, 0.0),
      vec2<f32>(0.0, 1.0),
      vec2<f32>(1.0, 1.0)
    );

    var out: VertexOutput;
    // Apply transform matrix (simplified for 2D)
    let p = u.transform * vec3<f32>(pos[vertexIndex], 1.0);
    out.position = vec4<f32>(p.xy, 0.0, 1.0);
    
    // Apply crop to texture coordinates
    let tc = tex[vertexIndex];
    let croppedTC = vec2<f32>(
      u.crop.w / 100.0 + tc.x * (1.0 - (u.crop.w + u.crop.y) / 100.0),
      u.crop.x / 100.0 + tc.y * (1.0 - (u.crop.x + u.crop.z) / 100.0)
    );
    out.texCoord = croppedTC;
    return out;
  }

  @group(0) @binding(1) var s: sampler;
  @group(0) @binding(2) var t_ext: texture_external;
  @group(0) @binding(3) var t_2d: texture_2d<f32>;
  @group(0) @binding(4) var<uniform> is_external: u32;
  @group(0) @binding(5) var t_lut: texture_3d<f32>;
  @group(0) @binding(6) var s_lut: sampler;

  @fragment
  fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var color: vec4<f32>;
    if (is_external == 1u) {
      color = textureSampleBaseClampToEdge(t_ext, s, in.texCoord);
    } else {
      color = textureSample(t_2d, s, in.texCoord);
    }

    if (u.has_lut == 1u) {
      var apply_lut = false;
      if (u.is_overlay == 1u) {
        // Check if current pixel is within overlay_rect
        // Note: in.position is in framebuffer coordinates (0 to width, 0 to height)
        if (in.position.x >= u.overlay_rect.x && in.position.x <= u.overlay_rect.x + u.overlay_rect.z &&
            in.position.y >= u.overlay_rect.y && in.position.y <= u.overlay_rect.y + u.overlay_rect.w) {
          apply_lut = true;
        }
      } else {
        apply_lut = true;
      }
      
      if (apply_lut) {
        // 3D LUT lookup with voxel-center mapping
        let lut_size = f32(textureDimensions(t_lut).x);
        let coords = color.rgb * ((lut_size - 1.0) / lut_size) + (0.5 / lut_size);
        let lut_color = textureSample(t_lut, s_lut, coords).rgb;
        color = vec4<f32>(mix(color.rgb, lut_color, u.lut_intensity), color.a);
      }
    }

    return vec4<f32>(color.rgb, color.a * u.opacity);
  }
`;

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
  const lutTexturesRef = useRef<{ [key: string]: any }>({});
  const dummyLutTextureRef = useRef<any | null>(null);

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
      const exportDuration = Math.round((exportRange.end - exportRange.start) * 30) / 30;

      if (exportDuration <= 0) {
        throw new Error("Invalid export range. Duration must be greater than 0.");
      }

      // Preload visual elements
      console.log("[Export] Preloading visual elements and LUTs...");
      
      // Preload LUTs
      const tracksWithLut = tracks.filter(t => t.lutConfig?.enabled && t.lutConfig.url);
      await Promise.all(tracksWithLut.map(async (track) => {
        if (!track.lutConfig?.url) return;
        try {
          const response = await fetch(track.lutConfig.url);
          const cubeString = await response.text();
          const lutData = parseCubeLUT(cubeString);
          
          if (gpuDevice) {
            const size = lutData.size;
            const texture = gpuDevice.createTexture({
              size: [size, size, size],
              format: 'rgba8unorm',
              dimension: '3d',
              usage: (window as any).GPUTextureUsage.TEXTURE_BINDING | (window as any).GPUBufferUsage.COPY_DST
            });

            const lutUint8 = new Uint8Array(lutData.data.length);
            for (let i = 0; i < lutData.data.length; i++) {
              lutUint8[i] = Math.max(0, Math.min(255, Math.round(lutData.data[i] * 255)));
            }

            gpuDevice.queue.writeTexture(
              { texture },
              lutUint8.buffer,
              { bytesPerRow: size * 4, rowsPerImage: size },
              [size, size, size]
            );
            lutTexturesRef.current[track.id] = texture;
          }
        } catch (e) {
          console.warn(`[Export] Failed to load LUT for track ${track.id}:`, e);
        }
      }));

      await Promise.all(exportClips.map(async (clip, index) => {
        try {
          if (clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO) {
            const video = document.createElement('video');
            video.src = clip.videoUrl!;
            video.muted = true;
            video.playsInline = true;
            video.crossOrigin = 'anonymous';
            
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => resolve(null), 5000); // 5s timeout for metadata
              video.onloadedmetadata = () => { clearTimeout(timeout); resolve(null); };
              video.onerror = () => { clearTimeout(timeout); resolve(null); }; // Continue even on error
            });
            videoElementsRef.current[clip.id] = video;
          } else if (clip.type === TrackType.IMAGE) {
            const img = new Image();
            img.src = clip.thumbnailUrl!;
            img.crossOrigin = 'anonymous';
            await new Promise((resolve) => {
              const timeout = setTimeout(() => resolve(null), 5000);
              img.onload = () => { clearTimeout(timeout); resolve(null); };
              img.onerror = () => { clearTimeout(timeout); resolve(null); };
            });
            imageElementsRef.current[clip.id] = img;
          }
          // Update progress slightly during preloading
          setProgress((index / exportClips.length) * 5); 
        } catch (e) {
          console.warn(`[Export] Failed to preload clip ${clip.id}:`, e);
        }
      }));

      // 2. Setup Audio (Offline Rendering for perfect sync)
      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      
      const sampleRate = 44100;
      const offlineCtx = new OfflineAudioContext(2, Math.max(1, Math.ceil(exportDuration * sampleRate)), sampleRate);
      
      console.log(`[Export] Pre-rendering audio for ${exportDuration}s...`);
      
      await Promise.all(exportClips.map(async (clip) => {
        if ((clip.type === TrackType.AUDIO || clip.type === TrackType.VIDEO) && clip.videoUrl) {
          try {
            const response = await fetch(clip.videoUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;
            
            const gainNode = offlineCtx.createGain();
            const track = tracks.find(t => t.id === clip.trackId);
            gainNode.gain.value = (track?.isMuted) ? 0 : (clip.volume !== undefined ? clip.volume : 1);
            
            source.connect(gainNode);
            gainNode.connect(offlineCtx.destination);
            
            // Calculate timing relative to export range
            const clipStartInExport = Math.max(0, clip.timelinePosition.start - exportRange.start);
            const clipEndInExport = Math.min(exportDuration, clip.timelinePosition.end - exportRange.start);
            
            if (clipStartInExport < exportDuration && clipEndInExport > 0) {
              const offset = clip.sourceStart + (clip.timelinePosition.start < exportRange.start ? (exportRange.start - clip.timelinePosition.start) : 0);
              const duration = clipEndInExport - clipStartInExport;
              if (duration > 0) {
                source.start(clipStartInExport, offset, duration);
              }
            }
          } catch (e) {
            console.warn(`[Export] Failed to process audio for clip ${clip.id}:`, e);
          }
        }
      }));

      setProgress(8); // Initialization progress
      const renderedAudioBuffer = await offlineCtx.startRendering();
      console.log("[Export] Audio pre-rendering complete.");
      setProgress(10);

      // 3. Setup Export Method (Industry Standard: WebCodecs + Muxer + WebGPU)
      const isWebCodecsSupported = 'VideoEncoder' in window && 'AudioEncoder' in window && 'VideoFrame' in window;
      const isWebGPUSupported = 'gpu' in navigator;
      
      if (!isWebCodecsSupported) {
        throw new Error("Your browser does not support WebCodecs. Please use a modern browser like Chrome or Edge.");
      }

      console.log(`[Export] Using WebCodecs + ${format === 'mp4' ? 'mp4-muxer' : 'webm-muxer'} for Deterministic Export`);
      if (isWebGPUSupported) console.log("[Export] WebGPU acceleration enabled.");

      // Initialize WebGPU if supported
      let gpuDevice: any = null;
      let gpuPipeline: any = null;
      let gpuSampler: any = null;
      let gpuCanvas: any = null;
      let gpuContext: any = null;
      let dummyTexture: any = null;
      let externalTrueBuffer: any = null;
      let externalFalseBuffer: any = null;
      
      if (isWebGPUSupported) {
        try {
          const adapter = await (navigator as any).gpu.requestAdapter();
          if (adapter) {
            gpuDevice = await adapter.requestDevice();
            gpuCanvas = new OffscreenCanvas(1280, 720);
            gpuContext = gpuCanvas.getContext('webgpu');
            
            if (gpuContext) {
              gpuContext.configure({
                device: gpuDevice,
                format: 'bgra8unorm',
                alphaMode: 'premultiplied'
              });

              const shaderModule = gpuDevice.createShaderModule({ code: COMPOSITE_SHADER });
              gpuPipeline = gpuDevice.createRenderPipeline({
                layout: 'auto',
                vertex: { module: shaderModule, entryPoint: 'vs_main' },
                fragment: {
                  module: shaderModule,
                  entryPoint: 'fs_main',
                  targets: [{
                    format: 'bgra8unorm',
                    blend: {
                      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                    }
                  }]
                },
                primitive: { topology: 'triangle-strip' }
              });
              gpuSampler = gpuDevice.createSampler({ magFilter: 'linear', minFilter: 'linear' });
              
              // Create a reusable dummy texture for binding 3 when using external textures
              dummyTexture = gpuDevice.createTexture({ 
                size: [1, 1], 
                format: 'rgba8unorm', 
                usage: (window as any).GPUTextureUsage.TEXTURE_BINDING 
              });

              // Create a dummy 3D LUT texture (2x2x2)
              dummyLutTextureRef.current = gpuDevice.createTexture({
                size: [2, 2, 2],
                format: 'rgba8unorm',
                dimension: '3d',
                usage: (window as any).GPUTextureUsage.TEXTURE_BINDING | (window as any).GPUBufferUsage.COPY_DST
              });

              // Pre-create constant buffers for isExternal flag
              externalTrueBuffer = gpuDevice.createBuffer({ size: 4, usage: (window as any).GPUBufferUsage.UNIFORM | (window as any).GPUBufferUsage.COPY_DST, mappedAtCreation: true });
              new Uint32Array(externalTrueBuffer.getMappedRange())[0] = 1;
              externalTrueBuffer.unmap();

              externalFalseBuffer = gpuDevice.createBuffer({ size: 4, usage: (window as any).GPUBufferUsage.UNIFORM | (window as any).GPUBufferUsage.COPY_DST, mappedAtCreation: true });
              new Uint32Array(externalFalseBuffer.getMappedRange())[0] = 0;
              externalFalseBuffer.unmap();

              console.log("[Export] WebGPU initialized successfully");
            }
          }
        } catch (e) {
          console.warn("[Export] WebGPU initialization failed, falling back to Canvas2D:", e);
          gpuDevice = null;
        }
      }

      const muxer = format === 'mp4' ? new MP4Muxer({
        target: new MP4ArrayBufferTarget(),
        video: { codec: 'avc', width: 1280, height: 720 },
        audio: { codec: 'aac', sampleRate: sampleRate, numberOfChannels: 2 },
        fastStart: 'in-memory'
      }) : new WebMMuxer({
        target: new WebMArrayBufferTarget(),
        video: { codec: 'V_VP9', width: 1280, height: 720, frameRate: 30 },
        audio: { codec: 'A_OPUS', sampleRate: sampleRate, numberOfChannels: 2 }
      });

      const videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: (e) => {
          console.error("[Export] VideoEncoder error:", e);
          setError(`Video encoding error: ${e.message}`);
          setStatus('error');
        }
      });

      const audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
        error: (e) => {
          console.error("[Export] AudioEncoder error:", e);
          setError(`Audio encoding error: ${e.message}`);
          setStatus('error');
        }
      });

      if (format === 'mp4') {
        videoEncoder.configure({
          codec: 'avc1.42E01F',
          width: 1280,
          height: 720,
          bitrate: 12000000,
          framerate: 30,
          latencyMode: 'quality'
        });
        audioEncoder.configure({
          codec: 'mp4a.40.2',
          sampleRate: sampleRate,
          numberOfChannels: 2,
          bitrate: 128000
        });
      } else {
        videoEncoder.configure({
          codec: 'vp09.00.10.08',
          width: 1280,
          height: 720,
          bitrate: 12000000,
          framerate: 30,
          latencyMode: 'quality'
        });
        audioEncoder.configure({
          codec: 'opus',
          sampleRate: sampleRate,
          numberOfChannels: 2,
          bitrate: 128000
        });
      }

      // 4. Render loop with Pipelined Seeking
      const fps = 30;
      const frameDuration = 1 / fps;
      const totalFrames = Math.round(exportDuration * fps);
      
      console.log(`[Export] Starting render: ${totalFrames} frames`);

      // Helper for seeking a single clip with promise caching to avoid redundant seeks
      const activeSeeks = new Map<number, Promise<void>>();
      const seekClip = (clip: VideoClip, time: number) => {
        const video = videoElementsRef.current[clip.id];
        if (!video) return Promise.resolve();
        
        const localTime = (time - clip.timelinePosition.start) + clip.sourceStart;
        const seekKey = clip.id;
        
        // If already seeking to this time, return the existing promise
        // We check currentTime to see if we actually need to seek
        if (Math.abs(video.currentTime - localTime) < 0.001) {
          return Promise.resolve();
        }

        const seekPromise = new Promise<void>(resolve => {
          let resolved = false;
          const timeout = setTimeout(() => { 
            if (!resolved) { 
              resolved = true; 
              activeSeeks.delete(seekKey);
              resolve(); 
            } 
          }, 1000);

          const onSeeked = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            activeSeeks.delete(seekKey);
            
            // If tab is hidden, resolve immediately as rAF/rVFC won't fire
            if (document.visibilityState === 'hidden') {
              resolve();
              return;
            }

            if ('requestVideoFrameCallback' in video) {
              (video as any).requestVideoFrameCallback(() => resolve());
              // Safety timeout for rVFC
              setTimeout(() => resolve(), 100);
            } else {
              requestAnimationFrame(() => resolve());
              // Safety timeout for rAF
              setTimeout(() => resolve(), 100);
            }
          };
          video.addEventListener('seeked', onSeeked, { once: true });
          video.currentTime = localTime;
        });

        activeSeeks.set(seekKey, seekPromise);
        return seekPromise;
      };

      // Start pre-seeking first frame
      const firstFrameTime = exportRange.start;
      const firstActiveClips = exportClips.filter(c => firstFrameTime >= c.timelinePosition.start && firstFrameTime < c.timelinePosition.end);
      await Promise.all(firstActiveClips.filter(c => c.type === TrackType.VIDEO).map(c => seekClip(c as VideoClip, firstFrameTime)));

      for (let i = 0; i < totalFrames; i++) {
        const frameTime = i * frameDuration;
        const actualTime = Math.round((exportRange.start + frameTime) * 100) / 100;
        
        // Progress starts from 10% and goes to 100%
        if (i % 30 === 0 || i === totalFrames - 1) {
          setProgress(10 + ((i + 1) / totalFrames) * 90);
        }

        // 4a. Prefetch next frames' seeks while rendering current
        // Look ahead 3 frames to hide more latency
        for (let lookAhead = 1; lookAhead <= 3; lookAhead++) {
          if (i + lookAhead < totalFrames) {
            const nextActualTime = Math.round((exportRange.start + (i + lookAhead) * frameDuration) * 100) / 100;
            const nextActiveClips = exportClips.filter(c => nextActualTime >= c.timelinePosition.start && nextActualTime < c.timelinePosition.end);
            nextActiveClips.filter(c => c.type === TrackType.VIDEO || c.type === TrackType.SCREEN).forEach(c => seekClip(c as VideoClip, nextActualTime));
          }
        }
        
        // 4b. Composite Frame
        offscreenCtx.fillStyle = '#000000';
        offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

        const activeClips = exportClips.filter(c => actualTime >= c.timelinePosition.start && actualTime < c.timelinePosition.end)
          .sort((a, b) => {
            const indexA = tracks.findIndex(t => t.id === a.trackId);
            const indexB = tracks.findIndex(t => t.id === b.trackId);
            return indexB - indexA; // Draw higher index (bottom) tracks first
          });

        const gpuRenderedClips = new Set<number>();
        if (gpuDevice && gpuPipeline && gpuSampler && gpuContext) {
          // WebGPU Path for Video Layers
          const commandEncoder = gpuDevice.createCommandEncoder();
          const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
              view: gpuContext.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 }, 
              loadOp: 'clear',
              storeOp: 'store'
            }]
          });
          renderPass.setPipeline(gpuPipeline);

          let hasGpuVideo = false;
          for (const clip of activeClips) {
            if (clip.type !== TrackType.VIDEO && clip.type !== TrackType.SCREEN) continue;

            const track = tracks.find(t => t.id === clip.trackId);
            if (!track || !track.isVisible) continue;

            const parentTrack = track.parentId ? tracks.find(t => t.id === track.parentId) : null;
            const effectiveTrack = parentTrack || track;
            
            const transform = { position: { x: 0, y: 0 }, rotation: 0, flipHorizontal: false, flipVertical: false, scale: { x: 1, y: 1 }, opacity: 1, crop: { top: 0, right: 0, bottom: 0, left: 0 }, ...(clip.transform || {}) };
            const rotation = (typeof transform.rotation === 'number' ? transform.rotation : (transform.rotation as any)?.z || 0) * Math.PI / 180;
            
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            const sx = (transform.scale?.x || 1) * (transform.flipHorizontal ? -1 : 1);
            const sy = (transform.scale?.y || 1) * (transform.flipVertical ? -1 : 1);
            const tx = (transform.position.x || 0) / 640; 
            const ty = -(transform.position.y || 0) / 360; 

            const uniformData = new Float32Array(24); 
            uniformData[0] = sx * cos; uniformData[1] = sx * sin; uniformData[2] = 0; uniformData[3] = 0;
            uniformData[4] = -sy * sin; uniformData[5] = sy * cos; uniformData[6] = 0; uniformData[7] = 0;
            uniformData[8] = tx; uniformData[9] = ty; uniformData[10] = 1; uniformData[11] = 0;
            
            uniformData[12] = transform.opacity;
            uniformData[13] = effectiveTrack.lutConfig?.intensity ?? 1;
            
            const isCameraSubTrack = track.isSubTrack && track.subTrackType === 'camera';
            const isStandardVideo = !track.isSubTrack && track.type === TrackType.VIDEO;
            
            let hasLut = (effectiveTrack.lutConfig?.enabled && lutTexturesRef.current[effectiveTrack.id]) ? 1 : 0;
            let isOverlay = 0;
            
            if (isCameraSubTrack || isStandardVideo) {
              const isScreen = clip.type === TrackType.SCREEN;
              const hasOverlay = !!clip.overlayRect;
              
              if (isScreen) {
                if (hasOverlay) {
                  isOverlay = 1;
                } else {
                  hasLut = 0; // Ignore screen recordings without overlay
                }
              }
            } else {
              hasLut = 0; // Screen sub-track or other: no LUT
            }
            
            const uintView = new Uint32Array(uniformData.buffer);
            uintView[14] = hasLut;
            uintView[15] = isOverlay;

            if (clip.overlayRect) {
              // Scale overlay rect to export resolution (1280x720)
              const scaleX = 1280 / 1920;
              const scaleY = 720 / 1080;
              uniformData[16] = clip.overlayRect.x * scaleX;
              uniformData[17] = clip.overlayRect.y * scaleY;
              uniformData[18] = clip.overlayRect.width * scaleX;
              uniformData[19] = clip.overlayRect.height * scaleY;
            }

            const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };
            uniformData.set([crop.top, crop.right, crop.bottom, crop.left], 20);

            const uniformBuffer = gpuDevice.createBuffer({
              size: uniformData.byteLength,
              usage: (window as any).GPUBufferUsage.UNIFORM | (window as any).GPUBufferUsage.COPY_DST,
              mappedAtCreation: true
            });
            new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
            uniformBuffer.unmap();

            const video = videoElementsRef.current[clip.id];
            if (video && video.readyState >= 2 && video.videoWidth > 0) {
              try {
                const videoTexture = gpuDevice.importExternalTexture({ source: video });
                const lutTexture = (hasLut && lutTexturesRef.current[effectiveTrack.id]) 
                  ? lutTexturesRef.current[effectiveTrack.id] 
                  : dummyLutTextureRef.current!;
                
                const bindGroup = gpuDevice.createBindGroup({
                  layout: gpuPipeline.getBindGroupLayout(0),
                  entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: gpuSampler },
                    { binding: 2, resource: videoTexture },
                    { binding: 3, resource: dummyTexture.createView() },
                    { binding: 4, resource: { buffer: externalTrueBuffer } },
                    { binding: 5, resource: lutTexture.createView() },
                    { binding: 6, resource: gpuSampler } // Reuse sampler for LUT
                  ]
                });

                renderPass.setBindGroup(0, bindGroup);
                renderPass.draw(4);
                gpuRenderedClips.add(clip.id);
                hasGpuVideo = true;
              } catch (e) {
                console.warn("[Export] GPU Video Import failed:", e);
              }
            }
          }
          renderPass.end();
          gpuDevice.queue.submit([commandEncoder.finish()]);

          if (hasGpuVideo) {
            offscreenCtx.drawImage(gpuCanvas, 0, 0);
          }
        }

        // 2D Path for non-video layers (and video if GPU failed or skipped)
        for (const clip of activeClips) {
          if (gpuRenderedClips.has(clip.id)) continue;

          const track = tracks.find(t => t.id === clip.trackId);
          if (!track || !track.isVisible) continue;
          
          const transform = { position: { x: 0, y: 0 }, rotation: 0, flipHorizontal: false, flipVertical: false, scale: { x: 1, y: 1 }, opacity: 1, crop: { top: 0, right: 0, bottom: 0, left: 0 }, ...(clip.transform || {}) };
          const rotation = typeof transform.rotation === 'number' ? transform.rotation : (transform.rotation as any)?.z || 0;

          offscreenCtx.save();
          offscreenCtx.globalAlpha = transform.opacity;
          offscreenCtx.translate((transform.position.x || 0) + 640, (transform.position.y || 0) + 360);
          offscreenCtx.rotate(rotation * Math.PI / 180);
          offscreenCtx.scale((transform.scale?.x || 1) * (transform.flipHorizontal ? -1 : 1), (transform.scale?.y || 1) * (transform.flipVertical ? -1 : 1));

          if (clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) {
            const video = videoElementsRef.current[clip.id];
            if (video && video.videoWidth > 0) {
              const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };
              const sx = (crop.left / 100) * video.videoWidth;
              const sy = (crop.top / 100) * video.videoHeight;
              const sw = video.videoWidth * (1 - (crop.left + crop.right) / 100);
              const sh = video.videoHeight * (1 - (crop.top + crop.bottom) / 100);
              offscreenCtx.drawImage(video, sx, sy, sw, sh, -640, -360, 1280, 720);
            }
          } else if (clip.type === TrackType.IMAGE) {
            const img = imageElementsRef.current[clip.id];
            if (img) {
              const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };
              const sx = (crop.left / 100) * img.width;
              const sy = (crop.top / 100) * img.height;
              const sw = img.width * (1 - (crop.left + crop.right) / 100);
              const sh = img.height * (1 - (crop.top + crop.bottom) / 100);
              offscreenCtx.drawImage(img, sx, sy, sw, sh, -640, -360, 1280, 720);
            }
          } else if (clip.type === TrackType.TEXT || clip.type === TrackType.SUBTITLE) {
            const fontSize = clip.style?.fontSize || 48;
            offscreenCtx.font = `${clip.style?.fontWeight || 'normal'} ${fontSize}px ${clip.style?.fontFamily || 'sans-serif'}`;
            offscreenCtx.fillStyle = clip.style?.color || '#ffffff';
            offscreenCtx.textAlign = 'center';
            offscreenCtx.textBaseline = 'middle';
            if (clip.type === TrackType.SUBTITLE || (clip.style?.backgroundColor && clip.style.backgroundColor !== 'transparent')) {
              const textWidth = offscreenCtx.measureText(clip.content || '').width;
              offscreenCtx.fillStyle = clip.style?.backgroundColor || 'rgba(0,0,0,0.6)';
              offscreenCtx.fillRect(-textWidth/2 - 20, -fontSize/2 - 10, textWidth + 40, fontSize + 20);
              offscreenCtx.fillStyle = clip.style?.color || '#ffffff';
            }
            offscreenCtx.fillText(clip.content || '', 0, 0);
          }
          offscreenCtx.restore();
        }

        // Update main canvas for preview
        ctx.drawImage(offscreenCanvas, 0, 0);
        
        // 4c. Encode frame and audio
        const timestamp = Math.round(i * frameDuration * 1000000);
        try {
          // Optimization: Use VideoFrame directly from canvas if possible
          const frame = new VideoFrame(offscreenCanvas, { 
            timestamp, 
            duration: Math.round(frameDuration * 1000000) 
          });
          videoEncoder.encode(frame);
          frame.close();
          if (i % 100 === 0) console.log(`[Export] Encoded frame ${i}/${totalFrames}`);
        } catch (encodeError) {
          console.error("[Export] Frame encoding failed at timestamp", timestamp, encodeError);
        }

        const startSample = Math.floor(i * frameDuration * sampleRate);
        const endSample = Math.floor((i + 1) * frameDuration * sampleRate);
        const numSamples = endSample - startSample;
        if (numSamples > 0) {
          const interleavedData = new Float32Array(numSamples * 2);
          const leftChannel = renderedAudioBuffer.getChannelData(0);
          const rightChannel = renderedAudioBuffer.getChannelData(1);
          for (let s = 0; s < numSamples; s++) {
            interleavedData[s * 2] = leftChannel[startSample + s] || 0;
            interleavedData[s * 2 + 1] = rightChannel[startSample + s] || 0;
          }
          const audioData = new AudioData({ format: 'f32', sampleRate: sampleRate, numberOfFrames: numSamples, numberOfChannels: 2, timestamp, data: interleavedData });
          audioEncoder.encode(audioData);
          audioData.close();
        }

        // Wait for next frame's pre-seeks to complete if needed
        if (i < totalFrames - 1) {
          const nextActualTime = Math.round((exportRange.start + (i + 1) * frameDuration) * 100) / 100;
          const nextActiveClips = exportClips.filter(c => nextActualTime >= c.timelinePosition.start && nextActualTime < c.timelinePosition.end);
          const videoClips = nextActiveClips.filter(c => c.type === TrackType.VIDEO || c.type === TrackType.SCREEN) as VideoClip[];
          
          // Await any active seeks for these clips
          await Promise.all(videoClips.map(c => {
            const activeSeek = activeSeeks.get(c.id);
            if (activeSeek) return activeSeek;
            return seekClip(c, nextActualTime);
          }));
        }
      }

      // 5. Finalize Export
      console.log("[Export] Finalizing encoders...");
      await videoEncoder.flush();
      await audioEncoder.flush();
      videoEncoder.close();
      audioEncoder.close();

      console.log("[Export] Finalizing muxer...");
      muxer.finalize();

      const { buffer } = muxer.target as (WebMArrayBufferTarget | MP4ArrayBufferTarget);
      const blob = new Blob([buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sequence-export-${Date.now()}.${format}`;
      a.click();
      
      setStatus('completed');
      
      // Cleanup
      videoElementsRef.current = {};
      imageElementsRef.current = {};
      audioCtx.close();

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
