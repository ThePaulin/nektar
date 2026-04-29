import { describe, expect, it } from 'vitest';
import { buildRealtimeRecordingClips, buildRealtimeRecordingClipsAtDuration, finalizeRecordingClips, updateRecordingSessionProgress } from '@/src/lib/recording-session';
import { RecordingSession, TrackType } from '@/src/types';
import { makeClip } from '../factories/editor';

function makeSession(overrides: Partial<RecordingSession> = {}): RecordingSession {
  return {
    id: 'session-1',
    startTime: 5,
    duration: 0,
    isActive: true,
    isPaused: false,
    source: 'camera',
    affectedTrackIds: ['track-1'],
    draftTemplates: [
      {
        id: 99,
        trackId: 'track-1',
        type: TrackType.VIDEO,
        label: 'Recording',
        duration: 0,
        sourceStart: 0,
      },
    ],
    originalClips: [
      makeClip({ id: 1, trackId: 'track-1', timelinePosition: { start: 8, end: 12 } }),
      makeClip({ id: 2, trackId: 'track-2', timelinePosition: { start: 8, end: 12 } }),
    ],
    partialRecordings: {},
    liveSources: {},
    ...overrides,
  };
}

describe('recording session helpers', () => {
  it('creates draft clips immediately and shifts downstream clips by current duration', () => {
    const session = updateRecordingSessionProgress(makeSession(), 3, {});
    const clips = buildRealtimeRecordingClips(session);

    expect(clips.find((clip) => clip.id === 99)?.timelinePosition).toEqual({ start: 5, end: 8 });
    expect(clips.find((clip) => clip.id === 1)?.timelinePosition).toEqual({ start: 11, end: 15 });
    expect(clips.find((clip) => clip.id === 2)?.timelinePosition).toEqual({ start: 8, end: 12 });
  });

  it('keeps overlay parent and children synchronized', () => {
    const session = updateRecordingSessionProgress(
      makeSession({
        source: 'overlay',
        affectedTrackIds: ['track-1', 'track-1-camera', 'track-1-screen'],
        draftTemplates: [
          {
            id: 100,
            trackId: 'track-1',
            type: TrackType.VIDEO,
            label: 'Group',
            duration: 0,
            sourceStart: 0,
            isPlaceholder: true,
            childClipIds: [101, 102],
          },
          {
            id: 101,
            trackId: 'track-1-camera',
            type: TrackType.VIDEO,
            label: 'Camera',
            duration: 0,
            sourceStart: 0,
          },
          {
            id: 102,
            trackId: 'track-1-screen',
            type: TrackType.VIDEO,
            label: 'Screen',
            duration: 0,
            sourceStart: 0,
          },
        ],
      }),
      4,
      {},
    );

    const clips = buildRealtimeRecordingClips(session).filter((clip) => clip.id >= 100);
    expect(clips.map((clip) => clip.timelinePosition)).toEqual([
      { start: 5, end: 9 },
      { start: 5, end: 9 },
      { start: 5, end: 9 },
    ]);
  });

  it('finalizes draft clips without changing timing', () => {
    const session = updateRecordingSessionProgress(makeSession(), 2.5, {
      camera: {
        source: 'camera',
        url: 'blob:final',
        blob: new Blob(['test'], { type: 'video/webm' }),
      },
    });

    const clips = finalizeRecordingClips(session, session.partialRecordings);
    const recordingClip = clips.find((clip) => clip.id === 99);

    expect(recordingClip?.timelinePosition).toEqual({ start: 5, end: 7.5 });
    expect(recordingClip?.videoUrl).toBe('blob:final');
    expect(recordingClip?.isRecording).toBe(false);
  });

  it('can render the draft clip up to the moving transport cursor', () => {
    const session = updateRecordingSessionProgress(makeSession(), 1.2, {});
    const clips = buildRealtimeRecordingClipsAtDuration(session, 2.8);

    expect(clips.find((clip) => clip.id === 99)?.timelinePosition).toEqual({ start: 5, end: 7.8 });
    expect(clips.find((clip) => clip.id === 1)?.timelinePosition).toEqual({ start: 10.8, end: 14.8 });
  });
});
