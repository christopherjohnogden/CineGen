import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { createTranscriptionHandlers } from './transcription.mjs';

const roots = [];

function silentWav() {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => (
    fsp.rm(directory, { recursive: true, force: true })
  )));
});

async function createFixture(overrides = {}) {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-transcription-test-'));
  roots.push(dataRoot);
  const mediaRoot = path.join(dataRoot, 'media');
  const projectId = 'project_1';
  const assetId = 'asset_1';
  const sourcePath = path.join(mediaRoot, 'projects', projectId, 'imported', assetId, 'dialog.wav');
  await fsp.mkdir(path.dirname(sourcePath), { recursive: true });
  await fsp.writeFile(sourcePath, silentWav());
  const state = {
    project: { id: projectId },
    assets: [{ id: assetId, project_id: projectId, metadata: { existing: true } }],
  };
  const updates = [];
  const events = [];
  const context = {
    dataRoot,
    store: {
      async load(id) {
        if (id !== projectId) throw new Error('Project not found');
        return state;
      },
      async updateAsset(updateProjectId, updateAssetId, patch) {
        updates.push({ projectId: updateProjectId, assetId: updateAssetId, patch });
        const asset = state.assets.find((entry) => entry.id === updateAssetId);
        if (asset) Object.assign(asset, patch);
      },
    },
    events: { emit: (event, payload) => events.push({ event, payload }) },
    pathForMediaReference(reference) {
      const pathname = decodeURIComponent(new URL(reference, 'http://cinegen.test').pathname);
      if (!pathname.startsWith('/media/')) throw new Error('Only media paths are accepted');
      return path.join(mediaRoot, pathname.slice('/media/'.length));
    },
    falPollIntervalMs: 0,
    ...overrides,
  };
  return {
    dataRoot,
    mediaRoot,
    projectId,
    assetId,
    sourcePath,
    state,
    updates,
    events,
    context,
    handlers: createTranscriptionHandlers(context),
  };
}

async function waitForJob(handlers, jobId, expected = 'done', timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await handlers.get(jobId);
    if (job?.status === expected) return job;
    if (job?.status === 'error' && expected !== 'error') throw new Error(job.error);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for transcription job ${jobId}.`);
}

test('runs fal cloud transcription, emits compatible progress, and persists a secret-free result', async () => {
  const providerCalls = [];
  const stagedCalls = [];
  const fixture = await createFixture({
    async stageMediaForCloud(filePath, metadata) {
      stagedCalls.push({ filePath, metadata });
      return 'https://fal.media/audio.m4a';
    },
    async falSubscribe(model, input, apiKey) {
      providerCalls.push({ model, input, apiKey });
      return {
        data: {
          text: 'Hello, world.',
          chunks: [
            { text: 'Hello', timestamp: [0, 0.4] },
            { text: ',', timestamp: [0.4, 0.45] },
            { text: 'world.', timestamp: [0.5, 1] },
          ],
          language: 'en',
        },
      };
    },
  });

  const { jobId } = await fixture.handlers.start({
    projectId: fixture.projectId,
    assetId: fixture.assetId,
    filePath: `http://cinegen.test/media/projects/${fixture.projectId}/imported/${fixture.assetId}/dialog.wav`,
    engine: 'whisper-cloud',
    apiKey: 'request-secret',
    language: 'auto',
  });
  assert.match(jobId, /^txn-[0-9a-f-]{36}$/);

  const job = await waitForJob(fixture.handlers, jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.fullText, 'Hello, world.');
  assert.equal(job.language, 'en');
  assert.equal(job.engine, 'whisper-cloud');
  assert.equal(job.segments.length, 1);
  assert.equal(job.segments[0].text, 'Hello, world.');
  assert.equal(job.segments[0].words.length, 3);

  assert.equal(stagedCalls[0].filePath, await fsp.realpath(fixture.sourcePath));
  assert.equal(stagedCalls[0].metadata.apiKey, 'request-secret');
  assert.deepEqual(providerCalls, [{
    model: 'fal-ai/whisper',
    input: {
      audio_url: 'https://fal.media/audio.m4a',
      task: 'transcribe',
      chunk_level: 'word',
      version: '3',
    },
    apiKey: 'request-secret',
  }]);

  const transcriptionEvents = fixture.events.filter(({ event }) => event === 'transcription:progress');
  assert.ok(transcriptionEvents.some(({ payload }) => payload.type === 'status' && payload.stage === 'uploading'));
  assert.ok(transcriptionEvents.some(({ payload }) => payload.type === 'status' && payload.stage === 'transcribing'));
  const done = transcriptionEvents.find(({ payload }) => payload.type === 'done');
  assert.equal(done.payload.assetId, fixture.assetId);
  assert.equal(done.payload.text, 'Hello, world.');
  assert.equal(fixture.updates.length, 1);
  assert.equal(fixture.updates[0].patch.metadata.existing, true);
  assert.equal(fixture.updates[0].patch.metadata.transcription.text, 'Hello, world.');

  const savedPath = path.join(fixture.dataRoot, 'transcription', 'jobs', `${jobId}.json`);
  const savedText = await fsp.readFile(savedPath, 'utf8');
  assert.doesNotMatch(savedText, /request-secret/);
  assert.equal(JSON.parse(savedText).status, 'done');

  const recreated = createTranscriptionHandlers(fixture.context);
  assert.deepEqual(await recreated.get(jobId), job);
});

