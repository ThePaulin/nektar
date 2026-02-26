import { VideoClip, VideoObjType } from "../types";

const DB_NAME = "VideoEditorDB";
const DB_VERSION = 1;
const CLIPS_STORE = "clips";
const BLOBS_STORE = "blobs";

export class VideoDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(CLIPS_STORE)) {
          db.createObjectStore(CLIPS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(BLOBS_STORE)) {
          db.createObjectStore(BLOBS_STORE);
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  async saveClip(clip: VideoClip, blob?: Blob): Promise<void> {
    const db = await this.ensureDB();
    
    try {
      const transaction = db.transaction([CLIPS_STORE, BLOBS_STORE], "readwrite");
      
      // Save metadata
      const clipsStore = transaction.objectStore(CLIPS_STORE);
      clipsStore.put(clip);

      // Save blob if provided (for recorded clips)
      if (blob && clip.blobId) {
        const blobsStore = transaction.objectStore(BLOBS_STORE);
        blobsStore.put(blob, clip.blobId);
      }

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => {
          const error = (event.target as IDBTransaction).error;
          if (error?.name === "QuotaExceededError") {
            console.error("Storage quota exceeded. Please delete some clips.");
          }
          reject(error);
        };
      });
    } catch (err: any) {
      if (err.name === "InvalidStateError" || err.message?.includes("closing")) {
        this.db = null; // Force re-init on next call
        return this.saveClip(clip, blob);
      }
      throw err;
    }
  }

  async saveAllClips(clips: VideoObjType): Promise<void> {
    const db = await this.ensureDB();
    
    try {
      const transaction = db.transaction(CLIPS_STORE, "readwrite");
      const store = transaction.objectStore(CLIPS_STORE);
      
      // Clear existing metadata first to keep it in sync
      store.clear();
      for (const clip of clips) {
        store.put(clip);
      }

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (err: any) {
      if (err.name === "InvalidStateError" || err.message?.includes("closing")) {
        this.db = null;
        return this.saveAllClips(clips);
      }
      throw err;
    }
  }

  async getClips(): Promise<VideoObjType> {
    const db = await this.ensureDB();
    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CLIPS_STORE, "readonly");
        const store = transaction.objectStore(CLIPS_STORE);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err: any) {
      if (err.name === "InvalidStateError" || err.message?.includes("closing")) {
        this.db = null;
        return this.getClips();
      }
      throw err;
    }
  }

  async getBlob(blobId: string): Promise<Blob | null> {
    const db = await this.ensureDB();
    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(BLOBS_STORE, "readonly");
        const store = transaction.objectStore(BLOBS_STORE);
        const request = store.get(blobId);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (err: any) {
      if (err.name === "InvalidStateError" || err.message?.includes("closing")) {
        this.db = null;
        return this.getBlob(blobId);
      }
      throw err;
    }
  }

  async deleteClip(clipId: number, blobId?: string): Promise<void> {
    const db = await this.ensureDB();
    try {
      const transaction = db.transaction([CLIPS_STORE, BLOBS_STORE], "readwrite");
      transaction.objectStore(CLIPS_STORE).delete(clipId);
      
      if (blobId) {
        transaction.objectStore(BLOBS_STORE).delete(blobId);
      }

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (err: any) {
      if (err.name === "InvalidStateError" || err.message?.includes("closing")) {
        this.db = null;
        return this.deleteClip(clipId, blobId);
      }
      throw err;
    }
  }

  async clearAll(): Promise<void> {
    const db = await this.ensureDB();
    try {
      const transaction = db.transaction([CLIPS_STORE, BLOBS_STORE], "readwrite");
      transaction.objectStore(CLIPS_STORE).clear();
      transaction.objectStore(BLOBS_STORE).clear();

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (err: any) {
      if (err.name === "InvalidStateError" || err.message?.includes("closing")) {
        this.db = null;
        return this.clearAll();
      }
      throw err;
    }
  }

  async getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0
      };
    }
    return null;
  }
}

export const videoDB = new VideoDB();
