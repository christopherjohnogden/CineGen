import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (name: string) => ipcRenderer.invoke('project:create', name),
    load: (id: string) => ipcRenderer.invoke('project:load', id),
    save: (id: string, data: unknown) => ipcRenderer.invoke('project:save', id, data),
    delete: (id: string) => ipcRenderer.invoke('project:delete', id),
  },
  workflow: {
    run: (params: unknown) => ipcRenderer.invoke('workflow:run', params),
    pollJob: (id: string) => ipcRenderer.invoke('workflow:poll-job', id),
  },
  pod: {
    start:  (params: { runpodKey: string; podId: string }) => ipcRenderer.invoke('pod:start', params),
    stop:   (params: { runpodKey: string; podId: string }) => ipcRenderer.invoke('pod:stop', params),
    status: (params: { runpodKey: string; podId: string }) => ipcRenderer.invoke('pod:status', params),
  },
  export: {
    start: (params: unknown) => ipcRenderer.invoke('export:start', params),
    poll: (id: string) => ipcRenderer.invoke('export:poll', id),
    cancel: (id: string) => ipcRenderer.invoke('export:cancel', id),
    onProgress: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('export:progress', handler);
      return () => ipcRenderer.removeListener('export:progress', handler);
    },
  },
  elements: {
    upload: (fileData: unknown, apiKey?: string) => ipcRenderer.invoke('elements:upload', fileData, apiKey),
    uploadTranscriptionSource: (sourceUrl: string, apiKey?: string) => ipcRenderer.invoke('elements:upload-transcription-source', sourceUrl, apiKey),
    uploadMediaSource: (sourceUrl: string, apiKey?: string) => ipcRenderer.invoke('elements:upload-media-source', sourceUrl, apiKey),
  },
  music: {
    generatePrompt: (params: unknown) => ipcRenderer.invoke('music:generate-prompt', params),
  },
  llm: {
    chat: (params: unknown) => ipcRenderer.invoke('llm:chat', params),
    localChat: (params: unknown) => ipcRenderer.invoke('llm:local-chat', params),
    localModels: () => ipcRenderer.invoke('llm:local-models'),
    onLocalStream: (cb: (data: { requestId: string; token?: string; done?: boolean }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: { requestId: string; token?: string; done?: boolean }) => cb(d);
      ipcRenderer.on('llm:local-stream', handler);
      return () => ipcRenderer.removeListener('llm:local-stream', handler);
    },
    runCutWorkflow: (params: unknown) => ipcRenderer.invoke('llm:run-cut-workflow', params),
  },
  vision: {
    indexAsset: (params: unknown) => ipcRenderer.invoke('vision:index-asset', params),
    detectObjects: (params: unknown) => ipcRenderer.invoke('vision:detect-objects', params),
  },
  dialog: {
    showSave: (options?: unknown) => ipcRenderer.invoke('dialog:show-save', options),
    showOpen: (options?: unknown) => ipcRenderer.invoke('dialog:show-open', options),
  },
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:open-path', filePath),
  },
  db: {
    createProject: (name: string) => ipcRenderer.invoke('db:project:create', name),
    loadProject: (id: string) => ipcRenderer.invoke('db:project:load', id),
    saveProject: (id: string, state: unknown) => ipcRenderer.invoke('db:project:save', id, state),
    deleteProject: (id: string) => ipcRenderer.invoke('db:project:delete', id),
    closeProject: (id: string) => ipcRenderer.invoke('db:project:close', id),
    updateProject: (id: string, data: unknown) => ipcRenderer.invoke('db:project:update', id, data),
    insertAsset: (asset: unknown) => ipcRenderer.invoke('db:asset:insert', asset),
    updateAsset: (projectId: string, id: string, data: unknown) => ipcRenderer.invoke('db:asset:update', projectId, id, data),
    deleteAsset: (projectId: string, id: string) => ipcRenderer.invoke('db:asset:delete', projectId, id),
  },
  media: {
    import: (params: unknown) => ipcRenderer.invoke('media:import', params),
    submitJob: (job: unknown) => ipcRenderer.invoke('media:submit-job', job),
    cancelJob: (jobId: string) => ipcRenderer.invoke('media:cancel-job', jobId),
    queueProcessing: (params: unknown) => ipcRenderer.invoke('media:queue-processing', params),
    extractFrame: (params: { inputPath: string; timeSec: number }) =>
      ipcRenderer.invoke('media:extract-frame', params),
    extractClip: (params: { inputPath: string; startTimeSec: number; durationSec: number }) =>
      ipcRenderer.invoke('media:extract-clip', params),
    downloadRemote: (params: { url: string; projectId: string; assetId: string; ext?: string }) =>
      ipcRenderer.invoke('media:download-remote', params),
    onJobProgress: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('media:job-progress', handler);
      return () => ipcRenderer.removeListener('media:job-progress', handler);
    },
    onJobComplete: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('media:job-complete', handler);
      return () => ipcRenderer.removeListener('media:job-complete', handler);
    },
    onJobError: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('media:job-error', handler);
      return () => ipcRenderer.removeListener('media:job-error', handler);
    },
  },
  pm: {
    openProject: (id: string, useSqlite: boolean) => ipcRenderer.invoke('pm:open-project', id, useSqlite),
    open: () => ipcRenderer.invoke('pm:open'),
    onOpenProject: (cb: (id: string, useSqlite: boolean) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, useSqlite: boolean) => cb(id, useSqlite);
      ipcRenderer.on('pm:open-project', handler);
      return () => ipcRenderer.removeListener('pm:open-project', handler);
    },
  },
  transcription: {
    start: (params: unknown) => ipcRenderer.invoke('transcription:start', params),
    get: (jobId: string) => ipcRenderer.invoke('transcription:get', jobId),
    onProgress: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('transcription:progress', handler);
      return () => ipcRenderer.removeListener('transcription:progress', handler);
    },
  },
  sam3: {
    start: () => ipcRenderer.invoke('sam3:start'),
    stop: () => ipcRenderer.invoke('sam3:stop'),
    getPort: () => ipcRenderer.invoke('sam3:port'),
  },
  localModel: {
    run: (params: unknown) => ipcRenderer.invoke('local-model:run', params),
    readTranscript: (transcriptPath: string) => ipcRenderer.invoke('local-model:read-transcript', transcriptPath),
    get: (jobId: string) => ipcRenderer.invoke('local-model:get', jobId),
    onProgress: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('local-model:progress', handler);
      return () => ipcRenderer.removeListener('local-model:progress', handler);
    },
  },
  sync: {
    computeOffset: (params: any) => ipcRenderer.invoke('sync:compute-offset', params),
    batchMatch: (params: any) => ipcRenderer.invoke('sync:batch-match', params),
    onBatchProgress: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('sync:batch-progress', handler);
      return () => ipcRenderer.removeListener('sync:batch-progress', handler);
    },
  },
  app: {
    onPowerEvent: (cb: (data: { type: 'suspend' | 'resume' | 'unlock-screen' }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { type: 'suspend' | 'resume' | 'unlock-screen' }) => cb(data);
      ipcRenderer.on('app:power-event', handler);
      return () => ipcRenderer.removeListener('app:power-event', handler);
    },
  },
  nativeVideo: {
    isAvailable: () => ipcRenderer.invoke('native-video:is-available'),
    resetSurfaces: (surfaceIds: string[]) => ipcRenderer.invoke('native-video:reset-surfaces', surfaceIds),
    createSurface: (surfaceId: string) => ipcRenderer.invoke('native-video:create-surface', surfaceId),
    setSurfaceRect: (payload: unknown) => ipcRenderer.send('native-video:set-surface-rect', payload),
    setSurfaceHidden: (payload: unknown) => ipcRenderer.send('native-video:set-surface-hidden', payload),
    clearSurface: (surfaceId: string) => ipcRenderer.send('native-video:clear-surface', surfaceId),
    syncSurface: (payload: unknown) => ipcRenderer.send('native-video:sync-surface', payload),
    destroySurface: (surfaceId: string) => ipcRenderer.send('native-video:destroy-surface', surfaceId),
  },
});
