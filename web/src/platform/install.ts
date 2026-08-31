import type { ElectronAPI } from '../../../electron';
import { browserEvents } from './events';
import { getUploadReference, invokeRpc, invokeRpcAt, uploadFile } from './rpc';

type DialogOpenOptions = Parameters<ElectronAPI['dialog']['showOpen']>[0];
type DialogSaveOptions = Parameters<ElectronAPI['dialog']['showSave']>[0];
type PowerEvent = Parameters<Parameters<ElectronAPI['app']['onPowerEvent']>[0]>[0];

interface WebSyncAPI {
  computeOffset: (params: unknown) => Promise<unknown>;
  batchMatch: (params: unknown) => Promise<unknown>;
  onBatchProgress: (callback: (data: unknown) => void) => () => void;
}

export type BrowserElectronAPI = ElectronAPI & { sync: WebSyncAPI };

const browserObjectUrls = new WeakMap<File, string>();
const RUNPOD_STATUS_RPC_TIMEOUT_MS = 30_000;
const LOCAL_COMPANION_ORIGIN = 'http://127.0.0.1:8787';

function rpc<T>(namespace: string, method: string, ...args: unknown[]): Promise<T> {
  return invokeRpc<T>(namespace, method, args);
}

function isLocalBrowserPage(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'http:'
    && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
}

async function localCliRpc<T>(method: string, ...args: unknown[]): Promise<T> {
  if (!isLocalBrowserPage()) return rpc<T>('llm', method, ...args);
  try {
    return await invokeRpcAt<T>(LOCAL_COMPANION_ORIGIN, 'llm', method, args);
  } catch {
    // Keep localhost usable when the optional companion is not running. The
    // page's own server will return its normal unavailable state or error.
    return rpc<T>('llm', method, ...args);
  }
}

type ArtlistStatus = Awaited<ReturnType<ElectronAPI['artlist']['accountStatus']>>;
type HiggsfieldStatus = Awaited<ReturnType<ElectronAPI['higgsfield']['accountStatus']>>;
type TopviewStatus = Awaited<ReturnType<ElectronAPI['topview']['accountStatus']>>;

async function connectHiggsfieldInBrowser(): Promise<HiggsfieldStatus> {
  const popup = window.open('about:blank', 'cinegen-higgsfield-oauth', 'popup,width=560,height=760');
  if (!popup) throw new Error('Allow pop-ups for CineGen, then try Connect Higgsfield again.');

  try {
    popup.document.title = 'Connecting Higgsfield…';
    const started = await rpc<HiggsfieldStatus & { authorizationUrl?: string }>(
      'higgsfield',
      'authLogin',
      window.location.origin,
    );
    if (!started.authorizationUrl) throw new Error(started.error || 'Higgsfield did not return an authorization link.');
    popup.location.replace(started.authorizationUrl);

    const deadline = Date.now() + 3 * 60 * 1000;
    let closedAt = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const status = await rpc<HiggsfieldStatus>('higgsfield', 'accountStatus');
      if (status.connected) return status;
      if (popup.closed) {
        if (!closedAt) closedAt = Date.now();
        if (Date.now() - closedAt > 5000) {
          throw new Error(status.error || 'Higgsfield authorization was not completed.');
        }
      }
    }
    throw new Error('Higgsfield sign-in timed out. Try connecting again.');
  } catch (error) {
    if (!popup.closed) popup.close();
    throw error;
  }
}

async function connectArtlistInBrowser(): Promise<ArtlistStatus> {
  // Open synchronously from the button click so browsers do not block the
  // authorization window while CineGen prepares PKCE on the server.
  const popup = window.open('about:blank', 'cinegen-artlist-oauth', 'popup,width=560,height=760');
  if (!popup) throw new Error('Allow pop-ups for CineGen, then try Connect Artlist again.');

  try {
    popup.document.title = 'Connecting Artlist…';
    const started = await rpc<ArtlistStatus & { authorizationUrl?: string }>(
      'artlist',
      'authLogin',
      window.location.origin,
    );
    if (!started.authorizationUrl) throw new Error(started.error || 'Artlist did not return an authorization link.');
    popup.location.replace(started.authorizationUrl);

    const deadline = Date.now() + 3 * 60 * 1000;
    let closedAt = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const status = await rpc<ArtlistStatus>('artlist', 'accountStatus');
      if (status.connected) return status;
      if (popup.closed) {
        if (!closedAt) closedAt = Date.now();
        if (Date.now() - closedAt > 5000) {
          throw new Error(status.error || 'Artlist authorization was not completed.');
        }
      }
    }
    throw new Error('Artlist sign-in timed out. Try connecting again.');
  } catch (error) {
    if (!popup.closed) popup.close();
    throw error;
  }
}

