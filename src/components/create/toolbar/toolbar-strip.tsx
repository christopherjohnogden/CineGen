

import { useState, useCallback } from 'react';
import { SearchPanel } from './search-panel';
import { ModelsPanel } from './models-panel';
import { HistoryPanel } from './history-panel';
import { useWorkspace } from '@/components/workspace/workspace-shell';

type PanelId = 'search' | 'models' | 'history' | null;

interface ToolbarStripProps {
  onAddNode: (nodeType: string) => void;
}

export function ToolbarStrip({ onAddNode }: ToolbarStripProps) {
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const { dispatch } = useWorkspace();

  const togglePanel = useCallback((id: PanelId) => {
    setActivePanel((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="toolbar">
      <div className="toolbar__strip">
        <div className="toolbar__top">
          <button
            className={`toolbar__btn${activePanel === 'search' ? ' toolbar__btn--active' : ''}`}
            onClick={() => togglePanel('search')}
            title="Search"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          <button
            className={`toolbar__btn${activePanel === 'models' ? ' toolbar__btn--active' : ''}`}
            onClick={() => togglePanel('models')}
            title="Models"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>

          <button
            className={`toolbar__btn${activePanel === 'history' ? ' toolbar__btn--active' : ''}`}
            onClick={() => togglePanel('history')}
            title="History"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
        </div>

        <div className="toolbar__bottom">
          <button
            className="toolbar__btn"
            onClick={() => dispatch({ type: 'SET_TAB', tab: 'settings' })}
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {activePanel && (
        <div className="toolbar__panel">
          {activePanel === 'search' && <SearchPanel />}
          {activePanel === 'models' && (
            <ModelsPanel
              onSelect={(nodeType) => {
                onAddNode(nodeType);
                setActivePanel(null);
              }}
            />
          )}
          {activePanel === 'history' && <HistoryPanel />}
        </div>
      )}
    </div>
  );
}
