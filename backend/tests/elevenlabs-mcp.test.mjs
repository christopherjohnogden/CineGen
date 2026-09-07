import { build } from '../../node_modules/esbuild/lib/main.js';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
await build({ entryPoints: ['site/lib/server/elevenlabs-mcp.ts', 'site/lib/server/elevenlabs.ts', 'site/lib/server/elevenlabs-mcp-audio.ts'], outdir: 'backend/dist/mcp-test', bundle: true, platform: 'browser', format: 'esm', outExtension: { '.js': '.mjs' } });
const { createElevenLabsMcp, handleElevenLabsOAuth, mcpSession, ELEVENLABS_CLIENT_ID, ELEVENLABS_ORIGIN } = await import('../dist/mcp-test/elevenlabs-mcp.mjs');
const { createElevenLabs, mcpAudioResponse } = await import('../dist/mcp-test/elevenlabs.mjs');
const { toolArguments, returnedAudio } = await import('../dist/mcp-test/elevenlabs-mcp-audio.mjs');
function fixture() {
  const sqlite = new DatabaseSync(':memory:'), media = new Map();
  const DB = { prepare(sql) { return { v: [], bind(...v) { this.v = v; return this; }, async first() { return sqlite.prepare(sql).get(...this.v) || null; }, async all() { return { results: sqlite.prepare(sql).all(...this.v) }; }, async run() { const result = sqlite.prepare(sql).run(...this.v); return { meta: { changes: Number(result.changes) } }; } }; } };
  const MEDIA = { async put(k,v) { media.set(k,new Uint8Array(await new Response(v).arrayBuffer())); }, async head(k) { return media.has(k); }, async get(k) { if(!media.has(k)) return null; const r=new Response(media.get(k));return {body:r.body,size:media.get(k).length,get bodyUsed(){return r.bodyUsed;}}; } };
  const env = { DB, MEDIA, CINEGEN_WORKSPACE_PROVIDER_SECRET: 'test-key' }, workspace = 'test-workspace';
  return { env, sqlite, workspace, mcp: createElevenLabsMcp(env,workspace), service: createElevenLabs(env,workspace,{token:'firebase-test',uid:'owner'}) };
}
async function start(f) {
  const login = await f.mcp.authLogin();
  const response = await handleElevenLabsOAuth(new Request(login.authorizationUrl),f.env);
  assert.equal(response.status,302);
  const authorize = new URL(response.headers.get('location'));
  return { login, authorize, cookie: response.headers.get('set-cookie').split(';')[0] };
}
function callback(started,extra={}) {
  const url=new URL('/api/elevenlabs/oauth/callback',ELEVENLABS_ORIGIN);
  url.search=new URLSearchParams({state:started.authorize.searchParams.get('state'),code:'test-code',iss:'https://api.us.elevenlabs.io',...extra});
  return new Request(url,{headers:{cookie:started.cookie}});
}
const tts={name:'text_to_speech',inputSchema:{type:'object',properties:{text:{type:'string'},voice_id:{type:'string'},model_id:{type:'string'},output_format:{type:'string'}},required:['text','voice_id']}};
const voices={name:'get_voices',inputSchema:{type:'object',properties:{}}};
const tokenResponse=()=>Response.json({access_token:'oauth-only-secret',refresh_token:'refresh-only-secret',expires_in:3600});
// Input schemas captured from ElevenLabs' authenticated hosted tools/list,
// 2026-09-07. These differ from its local Python MCP server.
const hostedTools=JSON.parse(readFileSync(new URL('./fixtures/elevenlabs-hosted-tools.json',import.meta.url)));
function validateHosted(name,args) {
  const schema=hostedTools.find(t=>t.name===name)?.inputSchema; assert(schema,`Unknown tool ${name}`);
  for(const key of schema.required||[])assert.notEqual(args[key],undefined,`Missing ${key}`);
  for(const [key,value] of Object.entries(args)) {
    const prop=schema.properties[key]; assert(prop,`Unexpected ${key}`);
    if(prop.enum)assert(prop.enum.includes(value));
    if(prop.minLength)assert(value.length>=prop.minLength);
    if(prop.maxLength)assert(value.length<=prop.maxLength);
    if(prop.minimum!==undefined)assert(value>=prop.minimum);
    if(prop.maximum!==undefined)assert(value<=prop.maximum);
  }
}
function mockHosted(onCall,onDownload=()=>new Response('ID3-audio',{headers:{'content-type':'audio/mpeg'}})) {
  return async(url,init={})=>{
    const u=String(url);
    if(u.endsWith('/oauth/token'))return tokenResponse();
    if(u.endsWith('/v1/mcp')) {
      const p=JSON.parse(init.body);let result;
      if(p.method==='initialize')result={protocolVersion:'2025-03-26'};
      if(p.method==='notifications/initialized')return new Response(null,{status:202});
      if(p.method==='tools/list')result={tools:hostedTools};
      if(p.method==='tools/call'){validateHosted(p.params.name,p.params.arguments);result={structuredContent:await onCall(p.params.name,p.params.arguments)};}
      return Response.json({jsonrpc:'2.0',id:p.id,result});
    }
    if(u.startsWith('https://cdn.elevenlabs.io/')){assert.equal(init.headers,undefined);return onDownload(u);}
    assert(u.startsWith('https://firebasestorage.googleapis.com/'),`Not an audio download: ${u}`);
    if(!init.method)return new Response('',{status:404});
    await new Response(init.body).arrayBuffer();return Response.json({downloadTokens:'durable'});
  };
}
async function connectFixture(f){const s=await start(f);assert.equal((await handleElevenLabsOAuth(callback(s),f.env)).status,200);}
function pollNow(f){f.sqlite.prepare('UPDATE elevenlabs_audio_runs SET next_poll_at=0').run();}

