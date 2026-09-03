var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { BrowserWindow, screen, ipcMain, app, shell, safeStorage, session, dialog, protocol, nativeImage, powerMonitor } from "electron";
import fs$1, { writeFile, chmod, mkdir } from "node:fs/promises";
import fs, { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path, { join } from "node:path";
import os, { homedir } from "node:os";
import crypto$1, { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { lookup } from "node:dns/promises";
import { request as request$2 } from "node:https";
import net, { isIP } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "worker_threads";
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
function indexPath$2() {
  return path.join(projectsRoot$1(), "projects.json");
}
function projectDir$2(id) {
  return path.join(projectsRoot$1(), id);
}
function projectPath(id) {
  return path.join(projectDir$2(id), "project.json");
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
    const raw = await fs$1.readFile(indexPath$2(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}
async function writeIndex$1(index) {
  await ensureRoot();
  const tmp = indexPath$2() + ".tmp";
  await fs$1.writeFile(tmp, JSON.stringify(index, null, 2), "utf-8");
  await fs$1.rename(tmp, indexPath$2());
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
    elements: [],
    director: {
      sourceText: "",
      clipLengthSec: 20,
      stylePrefix: "",
      aspectRatio: "16:9",
      adapterId: "topview-auto",
      resolution: "720p",
      generateAudio: true,
      genre: "auto",
      mode: "source",
      breakdown: [],
      breakdownApproved: false,
      scenes: [],
      clips: [],
      jobStatus: null
    }
  };
}
function resolveLegacyThumbnail(projectId) {
  const jsonPath = path.join(projectDir$2(projectId), "project.json");
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
  const dbPath = path.join(projectDir$2(projectId), "project.db");
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
    await fs$1.mkdir(projectDir$2(id), { recursive: true });
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
    await fs$1.rm(projectDir$2(id), { recursive: true, force: true });
    const index = await readIndex$1();
    index.projects = index.projects.filter((p) => p.id !== id);
    await writeIndex$1(index);
  });
}
const INVOKE_TIMEOUT_MS = 12e4;
const DISCOVERY_DIR = join(homedir(), "Documents", "CINEGEN");
const DISCOVERY_FILE = join(DISCOVERY_DIR, "mcp-bridge.json");
const pending = /* @__PURE__ */ new Map();
let workspaceReady = false;
let server = null;
let token = "";
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4e6) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function invokeRenderer(win, tool, args) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CineGen did not answer "${tool}" within ${Math.round(INVOKE_TIMEOUT_MS / 1e3)}s.`));
    }, INVOKE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send("mcp:invoke", { id, tool, args });
  });
}
function registerMcpBridge(getWindow) {
  ipcMain.on("mcp:ready", (_event, ready) => {
    workspaceReady = Boolean(ready);
  });
  ipcMain.on("mcp:result", (_event, payload) => {
    const entry = (payload == null ? void 0 : payload.id) ? pending.get(payload.id) : void 0;
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(payload.id);
    if (payload.ok) entry.resolve(payload.result);
    else entry.reject(new Error(payload.error || "The tool failed."));
  });
  ipcMain.handle("mcp:status", () => {
    var _a;
    return {
      running: Boolean(server),
      workspaceReady,
      port: server ? ((_a = server.address()) == null ? void 0 : _a.port) ?? 0 : 0,
      discoveryFile: DISCOVERY_FILE
    };
  });
  token = randomBytes(24).toString("hex");
  server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method === "GET" && url.pathname === "/health") {
          json(res, 200, { ok: true, app: "CineGen", appReady: Boolean(getWindow()) });
          return;
        }
        const provided = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        if (provided.length !== token.length || provided !== token) {
          json(res, 401, { ok: false, error: "Bad or missing bridge token." });
          return;
        }
        if (req.method === "POST" && url.pathname === "/invoke") {
          const body = await readBody(req);
          const tool = typeof (body == null ? void 0 : body.tool) === "string" ? body.tool : "";
          if (!tool) {
            json(res, 400, { ok: false, error: "No tool named." });
            return;
          }
          const win = getWindow();
          if (!win || win.isDestroyed()) {
            json(res, 503, { ok: false, error: "CineGen has no open window. Open the app and try again." });
            return;
          }
          if (!workspaceReady) {
            json(res, 200, { ok: false, error: "No CineGen project is open. Open a project in the app, then try again." });
            return;
          }
          try {
            json(res, 200, { ok: true, result: await invokeRenderer(win, tool, body.args ?? {}) });
          } catch (error) {
            json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        json(res, 404, { ok: false, error: "Unknown path." });
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
  server.listen(0, "127.0.0.1", () => {
    var _a;
    const port = ((_a = server == null ? void 0 : server.address()) == null ? void 0 : _a.port) ?? 0;
    try {
      mkdirSync(DISCOVERY_DIR, { recursive: true });
      writeFileSync(
        DISCOVERY_FILE,
        `${JSON.stringify({ port, token, pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)}
`,
        { mode: 384 }
      );
      console.log(`[mcp-bridge] listening on 127.0.0.1:${port}`);
    } catch (error) {
      console.error("[mcp-bridge] could not publish the discovery file:", error);
    }
  });
  server.on("error", (error) => {
    console.error("[mcp-bridge] server error:", error);
  });
}
function stopMcpBridge() {
  workspaceReady = false;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("CineGen is closing."));
  }
  pending.clear();
  server == null ? void 0 : server.close();
  server = null;
  try {
    rmSync(DISCOVERY_FILE, { force: true });
  } catch {
  }
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
  utils.sleep = sleep2;
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
  function sleep2(ms) {
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
var request$1 = {};
var hasRequiredRequest;
function requireRequest() {
  if (hasRequiredRequest) return request$1;
  hasRequiredRequest = 1;
  var __awaiter = request$1 && request$1.__awaiter || function(thisArg, _arguments, P, generator) {
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
  var __rest = request$1 && request$1.__rest || function(s, e) {
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
  Object.defineProperty(request$1, "__esModule", { value: true });
  request$1.dispatchRequest = dispatchRequest;
  request$1.buildUrl = buildUrl;
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
  return request$1;
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
        const token2 = yield (0, request_1.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, config_1.getRestApiUrl)()}/tokens/`,
          config: config2,
          input: {
            allowed_apps: [appId.alias],
            token_expiration: exports$1.TOKEN_EXPIRATION_SECONDS
          }
        });
        if (typeof token2 !== "string" && token2["detail"]) {
          return token2["detail"];
        }
        return token2;
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
            const token2 = yield fetchToken();
            const { fetch: fetch2 } = this.config;
            const parsedUrl = new URL(this.url);
            parsedUrl.searchParams.set("fal_jwt_token", token2);
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
function utf8Count(str2) {
  const strLength = str2.length;
  let byteLength = 0;
  let pos = 0;
  while (pos < strLength) {
    let value = str2.charCodeAt(pos++);
    if ((value & 4294967168) === 0) {
      byteLength++;
      continue;
    } else if ((value & 4294965248) === 0) {
      byteLength += 2;
    } else {
      if (value >= 55296 && value <= 56319) {
        if (pos < strLength) {
          const extra = str2.charCodeAt(pos);
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
function utf8EncodeJs(str2, output, outputOffset) {
  const strLength = str2.length;
  let offset = outputOffset;
  let pos = 0;
  while (pos < strLength) {
    let value = str2.charCodeAt(pos++);
    if ((value & 4294967168) === 0) {
      output[offset++] = value;
      continue;
    } else if ((value & 4294965248) === 0) {
      output[offset++] = value >> 6 & 31 | 192;
    } else {
      if (value >= 55296 && value <= 56319) {
        if (pos < strLength) {
          const extra = str2.charCodeAt(pos);
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
function utf8EncodeTE(str2, output, outputOffset) {
  sharedTextEncoder.encodeInto(str2, output.subarray(outputOffset));
}
function utf8Encode(str2, output, outputOffset) {
  if (str2.length > TEXT_ENCODER_THRESHOLD) {
    utf8EncodeTE(str2, output, outputOffset);
  } else {
    utf8EncodeJs(str2, output, outputOffset);
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
    const str2 = utf8DecodeJs(bytes, inputOffset, byteLength);
    const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
    this.store(slicedCopyOfBytes, str2);
    return str2;
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
  function buildRealtimeUrl(app2, { token: token2, maxBuffering, path: path2 }) {
    var _a;
    if (maxBuffering !== void 0 && (maxBuffering < 1 || maxBuffering > 60)) {
      throw new Error("The `maxBuffering` must be between 1 and 60 (inclusive)");
    }
    const queryParams = new URLSearchParams({
      fal_jwt_token: token2
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
          const { enqueuedMessage, token: token2, websocket } = context;
          latestEnqueuedMessage = enqueuedMessage;
          if (machine2.current === "active" && enqueuedMessage && (websocket === null || websocket === void 0 ? void 0 : websocket.readyState) === WebSocket.OPEN) {
            send2({ type: "send", message: enqueuedMessage });
          }
          if (machine2.current === "authRequired" && token2 === void 0 && previousState !== machine2.current) {
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
            fetchToken().then((token3) => {
              queueMicrotask(() => {
                send2({ type: "authenticated", token: token3 });
              });
              scheduleTokenRefresh();
            }).catch((error) => {
              queueMicrotask(() => {
                send2({ type: "unauthorized", error });
              });
            });
          }
          if (machine2.current === "connecting" && previousState !== machine2.current && token2 !== void 0) {
            const ws = new WebSocket(buildRealtimeUrl(app2, { token: token2, maxBuffering, path: path2 }));
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
const models = /* @__PURE__ */ JSON.parse('[{"display_name":"3D Rigging","job_set_type":"3d_rigging","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height_meters","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true}]},{"display_name":"Brain Activity","job_set_type":"brain_activity","type":"text","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Bytedance Image Upscale","job_set_type":"bytedance_image_upscale","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"4k","required":false,"enum":["2k","4k"]}]},{"display_name":"Bytedance Video Upscale","job_set_type":"bytedance_video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"fps","type":"integer","default":24,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"model_version","type":"string","default":"standard","required":false,"enum":["standard","pro"]},{"name":"preset","type":"string","default":"common","required":false,"enum":["common","aigc","short_series","ugc","old_film"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1080p","2k","4k"]}]},{"display_name":"Cinematic Studio 2.5","job_set_type":"cinematic_studio_2_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"auto","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio 3.0","job_set_type":"cinematic_studio_3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Cinematic Studio Image","job_set_type":"cinematic_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"string","default":null,"required":true},{"name":"camera_lens_id","type":"string","default":null,"required":true},{"name":"camera_model_id","type":"string","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio Soul Cast","job_set_type":"cinematic_studio_soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinematic Studio Soul Location","job_set_type":"cinematic_studio_soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Cinematic Studio Video","job_set_type":"cinematic_studio_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"slow_motion","type":"boolean","default":false,"required":false},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Cinematic Studio Video 3.5","job_set_type":"cinematic_studio_video_3_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"camera_style","type":"object","default":null,"required":false},{"name":"color_grading","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"light_scheme","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"style_id","type":"object","default":null,"required":false},{"name":"style_prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinema Studio 4.0","job_set_type":"cinematic_studio_video_4_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"color_palette","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"era_id","type":"object","default":null,"required":false},{"name":"extension_mode","type":"object","default":null,"required":false},{"name":"film_era","type":"null","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"null","default":null,"required":false},{"name":"genre_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"light","type":"object","default":null,"required":false},{"name":"light_custom","type":"object","default":null,"required":false},{"name":"light_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"model","type":"string","default":"default","required":false,"enum":["default","video_edit","video_extension"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"pacing_id","type":"object","default":null,"required":false},{"name":"preset_id","type":"null","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"speedramp","type":"object","default":"auto","required":false},{"name":"use_blur","type":"boolean","default":false,"required":false},{"name":"use_eye_mask","type":"boolean","default":false,"required":false},{"name":"use_transparency","type":"boolean","default":false,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Cinematic Studio Video V2","job_set_type":"cinematic_studio_video_v2","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"cfg_scale","type":"number","default":0.5,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","western","suspense","intimate","spectacle"]},{"name":"kling_element_ids","type":"array","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Clipify","job_set_type":"clipify","type":"video","params":[{"name":"clip_aspect","type":"string","default":"9:16","required":false,"enum":["9:16","1:1","16:9"]},{"name":"clips_num","type":"integer","default":10,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"max_height","type":"integer","default":1080,"required":false},{"name":"segment_seconds","type":"integer","default":10,"required":false},{"name":"subtitle_case","type":"string","default":"as-is","required":false,"enum":["lower","upper","as-is"]},{"name":"subtitle_font","type":"string","default":"notosans","required":false},{"name":"subtitle_highlight_hex","type":"string","default":"#FFE84D","required":false},{"name":"subtitle_position","type":"string","default":"bottom","required":false,"enum":["bottom","center","top"]},{"name":"track_face_crop","type":"boolean","default":true,"required":false},{"name":"urls","type":"array","default":null,"required":true}]},{"display_name":"Draw To Video","job_set_type":"draw_to_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"ref_image","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"sketch","type":"object","default":null,"required":true},{"name":"video","type":"object","default":null,"required":true}]},{"display_name":"dubbing","job_set_type":"dubbing","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"target_language","type":"string","default":null,"required":true,"enum":["eng","cmn","fra","hin","ita","jpn","kor","por","rus","tur","spa","deu","ara","pol","ind","fil","swe","fin"]}]},{"display_name":"Explainer Video","job_set_type":"explainer_video","type":"video","params":[{"name":"height","type":"integer","default":null,"required":true},{"name":"items","type":"array","default":null,"required":true},{"name":"subtitles","type":"object","default":null,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"FLUX.2","job_set_type":"flux_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"pro","required":false,"enum":["pro","flex","max"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"FLUX.2 Pro Outpaint","job_set_type":"flux_2_pro_outpaint","type":"image","params":[{"name":"expand_bottom","type":"integer","default":0,"required":false},{"name":"expand_left","type":"integer","default":0,"required":false},{"name":"expand_right","type":"integer","default":0,"required":false},{"name":"expand_top","type":"integer","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"FLUX 3 Video","job_set_type":"flux_3_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Flux Kontext","job_set_type":"flux_kontext","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Gemini Omni Flash","job_set_type":"gemini_omni","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"integer","default":8,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false}]},{"display_name":"GPT Image 2","job_set_type":"gpt_image_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"high","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Grok Image","job_set_type":"grok_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","1:2","2:1","3:2","2:3","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","quality"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Grok Video","job_set_type":"grok_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Grok Video 1.5","job_set_type":"grok_video_v15","type":"video","params":[{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Happy Horse Video","job_set_type":"happy_horse_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Hunyuan 3D v3.1 Text to 3D","job_set_type":"hunyuan3d_v3_1_text_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Hunyuan3D v3 Image to 3D","job_set_type":"hunyuan3d_v3_image_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"integer","default":500000,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"string","default":"Normal","required":false,"enum":["Normal","LowPoly","Geometry"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"polygon_type","type":"string","default":"triangle","required":false,"enum":["triangle","quadrilateral"]}]},{"display_name":"Image Auto","job_set_type":"image_auto","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Image Background Remover","job_set_type":"image_background_remover","type":"image","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Image Decompose","job_set_type":"image_decompose","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"granular","required":false,"enum":["granular","standard"]}]},{"display_name":"Image to 3D","job_set_type":"image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Inworld Text to Speech","job_set_type":"inworld_text_to_speech","type":"audio","params":[{"name":"prompt","type":"string","default":null,"required":true},{"name":"voice","type":"string","default":null,"required":true}]},{"display_name":"Kimodo","job_set_type":"kimodo","type":"3d","params":[{"name":"diffusion_steps","type":"integer","default":10,"required":false},{"name":"duration","type":"object","default":null,"required":false},{"name":"durations","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_version","type":"string","default":"ardy-core","required":false,"enum":["ardy-core","ardy-core-h8"]},{"name":"prompt","type":"object","default":null,"required":false},{"name":"prompts","type":"object","default":null,"required":false},{"name":"seed","type":"integer","default":42,"required":false}]},{"display_name":"Kling O1 Image","job_set_type":"kling_omni_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","auto","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Kling 2.6 Video","job_set_type":"kling2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Kling v3.0","job_set_type":"kling3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std","4k"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]}]},{"display_name":"Kling 3.0 Motion Control","job_set_type":"kling3_0_motion_control","type":"video","params":[{"name":"background_source","type":"string","default":"input_image","required":false,"enum":["input_image","input_video"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","pro"]}]},{"display_name":"Kling 3.0 Turbo","job_set_type":"kling3_0_turbo","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"LLM Generation","job_set_type":"llm_text","type":"video","params":[{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":null,"required":true},{"name":"reasoning_effort","type":"object","default":null,"required":false},{"name":"system_prompt","type":"string","default":"","required":false},{"name":"user_prompt","type":"string","default":"","required":false}]},{"display_name":"Marketing Studio Image","job_set_type":"marketing_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Marketing Studio Video","job_set_type":"marketing_studio_video","type":"video","params":[{"name":"ad_reference_id","type":"object","default":null,"required":false},{"name":"aspect_ratio","type":"string","default":"9:16","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"avatar_ids","type":"array","default":null,"required":false},{"name":"avatars","type":"array","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"hook_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"ugc","required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"setting_id","type":"object","default":null,"required":false},{"name":"specific_mode","type":"string","default":"default","required":false,"enum":["default","web_product","from_storyboard"]},{"name":"storyboard_id","type":"object","default":null,"required":false},{"name":"web_product_ids","type":"array","default":null,"required":false},{"name":"web_product_type","type":"object","default":null,"required":false}]},{"display_name":"Meshy 5 Remesh","job_set_type":"meshy_v5_remesh","type":"3d","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true},{"name":"origin_at","type":"object","default":null,"required":false},{"name":"resize_height","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Meshy 6 Text to 3D","job_set_type":"meshy_v6_text_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"enable_prompt_expansion","type":"boolean","default":false,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"full","required":false},{"name":"model_type","type":"string","default":"standard","required":false},{"name":"pose_mode","type":"string","default":"","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"boolean","default":true,"required":false},{"name":"symmetry_mode","type":"string","default":"auto","required":false},{"name":"target_polycount","type":"integer","default":30000,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"string","default":"triangle","required":false}]},{"display_name":"MiniMax H3","job_set_type":"minimax_h3","type":"video","params":[{"name":"aigc_watermark","type":"boolean","default":false,"required":false},{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":4,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"resolution","type":"string","default":"2K","required":false,"enum":["768P","2K"]},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Minimax Hailuo","job_set_type":"minimax_hailuo","type":"video","params":[{"name":"duration","type":"string","default":6,"required":false,"enum":["6","10"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"minimax-2.3","required":false,"enum":["minimax","minimax-fast","minimax-2.3","minimax-2.3-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"768","required":false,"enum":["512","768","1080"]}]},{"display_name":"Mirelo Text to Audio","job_set_type":"mirelo_text_to_audio","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"MS Image","job_set_type":"ms_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"avatars","type":"array","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"brand_kit_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"low","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Multi-Image to 3D","job_set_type":"multi_image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Nano Banana","job_set_type":"nano_banana","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_ai_stylist","type":"image","params":[{"name":"background_preset_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"outfit_preset_ids","type":"array","default":null,"required":false},{"name":"pose_preset_id","type":"object","default":null,"required":false},{"name":"user_outfit_ids","type":"array","default":null,"required":false}]},{"display_name":"Nano Banana 2 Lite","job_set_type":"nano_banana_2_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"thinking","type":"string","default":"HIGH","required":false,"enum":["MINIMAL","HIGH"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_relight","type":"image","params":[{"name":"brightness","type":"integer","default":null,"required":true},{"name":"color","type":"string","default":null,"required":true},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"light_quality","type":"string","default":null,"required":true,"enum":["hard","sharp","soft"]},{"name":"light_source","type":"string","default":null,"required":true,"enum":["mdl","mdr","mul","mur","bml","fml","fmr","bmm","mml","mmr","fmm","bmr","mdm","mum","bdr","fdl","bur","ful","bdl","fdr","bul","fur","bdm","fdm","bum","fum"]},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_shots","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_skin_enhancer","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"preset_id","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana 2","job_set_type":"nano_banana_flash","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"OpenAI Hazel","job_set_type":"openai_hazel","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","auto"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"medium","required":false,"enum":["low","medium","high"]}]},{"display_name":"Outpaint","job_set_type":"outpaint","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"21:9","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Qwen Audio 3.0 TTS Flash","job_set_type":"qwen_audio_tts","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"instruction","type":"object","default":null,"required":false},{"name":"language","type":"object","default":null,"required":false},{"name":"pitch_rate","type":"number","default":1,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","22050","24000","44100","48000"]},{"name":"seed","type":"integer","default":0,"required":false},{"name":"speech_rate","type":"number","default":1,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"integer","default":50,"required":false}]},{"display_name":"Angles","job_set_type":"qwen_camera_control","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"move_forward_level","type":"integer","default":0,"required":false},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"rotate_degree","type":"integer","default":0,"required":false},{"name":"vertical_angle","type":"integer","default":0,"required":false},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Recraft V4.1","job_set_type":"recraft_v4_1","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:4","4:3","4:5","5:4","3:2","2:3","16:9","9:16","21:9"]},{"name":"background_color","type":"object","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"colors","type":"array","default":null,"required":false},{"name":"model_type","type":"string","default":"standard","required":false,"enum":["standard","vector","utility","utility_vector"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Reframe","job_set_type":"reframe","type":"video","params":[{"name":"aspect_ratio","type":"string","default":null,"required":true,"enum":["21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"3D Objects","job_set_type":"sam_3_3d","type":"3d","params":[{"name":"detection_threshold","type":"object","default":null,"required":false},{"name":"export_textured_glb","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"3D Body","job_set_type":"sam_3_3d_body","type":"3d","params":[{"name":"export_meshes","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"include_3d_keypoints","type":"boolean","default":true,"required":false},{"name":"include_mhr_params","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Remove Background","job_set_type":"sam_3_video","type":"video","params":[{"name":"apply_mask","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false}]},{"display_name":"Seed Audio 1.0","job_set_type":"seed_audio","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"expression_intensity","type":"integer","default":5,"required":false},{"name":"format","type":"string","default":"wav","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"loudness_rate","type":"integer","default":0,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mood","type":"number","default":0,"required":false},{"name":"pitch_rate","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","24000","32000","44100","48000"]},{"name":"speech_rate","type":"integer","default":0,"required":false},{"name":"voice_id","type":"object","default":null,"required":false},{"name":"voice_style","type":"object","default":null,"required":false},{"name":"voice_type","type":"object","default":null,"required":false},{"name":"voices","type":"array","default":null,"required":false}]},{"display_name":"Seedance 2.0","job_set_type":"seedance_2_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]}]},{"display_name":"Seedance 2.0 Mini","job_set_type":"seedance_2_0_mini","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p"]}]},{"display_name":"Seedance 2.5","job_set_type":"seedance_2_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"audio_references","type":"array","default":null,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"end_image","type":"object","default":null,"required":false},{"name":"extension_mode","type":"string","default":null,"required":false,"enum":["backward","forward"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"image_references","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"t2v","required":false,"enum":["t2v","omni_reference","video_edit","video_extension"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"start_image","type":"object","default":null,"required":false},{"name":"video_references","type":"array","default":null,"required":false}]},{"display_name":"Seedance 1.5 Pro","job_set_type":"seedance1_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"duration","type":"string","default":4,"required":false,"enum":["4","8","12"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Seedream 4.5","job_set_type":"seedream_v4_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","4:3","16:9","3:2","21:9","3:4","9:16","2:3"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Lite","job_set_type":"seedream_v5_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Pro","job_set_type":"seedream_v5_pro","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"height","type":"object","default":null,"required":false},{"name":"is_inpaint","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","1.5k","2k"]},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Sonilo Music","job_set_type":"sonilo_music","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Soul Cast","job_set_type":"soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"soul_cinema_studio","job_set_type":"soul_cinema_studio","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Soul Cinematic","job_set_type":"soul_cinematic","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]}]},{"display_name":"Soul Location","job_set_type":"soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Sync Lipsync 3","job_set_type":"sync_so","type":"video","params":[{"name":"active_speaker_detection","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_audio","type":"object","default":null,"required":true},{"name":"input_video","type":"object","default":null,"required":true},{"name":"occlusion_detection_enabled","type":"boolean","default":false,"required":false},{"name":"sync_mode","type":"string","default":"bounce","required":false,"enum":["bounce","loop","cut_off","silence","remap"]},{"name":"temperature","type":"number","default":0.5,"required":false}]},{"display_name":"Higgsfield Soul 2.0","job_set_type":"text2image_soul_v2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"Text to Speech V2","job_set_type":"text2speech_v2","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"emotion","type":"object","default":null,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["mp3","wav"]},{"name":"language_boost","type":"string","default":"auto","required":false,"enum":["auto","af","ar","bg","ca","cs","da","de","el","en","es","fa","fi","fil","fr","he","hi","hr","hu","id","it","ja","ko","ms","nl","nn","no","pl","pt","ro","ru","sk","sl","sv","ta","th","tr","uk","vi","yue","zh"]},{"name":"model","type":"string","default":null,"required":true,"enum":["elevenlabs","minimax","seed_speech","vibe_voice","cozy_voice"]},{"name":"pitch","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":32000,"required":false,"enum":["8000","16000","22050","24000","32000","44100"]},{"name":"speed","type":"number","default":1,"required":false},{"name":"stability","type":"object","default":null,"required":false},{"name":"text_normalization","type":"boolean","default":false,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"number","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image","type":"image","params":[{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Standard V2","required":false,"enum":["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"sharpen","type":"number","default":0,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image_generative","type":"image","params":[{"name":"autoprompt","type":"boolean","default":true,"required":false},{"name":"creativity","type":"integer","default":1,"required":false},{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Redefine","required":false,"enum":["Standard MAX","Redefine","Recovery","Recovery V2"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"sharpen","type":"number","default":0,"required":false},{"name":"texture","type":"integer","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancement","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frame_interpolation","type":"object","default":null,"required":false},{"name":"frame_rate","type":"number","default":30,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"input_height","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":false},{"name":"input_video_size","type":"integer","default":0,"required":false},{"name":"input_width","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"1080p","required":false,"enum":["1080p","2160p"]}]},{"display_name":"Text to 3D","job_set_type":"tripo_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"negative_prompt","type":"object","default":null,"required":false},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]}]},{"display_name":"Tripo H3.1 Image to 3D","job_set_type":"tripo_h3_1_image_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Tripo H3.1 Multiview to 3D","job_set_type":"tripo_h3_1_multiview_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Google Veo 3","job_set_type":"veo3","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"veo-3-fast","required":false,"enum":["veo-3-preview","veo-3-fast"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Google Veo 3.1","job_set_type":"veo3_1","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"model","type":"string","default":"veo-3-1-fast","required":false,"enum":["veo-3-1-preview","veo-3-1-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high","ultra"]}]},{"display_name":"Google Veo 3.1 Lite","job_set_type":"veo3_1_lite","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","auto"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Video Background Remover","job_set_type":"video_background_remover","type":"video","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Video Deflicker","job_set_type":"video_deflicker","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"Video Upscale","job_set_type":"video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"voice_change","job_set_type":"voice_change","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":"preset","required":false,"enum":["preset","element"]}]},{"display_name":"Wan 2.6 Video","job_set_type":"wan2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10","15"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 2.7","job_set_type":"wan2_7","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 3.0","job_set_type":"wan3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enable_thinking","type":"boolean","default":false,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Z Image","job_set_type":"z_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"prompt","type":"string","default":null,"required":true}]}]');
const catalogJson = {
  models
};
const HIGGSFIELD_CATALOG = catalogJson;
const HIGGSFIELD_MODEL_SCHEMAS = HIGGSFIELD_CATALOG.models;
const LEGACY_NODE_TYPES = {
  text2image_soul_v2: "hf-soul-v2",
  nano_banana_2: "hf-nano-banana-pro",
  gpt_image_2: "hf-gpt-image-2",
  seedance_2_0: "hf-seedance-2",
  kling3_0: "hf-kling-3",
  veo3_1: "hf-veo-3-1"
};
const SINGLE_IMAGE_PARAMS = /* @__PURE__ */ new Set([
  "input_image",
  "ref_image",
  "sketch",
  "texture_image_url"
]);
const MULTI_IMAGE_PARAMS = /* @__PURE__ */ new Set(["input_images"]);
const SINGLE_VIDEO_PARAMS = /* @__PURE__ */ new Set(["input_video", "video"]);
const SINGLE_AUDIO_PARAMS = /* @__PURE__ */ new Set(["input_audio"]);
function humanize(value) {
  return value.split(/[_-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function nodeTypeFor(modelId) {
  return LEGACY_NODE_TYPES[modelId] ?? `hf-${modelId.replaceAll("_", "-")}`;
}
function outputTypeFor(type) {
  return type === "3d" ? "model3d" : type;
}
function mediaFieldFor(model, param) {
  let portType;
  let mediaRole;
  let multiple = false;
  if (SINGLE_IMAGE_PARAMS.has(param.name)) {
    portType = "image";
    mediaRole = model.type === "video" && param.name === "input_image" ? "start_image" : "image";
  } else if (MULTI_IMAGE_PARAMS.has(param.name)) {
    portType = "image";
    mediaRole = "image";
    multiple = true;
  } else if (SINGLE_VIDEO_PARAMS.has(param.name)) {
    portType = "video";
    mediaRole = "video";
  } else if (SINGLE_AUDIO_PARAMS.has(param.name)) {
    portType = "audio";
    mediaRole = "audio";
  } else if (param.name === "model_url") {
    portType = "model3d";
  } else if (param.name === "urls") {
    portType = "media";
    multiple = true;
  } else if (param.name === "medias") {
    multiple = true;
    if (model.type === "image" || model.type === "3d") {
      portType = "image";
      mediaRole = "image";
    } else if (model.type === "text") {
      portType = "video";
      mediaRole = "video";
    } else {
      portType = "media";
    }
  }
  if (!portType) return void 0;
  return {
    id: param.name,
    portType,
    label: humanize(param.name),
    required: param.required,
    falParam: param.name,
    fieldType: "port",
    schemaType: param.type,
    multiple,
    mediaRole,
    ...param.default !== void 0 ? { default: param.default } : {}
  };
}
function inputFieldFor(model, param) {
  var _a;
  const mediaField = mediaFieldFor(model, param);
  if (mediaField) return mediaField;
  const base = {
    id: param.name,
    portType: "config",
    label: humanize(param.name),
    required: param.required,
    falParam: param.name,
    schemaType: param.type,
    ...param.default !== void 0 ? { default: param.default } : {}
  };
  if (param.type === "string") {
    if ((_a = param.enum) == null ? void 0 : _a.length) {
      return {
        ...base,
        portType: "text",
        fieldType: "select",
        options: param.enum.map((value) => ({ value, label: value }))
      };
    }
    if (/(^|_)prompt$/.test(param.name) || param.name === "instruction") {
      return { ...base, portType: "text", fieldType: "port" };
    }
    return { ...base, portType: "text", fieldType: "text" };
  }
  if (param.type === "integer" || param.type === "number") {
    return { ...base, portType: "number", fieldType: "number" };
  }
  if (param.type === "boolean") {
    return { ...base, fieldType: "toggle" };
  }
  return {
    ...base,
    fieldType: "json",
    placeholder: param.type === "array" ? "[]" : param.type === "object" ? "{}" : "null"
  };
}
function customizeWorkflowField(model, field) {
  var _a, _b, _c, _d, _e;
  if (model.job_set_type !== "seedance_2_5") return field;
  if (field.id === "aspect_ratio") {
    const labels = {
      auto: "Match reference",
      "21:9": "Cinematic (21:9)",
      "16:9": "Widescreen (16:9)",
      "4:3": "Classic (4:3)",
      "1:1": "Square (1:1)",
      "3:4": "Portrait (3:4)",
      "9:16": "Vertical (9:16)"
    };
    return {
      ...field,
      description: "Shape of the generated video.",
      options: (_a = field.options) == null ? void 0 : _a.map((option) => ({ ...option, label: labels[option.value] ?? option.label }))
    };
  }
  if (field.id === "duration") {
    return {
      ...field,
      fieldType: "range",
      min: 5,
      max: 30,
      step: 1,
      description: "Length of the generated clip."
    };
  }
  if (field.id === "resolution") {
    const labels = {
      "480p": "480p · Draft",
      "720p": "720p · HD",
      "1080p": "1080p · Full HD"
    };
    return {
      ...field,
      description: "Higher resolution takes longer and may cost more.",
      options: (_b = field.options) == null ? void 0 : _b.map((option) => ({ ...option, label: labels[option.value] ?? option.label }))
    };
  }
  if (field.id === "generate_audio") {
    return { ...field, label: "Generate audio", description: "Create synchronized sound with the video." };
  }
  if (field.id === "bitrate_mode") {
    const labels = {
      standard: "Standard · Smaller file",
      high: "High · Best quality"
    };
    return {
      ...field,
      label: "Quality",
      description: "High quality uses more processing and creates a larger file.",
      options: (_c = field.options) == null ? void 0 : _c.map((option) => ({ ...option, label: labels[option.value] ?? option.label }))
    };
  }
  if (field.id === "mode") {
    const labels = {
      t2v: "Auto (recommended)",
      omni_reference: "Reference images",
      video_edit: "Edit a video",
      video_extension: "Extend a video"
    };
    return {
      ...field,
      label: "Generation mode",
      description: "Auto switches modes when something is connected to References.",
      options: (_d = field.options) == null ? void 0 : _d.map((option) => ({ ...option, label: labels[option.value] ?? option.label }))
    };
  }
  if (field.id === "extension_mode") {
    return {
      ...field,
      label: "Extension direction",
      description: "Choose which side of the connected video to extend.",
      options: (_e = field.options) == null ? void 0 : _e.map((option) => ({
        ...option,
        label: option.value === "forward" ? "Continue forward" : "Build backward"
      }))
    };
  }
  return field;
}
function compatibilityMediaFieldsFor(model, param) {
  const make = (id, label, portType, mediaRole, multiple = false) => ({
    id,
    portType,
    label,
    required: false,
    falParam: param.name,
    fieldType: "port",
    schemaType: param.type,
    mediaRole,
    multiple
  });
  if (model.job_set_type === "text2image_soul_v2" && param.name === "medias") {
    return [make("image_url", "Reference Image", "image", "image")];
  }
  if (model.job_set_type === "nano_banana_2" && param.name === "input_images") {
    return [make("image_url", "Reference Images", "image", "image", true)];
  }
  if (model.job_set_type === "gpt_image_2" && param.name === "medias") {
    return [make("image_url", "Reference Images", "image", "image", true)];
  }
  if (model.job_set_type === "seedance_2_0" && param.name === "medias") {
    return [
      make("start_image_url", "First Frame", "image", "start_image"),
      make("end_image_url", "Last Frame", "image", "end_image"),
      make("image_references", "Image References", "image", "image", true),
      make("video_references", "Video References", "video", "video", true),
      make("audio_references", "Audio References", "audio", "audio", true)
    ];
  }
  if (model.job_set_type === "kling3_0" && param.name === "medias") {
    return [
      make("start_image_url", "First Frame", "image", "start_image"),
      make("end_image_url", "Last Frame", "image", "end_image")
    ];
  }
  if (model.job_set_type === "veo3_1" && param.name === "input_image") {
    return [make("start_image_url", "First Frame", "image", "start_image")];
  }
  return [];
}
const PROMPT_FIELD_PRIORITY = ["prompt", "user_prompt", "instruction"];
function promotePromptFirst(inputs) {
  for (const id of PROMPT_FIELD_PRIORITY) {
    const index = inputs.findIndex((field) => field.id === id);
    if (index > 0) return [inputs[index], ...inputs.slice(0, index), ...inputs.slice(index + 1)];
    if (index === 0) return inputs;
  }
  return inputs;
}
function workflowCompatibilityFieldsFor(model) {
  if (model.job_set_type !== "seedance_2_5") return [];
  return [{
    id: "medias",
    portType: "media",
    label: "References",
    required: false,
    falParam: "medias",
    fieldType: "port",
    schemaType: "array",
    multiple: true
  }];
}
function buildHiggsfieldModelRegistry(schemas = HIGGSFIELD_MODEL_SCHEMAS) {
  const registry = {};
  for (const model of schemas) {
    const nodeType = nodeTypeFor(model.job_set_type);
    const outputType = outputTypeFor(model.type);
    if (registry[nodeType]) throw new Error(`Duplicate Higgsfield node type: ${nodeType}`);
    const schemaInputs = promotePromptFirst(model.params.flatMap((param) => [
      customizeWorkflowField(model, inputFieldFor(model, param)),
      ...compatibilityMediaFieldsFor(model, param)
    ]));
    const promptEnd = schemaInputs.findIndex((field) => field.id === "prompt") + 1;
    schemaInputs.splice(promptEnd, 0, ...workflowCompatibilityFieldsFor(model));
    registry[nodeType] = {
      id: model.job_set_type,
      nodeType,
      name: model.display_name,
      category: outputType,
      description: `Higgsfield ${model.type.toUpperCase()} model`,
      inputs: schemaInputs,
      outputType,
      outputs: [{ id: outputType, portType: outputType, label: outputType === "model3d" ? "3D Model" : humanize(outputType) }],
      provider: "higgsfield",
      responseMapping: { path: outputType === "text" ? "text" : "output.url" }
    };
  }
  return registry;
}
const HIGGSFIELD_MODEL_REGISTRY = buildHiggsfieldModelRegistry();
function pickKnownHiggsfieldParams(modelId, params, schemas = HIGGSFIELD_MODEL_SCHEMAS) {
  if (!params) return params;
  const schema = schemas.find((model) => model.job_set_type === modelId);
  if (!schema) return params;
  const known = new Set(schema.params.map((param) => param.name));
  const next = {};
  for (const [key, value] of Object.entries(params)) {
    if (known.has(key)) next[key] = value;
  }
  return next;
}
const MEDIA_ROLE_FLAG = {
  image: "--image",
  start_image: "--start-image",
  end_image: "--end-image",
  video: "--video",
  audio: "--audio"
};
const PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED_PARAM_NAMES = /* @__PURE__ */ new Set(["json", "wait", "no_color"]);
function buildCreateArgs(params) {
  const args = ["generate", "create", params.model];
  const genericParams = {
    ...pickKnownHiggsfieldParams(params.model, { ...params.extra, ...params.params }) ?? {}
  };
  const appendParam = (name2, value) => {
    if (value === void 0 || value === null) return;
    if (!PARAM_NAME_PATTERN.test(name2) || RESERVED_PARAM_NAMES.has(name2)) {
      throw new Error(`Invalid Higgsfield parameter name: ${name2}`);
    }
    let serialized;
    if (typeof value === "string") {
      serialized = name2 === "prompt" ? value.trim() : value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`Higgsfield parameter ${name2} must be finite`);
      serialized = String(value);
    } else if (typeof value === "boolean") {
      serialized = value ? "true" : "false";
    } else if (typeof value === "object") {
      try {
        const json2 = JSON.stringify(value);
        if (json2 === void 0) throw new Error("not JSON serializable");
        serialized = json2;
      } catch (error) {
        throw new Error(`Higgsfield parameter ${name2} must be JSON serializable`, { cause: error });
      }
    } else {
      throw new Error(`Higgsfield parameter ${name2} has an unsupported value type`);
    }
    args.push(`--${name2}`, serialized);
  };
  const prompt = params.prompt !== void 0 ? params.prompt : genericParams.prompt;
  delete genericParams.prompt;
  appendParam("prompt", prompt);
  for (const media of params.medias ?? []) {
    if (!media.value) continue;
    args.push(MEDIA_ROLE_FLAG[media.role], media.value);
  }
  if (params.aspectRatio !== void 0) {
    delete genericParams.aspect_ratio;
    appendParam("aspect_ratio", params.aspectRatio);
  }
  if (params.durationSec !== void 0) {
    delete genericParams.duration;
    if (params.durationSec > 0) appendParam("duration", params.durationSec);
  }
  if (params.count !== void 0) {
    delete genericParams.count;
    if (params.count >= 1) appendParam("count", params.count);
  }
  for (const [key, value] of Object.entries(genericParams)) {
    appendParam(key, value);
  }
  args.push("--json");
  return args;
}
class HiggsfieldCliError extends Error {
  constructor(message, stdout = "", stderr = "") {
    super(message);
    this.name = "HiggsfieldCliError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}
function isTransientHiggsfieldError(message) {
  return /HTTP\s*50[234]|50[234]\s+[\w\s]*Unavailable|502 Bad Gateway|504 Gateway|ECONNRESET|ETIMEDOUT|socket hang up|no response received|HTTP\s*429|rate limit|temporarily unavailable|service unavailable/i.test(message);
}
const JOB_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function isInFlightHiggsfieldStatus(status) {
  return /^(queued|queue|pending|running|processing|waiting|in_progress|ns|created)$/.test(status.trim());
}
function isFinishedHiggsfieldResult(value, mediaType) {
  if (!("outputs" in value) && !("mediaType" in value)) return false;
  const result = value;
  if (typeof result.url === "string" && result.url.trim()) return true;
  return mediaType === "text" && typeof result.text === "string" && Boolean(result.text.trim());
}
function firstJobRecord(parsed) {
  for (const key of ["results", "jobs"]) {
    const value = parsed[key];
    if (Array.isArray(value) && value.length > 0 && isRecord$2(value[0])) return value[0];
  }
  return parsed;
}
function parseJobSnapshot(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Higgsfield CLI returned no output");
  const normalize = (obj) => {
    if (Array.isArray(obj)) return { results: obj };
    if (isRecord$2(obj)) return obj;
    return { result: obj };
  };
  let parsed = null;
  try {
    parsed = normalize(JSON.parse(trimmed));
  } catch {
    for (const line of trimmed.split(/\r?\n/).reverse()) {
      const s = line.trim();
      if (!s.startsWith("{") && !s.startsWith("[")) continue;
      try {
        parsed = normalize(JSON.parse(s));
        break;
      } catch {
      }
    }
  }
  if (!parsed) throw new Error("Higgsfield CLI output was not valid JSON");
  const record = firstJobRecord(parsed);
  const jobIdRaw = record.job_id ?? record.id ?? record.jobId;
  return {
    status: String(record.state ?? record.status ?? "").toLowerCase(),
    jobId: typeof jobIdRaw === "string" && jobIdRaw.trim() ? jobIdRaw.trim() : void 0,
    record,
    parsed
  };
}
function extractHiggsfieldJobId(...chunks) {
  var _a;
  const text = chunks.filter(Boolean).join("\n");
  try {
    const id = parseJobSnapshot(text).jobId;
    if (id) return id;
  } catch {
  }
  return (_a = text.match(JOB_ID_RE)) == null ? void 0 : _a[0];
}
function isRecord$2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const INPUT_KEYS = /* @__PURE__ */ new Set(["params", "prompt", "input_images", "inputs", "extra", "request"]);
const URL_KEYS = [
  "url",
  "urls",
  "video_url",
  "image_url",
  "audio_url",
  "model_url",
  "glb_url",
  "file_url",
  "asset_url",
  "output_url",
  "result_url",
  "download_url",
  "signed_url",
  "cdn_url",
  "media_url",
  "public_url",
  "uri",
  "src",
  "min_result_url"
];
const NEST_KEYS = [
  "output",
  "result",
  "data",
  "job",
  "results",
  "outputs",
  "medias",
  "jobs",
  "items",
  "raw",
  "video",
  "files",
  "assets",
  "images",
  "image",
  "media",
  "artifact",
  "artifacts"
];
function extractMediaUrls(value, depth = 0) {
  if (depth > 12) return [];
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/[),.;]+$/, "");
    return /^https?:\/\//i.test(trimmed) ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => extractMediaUrls(entry, depth + 1)))];
  }
  if (!isRecord$2(value)) return [];
  const urls = [];
  for (const key of URL_KEYS) {
    if (value[key] === void 0) continue;
    urls.push(...extractMediaUrls(value[key], depth + 1));
  }
  if (typeof value.result_json === "string" && value.result_json.trim()) {
    try {
      urls.push(...extractMediaUrls(JSON.parse(value.result_json), depth + 1));
    } catch {
    }
  }
  for (const key of NEST_KEYS) {
    if (value[key] === void 0) continue;
    urls.push(...extractMediaUrls(value[key], depth + 1));
  }
  for (const [key, entry] of Object.entries(value)) {
    if (INPUT_KEYS.has(key)) continue;
    if (URL_KEYS.includes(key) || NEST_KEYS.includes(key) || key === "result_json") continue;
    if (isRecord$2(entry) || Array.isArray(entry)) urls.push(...extractMediaUrls(entry, depth + 1));
  }
  return [...new Set(urls)];
}
const HTTP_URL_RE = /https?:\/\/[^\s"'<>\\]+/gi;
function extractHttpUrlsFromText(text) {
  const matches = text.match(HTTP_URL_RE) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.;]+$/, "")))].filter((url) => /^https?:\/\//i.test(url) && !/higgsfield\.ai\/(docs|cli|skills)/i.test(url));
}
function extractTextOutput(value, depth = 0) {
  if (depth > 12) return void 0;
  if (typeof value === "string") {
    const text = value.trim();
    return text && !/^https?:\/\//i.test(text) ? text : void 0;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractTextOutput(entry, depth + 1);
      if (found) return found;
    }
    return void 0;
  }
  if (!isRecord$2(value)) return void 0;
  for (const key of ["text", "output_text", "result_text", "response_text", "answer", "content"]) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      const text = candidate.trim();
      if (text && !/^https?:\/\//i.test(text)) return text;
    }
  }
  const rawJson = value.result_json;
  if (typeof rawJson === "string" && rawJson.trim()) {
    try {
      const found = extractTextOutput(JSON.parse(rawJson), depth + 1);
      if (found) return found;
    } catch {
    }
    return rawJson.trim();
  }
  for (const key of ["output", "result", "data", "job", "results", "outputs", "items"]) {
    const found = extractTextOutput(value[key], depth + 1);
    if (found) return found;
  }
  return void 0;
}
function parseGenerateJson(stdout, params) {
  const snap = parseJobSnapshot(stdout);
  if (snap.status === "failed" || snap.status === "error" || snap.status === "fail") {
    throw new Error(typeof snap.record.error === "string" ? snap.record.error : "Higgsfield generation failed");
  }
  if (isInFlightHiggsfieldStatus(snap.status)) {
    throw new Error("Higgsfield job is still running");
  }
  const result = snapshotToResult(snap, params);
  if (params.mediaType === "text") {
    if (!result.url && !result.text) throw new Error("Higgsfield generation finished without a media URL or text output");
    return result;
  }
  if (result.url) return result;
  const scraped = extractHttpUrlsFromText(stdout);
  if (scraped[0]) {
    return { ...result, url: scraped[0], urls: scraped, outputs: scraped.map((url) => ({ kind: params.mediaType, url })) };
  }
  throw new Error("Higgsfield generation finished without a media URL");
}
function snapshotToResult(snap, params) {
  var _a;
  const urls = extractMediaUrls(snap.parsed);
  const url = urls[0];
  const text = extractTextOutput(snap.parsed);
  const duration = snap.record.duration ?? ((_a = snap.record.output) == null ? void 0 : _a.duration);
  const outputKind = params.mediaType;
  const outputs = urls.map((outputUrl) => ({ kind: outputKind, url: outputUrl }));
  if (text) outputs.push({ kind: "text", text });
  return {
    ...url ? { url, urls } : {},
    ...text ? { text } : {},
    mediaType: outputKind,
    outputKind,
    outputs,
    durationSec: typeof duration === "number" ? duration : typeof duration === "string" && Number.isFinite(Number(duration)) ? Number(duration) : void 0,
    jobId: snap.jobId,
    model: params.model
  };
}
function cliErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function cliErrorOutput(error) {
  if (error instanceof HiggsfieldCliError) return { stdout: error.stdout, stderr: error.stderr };
  return { stdout: "", stderr: "" };
}
async function resultFromStdout(stdout, params) {
  if (!stdout.trim()) return void 0;
  try {
    return parseGenerateJson(stdout, params);
  } catch {
    return void 0;
  }
}
function higgsfieldBinaryCandidates(home = os.homedir()) {
  return [
    path.join(home, ".npm-global/bin/higgsfield"),
    path.join(home, ".npm-global/bin/higgs"),
    path.join(home, ".local/bin/higgsfield"),
    path.join(home, ".local/bin/higgs"),
    "/opt/homebrew/bin/higgsfield",
    "/opt/homebrew/bin/higgs",
    "/usr/local/bin/higgsfield",
    "/usr/local/bin/higgs",
    "higgsfield",
    "higgs"
  ];
}
function isBareBinaryName(file) {
  return !file.includes("/") && !file.includes("\\");
}
function pickHiggsfieldBinaries(candidates = higgsfieldBinaryCandidates(), exists = (file) => {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}) {
  const found = [];
  const pathNames = [];
  for (const bin of candidates) {
    if (isBareBinaryName(bin)) {
      if (!pathNames.includes(bin)) pathNames.push(bin);
      continue;
    }
    if (exists(bin) && !found.includes(bin)) found.push(bin);
  }
  return [...found, ...pathNames];
}
function higgsfieldEnv() {
  const home = os.homedir();
  const extra = [path.join(home, ".npm-global/bin"), path.join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter), NO_COLOR: "1" };
}
const GENERATE_TIMEOUT_MS = 21 * 60 * 1e3;
const SUBMIT_TIMEOUT_MS = 9e4;
const WAIT_ATTEMPTS = 4;
const CLI_MISSING_MESSAGE = "Higgsfield CLI not found. Install @higgsfield/cli, then run higgsfield auth login — or connect Higgsfield in Settings.";
function isMissingBinaryError(error) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "ENOENT" || /ENOENT|spawn .* ENOENT/i.test(message);
}
let cachedHiggsfieldBinary = null;
function spawnHiggsfield(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    var _a, _b;
    const child = spawn(binary, args, { env: higgsfieldEnv() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new HiggsfieldCliError("Higgsfield CLI timed out", stdout, stderr));
    }, timeoutMs);
    (_a = child.stdout) == null ? void 0 : _a.on("data", (d) => {
      stdout += d.toString();
    });
    (_b = child.stderr) == null ? void 0 : _b.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const msg = stderr.trim() || stdout.trim() || `Higgsfield CLI exited with code ${code}`;
      const message = /session expired/i.test(msg) ? 'Higgsfield is not connected. Run "higgsfield auth login" or connect it in Settings.' : msg;
      reject(new HiggsfieldCliError(message, stdout, stderr));
    });
  });
}
async function runHiggsfieldCli(args, timeoutMs = 6e4) {
  const finalArgs = args.includes("--json") ? args : [...args, "--json"];
  const ordered = pickHiggsfieldBinaries();
  const candidates = cachedHiggsfieldBinary ? [cachedHiggsfieldBinary, ...ordered.filter((bin) => bin !== cachedHiggsfieldBinary)] : ordered;
  if (candidates.length === 0) throw new Error(CLI_MISSING_MESSAGE);
  let lastMissing;
  for (const binary of candidates) {
    try {
      const stdout = await spawnHiggsfield(binary, finalArgs, timeoutMs);
      cachedHiggsfieldBinary = binary;
      return stdout;
    } catch (error) {
      if (isMissingBinaryError(error)) {
        if (cachedHiggsfieldBinary === binary) cachedHiggsfieldBinary = null;
        lastMissing = error;
        continue;
      }
      throw error;
    }
  }
  const tried = candidates.join(", ");
  const detail = lastMissing instanceof Error ? lastMissing.message : "";
  throw new Error(detail ? `${CLI_MISSING_MESSAGE} Tried: ${tried}. ${detail}` : `${CLI_MISSING_MESSAGE} Tried: ${tried}.`);
}
const REMOTE_MEDIA_TIMEOUT_MS = 6e4;
const MEDIA_CONTENT_TYPE_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg"
};
function fallbackExtensionForRole(role) {
  if (role === "video") return ".mp4";
  if (role === "audio") return ".mp3";
  return ".png";
}
function mediaExtensionFor(reference, contentType, role) {
  const fromType = contentType ? MEDIA_CONTENT_TYPE_EXT[contentType.split(";", 1)[0].trim().toLowerCase()] : void 0;
  if (fromType) return fromType;
  const ext = path.extname(reference.split(/[?#]/, 1)[0]).toLowerCase();
  if (ext && ext.length <= 5) return ext;
  return fallbackExtensionForRole(role);
}
async function resolveRemoteMedias(medias) {
  if (!(medias == null ? void 0 : medias.length)) return { medias, tempPaths: [] };
  const tempPaths = [];
  const resolved = [];
  for (const [index, media] of medias.entries()) {
    let value = media.value;
    if (value.startsWith("local-media://file")) {
      try {
        value = decodeURIComponent(value.slice("local-media://file".length));
      } catch {
        value = value.slice("local-media://file".length);
      }
    }
    if (/^https?:\/\//i.test(value)) {
      const res = await fetch(value, { signal: AbortSignal.timeout(REMOTE_MEDIA_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Failed to download media input (HTTP ${res.status}): ${value}`);
      const ext = mediaExtensionFor(value, res.headers.get("content-type"), media.role);
      const tmpPath = path.join(os.tmpdir(), `cinegen-hf-media-${Date.now()}-${index}${ext}`);
      await fs.promises.writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
      tempPaths.push(tmpPath);
      resolved.push({ ...media, value: tmpPath });
    } else if (value.startsWith("data:")) {
      const comma = value.indexOf(",");
      if (comma < 0) throw new Error("Malformed data: URI media input");
      const meta = value.slice(5, comma);
      const contentType = meta.replace(/;base64$/i, "");
      const data = value.slice(comma + 1);
      const buffer = /;base64$/i.test(meta) ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data));
      const ext = MEDIA_CONTENT_TYPE_EXT[contentType.toLowerCase()] ?? fallbackExtensionForRole(media.role);
      const tmpPath = path.join(os.tmpdir(), `cinegen-hf-media-${Date.now()}-${index}${ext}`);
      await fs.promises.writeFile(tmpPath, buffer);
      tempPaths.push(tmpPath);
      resolved.push({ ...media, value: tmpPath });
    } else {
      resolved.push(value === media.value ? media : { ...media, value });
    }
  }
  return { medias: resolved, tempPaths };
}
async function generateHiggsfield(params) {
  const { medias, tempPaths } = await resolveRemoteMedias(params.medias);
  let submitted;
  try {
    submitted = await submitHiggsfieldJob({ ...params, medias });
  } finally {
    for (const tmpPath of tempPaths) {
      fs.promises.unlink(tmpPath).catch(() => {
      });
    }
  }
  if (isFinishedHiggsfieldResult(submitted, params.mediaType)) return submitted;
  const jobId = "jobId" in submitted ? submitted.jobId : void 0;
  if (!jobId) throw new Error("Higgsfield accepted the request but did not return a job id.");
  if (params.wait === false) {
    return {
      jobId,
      model: params.model,
      mediaType: params.mediaType,
      outputKind: params.mediaType,
      outputs: []
    };
  }
  return waitForHiggsfieldJob(jobId, params);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function submitHiggsfieldJob(params) {
  const args = buildCreateArgs({ ...params });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stdout = await runHiggsfieldCli(args, SUBMIT_TIMEOUT_MS);
      const done = await resultFromStdout(stdout, params);
      if (done) return done;
      const jobId = extractHiggsfieldJobId(stdout);
      if (jobId) return { jobId };
      throw new Error("Higgsfield accepted the request but did not return a job id.");
    } catch (error) {
      lastError = error;
      const { stdout, stderr } = cliErrorOutput(error);
      const done = await resultFromStdout(stdout, params);
      if (done) return done;
      const jobId = extractHiggsfieldJobId(stdout, stderr, cliErrorMessage(error));
      if (jobId) return { jobId };
      if (!isTransientHiggsfieldError(cliErrorMessage(error)) || attempt === 3) throw error;
      await sleep(1500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Higgsfield submit failed");
}
function matchListedJobRecord(rows, jobId) {
  return rows.find((row) => row.id === jobId || row.job_id === jobId || row.jobId === jobId || row.job_set_id === jobId || row.parent_id === jobId);
}
async function resultFromListedJob(jobId, params) {
  try {
    const rows = await listHiggsfieldJobs({ size: 50 });
    const match = matchListedJobRecord(rows, jobId);
    if (!match) return void 0;
    const result = snapshotToResult({
      status: String(match.status ?? match.state ?? "completed").toLowerCase(),
      jobId,
      record: match,
      parsed: match
    }, params);
    return result.url || result.text ? result : void 0;
  } catch {
    return void 0;
  }
}
async function readHiggsfieldJob(jobId, params) {
  const stdout = await runHiggsfieldCli(["generate", "get", jobId], 2e4);
  const snap = parseJobSnapshot(stdout);
  if (snap.status === "failed" || snap.status === "error" || snap.status === "fail") {
    throw new Error(typeof snap.record.error === "string" ? snap.record.error : "Higgsfield generation failed");
  }
  const result = snapshotToResult(snap, params);
  if (result.url || result.text) return result;
  const scraped = extractHttpUrlsFromText(stdout);
  if (scraped[0]) {
    return { ...result, url: scraped[0], urls: scraped, outputs: scraped.map((url) => ({ kind: params.mediaType, url })) };
  }
  return resultFromListedJob(jobId, params);
}
async function waitHiggsfieldJobStdout(jobId) {
  try {
    return await runHiggsfieldCli(
      ["generate", "wait", jobId, "--timeout", "20m", "--interval", "5s"],
      GENERATE_TIMEOUT_MS
    );
  } catch (error) {
    if (!/unknown|unexpected|unrecognized/i.test(cliErrorMessage(error))) throw error;
    return runHiggsfieldCli(
      ["generate", "wait", jobId, "--wait-timeout", "20m", "--wait-interval", "5s"],
      GENERATE_TIMEOUT_MS
    );
  }
}
async function waitForHiggsfieldJob(jobId, params) {
  let lastError;
  for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt++) {
    try {
      const stdout = await waitHiggsfieldJobStdout(jobId);
      return parseGenerateJson(stdout, params);
    } catch (error) {
      lastError = error;
      const { stdout } = cliErrorOutput(error);
      const done = await resultFromStdout(stdout, params);
      if (done) return done;
      try {
        const got = await readHiggsfieldJob(jobId, params);
        if (got) return got;
      } catch (getError) {
        if (!isTransientHiggsfieldError(cliErrorMessage(getError))) throw getError;
      }
      const message = cliErrorMessage(error);
      const keepPolling = isTransientHiggsfieldError(message) || /timed out/i.test(message) || /still running/i.test(message) || /without a media URL/i.test(message);
      if (!keepPolling) throw error;
      if (attempt === WAIT_ATTEMPTS) break;
      await sleep(2e3 * attempt);
    }
  }
  const listed = await resultFromListedJob(jobId, params);
  if (listed) return listed;
  throw new Error(
    `${cliErrorMessage(lastError)} The job was submitted (${jobId}) and may still finish on Higgsfield.`
  );
}
function listRowsFromParsed(parsed) {
  if (Array.isArray(parsed)) return parsed.filter((entry) => isRecord$2(entry));
  if (!isRecord$2(parsed)) return [];
  for (const key of ["jobs", "results", "data", "items", "generations"]) {
    const rows = parsed[key];
    if (Array.isArray(rows)) return rows.filter((entry) => isRecord$2(entry));
  }
  return parsed.id || parsed.job_id ? [parsed] : [];
}
async function listHiggsfieldJobs(opts) {
  const args = ["generate", "list"];
  if (opts == null ? void 0 : opts.video) args.push("--video");
  args.push("--size", String((opts == null ? void 0 : opts.size) ?? 20));
  const stdout = await runHiggsfieldCli(args, 2e4);
  const trimmed = stdout.trim();
  try {
    return listRowsFromParsed(JSON.parse(trimmed));
  } catch {
    const start = Math.max(trimmed.lastIndexOf("["), trimmed.lastIndexOf("{"));
    if (start < 0) return [];
    return listRowsFromParsed(JSON.parse(trimmed.slice(start)));
  }
}
async function resolveHiggsfieldJob(jobId, params) {
  const got = await readHiggsfieldJob(jobId, params);
  if (got && isFinishedHiggsfieldResult(got, params.mediaType)) return got;
  return waitForHiggsfieldJob(jobId, params);
}
async function getHiggsfieldAccountStatus() {
  try {
    const stdout = await runHiggsfieldCli(["account", "status"], 15e3);
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}
function parseConnectionState(account) {
  if (!account) return { connected: false };
  const data = account.data && typeof account.data === "object" ? account.data : account;
  const plan = data.subscription_plan_type ?? data.plan;
  return {
    connected: true,
    email: typeof data.email === "string" ? data.email : void 0,
    plan: typeof plan === "string" ? plan : void 0,
    credits: typeof data.credits === "number" ? data.credits : typeof data.balance === "number" ? data.balance : void 0
  };
}
function selectQuickEditMedias(opts) {
  if (opts.drawnFramePath && opts.referenceMode === "frame") {
    const role = opts.outputType === "video" ? "start_image" : "image";
    const medias = [{ value: opts.drawnFramePath, role }];
    if (opts.guideFramePath) medias.push({ value: opts.guideFramePath, role: "image" });
    return medias;
  }
  return opts.extractedPaths.map((p, i) => ({
    value: p,
    role: opts.extractedRoles[i] ?? "image"
  }));
}
function registerHiggsfieldHandlers() {
  ipcMain.handle("higgsfield:account-status", async () => {
    return parseConnectionState(await getHiggsfieldAccountStatus());
  });
  ipcMain.handle("higgsfield:quick-edit", async (_event, params) => {
    const { prepareClipReference: prepareClipReference2, resolveLocalSourcePath: resolveLocalSourcePath2 } = await Promise.resolve().then(() => copilotVisualMedia);
    console.log("[higgsfield:quick-edit] params:", { fileRef: params.fileRef, mode: params.referenceMode, model: params.model, range: [params.sourceStartSec, params.sourceEndSec] });
    let medias = [];
    const isRemote = /^https?:\/\//i.test(params.fileRef);
    const localPath = isRemote ? null : resolveLocalSourcePath2(params.fileRef);
    if (params.drawnFramePath && params.referenceMode === "frame") {
      medias = selectQuickEditMedias({
        referenceMode: "frame",
        outputType: params.outputType,
        drawnFramePath: params.drawnFramePath,
        guideFramePath: params.guideFramePath,
        extractedPaths: [],
        extractedRoles: []
      });
    } else if (localPath) {
      try {
        const prepared = await prepareClipReference2(params.fileRef, {
          mode: params.referenceMode,
          frameTimeSec: params.frameTimeSec,
          sourceStartSec: params.sourceStartSec,
          sourceEndSec: params.sourceEndSec
        });
        console.log("[higgsfield:quick-edit] extracted refs:", prepared.paths);
        medias = selectQuickEditMedias({
          referenceMode: params.referenceMode,
          outputType: params.outputType,
          drawnFramePath: params.drawnFramePath,
          extractedPaths: prepared.paths,
          extractedRoles: prepared.roles
        });
      } catch (err) {
        console.warn("[higgsfield:quick-edit] extraction failed, falling back to source path:", err);
        medias = [{ value: localPath, role: params.outputType === "video" ? "start_image" : "image" }];
      }
    } else if (isRemote) {
      console.log("[higgsfield:quick-edit] remote source, passing URL directly");
      medias = [{ value: params.fileRef, role: params.outputType === "video" ? "start_image" : "image" }];
    } else {
      throw new Error(`Quick Edit could not resolve the clip's source media: ${params.fileRef}`);
    }
    return generateHiggsfield({
      model: params.model,
      prompt: params.prompt,
      mediaType: params.outputType,
      medias: medias.length > 0 ? medias : void 0,
      aspectRatio: params.aspectRatio
    });
  });
  ipcMain.handle("higgsfield:generate", async (_event, params) => {
    const { resolveLocalSourcePath: resolveLocalSourcePath2 } = await Promise.resolve().then(() => copilotVisualMedia);
    if (params.jobId) {
      const lookup2 = { model: params.model, mediaType: params.outputType };
      if (params.wait === false) {
        const got = await readHiggsfieldJob(params.jobId, lookup2);
        if (got && isFinishedHiggsfieldResult(got, params.outputType)) return got;
        throw new Error("Higgsfield job is still running");
      }
      return resolveHiggsfieldJob(params.jobId, lookup2);
    }
    const medias = [...params.medias ?? []].map((media) => {
      if (!media.value || /^https?:\/\//i.test(media.value)) return media;
      const local = resolveLocalSourcePath2(media.value);
      return local ? { ...media, value: local } : media;
    });
    if (params.referenceValue) {
      medias.push({
        value: params.referenceValue,
        role: params.outputType === "video" ? "start_image" : "image"
      });
    }
    return generateHiggsfield({
      model: params.model,
      prompt: params.prompt,
      mediaType: params.outputType,
      medias: medias.length > 0 ? medias : void 0,
      params: params.params,
      wait: params.wait
    });
  });
  ipcMain.handle("higgsfield:generate-list", async (_event, params) => {
    return listHiggsfieldJobs(params);
  });
  ipcMain.handle("higgsfield:auth-login", async () => {
    try {
      await runHiggsfieldCli(["auth", "login"], 5 * 60 * 1e3);
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error) };
    }
    return parseConnectionState(await getHiggsfieldAccountStatus());
  });
  ipcMain.handle("higgsfield:auth-logout", async () => {
    await runHiggsfieldCli(["auth", "logout"], 15e3).catch(() => {
    });
  });
}
const workflowTemplate = {
  "75": { "class_type": "SaveVideo", "_meta": { "title": "Save LTX 2.5 video" }, "inputs": { "filename_prefix": "video/LTX-2.5_i2v", "format": "auto", "codec": "auto", "video": ["398:370", 0] } },
  "395": { "class_type": "LoadImage", "_meta": { "title": "Load first frame" }, "inputs": { "image": "source-image.png" } },
  "398:393": { "class_type": "CLIPLoader", "_meta": { "title": "CLIPLoader" }, "inputs": { "clip_name": "gemma4_e2b_it_bf16.safetensors", "type": "ltxv", "device": "default" } },
  "398:380": { "class_type": "TextGenerateLTX2Prompt", "_meta": { "title": "TextGenerateLTX2Prompt" }, "inputs": { "clip": ["398:393", 0], "image": ["398:350", 0], "prompt": ["398:376", 0], "max_length": 600, "sampling_mode": "on", "sampling_mode.temperature": 0.7, "sampling_mode.top_k": 64, "sampling_mode.top_p": 0.95, "sampling_mode.min_p": 0.05, "sampling_mode.repetition_penalty": 1.15, "sampling_mode.seed": 0 } },
  "398:383": { "class_type": "PrimitiveBoolean", "_meta": { "title": "Boolean (Enable Prompt Enhance)" }, "inputs": { "value": true } },
  "398:364": { "class_type": "CLIPTextEncode", "_meta": { "title": "CLIPTextEncode" }, "inputs": { "clip": ["398:387", 0], "text": ["398:382", 0] } },
  "398:376": { "class_type": "PrimitiveStringMultiline", "_meta": { "title": "Prompt" }, "inputs": { "value": "A cinematic subject comes alive from the first frame with natural motion, synchronized sound, and no text." } },
  "398:382": { "class_type": "ComfySwitchNode", "_meta": { "title": "ComfySwitchNode" }, "inputs": { "on_false": ["398:376", 0], "on_true": ["398:380", 0], "switch": ["398:383", 0] } },
  "398:384": { "class_type": "UNETLoader", "_meta": { "title": "UNETLoader" }, "inputs": { "unet_name": "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors", "weight_dtype": "default" } },
  "398:362": { "class_type": "PrimitiveInt", "_meta": { "title": "Duration" }, "inputs": { "value": 5 } },
  "398:363": { "class_type": "PrimitiveBoolean", "_meta": { "title": "Switch to Text to Video?" }, "inputs": { "value": false } },
  "398:365": { "class_type": "LTXVConditioning", "_meta": { "title": "LTXVConditioning" }, "inputs": { "positive": ["398:364", 0], "negative": ["398:373", 0], "frame_rate": ["398:359", 0] } },
  "398:385": { "class_type": "VAELoader", "_meta": { "title": "VAELoader" }, "inputs": { "vae_name": "ltx-2.5-video-vae-bf16.safetensors" } },
  "398:386": { "class_type": "VAELoader", "_meta": { "title": "VAELoader" }, "inputs": { "vae_name": "ltx-2.5-audio-vae-bf16.safetensors" } },
  "398:372": { "class_type": "PrimitiveInt", "_meta": { "title": "Width" }, "inputs": { "value": 1280 } },
  "398:373": { "class_type": "CLIPTextEncode", "_meta": { "title": "CLIPTextEncode" }, "inputs": { "clip": ["398:387", 0], "text": "pc game, console game, video game, cartoon, childish, ugly" } },
  "398:387": { "class_type": "CLIPLoader", "_meta": { "title": "CLIPLoader" }, "inputs": { "clip_name": "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", "type": "ltxv", "device": "default" } },
  "398:360": { "class_type": "PrimitiveInt", "_meta": { "title": "Height" }, "inputs": { "value": 720 } },
  "398:352": { "class_type": "KSamplerSelect", "_meta": { "title": "KSamplerSelect" }, "inputs": { "sampler_name": "euler_ancestral" } },
  "398:339": { "class_type": "RandomNoise", "_meta": { "title": "RandomNoise" }, "inputs": { "noise_seed": 875362541677469 } },
  "398:397": { "class_type": "ManualSigmas", "_meta": { "title": "ManualSigmas" }, "inputs": { "sigmas": "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" } },
  "398:361": { "class_type": "PrimitiveInt", "_meta": { "title": "Frame Rate" }, "inputs": { "value": 24 } },
  "398:371": { "class_type": "LatentUpscaleModelLoader", "_meta": { "title": "LatentUpscaleModelLoader" }, "inputs": { "model_name": "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors" } },
  "398:388": { "class_type": "LTXVDualCFGGuider", "_meta": { "title": "LTXVDualCFGGuider" }, "inputs": { "positive": ["398:365", 0], "negative": ["398:365", 1], "model": ["398:384", 0], "video_cfg": 1, "audio_cfg": 1 } },
  "398:344": { "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" }, "inputs": { "noise": ["398:339", 0], "guider": ["398:388", 0], "sampler": ["398:352", 0], "sigmas": ["398:397", 0], "latent_image": ["398:377", 0] } },
  "398:357": { "class_type": "LTXVImgToVideoInplace", "_meta": { "title": "LTXVImgToVideoInplace" }, "inputs": { "vae": ["398:385", 0], "image": ["398:350", 0], "latent": ["398:356", 0], "bypass": ["398:363", 0], "strength": 0.7 } },
  "398:366": { "class_type": "LTXVEmptyLatentAudio", "_meta": { "title": "LTXVEmptyLatentAudio" }, "inputs": { "audio_vae": ["398:386", 0], "frames_number": ["398:378", 1], "frame_rate": ["398:359", 1], "batch_size": 1 } },
  "398:367": { "class_type": "LTXVSeparateAVLatent", "_meta": { "title": "LTXVSeparateAVLatent" }, "inputs": { "av_latent": ["398:344", 0] } },
  "398:377": { "class_type": "LTXVConcatAVLatent", "_meta": { "title": "LTXVConcatAVLatent" }, "inputs": { "video_latent": ["398:357", 0], "audio_latent": ["398:366", 0] } },
  "398:351": { "class_type": "ResizeImageMaskNode", "_meta": { "title": "ResizeImageMaskNode" }, "inputs": { "input": ["395", 0], "resize_type": "scale longer dimension", "resize_type.longer_size": 1536, "scale_method": "lanczos" } },
  "398:353": { "class_type": "ComfyMathExpression", "_meta": { "title": "ComfyMathExpression" }, "inputs": { "values.a": ["398:372", 0], "expression": "a/2" } },
  "398:355": { "class_type": "ComfyMathExpression", "_meta": { "title": "ComfyMathExpression" }, "inputs": { "values.a": ["398:360", 0], "expression": "a/2" } },
  "398:350": { "class_type": "LTXVPreprocess", "_meta": { "title": "LTXVPreprocess" }, "inputs": { "image": ["398:351", 0], "img_compression": 18 } },
  "398:356": { "class_type": "EmptyLTXVLatentVideo", "_meta": { "title": "EmptyLTXVLatentVideo" }, "inputs": { "width": ["398:353", 1], "height": ["398:355", 1], "length": ["398:378", 1], "batch_size": 1 } },
  "398:348": { "class_type": "LTXVLatentUpsampler", "_meta": { "title": "LTXVLatentUpsampler" }, "inputs": { "samples": ["398:367", 0], "upscale_model": ["398:371", 0], "vae": ["398:385", 0] } },
  "398:349": { "class_type": "LTXVImgToVideoInplace", "_meta": { "title": "LTXVImgToVideoInplace" }, "inputs": { "image": ["398:350", 0], "latent": ["398:348", 0], "bypass": ["398:363", 0], "vae": ["398:385", 0], "strength": 1 } },
  "398:359": { "class_type": "ComfyMathExpression", "_meta": { "title": "Math Expression (fps)" }, "inputs": { "values.a": ["398:361", 0], "expression": "a" } },
  "398:378": { "class_type": "ComfyMathExpression", "_meta": { "title": "Math Expression (length)" }, "inputs": { "values.a": ["398:362", 0], "values.b": ["398:361", 0], "expression": "a * b + 1" } },
  "398:338": { "class_type": "RandomNoise", "_meta": { "title": "RandomNoise" }, "inputs": { "noise_seed": 42 } },
  "398:340": { "class_type": "LTXVConcatAVLatent", "_meta": { "title": "LTXVConcatAVLatent" }, "inputs": { "video_latent": ["398:349", 0], "audio_latent": ["398:367", 1] } },
  "398:396": { "class_type": "ManualSigmas", "_meta": { "title": "ManualSigmas" }, "inputs": { "sigmas": "0.85, 0.7250, 0.4219, 0.0" } },
  "398:391": { "class_type": "LTXVDualCFGGuider", "_meta": { "title": "LTXVDualCFGGuider" }, "inputs": { "positive": ["398:365", 0], "negative": ["398:365", 1], "model": ["398:384", 0], "video_cfg": 1, "audio_cfg": 1 } },
  "398:341": { "class_type": "KSamplerSelect", "_meta": { "title": "KSamplerSelect" }, "inputs": { "sampler_name": "euler_ancestral" } },
  "398:368": { "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" }, "inputs": { "noise": ["398:338", 0], "guider": ["398:391", 0], "sampler": ["398:341", 0], "sigmas": ["398:396", 0], "latent_image": ["398:340", 0] } },
  "398:369": { "class_type": "LTXVSeparateAVLatent", "_meta": { "title": "LTXVSeparateAVLatent" }, "inputs": { "av_latent": ["398:368", 0] } },
  "398:374": { "class_type": "VAEDecodeTiled", "_meta": { "title": "VAEDecodeTiled" }, "inputs": { "samples": ["398:369", 0], "vae": ["398:385", 0], "tile_size": 512, "overlap": 64, "temporal_size": 64, "temporal_overlap": 16 } },
  "398:358": { "class_type": "LTXVAudioVAEDecode", "_meta": { "title": "LTXVAudioVAEDecode" }, "inputs": { "samples": ["398:369", 1], "audio_vae": ["398:386", 0] } },
  "398:370": { "class_type": "CreateVideo", "_meta": { "title": "CreateVideo" }, "inputs": { "images": ["398:374", 0], "audio": ["398:358", 0], "fps": ["398:359", 0] } }
};
const sdxlWorkflowTemplate = {
  "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" } },
  "2": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["1", 1], "text": "CINEGEN_POSITIVE_PROMPT" } },
  "3": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["1", 1], "text": "CINEGEN_NEGATIVE_PROMPT" } },
  "4": { "class_type": "EmptyLatentImage", "inputs": { "width": 1024, "height": 1024, "batch_size": 1 } },
  "5": { "class_type": "KSampler", "inputs": { "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0], "seed": 1, "steps": 30, "cfg": 7, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1 } },
  "6": { "class_type": "VAEDecode", "inputs": { "samples": ["5", 0], "vae": ["1", 2] } },
  "7": { "class_type": "SaveImage", "inputs": { "filename_prefix": "CineGen_SDXL", "images": ["6", 0] } }
};
const qwenImageEditWorkflowTemplate = {
  "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "qwen_image_edit_2511_int8_convrot.safetensors", "weight_dtype": "default" } },
  "2": { "class_type": "ModelSamplingAuraFlow", "inputs": { "model": ["1", 0], "shift": 3.1 } },
  "3": { "class_type": "CFGNorm", "inputs": { "model": ["2", 0], "strength": 1, "pre_cfg": false } },
  "4": { "class_type": "LoraLoaderModelOnly", "inputs": { "model": ["3", 0], "lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "strength_model": 1 } },
  "5": { "class_type": "CLIPLoader", "inputs": { "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default" } },
  "6": { "class_type": "VAELoader", "inputs": { "vae_name": "qwen_image_vae.safetensors" } },
  "7": { "class_type": "LoadImage", "inputs": { "image": "cinegen-qwen-reference-1.png" } },
  "10": { "class_type": "TextEncodeQwenImageEditPlus", "inputs": { "clip": ["5", 0], "vae": ["6", 0], "image1": ["18", 0], "prompt": "CINEGEN_POSITIVE_PROMPT" } },
  "11": { "class_type": "TextEncodeQwenImageEditPlus", "inputs": { "clip": ["5", 0], "vae": ["6", 0], "image1": ["18", 0], "prompt": "CINEGEN_NEGATIVE_PROMPT" } },
  "12": { "class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": { "conditioning": ["10", 0], "reference_latents_method": "index_timestep_zero" } },
  "13": { "class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": { "conditioning": ["11", 0], "reference_latents_method": "index_timestep_zero" } },
  "14": { "class_type": "VAEEncode", "inputs": { "pixels": ["18", 0], "vae": ["6", 0] } },
  "15": { "class_type": "KSampler", "inputs": { "model": ["4", 0], "positive": ["12", 0], "negative": ["13", 0], "latent_image": ["14", 0], "seed": 1, "steps": 4, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1 } },
  "16": { "class_type": "VAEDecode", "inputs": { "samples": ["15", 0], "vae": ["6", 0] } },
  "17": { "class_type": "SaveImage", "inputs": { "filename_prefix": "CineGen_Qwen_Edit_2511", "images": ["16", 0] } },
  "18": { "class_type": "FluxKontextImageScale", "inputs": { "image": ["7", 0] } }
};
const LTX25_WORKER_IMAGE = "notrius/ltx-2.5-serverless:cu130@sha256:73d1621ef915ae6a149f2a32f6c317dfc89f12075ed4b3abd7df707420267205";
const RUNPOD_REST_URL = "https://rest.runpod.io/v1";
const RUNPOD_REST_V2_URL = "https://api.runpod.io/v2";
const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";
const POD_PORT = 8e3;
const POD_LOG_MAX_BYTES = 256 * 1024;
const POD_LOG_MAX_WAIT_MS = 1800;
const POD_LOG_QUIET_MS = 200;
const RUNPOD_REQUEST_TIMEOUT_MS = 15e3;
const POD_HEALTH_TIMEOUT_MS = 6500;
const POD_SUBMISSION_TIMEOUT_MS = 12e4;
const MAX_PROMPT_CHARS = 12e3;
const MAX_REFERENCE_BYTES$1 = 14 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const ARTIFACT_CHUNK_BYTES = 1024 * 1024;
const ARTIFACT_DOWNLOAD_CONCURRENCY = 4;
const IMAGE_MODEL_IDS = Object.freeze(["sdxl", "qwen-image-edit"]);
const DEFAULT_FRAME = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYElEQVR4nO3PQQ0AIBDAMMD4WUcEj4ZkVbDtmVk/OzrgVQNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgPaBRFyAf0dnk7yAAAAAElFTkSuQmCC";
const DEFAULT_LTX25_GPU_PROFILE = "balanced";
const LTX25_GPU_PROFILES = Object.freeze({
  economy: Object.freeze({
    gpuTypeIds: Object.freeze([
      "NVIDIA A40",
      "NVIDIA RTX A6000",
      "NVIDIA L40",
      "NVIDIA L40S",
      "NVIDIA RTX 6000 Ada Generation"
    ]),
    containerDiskInGb: 120,
    minRAMPerGPU: 48,
    minVCPUPerGPU: 8
  }),
  balanced: Object.freeze({
    gpuTypeIds: Object.freeze([
      "NVIDIA RTX PRO 6000 Blackwell Server Edition",
      "NVIDIA RTX PRO 6000 Blackwell Workstation Edition",
      "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition"
    ]),
    containerDiskInGb: 120,
    minRAMPerGPU: 64,
    minVCPUPerGPU: 8
  }),
  performance: Object.freeze({
    gpuTypeIds: Object.freeze([
      "NVIDIA B200",
      "NVIDIA H200",
      "NVIDIA H200 NVL",
      "NVIDIA H100 80GB HBM3",
      "NVIDIA H100 NVL"
    ]),
    containerDiskInGb: 160,
    minRAMPerGPU: 96,
    minVCPUPerGPU: 16
  })
});
const SESSION_GATEWAY = String.raw`set -eo pipefail
cinegen_model_root="$COMFY_MODEL_ROOT"
[ -n "$cinegen_model_root" ] || cinegen_model_root="/comfyui/models"
export COMFY_MODEL_ROOT="$cinegen_model_root"
cinegen_image_models="$CINEGEN_IMAGE_MODELS"
export CINEGEN_IMAGE_MODELS="$cinegen_image_models"
source /bootstrap_ltx25.sh

python - <<'PY' &
import base64
import binascii
import hashlib
import json
import mimetypes
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps

TOKEN = os.environ["CINEGEN_POD_TOKEN"]
COMFY = "http://127.0.0.1:8188"
COMFY_INPUT_ROOT = Path(os.environ.get("COMFY_INPUT_DIR", "/comfyui/input")).resolve()
COMFY_OUTPUT_ROOT = Path(os.environ.get("COMFY_OUTPUT_DIR", "/comfyui/output")).resolve()
MAX_BODY = 64 * 1024 * 1024
MAX_IMAGE_BYTES = 14 * 1024 * 1024
MAX_ARTIFACT_BYTES = 100 * 1024 * 1024
ARTIFACT_CHUNK_BYTES = 1024 * 1024
ARTIFACT_TTL_SECONDS = 2 * 60 * 60
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
MODEL_ROOT = Path(os.environ.get("COMFY_MODEL_ROOT", "/comfyui/models")).resolve()
SELECTED_IMAGE_MODELS = tuple(
    model for model in os.environ.get("CINEGEN_IMAGE_MODELS", "").split(",")
    if model in {"sdxl", "qwen-image-edit"}
)
MODEL_FILES = {
    "sdxl": (MODEL_ROOT / "checkpoints" / "sd_xl_base_1.0.safetensors",),
    "qwen-image-edit": (
        MODEL_ROOT / "diffusion_models" / "qwen_image_edit_2511_int8_convrot.safetensors",
        MODEL_ROOT / "text_encoders" / "qwen_2.5_vl_7b_fp8_scaled.safetensors",
        MODEL_ROOT / "vae" / "qwen_image_vae.safetensors",
        MODEL_ROOT / "loras" / "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    ),
}
ARTIFACT_ROOT = Path("/tmp/cinegen-ltx-artifacts").resolve()
jobs = {}
artifacts = {}
jobs_lock = threading.Lock()
render_lock = threading.Lock()
last_model_family = None
GPU_PROFILE = os.environ.get("CINEGEN_GPU_PROFILE", "balanced")

def gpu_memory_mib():
    try:
        value = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            text=True,
            timeout=5,
        ).splitlines()[0]
        return int(value.strip())
    except Exception:
        return 0

GPU_MEMORY_MIB = gpu_memory_mib()
# B200/H200-class sessions have enough headroom for ComfyUI to retain the
# recently used model and avoid a costly image -> LTX cold reload. H100 and
# lower-memory fallbacks keep the conservative unload behavior.
KEEP_MODELS_WARM = GPU_PROFILE == "performance" and GPU_MEMORY_MIB >= 120 * 1024

def port_ready(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False

def health_snapshot():
    installed_images = [
        model for model in SELECTED_IMAGE_MODELS
        if all(path.is_file() for path in MODEL_FILES[model])
    ]
    missing_images = [model for model in SELECTED_IMAGE_MODELS if model not in installed_images]
    comfy_ready = port_ready(8188)
    handler_ready = port_ready(8001)
    is_ready = comfy_ready and handler_ready and not missing_images
    installed = list(installed_images)
    if is_ready:
        installed.insert(0, "ltx-2.5")
        phase = "ready"
        message = "LTX-2.5 and the selected session models are ready."
    elif missing_images:
        phase = "downloading-image-models"
        message = "Downloading the selected image models."
    elif not comfy_ready:
        phase = "loading-ltx"
        message = "Downloading and loading LTX-2.5."
    else:
        phase = "verifying-models"
        message = "ComfyUI is verifying the required models and starting the session API."
    return {
        "ready": is_ready,
        "phase": phase,
        "message": message,
        "installedModels": installed,
        "missingModels": missing_images,
        "components": {
            "comfyui": "ready" if comfy_ready else "starting",
            "sessionApi": "ready" if handler_ready else "starting",
        },
    }

def requested_duration(body):
    try:
        payload = json.loads(body)
        requested = payload.get("input", {}).get("cinegen_duration_sec", 5)
        return max(1, min(20, int(round(float(requested)))))
    except (AttributeError, TypeError, ValueError, OverflowError, json.JSONDecodeError):
        return 5

def requested_task(body):
    try:
        payload = json.loads(body)
        task = payload.get("input", {}).get("cinegen_task", "ltx-2.5")
        return task if task in {"ltx-2.5", "sdxl", "qwen-image-edit"} else "ltx-2.5"
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return "ltx-2.5"

def json_request(url, payload=None, timeout=30):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Accept": "application/json", **({"Content-Type": "application/json"} if data else {})},
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw)
            message = provider_error(detail)
        except Exception:
            message = raw.decode("utf-8", errors="replace").strip()
        raise RuntimeError(message or "ComfyUI rejected the request") from error
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as error:
        raise RuntimeError("ComfyUI returned an invalid response") from error
    if not isinstance(value, dict):
        raise RuntimeError("ComfyUI returned an invalid response")
    return value

def provider_error(payload):
    if not isinstance(payload, dict):
        return ""
    direct = payload.get("detail") or payload.get("message")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()[:1200]
    error = payload.get("error")
    if isinstance(error, str) and error.strip():
        return error.strip()[:1200]
    if isinstance(error, dict):
        message = error.get("message") or error.get("details")
        if isinstance(message, str) and message.strip():
            return message.strip()[:1200]
    node_errors = payload.get("node_errors")
    if isinstance(node_errors, dict):
        for node_error in node_errors.values():
            if not isinstance(node_error, dict):
                continue
            errors = node_error.get("errors")
            if not isinstance(errors, list):
                continue
            for item in errors:
                if not isinstance(item, dict):
                    continue
                message = item.get("message") or item.get("details")
                if isinstance(message, str) and message.strip():
                    return message.strip()[:1200]
    return ""

def safe_child(root, *parts):
    target = root.joinpath(*parts).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("The generated media path is invalid") from error
    return target

def remove_artifact_file(record):
    path = record.get("path") if isinstance(record, dict) else None
    if not isinstance(path, str):
        return
    try:
        Path(path).unlink()
    except OSError:
        pass

def cleanup_expired():
    cutoff = time.time() - ARTIFACT_TTL_SECONDS
    expired = []
    with jobs_lock:
        for artifact_id, artifact in list(artifacts.items()):
            created_at = artifact.get("created_at") if isinstance(artifact, dict) else None
            if not isinstance(created_at, (int, float)) or created_at >= cutoff:
                continue
            expired.append(artifacts.pop(artifact_id))
        for job_id, job in list(jobs.items()):
            finished_at = job.get("finished_at") if isinstance(job, dict) else None
            if isinstance(finished_at, (int, float)) and finished_at < cutoff:
                jobs.pop(job_id, None)
    for artifact in expired:
        remove_artifact_file(artifact)

def cleanup_loop():
    while True:
        time.sleep(300)
        cleanup_expired()

def store_artifact(job_id, source, media_type):
    size = source.stat().st_size
    if size <= 0 or size > MAX_ARTIFACT_BYTES:
        raise RuntimeError("The generated media is empty or larger than 100 MB")
    suffix = source.suffix.lower()
    if suffix not in MEDIA_EXTENSIONS:
        raise RuntimeError("The generated media format is unsupported")
    ARTIFACT_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = safe_child(ARTIFACT_ROOT, job_id + suffix)
    with jobs_lock:
        previous = artifacts.pop(job_id, None)
    remove_artifact_file(previous)
    try:
        destination.unlink()
    except FileNotFoundError:
        pass
    os.replace(source, destination)
    created_at = time.time()
    record = {
        "id": job_id,
        "path": str(destination),
        "byte_size": size,
        "media_type": media_type,
        "created_at": created_at,
    }
    with jobs_lock:
        artifacts[job_id] = record
    return {
        "id": job_id,
        "byteSize": size,
        "mediaType": media_type,
        "chunkSize": ARTIFACT_CHUNK_BYTES,
        "expiresAt": created_at + ARTIFACT_TTL_SECONDS,
    }

def replace_names(value, replacements):
    if isinstance(value, str):
        return replacements.get(value, value)
    if isinstance(value, list):
        return [replace_names(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: replace_names(item, replacements) for key, item in value.items()}
    return value

def decode_image(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("The reference image is empty")
    encoded = value.split(",", 1)[1] if "," in value and ";base64" in value.split(",", 1)[0] else value
    encoded = "".join(encoded.split())
    if not encoded or len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4 + 8:
        raise ValueError("The reference image is larger than 14 MB")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("The reference image is invalid") from error
    if not decoded or len(decoded) > MAX_IMAGE_BYTES:
        raise ValueError("The reference image is empty or too large")
    return decoded

def workflow_size(workflow):
    try:
        width = int(workflow.get("398:372", {}).get("inputs", {}).get("value", 1280))
        height = int(workflow.get("398:360", {}).get("inputs", {}).get("value", 720))
    except (AttributeError, TypeError, ValueError, OverflowError):
        width, height = 1280, 720
    return max(64, min(2048, width)), max(64, min(2048, height))

def canonical_png(value, target_size=None):
    try:
        image = Image.open(BytesIO(decode_image(value)))
        image.seek(0)
        image = ImageOps.exif_transpose(image)
        image.load()
    except Exception as error:
        raise ValueError("The reference image could not be decoded") from error
    if image.width <= 0 or image.height <= 0 or image.width * image.height > 64 * 1024 * 1024:
        raise ValueError("The reference image dimensions are invalid")
    if "A" in image.getbands():
        background = Image.new("RGB", image.size, (127, 127, 127))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")
    if target_size and (image.width <= 64 or image.height <= 64):
        image = image.resize(target_size, Image.Resampling.LANCZOS)
    elif image.width > 4096 or image.height > 4096:
        image.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue(), image.size

def prepare_workflow(body, job_id):
    payload = json.loads(body)
    job_input = payload.get("input") if isinstance(payload, dict) else None
    workflow = job_input.get("workflow") if isinstance(job_input, dict) else None
    images = job_input.get("images", []) if isinstance(job_input, dict) else []
    task = job_input.get("cinegen_task", "ltx-2.5") if isinstance(job_input, dict) else "ltx-2.5"
    if task not in {"ltx-2.5", "sdxl", "qwen-image-edit"}:
        raise ValueError("The generation task is invalid")
    if not isinstance(workflow, dict):
        raise ValueError("The generation workflow is missing")
    if not isinstance(images, list):
        raise ValueError("The reference image input is invalid")
    target_size = workflow_size(workflow) if task == "ltx-2.5" else None
    replacements = {}
    written = []
    for index, image in enumerate(images):
        if not isinstance(image, dict):
            raise ValueError("The reference image input is invalid")
        original = image.get("name")
        if not isinstance(original, str) or not original.strip():
            raise ValueError("The reference image name is invalid")
        relative = Path("cinegen") / job_id / (str(index) + ".png")
        target = safe_child(COMFY_INPUT_ROOT, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        encoded, _dimensions = canonical_png(image.get("image"), target_size)
        target.write_bytes(encoded)
        replacements[original] = relative.as_posix()
        written.append(target)
    workflow = replace_names(workflow, replacements)
    return workflow, written, task

def history_error(history):
    status = history.get("status") if isinstance(history, dict) else None
    messages = status.get("messages", []) if isinstance(status, dict) else []
    for entry in reversed(messages if isinstance(messages, list) else []):
        if not isinstance(entry, (list, tuple)) or len(entry) < 2 or not isinstance(entry[1], dict):
            continue
        kind, detail = str(entry[0]), entry[1]
        if kind != "execution_error":
            continue
        message = detail.get("exception_message") or detail.get("message") or detail.get("exception_type")
        node = detail.get("node_type") or detail.get("node_id")
        if isinstance(message, str) and message.strip():
            prefix = str(node).strip() + ": " if node else ""
            return (prefix + message.strip())[:1200]
    if isinstance(status, dict) and str(status.get("status_str", "")).lower() in {"error", "failed"}:
        return "ComfyUI could not complete the generation workflow"
    return ""

def wait_for_history(prompt_id):
    deadline = time.time() + 1800
    while time.time() < deadline:
        history = json_request(COMFY + "/history/" + prompt_id, timeout=15)
        entry = history.get(prompt_id)
        if isinstance(entry, dict):
            return entry
        time.sleep(1.5)
    raise TimeoutError("The generation did not finish within 30 minutes")

def output_entries(value, task, found=None):
    found = [] if found is None else found
    if isinstance(value, dict):
        filename = value.get("filename")
        if isinstance(filename, str) and filename.strip():
            media_type = value.get("media_type") or value.get("mime_type") or ""
            suffix = Path(filename).suffix.lower()
            is_video = suffix in VIDEO_EXTENSIONS or (isinstance(media_type, str) and media_type.startswith("video/"))
            is_image = suffix in IMAGE_EXTENSIONS or (isinstance(media_type, str) and media_type.startswith("image/"))
            if (task == "ltx-2.5" and is_video) or (task != "ltx-2.5" and is_image):
                found.append(value)
                return found
        for nested in value.values():
            output_entries(nested, task, found)
    elif isinstance(value, list):
        for nested in value:
            output_entries(nested, task, found)
    return found

def read_outputs(history, job_id, task):
    error = history_error(history)
    if error:
        raise RuntimeError(error)
    entries = output_entries(history.get("outputs", {}), task)
    seen = set()
    for entry in entries:
        filename = str(entry.get("filename", "")).strip()
        subfolder = str(entry.get("subfolder", "")).strip()
        key = (subfolder, filename)
        if not filename or key in seen:
            continue
        seen.add(key)
        if Path(filename).name != filename or Path(subfolder).is_absolute() or ".." in Path(subfolder).parts:
            raise ValueError("The generated media path is invalid")
        path = safe_child(COMFY_OUTPUT_ROOT, subfolder, filename)
        if not path.is_file():
            raise RuntimeError("ComfyUI finished, but its generated media file is missing")
        media_type = mimetypes.guess_type(filename)[0] or ("video/mp4" if task == "ltx-2.5" else "image/png")
        artifact = store_artifact(job_id, path, media_type)
        return {"status": "success", "output": {"artifact": artifact}}
    expected = "video" if task == "ltx-2.5" else "image"
    raise RuntimeError("ComfyUI completed the workflow without returning an " + expected)

def run_comfy_job(job_id, body):
    workflow, input_paths, task = prepare_workflow(body, job_id)
    try:
        submitted = json_request(COMFY + "/prompt", {"prompt": workflow}, timeout=30)
        prompt_id = submitted.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise RuntimeError(provider_error(submitted) or "ComfyUI did not return a render ID")
        return read_outputs(wait_for_history(prompt_id), job_id, task)
    finally:
        for path in input_paths:
            try:
                path.unlink()
            except OSError:
                pass

def run_job(job_id, body):
    global last_model_family
    duration_sec = requested_duration(body)
    task = requested_task(body)
    with render_lock:
        with jobs_lock:
            request_hash = jobs.get(job_id, {}).get("_request_hash")
            jobs[job_id] = {
                "id": job_id,
                "status": "IN_PROGRESS",
                "task": task,
                "_request_hash": request_hash,
            }
        try:
            if last_model_family and last_model_family != task and not KEEP_MODELS_WARM:
                try:
                    json_request(COMFY + "/free", {"unload_models": True, "free_memory": True}, timeout=30)
                except Exception:
                    pass
            last_model_family = task
            output = run_comfy_job(job_id, body)
            result = {
                "id": job_id,
                "status": "COMPLETED",
                "output": output,
                "durationSec": duration_sec,
                "task": task,
            }
        except Exception as error:
            result = {
                "id": job_id,
                "status": "FAILED",
                "error": str(error),
                "durationSec": duration_sec,
                "task": task,
            }
        result["finished_at"] = time.time()
        result["_request_hash"] = request_hash
        with jobs_lock:
            jobs[job_id] = result

def public_job(job):
    if not isinstance(job, dict):
        return job
    return {key: value for key, value in job.items() if not str(key).startswith("_")}

def artifact_chunk(artifact_id, query):
    with jobs_lock:
        artifact = artifacts.get(artifact_id)
    if not isinstance(artifact, dict):
        return 404, {"error": "Artifact not found or expired"}
    try:
        offset = int(query.get("offset", ["0"])[0])
        requested = int(query.get("length", [str(ARTIFACT_CHUNK_BYTES)])[0])
    except (TypeError, ValueError, OverflowError):
        return 400, {"error": "Artifact range is invalid"}
    size = int(artifact.get("byte_size", 0))
    if offset < 0 or offset >= size or requested <= 0 or requested > ARTIFACT_CHUNK_BYTES:
        return 416, {"error": "Artifact range is invalid"}
    length = min(requested, size - offset)
    try:
        with open(artifact["path"], "rb") as source:
            source.seek(offset)
            chunk = source.read(length)
    except (OSError, KeyError):
        with jobs_lock:
            stale = artifacts.pop(artifact_id, None)
        remove_artifact_file(stale)
        return 410, {"error": "Artifact is no longer available"}
    if len(chunk) != length:
        return 500, {"error": "Artifact could not be read completely"}
    return 200, {
        "id": artifact_id,
        "offset": offset,
        "byteSize": size,
        "mediaType": artifact.get("media_type") or "application/octet-stream",
        "data": base64.b64encode(chunk).decode("ascii"),
    }

def delete_artifact(artifact_id):
    with jobs_lock:
        artifact = artifacts.pop(artifact_id, None)
    remove_artifact_file(artifact)
    return artifact is not None

class Gateway(BaseHTTPRequestHandler):
    server_version = "CineGenLTX/1"

    def log_message(self, *_args):
        return

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        return self.headers.get("Authorization") == "Bearer " + TOKEN

    def do_GET(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        cleanup_expired()
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            snapshot = health_snapshot()
            self.send_json(200 if snapshot["ready"] else 503, {
                **snapshot,
                "apiVersion": 2,
                "selectedImageModels": list(SELECTED_IMAGE_MODELS),
                "capabilities": {
                    "asyncJobs": True,
                    "artifactChunks": True,
                    "imageArtifacts": True,
                    "idempotentSubmissions": True,
                    "maxArtifactChunkBytes": ARTIFACT_CHUNK_BYTES,
                },
            })
            return
        if parsed.path.startswith("/status/"):
            job_id = parsed.path.split("/", 2)[-1]
            with jobs_lock:
                job = jobs.get(job_id)
            self.send_json(200 if job else 404, public_job(job) if job else {"error": "Job not found"})
            return
        if parsed.path.startswith("/artifact/"):
            artifact_id = parsed.path.split("/", 2)[-1]
            status, payload = artifact_chunk(artifact_id, urllib.parse.parse_qs(parsed.query))
            self.send_json(status, payload)
            return
        self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/artifact/"):
            self.send_json(404, {"error": "Not found"})
            return
        artifact_id = parsed.path.split("/", 2)[-1]
        delete_artifact(artifact_id)
        self.send_json(200, {"ok": True})

    def do_POST(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        if self.path != "/run":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "Generation request is too large"})
            return
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except Exception:
            self.send_json(400, {"error": "Invalid JSON"})
            return
        job_input = payload.get("input") if isinstance(payload, dict) else None
        requested_job_id = job_input.get("cinegen_job_id") if isinstance(job_input, dict) else None
        if requested_job_id is not None and (
            not isinstance(requested_job_id, str)
            or len(requested_job_id) != 32
            or any(character not in "0123456789abcdef" for character in requested_job_id)
        ):
            self.send_json(422, {"error": "The generation job ID is invalid"})
            return
        job_id = requested_job_id or uuid.uuid4().hex
        request_hash = hashlib.sha256(body).hexdigest()
        created = False
        with jobs_lock:
            existing = jobs.get(job_id)
            if existing is None:
                existing = {
                    "id": job_id,
                    "status": "IN_QUEUE",
                    "task": requested_task(body),
                    "_request_hash": request_hash,
                }
                jobs[job_id] = existing
                created = True
            elif existing.get("_request_hash") != request_hash:
                existing = None
        if existing is None:
            self.send_json(409, {"error": "The generation job ID was already used for different input"})
            return
        if created:
            threading.Thread(target=run_job, args=(job_id, body), daemon=True).start()
        self.send_json(202, public_job(existing))

threading.Thread(target=cleanup_loop, daemon=True).start()
ThreadingHTTPServer(("0.0.0.0", 8000), Gateway).serve_forever()
PY

# Bring the authenticated health gateway up before downloading optional image
# models. Future Pods can now report useful startup progress while those large
# files are still being fetched.
cinegen_hf_token="$(ltx_hf_token)"
case ",$CINEGEN_IMAGE_MODELS," in
    *,sdxl,*)
        ltx_download \
            "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors" \
            "$cinegen_model_root/checkpoints/sd_xl_base_1.0.safetensors" \
            "$cinegen_hf_token"
        ;;
esac
case ",$CINEGEN_IMAGE_MODELS," in
    *,qwen-image-edit,*)
        ltx_download \
            "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors" \
            "$cinegen_model_root/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors" \
            "$cinegen_hf_token"
        ltx_download \
            "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" \
            "$cinegen_model_root/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" \
            "$cinegen_hf_token"
        ltx_download \
            "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors" \
            "$cinegen_model_root/vae/qwen_image_vae.safetensors" \
            "$cinegen_hf_token"
        ltx_download \
            "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" \
            "$cinegen_model_root/loras/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" \
            "$cinegen_hf_token"
        ;;
esac

sed 's/--rp_api_host=0.0.0.0/--rp_api_host=127.0.0.1 --rp_api_port=8001/' /start.sh > /tmp/cinegen-ltx-start.sh
chmod +x /tmp/cinegen-ltx-start.sh
exec /tmp/cinegen-ltx-start.sh`;
class RunpodLtx25Error extends Error {
  constructor(message, code = "RUNPOD_LTX_ERROR", statusCode = 502) {
    super(message);
    __publicField(this, "code");
    __publicField(this, "statusCode");
    this.name = "RunpodLtx25Error";
    this.code = code;
    this.statusCode = statusCode;
  }
}
class RunpodRequestTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`The provider did not respond within ${timeoutMs} ms.`);
    __publicField(this, "timeoutMs");
    this.name = "RunpodRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RunpodLtx25Error(`${label} is required.`, "MISSING_CONFIGURATION", 422);
  }
  return value.trim();
}
function safeId(value, label) {
  const id = required(value, label);
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(id)) {
    throw new RunpodLtx25Error(`${label} is invalid.`, "INVALID_CONFIGURATION", 422);
  }
  return id;
}
async function readResponse$1(res) {
  const text = await res.text();
  if (!text)
    return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
async function responseWithDeadline(fetchImpl, url, init = {}, timeoutMs = RUNPOD_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const forwardAbort = () => controller.abort(upstreamSignal == null ? void 0 : upstreamSignal.reason);
  if (upstreamSignal == null ? void 0 : upstreamSignal.aborted)
    forwardAbort();
  else
    upstreamSignal == null ? void 0 : upstreamSignal.addEventListener("abort", forwardAbort, { once: true });
  let timer;
  const timeoutError = new RunpodRequestTimeoutError(timeoutMs);
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  const operation = (async () => {
    const response2 = await fetchImpl(url, { ...init, signal: controller.signal });
    const payload = await readResponse$1(response2);
    return { response: response2, payload };
  })();
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
    upstreamSignal == null ? void 0 : upstreamSignal.removeEventListener("abort", forwardAbort);
  }
}
function requestTimeoutForUrl(url) {
  try {
    return new URL(url).pathname === "/health" ? POD_HEALTH_TIMEOUT_MS : RUNPOD_REQUEST_TIMEOUT_MS;
  } catch {
    return RUNPOD_REQUEST_TIMEOUT_MS;
  }
}
function providerMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    const record = payload;
    const direct = record.error ?? record.message ?? record.detail;
    if (typeof direct === "string" && direct.trim())
      return direct.slice(0, 800);
    if (Array.isArray(record.errors) && record.errors.length) {
      return JSON.stringify(record.errors).slice(0, 800);
    }
  }
  return fallback;
}
async function request(fetchImpl, url, init, fallback, accepted = [200, 201, 202, 204], timeoutMs = requestTimeoutForUrl(url)) {
  let exchange;
  try {
    exchange = await responseWithDeadline(fetchImpl, url, init, timeoutMs);
  } catch (error) {
    if (error instanceof RunpodRequestTimeoutError) {
      throw new RunpodLtx25Error(`${fallback} RunPod did not respond before the request timed out.`, "PROVIDER_TIMEOUT", 504);
    }
    throw new RunpodLtx25Error(error instanceof Error ? error.message : fallback, "PROVIDER_UNREACHABLE", 502);
  }
  const { response: res, payload } = exchange;
  if (!accepted.includes(res.status)) {
    throw new RunpodLtx25Error(providerMessage(payload, `${fallback} (${res.status})`), "PROVIDER_ERROR", res.status);
  }
  return payload;
}
function runpodHeaders(runpodKey, json2 = false) {
  return {
    Authorization: `Bearer ${runpodKey}`,
    Accept: "application/json",
    ...json2 ? { "Content-Type": "application/json" } : {}
  };
}
function podLogLines(raw) {
  const lines = [];
  for (const frame of raw.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data)
      continue;
    try {
      const payload = JSON.parse(data);
      if (typeof (payload == null ? void 0 : payload.line) === "string")
        lines.push(payload.line);
      else
        lines.push(data);
    } catch {
      lines.push(data);
    }
  }
  return lines;
}
async function readPodLogSnapshot(fetchImpl, runpodKey, podId) {
  var _a;
  const controller = new AbortController();
  const overall = setTimeout(() => controller.abort(), POD_LOG_MAX_WAIT_MS);
  let reader;
  try {
    const endpoint = new URL(`${RUNPOD_REST_V2_URL}/pods/${encodeURIComponent(podId)}/logs`);
    endpoint.searchParams.set("tail", "200");
    const response2 = await fetchImpl(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${runpodKey}`,
        Accept: "text/event-stream"
      },
      signal: controller.signal
    });
    if (!response2.ok || !((_a = response2.body) == null ? void 0 : _a.getReader))
      return [];
    reader = response2.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let next = await reader.read();
    while (!next.done && raw.length < POD_LOG_MAX_BYTES) {
      raw += decoder.decode(next.value, { stream: true });
      if (raw.length >= POD_LOG_MAX_BYTES)
        break;
      let quietTimer;
      const quiet = new Promise((resolve) => {
        quietTimer = setTimeout(() => resolve({ quiet: true }), POD_LOG_QUIET_MS);
      });
      next = await Promise.race([reader.read(), quiet]);
      clearTimeout(quietTimer);
      if (next == null ? void 0 : next.quiet)
        break;
    }
    raw += decoder.decode();
    return podLogLines(raw.slice(0, POD_LOG_MAX_BYTES));
  } catch {
    return [];
  } finally {
    clearTimeout(overall);
    controller.abort();
    if (reader) {
      try {
        await reader.cancel();
      } catch {
      }
      try {
        reader.releaseLock();
      } catch {
      }
    }
  }
}
function fatalPodStartupFailure(lines) {
  const fatalPatterns = [
    /\b(?:errimagepull|imagepullbackoff)\b/i,
    /\bpull access denied\b/i,
    /\bfailed to get hub registry auth\b/i,
    /\bno such image:\s*\S+/i,
    /\bmanifest unknown\b/i,
    /\bno matching manifest\b/i,
    /\brepository\b.{0,180}\b(?:does not exist|not found)\b/i,
    /\bfailed to authorize\b/i,
    /\b(?:unauthorized|authentication required|no basic auth credentials)\b.{0,180}\b(?:image|registry|repository|manifest)\b/i,
    /\b(?:image|registry|repository|manifest)\b.{0,180}\b(?:unauthorized|authentication required|access denied)\b/i,
    /\b(?:failed|unable) to (?:pull|resolve) (?:image|reference)\b/i,
    /\bpull rate limit\b/i,
    /\boci runtime create failed\b/i,
    /\bfailed to (?:create|start) container\b/i,
    /\berror creating container\b/i,
    /\bcontainer (?:create|start) failed\b/i,
    /\bexec format error\b/i,
    /\bexec\b.{0,180}\b(?:no such file or directory|permission denied)\b/i
  ];
  return lines.some((line) => fatalPatterns.some((pattern) => pattern.test(line)));
}
const APPLICATION_STARTUP_FAILURES = Object.freeze([
  Object.freeze({
    kind: "huggingface-access",
    patterns: Object.freeze([
      /\bgatedrepoerror\b/i,
      /\b(?:cannot|could not|unable to) access (?:the )?gated (?:repo|repository)\b/i,
      /\b(?:401|403)(?: client error)?\b.{0,240}\bhuggingface\.co\b/i,
      /\bhuggingface\.co\b.{0,240}\b(?:401|403|unauthorized|forbidden|access denied)\b/i,
      /\binvalid user token\b/i,
      /\baccess to (?:this )?(?:model|repository) is restricted\b/i
    ]),
    message: "Hugging Face rejected a required model download. Check the read token and accept the model terms. The Pod is still running and billing until you end the session."
  }),
  Object.freeze({
    kind: "disk-full",
    patterns: Object.freeze([/\bno space left on device\b/i, /\[errno 28\]/i]),
    message: "The Pod ran out of temporary disk while downloading the models. End this session, then start a new one with more container disk. The Pod is still billing until you end it."
  }),
  Object.freeze({
    kind: "gpu-memory",
    patterns: Object.freeze([
      /\bcuda out of memory\b/i,
      /\btorch\.outofmemoryerror\b/i,
      /\boutofmemoryerror\b/i,
      /\b(?:oom[- ]kill|killed process)\b/i,
      /\b(?:exit(?:ed)?(?: with)?(?: code)?|status)\s*137\b/i
    ]),
    message: "The selected GPU ran out of memory while loading the session models. End this session and choose a higher-memory GPU. The Pod is still billing until you end it."
  }),
  Object.freeze({
    kind: "cuda-startup",
    patterns: Object.freeze([
      /\bgpu is not available\.? pytorch cuda init failed\b/i,
      /\bcuda (?:initialization|driver initialization) (?:error|failed)\b/i,
      /\bno cuda gpus? (?:are )?available\b/i,
      /\bcuda driver version is insufficient\b/i
    ]),
    message: "RunPod could not initialize the GPU for this session. End the session and try another GPU. The Pod is still billing until you end it."
  }),
  Object.freeze({
    kind: "comfy-startup",
    patterns: Object.freeze([
      /\bcomfyui model discovery failed after\b/i,
      /\bcomfyui\b.{0,180}\b(?:failed to start|startup failed|exited unexpectedly|crashed)\b/i,
      /\b(?:failed|unable) to connect to comfyui\b/i,
      /\bconnection refused\b.{0,120}\b8188\b/i,
      /\bredis failed to (?:start|pass (?:its )?readiness check)\b/i
    ]),
    message: "ComfyUI could not finish starting or discover the required models. The Pod was kept so you can inspect it; it is still billing until you end the session."
  }),
  Object.freeze({
    kind: "session-api-startup",
    patterns: Object.freeze([
      /\b(?:handler|session api)\b.{0,180}\b(?:failed to start|startup failed|exited unexpectedly|crashed)\b/i,
      /\bunrecognized arguments:\b.{0,180}\b--rp_api_port\b/i,
      /\b(?:address already in use|errno 98)\b/i
    ]),
    message: "The session API could not finish starting. The Pod was kept so you can inspect it; it is still billing until you end the session."
  })
]);
function applicationPodStartupFailure(lines) {
  for (const failure of APPLICATION_STARTUP_FAILURES) {
    if (lines.some((line) => failure.patterns.some((pattern) => pattern.test(line))))
      return failure;
  }
  return void 0;
}
function imageModelNames(values) {
  if (!Array.isArray(values))
    return [];
  const names = [];
  for (const value of values) {
    const name2 = value === "sdxl" ? "SDXL" : value === "qwen-image-edit" ? "Qwen Image Edit" : void 0;
    if (name2 && !names.includes(name2))
      names.push(name2);
  }
  return names;
}
function healthStartupProgress(payload) {
  if (!payload || typeof payload !== "object")
    return void 0;
  const phase = typeof payload.phase === "string" ? payload.phase : "";
  if (phase === "downloading-image-models") {
    const names = imageModelNames(payload.missingModels);
    return names.length ? `Downloading ${names.join(" and ")} for this temporary session…` : "Downloading the selected image models for this temporary session…";
  }
  if (phase === "loading-ltx" || phase === "downloading")
    return "Downloading and loading LTX-2.5 into the GPU…";
  if (phase === "verifying-models")
    return "ComfyUI is verifying the models and starting the session API…";
  if (phase === "starting-comfyui")
    return "Starting ComfyUI and discovering the session models…";
  return void 0;
}
function logStartupProgress(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/\b(?:still fetching|pulling|downloading) (?:the )?(?:container )?image\b/i.test(line))
      return "RunPod is downloading the CineGen container image…";
    if (/\b(?:qwen(?:_image)?|sd[_ -]?xl)\b/i.test(line) && /\b(?:download|fetch)\w*\b/i.test(line))
      return "Downloading the selected image models for this temporary session…";
    if (/\b(?:model discovery|discovering|required models|verif\w* models?)\b/i.test(line))
      return "ComfyUI is verifying the required models…";
    if (/\bcomfyui\b/i.test(line) && /\b(?:start|launch|initializ)\w*\b/i.test(line))
      return "Starting ComfyUI…";
    if (/\b(?:cuda kernels?|loading (?:the )?(?:model|text encoder).*(?:gpu|cuda))\b/i.test(line))
      return "Loading the models into the GPU…";
    if (/\b(?:download|fetch)\w*\b/i.test(line) && /\b(?:ltx|weights?|checkpoint|model)\b/i.test(line))
      return "Downloading LTX-2.5 model files…";
  }
  return void 0;
}
async function createSecret(fetchImpl, runpodKey, name2, value) {
  const query = `mutation { secretCreate(input: { name: ${JSON.stringify(name2)}, value: ${JSON.stringify(value)}, description: "Temporary CineGen LTX-2.5 session credential" }) { id name } }`;
  const endpoint = new URL(RUNPOD_GRAPHQL_URL);
  endpoint.searchParams.set("api_key", runpodKey);
  const payload = await request(fetchImpl, endpoint.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query })
  }, "RunPod could not create the encrypted session secret.");
  const errors = payload && Array.isArray(payload.errors) ? payload.errors : [];
  const data = payload == null ? void 0 : payload.data;
  const created = data == null ? void 0 : data.secretCreate;
  if (errors.length || typeof (created == null ? void 0 : created.id) !== "string") {
    throw new RunpodLtx25Error(providerMessage(payload, "RunPod could not create the encrypted session secret."));
  }
  return created.id;
}
async function deleteSecret(fetchImpl, runpodKey, secretId) {
  const query = `mutation { secretDelete(id: ${JSON.stringify(secretId)}) }`;
  const endpoint = new URL(RUNPOD_GRAPHQL_URL);
  endpoint.searchParams.set("api_key", runpodKey);
  await request(fetchImpl, endpoint.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query })
  }, "RunPod could not remove a temporary session secret.");
}
function podUrl(podId) {
  return `https://${podId}-${POD_PORT}.proxy.runpod.net`;
}
function validatePodUrl(value, podIdValue) {
  const podId = safeId(podIdValue, "RunPod session ID");
  const url = new URL(required(value, "RunPod session URL"));
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== `${podId}-${POD_PORT}.proxy.runpod.net`) {
    throw new RunpodLtx25Error("RunPod session URL is invalid.", "INVALID_CONFIGURATION", 422);
  }
  return { podId, url: `${url.origin}` };
}
function randomSuffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
function normalizePod(payload) {
  const pod = payload && typeof payload === "object" ? payload : {};
  const gpuRecord = pod.gpu && typeof pod.gpu === "object" ? pod.gpu : void 0;
  const cost = Number(pod.adjustedCostPerHr ?? pod.costPerHr);
  return {
    id: typeof pod.id === "string" ? pod.id : "",
    costPerHr: Number.isFinite(cost) ? cost : null,
    gpu: typeof (gpuRecord == null ? void 0 : gpuRecord.displayName) === "string" ? gpuRecord.displayName : typeof (gpuRecord == null ? void 0 : gpuRecord.id) === "string" ? gpuRecord.id : null,
    desiredStatus: typeof pod.desiredStatus === "string" ? pod.desiredStatus : "UNKNOWN"
  };
}
function gpuProfile(value) {
  const name2 = value === void 0 ? DEFAULT_LTX25_GPU_PROFILE : value;
  if (typeof name2 !== "string" || !Object.hasOwn(LTX25_GPU_PROFILES, name2)) {
    throw new RunpodLtx25Error("Choose a valid LTX-2.5 GPU profile: economy, balanced, or performance.", "INVALID_GPU_PROFILE", 422);
  }
  return { name: name2, config: LTX25_GPU_PROFILES[name2] };
}
function normalizeImageModels(value) {
  if (value === void 0)
    return [];
  if (!Array.isArray(value)) {
    throw new RunpodLtx25Error("Image models must be an array.", "INVALID_IMAGE_MODELS", 422);
  }
  const models2 = [];
  for (const model of value) {
    if (typeof model !== "string" || !IMAGE_MODEL_IDS.includes(model)) {
      throw new RunpodLtx25Error("Choose only supported session image models: SDXL or Qwen Image Edit.", "INVALID_IMAGE_MODELS", 422);
    }
    if (!models2.includes(model))
      models2.push(model);
  }
  return models2;
}
function sessionContainerDisk(profile, imageModels) {
  if (imageModels.includes("qwen-image-edit"))
    return Math.max(profile.containerDiskInGb, 200);
  if (imageModels.includes("sdxl"))
    return Math.max(profile.containerDiskInGb, 160);
  return profile.containerDiskInGb;
}
async function setupRunpodLtx25$1(params, fetchImpl = fetch) {
  const runpodKey = required(params.runpodKey, "RunPod API key");
  const huggingFaceToken = required(params.huggingFaceToken, "Hugging Face read token");
  if (!/^hf_[A-Za-z0-9]+$/.test(huggingFaceToken)) {
    throw new RunpodLtx25Error("Enter a valid Hugging Face read token.", "INVALID_HUGGINGFACE_TOKEN", 422);
  }
  const selectedGpuProfile = gpuProfile(params.gpuProfile);
  const imageModels = normalizeImageModels(params.imageModels);
  const suffix = randomSuffix();
  const hfSecretName = `cinegen_ltx25_hf_${suffix}`;
  const authSecretName = `cinegen_ltx25_session_${suffix}`;
  const podAuthToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const secretIds = [];
  try {
    secretIds.push(await createSecret(fetchImpl, runpodKey, hfSecretName, huggingFaceToken));
    secretIds.push(await createSecret(fetchImpl, runpodKey, authSecretName, podAuthToken));
    const payload = await request(fetchImpl, `${RUNPOD_REST_URL}/pods`, {
      method: "POST",
      headers: runpodHeaders(runpodKey, true),
      body: JSON.stringify({
        name: `CineGen LTX-2.5 Session ${suffix}`,
        cloudType: "SECURE",
        computeType: "GPU",
        imageName: LTX25_WORKER_IMAGE,
        gpuTypeIds: [...selectedGpuProfile.config.gpuTypeIds],
        gpuTypePriority: "custom",
        gpuCount: 1,
        allowedCudaVersions: ["13.0"],
        containerDiskInGb: sessionContainerDisk(selectedGpuProfile.config, imageModels),
        volumeInGb: 0,
        ports: [`${POD_PORT}/http`],
        supportPublicIp: true,
        interruptible: false,
        minRAMPerGPU: selectedGpuProfile.config.minRAMPerGPU,
        minVCPUPerGPU: selectedGpuProfile.config.minVCPUPerGPU,
        dockerEntrypoint: [],
        dockerStartCmd: ["bash", "-lc", SESSION_GATEWAY],
        env: {
          RUN_MODE: "local-api",
          PERSIST_WORKSPACE: "false",
          LTX_FRONTEND_ENABLED: "false",
          COMFY_LOG_LEVEL: "INFO",
          LTX25_PRELOAD_VARIANT: "distilled-int8",
          LTX25_PRELOAD_PROMPT_ENHANCER: "true",
          CINEGEN_IMAGE_MODELS: imageModels.join(","),
          CINEGEN_GPU_PROFILE: selectedGpuProfile.name,
          HUGGINGFACE_ACCESS_TOKEN: `{{ RUNPOD_SECRET_${hfSecretName} }}`,
          CINEGEN_POD_TOKEN: `{{ RUNPOD_SECRET_${authSecretName} }}`
        }
      })
    }, "RunPod could not create the LTX-2.5 session Pod.");
    const pod = normalizePod(payload);
    if (!pod.id)
      throw new RunpodLtx25Error("RunPod created a Pod without returning its ID.");
    return {
      podId: pod.id,
      podUrl: podUrl(pod.id),
      podAuthToken,
      secretIds,
      status: "downloading",
      phase: "downloading",
      message: "RunPod is downloading and loading LTX-2.5. The first session can take a while.",
      gpuProfile: selectedGpuProfile.name,
      imageModels,
      costPerHr: pod.costPerHr,
      gpu: pod.gpu
    };
  } catch (error) {
    await Promise.allSettled(secretIds.map((secretId) => deleteSecret(fetchImpl, runpodKey, secretId)));
    throw error;
  }
}
async function getRunpodLtx25Status$1(params, fetchImpl = fetch) {
  const runpodKey = required(params.runpodKey, "RunPod API key");
  const podAuthToken = required(params.podAuthToken, "RunPod session token");
  const target = validatePodUrl(params.podUrl, params.podId);
  let podPayload;
  try {
    podPayload = await request(fetchImpl, `${RUNPOD_REST_URL}/pods/${target.podId}`, {
      headers: runpodHeaders(runpodKey)
    }, "RunPod could not read the LTX-2.5 session.");
  } catch (error) {
    if (error instanceof RunpodLtx25Error && error.statusCode === 404) {
      return {
        status: "ended",
        phase: "ended",
        podId: target.podId,
        podUrl: target.url,
        message: "This LTX-2.5 session has ended.",
        costPerHr: null,
        gpu: null
      };
    }
    throw error;
  }
  const pod = normalizePod(podPayload);
  let healthObservation;
  if (pod.desiredStatus === "RUNNING") {
    try {
      const { response: health, payload: body } = await responseWithDeadline(fetchImpl, `${target.url}/health`, {
        headers: { Authorization: `Bearer ${podAuthToken}`, Accept: "application/json" }
      }, POD_HEALTH_TIMEOUT_MS);
      if (health.status === 401 || health.status === 403) {
        return {
          status: "error",
          phase: "error",
          podId: target.podId,
          podUrl: target.url,
          message: "CineGen could not authenticate with this Pod. End the session and start a new one. The current Pod keeps billing until you end it.",
          costPerHr: pod.costPerHr,
          gpu: pod.gpu
        };
      }
      if (health.ok && (body == null ? void 0 : body.ready) === true) {
        if (!supportsReliableArtifactTransfer(body)) {
          return {
            status: "error",
            phase: "error",
            podId: target.podId,
            podUrl: target.url,
            message: "This Pod is running, but it was started before CineGen's reliable video-transfer update. End this session when you are ready, then start a new LTX-2.5 session. The current Pod keeps billing until you end it.",
            costPerHr: pod.costPerHr,
            gpu: pod.gpu
          };
        }
        return {
          status: "ready",
          phase: "ready",
          podId: target.podId,
          podUrl: target.url,
          message: "LTX-2.5 is loaded and ready to generate.",
          costPerHr: pod.costPerHr,
          gpu: pod.gpu
        };
      }
      healthObservation = { kind: "response", status: health.status, body };
    } catch (error) {
      healthObservation = error instanceof RunpodRequestTimeoutError ? { kind: "timeout" } : { kind: "unreachable" };
    }
  }
  const logLines = await readPodLogSnapshot(fetchImpl, runpodKey, target.podId);
  const applicationFailure = applicationPodStartupFailure(logLines);
  if (!applicationFailure && fatalPodStartupFailure(logLines)) {
    try {
      const cleanup = await terminateRunpodLtx25$1({
        runpodKey,
        podId: target.podId,
        secretIds: params.secretIds
      }, fetchImpl);
      return {
        status: "error",
        phase: "startup-failed-cleaned",
        podId: target.podId,
        podUrl: target.url,
        message: cleanup.warning ? "The LTX-2.5 container could not start. CineGen deleted the failed Pod and billing stopped, but RunPod could not remove one temporary secret. Check RunPod Secrets." : "The LTX-2.5 container could not start. CineGen deleted the failed Pod and temporary secrets; billing stopped.",
        costPerHr: null,
        gpu: pod.gpu
      };
    } catch {
      return {
        status: "error",
        phase: "startup-failed-cleanup-required",
        podId: target.podId,
        podUrl: target.url,
        message: "The LTX-2.5 container could not start, and CineGen could not confirm cleanup. Delete this Pod in RunPod now to stop billing.",
        costPerHr: pod.costPerHr,
        gpu: pod.gpu
      };
    }
  }
  if (applicationFailure) {
    return {
      status: "error",
      phase: "error",
      podId: target.podId,
      podUrl: target.url,
      message: applicationFailure.message,
      startupFailure: applicationFailure.kind,
      costPerHr: pod.costPerHr,
      gpu: pod.gpu
    };
  }
  if (pod.desiredStatus !== "RUNNING") {
    return {
      status: "error",
      phase: "error",
      podId: target.podId,
      podUrl: target.url,
      message: `RunPod reports the session as ${pod.desiredStatus.toLowerCase()}.`,
      costPerHr: pod.costPerHr,
      gpu: pod.gpu
    };
  }
  let message;
  if ((healthObservation == null ? void 0 : healthObservation.kind) === "timeout") {
    message = "RunPod reports the Pod is running, but its private gateway did not answer within 7 seconds. It may still be starting; check again shortly. Billing continues while the Pod runs.";
  } else if ((healthObservation == null ? void 0 : healthObservation.kind) === "response" && (healthObservation.status === 502 || healthObservation.status === 504)) {
    message = `RunPod reports the Pod is running, but its private gateway returned ${healthObservation.status}. The container may still be starting; check again shortly. Billing continues while the Pod runs.`;
  } else {
    message = healthStartupProgress(healthObservation == null ? void 0 : healthObservation.body) ?? logStartupProgress(logLines);
  }
  if (!message && (healthObservation == null ? void 0 : healthObservation.kind) === "unreachable") {
    message = "RunPod reports the Pod is running, but its private gateway is not reachable yet. The container may still be starting; check again shortly. Billing continues while the Pod runs.";
  } else if (!message && (healthObservation == null ? void 0 : healthObservation.kind) === "response" && healthObservation.status >= 400) {
    message = `RunPod reports the Pod is running, but its private gateway returned HTTP ${healthObservation.status}. Check again shortly. Billing continues while the Pod runs.`;
  }
  return {
    status: "downloading",
    phase: "downloading",
    podId: target.podId,
    podUrl: target.url,
    message: message ?? "Downloading weights and loading LTX-2.5 into the GPU…",
    costPerHr: pod.costPerHr,
    gpu: pod.gpu
  };
}
async function terminateRunpodLtx25$1(params, fetchImpl = fetch) {
  const runpodKey = required(params.runpodKey, "RunPod API key");
  const podId = safeId(params.podId, "RunPod session ID");
  await request(fetchImpl, `${RUNPOD_REST_URL}/pods/${podId}`, {
    method: "DELETE",
    headers: runpodHeaders(runpodKey)
  }, "RunPod could not end the LTX-2.5 session.", [200, 204, 404]);
  const secretIds = Array.isArray(params.secretIds) ? params.secretIds.filter((value) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value)) : [];
  const cleanup = await Promise.allSettled(secretIds.map((secretId) => deleteSecret(fetchImpl, runpodKey, secretId)));
  const failed = cleanup.filter((result) => result.status === "rejected").length;
  return failed ? { ok: true, warning: "The Pod was deleted and billing stopped, but one temporary RunPod secret could not be removed." } : { ok: true };
}
function dimensions(aspectRatio, resolution) {
  if (resolution === "480p") {
    if (aspectRatio === "9:16")
      return { width: 480, height: 864 };
    if (aspectRatio === "1:1")
      return { width: 480, height: 480 };
    return { width: 864, height: 480 };
  }
  if (aspectRatio === "9:16")
    return resolution === "1080p" ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  if (aspectRatio === "1:1")
    return resolution === "1080p" ? { width: 1080, height: 1080 } : { width: 1024, height: 1024 };
  return resolution === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}
function referenceDataImages(input) {
  return Array.isArray(input.referenceImages) ? input.referenceImages.filter((value) => typeof value === "string" && value.trim()) : [];
}
function buildWorkflow(input) {
  const workflow = JSON.parse(JSON.stringify(workflowTemplate));
  const prompt = required(input.prompt, "Video prompt");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new RunpodLtx25Error("The LTX-2.5 video prompt is too long.", "PROMPT_TOO_LONG", 422);
  }
  const durationSec = Math.min(20, Math.max(1, Math.round(Number(input.durationSec) || 5)));
  const aspectRatio = ["16:9", "9:16", "1:1"].includes(input.aspectRatio ?? "") ? input.aspectRatio : "16:9";
  const resolution = input.resolution === "480p" || input.resolution === "1080p" ? input.resolution : "720p";
  const size = dimensions(aspectRatio, resolution);
  workflow["398:376"].inputs.value = prompt;
  workflow["395"].inputs.image = "cinegen-source.png";
  workflow["398:362"].inputs.value = durationSec;
  workflow["398:372"].inputs.value = size.width;
  workflow["398:360"].inputs.value = size.height;
  workflow["398:361"].inputs.value = 24;
  workflow["398:380"].inputs.sampling_mode = "on";
  workflow["398:380"].inputs["sampling_mode.seed"] = Math.floor(Math.random() * 999999998) + 1;
  workflow["398:383"].inputs.value = input.generateAudio !== false;
  workflow["398:363"].inputs.value = referenceDataImages(input).length === 0;
  workflow["398:338"].inputs.noise_seed = Math.floor(Math.random() * 999999999999998) + 1;
  workflow["398:339"].inputs.noise_seed = Math.floor(Math.random() * 999999999999998) + 1;
  return workflow;
}
function imageData(input) {
  const references = referenceDataImages(input);
  const candidate = references.find((value) => value.startsWith("data:image/")) ?? (references.length ? "" : DEFAULT_FRAME);
  const match = /^data:(image\/(?:png|jpeg|webp|gif|bmp|avif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(candidate);
  if (!match || !match[2] || match[2].length % 4 === 1) {
    throw new RunpodLtx25Error("The LTX-2.5 reference image could not be prepared.", "INVALID_REFERENCE", 422);
  }
  const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor(match[2].length * 0.75) - padding;
  if (estimatedBytes > MAX_REFERENCE_BYTES$1) {
    throw new RunpodLtx25Error("The first LTX-2.5 reference image is larger than 14 MB.", "REFERENCE_TOO_LARGE", 413);
  }
  return candidate;
}
function imageJobModel(value) {
  if (typeof value !== "string" || !IMAGE_MODEL_IDS.includes(value)) {
    throw new RunpodLtx25Error("Choose SDXL or Qwen Image Edit for this image job.", "INVALID_IMAGE_MODEL", 422);
  }
  return value;
}
function optionalImageJobModel(value) {
  try {
    return imageJobModel(value);
  } catch {
    return void 0;
  }
}
function imageModelLabel(model) {
  return model === "sdxl" ? "SDXL" : "Qwen Image Edit 2511";
}
function imageDimension(value, fallback) {
  if (value === void 0 || value === null)
    return fallback;
  const dimension = Number(value);
  if (!Number.isInteger(dimension) || dimension < 256 || dimension > 2048) {
    throw new RunpodLtx25Error("Image width and height must be whole pixels from 256 to 2048.", "INVALID_DIMENSIONS", 422);
  }
  return Math.max(256, Math.min(2048, Math.round(dimension / 16) * 16));
}
function imageSeed(value) {
  if (value === void 0 || value === null)
    return Math.floor(Math.random() * 999999999999998) + 1;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RunpodLtx25Error("Image seed must be a non-negative whole number.", "INVALID_SEED", 422);
  }
  return seed;
}
function imageReferenceData(value, index) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
    typeof value === "string" ? value.trim() : ""
  );
  if (!match || !match[2] || match[2].length % 4 === 1) {
    throw new RunpodLtx25Error(`Qwen reference image ${index + 1} could not be prepared.`, "INVALID_REFERENCE", 422);
  }
  const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor(match[2].length * 0.75) - padding;
  if (estimatedBytes > MAX_REFERENCE_BYTES$1) {
    throw new RunpodLtx25Error(`Qwen reference image ${index + 1} is larger than 14 MB.`, "REFERENCE_TOO_LARGE", 413);
  }
  return value.trim();
}
function imageReferences(input, model) {
  const references = Array.isArray(input.referenceImages) ? input.referenceImages.filter((value) => typeof value === "string" && value.trim()) : [];
  if (model === "sdxl" && references.length) {
    throw new RunpodLtx25Error("SDXL session jobs are text-to-image and do not accept reference images.", "INVALID_REFERENCE", 422);
  }
  if (model === "qwen-image-edit" && (references.length < 1 || references.length > 3)) {
    throw new RunpodLtx25Error("Qwen Image Edit requires one to three reference images.", "INVALID_REFERENCE_COUNT", 422);
  }
  return references.map(imageReferenceData);
}
function imagePrompt(value, label) {
  const prompt = required(value, label);
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new RunpodLtx25Error(`${label} is too long.`, "PROMPT_TOO_LONG", 422);
  }
  return prompt;
}
function buildSdxlWorkflow(input, prompt, negativePrompt, width, height, seed) {
  const workflow = JSON.parse(JSON.stringify(sdxlWorkflowTemplate));
  workflow["2"].inputs.text = prompt;
  workflow["3"].inputs.text = negativePrompt;
  workflow["4"].inputs.width = width;
  workflow["4"].inputs.height = height;
  workflow["5"].inputs.seed = seed;
  const steps = Number(input.steps);
  if (Number.isFinite(steps))
    workflow["5"].inputs.steps = Math.max(1, Math.min(100, Math.round(steps)));
  const guidance = Number(input.guidanceScale);
  if (Number.isFinite(guidance))
    workflow["5"].inputs.cfg = Math.max(0, Math.min(30, guidance));
  return workflow;
}
function buildQwenImageEditWorkflow(prompt, negativePrompt, seed, references) {
  const workflow = JSON.parse(JSON.stringify(qwenImageEditWorkflowTemplate));
  workflow["10"].inputs.prompt = prompt;
  workflow["11"].inputs.prompt = negativePrompt;
  workflow["15"].inputs.seed = seed;
  for (let index = 1; index < references.length; index += 1) {
    const nodeId = String(7 + index);
    const inputName = `image${index + 1}`;
    workflow[nodeId] = {
      class_type: "LoadImage",
      inputs: { image: `cinegen-qwen-reference-${index + 1}.png` }
    };
    workflow["10"].inputs[inputName] = [nodeId, 0];
    workflow["11"].inputs[inputName] = [nodeId, 0];
  }
  return workflow;
}
function buildSessionImageJob(input) {
  const model = imageJobModel(input.model);
  const prompt = imagePrompt(input.prompt, "Image prompt");
  const negativePrompt = typeof input.negativePrompt === "string" ? input.negativePrompt.trim().slice(0, MAX_PROMPT_CHARS) : model === "sdxl" ? "text, watermark, logo, low quality, distorted" : "";
  const width = imageDimension(input.width, 1024);
  const height = imageDimension(input.height, 1024);
  const seed = imageSeed(input.seed);
  const references = imageReferences(input, model);
  const workflow = model === "sdxl" ? buildSdxlWorkflow(input, prompt, negativePrompt, width, height, seed) : buildQwenImageEditWorkflow(prompt, negativePrompt, seed, references);
  return {
    model,
    label: imageModelLabel(model),
    workflow,
    images: references.map((image, index) => ({
      name: `cinegen-qwen-reference-${index + 1}.png`,
      image
    })),
    // Qwen's official 2511 workflow scales and VAE-encodes Picture 1 as
    // the sampler latent. Keep this false so older active Pod gateways do
    // not try to inject width/height inputs into that VAEEncode node.
    preserveInputDimensions: false
  };
}
function outputRecords(raw, maxDepth = 8) {
  const records = [];
  const visit = (value, parentKey, depth) => {
    if (depth > maxDepth || value === null || value === void 0)
      return;
    if (Array.isArray(value)) {
      for (const item of value)
        visit(item, parentKey, depth + 1);
      return;
    }
    if (typeof value !== "object")
      return;
    const record = value;
    records.push({ record, parentKey });
    for (const [key, nested] of Object.entries(record))
      visit(nested, key, depth + 1);
  };
  visit(raw, "", 0);
  return records;
}
function workerFailure(raw) {
  for (const { record } of outputRecords(raw)) {
    const status = String(record.status ?? record.state ?? "").toLowerCase();
    if (!["error", "failed", "failure", "cancelled", "canceled"].includes(status))
      continue;
    const message = record.error ?? record.message ?? record.detail;
    if (typeof message === "string" && message.trim())
      return message.trim().slice(0, 1200);
    if (message && typeof message === "object") {
      const nested = message.message ?? message.detail;
      if (typeof nested === "string" && nested.trim())
        return nested.trim().slice(0, 1200);
    }
    return "LTX-2.5 generation failed.";
  }
  return void 0;
}
function declaredMediaType(record) {
  const value = record.media_type ?? record.mediaType ?? record.mime_type ?? record.mimeType;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
function mediaTypeOf(record, fallback = "video/mp4") {
  return declaredMediaType(record) || fallback;
}
function isVideoRecord(record, parentKey) {
  if (parentKey === "videos" || parentKey === "video")
    return true;
  const mediaType = declaredMediaType(record);
  if (mediaType.startsWith("video/"))
    return true;
  const filename = record.filename ?? record.name;
  return typeof filename === "string" && /\.(?:mp4|webm|mov|mkv|avi|m4v)(?:$|[?#])/i.test(filename);
}
function isImageRecord(record, parentKey) {
  if (parentKey === "images" || parentKey === "image")
    return true;
  const mediaType = declaredMediaType(record);
  if (mediaType.startsWith("image/"))
    return true;
  const filename = record.filename ?? record.name;
  return typeof filename === "string" && /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(filename);
}
function nonEmptyString(...values) {
  var _a;
  return (_a = values.find((value) => typeof value === "string" && value.trim())) == null ? void 0 : _a.trim();
}
function normalizeWorkerOutput(raw, durationSec) {
  const failure = workerFailure(raw);
  if (failure)
    throw new RunpodLtx25Error(failure, "GENERATION_FAILED", 502);
  for (const { record, parentKey } of outputRecords(raw)) {
    const directUrl = nonEmptyString(record.video_url, record.videoUrl);
    if (directUrl)
      return { url: directUrl, durationSec, model: "LTX-2.5" };
    const directData = nonEmptyString(record.video_base64, record.videoBase64);
    if (directData)
      return { data: directData, mediaType: mediaTypeOf(record), durationSec, model: "LTX-2.5" };
    if (!isVideoRecord(record, parentKey))
      continue;
    const explicitUrl = nonEmptyString(record.url, record.download_url, record.downloadUrl);
    const typedData = nonEmptyString(record.data, record.base64);
    const url = explicitUrl ?? (String(record.type ?? "").toLowerCase() === "url" ? typedData : void 0);
    if (url)
      return { url, durationSec, model: "LTX-2.5" };
    const data = String(record.type ?? "").toLowerCase() === "url" ? void 0 : typedData;
    if (data)
      return { data, mediaType: mediaTypeOf(record), durationSec, model: "LTX-2.5" };
  }
  throw new RunpodLtx25Error("LTX-2.5 completed without returning a video.", "INVALID_PROVIDER_RESPONSE", 502);
}
function normalizeImageWorkerOutput(raw, model) {
  const label = imageModelLabel(model);
  const failure = workerFailure(raw);
  if (failure)
    throw new RunpodLtx25Error(failure, "GENERATION_FAILED", 502);
  for (const { record, parentKey } of outputRecords(raw)) {
    const directUrl = nonEmptyString(record.image_url, record.imageUrl);
    if (directUrl)
      return { url: directUrl, model: label };
    const directData = nonEmptyString(record.image_base64, record.imageBase64);
    if (directData)
      return { data: directData, mediaType: mediaTypeOf(record, "image/png"), model: label };
    if (!isImageRecord(record, parentKey))
      continue;
    const explicitUrl = nonEmptyString(record.url, record.download_url, record.downloadUrl);
    const typedData = nonEmptyString(record.data, record.base64);
    const url = explicitUrl ?? (String(record.type ?? "").toLowerCase() === "url" ? typedData : void 0);
    if (url)
      return { url, model: label };
    const data = String(record.type ?? "").toLowerCase() === "url" ? void 0 : typedData;
    if (data)
      return { data, mediaType: mediaTypeOf(record, "image/png"), model: label };
  }
  throw new RunpodLtx25Error(`${label} completed without returning an image.`, "INVALID_PROVIDER_RESPONSE", 502);
}
function artifactDescriptor(raw, expectedKind = "video", label = "LTX-2.5") {
  for (const { record, parentKey } of outputRecords(raw)) {
    if (parentKey !== "artifact")
      continue;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const byteSize = Number(record.byteSize ?? record.byte_size);
    const mediaType = typeof (record.mediaType ?? record.media_type) === "string" ? String(record.mediaType ?? record.media_type).trim() : "";
    if (!/^[A-Za-z0-9_-]{1,191}$/.test(id) || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_ARTIFACT_BYTES || mediaType && !mediaType.startsWith(`${expectedKind}/`)) {
      throw new RunpodLtx25Error(`${label} returned invalid artifact metadata.`, "INVALID_PROVIDER_RESPONSE", 502);
    }
    return { id, byteSize, mediaType };
  }
  return void 0;
}
function decodeArtifactChunk(value, label = "LTX-2.5", kind = "video") {
  if (typeof value !== "string" || !value || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new RunpodLtx25Error(`${label} returned an invalid ${kind} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  if (typeof atob !== "function") {
    throw new RunpodLtx25Error(`This CineGen runtime cannot decode the generated ${kind}.`, "RUNTIME_UNSUPPORTED", 500);
  }
  let decoded;
  try {
    decoded = atob(value);
  } catch {
    throw new RunpodLtx25Error(`${label} returned an invalid ${kind} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1)
    bytes[index] = decoded.charCodeAt(index);
  return bytes;
}
function artifactMediaType(firstBytes, declared, expectedKind = "video", label = "LTX-2.5") {
  const webm = firstBytes.length >= 4 && firstBytes[0] === 26 && firstBytes[1] === 69 && firstBytes[2] === 223 && firstBytes[3] === 163;
  const mp4 = firstBytes.length >= 12 && String.fromCharCode(...firstBytes.subarray(4, 8)) === "ftyp";
  const png = firstBytes.length >= 8 && firstBytes[0] === 137 && firstBytes[1] === 80 && firstBytes[2] === 78 && firstBytes[3] === 71 && firstBytes[4] === 13 && firstBytes[5] === 10 && firstBytes[6] === 26 && firstBytes[7] === 10;
  const jpeg = firstBytes.length >= 3 && firstBytes[0] === 255 && firstBytes[1] === 216 && firstBytes[2] === 255;
  const webp = firstBytes.length >= 12 && String.fromCharCode(...firstBytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...firstBytes.subarray(8, 12)) === "WEBP";
  if (expectedKind === "image") {
    if (png)
      return "image/png";
    if (jpeg)
      return "image/jpeg";
    if (webp)
      return "image/webp";
    throw new RunpodLtx25Error(`${label} returned an unsupported image file.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  if (!webm && !mp4) {
    throw new RunpodLtx25Error(`${label} returned an unsupported video file.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  if (webm)
    return "video/webm";
  return declared === "video/quicktime" ? "video/quicktime" : "video/mp4";
}
function encodeArtifactBytes(bytes, kind = "media") {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  if (typeof btoa !== "function") {
    throw new RunpodLtx25Error(`This CineGen runtime cannot encode the generated ${kind}.`, "RUNTIME_UNSUPPORTED", 500);
  }
  const segments = [];
  const segmentBytes = 32 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += segmentBytes) {
    const segment = bytes.subarray(offset, Math.min(bytes.byteLength, offset + segmentBytes));
    let binary = "";
    for (let index = 0; index < segment.byteLength; index += 1)
      binary += String.fromCharCode(segment[index]);
    segments.push(binary);
  }
  return btoa(segments.join(""));
}
async function cleanupArtifact(fetchImpl, target, token2, artifactId) {
  try {
    const response2 = await fetchImpl(`${target.url}/artifact/${encodeURIComponent(artifactId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token2}`, Accept: "application/json" }
    });
    await response2.arrayBuffer().catch(() => void 0);
  } catch {
  }
}
async function downloadArtifact(fetchImpl, target, token2, descriptor, expectedKind = "video", label = "LTX-2.5") {
  const assembled = new Uint8Array(descriptor.byteSize);
  let firstBytes;
  const chunks = [];
  for (let offset = 0; offset < descriptor.byteSize; offset += ARTIFACT_CHUNK_BYTES) {
    const length = Math.min(ARTIFACT_CHUNK_BYTES, descriptor.byteSize - offset);
    chunks.push({ offset, length });
  }
  for (let index = 0; index < chunks.length; index += ARTIFACT_DOWNLOAD_CONCURRENCY) {
    const batch = chunks.slice(index, index + ARTIFACT_DOWNLOAD_CONCURRENCY);
    const downloaded = await Promise.all(batch.map(async ({ offset, length }) => {
      const endpoint = new URL(`${target.url}/artifact/${encodeURIComponent(descriptor.id)}`);
      endpoint.searchParams.set("offset", String(offset));
      endpoint.searchParams.set("length", String(length));
      const payload = await request(fetchImpl, endpoint.toString(), {
        headers: { Authorization: `Bearer ${token2}`, Accept: "application/json" }
      }, `CineGen could not download the ${label} ${expectedKind} chunk.`);
      if (!payload || typeof payload !== "object") {
        throw new RunpodLtx25Error(`${label} returned an invalid ${expectedKind} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
      }
      const chunkId = typeof payload.id === "string" ? payload.id : "";
      const chunkOffset = Number(payload.offset);
      const totalSize = Number(payload.byteSize ?? payload.byte_size);
      const chunkMediaType = typeof (payload.mediaType ?? payload.media_type) === "string" ? String(payload.mediaType ?? payload.media_type).trim() : "";
      const bytes = decodeArtifactChunk(payload.data, label, expectedKind);
      if (chunkId !== descriptor.id || chunkOffset !== offset || totalSize !== descriptor.byteSize || descriptor.mediaType && chunkMediaType !== descriptor.mediaType || bytes.byteLength !== length) {
        throw new RunpodLtx25Error(`${label} returned an inconsistent ${expectedKind} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
      }
      return { offset, bytes };
    }));
    for (const chunk of downloaded) {
      if (chunk.offset === 0)
        firstBytes = chunk.bytes.slice(0, 12);
      assembled.set(chunk.bytes, chunk.offset);
    }
  }
  const mediaType = artifactMediaType(firstBytes ?? new Uint8Array(), descriptor.mediaType, expectedKind, label);
  const data = encodeArtifactBytes(assembled, expectedKind);
  await cleanupArtifact(fetchImpl, target, token2, descriptor.id);
  return { data, mediaType };
}
function supportsReliableArtifactTransfer(payload) {
  if (!payload || typeof payload !== "object")
    return false;
  const capabilities = payload.capabilities;
  return Number(payload.apiVersion) >= 2 && capabilities && typeof capabilities === "object" && capabilities.artifactChunks === true;
}
async function requireReliableGateway(fetchImpl, target, token2) {
  const payload = await request(fetchImpl, `${target.url}/health`, {
    headers: { Authorization: `Bearer ${token2}`, Accept: "application/json" }
  }, "CineGen could not verify the LTX-2.5 session.");
  if (supportsReliableArtifactTransfer(payload))
    return payload;
  throw new RunpodLtx25Error(
    "This LTX-2.5 Pod was started before CineGen's reliable video-transfer update. End this session in Settings, then start a new LTX-2.5 session before rendering again.",
    "SESSION_UPDATE_REQUIRED",
    409
  );
}
async function requireSessionImageGateway(fetchImpl, target, token2, model) {
  const payload = await requireReliableGateway(fetchImpl, target, token2);
  const capabilities = payload == null ? void 0 : payload.capabilities;
  const installedModels = Array.isArray(payload == null ? void 0 : payload.installedModels) ? payload.installedModels : [];
  if ((capabilities == null ? void 0 : capabilities.imageArtifacts) !== true) {
    throw new RunpodLtx25Error(
      "This Pod was started before CineGen added session image generation. End it, then start a new session with the image model selected.",
      "SESSION_UPDATE_REQUIRED",
      409
    );
  }
  if (!installedModels.includes(model)) {
    throw new RunpodLtx25Error(
      `${imageModelLabel(model)} was not installed when this Pod was created. Start a new session with that image model selected.`,
      "IMAGE_MODEL_NOT_INSTALLED",
      409
    );
  }
  return payload;
}
function newGenerationJobId() {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}
function submissionMayHaveReachedGateway(error) {
  return error instanceof RunpodLtx25Error && (error.code === "PROVIDER_TIMEOUT" || error.code === "PROVIDER_UNREACHABLE" || error.statusCode === 502 || error.statusCode === 504);
}
async function recoverSubmittedJob(fetchImpl, target, token2, jobId) {
  try {
    const payload = await request(fetchImpl, `${target.url}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${token2}`, Accept: "application/json" }
    }, "CineGen could not recover the submitted generation.", [200, 404]);
    return payload && typeof payload === "object" && payload.id === jobId ? payload : void 0;
  } catch {
    return void 0;
  }
}
async function submitGatewayJob(fetchImpl, target, token2, headers2, gateway, input, fallback) {
  var _a;
  const clientJobId = newGenerationJobId();
  const idempotent = ((_a = gateway == null ? void 0 : gateway.capabilities) == null ? void 0 : _a.idempotentSubmissions) === true;
  const body = JSON.stringify({ input: { ...input, cinegen_job_id: clientJobId } });
  const submit = () => request(fetchImpl, `${target.url}/run`, {
    method: "POST",
    headers: { ...headers2, "Idempotency-Key": clientJobId },
    body
  }, fallback, void 0, POD_SUBMISSION_TIMEOUT_MS);
  for (let attempt = 0; attempt < (idempotent ? 2 : 1); attempt += 1) {
    try {
      const payload = await submit();
      const returnedJobId = typeof (payload == null ? void 0 : payload.id) === "string" ? payload.id : "";
      if (!returnedJobId) {
        throw new RunpodLtx25Error("The session did not return a generation job ID.", "INVALID_PROVIDER_RESPONSE", 502);
      }
      if (idempotent && returnedJobId !== clientJobId) {
        throw new RunpodLtx25Error("The session returned a different generation job ID.", "INVALID_PROVIDER_RESPONSE", 502);
      }
      return { payload, jobId: returnedJobId };
    } catch (error) {
      if (!idempotent || !submissionMayHaveReachedGateway(error))
        throw error;
      const recovered = await recoverSubmittedJob(fetchImpl, target, token2, clientJobId);
      if (recovered)
        return { payload: recovered, jobId: clientJobId };
      if (attempt === 1)
        throw error;
    }
  }
  throw new RunpodLtx25Error("CineGen could not confirm the generation submission.", "PROVIDER_TIMEOUT", 504);
}
async function runRunpodLtx25Job$1(params, fetchImpl = fetch) {
  const target = validatePodUrl(params.podUrl, params.podId);
  const token2 = required(params.podAuthToken, "RunPod session token");
  const headers2 = { Authorization: `Bearer ${token2}`, Accept: "application/json", "Content-Type": "application/json" };
  if (params.jobId) {
    const jobId2 = safeId(params.jobId, "RunPod generation job ID");
    const payload = await request(fetchImpl, `${target.url}/status/${jobId2}`, {
      headers: { Authorization: `Bearer ${token2}`, Accept: "application/json" }
    }, "CineGen could not read the LTX-2.5 generation status.");
    const status = String(payload.status ?? "").toUpperCase();
    if (status === "IN_QUEUE")
      return { jobId: jobId2, status: "queued", phase: "rendering", message: "Waiting for the LTX-2.5 renderer…" };
    if (status === "IN_PROGRESS")
      return { jobId: jobId2, status: "in_progress", phase: "rendering", message: "LTX-2.5 is rendering the video…" };
    if (status === "FAILED")
      return { jobId: jobId2, status: "failed", phase: "error", error: providerMessage(payload, "LTX-2.5 generation failed.") };
    if (status === "COMPLETED") {
      const durationSec2 = Math.min(20, Math.max(1, Math.round(Number(payload.durationSec) || 5)));
      try {
        const artifact = artifactDescriptor(payload.output);
        const output = artifact ? { ...await downloadArtifact(fetchImpl, target, token2, artifact), durationSec: durationSec2, model: "LTX-2.5" } : normalizeWorkerOutput(payload.output, durationSec2);
        return { jobId: jobId2, status: "completed", phase: "ready", output };
      } catch (error) {
        return { jobId: jobId2, status: "failed", phase: "error", error: error instanceof Error ? error.message : "LTX-2.5 generation failed." };
      }
    }
    return { jobId: jobId2, status: "in_progress", phase: "rendering", message: "LTX-2.5 is preparing the video…" };
  }
  if (!params.input)
    throw new RunpodLtx25Error("Video generation input is required.", "MISSING_INPUT", 422);
  const durationSec = Math.min(20, Math.max(1, Math.round(Number(params.input.durationSec) || 5)));
  const submissionInput = {
    workflow: buildWorkflow(params.input),
    images: [{ name: "cinegen-source.png", image: imageData(params.input) }],
    cinegen_duration_sec: durationSec,
    cinegen_task: "ltx-2.5"
  };
  const gateway = await requireReliableGateway(fetchImpl, target, token2);
  const { jobId } = await submitGatewayJob(fetchImpl, target, token2, headers2, gateway, submissionInput, "CineGen could not submit the LTX-2.5 generation.");
  return { jobId, status: "queued", phase: "rendering", message: "LTX-2.5 generation queued." };
}
async function runRunpodSessionImageJob$1(params, fetchImpl = fetch) {
  var _a;
  const target = validatePodUrl(params.podUrl, params.podId);
  const token2 = required(params.podAuthToken, "RunPod session token");
  const headers2 = { Authorization: `Bearer ${token2}`, Accept: "application/json", "Content-Type": "application/json" };
  if (params.jobId) {
    const jobId2 = safeId(params.jobId, "RunPod generation job ID");
    const payload = await request(fetchImpl, `${target.url}/status/${jobId2}`, {
      headers: { Authorization: `Bearer ${token2}`, Accept: "application/json" }
    }, "CineGen could not read the session image generation status.");
    const reportedModel = optionalImageJobModel(payload == null ? void 0 : payload.task);
    const expectedModel = optionalImageJobModel(params.model ?? ((_a = params.input) == null ? void 0 : _a.model));
    if (reportedModel && expectedModel && reportedModel !== expectedModel) {
      return { jobId: jobId2, status: "failed", phase: "error", error: "The Pod returned an image-generation task that does not match this job." };
    }
    const model = reportedModel ?? expectedModel;
    if (!model) {
      return { jobId: jobId2, status: "failed", phase: "error", error: "The Pod returned an invalid image-generation task." };
    }
    const label = imageModelLabel(model);
    const status = String(payload.status ?? "").toUpperCase();
    if (status === "IN_QUEUE")
      return { jobId: jobId2, status: "queued", phase: "rendering", message: `Waiting for the ${label} renderer…` };
    if (status === "IN_PROGRESS")
      return { jobId: jobId2, status: "in_progress", phase: "rendering", message: `${label} is rendering the image…` };
    if (status === "FAILED")
      return { jobId: jobId2, status: "failed", phase: "error", error: providerMessage(payload, `${label} generation failed.`) };
    if (status === "COMPLETED") {
      try {
        const artifact = artifactDescriptor(payload.output, "image", label);
        const output = artifact ? { ...await downloadArtifact(fetchImpl, target, token2, artifact, "image", label), model: label } : normalizeImageWorkerOutput(payload.output, model);
        return { jobId: jobId2, status: "completed", phase: "ready", output };
      } catch (error) {
        return { jobId: jobId2, status: "failed", phase: "error", error: error instanceof Error ? error.message : `${label} generation failed.` };
      }
    }
    return { jobId: jobId2, status: "in_progress", phase: "rendering", message: `${label} is preparing the image…` };
  }
  if (!params.input)
    throw new RunpodLtx25Error("Image generation input is required.", "MISSING_INPUT", 422);
  const imageJob = buildSessionImageJob(params.input);
  const gateway = await requireSessionImageGateway(fetchImpl, target, token2, imageJob.model);
  const { jobId } = await submitGatewayJob(fetchImpl, target, token2, headers2, gateway, {
    workflow: imageJob.workflow,
    images: imageJob.images,
    cinegen_task: imageJob.model,
    cinegen_preserve_input_dimensions: imageJob.preserveInputDimensions
  }, `CineGen could not submit the ${imageJob.label} generation.`);
  return { jobId, status: "queued", phase: "rendering", message: `${imageJob.label} generation queued.` };
}
const setupRunpodLtx25 = setupRunpodLtx25$1;
const getRunpodLtx25Status = getRunpodLtx25Status$1;
const terminateRunpodLtx25 = terminateRunpodLtx25$1;
const runRunpodLtx25Job = runRunpodLtx25Job$1;
const runRunpodSessionImageJob = runRunpodSessionImageJob$1;
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
const HIGGSFIELD_MEDIA_ROLES = /* @__PURE__ */ new Set([
  "image",
  "start_image",
  "end_image",
  "video",
  "audio"
]);
const HIGGSFIELD_MEDIA_PARAM_ROLES = {
  // Exact CLI role keys and their common URL aliases.
  image: "image",
  image_references: "image",
  start_image: "start_image",
  start_image_url: "start_image",
  end_image: "end_image",
  end_image_url: "end_image",
  video: "video",
  video_url: "video",
  video_references: "video",
  audio: "audio",
  audio_url: "audio",
  audio_references: "audio",
  // Model-schema media params returned by `higgsfield model get`.
  input_images: "image",
  input_image: "image",
  input_video: "video",
  input_audio: "audio",
  sketch: "image",
  ref_image: "image",
  urls: "video",
  // Legacy CineGen fields. Video nodes historically treat these as first-frame inputs.
  image_url: "legacy-image",
  imageUrl: "legacy-image",
  image_urls: "legacy-image"
};
function localMediaPath(value) {
  if (!value.startsWith("local-media://file")) return value;
  try {
    return decodeURIComponent(value.slice("local-media://file".length));
  } catch {
    return value.slice("local-media://file".length);
  }
}
function mediaRoleFromValue(value, fallback) {
  const explicitRole = value.role ?? value.media_role ?? value.mediaRole;
  if (typeof explicitRole === "string" && HIGGSFIELD_MEDIA_ROLES.has(explicitRole)) {
    return { role: explicitRole, explicit: true };
  }
  const kind = String(value.type ?? value.kind ?? value.media_type ?? value.mediaType ?? value.mime_type ?? "").toLowerCase();
  if (kind === "start_image" || kind === "start-image") return { role: "start_image", explicit: true };
  if (kind === "end_image" || kind === "end-image") return { role: "end_image", explicit: true };
  if (kind.includes("audio")) return { role: "audio", explicit: true };
  if (kind.includes("video")) return { role: "video", explicit: true };
  if (kind.includes("image")) return { role: "image", explicit: true };
  return { role: fallback, explicit: false };
}
function inferMediaRoleFromReference(value, fallback) {
  const normalized = value.split(/[?#]/, 1)[0].toLowerCase();
  if (normalized.startsWith("data:audio/") || /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/.test(normalized)) {
    return "audio";
  }
  if (normalized.startsWith("data:video/") || /\.(?:avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(normalized)) {
    return "video";
  }
  return fallback;
}
function fallbackMediaRoleForOutput(outputKind) {
  if (outputKind === "video") return "start_image";
  if (outputKind === "text") return "video";
  if (outputKind === "audio") return "audio";
  return "image";
}
function mediaReferencesFromValue(value, fallbackRole, inferRoleFromExtension = false) {
  if (typeof value === "string") {
    const normalized = localMediaPath(value).trim();
    const role = inferRoleFromExtension ? inferMediaRoleFromReference(normalized, fallbackRole) : fallbackRole;
    return normalized ? [{ value: normalized, role }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => mediaReferencesFromValue(entry, fallbackRole, inferRoleFromExtension));
  }
  if (!value || typeof value !== "object") return [];
  const record = value;
  const roleDescriptor = mediaRoleFromValue(record, fallbackRole);
  if (Array.isArray(record.allUrls)) {
    return record.allUrls.flatMap((entry) => mediaReferencesFromValue(
      entry,
      roleDescriptor.role,
      inferRoleFromExtension && !roleDescriptor.explicit
    ));
  }
  const candidate = record.value ?? record.url ?? record.fileRef ?? record.path ?? record.id ?? record.uuid ?? record.media_id ?? record.mediaId ?? record.frontalImageUrl;
  return mediaReferencesFromValue(
    candidate,
    roleDescriptor.role,
    inferRoleFromExtension && !roleDescriptor.explicit
  );
}
function buildHiggsfieldWorkflowRequest(model, input, outputKind) {
  const medias = [];
  const genericParams = {};
  const fallbackMediaRole = model === "seedance_2_5" ? "image" : fallbackMediaRoleForOutput(outputKind);
  for (const [key, value] of Object.entries(input)) {
    if (value === void 0 || value === null) continue;
    if (key === "medias" || key === "higgsfield_media_inputs") {
      medias.push(...mediaReferencesFromValue(
        value,
        fallbackMediaRole,
        true
      ));
      continue;
    }
    const mappedRole = HIGGSFIELD_MEDIA_PARAM_ROLES[key];
    if (mappedRole) {
      const role = mappedRole === "legacy-image" ? outputKind === "video" ? "start_image" : "image" : mappedRole;
      medias.push(...mediaReferencesFromValue(value, role));
      continue;
    }
    genericParams[key] = value;
  }
  if (model === "seedance_2_5" && medias.length > 0 && (!genericParams.mode || genericParams.mode === "t2v")) {
    const hasVisualStill = medias.some((media) => media.role === "image" || media.role === "start_image" || media.role === "end_image");
    genericParams.mode = hasVisualStill ? "omni_reference" : "video_edit";
  }
  return {
    model,
    mediaType: outputKind,
    ...medias.length > 0 ? { medias } : {},
    ...Object.keys(genericParams).length > 0 ? { params: genericParams } : {}
  };
}
function normalizeHiggsfieldWorkflowResult(result) {
  const output = {};
  if (result.url) output.url = result.url;
  if (result.urls) output.urls = result.urls;
  if (result.text) output.text = result.text;
  if (result.durationSec !== void 0) output.duration = result.durationSec;
  return {
    output,
    ...result.url ? { url: result.url } : {},
    ...result.urls ? { urls: result.urls } : {},
    ...result.text ? { text: result.text } : {},
    ...result.jobId ? { jobId: result.jobId } : {},
    model: result.model,
    mediaType: result.mediaType,
    outputKind: result.outputKind
  };
}
async function generateWithHiggsfield(model, input, outputKind) {
  const result = await generateHiggsfield(buildHiggsfieldWorkflowRequest(model, input, outputKind));
  return normalizeHiggsfieldWorkflowResult(result);
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
async function generateWithPod(podUrl2, route, input) {
  const url = `${podUrl2.replace(/\/$/, "")}/generate/${route}`;
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
const LTX25_MAX_REFERENCE_BYTES = 14 * 1024 * 1024;
const LTX25_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const RUNPOD_SESSION_MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const LTX25_REFERENCE_TIMEOUT_MS = 45e3;
function ltx25ImageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && /^(avif|avis)$/.test(bytes.subarray(8, 12).toString("ascii"))) return "image/avif";
  return void 0;
}
function ltx25PublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The LTX-2.5 first-frame reference URL is invalid.");
  }
  const host = url.hostname.toLowerCase();
  const isIpLiteral = /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":");
  if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIpLiteral) {
    throw new Error("The LTX-2.5 first-frame reference must use a public HTTPS URL.");
  }
  return url;
}
async function readLtx25Reference(response2) {
  const declared = Number(response2.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LTX25_MAX_REFERENCE_BYTES) {
    throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
  }
  if (!response2.body) {
    const bytes = Buffer.from(await response2.arrayBuffer());
    if (bytes.byteLength > LTX25_MAX_REFERENCE_BYTES) throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
    return bytes;
  }
  const reader = response2.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LTX25_MAX_REFERENCE_BYTES) {
        await reader.cancel();
        throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}
function ltx25ImageDataUrl(bytes) {
  const type = ltx25ImageType(bytes);
  if (!type) throw new Error("LTX-2.5 requires a supported raster image as its first-frame reference.");
  return `data:${type};base64,${bytes.toString("base64")}`;
}
async function ltx25ReferenceToDataUrl(value) {
  if (value.startsWith("data:image/")) return value;
  if (value.startsWith("local-media://file")) {
    const filePath = localMediaPath(value);
    const stat = await fs$1.stat(filePath);
    if (!stat.isFile()) throw new Error("The LTX-2.5 first-frame reference is not a file.");
    if (stat.size > LTX25_MAX_REFERENCE_BYTES) throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
    const bytes = await fs$1.readFile(filePath);
    return ltx25ImageDataUrl(bytes);
  }
  if (/^https?:\/\//i.test(value)) {
    const url = ltx25PublicUrl(value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LTX25_REFERENCE_TIMEOUT_MS);
    let response2;
    try {
      response2 = await fetch(url, { redirect: "error", signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      throw new Error("Could not load the LTX-2.5 first-frame reference.");
    }
    try {
      if (!response2.ok) throw new Error(`Could not load the LTX-2.5 first-frame reference (${response2.status}).`);
      return ltx25ImageDataUrl(await readLtx25Reference(response2));
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Loading the LTX-2.5 first-frame reference timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("The LTX-2.5 first-frame reference is not available to the desktop app.");
}
async function prepareLtx25Input(input) {
  var _a;
  const first = (_a = input.referenceImages) == null ? void 0 : _a.find((value) => typeof value === "string" && value.trim());
  return {
    ...input,
    referenceImages: first ? [await ltx25ReferenceToDataUrl(first)] : void 0
  };
}
function sessionImageDataUrl(value, index) {
  var _a;
  const match = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(value.trim());
  const encoded = ((_a = match == null ? void 0 : match[1]) == null ? void 0 : _a.replace(/\s+/g, "")) ?? "";
  if (!encoded || encoded.length > Math.ceil(LTX25_MAX_REFERENCE_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error(`RunPod reference image ${index + 1} is invalid or larger than 14 MB.`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.byteLength > LTX25_MAX_REFERENCE_BYTES) {
    throw new Error(`RunPod reference image ${index + 1} is invalid or larger than 14 MB.`);
  }
  const mediaType = ltx25ImageType(bytes);
  if (mediaType !== "image/png" && mediaType !== "image/jpeg" && mediaType !== "image/webp") {
    throw new Error(`RunPod reference image ${index + 1} must be a PNG, JPEG, or WebP image.`);
  }
  return `data:${mediaType};base64,${bytes.toString("base64")}`;
}
async function prepareSessionImageInput(input) {
  const references = Array.isArray(input.referenceImages) ? input.referenceImages.filter((value) => typeof value === "string" && value.trim()) : [];
  if (references.length > 3) {
    throw new Error("RunPod session image jobs support up to three reference images.");
  }
  const preparedReferences = await Promise.all(references.map(async (reference, index) => {
    const dataUrl = reference.trim().startsWith("data:") ? reference : await ltx25ReferenceToDataUrl(reference.trim());
    return sessionImageDataUrl(dataUrl, index);
  }));
  return {
    ...input,
    referenceImages: preparedReferences.length ? preparedReferences : void 0
  };
}
async function materializeLtx25Video(result) {
  var _a;
  const data = (_a = result.output) == null ? void 0 : _a.data;
  if (!data) return result;
  const encoded = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  if (!encoded || encoded.length > Math.ceil(LTX25_MAX_VIDEO_BYTES / 3) * 4 + 8) {
    throw new Error("The LTX-2.5 video is larger than CineGen can import automatically.");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("LTX-2.5 returned an invalid video file.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength > LTX25_MAX_VIDEO_BYTES) throw new Error("The LTX-2.5 video is larger than CineGen can import automatically.");
  const extension = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")) ? ".webm" : bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" ? ".mp4" : void 0;
  if (!extension) throw new Error("LTX-2.5 returned an unsupported video file.");
  const outputDirectory = await fs$1.mkdtemp(path.join(os.tmpdir(), "cinegen-ltx25-"));
  const outputPath = path.join(outputDirectory, `result${extension}`);
  await fs$1.writeFile(outputPath, bytes, { flag: "wx", mode: 384 });
  return {
    ...result,
    output: {
      ...result.output,
      url: `local-media://file${outputPath}`,
      mediaType: extension === ".webm" ? "video/webm" : "video/mp4",
      data: void 0
    }
  };
}
async function materializeSessionImage(result) {
  var _a, _b;
  const raw = (_b = (_a = result.output) == null ? void 0 : _a.data) == null ? void 0 : _b.trim();
  if (!raw) return result;
  const match = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(raw);
  const encoded = ((match == null ? void 0 : match[1]) ?? raw).replace(/\s+/g, "");
  if (!encoded || encoded.length > Math.ceil(RUNPOD_SESSION_MAX_IMAGE_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("RunPod returned an invalid or oversized image file.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.byteLength > RUNPOD_SESSION_MAX_IMAGE_BYTES) {
    throw new Error("RunPod returned an invalid or oversized image file.");
  }
  const mediaType = ltx25ImageType(bytes);
  const extension = mediaType === "image/png" ? ".png" : mediaType === "image/jpeg" ? ".jpg" : mediaType === "image/webp" ? ".webp" : void 0;
  if (!extension || !mediaType) throw new Error("RunPod returned an unsupported image file.");
  const outputDirectory = await fs$1.mkdtemp(path.join(os.tmpdir(), "cinegen-runpod-image-"));
  const outputPath = path.join(outputDirectory, `result${extension}`);
  await fs$1.writeFile(outputPath, bytes, { flag: "wx", mode: 384 });
  const { data: _data, ...safeOutput } = result.output;
  return {
    ...result,
    output: {
      ...safeOutput,
      url: `local-media://file${outputPath}`,
      mediaType
    }
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
    const {
      apiKey,
      kieKey,
      runpodKey,
      runpodEndpointId,
      podUrl: podUrl2,
      nodeId,
      nodeType,
      modelId,
      outputType: requestedOutputType,
      inputs: rawInputs
    } = params;
    const { ALL_MODELS, resolveVideoModelEndpoint, sanitizeVideoInputsForEndpoint } = await import("./models-bEedtVJm.js");
    const modelDef = ALL_MODELS[modelId] ?? Object.values(ALL_MODELS).find(
      (m) => m.id === modelId || m.altId === modelId || m.nodeType === modelId
    );
    if (!modelDef) {
      if (modelId.startsWith("fal-ai/")) {
        const key = apiKey;
        if (!key) throw new Error("No fal.ai API key provided. Add one in Settings.");
        configureFal(key);
        const inputs2 = await resolveLocalMediaUrls(rawInputs);
        const result2 = await generateWithFal(modelId, inputs2, key);
        const data2 = result2.data ?? result2;
        return data2;
      }
      throw new Error(`Unknown model: ${modelId}`);
    }
    const provider = modelDef.provider;
    let inputs = rawInputs;
    if (provider !== "higgsfield") {
      if (apiKey) configureFal(apiKey);
      inputs = await resolveLocalMediaUrls(rawInputs);
    }
    let apiModelId = modelId.includes("/") ? modelId : modelDef.id;
    const registryNodeType = modelDef.nodeType ?? modelId;
    const hasImageInputs = Object.keys(inputs).some(
      (key) => key === "image_url" || key === "start_image_url" || key === "image_urls" || key === "imageUrl"
    );
    apiModelId = resolveVideoModelEndpoint(registryNodeType, modelDef, {
      hasImageInputs,
      quality: inputs.quality
    });
    sanitizeVideoInputsForEndpoint(registryNodeType, apiModelId, inputs);
    let result;
    if (provider === "kie") {
      const key = kieKey;
      if (!key) throw new Error("No kie.ai API key provided. Add one in Settings.");
      result = await generateWithKie(apiModelId, inputs, key);
    } else if (provider === "pod") {
      if (!podUrl2) throw new Error("No pod URL configured. Start your pod and set the URL in Settings.");
      const route = modelDef.podRoute ?? apiModelId;
      result = await generateWithPod(podUrl2, route, inputs);
    } else if (provider === "runpod") {
      const key = runpodKey;
      if (!key) throw new Error("No RunPod API key provided. Add one in Settings.");
      const endpointId = runpodEndpointId || modelDef.runpodEndpointId || "";
      result = await generateWithRunpod(endpointId, inputs, key);
    } else if (provider === "higgsfield") {
      const registryOutputType = modelDef.outputType;
      const outputKind = requestedOutputType ?? (registryOutputType === "video" ? "video" : registryOutputType === "audio" ? "audio" : registryOutputType === "text" ? "text" : registryOutputType === "3d" || registryOutputType === "model3d" || registryOutputType === "model" ? "3d" : "image");
      result = await generateWithHiggsfield(apiModelId, inputs, outputKind);
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
  ipcMain.handle("pod:setup-ltx25", async (_event, params) => {
    return await setupRunpodLtx25(params);
  });
  ipcMain.handle("pod:status-ltx25", async (_event, params) => {
    return await getRunpodLtx25Status(params);
  });
  ipcMain.handle("pod:terminate-ltx25", async (_event, params) => {
    return await terminateRunpodLtx25(params);
  });
  ipcMain.handle("pod:generate-ltx25", async (_event, params) => {
    const prepared = params.input ? await prepareLtx25Input(params.input) : void 0;
    return await materializeLtx25Video(await runRunpodLtx25Job({ ...params, input: prepared }));
  });
  ipcMain.handle("pod:generate-session-image", async (_event, params) => {
    const prepared = params.input ? await prepareSessionImageInput(params.input) : void 0;
    return await materializeSessionImage(await runRunpodSessionImageJob({ ...params, input: prepared }));
  });
}
const execFileAsync$4 = promisify(execFile);
const ARTLIST_MCP_URL = "https://mcp.artlist.io/mcp";
const ARTLIST_SERVER_NAME = "artlist";
const GENERATION_TIMEOUT_MS$1 = 20 * 60 * 1e3;
const CLAUDE_CANDIDATES$1 = [
  path.join(os.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
];
function cliEnv() {
  const currentPath = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", currentPath].filter(Boolean).join(path.delimiter)
  };
}
async function resolveClaudeBinary$1() {
  for (const candidate of CLAUDE_CANDIDATES$1) {
    try {
      const { stdout } = await execFileAsync$4(candidate, ["--version"], {
        env: cliEnv(),
        timeout: 8e3
      });
      if (stdout.toLowerCase().includes("claude")) return candidate;
    } catch {
    }
  }
  return null;
}
function mcpConfig() {
  return JSON.stringify({
    mcpServers: {
      [ARTLIST_SERVER_NAME]: {
        type: "http",
        url: ARTLIST_MCP_URL
      }
    }
  });
}
function buildArtlistGenerationPrompt(params) {
  var _a, _b, _c;
  const references = [...new Set((params.medias ?? []).map((media) => media.value.trim()).filter(Boolean))].slice(0, 3);
  const settings = [
    `duration: ${Math.max(1, Math.round(params.durationSec ?? 5))} seconds`,
    `aspect ratio: ${((_a = params.aspectRatio) == null ? void 0 : _a.trim()) || "16:9"}`,
    `resolution: ${((_b = params.resolution) == null ? void 0 : _b.trim()) || "720p"}`,
    `generated audio: ${params.generateAudio ? "on" : "off"}`,
    ((_c = params.model) == null ? void 0 : _c.trim()) && params.model.trim() !== "auto" ? `model: ${params.model.trim()}` : "model: choose the best available Artlist video model for this request"
  ];
  const referenceBlock = references.length > 0 ? [
    "",
    "REFERENCE IMAGES (identity and design are locked to these images):",
    ...references.map((url, index) => `${index + 1}. ${url}`),
    "Use every supplied reference. Preserve the depicted character, location, prop, vehicle, wardrobe, and design details in the video."
  ].join("\n") : "";
  return [
    "Use the Artlist MCP to generate one finished video now. This request is already approved by the user and may consume Artlist credits.",
    "Do not merely recommend a model or explain how to generate it; call the Artlist generation tool and wait for the completed result.",
    "",
    "VIDEO BRIEF",
    params.prompt.trim(),
    "",
    "SETTINGS",
    ...settings,
    referenceBlock,
    "",
    "After generation, respond with JSON only in this shape:",
    '{"url":"direct downloadable video URL","generationId":"optional","accountUrl":"optional Artlist account/session URL","model":"optional","durationSec":5}'
  ].filter((line) => line !== "").join("\n");
}
function jsonCandidates(value) {
  if (!value || typeof value !== "object") return [];
  const row = value;
  const nested = ["result", "data", "output"].flatMap((key) => {
    const candidate = row[key];
    if (candidate && typeof candidate === "object") return jsonCandidates(candidate);
    if (typeof candidate === "string") {
      try {
        return jsonCandidates(JSON.parse(candidate));
      } catch {
        return [];
      }
    }
    return [];
  });
  return [row, ...nested];
}
function firstString(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return void 0;
}
function parseArtlistGenerationOutput(stdout) {
  var _a, _b, _c;
  const trimmed = stdout.trim();
  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    envelope = void 0;
  }
  const textParts = [trimmed];
  if (envelope && typeof envelope === "object") {
    const row = envelope;
    for (const key of ["result", "text", "message"]) {
      if (typeof row[key] === "string") textParts.unshift(row[key]);
    }
  }
  const candidates = jsonCandidates(envelope);
  for (const text of textParts) {
    const fenced = (_a = text.match(/```(?:json)?\s*([\s\S]*?)```/i)) == null ? void 0 : _a[1];
    for (const candidate of [fenced, text]) {
      if (!candidate) continue;
      try {
        candidates.unshift(...jsonCandidates(JSON.parse(candidate)));
      } catch {
      }
    }
    const inline = (_b = text.match(/\{[\s\S]*\}/)) == null ? void 0 : _b[0];
    if (inline) {
      try {
        candidates.unshift(...jsonCandidates(JSON.parse(inline)));
      } catch {
      }
    }
  }
  for (const row of candidates) {
    const url = firstString(row, ["url", "videoUrl", "video_url", "downloadUrl", "download_url", "mediaUrl", "media_url"]);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const duration = Number(row.durationSec ?? row.duration_sec ?? row.duration);
    return {
      url,
      mediaType: "video",
      ...Number.isFinite(duration) && duration > 0 ? { durationSec: duration } : {},
      ...firstString(row, ["generationId", "generation_id", "id"]) ? { generationId: firstString(row, ["generationId", "generation_id", "id"]) } : {},
      ...firstString(row, ["accountUrl", "account_url", "sessionUrl", "session_url"]) ? { accountUrl: firstString(row, ["accountUrl", "account_url", "sessionUrl", "session_url"]) } : {},
      ...firstString(row, ["model", "modelId", "model_id"]) ? { model: firstString(row, ["model", "modelId", "model_id"]) } : {}
    };
  }
  const videoUrl = (_c = textParts.join("\n").match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/i)) == null ? void 0 : _c[0];
  if (videoUrl) return { url: videoUrl, mediaType: "video" };
  throw new Error("Artlist finished without returning a downloadable video URL. Open the Artlist MCP session in your account to retrieve the generation.");
}
async function artlistStatus(binary) {
  try {
    const { stdout, stderr } = await execFileAsync$4(binary, ["mcp", "get", ARTLIST_SERVER_NAME], {
      env: cliEnv(),
      timeout: 2e4
    });
    const output = `${stdout}
${stderr}`;
    const disconnected = /not connected|authentication required|needs authentication|login required|failed|error/i.test(output);
    return {
      connected: !disconnected,
      configured: true,
      ...disconnected ? { error: "Artlist needs to be authorized." } : {}
    };
  } catch (error) {
    return { connected: false, configured: false };
  }
}
async function ensureConfigured(binary) {
  const status = await artlistStatus(binary);
  if (status.configured) return;
  await execFileAsync$4(binary, [
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    "user",
    ARTLIST_SERVER_NAME,
    ARTLIST_MCP_URL
  ], {
    env: cliEnv(),
    timeout: 2e4
  });
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function artlistLoginCommand(binary, platform = process.platform, loginScriptPath = "/tmp/cinegen-artlist-login.command") {
  if (platform === "darwin") {
    const contents = [
      "#!/bin/zsh",
      `printf '\\033]0;Artlist sign in\\007'`,
      `${shellQuote(binary)} mcp login ${ARTLIST_SERVER_NAME}`,
      "status=$?",
      "if (( status != 0 )); then",
      "  echo",
      '  echo "Artlist sign-in did not complete. Press Return to close."',
      "  read -r",
      "fi",
      "exit $status",
      ""
    ].join("\n");
    return {
      file: "/usr/bin/open",
      args: [loginScriptPath],
      detached: true,
      script: { path: loginScriptPath, contents }
    };
  }
  return { file: binary, args: ["mcp", "login", ARTLIST_SERVER_NAME], detached: false };
}
function friendlyArtlistLoginError(error) {
  const detail = error && typeof error === "object" ? `${String(error.message ?? "")}
${String(error.stderr ?? "")}` : String(error ?? "");
  if (/stdin isn't a terminal|interactive terminal|authentication can't be completed/i.test(detail)) {
    return "Artlist sign-in needs an interactive window. Update Claude Code, then try Connect Artlist again.";
  }
  if (/timed out|ETIMEDOUT/i.test(detail)) {
    return "Artlist sign-in timed out before browser authorization finished. Try connecting again.";
  }
  return "Artlist sign-in did not complete. Try Connect Artlist again.";
}
async function waitForArtlistLogin(binary, timeoutMs = 3 * 60 * 1e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await artlistStatus(binary);
    if (status.connected) return status;
    await new Promise((resolve) => setTimeout(resolve, 2e3));
  }
  throw new Error("Artlist authorization was not completed. Finish sign-in in the browser, then try Connect Artlist again.");
}
async function generateWithArtlist(binary, params) {
  const workspace = path.join(app.getPath("userData"), "artlist-mcp-workspace");
  await mkdir(workspace, { recursive: true });
  const prompt = buildArtlistGenerationPrompt(params);
  const { stdout } = await execFileAsync$4(binary, [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    "sonnet",
    "--max-turns",
    "8",
    "--tools",
    "",
    "--allowedTools",
    "mcp__artlist__*",
    "--mcp-config",
    mcpConfig(),
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--disable-slash-commands",
    "--no-session-persistence"
  ], {
    cwd: workspace,
    env: cliEnv(),
    timeout: GENERATION_TIMEOUT_MS$1,
    maxBuffer: 10 * 1024 * 1024
  });
  return parseArtlistGenerationOutput(stdout);
}
function registerArtlistHandlers() {
  ipcMain.handle("artlist:account-status", async () => {
    const binary = await resolveClaudeBinary$1();
    if (!binary) {
      return { connected: false, configured: false, error: "Claude Code is required for the Artlist MCP connection." };
    }
    return artlistStatus(binary);
  });
  ipcMain.handle("artlist:auth-login", async () => {
    const binary = await resolveClaudeBinary$1();
    if (!binary) throw new Error("Install Claude Code before connecting Artlist.");
    await ensureConfigured(binary);
    const command = artlistLoginCommand(
      binary,
      process.platform,
      path.join(app.getPath("userData"), "artlist-login.command")
    );
    try {
      if (command.script) {
        await writeFile(command.script.path, command.script.contents, { mode: 448 });
        await chmod(command.script.path, 448);
      }
      await execFileAsync$4(command.file, command.args, {
        env: cliEnv(),
        timeout: command.detached ? 2e4 : 5 * 60 * 1e3,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch (error) {
      throw new Error(friendlyArtlistLoginError(error));
    }
    return command.detached ? waitForArtlistLogin(binary) : artlistStatus(binary);
  });
  ipcMain.handle("artlist:auth-logout", async () => {
    const binary = await resolveClaudeBinary$1();
    if (!binary) return;
    await execFileAsync$4(binary, ["mcp", "logout", ARTLIST_SERVER_NAME], {
      env: cliEnv(),
      timeout: 2e4
    });
  });
  ipcMain.handle("artlist:generate", async (_event, params) => {
    var _a;
    const binary = await resolveClaudeBinary$1();
    if (!binary) throw new Error("Claude Code is required to use the Artlist MCP.");
    const status = await artlistStatus(binary);
    if (!status.connected) throw new Error("Connect your Artlist account in Settings before generating.");
    if (!((_a = params == null ? void 0 : params.prompt) == null ? void 0 : _a.trim())) throw new Error("Artlist generation requires a prompt.");
    return generateWithArtlist(binary, params);
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
const execFileAsync$3 = promisify(execFile);
const PROBE_TIMEOUT_MS = 20 * 1e3;
const TRANSCODE_TIMEOUT_MS = 5 * 60 * 1e3;
function parseVideoFrameSize(stdout) {
  const [width, height] = stdout.trim().split(/[x,\s]+/, 2).map((value) => Number.parseInt(value, 10));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return void 0;
  return { width, height };
}
function minimumEvenFrameSize(source, minimumPixels) {
  if (source.width * source.height >= minimumPixels) return source;
  const scale = Math.sqrt(minimumPixels / (source.width * source.height));
  let width = Math.ceil(source.width * scale / 2) * 2;
  let height = Math.ceil(source.height * scale / 2) * 2;
  while (width * height < minimumPixels) {
    if (width / source.width <= height / source.height) width += 2;
    else height += 2;
  }
  return { width, height };
}
async function probeFile(filePath) {
  const { stdout } = await execFileAsync$3(getFfprobePath(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    filePath
  ], { timeout: PROBE_TIMEOUT_MS });
  return parseVideoFrameSize(stdout);
}
async function probeVideoFrameSize(source) {
  try {
    if (source.filePath) return await probeFile(source.filePath);
    const dir = await fs$1.mkdtemp(path.join(os.tmpdir(), "cinegen-probe-"));
    try {
      const scratch = path.join(dir, `reference.${source.format}`);
      await fs$1.writeFile(scratch, source.bytes);
      return await probeFile(scratch);
    } finally {
      await fs$1.rm(dir, { recursive: true, force: true }).catch(() => {
      });
    }
  } catch {
    return void 0;
  }
}
async function transcodeVideo(source, videoFilter) {
  const dir = await fs$1.mkdtemp(path.join(os.tmpdir(), "cinegen-resize-"));
  try {
    const input = source.filePath ?? path.join(dir, `reference.${source.format}`);
    if (!source.filePath) await fs$1.writeFile(input, source.bytes);
    const output = path.join(dir, "reference-upscaled.mp4");
    await execFileAsync$3(getFfmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      videoFilter,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      output
    ], { timeout: TRANSCODE_TIMEOUT_MS });
    return await fs$1.readFile(output);
  } finally {
    await fs$1.rm(dir, { recursive: true, force: true }).catch(() => {
    });
  }
}
function transcodeVideoFrameSize(source, target) {
  return transcodeVideo(source, `scale=${target.width}:${target.height}:flags=lanczos`);
}
function transcodeVideoToMinimumPixels(source, minimumPixels) {
  const factor = `max(1,sqrt(${minimumPixels}/(iw*ih)))`;
  const width = `ceil(iw*${factor}/2)*2`;
  const height = `ceil(ih*${factor}/2)*2`;
  return transcodeVideo(source, `scale='${width}':'${height}':flags=lanczos`);
}
const FALLBACK_IMAGE_MODELS = [
  "GPT Image 2",
  "Nano Banana 2",
  "Nano Banana 2 Lite",
  "Nano Banana Pro",
  "Nano Banana",
  "Seedream 5.0 Pro",
  "Seedream 5.0 Lite",
  "Seedream 4.5",
  "Seedream 4.0",
  "Kling V3 Omni",
  "Grok Image Quality",
  "Grok Image",
  "Reve Image Remix",
  "Kontext-Pro",
  "Imagen 4"
];
const FALLBACK_VIDEO_MODELS = [
  "Seedance 2.5",
  "Standard",
  "Fast",
  "Seedance 2.0 Mini",
  "Seedance 1.5 Pro",
  "Seedance 1.0 Pro Fast",
  "Seedance 1.0 Pro",
  "Kling O3",
  "Kling V3",
  "Kling O3 Reference-to-Video",
  "Kling 2.6",
  "Kling 2.5 Turbo Pro",
  "Kling 2.5 Turbo Std",
  "Veo 3.1",
  "Veo 3.1 Fast",
  "Vidu Q3 Pro",
  "Vidu Q2 Reference to Video",
  "Wan 2.6",
  "Gemini Omni Flash",
  "Happy Horse 1.1",
  "MiniMax-Hailuo-2.3",
  "MiniMax-Hailuo-2.3-Fast",
  "Topview Pro",
  "Topview Plus",
  "Topview Best"
];
const FALLBACK_AUDIO_MODELS = [
  { displayName: "Topview Music", catalogType: "music" },
  { displayName: "Minimax Music 2.6", catalogType: "music" },
  { displayName: "Qwen3 TTS", catalogType: "voice" },
  { displayName: "Seed Audio 1.0", catalogType: "audio" }
];
const DEFAULT_IMAGE_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const DEFAULT_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
const DEFAULT_VIDEO_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const DEFAULT_VIDEO_RESOLUTIONS = ["720", "1080"];
const DEFAULT_VIDEO_DURATIONS = Array.from({ length: 27 }, (_, index) => String(index + 4));
function isRecord$1(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function collectRecords$1(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRecords$1(entry, output));
  } else if (isRecord$1(value)) {
    output.push(value);
    Object.values(value).forEach((entry) => collectRecords$1(entry, output));
  }
  return output;
}
function modelRecords(value) {
  for (const record of collectRecords$1(value)) {
    if (Array.isArray(record.models)) return record.models.filter(isRecord$1);
  }
  return [];
}
function optionValue$1(value) {
  if (!isRecord$1(value)) return value;
  return value.value ?? value.id ?? value.name ?? value.label;
}
function optionValues$1(model, field) {
  const options = model.submitParameterOptions;
  const entry = isRecord$1(options) ? options[field] : Array.isArray(options) ? options.find((candidate) => isRecord$1(candidate) && (candidate.name === field || candidate.key === field || candidate.field === field)) : void 0;
  const raw = Array.isArray(entry) ? entry : isRecord$1(entry) ? ["values", "options", "enum", "allowedValues"].map((key) => entry[key]).find(Array.isArray) ?? [] : [];
  return raw.map(optionValue$1).filter((entry2) => entry2 !== void 0 && entry2 !== null);
}
function uniqueValues(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function mergeCatalog(catalog) {
  const merged = /* @__PURE__ */ new Map();
  for (const entry of []) {
    if (entry.outputType !== "image" && entry.outputType !== "video" && entry.outputType !== "audio") continue;
    for (const model of modelRecords(entry.config)) {
      const displayName = String(
        model.displayName ?? model.name ?? model.submitModel ?? model.backendModelCode ?? ""
      ).trim();
      if (!displayName) continue;
      const key = `${entry.outputType}:${displayName.toLowerCase()}`;
      const existing = merged.get(key) ?? {
        displayName,
        submitModel: typeof model.submitModel === "string" ? model.submitModel : void 0,
        outputType: entry.outputType,
        catalogType: entry.catalogType ?? entry.taskType,
        taskTypes: /* @__PURE__ */ new Set(),
        options: /* @__PURE__ */ new Map(),
        defaults: {},
        accepts: /* @__PURE__ */ new Set(),
        live: true
      };
      existing.catalogType ?? (existing.catalogType = entry.catalogType ?? entry.taskType);
      existing.taskTypes.add(entry.taskType);
      if (typeof model.submitModel === "string") existing.submitModel = model.submitModel;
      if (isRecord$1(model.defaultSubmitParameters)) {
        existing.defaults = { ...existing.defaults, ...model.defaultSubmitParameters };
      }
      if (model.nativeAudio === true || model.supportsNativeAudio === true) existing.nativeAudio = true;
      if (model.nativeAudio === false || model.supportsNativeAudio === false) existing.nativeAudio ?? (existing.nativeAudio = false);
      for (const field of requiredFields(model)) existing.accepts.add(field);
      for (const field of Object.keys(isRecord$1(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {})) {
        existing.accepts.add(field);
      }
      for (const field of ["aspectRatio", "resolution", "duration", "quality", "sound"]) {
        const values = optionValues$1(model, field);
        if (!values.length) continue;
        existing.accepts.add(field);
        existing.options.set(field, uniqueValues([...existing.options.get(field) ?? [], ...values]));
      }
      merged.set(key, existing);
    }
  }
  return [...merged.values()];
}
function topviewModelSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function selectOptions(values, fallback) {
  const resolved = values.length ? values : fallback;
  return uniqueValues(resolved).map((value) => ({ value: String(value), label: String(value) }));
}
function requiredFields(model) {
  const required2 = model.requiredSubmitFields;
  if (isRecord$1(required2)) {
    return Object.entries(required2).filter(([, value]) => value !== false).map(([field]) => field);
  }
  if (!Array.isArray(required2)) return [];
  return required2.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!isRecord$1(entry)) return [];
    const name2 = entry.name ?? entry.key ?? entry.field;
    return typeof name2 === "string" ? [name2] : [];
  });
}
function fieldOptions(model, field, fallback) {
  const values = model.options.get(field) ?? [];
  if (values.length) return selectOptions(values, []);
  if (model.live && !model.accepts.has(field)) return [];
  return selectOptions([], fallback);
}
function preferredDefault(values, preferred, fallback) {
  var _a;
  const fromConfig = fallback === void 0 ? "" : String(fallback);
  if (fromConfig && values.some((entry) => entry.value === fromConfig)) return fromConfig;
  if (values.some((entry) => entry.value === preferred)) return preferred;
  return ((_a = values[0]) == null ? void 0 : _a.value) ?? preferred;
}
function imageDefinition(model) {
  const ratios = fieldOptions(model, "aspectRatio", DEFAULT_IMAGE_RATIOS);
  const resolutions = fieldOptions(model, "resolution", DEFAULT_IMAGE_RESOLUTIONS);
  const quality = fieldOptions(model, "quality", []);
  const supportsText = model.taskTypes.size === 0 || model.taskTypes.has("text_to_image");
  const supportsEdit = model.taskTypes.size === 0 || model.taskTypes.has("image_edit");
  const inputs = [
    { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" }
  ];
  if (supportsEdit) {
    inputs.push(
      { id: "image_url", portType: "image", label: "Media", required: false, falParam: "image_url", fieldType: "port", multiple: true, mediaRole: "image" },
      { id: "extra_images", portType: "image", label: "Reference", required: false, falParam: "image_urls", fieldType: "element-list", max: 15 }
    );
  }
  if (ratios.length) inputs.push({
    id: "aspect_ratio",
    portType: "text",
    label: "Aspect Ratio",
    required: false,
    falParam: "aspect_ratio",
    fieldType: "select",
    default: preferredDefault(ratios, "16:9", model.defaults.aspectRatio),
    options: ratios
  });
  if (resolutions.length) inputs.push({
    id: "resolution",
    portType: "text",
    label: "Resolution",
    required: false,
    falParam: "resolution",
    fieldType: "select",
    default: preferredDefault(resolutions, "2K", model.defaults.resolution),
    options: resolutions
  });
  if (quality.length) inputs.push({
    id: "quality",
    portType: "text",
    label: "Quality",
    required: false,
    falParam: "quality",
    fieldType: "select",
    default: preferredDefault(quality, "medium", model.defaults.quality),
    options: quality
  });
  return {
    id: `topview/image/${model.submitModel ?? model.displayName}`,
    nodeType: `topview-image-${topviewModelSlug(model.displayName)}`,
    name: model.displayName,
    category: supportsText ? "image" : "image-edit",
    description: supportsText && supportsEdit ? "Topview image generation and editing" : supportsEdit ? "Topview image editing" : "Topview text-to-image generation",
    outputType: "image",
    provider: "topview",
    responseMapping: { path: "url" },
    inputs
  };
}
function videoDefinition(model) {
  const ratios = fieldOptions(model, "aspectRatio", DEFAULT_VIDEO_RATIOS);
  const resolutions = fieldOptions(model, "resolution", DEFAULT_VIDEO_RESOLUTIONS);
  const durations = fieldOptions(model, "duration", DEFAULT_VIDEO_DURATIONS);
  const soundValues = model.options.get("sound") ?? [];
  const supportsAudio = model.nativeAudio === true || soundValues.some((value) => String(value).toLowerCase() === "on");
  const supportsOmniReference = model.taskTypes.size === 0 || model.taskTypes.has("omni_reference");
  const supportsImageToVideo = model.taskTypes.size === 0 || model.taskTypes.has("image_to_video");
  const taskLabels = [...model.taskTypes].map((task) => task.replaceAll("_", " ")).join(" · ");
  const inputs = [
    { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" }
  ];
  if (supportsOmniReference) {
    inputs.push(
      // Keep the historical handle ID so existing Spaces connections migrate in place.
      // Its payload is now explicitly reference media instead of a stack of start frames.
      // Omni-reference accepts stills, clips and audio: the submit builder sorts
      // them into inputImages / inputVideos / inputAudios by role. A 'media' port
      // is what lets a video output connect on the canvas without a false warning.
      { id: "image_url", portType: "media", label: "References", required: false, falParam: "reference_images", fieldType: "port", multiple: true, mediaRole: "image" },
      { id: "extra_images", portType: "media", label: "More References", required: false, falParam: "image_urls", fieldType: "element-list", max: 30, mediaRole: "image" }
    );
  } else if (supportsImageToVideo) {
    inputs.push({ id: "image_url", portType: "image", label: "Start Frame", required: false, falParam: "image_url", fieldType: "port", mediaRole: "start_image" });
  }
  if (supportsImageToVideo && supportsOmniReference) {
    inputs.push(
      { id: "start_frame", portType: "image", label: "Start Frame", required: false, falParam: "image_url", fieldType: "port", mediaRole: "start_image" },
      { id: "end_frame", portType: "image", label: "End Frame", required: false, falParam: "end_frame_url", fieldType: "port", mediaRole: "end_image" }
    );
  }
  if (durations.length) inputs.push({
    id: "duration",
    portType: "number",
    label: "Duration",
    required: false,
    falParam: "duration",
    fieldType: "select",
    default: Number(preferredDefault(durations, "5", model.defaults.duration)),
    options: durations
  });
  if (ratios.length) inputs.push({
    id: "aspect_ratio",
    portType: "text",
    label: "Aspect Ratio",
    required: false,
    falParam: "aspect_ratio",
    fieldType: "select",
    default: preferredDefault(ratios, "16:9", model.defaults.aspectRatio),
    options: ratios
  });
  if (resolutions.length) inputs.push({
    id: "resolution",
    portType: "text",
    label: "Resolution",
    required: false,
    falParam: "resolution",
    fieldType: "select",
    default: preferredDefault(resolutions, "720", model.defaults.resolution),
    options: resolutions
  });
  if (supportsAudio) inputs.push({
    id: "generate_audio",
    portType: "number",
    label: "Generate Audio",
    required: false,
    falParam: "generate_audio",
    fieldType: "toggle",
    default: String(model.defaults.sound ?? "on").toLowerCase() !== "off"
  });
  return {
    id: `topview/video/${model.submitModel ?? model.displayName}`,
    nodeType: `topview-video-${topviewModelSlug(model.displayName)}`,
    name: model.displayName,
    category: "video",
    description: `Topview video generation${supportsAudio ? " with native audio" : ""}${taskLabels ? ` · ${taskLabels}` : ""}`,
    outputType: "video",
    provider: "topview",
    responseMapping: { path: "url" },
    inputs
  };
}
function audioDefinition(model) {
  const kind = model.catalogType === "music" ? "music" : model.catalogType === "voice" ? "voice" : "audio";
  const inputs = [
    {
      id: "prompt",
      portType: "text",
      label: kind === "music" ? "Lyrics / Prompt" : "Text",
      required: true,
      falParam: "prompt",
      fieldType: "port"
    }
  ];
  if (kind === "music") {
    inputs.push(
      { id: "styles", portType: "text", label: "Music Style", required: false, falParam: "styles", fieldType: "textarea", default: "" },
      { id: "instrumental", portType: "number", label: "Instrumental", required: false, falParam: "instrumental", fieldType: "toggle", default: false },
      { id: "reference_audio", portType: "audio", label: "Reference Audio", required: false, falParam: "reference_audio", fieldType: "port", mediaRole: "audio" }
    );
  } else if (kind === "voice") {
    inputs.push(
      { id: "voice_id", portType: "text", label: "Topview Voice ID", required: true, falParam: "voice_id", fieldType: "text", default: "", placeholder: "Choose a voice ID from Topview" },
      { id: "voice_speed", portType: "number", label: "Voice Speed", required: false, falParam: "voice_speed", fieldType: "range", default: 1, min: 0.8, max: 1.2, step: 0.05 },
      { id: "emotion", portType: "text", label: "Emotion", required: false, falParam: "emotion", fieldType: "select", default: "neutral", options: ["neutral", "happy", "surprised", "angry", "sad", "fearful", "disgusted"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) }
    );
  } else {
    inputs.push(
      { id: "reference_audio", portType: "audio", label: "Reference Audio", required: true, falParam: "reference_audio", fieldType: "port", mediaRole: "audio" },
      { id: "emotion_text", portType: "text", label: "Emotion Direction", required: false, falParam: "emotion_text", fieldType: "text", default: "" }
    );
  }
  return {
    id: `topview/audio/${model.submitModel ?? model.displayName}`,
    nodeType: `topview-audio-${topviewModelSlug(model.displayName)}`,
    name: model.displayName,
    category: "audio",
    description: kind === "music" ? "Topview AI music generation" : kind === "voice" ? "Topview text-to-speech" : "Topview reference-guided audio generation",
    outputType: "audio",
    provider: "topview",
    responseMapping: { path: "url" },
    inputs
  };
}
function fallbackModels() {
  return [
    ...FALLBACK_IMAGE_MODELS.map((displayName) => ({
      displayName,
      outputType: "image",
      taskTypes: /* @__PURE__ */ new Set(["text_to_image", "image_edit"]),
      options: /* @__PURE__ */ new Map(),
      defaults: {},
      accepts: /* @__PURE__ */ new Set()
    })),
    ...FALLBACK_VIDEO_MODELS.map((displayName) => ({
      displayName,
      outputType: "video",
      taskTypes: /* @__PURE__ */ new Set(["text_to_video", "image_to_video", "omni_reference"]),
      options: /* @__PURE__ */ new Map(),
      defaults: {},
      accepts: /* @__PURE__ */ new Set(),
      nativeAudio: ["Seedance 2.5", "Standard", "Fast", "Kling O3", "Kling V3", "Veo 3.1", "Veo 3.1 Fast", "Vidu Q3 Pro", "Wan 2.6", "Happy Horse 1.1"].includes(displayName)
    })),
    ...FALLBACK_AUDIO_MODELS.map(({ displayName, catalogType }) => ({
      displayName,
      outputType: "audio",
      catalogType,
      taskTypes: /* @__PURE__ */ new Set([catalogType]),
      options: /* @__PURE__ */ new Map(),
      defaults: {},
      accepts: /* @__PURE__ */ new Set()
    }))
  ];
}
function buildTopviewModelRegistry(catalog) {
  const live = mergeCatalog();
  const source = live.length ? live : fallbackModels();
  return Object.fromEntries(source.map((model) => {
    const definition = model.outputType === "image" ? imageDefinition(model) : model.outputType === "video" ? videoDefinition(model) : audioDefinition(model);
    return [definition.nodeType, definition];
  }));
}
const TOPVIEW_INHERITED_VIDEO_DURATION = -1;
const DASH = "[-\\u2010-\\u2015\\u2212]";
const SENTINEL_DEMAND = new RegExp(
  `duration\`?\\s*(?:must|should)\\s+be\\s*\`?\\s*${DASH}\\s*1\\b`,
  "i"
);
const VIDEO_EDIT_VERDICT = /task\s+as\s+video\s+editing|duration\s+follows?\s+the\s+input\s+video/i;
function topviewRequiresInheritedVideoDuration(message) {
  if (!/duration/i.test(message)) return false;
  return SENTINEL_DEMAND.test(message) || VIDEO_EDIT_VERDICT.test(message);
}
const TOPVIEW_MCP_URL = "https://mcp.topview.ai/mcp";
const TOPVIEW_RESOURCE = "https://mcp.topview.ai";
const TOPVIEW_AUTHORIZE_URL = "https://www.topview.ai/mcp_oauth/oauth/authorize";
const TOPVIEW_TOKEN_URL = "https://www.topview.ai/mcp_oauth/oauth/token";
const TOPVIEW_REGISTER_URL = "https://www.topview.ai/mcp_oauth/oauth/register";
const TOPVIEW_USERINFO_URL = "https://www.topview.ai/mcp_oauth/oauth/userinfo";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1e3;
const GENERATION_TIMEOUT_MS = 20 * 60 * 1e3;
const MCP_REQUEST_TIMEOUT_MS = 90 * 1e3;
const REFERENCE_DOWNLOAD_TIMEOUT_MS = 30 * 1e3;
const MAX_REFERENCE_BYTES = 45 * 1024 * 1024;
const MAX_MCP_TOOL_PAGES = 50;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function base64Url(value) {
  return value.toString("base64url");
}
function safeMessage(value, fallback) {
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function oauthPage(success, message) {
  const title = success ? "Topview connected" : "Topview connection failed";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f2eee8;font-family:system-ui,sans-serif}main{width:min(440px,calc(100vw - 48px));padding:34px;border:1px solid #343239;border-radius:22px;background:#191a20;box-shadow:0 24px 80px #0008}small{color:#d7a552;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;margin:10px 0 8px}p{color:#aaa6a0;line-height:1.55;margin:0}</style></head><body><main><small>CineGen + Topview</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main><script>setTimeout(()=>window.close(),1100)<\/script></body></html>`;
}
function sendOauthPage(response2, success, message) {
  const body = oauthPage(success, message);
  response2.writeHead(success ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response2.end(body);
}
class SafeCredentialStore {
  constructor() {
    this.root = path.join(app.getPath("userData"), "integrations", "topview");
  }
  availabilityError() {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return "Secure credential storage is unavailable on this device. Configure the operating-system keychain, then restart CineGen.";
      }
      if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
        return "Topview sign-in requires a Linux secret store such as GNOME Keyring or KWallet.";
      }
      return void 0;
    } catch {
      return "Secure credential storage is unavailable on this device. Restart CineGen and try again.";
    }
  }
  assertAvailable() {
    const error = this.availabilityError();
    if (error) throw new Error(error);
  }
  async read(name2) {
    try {
      this.assertAvailable();
      const envelope = JSON.parse(await fs$1.readFile(path.join(this.root, `${name2}.safe.json`), "utf8"));
      if (envelope.version !== 1 || typeof envelope.data !== "string") {
        throw new Error("Topview credentials are stored in an unsupported format. Connect the account again.");
      }
      const decrypted = safeStorage.decryptString(Buffer.from(envelope.data, "base64"));
      const value = JSON.parse(decrypted);
      if (!isRecord(value)) throw new Error("Topview credentials are invalid. Connect the account again.");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async write(name2, value) {
    this.assertAvailable();
    await fs$1.mkdir(this.root, { recursive: true });
    const envelope = JSON.stringify({
      version: 1,
      data: safeStorage.encryptString(JSON.stringify(value)).toString("base64")
    });
    const target = path.join(this.root, `${name2}.safe.json`);
    const temporary = `${target}.${process.pid}.${crypto$1.randomUUID()}.tmp`;
    try {
      await fs$1.writeFile(temporary, `${envelope}
`, { mode: 384 });
      await fs$1.rename(temporary, target);
      await fs$1.chmod(target, 384).catch(() => {
      });
    } catch (error) {
      await fs$1.unlink(temporary).catch(() => {
      });
      throw error;
    }
  }
  async remove(name2) {
    await fs$1.unlink(path.join(this.root, `${name2}.safe.json`)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function readResponse(response2) {
  const text = await response2.text();
  if (!text) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function remoteError(status, payload, fallback) {
  const detail = isRecord(payload) ? payload.error_description ?? payload.message ?? payload.error : payload;
  return new Error(typeof detail === "string" && detail.trim() ? detail.trim() : `${fallback} (${status})`);
}
async function requestJson(url, init, fallback) {
  let response2;
  try {
    response2 = await fetch(url, init);
  } catch (error) {
    throw new Error(`Could not reach Topview. ${fallback}`, { cause: error });
  }
  const payload = await readResponse(response2);
  if (!response2.ok) throw remoteError(response2.status, payload, fallback);
  if (!isRecord(payload)) throw new Error(`${fallback} Topview returned an invalid response.`);
  return payload;
}
function parseSse(text, expectedId) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
    }
  }
  return messages.find((entry) => isRecord(entry) && entry.id === expectedId) ?? messages.find((entry) => isRecord(entry) && (entry.result !== void 0 || entry.error !== void 0)) ?? messages.at(-1);
}
function collectRecords(value, output = [], depth = 0) {
  if (depth > 14 || value === null || value === void 0) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output, depth + 1);
  } else if (isRecord(value)) {
    output.push(value);
    for (const item of Object.values(value)) collectRecords(item, output, depth + 1);
  }
  return output;
}
function collectStrings(value, output = [], depth = 0) {
  if (depth > 14 || value === null || value === void 0) return output;
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output, depth + 1);
  else if (isRecord(value)) for (const item of Object.values(value)) collectStrings(item, output, depth + 1);
  return output;
}
function parseToolDocuments(result) {
  const values = [result];
  if (!isRecord(result)) return values;
  if (result.structuredContent !== void 0) values.unshift(result.structuredContent);
  if (Array.isArray(result.content)) {
    for (const entry of result.content) {
      if (!isRecord(entry) || typeof entry.text !== "string") continue;
      try {
        values.unshift(JSON.parse(entry.text));
      } catch {
        values.push(entry.text);
      }
    }
  }
  return values;
}
function findStringByKeys(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  return void 0;
}
function topviewCreditBalance(value) {
  const wanted = /* @__PURE__ */ new Set([
    "remaincredit",
    "remain_credit",
    "remainingcredit",
    "remaining_credit",
    "availablecredit",
    "available_credit",
    "creditbalance",
    "credit_balance",
    "credits",
    "credit",
    "balance"
  ]);
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (!wanted.has(key.toLowerCase())) continue;
      const number = typeof nested === "number" ? nested : typeof nested === "string" ? Number(nested) : Number.NaN;
      if (Number.isFinite(number)) return number;
    }
  }
  return void 0;
}
function findBoolean(value) {
  if (typeof value === "boolean") return value;
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (/^(ok|success|exists|ready|verified)$/i.test(key) && typeof nested === "boolean") return nested;
    }
  }
  return void 0;
}
function findResultUrl(value) {
  const preferred = findStringByKeys(value, [
    "cloudFrontUrl",
    "cloudfront_url",
    "downloadUrl",
    "download_url",
    "videoUrl",
    "video_url",
    "imageUrl",
    "image_url",
    "resultUrl",
    "result_url",
    "outputUrl",
    "output_url",
    "mediaUrl",
    "media_url",
    "filePath",
    "file_path",
    "url"
  ]);
  if (preferred && /^https?:\/\//i.test(preferred)) return preferred;
  return collectStrings(value).find((entry) => /^https?:\/\//i.test(entry) && (/\.(?:mp4|mov|webm|png|jpe?g|webp|avif)(?:[?#]|$)/i.test(entry) || /cloudfront|cdn|output|result/i.test(entry)));
}
function generatedImageFileReference(value) {
  const fileId = findStringByKeys(value, [
    "fileId",
    "file_id",
    "outputFileId",
    "output_file_id",
    "mediaFileId",
    "media_file_id"
  ]);
  return fileId ? `topview-file:${fileId}` : void 0;
}
function taskStatus(value) {
  return (findStringByKeys(value, ["status", "taskStatus", "task_status", "state"]) ?? "").toLowerCase();
}
function normalizeSchemaValue(value, schema) {
  if (!isRecord(schema)) return value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("boolean") && typeof value === "string") {
    if (/^(?:true|1|yes|on)$/i.test(value)) return true;
    if (/^(?:false|0|no|off)$/i.test(value)) return false;
  }
  if ((types.includes("integer") || types.includes("number")) && typeof value === "string" && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number) && (!types.includes("integer") || Number.isInteger(number))) return number;
  }
  if (types.includes("array") && Array.isArray(value)) {
    return value.map((entry) => normalizeSchemaValue(entry, schema.items));
  }
  if (types.includes("object") && isRecord(value)) {
    return normalizeTopviewToolRequest(schema, value);
  }
  return value;
}
function normalizeTopviewToolRequest(inputSchema, req) {
  if (!isRecord(inputSchema)) return { ...req };
  const topProperties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const wrapped = isRecord(topProperties.req) ? topProperties.req : void 0;
  const requestSchema = wrapped ?? inputSchema;
  const properties = isRecord(requestSchema.properties) ? requestSchema.properties : {};
  const strict = requestSchema.additionalProperties === false && Object.keys(properties).length > 0;
  const normalized = {};
  for (const [key, value] of Object.entries(req)) {
    if (strict && !Object.hasOwn(properties, key)) continue;
    normalized[key] = normalizeSchemaValue(value, properties[key]);
  }
  return normalized;
}
function toolArguments(tool, req) {
  var _a;
  const properties = isRecord((_a = tool.inputSchema) == null ? void 0 : _a.properties) ? tool.inputSchema.properties : {};
  const normalized = normalizeTopviewToolRequest(tool.inputSchema, req);
  return Object.hasOwn(properties, "req") ? { req: normalized } : normalized;
}
function findArrayByKey(value, keyPattern) {
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (keyPattern.test(key) && Array.isArray(nested)) return nested;
    }
  }
  return void 0;
}
function topviewBoard(result) {
  const boards = findArrayByKey(result, /^(?:boards|list|items|records|data|rows)$/i) ?? [];
  const candidates = boards.filter(isRecord).map((entry) => ({
    boardId: String(entry.boardId ?? entry.board_id ?? entry.id ?? "").trim(),
    name: typeof entry.name === "string" ? entry.name : typeof entry.boardName === "string" ? entry.boardName : void 0,
    isSystemDefault: entry.isSystemDefault === true || entry.is_system_default === true,
    taskCount: Number(entry.taskCount ?? entry.task_count ?? 0) || 0
  })).filter((entry) => entry.boardId);
  const cinegenBoards = candidates.filter((entry) => {
    var _a;
    return ((_a = entry.name) == null ? void 0 : _a.trim().toLowerCase()) === "cinegen";
  }).sort((left, right) => right.taskCount - left.taskCount);
  return cinegenBoards[0] ?? candidates.find((entry) => entry.isSystemDefault) ?? candidates.find((entry) => entry.name === "My First Board") ?? candidates[0];
}
function configModels(result) {
  return (findArrayByKey(result, /^models$/i) ?? []).filter(isRecord);
}
function optionValues(model, field) {
  const options = model.submitParameterOptions;
  if (isRecord(options)) {
    const direct = options[field];
    if (Array.isArray(direct)) return direct.map(optionValue);
    if (isRecord(direct)) {
      for (const key of ["values", "options", "enum", "allowedValues"]) {
        if (Array.isArray(direct[key])) return direct[key].map(optionValue);
      }
    }
  }
  if (Array.isArray(options)) {
    const entry = options.find((candidate) => isRecord(candidate) && (candidate.name === field || candidate.key === field || candidate.field === field));
    if (isRecord(entry)) {
      for (const key of ["values", "options", "enum", "allowedValues"]) {
        if (Array.isArray(entry[key])) return entry[key].map(optionValue);
      }
    }
  }
  return [];
}
function optionValue(value) {
  if (!isRecord(value)) return value;
  return value.value ?? value.key ?? value.id ?? value.name;
}
function requiredSubmitFields(model) {
  if (isRecord(model.requiredSubmitFields)) {
    return Object.entries(model.requiredSubmitFields).filter(([, required2]) => required2 === true || isRecord(required2)).map(([field]) => field);
  }
  if (!Array.isArray(model.requiredSubmitFields)) return [];
  return model.requiredSubmitFields.map((entry) => {
    if (typeof entry === "string") return entry;
    if (!isRecord(entry)) return "";
    const value = entry.name ?? entry.key ?? entry.field;
    return typeof value === "string" ? value : "";
  }).filter(Boolean);
}
function optionFieldNames(model) {
  const options = model.submitParameterOptions;
  if (isRecord(options)) return Object.keys(options);
  if (!Array.isArray(options)) return [];
  return options.map((entry) => {
    if (!isRecord(entry)) return "";
    const value = entry.name ?? entry.key ?? entry.field;
    return typeof value === "string" ? value : "";
  }).filter(Boolean);
}
function advertisesField(model, field) {
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  return Object.hasOwn(defaults, field) || requiredSubmitFields(model).includes(field) || optionFieldNames(model).includes(field);
}
function soundCapability(model) {
  if (model.nativeAudio === false || model.supportsNativeAudio === false) return false;
  if (model.nativeAudio === true || model.supportsNativeAudio === true) return true;
  const values = optionValues(model, "sound");
  if (values.length) return matchingOption(values, "on") !== void 0;
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  if (defaults.sound === "on" || advertisesField(model, "sound")) return true;
  return void 0;
}
function modelNames(model) {
  return [model.submitModel, model.displayName, model.name].filter((value) => typeof value === "string" && Boolean(value.trim()));
}
function selectModel(result, requestedModel, needsSound = false) {
  const models2 = configModels(result);
  if (!models2.length) throw new Error("Topview did not return a compatible model for this request.");
  const requested = requestedModel == null ? void 0 : requestedModel.trim();
  if (requested && requested !== "auto") {
    const match = models2.find((model) => modelNames(model).some((value) => value.toLowerCase() === requested.toLowerCase()));
    if (!match) {
      throw new Error(`Topview model "${requested}" is not available for this generation type. Refresh the model choice and try again.`);
    }
    if (needsSound && soundCapability(match) === false) {
      throw new Error(`Topview model "${requested}" does not support native sound. Disable sound or choose a model that does.`);
    }
    return match;
  }
  const preferred = findStringByKeys(result, ["preferredSubmitModel", "preferred_submit_model"]);
  const selected = models2.find((model) => modelNames(model).includes(preferred ?? "")) ?? models2.find((model) => model.preferred === true) ?? models2[0];
  if (needsSound && soundCapability(selected) === false) {
    throw new Error(`Topview's default model "${modelNames(selected)[0] ?? "selected"}" does not support native sound. Disable sound or explicitly choose another model.`);
  }
  return selected;
}
function normalizeTopviewImageReferences(medias) {
  return (medias ?? []).flatMap((entry) => typeof (entry == null ? void 0 : entry.value) === "string" && entry.value.trim() ? [{ value: entry.value.trim(), role: "image" }] : []).filter((entry, index, all) => all.findIndex((candidate) => candidate.value === entry.value) === index);
}
function buildTopviewImageRequest(args) {
  var _a;
  const taskType = args.references.length ? "image_edit" : "text_to_image";
  const model = selectModel(args.config, args.params.model);
  const submitModel = (_a = modelNames(model)[0]) == null ? void 0 : _a.trim();
  if (!submitModel) throw new Error("Topview returned an image model without a submit identifier.");
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const req = {
    taskType,
    model: submitModel,
    prompt: sanitizeTopviewPrompt(args.params.prompt),
    generateCount: Math.max(1, Math.min(4, Math.round(args.params.generateCount ?? 1))),
    boardId: args.boardId,
    ...args.references.length ? { inputImageFileIds: args.references.map((reference) => reference.fileId) } : {}
  };
  for (const [field, requested, fallback] of [
    ["aspectRatio", args.params.aspectRatio, "16:9"],
    ["resolution", args.params.resolution, "1K"]
  ]) {
    if (!advertisesField(model, field)) continue;
    req[field] = configValue({ model, field, requested, fallback });
  }
  for (const field of requiredSubmitFields(model)) {
    if ((req[field] === void 0 || req[field] === null || req[field] === "") && defaults[field] !== void 0) {
      req[field] = defaults[field];
    }
    if (req[field] === void 0 || req[field] === null || req[field] === "") {
      throw new Error(`Topview's selected image model requires the unsupported field "${field}".`);
    }
  }
  return { req, model: submitModel, taskType };
}
const TOPVIEW_NO_ON_SCREEN_TEXT = "Keep the frame free of on-screen text, captions, and subtitles.";
function sanitizeTopviewPrompt(prompt) {
  const withoutMentionSyntax = prompt.replace(/@([A-Za-z0-9][A-Za-z0-9_-]*)/g, (_match, name2) => name2.replaceAll("-", " ")).replace(/\s{2,}/g, " ").trim();
  return `${withoutMentionSyntax}

${TOPVIEW_NO_ON_SCREEN_TEXT}`;
}
function matchingOption(values, requested) {
  if (requested === void 0) return void 0;
  const requestedNumber = typeof requested === "number" ? requested : typeof requested === "string" && /^-?\d+(?:\.\d+)?p?$/i.test(requested.trim()) ? Number.parseFloat(requested) : void 0;
  return values.find((value) => {
    if (requestedNumber !== void 0) {
      const valueNumber = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(?:\.\d+)?p?$/i.test(value.trim()) ? Number.parseFloat(value) : void 0;
      if (valueNumber !== void 0) return valueNumber === requestedNumber;
    }
    return String(value).toLowerCase() === String(requested).toLowerCase();
  });
}
function numericConstraint(model, field) {
  const options = model.submitParameterOptions;
  let constraint;
  if (isRecord(options)) constraint = options[field];
  else if (Array.isArray(options)) constraint = options.find((candidate) => isRecord(candidate) && (candidate.name === field || candidate.key === field || candidate.field === field));
  if (!isRecord(constraint)) return {};
  const min = Number(constraint.min ?? constraint.minimum);
  const max = Number(constraint.max ?? constraint.maximum);
  const step = Number(constraint.step ?? constraint.multipleOf);
  return {
    ...Number.isFinite(min) ? { min } : {},
    ...Number.isFinite(max) ? { max } : {},
    ...Number.isFinite(step) && step > 0 ? { step } : {}
  };
}
function configValue(args) {
  const defaults = isRecord(args.model.defaultSubmitParameters) ? args.model.defaultSubmitParameters : {};
  const hasExplicitRequest = args.requested !== void 0;
  const hasDefault = defaults[args.field] !== void 0 && defaults[args.field] !== null;
  const requested = args.requested ?? defaults[args.field] ?? args.fallback;
  if (requested === void 0) {
    if (args.required) throw new Error(`Topview model configuration requires "${args.field}", but did not provide a usable default.`);
    return void 0;
  }
  const values = optionValues(args.model, args.field);
  if (values.length) {
    const match = matchingOption(values, requested);
    if (match === void 0) {
      if (!hasExplicitRequest && !hasDefault) return values[0];
      throw new Error(`Topview model "${modelNames(args.model)[0] ?? "selected"}" does not allow ${args.field}=${String(requested)}. Allowed values: ${values.map(String).join(", ")}.`);
    }
    return match;
  }
  const constraint = numericConstraint(args.model, args.field);
  if (constraint.min !== void 0 || constraint.max !== void 0 || constraint.step !== void 0) {
    const number = Number(requested);
    if (!Number.isFinite(number) || constraint.min !== void 0 && number < constraint.min || constraint.max !== void 0 && number > constraint.max || constraint.step !== void 0 && constraint.min !== void 0 && Math.abs((number - constraint.min) / constraint.step - Math.round((number - constraint.min) / constraint.step)) > 1e-9) {
      throw new Error(`Topview model "${modelNames(args.model)[0] ?? "selected"}" does not allow ${args.field}=${String(requested)}.`);
    }
    return number;
  }
  return requested;
}
function normalizeTopviewReferences(medias) {
  const entries = medias ?? [];
  const allowed = /* @__PURE__ */ new Set(["image", "start_image", "end_image", "video", "audio"]);
  const references = entries.map((entry, index) => {
    var _a;
    if (!entry || typeof entry.value !== "string" || !entry.value.trim()) {
      throw new Error(`Topview element reference ${index + 1} is empty.`);
    }
    const role = ((_a = entry.role) == null ? void 0 : _a.trim()) || "image";
    if (!allowed.has(role)) throw new Error(`Topview does not support element role "${role}".`);
    return { value: entry.value.trim(), role };
  });
  if (references.filter((entry) => entry.role === "start_image").length > 1) {
    throw new Error("Topview accepts only one start-frame element per generation.");
  }
  if (references.filter((entry) => entry.role === "end_image").length > 1) {
    throw new Error("Topview accepts only one end-frame element per generation.");
  }
  return references;
}
function topviewTaskTypeForMedias(medias) {
  const references = normalizeTopviewReferences(medias);
  if (!references.length) return "text_to_video";
  const startFrames = references.filter((entry) => entry.role === "start_image");
  const onlyFrameInputs = references.every((entry) => entry.role === "start_image" || entry.role === "end_image");
  return startFrames.length === 1 && onlyFrameInputs ? "image_to_video" : "omni_reference";
}
function buildTopviewVideoRequest(args) {
  var _a, _b;
  const model = selectModel(args.config, args.params.model, args.params.generateAudio === true);
  const submitModel = String(model.submitModel ?? "").trim();
  if (!submitModel) throw new Error("Topview returned a video model without a submit identifier.");
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const required2 = new Set(requiredSubmitFields(model));
  const requestedDuration = args.params.durationSec === void 0 ? void 0 : Math.round(args.params.durationSec);
  if (requestedDuration !== void 0 && (!Number.isFinite(requestedDuration) || requestedDuration === 0 || requestedDuration < -1)) {
    throw new Error("Topview video duration must be a positive whole number of seconds.");
  }
  let prompt = sanitizeTopviewPrompt(args.params.prompt);
  const req = {
    ...defaults,
    taskType: args.taskType,
    model: submitModel,
    prompt,
    boardId: args.boardId
  };
  delete req.generateAudio;
  const assignConfigured = (field, requested, fallback) => {
    const supported = advertisesField(model, field);
    if (!supported) {
      if (requested !== void 0) {
        throw new Error(`Topview model "${submitModel}" does not accept ${field} for this generation type.`);
      }
      return;
    }
    const value = configValue({ model, field, requested, fallback, required: required2.has(field) });
    if (value !== void 0) req[field] = value;
  };
  assignConfigured("resolution", args.params.resolution === void 0 ? void 0 : Number.parseInt(args.params.resolution, 10), 720);
  if (args.inheritInputVideoDuration || requestedDuration === TOPVIEW_INHERITED_VIDEO_DURATION) {
    req.duration = TOPVIEW_INHERITED_VIDEO_DURATION;
  } else if (advertisesField(model, "duration")) {
    assignConfigured("duration", requestedDuration, 5);
  }
  assignConfigured("generatingCount", void 0, 1);
  if (args.taskType !== "image_to_video") {
    assignConfigured("aspectRatio", (_a = args.params.aspectRatio) == null ? void 0 : _a.trim(), "16:9");
  } else if (args.params.aspectRatio !== void 0 || required2.has("aspectRatio")) {
    assignConfigured("aspectRatio", (_b = args.params.aspectRatio) == null ? void 0 : _b.trim(), "16:9");
  }
  const audioCapability = soundCapability(model);
  if (audioCapability !== false && (advertisesField(model, "sound") || args.params.generateAudio === true)) {
    req.sound = configValue({
      model,
      field: "sound",
      requested: args.params.generateAudio === true ? "on" : "off",
      required: required2.has("sound")
    });
  } else if (args.params.generateAudio === true) {
    throw new Error(`Topview model "${submitModel}" does not support native sound.`);
  }
  if (args.taskType === "image_to_video") {
    const firstFrame = args.references.find((entry) => entry.role === "start_image");
    const endFrame = args.references.find((entry) => entry.role === "end_image");
    if (!firstFrame) throw new Error("Topview image-to-video generation requires an explicit start-frame element.");
    req.firstFrameFileId = firstFrame.fileId;
    if (endFrame) req.endFrameFileId = endFrame.fileId;
  }
  if (args.taskType === "omni_reference") {
    let imageIndex = 0;
    let videoIndex = 0;
    let audioIndex = 0;
    const inputImages = [];
    const inputVideos = [];
    const inputAudios = [];
    const instructions = [];
    for (const reference of args.references) {
      if (reference.role === "video") {
        const name2 = `Video${++videoIndex}`;
        inputVideos.push({ fileId: reference.fileId, name: name2 });
        instructions.push(`<<<${name2}>>> is a supplied motion and timing reference.`);
      } else if (reference.role === "audio") {
        const name2 = `Audio${++audioIndex}`;
        inputAudios.push({ fileId: reference.fileId, name: name2 });
        instructions.push(`<<<${name2}>>> is a supplied audio reference.`);
      } else {
        const name2 = `Image${++imageIndex}`;
        inputImages.push({ fileId: reference.fileId, name: name2 });
        const meaning = reference.role === "start_image" ? "the requested opening-frame reference" : reference.role === "end_image" ? "the requested closing-frame reference" : "a supplied visual reference";
        instructions.push(`<<<${name2}>>> is ${meaning}.`);
      }
    }
    if (inputAudios.length && !advertisesField(model, "inputAudios")) {
      throw new Error(`Topview model "${submitModel}" does not accept audio reference elements for omni-reference video.`);
    }
    prompt = `${instructions.join("\n")} Follow the supplied references for the subjects, wardrobe, props, materials, colour, setting, and requested motion.

${prompt}`;
    req.prompt = prompt;
    if (inputImages.length) req.inputImages = inputImages;
    if (inputVideos.length) req.inputVideos = inputVideos;
    if (inputAudios.length) req.inputAudios = inputAudios;
  }
  for (const field of required2) {
    if (req[field] === void 0 || req[field] === null || req[field] === "") {
      throw new Error(`Topview model "${submitModel}" requires "${field}" for this request.`);
    }
  }
  const duration = Number(req.duration ?? defaults.duration);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : void 0;
  return { req, model: submitModel, ...durationSec !== void 0 ? { durationSec } : {} };
}
const CONTENT_TYPE_FORMATS = {
  "image/bmp": "bmp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav"
};
const FORMAT_CONTENT_TYPES = {
  bmp: "image/bmp",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav"
};
function allowedFormats(role) {
  if (role === "video") return /* @__PURE__ */ new Set(["mp4", "avi", "mov"]);
  if (role === "audio") return /* @__PURE__ */ new Set(["mp3", "wav", "m4a"]);
  return /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "bmp", "webp"]);
}
function referenceFormat(value, role, contentType) {
  const normalizedType = (contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  const byType = normalizedType ? CONTENT_TYPE_FORMATS[normalizedType] : void 0;
  const pathname = (() => {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  })();
  const byExtension = path.extname(pathname).slice(1).toLowerCase();
  const format = byType ?? byExtension;
  if (!format || !allowedFormats(role).has(format)) {
    const label = role === "video" ? "video" : role === "audio" ? "audio" : "image";
    throw new Error(`Topview received an unsupported ${label} reference format. Supported formats: ${[...allowedFormats(role)].join(", ")}.`);
  }
  if (normalizedType && !byType) {
    throw new Error(`Topview refused a remote reference with content type "${normalizedType}".`);
  }
  return format;
}
function ipv4Bytes(address) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : void 0;
}
function ipv6Bytes(address) {
  var _a;
  let normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized.startsWith("[") && normalized.endsWith("]")) normalized = normalized.slice(1, -1);
  const ipv4Tail = (_a = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)) == null ? void 0 : _a[1];
  if (ipv4Tail) {
    const bytes = ipv4Bytes(ipv4Tail);
    if (!bytes) return void 0;
    normalized = `${normalized.slice(0, -ipv4Tail.length)}${(bytes[0] << 8 | bytes[1]).toString(16)}:${(bytes[2] << 8 | bytes[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return void 0;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if (halves.length === 1 && omitted !== 0 || omitted < 0) return void 0;
  const groups = [...left, ...Array.from({ length: omitted }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return void 0;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >>> 8, value & 255];
  });
}
function isPublicIpv4(address) {
  const bytes = ipv4Bytes(address);
  if (!bytes) return false;
  const [a, b, c] = bytes;
  return !(a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 0 && c === 0 || a === 192 && b === 0 && c === 2 || a === 192 && b === 88 && c === 99 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19) || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113 || a >= 224);
}
function isPublicTopviewReferenceAddress(address) {
  const normalized = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const version2 = isIP(normalized.split("%", 1)[0]);
  if (version2 === 4) return isPublicIpv4(normalized);
  if (version2 !== 6) return false;
  const bytes = ipv6Bytes(normalized);
  if (!bytes) return false;
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 255 && bytes[11] === 255;
  if (mappedIpv4) return isPublicIpv4(bytes.slice(12).join("."));
  if (bytes[0] < 32 || bytes[0] > 63) return false;
  if (bytes[0] === 32 && bytes[1] === 1 && (bytes[2] & 254) === 0) return false;
  if (bytes[0] === 32 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 2) return false;
  if (bytes[0] === 32 && bytes[1] === 1 && bytes[2] === 13 && bytes[3] === 184) return false;
  if (bytes[0] === 32 && bytes[1] === 1 && (bytes[2] & 240) === 16) return false;
  if (bytes[0] === 32 && bytes[1] === 1 && (bytes[2] & 240) === 32) return false;
  if (bytes[0] === 32 && bytes[1] === 2) return false;
  if (bytes[0] === 63 && (bytes[1] & 240) === 240) return false;
  return true;
}
async function resolvePublicReferenceHost(hostname) {
  const normalized = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const lower = normalized.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal")) {
    throw new Error("Topview remote references must use a public HTTPS host.");
  }
  const literalFamily = isIP(normalized);
  const addresses = literalFamily ? [{ address: normalized, family: literalFamily }] : await lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicTopviewReferenceAddress(entry.address))) {
    throw new Error("Topview remote references cannot resolve to a private, local, or reserved network address.");
  }
  return { address: addresses[0].address, family: addresses[0].family };
}
async function downloadPublicReference(value, redirects = 0) {
  if (redirects > 5) throw new Error("Topview remote reference redirected too many times.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw new Error("Topview remote references must use public HTTPS URLs without credentials or custom ports.");
  }
  const resolved = await resolvePublicReferenceHost(url.hostname);
  return new Promise((resolve, reject) => {
    const request2 = request$2({
      protocol: "https:",
      hostname: resolved.address,
      family: resolved.family,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? void 0 : url.hostname,
      headers: {
        Accept: "image/png,image/jpeg,image/bmp,image/webp,video/mp4,video/quicktime,video/x-msvideo,audio/mpeg,audio/mp4,audio/wav",
        Host: url.host
      }
    }, (response2) => {
      const status = response2.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = response2.headers.location;
        response2.resume();
        if (!location) {
          reject(new Error(`Topview remote reference redirected without a destination (${status}).`));
          return;
        }
        downloadPublicReference(new URL(location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response2.resume();
        reject(new Error(`Topview could not download an element reference (${status}).`));
        return;
      }
      const declaredSize = Number(response2.headers["content-length"] ?? 0);
      if (Number.isFinite(declaredSize) && declaredSize > MAX_REFERENCE_BYTES) {
        response2.destroy();
        reject(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
        return;
      }
      const chunks = [];
      let size = 0;
      response2.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_REFERENCE_BYTES) {
          response2.destroy(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response2.once("error", reject);
      response2.once("end", () => resolve({
        bytes: Buffer.concat(chunks),
        contentType: typeof response2.headers["content-type"] === "string" ? response2.headers["content-type"] : void 0,
        finalUrl: url.href
      }));
    });
    request2.setTimeout(REFERENCE_DOWNLOAD_TIMEOUT_MS, () => {
      request2.destroy(new Error("Topview timed out while downloading an element reference."));
    });
    request2.once("error", reject);
    request2.end();
  });
}
async function loadReference(value, role) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Topview received an empty element reference.");
  if (trimmed.startsWith("data:")) {
    const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(trimmed);
    if (!match) throw new Error("Topview received an unsupported inline element reference.");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > MAX_REFERENCE_BYTES) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const format2 = referenceFormat("", role, match[1]);
    return { bytes, format: format2, contentType: FORMAT_CONTENT_TYPES[format2] };
  }
  let filePath;
  if (trimmed.startsWith("local-media://file")) {
    try {
      filePath = decodeURIComponent(trimmed.slice("local-media://file".length));
    } catch {
      filePath = trimmed.slice("local-media://file".length);
    }
  } else if (trimmed.startsWith("file://")) {
    filePath = decodeURIComponent(new URL(trimmed).pathname);
  } else if (!/^https?:\/\//i.test(trimmed)) {
    filePath = trimmed;
  }
  if (filePath) {
    const stats = await fs$1.stat(filePath);
    if (!stats.isFile()) throw new Error("A Topview element reference is not a file.");
    if (stats.size > MAX_REFERENCE_BYTES) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const format2 = referenceFormat(filePath, role);
    return { bytes: await fs$1.readFile(filePath), format: format2, contentType: FORMAT_CONTENT_TYPES[format2], filePath };
  }
  const downloaded = await downloadPublicReference(trimmed);
  const format = referenceFormat(downloaded.finalUrl, role, downloaded.contentType);
  return { bytes: downloaded.bytes, format, contentType: FORMAT_CONTENT_TYPES[format] };
}
const SEEDANCE_2_5_REFERENCE_VIDEO_MIN_PIXELS = 407696;
const SEEDANCE_REFERENCE_VIDEO_MIN_PIXELS = 409600;
function topviewReferenceVideoMinPixels(submitModel) {
  const model = topviewModelSlug(submitModel);
  if (model.includes("seedance-2-5")) return SEEDANCE_2_5_REFERENCE_VIDEO_MIN_PIXELS;
  return model.includes("seedance-2") ? SEEDANCE_REFERENCE_VIDEO_MIN_PIXELS : void 0;
}
function formatPixelCount(value) {
  return value.toLocaleString("en-US");
}
function topviewReferenceVideoFloorError(args) {
  const floor = topviewReferenceVideoMinPixels(args.submitModel);
  if (floor === void 0) return void 0;
  const pixels = args.width * args.height;
  if (pixels >= floor) return void 0;
  return `This reference video is ${args.width}x${args.height}, which is ${formatPixelCount(pixels)} pixels per frame. "${args.submitModel}" requires at least ${formatPixelCount(floor)}. Re-encode the clip at 854x480 or larger for 16:9 (960x540 is a safe choice), then attach it again.`;
}
function topviewRejectionHint(message) {
  var _a;
  if (/video\s+pixel\s+count/i.test(message)) {
    const reportedFloor = (_a = /greater\s+than\s+or\s+equal\s+to\s+(\d+)/i.exec(message)) == null ? void 0 : _a[1];
    const floor = reportedFloor ? Number.parseInt(reportedFloor, 10) : SEEDANCE_REFERENCE_VIDEO_MIN_PIXELS;
    return `Seedance rejected a reference video for being too small. It needs at least ${formatPixelCount(floor)} pixels per frame, so re-encode the clip at 854x480 or larger for 16:9 (960x540 is a safe choice) and attach it again. A 640x360 clip is the usual cause.`;
  }
  if (topviewRequiresInheritedVideoDuration(message)) {
    return "Seedance read this prompt as an edit of the attached clip, so the render takes its length and aspect ratio from that video instead of the duration you picked. CineGen resubmits this automatically — if it fails again, the attached clip is outside the 4-30 second range Seedance edits.";
  }
  if (/copyright|infring|intellectual\s+property|trademark|likeness|celebrit/i.test(message)) {
    return "Topview's content check rejected this submission. It usually flags a named brand, film, studio, or real person in the prompt, or a reference image it reads as protected — rephrase that part or swap the reference, then run it again.";
  }
  if (/moderat|content\s+polic|violat|sensitive|nsfw|blocked|not\s+allowed/i.test(message)) {
    return "Topview's content policy rejected this submission. Rephrase the flagged part of the prompt, or remove the reference it objected to, then run it again.";
  }
  return void 0;
}
function uploadHeaders(value) {
  var _a;
  const headerRecord = (_a = collectRecords(value).find((record) => isRecord(record.headers))) == null ? void 0 : _a.headers;
  if (!isRecord(headerRecord)) return {};
  return Object.fromEntries(Object.entries(headerRecord).filter((entry) => typeof entry[1] === "string"));
}
class TopviewMcpService {
  constructor() {
    this.store = new SafeCredentialStore();
  }
  async saveToken(payload, previous = {}) {
    if (typeof payload.access_token !== "string" || !payload.access_token.trim()) {
      throw new Error("Topview returned an invalid access token.");
    }
    const token2 = {
      ...previous,
      ...payload,
      access_token: payload.access_token,
      refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : previous.refresh_token,
      expires_at: Date.now() + Math.max(30, Number(payload.expires_in || 3600)) * 1e3
    };
    await this.store.write("token", token2);
    return token2;
  }
  async tokenExchange(body, client2) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) if (value !== void 0) form.set(key, String(value));
    form.set("client_id", client2.client_id);
    if (client2.client_secret) form.set("client_secret", client2.client_secret);
    return requestJson(TOPVIEW_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    }, "Topview could not complete authorization.");
  }
  async accessToken() {
    const token2 = await this.store.read("token");
    if (!(token2 == null ? void 0 : token2.access_token)) throw new Error("Connect your Topview account in Settings before generating.");
    if (token2.expires_at > Date.now() + 6e4) return token2.access_token;
    const client2 = await this.store.read("client");
    if (!(client2 == null ? void 0 : client2.client_id) || !token2.refresh_token) {
      await this.store.remove("token");
      throw new Error("Your Topview connection expired. Connect it again in Settings.");
    }
    try {
      const refreshed = await this.tokenExchange({
        grant_type: "refresh_token",
        refresh_token: token2.refresh_token,
        resource: TOPVIEW_RESOURCE
      }, client2);
      return (await this.saveToken(refreshed, token2)).access_token;
    } catch (error) {
      await this.store.remove("token");
      throw new Error("Your Topview connection expired. Connect it again in Settings.", { cause: error });
    }
  }
  async teamConnection() {
    const client2 = await this.store.read("client");
    const token2 = await this.store.read("token");
    if ((client2 == null ? void 0 : client2.client_id) && (token2 == null ? void 0 : token2.access_token)) {
      await this.accessToken();
      const refreshed = await this.store.read("token");
      if (refreshed == null ? void 0 : refreshed.access_token) return { client: client2, token: refreshed };
    }
    try {
      const official = JSON.parse(await fs$1.readFile(
        path.join(app.getPath("home"), ".topview", "credentials.json"),
        "utf8"
      ));
      if (isRecord(official) && typeof official.api_key === "string" && official.api_key.trim() && typeof official.uid === "string" && official.uid.trim()) {
        return {
          apiKey: official.api_key.trim(),
          uid: official.uid.trim(),
          ...typeof official.email === "string" && official.email.trim() ? { email: official.email.trim() } : {}
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Could not read the official Topview device connection.", error);
      }
    }
    return null;
  }
  async mcpRequest(token2, message, sessionId) {
    var _a;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
    (_a = timeout.unref) == null ? void 0 : _a.call(timeout);
    try {
      const response2 = await fetch(TOPVIEW_MCP_URL, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token2}`,
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
          ...sessionId ? { "Mcp-Session-Id": sessionId } : {}
        },
        body: JSON.stringify(message),
        signal: controller.signal
      });
      const text = await response2.text();
      const parsed = (response2.headers.get("content-type") || "").includes("text/event-stream") ? parseSse(text, message.id) : text ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })() : {};
      if (!response2.ok) throw remoteError(response2.status, parsed, "Topview MCP request failed.");
      if (isRecord(parsed) && parsed.error !== void 0) throw remoteError(400, parsed.error, "Topview MCP returned an error.");
      return {
        payload: isRecord(parsed) ? parsed : {},
        sessionId: response2.headers.get("mcp-session-id") || sessionId
      };
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Topview did not respond in time. The generation may still be running in your Topview board.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async session() {
    const token2 = await this.accessToken();
    const initialized = await this.mcpRequest(token2, {
      jsonrpc: "2.0",
      id: `init-${crypto$1.randomUUID()}`,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "CineGen Desktop", version: "1.0.1" }
      }
    });
    const notified = await this.mcpRequest(token2, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    }, initialized.sessionId);
    let sessionId = notified.sessionId || initialized.sessionId;
    let cursor;
    const seenCursors = /* @__PURE__ */ new Set();
    const toolsByName = /* @__PURE__ */ new Map();
    for (let page = 0; page < MAX_MCP_TOOL_PAGES; page += 1) {
      const listed = await this.mcpRequest(token2, {
        jsonrpc: "2.0",
        id: `tools-${crypto$1.randomUUID()}`,
        method: "tools/list",
        params: cursor === void 0 ? {} : { cursor }
      }, sessionId);
      sessionId = listed.sessionId || sessionId;
      const result = isRecord(listed.payload.result) ? listed.payload.result : {};
      const pageTools = Array.isArray(result.tools) ? result.tools.filter((tool) => isRecord(tool) && typeof tool.name === "string") : [];
      for (const tool of pageTools) toolsByName.set(tool.name, tool);
      const nextCursor = result.nextCursor;
      if (typeof nextCursor !== "string" || !nextCursor) {
        return { token: token2, sessionId, tools: [...toolsByName.values()] };
      }
      if (seenCursors.has(nextCursor)) throw new Error("Topview returned a repeated MCP tools cursor.");
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(`Topview returned more than ${MAX_MCP_TOOL_PAGES} MCP tool pages.`);
  }
  async callTool(session2, name2, req) {
    const tool = session2.tools.find((entry) => entry.name === name2);
    if (!tool) throw new Error(`Your Topview account does not currently expose ${name2}.`);
    const called = await this.mcpRequest(session2.token, {
      jsonrpc: "2.0",
      id: `call-${crypto$1.randomUUID()}`,
      method: "tools/call",
      params: {
        name: name2,
        arguments: toolArguments(tool, req)
      }
    }, session2.sessionId);
    session2.sessionId = called.sessionId || session2.sessionId;
    const result = isRecord(called.payload) ? called.payload.result : void 0;
    if (isRecord(result) && result.isError === true) {
      const documents = parseToolDocuments(result);
      const reported = findStringByKeys(documents, [
        "errorMsg",
        "error_msg",
        "errorMessage",
        "error_message",
        "failureReason",
        "failure_reason",
        "message"
      ]) ?? collectStrings(result).join(" ").slice(0, 700);
      const message = reported.trim() || `Topview could not run ${name2}.`;
      const hint = topviewRejectionHint(message);
      throw new Error(hint ? `${message}

${hint}` : message);
    }
    return result;
  }
  async chooseBoard(session2) {
    const listed = await this.callTool(session2, "topview_list_boards", {
      pageNo: 1,
      pageSize: 100,
      mode: "editable-by-me"
    });
    const existing = topviewBoard(parseToolDocuments(listed));
    if (existing) return existing.boardId;
    const created = await this.callTool(session2, "topview_create_board", { name: "CineGen" });
    const boardId = findStringByKeys(parseToolDocuments(created), ["boardId", "board_id", "id"]);
    if (!boardId) throw new Error("Topview did not return a board ID for the CineGen board.");
    return boardId;
  }
  async uploadReference(session2, reference, submitModel) {
    if (reference.value.startsWith("topview-file:")) {
      const fileId2 = reference.value.slice("topview-file:".length).trim();
      if (!fileId2) throw new Error("Topview received an empty existing file ID.");
      return { ...reference, fileId: fileId2 };
    }
    let source = await loadReference(reference.value, reference.role);
    let preparation;
    if (reference.role === "video" && submitModel && topviewReferenceVideoMinPixels(submitModel) !== void 0) {
      const size = await probeVideoFrameSize(source);
      const undersized = size && topviewReferenceVideoFloorError({ submitModel, ...size });
      if (size && undersized) {
        const target = minimumEvenFrameSize(size, SEEDANCE_REFERENCE_VIDEO_MIN_PIXELS);
        try {
          const bytes = await transcodeVideoFrameSize(source, target);
          if (bytes.length > MAX_REFERENCE_BYTES) {
            throw new Error("The resized reference exceeds CineGen's 45 MB Topview upload safety limit.");
          }
          source = { bytes, format: "mp4", contentType: FORMAT_CONTENT_TYPES.mp4 };
          preparation = `Upscaled reference video ${size.width}x${size.height} → ${target.width}x${target.height}`;
          console.info(
            `[topview] resized Seedance reference video ${size.width}x${size.height} -> ${target.width}x${target.height}`
          );
        } catch (error) {
          console.warn("[topview] could not resize undersized Seedance reference video", error);
          throw new Error(`${undersized}

CineGen could not create the temporary resized copy automatically.`);
        }
      } else if (!size) {
        console.warn("[topview] ffprobe could not read a Seedance video reference; using the FFmpeg compatibility fallback");
        try {
          const bytes = await transcodeVideoToMinimumPixels(source, SEEDANCE_REFERENCE_VIDEO_MIN_PIXELS);
          if (bytes.length > MAX_REFERENCE_BYTES) {
            throw new Error("The prepared reference exceeds CineGen's 45 MB Topview upload safety limit.");
          }
          source = { bytes, format: "mp4", contentType: FORMAT_CONTENT_TYPES.mp4 };
          preparation = "Prepared reference video at Seedance-compatible resolution";
          console.info("[topview] prepared Seedance reference video with the area-based compatibility fallback");
        } catch (error) {
          console.warn("[topview] could not prepare the Seedance reference video", error);
          throw new Error("CineGen could not read or resize this Seedance reference video. Re-encode it as an H.264 MP4 and attach it again.");
        }
      } else {
        console.info(`[topview] Seedance reference video is already compatible at ${size.width}x${size.height}`);
      }
    }
    const credential = await this.callTool(session2, "ta_upload_credential", {
      format: source.format,
      needAccelerateUrl: false
    });
    const documents = parseToolDocuments(credential);
    const fileId = findStringByKeys(documents, ["fileId", "file_id"]);
    const uploadUrl = findStringByKeys(documents, ["uploadUrl", "upload_url", "accelerateUrl", "accelerate_url"]);
    if (!fileId || !uploadUrl) throw new Error("Topview did not return a usable upload destination for an element.");
    const method = (findStringByKeys(documents, ["method", "httpMethod", "http_method"]) || "PUT").toUpperCase();
    const response2 = await fetch(uploadUrl, {
      method,
      headers: { ...uploadHeaders(documents), ...source.contentType ? { "Content-Type": source.contentType } : {} },
      body: source.bytes
    });
    if (!response2.ok) throw new Error(`Topview could not upload an element reference (${response2.status}).`);
    const checked = await this.callTool(session2, "ta_upload_check_file", { fileId });
    if (findBoolean(parseToolDocuments(checked)) === false) throw new Error("Topview could not verify an uploaded element reference.");
    return { ...reference, fileId, ...preparation ? { preparation } : {} };
  }
  async reusableGeneratedImageReference(session2, url) {
    try {
      const uploaded = await this.uploadReference(session2, { value: url, role: "image" });
      return `topview-file:${uploaded.fileId}`;
    } catch (error) {
      console.warn("Could not prepare the generated Topview image as a reusable reference.", error);
      return void 0;
    }
  }
  async accountStatus() {
    const storageError = this.store.availabilityError();
    if (storageError) return { connected: false, configured: false, error: storageError };
    try {
      const token2 = await this.store.read("token");
      if (!(token2 == null ? void 0 : token2.access_token)) return { connected: false, configured: true };
      const accessToken = await this.accessToken();
      const profile = await requestJson(TOPVIEW_USERINFO_URL, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
      }, "Topview could not validate the connected account.");
      await this.store.write("profile", profile);
      const session2 = await this.session();
      const requiredTools = [
        "topview_get_generation_config",
        "topview_generate_image",
        "topview_generate_video",
        "topview_query_task",
        "ta_upload_credential",
        "ta_upload_check_file",
        "topview_list_boards",
        "topview_create_board"
      ];
      const missingTools = requiredTools.filter((name2) => !session2.tools.some((tool) => tool.name === name2));
      if (missingTools.length) {
        throw new Error(`This Topview account is missing required MCP capabilities: ${missingTools.join(", ")}.`);
      }
      let credits = topviewCreditBalance(profile);
      if (session2.tools.some((tool) => tool.name === "topview_get_credit")) {
        try {
          credits = topviewCreditBalance(parseToolDocuments(await this.callTool(session2, "topview_get_credit", {}))) ?? credits;
        } catch {
        }
      }
      return {
        connected: true,
        configured: true,
        authMode: "oauth",
        creditType: "mcp",
        ...typeof (profile == null ? void 0 : profile.email) === "string" ? { email: profile.email } : {},
        ...credits !== void 0 ? { credits } : {}
      };
    } catch (error) {
      return { connected: false, configured: true, error: safeMessage(error, "Topview connection expired.") };
    }
  }
  async modelCatalog() {
    const session2 = await this.session();
    if (!session2.tools.some((tool) => tool.name === "topview_get_generation_config")) {
      throw new Error("Your Topview account does not currently expose its model catalog.");
    }
    const requests = [
      { outputType: "image", taskType: "text_to_image" },
      { outputType: "image", taskType: "image_edit" },
      { outputType: "video", taskType: "text_to_video" },
      { outputType: "video", taskType: "image_to_video" },
      { outputType: "video", taskType: "omni_reference" },
      { outputType: "audio", taskType: "music", catalogType: "music" },
      { outputType: "audio", taskType: "voice", catalogType: "voice" },
      { outputType: "audio", taskType: "audio", catalogType: "audio" }
    ];
    const configs = [];
    for (const request2 of requests) {
      try {
        const config2 = parseToolDocuments(await this.callTool(session2, "topview_get_generation_config", {
          type: request2.catalogType ?? request2.outputType,
          ...request2.catalogType ? {} : { taskType: request2.taskType },
          refresh: true
        }));
        configs.push({ ...request2, config: config2 });
      } catch {
      }
    }
    if (!configs.length) throw new Error("Topview returned an empty model catalog.");
    return {
      configs,
      tools: session2.tools.map((tool) => tool.name),
      toolSchemas: Object.fromEntries(session2.tools.filter((tool) => ["topview_get_generation_config", "topview_generate_audio", "topview_generate_music", "topview_generate_voice", "topview_clone_voice", "topview_query_task"].includes(tool.name)).map((tool) => [tool.name, tool.inputSchema])),
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async authLogin() {
    var _a;
    const storageError = this.store.availabilityError();
    if (storageError) throw new Error(storageError);
    const server2 = createServer();
    await new Promise((resolve, reject) => {
      server2.once("error", reject);
      server2.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server2.address();
    if (!address || typeof address === "string") {
      server2.close();
      throw new Error("CineGen could not open a secure local return address for Topview.");
    }
    const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
    const verifier = base64Url(crypto$1.randomBytes(48));
    const challenge = base64Url(crypto$1.createHash("sha256").update(verifier).digest());
    const state = base64Url(crypto$1.randomBytes(32));
    let callbackResponse;
    let rejectCallback;
    const callback = new Promise((resolve, reject) => {
      rejectCallback = reject;
      server2.on("request", (request2, response2) => {
        const url = new URL(request2.url || "/", redirectUri);
        if (url.pathname !== "/oauth/callback") {
          response2.writeHead(404).end();
          return;
        }
        callbackResponse = response2;
        resolve(url);
      });
    });
    const callbackTimer = setTimeout(() => rejectCallback == null ? void 0 : rejectCallback(new Error("Topview sign-in timed out. Try connecting again.")), OAUTH_TIMEOUT_MS);
    (_a = callbackTimer.unref) == null ? void 0 : _a.call(callbackTimer);
    try {
      const registered = await requestJson(TOPVIEW_REGISTER_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "CineGen Desktop",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "openid email mcp:tools"
        })
      }, "Topview could not register CineGen for sign-in.");
      if (typeof registered.client_id !== "string") throw new Error("Topview did not return an OAuth client ID.");
      const client2 = {
        ...registered,
        client_id: registered.client_id,
        client_secret: typeof registered.client_secret === "string" ? registered.client_secret : void 0,
        token_endpoint_auth_method: typeof registered.token_endpoint_auth_method === "string" ? registered.token_endpoint_auth_method : "none",
        redirect_uri: redirectUri
      };
      await this.store.write("client", client2);
      const authorization = new URL(TOPVIEW_AUTHORIZE_URL);
      authorization.search = new URLSearchParams({
        response_type: "code",
        client_id: client2.client_id,
        redirect_uri: redirectUri,
        scope: "openid email mcp:tools",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: TOPVIEW_RESOURCE
      }).toString();
      await shell.openExternal(authorization.href);
      const returned = await callback;
      const oauthError = returned.searchParams.get("error_description") || returned.searchParams.get("error");
      if (oauthError) throw new Error(oauthError);
      if (returned.searchParams.get("state") !== state) throw new Error("Topview sign-in could not be verified. Try again.");
      const code = returned.searchParams.get("code");
      if (!code) throw new Error("Topview did not return an authorization code.");
      const token2 = await this.tokenExchange({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: TOPVIEW_RESOURCE
      }, client2);
      const stored = await this.saveToken(token2);
      try {
        const profileResponse = await fetch(TOPVIEW_USERINFO_URL, {
          headers: { Accept: "application/json", Authorization: `Bearer ${stored.access_token}` }
        });
        const profile = await readResponse(profileResponse);
        if (profileResponse.ok && isRecord(profile)) await this.store.write("profile", profile);
      } catch {
      }
      sendOauthPage(callbackResponse, true, "You can close this window and return to CineGen.");
      return this.accountStatus();
    } catch (error) {
      if (callbackResponse && !callbackResponse.writableEnded) {
        sendOauthPage(callbackResponse, false, safeMessage(error, "Topview sign-in did not complete."));
      }
      throw error;
    } finally {
      clearTimeout(callbackTimer);
      server2.close();
    }
  }
  async authLogout() {
    await Promise.all([
      this.store.remove("token"),
      this.store.remove("client"),
      this.store.remove("profile")
    ]);
  }
  validateGenerateParams(params) {
    if (!params || typeof params.prompt !== "string" || !params.prompt.trim()) {
      throw new Error("Topview video generation requires a prompt.");
    }
  }
  /**
   * Submits the built request, retrying once with the inherited clip duration when Seedance
   * classifies the job as video editing. That verdict depends on the prompt and only arrives
   * as a rejection, which the provider refunds, so the retry reuses the uploaded references
   * instead of asking the user to resubmit by hand.
   */
  async submitVideoRequest(session2, args) {
    const built = buildTopviewVideoRequest(args);
    try {
      return { built, documents: parseToolDocuments(await this.callTool(session2, "topview_generate_video", built.req)) };
    } catch (error) {
      if (!topviewRequiresInheritedVideoDuration(safeMessage(error, ""))) throw error;
      console.info("[topview] resubmitting as a video edit so the render inherits the input clip length");
      const retried = buildTopviewVideoRequest({ ...args, inheritInputVideoDuration: true });
      return {
        built: retried,
        documents: parseToolDocuments(await this.callTool(session2, "topview_generate_video", retried.req))
      };
    }
  }
  async submitWithSession(session2, params) {
    this.validateGenerateParams(params);
    const references = normalizeTopviewReferences(params.medias);
    const taskType = topviewTaskTypeForMedias(params.medias);
    const boardId = await this.chooseBoard(session2);
    const config2 = parseToolDocuments(await this.callTool(session2, "topview_get_generation_config", {
      type: "video",
      taskType
    }));
    const preflight = buildTopviewVideoRequest({
      config: config2,
      taskType,
      params,
      boardId,
      references: references.map((reference, index) => ({ ...reference, fileId: `preflight-${index + 1}` }))
    });
    const uploaded = [];
    for (const reference of references) {
      uploaded.push(await this.uploadReference(session2, reference, preflight.model));
    }
    const { built, documents } = await this.submitVideoRequest(session2, {
      config: config2,
      taskType,
      params,
      references: uploaded,
      boardId
    });
    const taskId = findStringByKeys(documents, ["taskId", "task_id", "generationId", "generation_id"]);
    if (!taskId) throw new Error("Topview did not return a task ID for this generation.");
    return {
      result: {
        taskId,
        taskType,
        boardId,
        model: built.model,
        durationSec: built.durationSec,
        ...uploaded.some((reference) => reference.preparation) ? {
          referencePreparation: uploaded.flatMap((reference) => reference.preparation ?? []).join("; ")
        } : {}
      },
      documents
    };
  }
  async submit(params) {
    const submitted = await this.submitWithSession(await this.session(), params);
    return submitted.result;
  }
  validateQueryParams(params) {
    if (!params || typeof params.taskId !== "string" || !params.taskId.trim()) {
      throw new Error("Topview task query requires a task ID.");
    }
    if (!["text_to_video", "image_to_video", "omni_reference"].includes(params.taskType)) {
      throw new Error("Topview task query received an unsupported task type.");
    }
    if (typeof params.boardId !== "string" || !params.boardId.trim()) {
      throw new Error("Topview task query requires the board ID returned by submit.");
    }
    if (typeof params.model !== "string" || !params.model.trim()) {
      throw new Error("Topview task query requires the complete result returned by submit.");
    }
    if (params.durationSec !== void 0 && !Number.isFinite(params.durationSec)) {
      throw new Error("Topview task query received an invalid duration.");
    }
  }
  async queryWithSession(session2, params) {
    this.validateQueryParams(params);
    const polled = await this.callTool(session2, "topview_query_task", {
      taskType: params.taskType,
      taskId: params.taskId.trim(),
      needCloudFrontUrl: true
    });
    const documents = parseToolDocuments(polled);
    const rawStatus = taskStatus(documents);
    const url = findResultUrl(documents);
    const failure = /fail|error|cancel/.test(rawStatus);
    const successful = Boolean(url) || /success|complete|done/.test(rawStatus);
    const status = failure ? "fail" : successful && url ? "success" : successful ? "fail" : /^(init|created|queued)$/.test(rawStatus) ? "init" : "running";
    const boardTaskId = findStringByKeys(documents, ["boardTaskId", "board_task_id"]);
    const remoteErrorMessage = findStringByKeys(documents, [
      "errorMsg",
      "error_msg",
      "errorMessage",
      "error_message",
      "failureReason",
      "failure_reason"
    ]);
    const remoteErrorHint = remoteErrorMessage ? topviewRejectionHint(remoteErrorMessage) : void 0;
    const error = status !== "fail" ? void 0 : remoteErrorMessage ? remoteErrorHint ? `${remoteErrorMessage}

${remoteErrorHint}` : remoteErrorMessage : successful ? "Topview completed the task without returning a video URL." : "Topview could not complete this video.";
    return {
      ...params,
      taskId: params.taskId.trim(),
      status,
      ...url ? { url } : {},
      ...error ? { error } : {},
      boardUrl: `https://www.topview.ai/board/${encodeURIComponent(params.boardId)}${boardTaskId ? `?boardResultId=${encodeURIComponent(boardTaskId)}` : ""}`
    };
  }
  async query(params) {
    return this.queryWithSession(await this.session(), params);
  }
  async generate(params) {
    const session2 = await this.session();
    const submitted = await this.submitWithSession(session2, params);
    const initialUrl = findResultUrl(submitted.documents);
    if (initialUrl) {
      return {
        url: initialUrl,
        mediaType: "video",
        durationSec: submitted.result.durationSec,
        taskId: submitted.result.taskId,
        model: submitted.result.model,
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(submitted.result.boardId)}`
      };
    }
    const initialStatus = taskStatus(submitted.documents);
    if (/fail|error|cancel/.test(initialStatus)) {
      throw new Error(findStringByKeys(submitted.documents, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this video.");
    }
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5e3));
      const query = await this.queryWithSession(session2, submitted.result);
      if (query.status === "fail") throw new Error(query.error ?? "Topview could not complete this video.");
      if (query.status === "success" && query.url) {
        return {
          url: query.url,
          mediaType: "video",
          durationSec: query.durationSec,
          taskId: query.taskId,
          model: query.model,
          boardUrl: query.boardUrl
        };
      }
    }
    throw new Error(`Topview is still processing task ${submitted.result.taskId}. Open your Topview board to check it; do not submit the same render again.`);
  }
  async generateImage(params) {
    if (!params || typeof params.prompt !== "string" || !params.prompt.trim()) {
      throw new Error("Topview image generation requires a prompt.");
    }
    const session2 = await this.session();
    const references = normalizeTopviewImageReferences(params.medias);
    const taskType = references.length ? "image_edit" : "text_to_image";
    const boardId = await this.chooseBoard(session2);
    const config2 = parseToolDocuments(await this.callTool(session2, "topview_get_generation_config", {
      type: "image",
      taskType
    }));
    buildTopviewImageRequest({
      config: config2,
      params,
      boardId,
      references: references.map((reference, index) => ({ ...reference, fileId: `preflight-${index + 1}` }))
    });
    const uploaded = [];
    for (const reference of references) uploaded.push(await this.uploadReference(session2, reference));
    const built = buildTopviewImageRequest({ config: config2, params, references: uploaded, boardId });
    const submitted = await this.callTool(session2, "topview_generate_image", built.req);
    const documents = parseToolDocuments(submitted);
    const taskId = findStringByKeys(documents, ["taskId", "task_id", "generationId", "generation_id"]);
    const initialUrl = findResultUrl(documents);
    if (initialUrl) {
      return {
        url: initialUrl,
        mediaType: "image",
        taskId,
        model: built.model,
        referenceValue: generatedImageFileReference(documents) ?? await this.reusableGeneratedImageReference(session2, initialUrl),
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}`
      };
    }
    if (!taskId) throw new Error("Topview did not return a task ID for this image generation.");
    const initialStatus = taskStatus(documents);
    if (/fail|error|cancel/.test(initialStatus)) {
      throw new Error(findStringByKeys(documents, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this image.");
    }
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3e3));
      const polled = await this.callTool(session2, "topview_query_task", {
        taskType: built.taskType,
        taskId,
        needCloudFrontUrl: true
      });
      const polledDocuments = parseToolDocuments(polled);
      const url = findResultUrl(polledDocuments);
      const status = taskStatus(polledDocuments);
      if (url) {
        const boardTaskId = findStringByKeys(polledDocuments, ["boardTaskId", "board_task_id"]);
        return {
          url,
          mediaType: "image",
          taskId,
          model: built.model,
          referenceValue: generatedImageFileReference(polledDocuments) ?? await this.reusableGeneratedImageReference(session2, url),
          boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}${boardTaskId ? `?boardResultId=${encodeURIComponent(boardTaskId)}` : ""}`
        };
      }
      if (/fail|error|cancel/.test(status)) {
        throw new Error(findStringByKeys(polledDocuments, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this image.");
      }
    }
    throw new Error(`Topview is still processing image task ${taskId}. Open your Topview board to check it; do not submit the same render again.`);
  }
  async generateAudio(params) {
    var _a;
    if (!params || typeof params.prompt !== "string" || !params.prompt.trim()) {
      throw new Error("Topview audio generation requires text or a prompt.");
    }
    const session2 = await this.session();
    const boardId = await this.chooseBoard(session2);
    let uploaded;
    if (params.referenceAudio) {
      uploaded = await this.uploadReference(session2, { value: params.referenceAudio, role: "audio" });
    }
    let toolName;
    let taskType;
    let request2;
    if (params.kind === "music") {
      toolName = "topview_generate_music";
      taskType = "ai_music";
      request2 = {
        model: params.model,
        lyrics: params.prompt.trim(),
        styles: params.styles,
        instrumental: params.instrumental,
        ...uploaded ? { referenceAudio: { fileId: uploaded.fileId } } : {},
        boardId
      };
    } else if (params.kind === "voice") {
      if (!((_a = params.voiceId) == null ? void 0 : _a.trim())) throw new Error("Choose a Topview voice ID for text-to-speech.");
      toolName = "topview_generate_voice";
      taskType = "text_to_speech";
      request2 = {
        voiceId: params.voiceId.trim(),
        voiceText: params.prompt.trim(),
        voiceSpeed: params.voiceSpeed,
        emotionName: params.emotion,
        boardId
      };
    } else {
      if (!uploaded) throw new Error("Seed Audio requires a reference audio clip.");
      toolName = "topview_generate_audio";
      taskType = "audio_design";
      request2 = {
        model: params.model,
        text: params.prompt.trim(),
        referenceAudioFileId: uploaded.fileId,
        emotionText: params.emotionText,
        boardId
      };
    }
    let documents = parseToolDocuments(await this.callTool(session2, toolName, request2));
    const taskId = findStringByKeys(documents, ["taskId", "task_id", "generationId", "generation_id"]);
    const immediate = findResultUrl(documents);
    if (immediate) return { url: immediate, mediaType: "audio", taskId, model: params.model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}` };
    if (!taskId) throw new Error("Topview did not return a task ID for this audio generation.");
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3e3));
      documents = parseToolDocuments(await this.callTool(session2, "topview_query_task", {
        taskType,
        taskId,
        needCloudFrontUrl: true
      }));
      const url = findResultUrl(documents);
      if (url) return { url, mediaType: "audio", taskId, model: params.model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}` };
      if (/fail|error|cancel/.test(taskStatus(documents))) {
        throw new Error(findStringByKeys(documents, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this audio generation.");
      }
    }
    throw new Error(`Topview is still processing audio task ${taskId}. Open your Topview board to check it; do not submit the same task again.`);
  }
}
let topviewMcpService;
function topviewService() {
  topviewMcpService ?? (topviewMcpService = new TopviewMcpService());
  return topviewMcpService;
}
function exportTopviewTeamConnection() {
  return topviewService().teamConnection();
}
function registerTopviewHandlers() {
  const service = topviewService();
  ipcMain.handle("topview:account-status", () => service.accountStatus());
  ipcMain.handle("topview:model-catalog", () => service.modelCatalog());
  ipcMain.handle("topview:auth-login", () => service.authLogin());
  ipcMain.handle("topview:auth-logout", () => service.authLogout());
  ipcMain.handle("topview:submit", (_event, params) => service.submit(params));
  ipcMain.handle("topview:query", (_event, params) => service.query(params));
  ipcMain.handle("topview:generate", (_event, params) => service.generate(params));
  ipcMain.handle("topview:generate-image", (_event, params) => service.generateImage(params));
  ipcMain.handle("topview:generate-audio", (_event, params) => service.generateAudio(params));
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
function safeElementFileName(rawName) {
  const extension = path.extname(rawName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const base = path.basename(rawName, path.extname(rawName)).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "reference";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${base}${extension}`;
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
      if (!apiKey) {
        const directory = path.join(app.getPath("userData"), "media", "elements");
        await fs$1.mkdir(directory, { recursive: true });
        const filePath = path.join(directory, safeElementFileName(fileData.name));
        await fs$1.writeFile(filePath, Buffer.from(fileData.buffer));
        return { url: `local-media://file${filePath}` };
      }
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
function projectDir$1(id) {
  return path.join(projectsRoot(), id);
}
function generateId() {
  return crypto$1.randomUUID();
}
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function ensureProjectDirs(id) {
  const root = projectDir$1(id);
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
    const dbPath = path.join(projectDir$1(projectId), "project.db");
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
function emptyElementsLibrary() {
  return { version: 1, folders: [], elements: [] };
}
function normalizeElement(raw) {
  var _a;
  if (!raw || typeof raw !== "object") return null;
  const row = raw;
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const type = row.type === "character" || row.type === "location" || row.type === "prop" || row.type === "vehicle" ? row.type : "character";
  const folderId = typeof row.folderId === "string" && row.folderId ? row.folderId : typeof row.folder_id === "string" && row.folder_id ? row.folder_id : void 0;
  const variations = normalizeVariations(row.variations);
  const activeVariationId = typeof row.activeVariationId === "string" && variations.some((variation) => variation.id === row.activeVariationId) ? row.activeVariationId : (_a = variations[0]) == null ? void 0 : _a.id;
  return {
    id,
    name: typeof row.name === "string" ? row.name : "Untitled",
    type,
    description: typeof row.description === "string" ? row.description : "",
    images: normalizeImages(row.images),
    variations: variations.length ? variations : void 0,
    activeVariationId,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : typeof row.updated_at === "string" ? row.updated_at : "",
    folderId
  };
}
function normalizeVariationKind(value) {
  return value === "baseline" || value === "wardrobe" || value === "condition" || value === "time" || value === "custom" ? value : "custom";
}
function normalizeVariations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) return [];
    return [{
      id,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Untitled look",
      kind: normalizeVariationKind(row.kind),
      description: typeof row.description === "string" ? row.description : "",
      images: normalizeImages(row.images),
      sourceVariationId: typeof row.sourceVariationId === "string" && row.sourceVariationId ? row.sourceVariationId : void 0,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : ""
    }];
  });
}
function normalizeImages(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const img = item;
    if (typeof img.id !== "string" || typeof img.url !== "string") return [];
    return [{
      id: img.id,
      url: img.url,
      createdAt: typeof img.createdAt === "string" ? img.createdAt : "",
      source: img.source === "generated" ? "generated" : "upload"
    }];
  });
}
function normalizeFolder(raw) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw;
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const sourceProjectId = typeof row.sourceProjectId === "string" && row.sourceProjectId ? row.sourceProjectId : void 0;
  return {
    id,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Untitled",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : (/* @__PURE__ */ new Date()).toISOString(),
    sourceProjectId
  };
}
function normalizeLibrary(raw) {
  if (!raw || typeof raw !== "object") return emptyElementsLibrary();
  const row = raw;
  const folders = Array.isArray(row.folders) ? row.folders.map(normalizeFolder).filter((f) => f !== null) : [];
  const folderIds = new Set(folders.map((f) => f.id));
  const elements = Array.isArray(row.elements) ? row.elements.map(normalizeElement).filter((e) => e !== null) : [];
  return {
    version: 1,
    folders,
    elements: elements.map((el) => el.folderId && !folderIds.has(el.folderId) ? { ...el, folderId: void 0 } : el)
  };
}
function migrateProjectsIntoLibrary(existing, projects) {
  const library = emptyElementsLibrary();
  const byId = new Map(library.elements.map((el) => [el.id, el]));
  const folders = [...library.folders];
  for (const project of projects) {
    const incoming = project.elements.map(normalizeElement).filter((e) => e !== null);
    if (incoming.length === 0) continue;
    let folder = folders.find((f) => f.sourceProjectId === project.id);
    if (!folder) {
      folder = {
        id: crypto.randomUUID(),
        name: project.name.trim() || "Untitled project",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        sourceProjectId: project.id
      };
      folders.push(folder);
    }
    for (const el of incoming) {
      if (byId.has(el.id)) continue;
      byId.set(el.id, { ...el, folderId: el.folderId && folders.some((f) => f.id === el.folderId) ? el.folderId : folder.id });
    }
  }
  return { version: 1, folders, elements: [...byId.values()] };
}
function syncProjectFolder(library, projectId, projectName) {
  const name2 = projectName.trim() || "Untitled project";
  const existing = library.folders.find((f) => f.sourceProjectId === projectId);
  if (!existing) {
    const folder = {
      id: crypto.randomUUID(),
      name: name2,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceProjectId: projectId
    };
    return { ...library, folders: [...library.folders, folder] };
  }
  if (existing.name === name2) return library;
  return {
    ...library,
    folders: library.folders.map((f) => f.id === existing.id ? { ...f, name: name2 } : f)
  };
}
function libraryPath() {
  return path.join(projectsRoot(), "elements-library.json");
}
function indexPath$1() {
  return path.join(projectsRoot(), "projects.json");
}
function projectDir(id) {
  return path.join(projectsRoot(), id);
}
async function writeLibrary(library) {
  await fs$1.mkdir(projectsRoot(), { recursive: true });
  const file = libraryPath();
  const tmp = `${file}.tmp`;
  await fs$1.writeFile(tmp, JSON.stringify(library, null, 2), "utf-8");
  await fs$1.rename(tmp, file);
}
async function readLibraryFile() {
  try {
    const raw = await fs$1.readFile(libraryPath(), "utf-8");
    return normalizeLibrary(JSON.parse(raw));
  } catch {
    return null;
  }
}
function collectProjectElements(entry) {
  const sqlitePath = path.join(projectDir(entry.id), "project.db");
  const jsonPath = path.join(projectDir(entry.id), "project.json");
  if (entry.useSqlite || fs.existsSync(sqlitePath)) {
    try {
      const db = new Database(sqlitePath, { readonly: true });
      const rows = db.prepare("SELECT * FROM elements").all();
      db.close();
      return { id: entry.id, name: entry.name, elements: rows };
    } catch {
      return { id: entry.id, name: entry.name, elements: [] };
    }
  }
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      return { id: entry.id, name: entry.name, elements: Array.isArray(data.elements) ? data.elements : [] };
    } catch {
      return { id: entry.id, name: entry.name, elements: [] };
    }
  }
  return { id: entry.id, name: entry.name, elements: [] };
}
async function migrateIfNeeded() {
  const existing = await readLibraryFile();
  if (existing) return existing;
  let projects = [];
  try {
    const index = JSON.parse(await fs$1.readFile(indexPath$1(), "utf-8"));
    projects = Array.isArray(index.projects) ? index.projects : [];
  } catch {
    projects = [];
  }
  const dumps = projects.map(collectProjectElements);
  const library = migrateProjectsIntoLibrary(null, dumps);
  await writeLibrary(library);
  return library;
}
function registerElementsLibraryHandlers() {
  ipcMain.handle(
    "elements-library:load",
    async (_event, opts) => {
      let library = await migrateIfNeeded();
      if ((opts == null ? void 0 : opts.projectId) && opts.projectName) {
        const next = syncProjectFolder(library, opts.projectId, opts.projectName);
        if (next !== library) {
          await writeLibrary(next);
          library = next;
        }
      }
      return library;
    }
  );
  ipcMain.handle("elements-library:save", async (_event, raw) => {
    const library = normalizeLibrary(raw);
    await writeLibrary(library);
    return library;
  });
}
const BASE_WEIGHTS = {
  termInText: 4,
  termElsewhere: 2,
  activeTimeline: 2,
  wordTiming: 2,
  hasEmotion: 1,
  hasDelivery: 1,
  energyMatch: 3,
  paceMatch: 3,
  notableSignal: 1,
  emotionQueryMatch: 5,
  emotionBias: 2
};
const PERSONA_WEIGHTS = {
  "documentary-editor": {
    weights: { paceMatch: 4, emotionBias: 3 },
    preferredEnergy: ["low", "measured", "calm", "deliberate", "steady"],
    preferredPace: ["slow", "measured", "deliberate", "unhurried"],
    emotionBias: ["reflective", "wistful", "sincere", "somber", "thoughtful", "emotional"]
  },
  "promo-trailer-editor": {
    weights: { energyMatch: 5, notableSignal: 2 },
    preferredEnergy: ["high", "driving", "punchy", "energetic", "intense", "building"],
    preferredPace: ["fast", "quick", "snappy", "urgent"],
    emotionBias: ["excited", "triumphant", "tense", "hyped", "epic"]
  },
  "brand-storyteller": {
    weights: { hasEmotion: 2, emotionBias: 3 },
    preferredEnergy: ["warm", "confident", "uplifting", "steady"],
    preferredPace: ["measured", "flowing", "smooth"],
    emotionBias: ["inspired", "hopeful", "proud", "warm", "aspirational"]
  },
  "social-shortform-editor": {
    weights: { energyMatch: 4, notableSignal: 3 },
    preferredEnergy: ["high", "punchy", "snappy", "energetic", "hooky"],
    preferredPace: ["fast", "quick", "snappy", "rapid"],
    emotionBias: ["excited", "funny", "surprised", "relatable", "bold"]
  },
  "interview-producer": {
    weights: { hasDelivery: 2, emotionBias: 2 },
    preferredEnergy: ["conversational", "natural", "steady", "engaged"],
    preferredPace: ["natural", "measured", "conversational"],
    emotionBias: ["candid", "reflective", "honest", "vulnerable", "emotional"]
  }
};
function resolveWeights(persona) {
  if (!persona) return BASE_WEIGHTS;
  return { ...BASE_WEIGHTS, ...PERSONA_WEIGHTS[persona].weights };
}
function descriptorMatches(descriptor, preferred) {
  if (!descriptor) return false;
  const lower = descriptor.toLowerCase();
  return preferred.some((token2) => lower.includes(token2.toLowerCase()));
}
function scoreMomentPerformance(moment, terms, ctx) {
  const weights = resolveWeights(ctx.persona);
  const profile = ctx.persona ? PERSONA_WEIGHTS[ctx.persona] : void 0;
  const reasons = [];
  let score = 0;
  if (terms.length === 0) {
    score += moment.words.length > 0 ? 3 : 1;
  } else {
    const text = moment.text.toLowerCase();
    const haystack = `${moment.assetName} ${moment.text} ${moment.words.map((w) => w.word).join(" ")}`.toLowerCase();
    let matched = 0;
    for (const term of terms) {
      if (!haystack.includes(term)) continue;
      matched += 1;
      score += text.includes(term) ? weights.termInText : weights.termElsewhere;
    }
    if (matched > 0) reasons.push(`matched ${terms.slice(0, 4).join(", ")}`);
  }
  if (moment.timelinePlacements.some((p) => p.timelineId === ctx.activeTimelineId) && ctx.activeTimelineId) {
    score += weights.activeTimeline;
    reasons.push("already on the active timeline");
  }
  if (moment.words.length > 0) {
    score += weights.wordTiming;
  }
  if (moment.emotion) {
    score += weights.hasEmotion;
  }
  if (moment.delivery) {
    score += weights.hasDelivery;
    reasons.push("has vocal delivery notes");
  }
  if (profile) {
    if (descriptorMatches(moment.energy, profile.preferredEnergy)) {
      score += weights.energyMatch;
      reasons.push(`${moment.energy} energy fits ${ctx.persona}`);
    }
    if (descriptorMatches(moment.pace, profile.preferredPace)) {
      score += weights.paceMatch;
      reasons.push(`${moment.pace} pace fits ${ctx.persona}`);
    }
    if (moment.emotion && profile.emotionBias.some((e) => moment.emotion.toLowerCase().includes(e))) {
      score += weights.emotionBias;
      reasons.push(`${moment.emotion} emotion favored by ${ctx.persona}`);
    }
  }
  if (moment.emotion && ctx.queryEmotions.some((q) => moment.emotion.toLowerCase().includes(q) || q.includes(moment.emotion.toLowerCase()))) {
    score += weights.emotionQueryMatch;
    reasons.push(`emotion (${moment.emotion}) matches the query`);
  }
  if (moment.notable && moment.notable.length > 0) {
    score += weights.notableSignal * moment.notable.length;
    reasons.push(`notable: ${moment.notable.slice(0, 2).join("; ")}`);
  }
  return { score, reasons };
}
function buildRerankPrompt(params) {
  const { query, brief, candidates } = params;
  const lines = candidates.map((c) => `- ${c.id}: ${c.text.replace(/\s+/g, " ").slice(0, 160)}`);
  return [
    `You are a ${brief.persona} selecting the strongest moments for a cut.`,
    `Story goal: ${brief.storyGoal}. Tone: ${brief.tone}. Pacing: ${brief.pacing}.`,
    `Viewer query: "${query}".`,
    "Re-order these candidate moments from most to least useful for this cut.",
    "Candidates (id: text):",
    ...lines,
    'Return compact JSON ONLY: {"order":["id1","id2",...]} listing the ids best-first.',
    "Include only ids from the list. No prose."
  ].join("\n");
}
function extractRerankJson(raw) {
  var _a;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const tryParse = (s) => {
    try {
      JSON.parse(s);
      return s;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  for (const m of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const inner = (_a = m[1]) == null ? void 0 : _a.trim();
    if (inner && tryParse(inner)) return inner;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    if (tryParse(slice)) return slice;
  }
  return null;
}
function applyRerankResult(heuristic, rerankJson) {
  const jsonText = extractRerankJson(rerankJson);
  if (!jsonText) return heuristic;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return heuristic;
  }
  const order = parsed.order;
  if (!Array.isArray(order) || order.length === 0) return heuristic;
  const byId = new Map(heuristic.map((m) => [m.id, m]));
  const seen = /* @__PURE__ */ new Set();
  const ranked = [];
  for (const id of order) {
    if (typeof id !== "string") continue;
    const moment = byId.get(id);
    if (moment && !seen.has(id)) {
      ranked.push(moment);
      seen.add(id);
    }
  }
  for (const moment of heuristic) {
    if (!seen.has(moment.id)) ranked.push(moment);
  }
  return ranked;
}
function extractQueryTerms(query) {
  return [...new Set(
    query.toLowerCase().split(/[^a-z0-9']+/).map((term) => term.trim()).filter((term) => term.length >= 3)
  )];
}
const QUERY_EMOTION_WORDS = [
  "emotional",
  "emotion",
  "sad",
  "happy",
  "angry",
  "excited",
  "reflective",
  "tense",
  "funny",
  "nervous",
  "calm",
  "proud",
  "hopeful",
  "vulnerable",
  "somber",
  "wistful"
];
function extractQueryEmotions(query) {
  const lower = query.toLowerCase();
  return QUERY_EMOTION_WORDS.filter((word) => lower.includes(word));
}
function retrieveRelevantMoments(index, query, optsOrLimit = 24) {
  const opts = typeof optsOrLimit === "number" ? { limit: optsOrLimit } : optsOrLimit;
  const limit = opts.limit ?? 24;
  const terms = extractQueryTerms(query);
  const ctx = {
    activeTimelineId: index.activeTimelineId,
    persona: opts.persona,
    queryEmotions: extractQueryEmotions(query)
  };
  return index.moments.map((moment) => ({ moment, ...scoreMomentPerformance(moment, terms, ctx) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.moment.sourceStart - b.moment.sourceStart).slice(0, limit).map(({ moment, score, reasons }) => ({
    id: moment.id,
    assetId: moment.assetId,
    assetName: moment.assetName,
    text: moment.text,
    sourceStart: moment.sourceStart,
    sourceEnd: moment.sourceEnd,
    words: moment.words.slice(0, 32),
    timelinePlacements: moment.timelinePlacements,
    score,
    reason: reasons.length > 0 ? `${reasons.slice(0, 3).join("; ")}.` : `${moment.words.length > 0 ? "Word-level" : "Segment-level"} transcript candidate.`
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
function extractJsonText$2(raw) {
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
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".m4v":
      return "video/x-m4v";
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
async function uploadVideoPath(apiKey, rawPath) {
  return uploadImagePath(apiKey, rawPath);
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
  const jsonText = extractJsonText$2(text);
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
  const jsonText = extractJsonText$2(output);
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
async function analyzeVideoWithPrompt(params) {
  if (!params.apiKey) throw new Error("No fal.ai API key provided.");
  const uploaded = await uploadVideoPath(params.apiKey, params.videoPath).catch(() => null);
  if (!uploaded) {
    throw new Error("Could not upload the video file for analysis.");
  }
  srcExports.fal.config({ credentials: params.apiKey });
  const result = await srcExports.fal.subscribe("fal-ai/video-understanding", {
    input: {
      video_url: uploaded,
      prompt: params.prompt.trim() || "Describe this video in detail.",
      detailed_analysis: params.detailedAnalysis ?? true
    },
    logs: true
  });
  const data = result.data;
  const analysis = extractTextFromUnknown(data.output) || extractTextFromUnknown(data.text) || extractTextFromUnknown(data.description) || extractTextFromUnknown(data);
  if (!analysis.trim()) {
    throw new Error("Video analysis returned an empty response.");
  }
  return analysis.trim();
}
async function analyzeImageWithPrompt(params) {
  var _a;
  if (!params.apiKey) throw new Error("No fal.ai API key provided.");
  const uploaded = await uploadImagePath(params.apiKey, params.imagePath).catch(() => null);
  if (!uploaded) {
    throw new Error("Could not upload the image file for analysis.");
  }
  srcExports.fal.config({ credentials: params.apiKey });
  const result = await srcExports.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((_a = params.model) == null ? void 0 : _a.trim()) || DEFAULT_VISION_MODEL,
      prompt: params.prompt.trim() || "Describe this image in detail.",
      image_urls: [uploaded],
      max_tokens: 900
    },
    logs: true
  });
  const data = result.data;
  const analysis = extractTextFromUnknown(data.output) || extractTextFromUnknown(data.text) || extractTextFromUnknown(data);
  if (!analysis.trim()) {
    throw new Error("Image analysis returned an empty response.");
  }
  return analysis.trim();
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
function buildConversationPrompt$2(messages) {
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
function extractJsonText$1(raw) {
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
  const num2 = Number(value);
  if (!Number.isFinite(num2)) return null;
  return Math.max(0, num2);
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
  const jsonText = extractJsonText$1(response2.message);
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
async function buildRetrievalSummary(index, request2, brief, visualFindings, opts = {}) {
  const retrievalQuery = [request2, brief.storyGoal, brief.hook, brief.tone, brief.audience].join(" ");
  let topMoments = retrieveRelevantMoments(index, retrievalQuery, { limit: 20, persona: brief.persona });
  if (opts.rerank && opts.apiKey && topMoments.length > 1) {
    try {
      const rerankPrompt = buildRerankPrompt({ query: retrievalQuery, brief, candidates: topMoments });
      const rerankResponse = await callTextLLM({
        apiKey: opts.apiKey,
        model: opts.model,
        systemPrompt: "You re-rank candidate video moments for an editor. Return JSON only.",
        prompt: rerankPrompt,
        maxTokens: 500,
        temperature: 0.2
      });
      topMoments = applyRerankResult(topMoments, rerankResponse.message);
    } catch {
    }
  }
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
    const jsonText = extractJsonText$1(rawMessage);
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
  const jsonText = extractJsonText$1(response2.message);
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
  const retrievalSummary = await buildRetrievalSummary(index, request2, mergedBrief, []);
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
  const refreshedRetrievalSummary = await buildRetrievalSummary(index, request2, mergedBrief, visualFindings, {
    apiKey: params.apiKey,
    model: params.model,
    rerank: mergedBrief.qualityGoal !== "auto"
  });
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
function getMainWindow$4() {
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
  const win = getMainWindow$4();
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
        const token2 = typeof (msgObj == null ? void 0 : msgObj.content) === "string" ? msgObj.content : "";
        if (token2) {
          for (const char of token2) {
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
    const prompt = buildConversationPrompt$2(messages);
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
const execFileAsync$2 = promisify(execFile);
const CLAUDE_CANDIDATES = [
  path.join(os.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
];
const CHAT_ONLY_SUFFIX$1 = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "When an ACTIVE SKILL section is present, follow it directly in chat — never invoke Skill tool or slash commands.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" ");
const COPILOT_RESUME_REMINDER$1 = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "CineGen SKILLS are in the system prompt — list them directly; never use Skill tool or say you will check.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" ");
const ENHANCE_PROMPT_SUFFIX$1 = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" ");
const COPILOT_CHAT_TOOLS = "";
const COPILOT_MAX_TURNS = "2";
let cachedBinary;
let activeRequest$2 = null;
function buildPathEnv() {
  const home = os.homedir();
  const extraPaths = [
    path.join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ];
  const currentPath = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...extraPaths, currentPath].filter(Boolean).join(path.delimiter)
  };
}
async function resolveClaudeBinary() {
  if (cachedBinary !== void 0) return cachedBinary;
  for (const candidate of CLAUDE_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync$2(candidate, ["--version"], {
        env: buildPathEnv(),
        timeout: 8e3
      });
      if (stdout.toLowerCase().includes("claude")) {
        cachedBinary = candidate;
        return candidate;
      }
    } catch {
    }
  }
  cachedBinary = null;
  return null;
}
function getMainWindow$3() {
  return BrowserWindow.getAllWindows().find((window2) => !window2.isDestroyed());
}
function buildConversationPrompt$1(messages) {
  return messages.filter((message) => message.role !== "system" && message.content.trim()).map((message) => `${message.role === "assistant" ? "Assistant" : "User"}:
${message.content.trim()}`).join("\n\n").concat("\n\nAssistant:\n");
}
function parseClaudeCodeUsage(obj) {
  const usageRaw = obj.usage;
  if (!usageRaw || typeof usageRaw !== "object") return void 0;
  const inputTokens = Number(usageRaw.input_tokens) || 0;
  const cacheCreation = Number(usageRaw.cache_creation_input_tokens) || 0;
  const cacheRead = Number(usageRaw.cache_read_input_tokens) || 0;
  const promptTokens = inputTokens + cacheCreation + cacheRead;
  const completionTokens = Number(usageRaw.output_tokens) || 0;
  const totalTokens = promptTokens + completionTokens;
  const cost = Number(obj.total_cost_usd) || 0;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0 && cost <= 0) {
    return void 0;
  }
  return { promptTokens, completionTokens, totalTokens, cost };
}
function formatClaudeCodeFailure(code, stderrBuffer, lastResultPayload) {
  const resultErrors = Array.isArray(lastResultPayload == null ? void 0 : lastResultPayload.errors) ? lastResultPayload.errors.filter((entry) => typeof entry === "string") : [];
  if (resultErrors.length > 0) {
    return resultErrors.join(" ");
  }
  if (typeof (lastResultPayload == null ? void 0 : lastResultPayload.result) === "string" && lastResultPayload.result.trim()) {
    return lastResultPayload.result.trim();
  }
  if ((lastResultPayload == null ? void 0 : lastResultPayload.subtype) === "error_max_turns") {
    return "Claude Code hit its turn limit before finishing a reply. Retry your message — Copilot answers in chat only, without tools.";
  }
  const stderr = stderrBuffer.trim();
  if (stderr) return stderr;
  return `Claude Code exited with code ${code ?? "unknown"}`;
}
function extractStreamToken(obj) {
  if (obj.type === "stream_event") {
    const event = obj.event;
    const delta = event == null ? void 0 : event.delta;
    if ((delta == null ? void 0 : delta.type) === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }
  if (obj.type === "assistant") {
    const message = obj.message;
    return ((message == null ? void 0 : message.content) ?? []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  }
  if (obj.type === "result" && typeof obj.result === "string") {
    return obj.result;
  }
  return "";
}
function getClaudeWorkspaceDir() {
  return path.join(app.getPath("userData"), "claude-code-workspace");
}
function isHeadlessJsonJob$1(params) {
  if (params.purpose === "json-job") return true;
  if (params.purpose === "copilot" || params.purpose === "enhance-prompt") return false;
  return !params.injectProjectContext && !params.resumeSessionId && !(params.messages && params.messages.length > 0);
}
function buildPrompt(params, jsonJob) {
  if (params.injectProjectContext) {
    const history = (params.messages ?? []).filter((message) => message.content.trim());
    if (history.length > 0) {
      return buildConversationPrompt$1(history);
    }
  }
  if (jsonJob) return params.userMessage.trim();
  return `${params.userMessage.trim()}

Assistant:
`;
}
async function streamClaudeCodeChat(requestId, params) {
  var _a, _b, _c, _d;
  const binary = await resolveClaudeBinary();
  if (!binary) {
    throw new Error("Claude Code is not installed. Install it from https://code.claude.com");
  }
  if (!params.userMessage.trim()) {
    throw new Error("No chat message provided.");
  }
  const model = ((_a = params.model) == null ? void 0 : _a.trim()) || "sonnet";
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;
  const jsonJob = isHeadlessJsonJob$1(params);
  const args = [
    "-p",
    canResume ? params.userMessage.trim() : buildPrompt(params, jsonJob),
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    COPILOT_MAX_TURNS,
    "--model",
    model,
    "--tools",
    COPILOT_CHAT_TOOLS,
    "--disable-slash-commands",
    // No --mcp-config is passed, so this loads ZERO MCP servers. These jobs never use
    // them, and booting/tearing down the user's fleet dominated the call's wall clock.
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk"
  ];
  if (jsonJob) {
    args.push("--safe-mode", "--effort", "low", "--include-partial-messages");
    if (!canResume && ((_b = params.systemPrompt) == null ? void 0 : _b.trim())) {
      args.push("--system-prompt", params.systemPrompt.trim());
    }
  } else {
    args.push("--include-partial-messages");
  }
  if (canResume && params.resumeSessionId) {
    args.push("--resume", params.resumeSessionId);
    if (!jsonJob) {
      const resumeAppend = [(_c = params.systemPrompt) == null ? void 0 : _c.trim(), COPILOT_RESUME_REMINDER$1].filter(Boolean).join("\n\n");
      args.push("--append-system-prompt", resumeAppend);
    }
  } else if (!jsonJob && params.injectProjectContext && ((_d = params.systemPrompt) == null ? void 0 : _d.trim())) {
    const refreshPrefix = params.contextRefresh ? "The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n" : "";
    const suffix = params.purpose === "enhance-prompt" ? ENHANCE_PROMPT_SUFFIX$1 : CHAT_ONLY_SUFFIX$1;
    args.push("--append-system-prompt", `${refreshPrefix}${params.systemPrompt.trim()}

${suffix}`);
  }
  const win = getMainWindow$3();
  const workDir = jsonJob ? getClaudeWorkspaceDir() : void 0;
  if (workDir) await mkdir(workDir, { recursive: true });
  let fullContent = "";
  let stderrBuffer = "";
  let sessionId;
  let authFailed = false;
  let sawStreamDelta = false;
  let usage;
  let lastResultPayload;
  return new Promise((resolve, reject) => {
    var _a2, _b2;
    const child = spawn(binary, args, {
      env: buildPathEnv(),
      ...workDir ? { cwd: workDir } : {},
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeRequest$2 = { child, requestId };
    let lineBuffer = "";
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      activeRequest$2 = null;
      win == null ? void 0 : win.webContents.send("llm:claude-code-stream", { requestId, done: true });
      fn();
      if (!child.killed) child.kill();
    };
    (_a2 = child.stdout) == null ? void 0 : _a2.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      let newlineIdx;
      while ((newlineIdx = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "system" && obj.subtype === "init" && typeof obj.session_id === "string") {
            sessionId = obj.session_id;
          }
          if (obj.type === "assistant" && obj.error === "authentication_failed") {
            authFailed = true;
          }
          if (obj.type === "result") {
            lastResultPayload = obj;
            const resultToken = extractStreamToken(obj);
            if (resultToken && !fullContent.trim()) {
              fullContent = resultToken;
              win == null ? void 0 : win.webContents.send("llm:claude-code-stream", { requestId, token: resultToken });
            }
            const done = fullContent.trim();
            if (done && !authFailed && !done.includes("Not logged in")) {
              finish(() => resolve({ message: done, sessionId, usage, resumed: canResume }));
              return;
            }
          }
          const parsedUsage = parseClaudeCodeUsage(obj);
          if (parsedUsage) {
            usage = parsedUsage;
          } else if (obj.type === "assistant") {
            const message = obj.message;
            if (message == null ? void 0 : message.usage) {
              const assistantUsage = parseClaudeCodeUsage({ usage: message.usage });
              if (assistantUsage) usage = assistantUsage;
            }
          }
          const token2 = extractStreamToken(obj);
          if (!token2) continue;
          if (obj.type === "stream_event") {
            sawStreamDelta = true;
            fullContent += token2;
            win == null ? void 0 : win.webContents.send("llm:claude-code-stream", { requestId, token: token2 });
            continue;
          }
          if (obj.type === "assistant" && !sawStreamDelta) {
            fullContent = token2;
            win == null ? void 0 : win.webContents.send("llm:claude-code-stream", { requestId, token: token2 });
          } else if (obj.type === "result" && !fullContent.trim()) {
            fullContent = token2;
            win == null ? void 0 : win.webContents.send("llm:claude-code-stream", { requestId, token: token2 });
          }
        } catch {
        }
      }
    });
    (_b2 = child.stderr) == null ? void 0 : _b2.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      finish(() => {
        const trimmed = fullContent.trim();
        if (authFailed || trimmed.includes("Not logged in")) {
          reject(new Error("Claude Code is not logged in. Open Terminal, run `claude`, and sign in with your subscription."));
          return;
        }
        if (trimmed) {
          resolve({ message: trimmed, sessionId, usage, resumed: canResume });
          return;
        }
        reject(new Error(formatClaudeCodeFailure(code, stderrBuffer, lastResultPayload)));
      });
    });
  });
}
function registerClaudeCodeHandlers() {
  ipcMain.handle("llm:claude-code-detect", async () => {
    const binary = await resolveClaudeBinary();
    if (!binary) {
      return { installed: false };
    }
    try {
      const { stdout } = await execFileAsync$2(binary, ["--version"], {
        env: buildPathEnv(),
        timeout: 8e3
      });
      return {
        installed: true,
        path: binary,
        version: stdout.trim()
      };
    } catch {
      return { installed: false };
    }
  });
  ipcMain.handle("llm:claude-code-chat", async (_event, params) => {
    const requestId = params.requestId || crypto$1.randomUUID();
    const result = await streamClaudeCodeChat(requestId, params);
    return {
      message: result.message,
      sessionId: result.sessionId,
      resumed: result.resumed,
      ...result.usage ? { usage: result.usage } : {}
    };
  });
  ipcMain.handle("llm:claude-code-cancel", async (_event, requestId) => {
    if ((activeRequest$2 == null ? void 0 : activeRequest$2.requestId) !== requestId) return;
    activeRequest$2.child.kill("SIGTERM");
    activeRequest$2 = null;
  });
}
const execFileAsync$1 = promisify(execFile);
const PROVIDER_BINARIES = {
  "claude-code": [
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "claude"
  ],
  codex: [
    path.join(os.homedir(), ".npm-global/bin/codex"),
    path.join(os.homedir(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "codex"
  ],
  gemini: [
    path.join(os.homedir(), ".npm-global/bin/gemini"),
    path.join(os.homedir(), ".local/bin/gemini"),
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
    "gemini"
  ]
};
const binaryCache = /* @__PURE__ */ new Map();
function buildCliPathEnv() {
  const home = os.homedir();
  const extraPaths = [
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ];
  const currentPath = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...extraPaths, currentPath].filter(Boolean).join(path.delimiter)
  };
}
function buildGeminiCliEnv() {
  return {
    ...buildCliPathEnv(),
    GEMINI_CLI_TRUST_WORKSPACE: "true",
    TERM: "dumb",
    NO_COLOR: "1"
  };
}
function stripAnsiCodes(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
async function resolveCliBinary(provider) {
  if (binaryCache.has(provider)) {
    return binaryCache.get(provider) ?? null;
  }
  for (const candidate of PROVIDER_BINARIES[provider]) {
    try {
      const { stdout } = await execFileAsync$1(candidate, ["--version"], {
        env: buildCliPathEnv(),
        timeout: 8e3
      });
      if (stdout.trim()) {
        binaryCache.set(provider, candidate);
        return candidate;
      }
    } catch {
    }
  }
  binaryCache.set(provider, null);
  return null;
}
async function detectCliProvider(provider) {
  const binary = await resolveCliBinary(provider);
  if (!binary) {
    return { id: provider, installed: false };
  }
  try {
    const { stdout } = await execFileAsync$1(binary, ["--version"], {
      env: buildCliPathEnv(),
      timeout: 8e3
    });
    return {
      id: provider,
      installed: true,
      path: binary,
      version: stdout.trim()
    };
  } catch {
    return { id: provider, installed: false };
  }
}
async function detectAllCliProviders() {
  return Promise.all([
    detectCliProvider("claude-code"),
    detectCliProvider("codex"),
    detectCliProvider("gemini")
  ]);
}
function getMainWindow$2() {
  return BrowserWindow.getAllWindows().find((window2) => !window2.isDestroyed());
}
function buildConversationPrompt(messages) {
  return messages.filter((message) => message.role !== "system" && message.content.trim()).map((message) => `${message.role === "assistant" ? "Assistant" : "User"}:
${message.content.trim()}`).join("\n\n").concat("\n\nAssistant:\n");
}
const CHAT_ONLY_SUFFIX = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" ");
const COPILOT_RESUME_REMINDER = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" ");
const ENHANCE_PROMPT_SUFFIX = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" ");
function registerCliLlmDetectHandlers() {
  ipcMain.handle("llm:cli-detect", async () => {
    const providers = await detectAllCliProviders();
    return { providers };
  });
}
function compactCodexCliError(stderr, exitCode) {
  const text = stderr.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "").trim();
  const usage = text.match(/You've hit your usage limit\.[^\n]*/i);
  if (usage) {
    return `${usage[0].trim()} Luna and Codex share your ChatGPT Codex quota — pick fal.ai in the LLM picker, or wait for the reset.`;
  }
  const cleaned = text.split("\n").filter((line) => {
    const row = line.trim();
    if (!row) return false;
    if (/^Reading additional input from stdin/i.test(row)) return false;
    if (/codex_models_manager::cache/i.test(row)) return false;
    if (/rmcp::transport/i.test(row)) return false;
    if (/AuthRequiredError|AuthRequired\(/i.test(row)) return false;
    return true;
  }).join("\n").trim();
  return cleaned || `Codex exited with code ${exitCode ?? "unknown"}`;
}
let activeRequest$1 = null;
function getCodexWorkspaceDir() {
  return path.join(app.getPath("userData"), "codex-workspace");
}
function isHeadlessJsonJob(params) {
  if (params.purpose === "json-job") return true;
  if (params.purpose === "copilot" || params.purpose === "enhance-prompt") return false;
  return !params.injectProjectContext && !params.resumeSessionId && !(params.messages && params.messages.length > 0);
}
function buildCodexPrompt(params, jsonJob) {
  var _a, _b;
  if (jsonJob) {
    const system = ((_a = params.systemPrompt) == null ? void 0 : _a.trim()) ?? "";
    const user = params.userMessage.trim();
    return system ? `${system}

${user}` : user;
  }
  const systemParts = [];
  if ((_b = params.systemPrompt) == null ? void 0 : _b.trim()) {
    if (params.injectProjectContext) {
      const refreshPrefix = params.contextRefresh ? "The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n" : "";
      const suffix = params.purpose === "enhance-prompt" ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX;
      systemParts.push(`${refreshPrefix}${params.systemPrompt.trim()}

${suffix}`);
    } else {
      systemParts.push(params.systemPrompt.trim());
    }
  }
  const history = (params.messages ?? []).filter((message) => message.content.trim());
  const conversation = history.length > 0 ? buildConversationPrompt(history) : `${params.userMessage.trim()}

Assistant:
`;
  return systemParts.length > 0 ? `${systemParts.join("\n\n")}

${conversation}` : params.userMessage.trim();
}
function parseCodexUsage(obj) {
  const usageRaw = obj.usage;
  if (!usageRaw) return void 0;
  const inputTokens = Number(usageRaw.input_tokens) || 0;
  const cachedInput = Number(usageRaw.cached_input_tokens) || 0;
  const promptTokens = inputTokens + cachedInput;
  const completionTokens = Number(usageRaw.output_tokens) || 0;
  const totalTokens = promptTokens + completionTokens;
  if (totalTokens <= 0) return void 0;
  return { promptTokens, completionTokens, totalTokens, cost: 0 };
}
function extractCodexAgentText(obj) {
  if (obj.type !== "item.completed" && obj.type !== "item.updated") return "";
  const item = obj.item;
  if ((item == null ? void 0 : item.type) === "agent_message" && typeof item.text === "string") {
    return item.text;
  }
  return "";
}
async function streamCodexChat(requestId, params) {
  var _a;
  const binary = await resolveCliBinary("codex");
  if (!binary) {
    throw new Error("Codex CLI is not installed. Install it from https://developers.openai.com/codex");
  }
  if (!params.userMessage.trim()) {
    throw new Error("No chat message provided.");
  }
  const model = ((_a = params.model) == null ? void 0 : _a.trim()) || "gpt-5.3-codex";
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;
  const jsonJob = isHeadlessJsonJob(params);
  const prompt = canResume ? params.userMessage.trim() : buildCodexPrompt(params, jsonJob);
  const workDir = jsonJob ? getCodexWorkspaceDir() : void 0;
  if (workDir) await mkdir(workDir, { recursive: true });
  const args = ["exec", "--json", "-s", "read-only", "-m", model, "--skip-git-repo-check"];
  if (jsonJob) {
    args.push("--ignore-user-config", "--ignore-rules");
    if (workDir) args.push("-C", workDir);
  }
  if (canResume && params.resumeSessionId) {
    args.push("resume", params.resumeSessionId);
    if (!jsonJob) args.push(prompt);
  } else if (!jsonJob) {
    args.push(prompt);
  }
  const win = getMainWindow$2();
  let fullContent = "";
  let stderrBuffer = "";
  let sessionId;
  let usage;
  let lastAgentText = "";
  return new Promise((resolve, reject) => {
    var _a2, _b, _c, _d;
    const child = spawn(binary, args, {
      env: buildCliPathEnv(),
      cwd: workDir,
      stdio: jsonJob ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    if (jsonJob) {
      (_a2 = child.stdin) == null ? void 0 : _a2.write(prompt);
      (_b = child.stdin) == null ? void 0 : _b.end();
    }
    activeRequest$1 = { child, requestId, provider: "codex" };
    let lineBuffer = "";
    (_c = child.stdout) == null ? void 0 : _c.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      let newlineIdx;
      while ((newlineIdx = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "thread.started" && typeof obj.thread_id === "string") {
            sessionId = obj.thread_id;
          }
          const parsedUsage = parseCodexUsage(obj);
          if (parsedUsage) usage = parsedUsage;
          if (obj.type === "turn.failed") {
            const error = obj.error;
            stderrBuffer += (error == null ? void 0 : error.message) ?? "Codex turn failed.";
          }
          const agentText = extractCodexAgentText(obj);
          if (agentText) {
            const delta = agentText.startsWith(lastAgentText) ? agentText.slice(lastAgentText.length) : agentText;
            lastAgentText = agentText;
            fullContent = agentText;
            if (delta) {
              win == null ? void 0 : win.webContents.send("llm:codex-stream", { requestId, token: delta });
            }
          }
        } catch {
        }
      }
    });
    (_d = child.stderr) == null ? void 0 : _d.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
    child.on("error", (error) => {
      activeRequest$1 = null;
      reject(error);
    });
    child.on("close", (code) => {
      activeRequest$1 = null;
      win == null ? void 0 : win.webContents.send("llm:codex-stream", { requestId, done: true });
      const trimmed = fullContent.trim();
      if (!trimmed) {
        reject(new Error(compactCodexCliError(stderrBuffer, code)));
        return;
      }
      resolve({ message: trimmed, sessionId, usage, resumed: canResume });
    });
  });
}
function registerCodexCliHandlers() {
  ipcMain.handle("llm:codex-chat", async (_event, params) => {
    const requestId = params.requestId || crypto$1.randomUUID();
    const result = await streamCodexChat(requestId, params);
    return {
      message: result.message,
      sessionId: result.sessionId,
      resumed: result.resumed,
      ...result.usage ? { usage: result.usage } : {}
    };
  });
  ipcMain.handle("llm:codex-cancel", async (_event, requestId) => {
    if ((activeRequest$1 == null ? void 0 : activeRequest$1.requestId) !== requestId || activeRequest$1.provider !== "codex") return;
    activeRequest$1.child.kill("SIGTERM");
    activeRequest$1 = null;
  });
}
const LUNA_LONG_CONTEXT_INPUT_TOKENS = 272e3;
const LUNA_RATES_PER_MILLION = {
  short: { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
  long: { input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 }
};
function finiteCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
function parseOpenAiUsage(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return void 0;
  const usage = payload.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return void 0;
  const record = usage;
  const details = record.prompt_tokens_details && typeof record.prompt_tokens_details === "object" && !Array.isArray(record.prompt_tokens_details) ? record.prompt_tokens_details : {};
  const promptTokens = finiteCount(record.prompt_tokens ?? record.input_tokens);
  const completionTokens = finiteCount(record.completion_tokens ?? record.output_tokens);
  const cachedTokens = finiteCount(details.cached_tokens);
  const cacheWriteTokens = finiteCount(details.cache_write_tokens);
  const totalTokens = finiteCount(record.total_tokens) || promptTokens + completionTokens;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) return void 0;
  return { promptTokens, completionTokens, totalTokens, cachedTokens, cacheWriteTokens };
}
function priceOpenAiUsage(usage) {
  const rates = usage.promptTokens > LUNA_LONG_CONTEXT_INPUT_TOKENS ? LUNA_RATES_PER_MILLION.long : LUNA_RATES_PER_MILLION.short;
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const writes = Math.min(usage.cacheWriteTokens, Math.max(0, usage.promptTokens - cached));
  const uncached = Math.max(0, usage.promptTokens - cached - writes);
  const cost = (uncached * rates.input + cached * rates.cached + writes * rates.cacheWrite + usage.completionTokens * rates.output) / 1e6;
  return { ...usage, cost: Math.round(cost * 1e8) / 1e8 };
}
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_DIRECTOR_MODEL = "gpt-5.6-luna";
const DEFAULT_OPENAI_MAX_COMPLETION_TOKENS = 6e4;
function buildOpenAiUserContent(userMessage, imageUrls = []) {
  const text = userMessage.trim();
  const images = imageUrls.map((url) => url.trim()).filter(Boolean);
  if (images.length === 0) return text;
  return [
    { type: "text", text },
    ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } }))
  ];
}
function buildOpenAiChatBody(params) {
  var _a, _b;
  const messages = [];
  const system = ((_a = params.systemPrompt) == null ? void 0 : _a.trim()) ?? "";
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: buildOpenAiUserContent(params.userMessage, params.imageUrls) });
  const body = {
    model: ((_b = params.model) == null ? void 0 : _b.trim()) || DEFAULT_OPENAI_DIRECTOR_MODEL,
    messages,
    reasoning_effort: params.reasoningEffort ?? "low",
    max_completion_tokens: Number.isFinite(params.maxCompletionTokens) ? Math.max(1, Math.floor(params.maxCompletionTokens)) : DEFAULT_OPENAI_MAX_COMPLETION_TOKENS
  };
  if (params.jsonObject !== false) body.response_format = { type: "json_object" };
  return body;
}
function openaiErrorMessage(payload, fallback) {
  if (typeof payload === "string" && payload.trim()) return payload.trim().slice(0, 2e3);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 2e3);
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 2e3);
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim().slice(0, 2e3);
  }
  return fallback;
}
function parseOpenAiChatPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OpenAI returned an invalid response.");
  }
  const record = payload;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0]) ? choices[0] : null;
  const message = (choice == null ? void 0 : choice.message) && typeof choice.message === "object" && !Array.isArray(choice.message) ? choice.message : null;
  const refusal = typeof (message == null ? void 0 : message.refusal) === "string" ? message.refusal.trim() : "";
  if (refusal) throw new Error(refusal);
  const content = typeof (message == null ? void 0 : message.content) === "string" ? message.content.trim() : "";
  if (!content) throw new Error("OpenAI returned no text output.");
  if ((choice == null ? void 0 : choice.finish_reason) === "length") {
    throw new Error("The model hit its output limit mid-answer. Try shotlisting one scene at a time.");
  }
  return content;
}
async function completeOpenAiChat(params) {
  const apiKey = params.apiKey.trim();
  if (!apiKey) throw new Error("No OpenAI API key provided.");
  const userMessage = params.userMessage.trim();
  if (!userMessage) throw new Error("No OpenAI prompt provided.");
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This runtime does not provide fetch.");
  const response2 = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildOpenAiChatBody({
      model: params.model,
      systemPrompt: params.systemPrompt,
      userMessage,
      imageUrls: params.imageUrls,
      maxCompletionTokens: params.maxCompletionTokens,
      reasoningEffort: params.reasoningEffort,
      jsonObject: params.jsonObject
    }))
  });
  const text = await response2.text();
  let payload = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
    }
  }
  if (!response2.ok) {
    throw new Error(openaiErrorMessage(payload, `OpenAI request failed (${response2.status}).`));
  }
  const tokens = parseOpenAiUsage(payload);
  return {
    message: parseOpenAiChatPayload(payload),
    ...tokens ? { usage: priceOpenAiUsage(tokens) } : {}
  };
}
function decodeLocalMediaUrl$1(url) {
  if (!url.startsWith("local-media://file")) return null;
  return decodeURIComponent(url.replace(/^local-media:\/\/file/, ""));
}
const LOCAL_WORKSPACE_ORIGIN = "http://localhost:3000";
const HOSTED_WORKSPACE_ORIGIN = "https://cinegen-cloud-studio.cogden.chatgpt.site";
const TEAM_SESSION_PARTITION = "persist:cinegen-team-workspace";
const REQUEST_TIMEOUT_MS = 8e3;
const TEAM_PROVIDER_SENTINEL = "__CINEGEN_TEAM_PROVIDER__";
const HOSTED_RPC_TARGET = { origin: HOSTED_WORKSPACE_ORIGIN, source: "hosted" };
const LOCAL_RPC_TARGET = { origin: LOCAL_WORKSPACE_ORIGIN, source: "local-web" };
let activeTarget = null;
let authWindow = null;
let authConnectionPromise = null;
function emptyStatus() {
  return {
    supported: true,
    scope: "workspace",
    providers: ["fal", "openai", "kie", "runpod", "huggingface"].map((id) => ({
      id,
      connected: false
    })),
    desktop: {
      connected: false,
      requiresLogin: true,
      source: "none",
      label: "Connect the hosted team workspace"
    }
  };
}
async function responsePayload(response2) {
  const contentType = response2.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return await response2.json();
  } catch {
    return null;
  }
}
async function rpcFetch(target, namespace, method, args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${target.origin}/api/rpc/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`;
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
      credentials: "include",
      // RPC payloads can contain provider credentials. Never forward their
      // request bodies through an unexpected redirect.
      redirect: "error",
      signal: controller.signal
    };
    const response2 = target.source === "hosted" ? await session.fromPartition(TEAM_SESSION_PARTITION).fetch(url, init) : await fetch(url, init);
    return { response: response2, payload: await responsePayload(response2) };
  } finally {
    clearTimeout(timeout);
  }
}
function decorateStatus(status, target) {
  return {
    ...status,
    desktop: {
      connected: true,
      requiresLogin: false,
      source: target.source,
      label: target.source === "hosted" ? "Hosted team workspace" : "Local browser workspace"
    }
  };
}
async function statusFor(target) {
  try {
    const { response: response2, payload } = await rpcFetch(target, "providers", "status", []);
    if (!response2.ok || !(payload == null ? void 0 : payload.ok) || !payload.result) return null;
    return decorateStatus(payload.result, target);
  } catch {
    return null;
  }
}
async function resolveTarget() {
  if (activeTarget) {
    const status = await statusFor(activeTarget);
    if (status) return { target: activeTarget, status };
    activeTarget = null;
  }
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
async function invokeTeamRpc(namespace, method, args) {
  var _a;
  const resolved = await resolveTarget();
  if (!resolved) {
    throw new Error("Connect CineGen Desktop to the hosted team workspace in Settings first.");
  }
  const { response: response2, payload } = await rpcFetch(resolved.target, namespace, method, args);
  if (!response2.ok || !(payload == null ? void 0 : payload.ok)) {
    throw new Error(((_a = payload == null ? void 0 : payload.error) == null ? void 0 : _a.message) || `The team workspace request failed (${response2.status}).`);
  }
  return payload.result;
}
async function mutateTeamProvider(method, value) {
  var _a;
  const resolved = await resolveTarget();
  if (!resolved) {
    throw new Error("Connect CineGen Desktop to the hosted team workspace in Settings first.");
  }
  const { response: response2, payload } = await rpcFetch(resolved.target, "providers", method, [value]);
  if (!response2.ok || !(payload == null ? void 0 : payload.ok) || !payload.result) {
    throw new Error(((_a = payload == null ? void 0 : payload.error) == null ? void 0 : _a.message) || `The team workspace request failed (${response2.status}).`);
  }
  return decorateStatus(payload.result, resolved.target);
}
async function shareDesktopTopviewConnection() {
  var _a, _b;
  const connection = await exportTopviewTeamConnection();
  if (!connection || !("client" in connection)) {
    throw new Error("Connect Topview MCP in CineGen Desktop before sharing it with the team.");
  }
  let resolved = await resolveTarget();
  if (!resolved || resolved.target.source !== "hosted") {
    const hostedStatus = await connectHostedWorkspace();
    if (((_a = hostedStatus.desktop) == null ? void 0 : _a.connected) && hostedStatus.desktop.source === "hosted") {
      resolved = { target: HOSTED_RPC_TARGET, status: hostedStatus };
    }
  }
  if (!resolved || resolved.target.source !== "hosted") {
    throw new Error("CineGen team sign-in was not completed. Sign in in the window that opened, then choose Share MCP with team again.");
  }
  const { response: response2, payload } = await rpcFetch(resolved.target, "topview", "importTeamConnection", [connection]);
  if (!response2.ok || !(payload == null ? void 0 : payload.ok) || !payload.result) {
    throw new Error(((_b = payload == null ? void 0 : payload.error) == null ? void 0 : _b.message) || `Topview MCP could not be shared (${response2.status}).`);
  }
  return payload.result;
}
async function invokeSharedOpenAi(params) {
  return invokeTeamRpc("llm", "openaiChat", [{ ...params, apiKey: TEAM_PROVIDER_SENTINEL }]);
}
async function connectHostedWorkspace() {
  const existing = await statusFor(HOSTED_RPC_TARGET);
  if (existing) {
    activeTarget = HOSTED_RPC_TARGET;
    return existing;
  }
  if (authConnectionPromise) {
    if (authWindow && !authWindow.isDestroyed()) authWindow.focus();
    return authConnectionPromise;
  }
  const window2 = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 520,
    minHeight: 640,
    title: "Connect CineGen Team Workspace",
    autoHideMenuBar: true,
    webPreferences: {
      partition: TEAM_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  authWindow = window2;
  const signInUrl = `${HOSTED_WORKSPACE_ORIGIN}/signin-with-chatgpt?return_to=${encodeURIComponent("/")}`;
  const connectionPromise = new Promise((resolve, reject) => {
    let settled = false;
    let checking = false;
    let pollTimer = null;
    let timeoutTimer = null;
    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      pollTimer = null;
      timeoutTimer = null;
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (cause) => {
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
        if (!window2.isDestroyed()) window2.close();
      } finally {
        checking = false;
      }
    };
    window2.webContents.on("did-finish-load", () => void check());
    window2.on("closed", () => {
      if (authWindow === window2) authWindow = null;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (settled) return;
      void (async () => {
        while (checking && !settled) {
          await new Promise((resolve2) => setTimeout(resolve2, 50));
        }
        if (settled) return;
        await check();
        if (!settled) finish(emptyStatus());
      })();
    });
    pollTimer = setInterval(() => void check(), 1e3);
    timeoutTimer = setTimeout(() => {
      finish(emptyStatus());
      if (!window2.isDestroyed()) window2.close();
    }, 10 * 60 * 1e3);
    window2.loadURL(signInUrl).catch((cause) => {
      fail(cause);
      if (!window2.isDestroyed()) window2.close();
    });
  });
  authConnectionPromise = connectionPromise;
  try {
    return await connectionPromise;
  } finally {
    if (authConnectionPromise === connectionPromise) authConnectionPromise = null;
  }
}
function registerTeamProviderHandlers() {
  ipcMain.handle("team-providers:status", async () => {
    const resolved = await resolveTarget();
    return (resolved == null ? void 0 : resolved.status) ?? emptyStatus();
  });
  ipcMain.handle("team-providers:connect", () => connectHostedWorkspace());
  ipcMain.handle("team-providers:disconnect", async () => {
    await session.fromPartition(TEAM_SESSION_PARTITION).clearStorageData({ storages: ["cookies"] });
    activeTarget = null;
    return emptyStatus();
  });
  ipcMain.handle("team-providers:save", async (_event, value) => {
    return mutateTeamProvider("save", value);
  });
  ipcMain.handle("team-providers:remove", async (_event, value) => {
    return mutateTeamProvider("remove", value);
  });
  ipcMain.handle("team-providers:share-topview", () => shareDesktopTopviewConnection());
}
function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}
function resolveOpenAiImageUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const local = decodeLocalMediaUrl$1(trimmed) ?? (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed) ? trimmed : null);
  if (!local || !fs.existsSync(local)) return null;
  const buf = fs.readFileSync(local);
  return `data:${mimeFromPath(local)};base64,${buf.toString("base64")}`;
}
function imageUrlsFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const resolved = resolveOpenAiImageUrl(entry);
    return resolved ? [resolved] : [];
  });
}
function registerOpenAiLlmHandlers() {
  ipcMain.handle("llm:openai-chat", async (_event, params) => {
    const record = params && typeof params === "object" && !Array.isArray(params) ? params : {};
    const apiKey = typeof record.apiKey === "string" ? record.apiKey : "";
    const userMessage = typeof record.userMessage === "string" ? record.userMessage : "";
    const imageUrls = imageUrlsFrom(record.imageUrls);
    if (apiKey === TEAM_PROVIDER_SENTINEL) {
      return invokeSharedOpenAi({
        ...record,
        apiKey: TEAM_PROVIDER_SENTINEL,
        userMessage,
        imageUrls
      });
    }
    return completeOpenAiChat({
      apiKey,
      model: typeof record.model === "string" ? record.model : void 0,
      systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : void 0,
      userMessage,
      imageUrls,
      maxCompletionTokens: typeof record.maxCompletionTokens === "number" ? record.maxCompletionTokens : void 0,
      jsonObject: record.jsonObject === false ? false : void 0
    });
  });
  ipcMain.handle("llm:openai-realtime-session", async (_event, params) => {
    var _a;
    const record = params && typeof params === "object" && !Array.isArray(params) ? params : {};
    const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
    const sdp = typeof record.sdp === "string" ? record.sdp : "";
    const voices = /* @__PURE__ */ new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
    const voice = typeof record.voice === "string" && voices.has(record.voice) ? record.voice : "cedar";
    if (!apiKey) throw new Error("Add an OpenAI API key in Settings to use Voice Director.");
    if (!sdp || sdp.length > 1e6) throw new Error("Voice Director received an invalid audio session offer.");
    const session2 = JSON.stringify({
      type: "realtime",
      model: "gpt-realtime-2.1",
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: true,
            interrupt_response: true
          }
        },
        output: { voice }
      }
    });
    const body = new FormData();
    body.set("sdp", sdp);
    body.set("session", session2);
    const response2 = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": "cinegen-desktop-user"
      },
      body
    });
    const answer = await response2.text();
    if (!response2.ok) {
      let message = `OpenAI Realtime failed (${response2.status}).`;
      try {
        const parsed = JSON.parse(answer);
        if ((_a = parsed.error) == null ? void 0 : _a.message) message = parsed.error.message;
      } catch {
      }
      throw new Error(message);
    }
    return { sdp: answer };
  });
}
const execFileAsync = promisify(execFile);
const MAX_CLIP_SECONDS = 90;
function resolveExistingPath(fileRef) {
  const trimmed = fileRef.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    path.resolve(trimmed)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
async function extractClipSegment(inputPath, startTimeSec, durationSec, outputPath) {
  const ffmpegPath = getFfmpegPath();
  const safeStart = Math.max(0, startTimeSec);
  const safeDuration = Math.max(0.1, Math.min(durationSec, MAX_CLIP_SECONDS));
  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-ss",
      `${safeStart}`,
      "-i",
      inputPath,
      "-t",
      `${safeDuration}`,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath
    ], { timeout: Math.max(12e4, Math.ceil(safeDuration * 4e3)) });
    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}
async function extractFrame(inputPath, timeSec, outputPath) {
  const ffmpegPath = getFfmpegPath();
  try {
    await execFileAsync(ffmpegPath, [
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
    ], { timeout: 15e3 });
    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}
function hashRef(ref) {
  return crypto$1.createHash("sha1").update(JSON.stringify({
    label: ref.label,
    fileRef: ref.fileRef,
    trimStartSec: ref.trimStartSec,
    trimDurationSec: ref.trimDurationSec
  })).digest("hex").slice(0, 12);
}
function hasWhitespace(value) {
  return /\s/.test(value);
}
function stagePathForGeminiAtReference(sourcePath, outputPath) {
  try {
    if (fs.existsSync(outputPath)) return outputPath;
    try {
      fs.linkSync(sourcePath, outputPath);
    } catch {
      fs.copyFileSync(sourcePath, outputPath);
    }
    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}
function stageIfNeededForGeminiAtReference(sourcePath, ref, visualDir) {
  if (!hasWhitespace(sourcePath)) {
    return { mediaPath: sourcePath, ephemeral: false };
  }
  const ext = path.extname(sourcePath) || (ref.mediaType === "image" ? ".jpg" : ".mp4");
  const outputPath = path.join(visualDir, `${hashRef(ref)}-source${ext}`);
  const stagedPath = stagePathForGeminiAtReference(sourcePath, outputPath);
  return stagedPath ? { mediaPath: stagedPath, ephemeral: true } : null;
}
async function prepareCopilotVisualRefs(refs, workspaceDir) {
  const visualDir = path.join(workspaceDir, "visual-refs");
  fs.mkdirSync(visualDir, { recursive: true });
  const prepared = [];
  for (const ref of refs) {
    const sourcePath = resolveExistingPath(ref.fileRef);
    if (!sourcePath) continue;
    if (ref.mediaType === "image") {
      const staged = stageIfNeededForGeminiAtReference(sourcePath, ref, visualDir);
      if (!staged) continue;
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: "image",
        mediaPath: staged.mediaPath,
        ephemeral: staged.ephemeral
      });
      continue;
    }
    if (ref.trimStartSec !== void 0 && ref.trimDurationSec !== void 0) {
      const outPath = path.join(visualDir, `${hashRef(ref)}.mp4`);
      const extracted = await extractClipSegment(
        sourcePath,
        ref.trimStartSec,
        ref.trimDurationSec,
        outPath
      );
      if (extracted) {
        prepared.push({
          label: ref.label,
          kind: ref.kind,
          mediaType: "video",
          mediaPath: extracted,
          ephemeral: true
        });
        continue;
      }
    }
    const ext = path.extname(sourcePath).toLowerCase();
    if ([".mp4", ".mov", ".webm", ".m4v", ".avi"].includes(ext)) {
      const staged = stageIfNeededForGeminiAtReference(sourcePath, ref, visualDir);
      if (!staged) continue;
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: "video",
        mediaPath: staged.mediaPath,
        ephemeral: staged.ephemeral
      });
      continue;
    }
    const frameFromMeta = (ref.framePaths ?? []).map((framePath) => resolveExistingPath(framePath)).find(Boolean);
    if (frameFromMeta) {
      const staged = stageIfNeededForGeminiAtReference(frameFromMeta, {
        ...ref,
        mediaType: "image",
        fileRef: frameFromMeta
      }, visualDir);
      if (!staged) continue;
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: "image",
        mediaPath: staged.mediaPath,
        ephemeral: staged.ephemeral
      });
      continue;
    }
    const fallbackFrame = path.join(visualDir, `${hashRef(ref)}.jpg`);
    const extractedFrame = await extractFrame(sourcePath, ref.trimStartSec ?? 0, fallbackFrame);
    if (extractedFrame) {
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: "image",
        mediaPath: extractedFrame,
        ephemeral: true
      });
    }
  }
  return prepared;
}
function buildGeminiUserMessageWithVisualRefs(userMessage, prepared) {
  if (prepared.length === 0) return userMessage.trim();
  const attachments = prepared.map((ref) => `@${ref.mediaPath}`).join(" ");
  const question = userMessage.trim();
  const hasVideo = prepared.some((ref) => ref.mediaType === "video");
  if (hasVideo) {
    return question ? `${attachments} ${question}` : `${attachments} describe this video in detail. Include what you see on screen, the setting, actions, and any spoken audio.`;
  }
  return question ? `${attachments} ${question}` : `${attachments} describe this image in detail.`;
}
function cleanupEphemeralVisualRefs(prepared) {
  for (const ref of prepared) {
    if (!ref.ephemeral) continue;
    try {
      fs.unlinkSync(ref.mediaPath);
    } catch {
    }
  }
}
function resolveLocalSourcePath(fileRef) {
  const trimmed = fileRef.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("local-media://file/")) {
    const decoded = decodeURIComponent(trimmed.replace("local-media://file", ""));
    return resolveExistingPath(decoded);
  }
  if (trimmed.startsWith("file://")) {
    try {
      return resolveExistingPath(decodeURIComponent(new URL(trimmed).pathname));
    } catch {
      return null;
    }
  }
  return resolveExistingPath(trimmed);
}
async function prepareClipReference(fileRef, opts) {
  const source = resolveLocalSourcePath(fileRef);
  if (!source) throw new Error(`Could not resolve a local source file for: ${fileRef}`);
  const workDir = path.join(os.tmpdir(), "cinegen-higgsfield-refs");
  fs.mkdirSync(workDir, { recursive: true });
  const stamp = crypto$1.randomBytes(6).toString("hex");
  const start = Math.max(0, opts.sourceStartSec ?? 0);
  const end = opts.sourceEndSec ?? start;
  if (opts.mode === "first-last") {
    const firstOut = path.join(workDir, `${stamp}-first.jpg`);
    const lastOut = path.join(workDir, `${stamp}-last.jpg`);
    const first = await extractFrame(source, start, firstOut);
    const last = await extractFrame(source, Math.max(start, end - 0.05), lastOut);
    const paths = [];
    const roles = [];
    if (first) {
      paths.push(first);
      roles.push("start_image");
    }
    if (last) {
      paths.push(last);
      roles.push("end_image");
    }
    if (paths.length === 0) throw new Error("Failed to extract first/last frames");
    return { paths, roles };
  }
  if (opts.mode === "segment") {
    const outPath = path.join(workDir, `${stamp}-segment.mp4`);
    const duration = Math.max(0.1, end > start ? end - start : opts.maxSegmentSec ?? 30);
    const seg = await extractClipSegment(source, start, Math.min(duration, opts.maxSegmentSec ?? 30), outPath);
    if (!seg) throw new Error("Failed to extract clip segment");
    return { paths: [seg], roles: ["image"] };
  }
  const time = opts.frameTimeSec ?? (end > start ? (start + end) / 2 : start);
  const frameOut = path.join(workDir, `${stamp}-frame.jpg`);
  const frame = await extractFrame(source, time, frameOut);
  if (!frame) throw new Error("Failed to extract reference frame");
  return { paths: [frame], roles: ["image"] };
}
function isGeminiMediaRefusal(text) {
  return /\b(cannot|can't|do not have the ability|unable to|not able to)\b[\s\S]{0,100}\b(video|visual|auditory|audio|mp4|mov|footage|media file)\b/i.test(text) || /\btools do not allow\b[\s\S]{0,60}\b(video|visual|auditory|mp4)\b/i.test(text);
}
class GeminiMediaUnavailableError extends Error {
}
const GEMINI_MEDIA_FIRST_TOKEN_TIMEOUT_MS = 18e4;
const GEMINI_MEDIA_TOTAL_TIMEOUT_MS = 10 * 60 * 1e3;
async function analyzeMediaWithGeminiCli(params) {
  var _a;
  const binary = await resolveCliBinary("gemini");
  if (!binary) {
    throw new GeminiMediaUnavailableError("Gemini CLI is not installed.");
  }
  const source = resolveExistingPath(params.mediaPath);
  if (!source) {
    throw new Error(`Media file not found: ${params.mediaPath}`);
  }
  const workDir = path.join(os.tmpdir(), "cinegen-gemini-acoustic");
  await mkdir(workDir, { recursive: true });
  let stagedPath = source;
  let ephemeral = false;
  if (hasWhitespace(source)) {
    const ext = path.extname(source) || ".mp4";
    const out = path.join(workDir, `${crypto$1.randomUUID()}${ext}`);
    const staged = stagePathForGeminiAtReference(source, out);
    if (!staged) {
      throw new Error("Could not stage the media file for Gemini analysis.");
    }
    stagedPath = staged;
    ephemeral = true;
  }
  const model = ((_a = params.model) == null ? void 0 : _a.trim()) || "gemini-2.5-flash";
  const prompt = `@${stagedPath} ${params.prompt.trim()}`;
  const args = [
    "--skip-trust",
    "-p",
    prompt,
    "-o",
    "stream-json",
    "-m",
    model,
    "--approval-mode",
    "auto_edit",
    "--session-id",
    crypto$1.randomUUID(),
    "--include-directories",
    path.dirname(stagedPath)
  ];
  const cleanup = () => {
    if (!ephemeral) return;
    try {
      fs.unlinkSync(stagedPath);
    } catch {
    }
  };
  return new Promise((resolve, reject) => {
    var _a2, _b;
    const child = spawn(binary, args, { env: buildGeminiCliEnv(), cwd: workDir, stdio: ["ignore", "pipe", "pipe"] });
    let fullContent = "";
    let stderrBuffer = "";
    let lineBuffer = "";
    let settled = false;
    let firstTokenReceived = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeoutId);
      clearTimeout(firstTokenTimeoutId);
      cleanup();
      handler();
    };
    const totalTimeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("Gemini CLI media analysis timed out.")));
    }, GEMINI_MEDIA_TOTAL_TIMEOUT_MS);
    const firstTokenTimeoutId = setTimeout(() => {
      if (firstTokenReceived) return;
      child.kill("SIGTERM");
      finish(() => reject(new Error("Gemini CLI is still reading the media file. Try a shorter clip.")));
    }, GEMINI_MEDIA_FIRST_TOKEN_TIMEOUT_MS);
    (_a2 = child.stdout) == null ? void 0 : _a2.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      let idx;
      while ((idx = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, idx).trim();
        lineBuffer = lineBuffer.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "message" && obj.role === "assistant" && typeof obj.content === "string") {
            if (obj.content) {
              firstTokenReceived = true;
              fullContent += obj.content;
            }
          }
          if (obj.type === "error" && typeof obj.message === "string") {
            stderrBuffer += obj.message;
          }
        } catch {
        }
      }
    });
    (_b = child.stderr) == null ? void 0 : _b.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      const trimmed = fullContent.trim();
      if (!trimmed) {
        const errorMessage = stripAnsiCodes(stderrBuffer.trim()) || `Gemini CLI exited with code ${code ?? "unknown"}`;
        finish(() => reject(new Error(errorMessage)));
        return;
      }
      if (isGeminiMediaRefusal(trimmed)) {
        finish(() => reject(new GeminiMediaUnavailableError("Gemini CLI declined to analyze the media.")));
        return;
      }
      finish(() => resolve(trimmed));
    });
  });
}
const copilotVisualMedia = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GeminiMediaUnavailableError,
  analyzeMediaWithGeminiCli,
  buildGeminiUserMessageWithVisualRefs,
  cleanupEphemeralVisualRefs,
  prepareClipReference,
  prepareCopilotVisualRefs,
  resolveLocalSourcePath
}, Symbol.toStringTag, { value: "Module" }));
let activeRequest = null;
const FIRST_TOKEN_TIMEOUT_MS = 9e4;
const VISUAL_FIRST_TOKEN_TIMEOUT_MS = 18e4;
const PROMPT_STDIN_THRESHOLD = 8e3;
function getGeminiWorkspaceDir() {
  return path.join(app.getPath("userData"), "gemini-cli-workspace");
}
function getGeminiVisualWorkspaceDir() {
  return path.join(os.tmpdir(), "cinegen-gemini-visual-refs");
}
function buildGeminiPrompt(params) {
  var _a;
  const systemParts = [];
  if ((_a = params.systemPrompt) == null ? void 0 : _a.trim()) {
    if (params.injectProjectContext) {
      const refreshPrefix = params.contextRefresh ? "The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n" : "";
      systemParts.push(`${refreshPrefix}${params.systemPrompt.trim()}

${params.purpose === "enhance-prompt" ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX}`);
    } else {
      systemParts.push(params.systemPrompt.trim());
    }
  }
  const history = (params.messages ?? []).filter((message) => message.content.trim());
  if (history.length > 0) {
    return systemParts.length > 0 ? `${systemParts.join("\n\n")}

${buildConversationPrompt(history)}` : buildConversationPrompt(history);
  }
  return systemParts.length > 0 ? `${systemParts.join("\n\n")}

User:
${params.userMessage.trim()}

Assistant:
` : params.userMessage.trim();
}
function buildGeminiResumePrompt(params) {
  var _a;
  const prefix = [
    (_a = params.systemPrompt) == null ? void 0 : _a.trim(),
    COPILOT_RESUME_REMINDER
  ].filter(Boolean).join("\n\n");
  return prefix ? `${prefix}

User:
${params.userMessage.trim()}

Assistant:
` : `${params.userMessage.trim()}

Assistant:
`;
}
function parseGeminiUsage(obj) {
  const stats = obj.stats;
  if (!stats) return void 0;
  const promptTokens = Number(stats.input_tokens) || 0;
  const completionTokens = Number(stats.output_tokens) || 0;
  const totalTokens = Number(stats.total_tokens) || promptTokens + completionTokens;
  if (totalTokens <= 0) return void 0;
  return { promptTokens, completionTokens, totalTokens, cost: 0 };
}
function formatGeminiToolStatus(toolName) {
  if (typeof toolName !== "string" || !toolName.trim()) return "Gemini CLI is working…";
  const normalized = toolName.replace(/_/g, " ").toLowerCase();
  if (normalized.includes("read") && normalized.includes("file")) {
    return "Gemini CLI: Reading attached video…";
  }
  return `Gemini CLI: ${toolName.replace(/_/g, " ")}…`;
}
function isFatalGeminiStreamError(message) {
  return /malformed tool call|empty response|API Error|INVALID_ARGUMENT/i.test(message);
}
function isMissingGeminiSessionError(message) {
  return /no previous sessions found/i.test(message);
}
async function streamGeminiChatOnce(requestId, params, options) {
  var _a;
  const binary = await resolveCliBinary("gemini");
  if (!binary) {
    throw new Error("Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli");
  }
  const model = ((_a = params.model) == null ? void 0 : _a.trim().replace(/^[^/]+\//, "")) || "gemini-2.5-flash";
  const prompt = options.canResume ? buildGeminiResumePrompt(params) : buildGeminiPrompt(params);
  const useStdin = prompt.length > PROMPT_STDIN_THRESHOLD;
  const workDir = getGeminiWorkspaceDir();
  await mkdir(workDir, { recursive: true });
  const args = [
    "--skip-trust",
    ...useStdin ? ["-p", ""] : ["-p", prompt],
    "-o",
    "stream-json",
    "-m",
    model,
    "--approval-mode",
    options.hasVisualRefs ? "yolo" : "default"
  ];
  if (options.hasVisualRefs) {
    args.push("--session-id", crypto$1.randomUUID());
    const includeDirs = [...new Set(
      options.preparedVisualRefs.map((ref) => path.dirname(ref.mediaPath))
    )];
    for (const dir of includeDirs) {
      args.push("--include-directories", dir);
    }
  } else if (options.canResume && params.resumeSessionId) {
    args.push("-r", params.resumeSessionId);
  }
  const win = getMainWindow$2();
  let fullContent = "";
  let stderrBuffer = "";
  let sessionId;
  let usage;
  const chatTimeoutMs = 15 * 60 * 1e3;
  const firstTokenTimeoutMs = options.hasVisualRefs ? VISUAL_FIRST_TOKEN_TIMEOUT_MS : FIRST_TOKEN_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    var _a2, _b, _c, _d;
    const child = spawn(binary, args, {
      env: buildGeminiCliEnv(),
      cwd: workDir,
      stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    if (useStdin) {
      (_a2 = child.stdin) == null ? void 0 : _a2.write(prompt);
      (_b = child.stdin) == null ? void 0 : _b.end();
    }
    activeRequest = { child, requestId, provider: "gemini" };
    let lineBuffer = "";
    let settled = false;
    let firstTokenReceived = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(firstTokenTimeoutId);
      cleanupEphemeralVisualRefs(options.preparedVisualRefs);
      handler();
    };
    const timeoutId = setTimeout(() => {
      activeRequest = null;
      child.kill("SIGTERM");
      finish(() => reject(new Error("Gemini CLI timed out after 15 minutes. Try again or switch models.")));
    }, chatTimeoutMs);
    const firstTokenTimeoutId = setTimeout(() => {
      if (firstTokenReceived || settled) return;
      activeRequest = null;
      child.kill("SIGTERM");
      finish(() => reject(new Error(
        options.hasVisualRefs ? "Gemini CLI is still reading the attached video. Try again or use a shorter clip." : "Gemini CLI is taking too long to respond. Try gemini-2.5-flash, shorten the question, or start a new chat."
      )));
    }, firstTokenTimeoutMs);
    (_c = child.stdout) == null ? void 0 : _c.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      let newlineIdx;
      while ((newlineIdx = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "init" && typeof obj.session_id === "string") {
            sessionId = obj.session_id;
          }
          const parsedUsage = parseGeminiUsage(obj);
          if (parsedUsage) usage = parsedUsage;
          if (obj.type === "tool_use") {
            win == null ? void 0 : win.webContents.send("llm:gemini-stream", {
              requestId,
              status: formatGeminiToolStatus(obj.tool_name)
            });
          }
          if (obj.type === "message" && obj.role === "assistant" && typeof obj.content === "string") {
            const token2 = obj.content;
            if (token2) {
              firstTokenReceived = true;
              fullContent += token2;
              win == null ? void 0 : win.webContents.send("llm:gemini-stream", { requestId, token: token2 });
            }
          }
          if (obj.type === "error" && typeof obj.message === "string") {
            const errorMessage = obj.message;
            stderrBuffer += errorMessage;
            if (!fullContent.trim() && isFatalGeminiStreamError(errorMessage)) {
              activeRequest = null;
              child.kill("SIGTERM");
              finish(() => reject(new Error(stripAnsiCodes(errorMessage))));
            }
          }
          if (obj.type === "result" && obj.status === "error") {
            const resultError = typeof obj.error === "string" ? obj.error : typeof obj.message === "string" ? obj.message : "Gemini CLI returned an error.";
            stderrBuffer += resultError;
          }
        } catch {
        }
      }
    });
    (_d = child.stderr) == null ? void 0 : _d.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
    child.on("error", (error) => {
      activeRequest = null;
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      activeRequest = null;
      win == null ? void 0 : win.webContents.send("llm:gemini-stream", { requestId, done: true });
      const trimmed = fullContent.trim();
      if (!trimmed) {
        const errorMessage = stripAnsiCodes(stderrBuffer.trim()) || `Gemini CLI exited with code ${code ?? "unknown"}`;
        finish(() => reject(new Error(errorMessage)));
        return;
      }
      finish(() => resolve({
        message: trimmed,
        sessionId,
        usage,
        resumed: options.canResume
      }));
    });
  });
}
async function streamGeminiChat(requestId, params) {
  if (!params.userMessage.trim()) {
    throw new Error("No chat message provided.");
  }
  const workDir = getGeminiWorkspaceDir();
  const visualWorkspaceDir = getGeminiVisualWorkspaceDir();
  await mkdir(workDir, { recursive: true });
  await mkdir(visualWorkspaceDir, { recursive: true });
  const preparedVisualRefs = await prepareCopilotVisualRefs(params.visualRefs ?? [], visualWorkspaceDir);
  if ((params.visualRefs ?? []).length > 0 && preparedVisualRefs.length === 0) {
    throw new Error("Could not load the attached /clip or /asset files for Gemini visual analysis. Use local video or image files.");
  }
  const hasVisualRefs = preparedVisualRefs.length > 0;
  const effectiveParams = {
    ...params,
    userMessage: buildGeminiUserMessageWithVisualRefs(params.userMessage, preparedVisualRefs)
  };
  const wantsResume = Boolean(params.resumeSessionId) && !params.injectProjectContext && !hasVisualRefs;
  try {
    return await streamGeminiChatOnce(requestId, effectiveParams, {
      canResume: wantsResume,
      hasVisualRefs,
      preparedVisualRefs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!wantsResume || !isMissingGeminiSessionError(message)) {
      throw error;
    }
    return streamGeminiChatOnce(requestId, {
      ...effectiveParams,
      injectProjectContext: !hasVisualRefs,
      contextRefresh: !hasVisualRefs,
      resumeSessionId: void 0
    }, {
      canResume: false,
      hasVisualRefs,
      preparedVisualRefs
    });
  }
}
function registerGeminiCliHandlers() {
  ipcMain.handle("llm:gemini-chat", async (_event, params) => {
    const requestId = params.requestId || crypto$1.randomUUID();
    const result = await streamGeminiChat(requestId, params);
    return {
      message: result.message,
      sessionId: result.sessionId,
      resumed: result.resumed,
      ...result.usage ? { usage: result.usage } : {}
    };
  });
  ipcMain.handle("llm:gemini-cancel", async (_event, requestId) => {
    if ((activeRequest == null ? void 0 : activeRequest.requestId) !== requestId || activeRequest.provider !== "gemini") return;
    activeRequest.child.kill("SIGTERM");
    activeRequest = null;
  });
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
      openSpaceIds: Array.isArray(record.openSpaceIds) ? record.openSpaceIds.filter((value) => typeof value === "string") : void 0,
      director: record.director
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
        openSpaceIds: workflow.openSpaceIds ?? [],
        director: workflow.director ?? null
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
    const dir = projectDir$1(id);
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
const VIDEO_EXTS = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]);
const AUDIO_EXTS = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
function detectAssetType$1(filePath, fallback) {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext) return "image";
  return fallback;
}
function extensionForAsset(url, assetType) {
  if (url) {
    try {
      const ext = path.extname(new URL(url).pathname);
      if (ext && ext.length <= 8) return ext;
    } catch {
      const ext = path.extname(url);
      if (ext && ext.length <= 8) return ext;
    }
  }
  switch (assetType) {
    case "video":
      return ".mp4";
    case "audio":
      return ".mp3";
    default:
      return ".jpg";
  }
}
async function findExistingGeneratedAsset(mediaDir, assetId) {
  let entries = [];
  try {
    entries = await fs$1.readdir(mediaDir);
  } catch {
    return null;
  }
  const match = entries.find((entry) => entry === assetId || entry.startsWith(`${assetId}.`));
  return match ? path.join(mediaDir, match) : null;
}
function decodeLocalMediaUrl(url) {
  if (!url.startsWith("local-media://file")) return null;
  return decodeURIComponent(url.replace(/^local-media:\/\/file/, ""));
}
function resolveLocalPathHint(hint) {
  if (!(hint == null ? void 0 : hint.trim())) return null;
  const trimmed = hint.trim();
  const decoded = decodeLocalMediaUrl(trimmed) ?? trimmed;
  return fs.existsSync(decoded) ? decoded : null;
}
async function copyIntoGenerated(sourcePath, destPath) {
  await fs$1.mkdir(path.dirname(destPath), { recursive: true });
  await fs$1.copyFile(sourcePath, destPath);
}
function queueAssetDerivationPipeline(params) {
  const projDir = projectDir$1(params.projectId);
  const cacheDir = path.join(projDir, ".cache");
  const metadataJobId = crypto$1.randomUUID();
  const metadataJob = {
    id: metadataJobId,
    type: "extract_metadata",
    assetId: params.assetId,
    inputPath: params.inputPath,
    outputPath: "",
    projectDir: projDir
  };
  if (params.type !== "audio") {
    const thumbsDir = path.join(cacheDir, "thumbnails");
    fs.mkdirSync(thumbsDir, { recursive: true });
    submitJob({
      id: crypto$1.randomUUID(),
      type: "generate_thumbnail",
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(thumbsDir, `${params.assetId}.jpg`),
      projectDir: projDir
    }).catch((err) => console.error("[generated-asset-persist] Thumbnail failed:", err));
  }
  submitJob(metadataJob).catch((err) => console.error("[generated-asset-persist] Metadata failed:", err));
  if (params.type === "audio" || params.type === "video") {
    const waveformDir = path.join(cacheDir, "waveforms");
    fs.mkdirSync(waveformDir, { recursive: true });
    submitJob({
      id: crypto$1.randomUUID(),
      type: "compute_waveform",
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(waveformDir, `${params.assetId}.json`),
      projectDir: projDir
    }).catch((err) => console.error("[generated-asset-persist] Waveform failed:", err));
  }
  if (params.type === "video") {
    const filmstripDir = path.join(cacheDir, "filmstrips");
    fs.mkdirSync(filmstripDir, { recursive: true });
    submitJob({
      id: crypto$1.randomUUID(),
      type: "generate_filmstrip",
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(filmstripDir, `${params.assetId}.jpg`),
      projectDir: projDir
    }).catch((err) => console.error("[generated-asset-persist] Filmstrip failed:", err));
    const proxyDir = path.join(cacheDir, "proxies");
    fs.mkdirSync(proxyDir, { recursive: true });
    submitJob({
      id: crypto$1.randomUUID(),
      type: "generate_proxy",
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(proxyDir, `${params.assetId}.mp4`),
      projectDir: projDir
    }).catch((err) => console.error("[generated-asset-persist] Proxy failed:", err));
  }
  return metadataJobId;
}
async function persistGeneratedAsset(params) {
  var _a;
  const { projectId, assetId, assetType } = params;
  if (!projectId || !assetId) {
    throw new Error("projectId and assetId are required.");
  }
  const projDir = projectDir$1(projectId);
  const mediaDir = path.join(projDir, "media", "generated");
  await fs$1.mkdir(mediaDir, { recursive: true });
  const existing = await findExistingGeneratedAsset(mediaDir, assetId);
  if (existing) {
    queueAssetDerivationPipeline({
      assetId,
      projectId,
      inputPath: existing,
      type: detectAssetType$1(existing, assetType)
    });
    return {
      path: existing,
      sourceUrl: params.remoteUrl,
      downloaded: false
    };
  }
  const extension = params.extension || extensionForAsset(params.remoteUrl ?? params.localPathHint, assetType);
  const destPath = path.join(mediaDir, `${assetId}${extension}`);
  const localSource = resolveLocalPathHint(params.localPathHint);
  if (localSource) {
    await copyIntoGenerated(localSource, destPath);
    queueAssetDerivationPipeline({
      assetId,
      projectId,
      inputPath: destPath,
      type: detectAssetType$1(destPath, assetType)
    });
    return {
      path: destPath,
      sourceUrl: params.remoteUrl,
      downloaded: false
    };
  }
  const remoteUrl = (_a = params.remoteUrl) == null ? void 0 : _a.trim();
  if (!remoteUrl) {
    return { error: "No downloadable URL or local file path for this asset." };
  }
  const response2 = await fetch(remoteUrl);
  if (!response2.ok) {
    throw new Error(`Failed to download (HTTP ${response2.status}). The URL may have expired.`);
  }
  const arrayBuffer = await response2.arrayBuffer();
  await fs$1.writeFile(destPath, Buffer.from(arrayBuffer));
  queueAssetDerivationPipeline({
    assetId,
    projectId,
    inputPath: destPath,
    type: detectAssetType$1(destPath, assetType)
  });
  return {
    path: destPath,
    sourceUrl: remoteUrl,
    downloaded: true
  };
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
        const pending2 = pendingJobs.get(msg.jobId);
        if (pending2) {
          pending2.resolve(msg.result);
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
    for (const [id, pending2] of pendingJobs) {
      pending2.reject(new Error("Worker exited"));
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
  const VIDEO_EXTS2 = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]);
  const AUDIO_EXTS2 = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
  if (VIDEO_EXTS2.has(ext)) return "video";
  if (AUDIO_EXTS2.has(ext)) return "audio";
  return "image";
}
function registerMediaImportHandlers() {
  ipcMain.handle("media:import", async (_event, params) => {
    const { filePaths, projectId, mode } = params;
    const projDir = projectDir$1(projectId);
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
        queueAssetDerivationPipeline({
          assetId: pipeline.assetId,
          projectId,
          inputPath: pipeline.inputPath,
          type: pipeline.type
        });
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
  ipcMain.handle("media:write-temp-image", async (_event, params) => {
    const match = params.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) throw new Error("media:write-temp-image expects a base64 image data URL.");
    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const buffer = Buffer.from(match[2], "base64");
    const outputPath = path.join(os.tmpdir(), `cinegen-frame-chat-${crypto$1.randomUUID()}.${ext}`);
    await fs$1.writeFile(outputPath, buffer);
    return { outputPath };
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
    const projDir = projectDir$1(projectId);
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
      const result = await persistGeneratedAsset({
        projectId,
        assetId,
        assetType: "video",
        remoteUrl: url,
        extension: ext
      });
      if ("error" in result) throw new Error(result.error);
      return { path: result.path };
    }
  );
  ipcMain.handle(
    "media:persist-generated-asset",
    async (_event, params) => {
      try {
        return await persistGeneratedAsset(params);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error)
        };
      }
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
function appendTranscriptToken(text, token2) {
  const trimmedToken = token2.trim();
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
      const server2 = net.createServer();
      server2.listen(0, "127.0.0.1", () => {
        const addr = server2.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          server2.close(() => resolve(port));
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
function buildAnalysisPrompt(userPrompt, label, mediaType) {
  const mediaLabel = mediaType === "video" ? "video clip" : "image";
  return [
    userPrompt.trim() || `Describe this ${mediaLabel} in detail.`,
    `Attached ${mediaLabel}: "${label}".`,
    "Describe what you actually see and hear — specific subjects, actions, setting, camera movement, on-screen text, and spoken dialogue.",
    "Do not answer from clip names, storyboard labels, or generic production terminology alone."
  ].join("\n");
}
async function analyzeCopilotVisualRefs(params) {
  const workspaceDir = params.workspaceDir ?? path.join(app.getPath("userData"), "gemini-cli-workspace");
  const prepared = await prepareCopilotVisualRefs(params.visualRefs, workspaceDir);
  if (prepared.length === 0) {
    throw new Error("Could not load the attached clip or asset files for visual analysis.");
  }
  try {
    const results = [];
    for (const ref of prepared) {
      const analysisPrompt = buildAnalysisPrompt(params.prompt, ref.label, ref.mediaType);
      const analysis = ref.mediaType === "video" ? await analyzeVideoWithPrompt({
        apiKey: params.apiKey,
        videoPath: ref.mediaPath,
        prompt: analysisPrompt,
        detailedAnalysis: true
      }) : await analyzeImageWithPrompt({
        apiKey: params.apiKey,
        imagePath: ref.mediaPath,
        prompt: analysisPrompt
      });
      results.push({
        label: ref.label,
        mediaType: ref.mediaType,
        analysis
      });
    }
    return results;
  } finally {
    cleanupEphemeralVisualRefs(prepared);
  }
}
function registerCopilotVideoAnalysisHandlers() {
  ipcMain.handle("copilot:analyze-visual-refs", async (_event, params) => analyzeCopilotVisualRefs(params));
}
const ACOUSTIC_ANALYSIS_VERSION = 1;
const SILENCE_NOISE_DB = -30;
const SILENCE_MIN_DURATION = 0.3;
function parseSilenceDetect(stderr) {
  const intervals = [];
  let pendingStart = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (endMatch && pendingStart !== null) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > pendingStart) {
        intervals.push({ start: pendingStart, end });
      }
      pendingStart = null;
    }
  }
  return intervals;
}
function formatTc(seconds) {
  return seconds.toFixed(2);
}
function buildAcousticPrompt(params) {
  const { assetName, transcript } = params;
  if (transcript.length === 0) {
    return [
      `Analyze the media "${assetName}", which has no spoken dialogue (b-roll / cutaway footage).`,
      "Listen and watch, then return compact JSON ONLY with this shape:",
      '{"segments":[{"start":0.0,"end":8.0,"content":"...","shotType":"wide","cutawayCandidate":true,"confidence":0.7}]}',
      "Break the clip into a few meaningful time ranges. For each range, describe the visual content and ambient sound,",
      "name a likely shotType, and set cutawayCandidate true when the range would work as a cutaway over interview audio.",
      "Return only JSON, no prose."
    ].join("\n");
  }
  const transcriptLines = transcript.map((seg) => `[${formatTc(seg.start)}-${formatTc(seg.end)}] ${seg.text}`).join("\n");
  return [
    `You are an assistant film editor analyzing the AUDIO performance in "${assetName}".`,
    "Here is the transcript with timecodes (seconds):",
    transcriptLines,
    "",
    "Listen to the audio and, for each transcript segment (matched by its timecodes), describe HOW it was said.",
    "Return compact JSON ONLY with this shape:",
    `{"segments":[{"start":0.0,"end":3.2,"delivery":"voice steadies then cracks on 'home'","emotion":"reflective","energy":"low-and-deliberate","pace":"slow","notable":["400ms pause before 'home'","usable as hook"],"confidence":0.8}]}`,
    "Use rich descriptive text, NOT numeric scores. Capture vocal delivery, emotion, energy, pace, hesitations,",
    "laughter, breaths, and reflective pauses. Keep each field short. Return only JSON, no prose."
  ].join("\n");
}
function extractJsonText(raw) {
  var _a;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const tryParse = (s) => {
    try {
      JSON.parse(s);
      return s;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  for (const m of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const inner = (_a = m[1]) == null ? void 0 : _a.trim();
    if (inner && tryParse(inner)) return inner;
  }
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const startIdx = trimmed.indexOf(open);
    if (startIdx === -1) continue;
    let depth = 0;
    for (let i = startIdx; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const slice = trimmed.slice(startIdx, i + 1);
          const parsedSlice = tryParse(slice);
          if (parsedSlice) return parsedSlice;
          break;
        }
      }
    }
  }
  return null;
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : void 0;
}
function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function strArray(value) {
  if (!Array.isArray(value)) return void 0;
  const out = value.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : void 0;
}
function normalizeAcousticSegments(raw) {
  const jsonText = extractJsonText(raw);
  if (!jsonText) return [];
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.segments) ? parsed.segments : [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const r = entry;
    const start = num(r.start);
    const end = num(r.end);
    if (start === void 0 || end === void 0 || end <= start) return [];
    return [{
      start,
      end,
      delivery: str(r.delivery),
      emotion: str(r.emotion),
      energy: str(r.energy),
      pace: str(r.pace),
      notable: strArray(r.notable),
      content: str(r.content),
      shotType: str(r.shotType),
      cutawayCandidate: typeof r.cutawayCandidate === "boolean" ? r.cutawayCandidate : void 0,
      confidence: num(r.confidence)
    }];
  });
}
function runFfmpegSilenceDetect(mediaPath) {
  return new Promise((resolve) => {
    const args = [
      "-i",
      mediaPath,
      "-af",
      `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION}`,
      "-f",
      "null",
      "-"
    ];
    const proc = spawn(getFfmpegPath(), args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", () => resolve(""));
    proc.on("close", () => resolve(stderr));
  });
}
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
const FAL_MODEL_LABEL = "fal-ai/video-understanding";
async function runDescriptorPass(params, prompt) {
  var _a;
  const geminiModel = ((_a = params.model) == null ? void 0 : _a.trim()) || GEMINI_MODEL_DEFAULT;
  try {
    const rawText = await analyzeMediaWithGeminiCli({
      mediaPath: params.mediaPath,
      prompt,
      model: geminiModel
    });
    return { rawText, model: geminiModel };
  } catch (error) {
    const geminiUnavailable = error instanceof GeminiMediaUnavailableError;
    if (!geminiUnavailable) throw error;
    if (!params.apiKey) {
      throw new Error("Gemini CLI could not analyze this clip and no fal.ai API key is set for fallback.");
    }
    const rawText = await analyzeVideoWithPrompt({
      apiKey: params.apiKey,
      videoPath: params.mediaPath,
      prompt,
      detailedAnalysis: true
    });
    return { rawText, model: FAL_MODEL_LABEL };
  }
}
async function analyzeAssetAcoustics(params) {
  var _a;
  const base = {
    assetId: params.assetId,
    status: "failed",
    version: ACOUSTIC_ANALYSIS_VERSION,
    model: ((_a = params.model) == null ? void 0 : _a.trim()) || GEMINI_MODEL_DEFAULT,
    silenceMap: [],
    segments: [],
    hasSpeech: params.transcript.length > 0,
    sourceDurationSec: params.durationSec
  };
  try {
    const stderr = await runFfmpegSilenceDetect(params.mediaPath).catch(() => "");
    const silenceMap = parseSilenceDetect(stderr);
    const prompt = buildAcousticPrompt({ assetName: params.assetName, transcript: params.transcript });
    const { rawText, model } = await runDescriptorPass(params, prompt);
    const segments = normalizeAcousticSegments(rawText);
    return {
      ...base,
      model,
      status: "ready",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      silenceMap,
      segments,
      error: silenceMap.length === 0 ? "Silence detection returned no intervals." : void 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, error: message || "Acoustic analysis failed." };
  }
}
function registerAcousticHandlers() {
  ipcMain.handle("acoustic:analyze-asset", async (_event, params) => {
    return analyzeAssetAcoustics(params);
  });
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
process.on("message", (message) => {
  if (message !== "electron-vite&type=hot-reload") return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.reload();
  }
});
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
  registerMcpBridge(() => mainWindow);
  registerWorkflowHandlers();
  registerHiggsfieldHandlers();
  registerArtlistHandlers();
  registerTopviewHandlers();
  registerExportHandlers();
  registerElementHandlers();
  registerElementsLibraryHandlers();
  registerLLMChatHandlers();
  registerClaudeCodeHandlers();
  registerCliLlmDetectHandlers();
  registerCodexCliHandlers();
  registerOpenAiLlmHandlers();
  registerTeamProviderHandlers();
  registerGeminiCliHandlers();
  registerMusicPromptHandlers();
  registerFileSystemHandlers();
  registerDbHandlers();
  registerMediaImportHandlers();
  registerAudioSyncHandlers(submitJob);
  registerVisionHandlers();
  registerCopilotVideoAnalysisHandlers();
  registerAcousticHandlers();
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
  stopMcpBridge();
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
export {
  HIGGSFIELD_MODEL_REGISTRY as H,
  buildTopviewModelRegistry as b
};
