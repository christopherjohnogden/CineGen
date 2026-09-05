import { useState } from 'react';
import type { Element } from '@/types/elements';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import { screenplayFromSource } from '@/lib/director/screenplay';
import { splitScenes, type ScriptScene } from '@/lib/director/scene-split';
import { sceneKeyMap } from '@/lib/director/cascade';
import { applyManualTag, firstScriptHit, resolveSceneAssets } from '@/lib/director/scene-assets';
import { assignBreakdownElement } from '@/lib/director/breakdown';
import { SceneScriptView } from './scene-script-view';
import { SceneAssetsPanel } from './scene-assets-panel';
import { DirectorSpendCard } from './director-spend-card';
import { ElementModal } from '@/components/elements/element-modal';

interface DirectorBreakdownTabProps {
  projectId?: string;
  show: DirectorShow;
  elements: Element[];
  dirtyKeys: string[];
  syncing: boolean;
  onChange: (show: DirectorShow) => void;
  onCreateElement: (item: DirectorBreakdownItem, data: {
    name: string;
    type: Element['type'];
    description: string;
    images: Element['images'];
    variations: NonNullable<Element['variations']>;
    activeVariationId: string;
  }) => void;
  onOpenElements: () => void;
}

export function DirectorBreakdownTab({ projectId,
  show, elements, dirtyKeys, syncing, onChange, onCreateElement, onOpenElements,
}: DirectorBreakdownTabProps) {
  const scenes = splitScenes(screenplayFromSource(show));
  const sceneKeys = sceneKeyMap(scenes);
  const keyOf = (entry: ScriptScene) => sceneKeys.get(entry) ?? (entry.heading.trim().toUpperCase() || '(untitled)');
  const [navKey, setNavKey] = useState<'all' | number>('all');
  const [scriptSceneIndex, setScriptSceneIndex] = useState(0);
  const [activeKind, setActiveKind] = useState<'all' | BreakdownKind>('all');
  const [focusName, setFocusName] = useState<string | undefined>();
  const [focusTag, setFocusTag] = useState<string | undefined>();
  const [createFor, setCreateFor] = useState<DirectorBreakdownItem | null>(null);
  const scriptScene = scenes[scriptSceneIndex] ?? scenes[0];

  if (!scriptScene) {
    return <div className="director-tab__stage"><p className="director-tab__empty">Run a breakdown from the Script tab to populate scenes.</p></div>;
  }

  const selectScene = (index: number) => {
    setNavKey(index);
    setScriptSceneIndex(index);
    setActiveKind('all');
    setFocusTag(undefined);
  };

  const selectAllScenes = () => {
    setNavKey('all');
    setActiveKind('all');
    setFocusTag(undefined);
  };

  const removeFromScene = (tag: string) => {
    const indices = navKey === 'all'
      ? scenes.map((_, index) => index).filter((index) => (
        resolveSceneAssets(show, index, show.breakdown, scenes[index]).some((row) => row.item.tag === tag)
      ))
      : [navKey];
    let overrides = { ...show.sceneAssetOverrides };
    for (const index of indices) {
      const ov = overrides?.[index] ?? { added: [], removed: [] };
      overrides = {
        ...overrides,
        [index]: { added: ov.added.filter((t) => t !== tag), removed: [...new Set([...ov.removed, tag])] },
      };
    }
    onChange({ ...show, sceneAssetOverrides: overrides });
  };

  const onAssetClick = (kind: BreakdownKind, name: string) => {
    if (activeKind !== 'all' && activeKind !== kind) setActiveKind(kind);
    setFocusName(undefined);
    requestAnimationFrame(() => setFocusName(name));
  };

  const jumpToScript = (item: DirectorBreakdownItem) => {
    const prefer = navKey === 'all' ? scriptSceneIndex : navKey;
    const hit = firstScriptHit(scenes, show, item, prefer);
    if (hit && hit.sceneIndex !== scriptSceneIndex) setScriptSceneIndex(hit.sceneIndex);
    if (hit && navKey !== 'all') setNavKey(hit.sceneIndex);
    setFocusTag(undefined);
    requestAnimationFrame(() => setFocusTag(item.tag));
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
        <div className="dbk-nav-scroll">
          <span className="director-tab__label">Scenes</span>
          <div
            className={`dbk-navitem${navKey === 'all' ? ' dbk-navitem--on' : ''}`}
            onClick={selectAllScenes}
          >
            <div className="dbk-navtxt">
              <div className="dbk-navnum">ALL</div>
              <div className="dbk-navttl">All scenes</div>
            </div>
          </div>
          {scenes.map((entry) => (
            <div
              key={entry.index}
              className={`dbk-navitem${navKey === entry.index ? ' dbk-navitem--on' : ''}`}
              onClick={() => selectScene(entry.index)}
            >
              <div className="dbk-navtxt">
                <div className="dbk-navnum">SC{entry.index + 1}</div>
                <div className="dbk-navttl">{entry.heading || '(untitled scene)'}</div>
              </div>
              <span className={`dbk-syncdot dbk-syncdot--${syncing ? 'run' : dirtyKeys.includes(keyOf(entry)) ? 'stale' : 'ok'}`} />
            </div>
          ))}
        </div>
        <DirectorSpendCard spend={show.llmSpend} />
      </aside>

      <SceneScriptView
        scenes={scenes}
        filter={navKey}
        focusSceneIndex={scriptSceneIndex}
        show={show}
        onAssetClick={onAssetClick}
        onTagSelection={tagSelection}
        focusTag={focusTag}
      />

      <aside className="dbk-assets">
        <SceneAssetsPanel
          show={show}
          scenes={scenes}
          filter={navKey}
          elements={elements}
          activeKind={activeKind}
          focusName={focusName}
          onSetKind={setActiveKind}
          onRemove={removeFromScene}
          onGenerateRef={() => onOpenElements()}
          onEditDescription={(tag, description) => onChange({ ...show, breakdown: show.breakdown.map((item) => (item.tag === tag ? { ...item, description } : item)) })}
          onAssign={(tag, elementId) => onChange({ ...show, breakdown: assignBreakdownElement(show.breakdown, tag, elementId) })}
          onCreate={setCreateFor}
          onJump={jumpToScript}
        />
      </aside>

      {createFor && (
        <ElementModal
          projectId={projectId}
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
