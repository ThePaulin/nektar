import {
  DraftClipTemplate,
  RecordingSession,
  RecordingSource,
  VideoClip,
  VideoObjType,
} from '../types';
import { resolveClipOverlaps } from './editor-operations';

function shiftClipByDuration(clip: VideoClip, startTime: number, duration: number) {
  if (clip.timelinePosition.start < startTime) {
    return clip;
  }

  return {
    ...clip,
    timelinePosition: {
      start: clip.timelinePosition.start + duration,
      end: clip.timelinePosition.end + duration,
    },
  };
}

export function createDraftClip(template: DraftClipTemplate, sessionId: string, startTime: number, duration: number): VideoClip {
  return {
    id: template.id,
    trackId: template.trackId,
    label: template.label,
    type: template.type,
    duration: template.duration,
    sourceStart: template.sourceStart,
    timelinePosition: {
      start: startTime,
      end: startTime + duration,
    },
    thumbnailUrl: template.thumbnailUrl,
    overlayRect: template.overlayRect,
    isPlaceholder: template.isPlaceholder,
    childClipIds: template.childClipIds,
    isRecording: true,
    recordingSessionId: sessionId,
  };
}

export function buildRealtimeRecordingClips(session: RecordingSession): VideoObjType {
  return buildRealtimeRecordingClipsAtDuration(session, session.duration);
}

export function buildRealtimeRecordingClipsAtDuration(
  session: RecordingSession,
  visibleDuration: number,
): VideoObjType {
  const shiftedClips = session.originalClips.map((clip) =>
    session.affectedTrackIds.includes(clip.trackId)
      ? shiftClipByDuration(clip, session.startTime, visibleDuration)
      : clip,
  );

  const recordingMap = session.partialRecordings;
  const draftClips = session.draftTemplates.map((template) => {
    const partialRecording = recordingMap[template.source ?? session.source];

    return {
      ...createDraftClip(template, session.id, session.startTime, visibleDuration),
      videoUrl: partialRecording?.url,
    };
  });

  let nextClips = [...shiftedClips];
  draftClips.forEach((draftClip) => {
    nextClips = resolveClipOverlaps(draftClip, [...nextClips, draftClip]);
  });
  return nextClips;
}

export function updateRecordingSessionProgress(
  session: RecordingSession,
  duration: number,
  partialRecordings: Partial<Record<RecordingSource, RecordingSession['partialRecordings'][RecordingSource]>>,
  liveSources: Partial<Record<RecordingSource, RecordingSession['liveSources'][RecordingSource]>> = {},
): RecordingSession {
  return {
    ...session,
    duration,
    partialRecordings: {
      ...session.partialRecordings,
      ...partialRecordings,
    },
    liveSources: {
      ...session.liveSources,
      ...liveSources,
    },
  };
}

export function finalizeRecordingClips(
  session: RecordingSession,
  recordings: Partial<Record<RecordingSource, RecordingSession['partialRecordings'][RecordingSource]>>,
): VideoObjType {
  const finalSession = updateRecordingSessionProgress(session, session.duration, recordings);

  return buildRealtimeRecordingClipsAtDuration(finalSession, finalSession.duration).map((clip) => {
    if (clip.recordingSessionId !== session.id) return clip;
    const template = finalSession.draftTemplates.find((entry) => entry.id === clip.id);

    const recording = finalSession.partialRecordings[template?.source ?? session.source];

    return {
      ...clip,
      videoUrl: recording?.url,
      isRecording: false,
      recordingSessionId: undefined,
    };
  });
}