async function connectTopviewInBrowser(): Promise<TopviewStatus> {
  if (!isLocalBrowserPage()) {
    throw new Error(
      'Topview MCP is shared from CineGen Desktop for this hosted workspace. '
      + 'On the owner\'s Mac, open Settings → Provider and choose Share MCP with team, then refresh this page.',
    );
  }
  // Open synchronously from the button click so browsers do not block the
  // authorization window while CineGen prepares DCR and PKCE on the server.
  const popup = window.open('about:blank', 'cinegen-topview-oauth', 'popup,width=560,height=760');
  if (!popup) throw new Error('Allow pop-ups for CineGen, then try Connect Topview again.');

  try {
    popup.document.title = 'Connecting Topview…';
    const started = await rpc<TopviewStatus & { authorizationUrl?: string }>(
      'topview',
      'authLogin',
      window.location.origin,
    );
    if (!started.authorizationUrl) throw new Error(started.error || 'Topview did not return an authorization link.');
    popup.location.replace(started.authorizationUrl);

    const deadline = Date.now() + 10 * 60 * 1000;
    let closedAt = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const status = await rpc<TopviewStatus>('topview', 'accountStatus');
      if (status.connected) {
        if (!popup.closed) popup.close();
        return status;
      }
      if (popup.closed) {
        if (!closedAt) closedAt = Date.now();
        if (Date.now() - closedAt > 5000) {
          throw new Error(status.error || 'Topview authorization was not completed.');
        }
      }
    }
    throw new Error('Topview sign-in timed out. Try connecting again.');
  } catch (error) {
    if (!popup.closed) popup.close();
    throw error;
  }
}

function acceptFromFilters(filters: NonNullable<DialogOpenOptions>['filters']): string {
  if (!Array.isArray(filters)) return '';
  const extensions = new Set<string>();
  for (const filter of filters) {
    if (!filter || !Array.isArray(filter.extensions)) continue;
    for (const extension of filter.extensions) {
      const normalized = extension.trim().replace(/^\.+/, '');
      if (normalized && normalized !== '*') extensions.add(`.${normalized}`);
    }
  }
  return [...extensions].join(',');
}

function selectBrowserFiles(options?: DialogOpenOptions): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.opacity = '0';
    input.tabIndex = -1;
    input.multiple = options?.properties?.includes('multiSelections') ?? false;

    const accept = acceptFromFilters(options?.filters);
    if (accept) input.accept = accept;
    if (options?.properties?.includes('openDirectory')) {
      input.setAttribute('webkitdirectory', '');
      input.multiple = true;
    }

    let settled = false;
    let lostFocus = false;
    const finish = (files: File[] | null) => {
      if (settled) return;
      settled = true;
      input.removeEventListener('change', handleChange);
      input.removeEventListener('cancel', handleCancel);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      input.remove();
      resolve(files);
    };
    const handleChange = () => {
      const files = Array.from(input.files ?? []);
      finish(files.length > 0 ? files : null);
    };
    const handleCancel = () => finish(null);
    const handleBlur = () => { lostFocus = true; };
    const handleFocus = () => {
      if (!lostFocus) return;
      // `change` fires just after focus returns in some Chromium releases.
      window.setTimeout(() => {
        if (!settled && (input.files?.length ?? 0) === 0) finish(null);
      }, 250);
    };

    input.addEventListener('change', handleChange);
    input.addEventListener('cancel', handleCancel);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.body.appendChild(input);
    input.click();
  });
}

