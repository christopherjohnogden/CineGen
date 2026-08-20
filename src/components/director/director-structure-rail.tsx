import type { DirectorShow } from '@/types/director';
import { selectedClip } from '@/lib/director/director-state';
import { clipDisplayLabels } from '@/lib/director/shotlist';
import { formatUsd, spendTitle } from '@/lib/llm/openai-usage';

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

  if (show.scenes.length === 0) {
    return (
      <aside className="director-tab__rail">
        <div className="director-tab__rail-scroll">
          <span className="director-tab__label">Structure</span>
          <p className="director-tab__empty">Approve a breakdown, then run a shotlist to fill this rail.</p>
        </div>
        <RailSpend spend={show.llmSpend} />
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
        return (
          <div key={scene.id} className={`director-tab__scene${scene.id === filterSceneId ? ' director-tab__scene--active' : ''}`}>
            <button type="button" className="director-tab__scene-head" title={scene.label} onClick={() => onSelectScene(scene.id)}>
              <span className="director-tab__rail-scenetop">
                <span className="director-tab__rail-scenenum">Scene {scene.number}</span>
                <span className="director-tab__rail-count">{clips.length}</span>
              </span>
              <span className="director-tab__rail-sceneheading">{scene.label}</span>
            </button>
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
        );
      })}
      </div>
      <RailSpend spend={show.llmSpend} />
    </aside>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)));
}

function RailSpend({ spend }: { spend: DirectorShow['llmSpend'] }) {
  const tokens = (spend?.promptTokens ?? 0) + (spend?.completionTokens ?? 0);
  const title = spend && spend.requestCount > 0
    ? spendTitle(spend)
    : "OpenAI Luna spend for this show. Priced from each response's token counts at official Luna rates.";
  return (
    <div className="director-tab__rail-spend" title={title}>
      <div className="copilot__sidebar-usage">
        <div className="copilot__sidebar-usage-row">
          <span>Spend</span>
          <span className="copilot__sidebar-usage-val copilot__sidebar-usage-val--accent">{formatUsd(spend?.cost ?? 0)}</span>
        </div>
        <div className="copilot__sidebar-usage-row">
          <span>Tokens</span>
          <span className="copilot__sidebar-usage-val">{formatCount(tokens)}</span>
        </div>
        <div className="copilot__sidebar-usage-row">
          <span>Requests</span>
          <span className="copilot__sidebar-usage-val">{formatCount(spend?.requestCount ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}
