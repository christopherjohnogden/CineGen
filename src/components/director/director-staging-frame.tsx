import type { RefObject } from 'react';
import type { DirectorFraming, DirectorStagingMap } from '@/types/director';
import { toFileUrl } from '@/lib/utils/file-url';
import { DirectorFramingBoard } from './director-framing-board';
import { grammarSizeLabel } from '@/lib/director/craft/coverage';

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
  framings: DirectorFraming[];
  boundId?: string;
  boundName?: string;
  query: string;
  onQuery: (value: string) => void;
  onPickFraming: (id: string) => void;
  onClearFraming?: () => void;
  onKeepFraming?: () => void;
  onCancel?: () => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  detailsRef?: RefObject<HTMLDetailsElement | null>;
  canCapture: boolean;
  onSetFrame: () => void;
  onMakeDiagram: () => void;
  onFetchDiagram?: () => void;
  onScope: (scope: 'clip' | 'scene') => void;
}

export function DirectorStagingFrame({
  staging,
  framings,
  boundId,
  boundName,
  query,
  onQuery,
  onPickFraming,
  onClearFraming,
  onKeepFraming,
  onCancel,
  searchRef,
  detailsRef,
  canCapture,
  onSetFrame,
  onMakeDiagram,
  onFetchDiagram,
  onScope,
}: DirectorStagingFrameProps) {
  const scope = staging?.scope ?? 'clip';
  const sourceUrl = toFileUrl(staging?.sourceFrameUrl);
  const diagramUrl = toFileUrl(staging?.diagramUrl);
  const hasFrame = Boolean(sourceUrl);
  const hasMap = Boolean(diagramUrl);
  const busy = staging?.status === 'generating' && !hasMap;
  const waiting = staging?.status === 'generating';
  const makeLabel = waiting
    ? 'Drawing map…'
    : hasFrame
      ? (hasMap ? 'Redraw map' : 'Make blocking map')
      : 'Set a frame first';
  const missedUrl = Boolean(staging?.error && /media URL|missed the image URL|Load from Higgsfield/i.test(staging.error));
  const grabSize = grammarSizeLabel(staging?.sourceLook?.grammar);
  const grabShot = staging?.sourceBindKey && staging.sourceBindKey !== 'full'
    ? `S${staging.sourceBindKey}${grabSize ? ` · ${grabSize}` : ''}`
    : undefined;
  const hint = waiting && !hasMap
    ? 'drawing…'
    : staging?.error
      ? 'needs Higgsfield pull'
      : grabShot
        ? `grabbed ${grabShot}`
        : boundName
        ? boundName
        : hasMap
          ? `${framings.length} saved`
          : hasFrame
            ? 'frame set'
            : framings.length > 0
              ? `${framings.length} saved`
              : 'from a liked take';

  return (
    <details ref={detailsRef} className="dsl-section dstage-section">
      <summary className="dsl-section-head">
        <span className="dsl-tw" aria-hidden />
        <span className="dsl-section-title">Frame · map</span>
        {waiting && <span className="dgen-busy-dot" aria-hidden />}
        <span className="director-tab__meta">{hint}</span>
      </summary>
      <div className="dgen-section-body dstage">
        <div className="dstage-thumbs">
          <Still label={grabShot ? `Frame · ${grabShot}` : 'Frame'} url={sourceUrl} empty="Pause a take you like, then Set as frame." />
          <Still label="Map" url={diagramUrl} empty={waiting ? 'Higgsfield is drawing the schematic…' : 'The outline diagram lands here.'} />
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
            className={`director-tab__btn director-tab__btn--accent${waiting ? ' director-tab__btn--busy' : ''}`}
            disabled={!hasFrame || busy}
            title="Send the liked frame to Higgsfield as a tig-diagram schematic"
            onClick={onMakeDiagram}
          >
            {waiting && <span className="dgen-busy-dot" aria-hidden />}
            {makeLabel}
          </button>
          {onFetchDiagram && (
            <button
              type="button"
              className="director-tab__btn"
              title="Pull a completed Nano Banana map from Higgsfield if CineGen missed the URL"
              onClick={onFetchDiagram}
            >
              {waiting ? 'Loading…' : 'Load from Higgsfield'}
            </button>
          )}
          {waiting && onCancel && (
            <button type="button" className="director-tab__btn" onClick={onCancel}>
              Cancel wait
            </button>
          )}
          {onKeepFraming && hasMap && !boundId && (
            <button
              type="button"
              className="director-tab__btn"
              title="Keep this map on the storyboard so other shots can reuse it"
              onClick={onKeepFraming}
            >
              Save to storyboard
            </button>
          )}
          {onClearFraming && (hasFrame || hasMap || boundId) && (
            <button
              type="button"
              className="director-tab__btn"
              title="Remove the liked frame and blocking map from this shot"
              onClick={onClearFraming}
            >
              Clear this shot
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
        <DirectorFramingBoard
          framings={framings}
          boundId={boundId}
          query={query}
          onQuery={onQuery}
          onPick={onPickFraming}
          searchRef={searchRef}
        />
        <p className="director-tab__meta">
          {missedUrl
            ? 'The map is already on Higgsfield — Load from Higgsfield pulls the outline into this clip.'
            : waiting && hasMap
              ? 'The map is done. Save to storyboard (or wait) — Load from Higgsfield if the wait is stuck.'
              : 'Pause on the frame you like — on Full, that playhead picks S1 / S2 / S3 from the shot timings. Click a saved card to make this shot match it.'}
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
