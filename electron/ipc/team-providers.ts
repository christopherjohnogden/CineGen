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

const HOSTED_RPC_TARGET: RpcTarget = { origin: HOSTED_WORKSPACE_ORIGIN, source: 'hosted' };
const LOCAL_RPC_TARGET: RpcTarget = { origin: LOCAL_WORKSPACE_ORIGIN, source: 'local-web' };

let activeTarget: RpcTarget | null = null;
let authWindow: BrowserWindow | null = null;
let authConnectionPromise: Promise<ProviderStatus> | null = null;

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
      // RPC payloads can contain provider credentials. Never forward their
      // request bodies through an unexpected redirect.
      redirect: 'error',
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
  if (activeTarget) {
    const status = await statusFor(activeTarget);
    if (status) return { target: activeTarget, status };
    activeTarget = null;
  }

  // A previously authenticated hosted workspace is authoritative. The local
  // browser workspace is a development/test fallback when the hosted session
  // has not been connected yet.
  const hostedStatus = await statusFor(HOSTED_RPC_TARGET);
  if (hostedStatus) {
    activeTarget = HOSTED_RPC_TARGET;
    return { target: HOSTED_RPC_TARGET, status: hostedStatus };
  }
  const localStatus = await statusFor(LOCAL_RPC_TARGET);
  if (localStatus) {
    activeTarget = LOCAL_RPC_TARGET;
    return { target: LOCAL_RPC_TARGET, status: localStatus };
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

async function shareDesktopTopviewConnection(): Promise<{
  connected: boolean;
  configured: boolean;
  shared: boolean;
}> {
  const connection = await exportTopviewTeamConnection();
  if (!connection || !('client' in connection)) {
    throw new Error('Connect Topview MCP in CineGen Desktop before sharing it with the team.');
  }
  let resolved = await resolveTarget();
  if (!resolved || resolved.target.source !== 'hosted') {
    // Sharing is a desktop-to-hosted action. If this Mac has only discovered
    // localhost (or no workspace at all), start the hosted team sign-in here
    // instead of sending the user hunting for a second prerequisite button.
    const hostedStatus = await connectHostedWorkspace();
    if (hostedStatus.desktop?.connected && hostedStatus.desktop.source === 'hosted') {
      resolved = { target: HOSTED_RPC_TARGET, status: hostedStatus };
    }
  }
  if (!resolved || resolved.target.source !== 'hosted') {
    throw new Error('CineGen team sign-in was not completed. Sign in in the window that opened, then choose Share MCP with team again.');
  }
  const { response, payload } = await rpcFetch<{
    connected: boolean;
    configured: boolean;
    shared: boolean;
  }>(resolved.target, 'topview', 'importTeamConnection', [connection]);
  if (!response.ok || !payload?.ok || !payload.result) {
    throw new Error(payload?.error?.message || `Topview MCP could not be shared (${response.status}).`);
  }
  return payload.result;
}

export async function invokeSharedOpenAi(params: Record<string, unknown>): Promise<unknown> {
  return invokeTeamRpc('llm', 'openaiChat', [{ ...params, apiKey: TEAM_PROVIDER_SENTINEL }]);
}

async function connectHostedWorkspace(): Promise<ProviderStatus> {
  const existing = await statusFor(HOSTED_RPC_TARGET);
  if (existing) {
    activeTarget = HOSTED_RPC_TARGET;
    return existing;
  }

  if (authConnectionPromise) {
    if (authWindow && !authWindow.isDestroyed()) authWindow.focus();
    return authConnectionPromise;
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
  const connectionPromise = new Promise<ProviderStatus>((resolve, reject) => {
    let settled = false;
    let checking = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      pollTimer = null;
      timeoutTimer = null;
    };
    const finish = (value: ProviderStatus) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause);
    };
    const check = async () => {
      if (checking || settled) return;
      checking = true;
      try {
        const next = await statusFor(HOSTED_RPC_TARGET);
        if (settled) return;
        if (!next) return;
        activeTarget = HOSTED_RPC_TARGET;
        finish(next);
        if (!window.isDestroyed()) window.close();
      } finally {
        checking = false;
      }
    };
    window.webContents.on('did-finish-load', () => void check());
    window.on('closed', () => {
      if (authWindow === window) authWindow = null;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (settled) return;
      // A user can close the window immediately after ChatGPT accepts the
      // sign-in. Let any in-flight probe finish, then make one final serialized
      // check so a just-committed cookie is not mistaken for cancellation.
      void (async () => {
        while (checking && !settled) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (settled) return;
        await check();
        if (!settled) finish(emptyStatus());
      })();
    });
    // OAuth may finish in a child window and cookie persistence can land just
    // after the final navigation event. Poll serially so either path completes
    // without racing overlapping network checks.
    pollTimer = setInterval(() => void check(), 1_000);
    timeoutTimer = setTimeout(() => {
      finish(emptyStatus());
      if (!window.isDestroyed()) window.close();
    }, 10 * 60 * 1_000);
    window.loadURL(signInUrl).catch((cause) => {
      fail(cause);
      if (!window.isDestroyed()) window.close();
    });
  });
  authConnectionPromise = connectionPromise;
  try {
    return await connectionPromise;
  } finally {
    if (authConnectionPromise === connectionPromise) authConnectionPromise = null;
  }
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
    return emptyStatus();
  });
  ipcMain.handle('team-providers:save', async (_event, value: unknown) => {
    return mutateTeamProvider('save', value);
  });
  ipcMain.handle('team-providers:remove', async (_event, value: unknown) => {
    return mutateTeamProvider('remove', value);
  });
  ipcMain.handle('team-providers:share-topview', () => shareDesktopTopviewConnection());
}
