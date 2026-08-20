import { useEffect, useState } from 'react';
import type { DirectorTake, IsolateVariant } from '@/types/director';
import type { DirectorTakeGroup } from '@/lib/director/generate';
import { deleteTakeConfirmCopy, takeChipLabel } from '@/lib/director/generate';

interface DirectorTakesBoardProps {
  groups: DirectorTakeGroup[];
  activeKey: string;
  selectedTakeId?: string;
  onSelectGroup: (variant: IsolateVariant) => void;
  onSelectTake: (take: DirectorTake) => void;
  onHeroTake: (takeId: string) => void;
  onDeleteTake: (take: DirectorTake) => void;
}

export function DirectorTakesBoard({
  groups,
  activeKey,
  selectedTakeId,
  onSelectGroup,
  onSelectTake,
  onHeroTake,
  onDeleteTake,
}: DirectorTakesBoardProps) {
  const [pending, setPending] = useState<DirectorTake | null>(null);
  const copy = pending ? deleteTakeConfirmCopy(pending) : null;

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  return (
    <div className="dgen-takes">
      <span className="dsl-scenefield-label">Takes · double-click hero · delete</span>
      <div className="dgen-take-groups">
        {groups.map((group) => (
          <div
            key={group.key}
            className={`dgen-take-group${group.key === activeKey ? ' dgen-take-group--on' : ''}`}
          >
            <button
              type="button"
              className="dgen-take-group-label"
              title={`Show ${group.label} takes`}
              onClick={() => onSelectGroup(group.variant)}
            >
              {group.label}
            </button>
            <div className="director-tab__takes">
              {group.takes.length === 0 && <span className="director-tab__meta">None yet</span>}
              {group.takes.map((take) => {
                const label = takeChipLabel(take);
                const failed = take.status === 'failed';
                const live = take.status === 'running' || take.status === 'queued';
                return (
                  <span
                    key={take.id}
                    className={[
                      'director-tab__take-wrap',
                      take.id === selectedTakeId ? 'director-tab__take-wrap--active' : '',
                      take.hero ? 'director-tab__take-wrap--hero' : '',
                      failed ? 'director-tab__take-wrap--failed' : '',
                      live ? 'director-tab__take-wrap--live' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <button
                      type="button"
                      title={`${take.error || take.status} · right-click or delete`}
                      className="director-tab__take"
                      onClick={() => onSelectTake(take)}
                      onDoubleClick={() => onHeroTake(take.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setPending(take);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Backspace' && event.key !== 'Delete') return;
                        event.preventDefault();
                        setPending(take);
                      }}
                    >
                      {label}{take.hero ? ' ★' : ''}
                    </button>
                    <button
                      type="button"
                      className="director-tab__take-x"
                      title={`Delete ${label}`}
                      aria-label={`Delete ${label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPending(take);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {pending && copy && (
        <div className="mp-confirm__backdrop" onClick={() => setPending(null)} role="presentation">
          <div
            className="mp-confirm"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="director-take-delete-title"
          >
            <div className="mp-confirm__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h3 id="director-take-delete-title" className="mp-confirm__title">{copy.title}</h3>
            <p className="mp-confirm__desc">{copy.description}</p>
            <div className="mp-confirm__actions">
              <button
                type="button"
                className="mp-confirm__btn mp-confirm__btn--cancel"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mp-confirm__btn mp-confirm__btn--delete"
                autoFocus
                onClick={() => {
                  onDeleteTake(pending);
                  setPending(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
