import { createMcpHandlers } from '../../src/lib/mcp/handlers';
import { createInitialWorkspaceState, workspaceReducer } from '../../src/lib/mcp/workspace-state';
import { assetFromRow, assetToRow, folderFromRow, timelineFromRows, trackToRow, clipToRow, transitionToRow, exportFromRow } from '../../src/lib/db-converters';
import { createEmptyDirectorShow } from '../../src/lib/director/create-show';
import { TOOL_CATALOG } from '../../mcp/tool-catalog.mjs';
import type { WorkspaceState } from '../../src/types/workspace';
import type { McpAction } from '../../src/lib/mcp/types';
import type { RecordValue } from './firebase';

// Only advertise operations the headless host can actually finish and persist.
export const REMOTE_NAMES = new Set([
  'cinegen_get_context', 'cinegen_read', 'cinegen_capabilities', 'cinegen_get_generations',
  'cinegen_load_script', 'cinegen_set_breakdown', 'cinegen_set_shotlist', 'cinegen_approve_breakdown',
  'cinegen_create_element', 'cinegen_edit_element', 'cinegen_delete_element',
  'cinegen_studio_create', 'cinegen_create_space', 'cinegen_space', 'cinegen_list_node_types', 'cinegen_nodes', 'cinegen_connect',
  'cinegen_edit_director', 'cinegen_delete_director_item', 'cinegen_take', 'cinegen_storyboard',
  'cinegen_framing', 'cinegen_asset', 'cinegen_folder', 'cinegen_timeline', 'cinegen_set_timeline',
]);
export const remoteTools = TOOL_CATALOG.filter(t=>REMOTE_NAMES.has(t.name)).map(t=>({
  ...t, description: `${t.description} Acts on the saved cloud project; no open app is required.`,
  inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, projectId: { type: 'string', description: 'Cloud project ID from cinegen_project list.' } }, required: [...(t.inputSchema.required ?? []), 'projectId'] },
}));

export function hydrate(raw: RecordValue, library: RecordValue, sqlite = true): WorkspaceState {
  const w = raw.workflow ?? {};
  const timelines = sqlite ? (raw.timelines ?? []).map((t:any)=>timelineFromRows(t,t.tracks??[],t.clips??[],t.transitions??[])) : raw.timelines ?? [];
  return workspaceReducer(createInitialWorkspaceState(), { type: 'HYDRATE', payload: {
    nodes: w.nodes ?? [], edges: w.edges ?? [], spaces: w.spaces ?? raw.spaces ?? [],
    activeSpaceId: w.activeSpaceId ?? raw.activeSpaceId ?? '', openSpaceIds: w.openSpaceIds ?? raw.openSpaceIds ?? [],
    assets: sqlite ? (raw.assets ?? []).map(assetFromRow) : raw.assets ?? [],
    mediaFolders: sqlite ? (raw.mediaFolders ?? []).map(folderFromRow) : raw.mediaFolders ?? [],
    timelines, activeTimelineId: raw.activeTimelineId ?? timelines[0]?.id ?? '',
    exports: sqlite ? (raw.exports ?? []).map(exportFromRow) : raw.exports ?? [],
    elements: library.elements ?? [], elementFolders: library.folders ?? [],
    director: w.director ?? raw.director ?? createEmptyDirectorShow(), providerUsage: w.providerUsage ?? raw.providerUsage ?? {},
  }});
}
export function serialize(raw: RecordValue, state: WorkspaceState, sqlite = true): RecordValue {
  const projectId = raw.project.id;
  const spaces = state.spaces.map(s=>({ ...s, nodes: s.id===state.activeSpaceId ? state.nodes : s.nodes, edges: s.id===state.activeSpaceId ? state.edges : s.edges }));
  const workflow = { ...raw.workflow, nodes: state.nodes, edges: state.edges, spaces, activeSpaceId: state.activeSpaceId, openSpaceIds: [...state.openSpaceIds], director: state.director, providerUsage: state.providerUsage };
  const timelines = state.timelines.map(t=>({ id:t.id, project_id:projectId,name:t.name,duration:t.duration,created_at:'',markers:JSON.stringify(t.markers??[]), tracks:t.tracks.map((v,i)=>trackToRow(v,t.id,i)),clips:t.clips.map(c=>({...clipToRow(c,t.id),keyframes:(c.keyframes??[]).map(k=>({...k,clip_id:c.id}))})),transitions:t.transitions.map(v=>transitionToRow(v,t.id)) }));
  return { ...raw, workflow, director: state.director,
    ...(sqlite ? {} : { spaces, activeSpaceId: state.activeSpaceId, openSpaceIds: [...state.openSpaceIds] }),
    assets: sqlite ? state.assets.map(a=>assetToRow(a,projectId)) : state.assets,
    mediaFolders: sqlite ? state.mediaFolders.map(f=>({id:f.id,project_id:projectId,name:f.name,parent_id:f.parentId??null,created_at:f.createdAt??''})) : state.mediaFolders,
    timelines: sqlite ? timelines : state.timelines, activeTimelineId:state.activeTimelineId,
    elements: state.elements,
  };
}
export async function editProject(raw: RecordValue, library: RecordValue, name: string, args: RecordValue, sqlite = true) {
  let state = hydrate(raw, library, sqlite); const actions: McpAction[] = [];
  const handlers = createMcpHandlers({
    getState:()=>state, projectName: raw.project.name,
    dispatch:action=>{ state=workspaceReducer(state,action); actions.push(action); },
    runNode:()=>{ throw new Error('Use cinegen_generate for a durable cloud generation. Running arbitrary Canvas graphs requires the app.'); },
    appAction:async(action,payload)=>{
      if (action==='persist_element') {
        const element=(payload as any).element;
        const saved=new Set([...state.assets.map(a=>a.url),...state.elements.flatMap(e=>[...e.images,...(e.variations??[]).flatMap(v=>v.images)].map(i=>i.url))]);
        const images=[...(element.images??[]),...(element.variations??[]).flatMap((v:any)=>v.images??[])];
        if(images.some((i:any)=>!saved.has(i.url)||!String(i.url).startsWith('https://')))throw new Error('Use an image already saved in this project or Elements library. Generate it with cinegen_generate or import it in CineGen first.');
        return element;
      }
      throw new Error(`${action} is not available in the remote host.`);
    },
  });
  if (!REMOTE_NAMES.has(name) || !handlers[name]) throw new Error('This tool is not supported remotely.');
  const result = await handlers[name](args);
  return { result: name==='cinegen_capabilities' ? { ...result as object, remote: true, directorAdapters:[], workflow:'For Spaces Studio creation use cinegen_studio_create (prepared items, no generation charges). For unattended Studio generation use cinegen_generate with Topview by default. Higgsfield requires an explicit user request; there is no automatic fallback. Canvas-only nodes use cinegen_nodes. Load script, prepare breakdown and shotlist, approve Elements, generate saved media with cinegen_generate, then attach saved assets to Elements, storyboard frames, takes or timelines. Call cinegen_list_models for the connected Topview catalog, or explicitly select provider higgsfield. No fal key is required. Director batch generation requires the app.', limitations: ['Changes are saved to CineGen Cloud. Desktop rendering and arbitrary Canvas execution are unavailable.'], supportedTools:['cinegen_project',...REMOTE_NAMES,'cinegen_list_models','cinegen_generate','cinegen_get_jobs'], unavailable:['desktop rendering','native media extraction','interactive navigation','arbitrary Canvas execution'] } : result,
    changed: actions.length>0, state:serialize(raw,state,sqlite), library:{...library,elements:state.elements,folders:state.elementFolders}, workspace:state };
}
