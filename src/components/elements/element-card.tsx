import type { Element } from '@/types/elements';
import { elementImagesForVariation, elementVariationLabel } from '@/lib/elements/variations';

function EmptyElementMark({ type }: { type: Element['type'] }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      {type === 'character' && <><circle cx="20" cy="14" r="5" /><path d="M10 32c1-8 4-12 10-12s9 4 10 12" /></>}
      {type === 'location' && <><path d="m6 31 10-19 6 9 4-6 8 16H6Z" /><path d="m13 21 3 2 3-2" /></>}
      {type === 'prop' && <><path d="M8 15h24v17H8zM8 15l5-7h14l5 7" /><path d="m17 8-3 7M26 8l-3 7" /></>}
      {type === 'vehicle' && <><path d="M6 27v-7l4-8h17l6 8v7H6Z" /><circle cx="12" cy="28" r="3" /><circle cx="27" cy="28" r="3" /><path d="M10 20h19" /></>}
    </svg>
  );
}

interface ElementCardProps {
  element: Element;
  selected?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function ElementCard({ element, selected = false, onClick, onContextMenu }: ElementCardProps) {
  const activeImages = elementImagesForVariation(element);
  const thumbnail = activeImages[0]?.url;
  const lookCount = element.variations?.length ?? 1;

  return (
    <button
      className={`element-card${selected ? ' element-card--selected' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      type="button"
      data-element-id={element.id}
      aria-selected={selected}
    >
      <div className="element-card__thumbnail">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={element.name} className="element-card__image" draggable={false} />
        ) : (
          <span className="element-card__icon"><EmptyElementMark type={element.type} /></span>
        )}
      </div>
      <div className="element-card__info">
        <span className="element-card__name">{element.name}</span>
        <span className="element-card__meta">
          <span className="element-card__type-badge">{element.type}</span>
          <span className="element-card__count">{activeImages.length} views · {lookCount} {lookCount === 1 ? 'look' : 'looks'}</span>
        </span>
        <span className="element-card__look">Default: {elementVariationLabel(element)}</span>
      </div>
    </button>
  );
}