test('actual hosted voices schema receives context, speech maps prompt and requests only one take',async()=>{
  const f=fixture(),original=fetch;let paid=0,checks=0;
  globalThis.fetch=mockHosted((name,args)=>{
    if(name==='creative_list_voices'){assert(args.search==='Cody'||!('search' in args));assert.match(args.context,/voice picker/);return {voices:[{voice_id:'voice-cody',name:'Cody'}],total_count:1};}
    if(name==='creative_generate_speech'){
      paid++;assert.equal(args.prompt,'[quietly] Hello.');assert.equal(args.text,undefined);assert.equal(args.generations_count,1);assert.equal(args.model_id,'eleven_v3');
      return {flow_id:'flow-one',session_ids:['session-one'],url:'https://elevenlabs.io/app/flows/flow-one',poll_after_seconds:5};
    }
    checks++;assert.equal(name,'creative_get_flow_run_status');assert.deepEqual(args.session_ids,['session-one']);assert.equal(args.flow_id,'flow-one');
    return {flow_id:'flow-one',session_ids:['session-one'],all_completed:true,url:'https://elevenlabs.io/app/flows/flow-one',media:[{generation_id:'gen-one',kind:'audio',url:'https://cdn.elevenlabs.io/preview.mp3',master_url:'https://cdn.elevenlabs.io/master.mp3'}]};
  },url=>{assert.equal(url,'https://cdn.elevenlabs.io/master.mp3');return new Response('ID3-audio',{headers:{'content-type':'audio/mpeg'}});});
  try{
    await connectFixture(f);assert.equal((await f.service.voices({search:'Cody'})).voices[0].id,'voice-cody');assert.equal((await f.service.voices({search:''})).voices.length,1);
    const request={requestId:'hosted-take',kind:'speech',text:'Hello.',direction:'quietly',voiceId:'voice-cody'};
    assert.equal((await f.service.generate(request)).status,'generating');
    assert.equal((await f.service.job({requestId:request.requestId})).status,'generating');assert.equal(checks,0,'honors provider polling delay');
    pollNow(f);
    const reopened=createElevenLabs(f.env,f.workspace,{token:'firebase-test',uid:'owner'});
    assert.equal((await reopened.job({requestId:request.requestId})).status,'complete');
    assert.equal((await reopened.generate(request)).status,'complete');assert.equal(paid,1);assert.equal(checks,1);
    await assert.rejects(reopened.generate({...request,text:'Changed'}),/another take/);
  }finally{globalThis.fetch=original;f.sqlite.close();}
});

