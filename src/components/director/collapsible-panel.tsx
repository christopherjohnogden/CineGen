import type { ReactNode } from 'react';

interface CollapsiblePanelProps {
  side: 'left' | 'right';
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

export function CollapsiblePanel({ side, open, onToggle, children }: CollapsiblePanelProps) {
  return (
    <aside className={`dse-panel dse-panel--${side}`} aria-hidden={!open}>
      <button
        type="button"
        className={`dse-notch dse-notch--${side}`}
        title="Collapse panel"
        onClick={() => onToggle(false)}
      >
        {side === 'left' ? '‹' : '›'}
      </button>
      {children}
    </aside>
  );
}
