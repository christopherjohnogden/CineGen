import {build} from '../../node_modules/esbuild/lib/main.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
await build({entryPoints:['site/lib/server/topview-mcp.ts'],outfile:'backend/dist/topview-media-test.mjs',bundle:true,platform:'browser',format:'esm',alias:{'@':new URL('../../src',import.meta.url).pathname}});
const {createTopviewMcp}=await import('../dist/topview-media-test.mjs');
async function fixtureApi(apiKey = false) {
  const secret='fixture-secret';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
  const key=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({access_token:'fixture-token',expires_at:Date.now()+3600000})));
  const row={client_json:apiKey ? JSON.stringify({auth_mode:'api_key',topview_uid:'fixture-uid'}) : '{}',token_ciphertext:JSON.stringify({version:1,iv:Buffer.from(iv).toString('base64'),data:Buffer.from(encrypted).toString('base64')})};
  const DB={prepare(){return {bind(){return this},async first(){return row},async run(){return {}}}}};
  return createTopviewMcp({DB,CINEGEN_TOPVIEW_TOKEN_SECRET:secret},'test','http://localhost');
}


test('avatar submits once and resumes the original paid task',async()=>{
 const api=await fixtureApi(),calls=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
   const req=JSON.parse(options.body);let result={};
   if(req.method==='notifications/initialized')return new Response(null,{status:202});
   if(req.method==='tools/list')result={tools:[{name:'topview_avatar_video',inputSchema:{properties:{req:{type:'object'}}}},{name:'topview_query_task',inputSchema:{properties:{req:{type:'object'}}}}]};
   if(req.method==='tools/call') {calls.push(req.params);result={structuredContent:{code:'200',result:req.params.name==='topview_avatar_video'?{taskId:'original-avatar',status:'running'}:{taskId:'original-avatar',status:'success',videoUrl:'https://example.com/completed.mp4'}}};}
   return Response.json({jsonrpc:'2.0',id:req.id,result});
 };
 try {
  const receipt=await api.submit({model:'Avatar 4 Fast',prompt:'Smile',medias:[{value:'topview-file:photo',role:'image'},{value:'topview-file:audio',role:'audio'}]});
  assert.equal(receipt.taskType,'avatar_video');assert.equal(receipt.taskId,'original-avatar');
  assert.deepEqual(calls[0].arguments.req,{mode:'avatar4Fast',templateImageFileId:'photo',scriptMode:'audio',audioFileId:'audio',offPeak:false,saveCustomAiAvatar:'false',customMotion:'Smile'});
  const done=await api.query(receipt);assert.equal(done.url,'https://example.com/completed.mp4');
  assert.equal(calls.filter(c=>c.name==='topview_avatar_video').length,1);
  assert.equal(calls[1].arguments.req.shortenUrls,false);
  await assert.rejects(()=>api.submit({model:'Video Upscale',medias:[{value:'topview-file:video',role:'video'}]}),/not exposed/);
  await assert.rejects(()=>api.submit({model:'Video Lip Sync',medias:[{value:'topview-file:video',role:'video'},{value:'topview-file:audio',role:'audio'}]}),/API-key/);
  assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;}
});

test('lip sync uses only an existing API-key connection and queries with GET',async()=>{
 const api=await fixtureApi(true),calls=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://api.topview.ai/v1/video_avatar/')) {
   calls.push({url:String(url),options});
   return Response.json({code:'200',result:options.method==='POST'?{taskId:'original-lip',status:'running'}:{status:'success',videoUrl:'https://example.com/lip.mp4'}});
  }
  const req=JSON.parse(options.body);
  if(req.method==='notifications/initialized')return new Response(null,{status:202});
  return Response.json({jsonrpc:'2.0',id:req.id,result:{tools:[]}});
 };
 try {
  const receipt=await api.submit({model:'Video Lip Sync',medias:[{value:'topview-file:video',role:'video'},{value:'topview-file:audio',role:'audio'}]});
  assert.equal(receipt.taskType,'lip_sync');
  assert.equal((await api.query(receipt)).url,'https://example.com/lip.mp4');
  assert.equal(calls.length,2);assert.equal(calls[0].options.method,'POST');assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.body,undefined);
 }finally{globalThis.fetch=original;}
});
