import type { DirectorStagingMap } from '@/types/director';
import { toFileUrl } from '@/lib/utils/file-url';

export function captureVideoFrame(video: HTMLVideoElement | null): string | null {
  if (!video || video.readyState < 2 || video.videoWidth < 1) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}

interface DirectorStagingFrameProps {
  staging?: DirectorStagingMap;
  canCapture: boolean;
  onSetFrame: () => void;
  onMakeDiagram: () => void;
  onFetchDiagram?: () => void;
  onScope: (scope: 'clip' | 'scene') => void;
}

export function DirectorStagingFrame({
  staging,
  canCapture,
  onSetFrame,
  onMakeDiagram,
  onFetchDiagram,
  onScope,
}: DirectorStagingFrameProps) {
  const scope = staging?.scope ?? 'clip';
  const busy = staging?.status === 'generating';
  const sourceUrl = toFileUrl(staging?.sourceFrameUrl);
  const diagramUrl = toFileUrl(staging?.diagramUrl);
  const hasFrame = Boolean(sourceUrl);
  const makeLabel = busy
    ? 'Drawing map…'
    : hasFrame
      ? 'Make blocking map'
      : 'Set a frame first';
  const missedUrl = Boolean(staging?.error && /media URL|missed the image URL|Load from Higgsfield/i.test(staging.error));
  const hint = busy
    ? 'drawing…'
    : staging?.error
      ? 'needs Higgsfield pull'
      : diagramUrl
        ? 'map ready'
        : hasFrame
          ? 'frame set'
          : 'from a liked take';

  return (
    <details className="dsl-section dstage-section">
      <summary className="dsl-section-head">
        <span className="dsl-tw" aria-hidden />
        <span className="dsl-section-title">Frame · map</span>
        {busy && <span className="dgen-busy-dot" aria-hidden />}
        <span className="director-tab__meta">{hint}</span>
      </summary>
      <div className="dgen-section-body dstage">
        <div className="dstage-thumbs">
          <Still label="Frame" url={sourceUrl} empty="Pause a take you like, then Set as frame." />
          <Still label="Map" url={diagramUrl} empty={busy ? 'Higgsfield is drawing the schematic…' : 'The outline diagram lands here.'} />
        </div>
        <div className="dstage-actions">
          <button
            type="button"
            className="director-tab__btn"
            disabled={!canCapture}
            title={canCapture ? 'Capture the current viewer frame as the composition source' : 'Generate a take first'}
            onClick={onSetFrame}
          >
            Set as frame
          </button>
          <button
            type="button"
            className={`director-tab__btn director-tab__btn--accent${busy ? ' director-tab__btn--busy' : ''}`}
            disabled={!hasFrame || busy}
            title="Send the liked frame to Higgsfield as a tig-diagram schematic"
            onClick={onMakeDiagram}
          >
            {busy && <span className="dgen-busy-dot" aria-hidden />}
            {makeLabel}
          </button>
          {onFetchDiagram && (
            <button
              type="button"
              className="director-tab__btn"
              disabled={busy}
              title="Pull a completed Nano Banana map from Higgsfield if CineGen missed the URL"
              onClick={onFetchDiagram}
            >
              {busy ? 'Loading…' : 'Load from Higgsfield'}
            </button>
          )}
          <div className="dgen-seg" role="group" aria-label="Apply diagram to">
            <button
              type="button"
              className={`dgen-seg-btn${scope === 'clip' ? ' dgen-seg-btn--on' : ''}`}
              onClick={() => onScope('clip')}
            >
              This clip
            </button>
            <button
              type="button"
              className={`dgen-seg-btn${scope === 'scene' ? ' dgen-seg-btn--on' : ''}`}
              onClick={() => onScope('scene')}
            >
              Whole scene
            </button>
          </div>
        </div>
        {staging?.error && <p className="director-tab__warn">{staging.error}</p>}
        <p className="director-tab__meta">
          {missedUrl
            ? 'The map is already on Higgsfield — Load from Higgsfield pulls the outline into this clip.'
            : 'The map is geometry only — Higgsfield Nano Banana draws the outline, then Generate attaches it last so the photo refs keep the look.'}
        </p>
      </div>
    </details>
  );
}

function Still({ label, url, empty }: { label: string; url: string; empty: string }) {
  return (
    <div className="dstage-still">
      <span className="dsl-scenefield-label">{label}</span>
      {url ? <img src={url} alt={label} /> : <span className="director-tab__meta">{empty}</span>}
    </div>
  );
}