test('hosted download failures refresh the same run URL and concurrent polls cannot repeat submission',async()=>{
  const f=fixture(),original=fetch;let paid=0,checks=0,downloads=0,release;
  globalThis.fetch=mockHosted(async name=>{
    if(name==='creative_generate_speech'){paid++;return {flow_id:'flow',session_ids:['session']};}
    checks++;
    if(checks===2)await new Promise(resolve=>{release=resolve;});
    return {all_completed:true,media:[{generation_id:'g',kind:'audio',url:`https://cdn.elevenlabs.io/audio-${checks}.mp3`}]};
  },url=>{downloads++;return downloads===1?new Response('',{status:403}):new Response('ID3-audio',{headers:{'content-type':'audio/mpeg'}});});
  try{
    await connectFixture(f);const request={requestId:'recover',kind:'speech',text:'Hello.',voiceId:'Cody'};
    await f.service.generate(request);pollNow(f);
    const failed=await f.service.job({requestId:'recover'});assert.equal(failed.status,'saving');assert.match(failed.error,/403/);
    pollNow(f);const active=f.service.job({requestId:'recover'});
    while(!release)await new Promise(r=>setImmediate(r));
    assert.equal((await f.service.generate(request)).status,'saving');assert.equal(checks,2);
    release();assert.equal((await active).status,'complete');assert.equal(paid,1);assert.equal(downloads,2);
  }finally{globalThis.fetch=original;f.sqlite.close();}
});

test('provider failures are terminal while transport errors preserve a recoverable run',async()=>{
  const f=fixture(),original=fetch;let paid=0,checks=0;
  globalThis.fetch=mockHosted(name=>{
    if(name==='creative_generate_speech'){paid++;return {flow_id:'flow',session_ids:['session']};}
    if(++checks===1)throw new Error('Temporary network failure');
    return {has_failures:true,error:'Insufficient credits',generations:[{id:'g',status:'failed',error_message:'Insufficient credits'}]};
  });
  try{
    await connectFixture(f);const req={requestId:'failure',kind:'speech',text:'Hello.',voiceId:'Cody'};
    await f.service.generate(req);pollNow(f);
    const pending=await f.service.job({requestId:'failure'});assert.equal(pending.status,'generating');assert.match(pending.error,/network/);
    pollNow(f);const failure=await f.service.job({requestId:'failure'});assert.equal(failure.status,'error');assert.equal(failure.error,'Insufficient credits');
    assert.equal((await f.service.generate(req)).status,'error');assert.equal(paid,1);assert.equal(checks,2);
    assert.throws(()=>returnedAudio({flow_id:'flow',url:'https://elevenlabs.io/app/flows/flow'}),/did not return/);
  }finally{globalThis.fetch=original;f.sqlite.close();}
});

test('hosted voice design uses language and signed previews; save retains the selected view identity',async()=>{
  const f=fixture(),original=fetch;let designs=0;
  globalThis.fetch=mockHosted((name,args)=>{
    if(name==='creative_design_voice'){designs++;assert.equal(args.language,'en');return {view_state_id:'preview-view',previews:[{generated_voice_id:'voice-preview',audio_url:'https://cdn.elevenlabs.io/voice-preview.mp3'}]};}
    assert.equal(name,'creative_save_designed_voice');assert.equal(args.generated_voice_id,'voice-preview');assert.equal(args.view_state_id,'preview-view');
    return {saved_voice_id:'saved-cody',saved_voice_name:'Cody'};
  });
  try{
    await connectFixture(f);const description='A warm, low voice, slightly gravelly with a soft Southern accent.';
    await assert.rejects(f.service.design({description}),/sample dialogue/);assert.equal(designs,0);
    const designed=await f.service.design({description,text:'This is a sample line for the new character voice, with enough dialogue to hear the pace, tone, and accent clearly.',language:'en'});
    assert.equal(designed.previews[0].viewStateId,'preview-view');assert.match(designed.previews[0].url,/durable/);
    const saved=await f.service.saveVoice({id:designed.previews[0].id,name:'Cody',description,viewStateId:designed.previews[0].viewStateId});assert.deepEqual(saved,{id:'saved-cody',name:'Cody'});
    assert.equal(designs,1);
  }finally{globalThis.fetch=original;f.sqlite.close();}
});

