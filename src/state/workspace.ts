import type { ThemeMode, WorkspaceState } from '../types/engine'

const DEFAULT_WORKSPACE: WorkspaceState = {
  activeTab: 'edit',
  leftRailVisible: true,
  rightRailVisible: true,
  leftRailCollapsed: false,
  rightRailCompact: false,
  leftRailWidth: 300,
  rightRailWidth: 320,
  timelineHeight: 320,
  activeLeftRailTab: 'media',
  activeRightRailTab: 'inspector',
  viewerZoom: 1,
  timelineZoom: 1,
  lastSelectedSequenceId: null,
}

const themeStorageKey = 'cinegen.theme'

export function getDefaultWorkspaceState(): WorkspaceState {
  return structuredClone(DEFAULT_WORKSPACE)
}

function workspaceStorageKey(projectId: string): string {
  return `cinegen.workspace.${projectId}`
}

export function loadWorkspaceState(projectId: string): WorkspaceState {
  const raw = localStorage.getItem(workspaceStorageKey(projectId))
  if (!raw) {
    return getDefaultWorkspaceState()
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    return {
      ...getDefaultWorkspaceState(),
      ...parsed,
    }
  } catch {
    return getDefaultWorkspaceState()
  }
}

export function saveWorkspaceState(projectId: string, state: WorkspaceState): void {
  localStorage.setItem(workspaceStorageKey(projectId), JSON.stringify(state))
}

export function resetWorkspaceState(projectId: string): WorkspaceState {
  const reset = getDefaultWorkspaceState()
  saveWorkspaceState(projectId, reset)
  return reset
}

export function loadThemeMode(): ThemeMode {
  const stored = localStorage.getItem(themeStorageKey)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }
  return 'dark'
}

export function saveThemeMode(mode: ThemeMode): void {
  localStorage.setItem(themeStorageKey, mode)
}
