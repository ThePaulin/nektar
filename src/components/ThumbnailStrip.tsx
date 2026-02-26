import React, { useEffect, useState, useRef } from 'react';

interface ThumbnailStripProps {
  videoUrl: string;
  duration: number;
  sourceStart: number;
  pixelsPerSecond: number;
  clipWidth: number;
}

const thumbnailCache: { [key: string]: string } = {};

export const ThumbnailStrip: React.FC<ThumbnailStripProps> = ({
  videoUrl,
  duration,
  sourceStart,
  pixelsPerSecond,
  clipWidth,
}) => {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const thumbnailWidth = 100; // px
  const count = Math.max(1, Math.ceil(clipWidth / thumbnailWidth));

  useEffect(() => {
    let isMounted = true;
    const generatedThumbnails: string[] = [];

    const generate = async () => {
      const video = document.createElement('video');
      video.src = videoUrl;
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'metadata';

      try {
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = reject;
        });

        for (let i = 0; i < count; i++) {
          if (!isMounted) break;

          const timeInClip = (i * thumbnailWidth) / pixelsPerSecond;
          const absoluteTime = sourceStart + timeInClip;
          const cacheKey = `${videoUrl}-${absoluteTime.toFixed(1)}`;

          if (thumbnailCache[cacheKey]) {
            generatedThumbnails.push(thumbnailCache[cacheKey]);
          } else {
            video.currentTime = absoluteTime;
            await new Promise((resolve) => {
              video.onseeked = resolve;
            });

            const canvas = document.createElement('canvas');
            const scale = 0.2; // Small thumbnails for performance
            canvas.width = video.videoWidth * scale;
            canvas.height = video.videoHeight * scale;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            thumbnailCache[cacheKey] = dataUrl;
            generatedThumbnails.push(dataUrl);
          }
          
          if (isMounted) {
            setThumbnails([...generatedThumbnails]);
          }
        }
      } catch (error) {
        console.warn('Failed to generate thumbnails from video, falling back to placeholders:', error);
        // Fallback to placeholder images with different seeds to look like keyframes
        const fallbacks = Array.from({ length: count }).map((_, i) => 
          `https://picsum.photos/seed/${videoUrl.split('/').pop()}-${i}/200/120`
        );
        if (isMounted) setThumbnails(fallbacks);
      } finally {
        video.remove();
      }
    };

    generate();

    return () => {
      isMounted = false;
    };
  }, [videoUrl, count, sourceStart, pixelsPerSecond]);

  return (
    <div className="flex h-full w-full overflow-hidden opacity-60 group-hover:opacity-100 transition-opacity">
      {thumbnails.length > 0 ? (
        thumbnails.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            className="h-full object-cover border-r border-gray-800 last:border-r-0"
            style={{ width: thumbnailWidth }}
            referrerPolicy="no-referrer"
          />
        ))
      ) : (
        <div className="w-full h-full bg-gray-900 animate-pulse" />
      )}
    </div>
  );
};
