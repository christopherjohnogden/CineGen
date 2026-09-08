import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rewriteStudioPrompt } from '@/lib/studio/rewrite-client';
const auth = vi.hoisted(() => ({ getIdToken: vi.fn(async () => 'test-token') }));
vi.mock('@/lib/cloud/firebase', () => ({ waitForCloudAuth: vi.fn(async () => auth) }));
const request = { requestId: 'test-rewrite', kind: 'video' as const, text: 'Original prompt', feedback: 'Warmer light' };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); delete (window as any).electronAPI; vi.useRealTimers(); });
it('uses authenticated direct cloud requests even when the browser compatibility bridge is installed', async () => {
  (window as any).electronAPI = { project: {} };
  fetchMock.mockResolvedValue(Response.json({ ok: true, result: { status: 'complete', text: 'Rewritten prompt' } }));
  expect(await rewriteStudioPrompt(request, new AbortController().signal)).toBe('Rewritten prompt');
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toContain('/api/rpc/prompts/rewrite');
  expect(options.headers['x-cinegen-id-token']).toBe('test-token');
  expect(JSON.parse(options.body)).toEqual({ args: [request] });
});
it('uses the native bridge on Mac', async () => {
  const rewrite = vi.fn(async () => ({ status: 'complete', text: 'Mac prompt' }));
  (window as any).electronAPI = { prompts: { rewrite } };
  expect(await rewriteStudioPrompt(request, new AbortController().signal)).toBe('Mac prompt');
  expect(rewrite).toHaveBeenCalledWith(request, 'test-token');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('recovers running rewrites using the identical request ID and marks terminal errors', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: { status: 'running' } }))
    .mockResolvedValueOnce(Response.json({ ok: true, result: { status: 'complete', text: 'Recovered prompt' } }));
  const done = rewriteStudioPrompt(request, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(2100);
  expect(await done).toBe('Recovered prompt');
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: { status: 'error', error: 'Could not rewrite' } }));
  await expect(rewriteStudioPrompt(request, new AbortController().signal)).rejects.toMatchObject({ rewriteFinished: true });
});
it('aborts a poll without issuing a new request', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(Response.json({ ok: true, result: { status: 'running' } }));
  const controller = new AbortController();
  const done = rewriteStudioPrompt(request, controller.signal);
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
