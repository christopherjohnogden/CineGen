export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: string
  title: string
  description: string
  tone: 'info' | 'success' | 'error'
  actions?: ToastAction[]
}

interface ToastRegionProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return (
    <div className="toast-region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <article key={toast.id} className={`toast toast--${toast.tone}`}>
          <div className="toast__content">
            <h2 className="toast__title">{toast.title}</h2>
            <p className="toast__description">{toast.description}</p>
            {toast.actions && toast.actions.length > 0 ? (
              <div className="toast__actions">
                {toast.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="link-button"
                    onClick={action.onClick}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            Close
          </button>
        </article>
      ))}
    </div>
  )
}
