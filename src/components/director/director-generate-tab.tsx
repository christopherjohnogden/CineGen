import type { Asset } from '@/types/project';
import type { DirectorClip, DirectorShow, IsolateVariant } from '@/types/director';
import {
  selectedClip, selectedScene, setClipVariant, setHeroTake, updateDirectorClip,
} from '@/lib/director/director-state';
import { runtimeSeconds, takesForVariant } from '@/lib/director/generate';
import { variantKey } from '@/lib/director/slate';
import {
  applyBeatDurations, compileClipBody, retimeClipToSeconds, validateClipTimings, voicesFromBreakdown,
} from '@/lib/director/prompt-compiler';
import { isolatedPrompt } from '@/lib/director/isolate-prompt';
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
  onRewrite: (notes: string) => void;
  onKeepRewrite: () => void;
  onDiscardRewrite: () => void;
}

function activeBody(show: DirectorShow, clip: DirectorClip): string {
  const options = { voices: voicesFromBreakdown(show.breakdown) };
  const variant = clip.activeVariant;
  if (variant.kind === 'isolated') {
    return clip.bodyEdits[variantKey(variant)]
      || isolatedPrompt(clip, variant.beatN, variant.mode, { aspectRatio: show.aspectRatio, voices: options.voices })
      || compileClipBody(clip, options);
  }
  return clip.bodyEdits.full || compileClipBody(clip, options);
}

