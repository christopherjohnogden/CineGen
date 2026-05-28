import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface AppToast {
  id: string;
  title: string;
  message: string;
  actionLabel?: string;
}

interface AppToastHostProps {
  toast: AppToast | null;
  onDismiss: () => void;
  onAction?: () => void;
}

export function AppToastHost({ toast, onDismiss, onAction }: AppToastHostProps) {
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast]);

  if (!toast || typeof document === 'undefined') return null;

  return createPortal(
    <div className="app-toast-host" aria-live="polite">
      <div className="app-toast">
        <div className="app-toast__copy">
          <span className="app-toast__title">{toast.title}</span>
          <span className="app-toast__message">{toast.message}</span>
        </div>
        <div className="app-toast__actions">
          {toast.actionLabel && onAction && (
            <button type="button" className="app-toast__action" onClick={onAction}>
              {toast.actionLabel}
            </button>
          )}
          <button
            type="button"
            className="app-toast__dismiss"
            onClick={onDismiss}
            aria-label="Dismiss notification"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
