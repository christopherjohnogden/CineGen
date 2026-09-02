import { useEffect, useState } from 'react';
import { CLIP_REVIEW_STATUSES, type ClipReviewStatus } from '@/lib/studio/clips';

export interface StudioSelectionBarProps {
  count: number;
  previewUrl?: string;
  previewKind?: 'image' | 'video';
  allLiked: boolean;
  onDownload: () => void;
  onLike: () => void;
  onRemove: () => void;
  onCopyPrompts: () => void;
  onReview: (status: ClipReviewStatus | null) => void;
  onOpenInCanvas?: () => void;
  onClear: () => void;
}

const Icon = {
  download: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7.3 8 10.5l3.2-3.2M3 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  heart: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.4C13.5 10.2 8 13.5 8 13.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>,
  trash: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  more: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="12.5" cy="8" r="1.4" fill="currentColor" /></svg>,
  close: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
};

/** The floating toolbar that appears once one or more clips are selected. */
export function StudioSelectionBar({
  count,
  previewUrl,
  previewKind,
  allLiked,
  onDownload,
  onLike,
  onRemove,
  onCopyPrompts,
  onReview,
  onOpenInCanvas,
  onClear,
}: StudioSelectionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A new selection is a new decision: never carry a pending confirmation over.
  useEffect(() => {
    setConfirming(false);
    setMenuOpen(false);
  }, [count]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.clip-selection__menu') || target.closest('[data-selection-menu]')) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen]);

  const noun = count === 1 ? 'clip' : 'clips';

  return (
    <div className="clip-selection" role="toolbar" aria-label="Selected clips" data-testid="space-studio-selection">
      <div className="clip-selection__summary">
        <span className="clip-selection__preview" aria-hidden="true">
          {previewUrl && previewKind === 'image' && <img src={previewUrl} alt="" />}
          {previewUrl && previewKind === 'video' && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={previewUrl} muted playsInline preload="metadata" />
          )}
        </span>
        <strong>{count} selected</strong>
      </div>

      {confirming ? (
        <div className="clip-selection__confirm" role="alertdialog" aria-label={`Remove ${count} ${noun}?`}>
          <span>Remove {count} {noun}?</span>
          <button type="button" className="is-danger" onClick={onRemove}>Remove</button>
          <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <>
          <button type="button" className="clip-selection__action" onClick={onDownload}>{Icon.download}<span>Download</span></button>
          <button type="button" className={`clip-selection__icon${allLiked ? ' is-on' : ''}`} aria-label={allLiked ? 'Unlike selected' : 'Like selected'} aria-pressed={allLiked} onClick={onLike}>{Icon.heart}</button>
          <button type="button" className="clip-selection__icon" aria-label="Remove selected" onClick={() => setConfirming(true)}>{Icon.trash}</button>
          <div className="clip-selection__menu-host">
            <button type="button" className="clip-selection__icon" aria-label="More actions" data-selection-menu aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{Icon.more}</button>
            {menuOpen && (
              <div className="clip-selection__menu" role="menu" aria-label="Selection actions">
                <button type="button" role="menuitem" onClick={() => { onCopyPrompts(); setMenuOpen(false); }}>Copy prompts</button>
                {count === 1 && onOpenInCanvas && (
                  <button type="button" role="menuitem" onClick={() => { onOpenInCanvas(); setMenuOpen(false); }}>Open in Canvas</button>
                )}
                <div className="clip-selection__menu-title">Status</div>
                {CLIP_REVIEW_STATUSES.map((status) => (
                  <button key={status.id} type="button" role="menuitem" onClick={() => { onReview(status.id); setMenuOpen(false); }}>
                    <i aria-hidden="true" style={{ background: status.color }} />{status.label}
                  </button>
                ))}
                <button type="button" role="menuitem" onClick={() => { onReview(null); setMenuOpen(false); }}>Clear status</button>
              </div>
            )}
          </div>
        </>
      )}

      <button type="button" className="clip-selection__icon clip-selection__close" aria-label="Clear selection" onClick={onClear}>{Icon.close}</button>
    </div>
  );
}
