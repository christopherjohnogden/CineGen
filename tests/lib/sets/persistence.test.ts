import { describe, expect, it } from 'vitest';
import { createInitialWorkspaceState, workspaceReducer } from '@/lib/mcp/workspace-state';
import { WORKSPACE_PERSIST_ACTIONS } from '@/components/workspace/workspace-persistence';
import { mergeLiveWorkspace } from '@/lib/cloud/merge-project-update';
import { normalizeProjectSets } from '@/lib/sets/normalize';
import type { ProjectSet } from '@/types/sets';

function makeSet(id: string, name = id): ProjectSet {
  return {
    id,
    name,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    upAxis: 'y',
    scaleToMeters: 1,
    marks: [],
    cameras: [],
  };
}

describe('sets persistence wiring', () => {
  it('adds, updates and removes through the reducer without mutating state', () => {
    const initial = createInitialWorkspaceState();
    expect(initial.sets).toEqual([]);

    const added = workspaceReducer(initial, { type: 'ADD_SET', set: makeSet('s1', 'Diner') });
    expect(added.sets).toHaveLength(1);
    expect(initial.sets).toHaveLength(0);

    // Adding the same id twice is a no-op, matching ADD_ASSET.
    expect(workspaceReducer(added, { type: 'ADD_SET', set: makeSet('s1') })).toBe(added);

    const renamed = workspaceReducer(added, { type: 'UPDATE_SET', setId: 's1', updates: { name: 'Diner — night' } });
    expect(renamed.sets[0].name).toBe('Diner — night');
    expect(added.sets[0].name).toBe('Diner');

    expect(workspaceReducer(renamed, { type: 'REMOVE_SET', setId: 's1' }).sets).toEqual([]);
  });

  it('marks every set action as needing a save', () => {
    for (const action of ['ADD_SET', 'UPDATE_SET', 'REMOVE_SET']) {
      expect(WORKSPACE_PERSIST_ACTIONS as readonly string[]).toContain(action);
    }
  });

  it('survives a HYDRATE, which is what a project load and every cloud tick run through', () => {
    const state = workspaceReducer(createInitialWorkspaceState(), { type: 'ADD_SET', set: makeSet('s1') });
    const hydrated = workspaceReducer(state, {
      type: 'HYDRATE',
      payload: {
        nodes: [], edges: [], spaces: [], activeSpaceId: '', openSpaceIds: [],
        assets: [], mediaFolders: [], timelines: [], activeTimelineId: '',
        exports: [], elements: [], elementFolders: [],
        director: state.director, providerUsage: {},
        sets: normalizeProjectSets([makeSet('s2', 'Rooftop')]),
      },
    });
    // HYDRATE replaces rather than merges — the payload wins, and it is not dropped.
    expect(hydrated.sets.map((set) => set.id)).toEqual(['s2']);
  });

  it('merges concurrent edits per record instead of last-writer-wins', () => {
    const base = workspaceReducer(createInitialWorkspaceState(), { type: 'ADD_SET', set: makeSet('shared') });
    const local = workspaceReducer(base, { type: 'ADD_SET', set: makeSet('mine', 'Mine') });
    const remote = workspaceReducer(base, { type: 'ADD_SET', set: makeSet('theirs', 'Theirs') });

    const merged = mergeLiveWorkspace(base, local, remote);
    // Both additions survive. Without unique ids this collapses to one side.
    expect(merged.sets.map((set) => set.id).sort()).toEqual(['mine', 'shared', 'theirs']);
  });
});
