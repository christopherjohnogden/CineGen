"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  project: {
    list: () => import_electron.ipcRenderer.invoke("project:list"),
    create: (name) => import_electron.ipcRenderer.invoke("project:create", name),
    load: (id) => import_electron.ipcRenderer.invoke("project:load", id),
    save: (id, data) => import_electron.ipcRenderer.invoke("project:save", id, data),
    delete: (id) => import_electron.ipcRenderer.invoke("project:delete", id)
  },
  workflow: {
    run: (params) => import_electron.ipcRenderer.invoke("workflow:run", params),
    pollJob: (id) => import_electron.ipcRenderer.invoke("workflow:poll-job", id)
  },
  pod: {
    start: (params) => import_electron.ipcRenderer.invoke("pod:start", params),
    stop: (params) => import_electron.ipcRenderer.invoke("pod:stop", params),
    status: (params) => import_electron.ipcRenderer.invoke("pod:status", params)
  },
  export: {
    start: (params) => import_electron.ipcRenderer.invoke("export:start", params),
    poll: (id) => import_electron.ipcRenderer.invoke("export:poll", id),
    cancel: (id) => import_electron.ipcRenderer.invoke("export:cancel", id),
    onProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      import_electron.ipcRenderer.on("export:progress", handler);
      return () => import_electron.ipcRenderer.removeListener("export:progress", handler);
    }
  },
  elements: {
    upload: (fileData, apiKey) => import_electron.ipcRenderer.invoke("elements:upload", fileData, apiKey),
    uploadTranscriptionSource: (sourceUrl, apiKey) => import_electron.ipcRenderer.invoke("elements:upload-transcription-source", sourceUrl, apiKey),
    uploadMediaSource: (sourceUrl, apiKey) => import_electron.ipcRenderer.invoke("elements:upload-media-source", sourceUrl, apiKey)
  },
  music: {
    generatePrompt: (params) => import_electron.ipcRenderer.invoke("music:generate-prompt", params)
  },
  llm: {
    chat: (params) => import_electron.ipcRenderer.invoke("llm:chat", params),
    localChat: (params) => import_electron.ipcRenderer.invoke("llm:local-chat", params),
    localModels: () => import_electron.ipcRenderer.invoke("llm:local-models"),
    onLocalStream: (cb) => {
      const handler = (_e, d) => cb(d);
      import_electron.ipcRenderer.on("llm:local-stream", handler);
      return () => import_electron.ipcRenderer.removeListener("llm:local-stream", handler);
    },
    runCutWorkflow: (params) => import_electron.ipcRenderer.invoke("llm:run-cut-workflow", params)
  },
  vision: {
    indexAsset: (params) => import_electron.ipcRenderer.invoke("vision:index-asset", params),
    detectObjects: (params) => import_electron.ipcRenderer.invoke("vision:detect-objects", params)
  },
  dialog: {
    showSave: (options) => import_electron.ipcRenderer.invoke("dialog:show-save", options),
    showOpen: (options) => import_electron.ipcRenderer.invoke("dialog:show-open", options)
  },
  shell: {
    openPath: (filePath) => import_electron.ipcRenderer.invoke("shell:open-path", filePath)
  },
  db: {
    createProject: (name) => import_electron.ipcRenderer.invoke("db:project:create", name),
    loadProject: (id) => import_electron.ipcRenderer.invoke("db:project:load", id),
    saveProject: (id, state) => import_electron.ipcRenderer.invoke("db:project:save", id, state),
    deleteProject: (id) => import_electron.ipcRenderer.invoke("db:project:delete", id),
    closeProject: (id) => import_electron.ipcRenderer.invoke("db:project:close", id),
    updateProject: (id, data) => import_electron.ipcRenderer.invoke("db:project:update", id, data),
    insertAsset: (asset) => import_electron.ipcRenderer.invoke("db:asset:insert", asset),
    updateAsset: (projectId, id, data) => import_electron.ipcRenderer.invoke("db:asset:update", projectId, id, data),
    deleteAsset: (projectId, id) => import_electron.ipcRenderer.invoke("db:asset:delete", projectId, id)
  },
  media: {
    import: (params) => import_electron.ipcRenderer.invoke("media:import", params),
    submitJob: (job) => import_electron.ipcRenderer.invoke("media:submit-job", job),
    cancelJob: (jobId) => import_electron.ipcRenderer.invoke("media:cancel-job", jobId),
    queueProcessing: (params) => import_electron.ipcRenderer.invoke("media:queue-processing", params),
    extractFrame: (params) => import_electron.ipcRenderer.invoke("media:extract-frame", params),
    extractClip: (params) => import_electron.ipcRenderer.invoke("media:extract-clip", params),
    downloadRemote: (params) => import_electron.ipcRenderer.invoke("media:download-remote", params),
    onJobProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      import_electron.ipcRenderer.on("media:job-progress", handler);
      return () => import_electron.ipcRenderer.removeListener("media:job-progress", handler);
    },
    onJobComplete: (cb) => {
      const handler = (_e, d) => cb(d);
      import_electron.ipcRenderer.on("media:job-complete", handler);
      return () => import_electron.ipcRenderer.removeListener("media:job-complete", handler);
    },
    onJobError: (cb) => {
      const handler = (_e, d) => cb(d);
      import_electron.ipcRenderer.on("media:job-error", handler);
      return () => import_electron.ipcRenderer.removeListener("media:job-error", handler);
    }
  },
  pm: {
    openProject: (id, useSqlite) => import_electron.ipcRenderer.invoke("pm:open-project", id, useSqlite),
    open: () => import_electron.ipcRenderer.invoke("pm:open"),
    onOpenProject: (cb) => {
      const handler = (_e, id, useSqlite) => cb(id, useSqlite);
      import_electron.ipcRenderer.on("pm:open-project", handler);
      return () => import_electron.ipcRenderer.removeListener("pm:open-project", handler);
    }
  },
  transcription: {
    start: (params) => import_electron.ipcRenderer.invoke("transcription:start", params),
    get: (jobId) => import_electron.ipcRenderer.invoke("transcription:get", jobId),
    onProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      import_electron.ipcRenderer.on("transcription:progress", handler);
      return () => import_electron.ipcRenderer.removeListener("transcription:progress", handler);
    }
  },
  sam3: {
    start: () => import_electron.ipcRenderer.invoke("sam3:start"),
    stop: () => import_electron.ipcRenderer.invoke("sam3:stop"),
    getPort: () => import_electron.ipcRenderer.invoke("sam3:port")
  },
  localModel: {
    run: (params) => import_electron.ipcRenderer.invoke("local-model:run", params),
    readTranscript: (transcriptPath) => import_electron.ipcRenderer.invoke("local-model:read-transcript", transcriptPath),
    get: (jobId) => import_electron.ipcRenderer.invoke("local-model:get", jobId),
    onProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      import_electron.ipcRenderer.on("local-model:progress", handler);
      return () => import_electron.ipcRenderer.removeListener("local-model:progress", handler);
    }
  },
  sync: {
    computeOffset: (params) => import_electron.ipcRenderer.invoke("sync:compute-offset", params),
    batchMatch: (params) => import_electron.ipcRenderer.invoke("sync:batch-match", params),
    onBatchProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      import_electron.ipcRenderer.on("sync:batch-progress", handler);
      return () => import_electron.ipcRenderer.removeListener("sync:batch-progress", handler);
    }
  },
  app: {
    onPowerEvent: (cb) => {
      const handler = (_e, data) => cb(data);
      import_electron.ipcRenderer.on("app:power-event", handler);
      return () => import_electron.ipcRenderer.removeListener("app:power-event", handler);
    }
  },
  nativeVideo: {
    isAvailable: () => import_electron.ipcRenderer.invoke("native-video:is-available"),
    resetSurfaces: (surfaceIds) => import_electron.ipcRenderer.invoke("native-video:reset-surfaces", surfaceIds),
    createSurface: (surfaceId) => import_electron.ipcRenderer.invoke("native-video:create-surface", surfaceId),
    setSurfaceRect: (payload) => import_electron.ipcRenderer.send("native-video:set-surface-rect", payload),
    setSurfaceHidden: (payload) => import_electron.ipcRenderer.send("native-video:set-surface-hidden", payload),
    clearSurface: (surfaceId) => import_electron.ipcRenderer.send("native-video:clear-surface", surfaceId),
    syncSurface: (payload) => import_electron.ipcRenderer.send("native-video:sync-surface", payload),
    destroySurface: (surfaceId) => import_electron.ipcRenderer.send("native-video:destroy-surface", surfaceId)
  }
});
