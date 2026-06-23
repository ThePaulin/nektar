import { describe, expect, it } from 'vitest';
import { buildAudioMixInstructions } from '@/src/lib/export/audio-mixer';
import { ActiveClipWindow } from '@/src/lib/export/frame-renderer';
import { mapStageProgress, prepareExportScene } from '@/src/lib/export/timeline-exporter';
import { TrackType } from '@/src/types';
import { makeClip, makeTrack } from '../factories/editor';

describe('export pipeline helpers', () => {
  it('deduplicates assets by blob id during scene preparation', () => {
    const track = makeTrack();
    const clips = [
      makeClip({ id: 1, blobId: 'shared-blob', videoUrl: 'blob:first', timelinePosition: { start: 0, end: 5 } }),
      makeClip({ id: 2, blobId: 'shared-blob', videoUrl: 'blob:second', timelinePosition: { start: 5, end: 10 } }),
    ];

    const scene = prepareExportScene({
      clips,
      tracks: [track],
      options: {
        format: 'mp4',
        width: 1280,
        height: 720,
        fps: 30,
        range: { start: 0, end: 10 },
      },
    });

    expect(scene.assets).toHaveLength(1);
    expect(scene.assets[0]?.key).toBe('media:shared-blob');
    expect(scene.clips.every((clip) => clip.assetKey === 'media:shared-blob')).toBe(true);
  });

  it('trims clips against the export range and computes source offsets', () => {
    const scene = prepareExportScene({
      clips: [
        makeClip({
          sourceStart: 2,
          timelinePosition: { start: 4, end: 12 },
        }),
      ],
      tracks: [makeTrack()],
      options: {
        format: 'webm',
        width: 1280,
        height: 720,
        fps: 30,
        range: { start: 6, end: 9 },
      },
    });

    expect(scene.duration).toBe(3);
    expect(scene.clips[0]?.exportStart).toBe(6);
    expect(scene.clips[0]?.exportEnd).toBe(9);
    expect(scene.clips[0]?.sourceOffset).toBe(4);
  });

  it('builds audio mix instructions from prepared clips', () => {
    const scene = prepareExportScene({
      clips: [
        makeClip({
          id: 7,
          type: TrackType.AUDIO,
          videoUrl: 'blob:audio',
          sourceStart: 1,
          volume: 0.5,
          timelinePosition: { start: 5, end: 12 },
        }),
      ],
      tracks: [makeTrack({ type: TrackType.AUDIO })],
      options: {
        format: 'mp4',
        width: 1280,
        height: 720,
        fps: 30,
        range: { start: 6, end: 10 },
      },
    });

    const instructions = buildAudioMixInstructions(scene);
    expect(instructions).toEqual([
      {
        assetKey: 'media:blob:audio',
        clipId: 7,
        startTime: 0,
        offset: 2,
        duration: 4,
        volume: 0.5,
      },
    ]);
  });

  it('advances the active clip window as time moves forward', () => {
    const scene = prepareExportScene({
      clips: [
        makeClip({ id: 1, timelinePosition: { start: 0, end: 4 } }),
        makeClip({ id: 2, timelinePosition: { start: 3, end: 6 } }),
        makeClip({ id: 3, timelinePosition: { start: 6, end: 8 } }),
      ],
      tracks: [makeTrack()],
      options: {
        format: 'webm',
        width: 1280,
        height: 720,
        fps: 30,
        range: { start: 0, end: 8 },
      },
    });

    const window = new ActiveClipWindow(scene);
    expect(window.advanceTo(1).map((clip) => clip.clip.id)).toEqual([1]);
    expect(window.advanceTo(3.5).map((clip) => clip.clip.id)).toEqual([1, 2]);
    expect(window.advanceTo(5).map((clip) => clip.clip.id)).toEqual([2]);
    expect(window.advanceTo(6.5).map((clip) => clip.clip.id)).toEqual([3]);
  });

  it('maps staged progress monotonically across the pipeline', () => {
    const values = [
      mapStageProgress('prepare', 0),
      mapStageProgress('prepare', 1),
      mapStageProgress('audio', 0.5),
      mapStageProgress('render', 0.25),
      mapStageProgress('render', 1),
      mapStageProgress('finalize', 1),
    ];

    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
  });
});
