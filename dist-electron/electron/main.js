import path from 'node:path';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cancelDesktopExport, cleanupStaleDesktopExports, copyDesktopExportResult, getDesktopExportResult, isFfmpegAvailable, startDesktopExport, } from './desktop-export-service.js';
const require = createRequire(import.meta.url);
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, systemPreferences } = require('electron');
function resolveAppFile(...segments) {
    if (app.isPackaged) {
        return path.join(app.getAppPath(), ...segments);
    }
    return path.resolve(process.cwd(), ...segments);
}
const isDevelopment = !app.isPackaged;
const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000';
const macScreenRecordingSettingsUrl = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const capturablePermissions = new Set(['media', 'display-capture']);
let selectedDisplaySourceId = null;
let packagedRendererOrigin = null;
let packagedRendererServer = null;
const rendererMimeTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.gif', 'image/gif'],
    ['.html', 'text/html; charset=utf-8'],
    ['.ico', 'image/x-icon'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.map', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.wasm', 'application/wasm'],
    ['.webp', 'image/webp'],
]);
function isTrustedRendererUrl(url) {
    if (!url)
        return false;
    try {
        const parsed = new URL(url);
        if (packagedRendererOrigin && parsed.origin === packagedRendererOrigin)
            return true;
        if (parsed.protocol === 'file:')
            return !isDevelopment;
        return parsed.origin === new URL(rendererUrl).origin;
    }
    catch {
        return false;
    }
}
function sendRendererFile(res, filePath) {
    res.statusCode = 200;
    res.setHeader('Content-Type', rendererMimeTypes.get(path.extname(filePath)) || 'application/octet-stream');
    createReadStream(filePath).on('error', () => {
        if (!res.headersSent) {
            res.statusCode = 500;
        }
        res.end();
    }).pipe(res);
}
async function resolveRendererFile(pathname) {
    const distDir = resolveAppFile('dist');
    const decodedPath = decodeURIComponent(pathname);
    const requestedPath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');
    const candidatePath = path.join(distDir, path.normalize(requestedPath));
    const relativePath = path.relative(distDir, candidatePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
    }
    try {
        const fileStats = await stat(candidatePath);
        if (fileStats.isFile())
            return candidatePath;
    }
    catch {
        // Fall through to the SPA entry point for client-side routes.
    }
    return path.join(distDir, 'index.html');
}
async function startPackagedRendererServer() {
    if (packagedRendererOrigin)
        return packagedRendererOrigin;
    packagedRendererServer = createServer((req, res) => {
        if (!req.url) {
            res.statusCode = 400;
            res.end();
            return;
        }
        void (async () => {
            const url = new URL(req.url || '/', 'http://127.0.0.1');
            const filePath = await resolveRendererFile(url.pathname);
            if (!filePath) {
                res.statusCode = 403;
                res.end();
                return;
            }
            sendRendererFile(res, filePath);
        })().catch((error) => {
            console.error('[Desktop] Failed to serve renderer asset:', error);
            if (!res.headersSent) {
                res.statusCode = 500;
            }
            res.end();
        });
    });
    await new Promise((resolve, reject) => {
        const server = packagedRendererServer;
        if (!server) {
            reject(new Error('Renderer server was not initialized.'));
            return;
        }
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = packagedRendererServer.address();
    if (!address || typeof address === 'string') {
        throw new Error('Renderer server did not bind to a local TCP port.');
    }
    packagedRendererOrigin = `http://127.0.0.1:${address.port}`;
    return packagedRendererOrigin;
}
function isTrustedPermissionRequest(webContents, permission, details = {}) {
    if (!capturablePermissions.has(permission))
        return false;
    return (isTrustedRendererUrl(details.requestingUrl) ||
        isTrustedRendererUrl(details.embeddingOrigin) ||
        isTrustedRendererUrl(webContents?.getURL()));
}
async function canLoadRendererDevUrl() {
    try {
        const response = await fetch(rendererUrl, { method: 'GET' });
        if (!response.ok)
            return false;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html'))
            return true;
        const bodyStart = (await response.text()).trimStart().slice(0, 32).toLowerCase();
        return bodyStart.startsWith('<!doctype html') || bodyStart.startsWith('<html');
    }
    catch (error) {
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
    }
    else if (app.isPackaged) {
        await win.loadURL(await startPackagedRendererServer());
    }
    else {
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
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
            const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
            const requestedSource = selectedDisplaySourceId
                ? sources.find((source) => source.id === selectedDisplaySourceId)
                : null;
            const source = requestedSource ?? sources[0];
            callback(source ? { video: source, ...(request.audioRequested ? { audio: 'loopback' } : {}) } : {});
        }
        catch (error) {
            console.error('[Desktop] Failed to get display media sources:', error);
            callback({});
        }
    }, { useSystemPicker: true });
    ipcMain.handle('desktop-export:is-available', () => isFfmpegAvailable());
    ipcMain.handle('desktop-export:start', async (_event, request) => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        return startDesktopExport(request, {
            emitProgress(progress) {
                focusedWindow?.webContents.send('desktop-export:progress', progress);
            },
        });
    });
    ipcMain.handle('desktop-export:cancel', async (_event, jobId) => cancelDesktopExport(jobId));
    ipcMain.handle('desktop-export:get-result', async (_event, jobId) => getDesktopExportResult(jobId));
    ipcMain.handle('desktop-system:pick-save-path', async (_event, defaultPath) => {
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
    ipcMain.handle('desktop-system:get-media-access-status', (_event, mediaType) => {
        return systemPreferences.getMediaAccessStatus(mediaType);
    });
    ipcMain.handle('desktop-system:request-media-access', async (_event, mediaType) => {
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
    ipcMain.handle('desktop-system:set-display-source', (_event, sourceId) => {
        selectedDisplaySourceId = sourceId || null;
    });
    ipcMain.handle('desktop-export:copy-result', async (_event, jobId, targetPath) => {
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
