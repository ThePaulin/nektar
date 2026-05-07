import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nektarDesktop', {
    desktopExport: {
        isAvailable: () => ipcRenderer.invoke('desktop-export:is-available'),
        start: (request) => ipcRenderer.invoke('desktop-export:start', request),
        cancel: (jobId) => ipcRenderer.invoke('desktop-export:cancel', jobId),
        getResult: (jobId) => ipcRenderer.invoke('desktop-export:get-result', jobId),
        copyResult: (jobId, targetPath) => ipcRenderer.invoke('desktop-export:copy-result', jobId, targetPath),
        onProgress: (listener) => {
            const wrapped = (_event, payload) => listener(payload);
            ipcRenderer.on('desktop-export:progress', wrapped);
            return () => ipcRenderer.removeListener('desktop-export:progress', wrapped);
        },
    },
    desktopSystem: {
        pickSavePath: (defaultPath) => ipcRenderer.invoke('desktop-system:pick-save-path', defaultPath),
        getScreenAccessStatus: () => ipcRenderer.invoke('desktop-system:get-screen-access-status'),
        openScreenRecordingSettings: () => ipcRenderer.invoke('desktop-system:open-screen-recording-settings'),
    },
});
