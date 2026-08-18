import type { DirectorShow } from '@/types/director';
import { selectedScene } from '@/lib/director/director-state';

interface DirectorShotlistTabProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
  onShotlist: (sceneOnly: boolean) => void;
  onSelectClip: (sceneId: string, clipId: string) => void;
}

export function DirectorShotlistTab({ show, onChange, onShotlist, onSelectClip }: DirectorShotlistTabProps) {
  const scene = selectedScene(show);
  const sceneClips = show.clips.filter((clip) => clip.sceneId === scene?.id);

  return (
    <div className="director-tab__stage">
      <div className="director-tab__row">
        <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onShotlist(false)} disabled={!show.sourceText.trim() || !show.breakdownApproved}>
          Shotlist show
        </button>
        <button type="button" className="director-tab__btn" onClick={() => onShotlist(true)} disabled={!show.selectedSceneId || !show.breakdownApproved}>
          Shotlist scene
        </button>
      </div>

      {show.scenes.length === 0 ? (
        <p className="director-tab__empty">Approve a breakdown, then run a shotlist to fill this board.</p>
      ) : (
        <>
          {scene && (
            <div className="director-tab__fields">
              <div>
                <label className="director-tab__label" htmlFor="director-scene-event">Scene event</label>
                <input
                  id="director-scene-event"
                  value={scene.event ?? ''}
                  placeholder="The one event every character here takes part in or mirrors"
                  onChange={(event) => onChange({ ...show, scenes: show.scenes.map((entry) => entry.id === scene.id ? { ...entry, event: event.target.value } : entry) })}
                />
              </div>
              <div>
                <input
                  value={scene.physicalAction ?? ''}
                  placeholder="Physical action — the surface activity it plays through"
                  onChange={(event) => onChange({ ...show, scenes: show.scenes.map((entry) => entry.id === scene.id ? { ...entry, physicalAction: event.target.value } : entry) })}
                />
              </div>
            </div>
          )}

          <div>
            <span className="director-tab__label">{scene?.label ?? 'Clips'}</span>
            <div className="director-tab__board">
              {sceneClips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className={`director-tab__clipcard${clip.id === show.selectedClipId ? ' director-tab__clipcard--active' : ''}`}
                  onClick={() => onSelectClip(clip.sceneId, clip.id)}
                >
                  <div className="director-tab__clipcard-body">
                    <div className="director-tab__item-title">{clip.id} — {clip.title}</div>
                    <span className="director-tab__meta">
                      {clip.seconds}s · {clip.beats.length} shots
                      {clip.altOf ? ' · alt' : ''}
                      {clip.queued ? ' · queued' : ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
