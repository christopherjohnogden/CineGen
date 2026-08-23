import { useEffect, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { selectedClip } from '@/lib/director/director-state';
import { clipDisplayLabels } from '@/lib/director/shotlist';
import { DirectorSpendCard } from './director-spend-card';

interface DirectorStructureRailProps {
  show: DirectorShow;
  /** Scene the stage is filtered to; null = showing all scenes. */
  filterSceneId: string | null;
  onShowAll: () => void;
  onSelectScene: (sceneId: string) => void;
  onSelectClip: (sceneId: string, clipId: string) => void;
}

export function DirectorStructureRail({ show, filterSceneId, onShowAll, onSelectScene, onSelectClip }: DirectorStructureRailProps) {
  const activeClip = selectedClip(show);
  const clipLabels = clipDisplayLabels(show.scenes, show.clips);
  const totalClips = show.clips.filter((clip) => !clip.altOf).length;
  const [collapsedSceneIds, setCollapsedSceneIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!filterSceneId) return;
    setCollapsedSceneIds((current) => {
      if (!current.has(filterSceneId)) return current;
      const next = new Set(current);
      next.delete(filterSceneId);
      return next;
    });
  }, [filterSceneId]);

  const selectScene = (sceneId: string) => {
    setCollapsedSceneIds((current) => {
      if (!current.has(sceneId)) return current;
      const next = new Set(current);
      next.delete(sceneId);
      return next;
    });
    onSelectScene(sceneId);
  };

  const toggleScene = (sceneId: string) => {
    setCollapsedSceneIds((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  if (show.scenes.length === 0) {
    return (
      <aside className="director-tab__rail">
        <div className="director-tab__rail-scroll">
          <span className="director-tab__label">Structure</span>
          <p className="director-tab__empty">Run a breakdown, then shotlist to fill this rail.</p>
        </div>
        <DirectorSpendCard spend={show.llmSpend} />
      </aside>
    );
  }

  return (
    <aside className="director-tab__rail">
      <div className="director-tab__rail-scroll">
        <span className="director-tab__label">Structure</span>
      <button
        type="button"
        className={`director-tab__rail-all${filterSceneId === null ? ' director-tab__rail-all--active' : ''}`}
        onClick={onShowAll}
      >
        <span>All scenes</span>
        <span className="director-tab__rail-count">{totalClips}</span>
      </button>
      {show.scenes.map((scene) => {
        const clips = show.clips.filter((clip) => clip.sceneId === scene.id);
        const collapsed = collapsedSceneIds.has(scene.id);
        const clipListId = `director-rail-scene-${scene.id}`;
        return (
          <div key={scene.id} className={`director-tab__scene${scene.id === filterSceneId ? ' director-tab__scene--active' : ''}${collapsed ? ' director-tab__scene--collapsed' : ''}`}>
            <div className="director-tab__scene-head">
              <button type="button" className="director-tab__scene-select" title={scene.label} onClick={() => selectScene(scene.id)}>
                <span className="director-tab__rail-scenetop">
                  <span className="director-tab__rail-scenenum">Scene {scene.number}</span>
                  <span className="director-tab__rail-count">{clips.length}</span>
                </span>
                <span className="director-tab__rail-sceneheading">{scene.label}</span>
              </button>
              <button
                type="button"
                className="director-tab__scene-toggle"
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} Scene ${scene.number}`}
                aria-expanded={!collapsed}
                aria-controls={clipListId}
                onClick={() => toggleScene(scene.id)}
              >
                <span className="director-tab__scene-chevron" aria-hidden="true" />
              </button>
            </div>
            {!collapsed && (
              <div id={clipListId} className="director-tab__scene-clips">
                {clips.map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    className={`director-tab__rail-clip${clip.id === activeClip?.id ? ' director-tab__rail-clip--active' : ''}`}
                    title={`${clipLabels.get(clip.id) ?? ''} ${clip.title} · ${clip.seconds}s · ${clip.beats.length} shot${clip.beats.length === 1 ? '' : 's'}`}
                    onClick={() => onSelectClip(scene.id, clip.id)}
                  >
                    <span className="director-tab__rail-check" title={clip.queued ? 'Queued for Generate' : undefined} aria-label={clip.queued ? 'Queued' : undefined}>
                      {clip.queued ? '✓' : ''}
                    </span>
                    <span className={`director-tab__rail-strikewrap${clip.queued ? ' director-tab__rail-strikewrap--queued' : ''}`}>
                      <span className="director-tab__rail-cid">{clipLabels.get(clip.id)}</span>
                      <span className="director-tab__rail-title">{clip.title}</span>
                    </span>
                    <span className="director-tab__rail-secs">{clip.seconds}s</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>
      <DirectorSpendCard spend={show.llmSpend} />
    </aside>
  );
}
