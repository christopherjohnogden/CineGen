import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkflowServices } from './workflow.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function scriptedFetch(responses, calls = []) {
  let index = 0;
  return {
    calls,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const response = responses[index++];
      if (response === undefined) throw new Error(`Unexpected fetch call ${index}: ${url}`);
      return typeof response === 'function'
        ? response(String(url), init)
        : jsonResponse(response);
    },
  };
}

function workflowParams(overrides = {}) {
  return {
    nodeId: 'node-1',
    nodeType: 'flux-dev',
    modelId: 'fal-ai/flux/dev',
    inputs: { prompt: 'A wide cinematic landscape' },
    ...overrides,
  };
}

test('fal workflows use the queue API and return renderer-compatible data', async () => {
  const fake = scriptedFetch([
    { request_id: 'req_123' },
    { status: 'COMPLETED' },
    { images: [{ url: 'https://cdn.example/image.png' }] },
  ]);
  const { workflowHandlers } = createWorkflowServices({
    fetchImpl: fake.fetch,
    falPollIntervalMs: 0,
    falMaxPollAttempts: 2,
  });

  const result = await workflowHandlers.run(workflowParams({ apiKey: 'fal-secret' }));

  assert.deepEqual(result, { images: [{ url: 'https://cdn.example/image.png' }] });
  assert.equal(fake.calls[0].url, 'https://queue.fal.run/fal-ai/flux/dev');
  assert.equal(fake.calls[0].init.headers.Authorization, 'Key fal-secret');
  assert.deepEqual(JSON.parse(fake.calls[0].init.body), {
    prompt: 'A wide cinematic landscape',
  });
  assert.equal(fake.calls[1].url, 'https://queue.fal.run/fal-ai/flux/requests/req_123/status?logs=0');
  assert.equal(fake.calls[2].url, 'https://queue.fal.run/fal-ai/flux/requests/req_123');
});

test('web media references are safely staged through request-scoped fal storage', async (context) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-workflow-test-'));
  context.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const uploadDirectory = path.join(dataRoot, 'media', 'uploads', 'upload-1');
  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadDirectory, 'reference.png'), Buffer.from('small image'));

  const fake = scriptedFetch([
    {
      upload_url: 'https://uploads.example.com/presigned',
      file_url: 'https://fal.media/reference.png',
    },
    () => new Response('', { status: 200 }),
    { request_id: 'req_staged' },
    { status: 'COMPLETED' },
    { images: [{ url: 'https://cdn.example/result.png' }] },
  ]);
  const { workflowHandlers } = createWorkflowServices({
    dataRoot,
    fetchImpl: fake.fetch,
    falPollIntervalMs: 0,
    falMaxPollAttempts: 2,
  });

  await workflowHandlers.run(workflowParams({
    apiKey: 'request-only-key',
    inputs: {
      prompt: 'Use this reference',
      image_url: 'local-media://file/media/uploads/upload-1/reference.png',
    },
  }));

  assert.equal(fake.calls[0].url, 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3');
  assert.equal(fake.calls[0].init.headers.Authorization, 'Key request-only-key');
  assert.equal(fake.calls[1].url, 'https://uploads.example.com/presigned');
  assert.deepEqual(JSON.parse(fake.calls[2].init.body), {
    prompt: 'Use this reference',
    image_url: 'https://fal.media/reference.png',
  });
});

