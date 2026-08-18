import type { Element } from '@/types/elements';
import type { DirectorShow } from '@/types/director';
import { findMatchingElement, itemsMissingElements } from '@/lib/director/breakdown';

interface DirectorBreakdownTabProps {
  show: DirectorShow;
  elements: Element[];
  onApprove: () => void;
  onCreateMissing: () => void;
  onOpenElements: () => void;
}

export function DirectorBreakdownTab({ show, elements, onApprove, onCreateMissing, onOpenElements }: DirectorBreakdownTabProps) {
  const missing = itemsMissingElements(show.breakdown, elements);

  return (
    <div className="director-tab__stage">
      <div className="director-tab__row" style={{ alignItems: 'center' }}>
        <span className="director-tab__label" style={{ margin: 0 }}>Breakdown</span>
        <div className="director-tab__row" style={{ marginLeft: 'auto' }}>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onApprove} disabled={show.breakdown.length === 0 || show.breakdownApproved}>
            {show.breakdownApproved ? 'Approved' : 'Approve breakdown →'}
          </button>
          <button type="button" className="director-tab__btn" onClick={onCreateMissing} disabled={missing.length === 0}>
            Create missing ({missing.length})
          </button>
          <button type="button" className="director-tab__btn" onClick={onOpenElements}>Generate refs</button>
        </div>
      </div>

      {show.breakdown.length === 0 ? (
        <p className="director-tab__empty">Run a breakdown from the Script tab to list characters, locations, props, and vehicles.</p>
      ) : (
        <div className="director-tab__cards">
          {show.breakdown.map((item) => {
            const linked = item.elementId || findMatchingElement(elements, item)?.id;
            return (
              <div key={item.id} className="director-tab__card">
                <span className="director-tab__card-kind">{item.kind}</span>
                <div className="director-tab__item-title">{item.tag} · {item.name}</div>
                {item.blurb && <span className="director-tab__meta">{item.blurb}</span>}
                <div>
                  <span className={`director-tab__badge ${linked ? 'director-tab__badge--linked' : 'director-tab__badge--missing'}`}>
                    {linked ? '● linked' : '○ missing'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
