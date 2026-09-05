import { EDIT_SCHEMAS } from '../mcp/edit-schemas.mjs';
import { invokeMcpCommand } from '@/lib/mcp/app-commands';
import { listAvailableProjects, createAvailableProject, deleteAvailableProject } from '@/lib/cloud/projects';
import { useState, useCallback, useEffect, useRef } from 'react';
import { HomeView } from './components/home/home-view';
import { WorkspaceShell } from './components/workspace/workspace-shell';

type AppView = 'home' | 'workspace';
const EDIT_NATIVE_SURFACES = ['timeline-viewer', 'source-viewer'] as const;

// Detect if this window is the Project Manager (launched with ?pm=1)
const IS_PM = new URLSearchParams(window.location.search).get('pm') === '1';

export function App() {
  const [view, setView] = useState<AppView>('home');
  const activeProjectRef = useRef<string | null>(null);
  const projectCommands = useRef(Promise.resolve());
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
    // Optional-chained: absent when the renderer runs in a plain browser
    return window.electronAPI?.app?.onPowerEvent(({ type }) => {
      if (type === 'resume' || type === 'unlock-screen') {
        setWakeCounter((c) => c + 1);
      }
    });
  }, []);

  const handleOpenProject = useCallback((id: string, sqlite: boolean) => {
    activeProjectRef.current = id;
    setProjectId(id);
    setUseSqlite(sqlite);
    setView('workspace');
  }, []);

  const handleBackToHome = useCallback(async () => {
    try {
      await window.electronAPI?.nativeVideo?.resetSurfaces([...EDIT_NATIVE_SURFACES]);
    } catch {}
    activeProjectRef.current = null;
    setProjectId(null);
    setUseSqlite(false);
    // Re-open PM window, then switch to blank state
    try { await window.electronAPI?.pm?.open(); } catch {}
    setView('home');
  }, []);

  useEffect(() => {
    if (view !== 'home') return;
    void window.electronAPI?.nativeVideo?.resetSurfaces([...EDIT_NATIVE_SURFACES]).catch(() => {});
  }, [view]);

  useEffect(() => {
    if (IS_PM) return;
    const api = window.electronAPI?.mcpBridge;
    if (!api?.onInvoke) return;

    return api.onInvoke(({ id, tool, args }) => {
      if (tool !== 'cinegen_project') return;
      projectCommands.current = projectCommands.current.then(async () => {
        try {
          const parsed = EDIT_SCHEMAS.cinegen_project.safeParse(args ?? {});
          if (!parsed.success) throw new Error(parsed.error.message);
          const request = parsed.data as { action: string; projectId?: string; name?: string };
          let result: unknown;
          if (request.action === 'list') result = await listAvailableProjects();
          else if (request.action === 'save') {
            if (!activeProjectRef.current) throw new Error('No project is open.');
            result = await invokeMcpCommand('save_project', {});
          } else if (request.action === 'create') {
            if (!request.name?.trim()) throw new Error('name is required.');
            if (activeProjectRef.current) await invokeMcpCommand('save_project', {});
            const created = await createAvailableProject(request.name);
            handleOpenProject(created.project.id, true);
            result = { projectId: created.project.id, opened: true };
          } else if (request.action === 'close') {
            if (activeProjectRef.current) await invokeMcpCommand('save_project', {});
            await handleBackToHome(); result = { closed: true };
          } else {
            const projects = await listAvailableProjects();
            const target = projects.find(project => project.id === request.projectId);
            if (!target) throw new Error('Unknown project ID. List projects first.');
            if (request.action === 'open') {
              if (activeProjectRef.current) await invokeMcpCommand('save_project', {});
              handleOpenProject(target.id, Boolean(target.useSqlite)); result = { projectId: target.id, opened: true };
            } else {
              if (target.id === activeProjectRef.current) throw new Error('Close the project before deleting it.');
              await deleteAvailableProject(target); result = { deleted: target.id };
            }
          }
          api.respond({ id, ok: true, result });
        } catch (error) {
          api.respond({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    });
  }, [projectId, handleOpenProject, handleBackToHome]);

  // Listen for project open events from the PM window (main process relay)
  useEffect(() => {
    if (IS_PM) return;
    const unsub = window.electronAPI?.pm?.onOpenProject((id, sqlite) => {
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
