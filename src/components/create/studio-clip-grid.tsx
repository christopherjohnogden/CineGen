import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react';
import { CLIP_REVIEW_STATUSES, formatElapsed, primeVideoPoster, type ClipCardSize, type ClipItem, type ClipReviewStatus } from '@/lib/studio/clips';

export interface StudioClipGridActions {
  onOpen: (id: string) => void;
  onLike: (id: string) => void;
  onDownload: (id: string) => void;
  onRecreate: (id: string) => void;
  onReference: (id: string) => void;
  /** Absent when the composer's model cannot edit a clip. */
  onEditVideo?: (id: string) => void;
  onExtractFrame: (id: string, at: 'start' | 'end') => void;
  onOpenInCanvas?: (id: string) => void;
  /** Takes a placed generation back off the canvas; the clip stays in the feed. */
  onHideFromCanvas?: (id: string) => void;
  /** Whether the generation currently has a node drawn on the canvas. */
  isOnCanvas?: (id: string) => boolean;
  onCopyPrompt: (id: string) => void;
  onCopyUrl: (id: string) => void;
  onRemove: (id: string) => void;
  onReview: (id: string, status: ClipReviewStatus | null) => void;
}

export interface StudioClipGridProps extends StudioClipGridActions {
  items: ClipItem[];
  cardSize: ClipCardSize;
  /** Multi-select: checked clips get an outline, and a tap toggles instead of opening. */
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
}

/** Fixed-position placement so a menu escapes the scrolling feed column. */
function useAnchoredMenu() {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const place = useCallback((anchor: HTMLElement, width: number, align: 'left' | 'right') => {
    const box = anchor.getBoundingClientRect();
    const margin = 8;
    const left = align === 'right'
      ? Math.max(margin, Math.min(box.right - width, window.innerWidth - width - margin))
      : Math.max(margin, Math.min(box.left, window.innerWidth - width - margin));
    const top = Math.min(box.bottom + 6, window.innerHeight - margin - 40);
    setStyle({ position: 'fixed', top, left, width });
  }, []);
  return [style, place, () => setStyle(null)] as const;
}

const HEART = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M8 13.5S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.4C13.5 10.2 8 13.5 8 13.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const DOWNLOAD = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M8 2.5v7.5M4.8 7.3 8 10.5l3.2-3.2M3 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const RECREATE = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M10.5 5.5v-1A2 2 0 0 0 8.5 2.5h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
const REFERENCE = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <rect x="2.5" y="3" width="11" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="6" cy="6.5" r="1.2" fill="currentColor" />
    <path d="M3 12l3.4-3.4 2.2 2.2 1.8-1.8L13 11.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const MORE = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
  </svg>
);
const PLAY = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 5.5v13l10-6.5Z" fill="currentColor" />
  </svg>
);
const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="m3.5 8.5 3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const EYE = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

function primeFrame(event: SyntheticEvent<HTMLVideoElement>) {
  primeVideoPoster(event.currentTarget);
}

function hoverCapable(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover)').matches;
}

interface ClipTileProps extends StudioClipGridActions {
  item: ClipItem;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect?: (id: string) => void;
}