test('returns a clear capability error for local engines without a configured worker', async () => {
  const fixture = await createFixture();
  await assert.rejects(
    fixture.handlers.start({
      projectId: fixture.projectId,
      assetId: fixture.assetId,
      filePath: `/media/projects/${fixture.projectId}/imported/${fixture.assetId}/dialog.wav`,
      engine: 'whisperx-local',
    }),
    (error) => {
      assert.equal(error.code, 'WEB_CAPABILITY_UNAVAILABLE');
      assert.equal(error.statusCode, 501);
      assert.match(error.message, /CINEGEN_TRANSCRIPTION_WORKER_URL/);
      return true;
    },
  );
});

test('extracts compact audio and stages it through fal storage when no staging hook is supplied', async () => {
  const fetchCalls = [];
  const providerCalls = [];
  const fixture = await createFixture({
    async fetchImpl(url, init) {
      fetchCalls.push({ url: String(url), init });
      if (String(url).includes('/storage/upload/initiate')) {
        return new Response(JSON.stringify({
          upload_url: 'https://uploads.example/presigned',
          file_url: 'https://fal.media/extracted.m4a',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url) === 'https://uploads.example/presigned') return new Response('', { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    },
    async falSubscribe(model, input, apiKey) {
      providerCalls.push({ model, input, apiKey });
      return { text: 'Audio extracted.', language: 'en' };
    },
  });

  const { jobId } = await fixture.handlers.start({
    projectId: fixture.projectId,
    assetId: fixture.assetId,
    filePath: `/media/projects/${fixture.projectId}/imported/${fixture.assetId}/dialog.wav`,
    engine: 'whisper-cloud',
    apiKey: 'fal-secret',
  });
  const job = await waitForJob(fixture.handlers, jobId, 'done', 10_000);
  assert.equal(job.fullText, 'Audio extracted.');
  assert.equal(fetchCalls.length, 2);
  assert.match(fetchCalls[0].url, /storage\/upload\/initiate/);
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Key fal-secret');
  assert.equal(fetchCalls[1].url, 'https://uploads.example/presigned');
  assert.equal(fetchCalls[1].init.headers['Content-Type'], 'audio/mp4');
  assert.ok(Buffer.isBuffer(fetchCalls[1].init.body));
  assert.ok(fetchCalls[1].init.body.length > 0);
  assert.deepEqual(providerCalls[0], {
    model: 'fal-ai/whisper',
    input: {
      audio_url: 'https://fal.media/extracted.m4a',
      task: 'transcribe',
      chunk_level: 'word',
      version: '3',
    },
    apiKey: 'fal-secret',
  });
  await assert.rejects(fsp.stat(path.join(fixture.dataRoot, 'transcription', 'temp', `${jobId}.m4a`)), { code: 'ENOENT' });
});

test('uses a configured worker for local engines without persisting its API key', async () => {
  const calls = [];
  const fixture = await createFixture({
    workerUrl: 'http://127.0.0.1:9090/transcribe',
    workerApiKey: 'worker-secret',
    allowHttpWorker: true,
    async fetchImpl(url, init) {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        output_text: 'Worker transcript',
        segments: [{ text: 'Worker transcript', start: 0, end: 1.25 }],
        language: 'en',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const { jobId } = await fixture.handlers.start({
    projectId: fixture.projectId,
    assetId: fixture.assetId,
    filePath: `/media/projects/${fixture.projectId}/imported/${fixture.assetId}/dialog.wav`,
    engine: 'whisperx-local',
    model: 'base',
  });
  const job = await waitForJob(fixture.handlers, jobId);
  assert.equal(job.fullText, 'Worker transcript');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:9090/transcribe');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer worker-secret');
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal(calls[0].init.body.get('engine'), 'whisperx-local');
  assert.equal(calls[0].init.body.get('language'), 'auto');
  const persisted = await fsp.readFile(path.join(fixture.dataRoot, 'transcription', 'jobs', `${jobId}.json`), 'utf8');
  assert.doesNotMatch(persisted, /worker-secret/);
});

test('rejects assets and media paths that do not belong to the project', async () => {
  const fixture = await createFixture({
    stageMediaForCloud: async () => 'https://fal.media/audio.m4a',
    falSubscribe: async () => ({ text: 'unused' }),
  });
  const foreignPath = path.join(fixture.mediaRoot, 'projects', 'project_2', 'generated', 'foreign.wav');
  await fsp.mkdir(path.dirname(foreignPath), { recursive: true });
  await fsp.writeFile(foreignPath, 'foreign');

  await assert.rejects(
    fixture.handlers.start({
      projectId: fixture.projectId,
      assetId: fixture.assetId,
      filePath: '/media/projects/project_2/generated/foreign.wav',
      engine: 'whisper-cloud',
      apiKey: 'request-secret',
    }),
    (error) => error.code === 'PROJECT_MISMATCH' && error.statusCode === 403,
  );
  await assert.rejects(
    fixture.handlers.start({
      projectId: fixture.projectId,
      assetId: 'missing_asset',
      filePath: `/media/projects/${fixture.projectId}/imported/${fixture.assetId}/dialog.wav`,
      engine: 'whisper-cloud',
      apiKey: 'request-secret',
    }),
    (error) => error.code === 'ASSET_NOT_FOUND' && error.statusCode === 404,
  );
  await assert.rejects(fixture.handlers.get('../escape'), /invalid format/i);
});

test('marks a persisted in-flight job as interrupted after a server restart', async () => {
  const fixture = await createFixture();
  const jobId = 'txn-00000000-0000-4000-8000-000000000001';
  const directory = path.join(fixture.dataRoot, 'transcription', 'jobs');
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, `${jobId}.json`), JSON.stringify({
    jobId,
    assetId: fixture.assetId,
    projectId: fixture.projectId,
    engine: 'whisper-cloud',
    status: 'running',
    segments: [],
    fullText: '',
    language: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const result = await fixture.handlers.get(jobId);
  assert.equal(result.status, 'error');
  assert.match(result.error, /interrupted/);
  const persisted = JSON.parse(await fsp.readFile(path.join(directory, `${jobId}.json`), 'utf8'));
  assert.equal(persisted.status, 'error');
});
