import type { Ref } from 'react';
import type { DirectorTake } from '@/types/director';
import { generateViewerMessage, isDirectorTakeLive } from '@/lib/director/generate';

interface DirectorGenerateViewerProps {
  assetUrl?: string;
  take?: DirectorTake;
  variantLabel: string;
  adapterLabel: string;
  clipLabel: string;
  videoRef?: Ref<HTMLVideoElement>;
  onFetchTake?: () => void;
  fetchingTake?: boolean;
}

export function DirectorGenerateViewer({
  assetUrl,
  take,
  variantLabel,
  adapterLabel,
  clipLabel,
  videoRef,
  onFetchTake,
  fetchingTake,
}: DirectorGenerateViewerProps) {
  if (assetUrl) {
    return (
      <div className="director-tab__viewer dgen-viewer">
        <video ref={videoRef} src={assetUrl} controls crossOrigin="anonymous" />
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
