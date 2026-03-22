

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageCompare } from './image-compare';

interface FullscreenModalProps {
  url: string;
  type: 'image' | 'video' | 'audio';
  beforeUrl?: string;
  onClose: () => void;
}

export function FullscreenModal({ url, type, beforeUrl, onClose }: FullscreenModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  return createPortal(
    <div className="fullscreen-backdrop" ref={backdropRef} onClick={handleBackdrop}>
      <div className="fullscreen-modal">
        <div className="fullscreen-modal__toolbar">
          {beforeUrl && (
            <button
              className={`fullscreen-modal__btn${comparing ? ' fullscreen-modal__btn--active' : ''}`}
              onClick={() => setComparing((v) => !v)}
              title="Compare before/after"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
            </button>
          )}
          <button className="fullscreen-modal__btn" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="fullscreen-modal__content">
          {comparing && beforeUrl ? (
            <ImageCompare beforeUrl={beforeUrl} afterUrl={url} className="fullscreen-modal__compare" />
          ) : type === 'video' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={url} className="fullscreen-modal__media" controls autoPlay />
          ) : type === 'audio' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio src={url} className="fullscreen-modal__audio" controls autoPlay />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Fullscreen" className="fullscreen-modal__media" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
