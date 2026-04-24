import { describe, expect, it } from 'vitest';
import { buildExportPlan } from '@/src/lib/export-shared';
import { TrackType } from '@/src/types';
import { makeClip, makeTrack } from '../factories/editor';

describe('export shared plan', () => {
  it('filters out hidden tracks and orders clips and events deterministically', () => {
    const tracks = [
      makeTrack({ id: 'track-a', order: 0, type: TrackType.VIDEO, name: 'A' }),
      makeTrack({ id: 'track-b', order: 1, type: TrackType.AUDIO, name: 'B' }),
      makeTrack({ id: 'track-hidden', order: 2, type: TrackType.IMAGE, name: 'Hidden', isVisible: false }),
    ];

    const clips = [
      makeClip({
        id: 1,
        trackId: 'track-a',
        label: 'Clip A',
        timelinePosition: { start: 1, end: 4 },
      }),
      makeClip({
        id: 2,
        trackId: 'track-b',
        label: 'Clip B',
        timelinePosition: { start: 4, end: 6 },
      }),
      makeClip({
        id: 3,
        trackId: 'track-hidden',
        label: 'Hidden Clip',
        timelinePosition: { start: 2, end: 5 },
      }),
    ];

    const plan = buildExportPlan(clips, tracks, { start: 0, end: 8 }, 30);

    expect(plan.visibleTracks.map((track) => track.id)).toEqual(['track-a', 'track-b']);
    expect(plan.exportClips.map((clip) => clip.id)).toEqual([2, 1]);
    expect(plan.clipEvents.map((event) => `${event.time}:${event.kind}:${event.clip.id}`)).toEqual([
      '1:start:1',
      '4:start:2',
      '4:end:1',
      '6:end:2',
    ]);
    expect(plan.trackById.get('track-hidden')?.name).toBe('Hidden');
  });

  it('rounds export duration to frame boundaries and clamps empty ranges', () => {
    const roundedPlan = buildExportPlan([], [], { start: 0, end: 1.234 }, 30);

    expect(roundedPlan.exportDuration).toBeCloseTo(37 / 30, 10);
    expect(roundedPlan.totalFrames).toBe(37);

    const emptyPlan = buildExportPlan([], [], { start: 5, end: 5 }, 30);

    expect(emptyPlan.exportDuration).toBe(0);
    expect(emptyPlan.totalFrames).toBe(0);
  });
});
