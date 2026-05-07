import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDesktopExportRequest } from '@/src/lib/desktop-export';
import { makeClip, makeTrack } from '../factories/editor';
import { TrackType } from '@/src/types';
import { videoDB } from '@/src/services/db';
import { buildFfmpegCommand, getFfmpegPathCandidates } from '@/electron/desktop-export-service';

describe('desktop export request builder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates blob-backed assets and preserves export offsets', async () => {
    vi.spyOn(videoDB, 'getBlob').mockResolvedValue(new Blob(['video-a'], { type: 'video/mp4' }));

    const clips = [
      makeClip({
        id: 1,
        blobId: 'shared',
        videoUrl: 'blob:one',
        timelinePosition: { start: 0, end: 5 },
      }),
      makeClip({
        id: 2,
        blobId: 'shared',
        videoUrl: 'blob:two',
        timelinePosition: { start: 5, end: 10 },
      }),
    ];

    const request = await buildDesktopExportRequest({
      clips,
      tracks: [makeTrack()],
      exportRange: { start: 0, end: 10 },
      format: 'mp4',
    });

    expect(request.assets).toHaveLength(1);
    expect(request.assets[0]?.assetId).toBe('blob:shared');
    expect(request.assets[0]?.buffer).toBeInstanceOf(ArrayBuffer);
    expect(request.assets[0]?.sourceUrl).toBeUndefined();
    expect(request.clips.map((clip) => clip.assetRef?.assetId)).toEqual(['blob:shared', 'blob:shared']);
  });

  it('inlines blob URLs when indexed storage is unavailable', async () => {
    const blob = new Blob(['live-recording'], { type: 'video/webm' });

    vi.spyOn(videoDB, 'getBlob').mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
    }));

    const request = await buildDesktopExportRequest({
      clips: [
        makeClip({
          id: 3,
          blobId: 'missing',
          videoUrl: 'blob:live-recording',
          timelinePosition: { start: 0, end: 5 },
        }),
      ],
      tracks: [makeTrack()],
      exportRange: { start: 0, end: 5 },
      format: 'mp4',
    });

    expect(fetch).toHaveBeenCalledWith('blob:live-recording');
    expect(request.assets[0]?.mimeType).toBe('video/webm');
    expect(request.assets[0]?.buffer).toBeInstanceOf(ArrayBuffer);
    expect(request.assets[0]?.sourceUrl).toBeUndefined();
  });

  it('falls back to XMLHttpRequest when fetch rejects for blob URLs', async () => {
    const blob = new Blob(['live-recording'], { type: 'video/mp4' });

    vi.spyOn(videoDB, 'getBlob').mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    class MockBlobRequest {
      responseType = '';
      response: Blob | null = null;
      status = 0;
      statusText = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      open(_method: string, url: string) {
        expect(url).toBe('blob:file:///packaged-media');
      }

      send() {
        this.response = blob;
        this.onload?.();
      }
    }

    vi.stubGlobal('XMLHttpRequest', MockBlobRequest as unknown as typeof XMLHttpRequest);

    const request = await buildDesktopExportRequest({
      clips: [
        makeClip({
          id: 4,
          blobId: 'missing',
          videoUrl: 'blob:file:///packaged-media',
          timelinePosition: { start: 0, end: 5 },
        }),
      ],
      tracks: [makeTrack()],
      exportRange: { start: 0, end: 5 },
      format: 'mp4',
    });

    expect(fetch).toHaveBeenCalledWith('blob:file:///packaged-media');
    expect(request.assets[0]?.mimeType).toBe('video/mp4');
    expect(request.assets[0]?.buffer).toBeInstanceOf(ArrayBuffer);
    expect(request.assets[0]?.sourceUrl).toBeUndefined();
  });
});