async function showOpen(options?: DialogOpenOptions): Promise<string[] | string | null> {
  const files = await selectBrowserFiles(options);
  if (!files?.length) return null;

  const references = await Promise.all(files.map(async (file) => {
    const result = await uploadFile(file, {
      name: file.name,
      type: file.type,
      purpose: 'dialog',
      relativePath: file.webkitRelativePath || undefined,
    });
    return getUploadReference(result, 'path');
  }));

  return options?.properties?.includes('multiSelections') || options?.properties?.includes('openDirectory')
    ? references
    : references[0] ?? null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || 'cinegen-export';
}

async function showSave(options?: DialogSaveOptions): Promise<string | null> {
  // Browsers choose the final destination when the completed export is
  // downloaded. Return a safe suggested server filename in place of a native
  // filesystem path; shell.openPath performs the eventual download.
  let fileName = basename(options?.defaultPath || 'cinegen-export');
  if (!/\.[a-z0-9]+$/i.test(fileName)) {
    const extension = options?.filters?.[0]?.extensions?.[0]?.replace(/^\.+/, '');
    if (extension && extension !== '*') fileName += `.${extension}`;
  }
  return fileName;
}

function getPathForFile(file: File): string {
  const existing = browserObjectUrls.get(file);
  if (existing) return existing;
  const url = URL.createObjectURL(file);
  browserObjectUrls.set(file, url);
  return url;
}

async function openDownload(path: string): Promise<string> {
  try {
    const url = new URL(path, window.location.href);
    if (!['http:', 'https:', 'blob:'].includes(url.protocol)) {
      return `Unsupported download URL protocol: ${url.protocol}`;
    }

    const anchor = document.createElement('a');
    anchor.href = url.href;
    anchor.download = basename(decodeURIComponent(url.pathname)) || 'cinegen-export';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : 'Unable to open the export.';
  }
}

function onPowerEvent(callback: (data: PowerEvent) => void): () => void {
  const unsubscribeServer = browserEvents.subscribe<PowerEvent>('app:power-event', callback);
  const handleVisibility = () => callback({ type: document.hidden ? 'suspend' : 'resume' });
  const handlePageHide = () => callback({ type: 'suspend' });
  const handlePageShow = () => callback({ type: 'resume' });

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);

  return () => {
    unsubscribeServer();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
  };
}

function subscribe<T>(eventName: string, callback: (data: T) => void): () => void {
  return browserEvents.subscribe(eventName, callback);
}

function withActiveProjectContext(params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params) || 'projectId' in params) return params;
  const projectId = new URLSearchParams(window.location.search).get('project');
  return projectId ? { ...params, projectId } : params;
}

type BrowserReadyImport = {
  assetId: string;
  jobId: string;
  filePath: string;
  type: 'video' | 'audio' | 'image';
  browserReady?: { fileSize?: number; contentType?: string };
};

const CLOUD_VIDEO_PLACEHOLDER = '/cinegen-cloud/video-placeholder.svg';
const CLOUD_WAVEFORM_PLACEHOLDER = '/cinegen-cloud/empty-waveform.json';

function dispatchBrowserReadyImport(entry: BrowserReadyImport): void {
  if (!entry.browserReady) return;
  window.setTimeout(() => {
    browserEvents.dispatch('media:job-complete', {
      jobId: entry.jobId,
      assetId: entry.assetId,
      jobType: 'extract_metadata',
      result: {
        duration: entry.type === 'image' ? 0 : 5,
        fileSize: entry.browserReady?.fileSize,
        codec: entry.browserReady?.contentType,
      },
    });
    if (entry.type !== 'audio') {
      browserEvents.dispatch('media:job-complete', {
        jobId: `${entry.jobId}-thumbnail`,
        assetId: entry.assetId,
        jobType: 'generate_thumbnail',
        result: {
          outputPath: entry.type === 'image' ? entry.filePath : CLOUD_VIDEO_PLACEHOLDER,
        },
      });
    }
    if (entry.type === 'audio' || entry.type === 'video') {
      browserEvents.dispatch('media:job-complete', {
        jobId: `${entry.jobId}-waveform`,
        assetId: entry.assetId,
        jobType: 'compute_waveform',
        result: { peaks: [0], peaksPath: CLOUD_WAVEFORM_PLACEHOLDER },
      });
    }
    if (entry.type === 'video') {
      browserEvents.dispatch('media:job-complete', {
        jobId: `${entry.jobId}-filmstrip`,
        assetId: entry.assetId,
        jobType: 'generate_filmstrip',
        result: { frames: [CLOUD_VIDEO_PLACEHOLDER] },
      });
      browserEvents.dispatch('media:job-complete', {
        jobId: `${entry.jobId}-proxy`,
        assetId: entry.assetId,
        jobType: 'generate_proxy',
        result: { outputPath: entry.filePath },
      });
    }
  }, 0);
}

