import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, test } from 'node:test';

import { createSam3Service } from './sam3.mjs';

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.exitCode = null;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }

  kill(signal) {
    this.killed = true;
    this.exitCode = signal === 'SIGKILL' ? 137 : 0;
    queueMicrotask(() => this.emit('exit', this.exitCode, signal));
    return true;
  }
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

async function createFixture(options = {}) {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-sam3-test-'));
  cleanups.push(() => fsp.rm(dataRoot, { recursive: true, force: true }));
  const mediaRoot = path.join(dataRoot, 'media');
  const projectId = 'project_1';
  const imagePath = path.join(mediaRoot, 'projects', projectId, 'imported', 'frame.png');
  await fsp.mkdir(path.dirname(imagePath), { recursive: true });
  await fsp.writeFile(imagePath, 'image fixture');
  const pythonPath = path.join(dataRoot, 'python');
  const scriptPath = path.join(dataRoot, 'sam3_server.py');
  await fsp.writeFile(pythonPath, 'runtime');
  await fsp.writeFile(scriptPath, 'script');

  const received = [];
  const outputPaths = [];
  cleanups.push(async () => {
    await Promise.all(outputPaths.map((outputPath) => fsp.rm(outputPath, { recursive: true, force: true })));
  });
  const writeSam3Output = async (prefix, name, contents) => {
    const outputRoot = path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}`);
    const outputPath = name ? path.join(outputRoot, name) : outputRoot;
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, contents);
    outputPaths.push(name ? outputRoot : outputPath);
    return outputPath;
  };
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    if (request.url === '/large') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '1024' });
      response.end(Buffer.alloc(1024));
      return;
    }
    if (request.url === '/stream') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.write(Buffer.alloc(4096, 1));
      response.end(Buffer.alloc(4096, 2));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    received.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (request.url === '/video/start-session') {
      response.end(JSON.stringify({ session_id: 'session-1', num_frames: 24 }));
    } else if (request.url === '/video/propagate') {
      const videoPath = await writeSam3Output('sam3-video-masked', 'masked.mp4', 'masked video');
      response.end(JSON.stringify({ video_path: videoPath, num_frames: 24 }));
    } else if (request.url === '/video/add-prompt') {
      const previewPath = await writeSam3Output('sam3-frame-preview', 'preview.png', 'preview image');
      response.end(JSON.stringify({ ok: true, preview_path: previewPath }));
    } else if (request.url === '/extract') {
      const background = await writeSam3Output('sam3-segment', 'background.png', 'background');
      const subject = await writeSam3Output('sam3-segment', 'subject.png', 'subject');
      response.end(JSON.stringify({ layers: [{ path: background }, { path: subject }] }));
    } else if (request.url === '/outputs') {
      const first = await writeSam3Output('sam3-segment', 'first.png', 'first');
      const second = await writeSam3Output('sam3-segment', 'second.png', 'second');
      response.end(JSON.stringify({ output_paths: [first, second] }));
    } else if (request.url === '/video/malicious') {
      response.end(JSON.stringify({ output_path: '/etc/hosts' }));
    } else {
      response.end(JSON.stringify({ received: body }));
    }
  });
  const upstreamAddress = await listen(upstream);
  cleanups.push(() => closeServer(upstream));

  const child = new FakeChild();
  const service = createSam3Service({
    dataRoot,
    pythonPath,
    scriptPath,
    portAllocator: async () => upstreamAddress.port,
    spawnProcess: () => child,
    idleTimeoutMs: options.idleTimeoutMs ?? 10_000,
    healthPollIntervalMs: 5,
    startupTimeoutMs: 250,
    maxRequestBytes: options.maxRequestBytes,
    maxResponseBytes: options.maxResponseBytes,
    store: {
      async load(id) {
        if (id !== projectId) throw new Error('Project not found');
        return { project: { id } };
      },
    },
    pathForMediaReference(reference) {
      const pathname = decodeURIComponent(new URL(reference, 'http://cinegen.test').pathname);
      if (!pathname.startsWith('/media/')) throw new Error('not media');
      return path.join(mediaRoot, pathname.slice('/media/'.length));
    },
  });
  cleanups.push(() => service.close());

  const proxy = http.createServer(async (request, response) => {
    try {
      await service.handleHttp(request, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }));
    }
  });
  const proxyAddress = await listen(proxy);
  cleanups.push(() => closeServer(proxy));
  return {
    baseUrl: `http://127.0.0.1:${proxyAddress.port}`,
    child,
    dataRoot,
    imagePath,
    mediaRoot,
    projectId,
    received,
    outputPaths,
    service,
  };
}

