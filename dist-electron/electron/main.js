import path from 'node:path';
import { createRequire } from 'node:module';
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
    if (isDevelopment) {
        await win.loadURL(rendererUrl);
    }
    else {
        await win.loadFile(resolveAppFile('dist', 'index.html'));
    }
}
app.whenReady().then(async () => {
    await cleanupStaleDesktopExports();
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        const primarySource = sources[0];
        callback(primarySource ? { video: primarySource } : {});
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
    ipcMain.handle('desktop-system:open-screen-recording-settings', async () => {
        if (process.platform !== 'darwin') {
            return false;
        }
        await shell.openExternal(macScreenRecordingSettingsUrl);
        return true;
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
