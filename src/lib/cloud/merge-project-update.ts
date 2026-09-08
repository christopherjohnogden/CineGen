import type { WorkspaceState } from '@/types/workspace';

const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identified = (values: unknown[]): values is Array<Record<string, unknown> & { id: string }> =>
  values.every(value => record(value) && typeof value.id === 'string')
  && new Set(values.map(value => (value as { id: string }).id)).size === values.length;

// Compare to the last accepted cloud snapshot, not to a stale whole-project
// copy. Keep local edits on a field conflict; still receive unrelated results.
export function mergeProjectUpdate(base: unknown, local: unknown, remote: unknown): any {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)
    && identified(base) && identified(local) && identified(remote)) {
    const before = new Map(base.map(value => [value.id, value]));
    const here = new Map(local.map(value => [value.id, value]));
    const there = new Map(remote.map(value => [value.id, value]));
    return [...new Set([...local.map(value => value.id), ...remote.map(value => value.id)])]
      .map(id => mergeProjectUpdate(before.get(id), here.get(id), there.get(id)))
      .filter(value => value !== undefined);
  }
  if (record(base) && record(local) && record(remote)) {
    return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(remote)])]
      .map(key => [key, mergeProjectUpdate(base[key], local[key], remote[key])])
      .filter(([, value]) => value !== undefined));
  }
  return local;
}

export function mergeLiveWorkspace(base: WorkspaceState, local: WorkspaceState, remote: WorkspaceState): WorkspaceState {
  const merged = { ...remote };
  for (const key of ['spaces', 'assets', 'mediaFolders', 'timelines', 'exports', 'director', 'providerUsage'] as const) {
    (merged as any)[key] = mergeProjectUpdate(base[key], local[key], remote[key]);
  }
  const space = merged.spaces.find(space => space.id === local.activeSpaceId) ?? merged.spaces[0];
  return {
    ...merged,
    activeTab: local.activeTab,
    activeSpaceId: space?.id ?? remote.activeSpaceId,
    nodes: space?.nodes ?? remote.nodes,
    edges: space?.edges ?? remote.edges,
    openSpaceIds: new Set([...local.openSpaceIds].filter(id => merged.spaces.some(space => space.id === id))),
    activeTimelineId: merged.timelines.some(timeline => timeline.id === local.activeTimelineId) ? local.activeTimelineId : remote.activeTimelineId,
    elements: local.elements, elementFolders: local.elementFolders,
  };
}
