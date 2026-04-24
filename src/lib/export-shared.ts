import { Track, VideoClip } from '../types';

export const EXPORT_WIDTH = 1280;
export const EXPORT_HEIGHT = 720;
export const EXPORT_FPS = 30;
export const EXPORT_SAMPLE_RATE = 44100;

export const COMPOSITE_SHADER = `
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
    overlay_rect: vec4<f32>,
    crop: vec4<f32>,
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

export interface ExportRange {
  start: number;
  end: number;
}

export interface ExportFramePlan {
  time: number;
  activeClips: VideoClip[];
}

export interface ExportTimelinePlan {
  visibleTracks: Track[];
  trackById: Map<string, Track>;
  trackOrderById: Map<string, number>;
  exportClips: VideoClip[];
  framePlans: ExportFramePlan[];
  totalFrames: number;
  exportDuration: number;
  fps: number;
}

export function buildExportPlan(
  clips: VideoClip[],
  tracks: Track[],
  exportRange: ExportRange,
  fps = EXPORT_FPS
): ExportTimelinePlan {
  const visibleTracks = tracks
    .filter((track) => track.isVisible)
    .slice()
    .sort((left, right) => left.order - right.order);

  const trackById = new Map<string, Track>(tracks.map((track) => [track.id, track]));
  const trackOrderById = new Map<string, number>(visibleTracks.map((track, index) => [track.id, index]));
  const visibleTrackIds = new Set(visibleTracks.map((track) => track.id));

  const exportClips = clips
    .filter((clip) => visibleTrackIds.has(clip.trackId))
    .filter((clip) => clip.timelinePosition.end > exportRange.start && clip.timelinePosition.start < exportRange.end)
    .slice()
    .sort((left, right) => {
      const leftOrder = trackOrderById.get(left.trackId) ?? 0;
      const rightOrder = trackOrderById.get(right.trackId) ?? 0;
      if (leftOrder !== rightOrder) return rightOrder - leftOrder;
      return left.timelinePosition.start - right.timelinePosition.start;
    });

  const exportDuration = Math.max(0, Math.round((exportRange.end - exportRange.start) * fps) / fps);
  const totalFrames = Math.max(0, Math.round(exportDuration * fps));
  const framePlans: ExportFramePlan[] = [];

  for (let index = 0; index < totalFrames; index += 1) {
    const time = exportRange.start + index / fps;
    const activeClips = exportClips
      .filter((clip) => time >= clip.timelinePosition.start && time < clip.timelinePosition.end)
      .slice()
      .sort((left, right) => {
        const leftOrder = trackOrderById.get(left.trackId) ?? 0;
        const rightOrder = trackOrderById.get(right.trackId) ?? 0;
        if (leftOrder !== rightOrder) return rightOrder - leftOrder;
        return left.timelinePosition.start - right.timelinePosition.start;
      });

    framePlans.push({ time, activeClips });
  }

  return {
    visibleTracks,
    trackById,
    trackOrderById,
    exportClips,
    framePlans,
    totalFrames,
    exportDuration,
    fps,
  };
}

