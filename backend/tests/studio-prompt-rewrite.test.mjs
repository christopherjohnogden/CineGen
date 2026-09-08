import { build } from '../../node_modules/esbuild/lib/main.js';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
await build({ entryPoints: ['site/lib/server/studio-prompt-rewrite.ts'], outfile: 'backend/dist/studio-prompt-rewrite-test.mjs', bundle: true, platform: 'browser', format: 'esm' });
const { createStudioPromptRewriter } = await import('../dist/studio-prompt-rewrite-test.mjs');
function fixture(run) {
  const sqlite = new DatabaseSync(':memory:');
  const DB = { prepare(sql) { return { values: [], bind(...v) { this.values = v; return this; }, async first() { return sqlite.prepare(sql).get(...this.values) || null; }, async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...this.values).changes) } }; } }; } };
  const env = { DB, AI: { run } };
  return { sqlite, env, rewrite: createStudioPromptRewriter(env, 'workspace-one') };
}
const p = { requestId: 'studio-rewrite-one', kind: 'video', text: 'SHOT 1 [0–5s] @Cody on a golf course. SHOT 2 [5–10s] Close-up. No dialogue.', feedback: 'Make the lighting softer.' };
test('rewrites with complete original and feedback, and recovers parallel requests without repeated inference', async () => {
  let calls = 0, finish;
  const f = fixture(async (model, input) => {
    calls++; assert.equal(model, '@cf/meta/llama-3.1-8b-instruct-fast');
    assert.match(input.messages[0].content, /smallest relevant text replacements/);
    assert.match(input.messages[0].content, /exact @Element mentions/);
    assert.deepEqual(JSON.parse(input.messages[1].content), { medium: 'video', original: p.text, requestedChanges: p.feedback });
    return new Promise(resolve => { finish = resolve; });
  });
  const first = f.rewrite(p);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.rewrite(p)).status, 'running');
  finish({ response: { edits: [{ find: 'on a golf course.', replace: 'on a golf course in soft morning light.' }] } });
  const done = await first;
  assert.equal(done.text, p.text.replace('on a golf course.', 'on a golf course in soft morning light.'));
  assert.ok(done.text.endsWith('No dialogue.'));
  assert.deepEqual(await f.rewrite(p), done); assert.equal(calls, 1);
  await assert.rejects(f.rewrite({ ...p, feedback: 'A different edit' }), /different prompt/);
});
test('long multi-shot prompts reach inference uncut, with an adequate response budget', async () => {
  const text = Array.from({length: 100}, (_, i) => p.text + ' Unique detail ' + i + '.').join('\n');
  const f = fixture(async (_model, input) => {
    assert.equal(JSON.parse(input.messages[1].content).original, text);
    assert.ok(input.max_tokens > 4000);
    return { response: JSON.stringify({ edits: [{find: 'Unique detail 99.', replace: 'Unique detail 99. Softer light.'}] }) };
  });
  assert.equal((await f.rewrite({ ...p, text })).text, text + ' Softer light.');
});
test('rejects invalid and incomplete results without changing or silently truncating original input', async () => {
  for (const response of [{ response: 'broken JSON' }, { response: { edits: [{find:'missing text', replace:'invented'}] } }, { response: { edits: [] }, finish_reason: 'length' }, { response: { edits: [] }, choices: [{finish_reason: 'length'}] }]) {
    let calls = 0;
    const f = fixture(async () => { calls++; return response; });
    assert.equal((await f.rewrite(p)).status, 'error');
    assert.equal((await f.rewrite(p)).status, 'error'); assert.equal(calls, 1);
    assert.equal(JSON.parse(f.sqlite.prepare('SELECT input_json FROM studio_prompt_rewrites').get().input_json).text, p.text);
  }
});
test('validates input, isolates workspaces, and recovers stalled jobs', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { response: { edits: [{find:p.text, replace:'A new image prompt.'}] } }; });
  await assert.rejects(f.rewrite({ ...p, kind: 'audio' }), /image or video/);
  await assert.rejects(f.rewrite({ ...p, text: 'x'.repeat(64001) }), /not been shortened/);
  await assert.rejects(f.rewrite({ ...p, feedback: '' }), /Describe/);
  assert.equal(calls, 0);
  await f.rewrite(p); await createStudioPromptRewriter(f.env, 'workspace-two')(p);
  assert.equal(calls, 2);
  f.sqlite.prepare("UPDATE studio_prompt_rewrites SET status='running', text=NULL, updated_at=0 WHERE workspace_id='workspace-one'").run();
  assert.equal((await f.rewrite(p)).status, 'error'); assert.equal(calls, 2);
});
test('authenticated browser requests reach the rewrite endpoint and unauthenticated requests cannot run AI', async () => {
  await build({entryPoints:['backend/src/index.ts'],outfile:'backend/dist/studio-rewrite-route-test.mjs',bundle:true,platform:'browser',format:'esm',external:['node:*'],alias:{'@':new URL('../../src',import.meta.url).pathname}});
  const {default:worker} = await import('../dist/studio-rewrite-route-test.mjs');
  let calls = 0;
  const f = fixture(async () => { calls++; return {response:{edits:[{find:'on a golf course.',replace:'on a golf course in soft morning light.'}]}}; });
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({users:[{localId:'owner',email:'christopherjohnogden@gmail.com'}]});
  const url = 'https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/prompts/rewrite';
  try {
    const denied = await worker.fetch(new Request(url,{method:'POST',body:JSON.stringify({args:[p]})}),f.env);
    assert.equal(denied.status,401); assert.equal(calls,0);
    const response = await worker.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json','x-cinegen-id-token':'test-token','x-cinegen-origin':'https://cinegen-film.vercel.app','origin':'https://cinegen-film.vercel.app'},body:JSON.stringify({args:[p]})}),f.env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('access-control-allow-origin'),'https://cinegen-film.vercel.app');
    const body=await response.json(); assert.equal(body.ok,true); assert.equal(body.result.status,'complete');
    assert.match(body.result.text,/soft morning light/); assert.ok(body.result.text.endsWith('No dialogue.'));
    assert.equal(calls,1);
  } finally { globalThis.fetch=old; }
});
