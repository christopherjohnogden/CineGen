import { useEffect, useState, type RefObject } from 'react';
import type { DirectorClip } from '@/types/director';
import {
  beatGrammarsForClip, beatSetupColors, grammarSizeLabel, SETUP_SWATCH_COUNT,
} from '@/lib/director/craft/coverage';
import {
  beatAtPlayhead, beatTimeRanges, clipTimeForVideoTime, clipTimelineLength, clipTrackLength, videoTimeForBeat,
} from '@/lib/director/framing-reserve';

interface DirectorShotTimelineProps {
  clip: DirectorClip;
  videoRef: RefObject<HTMLVideoElement | null>;
  src?: string;
  onSeekShot: (beatN: number) => void;
}

export function DirectorShotTimeline({ clip, videoRef, src, onSeekShot }: DirectorShotTimelineProps) {
  const ranges = beatTimeRanges(clip);
  const clipLen = clipTimelineLength(clip);
  const trackLen = clipTrackLength(clip);
  const grammars = beatGrammarsForClip(clip.beats);
  const setups = beatSetupColors(clip.beats);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const sync = () => {
      setCurrent(video.currentTime);
      setDuration(video.duration);
    };
    const tick = () => {
      sync();
      if (!video.paused && !video.ended) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onStop = () => {
      cancelAnimationFrame(raf);
      sync();
    };
    sync();
    video.addEventListener('play', onPlay);
    video.addEventListener('playing', onPlay);
    video.addEventListener('pause', onStop);
    video.addEventListener('ended', onStop);
    video.addEventListener('seeked', sync);
    video.addEventListener('loadedmetadata', sync);
    video.addEventListener('durationchange', sync);
    if (!video.paused && !video.ended) onPlay();
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', onPlay);
      video.removeEventListener('pause', onStop);
      video.removeEventListener('ended', onStop);
      video.removeEventListener('seeked', sync);
      video.removeEventListener('loadedmetadata', sync);
      video.removeEventListener('durationchange', sync);
    };
  }, [videoRef, src]);

  if (ranges.length < 2 || clipLen <= 0 || trackLen <= 0) return null;
  const mediaLen = duration > 0 && Number.isFinite(duration) ? duration : clipLen;
  const clipTime = clipTimeForVideoTime(clip, current, mediaLen);
  const liveN = beatAtPlayhead(clip, clipTime)?.n;
  const playPct = Math.min(100, Math.max(0, (clipTime / trackLen) * 100));

  return (
    <div className="dgen-ruler" role="group" aria-label="Shot timeline">
      <div className="dgen-ruler-track">
        {ranges.map((row, index) => {
          const beat = clip.beats[index];
          const size = grammarSizeLabel(grammars[index]);
          const setup = setups[index];
          const span = Math.max(row.to - row.from, 0.5);
          const on = row.n === liveN;
          return (
            <button
              key={row.n}
              type="button"
              className={`dgen-ruler-shot${on ? ' dgen-ruler-shot--on' : ''}${setup != null ? ' dgen-ruler-shot--setup' : ''}`}
              data-setup={setup != null ? String(setup % SETUP_SWATCH_COUNT) : undefined}
              style={{ flexGrow: span }}
              title={`S${row.n}${size ? ` · ${size}` : ''} · ${beat?.from ?? ''}–${beat?.to ?? ''}`}
              onClick={() => {
                const video = videoRef.current;
                if (video && Number.isFinite(video.duration) && video.duration > 0) {
                  video.currentTime = videoTimeForBeat(clip, row.n, video.duration);
                }
                onSeekShot(row.n);
              }}
            >
              S{row.n}{size ? ` · ${size}` : ''}
            </button>
          );
        })}
        <span className="dgen-ruler-playwrap" style={{ transform: `translateX(${playPct}%)` }} aria-hidden>
          <span className="dgen-ruler-play" />
        </span>
      </div>
    </div>
  );
}
