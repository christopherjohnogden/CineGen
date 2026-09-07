import { build } from '../../node_modules/esbuild/lib/main.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasFixture, canvasToolNames } from '../../tests/fixtures/topview-canvas.mjs';
await build({entryPoints:['site/lib/server/topview-mcp.ts'],outfile:'backend/dist/topview-test.mjs',bundle:true,platform:'browser',format:'esm',alias:{'@':new URL('../../src',import.meta.url).pathname}});
const {createTopviewMcp}=await import('../dist/topview-test.mjs');

test('the cloud OAuth connection submits mixed references through Canvas and resumes the same paid task', async()=>{
  let connection;
  const db={prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return connection??null;},async run(){if(sql.includes('INSERT INTO provider_connections'))connection={client_json:this.values[2],pending_ciphertext:this.values[3],token_ciphertext:this.values[4]};return {meta:{changes:1}};}};}};
  const api=createTopviewMcp({DB:db},'cinegen-local-v1','http://localhost');
  await api.importTeamConnection({client:{client_id:'fixture'},token:{access_token:'fixture-oauth',expires_at:Date.now()+3600000}});
  const canvas=canvasFixture();const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://media.cinegen.test/'))return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':String(url).endsWith('.mp3')?'audio/mpeg':String(url).endsWith('.mp4')?'video/mp4':'image/png'}});
    if(String(url)==='https://upload.topview.ai/fixture')return new Response(null,{status:200});
    assert.equal(String(url),'https://mcp.topview.ai/mcp','must not switch the OAuth connection to REST');
    assert.equal(options.headers.authorization,'Bearer fixture-oauth');
    const request=JSON.parse(options.body);let result={};
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    if(request.method==='tools/list')result={tools:[...canvasToolNames.map(name=>({name,inputSchema:{type:'object'}})),
      {name:'topview_get_generation_config',inputSchema:{type:'object',properties:{req:{type:'object'}}}},
      {name:'topview_generate_video',inputSchema:{type:'object',properties:{req:{type:'object',properties:{taskType:{type:'string'},model:{type:'string'},prompt:{type:'string'},inputImages:{type:'array'},inputVideos:{type:'array'}},additionalProperties:false}}}},
    ]};
    if(request.method==='tools/call') {
      const {name,arguments:args}=request.params;
      if(name==='topview_get_generation_config')result={structuredContent:{models:[{displayName:'Seedance 2.5',submitModel:'Seedance 2.5',requiredSubmitFields:['model','prompt'],defaultSubmitParameters:{resolution:720,duration:30,aspectRatio:'16:9'},submitParameterOptions:{resolution:[480,720,1080],duration:[12,30],aspectRatio:['16:9']},raw:{parameters:{supportHybridUploadsRef:{audios:true}}}}]}};
      else result=await canvas.call(name,args);
    }
    return Response.json({jsonrpc:'2.0',id:request.id,result});
  };
  try {
    const receipt=await api.generate({prompt:'Match the audio.',model:'Seedance 2.5',outputType:'video',waitForCompletion:false,resolution:1080,durationSec:12,generateAudio:false,
      medias:[{value:'https://media.cinegen.test/image.png',role:'image'},{value:'https://media.cinegen.test/video.mp4',role:'video'},{value:'https://media.cinegen.test/audio.mp3',role:'audio'}]});
    assert.match(receipt.taskId,/^cinegen-canvas:/);
    assert.equal(receipt.status,'running');
    const query={taskId:receipt.taskId,taskType:receipt.taskType,model:receipt.model,outputType:'video',waitForCompletion:false};
    assert.equal((await api.generate(query)).status,'running');
    canvas.complete();
    const finished=await api.generate(query);
    assert.equal(finished.status,'success');
    assert.equal(finished.url,'https://download.topview.ai/output.mp4?signature=fixture');
    assert.equal(finished.taskId,receipt.taskId);
    assert.equal(finished.boardUrl,undefined,'must not invent a Marketing Studio link for a Canvas task');
    assert.equal(canvas.calls.filter(call=>call.name==='submit_topview_canvas_generation_task').length,1);
  }finally{globalThis.fetch=original;}
});

