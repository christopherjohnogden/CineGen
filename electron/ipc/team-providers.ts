import { BrowserWindow, ipcMain, session } from 'electron';
import { exportTopviewTeamConnection } from './topview.js';

const LOCAL_WORKSPACE_ORIGIN = 'http://localhost:3000';
const HOSTED_WORKSPACE_ORIGIN = 'https://cinegen-cloud-studio.cogden.chatgpt.site';
const TEAM_SESSION_PARTITION = 'persist:cinegen-team-workspace';
const REQUEST_TIMEOUT_MS = 8_000;

export const TEAM_PROVIDER_SENTINEL = '__CINEGEN_TEAM_PROVIDER__';

type ProviderId = 'fal' | 'openai' | 'kie' | 'runpod' | 'huggingface';

type ProviderStatus = {
  supported: boolean;
  scope: 'workspace';
  providers: Array<{ id: ProviderId; connected: boolean; updatedAt?: string }>;
  desktop?: {
    connected: boolean;
    requiresLogin: boolean;
    source: 'hosted' | 'local-web' | 'none';
    label: string;
  };
};

type RpcEnvelope<T> = {
  ok: boolean;
  result?: T;
  error?: { message?: string; code?: string };
};

type RpcTarget = {
  origin: string;
  source: 'hosted' | 'local-web';
};

let activeTarget: RpcTarget | null = null;
let authWindow: BrowserWindow | null = null;
let lastTopviewSyncAttempt = 0;

async function synchronizeTopviewConnection(target: RpcTarget): Promise<void> {
  if (target.source !== 'hosted' || Date.now() - lastTopviewSyncAttempt < 5_000) return;
  lastTopviewSyncAttempt = Date.now();
  try {
    const connection = await exportTopviewTeamConnection();
    if (!connection) return;
    const current = await rpcFetch<{ connected: boolean }>(target, 'topview', 'connectionStatus', []);
    if (current.response.ok && current.payload?.ok && current.payload.result?.connected) return;
    const imported = await rpcFetch<{ connected: boolean }>(target, 'topview', 'importTeamConnection', [connection]);
    if (!imported.response.ok || !imported.payload?.ok || !imported.payload.result?.connected) {
      throw new Error(imported.payload?.error?.message || 'The hosted workspace rejected the Topview connection.');
    }
  } catch (error) {
    console.warn('Could not share the desktop Topview connection with the team workspace.', error);
  }
}

function emptyStatus(): ProviderStatus {
  return {
    supported: true,
    scope: 'workspace',
    providers: (['fal', 'openai', 'kie', 'runpod', 'huggingface'] as ProviderId[]).map((id) => ({
      id,
      connected: false,
    })),
    desktop: {
      connected: false,
      requiresLogin: true,
      source: 'none',
      label: 'Connect the hosted team workspace',
    },
  };
}

async function responsePayload<T>(response: Response): Promise<RpcEnvelope<T> | null> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    return await response.json() as RpcEnvelope<T>;
  } catch {
    return null;
  }
}

async function rpcFetch<T>(
  target: RpcTarget,
  namespace: string,
  method: string,
  args: unknown[],
): Promise<{ response: Response; payload: RpcEnvelope<T> | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${target.origin}/api/rpc/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
      credentials: 'include',
      signal: controller.signal,
    };
    const response = target.source === 'hosted'
      ? await session.fromPartition(TEAM_SESSION_PARTITION).fetch(url, init)
      : await fetch(url, init);
    return { response, payload: await responsePayload<T>(response) };
  } finally {
    clearTimeout(timeout);
  }
}

function decorateStatus(status: ProviderStatus, target: RpcTarget): ProviderStatus {
  return {
    ...status,
    desktop: {
      connected: true,
      requiresLogin: false,
      source: target.source,
      label: target.source === 'hosted' ? 'Hosted team workspace' : 'Local browser workspace',
    },
  };
}

async function statusFor(target: RpcTarget): Promise<ProviderStatus | null> {
  try {
    const { response, payload } = await rpcFetch<ProviderStatus>(target, 'providers', 'status', []);
    if (!response.ok || !payload?.ok || !payload.result) return null;
    return decorateStatus(payload.result, target);
  } catch {
    return null;
  }
}

