import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const FFMPEG_RELEASE_TAG = process.env.NEKTAR_FFMPEG_TAG || 'b6.1.1';
const RELEASE_API_URL = `https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/${FFMPEG_RELEASE_TAG}`;
const OUTPUT_ROOT = path.resolve('resources', 'ffmpeg');

const TARGETS = [
  {
    platformArch: 'darwin-arm64',
    releaseKey: 'darwin-arm64',
    executableName: 'ffmpeg',
    isExecutable: true,
  },
  {
    platformArch: 'darwin-x64',
    releaseKey: 'darwin-x64',
    executableName: 'ffmpeg',
    isExecutable: true,
  },
  {
    platformArch: 'linux-x64',
    releaseKey: 'linux-x64',
    executableName: 'ffmpeg',
    isExecutable: true,
  },
  {
    platformArch: 'win32-x64',
    releaseKey: 'win32-x64',
    executableName: 'ffmpeg.exe',
    releaseExecutableName: 'ffmpeg-win32-x64',
    isExecutable: false,
  },
];

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Nektar-FFmpeg-Fetcher',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'Nektar-FFmpeg-Fetcher',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(destinationPath));
}

function createAssetLookup(assets) {
  return new Map(assets.map((asset) => [asset.name, asset.browser_download_url]));
}

function getRequiredAsset(lookup, assetName) {
  const assetUrl = lookup.get(assetName);
  if (!assetUrl) {
    const availableAssets = [...lookup.keys()].sort().join(', ');
    throw new Error(`Release asset "${assetName}" was not found for ${FFMPEG_RELEASE_TAG}. Available assets: ${availableAssets}`);
  }
  return assetUrl;
}

async function prepareTarget(assetLookup, target) {
  const destinationDir = path.join(OUTPUT_ROOT, target.platformArch);
  const executablePath = path.join(destinationDir, target.executableName);
  const versionPath = path.join(destinationDir, 'VERSION.txt');
  const readmePath = path.join(destinationDir, 'README.txt');
  const licensePath = path.join(destinationDir, 'LICENSE.txt');
  const expectedVersion = `${FFMPEG_RELEASE_TAG}\n`;

  if (existsSync(executablePath) && existsSync(versionPath)) {
    const version = await readFile(versionPath, 'utf8').catch(() => '');
    if (version === expectedVersion) {
      console.log(`[ffmpeg] ${target.platformArch} already present for ${FFMPEG_RELEASE_TAG}`);
      return;
    }
  }

  const assetBaseName = target.releaseKey;
  const ffmpegAssetName = target.releaseExecutableName || `ffmpeg-${assetBaseName}`;

  const ffmpegUrl = getRequiredAsset(assetLookup, ffmpegAssetName);
  const readmeUrl = getRequiredAsset(assetLookup, `${assetBaseName}.README`);
  const licenseUrl = getRequiredAsset(assetLookup, `${assetBaseName}.LICENSE`);

  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(destinationDir, { recursive: true });

  console.log(`[ffmpeg] Downloading ${ffmpegAssetName}`);
  await downloadFile(ffmpegUrl, executablePath);
  await downloadFile(readmeUrl, readmePath);
  await downloadFile(licenseUrl, licensePath);
  await writeFile(versionPath, expectedVersion, 'utf8');

  if (target.isExecutable) {
    await chmod(executablePath, 0o755);
  }
}

async function main() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const release = await fetchJson(RELEASE_API_URL);
  const assetLookup = createAssetLookup(release.assets || []);

  for (const target of TARGETS) {
    await prepareTarget(assetLookup, target);
  }
}

await main();
