import { useState } from 'react';
import type { Screenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import type { DirectorBreakdownItem } from '@/types/director';

interface DirectorScriptAssetsProps {
  doc: Screenplay;
  breakdown: DirectorBreakdownItem[];
  onJumpToScene: (sceneIndex: number) => void;
}

type Tab = 'scenes' | 'character' | 'location' | 'prop';

export function DirectorScriptAssets({ doc, breakdown, onJumpToScene }: DirectorScriptAssetsProps) {
  const [tab, setTab] = useState<Tab>('scenes');
  const scenes = splitScenes(doc);
  const byKind = (k: 'character' | 'location' | 'prop') => breakdown.filter((b) => b.kind === k);

  return (
    <>
      <div className="dast-tabs">
        <button type="button" className={`dast-tab${tab === 'scenes' ? ' dast-tab--on' : ''}`} onClick={() => setTab('scenes')}>Scenes<span className="cnt">{scenes.length}</span></button>
        <button type="button" className={`dast-tab${tab === 'character' ? ' dast-tab--on' : ''}`} onClick={() => setTab('character')}><span className="dast-pip dast-pip--character" />Cast<span className="cnt">{byKind('character').length}</span></button>
        <button type="button" className={`dast-tab${tab === 'location' ? ' dast-tab--on' : ''}`} onClick={() => setTab('location')}><span className="dast-pip dast-pip--location" />Loc<span className="cnt">{byKind('location').length}</span></button>
        <button type="button" className={`dast-tab${tab === 'prop' ? ' dast-tab--on' : ''}`} onClick={() => setTab('prop')}><span className="dast-pip dast-pip--prop" />Props<span className="cnt">{byKind('prop').length}</span></button>
      </div>
      <div style={{ padding: 12 }}>
        {tab === 'scenes' ? (
          scenes.length === 0 ? <p className="director-tab__empty">No scenes yet.</p> :
          scenes.map((s) => (
            <button key={s.index} type="button" className="dbk-navitem" style={{ width: '100%', textAlign: 'left' }} onClick={() => onJumpToScene(s.index)}>
              <div className="dbk-navnum">SC{s.index + 1}</div>
              <div className="dbk-navttl">{s.heading || '(untitled scene)'}</div>
            </button>
          ))
        ) : (
          byKind(tab).length === 0 ? <p className="director-tab__empty">None yet.</p> :
          byKind(tab).map((b) => (
            <div key={b.id} className="director-tab__item" style={{ marginBottom: 6 }}>
              <span className="director-tab__item-title">{b.name}</span>
              <span className="director-tab__meta">{b.tag}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
