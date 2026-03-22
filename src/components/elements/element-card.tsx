

import type { Element } from '@/types/elements';

const TYPE_ICONS: Record<string, string> = {
  character: '👤',
  location: '🏔',
  prop: '🎬',
  vehicle: '🚗',
};

interface ElementCardProps {
  element: Element;
  onClick: () => void;
}

export function ElementCard({ element, onClick }: ElementCardProps) {
  const thumbnail = element.images[0]?.url;

  return (
    <button className="element-card" onClick={onClick} type="button">
      <div className="element-card__thumbnail">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={element.name} className="element-card__image" />
        ) : (
          <span className="element-card__icon">{TYPE_ICONS[element.type] ?? '📦'}</span>
        )}
      </div>
      <div className="element-card__info">
        <span className="element-card__name">{element.name}</span>
        <span className="element-card__meta">
          <span className="element-card__type-badge">{element.type}</span>
          <span className="element-card__count">{element.images.length} img{element.images.length !== 1 ? 's' : ''}</span>
        </span>
      </div>
    </button>
  );
}
