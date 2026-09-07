// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readCloudProject } from '@/lib/cloud/project-reader';

const encode = (v: any): any => typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { booleanValue: v };
const doc = (fields: Record<string, any>) => ({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) });
const snapshot = JSON.stringify({ project: { id: 'cloud_test', name: 'Film' }, assets: [{ id: 'video' }] });
const chunks = [snapshot.slice(0, 30), snapshot.slice(30)];
const user = { uid: 'owner', getIdToken: vi.fn(async () => 'user-token') } as any;
let requests: string[];
let handler: (path: string) => Response;
beforeEach(() => {
  requests = []; user.getIdToken.mockReset().mockResolvedValue('user-token');
  handler = path => {
    if (path.endsWith('/projects/cloud_test')) return Response.json(doc({ currentRevision: 'revision', chunkCount: 2 }));
    if (path.endsWith('/revisions/revision')) return Response.json(doc({ complete: true }));
    if (path.includes('/chunks?')) return Response.json({ documents: [doc({ index: 1, data: chunks[1] }), doc({ index: 0, data: chunks[0] })] });
    throw new Error(`Unexpected read: ${path}`);
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    expect(options.method ?? 'GET').toBe('GET');
    expect(options.headers).toEqual({ Authorization: 'Bearer user-token' });
    const path = url.split('/documents/')[1]; requests.push(path);
    return handler(path);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('loads a complete project without identity writes, SDK listeners, or migration', async () => {
  const result = await readCloudProject(user, 'cloud_test');
  expect(result).toEqual({ ownerId: 'owner', revision: 'revision', state: JSON.parse(snapshot) });
  expect(requests).toHaveLength(3);
  expect(requests.every(path => path.startsWith('users/owner/projects/'))).toBe(true);
});

it('resolves a shared project through access metadata and reads every chunk page', async () => {
  const normal = handler;
  handler = path => {
    if (path === 'users/owner/projects/cloud_test') return new Response(null, { status: 404 });
    if (path === 'projectAccess/cloud_test') return Response.json(doc({ ownerId: 'creator' }));
    if (path.includes('/chunks?')) return path.includes('pageToken=next')
      ? Response.json({ documents: [doc({ index: 1, data: chunks[1] })] })
      : Response.json({ documents: [doc({ index: 0, data: chunks[0] })], nextPageToken: 'next' });
    return normal(path);
  };
  expect((await readCloudProject(user, 'cloud_test')).ownerId).toBe('creator');
  expect(requests.filter(p => p.includes('/chunks?'))).toHaveLength(2);
});

it.each([false, 'missing', 'duplicate'])('rejects incomplete revision %s before returning an editable project', async mode => {
  const normal = handler;
  handler = path => mode === false && path.endsWith('/revisions/revision') ? Response.json(doc({ complete: false }))
    : mode !== false && path.includes('/chunks?') ? Response.json({ documents: mode === 'missing' ? [doc({ index: 0, data: snapshot })] : [doc({ index: 0, data: chunks[0] }), doc({ index: 0, data: chunks[1] })] }) : normal(path);
  await expect(readCloudProject(user, 'cloud_test')).rejects.toThrow('still saving');
});

it('retries a dropped read once without resending any writes', async () => {
  const normal = handler; let first = true;
  handler = path => { if (first) { first = false; throw new TypeError('Network lost'); } return normal(path); };
  expect((await readCloudProject(user, 'cloud_test')).state.project.name).toBe('Film');
  expect(requests.filter(path => path.endsWith('/projects/cloud_test'))).toHaveLength(2);
});

it('does not retry permission failures or fall back to another identity', async () => {
  handler = () => new Response(null, { status: 403 });
  await expect(readCloudProject(user, 'cloud_test')).rejects.toThrow('account cannot open');
  expect(requests).toHaveLength(1);
});

it('refreshes an expired session once', async () => {
  const normal = handler; let first = true;
  handler = path => { if (first) { first = false; return new Response(null, { status: 401 }); } return normal(path); };
  await readCloudProject(user, 'cloud_test');
  expect(user.getIdToken).toHaveBeenCalledWith(true);
});

it('cancels a stuck request so a new attempt can complete without a page reload', async () => {
  const normalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason))));
  const controller = new AbortController();
  const first = readCloudProject(user, 'cloud_test', controller.signal);
  const assertion = expect(first).rejects.toThrow('Cancelled');
  await Promise.resolve(); await Promise.resolve(); controller.abort(new Error('Cancelled'));
  await assertion;
  vi.stubGlobal('fetch', normalFetch);
  expect((await readCloudProject(user, 'cloud_test')).state.project.name).toBe('Film');
});

it('times out even if restoring the auth token hangs', async () => {
  vi.useFakeTimers(); user.getIdToken.mockImplementation(() => new Promise(() => {}));
  const assertion = expect(readCloudProject(user, 'cloud_test')).rejects.toThrow('too long');
  await vi.advanceTimersByTimeAsync(25_000); await assertion;
  expect(requests).toHaveLength(0);
});
