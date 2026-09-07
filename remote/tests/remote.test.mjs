import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { canvasToolNames, canvasSubmitSchema } from '../../tests/fixtures/topview-canvas.mjs';
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

test('ElevenLabs audio prepares without charging, attaches durably, and survives reopening',async()=>{
  const raw=api.createDefaultProjectState('Voice film');const library={version:1,elements:[],folders:[]};
  const created=await api.editProject(raw,library,'cinegen_create_element',{name:'Alice',voice:{description:'Warm and soft',provider:'elevenlabs',voiceId:'chosen-voice',sampleText:'Hello there.'}});
  const character=created.library.elements[0];
  const prepared=await api.editProject(created.state,created.library,'cinegen_audio',{action:'prepare',elementId:character.id});
  assert.match(prepared.result.brief,/chosen-voice/);assert.match(prepared.result.brief,/Hello there/);
  let calls=0;const savedUrl='https://firebasestorage.googleapis.com/v0/b/cinegen-734ba.firebasestorage.app/o/voice.mp3?alt=media';
  const persist=async(source)=>{calls++;assert.equal(source,'https://eleven.example/sample.mp3');return savedUrl;};
  const attached=await api.editProject(prepared.state,prepared.library,'cinegen_audio',{action:'attach',nodeId:prepared.result.nodeId,spaceId:prepared.result.spaceId,elementId:character.id,audioUrl:'https://eleven.example/sample.mp3',expectedText:'Hello there.'},true,persist);
  assert.equal(calls,1);const reopened=api.hydrate(JSON.parse(JSON.stringify(attached.state)),JSON.parse(JSON.stringify(attached.library)));
  assert.equal(reopened.assets[0].type,'audio');assert.equal(reopened.assets[0].url,savedUrl);
  assert.equal(reopened.elements[0].voice.referenceAudio.url,savedUrl);
  assert.equal(reopened.elements[0].voice.voiceId,'chosen-voice');
  assert.equal(reopened.nodes.find(n=>n.id===prepared.result.nodeId).data.result.status,'complete');
  const again=await api.editProject(attached.state,attached.library,'cinegen_audio',{action:'attach',nodeId:prepared.result.nodeId,spaceId:prepared.result.spaceId,audioUrl:'https://eleven.example/sample.mp3'},true,persist);
  assert.equal(calls,1);assert.equal(api.hydrate(again.state,again.library).assets.length,1);
  await assert.rejects(api.editProject(attached.state,attached.library,'cinegen_audio',{action:'attach',nodeId:prepared.result.nodeId,spaceId:prepared.result.spaceId,audioUrl:'https://eleven.example/sample.mp3',expectedText:'An old line'},true,persist),/brief changed/);
  assert.ok(api.remoteTools.find(t=>t.name==='cinegen_audio'));
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
  assert.equal(state.get('job').status,'needs_attention');
  await job.alarm();assert.equal(paid,0);
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
    assert.equal(submitted,1);assert.equal(saved,3);
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
  assert.equal(initialized.result.serverInfo.version,'1.8.0');
  assert.match(initialized.result.instructions,/cinegen_studio_create/);
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
    const studio = await (await api.handleMcp(request('tools/call',{name:'cinegen_studio_create',arguments:{projectId:raw.project.id,prompt:'Sunrise over the mountains',kind:'image',model:'topview-image-seedream-4-5'}}),env,ctx)).json();
    assert.equal(studio.result.isError,undefined,studio.result.content?.[0]?.text);
    assert.equal(JSON.parse(studio.result.content[0].text).saved,true);
    assert.ok(api.hydrate(raw,{elements:[],folders:[]}).nodes.some(n=>n.data.config.__studioPromptBody==='Sunrise over the mountains'));
  }finally{api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
});

