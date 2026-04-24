import { describe, expect, it } from 'vitest';
import {
  createTrackBundle,
  deleteClipsState,
  deleteTrackBundle,
  getRecordingStartTime,
  moveTrack,
  resolveClipOverlaps,
  rippleDeleteClipsState,
  splitClipState,
  trimClipState,
} from '@/src/lib/editor-operations';
import { TrackType } from '@/src/types';
import { makeClip, makeTrack } from '../factories/editor';

describe('editor operations', () => {
  it('resolves overlapping clips on the same track', () => {
    const existingClip = makeClip({ id: 1, timelinePosition: { start: 0, end: 10 } });
    const updatedClip = makeClip({ id: 2, timelinePosition: { start: 5, end: 12 } });

    expect(resolveClipOverlaps(updatedClip, [existingClip, updatedClip])).toEqual([
      { ...existingClip, timelinePosition: { start: 0, end: 5 } },
      updatedClip,
    ]);
  });

  it('computes insert and append recording start times', () => {
    const clips = [
      makeClip({ id: 1, trackId: 'track-a', timelinePosition: { start: 0, end: 4 } }),
      makeClip({ id: 2, trackId: 'track-a', timelinePosition: { start: 5, end: 9 } }),
    ];

    expect(getRecordingStartTime('append', 2, clips, 'track-a')).toBe(9);
    expect(getRecordingStartTime('insert', 2, clips, 'track-a')).toBe(2);
  });

  it('creates track bundles with subtracks for video', () => {
    expect(createTrackBundle(TrackType.VIDEO, [makeTrack()], 123).map((track) => track.id)).toEqual([
      'track-123',
      'track-123-camera',
      'track-123-screen',
    ]);
  });

  it('deletes tracks and their clips', () => {
    const tracks = [
      makeTrack({ id: 'parent' }),
      makeTrack({ id: 'parent-camera', parentId: 'parent', isSubTrack: true, subTrackType: 'camera' }),
      makeTrack({ id: 'other', order: 2 }),
    ];
    const clips = [
      makeClip({ id: 1, trackId: 'parent' }),
      makeClip({ id: 2, trackId: 'parent-camera' }),
      makeClip({ id: 3, trackId: 'other' }),
    ];

    const result = deleteTrackBundle(tracks, clips, 'parent', 'parent');

    expect(result.tracks.map((track) => track.id)).toEqual(['other']);
    expect(result.clips.map((clip) => clip.id)).toEqual([3]);
    expect(result.selectedTrackId).toBe('other');
  });

  it('moves tracks and updates order', () => {
    const tracks = [makeTrack({ id: 'a', order: 0 }), makeTrack({ id: 'b', order: 1 })];
    expect(moveTrack(tracks, 'b', 'up').map((track) => track.id)).toEqual(['b', 'a']);
  });

  it('trims a media clip from the left', () => {
    const result = trimClipState(
      [makeClip({ id: 1, duration: 10, timelinePosition: { start: 0, end: 8 } })],
      1,
      'left',
      2,
    );

    expect(result[0].sourceStart).toBe(2);
    expect(result[0].timelinePosition).toEqual({ start: 2, end: 8 });
  });

  it('splits clips at the playhead', () => {
    const result = splitClipState([makeClip({ id: 1, timelinePosition: { start: 0, end: 10 } })], 4);

    expect(result.clips).toHaveLength(2);
    expect(result.selectedClipId).toBe(2);
    expect(result.clips[0].timelinePosition).toEqual({ start: 0, end: 4 });
    expect(result.clips[1].timelinePosition).toEqual({ start: 4, end: 10 });
  });

  it('deletes placeholder children together', () => {
    const clips = [
      makeClip({ id: 1, isPlaceholder: true, childClipIds: [2] }),
      makeClip({ id: 2 }),
      makeClip({ id: 3 }),
    ];

    expect(deleteClipsState(clips, [1], 0).clips.map((clip) => clip.id)).toEqual([3]);
  });

  it('ripple deletes clips and closes the gap', () => {
    const clips = [
      makeClip({ id: 1, timelinePosition: { start: 0, end: 5 } }),
      makeClip({ id: 2, timelinePosition: { start: 5, end: 10 } }),
      makeClip({ id: 3, timelinePosition: { start: 10, end: 15 } }),
    ];

    expect(
      rippleDeleteClipsState(clips, [2], 0).clips.find((clip) => clip.id === 3)?.timelinePosition,
    ).toEqual({ start: 5, end: 10 });
  });
});
