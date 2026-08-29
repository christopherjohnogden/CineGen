import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function removeInstalledAdapter() {
  Reflect.deleteProperty(window, 'electronAPI');
}

describe('browser Electron adapter installation', () => {
  beforeEach(() => {
    vi.resetModules();
    removeInstalledAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    removeInstalledAdapter();
  });

  it('installs the adapter and sends project calls through the mocked RPC server', async () => {
    const projects = [{
      id: 'project-42',
      name: 'Browser project',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
      useSqlite: true,
    }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true, result: projects }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');

    expect(window.electronAPI).toBe(browserElectronAPI);
    await expect(window.electronAPI.project.list()).resolves.toEqual(projects);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rpc/project/list');
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(request.body))).toEqual({ args: [] });
  });

  it('sends same-origin browser media back as a server media reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true, result: { url: '/ok' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    await browserElectronAPI.elements.uploadMediaSource(
      `${window.location.origin}/media/projects/project-1/imported/asset-1/video.mp4`,
      'test-key',
    );

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rpc/elements/uploadMediaSource');
    expect(JSON.parse(String(request.body))).toEqual({
      args: ['/media/projects/project-1/imported/asset-1/video.mp4', 'test-key'],
    });
  });

  it('routes OpenAI Realtime session creation through the web server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true, result: { sdp: 'answer-sdp' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    await expect(browserElectronAPI.llm.openaiRealtimeSession({
      apiKey: 'sk-test',
      sdp: 'offer-sdp',
      voice: 'cedar',
    })).resolves.toEqual({ sdp: 'answer-sdp' });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rpc/llm/openaiRealtimeSession');
    expect(JSON.parse(String(request.body))).toEqual({
      args: [{ apiKey: 'sk-test', sdp: 'offer-sdp', voice: 'cedar' }],
    });
  });

  it('routes computer-installed CLI detection through the localhost companion', async () => {
    const providers = [
      { id: 'claude-code', installed: true, path: '/Users/artist/.local/bin/claude' },
      { id: 'codex', installed: true, path: '/Users/artist/.local/bin/codex' },
      { id: 'gemini', installed: true, path: '/Users/artist/.local/bin/gemini' },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true, result: { providers } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    await expect(browserElectronAPI.llm.cliDetect()).resolves.toEqual({ providers });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8787/api/rpc/llm/cliDetect');
  });

  it('falls back to the page server when the localhost companion is not running', async () => {
    const unavailable = {
      providers: [
        { id: 'claude-code', installed: false },
        { id: 'codex', installed: false },
        { id: 'gemini', installed: false },
      ],
    };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Connection refused'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ ok: true, result: unavailable }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    await expect(browserElectronAPI.llm.cliDetect()).resolves.toEqual(unavailable);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/rpc/llm/cliDetect');
  });

  it('puts an outer deadline around a stalled RunPod session status check', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    const status = browserElectronAPI.pod.statusLtx25({
      runpodKey: 'rp-key',
      podId: 'pod-1',
      podUrl: 'https://pod-1-8000.proxy.runpod.net',
      podAuthToken: 'pod-token',
    });
    const rejected = expect(status).rejects.toMatchObject({ code: 'RPC_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rpc/pod/statusLtx25');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('opens Artlist OAuth and waits for the server-side connection', async () => {
    vi.useFakeTimers();
    const popup = {
      closed: false,
      close: vi.fn(function close(this: { closed: boolean }) { this.closed = true; }),
      document: { title: '' },
      location: { replace: vi.fn() },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          ok: true,
          result: {
            connected: false,
            configured: true,
            authorizationUrl: 'https://auth.artlist.io/authorize?client_id=cinegen',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ ok: true, result: { connected: true, configured: true } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    const connectedPromise = browserElectronAPI.artlist.authLogin();
    await vi.runAllTimersAsync();
    await expect(connectedPromise).resolves.toEqual({ connected: true, configured: true });
    expect(popup.location.replace).toHaveBeenCalledWith('https://auth.artlist.io/authorize?client_id=cinegen');
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      args: [window.location.origin],
    });
  });

  it('opens Higgsfield OAuth and waits for the server-side connection', async () => {
    vi.useFakeTimers();
    const popup = {
      closed: false,
      close: vi.fn(function close(this: { closed: boolean }) { this.closed = true; }),
      document: { title: '' },
      location: { replace: vi.fn() },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          ok: true,
          result: {
            connected: false,
            authorizationUrl: 'https://mcp.higgsfield.ai/oauth2/authorize?client_id=cinegen',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ ok: true, result: { connected: true } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    const connectedPromise = browserElectronAPI.higgsfield.authLogin();
    await vi.runAllTimersAsync();
    await expect(connectedPromise).resolves.toEqual({ connected: true });
    expect(popup.location.replace).toHaveBeenCalledWith('https://mcp.higgsfield.ai/oauth2/authorize?client_id=cinegen');
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      args: [window.location.origin],
    });
  });

  it('opens Topview OAuth and waits for the server-side connection', async () => {
    vi.useFakeTimers();
    const popup = {
      closed: false,
      close: vi.fn(function close(this: { closed: boolean }) { this.closed = true; }),
      document: { title: '' },
      location: { replace: vi.fn() },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          ok: true,
          result: {
            connected: false,
            configured: true,
            authorizationUrl: 'https://www.topview.ai/mcp_oauth/oauth/authorize?client_id=cinegen',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          ok: true,
          result: { connected: true, configured: true, email: 'artist@example.com' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { browserElectronAPI } = await import('../src/platform/install');
    const connectedPromise = browserElectronAPI.topview.authLogin();
    await vi.runAllTimersAsync();
    await expect(connectedPromise).resolves.toEqual({
      connected: true,
      configured: true,
      email: 'artist@example.com',
    });
    expect(popup.location.replace).toHaveBeenCalledWith(
      'https://www.topview.ai/mcp_oauth/oauth/authorize?client_id=cinegen',
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      args: [window.location.origin],
    });
  });

  it('keeps an adapter that was already installed', async () => {
    const existingAdapter = { marker: 'desktop-or-test-bridge' } as unknown as Window['electronAPI'];
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: existingAdapter,
      writable: true,
    });

    const { installBrowserElectronAPI } = await import('../src/platform/install');

    expect(installBrowserElectronAPI()).toBe(existingAdapter);
    expect(window.electronAPI).toBe(existingAdapter);
  });
});