test('Studio creation persists prepared items through a cloud save and reload without provider requests',async()=>{
  globalThis.fetch=async()=>{throw new Error('Studio preparation must not call a provider');};
  const raw=api.createDefaultProjectState('Studio film');const library={elements:[],folders:[]};
  const prompt='A lighthouse at dusk. '.repeat(240).trim();
  assert.ok(prompt.length>4000);
  const edited=await api.editProject(raw,library,'cinegen_studio_create',{prompt,kind:'image',model:'topview-image-seedream-4-5',inputs:{aspect_ratio:'16:9'}});
  const reopened=api.hydrate(JSON.parse(JSON.stringify(edited.state)),library);
  const node=reopened.nodes.find(n=>n.data.config.__studioGenerated);
  assert.ok(node);
  assert.equal(node.data.config.__studioPromptBody,prompt);
  assert.equal(node.data.config.aspect_ratio,'16:9');
  assert.equal(node.data.config.__studioCanvasPlaced,undefined);
  assert.equal(edited.result.status,'prepared');
});

test('Topview is the default and Higgsfield cannot be selected implicitly',()=>{
  assert.equal(api.requestedProvider(undefined),'topview');
  assert.equal(api.requestedProvider('higgsfield'),'higgsfield');
  assert.throws(()=>api.requestedProvider('fal'),/Topview/);
  assert.throws(()=>api.prepareProviderGeneration({model:'hf-cinematic-studio-2-5',inputs:{prompt:'A portrait'}}),/explicit user request/);
  const p=api.prepareProviderGeneration({model:'topview-video-seedance-2-5',inputs:{prompt:'Camera follows her',image_url:['https://example.com/shot.mp4']}});
  assert.equal(p.provider,'topview');assert.equal(p.params.waitForCompletion,false);
  assert.equal(p.params.medias[0].role,'video');
});

test('MCP model discovery advertises the usable Canvas audio route and its visual-reference requirement',async()=>{
  globalThis.fetch=async(url)=>Response.json({ok:true,result:String(url).endsWith('/accountStatus')?{connected:true,authMode:'oauth'}:{tools:canvasToolNames,toolSchemas:{topview_generate_video:{properties:{req:{properties:{inputImages:{},inputVideos:{}}}}},submit_topview_canvas_generation_task:canvasSubmitSchema},configs:[]}});
  const connected=await api.connectedModels('fixture','topview','video');
  assert.equal(connected.audioReferenceConnection.ready,true);
  assert.equal(connected.audioReferenceConnection.transport,'canvas-mcp');
  assert.equal(connected.audioReferenceConnection.requiresVisualReference,true);
  assert.equal(connected.audioReferenceConnection.promptMaxCharacters,4000);
  assert.match(connected.audioReferenceConnection.note,/not all CineGen prompts/);
  assert.ok(connected.models.find(model=>model.nodeType==='topview-video-seedance-2-5').inputs.some(field=>field.id==='audio_references'));
});

test('Seedance accepts 1080 and 1080p only when the live catalog permits that resolution',()=>{
  const catalog=(resolutions)=>({configs:[{outputType:'video',taskType:'omni_reference',config:{models:[{displayName:'Seedance 2.5',submitModel:'Seedance 2.5',defaultSubmitParameters:{resolution:720,duration:4,aspectRatio:'16:9'},submitParameterOptions:{resolution:resolutions,duration:[4,30],aspectRatio:['16:9']}}]}}]});
  for(const options of [[480,720,1080],['480p','720p','1080p']]) {
    const models=api.providerModels('topview','video',catalog(options));
    for(const resolution of [1080,'1080','1080p']) {
      const prepared=api.prepareProviderGeneration({model:'topview-video-seedance-2-5',inputs:{prompt:'A moving camera',duration:30,resolution}},models);
      assert.equal(String(prepared.params.resolution),String(options[2]));
      assert.equal(prepared.params.durationSec,30);
    }
  }
  const models=api.providerModels('topview','video',catalog([480,720]));
  assert.throws(()=>api.prepareProviderGeneration({model:'topview-video-seedance-2-5',inputs:{prompt:'A moving camera',resolution:'1080p'}},models),/allows: 480, 720/);
});

