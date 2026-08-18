import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createElementsHandlers } from './elements.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('elements stage browser media through request-scoped fal storage', async (context) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-elements-test-'));
  context.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const uploadDirectory = path.join(dataRoot, 'media', 'uploads', 'upload-1');
  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadDirectory, 'interview.mov'), Buffer.from('video bytes'));

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return jsonResponse({
        upload_url: 'https://uploads.example.com/presigned',
        file_url: 'https://fal.media/interview.mov',
      });
    }
    return new Response(null, { status: 200 });
  };
  const handlers = createElementsHandlers({ dataRoot, fetchImpl });

  const result = await handlers.uploadTranscriptionSource(
    'local-media://file/media/uploads/upload-1/interview.mov',
    'request-only-secret',
  );

  assert.deepEqual(result, { url: 'https://fal.media/interview.mov' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization, 'Key request-only-secret');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    content_type: 'video/quicktime',
    file_name: 'interview.mov',
  });
  assert.equal(calls[1].url, 'https://uploads.example.com/presigned');
  assert.deepEqual(Buffer.from(calls[1].init.body), Buffer.from('video bytes'));
});

test('elements pass validated public media through without requiring an upload', async () => {
  const handlers = createElementsHandlers({
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  });

  assert.deepEqual(
    await handlers.uploadMediaSource('https://cdn.example.com/video.mp4?token=one'),
    { url: 'https://cdn.example.com/video.mp4?token=one' },
  );
  await assert.rejects(
    handlers.uploadMediaSource('http://127.0.0.1/private.mp4'),
    (error) => error.code === 'INVALID_URL',
  );
  await assert.rejects(
    handlers.uploadMediaSource('file:///Users/example/private.mov', 'secret'),
    (error) => error.code === 'LOCAL_MEDIA_UNAVAILABLE',
  );
});

test('elements block encoded traversal outside the web media directory', async (context) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-elements-traversal-'));
  context.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataRoot, 'media'), { recursive: true });
  const handlers = createElementsHandlers({
    dataRoot,
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  });

  await assert.rejects(
    handlers.uploadMediaSource('/media/%2e%2e/secret.mov', 'secret'),
    (error) => error.code === 'INVALID_URL',
  );
});
