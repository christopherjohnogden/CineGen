/** Workspace actions whose resulting state must be written to project storage. */
export const WORKSPACE_PERSIST_ACTIONS = [
  'SET_NODES', 'SET_EDGES', 'UPDATE_NODE_CONFIG', 'APPLY_ELEMENT_MENTION', 'ADD_SPACE', 'RENAME_SPACE', 'REMOVE_SPACE', 'CLOSE_SPACE', 'OPEN_SPACE', 'SET_ACTIVE_SPACE',
  'ADD_ASSET', 'UPDATE_ASSET', 'REMOVE_ASSET', 'REMOVE_ASSETS',
  'ADD_FOLDER', 'UPDATE_FOLDER', 'REMOVE_FOLDER',
  'SET_TIMELINE', 'ADD_TIMELINE', 'REMOVE_TIMELINE', 'CLOSE_TIMELINE', 'OPEN_TIMELINE', 'SET_ACTIVE_TIMELINE',
  'SET_NODE_RESULT', 'ADD_GENERATION', 'ADD_EXPORT', 'UPDATE_EXPORT',
  'SET_DIRECTOR', 'OBSERVE_PROVIDER_USAGE',
  'UNDO', 'REDO',
] as const;

/**
 * Once a persistent update has happened, UI-only actions in the same React
 * batch must not erase the pending save. The save effect consumes this flag.
 */
export function markWorkspaceSavePending(pending: boolean, actionType: string): boolean {
  return pending || (WORKSPACE_PERSIST_ACTIONS as readonly string[]).includes(actionType);
}
