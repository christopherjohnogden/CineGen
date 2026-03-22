var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { BrowserWindow, screen, ipcMain, app, dialog, shell, protocol, nativeImage, powerMonitor } from "electron";
import fs$1 from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto$1, { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "worker_threads";
import net from "node:net";
const LOAD_RETRY_DELAY_MS = 1200;
const RESUME_NUDGE_DELAY_MS = 150;
const RESUME_HEALTH_CHECK_DELAY_MS = 1e3;
const RESUME_HARD_RELOAD_DELAY_MS = 2800;
const WINDOW_RELOADERS = /* @__PURE__ */ new WeakMap();
const WINDOW_LABELS = /* @__PURE__ */ new WeakMap();
const WINDOW_RESUME_TIMERS = /* @__PURE__ */ new WeakMap();
const WINDOW_WAKE_GRACE_UNTIL = /* @__PURE__ */ new WeakMap();
function resolveWindowIconPath() {
  const fileNames = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"];
  const candidates = [
    ...fileNames.map((fileName) => path.resolve(process.cwd(), "build", fileName)),
    ...fileNames.map((fileName) => path.resolve(import.meta.dirname, "../build", fileName))
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return void 0;
}
const APP_ICON = resolveWindowIconPath();
const DIST_ELECTRON = path.join(import.meta.dirname, ".");
const DIST = path.join(DIST_ELECTRON, "../dist");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
function loadProjectManagerContent(win) {
  if (VITE_DEV_SERVER_URL) {
    return win.loadURL(`${VITE_DEV_SERVER_URL}?pm=1`);
  }
  return win.loadFile(path.join(DIST, "index.html"), { query: { pm: "1" } });
}
function loadMainContent(win) {
  if (VITE_DEV_SERVER_URL) {
    return win.loadURL(VITE_DEV_SERVER_URL);
  }
  return win.loadFile(path.join(DIST, "index.html"));
}
function addWindowTimer(win, timer) {
  const timers = WINDOW_RESUME_TIMERS.get(win) ?? /* @__PURE__ */ new Set();
  timers.add(timer);
  WINDOW_RESUME_TIMERS.set(win, timers);
}
function removeWindowTimer(win, timer) {
  var _a;
  (_a = WINDOW_RESUME_TIMERS.get(win)) == null ? void 0 : _a.delete(timer);
}
function clearWindowTimers(win) {
  const timers = WINDOW_RESUME_TIMERS.get(win);
  if (!timers) return;
  for (const timer of timers) {
    clearTimeout(timer);
  }
  timers.clear();
}
function reloadExistingPage(win) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      win.webContents.removeListener("did-finish-load", handleFinish);
      win.webContents.removeListener("did-fail-load", handleFail);
    };
    const handleFinish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const handleFail = (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (settled || !isMainFrame || errorCode === -3) return;
      settled = true;
      cleanup();
      reject(new Error(`did-fail-load ${errorCode}: ${errorDescription}`));
    };
    win.webContents.on("did-finish-load", handleFinish);
    win.webContents.on("did-fail-load", handleFail);
    win.webContents.reloadIgnoringCache();
  });
}
async function reloadWindowForRecovery(win, label, reloadWindow, reason) {
  if (win.isDestroyed()) return;
  console.warn(`[window] ${label} reloading after wake: ${reason}`);
  const currentUrl = win.webContents.getURL();
  if (currentUrl) {
    await reloadExistingPage(win);
    return;
  }
  await reloadWindow(win);
}
async function runResumeHealthCheck(win, label, reloadWindow) {
  if (win.isDestroyed()) return;
  try {
    const status = await win.webContents.executeJavaScript(
      `(() => {
        const root =
          document.getElementById('root') ??
          document.getElementById('app') ??
          document.querySelector('[data-reactroot]');
        const bodyChildren = document.body?.childElementCount ?? 0;
        const bodyTextLength = (document.body?.innerText ?? '').trim().length;
        return {
          readyState: document.readyState,
          hasRoot: Boolean(root),
          bodyChildren,
          bodyTextLength,
        };
      })()`,
      true
    );
    const looksBlank = !(status == null ? void 0 : status.hasRoot) && (status == null ? void 0 : status.bodyChildren) === 0 && (status == null ? void 0 : status.bodyTextLength) === 0;
    if (!looksBlank) return;
    await reloadWindowForRecovery(win, label, reloadWindow, "blank renderer DOM after resume");
  } catch (error) {
    console.warn(`[window] ${label} health check failed after wake:`, error);
    await reloadWindowForRecovery(win, label, reloadWindow, "resume health check failed");
  }
}
function recoverManagedWindowsFromSleep(reason) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const reloadWindow = WINDOW_RELOADERS.get(win);
    if (!reloadWindow) continue;
    const label = WINDOW_LABELS.get(win) ?? "window";
    clearWindowTimers(win);
    WINDOW_WAKE_GRACE_UNTIL.set(win, Date.now() + RESUME_HARD_RELOAD_DELAY_MS + 1e3);
    let hardReloadTimer = null;
    const nudgeTimer = setTimeout(() => {
      removeWindowTimer(win, nudgeTimer);
      if (win.isDestroyed()) return;
      console.log(`[window] ${label} wake recovery started: ${reason}`);
      win.webContents.invalidate();
      void win.webContents.executeJavaScript(
        `(() => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
        true
      ).catch(() => {
      });
      if (win.isVisible()) {
        win.show();
        win.focus();
      }
    }, RESUME_NUDGE_DELAY_MS);
    addWindowTimer(win, nudgeTimer);
    const healthCheckTimer = setTimeout(() => {
      removeWindowTimer(win, healthCheckTimer);
      void (async () => {
        try {
          await runResumeHealthCheck(win, label, reloadWindow);
          if (hardReloadTimer) {
            clearTimeout(hardReloadTimer);
            removeWindowTimer(win, hardReloadTimer);
            hardReloadTimer = null;
          }
        } catch (error) {
          console.warn(`[window] ${label} resume health check threw:`, error);
        }
      })();
    }, RESUME_HEALTH_CHECK_DELAY_MS);
    addWindowTimer(win, healthCheckTimer);
    hardReloadTimer = setTimeout(() => {
      removeWindowTimer(win, hardReloadTimer);
      if (win.isDestroyed()) return;
      void reloadWindowForRecovery(win, label, reloadWindow, `hard reload after ${reason}`).catch((error) => {
        console.error(`[window] ${label} hard reload failed:`, error);
      });
    }, RESUME_HARD_RELOAD_DELAY_MS);
    addWindowTimer(win, hardReloadTimer);
  }
}
function attachWindowRecovery(win, label, reloadWindow) {
  let reloadTimer = null;
  WINDOW_RELOADERS.set(win, reloadWindow);
  WINDOW_LABELS.set(win, label);
  const scheduleReload = (reason) => {
    if (win.isDestroyed() || reloadTimer) return;
    const wakeGraceUntil = WINDOW_WAKE_GRACE_UNTIL.get(win) ?? 0;
    if (reason === "window became unresponsive" && Date.now() < wakeGraceUntil) {
      console.warn(`[window] ${label} suppressing reload during wake recovery: ${reason}`);
      return;
    }
    console.warn(`[window] ${label} scheduling reload: ${reason}`);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (win.isDestroyed()) return;
      reloadWindow(win).catch((error) => {
        console.error(`[window] ${label} reload failed:`, error);
      });
    }, LOAD_RETRY_DELAY_MS);
  };
  win.on("unresponsive", () => {
    scheduleReload("window became unresponsive");
  });
  win.on("closed", () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    clearWindowTimers(win);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    scheduleReload(`render process gone (${details.reason})`);
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    scheduleReload(`did-fail-load ${errorCode}: ${errorDescription}`);
  });
}
function createProjectManagerWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const pmW = 900;
  const pmH = 580;
  const pm = new BrowserWindow({
    width: pmW,
    height: pmH,
    x: Math.round((screenW - pmW) / 2),
    y: Math.round((screenH - pmH) / 2),
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    ...APP_ICON ? { icon: APP_ICON } : {},
    webPreferences: {
      preload: path.join(DIST_ELECTRON, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  attachWindowRecovery(pm, "project-manager", loadProjectManagerContent);
  void loadProjectManagerContent(pm);
  return pm;
}
function createSplashWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const splashW = 800;
  const splashH = 395;
  const splash = new BrowserWindow({
    width: splashW,
    height: splashH,
    x: Math.round((screenW - splashW) / 2),
    y: Math.round((screenH - splashH) / 2),
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...APP_ICON ? { icon: APP_ICON } : {},
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  splash.loadFile(path.join(DIST_ELECTRON, "splash.html"));
  return splash;
}
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#08090c",
    titleBarStyle: "hiddenInset",
    ...APP_ICON ? { icon: APP_ICON } : {},
    webPreferences: {
      preload: path.join(DIST_ELECTRON, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  attachWindowRecovery(win, "main", loadMainContent);
  void loadMainContent(win);
  if (VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools({ mode: "detach" });
  }
  return win;
}
function projectsRoot$1() {
  return path.join(os.homedir(), "Documents", "CINEGEN");
}
function indexPath$1() {
  return path.join(projectsRoot$1(), "projects.json");
}
function projectDir$1(id) {
  return path.join(projectsRoot$1(), id);
}
function projectPath(id) {
  return path.join(projectDir$1(id), "project.json");
}
function generateId$1() {
  return crypto$1.randomUUID();
}
function timestamp$1() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function ensureRoot() {
  await fs$1.mkdir(projectsRoot$1(), { recursive: true });
}
async function readIndex$1() {
  try {
    const raw = await fs$1.readFile(indexPath$1(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}
async function writeIndex$1(index) {
  await ensureRoot();
  const tmp = indexPath$1() + ".tmp";
  await fs$1.writeFile(tmp, JSON.stringify(index, null, 2), "utf-8");
  await fs$1.rename(tmp, indexPath$1());
}
function defaultSnapshot(id, name2) {
  const now = timestamp$1();
  const defaultSpace = {
    id: generateId$1(),
    name: "Space 1",
    createdAt: now,
    nodes: [],
    edges: []
  };
  return {
    project: { id, name: name2, createdAt: now, updatedAt: now },
    workflow: { nodes: [], edges: [] },
    spaces: [defaultSpace],
    activeSpaceId: defaultSpace.id,
    openSpaceIds: [defaultSpace.id],
    sequence: { id: "default", tracks: [{ id: "track-1", name: "Track 1", clips: [] }], duration: 0 },
    assets: [],
    mediaFolders: [],
    exports: [],
    elements: []
  };
}
function resolveLegacyThumbnail(projectId) {
  const jsonPath = path.join(projectDir$1(projectId), "project.json");
  if (!fs.existsSync(jsonPath)) return null;
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    const asset = (data.assets ?? []).find(
      (a) => (a.type === "video" || a.type === "image") && a.thumbnailUrl
    );
    return (asset == null ? void 0 : asset.thumbnailUrl) ?? null;
  } catch {
    return null;
  }
}
function resolveSqliteThumbnail(projectId) {
  const dbPath = path.join(projectDir$1(projectId), "project.db");
  if (!fs.existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });
    const fromClip = db.prepare(
      `SELECT a.thumbnail_url
       FROM clips c
       JOIN tracks t ON t.id = c.track_id
       JOIN timelines tl ON tl.id = t.timeline_id
       JOIN assets a ON a.id = c.asset_id
       WHERE tl.project_id = ?
         AND t.kind = 'video'
         AND a.type IN ('video', 'image')
         AND a.thumbnail_url IS NOT NULL
       ORDER BY c.start_time ASC
       LIMIT 1`
    ).get(projectId);
    if (fromClip == null ? void 0 : fromClip.thumbnail_url) {
      db.close();
      return `file://${fromClip.thumbnail_url}`;
    }
    const fromAsset = db.prepare(
      `SELECT thumbnail_url FROM assets
       WHERE project_id = ?
         AND type IN ('video', 'image')
         AND thumbnail_url IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`
    ).get(projectId);
    db.close();
    return (fromAsset == null ? void 0 : fromAsset.thumbnail_url) ? `file://${fromAsset.thumbnail_url}` : null;
  } catch {
    return null;
  }
}
function registerProjectHandlers() {
  ipcMain.handle("project:list", async () => {
    const index = await readIndex$1();
    return index.projects.map((p) => {
      const thumbnail = p.useSqlite ? resolveSqliteThumbnail(p.id) : resolveLegacyThumbnail(p.id);
      return { ...p, thumbnail };
    });
  });
  ipcMain.handle("project:create", async (_event, name2) => {
    const trimmed = name2.trim();
    if (!trimmed || trimmed.length > 100) {
      throw new Error("Project name must be 1-100 characters");
    }
    const id = generateId$1();
    const snapshot = defaultSnapshot(id, trimmed);
    await ensureRoot();
    await fs$1.mkdir(projectDir$1(id), { recursive: true });
    const tmp = projectPath(id) + ".tmp";
    await fs$1.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf-8");
    await fs$1.rename(tmp, projectPath(id));
    const index = await readIndex$1();
    index.projects.unshift({
      id,
      name: trimmed,
      createdAt: snapshot.project.createdAt,
      updatedAt: snapshot.project.updatedAt,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null
    });
    await writeIndex$1(index);
    return snapshot;
  });
  ipcMain.handle("project:load", async (_event, id) => {
    const raw = await fs$1.readFile(projectPath(id), "utf-8");
    return JSON.parse(raw);
  });
  ipcMain.handle("project:save", async (_event, id, updates) => {
    let current;
    try {
      const raw = await fs$1.readFile(projectPath(id), "utf-8");
      current = JSON.parse(raw);
    } catch {
      throw new Error(`Project ${id} not found`);
    }
    const merged = {
      ...current,
      ...updates,
      project: {
        ...current.project,
        ...updates.project ?? {},
        updatedAt: timestamp$1()
      }
    };
    const tmp = projectPath(id) + ".tmp";
    await fs$1.writeFile(tmp, JSON.stringify(merged, null, 2), "utf-8");
    await fs$1.rename(tmp, projectPath(id));
    const index = await readIndex$1();
    const meta = index.projects.find((p) => p.id === id);
    if (meta) {
      meta.updatedAt = merged.project.updatedAt;
      meta.assetCount = Array.isArray(merged.assets) ? merged.assets.length : 0;
      meta.elementCount = Array.isArray(merged.elements) ? merged.elements.length : 0;
      if (updates.project && updates.project.name) {
        meta.name = updates.project.name;
      }
      await writeIndex$1(index);
    }
    return merged;
  });
  ipcMain.handle("project:delete", async (_event, id) => {
    await fs$1.rm(projectDir$1(id), { recursive: true, force: true });
    const index = await readIndex$1();
    index.projects = index.projects.filter((p) => p.id !== id);
    await writeIndex$1(index);
  });
}
function getAugmentedNamespace(n) {
  if (Object.prototype.hasOwnProperty.call(n, "__esModule")) return n;
  var f = n.default;
  if (typeof f == "function") {
    var a = function a2() {
      if (this instanceof a2) {
        return Reflect.construct(f, arguments, this.constructor);
      }
      return f.apply(this, arguments);
    };
    a.prototype = f.prototype;
  } else a = {};
  Object.defineProperty(a, "__esModule", { value: true });
  Object.keys(n).forEach(function(k) {
    var d = Object.getOwnPropertyDescriptor(n, k);
    Object.defineProperty(a, k, d.get ? d : {
      enumerable: true,
      get: function() {
        return n[k];
      }
    });
  });
  return a;
}
var src = {};
var client = {};
var config = {};
var middleware = {};
var hasRequiredMiddleware;
function requireMiddleware() {
  if (hasRequiredMiddleware) return middleware;
  hasRequiredMiddleware = 1;
  (function(exports$1) {
    var __awaiter = middleware && middleware.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        function step(result) {
          result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
        }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports$1, "__esModule", { value: true });
    exports$1.TARGET_URL_HEADER = void 0;
    exports$1.withMiddleware = withMiddleware;
    exports$1.withProxy = withProxy;
    function withMiddleware(...middlewares) {
      const isDefined = (middleware2) => typeof middleware2 === "function";
      return (config2) => __awaiter(this, void 0, void 0, function* () {
        let currentConfig = Object.assign({}, config2);
        for (const middleware2 of middlewares.filter(isDefined)) {
          currentConfig = yield middleware2(currentConfig);
        }
        return currentConfig;
      });
    }
    exports$1.TARGET_URL_HEADER = "x-fal-target-url";
    function withProxy(config2) {
      const passthrough = (requestConfig) => Promise.resolve(requestConfig);
      if (typeof window === "undefined") {
        return passthrough;
      }
      return (requestConfig) => requestConfig.headers && exports$1.TARGET_URL_HEADER in requestConfig ? passthrough(requestConfig) : Promise.resolve(Object.assign(Object.assign({}, requestConfig), { url: config2.targetUrl, headers: Object.assign(Object.assign({}, requestConfig.headers || {}), { [exports$1.TARGET_URL_HEADER]: requestConfig.url }) }));
    }
  })(middleware);
  return middleware;
}
var response = {};
var headers = {};
var hasRequiredHeaders;
function requireHeaders() {
  if (hasRequiredHeaders) return headers;
  hasRequiredHeaders = 1;
  (function(exports$1) {
    Object.defineProperty(exports$1, "__esModule", { value: true });
    exports$1.RUNNER_HINT_HEADER = exports$1.QUEUE_PRIORITY_HEADER = exports$1.REQUEST_TIMEOUT_TYPE_HEADER = exports$1.REQUEST_TIMEOUT_HEADER = exports$1.MIN_REQUEST_TIMEOUT_SECONDS = void 0;
    exports$1.validateTimeoutHeader = validateTimeoutHeader;
    exports$1.buildTimeoutHeaders = buildTimeoutHeaders;
    exports$1.MIN_REQUEST_TIMEOUT_SECONDS = 1;
    exports$1.REQUEST_TIMEOUT_HEADER = "x-fal-request-timeout";
    exports$1.REQUEST_TIMEOUT_TYPE_HEADER = "x-fal-request-timeout-type";
    exports$1.QUEUE_PRIORITY_HEADER = "x-fal-queue-priority";
    exports$1.RUNNER_HINT_HEADER = "x-fal-runner-hint";
    function validateTimeoutHeader(timeout) {
      if (typeof timeout !== "number" || isNaN(timeout)) {
        throw new Error(`Timeout must be a number, got ${timeout}`);
      }
      if (timeout <= exports$1.MIN_REQUEST_TIMEOUT_SECONDS) {
        throw new Error(`Timeout must be greater than ${exports$1.MIN_REQUEST_TIMEOUT_SECONDS} seconds`);
      }
      return timeout.toString();
    }
    function buildTimeoutHeaders(timeout) {
      if (timeout === void 0) {
        return {};
      }
      return {
        [exports$1.REQUEST_TIMEOUT_HEADER]: validateTimeoutHeader(timeout)
      };
    }
  })(headers);
  return headers;
}
var hasRequiredResponse;
function requireResponse() {
  if (hasRequiredResponse) return response;
  hasRequiredResponse = 1;
  var __awaiter = response && response.__awaiter || function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  Object.defineProperty(response, "__esModule", { value: true });
  response.ValidationError = response.ApiError = void 0;
  response.defaultResponseHandler = defaultResponseHandler;
  response.resultResponseHandler = resultResponseHandler;
  const headers_1 = requireHeaders();
  const REQUEST_ID_HEADER = "x-fal-request-id";
  class ApiError extends Error {
    constructor({ message, status, body, requestId, timeoutType }) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.body = body;
      this.requestId = requestId || "";
      this.timeoutType = timeoutType;
    }
    /**
     * Returns true if this error was caused by a user-specified timeout
     * (via startTimeout parameter). These errors should NOT be retried.
     */
    get isUserTimeout() {
      return this.status === 504 && this.timeoutType === "user";
    }
  }
  response.ApiError = ApiError;
  class ValidationError extends ApiError {
    constructor(args) {
      super(args);
      this.name = "ValidationError";
    }
    get fieldErrors() {
      if (typeof this.body.detail === "string") {
        return [
          {
            loc: ["body"],
            msg: this.body.detail,
            type: "value_error"
          }
        ];
      }
      return this.body.detail || [];
    }
    getFieldErrors(field) {
      return this.fieldErrors.filter((error) => error.loc[error.loc.length - 1] === field);
    }
  }
  response.ValidationError = ValidationError;
  function defaultResponseHandler(response2) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      const { status, statusText } = response2;
      const contentType = (_a = response2.headers.get("Content-Type")) !== null && _a !== void 0 ? _a : "";
      const requestId = response2.headers.get(REQUEST_ID_HEADER) || void 0;
      const timeoutType = response2.headers.get(headers_1.REQUEST_TIMEOUT_TYPE_HEADER) || void 0;
      if (!response2.ok) {
        if (contentType.includes("application/json")) {
          const body = yield response2.json();
          const ErrorType = status === 422 ? ValidationError : ApiError;
          throw new ErrorType({
            message: body.message || statusText,
            status,
            body,
            requestId,
            timeoutType
          });
        }
        throw new ApiError({
          message: `HTTP ${status}: ${statusText}`,
          status,
          requestId,
          timeoutType
        });
      }
      if (contentType.includes("application/json")) {
        return response2.json();
      }
      if (contentType.includes("text/html")) {
        return response2.text();
      }
      if (contentType.includes("application/octet-stream")) {
        return response2.arrayBuffer();
      }
      return response2.text();
    });
  }
  function resultResponseHandler(response2) {
    return __awaiter(this, void 0, void 0, function* () {
      const data = yield defaultResponseHandler(response2);
      return {
        data,
        requestId: response2.headers.get(REQUEST_ID_HEADER) || ""
      };
    });
  }
  return response;
}
var retry = {};
var utils = {};
var hasRequiredUtils;
function requireUtils() {
  if (hasRequiredUtils) return utils;
  hasRequiredUtils = 1;
  var __awaiter = utils && utils.__awaiter || function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  Object.defineProperty(utils, "__esModule", { value: true });
  utils.ensureEndpointIdFormat = ensureEndpointIdFormat;
  utils.parseEndpointId = parseEndpointId;
  utils.resolveEndpointPath = resolveEndpointPath;
  utils.isValidUrl = isValidUrl;
  utils.throttle = throttle;
  utils.isReact = isReact;
  utils.isPlainObject = isPlainObject;
  utils.sleep = sleep;
  function ensureEndpointIdFormat(id) {
    const parts = id.split("/");
    if (parts.length > 1) {
      return id;
    }
    const [, appOwner, appId] = /^([0-9]+)-([a-zA-Z0-9-]+)$/.exec(id) || [];
    if (appOwner && appId) {
      return `${appOwner}/${appId}`;
    }
    throw new Error(`Invalid app id: ${id}. Must be in the format <appOwner>/<appId>`);
  }
  const ENDPOINT_NAMESPACES = ["workflows", "comfy"];
  function parseEndpointId(id) {
    const normalizedId = ensureEndpointIdFormat(id);
    const parts = normalizedId.split("/");
    if (ENDPOINT_NAMESPACES.includes(parts[0])) {
      return {
        owner: parts[1],
        alias: parts[2],
        path: parts.slice(3).join("/") || void 0,
        namespace: parts[0]
      };
    }
    return {
      owner: parts[0],
      alias: parts[1],
      path: parts.slice(2).join("/") || void 0
    };
  }
  function resolveEndpointPath(app2, path2, defaultPath) {
    if (path2) {
      return `/${path2.replace(/^\/+/, "")}`;
    }
    if (app2.endsWith(defaultPath)) {
      return void 0;
    }
    return defaultPath;
  }
  function isValidUrl(url) {
    try {
      const { host } = new URL(url);
      return /(fal\.(ai|run))$/.test(host);
    } catch (_) {
      return false;
    }
  }
  function throttle(func, limit, leading = false) {
    let lastFunc;
    let lastRan;
    return (...args) => {
      if (!lastRan && leading) {
        func(...args);
        lastRan = Date.now();
      } else {
        if (lastFunc) {
          clearTimeout(lastFunc);
        }
        lastFunc = setTimeout(() => {
          if (Date.now() - lastRan >= limit) {
            func(...args);
            lastRan = Date.now();
          }
        }, limit - (Date.now() - lastRan));
      }
    };
  }
  let isRunningInReact;
  function isReact() {
    if (isRunningInReact === void 0) {
      const stack = new Error().stack;
      isRunningInReact = !!stack && (stack.includes("node_modules/react-dom/") || stack.includes("node_modules/next/"));
    }
    return isRunningInReact;
  }
  function isPlainObject(value) {
    return !!value && Object.getPrototypeOf(value) === Object.prototype;
  }
  function sleep(ms) {
    return __awaiter(this, void 0, void 0, function* () {
      return new Promise((resolve) => setTimeout(resolve, ms));
    });
  }
  return utils;
}
var hasRequiredRetry;
function requireRetry() {
  if (hasRequiredRetry) return retry;
  hasRequiredRetry = 1;
  (function(exports$1) {
    var __awaiter = retry && retry.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        function step(result) {
          result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
        }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports$1, "__esModule", { value: true });
    exports$1.DEFAULT_RETRY_OPTIONS = exports$1.DEFAULT_RETRYABLE_STATUS_CODES = void 0;
    exports$1.isRetryableError = isRetryableError;
    exports$1.calculateBackoffDelay = calculateBackoffDelay;
    exports$1.executeWithRetry = executeWithRetry;
    const response_1 = requireResponse();
    const utils_1 = requireUtils();
    exports$1.DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504];
    exports$1.DEFAULT_RETRY_OPTIONS = {
      maxRetries: 3,
      baseDelay: 1e3,
      maxDelay: 3e4,
      backoffMultiplier: 2,
      retryableStatusCodes: exports$1.DEFAULT_RETRYABLE_STATUS_CODES,
      enableJitter: true
    };
    function isRetryableError(error, retryableStatusCodes) {
      if (!(error instanceof response_1.ApiError)) {
        return false;
      }
      if (error.isUserTimeout) {
        return false;
      }
      return retryableStatusCodes.includes(error.status);
    }
    function calculateBackoffDelay(attempt, baseDelay, maxDelay, backoffMultiplier, enableJitter) {
      const exponentialDelay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt), maxDelay);
      if (enableJitter) {
        const jitter = 0.25 * exponentialDelay * (Math.random() * 2 - 1);
        return Math.max(0, exponentialDelay + jitter);
      }
      return exponentialDelay;
    }
    function executeWithRetry(operation, options, onRetry) {
      return __awaiter(this, void 0, void 0, function* () {
        const metrics = {
          totalAttempts: 0,
          totalDelay: 0
        };
        let lastError;
        for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
          metrics.totalAttempts++;
          try {
            const result = yield operation();
            return { result, metrics };
          } catch (error) {
            lastError = error;
            metrics.lastError = error;
            if (attempt === options.maxRetries || !isRetryableError(error, options.retryableStatusCodes)) {
              throw error;
            }
            const delay = calculateBackoffDelay(attempt, options.baseDelay, options.maxDelay, options.backoffMultiplier, options.enableJitter);
            metrics.totalDelay += delay;
            if (onRetry) {
              onRetry(attempt + 1, error, delay);
            }
            yield (0, utils_1.sleep)(delay);
          }
        }
        throw lastError;
      });
    }
  })(retry);
  return retry;
}
var runtime = {};
const name = "@fal-ai/client";
const version = "1.9.4";
const require$$0$1 = {
  name,
  version
};
var hasRequiredRuntime;
function requireRuntime() {
  if (hasRequiredRuntime) return runtime;
  hasRequiredRuntime = 1;
  Object.defineProperty(runtime, "__esModule", { value: true });
  runtime.isBrowser = isBrowser;
  runtime.getUserAgent = getUserAgent;
  function isBrowser() {
    return typeof window !== "undefined" && typeof window.document !== "undefined";
  }
  let memoizedUserAgent = null;
  function getUserAgent() {
    if (memoizedUserAgent !== null) {
      return memoizedUserAgent;
    }
    const packageInfo = require$$0$1;
    memoizedUserAgent = `${packageInfo.name}/${packageInfo.version}`;
    return memoizedUserAgent;
  }
  return runtime;
}
var hasRequiredConfig;
function requireConfig() {
  if (hasRequiredConfig) return config;
  hasRequiredConfig = 1;
  (function(exports$1) {
    Object.defineProperty(exports$1, "__esModule", { value: true });
    exports$1.credentialsFromEnv = void 0;
    exports$1.resolveDefaultFetch = resolveDefaultFetch;
    exports$1.createConfig = createConfig;
    exports$1.getRestApiUrl = getRestApiUrl;
    const middleware_1 = requireMiddleware();
    const response_1 = requireResponse();
    const retry_1 = requireRetry();
    const runtime_1 = requireRuntime();
    function resolveDefaultFetch() {
      if (typeof fetch === "undefined") {
        throw new Error("Your environment does not support fetch. Please provide your own fetch implementation.");
      }
      return fetch;
    }
    function hasEnvVariables() {
      return typeof process !== "undefined" && process.env && (typeof process.env.FAL_KEY !== "undefined" || typeof process.env.FAL_KEY_ID !== "undefined" && typeof process.env.FAL_KEY_SECRET !== "undefined");
    }
    const credentialsFromEnv = () => {
      if (!hasEnvVariables()) {
        return void 0;
      }
      if (typeof process.env.FAL_KEY !== "undefined") {
        return process.env.FAL_KEY;
      }
      return process.env.FAL_KEY_ID ? `${process.env.FAL_KEY_ID}:${process.env.FAL_KEY_SECRET}` : void 0;
    };
    exports$1.credentialsFromEnv = credentialsFromEnv;
    const DEFAULT_CONFIG = {
      credentials: exports$1.credentialsFromEnv,
      suppressLocalCredentialsWarning: false,
      requestMiddleware: (request2) => Promise.resolve(request2),
      responseHandler: response_1.defaultResponseHandler,
      retry: retry_1.DEFAULT_RETRY_OPTIONS
    };
    function createConfig(config2) {
      var _a;
      let configuration = Object.assign(Object.assign(Object.assign({}, DEFAULT_CONFIG), config2), {
        fetch: (_a = config2.fetch) !== null && _a !== void 0 ? _a : resolveDefaultFetch(),
        // Merge retry configuration with defaults
        retry: Object.assign(Object.assign({}, retry_1.DEFAULT_RETRY_OPTIONS), config2.retry || {})
      });
      if (config2.proxyUrl) {
        configuration = Object.assign(Object.assign({}, configuration), { requestMiddleware: (0, middleware_1.withMiddleware)(configuration.requestMiddleware, (0, middleware_1.withProxy)({ targetUrl: config2.proxyUrl })) });
      }
      const { credentials: resolveCredentials, suppressLocalCredentialsWarning } = configuration;
      const credentials = typeof resolveCredentials === "function" ? resolveCredentials() : resolveCredentials;
      if ((0, runtime_1.isBrowser)() && credentials && !suppressLocalCredentialsWarning) {
        console.warn("The fal credentials are exposed in the browser's environment. That's not recommended for production use cases.");
      }
      return configuration;
    }
    function getRestApiUrl() {
      return "https://rest.fal.ai";
    }
  })(config);
  return config;
}
var queue = {};
var request = {};
var hasRequiredRequest;
function requireRequest() {
  if (hasRequiredRequest) return request;
  hasRequiredRequest = 1;
  var __awaiter = request && request.__awaiter || function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  var __rest = request && request.__rest || function(s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
      t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
        if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
          t[p[i]] = s[p[i]];
      }
    return t;
  };
  Object.defineProperty(request, "__esModule", { value: true });
  request.dispatchRequest = dispatchRequest;
  request.buildUrl = buildUrl;
  const retry_1 = requireRetry();
  const runtime_1 = requireRuntime();
  const utils_1 = requireUtils();
  const isCloudflareWorkers = typeof navigator !== "undefined" && (navigator === null || navigator === void 0 ? void 0 : navigator.userAgent) === "Cloudflare-Workers";
  function dispatchRequest(params) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      const { targetUrl, input, config: config2, options = {} } = params;
      const { credentials: credentialsValue, requestMiddleware, responseHandler, fetch: fetch2 } = config2;
      const retryOptions = Object.assign(Object.assign({}, config2.retry), options.retry || {});
      const executeRequest = () => __awaiter(this, void 0, void 0, function* () {
        var _a2, _b, _c;
        const userAgent = (0, runtime_1.isBrowser)() ? {} : { "User-Agent": (0, runtime_1.getUserAgent)() };
        const credentials = typeof credentialsValue === "function" ? credentialsValue() : credentialsValue;
        const { method, url, headers: headers2 } = yield requestMiddleware({
          method: ((_b = (_a2 = params.method) !== null && _a2 !== void 0 ? _a2 : options.method) !== null && _b !== void 0 ? _b : "post").toUpperCase(),
          url: targetUrl,
          headers: params.headers
        });
        const authHeader = credentials ? { Authorization: `Key ${credentials}` } : {};
        const requestHeaders = Object.assign(Object.assign(Object.assign(Object.assign({}, authHeader), { Accept: "application/json", "Content-Type": "application/json" }), userAgent), headers2 !== null && headers2 !== void 0 ? headers2 : {});
        const { responseHandler: customResponseHandler, retry: _ } = options, requestInit = __rest(options, ["responseHandler", "retry"]);
        const response2 = yield fetch2(url, Object.assign(Object.assign(Object.assign(Object.assign({}, requestInit), { method, headers: Object.assign(Object.assign({}, requestHeaders), (_c = requestInit.headers) !== null && _c !== void 0 ? _c : {}) }), !isCloudflareWorkers && { mode: "cors" }), { signal: options.signal, body: method.toLowerCase() !== "get" && input ? JSON.stringify(input) : void 0 }));
        const handleResponse = customResponseHandler !== null && customResponseHandler !== void 0 ? customResponseHandler : responseHandler;
        return yield handleResponse(response2);
      });
      let lastError;
      for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
        try {
          return yield executeRequest();
        } catch (error) {
          lastError = error;
          const shouldNotRetry = attempt === retryOptions.maxRetries || !(0, retry_1.isRetryableError)(error, retryOptions.retryableStatusCodes) || ((_a = options.signal) === null || _a === void 0 ? void 0 : _a.aborted);
          if (shouldNotRetry) {
            throw error;
          }
          const delay = (0, retry_1.calculateBackoffDelay)(attempt, retryOptions.baseDelay, retryOptions.maxDelay, retryOptions.backoffMultiplier, retryOptions.enableJitter);
          yield (0, utils_1.sleep)(delay);
        }
      }
      throw lastError;
    });
  }
  function buildUrl(id, options = {}) {
    var _a, _b;
    const method = ((_a = options.method) !== null && _a !== void 0 ? _a : "post").toLowerCase();
    const path2 = ((_b = options.path) !== null && _b !== void 0 ? _b : "").replace(/^\//, "").replace(/\/{2,}/, "/");
    const input = options.input;
    const params = Object.assign(Object.assign({}, options.query || {}), method === "get" ? input : {});
    const queryParams = Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
    if ((0, utils_1.isValidUrl)(id)) {
      const url2 = id.endsWith("/") ? id : `${id}/`;
      return `${url2}${path2}${queryParams}`;
    }
    const appId = (0, utils_1.ensureEndpointIdFormat)(id);
    const subdomain = options.subdomain ? `${options.subdomain}.` : "";
    const url = `https://${subdomain}fal.run/${appId}/${path2}`;
    return `${url.replace(/\/$/, "")}${queryParams}`;
  }
  return request;
}
var storage = {};
var hasRequiredStorage;
function requireStorage() {
  if (hasRequiredStorage) return storage;
  hasRequiredStorage = 1;
  (function(exports$1) {
    var __awaiter = storage && storage.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        function step(result) {
          result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
        }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports$1, "__esModule", { value: true });
    exports$1.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = void 0;
    exports$1.getExpirationDurationSeconds = getExpirationDurationSeconds;
    exports$1.buildObjectLifecycleHeaders = buildObjectLifecycleHeaders;
    exports$1.createStorageClient = createStorageClient;
    const config_1 = requireConfig();
    const request_1 = requireRequest();
    const utils_1 = requireUtils();
    exports$1.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = "x-fal-object-lifecycle-preference";
    const EXPIRATION_VALUES = {
      never: 31536e5,
      // 100 years
      immediate: void 0,
      "1h": 3600,
      "1d": 86400,
      "7d": 604800,
      "30d": 2592e3,
      "1y": 31536e3
    };
    function getExpirationDurationSeconds(lifecycle) {
      const { expiresIn } = lifecycle;
      return typeof expiresIn === "number" ? expiresIn : EXPIRATION_VALUES[expiresIn];
    }
    function buildObjectLifecycleHeaders(lifecycle) {
      if (!lifecycle) {
        return {};
      }
      const expirationDurationSeconds = getExpirationDurationSeconds(lifecycle);
      if (expirationDurationSeconds === void 0) {
        return {};
      }
      return {
        [exports$1.OBJECT_LIFECYCYLE_PREFERENCE_HEADER]: JSON.stringify({
          expiration_duration_seconds: expirationDurationSeconds
        })
      };
    }
    function getExtensionFromContentType(contentType) {
      var _a;
      const [, fileType] = contentType.split("/");
      return (_a = fileType.split(/[-;]/)[0]) !== null && _a !== void 0 ? _a : "bin";
    }
    function initiateUpload(file, config2, contentType, lifecycle) {
      return __awaiter(this, void 0, void 0, function* () {
        const filename = file.name || `${Date.now()}.${getExtensionFromContentType(contentType)}`;
        const headers2 = {};
        if (lifecycle) {
          const lifecycleConfig = {
            expiration_duration_seconds: getExpirationDurationSeconds(lifecycle),
            allow_io_storage: lifecycle.expiresIn !== "immediate"
          };
          headers2["X-Fal-Object-Lifecycle"] = JSON.stringify(lifecycleConfig);
        }
        return yield (0, request_1.dispatchRequest)({
          method: "POST",
          // NOTE: We want to test V3 without making it the default at the API level
          targetUrl: `${(0, config_1.getRestApiUrl)()}/storage/upload/initiate?storage_type=fal-cdn-v3`,
          input: {
            content_type: contentType,
            file_name: filename
          },
          config: config2,
          headers: headers2
        });
      });
    }
    function initiateMultipartUpload(file, config2, contentType, lifecycle) {
      return __awaiter(this, void 0, void 0, function* () {
        const filename = file.name || `${Date.now()}.${getExtensionFromContentType(contentType)}`;
        const headers2 = {};
        if (lifecycle) {
          headers2["X-Fal-Object-Lifecycle"] = JSON.stringify(lifecycle);
        }
        return yield (0, request_1.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, config_1.getRestApiUrl)()}/storage/upload/initiate-multipart?storage_type=fal-cdn-v3`,
          input: {
            content_type: contentType,
            file_name: filename
          },
          config: config2,
          headers: headers2
        });
      });
    }
    function partUploadRetries(uploadUrl_1, chunk_1, config_2) {
      return __awaiter(this, arguments, void 0, function* (uploadUrl, chunk, config2, tries = 3) {
        if (tries === 0) {
          throw new Error("Part upload failed, retries exhausted");
        }
        const { fetch: fetch2, responseHandler } = config2;
        try {
          const response2 = yield fetch2(uploadUrl, {
            method: "PUT",
            body: chunk
          });
          return yield responseHandler(response2);
        } catch (error) {
          return yield partUploadRetries(uploadUrl, chunk, config2, tries - 1);
        }
      });
    }
    function multipartUpload(file, config2, lifecycle) {
      return __awaiter(this, void 0, void 0, function* () {
        const { fetch: fetch2, responseHandler } = config2;
        const contentType = file.type || "application/octet-stream";
        const { upload_url: uploadUrl, file_url: url } = yield initiateMultipartUpload(file, config2, contentType, lifecycle);
        const chunkSize = 10 * 1024 * 1024;
        const chunks = Math.ceil(file.size / chunkSize);
        const parsedUrl = new URL(uploadUrl);
        const responses = [];
        for (let i = 0; i < chunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);
          const partNumber = i + 1;
          const partUploadUrl = `${parsedUrl.origin}${parsedUrl.pathname}/${partNumber}${parsedUrl.search}`;
          responses.push(yield partUploadRetries(partUploadUrl, chunk, config2));
        }
        const completeUrl = `${parsedUrl.origin}${parsedUrl.pathname}/complete${parsedUrl.search}`;
        const response2 = yield fetch2(completeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parts: responses.map((mpart) => ({
              partNumber: mpart.partNumber,
              etag: mpart.etag
            }))
          })
        });
        yield responseHandler(response2);
        return url;
      });
    }
    function createStorageClient({ config: config2 }) {
      const ref = {
        upload: (file, options) => __awaiter(this, void 0, void 0, function* () {
          const lifecycle = options === null || options === void 0 ? void 0 : options.lifecycle;
          if (file.size > 90 * 1024 * 1024) {
            return yield multipartUpload(file, config2, lifecycle);
          }
          const contentType = file.type || "application/octet-stream";
          const { fetch: fetch2, responseHandler } = config2;
          const { upload_url: uploadUrl, file_url: url } = yield initiateUpload(file, config2, contentType, lifecycle);
          const response2 = yield fetch2(uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream"
            }
          });
          yield responseHandler(response2);
          return url;
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformInput: (input) => __awaiter(this, void 0, void 0, function* () {
          if (Array.isArray(input)) {
            return Promise.all(input.map((item) => ref.transformInput(item)));
          } else if (input instanceof Blob) {
            return yield ref.upload(input);
          } else if ((0, utils_1.isPlainObject)(input)) {
            const inputObject = input;
            const promises = Object.entries(inputObject).map((_a) => __awaiter(this, [_a], void 0, function* ([key, value]) {
              return [key, yield ref.transformInput(value)];
            }));
            const results = yield Promise.all(promises);
            return Object.fromEntries(results);
          }
          return input;
        })
      };
      return ref;
    }
  })(storage);
  return storage;
}
var streaming = {};
var dist = {};
var hasRequiredDist;
function requireDist() {
  if (hasRequiredDist) return dist;
  hasRequiredDist = 1;
  Object.defineProperty(dist, "__esModule", {
    value: true
  });
  function createParser(onParse) {
    let isFirstChunk;
    let buffer;
    let startingPosition;
    let startingFieldLength;
    let eventId;
    let eventName;
    let data;
    reset();
    return {
      feed,
      reset
    };
    function reset() {
      isFirstChunk = true;
      buffer = "";
      startingPosition = 0;
      startingFieldLength = -1;
      eventId = void 0;
      eventName = void 0;
      data = "";
    }
    function feed(chunk) {
      buffer = buffer ? buffer + chunk : chunk;
      if (isFirstChunk && hasBom(buffer)) {
        buffer = buffer.slice(BOM.length);
      }
      isFirstChunk = false;
      const length = buffer.length;
      let position = 0;
      let discardTrailingNewline = false;
      while (position < length) {
        if (discardTrailingNewline) {
          if (buffer[position] === "\n") {
            ++position;
          }
          discardTrailingNewline = false;
        }
        let lineLength = -1;
        let fieldLength = startingFieldLength;
        let character;
        for (let index = startingPosition; lineLength < 0 && index < length; ++index) {
          character = buffer[index];
          if (character === ":" && fieldLength < 0) {
            fieldLength = index - position;
          } else if (character === "\r") {
            discardTrailingNewline = true;
            lineLength = index - position;
          } else if (character === "\n") {
            lineLength = index - position;
          }
        }
        if (lineLength < 0) {
          startingPosition = length - position;
          startingFieldLength = fieldLength;
          break;
        } else {
          startingPosition = 0;
          startingFieldLength = -1;
        }
        parseEventStreamLine(buffer, position, fieldLength, lineLength);
        position += lineLength + 1;
      }
      if (position === length) {
        buffer = "";
      } else if (position > 0) {
        buffer = buffer.slice(position);
      }
    }
    function parseEventStreamLine(lineBuffer, index, fieldLength, lineLength) {
      if (lineLength === 0) {
        if (data.length > 0) {
          onParse({
            type: "event",
            id: eventId,
            event: eventName || void 0,
            data: data.slice(0, -1)
            // remove trailing newline
          });
          data = "";
          eventId = void 0;
        }
        eventName = void 0;
        return;
      }
      const noValue = fieldLength < 0;
      const field = lineBuffer.slice(index, index + (noValue ? lineLength : fieldLength));
      let step = 0;
      if (noValue) {
        step = lineLength;
      } else if (lineBuffer[index + fieldLength + 1] === " ") {
        step = fieldLength + 2;
      } else {
        step = fieldLength + 1;
      }
      const position = index + step;
      const valueLength = lineLength - step;
      const value = lineBuffer.slice(position, position + valueLength).toString();
      if (field === "data") {
        data += value ? "".concat(value, "\n") : "\n";
      } else if (field === "event") {
        eventName = value;
      } else if (field === "id" && !value.includes("\0")) {
        eventId = value;
      } else if (field === "retry") {
        const retry2 = parseInt(value, 10);
        if (!Number.isNaN(retry2)) {
          onParse({
            type: "reconnect-interval",
            value: retry2
          });
        }
      }
    }
  }
  const BOM = [239, 187, 191];
  function hasBom(buffer) {
    return BOM.every((charCode, index) => buffer.charCodeAt(index) === charCode);
  }
  dist.createParser = createParser;
  return dist;
}
var auth = {};
var hasRequiredAuth;
function requireAuth() {
  if (hasRequiredAuth) return auth;
  hasRequiredAuth = 1;
  (function(exports$1) {
    var __awaiter = auth && auth.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        function step(result) {
          result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
        }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports$1, "__esModule", { value: true });
    exports$1.TOKEN_EXPIRATION_SECONDS = void 0;
    exports$1.getTemporaryAuthToken = getTemporaryAuthToken;
    const config_1 = requireConfig();
    const request_1 = requireRequest();
    const utils_1 = requireUtils();
    exports$1.TOKEN_EXPIRATION_SECONDS = 120;
    function getTemporaryAuthToken(app2, config2) {
      return __awaiter(this, void 0, void 0, function* () {
        const appId = (0, utils_1.parseEndpointId)(app2);
        const token = yield (0, request_1.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, config_1.getRestApiUrl)()}/tokens/`,
          config: config2,
          input: {
            allowed_apps: [appId.alias],
            token_expiration: exports$1.TOKEN_EXPIRATION_SECONDS
          }
        });
        if (typeof token !== "string" && token["detail"]) {
          return token["detail"];
        }
        return token;
      });
    }
  })(auth);
  return auth;
}
var hasRequiredStreaming;
function requireStreaming() {
  if (hasRequiredStreaming) return streaming;
  hasRequiredStreaming = 1;
  var __awaiter = streaming && streaming.__awaiter || function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  var __await = streaming && streaming.__await || function(v) {
    return this instanceof __await ? (this.v = v, this) : new __await(v);
  };
  var __asyncGenerator = streaming && streaming.__asyncGenerator || function(thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = {}, verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function() {
      return this;
    }, i;
    function awaitReturn(f) {
      return function(v) {
        return Promise.resolve(v).then(f, reject);
      };
    }
    function verb(n, f) {
      if (g[n]) {
        i[n] = function(v) {
          return new Promise(function(a, b) {
            q.push([n, v, a, b]) > 1 || resume(n, v);
          });
        };
        if (f) i[n] = f(i[n]);
      }
    }
    function resume(n, v) {
      try {
        step(g[n](v));
      } catch (e) {
        settle(q[0][3], e);
      }
    }
    function step(r) {
      r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);
    }
    function fulfill(value) {
      resume("next", value);
    }
    function reject(value) {
      resume("throw", value);
    }
    function settle(f, v) {
      if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]);
    }
  };
  Object.defineProperty(streaming, "__esModule", { value: true });
  streaming.FalStream = void 0;
  streaming.createStreamingClient = createStreamingClient;
  const eventsource_parser_1 = /* @__PURE__ */ requireDist();
  const auth_1 = requireAuth();
  const request_1 = requireRequest();
  const response_1 = requireResponse();
  const utils_1 = requireUtils();
  const CONTENT_TYPE_EVENT_STREAM = "text/event-stream";
  const EVENT_STREAM_TIMEOUT = 15 * 1e3;
  class FalStream {
    constructor(endpointId, config2, options) {
      var _a;
      this.listeners = /* @__PURE__ */ new Map();
      this.buffer = [];
      this.currentData = void 0;
      this.lastEventTimestamp = 0;
      this.streamClosed = false;
      this._requestId = null;
      this.abortController = new AbortController();
      this.start = () => __awaiter(this, void 0, void 0, function* () {
        var _a2, _b, _c;
        const { endpointId: endpointId2, options: options2 } = this;
        const { input, method = "post", connectionMode = "server", tokenProvider } = options2;
        try {
          if (connectionMode === "client") {
            const appId = (0, utils_1.ensureEndpointIdFormat)(endpointId2);
            const resolvedPath = (_a2 = (0, utils_1.resolveEndpointPath)(endpointId2, void 0, "/stream")) !== null && _a2 !== void 0 ? _a2 : "";
            const fetchToken = tokenProvider ? () => tokenProvider(`${appId}${resolvedPath}`) : () => {
              console.warn('[fal.stream] Using the default token provider is deprecated. Please provide a `tokenProvider` function when using `connectionMode: "client"`. See https://docs.fal.ai/fal-client/authentication for more information.');
              return (0, auth_1.getTemporaryAuthToken)(endpointId2, this.config);
            };
            const token = yield fetchToken();
            const { fetch: fetch2 } = this.config;
            const parsedUrl = new URL(this.url);
            parsedUrl.searchParams.set("fal_jwt_token", token);
            const response2 = yield fetch2(parsedUrl.toString(), {
              method: method.toUpperCase(),
              headers: {
                accept: (_b = options2.accept) !== null && _b !== void 0 ? _b : CONTENT_TYPE_EVENT_STREAM,
                "content-type": "application/json"
              },
              body: input && method !== "get" ? JSON.stringify(input) : void 0,
              signal: this.abortController.signal
            });
            this._requestId = response2.headers.get("x-fal-request-id");
            return yield this.handleResponse(response2);
          }
          return yield (0, request_1.dispatchRequest)({
            method: method.toUpperCase(),
            targetUrl: this.url,
            input,
            config: this.config,
            options: {
              headers: {
                accept: (_c = options2.accept) !== null && _c !== void 0 ? _c : CONTENT_TYPE_EVENT_STREAM
              },
              responseHandler: (response2) => __awaiter(this, void 0, void 0, function* () {
                this._requestId = response2.headers.get("x-fal-request-id");
                return yield this.handleResponse(response2);
              }),
              signal: this.abortController.signal
            }
          });
        } catch (error) {
          this.handleError(error);
        }
      });
      this.handleResponse = (response2) => __awaiter(this, void 0, void 0, function* () {
        var _a2, _b;
        if (!response2.ok) {
          try {
            yield (0, response_1.defaultResponseHandler)(response2);
          } catch (error) {
            this.emit("error", error);
          }
          return;
        }
        const body = response2.body;
        if (!body) {
          this.emit("error", new response_1.ApiError({
            message: "Response body is empty.",
            status: 400,
            body: void 0,
            requestId: this._requestId || void 0
          }));
          return;
        }
        const isEventStream = ((_a2 = response2.headers.get("content-type")) !== null && _a2 !== void 0 ? _a2 : "").startsWith(CONTENT_TYPE_EVENT_STREAM);
        if (!isEventStream) {
          const reader2 = body.getReader();
          const emitRawChunk = () => {
            reader2.read().then(({ done, value }) => {
              if (done) {
                this.emit("done", this.currentData);
                return;
              }
              this.buffer.push(value);
              this.currentData = value;
              this.emit("data", value);
              emitRawChunk();
            });
          };
          emitRawChunk();
          return;
        }
        const decoder = new TextDecoder("utf-8");
        const reader = response2.body.getReader();
        const parser = (0, eventsource_parser_1.createParser)((event) => {
          if (event.type === "event") {
            const data = event.data;
            try {
              const parsedData = JSON.parse(data);
              this.buffer.push(parsedData);
              this.currentData = parsedData;
              this.emit("data", parsedData);
              this.emit("message", parsedData);
            } catch (e) {
              this.emit("error", e);
            }
          }
        });
        const timeout = (_b = this.options.timeout) !== null && _b !== void 0 ? _b : EVENT_STREAM_TIMEOUT;
        const readPartialResponse = () => __awaiter(this, void 0, void 0, function* () {
          const { value, done } = yield reader.read();
          this.lastEventTimestamp = Date.now();
          parser.feed(decoder.decode(value));
          if (Date.now() - this.lastEventTimestamp > timeout) {
            this.emit("error", new response_1.ApiError({
              message: `Event stream timed out after ${(timeout / 1e3).toFixed(0)} seconds with no messages.`,
              status: 408,
              requestId: this._requestId || void 0
            }));
          }
          if (!done) {
            readPartialResponse().catch(this.handleError);
          } else {
            this.emit("done", this.currentData);
          }
        });
        readPartialResponse().catch(this.handleError);
        return;
      });
      this.handleError = (error) => {
        var _a2;
        if (error.name === "AbortError" || this.signal.aborted) {
          return;
        }
        const apiError = error instanceof response_1.ApiError ? error : new response_1.ApiError({
          message: (_a2 = error.message) !== null && _a2 !== void 0 ? _a2 : "An unknown error occurred",
          status: 500,
          requestId: this._requestId || void 0
        });
        this.emit("error", apiError);
        return;
      };
      this.on = (type, listener) => {
        var _a2;
        if (!this.listeners.has(type)) {
          this.listeners.set(type, []);
        }
        (_a2 = this.listeners.get(type)) === null || _a2 === void 0 ? void 0 : _a2.push(listener);
      };
      this.emit = (type, event) => {
        const listeners = this.listeners.get(type) || [];
        for (const listener of listeners) {
          listener(event);
        }
      };
      this.done = () => __awaiter(this, void 0, void 0, function* () {
        return this.donePromise;
      });
      this.abort = (reason) => {
        if (!this.streamClosed) {
          this.abortController.abort(reason);
        }
      };
      this.endpointId = endpointId;
      this.config = config2;
      this.url = (_a = options.url) !== null && _a !== void 0 ? _a : (0, request_1.buildUrl)(endpointId, {
        path: (0, utils_1.resolveEndpointPath)(endpointId, void 0, "/stream"),
        query: options.queryParams
      });
      this.options = options;
      this.donePromise = new Promise((resolve, reject) => {
        if (this.streamClosed) {
          reject(new response_1.ApiError({
            message: "Streaming connection is already closed.",
            status: 400,
            body: void 0,
            requestId: this._requestId || void 0
          }));
        }
        this.signal.addEventListener("abort", () => {
          var _a2;
          resolve((_a2 = this.currentData) !== null && _a2 !== void 0 ? _a2 : {});
        });
        this.on("done", (data) => {
          this.streamClosed = true;
          resolve(data);
        });
        this.on("error", (error) => {
          this.streamClosed = true;
          reject(error);
        });
      });
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          this.abortController.abort();
        });
      }
      this.start().catch(this.handleError);
    }
    [Symbol.asyncIterator]() {
      return __asyncGenerator(this, arguments, function* _a() {
        let running = true;
        const stopAsyncIterator = () => running = false;
        this.on("error", stopAsyncIterator);
        this.on("done", stopAsyncIterator);
        while (running || this.buffer.length > 0) {
          const data = this.buffer.shift();
          if (data) {
            yield yield __await(data);
          }
          yield __await(new Promise((resolve) => setTimeout(resolve, 16)));
        }
      });
    }
    /**
     * Gets the `AbortSignal` instance that can be used to listen for abort events.
     *
     * **Note:** this signal is internal to the `FalStream` instance. If you pass your
     * own abort signal, the `FalStream` will listen to it and abort it appropriately.
     *
     * @returns the `AbortSignal` instance.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
     */
    get signal() {
      return this.abortController.signal;
    }
    /**
     * Gets the request id of the streaming request.
     *
     * @returns the request id.
     */
    get requestId() {
      return this._requestId;
    }
  }
  streaming.FalStream = FalStream;
  function createStreamingClient({ config: config2, storage: storage2 }) {
    return {
      stream(endpointId, options) {
        return __awaiter(this, void 0, void 0, function* () {
          const input = options.input ? yield storage2.transformInput(options.input) : void 0;
          return new FalStream(endpointId, config2, Object.assign(Object.assign({}, options), { input }));
        });
      }
    };
  }
  return streaming;
}
var hasRequiredQueue;
function requireQueue() {
  if (hasRequiredQueue) return queue;
  hasRequiredQueue = 1;
  var __awaiter = queue && queue.__awaiter || function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  var __rest = queue && queue.__rest || function(s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
      t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
        if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
          t[p[i]] = s[p[i]];
      }
    return t;
  };
  Object.defineProperty(queue, "__esModule", { value: true });
  queue.createQueueClient = void 0;
  const headers_1 = requireHeaders();
  const request_1 = requireRequest();
  const response_1 = requireResponse();
  const retry_1 = requireRetry();
  const storage_1 = requireStorage();
  const streaming_1 = requireStreaming();
  const utils_1 = requireUtils();
  const DEFAULT_POLL_INTERVAL = 500;
  const QUEUE_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1e3,
    maxDelay: 6e4,
    retryableStatusCodes: retry_1.DEFAULT_RETRYABLE_STATUS_CODES
  };
  const QUEUE_STATUS_RETRY_CONFIG = {
    maxRetries: 5,
    baseDelay: 1e3,
    maxDelay: 3e4,
    retryableStatusCodes: [...retry_1.DEFAULT_RETRYABLE_STATUS_CODES, 500]
  };
  const createQueueClient = ({ config: config2, storage: storage2 }) => {
    const ref = {
      submit(endpointId, options) {
        return __awaiter(this, void 0, void 0, function* () {
          const { webhookUrl, priority, hint, startTimeout, headers: headers2, storageSettings } = options, runOptions = __rest(options, ["webhookUrl", "priority", "hint", "startTimeout", "headers", "storageSettings"]);
          const input = options.input ? yield storage2.transformInput(options.input) : void 0;
          const extraHeaders = Object.fromEntries(Object.entries(headers2 !== null && headers2 !== void 0 ? headers2 : {}).map(([key, value]) => [
            key.toLowerCase(),
            value
          ]));
          return (0, request_1.dispatchRequest)({
            method: options.method,
            targetUrl: (0, request_1.buildUrl)(endpointId, Object.assign(Object.assign({}, runOptions), { subdomain: "queue", query: webhookUrl ? { fal_webhook: webhookUrl } : void 0 })),
            headers: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, extraHeaders), (0, storage_1.buildObjectLifecycleHeaders)(storageSettings)), { [headers_1.QUEUE_PRIORITY_HEADER]: priority !== null && priority !== void 0 ? priority : "normal" }), hint && { [headers_1.RUNNER_HINT_HEADER]: hint }), (0, headers_1.buildTimeoutHeaders)(startTimeout)),
            input,
            config: config2,
            options: {
              signal: options.abortSignal,
              retry: QUEUE_RETRY_CONFIG
            }
          });
        });
      },
      status(endpointId_1, _a) {
        return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, logs = false, abortSignal }) {
          const appId = (0, utils_1.parseEndpointId)(endpointId);
          const prefix = appId.namespace ? `${appId.namespace}/` : "";
          return (0, request_1.dispatchRequest)({
            method: "get",
            targetUrl: (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
              subdomain: "queue",
              query: { logs: logs ? "1" : "0" },
              path: `/requests/${requestId}/status`
            }),
            config: config2,
            options: {
              signal: abortSignal,
              retry: QUEUE_STATUS_RETRY_CONFIG
            }
          });
        });
      },
      streamStatus(endpointId_1, _a) {
        return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, logs = false, connectionMode }) {
          const appId = (0, utils_1.parseEndpointId)(endpointId);
          const prefix = appId.namespace ? `${appId.namespace}/` : "";
          const queryParams = {
            logs: logs ? "1" : "0"
          };
          const url = (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
            subdomain: "queue",
            path: `/requests/${requestId}/status/stream`,
            query: queryParams
          });
          return new streaming_1.FalStream(endpointId, config2, {
            url,
            method: "get",
            connectionMode,
            queryParams
          });
        });
      },
      subscribeToStatus(endpointId, options) {
        return __awaiter(this, void 0, void 0, function* () {
          const requestId = options.requestId;
          const timeout = options.timeout;
          let timeoutId = void 0;
          const handleCancelError = () => {
          };
          if (options.mode === "streaming") {
            const status = yield ref.streamStatus(endpointId, {
              requestId,
              logs: options.logs,
              connectionMode: "connectionMode" in options ? options.connectionMode : void 0
            });
            const logs = [];
            if (timeout) {
              timeoutId = setTimeout(() => {
                status.abort();
                ref.cancel(endpointId, { requestId }).catch(handleCancelError);
                throw new Error(`Client timed out waiting for the request to complete after ${timeout}ms`);
              }, timeout);
            }
            status.on("data", (data) => {
              if (options.onQueueUpdate) {
                if ("logs" in data && Array.isArray(data.logs) && data.logs.length > 0) {
                  logs.push(...data.logs);
                }
                options.onQueueUpdate("logs" in data ? Object.assign(Object.assign({}, data), { logs }) : data);
              }
            });
            const doneStatus = yield status.done();
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            return doneStatus;
          }
          return new Promise((resolve, reject) => {
            var _a;
            let pollingTimeoutId;
            const pollInterval = "pollInterval" in options && typeof options.pollInterval === "number" ? (_a = options.pollInterval) !== null && _a !== void 0 ? _a : DEFAULT_POLL_INTERVAL : DEFAULT_POLL_INTERVAL;
            const clearScheduledTasks = () => {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              if (pollingTimeoutId) {
                clearTimeout(pollingTimeoutId);
              }
            };
            if (timeout) {
              timeoutId = setTimeout(() => {
                clearScheduledTasks();
                ref.cancel(endpointId, { requestId }).catch(handleCancelError);
                reject(new Error(`Client timed out waiting for the request to complete after ${timeout}ms`));
              }, timeout);
            }
            const poll = () => __awaiter(this, void 0, void 0, function* () {
              var _a2;
              try {
                const requestStatus = yield ref.status(endpointId, {
                  requestId,
                  logs: (_a2 = options.logs) !== null && _a2 !== void 0 ? _a2 : false,
                  abortSignal: options.abortSignal
                });
                if (options.onQueueUpdate) {
                  options.onQueueUpdate(requestStatus);
                }
                if (requestStatus.status === "COMPLETED") {
                  clearScheduledTasks();
                  resolve(requestStatus);
                  return;
                }
                pollingTimeoutId = setTimeout(poll, pollInterval);
              } catch (error) {
                clearScheduledTasks();
                reject(error);
              }
            });
            poll().catch(reject);
          });
        });
      },
      result(endpointId_1, _a) {
        return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, abortSignal }) {
          const appId = (0, utils_1.parseEndpointId)(endpointId);
          const prefix = appId.namespace ? `${appId.namespace}/` : "";
          return (0, request_1.dispatchRequest)({
            method: "get",
            targetUrl: (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
              subdomain: "queue",
              path: `/requests/${requestId}`
            }),
            config: Object.assign(Object.assign({}, config2), { responseHandler: response_1.resultResponseHandler }),
            options: {
              signal: abortSignal,
              retry: QUEUE_RETRY_CONFIG
            }
          });
        });
      },
      cancel(endpointId_1, _a) {
        return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, abortSignal }) {
          const appId = (0, utils_1.parseEndpointId)(endpointId);
          const prefix = appId.namespace ? `${appId.namespace}/` : "";
          yield (0, request_1.dispatchRequest)({
            method: "put",
            targetUrl: (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
              subdomain: "queue",
              path: `/requests/${requestId}/cancel`
            }),
            config: config2,
            options: {
              signal: abortSignal
            }
          });
        });
      }
    };
    return ref;
  };
  queue.createQueueClient = createQueueClient;
  return queue;
}
var realtime = {};
function utf8Count(str) {
  const strLength = str.length;
  let byteLength = 0;
  let pos = 0;
  while (pos < strLength) {
    let value = str.charCodeAt(pos++);
    if ((value & 4294967168) === 0) {
      byteLength++;
      continue;
    } else if ((value & 4294965248) === 0) {
      byteLength += 2;
    } else {
      if (value >= 55296 && value <= 56319) {
        if (pos < strLength) {
          const extra = str.charCodeAt(pos);
          if ((extra & 64512) === 56320) {
            ++pos;
            value = ((value & 1023) << 10) + (extra & 1023) + 65536;
          }
        }
      }
      if ((value & 4294901760) === 0) {
        byteLength += 3;
      } else {
        byteLength += 4;
      }
    }
  }
  return byteLength;
}
function utf8EncodeJs(str, output, outputOffset) {
  const strLength = str.length;
  let offset = outputOffset;
  let pos = 0;
  while (pos < strLength) {
    let value = str.charCodeAt(pos++);
    if ((value & 4294967168) === 0) {
      output[offset++] = value;
      continue;
    } else if ((value & 4294965248) === 0) {
      output[offset++] = value >> 6 & 31 | 192;
    } else {
      if (value >= 55296 && value <= 56319) {
        if (pos < strLength) {
          const extra = str.charCodeAt(pos);
          if ((extra & 64512) === 56320) {
            ++pos;
            value = ((value & 1023) << 10) + (extra & 1023) + 65536;
          }
        }
      }
      if ((value & 4294901760) === 0) {
        output[offset++] = value >> 12 & 15 | 224;
        output[offset++] = value >> 6 & 63 | 128;
      } else {
        output[offset++] = value >> 18 & 7 | 240;
        output[offset++] = value >> 12 & 63 | 128;
        output[offset++] = value >> 6 & 63 | 128;
      }
    }
    output[offset++] = value & 63 | 128;
  }
}
const sharedTextEncoder = new TextEncoder();
const TEXT_ENCODER_THRESHOLD = 50;
function utf8EncodeTE(str, output, outputOffset) {
  sharedTextEncoder.encodeInto(str, output.subarray(outputOffset));
}
function utf8Encode(str, output, outputOffset) {
  if (str.length > TEXT_ENCODER_THRESHOLD) {
    utf8EncodeTE(str, output, outputOffset);
  } else {
    utf8EncodeJs(str, output, outputOffset);
  }
}
const CHUNK_SIZE = 4096;
function utf8DecodeJs(bytes, inputOffset, byteLength) {
  let offset = inputOffset;
  const end = offset + byteLength;
  const units = [];
  let result = "";
  while (offset < end) {
    const byte1 = bytes[offset++];
    if ((byte1 & 128) === 0) {
      units.push(byte1);
    } else if ((byte1 & 224) === 192) {
      const byte2 = bytes[offset++] & 63;
      units.push((byte1 & 31) << 6 | byte2);
    } else if ((byte1 & 240) === 224) {
      const byte2 = bytes[offset++] & 63;
      const byte3 = bytes[offset++] & 63;
      units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
    } else if ((byte1 & 248) === 240) {
      const byte2 = bytes[offset++] & 63;
      const byte3 = bytes[offset++] & 63;
      const byte4 = bytes[offset++] & 63;
      let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
      if (unit > 65535) {
        unit -= 65536;
        units.push(unit >>> 10 & 1023 | 55296);
        unit = 56320 | unit & 1023;
      }
      units.push(unit);
    } else {
      units.push(byte1);
    }
    if (units.length >= CHUNK_SIZE) {
      result += String.fromCharCode(...units);
      units.length = 0;
    }
  }
  if (units.length > 0) {
    result += String.fromCharCode(...units);
  }
  return result;
}
const sharedTextDecoder = new TextDecoder();
const TEXT_DECODER_THRESHOLD = 200;
function utf8DecodeTD(bytes, inputOffset, byteLength) {
  const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
  return sharedTextDecoder.decode(stringBytes);
}
function utf8Decode(bytes, inputOffset, byteLength) {
  if (byteLength > TEXT_DECODER_THRESHOLD) {
    return utf8DecodeTD(bytes, inputOffset, byteLength);
  } else {
    return utf8DecodeJs(bytes, inputOffset, byteLength);
  }
}
class ExtData {
  constructor(type, data) {
    __publicField(this, "type");
    __publicField(this, "data");
    this.type = type;
    this.data = data;
  }
}
class DecodeError extends Error {
  constructor(message) {
    super(message);
    const proto = Object.create(DecodeError.prototype);
    Object.setPrototypeOf(this, proto);
    Object.defineProperty(this, "name", {
      configurable: true,
      enumerable: false,
      value: DecodeError.name
    });
  }
}
const UINT32_MAX = 4294967295;
function setUint64(view, offset, value) {
  const high = value / 4294967296;
  const low = value;
  view.setUint32(offset, high);
  view.setUint32(offset + 4, low);
}
function setInt64(view, offset, value) {
  const high = Math.floor(value / 4294967296);
  const low = value;
  view.setUint32(offset, high);
  view.setUint32(offset + 4, low);
}
function getInt64(view, offset) {
  const high = view.getInt32(offset);
  const low = view.getUint32(offset + 4);
  return high * 4294967296 + low;
}
function getUint64(view, offset) {
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  return high * 4294967296 + low;
}
const EXT_TIMESTAMP = -1;
const TIMESTAMP32_MAX_SEC = 4294967296 - 1;
const TIMESTAMP64_MAX_SEC = 17179869184 - 1;
function encodeTimeSpecToTimestamp({ sec, nsec }) {
  if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
    if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
      const rv = new Uint8Array(4);
      const view = new DataView(rv.buffer);
      view.setUint32(0, sec);
      return rv;
    } else {
      const secHigh = sec / 4294967296;
      const secLow = sec & 4294967295;
      const rv = new Uint8Array(8);
      const view = new DataView(rv.buffer);
      view.setUint32(0, nsec << 2 | secHigh & 3);
      view.setUint32(4, secLow);
      return rv;
    }
  } else {
    const rv = new Uint8Array(12);
    const view = new DataView(rv.buffer);
    view.setUint32(0, nsec);
    setInt64(view, 4, sec);
    return rv;
  }
}
function encodeDateToTimeSpec(date) {
  const msec = date.getTime();
  const sec = Math.floor(msec / 1e3);
  const nsec = (msec - sec * 1e3) * 1e6;
  const nsecInSec = Math.floor(nsec / 1e9);
  return {
    sec: sec + nsecInSec,
    nsec: nsec - nsecInSec * 1e9
  };
}
function encodeTimestampExtension(object) {
  if (object instanceof Date) {
    const timeSpec = encodeDateToTimeSpec(object);
    return encodeTimeSpecToTimestamp(timeSpec);
  } else {
    return null;
  }
}
function decodeTimestampToTimeSpec(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (data.byteLength) {
    case 4: {
      const sec = view.getUint32(0);
      const nsec = 0;
      return { sec, nsec };
    }
    case 8: {
      const nsec30AndSecHigh2 = view.getUint32(0);
      const secLow32 = view.getUint32(4);
      const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
      const nsec = nsec30AndSecHigh2 >>> 2;
      return { sec, nsec };
    }
    case 12: {
      const sec = getInt64(view, 4);
      const nsec = view.getUint32(0);
      return { sec, nsec };
    }
    default:
      throw new DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
  }
}
function decodeTimestampExtension(data) {
  const timeSpec = decodeTimestampToTimeSpec(data);
  return new Date(timeSpec.sec * 1e3 + timeSpec.nsec / 1e6);
}
const timestampExtension = {
  type: EXT_TIMESTAMP,
  encode: encodeTimestampExtension,
  decode: decodeTimestampExtension
};
const _ExtensionCodec = class _ExtensionCodec {
  constructor() {
    // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
    // this will make type errors a lot more clear
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __publicField(this, "__brand");
    // built-in extensions
    __publicField(this, "builtInEncoders", []);
    __publicField(this, "builtInDecoders", []);
    // custom extensions
    __publicField(this, "encoders", []);
    __publicField(this, "decoders", []);
    this.register(timestampExtension);
  }
  register({ type, encode: encode2, decode: decode2 }) {
    if (type >= 0) {
      this.encoders[type] = encode2;
      this.decoders[type] = decode2;
    } else {
      const index = -1 - type;
      this.builtInEncoders[index] = encode2;
      this.builtInDecoders[index] = decode2;
    }
  }
  tryToEncode(object, context) {
    for (let i = 0; i < this.builtInEncoders.length; i++) {
      const encodeExt = this.builtInEncoders[i];
      if (encodeExt != null) {
        const data = encodeExt(object, context);
        if (data != null) {
          const type = -1 - i;
          return new ExtData(type, data);
        }
      }
    }
    for (let i = 0; i < this.encoders.length; i++) {
      const encodeExt = this.encoders[i];
      if (encodeExt != null) {
        const data = encodeExt(object, context);
        if (data != null) {
          const type = i;
          return new ExtData(type, data);
        }
      }
    }
    if (object instanceof ExtData) {
      return object;
    }
    return null;
  }
  decode(data, type, context) {
    const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
    if (decodeExt) {
      return decodeExt(data, type, context);
    } else {
      return new ExtData(type, data);
    }
  }
};
__publicField(_ExtensionCodec, "defaultCodec", new _ExtensionCodec());
let ExtensionCodec = _ExtensionCodec;
function isArrayBufferLike(buffer) {
  return buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
}
function ensureUint8Array(buffer) {
  if (buffer instanceof Uint8Array) {
    return buffer;
  } else if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else if (isArrayBufferLike(buffer)) {
    return new Uint8Array(buffer);
  } else {
    return Uint8Array.from(buffer);
  }
}
const DEFAULT_MAX_DEPTH = 100;
const DEFAULT_INITIAL_BUFFER_SIZE = 2048;
class Encoder {
  constructor(options) {
    __publicField(this, "extensionCodec");
    __publicField(this, "context");
    __publicField(this, "useBigInt64");
    __publicField(this, "maxDepth");
    __publicField(this, "initialBufferSize");
    __publicField(this, "sortKeys");
    __publicField(this, "forceFloat32");
    __publicField(this, "ignoreUndefined");
    __publicField(this, "forceIntegerToFloat");
    __publicField(this, "pos");
    __publicField(this, "view");
    __publicField(this, "bytes");
    __publicField(this, "entered", false);
    this.extensionCodec = (options == null ? void 0 : options.extensionCodec) ?? ExtensionCodec.defaultCodec;
    this.context = options == null ? void 0 : options.context;
    this.useBigInt64 = (options == null ? void 0 : options.useBigInt64) ?? false;
    this.maxDepth = (options == null ? void 0 : options.maxDepth) ?? DEFAULT_MAX_DEPTH;
    this.initialBufferSize = (options == null ? void 0 : options.initialBufferSize) ?? DEFAULT_INITIAL_BUFFER_SIZE;
    this.sortKeys = (options == null ? void 0 : options.sortKeys) ?? false;
    this.forceFloat32 = (options == null ? void 0 : options.forceFloat32) ?? false;
    this.ignoreUndefined = (options == null ? void 0 : options.ignoreUndefined) ?? false;
    this.forceIntegerToFloat = (options == null ? void 0 : options.forceIntegerToFloat) ?? false;
    this.pos = 0;
    this.view = new DataView(new ArrayBuffer(this.initialBufferSize));
    this.bytes = new Uint8Array(this.view.buffer);
  }
  clone() {
    return new Encoder({
      extensionCodec: this.extensionCodec,
      context: this.context,
      useBigInt64: this.useBigInt64,
      maxDepth: this.maxDepth,
      initialBufferSize: this.initialBufferSize,
      sortKeys: this.sortKeys,
      forceFloat32: this.forceFloat32,
      ignoreUndefined: this.ignoreUndefined,
      forceIntegerToFloat: this.forceIntegerToFloat
    });
  }
  reinitializeState() {
    this.pos = 0;
  }
  /**
   * This is almost equivalent to {@link Encoder#encode}, but it returns an reference of the encoder's internal buffer and thus much faster than {@link Encoder#encode}.
   *
   * @returns Encodes the object and returns a shared reference the encoder's internal buffer.
   */
  encodeSharedRef(object) {
    if (this.entered) {
      const instance = this.clone();
      return instance.encodeSharedRef(object);
    }
    try {
      this.entered = true;
      this.reinitializeState();
      this.doEncode(object, 1);
      return this.bytes.subarray(0, this.pos);
    } finally {
      this.entered = false;
    }
  }
  /**
   * @returns Encodes the object and returns a copy of the encoder's internal buffer.
   */
  encode(object) {
    if (this.entered) {
      const instance = this.clone();
      return instance.encode(object);
    }
    try {
      this.entered = true;
      this.reinitializeState();
      this.doEncode(object, 1);
      return this.bytes.slice(0, this.pos);
    } finally {
      this.entered = false;
    }
  }
  doEncode(object, depth) {
    if (depth > this.maxDepth) {
      throw new Error(`Too deep objects in depth ${depth}`);
    }
    if (object == null) {
      this.encodeNil();
    } else if (typeof object === "boolean") {
      this.encodeBoolean(object);
    } else if (typeof object === "number") {
      if (!this.forceIntegerToFloat) {
        this.encodeNumber(object);
      } else {
        this.encodeNumberAsFloat(object);
      }
    } else if (typeof object === "string") {
      this.encodeString(object);
    } else if (this.useBigInt64 && typeof object === "bigint") {
      this.encodeBigInt64(object);
    } else {
      this.encodeObject(object, depth);
    }
  }
  ensureBufferSizeToWrite(sizeToWrite) {
    const requiredSize = this.pos + sizeToWrite;
    if (this.view.byteLength < requiredSize) {
      this.resizeBuffer(requiredSize * 2);
    }
  }
  resizeBuffer(newSize) {
    const newBuffer = new ArrayBuffer(newSize);
    const newBytes = new Uint8Array(newBuffer);
    const newView = new DataView(newBuffer);
    newBytes.set(this.bytes);
    this.view = newView;
    this.bytes = newBytes;
  }
  encodeNil() {
    this.writeU8(192);
  }
  encodeBoolean(object) {
    if (object === false) {
      this.writeU8(194);
    } else {
      this.writeU8(195);
    }
  }
  encodeNumber(object) {
    if (!this.forceIntegerToFloat && Number.isSafeInteger(object)) {
      if (object >= 0) {
        if (object < 128) {
          this.writeU8(object);
        } else if (object < 256) {
          this.writeU8(204);
          this.writeU8(object);
        } else if (object < 65536) {
          this.writeU8(205);
          this.writeU16(object);
        } else if (object < 4294967296) {
          this.writeU8(206);
          this.writeU32(object);
        } else if (!this.useBigInt64) {
          this.writeU8(207);
          this.writeU64(object);
        } else {
          this.encodeNumberAsFloat(object);
        }
      } else {
        if (object >= -32) {
          this.writeU8(224 | object + 32);
        } else if (object >= -128) {
          this.writeU8(208);
          this.writeI8(object);
        } else if (object >= -32768) {
          this.writeU8(209);
          this.writeI16(object);
        } else if (object >= -2147483648) {
          this.writeU8(210);
          this.writeI32(object);
        } else if (!this.useBigInt64) {
          this.writeU8(211);
          this.writeI64(object);
        } else {
          this.encodeNumberAsFloat(object);
        }
      }
    } else {
      this.encodeNumberAsFloat(object);
    }
  }
  encodeNumberAsFloat(object) {
    if (this.forceFloat32) {
      this.writeU8(202);
      this.writeF32(object);
    } else {
      this.writeU8(203);
      this.writeF64(object);
    }
  }
  encodeBigInt64(object) {
    if (object >= BigInt(0)) {
      this.writeU8(207);
      this.writeBigUint64(object);
    } else {
      this.writeU8(211);
      this.writeBigInt64(object);
    }
  }
  writeStringHeader(byteLength) {
    if (byteLength < 32) {
      this.writeU8(160 + byteLength);
    } else if (byteLength < 256) {
      this.writeU8(217);
      this.writeU8(byteLength);
    } else if (byteLength < 65536) {
      this.writeU8(218);
      this.writeU16(byteLength);
    } else if (byteLength < 4294967296) {
      this.writeU8(219);
      this.writeU32(byteLength);
    } else {
      throw new Error(`Too long string: ${byteLength} bytes in UTF-8`);
    }
  }
  encodeString(object) {
    const maxHeaderSize = 1 + 4;
    const byteLength = utf8Count(object);
    this.ensureBufferSizeToWrite(maxHeaderSize + byteLength);
    this.writeStringHeader(byteLength);
    utf8Encode(object, this.bytes, this.pos);
    this.pos += byteLength;
  }
  encodeObject(object, depth) {
    const ext = this.extensionCodec.tryToEncode(object, this.context);
    if (ext != null) {
      this.encodeExtension(ext);
    } else if (Array.isArray(object)) {
      this.encodeArray(object, depth);
    } else if (ArrayBuffer.isView(object)) {
      this.encodeBinary(object);
    } else if (typeof object === "object") {
      this.encodeMap(object, depth);
    } else {
      throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(object)}`);
    }
  }
  encodeBinary(object) {
    const size = object.byteLength;
    if (size < 256) {
      this.writeU8(196);
      this.writeU8(size);
    } else if (size < 65536) {
      this.writeU8(197);
      this.writeU16(size);
    } else if (size < 4294967296) {
      this.writeU8(198);
      this.writeU32(size);
    } else {
      throw new Error(`Too large binary: ${size}`);
    }
    const bytes = ensureUint8Array(object);
    this.writeU8a(bytes);
  }
  encodeArray(object, depth) {
    const size = object.length;
    if (size < 16) {
      this.writeU8(144 + size);
    } else if (size < 65536) {
      this.writeU8(220);
      this.writeU16(size);
    } else if (size < 4294967296) {
      this.writeU8(221);
      this.writeU32(size);
    } else {
      throw new Error(`Too large array: ${size}`);
    }
    for (const item of object) {
      this.doEncode(item, depth + 1);
    }
  }
  countWithoutUndefined(object, keys) {
    let count = 0;
    for (const key of keys) {
      if (object[key] !== void 0) {
        count++;
      }
    }
    return count;
  }
  encodeMap(object, depth) {
    const keys = Object.keys(object);
    if (this.sortKeys) {
      keys.sort();
    }
    const size = this.ignoreUndefined ? this.countWithoutUndefined(object, keys) : keys.length;
    if (size < 16) {
      this.writeU8(128 + size);
    } else if (size < 65536) {
      this.writeU8(222);
      this.writeU16(size);
    } else if (size < 4294967296) {
      this.writeU8(223);
      this.writeU32(size);
    } else {
      throw new Error(`Too large map object: ${size}`);
    }
    for (const key of keys) {
      const value = object[key];
      if (!(this.ignoreUndefined && value === void 0)) {
        this.encodeString(key);
        this.doEncode(value, depth + 1);
      }
    }
  }
  encodeExtension(ext) {
    if (typeof ext.data === "function") {
      const data = ext.data(this.pos + 6);
      const size2 = data.length;
      if (size2 >= 4294967296) {
        throw new Error(`Too large extension object: ${size2}`);
      }
      this.writeU8(201);
      this.writeU32(size2);
      this.writeI8(ext.type);
      this.writeU8a(data);
      return;
    }
    const size = ext.data.length;
    if (size === 1) {
      this.writeU8(212);
    } else if (size === 2) {
      this.writeU8(213);
    } else if (size === 4) {
      this.writeU8(214);
    } else if (size === 8) {
      this.writeU8(215);
    } else if (size === 16) {
      this.writeU8(216);
    } else if (size < 256) {
      this.writeU8(199);
      this.writeU8(size);
    } else if (size < 65536) {
      this.writeU8(200);
      this.writeU16(size);
    } else if (size < 4294967296) {
      this.writeU8(201);
      this.writeU32(size);
    } else {
      throw new Error(`Too large extension object: ${size}`);
    }
    this.writeI8(ext.type);
    this.writeU8a(ext.data);
  }
  writeU8(value) {
    this.ensureBufferSizeToWrite(1);
    this.view.setUint8(this.pos, value);
    this.pos++;
  }
  writeU8a(values) {
    const size = values.length;
    this.ensureBufferSizeToWrite(size);
    this.bytes.set(values, this.pos);
    this.pos += size;
  }
  writeI8(value) {
    this.ensureBufferSizeToWrite(1);
    this.view.setInt8(this.pos, value);
    this.pos++;
  }
  writeU16(value) {
    this.ensureBufferSizeToWrite(2);
    this.view.setUint16(this.pos, value);
    this.pos += 2;
  }
  writeI16(value) {
    this.ensureBufferSizeToWrite(2);
    this.view.setInt16(this.pos, value);
    this.pos += 2;
  }
  writeU32(value) {
    this.ensureBufferSizeToWrite(4);
    this.view.setUint32(this.pos, value);
    this.pos += 4;
  }
  writeI32(value) {
    this.ensureBufferSizeToWrite(4);
    this.view.setInt32(this.pos, value);
    this.pos += 4;
  }
  writeF32(value) {
    this.ensureBufferSizeToWrite(4);
    this.view.setFloat32(this.pos, value);
    this.pos += 4;
  }
  writeF64(value) {
    this.ensureBufferSizeToWrite(8);
    this.view.setFloat64(this.pos, value);
    this.pos += 8;
  }
  writeU64(value) {
    this.ensureBufferSizeToWrite(8);
    setUint64(this.view, this.pos, value);
    this.pos += 8;
  }
  writeI64(value) {
    this.ensureBufferSizeToWrite(8);
    setInt64(this.view, this.pos, value);
    this.pos += 8;
  }
  writeBigUint64(value) {
    this.ensureBufferSizeToWrite(8);
    this.view.setBigUint64(this.pos, value);
    this.pos += 8;
  }
  writeBigInt64(value) {
    this.ensureBufferSizeToWrite(8);
    this.view.setBigInt64(this.pos, value);
    this.pos += 8;
  }
}
function encode(value, options) {
  const encoder = new Encoder(options);
  return encoder.encodeSharedRef(value);
}
function prettyByte(byte) {
  return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
}
const DEFAULT_MAX_KEY_LENGTH = 16;
const DEFAULT_MAX_LENGTH_PER_KEY = 16;
class CachedKeyDecoder {
  constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
    __publicField(this, "hit", 0);
    __publicField(this, "miss", 0);
    __publicField(this, "caches");
    __publicField(this, "maxKeyLength");
    __publicField(this, "maxLengthPerKey");
    this.maxKeyLength = maxKeyLength;
    this.maxLengthPerKey = maxLengthPerKey;
    this.caches = [];
    for (let i = 0; i < this.maxKeyLength; i++) {
      this.caches.push([]);
    }
  }
  canBeCached(byteLength) {
    return byteLength > 0 && byteLength <= this.maxKeyLength;
  }
  find(bytes, inputOffset, byteLength) {
    const records = this.caches[byteLength - 1];
    FIND_CHUNK: for (const record of records) {
      const recordBytes = record.bytes;
      for (let j = 0; j < byteLength; j++) {
        if (recordBytes[j] !== bytes[inputOffset + j]) {
          continue FIND_CHUNK;
        }
      }
      return record.str;
    }
    return null;
  }
  store(bytes, value) {
    const records = this.caches[bytes.length - 1];
    const record = { bytes, str: value };
    if (records.length >= this.maxLengthPerKey) {
      records[Math.random() * records.length | 0] = record;
    } else {
      records.push(record);
    }
  }
  decode(bytes, inputOffset, byteLength) {
    const cachedValue = this.find(bytes, inputOffset, byteLength);
    if (cachedValue != null) {
      this.hit++;
      return cachedValue;
    }
    this.miss++;
    const str = utf8DecodeJs(bytes, inputOffset, byteLength);
    const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
    this.store(slicedCopyOfBytes, str);
    return str;
  }
}
const STATE_ARRAY = "array";
const STATE_MAP_KEY = "map_key";
const STATE_MAP_VALUE = "map_value";
const mapKeyConverter = (key) => {
  if (typeof key === "string" || typeof key === "number") {
    return key;
  }
  throw new DecodeError("The type of key must be string or number but " + typeof key);
};
class StackPool {
  constructor() {
    __publicField(this, "stack", []);
    __publicField(this, "stackHeadPosition", -1);
  }
  get length() {
    return this.stackHeadPosition + 1;
  }
  top() {
    return this.stack[this.stackHeadPosition];
  }
  pushArrayState(size) {
    const state = this.getUninitializedStateFromPool();
    state.type = STATE_ARRAY;
    state.position = 0;
    state.size = size;
    state.array = new Array(size);
  }
  pushMapState(size) {
    const state = this.getUninitializedStateFromPool();
    state.type = STATE_MAP_KEY;
    state.readCount = 0;
    state.size = size;
    state.map = {};
  }
  getUninitializedStateFromPool() {
    this.stackHeadPosition++;
    if (this.stackHeadPosition === this.stack.length) {
      const partialState = {
        type: void 0,
        size: 0,
        array: void 0,
        position: 0,
        readCount: 0,
        map: void 0,
        key: null
      };
      this.stack.push(partialState);
    }
    return this.stack[this.stackHeadPosition];
  }
  release(state) {
    const topStackState = this.stack[this.stackHeadPosition];
    if (topStackState !== state) {
      throw new Error("Invalid stack state. Released state is not on top of the stack.");
    }
    if (state.type === STATE_ARRAY) {
      const partialState = state;
      partialState.size = 0;
      partialState.array = void 0;
      partialState.position = 0;
      partialState.type = void 0;
    }
    if (state.type === STATE_MAP_KEY || state.type === STATE_MAP_VALUE) {
      const partialState = state;
      partialState.size = 0;
      partialState.map = void 0;
      partialState.readCount = 0;
      partialState.type = void 0;
    }
    this.stackHeadPosition--;
  }
  reset() {
    this.stack.length = 0;
    this.stackHeadPosition = -1;
  }
}
const HEAD_BYTE_REQUIRED = -1;
const EMPTY_VIEW = new DataView(new ArrayBuffer(0));
const EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
try {
  EMPTY_VIEW.getInt8(0);
} catch (e) {
  if (!(e instanceof RangeError)) {
    throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
  }
}
const MORE_DATA = new RangeError("Insufficient data");
const sharedCachedKeyDecoder = new CachedKeyDecoder();
class Decoder {
  constructor(options) {
    __publicField(this, "extensionCodec");
    __publicField(this, "context");
    __publicField(this, "useBigInt64");
    __publicField(this, "rawStrings");
    __publicField(this, "maxStrLength");
    __publicField(this, "maxBinLength");
    __publicField(this, "maxArrayLength");
    __publicField(this, "maxMapLength");
    __publicField(this, "maxExtLength");
    __publicField(this, "keyDecoder");
    __publicField(this, "mapKeyConverter");
    __publicField(this, "totalPos", 0);
    __publicField(this, "pos", 0);
    __publicField(this, "view", EMPTY_VIEW);
    __publicField(this, "bytes", EMPTY_BYTES);
    __publicField(this, "headByte", HEAD_BYTE_REQUIRED);
    __publicField(this, "stack", new StackPool());
    __publicField(this, "entered", false);
    this.extensionCodec = (options == null ? void 0 : options.extensionCodec) ?? ExtensionCodec.defaultCodec;
    this.context = options == null ? void 0 : options.context;
    this.useBigInt64 = (options == null ? void 0 : options.useBigInt64) ?? false;
    this.rawStrings = (options == null ? void 0 : options.rawStrings) ?? false;
    this.maxStrLength = (options == null ? void 0 : options.maxStrLength) ?? UINT32_MAX;
    this.maxBinLength = (options == null ? void 0 : options.maxBinLength) ?? UINT32_MAX;
    this.maxArrayLength = (options == null ? void 0 : options.maxArrayLength) ?? UINT32_MAX;
    this.maxMapLength = (options == null ? void 0 : options.maxMapLength) ?? UINT32_MAX;
    this.maxExtLength = (options == null ? void 0 : options.maxExtLength) ?? UINT32_MAX;
    this.keyDecoder = (options == null ? void 0 : options.keyDecoder) !== void 0 ? options.keyDecoder : sharedCachedKeyDecoder;
    this.mapKeyConverter = (options == null ? void 0 : options.mapKeyConverter) ?? mapKeyConverter;
  }
  clone() {
    return new Decoder({
      extensionCodec: this.extensionCodec,
      context: this.context,
      useBigInt64: this.useBigInt64,
      rawStrings: this.rawStrings,
      maxStrLength: this.maxStrLength,
      maxBinLength: this.maxBinLength,
      maxArrayLength: this.maxArrayLength,
      maxMapLength: this.maxMapLength,
      maxExtLength: this.maxExtLength,
      keyDecoder: this.keyDecoder
    });
  }
  reinitializeState() {
    this.totalPos = 0;
    this.headByte = HEAD_BYTE_REQUIRED;
    this.stack.reset();
  }
  setBuffer(buffer) {
    const bytes = ensureUint8Array(buffer);
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  appendBuffer(buffer) {
    if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
      this.setBuffer(buffer);
    } else {
      const remainingData = this.bytes.subarray(this.pos);
      const newData = ensureUint8Array(buffer);
      const newBuffer = new Uint8Array(remainingData.length + newData.length);
      newBuffer.set(remainingData);
      newBuffer.set(newData, remainingData.length);
      this.setBuffer(newBuffer);
    }
  }
  hasRemaining(size) {
    return this.view.byteLength - this.pos >= size;
  }
  createExtraByteError(posToShow) {
    const { view, pos } = this;
    return new RangeError(`Extra ${view.byteLength - pos} of ${view.byteLength} byte(s) found at buffer[${posToShow}]`);
  }
  /**
   * @throws {@link DecodeError}
   * @throws {@link RangeError}
   */
  decode(buffer) {
    if (this.entered) {
      const instance = this.clone();
      return instance.decode(buffer);
    }
    try {
      this.entered = true;
      this.reinitializeState();
      this.setBuffer(buffer);
      const object = this.doDecodeSync();
      if (this.hasRemaining(1)) {
        throw this.createExtraByteError(this.pos);
      }
      return object;
    } finally {
      this.entered = false;
    }
  }
  *decodeMulti(buffer) {
    if (this.entered) {
      const instance = this.clone();
      yield* instance.decodeMulti(buffer);
      return;
    }
    try {
      this.entered = true;
      this.reinitializeState();
      this.setBuffer(buffer);
      while (this.hasRemaining(1)) {
        yield this.doDecodeSync();
      }
    } finally {
      this.entered = false;
    }
  }
  async decodeAsync(stream) {
    if (this.entered) {
      const instance = this.clone();
      return instance.decodeAsync(stream);
    }
    try {
      this.entered = true;
      let decoded = false;
      let object;
      for await (const buffer of stream) {
        if (decoded) {
          this.entered = false;
          throw this.createExtraByteError(this.totalPos);
        }
        this.appendBuffer(buffer);
        try {
          object = this.doDecodeSync();
          decoded = true;
        } catch (e) {
          if (!(e instanceof RangeError)) {
            throw e;
          }
        }
        this.totalPos += this.pos;
      }
      if (decoded) {
        if (this.hasRemaining(1)) {
          throw this.createExtraByteError(this.totalPos);
        }
        return object;
      }
      const { headByte, pos, totalPos } = this;
      throw new RangeError(`Insufficient data in parsing ${prettyByte(headByte)} at ${totalPos} (${pos} in the current buffer)`);
    } finally {
      this.entered = false;
    }
  }
  decodeArrayStream(stream) {
    return this.decodeMultiAsync(stream, true);
  }
  decodeStream(stream) {
    return this.decodeMultiAsync(stream, false);
  }
  async *decodeMultiAsync(stream, isArray) {
    if (this.entered) {
      const instance = this.clone();
      yield* instance.decodeMultiAsync(stream, isArray);
      return;
    }
    try {
      this.entered = true;
      let isArrayHeaderRequired = isArray;
      let arrayItemsLeft = -1;
      for await (const buffer of stream) {
        if (isArray && arrayItemsLeft === 0) {
          throw this.createExtraByteError(this.totalPos);
        }
        this.appendBuffer(buffer);
        if (isArrayHeaderRequired) {
          arrayItemsLeft = this.readArraySize();
          isArrayHeaderRequired = false;
          this.complete();
        }
        try {
          while (true) {
            yield this.doDecodeSync();
            if (--arrayItemsLeft === 0) {
              break;
            }
          }
        } catch (e) {
          if (!(e instanceof RangeError)) {
            throw e;
          }
        }
        this.totalPos += this.pos;
      }
    } finally {
      this.entered = false;
    }
  }
  doDecodeSync() {
    DECODE: while (true) {
      const headByte = this.readHeadByte();
      let object;
      if (headByte >= 224) {
        object = headByte - 256;
      } else if (headByte < 192) {
        if (headByte < 128) {
          object = headByte;
        } else if (headByte < 144) {
          const size = headByte - 128;
          if (size !== 0) {
            this.pushMapState(size);
            this.complete();
            continue DECODE;
          } else {
            object = {};
          }
        } else if (headByte < 160) {
          const size = headByte - 144;
          if (size !== 0) {
            this.pushArrayState(size);
            this.complete();
            continue DECODE;
          } else {
            object = [];
          }
        } else {
          const byteLength = headByte - 160;
          object = this.decodeString(byteLength, 0);
        }
      } else if (headByte === 192) {
        object = null;
      } else if (headByte === 194) {
        object = false;
      } else if (headByte === 195) {
        object = true;
      } else if (headByte === 202) {
        object = this.readF32();
      } else if (headByte === 203) {
        object = this.readF64();
      } else if (headByte === 204) {
        object = this.readU8();
      } else if (headByte === 205) {
        object = this.readU16();
      } else if (headByte === 206) {
        object = this.readU32();
      } else if (headByte === 207) {
        if (this.useBigInt64) {
          object = this.readU64AsBigInt();
        } else {
          object = this.readU64();
        }
      } else if (headByte === 208) {
        object = this.readI8();
      } else if (headByte === 209) {
        object = this.readI16();
      } else if (headByte === 210) {
        object = this.readI32();
      } else if (headByte === 211) {
        if (this.useBigInt64) {
          object = this.readI64AsBigInt();
        } else {
          object = this.readI64();
        }
      } else if (headByte === 217) {
        const byteLength = this.lookU8();
        object = this.decodeString(byteLength, 1);
      } else if (headByte === 218) {
        const byteLength = this.lookU16();
        object = this.decodeString(byteLength, 2);
      } else if (headByte === 219) {
        const byteLength = this.lookU32();
        object = this.decodeString(byteLength, 4);
      } else if (headByte === 220) {
        const size = this.readU16();
        if (size !== 0) {
          this.pushArrayState(size);
          this.complete();
          continue DECODE;
        } else {
          object = [];
        }
      } else if (headByte === 221) {
        const size = this.readU32();
        if (size !== 0) {
          this.pushArrayState(size);
          this.complete();
          continue DECODE;
        } else {
          object = [];
        }
      } else if (headByte === 222) {
        const size = this.readU16();
        if (size !== 0) {
          this.pushMapState(size);
          this.complete();
          continue DECODE;
        } else {
          object = {};
        }
      } else if (headByte === 223) {
        const size = this.readU32();
        if (size !== 0) {
          this.pushMapState(size);
          this.complete();
          continue DECODE;
        } else {
          object = {};
        }
      } else if (headByte === 196) {
        const size = this.lookU8();
        object = this.decodeBinary(size, 1);
      } else if (headByte === 197) {
        const size = this.lookU16();
        object = this.decodeBinary(size, 2);
      } else if (headByte === 198) {
        const size = this.lookU32();
        object = this.decodeBinary(size, 4);
      } else if (headByte === 212) {
        object = this.decodeExtension(1, 0);
      } else if (headByte === 213) {
        object = this.decodeExtension(2, 0);
      } else if (headByte === 214) {
        object = this.decodeExtension(4, 0);
      } else if (headByte === 215) {
        object = this.decodeExtension(8, 0);
      } else if (headByte === 216) {
        object = this.decodeExtension(16, 0);
      } else if (headByte === 199) {
        const size = this.lookU8();
        object = this.decodeExtension(size, 1);
      } else if (headByte === 200) {
        const size = this.lookU16();
        object = this.decodeExtension(size, 2);
      } else if (headByte === 201) {
        const size = this.lookU32();
        object = this.decodeExtension(size, 4);
      } else {
        throw new DecodeError(`Unrecognized type byte: ${prettyByte(headByte)}`);
      }
      this.complete();
      const stack = this.stack;
      while (stack.length > 0) {
        const state = stack.top();
        if (state.type === STATE_ARRAY) {
          state.array[state.position] = object;
          state.position++;
          if (state.position === state.size) {
            object = state.array;
            stack.release(state);
          } else {
            continue DECODE;
          }
        } else if (state.type === STATE_MAP_KEY) {
          if (object === "__proto__") {
            throw new DecodeError("The key __proto__ is not allowed");
          }
          state.key = this.mapKeyConverter(object);
          state.type = STATE_MAP_VALUE;
          continue DECODE;
        } else {
          state.map[state.key] = object;
          state.readCount++;
          if (state.readCount === state.size) {
            object = state.map;
            stack.release(state);
          } else {
            state.key = null;
            state.type = STATE_MAP_KEY;
            continue DECODE;
          }
        }
      }
      return object;
    }
  }
  readHeadByte() {
    if (this.headByte === HEAD_BYTE_REQUIRED) {
      this.headByte = this.readU8();
    }
    return this.headByte;
  }
  complete() {
    this.headByte = HEAD_BYTE_REQUIRED;
  }
  readArraySize() {
    const headByte = this.readHeadByte();
    switch (headByte) {
      case 220:
        return this.readU16();
      case 221:
        return this.readU32();
      default: {
        if (headByte < 160) {
          return headByte - 144;
        } else {
          throw new DecodeError(`Unrecognized array type byte: ${prettyByte(headByte)}`);
        }
      }
    }
  }
  pushMapState(size) {
    if (size > this.maxMapLength) {
      throw new DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
    }
    this.stack.pushMapState(size);
  }
  pushArrayState(size) {
    if (size > this.maxArrayLength) {
      throw new DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
    }
    this.stack.pushArrayState(size);
  }
  decodeString(byteLength, headerOffset) {
    if (!this.rawStrings || this.stateIsMapKey()) {
      return this.decodeUtf8String(byteLength, headerOffset);
    }
    return this.decodeBinary(byteLength, headerOffset);
  }
  /**
   * @throws {@link RangeError}
   */
  decodeUtf8String(byteLength, headerOffset) {
    var _a;
    if (byteLength > this.maxStrLength) {
      throw new DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
    }
    if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
      throw MORE_DATA;
    }
    const offset = this.pos + headerOffset;
    let object;
    if (this.stateIsMapKey() && ((_a = this.keyDecoder) == null ? void 0 : _a.canBeCached(byteLength))) {
      object = this.keyDecoder.decode(this.bytes, offset, byteLength);
    } else {
      object = utf8Decode(this.bytes, offset, byteLength);
    }
    this.pos += headerOffset + byteLength;
    return object;
  }
  stateIsMapKey() {
    if (this.stack.length > 0) {
      const state = this.stack.top();
      return state.type === STATE_MAP_KEY;
    }
    return false;
  }
  /**
   * @throws {@link RangeError}
   */
  decodeBinary(byteLength, headOffset) {
    if (byteLength > this.maxBinLength) {
      throw new DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
    }
    if (!this.hasRemaining(byteLength + headOffset)) {
      throw MORE_DATA;
    }
    const offset = this.pos + headOffset;
    const object = this.bytes.subarray(offset, offset + byteLength);
    this.pos += headOffset + byteLength;
    return object;
  }
  decodeExtension(size, headOffset) {
    if (size > this.maxExtLength) {
      throw new DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
    }
    const extType = this.view.getInt8(this.pos + headOffset);
    const data = this.decodeBinary(
      size,
      headOffset + 1
      /* extType */
    );
    return this.extensionCodec.decode(data, extType, this.context);
  }
  lookU8() {
    return this.view.getUint8(this.pos);
  }
  lookU16() {
    return this.view.getUint16(this.pos);
  }
  lookU32() {
    return this.view.getUint32(this.pos);
  }
  readU8() {
    const value = this.view.getUint8(this.pos);
    this.pos++;
    return value;
  }
  readI8() {
    const value = this.view.getInt8(this.pos);
    this.pos++;
    return value;
  }
  readU16() {
    const value = this.view.getUint16(this.pos);
    this.pos += 2;
    return value;
  }
  readI16() {
    const value = this.view.getInt16(this.pos);
    this.pos += 2;
    return value;
  }
  readU32() {
    const value = this.view.getUint32(this.pos);
    this.pos += 4;
    return value;
  }
  readI32() {
    const value = this.view.getInt32(this.pos);
    this.pos += 4;
    return value;
  }
  readU64() {
    const value = getUint64(this.view, this.pos);
    this.pos += 8;
    return value;
  }
  readI64() {
    const value = getInt64(this.view, this.pos);
    this.pos += 8;
    return value;
  }
  readU64AsBigInt() {
    const value = this.view.getBigUint64(this.pos);
    this.pos += 8;
    return value;
  }
  readI64AsBigInt() {
    const value = this.view.getBigInt64(this.pos);
    this.pos += 8;
    return value;
  }
  readF32() {
    const value = this.view.getFloat32(this.pos);
    this.pos += 4;
    return value;
  }
  readF64() {
    const value = this.view.getFloat64(this.pos);
    this.pos += 8;
    return value;
  }
}
function decode(buffer, options) {
  const decoder = new Decoder(options);
  return decoder.decode(buffer);
}
function decodeMulti(buffer, options) {
  const decoder = new Decoder(options);
  return decoder.decodeMulti(buffer);
}
function isAsyncIterable(object) {
  return object[Symbol.asyncIterator] != null;
}
async function* asyncIterableFromStream(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
function ensureAsyncIterable(streamLike) {
  if (isAsyncIterable(streamLike)) {
    return streamLike;
  } else {
    return asyncIterableFromStream(streamLike);
  }
}
async function decodeAsync(streamLike, options) {
  const stream = ensureAsyncIterable(streamLike);
  const decoder = new Decoder(options);
  return decoder.decodeAsync(stream);
}
function decodeArrayStream(streamLike, options) {
  const stream = ensureAsyncIterable(streamLike);
  const decoder = new Decoder(options);
  return decoder.decodeArrayStream(stream);
}
function decodeMultiStream(streamLike, options) {
  const stream = ensureAsyncIterable(streamLike);
  const decoder = new Decoder(options);
  return decoder.decodeStream(stream);
}
const dist_esm = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecodeError,
  Decoder,
  EXT_TIMESTAMP,
  Encoder,
  ExtData,
  ExtensionCodec,
  decode,
  decodeArrayStream,
  decodeAsync,
  decodeMulti,
  decodeMultiStream,
  decodeTimestampExtension,
  decodeTimestampToTimeSpec,
  encode,
  encodeDateToTimeSpec,
  encodeTimeSpecToTimestamp,
  encodeTimestampExtension
}, Symbol.toStringTag, { value: "Module" }));
const require$$0 = /* @__PURE__ */ getAugmentedNamespace(dist_esm);
var machine = {};
var hasRequiredMachine;
function requireMachine() {
  if (hasRequiredMachine) return machine;
  hasRequiredMachine = 1;
  Object.defineProperty(machine, "__esModule", { value: true });
  function valueEnumerable(value) {
    return { enumerable: true, value };
  }
  function valueEnumerableWritable(value) {
    return { enumerable: true, writable: true, value };
  }
  let d = {};
  let truthy = () => true;
  let empty = () => ({});
  let identity = (a) => a;
  let callBoth = (par, fn, self, args) => par.apply(self, args) && fn.apply(self, args);
  let callForward = (par, fn, self, [a, b]) => fn.call(self, par.call(self, a, b), b);
  let create = (a, b) => Object.freeze(Object.create(a, b));
  function stack(fns, def, caller) {
    return fns.reduce((par, fn) => {
      return function(...args) {
        return caller(par, fn, this, args);
      };
    }, def);
  }
  function fnType(fn) {
    return create(this, { fn: valueEnumerable(fn) });
  }
  let reduceType = {};
  let reduce = fnType.bind(reduceType);
  let action = (fn) => reduce((ctx, ev) => !!~fn(ctx, ev) && ctx);
  let guardType = {};
  let guard = fnType.bind(guardType);
  function filter(Type, arr) {
    return arr.filter((value) => Type.isPrototypeOf(value));
  }
  function makeTransition(from, to, ...args) {
    let guards = stack(filter(guardType, args).map((t) => t.fn), truthy, callBoth);
    let reducers = stack(filter(reduceType, args).map((t) => t.fn), identity, callForward);
    return create(this, {
      from: valueEnumerable(from),
      to: valueEnumerable(to),
      guards: valueEnumerable(guards),
      reducers: valueEnumerable(reducers)
    });
  }
  let transitionType = {};
  let immediateType = {};
  let transition = makeTransition.bind(transitionType);
  let immediate = makeTransition.bind(immediateType, null);
  function enterImmediate(machine2, service2, event) {
    return transitionTo(service2, machine2, event, this.immediates) || machine2;
  }
  function transitionsToMap(transitions) {
    let m = /* @__PURE__ */ new Map();
    for (let t of transitions) {
      if (!m.has(t.from)) m.set(t.from, []);
      m.get(t.from).push(t);
    }
    return m;
  }
  let stateType = { enter: identity };
  function state(...args) {
    let transitions = filter(transitionType, args);
    let immediates = filter(immediateType, args);
    let desc = {
      final: valueEnumerable(args.length === 0),
      transitions: valueEnumerable(transitionsToMap(transitions))
    };
    if (immediates.length) {
      desc.immediates = valueEnumerable(immediates);
      desc.enter = valueEnumerable(enterImmediate);
    }
    return create(stateType, desc);
  }
  let invokeFnType = {
    enter(machine2, service2, event) {
      let rn = this.fn.call(service2, service2.context, event);
      if (machine$1.isPrototypeOf(rn))
        return create(invokeMachineType, {
          machine: valueEnumerable(rn),
          transitions: valueEnumerable(this.transitions)
        }).enter(machine2, service2, event);
      rn.then((data) => service2.send({ type: "done", data })).catch((error) => service2.send({ type: "error", error }));
      return machine2;
    }
  };
  let invokeMachineType = {
    enter(machine2, service2, event) {
      service2.child = interpret(this.machine, (s) => {
        service2.onChange(s);
        if (service2.child == s && s.machine.state.value.final) {
          delete service2.child;
          service2.send({ type: "done", data: s.context });
        }
      }, service2.context, event);
      if (service2.child.machine.state.value.final) {
        let data = service2.child.context;
        delete service2.child;
        return transitionTo(service2, machine2, { type: "done", data }, this.transitions.get("done"));
      }
      return machine2;
    }
  };
  function invoke(fn, ...transitions) {
    let t = valueEnumerable(transitionsToMap(transitions));
    return machine$1.isPrototypeOf(fn) ? create(invokeMachineType, {
      machine: valueEnumerable(fn),
      transitions: t
    }) : create(invokeFnType, {
      fn: valueEnumerable(fn),
      transitions: t
    });
  }
  let machine$1 = {
    get state() {
      return {
        name: this.current,
        value: this.states[this.current]
      };
    }
  };
  function createMachine(current, states, contextFn = empty) {
    if (typeof current !== "string") {
      contextFn = states || empty;
      states = current;
      current = Object.keys(states)[0];
    }
    if (d._create) d._create(current, states);
    return create(machine$1, {
      context: valueEnumerable(contextFn),
      current: valueEnumerable(current),
      states: valueEnumerable(states)
    });
  }
  function transitionTo(service2, machine2, fromEvent, candidates) {
    let { context } = service2;
    for (let { to, guards, reducers } of candidates) {
      if (guards(context, fromEvent)) {
        service2.context = reducers.call(service2, context, fromEvent);
        let original = machine2.original || machine2;
        let newMachine = create(original, {
          current: valueEnumerable(to),
          original: { value: original }
        });
        if (d._onEnter) d._onEnter(machine2, to, service2.context, context, fromEvent);
        let state2 = newMachine.state.value;
        return state2.enter(newMachine, service2, fromEvent);
      }
    }
  }
  function send(service2, event) {
    let eventName = event.type || event;
    let { machine: machine2 } = service2;
    let { value: state2, name: currentStateName } = machine2.state;
    if (state2.transitions.has(eventName)) {
      return transitionTo(service2, machine2, event, state2.transitions.get(eventName)) || machine2;
    } else {
      if (d._send) d._send(eventName, currentStateName);
    }
    return machine2;
  }
  let service = {
    send(event) {
      this.machine = send(this, event);
      this.onChange(this);
    }
  };
  function interpret(machine2, onChange, initialContext, event) {
    let s = Object.create(service, {
      machine: valueEnumerableWritable(machine2),
      context: valueEnumerableWritable(machine2.context(initialContext, event)),
      onChange: valueEnumerable(onChange)
    });
    s.send = s.send.bind(s);
    s.machine = s.machine.state.value.enter(s.machine, s, event);
    return s;
  }
  machine.action = action;
  machine.createMachine = createMachine;
  machine.d = d;
  machine.guard = guard;
  machine.immediate = immediate;
  machine.interpret = interpret;
  machine.invoke = invoke;
  machine.reduce = reduce;
  machine.state = state;
  machine.transition = transition;
  return machine;
}
var hasRequiredRealtime;
function requireRealtime() {
  if (hasRequiredRealtime) return realtime;
  hasRequiredRealtime = 1;
  var __awaiter = realtime && realtime.__awaiter || function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  Object.defineProperty(realtime, "__esModule", { value: true });
  realtime.createRealtimeClient = createRealtimeClient;
  const msgpack_1 = require$$0;
  const robot3_1 = requireMachine();
  const auth_1 = requireAuth();
  const response_1 = requireResponse();
  const runtime_1 = requireRuntime();
  const utils_1 = requireUtils();
  const initialState = () => ({
    enqueuedMessage: void 0
  });
  function hasToken(context) {
    return context.token !== void 0;
  }
  function noToken(context) {
    return !hasToken(context);
  }
  function enqueueMessage(context, event) {
    return Object.assign(Object.assign({}, context), { enqueuedMessage: event.message });
  }
  function closeConnection(context) {
    if (context.websocket && context.websocket.readyState === WebSocket.OPEN) {
      context.websocket.close();
    }
    return Object.assign(Object.assign({}, context), { websocket: void 0 });
  }
  function sendMessage(context, event) {
    if (context.websocket && context.websocket.readyState === WebSocket.OPEN) {
      if (event.message instanceof Uint8Array) {
        context.websocket.send(event.message);
      } else if (typeof event.message === "string") {
        context.websocket.send(event.message);
      } else {
        context.websocket.send((0, msgpack_1.encode)(event.message));
      }
      return Object.assign(Object.assign({}, context), { enqueuedMessage: void 0 });
    }
    return Object.assign(Object.assign({}, context), { enqueuedMessage: event.message });
  }
  function expireToken(context) {
    return Object.assign(Object.assign({}, context), { token: void 0 });
  }
  function setToken(context, event) {
    return Object.assign(Object.assign({}, context), { token: event.token });
  }
  function connectionEstablished(context, event) {
    return Object.assign(Object.assign({}, context), { websocket: event.websocket });
  }
  const connectionStateMachine = (0, robot3_1.createMachine)("idle", {
    idle: (0, robot3_1.state)((0, robot3_1.transition)("send", "connecting", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("expireToken", "idle", (0, robot3_1.reduce)(expireToken)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection))),
    connecting: (0, robot3_1.state)((0, robot3_1.transition)("connecting", "connecting"), (0, robot3_1.transition)("connected", "active", (0, robot3_1.reduce)(connectionEstablished)), (0, robot3_1.transition)("connectionClosed", "idle", (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.transition)("send", "connecting", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.immediate)("authRequired", (0, robot3_1.guard)(noToken))),
    authRequired: (0, robot3_1.state)((0, robot3_1.transition)("initiateAuth", "authInProgress"), (0, robot3_1.transition)("send", "authRequired", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection))),
    authInProgress: (0, robot3_1.state)((0, robot3_1.transition)("authenticated", "connecting", (0, robot3_1.reduce)(setToken)), (0, robot3_1.transition)("unauthorized", "idle", (0, robot3_1.reduce)(expireToken), (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.transition)("send", "authInProgress", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection))),
    active: (0, robot3_1.state)((0, robot3_1.transition)("send", "active", (0, robot3_1.reduce)(sendMessage)), (0, robot3_1.transition)("authenticated", "active", (0, robot3_1.reduce)(setToken)), (0, robot3_1.transition)("unauthorized", "idle", (0, robot3_1.reduce)(expireToken)), (0, robot3_1.transition)("connectionClosed", "idle", (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection))),
    failed: (0, robot3_1.state)((0, robot3_1.transition)("send", "failed"), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection)))
  }, initialState);
  function buildRealtimeUrl(app2, { token, maxBuffering, path: path2 }) {
    var _a;
    if (maxBuffering !== void 0 && (maxBuffering < 1 || maxBuffering > 60)) {
      throw new Error("The `maxBuffering` must be between 1 and 60 (inclusive)");
    }
    const queryParams = new URLSearchParams({
      fal_jwt_token: token
    });
    if (maxBuffering !== void 0) {
      queryParams.set("max_buffering", maxBuffering.toFixed(0));
    }
    const appId = (0, utils_1.ensureEndpointIdFormat)(app2);
    const resolvedPath = (_a = (0, utils_1.resolveEndpointPath)(app2, path2, "/realtime")) !== null && _a !== void 0 ? _a : "";
    return `wss://fal.run/${appId}${resolvedPath}?${queryParams.toString()}`;
  }
  const DEFAULT_THROTTLE_INTERVAL = 128;
  function isUnauthorizedError(message) {
    return message["status"] === "error" && message["error"] === "Unauthorized";
  }
  const WebSocketErrorCodes = {
    NORMAL_CLOSURE: 1e3
  };
  const connectionCache = /* @__PURE__ */ new Map();
  const connectionCallbacks = /* @__PURE__ */ new Map();
  function reuseInterpreter(key, throttleInterval, onChange) {
    if (!connectionCache.has(key)) {
      const machine2 = (0, robot3_1.interpret)(connectionStateMachine, onChange);
      connectionCache.set(key, Object.assign(Object.assign({}, machine2), { throttledSend: throttleInterval > 0 ? (0, utils_1.throttle)(machine2.send, throttleInterval, true) : machine2.send }));
    }
    return connectionCache.get(key);
  }
  const noop = () => {
  };
  const NoOpConnection = {
    send: noop,
    close: noop
  };
  function isSuccessfulResult(data) {
    return data.status !== "error" && data.type !== "x-fal-message" && !isFalErrorResult(data);
  }
  function isFalErrorResult(data) {
    return data.type === "x-fal-error";
  }
  function decodeRealtimeMessage(data) {
    return __awaiter(this, void 0, void 0, function* () {
      if (typeof data === "string") {
        return JSON.parse(data);
      }
      const toUint8Array = (value) => __awaiter(this, void 0, void 0, function* () {
        if (value instanceof Uint8Array) {
          return value;
        }
        if (value instanceof Blob) {
          return new Uint8Array(yield value.arrayBuffer());
        }
        return new Uint8Array(value);
      });
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        return (0, msgpack_1.decode)(yield toUint8Array(data));
      }
      if (data instanceof Blob) {
        return (0, msgpack_1.decode)(yield toUint8Array(data));
      }
      return data;
    });
  }
  function encodeRealtimeMessage(input) {
    if (input instanceof Uint8Array) {
      return input;
    }
    if (typeof input === "string") {
      return (0, msgpack_1.encode)(input);
    }
    return (0, msgpack_1.encode)(input);
  }
  function handleRealtimeMessage({ data, decodeMessage, onResult, onError, send }) {
    const handleDecoded = (decoded) => {
      if (isUnauthorizedError(decoded)) {
        send({
          type: "unauthorized",
          error: new Error("Unauthorized")
        });
        return;
      }
      if (isSuccessfulResult(decoded)) {
        onResult(decoded);
        return;
      }
      if (isFalErrorResult(decoded)) {
        if (decoded.error === "TIMEOUT") {
          return;
        }
        onError(new response_1.ApiError({
          message: `${decoded.error}: ${decoded.reason}`,
          // TODO better error status code
          status: 400,
          body: decoded
        }));
        return;
      }
    };
    Promise.resolve(decodeMessage ? decodeMessage(data) : data).then(handleDecoded).catch((error) => {
      var _a;
      onError(new response_1.ApiError({
        message: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : "Failed to decode realtime message",
        status: 400
      }));
    });
  }
  function createRealtimeClient({ config: config2 }) {
    return {
      connect(app2, handler) {
        const {
          // if running on React in the server, set clientOnly to true by default
          clientOnly = (0, utils_1.isReact)() && !(0, runtime_1.isBrowser)(),
          connectionKey = crypto.randomUUID(),
          maxBuffering,
          path: path2,
          throttleInterval = DEFAULT_THROTTLE_INTERVAL,
          encodeMessage: encodeMessageOverride,
          decodeMessage: decodeMessageOverride,
          tokenProvider,
          tokenExpirationSeconds
        } = handler;
        if (clientOnly && !(0, runtime_1.isBrowser)()) {
          return NoOpConnection;
        }
        const encodeMessageFn = encodeMessageOverride !== null && encodeMessageOverride !== void 0 ? encodeMessageOverride : ((input) => encodeRealtimeMessage(input));
        const decodeMessageFn = decodeMessageOverride !== null && decodeMessageOverride !== void 0 ? decodeMessageOverride : ((data) => decodeRealtimeMessage(data));
        let previousState;
        let latestEnqueuedMessage;
        let tokenRefreshTimer;
        let tokenRefreshGeneration = 0;
        connectionCallbacks.set(connectionKey, {
          decodeMessage: decodeMessageFn,
          onError: handler.onError,
          onResult: handler.onResult
        });
        const getCallbacks = () => connectionCallbacks.get(connectionKey);
        const stateMachine = reuseInterpreter(connectionKey, throttleInterval, ({ context, machine: machine2, send: send2 }) => {
          var _a;
          const { enqueuedMessage, token, websocket } = context;
          latestEnqueuedMessage = enqueuedMessage;
          if (machine2.current === "active" && enqueuedMessage && (websocket === null || websocket === void 0 ? void 0 : websocket.readyState) === WebSocket.OPEN) {
            send2({ type: "send", message: enqueuedMessage });
          }
          if (machine2.current === "authRequired" && token === void 0 && previousState !== machine2.current) {
            send2({ type: "initiateAuth" });
            tokenRefreshGeneration++;
            const generation = tokenRefreshGeneration;
            const appId = (0, utils_1.ensureEndpointIdFormat)(app2);
            const resolvedPath = (_a = (0, utils_1.resolveEndpointPath)(app2, path2, "/realtime")) !== null && _a !== void 0 ? _a : "";
            const fetchToken = tokenProvider ? () => tokenProvider(`${appId}${resolvedPath}`) : () => {
              console.warn("[fal.realtime] Using the default token provider is deprecated. Please provide a `tokenProvider` function to `fal.realtime.connect()`. See https://docs.fal.ai/model-apis/client#client-side-usage-with-token-provider for more information.");
              return (0, auth_1.getTemporaryAuthToken)(app2, config2);
            };
            const effectiveExpiration = tokenProvider ? tokenExpirationSeconds : auth_1.TOKEN_EXPIRATION_SECONDS;
            const scheduleTokenRefresh = effectiveExpiration !== void 0 ? () => {
              clearTimeout(tokenRefreshTimer);
              const refreshMs = Math.round(effectiveExpiration * 0.9 * 1e3);
              tokenRefreshTimer = setTimeout(() => {
                if (generation !== tokenRefreshGeneration) {
                  return;
                }
                fetchToken().then((newToken) => {
                  if (generation !== tokenRefreshGeneration) {
                    return;
                  }
                  queueMicrotask(() => {
                    send2({ type: "authenticated", token: newToken });
                  });
                  scheduleTokenRefresh();
                }).catch(() => {
                  if (generation !== tokenRefreshGeneration) {
                    return;
                  }
                  const retryMs = Math.round(effectiveExpiration * 0.05 * 1e3);
                  tokenRefreshTimer = setTimeout(() => {
                    scheduleTokenRefresh();
                  }, retryMs);
                });
              }, refreshMs);
            } : noop;
            fetchToken().then((token2) => {
              queueMicrotask(() => {
                send2({ type: "authenticated", token: token2 });
              });
              scheduleTokenRefresh();
            }).catch((error) => {
              queueMicrotask(() => {
                send2({ type: "unauthorized", error });
              });
            });
          }
          if (machine2.current === "connecting" && previousState !== machine2.current && token !== void 0) {
            const ws = new WebSocket(buildRealtimeUrl(app2, { token, maxBuffering, path: path2 }));
            ws.onopen = () => {
              var _a2, _b;
              send2({ type: "connected", websocket: ws });
              const queued = (_b = (_a2 = stateMachine.context) === null || _a2 === void 0 ? void 0 : _a2.enqueuedMessage) !== null && _b !== void 0 ? _b : latestEnqueuedMessage;
              if (queued) {
                ws.send(encodeMessageFn(queued));
                stateMachine.context = Object.assign(Object.assign({}, stateMachine.context), { enqueuedMessage: void 0 });
              }
            };
            ws.onclose = (event) => {
              if (event.code !== WebSocketErrorCodes.NORMAL_CLOSURE) {
                const { onError = noop } = getCallbacks();
                onError(new response_1.ApiError({
                  message: `Error closing the connection: ${event.reason}`,
                  status: event.code
                }));
              }
              send2({ type: "connectionClosed", code: event.code });
            };
            ws.onerror = (event) => {
              const { onError = noop } = getCallbacks();
              onError(new response_1.ApiError({ message: "Unknown error", status: 500 }));
            };
            ws.onmessage = (event) => {
              const { decodeMessage = decodeMessageFn, onResult, onError = noop } = getCallbacks();
              handleRealtimeMessage({
                data: event.data,
                decodeMessage,
                onResult,
                onError,
                send: send2
              });
            };
          }
          if (previousState === "active" && machine2.current !== "active") {
            clearTimeout(tokenRefreshTimer);
            tokenRefreshTimer = void 0;
          }
          previousState = machine2.current;
        });
        const send = (input) => {
          stateMachine.throttledSend({
            type: "send",
            message: encodeMessageFn(input)
          });
        };
        const close = () => {
          stateMachine.send({ type: "close" });
        };
        return {
          send,
          close
        };
      }
    };
  }
  return realtime;
}
var hasRequiredClient;
function requireClient() {
  if (hasRequiredClient) return client;
  hasRequiredClient = 1;
  var __awaiter = client && client.__awaiter || function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  Object.defineProperty(client, "__esModule", { value: true });
  client.createFalClient = createFalClient;
  const config_1 = requireConfig();
  const headers_1 = requireHeaders();
  const queue_1 = requireQueue();
  const realtime_1 = requireRealtime();
  const request_1 = requireRequest();
  const response_1 = requireResponse();
  const storage_1 = requireStorage();
  const streaming_1 = requireStreaming();
  function createFalClient(userConfig = {}) {
    const config2 = (0, config_1.createConfig)(userConfig);
    const storage2 = (0, storage_1.createStorageClient)({ config: config2 });
    const queue2 = (0, queue_1.createQueueClient)({ config: config2, storage: storage2 });
    const streaming2 = (0, streaming_1.createStreamingClient)({ config: config2, storage: storage2 });
    const realtime2 = (0, realtime_1.createRealtimeClient)({ config: config2 });
    return {
      queue: queue2,
      realtime: realtime2,
      storage: storage2,
      streaming: streaming2,
      stream: streaming2.stream,
      run(endpointId_1) {
        return __awaiter(this, arguments, void 0, function* (endpointId, options = {}) {
          const input = options.input ? yield storage2.transformInput(options.input) : void 0;
          return (0, request_1.dispatchRequest)({
            method: options.method,
            targetUrl: (0, request_1.buildUrl)(endpointId, options),
            input,
            // TODO: consider supporting custom headers in fal.run() as well
            headers: Object.assign(Object.assign({}, (0, storage_1.buildObjectLifecycleHeaders)(options.storageSettings)), (0, headers_1.buildTimeoutHeaders)(options.startTimeout)),
            config: Object.assign(Object.assign({}, config2), { responseHandler: response_1.resultResponseHandler }),
            options: {
              signal: options.abortSignal,
              retry: {
                maxRetries: 3,
                baseDelay: 500,
                maxDelay: 15e3
              }
            }
          });
        });
      },
      subscribe: (endpointId, options) => __awaiter(this, void 0, void 0, function* () {
        const { request_id: requestId } = yield queue2.submit(endpointId, options);
        if (options.onEnqueue) {
          options.onEnqueue(requestId);
        }
        yield queue2.subscribeToStatus(endpointId, Object.assign({ requestId }, options));
        return queue2.result(endpointId, { requestId });
      })
    };
  }
  return client;
}
var common = {};
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon) return common;
  hasRequiredCommon = 1;
  Object.defineProperty(common, "__esModule", { value: true });
  common.isQueueStatus = isQueueStatus;
  common.isCompletedQueueStatus = isCompletedQueueStatus;
  function isQueueStatus(obj) {
    return obj && obj.status && obj.response_url;
  }
  function isCompletedQueueStatus(obj) {
    return isQueueStatus(obj) && obj.status === "COMPLETED";
  }
  return common;
}
var hasRequiredSrc;
function requireSrc() {
  if (hasRequiredSrc) return src;
  hasRequiredSrc = 1;
  (function(exports$1) {
    var __createBinding = src && src.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = src && src.__exportStar || function(m, exports$12) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$12, p)) __createBinding(exports$12, m, p);
    };
    Object.defineProperty(exports$1, "__esModule", { value: true });
    exports$1.fal = exports$1.parseEndpointId = exports$1.isRetryableError = exports$1.ValidationError = exports$1.ApiError = exports$1.withProxy = exports$1.withMiddleware = exports$1.createFalClient = void 0;
    const client_1 = requireClient();
    var client_2 = requireClient();
    Object.defineProperty(exports$1, "createFalClient", { enumerable: true, get: function() {
      return client_2.createFalClient;
    } });
    var middleware_1 = requireMiddleware();
    Object.defineProperty(exports$1, "withMiddleware", { enumerable: true, get: function() {
      return middleware_1.withMiddleware;
    } });
    Object.defineProperty(exports$1, "withProxy", { enumerable: true, get: function() {
      return middleware_1.withProxy;
    } });
    var response_1 = requireResponse();
    Object.defineProperty(exports$1, "ApiError", { enumerable: true, get: function() {
      return response_1.ApiError;
    } });
    Object.defineProperty(exports$1, "ValidationError", { enumerable: true, get: function() {
      return response_1.ValidationError;
    } });
    var retry_1 = requireRetry();
    Object.defineProperty(exports$1, "isRetryableError", { enumerable: true, get: function() {
      return retry_1.isRetryableError;
    } });
    __exportStar(requireCommon(), exports$1);
    var utils_1 = requireUtils();
    Object.defineProperty(exports$1, "parseEndpointId", { enumerable: true, get: function() {
      return utils_1.parseEndpointId;
    } });
    exports$1.fal = (function createSingletonFalClient() {
      let currentInstance = (0, client_1.createFalClient)();
      return {
        config(config2) {
          currentInstance = (0, client_1.createFalClient)(config2);
        },
        get queue() {
          return currentInstance.queue;
        },
        get realtime() {
          return currentInstance.realtime;
        },
        get storage() {
          return currentInstance.storage;
        },
        get streaming() {
          return currentInstance.streaming;
        },
        run(id, options) {
          return currentInstance.run(id, options);
        },
        subscribe(endpointId, options) {
          return currentInstance.subscribe(endpointId, options);
        },
        stream(endpointId, options) {
          return currentInstance.stream(endpointId, options);
        }
      };
    })();
  })(src);
  return src;
}
var srcExports = requireSrc();
const KIE_BASE = "https://api.kie.ai/api/v1";
const POLL_INTERVAL_MS = 3e3;
const MAX_POLL_ATTEMPTS = 120;
const DEDICATED_ENDPOINTS = {
  "runway": `${KIE_BASE}/runway/generate`,
  "veo": `${KIE_BASE}/veo/generate`,
  "4o-image": `${KIE_BASE}/gpt4o-image/generate`,
  "suno-music": `${KIE_BASE}/generate`
};
function getDedicatedEndpoint(model) {
  for (const [prefix, endpoint] of Object.entries(DEDICATED_ENDPOINTS)) {
    if (model.startsWith(prefix)) return endpoint;
  }
  return void 0;
}
async function submitKieTask(model, input, apiKey) {
  const dedicatedUrl = getDedicatedEndpoint(model);
  const url = dedicatedUrl ?? `${KIE_BASE}/jobs/createTask`;
  const body = dedicatedUrl ? { ...input, callBackUrl: "" } : { model, input, callBackUrl: "" };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || `kie.ai error ${res.status}`);
  }
  const data = await res.json();
  if (data.code !== 200) {
    throw new Error(data.msg || "Failed to create kie.ai task");
  }
  return data.data.taskId;
}
async function pollKieResult(taskId, apiKey) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${taskId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    if (!res.ok) continue;
    const data = await res.json();
    const record = data.data;
    if (record.state === "success") {
      try {
        return JSON.parse(record.resultJson);
      } catch {
        return record;
      }
    }
    if (record.state === "fail") {
      throw new Error(record.failMsg || "kie.ai generation failed");
    }
  }
  throw new Error("kie.ai generation timed out");
}
async function generateWithKie(model, input, apiKey) {
  const taskId = await submitKieTask(model, input, apiKey);
  return await pollKieResult(taskId, apiKey);
}
const RUNPOD_BASE = "https://api.runpod.ai/v2";
const RUNPOD_POLL_INTERVAL_MS = 3e3;
const RUNPOD_MAX_POLL_ATTEMPTS = 120;
async function generateWithRunpod(endpointId, input, apiKey) {
  if (!endpointId) throw new Error("No RunPod endpoint ID configured for this model. Set it in the model definition.");
  const runRes = await fetch(`${RUNPOD_BASE}/${endpointId}/run`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input })
  });
  if (!runRes.ok) {
    const err = await runRes.json().catch(() => ({}));
    throw new Error(err.error || `RunPod error ${runRes.status}`);
  }
  const { id: jobId } = await runRes.json();
  for (let i = 0; i < RUNPOD_MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, RUNPOD_POLL_INTERVAL_MS));
    const statusRes = await fetch(`${RUNPOD_BASE}/${endpointId}/status/${jobId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    if (!statusRes.ok) continue;
    const data = await statusRes.json();
    if (data.status === "COMPLETED") {
      const out = data.output;
      const b64 = (out == null ? void 0 : out.image_url) ?? (out == null ? void 0 : out.image);
      if (b64 && !b64.startsWith("http") && !b64.startsWith("local-media://")) {
        const base64Data = b64.includes(",") ? b64.split(",")[1] : b64;
        const tmpPath = path.join(os.tmpdir(), `cinegen-runpod-${Date.now()}.png`);
        await fs$1.writeFile(tmpPath, Buffer.from(base64Data, "base64"));
        return { output: { ...out, image_url: `local-media://file${tmpPath}` } };
      }
      return { output: out };
    }
    if (data.status === "FAILED") {
      throw new Error(data.error || "RunPod job failed");
    }
  }
  throw new Error("RunPod job timed out");
}
async function generateWithPod(podUrl, route, input) {
  const url = `${podUrl.replace(/\/$/, "")}/generate/${route}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Pod error ${res.status}`);
  }
  return await res.json();
}
async function podAction(runpodKey, podId, action) {
  const url = `https://api.runpod.io/graphql?api_key=${runpodKey}`;
  const mutation = action === "start" ? `mutation { podResume(input: { podId: "${podId}" }) { id desiredStatus } }` : `mutation { podStop(input: { podId: "${podId}" }) { id desiredStatus } }`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: mutation })
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`RunPod pod ${action} failed: ${JSON.stringify(data.errors)}`);
  }
  return data;
}
async function getPodStatus(runpodKey, podId) {
  var _a, _b, _c;
  const url = `https://api.runpod.io/graphql?api_key=${runpodKey}`;
  const query = `{ pod(input: { podId: "${podId}" }) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort type } } } }`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const data = await res.json();
  const pod = (_a = data.data) == null ? void 0 : _a.pod;
  if (!pod) throw new Error("Pod not found");
  const httpPort = (_c = (_b = pod.runtime) == null ? void 0 : _b.ports) == null ? void 0 : _c.find((p) => p.privatePort === 8e3 && p.isIpPublic);
  return {
    status: pod.desiredStatus,
    ip: (httpPort == null ? void 0 : httpPort.ip) ?? null,
    port: (httpPort == null ? void 0 : httpPort.publicPort) ?? null
  };
}
function configureFal(key) {
  srcExports.fal.config({ credentials: key });
}
function guessContentType$4(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg"
  };
  return types[ext] ?? "application/octet-stream";
}
async function uploadLocalMedia(localUrl) {
  const fsPath = decodeURIComponent(localUrl.replace("local-media://file", ""));
  const buffer = await fs$1.readFile(fsPath);
  const type = guessContentType$4(fsPath);
  const blob = new Blob([buffer], { type });
  const file = new File([blob], path.basename(fsPath), { type });
  return srcExports.fal.storage.upload(file);
}
async function resolveLocalMediaUrls(inputs) {
  const resolved = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === "string" && value.startsWith("local-media://file")) {
      resolved[key] = await uploadLocalMedia(value);
    } else if (Array.isArray(value)) {
      resolved[key] = await Promise.all(
        value.map(async (item) => {
          if (typeof item === "string" && item.startsWith("local-media://file")) {
            return uploadLocalMedia(item);
          }
          if (item && typeof item === "object" && !Array.isArray(item)) {
            return resolveLocalMediaUrls(item);
          }
          return item;
        })
      );
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      resolved[key] = await resolveLocalMediaUrls(value);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
async function generateWithFal(model, input, apiKey) {
  var _a;
  configureFal(apiKey);
  console.log("[fal] Calling model:", model, "with input:", JSON.stringify(input, null, 2));
  try {
    return await srcExports.fal.subscribe(model, { input, logs: true });
  } catch (err) {
    console.error("[fal] Error details:", JSON.stringify((err == null ? void 0 : err.body) ?? err, null, 2));
    if ((_a = err == null ? void 0 : err.body) == null ? void 0 : _a.detail) {
      console.error("[fal] Validation errors:", JSON.stringify(err.body.detail, null, 2));
    }
    throw err;
  }
}
function registerWorkflowHandlers() {
  ipcMain.handle("workflow:run", async (_event, params) => {
    const { apiKey, kieKey, runpodKey, runpodEndpointId, podUrl, nodeId, nodeType, modelId, inputs: rawInputs } = params;
    if (apiKey) configureFal(apiKey);
    const inputs = await resolveLocalMediaUrls(rawInputs);
    const { ALL_MODELS } = await import("./models-a4WF-RtF.js");
    const modelDef = ALL_MODELS[modelId] ?? Object.values(ALL_MODELS).find(
      (m) => m.id === modelId || m.altId === modelId || m.nodeType === modelId
    );
    if (!modelDef) {
      if (modelId.startsWith("fal-ai/")) {
        const key = apiKey;
        if (!key) throw new Error("No fal.ai API key provided. Add one in Settings.");
        const result2 = await generateWithFal(modelId, inputs, key);
        const data2 = result2.data ?? result2;
        return data2;
      }
      throw new Error(`Unknown model: ${modelId}`);
    }
    const apiModelId = modelId.includes("/") ? modelId : modelDef.id;
    let result;
    const provider = modelDef.provider;
    if (provider === "kie") {
      const key = kieKey;
      if (!key) throw new Error("No kie.ai API key provided. Add one in Settings.");
      result = await generateWithKie(apiModelId, inputs, key);
    } else if (provider === "pod") {
      if (!podUrl) throw new Error("No pod URL configured. Start your pod and set the URL in Settings.");
      const route = modelDef.podRoute ?? apiModelId;
      result = await generateWithPod(podUrl, route, inputs);
    } else if (provider === "runpod") {
      const key = runpodKey;
      if (!key) throw new Error("No RunPod API key provided. Add one in Settings.");
      const endpointId = runpodEndpointId || modelDef.runpodEndpointId || "";
      result = await generateWithRunpod(endpointId, inputs, key);
    } else {
      const key = apiKey;
      if (!key) throw new Error("No fal.ai API key provided. Add one in Settings.");
      result = await generateWithFal(apiModelId, inputs, key);
    }
    const data = result.data ?? result;
    return data;
  });
  const jobStore = /* @__PURE__ */ new Map();
  ipcMain.handle("workflow:poll-job", async (_event, id) => {
    const job = jobStore.get(id);
    if (!job) throw new Error("Job not found");
    return job;
  });
  ipcMain.handle("pod:start", async (_event, params) => {
    return await podAction(params.runpodKey, params.podId, "start");
  });
  ipcMain.handle("pod:stop", async (_event, params) => {
    return await podAction(params.runpodKey, params.podId, "stop");
  });
  ipcMain.handle("pod:status", async (_event, params) => {
    return await getPodStatus(params.runpodKey, params.podId);
  });
}
const require$2 = createRequire(import.meta.url);
function resolvePackagedPath(modulePath) {
  if (app.isPackaged) {
    return modulePath.replace("app.asar", "app.asar.unpacked");
  }
  return modulePath;
}
function getFfmpegPath() {
  const p = require$2("ffmpeg-static");
  return resolvePackagedPath(p);
}
function getFfprobePath() {
  const p = require$2("ffprobe-static").path;
  return resolvePackagedPath(p);
}
function getFpcalcPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "vendor", "fpcalc");
  }
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, "..", "vendor", "fpcalc", "fpcalc");
}
const PRESETS = {
  draft: { crf: 28, scale: 0.5 },
  standard: { crf: 20, scale: 1 },
  high: { crf: 16, scale: 1 }
};
const exportJobs = /* @__PURE__ */ new Map();
const activeProcesses = /* @__PURE__ */ new Map();
function broadcastProgress(jobId, progress) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("export:progress", { jobId, progress });
  }
}
function parseTimeProgress(line, totalDuration) {
  const match = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const secs = parseInt(match[3], 10);
  const frac = parseInt(match[4], 10) / 100;
  const currentTime = hours * 3600 + mins * 60 + secs + frac;
  return totalDuration > 0 ? Math.min(100, currentTime / totalDuration * 100) : 0;
}
async function renderWithFfmpeg(jobId, params) {
  const job = exportJobs.get(jobId);
  if (!job) return;
  const ffmpegPath = getFfmpegPath();
  const preset = PRESETS[params.preset || "standard"] || PRESETS.standard;
  const fps = params.fps || 30;
  const outputPath = params.outputPath || path.join(process.cwd(), `export_${jobId}.mp4`);
  exportJobs.set(jobId, { ...job, status: "rendering" });
  const videoClips = params.clips.filter(
    (c) => (c.type === "video" || c.type === "image") && c.inputPath
  );
  if (videoClips.length === 0) {
    exportJobs.set(jobId, { ...job, status: "failed", error: "No video clips to export" });
    return;
  }
  const args = [];
  for (const clip of videoClips) {
    if (clip.trimStart > 0) {
      args.push("-ss", String(clip.trimStart));
    }
    args.push("-t", String(clip.duration / (clip.speed || 1)));
    args.push("-i", clip.inputPath);
  }
  const filterParts = [];
  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const speed = clip.speed || 1;
    const volume = clip.volume ?? 1;
    const videoFilters = [];
    if (speed !== 1) {
      videoFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
    }
    if (preset.scale !== 1) {
      videoFilters.push(`scale=iw*${preset.scale}:ih*${preset.scale}`);
    }
    videoFilters.push(`fps=${fps}`);
    filterParts.push(`[${i}:v]${videoFilters.join(",")}[v${i}]`);
    const clipDuration = clip.duration / speed;
    if (clip.type === "image") {
      filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${clipDuration.toFixed(4)}[a${i}]`);
    } else {
      const audioFilters = [];
      if (speed !== 1) {
        audioFilters.push(`atempo=${speed}`);
      }
      if (volume !== 1) {
        audioFilters.push(`volume=${volume}`);
      }
      if (audioFilters.length > 0) {
        filterParts.push(`[${i}:a]${audioFilters.join(",")}[a${i}]`);
      } else {
        filterParts.push(`[${i}:a]anull[a${i}]`);
      }
    }
  }
  const vInputs = videoClips.map((_, i) => `[v${i}]`).join("");
  const aInputs = videoClips.map((_, i) => `[a${i}]`).join("");
  filterParts.push(
    `${vInputs}${aInputs}concat=n=${videoClips.length}:v=1:a=1[outv][outa]`
  );
  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", "[outv]", "-map", "[outa]");
  args.push("-c:v", "libx264", "-crf", String(preset.crf), "-preset", "fast");
  args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-y", outputPath);
  return new Promise((resolve, reject) => {
    var _a;
    const proc = spawn(ffmpegPath, args);
    activeProcesses.set(jobId, proc);
    let stderrBuffer = "";
    (_a = proc.stderr) == null ? void 0 : _a.on("data", (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split("\r");
      const lastLine = lines[lines.length - 1] || lines[lines.length - 2];
      if (lastLine) {
        const progress = parseTimeProgress(lastLine, params.totalDuration);
        if (progress !== null) {
          const updatedJob = exportJobs.get(jobId);
          if (updatedJob) {
            exportJobs.set(jobId, { ...updatedJob, progress });
            broadcastProgress(jobId, progress);
          }
        }
      }
      if (stderrBuffer.length > 2048) {
        stderrBuffer = stderrBuffer.slice(-1024);
      }
    });
    proc.on("close", (code) => {
      activeProcesses.delete(jobId);
      const finalJob = exportJobs.get(jobId);
      if (!finalJob) {
        resolve();
        return;
      }
      if (code === 0) {
        let fileSize;
        try {
          fileSize = fs.statSync(outputPath).size;
        } catch {
        }
        exportJobs.set(jobId, {
          ...finalJob,
          status: "complete",
          progress: 100,
          outputUrl: outputPath,
          fileSize,
          completedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else {
        exportJobs.set(jobId, {
          ...finalJob,
          status: "failed",
          error: `ffmpeg exited with code ${code}`
        });
      }
      resolve();
    });
    proc.on("error", (err) => {
      activeProcesses.delete(jobId);
      const errJob = exportJobs.get(jobId);
      if (errJob) {
        exportJobs.set(jobId, { ...errJob, status: "failed", error: err.message });
      }
      reject(err);
    });
  });
}
function registerExportHandlers() {
  ipcMain.handle("export:start", async (_event, params) => {
    const { preset = "standard", fps = 30 } = params;
    const job = {
      id: crypto$1.randomUUID(),
      status: "queued",
      progress: 0,
      preset,
      fps,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    exportJobs.set(job.id, job);
    renderWithFfmpeg(job.id, params).catch((err) => {
      console.error("[export] Render failed:", err);
    });
    return job;
  });
  ipcMain.handle("export:poll", async (_event, id) => {
    const job = exportJobs.get(id);
    if (!job) throw new Error("Export not found");
    return job;
  });
  ipcMain.handle("export:cancel", async (_event, id) => {
    const proc = activeProcesses.get(id);
    if (proc) {
      proc.kill("SIGTERM");
      activeProcesses.delete(id);
    }
    const job = exportJobs.get(id);
    if (job) {
      exportJobs.set(id, { ...job, status: "failed", error: "Cancelled by user" });
      if (job.outputUrl) {
        try {
          fs.unlinkSync(job.outputUrl);
        } catch {
        }
      }
    }
    return { ok: true };
  });
}
const CONTENT_TYPES$2 = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg"
};
function guessContentType$3(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES$2[ext] ?? "application/octet-stream";
}
function toFsPathFromLocalMediaUrl$1(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "local-media:" || parsed.hostname !== "file") return null;
    let decodedPath = decodeURIComponent(parsed.pathname);
    if (process.platform === "win32" && decodedPath.startsWith("/")) {
      decodedPath = decodedPath.slice(1);
    }
    return path.normalize(decodedPath);
  } catch {
    return null;
  }
}
async function extractAudioForTranscription$1(inputPath) {
  const outputPath = path.join(
    os.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  );
  const ffmpegPath = getFfmpegPath();
  const args = [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    outputPath
  ];
  await new Promise((resolve, reject) => {
    var _a;
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    (_a = proc.stderr) == null ? void 0 : _a.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
  return outputPath;
}
function registerElementHandlers() {
  ipcMain.handle(
    "elements:upload",
    async (_event, fileData, apiKey) => {
      if (!apiKey) throw new Error("No API key provided");
      srcExports.fal.config({ credentials: apiKey });
      const blob = new Blob([fileData.buffer], { type: fileData.type });
      const file = new File([blob], fileData.name, { type: fileData.type });
      const url = await srcExports.fal.storage.upload(file);
      return { url };
    }
  );
  ipcMain.handle(
    "elements:upload-transcription-source",
    async (_event, sourceUrl, apiKey) => {
      if (!apiKey) throw new Error("No API key provided");
      const sourcePath = toFsPathFromLocalMediaUrl$1(sourceUrl);
      if (!sourcePath) {
        if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
          return { url: sourceUrl };
        }
        throw new Error("Transcription upload requires a local-media or remote URL source");
      }
      srcExports.fal.config({ credentials: apiKey });
      const extractedPath = await extractAudioForTranscription$1(sourcePath);
      try {
        const buffer = await fs$1.readFile(extractedPath);
        const baseName = path.basename(sourcePath, path.extname(sourcePath));
        const fileName = `${baseName}.m4a`;
        const type = guessContentType$3(extractedPath);
        const blob = new Blob([buffer], { type });
        const file = new File([blob], fileName, { type });
        const url = await srcExports.fal.storage.upload(file);
        return { url };
      } finally {
        await fs$1.unlink(extractedPath).catch(() => {
        });
      }
    }
  );
  ipcMain.handle(
    "elements:upload-media-source",
    async (_event, sourceUrl, apiKey) => {
      if (!apiKey) throw new Error("No API key provided");
      srcExports.fal.config({ credentials: apiKey });
      const sourcePath = toFsPathFromLocalMediaUrl$1(sourceUrl);
      if (sourcePath) {
        const buffer = await fs$1.readFile(sourcePath);
        const fileName = path.basename(sourcePath);
        const type = guessContentType$3(sourcePath);
        const blob = new Blob([buffer], { type });
        const file = new File([blob], fileName, { type });
        const url = await srcExports.fal.storage.upload(file);
        return { url };
      }
      if (sourceUrl.startsWith("data:")) {
        return { url: sourceUrl };
      }
      if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
        const os2 = await import("node:os");
        await import("node:fs");
        const ext = path.extname(new URL(sourceUrl).pathname) || ".mp4";
        const tmpPath = path.join(os2.tmpdir(), `cinegen-upload-${Date.now()}${ext}`);
        try {
          const response2 = await fetch(sourceUrl);
          if (!response2.ok) {
            throw new Error(`Remote file unavailable (HTTP ${response2.status}). The URL may have expired. Try re-importing the asset.`);
          }
          const arrayBuffer = await response2.arrayBuffer();
          await fs$1.writeFile(tmpPath, Buffer.from(arrayBuffer));
        } catch (downloadError) {
          throw new Error(
            downloadError instanceof Error ? downloadError.message : "Failed to download remote media. The URL may have expired."
          );
        }
        const buffer = await fs$1.readFile(tmpPath);
        const fileName = path.basename(tmpPath);
        const type = guessContentType$3(tmpPath);
        const blob = new Blob([buffer], { type });
        const file = new File([blob], fileName, { type });
        const url = await srcExports.fal.storage.upload(file);
        await fs$1.unlink(tmpPath).catch(() => {
        });
        return { url };
      }
      throw new Error("Media upload requires a local-media, remote URL, or data URI source");
    }
  );
}
function extractQueryTerms(query) {
  return [...new Set(
    query.toLowerCase().split(/[^a-z0-9']+/).map((term) => term.trim()).filter((term) => term.length >= 3)
  )];
}
function scoreMoment(moment, terms, activeTimelineId) {
  if (terms.length === 0) {
    return (moment.words.length > 0 ? 3 : 1) + (moment.timelinePlacements.some((placement) => placement.timelineId === activeTimelineId) ? 2 : 0);
  }
  const haystack = `${moment.assetName} ${moment.text} ${moment.words.map((word) => word.word).join(" ")}`.toLowerCase();
  const termScore = terms.reduce((score, term) => haystack.includes(term) ? score + (moment.text.toLowerCase().includes(term) ? 4 : 2) : score, 0);
  const activeBonus = moment.timelinePlacements.some((placement) => placement.timelineId === activeTimelineId) ? 2 : 0;
  const wordBonus = moment.words.length > 0 ? 2 : 0;
  return termScore + activeBonus + wordBonus;
}
function retrieveRelevantMoments(index, query, limit = 24) {
  const terms = extractQueryTerms(query);
  return index.moments.map((moment) => ({
    moment,
    score: scoreMoment(moment, terms, index.activeTimelineId)
  })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.moment.sourceStart - b.moment.sourceStart).slice(0, limit).map(({ moment, score }) => ({
    id: moment.id,
    assetId: moment.assetId,
    assetName: moment.assetName,
    text: moment.text,
    sourceStart: moment.sourceStart,
    sourceEnd: moment.sourceEnd,
    words: moment.words.slice(0, 32),
    timelinePlacements: moment.timelinePlacements,
    score,
    reason: terms.length > 0 ? `Matched ${terms.slice(0, 4).join(", ")} with ${moment.words.length > 0 ? "word-level timing" : "segment timing"}.` : `${moment.words.length > 0 ? "Word-level" : "Segment-level"} transcript candidate.`
  }));
}
const DEFAULT_VISION_MODEL = "google/gemini-2.5-flash";
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function tryParseJson(candidate) {
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}
function extractTextFromUnknown(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => extractTextFromUnknown(entry)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map((entry) => extractTextFromUnknown(entry)).filter(Boolean).join("\n");
  }
  return "";
}
function parseFractionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("%")) {
    const parsedPercent = Number(trimmed.slice(0, -1));
    return Number.isFinite(parsedPercent) ? parsedPercent / 100 : null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
function extractJsonText$1(raw) {
  var _a;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = tryParseJson(trimmed);
  if (direct) return direct;
  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedBlocks) {
    const inner = (_a = match[1]) == null ? void 0 : _a.trim();
    if (!inner) continue;
    const parsedFence = tryParseJson(inner);
    if (parsedFence) return parsedFence;
  }
  const openers = /* @__PURE__ */ new Map([
    ["{", "}"],
    ["[", "]"]
  ]);
  for (let start = 0; start < trimmed.length; start++) {
    const firstChar = trimmed[start];
    const expectedCloser = openers.get(firstChar);
    if (!expectedCloser) continue;
    const stack = [expectedCloser];
    let inString = false;
    let escaped = false;
    for (let end = start + 1; end < trimmed.length; end++) {
      const ch = trimmed[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      const nestedCloser = openers.get(ch);
      if (nestedCloser) {
        stack.push(nestedCloser);
        continue;
      }
      if (ch === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          const candidate = trimmed.slice(start, end + 1);
          const parsedCandidate = tryParseJson(candidate);
          if (parsedCandidate) return parsedCandidate;
          break;
        }
        continue;
      }
      if (ch === "}" || ch === "]") {
        break;
      }
    }
  }
  return null;
}
function guessContentType$2(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}
function toFsPath(raw) {
  if (!raw) return null;
  if (raw.startsWith("local-media://file/")) return decodeURIComponent(raw.replace("local-media://file", ""));
  if (raw.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  }
  if (raw.startsWith("/")) return raw;
  return null;
}
async function uploadImagePath(apiKey, rawPath) {
  if (/^https?:\/\//.test(rawPath)) return rawPath;
  if (rawPath.startsWith("data:")) {
    const match = rawPath.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
    if (!match) return null;
    const type2 = match[1] || "application/octet-stream";
    const payload = match[3] || "";
    const buffer2 = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    const blob2 = new Blob([buffer2], { type: type2 });
    const file2 = new File([blob2], `auto-segment.${type2.split("/")[1] || "bin"}`, { type: type2 });
    srcExports.fal.config({ credentials: apiKey });
    return srcExports.fal.storage.upload(file2);
  }
  const fsPath = toFsPath(rawPath);
  if (!fsPath) return null;
  const buffer = await fs$1.readFile(fsPath);
  const type = guessContentType$2(fsPath);
  const blob = new Blob([buffer], { type });
  const file = new File([blob], path.basename(fsPath), { type });
  srcExports.fal.config({ credentials: apiKey });
  return srcExports.fal.storage.upload(file);
}
function normalizeDetectedObjects(parsed, maxObjects) {
  const rawObjects = Array.isArray(parsed.objects) ? parsed.objects : Array.isArray(parsed.detections) ? parsed.detections : Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.regions) ? parsed.regions : Array.isArray(parsed.subjects) ? parsed.subjects : typeof parsed.label === "string" || typeof parsed.name === "string" || typeof parsed.object === "string" ? [parsed] : [];
  const nextObjects = rawObjects.map((rawObject) => {
    if (!rawObject || typeof rawObject !== "object") return null;
    const record = rawObject;
    const label = [
      record.label,
      record.name,
      record.object,
      record.subject,
      record.class,
      record.type
    ].find((value) => typeof value === "string" && value.trim());
    const nextLabel = typeof label === "string" ? label.trim() : "";
    if (!nextLabel) return null;
    let x = null;
    let y = null;
    let w = null;
    let h = null;
    const centerBox = Array.isArray(record.box) ? record.box : Array.isArray(record.cxcywh) ? record.cxcywh : null;
    if (centerBox && centerBox.length >= 4) {
      x = parseFractionalNumber(centerBox[0]);
      y = parseFractionalNumber(centerBox[1]);
      w = parseFractionalNumber(centerBox[2]);
      h = parseFractionalNumber(centerBox[3]);
    }
    const cornerArray = Array.isArray(record.bbox) ? record.bbox : Array.isArray(record.bounds) ? record.bounds : Array.isArray(record.rect) ? record.rect : Array.isArray(record.xyxy) ? record.xyxy : null;
    if ((x === null || y === null || w === null || h === null) && cornerArray && cornerArray.length >= 4) {
      const x0 = parseFractionalNumber(cornerArray[0]);
      const y0 = parseFractionalNumber(cornerArray[1]);
      const x1 = parseFractionalNumber(cornerArray[2]);
      const y1 = parseFractionalNumber(cornerArray[3]);
      if ([x0, y0, x1, y1].every((value) => value !== null)) {
        x = (x0 + x1) / 2;
        y = (y0 + y1) / 2;
        w = x1 - x0;
        h = y1 - y0;
      }
    }
    const box3d = Array.isArray(record.box_3d) ? record.box_3d : Array.isArray(record.box3d) ? record.box3d : null;
    if ((x === null || y === null || w === null || h === null) && box3d && box3d.length >= 6) {
      const centerX = parseFractionalNumber(box3d[0]);
      const centerY = parseFractionalNumber(box3d[1]);
      const dimA = parseFractionalNumber(box3d[3]);
      const dimB = parseFractionalNumber(box3d[4]);
      const dimC = parseFractionalNumber(box3d[5]);
      if ([centerX, centerY, dimA, dimB, dimC].every((value) => value !== null)) {
        x = centerX;
        y = centerY;
        w = Math.max(dimA, dimB);
        h = Math.max(dimB, dimC);
      }
    }
    if (x === null || y === null || w === null || h === null) {
      const cx = parseFractionalNumber(record.center_x ?? record.cx ?? record.mid_x);
      const cy = parseFractionalNumber(record.center_y ?? record.cy ?? record.mid_y);
      const width2 = parseFractionalNumber(record.width ?? record.w);
      const height2 = parseFractionalNumber(record.height ?? record.h);
      if ([cx, cy, width2, height2].every((value) => value !== null)) {
        x = cx;
        y = cy;
        w = width2;
        h = height2;
      }
    }
    if (x === null || y === null || w === null || h === null) {
      const xMin = parseFractionalNumber(record.x_min ?? record.left);
      const yMin = parseFractionalNumber(record.y_min ?? record.top);
      const xMax = parseFractionalNumber(record.x_max ?? record.right);
      const yMax = parseFractionalNumber(record.y_max ?? record.bottom);
      if ([xMin, yMin, xMax, yMax].every((value) => value !== null)) {
        x = (xMin + xMax) / 2;
        y = (yMin + yMax) / 2;
        w = xMax - xMin;
        h = yMax - yMin;
      }
    }
    if ([x, y, w, h].some((value) => value === null || !Number.isFinite(value))) return null;
    const width = clamp(w, 0.02, 1);
    const height = clamp(h, 0.02, 1);
    const nextBox = [
      clamp(x, width / 2, 1 - width / 2),
      clamp(y, height / 2, 1 - height / 2),
      width,
      height
    ];
    const rawScore = parseFractionalNumber(record.score ?? record.confidence ?? record.probability);
    const score = rawScore !== null ? clamp(rawScore, 0, 1) : 0.75;
    const rawPriority = parseFractionalNumber(record.priority ?? record.salience ?? record.importance);
    const priority = rawPriority !== null ? clamp(rawPriority, 0, 1) : score;
    return {
      label: nextLabel,
      box: nextBox,
      score,
      priority
    };
  }).filter((entry) => Boolean(entry)).sort((left, right) => right.priority - left.priority || right.score - left.score);
  const deduped = [];
  for (const candidate of nextObjects) {
    const duplicate = deduped.some((existing) => {
      const sameLabel = existing.label.toLowerCase() === candidate.label.toLowerCase();
      const dx = Math.abs(existing.box[0] - candidate.box[0]);
      const dy = Math.abs(existing.box[1] - candidate.box[1]);
      const dw = Math.abs(existing.box[2] - candidate.box[2]);
      const dh = Math.abs(existing.box[3] - candidate.box[3]);
      return sameLabel && dx < 0.06 && dy < 0.06 && dw < 0.08 && dh < 0.08;
    });
    if (!duplicate) deduped.push(candidate);
    if (deduped.length >= maxObjects) break;
  }
  return deduped;
}
function extractObjectPayload(value) {
  if (Array.isArray(value)) {
    return { objects: value };
  }
  if (value && typeof value === "object") {
    const record = value;
    if (Array.isArray(record.objects) || Array.isArray(record.detections) || Array.isArray(record.items) || Array.isArray(record.regions) || Array.isArray(record.subjects)) {
      return record;
    }
    if (typeof record.label === "string" || typeof record.name === "string" || typeof record.object === "string" || Array.isArray(record.box_3d) || Array.isArray(record.box3d) || Array.isArray(record.box) || Array.isArray(record.bbox)) {
      return { objects: [record] };
    }
    for (const key of ["output", "text", "content", "message", "result", "data", "response"]) {
      if (key in record) {
        const nested = extractObjectPayload(record[key]);
        if (nested) return nested;
      }
    }
  }
  const text = extractTextFromUnknown(value);
  if (!text) return null;
  const jsonText = extractJsonText$1(text);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return { objects: parsed };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
async function runVisionObjectProposal(apiKey, uploaded, model, maxObjects, prompt) {
  srcExports.fal.config({ credentials: apiKey });
  const result = await srcExports.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model,
      prompt,
      image_urls: [uploaded],
      max_tokens: 700
    },
    logs: true
  });
  const data = result.data;
  const payload = extractObjectPayload(data.output) ?? extractObjectPayload(data.text) ?? extractObjectPayload(data);
  if (!payload) {
    console.warn("[vision:auto-seg] Could not extract object JSON from vision response", {
      outputPreview: extractTextFromUnknown(data.output || data.text || data).slice(0, 1e3),
      maxObjects
    });
  }
  return payload;
}
async function analyzeAssetVisualSummary(params) {
  var _a, _b, _c, _d, _e;
  if (!params.apiKey) throw new Error("No fal.ai API key provided.");
  const uploaded = (await Promise.all(
    params.framePaths.slice(0, 6).map((framePath) => uploadImagePath(params.apiKey, framePath).catch(() => null))
  )).filter((url) => Boolean(url));
  if (uploaded.length === 0) {
    return {
      assetId: params.assetId,
      status: "missing",
      model: ((_a = params.model) == null ? void 0 : _a.trim()) || DEFAULT_VISION_MODEL,
      error: "No visual frames were available to upload for analysis."
    };
  }
  srcExports.fal.config({ credentials: params.apiKey });
  const result = await srcExports.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((_b = params.model) == null ? void 0 : _b.trim()) || DEFAULT_VISION_MODEL,
      prompt: [
        `Analyze these frames from asset "${params.assetName}" for editorial planning.`,
        "Return compact JSON only with this shape:",
        '{"summary":"...","tone":["..."],"pacing":"...","shotTypes":["..."],"subjects":["..."],"brollIdeas":["..."],"confidence":0.82}',
        "Focus on emotional tone, coverage value, pacing feel, character presence, likely shot type, and practical b-roll opportunities."
      ].join("\n"),
      image_urls: uploaded,
      max_tokens: 450
    },
    logs: true
  });
  const data = result.data;
  const output = extractTextFromUnknown(data.output) || extractTextFromUnknown(data.text) || "";
  const jsonText = extractJsonText$1(output);
  if (!jsonText) {
    return {
      assetId: params.assetId,
      status: "failed",
      model: ((_c = params.model) == null ? void 0 : _c.trim()) || DEFAULT_VISION_MODEL,
      error: "Vision analysis did not return valid JSON."
    };
  }
  try {
    const parsed = JSON.parse(jsonText);
    return {
      assetId: params.assetId,
      status: "ready",
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : void 0,
      tone: Array.isArray(parsed.tone) ? parsed.tone.filter((entry) => typeof entry === "string") : void 0,
      pacing: typeof parsed.pacing === "string" ? parsed.pacing.trim() : void 0,
      shotTypes: Array.isArray(parsed.shotTypes) ? parsed.shotTypes.filter((entry) => typeof entry === "string") : void 0,
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects.filter((entry) => typeof entry === "string") : void 0,
      brollIdeas: Array.isArray(parsed.brollIdeas) ? parsed.brollIdeas.filter((entry) => typeof entry === "string") : void 0,
      confidence: typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence : void 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      model: ((_d = params.model) == null ? void 0 : _d.trim()) || DEFAULT_VISION_MODEL,
      sourceFrameCount: uploaded.length
    };
  } catch {
    return {
      assetId: params.assetId,
      status: "failed",
      model: ((_e = params.model) == null ? void 0 : _e.trim()) || DEFAULT_VISION_MODEL,
      error: "Vision analysis JSON parse failed."
    };
  }
}
async function detectObjectsInImage(params) {
  var _a, _b;
  if (!params.apiKey) throw new Error("No fal.ai API key provided.");
  const maxObjects = Math.min(12, Math.max(1, Math.round(params.maxObjects ?? 6)));
  const uploaded = await uploadImagePath(params.apiKey, params.imagePath).catch(() => null);
  if (!uploaded) {
    return {
      status: "missing",
      model: ((_a = params.model) == null ? void 0 : _a.trim()) || DEFAULT_VISION_MODEL,
      objects: [],
      error: "No image was available to upload for auto segmentation."
    };
  }
  const model = ((_b = params.model) == null ? void 0 : _b.trim()) || DEFAULT_VISION_MODEL;
  const primaryPrompt = [
    "You are preparing object proposals for a promptable segmentation model.",
    params.context ? `Context: ${params.context}` : null,
    `Return compact JSON only with this shape: {"objects":[{"label":"person","box":[0.52,0.48,0.28,0.7],"score":0.96,"priority":0.99}]}`,
    "Each object must include a normalized box in [center_x, center_y, width, height] with values between 0 and 1.",
    `List up to ${maxObjects} distinct, mask-worthy objects.`,
    "Prefer people, faces, pets, products, props, vehicles, furniture, signs, devices, and other clearly isolated subjects.",
    "Include partially visible or cropped people, cars, trucks, bikes, and handheld objects if they are recognizably present.",
    "Do not return an empty list unless there are truly no identifiable objects in the frame."
  ].filter(Boolean).join("\n");
  const retryPrompt = [
    "Retry object proposal extraction for image segmentation.",
    params.context ? `Context: ${params.context}` : null,
    "Be less selective. Return the most salient visible objects even if they are partially cropped, small, or overlapping.",
    `Return strict JSON only: {"objects":[{"label":"car","box":[0.5,0.5,0.4,0.3],"score":0.81,"priority":0.8}]}`,
    `Return between 1 and ${maxObjects} objects whenever any recognizable object exists.`
  ].filter(Boolean).join("\n");
  try {
    const primaryPayload = await runVisionObjectProposal(params.apiKey, uploaded, model, maxObjects, primaryPrompt);
    const primaryObjects = primaryPayload ? normalizeDetectedObjects(primaryPayload, maxObjects) : [];
    if (primaryObjects.length > 0) {
      console.info("[vision:auto-seg] Primary object proposals", {
        model,
        count: primaryObjects.length,
        objects: primaryObjects,
        context: params.context ?? null
      });
      return {
        status: "ready",
        model,
        objects: primaryObjects
      };
    }
    const retryPayload = await runVisionObjectProposal(params.apiKey, uploaded, model, maxObjects, retryPrompt);
    const retryObjects = retryPayload ? normalizeDetectedObjects(retryPayload, maxObjects) : [];
    if (retryObjects.length > 0) {
      console.info("[vision:auto-seg] Retry object proposals", {
        model,
        count: retryObjects.length,
        objects: retryObjects,
        context: params.context ?? null
      });
      return {
        status: "ready",
        model,
        objects: retryObjects
      };
    }
    console.warn("[vision:auto-seg] No usable objects found after both prompts", {
      model,
      primaryKeys: primaryPayload ? Object.keys(primaryPayload).slice(0, 12) : [],
      retryKeys: retryPayload ? Object.keys(retryPayload).slice(0, 12) : [],
      primaryPreview: primaryPayload ? JSON.stringify(primaryPayload).slice(0, 1e3) : "",
      retryPreview: retryPayload ? JSON.stringify(retryPayload).slice(0, 1e3) : "",
      context: params.context ?? null
    });
    return {
      status: "ready",
      model,
      objects: []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[vision:auto-seg] Detection failed", {
      model,
      context: params.context ?? null,
      error: message,
      stack: error instanceof Error ? error.stack : void 0
    });
    return {
      status: "failed",
      model,
      objects: [],
      error: message || "Vision auto-segmentation failed."
    };
  }
}
function registerVisionHandlers() {
  ipcMain.handle("vision:index-asset", async (_event, params) => {
    return analyzeAssetVisualSummary(params);
  });
  ipcMain.handle("vision:detect-objects", async (_event, params) => {
    return detectObjectsInImage(params);
  });
}
const DEFAULT_TEXT_MODEL = "anthropic/claude-sonnet-4.6";
function parseFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseUsage(value) {
  if (!value || typeof value !== "object") return void 0;
  const usage = value;
  const promptTokens = parseFiniteNumber(usage.prompt_tokens) ?? 0;
  const completionTokens = parseFiniteNumber(usage.completion_tokens) ?? 0;
  const totalTokens = parseFiniteNumber(usage.total_tokens) ?? promptTokens + completionTokens;
  const cost = parseFiniteNumber(usage.cost) ?? 0;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0 && cost <= 0) return void 0;
  return { promptTokens, completionTokens, totalTokens, cost };
}
function mergeUsage(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  return {
    promptTokens: base.promptTokens + extra.promptTokens,
    completionTokens: base.completionTokens + extra.completionTokens,
    totalTokens: base.totalTokens + extra.totalTokens,
    cost: base.cost + extra.cost
  };
}
function buildConversationPrompt(messages) {
  return messages.filter((message) => message.role !== "system" && message.content.trim()).map((message) => `${message.role === "assistant" ? "Assistant" : "User"}:
${message.content.trim()}`).join("\n\n").concat("\n\nAssistant:\n");
}
async function callTextLLM(params) {
  var _a;
  srcExports.fal.config({ credentials: params.apiKey });
  const input = {
    model: ((_a = params.model) == null ? void 0 : _a.trim()) || DEFAULT_TEXT_MODEL,
    prompt: params.prompt,
    max_tokens: Number.isFinite(params.maxTokens) ? Math.max(1, Math.floor(params.maxTokens)) : 1600
  };
  if (typeof params.systemPrompt === "string" && params.systemPrompt.trim()) {
    input.system_prompt = params.systemPrompt.trim();
  }
  if (typeof params.temperature === "number" && Number.isFinite(params.temperature)) {
    input.temperature = params.temperature;
  }
  const result = await srcExports.fal.subscribe("openrouter/router", { input, logs: true });
  const data = result.data;
  const output = typeof data.output === "string" ? data.output : typeof data.text === "string" ? data.text : "";
  return {
    message: output.trim(),
    usage: parseUsage(data.usage)
  };
}
function extractJsonText(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  }
  return null;
}
function normalizePersona(value) {
  switch (value) {
    case "documentary-editor":
    case "promo-trailer-editor":
    case "brand-storyteller":
    case "social-shortform-editor":
    case "interview-producer":
      return value;
    default:
      return "documentary-editor";
  }
}
function normalizeVariantCount(value, fallback = 3) {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) return fallback;
  return parsed <= 1 ? 1 : 3;
}
function fallbackEditorialBrief(request2, index) {
  const lower = request2.toLowerCase();
  const isPromo = /promo|trailer|hype|teaser|sizzle|ad|commercial/.test(lower);
  const isSocial = /tiktok|reel|short|vertical|social/.test(lower);
  const pieceType = isPromo ? "promo" : isSocial ? "social short" : "documentary interview";
  const persona = isPromo ? "promo-trailer-editor" : isSocial ? "social-shortform-editor" : "documentary-editor";
  const activeReference = index.referenceTimelines.find((timeline) => timeline.timelineId === index.activeTimelineId);
  return {
    pieceType,
    deliverable: pieceType,
    audience: isPromo ? "broad promotional audience" : "documentary/story audience",
    tone: isPromo ? "energetic and emotionally propulsive" : "grounded, human, story-first",
    pacing: isPromo ? "punchy" : "measured",
    targetDurationSeconds: isSocial ? 30 : 180,
    variantCount: 3,
    persona,
    storyGoal: isPromo ? "Hook quickly, escalate energy, and land a strong final beat." : "Find the emotional spine and shape it into a clear arc.",
    hook: isPromo ? "Open with the strongest visual or emotional hook." : "Open on the most emotionally revealing line.",
    formatNotes: "Use word-level timestamps when available and prefer complete thoughts.",
    qualityGoal: "auto",
    referenceTimelineId: activeReference == null ? void 0 : activeReference.timelineId,
    referenceTimelineName: activeReference == null ? void 0 : activeReference.timelineName,
    useBrollPlaceholders: true,
    confidence: 0.55,
    rationale: "Fallback brief inferred from request keywords and active project context."
  };
}
function normalizeClarifyingQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item;
    const question = typeof record.question === "string" ? record.question.trim() : "";
    if (!question) return [];
    const options = Array.isArray(record.options) ? record.options.flatMap((option, optionIndex) => {
      if (!option || typeof option !== "object") return [];
      const optionRecord = option;
      const label = typeof optionRecord.label === "string" ? optionRecord.label.trim() : "";
      if (!label) return [];
      return [{
        id: typeof optionRecord.id === "string" && optionRecord.id.trim() ? optionRecord.id.trim() : `opt_${index + 1}_${optionIndex + 1}`,
        label,
        description: typeof optionRecord.description === "string" ? optionRecord.description.trim() : void 0
      }];
    }) : [];
    return [{
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `question_${index + 1}`,
      question,
      help: typeof record.help === "string" ? record.help.trim() : void 0,
      allowCustom: record.allowCustom !== false,
      options
    }];
  });
}
function normalizeEditorialBrief(value, fallback) {
  if (!value || typeof value !== "object") {
    return { brief: fallback, clarifyingQuestions: [] };
  }
  const record = value;
  const brief = {
    pieceType: typeof record.pieceType === "string" && record.pieceType.trim() ? record.pieceType.trim() : fallback.pieceType,
    deliverable: typeof record.deliverable === "string" && record.deliverable.trim() ? record.deliverable.trim() : fallback.deliverable,
    audience: typeof record.audience === "string" && record.audience.trim() ? record.audience.trim() : fallback.audience,
    tone: typeof record.tone === "string" && record.tone.trim() ? record.tone.trim() : fallback.tone,
    pacing: typeof record.pacing === "string" && record.pacing.trim() ? record.pacing.trim() : fallback.pacing,
    targetDurationSeconds: Math.max(5, parseFiniteNumber(record.targetDurationSeconds) ?? fallback.targetDurationSeconds),
    variantCount: normalizeVariantCount(record.variantCount, fallback.variantCount),
    persona: normalizePersona(record.persona),
    storyGoal: typeof record.storyGoal === "string" && record.storyGoal.trim() ? record.storyGoal.trim() : fallback.storyGoal,
    hook: typeof record.hook === "string" && record.hook.trim() ? record.hook.trim() : fallback.hook,
    formatNotes: typeof record.formatNotes === "string" && record.formatNotes.trim() ? record.formatNotes.trim() : fallback.formatNotes,
    qualityGoal: record.qualityGoal === "story" || record.qualityGoal === "retention" || record.qualityGoal === "clarity" || record.qualityGoal === "auto" ? record.qualityGoal : fallback.qualityGoal,
    referenceTimelineId: typeof record.referenceTimelineId === "string" && record.referenceTimelineId.trim() ? record.referenceTimelineId.trim() : fallback.referenceTimelineId,
    referenceTimelineName: typeof record.referenceTimelineName === "string" && record.referenceTimelineName.trim() ? record.referenceTimelineName.trim() : fallback.referenceTimelineName,
    useBrollPlaceholders: typeof record.useBrollPlaceholders === "boolean" ? record.useBrollPlaceholders : fallback.useBrollPlaceholders,
    confidence: Math.min(1, Math.max(0, parseFiniteNumber(record.confidence) ?? fallback.confidence)),
    rationale: typeof record.rationale === "string" && record.rationale.trim() ? record.rationale.trim() : fallback.rationale
  };
  return {
    brief,
    clarifyingQuestions: normalizeClarifyingQuestions(record.clarifyingQuestions)
  };
}
function mergeEditorialBrief(base, override, answers) {
  const next = { ...base, ...override ?? {} };
  if (answers) {
    const answerLines = Object.entries(answers).map(([key, value]) => `${key}: ${value}`).filter((line) => !line.endsWith(": "));
    if (answerLines.length > 0) {
      next.formatNotes = `${next.formatNotes}
Clarifications:
${answerLines.join("\n")}`.trim();
      next.rationale = `${next.rationale} Clarifications were provided by the user.`;
    }
  }
  return next;
}
function normalizePositiveNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, num);
}
function normalizeSegment(segment) {
  if (!segment || typeof segment !== "object") return null;
  const record = segment;
  const sourceStart = normalizePositiveNumber(record.source_start);
  const sourceEnd = normalizePositiveNumber(record.source_end);
  if (sourceStart === null || sourceEnd === null || sourceEnd <= sourceStart) return null;
  const assetId = typeof record.asset_id === "string" && record.asset_id.trim() ? record.asset_id.trim() : void 0;
  const assetName = typeof record.asset_name === "string" && record.asset_name.trim() ? record.asset_name.trim() : void 0;
  if (!assetId && !assetName) return null;
  return {
    ...assetId ? { asset_id: assetId } : {},
    ...assetName ? { asset_name: assetName } : {},
    source_start: sourceStart,
    source_end: sourceEnd,
    ...typeof record.note === "string" && record.note.trim() ? { note: record.note.trim() } : {}
  };
}
function normalizeProposal(value, fallbackName) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  const segments = Array.isArray(record.segments) ? record.segments.map(normalizeSegment).filter((segment) => Boolean(segment)) : [];
  if (segments.length === 0) return null;
  return {
    type: "cut_proposal",
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : `Proposed ${segments.length} cut segments.`,
    timeline_name: typeof record.timeline_name === "string" && record.timeline_name.trim() ? record.timeline_name.trim() : fallbackName,
    should_create_timeline: typeof record.should_create_timeline === "boolean" ? record.should_create_timeline : false,
    segments
  };
}
function normalizeCutVariants(value) {
  if (!value || typeof value !== "object") return [];
  const record = value;
  if (!Array.isArray(record.variants)) return [];
  return record.variants.flatMap((variant, variantIndex) => {
    var _a;
    if (!variant || typeof variant !== "object") return [];
    const variantRecord = variant;
    const proposals = Array.isArray(variantRecord.proposals) ? variantRecord.proposals.map((proposal) => normalizeProposal(proposal, `AI Cut ${variantIndex + 1}`)).filter((proposal) => Boolean(proposal)) : [];
    if (proposals.length === 0) return [];
    return [{
      id: typeof variantRecord.id === "string" && variantRecord.id.trim() ? variantRecord.id.trim() : `variant_${variantIndex + 1}`,
      title: typeof variantRecord.title === "string" && variantRecord.title.trim() ? variantRecord.title.trim() : `Variant ${variantIndex + 1}`,
      strategy: typeof variantRecord.strategy === "string" && variantRecord.strategy.trim() ? variantRecord.strategy.trim() : "Balanced editorial approach",
      summary: typeof variantRecord.summary === "string" && variantRecord.summary.trim() ? variantRecord.summary.trim() : ((_a = proposals[0]) == null ? void 0 : _a.summary) ?? "Proposed edit.",
      rationale: typeof variantRecord.rationale === "string" && variantRecord.rationale.trim() ? variantRecord.rationale.trim() : "Generated from editorial brief, retrieval hits, and project context.",
      proposals,
      scorecard: {
        overall: 0,
        storyArc: 0,
        pacing: 0,
        clarity: 0,
        visualFit: 0,
        completeness: 0,
        formatFit: 0,
        strengths: [],
        cautions: [],
        rationale: ""
      }
    }];
  });
}
function normalizeScorecards(value, variants) {
  if (!value || typeof value !== "object") return variants;
  const record = value;
  const scorecards = Array.isArray(record.scorecards) ? record.scorecards : [];
  const scorecardById = /* @__PURE__ */ new Map();
  for (const scorecard of scorecards) {
    if (!scorecard || typeof scorecard !== "object") continue;
    const item = scorecard;
    const variantId = typeof item.variant_id === "string" ? item.variant_id.trim() : "";
    if (!variantId) continue;
    scorecardById.set(variantId, {
      overall: parseFiniteNumber(item.overall) ?? 78,
      storyArc: parseFiniteNumber(item.storyArc) ?? 78,
      pacing: parseFiniteNumber(item.pacing) ?? 78,
      clarity: parseFiniteNumber(item.clarity) ?? 78,
      visualFit: parseFiniteNumber(item.visualFit) ?? 78,
      completeness: parseFiniteNumber(item.completeness) ?? 78,
      formatFit: parseFiniteNumber(item.formatFit) ?? 78,
      strengths: Array.isArray(item.strengths) ? item.strengths.filter((entry) => typeof entry === "string") : [],
      cautions: Array.isArray(item.cautions) ? item.cautions.filter((entry) => typeof entry === "string") : [],
      rationale: typeof item.rationale === "string" ? item.rationale.trim() : ""
    });
  }
  const rankedIds = Array.isArray(record.ranked_variant_ids) ? record.ranked_variant_ids.filter((entry) => typeof entry === "string") : variants.map((variant) => variant.id);
  const ranked = [...variants].map((variant, index) => ({
    ...variant,
    scorecard: scorecardById.get(variant.id) ?? {
      overall: 78 - index,
      storyArc: 78 - index,
      pacing: 78 - index,
      clarity: 78 - index,
      visualFit: 78 - index,
      completeness: 78 - index,
      formatFit: 78 - index,
      strengths: ["No judge score available; kept generation order."],
      cautions: [],
      rationale: "Judge pass was unavailable, so the generation order was preserved."
    }
  }));
  ranked.sort((a, b) => {
    const aRank = rankedIds.indexOf(a.id);
    const bRank = rankedIds.indexOf(b.id);
    if (aRank === -1 && bRank === -1) return b.scorecard.overall - a.scorecard.overall;
    if (aRank === -1) return 1;
    if (bRank === -1) return -1;
    return aRank - bRank;
  });
  return ranked;
}
function summarizeReferenceTimelines(index) {
  return index.referenceTimelines.slice(0, 5).map((timeline) => `- ${timeline.timelineName}${timeline.isActive ? " (active)" : ""}: ${timeline.structureSummary}; primary assets: ${timeline.primaryAssets.join(", ") || "none"}`).join("\n");
}
function summarizeRetrievedMoments(moments) {
  return moments.slice(0, 18).map((moment, index) => {
    const placement = moment.timelinePlacements[0];
    const placementText = placement ? ` | timeline: ${placement.timelineName} @ ${placement.timelineTime.toFixed(1)}` : "";
    const wordTimingText = moment.words.length > 0 ? `
   Word timings: ${moment.words.slice(0, 18).map((word) => `${word.word}@${word.start.toFixed(1)}-${word.end.toFixed(1)}`).join(" ")}` : "";
    return `${index + 1}. ${moment.assetName} ${moment.sourceStart.toFixed(1)}-${moment.sourceEnd.toFixed(1)}${placementText}
   ${moment.text}
   Reason: ${moment.reason}${wordTimingText}`;
  }).join("\n");
}
function summarizeVisualFindings(findings) {
  return findings.filter((finding) => finding.status === "ready" && finding.summary).slice(0, 6).map((finding) => [
    `- Asset ${finding.assetId}: ${finding.summary}`,
    finding.tone && finding.tone.length > 0 ? `  Tone: ${finding.tone.join(", ")}` : "",
    finding.pacing ? `  Pacing: ${finding.pacing}` : "",
    finding.shotTypes && finding.shotTypes.length > 0 ? `  Shot types: ${finding.shotTypes.join(", ")}` : "",
    finding.brollIdeas && finding.brollIdeas.length > 0 ? `  B-roll ideas: ${finding.brollIdeas.join(", ")}` : ""
  ].filter(Boolean).join("\n")).join("\n");
}
async function analyzeVisualContext(params) {
  var _a;
  const assetIds = new Set(params.retrievedMoments.map((moment) => moment.assetId));
  const candidates = params.visualCandidates.filter((candidate) => assetIds.has(candidate.assetId)).slice(0, 4);
  const findings = [];
  for (const candidate of candidates) {
    if (((_a = candidate.storedSummary) == null ? void 0 : _a.status) === "ready" && (!params.model || candidate.storedSummary.model === params.model)) {
      findings.push(candidate.storedSummary);
      continue;
    }
    findings.push(await analyzeAssetVisualSummary({
      apiKey: params.apiKey,
      assetId: candidate.assetId,
      assetName: candidate.assetName,
      framePaths: candidate.framePaths,
      model: params.model
    }));
  }
  return findings;
}
async function inferEditorialBrief(params) {
  var _a;
  const fallback = fallbackEditorialBrief(params.request, params.index);
  const prompt = [
    "You are CineGen's senior editorial strategist.",
    "Infer the best editable cut brief for this request from the active project context.",
    "Return JSON only with this shape:",
    '{"pieceType":"...","deliverable":"...","audience":"...","tone":"...","pacing":"...","targetDurationSeconds":180,"variantCount":3,"persona":"documentary-editor","storyGoal":"...","hook":"...","formatNotes":"...","qualityGoal":"auto","referenceTimelineId":"optional","referenceTimelineName":"optional","useBrollPlaceholders":true,"confidence":0.84,"rationale":"...","clarifyingQuestions":[{"id":"...","question":"...","help":"...","allowCustom":true,"options":[{"id":"...","label":"...","description":"..."}]}]}',
    "Only include clarifying questions if the request is ambiguous or materially underspecified.",
    "",
    `User request: ${params.request}`,
    "",
    "Project context:",
    `- Assets: ${params.index.stats.assetCount}`,
    `- Transcript-ready assets: ${params.index.stats.transcriptReadyCount}`,
    `- Word-timestamp-ready assets: ${params.index.stats.wordTimestampReadyCount}`,
    `- Visual-summary-ready assets: ${params.index.stats.visualSummaryReadyCount}`,
    "Reference timelines:",
    summarizeReferenceTimelines(params.index)
  ].join("\n");
  const response2 = await callTextLLM({
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt: [
      "You produce concise, grounded editorial briefs for film and promo editors.",
      ((_a = params.customSystemPrompt) == null ? void 0 : _a.trim()) || ""
    ].filter(Boolean).join("\n\n"),
    prompt,
    maxTokens: 900,
    temperature: 0.35
  });
  const jsonText = extractJsonText(response2.message);
  if (!jsonText) {
    return { brief: fallback, clarifyingQuestions: [], usage: response2.usage };
  }
  try {
    const parsed = JSON.parse(jsonText);
    const normalized = normalizeEditorialBrief(parsed, fallback);
    return { ...normalized, usage: response2.usage };
  } catch {
    return { brief: fallback, clarifyingQuestions: [], usage: response2.usage };
  }
}
function buildRetrievalSummary(index, request2, brief, visualFindings) {
  const retrievalQuery = [request2, brief.storyGoal, brief.hook, brief.tone, brief.audience].join(" ");
  const topMoments = retrieveRelevantMoments(index, retrievalQuery, 20);
  const visualReadyCount = visualFindings.filter((finding) => finding.status === "ready").length;
  return {
    topMoments,
    referenceTimelines: index.referenceTimelines.slice(0, 4),
    visualSummaryStatus: visualReadyCount <= 0 ? "none" : visualReadyCount < Math.max(1, topMoments.length) ? "partial" : "ready",
    note: topMoments.length > 0 ? `Retrieved ${topMoments.length} transcript-driven source moments${visualReadyCount > 0 ? ` and ${visualReadyCount} visual summaries` : ""}.` : "No high-confidence transcript moments were retrieved; generation should stay conservative."
  };
}
async function generateCutVariants(params) {
  var _a;
  const parseSingleVariantResponse = (rawMessage, usage2) => {
    const jsonText = extractJsonText(rawMessage);
    if (!jsonText) return null;
    try {
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeCutVariants({ variants: [parsed] });
      const variant = normalized[0];
      if (!variant) return null;
      return {
        variant,
        usage: usage2
      };
    } catch {
      return null;
    }
  };
  const repairSingleVariant = async (rawMessage, variantIndex) => {
    const repairPrompt = [
      `Repair this malformed cut-variant response into valid JSON for variant ${variantIndex + 1}.`,
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "Do not add commentary before or after the JSON.",
      "If part of the raw output was truncated, salvage one valid variant.",
      "",
      "Malformed response:",
      rawMessage
    ].join("\n");
    const repairResponse = await callTextLLM({
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt: "You repair malformed structured editor outputs. Return strict JSON only.",
      prompt: repairPrompt,
      maxTokens: 4200,
      temperature: 0.1
    });
    const repaired = parseSingleVariantResponse(repairResponse.message, repairResponse.usage);
    if (repaired) return repaired;
    return {
      variant: null,
      usage: repairResponse.usage
    };
  };
  const variantCount = params.brief.variantCount;
  const lowerBrief = `${params.brief.pieceType} ${params.brief.deliverable} ${params.brief.tone}`.toLowerCase();
  const strategyTemplates = /promo|trailer|social|teaser|hype/.test(lowerBrief) ? [
    "Hook-first build: open with the strongest reveal, escalate momentum, and land a clean payoff.",
    "Character-first build: anchor emotionally first, then accelerate into the strongest theme beat.",
    "Payoff-first reverse build: tease the outcome early, then build toward why it matters."
  ] : [
    "Chronological emotional arc: move from foundation into escalation and close on the strongest emotional beat.",
    "Theme-first structure: organize around the core idea instead of strict chronology, favoring emotional clarity.",
    "Cold-open documentary structure: open on the strongest line, then rewind and build a layered arc."
  ];
  const chosenStrategies = strategyTemplates.slice(0, variantCount);
  let usage;
  const variants = [];
  for (let index = 0; index < chosenStrategies.length; index += 1) {
    const strategyPrompt = chosenStrategies[index];
    const prompt = [
      "You are CineGen's lead editor creating one high-quality cut proposal.",
      `Generate exactly one editorial variant using this strategy: ${strategyPrompt}`,
      "Use the retrieved moments and visual findings as evidence. Do not invent content outside them.",
      "Use word-level source timings when possible and cut tighter than sentence edges when the request calls for it.",
      "Do not include any prose before or after the JSON.",
      "Keep notes concise and practical.",
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "If the user asked for multiple parts, the variant may include multiple proposals, one per part.",
      variants.length > 0 ? `Already generated variants (do something meaningfully different):
${JSON.stringify(variants.map((variant) => ({ title: variant.title, strategy: variant.strategy, summary: variant.summary })), null, 2)}` : "",
      "",
      "Editorial brief:",
      JSON.stringify(params.brief, null, 2),
      "",
      "Retrieved moments:",
      summarizeRetrievedMoments(params.retrievalSummary.topMoments),
      "",
      "Reference timelines:",
      params.retrievalSummary.referenceTimelines.map((timeline) => `- ${timeline.timelineName}: ${timeline.structureSummary}`).join("\n") || "- none",
      "",
      "Visual findings:",
      summarizeVisualFindings(params.visualFindings) || "- none",
      "",
      `Original request: ${params.request}`
    ].filter(Boolean).join("\n");
    const response2 = await callTextLLM({
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt: [
        "You are a world-class editor. Make proposals that feel genuinely cuttable, not generic.",
        "When the brief reads documentary/interview, think like a documentary filmmaker shaping a story arc.",
        "When the brief reads promo/trailer/social, think like a promo editor optimizing hook, pacing, and payoff.",
        ((_a = params.customSystemPrompt) == null ? void 0 : _a.trim()) || ""
      ].filter(Boolean).join("\n\n"),
      prompt,
      maxTokens: 2400,
      temperature: 0.45
    });
    usage = mergeUsage(usage, response2.usage);
    const parsed = parseSingleVariantResponse(response2.message, response2.usage);
    if (parsed == null ? void 0 : parsed.variant) {
      variants.push({
        ...parsed.variant,
        id: `variant_${index + 1}`
      });
      continue;
    }
    const repaired = await repairSingleVariant(response2.message, index);
    usage = mergeUsage(usage, repaired.usage);
    if (repaired.variant) {
      variants.push({
        ...repaired.variant,
        id: `variant_${index + 1}`
      });
    }
  }
  if (variants.length === 0) {
    return {
      variants: [],
      summaryMessage: "I hit a formatting issue while packaging the cut variants. Review the brief and try again.",
      usage
    };
  }
  return {
    variants,
    summaryMessage: variants.length === 1 ? "I generated one cut variant. Review it below." : `I generated ${variants.length} cut variants. Review the options below.`,
    usage
  };
}
async function judgeCutVariants(params) {
  var _a;
  if (params.variants.length === 0) return { variants: [] };
  const prompt = [
    "You are CineGen's finishing editor and quality judge.",
    "Score these variants against the brief. Prefer genuinely strong editorial structure over generic balance.",
    "Return JSON only with this shape:",
    '{"ranked_variant_ids":["variant_2","variant_1","variant_3"],"scorecards":[{"variant_id":"variant_2","overall":92,"storyArc":94,"pacing":90,"clarity":89,"visualFit":88,"completeness":91,"formatFit":93,"strengths":["..."],"cautions":["..."],"rationale":"..."}]}',
    "",
    "Editorial brief:",
    JSON.stringify(params.brief, null, 2),
    "",
    "Retrieved evidence summary:",
    summarizeRetrievedMoments(params.retrievalSummary.topMoments.slice(0, 10)),
    "",
    "Variants:",
    JSON.stringify(params.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      strategy: variant.strategy,
      summary: variant.summary,
      rationale: variant.rationale,
      proposalSummaries: variant.proposals.map((proposal) => ({
        timeline_name: proposal.timeline_name,
        summary: proposal.summary,
        segmentCount: proposal.segments.length,
        firstSegments: proposal.segments.slice(0, 4)
      }))
    })), null, 2)
  ].join("\n");
  const response2 = await callTextLLM({
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt: [
      "Be decisive. Prefer the best usable cut, not the safest explanation.",
      ((_a = params.customSystemPrompt) == null ? void 0 : _a.trim()) || ""
    ].filter(Boolean).join("\n\n"),
    prompt,
    maxTokens: 1600,
    temperature: 0.2
  });
  const jsonText = extractJsonText(response2.message);
  if (!jsonText) return { variants: params.variants, usage: response2.usage };
  try {
    const parsed = JSON.parse(jsonText);
    return {
      variants: normalizeScorecards(parsed, params.variants),
      usage: response2.usage
    };
  } catch {
    return { variants: params.variants, usage: response2.usage };
  }
}
async function runCutWorkflow(params) {
  if (!params.apiKey) throw new Error("No fal.ai API key provided.");
  const index = params.index;
  const request2 = params.request.trim();
  if (!request2) throw new Error("No cut request provided.");
  let usage;
  const briefInference = await inferEditorialBrief({
    apiKey: params.apiKey,
    model: params.model,
    customSystemPrompt: params.systemPrompt,
    request: request2,
    index
  });
  usage = mergeUsage(usage, briefInference.usage);
  const mergedBrief = mergeEditorialBrief(briefInference.brief, params.briefOverride, params.questionAnswers);
  const retrievalSummary = buildRetrievalSummary(index, request2, mergedBrief, []);
  if (!params.confirmedBrief) {
    return {
      stage: "brief",
      summaryMessage: briefInference.clarifyingQuestions.length > 0 ? "I drafted an editorial brief and I need a bit of guidance before generating the cut variants." : "I drafted the editorial brief. Review it, adjust anything you want, then generate the cut variants.",
      editorialBrief: mergedBrief,
      clarifyingQuestions: briefInference.clarifyingQuestions,
      retrievalSummary,
      visualFindings: [],
      variants: [],
      ...usage ? { usage } : {}
    };
  }
  const visualFindings = await analyzeVisualContext({
    apiKey: params.apiKey,
    visualCandidates: index.visualInputs,
    retrievedMoments: retrievalSummary.topMoments,
    model: params.visionModel
  });
  const refreshedRetrievalSummary = buildRetrievalSummary(index, request2, mergedBrief, visualFindings);
  const generation = await generateCutVariants({
    apiKey: params.apiKey,
    model: params.model,
    customSystemPrompt: params.systemPrompt,
    request: request2,
    brief: mergedBrief,
    retrievalSummary: refreshedRetrievalSummary,
    visualFindings
  });
  usage = mergeUsage(usage, generation.usage);
  if (generation.variants.length === 0) {
    return {
      stage: "brief",
      summaryMessage: generation.summaryMessage,
      editorialBrief: mergedBrief,
      clarifyingQuestions: briefInference.clarifyingQuestions,
      retrievalSummary: refreshedRetrievalSummary,
      visualFindings,
      variants: [],
      ...usage ? { usage } : {}
    };
  }
  const judged = await judgeCutVariants({
    apiKey: params.apiKey,
    model: params.model,
    customSystemPrompt: params.systemPrompt,
    brief: mergedBrief,
    retrievalSummary: refreshedRetrievalSummary,
    variants: generation.variants
  });
  usage = mergeUsage(usage, judged.usage);
  return {
    stage: "variants",
    summaryMessage: generation.summaryMessage,
    editorialBrief: mergedBrief,
    clarifyingQuestions: briefInference.clarifyingQuestions,
    retrievalSummary: refreshedRetrievalSummary,
    visualFindings,
    variants: judged.variants,
    ...usage ? { usage } : {}
  };
}
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
function getMainWindow$2() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}
async function streamOllamaChat(requestId, params) {
  var _a, _b;
  const model = ((_a = params.model) == null ? void 0 : _a.trim()) || "qwen3.5:latest";
  const messages = [];
  if ((_b = params.systemPrompt) == null ? void 0 : _b.trim()) {
    messages.push({ role: "system", content: params.systemPrompt.trim() });
  }
  for (const msg of params.messages ?? []) {
    if (msg.content.trim()) {
      messages.push({ role: msg.role, content: msg.content.trim() });
    }
  }
  if (messages.length === 0 || messages.every((m) => m.role === "system")) {
    throw new Error("No chat messages provided.");
  }
  const body = {
    model,
    messages,
    stream: true,
    think: false,
    options: {
      ...Number.isFinite(params.temperature) ? { temperature: params.temperature } : {},
      ...Number.isFinite(params.maxTokens) && params.maxTokens > 0 ? { num_predict: Math.floor(params.maxTokens) } : {}
    }
  };
  const response2 = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response2.ok) {
    const text = await response2.text().catch(() => "");
    throw new Error(`Ollama request failed (${response2.status}): ${text || response2.statusText}`);
  }
  const win = getMainWindow$2();
  let fullContent = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let insideThink = false;
  let thinkBuffer = "";
  const reader = response2.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line);
        const msgObj = chunk.message;
        const token = typeof (msgObj == null ? void 0 : msgObj.content) === "string" ? msgObj.content : "";
        if (token) {
          for (const char of token) {
            if (!insideThink) {
              thinkBuffer += char;
              if (thinkBuffer === "<think>") {
                insideThink = true;
                thinkBuffer = "";
              } else if (!"<think>".startsWith(thinkBuffer)) {
                fullContent += thinkBuffer;
                win == null ? void 0 : win.webContents.send("llm:local-stream", { requestId, token: thinkBuffer });
                thinkBuffer = "";
              }
            } else {
              thinkBuffer += char;
              if (thinkBuffer.endsWith("</think>")) {
                insideThink = false;
                thinkBuffer = "";
              }
            }
          }
        }
        if (chunk.done) {
          promptTokens = parseFiniteNumber(chunk.prompt_eval_count) ?? 0;
          completionTokens = parseFiniteNumber(chunk.eval_count) ?? 0;
        }
      } catch {
      }
    }
  }
  if (thinkBuffer && !insideThink) {
    fullContent += thinkBuffer;
    win == null ? void 0 : win.webContents.send("llm:local-stream", { requestId, token: thinkBuffer });
  }
  win == null ? void 0 : win.webContents.send("llm:local-stream", { requestId, done: true });
  return {
    message: fullContent.trim(),
    usage: promptTokens > 0 || completionTokens > 0 ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cost: 0 } : void 0
  };
}
async function listOllamaModels() {
  try {
    const response2 = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response2.ok) return [];
    const data = await response2.json();
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}
function registerLLMChatHandlers() {
  ipcMain.handle("llm:chat", async (_event, params) => {
    const key = params.apiKey;
    if (!key) throw new Error("No fal.ai API key provided.");
    const messages = Array.isArray(params.messages) ? params.messages : [];
    const prompt = buildConversationPrompt(messages);
    if (!prompt.trim()) throw new Error("No chat prompt provided.");
    const result = await callTextLLM({
      apiKey: key,
      model: params.model,
      systemPrompt: params.systemPrompt,
      prompt,
      maxTokens: params.maxTokens,
      temperature: params.temperature
    });
    return {
      message: result.message,
      ...result.usage ? { usage: result.usage } : {}
    };
  });
  ipcMain.handle("llm:local-chat", async (_event, params) => {
    const requestId = params.requestId || crypto.randomUUID();
    const result = await streamOllamaChat(requestId, params);
    return {
      message: result.message,
      ...result.usage ? { usage: result.usage } : {}
    };
  });
  ipcMain.handle("llm:local-models", async () => {
    return listOllamaModels();
  });
  ipcMain.handle("llm:run-cut-workflow", async (_event, params) => runCutWorkflow(params));
}
const SYSTEM_PROMPT = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;
function buildUserPrompt(params, hasVideo) {
  const parts = [];
  if (hasVideo) {
    parts.push("I have a video that needs a music soundtrack. I've attached frames from the video for you to analyze.");
    parts.push("Look at the visual content, mood, pacing, and subject matter to inform the music style.");
  }
  const prefs = [];
  if (params.genre) prefs.push(`Genre: ${params.genre}`);
  if (params.style) prefs.push(`Style: ${params.style}`);
  if (params.mood) prefs.push(`Mood: ${params.mood}`);
  if (params.tempo) prefs.push(`Tempo: ${params.tempo}`);
  if (params.additionalNotes) prefs.push(`Notes: ${params.additionalNotes}`);
  if (prefs.length > 0) {
    parts.push("User preferences:\n" + prefs.join("\n"));
  }
  parts.push("Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else.");
  return parts.join("\n\n");
}
function registerMusicPromptHandlers() {
  ipcMain.handle("music:generate-prompt", async (_event, params) => {
    const key = params.apiKey;
    if (!key) throw new Error("No fal.ai API key provided.");
    srcExports.fal.config({ credentials: key });
    const hasFrames = params.frameUrls && params.frameUrls.length > 0;
    const userPrompt = buildUserPrompt(params, !!hasFrames);
    const input = {
      model: "google/gemini-flash-1.5",
      system_prompt: SYSTEM_PROMPT,
      prompt: userPrompt,
      max_tokens: 300
    };
    const endpoint = hasFrames ? "fal-ai/any-llm/vision" : "fal-ai/any-llm";
    if (hasFrames) {
      input.image_urls = params.frameUrls;
    }
    const result = await srcExports.fal.subscribe(endpoint, { input, logs: true });
    const data = result.data;
    const output = data.output ?? "";
    return { prompt: output.trim() };
  });
}
function registerFileSystemHandlers() {
  ipcMain.handle("dialog:show-save", async (_event, options) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: options == null ? void 0 : options.defaultPath,
      filters: options == null ? void 0 : options.filters
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle("dialog:show-open", async (_event, options) => {
    var _a;
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      filters: options == null ? void 0 : options.filters,
      properties: (options == null ? void 0 : options.properties) ?? ["openFile"]
    });
    if (result.canceled) return null;
    if ((_a = options == null ? void 0 : options.properties) == null ? void 0 : _a.includes("multiSelections")) {
      return result.filePaths;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("shell:open-path", async (_event, filePath) => {
    return await shell.openPath(filePath);
  });
}
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolution_width  INTEGER NOT NULL DEFAULT 1920,
  resolution_height INTEGER NOT NULL DEFAULT 1080,
  frame_rate        REAL NOT NULL DEFAULT 24.0
);

CREATE TABLE IF NOT EXISTS media_folders (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES media_folders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('video', 'image', 'audio')),
  file_ref      TEXT,
  original_path TEXT,
  source_url    TEXT,
  thumbnail_url TEXT,
  duration      REAL,
  width         INTEGER,
  height        INTEGER,
  fps           REAL,
  codec         TEXT,
  file_size     INTEGER,
  checksum      TEXT,
  proxy_ref     TEXT,
  status        TEXT NOT NULL DEFAULT 'online' CHECK(status IN ('online', 'offline', 'processing')),
  metadata      TEXT,
  folder_id     TEXT REFERENCES media_folders(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timelines (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  duration   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id          TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('video', 'audio')),
  color       TEXT NOT NULL DEFAULT '#666',
  muted       INTEGER NOT NULL DEFAULT 0,
  solo        INTEGER NOT NULL DEFAULT 0,
  locked      INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  volume      REAL NOT NULL DEFAULT 1.0,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clips (
  id             TEXT PRIMARY KEY,
  timeline_id    TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  track_id       TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  asset_id       TEXT REFERENCES assets(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  start_time     REAL NOT NULL,
  duration       REAL NOT NULL,
  trim_start     REAL NOT NULL DEFAULT 0,
  trim_end       REAL NOT NULL DEFAULT 0,
  speed          REAL NOT NULL DEFAULT 1.0,
  opacity        REAL NOT NULL DEFAULT 1.0,
  volume         REAL NOT NULL DEFAULT 1.0,
  flip_h         INTEGER NOT NULL DEFAULT 0,
  flip_v         INTEGER NOT NULL DEFAULT 0,
  linked_clip_id TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keyframes (
  id       TEXT PRIMARY KEY,
  clip_id  TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  time     REAL NOT NULL,
  property TEXT NOT NULL CHECK(property IN ('opacity', 'volume')),
  value    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS transitions (
  id          TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('dissolve', 'fadeToBlack', 'fadeFromBlack')),
  duration    REAL NOT NULL,
  clip_a_id   TEXT,
  clip_b_id   TEXT
);

CREATE TABLE IF NOT EXISTS workflow_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  nodes      TEXT NOT NULL DEFAULT '[]',
  edges      TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS elements (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('character', 'location', 'prop', 'vehicle')),
  description TEXT,
  images      TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cache_metadata (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK(type IN ('thumbnail', 'waveform', 'filmstrip', 'proxy')),
  file_ref   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'rendering', 'complete', 'failed')),
  progress     REAL NOT NULL DEFAULT 0,
  preset       TEXT,
  fps          REAL,
  output_path  TEXT,
  file_size    INTEGER,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
`;
const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_assets_project     ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_folder      ON assets(folder_id);
CREATE INDEX IF NOT EXISTS idx_timelines_project  ON timelines(project_id);
CREATE INDEX IF NOT EXISTS idx_tracks_timeline    ON tracks(timeline_id);
CREATE INDEX IF NOT EXISTS idx_clips_timeline     ON clips(timeline_id);
CREATE INDEX IF NOT EXISTS idx_clips_track        ON clips(track_id);
CREATE INDEX IF NOT EXISTS idx_clips_asset        ON clips(asset_id);
CREATE INDEX IF NOT EXISTS idx_keyframes_clip     ON keyframes(clip_id);
CREATE INDEX IF NOT EXISTS idx_transitions_timeline ON transitions(timeline_id);
CREATE INDEX IF NOT EXISTS idx_elements_project   ON elements(project_id);
CREATE INDEX IF NOT EXISTS idx_cache_asset        ON cache_metadata(asset_id);
CREATE INDEX IF NOT EXISTS idx_export_project     ON export_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_folders_project    ON media_folders(project_id);
`;
function projectsRoot() {
  return path.join(os.homedir(), "Documents", "CINEGEN");
}
function projectDir(id) {
  return path.join(projectsRoot(), id);
}
function generateId() {
  return crypto$1.randomUUID();
}
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function ensureProjectDirs(id) {
  const root = projectDir(id);
  const dirs = [
    path.join(root, "media", "generated"),
    path.join(root, "media", "imported"),
    path.join(root, ".cache", "thumbnails"),
    path.join(root, ".cache", "filmstrips"),
    path.join(root, ".cache", "waveforms"),
    path.join(root, ".cache", "proxies")
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
class ProjectDatabase {
  constructor(projectId) {
    ensureProjectDirs(projectId);
    const dbPath = path.join(projectDir(projectId), "project.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }
  /**
   * Runs SCHEMA_SQL and INDEXES_SQL to create all tables and indexes if they
   * do not already exist.
   */
  initSchema() {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(INDEXES_SQL);
  }
  /**
   * Executes a SELECT query and returns all matching rows typed as T.
   */
  query(sql, params) {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params ?? []);
  }
  /**
   * Executes a SELECT query and returns the first matching row typed as T,
   * or undefined if no rows match.
   */
  queryOne(sql, params) {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params ?? []);
  }
  /**
   * Executes an INSERT / UPDATE / DELETE statement and returns the RunResult.
   */
  run(sql, params) {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params ?? []);
  }
  /**
   * Wraps the provided function in a SQLite transaction. The transaction is
   * committed on success and rolled back on exception.
   */
  transaction(fn) {
    return this.db.transaction(fn)();
  }
  /**
   * Closes the underlying database connection.
   */
  close() {
    this.db.close();
  }
}
const VALID_COLUMNS = {
  projects: /* @__PURE__ */ new Set(["name", "created_at", "updated_at", "resolution_width", "resolution_height", "frame_rate"]),
  assets: /* @__PURE__ */ new Set(["project_id", "name", "type", "file_ref", "original_path", "source_url", "thumbnail_url", "duration", "width", "height", "fps", "codec", "file_size", "checksum", "proxy_ref", "status", "metadata", "folder_id", "created_at"]),
  media_folders: /* @__PURE__ */ new Set(["project_id", "name", "parent_id", "created_at"]),
  timelines: /* @__PURE__ */ new Set(["project_id", "name", "duration", "created_at"]),
  tracks: /* @__PURE__ */ new Set(["timeline_id", "name", "kind", "color", "muted", "solo", "locked", "visible", "volume", "sort_order"]),
  clips: /* @__PURE__ */ new Set(["timeline_id", "track_id", "asset_id", "name", "start_time", "duration", "trim_start", "trim_end", "speed", "opacity", "volume", "flip_h", "flip_v", "linked_clip_id", "created_at"]),
  keyframes: /* @__PURE__ */ new Set(["clip_id", "time", "property", "value"]),
  transitions: /* @__PURE__ */ new Set(["timeline_id", "type", "duration", "clip_a_id", "clip_b_id"]),
  elements: /* @__PURE__ */ new Set(["project_id", "name", "type", "description", "images", "created_at", "updated_at"]),
  export_jobs: /* @__PURE__ */ new Set(["project_id", "status", "progress", "preset", "fps", "output_path", "file_size", "error", "created_at", "completed_at"])
};
function buildSetClause(partial, table) {
  const allowedCols = VALID_COLUMNS[table];
  const entries = Object.entries(partial).filter(
    ([k]) => k !== "id" && (!allowedCols || allowedCols.has(k))
  );
  if (entries.length === 0) throw new Error("No valid fields to update");
  const setClauses = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  return { setClauses, values };
}
function insertProject(db, row) {
  return db.run(
    `INSERT INTO projects (id, name, created_at, updated_at, resolution_width, resolution_height, frame_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      row.created_at,
      row.updated_at,
      row.resolution_width,
      row.resolution_height,
      row.frame_rate
    ]
  );
}
function getProject(db, id) {
  return db.queryOne("SELECT * FROM projects WHERE id = ?", [id]);
}
function updateProject(db, id, partial) {
  const { setClauses, values } = buildSetClause(partial, "projects");
  return db.run(`UPDATE projects SET ${setClauses} WHERE id = ?`, [...values, id]);
}
function getAssets(db, projectId) {
  return db.query("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at", [
    projectId
  ]);
}
function insertAsset(db, row) {
  return db.run(
    `INSERT INTO assets
       (id, project_id, name, type, file_ref, original_path, source_url, thumbnail_url,
        duration, width, height, fps, codec, file_size, checksum, proxy_ref,
        status, metadata, folder_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.project_id,
      row.name,
      row.type,
      row.file_ref,
      row.original_path,
      row.source_url,
      row.thumbnail_url,
      row.duration,
      row.width,
      row.height,
      row.fps,
      row.codec,
      row.file_size,
      row.checksum,
      row.proxy_ref,
      row.status,
      row.metadata,
      row.folder_id,
      row.created_at
    ]
  );
}
function updateAsset(db, id, partial) {
  const { setClauses, values } = buildSetClause(partial, "assets");
  return db.run(`UPDATE assets SET ${setClauses} WHERE id = ?`, [...values, id]);
}
function deleteAsset(db, id) {
  return db.run("DELETE FROM assets WHERE id = ?", [id]);
}
function getFolders(db, projectId) {
  return db.query(
    "SELECT * FROM media_folders WHERE project_id = ? ORDER BY created_at",
    [projectId]
  );
}
function insertFolder(db, row) {
  return db.run(
    `INSERT INTO media_folders (id, project_id, name, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [row.id, row.project_id, row.name, row.parent_id, row.created_at]
  );
}
function updateFolder(db, id, partial) {
  const { setClauses, values } = buildSetClause(partial, "media_folders");
  return db.run(`UPDATE media_folders SET ${setClauses} WHERE id = ?`, [...values, id]);
}
function getTimelines(db, projectId) {
  return db.query(
    "SELECT * FROM timelines WHERE project_id = ? ORDER BY created_at",
    [projectId]
  );
}
function insertTimeline(db, row) {
  return db.run(
    `INSERT INTO timelines (id, project_id, name, duration, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [row.id, row.project_id, row.name, row.duration, row.created_at]
  );
}
function updateTimeline(db, id, partial) {
  const { setClauses, values } = buildSetClause(partial, "timelines");
  return db.run(`UPDATE timelines SET ${setClauses} WHERE id = ?`, [...values, id]);
}
function deleteTimeline(db, id) {
  db.transaction(() => {
    db.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE timeline_id = ?)",
      [id]
    );
    db.run("DELETE FROM clips WHERE timeline_id = ?", [id]);
    db.run("DELETE FROM tracks WHERE timeline_id = ?", [id]);
    db.run("DELETE FROM transitions WHERE timeline_id = ?", [id]);
    db.run("DELETE FROM timelines WHERE id = ?", [id]);
  });
}
function getTracks(db, timelineId) {
  return db.query(
    "SELECT * FROM tracks WHERE timeline_id = ? ORDER BY sort_order",
    [timelineId]
  );
}
function upsertTrack(db, row) {
  return db.run(
    `INSERT INTO tracks
       (id, timeline_id, name, kind, color, muted, solo, locked, visible, volume, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timeline_id = excluded.timeline_id,
       name        = excluded.name,
       kind        = excluded.kind,
       color       = excluded.color,
       muted       = excluded.muted,
       solo        = excluded.solo,
       locked      = excluded.locked,
       visible     = excluded.visible,
       volume      = excluded.volume,
       sort_order  = excluded.sort_order`,
    [
      row.id,
      row.timeline_id,
      row.name,
      row.kind,
      row.color,
      row.muted,
      row.solo,
      row.locked,
      row.visible,
      row.volume,
      row.sort_order
    ]
  );
}
function deleteTrack(db, id) {
  db.transaction(() => {
    db.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE track_id = ?)",
      [id]
    );
    db.run("DELETE FROM clips WHERE track_id = ?", [id]);
    db.run("DELETE FROM tracks WHERE id = ?", [id]);
  });
}
function getClips(db, timelineId) {
  return db.query(
    "SELECT * FROM clips WHERE timeline_id = ? ORDER BY start_time",
    [timelineId]
  );
}
function upsertClip(db, row) {
  return db.run(
    `INSERT INTO clips
       (id, timeline_id, track_id, asset_id, name, start_time, duration,
        trim_start, trim_end, speed, opacity, volume, flip_h, flip_v,
        linked_clip_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timeline_id    = excluded.timeline_id,
       track_id       = excluded.track_id,
       asset_id       = excluded.asset_id,
       name           = excluded.name,
       start_time     = excluded.start_time,
       duration       = excluded.duration,
       trim_start     = excluded.trim_start,
       trim_end       = excluded.trim_end,
       speed          = excluded.speed,
       opacity        = excluded.opacity,
       volume         = excluded.volume,
       flip_h         = excluded.flip_h,
       flip_v         = excluded.flip_v,
       linked_clip_id = excluded.linked_clip_id`,
    [
      row.id,
      row.timeline_id,
      row.track_id,
      row.asset_id,
      row.name,
      row.start_time,
      row.duration,
      row.trim_start,
      row.trim_end,
      row.speed,
      row.opacity,
      row.volume,
      row.flip_h,
      row.flip_v,
      row.linked_clip_id,
      row.created_at
    ]
  );
}
function deleteClip(db, id) {
  db.transaction(() => {
    db.run("DELETE FROM keyframes WHERE clip_id = ?", [id]);
    db.run("DELETE FROM clips WHERE id = ?", [id]);
  });
}
function getKeyframes(db, clipId) {
  return db.query(
    "SELECT * FROM keyframes WHERE clip_id = ? ORDER BY time",
    [clipId]
  );
}
function setKeyframes(db, clipId, keyframes) {
  db.transaction(() => {
    db.run("DELETE FROM keyframes WHERE clip_id = ?", [clipId]);
    for (const kf of keyframes) {
      db.run(
        "INSERT INTO keyframes (id, clip_id, time, property, value) VALUES (?, ?, ?, ?, ?)",
        [generateId(), kf.clip_id, kf.time, kf.property, kf.value]
      );
    }
  });
}
function getTransitions(db, timelineId) {
  return db.query(
    "SELECT * FROM transitions WHERE timeline_id = ?",
    [timelineId]
  );
}
function upsertTransition(db, row) {
  return db.run(
    `INSERT INTO transitions (id, timeline_id, type, duration, clip_a_id, clip_b_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timeline_id = excluded.timeline_id,
       type        = excluded.type,
       duration    = excluded.duration,
       clip_a_id   = excluded.clip_a_id,
       clip_b_id   = excluded.clip_b_id`,
    [row.id, row.timeline_id, row.type, row.duration, row.clip_a_id, row.clip_b_id]
  );
}
function deleteTransition(db, id) {
  return db.run("DELETE FROM transitions WHERE id = ?", [id]);
}
function getWorkflowState(db, projectId) {
  const row = db.queryOne(
    "SELECT nodes, edges FROM workflow_state WHERE project_id = ?",
    [projectId]
  );
  if (!row) return { nodes: [], edges: [] };
  const nodes = JSON.parse(row.nodes);
  const edges = JSON.parse(row.edges);
  if (edges && typeof edges === "object" && !Array.isArray(edges)) {
    const record = edges;
    return {
      nodes: Array.isArray(nodes) ? nodes : [],
      edges: Array.isArray(record.edges) ? record.edges : [],
      spaces: Array.isArray(record.spaces) ? record.spaces : void 0,
      activeSpaceId: typeof record.activeSpaceId === "string" ? record.activeSpaceId : void 0,
      openSpaceIds: Array.isArray(record.openSpaceIds) ? record.openSpaceIds.filter((value) => typeof value === "string") : void 0
    };
  }
  return {
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: Array.isArray(edges) ? edges : []
  };
}
function saveWorkflowState(db, projectId, workflow) {
  return db.run(
    `INSERT INTO workflow_state (project_id, nodes, edges)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       nodes = excluded.nodes,
       edges = excluded.edges`,
    [
      projectId,
      JSON.stringify(workflow.nodes),
      JSON.stringify({
        edges: workflow.edges,
        spaces: workflow.spaces ?? [],
        activeSpaceId: workflow.activeSpaceId ?? null,
        openSpaceIds: workflow.openSpaceIds ?? []
      })
    ]
  );
}
function getElements(db, projectId) {
  return db.query(
    "SELECT * FROM elements WHERE project_id = ? ORDER BY created_at",
    [projectId]
  );
}
function insertElement(db, row) {
  return db.run(
    `INSERT INTO elements (id, project_id, name, type, description, images, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.project_id,
      row.name,
      row.type,
      row.description,
      row.images,
      row.created_at,
      row.updated_at
    ]
  );
}
function updateElement(db, id, partial) {
  const { setClauses, values } = buildSetClause(partial, "elements");
  return db.run(`UPDATE elements SET ${setClauses} WHERE id = ?`, [...values, id]);
}
function deleteElement(db, id) {
  return db.run("DELETE FROM elements WHERE id = ?", [id]);
}
function getExports(db, projectId) {
  return db.query(
    "SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC",
    [projectId]
  );
}
function insertExport(db, row) {
  return db.run(
    `INSERT INTO export_jobs
       (id, project_id, status, progress, preset, fps, output_path, file_size,
        error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.project_id,
      row.status,
      row.progress,
      row.preset,
      row.fps,
      row.output_path,
      row.file_size,
      row.error,
      row.created_at,
      row.completed_at
    ]
  );
}
function updateExport(db, id, partial) {
  const { setClauses, values } = buildSetClause(partial, "export_jobs");
  return db.run(`UPDATE export_jobs SET ${setClauses} WHERE id = ?`, [...values, id]);
}
function loadFullProject(db, projectId) {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const assets = getAssets(db, projectId);
  const mediaFolders = getFolders(db, projectId);
  const workflow = getWorkflowState(db, projectId);
  const elements = getElements(db, projectId);
  const exports$1 = getExports(db, projectId);
  const timelineRows = getTimelines(db, projectId);
  const timelines = timelineRows.map((tl) => {
    const tracks = getTracks(db, tl.id);
    const clipRows = getClips(db, tl.id);
    const transitions = getTransitions(db, tl.id);
    const clips = clipRows.map((clip) => ({
      ...clip,
      keyframes: getKeyframes(db, clip.id)
    }));
    return { ...tl, tracks, clips, transitions };
  });
  const activeTimelineId = timelines.length > 0 ? timelines[0].id : "";
  return {
    project,
    assets,
    mediaFolders,
    timelines,
    activeTimelineId,
    workflow,
    elements,
    exports: exports$1
  };
}
function saveFullProject(db, projectId, state) {
  db.transaction(() => {
    const existingProject = getProject(db, projectId);
    if (existingProject) {
      updateProject(db, projectId, {
        name: state.project.name,
        updated_at: timestamp(),
        resolution_width: state.project.resolution_width,
        resolution_height: state.project.resolution_height,
        frame_rate: state.project.frame_rate
      });
    } else {
      insertProject(db, { ...state.project, updated_at: timestamp() });
    }
    const existingFolderIds = new Set(
      db.query("SELECT id FROM media_folders WHERE project_id = ?", [projectId]).map((r) => r.id)
    );
    const incomingFolderIds = new Set(state.mediaFolders.map((f) => f.id));
    for (const id of existingFolderIds) {
      if (!incomingFolderIds.has(id)) {
        db.run("UPDATE assets SET folder_id = NULL WHERE folder_id = ?", [id]);
        db.run("DELETE FROM media_folders WHERE id = ?", [id]);
      }
    }
    for (const folder of state.mediaFolders) {
      if (existingFolderIds.has(folder.id)) {
        updateFolder(db, folder.id, {
          name: folder.name,
          parent_id: folder.parent_id
        });
      } else {
        insertFolder(db, folder);
      }
    }
    const existingAssetIds = new Set(
      db.query("SELECT id FROM assets WHERE project_id = ?", [projectId]).map((r) => r.id)
    );
    const incomingAssetIds = new Set(state.assets.map((a) => a.id));
    for (const id of existingAssetIds) {
      if (!incomingAssetIds.has(id)) deleteAsset(db, id);
    }
    for (const asset of state.assets) {
      if (existingAssetIds.has(asset.id)) {
        const { id: _id, project_id: _pid, created_at: _ca, ...rest } = asset;
        updateAsset(db, asset.id, rest);
      } else {
        insertAsset(db, asset);
      }
    }
    const existingTimelineIds = new Set(
      db.query("SELECT id FROM timelines WHERE project_id = ?", [projectId]).map((r) => r.id)
    );
    const incomingTimelineIds = new Set(state.timelines.map((tl) => tl.id));
    for (const id of existingTimelineIds) {
      if (!incomingTimelineIds.has(id)) deleteTimeline(db, id);
    }
    for (const tl of state.timelines) {
      if (existingTimelineIds.has(tl.id)) {
        updateTimeline(db, tl.id, { name: tl.name, duration: tl.duration });
      } else {
        const { tracks: _t, clips: _c, transitions: _tr, ...tlRow } = tl;
        insertTimeline(db, tlRow);
      }
      const existingTrackIds = new Set(
        db.query("SELECT id FROM tracks WHERE timeline_id = ?", [tl.id]).map((r) => r.id)
      );
      const incomingTrackIds = new Set(tl.tracks.map((t) => t.id));
      for (const id of existingTrackIds) {
        if (!incomingTrackIds.has(id)) deleteTrack(db, id);
      }
      for (const track of tl.tracks) {
        upsertTrack(db, track);
      }
      const existingClipIds = new Set(
        db.query("SELECT id FROM clips WHERE timeline_id = ?", [tl.id]).map((r) => r.id)
      );
      const incomingClipIds = new Set(tl.clips.map((c) => c.id));
      for (const id of existingClipIds) {
        if (!incomingClipIds.has(id)) deleteClip(db, id);
      }
      for (const clip of tl.clips) {
        const { keyframes, ...clipRow } = clip;
        upsertClip(db, clipRow);
        setKeyframes(
          db,
          clip.id,
          keyframes.map(({ id: _id, ...kf }) => kf)
        );
      }
      const existingTransitionIds = new Set(
        db.query("SELECT id FROM transitions WHERE timeline_id = ?", [tl.id]).map((r) => r.id)
      );
      const incomingTransitionIds = new Set(tl.transitions.map((tr) => tr.id));
      for (const id of existingTransitionIds) {
        if (!incomingTransitionIds.has(id)) deleteTransition(db, id);
      }
      for (const transition of tl.transitions) {
        upsertTransition(db, transition);
      }
    }
    saveWorkflowState(db, projectId, state.workflow);
    const existingElementIds = new Set(
      db.query("SELECT id FROM elements WHERE project_id = ?", [projectId]).map((r) => r.id)
    );
    const incomingElementIds = new Set(state.elements.map((e) => e.id));
    for (const id of existingElementIds) {
      if (!incomingElementIds.has(id)) deleteElement(db, id);
    }
    for (const el of state.elements) {
      if (existingElementIds.has(el.id)) {
        const { id: _id, project_id: _pid, created_at: _ca, ...rest } = el;
        updateElement(db, el.id, { ...rest, updated_at: timestamp() });
      } else {
        insertElement(db, el);
      }
    }
    const existingExportIds = new Set(
      db.query("SELECT id FROM export_jobs WHERE project_id = ?", [projectId]).map((r) => r.id)
    );
    for (const job of state.exports) {
      if (existingExportIds.has(job.id)) {
        const { id: _id, project_id: _pid, created_at: _ca, ...rest } = job;
        updateExport(db, job.id, rest);
      } else {
        insertExport(db, job);
      }
    }
  });
}
const dbCache = /* @__PURE__ */ new Map();
function getDb(projectId) {
  let db = dbCache.get(projectId);
  if (!db) {
    db = new ProjectDatabase(projectId);
    dbCache.set(projectId, db);
  }
  return db;
}
function indexPath() {
  return path.join(projectsRoot(), "projects.json");
}
async function readIndex() {
  try {
    const raw = await fs$1.readFile(indexPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}
async function writeIndex(index) {
  await fs$1.mkdir(projectsRoot(), { recursive: true });
  await fs$1.writeFile(indexPath(), JSON.stringify(index, null, 2), "utf-8");
}
async function upsertIndexEntry(meta) {
  const index = await readIndex();
  const existing = index.projects.findIndex((p) => p.id === meta.id);
  if (existing >= 0) {
    index.projects[existing] = meta;
  } else {
    index.projects.push(meta);
  }
  await writeIndex(index);
}
async function removeIndexEntry(id) {
  const index = await readIndex();
  index.projects = index.projects.filter((p) => p.id !== id);
  await writeIndex(index);
}
function registerDbHandlers() {
  ipcMain.handle("db:project:create", async (_event, name2) => {
    const id = generateId();
    const now = timestamp();
    ensureProjectDirs(id);
    const db = getDb(id);
    const projectRow = {
      id,
      name: name2,
      created_at: now,
      updated_at: now,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24
    };
    insertProject(db, projectRow);
    const timelineId = generateId();
    insertTimeline(db, {
      id: timelineId,
      project_id: id,
      name: "Timeline 1",
      duration: 0,
      created_at: now
    });
    upsertTrack(db, {
      id: generateId(),
      timeline_id: timelineId,
      name: "Video 1",
      kind: "video",
      color: "#4A90D9",
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 0
    });
    upsertTrack(db, {
      id: generateId(),
      timeline_id: timelineId,
      name: "Audio 1",
      kind: "audio",
      color: "#7ED321",
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 1
    });
    await upsertIndexEntry({
      id,
      name: name2,
      createdAt: now,
      updatedAt: now,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
      useSqlite: true
    });
    return loadFullProject(db, id);
  });
  ipcMain.handle("db:project:load", async (_event, id) => {
    const db = getDb(id);
    const state = loadFullProject(db, id);
    for (const asset of state.assets) {
      if (asset.file_ref && !asset.source_url) {
        const prevStatus = asset.status;
        if (fs.existsSync(asset.file_ref)) {
          if (asset.status === "offline") {
            asset.status = "online";
          }
        } else {
          asset.status = "offline";
        }
        if (asset.status !== prevStatus) {
          updateAsset(db, asset.id, { status: asset.status });
        }
      }
    }
    return state;
  });
  ipcMain.handle("db:project:save", async (_event, id, state) => {
    const db = getDb(id);
    saveFullProject(db, id, state);
    const now = timestamp();
    const index = await readIndex();
    const entry = index.projects.find((p) => p.id === id);
    if (entry) {
      entry.name = state.project.name;
      entry.updatedAt = now;
      entry.assetCount = state.assets.length;
      entry.elementCount = state.elements.length;
      await writeIndex(index);
    }
    return { ok: true };
  });
  ipcMain.handle("db:project:delete", async (_event, id) => {
    const db = dbCache.get(id);
    if (db) {
      db.close();
      dbCache.delete(id);
    }
    const dir = projectDir(id);
    try {
      await fs$1.rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[db:project:delete] Failed to remove directory ${dir}:`, err);
    }
    await removeIndexEntry(id);
    return { ok: true };
  });
  ipcMain.handle("db:project:close", async (_event, id) => {
    const db = dbCache.get(id);
    if (db) {
      db.close();
      dbCache.delete(id);
    }
    return { ok: true };
  });
  ipcMain.handle(
    "db:project:update",
    async (_event, id, data) => {
      const db = getDb(id);
      updateProject(db, id, data);
      return { ok: true };
    }
  );
  ipcMain.handle("db:asset:insert", async (_event, asset) => {
    const db = getDb(asset.project_id);
    insertAsset(db, asset);
    return { ok: true };
  });
  ipcMain.handle(
    "db:asset:update",
    async (_event, projectId, id, data) => {
      const db = getDb(projectId);
      updateAsset(db, id, data);
      return { ok: true };
    }
  );
  ipcMain.handle("db:asset:delete", async (_event, projectId, id) => {
    const db = getDb(projectId);
    deleteAsset(db, id);
    return { ok: true };
  });
}
function closeAllDbs() {
  for (const [id, db] of dbCache) {
    try {
      db.close();
    } catch (err) {
      console.error(`[closeAllDbs] Failed to close DB for project ${id}:`, err);
    }
  }
  dbCache.clear();
}
let worker = null;
const pendingJobs = /* @__PURE__ */ new Map();
const jobMeta = /* @__PURE__ */ new Map();
const moduleDir$1 = path.dirname(fileURLToPath(import.meta.url));
function getWorkerPath() {
  let workerPath = path.join(moduleDir$1, "workers", "media-worker.js");
  if (workerPath.includes("app.asar")) {
    workerPath = workerPath.replace("app.asar", "app.asar.unpacked");
  }
  return workerPath;
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(getWorkerPath());
  worker.on("message", (msg) => {
    switch (msg.type) {
      case "ready":
        console.log("[media-worker] Worker ready");
        break;
      case "job:progress":
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send("media:job-progress", { jobId: msg.jobId, progress: msg.progress });
        }
        break;
      case "job:complete": {
        const meta = jobMeta.get(msg.jobId);
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send("media:job-complete", {
            jobId: msg.jobId,
            result: msg.result,
            assetId: meta == null ? void 0 : meta.assetId,
            jobType: meta == null ? void 0 : meta.jobType
          });
        }
        jobMeta.delete(msg.jobId);
        const pending = pendingJobs.get(msg.jobId);
        if (pending) {
          pending.resolve(msg.result);
          pendingJobs.delete(msg.jobId);
        }
        break;
      }
      case "job:error": {
        const errMeta = jobMeta.get(msg.jobId);
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send("media:job-error", {
            jobId: msg.jobId,
            error: msg.error,
            assetId: errMeta == null ? void 0 : errMeta.assetId,
            jobType: errMeta == null ? void 0 : errMeta.jobType
          });
        }
        jobMeta.delete(msg.jobId);
        const errorPending = pendingJobs.get(msg.jobId);
        if (errorPending) {
          errorPending.reject(new Error(msg.error));
          pendingJobs.delete(msg.jobId);
        }
        break;
      }
      case "sync:batch-progress":
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send("sync:batch-progress", {
            jobId: msg.jobId,
            completedPairs: msg.completedPairs,
            totalPairs: msg.totalPairs,
            currentVideoName: msg.currentVideoName,
            currentAudioName: msg.currentAudioName
          });
        }
        break;
    }
  });
  worker.on("error", (err) => {
    console.error("[media-worker] Worker error:", err);
  });
  worker.on("exit", (code) => {
    console.log(`[media-worker] Worker exited with code ${code}`);
    worker = null;
    for (const [id, pending] of pendingJobs) {
      pending.reject(new Error("Worker exited"));
      pendingJobs.delete(id);
    }
  });
  worker.postMessage({
    type: "config",
    ffmpegPath: getFfmpegPath(),
    ffprobePath: getFfprobePath(),
    fpcalcPath: getFpcalcPath()
  });
  return worker;
}
function submitJob(job) {
  if (job.type === "sync_compute_offset" || job.type === "sync_batch_match") {
    return submitDedicatedSyncJob(job);
  }
  return new Promise((resolve, reject) => {
    pendingJobs.set(job.id, { resolve, reject });
    jobMeta.set(job.id, { assetId: job.assetId, jobType: job.type });
    const w = ensureWorker();
    w.postMessage({ type: "job:submit", job });
  });
}
function submitDedicatedSyncJob(job) {
  return new Promise((resolve, reject) => {
    const syncWorker = new Worker(getWorkerPath());
    let settled = false;
    const cleanup = () => {
      syncWorker.removeAllListeners();
      void syncWorker.terminate().catch(() => {
      });
    };
    const settleResolve = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    syncWorker.on("message", (msg) => {
      switch (msg.type) {
        case "ready":
          syncWorker.postMessage({ type: "job:submit", job });
          break;
        case "job:complete":
          if (msg.jobId === job.id) {
            settleResolve(msg.result);
          }
          break;
        case "job:error":
          if (msg.jobId === job.id) {
            settleReject(new Error(msg.error));
          }
          break;
        case "sync:batch-progress":
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("sync:batch-progress", {
              jobId: msg.jobId,
              completedPairs: msg.completedPairs,
              totalPairs: msg.totalPairs,
              currentVideoName: msg.currentVideoName,
              currentAudioName: msg.currentAudioName
            });
          }
          break;
      }
    });
    syncWorker.on("error", (err) => {
      settleReject(err instanceof Error ? err : new Error(String(err)));
    });
    syncWorker.on("exit", (code) => {
      if (!settled && code !== 0) {
        settleReject(new Error(`Sync worker exited with code ${code}`));
      }
    });
    syncWorker.postMessage({
      type: "config",
      ffmpegPath: getFfmpegPath(),
      ffprobePath: getFfprobePath(),
      fpcalcPath: getFpcalcPath()
    });
  });
}
function detectAssetType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const VIDEO_EXTS = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]);
  const AUDIO_EXTS = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "image";
}
function registerMediaImportHandlers() {
  ipcMain.handle("media:import", async (_event, params) => {
    const { filePaths, projectId, mode } = params;
    const projDir = projectDir(projectId);
    const results = [];
    const metadataPipelines = [];
    for (const filePath of filePaths) {
      const assetId = crypto$1.randomUUID();
      let inputPath = filePath;
      if (mode === "copy") {
        const mediaDir = path.join(projDir, "media", "imported");
        await fs$1.mkdir(mediaDir, { recursive: true });
        const destName = `${assetId}${path.extname(filePath)}`;
        const destPath = path.join(mediaDir, destName);
        await fs$1.copyFile(filePath, destPath);
        inputPath = destPath;
      }
      const type = detectAssetType(filePath);
      const metadataJobId = crypto$1.randomUUID();
      metadataPipelines.push({
        assetId,
        metadataJobId,
        inputPath,
        type,
        projectDir: projDir
      });
      results.push({ assetId, jobId: metadataJobId, filePath: inputPath, type });
    }
    setTimeout(() => {
      for (const pipeline of metadataPipelines) {
        const metadataJob = {
          id: pipeline.metadataJobId,
          type: "extract_metadata",
          assetId: pipeline.assetId,
          inputPath: pipeline.inputPath,
          outputPath: "",
          // Not needed for metadata
          projectDir: pipeline.projectDir
        };
        const cacheDir = path.join(pipeline.projectDir, ".cache");
        if (pipeline.type !== "audio") {
          const thumbsDir = path.join(cacheDir, "thumbnails");
          fs.mkdirSync(thumbsDir, { recursive: true });
          submitJob({
            id: crypto$1.randomUUID(),
            type: "generate_thumbnail",
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(thumbsDir, `${pipeline.assetId}.jpg`),
            projectDir: pipeline.projectDir
          }).catch((err) => console.error("[media-import] Thumbnail failed:", err));
        }
        submitJob(metadataJob).catch((err) => console.error("[media-import] Metadata extraction failed:", err));
      }
      for (const pipeline of metadataPipelines) {
        const cacheDir = path.join(pipeline.projectDir, ".cache");
        if (pipeline.type === "audio" || pipeline.type === "video") {
          const waveformDir = path.join(cacheDir, "waveforms");
          fs.mkdirSync(waveformDir, { recursive: true });
          submitJob({
            id: crypto$1.randomUUID(),
            type: "compute_waveform",
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(waveformDir, `${pipeline.assetId}.json`),
            projectDir: pipeline.projectDir
          }).catch((err) => console.error("[media-import] Waveform failed:", err));
        }
      }
      for (const pipeline of metadataPipelines) {
        const cacheDir = path.join(pipeline.projectDir, ".cache");
        if (pipeline.type === "video") {
          const filmstripDir = path.join(cacheDir, "filmstrips");
          fs.mkdirSync(filmstripDir, { recursive: true });
          submitJob({
            id: crypto$1.randomUUID(),
            type: "generate_filmstrip",
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(filmstripDir, `${pipeline.assetId}.jpg`),
            projectDir: pipeline.projectDir
          }).catch((err) => console.error("[media-import] Filmstrip failed:", err));
        }
      }
      for (const pipeline of metadataPipelines) {
        const cacheDir = path.join(pipeline.projectDir, ".cache");
        if (pipeline.type === "video") {
          const proxyDir = path.join(cacheDir, "proxies");
          fs.mkdirSync(proxyDir, { recursive: true });
          submitJob({
            id: crypto$1.randomUUID(),
            type: "generate_proxy",
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(proxyDir, `${pipeline.assetId}.mp4`),
            projectDir: pipeline.projectDir
          }).catch((err) => console.error("[media-import] Proxy failed:", err));
        }
      }
    }, 0);
    return results;
  });
  ipcMain.handle("media:submit-job", async (_event, job) => {
    return submitJob(job);
  });
  ipcMain.handle("media:cancel-job", async (_event, jobId) => {
    const w = worker;
    if (w) {
      w.postMessage({ type: "job:cancel", jobId });
    }
    pendingJobs.delete(jobId);
    return { ok: true };
  });
  ipcMain.handle("media:extract-frame", async (_event, params) => {
    const { inputPath, timeSec } = params;
    const ffmpegPath = getFfmpegPath();
    const outputPath = path.join(os.tmpdir(), `cinegen-frame-${crypto$1.randomUUID()}.jpg`);
    return new Promise((resolve) => {
      const args = [
        "-y",
        "-ss",
        `${Math.max(0, timeSec)}`,
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outputPath
      ];
      execFile(ffmpegPath, args, { timeout: 15e3 }, (err, _stdout, _stderr) => {
        if (err || !fs.existsSync(outputPath)) {
          resolve(null);
          return;
        }
        resolve({ outputPath });
      });
    });
  });
  ipcMain.handle("media:extract-clip", async (_event, params) => {
    const { inputPath, startTimeSec, durationSec } = params;
    const ffmpegPath = getFfmpegPath();
    const outputPath = path.join(os.tmpdir(), `cinegen-clip-${crypto$1.randomUUID()}.mp4`);
    const safeStart = Math.max(0, startTimeSec);
    const safeDuration = Math.max(0.1, durationSec);
    return new Promise((resolve) => {
      const args = [
        "-y",
        "-ss",
        `${safeStart}`,
        "-i",
        inputPath,
        "-t",
        `${safeDuration}`,
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath
      ];
      execFile(ffmpegPath, args, { timeout: Math.max(12e4, Math.ceil(safeDuration * 4e3)) }, (err, _stdout, _stderr) => {
        if (err || !fs.existsSync(outputPath)) {
          resolve(null);
          return;
        }
        resolve({ outputPath });
      });
    });
  });
  ipcMain.handle("media:queue-processing", async (_event, params) => {
    const {
      assetId,
      projectId,
      inputPath,
      needsProxy,
      includeThumbnail = false,
      includeWaveform = true,
      includeFilmstrip = true
    } = params;
    const projDir = projectDir(projectId);
    const cacheDir = path.join(projDir, ".cache");
    if (includeThumbnail) {
      const thumbsDir = path.join(cacheDir, "thumbnails");
      fs.mkdirSync(thumbsDir, { recursive: true });
      const thumbJob = {
        id: crypto$1.randomUUID(),
        type: "generate_thumbnail",
        assetId,
        inputPath,
        outputPath: path.join(thumbsDir, `${assetId}.jpg`),
        projectDir: projDir
      };
      submitJob(thumbJob).catch((err) => console.error("[media-import] Thumbnail failed:", err));
    }
    if (includeWaveform) {
      const waveformDir = path.join(cacheDir, "waveforms");
      fs.mkdirSync(waveformDir, { recursive: true });
      const waveformJob = {
        id: crypto$1.randomUUID(),
        type: "compute_waveform",
        assetId,
        inputPath,
        outputPath: path.join(waveformDir, `${assetId}.json`),
        projectDir: projDir
      };
      submitJob(waveformJob).catch((err) => console.error("[media-import] Waveform failed:", err));
    }
    if (includeFilmstrip) {
      const filmstripDir = path.join(cacheDir, "filmstrips");
      fs.mkdirSync(filmstripDir, { recursive: true });
      const filmstripJob = {
        id: crypto$1.randomUUID(),
        type: "generate_filmstrip",
        assetId,
        inputPath,
        outputPath: path.join(filmstripDir, `${assetId}.jpg`),
        projectDir: projDir
      };
      submitJob(filmstripJob).catch((err) => console.error("[media-import] Filmstrip failed:", err));
    }
    if (needsProxy) {
      const proxyDir = path.join(cacheDir, "proxies");
      fs.mkdirSync(proxyDir, { recursive: true });
      const proxyJob = {
        id: crypto$1.randomUUID(),
        type: "generate_proxy",
        assetId,
        inputPath,
        outputPath: path.join(proxyDir, `${assetId}.mp4`),
        projectDir: projDir
      };
      submitJob(proxyJob).catch((err) => console.error("[media-import] Proxy failed:", err));
    }
    return { ok: true };
  });
  ipcMain.handle(
    "media:download-remote",
    async (_event, params) => {
      const { url, projectId, assetId, ext } = params;
      if (!url || !projectId) throw new Error("url and projectId are required");
      const projDir = projectDir(projectId);
      const mediaDir = path.join(projDir, "media", "generated");
      await fs$1.mkdir(mediaDir, { recursive: true });
      const extension = ext || path.extname(new URL(url).pathname) || ".mp4";
      const destPath = path.join(mediaDir, `${assetId}${extension}`);
      const response2 = await fetch(url);
      if (!response2.ok) {
        throw new Error(`Failed to download (HTTP ${response2.status}). The URL may have expired.`);
      }
      const arrayBuffer = await response2.arrayBuffer();
      await fs$1.writeFile(destPath, Buffer.from(arrayBuffer));
      return { path: destPath };
    }
  );
}
function terminateMediaWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
function registerAudioSyncHandlers(submitJob2) {
  ipcMain.handle("sync:compute-offset", async (_event, params) => {
    const jobId = randomUUID();
    const result = await submitJob2({
      id: jobId,
      type: "sync_compute_offset",
      sourceAssetId: params.sourceAssetId,
      targetAssetId: params.targetAssetId,
      sourceFilePath: params.sourceFilePath,
      targetFilePath: params.targetFilePath,
      projectDir: ""
      // Not needed for sync jobs
    });
    return result;
  });
  ipcMain.handle("sync:batch-match", async (_event, params) => {
    const jobId = randomUUID();
    const result = await submitJob2({
      id: jobId,
      type: "sync_batch_match",
      videoAssets: params.videoAssets,
      audioAssets: params.audioAssets,
      projectDir: ""
      // Not needed for sync jobs
    });
    return result;
  });
}
const require$1 = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
function resolveAddonPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "native", "cinegen_avfoundation.node");
  }
  return path.resolve(moduleDir, "../native/avfoundation/build/Release/cinegen_avfoundation.node");
}
let addon = null;
let addonError = null;
if (process.platform === "darwin") {
  try {
    const addonPath = resolveAddonPath();
    addon = require$1(addonPath);
    console.log("[native-video] AVFoundation addon loaded:", addonPath);
  } catch (err) {
    addonError = err instanceof Error ? err.message : String(err);
    console.error("[native-video] Failed to load AVFoundation addon:", addonError);
  }
}
function isNativeVideoAvailable() {
  return addon != null;
}
function getNativeVideoAvailabilityError() {
  return addonError;
}
function createNativeSurface(surfaceId, nativeHandle) {
  if (!addon) return false;
  return addon.createSurface(surfaceId, nativeHandle);
}
function destroyNativeSurface(surfaceId) {
  addon == null ? void 0 : addon.destroySurface(surfaceId);
}
function setNativeSurfaceRect(surfaceId, x, y, width, height) {
  addon == null ? void 0 : addon.setSurfaceRect(surfaceId, x, y, width, height);
}
function setNativeSurfaceHidden(surfaceId, hidden) {
  addon == null ? void 0 : addon.setSurfaceHidden(surfaceId, hidden);
}
function clearNativeSurface(surfaceId) {
  addon == null ? void 0 : addon.clearSurface(surfaceId);
}
function syncNativeSurface(surfaceId, descriptors) {
  addon == null ? void 0 : addon.syncSurface(surfaceId, descriptors);
}
function registerNativeVideoHandlers() {
  ipcMain.handle("native-video:is-available", () => ({
    available: isNativeVideoAvailable(),
    error: getNativeVideoAvailabilityError()
  }));
  ipcMain.handle("native-video:reset-surfaces", (_event, surfaceIds) => {
    if (!isNativeVideoAvailable()) return false;
    for (const surfaceId of surfaceIds) {
      setNativeSurfaceHidden(surfaceId, true);
      clearNativeSurface(surfaceId);
      destroyNativeSurface(surfaceId);
    }
    return true;
  });
  ipcMain.handle("native-video:create-surface", (event, surfaceId) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !isNativeVideoAvailable()) return false;
    return createNativeSurface(surfaceId, win.getNativeWindowHandle());
  });
  ipcMain.on("native-video:set-surface-rect", (_event, payload) => {
    if (!isNativeVideoAvailable()) return;
    setNativeSurfaceRect(payload.surfaceId, payload.x, payload.y, payload.width, payload.height);
  });
  ipcMain.on("native-video:set-surface-hidden", (_event, payload) => {
    if (!isNativeVideoAvailable()) return;
    setNativeSurfaceHidden(payload.surfaceId, payload.hidden);
  });
  ipcMain.on("native-video:clear-surface", (_event, surfaceId) => {
    if (!isNativeVideoAvailable()) return;
    clearNativeSurface(surfaceId);
  });
  ipcMain.on("native-video:sync-surface", (_event, payload) => {
    if (!isNativeVideoAvailable()) return;
    syncNativeSurface(payload.surfaceId, payload.descriptors);
  });
  ipcMain.on("native-video:destroy-surface", (_event, surfaceId) => {
    if (!isNativeVideoAvailable()) return;
    destroyNativeSurface(surfaceId);
  });
}
const PYTHON_BIN = "python3.12";
const WHISPERX_REPO$1 = path.join(os.homedir(), "Desktop", "Coding", "whisperx");
const WHISPERX_PYTHON$1 = path.join(WHISPERX_REPO$1, ".venv", "bin", "python");
function resolveRuntimeScript$1(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(process.cwd(), ...segments);
}
const WHISPERX_SCRIPT$1 = resolveRuntimeScript$1("scripts", "whisperx", "cinegen_infer.py");
const CLOUD_WHISPER_MODEL = "fal-ai/whisper";
const CLOUD_WHISPER_VERSION = "3";
const CONTENT_TYPES$1 = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg"
};
function guessContentType$1(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES$1[ext] ?? "application/octet-stream";
}
function roundTime(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return void 0;
  return Math.round(Math.max(0, parsed) * 1e3) / 1e3;
}
function appendTranscriptToken(text, token) {
  const trimmedToken = token.trim();
  if (!trimmedToken) return text;
  if (!text) return trimmedToken;
  if (/^[,.;:!?%)\]}]/.test(trimmedToken) || /^['’]/.test(trimmedToken)) {
    return `${text}${trimmedToken}`;
  }
  return `${text} ${trimmedToken}`;
}
function normalizeSpeaker(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function buildSegmentsFromWords(words) {
  const segments = [];
  let current = null;
  const flushCurrent = () => {
    var _a;
    if (!current) return;
    current.text = current.text.trim();
    if (current.text || (((_a = current.words) == null ? void 0 : _a.length) ?? 0) > 0) {
      segments.push(current);
    }
    current = null;
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!current) {
      current = {
        start: word.start,
        end: word.end,
        text: "",
        ...word.speaker ? { speaker: word.speaker } : {},
        words: []
      };
    }
    current.words.push(word);
    current.end = word.end;
    current.text = appendTranscriptToken(current.text, word.word);
    if (!current.speaker && word.speaker) current.speaker = word.speaker;
    const nextWord = words[i + 1];
    const gap = nextWord ? Math.max(0, nextWord.start - word.end) : 0;
    const speakerChange = Boolean(nextWord) && (nextWord.speaker ?? null) !== (current.speaker ?? null);
    const duration = current.end - current.start;
    const endsSentence = /[.!?]["')\]]*$/.test(word.word);
    const pauseBreak = gap >= 0.85 || gap >= 0.45 && /[,;:]$/.test(word.word);
    const durationBreak = duration >= 12;
    if (!nextWord || endsSentence || pauseBreak || durationBreak || speakerChange) {
      flushCurrent();
    }
  }
  flushCurrent();
  return segments;
}
function normalizeTranscriptSegments(segments) {
  const words = segments.flatMap((segment) => Array.isArray(segment.words) ? segment.words.flatMap((word) => {
    if (!word || typeof word.word !== "string") return [];
    const start = roundTime(word.start);
    const end = roundTime(word.end);
    if (start === void 0 || end === void 0) return [];
    return [{
      word: word.word.trim(),
      start,
      end,
      ...word.prob !== void 0 ? { prob: word.prob } : {},
      ...word.speaker !== void 0 ? { speaker: word.speaker } : {}
    }];
  }) : []);
  if (words.length === 0) return segments;
  return buildSegmentsFromWords(words);
}
function normalizeCloudWhisperResult(result) {
  const data = (result == null ? void 0 : result.data) ?? result;
  const rawText = typeof (data == null ? void 0 : data.text) === "string" ? data.text : "";
  const rawChunks = data == null ? void 0 : data.chunks;
  const rawLanguage = data;
  const normalizedChunks = Array.isArray(rawChunks) ? rawChunks.flatMap((chunk) => {
    if (!chunk || typeof chunk !== "object") return [];
    const text = typeof chunk.text === "string" ? chunk.text.trim() : "";
    const timestamp2 = chunk.timestamp;
    const start = Array.isArray(timestamp2) ? roundTime(timestamp2[0]) : void 0;
    const end = Array.isArray(timestamp2) ? roundTime(timestamp2[1]) : void 0;
    const speaker = normalizeSpeaker(chunk.speaker);
    if (!text && start === void 0 && end === void 0) return [];
    return [{ text, start, end, speaker }];
  }) : [];
  const words = normalizedChunks.flatMap((chunk) => {
    if (!chunk.text || chunk.start === void 0 || chunk.end === void 0) return [];
    return [{
      word: chunk.text,
      start: chunk.start,
      end: chunk.end,
      ...chunk.speaker ? { speaker: chunk.speaker } : {}
    }];
  });
  const segments = words.length > 0 ? buildSegmentsFromWords(words) : normalizedChunks.map((chunk) => ({
    text: chunk.text,
    start: chunk.start ?? 0,
    end: chunk.end ?? chunk.start ?? 0,
    ...chunk.speaker ? { speaker: chunk.speaker } : {}
  }));
  let language = "";
  const candidates = [rawLanguage.language, rawLanguage.languages, rawLanguage.inferred_languages];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      language = candidate.trim();
      break;
    }
    if (Array.isArray(candidate)) {
      const first = candidate.find((entry) => typeof entry === "string" && entry.trim().length > 0);
      if (first) {
        language = first.trim();
        break;
      }
    }
  }
  return {
    text: rawText || segments.map((segment) => segment.text).filter(Boolean).join(" "),
    segments,
    language
  };
}
async function extractAudioForTranscription(inputPath) {
  const outputPath = path.join(
    os.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  );
  const ffmpegPath = getFfmpegPath();
  const args = [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    outputPath
  ];
  await new Promise((resolve, reject) => {
    var _a;
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    (_a = proc.stderr) == null ? void 0 : _a.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
  return outputPath;
}
const TRANSCRIBE_SCRIPT = `
import sys, json, os
sys.stderr = open(os.devnull, 'w')

file_path = sys.argv[1]
model_size = sys.argv[2] if len(sys.argv) > 2 else 'large'
language = sys.argv[3] if len(sys.argv) > 3 else None

from faster_whisper import WhisperModel

model = WhisperModel(model_size, device='cpu', compute_type='int8')
lang_arg = language if language and language != 'auto' else None
segments, info = model.transcribe(
    file_path,
    language=lang_arg,
    beam_size=5,
    word_timestamps=True,
)

full_text = []
for seg in segments:
    full_text.append(seg.text.strip())
    words = []
    if seg.words:
        for w in seg.words:
            words.append({'word': w.word.strip(), 'start': round(w.start, 3), 'end': round(w.end, 3), 'prob': round(w.probability, 3)})
    print(json.dumps({
        'type': 'segment',
        'text': seg.text.strip(),
        'start': round(seg.start, 3),
        'end': round(seg.end, 3),
        'words': words,
    }), flush=True)

print(json.dumps({'type': 'done', 'text': ' '.join(full_text), 'language': info.language}), flush=True)
`;
const jobs$1 = /* @__PURE__ */ new Map();
function getMainWindow$1() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}
function sendProgress$1(job, data) {
  var _a;
  (_a = getMainWindow$1()) == null ? void 0 : _a.webContents.send("transcription:progress", {
    jobId: job.jobId,
    assetId: job.assetId,
    engine: job.engine,
    ...data
  });
}
async function persistTranscription(job) {
  try {
    const db = getDb(job.projectId);
    const existing = getAssets(db, job.projectId).find((a) => a.id === job.assetId);
    const existingMeta = (existing == null ? void 0 : existing.metadata) ? JSON.parse(existing.metadata) : {};
    const updatedMeta = {
      ...existingMeta,
      transcription: {
        text: job.fullText,
        segments: job.segments,
        language: job.language,
        engine: job.engine,
        ...job.model ? { model: job.model } : {},
        processedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      transcriptionJobId: void 0
    };
    updateAsset(db, job.assetId, { metadata: JSON.stringify(updatedMeta) });
  } catch (err) {
    console.error("[transcription] failed to save to db:", err);
  }
}
async function finishJob(job) {
  job.status = "done";
  job.segments = normalizeTranscriptSegments(job.segments);
  if (!job.fullText.trim()) {
    job.fullText = job.segments.map((segment) => segment.text).filter(Boolean).join(" ");
  }
  await persistTranscription(job);
  sendProgress$1(job, {
    type: "done",
    text: job.fullText,
    segments: job.segments,
    language: job.language
  });
}
function failJob(job, error) {
  job.status = "error";
  job.error = error;
  sendProgress$1(job, { type: "error", error });
}
function startFastWhisperJob(job, params) {
  const model = params.model ?? "large";
  const language = params.language ?? "auto";
  job.model = model;
  void (async () => {
    const scriptPath = path.join(os.tmpdir(), `cinegen-whisper-${job.jobId}.py`);
    await fs$1.writeFile(scriptPath, TRANSCRIBE_SCRIPT, "utf-8");
    const proc = spawn(PYTHON_BIN, [scriptPath, params.filePath, model, language], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    job.status = "running";
    sendProgress$1(job, { type: "status", status: "running" });
    proc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === "segment") {
            const segment = {
              text: msg.text,
              start: msg.start ?? 0,
              end: msg.end ?? 0,
              ...Array.isArray(msg.words) && msg.words.length > 0 ? { words: msg.words } : {}
            };
            job.segments.push(segment);
            sendProgress$1(job, { type: "segment", ...segment });
          } else if (msg.type === "done") {
            job.fullText = msg.text;
            job.language = msg.language ?? "";
          }
        } catch {
        }
      }
    });
    proc.stderr.on("data", () => {
    });
    proc.on("close", async (code) => {
      await fs$1.unlink(scriptPath).catch(() => {
      });
      if (code !== 0) {
        failJob(job, `whisper process exited with code ${code}`);
        return;
      }
      await finishJob(job);
    });
    proc.on("error", async (err) => {
      await fs$1.unlink(scriptPath).catch(() => {
      });
      failJob(job, err.message);
    });
  })().catch((err) => {
    failJob(job, err instanceof Error ? err.message : String(err));
  });
}
function startWhisperXJob(job, params) {
  job.model = "base";
  const args = [
    WHISPERX_SCRIPT$1,
    "--audio_path",
    params.filePath,
    "--model",
    "base",
    "--no_diarize"
  ];
  if (params.language && params.language !== "auto") {
    args.push("--language", params.language);
  }
  const env = { ...process.env };
  if (process.env.HF_TOKEN) env.HF_TOKEN = process.env.HF_TOKEN;
  const proc = spawn(WHISPERX_PYTHON$1, args, {
    cwd: WHISPERX_REPO$1,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  job.status = "running";
  sendProgress$1(job, { type: "status", status: "running" });
  let transcriptPath;
  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === "progress") {
          if (msg.output_text !== void 0) job.fullText = msg.output_text;
          if (msg.segments) job.segments = msg.segments;
          if (msg.language !== void 0) job.language = msg.language;
          sendProgress$1(job, {
            type: "progress",
            stage: msg.stage,
            message: msg.message,
            ...msg.output_text !== void 0 ? { text: msg.output_text } : {},
            ...msg.segments ? { segments: msg.segments } : {},
            ...msg.language !== void 0 ? { language: msg.language } : {}
          });
        } else if (msg.type === "done") {
          if (msg.output_text !== void 0) job.fullText = msg.output_text;
          if (msg.segments) job.segments = msg.segments;
          if (msg.language !== void 0) job.language = msg.language;
          transcriptPath = msg.transcript_path;
        } else if (msg.type === "error") {
          failJob(job, msg.error ?? "WhisperX error");
        }
      } catch {
      }
    }
  });
  proc.stderr.on("data", () => {
  });
  proc.on("close", async (code) => {
    if (job.status === "error") return;
    if (code !== 0) {
      failJob(job, `whisperx process exited with code ${code}`);
      return;
    }
    if (transcriptPath) {
      try {
        const raw = await fs$1.readFile(transcriptPath, "utf-8");
        const transcript = JSON.parse(raw);
        if (transcript.output_text !== void 0) job.fullText = transcript.output_text;
        if (transcript.segments) job.segments = transcript.segments;
        if (transcript.language !== void 0) job.language = transcript.language;
        if (transcript.model) job.model = transcript.model;
      } finally {
        await fs$1.unlink(transcriptPath).catch(() => {
        });
      }
    }
    await finishJob(job);
  });
  proc.on("error", (err) => {
    failJob(job, err.message);
  });
}
function startCloudWhisperJob(job, params) {
  void (async () => {
    if (!params.apiKey) throw new Error("No fal.ai API key provided. Add one in Settings.");
    job.model = CLOUD_WHISPER_VERSION;
    job.status = "running";
    sendProgress$1(job, { type: "status", status: "running", stage: "uploading", message: "Preparing audio for cloud transcription" });
    srcExports.fal.config({ credentials: params.apiKey });
    const extractedPath = await extractAudioForTranscription(params.filePath);
    let uploadedUrl = "";
    try {
      const buffer = await fs$1.readFile(extractedPath);
      const baseName = path.basename(params.filePath, path.extname(params.filePath));
      const fileName = `${baseName}.m4a`;
      const type = guessContentType$1(extractedPath);
      const blob = new Blob([buffer], { type });
      const file = new File([blob], fileName, { type });
      const url = await srcExports.fal.storage.upload(file);
      uploadedUrl = url;
    } finally {
      await fs$1.unlink(extractedPath).catch(() => {
      });
    }
    sendProgress$1(job, { type: "status", status: "running", stage: "transcribing", message: "Running cloud transcription" });
    const input = {
      audio_url: uploadedUrl,
      task: "transcribe",
      chunk_level: "word",
      version: CLOUD_WHISPER_VERSION,
      ...params.language && params.language !== "auto" ? { language: params.language } : {}
    };
    const result = await srcExports.fal.subscribe(CLOUD_WHISPER_MODEL, { input, logs: true });
    const normalized = normalizeCloudWhisperResult(result);
    job.fullText = normalized.text;
    job.segments = normalized.segments;
    job.language = normalized.language;
    await finishJob(job);
  })().catch((err) => {
    failJob(job, err instanceof Error ? err.message : String(err));
  });
}
function registerTranscriptionHandlers() {
  ipcMain.handle("transcription:start", async (_event, params) => {
    const {
      projectId,
      assetId,
      filePath,
      model = "large",
      language = "auto",
      engine = "faster-whisper-local",
      apiKey
    } = params;
    const jobId = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      jobId,
      assetId,
      projectId,
      engine,
      status: "pending",
      segments: [],
      fullText: "",
      language: ""
    };
    jobs$1.set(jobId, job);
    if (engine === "whisperx-local") {
      startWhisperXJob(job, { filePath, language });
    } else if (engine === "whisper-cloud") {
      startCloudWhisperJob(job, { filePath, language, apiKey });
    } else {
      startFastWhisperJob(job, { filePath, model, language });
    }
    return { jobId };
  });
  ipcMain.handle("transcription:get", (_event, jobId) => {
    const job = jobs$1.get(jobId);
    if (!job) return null;
    return {
      status: job.status,
      fullText: job.fullText,
      segments: job.segments,
      language: job.language,
      engine: job.engine,
      error: job.error
    };
  });
}
const LTX_REPO = path.join(os.homedir(), "Desktop", "Coding", "ltx");
const LTX_PYTHON = path.join(LTX_REPO, ".venv", "bin", "python");
const LTX_SCRIPT = path.join(LTX_REPO, "cinegen_infer.py");
const QWEN_EDIT_REPO = path.join(os.homedir(), "Desktop", "Coding", "qwen-edit");
const QWEN_EDIT_PYTHON = path.join(QWEN_EDIT_REPO, ".venv", "bin", "python");
const QWEN_EDIT_SCRIPT = path.join(QWEN_EDIT_REPO, "cinegen_infer.py");
const LAYER_DECOMPOSE_REPO = path.join(os.homedir(), "Desktop", "Coding", "layer-decompose");
const LAYER_DECOMPOSE_PYTHON = path.join(LAYER_DECOMPOSE_REPO, ".venv", "bin", "python");
const WHISPERX_REPO = path.join(os.homedir(), "Desktop", "Coding", "whisperx");
const WHISPERX_PYTHON = path.join(WHISPERX_REPO, ".venv", "bin", "python");
function resolveRuntimeScript(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(process.cwd(), ...segments);
}
const LAYER_DECOMPOSE_SCRIPT = resolveRuntimeScript("scripts", "layer-decompose", "cinegen_infer.py");
const WHISPERX_SCRIPT = resolveRuntimeScript("scripts", "whisperx", "cinegen_infer.py");
const RESOLUTION_MAP = {
  "512x896": { height: 896, width: 512 },
  // 9:16 portrait
  "896x512": { height: 512, width: 896 },
  // 16:9 landscape
  "512x512": { height: 512, width: 512 },
  // 1:1
  "704x1280": { height: 1280, width: 704 },
  // 9:16 HD
  "1280x704": { height: 704, width: 1280 },
  // 16:9 HD
  "768x768": { height: 768, width: 768 }
  // 1:1 medium
};
const jobs = /* @__PURE__ */ new Map();
function getMainWindow() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}
function sendProgress(jobId, data) {
  var _a;
  (_a = getMainWindow()) == null ? void 0 : _a.webContents.send("local-model:progress", { jobId, ...data });
}
async function resolveImageUrl(raw, jobId) {
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const ext = path.extname(new URL(raw).pathname) || ".jpg";
    const tempPath = path.join(os.tmpdir(), `cinegen-img-${jobId}${ext}`);
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    const buf = await res.arrayBuffer();
    await fs$1.writeFile(tempPath, Buffer.from(buf));
    return { imagePath: tempPath, tempPath };
  } else if (raw.startsWith("local-media://file/")) {
    return { imagePath: decodeURIComponent(raw.replace("local-media://file", "")), tempPath: null };
  }
  return { imagePath: raw, tempPath: null };
}
function registerLocalModelHandlers() {
  ipcMain.handle("local-model:run", async (_event, params) => {
    const { inputs } = params;
    const jobId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const job = { jobId, status: "pending" };
    jobs.set(jobId, job);
    let proc;
    let tempImagePath = null;
    if (params.nodeType === "qwen-edit-local") {
      const prompt = String(inputs.prompt ?? "");
      const num_inference_steps = Number(inputs.num_inference_steps ?? 50);
      const guidance_scale = Number(inputs.guidance_scale ?? 1);
      const true_cfg_scale = Number(inputs.true_cfg_scale ?? 4);
      const seed = Number(inputs.seed ?? 42);
      let image_path = null;
      if (inputs.image_url) {
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
      }
      if (!image_path) throw new Error("Qwen Image Edit requires an input image");
      const args = [
        QWEN_EDIT_SCRIPT,
        "--image_path",
        image_path,
        "--prompt",
        prompt,
        "--num_inference_steps",
        String(num_inference_steps),
        "--guidance_scale",
        String(guidance_scale),
        "--true_cfg_scale",
        String(true_cfg_scale),
        "--seed",
        String(seed)
      ];
      proc = spawn(QWEN_EDIT_PYTHON, args, {
        cwd: QWEN_EDIT_REPO,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (params.nodeType === "layer-decompose") {
      console.log("[layer-decompose] inputs:", JSON.stringify(inputs, null, 2));
      const prompts = String(inputs.prompts ?? "").trim();
      const inpainterSetting = String(inputs.inpainter ?? "qwen-edit-local");
      const reconstructBg = Boolean(inputs.reconstruct_bg ?? true);
      const seed = Number(inputs.seed ?? 42);
      let image_path = null;
      if (inputs.image_url) {
        console.log("[layer-decompose] resolving image_url:", inputs.image_url);
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
        console.log("[layer-decompose] resolved to:", image_path);
      }
      if (!image_path) throw new Error("Layer Decompose requires an input image");
      const pythonInpainter = reconstructBg && inpainterSetting === "lama" ? "lama" : "none";
      const args = [
        LAYER_DECOMPOSE_SCRIPT,
        "--image_path",
        image_path,
        "--inpainter",
        pythonInpainter,
        "--seed",
        String(seed)
      ];
      if (prompts) args.push("--prompts", prompts);
      proc = spawn(LAYER_DECOMPOSE_PYTHON, args, {
        cwd: LAYER_DECOMPOSE_REPO,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (params.nodeType === "whisperx-local") {
      console.log("[whisperx] inputs:", JSON.stringify(inputs, null, 2));
      const model = String(inputs.model ?? "base");
      const language = String(inputs.language ?? "").trim();
      const diarize = inputs.diarize !== false;
      let audioPath = null;
      if (inputs.audio_url) {
        console.log("[whisperx] resolving audio_url:", inputs.audio_url);
        const resolved = await resolveImageUrl(String(inputs.audio_url), jobId);
        audioPath = resolved.imagePath;
        tempImagePath = resolved.tempPath;
        console.log("[whisperx] resolved to:", audioPath);
      }
      if (!audioPath) throw new Error("WhisperX requires an audio input");
      const args = [
        WHISPERX_SCRIPT,
        "--audio_path",
        audioPath,
        "--model",
        model
      ];
      if (language) args.push("--language", language);
      if (!diarize) args.push("--no_diarize");
      const hfToken = process.env.HF_TOKEN;
      const env = { ...process.env };
      if (hfToken) env.HF_TOKEN = hfToken;
      proc = spawn(WHISPERX_PYTHON, args, {
        cwd: WHISPERX_REPO,
        stdio: ["ignore", "pipe", "pipe"],
        env
      });
    } else {
      const prompt = String(inputs.prompt ?? "");
      const resolution = String(inputs.resolution ?? "896x512");
      const { height, width } = RESOLUTION_MAP[resolution] ?? { height: 512, width: 896 };
      const frame_rate = Number(inputs.frame_rate ?? 24);
      const duration_secs = Number(inputs.duration_secs ?? 4);
      const raw_frames = Math.round(duration_secs * frame_rate / 8) * 8 + 1;
      const num_frames = Math.max(9, raw_frames);
      const seed = Number(inputs.seed ?? 42);
      const enhance_prompt = Boolean(inputs.enhance_prompt);
      let image_path = null;
      if (inputs.image_url) {
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
      }
      const args = [
        LTX_SCRIPT,
        "--prompt",
        prompt,
        "--height",
        String(height),
        "--width",
        String(width),
        "--num_frames",
        String(num_frames),
        "--frame_rate",
        String(frame_rate),
        "--seed",
        String(seed)
      ];
      if (image_path) args.push("--image_path", image_path);
      if (enhance_prompt) args.push("--enhance_prompt");
      proc = spawn(LTX_PYTHON, args, {
        cwd: LTX_REPO,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }
    job.status = "running";
    sendProgress(jobId, { type: "status", status: "running" });
    proc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === "progress") {
            job.stage = msg.stage;
            if (msg.output_text !== void 0) job.outputText = msg.output_text;
            if (msg.segments) job.segments = msg.segments;
            if (msg.language !== void 0) job.language = msg.language;
            sendProgress(jobId, {
              type: "progress",
              stage: msg.stage,
              message: msg.message,
              ...msg.output_text !== void 0 && { output_text: msg.output_text },
              ...msg.segments && { segments: msg.segments },
              ...msg.language !== void 0 && { language: msg.language }
            });
          } else if (msg.type === "done") {
            job.status = "done";
            job.outputPath = msg.output_path;
            job.outputText = msg.output_text;
            job.transcriptPath = msg.transcript_path;
            job.segments = msg.segments;
            job.language = msg.language;
            sendProgress(jobId, {
              type: "done",
              output_path: msg.output_path,
              ...msg.output_text !== void 0 && { output_text: msg.output_text },
              ...msg.transcript_path !== void 0 && { transcript_path: msg.transcript_path },
              ...msg.segments && { segments: msg.segments },
              ...msg.language !== void 0 && { language: msg.language },
              ...msg.layers && { layers: msg.layers },
              ...msg.needs_inpainting !== void 0 && { needs_inpainting: msg.needs_inpainting },
              ...msg.combined_mask_path && { combined_mask_path: msg.combined_mask_path }
            });
          } else if (msg.type === "error") {
            job.status = "error";
            job.error = msg.error;
            sendProgress(jobId, { type: "error", error: msg.error });
          }
        } catch {
        }
      }
    });
    proc.stderr.on("data", () => {
    });
    proc.on("error", (err) => {
      job.status = "error";
      job.error = err.message;
      sendProgress(jobId, { type: "error", error: err.message });
    });
    proc.on("close", (code) => {
      if (tempImagePath) fs$1.unlink(tempImagePath).catch(() => {
      });
      if (code !== 0 && job.status !== "done") {
        job.status = "error";
        job.error = job.error ?? `Process exited with code ${code}`;
        sendProgress(jobId, { type: "error", error: job.error });
      }
    });
    return { jobId };
  });
  ipcMain.handle("local-model:get", (_event, jobId) => {
    const job = jobs.get(jobId);
    if (!job) return null;
    return {
      status: job.status,
      stage: job.stage,
      outputPath: job.outputPath,
      outputText: job.outputText,
      transcriptPath: job.transcriptPath,
      segments: job.segments,
      language: job.language,
      error: job.error
    };
  });
  ipcMain.handle("local-model:read-transcript", async (_event, transcriptPath) => {
    try {
      const raw = await fs$1.readFile(transcriptPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      console.error("[local-model] failed to read transcript:", error);
      return null;
    }
  });
}
const SAM3_REPO = path.join(os.homedir(), "Desktop", "Coding", "Sam3");
const SAM3_PYTHON = path.join(SAM3_REPO, ".venv", "bin", "python");
const SAM3_SCRIPT = path.join(SAM3_REPO, "cinegen_server.py");
const IDLE_TIMEOUT_MS = 2 * 60 * 1e3;
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_MAX_ATTEMPTS = 60;
class Sam3ServerManager {
  constructor() {
    this.proc = null;
    this.port = 0;
    this.idleTimer = null;
  }
  async start() {
    var _a, _b;
    if (this.proc && !this.proc.killed) {
      return this.port;
    }
    this.port = await this.findFreePort();
    console.log(`[sam3] Starting server on port ${this.port}`);
    this.proc = spawn(SAM3_PYTHON, [SAM3_SCRIPT, "--port", String(this.port)], {
      cwd: SAM3_REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: "1"
      }
    });
    (_a = this.proc.stdout) == null ? void 0 : _a.on("data", (chunk) => {
      console.log("[sam3-stdout]", chunk.toString().trim());
    });
    (_b = this.proc.stderr) == null ? void 0 : _b.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.log("[sam3-stderr]", msg);
    });
    this.proc.on("exit", (code) => {
      console.log(`[sam3] Server exited with code ${code}`);
      this.proc = null;
    });
    await this.waitForHealth();
    this.resetIdleTimer();
    console.log("[sam3] Server ready");
    return this.port;
  }
  async stop() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.proc && !this.proc.killed) {
      console.log("[sam3] Stopping server");
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }
  async ensureRunning() {
    if (this.isRunning()) {
      this.resetIdleTimer();
      return this.port;
    }
    return this.start();
  }
  isRunning() {
    return this.proc !== null && !this.proc.killed;
  }
  getPort() {
    return this.port;
  }
  resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log("[sam3] Idle timeout — stopping server");
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }
  async findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error("Could not find free port"));
        }
      });
    });
  }
  async waitForHealth() {
    console.log(`[sam3] Waiting for health on port ${this.port}...`);
    for (let i = 0; i < HEALTH_POLL_MAX_ATTEMPTS; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (res.ok) {
          console.log(`[sam3] Health check passed after ${i + 1} attempts`);
          return;
        }
      } catch {
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
    console.error("[sam3] Health check timed out after 30 seconds");
    throw new Error("SAM 3 server failed to start within 30 seconds");
  }
}
const manager = new Sam3ServerManager();
function registerSam3Handlers() {
  ipcMain.handle("sam3:start", async () => {
    const port = await manager.ensureRunning();
    return { port };
  });
  ipcMain.handle("sam3:stop", async () => {
    await manager.stop();
  });
  ipcMain.handle("sam3:port", () => {
    return { port: manager.getPort(), running: manager.isRunning() };
  });
}
function stopSam3Server() {
  manager.stop();
}
const SHOULD_DISABLE_GPU_FOR_DEV_WAKE = process.platform === "darwin" && !app.isPackaged;
if (SHOULD_DISABLE_GPU_FOR_DEV_WAKE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu-compositing");
  console.log("[app] hardware acceleration disabled for macOS dev wake stability");
}
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
]);
let mainWindow = null;
let splashWindow = null;
let pmWindow = null;
let wakeRecoveryTimer = null;
const appStartTime = Date.now();
const LEGACY_USER_DATA_DIR = "cinegen-desktop";
const PREFERRED_USER_DATA_DIR = "CineGen";
const USER_DATA_MIGRATION_MARKER = ".cinegen-user-data-migrated.json";
const APP_DISPLAY_NAME = "CineGen";
const WAKE_RECOVERY_DELAY_MS = 700;
function broadcastPowerEvent(type) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("app:power-event", { type });
  }
}
const CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".json": "application/json"
};
function configureUserDataPath() {
  try {
    const appDataPath = app.getPath("appData");
    const legacyUserDataPath = path.join(appDataPath, LEGACY_USER_DATA_DIR);
    const preferredUserDataPath = path.join(appDataPath, PREFERRED_USER_DATA_DIR);
    if (app.getPath("userData") !== preferredUserDataPath) {
      app.setPath("userData", preferredUserDataPath);
    }
    console.log("[app] userData path:", preferredUserDataPath);
    return { preferredUserDataPath, legacyUserDataPath };
  } catch (error) {
    console.error("[app] failed to configure userData path:", error);
    const appDataPath = app.getPath("appData");
    const preferredUserDataPath = path.join(appDataPath, PREFERRED_USER_DATA_DIR);
    const legacyUserDataPath = path.join(appDataPath, LEGACY_USER_DATA_DIR);
    return { preferredUserDataPath, legacyUserDataPath };
  }
}
const userDataPaths = configureUserDataPath();
try {
  app.setName(APP_DISPLAY_NAME);
  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: APP_DISPLAY_NAME,
      applicationVersion: app.getVersion(),
      version: app.getVersion()
    });
  }
} catch (error) {
  console.error("[app] failed to configure app display name:", error);
}
async function migrateUserDataIfNeeded() {
  const { preferredUserDataPath, legacyUserDataPath } = userDataPaths;
  if (preferredUserDataPath === legacyUserDataPath) return;
  if (!fs.existsSync(legacyUserDataPath)) return;
  const markerPath = path.join(preferredUserDataPath, USER_DATA_MIGRATION_MARKER);
  if (fs.existsSync(markerPath)) return;
  try {
    await fs$1.mkdir(preferredUserDataPath, { recursive: true });
    await fs$1.cp(legacyUserDataPath, preferredUserDataPath, { recursive: true, force: true });
    await fs$1.writeFile(
      markerPath,
      JSON.stringify({
        migratedFrom: legacyUserDataPath,
        migratedAt: (/* @__PURE__ */ new Date()).toISOString()
      }, null, 2),
      "utf-8"
    );
    console.log("[app] migrated userData:", legacyUserDataPath, "->", preferredUserDataPath);
  } catch (error) {
    console.error("[app] failed to migrate userData:", error);
  }
}
function resolveAppIconPaths() {
  const fileNames = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"];
  const roots = [
    process.cwd(),
    app.getAppPath(),
    process.resourcesPath
  ];
  const candidates = [];
  for (const root of roots) {
    for (const fileName of fileNames) {
      const candidate = path.join(root, "build", fileName);
      if (fs.existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}
function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
function getHeader(headers2, name2) {
  return headers2.get(name2) ?? headers2.get(name2.toLowerCase()) ?? headers2.get(name2.toUpperCase());
}
function parseByteRangeHeader(rangeHeader, totalSize) {
  var _a;
  if (!rangeHeader.startsWith("bytes=")) return null;
  const firstRange = ((_a = rangeHeader.slice("bytes=".length).split(",")[0]) == null ? void 0 : _a.trim()) ?? "";
  const match = /^(\d*)-(\d*)$/.exec(firstRange);
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];
  if (!startStr && endStr) {
    const suffixLen = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(totalSize - suffixLen, 0);
    const end = totalSize - 1;
    return start <= end ? { start, end } : null;
  }
  if (startStr) {
    const start = Number.parseInt(startStr, 10);
    const parsedEnd = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(parsedEnd)) return null;
    const end = Math.min(parsedEnd, totalSize - 1);
    if (start < 0 || end < start || start >= totalSize) return null;
    return { start, end };
  }
  return null;
}
function toFsPathFromLocalMediaUrl(requestUrl) {
  const url = new URL(requestUrl);
  if (url.hostname !== "file") return null;
  let decodedPath = decodeURIComponent(url.pathname);
  if (process.platform === "win32" && decodedPath.startsWith("/")) {
    decodedPath = decodedPath.slice(1);
  }
  return path.normalize(decodedPath);
}
async function migrateLegacyData() {
  var _a, _b, _c, _d;
  const legacyPath = path.join(process.cwd(), ".data", "dev", "project.json");
  const cingenDir = path.join(os.homedir(), "Documents", "CINEGEN");
  const indexPath2 = path.join(cingenDir, "projects.json");
  try {
    await fs$1.access(legacyPath);
  } catch {
    return;
  }
  try {
    await fs$1.access(indexPath2);
    return;
  } catch {
  }
  try {
    const raw = await fs$1.readFile(legacyPath, "utf-8");
    const snapshot = JSON.parse(raw);
    const id = ((_a = snapshot.project) == null ? void 0 : _a.id) || crypto$1.randomUUID();
    const name2 = ((_b = snapshot.project) == null ? void 0 : _b.name) || "Migrated Project";
    await fs$1.mkdir(path.join(cingenDir, id), { recursive: true });
    await fs$1.writeFile(
      path.join(cingenDir, id, "project.json"),
      JSON.stringify(snapshot, null, 2),
      "utf-8"
    );
    const index = {
      projects: [{
        id,
        name: name2,
        createdAt: ((_c = snapshot.project) == null ? void 0 : _c.createdAt) || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: ((_d = snapshot.project) == null ? void 0 : _d.updatedAt) || (/* @__PURE__ */ new Date()).toISOString(),
        assetCount: Array.isArray(snapshot.assets) ? snapshot.assets.length : 0,
        elementCount: Array.isArray(snapshot.elements) ? snapshot.elements.length : 0,
        thumbnail: null
      }]
    };
    await fs$1.writeFile(indexPath2, JSON.stringify(index, null, 2), "utf-8");
    console.log(`[migration] Migrated legacy project "${name2}" to ${cingenDir}/${id}`);
  } catch (err) {
    console.error("[migration] Failed to migrate legacy data:", err);
  }
}
app.whenReady().then(async () => {
  await migrateUserDataIfNeeded();
  if (process.platform === "darwin") {
    const iconPaths = resolveAppIconPaths();
    console.log("[dock] icon candidates:", iconPaths);
    for (const iconPath of iconPaths) {
      try {
        const icon = nativeImage.createFromPath(iconPath);
        console.log("[dock] testing icon:", iconPath, "empty?", icon.isEmpty());
        if (!icon.isEmpty()) {
          await Promise.resolve(app.dock.setIcon(icon));
          console.log("[dock] applied icon:", iconPath);
          break;
        }
      } catch (error) {
        console.error("[dock] failed to apply icon:", iconPath, error);
      }
    }
  }
  protocol.handle("local-media", async (request2) => {
    try {
      const fsPath = toFsPathFromLocalMediaUrl(request2.url);
      if (!fsPath) {
        return new Response("Invalid local-media host", { status: 400 });
      }
      const stats = await fs$1.stat(fsPath);
      if (!stats.isFile()) {
        return new Response("Not a file", { status: 404 });
      }
      const totalSize = stats.size;
      const contentType = guessContentType(fsPath);
      const range = getHeader(request2.headers, "range");
      if (request2.method.toUpperCase() === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(totalSize),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }
      if (range) {
        const parsed = parseByteRangeHeader(range, totalSize);
        if (!parsed) {
          return new Response("Invalid Range", { status: 416 });
        }
        const safeStart = parsed.start;
        const safeEnd = parsed.end;
        if (safeStart < 0 || safeEnd < safeStart || safeStart >= totalSize) {
          return new Response("Range Not Satisfiable", {
            status: 416,
            headers: {
              "Content-Range": `bytes */${totalSize}`
            }
          });
        }
        const chunkSize = safeEnd - safeStart + 1;
        const stream2 = fs.createReadStream(fsPath, { start: safeStart, end: safeEnd });
        const body2 = Readable.toWeb(stream2);
        return new Response(body2, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${safeStart}-${safeEnd}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }
      const stream = fs.createReadStream(fsPath);
      const body = Readable.toWeb(stream);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(totalSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      });
    } catch (err) {
      console.error("[local-media] Failed request:", request2.url, err);
      return new Response("Invalid local-media URL", { status: 400 });
    }
  });
  registerProjectHandlers();
  registerWorkflowHandlers();
  registerExportHandlers();
  registerElementHandlers();
  registerLLMChatHandlers();
  registerMusicPromptHandlers();
  registerFileSystemHandlers();
  registerDbHandlers();
  registerMediaImportHandlers();
  registerAudioSyncHandlers(submitJob);
  registerVisionHandlers();
  registerNativeVideoHandlers();
  registerTranscriptionHandlers();
  registerLocalModelHandlers();
  registerSam3Handlers();
  await migrateLegacyData();
  ipcMain.handle("pm:open-project", async (_event, id, useSqlite) => {
    if (id === "__close__") {
      pmWindow == null ? void 0 : pmWindow.close();
      pmWindow = null;
      return { ok: true };
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
    mainWindow.once("ready-to-show", () => {
      mainWindow == null ? void 0 : mainWindow.maximize();
      mainWindow == null ? void 0 : mainWindow.show();
      mainWindow == null ? void 0 : mainWindow.webContents.send("pm:open-project", id, useSqlite);
    });
    if (mainWindow.webContents.getURL() !== "") {
      mainWindow.maximize();
      mainWindow.show();
      mainWindow.webContents.send("pm:open-project", id, useSqlite);
    }
    pmWindow == null ? void 0 : pmWindow.close();
    pmWindow = null;
    return { ok: true };
  });
  ipcMain.handle("pm:open", async () => {
    if (pmWindow && !pmWindow.isDestroyed()) {
      pmWindow.focus();
      return { ok: true };
    }
    pmWindow = createProjectManagerWindow();
    pmWindow.on("closed", () => {
      pmWindow = null;
    });
    return { ok: true };
  });
  splashWindow = createSplashWindow();
  mainWindow = createMainWindow();
  const splashMinTime = 3e3;
  mainWindow.once("ready-to-show", () => {
    const elapsed = Date.now() - appStartTime;
    const remaining = Math.max(0, splashMinTime - elapsed);
    setTimeout(() => {
      splashWindow == null ? void 0 : splashWindow.close();
      splashWindow = null;
      pmWindow = createProjectManagerWindow();
      pmWindow.on("closed", () => {
        pmWindow = null;
      });
    }, remaining);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      pmWindow = createProjectManagerWindow();
      pmWindow.on("closed", () => {
        pmWindow = null;
      });
    }
  });
  const scheduleWakeRecovery = (source) => {
    if (wakeRecoveryTimer) {
      clearTimeout(wakeRecoveryTimer);
      wakeRecoveryTimer = null;
    }
    wakeRecoveryTimer = setTimeout(() => {
      wakeRecoveryTimer = null;
      console.log(`[app] Wake recovery triggered by ${source}`);
      recoverManagedWindowsFromSleep(source);
    }, WAKE_RECOVERY_DELAY_MS);
  };
  powerMonitor.on("resume", () => {
    broadcastPowerEvent("resume");
    scheduleWakeRecovery("resume");
  });
  powerMonitor.on("unlock-screen", () => {
    broadcastPowerEvent("unlock-screen");
    scheduleWakeRecovery("unlock-screen");
  });
  powerMonitor.on("suspend", () => {
    broadcastPowerEvent("suspend");
  });
});
app.on("before-quit", () => {
  if (wakeRecoveryTimer) {
    clearTimeout(wakeRecoveryTimer);
    wakeRecoveryTimer = null;
  }
  terminateMediaWorker();
  closeAllDbs();
  stopSam3Server();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
