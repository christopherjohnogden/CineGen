import { useEffect, useRef, useState } from 'react';
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
import { DirectorShotTimeline } from './director-shot-timeline';
import { takeTimelineClip } from '@/lib/director/take-timeline';
import {
  applyBeatDurations, compileClipBody, compileOptionsForShow, retimeClipToSeconds, validateClipTimings,
} from '@/lib/director/prompt-compiler';
import { isolatedPrompt } from '@/lib/director/isolate-prompt';
import { clipDisplayLabels } from '@/lib/director/shotlist';
import { getDirectorAdapter } from '@/lib/director/video-adapter';
import { DirectorClipCraft } from './director-clip-craft';
import { DirectorCameraMovePanel } from './director-camera-move';
import { DirectorShotGrammarRow } from './director-shot-grammar';
import { applyMatchSizeToScene, beatGrammarsForClip, beatHoldsPreviousSetup, beatIsDirtyFromOrigin, beatScriptContext, beatSetupColors, grammarSizeLabel, resetBeatToOrigin, SETUP_SWATCH_COUNT, SHOT_SIZES } from '@/lib/director/craft/coverage';
import { DirectorStagingFrame, captureVideoFrame } from './director-staging-frame';
import { DirectorFramingBoard, DirectorShotFramingPick } from './director-framing-board';
import { DirectorsNotesField } from './director-notes-field';
import { ensureClipStaging } from '@/lib/director/staging-diagram';
import { adoptClipFramings, applyFraming, applyFramingToBeat, beatFramingId, boundFramingId, clearFramingBind, resolveClipStaging, revertFramingOnBeat } from '@/lib/director/framing-reserve';
import { clipIsDirtyFromLlmOrigin, resetClipToLlmOrigin } from '@/lib/director/llm-origin';
import { copyButtonLabel, useCopiedFlash } from '@/hooks/use-copied-flash';

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
  onClipNotes: (notes: string) => Promise<boolean>;
  onRemoveAsset?: (assetId: string) => void;
  onSetStagingFrame?: (source: {
    dataUrl?: string;
    fileRef?: string;
    timeSec?: number;
    durationSec?: number;
    variantKey?: string;
    beatTimes?: DirectorTake['beatTimes'];
    promptSnapshot?: string;
  }) => void;
  onMakeStagingDiagram?: () => void;
  onFetchStagingDiagram?: () => void;
  onKeepStagingFraming?: () => void;
  onCancelStagingDiagram?: () => void;
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
  const { show, assets, warnings, selectedBeatN, onSelectBeat, onChange, onGenerate, onClipNotes, onRemoveAsset } = props;
  const clip = selectedClip(show);
  const adapter = getDirectorAdapter(show.adapterId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shotsSectionRef = useRef<HTMLDetailsElement>(null);
  const shotsBodyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDetailsElement>(null);
  const framingSearchRef = useRef<HTMLInputElement>(null);
  const pickerSearchRef = useRef<HTMLInputElement>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [framingQuery, setFramingQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const promptCopy = useCopiedFlash();
  useEffect(() => { setNotesDraft(''); }, [clip?.id]);
  useEffect(() => { setFramingQuery(''); setPickerOpen(false); }, [clip?.id, clip?.activeVariant]);
  useEffect(() => {
    const next = adoptClipFramings(show);
    if (next !== show) onChange(next);
  }, [show, onChange]);
  useEffect(() => {
    if (!pickerOpen) return;
    const focus = () => pickerSearchRef.current?.focus();
    requestAnimationFrame(focus);
  }, [pickerOpen]);
  useEffect(() => {
    function isEditingContent(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      if (!element) return false;
      const tagName = element.tagName;
      return element.isContentEditable || tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA';
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && pickerOpen) {
        event.preventDefault();
        setPickerOpen(false);
        return;
      }
      if ((event.key === '/' || event.key === '@') && !pickerOpen && !isEditingContent(event)) {
        event.preventDefault();
        if (stageRef.current) stageRef.current.open = true;
        setFramingQuery('');
        setPickerOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickerOpen]);

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
  const assetSource = asset?.fileRef || asset?.url || asset?.sourceUrl;
  const timelineClip = takeTimelineClip(clip, selectedTake);
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
  const rewriting = directorJobIsRunning(show, 'rewrite');
  const liveTake = clip.takes.find((entry) => isDirectorTakeLive(entry));
  const variantLabel = variantTakeLabel(clip, key);
  const beatGrammars = beatGrammarsForClip(clip.beats);
  const setupColors = beatSetupColors(clip.beats);
  const framings = show.framingReserve ?? [];
  const resolvedStaging = resolveClipStaging(show, clip, variant);
  const staging = resolvedStaging
    ? { ...resolvedStaging, scope: clip.staging?.scope ?? resolvedStaging.scope ?? 'clip' }
    : clip.staging;
  const boundId = boundFramingId(clip, variant);
  const boundName = framings.find((entry) => entry.id === boundId)?.name;
  const pickFraming = (id: string) => {
    const scope = clip.staging?.scope ?? 'clip';
    const target = isolated && scope !== 'scene' ? 'variant' : (scope === 'scene' ? 'scene' : 'clip');
    onChange(applyFraming(show, clip.id, id, target));
    setPickerOpen(false);
  };

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
  const revealShot = (n: number) => {
    const section = shotsSectionRef.current;
    if (section) section.open = true;
    const jump = () => {
      const scroller = shotsBodyRef.current;
      const target = scroller?.querySelector<HTMLElement>(`[data-shot="${n}"]`);
      if (!scroller || !target) return;
      const next = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: Math.max(0, next), behavior: 'smooth' });
    };
    requestAnimationFrame(() => requestAnimationFrame(jump));
  };
  const pickShot = (n: number) => {
    onSelectBeat(n);
    setVariant({ kind: 'isolated', beatN: n, mode: preferredIsolateMode(clip, n, isolated ? variant : undefined) });
    revealShot(n);
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
            {clip.beats.map((entry, index) => {
              const shotTakes = takeCountForShot(clip, entry.n);
              const size = grammarSizeLabel(beatGrammars[index]);
              const held = Boolean(size && beatHoldsPreviousSetup(entry) && index > 0);
              const previous = index > 0 ? `S${clip.beats[index - 1].n}` : '';
              const setup = setupColors[index];
              const selected = isolated && variant.beatN === entry.n;
              return (
                <button
                  key={entry.n}
                  type="button"
                  className={`dgen-seg-btn${selected ? ' dgen-seg-btn--on' : ''}${setup != null ? ' dgen-seg-btn--setup' : ''}`}
                  data-setup={setup != null ? String(setup % SETUP_SWATCH_COUNT) : undefined}
                  title={held
                    ? `Same setup as ${previous} · ${size}. ${beatScriptContext(entry)}`
                    : beatScriptContext(entry)}
                  onClick={() => pickShot(entry.n)}
                >
                  S{entry.n}{size ? ` · ${size}` : ''}
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
            asset={asset}
            take={selectedTake}
            variantLabel={variantLabel}
            adapterLabel={adapter.label}
            clipLabel={`${thisLabel} · ${clip.title}`}
            videoRef={videoRef}
            onFetchTake={props.onFetchTake}
            fetchingTake={props.fetchingTake}
          />
          {!isolated && assetSource && timelineClip.beats.length > 1 && (
            <DirectorShotTimeline
              clip={timelineClip}
              videoRef={videoRef}
              src={assetSource}
              onSeekShot={(n) => {
                onSelectBeat(n);
                revealShot(n);
              }}
            />
          )}
          <DirectorStagingFrame
            staging={staging}
            framings={framings}
            boundId={boundId}
            boundName={boundName}
            query={framingQuery}
            onQuery={setFramingQuery}
            onPickFraming={pickFraming}
            onClearFraming={() => onChange(clearFramingBind(show, clip.id, variant))}
            onKeepFraming={props.onKeepStagingFraming}
            onCancel={props.onCancelStagingDiagram}
            searchRef={framingSearchRef}
            detailsRef={stageRef}
            canCapture={Boolean(assetSource)}
            onSetFrame={() => props.onSetStagingFrame?.({
              dataUrl: captureVideoFrame(videoRef.current) ?? undefined,
              fileRef: assetSource,
              timeSec: videoRef.current?.currentTime,
              durationSec: videoRef.current?.duration,
              variantKey: selectedTake?.variantKey ?? key,
              beatTimes: selectedTake?.beatTimes,
              promptSnapshot: selectedTake?.promptSnapshot,
            })}
            onMakeDiagram={() => props.onMakeStagingDiagram?.()}
            onFetchDiagram={props.onFetchStagingDiagram}
            onScope={(scope) => patchClip((current) => ({
              ...current,
              staging: { ...ensureClipStaging(current, scene?.label ?? 'scene', show.breakdown), scope },
            }))}
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
        </div>

        {/* ── RIGHT: the prompt stack ── */}
        <div className="dgen-right">
          <details className="dsl-section" open>
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Director&rsquo;s notes</span>
              <span className="director-tab__meta">
                {isolated ? `${thisLabel} · S${variant.beatN}` : thisLabel}
              </span>
            </summary>
            <div className="dgen-section-body">
              <DirectorsNotesField
                hideLabel
                value={notesDraft}
                placeholder={isolated
                  ? `e.g. "Peter shouldn't be motionless" · "make this an over-the-shoulder"`
                  : `e.g. "S2 should be over Jordan's shoulder" · "Peter's look stays dead until the file lands"`}
                hint={isolated
                  ? `Rewrites S${variant.beatN} in the structured clip — the isolated prompt updates. Mention S1, S2 for other shots.`
                  : 'Rewrites this clip — the compiled prompt and shots both update. Mention S1, S2 if you mean one shot.'}
                disabled={rewriting || generating}
                onChange={setNotesDraft}
                onApply={async () => {
                  const ok = await onClipNotes(notesDraft);
                  if (ok) setNotesDraft('');
                }}
                resetLabel="Reset to original"
                resetTitle="Restore this clip to the first shotlist"
                resetDisabled={rewriting || generating || !clipIsDirtyFromLlmOrigin(clip)}
                onReset={() => onChange(updateDirectorClip(show, clip.id, resetClipToLlmOrigin))}
              />
            </div>
          </details>
          <details className="dsl-section">
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Prompt</span>
              <span className="director-tab__meta">what this variant sends</span>
              <button
                type="button"
                className="director-tab__btn"
                style={{ marginLeft: 'auto' }}
                onClick={(event) => { event.preventDefault(); void promptCopy.copyText(compiled, clip.id); }}
              >
                {copyButtonLabel(promptCopy.isCopied(clip.id), 'Copy')}
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
              <span className="dsl-section-title">Camera</span>
              <span className="director-tab__meta">movement · match this size across the scene</span>
            </summary>
            <div className="dgen-section-body">
              <DirectorCameraMovePanel
                value={clip.cameraMove}
                inherited={scene?.cameraMove}
                sizeHint={clip.beats.find((entry) => entry.n === beatN)?.grammar?.size}
                onChange={(cameraMove) => patchClip((current) => ({ ...current, cameraMove }))}
              />
              {clip.cameraMove && scene?.cameraMove && (
                <button
                  type="button"
                  className="director-tab__btn"
                  onClick={() => patchClip((current) => ({ ...current, cameraMove: undefined }))}
                >
                  Use scene movement
                </button>
              )}
              {(() => {
                const activeIndex = clip.beats.findIndex((entry) => entry.n === beatN);
                const size = beatGrammars[activeIndex]?.size;
                const sizeLabel = SHOT_SIZES.find((entry) => entry.id === size)?.label;
                if (!size || !scene) return null;
                return (
                  <button
                    type="button"
                    className="director-tab__btn director-tab__btn--accent"
                    onClick={() => onChange(applyMatchSizeToScene(show, scene.id, { clipId: clip.id, beatN }))}
                  >
                    Use this {sizeLabel} for every {sizeLabel} in the scene
                  </button>
                );
              })()}
            </div>
          </details>

          <details className="dsl-section" ref={shotsSectionRef}>
            <summary className="dsl-section-head">
              <span className="dsl-tw" aria-hidden />
              <span className="dsl-section-title">Shots</span>
              <span className="director-tab__meta">{clip.beats.length} · durations must sum to {clip.seconds}s</span>
            </summary>
            <div className="dgen-section-body dgen-shots" ref={shotsBodyRef}>
              {framings.length === 0 && (
                <p className="director-tab__meta">No saved framings yet — Set as frame in Frame · map, then pick a card here to restage that shot.</p>
              )}
              {clip.beats.map((entry, index) => {
                const size = grammarSizeLabel(beatGrammars[index]);
                const setup = setupColors[index];
                return (
                  <div key={entry.n} className="dcov-shot" data-shot={entry.n}>
                    <div className="dgen-shotedit">
                      <button
                        type="button"
                        className={`director-tab__iso${entry.n === beatN ? ' director-tab__iso--active' : ''}${setup != null ? ' director-tab__iso--setup' : ''}`}
                        data-setup={setup != null ? String(setup % SETUP_SWATCH_COUNT) : undefined}
                        title="Select this shot for isolation"
                        onClick={() => pickShot(entry.n)}
                      >
                        S{entry.n}{size ? ` · ${size}` : ''}
                      </button>
                      <input
                        type="number" min={1} value={entry.dur} className="dgen-shotedit-dur"
                        onChange={(event) => patchClip((current) => applyBeatDurations({ ...current, beats: current.beats.map((row) => row.n === entry.n ? { ...row, dur: Math.max(1, Number(event.target.value) || row.dur) } : row) }))}
                      />
                      <button
                        type="button"
                        className="director-tab__btn"
                        disabled={!beatIsDirtyFromOrigin(entry)}
                        title="Restore the LLM cam, action, line, and coverage chips"
                        onClick={() => patchClip((current) => applyBeatDurations({
                          ...current,
                          beats: current.beats.map((row) => row.n === entry.n ? resetBeatToOrigin(row) : row),
                        }))}
                      >
                        Reset
                      </button>
                    </div>
                    <p className="dcov-beat-context">{beatScriptContext(entry)}</p>
                    <label className="dsl-scenefield">
                      <span className="dsl-scenefield-label">Action</span>
                      <input
                        value={entry.text}
                        onChange={(event) => patchClip((current) => ({ ...current, beats: current.beats.map((row) => row.n === entry.n ? { ...row, text: event.target.value } : row) }))}
                      />
                    </label>
                    <DirectorShotGrammarRow
                      beat={entry}
                      resolved={beatGrammars[index]}
                      inherited={beatHoldsPreviousSetup(entry) && index > 0}
                      onPatch={(grammar) => patchClip((current) => ({
                        ...current,
                        beats: current.beats.map((row) => row.n === entry.n ? { ...row, grammar } : row),
                      }))}
                    />
                    <DirectorShotFramingPick
                      show={show}
                      framings={framings}
                      boundId={beatFramingId(clip, entry.n)}
                      onPick={(id) => onChange(applyFramingToBeat(show, clip.id, id, entry.n))}
                      onClear={() => onChange(revertFramingOnBeat(show, clip.id, entry.n))}
                    />
                  </div>
                );
              })}
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
              <DirectorClipCraft
                clip={clip}
                sceneLabel={scene?.label ?? 'scene'}
                aspectRatio={show.aspectRatio}
                onPatch={patchClip}
                onMakeDiagram={props.onMakeStagingDiagram}
                onFetchDiagram={props.onFetchStagingDiagram}
              />
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
      {pickerOpen && (
        <div
          className="dframe-picker"
          role="dialog"
          aria-label="Reuse a saved framing"
          onClick={() => setPickerOpen(false)}
        >
          <div className="dframe-picker-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="dframe-picker-head">
              <span className="dsl-section-title">Storyboard</span>
              <span className="director-tab__meta">
                {isolated ? `S${variant.beatN}` : thisLabel} · Esc to close
              </span>
            </div>
            <DirectorFramingBoard
              framings={framings}
              boundId={boundId}
              query={framingQuery}
              onQuery={setFramingQuery}
              onPick={pickFraming}
              searchRef={pickerSearchRef}
              heading="Find a framing"
            />
          </div>
        </div>
      )}
    </div>
  );
}
