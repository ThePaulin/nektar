
/// <reference types="@webgpu/types" />

import { Track, TrackType, VideoClip, LUTData } from '../types';

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
    let p = u.transform * vec3<f32>(pos[vertexIndex], 1.0);
    out.position = vec4<f32>(p.xy, 0.0, 1.0);
    
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
        if (in.position.x >= u.overlay_rect.x && in.position.x <= u.overlay_rect.x + u.overlay_rect.z &&
            in.position.y >= u.overlay_rect.y && in.position.y <= u.overlay_rect.y + u.overlay_rect.w) {
          apply_lut = true;
        }
      } else {
        apply_lut = true;
      }
      
      if (apply_lut) {
        let lut_size = f32(textureDimensions(t_lut).x);
        let coords = color.rgb * ((lut_size - 1.0) / lut_size) + (0.5 / lut_size);
        let lut_color = textureSample(t_lut, s_lut, coords).rgb;
        color = vec4<f32>(mix(color.rgb, lut_color, u.lut_intensity), color.a);
      }
    }

    return vec4<f32>(color.rgb, color.a * u.opacity);
  }
`;

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
        console.error("Failed to get WebGPU device");
        return false;
      }
      this.context = canvas.getContext('webgpu') as unknown as GPUCanvasContext;
      
      if (!this.context) {
        console.error("Failed to get WebGPU context from canvas");
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
    videoRefs: { [key: number]: HTMLVideoElement | null },
    imageRefs: { [key: number]: HTMLImageElement | null },
    lutTextures: { [key: string]: GPUTexture },
    showLutPreview: boolean
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
      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || !track.isVisible) continue;

      const parentTrack = track.parentId ? tracks.find(t => t.id === track.parentId) : null;
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
        // WebGPU importExternalTexture usually requires HAVE_CURRENT_DATA (2) or better
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
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
        } else {
          const video = videoRefs[clip.id];
          if (video) {
            // console.log("Video not ready for clip", clip.id, "readyState:", video.readyState, "videoWidth:", video.videoWidth);
          }
        }
      } else if (clip.type === TrackType.IMAGE) {
        const img = imageRefs[clip.id];
        if (img && img.complete && img.naturalWidth > 0) {
          try {
            const imageTexture = this.device.createTexture({
              size: [img.naturalWidth, img.naturalHeight],
              format: 'rgba8unorm',
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            this.device.queue.copyExternalImageToTexture(
              { source: img },
              { texture: imageTexture },
              [img.naturalWidth, img.naturalHeight]
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
