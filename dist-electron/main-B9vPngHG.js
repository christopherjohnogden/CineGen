var gu = Object.defineProperty;
var yu = (t, e, r) => e in t ? gu(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r;
var M = (t, e, r) => yu(t, typeof e != "symbol" ? e + "" : e, r);
import { ipcMain as I, app as W, shell as Jr, BrowserWindow as Q, screen as Ga, safeStorage as Ir, session as Ha, dialog as io, protocol as za, nativeImage as _u, powerMonitor as yn } from "electron";
import D, { existsSync as it, readFileSync as gr, mkdirSync as yi, writeFileSync as _i, copyFileSync as wu, chmodSync as bu, renameSync as vu, rmSync as Wa } from "node:fs";
import w, { dirname as Tu, join as Tt } from "node:path";
import z, { homedir as Xa } from "node:os";
import { execFile as Ce, spawn as ae } from "node:child_process";
import { promisify as Lt } from "node:util";
import J, { randomUUID as yr, randomBytes as Eu } from "node:crypto";
import j, { writeFile as Su, chmod as Iu, mkdir as at } from "node:fs/promises";
import { Readable as oo } from "node:stream";
import wi from "better-sqlite3";
import { createServer as Ja } from "node:http";
import { lookup as xu } from "node:dns/promises";
import { request as Au } from "node:https";
import ku, { isIP as bi } from "node:net";
import { createRequire as Ka } from "node:module";
import { fileURLToPath as vi } from "node:url";
import { Worker as Ya } from "worker_threads";
function _r(t) {
  return !!t && typeof t == "object" && !Array.isArray(t);
}
function Ti(t) {
  if (!it(t)) return { raw: null, config: {} };
  const e = gr(t, "utf8");
  let r;
  try {
    r = JSON.parse(e);
  } catch {
    throw new Error("Claude’s configuration is not valid JSON. Fix it in Claude → Settings → Developer → Edit Config, then try again. No changes were made.");
  }
  if (!_r(r) || r.mcpServers !== void 0 && !_r(r.mcpServers))
    throw new Error("Claude’s configuration has an unexpected format. No changes were made.");
  return { raw: e, config: r };
}
function Qa(t) {
  return _r(t.mcpServers) ? t.mcpServers.cinegen : void 0;
}
function ju(t, e) {
  if (!_r(t) || !_r(t.env)) return !1;
  const r = t.env;
  return t.command === e.command && JSON.stringify(t.args) === JSON.stringify(e.args) && Object.entries(e.env).every(([n, i]) => r[n] === i);
}
function ao(t, e) {
  const r = Ti(t), n = { ...r.config.mcpServers };
  if (e ? n.cinegen = e : delete n.cinegen, !e && !Qa(r.config)) return {};
  const i = { ...r.config, mcpServers: n };
  yi(Tu(t), { recursive: !0 });
  const o = r.raw === null ? void 0 : `${t}.cinegen-backup-${Date.now()}-${yr()}`, a = `${t}.cinegen-${yr()}.tmp`;
  try {
    if (_i(a, `${JSON.stringify(i, null, 2)}
`, { mode: 384, flag: "wx" }), (it(t) ? gr(t, "utf8") : null) !== r.raw) throw new Error("Claude’s configuration changed during setup. Try again.");
    o && (wu(t, o), bu(o, 384)), vu(a, t);
  } finally {
    Wa(a, { force: !0 });
  }
  return { backupPath: o };
}
const Ru = Lt(Ce);
function bt() {
  return {
    config: Tt(Xa(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    source: Tt(W.getAppPath(), "dist-electron", "cinegen-mcp.cjs"),
    installed: Tt(W.getPath("userData"), "mcp", "cinegen-mcp.cjs")
  };
}
function Za() {
  return { command: process.execPath, args: [bt().installed], env: { ELECTRON_RUN_AS_NODE: "1" } };
}
function _n() {
  if (process.platform !== "darwin") throw new Error("Automatic Claude Desktop setup is currently available on Mac.");
  if (process.execPath.includes("/AppTranslocation/") || process.execPath.startsWith("/Volumes/"))
    throw new Error("Move CineGen to Applications and open it there before connecting Claude.");
}
async function Pu(t) {
  const e = "const {spawn}=require('node:child_process');const p=spawn(process.execPath,[process.argv[1]],{env:process.env,stdio:['pipe','pipe','pipe']});let out='';p.stdout.setEncoding('utf8');p.stdout.on('data',x=>out+=x);p.stderr.on('data',()=>{});p.on('error',()=>process.exit(1));p.on('close',c=>{try{const r=out.trim().split('\\n').map(JSON.parse);if(c!==0||!r.some(x=>x.result?.tools?.some(t=>t.name==='cinegen_project')))process.exit(1);console.log('ready');}catch{process.exit(1)}});p.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\\n');";
  try {
    await Ru(process.execPath, ["-e", e, t], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 1e4,
      maxBuffer: 128e3
    });
  } catch {
    throw new Error("CineGen’s bundled MCP server could not start. Reinstall the latest Mac build and try again.");
  }
}
function wn() {
  const t = bt(), e = Ti(t.config).config, r = Qa(e), n = it(t.source) && it(t.installed) && gr(t.source).equals(gr(t.installed));
  return {
    supported: process.platform === "darwin",
    configured: !!r,
    needsRepair: !!r && (!ju(r, Za()) || !n),
    serverAvailable: it(t.source),
    configPath: t.config
  };
}
function Ou() {
  I.handle("claude-mcp:status", () => wn()), I.handle("claude-mcp:setup", async () => {
    _n();
    const t = bt();
    if (Ti(t.config), !it(t.source)) throw new Error("This build is missing the MCP server. Install the latest CineGen Mac build.");
    await Pu(t.source), yi(Tt(W.getPath("userData"), "mcp"), { recursive: !0 }), _i(t.installed, gr(t.source), { mode: 384 });
    const e = ao(t.config, Za());
    return { ...wn(), ...e };
  }), I.handle("claude-mcp:remove", () => {
    _n();
    const t = ao(bt().config, null);
    return { ...wn(), ...t };
  }), I.handle("claude-mcp:reveal", () => {
    if (_n(), !it(bt().config)) throw new Error("Connect Claude Desktop first to create its configuration.");
    Jr.showItemInFolder(bt().config);
  });
}
const Nu = 1200, Cu = 150, qu = 1e3, so = 2800, es = /* @__PURE__ */ new WeakMap(), ts = /* @__PURE__ */ new WeakMap(), Dr = /* @__PURE__ */ new WeakMap(), rs = /* @__PURE__ */ new WeakMap();
function Lu() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    ...t.map((r) => w.resolve(process.cwd(), "build", r)),
    ...t.map((r) => w.resolve(import.meta.dirname, "../build", r))
  ];
  for (const r of e)
    if (D.existsSync(r)) return r;
}
const jt = Lu(), Kr = w.join(import.meta.dirname, "."), ns = w.join(Kr, "../dist"), wr = process.env.VITE_DEV_SERVER_URL;
function lo(t) {
  return wr ? t.loadURL(`${wr}?pm=1`) : t.loadFile(w.join(ns, "index.html"), { query: { pm: "1" } });
}
function uo(t) {
  return wr ? t.loadURL(wr) : t.loadFile(w.join(ns, "index.html"));
}
function bn(t, e) {
  const r = Dr.get(t) ?? /* @__PURE__ */ new Set();
  r.add(e), Dr.set(t, r);
}
function xr(t, e) {
  var r;
  (r = Dr.get(t)) == null || r.delete(e);
}
function is(t) {
  const e = Dr.get(t);
  if (e) {
    for (const r of e)
      clearTimeout(r);
    e.clear();
  }
}
function Uu(t) {
  return new Promise((e, r) => {
    let n = !1;
    const i = () => {
      t.webContents.removeListener("did-finish-load", o), t.webContents.removeListener("did-fail-load", a);
    }, o = () => {
      n || (n = !0, i(), e());
    }, a = (s, l, u, d, c) => {
      n || !c || l === -3 || (n = !0, i(), r(new Error(`did-fail-load ${l}: ${u}`)));
    };
    t.webContents.on("did-finish-load", o), t.webContents.on("did-fail-load", a), t.webContents.reloadIgnoringCache();
  });
}
async function zn(t, e, r, n) {
  if (t.isDestroyed()) return;
  if (console.warn(`[window] ${e} reloading after wake: ${n}`), t.webContents.getURL()) {
    await Uu(t);
    return;
  }
  await r(t);
}
async function Mu(t, e, r) {
  if (!t.isDestroyed())
    try {
      const n = await t.webContents.executeJavaScript(
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
        !0
      );
      if (!(!(n != null && n.hasRoot) && (n == null ? void 0 : n.bodyChildren) === 0 && (n == null ? void 0 : n.bodyTextLength) === 0)) return;
      await zn(t, e, r, "blank renderer DOM after resume");
    } catch (n) {
      console.warn(`[window] ${e} health check failed after wake:`, n), await zn(t, e, r, "resume health check failed");
    }
}
function Du(t) {
  for (const e of Q.getAllWindows()) {
    if (e.isDestroyed()) continue;
    const r = es.get(e);
    if (!r) continue;
    const n = ts.get(e) ?? "window";
    is(e), rs.set(e, Date.now() + so + 1e3);
    let i = null;
    const o = setTimeout(() => {
      xr(e, o), !e.isDestroyed() && (console.log(`[window] ${n} wake recovery started: ${t}`), e.webContents.invalidate(), e.webContents.executeJavaScript(
        `(() => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
        !0
      ).catch(() => {
      }), e.isVisible() && (e.show(), e.focus()));
    }, Cu);
    bn(e, o);
    const a = setTimeout(() => {
      xr(e, a), (async () => {
        try {
          await Mu(e, n, r), i && (clearTimeout(i), xr(e, i), i = null);
        } catch (s) {
          console.warn(`[window] ${n} resume health check threw:`, s);
        }
      })();
    }, qu);
    bn(e, a), i = setTimeout(() => {
      xr(e, i), !e.isDestroyed() && zn(e, n, r, `hard reload after ${t}`).catch((s) => {
        console.error(`[window] ${n} hard reload failed:`, s);
      });
    }, so), bn(e, i);
  }
}
function os(t, e, r) {
  let n = null;
  es.set(t, r), ts.set(t, e);
  const i = (o) => {
    if (t.isDestroyed() || n) return;
    const a = rs.get(t) ?? 0;
    if (o === "window became unresponsive" && Date.now() < a) {
      console.warn(`[window] ${e} suppressing reload during wake recovery: ${o}`);
      return;
    }
    console.warn(`[window] ${e} scheduling reload: ${o}`), n = setTimeout(() => {
      n = null, !t.isDestroyed() && r(t).catch((s) => {
        console.error(`[window] ${e} reload failed:`, s);
      });
    }, Nu);
  };
  t.on("unresponsive", () => {
    i("window became unresponsive");
  }), t.on("closed", () => {
    n && (clearTimeout(n), n = null), is(t);
  }), t.webContents.on("render-process-gone", (o, a) => {
    i(`render process gone (${a.reason})`);
  }), t.webContents.on("did-fail-load", (o, a, s, l, u) => {
    !u || a === -3 || i(`did-fail-load ${a}: ${s}`);
  });
}
function vn() {
  const { width: t, height: e } = Ga.getPrimaryDisplay().workAreaSize, r = 900, n = 580, i = new Q({
    width: r,
    height: n,
    x: Math.round((t - r) / 2),
    y: Math.round((e - n) / 2),
    frame: !1,
    resizable: !1,
    transparent: !0,
    hasShadow: !0,
    alwaysOnTop: !1,
    skipTaskbar: !1,
    ...jt ? { icon: jt } : {},
    webPreferences: {
      preload: w.join(Kr, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return os(i, "project-manager", lo), lo(i), i;
}
function $u() {
  const { width: t, height: e } = Ga.getPrimaryDisplay().workAreaSize, r = 800, n = 395, i = new Q({
    width: r,
    height: n,
    x: Math.round((t - r) / 2),
    y: Math.round((e - n) / 2),
    frame: !1,
    resizable: !1,
    transparent: !0,
    hasShadow: !1,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    ...jt ? { icon: jt } : {},
    webPreferences: {
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return i.loadFile(w.join(Kr, "splash.html")), i;
}
function co() {
  const t = new Q({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: !1,
    backgroundColor: "#08090c",
    titleBarStyle: "hiddenInset",
    ...jt ? { icon: jt } : {},
    webPreferences: {
      preload: w.join(Kr, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return os(t, "main", uo), uo(t), wr && t.webContents.openDevTools({ mode: "detach" }), t;
}
function Ei() {
  return w.join(z.homedir(), "Documents", "CINEGEN");
}
function Wn() {
  return w.join(Ei(), "projects.json");
}
function br(t) {
  return w.join(Ei(), t);
}
function dt(t) {
  return w.join(br(t), "project.json");
}
function as() {
  return J.randomUUID();
}
function ss() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function ls() {
  await j.mkdir(Ei(), { recursive: !0 });
}
async function Ar() {
  try {
    const t = await j.readFile(Wn(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function Tn(t) {
  await ls();
  const e = Wn() + ".tmp";
  await j.writeFile(e, JSON.stringify(t, null, 2), "utf-8"), await j.rename(e, Wn());
}
function Fu(t, e) {
  const r = ss(), n = {
    id: as(),
    name: "Space 1",
    createdAt: r,
    nodes: [],
    edges: []
  };
  return {
    project: { id: t, name: e, createdAt: r, updatedAt: r },
    workflow: { nodes: [], edges: [] },
    spaces: [n],
    activeSpaceId: n.id,
    openSpaceIds: [n.id],
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
      generateAudio: !0,
      genre: "auto",
      mode: "source",
      breakdown: [],
      breakdownApproved: !1,
      scenes: [],
      clips: [],
      jobStatus: null
    }
  };
}
function Bu(t) {
  const e = w.join(br(t), "project.json");
  if (!D.existsSync(e)) return null;
  try {
    const r = D.readFileSync(e, "utf-8"), i = (JSON.parse(r).assets ?? []).find(
      (o) => (o.type === "video" || o.type === "image") && o.thumbnailUrl
    );
    return (i == null ? void 0 : i.thumbnailUrl) ?? null;
  } catch {
    return null;
  }
}
function Vu(t) {
  const e = w.join(br(t), "project.db");
  if (!D.existsSync(e)) return null;
  try {
    const r = new wi(e, { readonly: !0 }), n = r.prepare(
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
    ).get(t);
    if (n != null && n.thumbnail_url)
      return r.close(), `file://${n.thumbnail_url}`;
    const i = r.prepare(
      `SELECT thumbnail_url FROM assets
       WHERE project_id = ?
         AND type IN ('video', 'image')
         AND thumbnail_url IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`
    ).get(t);
    return r.close(), i != null && i.thumbnail_url ? `file://${i.thumbnail_url}` : null;
  } catch {
    return null;
  }
}
function Gu() {
  I.handle("project:list", async () => (await Ar()).projects.map((e) => {
    const r = e.useSqlite ? Vu(e.id) : Bu(e.id);
    return { ...e, thumbnail: r };
  })), I.handle("project:create", async (t, e) => {
    const r = e.trim();
    if (!r || r.length > 100)
      throw new Error("Project name must be 1-100 characters");
    const n = as(), i = Fu(n, r);
    await ls(), await j.mkdir(br(n), { recursive: !0 });
    const o = dt(n) + ".tmp";
    await j.writeFile(o, JSON.stringify(i, null, 2), "utf-8"), await j.rename(o, dt(n));
    const a = await Ar();
    return a.projects.unshift({
      id: n,
      name: r,
      createdAt: i.project.createdAt,
      updatedAt: i.project.updatedAt,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null
    }), await Tn(a), i;
  }), I.handle("project:load", async (t, e) => {
    const r = await j.readFile(dt(e), "utf-8");
    return JSON.parse(r);
  }), I.handle("project:save", async (t, e, r) => {
    let n;
    try {
      const l = await j.readFile(dt(e), "utf-8");
      n = JSON.parse(l);
    } catch {
      throw new Error(`Project ${e} not found`);
    }
    const i = {
      ...n,
      ...r,
      project: {
        ...n.project,
        ...r.project ?? {},
        updatedAt: ss()
      }
    }, o = dt(e) + ".tmp";
    await j.writeFile(o, JSON.stringify(i, null, 2), "utf-8"), await j.rename(o, dt(e));
    const a = await Ar(), s = a.projects.find((l) => l.id === e);
    return s && (s.updatedAt = i.project.updatedAt, s.assetCount = Array.isArray(i.assets) ? i.assets.length : 0, s.elementCount = Array.isArray(i.elements) ? i.elements.length : 0, r.project && r.project.name && (s.name = r.project.name), await Tn(a)), i;
  }), I.handle("project:delete", async (t, e) => {
    await j.rm(br(e), { recursive: !0, force: !0 });
    const r = await Ar();
    r.projects = r.projects.filter((n) => n.id !== e), await Tn(r);
  });
}
const fo = 12e4, us = Tt(Xa(), "Documents", "CINEGEN"), Xn = Tt(us, "mcp-bridge.json"), Rt = /* @__PURE__ */ new Map();
let Nr = !1, he = null, kr = "";
function Re(t, e, r) {
  const n = JSON.stringify(r);
  t.writeHead(e, { "content-type": "application/json", "content-length": Buffer.byteLength(n) }), t.end(n);
}
async function Hu(t) {
  const e = [];
  let r = 0;
  for await (const n of t) {
    if (r += n.length, r > 4e6) throw new Error("Request body is too large.");
    e.push(n);
  }
  return e.length === 0 ? {} : JSON.parse(Buffer.concat(e).toString("utf8"));
}
function zu(t, e, r) {
  return new Promise((n, i) => {
    const o = yr(), a = setTimeout(() => {
      Rt.delete(o), i(new Error(`CineGen did not answer "${e}" within ${Math.round(fo / 1e3)}s.`));
    }, fo);
    Rt.set(o, { resolve: n, reject: i, timer: a }), t.webContents.send("mcp:invoke", { id: o, tool: e, args: r });
  });
}
function Wu(t) {
  I.on("mcp:ready", (e, r) => {
    Nr = !!r;
  }), I.on("mcp:result", (e, r) => {
    const n = r != null && r.id ? Rt.get(r.id) : void 0;
    n && (clearTimeout(n.timer), Rt.delete(r.id), r.ok ? n.resolve(r.result) : n.reject(new Error(r.error || "The tool failed.")));
  }), I.handle("mcp:status", () => {
    var e;
    return {
      running: !!he,
      workspaceReady: Nr,
      port: he ? ((e = he.address()) == null ? void 0 : e.port) ?? 0 : 0,
      discoveryFile: Xn
    };
  }), kr = Eu(24).toString("hex"), he = Ja((e, r) => {
    (async () => {
      try {
        const n = new URL(e.url ?? "/", "http://127.0.0.1");
        if (e.method === "GET" && n.pathname === "/health") {
          Re(r, 200, { ok: !0, app: "CineGen", appReady: !!t() });
          return;
        }
        const i = (e.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        if (i.length !== kr.length || i !== kr) {
          Re(r, 401, { ok: !1, error: "Bad or missing bridge token." });
          return;
        }
        if (e.method === "POST" && n.pathname === "/invoke") {
          const o = await Hu(e), a = typeof (o == null ? void 0 : o.tool) == "string" ? o.tool : "";
          if (!a) {
            Re(r, 400, { ok: !1, error: "No tool named." });
            return;
          }
          const s = t();
          if (!s || s.isDestroyed()) {
            Re(r, 503, { ok: !1, error: "CineGen has no open window. Open the app and try again." });
            return;
          }
          if (!Nr && a !== "cinegen_project") {
            Re(r, 200, { ok: !1, error: "No CineGen project is open. Open a project in the app, then try again." });
            return;
          }
          try {
            Re(r, 200, { ok: !0, result: await zu(s, a, o.args ?? {}) });
          } catch (l) {
            Re(r, 200, { ok: !1, error: l instanceof Error ? l.message : String(l) });
          }
          return;
        }
        Re(r, 404, { ok: !1, error: "Unknown path." });
      } catch (n) {
        Re(r, 400, { ok: !1, error: n instanceof Error ? n.message : String(n) });
      }
    })();
  }), he.listen(0, "127.0.0.1", () => {
    var r;
    const e = ((r = he == null ? void 0 : he.address()) == null ? void 0 : r.port) ?? 0;
    try {
      yi(us, { recursive: !0 }), _i(
        Xn,
        `${JSON.stringify({ port: e, token: kr, pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)}
`,
        { mode: 384 }
      ), console.log(`[mcp-bridge] listening on 127.0.0.1:${e}`);
    } catch (n) {
      console.error("[mcp-bridge] could not publish the discovery file:", n);
    }
  }), he.on("error", (e) => {
    console.error("[mcp-bridge] server error:", e);
  });
}
function Xu() {
  Nr = !1;
  for (const t of Rt.values())
    clearTimeout(t.timer), t.reject(new Error("CineGen is closing."));
  Rt.clear(), he == null || he.close(), he = null;
  try {
    Wa(Xn, { force: !0 });
  } catch {
  }
}
function Ju(t) {
  if (Object.prototype.hasOwnProperty.call(t, "__esModule")) return t;
  var e = t.default;
  if (typeof e == "function") {
    var r = function n() {
      return this instanceof n ? Reflect.construct(e, arguments, this.constructor) : e.apply(this, arguments);
    };
    r.prototype = e.prototype;
  } else r = {};
  return Object.defineProperty(r, "__esModule", { value: !0 }), Object.keys(t).forEach(function(n) {
    var i = Object.getOwnPropertyDescriptor(t, n);
    Object.defineProperty(r, n, i.get ? i : {
      enumerable: !0,
      get: function() {
        return t[n];
      }
    });
  }), r;
}
var et = {}, ct = {}, En = {}, Gt = {}, po;
function ds() {
  return po || (po = 1, (function(t) {
    var e = Gt && Gt.__awaiter || function(i, o, a, s) {
      function l(u) {
        return u instanceof a ? u : new a(function(d) {
          d(u);
        });
      }
      return new (a || (a = Promise))(function(u, d) {
        function c(m) {
          try {
            f(s.next(m));
          } catch (y) {
            d(y);
          }
        }
        function p(m) {
          try {
            f(s.throw(m));
          } catch (y) {
            d(y);
          }
        }
        function f(m) {
          m.done ? u(m.value) : l(m.value).then(c, p);
        }
        f((s = s.apply(i, o || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.TARGET_URL_HEADER = void 0, t.withMiddleware = r, t.withProxy = n;
    function r(...i) {
      const o = (a) => typeof a == "function";
      return (a) => e(this, void 0, void 0, function* () {
        let s = Object.assign({}, a);
        for (const l of i.filter(o))
          s = yield l(s);
        return s;
      });
    }
    t.TARGET_URL_HEADER = "x-fal-target-url";
    function n(i) {
      const o = (a) => Promise.resolve(a);
      return typeof window > "u" ? o : (a) => a.headers && t.TARGET_URL_HEADER in a ? o(a) : Promise.resolve(Object.assign(Object.assign({}, a), { url: i.targetUrl, headers: Object.assign(Object.assign({}, a.headers || {}), { [t.TARGET_URL_HEADER]: a.url }) }));
    }
  })(Gt)), Gt;
}
var Ee = {}, Sn = {}, mo;
function Si() {
  return mo || (mo = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.RUNNER_HINT_HEADER = t.QUEUE_PRIORITY_HEADER = t.REQUEST_TIMEOUT_TYPE_HEADER = t.REQUEST_TIMEOUT_HEADER = t.MIN_REQUEST_TIMEOUT_SECONDS = void 0, t.validateTimeoutHeader = e, t.buildTimeoutHeaders = r, t.MIN_REQUEST_TIMEOUT_SECONDS = 1, t.REQUEST_TIMEOUT_HEADER = "x-fal-request-timeout", t.REQUEST_TIMEOUT_TYPE_HEADER = "x-fal-request-timeout-type", t.QUEUE_PRIORITY_HEADER = "x-fal-queue-priority", t.RUNNER_HINT_HEADER = "x-fal-runner-hint";
    function e(n) {
      if (typeof n != "number" || isNaN(n))
        throw new Error(`Timeout must be a number, got ${n}`);
      if (n <= t.MIN_REQUEST_TIMEOUT_SECONDS)
        throw new Error(`Timeout must be greater than ${t.MIN_REQUEST_TIMEOUT_SECONDS} seconds`);
      return n.toString();
    }
    function r(n) {
      return n === void 0 ? {} : {
        [t.REQUEST_TIMEOUT_HEADER]: e(n)
      };
    }
  })(Sn)), Sn;
}
var ho;
function lt() {
  if (ho) return Ee;
  ho = 1;
  var t = Ee && Ee.__awaiter || function(s, l, u, d) {
    function c(p) {
      return p instanceof u ? p : new u(function(f) {
        f(p);
      });
    }
    return new (u || (u = Promise))(function(p, f) {
      function m(g) {
        try {
          h(d.next(g));
        } catch (_) {
          f(_);
        }
      }
      function y(g) {
        try {
          h(d.throw(g));
        } catch (_) {
          f(_);
        }
      }
      function h(g) {
        g.done ? p(g.value) : c(g.value).then(m, y);
      }
      h((d = d.apply(s, l || [])).next());
    });
  };
  Object.defineProperty(Ee, "__esModule", { value: !0 }), Ee.ValidationError = Ee.ApiError = void 0, Ee.defaultResponseHandler = o, Ee.resultResponseHandler = a;
  const e = Si(), r = "x-fal-request-id";
  class n extends Error {
    constructor({ message: l, status: u, body: d, requestId: c, timeoutType: p }) {
      super(l), this.name = "ApiError", this.status = u, this.body = d, this.requestId = c || "", this.timeoutType = p;
    }
    /**
     * Returns true if this error was caused by a user-specified timeout
     * (via startTimeout parameter). These errors should NOT be retried.
     */
    get isUserTimeout() {
      return this.status === 504 && this.timeoutType === "user";
    }
  }
  Ee.ApiError = n;
  class i extends n {
    constructor(l) {
      super(l), this.name = "ValidationError";
    }
    get fieldErrors() {
      return typeof this.body.detail == "string" ? [
        {
          loc: ["body"],
          msg: this.body.detail,
          type: "value_error"
        }
      ] : this.body.detail || [];
    }
    getFieldErrors(l) {
      return this.fieldErrors.filter((u) => u.loc[u.loc.length - 1] === l);
    }
  }
  Ee.ValidationError = i;
  function o(s) {
    return t(this, void 0, void 0, function* () {
      var l;
      const { status: u, statusText: d } = s, c = (l = s.headers.get("Content-Type")) !== null && l !== void 0 ? l : "", p = s.headers.get(r) || void 0, f = s.headers.get(e.REQUEST_TIMEOUT_TYPE_HEADER) || void 0;
      if (!s.ok) {
        if (c.includes("application/json")) {
          const m = yield s.json(), y = u === 422 ? i : n;
          throw new y({
            message: m.message || d,
            status: u,
            body: m,
            requestId: p,
            timeoutType: f
          });
        }
        throw new n({
          message: `HTTP ${u}: ${d}`,
          status: u,
          requestId: p,
          timeoutType: f
        });
      }
      return c.includes("application/json") ? s.json() : c.includes("text/html") ? s.text() : c.includes("application/octet-stream") ? s.arrayBuffer() : s.text();
    });
  }
  function a(s) {
    return t(this, void 0, void 0, function* () {
      return {
        data: yield o(s),
        requestId: s.headers.get(r) || ""
      };
    });
  }
  return Ee;
}
var Ht = {}, pe = {}, go;
function Je() {
  if (go) return pe;
  go = 1;
  var t = pe && pe.__awaiter || function(c, p, f, m) {
    function y(h) {
      return h instanceof f ? h : new f(function(g) {
        g(h);
      });
    }
    return new (f || (f = Promise))(function(h, g) {
      function _(T) {
        try {
          v(m.next(T));
        } catch (E) {
          g(E);
        }
      }
      function b(T) {
        try {
          v(m.throw(T));
        } catch (E) {
          g(E);
        }
      }
      function v(T) {
        T.done ? h(T.value) : y(T.value).then(_, b);
      }
      v((m = m.apply(c, p || [])).next());
    });
  };
  Object.defineProperty(pe, "__esModule", { value: !0 }), pe.ensureEndpointIdFormat = e, pe.parseEndpointId = n, pe.resolveEndpointPath = i, pe.isValidUrl = o, pe.throttle = a, pe.isReact = l, pe.isPlainObject = u, pe.sleep = d;
  function e(c) {
    if (c.split("/").length > 1)
      return c;
    const [, f, m] = /^([0-9]+)-([a-zA-Z0-9-]+)$/.exec(c) || [];
    if (f && m)
      return `${f}/${m}`;
    throw new Error(`Invalid app id: ${c}. Must be in the format <appOwner>/<appId>`);
  }
  const r = ["workflows", "comfy"];
  function n(c) {
    const f = e(c).split("/");
    return r.includes(f[0]) ? {
      owner: f[1],
      alias: f[2],
      path: f.slice(3).join("/") || void 0,
      namespace: f[0]
    } : {
      owner: f[0],
      alias: f[1],
      path: f.slice(2).join("/") || void 0
    };
  }
  function i(c, p, f) {
    if (p)
      return `/${p.replace(/^\/+/, "")}`;
    if (!c.endsWith(f))
      return f;
  }
  function o(c) {
    try {
      const { host: p } = new URL(c);
      return /(fal\.(ai|run))$/.test(p);
    } catch {
      return !1;
    }
  }
  function a(c, p, f = !1) {
    let m, y;
    return (...h) => {
      !y && f ? (c(...h), y = Date.now()) : (m && clearTimeout(m), m = setTimeout(() => {
        Date.now() - y >= p && (c(...h), y = Date.now());
      }, p - (Date.now() - y)));
    };
  }
  let s;
  function l() {
    if (s === void 0) {
      const c = new Error().stack;
      s = !!c && (c.includes("node_modules/react-dom/") || c.includes("node_modules/next/"));
    }
    return s;
  }
  function u(c) {
    return !!c && Object.getPrototypeOf(c) === Object.prototype;
  }
  function d(c) {
    return t(this, void 0, void 0, function* () {
      return new Promise((p) => setTimeout(p, c));
    });
  }
  return pe;
}
var yo;
function Yr() {
  return yo || (yo = 1, (function(t) {
    var e = Ht && Ht.__awaiter || function(s, l, u, d) {
      function c(p) {
        return p instanceof u ? p : new u(function(f) {
          f(p);
        });
      }
      return new (u || (u = Promise))(function(p, f) {
        function m(g) {
          try {
            h(d.next(g));
          } catch (_) {
            f(_);
          }
        }
        function y(g) {
          try {
            h(d.throw(g));
          } catch (_) {
            f(_);
          }
        }
        function h(g) {
          g.done ? p(g.value) : c(g.value).then(m, y);
        }
        h((d = d.apply(s, l || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.DEFAULT_RETRY_OPTIONS = t.DEFAULT_RETRYABLE_STATUS_CODES = void 0, t.isRetryableError = i, t.calculateBackoffDelay = o, t.executeWithRetry = a;
    const r = lt(), n = Je();
    t.DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504], t.DEFAULT_RETRY_OPTIONS = {
      maxRetries: 3,
      baseDelay: 1e3,
      maxDelay: 3e4,
      backoffMultiplier: 2,
      retryableStatusCodes: t.DEFAULT_RETRYABLE_STATUS_CODES,
      enableJitter: !0
    };
    function i(s, l) {
      return !(s instanceof r.ApiError) || s.isUserTimeout ? !1 : l.includes(s.status);
    }
    function o(s, l, u, d, c) {
      const p = Math.min(l * Math.pow(d, s), u);
      if (c) {
        const f = 0.25 * p * (Math.random() * 2 - 1);
        return Math.max(0, p + f);
      }
      return p;
    }
    function a(s, l, u) {
      return e(this, void 0, void 0, function* () {
        const d = {
          totalAttempts: 0,
          totalDelay: 0
        };
        let c;
        for (let p = 0; p <= l.maxRetries; p++) {
          d.totalAttempts++;
          try {
            return { result: yield s(), metrics: d };
          } catch (f) {
            if (c = f, d.lastError = f, p === l.maxRetries || !i(f, l.retryableStatusCodes))
              throw f;
            const m = o(p, l.baseDelay, l.maxDelay, l.backoffMultiplier, l.enableJitter);
            d.totalDelay += m, u && u(p + 1, f, m), yield (0, n.sleep)(m);
          }
        }
        throw c;
      });
    }
  })(Ht)), Ht;
}
var zt = {};
const Ku = "@fal-ai/client", Yu = "1.9.4", Qu = {
  name: Ku,
  version: Yu
};
var _o;
function Ii() {
  if (_o) return zt;
  _o = 1, Object.defineProperty(zt, "__esModule", { value: !0 }), zt.isBrowser = t, zt.getUserAgent = r;
  function t() {
    return typeof window < "u" && typeof window.document < "u";
  }
  let e = null;
  function r() {
    if (e !== null)
      return e;
    const n = Qu;
    return e = `${n.name}/${n.version}`, e;
  }
  return zt;
}
var wo;
function xi() {
  return wo || (wo = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.credentialsFromEnv = void 0, t.resolveDefaultFetch = o, t.createConfig = u, t.getRestApiUrl = d;
    const e = ds(), r = lt(), n = Yr(), i = Ii();
    function o() {
      if (typeof fetch > "u")
        throw new Error("Your environment does not support fetch. Please provide your own fetch implementation.");
      return fetch;
    }
    function a() {
      return typeof process < "u" && process.env && (typeof process.env.FAL_KEY < "u" || typeof process.env.FAL_KEY_ID < "u" && typeof process.env.FAL_KEY_SECRET < "u");
    }
    const s = () => {
      if (a())
        return typeof process.env.FAL_KEY < "u" ? process.env.FAL_KEY : process.env.FAL_KEY_ID ? `${process.env.FAL_KEY_ID}:${process.env.FAL_KEY_SECRET}` : void 0;
    };
    t.credentialsFromEnv = s;
    const l = {
      credentials: t.credentialsFromEnv,
      suppressLocalCredentialsWarning: !1,
      requestMiddleware: (c) => Promise.resolve(c),
      responseHandler: r.defaultResponseHandler,
      retry: n.DEFAULT_RETRY_OPTIONS
    };
    function u(c) {
      var p;
      let f = Object.assign(Object.assign(Object.assign({}, l), c), {
        fetch: (p = c.fetch) !== null && p !== void 0 ? p : o(),
        // Merge retry configuration with defaults
        retry: Object.assign(Object.assign({}, n.DEFAULT_RETRY_OPTIONS), c.retry || {})
      });
      c.proxyUrl && (f = Object.assign(Object.assign({}, f), { requestMiddleware: (0, e.withMiddleware)(f.requestMiddleware, (0, e.withProxy)({ targetUrl: c.proxyUrl })) }));
      const { credentials: m, suppressLocalCredentialsWarning: y } = f, h = typeof m == "function" ? m() : m;
      return (0, i.isBrowser)() && h && !y && console.warn("The fal credentials are exposed in the browser's environment. That's not recommended for production use cases."), f;
    }
    function d() {
      return "https://rest.fal.ai";
    }
  })(En)), En;
}
var Pe = {}, Oe = {}, bo;
function Tr() {
  if (bo) return Oe;
  bo = 1;
  var t = Oe && Oe.__awaiter || function(l, u, d, c) {
    function p(f) {
      return f instanceof d ? f : new d(function(m) {
        m(f);
      });
    }
    return new (d || (d = Promise))(function(f, m) {
      function y(_) {
        try {
          g(c.next(_));
        } catch (b) {
          m(b);
        }
      }
      function h(_) {
        try {
          g(c.throw(_));
        } catch (b) {
          m(b);
        }
      }
      function g(_) {
        _.done ? f(_.value) : p(_.value).then(y, h);
      }
      g((c = c.apply(l, u || [])).next());
    });
  }, e = Oe && Oe.__rest || function(l, u) {
    var d = {};
    for (var c in l) Object.prototype.hasOwnProperty.call(l, c) && u.indexOf(c) < 0 && (d[c] = l[c]);
    if (l != null && typeof Object.getOwnPropertySymbols == "function")
      for (var p = 0, c = Object.getOwnPropertySymbols(l); p < c.length; p++)
        u.indexOf(c[p]) < 0 && Object.prototype.propertyIsEnumerable.call(l, c[p]) && (d[c[p]] = l[c[p]]);
    return d;
  };
  Object.defineProperty(Oe, "__esModule", { value: !0 }), Oe.dispatchRequest = a, Oe.buildUrl = s;
  const r = Yr(), n = Ii(), i = Je(), o = typeof navigator < "u" && (navigator == null ? void 0 : navigator.userAgent) === "Cloudflare-Workers";
  function a(l) {
    return t(this, void 0, void 0, function* () {
      var u;
      const { targetUrl: d, input: c, config: p, options: f = {} } = l, { credentials: m, requestMiddleware: y, responseHandler: h, fetch: g } = p, _ = Object.assign(Object.assign({}, p.retry), f.retry || {}), b = () => t(this, void 0, void 0, function* () {
        var T, E, x;
        const S = (0, n.isBrowser)() ? {} : { "User-Agent": (0, n.getUserAgent)() }, A = typeof m == "function" ? m() : m, { method: O, url: C, headers: L } = yield y({
          method: ((E = (T = l.method) !== null && T !== void 0 ? T : f.method) !== null && E !== void 0 ? E : "post").toUpperCase(),
          url: d,
          headers: l.headers
        }), V = A ? { Authorization: `Key ${A}` } : {}, H = Object.assign(Object.assign(Object.assign(Object.assign({}, V), { Accept: "application/json", "Content-Type": "application/json" }), S), L ?? {}), { responseHandler: B, retry: R } = f, N = e(f, ["responseHandler", "retry"]), G = yield g(C, Object.assign(Object.assign(Object.assign(Object.assign({}, N), { method: O, headers: Object.assign(Object.assign({}, H), (x = N.headers) !== null && x !== void 0 ? x : {}) }), !o && { mode: "cors" }), { signal: f.signal, body: O.toLowerCase() !== "get" && c ? JSON.stringify(c) : void 0 }));
        return yield (B ?? h)(G);
      });
      let v;
      for (let T = 0; T <= _.maxRetries; T++)
        try {
          return yield b();
        } catch (E) {
          if (v = E, T === _.maxRetries || !(0, r.isRetryableError)(E, _.retryableStatusCodes) || ((u = f.signal) === null || u === void 0 ? void 0 : u.aborted))
            throw E;
          const S = (0, r.calculateBackoffDelay)(T, _.baseDelay, _.maxDelay, _.backoffMultiplier, _.enableJitter);
          yield (0, i.sleep)(S);
        }
      throw v;
    });
  }
  function s(l, u = {}) {
    var d, c;
    const p = ((d = u.method) !== null && d !== void 0 ? d : "post").toLowerCase(), f = ((c = u.path) !== null && c !== void 0 ? c : "").replace(/^\//, "").replace(/\/{2,}/, "/"), m = u.input, y = Object.assign(Object.assign({}, u.query || {}), p === "get" ? m : {}), h = Object.keys(y).length > 0 ? `?${new URLSearchParams(y).toString()}` : "";
    if ((0, i.isValidUrl)(l))
      return `${l.endsWith("/") ? l : `${l}/`}${f}${h}`;
    const g = (0, i.ensureEndpointIdFormat)(l);
    return `${`https://${u.subdomain ? `${u.subdomain}.` : ""}fal.run/${g}/${f}`.replace(/\/$/, "")}${h}`;
  }
  return Oe;
}
var Wt = {}, vo;
function cs() {
  return vo || (vo = 1, (function(t) {
    var e = Wt && Wt.__awaiter || function(m, y, h, g) {
      function _(b) {
        return b instanceof h ? b : new h(function(v) {
          v(b);
        });
      }
      return new (h || (h = Promise))(function(b, v) {
        function T(S) {
          try {
            x(g.next(S));
          } catch (A) {
            v(A);
          }
        }
        function E(S) {
          try {
            x(g.throw(S));
          } catch (A) {
            v(A);
          }
        }
        function x(S) {
          S.done ? b(S.value) : _(S.value).then(T, E);
        }
        x((g = g.apply(m, y || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = void 0, t.getExpirationDurationSeconds = a, t.buildObjectLifecycleHeaders = s, t.createStorageClient = f;
    const r = xi(), n = Tr(), i = Je();
    t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = "x-fal-object-lifecycle-preference";
    const o = {
      never: 31536e5,
      // 100 years
      immediate: void 0,
      "1h": 3600,
      "1d": 86400,
      "7d": 604800,
      "30d": 2592e3,
      "1y": 31536e3
    };
    function a(m) {
      const { expiresIn: y } = m;
      return typeof y == "number" ? y : o[y];
    }
    function s(m) {
      if (!m)
        return {};
      const y = a(m);
      return y === void 0 ? {} : {
        [t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER]: JSON.stringify({
          expiration_duration_seconds: y
        })
      };
    }
    function l(m) {
      var y;
      const [, h] = m.split("/");
      return (y = h.split(/[-;]/)[0]) !== null && y !== void 0 ? y : "bin";
    }
    function u(m, y, h, g) {
      return e(this, void 0, void 0, function* () {
        const _ = m.name || `${Date.now()}.${l(h)}`, b = {};
        if (g) {
          const v = {
            expiration_duration_seconds: a(g),
            allow_io_storage: g.expiresIn !== "immediate"
          };
          b["X-Fal-Object-Lifecycle"] = JSON.stringify(v);
        }
        return yield (0, n.dispatchRequest)({
          method: "POST",
          // NOTE: We want to test V3 without making it the default at the API level
          targetUrl: `${(0, r.getRestApiUrl)()}/storage/upload/initiate?storage_type=fal-cdn-v3`,
          input: {
            content_type: h,
            file_name: _
          },
          config: y,
          headers: b
        });
      });
    }
    function d(m, y, h, g) {
      return e(this, void 0, void 0, function* () {
        const _ = m.name || `${Date.now()}.${l(h)}`, b = {};
        return g && (b["X-Fal-Object-Lifecycle"] = JSON.stringify(g)), yield (0, n.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, r.getRestApiUrl)()}/storage/upload/initiate-multipart?storage_type=fal-cdn-v3`,
          input: {
            content_type: h,
            file_name: _
          },
          config: y,
          headers: b
        });
      });
    }
    function c(m, y, h) {
      return e(this, arguments, void 0, function* (g, _, b, v = 3) {
        if (v === 0)
          throw new Error("Part upload failed, retries exhausted");
        const { fetch: T, responseHandler: E } = b;
        try {
          const x = yield T(g, {
            method: "PUT",
            body: _
          });
          return yield E(x);
        } catch {
          return yield c(g, _, b, v - 1);
        }
      });
    }
    function p(m, y, h) {
      return e(this, void 0, void 0, function* () {
        const { fetch: g, responseHandler: _ } = y, b = m.type || "application/octet-stream", { upload_url: v, file_url: T } = yield d(m, y, b, h), E = 10 * 1024 * 1024, x = Math.ceil(m.size / E), S = new URL(v), A = [];
        for (let L = 0; L < x; L++) {
          const V = L * E, H = Math.min(V + E, m.size), B = m.slice(V, H), R = L + 1, N = `${S.origin}${S.pathname}/${R}${S.search}`;
          A.push(yield c(N, B, y));
        }
        const O = `${S.origin}${S.pathname}/complete${S.search}`, C = yield g(O, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parts: A.map((L) => ({
              partNumber: L.partNumber,
              etag: L.etag
            }))
          })
        });
        return yield _(C), T;
      });
    }
    function f({ config: m }) {
      const y = {
        upload: (h, g) => e(this, void 0, void 0, function* () {
          const _ = g == null ? void 0 : g.lifecycle;
          if (h.size > 94371840)
            return yield p(h, m, _);
          const b = h.type || "application/octet-stream", { fetch: v, responseHandler: T } = m, { upload_url: E, file_url: x } = yield u(h, m, b, _), S = yield v(E, {
            method: "PUT",
            body: h,
            headers: {
              "Content-Type": h.type || "application/octet-stream"
            }
          });
          return yield T(S), x;
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformInput: (h) => e(this, void 0, void 0, function* () {
          if (Array.isArray(h))
            return Promise.all(h.map((g) => y.transformInput(g)));
          if (h instanceof Blob)
            return yield y.upload(h);
          if ((0, i.isPlainObject)(h)) {
            const _ = Object.entries(h).map((v) => e(this, [v], void 0, function* ([T, E]) {
              return [T, yield y.transformInput(E)];
            })), b = yield Promise.all(_);
            return Object.fromEntries(b);
          }
          return h;
        })
      };
      return y;
    }
  })(Wt)), Wt;
}
var _e = {}, jr = {}, To;
function Zu() {
  if (To) return jr;
  To = 1, Object.defineProperty(jr, "__esModule", {
    value: !0
  });
  function t(n) {
    let i, o, a, s, l, u, d;
    return c(), {
      feed: p,
      reset: c
    };
    function c() {
      i = !0, o = "", a = 0, s = -1, l = void 0, u = void 0, d = "";
    }
    function p(m) {
      o = o ? o + m : m, i && r(o) && (o = o.slice(e.length)), i = !1;
      const y = o.length;
      let h = 0, g = !1;
      for (; h < y; ) {
        g && (o[h] === `
` && ++h, g = !1);
        let _ = -1, b = s, v;
        for (let T = a; _ < 0 && T < y; ++T)
          v = o[T], v === ":" && b < 0 ? b = T - h : v === "\r" ? (g = !0, _ = T - h) : v === `
` && (_ = T - h);
        if (_ < 0) {
          a = y - h, s = b;
          break;
        } else
          a = 0, s = -1;
        f(o, h, b, _), h += _ + 1;
      }
      h === y ? o = "" : h > 0 && (o = o.slice(h));
    }
    function f(m, y, h, g) {
      if (g === 0) {
        d.length > 0 && (n({
          type: "event",
          id: l,
          event: u || void 0,
          data: d.slice(0, -1)
          // remove trailing newline
        }), d = "", l = void 0), u = void 0;
        return;
      }
      const _ = h < 0, b = m.slice(y, y + (_ ? g : h));
      let v = 0;
      _ ? v = g : m[y + h + 1] === " " ? v = h + 2 : v = h + 1;
      const T = y + v, E = g - v, x = m.slice(T, T + E).toString();
      if (b === "data")
        d += x ? "".concat(x, `
`) : `
`;
      else if (b === "event")
        u = x;
      else if (b === "id" && !x.includes("\0"))
        l = x;
      else if (b === "retry") {
        const S = parseInt(x, 10);
        Number.isNaN(S) || n({
          type: "reconnect-interval",
          value: S
        });
      }
    }
  }
  const e = [239, 187, 191];
  function r(n) {
    return e.every((i, o) => n.charCodeAt(o) === i);
  }
  return jr.createParser = t, jr;
}
var Xt = {}, Eo;
function fs() {
  return Eo || (Eo = 1, (function(t) {
    var e = Xt && Xt.__awaiter || function(a, s, l, u) {
      function d(c) {
        return c instanceof l ? c : new l(function(p) {
          p(c);
        });
      }
      return new (l || (l = Promise))(function(c, p) {
        function f(h) {
          try {
            y(u.next(h));
          } catch (g) {
            p(g);
          }
        }
        function m(h) {
          try {
            y(u.throw(h));
          } catch (g) {
            p(g);
          }
        }
        function y(h) {
          h.done ? c(h.value) : d(h.value).then(f, m);
        }
        y((u = u.apply(a, s || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.TOKEN_EXPIRATION_SECONDS = void 0, t.getTemporaryAuthToken = o;
    const r = xi(), n = Tr(), i = Je();
    t.TOKEN_EXPIRATION_SECONDS = 120;
    function o(a, s) {
      return e(this, void 0, void 0, function* () {
        const l = (0, i.parseEndpointId)(a), u = yield (0, n.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, r.getRestApiUrl)()}/tokens/`,
          config: s,
          input: {
            allowed_apps: [l.alias],
            token_expiration: t.TOKEN_EXPIRATION_SECONDS
          }
        });
        return typeof u != "string" && u.detail ? u.detail : u;
      });
    }
  })(Xt)), Xt;
}
var So;
function ps() {
  if (So) return _e;
  So = 1;
  var t = _e && _e.__awaiter || function(p, f, m, y) {
    function h(g) {
      return g instanceof m ? g : new m(function(_) {
        _(g);
      });
    }
    return new (m || (m = Promise))(function(g, _) {
      function b(E) {
        try {
          T(y.next(E));
        } catch (x) {
          _(x);
        }
      }
      function v(E) {
        try {
          T(y.throw(E));
        } catch (x) {
          _(x);
        }
      }
      function T(E) {
        E.done ? g(E.value) : h(E.value).then(b, v);
      }
      T((y = y.apply(p, f || [])).next());
    });
  }, e = _e && _e.__await || function(p) {
    return this instanceof e ? (this.v = p, this) : new e(p);
  }, r = _e && _e.__asyncGenerator || function(p, f, m) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var y = m.apply(p, f || []), h, g = [];
    return h = {}, b("next"), b("throw"), b("return", _), h[Symbol.asyncIterator] = function() {
      return this;
    }, h;
    function _(A) {
      return function(O) {
        return Promise.resolve(O).then(A, x);
      };
    }
    function b(A, O) {
      y[A] && (h[A] = function(C) {
        return new Promise(function(L, V) {
          g.push([A, C, L, V]) > 1 || v(A, C);
        });
      }, O && (h[A] = O(h[A])));
    }
    function v(A, O) {
      try {
        T(y[A](O));
      } catch (C) {
        S(g[0][3], C);
      }
    }
    function T(A) {
      A.value instanceof e ? Promise.resolve(A.value.v).then(E, x) : S(g[0][2], A);
    }
    function E(A) {
      v("next", A);
    }
    function x(A) {
      v("throw", A);
    }
    function S(A, O) {
      A(O), g.shift(), g.length && v(g[0][0], g[0][1]);
    }
  };
  Object.defineProperty(_e, "__esModule", { value: !0 }), _e.FalStream = void 0, _e.createStreamingClient = c;
  const n = /* @__PURE__ */ Zu(), i = fs(), o = Tr(), a = lt(), s = Je(), l = "text/event-stream", u = 15 * 1e3;
  class d {
    constructor(f, m, y) {
      var h;
      this.listeners = /* @__PURE__ */ new Map(), this.buffer = [], this.currentData = void 0, this.lastEventTimestamp = 0, this.streamClosed = !1, this._requestId = null, this.abortController = new AbortController(), this.start = () => t(this, void 0, void 0, function* () {
        var g, _, b;
        const { endpointId: v, options: T } = this, { input: E, method: x = "post", connectionMode: S = "server", tokenProvider: A } = T;
        try {
          if (S === "client") {
            const O = (0, s.ensureEndpointIdFormat)(v), C = (g = (0, s.resolveEndpointPath)(v, void 0, "/stream")) !== null && g !== void 0 ? g : "", V = yield (A ? () => A(`${O}${C}`) : () => (console.warn('[fal.stream] Using the default token provider is deprecated. Please provide a `tokenProvider` function when using `connectionMode: "client"`. See https://docs.fal.ai/fal-client/authentication for more information.'), (0, i.getTemporaryAuthToken)(v, this.config)))(), { fetch: H } = this.config, B = new URL(this.url);
            B.searchParams.set("fal_jwt_token", V);
            const R = yield H(B.toString(), {
              method: x.toUpperCase(),
              headers: {
                accept: (_ = T.accept) !== null && _ !== void 0 ? _ : l,
                "content-type": "application/json"
              },
              body: E && x !== "get" ? JSON.stringify(E) : void 0,
              signal: this.abortController.signal
            });
            return this._requestId = R.headers.get("x-fal-request-id"), yield this.handleResponse(R);
          }
          return yield (0, o.dispatchRequest)({
            method: x.toUpperCase(),
            targetUrl: this.url,
            input: E,
            config: this.config,
            options: {
              headers: {
                accept: (b = T.accept) !== null && b !== void 0 ? b : l
              },
              responseHandler: (O) => t(this, void 0, void 0, function* () {
                return this._requestId = O.headers.get("x-fal-request-id"), yield this.handleResponse(O);
              }),
              signal: this.abortController.signal
            }
          });
        } catch (O) {
          this.handleError(O);
        }
      }), this.handleResponse = (g) => t(this, void 0, void 0, function* () {
        var _, b;
        if (!g.ok) {
          try {
            yield (0, a.defaultResponseHandler)(g);
          } catch (C) {
            this.emit("error", C);
          }
          return;
        }
        const v = g.body;
        if (!v) {
          this.emit("error", new a.ApiError({
            message: "Response body is empty.",
            status: 400,
            body: void 0,
            requestId: this._requestId || void 0
          }));
          return;
        }
        if (!((_ = g.headers.get("content-type")) !== null && _ !== void 0 ? _ : "").startsWith(l)) {
          const C = v.getReader(), L = () => {
            C.read().then(({ done: V, value: H }) => {
              if (V) {
                this.emit("done", this.currentData);
                return;
              }
              this.buffer.push(H), this.currentData = H, this.emit("data", H), L();
            });
          };
          L();
          return;
        }
        const E = new TextDecoder("utf-8"), x = g.body.getReader(), S = (0, n.createParser)((C) => {
          if (C.type === "event") {
            const L = C.data;
            try {
              const V = JSON.parse(L);
              this.buffer.push(V), this.currentData = V, this.emit("data", V), this.emit("message", V);
            } catch (V) {
              this.emit("error", V);
            }
          }
        }), A = (b = this.options.timeout) !== null && b !== void 0 ? b : u, O = () => t(this, void 0, void 0, function* () {
          const { value: C, done: L } = yield x.read();
          this.lastEventTimestamp = Date.now(), S.feed(E.decode(C)), Date.now() - this.lastEventTimestamp > A && this.emit("error", new a.ApiError({
            message: `Event stream timed out after ${(A / 1e3).toFixed(0)} seconds with no messages.`,
            status: 408,
            requestId: this._requestId || void 0
          })), L ? this.emit("done", this.currentData) : O().catch(this.handleError);
        });
        O().catch(this.handleError);
      }), this.handleError = (g) => {
        var _;
        if (g.name === "AbortError" || this.signal.aborted)
          return;
        const b = g instanceof a.ApiError ? g : new a.ApiError({
          message: (_ = g.message) !== null && _ !== void 0 ? _ : "An unknown error occurred",
          status: 500,
          requestId: this._requestId || void 0
        });
        this.emit("error", b);
      }, this.on = (g, _) => {
        var b;
        this.listeners.has(g) || this.listeners.set(g, []), (b = this.listeners.get(g)) === null || b === void 0 || b.push(_);
      }, this.emit = (g, _) => {
        const b = this.listeners.get(g) || [];
        for (const v of b)
          v(_);
      }, this.done = () => t(this, void 0, void 0, function* () {
        return this.donePromise;
      }), this.abort = (g) => {
        this.streamClosed || this.abortController.abort(g);
      }, this.endpointId = f, this.config = m, this.url = (h = y.url) !== null && h !== void 0 ? h : (0, o.buildUrl)(f, {
        path: (0, s.resolveEndpointPath)(f, void 0, "/stream"),
        query: y.queryParams
      }), this.options = y, this.donePromise = new Promise((g, _) => {
        this.streamClosed && _(new a.ApiError({
          message: "Streaming connection is already closed.",
          status: 400,
          body: void 0,
          requestId: this._requestId || void 0
        })), this.signal.addEventListener("abort", () => {
          var b;
          g((b = this.currentData) !== null && b !== void 0 ? b : {});
        }), this.on("done", (b) => {
          this.streamClosed = !0, g(b);
        }), this.on("error", (b) => {
          this.streamClosed = !0, _(b);
        });
      }), y.signal && y.signal.addEventListener("abort", () => {
        this.abortController.abort();
      }), this.start().catch(this.handleError);
    }
    [Symbol.asyncIterator]() {
      return r(this, arguments, function* () {
        let m = !0;
        const y = () => m = !1;
        for (this.on("error", y), this.on("done", y); m || this.buffer.length > 0; ) {
          const h = this.buffer.shift();
          h && (yield yield e(h)), yield e(new Promise((g) => setTimeout(g, 16)));
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
  _e.FalStream = d;
  function c({ config: p, storage: f }) {
    return {
      stream(m, y) {
        return t(this, void 0, void 0, function* () {
          const h = y.input ? yield f.transformInput(y.input) : void 0;
          return new d(m, p, Object.assign(Object.assign({}, y), { input: h }));
        });
      }
    };
  }
  return _e;
}
var Io;
function ed() {
  if (Io) return Pe;
  Io = 1;
  var t = Pe && Pe.__awaiter || function(f, m, y, h) {
    function g(_) {
      return _ instanceof y ? _ : new y(function(b) {
        b(_);
      });
    }
    return new (y || (y = Promise))(function(_, b) {
      function v(x) {
        try {
          E(h.next(x));
        } catch (S) {
          b(S);
        }
      }
      function T(x) {
        try {
          E(h.throw(x));
        } catch (S) {
          b(S);
        }
      }
      function E(x) {
        x.done ? _(x.value) : g(x.value).then(v, T);
      }
      E((h = h.apply(f, m || [])).next());
    });
  }, e = Pe && Pe.__rest || function(f, m) {
    var y = {};
    for (var h in f) Object.prototype.hasOwnProperty.call(f, h) && m.indexOf(h) < 0 && (y[h] = f[h]);
    if (f != null && typeof Object.getOwnPropertySymbols == "function")
      for (var g = 0, h = Object.getOwnPropertySymbols(f); g < h.length; g++)
        m.indexOf(h[g]) < 0 && Object.prototype.propertyIsEnumerable.call(f, h[g]) && (y[h[g]] = f[h[g]]);
    return y;
  };
  Object.defineProperty(Pe, "__esModule", { value: !0 }), Pe.createQueueClient = void 0;
  const r = Si(), n = Tr(), i = lt(), o = Yr(), a = cs(), s = ps(), l = Je(), u = 500, d = {
    maxRetries: 3,
    baseDelay: 1e3,
    maxDelay: 6e4,
    retryableStatusCodes: o.DEFAULT_RETRYABLE_STATUS_CODES
  }, c = {
    maxRetries: 5,
    baseDelay: 1e3,
    maxDelay: 3e4,
    retryableStatusCodes: [...o.DEFAULT_RETRYABLE_STATUS_CODES, 500]
  }, p = ({ config: f, storage: m }) => {
    const y = {
      submit(h, g) {
        return t(this, void 0, void 0, function* () {
          const { webhookUrl: _, priority: b, hint: v, startTimeout: T, headers: E, storageSettings: x } = g, S = e(g, ["webhookUrl", "priority", "hint", "startTimeout", "headers", "storageSettings"]), A = g.input ? yield m.transformInput(g.input) : void 0, O = Object.fromEntries(Object.entries(E ?? {}).map(([C, L]) => [
            C.toLowerCase(),
            L
          ]));
          return (0, n.dispatchRequest)({
            method: g.method,
            targetUrl: (0, n.buildUrl)(h, Object.assign(Object.assign({}, S), { subdomain: "queue", query: _ ? { fal_webhook: _ } : void 0 })),
            headers: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, O), (0, a.buildObjectLifecycleHeaders)(x)), { [r.QUEUE_PRIORITY_HEADER]: b ?? "normal" }), v && { [r.RUNNER_HINT_HEADER]: v }), (0, r.buildTimeoutHeaders)(T)),
            input: A,
            config: f,
            options: {
              signal: g.abortSignal,
              retry: d
            }
          });
        });
      },
      status(h, g) {
        return t(this, arguments, void 0, function* (_, { requestId: b, logs: v = !1, abortSignal: T }) {
          const E = (0, l.parseEndpointId)(_), x = E.namespace ? `${E.namespace}/` : "";
          return (0, n.dispatchRequest)({
            method: "get",
            targetUrl: (0, n.buildUrl)(`${x}${E.owner}/${E.alias}`, {
              subdomain: "queue",
              query: { logs: v ? "1" : "0" },
              path: `/requests/${b}/status`
            }),
            config: f,
            options: {
              signal: T,
              retry: c
            }
          });
        });
      },
      streamStatus(h, g) {
        return t(this, arguments, void 0, function* (_, { requestId: b, logs: v = !1, connectionMode: T }) {
          const E = (0, l.parseEndpointId)(_), x = E.namespace ? `${E.namespace}/` : "", S = {
            logs: v ? "1" : "0"
          }, A = (0, n.buildUrl)(`${x}${E.owner}/${E.alias}`, {
            subdomain: "queue",
            path: `/requests/${b}/status/stream`,
            query: S
          });
          return new s.FalStream(_, f, {
            url: A,
            method: "get",
            connectionMode: T,
            queryParams: S
          });
        });
      },
      subscribeToStatus(h, g) {
        return t(this, void 0, void 0, function* () {
          const _ = g.requestId, b = g.timeout;
          let v;
          const T = () => {
          };
          if (g.mode === "streaming") {
            const E = yield y.streamStatus(h, {
              requestId: _,
              logs: g.logs,
              connectionMode: "connectionMode" in g ? g.connectionMode : void 0
            }), x = [];
            b && (v = setTimeout(() => {
              throw E.abort(), y.cancel(h, { requestId: _ }).catch(T), new Error(`Client timed out waiting for the request to complete after ${b}ms`);
            }, b)), E.on("data", (A) => {
              g.onQueueUpdate && ("logs" in A && Array.isArray(A.logs) && A.logs.length > 0 && x.push(...A.logs), g.onQueueUpdate("logs" in A ? Object.assign(Object.assign({}, A), { logs: x }) : A));
            });
            const S = yield E.done();
            return v && clearTimeout(v), S;
          }
          return new Promise((E, x) => {
            var S;
            let A;
            const O = "pollInterval" in g && typeof g.pollInterval == "number" && (S = g.pollInterval) !== null && S !== void 0 ? S : u, C = () => {
              v && clearTimeout(v), A && clearTimeout(A);
            };
            b && (v = setTimeout(() => {
              C(), y.cancel(h, { requestId: _ }).catch(T), x(new Error(`Client timed out waiting for the request to complete after ${b}ms`));
            }, b));
            const L = () => t(this, void 0, void 0, function* () {
              var V;
              try {
                const H = yield y.status(h, {
                  requestId: _,
                  logs: (V = g.logs) !== null && V !== void 0 ? V : !1,
                  abortSignal: g.abortSignal
                });
                if (g.onQueueUpdate && g.onQueueUpdate(H), H.status === "COMPLETED") {
                  C(), E(H);
                  return;
                }
                A = setTimeout(L, O);
              } catch (H) {
                C(), x(H);
              }
            });
            L().catch(x);
          });
        });
      },
      result(h, g) {
        return t(this, arguments, void 0, function* (_, { requestId: b, abortSignal: v }) {
          const T = (0, l.parseEndpointId)(_), E = T.namespace ? `${T.namespace}/` : "";
          return (0, n.dispatchRequest)({
            method: "get",
            targetUrl: (0, n.buildUrl)(`${E}${T.owner}/${T.alias}`, {
              subdomain: "queue",
              path: `/requests/${b}`
            }),
            config: Object.assign(Object.assign({}, f), { responseHandler: i.resultResponseHandler }),
            options: {
              signal: v,
              retry: d
            }
          });
        });
      },
      cancel(h, g) {
        return t(this, arguments, void 0, function* (_, { requestId: b, abortSignal: v }) {
          const T = (0, l.parseEndpointId)(_), E = T.namespace ? `${T.namespace}/` : "";
          yield (0, n.dispatchRequest)({
            method: "put",
            targetUrl: (0, n.buildUrl)(`${E}${T.owner}/${T.alias}`, {
              subdomain: "queue",
              path: `/requests/${b}/cancel`
            }),
            config: f,
            options: {
              signal: v
            }
          });
        });
      }
    };
    return y;
  };
  return Pe.createQueueClient = p, Pe;
}
var ft = {};
function td(t) {
  const e = t.length;
  let r = 0, n = 0;
  for (; n < e; ) {
    let i = t.charCodeAt(n++);
    if ((i & 4294967168) === 0) {
      r++;
      continue;
    } else if ((i & 4294965248) === 0)
      r += 2;
    else {
      if (i >= 55296 && i <= 56319 && n < e) {
        const o = t.charCodeAt(n);
        (o & 64512) === 56320 && (++n, i = ((i & 1023) << 10) + (o & 1023) + 65536);
      }
      (i & 4294901760) === 0 ? r += 3 : r += 4;
    }
  }
  return r;
}
function rd(t, e, r) {
  const n = t.length;
  let i = r, o = 0;
  for (; o < n; ) {
    let a = t.charCodeAt(o++);
    if ((a & 4294967168) === 0) {
      e[i++] = a;
      continue;
    } else if ((a & 4294965248) === 0)
      e[i++] = a >> 6 & 31 | 192;
    else {
      if (a >= 55296 && a <= 56319 && o < n) {
        const s = t.charCodeAt(o);
        (s & 64512) === 56320 && (++o, a = ((a & 1023) << 10) + (s & 1023) + 65536);
      }
      (a & 4294901760) === 0 ? (e[i++] = a >> 12 & 15 | 224, e[i++] = a >> 6 & 63 | 128) : (e[i++] = a >> 18 & 7 | 240, e[i++] = a >> 12 & 63 | 128, e[i++] = a >> 6 & 63 | 128);
    }
    e[i++] = a & 63 | 128;
  }
}
const nd = new TextEncoder(), id = 50;
function od(t, e, r) {
  nd.encodeInto(t, e.subarray(r));
}
function ad(t, e, r) {
  t.length > id ? od(t, e, r) : rd(t, e, r);
}
const sd = 4096;
function ms(t, e, r) {
  let n = e;
  const i = n + r, o = [];
  let a = "";
  for (; n < i; ) {
    const s = t[n++];
    if ((s & 128) === 0)
      o.push(s);
    else if ((s & 224) === 192) {
      const l = t[n++] & 63;
      o.push((s & 31) << 6 | l);
    } else if ((s & 240) === 224) {
      const l = t[n++] & 63, u = t[n++] & 63;
      o.push((s & 31) << 12 | l << 6 | u);
    } else if ((s & 248) === 240) {
      const l = t[n++] & 63, u = t[n++] & 63, d = t[n++] & 63;
      let c = (s & 7) << 18 | l << 12 | u << 6 | d;
      c > 65535 && (c -= 65536, o.push(c >>> 10 & 1023 | 55296), c = 56320 | c & 1023), o.push(c);
    } else
      o.push(s);
    o.length >= sd && (a += String.fromCharCode(...o), o.length = 0);
  }
  return o.length > 0 && (a += String.fromCharCode(...o)), a;
}
const ld = new TextDecoder(), ud = 200;
function dd(t, e, r) {
  const n = t.subarray(e, e + r);
  return ld.decode(n);
}
function cd(t, e, r) {
  return r > ud ? dd(t, e, r) : ms(t, e, r);
}
class rr {
  constructor(e, r) {
    M(this, "type");
    M(this, "data");
    this.type = e, this.data = r;
  }
}
class ue extends Error {
  constructor(e) {
    super(e);
    const r = Object.create(ue.prototype);
    Object.setPrototypeOf(this, r), Object.defineProperty(this, "name", {
      configurable: !0,
      enumerable: !1,
      value: ue.name
    });
  }
}
const Jt = 4294967295;
function fd(t, e, r) {
  const n = r / 4294967296, i = r;
  t.setUint32(e, n), t.setUint32(e + 4, i);
}
function hs(t, e, r) {
  const n = Math.floor(r / 4294967296), i = r;
  t.setUint32(e, n), t.setUint32(e + 4, i);
}
function gs(t, e) {
  const r = t.getInt32(e), n = t.getUint32(e + 4);
  return r * 4294967296 + n;
}
function pd(t, e) {
  const r = t.getUint32(e), n = t.getUint32(e + 4);
  return r * 4294967296 + n;
}
const ys = -1, md = 4294967296 - 1, hd = 17179869184 - 1;
function _s({ sec: t, nsec: e }) {
  if (t >= 0 && e >= 0 && t <= hd)
    if (e === 0 && t <= md) {
      const r = new Uint8Array(4);
      return new DataView(r.buffer).setUint32(0, t), r;
    } else {
      const r = t / 4294967296, n = t & 4294967295, i = new Uint8Array(8), o = new DataView(i.buffer);
      return o.setUint32(0, e << 2 | r & 3), o.setUint32(4, n), i;
    }
  else {
    const r = new Uint8Array(12), n = new DataView(r.buffer);
    return n.setUint32(0, e), hs(n, 4, t), r;
  }
}
function ws(t) {
  const e = t.getTime(), r = Math.floor(e / 1e3), n = (e - r * 1e3) * 1e6, i = Math.floor(n / 1e9);
  return {
    sec: r + i,
    nsec: n - i * 1e9
  };
}
function bs(t) {
  if (t instanceof Date) {
    const e = ws(t);
    return _s(e);
  } else
    return null;
}
function vs(t) {
  const e = new DataView(t.buffer, t.byteOffset, t.byteLength);
  switch (t.byteLength) {
    case 4:
      return { sec: e.getUint32(0), nsec: 0 };
    case 8: {
      const r = e.getUint32(0), n = e.getUint32(4), i = (r & 3) * 4294967296 + n, o = r >>> 2;
      return { sec: i, nsec: o };
    }
    case 12: {
      const r = gs(e, 4), n = e.getUint32(0);
      return { sec: r, nsec: n };
    }
    default:
      throw new ue(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${t.length}`);
  }
}
function Ts(t) {
  const e = vs(t);
  return new Date(e.sec * 1e3 + e.nsec / 1e6);
}
const gd = {
  type: ys,
  encode: bs,
  decode: Ts
}, Xr = class Xr {
  constructor() {
    // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
    // this will make type errors a lot more clear
    // eslint-disable-next-line @typescript-eslint/naming-convention
    M(this, "__brand");
    // built-in extensions
    M(this, "builtInEncoders", []);
    M(this, "builtInDecoders", []);
    // custom extensions
    M(this, "encoders", []);
    M(this, "decoders", []);
    this.register(gd);
  }
  register({ type: e, encode: r, decode: n }) {
    if (e >= 0)
      this.encoders[e] = r, this.decoders[e] = n;
    else {
      const i = -1 - e;
      this.builtInEncoders[i] = r, this.builtInDecoders[i] = n;
    }
  }
  tryToEncode(e, r) {
    for (let n = 0; n < this.builtInEncoders.length; n++) {
      const i = this.builtInEncoders[n];
      if (i != null) {
        const o = i(e, r);
        if (o != null) {
          const a = -1 - n;
          return new rr(a, o);
        }
      }
    }
    for (let n = 0; n < this.encoders.length; n++) {
      const i = this.encoders[n];
      if (i != null) {
        const o = i(e, r);
        if (o != null) {
          const a = n;
          return new rr(a, o);
        }
      }
    }
    return e instanceof rr ? e : null;
  }
  decode(e, r, n) {
    const i = r < 0 ? this.builtInDecoders[-1 - r] : this.decoders[r];
    return i ? i(e, r, n) : new rr(r, e);
  }
};
M(Xr, "defaultCodec", new Xr());
let vr = Xr;
function yd(t) {
  return t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer;
}
function Jn(t) {
  return t instanceof Uint8Array ? t : ArrayBuffer.isView(t) ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : yd(t) ? new Uint8Array(t) : Uint8Array.from(t);
}
const _d = 100, wd = 2048;
class Qr {
  constructor(e) {
    M(this, "extensionCodec");
    M(this, "context");
    M(this, "useBigInt64");
    M(this, "maxDepth");
    M(this, "initialBufferSize");
    M(this, "sortKeys");
    M(this, "forceFloat32");
    M(this, "ignoreUndefined");
    M(this, "forceIntegerToFloat");
    M(this, "pos");
    M(this, "view");
    M(this, "bytes");
    M(this, "entered", !1);
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? vr.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.maxDepth = (e == null ? void 0 : e.maxDepth) ?? _d, this.initialBufferSize = (e == null ? void 0 : e.initialBufferSize) ?? wd, this.sortKeys = (e == null ? void 0 : e.sortKeys) ?? !1, this.forceFloat32 = (e == null ? void 0 : e.forceFloat32) ?? !1, this.ignoreUndefined = (e == null ? void 0 : e.ignoreUndefined) ?? !1, this.forceIntegerToFloat = (e == null ? void 0 : e.forceIntegerToFloat) ?? !1, this.pos = 0, this.view = new DataView(new ArrayBuffer(this.initialBufferSize)), this.bytes = new Uint8Array(this.view.buffer);
  }
  clone() {
    return new Qr({
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
  encodeSharedRef(e) {
    if (this.entered)
      return this.clone().encodeSharedRef(e);
    try {
      return this.entered = !0, this.reinitializeState(), this.doEncode(e, 1), this.bytes.subarray(0, this.pos);
    } finally {
      this.entered = !1;
    }
  }
  /**
   * @returns Encodes the object and returns a copy of the encoder's internal buffer.
   */
  encode(e) {
    if (this.entered)
      return this.clone().encode(e);
    try {
      return this.entered = !0, this.reinitializeState(), this.doEncode(e, 1), this.bytes.slice(0, this.pos);
    } finally {
      this.entered = !1;
    }
  }
  doEncode(e, r) {
    if (r > this.maxDepth)
      throw new Error(`Too deep objects in depth ${r}`);
    e == null ? this.encodeNil() : typeof e == "boolean" ? this.encodeBoolean(e) : typeof e == "number" ? this.forceIntegerToFloat ? this.encodeNumberAsFloat(e) : this.encodeNumber(e) : typeof e == "string" ? this.encodeString(e) : this.useBigInt64 && typeof e == "bigint" ? this.encodeBigInt64(e) : this.encodeObject(e, r);
  }
  ensureBufferSizeToWrite(e) {
    const r = this.pos + e;
    this.view.byteLength < r && this.resizeBuffer(r * 2);
  }
  resizeBuffer(e) {
    const r = new ArrayBuffer(e), n = new Uint8Array(r), i = new DataView(r);
    n.set(this.bytes), this.view = i, this.bytes = n;
  }
  encodeNil() {
    this.writeU8(192);
  }
  encodeBoolean(e) {
    e === !1 ? this.writeU8(194) : this.writeU8(195);
  }
  encodeNumber(e) {
    !this.forceIntegerToFloat && Number.isSafeInteger(e) ? e >= 0 ? e < 128 ? this.writeU8(e) : e < 256 ? (this.writeU8(204), this.writeU8(e)) : e < 65536 ? (this.writeU8(205), this.writeU16(e)) : e < 4294967296 ? (this.writeU8(206), this.writeU32(e)) : this.useBigInt64 ? this.encodeNumberAsFloat(e) : (this.writeU8(207), this.writeU64(e)) : e >= -32 ? this.writeU8(224 | e + 32) : e >= -128 ? (this.writeU8(208), this.writeI8(e)) : e >= -32768 ? (this.writeU8(209), this.writeI16(e)) : e >= -2147483648 ? (this.writeU8(210), this.writeI32(e)) : this.useBigInt64 ? this.encodeNumberAsFloat(e) : (this.writeU8(211), this.writeI64(e)) : this.encodeNumberAsFloat(e);
  }
  encodeNumberAsFloat(e) {
    this.forceFloat32 ? (this.writeU8(202), this.writeF32(e)) : (this.writeU8(203), this.writeF64(e));
  }
  encodeBigInt64(e) {
    e >= BigInt(0) ? (this.writeU8(207), this.writeBigUint64(e)) : (this.writeU8(211), this.writeBigInt64(e));
  }
  writeStringHeader(e) {
    if (e < 32)
      this.writeU8(160 + e);
    else if (e < 256)
      this.writeU8(217), this.writeU8(e);
    else if (e < 65536)
      this.writeU8(218), this.writeU16(e);
    else if (e < 4294967296)
      this.writeU8(219), this.writeU32(e);
    else
      throw new Error(`Too long string: ${e} bytes in UTF-8`);
  }
  encodeString(e) {
    const n = td(e);
    this.ensureBufferSizeToWrite(5 + n), this.writeStringHeader(n), ad(e, this.bytes, this.pos), this.pos += n;
  }
  encodeObject(e, r) {
    const n = this.extensionCodec.tryToEncode(e, this.context);
    if (n != null)
      this.encodeExtension(n);
    else if (Array.isArray(e))
      this.encodeArray(e, r);
    else if (ArrayBuffer.isView(e))
      this.encodeBinary(e);
    else if (typeof e == "object")
      this.encodeMap(e, r);
    else
      throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(e)}`);
  }
  encodeBinary(e) {
    const r = e.byteLength;
    if (r < 256)
      this.writeU8(196), this.writeU8(r);
    else if (r < 65536)
      this.writeU8(197), this.writeU16(r);
    else if (r < 4294967296)
      this.writeU8(198), this.writeU32(r);
    else
      throw new Error(`Too large binary: ${r}`);
    const n = Jn(e);
    this.writeU8a(n);
  }
  encodeArray(e, r) {
    const n = e.length;
    if (n < 16)
      this.writeU8(144 + n);
    else if (n < 65536)
      this.writeU8(220), this.writeU16(n);
    else if (n < 4294967296)
      this.writeU8(221), this.writeU32(n);
    else
      throw new Error(`Too large array: ${n}`);
    for (const i of e)
      this.doEncode(i, r + 1);
  }
  countWithoutUndefined(e, r) {
    let n = 0;
    for (const i of r)
      e[i] !== void 0 && n++;
    return n;
  }
  encodeMap(e, r) {
    const n = Object.keys(e);
    this.sortKeys && n.sort();
    const i = this.ignoreUndefined ? this.countWithoutUndefined(e, n) : n.length;
    if (i < 16)
      this.writeU8(128 + i);
    else if (i < 65536)
      this.writeU8(222), this.writeU16(i);
    else if (i < 4294967296)
      this.writeU8(223), this.writeU32(i);
    else
      throw new Error(`Too large map object: ${i}`);
    for (const o of n) {
      const a = e[o];
      this.ignoreUndefined && a === void 0 || (this.encodeString(o), this.doEncode(a, r + 1));
    }
  }
  encodeExtension(e) {
    if (typeof e.data == "function") {
      const n = e.data(this.pos + 6), i = n.length;
      if (i >= 4294967296)
        throw new Error(`Too large extension object: ${i}`);
      this.writeU8(201), this.writeU32(i), this.writeI8(e.type), this.writeU8a(n);
      return;
    }
    const r = e.data.length;
    if (r === 1)
      this.writeU8(212);
    else if (r === 2)
      this.writeU8(213);
    else if (r === 4)
      this.writeU8(214);
    else if (r === 8)
      this.writeU8(215);
    else if (r === 16)
      this.writeU8(216);
    else if (r < 256)
      this.writeU8(199), this.writeU8(r);
    else if (r < 65536)
      this.writeU8(200), this.writeU16(r);
    else if (r < 4294967296)
      this.writeU8(201), this.writeU32(r);
    else
      throw new Error(`Too large extension object: ${r}`);
    this.writeI8(e.type), this.writeU8a(e.data);
  }
  writeU8(e) {
    this.ensureBufferSizeToWrite(1), this.view.setUint8(this.pos, e), this.pos++;
  }
  writeU8a(e) {
    const r = e.length;
    this.ensureBufferSizeToWrite(r), this.bytes.set(e, this.pos), this.pos += r;
  }
  writeI8(e) {
    this.ensureBufferSizeToWrite(1), this.view.setInt8(this.pos, e), this.pos++;
  }
  writeU16(e) {
    this.ensureBufferSizeToWrite(2), this.view.setUint16(this.pos, e), this.pos += 2;
  }
  writeI16(e) {
    this.ensureBufferSizeToWrite(2), this.view.setInt16(this.pos, e), this.pos += 2;
  }
  writeU32(e) {
    this.ensureBufferSizeToWrite(4), this.view.setUint32(this.pos, e), this.pos += 4;
  }
  writeI32(e) {
    this.ensureBufferSizeToWrite(4), this.view.setInt32(this.pos, e), this.pos += 4;
  }
  writeF32(e) {
    this.ensureBufferSizeToWrite(4), this.view.setFloat32(this.pos, e), this.pos += 4;
  }
  writeF64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setFloat64(this.pos, e), this.pos += 8;
  }
  writeU64(e) {
    this.ensureBufferSizeToWrite(8), fd(this.view, this.pos, e), this.pos += 8;
  }
  writeI64(e) {
    this.ensureBufferSizeToWrite(8), hs(this.view, this.pos, e), this.pos += 8;
  }
  writeBigUint64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigUint64(this.pos, e), this.pos += 8;
  }
  writeBigInt64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigInt64(this.pos, e), this.pos += 8;
  }
}
function bd(t, e) {
  return new Qr(e).encodeSharedRef(t);
}
function In(t) {
  return `${t < 0 ? "-" : ""}0x${Math.abs(t).toString(16).padStart(2, "0")}`;
}
const vd = 16, Td = 16;
class Ed {
  constructor(e = vd, r = Td) {
    M(this, "hit", 0);
    M(this, "miss", 0);
    M(this, "caches");
    M(this, "maxKeyLength");
    M(this, "maxLengthPerKey");
    this.maxKeyLength = e, this.maxLengthPerKey = r, this.caches = [];
    for (let n = 0; n < this.maxKeyLength; n++)
      this.caches.push([]);
  }
  canBeCached(e) {
    return e > 0 && e <= this.maxKeyLength;
  }
  find(e, r, n) {
    const i = this.caches[n - 1];
    e: for (const o of i) {
      const a = o.bytes;
      for (let s = 0; s < n; s++)
        if (a[s] !== e[r + s])
          continue e;
      return o.str;
    }
    return null;
  }
  store(e, r) {
    const n = this.caches[e.length - 1], i = { bytes: e, str: r };
    n.length >= this.maxLengthPerKey ? n[Math.random() * n.length | 0] = i : n.push(i);
  }
  decode(e, r, n) {
    const i = this.find(e, r, n);
    if (i != null)
      return this.hit++, i;
    this.miss++;
    const o = ms(e, r, n), a = Uint8Array.prototype.slice.call(e, r, r + n);
    return this.store(a, o), o;
  }
}
const Kn = "array", ar = "map_key", Es = "map_value", Sd = (t) => {
  if (typeof t == "string" || typeof t == "number")
    return t;
  throw new ue("The type of key must be string or number but " + typeof t);
};
class Id {
  constructor() {
    M(this, "stack", []);
    M(this, "stackHeadPosition", -1);
  }
  get length() {
    return this.stackHeadPosition + 1;
  }
  top() {
    return this.stack[this.stackHeadPosition];
  }
  pushArrayState(e) {
    const r = this.getUninitializedStateFromPool();
    r.type = Kn, r.position = 0, r.size = e, r.array = new Array(e);
  }
  pushMapState(e) {
    const r = this.getUninitializedStateFromPool();
    r.type = ar, r.readCount = 0, r.size = e, r.map = {};
  }
  getUninitializedStateFromPool() {
    if (this.stackHeadPosition++, this.stackHeadPosition === this.stack.length) {
      const e = {
        type: void 0,
        size: 0,
        array: void 0,
        position: 0,
        readCount: 0,
        map: void 0,
        key: null
      };
      this.stack.push(e);
    }
    return this.stack[this.stackHeadPosition];
  }
  release(e) {
    if (this.stack[this.stackHeadPosition] !== e)
      throw new Error("Invalid stack state. Released state is not on top of the stack.");
    if (e.type === Kn) {
      const n = e;
      n.size = 0, n.array = void 0, n.position = 0, n.type = void 0;
    }
    if (e.type === ar || e.type === Es) {
      const n = e;
      n.size = 0, n.map = void 0, n.readCount = 0, n.type = void 0;
    }
    this.stackHeadPosition--;
  }
  reset() {
    this.stack.length = 0, this.stackHeadPosition = -1;
  }
}
const Kt = -1, Ai = new DataView(new ArrayBuffer(0)), xd = new Uint8Array(Ai.buffer);
try {
  Ai.getInt8(0);
} catch (t) {
  if (!(t instanceof RangeError))
    throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
}
const xo = new RangeError("Insufficient data"), Ad = new Ed();
class Ke {
  constructor(e) {
    M(this, "extensionCodec");
    M(this, "context");
    M(this, "useBigInt64");
    M(this, "rawStrings");
    M(this, "maxStrLength");
    M(this, "maxBinLength");
    M(this, "maxArrayLength");
    M(this, "maxMapLength");
    M(this, "maxExtLength");
    M(this, "keyDecoder");
    M(this, "mapKeyConverter");
    M(this, "totalPos", 0);
    M(this, "pos", 0);
    M(this, "view", Ai);
    M(this, "bytes", xd);
    M(this, "headByte", Kt);
    M(this, "stack", new Id());
    M(this, "entered", !1);
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? vr.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.rawStrings = (e == null ? void 0 : e.rawStrings) ?? !1, this.maxStrLength = (e == null ? void 0 : e.maxStrLength) ?? Jt, this.maxBinLength = (e == null ? void 0 : e.maxBinLength) ?? Jt, this.maxArrayLength = (e == null ? void 0 : e.maxArrayLength) ?? Jt, this.maxMapLength = (e == null ? void 0 : e.maxMapLength) ?? Jt, this.maxExtLength = (e == null ? void 0 : e.maxExtLength) ?? Jt, this.keyDecoder = (e == null ? void 0 : e.keyDecoder) !== void 0 ? e.keyDecoder : Ad, this.mapKeyConverter = (e == null ? void 0 : e.mapKeyConverter) ?? Sd;
  }
  clone() {
    return new Ke({
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
    this.totalPos = 0, this.headByte = Kt, this.stack.reset();
  }
  setBuffer(e) {
    const r = Jn(e);
    this.bytes = r, this.view = new DataView(r.buffer, r.byteOffset, r.byteLength), this.pos = 0;
  }
  appendBuffer(e) {
    if (this.headByte === Kt && !this.hasRemaining(1))
      this.setBuffer(e);
    else {
      const r = this.bytes.subarray(this.pos), n = Jn(e), i = new Uint8Array(r.length + n.length);
      i.set(r), i.set(n, r.length), this.setBuffer(i);
    }
  }
  hasRemaining(e) {
    return this.view.byteLength - this.pos >= e;
  }
  createExtraByteError(e) {
    const { view: r, pos: n } = this;
    return new RangeError(`Extra ${r.byteLength - n} of ${r.byteLength} byte(s) found at buffer[${e}]`);
  }
  /**
   * @throws {@link DecodeError}
   * @throws {@link RangeError}
   */
  decode(e) {
    if (this.entered)
      return this.clone().decode(e);
    try {
      this.entered = !0, this.reinitializeState(), this.setBuffer(e);
      const r = this.doDecodeSync();
      if (this.hasRemaining(1))
        throw this.createExtraByteError(this.pos);
      return r;
    } finally {
      this.entered = !1;
    }
  }
  *decodeMulti(e) {
    if (this.entered) {
      yield* this.clone().decodeMulti(e);
      return;
    }
    try {
      for (this.entered = !0, this.reinitializeState(), this.setBuffer(e); this.hasRemaining(1); )
        yield this.doDecodeSync();
    } finally {
      this.entered = !1;
    }
  }
  async decodeAsync(e) {
    if (this.entered)
      return this.clone().decodeAsync(e);
    try {
      this.entered = !0;
      let r = !1, n;
      for await (const s of e) {
        if (r)
          throw this.entered = !1, this.createExtraByteError(this.totalPos);
        this.appendBuffer(s);
        try {
          n = this.doDecodeSync(), r = !0;
        } catch (l) {
          if (!(l instanceof RangeError))
            throw l;
        }
        this.totalPos += this.pos;
      }
      if (r) {
        if (this.hasRemaining(1))
          throw this.createExtraByteError(this.totalPos);
        return n;
      }
      const { headByte: i, pos: o, totalPos: a } = this;
      throw new RangeError(`Insufficient data in parsing ${In(i)} at ${a} (${o} in the current buffer)`);
    } finally {
      this.entered = !1;
    }
  }
  decodeArrayStream(e) {
    return this.decodeMultiAsync(e, !0);
  }
  decodeStream(e) {
    return this.decodeMultiAsync(e, !1);
  }
  async *decodeMultiAsync(e, r) {
    if (this.entered) {
      yield* this.clone().decodeMultiAsync(e, r);
      return;
    }
    try {
      this.entered = !0;
      let n = r, i = -1;
      for await (const o of e) {
        if (r && i === 0)
          throw this.createExtraByteError(this.totalPos);
        this.appendBuffer(o), n && (i = this.readArraySize(), n = !1, this.complete());
        try {
          for (; yield this.doDecodeSync(), --i !== 0; )
            ;
        } catch (a) {
          if (!(a instanceof RangeError))
            throw a;
        }
        this.totalPos += this.pos;
      }
    } finally {
      this.entered = !1;
    }
  }
  doDecodeSync() {
    e: for (; ; ) {
      const e = this.readHeadByte();
      let r;
      if (e >= 224)
        r = e - 256;
      else if (e < 192)
        if (e < 128)
          r = e;
        else if (e < 144) {
          const i = e - 128;
          if (i !== 0) {
            this.pushMapState(i), this.complete();
            continue e;
          } else
            r = {};
        } else if (e < 160) {
          const i = e - 144;
          if (i !== 0) {
            this.pushArrayState(i), this.complete();
            continue e;
          } else
            r = [];
        } else {
          const i = e - 160;
          r = this.decodeString(i, 0);
        }
      else if (e === 192)
        r = null;
      else if (e === 194)
        r = !1;
      else if (e === 195)
        r = !0;
      else if (e === 202)
        r = this.readF32();
      else if (e === 203)
        r = this.readF64();
      else if (e === 204)
        r = this.readU8();
      else if (e === 205)
        r = this.readU16();
      else if (e === 206)
        r = this.readU32();
      else if (e === 207)
        this.useBigInt64 ? r = this.readU64AsBigInt() : r = this.readU64();
      else if (e === 208)
        r = this.readI8();
      else if (e === 209)
        r = this.readI16();
      else if (e === 210)
        r = this.readI32();
      else if (e === 211)
        this.useBigInt64 ? r = this.readI64AsBigInt() : r = this.readI64();
      else if (e === 217) {
        const i = this.lookU8();
        r = this.decodeString(i, 1);
      } else if (e === 218) {
        const i = this.lookU16();
        r = this.decodeString(i, 2);
      } else if (e === 219) {
        const i = this.lookU32();
        r = this.decodeString(i, 4);
      } else if (e === 220) {
        const i = this.readU16();
        if (i !== 0) {
          this.pushArrayState(i), this.complete();
          continue e;
        } else
          r = [];
      } else if (e === 221) {
        const i = this.readU32();
        if (i !== 0) {
          this.pushArrayState(i), this.complete();
          continue e;
        } else
          r = [];
      } else if (e === 222) {
        const i = this.readU16();
        if (i !== 0) {
          this.pushMapState(i), this.complete();
          continue e;
        } else
          r = {};
      } else if (e === 223) {
        const i = this.readU32();
        if (i !== 0) {
          this.pushMapState(i), this.complete();
          continue e;
        } else
          r = {};
      } else if (e === 196) {
        const i = this.lookU8();
        r = this.decodeBinary(i, 1);
      } else if (e === 197) {
        const i = this.lookU16();
        r = this.decodeBinary(i, 2);
      } else if (e === 198) {
        const i = this.lookU32();
        r = this.decodeBinary(i, 4);
      } else if (e === 212)
        r = this.decodeExtension(1, 0);
      else if (e === 213)
        r = this.decodeExtension(2, 0);
      else if (e === 214)
        r = this.decodeExtension(4, 0);
      else if (e === 215)
        r = this.decodeExtension(8, 0);
      else if (e === 216)
        r = this.decodeExtension(16, 0);
      else if (e === 199) {
        const i = this.lookU8();
        r = this.decodeExtension(i, 1);
      } else if (e === 200) {
        const i = this.lookU16();
        r = this.decodeExtension(i, 2);
      } else if (e === 201) {
        const i = this.lookU32();
        r = this.decodeExtension(i, 4);
      } else
        throw new ue(`Unrecognized type byte: ${In(e)}`);
      this.complete();
      const n = this.stack;
      for (; n.length > 0; ) {
        const i = n.top();
        if (i.type === Kn)
          if (i.array[i.position] = r, i.position++, i.position === i.size)
            r = i.array, n.release(i);
          else
            continue e;
        else if (i.type === ar) {
          if (r === "__proto__")
            throw new ue("The key __proto__ is not allowed");
          i.key = this.mapKeyConverter(r), i.type = Es;
          continue e;
        } else if (i.map[i.key] = r, i.readCount++, i.readCount === i.size)
          r = i.map, n.release(i);
        else {
          i.key = null, i.type = ar;
          continue e;
        }
      }
      return r;
    }
  }
  readHeadByte() {
    return this.headByte === Kt && (this.headByte = this.readU8()), this.headByte;
  }
  complete() {
    this.headByte = Kt;
  }
  readArraySize() {
    const e = this.readHeadByte();
    switch (e) {
      case 220:
        return this.readU16();
      case 221:
        return this.readU32();
      default: {
        if (e < 160)
          return e - 144;
        throw new ue(`Unrecognized array type byte: ${In(e)}`);
      }
    }
  }
  pushMapState(e) {
    if (e > this.maxMapLength)
      throw new ue(`Max length exceeded: map length (${e}) > maxMapLengthLength (${this.maxMapLength})`);
    this.stack.pushMapState(e);
  }
  pushArrayState(e) {
    if (e > this.maxArrayLength)
      throw new ue(`Max length exceeded: array length (${e}) > maxArrayLength (${this.maxArrayLength})`);
    this.stack.pushArrayState(e);
  }
  decodeString(e, r) {
    return !this.rawStrings || this.stateIsMapKey() ? this.decodeUtf8String(e, r) : this.decodeBinary(e, r);
  }
  /**
   * @throws {@link RangeError}
   */
  decodeUtf8String(e, r) {
    var o;
    if (e > this.maxStrLength)
      throw new ue(`Max length exceeded: UTF-8 byte length (${e}) > maxStrLength (${this.maxStrLength})`);
    if (this.bytes.byteLength < this.pos + r + e)
      throw xo;
    const n = this.pos + r;
    let i;
    return this.stateIsMapKey() && ((o = this.keyDecoder) != null && o.canBeCached(e)) ? i = this.keyDecoder.decode(this.bytes, n, e) : i = cd(this.bytes, n, e), this.pos += r + e, i;
  }
  stateIsMapKey() {
    return this.stack.length > 0 ? this.stack.top().type === ar : !1;
  }
  /**
   * @throws {@link RangeError}
   */
  decodeBinary(e, r) {
    if (e > this.maxBinLength)
      throw new ue(`Max length exceeded: bin length (${e}) > maxBinLength (${this.maxBinLength})`);
    if (!this.hasRemaining(e + r))
      throw xo;
    const n = this.pos + r, i = this.bytes.subarray(n, n + e);
    return this.pos += r + e, i;
  }
  decodeExtension(e, r) {
    if (e > this.maxExtLength)
      throw new ue(`Max length exceeded: ext length (${e}) > maxExtLength (${this.maxExtLength})`);
    const n = this.view.getInt8(this.pos + r), i = this.decodeBinary(
      e,
      r + 1
      /* extType */
    );
    return this.extensionCodec.decode(i, n, this.context);
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
    const e = this.view.getUint8(this.pos);
    return this.pos++, e;
  }
  readI8() {
    const e = this.view.getInt8(this.pos);
    return this.pos++, e;
  }
  readU16() {
    const e = this.view.getUint16(this.pos);
    return this.pos += 2, e;
  }
  readI16() {
    const e = this.view.getInt16(this.pos);
    return this.pos += 2, e;
  }
  readU32() {
    const e = this.view.getUint32(this.pos);
    return this.pos += 4, e;
  }
  readI32() {
    const e = this.view.getInt32(this.pos);
    return this.pos += 4, e;
  }
  readU64() {
    const e = pd(this.view, this.pos);
    return this.pos += 8, e;
  }
  readI64() {
    const e = gs(this.view, this.pos);
    return this.pos += 8, e;
  }
  readU64AsBigInt() {
    const e = this.view.getBigUint64(this.pos);
    return this.pos += 8, e;
  }
  readI64AsBigInt() {
    const e = this.view.getBigInt64(this.pos);
    return this.pos += 8, e;
  }
  readF32() {
    const e = this.view.getFloat32(this.pos);
    return this.pos += 4, e;
  }
  readF64() {
    const e = this.view.getFloat64(this.pos);
    return this.pos += 8, e;
  }
}
function kd(t, e) {
  return new Ke(e).decode(t);
}
function jd(t, e) {
  return new Ke(e).decodeMulti(t);
}
function Rd(t) {
  return t[Symbol.asyncIterator] != null;
}
async function* Pd(t) {
  const e = t.getReader();
  try {
    for (; ; ) {
      const { done: r, value: n } = await e.read();
      if (r)
        return;
      yield n;
    }
  } finally {
    e.releaseLock();
  }
}
function ki(t) {
  return Rd(t) ? t : Pd(t);
}
async function Od(t, e) {
  const r = ki(t);
  return new Ke(e).decodeAsync(r);
}
function Nd(t, e) {
  const r = ki(t);
  return new Ke(e).decodeArrayStream(r);
}
function Cd(t, e) {
  const r = ki(t);
  return new Ke(e).decodeStream(r);
}
const qd = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecodeError: ue,
  Decoder: Ke,
  EXT_TIMESTAMP: ys,
  Encoder: Qr,
  ExtData: rr,
  ExtensionCodec: vr,
  decode: kd,
  decodeArrayStream: Nd,
  decodeAsync: Od,
  decodeMulti: jd,
  decodeMultiStream: Cd,
  decodeTimestampExtension: Ts,
  decodeTimestampToTimeSpec: vs,
  encode: bd,
  encodeDateToTimeSpec: ws,
  encodeTimeSpecToTimestamp: _s,
  encodeTimestampExtension: bs
}, Symbol.toStringTag, { value: "Module" })), Ld = /* @__PURE__ */ Ju(qd);
var me = {}, Ao;
function Ud() {
  if (Ao) return me;
  Ao = 1, Object.defineProperty(me, "__esModule", { value: !0 });
  function t(k) {
    return { enumerable: !0, value: k };
  }
  function e(k) {
    return { enumerable: !0, writable: !0, value: k };
  }
  let r = {}, n = () => !0, i = () => ({}), o = (k) => k, a = (k, P, q, U) => k.apply(q, U) && P.apply(q, U), s = (k, P, q, [U, X]) => P.call(q, k.call(q, U, X), X), l = (k, P) => Object.freeze(Object.create(k, P));
  function u(k, P, q) {
    return k.reduce((U, X) => function(...ie) {
      return q(U, X, this, ie);
    }, P);
  }
  function d(k) {
    return l(this, { fn: t(k) });
  }
  let c = {}, p = d.bind(c), f = (k) => p((P, q) => !!~k(P, q) && P), m = {}, y = d.bind(m);
  function h(k, P) {
    return P.filter((q) => k.isPrototypeOf(q));
  }
  function g(k, P, ...q) {
    let U = u(h(m, q).map((ie) => ie.fn), n, a), X = u(h(c, q).map((ie) => ie.fn), o, s);
    return l(this, {
      from: t(k),
      to: t(P),
      guards: t(U),
      reducers: t(X)
    });
  }
  let _ = {}, b = {}, v = g.bind(_), T = g.bind(b, null);
  function E(k, P, q) {
    return B(P, k, q, this.immediates) || k;
  }
  function x(k) {
    let P = /* @__PURE__ */ new Map();
    for (let q of k)
      P.has(q.from) || P.set(q.from, []), P.get(q.from).push(q);
    return P;
  }
  let S = { enter: o };
  function A(...k) {
    let P = h(_, k), q = h(b, k), U = {
      final: t(k.length === 0),
      transitions: t(x(P))
    };
    return q.length && (U.immediates = t(q), U.enter = t(E)), l(S, U);
  }
  let O = {
    enter(k, P, q) {
      let U = this.fn.call(P, P.context, q);
      return V.isPrototypeOf(U) ? l(C, {
        machine: t(U),
        transitions: t(this.transitions)
      }).enter(k, P, q) : (U.then((X) => P.send({ type: "done", data: X })).catch((X) => P.send({ type: "error", error: X })), k);
    }
  }, C = {
    enter(k, P, q) {
      if (P.child = G(this.machine, (U) => {
        P.onChange(U), P.child == U && U.machine.state.value.final && (delete P.child, P.send({ type: "done", data: U.context }));
      }, P.context, q), P.child.machine.state.value.final) {
        let U = P.child.context;
        return delete P.child, B(P, k, { type: "done", data: U }, this.transitions.get("done"));
      }
      return k;
    }
  };
  function L(k, ...P) {
    let q = t(x(P));
    return V.isPrototypeOf(k) ? l(C, {
      machine: t(k),
      transitions: q
    }) : l(O, {
      fn: t(k),
      transitions: q
    });
  }
  let V = {
    get state() {
      return {
        name: this.current,
        value: this.states[this.current]
      };
    }
  };
  function H(k, P, q = i) {
    return typeof k != "string" && (q = P || i, P = k, k = Object.keys(P)[0]), r._create && r._create(k, P), l(V, {
      context: t(q),
      current: t(k),
      states: t(P)
    });
  }
  function B(k, P, q, U) {
    let { context: X } = k;
    for (let { to: ie, guards: je, reducers: ce } of U)
      if (je(X, q)) {
        k.context = ce.call(k, X, q);
        let Le = P.original || P, Mt = l(Le, {
          current: t(ie),
          original: { value: Le }
        });
        return r._onEnter && r._onEnter(P, ie, k.context, X, q), Mt.state.value.enter(Mt, k, q);
      }
  }
  function R(k, P) {
    let q = P.type || P, { machine: U } = k, { value: X, name: ie } = U.state;
    return X.transitions.has(q) ? B(k, U, P, X.transitions.get(q)) || U : (r._send && r._send(q, ie), U);
  }
  let N = {
    send(k) {
      this.machine = R(this, k), this.onChange(this);
    }
  };
  function G(k, P, q, U) {
    let X = Object.create(N, {
      machine: e(k),
      context: e(k.context(q, U)),
      onChange: t(P)
    });
    return X.send = X.send.bind(X), X.machine = X.machine.state.value.enter(X.machine, X, U), X;
  }
  return me.action = f, me.createMachine = H, me.d = r, me.guard = y, me.immediate = T, me.interpret = G, me.invoke = L, me.reduce = p, me.state = A, me.transition = v, me;
}
var ko;
function Md() {
  if (ko) return ft;
  ko = 1;
  var t = ft && ft.__awaiter || function(R, N, G, k) {
    function P(q) {
      return q instanceof G ? q : new G(function(U) {
        U(q);
      });
    }
    return new (G || (G = Promise))(function(q, U) {
      function X(ce) {
        try {
          je(k.next(ce));
        } catch (Le) {
          U(Le);
        }
      }
      function ie(ce) {
        try {
          je(k.throw(ce));
        } catch (Le) {
          U(Le);
        }
      }
      function je(ce) {
        ce.done ? q(ce.value) : P(ce.value).then(X, ie);
      }
      je((k = k.apply(R, N || [])).next());
    });
  };
  Object.defineProperty(ft, "__esModule", { value: !0 }), ft.createRealtimeClient = B;
  const e = Ld, r = Ud(), n = fs(), i = lt(), o = Ii(), a = Je(), s = () => ({
    enqueuedMessage: void 0
  });
  function l(R) {
    return R.token !== void 0;
  }
  function u(R) {
    return !l(R);
  }
  function d(R, N) {
    return Object.assign(Object.assign({}, R), { enqueuedMessage: N.message });
  }
  function c(R) {
    return R.websocket && R.websocket.readyState === WebSocket.OPEN && R.websocket.close(), Object.assign(Object.assign({}, R), { websocket: void 0 });
  }
  function p(R, N) {
    return R.websocket && R.websocket.readyState === WebSocket.OPEN ? (N.message instanceof Uint8Array || typeof N.message == "string" ? R.websocket.send(N.message) : R.websocket.send((0, e.encode)(N.message)), Object.assign(Object.assign({}, R), { enqueuedMessage: void 0 })) : Object.assign(Object.assign({}, R), { enqueuedMessage: N.message });
  }
  function f(R) {
    return Object.assign(Object.assign({}, R), { token: void 0 });
  }
  function m(R, N) {
    return Object.assign(Object.assign({}, R), { token: N.token });
  }
  function y(R, N) {
    return Object.assign(Object.assign({}, R), { websocket: N.websocket });
  }
  const h = (0, r.createMachine)("idle", {
    idle: (0, r.state)((0, r.transition)("send", "connecting", (0, r.reduce)(d)), (0, r.transition)("expireToken", "idle", (0, r.reduce)(f)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    connecting: (0, r.state)((0, r.transition)("connecting", "connecting"), (0, r.transition)("connected", "active", (0, r.reduce)(y)), (0, r.transition)("connectionClosed", "idle", (0, r.reduce)(c)), (0, r.transition)("send", "connecting", (0, r.reduce)(d)), (0, r.transition)("close", "idle", (0, r.reduce)(c)), (0, r.immediate)("authRequired", (0, r.guard)(u))),
    authRequired: (0, r.state)((0, r.transition)("initiateAuth", "authInProgress"), (0, r.transition)("send", "authRequired", (0, r.reduce)(d)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    authInProgress: (0, r.state)((0, r.transition)("authenticated", "connecting", (0, r.reduce)(m)), (0, r.transition)("unauthorized", "idle", (0, r.reduce)(f), (0, r.reduce)(c)), (0, r.transition)("send", "authInProgress", (0, r.reduce)(d)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    active: (0, r.state)((0, r.transition)("send", "active", (0, r.reduce)(p)), (0, r.transition)("authenticated", "active", (0, r.reduce)(m)), (0, r.transition)("unauthorized", "idle", (0, r.reduce)(f)), (0, r.transition)("connectionClosed", "idle", (0, r.reduce)(c)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    failed: (0, r.state)((0, r.transition)("send", "failed"), (0, r.transition)("close", "idle", (0, r.reduce)(c)))
  }, s);
  function g(R, { token: N, maxBuffering: G, path: k }) {
    var P;
    if (G !== void 0 && (G < 1 || G > 60))
      throw new Error("The `maxBuffering` must be between 1 and 60 (inclusive)");
    const q = new URLSearchParams({
      fal_jwt_token: N
    });
    G !== void 0 && q.set("max_buffering", G.toFixed(0));
    const U = (0, a.ensureEndpointIdFormat)(R), X = (P = (0, a.resolveEndpointPath)(R, k, "/realtime")) !== null && P !== void 0 ? P : "";
    return `wss://fal.run/${U}${X}?${q.toString()}`;
  }
  const _ = 128;
  function b(R) {
    return R.status === "error" && R.error === "Unauthorized";
  }
  const v = {
    NORMAL_CLOSURE: 1e3
  }, T = /* @__PURE__ */ new Map(), E = /* @__PURE__ */ new Map();
  function x(R, N, G) {
    if (!T.has(R)) {
      const k = (0, r.interpret)(h, G);
      T.set(R, Object.assign(Object.assign({}, k), { throttledSend: N > 0 ? (0, a.throttle)(k.send, N, !0) : k.send }));
    }
    return T.get(R);
  }
  const S = () => {
  }, A = {
    send: S,
    close: S
  };
  function O(R) {
    return R.status !== "error" && R.type !== "x-fal-message" && !C(R);
  }
  function C(R) {
    return R.type === "x-fal-error";
  }
  function L(R) {
    return t(this, void 0, void 0, function* () {
      if (typeof R == "string")
        return JSON.parse(R);
      const N = (G) => t(this, void 0, void 0, function* () {
        return G instanceof Uint8Array ? G : G instanceof Blob ? new Uint8Array(yield G.arrayBuffer()) : new Uint8Array(G);
      });
      return R instanceof ArrayBuffer || R instanceof Uint8Array ? (0, e.decode)(yield N(R)) : R instanceof Blob ? (0, e.decode)(yield N(R)) : R;
    });
  }
  function V(R) {
    return R instanceof Uint8Array ? R : (0, e.encode)(R);
  }
  function H({ data: R, decodeMessage: N, onResult: G, onError: k, send: P }) {
    const q = (U) => {
      if (b(U)) {
        P({
          type: "unauthorized",
          error: new Error("Unauthorized")
        });
        return;
      }
      if (O(U)) {
        G(U);
        return;
      }
      if (C(U)) {
        if (U.error === "TIMEOUT")
          return;
        k(new i.ApiError({
          message: `${U.error}: ${U.reason}`,
          // TODO better error status code
          status: 400,
          body: U
        }));
        return;
      }
    };
    Promise.resolve(N ? N(R) : R).then(q).catch((U) => {
      var X;
      k(new i.ApiError({
        message: (X = U == null ? void 0 : U.message) !== null && X !== void 0 ? X : "Failed to decode realtime message",
        status: 400
      }));
    });
  }
  function B({ config: R }) {
    return {
      connect(N, G) {
        const {
          // if running on React in the server, set clientOnly to true by default
          clientOnly: k = (0, a.isReact)() && !(0, o.isBrowser)(),
          connectionKey: P = crypto.randomUUID(),
          maxBuffering: q,
          path: U,
          throttleInterval: X = _,
          encodeMessage: ie,
          decodeMessage: je,
          tokenProvider: ce,
          tokenExpirationSeconds: Le
        } = G;
        if (k && !(0, o.isBrowser)())
          return A;
        const Mt = ie ?? ((Ye) => V(Ye)), un = je ?? ((Ye) => L(Ye));
        let Sr, no, Dt, $t = 0;
        E.set(P, {
          decodeMessage: un,
          onError: G.onError,
          onResult: G.onResult
        });
        const dn = () => E.get(P), Ft = x(P, X, ({ context: Ye, machine: Qe, send: Ue }) => {
          var cn;
          const { enqueuedMessage: fn, token: pn, websocket: mn } = Ye;
          if (no = fn, Qe.current === "active" && fn && (mn == null ? void 0 : mn.readyState) === WebSocket.OPEN && Ue({ type: "send", message: fn }), Qe.current === "authRequired" && pn === void 0 && Sr !== Qe.current) {
            Ue({ type: "initiateAuth" }), $t++;
            const Ae = $t, fe = (0, a.ensureEndpointIdFormat)(N), Te = (cn = (0, a.resolveEndpointPath)(N, U, "/realtime")) !== null && cn !== void 0 ? cn : "", Ze = ce ? () => ce(`${fe}${Te}`) : () => (console.warn("[fal.realtime] Using the default token provider is deprecated. Please provide a `tokenProvider` function to `fal.realtime.connect()`. See https://docs.fal.ai/model-apis/client#client-side-usage-with-token-provider for more information."), (0, n.getTemporaryAuthToken)(N, R)), Bt = ce ? Le : n.TOKEN_EXPIRATION_SECONDS, hn = Bt !== void 0 ? () => {
              clearTimeout(Dt);
              const Vt = Math.round(Bt * 0.9 * 1e3);
              Dt = setTimeout(() => {
                Ae === $t && Ze().then((gn) => {
                  Ae === $t && (queueMicrotask(() => {
                    Ue({ type: "authenticated", token: gn });
                  }), hn());
                }).catch(() => {
                  if (Ae !== $t)
                    return;
                  const gn = Math.round(Bt * 0.05 * 1e3);
                  Dt = setTimeout(() => {
                    hn();
                  }, gn);
                });
              }, Vt);
            } : S;
            Ze().then((Vt) => {
              queueMicrotask(() => {
                Ue({ type: "authenticated", token: Vt });
              }), hn();
            }).catch((Vt) => {
              queueMicrotask(() => {
                Ue({ type: "unauthorized", error: Vt });
              });
            });
          }
          if (Qe.current === "connecting" && Sr !== Qe.current && pn !== void 0) {
            const Ae = new WebSocket(g(N, { token: pn, maxBuffering: q, path: U }));
            Ae.onopen = () => {
              var fe, Te;
              Ue({ type: "connected", websocket: Ae });
              const Ze = (Te = (fe = Ft.context) === null || fe === void 0 ? void 0 : fe.enqueuedMessage) !== null && Te !== void 0 ? Te : no;
              Ze && (Ae.send(Mt(Ze)), Ft.context = Object.assign(Object.assign({}, Ft.context), { enqueuedMessage: void 0 }));
            }, Ae.onclose = (fe) => {
              if (fe.code !== v.NORMAL_CLOSURE) {
                const { onError: Te = S } = dn();
                Te(new i.ApiError({
                  message: `Error closing the connection: ${fe.reason}`,
                  status: fe.code
                }));
              }
              Ue({ type: "connectionClosed", code: fe.code });
            }, Ae.onerror = (fe) => {
              const { onError: Te = S } = dn();
              Te(new i.ApiError({ message: "Unknown error", status: 500 }));
            }, Ae.onmessage = (fe) => {
              const { decodeMessage: Te = un, onResult: Ze, onError: Bt = S } = dn();
              H({
                data: fe.data,
                decodeMessage: Te,
                onResult: Ze,
                onError: Bt,
                send: Ue
              });
            };
          }
          Sr === "active" && Qe.current !== "active" && (clearTimeout(Dt), Dt = void 0), Sr = Qe.current;
        });
        return {
          send: (Ye) => {
            Ft.throttledSend({
              type: "send",
              message: Mt(Ye)
            });
          },
          close: () => {
            Ft.send({ type: "close" });
          }
        };
      }
    };
  }
  return ft;
}
var jo;
function Ro() {
  if (jo) return ct;
  jo = 1;
  var t = ct && ct.__awaiter || function(d, c, p, f) {
    function m(y) {
      return y instanceof p ? y : new p(function(h) {
        h(y);
      });
    }
    return new (p || (p = Promise))(function(y, h) {
      function g(v) {
        try {
          b(f.next(v));
        } catch (T) {
          h(T);
        }
      }
      function _(v) {
        try {
          b(f.throw(v));
        } catch (T) {
          h(T);
        }
      }
      function b(v) {
        v.done ? y(v.value) : m(v.value).then(g, _);
      }
      b((f = f.apply(d, c || [])).next());
    });
  };
  Object.defineProperty(ct, "__esModule", { value: !0 }), ct.createFalClient = u;
  const e = xi(), r = Si(), n = ed(), i = Md(), o = Tr(), a = lt(), s = cs(), l = ps();
  function u(d = {}) {
    const c = (0, e.createConfig)(d), p = (0, s.createStorageClient)({ config: c }), f = (0, n.createQueueClient)({ config: c, storage: p }), m = (0, l.createStreamingClient)({ config: c, storage: p }), y = (0, i.createRealtimeClient)({ config: c });
    return {
      queue: f,
      realtime: y,
      storage: p,
      streaming: m,
      stream: m.stream,
      run(h) {
        return t(this, arguments, void 0, function* (g, _ = {}) {
          const b = _.input ? yield p.transformInput(_.input) : void 0;
          return (0, o.dispatchRequest)({
            method: _.method,
            targetUrl: (0, o.buildUrl)(g, _),
            input: b,
            // TODO: consider supporting custom headers in fal.run() as well
            headers: Object.assign(Object.assign({}, (0, s.buildObjectLifecycleHeaders)(_.storageSettings)), (0, r.buildTimeoutHeaders)(_.startTimeout)),
            config: Object.assign(Object.assign({}, c), { responseHandler: a.resultResponseHandler }),
            options: {
              signal: _.abortSignal,
              retry: {
                maxRetries: 3,
                baseDelay: 500,
                maxDelay: 15e3
              }
            }
          });
        });
      },
      subscribe: (h, g) => t(this, void 0, void 0, function* () {
        const { request_id: _ } = yield f.submit(h, g);
        return g.onEnqueue && g.onEnqueue(_), yield f.subscribeToStatus(h, Object.assign({ requestId: _ }, g)), f.result(h, { requestId: _ });
      })
    };
  }
  return ct;
}
var Yt = {}, Po;
function Dd() {
  if (Po) return Yt;
  Po = 1, Object.defineProperty(Yt, "__esModule", { value: !0 }), Yt.isQueueStatus = t, Yt.isCompletedQueueStatus = e;
  function t(r) {
    return r && r.status && r.response_url;
  }
  function e(r) {
    return t(r) && r.status === "COMPLETED";
  }
  return Yt;
}
var Oo;
function $d() {
  return Oo || (Oo = 1, (function(t) {
    var e = et && et.__createBinding || (Object.create ? (function(u, d, c, p) {
      p === void 0 && (p = c);
      var f = Object.getOwnPropertyDescriptor(d, c);
      (!f || ("get" in f ? !d.__esModule : f.writable || f.configurable)) && (f = { enumerable: !0, get: function() {
        return d[c];
      } }), Object.defineProperty(u, p, f);
    }) : (function(u, d, c, p) {
      p === void 0 && (p = c), u[p] = d[c];
    })), r = et && et.__exportStar || function(u, d) {
      for (var c in u) c !== "default" && !Object.prototype.hasOwnProperty.call(d, c) && e(d, u, c);
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.fal = t.parseEndpointId = t.isRetryableError = t.ValidationError = t.ApiError = t.withProxy = t.withMiddleware = t.createFalClient = void 0;
    const n = Ro();
    var i = Ro();
    Object.defineProperty(t, "createFalClient", { enumerable: !0, get: function() {
      return i.createFalClient;
    } });
    var o = ds();
    Object.defineProperty(t, "withMiddleware", { enumerable: !0, get: function() {
      return o.withMiddleware;
    } }), Object.defineProperty(t, "withProxy", { enumerable: !0, get: function() {
      return o.withProxy;
    } });
    var a = lt();
    Object.defineProperty(t, "ApiError", { enumerable: !0, get: function() {
      return a.ApiError;
    } }), Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
      return a.ValidationError;
    } });
    var s = Yr();
    Object.defineProperty(t, "isRetryableError", { enumerable: !0, get: function() {
      return s.isRetryableError;
    } }), r(Dd(), t);
    var l = Je();
    Object.defineProperty(t, "parseEndpointId", { enumerable: !0, get: function() {
      return l.parseEndpointId;
    } }), t.fal = (function() {
      let d = (0, n.createFalClient)();
      return {
        config(c) {
          d = (0, n.createFalClient)(c);
        },
        get queue() {
          return d.queue;
        },
        get realtime() {
          return d.realtime;
        },
        get storage() {
          return d.storage;
        },
        get streaming() {
          return d.streaming;
        },
        run(c, p) {
          return d.run(c, p);
        },
        subscribe(c, p) {
          return d.subscribe(c, p);
        },
        stream(c, p) {
          return d.stream(c, p);
        }
      };
    })();
  })(et)), et;
}
var K = $d();
function Ss(t) {
  return ["topaz_image", "topaz_video", "sync_so"].includes(String(t));
}
function Fd(t, e, r) {
  if (!Ss(t)) return;
  const n = r.filter((a) => /image/.test(a.role ?? "")), i = r.filter((a) => /video/.test(a.role ?? "")), o = r.filter((a) => /audio/.test(a.role ?? ""));
  if (t === "topaz_image") {
    if (n.length !== 1 || r.length !== 1) throw new Error("Topaz Image Upscale requires exactly one source image.");
    for (const a of ["output_width", "output_height"]) {
      const s = Number(e[a]);
      if (!Number.isSafeInteger(s) || s < 1) throw new Error("Choose positive whole-pixel output width and height.");
    }
    for (const a of ["sharpen", "denoise", "face_enhancement_strength", "face_enhancement_creativity"])
      if (e[a] !== void 0 && (!Number.isFinite(Number(e[a])) || Number(e[a]) < 0 || Number(e[a]) > 1)) throw new Error(`${a} must be between 0 and 1.`);
  } else if (t === "topaz_video") {
    if (i.length !== 1 || r.length !== 1) throw new Error("Topaz Video Upscale requires exactly one source video.");
    if (e.resolution !== void 0 && !["1080p", "2160p"].includes(String(e.resolution))) throw new Error("Topaz video output must be 1080p or 2160p (4K).");
  } else if (i.length !== 1 || o.length !== 1 || r.length !== 2) throw new Error("Lip sync requires exactly one source video and one dialogue audio file.");
}
const Bd = /* @__PURE__ */ JSON.parse('[{"display_name":"3D Rigging","job_set_type":"3d_rigging","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height_meters","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true}]},{"display_name":"Brain Activity","job_set_type":"brain_activity","type":"text","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Bytedance Image Upscale","job_set_type":"bytedance_image_upscale","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"4k","required":false,"enum":["2k","4k"]}]},{"display_name":"Bytedance Video Upscale","job_set_type":"bytedance_video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"fps","type":"integer","default":24,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"model_version","type":"string","default":"standard","required":false,"enum":["standard","pro"]},{"name":"preset","type":"string","default":"common","required":false,"enum":["common","aigc","short_series","ugc","old_film"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1080p","2k","4k"]}]},{"display_name":"Cinematic Studio 2.5","job_set_type":"cinematic_studio_2_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"auto","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio 3.0","job_set_type":"cinematic_studio_3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Cinematic Studio Image","job_set_type":"cinematic_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"string","default":null,"required":true},{"name":"camera_lens_id","type":"string","default":null,"required":true},{"name":"camera_model_id","type":"string","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio Soul Cast","job_set_type":"cinematic_studio_soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinematic Studio Soul Location","job_set_type":"cinematic_studio_soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Cinematic Studio Video","job_set_type":"cinematic_studio_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"slow_motion","type":"boolean","default":false,"required":false},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Cinematic Studio Video 3.5","job_set_type":"cinematic_studio_video_3_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"camera_style","type":"object","default":null,"required":false},{"name":"color_grading","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"light_scheme","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"style_id","type":"object","default":null,"required":false},{"name":"style_prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinema Studio 4.0","job_set_type":"cinematic_studio_video_4_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"color_palette","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"era_id","type":"object","default":null,"required":false},{"name":"extension_mode","type":"object","default":null,"required":false},{"name":"film_era","type":"null","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"null","default":null,"required":false},{"name":"genre_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"light","type":"object","default":null,"required":false},{"name":"light_custom","type":"object","default":null,"required":false},{"name":"light_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"model","type":"string","default":"default","required":false,"enum":["default","video_edit","video_extension"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"pacing_id","type":"object","default":null,"required":false},{"name":"preset_id","type":"null","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"speedramp","type":"object","default":"auto","required":false},{"name":"use_blur","type":"boolean","default":false,"required":false},{"name":"use_eye_mask","type":"boolean","default":false,"required":false},{"name":"use_transparency","type":"boolean","default":false,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Cinematic Studio Video V2","job_set_type":"cinematic_studio_video_v2","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"cfg_scale","type":"number","default":0.5,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","western","suspense","intimate","spectacle"]},{"name":"kling_element_ids","type":"array","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Clipify","job_set_type":"clipify","type":"video","params":[{"name":"clip_aspect","type":"string","default":"9:16","required":false,"enum":["9:16","1:1","16:9"]},{"name":"clips_num","type":"integer","default":10,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"max_height","type":"integer","default":1080,"required":false},{"name":"segment_seconds","type":"integer","default":10,"required":false},{"name":"subtitle_case","type":"string","default":"as-is","required":false,"enum":["lower","upper","as-is"]},{"name":"subtitle_font","type":"string","default":"notosans","required":false},{"name":"subtitle_highlight_hex","type":"string","default":"#FFE84D","required":false},{"name":"subtitle_position","type":"string","default":"bottom","required":false,"enum":["bottom","center","top"]},{"name":"track_face_crop","type":"boolean","default":true,"required":false},{"name":"urls","type":"array","default":null,"required":true}]},{"display_name":"Draw To Video","job_set_type":"draw_to_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"ref_image","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"sketch","type":"object","default":null,"required":true},{"name":"video","type":"object","default":null,"required":true}]},{"display_name":"dubbing","job_set_type":"dubbing","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"target_language","type":"string","default":null,"required":true,"enum":["eng","cmn","fra","hin","ita","jpn","kor","por","rus","tur","spa","deu","ara","pol","ind","fil","swe","fin"]}]},{"display_name":"Explainer Video","job_set_type":"explainer_video","type":"video","params":[{"name":"height","type":"integer","default":null,"required":true},{"name":"items","type":"array","default":null,"required":true},{"name":"subtitles","type":"object","default":null,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"FLUX.2","job_set_type":"flux_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"pro","required":false,"enum":["pro","flex","max"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"FLUX.2 Pro Outpaint","job_set_type":"flux_2_pro_outpaint","type":"image","params":[{"name":"expand_bottom","type":"integer","default":0,"required":false},{"name":"expand_left","type":"integer","default":0,"required":false},{"name":"expand_right","type":"integer","default":0,"required":false},{"name":"expand_top","type":"integer","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"FLUX 3 Video","job_set_type":"flux_3_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Flux Kontext","job_set_type":"flux_kontext","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Gemini Omni Flash","job_set_type":"gemini_omni","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"integer","default":8,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false}]},{"display_name":"GPT Image 2","job_set_type":"gpt_image_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"high","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"GPT Image 2.5","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","16:9","9:16","21:9","27:16","16:27","9:8","8:9"]},{"name":"background","type":"string","default":null,"required":false,"enum":["auto","opaque","transparent"]},{"name":"image_references","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"low","required":false,"enum":["low","medium","high","xhigh","max"]},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]},{"name":"variant","type":"string","default":"flare","required":false,"enum":["flare","sunburst"]}],"type":"image","job_set_type":"gpt_image_2_5"},{"display_name":"Grok Image","job_set_type":"grok_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","1:2","2:1","3:2","2:3","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","quality"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Grok Video","job_set_type":"grok_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Grok Video 1.5","job_set_type":"grok_video_v15","type":"video","params":[{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Happy Horse Video","job_set_type":"happy_horse_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Hunyuan 3D v3.1 Text to 3D","job_set_type":"hunyuan3d_v3_1_text_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Hunyuan3D v3 Image to 3D","job_set_type":"hunyuan3d_v3_image_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"integer","default":500000,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"string","default":"Normal","required":false,"enum":["Normal","LowPoly","Geometry"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"polygon_type","type":"string","default":"triangle","required":false,"enum":["triangle","quadrilateral"]}]},{"display_name":"Image Auto","job_set_type":"image_auto","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Image Background Remover","job_set_type":"image_background_remover","type":"image","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Image Decompose","job_set_type":"image_decompose","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"granular","required":false,"enum":["granular","standard"]}]},{"display_name":"Image to 3D","job_set_type":"image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Inworld Text to Speech","job_set_type":"inworld_text_to_speech","type":"audio","params":[{"name":"prompt","type":"string","default":null,"required":true},{"name":"voice","type":"string","default":null,"required":true}]},{"display_name":"Kimodo","job_set_type":"kimodo","type":"3d","params":[{"name":"diffusion_steps","type":"integer","default":10,"required":false},{"name":"duration","type":"object","default":null,"required":false},{"name":"durations","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_version","type":"string","default":"ardy-core","required":false,"enum":["ardy-core","ardy-core-h8"]},{"name":"prompt","type":"object","default":null,"required":false},{"name":"prompts","type":"object","default":null,"required":false},{"name":"seed","type":"integer","default":42,"required":false}]},{"display_name":"Kling O1 Image","job_set_type":"kling_omni_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","auto","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Kling 2.6 Video","job_set_type":"kling2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Kling v3.0","job_set_type":"kling3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std","4k"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]}]},{"display_name":"Kling 3.0 Motion Control","job_set_type":"kling3_0_motion_control","type":"video","params":[{"name":"background_source","type":"string","default":"input_image","required":false,"enum":["input_image","input_video"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","pro"]}]},{"display_name":"Kling 3.0 Turbo","job_set_type":"kling3_0_turbo","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"LLM Generation","job_set_type":"llm_text","type":"video","params":[{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":null,"required":true},{"name":"reasoning_effort","type":"object","default":null,"required":false},{"name":"system_prompt","type":"string","default":"","required":false},{"name":"user_prompt","type":"string","default":"","required":false}]},{"display_name":"Marketing Studio Image","job_set_type":"marketing_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Marketing Studio Video","job_set_type":"marketing_studio_video","type":"video","params":[{"name":"ad_reference_id","type":"object","default":null,"required":false},{"name":"aspect_ratio","type":"string","default":"9:16","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"avatar_ids","type":"array","default":null,"required":false},{"name":"avatars","type":"array","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"hook_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"ugc","required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"setting_id","type":"object","default":null,"required":false},{"name":"specific_mode","type":"string","default":"default","required":false,"enum":["default","web_product","from_storyboard"]},{"name":"storyboard_id","type":"object","default":null,"required":false},{"name":"web_product_ids","type":"array","default":null,"required":false},{"name":"web_product_type","type":"object","default":null,"required":false}]},{"display_name":"Meshy 5 Remesh","job_set_type":"meshy_v5_remesh","type":"3d","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true},{"name":"origin_at","type":"object","default":null,"required":false},{"name":"resize_height","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Meshy 6 Text to 3D","job_set_type":"meshy_v6_text_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"enable_prompt_expansion","type":"boolean","default":false,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"full","required":false},{"name":"model_type","type":"string","default":"standard","required":false},{"name":"pose_mode","type":"string","default":"","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"boolean","default":true,"required":false},{"name":"symmetry_mode","type":"string","default":"auto","required":false},{"name":"target_polycount","type":"integer","default":30000,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"string","default":"triangle","required":false}]},{"display_name":"MiniMax H3","job_set_type":"minimax_h3","type":"video","params":[{"name":"aigc_watermark","type":"boolean","default":false,"required":false},{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":4,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"resolution","type":"string","default":"2K","required":false,"enum":["768P","2K"]},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Minimax Hailuo","job_set_type":"minimax_hailuo","type":"video","params":[{"name":"duration","type":"string","default":6,"required":false,"enum":["6","10"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"minimax-2.3","required":false,"enum":["minimax","minimax-fast","minimax-2.3","minimax-2.3-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"768","required":false,"enum":["512","768","1080"]}]},{"display_name":"Mirelo Text to Audio","job_set_type":"mirelo_text_to_audio","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"MS Image","job_set_type":"ms_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"avatars","type":"array","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"brand_kit_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"low","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Multi-Image to 3D","job_set_type":"multi_image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Nano Banana","job_set_type":"nano_banana","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_ai_stylist","type":"image","params":[{"name":"background_preset_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"outfit_preset_ids","type":"array","default":null,"required":false},{"name":"pose_preset_id","type":"object","default":null,"required":false},{"name":"user_outfit_ids","type":"array","default":null,"required":false}]},{"display_name":"Nano Banana 2 Lite","job_set_type":"nano_banana_2_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"thinking","type":"string","default":"HIGH","required":false,"enum":["MINIMAL","HIGH"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_relight","type":"image","params":[{"name":"brightness","type":"integer","default":null,"required":true},{"name":"color","type":"string","default":null,"required":true},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"light_quality","type":"string","default":null,"required":true,"enum":["hard","sharp","soft"]},{"name":"light_source","type":"string","default":null,"required":true,"enum":["mdl","mdr","mul","mur","bml","fml","fmr","bmm","mml","mmr","fmm","bmr","mdm","mum","bdr","fdl","bur","ful","bdl","fdr","bul","fur","bdm","fdm","bum","fum"]},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_shots","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_skin_enhancer","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"preset_id","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana 2","job_set_type":"nano_banana_flash","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"OpenAI Hazel","job_set_type":"openai_hazel","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","auto"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"medium","required":false,"enum":["low","medium","high"]}]},{"display_name":"Outpaint","job_set_type":"outpaint","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"21:9","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Qwen Audio 3.0 TTS Flash","job_set_type":"qwen_audio_tts","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"instruction","type":"object","default":null,"required":false},{"name":"language","type":"object","default":null,"required":false},{"name":"pitch_rate","type":"number","default":1,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","22050","24000","44100","48000"]},{"name":"seed","type":"integer","default":0,"required":false},{"name":"speech_rate","type":"number","default":1,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"integer","default":50,"required":false}]},{"display_name":"Angles","job_set_type":"qwen_camera_control","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"move_forward_level","type":"integer","default":0,"required":false},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"rotate_degree","type":"integer","default":0,"required":false},{"name":"vertical_angle","type":"integer","default":0,"required":false},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Recraft V4.1","job_set_type":"recraft_v4_1","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:4","4:3","4:5","5:4","3:2","2:3","16:9","9:16","21:9"]},{"name":"background_color","type":"object","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"colors","type":"array","default":null,"required":false},{"name":"model_type","type":"string","default":"standard","required":false,"enum":["standard","vector","utility","utility_vector"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Reframe","job_set_type":"reframe","type":"video","params":[{"name":"aspect_ratio","type":"string","default":null,"required":true,"enum":["21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"3D Objects","job_set_type":"sam_3_3d","type":"3d","params":[{"name":"detection_threshold","type":"object","default":null,"required":false},{"name":"export_textured_glb","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"3D Body","job_set_type":"sam_3_3d_body","type":"3d","params":[{"name":"export_meshes","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"include_3d_keypoints","type":"boolean","default":true,"required":false},{"name":"include_mhr_params","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Remove Background","job_set_type":"sam_3_video","type":"video","params":[{"name":"apply_mask","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false}]},{"display_name":"Seed Audio 1.0","job_set_type":"seed_audio","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"expression_intensity","type":"integer","default":5,"required":false},{"name":"format","type":"string","default":"wav","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"loudness_rate","type":"integer","default":0,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mood","type":"number","default":0,"required":false},{"name":"pitch_rate","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","24000","32000","44100","48000"]},{"name":"speech_rate","type":"integer","default":0,"required":false},{"name":"voice_id","type":"object","default":null,"required":false},{"name":"voice_style","type":"object","default":null,"required":false},{"name":"voice_type","type":"object","default":null,"required":false},{"name":"voices","type":"array","default":null,"required":false}]},{"display_name":"Seedance 2.0","job_set_type":"seedance_2_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]}]},{"display_name":"Seedance 2.0 Mini","job_set_type":"seedance_2_0_mini","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p"]}]},{"display_name":"Seedance 2.5","job_set_type":"seedance_2_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"audio_references","type":"array","default":null,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"end_image","type":"object","default":null,"required":false},{"name":"extension_mode","type":"string","default":null,"required":false,"enum":["backward","forward"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"image_references","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"t2v","required":false,"enum":["t2v","omni_reference","video_edit","video_extension"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"start_image","type":"object","default":null,"required":false},{"name":"video_references","type":"array","default":null,"required":false}]},{"display_name":"Seedance 1.5 Pro","job_set_type":"seedance1_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"duration","type":"string","default":4,"required":false,"enum":["4","8","12"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Seedream 4.5","job_set_type":"seedream_v4_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","4:3","16:9","3:2","21:9","3:4","9:16","2:3"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Lite","job_set_type":"seedream_v5_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Pro","job_set_type":"seedream_v5_pro","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"height","type":"object","default":null,"required":false},{"name":"is_inpaint","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","1.5k","2k"]},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Sonilo Music","job_set_type":"sonilo_music","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Soul Cast","job_set_type":"soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"soul_cinema_studio","job_set_type":"soul_cinema_studio","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Soul Cinematic","job_set_type":"soul_cinematic","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]}]},{"display_name":"Soul Location","job_set_type":"soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Sync Lipsync 3","job_set_type":"sync_so","type":"video","params":[{"name":"input_video","type":"object","default":null,"required":true},{"name":"input_audio","type":"object","default":null,"required":true},{"name":"sync_mode","type":"string","default":"bounce","required":false,"enum":["bounce","loop","cut_off","silence","remap"]},{"name":"folder_id","type":"string","default":null,"required":false}]},{"display_name":"Higgsfield Soul 2.0","job_set_type":"text2image_soul_v2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"Text to Speech V2","job_set_type":"text2speech_v2","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"emotion","type":"object","default":null,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["mp3","wav"]},{"name":"language_boost","type":"string","default":"auto","required":false,"enum":["auto","af","ar","bg","ca","cs","da","de","el","en","es","fa","fi","fil","fr","he","hi","hr","hu","id","it","ja","ko","ms","nl","nn","no","pl","pt","ro","ru","sk","sl","sv","ta","th","tr","uk","vi","yue","zh"]},{"name":"model","type":"string","default":null,"required":true,"enum":["elevenlabs","minimax","seed_speech","vibe_voice","cozy_voice"]},{"name":"pitch","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":32000,"required":false,"enum":["8000","16000","22050","24000","32000","44100"]},{"name":"speed","type":"number","default":1,"required":false},{"name":"stability","type":"object","default":null,"required":false},{"name":"text_normalization","type":"boolean","default":false,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"number","default":1,"required":false}]},{"display_name":"Topaz","params":[{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"string","default":null,"required":false},{"name":"image_references","type":"array","default":null,"required":true},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"sharpen","type":"number","default":0,"required":false},{"name":"variant","type":"string","default":"Standard V2","required":false,"enum":["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"]}],"type":"image","job_set_type":"topaz_image"},{"display_name":"Topaz","job_set_type":"topaz_image_generative","type":"image","params":[{"name":"autoprompt","type":"boolean","default":true,"required":false},{"name":"creativity","type":"integer","default":1,"required":false},{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Redefine","required":false,"enum":["Standard MAX","Redefine","Recovery","Recovery V2"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"sharpen","type":"number","default":0,"required":false},{"name":"texture","type":"integer","default":1,"required":false}]},{"display_name":"Topaz","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"enhancement","type":"object","default":null,"required":false},{"name":"frame_interpolation","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"1080p","required":false,"enum":["1080p","2160p"]},{"name":"video_references","type":"array","default":null,"required":true}],"type":"video","job_set_type":"topaz_video"},{"display_name":"Text to 3D","job_set_type":"tripo_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"negative_prompt","type":"object","default":null,"required":false},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]}]},{"display_name":"Tripo H3.1 Image to 3D","job_set_type":"tripo_h3_1_image_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Tripo H3.1 Multiview to 3D","job_set_type":"tripo_h3_1_multiview_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Google Veo 3","job_set_type":"veo3","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"veo-3-fast","required":false,"enum":["veo-3-preview","veo-3-fast"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Google Veo 3.1","job_set_type":"veo3_1","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"model","type":"string","default":"veo-3-1-fast","required":false,"enum":["veo-3-1-preview","veo-3-1-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high","ultra"]}]},{"display_name":"Google Veo 3.1 Lite","job_set_type":"veo3_1_lite","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","auto"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Video Background Remover","job_set_type":"video_background_remover","type":"video","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Video Deflicker","job_set_type":"video_deflicker","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"Video Upscale","job_set_type":"video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"voice_change","job_set_type":"voice_change","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":"preset","required":false,"enum":["preset","element"]}]},{"display_name":"Wan 2.6 Video","job_set_type":"wan2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10","15"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 2.7","job_set_type":"wan2_7","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 3.0","job_set_type":"wan3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enable_thinking","type":"boolean","default":false,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Z Image","job_set_type":"z_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"prompt","type":"string","default":null,"required":true}]}]'), Vd = {
  models: Bd
}, Gd = Vd, Is = Gd.models, Hd = {
  text2image_soul_v2: "hf-soul-v2",
  nano_banana_2: "hf-nano-banana-pro",
  gpt_image_2: "hf-gpt-image-2",
  seedance_2_0: "hf-seedance-2",
  kling3_0: "hf-kling-3",
  veo3_1: "hf-veo-3-1"
}, zd = /* @__PURE__ */ new Set([
  "input_image",
  "ref_image",
  "sketch",
  "texture_image_url"
]), Wd = /* @__PURE__ */ new Set(["input_images", "image_references"]), Xd = /* @__PURE__ */ new Set(["input_video", "video"]), Jd = /* @__PURE__ */ new Set(["input_audio"]);
function ji(t) {
  return t.split(/[_-]+/).filter(Boolean).map((e) => e.charAt(0).toUpperCase() + e.slice(1)).join(" ");
}
function Kd(t) {
  return Hd[t] ?? `hf-${t.replaceAll("_", "-")}`;
}
function Yd(t) {
  return t === "3d" ? "model3d" : t;
}
function Qd(t, e) {
  let r, n, i = !1;
  if (zd.has(e.name) ? (r = "image", n = t.type === "video" && e.name === "input_image" ? "start_image" : "image") : Wd.has(e.name) ? (r = "image", n = "image", i = !0) : e.name === "video_references" ? (r = "video", n = "video", i = !0) : e.name === "audio_references" ? (r = "audio", n = "audio", i = !0) : Xd.has(e.name) ? (r = "video", n = "video") : Jd.has(e.name) ? (r = "audio", n = "audio") : e.name === "model_url" ? r = "model3d" : e.name === "urls" ? (r = "media", i = !0) : e.name === "medias" && (i = !0, t.type === "image" || t.type === "3d" ? (r = "image", n = "image") : t.type === "text" ? (r = "video", n = "video") : r = "media"), !!r)
    return {
      id: e.name,
      portType: r,
      label: ji(e.name),
      required: e.required,
      falParam: e.name,
      fieldType: "port",
      schemaType: e.type,
      multiple: i,
      mediaRole: n,
      ...e.default !== void 0 ? { default: e.default } : {}
    };
}
function Zd(t, e) {
  var i;
  const r = Qd(t, e);
  if (r) return r;
  const n = {
    id: e.name,
    portType: "config",
    label: ji(e.name),
    required: e.required,
    falParam: e.name,
    schemaType: e.type,
    ...e.default !== void 0 ? { default: e.default } : {}
  };
  return e.type === "string" ? (i = e.enum) != null && i.length ? {
    ...n,
    portType: "text",
    fieldType: "select",
    options: e.enum.map((o) => ({ value: o, label: o }))
  } : /(^|_)prompt$/.test(e.name) || e.name === "instruction" ? { ...n, portType: "text", fieldType: "port" } : { ...n, portType: "text", fieldType: "text" } : e.type === "integer" || e.type === "number" ? { ...n, portType: "number", fieldType: "number" } : e.type === "boolean" ? { ...n, fieldType: "toggle" } : {
    ...n,
    fieldType: "json",
    placeholder: e.type === "array" ? "[]" : e.type === "object" ? "{}" : "null"
  };
}
function ec(t, e) {
  var r, n, i, o, a;
  if (t.job_set_type === "topaz_image") {
    if (["output_width", "output_height"].includes(e.id)) return { ...e, min: 1, step: 1, label: e.id === "output_width" ? "Output width (px)" : "Output height (px)" };
    if (["sharpen", "denoise", "face_enhancement_strength", "face_enhancement_creativity"].includes(e.id)) return { ...e, min: 0, max: 1, step: 0.05 };
  }
  if (t.job_set_type !== "seedance_2_5") return e;
  if (e.id === "aspect_ratio") {
    const s = {
      auto: "Match reference",
      "21:9": "Cinematic (21:9)",
      "16:9": "Widescreen (16:9)",
      "4:3": "Classic (4:3)",
      "1:1": "Square (1:1)",
      "3:4": "Portrait (3:4)",
      "9:16": "Vertical (9:16)"
    };
    return {
      ...e,
      description: "Shape of the generated video.",
      options: (r = e.options) == null ? void 0 : r.map((l) => ({ ...l, label: s[l.value] ?? l.label }))
    };
  }
  if (e.id === "duration")
    return {
      ...e,
      fieldType: "range",
      min: 5,
      max: 30,
      step: 1,
      description: "Length of the generated clip."
    };
  if (e.id === "resolution") {
    const s = {
      "480p": "480p · Draft",
      "720p": "720p · HD",
      "1080p": "1080p · Full HD"
    };
    return {
      ...e,
      description: "Higher resolution takes longer and may cost more.",
      options: (n = e.options) == null ? void 0 : n.map((l) => ({ ...l, label: s[l.value] ?? l.label }))
    };
  }
  if (e.id === "generate_audio")
    return { ...e, label: "Generate audio", description: "Create synchronized sound with the video." };
  if (e.id === "bitrate_mode") {
    const s = {
      standard: "Standard · Smaller file",
      high: "High · Best quality"
    };
    return {
      ...e,
      label: "Quality",
      description: "High quality uses more processing and creates a larger file.",
      options: (i = e.options) == null ? void 0 : i.map((l) => ({ ...l, label: s[l.value] ?? l.label }))
    };
  }
  if (e.id === "mode") {
    const s = {
      t2v: "Auto (recommended)",
      omni_reference: "Reference images",
      video_edit: "Edit a video",
      video_extension: "Extend a video"
    };
    return {
      ...e,
      label: "Generation mode",
      description: "Auto switches modes when something is connected to References.",
      options: (o = e.options) == null ? void 0 : o.map((l) => ({ ...l, label: s[l.value] ?? l.label }))
    };
  }
  return e.id === "extension_mode" ? {
    ...e,
    label: "Extension direction",
    description: "Choose which side of the connected video to extend.",
    options: (a = e.options) == null ? void 0 : a.map((s) => ({
      ...s,
      label: s.value === "forward" ? "Continue forward" : "Build backward"
    }))
  } : e;
}
function tc(t, e) {
  const r = (n, i, o, a, s = !1) => ({
    id: n,
    portType: o,
    label: i,
    required: !1,
    falParam: e.name,
    fieldType: "port",
    schemaType: e.type,
    mediaRole: a,
    multiple: s
  });
  return t.job_set_type === "text2image_soul_v2" && e.name === "medias" ? [r("image_url", "Reference Image", "image", "image")] : t.job_set_type === "nano_banana_2" && e.name === "input_images" ? [r("image_url", "Reference Images", "image", "image", !0)] : t.job_set_type === "gpt_image_2" && e.name === "medias" ? [r("image_url", "Reference Images", "image", "image", !0)] : t.job_set_type === "seedance_2_0" && e.name === "medias" ? [
    r("start_image_url", "First Frame", "image", "start_image"),
    r("end_image_url", "Last Frame", "image", "end_image"),
    r("image_references", "Image References", "image", "image", !0),
    r("video_references", "Video References", "video", "video", !0),
    r("audio_references", "Audio References", "audio", "audio", !0)
  ] : t.job_set_type === "kling3_0" && e.name === "medias" ? [
    r("start_image_url", "First Frame", "image", "start_image"),
    r("end_image_url", "Last Frame", "image", "end_image")
  ] : t.job_set_type === "veo3_1" && e.name === "input_image" ? [r("start_image_url", "First Frame", "image", "start_image")] : [];
}
const rc = ["prompt", "user_prompt", "instruction"];
function nc(t) {
  for (const e of rc) {
    const r = t.findIndex((n) => n.id === e);
    if (r > 0) return [t[r], ...t.slice(0, r), ...t.slice(r + 1)];
    if (r === 0) return t;
  }
  return t;
}
function ic(t) {
  return t.job_set_type !== "seedance_2_5" ? [] : [{
    id: "medias",
    portType: "media",
    label: "References",
    required: !1,
    falParam: "medias",
    fieldType: "port",
    schemaType: "array",
    multiple: !0
  }];
}
function oc(t = Is) {
  var r;
  const e = {};
  for (const n of t) {
    const i = Kd(n.job_set_type), o = Yd(n.type);
    if (e[i]) throw new Error(`Duplicate Higgsfield node type: ${i}`);
    const a = nc(n.params.flatMap((l) => [
      ec(n, Zd(n, l)),
      ...tc(n, l)
    ])), s = a.findIndex((l) => l.id === "prompt") + 1;
    a.splice(s, 0, ...ic(n)), e[i] = {
      id: n.job_set_type,
      nodeType: i,
      name: n.job_set_type === "topaz_image" ? "Topaz Image Upscale" : n.job_set_type === "topaz_video" ? "Topaz Video Upscale" : n.display_name,
      category: o,
      description: `Higgsfield ${n.type.toUpperCase()} model`,
      inputs: a,
      outputType: o,
      outputs: [{ id: o, portType: o, label: o === "model3d" ? "3D Model" : ji(o) }],
      provider: "higgsfield",
      ...n.job_set_type === "sync_so" && typeof window < "u" && ["darwin", "win32", "linux"].includes(((r = window.electronAPI) == null ? void 0 : r.platform) ?? "") ? { unavailableReason: "Sync Lipsync 3 is available in CineGen on the web and through MCP. The current Mac connection does not expose this model." } : {},
      responseMapping: { path: o === "text" ? "text" : "output.url" }
    };
  }
  return e;
}
const zw = oc();
function xs(t, e, r = Is) {
  if (!e) return e;
  const n = r.find((a) => a.job_set_type === t);
  if (!n) return e;
  const i = new Set(n.params.map((a) => a.name)), o = {};
  for (const [a, s] of Object.entries(e))
    i.has(a) && (o[a] = s);
  return o;
}
const ac = {
  image: "--image",
  start_image: "--start-image",
  end_image: "--end-image",
  video: "--video",
  audio: "--audio"
}, As = /^[A-Za-z][A-Za-z0-9_]*$/, ks = /* @__PURE__ */ new Set(["json", "wait", "no_color"]);
function sc(t) {
  const e = ["generate", "create", t.model], r = {
    ...xs(t.model, { ...t.extra, ...t.params }) ?? {}
  }, n = (o, a) => {
    if (a == null) return;
    if (!As.test(o) || ks.has(o))
      throw new Error(`Invalid Higgsfield parameter name: ${o}`);
    let s;
    if (typeof a == "string")
      s = o === "prompt" ? a.trim() : a;
    else if (typeof a == "number") {
      if (!Number.isFinite(a)) throw new Error(`Higgsfield parameter ${o} must be finite`);
      s = String(a);
    } else if (typeof a == "boolean")
      s = a ? "true" : "false";
    else if (typeof a == "object")
      try {
        const l = JSON.stringify(a);
        if (l === void 0) throw new Error("not JSON serializable");
        s = l;
      } catch (l) {
        throw new Error(`Higgsfield parameter ${o} must be JSON serializable`, { cause: l });
      }
    else
      throw new Error(`Higgsfield parameter ${o} has an unsupported value type`);
    e.push(`--${o}`, s);
  };
  if (Ss(t.model)) {
    if (Fd(t.model, r, t.medias ?? []), t.model === "sync_so") throw new Error("Sync Lipsync 3 is available through Higgsfield MCP in the CineGen website. The current Higgsfield desktop CLI does not expose this model. No generation was submitted.");
    for (const o of ["image_references", "video_references", "input_video", "input_audio"]) delete r[o];
  }
  const i = t.prompt !== void 0 ? t.prompt : r.prompt;
  delete r.prompt, n("prompt", i);
  for (const o of t.medias ?? [])
    o.value && e.push(ac[o.role], o.value);
  t.aspectRatio !== void 0 && (delete r.aspect_ratio, n("aspect_ratio", t.aspectRatio)), t.durationSec !== void 0 && (delete r.duration, t.durationSec > 0 && n("duration", t.durationSec)), t.count !== void 0 && (delete r.count, t.count >= 1 && n("count", t.count));
  for (const [o, a] of Object.entries(r))
    n(o, a);
  return e.push("--json"), e;
}
class Yn extends Error {
  constructor(e, r = "", n = "") {
    super(e), this.name = "HiggsfieldCliError", this.stdout = r, this.stderr = n;
  }
}
function Qn(t) {
  return /HTTP\s*50[234]|50[234]\s+[\w\s]*Unavailable|502 Bad Gateway|504 Gateway|ECONNRESET|ETIMEDOUT|socket hang up|no response received|HTTP\s*429|rate limit|temporarily unavailable|service unavailable/i.test(t);
}
const lc = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function uc(t) {
  return /^(queued|queue|pending|running|processing|waiting|in_progress|ns|created)$/.test(t.trim());
}
function Ri(t, e) {
  if (!("outputs" in t) && !("mediaType" in t)) return !1;
  const r = t;
  return typeof r.url == "string" && r.url.trim() ? !0 : e === "text" && typeof r.text == "string" && !!r.text.trim();
}
function dc(t) {
  for (const e of ["results", "jobs"]) {
    const r = t[e];
    if (Array.isArray(r) && r.length > 0 && ze(r[0])) return r[0];
  }
  return t;
}
function Pi(t) {
  const e = t.trim();
  if (!e) throw new Error("Higgsfield CLI returned no output");
  const r = (a) => Array.isArray(a) ? { results: a } : ze(a) ? a : { result: a };
  let n = null;
  try {
    n = r(JSON.parse(e));
  } catch {
    for (const a of e.split(/\r?\n/).reverse()) {
      const s = a.trim();
      if (!(!s.startsWith("{") && !s.startsWith("[")))
        try {
          n = r(JSON.parse(s));
          break;
        } catch {
        }
    }
  }
  if (!n) throw new Error("Higgsfield CLI output was not valid JSON");
  const i = dc(n), o = i.job_id ?? i.id ?? i.jobId;
  return {
    status: String(i.state ?? i.status ?? "").toLowerCase(),
    jobId: typeof o == "string" && o.trim() ? o.trim() : void 0,
    record: i,
    parsed: n
  };
}
function No(...t) {
  var r;
  const e = t.filter(Boolean).join(`
`);
  try {
    const n = Pi(e).jobId;
    if (n) return n;
  } catch {
  }
  return (r = e.match(lc)) == null ? void 0 : r[0];
}
function ze(t) {
  return !!t && typeof t == "object" && !Array.isArray(t);
}
const cc = /* @__PURE__ */ new Set(["params", "prompt", "input_images", "inputs", "extra", "request"]), Co = [
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
], qo = [
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
function wt(t, e = 0) {
  if (e > 12) return [];
  if (typeof t == "string") {
    const n = t.trim().replace(/[),.;]+$/, "");
    return /^https?:\/\//i.test(n) ? [n] : [];
  }
  if (Array.isArray(t))
    return [...new Set(t.flatMap((n) => wt(n, e + 1)))];
  if (!ze(t)) return [];
  const r = [];
  for (const n of Co)
    t[n] !== void 0 && r.push(...wt(t[n], e + 1));
  if (typeof t.result_json == "string" && t.result_json.trim())
    try {
      r.push(...wt(JSON.parse(t.result_json), e + 1));
    } catch {
    }
  for (const n of qo)
    t[n] !== void 0 && r.push(...wt(t[n], e + 1));
  for (const [n, i] of Object.entries(t))
    cc.has(n) || Co.includes(n) || qo.includes(n) || n === "result_json" || (ze(i) || Array.isArray(i)) && r.push(...wt(i, e + 1));
  return [...new Set(r)];
}
const fc = /https?:\/\/[^\s"'<>\\]+/gi;
function js(t) {
  const e = t.match(fc) ?? [];
  return [...new Set(e.map((r) => r.replace(/[),.;]+$/, "")))].filter((r) => /^https?:\/\//i.test(r) && !/higgsfield\.ai\/(docs|cli|skills)/i.test(r));
}
function Cr(t, e = 0) {
  if (e > 12) return;
  if (typeof t == "string") {
    const n = t.trim();
    return n && !/^https?:\/\//i.test(n) ? n : void 0;
  }
  if (Array.isArray(t)) {
    for (const n of t) {
      const i = Cr(n, e + 1);
      if (i) return i;
    }
    return;
  }
  if (!ze(t)) return;
  for (const n of ["text", "output_text", "result_text", "response_text", "answer", "content"]) {
    const i = t[n];
    if (typeof i == "string") {
      const o = i.trim();
      if (o && !/^https?:\/\//i.test(o)) return o;
    }
  }
  const r = t.result_json;
  if (typeof r == "string" && r.trim()) {
    try {
      const n = Cr(JSON.parse(r), e + 1);
      if (n) return n;
    } catch {
    }
    return r.trim();
  }
  for (const n of ["output", "result", "data", "job", "results", "outputs", "items"]) {
    const i = Cr(t[n], e + 1);
    if (i) return i;
  }
}
function Rs(t, e) {
  const r = Pi(t);
  if (r.status === "failed" || r.status === "error" || r.status === "fail")
    throw new Error(typeof r.record.error == "string" ? r.record.error : "Higgsfield generation failed");
  if (uc(r.status))
    throw new Error("Higgsfield job is still running");
  const n = Oi(r, e);
  if (e.mediaType === "text") {
    if (!n.url && !n.text) throw new Error("Higgsfield generation finished without a media URL or text output");
    return n;
  }
  if (n.url) return n;
  const i = js(t);
  if (i[0])
    return { ...n, url: i[0], urls: i, outputs: i.map((o) => ({ kind: e.mediaType, url: o })) };
  throw new Error("Higgsfield generation finished without a media URL");
}
function Oi(t, e) {
  var l;
  const r = wt(t.parsed), n = r[0], i = Cr(t.parsed), o = t.record.duration ?? ((l = t.record.output) == null ? void 0 : l.duration), a = e.mediaType, s = r.map((u) => ({ kind: a, url: u }));
  return i && s.push({ kind: "text", text: i }), {
    ...n ? { url: n, urls: r } : {},
    ...i ? { text: i } : {},
    mediaType: a,
    outputKind: a,
    outputs: s,
    durationSec: typeof o == "number" ? o : typeof o == "string" && Number.isFinite(Number(o)) ? Number(o) : void 0,
    jobId: t.jobId,
    model: e.model
  };
}
function Et(t) {
  return t instanceof Error ? t.message : String(t);
}
function Ps(t) {
  return t instanceof Yn ? { stdout: t.stdout, stderr: t.stderr } : { stdout: "", stderr: "" };
}
async function Zn(t, e) {
  if (t.trim())
    try {
      return Rs(t, e);
    } catch {
      return;
    }
}
function pc(t = z.homedir()) {
  return [
    w.join(t, ".npm-global/bin/higgsfield"),
    w.join(t, ".npm-global/bin/higgs"),
    w.join(t, ".local/bin/higgsfield"),
    w.join(t, ".local/bin/higgs"),
    "/opt/homebrew/bin/higgsfield",
    "/opt/homebrew/bin/higgs",
    "/usr/local/bin/higgsfield",
    "/usr/local/bin/higgs",
    "higgsfield",
    "higgs"
  ];
}
function mc(t) {
  return !t.includes("/") && !t.includes("\\");
}
function hc(t = pc(), e = (r) => {
  try {
    return D.existsSync(r);
  } catch {
    return !1;
  }
}) {
  const r = [], n = [];
  for (const i of t) {
    if (mc(i)) {
      n.includes(i) || n.push(i);
      continue;
    }
    e(i) && !r.includes(i) && r.push(i);
  }
  return [...r, ...n];
}
function gc() {
  const t = z.homedir(), e = [w.join(t, ".npm-global/bin"), w.join(t, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...process.env, PATH: [...e, process.env.PATH ?? ""].filter(Boolean).join(w.delimiter), NO_COLOR: "1" };
}
const Lo = 1260 * 1e3, yc = 9e4, Uo = 4, xn = "Higgsfield CLI not found. Install @higgsfield/cli, then run higgsfield auth login — or connect Higgsfield in Settings.";
function _c(t) {
  if (!t || typeof t != "object") return !1;
  const e = "code" in t ? String(t.code) : "", r = t instanceof Error ? t.message : String(t);
  return e === "ENOENT" || /ENOENT|spawn .* ENOENT/i.test(r);
}
let pt = null;
function wc(t, e, r) {
  return new Promise((n, i) => {
    var u, d;
    const o = ae(t, e, { env: gc() });
    let a = "", s = "";
    const l = setTimeout(() => {
      o.kill("SIGTERM"), i(new Yn("Higgsfield CLI timed out", a, s));
    }, r);
    (u = o.stdout) == null || u.on("data", (c) => {
      a += c.toString();
    }), (d = o.stderr) == null || d.on("data", (c) => {
      s += c.toString();
    }), o.on("error", (c) => {
      clearTimeout(l), i(c);
    }), o.on("close", (c) => {
      if (clearTimeout(l), c === 0) {
        n(a);
        return;
      }
      const p = s.trim() || a.trim() || `Higgsfield CLI exited with code ${c}`, f = /session expired/i.test(p) ? 'Higgsfield is not connected. Run "higgsfield auth login" or connect it in Settings.' : p;
      i(new Yn(f, a, s));
    });
  });
}
async function qe(t, e = 6e4) {
  const r = t.includes("--json") ? t : [...t, "--json"], n = hc(), i = pt ? [pt, ...n.filter((l) => l !== pt)] : n;
  if (i.length === 0) throw new Error(xn);
  let o;
  for (const l of i)
    try {
      const u = await wc(l, r, e);
      return pt = l, u;
    } catch (u) {
      if (_c(u)) {
        pt === l && (pt = null), o = u;
        continue;
      }
      throw u;
    }
  const a = i.join(", "), s = o instanceof Error ? o.message : "";
  throw new Error(s ? `${xn} Tried: ${a}. ${s}` : `${xn} Tried: ${a}.`);
}
const bc = 6e4, Os = {
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
function Ns(t) {
  return t === "video" ? ".mp4" : t === "audio" ? ".mp3" : ".png";
}
function vc(t, e, r) {
  const n = e ? Os[e.split(";", 1)[0].trim().toLowerCase()] : void 0;
  if (n) return n;
  const i = w.extname(t.split(/[?#]/, 1)[0]).toLowerCase();
  return i && i.length <= 5 ? i : Ns(r);
}
async function Tc(t) {
  if (!(t != null && t.length)) return { medias: t, tempPaths: [] };
  const e = [], r = [];
  for (const [n, i] of t.entries()) {
    let o = i.value;
    if (o.startsWith("local-media://file"))
      try {
        o = decodeURIComponent(o.slice(18));
      } catch {
        o = o.slice(18);
      }
    if (/^https?:\/\//i.test(o)) {
      const a = await fetch(o, { signal: AbortSignal.timeout(bc) });
      if (!a.ok) throw new Error(`Failed to download media input (HTTP ${a.status}): ${o}`);
      const s = vc(o, a.headers.get("content-type"), i.role), l = w.join(z.tmpdir(), `cinegen-hf-media-${Date.now()}-${n}${s}`);
      await D.promises.writeFile(l, Buffer.from(await a.arrayBuffer())), e.push(l), r.push({ ...i, value: l });
    } else if (o.startsWith("data:")) {
      const a = o.indexOf(",");
      if (a < 0) throw new Error("Malformed data: URI media input");
      const s = o.slice(5, a), l = s.replace(/;base64$/i, ""), u = o.slice(a + 1), d = /;base64$/i.test(s) ? Buffer.from(u, "base64") : Buffer.from(decodeURIComponent(u)), c = Os[l.toLowerCase()] ?? Ns(i.role), p = w.join(z.tmpdir(), `cinegen-hf-media-${Date.now()}-${n}${c}`);
      await D.promises.writeFile(p, d), e.push(p), r.push({ ...i, value: p });
    } else
      r.push(o === i.value ? i : { ...i, value: o });
  }
  return { medias: r, tempPaths: e };
}
async function ei(t) {
  const { medias: e, tempPaths: r } = await Tc(t.medias);
  let n;
  try {
    n = await Ec({ ...t, medias: e });
  } finally {
    for (const o of r)
      D.promises.unlink(o).catch(() => {
      });
  }
  if (Ri(n, t.mediaType)) return n;
  const i = "jobId" in n ? n.jobId : void 0;
  if (!i) throw new Error("Higgsfield accepted the request but did not return a job id.");
  return t.wait === !1 ? {
    jobId: i,
    model: t.model,
    mediaType: t.mediaType,
    outputKind: t.mediaType,
    outputs: []
  } : Ls(i, t);
}
function Cs(t) {
  return new Promise((e) => setTimeout(e, t));
}
async function Ec(t) {
  const e = sc({ ...t });
  let r;
  for (let n = 1; n <= 3; n++)
    try {
      const i = await qe(e, yc), o = await Zn(i, t);
      if (o) return o;
      const a = No(i);
      if (a) return { jobId: a };
      throw new Error("Higgsfield accepted the request but did not return a job id.");
    } catch (i) {
      r = i;
      const { stdout: o, stderr: a } = Ps(i), s = await Zn(o, t);
      if (s) return s;
      const l = No(o, a, Et(i));
      if (l) return { jobId: l };
      if (!Qn(Et(i)) || n === 3) throw i;
      await Cs(1500 * n);
    }
  throw r instanceof Error ? r : new Error("Higgsfield submit failed");
}
function Sc(t, e) {
  return t.find((r) => r.id === e || r.job_id === e || r.jobId === e || r.job_set_id === e || r.parent_id === e);
}
async function qs(t, e) {
  try {
    const r = await Us({ size: 50 }), n = Sc(r, t);
    if (!n) return;
    const i = Oi({
      status: String(n.status ?? n.state ?? "completed").toLowerCase(),
      jobId: t,
      record: n,
      parsed: n
    }, e);
    return i.url || i.text ? i : void 0;
  } catch {
    return;
  }
}
async function Ni(t, e) {
  const r = await qe(["generate", "get", t], 2e4), n = Pi(r);
  if (n.status === "failed" || n.status === "error" || n.status === "fail")
    throw new Error(typeof n.record.error == "string" ? n.record.error : "Higgsfield generation failed");
  const i = Oi(n, e);
  if (i.url || i.text) return i;
  const o = js(r);
  return o[0] ? { ...i, url: o[0], urls: o, outputs: o.map((a) => ({ kind: e.mediaType, url: a })) } : qs(t, e);
}
async function Ic(t) {
  try {
    return await qe(
      ["generate", "wait", t, "--timeout", "20m", "--interval", "5s"],
      Lo
    );
  } catch (e) {
    if (!/unknown|unexpected|unrecognized/i.test(Et(e))) throw e;
    return qe(
      ["generate", "wait", t, "--wait-timeout", "20m", "--wait-interval", "5s"],
      Lo
    );
  }
}
async function Ls(t, e) {
  let r;
  for (let i = 1; i <= Uo; i++)
    try {
      const o = await Ic(t);
      return Rs(o, e);
    } catch (o) {
      r = o;
      const { stdout: a } = Ps(o), s = await Zn(a, e);
      if (s) return s;
      try {
        const d = await Ni(t, e);
        if (d) return d;
      } catch (d) {
        if (!Qn(Et(d))) throw d;
      }
      const l = Et(o);
      if (!(Qn(l) || /timed out/i.test(l) || /still running/i.test(l) || /without a media URL/i.test(l))) throw o;
      if (i === Uo) break;
      await Cs(2e3 * i);
    }
  const n = await qs(t, e);
  if (n) return n;
  throw new Error(
    `${Et(r)} The job was submitted (${t}) and may still finish on Higgsfield.`
  );
}
function Mo(t) {
  if (Array.isArray(t)) return t.filter((e) => ze(e));
  if (!ze(t)) return [];
  for (const e of ["jobs", "results", "data", "items", "generations"]) {
    const r = t[e];
    if (Array.isArray(r)) return r.filter((n) => ze(n));
  }
  return t.id || t.job_id ? [t] : [];
}
async function Us(t) {
  const e = ["generate", "list"];
  t != null && t.video && e.push("--video"), e.push("--size", String((t == null ? void 0 : t.size) ?? 20));
  const n = (await qe(e, 2e4)).trim();
  try {
    return Mo(JSON.parse(n));
  } catch {
    const i = Math.max(n.lastIndexOf("["), n.lastIndexOf("{"));
    return i < 0 ? [] : Mo(JSON.parse(n.slice(i)));
  }
}
async function xc(t, e) {
  const r = await Ni(t, e);
  return r && Ri(r, e.mediaType) ? r : Ls(t, e);
}
function Ac(t, e) {
  const r = ["generate", "cost", t];
  for (const [n, i] of Object.entries(xs(t, e) ?? {}))
    i == null || i === "" || !As.test(n) || ks.has(n) || (typeof i == "string" ? r.push(`--${n}`, i) : typeof i == "number" && Number.isFinite(i) ? r.push(`--${n}`, String(i)) : typeof i == "boolean" && r.push(`--${n}`, i ? "true" : "false"));
  return r.push("--json"), r;
}
function kc(t) {
  const e = t.trim(), r = e.lastIndexOf("{");
  if (r < 0) return null;
  try {
    const n = JSON.parse(e.slice(r)), i = n.credits ?? n.cost;
    return typeof i == "number" && Number.isFinite(i) ? i : null;
  } catch {
    return null;
  }
}
async function jc(t, e = {}) {
  if (!t || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(t)) return null;
  try {
    return kc(await qe(Ac(t, e), 2e4));
  } catch {
    return null;
  }
}
async function Do() {
  try {
    const t = await qe(["account", "status"], 15e3);
    return JSON.parse(t.trim());
  } catch {
    return null;
  }
}
function $o(t) {
  if (!t) return { connected: !1 };
  const e = t.data && typeof t.data == "object" ? t.data : t, r = e.subscription_plan_type ?? e.plan;
  return {
    connected: !0,
    email: typeof e.email == "string" ? e.email : void 0,
    plan: typeof r == "string" ? r : void 0,
    credits: typeof e.credits == "number" ? e.credits : typeof e.balance == "number" ? e.balance : void 0
  };
}
function Fo(t) {
  if (t.drawnFramePath && t.referenceMode === "frame") {
    const e = t.outputType === "video" ? "start_image" : "image", r = [{ value: t.drawnFramePath, role: e }];
    return t.guideFramePath && r.push({ value: t.guideFramePath, role: "image" }), r;
  }
  return t.extractedPaths.map((e, r) => ({
    value: e,
    role: t.extractedRoles[r] ?? "image"
  }));
}
function Rc() {
  I.handle("higgsfield:account-status", async () => $o(await Do())), I.handle("higgsfield:quick-edit", async (t, e) => {
    const { prepareClipReference: r, resolveLocalSourcePath: n } = await Promise.resolve().then(() => Ra);
    console.log("[higgsfield:quick-edit] params:", { fileRef: e.fileRef, mode: e.referenceMode, model: e.model, range: [e.sourceStartSec, e.sourceEndSec] });
    let i = [];
    const o = /^https?:\/\//i.test(e.fileRef), a = o ? null : n(e.fileRef);
    if (e.drawnFramePath && e.referenceMode === "frame")
      i = Fo({
        referenceMode: "frame",
        outputType: e.outputType,
        drawnFramePath: e.drawnFramePath,
        guideFramePath: e.guideFramePath,
        extractedPaths: [],
        extractedRoles: []
      });
    else if (a)
      try {
        const s = await r(e.fileRef, {
          mode: e.referenceMode,
          frameTimeSec: e.frameTimeSec,
          sourceStartSec: e.sourceStartSec,
          sourceEndSec: e.sourceEndSec
        });
        console.log("[higgsfield:quick-edit] extracted refs:", s.paths), i = Fo({
          referenceMode: e.referenceMode,
          outputType: e.outputType,
          drawnFramePath: e.drawnFramePath,
          extractedPaths: s.paths,
          extractedRoles: s.roles
        });
      } catch (s) {
        console.warn("[higgsfield:quick-edit] extraction failed, falling back to source path:", s), i = [{ value: a, role: e.outputType === "video" ? "start_image" : "image" }];
      }
    else if (o)
      console.log("[higgsfield:quick-edit] remote source, passing URL directly"), i = [{ value: e.fileRef, role: e.outputType === "video" ? "start_image" : "image" }];
    else
      throw new Error(`Quick Edit could not resolve the clip's source media: ${e.fileRef}`);
    return ei({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: i.length > 0 ? i : void 0,
      aspectRatio: e.aspectRatio
    });
  }), I.handle("higgsfield:generate", async (t, e) => {
    const { resolveLocalSourcePath: r } = await Promise.resolve().then(() => Ra);
    if (e.jobId) {
      const i = { model: e.model, mediaType: e.outputType };
      if (e.wait === !1) {
        const o = await Ni(e.jobId, i);
        if (o && Ri(o, e.outputType)) return o;
        throw new Error("Higgsfield job is still running");
      }
      return xc(e.jobId, i);
    }
    const n = [...e.medias ?? []].map((i) => {
      if (!i.value || /^https?:\/\//i.test(i.value)) return i;
      const o = r(i.value);
      return o ? { ...i, value: o } : i;
    });
    return e.referenceValue && n.push({
      value: e.referenceValue,
      role: e.outputType === "video" ? "start_image" : "image"
    }), ei({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: n.length > 0 ? n : void 0,
      params: e.params,
      wait: e.wait
    });
  }), I.handle("higgsfield:generate-list", async (t, e) => Us(e)), I.handle("higgsfield:generate-cost", async (t, e) => jc(e == null ? void 0 : e.model, (e == null ? void 0 : e.params) ?? {})), I.handle("higgsfield:auth-login", async () => {
    try {
      await qe(["auth", "login"], 300 * 1e3);
    } catch (t) {
      return { connected: !1, error: t instanceof Error ? t.message : String(t) };
    }
    return $o(await Do());
  }), I.handle("higgsfield:auth-logout", async () => {
    await qe(["auth", "logout"], 15e3).catch(() => {
    });
  });
}
const Pc = {
  75: { class_type: "SaveVideo", _meta: { title: "Save LTX 2.5 video" }, inputs: { filename_prefix: "video/LTX-2.5_i2v", format: "auto", codec: "auto", video: ["398:370", 0] } },
  395: { class_type: "LoadImage", _meta: { title: "Load first frame" }, inputs: { image: "source-image.png" } },
  "398:393": { class_type: "CLIPLoader", _meta: { title: "CLIPLoader" }, inputs: { clip_name: "gemma4_e2b_it_bf16.safetensors", type: "ltxv", device: "default" } },
  "398:380": { class_type: "TextGenerateLTX2Prompt", _meta: { title: "TextGenerateLTX2Prompt" }, inputs: { clip: ["398:393", 0], image: ["398:350", 0], prompt: ["398:376", 0], max_length: 600, sampling_mode: "on", "sampling_mode.temperature": 0.7, "sampling_mode.top_k": 64, "sampling_mode.top_p": 0.95, "sampling_mode.min_p": 0.05, "sampling_mode.repetition_penalty": 1.15, "sampling_mode.seed": 0 } },
  "398:383": { class_type: "PrimitiveBoolean", _meta: { title: "Boolean (Enable Prompt Enhance)" }, inputs: { value: !0 } },
  "398:364": { class_type: "CLIPTextEncode", _meta: { title: "CLIPTextEncode" }, inputs: { clip: ["398:387", 0], text: ["398:382", 0] } },
  "398:376": { class_type: "PrimitiveStringMultiline", _meta: { title: "Prompt" }, inputs: { value: "A cinematic subject comes alive from the first frame with natural motion, synchronized sound, and no text." } },
  "398:382": { class_type: "ComfySwitchNode", _meta: { title: "ComfySwitchNode" }, inputs: { on_false: ["398:376", 0], on_true: ["398:380", 0], switch: ["398:383", 0] } },
  "398:384": { class_type: "UNETLoader", _meta: { title: "UNETLoader" }, inputs: { unet_name: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors", weight_dtype: "default" } },
  "398:362": { class_type: "PrimitiveInt", _meta: { title: "Duration" }, inputs: { value: 5 } },
  "398:363": { class_type: "PrimitiveBoolean", _meta: { title: "Switch to Text to Video?" }, inputs: { value: !1 } },
  "398:365": { class_type: "LTXVConditioning", _meta: { title: "LTXVConditioning" }, inputs: { positive: ["398:364", 0], negative: ["398:373", 0], frame_rate: ["398:359", 0] } },
  "398:385": { class_type: "VAELoader", _meta: { title: "VAELoader" }, inputs: { vae_name: "ltx-2.5-video-vae-bf16.safetensors" } },
  "398:386": { class_type: "VAELoader", _meta: { title: "VAELoader" }, inputs: { vae_name: "ltx-2.5-audio-vae-bf16.safetensors" } },
  "398:372": { class_type: "PrimitiveInt", _meta: { title: "Width" }, inputs: { value: 1280 } },
  "398:373": { class_type: "CLIPTextEncode", _meta: { title: "CLIPTextEncode" }, inputs: { clip: ["398:387", 0], text: "pc game, console game, video game, cartoon, childish, ugly" } },
  "398:387": { class_type: "CLIPLoader", _meta: { title: "CLIPLoader" }, inputs: { clip_name: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", type: "ltxv", device: "default" } },
  "398:360": { class_type: "PrimitiveInt", _meta: { title: "Height" }, inputs: { value: 720 } },
  "398:352": { class_type: "KSamplerSelect", _meta: { title: "KSamplerSelect" }, inputs: { sampler_name: "euler_ancestral" } },
  "398:339": { class_type: "RandomNoise", _meta: { title: "RandomNoise" }, inputs: { noise_seed: 875362541677469 } },
  "398:397": { class_type: "ManualSigmas", _meta: { title: "ManualSigmas" }, inputs: { sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" } },
  "398:361": { class_type: "PrimitiveInt", _meta: { title: "Frame Rate" }, inputs: { value: 24 } },
  "398:371": { class_type: "LatentUpscaleModelLoader", _meta: { title: "LatentUpscaleModelLoader" }, inputs: { model_name: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors" } },
  "398:388": { class_type: "LTXVDualCFGGuider", _meta: { title: "LTXVDualCFGGuider" }, inputs: { positive: ["398:365", 0], negative: ["398:365", 1], model: ["398:384", 0], video_cfg: 1, audio_cfg: 1 } },
  "398:344": { class_type: "SamplerCustomAdvanced", _meta: { title: "SamplerCustomAdvanced" }, inputs: { noise: ["398:339", 0], guider: ["398:388", 0], sampler: ["398:352", 0], sigmas: ["398:397", 0], latent_image: ["398:377", 0] } },
  "398:357": { class_type: "LTXVImgToVideoInplace", _meta: { title: "LTXVImgToVideoInplace" }, inputs: { vae: ["398:385", 0], image: ["398:350", 0], latent: ["398:356", 0], bypass: ["398:363", 0], strength: 0.7 } },
  "398:366": { class_type: "LTXVEmptyLatentAudio", _meta: { title: "LTXVEmptyLatentAudio" }, inputs: { audio_vae: ["398:386", 0], frames_number: ["398:378", 1], frame_rate: ["398:359", 1], batch_size: 1 } },
  "398:367": { class_type: "LTXVSeparateAVLatent", _meta: { title: "LTXVSeparateAVLatent" }, inputs: { av_latent: ["398:344", 0] } },
  "398:377": { class_type: "LTXVConcatAVLatent", _meta: { title: "LTXVConcatAVLatent" }, inputs: { video_latent: ["398:357", 0], audio_latent: ["398:366", 0] } },
  "398:351": { class_type: "ResizeImageMaskNode", _meta: { title: "ResizeImageMaskNode" }, inputs: { input: ["395", 0], resize_type: "scale longer dimension", "resize_type.longer_size": 1536, scale_method: "lanczos" } },
  "398:353": { class_type: "ComfyMathExpression", _meta: { title: "ComfyMathExpression" }, inputs: { "values.a": ["398:372", 0], expression: "a/2" } },
  "398:355": { class_type: "ComfyMathExpression", _meta: { title: "ComfyMathExpression" }, inputs: { "values.a": ["398:360", 0], expression: "a/2" } },
  "398:350": { class_type: "LTXVPreprocess", _meta: { title: "LTXVPreprocess" }, inputs: { image: ["398:351", 0], img_compression: 18 } },
  "398:356": { class_type: "EmptyLTXVLatentVideo", _meta: { title: "EmptyLTXVLatentVideo" }, inputs: { width: ["398:353", 1], height: ["398:355", 1], length: ["398:378", 1], batch_size: 1 } },
  "398:348": { class_type: "LTXVLatentUpsampler", _meta: { title: "LTXVLatentUpsampler" }, inputs: { samples: ["398:367", 0], upscale_model: ["398:371", 0], vae: ["398:385", 0] } },
  "398:349": { class_type: "LTXVImgToVideoInplace", _meta: { title: "LTXVImgToVideoInplace" }, inputs: { image: ["398:350", 0], latent: ["398:348", 0], bypass: ["398:363", 0], vae: ["398:385", 0], strength: 1 } },
  "398:359": { class_type: "ComfyMathExpression", _meta: { title: "Math Expression (fps)" }, inputs: { "values.a": ["398:361", 0], expression: "a" } },
  "398:378": { class_type: "ComfyMathExpression", _meta: { title: "Math Expression (length)" }, inputs: { "values.a": ["398:362", 0], "values.b": ["398:361", 0], expression: "a * b + 1" } },
  "398:338": { class_type: "RandomNoise", _meta: { title: "RandomNoise" }, inputs: { noise_seed: 42 } },
  "398:340": { class_type: "LTXVConcatAVLatent", _meta: { title: "LTXVConcatAVLatent" }, inputs: { video_latent: ["398:349", 0], audio_latent: ["398:367", 1] } },
  "398:396": { class_type: "ManualSigmas", _meta: { title: "ManualSigmas" }, inputs: { sigmas: "0.85, 0.7250, 0.4219, 0.0" } },
  "398:391": { class_type: "LTXVDualCFGGuider", _meta: { title: "LTXVDualCFGGuider" }, inputs: { positive: ["398:365", 0], negative: ["398:365", 1], model: ["398:384", 0], video_cfg: 1, audio_cfg: 1 } },
  "398:341": { class_type: "KSamplerSelect", _meta: { title: "KSamplerSelect" }, inputs: { sampler_name: "euler_ancestral" } },
  "398:368": { class_type: "SamplerCustomAdvanced", _meta: { title: "SamplerCustomAdvanced" }, inputs: { noise: ["398:338", 0], guider: ["398:391", 0], sampler: ["398:341", 0], sigmas: ["398:396", 0], latent_image: ["398:340", 0] } },
  "398:369": { class_type: "LTXVSeparateAVLatent", _meta: { title: "LTXVSeparateAVLatent" }, inputs: { av_latent: ["398:368", 0] } },
  "398:374": { class_type: "VAEDecodeTiled", _meta: { title: "VAEDecodeTiled" }, inputs: { samples: ["398:369", 0], vae: ["398:385", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
  "398:358": { class_type: "LTXVAudioVAEDecode", _meta: { title: "LTXVAudioVAEDecode" }, inputs: { samples: ["398:369", 1], audio_vae: ["398:386", 0] } },
  "398:370": { class_type: "CreateVideo", _meta: { title: "CreateVideo" }, inputs: { images: ["398:374", 0], audio: ["398:358", 0], fps: ["398:359", 0] } }
}, Oc = {
  1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  2: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "CINEGEN_POSITIVE_PROMPT" } },
  3: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "CINEGEN_NEGATIVE_PROMPT" } },
  4: { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  5: { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 1, steps: 30, cfg: 7, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1 } },
  6: { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  7: { class_type: "SaveImage", inputs: { filename_prefix: "CineGen_SDXL", images: ["6", 0] } }
}, Nc = {
  1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_int8_convrot.safetensors", weight_dtype: "default" } },
  2: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3.1 } },
  3: { class_type: "CFGNorm", inputs: { model: ["2", 0], strength: 1, pre_cfg: !1 } },
  4: { class_type: "LoraLoaderModelOnly", inputs: { model: ["3", 0], lora_name: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", strength_model: 1 } },
  5: { class_type: "CLIPLoader", inputs: { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" } },
  6: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
  7: { class_type: "LoadImage", inputs: { image: "cinegen-qwen-reference-1.png" } },
  10: { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["5", 0], vae: ["6", 0], image1: ["18", 0], prompt: "CINEGEN_POSITIVE_PROMPT" } },
  11: { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["5", 0], vae: ["6", 0], image1: ["18", 0], prompt: "CINEGEN_NEGATIVE_PROMPT" } },
  12: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["10", 0], reference_latents_method: "index_timestep_zero" } },
  13: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["11", 0], reference_latents_method: "index_timestep_zero" } },
  14: { class_type: "VAEEncode", inputs: { pixels: ["18", 0], vae: ["6", 0] } },
  15: { class_type: "KSampler", inputs: { model: ["4", 0], positive: ["12", 0], negative: ["13", 0], latent_image: ["14", 0], seed: 1, steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 } },
  16: { class_type: "VAEDecode", inputs: { samples: ["15", 0], vae: ["6", 0] } },
  17: { class_type: "SaveImage", inputs: { filename_prefix: "CineGen_Qwen_Edit_2511", images: ["16", 0] } },
  18: { class_type: "FluxKontextImageScale", inputs: { image: ["7", 0] } }
}, Cc = "notrius/ltx-2.5-serverless:cu130@sha256:73d1621ef915ae6a149f2a32f6c317dfc89f12075ed4b3abd7df707420267205", Ci = "https://rest.runpod.io/v1", qc = "https://api.runpod.io/v2", Ms = "https://api.runpod.io/graphql", qi = 8e3, An = 256 * 1024, Lc = 1800, Uc = 200, ti = 15e3, Ds = 6500, Mc = 12e4, Li = 12e3, $s = 14 * 1024 * 1024, Dc = 100 * 1024 * 1024, Bo = 1024 * 1024, Vo = 4, Fs = Object.freeze(["sdxl", "qwen-image-edit"]), $c = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYElEQVR4nO3PQQ0AIBDAMMD4WUcEj4ZkVbDtmVk/OzrgVQNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgPaBRFyAf0dnk7yAAAAAElFTkSuQmCC", Fc = "balanced", Go = Object.freeze({
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
}), Bc = String.raw`set -eo pipefail
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
class F extends Error {
  constructor(r, n = "RUNPOD_LTX_ERROR", i = 502) {
    super(r);
    M(this, "code");
    M(this, "statusCode");
    this.name = "RunpodLtx25Error", this.code = n, this.statusCode = i;
  }
}
class Ui extends Error {
  constructor(r) {
    super(`The provider did not respond within ${r} ms.`);
    M(this, "timeoutMs");
    this.name = "RunpodRequestTimeoutError", this.timeoutMs = r;
  }
}
function Ie(t, e) {
  if (typeof t != "string" || !t.trim())
    throw new F(`${e} is required.`, "MISSING_CONFIGURATION", 422);
  return t.trim();
}
function Zr(t, e) {
  const r = Ie(t, e);
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(r))
    throw new F(`${e} is invalid.`, "INVALID_CONFIGURATION", 422);
  return r;
}
async function Vc(t) {
  const e = await t.text();
  if (e)
    try {
      return JSON.parse(e);
    } catch {
      return e;
    }
}
async function Bs(t, e, r = {}, n = ti) {
  const i = new AbortController(), o = r.signal, a = () => i.abort(o == null ? void 0 : o.reason);
  o != null && o.aborted ? a() : o == null || o.addEventListener("abort", a, { once: !0 });
  let s;
  const l = new Ui(n), u = new Promise((c, p) => {
    s = setTimeout(() => {
      i.abort(l), p(l);
    }, n);
  }), d = (async () => {
    const c = await t(e, { ...r, signal: i.signal }), p = await Vc(c);
    return { response: c, payload: p };
  })();
  try {
    return await Promise.race([d, u]);
  } finally {
    clearTimeout(s), o == null || o.removeEventListener("abort", a);
  }
}
function Gc(t) {
  try {
    return new URL(t).pathname === "/health" ? Ds : ti;
  } catch {
    return ti;
  }
}
function en(t, e) {
  if (t && typeof t == "object") {
    const r = t, n = r.error ?? r.message ?? r.detail;
    if (typeof n == "string" && n.trim())
      return n.slice(0, 800);
    if (Array.isArray(r.errors) && r.errors.length)
      return JSON.stringify(r.errors).slice(0, 800);
  }
  return e;
}
async function xe(t, e, r, n, i = [200, 201, 202, 204], o = Gc(e)) {
  let a;
  try {
    a = await Bs(t, e, r, o);
  } catch (u) {
    throw u instanceof Ui ? new F(`${n} RunPod did not respond before the request timed out.`, "PROVIDER_TIMEOUT", 504) : new F(u instanceof Error ? u.message : n, "PROVIDER_UNREACHABLE", 502);
  }
  const { response: s, payload: l } = a;
  if (!i.includes(s.status))
    throw new F(en(l, `${n} (${s.status})`), "PROVIDER_ERROR", s.status);
  return l;
}
function Mi(t, e = !1) {
  return {
    Authorization: `Bearer ${t}`,
    Accept: "application/json",
    ...e ? { "Content-Type": "application/json" } : {}
  };
}
function Hc(t) {
  const e = [];
  for (const r of t.split(/\r?\n\r?\n/)) {
    const n = r.split(/\r?\n/).filter((i) => i.startsWith("data:")).map((i) => i.slice(5).replace(/^ /, "")).join(`
`);
    if (n)
      try {
        const i = JSON.parse(n);
        typeof (i == null ? void 0 : i.line) == "string" ? e.push(i.line) : e.push(n);
      } catch {
        e.push(n);
      }
  }
  return e;
}
async function zc(t, e, r) {
  var a;
  const n = new AbortController(), i = setTimeout(() => n.abort(), Lc);
  let o;
  try {
    const s = new URL(`${qc}/pods/${encodeURIComponent(r)}/logs`);
    s.searchParams.set("tail", "200");
    const l = await t(s.toString(), {
      headers: {
        Authorization: `Bearer ${e}`,
        Accept: "text/event-stream"
      },
      signal: n.signal
    });
    if (!l.ok || !((a = l.body) != null && a.getReader))
      return [];
    o = l.body.getReader();
    const u = new TextDecoder();
    let d = "", c = await o.read();
    for (; !c.done && d.length < An && (d += u.decode(c.value, { stream: !0 }), !(d.length >= An)); ) {
      let p;
      const f = new Promise((m) => {
        p = setTimeout(() => m({ quiet: !0 }), Uc);
      });
      if (c = await Promise.race([o.read(), f]), clearTimeout(p), c != null && c.quiet)
        break;
    }
    return d += u.decode(), Hc(d.slice(0, An));
  } catch {
    return [];
  } finally {
    if (clearTimeout(i), n.abort(), o) {
      try {
        await o.cancel();
      } catch {
      }
      try {
        o.releaseLock();
      } catch {
      }
    }
  }
}
function Wc(t) {
  const e = [
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
  return t.some((r) => e.some((n) => n.test(r)));
}
const Xc = Object.freeze([
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
function Jc(t) {
  for (const e of Xc)
    if (t.some((r) => e.patterns.some((n) => n.test(r))))
      return e;
}
function Kc(t) {
  if (!Array.isArray(t))
    return [];
  const e = [];
  for (const r of t) {
    const n = r === "sdxl" ? "SDXL" : r === "qwen-image-edit" ? "Qwen Image Edit" : void 0;
    n && !e.includes(n) && e.push(n);
  }
  return e;
}
function Yc(t) {
  if (!t || typeof t != "object")
    return;
  const e = typeof t.phase == "string" ? t.phase : "";
  if (e === "downloading-image-models") {
    const r = Kc(t.missingModels);
    return r.length ? `Downloading ${r.join(" and ")} for this temporary session…` : "Downloading the selected image models for this temporary session…";
  }
  if (e === "loading-ltx" || e === "downloading")
    return "Downloading and loading LTX-2.5 into the GPU…";
  if (e === "verifying-models")
    return "ComfyUI is verifying the models and starting the session API…";
  if (e === "starting-comfyui")
    return "Starting ComfyUI and discovering the session models…";
}
function Qc(t) {
  for (let e = t.length - 1; e >= 0; e -= 1) {
    const r = t[e];
    if (/\b(?:still fetching|pulling|downloading) (?:the )?(?:container )?image\b/i.test(r))
      return "RunPod is downloading the CineGen container image…";
    if (/\b(?:qwen(?:_image)?|sd[_ -]?xl)\b/i.test(r) && /\b(?:download|fetch)\w*\b/i.test(r))
      return "Downloading the selected image models for this temporary session…";
    if (/\b(?:model discovery|discovering|required models|verif\w* models?)\b/i.test(r))
      return "ComfyUI is verifying the required models…";
    if (/\bcomfyui\b/i.test(r) && /\b(?:start|launch|initializ)\w*\b/i.test(r))
      return "Starting ComfyUI…";
    if (/\b(?:cuda kernels?|loading (?:the )?(?:model|text encoder).*(?:gpu|cuda))\b/i.test(r))
      return "Loading the models into the GPU…";
    if (/\b(?:download|fetch)\w*\b/i.test(r) && /\b(?:ltx|weights?|checkpoint|model)\b/i.test(r))
      return "Downloading LTX-2.5 model files…";
  }
}
async function Ho(t, e, r, n) {
  const i = `mutation { secretCreate(input: { name: ${JSON.stringify(r)}, value: ${JSON.stringify(n)}, description: "Temporary CineGen LTX-2.5 session credential" }) { id name } }`, o = new URL(Ms);
  o.searchParams.set("api_key", e);
  const a = await xe(t, o.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: i })
  }, "RunPod could not create the encrypted session secret."), s = a && Array.isArray(a.errors) ? a.errors : [], l = a == null ? void 0 : a.data, u = l == null ? void 0 : l.secretCreate;
  if (s.length || typeof (u == null ? void 0 : u.id) != "string")
    throw new F(en(a, "RunPod could not create the encrypted session secret."));
  return u.id;
}
async function Vs(t, e, r) {
  const n = `mutation { secretDelete(id: ${JSON.stringify(r)}) }`, i = new URL(Ms);
  i.searchParams.set("api_key", e), await xe(t, i.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: n })
  }, "RunPod could not remove a temporary session secret.");
}
function Zc(t) {
  return `https://${t}-${qi}.proxy.runpod.net`;
}
function Di(t, e) {
  const r = Zr(e, "RunPod session ID"), n = new URL(Ie(t, "RunPod session URL"));
  if (n.protocol !== "https:" || n.username || n.password || n.hostname !== `${r}-${qi}.proxy.runpod.net`)
    throw new F("RunPod session URL is invalid.", "INVALID_CONFIGURATION", 422);
  return { podId: r, url: `${n.origin}` };
}
function ef() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
function Gs(t) {
  const e = t && typeof t == "object" ? t : {}, r = e.gpu && typeof e.gpu == "object" ? e.gpu : void 0, n = Number(e.adjustedCostPerHr ?? e.costPerHr);
  return {
    id: typeof e.id == "string" ? e.id : "",
    costPerHr: Number.isFinite(n) ? n : null,
    gpu: typeof (r == null ? void 0 : r.displayName) == "string" ? r.displayName : typeof (r == null ? void 0 : r.id) == "string" ? r.id : null,
    desiredStatus: typeof e.desiredStatus == "string" ? e.desiredStatus : "UNKNOWN"
  };
}
function tf(t) {
  const e = t === void 0 ? Fc : t;
  if (typeof e != "string" || !Object.hasOwn(Go, e))
    throw new F("Choose a valid LTX-2.5 GPU profile: economy, balanced, or performance.", "INVALID_GPU_PROFILE", 422);
  return { name: e, config: Go[e] };
}
function rf(t) {
  if (t === void 0)
    return [];
  if (!Array.isArray(t))
    throw new F("Image models must be an array.", "INVALID_IMAGE_MODELS", 422);
  const e = [];
  for (const r of t) {
    if (typeof r != "string" || !Fs.includes(r))
      throw new F("Choose only supported session image models: SDXL or Qwen Image Edit.", "INVALID_IMAGE_MODELS", 422);
    e.includes(r) || e.push(r);
  }
  return e;
}
function nf(t, e) {
  return e.includes("qwen-image-edit") ? Math.max(t.containerDiskInGb, 200) : e.includes("sdxl") ? Math.max(t.containerDiskInGb, 160) : t.containerDiskInGb;
}
async function of(t, e = fetch) {
  const r = Ie(t.runpodKey, "RunPod API key"), n = Ie(t.huggingFaceToken, "Hugging Face read token");
  if (!/^hf_[A-Za-z0-9]+$/.test(n))
    throw new F("Enter a valid Hugging Face read token.", "INVALID_HUGGINGFACE_TOKEN", 422);
  const i = tf(t.gpuProfile), o = rf(t.imageModels), a = ef(), s = `cinegen_ltx25_hf_${a}`, l = `cinegen_ltx25_session_${a}`, u = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ""), d = [];
  try {
    d.push(await Ho(e, r, s, n)), d.push(await Ho(e, r, l, u));
    const c = await xe(e, `${Ci}/pods`, {
      method: "POST",
      headers: Mi(r, !0),
      body: JSON.stringify({
        name: `CineGen LTX-2.5 Session ${a}`,
        cloudType: "SECURE",
        computeType: "GPU",
        imageName: Cc,
        gpuTypeIds: [...i.config.gpuTypeIds],
        gpuTypePriority: "custom",
        gpuCount: 1,
        allowedCudaVersions: ["13.0"],
        containerDiskInGb: nf(i.config, o),
        volumeInGb: 0,
        ports: [`${qi}/http`],
        supportPublicIp: !0,
        interruptible: !1,
        minRAMPerGPU: i.config.minRAMPerGPU,
        minVCPUPerGPU: i.config.minVCPUPerGPU,
        dockerEntrypoint: [],
        dockerStartCmd: ["bash", "-lc", Bc],
        env: {
          RUN_MODE: "local-api",
          PERSIST_WORKSPACE: "false",
          LTX_FRONTEND_ENABLED: "false",
          COMFY_LOG_LEVEL: "INFO",
          LTX25_PRELOAD_VARIANT: "distilled-int8",
          LTX25_PRELOAD_PROMPT_ENHANCER: "true",
          CINEGEN_IMAGE_MODELS: o.join(","),
          CINEGEN_GPU_PROFILE: i.name,
          HUGGINGFACE_ACCESS_TOKEN: `{{ RUNPOD_SECRET_${s} }}`,
          CINEGEN_POD_TOKEN: `{{ RUNPOD_SECRET_${l} }}`
        }
      })
    }, "RunPod could not create the LTX-2.5 session Pod."), p = Gs(c);
    if (!p.id)
      throw new F("RunPod created a Pod without returning its ID.");
    return {
      podId: p.id,
      podUrl: Zc(p.id),
      podAuthToken: u,
      secretIds: d,
      status: "downloading",
      phase: "downloading",
      message: "RunPod is downloading and loading LTX-2.5. The first session can take a while.",
      gpuProfile: i.name,
      imageModels: o,
      costPerHr: p.costPerHr,
      gpu: p.gpu
    };
  } catch (c) {
    throw await Promise.allSettled(d.map((p) => Vs(e, r, p))), c;
  }
}
async function af(t, e = fetch) {
  const r = Ie(t.runpodKey, "RunPod API key"), n = Ie(t.podAuthToken, "RunPod session token"), i = Di(t.podUrl, t.podId);
  let o;
  try {
    o = await xe(e, `${Ci}/pods/${i.podId}`, {
      headers: Mi(r)
    }, "RunPod could not read the LTX-2.5 session.");
  } catch (c) {
    if (c instanceof F && c.statusCode === 404)
      return {
        status: "ended",
        phase: "ended",
        podId: i.podId,
        podUrl: i.url,
        message: "This LTX-2.5 session has ended.",
        costPerHr: null,
        gpu: null
      };
    throw c;
  }
  const a = Gs(o);
  let s;
  if (a.desiredStatus === "RUNNING")
    try {
      const { response: c, payload: p } = await Bs(e, `${i.url}/health`, {
        headers: { Authorization: `Bearer ${n}`, Accept: "application/json" }
      }, Ds);
      if (c.status === 401 || c.status === 403)
        return {
          status: "error",
          phase: "error",
          podId: i.podId,
          podUrl: i.url,
          message: "CineGen could not authenticate with this Pod. End the session and start a new one. The current Pod keeps billing until you end it.",
          costPerHr: a.costPerHr,
          gpu: a.gpu
        };
      if (c.ok && (p == null ? void 0 : p.ready) === !0)
        return Ys(p) ? {
          status: "ready",
          phase: "ready",
          podId: i.podId,
          podUrl: i.url,
          message: "LTX-2.5 is loaded and ready to generate.",
          costPerHr: a.costPerHr,
          gpu: a.gpu
        } : {
          status: "error",
          phase: "error",
          podId: i.podId,
          podUrl: i.url,
          message: "This Pod is running, but it was started before CineGen's reliable video-transfer update. End this session when you are ready, then start a new LTX-2.5 session. The current Pod keeps billing until you end it.",
          costPerHr: a.costPerHr,
          gpu: a.gpu
        };
      s = { kind: "response", status: c.status, body: p };
    } catch (c) {
      s = c instanceof Ui ? { kind: "timeout" } : { kind: "unreachable" };
    }
  const l = await zc(e, r, i.podId), u = Jc(l);
  if (!u && Wc(l))
    try {
      const c = await Hs({
        runpodKey: r,
        podId: i.podId,
        secretIds: t.secretIds
      }, e);
      return {
        status: "error",
        phase: "startup-failed-cleaned",
        podId: i.podId,
        podUrl: i.url,
        message: c.warning ? "The LTX-2.5 container could not start. CineGen deleted the failed Pod and billing stopped, but RunPod could not remove one temporary secret. Check RunPod Secrets." : "The LTX-2.5 container could not start. CineGen deleted the failed Pod and temporary secrets; billing stopped.",
        costPerHr: null,
        gpu: a.gpu
      };
    } catch {
      return {
        status: "error",
        phase: "startup-failed-cleanup-required",
        podId: i.podId,
        podUrl: i.url,
        message: "The LTX-2.5 container could not start, and CineGen could not confirm cleanup. Delete this Pod in RunPod now to stop billing.",
        costPerHr: a.costPerHr,
        gpu: a.gpu
      };
    }
  if (u)
    return {
      status: "error",
      phase: "error",
      podId: i.podId,
      podUrl: i.url,
      message: u.message,
      startupFailure: u.kind,
      costPerHr: a.costPerHr,
      gpu: a.gpu
    };
  if (a.desiredStatus !== "RUNNING")
    return {
      status: "error",
      phase: "error",
      podId: i.podId,
      podUrl: i.url,
      message: `RunPod reports the session as ${a.desiredStatus.toLowerCase()}.`,
      costPerHr: a.costPerHr,
      gpu: a.gpu
    };
  let d;
  return (s == null ? void 0 : s.kind) === "timeout" ? d = "RunPod reports the Pod is running, but its private gateway did not answer within 7 seconds. It may still be starting; check again shortly. Billing continues while the Pod runs." : (s == null ? void 0 : s.kind) === "response" && (s.status === 502 || s.status === 504) ? d = `RunPod reports the Pod is running, but its private gateway returned ${s.status}. The container may still be starting; check again shortly. Billing continues while the Pod runs.` : d = Yc(s == null ? void 0 : s.body) ?? Qc(l), !d && (s == null ? void 0 : s.kind) === "unreachable" ? d = "RunPod reports the Pod is running, but its private gateway is not reachable yet. The container may still be starting; check again shortly. Billing continues while the Pod runs." : !d && (s == null ? void 0 : s.kind) === "response" && s.status >= 400 && (d = `RunPod reports the Pod is running, but its private gateway returned HTTP ${s.status}. Check again shortly. Billing continues while the Pod runs.`), {
    status: "downloading",
    phase: "downloading",
    podId: i.podId,
    podUrl: i.url,
    message: d ?? "Downloading weights and loading LTX-2.5 into the GPU…",
    costPerHr: a.costPerHr,
    gpu: a.gpu
  };
}
async function Hs(t, e = fetch) {
  const r = Ie(t.runpodKey, "RunPod API key"), n = Zr(t.podId, "RunPod session ID");
  await xe(e, `${Ci}/pods/${n}`, {
    method: "DELETE",
    headers: Mi(r)
  }, "RunPod could not end the LTX-2.5 session.", [200, 204, 404]);
  const i = Array.isArray(t.secretIds) ? t.secretIds.filter((s) => typeof s == "string" && /^[A-Za-z0-9_-]+$/.test(s)) : [];
  return (await Promise.allSettled(i.map((s) => Vs(e, r, s)))).filter((s) => s.status === "rejected").length ? { ok: !0, warning: "The Pod was deleted and billing stopped, but one temporary RunPod secret could not be removed." } : { ok: !0 };
}
function sf(t, e) {
  return e === "480p" ? t === "9:16" ? { width: 480, height: 864 } : t === "1:1" ? { width: 480, height: 480 } : { width: 864, height: 480 } : t === "9:16" ? e === "1080p" ? { width: 1080, height: 1920 } : { width: 720, height: 1280 } : t === "1:1" ? e === "1080p" ? { width: 1080, height: 1080 } : { width: 1024, height: 1024 } : e === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}
function zs(t) {
  return Array.isArray(t.referenceImages) ? t.referenceImages.filter((e) => typeof e == "string" && e.trim()) : [];
}
function lf(t) {
  const e = JSON.parse(JSON.stringify(Pc)), r = Ie(t.prompt, "Video prompt");
  if (r.length > Li)
    throw new F("The LTX-2.5 video prompt is too long.", "PROMPT_TOO_LONG", 422);
  const n = Math.min(20, Math.max(1, Math.round(Number(t.durationSec) || 5))), i = ["16:9", "9:16", "1:1"].includes(t.aspectRatio ?? "") ? t.aspectRatio : "16:9", o = t.resolution === "480p" || t.resolution === "1080p" ? t.resolution : "720p", a = sf(i, o);
  return e["398:376"].inputs.value = r, e[395].inputs.image = "cinegen-source.png", e["398:362"].inputs.value = n, e["398:372"].inputs.value = a.width, e["398:360"].inputs.value = a.height, e["398:361"].inputs.value = 24, e["398:380"].inputs.sampling_mode = "on", e["398:380"].inputs["sampling_mode.seed"] = Math.floor(Math.random() * 999999998) + 1, e["398:383"].inputs.value = t.generateAudio !== !1, e["398:363"].inputs.value = zs(t).length === 0, e["398:338"].inputs.noise_seed = Math.floor(Math.random() * 999999999999998) + 1, e["398:339"].inputs.noise_seed = Math.floor(Math.random() * 999999999999998) + 1, e;
}
function uf(t) {
  const e = zs(t), r = e.find((a) => a.startsWith("data:image/")) ?? (e.length ? "" : $c), n = /^data:(image\/(?:png|jpeg|webp|gif|bmp|avif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(r);
  if (!n || !n[2] || n[2].length % 4 === 1)
    throw new F("The LTX-2.5 reference image could not be prepared.", "INVALID_REFERENCE", 422);
  const i = n[2].endsWith("==") ? 2 : n[2].endsWith("=") ? 1 : 0;
  if (Math.floor(n[2].length * 0.75) - i > $s)
    throw new F("The first LTX-2.5 reference image is larger than 14 MB.", "REFERENCE_TOO_LARGE", 413);
  return r;
}
function Ws(t) {
  if (typeof t != "string" || !Fs.includes(t))
    throw new F("Choose SDXL or Qwen Image Edit for this image job.", "INVALID_IMAGE_MODEL", 422);
  return t;
}
function zo(t) {
  try {
    return Ws(t);
  } catch {
    return;
  }
}
function tn(t) {
  return t === "sdxl" ? "SDXL" : "Qwen Image Edit 2511";
}
function Wo(t, e) {
  if (t == null)
    return e;
  const r = Number(t);
  if (!Number.isInteger(r) || r < 256 || r > 2048)
    throw new F("Image width and height must be whole pixels from 256 to 2048.", "INVALID_DIMENSIONS", 422);
  return Math.max(256, Math.min(2048, Math.round(r / 16) * 16));
}
function df(t) {
  if (t == null)
    return Math.floor(Math.random() * 999999999999998) + 1;
  const e = Number(t);
  if (!Number.isSafeInteger(e) || e < 0)
    throw new F("Image seed must be a non-negative whole number.", "INVALID_SEED", 422);
  return e;
}
function cf(t, e) {
  const r = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
    typeof t == "string" ? t.trim() : ""
  );
  if (!r || !r[2] || r[2].length % 4 === 1)
    throw new F(`Qwen reference image ${e + 1} could not be prepared.`, "INVALID_REFERENCE", 422);
  const n = r[2].endsWith("==") ? 2 : r[2].endsWith("=") ? 1 : 0;
  if (Math.floor(r[2].length * 0.75) - n > $s)
    throw new F(`Qwen reference image ${e + 1} is larger than 14 MB.`, "REFERENCE_TOO_LARGE", 413);
  return t.trim();
}
function ff(t, e) {
  const r = Array.isArray(t.referenceImages) ? t.referenceImages.filter((n) => typeof n == "string" && n.trim()) : [];
  if (e === "sdxl" && r.length)
    throw new F("SDXL session jobs are text-to-image and do not accept reference images.", "INVALID_REFERENCE", 422);
  if (e === "qwen-image-edit" && (r.length < 1 || r.length > 3))
    throw new F("Qwen Image Edit requires one to three reference images.", "INVALID_REFERENCE_COUNT", 422);
  return r.map(cf);
}
function pf(t, e) {
  const r = Ie(t, e);
  if (r.length > Li)
    throw new F(`${e} is too long.`, "PROMPT_TOO_LONG", 422);
  return r;
}
function mf(t, e, r, n, i, o) {
  const a = JSON.parse(JSON.stringify(Oc));
  a[2].inputs.text = e, a[3].inputs.text = r, a[4].inputs.width = n, a[4].inputs.height = i, a[5].inputs.seed = o;
  const s = Number(t.steps);
  Number.isFinite(s) && (a[5].inputs.steps = Math.max(1, Math.min(100, Math.round(s))));
  const l = Number(t.guidanceScale);
  return Number.isFinite(l) && (a[5].inputs.cfg = Math.max(0, Math.min(30, l))), a;
}
function hf(t, e, r, n) {
  const i = JSON.parse(JSON.stringify(Nc));
  i[10].inputs.prompt = t, i[11].inputs.prompt = e, i[15].inputs.seed = r;
  for (let o = 1; o < n.length; o += 1) {
    const a = String(7 + o), s = `image${o + 1}`;
    i[a] = {
      class_type: "LoadImage",
      inputs: { image: `cinegen-qwen-reference-${o + 1}.png` }
    }, i[10].inputs[s] = [a, 0], i[11].inputs[s] = [a, 0];
  }
  return i;
}
function gf(t) {
  const e = Ws(t.model), r = pf(t.prompt, "Image prompt"), n = typeof t.negativePrompt == "string" ? t.negativePrompt.trim().slice(0, Li) : e === "sdxl" ? "text, watermark, logo, low quality, distorted" : "", i = Wo(t.width, 1024), o = Wo(t.height, 1024), a = df(t.seed), s = ff(t, e), l = e === "sdxl" ? mf(t, r, n, i, o, a) : hf(r, n, a, s);
  return {
    model: e,
    label: tn(e),
    workflow: l,
    images: s.map((u, d) => ({
      name: `cinegen-qwen-reference-${d + 1}.png`,
      image: u
    })),
    // Qwen's official 2511 workflow scales and VAE-encodes Picture 1 as
    // the sampler latent. Keep this false so older active Pod gateways do
    // not try to inject width/height inputs into that VAEEncode node.
    preserveInputDimensions: !1
  };
}
function rn(t, e = 8) {
  const r = [], n = (i, o, a) => {
    if (a > e || i === null || i === void 0)
      return;
    if (Array.isArray(i)) {
      for (const l of i)
        n(l, o, a + 1);
      return;
    }
    if (typeof i != "object")
      return;
    const s = i;
    r.push({ record: s, parentKey: o });
    for (const [l, u] of Object.entries(s))
      n(u, l, a + 1);
  };
  return n(t, "", 0), r;
}
function Xs(t) {
  for (const { record: e } of rn(t)) {
    const r = String(e.status ?? e.state ?? "").toLowerCase();
    if (!["error", "failed", "failure", "cancelled", "canceled"].includes(r))
      continue;
    const n = e.error ?? e.message ?? e.detail;
    if (typeof n == "string" && n.trim())
      return n.trim().slice(0, 1200);
    if (n && typeof n == "object") {
      const i = n.message ?? n.detail;
      if (typeof i == "string" && i.trim())
        return i.trim().slice(0, 1200);
    }
    return "LTX-2.5 generation failed.";
  }
}
function $i(t) {
  const e = t.media_type ?? t.mediaType ?? t.mime_type ?? t.mimeType;
  return typeof e == "string" && e.trim() ? e.trim() : "";
}
function $r(t, e = "video/mp4") {
  return $i(t) || e;
}
function yf(t, e) {
  if (e === "videos" || e === "video" || $i(t).startsWith("video/"))
    return !0;
  const n = t.filename ?? t.name;
  return typeof n == "string" && /\.(?:mp4|webm|mov|mkv|avi|m4v)(?:$|[?#])/i.test(n);
}
function _f(t, e) {
  if (e === "images" || e === "image" || $i(t).startsWith("image/"))
    return !0;
  const n = t.filename ?? t.name;
  return typeof n == "string" && /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(n);
}
function Ve(...t) {
  var e;
  return (e = t.find((r) => typeof r == "string" && r.trim())) == null ? void 0 : e.trim();
}
function wf(t, e) {
  const r = Xs(t);
  if (r)
    throw new F(r, "GENERATION_FAILED", 502);
  for (const { record: n, parentKey: i } of rn(t)) {
    const o = Ve(n.video_url, n.videoUrl);
    if (o)
      return { url: o, durationSec: e, model: "LTX-2.5" };
    const a = Ve(n.video_base64, n.videoBase64);
    if (a)
      return { data: a, mediaType: $r(n), durationSec: e, model: "LTX-2.5" };
    if (!yf(n, i))
      continue;
    const s = Ve(n.url, n.download_url, n.downloadUrl), l = Ve(n.data, n.base64), u = s ?? (String(n.type ?? "").toLowerCase() === "url" ? l : void 0);
    if (u)
      return { url: u, durationSec: e, model: "LTX-2.5" };
    const d = String(n.type ?? "").toLowerCase() === "url" ? void 0 : l;
    if (d)
      return { data: d, mediaType: $r(n), durationSec: e, model: "LTX-2.5" };
  }
  throw new F("LTX-2.5 completed without returning a video.", "INVALID_PROVIDER_RESPONSE", 502);
}
function bf(t, e) {
  const r = tn(e), n = Xs(t);
  if (n)
    throw new F(n, "GENERATION_FAILED", 502);
  for (const { record: i, parentKey: o } of rn(t)) {
    const a = Ve(i.image_url, i.imageUrl);
    if (a)
      return { url: a, model: r };
    const s = Ve(i.image_base64, i.imageBase64);
    if (s)
      return { data: s, mediaType: $r(i, "image/png"), model: r };
    if (!_f(i, o))
      continue;
    const l = Ve(i.url, i.download_url, i.downloadUrl), u = Ve(i.data, i.base64), d = l ?? (String(i.type ?? "").toLowerCase() === "url" ? u : void 0);
    if (d)
      return { url: d, model: r };
    const c = String(i.type ?? "").toLowerCase() === "url" ? void 0 : u;
    if (c)
      return { data: c, mediaType: $r(i, "image/png"), model: r };
  }
  throw new F(`${r} completed without returning an image.`, "INVALID_PROVIDER_RESPONSE", 502);
}
function Js(t, e = "video", r = "LTX-2.5") {
  for (const { record: n, parentKey: i } of rn(t)) {
    if (i !== "artifact")
      continue;
    const o = typeof n.id == "string" ? n.id.trim() : "", a = Number(n.byteSize ?? n.byte_size), s = typeof (n.mediaType ?? n.media_type) == "string" ? String(n.mediaType ?? n.media_type).trim() : "";
    if (!/^[A-Za-z0-9_-]{1,191}$/.test(o) || !Number.isSafeInteger(a) || a <= 0 || a > Dc || s && !s.startsWith(`${e}/`))
      throw new F(`${r} returned invalid artifact metadata.`, "INVALID_PROVIDER_RESPONSE", 502);
    return { id: o, byteSize: a, mediaType: s };
  }
}
function vf(t, e = "LTX-2.5", r = "video") {
  if (typeof t != "string" || !t || t.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(t))
    throw new F(`${e} returned an invalid ${r} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
  if (typeof Buffer < "u")
    return new Uint8Array(Buffer.from(t, "base64"));
  if (typeof atob != "function")
    throw new F(`This CineGen runtime cannot decode the generated ${r}.`, "RUNTIME_UNSUPPORTED", 500);
  let n;
  try {
    n = atob(t);
  } catch {
    throw new F(`${e} returned an invalid ${r} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  const i = new Uint8Array(n.length);
  for (let o = 0; o < n.length; o += 1)
    i[o] = n.charCodeAt(o);
  return i;
}
function Tf(t, e, r = "video", n = "LTX-2.5") {
  const i = t.length >= 4 && t[0] === 26 && t[1] === 69 && t[2] === 223 && t[3] === 163, o = t.length >= 12 && String.fromCharCode(...t.subarray(4, 8)) === "ftyp", a = t.length >= 8 && t[0] === 137 && t[1] === 80 && t[2] === 78 && t[3] === 71 && t[4] === 13 && t[5] === 10 && t[6] === 26 && t[7] === 10, s = t.length >= 3 && t[0] === 255 && t[1] === 216 && t[2] === 255, l = t.length >= 12 && String.fromCharCode(...t.subarray(0, 4)) === "RIFF" && String.fromCharCode(...t.subarray(8, 12)) === "WEBP";
  if (r === "image") {
    if (a)
      return "image/png";
    if (s)
      return "image/jpeg";
    if (l)
      return "image/webp";
    throw new F(`${n} returned an unsupported image file.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  if (!i && !o)
    throw new F(`${n} returned an unsupported video file.`, "INVALID_PROVIDER_RESPONSE", 502);
  return i ? "video/webm" : e === "video/quicktime" ? "video/quicktime" : "video/mp4";
}
function Ef(t, e = "media") {
  if (typeof Buffer < "u")
    return Buffer.from(t.buffer, t.byteOffset, t.byteLength).toString("base64");
  if (typeof btoa != "function")
    throw new F(`This CineGen runtime cannot encode the generated ${e}.`, "RUNTIME_UNSUPPORTED", 500);
  const r = [], n = 32 * 1024;
  for (let i = 0; i < t.byteLength; i += n) {
    const o = t.subarray(i, Math.min(t.byteLength, i + n));
    let a = "";
    for (let s = 0; s < o.byteLength; s += 1)
      a += String.fromCharCode(o[s]);
    r.push(a);
  }
  return btoa(r.join(""));
}
async function Sf(t, e, r, n) {
  try {
    await (await t(`${e.url}/artifact/${encodeURIComponent(n)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
    })).arrayBuffer().catch(() => {
    });
  } catch {
  }
}
async function Ks(t, e, r, n, i = "video", o = "LTX-2.5") {
  const a = new Uint8Array(n.byteSize);
  let s;
  const l = [];
  for (let c = 0; c < n.byteSize; c += Bo) {
    const p = Math.min(Bo, n.byteSize - c);
    l.push({ offset: c, length: p });
  }
  for (let c = 0; c < l.length; c += Vo) {
    const p = l.slice(c, c + Vo), f = await Promise.all(p.map(async ({ offset: m, length: y }) => {
      const h = new URL(`${e.url}/artifact/${encodeURIComponent(n.id)}`);
      h.searchParams.set("offset", String(m)), h.searchParams.set("length", String(y));
      const g = await xe(t, h.toString(), {
        headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
      }, `CineGen could not download the ${o} ${i} chunk.`);
      if (!g || typeof g != "object")
        throw new F(`${o} returned an invalid ${i} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
      const _ = typeof g.id == "string" ? g.id : "", b = Number(g.offset), v = Number(g.byteSize ?? g.byte_size), T = typeof (g.mediaType ?? g.media_type) == "string" ? String(g.mediaType ?? g.media_type).trim() : "", E = vf(g.data, o, i);
      if (_ !== n.id || b !== m || v !== n.byteSize || n.mediaType && T !== n.mediaType || E.byteLength !== y)
        throw new F(`${o} returned an inconsistent ${i} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
      return { offset: m, bytes: E };
    }));
    for (const m of f)
      m.offset === 0 && (s = m.bytes.slice(0, 12)), a.set(m.bytes, m.offset);
  }
  const u = Tf(s ?? new Uint8Array(), n.mediaType, i, o), d = Ef(a, i);
  return await Sf(t, e, r, n.id), { data: d, mediaType: u };
}
function Ys(t) {
  if (!t || typeof t != "object")
    return !1;
  const e = t.capabilities;
  return Number(t.apiVersion) >= 2 && e && typeof e == "object" && e.artifactChunks === !0;
}
async function Qs(t, e, r) {
  const n = await xe(t, `${e.url}/health`, {
    headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
  }, "CineGen could not verify the LTX-2.5 session.");
  if (Ys(n))
    return n;
  throw new F(
    "This LTX-2.5 Pod was started before CineGen's reliable video-transfer update. End this session in Settings, then start a new LTX-2.5 session before rendering again.",
    "SESSION_UPDATE_REQUIRED",
    409
  );
}
async function If(t, e, r, n) {
  const i = await Qs(t, e, r), o = i == null ? void 0 : i.capabilities, a = Array.isArray(i == null ? void 0 : i.installedModels) ? i.installedModels : [];
  if ((o == null ? void 0 : o.imageArtifacts) !== !0)
    throw new F(
      "This Pod was started before CineGen added session image generation. End it, then start a new session with the image model selected.",
      "SESSION_UPDATE_REQUIRED",
      409
    );
  if (!a.includes(n))
    throw new F(
      `${tn(n)} was not installed when this Pod was created. Start a new session with that image model selected.`,
      "IMAGE_MODEL_NOT_INSTALLED",
      409
    );
  return i;
}
function xf() {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}
function Af(t) {
  return t instanceof F && (t.code === "PROVIDER_TIMEOUT" || t.code === "PROVIDER_UNREACHABLE" || t.statusCode === 502 || t.statusCode === 504);
}
async function kf(t, e, r, n) {
  try {
    const i = await xe(t, `${e.url}/status/${n}`, {
      headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
    }, "CineGen could not recover the submitted generation.", [200, 404]);
    return i && typeof i == "object" && i.id === n ? i : void 0;
  } catch {
    return;
  }
}
async function Zs(t, e, r, n, i, o, a) {
  var c;
  const s = xf(), l = ((c = i == null ? void 0 : i.capabilities) == null ? void 0 : c.idempotentSubmissions) === !0, u = JSON.stringify({ input: { ...o, cinegen_job_id: s } }), d = () => xe(t, `${e.url}/run`, {
    method: "POST",
    headers: { ...n, "Idempotency-Key": s },
    body: u
  }, a, void 0, Mc);
  for (let p = 0; p < (l ? 2 : 1); p += 1)
    try {
      const f = await d(), m = typeof (f == null ? void 0 : f.id) == "string" ? f.id : "";
      if (!m)
        throw new F("The session did not return a generation job ID.", "INVALID_PROVIDER_RESPONSE", 502);
      if (l && m !== s)
        throw new F("The session returned a different generation job ID.", "INVALID_PROVIDER_RESPONSE", 502);
      return { payload: f, jobId: m };
    } catch (f) {
      if (!l || !Af(f))
        throw f;
      const m = await kf(t, e, r, s);
      if (m)
        return { payload: m, jobId: s };
      if (p === 1)
        throw f;
    }
  throw new F("CineGen could not confirm the generation submission.", "PROVIDER_TIMEOUT", 504);
}
async function jf(t, e = fetch) {
  const r = Di(t.podUrl, t.podId), n = Ie(t.podAuthToken, "RunPod session token"), i = { Authorization: `Bearer ${n}`, Accept: "application/json", "Content-Type": "application/json" };
  if (t.jobId) {
    const u = Zr(t.jobId, "RunPod generation job ID"), d = await xe(e, `${r.url}/status/${u}`, {
      headers: { Authorization: `Bearer ${n}`, Accept: "application/json" }
    }, "CineGen could not read the LTX-2.5 generation status."), c = String(d.status ?? "").toUpperCase();
    if (c === "IN_QUEUE")
      return { jobId: u, status: "queued", phase: "rendering", message: "Waiting for the LTX-2.5 renderer…" };
    if (c === "IN_PROGRESS")
      return { jobId: u, status: "in_progress", phase: "rendering", message: "LTX-2.5 is rendering the video…" };
    if (c === "FAILED")
      return { jobId: u, status: "failed", phase: "error", error: en(d, "LTX-2.5 generation failed.") };
    if (c === "COMPLETED") {
      const p = Math.min(20, Math.max(1, Math.round(Number(d.durationSec) || 5)));
      try {
        const f = Js(d.output), m = f ? { ...await Ks(e, r, n, f), durationSec: p, model: "LTX-2.5" } : wf(d.output, p);
        return { jobId: u, status: "completed", phase: "ready", output: m };
      } catch (f) {
        return { jobId: u, status: "failed", phase: "error", error: f instanceof Error ? f.message : "LTX-2.5 generation failed." };
      }
    }
    return { jobId: u, status: "in_progress", phase: "rendering", message: "LTX-2.5 is preparing the video…" };
  }
  if (!t.input)
    throw new F("Video generation input is required.", "MISSING_INPUT", 422);
  const o = Math.min(20, Math.max(1, Math.round(Number(t.input.durationSec) || 5))), a = {
    workflow: lf(t.input),
    images: [{ name: "cinegen-source.png", image: uf(t.input) }],
    cinegen_duration_sec: o,
    cinegen_task: "ltx-2.5"
  }, s = await Qs(e, r, n), { jobId: l } = await Zs(e, r, n, i, s, a, "CineGen could not submit the LTX-2.5 generation.");
  return { jobId: l, status: "queued", phase: "rendering", message: "LTX-2.5 generation queued." };
}
async function Rf(t, e = fetch) {
  var l;
  const r = Di(t.podUrl, t.podId), n = Ie(t.podAuthToken, "RunPod session token"), i = { Authorization: `Bearer ${n}`, Accept: "application/json", "Content-Type": "application/json" };
  if (t.jobId) {
    const u = Zr(t.jobId, "RunPod generation job ID"), d = await xe(e, `${r.url}/status/${u}`, {
      headers: { Authorization: `Bearer ${n}`, Accept: "application/json" }
    }, "CineGen could not read the session image generation status."), c = zo(d == null ? void 0 : d.task), p = zo(t.model ?? ((l = t.input) == null ? void 0 : l.model));
    if (c && p && c !== p)
      return { jobId: u, status: "failed", phase: "error", error: "The Pod returned an image-generation task that does not match this job." };
    const f = c ?? p;
    if (!f)
      return { jobId: u, status: "failed", phase: "error", error: "The Pod returned an invalid image-generation task." };
    const m = tn(f), y = String(d.status ?? "").toUpperCase();
    if (y === "IN_QUEUE")
      return { jobId: u, status: "queued", phase: "rendering", message: `Waiting for the ${m} renderer…` };
    if (y === "IN_PROGRESS")
      return { jobId: u, status: "in_progress", phase: "rendering", message: `${m} is rendering the image…` };
    if (y === "FAILED")
      return { jobId: u, status: "failed", phase: "error", error: en(d, `${m} generation failed.`) };
    if (y === "COMPLETED")
      try {
        const h = Js(d.output, "image", m), g = h ? { ...await Ks(e, r, n, h, "image", m), model: m } : bf(d.output, f);
        return { jobId: u, status: "completed", phase: "ready", output: g };
      } catch (h) {
        return { jobId: u, status: "failed", phase: "error", error: h instanceof Error ? h.message : `${m} generation failed.` };
      }
    return { jobId: u, status: "in_progress", phase: "rendering", message: `${m} is preparing the image…` };
  }
  if (!t.input)
    throw new F("Image generation input is required.", "MISSING_INPUT", 422);
  const o = gf(t.input), a = await If(e, r, n, o.model), { jobId: s } = await Zs(e, r, n, i, a, {
    workflow: o.workflow,
    images: o.images,
    cinegen_task: o.model,
    cinegen_preserve_input_dimensions: o.preserveInputDimensions
  }, `CineGen could not submit the ${o.label} generation.`);
  return { jobId: s, status: "queued", phase: "rendering", message: `${o.label} generation queued.` };
}
const Pf = of, Of = af, Nf = Hs, Cf = jf, qf = Rf, vt = "https://api.kie.ai/api/v1", Lf = 3e3, Uf = 120, Mf = {
  runway: `${vt}/runway/generate`,
  veo: `${vt}/veo/generate`,
  "4o-image": `${vt}/gpt4o-image/generate`,
  "suno-music": `${vt}/generate`
};
function Df(t) {
  for (const [e, r] of Object.entries(Mf))
    if (t.startsWith(e)) return r;
}
async function $f(t, e, r) {
  const n = Df(t), i = n ?? `${vt}/jobs/createTask`, o = n ? { ...e, callBackUrl: "" } : { model: t, input: e, callBackUrl: "" }, a = await fetch(i, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${r}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(o)
  });
  if (!a.ok) {
    const l = await a.json().catch(() => ({}));
    throw new Error(l.msg || `kie.ai error ${a.status}`);
  }
  const s = await a.json();
  if (s.code !== 200)
    throw new Error(s.msg || "Failed to create kie.ai task");
  return s.data.taskId;
}
async function Ff(t, e) {
  for (let r = 0; r < Uf; r++) {
    await new Promise((a) => setTimeout(a, Lf));
    const n = await fetch(`${vt}/jobs/recordInfo?taskId=${t}`, {
      headers: { Authorization: `Bearer ${e}` }
    });
    if (!n.ok) continue;
    const o = (await n.json()).data;
    if (o.state === "success")
      try {
        return JSON.parse(o.resultJson);
      } catch {
        return o;
      }
    if (o.state === "fail")
      throw new Error(o.failMsg || "kie.ai generation failed");
  }
  throw new Error("kie.ai generation timed out");
}
async function Bf(t, e, r) {
  const n = await $f(t, e, r);
  return await Ff(n, r);
}
const Vf = /* @__PURE__ */ new Set([
  "image",
  "start_image",
  "end_image",
  "video",
  "audio"
]), Gf = {
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
function el(t) {
  if (!t.startsWith("local-media://file")) return t;
  try {
    return decodeURIComponent(t.slice(18));
  } catch {
    return t.slice(18);
  }
}
function Hf(t, e) {
  const r = t.role ?? t.media_role ?? t.mediaRole;
  if (typeof r == "string" && Vf.has(r))
    return { role: r, explicit: !0 };
  const n = String(t.type ?? t.kind ?? t.media_type ?? t.mediaType ?? t.mime_type ?? "").toLowerCase();
  return n === "start_image" || n === "start-image" ? { role: "start_image", explicit: !0 } : n === "end_image" || n === "end-image" ? { role: "end_image", explicit: !0 } : n.includes("audio") ? { role: "audio", explicit: !0 } : n.includes("video") ? { role: "video", explicit: !0 } : n.includes("image") ? { role: "image", explicit: !0 } : { role: e, explicit: !1 };
}
function zf(t, e) {
  const r = t.split(/[?#]/, 1)[0].toLowerCase();
  return r.startsWith("data:audio/") || /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/.test(r) ? "audio" : r.startsWith("data:video/") || /\.(?:avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(r) ? "video" : e;
}
function Wf(t) {
  return t === "video" ? "start_image" : t === "text" ? "video" : t === "audio" ? "audio" : "image";
}
function sr(t, e, r = !1) {
  if (typeof t == "string") {
    const a = el(t).trim(), s = r ? zf(a, e) : e;
    return a ? [{ value: a, role: s }] : [];
  }
  if (Array.isArray(t))
    return t.flatMap((a) => sr(a, e, r));
  if (!t || typeof t != "object") return [];
  const n = t, i = Hf(n, e);
  if (Array.isArray(n.allUrls))
    return n.allUrls.flatMap((a) => sr(
      a,
      i.role,
      r && !i.explicit
    ));
  const o = n.value ?? n.url ?? n.fileRef ?? n.path ?? n.id ?? n.uuid ?? n.media_id ?? n.mediaId ?? n.frontalImageUrl;
  return sr(
    o,
    i.role,
    r && !i.explicit
  );
}
function Xf(t, e, r) {
  const n = [], i = {}, o = t === "seedance_2_5" ? "image" : Wf(r);
  for (const [a, s] of Object.entries(e)) {
    if (s == null) continue;
    if (a === "medias" || a === "higgsfield_media_inputs") {
      n.push(...sr(
        s,
        o,
        !0
      ));
      continue;
    }
    const l = Gf[a];
    if (l) {
      const u = l === "legacy-image" ? r === "video" ? "start_image" : "image" : l;
      n.push(...sr(s, u));
      continue;
    }
    i[a] = s;
  }
  if (t === "seedance_2_5" && n.length > 0 && (!i.mode || i.mode === "t2v")) {
    const a = n.some((s) => s.role === "image" || s.role === "start_image" || s.role === "end_image");
    i.mode = a ? "omni_reference" : "video_edit";
  }
  return {
    model: t,
    mediaType: r,
    ...n.length > 0 ? { medias: n } : {},
    ...Object.keys(i).length > 0 ? { params: i } : {}
  };
}
function Jf(t) {
  const e = {};
  return t.url && (e.url = t.url), t.urls && (e.urls = t.urls), t.text && (e.text = t.text), t.durationSec !== void 0 && (e.duration = t.durationSec), {
    output: e,
    ...t.url ? { url: t.url } : {},
    ...t.urls ? { urls: t.urls } : {},
    ...t.text ? { text: t.text } : {},
    ...t.jobId ? { jobId: t.jobId } : {},
    model: t.model,
    mediaType: t.mediaType,
    outputKind: t.outputKind
  };
}
async function Kf(t, e, r) {
  const n = await ei(Xf(t, e, r));
  return Jf(n);
}
const Xo = "https://api.runpod.ai/v2", Yf = 3e3, Qf = 120;
async function Zf(t, e, r) {
  if (!t) throw new Error("No RunPod endpoint ID configured for this model. Set it in the model definition.");
  const n = await fetch(`${Xo}/${t}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${r}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: e })
  });
  if (!n.ok) {
    const o = await n.json().catch(() => ({}));
    throw new Error(o.error || `RunPod error ${n.status}`);
  }
  const { id: i } = await n.json();
  for (let o = 0; o < Qf; o++) {
    await new Promise((l) => setTimeout(l, Yf));
    const a = await fetch(`${Xo}/${t}/status/${i}`, {
      headers: { Authorization: `Bearer ${r}` }
    });
    if (!a.ok) continue;
    const s = await a.json();
    if (s.status === "COMPLETED") {
      const l = s.output, u = (l == null ? void 0 : l.image_url) ?? (l == null ? void 0 : l.image);
      if (u && !u.startsWith("http") && !u.startsWith("local-media://")) {
        const d = u.includes(",") ? u.split(",")[1] : u, c = w.join(z.tmpdir(), `cinegen-runpod-${Date.now()}.png`);
        return await j.writeFile(c, Buffer.from(d, "base64")), { output: { ...l, image_url: `local-media://file${c}` } };
      }
      return { output: l };
    }
    if (s.status === "FAILED")
      throw new Error(s.error || "RunPod job failed");
  }
  throw new Error("RunPod job timed out");
}
async function ep(t, e, r) {
  const n = `${t.replace(/\/$/, "")}/generate/${e}`, i = await fetch(n, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: r })
  });
  if (!i.ok) {
    const o = await i.json().catch(() => ({}));
    throw new Error(o.detail || `Pod error ${i.status}`);
  }
  return await i.json();
}
async function Jo(t, e, r) {
  const n = `https://api.runpod.io/graphql?api_key=${t}`, i = r === "start" ? `mutation { podResume(input: { podId: "${e}" }) { id desiredStatus } }` : `mutation { podStop(input: { podId: "${e}" }) { id desiredStatus } }`, a = await (await fetch(n, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: i })
  })).json();
  if (a.errors)
    throw new Error(`RunPod pod ${r} failed: ${JSON.stringify(a.errors)}`);
  return a;
}
async function tp(t, e) {
  var l, u, d;
  const r = `https://api.runpod.io/graphql?api_key=${t}`, n = `{ pod(input: { podId: "${e}" }) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort type } } } }`, a = (l = (await (await fetch(r, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: n })
  })).json()).data) == null ? void 0 : l.pod;
  if (!a) throw new Error("Pod not found");
  const s = (d = (u = a.runtime) == null ? void 0 : u.ports) == null ? void 0 : d.find((c) => c.privatePort === 8e3 && c.isIpPublic);
  return {
    status: a.desiredStatus,
    ip: (s == null ? void 0 : s.ip) ?? null,
    port: (s == null ? void 0 : s.publicPort) ?? null
  };
}
const St = 14 * 1024 * 1024, Ko = 100 * 1024 * 1024, Yo = 100 * 1024 * 1024, rp = 45e3;
function Fi(t) {
  if (t.length >= 8 && t.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (t.length >= 3 && t[0] === 255 && t[1] === 216 && t[2] === 255) return "image/jpeg";
  if (t.length >= 12 && t.subarray(0, 4).toString("ascii") === "RIFF" && t.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (t.length >= 6 && /^GIF8[79]a$/.test(t.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (t.length >= 2 && t.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  if (t.length >= 12 && t.subarray(4, 8).toString("ascii") === "ftyp" && /^(avif|avis)$/.test(t.subarray(8, 12).toString("ascii"))) return "image/avif";
}
function np(t) {
  let e;
  try {
    e = new URL(t);
  } catch {
    throw new Error("The LTX-2.5 first-frame reference URL is invalid.");
  }
  const r = e.hostname.toLowerCase(), n = /^\d+(?:\.\d+){3}$/.test(r) || r.includes(":");
  if (e.protocol !== "https:" || e.username || e.password || r === "localhost" || r.endsWith(".localhost") || r.endsWith(".local") || n)
    throw new Error("The LTX-2.5 first-frame reference must use a public HTTPS URL.");
  return e;
}
async function ip(t) {
  const e = Number(t.headers.get("content-length"));
  if (Number.isFinite(e) && e > St)
    throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
  if (!t.body) {
    const o = Buffer.from(await t.arrayBuffer());
    if (o.byteLength > St) throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
    return o;
  }
  const r = t.body.getReader(), n = [];
  let i = 0;
  try {
    for (; ; ) {
      const { done: o, value: a } = await r.read();
      if (o) break;
      if (i += a.byteLength, i > St)
        throw await r.cancel(), new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
      n.push(Buffer.from(a));
    }
  } finally {
    r.releaseLock();
  }
  return Buffer.concat(n, i);
}
function Qo(t) {
  const e = Fi(t);
  if (!e) throw new Error("LTX-2.5 requires a supported raster image as its first-frame reference.");
  return `data:${e};base64,${t.toString("base64")}`;
}
async function tl(t) {
  if (t.startsWith("data:image/")) return t;
  if (t.startsWith("local-media://file")) {
    const e = el(t), r = await j.stat(e);
    if (!r.isFile()) throw new Error("The LTX-2.5 first-frame reference is not a file.");
    if (r.size > St) throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
    const n = await j.readFile(e);
    return Qo(n);
  }
  if (/^https?:\/\//i.test(t)) {
    const e = np(t), r = new AbortController(), n = setTimeout(() => r.abort(), rp);
    let i;
    try {
      i = await fetch(e, { redirect: "error", signal: r.signal });
    } catch {
      throw clearTimeout(n), new Error("Could not load the LTX-2.5 first-frame reference.");
    }
    try {
      if (!i.ok) throw new Error(`Could not load the LTX-2.5 first-frame reference (${i.status}).`);
      return Qo(await ip(i));
    } catch (o) {
      throw r.signal.aborted ? new Error("Loading the LTX-2.5 first-frame reference timed out.") : o;
    } finally {
      clearTimeout(n);
    }
  }
  throw new Error("The LTX-2.5 first-frame reference is not available to the desktop app.");
}
async function op(t) {
  var r;
  const e = (r = t.referenceImages) == null ? void 0 : r.find((n) => typeof n == "string" && n.trim());
  return {
    ...t,
    referenceImages: e ? [await tl(e)] : void 0
  };
}
function ap(t, e) {
  var a;
  const r = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(t.trim()), n = ((a = r == null ? void 0 : r[1]) == null ? void 0 : a.replace(/\s+/g, "")) ?? "";
  if (!n || n.length > Math.ceil(St / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(n) || n.length % 4 === 1)
    throw new Error(`RunPod reference image ${e + 1} is invalid or larger than 14 MB.`);
  const i = Buffer.from(n, "base64");
  if (!i.length || i.byteLength > St)
    throw new Error(`RunPod reference image ${e + 1} is invalid or larger than 14 MB.`);
  const o = Fi(i);
  if (o !== "image/png" && o !== "image/jpeg" && o !== "image/webp")
    throw new Error(`RunPod reference image ${e + 1} must be a PNG, JPEG, or WebP image.`);
  return `data:${o};base64,${i.toString("base64")}`;
}
async function sp(t) {
  const e = Array.isArray(t.referenceImages) ? t.referenceImages.filter((n) => typeof n == "string" && n.trim()) : [];
  if (e.length > 3)
    throw new Error("RunPod session image jobs support up to three reference images.");
  const r = await Promise.all(e.map(async (n, i) => {
    const o = n.trim().startsWith("data:") ? n : await tl(n.trim());
    return ap(o, i);
  }));
  return {
    ...t,
    referenceImages: r.length ? r : void 0
  };
}
async function lp(t) {
  var s;
  const e = (s = t.output) == null ? void 0 : s.data;
  if (!e) return t;
  const r = e.includes(",") ? e.slice(e.indexOf(",") + 1) : e;
  if (!r || r.length > Math.ceil(Ko / 3) * 4 + 8)
    throw new Error("The LTX-2.5 video is larger than CineGen can import automatically.");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(r) || r.length % 4 === 1)
    throw new Error("LTX-2.5 returned an invalid video file.");
  const n = Buffer.from(r, "base64");
  if (n.byteLength > Ko) throw new Error("The LTX-2.5 video is larger than CineGen can import automatically.");
  const i = n.length >= 4 && n.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")) ? ".webm" : n.length >= 12 && n.subarray(4, 8).toString("ascii") === "ftyp" ? ".mp4" : void 0;
  if (!i) throw new Error("LTX-2.5 returned an unsupported video file.");
  const o = await j.mkdtemp(w.join(z.tmpdir(), "cinegen-ltx25-")), a = w.join(o, `result${i}`);
  return await j.writeFile(a, n, { flag: "wx", mode: 384 }), {
    ...t,
    output: {
      ...t.output,
      url: `local-media://file${a}`,
      mediaType: i === ".webm" ? "video/webm" : "video/mp4",
      data: void 0
    }
  };
}
async function up(t) {
  var c, p;
  const e = (p = (c = t.output) == null ? void 0 : c.data) == null ? void 0 : p.trim();
  if (!e) return t;
  const r = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(e), n = ((r == null ? void 0 : r[1]) ?? e).replace(/\s+/g, "");
  if (!n || n.length > Math.ceil(Yo / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(n) || n.length % 4 === 1)
    throw new Error("RunPod returned an invalid or oversized image file.");
  const i = Buffer.from(n, "base64");
  if (!i.length || i.byteLength > Yo)
    throw new Error("RunPod returned an invalid or oversized image file.");
  const o = Fi(i), a = o === "image/png" ? ".png" : o === "image/jpeg" ? ".jpg" : o === "image/webp" ? ".webp" : void 0;
  if (!a || !o) throw new Error("RunPod returned an unsupported image file.");
  const s = await j.mkdtemp(w.join(z.tmpdir(), "cinegen-runpod-image-")), l = w.join(s, `result${a}`);
  await j.writeFile(l, i, { flag: "wx", mode: 384 });
  const { data: u, ...d } = t.output;
  return {
    ...t,
    output: {
      ...d,
      url: `local-media://file${l}`,
      mediaType: o
    }
  };
}
function ri(t) {
  K.fal.config({ credentials: t });
}
function dp(t) {
  const e = w.extname(t).toLowerCase();
  return {
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
  }[e] ?? "application/octet-stream";
}
async function Zo(t) {
  const e = decodeURIComponent(t.replace("local-media://file", "")), r = await j.readFile(e), n = dp(e), i = new Blob([r], { type: n }), o = new File([i], w.basename(e), { type: n });
  return K.fal.storage.upload(o);
}
async function Fr(t) {
  const e = {};
  for (const [r, n] of Object.entries(t))
    typeof n == "string" && n.startsWith("local-media://file") ? e[r] = await Zo(n) : Array.isArray(n) ? e[r] = await Promise.all(
      n.map(async (i) => typeof i == "string" && i.startsWith("local-media://file") ? Zo(i) : i && typeof i == "object" && !Array.isArray(i) ? Fr(i) : i)
    ) : n && typeof n == "object" && !Array.isArray(n) ? e[r] = await Fr(n) : e[r] = n;
  return e;
}
async function ea(t, e, r) {
  var n;
  ri(r), console.log("[fal] Calling model:", t, "with input:", JSON.stringify(e, null, 2));
  try {
    return await K.fal.subscribe(t, { input: e, logs: !0 });
  } catch (i) {
    throw console.error("[fal] Error details:", JSON.stringify((i == null ? void 0 : i.body) ?? i, null, 2)), (n = i == null ? void 0 : i.body) != null && n.detail && console.error("[fal] Validation errors:", JSON.stringify(i.body.detail, null, 2)), i;
  }
}
function cp() {
  I.handle("workflow:run", async (e, r) => {
    const {
      apiKey: n,
      kieKey: i,
      runpodKey: o,
      runpodEndpointId: a,
      podUrl: s,
      nodeId: l,
      nodeType: u,
      modelId: d,
      outputType: c,
      inputs: p
    } = r, { ALL_MODELS: f, resolveVideoModelEndpoint: m, sanitizeVideoInputsForEndpoint: y } = await import("./models-BHdS0kia.js"), h = f[d] ?? Object.values(f).find(
      (S) => S.id === d || S.altId === d || S.nodeType === d
    );
    if (!h) {
      if (d.startsWith("fal-ai/")) {
        const S = n;
        if (!S) throw new Error("No fal.ai API key provided. Add one in Settings.");
        ri(S);
        const A = await Fr(p), O = await ea(d, A, S);
        return O.data ?? O;
      }
      throw new Error(`Unknown model: ${d}`);
    }
    const g = h.provider;
    let _ = p;
    g !== "higgsfield" && (n && ri(n), _ = await Fr(p));
    let b = d.includes("/") ? d : h.id;
    const v = h.nodeType ?? d, T = Object.keys(_).some(
      (S) => S === "image_url" || S === "start_image_url" || S === "image_urls" || S === "imageUrl"
    );
    b = m(v, h, {
      hasImageInputs: T,
      quality: _.quality
    }), y(v, b, _);
    let E;
    if (g === "kie") {
      const S = i;
      if (!S) throw new Error("No kie.ai API key provided. Add one in Settings.");
      E = await Bf(b, _, S);
    } else if (g === "pod") {
      if (!s) throw new Error("No pod URL configured. Start your pod and set the URL in Settings.");
      const S = h.podRoute ?? b;
      E = await ep(s, S, _);
    } else if (g === "runpod") {
      const S = o;
      if (!S) throw new Error("No RunPod API key provided. Add one in Settings.");
      const A = a || h.runpodEndpointId || "";
      E = await Zf(A, _, S);
    } else if (g === "higgsfield") {
      const S = h.outputType;
      E = await Kf(b, _, c ?? (S === "video" ? "video" : S === "audio" ? "audio" : S === "text" ? "text" : S === "3d" || S === "model3d" || S === "model" ? "3d" : "image"));
    } else {
      const S = n;
      if (!S) throw new Error("No fal.ai API key provided. Add one in Settings.");
      E = await ea(b, _, S);
    }
    return E.data ?? E;
  });
  const t = /* @__PURE__ */ new Map();
  I.handle("workflow:poll-job", async (e, r) => {
    const n = t.get(r);
    if (!n) throw new Error("Job not found");
    return n;
  }), I.handle("pod:start", async (e, r) => await Jo(r.runpodKey, r.podId, "start")), I.handle("pod:stop", async (e, r) => await Jo(r.runpodKey, r.podId, "stop")), I.handle("pod:status", async (e, r) => await tp(r.runpodKey, r.podId)), I.handle("pod:setup-ltx25", async (e, r) => await Pf(r)), I.handle("pod:status-ltx25", async (e, r) => await Of(r)), I.handle("pod:terminate-ltx25", async (e, r) => await Nf(r)), I.handle("pod:generate-ltx25", async (e, r) => {
    const n = r.input ? await op(r.input) : void 0;
    return await lp(await Cf({ ...r, input: n }));
  }), I.handle("pod:generate-session-image", async (e, r) => {
    const n = r.input ? await sp(r.input) : void 0;
    return await up(await qf({ ...r, input: n }));
  });
}
const Pt = Lt(Ce), rl = "https://mcp.artlist.io/mcp", Ot = "artlist", fp = 1200 * 1e3, pp = [
  w.join(z.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
];
function Nt() {
  const t = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [w.join(z.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", t].filter(Boolean).join(w.delimiter)
  };
}
async function Rr() {
  for (const t of pp)
    try {
      const { stdout: e } = await Pt(t, ["--version"], {
        env: Nt(),
        timeout: 8e3
      });
      if (e.toLowerCase().includes("claude")) return t;
    } catch {
    }
  return null;
}
function mp() {
  return JSON.stringify({
    mcpServers: {
      [Ot]: {
        type: "http",
        url: rl
      }
    }
  });
}
function hp(t) {
  var i, o, a;
  const e = [...new Set((t.medias ?? []).map((s) => s.value.trim()).filter(Boolean))].slice(0, 3), r = [
    `duration: ${Math.max(1, Math.round(t.durationSec ?? 5))} seconds`,
    `aspect ratio: ${((i = t.aspectRatio) == null ? void 0 : i.trim()) || "16:9"}`,
    `resolution: ${((o = t.resolution) == null ? void 0 : o.trim()) || "720p"}`,
    `generated audio: ${t.generateAudio ? "on" : "off"}`,
    (a = t.model) != null && a.trim() && t.model.trim() !== "auto" ? `model: ${t.model.trim()}` : "model: choose the best available Artlist video model for this request"
  ], n = e.length > 0 ? [
    "",
    "REFERENCE IMAGES (identity and design are locked to these images):",
    ...e.map((s, l) => `${l + 1}. ${s}`),
    "Use every supplied reference. Preserve the depicted character, location, prop, vehicle, wardrobe, and design details in the video."
  ].join(`
`) : "";
  return [
    "Use the Artlist MCP to generate one finished video now. This request is already approved by the user and may consume Artlist credits.",
    "Do not merely recommend a model or explain how to generate it; call the Artlist generation tool and wait for the completed result.",
    "",
    "VIDEO BRIEF",
    t.prompt.trim(),
    "",
    "SETTINGS",
    ...r,
    n,
    "",
    "After generation, respond with JSON only in this shape:",
    '{"url":"direct downloadable video URL","generationId":"optional","accountUrl":"optional Artlist account/session URL","model":"optional","durationSec":5}'
  ].filter((s) => s !== "").join(`
`);
}
function lr(t) {
  if (!t || typeof t != "object") return [];
  const e = t, r = ["result", "data", "output"].flatMap((n) => {
    const i = e[n];
    if (i && typeof i == "object") return lr(i);
    if (typeof i == "string")
      try {
        return lr(JSON.parse(i));
      } catch {
        return [];
      }
    return [];
  });
  return [e, ...r];
}
function tt(t, e) {
  for (const r of e) {
    const n = t[r];
    if (typeof n == "string" && n.trim()) return n.trim();
  }
}
function gp(t) {
  var a, s, l;
  const e = t.trim();
  let r;
  try {
    r = JSON.parse(e);
  } catch {
    r = void 0;
  }
  const n = [e];
  if (r && typeof r == "object") {
    const u = r;
    for (const d of ["result", "text", "message"])
      typeof u[d] == "string" && n.unshift(u[d]);
  }
  const i = lr(r);
  for (const u of n) {
    const d = (a = u.match(/```(?:json)?\s*([\s\S]*?)```/i)) == null ? void 0 : a[1];
    for (const p of [d, u])
      if (p)
        try {
          i.unshift(...lr(JSON.parse(p)));
        } catch {
        }
    const c = (s = u.match(/\{[\s\S]*\}/)) == null ? void 0 : s[0];
    if (c)
      try {
        i.unshift(...lr(JSON.parse(c)));
      } catch {
      }
  }
  for (const u of i) {
    const d = tt(u, ["url", "videoUrl", "video_url", "downloadUrl", "download_url", "mediaUrl", "media_url"]);
    if (!d || !/^https?:\/\//i.test(d)) continue;
    const c = Number(u.durationSec ?? u.duration_sec ?? u.duration);
    return {
      url: d,
      mediaType: "video",
      ...Number.isFinite(c) && c > 0 ? { durationSec: c } : {},
      ...tt(u, ["generationId", "generation_id", "id"]) ? { generationId: tt(u, ["generationId", "generation_id", "id"]) } : {},
      ...tt(u, ["accountUrl", "account_url", "sessionUrl", "session_url"]) ? { accountUrl: tt(u, ["accountUrl", "account_url", "sessionUrl", "session_url"]) } : {},
      ...tt(u, ["model", "modelId", "model_id"]) ? { model: tt(u, ["model", "modelId", "model_id"]) } : {}
    };
  }
  const o = (l = n.join(`
`).match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/i)) == null ? void 0 : l[0];
  if (o) return { url: o, mediaType: "video" };
  throw new Error("Artlist finished without returning a downloadable video URL. Open the Artlist MCP session in your account to retrieve the generation.");
}
async function ur(t) {
  try {
    const { stdout: e, stderr: r } = await Pt(t, ["mcp", "get", Ot], {
      env: Nt(),
      timeout: 2e4
    }), n = `${e}
${r}`, i = /not connected|authentication required|needs authentication|login required|failed|error/i.test(n);
    return {
      connected: !i,
      configured: !0,
      ...i ? { error: "Artlist needs to be authorized." } : {}
    };
  } catch {
    return { connected: !1, configured: !1 };
  }
}
async function yp(t) {
  (await ur(t)).configured || await Pt(t, [
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    "user",
    Ot,
    rl
  ], {
    env: Nt(),
    timeout: 2e4
  });
}
function _p(t) {
  return `'${t.replace(/'/g, "'\\''")}'`;
}
function wp(t, e = process.platform, r = "/tmp/cinegen-artlist-login.command") {
  if (e === "darwin") {
    const n = [
      "#!/bin/zsh",
      "printf '\\033]0;Artlist sign in\\007'",
      `${_p(t)} mcp login ${Ot}`,
      "status=$?",
      "if (( status != 0 )); then",
      "  echo",
      '  echo "Artlist sign-in did not complete. Press Return to close."',
      "  read -r",
      "fi",
      "exit $status",
      ""
    ].join(`
`);
    return {
      file: "/usr/bin/open",
      args: [r],
      detached: !0,
      script: { path: r, contents: n }
    };
  }
  return { file: t, args: ["mcp", "login", Ot], detached: !1 };
}
function bp(t) {
  const e = t && typeof t == "object" ? `${String(t.message ?? "")}
${String(t.stderr ?? "")}` : String(t ?? "");
  return /stdin isn't a terminal|interactive terminal|authentication can't be completed/i.test(e) ? "Artlist sign-in needs an interactive window. Update Claude Code, then try Connect Artlist again." : /timed out|ETIMEDOUT/i.test(e) ? "Artlist sign-in timed out before browser authorization finished. Try connecting again." : "Artlist sign-in did not complete. Try Connect Artlist again.";
}
async function vp(t, e = 180 * 1e3) {
  const r = Date.now() + e;
  for (; Date.now() < r; ) {
    const n = await ur(t);
    if (n.connected) return n;
    await new Promise((i) => setTimeout(i, 2e3));
  }
  throw new Error("Artlist authorization was not completed. Finish sign-in in the browser, then try Connect Artlist again.");
}
async function Tp(t, e) {
  const r = w.join(W.getPath("userData"), "artlist-mcp-workspace");
  await at(r, { recursive: !0 });
  const n = hp(e), { stdout: i } = await Pt(t, [
    "-p",
    n,
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
    mp(),
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--disable-slash-commands",
    "--no-session-persistence"
  ], {
    cwd: r,
    env: Nt(),
    timeout: fp,
    maxBuffer: 10 * 1024 * 1024
  });
  return gp(i);
}
function Ep() {
  I.handle("artlist:account-status", async () => {
    const t = await Rr();
    return t ? ur(t) : { connected: !1, configured: !1, error: "Claude Code is required for the Artlist MCP connection." };
  }), I.handle("artlist:auth-login", async () => {
    const t = await Rr();
    if (!t) throw new Error("Install Claude Code before connecting Artlist.");
    await yp(t);
    const e = wp(
      t,
      process.platform,
      w.join(W.getPath("userData"), "artlist-login.command")
    );
    try {
      e.script && (await Su(e.script.path, e.script.contents, { mode: 448 }), await Iu(e.script.path, 448)), await Pt(e.file, e.args, {
        env: Nt(),
        timeout: e.detached ? 2e4 : 300 * 1e3,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch (r) {
      throw new Error(bp(r));
    }
    return e.detached ? vp(t) : ur(t);
  }), I.handle("artlist:auth-logout", async () => {
    const t = await Rr();
    t && await Pt(t, ["mcp", "logout", Ot], {
      env: Nt(),
      timeout: 2e4
    });
  }), I.handle("artlist:generate", async (t, e) => {
    var i;
    const r = await Rr();
    if (!r) throw new Error("Claude Code is required to use the Artlist MCP.");
    if (!(await ur(r)).connected) throw new Error("Connect your Artlist account in Settings before generating.");
    if (!((i = e == null ? void 0 : e.prompt) != null && i.trim())) throw new Error("Artlist generation requires a prompt.");
    return Tp(r, e);
  });
}
function nl(t, e, r = !1) {
  if (t === "Image Upscale" || t === "Video Upscale")
    return "Topview offers this on its website, but has not exposed an upscaling endpoint through this connection. No processing will be started.";
  if (t === "Video Lip Sync")
    return r ? void 0 : "Topview video lip sync requires a Topview API-key connection. Your MCP connection does not expose this tool. No provider or billing balance will be switched.";
  if (e && !e.includes("topview_avatar_video")) return "Talking avatars are not available through this Topview connection.";
}
function Sp(t, e, r, n) {
  const i = (u) => /audio/.test(u.role ?? "") ? "audio" : /video/.test(u.role ?? "") ? "video" : "image", o = t === "Video Lip Sync" || t === "Video Upscale" ? "video" : "image", a = r.filter((u) => i(u) === o), s = r.filter((u) => i(u) === "audio"), l = t.startsWith("Avatar") || t === "Video Lip Sync";
  if (a.length !== 1 || l && s.length !== 1 || r.length !== (l ? 2 : 1))
    throw new Error(`${t} requires exactly one ${o}${l ? " and one audio file" : ""}. Remove extra references before running.`);
  if (t.startsWith("Avatar") && e.length > 600) throw new Error("Topview allows up to 600 characters of avatar motion direction. Your text has been preserved; shorten it before running.");
  if (t === "Image Upscale" || t === "Video Upscale") throw new Error(nl(t));
  return t === "Video Lip Sync" ? {
    taskType: "lip_sync",
    request: { avatarSourceFrom: "0", videoFileId: a[0].fileId, audioSourceFrom: "0", audioFileId: s[0].fileId, modeType: "0", isSave2CustomAiAvatar: !1 }
  } : {
    taskType: "avatar_video",
    request: {
      mode: t === "Avatar 4 Fast" ? "avatar4Fast" : "avatar4",
      templateImageFileId: a[0].fileId,
      scriptMode: "audio",
      audioFileId: s[0].fileId,
      offPeak: !1,
      saveCustomAiAvatar: "false",
      ...e.trim() ? { customMotion: e.trim() } : {},
      ...n ? { boardId: n } : {}
    }
  };
}
const il = ["Avatar 4", "Avatar 4 Fast", "Video Lip Sync", "Image Upscale", "Video Upscale"];
function Ip(t) {
  return il.includes(t);
}
function ol(t, e, r = !1) {
  return nl(t, e, r);
}
function xp(t, e = !1) {
  return il.map((r) => {
    const n = r === "Image Upscale", i = r === "Video Lip Sync" || r === "Video Upscale", o = r.startsWith("Avatar"), a = o || r === "Video Lip Sync";
    return {
      id: `topview/${n ? "image" : "video"}/${r}`,
      nodeType: `topview-${n ? "image" : "video"}-${r.toLowerCase().replaceAll(" ", "-")}`,
      name: r,
      category: n ? "image-edit" : "video",
      outputType: n ? "image" : "video",
      provider: "topview",
      description: o ? "Create a talking video from one character image and one audio file. Optional motion direction." : r === "Video Lip Sync" ? "Sync one existing video to one audio file. Runs only when selected." : "Optional Topview upscaling. Currently unavailable through the connected integration.",
      unavailableReason: ol(r, t, e),
      responseMapping: { path: "url" },
      inputs: [
        { id: "prompt", portType: "text", label: o ? "Motion direction (optional)" : "Notes (optional)", required: !1, falParam: "prompt", fieldType: "port", description: o ? "Expressions and movement, up to 600 characters. Dialogue comes from the audio." : "Notes are kept in CineGen." },
        { id: "image_url", portType: "media", label: i ? "Source video" : "Source image", required: !1, falParam: "reference_images", fieldType: "element-list", multiple: !0, max: 1, maxItems: 1, mediaRole: "image", description: `Choose exactly one ${i ? "video" : "image"}.` },
        ...a ? [{ id: "audio_references", portType: "audio", label: "Dialogue audio", required: !1, falParam: "audio_urls", fieldType: "port", multiple: !0, maxItems: 1, mediaRole: "audio", description: "One audio file, including an ElevenLabs output." }] : []
      ]
    };
  });
}
function ta(t, e, r, n) {
  return Sp(t, e, r, n);
}
const de = (t) => t && typeof t == "object" && !Array.isArray(t) ? t : {};
function Ap(t) {
  const e = de(t), r = de(de(e.properties).req ?? e), n = de(de(r.properties).prompt).maxLength;
  return typeof n == "number" && Number.isInteger(n) && n > 0 ? n : void 0;
}
function kp(t, e) {
  const r = Ap(e), n = Array.from(String(t ?? "")).length;
  if (r !== void 0 && n > r)
    throw new Error(`Topview's Canvas audio-reference route accepts up to ${r.toLocaleString("en-US")} prompt characters; this prompt has ${n.toLocaleString("en-US")}. CineGen preserved the full prompt and did not submit a generation. Do not shorten or rewrite it without the user's approval.`);
}
function Bi(t) {
  const e = de(de(t.raw).parameters ?? t.parameters), r = de(e.supportHybridUploadsRef);
  if (r.audios === !1 || r.maxAudios === 0) return !1;
  if (r.audios === !0 || Number(r.maxAudios) > 0 || Number(e.maxRefAudioCount) > 0) return !0;
  const n = de(t.submitParameterOptions);
  return Object.hasOwn(n, "inputAudios") || Object.hasOwn(de(t.defaultSubmitParameters), "inputAudios") ? !0 : [t.submitModel, t.displayName, t.name].some((i) => typeof i == "string" && /seedance[-\s]+2[.\-](?:5|0)(?:\b|[-\s])/i.test(i));
}
function ra(t, e, r, n = !1) {
  if (e.taskType !== "omni_reference" || !Array.isArray(e.inputAudios) || !e.inputAudios.length) return "mcp";
  const i = de(t), o = de(de(i.properties).req ?? i);
  if (Object.hasOwn(de(o.properties), "inputAudios")) return "mcp";
  if (n && /seedance[-\s]+2[.\-]5(?:\b|[-\s])/i.test(String(e.model ?? ""))) return "canvas-mcp";
  throw new Error("Seedance 2.5 supports audio references, but this Topview MCP-plan connection does not expose them. An API connection with separate Topview API credits is required for audio-reference generation. No generation was submitted; your audio was not discarded.");
}
const jp = [
  "list_topview_canvases",
  "create_topview_canvas",
  "get_topview_canvas_state",
  "get_topview_canvas_generation_capabilities",
  "prepare_topview_canvas_media_upload",
  "create_topview_canvas_media_node",
  "submit_topview_canvas_generation_task",
  "refresh_topview_canvas_generation_task",
  "download_topview_canvas_nodes"
];
function Rp(t) {
  return jp.every((e) => t.includes(e));
}
function we(t) {
  var r, n, i;
  if (!t || typeof t != "object" || Array.isArray(t)) return {};
  const e = t;
  if (e.isError) throw new Error(((r = e.structuredContent) == null ? void 0 : r.message) || ((i = (n = e.content) == null ? void 0 : n[0]) == null ? void 0 : i.text) || "Topview Canvas could not complete this request.");
  if (e.structuredContent) return we(e.structuredContent);
  for (const o of e.content ?? [])
    if (o.type === "text") {
      let a;
      try {
        a = JSON.parse(o.text);
      } catch {
        continue;
      }
      return we(a);
    }
  if (e.errorCode) throw new Error(e.message || e.errorMessage || e.errorCode);
  return e.result && typeof e.result == "object" ? we(e.result) : e;
}
const ni = "cinegen-canvas:";
function qr(t) {
  if (!(typeof t != "string" || !t.startsWith(ni))) {
    try {
      const e = JSON.parse(atob(t.slice(ni.length).replace(/-/g, "+").replace(/_/g, "/")));
      if (["canvasId", "nodeId", "taskId"].every((r) => typeof e[r] == "string" && /^[\w.:@-]{1,200}$/.test(e[r]))) return e;
    } catch {
    }
    throw new Error("The saved Topview Canvas task is invalid. No new generation was submitted.");
  }
}
function Pp(t) {
  return ni + btoa(JSON.stringify(t)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function rt(t) {
  return /audio/.test(t.role) ? "audio" : /video/.test(t.role) ? "video" : "image";
}
function Op(t, e, r) {
  var l, u;
  const n = t.inputRoles ?? t.inputs ?? [], i = {};
  for (const d of r) {
    const c = `reference_${rt(d)}`;
    if (i[c] = (i[c] ?? 0) + 1, !n.some((p) => p.role === c)) throw new Error(`Topview ${t.displayName ?? t.model} does not accept ${rt(d)} references in this mode.`);
  }
  for (const d of n) {
    const c = i[d.role] ?? 0;
    if (c < (d.min ?? 0) || c > (d.max ?? 1 / 0)) throw new Error(`Topview ${t.displayName ?? t.model} allows ${d.min ?? 0}–${d.max} ${d.role.replace("reference_", "")} references in this mode.`);
  }
  for (const d of t.constraints ?? [])
    if (d.type === "require_any_roles" && !d.roles.some((c) => i[c]))
      throw new Error("Add at least one image or video alongside the audio. Topview’s Seedance 2.5 Canvas route currently requires a visual reference; audio-only generation was not submitted.");
  if (Number(e.generatingCount ?? 1) !== 1) throw new Error("Audio-reference video generation supports one output per request.");
  const o = ((l = t.parametersSchema) == null ? void 0 : l.properties) ?? {}, a = { ...t.defaults }, s = {
    duration: e.duration,
    resolution: e.resolution,
    aspectRatio: e.aspectRatio ?? e.ratio,
    nativeAudio: e.sound === void 0 ? void 0 : e.sound === !0 || e.sound === "true" || e.sound === "on",
    omniReferenceTaskType: e.omniReferenceTaskType
  };
  for (const [d, c] of Object.entries(s)) {
    if (c === void 0 || c === "") continue;
    if (!Object.hasOwn(o, d)) throw new Error(`Topview Canvas does not expose the requested ${d} setting for this model.`);
    const p = o[d].enum ?? ((u = t.parameterEnums) == null ? void 0 : u[d]), f = o[d].type === "number" ? Number(String(c).replace(/p$/i, "")) : c;
    if (p && !p.includes(f)) throw new Error(`Topview Canvas does not support ${d}=${c}. Available: ${p.join(", ")}.`);
    a[d] = f;
  }
  for (const d of t.requiredParameters ?? [])
    if (a[d] === void 0) throw new Error(`Topview requires ${d} for this generation.`);
  return a;
}
async function Np(t) {
  var y, h, g;
  const { call: e, request: r, references: n } = t;
  kp(r.prompt, t.submitSchema);
  let o = (h = (y = we(await e("list_topview_canvases", { limit: 50 })).canvases) == null ? void 0 : y.find((_) => _.name === "CineGen references")) == null ? void 0 : h.canvasId;
  if (o || (o = we(await e("create_topview_canvas", { name: "CineGen references" })).canvasId), typeof o != "string" || !o) throw new Error("Topview did not return the CineGen Canvas ID.");
  const a = we(await e("get_topview_canvas_generation_capabilities", {
    canvasId: o,
    mediaType: "video",
    include: ["schema"],
    refresh: !0
  })), s = (_) => String(_ ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"), l = (g = a.capabilities) == null ? void 0 : g.find((_) => _.taskType === "video_edit" && [_.model, _.displayName].some((b) => s(b) === s(r.model)));
  if (!l || !a.capabilityVersion) throw new Error(`Topview Canvas does not currently expose ${r.model} with audio references.`);
  const u = Op(l, r, n), c = (we(await e("get_topview_canvas_state", { canvasId: o, fields: ["nodes.geometry"] })).nodes ?? []).reduce((_, b) => {
    var v, T, E, x;
    return Math.max(
      _,
      Number(b.y ?? ((v = b.position) == null ? void 0 : v.y) ?? ((T = b.geometry) == null ? void 0 : T.y) ?? 0) + Number(b.height ?? ((E = b.measured) == null ? void 0 : E.height) ?? ((x = b.geometry) == null ? void 0 : x.height) ?? 400)
    );
  }, -80) + 80, p = [];
  for (const [_, b] of n.entries()) {
    if (b.value.startsWith("topview-file:")) throw new Error("Use the saved CineGen image URL for this audio-reference generation, rather than a temporary Topview upload ID.");
    const v = await t.load(b);
    if (!v.bytes.byteLength) throw new Error("A reference file is empty.");
    if (rt(b) === "audio" && (!["mp3", "wav"].includes(v.format.toLowerCase()) || v.bytes.byteLength > 15 * 1024 * 1024))
      throw new Error("Seedance audio references must be MP3 or WAV files up to 15 MB.");
    const T = we(await e("prepare_topview_canvas_media_upload", {
      canvasId: o,
      fileName: `reference-${_ + 1}.${v.format}`,
      fileSize: v.bytes.byteLength
    }));
    if (!/^https:\/\//.test(T.uploadUrl ?? "") || !T.objectKey) throw new Error("Topview did not return a usable Canvas upload destination.");
    const E = Object.fromEntries(Object.entries(T.requiredHeaders ?? {}).filter((A) => typeof A[1] == "string")), x = await fetch(T.uploadUrl, {
      method: "PUT",
      headers: E,
      body: new Blob([new Uint8Array(v.bytes)], { type: T.mimeType ?? v.mime }),
      redirect: "manual",
      signal: AbortSignal.timeout(9e4)
    });
    if (!x.ok) throw new Error(`Topview reference upload failed (HTTP ${x.status}). No generation was submitted.`);
    const S = we(await e("create_topview_canvas_media_node", {
      canvasId: o,
      mediaType: rt(b),
      url: T.objectKey,
      mimeType: T.mimeType ?? v.mime,
      title: `${rt(b)[0].toUpperCase()}${rt(b).slice(1)} reference ${_ + 1}`,
      x: _ % 4 * 340,
      y: c + Math.floor(_ / 4) * 300,
      width: 300,
      height: 240
    }));
    if (!S.nodeId || S.consistencyStatus && S.consistencyStatus !== "projected") throw new Error("Topview has not finished preparing this reference. No generation was submitted.");
    p.push({ role: `reference_${rt(b)}`, source: { kind: "canvas_node", nodeId: S.nodeId } });
  }
  const f = r.commandId ?? `cinegen-${crypto.randomUUID()}`, m = we(await e("submit_topview_canvas_generation_task", {
    canvasId: o,
    mediaType: "video",
    taskType: l.taskType,
    model: l.model,
    capabilityVersion: a.capabilityVersion,
    commandId: f,
    prompt: r.prompt,
    parameters: u,
    inputs: p,
    layout: { x: 0, y: c + Math.ceil(n.length / 4) * 300, width: 640, height: 400 }
  }));
  if (!m.nodeId || !m.taskId) throw new Error("Topview did not return a complete generation receipt. Check Topview before starting another generation.");
  return {
    taskId: Pp({ canvasId: o, nodeId: m.nodeId, taskId: m.taskId }),
    status: "running",
    model: r.model,
    durationSec: u.duration,
    canvasId: o
  };
}
async function Cp(t, e) {
  var s;
  const r = qr(e);
  if (!r) throw new Error("Not a Topview Canvas task.");
  const n = we(await t("refresh_topview_canvas_generation_task", { ...r, include: [] })), i = String(n.status ?? "").toLowerCase();
  if (/fail|error|cancel/.test(i)) return { taskId: e, status: "fail", errorMessage: n.errorMessage ?? n.message ?? "Topview could not finish this video." };
  if (!/success|complete|done|ready/.test(i) && !n.mediaRef) return { taskId: e, status: "running" };
  const a = (s = we(await t("download_topview_canvas_nodes", { canvasId: r.canvasId, nodeIds: [r.nodeId] })).downloadArtifacts) == null ? void 0 : s.find((l) => l.nodeId === r.nodeId && /^https:\/\//.test(l.url ?? ""));
  return a ? { taskId: e, status: "success", videoUrl: a.url } : { taskId: e, status: "running" };
}
const al = Ka(import.meta.url);
function sl(t) {
  return W.isPackaged ? t.replace("app.asar", "app.asar.unpacked") : t;
}
function ve() {
  const t = al("ffmpeg-static");
  return sl(t);
}
function Vi() {
  const t = al("ffprobe-static").path;
  return sl(t);
}
function ll() {
  if (W.isPackaged)
    return w.join(process.resourcesPath, "vendor", "fpcalc");
  const t = w.dirname(vi(import.meta.url));
  return w.resolve(t, "..", "vendor", "fpcalc", "fpcalc");
}
const ul = Lt(Ce), qp = 20 * 1e3, Lp = 300 * 1e3;
function Up(t) {
  const [e, r] = t.trim().split(/[x,\s]+/, 2).map((n) => Number.parseInt(n, 10));
  if (!(!Number.isInteger(e) || !Number.isInteger(r) || e <= 0 || r <= 0))
    return { width: e, height: r };
}
function Mp(t, e) {
  if (t.width * t.height >= e) return t;
  const r = Math.sqrt(e / (t.width * t.height));
  let n = Math.ceil(t.width * r / 2) * 2, i = Math.ceil(t.height * r / 2) * 2;
  for (; n * i < e; )
    n / t.width <= i / t.height ? n += 2 : i += 2;
  return { width: n, height: i };
}
async function na(t) {
  const { stdout: e } = await ul(Vi(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    t
  ], { timeout: qp });
  return Up(e);
}
async function Dp(t) {
  try {
    if (t.filePath) return await na(t.filePath);
    const e = await j.mkdtemp(w.join(z.tmpdir(), "cinegen-probe-"));
    try {
      const r = w.join(e, `reference.${t.format}`);
      return await j.writeFile(r, t.bytes), await na(r);
    } finally {
      await j.rm(e, { recursive: !0, force: !0 }).catch(() => {
      });
    }
  } catch {
    return;
  }
}
async function dl(t, e) {
  const r = await j.mkdtemp(w.join(z.tmpdir(), "cinegen-resize-"));
  try {
    const n = t.filePath ?? w.join(r, `reference.${t.format}`);
    t.filePath || await j.writeFile(n, t.bytes);
    const i = w.join(r, "reference-upscaled.mp4");
    return await ul(ve(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      n,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      e,
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
      i
    ], { timeout: Lp }), await j.readFile(i);
  } finally {
    await j.rm(r, { recursive: !0, force: !0 }).catch(() => {
    });
  }
}
function $p(t, e) {
  return dl(t, `scale=${e.width}:${e.height}:flags=lanczos`);
}
function Fp(t, e) {
  const r = `max(1,sqrt(${e}/(iw*ih)))`, n = `ceil(iw*${r}/2)*2`, i = `ceil(ih*${r}/2)*2`;
  return dl(t, `scale='${n}':'${i}':flags=lanczos`);
}
const Bp = [{ submitModel: "GPT Image 2.5 Flare", requiredSubmitFields: ["taskType", "model", "prompt", "inputImageFileIds", "aspectRatio", "resolution"], backendModelCode: "gpt-image-2.5-flare", taskType: "image_edit", provider: "gpt-image", displayName: "GPT Image 2.5 Flare", defaultSubmitParameters: { aspectRatio: "1:1", resolution: "1K" }, submitParameterOptions: { aspectRatio: ["auto", "9:16", "3:4", "1:1", "4:3", "16:9", "2:3", "3:2", "5:4", "4:5", "21:9", "9:21", "1:2", "2:1", "210:297", "297:210"], resolution: ["1K", "2K", "4K"], quality: ["low", "medium", "high", "xhigh", "max"] }, sort: 1, configSection: "imageEdit", status: 1 }, { submitModel: "GPT Image 2.5 Sunburst", requiredSubmitFields: ["taskType", "model", "prompt", "inputImageFileIds", "aspectRatio", "resolution"], backendModelCode: "gpt-image-2.5-sunburst", taskType: "image_edit", provider: "gpt-image", displayName: "GPT Image 2.5 Sunburst", defaultSubmitParameters: { aspectRatio: "1:1", resolution: "1K" }, submitParameterOptions: { aspectRatio: ["auto", "9:16", "3:4", "1:1", "4:3", "16:9", "2:3", "3:2", "5:4", "4:5", "21:9", "9:21", "1:2", "2:1", "210:297", "297:210"], resolution: ["1K", "2K", "4K"], quality: ["low", "medium", "high", "xhigh", "max"] }, sort: 1, configSection: "imageEdit", status: 1 }, { submitModel: "GPT Image 2.5 Flare", requiredSubmitFields: ["taskType", "model", "prompt", "aspectRatio", "resolution"], backendModelCode: "gpt-image-2.5-flare", taskType: "text_to_image", provider: "gpt-image", displayName: "GPT Image 2.5 Flare", defaultSubmitParameters: { aspectRatio: "1:1", resolution: "1K" }, submitParameterOptions: { aspectRatio: ["auto", "9:16", "3:4", "1:1", "4:3", "16:9", "2:3", "3:2", "5:4", "4:5", "21:9", "9:21", "1:2", "2:1", "210:297", "297:210"], resolution: ["1K", "2K", "4K"], quality: ["low", "medium", "high", "xhigh", "max"] }, sort: 1, configSection: "textToImage", status: 1 }, { submitModel: "GPT Image 2.5 Sunburst", requiredSubmitFields: ["taskType", "model", "prompt", "aspectRatio", "resolution"], backendModelCode: "gpt-image-2.5-sunburst", taskType: "text_to_image", provider: "gpt-image", displayName: "GPT Image 2.5 Sunburst", defaultSubmitParameters: { aspectRatio: "1:1", resolution: "1K" }, submitParameterOptions: { aspectRatio: ["auto", "9:16", "3:4", "1:1", "4:3", "16:9", "2:3", "3:2", "5:4", "4:5", "21:9", "9:21", "1:2", "2:1", "210:297", "297:210"], resolution: ["1K", "2K", "4K"], quality: ["low", "medium", "high", "xhigh", "max"] }, sort: 1, configSection: "textToImage", status: 1 }], Vp = {
  models: Bp
}, Gp = [
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
], Hp = [
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
], zp = [
  { displayName: "Topview Music", catalogType: "music" },
  { displayName: "Minimax Music 2.6", catalogType: "music" },
  { displayName: "Qwen3 TTS", catalogType: "voice" },
  { displayName: "Seed Audio 1.0", catalogType: "audio" }
], Wp = ["16:9", "9:16", "1:1", "4:3", "3:4"], Xp = ["1K", "2K", "4K"], Jp = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], Kp = ["720", "1080"], Yp = Array.from({ length: 27 }, (t, e) => String(e + 4));
function ke(t) {
  return typeof t == "object" && t !== null && !Array.isArray(t);
}
function ii(t, e = []) {
  return Array.isArray(t) ? t.forEach((r) => ii(r, e)) : ke(t) && (e.push(t), Object.values(t).forEach((r) => ii(r, e))), e;
}
function Qp(t) {
  for (const e of ii(t))
    if (Array.isArray(e.models)) return e.models.filter(ke);
  return [];
}
function Zp(t) {
  return ke(t) ? t.value ?? t.id ?? t.name ?? t.label : t;
}
function em(t, e) {
  const r = t.submitParameterOptions, n = ke(r) ? r[e] : Array.isArray(r) ? r.find((o) => ke(o) && (o.name === e || o.key === e || o.field === e)) : void 0;
  return (Array.isArray(n) ? n : ke(n) ? ["values", "options", "enum", "allowedValues"].map((o) => n[o]).find(Array.isArray) ?? [] : []).map(Zp).filter((o) => o != null);
}
function cl(t) {
  const e = /* @__PURE__ */ new Set();
  return t.filter((r) => {
    const n = JSON.stringify(r);
    return e.has(n) ? !1 : (e.add(n), !0);
  });
}
function fl(t) {
  const e = /* @__PURE__ */ new Map();
  for (const r of (t == null ? void 0 : t.configs) ?? [])
    if (!(r.outputType !== "image" && r.outputType !== "video" && r.outputType !== "audio"))
      for (const n of Qp(r.config)) {
        const i = String(
          n.displayName ?? n.name ?? n.submitModel ?? n.backendModelCode ?? ""
        ).trim();
        if (!i) continue;
        const o = `${r.outputType}:${i.toLowerCase()}`, a = e.get(o) ?? {
          displayName: i,
          submitModel: typeof n.submitModel == "string" ? n.submitModel : void 0,
          outputType: r.outputType,
          catalogType: r.catalogType ?? r.taskType,
          taskTypes: /* @__PURE__ */ new Set(),
          options: /* @__PURE__ */ new Map(),
          defaults: {},
          accepts: /* @__PURE__ */ new Set(),
          live: !0
        };
        a.catalogType ?? (a.catalogType = r.catalogType ?? r.taskType), a.taskTypes.add(r.taskType), r.taskType === "omni_reference" && (a.audioReferences = Bi(n)), typeof n.submitModel == "string" && (a.submitModel = n.submitModel), ke(n.defaultSubmitParameters) && (a.defaults = { ...a.defaults, ...n.defaultSubmitParameters }), (n.nativeAudio === !0 || n.supportsNativeAudio === !0) && (a.nativeAudio = !0), (n.nativeAudio === !1 || n.supportsNativeAudio === !1) && (a.nativeAudio ?? (a.nativeAudio = !1));
        for (const s of tm(n)) a.accepts.add(s);
        for (const s of Object.keys(ke(n.defaultSubmitParameters) ? n.defaultSubmitParameters : {}))
          a.accepts.add(s);
        for (const s of ["aspectRatio", "resolution", "duration", "quality", "sound"]) {
          const l = em(n, s);
          l.length && (a.accepts.add(s), a.options.set(s, cl([...a.options.get(s) ?? [], ...l])));
        }
        e.set(o, a);
      }
  return [...e.values()];
}
function nn(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function ia(t, e) {
  const r = t.length ? t : e;
  return cl(r).map((n) => ({ value: String(n), label: String(n) }));
}
function tm(t) {
  const e = t.requiredSubmitFields;
  return ke(e) ? Object.entries(e).filter(([, r]) => r !== !1).map(([r]) => r) : Array.isArray(e) ? e.flatMap((r) => {
    if (typeof r == "string") return [r];
    if (!ke(r)) return [];
    const n = r.name ?? r.key ?? r.field;
    return typeof n == "string" ? [n] : [];
  }) : [];
}
function It(t, e, r) {
  const n = t.options.get(e) ?? [];
  return n.length ? ia(n, []) : t.live && !t.accepts.has(e) ? [] : ia([], r);
}
function xt(t, e, r) {
  var i;
  const n = r === void 0 ? "" : String(r);
  return n && t.some((o) => o.value === n) ? n : t.some((o) => o.value === e) ? e : ((i = t[0]) == null ? void 0 : i.value) ?? e;
}
function rm(t) {
  const e = It(t, "aspectRatio", Wp), r = It(t, "resolution", Xp), n = It(t, "quality", []), i = t.taskTypes.size === 0 || t.taskTypes.has("text_to_image"), o = t.taskTypes.size === 0 || t.taskTypes.has("image_edit"), a = [
    { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" }
  ];
  return o && a.push(
    { id: "image_url", portType: "image", label: "Media", required: !1, falParam: "image_url", fieldType: "port", multiple: !0, mediaRole: "image" },
    { id: "extra_images", portType: "image", label: "Reference", required: !1, falParam: "image_urls", fieldType: "element-list", max: 15 }
  ), e.length && a.push({
    id: "aspect_ratio",
    portType: "text",
    label: "Aspect Ratio",
    required: !1,
    falParam: "aspect_ratio",
    fieldType: "select",
    default: xt(e, "16:9", t.defaults.aspectRatio),
    options: e
  }), r.length && a.push({
    id: "resolution",
    portType: "text",
    label: "Resolution",
    required: !1,
    falParam: "resolution",
    fieldType: "select",
    default: xt(r, "2K", t.defaults.resolution),
    options: r
  }), n.length && a.push({
    id: "quality",
    portType: "text",
    label: "Quality",
    required: !1,
    falParam: "quality",
    fieldType: "select",
    default: xt(n, "medium", t.defaults.quality),
    options: n
  }), {
    id: `topview/image/${t.submitModel ?? t.displayName}`,
    nodeType: `topview-image-${nn(t.displayName)}`,
    name: t.displayName,
    category: i ? "image" : "image-edit",
    description: i && o ? "Topview image generation and editing" : o ? "Topview image editing" : "Topview text-to-image generation",
    outputType: "image",
    provider: "topview",
    responseMapping: { path: "url" },
    inputs: a
  };
}
function nm(t) {
  const e = It(t, "aspectRatio", Jp), r = It(t, "resolution", Kp), n = It(t, "duration", Yp), i = t.options.get("sound") ?? [], o = t.nativeAudio === !0 || i.some((c) => String(c).toLowerCase() === "on"), a = t.taskTypes.size === 0 || t.taskTypes.has("omni_reference"), s = a && (t.audioReferences ?? Bi(t)), l = t.taskTypes.size === 0 || t.taskTypes.has("image_to_video"), u = [...t.taskTypes].map((c) => c.replaceAll("_", " ")).join(" · "), d = [
    { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" }
  ];
  return a ? (d.push(
    // Keep the historical handle ID so existing Spaces connections migrate in place.
    // Its payload is now explicitly reference media instead of a stack of start frames.
    // Omni-reference accepts stills, clips and audio: the submit builder sorts
    // them into inputImages / inputVideos / inputAudios by role. A 'media' port
    // is what lets a video output connect on the canvas without a false warning.
    { id: "image_url", portType: "media", label: "References", required: !1, falParam: "reference_images", fieldType: "port", multiple: !0, mediaRole: "image", description: s ? "Image, video, and audio references. Use audio_references for audio URLs without a file extension." : "Image and video references." },
    { id: "extra_images", portType: "media", label: "More References", required: !1, falParam: "image_urls", fieldType: "element-list", max: 30, mediaRole: "image", description: s ? "Additional images, videos, audio, or Elements." : "Additional images, videos, or Elements." }
  ), s && d.push({
    id: "audio_references",
    portType: "audio",
    label: "Audio References",
    required: !1,
    falParam: "audio_urls",
    fieldType: "port",
    multiple: !0,
    mediaRole: "audio",
    description: "Input audio guidance, separate from Generate Audio. Seedance 2.5 accepts up to 10 MP3/WAV files, 2–30 seconds each and 30 seconds total."
  })) : l && d.push({ id: "image_url", portType: "image", label: "Start Frame", required: !1, falParam: "image_url", fieldType: "port", mediaRole: "start_image" }), l && a && d.push(
    { id: "start_frame", portType: "image", label: "Start Frame", required: !1, falParam: "image_url", fieldType: "port", mediaRole: "start_image" },
    { id: "end_frame", portType: "image", label: "End Frame", required: !1, falParam: "end_frame_url", fieldType: "port", mediaRole: "end_image" }
  ), n.length && d.push({
    id: "duration",
    portType: "number",
    label: "Duration",
    required: !1,
    falParam: "duration",
    fieldType: "select",
    default: Number(xt(n, "5", t.defaults.duration)),
    options: n
  }), e.length && d.push({
    id: "aspect_ratio",
    portType: "text",
    label: "Aspect Ratio",
    required: !1,
    falParam: "aspect_ratio",
    fieldType: "select",
    default: xt(e, "16:9", t.defaults.aspectRatio),
    options: e
  }), r.length && d.push({
    id: "resolution",
    portType: "text",
    label: "Resolution",
    required: !1,
    falParam: "resolution",
    fieldType: "select",
    default: xt(r, "720", t.defaults.resolution),
    options: r
  }), o && d.push({
    id: "generate_audio",
    portType: "number",
    label: "Generate Audio",
    required: !1,
    falParam: "generate_audio",
    fieldType: "toggle",
    default: String(t.defaults.sound ?? "on").toLowerCase() !== "off"
  }), {
    id: `topview/video/${t.submitModel ?? t.displayName}`,
    nodeType: `topview-video-${nn(t.displayName)}`,
    name: t.displayName,
    category: "video",
    description: `Topview video generation${s ? " with image, video, and audio input references" : ""}${o ? " with native audio" : ""}${u ? ` · ${u}` : ""}`,
    outputType: "video",
    provider: "topview",
    responseMapping: { path: "url" },
    inputs: d
  };
}
function im(t) {
  const e = t.catalogType === "music" ? "music" : t.catalogType === "voice" ? "voice" : "audio", r = [
    {
      id: "prompt",
      portType: "text",
      label: e === "music" ? "Lyrics / Prompt" : "Text",
      required: !0,
      falParam: "prompt",
      fieldType: "port"
    }
  ];
  return e === "music" ? r.push(
    { id: "styles", portType: "text", label: "Music Style", required: !1, falParam: "styles", fieldType: "textarea", default: "" },
    { id: "instrumental", portType: "number", label: "Instrumental", required: !1, falParam: "instrumental", fieldType: "toggle", default: !1 },
    { id: "reference_audio", portType: "audio", label: "Reference Audio", required: !1, falParam: "reference_audio", fieldType: "port", mediaRole: "audio" }
  ) : e === "voice" ? r.push(
    { id: "voice_id", portType: "text", label: "Topview Voice ID", required: !0, falParam: "voice_id", fieldType: "text", default: "", placeholder: "Choose a voice ID from Topview" },
    { id: "voice_speed", portType: "number", label: "Voice Speed", required: !1, falParam: "voice_speed", fieldType: "range", default: 1, min: 0.8, max: 1.2, step: 0.05 },
    { id: "emotion", portType: "text", label: "Emotion", required: !1, falParam: "emotion", fieldType: "select", default: "neutral", options: ["neutral", "happy", "surprised", "angry", "sad", "fearful", "disgusted"].map((n) => ({ value: n, label: n[0].toUpperCase() + n.slice(1) })) }
  ) : r.push(
    { id: "reference_audio", portType: "audio", label: "Reference Audio", required: !0, falParam: "reference_audio", fieldType: "port", mediaRole: "audio" },
    { id: "emotion_text", portType: "text", label: "Emotion Direction", required: !1, falParam: "emotion_text", fieldType: "text", default: "" }
  ), {
    id: `topview/audio/${t.submitModel ?? t.displayName}`,
    nodeType: `topview-audio-${nn(t.displayName)}`,
    name: t.displayName,
    category: "audio",
    description: e === "music" ? "Topview AI music generation" : e === "voice" ? "Topview text-to-speech" : "Topview reference-guided audio generation",
    outputType: "audio",
    provider: "topview",
    responseMapping: { path: "url" },
    inputs: r
  };
}
function om() {
  return [
    ...Gp.map((t) => ({
      displayName: t,
      outputType: "image",
      taskTypes: /* @__PURE__ */ new Set(["text_to_image", "image_edit"]),
      options: /* @__PURE__ */ new Map(),
      defaults: {},
      accepts: /* @__PURE__ */ new Set()
    })),
    ...fl({ configs: Vp.models.map((t) => ({
      outputType: "image",
      taskType: t.taskType,
      config: { models: [t] }
    })) }),
    ...Hp.map((t) => ({
      displayName: t,
      outputType: "video",
      taskTypes: /* @__PURE__ */ new Set(["text_to_video", "image_to_video", "omni_reference"]),
      options: /* @__PURE__ */ new Map(),
      defaults: {},
      accepts: /* @__PURE__ */ new Set(),
      nativeAudio: ["Seedance 2.5", "Standard", "Fast", "Kling O3", "Kling V3", "Veo 3.1", "Veo 3.1 Fast", "Vidu Q3 Pro", "Wan 2.6", "Happy Horse 1.1"].includes(t)
    })),
    ...zp.map(({ displayName: t, catalogType: e }) => ({
      displayName: t,
      outputType: "audio",
      catalogType: e,
      taskTypes: /* @__PURE__ */ new Set([e]),
      options: /* @__PURE__ */ new Map(),
      defaults: {},
      accepts: /* @__PURE__ */ new Set()
    }))
  ];
}
function Ww(t) {
  const e = fl(t), n = (e.length ? e : om()).map((i) => i.outputType === "image" ? rm(i) : i.outputType === "video" ? nm(i) : im(i));
  return Object.fromEntries([...n, ...xp(t == null ? void 0 : t.tools, (t == null ? void 0 : t.authMode) === "api_key")].map((i) => [i.nodeType, i]));
}
const oa = -1, am = "[-\\u2010-\\u2015\\u2212]", sm = new RegExp(
  `duration\`?\\s*(?:must|should)\\s+be\\s*\`?\\s*${am}\\s*1\\b`,
  "i"
), lm = /task\s+as\s+video\s+editing|duration\s+follows?\s+the\s+input\s+video/i;
function pl(t) {
  return /duration/i.test(t) ? sm.test(t) || lm.test(t) : !1;
}
const um = "https://mcp.topview.ai/mcp", kn = "https://mcp.topview.ai", dm = "https://www.topview.ai/mcp_oauth/oauth/authorize", cm = "https://www.topview.ai/mcp_oauth/oauth/token", fm = "https://www.topview.ai/mcp_oauth/oauth/register", aa = "https://www.topview.ai/mcp_oauth/oauth/userinfo", pm = 300 * 1e3, jn = 1200 * 1e3, mm = 90 * 1e3, hm = 30 * 1e3, Ct = 45 * 1024 * 1024, sa = 50;
function $(t) {
  return typeof t == "object" && t !== null && !Array.isArray(t);
}
function Rn(t) {
  return t.toString("base64url");
}
function Pn(t, e) {
  return t instanceof Error && t.message.trim() ? t.message.trim() : typeof t == "string" && t.trim() ? t.trim() : e;
}
function On(t) {
  return t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function gm(t, e) {
  const r = t ? "Topview connected" : "Topview connection failed";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${On(r)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f2eee8;font-family:system-ui,sans-serif}main{width:min(440px,calc(100vw - 48px));padding:34px;border:1px solid #343239;border-radius:22px;background:#191a20;box-shadow:0 24px 80px #0008}small{color:#d7a552;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;margin:10px 0 8px}p{color:#aaa6a0;line-height:1.55;margin:0}</style></head><body><main><small>CineGen + Topview</small><h1>${On(r)}</h1><p>${On(e)}</p></main><script>setTimeout(()=>window.close(),1100)<\/script></body></html>`;
}
function la(t, e, r) {
  const n = gm(e, r);
  t.writeHead(e ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(n),
    "Cache-Control": "no-store"
  }), t.end(n);
}
class ym {
  constructor() {
    this.root = w.join(W.getPath("userData"), "integrations", "topview");
  }
  availabilityError() {
    try {
      return Ir.isEncryptionAvailable() ? process.platform === "linux" && Ir.getSelectedStorageBackend() === "basic_text" ? "Topview sign-in requires a Linux secret store such as GNOME Keyring or KWallet." : void 0 : "Secure credential storage is unavailable on this device. Configure the operating-system keychain, then restart CineGen.";
    } catch {
      return "Secure credential storage is unavailable on this device. Restart CineGen and try again.";
    }
  }
  assertAvailable() {
    const e = this.availabilityError();
    if (e) throw new Error(e);
  }
  async read(e) {
    try {
      this.assertAvailable();
      const r = JSON.parse(await j.readFile(w.join(this.root, `${e}.safe.json`), "utf8"));
      if (r.version !== 1 || typeof r.data != "string")
        throw new Error("Topview credentials are stored in an unsupported format. Connect the account again.");
      const n = Ir.decryptString(Buffer.from(r.data, "base64")), i = JSON.parse(n);
      if (!$(i)) throw new Error("Topview credentials are invalid. Connect the account again.");
      return i;
    } catch (r) {
      if (r.code === "ENOENT") return null;
      throw r;
    }
  }
  async write(e, r) {
    this.assertAvailable(), await j.mkdir(this.root, { recursive: !0 });
    const n = JSON.stringify({
      version: 1,
      data: Ir.encryptString(JSON.stringify(r)).toString("base64")
    }), i = w.join(this.root, `${e}.safe.json`), o = `${i}.${process.pid}.${J.randomUUID()}.tmp`;
    try {
      await j.writeFile(o, `${n}
`, { mode: 384 }), await j.rename(o, i), await j.chmod(i, 384).catch(() => {
      });
    } catch (a) {
      throw await j.unlink(o).catch(() => {
      }), a;
    }
  }
  async remove(e) {
    await j.unlink(w.join(this.root, `${e}.safe.json`)).catch((r) => {
      if (r.code !== "ENOENT") throw r;
    });
  }
}
async function ml(t) {
  const e = await t.text();
  if (e)
    try {
      return JSON.parse(e);
    } catch {
      return e;
    }
}
function oi(t, e, r) {
  const n = $(e) ? e.error_description ?? e.message ?? e.error : e;
  return new Error(typeof n == "string" && n.trim() ? n.trim() : `${r} (${t})`);
}
async function Nn(t, e, r) {
  let n;
  try {
    n = await fetch(t, e);
  } catch (o) {
    throw new Error(`Could not reach Topview. ${r}`, { cause: o });
  }
  const i = await ml(n);
  if (!n.ok) throw oi(n.status, i, r);
  if (!$(i)) throw new Error(`${r} Topview returned an invalid response.`);
  return i;
}
function _m(t, e) {
  const r = [];
  for (const n of t.split(/\r?\n\r?\n/)) {
    const i = n.split(/\r?\n/).filter((o) => o.startsWith("data:")).map((o) => o.slice(5).trim()).join(`
`);
    if (i)
      try {
        r.push(JSON.parse(i));
      } catch {
      }
  }
  return r.find((n) => $(n) && n.id === e) ?? r.find((n) => $(n) && (n.result !== void 0 || n.error !== void 0)) ?? r.at(-1);
}
function st(t, e = [], r = 0) {
  if (r > 14 || t === null || t === void 0) return e;
  if (Array.isArray(t))
    for (const n of t) st(n, e, r + 1);
  else if ($(t)) {
    e.push(t);
    for (const n of Object.values(t)) st(n, e, r + 1);
  }
  return e;
}
function Br(t, e = [], r = 0) {
  if (r > 14 || t === null || t === void 0) return e;
  if (typeof t == "string") e.push(t);
  else if (Array.isArray(t)) for (const n of t) Br(n, e, r + 1);
  else if ($(t)) for (const n of Object.values(t)) Br(n, e, r + 1);
  return e;
}
function ne(t) {
  const e = [t];
  if (!$(t)) return e;
  if (t.structuredContent !== void 0 && e.unshift(t.structuredContent), Array.isArray(t.content)) {
    for (const r of t.content)
      if (!(!$(r) || typeof r.text != "string"))
        try {
          e.unshift(JSON.parse(r.text));
        } catch {
          e.push(r.text);
        }
  }
  return e;
}
function te(t, e) {
  const r = new Set(e.map((n) => n.toLowerCase()));
  for (const n of st(t))
    for (const [i, o] of Object.entries(n))
      if (r.has(i.toLowerCase()) && typeof o == "string" && o.trim()) return o.trim();
}
function ua(t) {
  const e = /* @__PURE__ */ new Set([
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
  for (const r of st(t))
    for (const [n, i] of Object.entries(r)) {
      if (!e.has(n.toLowerCase())) continue;
      const o = typeof i == "number" ? i : typeof i == "string" ? Number(i) : Number.NaN;
      if (Number.isFinite(o)) return o;
    }
}
function wm(t) {
  if (typeof t == "boolean") return t;
  for (const e of st(t))
    for (const [r, n] of Object.entries(e))
      if (/^(ok|success|exists|ready|verified)$/i.test(r) && typeof n == "boolean") return n;
}
function mt(t) {
  const e = te(t, [
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
  return e && /^https?:\/\//i.test(e) ? e : Br(t).find((r) => /^https?:\/\//i.test(r) && (/\.(?:mp4|mov|webm|png|jpe?g|webp|avif)(?:[?#]|$)/i.test(r) || /cloudfront|cdn|output|result/i.test(r)));
}
function da(t) {
  const e = te(t, [
    "fileId",
    "file_id",
    "outputFileId",
    "output_file_id",
    "mediaFileId",
    "media_file_id"
  ]);
  return e ? `topview-file:${e}` : void 0;
}
function Qt(t) {
  return (te(t, ["status", "taskStatus", "task_status", "state"]) ?? "").toLowerCase();
}
function hl(t, e) {
  if (!$(e)) return t;
  const r = Array.isArray(e.type) ? e.type : [e.type];
  if (r.includes("boolean") && typeof t == "string") {
    if (/^(?:true|1|yes|on)$/i.test(t)) return !0;
    if (/^(?:false|0|no|off)$/i.test(t)) return !1;
  }
  if ((r.includes("integer") || r.includes("number")) && typeof t == "string" && t.trim()) {
    const n = Number(t);
    if (Number.isFinite(n) && (!r.includes("integer") || Number.isInteger(n))) return n;
  }
  return r.includes("array") && Array.isArray(t) ? t.map((n) => hl(n, e.items)) : r.includes("object") && $(t) ? gl(e, t) : t;
}
function gl(t, e) {
  if (!$(t)) return { ...e };
  const r = $(t.properties) ? t.properties : {}, i = ($(r.req) ? r.req : void 0) ?? t, o = $(i.properties) ? i.properties : {}, a = i.additionalProperties === !1 && Object.keys(o).length > 0, s = {};
  for (const [l, u] of Object.entries(e))
    a && !Object.hasOwn(o, l) || (s[l] = hl(u, o[l]));
  return s;
}
function bm(t, e) {
  var i;
  const r = $((i = t.inputSchema) == null ? void 0 : i.properties) ? t.inputSchema.properties : {}, n = gl(t.inputSchema, e);
  return Object.hasOwn(r, "req") ? { req: n } : n;
}
function yl(t, e) {
  for (const r of st(t))
    for (const [n, i] of Object.entries(r))
      if (e.test(n) && Array.isArray(i)) return i;
}
function vm(t) {
  const r = (yl(t, /^(?:boards|list|items|records|data|rows)$/i) ?? []).filter($).map((i) => ({
    boardId: String(i.boardId ?? i.board_id ?? i.id ?? "").trim(),
    name: typeof i.name == "string" ? i.name : typeof i.boardName == "string" ? i.boardName : void 0,
    isSystemDefault: i.isSystemDefault === !0 || i.is_system_default === !0,
    taskCount: Number(i.taskCount ?? i.task_count ?? 0) || 0
  })).filter((i) => i.boardId);
  return r.filter((i) => {
    var o;
    return ((o = i.name) == null ? void 0 : o.trim().toLowerCase()) === "cinegen";
  }).sort((i, o) => o.taskCount - i.taskCount)[0] ?? r.find((i) => i.isSystemDefault) ?? r.find((i) => i.name === "My First Board") ?? r[0];
}
function Tm(t) {
  return (yl(t, /^models$/i) ?? []).filter($);
}
function _l(t, e) {
  const r = t.submitParameterOptions;
  if ($(r)) {
    const n = r[e];
    if (Array.isArray(n)) return n.map(Cn);
    if ($(n)) {
      for (const i of ["values", "options", "enum", "allowedValues"])
        if (Array.isArray(n[i])) return n[i].map(Cn);
    }
  }
  if (Array.isArray(r)) {
    const n = r.find((i) => $(i) && (i.name === e || i.key === e || i.field === e));
    if ($(n)) {
      for (const i of ["values", "options", "enum", "allowedValues"])
        if (Array.isArray(n[i])) return n[i].map(Cn);
    }
  }
  return [];
}
function Cn(t) {
  return $(t) ? t.value ?? t.key ?? t.id ?? t.name : t;
}
function Gi(t) {
  return $(t.requiredSubmitFields) ? Object.entries(t.requiredSubmitFields).filter(([, e]) => e === !0 || $(e)).map(([e]) => e) : Array.isArray(t.requiredSubmitFields) ? t.requiredSubmitFields.map((e) => {
    if (typeof e == "string") return e;
    if (!$(e)) return "";
    const r = e.name ?? e.key ?? e.field;
    return typeof r == "string" ? r : "";
  }).filter(Boolean) : [];
}
function Em(t) {
  const e = t.submitParameterOptions;
  return $(e) ? Object.keys(e) : Array.isArray(e) ? e.map((r) => {
    if (!$(r)) return "";
    const n = r.name ?? r.key ?? r.field;
    return typeof n == "string" ? n : "";
  }).filter(Boolean) : [];
}
function dr(t, e) {
  const r = $(t.defaultSubmitParameters) ? t.defaultSubmitParameters : {};
  return Object.hasOwn(r, e) || Gi(t).includes(e) || Em(t).includes(e);
}
function ai(t) {
  if (t.nativeAudio === !1 || t.supportsNativeAudio === !1) return !1;
  if (t.nativeAudio === !0 || t.supportsNativeAudio === !0) return !0;
  const e = _l(t, "sound");
  if (e.length) return vl(e, "on") !== void 0;
  if (($(t.defaultSubmitParameters) ? t.defaultSubmitParameters : {}).sound === "on" || dr(t, "sound")) return !0;
}
function At(t) {
  return [t.submitModel, t.displayName, t.name].filter((e) => typeof e == "string" && !!e.trim());
}
function wl(t, e, r = !1) {
  const n = Tm(t);
  if (!n.length) throw new Error("Topview did not return a compatible model for this request.");
  const i = e == null ? void 0 : e.trim();
  if (i && i !== "auto") {
    const s = n.find((l) => At(l).some((u) => u.toLowerCase() === i.toLowerCase()));
    if (!s)
      throw new Error(`Topview model "${i}" is not available for this generation type. Refresh the model choice and try again.`);
    if (r && ai(s) === !1)
      throw new Error(`Topview model "${i}" does not support native sound. Disable sound or choose a model that does.`);
    return s;
  }
  const o = te(t, ["preferredSubmitModel", "preferred_submit_model"]), a = n.find((s) => At(s).includes(o ?? "")) ?? n.find((s) => s.preferred === !0) ?? n[0];
  if (r && ai(a) === !1)
    throw new Error(`Topview's default model "${At(a)[0] ?? "selected"}" does not support native sound. Disable sound or explicitly choose another model.`);
  return a;
}
function Sm(t) {
  return (t ?? []).flatMap((e) => typeof (e == null ? void 0 : e.value) == "string" && e.value.trim() ? [{ value: e.value.trim(), role: "image" }] : []).filter((e, r, n) => n.findIndex((i) => i.value === e.value) === r);
}
function ca(t) {
  var a;
  const e = t.references.length ? "image_edit" : "text_to_image", r = wl(t.config, t.params.model), n = (a = At(r)[0]) == null ? void 0 : a.trim();
  if (!n) throw new Error("Topview returned an image model without a submit identifier.");
  const i = $(r.defaultSubmitParameters) ? r.defaultSubmitParameters : {}, o = {
    taskType: e,
    model: n,
    prompt: bl(t.params.prompt),
    generateCount: Math.max(1, Math.min(4, Math.round(t.params.generateCount ?? 1))),
    boardId: t.boardId,
    ...t.references.length ? { inputImageFileIds: t.references.map((s) => s.fileId) } : {}
  };
  for (const [s, l, u] of [
    ["aspectRatio", t.params.aspectRatio, "16:9"],
    ["resolution", t.params.resolution, "1K"],
    ["quality", t.params.quality, "medium"]
  ])
    dr(r, s) && (o[s] = si({ model: r, field: s, requested: l, fallback: u }));
  for (const s of Gi(r))
    if ((o[s] === void 0 || o[s] === null || o[s] === "") && i[s] !== void 0 && (o[s] = i[s]), o[s] === void 0 || o[s] === null || o[s] === "")
      throw new Error(`Topview's selected image model requires the unsupported field "${s}".`);
  return { req: o, model: n, taskType: e };
}
const Im = "Keep the frame free of on-screen text, captions, and subtitles.";
function bl(t) {
  return `${t.replace(/@([A-Za-z0-9][A-Za-z0-9_-]*)/g, (r, n) => n.replaceAll("-", " ")).replace(/\s{2,}/g, " ").trim()}

${Im}`;
}
function vl(t, e) {
  if (e === void 0) return;
  const r = typeof e == "number" ? e : typeof e == "string" && /^-?\d+(?:\.\d+)?p?$/i.test(e.trim()) ? Number.parseFloat(e) : void 0;
  return t.find((n) => {
    if (r !== void 0) {
      const i = typeof n == "number" ? n : typeof n == "string" && /^-?\d+(?:\.\d+)?p?$/i.test(n.trim()) ? Number.parseFloat(n) : void 0;
      if (i !== void 0) return i === r;
    }
    return String(n).toLowerCase() === String(e).toLowerCase();
  });
}
function xm(t, e) {
  const r = t.submitParameterOptions;
  let n;
  if ($(r) ? n = r[e] : Array.isArray(r) && (n = r.find((s) => $(s) && (s.name === e || s.key === e || s.field === e))), !$(n)) return {};
  const i = Number(n.min ?? n.minimum), o = Number(n.max ?? n.maximum), a = Number(n.step ?? n.multipleOf);
  return {
    ...Number.isFinite(i) ? { min: i } : {},
    ...Number.isFinite(o) ? { max: o } : {},
    ...Number.isFinite(a) && a > 0 ? { step: a } : {}
  };
}
function si(t) {
  const e = $(t.model.defaultSubmitParameters) ? t.model.defaultSubmitParameters : {}, r = t.requested !== void 0, n = e[t.field] !== void 0 && e[t.field] !== null, i = t.requested ?? e[t.field] ?? t.fallback;
  if (i === void 0) {
    if (t.required) throw new Error(`Topview model configuration requires "${t.field}", but did not provide a usable default.`);
    return;
  }
  const o = _l(t.model, t.field);
  if (o.length) {
    const s = vl(o, i);
    if (s === void 0) {
      if (!r && !n) return o[0];
      throw new Error(`Topview model "${At(t.model)[0] ?? "selected"}" does not allow ${t.field}=${String(i)}. Allowed values: ${o.map(String).join(", ")}.`);
    }
    return s;
  }
  const a = xm(t.model, t.field);
  if (a.min !== void 0 || a.max !== void 0 || a.step !== void 0) {
    const s = Number(i);
    if (!Number.isFinite(s) || a.min !== void 0 && s < a.min || a.max !== void 0 && s > a.max || a.step !== void 0 && a.min !== void 0 && Math.abs((s - a.min) / a.step - Math.round((s - a.min) / a.step)) > 1e-9)
      throw new Error(`Topview model "${At(t.model)[0] ?? "selected"}" does not allow ${t.field}=${String(i)}.`);
    return s;
  }
  return i;
}
function li(t) {
  const e = t ?? [], r = /* @__PURE__ */ new Set(["image", "start_image", "end_image", "video", "audio"]), n = e.map((i, o) => {
    var s;
    if (!i || typeof i.value != "string" || !i.value.trim())
      throw new Error(`Topview element reference ${o + 1} is empty.`);
    const a = ((s = i.role) == null ? void 0 : s.trim()) || "image";
    if (!r.has(a)) throw new Error(`Topview does not support element role "${a}".`);
    return { value: i.value.trim(), role: a };
  });
  if (n.filter((i) => i.role === "start_image").length > 1)
    throw new Error("Topview accepts only one start-frame element per generation.");
  if (n.filter((i) => i.role === "end_image").length > 1)
    throw new Error("Topview accepts only one end-frame element per generation.");
  return n;
}
function Am(t) {
  const e = li(t);
  if (!e.length) return "text_to_video";
  const r = e.filter((i) => i.role === "start_image"), n = e.every((i) => i.role === "start_image" || i.role === "end_image");
  return r.length === 1 && n ? "image_to_video" : "omni_reference";
}
function qn(t) {
  var p, f;
  const e = wl(t.config, t.params.model, t.params.generateAudio === !0), r = String(e.submitModel ?? "").trim();
  if (!r) throw new Error("Topview returned a video model without a submit identifier.");
  const n = $(e.defaultSubmitParameters) ? e.defaultSubmitParameters : {}, i = new Set(Gi(e)), o = t.params.durationSec === void 0 ? void 0 : Math.round(t.params.durationSec);
  if (o !== void 0 && (!Number.isFinite(o) || o === 0 || o < -1))
    throw new Error("Topview video duration must be a positive whole number of seconds.");
  let a = bl(t.params.prompt);
  const s = {
    ...n,
    taskType: t.taskType,
    model: r,
    prompt: a,
    boardId: t.boardId
  };
  delete s.generateAudio;
  const l = (m, y, h) => {
    if (!dr(e, m)) {
      if (y !== void 0)
        throw new Error(`Topview model "${r}" does not accept ${m} for this generation type.`);
      return;
    }
    const _ = si({ model: e, field: m, requested: y, fallback: h, required: i.has(m) });
    _ !== void 0 && (s[m] = _);
  };
  if (l("resolution", t.params.resolution === void 0 ? void 0 : Number.parseInt(t.params.resolution, 10), 720), t.inheritInputVideoDuration || o === oa ? s.duration = oa : dr(e, "duration") && l("duration", o, 5), l("generatingCount", void 0, 1), t.taskType !== "image_to_video" ? l("aspectRatio", (p = t.params.aspectRatio) == null ? void 0 : p.trim(), "16:9") : (t.params.aspectRatio !== void 0 || i.has("aspectRatio")) && l("aspectRatio", (f = t.params.aspectRatio) == null ? void 0 : f.trim(), "16:9"), ai(e) !== !1 && (dr(e, "sound") || t.params.generateAudio === !0))
    s.sound = si({
      model: e,
      field: "sound",
      requested: t.params.generateAudio === !0 ? "on" : "off",
      required: i.has("sound")
    });
  else if (t.params.generateAudio === !0)
    throw new Error(`Topview model "${r}" does not support native sound.`);
  if (t.taskType === "image_to_video") {
    const m = t.references.find((h) => h.role === "start_image"), y = t.references.find((h) => h.role === "end_image");
    if (!m) throw new Error("Topview image-to-video generation requires an explicit start-frame element.");
    s.firstFrameFileId = m.fileId, y && (s.endFrameFileId = y.fileId);
  }
  if (t.taskType === "omni_reference") {
    let m = 0, y = 0, h = 0;
    const g = [], _ = [], b = [], v = [];
    for (const T of t.references)
      if (T.role === "video") {
        const E = `Video${++y}`;
        _.push({ fileId: T.fileId, name: E }), v.push(`<<<${E}>>> is a supplied motion and timing reference.`);
      } else if (T.role === "audio") {
        const E = `Audio${++h}`;
        b.push({ fileId: T.fileId, name: E }), v.push(`<<<${E}>>> is a supplied audio reference.`);
      } else {
        const E = `Image${++m}`;
        g.push({ fileId: T.fileId, name: E });
        const x = T.role === "start_image" ? "the requested opening-frame reference" : T.role === "end_image" ? "the requested closing-frame reference" : "a supplied visual reference";
        v.push(`<<<${E}>>> is ${x}.`);
      }
    if (b.length && !Bi(e))
      throw new Error(`Topview model "${r}" does not accept audio reference elements for omni-reference video.`);
    a = `${v.join(`
`)} Follow the supplied references for the subjects, wardrobe, props, materials, colour, setting, and requested motion.

${a}`, s.prompt = a, g.length && (s.inputImages = g), _.length && (s.inputVideos = _), b.length && (s.inputAudios = b);
  }
  for (const m of i)
    if (s[m] === void 0 || s[m] === null || s[m] === "")
      throw new Error(`Topview model "${r}" requires "${m}" for this request.`);
  const d = Number(s.duration ?? n.duration), c = Number.isFinite(d) && d > 0 ? d : void 0;
  return { req: s, model: r, ...c !== void 0 ? { durationSec: c } : {} };
}
const km = {
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
}, cr = {
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
function fa(t) {
  return t === "video" ? /* @__PURE__ */ new Set(["mp4", "avi", "mov"]) : t === "audio" ? /* @__PURE__ */ new Set(["mp3", "wav", "m4a"]) : /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "bmp", "webp"]);
}
function Ln(t, e, r) {
  const n = (r ?? "").split(";", 1)[0].trim().toLowerCase(), i = n ? km[n] : void 0, o = (() => {
    try {
      return new URL(t).pathname;
    } catch {
      return t;
    }
  })(), a = w.extname(o).slice(1).toLowerCase(), s = i ?? a;
  if (!s || !fa(e).has(s)) {
    const l = e === "video" ? "video" : e === "audio" ? "audio" : "image";
    throw new Error(`Topview received an unsupported ${l} reference format. Supported formats: ${[...fa(e)].join(", ")}.`);
  }
  if (n && !i)
    throw new Error(`Topview refused a remote reference with content type "${n}".`);
  return s;
}
function Tl(t) {
  const e = t.split(".").map(Number);
  return e.length === 4 && e.every((r) => Number.isInteger(r) && r >= 0 && r <= 255) ? e : void 0;
}
function jm(t) {
  var l;
  let e = t.toLowerCase().split("%", 1)[0];
  e.startsWith("[") && e.endsWith("]") && (e = e.slice(1, -1));
  const r = (l = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(e)) == null ? void 0 : l[1];
  if (r) {
    const u = Tl(r);
    if (!u) return;
    e = `${e.slice(0, -r.length)}${(u[0] << 8 | u[1]).toString(16)}:${(u[2] << 8 | u[3]).toString(16)}`;
  }
  const n = e.split("::");
  if (n.length > 2) return;
  const i = n[0] ? n[0].split(":") : [], o = n[1] ? n[1].split(":") : [], a = 8 - i.length - o.length;
  if (n.length === 1 && a !== 0 || a < 0) return;
  const s = [...i, ...Array.from({ length: a }, () => "0"), ...o];
  if (!(s.length !== 8 || s.some((u) => !/^[0-9a-f]{1,4}$/.test(u))))
    return s.flatMap((u) => {
      const d = Number.parseInt(u, 16);
      return [d >>> 8, d & 255];
    });
}
function pa(t) {
  const e = Tl(t);
  if (!e) return !1;
  const [r, n, i] = e;
  return !(r === 0 || r === 10 || r === 100 && n >= 64 && n <= 127 || r === 127 || r === 169 && n === 254 || r === 172 && n >= 16 && n <= 31 || r === 192 && n === 0 && i === 0 || r === 192 && n === 0 && i === 2 || r === 192 && n === 88 && i === 99 || r === 192 && n === 168 || r === 198 && (n === 18 || n === 19) || r === 198 && n === 51 && i === 100 || r === 203 && n === 0 && i === 113 || r >= 224);
}
function Rm(t) {
  const e = t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t, r = bi(e.split("%", 1)[0]);
  if (r === 4) return pa(e);
  if (r !== 6) return !1;
  const n = jm(e);
  return n ? n.slice(0, 10).every((o) => o === 0) && n[10] === 255 && n[11] === 255 ? pa(n.slice(12).join(".")) : !(n[0] < 32 || n[0] > 63 || n[0] === 32 && n[1] === 1 && (n[2] & 254) === 0 || n[0] === 32 && n[1] === 1 && n[2] === 0 && n[3] === 2 || n[0] === 32 && n[1] === 1 && n[2] === 13 && n[3] === 184 || n[0] === 32 && n[1] === 1 && (n[2] & 240) === 16 || n[0] === 32 && n[1] === 1 && (n[2] & 240) === 32 || n[0] === 32 && n[1] === 2 || n[0] === 63 && (n[1] & 240) === 240) : !1;
}
async function Pm(t) {
  const e = t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t, r = e.toLowerCase().replace(/\.$/, "");
  if (r === "localhost" || r.endsWith(".localhost") || r.endsWith(".local") || r.endsWith(".internal"))
    throw new Error("Topview remote references must use a public HTTPS host.");
  const n = bi(e), i = n ? [{ address: e, family: n }] : await xu(e, { all: !0, verbatim: !0 });
  if (!i.length || i.some((o) => !Rm(o.address)))
    throw new Error("Topview remote references cannot resolve to a private, local, or reserved network address.");
  return { address: i[0].address, family: i[0].family };
}
async function El(t, e = 0) {
  if (e > 5) throw new Error("Topview remote reference redirected too many times.");
  const r = new URL(t);
  if (r.protocol !== "https:" || r.username || r.password || r.port && r.port !== "443")
    throw new Error("Topview remote references must use public HTTPS URLs without credentials or custom ports.");
  const n = await Pm(r.hostname);
  return new Promise((i, o) => {
    const a = Au({
      protocol: "https:",
      hostname: n.address,
      family: n.family,
      port: 443,
      path: `${r.pathname}${r.search}`,
      method: "GET",
      servername: bi(r.hostname.replace(/^\[|\]$/g, "")) ? void 0 : r.hostname,
      headers: {
        Accept: "image/png,image/jpeg,image/bmp,image/webp,video/mp4,video/quicktime,video/x-msvideo,audio/mpeg,audio/mp4,audio/wav",
        Host: r.host
      }
    }, (s) => {
      const l = s.statusCode ?? 0;
      if (l >= 300 && l < 400) {
        const p = s.headers.location;
        if (s.resume(), !p) {
          o(new Error(`Topview remote reference redirected without a destination (${l}).`));
          return;
        }
        El(new URL(p, r).href, e + 1).then(i, o);
        return;
      }
      if (l < 200 || l >= 300) {
        s.resume(), o(new Error(`Topview could not download an element reference (${l}).`));
        return;
      }
      const u = Number(s.headers["content-length"] ?? 0);
      if (Number.isFinite(u) && u > Ct) {
        s.destroy(), o(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
        return;
      }
      const d = [];
      let c = 0;
      s.on("data", (p) => {
        if (c += p.length, c > Ct) {
          s.destroy(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
          return;
        }
        d.push(Buffer.from(p));
      }), s.once("error", o), s.once("end", () => i({
        bytes: Buffer.concat(d),
        contentType: typeof s.headers["content-type"] == "string" ? s.headers["content-type"] : void 0,
        finalUrl: r.href
      }));
    });
    a.setTimeout(hm, () => {
      a.destroy(new Error("Topview timed out while downloading an element reference."));
    }), a.once("error", o), a.end();
  });
}
async function ma(t, e) {
  const r = t.trim();
  if (!r) throw new Error("Topview received an empty element reference.");
  if (r.startsWith("data:")) {
    const a = /^data:([^;,]+)?;base64,(.+)$/s.exec(r);
    if (!a) throw new Error("Topview received an unsupported inline element reference.");
    const s = Buffer.from(a[2], "base64");
    if (s.length > Ct) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const l = Ln("", e, a[1]);
    return { bytes: s, format: l, contentType: cr[l] };
  }
  let n;
  if (r.startsWith("local-media://file"))
    try {
      n = decodeURIComponent(r.slice(18));
    } catch {
      n = r.slice(18);
    }
  else r.startsWith("file://") ? n = decodeURIComponent(new URL(r).pathname) : /^https?:\/\//i.test(r) || (n = r);
  if (n) {
    const a = await j.stat(n);
    if (!a.isFile()) throw new Error("A Topview element reference is not a file.");
    if (a.size > Ct) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const s = Ln(n, e);
    return { bytes: await j.readFile(n), format: s, contentType: cr[s], filePath: n };
  }
  const i = await El(r), o = Ln(i.finalUrl, e, i.contentType);
  return { bytes: i.bytes, format: o, contentType: cr[o] };
}
const Om = 407696, Vr = 409600;
function Sl(t) {
  const e = nn(t);
  return e.includes("seedance-2-5") ? Om : e.includes("seedance-2") ? Vr : void 0;
}
function ui(t) {
  return t.toLocaleString("en-US");
}
function Nm(t) {
  const e = Sl(t.submitModel);
  if (e === void 0) return;
  const r = t.width * t.height;
  if (!(r >= e))
    return `This reference video is ${t.width}x${t.height}, which is ${ui(r)} pixels per frame. "${t.submitModel}" requires at least ${ui(e)}. Re-encode the clip at 854x480 or larger for 16:9 (960x540 is a safe choice), then attach it again.`;
}
function ha(t) {
  var e;
  if (/video\s+pixel\s+count/i.test(t)) {
    const r = (e = /greater\s+than\s+or\s+equal\s+to\s+(\d+)/i.exec(t)) == null ? void 0 : e[1], n = r ? Number.parseInt(r, 10) : Vr;
    return `Seedance rejected a reference video for being too small. It needs at least ${ui(n)} pixels per frame, so re-encode the clip at 854x480 or larger for 16:9 (960x540 is a safe choice) and attach it again. A 640x360 clip is the usual cause.`;
  }
  if (pl(t))
    return "Seedance read this prompt as an edit of the attached clip, so the render takes its length and aspect ratio from that video instead of the duration you picked. CineGen resubmits this automatically — if it fails again, the attached clip is outside the 4-30 second range Seedance edits.";
  if (/copyright|infring|intellectual\s+property|trademark|likeness|celebrit/i.test(t))
    return "Topview's content check rejected this submission. It usually flags a named brand, film, studio, or real person in the prompt, or a reference image it reads as protected — rephrase that part or swap the reference, then run it again.";
  if (/moderat|content\s+polic|violat|sensitive|nsfw|blocked|not\s+allowed/i.test(t))
    return "Topview's content policy rejected this submission. Rephrase the flagged part of the prompt, or remove the reference it objected to, then run it again.";
}
function Cm(t) {
  var r;
  const e = (r = st(t).find((n) => $(n.headers))) == null ? void 0 : r.headers;
  return $(e) ? Object.fromEntries(Object.entries(e).filter((n) => typeof n[1] == "string")) : {};
}
class qm {
  constructor() {
    this.store = new ym();
  }
  async saveToken(e, r = {}) {
    if (typeof e.access_token != "string" || !e.access_token.trim())
      throw new Error("Topview returned an invalid access token.");
    const n = {
      ...r,
      ...e,
      access_token: e.access_token,
      refresh_token: typeof e.refresh_token == "string" ? e.refresh_token : r.refresh_token,
      expires_at: Date.now() + Math.max(30, Number(e.expires_in || 3600)) * 1e3
    };
    return await this.store.write("token", n), n;
  }
  async tokenExchange(e, r) {
    const n = new URLSearchParams();
    for (const [i, o] of Object.entries(e)) o !== void 0 && n.set(i, String(o));
    return n.set("client_id", r.client_id), r.client_secret && n.set("client_secret", r.client_secret), Nn(cm, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: n
    }, "Topview could not complete authorization.");
  }
  async accessToken() {
    const e = await this.store.read("token");
    if (!(e != null && e.access_token)) throw new Error("Connect your Topview account in Settings before generating.");
    if (e.expires_at > Date.now() + 6e4) return e.access_token;
    const r = await this.store.read("client");
    if (!(r != null && r.client_id) || !e.refresh_token)
      throw await this.store.remove("token"), new Error("Your Topview connection expired. Connect it again in Settings.");
    try {
      const n = await this.tokenExchange({
        grant_type: "refresh_token",
        refresh_token: e.refresh_token,
        resource: kn
      }, r);
      return (await this.saveToken(n, e)).access_token;
    } catch (n) {
      throw await this.store.remove("token"), new Error("Your Topview connection expired. Connect it again in Settings.", { cause: n });
    }
  }
  async teamConnection() {
    const e = await this.store.read("client"), r = await this.store.read("token");
    if (e != null && e.client_id && (r != null && r.access_token)) {
      await this.accessToken();
      const n = await this.store.read("token");
      if (n != null && n.access_token) return { client: e, token: n };
    }
    try {
      const n = JSON.parse(await j.readFile(
        w.join(W.getPath("home"), ".topview", "credentials.json"),
        "utf8"
      ));
      if ($(n) && typeof n.api_key == "string" && n.api_key.trim() && typeof n.uid == "string" && n.uid.trim())
        return {
          apiKey: n.api_key.trim(),
          uid: n.uid.trim(),
          ...typeof n.email == "string" && n.email.trim() ? { email: n.email.trim() } : {}
        };
    } catch (n) {
      n.code !== "ENOENT" && console.warn("Could not read the official Topview device connection.", n);
    }
    return null;
  }
  async mcpRequest(e, r, n) {
    var a;
    const i = new AbortController(), o = setTimeout(() => i.abort(), mm);
    (a = o.unref) == null || a.call(o);
    try {
      const s = await fetch(um, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${e}`,
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
          ...n ? { "Mcp-Session-Id": n } : {}
        },
        body: JSON.stringify(r),
        signal: i.signal
      }), l = await s.text(), u = (s.headers.get("content-type") || "").includes("text/event-stream") ? _m(l, r.id) : l ? (() => {
        try {
          return JSON.parse(l);
        } catch {
          return l;
        }
      })() : {};
      if (!s.ok) throw oi(s.status, u, "Topview MCP request failed.");
      if ($(u) && u.error !== void 0) throw oi(400, u.error, "Topview MCP returned an error.");
      return {
        payload: $(u) ? u : {},
        sessionId: s.headers.get("mcp-session-id") || n
      };
    } catch (s) {
      throw s.name === "AbortError" ? new Error("Topview did not respond in time. The generation may still be running in your Topview board.") : s;
    } finally {
      clearTimeout(o);
    }
  }
  async session() {
    const e = await this.accessToken(), r = await this.mcpRequest(e, {
      jsonrpc: "2.0",
      id: `init-${J.randomUUID()}`,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "CineGen Desktop", version: "1.0.1" }
      }
    });
    let i = (await this.mcpRequest(e, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    }, r.sessionId)).sessionId || r.sessionId, o;
    const a = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Map();
    for (let l = 0; l < sa; l += 1) {
      const u = await this.mcpRequest(e, {
        jsonrpc: "2.0",
        id: `tools-${J.randomUUID()}`,
        method: "tools/list",
        params: o === void 0 ? {} : { cursor: o }
      }, i);
      i = u.sessionId || i;
      const d = $(u.payload.result) ? u.payload.result : {}, c = Array.isArray(d.tools) ? d.tools.filter((f) => $(f) && typeof f.name == "string") : [];
      for (const f of c) s.set(f.name, f);
      const p = d.nextCursor;
      if (typeof p != "string" || !p)
        return { token: e, sessionId: i, tools: [...s.values()] };
      if (a.has(p)) throw new Error("Topview returned a repeated MCP tools cursor.");
      a.add(p), o = p;
    }
    throw new Error(`Topview returned more than ${sa} MCP tool pages.`);
  }
  async callTool(e, r, n) {
    if (r === "topview_query_task" && qr(n.taskId))
      return Cp((s, l) => this.callTool(e, s, l), String(n.taskId));
    const i = e.tools.find((s) => s.name === r);
    if (!i) throw new Error(`Your Topview account does not currently expose ${r}.`);
    r === "topview_generate_video" && ra(i.inputSchema, n);
    const o = await this.mcpRequest(e.token, {
      jsonrpc: "2.0",
      id: `call-${J.randomUUID()}`,
      method: "tools/call",
      params: {
        name: r,
        arguments: bm(i, n)
      }
    }, e.sessionId);
    e.sessionId = o.sessionId || e.sessionId;
    const a = $(o.payload) ? o.payload.result : void 0;
    if ($(a) && a.isError === !0) {
      const s = ne(a), u = (te(s, [
        "errorMsg",
        "error_msg",
        "errorMessage",
        "error_message",
        "failureReason",
        "failure_reason",
        "message"
      ]) ?? Br(a).join(" ").slice(0, 700)).trim() || `Topview could not run ${r}.`, d = ha(u);
      throw new Error(d ? `${u}

${d}` : u);
    }
    return a;
  }
  async chooseBoard(e) {
    const r = await this.callTool(e, "topview_list_boards", {
      pageNo: 1,
      pageSize: 100,
      mode: "editable-by-me"
    }), n = vm(ne(r));
    if (n) return n.boardId;
    const i = await this.callTool(e, "topview_create_board", { name: "CineGen" }), o = te(ne(i), ["boardId", "board_id", "id"]);
    if (!o) throw new Error("Topview did not return a board ID for the CineGen board.");
    return o;
  }
  async uploadReference(e, r, n) {
    if (r.value.startsWith("topview-file:")) {
      const f = r.value.slice(13).trim();
      if (!f) throw new Error("Topview received an empty existing file ID.");
      return { ...r, fileId: f };
    }
    let i = await ma(r.value, r.role), o;
    if (r.role === "video" && n && Sl(n) !== void 0) {
      const f = await Dp(i), m = f && Nm({ submitModel: n, ...f });
      if (f && m) {
        const y = Mp(f, Vr);
        try {
          const h = await $p(i, y);
          if (h.length > Ct)
            throw new Error("The resized reference exceeds CineGen's 45 MB Topview upload safety limit.");
          i = { bytes: h, format: "mp4", contentType: cr.mp4 }, o = `Upscaled reference video ${f.width}x${f.height} → ${y.width}x${y.height}`, console.info(
            `[topview] resized Seedance reference video ${f.width}x${f.height} -> ${y.width}x${y.height}`
          );
        } catch (h) {
          throw console.warn("[topview] could not resize undersized Seedance reference video", h), new Error(`${m}

CineGen could not create the temporary resized copy automatically.`);
        }
      } else if (f)
        console.info(`[topview] Seedance reference video is already compatible at ${f.width}x${f.height}`);
      else {
        console.warn("[topview] ffprobe could not read a Seedance video reference; using the FFmpeg compatibility fallback");
        try {
          const y = await Fp(i, Vr);
          if (y.length > Ct)
            throw new Error("The prepared reference exceeds CineGen's 45 MB Topview upload safety limit.");
          i = { bytes: y, format: "mp4", contentType: cr.mp4 }, o = "Prepared reference video at Seedance-compatible resolution", console.info("[topview] prepared Seedance reference video with the area-based compatibility fallback");
        } catch (y) {
          throw console.warn("[topview] could not prepare the Seedance reference video", y), new Error("CineGen could not read or resize this Seedance reference video. Re-encode it as an H.264 MP4 and attach it again.");
        }
      }
    }
    const a = await this.callTool(e, "ta_upload_credential", {
      format: i.format,
      needAccelerateUrl: !1
    }), s = ne(a), l = te(s, ["fileId", "file_id"]), u = te(s, ["uploadUrl", "upload_url", "accelerateUrl", "accelerate_url"]);
    if (!l || !u) throw new Error("Topview did not return a usable upload destination for an element.");
    const d = (te(s, ["method", "httpMethod", "http_method"]) || "PUT").toUpperCase(), c = await fetch(u, {
      method: d,
      headers: { ...Cm(s), ...i.contentType ? { "Content-Type": i.contentType } : {} },
      body: i.bytes
    });
    if (!c.ok) throw new Error(`Topview could not upload an element reference (${c.status}).`);
    const p = await this.callTool(e, "ta_upload_check_file", { fileId: l });
    if (wm(ne(p)) === !1) throw new Error("Topview could not verify an uploaded element reference.");
    return { ...r, fileId: l, ...o ? { preparation: o } : {} };
  }
  async reusableGeneratedImageReference(e, r) {
    try {
      return `topview-file:${(await this.uploadReference(e, { value: r, role: "image" })).fileId}`;
    } catch (n) {
      console.warn("Could not prepare the generated Topview image as a reusable reference.", n);
      return;
    }
  }
  async accountStatus() {
    const e = this.store.availabilityError();
    if (e) return { connected: !1, configured: !1, error: e };
    try {
      const r = await this.store.read("token");
      if (!(r != null && r.access_token)) return { connected: !1, configured: !0 };
      const n = await this.accessToken(), i = await Nn(aa, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${n}` }
      }, "Topview could not validate the connected account.");
      await this.store.write("profile", i);
      const o = await this.session(), s = [
        "topview_get_generation_config",
        "topview_generate_image",
        "topview_generate_video",
        "topview_query_task",
        "ta_upload_credential",
        "ta_upload_check_file",
        "topview_list_boards",
        "topview_create_board"
      ].filter((u) => !o.tools.some((d) => d.name === u));
      if (s.length)
        throw new Error(`This Topview account is missing required MCP capabilities: ${s.join(", ")}.`);
      let l = ua(i);
      if (o.tools.some((u) => u.name === "topview_get_credit"))
        try {
          l = ua(ne(await this.callTool(o, "topview_get_credit", {}))) ?? l;
        } catch {
        }
      return {
        connected: !0,
        configured: !0,
        authMode: "oauth",
        creditType: "mcp",
        ...typeof (i == null ? void 0 : i.email) == "string" ? { email: i.email } : {},
        ...l !== void 0 ? { credits: l } : {}
      };
    } catch (r) {
      return { connected: !1, configured: !0, error: Pn(r, "Topview connection expired.") };
    }
  }
  async modelCatalog() {
    const e = await this.session();
    if (!e.tools.some((i) => i.name === "topview_get_generation_config"))
      throw new Error("Your Topview account does not currently expose its model catalog.");
    const r = [
      { outputType: "image", taskType: "text_to_image" },
      { outputType: "image", taskType: "image_edit" },
      { outputType: "video", taskType: "text_to_video" },
      { outputType: "video", taskType: "image_to_video" },
      { outputType: "video", taskType: "omni_reference" },
      { outputType: "audio", taskType: "music", catalogType: "music" },
      { outputType: "audio", taskType: "voice", catalogType: "voice" },
      { outputType: "audio", taskType: "audio", catalogType: "audio" }
    ], n = [];
    for (const i of r)
      try {
        const o = ne(await this.callTool(e, "topview_get_generation_config", {
          type: i.catalogType ?? i.outputType,
          ...i.catalogType ? {} : { taskType: i.taskType },
          refresh: !0
        }));
        n.push({ ...i, config: o });
      } catch {
      }
    if (!n.length) throw new Error("Topview returned an empty model catalog.");
    return {
      configs: n,
      tools: e.tools.map((i) => i.name),
      toolSchemas: Object.fromEntries(e.tools.filter((i) => ["topview_get_generation_config", "topview_generate_video", "submit_topview_canvas_generation_task", "topview_generate_audio", "topview_generate_music", "topview_generate_voice", "topview_clone_voice", "topview_query_task"].includes(i.name)).map((i) => [i.name, i.inputSchema])),
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async authLogin() {
    var p;
    const e = this.store.availabilityError();
    if (e) throw new Error(e);
    const r = Ja();
    await new Promise((f, m) => {
      r.once("error", m), r.listen(0, "127.0.0.1", () => f());
    });
    const n = r.address();
    if (!n || typeof n == "string")
      throw r.close(), new Error("CineGen could not open a secure local return address for Topview.");
    const i = `http://127.0.0.1:${n.port}/oauth/callback`, o = Rn(J.randomBytes(48)), a = Rn(J.createHash("sha256").update(o).digest()), s = Rn(J.randomBytes(32));
    let l, u;
    const d = new Promise((f, m) => {
      u = m, r.on("request", (y, h) => {
        const g = new URL(y.url || "/", i);
        if (g.pathname !== "/oauth/callback") {
          h.writeHead(404).end();
          return;
        }
        l = h, f(g);
      });
    }), c = setTimeout(() => u == null ? void 0 : u(new Error("Topview sign-in timed out. Try connecting again.")), pm);
    (p = c.unref) == null || p.call(c);
    try {
      const f = await Nn(fm, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "CineGen Desktop",
          redirect_uris: [i],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "openid email mcp:tools"
        })
      }, "Topview could not register CineGen for sign-in.");
      if (typeof f.client_id != "string") throw new Error("Topview did not return an OAuth client ID.");
      const m = {
        ...f,
        client_id: f.client_id,
        client_secret: typeof f.client_secret == "string" ? f.client_secret : void 0,
        token_endpoint_auth_method: typeof f.token_endpoint_auth_method == "string" ? f.token_endpoint_auth_method : "none",
        redirect_uri: i
      };
      await this.store.write("client", m);
      const y = new URL(dm);
      y.search = new URLSearchParams({
        response_type: "code",
        client_id: m.client_id,
        redirect_uri: i,
        scope: "openid email mcp:tools",
        state: s,
        code_challenge: a,
        code_challenge_method: "S256",
        resource: kn
      }).toString(), await Jr.openExternal(y.href);
      const h = await d, g = h.searchParams.get("error_description") || h.searchParams.get("error");
      if (g) throw new Error(g);
      if (h.searchParams.get("state") !== s) throw new Error("Topview sign-in could not be verified. Try again.");
      const _ = h.searchParams.get("code");
      if (!_) throw new Error("Topview did not return an authorization code.");
      const b = await this.tokenExchange({
        grant_type: "authorization_code",
        code: _,
        redirect_uri: i,
        code_verifier: o,
        resource: kn
      }, m), v = await this.saveToken(b);
      try {
        const T = await fetch(aa, {
          headers: { Accept: "application/json", Authorization: `Bearer ${v.access_token}` }
        }), E = await ml(T);
        T.ok && $(E) && await this.store.write("profile", E);
      } catch {
      }
      return la(l, !0, "You can close this window and return to CineGen."), this.accountStatus();
    } catch (f) {
      throw l && !l.writableEnded && la(l, !1, Pn(f, "Topview sign-in did not complete.")), f;
    } finally {
      clearTimeout(c), r.close();
    }
  }
  async authLogout() {
    await Promise.all([
      this.store.remove("token"),
      this.store.remove("client"),
      this.store.remove("profile")
    ]);
  }
  validateGenerateParams(e) {
    if (!e || typeof e.prompt != "string" || !e.prompt.trim())
      throw new Error("Topview video generation requires a prompt.");
  }
  /**
   * Submits the built request, retrying once with the inherited clip duration when Seedance
   * classifies the job as video editing. That verdict depends on the prompt and only arrives
   * as a rejection, which the provider refunds, so the retry reuses the uploaded references
   * instead of asking the user to resubmit by hand.
   */
  async submitVideoRequest(e, r) {
    const n = qn(r);
    try {
      return { built: n, documents: ne(await this.callTool(e, "topview_generate_video", n.req)) };
    } catch (i) {
      if (!pl(Pn(i, ""))) throw i;
      console.info("[topview] resubmitting as a video edit so the render inherits the input clip length");
      const o = qn({ ...r, inheritInputVideoDuration: !0 });
      return {
        built: o,
        documents: ne(await this.callTool(e, "topview_generate_video", o.req))
      };
    }
  }
  async submitWithSession(e, r) {
    var f, m;
    if (Ip(r == null ? void 0 : r.model)) {
      const y = ol(r.model, e.tools.map((E) => E.name));
      if (y) throw new Error(y);
      const h = li(r.medias);
      ta(r.model, r.prompt ?? "", h);
      const g = [];
      for (const E of h) g.push(await this.uploadReference(e, E));
      const _ = await this.chooseBoard(e), b = ta(r.model, r.prompt ?? "", g, _), v = ne(await this.callTool(e, "topview_avatar_video", b.request)), T = te(v, ["taskId", "task_id"]);
      if (!T) throw new Error("Topview did not return a receipt. Check Topview before starting another generation.");
      return { result: { taskId: T, taskType: b.taskType, boardId: _, model: r.model }, documents: v };
    }
    this.validateGenerateParams(r);
    const n = li(r.medias), i = Am(r.medias), o = await this.chooseBoard(e), a = ne(await this.callTool(e, "topview_get_generation_config", {
      type: "video",
      taskType: i
    })), s = qn({
      config: a,
      taskType: i,
      params: r,
      boardId: o,
      references: n.map((y, h) => ({ ...y, fileId: `preflight-${h + 1}` }))
    });
    if (ra(
      (f = e.tools.find((y) => y.name === "topview_generate_video")) == null ? void 0 : f.inputSchema,
      s.req,
      !1,
      Rp(e.tools.map((y) => y.name))
    ) === "canvas-mcp") {
      const y = await Np({
        call: (h, g) => this.callTool(e, h, g),
        references: n,
        submitSchema: (m = e.tools.find((h) => h.name === "submit_topview_canvas_generation_task")) == null ? void 0 : m.inputSchema,
        request: { ...s.req, prompt: r.prompt, ...r.generateAudio !== void 0 ? { sound: r.generateAudio } : {} },
        load: async (h) => {
          const g = await ma(h.value, h.role);
          return { bytes: g.bytes, format: g.format, mime: g.contentType };
        }
      });
      return { result: {
        taskId: y.taskId,
        taskType: i,
        boardId: y.canvasId,
        model: s.model,
        durationSec: y.durationSec
      }, documents: [y] };
    }
    const u = [];
    for (const y of n)
      u.push(await this.uploadReference(e, y, s.model));
    const { built: d, documents: c } = await this.submitVideoRequest(e, {
      config: a,
      taskType: i,
      params: r,
      references: u,
      boardId: o
    }), p = te(c, ["taskId", "task_id", "generationId", "generation_id"]);
    if (!p) throw new Error("Topview did not return a task ID for this generation.");
    return {
      result: {
        taskId: p,
        taskType: i,
        boardId: o,
        model: d.model,
        durationSec: d.durationSec,
        ...u.some((y) => y.preparation) ? {
          referencePreparation: u.flatMap((y) => y.preparation ?? []).join("; ")
        } : {}
      },
      documents: c
    };
  }
  async submit(e) {
    return (await this.submitWithSession(await this.session(), e)).result;
  }
  validateQueryParams(e) {
    if (!e || typeof e.taskId != "string" || !e.taskId.trim())
      throw new Error("Topview task query requires a task ID.");
    if (!["text_to_video", "image_to_video", "omni_reference", "avatar_video"].includes(e.taskType))
      throw new Error("Topview task query received an unsupported task type.");
    if (!qr(e.taskId) && (typeof e.boardId != "string" || !e.boardId.trim()))
      throw new Error("Topview task query requires the board ID returned by submit.");
    if (typeof e.model != "string" || !e.model.trim())
      throw new Error("Topview task query requires the complete result returned by submit.");
    if (e.durationSec !== void 0 && !Number.isFinite(e.durationSec))
      throw new Error("Topview task query received an invalid duration.");
  }
  async queryWithSession(e, r) {
    this.validateQueryParams(r);
    const n = await this.callTool(e, "topview_query_task", {
      taskType: r.taskType,
      taskId: r.taskId.trim(),
      needCloudFrontUrl: !0,
      shortenUrls: !1
    }), i = ne(n), o = Qt(i), a = mt(i), s = /fail|error|cancel/.test(o), l = !!a || /success|complete|done/.test(o), u = s ? "fail" : l && a ? "success" : l ? "fail" : /^(init|created|queued)$/.test(o) ? "init" : "running", d = te(i, ["boardTaskId", "board_task_id"]), c = te(i, [
      "errorMsg",
      "error_msg",
      "errorMessage",
      "error_message",
      "failureReason",
      "failure_reason"
    ]), p = c ? ha(c) : void 0, f = u !== "fail" ? void 0 : c ? p ? `${c}

${p}` : c : l ? "Topview completed the task without returning a video URL." : "Topview could not complete this video.";
    return {
      ...r,
      taskId: r.taskId.trim(),
      status: u,
      ...a ? { url: a } : {},
      ...f ? { error: f } : {},
      ...qr(r.taskId) ? {} : { boardUrl: `https://www.topview.ai/board/${encodeURIComponent(r.boardId)}${d ? `?boardResultId=${encodeURIComponent(d)}` : ""}` }
    };
  }
  async query(e) {
    return this.queryWithSession(await this.session(), e);
  }
  async generate(e) {
    const r = await this.session(), n = await this.submitWithSession(r, e), i = mt(n.documents);
    if (i)
      return {
        url: i,
        mediaType: "video",
        durationSec: n.result.durationSec,
        taskId: n.result.taskId,
        model: n.result.model,
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(n.result.boardId)}`
      };
    const o = Qt(n.documents);
    if (/fail|error|cancel/.test(o))
      throw new Error(te(n.documents, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this video.");
    const a = Date.now() + jn;
    for (; Date.now() < a; ) {
      await new Promise((l) => setTimeout(l, 5e3));
      const s = await this.queryWithSession(r, n.result);
      if (s.status === "fail") throw new Error(s.error ?? "Topview could not complete this video.");
      if (s.status === "success" && s.url)
        return {
          url: s.url,
          mediaType: "video",
          durationSec: s.durationSec,
          taskId: s.taskId,
          model: s.model,
          boardUrl: s.boardUrl
        };
    }
    throw new Error(`Topview is still processing task ${n.result.taskId}. Open your Topview board to check it; do not submit the same render again.`);
  }
  async generateImage(e) {
    if (!e || typeof e.prompt != "string" || !e.prompt.trim())
      throw new Error("Topview image generation requires a prompt.");
    const r = await this.session(), n = Sm(e.medias), i = n.length ? "image_edit" : "text_to_image", o = await this.chooseBoard(r), a = ne(await this.callTool(r, "topview_get_generation_config", {
      type: "image",
      taskType: i
    }));
    ca({
      config: a,
      params: e,
      boardId: o,
      references: n.map((y, h) => ({ ...y, fileId: `preflight-${h + 1}` }))
    });
    const s = [];
    for (const y of n) s.push(await this.uploadReference(r, y));
    const l = ca({ config: a, params: e, references: s, boardId: o }), u = await this.callTool(r, "topview_generate_image", l.req), d = ne(u), c = te(d, ["taskId", "task_id", "generationId", "generation_id"]), p = mt(d);
    if (p)
      return {
        url: p,
        mediaType: "image",
        taskId: c,
        model: l.model,
        referenceValue: da(d) ?? await this.reusableGeneratedImageReference(r, p),
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(o)}`
      };
    if (!c) throw new Error("Topview did not return a task ID for this image generation.");
    const f = Qt(d);
    if (/fail|error|cancel/.test(f))
      throw new Error(te(d, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this image.");
    const m = Date.now() + jn;
    for (; Date.now() < m; ) {
      await new Promise((b) => setTimeout(b, 3e3));
      const y = await this.callTool(r, "topview_query_task", {
        taskType: l.taskType,
        taskId: c,
        needCloudFrontUrl: !0
      }), h = ne(y), g = mt(h), _ = Qt(h);
      if (g) {
        const b = te(h, ["boardTaskId", "board_task_id"]);
        return {
          url: g,
          mediaType: "image",
          taskId: c,
          model: l.model,
          referenceValue: da(h) ?? await this.reusableGeneratedImageReference(r, g),
          boardUrl: `https://www.topview.ai/board/${encodeURIComponent(o)}${b ? `?boardResultId=${encodeURIComponent(b)}` : ""}`
        };
      }
      if (/fail|error|cancel/.test(_))
        throw new Error(te(h, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this image.");
    }
    throw new Error(`Topview is still processing image task ${c}. Open your Topview board to check it; do not submit the same render again.`);
  }
  async generateAudio(e) {
    var p;
    if (!e || typeof e.prompt != "string" || !e.prompt.trim())
      throw new Error("Topview audio generation requires text or a prompt.");
    const r = await this.session(), n = await this.chooseBoard(r);
    let i;
    e.referenceAudio && (i = await this.uploadReference(r, { value: e.referenceAudio, role: "audio" }));
    let o, a, s;
    if (e.kind === "music")
      o = "topview_generate_music", a = "ai_music", s = {
        model: e.model,
        lyrics: e.prompt.trim(),
        styles: e.styles,
        instrumental: e.instrumental,
        ...i ? { referenceAudio: { fileId: i.fileId } } : {},
        boardId: n
      };
    else if (e.kind === "voice") {
      if (!((p = e.voiceId) != null && p.trim())) throw new Error("Choose a Topview voice ID for text-to-speech.");
      o = "topview_generate_voice", a = "text_to_speech", s = {
        voiceId: e.voiceId.trim(),
        voiceText: e.prompt.trim(),
        voiceSpeed: e.voiceSpeed,
        emotionName: e.emotion,
        boardId: n
      };
    } else {
      if (!i) throw new Error("Seed Audio requires a reference audio clip.");
      o = "topview_generate_audio", a = "audio_design", s = {
        model: e.model,
        text: e.prompt.trim(),
        referenceAudioFileId: i.fileId,
        emotionText: e.emotionText,
        boardId: n
      };
    }
    let l = ne(await this.callTool(r, o, s));
    const u = te(l, ["taskId", "task_id", "generationId", "generation_id"]), d = mt(l);
    if (d) return { url: d, mediaType: "audio", taskId: u, model: e.model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(n)}` };
    if (!u) throw new Error("Topview did not return a task ID for this audio generation.");
    const c = Date.now() + jn;
    for (; Date.now() < c; ) {
      await new Promise((m) => setTimeout(m, 3e3)), l = ne(await this.callTool(r, "topview_query_task", {
        taskType: a,
        taskId: u,
        needCloudFrontUrl: !0
      }));
      const f = mt(l);
      if (f) return { url: f, mediaType: "audio", taskId: u, model: e.model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(n)}` };
      if (/fail|error|cancel/.test(Qt(l)))
        throw new Error(te(l, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this audio generation.");
    }
    throw new Error(`Topview is still processing audio task ${u}. Open your Topview board to check it; do not submit the same task again.`);
  }
}
let ga;
function Il() {
  return ga ?? (ga = new qm()), ga;
}
function Lm() {
  return Il().teamConnection();
}
function Um() {
  const t = Il();
  I.handle("topview:account-status", () => t.accountStatus()), I.handle("topview:model-catalog", () => t.modelCatalog()), I.handle("topview:auth-login", () => t.authLogin()), I.handle("topview:auth-logout", () => t.authLogout()), I.handle("topview:submit", (e, r) => t.submit(r)), I.handle("topview:query", (e, r) => t.query(r)), I.handle("topview:generate", (e, r) => t.generate(r)), I.handle("topview:generate-image", (e, r) => t.generateImage(r)), I.handle("topview:generate-audio", (e, r) => t.generateAudio(r));
}
const ya = {
  draft: { crf: 28, scale: 0.5 },
  standard: { crf: 20, scale: 1 },
  high: { crf: 16, scale: 1 }
}, le = /* @__PURE__ */ new Map(), fr = /* @__PURE__ */ new Map();
function Mm(t, e) {
  for (const r of Q.getAllWindows())
    r.webContents.send("export:progress", { jobId: t, progress: e });
}
function Dm(t, e) {
  const r = t.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
  if (!r) return null;
  const n = parseInt(r[1], 10), i = parseInt(r[2], 10), o = parseInt(r[3], 10), a = parseInt(r[4], 10) / 100, s = n * 3600 + i * 60 + o + a;
  return e > 0 ? Math.min(100, s / e * 100) : 0;
}
async function $m(t, e) {
  const r = le.get(t);
  if (!r) return;
  const n = ve(), i = ya[e.preset || "standard"] || ya.standard, o = e.fps || 30, a = e.outputPath || w.join(process.cwd(), `export_${t}.mp4`);
  le.set(t, { ...r, status: "rendering" });
  const s = e.clips.filter(
    (p) => (p.type === "video" || p.type === "image") && p.inputPath
  );
  if (s.length === 0) {
    le.set(t, { ...r, status: "failed", error: "No video clips to export" });
    return;
  }
  const l = [];
  for (const p of s)
    p.trimStart > 0 && l.push("-ss", String(p.trimStart)), l.push("-t", String(p.duration / (p.speed || 1))), l.push("-i", p.inputPath);
  const u = [];
  for (let p = 0; p < s.length; p++) {
    const f = s[p], m = f.speed || 1, y = f.volume ?? 1, h = [];
    m !== 1 && h.push(`setpts=${(1 / m).toFixed(4)}*PTS`), i.scale !== 1 && h.push(`scale=iw*${i.scale}:ih*${i.scale}`), h.push(`fps=${o}`), u.push(`[${p}:v]${h.join(",")}[v${p}]`);
    const g = f.duration / m;
    if (f.type === "image")
      u.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${g.toFixed(4)}[a${p}]`);
    else {
      const _ = [];
      m !== 1 && _.push(`atempo=${m}`), y !== 1 && _.push(`volume=${y}`), _.length > 0 ? u.push(`[${p}:a]${_.join(",")}[a${p}]`) : u.push(`[${p}:a]anull[a${p}]`);
    }
  }
  const d = s.map((p, f) => `[v${f}]`).join(""), c = s.map((p, f) => `[a${f}]`).join("");
  return u.push(
    `${d}${c}concat=n=${s.length}:v=1:a=1[outv][outa]`
  ), l.push("-filter_complex", u.join(";")), l.push("-map", "[outv]", "-map", "[outa]"), l.push("-c:v", "libx264", "-crf", String(i.crf), "-preset", "fast"), l.push("-c:a", "aac", "-b:a", "192k"), l.push("-y", a), new Promise((p, f) => {
    var h;
    const m = ae(n, l);
    fr.set(t, m);
    let y = "";
    (h = m.stderr) == null || h.on("data", (g) => {
      y += g.toString();
      const _ = y.split("\r"), b = _[_.length - 1] || _[_.length - 2];
      if (b) {
        const v = Dm(b, e.totalDuration);
        if (v !== null) {
          const T = le.get(t);
          T && (le.set(t, { ...T, progress: v }), Mm(t, v));
        }
      }
      y.length > 2048 && (y = y.slice(-1024));
    }), m.on("close", (g) => {
      fr.delete(t);
      const _ = le.get(t);
      if (!_) {
        p();
        return;
      }
      if (g === 0) {
        let b;
        try {
          b = D.statSync(a).size;
        } catch {
        }
        le.set(t, {
          ..._,
          status: "complete",
          progress: 100,
          outputUrl: a,
          fileSize: b,
          completedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else
        le.set(t, {
          ..._,
          status: "failed",
          error: `ffmpeg exited with code ${g}`
        });
      p();
    }), m.on("error", (g) => {
      fr.delete(t);
      const _ = le.get(t);
      _ && le.set(t, { ..._, status: "failed", error: g.message }), f(g);
    });
  });
}
function Fm() {
  I.handle("export:start", async (t, e) => {
    const { preset: r = "standard", fps: n = 30 } = e, i = {
      id: J.randomUUID(),
      status: "queued",
      progress: 0,
      preset: r,
      fps: n,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return le.set(i.id, i), $m(i.id, e).catch((o) => {
      console.error("[export] Render failed:", o);
    }), i;
  }), I.handle("export:poll", async (t, e) => {
    const r = le.get(e);
    if (!r) throw new Error("Export not found");
    return r;
  }), I.handle("export:cancel", async (t, e) => {
    const r = fr.get(e);
    r && (r.kill("SIGTERM"), fr.delete(e));
    const n = le.get(e);
    if (n && (le.set(e, { ...n, status: "failed", error: "Cancelled by user" }), n.outputUrl))
      try {
        D.unlinkSync(n.outputUrl);
      } catch {
      }
    return { ok: !0 };
  });
}
const Bm = {
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
function Un(t) {
  const e = w.extname(t).toLowerCase();
  return Bm[e] ?? "application/octet-stream";
}
function _a(t) {
  try {
    const e = new URL(t);
    if (e.protocol !== "local-media:" || e.hostname !== "file") return null;
    let r = decodeURIComponent(e.pathname);
    return process.platform === "win32" && r.startsWith("/") && (r = r.slice(1)), w.normalize(r);
  } catch {
    return null;
  }
}
function Vm(t) {
  const e = w.extname(t).toLowerCase().replace(/[^a-z0-9.]/g, ""), r = w.basename(t, w.extname(t)).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "reference";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${r}${e}`;
}
async function Gm(t) {
  const e = w.join(
    z.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), r = ve(), n = [
    "-y",
    "-i",
    t,
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
    e
  ];
  return await new Promise((i, o) => {
    var l;
    const a = ae(r, n, { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    (l = a.stderr) == null || l.on("data", (u) => {
      s += u.toString();
    }), a.on("error", o), a.on("close", (u) => {
      if (u === 0) {
        i();
        return;
      }
      o(new Error(s.trim() || `ffmpeg exited with code ${u}`));
    });
  }), e;
}
function Hm() {
  I.handle(
    "elements:upload",
    async (t, e, r) => {
      if (!r) {
        const a = w.join(W.getPath("userData"), "media", "elements");
        await j.mkdir(a, { recursive: !0 });
        const s = w.join(a, Vm(e.name));
        return await j.writeFile(s, Buffer.from(e.buffer)), { url: `local-media://file${s}` };
      }
      K.fal.config({ credentials: r });
      const n = new Blob([e.buffer], { type: e.type }), i = new File([n], e.name, { type: e.type });
      return { url: await K.fal.storage.upload(i) };
    }
  ), I.handle(
    "elements:upload-transcription-source",
    async (t, e, r) => {
      if (!r) throw new Error("No API key provided");
      const n = _a(e);
      if (!n) {
        if (e.startsWith("http://") || e.startsWith("https://"))
          return { url: e };
        throw new Error("Transcription upload requires a local-media or remote URL source");
      }
      K.fal.config({ credentials: r });
      const i = await Gm(n);
      try {
        const o = await j.readFile(i), s = `${w.basename(n, w.extname(n))}.m4a`, l = Un(i), u = new Blob([o], { type: l }), d = new File([u], s, { type: l });
        return { url: await K.fal.storage.upload(d) };
      } finally {
        await j.unlink(i).catch(() => {
        });
      }
    }
  ), I.handle(
    "elements:upload-media-source",
    async (t, e, r) => {
      if (!r) throw new Error("No API key provided");
      K.fal.config({ credentials: r });
      const n = _a(e);
      if (n) {
        const i = await j.readFile(n), o = w.basename(n), a = Un(n), s = new Blob([i], { type: a }), l = new File([s], o, { type: a });
        return { url: await K.fal.storage.upload(l) };
      }
      if (e.startsWith("data:"))
        return { url: e };
      if (e.startsWith("http://") || e.startsWith("https://")) {
        const i = await import("node:os");
        await import("node:fs");
        const o = w.extname(new URL(e).pathname) || ".mp4", a = w.join(i.tmpdir(), `cinegen-upload-${Date.now()}${o}`);
        try {
          const f = await fetch(e);
          if (!f.ok)
            throw new Error(`Remote file unavailable (HTTP ${f.status}). The URL may have expired. Try re-importing the asset.`);
          const m = await f.arrayBuffer();
          await j.writeFile(a, Buffer.from(m));
        } catch (f) {
          throw new Error(
            f instanceof Error ? f.message : "Failed to download remote media. The URL may have expired."
          );
        }
        const s = await j.readFile(a), l = w.basename(a), u = Un(a), d = new Blob([s], { type: u }), c = new File([d], l, { type: u }), p = await K.fal.storage.upload(c);
        return await j.unlink(a).catch(() => {
        }), { url: p };
      }
      throw new Error("Media upload requires a local-media, remote URL, or data URI source");
    }
  );
}
const zm = `
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
`, Wm = `
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
function ut() {
  return w.join(z.homedir(), "Documents", "CINEGEN");
}
function We(t) {
  return w.join(ut(), t);
}
function nr() {
  return J.randomUUID();
}
function pr() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function xl(t) {
  const e = We(t), r = [
    w.join(e, "media", "generated"),
    w.join(e, "media", "imported"),
    w.join(e, ".cache", "thumbnails"),
    w.join(e, ".cache", "filmstrips"),
    w.join(e, ".cache", "waveforms"),
    w.join(e, ".cache", "proxies")
  ];
  for (const n of r)
    D.mkdirSync(n, { recursive: !0 });
}
class Xm {
  constructor(e) {
    xl(e);
    const r = w.join(We(e), "project.db");
    this.db = new wi(r), this.db.pragma("journal_mode = WAL"), this.db.pragma("foreign_keys = ON"), this.initSchema();
  }
  /**
   * Runs SCHEMA_SQL and INDEXES_SQL to create all tables and indexes if they
   * do not already exist.
   */
  initSchema() {
    this.db.exec(zm), this.db.exec(Wm);
  }
  /**
   * Executes a SELECT query and returns all matching rows typed as T.
   */
  query(e, r) {
    return this.db.prepare(e).all(...r ?? []);
  }
  /**
   * Executes a SELECT query and returns the first matching row typed as T,
   * or undefined if no rows match.
   */
  queryOne(e, r) {
    return this.db.prepare(e).get(...r ?? []);
  }
  /**
   * Executes an INSERT / UPDATE / DELETE statement and returns the RunResult.
   */
  run(e, r) {
    return this.db.prepare(e).run(...r ?? []);
  }
  /**
   * Wraps the provided function in a SQLite transaction. The transaction is
   * committed on success and rolled back on exception.
   */
  transaction(e) {
    return this.db.transaction(e)();
  }
  /**
   * Closes the underlying database connection.
   */
  close() {
    this.db.close();
  }
}
function Jm(t) {
  if (!t || typeof t != "object") return;
  const e = t, r = (o) => typeof e[o] == "string" ? e[o].trim() : "", n = e.referenceAudio, i = n && typeof n.id == "string" && typeof n.url == "string" && n.url ? { id: n.id, url: n.url, createdAt: typeof n.createdAt == "string" ? n.createdAt : "", source: n.source === "generated" ? "generated" : "upload" } : void 0;
  if (!(!r("description") && !r("voiceId") && !r("voiceName") && !r("sampleText") && !i))
    return {
      description: r("description"),
      ...e.provider === "elevenlabs" || r("voiceId") ? { provider: "elevenlabs" } : {},
      ...r("voiceId") ? { voiceId: r("voiceId") } : {},
      ...r("voiceName") ? { voiceName: r("voiceName") } : {},
      ...r("sampleText") ? { sampleText: r("sampleText") } : {},
      ...r("sampleLanguage") ? { sampleLanguage: r("sampleLanguage") } : {},
      ...i ? { referenceAudio: i } : {}
    };
}
function Al() {
  return { version: 1, folders: [], elements: [] };
}
function kl(t) {
  var s;
  if (!t || typeof t != "object") return null;
  const e = t, r = typeof e.id == "string" ? e.id : "";
  if (!r) return null;
  const n = e.type === "character" || e.type === "location" || e.type === "prop" || e.type === "vehicle" ? e.type : "character", i = typeof e.folderId == "string" && e.folderId ? e.folderId : typeof e.folder_id == "string" && e.folder_id ? e.folder_id : void 0, o = Ym(e.variations), a = typeof e.activeVariationId == "string" && o.some((l) => l.id === e.activeVariationId) ? e.activeVariationId : (s = o[0]) == null ? void 0 : s.id;
  return {
    id: r,
    name: typeof e.name == "string" ? e.name : "Untitled",
    type: n,
    description: typeof e.description == "string" ? e.description : "",
    voice: n === "character" ? Jm(e.voice) : void 0,
    images: jl(e.images),
    variations: o.length ? o : void 0,
    activeVariationId: a,
    createdAt: typeof e.createdAt == "string" ? e.createdAt : typeof e.created_at == "string" ? e.created_at : "",
    updatedAt: typeof e.updatedAt == "string" ? e.updatedAt : typeof e.updated_at == "string" ? e.updated_at : "",
    folderId: i
  };
}
function Km(t) {
  return t === "baseline" || t === "wardrobe" || t === "condition" || t === "time" || t === "custom" ? t : "custom";
}
function Ym(t) {
  return Array.isArray(t) ? t.flatMap((e) => {
    if (!e || typeof e != "object") return [];
    const r = e, n = typeof r.id == "string" ? r.id.trim() : "";
    return n ? [{
      id: n,
      name: typeof r.name == "string" && r.name.trim() ? r.name.trim() : "Untitled look",
      kind: Km(r.kind),
      description: typeof r.description == "string" ? r.description : "",
      images: jl(r.images),
      sourceVariationId: typeof r.sourceVariationId == "string" && r.sourceVariationId ? r.sourceVariationId : void 0,
      createdAt: typeof r.createdAt == "string" ? r.createdAt : "",
      updatedAt: typeof r.updatedAt == "string" ? r.updatedAt : ""
    }] : [];
  }) : [];
}
function jl(t) {
  let e = t;
  if (typeof e == "string")
    try {
      e = JSON.parse(e);
    } catch {
      return [];
    }
  return Array.isArray(e) ? e.flatMap((r) => {
    if (!r || typeof r != "object") return [];
    const n = r;
    return typeof n.id != "string" || typeof n.url != "string" ? [] : [{
      id: n.id,
      url: n.url,
      createdAt: typeof n.createdAt == "string" ? n.createdAt : "",
      source: n.source === "generated" ? "generated" : "upload"
    }];
  }) : [];
}
function Qm(t) {
  if (!t || typeof t != "object") return null;
  const e = t, r = typeof e.id == "string" ? e.id : "";
  if (!r) return null;
  const n = typeof e.sourceProjectId == "string" && e.sourceProjectId ? e.sourceProjectId : void 0;
  return {
    id: r,
    name: typeof e.name == "string" && e.name.trim() ? e.name.trim() : "Untitled",
    createdAt: typeof e.createdAt == "string" ? e.createdAt : (/* @__PURE__ */ new Date()).toISOString(),
    sourceProjectId: n
  };
}
function Rl(t) {
  if (!t || typeof t != "object") return Al();
  const e = t, r = Array.isArray(e.folders) ? e.folders.map(Qm).filter((o) => o !== null) : [], n = new Set(r.map((o) => o.id)), i = Array.isArray(e.elements) ? e.elements.map(kl).filter((o) => o !== null) : [];
  return {
    version: 1,
    folders: r,
    elements: i.map((o) => o.folderId && !n.has(o.folderId) ? { ...o, folderId: void 0 } : o)
  };
}
function Zm(t, e) {
  const r = Al(), n = new Map(r.elements.map((o) => [o.id, o])), i = [...r.folders];
  for (const o of e) {
    const a = o.elements.map(kl).filter((l) => l !== null);
    if (a.length === 0) continue;
    let s = i.find((l) => l.sourceProjectId === o.id);
    s || (s = {
      id: crypto.randomUUID(),
      name: o.name.trim() || "Untitled project",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceProjectId: o.id
    }, i.push(s));
    for (const l of a)
      n.has(l.id) || n.set(l.id, { ...l, folderId: l.folderId && i.some((u) => u.id === l.folderId) ? l.folderId : s.id });
  }
  return { version: 1, folders: i, elements: [...n.values()] };
}
function eh(t, e, r) {
  const n = r.trim() || "Untitled project", i = t.folders.find((o) => o.sourceProjectId === e);
  if (!i) {
    const o = {
      id: crypto.randomUUID(),
      name: n,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceProjectId: e
    };
    return { ...t, folders: [...t.folders, o] };
  }
  return i.name === n ? t : {
    ...t,
    folders: t.folders.map((o) => o.id === i.id ? { ...o, name: n } : o)
  };
}
function Pl() {
  return w.join(ut(), "elements-library.json");
}
function th() {
  return w.join(ut(), "projects.json");
}
function wa(t) {
  return w.join(ut(), t);
}
async function di(t) {
  await j.mkdir(ut(), { recursive: !0 });
  const e = Pl(), r = `${e}.tmp`;
  await j.writeFile(r, JSON.stringify(t, null, 2), "utf-8"), await j.rename(r, e);
}
async function rh() {
  try {
    const t = await j.readFile(Pl(), "utf-8");
    return Rl(JSON.parse(t));
  } catch {
    return null;
  }
}
function nh(t) {
  const e = w.join(wa(t.id), "project.db"), r = w.join(wa(t.id), "project.json");
  if (t.useSqlite || D.existsSync(e))
    try {
      const n = new wi(e, { readonly: !0 }), i = n.prepare("SELECT * FROM elements").all();
      return n.close(), { id: t.id, name: t.name, elements: i };
    } catch {
      return { id: t.id, name: t.name, elements: [] };
    }
  if (D.existsSync(r))
    try {
      const n = JSON.parse(D.readFileSync(r, "utf-8"));
      return { id: t.id, name: t.name, elements: Array.isArray(n.elements) ? n.elements : [] };
    } catch {
      return { id: t.id, name: t.name, elements: [] };
    }
  return { id: t.id, name: t.name, elements: [] };
}
async function ih() {
  const t = await rh();
  if (t) return t;
  let e = [];
  try {
    const i = JSON.parse(await j.readFile(th(), "utf-8"));
    e = Array.isArray(i.projects) ? i.projects : [];
  } catch {
    e = [];
  }
  const r = e.map(nh), n = Zm(null, r);
  return await di(n), n;
}
function oh() {
  I.handle(
    "elements-library:load",
    async (t, e) => {
      let r = await ih();
      if (e != null && e.projectId && e.projectName) {
        const n = eh(r, e.projectId, e.projectName);
        n !== r && (await di(n), r = n);
      }
      return r;
    }
  ), I.handle("elements-library:save", async (t, e) => {
    const r = Rl(e);
    return await di(r), r;
  });
}
const ba = {
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
}, Ol = {
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
function ah(t) {
  return t ? { ...ba, ...Ol[t].weights } : ba;
}
function va(t, e) {
  if (!t) return !1;
  const r = t.toLowerCase();
  return e.some((n) => r.includes(n.toLowerCase()));
}
function sh(t, e, r) {
  const n = ah(r.persona), i = r.persona ? Ol[r.persona] : void 0, o = [];
  let a = 0;
  if (e.length === 0)
    a += t.words.length > 0 ? 3 : 1;
  else {
    const s = t.text.toLowerCase(), l = `${t.assetName} ${t.text} ${t.words.map((d) => d.word).join(" ")}`.toLowerCase();
    let u = 0;
    for (const d of e)
      l.includes(d) && (u += 1, a += s.includes(d) ? n.termInText : n.termElsewhere);
    u > 0 && o.push(`matched ${e.slice(0, 4).join(", ")}`);
  }
  return t.timelinePlacements.some((s) => s.timelineId === r.activeTimelineId) && r.activeTimelineId && (a += n.activeTimeline, o.push("already on the active timeline")), t.words.length > 0 && (a += n.wordTiming), t.emotion && (a += n.hasEmotion), t.delivery && (a += n.hasDelivery, o.push("has vocal delivery notes")), i && (va(t.energy, i.preferredEnergy) && (a += n.energyMatch, o.push(`${t.energy} energy fits ${r.persona}`)), va(t.pace, i.preferredPace) && (a += n.paceMatch, o.push(`${t.pace} pace fits ${r.persona}`)), t.emotion && i.emotionBias.some((s) => t.emotion.toLowerCase().includes(s)) && (a += n.emotionBias, o.push(`${t.emotion} emotion favored by ${r.persona}`))), t.emotion && r.queryEmotions.some((s) => t.emotion.toLowerCase().includes(s) || s.includes(t.emotion.toLowerCase())) && (a += n.emotionQueryMatch, o.push(`emotion (${t.emotion}) matches the query`)), t.notable && t.notable.length > 0 && (a += n.notableSignal * t.notable.length, o.push(`notable: ${t.notable.slice(0, 2).join("; ")}`)), { score: a, reasons: o };
}
function lh(t) {
  const { query: e, brief: r, candidates: n } = t, i = n.map((o) => `- ${o.id}: ${o.text.replace(/\s+/g, " ").slice(0, 160)}`);
  return [
    `You are a ${r.persona} selecting the strongest moments for a cut.`,
    `Story goal: ${r.storyGoal}. Tone: ${r.tone}. Pacing: ${r.pacing}.`,
    `Viewer query: "${e}".`,
    "Re-order these candidate moments from most to least useful for this cut.",
    "Candidates (id: text):",
    ...i,
    'Return compact JSON ONLY: {"order":["id1","id2",...]} listing the ids best-first.',
    "Include only ids from the list. No prose."
  ].join(`
`);
}
function uh(t) {
  var a;
  const e = t.trim();
  if (!e) return null;
  const r = (s) => {
    try {
      return JSON.parse(s), s;
    } catch {
      return null;
    }
  }, n = r(e);
  if (n) return n;
  for (const s of e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const l = (a = s[1]) == null ? void 0 : a.trim();
    if (l && r(l)) return l;
  }
  const i = e.indexOf("{"), o = e.lastIndexOf("}");
  if (i !== -1 && o > i) {
    const s = e.slice(i, o + 1);
    if (r(s)) return s;
  }
  return null;
}
function dh(t, e) {
  const r = uh(e);
  if (!r) return t;
  let n;
  try {
    n = JSON.parse(r);
  } catch {
    return t;
  }
  const i = n.order;
  if (!Array.isArray(i) || i.length === 0) return t;
  const o = new Map(t.map((l) => [l.id, l])), a = /* @__PURE__ */ new Set(), s = [];
  for (const l of i) {
    if (typeof l != "string") continue;
    const u = o.get(l);
    u && !a.has(l) && (s.push(u), a.add(l));
  }
  for (const l of t)
    a.has(l.id) || s.push(l);
  return s;
}
function ch(t) {
  return [...new Set(
    t.toLowerCase().split(/[^a-z0-9']+/).map((e) => e.trim()).filter((e) => e.length >= 3)
  )];
}
const fh = [
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
function ph(t) {
  const e = t.toLowerCase();
  return fh.filter((r) => e.includes(r));
}
function mh(t, e, r = 24) {
  const n = typeof r == "number" ? { limit: r } : r, i = n.limit ?? 24, o = ch(e), a = {
    activeTimelineId: t.activeTimelineId,
    persona: n.persona,
    queryEmotions: ph(e)
  };
  return t.moments.map((s) => ({ moment: s, ...sh(s, o, a) })).filter((s) => s.score > 0).sort((s, l) => l.score - s.score || s.moment.sourceStart - l.moment.sourceStart).slice(0, i).map(({ moment: s, score: l, reasons: u }) => ({
    id: s.id,
    assetId: s.assetId,
    assetName: s.assetName,
    text: s.text,
    sourceStart: s.sourceStart,
    sourceEnd: s.sourceEnd,
    words: s.words.slice(0, 32),
    timelinePlacements: s.timelinePlacements,
    score: l,
    reason: u.length > 0 ? `${u.slice(0, 3).join("; ")}.` : `${s.words.length > 0 ? "Word-level" : "Segment-level"} transcript candidate.`
  }));
}
const Fe = "google/gemini-2.5-flash";
function ht(t, e, r) {
  return Math.min(r, Math.max(e, t));
}
function Mn(t) {
  try {
    return JSON.parse(t), t;
  } catch {
    return null;
  }
}
function ye(t) {
  return typeof t == "string" ? t : Array.isArray(t) ? t.map((e) => ye(e)).filter(Boolean).join(`
`) : t && typeof t == "object" ? Object.values(t).map((e) => ye(e)).filter(Boolean).join(`
`) : "";
}
function Y(t) {
  if (typeof t == "number" && Number.isFinite(t)) return t;
  if (typeof t != "string") return null;
  const e = t.trim();
  if (!e) return null;
  if (e.endsWith("%")) {
    const n = Number(e.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : null;
  }
  const r = Number(e);
  return Number.isFinite(r) ? r : null;
}
function Nl(t) {
  var o;
  const e = t.trim();
  if (!e) return null;
  const r = Mn(e);
  if (r) return r;
  const n = [...e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const a of n) {
    const s = (o = a[1]) == null ? void 0 : o.trim();
    if (!s) continue;
    const l = Mn(s);
    if (l) return l;
  }
  const i = /* @__PURE__ */ new Map([
    ["{", "}"],
    ["[", "]"]
  ]);
  for (let a = 0; a < e.length; a++) {
    const s = e[a], l = i.get(s);
    if (!l) continue;
    const u = [l];
    let d = !1, c = !1;
    for (let p = a + 1; p < e.length; p++) {
      const f = e[p];
      if (c) {
        c = !1;
        continue;
      }
      if (f === "\\") {
        d && (c = !0);
        continue;
      }
      if (f === '"') {
        d = !d;
        continue;
      }
      if (d) continue;
      const m = i.get(f);
      if (m) {
        u.push(m);
        continue;
      }
      if (f === u[u.length - 1]) {
        if (u.pop(), u.length === 0) {
          const y = e.slice(a, p + 1), h = Mn(y);
          if (h) return h;
          break;
        }
        continue;
      }
      if (f === "}" || f === "]")
        break;
    }
  }
  return null;
}
function hh(t) {
  switch (w.extname(t).toLowerCase()) {
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
function gh(t) {
  if (!t) return null;
  if (t.startsWith("local-media://file/")) return decodeURIComponent(t.replace("local-media://file", ""));
  if (t.startsWith("file://"))
    try {
      return decodeURIComponent(new URL(t).pathname);
    } catch {
      return null;
    }
  return t.startsWith("/") ? t : null;
}
async function on(t, e) {
  if (/^https?:\/\//.test(e)) return e;
  if (e.startsWith("data:")) {
    const s = e.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
    if (!s) return null;
    const l = s[1] || "application/octet-stream", u = s[3] || "", d = s[2] ? Buffer.from(u, "base64") : Buffer.from(decodeURIComponent(u), "utf8"), c = new Blob([d], { type: l }), p = new File([c], `auto-segment.${l.split("/")[1] || "bin"}`, { type: l });
    return K.fal.config({ credentials: t }), K.fal.storage.upload(p);
  }
  const r = gh(e);
  if (!r) return null;
  const n = await j.readFile(r), i = hh(r), o = new Blob([n], { type: i }), a = new File([o], w.basename(r), { type: i });
  return K.fal.config({ credentials: t }), K.fal.storage.upload(a);
}
async function yh(t, e) {
  return on(t, e);
}
function Ta(t, e) {
  const n = (Array.isArray(t.objects) ? t.objects : Array.isArray(t.detections) ? t.detections : Array.isArray(t.items) ? t.items : Array.isArray(t.regions) ? t.regions : Array.isArray(t.subjects) ? t.subjects : typeof t.label == "string" || typeof t.name == "string" || typeof t.object == "string" ? [t] : []).map((o) => {
    if (!o || typeof o != "object") return null;
    const a = o, s = [
      a.label,
      a.name,
      a.object,
      a.subject,
      a.class,
      a.type
    ].find((x) => typeof x == "string" && x.trim()), l = typeof s == "string" ? s.trim() : "";
    if (!l) return null;
    let u = null, d = null, c = null, p = null;
    const f = Array.isArray(a.box) ? a.box : Array.isArray(a.cxcywh) ? a.cxcywh : null;
    f && f.length >= 4 && (u = Y(f[0]), d = Y(f[1]), c = Y(f[2]), p = Y(f[3]));
    const m = Array.isArray(a.bbox) ? a.bbox : Array.isArray(a.bounds) ? a.bounds : Array.isArray(a.rect) ? a.rect : Array.isArray(a.xyxy) ? a.xyxy : null;
    if ((u === null || d === null || c === null || p === null) && m && m.length >= 4) {
      const x = Y(m[0]), S = Y(m[1]), A = Y(m[2]), O = Y(m[3]);
      [x, S, A, O].every((C) => C !== null) && (u = (x + A) / 2, d = (S + O) / 2, c = A - x, p = O - S);
    }
    const y = Array.isArray(a.box_3d) ? a.box_3d : Array.isArray(a.box3d) ? a.box3d : null;
    if ((u === null || d === null || c === null || p === null) && y && y.length >= 6) {
      const x = Y(y[0]), S = Y(y[1]), A = Y(y[3]), O = Y(y[4]), C = Y(y[5]);
      [x, S, A, O, C].every((L) => L !== null) && (u = x, d = S, c = Math.max(A, O), p = Math.max(O, C));
    }
    if (u === null || d === null || c === null || p === null) {
      const x = Y(a.center_x ?? a.cx ?? a.mid_x), S = Y(a.center_y ?? a.cy ?? a.mid_y), A = Y(a.width ?? a.w), O = Y(a.height ?? a.h);
      [x, S, A, O].every((C) => C !== null) && (u = x, d = S, c = A, p = O);
    }
    if (u === null || d === null || c === null || p === null) {
      const x = Y(a.x_min ?? a.left), S = Y(a.y_min ?? a.top), A = Y(a.x_max ?? a.right), O = Y(a.y_max ?? a.bottom);
      [x, S, A, O].every((C) => C !== null) && (u = (x + A) / 2, d = (S + O) / 2, c = A - x, p = O - S);
    }
    if ([u, d, c, p].some((x) => x === null || !Number.isFinite(x))) return null;
    const h = ht(c, 0.02, 1), g = ht(p, 0.02, 1), _ = [
      ht(u, h / 2, 1 - h / 2),
      ht(d, g / 2, 1 - g / 2),
      h,
      g
    ], b = Y(a.score ?? a.confidence ?? a.probability), v = b !== null ? ht(b, 0, 1) : 0.75, T = Y(a.priority ?? a.salience ?? a.importance), E = T !== null ? ht(T, 0, 1) : v;
    return {
      label: l,
      box: _,
      score: v,
      priority: E
    };
  }).filter((o) => !!o).sort((o, a) => a.priority - o.priority || a.score - o.score), i = [];
  for (const o of n)
    if (i.some((s) => {
      const l = s.label.toLowerCase() === o.label.toLowerCase(), u = Math.abs(s.box[0] - o.box[0]), d = Math.abs(s.box[1] - o.box[1]), c = Math.abs(s.box[2] - o.box[2]), p = Math.abs(s.box[3] - o.box[3]);
      return l && u < 0.06 && d < 0.06 && c < 0.08 && p < 0.08;
    }) || i.push(o), i.length >= e) break;
  return i;
}
function Lr(t) {
  if (Array.isArray(t))
    return { objects: t };
  if (t && typeof t == "object") {
    const n = t;
    if (Array.isArray(n.objects) || Array.isArray(n.detections) || Array.isArray(n.items) || Array.isArray(n.regions) || Array.isArray(n.subjects))
      return n;
    if (typeof n.label == "string" || typeof n.name == "string" || typeof n.object == "string" || Array.isArray(n.box_3d) || Array.isArray(n.box3d) || Array.isArray(n.box) || Array.isArray(n.bbox))
      return { objects: [n] };
    for (const i of ["output", "text", "content", "message", "result", "data", "response"])
      if (i in n) {
        const o = Lr(n[i]);
        if (o) return o;
      }
  }
  const e = ye(t);
  if (!e) return null;
  const r = Nl(e);
  if (!r) return null;
  try {
    const n = JSON.parse(r);
    return Array.isArray(n) ? { objects: n } : n && typeof n == "object" ? n : null;
  } catch {
    return null;
  }
}
async function Ea(t, e, r, n, i) {
  K.fal.config({ credentials: t });
  const a = (await K.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: r,
      prompt: i,
      image_urls: [e],
      max_tokens: 700
    },
    logs: !0
  })).data, s = Lr(a.output) ?? Lr(a.text) ?? Lr(a);
  return s || console.warn("[vision:auto-seg] Could not extract object JSON from vision response", {
    outputPreview: ye(a.output || a.text || a).slice(0, 1e3),
    maxObjects: n
  }), s;
}
async function Cl(t) {
  var a, s, l, u, d;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = (await Promise.all(
    t.framePaths.slice(0, 6).map((c) => on(t.apiKey, c).catch(() => null))
  )).filter((c) => !!c);
  if (e.length === 0)
    return {
      assetId: t.assetId,
      status: "missing",
      model: ((a = t.model) == null ? void 0 : a.trim()) || Fe,
      error: "No visual frames were available to upload for analysis."
    };
  K.fal.config({ credentials: t.apiKey });
  const n = (await K.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((s = t.model) == null ? void 0 : s.trim()) || Fe,
      prompt: [
        `Analyze these frames from asset "${t.assetName}" for editorial planning.`,
        "Return compact JSON only with this shape:",
        '{"summary":"...","tone":["..."],"pacing":"...","shotTypes":["..."],"subjects":["..."],"brollIdeas":["..."],"confidence":0.82}',
        "Focus on emotional tone, coverage value, pacing feel, character presence, likely shot type, and practical b-roll opportunities."
      ].join(`
`),
      image_urls: e,
      max_tokens: 450
    },
    logs: !0
  })).data, i = ye(n.output) || ye(n.text) || "", o = Nl(i);
  if (!o)
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((l = t.model) == null ? void 0 : l.trim()) || Fe,
      error: "Vision analysis did not return valid JSON."
    };
  try {
    const c = JSON.parse(o);
    return {
      assetId: t.assetId,
      status: "ready",
      summary: typeof c.summary == "string" ? c.summary.trim() : void 0,
      tone: Array.isArray(c.tone) ? c.tone.filter((p) => typeof p == "string") : void 0,
      pacing: typeof c.pacing == "string" ? c.pacing.trim() : void 0,
      shotTypes: Array.isArray(c.shotTypes) ? c.shotTypes.filter((p) => typeof p == "string") : void 0,
      subjects: Array.isArray(c.subjects) ? c.subjects.filter((p) => typeof p == "string") : void 0,
      brollIdeas: Array.isArray(c.brollIdeas) ? c.brollIdeas.filter((p) => typeof p == "string") : void 0,
      confidence: typeof c.confidence == "number" && Number.isFinite(c.confidence) ? c.confidence : void 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      model: ((u = t.model) == null ? void 0 : u.trim()) || Fe,
      sourceFrameCount: e.length
    };
  } catch {
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((d = t.model) == null ? void 0 : d.trim()) || Fe,
      error: "Vision analysis JSON parse failed."
    };
  }
}
async function ql(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await yh(t.apiKey, t.videoPath).catch(() => null);
  if (!e)
    throw new Error("Could not upload the video file for analysis.");
  K.fal.config({ credentials: t.apiKey });
  const n = (await K.fal.subscribe("fal-ai/video-understanding", {
    input: {
      video_url: e,
      prompt: t.prompt.trim() || "Describe this video in detail.",
      detailed_analysis: t.detailedAnalysis ?? !0
    },
    logs: !0
  })).data, i = ye(n.output) || ye(n.text) || ye(n.description) || ye(n);
  if (!i.trim())
    throw new Error("Video analysis returned an empty response.");
  return i.trim();
}
async function _h(t) {
  var o;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await on(t.apiKey, t.imagePath).catch(() => null);
  if (!e)
    throw new Error("Could not upload the image file for analysis.");
  K.fal.config({ credentials: t.apiKey });
  const n = (await K.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((o = t.model) == null ? void 0 : o.trim()) || Fe,
      prompt: t.prompt.trim() || "Describe this image in detail.",
      image_urls: [e],
      max_tokens: 900
    },
    logs: !0
  })).data, i = ye(n.output) || ye(n.text) || ye(n);
  if (!i.trim())
    throw new Error("Image analysis returned an empty response.");
  return i.trim();
}
async function wh(t) {
  var a, s;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = Math.min(12, Math.max(1, Math.round(t.maxObjects ?? 6))), r = await on(t.apiKey, t.imagePath).catch(() => null);
  if (!r)
    return {
      status: "missing",
      model: ((a = t.model) == null ? void 0 : a.trim()) || Fe,
      objects: [],
      error: "No image was available to upload for auto segmentation."
    };
  const n = ((s = t.model) == null ? void 0 : s.trim()) || Fe, i = [
    "You are preparing object proposals for a promptable segmentation model.",
    t.context ? `Context: ${t.context}` : null,
    'Return compact JSON only with this shape: {"objects":[{"label":"person","box":[0.52,0.48,0.28,0.7],"score":0.96,"priority":0.99}]}',
    "Each object must include a normalized box in [center_x, center_y, width, height] with values between 0 and 1.",
    `List up to ${e} distinct, mask-worthy objects.`,
    "Prefer people, faces, pets, products, props, vehicles, furniture, signs, devices, and other clearly isolated subjects.",
    "Include partially visible or cropped people, cars, trucks, bikes, and handheld objects if they are recognizably present.",
    "Do not return an empty list unless there are truly no identifiable objects in the frame."
  ].filter(Boolean).join(`
`), o = [
    "Retry object proposal extraction for image segmentation.",
    t.context ? `Context: ${t.context}` : null,
    "Be less selective. Return the most salient visible objects even if they are partially cropped, small, or overlapping.",
    'Return strict JSON only: {"objects":[{"label":"car","box":[0.5,0.5,0.4,0.3],"score":0.81,"priority":0.8}]}',
    `Return between 1 and ${e} objects whenever any recognizable object exists.`
  ].filter(Boolean).join(`
`);
  try {
    const l = await Ea(t.apiKey, r, n, e, i), u = l ? Ta(l, e) : [];
    if (u.length > 0)
      return console.info("[vision:auto-seg] Primary object proposals", {
        model: n,
        count: u.length,
        objects: u,
        context: t.context ?? null
      }), {
        status: "ready",
        model: n,
        objects: u
      };
    const d = await Ea(t.apiKey, r, n, e, o), c = d ? Ta(d, e) : [];
    return c.length > 0 ? (console.info("[vision:auto-seg] Retry object proposals", {
      model: n,
      count: c.length,
      objects: c,
      context: t.context ?? null
    }), {
      status: "ready",
      model: n,
      objects: c
    }) : (console.warn("[vision:auto-seg] No usable objects found after both prompts", {
      model: n,
      primaryKeys: l ? Object.keys(l).slice(0, 12) : [],
      retryKeys: d ? Object.keys(d).slice(0, 12) : [],
      primaryPreview: l ? JSON.stringify(l).slice(0, 1e3) : "",
      retryPreview: d ? JSON.stringify(d).slice(0, 1e3) : "",
      context: t.context ?? null
    }), {
      status: "ready",
      model: n,
      objects: []
    });
  } catch (l) {
    const u = l instanceof Error ? l.message : String(l);
    return console.error("[vision:auto-seg] Detection failed", {
      model: n,
      context: t.context ?? null,
      error: u,
      stack: l instanceof Error ? l.stack : void 0
    }), {
      status: "failed",
      model: n,
      objects: [],
      error: u || "Vision auto-segmentation failed."
    };
  }
}
function bh() {
  I.handle("vision:index-asset", async (t, e) => Cl(e)), I.handle("vision:detect-objects", async (t, e) => wh(e));
}
const vh = "anthropic/claude-sonnet-4.6";
function oe(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : null;
}
function Th(t) {
  if (!t || typeof t != "object") return;
  const e = t, r = oe(e.prompt_tokens) ?? 0, n = oe(e.completion_tokens) ?? 0, i = oe(e.total_tokens) ?? r + n, o = oe(e.cost) ?? 0;
  if (!(r <= 0 && n <= 0 && i <= 0 && o <= 0))
    return { promptTokens: r, completionTokens: n, totalTokens: i, cost: o };
}
function mr(t, e) {
  return t ? e ? {
    promptTokens: t.promptTokens + e.promptTokens,
    completionTokens: t.completionTokens + e.completionTokens,
    totalTokens: t.totalTokens + e.totalTokens,
    cost: t.cost + e.cost
  } : t : e;
}
function Eh(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
async function qt(t) {
  var o;
  K.fal.config({ credentials: t.apiKey });
  const e = {
    model: ((o = t.model) == null ? void 0 : o.trim()) || vh,
    prompt: t.prompt,
    max_tokens: Number.isFinite(t.maxTokens) ? Math.max(1, Math.floor(t.maxTokens)) : 1600
  };
  typeof t.systemPrompt == "string" && t.systemPrompt.trim() && (e.system_prompt = t.systemPrompt.trim()), typeof t.temperature == "number" && Number.isFinite(t.temperature) && (e.temperature = t.temperature);
  const n = (await K.fal.subscribe("openrouter/router", { input: e, logs: !0 })).data;
  return {
    message: (typeof n.output == "string" ? n.output : typeof n.text == "string" ? n.text : "").trim(),
    usage: Th(n.usage)
  };
}
function Hi(t) {
  const e = t.trim();
  if (!e) return null;
  try {
    return JSON.parse(e), e;
  } catch {
  }
  const r = e.indexOf("{"), n = e.lastIndexOf("}");
  if (r >= 0 && n > r) {
    const i = e.slice(r, n + 1);
    try {
      return JSON.parse(i), i;
    } catch {
      return null;
    }
  }
  return null;
}
function Sh(t) {
  switch (t) {
    case "documentary-editor":
    case "promo-trailer-editor":
    case "brand-storyteller":
    case "social-shortform-editor":
    case "interview-producer":
      return t;
    default:
      return "documentary-editor";
  }
}
function Ih(t, e = 3) {
  const r = oe(t);
  return r === null ? e : r <= 1 ? 1 : 3;
}
function xh(t, e) {
  const r = t.toLowerCase(), n = /promo|trailer|hype|teaser|sizzle|ad|commercial/.test(r), i = /tiktok|reel|short|vertical|social/.test(r), o = n ? "promo" : i ? "social short" : "documentary interview", a = n ? "promo-trailer-editor" : i ? "social-shortform-editor" : "documentary-editor", s = e.referenceTimelines.find((l) => l.timelineId === e.activeTimelineId);
  return {
    pieceType: o,
    deliverable: o,
    audience: n ? "broad promotional audience" : "documentary/story audience",
    tone: n ? "energetic and emotionally propulsive" : "grounded, human, story-first",
    pacing: n ? "punchy" : "measured",
    targetDurationSeconds: i ? 30 : 180,
    variantCount: 3,
    persona: a,
    storyGoal: n ? "Hook quickly, escalate energy, and land a strong final beat." : "Find the emotional spine and shape it into a clear arc.",
    hook: n ? "Open with the strongest visual or emotional hook." : "Open on the most emotionally revealing line.",
    formatNotes: "Use word-level timestamps when available and prefer complete thoughts.",
    qualityGoal: "auto",
    referenceTimelineId: s == null ? void 0 : s.timelineId,
    referenceTimelineName: s == null ? void 0 : s.timelineName,
    useBrollPlaceholders: !0,
    confidence: 0.55,
    rationale: "Fallback brief inferred from request keywords and active project context."
  };
}
function Ah(t) {
  return Array.isArray(t) ? t.flatMap((e, r) => {
    if (!e || typeof e != "object") return [];
    const n = e, i = typeof n.question == "string" ? n.question.trim() : "";
    if (!i) return [];
    const o = Array.isArray(n.options) ? n.options.flatMap((a, s) => {
      if (!a || typeof a != "object") return [];
      const l = a, u = typeof l.label == "string" ? l.label.trim() : "";
      return u ? [{
        id: typeof l.id == "string" && l.id.trim() ? l.id.trim() : `opt_${r + 1}_${s + 1}`,
        label: u,
        description: typeof l.description == "string" ? l.description.trim() : void 0
      }] : [];
    }) : [];
    return [{
      id: typeof n.id == "string" && n.id.trim() ? n.id.trim() : `question_${r + 1}`,
      question: i,
      help: typeof n.help == "string" ? n.help.trim() : void 0,
      allowCustom: n.allowCustom !== !1,
      options: o
    }];
  }) : [];
}
function kh(t, e) {
  if (!t || typeof t != "object")
    return { brief: e, clarifyingQuestions: [] };
  const r = t;
  return {
    brief: {
      pieceType: typeof r.pieceType == "string" && r.pieceType.trim() ? r.pieceType.trim() : e.pieceType,
      deliverable: typeof r.deliverable == "string" && r.deliverable.trim() ? r.deliverable.trim() : e.deliverable,
      audience: typeof r.audience == "string" && r.audience.trim() ? r.audience.trim() : e.audience,
      tone: typeof r.tone == "string" && r.tone.trim() ? r.tone.trim() : e.tone,
      pacing: typeof r.pacing == "string" && r.pacing.trim() ? r.pacing.trim() : e.pacing,
      targetDurationSeconds: Math.max(5, oe(r.targetDurationSeconds) ?? e.targetDurationSeconds),
      variantCount: Ih(r.variantCount, e.variantCount),
      persona: Sh(r.persona),
      storyGoal: typeof r.storyGoal == "string" && r.storyGoal.trim() ? r.storyGoal.trim() : e.storyGoal,
      hook: typeof r.hook == "string" && r.hook.trim() ? r.hook.trim() : e.hook,
      formatNotes: typeof r.formatNotes == "string" && r.formatNotes.trim() ? r.formatNotes.trim() : e.formatNotes,
      qualityGoal: r.qualityGoal === "story" || r.qualityGoal === "retention" || r.qualityGoal === "clarity" || r.qualityGoal === "auto" ? r.qualityGoal : e.qualityGoal,
      referenceTimelineId: typeof r.referenceTimelineId == "string" && r.referenceTimelineId.trim() ? r.referenceTimelineId.trim() : e.referenceTimelineId,
      referenceTimelineName: typeof r.referenceTimelineName == "string" && r.referenceTimelineName.trim() ? r.referenceTimelineName.trim() : e.referenceTimelineName,
      useBrollPlaceholders: typeof r.useBrollPlaceholders == "boolean" ? r.useBrollPlaceholders : e.useBrollPlaceholders,
      confidence: Math.min(1, Math.max(0, oe(r.confidence) ?? e.confidence)),
      rationale: typeof r.rationale == "string" && r.rationale.trim() ? r.rationale.trim() : e.rationale
    },
    clarifyingQuestions: Ah(r.clarifyingQuestions)
  };
}
function jh(t, e, r) {
  const n = { ...t, ...e ?? {} };
  if (r) {
    const i = Object.entries(r).map(([o, a]) => `${o}: ${a}`).filter((o) => !o.endsWith(": "));
    i.length > 0 && (n.formatNotes = `${n.formatNotes}
Clarifications:
${i.join(`
`)}`.trim(), n.rationale = `${n.rationale} Clarifications were provided by the user.`);
  }
  return n;
}
function Sa(t) {
  const e = Number(t);
  return Number.isFinite(e) ? Math.max(0, e) : null;
}
function Rh(t) {
  if (!t || typeof t != "object") return null;
  const e = t, r = Sa(e.source_start), n = Sa(e.source_end);
  if (r === null || n === null || n <= r) return null;
  const i = typeof e.asset_id == "string" && e.asset_id.trim() ? e.asset_id.trim() : void 0, o = typeof e.asset_name == "string" && e.asset_name.trim() ? e.asset_name.trim() : void 0;
  return !i && !o ? null : {
    ...i ? { asset_id: i } : {},
    ...o ? { asset_name: o } : {},
    source_start: r,
    source_end: n,
    ...typeof e.note == "string" && e.note.trim() ? { note: e.note.trim() } : {}
  };
}
function Ph(t, e) {
  if (!t || typeof t != "object") return null;
  const r = t, n = Array.isArray(r.segments) ? r.segments.map(Rh).filter((i) => !!i) : [];
  return n.length === 0 ? null : {
    type: "cut_proposal",
    summary: typeof r.summary == "string" && r.summary.trim() ? r.summary.trim() : `Proposed ${n.length} cut segments.`,
    timeline_name: typeof r.timeline_name == "string" && r.timeline_name.trim() ? r.timeline_name.trim() : e,
    should_create_timeline: typeof r.should_create_timeline == "boolean" ? r.should_create_timeline : !1,
    segments: n
  };
}
function Oh(t) {
  if (!t || typeof t != "object") return [];
  const e = t;
  return Array.isArray(e.variants) ? e.variants.flatMap((r, n) => {
    var a;
    if (!r || typeof r != "object") return [];
    const i = r, o = Array.isArray(i.proposals) ? i.proposals.map((s) => Ph(s, `AI Cut ${n + 1}`)).filter((s) => !!s) : [];
    return o.length === 0 ? [] : [{
      id: typeof i.id == "string" && i.id.trim() ? i.id.trim() : `variant_${n + 1}`,
      title: typeof i.title == "string" && i.title.trim() ? i.title.trim() : `Variant ${n + 1}`,
      strategy: typeof i.strategy == "string" && i.strategy.trim() ? i.strategy.trim() : "Balanced editorial approach",
      summary: typeof i.summary == "string" && i.summary.trim() ? i.summary.trim() : ((a = o[0]) == null ? void 0 : a.summary) ?? "Proposed edit.",
      rationale: typeof i.rationale == "string" && i.rationale.trim() ? i.rationale.trim() : "Generated from editorial brief, retrieval hits, and project context.",
      proposals: o,
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
  }) : [];
}
function Nh(t, e) {
  if (!t || typeof t != "object") return e;
  const r = t, n = Array.isArray(r.scorecards) ? r.scorecards : [], i = /* @__PURE__ */ new Map();
  for (const s of n) {
    if (!s || typeof s != "object") continue;
    const l = s, u = typeof l.variant_id == "string" ? l.variant_id.trim() : "";
    u && i.set(u, {
      overall: oe(l.overall) ?? 78,
      storyArc: oe(l.storyArc) ?? 78,
      pacing: oe(l.pacing) ?? 78,
      clarity: oe(l.clarity) ?? 78,
      visualFit: oe(l.visualFit) ?? 78,
      completeness: oe(l.completeness) ?? 78,
      formatFit: oe(l.formatFit) ?? 78,
      strengths: Array.isArray(l.strengths) ? l.strengths.filter((d) => typeof d == "string") : [],
      cautions: Array.isArray(l.cautions) ? l.cautions.filter((d) => typeof d == "string") : [],
      rationale: typeof l.rationale == "string" ? l.rationale.trim() : ""
    });
  }
  const o = Array.isArray(r.ranked_variant_ids) ? r.ranked_variant_ids.filter((s) => typeof s == "string") : e.map((s) => s.id), a = [...e].map((s, l) => ({
    ...s,
    scorecard: i.get(s.id) ?? {
      overall: 78 - l,
      storyArc: 78 - l,
      pacing: 78 - l,
      clarity: 78 - l,
      visualFit: 78 - l,
      completeness: 78 - l,
      formatFit: 78 - l,
      strengths: ["No judge score available; kept generation order."],
      cautions: [],
      rationale: "Judge pass was unavailable, so the generation order was preserved."
    }
  }));
  return a.sort((s, l) => {
    const u = o.indexOf(s.id), d = o.indexOf(l.id);
    return u === -1 && d === -1 ? l.scorecard.overall - s.scorecard.overall : u === -1 ? 1 : d === -1 ? -1 : u - d;
  }), a;
}
function Ch(t) {
  return t.referenceTimelines.slice(0, 5).map((e) => `- ${e.timelineName}${e.isActive ? " (active)" : ""}: ${e.structureSummary}; primary assets: ${e.primaryAssets.join(", ") || "none"}`).join(`
`);
}
function Ll(t) {
  return t.slice(0, 18).map((e, r) => {
    const n = e.timelinePlacements[0], i = n ? ` | timeline: ${n.timelineName} @ ${n.timelineTime.toFixed(1)}` : "", o = e.words.length > 0 ? `
   Word timings: ${e.words.slice(0, 18).map((a) => `${a.word}@${a.start.toFixed(1)}-${a.end.toFixed(1)}`).join(" ")}` : "";
    return `${r + 1}. ${e.assetName} ${e.sourceStart.toFixed(1)}-${e.sourceEnd.toFixed(1)}${i}
   ${e.text}
   Reason: ${e.reason}${o}`;
  }).join(`
`);
}
function qh(t) {
  return t.filter((e) => e.status === "ready" && e.summary).slice(0, 6).map((e) => [
    `- Asset ${e.assetId}: ${e.summary}`,
    e.tone && e.tone.length > 0 ? `  Tone: ${e.tone.join(", ")}` : "",
    e.pacing ? `  Pacing: ${e.pacing}` : "",
    e.shotTypes && e.shotTypes.length > 0 ? `  Shot types: ${e.shotTypes.join(", ")}` : "",
    e.brollIdeas && e.brollIdeas.length > 0 ? `  B-roll ideas: ${e.brollIdeas.join(", ")}` : ""
  ].filter(Boolean).join(`
`)).join(`
`);
}
async function Lh(t) {
  var i;
  const e = new Set(t.retrievedMoments.map((o) => o.assetId)), r = t.visualCandidates.filter((o) => e.has(o.assetId)).slice(0, 4), n = [];
  for (const o of r) {
    if (((i = o.storedSummary) == null ? void 0 : i.status) === "ready" && (!t.model || o.storedSummary.model === t.model)) {
      n.push(o.storedSummary);
      continue;
    }
    n.push(await Cl({
      apiKey: t.apiKey,
      assetId: o.assetId,
      assetName: o.assetName,
      framePaths: o.framePaths,
      model: t.model
    }));
  }
  return n;
}
async function Uh(t) {
  var o;
  const e = xh(t.request, t.index), r = [
    "You are CineGen's senior editorial strategist.",
    "Infer the best editable cut brief for this request from the active project context.",
    "Return JSON only with this shape:",
    '{"pieceType":"...","deliverable":"...","audience":"...","tone":"...","pacing":"...","targetDurationSeconds":180,"variantCount":3,"persona":"documentary-editor","storyGoal":"...","hook":"...","formatNotes":"...","qualityGoal":"auto","referenceTimelineId":"optional","referenceTimelineName":"optional","useBrollPlaceholders":true,"confidence":0.84,"rationale":"...","clarifyingQuestions":[{"id":"...","question":"...","help":"...","allowCustom":true,"options":[{"id":"...","label":"...","description":"..."}]}]}',
    "Only include clarifying questions if the request is ambiguous or materially underspecified.",
    "",
    `User request: ${t.request}`,
    "",
    "Project context:",
    `- Assets: ${t.index.stats.assetCount}`,
    `- Transcript-ready assets: ${t.index.stats.transcriptReadyCount}`,
    `- Word-timestamp-ready assets: ${t.index.stats.wordTimestampReadyCount}`,
    `- Visual-summary-ready assets: ${t.index.stats.visualSummaryReadyCount}`,
    "Reference timelines:",
    Ch(t.index)
  ].join(`
`), n = await qt({
    apiKey: t.apiKey,
    model: t.model,
    systemPrompt: [
      "You produce concise, grounded editorial briefs for film and promo editors.",
      ((o = t.customSystemPrompt) == null ? void 0 : o.trim()) || ""
    ].filter(Boolean).join(`

`),
    prompt: r,
    maxTokens: 900,
    temperature: 0.35
  }), i = Hi(n.message);
  if (!i)
    return { brief: e, clarifyingQuestions: [], usage: n.usage };
  try {
    const a = JSON.parse(i);
    return { ...kh(a, e), usage: n.usage };
  } catch {
    return { brief: e, clarifyingQuestions: [], usage: n.usage };
  }
}
async function Ia(t, e, r, n, i = {}) {
  const o = [e, r.storyGoal, r.hook, r.tone, r.audience].join(" ");
  let a = mh(t, o, { limit: 20, persona: r.persona });
  if (i.rerank && i.apiKey && a.length > 1)
    try {
      const l = lh({ query: o, brief: r, candidates: a }), u = await qt({
        apiKey: i.apiKey,
        model: i.model,
        systemPrompt: "You re-rank candidate video moments for an editor. Return JSON only.",
        prompt: l,
        maxTokens: 500,
        temperature: 0.2
      });
      a = dh(a, u.message);
    } catch {
    }
  const s = n.filter((l) => l.status === "ready").length;
  return {
    topMoments: a,
    referenceTimelines: t.referenceTimelines.slice(0, 4),
    visualSummaryStatus: s <= 0 ? "none" : s < Math.max(1, a.length) ? "partial" : "ready",
    note: a.length > 0 ? `Retrieved ${a.length} transcript-driven source moments${s > 0 ? ` and ${s} visual summaries` : ""}.` : "No high-confidence transcript moments were retrieved; generation should stay conservative."
  };
}
async function Mh(t) {
  var u;
  const e = (d, c) => {
    const p = Hi(d);
    if (!p) return null;
    try {
      const f = JSON.parse(p), y = Oh({ variants: [f] })[0];
      return y ? {
        variant: y,
        usage: c
      } : null;
    } catch {
      return null;
    }
  }, r = async (d, c) => {
    const p = [
      `Repair this malformed cut-variant response into valid JSON for variant ${c + 1}.`,
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "Do not add commentary before or after the JSON.",
      "If part of the raw output was truncated, salvage one valid variant.",
      "",
      "Malformed response:",
      d
    ].join(`
`), f = await qt({
      apiKey: t.apiKey,
      model: t.model,
      systemPrompt: "You repair malformed structured editor outputs. Return strict JSON only.",
      prompt: p,
      maxTokens: 4200,
      temperature: 0.1
    }), m = e(f.message, f.usage);
    return m || {
      variant: null,
      usage: f.usage
    };
  }, n = t.brief.variantCount, i = `${t.brief.pieceType} ${t.brief.deliverable} ${t.brief.tone}`.toLowerCase(), a = (/promo|trailer|social|teaser|hype/.test(i) ? [
    "Hook-first build: open with the strongest reveal, escalate momentum, and land a clean payoff.",
    "Character-first build: anchor emotionally first, then accelerate into the strongest theme beat.",
    "Payoff-first reverse build: tease the outcome early, then build toward why it matters."
  ] : [
    "Chronological emotional arc: move from foundation into escalation and close on the strongest emotional beat.",
    "Theme-first structure: organize around the core idea instead of strict chronology, favoring emotional clarity.",
    "Cold-open documentary structure: open on the strongest line, then rewind and build a layered arc."
  ]).slice(0, n);
  let s;
  const l = [];
  for (let d = 0; d < a.length; d += 1) {
    const p = [
      "You are CineGen's lead editor creating one high-quality cut proposal.",
      `Generate exactly one editorial variant using this strategy: ${a[d]}`,
      "Use the retrieved moments and visual findings as evidence. Do not invent content outside them.",
      "Use word-level source timings when possible and cut tighter than sentence edges when the request calls for it.",
      "Do not include any prose before or after the JSON.",
      "Keep notes concise and practical.",
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "If the user asked for multiple parts, the variant may include multiple proposals, one per part.",
      l.length > 0 ? `Already generated variants (do something meaningfully different):
${JSON.stringify(l.map((h) => ({ title: h.title, strategy: h.strategy, summary: h.summary })), null, 2)}` : "",
      "",
      "Editorial brief:",
      JSON.stringify(t.brief, null, 2),
      "",
      "Retrieved moments:",
      Ll(t.retrievalSummary.topMoments),
      "",
      "Reference timelines:",
      t.retrievalSummary.referenceTimelines.map((h) => `- ${h.timelineName}: ${h.structureSummary}`).join(`
`) || "- none",
      "",
      "Visual findings:",
      qh(t.visualFindings) || "- none",
      "",
      `Original request: ${t.request}`
    ].filter(Boolean).join(`
`), f = await qt({
      apiKey: t.apiKey,
      model: t.model,
      systemPrompt: [
        "You are a world-class editor. Make proposals that feel genuinely cuttable, not generic.",
        "When the brief reads documentary/interview, think like a documentary filmmaker shaping a story arc.",
        "When the brief reads promo/trailer/social, think like a promo editor optimizing hook, pacing, and payoff.",
        ((u = t.customSystemPrompt) == null ? void 0 : u.trim()) || ""
      ].filter(Boolean).join(`

`),
      prompt: p,
      maxTokens: 2400,
      temperature: 0.45
    });
    s = mr(s, f.usage);
    const m = e(f.message, f.usage);
    if (m != null && m.variant) {
      l.push({
        ...m.variant,
        id: `variant_${d + 1}`
      });
      continue;
    }
    const y = await r(f.message, d);
    s = mr(s, y.usage), y.variant && l.push({
      ...y.variant,
      id: `variant_${d + 1}`
    });
  }
  return l.length === 0 ? {
    variants: [],
    summaryMessage: "I hit a formatting issue while packaging the cut variants. Review the brief and try again.",
    usage: s
  } : {
    variants: l,
    summaryMessage: l.length === 1 ? "I generated one cut variant. Review it below." : `I generated ${l.length} cut variants. Review the options below.`,
    usage: s
  };
}
async function Dh(t) {
  var i;
  if (t.variants.length === 0) return { variants: [] };
  const e = [
    "You are CineGen's finishing editor and quality judge.",
    "Score these variants against the brief. Prefer genuinely strong editorial structure over generic balance.",
    "Return JSON only with this shape:",
    '{"ranked_variant_ids":["variant_2","variant_1","variant_3"],"scorecards":[{"variant_id":"variant_2","overall":92,"storyArc":94,"pacing":90,"clarity":89,"visualFit":88,"completeness":91,"formatFit":93,"strengths":["..."],"cautions":["..."],"rationale":"..."}]}',
    "",
    "Editorial brief:",
    JSON.stringify(t.brief, null, 2),
    "",
    "Retrieved evidence summary:",
    Ll(t.retrievalSummary.topMoments.slice(0, 10)),
    "",
    "Variants:",
    JSON.stringify(t.variants.map((o) => ({
      id: o.id,
      title: o.title,
      strategy: o.strategy,
      summary: o.summary,
      rationale: o.rationale,
      proposalSummaries: o.proposals.map((a) => ({
        timeline_name: a.timeline_name,
        summary: a.summary,
        segmentCount: a.segments.length,
        firstSegments: a.segments.slice(0, 4)
      }))
    })), null, 2)
  ].join(`
`), r = await qt({
    apiKey: t.apiKey,
    model: t.model,
    systemPrompt: [
      "Be decisive. Prefer the best usable cut, not the safest explanation.",
      ((i = t.customSystemPrompt) == null ? void 0 : i.trim()) || ""
    ].filter(Boolean).join(`

`),
    prompt: e,
    maxTokens: 1600,
    temperature: 0.2
  }), n = Hi(r.message);
  if (!n) return { variants: t.variants, usage: r.usage };
  try {
    const o = JSON.parse(n);
    return {
      variants: Nh(o, t.variants),
      usage: r.usage
    };
  } catch {
    return { variants: t.variants, usage: r.usage };
  }
}
async function $h(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = t.index, r = t.request.trim();
  if (!r) throw new Error("No cut request provided.");
  let n;
  const i = await Uh({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: r,
    index: e
  });
  n = mr(n, i.usage);
  const o = jh(i.brief, t.briefOverride, t.questionAnswers), a = await Ia(e, r, o, []);
  if (!t.confirmedBrief)
    return {
      stage: "brief",
      summaryMessage: i.clarifyingQuestions.length > 0 ? "I drafted an editorial brief and I need a bit of guidance before generating the cut variants." : "I drafted the editorial brief. Review it, adjust anything you want, then generate the cut variants.",
      editorialBrief: o,
      clarifyingQuestions: i.clarifyingQuestions,
      retrievalSummary: a,
      visualFindings: [],
      variants: [],
      ...n ? { usage: n } : {}
    };
  const s = await Lh({
    apiKey: t.apiKey,
    visualCandidates: e.visualInputs,
    retrievedMoments: a.topMoments,
    model: t.visionModel
  }), l = await Ia(e, r, o, s, {
    apiKey: t.apiKey,
    model: t.model,
    rerank: o.qualityGoal !== "auto"
  }), u = await Mh({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: r,
    brief: o,
    retrievalSummary: l,
    visualFindings: s
  });
  if (n = mr(n, u.usage), u.variants.length === 0)
    return {
      stage: "brief",
      summaryMessage: u.summaryMessage,
      editorialBrief: o,
      clarifyingQuestions: i.clarifyingQuestions,
      retrievalSummary: l,
      visualFindings: s,
      variants: [],
      ...n ? { usage: n } : {}
    };
  const d = await Dh({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    brief: o,
    retrievalSummary: l,
    variants: u.variants
  });
  return n = mr(n, d.usage), {
    stage: "variants",
    summaryMessage: u.summaryMessage,
    editorialBrief: o,
    clarifyingQuestions: i.clarifyingQuestions,
    retrievalSummary: l,
    visualFindings: s,
    variants: d.variants,
    ...n ? { usage: n } : {}
  };
}
const Ul = "http://127.0.0.1:11434";
function Fh() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
async function Bh(t, e) {
  var y, h;
  const r = ((y = e.model) == null ? void 0 : y.trim()) || "qwen3.5:latest", n = [];
  (h = e.systemPrompt) != null && h.trim() && n.push({ role: "system", content: e.systemPrompt.trim() });
  for (const g of e.messages ?? [])
    g.content.trim() && n.push({ role: g.role, content: g.content.trim() });
  if (n.length === 0 || n.every((g) => g.role === "system"))
    throw new Error("No chat messages provided.");
  const i = {
    model: r,
    messages: n,
    stream: !0,
    think: !1,
    options: {
      ...Number.isFinite(e.temperature) ? { temperature: e.temperature } : {},
      ...Number.isFinite(e.maxTokens) && e.maxTokens > 0 ? { num_predict: Math.floor(e.maxTokens) } : {}
    }
  }, o = await fetch(`${Ul}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(i)
  });
  if (!o.ok) {
    const g = await o.text().catch(() => "");
    throw new Error(`Ollama request failed (${o.status}): ${g || o.statusText}`);
  }
  const a = Fh();
  let s = "", l = 0, u = 0, d = !1, c = "";
  const p = o.body.getReader(), f = new TextDecoder();
  let m = "";
  for (; ; ) {
    const { done: g, value: _ } = await p.read();
    if (g) break;
    m += f.decode(_, { stream: !0 });
    let b;
    for (; (b = m.indexOf(`
`)) >= 0; ) {
      const v = m.slice(0, b).trim();
      if (m = m.slice(b + 1), !!v)
        try {
          const T = JSON.parse(v), E = T.message, x = typeof (E == null ? void 0 : E.content) == "string" ? E.content : "";
          if (x)
            for (const S of x)
              d ? (c += S, c.endsWith("</think>") && (d = !1, c = "")) : (c += S, c === "<think>" ? (d = !0, c = "") : "<think>".startsWith(c) || (s += c, a == null || a.webContents.send("llm:local-stream", { requestId: t, token: c }), c = ""));
          T.done && (l = oe(T.prompt_eval_count) ?? 0, u = oe(T.eval_count) ?? 0);
        } catch {
        }
    }
  }
  return c && !d && (s += c, a == null || a.webContents.send("llm:local-stream", { requestId: t, token: c })), a == null || a.webContents.send("llm:local-stream", { requestId: t, done: !0 }), {
    message: s.trim(),
    usage: l > 0 || u > 0 ? { promptTokens: l, completionTokens: u, totalTokens: l + u, cost: 0 } : void 0
  };
}
async function Vh() {
  try {
    const t = await fetch(`${Ul}/api/tags`);
    return t.ok ? ((await t.json()).models ?? []).map((r) => r.name) : [];
  } catch {
    return [];
  }
}
function Gh() {
  I.handle("llm:chat", async (t, e) => {
    const r = e.apiKey;
    if (!r) throw new Error("No fal.ai API key provided.");
    const n = Array.isArray(e.messages) ? e.messages : [], i = Eh(n);
    if (!i.trim()) throw new Error("No chat prompt provided.");
    const o = await qt({
      apiKey: r,
      model: e.model,
      systemPrompt: e.systemPrompt,
      prompt: i,
      maxTokens: e.maxTokens,
      temperature: e.temperature
    });
    return {
      message: o.message,
      ...o.usage ? { usage: o.usage } : {}
    };
  }), I.handle("llm:local-chat", async (t, e) => {
    const r = e.requestId || crypto.randomUUID(), n = await Bh(r, e);
    return {
      message: n.message,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), I.handle("llm:local-models", async () => Vh()), I.handle("llm:run-cut-workflow", async (t, e) => $h(e));
}
const Ml = Lt(Ce), Hh = [
  w.join(z.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
], zh = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "When an ACTIVE SKILL section is present, follow it directly in chat — never invoke Skill tool or slash commands.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), Wh = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "CineGen SKILLS are in the system prompt — list them directly; never use Skill tool or say you will check.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), Xh = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" "), Jh = "", Kh = "2";
let Pr, nt = null;
function zi() {
  const t = z.homedir(), e = [
    w.join(t, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ], r = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...e, r].filter(Boolean).join(w.delimiter)
  };
}
async function Dl() {
  if (Pr !== void 0) return Pr;
  for (const t of Hh)
    try {
      const { stdout: e } = await Ml(t, ["--version"], {
        env: zi(),
        timeout: 8e3
      });
      if (e.toLowerCase().includes("claude"))
        return Pr = t, t;
    } catch {
    }
  return Pr = null, null;
}
function Yh() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function Qh(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
function xa(t) {
  const e = t.usage;
  if (!e || typeof e != "object") return;
  const r = Number(e.input_tokens) || 0, n = Number(e.cache_creation_input_tokens) || 0, i = Number(e.cache_read_input_tokens) || 0, o = r + n + i, a = Number(e.output_tokens) || 0, s = o + a, l = Number(t.total_cost_usd) || 0;
  if (!(o <= 0 && a <= 0 && s <= 0 && l <= 0))
    return { promptTokens: o, completionTokens: a, totalTokens: s, cost: l };
}
function Zh(t, e, r) {
  const n = Array.isArray(r == null ? void 0 : r.errors) ? r.errors.filter((o) => typeof o == "string") : [];
  if (n.length > 0)
    return n.join(" ");
  if (typeof (r == null ? void 0 : r.result) == "string" && r.result.trim())
    return r.result.trim();
  if ((r == null ? void 0 : r.subtype) === "error_max_turns")
    return "Claude Code hit its turn limit before finishing a reply. Retry your message — Copilot answers in chat only, without tools.";
  const i = e.trim();
  return i || `Claude Code exited with code ${t ?? "unknown"}`;
}
function Aa(t) {
  if (t.type === "stream_event") {
    const e = t.event, r = e == null ? void 0 : e.delta;
    if ((r == null ? void 0 : r.type) === "text_delta" && typeof r.text == "string")
      return r.text;
  }
  if (t.type === "assistant") {
    const e = t.message;
    return ((e == null ? void 0 : e.content) ?? []).filter((r) => r.type === "text" && typeof r.text == "string").map((r) => r.text).join("");
  }
  return t.type === "result" && typeof t.result == "string" ? t.result : "";
}
function eg() {
  return w.join(W.getPath("userData"), "claude-code-workspace");
}
function tg(t) {
  return t.purpose === "json-job" ? !0 : t.purpose === "copilot" || t.purpose === "enhance-prompt" ? !1 : !t.injectProjectContext && !t.resumeSessionId && !(t.messages && t.messages.length > 0);
}
function rg(t, e) {
  if (t.injectProjectContext) {
    const r = (t.messages ?? []).filter((n) => n.content.trim());
    if (r.length > 0)
      return Qh(r);
  }
  return e ? t.userMessage.trim() : `${t.userMessage.trim()}

Assistant:
`;
}
async function ng(t, e) {
  var h, g, _, b;
  const r = await Dl();
  if (!r)
    throw new Error("Claude Code is not installed. Install it from https://code.claude.com");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const n = ((h = e.model) == null ? void 0 : h.trim()) || "sonnet", i = !!e.resumeSessionId && !e.injectProjectContext, o = tg(e), a = [
    "-p",
    i ? e.userMessage.trim() : rg(e, o),
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    Kh,
    "--model",
    n,
    "--tools",
    Jh,
    "--disable-slash-commands",
    // No --mcp-config is passed, so this loads ZERO MCP servers. These jobs never use
    // them, and booting/tearing down the user's fleet dominated the call's wall clock.
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk"
  ];
  if (o ? (a.push("--safe-mode", "--effort", "low", "--include-partial-messages"), !i && ((g = e.systemPrompt) != null && g.trim()) && a.push("--system-prompt", e.systemPrompt.trim())) : a.push("--include-partial-messages"), i && e.resumeSessionId) {
    if (a.push("--resume", e.resumeSessionId), !o) {
      const v = [(_ = e.systemPrompt) == null ? void 0 : _.trim(), Wh].filter(Boolean).join(`

`);
      a.push("--append-system-prompt", v);
    }
  } else if (!o && e.injectProjectContext && ((b = e.systemPrompt) != null && b.trim())) {
    const v = e.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "", T = e.purpose === "enhance-prompt" ? Xh : zh;
    a.push("--append-system-prompt", `${v}${e.systemPrompt.trim()}

${T}`);
  }
  const s = Yh(), l = o ? eg() : void 0;
  l && await at(l, { recursive: !0 });
  let u = "", d = "", c, p = !1, f = !1, m, y;
  return new Promise((v, T) => {
    var O, C;
    const E = ae(r, a, {
      env: zi(),
      ...l ? { cwd: l } : {},
      stdio: ["ignore", "pipe", "pipe"]
    });
    nt = { child: E, requestId: t };
    let x = "", S = !1;
    const A = (L) => {
      S || (S = !0, nt = null, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, done: !0 }), L(), E.killed || E.kill());
    };
    (O = E.stdout) == null || O.on("data", (L) => {
      x += L.toString();
      let V;
      for (; (V = x.indexOf(`
`)) >= 0; ) {
        const H = x.slice(0, V).trim();
        if (x = x.slice(V + 1), !!H)
          try {
            const B = JSON.parse(H);
            if (B.type === "system" && B.subtype === "init" && typeof B.session_id == "string" && (c = B.session_id), B.type === "assistant" && B.error === "authentication_failed" && (p = !0), B.type === "result") {
              y = B;
              const G = Aa(B);
              G && !u.trim() && (u = G, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: G }));
              const k = u.trim();
              if (k && !p && !k.includes("Not logged in")) {
                A(() => v({ message: k, sessionId: c, usage: m, resumed: i }));
                return;
              }
            }
            const R = xa(B);
            if (R)
              m = R;
            else if (B.type === "assistant") {
              const G = B.message;
              if (G != null && G.usage) {
                const k = xa({ usage: G.usage });
                k && (m = k);
              }
            }
            const N = Aa(B);
            if (!N) continue;
            if (B.type === "stream_event") {
              f = !0, u += N, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: N });
              continue;
            }
            B.type === "assistant" && !f ? (u = N, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: N })) : B.type === "result" && !u.trim() && (u = N, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: N }));
          } catch {
          }
      }
    }), (C = E.stderr) == null || C.on("data", (L) => {
      d += L.toString();
    }), E.on("error", (L) => {
      A(() => T(L));
    }), E.on("close", (L) => {
      A(() => {
        const V = u.trim();
        if (p || V.includes("Not logged in")) {
          T(new Error("Claude Code is not logged in. Open Terminal, run `claude`, and sign in with your subscription."));
          return;
        }
        if (V) {
          v({ message: V, sessionId: c, usage: m, resumed: i });
          return;
        }
        T(new Error(Zh(L, d, y)));
      });
    });
  });
}
function ig() {
  I.handle("llm:claude-code-detect", async () => {
    const t = await Dl();
    if (!t)
      return { installed: !1 };
    try {
      const { stdout: e } = await Ml(t, ["--version"], {
        env: zi(),
        timeout: 8e3
      });
      return {
        installed: !0,
        path: t,
        version: e.trim()
      };
    } catch {
      return { installed: !1 };
    }
  }), I.handle("llm:claude-code-chat", async (t, e) => {
    const r = e.requestId || J.randomUUID(), n = await ng(r, e);
    return {
      message: n.message,
      sessionId: n.sessionId,
      resumed: n.resumed,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), I.handle("llm:claude-code-cancel", async (t, e) => {
    (nt == null ? void 0 : nt.requestId) === e && (nt.child.kill("SIGTERM"), nt = null);
  });
}
const Wi = Lt(Ce), og = {
  "claude-code": [
    w.join(z.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "claude"
  ],
  codex: [
    w.join(z.homedir(), ".npm-global/bin/codex"),
    w.join(z.homedir(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "codex"
  ],
  gemini: [
    w.join(z.homedir(), ".npm-global/bin/gemini"),
    w.join(z.homedir(), ".local/bin/gemini"),
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
    "gemini"
  ]
}, Dn = /* @__PURE__ */ new Map();
function Er() {
  const t = z.homedir(), e = [
    w.join(t, ".local/bin"),
    w.join(t, ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ], r = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...e, r].filter(Boolean).join(w.delimiter)
  };
}
function $l() {
  return {
    ...Er(),
    GEMINI_CLI_TRUST_WORKSPACE: "true",
    TERM: "dumb",
    NO_COLOR: "1"
  };
}
function ci(t) {
  return t.replace(/\u001b\[[0-9;]*m/g, "");
}
async function an(t) {
  if (Dn.has(t))
    return Dn.get(t) ?? null;
  for (const e of og[t])
    try {
      const { stdout: r } = await Wi(e, ["--version"], {
        env: Er(),
        timeout: 8e3
      });
      if (r.trim())
        return Dn.set(t, e), e;
    } catch {
    }
  return null;
}
async function ag(t, e) {
  if (t === "gemini") return;
  const r = t === "codex" ? ["login", "status"] : ["auth", "status"];
  let n = "";
  try {
    const i = await Wi(e, r, { env: Er(), timeout: 8e3 });
    n = `${i.stdout}
${i.stderr}`;
  } catch (i) {
    const o = i;
    n = `${o.stdout ?? ""}
${o.stderr ?? ""}`;
  }
  if (t === "codex") {
    if (/not logged in/i.test(n)) return !1;
    if (/logged in using/i.test(n)) return !0;
  } else
    try {
      const i = JSON.parse(n.trim());
      if (typeof i.loggedIn == "boolean") return i.loggedIn;
    } catch {
    }
}
async function $n(t) {
  const e = await an(t);
  if (!e)
    return { id: t, installed: !1 };
  try {
    const { stdout: r } = await Wi(e, ["--version"], {
      env: Er(),
      timeout: 8e3
    });
    return {
      id: t,
      installed: !0,
      authenticated: await ag(t, e),
      path: e,
      version: r.trim()
    };
  } catch {
    return { id: t, installed: !1 };
  }
}
async function sg() {
  return Promise.all([
    $n("claude-code"),
    $n("codex"),
    $n("gemini")
  ]);
}
function Fl() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function fi(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
const Bl = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), lg = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), Vl = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" ");
function ug() {
  I.handle("llm:cli-detect", async () => ({ providers: await sg() }));
}
function dg(t) {
  var r;
  let e = t instanceof Error ? t.message : String(t || "Assistant failed.");
  for (let n = 0; n < 6; n++) {
    e = e.replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "").trim();
    try {
      const i = JSON.parse(e);
      if (typeof i == "string") {
        e = i;
        continue;
      }
      if (i && typeof i == "object") {
        const o = i, a = typeof o.error == "string" ? o.error : ((r = o.error) == null ? void 0 : r.message) ?? o.message;
        if (typeof a == "string") {
          e = a;
          continue;
        }
      }
    } catch {
    }
    break;
  }
  return /model is not supported when using Codex with a ChatGPT account/i.test(e) ? "That model is unavailable with your ChatGPT account. Choose Codex default and try again." : e || "Assistant failed. Please try again.";
}
function cg(t, e) {
  const r = t.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "").trim(), n = r.match(/You've hit your usage limit\.[^\n]*/i);
  if (n)
    return `${n[0].trim()} Luna and Codex share your ChatGPT Codex quota — pick fal.ai in the LLM picker, or wait for the reset.`;
  const i = r.split(`
`).filter((o) => {
    const a = o.trim();
    return !(!a || /^Reading additional input from stdin/i.test(a) || /codex_models_manager::cache/i.test(a) || /rmcp::transport/i.test(a) || /AuthRequiredError|AuthRequired\(/i.test(a));
  }).join(`
`).trim();
  return i ? dg(i) : `Codex exited with code ${e ?? "unknown"}`;
}
function fg(t) {
  const e = t == null ? void 0 : t.trim();
  return !e || e === "auto" || e === "gpt-5.3-codex" ? void 0 : e;
}
let se = null;
function pg() {
  return w.join(W.getPath("userData"), "codex-workspace");
}
function mg(t) {
  return t.purpose === "json-job" ? !0 : t.purpose === "copilot" || t.purpose === "enhance-prompt" ? !1 : !t.injectProjectContext && !t.resumeSessionId && !(t.messages && t.messages.length > 0);
}
function hg(t, e) {
  var o, a;
  if (e) {
    const s = ((o = t.systemPrompt) == null ? void 0 : o.trim()) ?? "", l = t.userMessage.trim();
    return s ? `${s}

${l}` : l;
  }
  const r = [];
  if ((a = t.systemPrompt) != null && a.trim())
    if (t.injectProjectContext) {
      const s = t.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "", l = t.purpose === "enhance-prompt" ? Vl : Bl;
      r.push(`${s}${t.systemPrompt.trim()}

${l}`);
    } else
      r.push(t.systemPrompt.trim());
  const n = (t.messages ?? []).filter((s) => s.content.trim()), i = n.length > 0 ? fi(n) : `${t.userMessage.trim()}

Assistant:
`;
  return r.length > 0 ? `${r.join(`

`)}

${i}` : t.userMessage.trim();
}
function gg(t) {
  const e = t.usage;
  if (!e) return;
  const r = Number(e.input_tokens) || 0, n = Number(e.cached_input_tokens) || 0, i = r + n, o = Number(e.output_tokens) || 0, a = i + o;
  if (!(a <= 0))
    return { promptTokens: i, completionTokens: o, totalTokens: a, cost: 0 };
}
function yg(t) {
  if (t.type !== "item.completed" && t.type !== "item.updated") return "";
  const e = t.item;
  return (e == null ? void 0 : e.type) === "agent_message" && typeof e.text == "string" ? e.text : "";
}
async function _g(t, e) {
  const r = await an("codex");
  if (!r)
    throw new Error("Codex CLI is not installed. Install it from https://developers.openai.com/codex");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const n = fg(e.model), i = !!e.resumeSessionId && !e.injectProjectContext, o = mg(e), a = i ? e.userMessage.trim() : hg(e, o), s = pg();
  await at(s, { recursive: !0 });
  const l = [
    "exec",
    "--json",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-C",
    s
  ];
  n && l.push("-m", n), i && e.resumeSessionId && l.push("resume", e.resumeSessionId), o || l.push(a);
  const u = Fl();
  let d = "", c = "", p = "", f = !1, m, y, h = "";
  return new Promise((g, _) => {
    var T, E, x, S;
    const b = ae(r, l, {
      env: Er(),
      cwd: s,
      stdio: o ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    o && ((T = b.stdin) == null || T.write(a), (E = b.stdin) == null || E.end()), se = { child: b, requestId: t, provider: "codex" };
    let v = "";
    (x = b.stdout) == null || x.on("data", (A) => {
      v += A.toString();
      let O;
      for (; (O = v.indexOf(`
`)) >= 0; ) {
        const C = v.slice(0, O).trim();
        if (v = v.slice(O + 1), !!C)
          try {
            const L = JSON.parse(C);
            L.type === "thread.started" && typeof L.thread_id == "string" && (m = L.thread_id);
            const V = gg(L);
            if (V && (y = V), L.type === "turn.failed") {
              f = !0;
              const B = L.error;
              p = (B == null ? void 0 : B.message) ?? "Codex turn failed.";
            } else L.type === "error" && typeof L.message == "string" && (p = L.message);
            const H = yg(L);
            if (H) {
              const B = H.startsWith(h) ? H.slice(h.length) : H;
              h = H, d = H, B && (u == null || u.webContents.send("llm:codex-stream", { requestId: t, token: B }));
            }
          } catch {
          }
      }
    }), (S = b.stderr) == null || S.on("data", (A) => {
      c += A.toString();
    }), b.on("error", (A) => {
      (se == null ? void 0 : se.requestId) === t && (se = null), _(A);
    }), b.on("close", (A) => {
      (se == null ? void 0 : se.requestId) === t && (se = null), u == null || u.webContents.send("llm:codex-stream", { requestId: t, done: !0 });
      const O = d.trim();
      if (!O || A !== 0 || f) {
        _(new Error(cg(p || c, A)));
        return;
      }
      g({ message: O, sessionId: m, usage: y, resumed: i });
    });
  });
}
function wg() {
  I.handle("llm:codex-chat", async (t, e) => {
    const r = e.requestId || J.randomUUID(), n = await _g(r, e);
    return {
      message: n.message,
      sessionId: n.sessionId,
      resumed: n.resumed,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), I.handle("llm:codex-cancel", async (t, e) => {
    (se == null ? void 0 : se.requestId) !== e || se.provider !== "codex" || (se.child.kill("SIGTERM"), se = null);
  });
}
const bg = 272e3, ka = {
  short: { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
  long: { input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 }
};
function Zt(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? Math.floor(e) : 0;
}
function vg(t) {
  if (!t || typeof t != "object" || Array.isArray(t)) return;
  const e = t.usage;
  if (!e || typeof e != "object" || Array.isArray(e)) return;
  const r = e, n = r.prompt_tokens_details && typeof r.prompt_tokens_details == "object" && !Array.isArray(r.prompt_tokens_details) ? r.prompt_tokens_details : {}, i = Zt(r.prompt_tokens ?? r.input_tokens), o = Zt(r.completion_tokens ?? r.output_tokens), a = Zt(n.cached_tokens), s = Zt(n.cache_write_tokens), l = Zt(r.total_tokens) || i + o;
  if (!(i <= 0 && o <= 0 && l <= 0))
    return { promptTokens: i, completionTokens: o, totalTokens: l, cachedTokens: a, cacheWriteTokens: s };
}
function Tg(t) {
  const e = t.promptTokens > bg ? ka.long : ka.short, r = Math.min(t.cachedTokens, t.promptTokens), n = Math.min(t.cacheWriteTokens, Math.max(0, t.promptTokens - r)), o = (Math.max(0, t.promptTokens - r - n) * e.input + r * e.cached + n * e.cacheWrite + t.completionTokens * e.output) / 1e6;
  return { ...t, cost: Math.round(o * 1e8) / 1e8 };
}
const Eg = "https://api.openai.com/v1/chat/completions", Sg = "gpt-5.6-luna", Ig = 6e4;
function xg(t, e = []) {
  const r = t.trim(), n = e.map((i) => i.trim()).filter(Boolean);
  return n.length === 0 ? r : [
    { type: "text", text: r },
    ...n.map((i) => ({ type: "image_url", image_url: { url: i, detail: "low" } }))
  ];
}
function Ag(t) {
  var i, o;
  const e = [], r = ((i = t.systemPrompt) == null ? void 0 : i.trim()) ?? "";
  r && e.push({ role: "system", content: r }), e.push({ role: "user", content: xg(t.userMessage, t.imageUrls) });
  const n = {
    model: ((o = t.model) == null ? void 0 : o.trim()) || Sg,
    messages: e,
    reasoning_effort: t.reasoningEffort ?? "low",
    max_completion_tokens: Number.isFinite(t.maxCompletionTokens) ? Math.max(1, Math.floor(t.maxCompletionTokens)) : Ig
  };
  return t.jsonObject !== !1 && (n.response_format = { type: "json_object" }), n;
}
function kg(t, e) {
  if (typeof t == "string" && t.trim()) return t.trim().slice(0, 2e3);
  if (!t || typeof t != "object" || Array.isArray(t)) return e;
  const r = t, n = r.error;
  if (typeof n == "string" && n.trim()) return n.trim().slice(0, 2e3);
  if (n && typeof n == "object" && !Array.isArray(n)) {
    const i = n.message;
    if (typeof i == "string" && i.trim()) return i.trim().slice(0, 2e3);
  }
  return typeof r.message == "string" && r.message.trim() ? r.message.trim().slice(0, 2e3) : e;
}
function jg(t) {
  if (!t || typeof t != "object" || Array.isArray(t))
    throw new Error("OpenAI returned an invalid response.");
  const e = t, r = Array.isArray(e.choices) ? e.choices : [], n = r[0] && typeof r[0] == "object" && !Array.isArray(r[0]) ? r[0] : null, i = n != null && n.message && typeof n.message == "object" && !Array.isArray(n.message) ? n.message : null, o = typeof (i == null ? void 0 : i.refusal) == "string" ? i.refusal.trim() : "";
  if (o) throw new Error(o);
  const a = typeof (i == null ? void 0 : i.content) == "string" ? i.content.trim() : "";
  if (!a) throw new Error("OpenAI returned no text output.");
  if ((n == null ? void 0 : n.finish_reason) === "length")
    throw new Error("The model hit its output limit mid-answer. Try shotlisting one scene at a time.");
  return a;
}
async function Rg(t) {
  const e = t.apiKey.trim();
  if (!e) throw new Error("No OpenAI API key provided.");
  const r = t.userMessage.trim();
  if (!r) throw new Error("No OpenAI prompt provided.");
  const n = t.fetchImpl ?? globalThis.fetch;
  if (typeof n != "function") throw new Error("This runtime does not provide fetch.");
  const i = await n(Eg, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${e}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(Ag({
      model: t.model,
      systemPrompt: t.systemPrompt,
      userMessage: r,
      imageUrls: t.imageUrls,
      maxCompletionTokens: t.maxCompletionTokens,
      reasoningEffort: t.reasoningEffort,
      jsonObject: t.jsonObject
    }))
  }), o = await i.text();
  let a = o;
  if (o)
    try {
      a = JSON.parse(o);
    } catch {
    }
  if (!i.ok)
    throw new Error(kg(a, `OpenAI request failed (${i.status}).`));
  const s = vg(a);
  return {
    message: jg(a),
    ...s ? { usage: Tg(s) } : {}
  };
}
function Pg(t) {
  return t.startsWith("local-media://file") ? decodeURIComponent(t.replace(/^local-media:\/\/file/, "")) : null;
}
const Og = "http://localhost:3000", Gl = "https://cinegen-film.vercel.app", Xi = "persist:cinegen-team-workspace", Ng = 8e3, pi = "__CINEGEN_TEAM_PROVIDER__", Ge = { origin: Gl, source: "hosted" }, Fn = { origin: Og, source: "local-web" };
let Ne = null, gt = null, er = null;
function Gr() {
  return {
    supported: !0,
    scope: "workspace",
    providers: ["fal", "openai", "kie", "runpod", "huggingface"].map((t) => ({
      id: t,
      connected: !1
    })),
    desktop: {
      connected: !1,
      requiresLogin: !0,
      source: "none",
      label: "Connect the hosted team workspace"
    }
  };
}
async function Cg(t) {
  if (!(t.headers.get("content-type") || "").toLowerCase().includes("application/json")) return null;
  try {
    return await t.json();
  } catch {
    return null;
  }
}
async function sn(t, e, r, n) {
  const i = new AbortController(), o = setTimeout(() => i.abort(), Ng);
  try {
    const a = `${t.origin}/api/rpc/${encodeURIComponent(e)}/${encodeURIComponent(r)}`, s = {
      method: "POST",
      headers: { "Content-Type": "application/json", ...t.source === "hosted" ? { Origin: t.origin } : {} },
      body: JSON.stringify({ args: n }),
      credentials: "include",
      // RPC payloads can contain provider credentials. Never forward their
      // request bodies through an unexpected redirect.
      redirect: "error",
      signal: i.signal
    }, l = t.source === "hosted" ? await Ha.fromPartition(Xi).fetch(a, s) : await fetch(a, s);
    return { response: l, payload: await Cg(l) };
  } finally {
    clearTimeout(o);
  }
}
function Hl(t, e) {
  return {
    ...t,
    desktop: {
      connected: !0,
      requiresLogin: !1,
      source: e.source,
      label: e.source === "hosted" ? "Hosted team workspace" : "Local browser workspace"
    }
  };
}
async function hr(t) {
  try {
    const { response: e, payload: r } = await sn(t, "providers", "status", []);
    return !e.ok || !(r != null && r.ok) || !r.result ? null : Hl(r.result, t);
  } catch {
    return null;
  }
}
async function ln() {
  if (Ne) {
    const r = await hr(Ne);
    if (r) return { target: Ne, status: r };
    Ne = null;
  }
  const t = await hr(Ge);
  if (t)
    return Ne = Ge, { target: Ge, status: t };
  const e = await hr(Fn);
  return e ? (Ne = Fn, { target: Fn, status: e }) : null;
}
async function qg(t, e, r) {
  var a;
  const n = await ln();
  if (!n)
    throw new Error("Connect CineGen Desktop to the hosted team workspace in Settings first.");
  const { response: i, payload: o } = await sn(n.target, t, e, r);
  if (!i.ok || !(o != null && o.ok))
    throw new Error(((a = o == null ? void 0 : o.error) == null ? void 0 : a.message) || `The team workspace request failed (${i.status}).`);
  return o.result;
}
async function ja(t, e) {
  var o;
  const r = await ln();
  if (!r)
    throw new Error("Connect CineGen Desktop to the hosted team workspace in Settings first.");
  const { response: n, payload: i } = await sn(r.target, "providers", t, [e]);
  if (!n.ok || !(i != null && i.ok) || !i.result)
    throw new Error(((o = i == null ? void 0 : i.error) == null ? void 0 : o.message) || `The team workspace request failed (${n.status}).`);
  return Hl(i.result, r.target);
}
async function Lg() {
  var i, o;
  const t = await Lm();
  if (!t || !("client" in t))
    throw new Error("Connect Topview MCP in CineGen Desktop before sharing it with the team.");
  let e = await ln();
  if (!e || e.target.source !== "hosted") {
    const a = await zl();
    (i = a.desktop) != null && i.connected && a.desktop.source === "hosted" && (e = { target: Ge, status: a });
  }
  if (!e || e.target.source !== "hosted")
    throw new Error("CineGen team sign-in was not completed. Sign in in the window that opened, then choose Share MCP with team again.");
  const { response: r, payload: n } = await sn(e.target, "topview", "importTeamConnection", [t]);
  if (!r.ok || !(n != null && n.ok) || !n.result)
    throw new Error(((o = n == null ? void 0 : n.error) == null ? void 0 : o.message) || `Topview MCP could not be shared (${r.status}).`);
  return n.result;
}
async function Ug(t) {
  return qg("llm", "openaiChat", [{ ...t, apiKey: pi }]);
}
async function zl() {
  const t = await hr(Ge);
  if (t)
    return Ne = Ge, t;
  if (er)
    return gt && !gt.isDestroyed() && gt.focus(), er;
  const e = new Q({
    width: 720,
    height: 820,
    minWidth: 520,
    minHeight: 640,
    title: "Connect CineGen Team Workspace",
    autoHideMenuBar: !0,
    webPreferences: {
      partition: Xi,
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !0
    }
  });
  gt = e;
  const r = Gl, n = new Promise((i, o) => {
    let a = !1, s = !1, l = null, u = null;
    const d = () => {
      l && clearInterval(l), u && clearTimeout(u), l = null, u = null;
    }, c = (m) => {
      a || (a = !0, d(), i(m));
    }, p = (m) => {
      a || (a = !0, d(), o(m));
    }, f = async () => {
      if (!(s || a)) {
        s = !0;
        try {
          const m = await hr(Ge);
          if (a || !m) return;
          Ne = Ge, c(m), e.isDestroyed() || e.close();
        } finally {
          s = !1;
        }
      }
    };
    e.webContents.on("did-finish-load", () => void f()), e.on("closed", () => {
      gt === e && (gt = null), l && (clearInterval(l), l = null), !a && (async () => {
        for (; s && !a; )
          await new Promise((m) => setTimeout(m, 50));
        a || (await f(), a || c(Gr()));
      })();
    }), l = setInterval(() => void f(), 1e3), u = setTimeout(() => {
      c(Gr()), e.isDestroyed() || e.close();
    }, 600 * 1e3), e.loadURL(r).catch((m) => {
      p(m), e.isDestroyed() || e.close();
    });
  });
  er = n;
  try {
    return await n;
  } finally {
    er === n && (er = null);
  }
}
function Mg() {
  I.handle("team-providers:status", async () => {
    const t = await ln();
    return (t == null ? void 0 : t.status) ?? Gr();
  }), I.handle("team-providers:connect", () => zl()), I.handle("team-providers:disconnect", async () => (await Ha.fromPartition(Xi).clearStorageData({ storages: ["cookies", "indexdb", "localstorage"] }), Ne = null, Gr())), I.handle("team-providers:save", async (t, e) => ja("save", e)), I.handle("team-providers:remove", async (t, e) => ja("remove", e)), I.handle("team-providers:share-topview", () => Lg());
}
function Dg(t) {
  const e = w.extname(t).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : e === ".gif" ? "image/gif" : "image/jpeg";
}
function $g(t) {
  const e = t.trim();
  if (!e) return null;
  if (/^data:image\//i.test(e) || /^https?:\/\//i.test(e)) return e;
  const r = Pg(e) ?? (e.startsWith("/") || /^[A-Za-z]:[\\/]/.test(e) ? e : null);
  if (!r || !D.existsSync(r)) return null;
  const n = D.readFileSync(r);
  return `data:${Dg(r)};base64,${n.toString("base64")}`;
}
function Fg(t) {
  return Array.isArray(t) ? t.flatMap((e) => {
    if (typeof e != "string") return [];
    const r = $g(e);
    return r ? [r] : [];
  }) : [];
}
function Bg() {
  I.handle("llm:openai-chat", async (t, e) => {
    const r = e && typeof e == "object" && !Array.isArray(e) ? e : {}, n = typeof r.apiKey == "string" ? r.apiKey : "", i = typeof r.userMessage == "string" ? r.userMessage : "", o = Fg(r.imageUrls);
    return n === pi ? Ug({
      ...r,
      apiKey: pi,
      userMessage: i,
      imageUrls: o
    }) : Rg({
      apiKey: n,
      model: typeof r.model == "string" ? r.model : void 0,
      systemPrompt: typeof r.systemPrompt == "string" ? r.systemPrompt : void 0,
      userMessage: i,
      imageUrls: o,
      maxCompletionTokens: typeof r.maxCompletionTokens == "number" ? r.maxCompletionTokens : void 0,
      jsonObject: r.jsonObject === !1 ? !1 : void 0
    });
  }), I.handle("llm:openai-realtime-session", async (t, e) => {
    var c;
    const r = e && typeof e == "object" && !Array.isArray(e) ? e : {}, n = typeof r.apiKey == "string" ? r.apiKey.trim() : "", i = typeof r.sdp == "string" ? r.sdp : "", o = /* @__PURE__ */ new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]), a = typeof r.voice == "string" && o.has(r.voice) ? r.voice : "cedar";
    if (!n) throw new Error("Add an OpenAI API key in Settings to use Voice Director.");
    if (!i || i.length > 1e6) throw new Error("Voice Director received an invalid audio session offer.");
    const s = JSON.stringify({
      type: "realtime",
      model: "gpt-realtime-2.1",
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: !0,
            interrupt_response: !0
          }
        },
        output: { voice: a }
      }
    }), l = new FormData();
    l.set("sdp", i), l.set("session", s);
    const u = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${n}`,
        "OpenAI-Safety-Identifier": "cinegen-desktop-user"
      },
      body: l
    }), d = await u.text();
    if (!u.ok) {
      let p = `OpenAI Realtime failed (${u.status}).`;
      try {
        const f = JSON.parse(d);
        (c = f.error) != null && c.message && (p = f.error.message);
      } catch {
      }
      throw new Error(p);
    }
    return { sdp: d };
  });
}
const Vg = /* @__PURE__ */ new Set(["authCancel", "authLogin", "authStatus", "accountStatus", "connect", "disconnect", "voices", "generate", "job", "design", "saveVoice", "enhance"]);
function Gg() {
  I.handle("elevenlabs:request", async (t, e, r, n) => {
    var a;
    if (!Vg.has(e) || typeof n != "string" || !n || n.length > 12e3) throw new Error("Invalid ElevenLabs request.");
    const i = await fetch(`https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/elevenlabs/${e}`, { method: "POST", headers: { "content-type": "application/json", "x-cinegen-id-token": n, "x-cinegen-origin": "https://cinegen-film.vercel.app" }, body: JSON.stringify({ args: r === void 0 ? [] : [r] }), signal: AbortSignal.timeout(24e4) }), o = await i.json();
    if (!i.ok || !o.ok) throw new Error(((a = o.error) == null ? void 0 : a.message) || "ElevenLabs could not complete this request.");
    if (e === "authLogin") {
      const s = new URL(o.result.authorizationUrl);
      if (s.origin !== "https://cinegen-api.christopherjohnogden.workers.dev" || s.pathname !== "/api/elevenlabs/oauth/start") throw new Error("Invalid ElevenLabs sign-in address.");
      await Jr.openExternal(s.href);
    }
    return o.result;
  });
}
function Hg() {
  I.handle("prompts:rewrite", async (t, e, r) => {
    var o;
    if (typeof r != "string" || !r || r.length > 12e3) throw new Error("Sign in to CineGen to edit prompts with AI.");
    const n = await fetch("https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/prompts/rewrite", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cinegen-id-token": r, "x-cinegen-origin": "https://cinegen-film.vercel.app" },
      body: JSON.stringify({ args: [e] }),
      signal: AbortSignal.timeout(24e4)
    }), i = await n.json();
    if (!n.ok || !i.ok) throw new Error(((o = i.error) == null ? void 0 : o.message) || "The AI editor could not connect. Try again to recover this rewrite.");
    return i.result;
  });
}
const Wl = Lt(Ce), zg = 90;
function kt(t) {
  const e = t.trim();
  if (!e) return null;
  const r = [
    e,
    w.resolve(e)
  ];
  for (const n of r)
    if (D.existsSync(n)) return n;
  return null;
}
async function Xl(t, e, r, n) {
  const i = ve(), o = Math.max(0, e), a = Math.max(0.1, Math.min(r, zg));
  try {
    return await Wl(i, [
      "-y",
      "-ss",
      `${o}`,
      "-i",
      t,
      "-t",
      `${a}`,
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
      n
    ], { timeout: Math.max(12e4, Math.ceil(a * 4e3)) }), D.existsSync(n) ? n : null;
  } catch {
    return null;
  }
}
async function Ur(t, e, r) {
  const n = ve();
  try {
    return await Wl(n, [
      "-y",
      "-ss",
      `${Math.max(0, e)}`,
      "-i",
      t,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      r
    ], { timeout: 15e3 }), D.existsSync(r) ? r : null;
  } catch {
    return null;
  }
}
function mi(t) {
  return J.createHash("sha1").update(JSON.stringify({
    label: t.label,
    fileRef: t.fileRef,
    trimStartSec: t.trimStartSec,
    trimDurationSec: t.trimDurationSec
  })).digest("hex").slice(0, 12);
}
function Jl(t) {
  return /\s/.test(t);
}
function Kl(t, e) {
  try {
    if (D.existsSync(e)) return e;
    try {
      D.linkSync(t, e);
    } catch {
      D.copyFileSync(t, e);
    }
    return D.existsSync(e) ? e : null;
  } catch {
    return null;
  }
}
function Bn(t, e, r) {
  if (!Jl(t))
    return { mediaPath: t, ephemeral: !1 };
  const n = w.extname(t) || (e.mediaType === "image" ? ".jpg" : ".mp4"), i = w.join(r, `${mi(e)}-source${n}`), o = Kl(t, i);
  return o ? { mediaPath: o, ephemeral: !0 } : null;
}
async function Ji(t, e) {
  const r = w.join(e, "visual-refs");
  D.mkdirSync(r, { recursive: !0 });
  const n = [];
  for (const i of t) {
    const o = kt(i.fileRef);
    if (!o) continue;
    if (i.mediaType === "image") {
      const d = Bn(o, i, r);
      if (!d) continue;
      n.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: d.mediaPath,
        ephemeral: d.ephemeral
      });
      continue;
    }
    if (i.trimStartSec !== void 0 && i.trimDurationSec !== void 0) {
      const d = w.join(r, `${mi(i)}.mp4`), c = await Xl(
        o,
        i.trimStartSec,
        i.trimDurationSec,
        d
      );
      if (c) {
        n.push({
          label: i.label,
          kind: i.kind,
          mediaType: "video",
          mediaPath: c,
          ephemeral: !0
        });
        continue;
      }
    }
    const a = w.extname(o).toLowerCase();
    if ([".mp4", ".mov", ".webm", ".m4v", ".avi"].includes(a)) {
      const d = Bn(o, i, r);
      if (!d) continue;
      n.push({
        label: i.label,
        kind: i.kind,
        mediaType: "video",
        mediaPath: d.mediaPath,
        ephemeral: d.ephemeral
      });
      continue;
    }
    const s = (i.framePaths ?? []).map((d) => kt(d)).find(Boolean);
    if (s) {
      const d = Bn(s, {
        ...i,
        mediaType: "image",
        fileRef: s
      }, r);
      if (!d) continue;
      n.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: d.mediaPath,
        ephemeral: d.ephemeral
      });
      continue;
    }
    const l = w.join(r, `${mi(i)}.jpg`), u = await Ur(o, i.trimStartSec ?? 0, l);
    u && n.push({
      label: i.label,
      kind: i.kind,
      mediaType: "image",
      mediaPath: u,
      ephemeral: !0
    });
  }
  return n;
}
function Yl(t, e) {
  if (e.length === 0) return t.trim();
  const r = e.map((o) => `@${o.mediaPath}`).join(" "), n = t.trim();
  return e.some((o) => o.mediaType === "video") ? n ? `${r} ${n}` : `${r} describe this video in detail. Include what you see on screen, the setting, actions, and any spoken audio.` : n ? `${r} ${n}` : `${r} describe this image in detail.`;
}
function Ki(t) {
  for (const e of t)
    if (e.ephemeral)
      try {
        D.unlinkSync(e.mediaPath);
      } catch {
      }
}
function Ql(t) {
  const e = t.trim();
  if (!e) return null;
  if (e.startsWith("local-media://file/")) {
    const r = decodeURIComponent(e.replace("local-media://file", ""));
    return kt(r);
  }
  if (e.startsWith("file://"))
    try {
      return kt(decodeURIComponent(new URL(e).pathname));
    } catch {
      return null;
    }
  return kt(e);
}
async function Wg(t, e) {
  const r = Ql(t);
  if (!r) throw new Error(`Could not resolve a local source file for: ${t}`);
  const n = w.join(z.tmpdir(), "cinegen-higgsfield-refs");
  D.mkdirSync(n, { recursive: !0 });
  const i = J.randomBytes(6).toString("hex"), o = Math.max(0, e.sourceStartSec ?? 0), a = e.sourceEndSec ?? o;
  if (e.mode === "first-last") {
    const d = w.join(n, `${i}-first.jpg`), c = w.join(n, `${i}-last.jpg`), p = await Ur(r, o, d), f = await Ur(r, Math.max(o, a - 0.05), c), m = [], y = [];
    if (p && (m.push(p), y.push("start_image")), f && (m.push(f), y.push("end_image")), m.length === 0) throw new Error("Failed to extract first/last frames");
    return { paths: m, roles: y };
  }
  if (e.mode === "segment") {
    const d = w.join(n, `${i}-segment.mp4`), c = Math.max(0.1, a > o ? a - o : e.maxSegmentSec ?? 30), p = await Xl(r, o, Math.min(c, e.maxSegmentSec ?? 30), d);
    if (!p) throw new Error("Failed to extract clip segment");
    return { paths: [p], roles: ["image"] };
  }
  const s = e.frameTimeSec ?? (a > o ? (o + a) / 2 : o), l = w.join(n, `${i}-frame.jpg`), u = await Ur(r, s, l);
  if (!u) throw new Error("Failed to extract reference frame");
  return { paths: [u], roles: ["image"] };
}
function Xg(t) {
  return /\b(cannot|can't|do not have the ability|unable to|not able to)\b[\s\S]{0,100}\b(video|visual|auditory|audio|mp4|mov|footage|media file)\b/i.test(t) || /\btools do not allow\b[\s\S]{0,60}\b(video|visual|auditory|mp4)\b/i.test(t);
}
class Hr extends Error {
}
const Jg = 18e4, Kg = 600 * 1e3;
async function Zl(t) {
  var d;
  const e = await an("gemini");
  if (!e)
    throw new Hr("Gemini CLI is not installed.");
  const r = kt(t.mediaPath);
  if (!r)
    throw new Error(`Media file not found: ${t.mediaPath}`);
  const n = w.join(z.tmpdir(), "cinegen-gemini-acoustic");
  await at(n, { recursive: !0 });
  let i = r, o = !1;
  if (Jl(r)) {
    const c = w.extname(r) || ".mp4", p = w.join(n, `${J.randomUUID()}${c}`), f = Kl(r, p);
    if (!f)
      throw new Error("Could not stage the media file for Gemini analysis.");
    i = f, o = !0;
  }
  const a = ((d = t.model) == null ? void 0 : d.trim()) || "gemini-2.5-flash", l = [
    "--skip-trust",
    "-p",
    `@${i} ${t.prompt.trim()}`,
    "-o",
    "stream-json",
    "-m",
    a,
    "--approval-mode",
    "auto_edit",
    "--session-id",
    J.randomUUID(),
    "--include-directories",
    w.dirname(i)
  ], u = () => {
    if (o)
      try {
        D.unlinkSync(i);
      } catch {
      }
  };
  return new Promise((c, p) => {
    var E, x;
    const f = ae(e, l, { env: $l(), cwd: n, stdio: ["ignore", "pipe", "pipe"] });
    let m = "", y = "", h = "", g = !1, _ = !1;
    const b = (S) => {
      g || (g = !0, clearTimeout(v), clearTimeout(T), u(), S());
    }, v = setTimeout(() => {
      f.kill("SIGTERM"), b(() => p(new Error("Gemini CLI media analysis timed out.")));
    }, Kg), T = setTimeout(() => {
      _ || (f.kill("SIGTERM"), b(() => p(new Error("Gemini CLI is still reading the media file. Try a shorter clip."))));
    }, Jg);
    (E = f.stdout) == null || E.on("data", (S) => {
      h += S.toString();
      let A;
      for (; (A = h.indexOf(`
`)) >= 0; ) {
        const O = h.slice(0, A).trim();
        if (h = h.slice(A + 1), !!O)
          try {
            const C = JSON.parse(O);
            C.type === "message" && C.role === "assistant" && typeof C.content == "string" && C.content && (_ = !0, m += C.content), C.type === "error" && typeof C.message == "string" && (y += C.message);
          } catch {
          }
      }
    }), (x = f.stderr) == null || x.on("data", (S) => {
      y += S.toString();
    }), f.on("error", (S) => b(() => p(S))), f.on("close", (S) => {
      const A = m.trim();
      if (!A) {
        const O = ci(y.trim()) || `Gemini CLI exited with code ${S ?? "unknown"}`;
        b(() => p(new Error(O)));
        return;
      }
      if (Xg(A)) {
        b(() => p(new Hr("Gemini CLI declined to analyze the media.")));
        return;
      }
      b(() => c(A));
    });
  });
}
const Ra = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GeminiMediaUnavailableError: Hr,
  analyzeMediaWithGeminiCli: Zl,
  buildGeminiUserMessageWithVisualRefs: Yl,
  cleanupEphemeralVisualRefs: Ki,
  prepareClipReference: Wg,
  prepareCopilotVisualRefs: Ji,
  resolveLocalSourcePath: Ql
}, Symbol.toStringTag, { value: "Module" }));
let be = null;
const Yg = 9e4, Qg = 18e4, Zg = 8e3;
function eu() {
  return w.join(W.getPath("userData"), "gemini-cli-workspace");
}
function ey() {
  return w.join(z.tmpdir(), "cinegen-gemini-visual-refs");
}
function ty(t) {
  var n;
  const e = [];
  if ((n = t.systemPrompt) != null && n.trim())
    if (t.injectProjectContext) {
      const i = t.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "";
      e.push(`${i}${t.systemPrompt.trim()}

${t.purpose === "enhance-prompt" ? Vl : Bl}`);
    } else
      e.push(t.systemPrompt.trim());
  const r = (t.messages ?? []).filter((i) => i.content.trim());
  return r.length > 0 ? e.length > 0 ? `${e.join(`

`)}

${fi(r)}` : fi(r) : e.length > 0 ? `${e.join(`

`)}

User:
${t.userMessage.trim()}

Assistant:
` : t.userMessage.trim();
}
function ry(t) {
  var r;
  const e = [
    (r = t.systemPrompt) == null ? void 0 : r.trim(),
    lg
  ].filter(Boolean).join(`

`);
  return e ? `${e}

User:
${t.userMessage.trim()}

Assistant:
` : `${t.userMessage.trim()}

Assistant:
`;
}
function ny(t) {
  const e = t.stats;
  if (!e) return;
  const r = Number(e.input_tokens) || 0, n = Number(e.output_tokens) || 0, i = Number(e.total_tokens) || r + n;
  if (!(i <= 0))
    return { promptTokens: r, completionTokens: n, totalTokens: i, cost: 0 };
}
function iy(t) {
  if (typeof t != "string" || !t.trim()) return "Gemini CLI is working…";
  const e = t.replace(/_/g, " ").toLowerCase();
  return e.includes("read") && e.includes("file") ? "Gemini CLI: Reading attached video…" : `Gemini CLI: ${t.replace(/_/g, " ")}…`;
}
function oy(t) {
  return /malformed tool call|empty response|API Error|INVALID_ARGUMENT/i.test(t);
}
function ay(t) {
  return /no previous sessions found/i.test(t);
}
async function Pa(t, e, r) {
  var h;
  const n = await an("gemini");
  if (!n)
    throw new Error("Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli");
  const i = ((h = e.model) == null ? void 0 : h.trim().replace(/^[^/]+\//, "")) || "gemini-2.5-flash", o = r.canResume ? ry(e) : ty(e), a = o.length > Zg, s = eu();
  await at(s, { recursive: !0 });
  const l = [
    "--skip-trust",
    ...a ? ["-p", ""] : ["-p", o],
    "-o",
    "stream-json",
    "-m",
    i,
    "--approval-mode",
    r.hasVisualRefs ? "yolo" : "default"
  ];
  if (r.hasVisualRefs) {
    l.push("--session-id", J.randomUUID());
    const g = [...new Set(
      r.preparedVisualRefs.map((_) => w.dirname(_.mediaPath))
    )];
    for (const _ of g)
      l.push("--include-directories", _);
  } else r.canResume && e.resumeSessionId && l.push("-r", e.resumeSessionId);
  const u = Fl();
  let d = "", c = "", p, f;
  const m = 900 * 1e3, y = r.hasVisualRefs ? Qg : Yg;
  return new Promise((g, _) => {
    var O, C, L, V;
    const b = ae(n, l, {
      env: $l(),
      cwd: s,
      stdio: a ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    a && ((O = b.stdin) == null || O.write(o), (C = b.stdin) == null || C.end()), be = { child: b, requestId: t, provider: "gemini" };
    let v = "", T = !1, E = !1;
    const x = (H) => {
      T || (T = !0, clearTimeout(S), clearTimeout(A), Ki(r.preparedVisualRefs), H());
    }, S = setTimeout(() => {
      be = null, b.kill("SIGTERM"), x(() => _(new Error("Gemini CLI timed out after 15 minutes. Try again or switch models.")));
    }, m), A = setTimeout(() => {
      E || T || (be = null, b.kill("SIGTERM"), x(() => _(new Error(
        r.hasVisualRefs ? "Gemini CLI is still reading the attached video. Try again or use a shorter clip." : "Gemini CLI is taking too long to respond. Try gemini-2.5-flash, shorten the question, or start a new chat."
      ))));
    }, y);
    (L = b.stdout) == null || L.on("data", (H) => {
      v += H.toString();
      let B;
      for (; (B = v.indexOf(`
`)) >= 0; ) {
        const R = v.slice(0, B).trim();
        if (v = v.slice(B + 1), !!R)
          try {
            const N = JSON.parse(R);
            N.type === "init" && typeof N.session_id == "string" && (p = N.session_id);
            const G = ny(N);
            if (G && (f = G), N.type === "tool_use" && (u == null || u.webContents.send("llm:gemini-stream", {
              requestId: t,
              status: iy(N.tool_name)
            })), N.type === "message" && N.role === "assistant" && typeof N.content == "string") {
              const k = N.content;
              k && (E = !0, d += k, u == null || u.webContents.send("llm:gemini-stream", { requestId: t, token: k }));
            }
            if (N.type === "error" && typeof N.message == "string") {
              const k = N.message;
              c += k, !d.trim() && oy(k) && (be = null, b.kill("SIGTERM"), x(() => _(new Error(ci(k)))));
            }
            if (N.type === "result" && N.status === "error") {
              const k = typeof N.error == "string" ? N.error : typeof N.message == "string" ? N.message : "Gemini CLI returned an error.";
              c += k;
            }
          } catch {
          }
      }
    }), (V = b.stderr) == null || V.on("data", (H) => {
      c += H.toString();
    }), b.on("error", (H) => {
      be = null, x(() => _(H));
    }), b.on("close", (H) => {
      be = null, u == null || u.webContents.send("llm:gemini-stream", { requestId: t, done: !0 });
      const B = d.trim();
      if (!B) {
        const R = ci(c.trim()) || `Gemini CLI exited with code ${H ?? "unknown"}`;
        x(() => _(new Error(R)));
        return;
      }
      x(() => g({
        message: B,
        sessionId: p,
        usage: f,
        resumed: r.canResume
      }));
    });
  });
}
async function sy(t, e) {
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const r = eu(), n = ey();
  await at(r, { recursive: !0 }), await at(n, { recursive: !0 });
  const i = await Ji(e.visualRefs ?? [], n);
  if ((e.visualRefs ?? []).length > 0 && i.length === 0)
    throw new Error("Could not load the attached /clip or /asset files for Gemini visual analysis. Use local video or image files.");
  const o = i.length > 0, a = {
    ...e,
    userMessage: Yl(e.userMessage, i)
  }, s = !!e.resumeSessionId && !e.injectProjectContext && !o;
  try {
    return await Pa(t, a, {
      canResume: s,
      hasVisualRefs: o,
      preparedVisualRefs: i
    });
  } catch (l) {
    const u = l instanceof Error ? l.message : String(l);
    if (!s || !ay(u))
      throw l;
    return Pa(t, {
      ...a,
      injectProjectContext: !o,
      contextRefresh: !o,
      resumeSessionId: void 0
    }, {
      canResume: !1,
      hasVisualRefs: o,
      preparedVisualRefs: i
    });
  }
}
function ly() {
  I.handle("llm:gemini-chat", async (t, e) => {
    const r = e.requestId || J.randomUUID(), n = await sy(r, e);
    return {
      message: n.message,
      sessionId: n.sessionId,
      resumed: n.resumed,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), I.handle("llm:gemini-cancel", async (t, e) => {
    (be == null ? void 0 : be.requestId) !== e || be.provider !== "gemini" || (be.child.kill("SIGTERM"), be = null);
  });
}
const uy = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;
function dy(t, e) {
  const r = [];
  e && (r.push("I have a video that needs a music soundtrack. I've attached frames from the video for you to analyze."), r.push("Look at the visual content, mood, pacing, and subject matter to inform the music style."));
  const n = [];
  return t.genre && n.push(`Genre: ${t.genre}`), t.style && n.push(`Style: ${t.style}`), t.mood && n.push(`Mood: ${t.mood}`), t.tempo && n.push(`Tempo: ${t.tempo}`), t.additionalNotes && n.push(`Notes: ${t.additionalNotes}`), n.length > 0 && r.push(`User preferences:
` + n.join(`
`)), r.push("Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else."), r.join(`

`);
}
function cy() {
  I.handle("music:generate-prompt", async (t, e) => {
    const r = e.apiKey;
    if (!r) throw new Error("No fal.ai API key provided.");
    K.fal.config({ credentials: r });
    const n = e.frameUrls && e.frameUrls.length > 0, i = dy(e, !!n), o = {
      model: "google/gemini-flash-1.5",
      system_prompt: uy,
      prompt: i,
      max_tokens: 300
    }, a = n ? "fal-ai/any-llm/vision" : "fal-ai/any-llm";
    return n && (o.image_urls = e.frameUrls), { prompt: ((await K.fal.subscribe(a, { input: o, logs: !0 })).data.output ?? "").trim() };
  });
}
function fy() {
  I.handle("dialog:show-save", async (t, e) => {
    const r = Q.getFocusedWindow();
    if (!r) return null;
    const n = await io.showSaveDialog(r, {
      defaultPath: e == null ? void 0 : e.defaultPath,
      filters: e == null ? void 0 : e.filters
    });
    return n.canceled ? null : n.filePath;
  }), I.handle("dialog:show-open", async (t, e) => {
    var i;
    const r = Q.getFocusedWindow();
    if (!r) return null;
    const n = await io.showOpenDialog(r, {
      filters: e == null ? void 0 : e.filters,
      properties: (e == null ? void 0 : e.properties) ?? ["openFile"]
    });
    return n.canceled ? null : (i = e == null ? void 0 : e.properties) != null && i.includes("multiSelections") ? n.filePaths : n.filePaths[0];
  }), I.handle("shell:open-path", async (t, e) => await Jr.openPath(e));
}
const py = {
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
function Ut(t, e) {
  const r = py[e], n = Object.entries(t).filter(
    ([a]) => a !== "id" && (!r || r.has(a))
  );
  if (n.length === 0) throw new Error("No valid fields to update");
  const i = n.map(([a]) => `${a} = ?`).join(", "), o = n.map(([, a]) => a);
  return { setClauses: i, values: o };
}
function tu(t, e) {
  return t.run(
    `INSERT INTO projects (id, name, created_at, updated_at, resolution_width, resolution_height, frame_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.name,
      e.created_at,
      e.updated_at,
      e.resolution_width,
      e.resolution_height,
      e.frame_rate
    ]
  );
}
function ru(t, e) {
  return t.queryOne("SELECT * FROM projects WHERE id = ?", [e]);
}
function nu(t, e, r) {
  const { setClauses: n, values: i } = Ut(r, "projects");
  return t.run(`UPDATE projects SET ${n} WHERE id = ?`, [...i, e]);
}
function iu(t, e) {
  return t.query("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at", [
    e
  ]);
}
function ou(t, e) {
  return t.run(
    `INSERT INTO assets
       (id, project_id, name, type, file_ref, original_path, source_url, thumbnail_url,
        duration, width, height, fps, codec, file_size, checksum, proxy_ref,
        status, metadata, folder_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.project_id,
      e.name,
      e.type,
      e.file_ref,
      e.original_path,
      e.source_url,
      e.thumbnail_url,
      e.duration,
      e.width,
      e.height,
      e.fps,
      e.codec,
      e.file_size,
      e.checksum,
      e.proxy_ref,
      e.status,
      e.metadata,
      e.folder_id,
      e.created_at
    ]
  );
}
function zr(t, e, r) {
  const { setClauses: n, values: i } = Ut(r, "assets");
  return t.run(`UPDATE assets SET ${n} WHERE id = ?`, [...i, e]);
}
function au(t, e) {
  return t.run("DELETE FROM assets WHERE id = ?", [e]);
}
function my(t, e) {
  return t.query(
    "SELECT * FROM media_folders WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function hy(t, e) {
  return t.run(
    `INSERT INTO media_folders (id, project_id, name, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.parent_id, e.created_at]
  );
}
function gy(t, e, r) {
  const { setClauses: n, values: i } = Ut(r, "media_folders");
  return t.run(`UPDATE media_folders SET ${n} WHERE id = ?`, [...i, e]);
}
function yy(t, e) {
  return t.query(
    "SELECT * FROM timelines WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function su(t, e) {
  return t.run(
    `INSERT INTO timelines (id, project_id, name, duration, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.duration, e.created_at]
  );
}
function _y(t, e, r) {
  const { setClauses: n, values: i } = Ut(r, "timelines");
  return t.run(`UPDATE timelines SET ${n} WHERE id = ?`, [...i, e]);
}
function wy(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE timeline_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE timeline_id = ?", [e]), t.run("DELETE FROM tracks WHERE timeline_id = ?", [e]), t.run("DELETE FROM transitions WHERE timeline_id = ?", [e]), t.run("DELETE FROM timelines WHERE id = ?", [e]);
  });
}
function by(t, e) {
  return t.query(
    "SELECT * FROM tracks WHERE timeline_id = ? ORDER BY sort_order",
    [e]
  );
}
function hi(t, e) {
  return t.run(
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
      e.id,
      e.timeline_id,
      e.name,
      e.kind,
      e.color,
      e.muted,
      e.solo,
      e.locked,
      e.visible,
      e.volume,
      e.sort_order
    ]
  );
}
function vy(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE track_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE track_id = ?", [e]), t.run("DELETE FROM tracks WHERE id = ?", [e]);
  });
}
function Ty(t, e) {
  return t.query(
    "SELECT * FROM clips WHERE timeline_id = ? ORDER BY start_time",
    [e]
  );
}
function Ey(t, e) {
  return t.run(
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
      e.id,
      e.timeline_id,
      e.track_id,
      e.asset_id,
      e.name,
      e.start_time,
      e.duration,
      e.trim_start,
      e.trim_end,
      e.speed,
      e.opacity,
      e.volume,
      e.flip_h,
      e.flip_v,
      e.linked_clip_id,
      e.created_at
    ]
  );
}
function Sy(t, e) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]), t.run("DELETE FROM clips WHERE id = ?", [e]);
  });
}
function Iy(t, e) {
  return t.query(
    "SELECT * FROM keyframes WHERE clip_id = ? ORDER BY time",
    [e]
  );
}
function xy(t, e, r) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]);
    for (const n of r)
      t.run(
        "INSERT INTO keyframes (id, clip_id, time, property, value) VALUES (?, ?, ?, ?, ?)",
        [nr(), n.clip_id, n.time, n.property, n.value]
      );
  });
}
function Ay(t, e) {
  return t.query(
    "SELECT * FROM transitions WHERE timeline_id = ?",
    [e]
  );
}
function ky(t, e) {
  return t.run(
    `INSERT INTO transitions (id, timeline_id, type, duration, clip_a_id, clip_b_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timeline_id = excluded.timeline_id,
       type        = excluded.type,
       duration    = excluded.duration,
       clip_a_id   = excluded.clip_a_id,
       clip_b_id   = excluded.clip_b_id`,
    [e.id, e.timeline_id, e.type, e.duration, e.clip_a_id, e.clip_b_id]
  );
}
function jy(t, e) {
  return t.run("DELETE FROM transitions WHERE id = ?", [e]);
}
function Ry(t, e) {
  const r = t.queryOne(
    "SELECT nodes, edges FROM workflow_state WHERE project_id = ?",
    [e]
  );
  if (!r) return { nodes: [], edges: [] };
  const n = JSON.parse(r.nodes), i = JSON.parse(r.edges);
  if (i && typeof i == "object" && !Array.isArray(i)) {
    const o = i;
    return {
      nodes: Array.isArray(n) ? n : [],
      edges: Array.isArray(o.edges) ? o.edges : [],
      spaces: Array.isArray(o.spaces) ? o.spaces : void 0,
      activeSpaceId: typeof o.activeSpaceId == "string" ? o.activeSpaceId : void 0,
      openSpaceIds: Array.isArray(o.openSpaceIds) ? o.openSpaceIds.filter((a) => typeof a == "string") : void 0,
      director: o.director
    };
  }
  return {
    nodes: Array.isArray(n) ? n : [],
    edges: Array.isArray(i) ? i : []
  };
}
function Py(t, e, r) {
  return t.run(
    `INSERT INTO workflow_state (project_id, nodes, edges)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       nodes = excluded.nodes,
       edges = excluded.edges`,
    [
      e,
      JSON.stringify(r.nodes),
      JSON.stringify({
        edges: r.edges,
        spaces: r.spaces ?? [],
        activeSpaceId: r.activeSpaceId ?? null,
        openSpaceIds: r.openSpaceIds ?? [],
        director: r.director ?? null
      })
    ]
  );
}
function Oy(t, e) {
  return t.query(
    "SELECT * FROM elements WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function Ny(t, e) {
  return t.run(
    `INSERT INTO elements (id, project_id, name, type, description, images, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.project_id,
      e.name,
      e.type,
      e.description,
      e.images,
      e.created_at,
      e.updated_at
    ]
  );
}
function Cy(t, e, r) {
  const { setClauses: n, values: i } = Ut(r, "elements");
  return t.run(`UPDATE elements SET ${n} WHERE id = ?`, [...i, e]);
}
function qy(t, e) {
  return t.run("DELETE FROM elements WHERE id = ?", [e]);
}
function Ly(t, e) {
  return t.query(
    "SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC",
    [e]
  );
}
function Uy(t, e) {
  return t.run(
    `INSERT INTO export_jobs
       (id, project_id, status, progress, preset, fps, output_path, file_size,
        error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.project_id,
      e.status,
      e.progress,
      e.preset,
      e.fps,
      e.output_path,
      e.file_size,
      e.error,
      e.created_at,
      e.completed_at
    ]
  );
}
function My(t, e, r) {
  const { setClauses: n, values: i } = Ut(r, "export_jobs");
  return t.run(`UPDATE export_jobs SET ${n} WHERE id = ?`, [...i, e]);
}
function Oa(t, e) {
  const r = ru(t, e);
  if (!r) throw new Error(`Project not found: ${e}`);
  const n = iu(t, e), i = my(t, e), o = Ry(t, e), a = Oy(t, e), s = Ly(t, e), u = yy(t, e).map((c) => {
    const p = by(t, c.id), f = Ty(t, c.id), m = Ay(t, c.id), y = f.map((h) => ({
      ...h,
      keyframes: Iy(t, h.id)
    }));
    return { ...c, tracks: p, clips: y, transitions: m };
  }), d = u.length > 0 ? u[0].id : "";
  return {
    project: r,
    assets: n,
    mediaFolders: i,
    timelines: u,
    activeTimelineId: d,
    workflow: o,
    elements: a,
    exports: s
  };
}
function Dy(t, e, r) {
  t.transaction(() => {
    ru(t, e) ? nu(t, e, {
      name: r.project.name,
      updated_at: pr(),
      resolution_width: r.project.resolution_width,
      resolution_height: r.project.resolution_height,
      frame_rate: r.project.frame_rate
    }) : tu(t, { ...r.project, updated_at: pr() });
    const i = new Set(
      t.query("SELECT id FROM media_folders WHERE project_id = ?", [e]).map((f) => f.id)
    ), o = new Set(r.mediaFolders.map((f) => f.id));
    for (const f of i)
      o.has(f) || (t.run("UPDATE assets SET folder_id = NULL WHERE folder_id = ?", [f]), t.run("DELETE FROM media_folders WHERE id = ?", [f]));
    for (const f of r.mediaFolders)
      i.has(f.id) ? gy(t, f.id, {
        name: f.name,
        parent_id: f.parent_id
      }) : hy(t, f);
    const a = new Set(
      t.query("SELECT id FROM assets WHERE project_id = ?", [e]).map((f) => f.id)
    ), s = new Set(r.assets.map((f) => f.id));
    for (const f of a)
      s.has(f) || au(t, f);
    for (const f of r.assets)
      if (a.has(f.id)) {
        const { id: m, project_id: y, created_at: h, ...g } = f;
        zr(t, f.id, g);
      } else
        ou(t, f);
    const l = new Set(
      t.query("SELECT id FROM timelines WHERE project_id = ?", [e]).map((f) => f.id)
    ), u = new Set(r.timelines.map((f) => f.id));
    for (const f of l)
      u.has(f) || wy(t, f);
    for (const f of r.timelines) {
      if (l.has(f.id))
        _y(t, f.id, { name: f.name, duration: f.duration });
      else {
        const { tracks: v, clips: T, transitions: E, ...x } = f;
        su(t, x);
      }
      const m = new Set(
        t.query("SELECT id FROM tracks WHERE timeline_id = ?", [f.id]).map((v) => v.id)
      ), y = new Set(f.tracks.map((v) => v.id));
      for (const v of m)
        y.has(v) || vy(t, v);
      for (const v of f.tracks)
        hi(t, v);
      const h = new Set(
        t.query("SELECT id FROM clips WHERE timeline_id = ?", [f.id]).map((v) => v.id)
      ), g = new Set(f.clips.map((v) => v.id));
      for (const v of h)
        g.has(v) || Sy(t, v);
      for (const v of f.clips) {
        const { keyframes: T, ...E } = v;
        Ey(t, E), xy(
          t,
          v.id,
          T.map(({ id: x, ...S }) => S)
        );
      }
      const _ = new Set(
        t.query("SELECT id FROM transitions WHERE timeline_id = ?", [f.id]).map((v) => v.id)
      ), b = new Set(f.transitions.map((v) => v.id));
      for (const v of _)
        b.has(v) || jy(t, v);
      for (const v of f.transitions)
        ky(t, v);
    }
    Py(t, e, r.workflow);
    const d = new Set(
      t.query("SELECT id FROM elements WHERE project_id = ?", [e]).map((f) => f.id)
    ), c = new Set(r.elements.map((f) => f.id));
    for (const f of d)
      c.has(f) || qy(t, f);
    for (const f of r.elements)
      if (d.has(f.id)) {
        const { id: m, project_id: y, created_at: h, ...g } = f;
        Cy(t, f.id, { ...g, updated_at: pr() });
      } else
        Ny(t, f);
    const p = new Set(
      t.query("SELECT id FROM export_jobs WHERE project_id = ?", [e]).map((f) => f.id)
    );
    for (const f of r.exports)
      if (p.has(f.id)) {
        const { id: m, project_id: y, created_at: h, ...g } = f;
        My(t, f.id, g);
      } else
        Uy(t, f);
  });
}
const He = /* @__PURE__ */ new Map();
function De(t) {
  let e = He.get(t);
  return e || (e = new Xm(t), He.set(t, e)), e;
}
function lu() {
  return w.join(ut(), "projects.json");
}
async function Yi() {
  try {
    const t = await j.readFile(lu(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function Qi(t) {
  await j.mkdir(ut(), { recursive: !0 }), await j.writeFile(lu(), JSON.stringify(t, null, 2), "utf-8");
}
async function $y(t) {
  const e = await Yi(), r = e.projects.findIndex((n) => n.id === t.id);
  r >= 0 ? e.projects[r] = t : e.projects.push(t), await Qi(e);
}
async function Fy(t) {
  const e = await Yi();
  e.projects = e.projects.filter((r) => r.id !== t), await Qi(e);
}
function By() {
  I.handle("db:project:create", async (t, e) => {
    const r = nr(), n = pr();
    xl(r);
    const i = De(r);
    tu(i, {
      id: r,
      name: e,
      created_at: n,
      updated_at: n,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24
    });
    const a = nr();
    return su(i, {
      id: a,
      project_id: r,
      name: "Timeline 1",
      duration: 0,
      created_at: n
    }), hi(i, {
      id: nr(),
      timeline_id: a,
      name: "Video 1",
      kind: "video",
      color: "#4A90D9",
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 0
    }), hi(i, {
      id: nr(),
      timeline_id: a,
      name: "Audio 1",
      kind: "audio",
      color: "#7ED321",
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 1
    }), await $y({
      id: r,
      name: e,
      createdAt: n,
      updatedAt: n,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
      useSqlite: !0
    }), Oa(i, r);
  }), I.handle("db:project:load", async (t, e) => {
    const r = De(e), n = Oa(r, e);
    for (const i of n.assets)
      if (i.file_ref && !i.source_url) {
        const o = i.status;
        D.existsSync(i.file_ref) ? i.status === "offline" && (i.status = "online") : i.status = "offline", i.status !== o && zr(r, i.id, { status: i.status });
      }
    return n;
  }), I.handle("db:project:save", async (t, e, r) => {
    const n = De(e);
    Dy(n, e, r);
    const i = pr(), o = await Yi(), a = o.projects.find((s) => s.id === e);
    return a && (a.name = r.project.name, a.updatedAt = i, a.assetCount = r.assets.length, a.elementCount = r.elements.length, await Qi(o)), { ok: !0 };
  }), I.handle("db:project:delete", async (t, e) => {
    const r = He.get(e);
    r && (r.close(), He.delete(e));
    const n = We(e);
    try {
      await j.rm(n, { recursive: !0, force: !0 });
    } catch (i) {
      console.error(`[db:project:delete] Failed to remove directory ${n}:`, i);
    }
    return await Fy(e), { ok: !0 };
  }), I.handle("db:project:close", async (t, e) => {
    const r = He.get(e);
    return r && (r.close(), He.delete(e)), { ok: !0 };
  }), I.handle(
    "db:project:update",
    async (t, e, r) => {
      const n = De(e);
      return nu(n, e, r), { ok: !0 };
    }
  ), I.handle("db:asset:insert", async (t, e) => {
    const r = De(e.project_id);
    return ou(r, e), { ok: !0 };
  }), I.handle(
    "db:asset:update",
    async (t, e, r, n) => {
      const i = De(e);
      return zr(i, r, n), { ok: !0 };
    }
  ), I.handle("db:asset:delete", async (t, e, r) => {
    const n = De(e);
    return au(n, r), { ok: !0 };
  });
}
function Vy() {
  for (const [t, e] of He)
    try {
      e.close();
    } catch (r) {
      console.error(`[closeAllDbs] Failed to close DB for project ${t}:`, r);
    }
  He.clear();
}
const Gy = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), Hy = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
function Vn(t, e) {
  const r = w.extname(t).toLowerCase();
  return Gy.has(r) ? "video" : Hy.has(r) ? "audio" : r ? "image" : e;
}
function zy(t, e) {
  if (t)
    try {
      const r = w.extname(new URL(t).pathname);
      if (r && r.length <= 8) return r;
    } catch {
      const r = w.extname(t);
      if (r && r.length <= 8) return r;
    }
  switch (e) {
    case "video":
      return ".mp4";
    case "audio":
      return ".mp3";
    default:
      return ".jpg";
  }
}
async function Wy(t, e) {
  let r = [];
  try {
    r = await j.readdir(t);
  } catch {
    return null;
  }
  const n = r.find((i) => i === e || i.startsWith(`${e}.`));
  return n ? w.join(t, n) : null;
}
function Xy(t) {
  return t.startsWith("local-media://file") ? decodeURIComponent(t.replace(/^local-media:\/\/file/, "")) : null;
}
function Jy(t) {
  if (!(t != null && t.trim())) return null;
  const e = t.trim(), r = Xy(e) ?? e;
  return D.existsSync(r) ? r : null;
}
async function Ky(t, e) {
  await j.mkdir(w.dirname(e), { recursive: !0 }), await j.copyFile(t, e);
}
function Mr(t) {
  const e = We(t.projectId), r = w.join(e, ".cache"), n = J.randomUUID(), i = {
    id: n,
    type: "extract_metadata",
    assetId: t.assetId,
    inputPath: t.inputPath,
    outputPath: "",
    projectDir: e
  };
  if (t.type !== "audio") {
    const o = w.join(r, "thumbnails");
    D.mkdirSync(o, { recursive: !0 }), Se({
      id: J.randomUUID(),
      type: "generate_thumbnail",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(o, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((a) => console.error("[generated-asset-persist] Thumbnail failed:", a));
  }
  if (Se(i).catch((o) => console.error("[generated-asset-persist] Metadata failed:", o)), t.type === "audio" || t.type === "video") {
    const o = w.join(r, "waveforms");
    D.mkdirSync(o, { recursive: !0 }), Se({
      id: J.randomUUID(),
      type: "compute_waveform",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(o, `${t.assetId}.json`),
      projectDir: e
    }).catch((a) => console.error("[generated-asset-persist] Waveform failed:", a));
  }
  if (t.type === "video") {
    const o = w.join(r, "filmstrips");
    D.mkdirSync(o, { recursive: !0 }), Se({
      id: J.randomUUID(),
      type: "generate_filmstrip",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(o, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Filmstrip failed:", s));
    const a = w.join(r, "proxies");
    D.mkdirSync(a, { recursive: !0 }), Se({
      id: J.randomUUID(),
      type: "generate_proxy",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(a, `${t.assetId}.mp4`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Proxy failed:", s));
  }
  return n;
}
async function Na(t) {
  var f;
  const { projectId: e, assetId: r, assetType: n } = t;
  if (!e || !r)
    throw new Error("projectId and assetId are required.");
  const i = We(e), o = w.join(i, "media", "generated");
  await j.mkdir(o, { recursive: !0 });
  const a = await Wy(o, r);
  if (a)
    return Mr({
      assetId: r,
      projectId: e,
      inputPath: a,
      type: Vn(a, n)
    }), {
      path: a,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const s = t.extension || zy(t.remoteUrl ?? t.localPathHint, n), l = w.join(o, `${r}${s}`), u = Jy(t.localPathHint);
  if (u)
    return await Ky(u, l), Mr({
      assetId: r,
      projectId: e,
      inputPath: l,
      type: Vn(l, n)
    }), {
      path: l,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const d = (f = t.remoteUrl) == null ? void 0 : f.trim();
  if (!d)
    return { error: "No downloadable URL or local file path for this asset." };
  const c = await fetch(d);
  if (!c.ok)
    throw new Error(`Failed to download (HTTP ${c.status}). The URL may have expired.`);
  const p = await c.arrayBuffer();
  return await j.writeFile(l, Buffer.from(p)), Mr({
    assetId: r,
    projectId: e,
    inputPath: l,
    type: Vn(l, n)
  }), {
    path: l,
    sourceUrl: d,
    downloaded: !0
  };
}
let ge = null;
const $e = /* @__PURE__ */ new Map(), ir = /* @__PURE__ */ new Map(), Yy = w.dirname(vi(import.meta.url));
function uu() {
  let t = w.join(Yy, "workers", "media-worker.js");
  return t.includes("app.asar") && (t = t.replace("app.asar", "app.asar.unpacked")), t;
}
function Qy() {
  return ge || (ge = new Ya(uu()), ge.on("message", (t) => {
    switch (t.type) {
      case "ready":
        console.log("[media-worker] Worker ready");
        break;
      case "job:progress":
        for (const e of Q.getAllWindows())
          e.webContents.send("media:job-progress", { jobId: t.jobId, progress: t.progress });
        break;
      case "job:complete": {
        const e = ir.get(t.jobId);
        for (const n of Q.getAllWindows())
          n.webContents.send("media:job-complete", {
            jobId: t.jobId,
            result: t.result,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        ir.delete(t.jobId);
        const r = $e.get(t.jobId);
        r && (r.resolve(t.result), $e.delete(t.jobId));
        break;
      }
      case "job:error": {
        const e = ir.get(t.jobId);
        for (const n of Q.getAllWindows())
          n.webContents.send("media:job-error", {
            jobId: t.jobId,
            error: t.error,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        ir.delete(t.jobId);
        const r = $e.get(t.jobId);
        r && (r.reject(new Error(t.error)), $e.delete(t.jobId));
        break;
      }
      case "sync:batch-progress":
        for (const e of Q.getAllWindows())
          e.webContents.send("sync:batch-progress", {
            jobId: t.jobId,
            completedPairs: t.completedPairs,
            totalPairs: t.totalPairs,
            currentVideoName: t.currentVideoName,
            currentAudioName: t.currentAudioName
          });
        break;
    }
  }), ge.on("error", (t) => {
    console.error("[media-worker] Worker error:", t);
  }), ge.on("exit", (t) => {
    console.log(`[media-worker] Worker exited with code ${t}`), ge = null;
    for (const [e, r] of $e)
      r.reject(new Error("Worker exited")), $e.delete(e);
  }), ge.postMessage({
    type: "config",
    ffmpegPath: ve(),
    ffprobePath: Vi(),
    fpcalcPath: ll()
  }), ge);
}
function Se(t) {
  return t.type === "sync_compute_offset" || t.type === "sync_batch_match" ? Zy(t) : new Promise((e, r) => {
    $e.set(t.id, { resolve: e, reject: r }), ir.set(t.id, { assetId: t.assetId, jobType: t.type }), Qy().postMessage({ type: "job:submit", job: t });
  });
}
function Zy(t) {
  return new Promise((e, r) => {
    const n = new Ya(uu());
    let i = !1;
    const o = () => {
      n.removeAllListeners(), n.terminate().catch(() => {
      });
    }, a = (l) => {
      i || (i = !0, o(), e(l));
    }, s = (l) => {
      i || (i = !0, o(), r(l));
    };
    n.on("message", (l) => {
      switch (l.type) {
        case "ready":
          n.postMessage({ type: "job:submit", job: t });
          break;
        case "job:complete":
          l.jobId === t.id && a(l.result);
          break;
        case "job:error":
          l.jobId === t.id && s(new Error(l.error));
          break;
        case "sync:batch-progress":
          for (const u of Q.getAllWindows())
            u.webContents.send("sync:batch-progress", {
              jobId: l.jobId,
              completedPairs: l.completedPairs,
              totalPairs: l.totalPairs,
              currentVideoName: l.currentVideoName,
              currentAudioName: l.currentAudioName
            });
          break;
      }
    }), n.on("error", (l) => {
      s(l instanceof Error ? l : new Error(String(l)));
    }), n.on("exit", (l) => {
      !i && l !== 0 && s(new Error(`Sync worker exited with code ${l}`));
    }), n.postMessage({
      type: "config",
      ffmpegPath: ve(),
      ffprobePath: Vi(),
      fpcalcPath: ll()
    });
  });
}
function e_(t) {
  const e = w.extname(t).toLowerCase(), r = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), n = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
  return r.has(e) ? "video" : n.has(e) ? "audio" : "image";
}
function t_() {
  I.handle("media:import", async (t, e) => {
    const { filePaths: r, projectId: n, mode: i } = e, o = We(n), a = [], s = [];
    for (const l of r) {
      const u = J.randomUUID();
      let d = l;
      if (i === "copy") {
        const f = w.join(o, "media", "imported");
        await j.mkdir(f, { recursive: !0 });
        const m = `${u}${w.extname(l)}`, y = w.join(f, m);
        await j.copyFile(l, y), d = y;
      }
      const c = e_(l), p = J.randomUUID();
      s.push({
        assetId: u,
        metadataJobId: p,
        inputPath: d,
        type: c,
        projectDir: o
      }), a.push({ assetId: u, jobId: p, filePath: d, type: c });
    }
    return setTimeout(() => {
      for (const l of s)
        Mr({
          assetId: l.assetId,
          projectId: n,
          inputPath: l.inputPath,
          type: l.type
        });
    }, 0), a;
  }), I.handle("media:submit-job", async (t, e) => Se(e)), I.handle("media:cancel-job", async (t, e) => {
    const r = ge;
    return r && r.postMessage({ type: "job:cancel", jobId: e }), $e.delete(e), { ok: !0 };
  }), I.handle("media:extract-frame", async (t, e) => {
    const { inputPath: r, timeSec: n } = e, i = ve(), o = w.join(z.tmpdir(), `cinegen-frame-${J.randomUUID()}.jpg`);
    return new Promise((a) => {
      const s = [
        "-y",
        "-ss",
        `${Math.max(0, n)}`,
        "-i",
        r,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        o
      ];
      Ce(i, s, { timeout: 15e3 }, (l, u, d) => {
        if (l || !D.existsSync(o)) {
          a(null);
          return;
        }
        a({ outputPath: o });
      });
    });
  }), I.handle("media:write-temp-image", async (t, e) => {
    const r = e.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!r) throw new Error("media:write-temp-image expects a base64 image data URL.");
    const n = r[1] === "jpeg" ? "jpg" : r[1], i = Buffer.from(r[2], "base64"), o = w.join(z.tmpdir(), `cinegen-frame-chat-${J.randomUUID()}.${n}`);
    return await j.writeFile(o, i), { outputPath: o };
  }), I.handle("media:trim-video", async (t, e) => {
    const { inputPath: r, startSec: n, endSec: i, projectId: o } = e, a = Math.max(0, n), s = Math.max(0.05, i - a);
    if (!D.existsSync(r)) return null;
    const l = w.join(We(o), "media", "generated");
    await j.mkdir(l, { recursive: !0 });
    const u = w.join(l, `trim-${J.randomUUID()}.mp4`);
    return new Promise((d) => {
      const c = [
        "-y",
        // Seeking before -i is the fast path; ffmpeg still decodes accurately
        // from the nearest keyframe with the re-encode below.
        "-ss",
        `${a}`,
        "-i",
        r,
        "-t",
        `${s}`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        // Keep audio when the source has it, rather than failing on a silent file.
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        u
      ];
      Ce(ve(), c, { timeout: Math.max(12e4, Math.ceil(s * 4e3)) }, (p) => {
        if (p || !D.existsSync(u)) {
          d(null);
          return;
        }
        d({ outputPath: u });
      });
    });
  }), I.handle("media:extract-clip", async (t, e) => {
    const { inputPath: r, startTimeSec: n, durationSec: i } = e, o = ve(), a = w.join(z.tmpdir(), `cinegen-clip-${J.randomUUID()}.mp4`), s = Math.max(0, n), l = Math.max(0.1, i);
    return new Promise((u) => {
      const d = [
        "-y",
        "-ss",
        `${s}`,
        "-i",
        r,
        "-t",
        `${l}`,
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
        a
      ];
      Ce(o, d, { timeout: Math.max(12e4, Math.ceil(l * 4e3)) }, (c, p, f) => {
        if (c || !D.existsSync(a)) {
          u(null);
          return;
        }
        u({ outputPath: a });
      });
    });
  }), I.handle("media:queue-processing", async (t, e) => {
    const {
      assetId: r,
      projectId: n,
      inputPath: i,
      needsProxy: o,
      includeThumbnail: a = !1,
      includeWaveform: s = !0,
      includeFilmstrip: l = !0
    } = e, u = We(n), d = w.join(u, ".cache");
    if (a) {
      const c = w.join(d, "thumbnails");
      D.mkdirSync(c, { recursive: !0 });
      const p = {
        id: J.randomUUID(),
        type: "generate_thumbnail",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.jpg`),
        projectDir: u
      };
      Se(p).catch((f) => console.error("[media-import] Thumbnail failed:", f));
    }
    if (s) {
      const c = w.join(d, "waveforms");
      D.mkdirSync(c, { recursive: !0 });
      const p = {
        id: J.randomUUID(),
        type: "compute_waveform",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.json`),
        projectDir: u
      };
      Se(p).catch((f) => console.error("[media-import] Waveform failed:", f));
    }
    if (l) {
      const c = w.join(d, "filmstrips");
      D.mkdirSync(c, { recursive: !0 });
      const p = {
        id: J.randomUUID(),
        type: "generate_filmstrip",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.jpg`),
        projectDir: u
      };
      Se(p).catch((f) => console.error("[media-import] Filmstrip failed:", f));
    }
    if (o) {
      const c = w.join(d, "proxies");
      D.mkdirSync(c, { recursive: !0 });
      const p = {
        id: J.randomUUID(),
        type: "generate_proxy",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.mp4`),
        projectDir: u
      };
      Se(p).catch((f) => console.error("[media-import] Proxy failed:", f));
    }
    return { ok: !0 };
  }), I.handle(
    "media:download-remote",
    async (t, e) => {
      const { url: r, projectId: n, assetId: i, ext: o } = e;
      if (!r || !n) throw new Error("url and projectId are required");
      const a = await Na({
        projectId: n,
        assetId: i,
        assetType: "video",
        remoteUrl: r,
        extension: o
      });
      if ("error" in a) throw new Error(a.error);
      return { path: a.path };
    }
  ), I.handle(
    "media:persist-generated-asset",
    async (t, e) => {
      try {
        return await Na(e);
      } catch (r) {
        return {
          error: r instanceof Error ? r.message : String(r)
        };
      }
    }
  );
}
function r_() {
  ge && (ge.terminate(), ge = null);
}
function n_(t) {
  I.handle("sync:compute-offset", async (e, r) => {
    const n = yr();
    return await t({
      id: n,
      type: "sync_compute_offset",
      sourceAssetId: r.sourceAssetId,
      targetAssetId: r.targetAssetId,
      sourceFilePath: r.sourceFilePath,
      targetFilePath: r.targetFilePath,
      projectDir: ""
      // Not needed for sync jobs
    });
  }), I.handle("sync:batch-match", async (e, r) => {
    const n = yr();
    return await t({
      id: n,
      type: "sync_batch_match",
      videoAssets: r.videoAssets,
      audioAssets: r.audioAssets,
      projectDir: ""
      // Not needed for sync jobs
    });
  });
}
const i_ = Ka(import.meta.url), o_ = w.dirname(vi(import.meta.url));
function a_() {
  return W.isPackaged ? w.join(process.resourcesPath, "native", "cinegen_avfoundation.node") : w.resolve(o_, "../native/avfoundation/build/Release/cinegen_avfoundation.node");
}
let re = null, gi = null;
if (process.platform === "darwin")
  try {
    const t = a_();
    re = i_(t), console.log("[native-video] AVFoundation addon loaded:", t);
  } catch (t) {
    gi = t instanceof Error ? t.message : String(t), console.error("[native-video] Failed to load AVFoundation addon:", gi);
  }
function Me() {
  return re != null;
}
function s_() {
  return gi;
}
function l_(t, e) {
  return re ? re.createSurface(t, e) : !1;
}
function Ca(t) {
  re == null || re.destroySurface(t);
}
function u_(t, e, r, n, i) {
  re == null || re.setSurfaceRect(t, e, r, n, i);
}
function qa(t, e) {
  re == null || re.setSurfaceHidden(t, e);
}
function La(t) {
  re == null || re.clearSurface(t);
}
function d_(t, e) {
  re == null || re.syncSurface(t, e);
}
function c_() {
  I.handle("native-video:is-available", () => ({
    available: Me(),
    error: s_()
  })), I.handle("native-video:reset-surfaces", (t, e) => {
    if (!Me()) return !1;
    for (const r of e)
      qa(r, !0), La(r), Ca(r);
    return !0;
  }), I.handle("native-video:create-surface", (t, e) => {
    const r = Q.fromWebContents(t.sender);
    return !r || !Me() ? !1 : l_(e, r.getNativeWindowHandle());
  }), I.on("native-video:set-surface-rect", (t, e) => {
    Me() && u_(e.surfaceId, e.x, e.y, e.width, e.height);
  }), I.on("native-video:set-surface-hidden", (t, e) => {
    Me() && qa(e.surfaceId, e.hidden);
  }), I.on("native-video:clear-surface", (t, e) => {
    Me() && La(e);
  }), I.on("native-video:sync-surface", (t, e) => {
    Me() && d_(e.surfaceId, e.descriptors);
  }), I.on("native-video:destroy-surface", (t, e) => {
    Me() && Ca(e);
  });
}
const f_ = "python3.12", du = w.join(z.homedir(), "Desktop", "Coding", "whisperx"), p_ = w.join(du, ".venv", "bin", "python");
function m_(...t) {
  return W.isPackaged ? w.join(process.resourcesPath, ...t) : w.join(process.cwd(), ...t);
}
const h_ = m_("scripts", "whisperx", "cinegen_infer.py"), g_ = "fal-ai/whisper", Ua = "3", y_ = {
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
function __(t) {
  const e = w.extname(t).toLowerCase();
  return y_[e] ?? "application/octet-stream";
}
function Wr(t) {
  const e = Number(t);
  if (Number.isFinite(e))
    return Math.round(Math.max(0, e) * 1e3) / 1e3;
}
function w_(t, e) {
  const r = e.trim();
  return r ? t ? /^[,.;:!?%)\]}]/.test(r) || /^['’]/.test(r) ? `${t}${r}` : `${t} ${r}` : r : t;
}
function b_(t) {
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
function cu(t) {
  const e = [];
  let r = null;
  const n = () => {
    var i;
    r && (r.text = r.text.trim(), (r.text || (((i = r.words) == null ? void 0 : i.length) ?? 0) > 0) && e.push(r), r = null);
  };
  for (let i = 0; i < t.length; i++) {
    const o = t[i];
    r || (r = {
      start: o.start,
      end: o.end,
      text: "",
      ...o.speaker ? { speaker: o.speaker } : {},
      words: []
    }), r.words.push(o), r.end = o.end, r.text = w_(r.text, o.word), !r.speaker && o.speaker && (r.speaker = o.speaker);
    const a = t[i + 1], s = a ? Math.max(0, a.start - o.end) : 0, l = !!a && (a.speaker ?? null) !== (r.speaker ?? null), u = r.end - r.start, d = /[.!?]["')\]]*$/.test(o.word), c = s >= 0.85 || s >= 0.45 && /[,;:]$/.test(o.word), p = u >= 12;
    (!a || d || c || p || l) && n();
  }
  return n(), e;
}
function v_(t) {
  const e = t.flatMap((r) => Array.isArray(r.words) ? r.words.flatMap((n) => {
    if (!n || typeof n.word != "string") return [];
    const i = Wr(n.start), o = Wr(n.end);
    return i === void 0 || o === void 0 ? [] : [{
      word: n.word.trim(),
      start: i,
      end: o,
      ...n.prob !== void 0 ? { prob: n.prob } : {},
      ...n.speaker !== void 0 ? { speaker: n.speaker } : {}
    }];
  }) : []);
  return e.length === 0 ? t : cu(e);
}
function T_(t) {
  const e = (t == null ? void 0 : t.data) ?? t, r = typeof (e == null ? void 0 : e.text) == "string" ? e.text : "", n = e == null ? void 0 : e.chunks, i = e, o = Array.isArray(n) ? n.flatMap((d) => {
    if (!d || typeof d != "object") return [];
    const c = typeof d.text == "string" ? d.text.trim() : "", p = d.timestamp, f = Array.isArray(p) ? Wr(p[0]) : void 0, m = Array.isArray(p) ? Wr(p[1]) : void 0, y = b_(d.speaker);
    return !c && f === void 0 && m === void 0 ? [] : [{ text: c, start: f, end: m, speaker: y }];
  }) : [], a = o.flatMap((d) => !d.text || d.start === void 0 || d.end === void 0 ? [] : [{
    word: d.text,
    start: d.start,
    end: d.end,
    ...d.speaker ? { speaker: d.speaker } : {}
  }]), s = a.length > 0 ? cu(a) : o.map((d) => ({
    text: d.text,
    start: d.start ?? 0,
    end: d.end ?? d.start ?? 0,
    ...d.speaker ? { speaker: d.speaker } : {}
  }));
  let l = "";
  const u = [i.language, i.languages, i.inferred_languages];
  for (const d of u) {
    if (typeof d == "string" && d.trim()) {
      l = d.trim();
      break;
    }
    if (Array.isArray(d)) {
      const c = d.find((p) => typeof p == "string" && p.trim().length > 0);
      if (c) {
        l = c.trim();
        break;
      }
    }
  }
  return {
    text: r || s.map((d) => d.text).filter(Boolean).join(" "),
    segments: s,
    language: l
  };
}
async function E_(t) {
  const e = w.join(
    z.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), r = ve(), n = [
    "-y",
    "-i",
    t,
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
    e
  ];
  return await new Promise((i, o) => {
    var l;
    const a = ae(r, n, { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    (l = a.stderr) == null || l.on("data", (u) => {
      s += u.toString();
    }), a.on("error", o), a.on("close", (u) => {
      if (u === 0) {
        i();
        return;
      }
      o(new Error(s.trim() || `ffmpeg exited with code ${u}`));
    });
  }), e;
}
const S_ = `
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
`, Ma = /* @__PURE__ */ new Map();
function I_() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function Xe(t, e) {
  var r;
  (r = I_()) == null || r.webContents.send("transcription:progress", {
    jobId: t.jobId,
    assetId: t.assetId,
    engine: t.engine,
    ...e
  });
}
async function x_(t) {
  try {
    const e = De(t.projectId), r = iu(e, t.projectId).find((o) => o.id === t.assetId), i = {
      ...r != null && r.metadata ? JSON.parse(r.metadata) : {},
      transcription: {
        text: t.fullText,
        segments: t.segments,
        language: t.language,
        engine: t.engine,
        ...t.model ? { model: t.model } : {},
        processedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      transcriptionJobId: void 0
    };
    zr(e, t.assetId, { metadata: JSON.stringify(i) });
  } catch (e) {
    console.error("[transcription] failed to save to db:", e);
  }
}
async function Zi(t) {
  t.status = "done", t.segments = v_(t.segments), t.fullText.trim() || (t.fullText = t.segments.map((e) => e.text).filter(Boolean).join(" ")), await x_(t), Xe(t, {
    type: "done",
    text: t.fullText,
    segments: t.segments,
    language: t.language
  });
}
function ot(t, e) {
  t.status = "error", t.error = e, Xe(t, { type: "error", error: e });
}
function A_(t, e) {
  const r = e.model ?? "large", n = e.language ?? "auto";
  t.model = r, (async () => {
    const i = w.join(z.tmpdir(), `cinegen-whisper-${t.jobId}.py`);
    await j.writeFile(i, S_, "utf-8");
    const o = ae(f_, [i, e.filePath, r, n], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    t.status = "running", Xe(t, { type: "status", status: "running" }), o.stdout.on("data", (a) => {
      for (const s of a.toString().split(`
`)) {
        const l = s.trim();
        if (l)
          try {
            const u = JSON.parse(l);
            if (u.type === "segment") {
              const d = {
                text: u.text,
                start: u.start ?? 0,
                end: u.end ?? 0,
                ...Array.isArray(u.words) && u.words.length > 0 ? { words: u.words } : {}
              };
              t.segments.push(d), Xe(t, { type: "segment", ...d });
            } else u.type === "done" && (t.fullText = u.text, t.language = u.language ?? "");
          } catch {
          }
      }
    }), o.stderr.on("data", () => {
    }), o.on("close", async (a) => {
      if (await j.unlink(i).catch(() => {
      }), a !== 0) {
        ot(t, `whisper process exited with code ${a}`);
        return;
      }
      await Zi(t);
    }), o.on("error", async (a) => {
      await j.unlink(i).catch(() => {
      }), ot(t, a.message);
    });
  })().catch((i) => {
    ot(t, i instanceof Error ? i.message : String(i));
  });
}
function k_(t, e) {
  t.model = "base";
  const r = [
    h_,
    "--audio_path",
    e.filePath,
    "--model",
    "base",
    "--no_diarize"
  ];
  e.language && e.language !== "auto" && r.push("--language", e.language);
  const n = { ...process.env };
  process.env.HF_TOKEN && (n.HF_TOKEN = process.env.HF_TOKEN);
  const i = ae(p_, r, {
    cwd: du,
    stdio: ["ignore", "pipe", "pipe"],
    env: n
  });
  t.status = "running", Xe(t, { type: "status", status: "running" });
  let o;
  i.stdout.on("data", (a) => {
    for (const s of a.toString().split(`
`)) {
      const l = s.trim();
      if (l)
        try {
          const u = JSON.parse(l);
          u.type === "progress" ? (u.output_text !== void 0 && (t.fullText = u.output_text), u.segments && (t.segments = u.segments), u.language !== void 0 && (t.language = u.language), Xe(t, {
            type: "progress",
            stage: u.stage,
            message: u.message,
            ...u.output_text !== void 0 ? { text: u.output_text } : {},
            ...u.segments ? { segments: u.segments } : {},
            ...u.language !== void 0 ? { language: u.language } : {}
          })) : u.type === "done" ? (u.output_text !== void 0 && (t.fullText = u.output_text), u.segments && (t.segments = u.segments), u.language !== void 0 && (t.language = u.language), o = u.transcript_path) : u.type === "error" && ot(t, u.error ?? "WhisperX error");
        } catch {
        }
    }
  }), i.stderr.on("data", () => {
  }), i.on("close", async (a) => {
    if (t.status !== "error") {
      if (a !== 0) {
        ot(t, `whisperx process exited with code ${a}`);
        return;
      }
      if (o)
        try {
          const s = await j.readFile(o, "utf-8"), l = JSON.parse(s);
          l.output_text !== void 0 && (t.fullText = l.output_text), l.segments && (t.segments = l.segments), l.language !== void 0 && (t.language = l.language), l.model && (t.model = l.model);
        } finally {
          await j.unlink(o).catch(() => {
          });
        }
      await Zi(t);
    }
  }), i.on("error", (a) => {
    ot(t, a.message);
  });
}
function j_(t, e) {
  (async () => {
    if (!e.apiKey) throw new Error("No fal.ai API key provided. Add one in Settings.");
    t.model = Ua, t.status = "running", Xe(t, { type: "status", status: "running", stage: "uploading", message: "Preparing audio for cloud transcription" }), K.fal.config({ credentials: e.apiKey });
    const r = await E_(e.filePath);
    let n = "";
    try {
      const s = await j.readFile(r), u = `${w.basename(e.filePath, w.extname(e.filePath))}.m4a`, d = __(r), c = new Blob([s], { type: d }), p = new File([c], u, { type: d });
      n = await K.fal.storage.upload(p);
    } finally {
      await j.unlink(r).catch(() => {
      });
    }
    Xe(t, { type: "status", status: "running", stage: "transcribing", message: "Running cloud transcription" });
    const i = {
      audio_url: n,
      task: "transcribe",
      chunk_level: "word",
      version: Ua,
      ...e.language && e.language !== "auto" ? { language: e.language } : {}
    }, o = await K.fal.subscribe(g_, { input: i, logs: !0 }), a = T_(o);
    t.fullText = a.text, t.segments = a.segments, t.language = a.language, await Zi(t);
  })().catch((r) => {
    ot(t, r instanceof Error ? r.message : String(r));
  });
}
function R_() {
  I.handle("transcription:start", async (t, e) => {
    const {
      projectId: r,
      assetId: n,
      filePath: i,
      model: o = "large",
      language: a = "auto",
      engine: s = "faster-whisper-local",
      apiKey: l
    } = e, u = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, d = {
      jobId: u,
      assetId: n,
      projectId: r,
      engine: s,
      status: "pending",
      segments: [],
      fullText: "",
      language: ""
    };
    return Ma.set(u, d), s === "whisperx-local" ? k_(d, { filePath: i, language: a }) : s === "whisper-cloud" ? j_(d, { filePath: i, language: a, apiKey: l }) : A_(d, { filePath: i, model: o, language: a }), { jobId: u };
  }), I.handle("transcription:get", (t, e) => {
    const r = Ma.get(e);
    return r ? {
      status: r.status,
      fullText: r.fullText,
      segments: r.segments,
      language: r.language,
      engine: r.engine,
      error: r.error
    } : null;
  });
}
const eo = w.join(z.homedir(), "Desktop", "Coding", "ltx"), P_ = w.join(eo, ".venv", "bin", "python"), O_ = w.join(eo, "cinegen_infer.py"), to = w.join(z.homedir(), "Desktop", "Coding", "qwen-edit"), N_ = w.join(to, ".venv", "bin", "python"), C_ = w.join(to, "cinegen_infer.py"), fu = w.join(z.homedir(), "Desktop", "Coding", "layer-decompose"), q_ = w.join(fu, ".venv", "bin", "python"), pu = w.join(z.homedir(), "Desktop", "Coding", "whisperx"), L_ = w.join(pu, ".venv", "bin", "python");
function mu(...t) {
  return W.isPackaged ? w.join(process.resourcesPath, ...t) : w.join(process.cwd(), ...t);
}
const U_ = mu("scripts", "layer-decompose", "cinegen_infer.py"), M_ = mu("scripts", "whisperx", "cinegen_infer.py"), D_ = {
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
}, Da = /* @__PURE__ */ new Map();
function $_() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function yt(t, e) {
  var r;
  (r = $_()) == null || r.webContents.send("local-model:progress", { jobId: t, ...e });
}
async function Or(t, e) {
  if (t.startsWith("http://") || t.startsWith("https://")) {
    const r = w.extname(new URL(t).pathname) || ".jpg", n = w.join(z.tmpdir(), `cinegen-img-${e}${r}`), i = await fetch(t);
    if (!i.ok) throw new Error(`Failed to download image: ${i.status}`);
    const o = await i.arrayBuffer();
    return await j.writeFile(n, Buffer.from(o)), { imagePath: n, tempPath: n };
  } else if (t.startsWith("local-media://file/"))
    return { imagePath: decodeURIComponent(t.replace("local-media://file", "")), tempPath: null };
  return { imagePath: t, tempPath: null };
}
function F_() {
  I.handle("local-model:run", async (t, e) => {
    const { inputs: r } = e, n = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, i = { jobId: n, status: "pending" };
    Da.set(n, i);
    let o, a = null;
    if (e.nodeType === "qwen-edit-local") {
      const s = String(r.prompt ?? ""), l = Number(r.num_inference_steps ?? 50), u = Number(r.guidance_scale ?? 1), d = Number(r.true_cfg_scale ?? 4), c = Number(r.seed ?? 42);
      let p = null;
      if (r.image_url) {
        const m = await Or(String(r.image_url), n);
        p = m.imagePath, a = m.tempPath;
      }
      if (!p) throw new Error("Qwen Image Edit requires an input image");
      const f = [
        C_,
        "--image_path",
        p,
        "--prompt",
        s,
        "--num_inference_steps",
        String(l),
        "--guidance_scale",
        String(u),
        "--true_cfg_scale",
        String(d),
        "--seed",
        String(c)
      ];
      o = ae(N_, f, {
        cwd: to,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "layer-decompose") {
      console.log("[layer-decompose] inputs:", JSON.stringify(r, null, 2));
      const s = String(r.prompts ?? "").trim(), l = String(r.inpainter ?? "qwen-edit-local"), u = !!(r.reconstruct_bg ?? !0), d = Number(r.seed ?? 42);
      let c = null;
      if (r.image_url) {
        console.log("[layer-decompose] resolving image_url:", r.image_url);
        const m = await Or(String(r.image_url), n);
        c = m.imagePath, a = m.tempPath, console.log("[layer-decompose] resolved to:", c);
      }
      if (!c) throw new Error("Layer Decompose requires an input image");
      const f = [
        U_,
        "--image_path",
        c,
        "--inpainter",
        u && l === "lama" ? "lama" : "none",
        "--seed",
        String(d)
      ];
      s && f.push("--prompts", s), o = ae(q_, f, {
        cwd: fu,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "whisperx-local") {
      console.log("[whisperx] inputs:", JSON.stringify(r, null, 2));
      const s = String(r.model ?? "base"), l = String(r.language ?? "").trim(), u = r.diarize !== !1;
      let d = null;
      if (r.audio_url) {
        console.log("[whisperx] resolving audio_url:", r.audio_url);
        const m = await Or(String(r.audio_url), n);
        d = m.imagePath, a = m.tempPath, console.log("[whisperx] resolved to:", d);
      }
      if (!d) throw new Error("WhisperX requires an audio input");
      const c = [
        M_,
        "--audio_path",
        d,
        "--model",
        s
      ];
      l && c.push("--language", l), u || c.push("--no_diarize");
      const p = process.env.HF_TOKEN, f = { ...process.env };
      p && (f.HF_TOKEN = p), o = ae(L_, c, {
        cwd: pu,
        stdio: ["ignore", "pipe", "pipe"],
        env: f
      });
    } else {
      const s = String(r.prompt ?? ""), l = String(r.resolution ?? "896x512"), { height: u, width: d } = D_[l] ?? { height: 512, width: 896 }, c = Number(r.frame_rate ?? 24), p = Number(r.duration_secs ?? 4), f = Math.round(p * c / 8) * 8 + 1, m = Math.max(9, f), y = Number(r.seed ?? 42), h = !!r.enhance_prompt;
      let g = null;
      if (r.image_url) {
        const b = await Or(String(r.image_url), n);
        g = b.imagePath, a = b.tempPath;
      }
      const _ = [
        O_,
        "--prompt",
        s,
        "--height",
        String(u),
        "--width",
        String(d),
        "--num_frames",
        String(m),
        "--frame_rate",
        String(c),
        "--seed",
        String(y)
      ];
      g && _.push("--image_path", g), h && _.push("--enhance_prompt"), o = ae(P_, _, {
        cwd: eo,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }
    return i.status = "running", yt(n, { type: "status", status: "running" }), o.stdout.on("data", (s) => {
      for (const l of s.toString().split(`
`)) {
        const u = l.trim();
        if (u)
          try {
            const d = JSON.parse(u);
            d.type === "progress" ? (i.stage = d.stage, d.output_text !== void 0 && (i.outputText = d.output_text), d.segments && (i.segments = d.segments), d.language !== void 0 && (i.language = d.language), yt(n, {
              type: "progress",
              stage: d.stage,
              message: d.message,
              ...d.output_text !== void 0 && { output_text: d.output_text },
              ...d.segments && { segments: d.segments },
              ...d.language !== void 0 && { language: d.language }
            })) : d.type === "done" ? (i.status = "done", i.outputPath = d.output_path, i.outputText = d.output_text, i.transcriptPath = d.transcript_path, i.segments = d.segments, i.language = d.language, yt(n, {
              type: "done",
              output_path: d.output_path,
              ...d.output_text !== void 0 && { output_text: d.output_text },
              ...d.transcript_path !== void 0 && { transcript_path: d.transcript_path },
              ...d.segments && { segments: d.segments },
              ...d.language !== void 0 && { language: d.language },
              ...d.layers && { layers: d.layers },
              ...d.needs_inpainting !== void 0 && { needs_inpainting: d.needs_inpainting },
              ...d.combined_mask_path && { combined_mask_path: d.combined_mask_path }
            })) : d.type === "error" && (i.status = "error", i.error = d.error, yt(n, { type: "error", error: d.error }));
          } catch {
          }
      }
    }), o.stderr.on("data", () => {
    }), o.on("error", (s) => {
      i.status = "error", i.error = s.message, yt(n, { type: "error", error: s.message });
    }), o.on("close", (s) => {
      a && j.unlink(a).catch(() => {
      }), s !== 0 && i.status !== "done" && (i.status = "error", i.error = i.error ?? `Process exited with code ${s}`, yt(n, { type: "error", error: i.error }));
    }), { jobId: n };
  }), I.handle("local-model:get", (t, e) => {
    const r = Da.get(e);
    return r ? {
      status: r.status,
      stage: r.stage,
      outputPath: r.outputPath,
      outputText: r.outputText,
      transcriptPath: r.transcriptPath,
      segments: r.segments,
      language: r.language,
      error: r.error
    } : null;
  }), I.handle("local-model:read-transcript", async (t, e) => {
    try {
      const r = await j.readFile(e, "utf8");
      return JSON.parse(r);
    } catch (r) {
      return console.error("[local-model] failed to read transcript:", r), null;
    }
  });
}
const ro = w.join(z.homedir(), "Desktop", "Coding", "Sam3"), B_ = w.join(ro, ".venv", "bin", "python"), V_ = w.join(ro, "cinegen_server.py"), G_ = 120 * 1e3, H_ = 500, z_ = 60;
class W_ {
  constructor() {
    this.proc = null, this.port = 0, this.idleTimer = null;
  }
  async start() {
    var e, r;
    return this.proc && !this.proc.killed ? this.port : (this.port = await this.findFreePort(), console.log(`[sam3] Starting server on port ${this.port}`), this.proc = ae(B_, [V_, "--port", String(this.port)], {
      cwd: ro,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: "1"
      }
    }), (e = this.proc.stdout) == null || e.on("data", (n) => {
      console.log("[sam3-stdout]", n.toString().trim());
    }), (r = this.proc.stderr) == null || r.on("data", (n) => {
      const i = n.toString().trim();
      i && console.log("[sam3-stderr]", i);
    }), this.proc.on("exit", (n) => {
      console.log(`[sam3] Server exited with code ${n}`), this.proc = null;
    }), await this.waitForHealth(), this.resetIdleTimer(), console.log("[sam3] Server ready"), this.port);
  }
  async stop() {
    this.idleTimer && (clearTimeout(this.idleTimer), this.idleTimer = null), this.proc && !this.proc.killed && (console.log("[sam3] Stopping server"), this.proc.kill("SIGTERM"), this.proc = null);
  }
  async ensureRunning() {
    return this.isRunning() ? (this.resetIdleTimer(), this.port) : this.start();
  }
  isRunning() {
    return this.proc !== null && !this.proc.killed;
  }
  getPort() {
    return this.port;
  }
  resetIdleTimer() {
    this.idleTimer && clearTimeout(this.idleTimer), this.idleTimer = setTimeout(() => {
      console.log("[sam3] Idle timeout — stopping server"), this.stop();
    }, G_);
  }
  async findFreePort() {
    return new Promise((e, r) => {
      const n = ku.createServer();
      n.listen(0, "127.0.0.1", () => {
        const i = n.address();
        if (i && typeof i == "object") {
          const o = i.port;
          n.close(() => e(o));
        } else
          r(new Error("Could not find free port"));
      });
    });
  }
  async waitForHealth() {
    console.log(`[sam3] Waiting for health on port ${this.port}...`);
    for (let e = 0; e < z_; e++) {
      try {
        if ((await fetch(`http://127.0.0.1:${this.port}/health`)).ok) {
          console.log(`[sam3] Health check passed after ${e + 1} attempts`);
          return;
        }
      } catch {
      }
      await new Promise((r) => setTimeout(r, H_));
    }
    throw console.error("[sam3] Health check timed out after 30 seconds"), new Error("SAM 3 server failed to start within 30 seconds");
  }
}
const or = new W_();
function X_() {
  I.handle("sam3:start", async () => ({ port: await or.ensureRunning() })), I.handle("sam3:stop", async () => {
    await or.stop();
  }), I.handle("sam3:port", () => ({ port: or.getPort(), running: or.isRunning() }));
}
function J_() {
  or.stop();
}
function K_(t, e, r) {
  const n = r === "video" ? "video clip" : "image";
  return [
    t.trim() || `Describe this ${n} in detail.`,
    `Attached ${n}: "${e}".`,
    "Describe what you actually see and hear — specific subjects, actions, setting, camera movement, on-screen text, and spoken dialogue.",
    "Do not answer from clip names, storyboard labels, or generic production terminology alone."
  ].join(`
`);
}
async function Y_(t) {
  const e = t.workspaceDir ?? w.join(W.getPath("userData"), "gemini-cli-workspace"), r = await Ji(t.visualRefs, e);
  if (r.length === 0)
    throw new Error("Could not load the attached clip or asset files for visual analysis.");
  try {
    const n = [];
    for (const i of r) {
      const o = K_(t.prompt, i.label, i.mediaType), a = i.mediaType === "video" ? await ql({
        apiKey: t.apiKey,
        videoPath: i.mediaPath,
        prompt: o,
        detailedAnalysis: !0
      }) : await _h({
        apiKey: t.apiKey,
        imagePath: i.mediaPath,
        prompt: o
      });
      n.push({
        label: i.label,
        mediaType: i.mediaType,
        analysis: a
      });
    }
    return n;
  } finally {
    Ki(r);
  }
}
function Q_() {
  I.handle("copilot:analyze-visual-refs", async (t, e) => Y_(e));
}
const Z_ = 1, ew = -30, tw = 0.3;
function rw(t) {
  const e = [];
  let r = null;
  for (const n of t.split(/\r?\n/)) {
    const i = n.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (i) {
      r = Number(i[1]);
      continue;
    }
    const o = n.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (o && r !== null) {
      const a = Number(o[1]);
      Number.isFinite(a) && a > r && e.push({ start: r, end: a }), r = null;
    }
  }
  return e;
}
function $a(t) {
  return t.toFixed(2);
}
function nw(t) {
  const { assetName: e, transcript: r } = t;
  if (r.length === 0)
    return [
      `Analyze the media "${e}", which has no spoken dialogue (b-roll / cutaway footage).`,
      "Listen and watch, then return compact JSON ONLY with this shape:",
      '{"segments":[{"start":0.0,"end":8.0,"content":"...","shotType":"wide","cutawayCandidate":true,"confidence":0.7}]}',
      "Break the clip into a few meaningful time ranges. For each range, describe the visual content and ambient sound,",
      "name a likely shotType, and set cutawayCandidate true when the range would work as a cutaway over interview audio.",
      "Return only JSON, no prose."
    ].join(`
`);
  const n = r.map((i) => `[${$a(i.start)}-${$a(i.end)}] ${i.text}`).join(`
`);
  return [
    `You are an assistant film editor analyzing the AUDIO performance in "${e}".`,
    "Here is the transcript with timecodes (seconds):",
    n,
    "",
    "Listen to the audio and, for each transcript segment (matched by its timecodes), describe HOW it was said.",
    "Return compact JSON ONLY with this shape:",
    `{"segments":[{"start":0.0,"end":3.2,"delivery":"voice steadies then cracks on 'home'","emotion":"reflective","energy":"low-and-deliberate","pace":"slow","notable":["400ms pause before 'home'","usable as hook"],"confidence":0.8}]}`,
    "Use rich descriptive text, NOT numeric scores. Capture vocal delivery, emotion, energy, pace, hesitations,",
    "laughter, breaths, and reflective pauses. Keep each field short. Return only JSON, no prose."
  ].join(`
`);
}
function iw(t) {
  var i;
  const e = t.trim();
  if (!e) return null;
  const r = (o) => {
    try {
      return JSON.parse(o), o;
    } catch {
      return null;
    }
  }, n = r(e);
  if (n) return n;
  for (const o of e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const a = (i = o[1]) == null ? void 0 : i.trim();
    if (a && r(a)) return a;
  }
  for (const [o, a] of [["{", "}"], ["[", "]"]]) {
    const s = e.indexOf(o);
    if (s === -1) continue;
    let l = 0;
    for (let u = s; u < e.length; u++) {
      const d = e[u];
      if (d === o) l++;
      else if (d === a && (l--, l === 0)) {
        const c = e.slice(s, u + 1), p = r(c);
        if (p) return p;
        break;
      }
    }
  }
  return null;
}
function Gn(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : void 0;
}
function _t(t) {
  return typeof t == "string" && t.trim() ? t.trim() : void 0;
}
function ow(t) {
  if (!Array.isArray(t)) return;
  const e = t.filter((r) => typeof r == "string" && r.trim().length > 0).map((r) => r.trim());
  return e.length > 0 ? e : void 0;
}
function aw(t) {
  const e = iw(t);
  if (!e) return [];
  let r;
  try {
    r = JSON.parse(e);
  } catch {
    return [];
  }
  return (Array.isArray(r) ? r : r && typeof r == "object" && Array.isArray(r.segments) ? r.segments : []).flatMap((i) => {
    if (!i || typeof i != "object") return [];
    const o = i, a = Gn(o.start), s = Gn(o.end);
    return a === void 0 || s === void 0 || s <= a ? [] : [{
      start: a,
      end: s,
      delivery: _t(o.delivery),
      emotion: _t(o.emotion),
      energy: _t(o.energy),
      pace: _t(o.pace),
      notable: ow(o.notable),
      content: _t(o.content),
      shotType: _t(o.shotType),
      cutawayCandidate: typeof o.cutawayCandidate == "boolean" ? o.cutawayCandidate : void 0,
      confidence: Gn(o.confidence)
    }];
  });
}
function sw(t) {
  return new Promise((e) => {
    const r = [
      "-i",
      t,
      "-af",
      `silencedetect=noise=${ew}dB:d=${tw}`,
      "-f",
      "null",
      "-"
    ], n = ae(ve(), r);
    let i = "";
    n.stderr.on("data", (o) => {
      i += o.toString();
    }), n.on("error", () => e("")), n.on("close", () => e(i));
  });
}
const hu = "gemini-2.5-flash", lw = "fal-ai/video-understanding";
async function uw(t, e) {
  var n;
  const r = ((n = t.model) == null ? void 0 : n.trim()) || hu;
  try {
    return { rawText: await Zl({
      mediaPath: t.mediaPath,
      prompt: e,
      model: r
    }), model: r };
  } catch (i) {
    if (!(i instanceof Hr)) throw i;
    if (!t.apiKey)
      throw new Error("Gemini CLI could not analyze this clip and no fal.ai API key is set for fallback.");
    return { rawText: await ql({
      apiKey: t.apiKey,
      videoPath: t.mediaPath,
      prompt: e,
      detailedAnalysis: !0
    }), model: lw };
  }
}
async function dw(t) {
  var r;
  const e = {
    assetId: t.assetId,
    status: "failed",
    version: Z_,
    model: ((r = t.model) == null ? void 0 : r.trim()) || hu,
    silenceMap: [],
    segments: [],
    hasSpeech: t.transcript.length > 0,
    sourceDurationSec: t.durationSec
  };
  try {
    const n = await sw(t.mediaPath).catch(() => ""), i = rw(n), o = nw({ assetName: t.assetName, transcript: t.transcript }), { rawText: a, model: s } = await uw(t, o), l = aw(a);
    return {
      ...e,
      model: s,
      status: "ready",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      silenceMap: i,
      segments: l,
      error: i.length === 0 ? "Silence detection returned no intervals." : void 0
    };
  } catch (n) {
    const i = n instanceof Error ? n.message : String(n);
    return { ...e, error: i || "Acoustic analysis failed." };
  }
}
function cw() {
  I.handle("acoustic:analyze-asset", async (t, e) => dw(e));
}
const fw = process.platform === "darwin" && !W.isPackaged;
fw && (W.disableHardwareAcceleration(), W.commandLine.appendSwitch("disable-gpu-compositing"), console.log("[app] hardware acceleration disabled for macOS dev wake stability"));
W.commandLine.appendSwitch("disable-renderer-backgrounding");
W.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
za.registerSchemesAsPrivileged([
  {
    scheme: "local-media",
    privileges: {
      standard: !0,
      secure: !0,
      supportFetchAPI: !0,
      stream: !0,
      bypassCSP: !0,
      // Without this the renderer cannot read pixels back from local media:
      // drawing such a video to a canvas taints it and toDataURL throws, which
      // is what left the Trim filmstrip blank. The scheme only ever serves the
      // user's own files to the app's own window.
      corsEnabled: !0
    }
  }
]);
let Z = null, tr = null, ee = null, Be = null;
const pw = Date.now(), Fa = "cinegen-desktop", Ba = "CineGen", mw = ".cinegen-user-data-migrated.json", Va = "CineGen", hw = 700;
process.on("message", (t) => {
  if (t === "electron-vite&type=hot-reload")
    for (const e of Q.getAllWindows())
      e.isDestroyed() || e.webContents.reload();
});
function Hn(t) {
  for (const e of Q.getAllWindows())
    e.isDestroyed() || e.webContents.send("app:power-event", { type: t });
}
const gw = {
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
function yw() {
  try {
    const t = W.getPath("appData"), e = w.join(t, Fa), r = w.join(t, Ba);
    return W.getPath("userData") !== r && W.setPath("userData", r), console.log("[app] userData path:", r), { preferredUserDataPath: r, legacyUserDataPath: e };
  } catch (t) {
    console.error("[app] failed to configure userData path:", t);
    const e = W.getPath("appData"), r = w.join(e, Ba), n = w.join(e, Fa);
    return { preferredUserDataPath: r, legacyUserDataPath: n };
  }
}
const _w = yw();
try {
  W.setName(Va), process.platform === "darwin" && W.setAboutPanelOptions({
    applicationName: Va,
    applicationVersion: W.getVersion(),
    version: W.getVersion()
  });
} catch (t) {
  console.error("[app] failed to configure app display name:", t);
}
async function ww() {
  const { preferredUserDataPath: t, legacyUserDataPath: e } = _w;
  if (t === e || !D.existsSync(e)) return;
  const r = w.join(t, mw);
  if (!D.existsSync(r))
    try {
      await j.mkdir(t, { recursive: !0 }), await j.cp(e, t, { recursive: !0, force: !0 }), await j.writeFile(
        r,
        JSON.stringify({
          migratedFrom: e,
          migratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, null, 2),
        "utf-8"
      ), console.log("[app] migrated userData:", e, "->", t);
    } catch (n) {
      console.error("[app] failed to migrate userData:", n);
    }
}
function bw() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    process.cwd(),
    W.getAppPath(),
    process.resourcesPath
  ], r = [];
  for (const n of e)
    for (const i of t) {
      const o = w.join(n, "build", i);
      D.existsSync(o) && r.push(o);
    }
  return r;
}
function vw(t) {
  const e = w.extname(t).toLowerCase();
  return gw[e] ?? "application/octet-stream";
}
function Tw(t, e) {
  return t.get(e) ?? t.get(e.toLowerCase()) ?? t.get(e.toUpperCase());
}
function Ew(t, e) {
  var a;
  if (!t.startsWith("bytes=")) return null;
  const r = ((a = t.slice(6).split(",")[0]) == null ? void 0 : a.trim()) ?? "", n = /^(\d*)-(\d*)$/.exec(r);
  if (!n) return null;
  const i = n[1], o = n[2];
  if (!i && o) {
    const s = Number.parseInt(o, 10);
    if (!Number.isFinite(s) || s <= 0) return null;
    const l = Math.max(e - s, 0), u = e - 1;
    return l <= u ? { start: l, end: u } : null;
  }
  if (i) {
    const s = Number.parseInt(i, 10), l = o ? Number.parseInt(o, 10) : e - 1;
    if (!Number.isFinite(s) || !Number.isFinite(l)) return null;
    const u = Math.min(l, e - 1);
    return s < 0 || u < s || s >= e ? null : { start: s, end: u };
  }
  return null;
}
function Sw(t) {
  const e = new URL(t);
  if (e.hostname !== "file") return null;
  let r = decodeURIComponent(e.pathname);
  return process.platform === "win32" && r.startsWith("/") && (r = r.slice(1)), w.normalize(r);
}
async function Iw() {
  var n, i, o, a;
  const t = w.join(process.cwd(), ".data", "dev", "project.json"), e = w.join(z.homedir(), "Documents", "CINEGEN"), r = w.join(e, "projects.json");
  try {
    await j.access(t);
  } catch {
    return;
  }
  try {
    await j.access(r);
    return;
  } catch {
  }
  try {
    const s = await j.readFile(t, "utf-8"), l = JSON.parse(s), u = ((n = l.project) == null ? void 0 : n.id) || J.randomUUID(), d = ((i = l.project) == null ? void 0 : i.name) || "Migrated Project";
    await j.mkdir(w.join(e, u), { recursive: !0 }), await j.writeFile(
      w.join(e, u, "project.json"),
      JSON.stringify(l, null, 2),
      "utf-8"
    );
    const c = {
      projects: [{
        id: u,
        name: d,
        createdAt: ((o = l.project) == null ? void 0 : o.createdAt) || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: ((a = l.project) == null ? void 0 : a.updatedAt) || (/* @__PURE__ */ new Date()).toISOString(),
        assetCount: Array.isArray(l.assets) ? l.assets.length : 0,
        elementCount: Array.isArray(l.elements) ? l.elements.length : 0,
        thumbnail: null
      }]
    };
    await j.writeFile(r, JSON.stringify(c, null, 2), "utf-8"), console.log(`[migration] Migrated legacy project "${d}" to ${e}/${u}`);
  } catch (s) {
    console.error("[migration] Failed to migrate legacy data:", s);
  }
}
W.whenReady().then(async () => {
  if (await ww(), process.platform === "darwin") {
    const r = bw();
    console.log("[dock] icon candidates:", r);
    for (const n of r)
      try {
        const i = _u.createFromPath(n);
        if (console.log("[dock] testing icon:", n, "empty?", i.isEmpty()), !i.isEmpty()) {
          await Promise.resolve(W.dock.setIcon(i)), console.log("[dock] applied icon:", n);
          break;
        }
      } catch (i) {
        console.error("[dock] failed to apply icon:", n, i);
      }
  }
  za.handle("local-media", async (r) => {
    try {
      const n = Sw(r.url);
      if (!n)
        return new Response("Invalid local-media host", { status: 400 });
      const i = await j.stat(n);
      if (!i.isFile())
        return new Response("Not a file", { status: 404 });
      const o = i.size, a = vw(n), s = Tw(r.headers, "range");
      if (r.method.toUpperCase() === "HEAD")
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": a,
            "Content-Length": String(o),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*"
          }
        });
      if (s) {
        const d = Ew(s, o);
        if (!d)
          return new Response("Invalid Range", { status: 416 });
        const c = d.start, p = d.end;
        if (c < 0 || p < c || c >= o)
          return new Response("Range Not Satisfiable", {
            status: 416,
            headers: {
              "Content-Range": `bytes */${o}`
            }
          });
        const f = p - c + 1, m = D.createReadStream(n, { start: c, end: p }), y = oo.toWeb(m);
        return new Response(y, {
          status: 206,
          headers: {
            "Content-Type": a,
            "Content-Length": String(f),
            "Content-Range": `bytes ${c}-${p}/${o}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      const l = D.createReadStream(n), u = oo.toWeb(l);
      return new Response(u, {
        status: 200,
        headers: {
          "Content-Type": a,
          "Content-Length": String(o),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (n) {
      return console.error("[local-media] Failed request:", r.url, n), new Response("Invalid local-media URL", { status: 400 });
    }
  }), Gu(), Wu(() => Z), Ou(), cp(), Rc(), Ep(), Um(), Fm(), Hm(), oh(), Gh(), ig(), ug(), wg(), Bg(), Mg(), Gg(), Hg(), ly(), cy(), fy(), By(), t_(), n_(Se), bh(), Q_(), cw(), c_(), R_(), F_(), X_(), await Iw(), I.handle("pm:open-project", async (r, n, i) => n === "__close__" ? (ee == null || ee.close(), ee = null, { ok: !0 }) : ((!Z || Z.isDestroyed()) && (Z = co()), Z.once("ready-to-show", () => {
    Z == null || Z.maximize(), Z == null || Z.show(), Z == null || Z.webContents.send("pm:open-project", n, i);
  }), Z.webContents.getURL() !== "" && (Z.maximize(), Z.show(), Z.webContents.send("pm:open-project", n, i)), ee == null || ee.close(), ee = null, { ok: !0 })), I.handle("pm:open", async () => ee && !ee.isDestroyed() ? (ee.focus(), { ok: !0 }) : (ee = vn(), ee.on("closed", () => {
    ee = null;
  }), { ok: !0 })), tr = $u(), Z = co();
  const t = 3e3;
  Z.once("ready-to-show", () => {
    const r = Date.now() - pw, n = Math.max(0, t - r);
    setTimeout(() => {
      tr == null || tr.close(), tr = null, ee = vn(), ee.on("closed", () => {
        ee = null;
      });
    }, n);
  }), W.on("activate", () => {
    Q.getAllWindows().length === 0 && (ee = vn(), ee.on("closed", () => {
      ee = null;
    }));
  });
  const e = (r) => {
    Be && (clearTimeout(Be), Be = null), Be = setTimeout(() => {
      Be = null, console.log(`[app] Wake recovery triggered by ${r}`), Du(r);
    }, hw);
  };
  yn.on("resume", () => {
    Hn("resume"), e("resume");
  }), yn.on("unlock-screen", () => {
    Hn("unlock-screen"), e("unlock-screen");
  }), yn.on("suspend", () => {
    Hn("suspend");
  });
});
W.on("before-quit", () => {
  Xu(), Be && (clearTimeout(Be), Be = null), r_(), Vy(), J_();
});
W.on("window-all-closed", () => {
  process.platform !== "darwin" && W.quit();
});
export {
  zw as H,
  Ww as b
};
