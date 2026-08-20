import { useState, type Ref } from 'react';
import type { ScriptScene } from '@/lib/director/scene-split';
import { findMatchingElement } from '@/lib/director/breakdown';
import type { DirectorBreakdownItem } from '@/types/director';
import type { Element } from '@/types/elements';

interface BreakdownAssetCardProps {
  item: DirectorBreakdownItem;
  source: 'auto' | 'ai' | 'manual';
  scene: ScriptScene;
  elements: Element[];
  focused?: boolean;
  flashRef?: Ref<HTMLDivElement>;
  onRemove: (tag: string) => void;
  onAssign: (tag: string, elementId: string) => void;
  onCreate: (item: DirectorBreakdownItem) => void;
  onGenerateRef: (item: DirectorBreakdownItem) => void;
  onEditDescription: (tag: string, description: string) => void;
}

function locationPill(item: DirectorBreakdownItem, scene: ScriptScene): string | null {
  if (item.kind !== 'location') return null;
  const intExt = (item.intExt || scene.intExt || '').replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
  const tod = (item.timeOfDay || scene.timeOfDay || '').replace(/\s+/g, '').toUpperCase();
  if (!intExt && !tod) return null;
  return [intExt, tod].filter(Boolean).join('-');
}

export function BreakdownAssetCard({
  item, source, scene, elements, focused, flashRef,   onRemove, onAssign, onCreate, onGenerateRef, onEditDescription,
}: BreakdownAssetCardProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const linked = elements.find((entry) => entry.id === item.elementId)
    ?? findMatchingElement(elements, item);
  const img = linked?.images?.[0]?.url;
  const suggested = !linked;
  const status = source === 'ai' && suggested ? 'ai' : linked ? 'linked' : 'suggestion';
  const candidates = elements.filter((entry) => entry.type === item.kind);
  const pill = locationPill(item, scene);

  return (
    <div
      className={`dbk-card${focused ? ' dbk-card--flash' : ''}${suggested ? ' dbk-card--suggest' : ''}`}
      ref={focused ? flashRef : undefined}
    >
      <div className={`dbk-card-ref dbk-icn--${item.kind}`}>
        {img ? <img src={img} alt="" /> : (
          <span className="dbk-card-ref-ph">{item.kind === 'character' ? item.name[0] : ''}</span>
        )}
      </div>
      <div className="dbk-card-body">
        <div className="dbk-card-top">
          <div className="dbk-card-id">
            <div className="dbk-card-name">
              <span className="director-tab__item-title">{item.name}</span>
              {pill && <span className="dbk-tod">{pill}</span>}
            </div>
            <div className="director-tab__meta">{item.tag}</div>
          </div>
          <span className={`dbk-status dbk-status--${status}`}>
            {status === 'ai' ? 'AI-added' : status === 'linked' ? 'linked' : 'suggestion'}
          </span>
          <button type="button" className="director-tab__btn dbk-card-x" title="Remove from scene" onClick={() => onRemove(item.tag)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div
          className="director-tab__meta dbk-card-desc"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(event) => {
            const text = event.currentTarget.textContent ?? '';
            if (text !== item.description) onEditDescription(item.tag, text);
          }}
        >
          {item.description}
        </div>
        {assignOpen && (
          <div className="dbk-assign">
            {candidates.length === 0 && (
              <p className="director-tab__empty">No {item.kind}s in the library yet.</p>
            )}
            {candidates.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`dbk-assign-item${entry.id === linked?.id ? ' dbk-assign-item--on' : ''}`}
                onClick={() => { onAssign(item.tag, entry.id); setAssignOpen(false); }}
              >
                {entry.images[0]?.url
                  ? <img src={entry.images[0].url} alt="" />
                  : <span className={`dbk-assign-ph dbk-icn--${item.kind}`} />}
                <span>{entry.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="dbk-card-actions">
          {suggested ? (
            <>
              <button type="button" className="director-tab__btn" onClick={() => setAssignOpen((open) => !open)}>
                Assign to existing
              </button>
              <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onCreate(item)}>
                Create new element
              </button>
            </>
          ) : (
            <>
              <button type="button" className="director-tab__btn" onClick={() => setAssignOpen((open) => !open)}>
                Re-assign
              </button>
              <button type="button" className="director-tab__btn" onClick={() => onGenerateRef(item)}>
                {img ? 'Generate ref' : 'Add ref'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
