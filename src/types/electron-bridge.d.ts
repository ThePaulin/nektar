import type {
  DesktopExportProgress,
  DesktopExportRequest,
  DesktopExportResult,
} from '../types';

declare global {
  interface Window {
    nektarDesktop?: {
      desktopExport: {
        isAvailable(): Promise<boolean>;
        start(request: DesktopExportRequest): Promise<{ jobId: string }>;
        cancel(jobId: string): Promise<void>;
        onProgress(listener: (progress: DesktopExportProgress) => void): () => void;
        getResult(jobId: string): Promise<DesktopExportResult>;
        copyResult(jobId: string, targetPath: string): Promise<string>;
      };
      desktopSystem?: {
        pickSavePath(defaultPath: string): Promise<string | null>;
        getScreenAccessStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>;
        openScreenRecordingSettings(): Promise<boolean>;
      };
    };
  }
}

declare module 'electron' {
  export const app: any;
  export const BrowserWindow: any;
  export const ipcMain: any;
  export const ipcRenderer: any;
  export const contextBridge: any;
  export const dialog: any;
  export const shell: any;
  export const systemPreferences: any;
}

export {};
