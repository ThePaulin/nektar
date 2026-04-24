
/// <reference types="@webgpu/types" />

import { Track, TrackType, VideoClip, LUTData } from '../types';
import { COMPOSITE_SHADER } from './export-shared';

export class WebGPURenderer {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private lutSampler: GPUSampler | null = null;
  private dummyTexture: GPUTexture | null = null;
  private dummyLutTexture: GPUTexture | null = null;
  private externalTrueBuffer: GPUBuffer | null = null;
  private externalFalseBuffer: GPUBuffer | null = null;
  private context: GPUCanvasContext | null = null;
  private width: number = 1280;
  private height: number = 720;

  constructor() {}

  async init(canvas: HTMLCanvasElement | OffscreenCanvas) {
    if (!navigator.gpu) return false;

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      if (!this.device) {
        console.warn("Failed to get WebGPU device, falling back to Canvas2D");
        return false;
      }
      this.context = canvas.getContext('webgpu') as unknown as GPUCanvasContext;
      
      if (!this.context) {
        console.warn("Failed to get WebGPU context from canvas, falling back to Canvas2D");
        return false;
      }

      this.width = canvas.width;
      this.height = canvas.height;

      this.context.configure({
        device: this.device,
        format: 'bgra8unorm',
        alphaMode: 'premultiplied'
      });

      const shaderModule = this.device.createShaderModule({ code: COMPOSITE_SHADER });
      this.pipeline = this.device.createRenderPipeline({
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

      this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      this.lutSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      
      this.dummyTexture = this.device.createTexture({ 
        size: [1, 1], 
        format: 'rgba8unorm', 
        usage: GPUTextureUsage.TEXTURE_BINDING 
      });

      this.dummyLutTexture = this.device.createTexture({
        size: [2, 2, 2],
        format: 'rgba8unorm',
        dimension: '3d',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });

      this.externalTrueBuffer = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
      new Uint32Array(this.externalTrueBuffer.getMappedRange())[0] = 1;
      this.externalTrueBuffer.unmap();

      this.externalFalseBuffer = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
      new Uint32Array(this.externalFalseBuffer.getMappedRange())[0] = 0;
      this.externalFalseBuffer.unmap();

      return true;
    } catch (e) {
      console.error("WebGPU init failed:", e);
      return false;
    }
  }

  createLutTexture(lutData: { size: number, data: Float32Array }) {
    if (!this.device) return null;

    const size = lutData.size;
    const texture = this.device.createTexture({
      size: [size, size, size],
      format: 'rgba8unorm',
      dimension: '3d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    const lutUint8 = new Uint8Array(lutData.data.length);
    for (let i = 0; i < lutData.data.length; i++) {
      lutUint8[i] = Math.max(0, Math.min(255, Math.round(lutData.data[i] * 255)));
    }

    this.device.queue.writeTexture(
      { texture },
      lutUint8.buffer,
      { bytesPerRow: size * 4, rowsPerImage: size },
      [size, size, size]
    );

    return texture;
  }

  render(
    activeClips: VideoClip[],
    tracks: Track[],
    videoRefs: { [key: number]: HTMLVideoElement | VideoFrame | null },
    imageRefs: { [key: number]: HTMLImageElement | ImageBitmap | null },
    lutTextures: { [key: string]: GPUTexture },
    showLutPreview: boolean,
    trackById?: Map<string, Track>
  ) {
    if (!this.device || !this.pipeline || !this.context) return;

    const commandEncoder = this.device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    renderPass.setPipeline(this.pipeline);

    for (const clip of activeClips) {
      const track = trackById?.get(clip.trackId) ?? tracks.find(t => t.id === clip.trackId);
      if (!track || !track.isVisible) continue;

      const parentTrack = track.parentId ? (trackById?.get(track.parentId) ?? tracks.find(t => t.id === track.parentId)) : null;
      const effectiveTrack = parentTrack || track;
      
      const transform = { 
        position: { x: 0, y: 0 }, 
        rotation: 0, 
        flipHorizontal: false, 
        flipVertical: false, 
        scale: { x: 1, y: 1 }, 
        opacity: 1, 
        crop: { top: 0, right: 0, bottom: 0, left: 0 }, 
        ...(clip.transform || {}) 
      };

      const rotation = (typeof transform.rotation === 'number' ? transform.rotation : (transform.rotation as any)?.z || 0) * Math.PI / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const sx = (transform.scale?.x || 1) * (transform.flipHorizontal ? -1 : 1);
      const sy = (transform.scale?.y || 1) * (transform.flipVertical ? -1 : 1);
      const tx = (transform.position.x || 0) / (this.width / 2); 
      const ty = -(transform.position.y || 0) / (this.height / 2); 

      const uniformData = new Float32Array(24); 
      uniformData[0] = sx * cos; uniformData[1] = sx * sin; uniformData[2] = 0; uniformData[3] = 0;
      uniformData[4] = -sy * sin; uniformData[5] = sy * cos; uniformData[6] = 0; uniformData[7] = 0;
      uniformData[8] = tx; uniformData[9] = ty; uniformData[10] = 1; uniformData[11] = 0;
      
      uniformData[12] = transform.opacity;
      uniformData[13] = effectiveTrack.lutConfig?.intensity ?? 1;
      
      let hasLut = (showLutPreview && effectiveTrack.lutConfig?.enabled && lutTextures[effectiveTrack.id]) ? 1 : 0;
      let isOverlay = 0;
      
      if (track.isSubTrack && track.subTrackType === 'camera' || (!track.isSubTrack && track.type === TrackType.VIDEO)) {
        if (clip.type === TrackType.SCREEN && clip.overlayRect) {
          isOverlay = 1;
        } else if (clip.type === TrackType.SCREEN) {
          hasLut = 0;
        }
      } else {
        hasLut = 0;
      }
      
      const uintView = new Uint32Array(uniformData.buffer);
      uintView[14] = hasLut;
      uintView[15] = isOverlay;

      if (clip.overlayRect) {
        const scaleX = this.width / 1920;
        const scaleY = this.height / 1080;
        uniformData[16] = clip.overlayRect.x * scaleX;
        uniformData[17] = clip.overlayRect.y * scaleY;
        uniformData[18] = clip.overlayRect.width * scaleX;
        uniformData[19] = clip.overlayRect.height * scaleY;
      }

      const crop = transform.crop || { top: 0, right: 0, bottom: 0, left: 0 };
      uniformData.set([crop.top, crop.right, crop.bottom, crop.left], 20);

      const uniformBuffer = this.device.createBuffer({
        size: uniformData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
      });
      new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
      uniformBuffer.unmap();

      if (clip.type === TrackType.VIDEO || clip.type === TrackType.SCREEN) {
        const video = videoRefs[clip.id];
        const isVideoFrame = typeof VideoFrame !== 'undefined' && video instanceof VideoFrame;
        const sourceWidth = isVideoFrame ? video.displayWidth : (video as HTMLVideoElement | null)?.videoWidth ?? 0;
        const sourceHeight = isVideoFrame ? video.displayHeight : (video as HTMLVideoElement | null)?.videoHeight ?? 0;

        if (video && (isVideoFrame || ((video as HTMLVideoElement).readyState >= 2 && sourceWidth > 0))) {
          try {
            const videoTexture = this.device.importExternalTexture({ source: video });
            const lutTexture = (hasLut && lutTextures[effectiveTrack.id]) 
              ? lutTextures[effectiveTrack.id] 
              : this.dummyLutTexture!;
            
            const bindGroup = this.device.createBindGroup({
              layout: this.pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: this.sampler! },
                { binding: 2, resource: videoTexture },
                { binding: 3, resource: this.dummyTexture!.createView() },
                { binding: 4, resource: { buffer: this.externalTrueBuffer! } },
                { binding: 5, resource: lutTexture.createView() },
                { binding: 6, resource: this.lutSampler! }
              ]
            });

            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(4);
          } catch (e) {
            console.warn("GPU Video Import failed for clip", clip.id, e);
          }
        }
      } else if (clip.type === TrackType.IMAGE) {
        const img = imageRefs[clip.id];
        const isImageBitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
        const sourceWidth = isImageBitmap ? img.width : (img as HTMLImageElement | null)?.naturalWidth ?? 0;
        const sourceHeight = isImageBitmap ? img.height : (img as HTMLImageElement | null)?.naturalHeight ?? 0;
        if (img && (isImageBitmap || ((img as HTMLImageElement).complete && sourceWidth > 0))) {
          try {
            const imageTexture = this.device.createTexture({
              size: [sourceWidth, sourceHeight],
              format: 'rgba8unorm',
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            this.device.queue.copyExternalImageToTexture(
              { source: img },
              { texture: imageTexture },
              [sourceWidth, sourceHeight]
            );

            const lutTexture = (hasLut && lutTextures[effectiveTrack.id]) 
              ? lutTextures[effectiveTrack.id] 
              : this.dummyLutTexture!;

            const bindGroup = this.device.createBindGroup({
              layout: this.pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: this.sampler! },
                { binding: 2, resource: this.dummyTexture!.createView() }, // placeholder for external
                { binding: 3, resource: imageTexture.createView() },
                { binding: 4, resource: { buffer: this.externalFalseBuffer! } },
                { binding: 5, resource: lutTexture.createView() },
                { binding: 6, resource: this.lutSampler! }
              ]
            });

            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(4);
          } catch (e) {
            console.warn("GPU Image Import failed:", e);
          }
        }
      }
    }

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}
