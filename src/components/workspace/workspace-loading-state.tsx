interface WorkspaceLoadingStateProps {
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
}

function LoadingBlock({ className = '' }: { className?: string }) {
  return <span className={`workspace-loading__block ${className}`} />;
}

export function WorkspaceLoadingState({ error, onRetry, onBack }: WorkspaceLoadingStateProps) {
  if (error) {
    return (
      <section className="workspace-loading workspace-loading--error" role="alert">
        <div className="workspace-loading__error-panel">
          <span className="workspace-loading__error-mark" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v5" />
              <path d="M12 17h.01" />
              <path d="M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <div>
            <h2>Project couldn&rsquo;t load</h2>
            <p>{error}</p>
          </div>
          <div className="workspace-loading__error-actions">
            {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
            {onBack && <button type="button" onClick={onBack}>Back to projects</button>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-loading" role="status" aria-live="polite" aria-label="Loading project">
      <header className="workspace-loading__status">
        <span className="workspace-loading__project-mark" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h4l2 2H19a2 2 0 0 1 2 2v9.5a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 4 17.5Z" />
            <path d="M4 9h17" />
          </svg>
        </span>
        <div>
          <strong>Loading project</strong>
          <span>Restoring your script, shots, media, and edits</span>
        </div>
        <span className="workspace-loading__activity" aria-hidden><i /><i /><i /></span>
      </header>

      <div className="workspace-loading__shell" aria-hidden>
        <aside className="workspace-loading__rail">
          <LoadingBlock className="workspace-loading__block--label" />
          <LoadingBlock className="workspace-loading__block--rail-item" />
          <LoadingBlock className="workspace-loading__block--rail-item workspace-loading__block--short" />
          <LoadingBlock className="workspace-loading__block--rail-item" />
          <LoadingBlock className="workspace-loading__block--rail-item workspace-loading__block--short" />
        </aside>

        <div className="workspace-loading__stage">
          <div className="workspace-loading__stage-head">
            <div>
              <LoadingBlock className="workspace-loading__block--title" />
              <LoadingBlock className="workspace-loading__block--copy" />
            </div>
            <LoadingBlock className="workspace-loading__block--action" />
          </div>
          <LoadingBlock className="workspace-loading__block--viewer" />
          <div className="workspace-loading__timeline">
            <LoadingBlock />
            <LoadingBlock />
            <LoadingBlock />
            <LoadingBlock />
          </div>
        </div>

        <aside className="workspace-loading__inspector">
          <LoadingBlock className="workspace-loading__block--label" />
          <LoadingBlock className="workspace-loading__block--field" />
          <LoadingBlock className="workspace-loading__block--field workspace-loading__block--field-tall" />
          <LoadingBlock className="workspace-loading__block--field" />
        </aside>
      </div>
    </section>
  );
}
