import { useEffect, useId, useRef, useState } from 'react';
import { readAudioPreview, type AudioPreview } from '@/lib/studio/audio-preview';
import { toFileUrl } from '@/lib/utils/file-url';

interface Props {
  url: string;
  name: string;
  onRemove?: () => void;
  removeTestId?: string;
  onPreview?: () => void;
  thumbnailLayout?: 'dock' | 'inline';
  onDuration?: (duration: number) => void;
}

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function StudioAudioReference(props: Props) {
  if (props.onPreview) return <AudioReferenceThumbnail {...props} onPreview={props.onPreview} />;
  // A replaced source gets fresh playback/preview state, even with the same ID.
  return <AudioReferencePlayer key={props.url} {...props} />;
}

function AudioReferenceThumbnail({ name, onPreview, onRemove, removeTestId, thumbnailLayout = 'inline' }: Props & { onPreview: () => void }) {
  const docked = thumbnailLayout === 'dock';
  return <div className={`studio-audio-thumb ${docked ? 'space-studio__dock-ref' : 'space-studio__ref is-selected'}`} role="group" aria-label={`Audio reference: ${name}`}>
    <button type="button" className="space-studio__ref-preview" title={`Preview ${name}`} aria-label={`Preview ${name}`} aria-haspopup="dialog" onClick={onPreview}>
      <svg className="studio-audio-thumb__wave" viewBox="0 0 80 32" aria-hidden="true">
        <path d="M5 14v4m7-10v16m7-13v10m7-18v26m7-20v14m7-16v18m7-24v30m7-24v18m7-14v10m7-14v18m7-11v4" />
      </svg>
      <span className="studio-audio-thumb__name">{name}</span>
    </button>
    {onRemove && <button type="button" className={docked ? 'space-studio__dock-ref-clear' : 'space-studio__ref-remove'}
      aria-label={`Remove ${name}`} data-testid={removeTestId} onClick={onRemove}>×</button>}
  </div>;
}

function AudioReferencePlayer({ url, name, onRemove, removeTestId, onDuration }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const clipId = useId().replace(/:/g, '');
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [preview, setPreview] = useState<AudioPreview | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const source = toFileUrl(url);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    if (visible || !root.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const player = audio.current;
    const pauseOtherReference = (event: Event) => {
      if (event.target !== player && event.target instanceof HTMLAudioElement && event.target.hasAttribute('data-audio-reference')) {
        player?.pause();
      }
    };
    document.addEventListener('play', pauseOtherReference, true);
    return () => {
      document.removeEventListener('play', pauseOtherReference, true);
      if (player && !player.paused) player.pause();
    };
  }, []);

  useEffect(() => {
    // Decode only visible, short references; long recordings still play/seek.
    if (!visible || duration <= 0 || duration > 180) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void readAudioPreview(source, controller.signal).then(result => {
      if (!controller.signal.aborted) setPreview(result);
    }).catch(() => {
      // A missing waveform must never prevent using or auditioning the file.
    }).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [visible, source, duration]);

  async function togglePlayback() {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) { player.pause(); return; }
    setError(false);
    if (player.error) player.load();
    try {
      await player.play();
      if (!player.isConnected) player.pause();
    } catch {
      if (player.isConnected) setError(true);
    }
  }

  function updateDuration() {
    const seconds = audio.current?.duration;
    if (seconds && Number.isFinite(seconds)) { setDuration(seconds); onDuration?.(seconds); }
  }

  return (
    <div ref={root} className={`studio-audio-ref${playing ? ' is-playing' : ''}`} role="group" aria-label={`Audio reference: ${name}`}>
      <div className="studio-audio-ref__head">
        <span className="studio-audio-ref__name" title={name}>{name}</span>
        {onRemove && <button type="button" className="studio-audio-ref__remove" aria-label={`Remove ${name}`} data-testid={removeTestId} onClick={onRemove}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" /></svg>
        </button>}
      </div>
      <div className="studio-audio-ref__player">
        <button type="button" className="studio-audio-ref__play" aria-label={`${playing ? 'Pause' : 'Play'} ${name}`} onClick={() => void togglePlayback()}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            {playing ? <path d="M6 5h3v10H6zm5 0h3v10h-3z" /> : <path d="m7 4 9 6-9 6z" />}
          </svg>
        </button>
        <div className="studio-audio-ref__track">
          <div className="studio-audio-ref__wave" data-waveform={preview ? 'ready' : 'placeholder'}>
            {preview ? (
              <svg viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden="true">
                <defs><clipPath id={clipId}><rect width={160 * progress} height="28" /></clipPath></defs>
                <g fill="currentColor" opacity=".5">{preview.peaks.map((peak, index) => <rect key={index} x={index * 4} y={14 - Math.max(2, peak * 26) / 2} width="2.5" height={Math.max(2, peak * 26)} rx="1.25" />)}</g>
                <g fill="currentColor" clipPath={`url(#${clipId})`}>{preview.peaks.map((peak, index) => <rect key={index} x={index * 4} y={14 - Math.max(2, peak * 26) / 2} width="2.5" height={Math.max(2, peak * 26)} rx="1.25" />)}</g>
              </svg>
            ) : (
              <svg viewBox="0 0 160 28" aria-hidden="true" className="studio-audio-ref__wave-icon">
                <path d="M2 14h44m68 0h44M54 11v6m7-11v16m7-13v10m7-17v24m7-20v16m7-13v10m7-14v18m7-12v6" />
              </svg>
            )}
            <input type="range" min="0" max={duration || 1} step="0.05" value={currentTime} disabled={!duration || error}
              aria-label={`Seek ${name}`} aria-valuetext={`${timeLabel(currentTime)} of ${timeLabel(duration)}`}
              onChange={event => {
                const next = Number(event.target.value);
                if (audio.current) audio.current.currentTime = next;
                setCurrentTime(next);
              }} />
          </div>
          <div className="studio-audio-ref__meta">
            <span>{error ? 'Preview unavailable' : 'Audio reference'}</span>
            <span>{duration > 0 ? `${currentTime > 0 || playing ? `${timeLabel(currentTime)} / ` : ''}${timeLabel(duration)}` : '—:—'}</span>
          </div>
        </div>
      </div>
      <audio ref={audio} data-audio-reference="" src={visible ? source : undefined} preload="metadata"
        onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => { setPlaying(true); setError(false); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onError={() => { setError(true); setPlaying(false); }} />
    </div>
  );
}
