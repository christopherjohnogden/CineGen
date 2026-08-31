
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { WorkflowCanvas } from './workflow-canvas';
import { SpaceStudio } from './space-studio';
import { CreateTimeline } from './create-timeline';
import type { PreviewMode } from './timeline-preview';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { generateId, timestamp } from '@/lib/utils/ids';
import type { WorkflowSpace } from '@/types/workspace';
import { WorkflowsPanel } from './toolbar/workflows-panel';
import { ModelsPanel } from './toolbar/models-panel';
import { HistoryPanel } from './toolbar/history-panel';
import {
  getVideoGenerationProvider,
  type VideoGenerationProvider,
} from '@/lib/utils/video-generation-provider';
import { requestProviderUsageRefresh } from '@/lib/providers/project-usage';

type SidebarPanel = 'workflows' | 'models' | 'history' | null;
type SpaceViewMode = 'canvas' | 'studio';

const SPACE_VIEW_STORAGE_KEY = 'cinegen_spaces_view_mode';

function getInitialSpaceViewMode(): SpaceViewMode {
  if (typeof window === 'undefined') return 'canvas';

  try {
    const storedMode = window.localStorage.getItem(SPACE_VIEW_STORAGE_KEY);
    return storedMode === 'studio' ? 'studio' : 'canvas';
  } catch {
    return 'canvas';
  }
}

const PROVIDER_LABELS: Record<VideoGenerationProvider, string> = {
  topview: 'Topview AI',
  higgsfield: 'Higgsfield',
  artlist: 'Artlist',
  runpod: 'RunPod',
};

function formatCredits(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: value > 0 && value < 1 ? 2 : 0,
  }).format(value);
}

