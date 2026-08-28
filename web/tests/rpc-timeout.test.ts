import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridgeError, invokeRpc } from '../src/platform/rpc';

function okResponse(result: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ ok: true, result }),
  } as unknown as Response;
}

describe('browser RPC deadlines', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a stalled control-plane call at its outer deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = invokeRpc('pod', 'statusLtx25', [{}], { timeoutMs: 250 });
    const rejected = expect(request).rejects.toMatchObject({
      name: 'BrowserBridgeError',
      code: 'RPC_TIMEOUT',
    } satisfies Partial<BrowserBridgeError>);
    await vi.advanceTimersByTimeAsync(250);
    await rejected;

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('does not impose a global deadline on long-running generation RPCs', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
      expect(init?.signal).toBeUndefined();
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = invokeRpc<{ jobId: string }>('pod', 'generateLtx25', [{ input: { prompt: 'A long render' } }]);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    resolveFetch(okResponse({ jobId: 'job-1' }));

    await expect(request).resolves.toEqual({ jobId: 'job-1' });
  });
});
