import { build } from '../../node_modules/esbuild/lib/main.js';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
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
