import { useEffect } from 'react';

interface ElementDeleteConfirmProps {
  names: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ElementDeleteConfirm({ names, onConfirm, onCancel }: ElementDeleteConfirmProps) {
  const count = names.length;
  const title = count === 1 ? 'Delete Element' : `Delete ${count} Elements`;
  const description = count === 1
    ? <> <strong>{names[0]}</strong> will be permanently removed. </>
    : <>These elements will be permanently removed.</>;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="mp-confirm__backdrop" onClick={onCancel} role="presentation">
      <div
        className="mp-confirm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="element-delete-title"
      >
        <div className="mp-confirm__icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </div>
        <h3 id="element-delete-title" className="mp-confirm__title">{title}</h3>
        <p className="mp-confirm__desc">{description}</p>
        {count > 1 && names.length <= 8 && (
          <ul className="elements-tab__confirm-list">
            {names.map((name, i) => (
              <li key={`${name}-${i}`}>{name}</li>
            ))}
          </ul>
        )}
        <div className="mp-confirm__actions">
          <button type="button" className="mp-confirm__btn mp-confirm__btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="mp-confirm__btn mp-confirm__btn--delete" onClick={onConfirm} autoFocus>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
