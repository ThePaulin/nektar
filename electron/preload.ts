import { createRequire } from 'node:module';
import type { DesktopExportProgress, DesktopExportRequest } from '../src/types';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron') as {
  contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
  ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (...args: unknown[]) => void): void;
    removeListener(channel: string, listener: (...args: unknown[]) => void): void;
  };
};

contextBridge.exposeInMainWorld('nektarDesktop', {
  desktopExport: {
    isAvailable: () => ipcRenderer.invoke('desktop-export:is-available'),
    start: (request: DesktopExportRequest) => ipcRenderer.invoke('desktop-export:start', request),
    cancel: (jobId: string) => ipcRenderer.invoke('desktop-export:cancel', jobId),
    getResult: (jobId: string) => ipcRenderer.invoke('desktop-export:get-result', jobId),
    copyResult: (jobId: string, targetPath: string) => ipcRenderer.invoke('desktop-export:copy-result', jobId, targetPath),
    onProgress: (listener: (progress: DesktopExportProgress) => void) => {
      const wrapped = (_event: unknown, payload: DesktopExportProgress) => listener(payload);
      ipcRenderer.on('desktop-export:progress', wrapped);
      return () => ipcRenderer.removeListener('desktop-export:progress', wrapped);
    },
  },
  desktopSystem: {
    pickSavePath: (defaultPath: string) => ipcRenderer.invoke('desktop-system:pick-save-path', defaultPath),
    getScreenAccessStatus: () => ipcRenderer.invoke('desktop-system:get-screen-access-status'),
    openScreenRecordingSettings: () => ipcRenderer.invoke('desktop-system:open-screen-recording-settings'),
  },
});
