import { useState } from 'react';
import type { Screenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import type { DirectorBreakdownItem, DirectorShow } from '@/types/director';
import { DirectorSpendCard } from './director-spend-card';

interface DirectorScriptAssetsProps {
  doc: Screenplay;
  breakdown: DirectorBreakdownItem[];
  spend: DirectorShow['llmSpend'];
  onJumpToScene: (sceneIndex: number) => void;
}

type Tab = 'scenes' | 'character' | 'location' | 'prop';

export function DirectorScriptAssets({ doc, breakdown, spend, onJumpToScene }: DirectorScriptAssetsProps) {
  const [tab, setTab] = useState<Tab>('scenes');
  const scenes = splitScenes(doc);
  const byKind = (k: 'character' | 'location' | 'prop') => breakdown.filter((b) => b.kind === k);

  return (
    <div className="dse-leftfill">
      <div className="dse-leftfill-scroll">
        <div className="dast-tabs">
          <button type="button" className={`dast-tab${tab === 'scenes' ? ' dast-tab--on' : ''}`} onClick={() => setTab('scenes')}>Scenes<span className="cnt">{scenes.length}</span></button>
          <button type="button" className={`dast-tab${tab === 'character' ? ' dast-tab--on' : ''}`} onClick={() => setTab('character')}><span className="dast-pip dast-pip--character" />Cast<span className="cnt">{byKind('character').length}</span></button>
          <button type="button" className={`dast-tab${tab === 'location' ? ' dast-tab--on' : ''}`} onClick={() => setTab('location')}><span className="dast-pip dast-pip--location" />Loc<span className="cnt">{byKind('location').length}</span></button>
          <button type="button" className={`dast-tab${tab === 'prop' ? ' dast-tab--on' : ''}`} onClick={() => setTab('prop')}><span className="dast-pip dast-pip--prop" />Props<span className="cnt">{byKind('prop').length}</span></button>
        </div>
        <div className="dast-list">
          {tab === 'scenes' ? (
            scenes.length === 0 ? <p className="director-tab__empty">No scenes yet.</p> :
            scenes.map((s) => (
              <button key={s.index} type="button" className="dbk-navitem" onClick={() => onJumpToScene(s.index)}>
                <span className="dbk-navtxt">
                  <span className="dbk-navnum">SC{s.index + 1}</span>
                  <span className="dbk-navttl">{s.heading || '(untitled scene)'}</span>
                </span>
              </button>
            ))
          ) : (
            byKind(tab).length === 0 ? <p className="director-tab__empty">None yet.</p> :
            byKind(tab).map((b) => (
              <div key={b.id} className="director-tab__item">
                <span className="director-tab__item-title">{b.name}</span>
                <span className="director-tab__meta">{b.tag}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <DirectorSpendCard spend={spend} />
    </div>
  );
}
