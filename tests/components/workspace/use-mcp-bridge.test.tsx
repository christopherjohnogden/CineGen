import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { McpAction, McpHostState } from '@/lib/mcp/types';
import { createEmptyDirectorShow } from '@/lib/director/create-show';

vi.mock('@/lib/workflows/execute', () => ({ executeFromNode: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/mcp/handlers', () => ({
  createMcpHandlers: (host: { getState: () => McpHostState; projectName?: string }) => ({
    cinegen_get_context: async () => ({ project: host.projectName, spaceCount: host.getState().spaces.length }),
    cinegen_explode: async () => { throw new Error('Nope.'); },
  }),
}));

import { useMcpBridge } from '@/components/workspace/use-mcp-bridge';

afterEach(cleanup);

type Invoke = (payload: { id: string; tool: string; args?: Record<string, unknown> }) => void;

function mountBridge(state: Partial<McpHostState> = {}) {
  let invoke: Invoke | undefined;
  const respond = vi.fn();
  const ready = vi.fn();
  const stop = vi.fn();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    mcpBridge: {
      onInvoke: (handler: Invoke) => { invoke = handler; return stop; },
      respond,
      ready,
    },
  };

  const fullState: McpHostState = {
    nodes: [], edges: [], spaces: [{ id: 's1', name: 'Space 1', createdAt: '', nodes: [], edges: [] }],
    activeSpaceId: 's1', elements: [], assets: [], timelines: [], activeTimelineId: '',
    director: createEmptyDirectorShow(), ...state,
  };
  const dispatch = vi.fn<(action: McpAction) => void>();

  function Harness() {
    useMcpBridge(fullState, dispatch, { projectName: 'Subconscious Mind' });
    return null;
  }
  const view = render(<Harness />);
  return { view, respond, ready, stop, get invoke() { return invoke; } };
}

describe('useMcpBridge', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('announces that a workspace can answer, and stops announcing when it unmounts', () => {
    const bridge = mountBridge();
    expect(bridge.ready).toHaveBeenCalledWith(true);

    bridge.view.unmount();
    expect(bridge.ready).toHaveBeenLastCalledWith(false);
    expect(bridge.stop).toHaveBeenCalled();
  });

  it('runs a tool against the live workspace and answers with its result', async () => {
    const bridge = mountBridge();
    bridge.invoke?.({ id: 'call-1', tool: 'cinegen_get_context', args: {} });

    await waitFor(() => expect(bridge.respond).toHaveBeenCalledWith({
      id: 'call-1',
      ok: true,
      result: { project: 'Subconscious Mind', spaceCount: 1 },
    }));
  });

  it('returns a tool failure as a message rather than leaving the call hanging', async () => {
    const bridge = mountBridge();
    bridge.invoke?.({ id: 'call-2', tool: 'cinegen_explode', args: {} });

    await waitFor(() => expect(bridge.respond).toHaveBeenCalledWith({ id: 'call-2', ok: false, error: 'Nope.' }));
  });

  it('names a tool it does not have instead of going quiet', async () => {
    const bridge = mountBridge();
    bridge.invoke?.({ id: 'call-3', tool: 'cinegen_make_coffee' });

    await waitFor(() => expect(bridge.respond).toHaveBeenCalledWith({
      id: 'call-3',
      ok: false,
      error: 'CineGen has no tool called "cinegen_make_coffee".',
    }));
  });

  it('does nothing at all outside the desktop app', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    function Harness() {
      useMcpBridge({
        nodes: [], edges: [], spaces: [], activeSpaceId: '', elements: [], assets: [],
        timelines: [], activeTimelineId: '', director: createEmptyDirectorShow(),
      }, vi.fn());
      return null;
    }
    expect(() => render(<Harness />)).not.toThrow();
  });
});
