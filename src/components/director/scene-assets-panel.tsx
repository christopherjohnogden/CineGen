import { useEffect, useRef } from 'react';
import type { ScriptScene } from '@/lib/director/scene-split';
import { resolveAllSceneAssets, resolveSceneAssets } from '@/lib/director/scene-assets';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';
import { BreakdownAssetCard } from './breakdown-asset-card';

interface SceneAssetsPanelProps {
  show: DirectorShow;
  scenes: ScriptScene[];
  filter: number | 'all';
  elements: Element[];
  activeKind: 'all' | BreakdownKind;
  focusName?: string;
  onSetKind: (k: 'all' | BreakdownKind) => void;
  onRemove: (tag: string) => void;
  onGenerateRef: (item: DirectorBreakdownItem) => void;
  onEditDescription: (tag: string, description: string) => void;
  onAssign: (tag: string, elementId: string) => void;
  onCreate: (item: DirectorBreakdownItem) => void;
  onJump: (item: DirectorBreakdownItem) => void;
}

const KIND_LABEL: Record<BreakdownKind, string> = { character: 'Characters', location: 'Locations', prop: 'Props', vehicle: 'Vehicles' };

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function SceneAssetsPanel({
  show, scenes, filter, elements, activeKind, focusName,
  onSetKind, onRemove, onGenerateRef, onEditDescription, onAssign, onCreate, onJump,
}: SceneAssetsPanelProps) {
  const resolved = filter === 'all'
    ? resolveAllSceneAssets(show, scenes)
    : scenes[filter]
      ? resolveSceneAssets(show, filter, show.breakdown, scenes[filter]).map((row) => (
        { ...row, sceneIndex: filter }
      ))
      : [];
  const counts = { character: 0, location: 0, prop: 0, vehicle: 0 } as Record<BreakdownKind, number>;
  resolved.forEach((row) => { counts[row.item.kind] += 1; });
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusName && flashRef.current) {
      flashRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashRef.current.classList.remove('dbk-card--flash');
      void flashRef.current.offsetWidth;
      flashRef.current.classList.add('dbk-card--flash');
    }
  }, [focusName]);

  const kinds: BreakdownKind[] = activeKind === 'all' ? ['character', 'location', 'prop', 'vehicle'] : [activeKind];
  const emptyLabel = filter === 'all' ? 'None in the show.' : 'None in this scene.';

  return (
    <>
      <div className="dast-tabs">
        <button type="button" className={`dast-tab${activeKind === 'all' ? ' dast-tab--on' : ''}`} onClick={() => onSetKind('all')}>All<span className="cnt">{resolved.length}</span></button>
        {(['character', 'location', 'prop', 'vehicle'] as BreakdownKind[]).map((kind) => (
          <button key={kind} type="button" className={`dast-tab${activeKind === kind ? ' dast-tab--on' : ''}`} onClick={() => onSetKind(kind)}>
            <span className={`dast-pip dast-pip--${kind}`} />{KIND_LABEL[kind]}<span className="cnt">{counts[kind]}</span>
          </button>
        ))}
      </div>
      <div className="dbk-card-list">
        {show.breakdown.length === 0 && show.jobStatus?.type === 'breakdown' && !show.jobStatus.error && (
          <p className="director-tab__empty">The LLM is breaking down the script…</p>
        )}
        {show.breakdown.length === 0 && !(show.jobStatus?.type === 'breakdown' && !show.jobStatus.error) && (
          <p className="director-tab__empty">Run a breakdown to list characters, locations, props and vehicles.</p>
        )}
        {kinds.map((kind) => {
          const items = resolved.filter((row) => row.item.kind === kind);
          if (activeKind === 'all' && items.length === 0) return null;
          return (
            <div key={kind} className="dbk-card-group">
              <span className="director-tab__label">{KIND_LABEL[kind]} ({items.length})</span>
              {items.length === 0 && <p className="director-tab__empty">{emptyLabel}</p>}
              {items.map(({ item, source, sceneIndex }) => (
                <BreakdownAssetCard
                  key={item.tag}
                  item={item}
                  source={source}
                  scene={scenes[sceneIndex] ?? scenes[0]}
                  elements={elements}
                  focused={Boolean(focusName && normName(item.name) === normName(focusName))}
                  flashRef={flashRef}
                  onRemove={onRemove}
                  onAssign={onAssign}
                  onCreate={onCreate}
                  onGenerateRef={onGenerateRef}
                  onEditDescription={onEditDescription}
                  onJump={onJump}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
