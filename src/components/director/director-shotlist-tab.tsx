import { useEffect, useState } from 'react';
import type { DirectorClip, DirectorScene, DirectorShow, IsolateVariant } from '@/types/director';
import type { Element } from '@/types/elements';
import { clipDisplayLabels } from '@/lib/director/shotlist';
import { padTimecode, validateClipTimings } from '@/lib/director/prompt-compiler';
import { directorRunningLabel, setClipVariant, updateDirectorClip } from '@/lib/director/director-state';
import {
  beatIsDirtyFromLlmOrigin,
  clipIsDirtyFromLlmOrigin,
  resetClipBeatToLlmOrigin,
  resetClipToLlmOrigin,
  resetSceneClipsToLlmOrigin,
  sceneIsDirtyFromLlmOrigin,
} from '@/lib/director/llm-origin';
import { compileLookBible } from '@/lib/director/look-bible';
import { getDirectorAdapter } from '@/lib/director/video-adapter';
import { DirectorSceneCoverage } from './director-scene-coverage';
import { DirectorsNotesField } from './director-notes-field';
import { beatScriptContext } from '@/lib/director/craft/coverage';
import { copyButtonLabel, useCopiedFlash } from '@/hooks/use-copied-flash';

interface DirectorShotlistTabProps {
  show: DirectorShow;
  elements: Element[];
  /** Rail filter: show only this scene's block; null = every scene. */
  sceneFilter: string | null;
  /** Rail clip click: expand this clip's row (nonce distinguishes repeat clicks). */
  expandRequest: { clipId: string; n: number } | null;
  /** True while the auto-sync cascade (breakdown → shotlist) is running. */
  syncing: boolean;
  onChange: (show: DirectorShow) => void;
  /** Run the shotlist job — for one scene when a sceneId is given, else the whole show. */
  onShotlist: (sceneId?: string) => void;
  /** Stop the running shotlist job (manual or auto-sync). */
  onStopShotlist: () => void;
  /** Send director's notes for one scene to the LLM; it patches the clips the notes mention. */
  onSceneNotes: (sceneId: string, notes: string) => Promise<boolean>;
  /** Send director's notes for one clip; it patches that clip only. */
  onClipNotes: (clipId: string, notes: string) => Promise<boolean>;
  /** Redo one beat's camera; duration and dialogue stay. */
  onReshotBeat: (clipId: string, beatN: number) => void;
  /** Redo the whole clip's coverage; other clips in the scene stay. */
  onReshotClip: (clipId: string) => void;
  onSelectClip: (sceneId: string, clipId: string) => void;
}

type PendingShotlist =
  | { kind: 'show' }
  | { kind: 'scene'; sceneId: string; label: string; clipCount: number }
  | { kind: 'clip'; clipId: string; clipLabel: string }
  | { kind: 'beat'; clipId: string; beatN: number; clipLabel: string };