for(const [provider,kind,model] of [['topview','image','topview-image-seedream-4-5'],['topview','video','topview-video-seedance-2-5'],['higgsfield','image','hf-cinematic-studio-2-5']]) {
  test(`${provider} ${kind} jobs use the existing connection and save Studio results without fal credentials`,async()=>{
    const values=new Map();const ctx={blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>values.has(k)?structuredClone(values.get(k)):undefined,put:async(k,v)=>values.set(k,structuredClone(v)),setAlarm:async()=>{}}};
    const originalLoad=api.CloudStore.prototype.load,originalSave=api.CloudStore.prototype.save;
    let raw=api.createDefaultProjectState('Provider film'),submissions=0,polls=0;
    let failDownload=provider==='topview'&&kind==='image', recovering=false;
    api.CloudStore.prototype.load=async()=>({state:structuredClone(raw),library:{elements:[],folders:[]},metadata:{useSqlite:true},ownerId:'owner'});
    api.CloudStore.prototype.save=async(_,state)=>{raw=structuredClone(state);};
    const canvasVideo=provider==='topview'&&kind==='video';
    const source=canvasVideo?'https://du9d8548ooqnc.cloudfront.net/task%2Foutput.mp4?Policy=policy&Signature=signature&Key-Pair-Id=key':`https://provider-cdn.example/media.${kind==='video'?'mp4':'png'}`;
    let nodeTransfers=0;
    const taskReceipt=canvasVideo?'cinegen-canvas:'+btoa(JSON.stringify({canvasId:'canvas_1',nodeId:'node_output',taskId:'provider_task'})).replace(/=+$/,''):'task-1';
    globalThis.fetch=async(url,options)=>{
      const u=String(url);
      if(u.includes('securetoken'))return Response.json({project_id:'48352992061',id_token:'firebase-token',user_id:'owner',refresh_token:'refresh'});
      if(u===`https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/${provider}/generate`){
        assert.equal(options.headers['x-cinegen-id-token'],'firebase-token');
        const p=JSON.parse(options.body).args[0];assert.equal(p.outputType,kind);if(provider==='topview')assert.equal(p.downloadSource,'origin');
        if(p.taskId){polls++;assert.equal(p.taskId,taskReceipt);return Response.json({ok:true,result:{url:source,urls:[source,'https://provider-cdn.example/alternative.png'],status:'success'}});}
        submissions++;assert.equal(p.prompt,'Golden hour');
        if(canvasVideo){assert.deepEqual(p.medias.map(media=>media.role),['image','audio']);assert.match(p.commandId,/^cinegen-/);}
        return Response.json({ok:true,result:provider==='topview'?{taskId:taskReceipt,taskType:canvasVideo?'omni_reference':'text_to_image',model:p.model,status:'running'}:{url:source}});
      }
      if(u==='https://cinegen-film.vercel.app/api/generated-media/save'){
        nodeTransfers++;assert.equal(options.headers.authorization,'Bearer firebase-token');
        const transfer=JSON.parse(options.body);assert.equal(transfer.source,source);assert.equal(transfer.ownerId,'owner');assert.equal(transfer.projectId,raw.project.id);
        const path=`users/owner/projects/${raw.project.id}/media/${values.get('job').nodeId}/generated.mp4`;
        return Response.json({ok:true,result:{url:`https://firebasestorage.googleapis.com/v0/b/cinegen-734ba.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=download`}});
      }
      if(u===source || u==='https://provider-cdn.example/alternative.png'){assert.equal(options.redirect,'manual');if(canvasVideo)return new Response(null,{status:403});if(failDownload)throw new Error('Simulated persistence failure');if(recovering&&u===source)return new Response(null,{status:403});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':kind==='video'?'video/mp4':'image/png'}});}
      if(u.includes('firebasestorage')&&options.method==='POST'){await new Response(options.body).arrayBuffer();return Response.json({downloadTokens:'download'});}
      if(u.includes('firebasestorage'))return new Response('',{status:404});
      throw new Error(`Unexpected provider call: ${u}`);
    };
    try {
      const identity={uid:'owner',email:'owner@example.com',refreshToken:'refresh'};
      const args={provider,projectId:raw.project.id,requestId:'provider-test',model,inputs:{prompt:'Golden hour',...(canvasVideo?{image_url:['https://cinegen.test/hero.png'],audio_references:['https://cinegen.test/music.mp3']}:{})}};
      await new api.GenerationJob(ctx,{}).fetch(new Request('https://job/start',{method:'POST',body:JSON.stringify({identity,args})}));
      await new api.GenerationJob(ctx,{}).alarm();
      if(provider==='topview'){assert.equal(values.get('job').status,'running');await new api.GenerationJob(ctx,{}).alarm();assert.equal(polls,1);}
      if(failDownload) {
        for(let i=1;i<12;i++)await new api.GenerationJob(ctx,{}).alarm();
        assert.equal(values.get('job').status,'needs_attention');
        assert.equal(values.get('job').identity.refreshToken,'');
        const failedView=await api.editProject(raw,{elements:[],folders:[]},'cinegen_get_generations',{});
        assert.equal(failedView.result.generations[0].status,'needs_attention');
        assert.equal(values.get('job').sourceUrl,source);
        const nodeResult=api.hydrate(raw,{elements:[],folders:[]}).nodes[0].data.result;
        assert.equal(nodeResult.progressStage,'needs_attention');
        const foreign=await new api.GenerationJob(ctx,{}).fetch(new Request('https://job/read',{method:'POST',body:JSON.stringify({identity:{...identity,uid:'other'},args})}));
        assert.equal(foreign.status,403);
        assert.equal(values.get('job').status,'needs_attention');
        failDownload=false;recovering=true;
        await new api.GenerationJob(ctx,{}).fetch(new Request('https://job/read',{method:'POST',body:JSON.stringify({identity,args})}));
        assert.equal(values.get('job').status,'saving');
        await new api.GenerationJob(ctx,{}).alarm();
        assert.ok(polls>1);assert.equal(values.get('job').sourceUrl,'https://provider-cdn.example/alternative.png');
      }
      assert.equal(values.get('job').status,'complete');assert.equal(submissions,1);assert.equal(nodeTransfers,canvasVideo?1:0);
      const reopened=api.hydrate(raw,{elements:[],folders:[]});
      assert.equal(reopened.assets.length,1);assert.equal(reopened.nodes[0].data.config.__studioGenerated,true);
      assert.equal(reopened.nodes[0].data.result.status,'complete');
      await new api.GenerationJob(ctx,{}).alarm();assert.equal(submissions,1);
    } finally {api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
  });
}

test('uncertain Topview submissions stop without fallback or a second paid call',async()=>{
  const values=new Map();const ctx={blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>values.has(k)?structuredClone(values.get(k)):undefined,put:async(k,v)=>values.set(k,structuredClone(v)),setAlarm:async()=>{}}};
  const originalLoad=api.CloudStore.prototype.load,originalSave=api.CloudStore.prototype.save;
  let raw=api.createDefaultProjectState('Interrupted film'),paid=0;
  api.CloudStore.prototype.load=async()=>({state:structuredClone(raw),library:{elements:[],folders:[]},metadata:{useSqlite:true},ownerId:'owner'});
  api.CloudStore.prototype.save=async(_,state)=>{raw=structuredClone(state);};
  globalThis.fetch=async url=>{if(String(url).includes('securetoken'))return Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});assert.match(String(url),/\/topview\/generate$/);paid++;throw new Error('Connection lost after submit');};
  try {
    const identity={uid:'owner',email:'owner@example.com',refreshToken:'refresh'};
    const args={provider:'topview',projectId:raw.project.id,requestId:'uncertain',model:'topview-image-seedream-4-5',inputs:{prompt:'A portrait'}};
    const body=JSON.stringify({identity,args});
    await new api.GenerationJob(ctx,{}).fetch(new Request('https://job/start',{method:'POST',body}));
    await new api.GenerationJob(ctx,{}).alarm();assert.equal(values.get('job').status,'needs_attention');
    await new api.GenerationJob(ctx,{}).fetch(new Request('https://job/start',{method:'POST',body}));
    await new api.GenerationJob(ctx,{}).alarm();assert.equal(paid,1);
  } finally {api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
});

