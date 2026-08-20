import type { Asset } from '@/types/project';
import type { DirectorClip, DirectorShow, DirectorTake, IsolateVariant } from '@/types/director';
import {
  directorJobIsRunning, removeDirectorTake, selectedClip, selectedScene, setClipVariant, setHeroTake,
  updateDirectorClip,
} from '@/lib/director/director-state';
import {
  isDirectorTakeLive, preferredIsolateMode, runtimeSeconds, takeCountForShot,
  takesForVariant, takesGroupedForClip,
} from '@/lib/director/generate';
import { parseVariantKey, variantKey, variantTakeLabel } from '@/lib/director/slate';
import { DirectorTakesBoard } from './director-takes-board';
import { DirectorGenerateViewer } from './director-generate-viewer';
import {
  applyBeatDurations, compileClipBody, compileOptionsForShow, retimeClipToSeconds, validateClipTimings,
} from '@/lib/director/prompt-compiler';
import { isolatedPrompt } from '@/lib/director/isolate-prompt';
import { clipDisplayLabels } from '@/lib/director/shotlist';
import { getDirectorAdapter } from '@/lib/director/video-adapter';
import { DirectorClipCraft } from './director-clip-craft';

interface DirectorGenerateTabProps {
  show: DirectorShow;
  assets: Asset[];
  preflight: string;
  warnings: string[];
  selectedBeatN: number;
  onSelectBeat: (n: number) => void;
  onChange: (show: DirectorShow) => void;
  onGenerate: (scope: 'active' | 'queued' | 'scene') => void;
  onFetchTake?: () => void;
  fetchingTake?: boolean;
  onRewrite: (notes: string) => void;
  onKeepRewrite: () => void;
  onDiscardRewrite: () => void;
  onRemoveAsset?: (assetId: string) => void;
}

function activeBody(show: DirectorShow, clip: DirectorClip): string {
  const options = compileOptionsForShow(show, clip);
  const variant = clip.activeVariant;
  if (variant.kind === 'isolated') {
    return clip.bodyEdits[variantKey(variant)]
      || isolatedPrompt(clip, variant.beatN, variant.mode, {
        aspectRatio: show.aspectRatio,
        ...options,
      })
      || compileClipBody(clip, options);
  }
  return clip.bodyEdits.full || compileClipBody(clip, options);
}