export function DirectorShotlistTab({ show, elements, sceneFilter, expandRequest, syncing, onChange, onShotlist, onStopShotlist, onSceneNotes, onClipNotes, onReshotBeat, onReshotClip, onSelectClip }: DirectorShotlistTabProps) {
  const copied = useCopiedFlash();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [clipNotesDraft, setClipNotesDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingShotlist | null>(null);

  // A rail clip click expands that clip's row EXCLUSIVELY — whatever was open
  // collapses, so the rail walks the shotlist one clip at a time.
  useEffect(() => {
    if (!expandRequest) return;
    setOpenIds(new Set([expandRequest.clipId]));
    // block:'start' pins the expanded clip to the top of the stage so its
    // shotmap and prompt are immediately readable.
    requestAnimationFrame(() => {
      document.querySelector(`[data-clip-row="${expandRequest.clipId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [expandRequest]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);
  const adapter = getDirectorAdapter(show.adapterId);
  // Clips whose scene no longer exists (left over from an earlier breakdown)
  // are unreachable in every scene-grouped view — keep them out of the totals
  // and offer a one-click cleanup instead of silently miscounting.
  const liveSceneIds = new Set(show.scenes.map((scene) => scene.id));
  const orphanClips = show.clips.filter((clip) => !liveSceneIds.has(clip.sceneId));
  const mainClips = show.clips.filter((clip) => !clip.altOf && liveSceneIds.has(clip.sceneId));
  const totalSeconds = mainClips.reduce((sum, clip) => sum + clip.seconds, 0);
  const totalShots = mainClips.reduce((sum, clip) => sum + clip.beats.length, 0);
  const queuedCount = mainClips.filter((clip) => clip.queued).length;
  const autoSync = show.autoSync ?? true;
  const job = show.jobStatus;
  const jobRelevant = job && (job.type === 'shotlist' || job.type === 'breakdown' || job.type === 'rewrite');
  const working = syncing || Boolean(jobRelevant && !job.error);
  const stylePrefix = compileLookBible(show);
  // A stale filter (scene removed by a re-breakdown) falls back to all scenes.
  const visibleScenes = sceneFilter && show.scenes.some((scene) => scene.id === sceneFilter)
    ? show.scenes.filter((scene) => scene.id === sceneFilter)
    : show.scenes;

  const clipLabels = clipDisplayLabels(show.scenes, show.clips);
  // Running start timecode per clip, across the whole show in scene order.
  const clipStart = new Map<string, number>();
  {
    let elapsed = 0;
    for (const scene of show.scenes) {
      for (const clip of show.clips) {
        if (clip.sceneId !== scene.id || clip.altOf) continue;
        clipStart.set(clip.id, elapsed);
        elapsed += clip.seconds;
      }
    }
  }

  const toggleClip = (clip: DirectorClip) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(clip.id)) next.delete(clip.id);
      else next.add(clip.id);
      return next;
    });
    onSelectClip(clip.sceneId, clip.id);
  };

  const copyPrompt = (clip: DirectorClip) => {
    const { prompt } = adapter.buildRequest({ show, clip, variant: clip.activeVariant });
    void copied.copyText(prompt, clip.id);
  };

  const patchScene = (sceneId: string, patch: Partial<DirectorScene>) => {
    onChange({ ...show, scenes: show.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene) });
  };

  const setQueued = (clipId: string, queued: boolean) => {
    onChange(updateDirectorClip(show, clipId, (clip) => ({ ...clip, queued })));
  };

  const openInGenerate = (clip: DirectorClip) => {
    onChange({ ...show, mode: 'generate', selectedSceneId: clip.sceneId, selectedClipId: clip.id });
  };

  const clearOrphans = () => {
    const kept = show.clips.filter((clip) => liveSceneIds.has(clip.sceneId));
    onChange({
      ...show,
      clips: kept,
      selectedClipId: kept.some((clip) => clip.id === show.selectedClipId) ? show.selectedClipId : undefined,
    });
  };

  return (
    <div className="director-tab__stage">
      <div className="director-tab__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="director-tab__btn director-tab__btn--accent"
          onClick={() => (mainClips.length > 0 ? setPending({ kind: 'show' }) : onShotlist())}
          disabled={!show.sourceText.trim() || working}
          title={`Break the show into ${show.clipLengthSec}s clips — clip length is set in Setup`}
        >
          Shotlist show
        </button>
        {(working || mainClips.length > 0) && (
          <span className="director-tab__row" style={{ marginLeft: 'auto', alignItems: 'center', flexWrap: 'nowrap' }}>
            {mainClips.length > 0 && (
              <span className="director-tab__meta">
                {mainClips.length} clip{mainClips.length === 1 ? '' : 's'} · {totalShots} shot{totalShots === 1 ? '' : 's'} · {padTimecode(totalSeconds)} runtime
                {queuedCount > 0 ? ` · ${queuedCount} queued` : ''}
              </span>
            )}
            {working && (
              <>
                <span className="director-tab__ok">
                  {jobRelevant && !job.error ? directorRunningLabel(job.type) : 'Running…'}
                </span>
                <button type="button" className="director-tab__btn" onClick={onStopShotlist}>Stop</button>
              </>
            )}
          </span>
        )}
      </div>
      {jobRelevant && job.error && (
        <p className="director-tab__warn">
          {job.type === 'rewrite'
            ? job.message
            : `Auto-shotlist stopped: ${job.message} — fix the LLM (⚙ picker in the toolbar), then edit the script or press a Shotlist button to retry.`}
        </p>
      )}
      {orphanClips.length > 0 && (
        <p className="director-tab__warn">
          {orphanClips.length} clip{orphanClips.length === 1 ? '' : 's'} from an earlier breakdown no longer match any scene and can&rsquo;t be shown.{' '}
          <button type="button" className="director-tab__btn" onClick={clearOrphans}>Clear orphaned clips</button>
        </p>
      )}

      <AssetRegistry breakdown={show} elements={elements} />

      {stylePrefix.trim() && (
        <details className="dsl-section">
          <summary className="dsl-section-head">
            <span className="dsl-tw" aria-hidden />
            <span className="dsl-section-title">Style prefix</span>
            <span className="director-tab__meta">prepended to every clip on copy · {stylePrefix.trim().length} chars</span>
            <button
              type="button"
              className="director-tab__btn"
              style={{ marginLeft: 'auto' }}
              onClick={(event) => { event.preventDefault(); void copied.copyText(stylePrefix.trim(), 'style-prefix'); }}
            >
              {copyButtonLabel(copied.isCopied('style-prefix'), 'Copy')}
            </button>
          </summary>
          <pre className="dsl-prompt">{stylePrefix.trim()}</pre>
        </details>
      )}

      {show.scenes.length === 0 ? (
        <p className="director-tab__empty">Run a breakdown, then shotlist to fill this board.</p>
      ) : (
        visibleScenes.map((scene) => {
          const clips = show.clips.filter((clip) => clip.sceneId === scene.id);
          return (
            <section key={scene.id} className="director-tab__sceneblock">
              <header className="director-tab__sceneblock-head">
                <span className="director-tab__item-title">{scene.label}</span>
                {scene.summary.trim() && <span className="director-tab__meta">{scene.summary}</span>}
                <button
                  type="button"
                  className="director-tab__btn"
                  style={{ marginLeft: 'auto', flexShrink: 0 }}
                  onClick={() => (clips.length > 0
                    ? setPending({ kind: 'scene', sceneId: scene.id, label: scene.label, clipCount: clips.length })
                    : onShotlist(scene.id))}
                  disabled={working}
                  title={`Break this scene into ${show.clipLengthSec}s clips — clip length is set in Setup`}
                >
                  {clips.length > 0 ? 'Re-shotlist scene' : 'Shotlist scene'}
                </button>
              </header>
              <div className="director-tab__sceneblock-body">
                <div className="dsl-scenefields">
                  <label className="dsl-scenefield" title="The one event every character in this scene takes part in or mirrors — acting tasks are derived from it. Edit, then re-shotlist the scene.">
                    <span className="dsl-scenefield-label">Scene event</span>
                    <input
                      value={scene.event ?? ''}
                      placeholder="The one event every character here takes part in or mirrors"
                      onChange={(event) => patchScene(scene.id, { event: event.target.value })}
                    />
                  </label>
                  <label className="dsl-scenefield" title="The surface activity the event plays through — the visible terrain the camera reads. Edit, then re-shotlist the scene.">
                    <span className="dsl-scenefield-label">Physical action</span>
                    <input
                      value={scene.physicalAction ?? ''}
                      placeholder="The surface activity the event plays through"
                      onChange={(event) => patchScene(scene.id, { physicalAction: event.target.value })}
                    />
                  </label>
                </div>
                <DirectorSceneCoverage show={show} scene={scene} onChange={onChange} />
                {clips.length === 0 ? (
                  <p className="director-tab__meta">
                    {working
                      ? 'Shotlisting…'
                      : autoSync
                        ? `No clips yet — auto-sync fills this in after a script edit, or run "Shotlist scene" now.`
                        : `No clips yet — run "Shotlist scene" to break this scene into ${show.clipLengthSec}s multi-shot clips.`}
                  </p>
                ) : clips.map((clip) => (
                  <ClipRow
                    key={clip.id}
                    show={show}
                    clip={clip}
                    label={clipLabels.get(clip.id)}
                    startSec={clipStart.get(clip.id)}
                    open={openIds.has(clip.id)}
                    copied={copied.isCopied(clip.id)}
                    onToggle={() => toggleClip(clip)}
                    onQueue={(queued) => setQueued(clip.id, queued)}
                    onVariant={(variant) => onChange(setClipVariant(show, clip.id, variant))}
                    onCopy={() => copyPrompt(clip)}
                    onOpenGenerate={() => openInGenerate(clip)}
                    onReshotBeat={working ? undefined : (beatN) => setPending({
                      kind: 'beat',
                      clipId: clip.id,
                      beatN,
                      clipLabel: clipLabels.get(clip.id) ?? clip.id,
                    })}
                    onReshotClip={working ? undefined : () => setPending({
                      kind: 'clip',
                      clipId: clip.id,
                      clipLabel: clipLabels.get(clip.id) ?? clip.id,
                    })}
                    notesValue={clipNotesDraft[clip.id] ?? ''}
                    notesBusy={working}
                    onNotesChange={(value) => setClipNotesDraft((draft) => ({ ...draft, [clip.id]: value }))}
                    onApplyNotes={async () => {
                      const ok = await onClipNotes(clip.id, clipNotesDraft[clip.id] ?? '');
                      if (ok) setClipNotesDraft((draft) => ({ ...draft, [clip.id]: '' }));
                    }}
                    onResetClip={() => onChange(updateDirectorClip(show, clip.id, resetClipToLlmOrigin))}
                    onResetBeat={(beatN) => onChange(updateDirectorClip(show, clip.id, (entry) => resetClipBeatToLlmOrigin(entry, beatN)))}
                  />
                ))}
                {clips.length > 0 && (
                  <DirectorsNotesField
                    value={notesDraft[scene.id] ?? ''}
                    placeholder={'e.g. "1A should be a medium close-up" · "1B — Peter\'s tone more angry"'}
                    hint="Rewrites only the clips your notes mention — reference them by label (1A, 1B)."
                    disabled={working}
                    onChange={(value) => setNotesDraft((draft) => ({ ...draft, [scene.id]: value }))}
                    onApply={async () => {
                      const ok = await onSceneNotes(scene.id, notesDraft[scene.id] ?? '');
                      if (ok) setNotesDraft((draft) => ({ ...draft, [scene.id]: '' }));
                    }}
                    resetLabel="Reset scene to original"
                    resetTitle="Restore every clip in this scene to the first shotlist"
                    resetDisabled={working || !sceneIsDirtyFromLlmOrigin(clips, scene.id)}
                    onReset={() => onChange({ ...show, clips: resetSceneClipsToLlmOrigin(show.clips, scene.id) })}
                  />
                )}
              </div>
            </section>
          );
        })
      )}

      {pending && (
        <div className="mp-confirm__backdrop" onClick={() => setPending(null)} role="presentation">
          <div
            className="mp-confirm"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="director-reshot-title"
          >
            <h3 id="director-reshot-title" className="mp-confirm__title">{pendingCopy(pending).title}</h3>
            <p className="mp-confirm__desc">{pendingCopy(pending).description}</p>
            <div className="mp-confirm__actions">
              <button type="button" className="mp-confirm__btn mp-confirm__btn--cancel" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`mp-confirm__btn ${pending.kind === 'show' || pending.kind === 'scene' ? 'mp-confirm__btn--delete' : 'mp-confirm__btn--go'}`}
                autoFocus
                onClick={() => {
                  if (pending.kind === 'show') onShotlist();
                  else if (pending.kind === 'scene') onShotlist(pending.sceneId);
                  else if (pending.kind === 'clip') onReshotClip(pending.clipId);
                  else onReshotBeat(pending.clipId, pending.beatN);
                  setPending(null);
                }}
              >
                {pendingCopy(pending).confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pendingCopy(pending: PendingShotlist): { title: string; description: string; confirm: string } {
  if (pending.kind === 'show') {
    return {
      title: 'Shotlist the whole show?',
      description: 'This replaces every clip in every scene. Takes already generated on those clips are removed.',
      confirm: 'Shotlist show',
    };
  }
  if (pending.kind === 'scene') {
    return {
      title: 'Re-shotlist this scene?',
      description: `${pending.label} has ${pending.clipCount} clip${pending.clipCount === 1 ? '' : 's'}. They will be replaced. Takes already generated on those clips are removed.`,
      confirm: 'Re-shotlist scene',
    };
  }
  if (pending.kind === 'clip') {
    return {
      title: `Redo ${pending.clipLabel}?`,
      description: `New coverage for this clip. Duration and the scene's other clips stay. Takes already on ${pending.clipLabel} are kept but may not match the new shots.`,
      confirm: 'Redo clip',
    };
  }
  return {
    title: `Redo S${pending.beatN}?`,
    description: `A new camera for S${pending.beatN} of ${pending.clipLabel}. Duration and dialogue stay. Other shots in the clip are kept.`,
    confirm: 'Redo shot',
  };
}

/** Reference elements from the breakdown, with thumbnails from the library. */
function AssetRegistry({ breakdown, elements }: { breakdown: DirectorShow; elements: Element[] }) {
  const items = breakdown.breakdown;
  if (items.length === 0) return null;
  return (
    <details className="dsl-section">
      <summary className="dsl-section-head">
        <span className="dsl-tw" aria-hidden />
        <span className="dsl-section-title">Assets</span>
        <span className="director-tab__meta">{items.length} reference element{items.length === 1 ? '' : 's'} — tag these in prompts so the model stops inventing its own</span>
      </summary>
      <div className="dsl-assets">
        {items.map((item) => {
          const element = elements.find((entry) => entry.id === item.elementId);
          const thumb = element?.images[0]?.url;
          const blurb = item.blurb?.trim() || item.description.trim();
          return (
            <div key={item.id} className="dsl-asset">
              {thumb
                ? <img className="dsl-asset-img" src={thumb} alt={item.name} loading="lazy" />
                : <div className="dsl-asset-img dsl-asset-img--empty" title="No reference image yet — add one to this Element in the library">{item.kind[0].toUpperCase()}</div>}
              <div className="dsl-asset-body">
                <span className="dsl-asset-tag">{item.tag}</span>
                <span className="dsl-asset-kind">{item.kind}{element ? '' : ' · no element'}</span>
                {blurb && <p className="dsl-asset-desc" title={blurb}>{blurb}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

interface ClipRowProps {
  show: DirectorShow;
  clip: DirectorClip;
  /** Display label ("1A") — scene number + position, never the stored id. */
  label: string | undefined;
  startSec: number | undefined;
  open: boolean;
  copied: boolean;
  onToggle: () => void;
  onQueue: (queued: boolean) => void;
  onVariant: (variant: IsolateVariant) => void;
  onCopy: () => void;
  onOpenGenerate: () => void;
  onReshotBeat?: (beatN: number) => void;
  onReshotClip?: () => void;
  notesValue: string;
  notesBusy: boolean;
  onNotesChange: (value: string) => void;
  onApplyNotes: () => void | Promise<void>;
  onResetClip: () => void;
  onResetBeat: (beatN: number) => void;
}

function ClipRow({ show, clip, label, startSec, open, copied, onToggle, onQueue, onVariant, onCopy, onOpenGenerate, onReshotBeat, onReshotClip, notesValue, notesBusy, onNotesChange, onApplyNotes, onResetClip, onResetBeat }: ClipRowProps) {
  const timingError = validateClipTimings(clip);
  const adapter = getDirectorAdapter(show.adapterId);
  const variant = clip.activeVariant;
  const isolated = variant.kind === 'isolated';
  const request = open ? adapter.buildRequest({ show, clip, variant }) : null;

  const variantBadge = isolated
    ? `S${variant.beatN} ${variant.mode === 'held' ? `held ${clip.seconds}s` : `native ${clip.beats.find((beat) => beat.n === variant.beatN)?.dur ?? clip.seconds}s`}`
    : null;

  return (
    <div className="director-tab__cliprow" data-clip-row={clip.id}>
      <div className="director-tab__cliprow-head" role="button" tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); } }}>
        <label className="dsl-queue" title="Queue for Generate" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={Boolean(clip.queued)}
            onChange={(event) => onQueue(event.target.checked)}
          />
          <span className="dsl-queue-box" aria-hidden />
        </label>
        <div className="director-tab__clipcard-body" style={{ padding: 0, flex: 1 }}>
          <div className="director-tab__item-title">
            {label && <span className="dsl-cid">{label}</span>}
            {clip.title}
          </div>
          <span className="director-tab__meta">
            {typeof startSec === 'number' ? `${padTimecode(startSec)} · ` : ''}{clip.seconds}s
            {typeof clip.fov === 'number' ? ` · ${clip.fov}° lens` : ''}
            {variantBadge && <span className="director-tab__isotag"> · {variantBadge}</span>}
          </span>
        </div>
        <span className="dsl-shotspill">{clip.beats.length === 1 ? 'held single' : `${clip.beats.length} shots`}</span>
        <button type="button" className="director-tab__btn" onClick={(event) => { event.stopPropagation(); onCopy(); }}>
          {copyButtonLabel(copied, 'Copy prompt')}
        </button>
        {onReshotClip && (
          <button
            type="button"
            className="director-tab__btn"
            title={`Redo ${label ?? 'this clip'} — new coverage, same duration`}
            onClick={(event) => { event.stopPropagation(); onReshotClip(); }}
          >
            Redo
          </button>
        )}
        <span className="director-tab__meta" aria-hidden>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="director-tab__cliprow-body">
          {clip.elementTags.length > 0 && (
            <div className="director-tab__chips" style={{ marginTop: 0 }}>
              {clip.elementTags.map((tag) => <span key={tag} className="director-tab__chip">{tag}</span>)}
            </div>
          )}

          <div className="director-tab__shotmap">
            <div className="director-tab__shotmap-head">
              <span>Shots in this prompt — isolate one for the full {clip.seconds}s or just its own length</span>
              <span className="director-tab__shotrow-btns">
                <button
                  type="button"
                  className={`director-tab__iso${variant.kind === 'full' ? ' director-tab__iso--active' : ''}`}
                  onClick={() => onVariant({ kind: 'full' })}
                >
                  Full multishot
                </button>
                {onReshotClip && (
                  <button
                    type="button"
                    className="director-tab__iso"
                    title={`Redo ${label ?? 'this clip'} — new coverage for every shot`}
                    onClick={onReshotClip}
                  >
                    Redo
                  </button>
                )}
              </span>
            </div>
            {clip.beats.map((beat) => {
              const heldActive = isolated && variant.beatN === beat.n && variant.mode === 'held';
              const nativeActive = isolated && variant.beatN === beat.n && variant.mode === 'native';
              return (
                <div key={beat.n} className="director-tab__shotrow">
                  <span className="director-tab__shotrow-tc">S{beat.n} · {beat.from}–{beat.to}</span>
                  <span className="director-tab__shotrow-text">{beatScriptContext(beat)}</span>
                  <span className="director-tab__shotrow-btns">
                    {clip.beats.length > 1 && (
                      <>
                        <button
                          type="button"
                          className={`director-tab__iso${heldActive ? ' director-tab__iso--active' : ''}`}
                          title={`Isolate shot ${beat.n} as one unbroken take held for the full ${clip.seconds} seconds`}
                          onClick={() => onVariant({ kind: 'isolated', beatN: beat.n, mode: 'held' })}
                        >
                          {clip.seconds}s
                        </button>
                        <button
                          type="button"
                          className={`director-tab__iso${nativeActive ? ' director-tab__iso--active' : ''}`}
                          title={`Isolate shot ${beat.n} at its own ${beat.dur}-second length`}
                          onClick={() => onVariant({ kind: 'isolated', beatN: beat.n, mode: 'native' })}
                        >
                          {beat.dur}s
                        </button>
                      </>
                    )}
                    {onReshotBeat && (
                      <button
                        type="button"
                        className="director-tab__iso"
                        title={`Redo S${beat.n} — new camera, same duration and line`}
                        onClick={() => onReshotBeat(beat.n)}
                      >
                        Redo
                      </button>
                    )}
                    <button
                      type="button"
                      className="director-tab__iso"
                      disabled={!beatIsDirtyFromLlmOrigin(clip, beat.n)}
                      title={`Restore S${beat.n} as first shotlisted`}
                      onClick={() => onResetBeat(beat.n)}
                    >
                      Reset
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {timingError && <p className="director-tab__warn">{timingError}</p>}
          <DirectorsNotesField
            value={notesValue}
            placeholder={'e.g. "S2 should be over Jordan\'s shoulder" · "Peter\'s look stays dead until the file lands"'}
            hint="Rewrites this clip — mention S1, S2 if you mean one shot. This clip is implied."
            disabled={notesBusy}
            onChange={onNotesChange}
            onApply={onApplyNotes}
            resetLabel="Reset to original"
            resetTitle="Restore this clip to the first shotlist"
            resetDisabled={notesBusy || !clipIsDirtyFromLlmOrigin(clip)}
            onReset={onResetClip}
          />
          {request && (
            <>
              <span className="director-tab__meta">
                {isolated
                  ? `Isolated prompt — one unbroken take, ${request.durationSec}s`
                  : `Full multishot prompt — ${request.durationSec}s`}
              </span>
              <pre className="dsl-prompt">{request.prompt}</pre>
            </>
          )}
          <div className="director-tab__row">
            <button type="button" className="director-tab__btn" onClick={onOpenGenerate}>
              Open in Generate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
