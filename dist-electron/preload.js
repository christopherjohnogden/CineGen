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
  mcpBridge: {
    onInvoke: (cb) => {
      const listener = (_event, payload) => cb(payload);
      electron.ipcRenderer.on("mcp:invoke", listener);
      return () => electron.ipcRenderer.removeListener("mcp:invoke", listener);
    },
    respond: (payload) => electron.ipcRenderer.send("mcp:result", payload),
    ready: (ready) => electron.ipcRenderer.send("mcp:ready", ready),
    status: () => electron.ipcRenderer.invoke("mcp:status")
  },
  workflow: {
    run: (params) => electron.ipcRenderer.invoke("workflow:run", params),
    pollJob: (id) => electron.ipcRenderer.invoke("workflow:poll-job", id)
  },
  pod: {
    start: (params) => electron.ipcRenderer.invoke("pod:start", params),
    stop: (params) => electron.ipcRenderer.invoke("pod:stop", params),
    status: (params) => electron.ipcRenderer.invoke("pod:status", params),
    setupLtx25: (params) => electron.ipcRenderer.invoke("pod:setup-ltx25", params),
    statusLtx25: (params) => electron.ipcRenderer.invoke("pod:status-ltx25", params),
    terminateLtx25: (params) => electron.ipcRenderer.invoke("pod:terminate-ltx25", params),
    generateLtx25: (params) => electron.ipcRenderer.invoke("pod:generate-ltx25", params),
    generateSessionImage: (params) => electron.ipcRenderer.invoke("pod:generate-session-image", params)
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
    uploadMediaSource: (sourceUrl, apiKey) => electron.ipcRenderer.invoke("elements:upload-media-source", sourceUrl, apiKey),
    loadLibrary: (opts) => electron.ipcRenderer.invoke("elements-library:load", opts),
    saveLibrary: (library) => electron.ipcRenderer.invoke("elements-library:save", library)
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
    runCutWorkflow: (params) => electron.ipcRenderer.invoke("llm:run-cut-workflow", params),
    claudeCodeDetect: () => electron.ipcRenderer.invoke("llm:claude-code-detect"),
    cliDetect: () => electron.ipcRenderer.invoke("llm:cli-detect"),
    claudeCodeChat: (params) => electron.ipcRenderer.invoke("llm:claude-code-chat", params),
    codexChat: (params) => electron.ipcRenderer.invoke("llm:codex-chat", params),
    geminiChat: (params) => electron.ipcRenderer.invoke("llm:gemini-chat", params),
    openaiChat: (params) => electron.ipcRenderer.invoke("llm:openai-chat", params),
    openaiRealtimeSession: (params) => electron.ipcRenderer.invoke("llm:openai-realtime-session", params),
    claudeCodeCancel: (requestId) => electron.ipcRenderer.invoke("llm:claude-code-cancel", requestId),
    codexCancel: (requestId) => electron.ipcRenderer.invoke("llm:codex-cancel", requestId),
    geminiCancel: (requestId) => electron.ipcRenderer.invoke("llm:gemini-cancel", requestId),
    onClaudeCodeStream: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("llm:claude-code-stream", handler);
      return () => electron.ipcRenderer.removeListener("llm:claude-code-stream", handler);
    },
    onCodexStream: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("llm:codex-stream", handler);
      return () => electron.ipcRenderer.removeListener("llm:codex-stream", handler);
    },
    onGeminiStream: (cb) => {
      const handler = (_e, d) => cb(d);
      electron.ipcRenderer.on("llm:gemini-stream", handler);
      return () => electron.ipcRenderer.removeListener("llm:gemini-stream", handler);
    }
  },
  vision: {
    indexAsset: (params) => electron.ipcRenderer.invoke("vision:index-asset", params),
    detectObjects: (params) => electron.ipcRenderer.invoke("vision:detect-objects", params)
  },
  acoustic: {
    analyzeAsset: (params) => electron.ipcRenderer.invoke("acoustic:analyze-asset", params)
  },
  higgsfield: {
    accountStatus: () => electron.ipcRenderer.invoke("higgsfield:account-status"),
    authLogin: () => electron.ipcRenderer.invoke("higgsfield:auth-login"),
    authLogout: () => electron.ipcRenderer.invoke("higgsfield:auth-logout"),
    quickEdit: (params) => electron.ipcRenderer.invoke("higgsfield:quick-edit", params),
    generate: (params) => electron.ipcRenderer.invoke("higgsfield:generate", params),
    generateList: (params) => electron.ipcRenderer.invoke("higgsfield:generate-list", params),
    generateCost: (params) => electron.ipcRenderer.invoke("higgsfield:generate-cost", params)
  },
  artlist: {
    accountStatus: () => electron.ipcRenderer.invoke("artlist:account-status"),
    authLogin: () => electron.ipcRenderer.invoke("artlist:auth-login"),
    authLogout: () => electron.ipcRenderer.invoke("artlist:auth-logout"),
    generate: (params) => electron.ipcRenderer.invoke("artlist:generate", params)
  },
  topview: {
    accountStatus: () => electron.ipcRenderer.invoke("topview:account-status"),
    modelCatalog: () => electron.ipcRenderer.invoke("topview:model-catalog"),
    authLogin: () => electron.ipcRenderer.invoke("topview:auth-login"),
    authLogout: () => electron.ipcRenderer.invoke("topview:auth-logout"),
    submit: (params) => electron.ipcRenderer.invoke("topview:submit", params),
    query: (params) => electron.ipcRenderer.invoke("topview:query", params),
    generate: (params) => electron.ipcRenderer.invoke("topview:generate", params),
    generateImage: (params) => electron.ipcRenderer.invoke("topview:generate-image", params),
    generateAudio: (params) => electron.ipcRenderer.invoke("topview:generate-audio", params)
  },
  teamProviders: {
    status: () => electron.ipcRenderer.invoke("team-providers:status"),
    connect: () => electron.ipcRenderer.invoke("team-providers:connect"),
    disconnect: () => electron.ipcRenderer.invoke("team-providers:disconnect"),
    save: (value) => electron.ipcRenderer.invoke("team-providers:save", value),
    remove: (value) => electron.ipcRenderer.invoke("team-providers:remove", value),
    shareTopview: () => electron.ipcRenderer.invoke("team-providers:share-topview")
  },
  copilot: {
    analyzeVisualRefs: (params) => electron.ipcRenderer.invoke("copilot:analyze-visual-refs", params)
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
    writeTempImage: (params) => electron.ipcRenderer.invoke("media:write-temp-image", params),
    extractClip: (params) => electron.ipcRenderer.invoke("media:extract-clip", params),
    downloadRemote: (params) => electron.ipcRenderer.invoke("media:download-remote", params),
    persistGeneratedAsset: (params) => electron.ipcRenderer.invoke("media:persist-generated-asset", params),
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
  file: {
    getPathForFile: (file) => electron.webUtils.getPathForFile(file)
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
