import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { createExportHandlers } from './export.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => (
    fsp.rm(directory, { recursive: true, force: true })
  )));
});

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for export state.');
}

async function createFixture(processRunner) {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-export-test-'));
  temporaryRoots.push(dataRoot);
  const mediaRoot = path.join(dataRoot, 'media');
  const projectId = 'project_1';
  const projectRoot = path.join(mediaRoot, 'projects', projectId, 'imported');
  await fsp.mkdir(projectRoot, { recursive: true });
  const inputPaths = {
    video: path.join(projectRoot, 'video.mp4'),
    image: path.join(projectRoot, 'still.png'),
    audio: path.join(projectRoot, 'score.wav'),
  };
  await Promise.all(Object.values(inputPaths).map((filePath) => fsp.writeFile(filePath, 'fixture')));
  const emitted = [];
  const calls = [];
  const runner = processRunner ?? (async (request) => {
    calls.push(request);
    if (request.kind === 'render') {
      request.onStderr?.('out_time_ms=1000000\n');
      request.onStderr?.('out_time_ms=3900000\nprogress=end\n');
      await fsp.writeFile(request.outputPath, 'rendered mp4');
    }
    return { code: 0, stderr: '' };
  });
  const handlers = createExportHandlers({
    dataRoot,
    ffmpegPath: '/fixture/ffmpeg',
    processRunner: runner,
    store: {
      async load(id) {
        if (id !== projectId && id !== 'project_2') throw new Error('Project not found');
        return {
          project: { id, resolution_width: 1280, resolution_height: 720 },
        };
      },
    },
    events: { emit: (event, payload) => emitted.push({ event, payload }) },
    pathForMediaReference(reference) {
      const pathname = decodeURIComponent(new URL(reference, 'http://cinegen.test').pathname);
      if (!pathname.startsWith('/media/')) throw new Error('not media');
      return path.join(mediaRoot, pathname.slice('/media/'.length));
    },
    mediaUrlForPath(filePath) {
      const relative = path.relative(mediaRoot, filePath).split(path.sep).map(encodeURIComponent).join('/');
      return `/media/${relative}`;
    },
  });
  const refs = Object.fromEntries(Object.entries(inputPaths).map(([key, filePath]) => [
    key,
    `/media/${path.relative(mediaRoot, filePath).split(path.sep).map(encodeURIComponent).join('/')}`,
  ]));
  return { calls, dataRoot, emitted, handlers, inputPaths, mediaRoot, projectId, refs };
}

test('renders video, looping image, and audio clips to a browser-safe MP4', async () => {
  const fixture = await createFixture();
  const started = await fixture.handlers.start({
    preset: 'standard',
    fps: 24,
    totalDuration: 4,
    clips: [
      { inputPath: fixture.refs.video, type: 'video', startTime: 0, duration: 2, trimStart: 0.25, speed: 1, volume: 0.8 },
      { inputPath: fixture.refs.image, type: 'image', startTime: 2, duration: 2, trimStart: 0, speed: 1, volume: 0 },
      { inputPath: fixture.refs.audio, type: 'audio', startTime: 0.5, duration: 3, trimStart: 1, speed: 1, volume: 0.5 },
    ],
  });

  assert.equal(started.status, 'queued');
  assert.equal(started.progress, 0);
  assert.equal(started.preset, 'standard');
  assert.equal(started.fps, 24);

  const completed = await waitFor(async () => {
    const job = await fixture.handlers.poll(started.id);
    return job.status === 'complete' ? job : null;
  });
  assert.equal(completed.progress, 100);
  assert.equal(completed.fileSize, Buffer.byteLength('rendered mp4'));
  assert.match(completed.outputUrl, new RegExp(`^/media/projects/${fixture.projectId}/exports/${started.id}\\.mp4$`));
  assert.equal(await fsp.readFile(path.join(
    fixture.mediaRoot,
    decodeURIComponent(completed.outputUrl.slice('/media/'.length)),
  ), 'utf8'), 'rendered mp4');

  const renderCall = fixture.calls.find(({ kind }) => kind === 'render');
  assert.ok(renderCall);
  assert.ok(renderCall.args.includes('-loop'), 'image input should be looped');
  assert.ok(renderCall.args.includes('libx264'));
  assert.ok(renderCall.args.includes('yuv420p'));
  assert.ok(renderCall.args.includes('aac'));
  const filter = renderCall.args[renderCall.args.indexOf('-filter_complex') + 1];
  assert.match(filter, /overlay=/);
  assert.match(filter, /adelay=500:all=1/);
  assert.match(filter, /amix=/);
  assert.ok(fixture.emitted.some(({ event, payload }) => (
    event === 'export:progress' && payload.jobId === started.id && payload.progress === 100
  )));
});

