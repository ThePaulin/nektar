import os from 'node:os';
import path from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { createPackage } from '@electron/asar';

function resolveBuiltAppPath() {
  const archSuffix = os.arch() === 'arm64' ? 'arm64' : 'x64';
  return path.resolve('release', `mac-${archSuffix}`, 'Nektar.app');
}

async function repackBuiltApp(appPath) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  const appDir = path.join(resourcesDir, 'app');
  const asarPath = path.join(resourcesDir, 'app.asar');

  await createPackage(appDir, asarPath);
  await rm(appDir, { recursive: true, force: true });
  await removeAppleDoubleFiles(appPath);
}

async function removeAppleDoubleFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.name.startsWith('._')) {
      await rm(entryPath, { force: true, recursive: true });
      return;
    }

    if (entry.isDirectory()) {
      await removeAppleDoubleFiles(entryPath);
    }
  }));
}

await repackBuiltApp(resolveBuiltAppPath());
