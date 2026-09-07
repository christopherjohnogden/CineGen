import { build } from '../../node_modules/esbuild/lib/main.js';
import test from 'node:test';
import assert from 'node:assert/strict';
await build({ entryPoints: ['site/lib/server/elevenlabs.ts'], outfile: 'backend/dist/elevenlabs-test.mjs', bundle: true, platform: 'browser', format: 'esm' });
const { createElevenLabs, audioRequest, elevenLabsPayload } = await import('../dist/elevenlabs-test.mjs');
function fixture() {
  const jobs = new Map(), media = new Map(), locks = new Map(); let connection;
  const db = { prepare(sql) { return { values: [], bind(...values) { this.values = values; return this; }, async first() { if (sql.includes('elevenlabs_oauth_')) return null; return sql.includes('elevenlabs_audio_jobs') ? jobs.get(this.values[1]) || null : connection || null; }, async all() { return { results: connection ? [{ ...connection, provider: 'workspace-secret:elevenlabs' }] : [] }; }, async run() {
    const v = this.values;
    if (sql.startsWith('INSERT INTO elevenlabs_audio_save_locks')) { if (locks.has(v[1]) && locks.get(v[1]) >= v[3]) return { meta: { changes: 0 } }; locks.set(v[1],v[2]); }
    if (sql.startsWith('DELETE FROM elevenlabs_audio_save_locks') && locks.get(v[1]) === v[2]) locks.delete(v[1]);
    if (sql.includes('INSERT INTO provider_connections')) connection = { token_ciphertext: v[2], updated_at: v[3] };
    if (sql.includes('DELETE FROM provider_connections')) connection = null;
    if (sql.includes('INSERT OR IGNORE INTO elevenlabs_audio_jobs')) { if (jobs.has(v[1])) return { meta: { changes: 0 } }; jobs.set(v[1], { request_id: v[1], input_json: v[2], status: v[3], updated_at: v[4], url: null, error: null }); }
    if (sql.includes('UPDATE elevenlabs_audio_jobs')) Object.assign(jobs.get(v[5]), { status: v[0], url: v[1], error: v[2], updated_at: v[3] });
    return { meta: { changes: 1 } };
  } }; } };
  const bucket = { async put(key, body) { media.set(key, new Uint8Array(await new Response(body).arrayBuffer())); }, async head(key) { return media.has(key) ? { size: media.get(key).length } : null; }, async get(key) { if (!media.has(key)) return null; const bytes = media.get(key), response = new Response(bytes); return { body: response.body, size: bytes.length, get bodyUsed() { return response.bodyUsed; } }; } };
  return { service: createElevenLabs({ DB: db, MEDIA: bucket }, 'cinegen-local-v1', { uid: 'user', token: 'firebase-fixture' }), jobs, media, get connection() { return connection; } };
}
const req = { requestId: 'take-1', kind: 'speech', voiceId: 'voice-1', text: 'We have a plan.', direction: 'quietly, tense', projectId: 'project-1' };

test('speech uses voice IDs and performance tags, with no prose appended as dialogue', () => {
  assert.deepEqual(elevenLabsPayload(audioRequest(req)), { text: '[quietly, tense] We have a plan.', model_id: 'eleven_v3' });
  assert.throws(() => audioRequest({ ...req, text: 'x'.repeat(5000) }), /5,000/);
  assert.throws(() => audioRequest({ ...req, voiceId: '' }), /voice/);
  assert.throws(() => audioRequest({ ...req, kind: 'sound', durationSeconds: 31 }), /0.5–30/);
});

test('direct account generation saves audio; duplicate calls and saving retries never submit another paid take', async () => {
  const f = fixture(), previous = globalThis.fetch; let generations = 0, storageFails = true; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push(u);
    if (u.startsWith('https://api.elevenlabs.io/v2/voices')) return Response.json({ voices: [{ voice_id: 'voice-1', name: 'Cody' }] });
    if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
      generations++; assert.equal(init.headers['xi-api-key'], 'private-elevenlabs-fixture'); assert.equal(init.headers.authorization, undefined);
      assert.deepEqual(JSON.parse(init.body), elevenLabsPayload(req));
      return new Response(new Uint8Array([73, 68, 51, 1, 2]), { headers: { 'content-type': 'audio/mpeg' } });
    }
    assert.match(u, /^https:\/\/firebasestorage.googleapis.com\//);
    assert.equal(init.headers.authorization, 'Firebase firebase-fixture'); assert.equal(init.headers['xi-api-key'], undefined);
    if (!init.method) return new Response('', { status: 404 });
    await new Response(init.body).arrayBuffer();
    return storageFails ? new Response('', { status: 503 }) : Response.json({ downloadTokens: 'durable-download' });
  };
  try {
    await f.service.connect({ secret: 'private-elevenlabs-fixture' });
    assert(!JSON.stringify(f.connection).includes('private-elevenlabs-fixture'), 'credential is encrypted');
    assert.equal((await f.service.accountStatus()).connected, true);
    const first = await f.service.generate(req);
    assert.equal(first.status, 'saving'); assert.match(first.error, /503/); assert.equal(f.jobs.get('take-1').status, 'saving');
    storageFails = false;
    const saved = await f.service.job({ requestId: 'take-1' });
    assert.equal(saved.status, 'complete'); assert.match(saved.url, /durable-download/); assert.equal(f.jobs.get('take-1').status, 'complete');
    assert.deepEqual(await f.service.generate(req), saved); assert.equal(generations, 1);
    await assert.rejects(f.service.generate({ ...req, text: 'Changed' }), /another take/); assert.equal(generations, 1);
    assert(calls.every(u => !u.includes('fal') && !u.includes('topview')));
  } finally { globalThis.fetch = previous; }
});

