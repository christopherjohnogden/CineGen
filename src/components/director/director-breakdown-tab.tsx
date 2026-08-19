import { useState } from 'react';
import type { Element } from '@/types/elements';
import type { BreakdownKind, DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes, type ScriptScene } from '@/lib/director/scene-split';
import { sceneKeyMap } from '@/lib/director/cascade';
import { applyManualTag } from '@/lib/director/scene-assets';
import { SceneScriptView } from './scene-script-view';
import { SceneAssetsPanel } from './scene-assets-panel';

interface DirectorBreakdownTabProps {
  show: DirectorShow;
  elements: Element[];
  dirtyKeys: string[];
  syncing: boolean;
  onChange: (show: DirectorShow) => void;
  onApprove: () => void;
  onCreateMissing: () => void;
  onOpenElements: () => void;
}

export function DirectorBreakdownTab({ show, elements, dirtyKeys, syncing, onChange, onApprove, onCreateMissing, onOpenElements }: DirectorBreakdownTabProps) {
  const scenes = splitScenes(parseToScreenplay(show.sourceText));
  const sceneKeys = sceneKeyMap(scenes);
  const keyOf = (s: ScriptScene) => sceneKeys.get(s) ?? (s.heading.trim().toUpperCase() || '(untitled)');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [activeKind, setActiveKind] = useState<'all' | BreakdownKind>('all');
  const [focusName, setFocusName] = useState<string | undefined>();
  const scene = scenes[sceneIndex] ?? scenes[0];

  if (!scene) {
    return <div className="director-tab__stage"><p className="director-tab__empty">Run a breakdown from the Script tab to populate scenes.</p></div>;
  }

  const removeFromScene = (tag: string) => {
    const ov = show.sceneAssetOverrides?.[sceneIndex] ?? { added: [], removed: [] };
    const next = { added: ov.added.filter((t) => t !== tag), removed: [...new Set([...ov.removed, tag])] };
    onChange({ ...show, sceneAssetOverrides: { ...show.sceneAssetOverrides, [sceneIndex]: next } });
  };

  const onAssetClick = (kind: BreakdownKind, name: string) => {
    if (activeKind !== 'all' && activeKind !== kind) setActiveKind(kind);
    setFocusName(undefined);
    // set on next tick so the effect re-fires even if the name repeats
    requestAnimationFrame(() => setFocusName(name));
  };

  // Manually tag a highlighted span as a breakdown element. Creates a real breakdown item
  // (so it highlights everywhere and feeds the assets panel / refs / generation), or re-kinds
  // an existing one with the same tag.
  const tagSelection = (kind: BreakdownKind, rawName: string) => {
    const res = applyManualTag(show.breakdown, kind, rawName);
    if (!res) return;
    if (res.breakdown !== show.breakdown) onChange({ ...show, breakdown: res.breakdown });
    setActiveKind(kind);
    onAssetClick(kind, res.name);
  };

  return (
    <div className="dbk-shell">
      <aside className="dbk-nav">
        <div className="director-tab__row" style={{ marginBottom: 10 }}>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onApprove} disabled={show.breakdown.length === 0 || show.breakdownApproved}>{show.breakdownApproved ? 'Approved' : 'Approve →'}</button>
        </div>
        <span className="director-tab__label">Scenes</span>
        {scenes.map((s) => (
          <div key={s.index} className={`dbk-navitem${s.index === sceneIndex ? ' dbk-navitem--on' : ''}`} onClick={() => { setSceneIndex(s.index); setActiveKind('all'); }}>
            <div className="dbk-navtxt">
              <div className="dbk-navnum">SC{s.index + 1}</div>
              <div className="dbk-navttl">{s.heading || '(untitled scene)'}</div>
            </div>
            <span className={`dbk-syncdot dbk-syncdot--${syncing ? 'run' : dirtyKeys.includes(keyOf(s)) ? 'stale' : 'ok'}`} />
          </div>
        ))}
        <div className="director-tab__row" style={{ marginTop: 10 }}>
          <button type="button" className="director-tab__btn" onClick={onCreateMissing}>Create missing</button>
          <button type="button" className="director-tab__btn" onClick={onOpenElements}>Generate refs</button>
        </div>
      </aside>

      <SceneScriptView scene={scene} breakdown={show.breakdown} onAssetClick={onAssetClick} onTagSelection={tagSelection} />

      <aside className="dbk-assets">
        <SceneAssetsPanel
          show={show}
          scene={scene}
          sceneIndex={sceneIndex}
          elements={elements}
          activeKind={activeKind}
          focusName={focusName}
          onSetKind={setActiveKind}
          onRemove={removeFromScene}
          onGenerateRef={() => onOpenElements()}
          onEditDescription={(tag, description) => onChange({ ...show, breakdown: show.breakdown.map((b) => (b.tag === tag ? { ...b, description } : b)) })}
          onRelink={() => onOpenElements()}
        />
      </aside>
    </div>
  );
}