export function DirectorGenerateTab(props: DirectorGenerateTabProps) {
  const { show, assets, preflight, warnings, selectedBeatN, onSelectBeat, onChange, onGenerate, onRewrite, onKeepRewrite, onDiscardRewrite } = props;
  const clip = selectedClip(show);
  const adapter = getDirectorAdapter(show.adapterId);

  const patchClip = (updater: (current: DirectorClip) => DirectorClip) => {
    if (!clip) return;
    onChange(updateDirectorClip(show, clip.id, updater));
  };

  if (!clip) {
    return <div className="director-tab__stage"><p className="director-tab__empty">Select a clip in the rail to preview and generate takes.</p></div>;
  }

  const key = variantKey(clip.activeVariant);
  const takes = takesForVariant(clip, key);
  const selectedTake = takes.find((take) => take.id === show.selectedTakeId) ?? takes[takes.length - 1];
  const asset = assets.find((entry) => entry.id === selectedTake?.assetId);
  const timingError = validateClipTimings(clip);
  const compiled = adapter.buildRequest({ show, clip, variant: clip.activeVariant }).prompt;
  const beatN = clip.beats.some((beat) => beat.n === selectedBeatN) ? selectedBeatN : clip.beats[0]?.n ?? 1;

  const setVariant = (variant: IsolateVariant) => onChange({ ...setClipVariant(show, clip.id, variant), selectedClipId: clip.id });

  return (
    <div className="director-tab__stage">
      <span className="director-tab__label" style={{ margin: 0 }}>{clip.id} — {clip.title}</span>

      <div className="director-tab__viewer">
        {asset?.url ? <video src={asset.url} controls /> : (
          <span className="director-tab__empty">
            {selectedTake?.status === 'running' || selectedTake?.status === 'queued'
              ? `T${String(selectedTake.number).padStart(2, '0')} generating…`
              : 'No take yet for this variant'}
          </span>
        )}
      </div>

      <div className="director-tab__row">
        <button type="button" className="director-tab__btn" onClick={() => setVariant({ kind: 'full' })}>Full</button>
        <button type="button" className="director-tab__btn" onClick={() => setVariant({ kind: 'isolated', beatN, mode: 'held' })} disabled={!clip.beats.some((beat) => beat.n === beatN)}>Hold to {clip.seconds}s</button>
        <button type="button" className="director-tab__btn" onClick={() => setVariant({ kind: 'isolated', beatN, mode: 'native' })} disabled={!clip.beats.some((beat) => beat.n === beatN)}>Native length</button>
      </div>

      <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12 }}>
        <input type="checkbox" checked={Boolean(clip.queued)} style={{ width: 'auto' }}
          onChange={(event) => onChange({ ...show, clips: show.clips.map((entry) => entry.id === clip.id ? { ...entry, queued: event.target.checked } : entry) })} />
        Queue for Generate all
      </label>

      <div className="director-tab__fields">
        <div>
          <label className="director-tab__label" htmlFor="director-title">Title</label>
          <input id="director-title" value={clip.title} onChange={(event) => patchClip((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-seconds">Seconds</label>
          <input id="director-seconds" type="number" min={1} value={clip.seconds} onChange={(event) => patchClip((current) => retimeClipToSeconds(current, Number(event.target.value) || current.seconds))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-subject">Subject</label>
          <textarea id="director-subject" value={clip.subject} onChange={(event) => patchClip((current) => ({ ...current, subject: event.target.value }))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-location">Location</label>
          <textarea id="director-location" value={clip.location} onChange={(event) => patchClip((current) => ({ ...current, location: event.target.value }))} />
        </div>
        <DirectorClipCraft clip={clip} sceneLabel={selectedScene(show)?.label ?? 'scene'} aspectRatio={show.aspectRatio} onPatch={patchClip} />
        <div>
          <label className="director-tab__label" htmlFor="director-style">Style</label>
          <textarea id="director-style" value={clip.style} onChange={(event) => patchClip((current) => ({ ...current, style: event.target.value }))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-constraints">Constraints</label>
          <textarea id="director-constraints" value={clip.constraints} onChange={(event) => patchClip((current) => ({ ...current, constraints: event.target.value }))} />
        </div>
        {timingError && <p className="director-tab__warn">{timingError}</p>}

        <div>
          <span className="director-tab__label">Shots</span>
          <div className="director-tab__list">
            {clip.beats.map((beat) => (
              <button key={beat.n} type="button" className={`director-tab__beat${beat.n === beatN ? ' director-tab__beat--active' : ''}`} onClick={() => onSelectBeat(beat.n)}>
                <span className="director-tab__item-title">SHOT {beat.n} ({beat.from}–{beat.to})</span>
                <span className="director-tab__meta">{beat.cam || beat.text}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="director-tab__label">Shot timings</span>
          <div className="director-tab__list">
            {clip.beats.map((beat) => (
              <div key={beat.n} className="director-tab__row" style={{ alignItems: 'center' }}>
                <span className="director-tab__meta" style={{ minWidth: 42 }}>S{beat.n}</span>
                <input type="number" min={1} value={beat.dur} onChange={(event) => patchClip((current) => applyBeatDurations({ ...current, beats: current.beats.map((entry) => entry.n === beat.n ? { ...entry, dur: Math.max(1, Number(event.target.value) || entry.dur) } : entry) }))} />
                <input value={beat.text} onChange={(event) => patchClip((current) => ({ ...current, beats: current.beats.map((entry) => entry.n === beat.n ? { ...entry, text: event.target.value } : entry) }))} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="director-tab__label" htmlFor="director-body">Active variant body</label>
          <textarea id="director-body" className="director-tab__prompt" value={activeBody(show, clip)}
            onChange={(event) => patchClip((current) => ({ ...current, bodyEdits: { ...current.bodyEdits, [variantKey(current.activeVariant)]: event.target.value } }))} />
          <button type="button" className="director-tab__btn" onClick={() => patchClip((current) => { const next = { ...current.bodyEdits }; delete next[variantKey(current.activeVariant)]; return { ...current, bodyEdits: next }; })}>Reset compiled</button>
        </div>

        <div>
          <span className="director-tab__label">Compiled prompt</span>
          <textarea className="director-tab__prompt" readOnly value={compiled} />
        </div>

        <p className="director-tab__meta">{preflight} · runtime {runtimeSeconds(show.clips)}s</p>
        {warnings.map((warning) => <p key={warning} className="director-tab__warn">{warning}</p>)}

        <div className="director-tab__row">
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onGenerate('active')} disabled={Boolean(timingError)}>Generate variant</button>
          <button type="button" className="director-tab__btn" onClick={() => onGenerate('queued')}>Generate queued</button>
          <button type="button" className="director-tab__btn" onClick={() => onGenerate('scene')}>Generate scene</button>
        </div>

        <div>
          <span className="director-tab__label">Takes</span>
          <div className="director-tab__takes">
            {takes.length === 0 && <span className="director-tab__empty">None yet</span>}
            {takes.map((take) => (
              <button key={take.id} type="button" title={take.status}
                className={`director-tab__take${take.id === selectedTake?.id ? ' director-tab__take--active' : ''}${take.hero ? ' director-tab__take--hero' : ''}`}
                onClick={() => onChange({ ...show, selectedTakeId: take.id })}
                onDoubleClick={() => onChange(setHeroTake(show, clip.id, take.id))}>
                T{String(take.number).padStart(2, '0')}{take.hero ? ' ★' : ''}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="director-tab__label" htmlFor="director-notes">Director notes</label>
          <textarea id="director-notes" placeholder="What to keep or change on the next rewrite of this variant."
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onRewrite((event.currentTarget as HTMLTextAreaElement).value); } }} />
          <div className="director-tab__row">
            <button type="button" className="director-tab__btn" onClick={() => { const field = document.getElementById('director-notes') as HTMLTextAreaElement | null; onRewrite(field?.value ?? ''); }}>Rewrite</button>
            <button type="button" className="director-tab__btn" onClick={onKeepRewrite} disabled={!clip.pendingRewrite}>Keep</button>
            <button type="button" className="director-tab__btn" onClick={onDiscardRewrite} disabled={!clip.pendingRewrite}>Discard</button>
          </div>
          {clip.pendingRewrite && <p className="director-tab__ok">Rewrite ready — Keep to store, Discard to revert.</p>}
        </div>
      </div>
    </div>
  );
}