test('provider errors become terminal and repeated checks never resubmit', async () => {
  const f = fixture(), previous = globalThis.fetch; let generations = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('/v2/voices')) return Response.json({ voices: [] });
    generations++; return Response.json({ detail: { message: 'Insufficient credits' } }, { status: 402 });
  };
  try {
    await f.service.connect({ secret: 'fixture' });
    const result = await f.service.generate(req);
    assert.equal(result.status, 'error'); assert.equal(f.jobs.get('take-1').error, 'Insufficient credits');
    await f.service.generate(req); await f.service.job({ requestId: 'take-1' }); assert.equal(generations, 1);
  } finally { globalThis.fetch = previous; }
});

test('sound effects use the direct sound endpoint; simultaneous requests share the paid submission', async () => {
  const f = fixture(), previous = globalThis.fetch; let generations = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/v2/voices')) return Response.json({ voices: [] });
    if (String(url).startsWith('https://api.elevenlabs.io/')) {
      assert.match(String(url), /\/v1\/sound-generation/); generations++;
      assert.deepEqual(JSON.parse(init.body), { text: 'Rain on a roof\nGentle', model_id: 'eleven_text_to_sound_v2', duration_seconds: 5 });
      return new Response(new Uint8Array([73, 68, 51]), { headers: { 'content-type': 'audio/mpeg' } });
    }
    if (!init.method) return new Response('', { status: 404 });
    await new Response(init.body).arrayBuffer(); return Response.json({ downloadTokens: 'durable-download' });
  };
  try {
    await f.service.connect({ secret: 'fixture' });
    const request = { requestId: 'rain', kind: 'sound', text: 'Rain on a roof', direction: 'Gentle', durationSeconds: 5 };
    const results = await Promise.all([f.service.generate(request), f.service.generate(request)]);
    assert(results.some(r => r.status === 'complete')); assert.equal(generations, 1);
  } finally { globalThis.fetch = previous; }
});

test('voice design returns durable playable previews and saving a selected preview returns its voice ID', async () => {
  const f = fixture(), previous = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/v2/voices')) return Response.json({ voices: [] });
    if (u.startsWith('https://api.elevenlabs.io/')) {
      const body = JSON.parse(init.body); requests.push({ u, body });
      if (u.endsWith('/design')) return Response.json({ previews: [{ generated_voice_id: 'preview-1', audio_base_64: btoa('ID3-audio') }], text: 'Automatically written voice preview.' });
      return Response.json({ voice_id: 'saved-cody', name: 'Cody' });
    }
    if (!init.method) return new Response('', { status: 404 });
    await new Response(init.body).arrayBuffer(); return Response.json({ downloadTokens: 'preview-download' });
  };
  try {
    await f.service.connect({ secret: 'fixture' });
    const description = 'A warm, low voice with a gentle Southern accent.';
    const previews = await f.service.design({ description });
    assert.equal(previews.previews[0].id, 'preview-1'); assert.match(previews.previews[0].url, /preview-download/);
    assert.deepEqual(requests[0].body, { voice_description: description, model_id: 'eleven_ttv_v3', auto_generate_text: true });
    const saved = await f.service.saveVoice({ id: 'preview-1', name: 'Cody', description });
    assert.deepEqual(saved, { id: 'saved-cody', name: 'Cody' });
    assert.equal(requests[1].body.generated_voice_id, 'preview-1');
    await assert.rejects(f.service.design({ description, text: 'Too short.' }), /100–1,000/);
    assert.equal(requests.length, 2, 'invalid previews do not make paid API calls');
  } finally { globalThis.fetch = previous; }
});

test('a recovery poll cannot upload over an in-flight save of the same audio', async () => {
  const f = fixture(), previous = globalThis.fetch; let uploads = 0, resumeUpload, enteredUpload;
  const started = new Promise(r => { enteredUpload = r; });
  const hold = new Promise(r => { resumeUpload = r; });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/v2/voices')) return Response.json({ voices: [] });
    if (u.startsWith('https://api.elevenlabs.io/')) return new Response(new Uint8Array([73, 68, 51]), { headers: { 'content-type': 'audio/mpeg' } });
    if (!init.method) return new Response('', { status: 404 });
    uploads++; await new Response(init.body).arrayBuffer(); enteredUpload(); await hold;
    return Response.json({ downloadTokens: 'one-token' });
  };
  try {
    await f.service.connect({ secret: 'fixture' });
    const generation = f.service.generate(req); await started;
    const whileSaving = await f.service.job({ requestId: req.requestId });
    assert.equal(whileSaving.status, 'saving'); assert.equal(uploads, 1);
    resumeUpload(); const completed = await generation;
    assert.equal(completed.status, 'complete'); assert.deepEqual(await f.service.job({ requestId: req.requestId }), completed); assert.equal(uploads, 1);
  } finally { resumeUpload(); globalThis.fetch = previous; }
});
