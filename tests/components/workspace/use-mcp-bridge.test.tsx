import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { McpAction, McpHostState } from '@/lib/mcp/types';
import { createEmptyDirectorShow } from '@/lib/director/create-show';

vi.mock('@/lib/workflows/execute', () => ({ executeFromNode: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/mcp/handlers', () => ({
  createMcpHandlers: (host: { getState: () => McpHostState; projectName?: string; appAction?: (action: string,args:Record<string,unknown>)=>Promise<unknown> }) => ({
    cinegen_get_context: async () => ({ project: host.projectName, spaceCount: host.getState().spaces.length }),
    cinegen_explode: async () => { throw new Error('Nope.'); },
    cinegen_director_action: async (args: Record<string,unknown>) => host.appAction?.('director',args),
    cinegen_get_jobs: async (args: Record<string,unknown>) => host.appAction?.('jobs',args),
    cinegen_export: async (args: Record<string,unknown>) => host.appAction?.('export',args),
  }),
}));

import { registerMcpCommands } from '@/lib/mcp/app-commands';
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


describe('MCP app jobs', () => {
  it('returns a background job immediately, rejects overlapping Director work, then reports completion', async () => {
    let finish: (value: unknown)=>void=()=>{};
    const work=new Promise(resolve=>{finish=resolve;});
    const stop=registerMcpCommands({director:()=>work});
    const bridge=mountBridge();
    try {
      bridge.invoke?.({id:'start',tool:'cinegen_director_action',args:{action:'generate'}});
      await waitFor(()=>expect(bridge.respond).toHaveBeenCalledWith(expect.objectContaining({id:'start',ok:true,result:expect.objectContaining({status:'running'})})));
      const jobId=bridge.respond.mock.calls.find(([x])=>x.id==='start')![0].result.id;
      bridge.invoke?.({id:'overlap',tool:'cinegen_director_action',args:{action:'generate'}});
      await waitFor(()=>expect(bridge.respond).toHaveBeenCalledWith(expect.objectContaining({id:'overlap',ok:false,error:expect.stringContaining('still running')})));
      finish({generated:1});
      await waitFor(async()=>{
        bridge.invoke?.({id:'poll',tool:'cinegen_get_jobs',args:{jobId}});
        await Promise.resolve();
        expect(bridge.respond).toHaveBeenCalledWith({id:'poll',ok:true,result:{id:jobId,action:'generate',status:'complete',result:{generated:1}}});
      });
    } finally { stop(); }
  });
  it('reports background provider failures instead of a successful generation', async () => {
    const stop=registerMcpCommands({director:()=>{throw new Error('Provider disconnected');}});
    const bridge=mountBridge();
    try {
      bridge.invoke?.({id:'start',tool:'cinegen_director_action',args:{action:'generate'}});
      await waitFor(()=>expect(bridge.respond).toHaveBeenCalled());
      const jobId=bridge.respond.mock.calls[0][0].result.id;
      bridge.invoke?.({id:'poll',tool:'cinegen_get_jobs',args:{jobId}});
      await waitFor(()=>expect(bridge.respond).toHaveBeenCalledWith({id:'poll',ok:true,result:{id:jobId,action:'generate',status:'failed',error:'Provider disconnected'}}));
    } finally { stop(); }
  });
  it('uses the app export API and returns the actual job', async () => {
    const bridge=mountBridge({assets:[{id:'a',name:'Video',type:'video',url:'https://example.com/a.mp4',createdAt:''}],activeTimelineId:'t',timelines:[{id:'t',name:'Cut',duration:5,tracks:[],transitions:[],markers:[],clips:[{id:'c',assetId:'a',trackId:'v',name:'Video',startTime:0,duration:5,trimStart:0,trimEnd:0,speed:1,opacity:1,volume:1,flipH:false,flipV:false,keyframes:[]}]}]});
    const start=vi.fn(async()=>({id:'export1',status:'queued',progress:0,preset:'standard',fps:24,createdAt:''}));
    Object.assign(window.electronAPI,{export:{start}});
    bridge.invoke?.({id:'render',tool:'cinegen_export',args:{action:'start'}});
    await waitFor(()=>expect(bridge.respond).toHaveBeenCalledWith(expect.objectContaining({id:'render',ok:true,result:expect.objectContaining({id:'export1'})})));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({totalDuration:5,preset:'standard',clips:[expect.objectContaining({inputPath:'https://example.com/a.mp4',duration:5})]}));
  });
});