async function resolveTarget(): Promise<{ target: RpcTarget; status: ProviderStatus } | null> {
  const hosted: RpcTarget = { origin: HOSTED_WORKSPACE_ORIGIN, source: 'hosted' };
  const local: RpcTarget = { origin: LOCAL_WORKSPACE_ORIGIN, source: 'local-web' };

  if (activeTarget) {
    const status = await statusFor(activeTarget);
    if (status) {
      await synchronizeTopviewConnection(activeTarget);
      return { target: activeTarget, status };
    }
    activeTarget = null;
  }

  // A previously authenticated hosted workspace is authoritative. The local
  // browser workspace is a development/test fallback when the hosted session
  // has not been connected yet.
  const hostedStatus = await statusFor(hosted);
  if (hostedStatus) {
    activeTarget = hosted;
    await synchronizeTopviewConnection(hosted);
    return { target: hosted, status: hostedStatus };
  }
  const localStatus = await statusFor(local);
  if (localStatus) {
    activeTarget = local;
    return { target: local, status: localStatus };
  }
  return null;
}

async function invokeTeamRpc<T>(namespace: string, method: string, args: unknown[]): Promise<T> {
  const resolved = await resolveTarget();
  if (!resolved) {
    throw new Error('Connect CineGen Desktop to the hosted team workspace in Settings first.');
  }
  const { response, payload } = await rpcFetch<T>(resolved.target, namespace, method, args);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `The team workspace request failed (${response.status}).`);
  }
  return payload.result as T;
}

async function mutateTeamProvider(method: 'save' | 'remove', value: unknown): Promise<ProviderStatus> {
  const resolved = await resolveTarget();
  if (!resolved) {
    throw new Error('Connect CineGen Desktop to the hosted team workspace in Settings first.');
  }
  const { response, payload } = await rpcFetch<ProviderStatus>(resolved.target, 'providers', method, [value]);
  if (!response.ok || !payload?.ok || !payload.result) {
    throw new Error(payload?.error?.message || `The team workspace request failed (${response.status}).`);
  }
  return decorateStatus(payload.result, resolved.target);
}

export async function invokeSharedOpenAi(params: Record<string, unknown>): Promise<unknown> {
  return invokeTeamRpc('llm', 'openaiChat', [{ ...params, apiKey: TEAM_PROVIDER_SENTINEL }]);
}

async function connectHostedWorkspace(): Promise<ProviderStatus> {
  const existing = await statusFor({ origin: HOSTED_WORKSPACE_ORIGIN, source: 'hosted' });
  if (existing) {
    activeTarget = { origin: HOSTED_WORKSPACE_ORIGIN, source: 'hosted' };
    await synchronizeTopviewConnection(activeTarget);
    return existing;
  }

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return emptyStatus();
  }

  const window = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 520,
    minHeight: 640,
    title: 'Connect CineGen Team Workspace',
    autoHideMenuBar: true,
    webPreferences: {
      partition: TEAM_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  authWindow = window;

  const signInUrl = `${HOSTED_WORKSPACE_ORIGIN}/signin-with-chatgpt?return_to=${encodeURIComponent('/')}`;
  const result = await new Promise<ProviderStatus>((resolve, reject) => {
    let settled = false;
    const finish = (value: ProviderStatus) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const check = async () => {
      const next = await statusFor({ origin: HOSTED_WORKSPACE_ORIGIN, source: 'hosted' });
      if (!next) return;
      activeTarget = { origin: HOSTED_WORKSPACE_ORIGIN, source: 'hosted' };
      await synchronizeTopviewConnection(activeTarget);
      finish(next);
      if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    };
    window.webContents.on('did-finish-load', () => void check());
    window.on('closed', () => {
      authWindow = null;
      if (!settled) finish(emptyStatus());
    });
    window.loadURL(signInUrl).catch(reject);
  });
  return result;
}

export function registerTeamProviderHandlers(): void {
  ipcMain.handle('team-providers:status', async () => {
    const resolved = await resolveTarget();
    return resolved?.status ?? emptyStatus();
  });
  ipcMain.handle('team-providers:connect', () => connectHostedWorkspace());
  ipcMain.handle('team-providers:disconnect', async () => {
    await session.fromPartition(TEAM_SESSION_PARTITION).clearStorageData({ storages: ['cookies'] });
    activeTarget = null;
    lastTopviewSyncAttempt = 0;
    return emptyStatus();
  });
  ipcMain.handle('team-providers:save', async (_event, value: unknown) => {
    return mutateTeamProvider('save', value);
  });
  ipcMain.handle('team-providers:remove', async (_event, value: unknown) => {
    return mutateTeamProvider('remove', value);
  });
}
