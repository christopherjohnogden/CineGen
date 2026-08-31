import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectWorkspaceProviders,
  getWorkspaceProviderStatus,
  removeWorkspaceProvider,
  saveWorkspaceProvider,
  type WorkspaceProviderStatus,
} from '@/lib/providers/workspace-connections';

const connectedStatus: WorkspaceProviderStatus = {
  supported: true,
  scope: 'workspace',
  providers: [
    { id: 'fal', connected: false },
    { id: 'openai', connected: true, updatedAt: '2026-08-28T14:56:34.171Z' },
    { id: 'kie', connected: false },
    { id: 'runpod', connected: false },
    { id: 'huggingface', connected: false },
  ],
  desktop: {
    connected: true,
    requiresLogin: false,
    source: 'local-web',
    label: 'Local browser workspace',
  },
};

describe('desktop team provider bridge', () => {
  const originalElectronApi = window.electronAPI;
  const originalUserAgent = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
  const status = vi.fn(async () => connectedStatus);
  const connect = vi.fn(async () => connectedStatus);
  const save = vi.fn(async () => connectedStatus);
  const remove = vi.fn(async () => connectedStatus);

  beforeEach(() => {
    vi.clearAllMocks();
    // Production builds may mask Electron in their user agent. The native
    // bridge, rather than this string, must determine the runtime.
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 CineGen Desktop' });
    (window as Window & { electronAPI: typeof window.electronAPI }).electronAPI = {
      ...originalElectronApi,
      teamProviders: {
        status,
        connect,
        disconnect: vi.fn(async () => connectedStatus),
        save,
        remove,
        shareTopview: vi.fn(async () => ({ connected: true, configured: true, shared: true })),
      },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (window as Window & { electronAPI: typeof window.electronAPI }).electronAPI = originalElectronApi;
    if (originalUserAgent) Object.defineProperty(window.navigator, 'userAgent', originalUserAgent);
    else Reflect.deleteProperty(window.navigator, 'userAgent');
  });

  it('loads the shared status through Electron instead of returning device-only mode', async () => {
    await expect(getWorkspaceProviderStatus()).resolves.toEqual(connectedStatus);
    expect(status).toHaveBeenCalledOnce();
  });

  it('routes provider changes and hosted sign-in through the desktop bridge', async () => {
    await saveWorkspaceProvider('openai', 'sk-team-placeholder');
    await removeWorkspaceProvider('openai');
    await connectWorkspaceProviders();

    expect(save).toHaveBeenCalledWith({ provider: 'openai', secret: 'sk-team-placeholder' });
    expect(remove).toHaveBeenCalledWith({ provider: 'openai' });
    expect(connect).toHaveBeenCalledOnce();
  });

  it('keeps the browser compatibility shim on direct RPC when native sharing is absent', async () => {
    const browserTeamProviders = { ...window.electronAPI.teamProviders };
    delete browserTeamProviders.shareTopview;
    (window as Window & { electronAPI: typeof window.electronAPI }).electronAPI = {
      ...window.electronAPI,
      teamProviders: browserTeamProviders,
    };
    const fetchRpc = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: connectedStatus,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchRpc);

    await expect(getWorkspaceProviderStatus()).resolves.toEqual(connectedStatus);
    expect(status).not.toHaveBeenCalled();
    expect(fetchRpc).toHaveBeenCalledWith('/api/rpc/providers/status', expect.objectContaining({ method: 'POST' }));
  });
});
