import { useEffect, useMemo, useState, type Ref } from 'react';
import type { Asset } from '@/types/project';
import type { DirectorTake } from '@/types/director';
import { generateViewerMessage, isDirectorTakeLive } from '@/lib/director/generate';
import { toFileUrl } from '@/lib/utils/file-url';

interface DirectorGenerateViewerProps {
  asset?: Asset;
  take?: DirectorTake;
  variantLabel: string;
  adapterLabel: string;
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

  if (isDirectorTakeLive(take) && take) {
    const takeCode = `T${String(take.number).padStart(2, '0')}`;
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
          <span className="dgen-live-status">Rendering take</span>
          {onFetchTake && (
            <button
              type="button"
              className="dgen-live-fetch"
              onClick={onFetchTake}
              disabled={fetchingTake}
            >
              {fetchingTake ? 'Loading from Higgsfield…' : 'Load from Higgsfield'}
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