test('MCP lists Topview by default and sends authenticated Topview jobs without a fal key',async()=>{
  const originalLoad=api.CloudStore.prototype.load;
  const raw=api.createDefaultProjectState('Default provider film');
  api.CloudStore.prototype.load=async()=>({state:raw,library:{elements:[],folders:[]},metadata:{useSqlite:true}});
  const calls=[];let queued;
  globalThis.fetch=async(url)=>{
    const u=String(url);calls.push(u);
    if(u.includes('securetoken'))return Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});
    if(u.endsWith('/topview/accountStatus'))return Response.json({ok:true,result:{connected:true}});
    if(u.endsWith('/topview/modelCatalog'))return Response.json({ok:true,result:{configs:[]}});
    throw new Error(`Unexpected provider: ${u}`);
  };
  const env={PUBLIC_ORIGIN:'https://cinegen.example',JOBS:{idFromName:n=>n,get:()=>({fetch:async(_,options)=>{queued=JSON.parse(options.body);return Response.json({status:'queued',provider:queued.args.provider});}})}};
  const ctx={props:{uid:'owner',email:'owner@example.com',refreshToken:'refresh'}};
  const invoke=async(name,args)=>{
    const request=new Request('https://cinegen.example/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
    return (await api.handleMcp(request,env,ctx)).json();
  };
  try {
    const listed=await invoke('cinegen_list_models',{kind:'image'});assert.equal(listed.result.isError,undefined);
    const catalog=JSON.parse(listed.result.content[0].text);assert.equal(catalog.provider,'topview');assert.ok(catalog.models.every(m=>m.nodeType.startsWith('topview-')));
    const started=await invoke('cinegen_generate',{projectId:raw.project.id,requestId:'default',model:'topview-image-seedream-4-5',inputs:{prompt:'A sunrise'}});
    assert.equal(started.result.isError,undefined,started.result.content[0].text);
    assert.equal(queued.args.provider,'topview');assert.equal(queued.prepared.provider,'topview');assert.equal(queued.identity.falKey,undefined);
    api.CloudStore.prototype.load=async()=>({state:raw,library:{elements:[{id:'hero',name:'Mara',type:'character',voice:{description:'Soft and smoky'}}]},metadata:{}});
    const video=await invoke('cinegen_generate',{projectId:raw.project.id,requestId:'voice-video',model:'topview-video-seedance-2-5',elementIds:['hero'],inputs:{prompt:'She speaks.'}});
    assert.equal(video.result.isError,undefined,video.result.content[0].text);
    assert.match(queued.prepared.params.prompt,/Mara: Soft and smoky/);
    assert.equal(queued.prepared.prompt,'She speaks.');
    assert.ok(!calls.some(u=>/fal\.run|higgsfield/.test(u)));
  }finally{api.CloudStore.prototype.load=originalLoad;}
});