test('kie workflows preserve dedicated endpoint and polling behavior', async () => {
  const fake = scriptedFetch([
    { code: 200, data: { taskId: 'kie-task-1' } },
    {
      data: {
        state: 'success',
        resultJson: JSON.stringify({ video_url: 'https://cdn.example/video.mp4' }),
        failMsg: '',
      },
    },
  ]);
  const { workflowHandlers } = createWorkflowServices({
    fetchImpl: fake.fetch,
    sleep: async () => {},
    kiePollIntervalMs: 0,
    kieMaxPollAttempts: 2,
  });

  const result = await workflowHandlers.run(workflowParams({
    nodeType: 'kie-runway',
    modelId: 'runway',
    kieKey: 'kie-secret',
    inputs: { prompt: 'Camera sweeps across the city' },
  }));

  assert.deepEqual(result, { video_url: 'https://cdn.example/video.mp4' });
  assert.equal(fake.calls[0].url, 'https://api.kie.ai/api/v1/runway/generate');
  assert.equal(fake.calls[0].init.headers.Authorization, 'Bearer kie-secret');
  assert.deepEqual(JSON.parse(fake.calls[0].init.body), {
    prompt: 'Camera sweeps across the city',
    callBackUrl: '',
  });
  assert.match(fake.calls[1].url, /recordInfo\?taskId=kie-task-1$/);
});

test('RunPod workflows preserve output shape and make base64 images browser-safe', async () => {
  const image = 'a'.repeat(64);
  const fake = scriptedFetch([
    { id: 'runpod-job-1' },
    { status: 'COMPLETED', output: { image_url: image } },
  ]);
  const { workflowHandlers } = createWorkflowServices({
    fetchImpl: fake.fetch,
    sleep: async () => {},
    runpodPollIntervalMs: 0,
    runpodMaxPollAttempts: 2,
  });

  const result = await workflowHandlers.run(workflowParams({
    nodeType: 'runpod-sdxl',
    modelId: 'runpod-sdxl',
    runpodKey: 'runpod-secret',
    inputs: { prompt: 'Portrait lighting' },
  }));

  assert.deepEqual(result, {
    output: { image_url: `data:image/png;base64,${image}` },
  });
  assert.match(fake.calls[0].url, /\/2urujiktqqceer\/run$/);
  assert.equal(fake.calls[0].init.headers.Authorization, 'Bearer runpod-secret');
});

test('CineGen Pod workflows validate the base URL and use canonical routes', async () => {
  const fake = scriptedFetch([{ output: { image_url: 'https://cdn.example/pod.png' } }]);
  const { workflowHandlers } = createWorkflowServices({ fetchImpl: fake.fetch });

  const result = await workflowHandlers.run(workflowParams({
    nodeType: 'pod-flux',
    modelId: 'pod-flux',
    podUrl: 'https://pod.example.com/base/',
    inputs: { prompt: 'Graphic poster' },
  }));

  assert.deepEqual(result, { output: { image_url: 'https://cdn.example/pod.png' } });
  assert.equal(fake.calls[0].url, 'https://pod.example.com/base/generate/flux');
  assert.deepEqual(JSON.parse(fake.calls[0].init.body), {
    input: { prompt: 'Graphic poster' },
  });
});

test('Higgsfield workflows delegate to the secured CLI service and preserve renderer output shape', async () => {
  const calls = [];
  const { workflowHandlers } = createWorkflowServices({
    fetchImpl: async () => { throw new Error('fetch should not run'); },
    async higgsfieldGenerate(params) {
      calls.push(params);
      return {
        url: 'https://cdn.example.com/higgsfield.mp4',
        mediaType: 'video',
        durationSec: 7,
        jobId: 'hf_job_1',
        model: params.model,
      };
    },
  });

  const result = await workflowHandlers.run(workflowParams({
    nodeType: 'hf-kling-3',
    modelId: 'kling3_0',
    inputs: {
      prompt: 'Camera pushes through the doorway',
      start_image_url: '/media/uploads/start.png',
      sound: false,
      duration: 0,
    },
  }));

  assert.deepEqual(calls, [{
    model: 'kling3_0',
    outputType: 'video',
    inputs: {
      prompt: 'Camera pushes through the doorway',
      start_image_url: '/media/uploads/start.png',
      sound: false,
      duration: 0,
    },
  }]);
  assert.deepEqual(result, {
    output: { url: 'https://cdn.example.com/higgsfield.mp4', duration: 7 },
    url: 'https://cdn.example.com/higgsfield.mp4',
    jobId: 'hf_job_1',
  });
});

