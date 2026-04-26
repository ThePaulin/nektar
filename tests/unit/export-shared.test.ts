import { describe, expect, it } from 'vitest';
import {
  buildAudioMixRange,
  buildExportPlan,
  buildTextLayoutSignature,
  createExportCursor,
} from '@/src/lib/export-shared';
import { TrackType } from '@/src/types';
import { makeClip, makeTrack } from '../factories/editor';

describe('export shared plan', () => {
  it('filters out hidden tracks and orders clips and events deterministically', () => {
    const tracks = [
      makeTrack({ id: 'track-a', order: 0, type: TrackType.VIDEO, name: 'A' }),
      makeTrack({ id: 'track-b', order: 1, type: TrackType.AUDIO, name: 'B' }),
      makeTrack({ id: 'track-hidden', order: 2, type: TrackType.IMAGE, name: 'Hidden', isVisible: false }),
    ];

    const textClip = makeClip({
      id: 4,
      trackId: 'track-a',
      type: TrackType.TEXT,
      label: 'Caption',
      content: 'Hello export',
      timelinePosition: { start: 0.5, end: 2.5 },
      style: {
        fontSize: 42,
        fontWeight: '700',
        fontStyle: 'italic',
        fontFamily: 'Inter',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.6)',
      },
    });

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
      textClip,
    ];

    const plan = buildExportPlan(clips, tracks, { start: 0, end: 8 }, 30);

    expect(plan.visibleTracks.map((track) => track.id)).toEqual(['track-a', 'track-b']);
    expect(plan.exportClips.map((clip) => clip.id)).toEqual([2, 4, 1]);
    expect(plan.clipEvents.map((event) => `${event.time}:${event.kind}:${event.clip.id}`)).toEqual([
      '0.5:start:4',
      '1:start:1',
      '2.5:end:4',
      '4:start:2',
      '4:end:1',
      '6:end:2',
    ]);
    expect(plan.trackById.get('track-hidden')?.name).toBe('Hidden');
    expect(plan.frameTimes[0]).toBe(0);
    expect(plan.frameTimes[1]).toBeCloseTo(1 / 30, 10);
    expect(plan.frameTimestampsUs[1]).toBe(33333);
    expect(plan.textLayoutSignatureByClipId.get(4)).toBe(buildTextLayoutSignature(textClip));
  });

  it('rounds export duration to frame boundaries and clamps empty ranges', () => {
    const roundedPlan = buildExportPlan([], [], { start: 0, end: 1.234 }, 30);

    expect(roundedPlan.exportDuration).toBeCloseTo(37 / 30, 10);
    expect(roundedPlan.totalFrames).toBe(37);

    const emptyPlan = buildExportPlan([], [], { start: 5, end: 5 }, 30);

    expect(emptyPlan.exportDuration).toBe(0);
    expect(emptyPlan.totalFrames).toBe(0);
  });

  it('groups active clips by type when advancing the export cursor', () => {
    const tracks = [
      makeTrack({ id: 'track-a', order: 0, type: TrackType.VIDEO, name: 'A' }),
      makeTrack({ id: 'track-b', order: 1, type: TrackType.IMAGE, name: 'B' }),
    ];

    const clips = [
      makeClip({
        id: 1,
        trackId: 'track-a',
        type: TrackType.VIDEO,
        timelinePosition: { start: 0, end: 2 },
      }),
      makeClip({
        id: 2,
        trackId: 'track-b',
        type: TrackType.IMAGE,
        timelinePosition: { start: 1, end: 4 },
      }),
      makeClip({
        id: 3,
        trackId: 'track-a',
        type: TrackType.TEXT,
        content: 'Title',
        timelinePosition: { start: 1, end: 3 },
      }),
    ];

    const plan = buildExportPlan(clips, tracks, { start: 0, end: 5 }, 30);
    const cursor = createExportCursor(plan);

    cursor.advanceTo(1.5);
    expect(cursor.getActiveClips().map((clip) => clip.id)).toEqual([2, 1, 3]);
    expect(cursor.getActiveVideoClips().map((clip) => clip.id)).toEqual([1]);
    expect(cursor.getActiveImageClips().map((clip) => clip.id)).toEqual([2]);
    expect(cursor.getActiveTextClips().map((clip) => clip.id)).toEqual([3]);

    cursor.advanceTo(3.5);
    expect(cursor.getActiveClips().map((clip) => clip.id)).toEqual([2]);
    expect(cursor.getActiveVideoClips()).toEqual([]);
    expect(cursor.getActiveTextClips()).toEqual([]);
  });

  it('precomputes audio mix ranges with stable bounds and increments', () => {
    const range = buildAudioMixRange(
      makeClip({
        trackId: 'track-a',
        timelinePosition: { start: 2, end: 5 },
        sourceStart: 1,
      }),
      { start: 0, end: 10 },
      48_000,
      96_000,
      0.5
    );

    expect(range).toEqual({
      targetStart: 96_000,
      targetEnd: 240_000,
      sourcePositionStart: 96_000,
      sourceStep: 2,
      gain: 0.5,
    });
  });
});