test('provider downloads follow validated HTTPS CDN redirects without forwarding credentials',async()=>{
  const seen=[];
  globalThis.fetch=async(url,options)=>{
    seen.push(String(url));assert.equal(options.redirect,'manual');assert.equal(options.headers,undefined);
    return seen.length===1 ? new Response(null,{status:302,headers:{location:'https://cdn.example/image.png'}}) : new Response('image',{headers:{'content-type':'image/png'}});
  };
  const result=await api.downloadGeneratedMedia('https://provider.example/result');
  assert.equal(await result.text(),'image');assert.equal(seen.length,2);
});
test('provider downloads reject unsafe redirects, loops and report actual HTTP failures',async()=>{
  for(const destination of ['http://cdn.example/image','https://127.0.0.1/image','https://user:secret@cdn.example/image','https://localhost/image']) {
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:destination}});};
    await assert.rejects(api.downloadGeneratedMedia('https://provider.example/result'),/unsupported media/);assert.equal(calls,1);
  }
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'/loop'}});
  await assert.rejects(api.downloadGeneratedMedia('https://provider.example/result'),/redirect limit/);
  globalThis.fetch=async()=>new Response(null,{status:403});
  await assert.rejects(api.downloadGeneratedMedia('https://provider.example/result'),/HTTP 403, host provider.example/);
});

