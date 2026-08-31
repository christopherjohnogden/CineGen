import { memo, useCallback, useRef, useState, type SyntheticEvent } from 'react';

const MAX_POSTER_WIDTH = 640;
const MAX_PREVIEW_TIME_SECONDS = 0.1;

export function getVideoPreviewTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0.002) return 0;
  return Math.max(
    0.001,
    Math.min(MAX_PREVIEW_TIME_SECONDS, duration * 0.025, duration - 0.001),
  );
}

interface VideoNodePreviewProps {
  sourceUrl: string;
  fallbackPosterUrl?: string;
  className: string;
  ariaLabel: string;
  onError?: () => void;
}

interface CapturedPoster {
  sourceUrl: string;
  posterUrl: string;
}

/**
 * A node-sized video player that primes a real frame before playback.
 * Some mobile browsers leave an unplayed video transparent until a frame is
 * explicitly requested, so the seek is useful even when canvas poster capture
 * is unavailable because of cross-origin media restrictions.
 */
export const VideoNodePreview = memo(function VideoNodePreview({
  sourceUrl,
  fallbackPosterUrl,
  className,
  ariaLabel,
  onError,
}: VideoNodePreviewProps) {
  const posterCacheRef = useRef(new Map<string, string>());
  const [capturedPoster, setCapturedPoster] = useState<CapturedPoster | null>(null);
  const posterUrl = posterCacheRef.current.get(sourceUrl)
    ?? (capturedPoster?.sourceUrl === sourceUrl ? capturedPoster.posterUrl : undefined)
    ?? fallbackPosterUrl;

  const capturePoster = useCallback((video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return;

    try {
      const width = Math.min(video.videoWidth, MAX_POSTER_WIDTH);
      const height = Math.max(1, Math.round(width * (video.videoHeight / video.videoWidth)));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;

      context.drawImage(video, 0, 0, width, height);
      const nextPosterUrl = canvas.toDataURL('image/jpeg', 0.78);
      if (!nextPosterUrl.startsWith('data:image/')) return;

      posterCacheRef.current.set(sourceUrl, nextPosterUrl);
      setCapturedPoster((current) => (
        current?.sourceUrl === sourceUrl && current.posterUrl === nextPosterUrl
          ? current
          : { sourceUrl, posterUrl: nextPosterUrl }
      ));
    } catch {
      // The visible video can still show the primed frame when CORS blocks canvas reads.
    }
  }, [sourceUrl]);

  const primePreviewFrame = useCallback((video: HTMLVideoElement) => {
    const previewTime = getVideoPreviewTime(video.duration);
    if (previewTime === 0 || Math.abs(video.currentTime - previewTime) < 0.0005) {
      capturePoster(video);
      return;
    }

    try {
      video.currentTime = previewTime;
    } catch {
      capturePoster(video);
    }
  }, [capturePoster]);

  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    primePreviewFrame(event.currentTarget);
  }, [primePreviewFrame]);

  const handleLoadedData = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    primePreviewFrame(event.currentTarget);
  }, [primePreviewFrame]);

  const handleSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    capturePoster(event.currentTarget);
  }, [capturePoster]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={sourceUrl}
      className={className}
      controls
      playsInline
      preload="auto"
      poster={posterUrl}
      aria-label={ariaLabel}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedData}
      onSeeked={handleSeeked}
      onClick={(event) => event.stopPropagation()}
      onError={onError}
    />
  );
});
