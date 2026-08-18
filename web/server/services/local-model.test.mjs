import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { createLocalModelHandlers } from './local-model.mjs';

const roots = [];
const NODE_TYPES = ['ltx-local', 'qwen-edit-local', 'layer-decompose', 'whisperx-local'];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => (
    fsp.rm(directory, { recursive: true, force: true })
  )));
});

async function createFixture(overrides = {}) {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-local-model-test-'));
  roots.push(dataRoot);
  const mediaRoot = path.join(dataRoot, 'media');
  const runtimeRoot = path.join(dataRoot, 'runtime');
  const projectId = 'project_1';
  const imagePath = path.join(mediaRoot, 'projects', projectId, 'imported', 'asset_image', 'source.png');
  const audioPath = path.join(mediaRoot, 'projects', projectId, 'imported', 'asset_audio', 'source.wav');
  await Promise.all([
    fsp.mkdir(path.dirname(imagePath), { recursive: true }),
    fsp.mkdir(path.dirname(audioPath), { recursive: true }),
    fsp.mkdir(runtimeRoot, { recursive: true }),
  ]);
  await Promise.all([
    fsp.writeFile(imagePath, 'source image'),
    fsp.writeFile(audioPath, 'source audio'),
  ]);
  const events = [];
  const runtime = (name) => ({
    python: `/configured/${name}/python`,
    script: `/configured/${name}/infer.py`,
    repo: runtimeRoot,
  });
  const context = {
    dataRoot,
    store: {
      async load(id) {
        if (id !== projectId) throw new Error(`Project not found: ${id}`);
        return { project: { id }, assets: [] };
      },
    },
    events: { emit: (event, payload) => events.push({ event, payload }) },
    pathForMediaReference(reference) {
      const pathname = decodeURIComponent(new URL(reference, 'http://cinegen.test').pathname);
      if (!pathname.startsWith('/media/')) throw new Error('Only media references are allowed');
      return path.join(mediaRoot, pathname.slice('/media/'.length));
    },
    mediaUrlForPath(filePath) {
      return `/media/${path.relative(mediaRoot, filePath).split(path.sep).map(encodeURIComponent).join('/')}`;
    },
    runtimes: Object.fromEntries(NODE_TYPES.map((name) => [name, runtime(name)])),
    ...overrides,
  };
  return {
    dataRoot,
    mediaRoot,
    runtimeRoot,
    projectId,
    imagePath,
    audioPath,
    events,
    context,
    handlers: createLocalModelHandlers(context),
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
  throw new Error(`Timed out waiting for local model job ${jobId}.`);
}

test('returns a clear capability error when a requested runtime is not configured', async () => {
  const fixture = await createFixture({ runtimes: {} });
  await assert.rejects(
    fixture.handlers.run({
      nodeType: 'qwen-edit-local',
      inputs: {
        prompt: 'Remove the sign',
        image_url: `/media/projects/${fixture.projectId}/imported/asset_image/source.png`,
      },
    }),
    (error) => {
      assert.equal(error.code, 'WEB_CAPABILITY_UNAVAILABLE');
      assert.equal(error.statusCode, 501);
      assert.match(error.message, /CINEGEN_QWEN_EDIT_PYTHON/);
      return true;
    },
  );
});

test('runs Qwen with validated project media and copies its output into browser media', async () => {
  const specs = [];
  const fixture = await createFixture({
    async processRunner(spec, handlers) {
      specs.push(spec);
      const output = path.join(spec.cwd, 'edited image.png');
      await fsp.writeFile(output, 'edited result');
      await handlers.onStdoutLine(JSON.stringify({ type: 'progress', stage: 'generating', message: 'Editing image' }));
      await handlers.onStdoutLine(JSON.stringify({ type: 'done', output_path: output }));
      return { code: 0, signal: null };
    },
  });

  const { jobId } = await fixture.handlers.run({
    nodeType: 'qwen-edit-local',
    inputs: {
      prompt: 'Remove the sign',
      image_url: `http://cinegen.test/media/projects/${fixture.projectId}/imported/asset_image/source.png`,
      num_inference_steps: 28,
      guidance_scale: 1.5,
      true_cfg_scale: 4.5,
      seed: 7,
    },
  });
  const job = await waitForJob(fixture.handlers, jobId);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].nodeType, 'qwen-edit-local');
  assert.deepEqual(specs[0].args, [
    '/configured/qwen-edit-local/infer.py',
    '--image_path', await fsp.realpath(fixture.imagePath),
    '--prompt', 'Remove the sign',
    '--num_inference_steps', '28',
    '--guidance_scale', '1.5',
    '--true_cfg_scale', '4.5',
    '--seed', '7',
  ]);
  assert.match(job.outputPath, new RegExp(`^/media/projects/${fixture.projectId}/generated/local-model/${jobId}/01-edited%20image\\.png$`));
  const copied = path.join(fixture.mediaRoot, decodeURIComponent(job.outputPath.slice('/media/'.length)));
  assert.equal(await fsp.readFile(copied, 'utf8'), 'edited result');

  const progress = fixture.events.find(({ event, payload }) => (
    event === 'local-model:progress' && payload.jobId === jobId && payload.type === 'progress'
  ));
  assert.equal(progress.payload.stage, 'generating');
  const done = fixture.events.find(({ event, payload }) => (
    event === 'local-model:progress' && payload.jobId === jobId && payload.type === 'done'
  ));
  assert.equal(done.payload.output_path, job.outputPath);
  assert.doesNotMatch(JSON.stringify(done), new RegExp(fixture.runtimeRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('requires project ownership for text-only LTX and passes its exact runtime arguments', async () => {
  const specs = [];
  const fixture = await createFixture({
    async processRunner(spec, handlers) {
      specs.push(spec);
      const output = path.join(spec.cwd, 'ltx.mp4');
      await fsp.writeFile(output, 'video');
      await handlers.onStdoutLine(JSON.stringify({ type: 'done', output_path: 'ltx.mp4' }));
      return { code: 0 };
    },
  });

  await assert.rejects(
    fixture.handlers.run({ nodeType: 'ltx-local', inputs: { prompt: 'A dolly shot' } }),
    /projectId is required/,
  );
  const { jobId } = await fixture.handlers.run({
    projectId: fixture.projectId,
    nodeType: 'ltx-local',
    inputs: {
      prompt: 'A dolly shot',
      resolution: '1280x704',
      duration_secs: 3,
      frame_rate: 24,
      seed: 9,
      enhance_prompt: true,
    },
  });
  const job = await waitForJob(fixture.handlers, jobId);
  assert.match(job.outputPath, /\/01-ltx\.mp4$/);
  assert.deepEqual(specs[0].args, [
    '/configured/ltx-local/infer.py',
    '--prompt', 'A dolly shot',
    '--height', '704',
    '--width', '1280',
    '--num_frames', '73',
    '--frame_rate', '24',
    '--seed', '9',
    '--enhance_prompt',
  ]);
});

test('maps every Layer Decompose output and metadata into the owning project', async () => {
  let capturedArgs;
  const fixture = await createFixture({
    async processRunner(spec, handlers) {
      capturedArgs = spec.args;
      const background = path.join(spec.cwd, 'background.png');
      const foreground = path.join(spec.cwd, 'foreground.png');
      const mask = path.join(spec.cwd, 'mask.png');
      await Promise.all([
        fsp.writeFile(background, 'background'),
        fsp.writeFile(foreground, 'foreground'),
        fsp.writeFile(mask, 'mask'),
      ]);
      await handlers.onStdoutLine(JSON.stringify({
        type: 'done',
        output_path: background,
        layers: [
          { path: background, name: 'Background', type: 'background', z_order: 0, metadata: { confidence: 0.9 } },
          { path: foreground, name: 'Subject', type: 'object', z_order: 1 },
        ],
        needs_inpainting: true,
        combined_mask_path: mask,
      }));
      return { code: 0 };
    },
  });

  const { jobId } = await fixture.handlers.run({
    nodeType: 'layer-decompose',
    inputs: {
      image_url: `local-media://filehttp://cinegen.test/media/projects/${fixture.projectId}/imported/asset_image/source.png`,
      prompts: 'person, title',
      inpainter: 'qwen-edit-local',
      reconstruct_bg: true,
      seed: 42,
    },
  });
  await waitForJob(fixture.handlers, jobId);
  assert.deepEqual(capturedArgs, [
    '/configured/layer-decompose/infer.py',
    '--image_path', await fsp.realpath(fixture.imagePath),
    '--inpainter', 'none',
    '--seed', '42',
    '--prompts', 'person, title',
  ]);
  const done = fixture.events.find(({ payload }) => payload.jobId === jobId && payload.type === 'done').payload;
  assert.equal(done.needs_inpainting, true);
  assert.equal(done.layers.length, 2);
  assert.equal(done.layers[0].path, done.output_path);
  assert.equal(done.layers[0].metadata.confidence, 0.9);
  assert.match(done.layers[1].path, /^\/media\/projects\/project_1\/generated\/local-model\//);
  assert.match(done.combined_mask_path, /^\/media\/projects\/project_1\/generated\/local-model\//);
  assert.ok([done.output_path, done.layers[1].path, done.combined_mask_path].every((url) => url.includes(`/${jobId}/`)));
});

test('maps WhisperX transcripts and only reads transcript JSON produced by a local-model job', async () => {
  const fixture = await createFixture({
    async processRunner(spec, handlers) {
      const transcript = path.join(spec.cwd, 'transcript.json');
      const segments = [{
        text: 'Hello there.', start: 0, end: 1,
        words: [{ word: 'Hello', start: 0, end: 0.4, prob: 0.98 }, { word: 'there.', start: 0.5, end: 1 }],
      }];
      await fsp.writeFile(transcript, JSON.stringify({ output_text: 'Hello there.', segments, language: 'en', private_path: '/etc/passwd' }));
      await handlers.onStdoutLine(JSON.stringify({ type: 'progress', stage: 'aligning', output_text: 'Hello', segments: segments.slice(0, 1) }));
      await handlers.onStdoutLine(JSON.stringify({
        type: 'done',
        output_text: 'Hello there.',
        transcript_path: transcript,
        segments,
        language: 'en',
      }));
      return { code: 0 };
    },
  });

  const { jobId } = await fixture.handlers.run({
    nodeType: 'whisperx-local',
    inputs: {
      audio_url: `/media/projects/${fixture.projectId}/imported/asset_audio/source.wav`,
      model: 'large-v3',
      language: 'en',
      diarize: false,
    },
  });
  const job = await waitForJob(fixture.handlers, jobId);
  assert.equal(job.outputText, 'Hello there.');
  assert.equal(job.language, 'en');
  assert.match(job.transcriptPath, new RegExp(`^/media/projects/${fixture.projectId}/generated/local-model/${jobId}/`));
  const transcript = await fixture.handlers.readTranscript(job.transcriptPath);
  assert.deepEqual(transcript, {
    output_text: 'Hello there.',
    segments: [{
      text: 'Hello there.', start: 0, end: 1,
      words: [{ word: 'Hello', start: 0, end: 0.4, prob: 0.98 }, { word: 'there.', start: 0.5, end: 1 }],
    }],
    language: 'en',
  });
  assert.equal('private_path' in transcript, false);
  await assert.rejects(
    fixture.handlers.readTranscript(`/media/projects/${fixture.projectId}/imported/asset_audio/source.wav`),
    (error) => error.code === 'INVALID_MEDIA_PATH' && error.statusCode === 403,
  );
  await assert.rejects(fixture.handlers.readTranscript('/etc/passwd'), /invalid|project-owned/i);
});

test('rejects cross-project media and unknown local node types before starting work', async () => {
  const fixture = await createFixture({ processRunner: async () => ({ code: 0 }) });
  const foreign = path.join(fixture.mediaRoot, 'projects', 'project_2', 'imported', 'foreign.png');
  await fsp.mkdir(path.dirname(foreign), { recursive: true });
  await fsp.writeFile(foreign, 'foreign');
  await assert.rejects(
    fixture.handlers.run({
      projectId: fixture.projectId,
      nodeType: 'qwen-edit-local',
      inputs: { prompt: 'edit', image_url: '/media/projects/project_2/imported/foreign.png' },
    }),
    (error) => error.code === 'PROJECT_MISMATCH' && error.statusCode === 403,
  );
  await assert.rejects(
    fixture.handlers.run({ projectId: fixture.projectId, nodeType: 'sam3-segment', inputs: {} }),
    (error) => error.code === 'UNSUPPORTED_LOCAL_MODEL' && error.statusCode === 501,
  );
});
