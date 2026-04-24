import { RecordingMode, Track, TrackType, VideoClip, VideoObjType } from '../types';

export function resolveClipOverlaps(
  updatedClip: VideoClip,
  allClips: VideoObjType,
  ignoreIds: number[] = [],
): VideoObjType {
  const updatedStart = updatedClip.timelinePosition.start;
  const updatedEnd = updatedClip.timelinePosition.end;

  return allClips
    .map((clip) => {
      if (clip.id === updatedClip.id) return updatedClip;
      if (ignoreIds.includes(clip.id)) return clip;
      if (clip.trackId !== updatedClip.trackId) return clip;

      const clipStart = clip.timelinePosition.start;
      const clipEnd = clip.timelinePosition.end;

      if (updatedStart >= clipEnd || updatedEnd <= clipStart) return clip;

      if (updatedStart <= clipStart && updatedEnd >= clipEnd) {
        return { ...clip, timelinePosition: { start: clipStart, end: clipStart } };
      }

      if (updatedStart <= clipStart && updatedEnd < clipEnd) {
        const overlap = updatedEnd - clipStart;
        return {
          ...clip,
          sourceStart: clip.sourceStart + overlap,
          timelinePosition: { start: updatedEnd, end: clipEnd },
        };
      }

      if (updatedStart > clipStart && updatedEnd >= clipEnd) {
        return { ...clip, timelinePosition: { start: clipStart, end: updatedStart } };
      }

      if (updatedStart > clipStart && updatedEnd < clipEnd) {
        return { ...clip, timelinePosition: { start: clipStart, end: updatedStart } };
      }

      return clip;
    })
    .filter((clip) => clip.timelinePosition.end > clip.timelinePosition.start);
}

export function getRecordingStartTime(
  recordingMode: RecordingMode,
  currentTime: number,
  clips: VideoObjType,
  selectedTrackId: string,
): number {
  if (recordingMode === 'insert') return currentTime;

  const trackClips = clips.filter((clip) => clip.trackId === selectedTrackId);
  return trackClips.length > 0 ? Math.max(...trackClips.map((clip) => clip.timelinePosition.end)) : 0;
}

