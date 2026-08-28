import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRunpodLtx25Handlers } from './runpod-ltx25.mjs';
import { createWorkflowServices } from './workflow.mjs';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const MP4_BYTES = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');
const JPEG_BYTES = Buffer.from('ffd8ffe000104a4649460001', 'hex');
const WEBP_BYTES = Buffer.from('524946460400000057454250', 'hex');

test('local web exposes setup, readiness, and termination through the shared RunPod service', async () => {
  const calls = [];
  const fetchImpl = async () => { throw new Error('provider fetch should be owned by the service stub'); };
  const service = {
    setup: async (params, suppliedFetch) => {
      calls.push(['setup', params, suppliedFetch]);
      return { podId: 'pod-1', status: 'downloading' };
    },
    status: async (params, suppliedFetch) => {
      calls.push(['status', params, suppliedFetch]);
      return { podId: 'pod-1', status: 'ready' };
    },
    terminate: async (params, suppliedFetch) => {
      calls.push(['terminate', params, suppliedFetch]);
      return { ok: true };
    },
    generate: async () => ({ jobId: 'unused', status: 'queued' }),
  };
  const { podHandlers } = createWorkflowServices({
    fetchImpl,
    runpodLtx25Service: service,
  });

  assert.deepEqual(await podHandlers.setupLtx25({
    runpodKey: 'rp-key',
    huggingFaceToken: 'hf-token',
    gpuProfile: 'performance',
    imageModels: ['sdxl', 'qwen-image-edit'],
  }), {
    podId: 'pod-1', status: 'downloading',
  });
  assert.deepEqual(await podHandlers.statusLtx25({ runpodKey: 'rp-key', podId: 'pod-1', secretIds: ['secret-1', 'secret-2'] }), {
    podId: 'pod-1', status: 'ready',
  });
  assert.deepEqual(await podHandlers.terminateLtx25({ runpodKey: 'rp-key', podId: 'pod-1' }), { ok: true });
  assert.deepEqual(calls.map(([operation]) => operation), ['setup', 'status', 'terminate']);
  assert.equal(calls[0][1].gpuProfile, 'performance');
  assert.deepEqual(calls[0][1].imageModels, ['sdxl', 'qwen-image-edit']);
  assert.deepEqual(calls[1][1].secretIds, ['secret-1', 'secret-2']);
  assert.ok(calls.every(([, , suppliedFetch]) => suppliedFetch === fetchImpl));
});

test('local reference images become data URIs and completed base64 videos become served media', async (context) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-runpod-ltx-test-'));
  context.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const uploadDirectory = path.join(dataRoot, 'media', 'uploads', 'upload-1');
  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadDirectory, 'first-frame.png'), PNG_BYTES);

  const generatedCalls = [];
  const service = {
    generate: async (params) => {
      generatedCalls.push(params);
      if (!params.jobId) return { jobId: 'job-1', status: 'queued', phase: 'rendering' };
      return {
        jobId: 'job-1',
        status: 'completed',
        phase: 'ready',
        output: {
          data: MP4_BYTES.toString('base64'),
          mediaType: 'video/mp4',
          durationSec: 6,
          model: 'LTX-2.5',
        },
      };
    },
  };
  const handlers = createRunpodLtx25Handlers({
    dataRoot,
    fetchImpl: async () => { throw new Error('remote fetch should not run'); },
    service,
  });
  const session = {
    podId: 'pod-1',
    podUrl: 'https://pod-1-8000.proxy.runpod.net',
    podAuthToken: 'session-token',
  };

  const submitted = await handlers.generateLtx25({
    ...session,
    input: {
      prompt: 'A cinematic opening frame',
      durationSec: 6,
      referenceImages: ['http://localhost:5174/media/uploads/upload-1/first-frame.png'],
    },
  });
  assert.equal(submitted.status, 'queued');
  assert.match(generatedCalls[0].input.referenceImages[0], /^data:image\/png;base64,/);

  const completed = await handlers.generateLtx25({ ...session, jobId: 'job-1' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.output.durationSec, 6);
  assert.equal(completed.output.model, 'LTX-2.5');
  assert.match(completed.output.url, /^\/media\/generated\/ltx25\/[a-f0-9-]+\.mp4$/);
  assert.equal('data' in completed.output, false);

  const relative = decodeURIComponent(completed.output.url.slice('/media/'.length));
  const saved = await fs.readFile(path.join(dataRoot, 'media', relative));
  assert.deepEqual(saved, MP4_BYTES);
});