function dispatchBrowserReadyProcessing(result: unknown): void {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return;
  const ready = result as Record<string, unknown>;
  if (ready.browserReady !== true || typeof ready.assetId !== 'string') return;
  const assetId = ready.assetId;
  const jobId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.setTimeout(() => {
    if (ready.includeThumbnail === true) {
      browserEvents.dispatch('media:job-complete', {
        jobId: `${jobId}-thumbnail`, assetId, jobType: 'generate_thumbnail',
        result: { outputPath: CLOUD_VIDEO_PLACEHOLDER },
      });
    }
    if (ready.includeWaveform !== false) {
      browserEvents.dispatch('media:job-complete', {
        jobId: `${jobId}-waveform`, assetId, jobType: 'compute_waveform',
        result: { peaks: [0], peaksPath: CLOUD_WAVEFORM_PLACEHOLDER },
      });
    }
    if (ready.includeFilmstrip !== false) {
      browserEvents.dispatch('media:job-complete', {
        jobId: `${jobId}-filmstrip`, assetId, jobType: 'generate_filmstrip',
        result: { frames: [CLOUD_VIDEO_PLACEHOLDER] },
      });
    }
    if (ready.needsProxy === true && typeof ready.inputPath === 'string') {
      browserEvents.dispatch('media:job-complete', {
        jobId: `${jobId}-proxy`, assetId, jobType: 'generate_proxy',
        result: { outputPath: ready.inputPath },
      });
    }
  }, 0);
}

