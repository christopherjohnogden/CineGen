

import { useWorkspace } from '@/components/workspace/workspace-shell';

export function HistoryPanel() {
  const { state } = useWorkspace();

  const completedNodes = state.nodes.filter(
    (n) => n.data.result?.status === 'complete' && n.data.result?.url,
  );

  return (
    <div className="toolbar-panel">
      <div className="toolbar-panel__header">History</div>
      <div className="toolbar-panel__list">
        {completedNodes.length === 0 ? (
          <div className="toolbar-panel__empty">
            No generations yet. Run a model to see results here.
          </div>
        ) : (
          completedNodes.map((node) => (
            <div key={node.id} className="history-panel__item">
              {node.data.result?.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={node.data.result.url}
                  alt={node.data.label}
                  className="history-panel__thumb"
                />
              )}
              <div className="history-panel__info">
                <span className="history-panel__name">{node.data.label}</span>
                <span className="history-panel__type">{node.data.type}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
