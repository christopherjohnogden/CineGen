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
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'CineGen Electron' });
    (window as Window & { electronAPI: typeof window.electronAPI }).electronAPI = {
      ...originalElectronApi,
      teamProviders: {
        status,
        connect,
        disconnect: vi.fn(async () => connectedStatus),
        save,
        remove,
      },
    };
  });

  afterEach(() => {
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
});
