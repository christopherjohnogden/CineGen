import type { DirectorClip, DirectorShow } from '@/types/director';
import {
  applyBeatDurations,
  compileClipBody,
  retimeClipToSeconds,
  validateClipTimings,
  voicesFromBreakdown,
} from '@/lib/director/prompt-compiler';
import { isolatedPrompt } from '@/lib/director/isolate-prompt';
import { getDirectorAdapter } from '@/lib/director/video-adapter';
import { runtimeSeconds } from '@/lib/director/generate';
import { selectedClip, selectedScene, updateDirectorClip } from '@/lib/director/director-state';
import { variantKey } from '@/lib/director/slate';
import { DirectorClipCraft } from './director-clip-craft';

interface DirectorInspectorProps {
  show: DirectorShow;
  preflight: string;
  warnings: string[];
  onChange: (show: DirectorShow) => void;
  onShotlist: (sceneOnly: boolean) => void;
  onGenerate: (scope: 'active' | 'queued' | 'scene') => void;
  onRewrite: (notes: string) => void;
  onKeepRewrite: () => void;
  onDiscardRewrite: () => void;
}

function activeBody(show: DirectorShow, clip: DirectorClip): string {
  const options = { voices: voicesFromBreakdown(show.breakdown) };
  const variant = clip.activeVariant;
  if (variant.kind === 'isolated') {
    return clip.bodyEdits[variantKey(variant)]
      || isolatedPrompt(clip, variant.beatN, variant.mode, {
        aspectRatio: show.aspectRatio,
        voices: options.voices,
      })
      || compileClipBody(clip, options);
  }
  return clip.bodyEdits.full || compileClipBody(clip, options);
}

