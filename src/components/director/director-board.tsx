import type { Asset } from '@/types/project';
import type { DirectorBeat, DirectorClip, DirectorShow, IsolateVariant } from '@/types/director';
import { takesForVariant } from '@/lib/director/generate';
import { selectedClip, selectedScene, setClipVariant, setHeroTake } from '@/lib/director/director-state';
import { variantKey } from '@/lib/director/slate';

interface DirectorBoardProps {
  show: DirectorShow;
  assets: Asset[];
  selectedBeatN: number;
  onChange: (show: DirectorShow) => void;
  onSelectBeat: (n: number) => void;
}

export function DirectorBoard({ show, assets, selectedBeatN, onChange, onSelectBeat }: DirectorBoardProps) {
  const scene = selectedScene(show);
  const clip = selectedClip(show);
  const sceneClips = show.clips.filter((entry) => entry.sceneId === scene?.id);
  const key = clip ? variantKey(clip.activeVariant) : 'full';
  const takes = clip ? takesForVariant(clip, key) : [];
  const selectedTake = takes.find((take) => take.id === show.selectedTakeId) ?? takes[takes.length - 1];
  const asset = assets.find((entry) => entry.id === selectedTake?.assetId);

  const selectClip = (next: DirectorClip) => {
    onChange({
      ...show,
      selectedClipId: next.id,
      selectedSceneId: next.sceneId,
      selectedTakeId: takesForVariant(next, variantKey(next.activeVariant)).at(-1)?.id,
      mode: show.mode === 'source' || show.mode === 'breakdown' ? 'shotlist' : show.mode,
    });
    onSelectBeat(next.beats[0]?.n ?? 1);
  };

  const setVariant = (variant: IsolateVariant) => {
    if (!clip) return;
    onChange({
      ...setClipVariant(show, clip.id, variant),
      selectedClipId: clip.id,
    });
  };

  return (
    <section className="director-tab__col">
      {show.scenes.length === 0 ? (
        <p className="director-tab__empty">Approve a breakdown, then run a shotlist to fill this board.</p>
      ) : (
        <>
          <div>
            <span className="director-tab__label">Scenes</span>
            <div className="director-tab__list">
              {show.scenes.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`director-tab__item${entry.id === scene?.id ? ' director-tab__item--active' : ''}`}
                  onClick={() => {
                    const first = show.clips.find((row) => row.sceneId === entry.id);
                    onChange({
                      ...show,
                      selectedSceneId: entry.id,
                      selectedClipId: first?.id ?? show.selectedClipId,
                    });
                  }}
                >
                  <span className="director-tab__item-title">{entry.label}</span>
                  <span className="director-tab__meta">{entry.summary || `${show.clips.filter((row) => row.sceneId === entry.id).length} clips`}</span>
                </button>
              ))}
            </div>
          </div>

          {scene && (
            <div>
              <label className="director-tab__label" htmlFor="director-scene-event">Scene event</label>
              <input
                id="director-scene-event"
                value={scene.event ?? ''}
                placeholder="The one event every character here takes part in or mirrors"
                onChange={(event) => onChange({
                  ...show,
                  scenes: show.scenes.map((entry) => entry.id === scene.id
                    ? { ...entry, event: event.target.value }
                    : entry),
                })}
              />
              <input
                value={scene.physicalAction ?? ''}
                placeholder="Physical action — the surface activity it plays through"
                onChange={(event) => onChange({
                  ...show,
                  scenes: show.scenes.map((entry) => entry.id === scene.id
                    ? { ...entry, physicalAction: event.target.value }
                    : entry),
                })}
              />
            </div>
          )}

          <div>
            <span className="director-tab__label">Clips</span>
            <div className="director-tab__list">
              {sceneClips.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`director-tab__clip${entry.id === clip?.id ? ' director-tab__clip--active' : ''}`}
                  onClick={() => selectClip(entry)}
                >
                  <span className="director-tab__clip-title">{entry.id} — {entry.title}</span>
                  <span className="director-tab__meta">
                    {entry.seconds}s · {entry.beats.length} shots
                    {entry.altOf ? ' · alt' : ''}
                    {entry.queued ? ' · queued' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {clip && (
        <>
          <div className="director-tab__viewer">
            {asset?.url ? (
              <video src={asset.url} controls />
            ) : (
              <span className="director-tab__empty">
                {selectedTake?.status === 'running' || selectedTake?.status === 'queued'
                  ? `T${String(selectedTake.number).padStart(2, '0')} generating…`
                  : 'No take yet for this variant'}
              </span>
            )}
          </div>

          <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={Boolean(clip.queued)}
              onChange={(event) => onChange({
                ...show,
                clips: show.clips.map((entry) => entry.id === clip.id ? { ...entry, queued: event.target.checked } : entry),
              })}
            />
            Queue for Generate all
          </label>

          <div>
            <span className="director-tab__label">Shots</span>
            <div className="director-tab__list">
              {clip.beats.map((beat: DirectorBeat) => (
                <button
                  key={beat.n}
                  type="button"
                  className={`director-tab__beat${beat.n === selectedBeatN ? ' director-tab__beat--active' : ''}`}
                  onClick={() => onSelectBeat(beat.n)}
                >
                  <span className="director-tab__item-title">SHOT {beat.n} ({beat.from}–{beat.to})</span>
                  <span className="director-tab__meta">{beat.cam || beat.text}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="director-tab__row">
            <button type="button" className="director-tab__btn" onClick={() => setVariant({ kind: 'full' })}>
              Full
            </button>
            <button
              type="button"
              className="director-tab__btn"
              onClick={() => setVariant({ kind: 'isolated', beatN: selectedBeatN, mode: 'held' })}
              disabled={!clip.beats.some((beat) => beat.n === selectedBeatN)}
            >
              Hold to {clip.seconds}s
            </button>
            <button
              type="button"
              className="director-tab__btn"
              onClick={() => setVariant({ kind: 'isolated', beatN: selectedBeatN, mode: 'native' })}
              disabled={!clip.beats.some((beat) => beat.n === selectedBeatN)}
            >
              Native length
            </button>
          </div>
          <span className="director-tab__meta">
            Active: {clip.activeVariant.kind === 'full'
              ? 'Full multishot'
              : `Shot ${clip.activeVariant.beatN} · ${clip.activeVariant.mode}`}
          </span>

          <div>
            <span className="director-tab__label">Takes</span>
            <div className="director-tab__takes">
              {takes.length === 0 && <span className="director-tab__empty">None yet</span>}
              {takes.map((take) => (
                <button
                  key={take.id}
                  type="button"
                  className={`director-tab__take${take.id === selectedTake?.id ? ' director-tab__take--active' : ''}${take.hero ? ' director-tab__take--hero' : ''}`}
                  onClick={() => onChange({ ...show, selectedTakeId: take.id })}
                  onDoubleClick={() => onChange(setHeroTake(show, clip.id, take.id))}
                  title={take.status}
                >
                  T{String(take.number).padStart(2, '0')}{take.hero ? ' ★' : ''}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
