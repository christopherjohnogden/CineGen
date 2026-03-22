import { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectCard } from './project-card';
import type { ProjectMeta } from '../../../electron.d';

interface HomeViewProps {
  onOpenProject: (id: string, useSqlite: boolean) => void;
}

export function HomeView({ onOpenProject }: HomeViewProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.electronAPI.project.list();
      setProjects(list);
    } catch (err) {
      console.error('Failed to list projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (showCreate) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showCreate]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const result = await window.electronAPI.db.createProject(trimmed) as { project: { id: string } };
      setNewName('');
      setShowCreate(false);
      onOpenProject(result.project.id, true);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleDelete = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!confirm(`Delete "${project?.name ?? 'project'}"? This cannot be undone.`)) return;
    try {
      if (project?.useSqlite) {
        await window.electronAPI.db.deleteProject(id);
      } else {
        await window.electronAPI.project.delete(id);
      }
      if (selected === id) setSelected(null);
      await loadProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') { setShowCreate(false); setNewName(''); }
  };

  const handleOpen = () => {
    const p = projects.find((p) => p.id === selected);
    if (p) onOpenProject(p.id, p.useSqlite ?? false);
  };

  return (
    <div className="pm-backdrop">
      <div className="pm-window">

        {/* ── Title bar ── */}
        <div className="pm-titlebar">
          <div className="pm-titlebar__left" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="pm-titlebar__dots">
              <button
                className="pm-titlebar__dot pm-titlebar__dot--close"
                onClick={() => window.electronAPI.pm.openProject('__close__', false).catch(() => window.close())}
                title="Close"
              />
              <div className="pm-titlebar__dot pm-titlebar__dot--min" />
              <div className="pm-titlebar__dot pm-titlebar__dot--max" />
            </div>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45, marginLeft: 6 }}>
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <span className="pm-titlebar__title">Project Manager</span>
          </div>
          <div className="pm-titlebar__brand">CINEGEN</div>
        </div>

        {/* ── Toolbar ── */}
        <div className="pm-toolbar">
          <span className="pm-toolbar__label">Projects</span>
          <div className="pm-toolbar__spacer" />
          <div className="pm-toolbar__actions">
            <button
              className="pm-toolbar__btn"
              title="New project"
              onClick={() => { setShowCreate(true); setSelected(null); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
            <button className="pm-toolbar__btn" title="List view" disabled>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <button className="pm-toolbar__btn pm-toolbar__btn--active" title="Grid view">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Grid ── */}
        <div className="pm-grid-wrap">
          {showCreate && (
            <div className="pm-create-inline">
              <div className="pm-create-inline__thumb">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 2v20M17 2v20M2 7h5M2 12h20M2 17h5M17 7h5M17 17h5" />
                </svg>
              </div>
              <input
                ref={inputRef}
                className="pm-create-inline__input"
                placeholder="Project name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={100}
              />
            </div>
          )}

          <div className="pm-grid">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={onOpenProject}
                onDelete={handleDelete}
                selected={selected === p.id}
                onSelect={() => setSelected(p.id)}
              />
            ))}
          </div>

          {!loading && projects.length === 0 && !showCreate && (
            <div className="pm-empty">No projects — click New Project to begin</div>
          )}
        </div>

        {/* ── Bottom bar ── */}
        <div className="pm-bottombar">
          <div className="pm-bottombar__left">
            <button className="pm-bottombar__btn" disabled>Export</button>
            <button className="pm-bottombar__btn" disabled>Import</button>
          </div>
          <div className="pm-bottombar__right">
            {showCreate ? (
              <>
                <button className="pm-bottombar__btn" onClick={() => { setShowCreate(false); setNewName(''); }}>
                  Cancel
                </button>
                <button className="pm-bottombar__btn pm-bottombar__btn--primary" onClick={handleCreate} disabled={!newName.trim()}>
                  Create
                </button>
              </>
            ) : (
              <>
                <button
                  className="pm-bottombar__btn"
                  onClick={() => setShowCreate(true)}
                >
                  New Project
                </button>
                <button
                  className="pm-bottombar__btn pm-bottombar__btn--primary"
                  disabled={!selected}
                  onClick={handleOpen}
                >
                  Open
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
