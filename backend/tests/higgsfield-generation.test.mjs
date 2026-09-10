import {build} from '../../node_modules/esbuild/lib/main.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
await build({entryPoints:['site/lib/server/higgsfield-mcp.ts'],outfile:'backend/dist/higgsfield-test.mjs',bundle:true,platform:'browser',format:'esm',alias:{'@':new URL('../../src',import.meta.url).pathname}});
const {createHiggsfieldMcp,toolArguments,parseGeneration}=await import('../dist/higgsfield-test.mjs');
const generateTool={name:'generate_image',inputSchema:{properties:{params:{type:'object',properties:{model:{type:'string'},prompt:{type:'string'},medias:{type:'array',items:{type:'object'}}},additionalProperties:true}}}};
const waitTool={name:'jobs_wait',inputSchema:{properties:{jobs:{type:'array'},timeout_seconds:{type:'number'}}}};

test('nested Higgsfield generation parameters preserve model controls and canonical references',async()=>{
  const args=await toolArguments(generateTool,{model:'gpt_image_2_5',prompt:'Cup',params:{variant:'sunburst',quality:'max',resolution:'4k',background:'transparent',image_references:['https://media.example/ref.png'],__studioHidden:true},medias:[{value:'https://media.example/ref.png',role:'image'}]}, {}, 'test');
  assert.deepEqual(args,{params:{variant:'sunburst',quality:'max',resolution:'4k',background:'transparent',model:'gpt_image_2_5',prompt:'Cup',medias:[{value:'https://media.example/ref.png',role:'image'}]}});
});

test('Higgsfield parses a job receipt separately from its input URLs and matches polling to the exact job',()=>{
  const pending=parseGeneration({structuredContent:{results:[{id:'job-25',status:'queued',type:'image',params:{medias:[{value:'https://media.example/ref.png'}]},results:null}]}});
  assert.equal(pending.status,'running');assert.equal(pending.jobId,'job-25');assert.equal(pending.url,undefined);
  const done=parseGeneration({content:[{type:'text',text:JSON.stringify({jobs:[{job_id:'other',status:'completed',result_url:'https://media.example/wrong.png'},{job_id:'job-25',status:'completed',result_url:'https://media.example/correct.png'}]})}]},'job-25');
  assert.equal(done.url,'https://media.example/correct.png');
  assert.equal(parseGeneration({jobs:[{job_id:'job-25',status:'failed',error:'Provider error'}]},'job-25').status,'fail');
  assert.throws(()=>parseGeneration({isError:true,content:[{type:'text',text:'Invalid quality'}]}),/Invalid quality/);
  assert.throws(()=>parseGeneration({structuredContent:{unlim_choice:{message:'Choose billing'}}}),/No generation was submitted/);
});

test('optional Topaz and lip sync use their exact source roles without a generation prompt', async () => {
  const cases = [
    {model:'topaz_image', params:{output_width:2048,output_height:1024}, medias:[{value:'https://example.com/photo.png',role:'image'}], roles:['image_references']},
    {model:'topaz_video', params:{resolution:'2160p'}, medias:[{value:'https://example.com/clip.mp4',role:'video'}], roles:['video_references']},
    {model:'sync_so', params:{sync_mode:'cut_off'}, medias:[{value:'https://example.com/clip.mp4',role:'video'},{value:'https://example.com/voice.wav',role:'audio'}], roles:['input_video','input_audio']},
  ];
  for(const {roles,...input} of cases){
    const {params}=await toolArguments(generateTool,input,{},'test');
    assert.equal(params.model,input.model);
    assert.deepEqual(params.medias.map(media=>media.role),roles);
    assert.equal(params.prompt,undefined);
    assert.equal(params.enhancement,undefined);
    assert.equal(params.frame_interpolation,undefined);
  }
  await assert.rejects(toolArguments(generateTool,{model:'sync_so',medias:[{value:'https://example.com/clip.mp4',role:'video'}]}, {}, 'test'),/one dialogue audio/);
  await assert.rejects(toolArguments(generateTool,{model:'topaz_image',params:{output_width:0,output_height:1024},medias:cases[0].medias}, {}, 'test'),/whole-pixel/);
});

async function fixtureApi() {
  const secret='fixture-secret';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
  const key=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({access_token:'fixture-token',expires_at:Date.now()+3600000})));
  const row={client_json:'{}',token_ciphertext:JSON.stringify({version:1,iv:Buffer.from(iv).toString('base64'),data:Buffer.from(encrypted).toString('base64')})};
  const DB={prepare(){return {bind(){return this},async first(){return row},async run(){return {}}}}};
  return createHiggsfieldMcp({DB,CINEGEN_HIGGSFIELD_TOKEN_SECRET:secret},'test','http://localhost');
}

test('Higgsfield submits once, returns a durable receipt, and resumes with a read-only job query',async()=>{
  const api=await fixtureApi(),calls=[];const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://mcp.higgsfield.ai/mcp');
    const req=JSON.parse(options.body);let result={};
    if(req.method==='notifications/initialized')return new Response(null,{status:202});
    if(req.method==='tools/list')result={tools:[{name:'estimate_image_cost'},generateTool,waitTool]};
    if(req.method==='tools/call'){
      calls.push(req.params);
      result={structuredContent:req.params.name==='generate_image'?{results:[{id:'job-25',status:'queued',type:'image'}]}:{jobs:[{job_id:'job-25',status:'completed',type:'image',result_url:'https://media.example/out.png'}]}};
    }
    return Response.json({jsonrpc:'2.0',id:req.id,result});
  };
  try {
    const first=await api.generate({model:'gpt_image_2_5',outputType:'image',prompt:'Cup',params:{variant:'sunburst',quality:'max',resolution:'4k'},wait:false});
    assert.equal(first.jobId,'job-25');assert.equal(first.status,'running');
    assert.equal(calls.length,1);assert.equal(calls[0].name,'generate_image');assert.equal(calls[0].arguments.params.variant,'sunburst');
    const resumed=await api.generate({model:'gpt_image_2_5',outputType:'image',jobId:first.jobId,wait:false});
    assert.equal(resumed.url,'https://media.example/out.png');
    assert.equal(calls.filter(c=>c.name==='generate_image').length,1);
    assert.deepEqual(calls[1],{name:'jobs_wait',arguments:{jobs:[{index:0,job_id:'job-25'}],timeout_seconds:15}});
    const interactive=await api.generate({model:'gpt_image_2_5',outputType:'image',prompt:'Second explicit generation',wait:true});
    assert.equal(interactive.url,'https://media.example/out.png');
    assert.equal(calls.filter(c=>c.name==='generate_image').length,2);
  }finally{globalThis.fetch=original;}
});
