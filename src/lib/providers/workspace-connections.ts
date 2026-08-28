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
  if (typeof window === 'undefined' || isDesktopRuntime()) return null;
  try {
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
  return providerRpc<WorkspaceProviderStatus>('save', { provider, secret });
}

export function removeWorkspaceProvider(provider: WorkspaceProviderId): Promise<WorkspaceProviderStatus> {
  return providerRpc<WorkspaceProviderStatus>('remove', { provider });
}
