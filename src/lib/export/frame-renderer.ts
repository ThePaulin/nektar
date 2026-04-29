import { ExportMediaCache } from './media-cache';
import { PreparedExportClip, PreparedExportScene, TrackType } from '../../types';

export class ActiveClipWindow {
  private readonly clipsByStart: PreparedExportClip[];
  private readonly clipsByEnd: PreparedExportClip[];
  private readonly active = new Map<number, PreparedExportClip>();
  private readonly activeOrdered: PreparedExportClip[] = [];
  private startIndex = 0;
  private endIndex = 0;

  constructor(private readonly scene: PreparedExportScene) {
    this.clipsByStart = [...scene.clips].sort((a, b) => a.exportStart - b.exportStart || a.trackOrder - b.trackOrder);
    this.clipsByEnd = [...scene.clips].sort((a, b) => a.exportEnd - b.exportEnd || a.trackOrder - b.trackOrder);
  }

  advanceTo(time: number) {
    while (this.endIndex < this.clipsByEnd.length && this.clipsByEnd[this.endIndex].exportEnd <= time) {
      const clip = this.clipsByEnd[this.endIndex];
      this.active.delete(clip.clip.id);
      const orderedIndex = this.activeOrdered.findIndex((entry) => entry.clip.id === clip.clip.id);
      if (orderedIndex >= 0) {
        this.activeOrdered.splice(orderedIndex, 1);
      }
      this.endIndex += 1;
    }

    while (this.startIndex < this.clipsByStart.length && this.clipsByStart[this.startIndex].exportStart <= time) {
      const clip = this.clipsByStart[this.startIndex];
      if (clip.exportEnd > time && !this.active.has(clip.clip.id)) {
        this.active.set(clip.clip.id, clip);
        const insertAt = this.activeOrdered.findIndex((entry) => entry.trackOrder > clip.trackOrder);
        if (insertAt === -1) {
          this.activeOrdered.push(clip);
        } else {
          this.activeOrdered.splice(insertAt, 0, clip);
        }
      }
      this.startIndex += 1;
    }

    return this.activeOrdered;
  }
}

function createExportCanvas(width: number, height: number) {
  try {
    return new OffscreenCanvas(width, height);
  } catch {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}

export class FrameRenderer {
  private readonly canvas = createExportCanvas(this.scene.width, this.scene.height);
  private readonly context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private readonly activeWindow: ActiveClipWindow;

  constructor(
    private readonly scene: PreparedExportScene,
    private readonly mediaCache: ExportMediaCache,
  ) {
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Failed to initialize export canvas');
    }
    this.context = context as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    this.activeWindow = new ActiveClipWindow(scene);
  }

  getActiveClipsAtTime(time: number) {
    return this.activeWindow.advanceTo(time);
  }

  async renderFrame(time: number) {
    const activeClips = this.activeWindow.advanceTo(time);
    await this.mediaCache.primeVideoFrames(activeClips, time, this.scene.fps);

    this.context.fillStyle = '#000000';
    this.context.fillRect(0, 0, this.scene.width, this.scene.height);

    activeClips.forEach((clip) => {
      const { transform } = clip;
      this.context.save();
      this.context.globalAlpha = transform.opacity;
      this.context.translate((transform.position.x || 0) + this.scene.width / 2, (transform.position.y || 0) + this.scene.height / 2);
      this.context.rotate(transform.rotation * Math.PI / 180);
      this.context.scale(
        (transform.scale.x || 1) * (transform.flipHorizontal ? -1 : 1),
        (transform.scale.y || 1) * (transform.flipVertical ? -1 : 1),
      );

      if ((clip.clip.type === TrackType.VIDEO || clip.clip.type === TrackType.SCREEN) && clip.assetKey) {
        const video = this.mediaCache.getReadyVideoElement(clip.assetKey);
        if (video && video.videoWidth > 0) {
          const { top, right, bottom, left } = transform.crop;
          const sx = (left / 100) * video.videoWidth;
          const sy = (top / 100) * video.videoHeight;
          const sw = video.videoWidth * (1 - (left + right) / 100);
          const sh = video.videoHeight * (1 - (top + bottom) / 100);
          this.context.drawImage(video, sx, sy, sw, sh, -this.scene.width / 2, -this.scene.height / 2, this.scene.width, this.scene.height);
        }
      } else if (clip.clip.type === TrackType.IMAGE && clip.assetKey) {
        const image = this.mediaCache.getImageElement(clip.assetKey);
        if (image) {
          const { top, right, bottom, left } = transform.crop;
          const sx = (left / 100) * image.width;
          const sy = (top / 100) * image.height;
          const sw = image.width * (1 - (left + right) / 100);
          const sh = image.height * (1 - (top + bottom) / 100);
          this.context.drawImage(image, sx, sy, sw, sh, -this.scene.width / 2, -this.scene.height / 2, this.scene.width, this.scene.height);
        }
      } else if (clip.clip.type === TrackType.TEXT || clip.clip.type === TrackType.SUBTITLE) {
        const fontSize = clip.clip.style?.fontSize || 48;
        this.context.font = `${clip.clip.style?.fontWeight || 'normal'} ${fontSize}px ${clip.clip.style?.fontFamily || 'sans-serif'}`;
        this.context.fillStyle = clip.clip.style?.color || '#ffffff';
        this.context.textAlign = 'center';
        this.context.textBaseline = 'middle';
        if (clip.clip.type === TrackType.SUBTITLE || (clip.clip.style?.backgroundColor && clip.clip.style.backgroundColor !== 'transparent')) {
          const textWidth = this.context.measureText(clip.clip.content || '').width;
          this.context.fillStyle = clip.clip.style?.backgroundColor || 'rgba(0,0,0,0.6)';
          this.context.fillRect(-textWidth / 2 - 20, -fontSize / 2 - 10, textWidth + 40, fontSize + 20);
          this.context.fillStyle = clip.clip.style?.color || '#ffffff';
        }
        this.context.fillText(clip.clip.content || '', 0, 0);
      }

      this.context.restore();
    });

    return this.canvas;
  }
}