test('display tools advertise a readable MCP Apps resource and return authenticated structured media without writes',async()=>{
  const env={PUBLIC_ORIGIN:'https://cinegen.example'};const ctx={props:{uid:'owner',email:'owner@example.com',refreshToken:'refresh'}};
  const request=(method,params={})=>new Request('https://cinegen.example/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const send=async(method,params)=>(await api.handleMcp(request(method,params),env,ctx)).json();
  const tools=(await send('tools/list')).result.tools.filter(tool=>tool.name.includes('show_')||tool.name==='cinegen_job_display');
  assert.equal(tools.length,6);
  const resources=(await send('resources/list')).result.resources;
  assert.equal(resources.length,1);
  for(const tool of tools){assert.equal(tool._meta.ui.resourceUri,resources[0].uri);assert.equal(tool.annotations.readOnlyHint,true);assert.ok(tool.inputSchema.required.includes('projectId'));}
  const resource=(await send('resources/read',{uri:resources[0].uri})).result.contents[0];
  assert.equal(resource.mimeType,'text/html;profile=mcp-app');assert.match(resource.text,/ui\/initialize/);assert.match(resource.text,/window.openai/);
  assert.ok((await send('resources/read',{uri:'file:///etc/passwd'})).error);
  globalThis.fetch=async(url)=>{assert.match(String(url),/securetoken.googleapis.com/);return Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});};
  const originalLoad=api.CloudStore.prototype.load,originalSave=api.CloudStore.prototype.save;
  const raw=api.createDefaultProjectState('Display film');let loads=0;
  const url='https://firebasestorage.googleapis.com/v0/b/test/o/image.png?alt=media&token=test';
  api.CloudStore.prototype.load=async(projectId)=>{loads++;assert.equal(projectId,raw.project.id);return {state:raw,library:{elements:[{id:'hero',name:'Hero',type:'character',description:'The lead',images:[{id:'image',url,createdAt:'now',source:'upload'}],createdAt:'now',updatedAt:'now'}],folders:[]},metadata:{useSqlite:true}};};
  api.CloudStore.prototype.save=async()=>{throw new Error('Viewing must not save');};
  try{
    const shown=(await send('tools/call',{name:'cinegen_show_reference_elements',arguments:{projectId:raw.project.id}})).result;
    assert.equal(shown.isError,undefined,shown.content[0].text);assert.equal(shown.structuredContent.items[0].url,url);
    assert.equal(shown.structuredContent.refresh.arguments.projectId,raw.project.id);assert.match(shown.content[0].text,/Open image/);assert.equal(loads,1);
    api.CloudStore.prototype.load=async()=>{throw new Error('Your CineGen account cannot access this project.');};
    const denied=(await send('tools/call',{name:'cinegen_show_generations',arguments:{projectId:'foreign'}})).result;
    assert.equal(denied.isError,true);assert.equal(denied.structuredContent,undefined);
  }finally{api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
});

test('viewing a durable result cannot resume saving, submit generation, or lose its failure state',async()=>{
  const identity={uid:'owner',email:'owner@example.com',refreshToken:'refresh'};
  const record={identity,args:{projectId:'project',requestId:'request',provider:'topview'},status:'needs_attention',nodeId:'node',createdAt:'now',sourceUrl:'https://secret-cdn.example/signed.png',error:'Download failed',prepared:{model:{outputType:'video'}}};
  let writes=0,alarms=0;
  const ctx={blockConcurrencyWhile:fn=>fn(),storage:{get:async()=>structuredClone(record),put:async()=>{writes++;},setAlarm:async()=>{alarms++;}}};
  globalThis.fetch=async()=>{throw new Error('Viewing must not call providers');};
  const job=new api.GenerationJob(ctx,{});
  const response=await (await job.fetch(new Request('https://job/snapshot',{method:'POST',body:JSON.stringify({identity,args:record.args})}))).json();
  assert.equal(response.status,'needs_attention');assert.equal(response.kind,'video');assert.equal(response.error,'Download failed');
  assert.equal(response.sourceUrl,undefined);assert.equal(response.identity,undefined);assert.equal(response.prepared,undefined);
  assert.equal(writes,0);assert.equal(alarms,0);
  const denied=await job.fetch(new Request('https://job/snapshot',{method:'POST',body:JSON.stringify({identity:{...identity,uid:'other'},args:record.args})}));
  assert.equal(denied.status,403);
});

