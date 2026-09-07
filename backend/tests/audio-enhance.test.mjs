import { build } from '../../node_modules/esbuild/lib/main.js';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
await build({entryPoints:['site/lib/server/elevenlabs-enhance.ts'],outfile:'backend/dist/audio-enhance-test.mjs',bundle:true,platform:'browser',format:'esm'});
const { createAudioEnhancer } = await import('../dist/audio-enhance-test.mjs');
function fixture(run) {
  const sqlite=new DatabaseSync(':memory:');
  const DB={prepare(sql){return{v:[],bind(...v){this.v=v;return this;},async first(){return sqlite.prepare(sql).get(...this.v)||null;},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...this.v).changes)}};}};}};
  const env={DB,AI:{run}};
  return {sqlite,env,enhance:createAudioEnhancer(env,'workspace-one')};
}
const p={requestId:'rewrite-one',kind:'voice',text:'A warm, low voice with a little gravel. Calm and reassuring.'};
test('hosted enhancement returns real model text, persists it and never bills twice for parallel/retried requests',async()=>{
  let calls=0,finish;
  const f=fixture(async(model,input)=>{calls++;assert.equal(model,'@cf/meta/llama-3.1-8b-instruct-fast');assert.equal(input.max_tokens,512);assert.match(input.messages[0].content,/do not add a backstory, dialogue/);assert.deepEqual(JSON.parse(input.messages[1].content),{task:'voice',original:p.text});return new Promise(resolve=>{finish=resolve;});});
  const first=f.enhance(p);
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.enhance(p)).status,'running');
  finish({response:JSON.stringify({enhanced:'A warm, low voice with a lightly gravelled texture and calm, reassuring delivery.'})});
  const done=await first;assert.equal(done.status,'complete');assert.match(done.text,/gravelled/);
  assert.deepEqual(await f.enhance(p),done);assert.equal(calls,1);
  await assert.rejects(f.enhance({...p,text:'different'}),/different wording/);
});
test('invalid model results are terminal, original text is preserved, and failed checks never resubmit',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {response:{enhanced:'x'.repeat(1001)}};});
  const result=await f.enhance(p);assert.equal(result.status,'error');assert.match(result.error,/unchanged/);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT input_json FROM audio_prompt_enhancements').get().input_json).text,p.text);
  await f.enhance(p);assert.equal(calls,1);
});
test('request IDs are isolated per workspace, and invalid requests never run inference',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {response:{enhanced:'A calm voice with a warm low register.'}};});
  await assert.rejects(f.enhance({...p,kind:'speech'}),/Choose/);
  await assert.rejects(f.enhance({...p,text:'x'.repeat(12001)}),/12,000/);assert.equal(calls,0);
  await f.enhance(p);await createAudioEnhancer(f.env,'workspace-two')(p);assert.equal(calls,2);
});
test('an interrupted inference eventually leaves a recoverable error instead of spinning forever',async()=>{
  const f=fixture(async()=>({response:{enhanced:'A calm voice with a warm low register.'}}));await f.enhance(p);
  f.sqlite.prepare("UPDATE audio_prompt_enhancements SET status='running',text=NULL,updated_at=0").run();
  const result=await f.enhance(p);assert.equal(result.status,'error');assert.match(result.error,/too long/);
});
