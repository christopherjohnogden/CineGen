

import { useRef, useEffect, useCallback, useState } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { toFileUrl } from '@/lib/utils/file-url';

export interface AudioEntry {
  clip: Clip;
  asset: Asset;
}

interface TrimPreviewInfo {
  clipId: string;
  sourceTime: number;
}

interface PreviewPlayerProps {
  asset: Asset | null;
  clip: Clip | null;
  videoUrls: string[];
  nextVideoHint?: { url: string; sourceTime: number } | null;
  audioEntries: AudioEntry[];
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  duration: number;
  trimPreview?: TrimPreviewInfo | null;
  trimPreviewAsset?: Asset | null;
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Video pool: preloads all timeline video sources into hidden <video> elements.
 * On clip transition, just show/hide the right element — no loading delay.
 */
export function PreviewPlayer({
  asset,
  clip,
  videoUrls,
  nextVideoHint,
  audioEntries,
  currentTime,
  onTimeUpdate,
  isPlaying,
  onPlayPause,
  duration,
  trimPreview,
  trimPreviewAsset,
}: PreviewPlayerProps) {
  const trimVideoRef = useRef<HTMLVideoElement>(null);
  const lastSeekRef = useRef<number>(0);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Video pool: Map<url, HTMLVideoElement>
  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  // Force re-render when pool changes
  const [, setPoolVersion] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const clipTimeRef = useRef(0);
  const clipTime = clip ? currentTime - clip.startTime + clip.trimStart : 0;
  clipTimeRef.current = clipTime;

  // Keep track of last visible URL so we can hold the frame during gaps
  const lastVisibleUrlRef = useRef<string | null>(null);
  // Track the z-index "generation" so the active video is always on top
  const zGenRef = useRef(1);

  // --- Manage video pool: create/remove elements as videoUrls change ---
  useEffect(() => {
    const pool = videoPoolRef.current;
    const container = containerRef.current;
    if (!container) return;

    const currentUrls = new Set(videoUrls);

    // Add new videos — all stacked with position:absolute, initially behind
    for (const url of videoUrls) {
      if (!pool.has(url)) {
        const video = document.createElement('video');
        video.playsInline = true;
        video.muted = false;
        video.preload = 'auto';
        video.src = url;
        video.style.position = 'absolute';
        video.style.inset = '0';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.zIndex = '0';
        container.appendChild(video);
        pool.set(url, video);
        video.load();
      }
    }

    // Remove stale videos
    pool.forEach((video, url) => {
      if (!currentUrls.has(url)) {
        video.pause();
        video.removeAttribute('src');
        video.remove();
        pool.delete(url);
      }
    });

    setPoolVersion((v) => v + 1);
  }, [videoUrls]);

  // Cleanup all pool elements on unmount
  useEffect(() => {
    return () => {
      videoPoolRef.current.forEach((video) => {
        video.pause();
        video.removeAttribute('src');
        video.remove();
      });
      videoPoolRef.current.clear();
    };
  }, []);

  // --- Video playback sync ---
  const activeUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const pool = videoPoolRef.current;
    const targetUrl = asset?.type === 'video' ? toFileUrl(asset.fileRef || asset.url) : null;
    const prevUrl = activeUrlRef.current;
    const switching = targetUrl !== prevUrl && !!targetUrl;
    activeUrlRef.current = targetUrl;

    pool.forEach((video, url) => {
      if (url === targetUrl) {
        if (isPlaying) {
          if (switching) {
            // Seek + start playing, but keep OLD clip on top (higher z-index).
            // Only promote this video to top once it has actually painted its new frame.
            video.currentTime = clipTimeRef.current;
            video.play().catch(() => {});
            const gen = ++zGenRef.current;

            const promote = () => {
              video.style.zIndex = String(gen);
              lastVisibleUrlRef.current = url;
              // Demote all other videos
              pool.forEach((v, u) => { if (u !== url) v.style.zIndex = '0'; });
            };

            // Use requestVideoFrameCallback — fires after the frame is actually painted
            if (typeof video.requestVideoFrameCallback === 'function') {
              video.requestVideoFrameCallback(promote);
            } else {
              // Fallback: wait for seeked + one rAF to ensure paint
              const onSeeked = () => {
                requestAnimationFrame(promote);
              };
              (video as HTMLVideoElement).addEventListener('seeked', onSeeked, { once: true });
            }
          } else {
            // Same source, just ensure it's on top and playing
            if (!lastVisibleUrlRef.current || lastVisibleUrlRef.current !== url) {
              video.style.zIndex = String(++zGenRef.current);
              lastVisibleUrlRef.current = url;
            }
            if (Math.abs(video.currentTime - clipTimeRef.current) > 0.3) {
              video.currentTime = clipTimeRef.current;
            }
            if (video.paused) video.play().catch(() => {});
          }
        } else {
          // Paused — show this video on top
          video.style.zIndex = String(++zGenRef.current);
          lastVisibleUrlRef.current = url;
          video.pause();
          const now = performance.now();
          if (now - lastSeekRef.current > 50) {
            video.currentTime = clipTimeRef.current;
            lastSeekRef.current = now;
          }
          // Demote others
          pool.forEach((v, u) => { if (u !== url) v.style.zIndex = '0'; });
        }
      } else if (!targetUrl) {
        // No active clip — pause but keep last visible on top for gap hold
        video.pause();
      } else {
        // Not the active video and there IS an active one — pause
        video.pause();
      }
    });

    if (!targetUrl && !isPlaying) {
      lastVisibleUrlRef.current = null;
    }
  }, [asset, clip, isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-seek upcoming video to correct frame while still hidden
  useEffect(() => {
    if (!nextVideoHint) return;
    const video = videoPoolRef.current.get(nextVideoHint.url);
    if (!video) return;
    // Only pre-seek if it's not the currently active video
    const targetUrl = asset?.type === 'video' ? toFileUrl(asset.fileRef || asset.url) : null;
    if (nextVideoHint.url === targetUrl) return;
    video.currentTime = nextVideoHint.sourceTime;
  }, [nextVideoHint, asset]);

  // Scrub seek — only when NOT playing
  useEffect(() => {
    if (isPlaying) return;
    if (!asset || asset.type !== 'video') return;
    const video = videoPoolRef.current.get(toFileUrl(asset.fileRef || asset.url));
    if (!video) return;
    const now = performance.now();
    if (now - lastSeekRef.current > 50) {
      video.currentTime = clipTime;
      lastSeekRef.current = now;
    }
  }, [clipTime, isPlaying, asset]);

  // Periodic drift correction during playback
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (!asset || asset.type !== 'video') return;
      const video = videoPoolRef.current.get(toFileUrl(asset.fileRef || asset.url));
      if (!video || video.paused) return;
      const drift = Math.abs(video.currentTime - clipTimeRef.current);
      if (drift > 0.5) {
        video.currentTime = clipTimeRef.current;
      }
    }, 500);
    return () => clearInterval(id);
  }, [isPlaying, asset]);

  // --- Trim preview ---
  useEffect(() => {
    const trimVideo = trimVideoRef.current;
    if (!trimVideo || !trimPreview || !trimPreviewAsset || trimPreviewAsset.type !== 'video') return;
    const trimUrl = toFileUrl(trimPreviewAsset.fileRef || trimPreviewAsset.url);
    if (trimVideo.src !== trimUrl) {
      trimVideo.src = trimUrl;
    }
    trimVideo.currentTime = trimPreview.sourceTime;
  }, [trimPreview, trimPreviewAsset]);

  const isTrimming = !!trimPreview && !!trimPreviewAsset;
  const showTrimVideo = isTrimming && trimPreviewAsset?.type === 'video';

  // --- Audio tracks sync ---
  const getAudioEl = useCallback((assetId: string, url: string): HTMLAudioElement => {
    let el = audioElsRef.current.get(assetId);
    if (!el) {
      el = new Audio(url);
      el.preload = 'auto';
      audioElsRef.current.set(assetId, el);
    }
    return el;
  }, []);

  // Keep a ref to currentTime so the drift interval can read it without re-triggering the effect
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  // Start/stop audio when entries or play state change (NOT every frame)
  useEffect(() => {
    const activeIds = new Set<string>();

    for (const entry of audioEntries) {
      const { clip: aClip, asset: aAsset } = entry;
      activeIds.add(aAsset.id);
      const sourceUrl = toFileUrl(aAsset.fileRef || aAsset.url);
      const el = getAudioEl(aAsset.id, sourceUrl);
      const aClipTime = currentTimeRef.current - aClip.startTime + aClip.trimStart;

      if (isPlaying) {
        // Only seek if not already playing near the right position
        if (el.paused || Math.abs(el.currentTime - aClipTime) > 0.5) {
          el.currentTime = aClipTime;
        }
        if (el.paused) el.play().catch(() => {});
      } else {
        el.pause();
        el.currentTime = aClipTime;
      }
    }

    audioElsRef.current.forEach((el, id) => {
      if (!activeIds.has(id)) {
        el.pause();
      }
    });
  }, [audioEntries, isPlaying, getAudioEl]);

  // Periodic audio drift correction (not per-frame)
  useEffect(() => {
    if (!isPlaying || audioEntries.length === 0) return;
    const id = setInterval(() => {
      for (const entry of audioEntries) {
        const { clip: aClip, asset: aAsset } = entry;
        const el = audioElsRef.current.get(aAsset.id);
        if (!el || el.paused) continue;
        const expected = currentTimeRef.current - aClip.startTime + aClip.trimStart;
        if (Math.abs(el.currentTime - expected) > 0.3) {
          el.currentTime = expected;
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [isPlaying, audioEntries]);

  useEffect(() => {
    return () => {
      audioElsRef.current.forEach((el) => {
        el.pause();
        el.src = '';
      });
      audioElsRef.current.clear();
    };
  }, []);

  const showAudioOnly = !asset && audioEntries.length > 0;
  const hasVisibleVideo = asset?.type === 'video' || (isPlaying && lastVisibleUrlRef.current);

  return (
    <div className="preview-player">
      <div className="preview-player__media">
        {!asset && !showAudioOnly && !hasVisibleVideo && (
          <span className="text-tertiary">Select or drag a clip to preview</span>
        )}
        {asset?.type === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={toFileUrl(asset.fileRef || asset.url)} alt={asset.name} />
        )}
        {/* Video pool container — videos stacked via position:absolute + z-index */}
        <div
          ref={containerRef}
          style={
            hasVisibleVideo && !showTrimVideo
              ? { position: 'relative', width: '100%', height: '100%' }
              : { display: 'none' }
          }
        />
        {/* Trim preview video */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={trimVideoRef}
          playsInline
          muted
          style={showTrimVideo ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } : { display: 'none' }}
        />
        {showAudioOnly && (
          <div className="preview-player__audio-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" /></svg>
            <span className="text-tertiary" style={{ marginTop: 8 }}>{audioEntries[0].asset.name}</span>
          </div>
        )}
      </div>

      <div className="preview-player__transport">
        <button className="preview-player__play-btn" onClick={onPlayPause}>
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8V4z" /></svg>
          )}
        </button>
        <span className="preview-player__timecode">{formatTimecode(currentTime)}</span>
        <div className="preview-player__scrub-wrapper">
          <input
            className="preview-player__scrub"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={currentTime}
            onChange={(e) => onTimeUpdate(parseFloat(e.target.value))}
          />
        </div>
        <span className="preview-player__timecode">{formatTimecode(duration)}</span>
      </div>
    </div>
  );
}
