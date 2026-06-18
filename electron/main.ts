import path from 'node:path';
import { createRequire } from 'node:module';
import {
  cancelDesktopExport,
  cleanupStaleDesktopExports,
  copyDesktopExportResult,
  getDesktopExportResult,
  isFfmpegAvailable,
  startDesktopExport,
} from './desktop-export-service.js';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, systemPreferences } = require('electron') as {
  app: {
    isPackaged: boolean;
    whenReady(): Promise<void>;
    getAppPath(): string;
    on(event: string, listener: () => void | Promise<void>): void;
    quit(): void;
  };
  BrowserWindow: {
    new(options: Record<string, unknown>): {
      loadURL(url: string): Promise<void>;
      loadFile(filePath: string): Promise<void>;
      webContents: { getURL(): string; send(channel: string, payload: unknown): void };
    };
    getFocusedWindow(): { webContents: { send(channel: string, payload: unknown): void } } | null;
    getAllWindows(): Array<unknown>;
  };
  desktopCapturer: {
    getSources(options: {
      types: Array<'screen' | 'window'>;
      thumbnailSize?: { width: number; height: number };
    }): Promise<Array<{ id: string; name: string }>>;
  };
  dialog: {
    showSaveDialog(window: unknown, options: { defaultPath: string }): Promise<{ canceled: boolean; filePath?: string }>;
  };
  ipcMain: {
    handle(channel: string, listener: (_event: unknown, ...args: any[]) => unknown): void;
  };
  session: {
    defaultSession: {
      setDisplayMediaRequestHandler(
        handler: (
          request: unknown,
          callback: (streams: { video?: { id: string; name: string } }) => void,
        ) => void | Promise<void>,
        options?: { useSystemPicker?: boolean },
      ): void;
      setPermissionRequestHandler(
        handler: (
          webContents: { getURL(): string } | null,
          permission: string,
          callback: (permissionGranted: boolean) => void,
          details: { requestingUrl?: string },
        ) => void,
      ): void;
      setPermissionCheckHandler(
        handler: (
          webContents: { getURL(): string } | null,
          permission: string,
          requestingOrigin: string,
          details: { requestingUrl?: string; embeddingOrigin?: string },
        ) => boolean,
      ): void;
    };
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  systemPreferences: {
    getMediaAccessStatus(mediaType: 'microphone' | 'camera' | 'screen'): string;
    askForMediaAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>;
  };
};

function resolveAppFile(...segments: string[]) {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), ...segments);
  }
  return path.resolve(process.cwd(), ...segments);
}

const isDevelopment = !app.isPackaged;
const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000';
const macScreenRecordingSettingsUrl =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const capturablePermissions = new Set(['media', 'display-capture']);
let selectedDisplaySourceId: string | null = null;

function isTrustedRendererUrl(url: string | undefined) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return !isDevelopment;
    return parsed.origin === new URL(rendererUrl).origin;
  } catch {
    return false;
  }
}

function isTrustedPermissionRequest(
  webContents: { getURL(): string } | null,
  permission: string,
  details: { requestingUrl?: string; embeddingOrigin?: string } = {},
) {
  if (!capturablePermissions.has(permission)) return false;

  return (
    isTrustedRendererUrl(details.requestingUrl) ||
    isTrustedRendererUrl(details.embeddingOrigin) ||
    isTrustedRendererUrl(webContents?.getURL())
  );
}

async function canLoadRendererDevUrl() {
  try {
    const response = await fetch(rendererUrl, { method: 'GET' });
    if (!response.ok) return false;

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) return true;

    const bodyStart = (await response.text()).trimStart().slice(0, 32).toLowerCase();
    return bodyStart.startsWith('<!doctype html') || bodyStart.startsWith('<html');
  } catch (error) {
    console.warn(`[Desktop] Renderer dev URL unavailable, falling back to built dist: ${String(error)}`);
    return false;
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: resolveAppFile('dist-electron', 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  if (isDevelopment && await canLoadRendererDevUrl()) {
    await win.loadURL(rendererUrl);
  } else {
    await win.loadFile(resolveAppFile('dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  await cleanupStaleDesktopExports();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedPermissionRequest(webContents, permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => {
    return isTrustedPermissionRequest(webContents, permission, details);
  });
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const requestedSource = selectedDisplaySourceId
        ? sources.find((source) => source.id === selectedDisplaySourceId)
        : null;
      const source = requestedSource ?? sources[0];
      callback(source ? { video: source } : {});
    },
    { useSystemPicker: false },
  );

  ipcMain.handle('desktop-export:is-available', () => isFfmpegAvailable());
  ipcMain.handle('desktop-export:start', async (_event: unknown, request: any) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    return startDesktopExport(request, {
      emitProgress(progress) {
        focusedWindow?.webContents.send('desktop-export:progress', progress);
      },
    });
  });
  ipcMain.handle('desktop-export:cancel', async (_event: unknown, jobId: string) => cancelDesktopExport(jobId));
  ipcMain.handle('desktop-export:get-result', async (_event: unknown, jobId: string) => getDesktopExportResult(jobId));
  ipcMain.handle('desktop-system:pick-save-path', async (_event: unknown, defaultPath: string) => {
    const window = BrowserWindow.getFocusedWindow();
    const response = await dialog.showSaveDialog(window ?? undefined, {
      defaultPath,
    });
    return response.canceled ? null : response.filePath ?? null;
  });
  ipcMain.handle('desktop-system:get-screen-access-status', () => {
    if (process.platform !== 'darwin') {
      return 'unknown';
    }

    return systemPreferences.getMediaAccessStatus('screen');
  });
  ipcMain.handle('desktop-system:get-media-access-status', (_event: unknown, mediaType: 'camera' | 'microphone' | 'screen') => {
    return systemPreferences.getMediaAccessStatus(mediaType);
  });
  ipcMain.handle('desktop-system:request-media-access', async (_event: unknown, mediaType: 'camera' | 'microphone') => {
    if (process.platform !== 'darwin') {
      const status = systemPreferences.getMediaAccessStatus(mediaType);
      return status !== 'denied' && status !== 'restricted';
    }

    return systemPreferences.askForMediaAccess(mediaType);
  });
  ipcMain.handle('desktop-system:open-screen-recording-settings', async () => {
    if (process.platform !== 'darwin') {
      return false;
    }

    await shell.openExternal(macScreenRecordingSettingsUrl);
    return true;
  });
  ipcMain.handle('desktop-system:list-display-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
    }));
  });
  ipcMain.handle('desktop-system:set-display-source', (_event: unknown, sourceId: string | null) => {
    selectedDisplaySourceId = sourceId || null;
  });
  ipcMain.handle('desktop-export:copy-result', async (_event: unknown, jobId: string, targetPath: string) => {
    return copyDesktopExportResult(jobId, targetPath);
  });

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