test('submission refreshes the live Seedance catalog and preserves 1080p without a silent downgrade',async()=>{
  let connection;
  const db={prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return connection??null;},async run(){if(sql.includes('INSERT INTO provider_connections'))connection={client_json:this.values[2],pending_ciphertext:this.values[3],token_ciphertext:this.values[4]};return {meta:{changes:1}};}};}};
  const api=createTopviewMcp({DB:db},'cinegen-local-v1','http://localhost');
  await api.importTeamConnection({client:{client_id:'fixture'},token:{access_token:'fixture',expires_at:Date.now()+3600000}});
  const calls=[];const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://mcp.topview.ai/mcp');
    const request=JSON.parse(options.body);let result={};
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    if(request.method==='tools/list')result={tools:['topview_get_generation_config','topview_generate_video'].map(name=>({name,inputSchema:{type:'object',properties:{req:{type:'object'}}}}))};
    if(request.method==='tools/call'){
      const {name,arguments:args}=request.params;calls.push({name,args});
      const payload=name==='topview_get_generation_config'?{models:[{displayName:'Seedance 2.5',submitModel:'Seedance 2.5',requiredSubmitFields:['taskType','model','prompt','resolution','duration','aspectRatio'],defaultSubmitParameters:{duration:4,resolution:720,aspectRatio:'16:9'},submitParameterOptions:{duration:[4,30],resolution:args.req.refresh?[480,720,1080]:[480,720],aspectRatio:['16:9']}}]}:{taskId:'existing-fixture-task',status:'init'};
      result={content:[{type:'text',text:JSON.stringify({code:'200',result:payload})}]};
    }
    return Response.json({jsonrpc:'2.0',id:request.id,result});
  };
  try{
    const result=await api.generate({prompt:'Fixture',outputType:'video',model:'Seedance 2.5',resolution:'1080p',durationSec:30,aspectRatio:'16:9',boardId:'fixture-board',waitForCompletion:false});
    assert.equal(result.taskId,'existing-fixture-task');
    assert.equal(calls[0].args.req.refresh,true);
    const submit=calls.find(c=>c.name==='topview_generate_video');
    assert.equal(submit.args.req.resolution,1080);assert.equal(submit.args.req.duration,30);
    assert.equal(calls.filter(c=>c.name==='topview_generate_video').length,1);
  }finally{globalThis.fetch=original;}
});

test('audio references use the existing API connection without loss; MCP-only connections stop before a paid submit', async()=>{
  for (const apiKeyMode of [true,false]) {
    let connection;
    const db={prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return connection??null;},async run(){if(sql.includes('INSERT INTO provider_connections'))connection={client_json:this.values[2],pending_ciphertext:this.values[3],token_ciphertext:this.values[4]};return {meta:{changes:1}};}};}};
    const api=createTopviewMcp({DB:db},'cinegen-local-v1','http://localhost');
    await api.importTeamConnection(apiKeyMode?{apiKey:'fixture-key',uid:'fixture-user'}:{client:{client_id:'fixture'},token:{access_token:'fixture',expires_at:Date.now()+3600000}});
    const paidRequests=[]; const original=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{
      if(String(url)==='https://api.topview.ai/v1/common_task/omni_reference/task/submit') {
        paidRequests.push(JSON.parse(options.body));
        assert.equal(options.headers['Topview-Uid'],'fixture-user');
        assert.equal(options.headers.authorization,'Bearer fixture-key');
        return Response.json({code:'200',result:{taskId:'audio-fixture',status:'init'}});
      }
      assert.equal(String(url),'https://mcp.topview.ai/mcp');
      const request=JSON.parse(options.body);let result={};
      if(request.method==='notifications/initialized')return new Response(null,{status:202});
      if(request.method==='tools/list')result={tools:[
        {name:'topview_get_generation_config',inputSchema:{type:'object',properties:{req:{type:'object'}}}},
        {name:'topview_generate_video',inputSchema:{type:'object',properties:{req:{type:'object',properties:{taskType:{type:'string'},model:{type:'string'},prompt:{type:'string'},inputImages:{type:'array'},inputVideos:{type:'array'}},additionalProperties:false}}}},
      ]};
      if(request.method==='tools/call'){
        assert.equal(request.params.name,'topview_get_generation_config','must not fall through to a gateway that excludes audio');
        result={content:[{type:'text',text:JSON.stringify({code:'200',result:{models:[{displayName:'Seedance 2.5',submitModel:'Seedance 2.5',requiredSubmitFields:['model','prompt'],raw:{parameters:{nativeAudio:false,supportHybridUploadsRef:{audios:true,maxAudios:10}}}}]}})}]};
      }
      return Response.json({jsonrpc:'2.0',id:request.id,result});
    };
    try{
      const request={prompt:'Match the audio.',outputType:'video',model:'Seedance 2.5',boardId:'fixture-board',waitForCompletion:false,
        medias:[{value:'topview-file:image-id',role:'image'},{value:'topview-file:video-id',role:'video'},{value:'topview-file:audio-id',role:'audio'}]};
      if(apiKeyMode){
        const result=await api.generate(request);
        assert.equal(result.taskId,'audio-fixture');
        assert.equal(paidRequests.length,1);
        assert.deepEqual(paidRequests[0].inputImages,[{fileId:'image-id',name:'Image1'}]);
        assert.deepEqual(paidRequests[0].inputVideos,[{fileId:'video-id',name:'Video1'}]);
        assert.deepEqual(paidRequests[0].inputAudios,[{fileId:'audio-id',name:'Audio1'}]);
        assert.equal(paidRequests[0].taskType,undefined);
      }else{
        await assert.rejects(api.generate(request),/MCP-plan connection does not expose/);
        assert.equal(paidRequests.length,0);
      }
    }finally{globalThis.fetch=original;}
  }
});