test('requestId display authenticates the project and reads only the durable snapshot endpoint',async()=>{
  const raw=api.createDefaultProjectState('Job display');
  const originalLoad=api.CloudStore.prototype.load,originalSave=api.CloudStore.prototype.save;
  const paths=[];
  const env={PUBLIC_ORIGIN:'https://cinegen.example',JOBS:{idFromName:name=>{assert.equal(name,`owner:${raw.project.id}:job`);return name;},get:()=>({fetch:async(url)=>{paths.push(url);return Response.json({requestId:'job',projectId:raw.project.id,nodeId:'node',status:'saving',kind:'video',url:null,error:'Download failed'});}})}};
  const ctx={props:{uid:'owner',email:'owner@example.com',refreshToken:'refresh'}};
  globalThis.fetch=async(url)=>{assert.match(String(url),/securetoken.googleapis.com/);return Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});};
  api.CloudStore.prototype.load=async()=>({state:raw,library:{elements:[],folders:[]},metadata:{useSqlite:true}});
  api.CloudStore.prototype.save=async()=>{throw new Error('Must not save');};
  try{
    const request=new Request('https://cinegen.example/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'cinegen_job_display',arguments:{projectId:raw.project.id,requestId:'job'}}})});
    const response=(await (await api.handleMcp(request,env,ctx)).json()).result;
    assert.equal(response.isError,undefined,response.content[0].text);
    assert.equal(response.structuredContent.items[0].status,'saving');assert.equal(response.structuredContent.items[0].kind,'video');
    assert.equal(response.structuredContent.items[0].error,'Download failed');
    assert.deepEqual(paths,['https://job/snapshot']);
    assert.deepEqual(response.structuredContent.refresh.arguments,{projectId:raw.project.id,requestId:'job'});
  }finally{api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
});

test('uploaded media can be sent to Studio, serialized and rehydrated without a provider request',async()=>{
  const raw=api.createDefaultProjectState('Studio library');
  const url='https://firebasestorage.googleapis.com/upload.mp4';
  raw.assets=[{id:'uploaded',project_id:raw.project.id,name:'Desktop video',type:'video',source_url:url,created_at:'now'}];
  const library={elements:[],folders:[]};
  globalThis.fetch=async()=>{throw new Error('No provider calls are allowed');};
  const media=await api.editProject(raw,library,'cinegen_show_media',{});
  assert.equal(media.changed,false);assert.equal(media.result.items[0].assetId,'uploaded');
  const spaceId=api.hydrate(raw,library).activeSpaceId;
  const edited=await api.editProject(raw,library,'cinegen_send_to_studio',{itemIds:['asset:uploaded'],spaceId});
  assert.equal(edited.changed,true);assert.equal(edited.result.generated,false);
  const reopened=api.hydrate(JSON.parse(JSON.stringify(edited.state)),library);
  assert.ok(reopened.nodes.some(node=>node.data.config.__studioMedia&&node.data.config.fileUrl===url));
  const repeat=await api.editProject(edited.state,library,'cinegen_send_to_studio',{itemIds:['asset:uploaded'],spaceId});
  assert.equal(repeat.changed,false);assert.deepEqual(repeat.result.nodeIds,edited.result.nodeIds);
});

