import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
let api;
const originalFetch=globalThis.fetch;
before(async()=>{
  await build({entryPoints:['tests/entry.ts'],outfile:'dist/test.mjs',bundle:true,platform:'browser',format:'esm',external:['node:*'],alias:{'@':new URL('../../src',import.meta.url).pathname},plugins:[{name:'durable-test',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'durable',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} } export class WorkerEntrypoint {}'}));b.onLoad({filter:/remote\/src\/index\.ts$/},async({path})=>({contents:(await readFile(path,'utf8'))+'\nexport { mcp };',loader:'ts'}));}}]});
  api=await import('../dist/test.mjs');
});
afterEach(()=>{globalThis.fetch=originalFetch;});

test('closed-client edits survive a fresh hydration using native project serialization',async()=>{
  const raw=api.createDefaultProjectState('Remote film');const library={version:1,elements:[],folders:[]};
  const edited=await api.editProject(raw,library,'cinegen_load_script',{text:'INT. STUDIO - DAY\n\nALICE opens a door.',title:'The Door'});
  assert.equal(edited.changed,true);
  const reopened=api.hydrate(JSON.parse(JSON.stringify(edited.state)),library);
  assert.match(reopened.director.sourceText,/ALICE/);
  const element=await api.editProject(edited.state,library,'cinegen_create_element',{name:'Alice',type:'character'});
  assert.equal(element.library.elements[0].name,'Alice');
  assert.equal(api.hydrate(element.state,element.library).elements[0].name,'Alice');
  assert.equal(element.state.timelines[0].tracks[0].timeline_id,raw.timelines[0].id);
});

test('a failed batch does not mutate the persisted input snapshot',async()=>{
  const raw=api.createDefaultProjectState('Remote film');const before=JSON.stringify(raw);
  await assert.rejects(api.editProject(raw,{elements:[],folders:[]},'cinegen_nodes',{action:'run',nodeIds:['missing']}));
  assert.equal(JSON.stringify(raw),before);
});

test('cloud writes compare both project and changed library revisions atomically',async()=>{
  let sent;
  globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return Response.json({writeResults:[]});};
  const raw=api.createDefaultProjectState('Remote film');const store=new api.CloudStore('token','owner');
  await store.save({projectId:raw.project.id,ownerId:'owner',metadata:{id:raw.project.id},doc:{updateTime:'project-v1'},state:raw,teamPath:'teams/team_owner',teamDoc:{updateTime:'team-v1'},team:{elementsLibraryRevision:2},library:{elements:[],folders:[]}},raw,{elements:[{id:'a'}],folders:[]});
  const guarded=sent.writes.filter(w=>w.currentDocument?.updateTime);
  assert.deepEqual(guarded.map(w=>w.currentDocument.updateTime),['project-v1','team-v1']);
  assert.equal(sent.writes.filter(w=>w.update.name.endsWith('/chunks/000000')).length,1);
});

test('foreign project IDs and unknown model parameters fail before requests',async()=>{
  assert.throws(()=>api.safeId('../other-user/project'));
  assert.throws(()=>api.prepareGeneration({model:'flux-dev',inputs:{prompt:'a tree',admin:true}}),/Unknown model input/);
  assert.throws(()=>api.prepareGeneration({model:'not-a-model',inputs:{}}),/exact fal.ai model/);
});

test('durable job retries never duplicate an ambiguous paid submission',async()=>{
  const state=new Map();let alarm;
  const ctx={blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>state.has(k)?structuredClone(state.get(k)):undefined,put:async(k,v)=>state.set(k,structuredClone(v)),setAlarm:async v=>{alarm=v;}}};
  const job=new api.GenerationJob(ctx,{});
  const identity={uid:'owner',email:'owner@example.com',refreshToken:'refresh',falKey:'key'};
  const args={projectId:'project',requestId:'request',model:'flux-dev',inputs:{prompt:'A tree'}};
  const start=()=>new Request('https://job/start',{method:'POST',body:JSON.stringify({identity,args})});
  const first=await (await job.fetch(start())).json();const repeat=await (await job.fetch(start())).json();
  assert.equal(first.nodeId,repeat.nodeId);assert.ok(alarm);
  const stored=state.get('job');stored.status='submitting';state.set('job',stored);
  let paid=0;
  globalThis.fetch=async url=>{if(String(url).includes('securetoken'))return Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});if(String(url).startsWith('https://queue.fal.run'))paid++;throw new Error('Unexpected network operation');};
  await job.alarm();
  assert.equal(state.get('job').status,'needs_attention');assert.equal(paid,0);
  const response=await (await job.fetch(new Request('https://job/read',{method:'POST',body:JSON.stringify({identity,args})}))).json();
  assert.equal(response.falKey,undefined);assert.equal(response.identity,undefined);
});

