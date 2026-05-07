import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DesktopExportProgress, DesktopExportRequest, DesktopExportResult } from '../src/types';

type DesktopExportHandlers = {
  emitProgress(progress: DesktopExportProgress): void;
};

type DesktopExportJob = {
  jobId: string;
  workspaceDir: string;
  outputPath: string;
  process: ReturnType<typeof spawn> | null;
  result?: DesktopExportResult;
};

type MaterializedAsset = {
  assetId: string;
  filePath: string;
  kind: 'video' | 'audio' | 'image';
};

type FfmpegResolutionContext = {
  platform: NodeJS.Platform;
  arch: string;
  cwd: string;
  resourcesPath?: string;
  pathEnv?: string;
};

const jobRegistry = new Map<string, DesktopExportJob>();

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function inferExtension(name: string, mimeType?: string) {
  const ext = path.extname(name);
  if (ext) return ext;
  if (!mimeType) return '.bin';
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('jpeg')) return '.jpg';
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('mpeg')) return '.mp3';
  if (mimeType.includes('wav')) return '.wav';
  return '.bin';
}

export function resolveBundledFfmpegPath() {
  const candidates = getFfmpegPathCandidates({
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    pathEnv: process.env.PATH,
  });

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

export function isFfmpegAvailable() {
  return getFfmpegPathCandidates({
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    pathEnv: process.env.PATH,
  }).some((candidate) => existsSync(candidate));
}

export function getFfmpegPathCandidates({
  platform,
  arch,
  cwd,
  resourcesPath,
  pathEnv,
}: FfmpegResolutionContext) {
  const executable = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates: string[] = [];

  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'ffmpeg', `${platform}-${arch}`, executable));
  }

  candidates.push(path.resolve(cwd, 'resources', 'ffmpeg', `${platform}-${arch}`, executable));

  const pathDirectories = (pathEnv || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, executable));

  candidates.push(...pathDirectories);

  if (platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  } else if (platform === 'linux') {
    candidates.push('/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  }

  return [...new Set(candidates)];
}

async function writeStreamToFile(url: string, filePath: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await new Promise<void>((resolve, reject) => {
    const writer = createWriteStream(filePath);
    const reader = response.body!.getReader();

    const pump = async () => {
      try {
        const { done, value } = await reader.read();
        if (done) {
          writer.end();
          resolve();
          return;
        }
        writer.write(Buffer.from(value), (error) => {
          if (error) {
            reject(error);
            return;
          }
          void pump();
        });
      } catch (error) {
        reject(error);
      }
    };

    void pump();
  });
}

async function materializeAssets(request: DesktopExportRequest, workspaceDir: string, handlers: DesktopExportHandlers, jobId: string) {
  const assetsDir = path.join(workspaceDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const materialized = new Map<string, MaterializedAsset>();
  for (let index = 0; index < request.assets.length; index += 1) {
    const asset = request.assets[index];
    handlers.emitProgress({
      jobId,
      progress: Math.min(0.25, (index + 1) / Math.max(request.assets.length, 1) * 0.25),
      stage: asset.buffer ? 'materialize' : 'download',
      message: `Preparing ${asset.originalName}`,
    });

    const baseName = sanitizeFileName(asset.originalName || asset.assetId);
    const ext = inferExtension(baseName, asset.mimeType);
    const digest = createHash('sha1').update(asset.assetId).digest('hex').slice(0, 12);
    const filePath = path.join(assetsDir, `${baseName}-${digest}${ext}`);

    if (asset.buffer) {
      await writeFile(filePath, Buffer.from(asset.buffer));
    } else if (asset.sourceUrl) {
      await writeStreamToFile(asset.sourceUrl, filePath);
    } else {
      throw new Error(`Asset ${asset.assetId} is missing both local data and a source URL.`);
    }

    materialized.set(asset.assetId, {
      assetId: asset.assetId,
      filePath,
      kind: asset.kind,
    });
  }

  return materialized;
}

function ffmpegEscapeText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function codecLooksLikeAudio(codec: string) {
  return /^(aac|ac-3|ac3|alac|ec-3|eac3|flac|mp3|mp4a|opus|pcm|ulaw|vorbis)/.test(codec);
}

function assetHasAudioStream(request: DesktopExportRequest, asset: MaterializedAsset) {
  if (asset.kind === 'audio') return true;
  if (asset.kind !== 'video') return false;

  const mimeType = request.assets.find((entry) => entry.assetId === asset.assetId)?.mimeType?.toLowerCase();
  if (!mimeType) return true;

  const codecList = mimeType.match(/codecs\s*=\s*"?([^"]+)"?/i)?.[1];
  if (!codecList) return true;

  const codecs = codecList
    .split(',')
    .map((codec) => codec.trim().toLowerCase())
    .filter(Boolean);

  if (codecs.length === 0) return true;
  return codecs.some(codecLooksLikeAudio);
}

export function buildFfmpegCommand({
  request,
  materializedAssets,
  outputPath,
}: {
  request: DesktopExportRequest;
  materializedAssets: Map<string, MaterializedAsset>;
  outputPath: string;
}) {
  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  const activeTracks = request.tracks.filter((track) => track.isVisible);
  const orderedTrackIds = [...activeTracks]
    .sort((left, right) => left.order - right.order)
    .map((track) => track.id);
  const clips = request.clips
    .filter((clip) => clip.timelinePosition.end > request.range.start && clip.timelinePosition.start < request.range.end)
    .sort((left, right) => {
      const leftOrder = orderedTrackIds.indexOf(left.trackId);
      const rightOrder = orderedTrackIds.indexOf(right.trackId);
      // Match the preview/browser exporters: higher track orders render first so
      // lower-order tracks stay visually on top (for example, camera over screen).
      if (leftOrder !== rightOrder) return rightOrder - leftOrder;
      return left.timelinePosition.start - right.timelinePosition.start;
    });

  let inputIndex = 0;
  let layerIndex = 0;
  const audioLabels: string[] = [];

  filterParts.push(`color=c=black:s=${request.width}x${request.height}:d=${request.range.end - request.range.start}[base0]`);

  for (const clip of clips) {
    if ((clip.transform?.rotation || 0) !== 0) {
      throw new Error(`Clip "${clip.label}" uses rotation, which is not supported by the native FFmpeg exporter yet.`);
    }

    if (!clip.assetRef && clip.type !== 'text' && clip.type !== 'subtitle') continue;

    if (clip.type === 'text' || clip.type === 'subtitle') {
      const sourceLabel = layerIndex === 0 ? 'base0' : `vout${layerIndex - 1}`;
      const fontSize = clip.style?.fontSize || 48;
      const color = (clip.style?.color || '#ffffff').replace('#', '0x');
      const textX = Math.round((clip.transform?.position.x ?? 0) + request.width / 2);
      const textY = Math.round((clip.transform?.position.y ?? 0) + request.height / 2);
      const enable = `between(t,${Math.max(0, clip.timelinePosition.start - request.range.start)},${Math.max(0, clip.timelinePosition.end - request.range.start)})`;
      filterParts.push(
        `[${sourceLabel}]drawtext=text='${ffmpegEscapeText(clip.content || '')}':fontsize=${fontSize}:fontcolor=${color}:x=${textX}:y=${textY}:enable='${enable}'[vout${layerIndex}]`,
      );
      layerIndex += 1;
      continue;
    }

    const asset = materializedAssets.get(clip.assetRef!.assetId);
    if (!asset) continue;
    inputArgs.push('-i', asset.filePath);

    const trimStart = Math.max(0, clip.sourceStart + Math.max(0, request.range.start - clip.timelinePosition.start));
    const visibleDuration = Math.min(request.range.end, clip.timelinePosition.end) - Math.max(request.range.start, clip.timelinePosition.start);
    const offset = Math.max(0, Math.round((Math.max(request.range.start, clip.timelinePosition.start) - request.range.start) * 1000));
    const opacity = clip.transform?.opacity ?? 1;
    const scaleX = clip.transform?.scale.x ?? 1;
    const scaleY = clip.transform?.scale.y ?? 1;
    const crop = clip.transform?.crop;
    const positionX = Math.round((clip.transform?.position.x ?? 0) + request.width / 2 - request.width / 2 * scaleX);
    const positionY = Math.round((clip.transform?.position.y ?? 0) + request.height / 2 - request.height / 2 * scaleY);
    const currentInput = inputIndex;
    inputIndex += 1;

    if (asset.kind === 'video' || asset.kind === 'image') {
      const sourceLabel = `vclip${clip.id}`;
      const videoFilterSegments: string[] = [];

      if (asset.kind === 'video') {
        videoFilterSegments.push(`trim=start=${trimStart}:duration=${visibleDuration}`, 'setpts=PTS-STARTPTS');
      } else {
        videoFilterSegments.push(`loop=loop=-1:size=1:start=0`, `trim=duration=${visibleDuration}`, 'setpts=PTS-STARTPTS');
      }

      if (crop && (crop.top || crop.right || crop.bottom || crop.left)) {
        const widthExpr = `iw*(1-${(crop.left + crop.right) / 100})`;
        const heightExpr = `ih*(1-${(crop.top + crop.bottom) / 100})`;
        const xExpr = `iw*${crop.left / 100}`;
        const yExpr = `ih*${crop.top / 100}`;
        videoFilterSegments.push(`crop=${widthExpr}:${heightExpr}:${xExpr}:${yExpr}`);
      }

      if (scaleX !== 1 || scaleY !== 1) {
        videoFilterSegments.push(`scale=${Math.round(request.width * scaleX)}:${Math.round(request.height * scaleY)}`);
      } else {
        videoFilterSegments.push(`scale=${request.width}:${request.height}`);
      }

      if (opacity !== 1) {
        videoFilterSegments.push(`format=rgba,colorchannelmixer=aa=${opacity}`);
      }

      filterParts.push(`[${currentInput}:v]${videoFilterSegments.join(',')}[${sourceLabel}]`);

      const layerInput = layerIndex === 0 ? 'base0' : `vout${layerIndex - 1}`;
      const enable = `between(t,${Math.max(0, clip.timelinePosition.start - request.range.start)},${Math.max(0, clip.timelinePosition.end - request.range.start)})`;
      filterParts.push(`[${layerInput}][${sourceLabel}]overlay=${positionX}:${positionY}:enable='${enable}'[vout${layerIndex}]`);
      layerIndex += 1;
    }

    if (asset.kind !== 'image' && assetHasAudioStream(request, asset)) {
      const track = request.tracks.find((entry) => entry.id === clip.trackId);
      const volume = track?.isMuted ? 0 : clip.volume;
      filterParts.push(
        `[${currentInput}:a]atrim=start=${trimStart}:duration=${visibleDuration},asetpts=PTS-STARTPTS,volume=${volume},adelay=${offset}|${offset}[a${clip.id}]`,
      );
      audioLabels.push(`[a${clip.id}]`);
    }
  }

  const finalVideoLabel = layerIndex === 0 ? '[base0]' : `[vout${layerIndex - 1}]`;
  if (audioLabels.length > 0) {
    filterParts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0[aout]`);
  }

  const args = [
    ...inputArgs,
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    finalVideoLabel,
  ];

  if (audioLabels.length > 0) {
    args.push('-map', '[aout]');
  }

  if (request.format === 'mp4') {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-c:a', 'aac');
  } else {
    args.push('-c:v', 'libvpx-vp9', '-b:v', '12M', '-c:a', 'libopus');
  }

  args.push('-y', outputPath);
  return args;
}

function parseFfmpegProgress(chunk: string, request: DesktopExportRequest) {
  const durationSeconds = Math.max(0.001, request.range.end - request.range.start);
  const match = chunk.match(/out_time_ms=(\d+)/);
  if (!match) return null;
  const outTimeMs = Number(match[1]);
  if (!Number.isFinite(outTimeMs)) return null;
  return Math.max(0, Math.min(1, outTimeMs / 1_000_000 / durationSeconds));
}

export async function cleanupStaleDesktopExports() {
  const rootDir = path.join(os.tmpdir(), 'nektar-desktop-exports');
  if (!existsSync(rootDir)) return;
  const entries = await readdir(rootDir, { withFileTypes: true });
  const cutoff = Date.now() - 1000 * 60 * 60 * 24;

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory()) return;
    const fullPath = path.join(rootDir, entry.name);
    const stats = await stat(fullPath);
    if (stats.mtimeMs < cutoff) {
      await rm(fullPath, { recursive: true, force: true });
    }
  }));
}

export async function startDesktopExport(request: DesktopExportRequest, handlers: DesktopExportHandlers) {
  const ffmpegCandidates = getFfmpegPathCandidates({
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    pathEnv: process.env.PATH,
  });
  const ffmpegPath = resolveBundledFfmpegPath();
  if (!existsSync(ffmpegPath)) {
    throw new Error(
      `FFmpeg was not found. Checked: ${ffmpegCandidates.join(', ')}. Add platform binaries under resources/ffmpeg/<platform>-<arch>/ or install ffmpeg on this machine.`,
    );
  }

  const jobId = randomUUID();
  const workspaceDir = path.join(os.tmpdir(), 'nektar-desktop-exports', jobId);
  await mkdir(workspaceDir, { recursive: true });
  const outputPath = path.join(workspaceDir, `export.${request.format}`);
  const job: DesktopExportJob = {
    jobId,
    workspaceDir,
    outputPath,
    process: null,
  };
  jobRegistry.set(jobId, job);

  const emitProgress = (progress: Omit<DesktopExportProgress, 'jobId'>) =>
    handlers.emitProgress({ jobId, ...progress });

  const materializedAssets = await materializeAssets(request, workspaceDir, handlers, jobId);
  const manifest = {
    request,
    assets: [...materializedAssets.values()],
  };
  await writeFile(path.join(workspaceDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  emitProgress({ progress: 0.3, stage: 'ffmpeg', message: 'Starting FFmpeg export' });
  const args = buildFfmpegCommand({ request, materializedAssets, outputPath });
  const ffmpeg = spawn(ffmpegPath, ['-progress', 'pipe:1', '-nostats', ...args], {
    cwd: workspaceDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.process = ffmpeg;

  let stdoutBuffer = '';
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    const progress = parseFfmpegProgress(stdoutBuffer, request);
    if (progress !== null) {
      emitProgress({ progress: 0.3 + progress * 0.65, stage: 'ffmpeg', message: `Encoding ${(progress * 100).toFixed(0)}%` });
      stdoutBuffer = '';
    }
  });

  let stderr = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  await new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `FFmpeg exited with code ${code}`));
    });
  });

  emitProgress({ progress: 1, stage: 'finalize', message: 'Export complete' });
  const result: DesktopExportResult = {
    jobId,
    outputPath,
    outputFileName: path.basename(outputPath),
    workspaceDir,
    format: request.format,
  };
  job.result = result;
  emitProgress({ progress: 1, stage: 'completed', message: outputPath });
  return { jobId };
}

export async function getDesktopExportResult(jobId: string) {
  const job = jobRegistry.get(jobId);
  if (!job?.result) {
    throw new Error(`No completed export result found for job ${jobId}.`);
  }
  return job.result;
}

export async function cancelDesktopExport(jobId: string) {
  const job = jobRegistry.get(jobId);
  if (!job) return;
  job.process?.kill('SIGTERM');
  await rm(job.workspaceDir, { recursive: true, force: true });
  jobRegistry.delete(jobId);
}

export async function copyDesktopExportResult(jobId: string, targetPath: string) {
  const result = await getDesktopExportResult(jobId);
  await copyFile(result.outputPath, targetPath);
  return targetPath;
}
