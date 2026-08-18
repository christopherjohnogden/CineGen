import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCineGenWebServer } from './index.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readJson(response) {
  const text = await response.text();
  assert.notEqual(text, '', `Expected JSON from ${response.url}`);
  return JSON.parse(text);
}

async function rpc(baseUrl, namespace, method, ...args) {
  const response = await fetch(
    `${baseUrl}/api/rpc/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ args }),
    },
  );
  const envelope = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(envelope));
  assert.equal(envelope.ok, true);
  return envelope.result;
}

test('CineGen web server supports its persistence and media API', async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cinegen-web-server-'));
  const app = await createCineGenWebServer({ dataRoot, host: '127.0.0.1', port: 0 });
  const address = await app.listen(0, '127.0.0.1');
  assert.equal(typeof address, 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
  });

  await t.test('reports readiness', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), {
      ok: true,
      result: { status: 'ready', version: 1 },
    });
  });

  let projectId;
  await t.test('creates, lists, saves, and loads a full project', async () => {
    const created = await rpc(baseUrl, 'db', 'createProject', 'Test Picture');
    projectId = created.project.id;

    assert.match(projectId, UUID);
    assert.equal(created.project.name, 'Test Picture');
    assert.equal(created.project.resolution_width, 1920);
    assert.equal(created.project.resolution_height, 1080);
    assert.equal(created.project.frame_rate, 24);
    assert.match(created.activeTimelineId, UUID);
    assert.equal(created.timelines.length, 1);
    assert.deepEqual(
      created.timelines[0].tracks.map(({ kind }) => kind),
      ['video', 'audio'],
    );
    assert.ok(created.timelines[0].tracks.every((track) => track.timeline_id === created.activeTimelineId));

    const listed = await rpc(baseUrl, 'project', 'list');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, projectId);
    assert.equal(listed[0].name, 'Test Picture');
    assert.equal(listed[0].useSqlite, true);

    const savedState = {
      ...created,
      project: { ...created.project, name: 'Test Picture — Revised' },
      workflow: {
        ...created.workflow,
        nodes: [{ id: 'node-1', type: 'prompt', position: { x: 1, y: 2 }, data: {} }],
      },
    };
    await rpc(baseUrl, 'db', 'saveProject', projectId, savedState);

    const loaded = await rpc(baseUrl, 'db', 'loadProject', projectId);
    assert.equal(loaded.project.id, projectId);
    assert.equal(loaded.project.name, 'Test Picture — Revised');
    assert.deepEqual(loaded.workflow.nodes, savedState.workflow.nodes);
    assert.deepEqual(loaded.timelines, savedState.timelines);

    const legacySaved = await rpc(baseUrl, 'project', 'save', projectId, {
      project: { name: 'Browser Cut' },
    });
    assert.equal(legacySaved.project.name, 'Browser Cut');
    const legacyLoaded = await rpc(baseUrl, 'project', 'load', projectId);
    assert.equal(legacyLoaded.project.id, projectId);
    assert.equal(legacyLoaded.project.name, 'Browser Cut');
  });

  await t.test('returns structured errors for invalid IDs and unknown methods', async () => {
    const invalidIdResponse = await fetch(`${baseUrl}/api/rpc/db/loadProject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: ['../outside-data-root'] }),
    });
    const invalidId = await readJson(invalidIdResponse);
    assert.equal(invalidIdResponse.status, 400);
    assert.equal(invalidId.ok, false);
    assert.equal(invalidId.error.code, 'INVALID_ID');

    const unknownResponse = await fetch(`${baseUrl}/api/rpc/nope/missing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: [] }),
    });
    const unknown = await readJson(unknownResponse);
    assert.equal(unknownResponse.status, 501);
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, 'CAPABILITY_UNAVAILABLE');
  });

  await t.test('uploads multipart media and serves byte ranges', async () => {
    const bytes = Buffer.from('0123456789abcdef', 'utf8');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'range-test.mp4');
    form.append('purpose', 'dialog');

    const uploadResponse = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      body: form,
    });
    const uploadEnvelope = await readJson(uploadResponse);
    assert.equal(uploadResponse.status, 201);
    assert.equal(uploadEnvelope.ok, true);
    assert.equal(uploadEnvelope.result.name, 'range-test.mp4');
    assert.equal(uploadEnvelope.result.type, 'video/mp4');
    assert.match(uploadEnvelope.result.url, /^\/media\/uploads\/[0-9a-f-]+\/range-test\.mp4$/i);

    const mediaResponse = await fetch(new URL(uploadEnvelope.result.url, baseUrl), {
      headers: { Range: 'bytes=3-7' },
    });
    assert.equal(mediaResponse.status, 206);
    assert.equal(mediaResponse.headers.get('accept-ranges'), 'bytes');
    assert.equal(mediaResponse.headers.get('content-range'), `bytes 3-7/${bytes.length}`);
    assert.equal(mediaResponse.headers.get('content-length'), '5');
    assert.equal(mediaResponse.headers.get('content-type'), 'video/mp4');
    assert.equal(Buffer.from(await mediaResponse.arrayBuffer()).toString('utf8'), '34567');
  });
});

test('workflow and direct Higgsfield RPC share the registered CLI service', async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cinegen-web-higgsfield-server-'));
  const calls = [];
  let cancelCalls = 0;
  const higgsfieldService = {
    handlers: {
      async generate(params) {
        calls.push(params);
        return {
          url: 'https://cdn.example.com/shared-runtime.mp4',
          mediaType: params.outputType,
          durationSec: 5,
          model: params.model,
        };
      },
    },
    context: {
      cancelAll() { cancelCalls += 1; },
    },
  };
  const app = await createCineGenWebServer({
    dataRoot,
    host: '127.0.0.1',
    port: 0,
    higgsfieldService,
  });
  const address = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
  });

  const workflowResult = await rpc(baseUrl, 'workflow', 'run', {
    nodeId: 'hf-node',
    nodeType: 'hf-kling-3',
    modelId: 'kling3_0',
    outputType: 'video',
    inputs: {
      prompt: 'Slow dolly in',
      higgsfield_media_inputs: [
        { value: '/media/uploads/start.png', role: 'start_image' },
      ],
    },
  });
  assert.deepEqual(workflowResult, {
    output: { url: 'https://cdn.example.com/shared-runtime.mp4', duration: 5 },
    url: 'https://cdn.example.com/shared-runtime.mp4',
  });
  assert.deepEqual(calls[0], {
    model: 'kling3_0',
    outputType: 'video',
    inputs: {
      prompt: 'Slow dolly in',
      higgsfield_media_inputs: [
        { value: '/media/uploads/start.png', role: 'start_image' },
      ],
    },
  });

  await rpc(baseUrl, 'higgsfield', 'generate', {
    model: 'seedance_2_0',
    outputType: 'video',
    prompt: 'Direct call',
  });
  assert.equal(calls.length, 2);

  await app.close();
  assert.equal(cancelCalls, 1);
});