test('starts a configured local runtime and rewrites project media JSON paths', async () => {
  const fixture = await createFixture();
  assert.deepEqual(await fixture.service.handlers.start(), {
    port: 0,
    running: true,
    baseUrl: '/api/sam3',
  });
  assert.deepEqual(await fixture.service.handlers.getPort(), {
    port: 0,
    running: true,
    baseUrl: '/api/sam3',
  });

  const reference = `/media/projects/${fixture.projectId}/imported/frame.png`;
  const { response, body } = await requestJson(`${fixture.baseUrl}/api/sam3/set-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: reference, nested: { video_path: reference } }),
  });
  assert.equal(response.status, 200);
  assert.match(body.received.image_path, /^\/media\/projects\/project_1\/generated\/sam3\//);
  assert.equal(body.received.nested.video_path, body.received.image_path);
  const copiedPath = path.join(fixture.mediaRoot, decodeURIComponent(body.received.image_path.slice('/media/'.length)));
  assert.equal(await fsp.readFile(copiedPath, 'utf8'), 'image fixture');
  assert.equal(fixture.received[0].url, '/set-image');
  assert.equal(fixture.received[0].body.image_path, await fsp.realpath(fixture.imagePath));
  assert.equal(fixture.child.killed, false);
});

test('streams upstream responses and enforces declared response limits', async () => {
  const fixture = await createFixture({ maxResponseBytes: 16 * 1024 });
  const streamed = await fetch(`${fixture.baseUrl}/api/sam3/stream`);
  assert.equal(streamed.status, 200);
  assert.equal((await streamed.arrayBuffer()).byteLength, 8192);

  const limited = await createFixture({ maxResponseBytes: 128 });
  const { response, body } = await requestJson(`${limited.baseUrl}/api/sam3/large`);
  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'SAM3_RESPONSE_TOO_LARGE');
});

test('copies local output paths into project media and tracks video session ownership', async () => {
  const fixture = await createFixture();
  const mediaReference = `/media/projects/${fixture.projectId}/imported/frame.png`;
  let result = await requestJson(`${fixture.baseUrl}/api/sam3/video/start-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_path: mediaReference }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.session_id, 'session-1');

  result = await requestJson(`${fixture.baseUrl}/api/sam3/video/propagate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'session-1', apply_mask: true }),
  });
  assert.equal(result.response.status, 200);
  assert.match(result.body.video_path, /^\/media\/projects\/project_1\/generated\/sam3\//);
  let copied = path.join(fixture.mediaRoot, decodeURIComponent(result.body.video_path.slice('/media/'.length)));
  assert.equal(await fsp.readFile(copied, 'utf8'), 'masked video');
  assert.equal(result.body.video_path.includes(os.tmpdir()), false);

  result = await requestJson(`${fixture.baseUrl}/api/sam3/video/add-prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'session-1', frame_index: 0 }),
  });
  assert.match(result.body.preview_path, /^\/media\/projects\/project_1\/generated\/sam3\//);
  copied = path.join(fixture.mediaRoot, decodeURIComponent(result.body.preview_path.slice('/media/'.length)));
  assert.equal(await fsp.readFile(copied, 'utf8'), 'preview image');

  result = await requestJson(`${fixture.baseUrl}/api/sam3/set-image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: mediaReference }),
  });
  assert.equal(result.response.status, 200);
  result = await requestJson(`${fixture.baseUrl}/api/sam3/extract`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mask_indices: [0, 1] }),
  });
  assert.equal(result.body.layers.length, 2);
  assert.ok(result.body.layers.every(({ path: outputPath }) => (
    /^\/media\/projects\/project_1\/generated\/sam3\//.test(outputPath)
  )));
  const layerContents = await Promise.all(result.body.layers.map(({ path: outputPath }) => (
    fsp.readFile(path.join(fixture.mediaRoot, decodeURIComponent(outputPath.slice('/media/'.length))), 'utf8')
  )));
  assert.deepEqual(layerContents, ['background', 'subject']);

  result = await requestJson(`${fixture.baseUrl}/api/sam3/outputs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'session-1' }),
  });
  assert.equal(result.body.output_paths.length, 2);
  assert.ok(result.body.output_paths.every((outputPath) => outputPath.startsWith('/media/projects/project_1/generated/sam3/')));
});

test('never exposes unowned or arbitrary local output paths', async () => {
  const fixture = await createFixture();
  let result = await requestJson(`${fixture.baseUrl}/api/sam3/video/propagate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apply_mask: true }),
  });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error.code, 'SAM3_OUTPUT_UNOWNED');
  assert.equal(JSON.stringify(result.body).includes(os.tmpdir()), false);

  result = await requestJson(`${fixture.baseUrl}/api/sam3/video/malicious`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'missing-session' }),
  });
  assert.equal(result.response.status, 404);
  assert.equal(result.body.error.code, 'SAM3_SESSION_NOT_FOUND');

  const mediaReference = `/media/projects/${fixture.projectId}/imported/frame.png`;
  await requestJson(`${fixture.baseUrl}/api/sam3/video/start-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_path: mediaReference }),
  });
  result = await requestJson(`${fixture.baseUrl}/api/sam3/video/malicious`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'session-1' }),
  });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error.code, 'SAM3_OUTPUT_PATH_FORBIDDEN');
  assert.equal(JSON.stringify(result.body).includes('/etc/hosts'), false);
});