function ClipTile({ item, selected, selectionActive, onToggleSelect, ...actions }: ClipTileProps) {
  const [menuStyle, placeMenu, closeMenu] = useAnchoredMenu();
  const [statusStyle, placeStatus, closeStatus] = useAnchoredMenu();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const anyMenu = Boolean(menuStyle || statusStyle);
  const onCanvas = actions.isOnCanvas?.(item.id) ?? false;

  useEffect(() => {
    if (!anyMenu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || statusRef.current?.contains(target)) return;
      closeMenu();
      closeStatus();
      setConfirmRemove(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
        closeStatus();
        setConfirmRemove(false);
      }
    };
    const onScroll = () => { closeMenu(); closeStatus(); };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [anyMenu, closeMenu, closeStatus]);

  const review = CLIP_REVIEW_STATUSES.find((status) => status.id === item.review);
  const busy = item.status === 'queued' || item.status === 'running';

  // A render can run for minutes; without a clock there is no way to tell a slow
  // one from a dead one. Only busy tiles tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const elapsed = busy && item.startedAt ? formatElapsed(now - item.startedAt) : '';

  const run = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    closeMenu();
    closeStatus();
    setConfirmRemove(false);
    fn();
  };

  const onEnter = () => {
    if (!hoverCapable() || !videoRef.current) return;
    const pending = videoRef.current.play() as Promise<void> | undefined;
    pending?.catch?.(() => {});
  };
  const onLeave = () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.pause();
      video.currentTime = 0.05;
    } catch {
      // Not playable yet.
    }
  };

  return (
    <article
      className={`clip-tile${item.liked ? ' is-liked' : ''}${anyMenu ? ' is-menu-open' : ''}${selected ? ' is-selected' : ''}`}
      data-status={item.status}
      data-testid={`space-studio-tile-${item.id}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <button
        type="button"
        className="clip-tile__open"
        aria-label={`Open ${item.model.name} ${item.kind}`}
        onClick={() => (selectionActive && onToggleSelect ? onToggleSelect(item.id) : actions.onOpen(item.id))}
      >
        <span className="clip-tile__media">
          {item.url && item.kind === 'image' && <img src={item.url} alt="" loading="lazy" />}
          {item.url && item.kind === 'video' && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={videoRef}
              src={item.url}
              muted
              playsInline
              loop
              preload="metadata"
              onLoadedMetadata={primeFrame}
            />
          )}
          {!item.url && (
            <span className={`clip-tile__empty${busy ? ' is-busy' : ''}`}>
              {busy ? <span className="clip-tile__spinner" aria-hidden="true" /> : null}
              <span>{busy ? (item.status === 'queued' ? 'Queued' : 'Generating…') : item.model.name}</span>
              {elapsed && <span className="clip-tile__elapsed" data-testid={`space-studio-elapsed-${item.id}`}>{elapsed}</span>}
            </span>
          )}
        </span>
        {item.url && item.kind === 'video' && <span className="clip-tile__play" aria-hidden="true">{PLAY}</span>}
      </button>

      {onToggleSelect && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? `Deselect ${item.model.name} ${item.kind}` : `Select ${item.model.name} ${item.kind}`}
          className={`clip-tile__select${selected ? ' is-on' : ''}`}
          data-testid={`space-studio-select-${item.id}`}
          onClick={(event) => { event.stopPropagation(); onToggleSelect(item.id); }}
        >
          {selected && CHECK}
        </button>
      )}
      {/* "New" is a promise that there is something to watch, so it waits for
          the render to land rather than sitting on top of the spinner. */}
      {item.isNew && !busy && <span className="clip-tile__new"><i aria-hidden="true" />New</span>}
      {item.lastViewed && !item.isNew && <span className="clip-tile__viewed">{EYE}Last viewed</span>}
      {item.status === 'error' && <span className="clip-tile__failed">Failed</span>}

      <div className="clip-tile__stack">
        <button type="button" className={`clip-tile__icon${item.liked ? ' is-on' : ''}`} data-tip={item.liked ? 'Unlike' : 'Like'} aria-label={item.liked ? 'Unlike' : 'Like'} aria-pressed={item.liked} onClick={run(() => actions.onLike(item.id))}>{HEART}</button>
        <button type="button" className="clip-tile__icon" data-tip="Download" aria-label="Download" disabled={!item.url} onClick={run(() => actions.onDownload(item.id))}>{DOWNLOAD}</button>
        <button type="button" className="clip-tile__icon" data-tip="Recreate" aria-label="Recreate" onClick={run(() => actions.onRecreate(item.id))}>{RECREATE}</button>
        <button type="button" className="clip-tile__icon" data-tip="Reference" aria-label="Reference" disabled={!item.url} onClick={run(() => actions.onReference(item.id))}>{REFERENCE}</button>
        <button
          type="button"
          className="clip-tile__icon"
          data-tip="More actions"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={Boolean(menuStyle)}
          onClick={(event) => {
            event.stopPropagation();
            closeStatus();
            if (menuStyle) closeMenu();
            else placeMenu(event.currentTarget, 220, 'right');
          }}
        >
          {MORE}
        </button>
      </div>

      <button
        type="button"
        className={`clip-tile__status${review ? ' is-set' : ''}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(statusStyle)}
        onClick={(event) => {
          event.stopPropagation();
          closeMenu();
          if (statusStyle) closeStatus();
          else placeStatus(event.currentTarget, 180, 'left');
        }}
      >
        <i aria-hidden="true" style={review ? { background: review.color, borderColor: review.color } : undefined} />
        {review ? review.label : 'No status'}
      </button>

      {statusStyle && (
        <div ref={statusRef} className="clip-menu" role="menu" aria-label="Status" style={statusStyle}>
          <div className="clip-menu__title">Status</div>
          {CLIP_REVIEW_STATUSES.map((status) => (
            <button key={status.id} type="button" role="menuitemradio" aria-checked={item.review === status.id} onClick={run(() => actions.onReview(item.id, status.id))}>
              <i aria-hidden="true" style={{ background: status.color }} />{status.label}
            </button>
          ))}
          {item.review && (
            <button type="button" role="menuitem" onClick={run(() => actions.onReview(item.id, null))}>Clear status</button>
          )}
        </div>
      )}

      {menuStyle && (
        <div ref={menuRef} className="clip-menu" role="menu" aria-label="Clip actions" style={menuStyle}>
          <button type="button" role="menuitem" onClick={run(() => actions.onOpen(item.id))}>Open</button>
          {onToggleSelect && (
            <button type="button" role="menuitem" onClick={run(() => onToggleSelect(item.id))}>
              {selected ? 'Deselect' : 'Select'}
            </button>
          )}
          {item.kind === 'video' && item.url && (
            <>
              {actions.onEditVideo && (
                <button type="button" role="menuitem" onClick={run(() => actions.onEditVideo?.(item.id))}>Edit video</button>
              )}
              <button type="button" role="menuitem" onClick={run(() => actions.onExtractFrame(item.id, 'start'))}>Extract start frame</button>
              <button type="button" role="menuitem" onClick={run(() => actions.onExtractFrame(item.id, 'end'))}>Extract last frame</button>
            </>
          )}
          <button type="button" role="menuitem" onClick={run(() => actions.onRecreate(item.id))}>Recreate</button>
          {item.url && <button type="button" role="menuitem" onClick={run(() => actions.onReference(item.id))}>Reference</button>}
          <div className="clip-menu__rule" role="separator" />
          <button type="button" role="menuitem" onClick={run(() => actions.onLike(item.id))}>{item.liked ? 'Unlike' : 'Like'}</button>
          {item.url && <button type="button" role="menuitem" onClick={run(() => actions.onDownload(item.id))}>Download</button>}
          {actions.onOpenInCanvas && !onCanvas && (
            <button type="button" role="menuitem" onClick={run(() => actions.onOpenInCanvas?.(item.id))}>Open in Canvas</button>
          )}
          {actions.onOpenInCanvas && onCanvas && (
            <button type="button" role="menuitem" onClick={run(() => actions.onOpenInCanvas?.(item.id))}>Show on Canvas</button>
          )}
          {actions.onHideFromCanvas && onCanvas && (
            <button type="button" role="menuitem" onClick={run(() => actions.onHideFromCanvas?.(item.id))}>Remove from Canvas</button>
          )}
          <button type="button" role="menuitem" onClick={run(() => actions.onCopyPrompt(item.id))}>Copy prompt</button>
          {item.url && <button type="button" role="menuitem" onClick={run(() => actions.onCopyUrl(item.id))}>Copy {item.kind} URL</button>}
          <div className="clip-menu__rule" role="separator" />
          {confirmRemove ? (
            <div className="clip-menu__confirm">
              <span>Remove this generation?</span>
              <button type="button" className="is-danger" onClick={run(() => actions.onRemove(item.id))}>Remove</button>
              <button type="button" onClick={(event) => { event.stopPropagation(); setConfirmRemove(false); }}>Cancel</button>
            </div>
          ) : (
            <button type="button" role="menuitem" className="is-danger" onClick={(event) => { event.stopPropagation(); setConfirmRemove(true); }}>Remove</button>
          )}
        </div>
      )}
    </article>
  );
}

export function StudioClipGrid({ items, cardSize, selectedIds, onToggleSelect, ...actions }: StudioClipGridProps) {
  const selectionActive = Boolean(selectedIds && selectedIds.size > 0);
  return (
    <div className={`clip-grid${selectionActive ? ' has-selection' : ''}`} data-size={cardSize} data-testid="space-studio-feed-grid">
      {items.map((item) => (
        <ClipTile
          key={item.id}
          item={item}
          selected={Boolean(selectedIds?.has(item.id))}
          selectionActive={selectionActive}
          onToggleSelect={onToggleSelect}
          {...actions}
        />
      ))}
    </div>
  );
}