test('rejects mixed-project, staged-upload, and malformed export inputs', async () => {
  const fixture = await createFixture();
  const secondPath = path.join(fixture.mediaRoot, 'projects', 'project_2', 'imported', 'second.mp4');
  await fsp.mkdir(path.dirname(secondPath), { recursive: true });
  await fsp.writeFile(secondPath, 'fixture');
  const secondRef = '/media/projects/project_2/imported/second.mp4';

  await assert.rejects(
    fixture.handlers.start({
      preset: 'standard', fps: 30, totalDuration: 2,
      clips: [
        { inputPath: fixture.refs.video, type: 'video', startTime: 0, duration: 1, trimStart: 0, speed: 1, volume: 1 },
        { inputPath: secondRef, type: 'video', startTime: 1, duration: 1, trimStart: 0, speed: 1, volume: 1 },
      ],
    }),
    (error) => error.code === 'MIXED_PROJECT_MEDIA',
  );

  const uploadPath = path.join(fixture.mediaRoot, 'uploads', 'upload_1', 'loose.mp4');
  await fsp.mkdir(path.dirname(uploadPath), { recursive: true });
  await fsp.writeFile(uploadPath, 'fixture');
  await assert.rejects(
    fixture.handlers.start({
      totalDuration: 1,
      clips: [{ inputPath: '/media/uploads/upload_1/loose.mp4', type: 'video', startTime: 0, duration: 1 }],
    }),
    (error) => error.code === 'INVALID_MEDIA_PATH',
  );
  await assert.rejects(
    fixture.handlers.start({
      preset: 'lossless', fps: 25, totalDuration: 0,
      clips: [{ inputPath: fixture.refs.video, type: 'video', startTime: 0, duration: 1 }],
    }),
    /preset/,
  );
  await assert.rejects(fixture.handlers.poll('not-a-job-id'), (error) => error.code === 'INVALID_EXPORT_ID');
});

test('cancels a running export and removes its partial output', async () => {
  let renderStarted;
  const startedPromise = new Promise((resolve) => { renderStarted = resolve; });
  const fixture = await createFixture(async (request) => {
    if (request.kind === 'probe-audio') return { code: 1, stderr: 'no audio' };
    await fsp.writeFile(request.outputPath, 'partial output');
    renderStarted();
    return new Promise((resolve) => {
      request.signal.addEventListener('abort', () => resolve({ code: 143, signal: 'SIGTERM', stderr: '' }), { once: true });
    });
  });
  const started = await fixture.handlers.start({
    preset: 'draft',
    fps: 30,
    totalDuration: 1,
    clips: [{ inputPath: fixture.refs.video, type: 'video', startTime: 0, duration: 1, trimStart: 0, speed: 1, volume: 1 }],
  });
  await startedPromise;

  assert.deepEqual(await fixture.handlers.cancel(started.id), { ok: true });
  const cancelled = await fixture.handlers.poll(started.id);
  assert.equal(cancelled.status, 'failed');
  assert.equal(cancelled.error, 'Cancelled by user');
  assert.equal(cancelled.completedAt.length > 0, true);
  const outputPath = path.join(fixture.mediaRoot, 'projects', fixture.projectId, 'exports', `${started.id}.mp4`);
  await assert.rejects(fsp.stat(outputPath), (error) => error.code === 'ENOENT');
});
