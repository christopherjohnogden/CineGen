import type { DirectorShow } from '@/types/director';
import { selectedClip, selectedScene } from '@/lib/director/director-state';

interface DirectorStructureRailProps {
  show: DirectorShow;
  onSelectScene: (sceneId: string) => void;
  onSelectClip: (sceneId: string, clipId: string) => void;
}

export function DirectorStructureRail({ show, onSelectScene, onSelectClip }: DirectorStructureRailProps) {
  const activeScene = selectedScene(show);
  const activeClip = selectedClip(show);

  if (show.scenes.length === 0) {
    return (
      <aside className="director-tab__rail">
        <span className="director-tab__label">Structure</span>
        <p className="director-tab__empty">Approve a breakdown, then run a shotlist to fill this rail.</p>
      </aside>
    );
  }

  return (
    <aside className="director-tab__rail">
      <span className="director-tab__label">Structure</span>
      {show.scenes.map((scene) => {
        const clips = show.clips.filter((clip) => clip.sceneId === scene.id);
        return (
          <div key={scene.id} className={`director-tab__scene${scene.id === activeScene?.id ? ' director-tab__scene--active' : ''}`}>
            <button type="button" className="director-tab__scene-head" onClick={() => onSelectScene(scene.id)}>
              <span className="director-tab__item-title">{scene.label}</span>
              <span className="director-tab__meta">{clips.length} clips</span>
            </button>
            {clips.map((clip) => (
              <button
                key={clip.id}
                type="button"
                className={`director-tab__rail-clip${clip.id === activeClip?.id ? ' director-tab__rail-clip--active' : ''}`}
                onClick={() => onSelectClip(scene.id, clip.id)}
              >
                <span>{clip.id} — {clip.title}</span>
                <span className="director-tab__meta">{clip.seconds}s · {clip.beats.length}</span>
              </button>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