test('CIMD identifies CineGen; OAuth uses PKCE, browser binding, encrypted credentials and one-time callbacks',async()=>{
  const f=fixture(),original=fetch; let exchanges=0;
  globalThis.fetch=async(url,init)=>{exchanges++;const p=new URLSearchParams(init.body);assert.equal(p.get('client_id'),ELEVENLABS_CLIENT_ID);assert.equal(p.get('code_verifier').length,43);assert.equal(p.get('resource'),'https://api.us.elevenlabs.io/v1/mcp');return tokenResponse();};
  try{
    const metadata=await(await handleElevenLabsOAuth(new Request(ELEVENLABS_CLIENT_ID),f.env)).json();
    assert.equal(metadata.client_name,'CineGen');assert.equal(metadata.token_endpoint_auth_method,'none');assert(!metadata.scope.includes('convai_write'));
    const s=await start(f);assert.equal(s.authorize.searchParams.get('code_challenge_method'),'S256');
    const noCookie=new Request(callback(s).url);assert.equal((await handleElevenLabsOAuth(noCookie,f.env)).status,400);assert.equal(exchanges,0);
    assert.equal((await handleElevenLabsOAuth(callback(s),f.env)).status,200);
    assert.deepEqual(await f.mcp.authStatus({attempt:s.login.attempt}),{connected:true});
    assert.equal((await handleElevenLabsOAuth(callback(s),f.env)).status,400);assert.equal(exchanges,1);
    const row=f.sqlite.prepare('SELECT * FROM elevenlabs_oauth_connections').get();assert(!JSON.stringify(row).includes('oauth-only-secret'));assert(!JSON.stringify(row).includes('refresh-only-secret'));
  }finally{globalThis.fetch=original;f.sqlite.close();}
});

test('stale attempts, issuer mismatch, expired sign-ins and rejected scopes cannot connect',async()=>{
  const f=fixture(),original=fetch;let exchanges=0;globalThis.fetch=async()=>{exchanges++;return tokenResponse();};
  try{
    const old=await start(f), latest=await start(f);
    assert.equal((await handleElevenLabsOAuth(callback(old),f.env)).status,400);
    assert.equal((await handleElevenLabsOAuth(callback(latest,{iss:'https://attacker.invalid'}),f.env)).status,400);
    assert.equal(await f.mcp.connected(),false);assert.equal(exchanges,0);
    const expired=await start(f);f.sqlite.prepare('UPDATE elevenlabs_oauth_pending SET expires_at=0').run();
    assert.equal((await handleElevenLabsOAuth(callback(expired),f.env)).status,400);assert.equal(exchanges,0);
    const rejected=await start(f);assert.equal((await handleElevenLabsOAuth(callback(rejected,{error:'access_denied'}),f.env)).status,400);assert.match((await f.mcp.authStatus({attempt:rejected.login.attempt})).error,/cancelled/);
  }finally{globalThis.fetch=original;f.sqlite.close();}
});

