import { expect, test } from 'vitest';
import { mergeProjectUpdate, mergeLiveWorkspace } from '@/lib/cloud/merge-project-update';
import { createInitialWorkspaceState, workspaceReducer } from '@/lib/mcp/workspace-state';
const node = (id: string, prompt = 'original') => ({ id, position: { x: 0, y: 0 }, data: { type: 'topview', config: { prompt }, status: 'running' } });

test('receives new videos while keeping a prompt being edited and node positions', () => {
  const base = { nodes: [node('old')] };
  const local = structuredClone(base); local.nodes[0].data.config.prompt = 'local wording'; local.nodes[0].position.x = 90;
  const remote = { nodes: [{ ...node('old'), data: { ...node('old').data, status: 'complete', result: { url: 'https://media/video.mp4' } } }, node('new')] };
  const merged = mergeProjectUpdate(base, local, remote);
  expect(merged.nodes.map((n: any) => n.id)).toEqual(['old', 'new']);
  expect(merged.nodes[0]).toMatchObject({ position: { x: 90 }, data: { config: { prompt: 'local wording' }, status: 'complete', result: { url: 'https://media/video.mp4' } } });
  expect(base.nodes[0].data.config.prompt).toBe('original');
});

test('preserves local deletions and accepts remote deletions of unchanged items', () => {
  const base = [node('local-delete'), node('remote-delete'), node('keep')];
  const local = [base[1], base[2], node('local-add')];
  const remote = [base[0], base[2], node('remote-add')];
  expect(mergeProjectUpdate(base, local, remote).map((n: any) => n.id)).toEqual(['keep', 'local-add', 'remote-add']);
});

test('keeps local wording on same-field conflicts and does not turn ordinary arrays into records', () => {
  expect(mergeProjectUpdate({ prompt: 'before', refs: ['a'] }, { prompt: 'local', refs: ['b'] }, { prompt: 'remote', refs: ['c'] })).toEqual({ prompt: 'local', refs: ['b'] });
});

test('does not discard locally edited items when the remote removes them', () => {
  expect(mergeProjectUpdate([node('edited')], [node('edited', 'my edit')], [])).toEqual([node('edited', 'my edit')]);
});

test('merges both Studio and Canvas state while preserving the active view', () => {
  const state = createInitialWorkspaceState();
  const base = workspaceReducer(state, { type: 'ADD_SPACE', space: { id: 'space', name: 'Space', createdAt: '', nodes: [node('old')] as any, edges: [] } });
  const selected = workspaceReducer(base, { type: 'SET_ACTIVE_SPACE', spaceId: 'space' });
  const local = workspaceReducer(selected, { type: 'UPDATE_NODE_CONFIG', nodeId: 'old', config: { prompt: 'my edit' } });
  const remote = workspaceReducer(selected, { type: 'SET_NODES', nodes: [...selected.nodes, node('new')] as any });
  const merged = mergeLiveWorkspace(selected, local, remote);
  expect(merged.activeSpaceId).toBe('space');
  expect(merged.nodes.map(n => n.id)).toEqual(['old', 'new']);
  expect(merged.nodes[0].data.config.prompt).toBe('my edit');
  expect(merged.spaces.find(space => space.id === 'space')?.nodes).toBe(merged.nodes);
  expect(merged.elements).toBe(local.elements);
});