test('ordered cloud batch reads snapshots, isolates missing jobs and retains durable saving status',async()=>{
  const raw=api.createDefaultProjectState('Batch review'), originalLoad=api.CloudStore.prototype.load, originalSave=api.CloudStore.prototype.save;
  const paths=[];const env={PUBLIC_ORIGIN:'https://cinegen.example',JOBS:{idFromName:name=>name,get:name=>({fetch:async(url)=>{
    paths.push(url);const requestId=name.split(':').at(-1);
    return Response.json(requestId==='missing'?{status:'not_found'}:{requestId,nodeId:'node-'+requestId,status:requestId==='saving'?'saving':'complete',kind:'video',url:requestId==='saving'?null:'https://firebasestorage.googleapis.com/result.mp4',error:requestId==='saving'?'Download failed':undefined});
  }})}};
  const ctx={props:{uid:'owner',email:'owner@example.com',refreshToken:'refresh'}};
  globalThis.fetch=async(url)=>{assert.match(String(url),/securetoken.googleapis.com/);return Response.json({project_id:'48352992061',id_token:'token',user_id:'owner',refresh_token:'refresh'});};
  api.CloudStore.prototype.load=async()=>({state:raw,library:{elements:[],folders:[]},metadata:{useSqlite:true}});
  api.CloudStore.prototype.save=async()=>{throw new Error('Must not save');};
  const send=async(args)=>{
    const request=new Request('https://cinegen.example/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'cinegen_show_generation_batch',arguments:{projectId:raw.project.id,...args}}})});
    return (await (await api.handleMcp(request,env,ctx)).json()).result;
  };
  try{
    const jobs=[{requestId:'done'},{requestId:'missing'},{requestId:'saving'}];
    const shown=await send({jobs});assert.equal(shown.isError,undefined,shown.content[0].text);
    assert.deepEqual(shown.structuredContent.items.map(item=>item.status),['complete','not_found','saving']);
    assert.equal(shown.structuredContent.items[0].kind,'video');assert.equal(shown.structuredContent.items[2].error,'Download failed');
    assert.equal(shown.structuredContent.allFound,false);assert.deepEqual(paths,['https://job/snapshot','https://job/snapshot','https://job/snapshot']);
    const paged=await send({jobs,offset:2,limit:1});assert.equal(paged.structuredContent.items[0].batchIndex,3);assert.equal(paged.structuredContent.allFound,false);
    const mismatch=await send({jobs:[{requestId:'done',nodeId:'wrong'}]});assert.equal(mismatch.structuredContent.items[0].status,'not_found');
  }finally{api.CloudStore.prototype.load=originalLoad;api.CloudStore.prototype.save=originalSave;}
});

test('Topview Seedance exposes and preserves mixed references including extensionless audio',()=>{
  const prepared=api.prepareProviderGeneration({model:'topview-video-seedance-2-5',inputs:{prompt:'Match the beat.',image_url:['https://example.com/hero.png','https://example.com/motion.mp4'],audio_references:['https://example.com/media/opaque-id?token=test']}});
  assert.deepEqual(prepared.params.medias,[
    {value:'https://example.com/hero.png',role:'image'},
    {value:'https://example.com/motion.mp4',role:'video'},
    {value:'https://example.com/media/opaque-id?token=test',role:'audio'},
  ]);
  assert.deepEqual(prepared.config.audio_references,['https://example.com/media/opaque-id?token=test']);
});

test('remote audio generation runs the connected account and saves the playable result without another download',async()=>{
  const raw=api.createDefaultProjectState('Voice film');
  const created=await api.editProject(raw,{version:1,elements:[],folders:[]},'cinegen_create_element',{name:'Cody',voice:{description:'Calm and warm',voiceId:'cody-voice'}});
  const character=created.library.elements[0];
  const prepared=await api.editProject(created.state,created.library,'cinegen_audio',{action:'prepare',elementId:character.id,text:'Ready when you are.'});
  const args={action:'generate',nodeId:prepared.result.nodeId,spaceId:prepared.result.spaceId,requestId:'paid-audio-1'};
  const url='https://firebasestorage.googleapis.com/v0/b/cinegen-734ba.firebasestorage.app/o/audio.mp3?alt=media';
  const generate=async(request)=>{assert.equal(request.voiceId,'cody-voice');assert.equal(request.requestId,'paid-audio-1');assert.equal(request.text,'Ready when you are.');return {status:'complete',assetId:'paid-audio-1',requestId:'paid-audio-1',url};};
  const saved=await api.editProject(prepared.state,prepared.library,'cinegen_audio',args,true,()=>{throw new Error('Already saved audio must not download again.');},generate);
  assert.equal(saved.result.url,url);assert.equal(saved.result.requestId,'paid-audio-1');
  const reopened=api.hydrate(saved.state,saved.library);
  assert.equal(reopened.assets[0].type,'audio');assert.equal(reopened.nodes.find(n=>n.id===args.nodeId).data.result.audioRequestId,'paid-audio-1');
  await assert.rejects(api.editProject(prepared.state,prepared.library,'cinegen_audio',{...args,requestId:undefined},true,undefined,generate),/requestId/);
});
