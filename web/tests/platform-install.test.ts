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
