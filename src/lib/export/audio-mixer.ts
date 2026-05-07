import { ExportMediaCache } from './media-cache';
import { PreparedExportScene } from '../../types';

export function buildAudioMixInstructions(scene: PreparedExportScene) {
  return scene.clips
    .filter((clip) => clip.assetKey && (clip.clip.type === 'audio' || clip.clip.type === 'video' || clip.clip.type === 'screen'))
    .map((clip) => ({
      assetKey: clip.assetKey!,
      clipId: clip.clip.id,
      startTime: clip.exportStart - scene.range.start,
      offset: clip.sourceOffset,
      duration: clip.exportEnd - clip.exportStart,
      volume: clip.isMuted ? 0 : clip.volume,
    }))
    .filter((instruction) => instruction.duration > 0);
}

export async function renderMixedAudio({
  scene,
  mediaCache,
  sampleRate = 44100,
  onProgress,
}: {
  scene: PreparedExportScene;
  mediaCache: ExportMediaCache;
  sampleRate?: number;
  onProgress?: (progress: number) => void;
}) {
  const instructions = buildAudioMixInstructions(scene);
  if (instructions.length === 0) {
    return null;
  }

  const offlineContext = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(scene.duration * sampleRate)),
    sampleRate,
  );

  instructions.forEach((instruction, index) => {
    const buffer = mediaCache.getAudioBuffer(instruction.assetKey);
    if (!buffer) {
      onProgress?.((index + 1) / instructions.length);
      return;
    }

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    const gainNode = offlineContext.createGain();
    gainNode.gain.value = instruction.volume;
    source.connect(gainNode);
    gainNode.connect(offlineContext.destination);

    try {
      source.start(instruction.startTime, instruction.offset, instruction.duration);
    } catch (error) {
      console.warn('[Export] Failed to schedule audio clip:', instruction.clipId, error);
    }
    onProgress?.((index + 1) / instructions.length);
  });

  return offlineContext.startRendering();
}
