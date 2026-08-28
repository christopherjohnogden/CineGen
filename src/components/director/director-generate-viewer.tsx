import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { Asset } from '@/types/project';
import type { DirectorTake } from '@/types/director';
import { generateViewerMessage, isDirectorTakeLive } from '@/lib/director/generate';
import { toFileUrl } from '@/lib/utils/file-url';

interface DirectorGenerateViewerProps {
  asset?: Asset;
  take?: DirectorTake;
  variantLabel: string;
  adapterLabel: string;
  providerLabel?: string;
  clipLabel: string;
  videoRef?: Ref<HTMLVideoElement>;
  onFetchTake?: () => void;
  fetchingTake?: boolean;
}

export function DirectorGenerateViewer({
  asset,
  take,
  variantLabel,
  adapterLabel,
  providerLabel,
  clipLabel,
  videoRef,
  onFetchTake,
  fetchingTake,
}: DirectorGenerateViewerProps) {
  const sources = useMemo(() => Array.from(new Set(
    [asset?.fileRef, asset?.url, asset?.sourceUrl]
      .map((source) => toFileUrl(source))
      .filter(Boolean),
  )), [asset?.fileRef, asset?.sourceUrl, asset?.url]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const live = isDirectorTakeLive(take);
  const elapsedSeconds = useRenderElapsed(take?.createdAt, live);

  useEffect(() => {
    setSourceIndex(0);
  }, [asset?.id, sources]);

  const assetSource = sources[sourceIndex];

  if (assetSource) {
    return (
      <div className="director-tab__viewer dgen-viewer">
        <video
          key={assetSource}
          ref={videoRef}
          src={assetSource}
          controls
          playsInline
          preload="metadata"
          onError={() => setSourceIndex((current) => current + 1)}
        />
      </div>
    );
  }

  if (sources.length > 0) {
    return (
      <div className="director-tab__viewer dgen-viewer">
        <span className="director-tab__empty director-tab__empty--err dgen-viewer-error">
          This take could not be played.
          <button type="button" onClick={() => setSourceIndex(0)}>Try again</button>
        </span>
      </div>
    );
  }

  if (live && take) {
    const takeCode = `T${String(take.number).padStart(2, '0')}`;
    const elapsedLabel = formatElapsed(elapsedSeconds);
    const sourceLabel = providerLabel?.trim() || adapterLabel;
    return (
      <div className="director-tab__viewer dgen-viewer dgen-viewer--live" aria-busy="true" aria-live="polite">
        <div className="dgen-live" aria-hidden>
          <span className="dgen-live-scan" />
          <span className="dgen-live-corner dgen-live-corner--tl" />
          <span className="dgen-live-corner dgen-live-corner--tr" />
          <span className="dgen-live-corner dgen-live-corner--bl" />
          <span className="dgen-live-corner dgen-live-corner--br" />
        </div>
        <div className="dgen-live-hud">
          <span className="dgen-live-rec"><span className="dgen-live-rec-dot" /> Rec</span>
          <span>{adapterLabel}</span>
        </div>
        <div className="dgen-live-slate">
          <span className="dgen-live-take">{takeCode}</span>
          <span className="dgen-live-meta">{variantLabel}</span>
          <span className="dgen-live-bar" role="progressbar" aria-valuetext={`Rendering ${takeCode}`} />
          <span className="dgen-live-status">
            {take.status === 'queued' ? 'Queued' : 'Rendering take'}
            <time
              className="dgen-live-elapsed"
              dateTime={elapsedDuration(elapsedSeconds)}
              aria-label={`Elapsed render time ${spokenElapsed(elapsedSeconds)}`}
              aria-live="off"
            >
              Elapsed · {elapsedLabel}
            </time>
          </span>
          {onFetchTake && (
            <button
              type="button"
              className="dgen-live-fetch"
              onClick={onFetchTake}
              disabled={fetchingTake}
            >
              {fetchingTake ? `Loading from ${sourceLabel}…` : `Load from ${sourceLabel}`}
            </button>
          )}
        </div>
        <span className="dgen-live-clip">{clipLabel}</span>
      </div>
    );
  }

  return (
    <div className="director-tab__viewer dgen-viewer">
      <span className={`director-tab__empty${take?.status === 'failed' ? ' director-tab__empty--err' : ''}`}>
        {generateViewerMessage(take, false)}
      </span>
    </div>
  );
}

function elapsedFrom(startedAt: string | undefined, now: number): number {
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor((now - parsed) / 1_000));
}

function useRenderElapsed(startedAt: string | undefined, active: boolean): number {
  const [, setTick] = useState(0);
  const fallback = useRef({ key: startedAt, value: Date.now() });
  if (fallback.current.key !== startedAt) {
    fallback.current = { key: startedAt, value: Date.now() };
  }

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setTick((current) => (current + 1) % 1_000_000), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return 0;
  const persisted = elapsedFrom(startedAt, Date.now());
  if (startedAt && Number.isFinite(Date.parse(startedAt))) return persisted;
  return Math.max(0, Math.floor((Date.now() - fallback.current.value) / 1_000));
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function elapsedDuration(totalSeconds: number): string {
  return `PT${totalSeconds}S`;
}

function spokenElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : '',
    minutes > 0 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : '',
    `${seconds} second${seconds === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' ');
}
