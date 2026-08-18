import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { createMediaHandlers } from './media.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => (
    fsp.rm(directory, { recursive: true, force: true })
  )));
});

async function createFixture() {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-media-test-'));
  temporaryRoots.push(dataRoot);
  const mediaRoot = path.join(dataRoot, 'media');
  const uploadPath = path.join(mediaRoot, 'uploads', 'upload-1', 'pixel image.png');
  await fsp.mkdir(path.dirname(uploadPath), { recursive: true });
  await fsp.writeFile(uploadPath, PNG_1X1);
  const emitted = [];
  const projectId = 'project_1';
  const handlers = createMediaHandlers({
    dataRoot,
    store: {
      async load(id) {
        if (id !== projectId) throw new Error('Project not found');
        return { project: { id } };
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
  return { dataRoot, mediaRoot, uploadPath, emitted, handlers, projectId };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for media event.');
}

test('imports a staged browser upload and emits image metadata and thumbnail URLs', async () => {
  const fixture = await createFixture();
  const [imported] = await fixture.handlers.import({
    filePaths: ['/media/uploads/upload-1/pixel%20image.png'],
    projectId: fixture.projectId,
    mode: 'link',
  });

  assert.equal(imported.type, 'image');
  assert.match(imported.assetId, /^[a-f0-9-]{36}$/);
  assert.match(
    imported.filePath,
    new RegExp(`^/media/projects/${fixture.projectId}/imported/${imported.assetId}/pixel%20image\\.png$`),
  );
  const importedDiskPath = path.join(
    fixture.mediaRoot,
    decodeURIComponent(imported.filePath.slice('/media/'.length)),
  );
  assert.deepEqual(await fsp.readFile(importedDiskPath), PNG_1X1);

  const metadataEvent = await waitFor(() => fixture.emitted.find(({ event, payload }) => (
    event === 'media:job-complete' && payload.jobId === imported.jobId
  )));
  assert.equal(metadataEvent.payload.assetId, imported.assetId);
  assert.equal(metadataEvent.payload.jobType, 'extract_metadata');
  assert.equal(metadataEvent.payload.result.width, 1);
  assert.equal(metadataEvent.payload.result.height, 1);
  assert.equal(metadataEvent.payload.result.fileSize, PNG_1X1.length);

  const thumbnailEvent = await waitFor(() => fixture.emitted.find(({ event, payload }) => (
    event === 'media:job-complete'
      && payload.assetId === imported.assetId
      && payload.jobType === 'generate_thumbnail'
  )));
  assert.match(thumbnailEvent.payload.result.outputPath, /^\/media\/projects\/project_1\/cache\/thumbnails\//);
});

test('rejects imports that are not staged uploads or escape the media directory', async () => {
  const fixture = await createFixture();
  const projectMedia = path.join(fixture.mediaRoot, 'projects', fixture.projectId, 'generated', 'other.png');
  await fsp.mkdir(path.dirname(projectMedia), { recursive: true });
  await fsp.writeFile(projectMedia, PNG_1X1);

  await assert.rejects(
    fixture.handlers.import({
      filePaths: [`/media/projects/${fixture.projectId}/generated/other.png`],
      projectId: fixture.projectId,
      mode: 'copy',
    }),
    /staged \/media\/uploads/,
  );
  await assert.rejects(
    fixture.handlers.import({
      filePaths: ['/media/uploads/%2e%2e/%2e%2e/outside.png'],
      projectId: fixture.projectId,
      mode: 'copy',
    }),
    /outside|escapes|staged|malformed/,
  );
});

test('persists an uploaded generated image and returns a browser media URL', async () => {
  const fixture = await createFixture();
  const assetId = 'generated_asset';
  const result = await fixture.handlers.persistGeneratedAsset({
    projectId: fixture.projectId,
    assetId,
    assetType: 'image',
    localPathHint: '/media/uploads/upload-1/pixel%20image.png',
  });

  assert.deepEqual(result, {
    path: `/media/projects/${fixture.projectId}/generated/${assetId}.png`,
    downloaded: false,
  });
  const diskPath = path.join(fixture.mediaRoot, 'projects', fixture.projectId, 'generated', `${assetId}.png`);
  assert.deepEqual(await fsp.readFile(diskPath), PNG_1X1);
  await waitFor(() => fixture.emitted.filter(({ event, payload }) => (
    event === 'media:job-complete' && payload.assetId === assetId
  )).length === 2);
});

test('blocks private remote downloads and stores data URL images below the web media root', async () => {
  const fixture = await createFixture();
  const blocked = await fixture.handlers.persistGeneratedAsset({
    projectId: fixture.projectId,
    assetId: 'remote_asset',
    assetType: 'image',
    remoteUrl: 'http://127.0.0.1/private.png',
  });
  assert.match(blocked.error, /HTTPS|public host/);

  const temporary = await fixture.handlers.writeTempImage({
    dataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
  });
  assert.match(temporary.outputPath, /^\/media\/temp\/frame-chat-[a-f0-9-]+\.png$/);
  const diskPath = path.join(fixture.mediaRoot, temporary.outputPath.slice('/media/'.length));
  assert.deepEqual(await fsp.readFile(diskPath), PNG_1X1);
});