export const browserElectronAPI: BrowserElectronAPI = {
  project: {
    list: () => rpc('project', 'list'),
    create: (name) => rpc('project', 'create', name),
    load: (id) => rpc('project', 'load', id),
    save: (id, data) => rpc('project', 'save', id, data),
    delete: (id) => rpc('project', 'delete', id),
  },
  workflow: {
    run: (params) => rpc('workflow', 'run', params),
    pollJob: (id) => rpc('workflow', 'pollJob', id),
  },
  pod: {
    start: (params) => rpc('pod', 'start', params),
    stop: (params) => rpc('pod', 'stop', params),
    status: (params) => invokeRpc('pod', 'status', [params], { timeoutMs: RUNPOD_STATUS_RPC_TIMEOUT_MS }),
    setupLtx25: (params) => rpc('pod', 'setupLtx25', params),
    statusLtx25: (params) => invokeRpc('pod', 'statusLtx25', [params], { timeoutMs: RUNPOD_STATUS_RPC_TIMEOUT_MS }),
    terminateLtx25: (params) => rpc('pod', 'terminateLtx25', params),
    generateLtx25: (params) => rpc('pod', 'generateLtx25', params),
    generateSessionImage: (params) => rpc('pod', 'generateSessionImage', params),
  },
  export: {
    start: (params) => rpc('export', 'start', params),
    poll: (id) => rpc('export', 'poll', id),
    cancel: (id) => rpc('export', 'cancel', id),
    onProgress: (callback) => subscribe('export:progress', callback),
  },
  elements: {
    upload: async (fileData, apiKey) => {
      const file = new Blob([fileData.buffer], { type: fileData.type || 'application/octet-stream' });
      const result = await uploadFile(file, {
        name: fileData.name,
        type: fileData.type,
        apiKey,
        purpose: 'elements',
      });
      return { url: getUploadReference(result, 'url') };
    },
    uploadTranscriptionSource: (sourceUrl, apiKey) => (
      rpc('elements', 'uploadTranscriptionSource', sourceUrl, apiKey)
    ),
    uploadMediaSource: (sourceUrl, apiKey) => (
      rpc('elements', 'uploadMediaSource', sourceUrl, apiKey)
    ),
    loadLibrary: (opts) => rpc('elements', 'loadLibrary', opts),
    saveLibrary: (library) => rpc('elements', 'saveLibrary', library),
  },
  music: {
    generatePrompt: (params) => rpc('music', 'generatePrompt', params),
  },
  llm: {
    chat: (params) => rpc('llm', 'chat', params),
    localChat: (params) => rpc('llm', 'localChat', params),
    localModels: () => rpc('llm', 'localModels'),
    onLocalStream: (callback) => subscribe('llm:local-stream', callback),
    runCutWorkflow: (params) => rpc('llm', 'runCutWorkflow', params),
    claudeCodeDetect: () => rpc('llm', 'claudeCodeDetect'),
    cliDetect: () => localCliRpc('cliDetect'),
    claudeCodeChat: (params) => localCliRpc('claudeCodeChat', params),
    codexChat: (params) => localCliRpc('codexChat', params),
    geminiChat: (params) => localCliRpc('geminiChat', params),
    openaiChat: (params) => rpc('llm', 'openaiChat', params),
    openaiRealtimeSession: (params) => rpc('llm', 'openaiRealtimeSession', params),
    claudeCodeCancel: (requestId) => localCliRpc('claudeCodeCancel', requestId),
    codexCancel: (requestId) => localCliRpc('codexCancel', requestId),
    geminiCancel: (requestId) => localCliRpc('geminiCancel', requestId),
    onClaudeCodeStream: (callback) => subscribe('llm:claude-code-stream', callback),
    onCodexStream: (callback) => subscribe('llm:codex-stream', callback),
    onGeminiStream: (callback) => subscribe('llm:gemini-stream', callback),
  },
  vision: {
    indexAsset: (params) => rpc('vision', 'indexAsset', params),
    detectObjects: (params) => rpc('vision', 'detectObjects', params),
  },
  acoustic: {
    analyzeAsset: (params) => rpc('acoustic', 'analyzeAsset', params),
  },
  higgsfield: {
    accountStatus: () => rpc('higgsfield', 'accountStatus'),
    authLogin: connectHiggsfieldInBrowser,
    authLogout: () => rpc('higgsfield', 'authLogout'),
    quickEdit: (params) => rpc('higgsfield', 'quickEdit', params),
    generate: (params) => rpc('higgsfield', 'generate', params),
    generateList: (params) => rpc('higgsfield', 'generateList', params),
  },
  artlist: {
    accountStatus: () => rpc('artlist', 'accountStatus'),
    authLogin: connectArtlistInBrowser,
    authLogout: () => rpc('artlist', 'authLogout'),
    generate: (params) => rpc('artlist', 'generate', params),
  },
  topview: {
    accountStatus: () => rpc('topview', 'accountStatus'),
    modelCatalog: () => rpc('topview', 'modelCatalog'),
    authLogin: connectTopviewInBrowser,
    authLogout: () => rpc('topview', 'authLogout'),
    submit: (params) => rpc('topview', 'submit', params),
    query: (params) => rpc('topview', 'query', params),
    recoverVideo: (params) => rpc('topview', 'recoverVideo', params),
    generate: (params) => rpc('topview', 'generate', params),
    generateImage: (params) => rpc('topview', 'generateImage', params),
    generateAudio: (params) => rpc('topview', 'generateAudio', params),
  },
  teamProviders: {
    status: async () => { throw new Error('Browser workspaces access team providers directly.'); },
    connect: async () => { throw new Error('Browser workspaces access team providers directly.'); },
    disconnect: async () => { throw new Error('Browser workspaces access team providers directly.'); },
    save: async () => { throw new Error('Browser workspaces access team providers directly.'); },
    remove: async () => { throw new Error('Browser workspaces access team providers directly.'); },
  },
  copilot: {
    analyzeVisualRefs: (params) => rpc('copilot', 'analyzeVisualRefs', params),
  },
  dialog: {
    showSave,
    showOpen,
  },
  file: {
    getPathForFile,
  },
  shell: {
    openPath: openDownload,
  },
  pm: {
    openProject: async (id, useSqlite) => {
      browserEvents.dispatch('pm:open-project', { id, useSqlite });
      return { ok: true };
    },
    open: async () => ({ ok: true }),
    onOpenProject: (callback) => subscribe<unknown>('pm:open-project', (payload) => {
      if (Array.isArray(payload)) {
        callback(String(payload[0] ?? ''), Boolean(payload[1]));
        return;
      }
      if (typeof payload === 'object' && payload !== null) {
        const data = payload as { id?: unknown; useSqlite?: unknown };
        callback(String(data.id ?? ''), Boolean(data.useSqlite));
      }
    }),
  },
  db: {
    createProject: (name) => rpc('db', 'createProject', name),
    loadProject: (id) => rpc('db', 'loadProject', id),
    saveProject: (id, state) => rpc('db', 'saveProject', id, state),
    deleteProject: (id) => rpc('db', 'deleteProject', id),
    closeProject: (id) => rpc('db', 'closeProject', id),
    updateProject: (id, data) => rpc('db', 'updateProject', id, data),
    insertAsset: (asset) => rpc('db', 'insertAsset', asset),
    updateAsset: (projectId, id, data) => rpc('db', 'updateAsset', projectId, id, data),
    deleteAsset: (projectId, id) => rpc('db', 'deleteAsset', projectId, id),
  },
  media: {
    import: async (params) => {
      const imported = await rpc<BrowserReadyImport[]>('media', 'import', params);
      for (const entry of imported) dispatchBrowserReadyImport(entry);
      return imported;
    },
    submitJob: (job) => rpc('media', 'submitJob', job),
    cancelJob: (jobId) => rpc('media', 'cancelJob', jobId),
    queueProcessing: async (params) => {
      const result = await rpc('media', 'queueProcessing', params);
      dispatchBrowserReadyProcessing(result);
    },
    onJobProgress: (callback) => subscribe('media:job-progress', callback),
    onJobComplete: (callback) => subscribe('media:job-complete', callback),
    onJobError: (callback) => subscribe('media:job-error', callback),
    extractFrame: (params) => rpc('media', 'extractFrame', params),
    writeTempImage: (params) => rpc('media', 'writeTempImage', params),
    extractClip: (params) => rpc('media', 'extractClip', params),
    downloadRemote: (params) => rpc('media', 'downloadRemote', params),
    persistGeneratedAsset: (params) => rpc('media', 'persistGeneratedAsset', params),
  },
  transcription: {
    start: (params) => rpc('transcription', 'start', params),
    get: (jobId) => rpc('transcription', 'get', jobId),
    onProgress: (callback) => subscribe('transcription:progress', callback),
  },
  sam3: {
    start: () => rpc('sam3', 'start'),
    stop: () => rpc('sam3', 'stop'),
    getPort: () => rpc('sam3', 'getPort'),
  },
  localModel: {
    run: (params) => rpc('localModel', 'run', withActiveProjectContext(params)),
    readTranscript: (transcriptPath) => rpc('localModel', 'readTranscript', transcriptPath),
    get: (jobId) => rpc('localModel', 'get', jobId),
    onProgress: (callback) => subscribe('local-model:progress', callback),
  },
  sync: {
    computeOffset: (params) => rpc('sync', 'computeOffset', params),
    batchMatch: (params) => rpc('sync', 'batchMatch', params),
    onBatchProgress: (callback) => subscribe('sync:batch-progress', callback),
  },
  app: {
    onPowerEvent,
  },
  nativeVideo: {
    isAvailable: async () => ({ available: false, error: null }),
    resetSurfaces: async () => false,
    createSurface: async () => false,
    setSurfaceRect: () => {},
    setSurfaceHidden: () => {},
    clearSurface: () => {},
    syncSurface: () => {},
    destroySurface: () => {},
  },
};

export function installBrowserElectronAPI(): BrowserElectronAPI {
  if (typeof window === 'undefined') return browserElectronAPI;
  if (!window.electronAPI) {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      enumerable: true,
      value: browserElectronAPI,
      writable: false,
    });
  }
  return window.electronAPI as BrowserElectronAPI;
}

installBrowserElectronAPI();
