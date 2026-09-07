import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveGeneratedMediaOnNode } from '../../vercel/lib/generated-media-save.mjs';
import { generatedMediaLocation, MAX_GENERATED_MEDIA_BYTES } from '../../shared/generated-media.mjs';

const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });
const allowed = new Set(['owner@example.com']);
const input = { source: 'https://du9d8548ooqnc.cloudfront.net/task%2Fresult.mp4?Policy=policy&Signature=signature&Key-Pair-Id=key',
  ownerId: 'owner', projectId: 'project', assetId: 'asset', type: 'video' };
const location = generatedMediaLocation('owner', 'project', 'asset', 'video');
function mock({ existing = false, identityStatus = 200, projectStatus = 200, download } = {}) {
  const calls = [], uploads = [];
  globalThis.fetch = async (url, options = {}) => {
    url = String(url); calls.push(url);
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) return Response.json(identityStatus === 200
      ? { users: [{ localId: 'owner', email: 'owner@example.com' }] } : {}, { status: identityStatus });
    if (url.startsWith('https://firestore.googleapis.com/')) {
      assert.equal(options.headers.authorization, 'Bearer firebase.token');
      return new Response('{}', { status: projectStatus });
    }
    if (url === location.objectUrl) return existing ? Response.json({ downloadTokens: 'saved-token' }) : new Response(null, { status: 404 });
    if (url === input.source) {
      assert.equal(options.redirect, 'manual'); assert.equal(options.headers, undefined);
      return download ? download() : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
    }
    if (url === `${location.root}?name=${encodeURIComponent(location.name)}`) {
      assert.equal(options.headers.authorization, 'Firebase firebase.token');
      assert.equal(options.duplex, 'half');
      uploads.push(await new Response(options.body).arrayBuffer());
      return Response.json({ downloadTokens: 'saved-token' });
    }
    throw new Error('Unexpected network destination');
  };
  return { calls, uploads };
}

test('authorized Node transfer streams signed Topview bytes directly to Firebase and returns only the saved URL', async () => {
  const { calls, uploads } = mock();
  const saved = await saveGeneratedMediaOnNode(input, 'firebase.token', allowed, 'key');
  assert.deepEqual(saved, { url: location.objectUrl + '?alt=media&token=saved-token' });
  assert.equal(uploads.length, 1);
  assert.match(new TextDecoder().decode(uploads[0]), /"assetId":"asset"/);
  assert.equal(calls.filter(url => url === input.source).length, 1);
});

test('repeating a completed transfer reuses the saved object without another CDN fetch or upload', async () => {
  const { calls, uploads } = mock({ existing: true });
  assert.equal((await saveGeneratedMediaOnNode(input, 'firebase.token', allowed, 'key')).url, location.objectUrl + '?alt=media&token=saved-token');
  assert.equal(calls.includes(input.source), false); assert.equal(uploads.length, 0);
});

test('invalid identity and forbidden projects stop before any CDN or Storage request', async () => {
  for (const options of [{ identityStatus: 401 }, { projectStatus: 403 }]) {
    const { calls } = mock(options);
    await assert.rejects(saveGeneratedMediaOnNode(input, 'firebase.token', allowed, 'key'), /account/);
    assert.equal(calls.some(url => url === input.source || url.includes('firebasestorage')), false);
  }
});

test('transfer refuses arbitrary URLs, missing signatures, path traversal, and credentials in the CDN URL', async () => {
  const { calls } = mock();
  for (const bad of [
    { source: 'https://localhost/result.mp4' }, { source: 'https://du9d8548ooqnc.cloudfront.net/unsigned.mp4' },
    { source: input.source.replace('https://', 'https://user:password@') },
    { source: input.source.replace('.net/', '.net:8443/') }, { assetId: '../another-asset' }, { type: 'audio' },
  ]) await assert.rejects(saveGeneratedMediaOnNode({ ...input, ...bad }, 'firebase.token', allowed, 'key'), /Invalid/);
  assert.equal(calls.length, 0);
});

test('Node transfer rejects redirects and unexpected media without leaking authentication or uploading', async () => {
  for (const download of [
    () => new Response(null, { status: 302, headers: { location: 'https://localhost/private' } }),
    () => new Response('not a video', { headers: { 'content-type': 'text/html' } }),
    () => new Response('oversized', { headers: { 'content-type': 'video/mp4', 'content-length': String(MAX_GENERATED_MEDIA_BYTES + 1) } }),
    () => new Response('image', { headers: { 'content-type': 'image/png' } }),
  ]) {
    const { calls, uploads } = mock({ download });
    await assert.rejects(saveGeneratedMediaOnNode(input, 'firebase.token', allowed, 'key'), /download failed|media type|90 MB/);
    assert.equal(uploads.length, 0); assert.equal(calls.some(url => url.includes('localhost')), false);
  }
});

test('streaming size limit catches media that omits content-length', async () => {
  const { uploads } = mock({ download: () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(MAX_GENERATED_MEDIA_BYTES + 1)); controller.close();
  } }), { headers: { 'content-type': 'video/mp4' } }) });
  await assert.rejects(saveGeneratedMediaOnNode(input, 'firebase.token', allowed, 'key'), /too large/);
  assert.equal(uploads.length, 0);
});
