import { beforeEach, describe, expect, it } from 'vitest';
import { VideoDB } from '@/src/services/db';
import { makeClip, makeTrack } from '../factories/editor';

let db: VideoDB;

describe('VideoDB', () => {
  beforeEach(async () => {
    db = new VideoDB();
    await db.init();
    await db.clearAll();
  });

  it('saves and loads clips, tracks, settings, and blobs', async () => {
    const clip = makeClip({ id: 1, blobId: 'blob-1' });
    const track = makeTrack({ id: 'track-a' });
    const blob = new Blob(['video']);

    await db.saveClip(clip, blob);
    await db.saveTracks([track]);
    await db.saveSettings('currentTime', 12.5);

    expect(await db.getClips()).toEqual([clip]);
    expect(await db.getTracks()).toEqual([track]);
    expect(await db.getSettings('currentTime')).toBe(12.5);
    expect(await db.getBlob('blob-1')).not.toBeNull();
  });

  it('deletes clips and clears all stores', async () => {
    const clip = makeClip({ id: 2, blobId: 'blob-2' });

    await db.saveClip(clip, new Blob(['video']));
    await db.deleteClip(clip.id, clip.blobId);

    expect(await db.getClips()).toEqual([]);
    expect(await db.getBlob('blob-2')).toBeNull();

    await db.saveAllClips([makeClip({ id: 3 })]);
    await db.saveTracks([makeTrack({ id: 'track-b' })]);
    await db.saveSettings('mode', 'append');
    await db.clearAll();

    expect(await db.getClips()).toEqual([]);
    expect(await db.getTracks()).toEqual([]);
    expect(await db.getSettings('mode')).toBeUndefined();
  });
});
