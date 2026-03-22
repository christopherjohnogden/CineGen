interface ExtractFilmstripOptions {
  frameCount?: number;
  frameWidth?: number;
  jpegQuality?: number;
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video seek failed'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = time;
  });
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video metadata load failed'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };

    if (video.readyState >= 1) {
      resolve();
      return;
    }

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

/**
 * Extract lightweight filmstrip frame data URLs from a local video source.
 * Used as a renderer fallback when worker-generated filmstrips are unavailable.
 */
export async function extractFilmstripFrames(
  url: string,
  options: ExtractFilmstripOptions = {},
): Promise<string[]> {
  const frameCount = Math.max(2, Math.min(options.frameCount ?? 12, 24));
  const frameWidth = Math.max(64, Math.min(options.frameWidth ?? 120, 200));
  const jpegQuality = Math.max(0.25, Math.min(options.jpegQuality ?? 0.45, 0.9));

  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForMetadata(video);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const targetFrames = duration > 0
      ? Math.max(2, Math.min(frameCount, Math.ceil(duration)))
      : 1;

    const sourceW = Math.max(1, video.videoWidth || 1920);
    const sourceH = Math.max(1, video.videoHeight || 1080);

    const canvas = document.createElement('canvas');
    canvas.width = frameWidth;
    canvas.height = Math.max(1, Math.round((sourceH / sourceW) * frameWidth));
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const frames: string[] = [];
    for (let i = 0; i < targetFrames; i++) {
      const t = targetFrames <= 1 || duration <= 0
        ? 0
        : (i / (targetFrames - 1)) * Math.max(duration - 0.05, 0);
      await waitForSeek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', jpegQuality));
    }

    return frames;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