test('rejects upload paths, cross-project media, symlink escapes, and oversized bodies', async () => {
  const fixture = await createFixture({ maxRequestBytes: 256 });
  const uploadPath = path.join(fixture.mediaRoot, 'uploads', 'upload_1', 'loose.png');
  await fsp.mkdir(path.dirname(uploadPath), { recursive: true });
  await fsp.writeFile(uploadPath, 'fixture');
  let result = await requestJson(`${fixture.baseUrl}/api/sam3/set-image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: '/media/uploads/upload_1/loose.png' }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, 'INVALID_MEDIA_PATH');

  const other = path.join(fixture.mediaRoot, 'projects', 'project_2', 'other.png');
  await fsp.mkdir(path.dirname(other), { recursive: true });
  await fsp.writeFile(other, 'fixture');
  result = await requestJson(`${fixture.baseUrl}/api/sam3/set-image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: '/media/projects/project_2/other.png' }),
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error.code, 'PROJECT_MEDIA_MISMATCH');

  const outside = path.join(fixture.dataRoot, 'outside.png');
  const link = path.join(path.dirname(fixture.imagePath), 'linked.png');
  await fsp.writeFile(outside, 'fixture');
  await fsp.symlink(outside, link);
  result = await requestJson(`${fixture.baseUrl}/api/sam3/set-image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: `/media/projects/${fixture.projectId}/imported/linked.png` }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, 'INVALID_MEDIA_PATH');

  result = await requestJson(`${fixture.baseUrl}/api/sam3/segment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'x'.repeat(300) }),
  });
  assert.equal(result.response.status, 413);
  assert.equal(result.body.error.code, 'SAM3_REQUEST_TOO_LARGE');
});

test('blocks unsafe remote targets and shuts an idle local runtime down', async () => {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-sam3-remote-test-'));
  cleanups.push(() => fsp.rm(dataRoot, { recursive: true, force: true }));
  assert.throws(() => createSam3Service({
    dataRoot,
    baseUrl: 'http://sam3.example.com',
  }), (error) => error.code === 'INVALID_SAM3_BASE_URL');
  assert.throws(() => createSam3Service({
    dataRoot,
    baseUrl: 'https://127.0.0.1',
  }), (error) => error.code === 'SAM3_REMOTE_FORBIDDEN');

  const fixture = await createFixture({ idleTimeoutMs: 30 });
  await fixture.service.handlers.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal((await fixture.service.handlers.getPort()).running, false);
  assert.equal(fixture.child.killed, true);
});

test('supports a pinned remote HTTPS backend without exposing its origin', async () => {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-sam3-https-test-'));
  cleanups.push(() => fsp.rm(dataRoot, { recursive: true, force: true }));
  const requests = [];
  const responseFor = (body) => {
    const stream = Readable.from([Buffer.from(body)]);
    stream.statusCode = 200;
    stream.headers = { 'content-type': 'application/json' };
    stream.setTimeout = () => stream;
    return stream;
  };
  const service = createSam3Service({
    dataRoot,
    baseUrl: 'https://sam3.example.com/v1',
    dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    upstreamRequest: async (request) => {
      requests.push(request);
      return responseFor(request.url.pathname.endsWith('/health')
        ? '{"ok":true}'
        : JSON.stringify({
          proxied: true,
          video_path: 'https://cdn.example.com/masked.mp4',
          mask_path: 'data:image/png;base64,AAAA',
        }));
    },
  });
  cleanups.push(() => service.close());
  assert.deepEqual(await service.handlers.start(), {
    port: 0,
    running: true,
    baseUrl: '/api/sam3',
  });

  const proxy = http.createServer(async (request, response) => {
    try {
      await service.handleHttp(request, response);
    } catch (error) {
      response.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { code: error.code } }));
    }
  });
  const address = await listen(proxy);
  cleanups.push(() => closeServer(proxy));
  const result = await fetch(`http://127.0.0.1:${address.port}/api/sam3/segment?mode=text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'text', prompt: 'person' }),
  });
  assert.deepEqual(await result.json(), {
    proxied: true,
    video_path: 'https://cdn.example.com/masked.mp4',
    mask_path: 'data:image/png;base64,AAAA',
  });
  assert.equal(requests[0].url.href, 'https://sam3.example.com/v1/health');
  assert.equal(requests[1].url.href, 'https://sam3.example.com/v1/segment?mode=text');
  assert.equal(requests[1].remoteAddress.address, '8.8.8.8');
  assert.equal((await service.handlers.getPort()).port, 0);
});
