import { useCallback, useEffect, useRef, useState } from 'react';
import { clampRange, type TrimRange } from '@/lib/studio/trim';

interface TrimStripProps {
  sourceUrl: string;
  duration: number;
  range: TrimRange;
  onChange: (range: TrimRange, moved: 'start' | 'end') => void;
  onScrub?: (seconds: number) => void;
}

const FRAME_COUNT = 8;

/**
 * The filmstrip scrubber: thumbnails across the clip with a draggable start and
 * end handle. Frames are grabbed in the renderer from a detached <video> rather
 * than through the media worker, because a scrubber wants something on screen
 * immediately and a missing thumbnail is cosmetic — the range still works.
 */
export function TrimStrip({ sourceUrl, duration, range, onChange, onScrub }: TrimStripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const dragRef = useRef<'start' | 'end' | null>(null);

  useEffect(() => {
    if (!sourceUrl || duration <= 0) return undefined;
    let cancelled = false;
    const video = document.createElement('video');
    // Must be set before src, and the local-media scheme has to answer with CORS
    // headers, or the canvas is tainted and toDataURL throws instead of drawing.
    video.crossOrigin = 'anonymous';
    video.src = sourceUrl;
    video.muted = true;
    video.preload = 'auto';
    video.load();
    const canvas = document.createElement('canvas');
    const collected: string[] = [];

    const grab = (index: number) => {
      if (cancelled || index >= FRAME_COUNT) return;
      video.currentTime = (duration / FRAME_COUNT) * index + duration / (FRAME_COUNT * 2);
    };

    const onSeeked = () => {
      if (cancelled) return;
      const width = 160;
      const height = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * width));
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, width, height);
        try {
          collected.push(canvas.toDataURL('image/jpeg', 0.6));
        } catch {
          // A cross-origin source taints the canvas; the strip degrades to bars.
          cancelled = true;
          return;
        }
        setFrames([...collected]);
      }
      grab(collected.length);
    };

    const onLoaded = () => grab(0);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
      video.src = '';
    };
  }, [sourceUrl, duration]);

  const secondsAt = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track || duration <= 0) return 0;
    const box = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)));
    return ratio * duration;
  }, [duration]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onMove = (event: PointerEvent) => {
      const handle = dragRef.current;
      if (!handle) return;
      const seconds = secondsAt(event.clientX);
      const next = handle === 'start'
        ? { ...range, startSec: seconds }
        : { ...range, endSec: seconds };
      onChange(clampRange(next, duration, handle), handle);
      onScrub?.(seconds);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [duration, onChange, onScrub, range, secondsAt]);

  const startPct = duration > 0 ? (range.startSec / duration) * 100 : 0;
  const endPct = duration > 0 ? (range.endSec / duration) * 100 : 100;

  return (
    <div className="trim-strip" ref={trackRef} data-testid="trim-strip">
      <div className="trim-strip__frames">
        {frames.length > 0
          ? frames.map((frame, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={index} src={frame} alt="" draggable={false} />
          ))
          : Array.from({ length: FRAME_COUNT }, (_, index) => <span key={index} />)}
      </div>

      {/* Everything outside the range dims, so the selection reads at a glance. */}
      <div className="trim-strip__shade" style={{ left: 0, width: `${startPct}%` }} />
      <div className="trim-strip__shade" style={{ left: `${endPct}%`, right: 0 }} />

      <div
        className="trim-strip__handle trim-strip__handle--start"
        style={{ left: `${startPct}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Trim start"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={range.startSec}
        data-testid="trim-handle-start"
        onPointerDown={() => { dragRef.current = 'start'; }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const delta = event.key === 'ArrowLeft' ? -1 : 1;
          onChange(clampRange({ ...range, startSec: range.startSec + delta }, duration, 'start'), 'start');
        }}
      />
      <div
        className="trim-strip__handle trim-strip__handle--end"
        style={{ left: `${endPct}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Trim end"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={range.endSec}
        data-testid="trim-handle-end"
        onPointerDown={() => { dragRef.current = 'end'; }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const delta = event.key === 'ArrowLeft' ? -1 : 1;
          onChange(clampRange({ ...range, endSec: range.endSec + delta }, duration, 'end'), 'end');
        }}
      />
    </div>
  );
}
