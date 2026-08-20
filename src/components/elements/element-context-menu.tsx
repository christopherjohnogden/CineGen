import { useLayoutEffect, useRef, useState } from 'react';
import { clampMenuPosition } from '@/lib/elements/selection';
import type { ElementFolder } from '@/types/elements';

interface ElementContextMenuProps {
  x: number;
  y: number;
  count: number;
  folders: ElementFolder[];
  currentFolderId?: string;
  onMove: (folderId: string | undefined) => void;
  onDelete: () => void;
}

export function ElementContextMenu({
  x,
  y,
  count,
  folders,
  currentFolderId,
  onMove,
  onDelete,
}: ElementContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(clampMenuPosition(x, y, width, height, window.innerWidth, window.innerHeight));
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="workflow-context-menu"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="elements-tab__ctx-label">Move to folder</span>
      <button
        type="button"
        className="workflow-context-menu__item"
        onClick={() => onMove(undefined)}
      >
        Unfiled
      </button>
      {sorted.map((f) => (
        <button
          key={f.id}
          type="button"
          className="workflow-context-menu__item"
          onClick={() => onMove(f.id)}
        >
          {f.name}{currentFolderId === f.id ? ' · current' : ''}
        </button>
      ))}
      <div className="elements-tab__ctx-divider" />
      <button
        type="button"
        className="workflow-context-menu__item workflow-context-menu__item--danger"
        onClick={onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        {count > 1 ? `Delete ${count} elements` : 'Delete'}
      </button>
    </div>
  );
}
