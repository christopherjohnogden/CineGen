import { useState } from 'react';
import type { Element } from '@/types/elements';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes, type ScriptScene } from '@/lib/director/scene-split';
import { sceneKeyMap } from '@/lib/director/cascade';
import { applyManualTag } from '@/lib/director/scene-assets';
import { assignBreakdownElement } from '@/lib/director/breakdown';
import { SceneScriptView } from './scene-script-view';
import { SceneAssetsPanel } from './scene-assets-panel';
import { ElementModal } from '@/components/elements/element-modal';

interface DirectorBreakdownTabProps {
  show: DirectorShow;
  elements: Element[];
  dirtyKeys: string[];
  syncing: boolean;
  onChange: (show: DirectorShow) => void;
  onApprove: () => void;
  onCreateElement: (item: DirectorBreakdownItem, data: {
    name: string;
    type: Element['type'];
    description: string;
    images: Element['images'];
  }) => void;
  onOpenElements: () => void;
}

export function DirectorBreakdownTab({
  show, elements, dirtyKeys, syncing, onChange, onApprove, onCreateElement, onOpenElements,
}: DirectorBreakdownTabProps) {
  const scenes = splitScenes(parseToScreenplay(show.sourceText));
  const sceneKeys = sceneKeyMap(scenes);
  const keyOf = (entry: ScriptScene) => sceneKeys.get(entry) ?? (entry.heading.trim().toUpperCase() || '(untitled)');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [activeKind, setActiveKind] = useState<'all' | BreakdownKind>('all');
  const [focusName, setFocusName] = useState<string | undefined>();
  const [createFor, setCreateFor] = useState<DirectorBreakdownItem | null>(null);
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
    requestAnimationFrame(() => setFocusName(name));
  };

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
        {scenes.map((entry) => (
          <div key={entry.index} className={`dbk-navitem${entry.index === sceneIndex ? ' dbk-navitem--on' : ''}`} onClick={() => { setSceneIndex(entry.index); setActiveKind('all'); }}>
            <div className="dbk-navtxt">
              <div className="dbk-navnum">SC{entry.index + 1}</div>
              <div className="dbk-navttl">{entry.heading || '(untitled scene)'}</div>
            </div>
            <span className={`dbk-syncdot dbk-syncdot--${syncing ? 'run' : dirtyKeys.includes(keyOf(entry)) ? 'stale' : 'ok'}`} />
          </div>
        ))}
      </aside>

      <SceneScriptView scene={scene} sceneIndex={sceneIndex} show={show} onAssetClick={onAssetClick} onTagSelection={tagSelection} />

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
          onEditDescription={(tag, description) => onChange({ ...show, breakdown: show.breakdown.map((item) => (item.tag === tag ? { ...item, description } : item)) })}
          onAssign={(tag, elementId) => onChange({ ...show, breakdown: assignBreakdownElement(show.breakdown, tag, elementId) })}
          onCreate={setCreateFor}
        />
      </aside>

      {createFor && (
        <ElementModal
          key={createFor.tag}
          defaults={{ name: createFor.name, type: createFor.kind, description: createFor.description }}
          onSave={(data) => {
            onCreateElement(createFor, data);
            setCreateFor(null);
          }}
          onClose={() => setCreateFor(null)}
        />
      )}
    </div>
  );
}
