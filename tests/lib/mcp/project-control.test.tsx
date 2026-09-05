import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const projects=vi.hoisted(()=>({list:vi.fn(async()=>[{id:'p1',useSqlite:true},{id:'p2',useSqlite:true}]),create:vi.fn(async()=>({project:{id:'new'}})),remove:vi.fn(async()=>{})}));
vi.mock('@/lib/cloud/projects',()=>({listAvailableProjects:projects.list,createAvailableProject:projects.create,deleteAvailableProject:projects.remove}));
vi.mock('@/components/home/home-view',()=>({HomeView:()=>null}));
vi.mock('@/components/workspace/workspace-shell',()=>({WorkspaceShell:({projectId}:{projectId:string})=><div>{projectId}</div>}));
import { App } from '@/App';
import { registerMcpCommands } from '@/lib/mcp/app-commands';

type Request={id:string;tool:string;args?:Record<string,unknown>};
function mount() {
  let invoke:(request:Request)=>void=()=>{};
  const respond=vi.fn();
  (window as unknown as {electronAPI:unknown}).electronAPI={mcpBridge:{onInvoke:(cb:typeof invoke)=>{invoke=cb;return()=>{};},respond},app:{onPowerEvent:()=>()=>{}},pm:{onOpenProject:()=>()=>{},open:async()=>{}},nativeVideo:{resetSurfaces:async()=>{}}};
  const view=render(<App/>);
  return {...view,respond,call:(args:Record<string,unknown>,id='call')=>act(()=>invoke({id,tool:'cinegen_project',args}))};
}
afterEach(()=>{cleanup();vi.clearAllMocks();delete (window as unknown as {electronAPI?:unknown}).electronAPI;});
describe('MCP project management',()=>{
  it('lists and opens projects from the launcher, then saves before switching',async()=>{
    const save=vi.fn(async()=>({saved:true}));const stop=registerMcpCommands({save_project:save});const app=mount();
    try {
      app.call({action:'list'},'list');await waitFor(()=>expect(app.respond).toHaveBeenCalledWith({id:'list',ok:true,result:[{id:'p1',useSqlite:true},{id:'p2',useSqlite:true}]}));
      app.call({action:'open',projectId:'p1'},'open');await waitFor(()=>expect(app.getByText('p1')).toBeTruthy());
      expect(save).not.toHaveBeenCalled();
      app.call({action:'open',projectId:'p2'},'switch');await waitFor(()=>expect(app.getByText('p2')).toBeTruthy());expect(save).toHaveBeenCalledTimes(1);
    } finally {stop();}
  });
  it('keeps the current project open if saving fails',async()=>{
    const stop=registerMcpCommands({save_project:()=>{throw new Error('Save failed');}});const app=mount();
    try {
      app.call({action:'open',projectId:'p1'},'open');await waitFor(()=>expect(app.getByText('p1')).toBeTruthy());
      app.call({action:'open',projectId:'p2'},'switch');await waitFor(()=>expect(app.respond).toHaveBeenCalledWith({id:'switch',ok:false,error:'Save failed'}));expect(app.getByText('p1')).toBeTruthy();
    } finally {stop();}
  });
  it('rejects deleting the open project and invalid requests',async()=>{
    const app=mount();app.call({action:'open',projectId:'p1'},'open');await waitFor(()=>expect(app.getByText('p1')).toBeTruthy());
    app.call({action:'delete',projectId:'p1'},'delete');await waitFor(()=>expect(app.respond).toHaveBeenCalledWith(expect.objectContaining({id:'delete',ok:false})));
    expect(projects.remove).not.toHaveBeenCalled();
    app.call({action:'arbitrary'},'invalid');await waitFor(()=>expect(app.respond).toHaveBeenCalledWith(expect.objectContaining({id:'invalid',ok:false})));
  });
});