function ProviderBudgetCard() {
  const { state } = useWorkspace();
  const [provider, setProvider] = useState<VideoGenerationProvider>(() => getVideoGenerationProvider());
  const [refreshing, setRefreshing] = useState(false);
  const usage = state.providerUsage[provider];
  const hasCreditBalance = provider === 'topview' || provider === 'higgsfield';
  const generatedAssets = state.assets.filter((asset) => asset.metadata?.generationProvider === provider).length;

  useEffect(() => {
    const syncProvider = () => setProvider(getVideoGenerationProvider());
    window.addEventListener('cinegen:settings-changed', syncProvider);
    return () => window.removeEventListener('cinegen:settings-changed', syncProvider);
  }, []);

  useEffect(() => {
    if (!refreshing) return;
    const timeout = window.setTimeout(() => setRefreshing(false), 900);
    return () => window.clearTimeout(timeout);
  }, [refreshing, usage?.updatedAt]);

  const refresh = () => {
    setRefreshing(true);
    requestProviderUsageRefresh(provider);
  };

  const remaining = hasCreditBalance
    ? usage?.connected === false
      ? 'Not connected'
      : typeof usage?.creditsRemaining === 'number'
        ? formatCredits(usage.creditsRemaining)
        : 'Checking…'
    : provider === 'runpod' ? 'Hourly billing' : 'Not reported';
  const used = hasCreditBalance
    ? typeof usage?.lastObservedCredits === 'number'
      ? formatCredits(usage.creditsUsed)
      : 'Tracking now'
    : `${generatedAssets} generation${generatedAssets === 1 ? '' : 's'}`;

  return (
    <section className="cs-provider-budget" aria-label={`${PROVIDER_LABELS[provider]} project usage`}>
      <div className="cs-provider-budget__head">
        <div className="cs-provider-budget__identity">
          <span className={`cs-provider-budget__status${usage?.connected === false ? ' is-offline' : usage?.connected === undefined ? ' is-unknown' : ''}`} aria-hidden="true" />
          <div>
            <span>Current provider</span>
            <strong>{PROVIDER_LABELS[provider]}</strong>
          </div>
        </div>
        <button
          type="button"
          className={`cs-provider-budget__refresh${refreshing ? ' is-refreshing' : ''}`}
          onClick={refresh}
          title="Refresh provider balance"
          aria-label={`Refresh ${PROVIDER_LABELS[provider]} balance`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      <div className="cs-provider-budget__metrics">
        <div>
          <span>{hasCreditBalance ? 'Credits left' : 'Billing'}</span>
          <strong>{remaining}</strong>
        </div>
        <div>
          <span>{hasCreditBalance ? 'Used in project' : 'Project activity'}</span>
          <strong>{used}</strong>
        </div>
      </div>
      <p>{hasCreditBalance ? 'Based on actual provider balance changes.' : 'This provider does not expose a credit balance.'}</p>
    </section>
  );
}

export function CreateTab() {
  const { state, dispatch } = useWorkspace();
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('pip');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [viewMode, setViewMode] = useState<SpaceViewMode>(getInitialSpaceViewMode);
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; spaceId: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // (canvas ref removed — node addition uses custom event)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const syncLayout = () => {
      setIsMobile(query.matches);
      setSidebarOpen(!query.matches);
      if (!query.matches) setActivePanel(null);
    };
    syncLayout();
    query.addEventListener('change', syncLayout);
    return () => query.removeEventListener('change', syncLayout);
  }, []);

  const handlePreviewModeChange = useCallback((mode: PreviewMode) => {
    setPreviewMode(mode);
  }, []);

  const handleViewModeChange = useCallback((mode: SpaceViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(SPACE_VIEW_STORAGE_KEY, mode);
    } catch {
      // The view still switches when storage is unavailable.
    }

    if (mode === 'studio') {
      setTimelineOpen(false);
      setPreviewMode('pip');
    }
  }, []);

  const openSpaces = useMemo(
    () => state.spaces.filter((space) => state.openSpaceIds.has(space.id)),
    [state.spaces, state.openSpaceIds],
  );

  const handleCreateSpace = useCallback(() => {
    dispatch({
      type: 'ADD_SPACE',
      space: {
        id: generateId(),
        name: `Space ${state.spaces.length + 1}`,
        createdAt: timestamp(),
        nodes: [],
        edges: [],
      },
    });
  }, [dispatch, state.spaces.length]);

  const togglePanel = useCallback((panel: SidebarPanel) => {
    setActivePanel((prev) => prev === panel ? null : panel);
    if (!sidebarOpen) setSidebarOpen(true);
  }, [sidebarOpen]);

  const handleAddNode = useCallback((nodeType: string) => {
    window.dispatchEvent(new CustomEvent('cinegen:add-node', { detail: nodeType }));
    setActivePanel(null);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  /* ── Rename ── */

  const startRename = useCallback((space: WorkflowSpace) => {
    setRenamingId(space.id);
    setRenameValue(space.name);
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      const space = state.spaces.find((s) => s.id === renamingId);
      if (space && space.name !== trimmed) {
        dispatch({ type: 'RENAME_SPACE', spaceId: renamingId, name: trimmed });
      }
    }
    setRenamingId(null);
  }, [renamingId, renameValue, state.spaces, dispatch]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  /* ── Context menu ── */

  const handleSpaceContextMenu = useCallback((e: React.MouseEvent, spaceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, spaceId });
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  const isFullscreen = previewMode === 'fullscreen' && timelineOpen;
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId);

  /* ── Tool buttons config ── */
  const tools: { id: SidebarPanel; title: string; icon: React.ReactNode }[] = [
    {
      id: 'workflows', title: 'Workflows',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>,
    },
    {
      id: 'models', title: 'Models',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>,
    },
    {
      id: 'history', title: 'History',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    },
  ];

  return (
    <div className={`create-tab${timelineOpen ? ' create-tab--timeline-open' : ''}${!sidebarOpen ? ' create-tab--sidebar-collapsed' : ''}${isMobile ? ' create-tab--mobile' : ''}`}>
      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="cs-mobile-scrim"
          aria-label="Close Spaces menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* ── Sidebar ── */}
      <aside
        className={`cs-sidebar${sidebarOpen ? '' : ' cs-sidebar--collapsed'}${isMobile && sidebarOpen ? ' cs-sidebar--mobile-open' : ''}`}
        aria-hidden={isMobile && !sidebarOpen}
      >
        {sidebarOpen ? (
          <>
            {/* Tool buttons row */}
            <div className="cs-sidebar__tools">
              <button
                className="cs-sidebar__tool-btn"
                onClick={() => setSidebarOpen(false)}
                title="Collapse sidebar"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              </button>
              <div className="cs-sidebar__tool-sep" />
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  className={`cs-sidebar__tool-btn${activePanel === tool.id ? ' cs-sidebar__tool-btn--active' : ''}`}
                  onClick={() => togglePanel(tool.id)}
                  title={tool.title}
                >
                  {tool.icon}
                </button>
              ))}
            </div>

            {/* Active tool panel OR spaces list */}
            {activePanel ? (
              <div className="cs-sidebar__panel">
                <div className="cs-sidebar__panel-head">
                  <span className="cs-sidebar__panel-title">
                    {activePanel === 'workflows' && 'Workflows'}
                    {activePanel === 'models' && 'Models'}
                    {activePanel === 'history' && 'History'}
                  </span>
                  <button className="cs-sidebar__icon-btn" onClick={() => setActivePanel(null)} title="Close panel">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="cs-sidebar__panel-body">
                  {activePanel === 'workflows' && <WorkflowsPanel />}
                  {activePanel === 'models' && (
                    <ModelsPanel onSelect={handleAddNode} />
                  )}
                  {activePanel === 'history' && <HistoryPanel />}
                </div>
              </div>
            ) : (
              <>
                <div className="cs-sidebar__section-head">
                  <span className="cs-sidebar__title">Spaces</span>
                  <button
                    className="cs-sidebar__icon-btn"
                    onClick={handleCreateSpace}
                    title="New space"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                <nav className="cs-sidebar__list">
                  {state.spaces.map((space) => {
                    const isActive = space.id === state.activeSpaceId;
                    const isRenaming = renamingId === space.id;
                    return (
                      <div
                        key={space.id}
                        className={`cs-sidebar__item${isActive ? ' cs-sidebar__item--active' : ''}`}
                        onClick={() => {
                          dispatch({ type: 'OPEN_SPACE', spaceId: space.id });
                          if (isMobile) setSidebarOpen(false);
                        }}
                        onDoubleClick={() => startRename(space)}
                        onContextMenu={(e) => handleSpaceContextMenu(e, space.id)}
                        title={isRenaming ? undefined : space.name}
                      >
                        <svg className="cs-sidebar__item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <rect x="14" y="3" width="7" height="7" rx="1" />
                          <rect x="3" y="14" width="7" height="7" rx="1" />
                          <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                        {isRenaming ? (
                          <input
                            ref={renameInputRef}
                            className="cs-sidebar__rename-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="cs-sidebar__item-name">{space.name}</span>
                        )}
                        <span className="cs-sidebar__item-count">
                          {space.nodes.length}
                        </span>
                      </div>
                    );
                  })}
                </nav>
                <ProviderBudgetCard />
              </>
            )}

          </>
        ) : (
          <div className="cs-sidebar__rail">
            <button
              className="cs-sidebar__rail-btn cs-sidebar__rail-btn--expand"
              onClick={() => setSidebarOpen(true)}
              title="Expand sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            <div className="cs-sidebar__rail-sep" />
            {tools.map((tool) => (
              <button
                key={tool.id}
                className={`cs-sidebar__rail-btn${activePanel === tool.id ? ' cs-sidebar__rail-btn--active' : ''}`}
                onClick={() => { setSidebarOpen(true); togglePanel(tool.id); }}
                title={tool.title}
              >
                {tool.icon}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* ── Workspace ── */}
      <div className="create-tab__workspace">
        {isMobile && (
          <div className="cs-mobile-bar">
            <button
              type="button"
              className="cs-mobile-bar__button"
              onClick={() => { setActivePanel(null); setSidebarOpen(true); }}
              aria-label="Open Spaces menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            </button>
            <div className="cs-mobile-bar__identity">
              <span>Space</span>
              <strong>{activeSpace?.name ?? 'Untitled'}</strong>
            </div>
            {viewMode === 'canvas' && (
              <button
                type="button"
                className="cs-mobile-bar__models"
                onClick={() => {
                  setActivePanel(null);
                  setSidebarOpen(false);
                  window.dispatchEvent(new Event('cinegen:open-node-palette'));
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add node
              </button>
            )}
          </div>
        )}
        {openSpaces.length > 1 && (
          <div className="cs-tabs">
            {openSpaces.map((space) => {
              const isActive = space.id === state.activeSpaceId;
              const isTabRenaming = renamingId === space.id;
              return (
                <button
                  key={space.id}
                  className={`cs-tabs__tab${isActive ? ' cs-tabs__tab--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_ACTIVE_SPACE', spaceId: space.id })}
                  onDoubleClick={() => startRename(space)}
                  title={space.name}
                >
                  {isTabRenaming ? (
                    <input
                      ref={isActive ? renameInputRef : undefined}
                      className="cs-tabs__rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="cs-tabs__tab-text">{space.name}</span>
                  )}
                  {openSpaces.length > 1 && (
                    <span
                      className="cs-tabs__close"
                      onClick={(event) => {
                        event.stopPropagation();
                        dispatch({ type: 'CLOSE_SPACE', spaceId: space.id });
                      }}
                      title="Close tab"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="cs-view-switch" role="group" aria-label="Space view">
          <button
            type="button"
            aria-pressed={viewMode === 'canvas'}
            className={viewMode === 'canvas' ? 'is-active' : undefined}
            onClick={() => handleViewModeChange('canvas')}
          >
            Canvas
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'studio'}
            className={viewMode === 'studio' ? 'is-active' : undefined}
            onClick={() => handleViewModeChange('studio')}
          >
            Studio
          </button>
        </div>

        <div className="create-tab__view-host">
          <div
            className={`create-tab__canvas${isFullscreen ? ' create-tab__canvas--blurred' : ''}${viewMode === 'studio' ? ' create-tab__canvas--studio-hidden' : ''}`}
            aria-hidden={viewMode === 'studio'}
            inert={viewMode === 'studio'}
          >
            <WorkflowCanvas key={state.activeSpaceId} />
            {isFullscreen && (
              <div
                className="create-tab__fullscreen-overlay"
                onClick={() => setPreviewMode('pip')}
              />
            )}
          </div>
          {viewMode === 'studio' && (
            <div className="create-tab__studio">
              <SpaceStudio />
            </div>
          )}
        </div>
      </div>

      {viewMode === 'canvas' && (
        <CreateTimeline
          open={timelineOpen}
          onToggle={() => setTimelineOpen((v) => !v)}
          previewMode={previewMode}
          onPreviewModeChange={handlePreviewModeChange}
        />
      )}

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          className="cs-ctx"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="cs-ctx__item" onClick={() => {
            dispatch({ type: 'OPEN_SPACE', spaceId: ctxMenu.spaceId });
            setCtxMenu(null);
          }}>Open</button>
          <button className="cs-ctx__item" onClick={() => {
            const space = state.spaces.find((s) => s.id === ctxMenu.spaceId);
            if (space) startRename(space);
            setCtxMenu(null);
          }}>Rename</button>
          {state.spaces.length > 1 && (
            <>
              <div className="cs-ctx__divider" />
              <button className="cs-ctx__item cs-ctx__item--danger" onClick={() => {
                dispatch({ type: 'REMOVE_SPACE', spaceId: ctxMenu.spaceId });
                setCtxMenu(null);
              }}>Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
