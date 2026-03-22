

import { useRef, useEffect, useCallback, useState } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { toFileUrl } from '@/lib/utils/file-url';

export type PreviewMode = 'pip' | 'minimized' | 'fullscreen';

interface TimelinePreviewProps {
  asset: Asset | null | undefined;
  clip: Clip | null | undefined;
  currentTime: number;
  isPlaying: boolean;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  nativeSurfaceRef?: (el: HTMLDivElement | null) => void;
  nativeEnabled?: boolean;
}

export function TimelinePreview({
  asset,
  clip,
  currentTime,
  isPlaying,
  mode,
  onModeChange,
  nativeSurfaceRef,
  nativeEnabled = false,
}: TimelinePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSeekRef = useRef(0);
  const [muted, setMuted] = useState(false);

  const clipTime =
    clip && asset?.type === 'video'
      ? currentTime - clip.startTime + clip.trimStart
      : 0;

  // Seek to correct position when paused (scrubbing) or when playback starts
  useEffect(() => {
    const video = videoRef.current;
    if (!video || asset?.type !== 'video' || video.readyState < 1) return;

    if (!isPlaying) {
      // Scrub: seek precisely, throttled
      const now = performance.now();
      if (now - lastSeekRef.current > 50) {
        video.currentTime = clipTime;
        lastSeekRef.current = now;
      }
    }
  }, [clipTime, asset, isPlaying]);

  // Handle play/pause transitions — seek to correct position then play
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && !wasPlayingRef.current) {
      video.currentTime = clipTime;
      video.play().catch(() => {});
    } else if (!isPlaying && wasPlayingRef.current) {
      video.pause();
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, clipTime]);

  const handleLoadedData = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = clipTime;
    if (isPlaying) {
      video.play().catch(() => {});
    }
  }, [clipTime, isPlaying]);

  if (mode === 'minimized') return null;

  const hasContent = asset && clip;
  const isFullscreen = mode === 'fullscreen';
  const mediaSrc = nativeEnabled ? '' : toFileUrl(asset?.fileRef || asset?.url);

  return (
    <div className={`timeline-preview ${isFullscreen ? 'timeline-preview--fullscreen' : ''} ${!hasContent ? 'timeline-preview--empty' : ''}`}>
      <div className="timeline-preview__controls">
        {isFullscreen ? (
          <button
            type="button"
            className="timeline-preview__control-btn"
            onClick={() => onModeChange('pip')}
            title="Exit fullscreen"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="timeline-preview__control-btn"
            onClick={() => onModeChange('fullscreen')}
            title="Fullscreen"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="timeline-preview__control-btn"
          onClick={() => onModeChange('minimized')}
          title="Minimize"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      {!hasContent && (
        <span className="timeline-preview__placeholder">No clip at playhead</span>
      )}
      {nativeEnabled ? (
        <div
          ref={nativeSurfaceRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      ) : (
        <>
          {asset?.type === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="timeline-preview__media"
              src={mediaSrc}
              alt={asset.name}
              draggable={false}
            />
          )}
          {asset?.type === 'video' && (
            <video
              key={mediaSrc}
              ref={videoRef}
              className="timeline-preview__media"
              src={mediaSrc}
              onLoadedData={handleLoadedData}
              playsInline
              muted={muted}
              preload="auto"
            />
          )}
        </>
      )}
      <button
        type="button"
        className="timeline-preview__volume-btn"
        onClick={() => setMuted((m) => !m)}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>
    </div>
  );
}
