export const TEAM_PROVIDER_SENTINEL = '__CINEGEN_TEAM_PROVIDER__';

export type WorkspaceProviderId = 'fal' | 'openai' | 'kie' | 'runpod' | 'huggingface';

export interface WorkspaceProviderStatus {
  supported: boolean;
  scope: 'workspace';
  providers: Array<{
    id: WorkspaceProviderId;
    connected: boolean;
    updatedAt?: string;
  }>;
  desktop?: {
    connected: boolean;
    requiresLogin: boolean;
    source: 'hosted' | 'local-web' | 'none';
    label: string;
  };
}

type RpcEnvelope<T> = {
  ok: boolean;
  result?: T;
  error?: { message?: string };
};

function isDesktopRuntime(): boolean {
  return typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
}

async function providerRpc<T>(method: 'status' | 'save' | 'remove', value?: unknown): Promise<T> {
  const response = await fetch(`/api/rpc/providers/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: value === undefined ? [] : [value] }),
  });
  const payload = await response.json() as RpcEnvelope<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || 'CineGen could not update the team provider connection.');
  }
  return payload.result as T;
}

export async function getWorkspaceProviderStatus(): Promise<WorkspaceProviderStatus | null> {
  if (typeof window === 'undefined') return null;
  try {
    if (isDesktopRuntime()) return await window.electronAPI.teamProviders.status();
    return await providerRpc<WorkspaceProviderStatus>('status');
  } catch {
    // The standalone local web server predates the team provider vault. In
    // that environment the existing device-only fields remain available.
    return null;
  }
}

export function saveWorkspaceProvider(
  provider: WorkspaceProviderId,
  secret: string,
): Promise<WorkspaceProviderStatus> {
  if (isDesktopRuntime()) return window.electronAPI.teamProviders.save({ provider, secret });
  return providerRpc<WorkspaceProviderStatus>('save', { provider, secret });
}

export function removeWorkspaceProvider(provider: WorkspaceProviderId): Promise<WorkspaceProviderStatus> {
  if (isDesktopRuntime()) return window.electronAPI.teamProviders.remove({ provider });
  return providerRpc<WorkspaceProviderStatus>('remove', { provider });
}

export function connectWorkspaceProviders(): Promise<WorkspaceProviderStatus> {
  if (!isDesktopRuntime()) return getWorkspaceProviderStatus().then((status) => {
    if (!status) throw new Error('The hosted team workspace is not available.');
    return status;
  });
  return window.electronAPI.teamProviders.connect();
}

export function disconnectWorkspaceProviders(): Promise<WorkspaceProviderStatus> {
  if (!isDesktopRuntime()) throw new Error('Sign out of the hosted site to disconnect this workspace.');
  return window.electronAPI.teamProviders.disconnect();
}
