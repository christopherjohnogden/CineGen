import { describe, it, expect } from 'vitest';
import { workspaceReducer } from '@/components/workspace/workspace-shell';
import type { WorkspaceState } from '@/types/workspace';

describe('MCP results after switching Spaces', () => {
  it('keeps asynchronous results with the original node when another Space is active', () => {
    const node={id:'n1',position:{x:0,y:0},data:{type:'prompt',label:'One',config:{}}};
    const state={nodes:[],edges:[],activeSpaceId:'two',spaces:[{id:'one',name:'One',createdAt:'',nodes:[node],edges:[]},{id:'two',name:'Two',createdAt:'',nodes:[],edges:[]}]} as unknown as WorkspaceState;
    const completed=workspaceReducer(state,{type:'SET_NODE_RESULT',nodeId:'n1',result:{status:'complete',url:'https://example.com/result.mp4'}});
    const saved=workspaceReducer(completed,{type:'ADD_GENERATION',nodeId:'n1',url:'https://example.com/result.mp4'});
    expect(saved.nodes).toHaveLength(0);
    expect(saved.spaces[0].nodes[0].data.result?.url).toBe('https://example.com/result.mp4');
    expect(saved.spaces[0].nodes[0].data.generations).toEqual(['https://example.com/result.mp4']);
    expect(saved.spaces[1].nodes).toHaveLength(0);
  });
});
