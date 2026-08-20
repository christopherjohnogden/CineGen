import { useEffect, useRef } from 'react';
import type { ScriptScene } from '@/lib/director/scene-split';
import { resolveSceneAssets } from '@/lib/director/scene-assets';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';
import { BreakdownAssetCard } from './breakdown-asset-card';

interface SceneAssetsPanelProps {
  show: DirectorShow;
  scene: ScriptScene;
  sceneIndex: number;
  elements: Element[];
  activeKind: 'all' | BreakdownKind;
  focusName?: string;
  onSetKind: (k: 'all' | BreakdownKind) => void;
  onRemove: (tag: string) => void;
  onGenerateRef: (item: DirectorBreakdownItem) => void;
  onEditDescription: (tag: string, description: string) => void;
  onAssign: (tag: string, elementId: string) => void;
  onCreate: (item: DirectorBreakdownItem) => void;
}

const KIND_LABEL: Record<BreakdownKind, string> = { character: 'Characters', location: 'Locations', prop: 'Props', vehicle: 'Vehicles' };

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function SceneAssetsPanel({
  show, scene, sceneIndex, elements, activeKind, focusName,
  onSetKind, onRemove, onGenerateRef, onEditDescription, onAssign, onCreate,
}: SceneAssetsPanelProps) {
  const resolved = resolveSceneAssets(show, sceneIndex, show.breakdown, scene);
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
        {kinds.map((kind) => {
          const items = resolved.filter((row) => row.item.kind === kind);
          if (activeKind === 'all' && items.length === 0) return null;
          return (
            <div key={kind} className="dbk-card-group">
              <span className="director-tab__label">{KIND_LABEL[kind]} ({items.length})</span>
              {items.length === 0 && <p className="director-tab__empty">None in this scene.</p>}
              {items.map(({ item, source }) => (
                <BreakdownAssetCard
                  key={item.tag}
                  item={item}
                  source={source}
                  scene={scene}
                  elements={elements}
                  focused={Boolean(focusName && normName(item.name) === normName(focusName))}
                  flashRef={flashRef}
                  onRemove={onRemove}
                  onAssign={onAssign}
                  onCreate={onCreate}
                  onGenerateRef={onGenerateRef}
                  onEditDescription={onEditDescription}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