test('background generation saves durable media and native project state after all clients close',async()=>{
  const values=new Map();const ctx={blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>values.has(k)?structuredClone(values.get(k)):undefined,put:async(k,v)=>values.set(k,structuredClone(v)),setAlarm:async()=>{}}};
  const originalLoad=api.CloudStore.prototype.load, originalSave=api.CloudStore.prototype.save;
  let raw=api.createDefaultProjectState('Background film');const projectId=raw.project.id;let saved=0,submitted=0;
  api.CloudStore.prototype.load=async()=>({state:structuredClone(raw),library:{elements:[],folders:[]},metadata:{useSqlite:true},ownerId:'owner'});
  api.CloudStore.prototype.save=async(_,state)=>{raw=structuredClone(state);saved++;};
  globalThis.fetch=async(url,options)=>{
    const u=String(url);
    if(u.includes('securetoken'))return Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});
    if(u==='https://queue.fal.run/fal-ai/flux/dev'){submitted++;return Response.json({request_id:'provider-id',status_url:'https://queue.fal.run/status',response_url:'https://queue.fal.run/result'});}
    if(u.endsWith('/status'))return Response.json({status:'COMPLETED'});
    if(u.endsWith('/result'))return Response.json({images:[{url:'https://v3.fal.media/image.png'}]});
    if(u==='https://v3.fal.media/image.png')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});
    if(u.includes('firebasestorage')&&options.method==='POST'){
      assert.match(options.headers.authorization,/^Firebase /);
      const body=await new Response(options.body).text();assert.match(body,/multipart|Content-Type: image\/png/);
      return Response.json({downloadTokens:'download-token'});
    }
    if(u.includes('firebasestorage'))return new Response('',{status:404});
    throw new Error(`Unexpected URL ${u}`);
  };
  try {
    const first=new api.GenerationJob(ctx,{});
    const identity={uid:'owner',email:'owner@example.com',refreshToken:'refresh',falKey:'key'};
    const args={projectId,requestId:'offline',model:'flux-dev',inputs:{prompt:'A tree'}};
    await first.fetch(new Request('https://job/start',{method:'POST',body:JSON.stringify({identity,args})}));
    // No client calls and a new instance: persisted alarms own the rest of the work.
    await new api.GenerationJob(ctx,{}).alarm();assert.equal(values.get('job').status,'running');
    await new api.GenerationJob(ctx,{}).alarm();assert.equal(values.get('job').status,'complete');
    assert.equal(submitted,1);assert.equal(saved,2);
    const reopened=api.hydrate(raw,{elements:[],folders:[]});
    assert.equal(reopened.assets.length,1);assert.match(reopened.assets[0].url,/firebasestorage.googleapis.com/);
    assert.equal(reopened.spaces[0].nodes[0].data.result.status,'complete');
    await new api.GenerationJob(ctx,{}).alarm();assert.equal(submitted,1);
  } finally {api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
});

test('MCP initializes, advertises tools, validates input and returns saved read-back data',async()=>{
  const env={PUBLIC_ORIGIN:'https://cinegen.example'};const ctx={props:{uid:'owner',email:'owner@example.com',refreshToken:'refresh'}};
  const request=(method,params={})=>new Request('https://cinegen.example/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const initialized=await (await api.handleMcp(request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}),env,ctx)).json();
  assert.equal(initialized.result.serverInfo.name,'cinegen');
  const listed=await (await api.handleMcp(request('tools/list'),env,ctx)).json();
  assert.ok(listed.result.tools.some(t=>t.name==='cinegen_load_script'));
  assert.ok(listed.result.tools.some(t=>t.name==='cinegen_generate'));
  assert.ok(listed.result.tools.some(t=>t.name==='cinegen_studio_create' && t.inputSchema.required.includes('projectId')));
  globalThis.fetch=async()=>Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});
  const invalid=await (await api.handleMcp(request('tools/call',{name:'cinegen_load_script',arguments:{text:'Script'}}),env,ctx)).json();
  assert.equal(invalid.result.isError,true);assert.match(invalid.result.content[0].text,/projectId/);
  const originalLoad=api.CloudStore.prototype.load,originalSave=api.CloudStore.prototype.save;
  let raw=api.createDefaultProjectState('Film');
  api.CloudStore.prototype.load=async()=>({state:raw,library:{elements:[],folders:[]},metadata:{useSqlite:true}});
  api.CloudStore.prototype.save=async(_,state)=>{raw=state;return 'revision2';};
  try {
    const result=await (await api.handleMcp(request('tools/call',{name:'cinegen_load_script',arguments:{projectId:raw.project.id,text:'INT. HOME - DAY\n\nALICE waits.'}}),env,ctx)).json();
    assert.equal(result.result.isError,undefined,result.result.content?.[0]?.text);
    assert.equal(JSON.parse(result.result.content[0].text).saved,true);
    assert.match(raw.workflow.director.sourceText,/ALICE/);
  }finally{api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
});

test('Studio creation persists prepared items through a cloud save and reload without provider requests',async()=>{
  globalThis.fetch=async()=>{throw new Error('Studio preparation must not call a provider');};
  const raw=api.createDefaultProjectState('Studio film');const library={elements:[],folders:[]};
  const edited=await api.editProject(raw,library,'cinegen_studio_create',{prompt:'A lighthouse at dusk',kind:'image',model:'flux-dev',inputs:{image_size:'landscape_16_9'}});
  const reopened=api.hydrate(JSON.parse(JSON.stringify(edited.state)),library);
  const node=reopened.nodes.find(n=>n.data.config.__studioGenerated);
  assert.ok(node);
  assert.equal(node.data.config.__studioPromptBody,'A lighthouse at dusk');
  assert.equal(node.data.config.image_size,'landscape_16_9');
  assert.equal(node.data.config.__studioCanvasPlaced,undefined);
  assert.equal(edited.result.status,'prepared');
});
