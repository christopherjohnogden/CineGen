import { useState, useCallback, useEffect } from 'react';
import { HomeView } from './components/home/home-view';
import { WorkspaceShell } from './components/workspace/workspace-shell';

type AppView = 'home' | 'workspace';
const EDIT_NATIVE_SURFACES = ['timeline-viewer', 'source-viewer'] as const;

// Detect if this window is the Project Manager (launched with ?pm=1)
const IS_PM = new URLSearchParams(window.location.search).get('pm') === '1';

export function App() {
  const [view, setView] = useState<AppView>('home');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [useSqlite, setUseSqlite] = useState(false);
  const [, setWakeCounter] = useState(0);

  // Force React re-render when app wakes from sleep / becomes visible
  useEffect(() => {
    function handleVisibility() {
      if (!document.hidden) {
        setWakeCounter((c) => c + 1);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    return window.electronAPI.app.onPowerEvent(({ type }) => {
      if (type === 'resume' || type === 'unlock-screen') {
        setWakeCounter((c) => c + 1);
      }
    });
  }, []);

  const handleOpenProject = useCallback((id: string, sqlite: boolean) => {
    setProjectId(id);
    setUseSqlite(sqlite);
    setView('workspace');
  }, []);

  const handleBackToHome = useCallback(async () => {
    try {
      await window.electronAPI.nativeVideo.resetSurfaces([...EDIT_NATIVE_SURFACES]);
    } catch {}
    setProjectId(null);
    setUseSqlite(false);
    // Re-open PM window, then switch to blank state
    try { await window.electronAPI.pm.open(); } catch {}
    setView('home');
  }, []);

  useEffect(() => {
    if (view !== 'home') return;
    void window.electronAPI.nativeVideo.resetSurfaces([...EDIT_NATIVE_SURFACES]).catch(() => {});
  }, [view]);

  // Listen for project open events from the PM window (main process relay)
  useEffect(() => {
    if (IS_PM) return;
    const unsub = window.electronAPI.pm.onOpenProject((id, sqlite) => {
      handleOpenProject(id, sqlite);
    });
    return unsub;
  }, [handleOpenProject]);

  // PM window: render just the project manager floating UI
  if (IS_PM) {
    return (
      <div className="app-root">
        <HomeView onOpenProject={(id, sqlite) => {
          window.electronAPI.pm.openProject(id, sqlite).catch(console.error);
        }} />
      </div>
    );
  }

  // Main window: render workspace (home view is never shown here)
  return (
    <div className="app-root">
      {view === 'workspace' && projectId && (
        <WorkspaceShell
          key={projectId}
          projectId={projectId}
          useSqlite={useSqlite}
          onBackToHome={handleBackToHome}
        />
      )}
    </div>
  );
}