export function DirectorGenerateTab(props: DirectorGenerateTabProps) {
  const { show, assets, warnings, selectedBeatN, onSelectBeat, onChange, onGenerate, onRewrite, onKeepRewrite, onDiscardRewrite, onRemoveAsset } = props;
  const clip = selectedClip(show);
  const adapter = getDirectorAdapter(show.adapterId);

  const patchClip = (updater: (current: DirectorClip) => DirectorClip) => {
    if (!clip) return;
    onChange(updateDirectorClip(show, clip.id, updater));
  };

  if (!clip) {
    return <div className="director-tab__stage"><p className="director-tab__empty">Select a clip in the rail to preview and generate takes.</p></div>;
  }

  const scene = show.scenes.find((entry) => entry.id === clip.sceneId) ?? selectedScene(show);
  const clipLabel = clipDisplayLabels(show.scenes, show.clips).get(clip.id);
  const key = variantKey(clip.activeVariant);
  const takes = takesForVariant(clip, key);
  const takeGroups = takesGroupedForClip(clip, key);
  const selectedTake = takes.find((take) => take.id === show.selectedTakeId) ?? takes[takes.length - 1];
  const fullTakeCount = takesForVariant(clip, 'full').length;
  const asset = assets.find((entry) => entry.id === selectedTake?.assetId);
  const timingError = validateClipTimings(clip);
  const compiled = adapter.buildRequest({ show, clip, variant: clip.activeVariant }).prompt;
  const variant = clip.activeVariant;
  const isolated = variant.kind === 'isolated';
  const beatN = isolated ? variant.beatN : (clip.beats.some((beat) => beat.n === selectedBeatN) ? selectedBeatN : clip.beats[0]?.n ?? 1);
  const beat = clip.beats.find((entry) => entry.n === beatN);
  const heldTakeCount = takesForVariant(clip, `${beatN}:held`).length;
  const nativeTakeCount = takesForVariant(clip, `${beatN}:native`).length;
  const queuedCount = show.clips.filter((entry) => entry.queued).length;
  const sceneClipCount = show.clips.filter((entry) => entry.sceneId === scene?.id && !entry.altOf).length;
  const thisLabel = clipLabel ?? 'clip';
  const generating = directorJobIsRunning(show, 'generate');
  const liveTake = clip.takes.find((entry) => isDirectorTakeLive(entry));
  const variantLabel = variantTakeLabel(clip, key);

  const setVariant = (next: IsolateVariant) => {
    const nextTakes = takesForVariant(clip, variantKey(next));
    const keep = nextTakes.find((take) => take.id === show.selectedTakeId)
      ?? nextTakes.find((take) => take.hero)
      ?? nextTakes[nextTakes.length - 1];
    onChange({
      ...setClipVariant(show, clip.id, next),
      selectedClipId: clip.id,
      selectedTakeId: keep?.id,
    });
  };
  const pickShot = (n: number) => {
    onSelectBeat(n);
    setVariant({ kind: 'isolated', beatN: n, mode: preferredIsolateMode(clip, n, isolated ? variant : undefined) });
  };
  const pickTake = (take: DirectorTake) => {
    const next = parseVariantKey(take.variantKey);
    if (next.kind === 'isolated') onSelectBeat(next.beatN);
    onChange({
      ...setClipVariant(show, clip.id, next),
      selectedClipId: clip.id,
      selectedTakeId: take.id,
    });
  };
  const deleteTake = (take: DirectorTake) => {
    onChange(removeDirectorTake(show, clip.id, take.id));
    if (take.assetId) onRemoveAsset?.(take.assetId);
  };

  return (
    <div className="director-tab__stage">
      <div className="dgen-cols">
        {/* ── LEFT: the production console ── */}
        <div className="dgen-left">
          <div className="dgen-head">
            <div className="dgen-head-id">
              {clipLabel && <span className="dsl-cid dgen-cid">{clipLabel}</span>}
              <div className="dgen-head-text">
                <span className="dgen-title">{clip.title}</span>
                <span className="director-tab__meta">
                  {scene?.label ?? 'Scene'} · {clip.seconds}s · {clip.beats.length === 1 ? 'held single' : `${clip.beats.length} shots`}
                  {typeof clip.fov === 'number' ? ` · ${clip.fov}° lens` : ''}
                </span>
              </div>
            </div>
            <div className="dgen-actions-col">
              <div className="dgen-actions">
                <button
                  type="button"
                  className={`director-tab__btn director-tab__btn--accent${generating ? ' director-tab__btn--busy' : ''}`}
                  onClick={() => onGenerate('active')}
                  disabled={generating}
                  title={generating ? 'Generating via Higgsfield CLI…' : `Generate this clip with ${adapter.label} (Higgsfield CLI)`}
                >
                  {generating ? (
                    <>
                      <span className="dgen-busy-dot" aria-hidden />
                      {liveTake ? `Rendering T${String(liveTake.number).padStart(2, '0')}` : 'Rendering…'}
                    </>
                  ) : (
                    `Generate ${thisLabel}${isolated ? ` · S${beatN}` : ''}`
                  )}
                </button>
                <span className="dgen-actions-rule" aria-hidden />
                <label className="dsl-queue dgen-queue" title="Queue this clip for batch generate">
                  <input
                    type="checkbox"
                    checked={Boolean(clip.queued)}
                    onChange={(event) => patchClip((current) => ({ ...current, queued: event.target.checked }))}
                  />
                  <span className="dsl-queue-box" aria-hidden />
                </label>
                <button
                  type="button"
                  className="director-tab__btn"
                  disabled={queuedCount === 0 || generating}
                  title={queuedCount === 0 ? 'Tick Queue on clips first — an empty queue does not generate the show' : `Generate ${queuedCount} queued clip${queuedCount === 1 ? '' : 's'}`}
                  onClick={() => onGenerate('queued')}
                >
                  Queued · {queuedCount}
                </button>
                <button
                  type="button"
                  className="director-tab__btn"
                  disabled={sceneClipCount === 0 || generating}
                  title={`Generate all ${sceneClipCount} clip${sceneClipCount === 1 ? '' : 's'} in ${scene?.label ?? 'this scene'}`}
                  onClick={() => onGenerate('scene')}
                >
                  Scene {scene?.number ?? ''}
                </button>
              </div>
              <span className="director-tab__meta dgen-actions-meta">
                {adapter.label} · {queuedCount} queued · Scene {scene?.number ?? '—'} · {sceneClipCount} clips · show {runtimeSeconds(show.clips)}s
              </span>
            </div>
          </div>
          {(timingError || warnings.length > 0) && (
            <div className="dgen-actions-msg">
              {timingError && <p className="director-tab__warn">{timingError}</p>}
              {warnings.map((warning) => <p key={warning} className="director-tab__warn">{warning}</p>)}
            </div>
          )}
          <div className="dgen-seg" role="group" aria-label="Variant">
            <button
              type="button"
              className={`dgen-seg-btn${!isolated ? ' dgen-seg-btn--on' : ''}`}
              onClick={() => setVariant({ kind: 'full' })}
            >
              Full multishot
              {fullTakeCount > 0 && <span className="dgen-seg-count">{fullTakeCount}</span>}
            </button>
            {clip.beats.map((entry) => {
              const shotTakes = takeCountForShot(clip, entry.n);
              return (
                <button
                  key={entry.n}
                  type="button"
                  className={`dgen-seg-btn${isolated && variant.beatN === entry.n ? ' dgen-seg-btn--on' : ''}`}
                  title={entry.text}
                  onClick={() => pickShot(entry.n)}
                >
                  S{entry.n}
                  {shotTakes > 0 && <span className="dgen-seg-count">{shotTakes}</span>}
                </button>
              );
            })}
          </div>
          {isolated && beat && (
            <div className="dgen-seg" role="group" aria-label="Isolation length">
              <button
                type="button"
                className={`dgen-seg-btn${variant.mode === 'held' ? ' dgen-seg-btn--on' : ''}`}
                onClick={() => setVariant({ kind: 'isolated', beatN, mode: 'held' })}
              >
                Held · {clip.seconds}s
                {heldTakeCount > 0 && <span className="dgen-seg-count">{heldTakeCount}</span>}
              </button>
              <button
                type="button"
                className={`dgen-seg-btn${variant.mode === 'native' ? ' dgen-seg-btn--on' : ''}`}
                onClick={() => setVariant({ kind: 'isolated', beatN, mode: 'native' })}
              >
                Native · {beat.dur}s
                {nativeTakeCount > 0 && <span className="dgen-seg-count">{nativeTakeCount}</span>}
              </button>
            </div>
          )}

          <DirectorGenerateViewer
            assetUrl={asset?.url}
            take={selectedTake}
            variantLabel={variantLabel}
            adapterLabel={adapter.label}
            clipLabel={`${thisLabel} · ${clip.title}`}
            onFetchTake={props.onFetchTake}
            fetchingTake={props.fetchingTake}
          />

          <DirectorTakesBoard
            groups={takeGroups}
            activeKey={key}
            selectedTakeId={selectedTake?.id}
            onSelectGroup={(next) => {
              if (next.kind === 'isolated') onSelectBeat(next.beatN);
              setVariant(next);
            }}
            onSelectTake={pickTake}
            onHeroTake={(takeId) => onChange(setHeroTake(show, clip.id, takeId))}
            onDeleteTake={deleteTake}
          />

          <div className="dgen-notes">
            <span className="dsl-scenefield-label">Director&rsquo;s notes — rewrite this variant</span>
            <textarea id="director-notes" placeholder="What to keep or change on the next rewrite of this take."
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onRewrite((event.currentTarget as HTMLTextAreaElement).value); } }} />
            <div className="director-tab__row">
              <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => { const field = document.getElementById('director-notes') as HTMLTextAreaElement | null; onRewrite(field?.value ?? ''); }}>Rewrite</button>
              <button type="button" className="director-tab__btn" onClick={onKeepRewrite} disabled={!clip.pendingRewrite}>Keep</button>
              <button type="button" className="director-tab__btn" onClick={onDiscardRewrite} disabled={!clip.pendingRewrite}>Discard</button>
            </div>
            {clip.pendingRewrite && <p className="director-tab__ok">Rewrite ready — Keep to store, Discard to revert.</p>}
          </div>
        </div>

        {/* ── RIGHT: the prompt stack ── */}
        <div className="dgen-right">
          <details className="dsl-section" open>
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Prompt</span>
              <span className="director-tab__meta">what this variant sends</span>
              <button
                type="button"
                className="director-tab__btn"
                style={{ marginLeft: 'auto' }}
                onClick={(event) => { event.preventDefault(); void navigator.clipboard.writeText(compiled); }}
              >
                Copy
              </button>
            </summary>
            <div className="dgen-section-body">
              <pre className="dsl-prompt dgen-prompt">{compiled}</pre>
            </div>
          </details>

          <details className="dsl-section">
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Edit body</span>
              <span className="director-tab__meta">{clip.bodyEdits[key] ? 'manually edited' : 'compiled'}</span>
            </summary>
            <div className="dgen-section-body">
              <textarea className="director-tab__prompt dgen-bodyedit" value={activeBody(show, clip)}
                onChange={(event) => patchClip((current) => ({ ...current, bodyEdits: { ...current.bodyEdits, [variantKey(current.activeVariant)]: event.target.value } }))} />
              <button type="button" className="director-tab__btn" onClick={() => patchClip((current) => { const next = { ...current.bodyEdits }; delete next[variantKey(current.activeVariant)]; return { ...current, bodyEdits: next }; })}>Reset to compiled</button>
            </div>
          </details>

          <details className="dsl-section">
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Shots</span>
              <span className="director-tab__meta">{clip.beats.length} · durations must sum to {clip.seconds}s</span>
            </summary>
            <div className="dgen-section-body">
              {clip.beats.map((entry) => (
                <div key={entry.n} className="dgen-shotedit">
                  <button
                    type="button"
                    className={`director-tab__iso${entry.n === beatN ? ' director-tab__iso--active' : ''}`}
                    title="Select this shot for isolation"
                    onClick={() => pickShot(entry.n)}
                  >
                    S{entry.n}
                  </button>
                  <input
                    type="number" min={1} value={entry.dur} className="dgen-shotedit-dur"
                    onChange={(event) => patchClip((current) => applyBeatDurations({ ...current, beats: current.beats.map((row) => row.n === entry.n ? { ...row, dur: Math.max(1, Number(event.target.value) || row.dur) } : row) }))}
                  />
                  <input
                    value={entry.text}
                    onChange={(event) => patchClip((current) => ({ ...current, beats: current.beats.map((row) => row.n === entry.n ? { ...row, text: event.target.value } : row) }))}
                  />
                </div>
              ))}
            </div>
          </details>

          <details className="dsl-section">
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Setup</span>
              <span className="director-tab__meta">title · length · subject · location</span>
            </summary>
            <div className="dgen-section-body director-tab__fields">
              <div className="dgen-two">
                <label className="dsl-scenefield">
                  <span className="dsl-scenefield-label">Title</span>
                  <input value={clip.title} onChange={(event) => patchClip((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label className="dsl-scenefield" style={{ maxWidth: 120 }}>
                  <span className="dsl-scenefield-label">Seconds</span>
                  <input type="number" min={1} value={clip.seconds} onChange={(event) => patchClip((current) => retimeClipToSeconds(current, Number(event.target.value) || current.seconds))} />
                </label>
              </div>
              <label className="dsl-scenefield">
                <span className="dsl-scenefield-label">Subject</span>
                <textarea value={clip.subject} onChange={(event) => patchClip((current) => ({ ...current, subject: event.target.value }))} />
              </label>
              <label className="dsl-scenefield">
                <span className="dsl-scenefield-label">Location</span>
                <textarea value={clip.location} onChange={(event) => patchClip((current) => ({ ...current, location: event.target.value }))} />
              </label>
            </div>
          </details>

          <details className="dsl-section">
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Craft</span>
              <span className="director-tab__meta">blocking · lens · acting · staging</span>
            </summary>
            <div className="dgen-section-body director-tab__fields">
              <DirectorClipCraft clip={clip} sceneLabel={scene?.label ?? 'scene'} aspectRatio={show.aspectRatio} onPatch={patchClip} />
            </div>
          </details>

          <details className="dsl-section">
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Style &amp; constraints</span>
              <span className="director-tab__meta">palette · failure locks · framing ref</span>
            </summary>
            <div className="dgen-section-body director-tab__fields">
              <label className="dsl-scenefield">
                <span className="dsl-scenefield-label">Style — 60/30/10</span>
                <textarea value={clip.style} onChange={(event) => patchClip((current) => ({ ...current, style: event.target.value }))} />
              </label>
              <label className="dsl-scenefield">
                <span className="dsl-scenefield-label">Constraints — the failures this shot invites</span>
                <textarea value={clip.constraints} onChange={(event) => patchClip((current) => ({ ...current, constraints: event.target.value }))} />
              </label>
              <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={Boolean(clip.framingRefOn)}
                  style={{ width: 'auto' }}
                  onChange={(event) => patchClip((current) => ({ ...current, framingRefOn: event.target.checked }))}
                />
                Framing reference
              </label>
              {clip.framingRefOn && (
                <input
                  value={clip.framingRefTag ?? ''}
                  placeholder="@Composition-Tag"
                  onChange={(event) => patchClip((current) => ({ ...current, framingRefTag: event.target.value }))}
                />
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