test('generic Higgsfield workflows accept explicit audio, text, and 3d output kinds', async () => {
  const calls = [];
  const { workflowHandlers } = createWorkflowServices({
    fetchImpl: async () => { throw new Error('fetch should not run'); },
    async higgsfieldGenerate(params) {
      calls.push(params);
      if (params.outputType === 'text') {
        return {
          text: 'Retention score: 88',
          url: 'https://cdn.example.com/report.html',
          mediaType: 'text',
          model: params.model,
        };
      }
      return {
        url: `https://cdn.example.com/result.${params.outputType === '3d' ? 'glb' : 'wav'}`,
        mediaType: params.outputType,
        model: params.model,
      };
    },
  });

  const audio = await workflowHandlers.run(workflowParams({
    nodeType: 'hf-seed-audio',
    modelId: 'seed_audio',
    outputType: 'audio',
    inputs: { prompt: 'Rain ambience', loudness_rate: 0, normalize: false },
  }));
  const textResult = await workflowHandlers.run(workflowParams({
    nodeType: 'hf-brain-activity',
    modelId: 'brain_activity',
    outputType: 'text',
    inputs: { input_video: '/media/uploads/ad.mp4' },
  }));
  const model3d = await workflowHandlers.run(workflowParams({
    nodeType: 'hf-tripo-3d',
    modelId: 'tripo_3d',
    outputType: '3d',
    inputs: { prompt: 'A ceramic vase', pbr: false },
  }));

  assert.deepEqual(calls.map((call) => call.outputType), ['audio', 'text', '3d']);
  assert.deepEqual(audio, {
    output: { url: 'https://cdn.example.com/result.wav' },
    url: 'https://cdn.example.com/result.wav',
  });
  assert.deepEqual(textResult, {
    output: { text: 'Retention score: 88' },
    text: 'Retention score: 88',
  });
  assert.deepEqual(model3d, {
    output: { url: 'https://cdn.example.com/result.glb' },
    url: 'https://cdn.example.com/result.glb',
  });
});

test('workflow validation blocks unsafe models, URLs, local paths, and desktop-only providers', async () => {
  const { workflowHandlers } = createWorkflowServices({
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  });

  await assert.rejects(
    workflowHandlers.run(workflowParams({
      apiKey: 'fal-secret',
      modelId: 'fal-ai/flux/dev?redirect=https://evil.example',
    })),
    (error) => error.code === 'INVALID_MODEL',
  );
  await assert.rejects(
    workflowHandlers.run(workflowParams({
      apiKey: 'fal-secret',
      inputs: { image_url: 'local-media://file/etc/passwd' },
    })),
    (error) => error.code === 'LOCAL_MEDIA_UNAVAILABLE',
  );
  await assert.rejects(
    workflowHandlers.run(workflowParams({
      nodeType: 'pod-flux',
      modelId: 'pod-flux',
      podUrl: 'http://127.0.0.1:8000',
    })),
    (error) => error.code === 'INVALID_URL',
  );
  await assert.rejects(
    workflowHandlers.run(workflowParams({
      nodeType: 'ltx-local',
      modelId: 'ltx-local',
    })),
    (error) => error.code === 'WEB_CAPABILITY_UNAVAILABLE',
  );
  await assert.rejects(
    workflowHandlers.run(workflowParams({
      nodeType: 'hf-kling-3',
      modelId: 'kling3_0',
    })),
    (error) => error.code === 'WEB_CAPABILITY_UNAVAILABLE',
  );
});

test('pod control validates identifiers before building GraphQL', async () => {
  const { podHandlers } = createWorkflowServices({
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  });
  await assert.rejects(
    podHandlers.start({ runpodKey: 'key', podId: 'pod" }) { injected }' }),
    (error) => error.code === 'INVALID_INPUT',
  );
});
