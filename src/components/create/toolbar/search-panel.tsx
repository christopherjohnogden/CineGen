

import { useState, useRef, useEffect, useCallback } from 'react';
import { useWorkspace } from '@/components/workspace/workspace-shell';

export function SearchPanel() {
  const { state, dispatch } = useWorkspace();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = query.trim()
    ? state.nodes.filter((n) =>
        n.data.label.toLowerCase().includes(query.toLowerCase()),
      )
    : [];

  const handleSelect = useCallback(
    (nodeId: string) => {
      // Select the node via workspace state
      dispatch({
        type: 'SET_NODES',
        nodes: state.nodes.map((n) => ({ ...n, selected: n.id === nodeId })),
      });
      // Tell the canvas to fitView on this node
      window.dispatchEvent(
        new CustomEvent('cinegen:fit-node', { detail: nodeId }),
      );
    },
    [dispatch, state.nodes],
  );

  return (
    <div className="toolbar-panel">
      <div className="toolbar-panel__header">Search</div>
      <input
        ref={inputRef}
        type="text"
        className="toolbar-panel__search"
        placeholder="Find nodes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="toolbar-panel__list">
        {matches.map((node) => (
          <button
            key={node.id}
            className="toolbar-panel__list-item"
            onClick={() => handleSelect(node.id)}
          >
            {node.data.label}
          </button>
        ))}
        {query.trim() && matches.length === 0 && (
          <div className="toolbar-panel__empty">No nodes found</div>
        )}
        {!query.trim() && (
          <div className="toolbar-panel__empty">Type to search nodes on canvas</div>
        )}
      </div>
    </div>
  );
}