test('local generation rejects media path traversal before calling the Pod', async (context) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-runpod-ltx-test-'));
  context.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataRoot, 'media'), { recursive: true });
  let called = false;
  const handlers = createRunpodLtx25Handlers({
    dataRoot,
    fetchImpl: async () => { throw new Error('fetch should not run'); },
    service: {
      generate: async () => { called = true; },
    },
  });

  await assert.rejects(
    handlers.generateLtx25({
      podId: 'pod-1',
      podUrl: 'https://pod-1-8000.proxy.runpod.net',
      podAuthToken: 'session-token',
      input: {
        prompt: 'A shot',
        referenceImages: ['local-media://file/media/../outside.png'],
      },
    }),
    (error) => error.code === 'INVALID_URL',
  );
  assert.equal(called, false);
});

test('local web submits up to three checked image references and persists completed session images', async (context) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-runpod-image-test-'));
  context.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const uploadDirectory = path.join(dataRoot, 'media', 'uploads', 'upload-2');
  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadDirectory, 'source.png'), PNG_BYTES);

  const calls = [];
  const handlers = createRunpodLtx25Handlers({
    dataRoot,
    fetchImpl: async (input) => {
      assert.equal(String(input), 'https://cdn.example/look.jpg');
      return new Response(JPEG_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    },
    service: {
      generateSessionImage: async (params) => {
        calls.push(params);
        if (!params.jobId) return { jobId: 'image-job-1', status: 'queued', phase: 'rendering' };
        return {
          jobId: 'image-job-1',
          status: 'completed',
          phase: 'ready',
          output: {
            data: PNG_BYTES.toString('base64'),
            mediaType: 'image/png',
            model: 'Qwen Image Edit 2511',
          },
        };
      },
    },
  });
  const session = {
    podId: 'pod-1',
    podUrl: 'https://pod-1-8000.proxy.runpod.net',
    podAuthToken: 'private-session-token',
  };

  const submitted = await handlers.generateSessionImage({
    ...session,
    model: 'qwen-image-edit',
    input: {
      model: 'qwen-image-edit',
      prompt: 'Preserve the subject and change the lighting.',
      referenceImages: [
        'http://localhost:5174/media/uploads/upload-2/source.png',
        'https://cdn.example/look.jpg',
        `data:image/jpeg;base64,${WEBP_BYTES.toString('base64')}`,
      ],
    },
  });
  assert.equal(submitted.status, 'queued');
  assert.match(calls[0].input.referenceImages[0], /^data:image\/png;base64,/);
  assert.match(calls[0].input.referenceImages[1], /^data:image\/jpeg;base64,/);
  assert.match(calls[0].input.referenceImages[2], /^data:image\/webp;base64,/);

  const completed = await handlers.generateSessionImage({
    ...session,
    model: 'qwen-image-edit',
    jobId: 'image-job-1',
  });
  assert.equal(calls[1].model, 'qwen-image-edit');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.output.model, 'Qwen Image Edit 2511');
  assert.equal(completed.output.mediaType, 'image/png');
  assert.match(completed.output.url, /^\/media\/generated\/runpod-images\/[a-f0-9-]+\.png$/);
  assert.equal('data' in completed.output, false);
  assert.equal(JSON.stringify(completed).includes(session.podAuthToken), false);

  const relative = decodeURIComponent(completed.output.url.slice('/media/'.length));
  assert.deepEqual(await fs.readFile(path.join(dataRoot, 'media', relative)), PNG_BYTES);
});

test('local session image transport rejects spoofed and excess references before calling the Pod', async () => {
  let called = false;
  const handlers = createRunpodLtx25Handlers({
    fetchImpl: async () => { throw new Error('fetch should not run'); },
    service: {
      generateSessionImage: async () => { called = true; },
    },
  });
  const session = {
    podId: 'pod-1',
    podUrl: 'https://pod-1-8000.proxy.runpod.net',
    podAuthToken: 'private-session-token',
  };

  await assert.rejects(
    handlers.generateSessionImage({
      ...session,
      input: {
        model: 'qwen-image-edit',
        prompt: 'Edit this.',
        referenceImages: ['data:image/png;base64,dGhpcyBpcyBub3QgYW4gaW1hZ2U='],
      },
    }),
    (error) => error.code === 'INVALID_MEDIA',
  );
  await assert.rejects(
    handlers.generateSessionImage({
      ...session,
      input: {
        model: 'qwen-image-edit',
        prompt: 'Edit this.',
        referenceImages: ['one', 'two', 'three', 'four'],
      },
    }),
    (error) => error.code === 'INVALID_MEDIA',
  );
  assert.equal(called, false);
});
