"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  project: {
    list: () => electron.ipcRenderer.invoke("project:list"),
    create: (name) => electron.ipcRenderer.invoke("project:create", name),
    load: (id) => electron.ipcRenderer.invoke("project:load", id),
    save: (id, data) => electron.ipcRenderer.invoke("project:save", id, data),
    delete: (id) => electron.ipcRenderer.invoke("project:delete", id)
  },
  workflow: {
    run: (params) => electron.ipcRenderer.invoke("workflow:run", params),
    pollJob: (id) => electron.ipcRenderer.invoke("workflow:poll-job", id)
  },
  pod: {
    start: (params) => electron.ipcRenderer.invoke("pod:start", params),
    stop: (params) => electron.ipcRenderer.invoke("pod:stop", params),
    status: (params) => electron.ipcRenderer.invoke("pod:status", params)
  },
  export: {
    start: (params) => electron.ipcRenderer.invoke("export:start", params),
    poll: (id) => electron.ipcRenderer.invoke("export:poll", id),
    cancel: (id) => electron.ipcRenderer.invoke("export:cancel", id),
    onProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("export:progress", handler);
      return () => electron.ipcRenderer.removeListener("export:progress", handler);
    }
  },
  elements: {
    upload: (fileData, apiKey) => electron.ipcRenderer.invoke("elements:upload", fileData, apiKey),
    uploadTranscriptionSource: (sourceUrl, apiKey) => electron.ipcRenderer.invoke("elements:upload-transcription-source", sourceUrl, apiKey),
    uploadMediaSource: (sourceUrl, apiKey) => electron.ipcRenderer.invoke("elements:upload-media-source", sourceUrl, apiKey)
  },
  music: {
    generatePrompt: (params) => electron.ipcRenderer.invoke("music:generate-prompt", params)
  },
  llm: {
    chat: (params) => electron.ipcRenderer.invoke("llm:chat", params),
    localChat: (params) => electron.ipcRenderer.invoke("llm:local-chat", params),
    localModels: () => electron.ipcRenderer.invoke("llm:local-models"),
    onLocalStream: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("llm:local-stream", handler);
      return () => electron.ipcRenderer.removeListener("llm:local-stream", handler);
    },
    runCutWorkflow: (params) => electron.ipcRenderer.invoke("llm:run-cut-workflow", params)
  },
  vision: {
    indexAsset: (params) => electron.ipcRenderer.invoke("vision:index-asset", params),
    detectObjects: (params) => electron.ipcRenderer.invoke("vision:detect-objects", params)
  },
  dialog: {
    showSave: (options) => electron.ipcRenderer.invoke("dialog:show-save", options),
    showOpen: (options) => electron.ipcRenderer.invoke("dialog:show-open", options)
  },
  shell: {
    openPath: (filePath) => electron.ipcRenderer.invoke("shell:open-path", filePath)
  },
  db: {
    createProject: (name) => electron.ipcRenderer.invoke("db:project:create", name),
    loadProject: (id) => electron.ipcRenderer.invoke("db:project:load", id),
    saveProject: (id, state) => electron.ipcRenderer.invoke("db:project:save", id, state),
    deleteProject: (id) => electron.ipcRenderer.invoke("db:project:delete", id),
    closeProject: (id) => electron.ipcRenderer.invoke("db:project:close", id),
    updateProject: (id, data) => electron.ipcRenderer.invoke("db:project:update", id, data),
    insertAsset: (asset) => electron.ipcRenderer.invoke("db:asset:insert", asset),
    updateAsset: (projectId, id, data) => electron.ipcRenderer.invoke("db:asset:update", projectId, id, data),
    deleteAsset: (projectId, id) => electron.ipcRenderer.invoke("db:asset:delete", projectId, id)
  },
  media: {
    import: (params) => electron.ipcRenderer.invoke("media:import", params),
    submitJob: (job) => electron.ipcRenderer.invoke("media:submit-job", job),
    cancelJob: (jobId) => electron.ipcRenderer.invoke("media:cancel-job", jobId),
    queueProcessing: (params) => electron.ipcRenderer.invoke("media:queue-processing", params),
    extractFrame: (params) => electron.ipcRenderer.invoke("media:extract-frame", params),
    extractClip: (params) => electron.ipcRenderer.invoke("media:extract-clip", params),
    downloadRemote: (params) => electron.ipcRenderer.invoke("media:download-remote", params),
    onJobProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("media:job-progress", handler);
      return () => electron.ipcRenderer.removeListener("media:job-progress", handler);
    },
    onJobComplete: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("media:job-complete", handler);
      return () => electron.ipcRenderer.removeListener("media:job-complete", handler);
    },
    onJobError: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("media:job-error", handler);
      return () => electron.ipcRenderer.removeListener("media:job-error", handler);
    }
  },
  pm: {
    openProject: (id, useSqlite) => electron.ipcRenderer.invoke("pm:open-project", id, useSqlite),
    open: () => electron.ipcRenderer.invoke("pm:open"),
    onOpenProject: (cb) => {
      const handler = (_e, id, useSqlite) => cb(id, useSqlite);
      electron.ipcRenderer.on("pm:open-project", handler);
      return () => electron.ipcRenderer.removeListener("pm:open-project", handler);
    }
  },
  transcription: {
    start: (params) => electron.ipcRenderer.invoke("transcription:start", params),
    get: (jobId) => electron.ipcRenderer.invoke("transcription:get", jobId),
    onProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("transcription:progress", handler);
      return () => electron.ipcRenderer.removeListener("transcription:progress", handler);
    }
  },
  sam3: {
    start: () => electron.ipcRenderer.invoke("sam3:start"),
    stop: () => electron.ipcRenderer.invoke("sam3:stop"),
    getPort: () => electron.ipcRenderer.invoke("sam3:port")
  },
  localModel: {
    run: (params) => electron.ipcRenderer.invoke("local-model:run", params),
    readTranscript: (transcriptPath) => electron.ipcRenderer.invoke("local-model:read-transcript", transcriptPath),
    get: (jobId) => electron.ipcRenderer.invoke("local-model:get", jobId),
    onProgress: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("local-model:progress", handler);
      return () => electron.ipcRenderer.removeListener("local-model:progress", handler);
    }
  },
  sync: {
    computeOffset: (params) => electron.ipcRenderer.invoke("sync:compute-offset", params),
    batchMatch: (params) => electron.ipcRenderer.invoke("sync:batch-match", params),
    onBatchProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("sync:batch-progress", handler);
      return () => electron.ipcRenderer.removeListener("sync:batch-progress", handler);
    }
  },
  app: {
    onPowerEvent: (cb) => {
      const handler = (_e, data) => cb(data);
      electron.ipcRenderer.on("app:power-event", handler);
      return () => electron.ipcRenderer.removeListener("app:power-event", handler);
    }
  },
  nativeVideo: {
    isAvailable: () => electron.ipcRenderer.invoke("native-video:is-available"),
    resetSurfaces: (surfaceIds) => electron.ipcRenderer.invoke("native-video:reset-surfaces", surfaceIds),
    createSurface: (surfaceId) => electron.ipcRenderer.invoke("native-video:create-surface", surfaceId),
    setSurfaceRect: (payload) => electron.ipcRenderer.send("native-video:set-surface-rect", payload),
    setSurfaceHidden: (payload) => electron.ipcRenderer.send("native-video:set-surface-hidden", payload),
    clearSurface: (surfaceId) => electron.ipcRenderer.send("native-video:clear-surface", surfaceId),
    syncSurface: (payload) => electron.ipcRenderer.send("native-video:sync-surface", payload),
    destroySurface: (surfaceId) => electron.ipcRenderer.send("native-video:destroy-surface", surfaceId)
  }
});