describe('desktop ffmpeg command generation', () => {
  it('checks packaged, local resource, PATH, and common macOS ffmpeg locations', () => {
    const candidates = getFfmpegPathCandidates({
      platform: 'darwin',
      arch: 'arm64',
      cwd: '/workspace/nektar',
      resourcesPath: '/Applications/Nektar.app/Contents/Resources',
      pathEnv: '/custom/bin:/usr/local/bin',
    });

    expect(candidates).toEqual([
      '/Applications/Nektar.app/Contents/Resources/ffmpeg/darwin-arm64/ffmpeg',
      '/workspace/nektar/resources/ffmpeg/darwin-arm64/ffmpeg',
      '/custom/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
    ]);
  });

  it('builds a single-video export command with trim and output path preserved', () => {
    const request = {
      format: 'mp4' as const,
      width: 1920,
      height: 1080,
      fps: 30,
      range: { start: 0, end: 8 },
      tracks: [makeTrack()],
      clips: [
        {
          id: 10,
          trackId: 'track-1',
          label: 'Main clip',
          type: TrackType.VIDEO,
          duration: 20,
          sourceStart: 2,
          timelinePosition: { start: 1, end: 7 },
          volume: 1,
          assetRef: { assetId: 'asset-1' },
        },
      ],
      assets: [],
    };

    const args = buildFfmpegCommand({
      request,
      materializedAssets: new Map([
        ['asset-1', { assetId: 'asset-1', filePath: '/tmp/clip with spaces.mp4', kind: 'video' }],
      ]),
      outputPath: '/tmp/output export.mp4',
    });

    expect(args).toContain('/tmp/clip with spaces.mp4');
    expect(args).toContain('/tmp/output export.mp4');
    expect(args.join(' ')).toContain('trim=start=2:duration=6');
    expect(args.join(' ')).toContain('overlay=');
  });

  it('mutes track audio and includes image and subtitle layers', () => {
    const request = {
      format: 'webm' as const,
      width: 1280,
      height: 720,
      fps: 30,
      range: { start: 0, end: 6 },
      tracks: [
        makeTrack({ id: 'video-track', order: 0 }),
        makeTrack({ id: 'audio-track', type: TrackType.AUDIO, order: 1, isMuted: true }),
      ],
      clips: [
        {
          id: 11,
          trackId: 'video-track',
          label: 'Image overlay',
          type: TrackType.IMAGE,
          duration: 6,
          sourceStart: 0,
          timelinePosition: { start: 0, end: 6 },
          volume: 1,
          assetRef: { assetId: 'image-1' },
        },
        {
          id: 12,
          trackId: 'audio-track',
          label: 'Muted audio',
          type: TrackType.AUDIO,
          duration: 6,
          sourceStart: 0,
          timelinePosition: { start: 0, end: 6 },
          volume: 0.8,
          assetRef: { assetId: 'audio-1' },
        },
        {
          id: 13,
          trackId: 'video-track',
          label: 'Subtitle',
          type: TrackType.SUBTITLE,
          duration: 6,
          sourceStart: 0,
          timelinePosition: { start: 1, end: 5 },
          volume: 1,
          content: 'Hello world',
          style: { fontSize: 42, color: '#ffffff' },
        },
      ],
      assets: [],
    };

    const args = buildFfmpegCommand({
      request,
      materializedAssets: new Map([
        ['image-1', { assetId: 'image-1', filePath: '/tmp/image.png', kind: 'image' }],
        ['audio-1', { assetId: 'audio-1', filePath: '/tmp/audio.wav', kind: 'audio' }],
      ]),
      outputPath: '/tmp/output.webm',
    });

    const serialized = args.join(' ');
    expect(serialized).toContain('drawtext=');
    expect(serialized).toContain('loop=loop=-1:size=1:start=0');
    expect(serialized).toContain('volume=0');
    expect(serialized).toContain('amix=inputs=1');
  });

  it('keeps lower-order tracks visually on top and skips audio filters for video-only assets', () => {
    const request = {
      format: 'mp4' as const,
      width: 1920,
      height: 1080,
      fps: 30,
      range: { start: 0, end: 18 },
      tracks: [
        makeTrack({ id: 'camera-track', order: 0 }),
        makeTrack({ id: 'screen-track', order: 1 }),
      ],
      clips: [
        {
          id: 21,
          trackId: 'camera-track',
          label: 'Camera',
          type: TrackType.VIDEO,
          duration: 18,
          sourceStart: 0,
          timelinePosition: { start: 0, end: 18 },
          volume: 1,
          transform: {
            position: { x: 200, y: 100, z: 0 },
            rotation: 0,
            scale: { x: 0.5, y: 0.5 },
            opacity: 1,
            crop: { top: 0, right: 10, bottom: 0, left: 10 },
          },
          assetRef: { assetId: 'camera-asset' },
        },
        {
          id: 22,
          trackId: 'screen-track',
          label: 'Screen',
          type: TrackType.VIDEO,
          duration: 18,
          sourceStart: 0,
          timelinePosition: { start: 0, end: 18 },
          volume: 1,
          assetRef: { assetId: 'screen-asset' },
        },
      ],
      assets: [
        {
          assetId: 'camera-asset',
          kind: 'video' as const,
          originalName: 'camera.mp4',
          mimeType: 'video/mp4;codecs=avc1.64001f,opus',
        },
        {
          assetId: 'screen-asset',
          kind: 'video' as const,
          originalName: 'screen.mp4',
          mimeType: 'video/mp4;codecs=avc1.640028',
        },
      ],
    };

    const args = buildFfmpegCommand({
      request,
      materializedAssets: new Map([
        ['camera-asset', { assetId: 'camera-asset', filePath: '/tmp/camera.mp4', kind: 'video' }],
        ['screen-asset', { assetId: 'screen-asset', filePath: '/tmp/screen.mp4', kind: 'video' }],
      ]),
      outputPath: '/tmp/output.mp4',
    });

    const filterGraph = args[args.indexOf('-filter_complex') + 1] as string;
    expect(args.slice(0, 4)).toEqual(['-i', '/tmp/screen.mp4', '-i', '/tmp/camera.mp4']);
    expect(filterGraph).toContain('[0:v]trim=');
    expect(filterGraph).toContain('[1:v]trim=');
    expect(filterGraph).toContain('crop=iw*(1-0.2):ih*(1-0):iw*0.1:ih*0');
    expect(filterGraph).not.toContain(',[vclip');
    expect(filterGraph).toContain('[1:a]atrim=');
    expect(filterGraph).not.toContain('[0:a]atrim=');
    expect(filterGraph).toContain('amix=inputs=1');
    expect(filterGraph.indexOf('[0:v]trim=')).toBeLessThan(filterGraph.indexOf('[1:v]trim='));
  });
});
