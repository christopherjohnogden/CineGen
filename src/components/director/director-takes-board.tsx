import type { DirectorTake, IsolateVariant } from '@/types/director';
import type { DirectorTakeGroup } from '@/lib/director/generate';

interface DirectorTakesBoardProps {
  groups: DirectorTakeGroup[];
  activeKey: string;
  selectedTakeId?: string;
  onSelectGroup: (variant: IsolateVariant) => void;
  onSelectTake: (take: DirectorTake) => void;
  onHeroTake: (takeId: string) => void;
}

export function DirectorTakesBoard({
  groups,
  activeKey,
  selectedTakeId,
  onSelectGroup,
  onSelectTake,
  onHeroTake,
}: DirectorTakesBoardProps) {
  return (
    <div className="dgen-takes">
      <span className="dsl-scenefield-label">Takes · double-click to mark hero</span>
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
              {group.takes.map((take) => (
                <button
                  key={take.id}
                  type="button"
                  title={take.error || take.status}
                  className={`director-tab__take${take.id === selectedTakeId ? ' director-tab__take--active' : ''}${take.hero ? ' director-tab__take--hero' : ''}${take.status === 'failed' ? ' director-tab__take--failed' : ''}${take.status === 'running' || take.status === 'queued' ? ' director-tab__take--live' : ''}`}
                  onClick={() => onSelectTake(take)}
                  onDoubleClick={() => onHeroTake(take.id)}
                >
                  T{String(take.number).padStart(2, '0')}{take.hero ? ' ★' : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