test('SSE tool results stop reading on matching result and tool errors are never retried',async()=>{
  const original=fetch;let calls=0,cancelled=false;
  globalThis.fetch=async(url,init)=>{
    assert.equal(init.headers.authorization,'Bearer token');const p=JSON.parse(init.body);
    if(p.method==='initialize')return Response.json({jsonrpc:'2.0',id:p.id,result:{protocolVersion:'2025-03-26'}},{headers:{'mcp-session-id':'session'}});
    assert.equal(init.headers['mcp-session-id'],'session');
    if(p.method==='notifications/initialized')return new Response(null,{status:202});
    if(p.method==='tools/list')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(`event: message\r\ndata: ${JSON.stringify({jsonrpc:'2.0',id:p.id,result:{tools:[tts]}})}\r\n\r\n`));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
    calls++;return Response.json({jsonrpc:'2.0',id:p.id,result:{isError:true,content:[{type:'text',text:'Insufficient credits'}]}});
  };
  try{const session=await mcpSession('token');assert.equal((await session.tools())[0].name,'text_to_speech');assert(cancelled);await assert.rejects(session.call('text_to_speech',{}),/Insufficient credits/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});

test('OAuth generation uses MCP only, saves once, and recovers saving without another paid call',async()=>{
  const f=fixture(),original=fetch;let paid=0,storageFails=true;
  globalThis.fetch=async(url,init={})=>{
    const u=String(url);
    if(u.endsWith('/oauth/token'))return tokenResponse();
    if(u.endsWith('/v1/mcp')){
      assert.equal(init.headers.authorization,'Bearer oauth-only-secret');assert.equal(init.headers['xi-api-key'],undefined);
      const p=JSON.parse(init.body);let result;
      if(p.method==='initialize')result={protocolVersion:'2025-03-26'};
      if(p.method==='notifications/initialized')return new Response(null,{status:202});
      if(p.method==='tools/list')result={tools:[tts,voices]};
      if(p.method==='tools/call'){
        if(p.params.name==='get_voices')result={structuredContent:{voices:[{voice_id:'Cody',name:'Cody'}]}};
        else{paid++;assert.equal(p.params.name,'text_to_speech');assert.deepEqual(p.params.arguments,{text:'[quietly] Hello.',voice_id:'Cody',model_id:'eleven_v3',output_format:'mp3_44100_128'});result={structuredContent:{audio_url:'https://cdn.elevenlabs.io/audio.mp3'}};}
      }
      return Response.json({jsonrpc:'2.0',id:p.id,result});
    }
    if(u==='https://cdn.elevenlabs.io/audio.mp3'){assert.equal(init.headers,undefined);return new Response('ID3-audio',{headers:{'content-type':'audio/mpeg'}});}
    assert(u.startsWith('https://firebasestorage.googleapis.com/'));assert.equal(init.headers.authorization,'Firebase firebase-test');
    if(!init.method)return new Response('',{status:404});
    await new Response(init.body).arrayBuffer();return storageFails?new Response('',{status:503}):Response.json({downloadTokens:'durable'});
  };
  try{
    const s=await start(f);assert.equal((await handleElevenLabsOAuth(callback(s),f.env)).status,200);
    assert.equal((await f.service.accountStatus()).connection,'mcp');assert.equal((await f.service.voices({})).voices[0].id,'Cody');
    const request={requestId:'take',projectId:'project',kind:'speech',text:'Hello.',direction:'quietly',voiceId:'Cody'};
    assert.equal((await f.service.generate(request)).status,'saving');storageFails=false;
    assert.equal((await f.service.job({requestId:'take'})).status,'complete');
    assert.equal((await f.service.generate(request)).status,'complete');assert.equal(paid,1);
    await assert.rejects(f.service.generate({...request,requestId:'sound',kind:'sound'}),/does not expose sound effects/);assert.equal(paid,1);
  }finally{globalThis.fetch=original;f.sqlite.close();}
});

test('schema changes and unsafe audio redirects fail without inventing parameters or leaking credentials',async()=>{
  assert.throws(()=>toolArguments({...tts,inputSchema:{...tts.inputSchema,required:['text','voice_id','new_required']}},{text:'hello',voice_id:'Cody'}),/changed/);
  assert.deepEqual(returnedAudio({content:[{type:'text',text:JSON.stringify({audio_url:'https://cdn.elevenlabs.io/x'})}]}),{url:'https://cdn.elevenlabs.io/x'});
  const original=fetch;let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(init.headers,undefined);return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});};
  try{await assert.rejects(mcpAudioResponse({structuredContent:{audio_url:'https://cdn.elevenlabs.io/x'}}),/unsupported audio address/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
