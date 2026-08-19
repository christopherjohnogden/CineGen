import { useEffect, useRef } from 'react';
import type { ScriptScene } from '@/lib/director/scene-split';
import { resolveSceneAssets } from '@/lib/director/scene-assets';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';
import { findMatchingElement } from '@/lib/director/breakdown';

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
  onRelink: (item: DirectorBreakdownItem) => void;
}

const KIND_LABEL: Record<BreakdownKind, string> = { character: 'Characters', location: 'Locations', prop: 'Props', vehicle: 'Vehicles' };

// The highlighted <mark> carries the literal script text (e.g. "DUSTY BATTLEFIELD PLAIN"),
// whose casing/whitespace can differ from the item's name ("Dusty Battlefield Plain"). Compare
// loosely so clicking a highlight still finds its card.
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function SceneAssetsPanel({ show, scene, sceneIndex, elements, activeKind, focusName, onSetKind, onRemove, onGenerateRef, onEditDescription, onRelink }: SceneAssetsPanelProps) {
  const resolved = resolveSceneAssets(show, sceneIndex, show.breakdown, scene);
  const counts = { character: 0, location: 0, prop: 0, vehicle: 0 } as Record<BreakdownKind, number>;
  resolved.forEach((r) => { counts[r.item.kind] += 1; });
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
  const refImage = (item: DirectorBreakdownItem): string | undefined => {
    const el = elements.find((e) => e.id === item.elementId) ?? findMatchingElement(elements, item);
    return el?.images?.[0]?.url;
  };

  return (
    <>
      <div className="dast-tabs">
        <button type="button" className={`dast-tab${activeKind === 'all' ? ' dast-tab--on' : ''}`} onClick={() => onSetKind('all')}>All<span className="cnt">{resolved.length}</span></button>
        {(['character', 'location', 'prop', 'vehicle'] as BreakdownKind[]).map((k) => (
          <button key={k} type="button" className={`dast-tab${activeKind === k ? ' dast-tab--on' : ''}`} onClick={() => onSetKind(k)}>
            <span className={`dast-pip dast-pip--${k}`} />{KIND_LABEL[k]}<span className="cnt">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: 12 }}>
        {kinds.map((kind) => {
          const items = resolved.filter((r) => r.item.kind === kind);
          if (activeKind === 'all' && items.length === 0) return null;
          return (
            <div key={kind} style={{ marginBottom: 10 }}>
              <span className="director-tab__label">{KIND_LABEL[kind]} ({items.length})</span>
              {items.length === 0 && <p className="director-tab__empty">None in this scene.</p>}
              {items.map(({ item, source }) => {
                const img = refImage(item);
                const linked = item.elementId || findMatchingElement(elements, item)?.id;
                const status = source === 'ai' ? 'ai' : linked ? 'linked' : 'missing';
                return (
                  <div
                    key={item.tag}
                    className="dbk-card"
                    ref={focusName && normName(item.name) === normName(focusName) ? flashRef : undefined}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div className={`dbk-icn dbk-icn--${kind}`}>
                        {img ? <img src={img} alt={item.name} /> : (kind === 'character' ? item.name[0] : '▢')}
                      </div>
                      <div>
                        <div className="director-tab__item-title">{item.name}</div>
                        <div className="director-tab__meta">{item.tag}{kind === 'location' && (item.intExt || item.timeOfDay || scene.timeOfDay) ? <span className="dbk-tod">{(item.intExt || scene.intExt || '') + ' · ' + (item.timeOfDay || scene.timeOfDay || '')}</span> : null}</div>
                      </div>
                      <span className={`dbk-status dbk-status--${status}`}>{status === 'ai' ? '● AI-added' : status === 'linked' ? '● linked' : '○ missing'}</span>
                      <button type="button" className="director-tab__btn" style={{ padding: '2px 7px', marginLeft: 6 }} title="Remove from scene" onClick={() => onRemove(item.tag)}>✕</button>
                    </div>
                    <div
                      className="director-tab__meta"
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      style={{ marginTop: 7, outline: 'none' }}
                      onBlur={(e) => {
                        const text = e.currentTarget.textContent ?? '';
                        if (text !== item.description) onEditDescription(item.tag, text);
                      }}
                    >
                      {item.description}
                    </div>
                    <div className="director-tab__row" style={{ marginTop: 8 }}>
                      <button type="button" className="director-tab__btn" onClick={() => onRelink(item)}>
                        {status === 'missing' ? 'Create + link' : 'Re-link'}
                      </button>
                      <button type="button" className="director-tab__btn" onClick={() => onGenerateRef(item)}>{img ? 'Generate ref' : '+ Add ref'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
