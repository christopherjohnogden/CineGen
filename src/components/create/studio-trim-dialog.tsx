import { useCallback, useEffect, useRef, useState } from 'react';
import { TrimStrip } from './nodes/trim-strip';
import {
  clampRange,
  formatTimecode,
  localPathFor,
  parseTimecode,
  trimmedDuration,
} from '@/lib/studio/trim';
import { toFileUrl } from '@/lib/utils/file-url';

interface StudioTrimDialogProps {
  sourceUrl: string;
  name: string;
  projectId: string;
  onCancel: () => void;
  onApply: (result: { url: string; startSec: number; endSec: number }) => void;
}

/**
 * Trimming a reference in the Studio. The canvas has room for a Trim node; the
 * composer does not, so the same controls come up over the feed and hand the
 * shortened clip straight back to the reference that opened it.
 */
export function StudioTrimDialog({ sourceUrl, name, projectId, onCancel, onApply }: StudioTrimDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState({ startSec: 0, endSec: 0 });
  const [startText, setStartText] = useState('00:00:00');
  const [endText, setEndText] = useState('00:00:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const commitRange = useCallback((next: { startSec: number; endSec: number }, moved: 'start' | 'end') => {
    const clamped = clampRange(next, duration, moved);
    setRange(clamped);
    setStartText(formatTimecode(clamped.startSec));
    setEndText(formatTimecode(clamped.endSec));
  }, [duration]);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    setDuration(video.duration);
    setRange({ startSec: 0, endSec: video.duration });
    setEndText(formatTimecode(video.duration));
  }, []);

  const apply = useCallback(async () => {
    const inputPath = localPathFor(sourceUrl);
    if (!inputPath) {
      setError('Trimming needs the video on disk. Import it into the project first.');
      return;
    }
    if (!window.electronAPI?.media?.trimVideo) {
      setError('Trimming is only available in the desktop app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.media.trimVideo({
        inputPath,
        startSec: range.startSec,
        endSec: range.endSec,
        projectId,
      });
      if (!result?.outputPath) {
        setError('Could not render the trim.');
        return;
      }
      onApply({ url: toFileUrl(result.outputPath), startSec: range.startSec, endSec: range.endSec });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not render the trim.');
    } finally {
      setBusy(false);
    }
  }, [onApply, projectId, range.endSec, range.startSec, sourceUrl]);

  return (
    <div className="studio-trim" role="dialog" aria-modal="true" aria-label={`Trim ${name}`} data-testid="studio-trim-dialog">
      <div className="studio-trim__panel">
        <header>
          <strong>Trim reference</strong>
          <span>{name}</span>
        </header>

        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={sourceUrl}
          className="studio-trim__video"
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (!video || range.endSec <= range.startSec) return;
            if (video.currentTime > range.endSec) {
              video.currentTime = range.startSec;
              video.pause();
            }
          }}
        />

        <TrimStrip
          sourceUrl={sourceUrl}
          duration={duration}
          range={range}
          onChange={commitRange}
          onScrub={(seconds) => {
            const video = videoRef.current;
            if (video) video.currentTime = seconds;
          }}
        />

        <div className="trim-node__fields">
          <label>
            <span>Start</span>
            <input
              value={startText}
              onChange={(event) => setStartText(event.target.value)}
              onBlur={() => {
                const parsed = parseTimecode(startText);
                if (parsed === null) setStartText(formatTimecode(range.startSec));
                else commitRange({ ...range, startSec: parsed }, 'start');
              }}
              aria-label="Trim start"
            />
          </label>
          <label>
            <span>End</span>
            <input
              value={endText}
              onChange={(event) => setEndText(event.target.value)}
              onBlur={() => {
                const parsed = parseTimecode(endText);
                if (parsed === null) setEndText(formatTimecode(range.endSec));
                else commitRange({ ...range, endSec: parsed }, 'end');
              }}
              aria-label="Trim end"
            />
          </label>
        </div>

        {error && <p className="trim-node__error">{error}</p>}

        <footer>
          <span className="studio-trim__length">{formatTimecode(trimmedDuration(range))} selected</span>
          <div>
            <button type="button" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="studio-trim__apply"
              data-testid="studio-trim-apply"
              disabled={busy || duration <= 0}
              onClick={() => void apply()}
            >
              {busy ? 'Trimming…' : 'Use trimmed clip'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
