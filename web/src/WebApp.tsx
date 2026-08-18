import { useCallback, useEffect, useState } from 'react';
import { HomeView } from '../../src/components/home/home-view';
import { WorkspaceShell } from '../../src/components/workspace/workspace-shell';
import '../../src/styles/globals.css';

interface OpenProject {
  id: string;
  useSqlite: boolean;
}

function projectFromLocation(): OpenProject | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('project');
  if (!id) return null;
  return { id, useSqlite: params.get('storage') !== 'json' };
}

function replaceProjectLocation(project: OpenProject | null) {
  const url = new URL(window.location.href);
  if (project) {
    url.searchParams.set('project', project.id);
    url.searchParams.set('storage', project.useSqlite ? 'db' : 'json');
  } else {
    url.searchParams.delete('project');
    url.searchParams.delete('storage');
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function WebApp() {
  const [openProject, setOpenProject] = useState<OpenProject | null>(projectFromLocation);

  useEffect(() => {
    const handlePopState = () => setOpenProject(projectFromLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleOpenProject = useCallback((id: string, useSqlite: boolean) => {
    const project = { id, useSqlite };
    replaceProjectLocation(project);
    setOpenProject(project);
  }, []);

  const handleBackToHome = useCallback(() => {
    replaceProjectLocation(null);
    setOpenProject(null);
  }, []);

  return (
    <div className="app-root">
      {openProject ? (
        <WorkspaceShell
          key={openProject.id}
          projectId={openProject.id}
          useSqlite={openProject.useSqlite}
          onBackToHome={handleBackToHome}
        />
      ) : (
        <HomeView onOpenProject={handleOpenProject} />
      )}
    </div>
  );
}