export function createTrackBundle(type: TrackType, tracks: Track[], now = Date.now()): Track[] {
  const baseId = `track-${now}`;
  const bundle: Track[] = [
    {
      id: baseId,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${
        tracks.filter((track) => track.type === type && !track.isSubTrack).length + 1
      }`,
      type,
      isVisible: true,
      isLocked: false,
      isMuted: false,
      isArmed:
        type === TrackType.VIDEO ||
        type === TrackType.AUDIO ||
        type === TrackType.SCREEN ||
        type === TrackType.IMAGE,
      order: tracks.length,
    },
  ];

  if (type === TrackType.VIDEO || type === TrackType.SCREEN) {
    bundle.push(
      {
        id: `${baseId}-camera`,
        name: 'Camera',
        type: TrackType.VIDEO,
        isVisible: true,
        isLocked: false,
        isMuted: false,
        isArmed: true,
        order: tracks.length + 1,
        parentId: baseId,
        isSubTrack: true,
        subTrackType: 'camera',
      },
      {
        id: `${baseId}-screen`,
        name: 'Screen',
        type: TrackType.VIDEO,
        isVisible: true,
        isLocked: false,
        isMuted: false,
        isArmed: true,
        order: tracks.length + 2,
        parentId: baseId,
        isSubTrack: true,
        subTrackType: 'screen',
      },
    );
  }

  return bundle;
}

export function deleteTrackBundle(
  tracks: Track[],
  clips: VideoObjType,
  trackId: string,
  selectedTrackId: string,
) {
  if (tracks.length <= 1) {
    return { tracks, clips, selectedTrackId };
  }

  const trackIdsToDelete = [trackId];
  tracks.forEach((track) => {
    if (track.parentId === trackId) trackIdsToDelete.push(track.id);
  });

  const nextTracks = tracks
    .filter((track) => !trackIdsToDelete.includes(track.id))
    .map((track, order) => ({ ...track, order }));

  return {
    tracks: nextTracks,
    clips: clips.filter((clip) => !trackIdsToDelete.includes(clip.trackId)),
    selectedTrackId: trackIdsToDelete.includes(selectedTrackId) ? nextTracks[0]?.id || '' : selectedTrackId,
  };
}

export function moveTrack(tracks: Track[], id: string, direction: 'up' | 'down'): Track[] {
  const index = tracks.findIndex((track) => track.id === id);
  if (index === -1) return tracks;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= tracks.length) return tracks;

  const nextTracks = [...tracks];
  [nextTracks[index], nextTracks[targetIndex]] = [nextTracks[targetIndex], nextTracks[index]];
  return nextTracks.map((track, order) => ({ ...track, order }));
}

export function trimClipState(
  clips: VideoObjType,
  clipId: number,
  side: 'left' | 'right',
  newTime: number,
): VideoObjType {
  const clip = clips.find((entry) => entry.id === clipId);
  if (!clip) return clips;

  let updatedClip: VideoClip;
  const isMedia =
    clip.type === TrackType.VIDEO || clip.type === TrackType.AUDIO || clip.type === TrackType.SCREEN;

  if (side === 'left') {
    const maxStart = clip.timelinePosition.end - 0.1;
    const clampedStart = Math.max(0, Math.min(newTime, maxStart));
    const delta = clampedStart - clip.timelinePosition.start;

    if (isMedia && (clip.sourceStart + delta < 0 || clip.sourceStart + delta > clip.duration)) {
      return clips;
    }

    updatedClip = {
      ...clip,
      sourceStart: isMedia ? clip.sourceStart + delta : clip.sourceStart,
      timelinePosition: { ...clip.timelinePosition, start: clampedStart },
    };
  } else {
    const minEnd = clip.timelinePosition.start + 0.1;
    const clampedEnd = Math.max(newTime, minEnd);
    const duration = clampedEnd - clip.timelinePosition.start;

    if (isMedia && clip.sourceStart + duration > clip.duration) return clips;

    updatedClip = {
      ...clip,
      timelinePosition: { ...clip.timelinePosition, end: clampedEnd },
    };
  }

  let updatedClips = clips.map((entry) => (entry.id === clipId ? updatedClip : entry));

  if (updatedClip.isPlaceholder && updatedClip.childClipIds) {
    updatedClips = updatedClips.map((entry) => {
      if (!updatedClip.childClipIds?.includes(entry.id)) return entry;

      if (side === 'left') {
        const delta = updatedClip.timelinePosition.start - clip.timelinePosition.start;
        return {
          ...entry,
          sourceStart: entry.sourceStart + delta,
          timelinePosition: { ...entry.timelinePosition, start: updatedClip.timelinePosition.start },
        };
      }

      return {
        ...entry,
        timelinePosition: { ...entry.timelinePosition, end: updatedClip.timelinePosition.end },
      };
    });
  }

  return resolveClipOverlaps(updatedClip, updatedClips);
}

export function splitClipState(clips: VideoObjType, currentTime: number) {
  const clipToSplit = clips.find(
    (clip) => currentTime > clip.timelinePosition.start && currentTime < clip.timelinePosition.end,
  );

  if (!clipToSplit) return { clips, selectedClipId: null as number | null };

  const splitPoint = currentTime;
  const offsetInClip = splitPoint - clipToSplit.timelinePosition.start;
  const firstClip = {
    ...clipToSplit,
    timelinePosition: { ...clipToSplit.timelinePosition, end: splitPoint },
  };
  const secondClipId = Math.max(...clips.map((clip) => clip.id)) + 1;
  const secondClip = {
    ...clipToSplit,
    id: secondClipId,
    sourceStart: clipToSplit.sourceStart + offsetInClip,
    timelinePosition: { start: splitPoint, end: clipToSplit.timelinePosition.end },
  };

  let nextState = [...clips.filter((clip) => clip.id !== clipToSplit.id), firstClip, secondClip];

  if (clipToSplit.isPlaceholder && clipToSplit.childClipIds) {
    const firstChildIds: number[] = [];
    const secondChildIds: number[] = [];
    let nextId = Math.max(...nextState.map((clip) => clip.id)) + 1;

    clipToSplit.childClipIds.forEach((childId) => {
      const childClip = clips.find((clip) => clip.id === childId);
      if (!childClip) return;

      const firstChild = {
        ...childClip,
        timelinePosition: { ...childClip.timelinePosition, end: splitPoint },
      };
      const secondChildId = nextId++;
      const secondChild = {
        ...childClip,
        id: secondChildId,
        sourceStart: childClip.sourceStart + offsetInClip,
        timelinePosition: { start: splitPoint, end: childClip.timelinePosition.end },
      };

      firstChildIds.push(childId);
      secondChildIds.push(secondChildId);
      nextState = [...nextState.filter((clip) => clip.id !== childId), firstChild, secondChild];
    });

    nextState = nextState.map((clip) => {
      if (clip.id === firstClip.id) return { ...clip, childClipIds: firstChildIds };
      if (clip.id === secondClip.id) return { ...clip, childClipIds: secondChildIds };
      return clip;
    });
  }

  nextState.sort((left, right) => left.timelinePosition.start - right.timelinePosition.start);
  return { clips: nextState, selectedClipId: secondClip.id };
}

export function deleteClipsState(clips: VideoObjType, selectedClipIds: number[], currentTime: number) {
  let clipsToDelete: VideoClip[] = [];

  if (selectedClipIds.length > 0) {
    clipsToDelete = clips.filter((clip) => selectedClipIds.includes(clip.id));
  } else {
    const clipUnderPlayhead = clips.find(
      (clip) => currentTime >= clip.timelinePosition.start && currentTime <= clip.timelinePosition.end,
    );
    if (clipUnderPlayhead) clipsToDelete = [clipUnderPlayhead];
  }

  if (clipsToDelete.length === 0) return { clips, deletedClips: [] as VideoClip[] };

  const deleteIds = new Set(clipsToDelete.map((clip) => clip.id));
  clipsToDelete.forEach((clip) => clip.childClipIds?.forEach((id) => deleteIds.add(id)));

  return {
    clips: clips.filter((clip) => !deleteIds.has(clip.id)),
    deletedClips: clipsToDelete,
  };
}

export function rippleDeleteClipsState(clips: VideoObjType, selectedClipIds: number[], currentTime: number) {
  let clipsToDelete: VideoClip[] = [];

  if (selectedClipIds.length > 0) {
    clipsToDelete = clips.filter((clip) => selectedClipIds.includes(clip.id));
  } else {
    const clipUnderPlayhead = clips.find(
      (clip) => currentTime >= clip.timelinePosition.start && currentTime <= clip.timelinePosition.end,
    );
    if (clipUnderPlayhead) clipsToDelete = [clipUnderPlayhead];
  }

  if (clipsToDelete.length === 0) return { clips, deletedClips: [] as VideoClip[] };

  const allToDelete = [...clipsToDelete];
  clipsToDelete.forEach((clip) => {
    clip.childClipIds?.forEach((id) => {
      const child = clips.find((entry) => entry.id === id);
      if (child && !allToDelete.some((entry) => entry.id === child.id)) {
        allToDelete.push(child);
      }
    });
  });

  const sortedToDelete = [...allToDelete].sort(
    (left, right) => right.timelinePosition.start - left.timelinePosition.start,
  );

  const nextState = sortedToDelete.reduce<VideoObjType>((state, clip) => {
    const duration = clip.timelinePosition.end - clip.timelinePosition.start;
    const start = clip.timelinePosition.start;

    return state
      .filter((entry) => entry.id !== clip.id)
      .map((entry) => {
        if (entry.trackId === clip.trackId && entry.timelinePosition.start >= start) {
          return {
            ...entry,
            timelinePosition: {
              start: Math.max(0, entry.timelinePosition.start - duration),
              end: Math.max(0, entry.timelinePosition.end - duration),
            },
          };
        }
        return entry;
      });
  }, [...clips]);

  return { clips: nextState, deletedClips: allToDelete };
}