export function DirectorInspector({
  show,
  preflight,
  warnings,
  onChange,
  onShotlist,
  onGenerate,
  onRewrite,
  onKeepRewrite,
  onDiscardRewrite,
}: DirectorInspectorProps) {
  const clip = selectedClip(show);
  const adapter = getDirectorAdapter(show.adapterId);
  const timingError = clip ? validateClipTimings(clip) : null;
  const compiled = clip ? adapter.buildRequest({ show, clip, variant: clip.activeVariant }).prompt : '';

  const patchClip = (updater: (current: DirectorClip) => DirectorClip) => {
    if (!clip) return;
    onChange(updateDirectorClip(show, clip.id, updater));
  };

  return (
    <aside className="director-tab__col">
      <div className="director-tab__row">
        <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onShotlist(false)} disabled={!show.sourceText.trim() || !show.breakdownApproved}>
          Shotlist show
        </button>
        <button type="button" className="director-tab__btn" onClick={() => onShotlist(true)} disabled={!show.selectedSceneId || !show.breakdownApproved}>
          Shotlist scene
        </button>
      </div>

      {!clip ? (
        <p className="director-tab__empty">Select a clip to inspect prompts and generate takes.</p>
      ) : (
        <div className="director-tab__fields">
          <div>
            <label className="director-tab__label" htmlFor="director-title">Title</label>
            <input id="director-title" value={clip.title} onChange={(event) => patchClip((current) => ({ ...current, title: event.target.value }))} />
          </div>
          <div>
            <label className="director-tab__label" htmlFor="director-seconds">Seconds</label>
            <input
              id="director-seconds"
              type="number"
              min={1}
              value={clip.seconds}
              onChange={(event) => patchClip((current) => retimeClipToSeconds(current, Number(event.target.value) || current.seconds))}
            />
          </div>
          <div>
            <label className="director-tab__label" htmlFor="director-subject">Subject</label>
            <textarea id="director-subject" value={clip.subject} onChange={(event) => patchClip((current) => ({ ...current, subject: event.target.value }))} />
          </div>
          <div>
            <label className="director-tab__label" htmlFor="director-location">Location</label>
            <textarea id="director-location" value={clip.location} onChange={(event) => patchClip((current) => ({ ...current, location: event.target.value }))} />
          </div>
          <DirectorClipCraft
            clip={clip}
            sceneLabel={selectedScene(show)?.label ?? 'scene'}
            aspectRatio={show.aspectRatio}
            onPatch={patchClip}
          />
          <div>
            <label className="director-tab__label" htmlFor="director-style">Style</label>
            <textarea id="director-style" value={clip.style} onChange={(event) => patchClip((current) => ({ ...current, style: event.target.value }))} />
          </div>
          <div>
            <label className="director-tab__label" htmlFor="director-constraints">Constraints</label>
            <textarea id="director-constraints" value={clip.constraints} onChange={(event) => patchClip((current) => ({ ...current, constraints: event.target.value }))} />
          </div>
          <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={Boolean(clip.framingRefOn)}
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
          {timingError && <p className="director-tab__warn">{timingError}</p>}

          <div>
            <span className="director-tab__label">Shot timings</span>
            <div className="director-tab__list">
              {clip.beats.map((beat) => (
                <div key={beat.n} className="director-tab__row" style={{ alignItems: 'center' }}>
                  <span className="director-tab__meta" style={{ minWidth: 42 }}>S{beat.n}</span>
                  <input
                    type="number"
                    min={1}
                    value={beat.dur}
                    onChange={(event) => patchClip((current) => applyBeatDurations({
                      ...current,
                      beats: current.beats.map((entry) => entry.n === beat.n
                        ? { ...entry, dur: Math.max(1, Number(event.target.value) || entry.dur) }
                        : entry),
                    }))}
                  />
                  <input
                    value={beat.text}
                    onChange={(event) => patchClip((current) => ({
                      ...current,
                      beats: current.beats.map((entry) => entry.n === beat.n ? { ...entry, text: event.target.value } : entry),
                    }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="director-tab__label" htmlFor="director-body">Active variant body</label>
            <textarea
              id="director-body"
              className="director-tab__prompt"
              value={activeBody(show, clip)}
              onChange={(event) => patchClip((current) => ({
                ...current,
                bodyEdits: { ...current.bodyEdits, [variantKey(current.activeVariant)]: event.target.value },
              }))}
            />
            <button
              type="button"
              className="director-tab__btn"
              onClick={() => patchClip((current) => {
                const next = { ...current.bodyEdits };
                delete next[variantKey(current.activeVariant)];
                return { ...current, bodyEdits: next };
              })}
            >
              Reset compiled
            </button>
          </div>

          <div>
            <span className="director-tab__label">Compiled prompt</span>
            <textarea className="director-tab__prompt" readOnly value={compiled} />
          </div>

          <p className="director-tab__meta">{preflight} · runtime {runtimeSeconds(show.clips)}s</p>
          {warnings.map((warning) => (
            <p key={warning} className="director-tab__warn">{warning}</p>
          ))}

          <div className="director-tab__row">
            <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onGenerate('active')} disabled={Boolean(timingError)}>
              Generate variant
            </button>
            <button type="button" className="director-tab__btn" onClick={() => onGenerate('queued')}>
              Generate queued
            </button>
            <button type="button" className="director-tab__btn" onClick={() => onGenerate('scene')}>
              Generate scene
            </button>
          </div>

          <NotesBlock clip={clip} onRewrite={onRewrite} onKeep={onKeepRewrite} onDiscard={onDiscardRewrite} />
        </div>
      )}
    </aside>
  );
}

function NotesBlock({
  clip,
  onRewrite,
  onKeep,
  onDiscard,
}: {
  clip: DirectorClip;
  onRewrite: (notes: string) => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <div>
      <label className="director-tab__label" htmlFor="director-notes">Director notes</label>
      <textarea
        id="director-notes"
        placeholder="What to keep or change on the next rewrite of this variant."
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onRewrite((event.currentTarget as HTMLTextAreaElement).value);
          }
        }}
      />
      <div className="director-tab__row">
        <button
          type="button"
          className="director-tab__btn"
          onClick={() => {
            const field = document.getElementById('director-notes') as HTMLTextAreaElement | null;
            onRewrite(field?.value ?? '');
          }}
        >
          Rewrite
        </button>
        <button type="button" className="director-tab__btn" onClick={onKeep} disabled={!clip.pendingRewrite}>Keep</button>
        <button type="button" className="director-tab__btn" onClick={onDiscard} disabled={!clip.pendingRewrite}>Discard</button>
      </div>
      {clip.pendingRewrite && <p className="director-tab__ok">Rewrite ready — Keep to store, Discard to revert.</p>}
    </div>
  );
}
