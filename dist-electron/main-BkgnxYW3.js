var Ws = Object.defineProperty;
var Xs = (t, e, r) => e in t ? Ws(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r;
var U = (t, e, r) => Xs(t, typeof e != "symbol" ? e + "" : e, r);
import { BrowserWindow as Q, screen as Bo, ipcMain as x, app as J, shell as Ho, safeStorage as Zt, dialog as ui, protocol as Go, nativeImage as Js, powerMonitor as Fr } from "electron";
import R, { writeFile as Ks, chmod as Ys, mkdir as Je } from "node:fs/promises";
import B from "node:fs";
import w from "node:path";
import W from "node:os";
import X, { randomUUID as ci } from "node:crypto";
import { Readable as fi } from "node:stream";
import Rn from "better-sqlite3";
import { spawn as ie, execFile as pt } from "node:child_process";
import { promisify as vr } from "node:util";
import { lookup as Qs } from "node:dns/promises";
import { createServer as Zs } from "node:http";
import { request as el } from "node:https";
import tl, { isIP as On } from "node:net";
import { createRequire as zo } from "node:module";
import { fileURLToPath as Pn } from "node:url";
import { Worker as Vo } from "worker_threads";
const rl = 1200, nl = 150, il = 1e3, pi = 2800, Wo = /* @__PURE__ */ new WeakMap(), Xo = /* @__PURE__ */ new WeakMap(), pr = /* @__PURE__ */ new WeakMap(), Jo = /* @__PURE__ */ new WeakMap();
function ol() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    ...t.map((r) => w.resolve(process.cwd(), "build", r)),
    ...t.map((r) => w.resolve(import.meta.dirname, "../build", r))
  ];
  for (const r of e)
    if (B.existsSync(r)) return r;
}
const mt = ol(), Tr = w.join(import.meta.dirname, "."), Ko = w.join(Tr, "../dist"), Xt = process.env.VITE_DEV_SERVER_URL;
function mi(t) {
  return Xt ? t.loadURL(`${Xt}?pm=1`) : t.loadFile(w.join(Ko, "index.html"), { query: { pm: "1" } });
}
function hi(t) {
  return Xt ? t.loadURL(Xt) : t.loadFile(w.join(Ko, "index.html"));
}
function Br(t, e) {
  const r = pr.get(t) ?? /* @__PURE__ */ new Set();
  r.add(e), pr.set(t, r);
}
function er(t, e) {
  var r;
  (r = pr.get(t)) == null || r.delete(e);
}
function Yo(t) {
  const e = pr.get(t);
  if (e) {
    for (const r of e)
      clearTimeout(r);
    e.clear();
  }
}
function al(t) {
  return new Promise((e, r) => {
    let n = !1;
    const i = () => {
      t.webContents.removeListener("did-finish-load", o), t.webContents.removeListener("did-fail-load", a);
    }, o = () => {
      n || (n = !0, i(), e());
    }, a = (s, l, d, u, c) => {
      n || !c || l === -3 || (n = !0, i(), r(new Error(`did-fail-load ${l}: ${d}`)));
    };
    t.webContents.on("did-finish-load", o), t.webContents.on("did-fail-load", a), t.webContents.reloadIgnoringCache();
  });
}
async function cn(t, e, r, n) {
  if (t.isDestroyed()) return;
  if (console.warn(`[window] ${e} reloading after wake: ${n}`), t.webContents.getURL()) {
    await al(t);
    return;
  }
  await r(t);
}
async function sl(t, e, r) {
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
      await cn(t, e, r, "blank renderer DOM after resume");
    } catch (n) {
      console.warn(`[window] ${e} health check failed after wake:`, n), await cn(t, e, r, "resume health check failed");
    }
}
function ll(t) {
  for (const e of Q.getAllWindows()) {
    if (e.isDestroyed()) continue;
    const r = Wo.get(e);
    if (!r) continue;
    const n = Xo.get(e) ?? "window";
    Yo(e), Jo.set(e, Date.now() + pi + 1e3);
    let i = null;
    const o = setTimeout(() => {
      er(e, o), !e.isDestroyed() && (console.log(`[window] ${n} wake recovery started: ${t}`), e.webContents.invalidate(), e.webContents.executeJavaScript(
        `(() => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
        !0
      ).catch(() => {
      }), e.isVisible() && (e.show(), e.focus()));
    }, nl);
    Br(e, o);
    const a = setTimeout(() => {
      er(e, a), (async () => {
        try {
          await sl(e, n, r), i && (clearTimeout(i), er(e, i), i = null);
        } catch (s) {
          console.warn(`[window] ${n} resume health check threw:`, s);
        }
      })();
    }, il);
    Br(e, a), i = setTimeout(() => {
      er(e, i), !e.isDestroyed() && cn(e, n, r, `hard reload after ${t}`).catch((s) => {
        console.error(`[window] ${n} hard reload failed:`, s);
      });
    }, pi), Br(e, i);
  }
}
function Qo(t, e, r) {
  let n = null;
  Wo.set(t, r), Xo.set(t, e);
  const i = (o) => {
    if (t.isDestroyed() || n) return;
    const a = Jo.get(t) ?? 0;
    if (o === "window became unresponsive" && Date.now() < a) {
      console.warn(`[window] ${e} suppressing reload during wake recovery: ${o}`);
      return;
    }
    console.warn(`[window] ${e} scheduling reload: ${o}`), n = setTimeout(() => {
      n = null, !t.isDestroyed() && r(t).catch((s) => {
        console.error(`[window] ${e} reload failed:`, s);
      });
    }, rl);
  };
  t.on("unresponsive", () => {
    i("window became unresponsive");
  }), t.on("closed", () => {
    n && (clearTimeout(n), n = null), Yo(t);
  }), t.webContents.on("render-process-gone", (o, a) => {
    i(`render process gone (${a.reason})`);
  }), t.webContents.on("did-fail-load", (o, a, s, l, d) => {
    !d || a === -3 || i(`did-fail-load ${a}: ${s}`);
  });
}
function Hr() {
  const { width: t, height: e } = Bo.getPrimaryDisplay().workAreaSize, r = 900, n = 580, i = new Q({
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
    ...mt ? { icon: mt } : {},
    webPreferences: {
      preload: w.join(Tr, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return Qo(i, "project-manager", mi), mi(i), i;
}
function dl() {
  const { width: t, height: e } = Bo.getPrimaryDisplay().workAreaSize, r = 800, n = 395, i = new Q({
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
    ...mt ? { icon: mt } : {},
    webPreferences: {
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return i.loadFile(w.join(Tr, "splash.html")), i;
}
function gi() {
  const t = new Q({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: !1,
    backgroundColor: "#08090c",
    titleBarStyle: "hiddenInset",
    ...mt ? { icon: mt } : {},
    webPreferences: {
      preload: w.join(Tr, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return Qo(t, "main", hi), hi(t), Xt && t.webContents.openDevTools({ mode: "detach" }), t;
}
function Nn() {
  return w.join(W.homedir(), "Documents", "CINEGEN");
}
function fn() {
  return w.join(Nn(), "projects.json");
}
function Jt(t) {
  return w.join(Nn(), t);
}
function et(t) {
  return w.join(Jt(t), "project.json");
}
function Zo() {
  return X.randomUUID();
}
function ea() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function ta() {
  await R.mkdir(Nn(), { recursive: !0 });
}
async function tr() {
  try {
    const t = await R.readFile(fn(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function Gr(t) {
  await ta();
  const e = fn() + ".tmp";
  await R.writeFile(e, JSON.stringify(t, null, 2), "utf-8"), await R.rename(e, fn());
}
function ul(t, e) {
  const r = ea(), n = {
    id: Zo(),
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
function cl(t) {
  const e = w.join(Jt(t), "project.json");
  if (!B.existsSync(e)) return null;
  try {
    const r = B.readFileSync(e, "utf-8"), i = (JSON.parse(r).assets ?? []).find(
      (o) => (o.type === "video" || o.type === "image") && o.thumbnailUrl
    );
    return (i == null ? void 0 : i.thumbnailUrl) ?? null;
  } catch {
    return null;
  }
}
function fl(t) {
  const e = w.join(Jt(t), "project.db");
  if (!B.existsSync(e)) return null;
  try {
    const r = new Rn(e, { readonly: !0 }), n = r.prepare(
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
function pl() {
  x.handle("project:list", async () => (await tr()).projects.map((e) => {
    const r = e.useSqlite ? fl(e.id) : cl(e.id);
    return { ...e, thumbnail: r };
  })), x.handle("project:create", async (t, e) => {
    const r = e.trim();
    if (!r || r.length > 100)
      throw new Error("Project name must be 1-100 characters");
    const n = Zo(), i = ul(n, r);
    await ta(), await R.mkdir(Jt(n), { recursive: !0 });
    const o = et(n) + ".tmp";
    await R.writeFile(o, JSON.stringify(i, null, 2), "utf-8"), await R.rename(o, et(n));
    const a = await tr();
    return a.projects.unshift({
      id: n,
      name: r,
      createdAt: i.project.createdAt,
      updatedAt: i.project.updatedAt,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null
    }), await Gr(a), i;
  }), x.handle("project:load", async (t, e) => {
    const r = await R.readFile(et(e), "utf-8");
    return JSON.parse(r);
  }), x.handle("project:save", async (t, e, r) => {
    let n;
    try {
      const l = await R.readFile(et(e), "utf-8");
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
        updatedAt: ea()
      }
    }, o = et(e) + ".tmp";
    await R.writeFile(o, JSON.stringify(i, null, 2), "utf-8"), await R.rename(o, et(e));
    const a = await tr(), s = a.projects.find((l) => l.id === e);
    return s && (s.updatedAt = i.project.updatedAt, s.assetCount = Array.isArray(i.assets) ? i.assets.length : 0, s.elementCount = Array.isArray(i.elements) ? i.elements.length : 0, r.project && r.project.name && (s.name = r.project.name), await Gr(a)), i;
  }), x.handle("project:delete", async (t, e) => {
    await R.rm(Jt(e), { recursive: !0, force: !0 });
    const r = await tr();
    r.projects = r.projects.filter((n) => n.id !== e), await Gr(r);
  });
}
function ml(t) {
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
var ze = {}, tt = {}, zr = {}, xt = {}, yi;
function ra() {
  return yi || (yi = 1, (function(t) {
    var e = xt && xt.__awaiter || function(i, o, a, s) {
      function l(d) {
        return d instanceof a ? d : new a(function(u) {
          u(d);
        });
      }
      return new (a || (a = Promise))(function(d, u) {
        function c(m) {
          try {
            f(s.next(m));
          } catch (y) {
            u(y);
          }
        }
        function p(m) {
          try {
            f(s.throw(m));
          } catch (y) {
            u(y);
          }
        }
        function f(m) {
          m.done ? d(m.value) : l(m.value).then(c, p);
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
  })(xt)), xt;
}
var ye = {}, Vr = {}, _i;
function qn() {
  return _i || (_i = 1, (function(t) {
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
  })(Vr)), Vr;
}
var wi;
function Qe() {
  if (wi) return ye;
  wi = 1;
  var t = ye && ye.__awaiter || function(s, l, d, u) {
    function c(p) {
      return p instanceof d ? p : new d(function(f) {
        f(p);
      });
    }
    return new (d || (d = Promise))(function(p, f) {
      function m(h) {
        try {
          g(u.next(h));
        } catch (_) {
          f(_);
        }
      }
      function y(h) {
        try {
          g(u.throw(h));
        } catch (_) {
          f(_);
        }
      }
      function g(h) {
        h.done ? p(h.value) : c(h.value).then(m, y);
      }
      g((u = u.apply(s, l || [])).next());
    });
  };
  Object.defineProperty(ye, "__esModule", { value: !0 }), ye.ValidationError = ye.ApiError = void 0, ye.defaultResponseHandler = o, ye.resultResponseHandler = a;
  const e = qn(), r = "x-fal-request-id";
  class n extends Error {
    constructor({ message: l, status: d, body: u, requestId: c, timeoutType: p }) {
      super(l), this.name = "ApiError", this.status = d, this.body = u, this.requestId = c || "", this.timeoutType = p;
    }
    /**
     * Returns true if this error was caused by a user-specified timeout
     * (via startTimeout parameter). These errors should NOT be retried.
     */
    get isUserTimeout() {
      return this.status === 504 && this.timeoutType === "user";
    }
  }
  ye.ApiError = n;
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
      return this.fieldErrors.filter((d) => d.loc[d.loc.length - 1] === l);
    }
  }
  ye.ValidationError = i;
  function o(s) {
    return t(this, void 0, void 0, function* () {
      var l;
      const { status: d, statusText: u } = s, c = (l = s.headers.get("Content-Type")) !== null && l !== void 0 ? l : "", p = s.headers.get(r) || void 0, f = s.headers.get(e.REQUEST_TIMEOUT_TYPE_HEADER) || void 0;
      if (!s.ok) {
        if (c.includes("application/json")) {
          const m = yield s.json(), y = d === 422 ? i : n;
          throw new y({
            message: m.message || u,
            status: d,
            body: m,
            requestId: p,
            timeoutType: f
          });
        }
        throw new n({
          message: `HTTP ${d}: ${u}`,
          status: d,
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
  return ye;
}
var At = {}, ue = {}, bi;
function $e() {
  if (bi) return ue;
  bi = 1;
  var t = ue && ue.__awaiter || function(c, p, f, m) {
    function y(g) {
      return g instanceof f ? g : new f(function(h) {
        h(g);
      });
    }
    return new (f || (f = Promise))(function(g, h) {
      function _(S) {
        try {
          E(m.next(S));
        } catch (T) {
          h(T);
        }
      }
      function b(S) {
        try {
          E(m.throw(S));
        } catch (T) {
          h(T);
        }
      }
      function E(S) {
        S.done ? g(S.value) : y(S.value).then(_, b);
      }
      E((m = m.apply(c, p || [])).next());
    });
  };
  Object.defineProperty(ue, "__esModule", { value: !0 }), ue.ensureEndpointIdFormat = e, ue.parseEndpointId = n, ue.resolveEndpointPath = i, ue.isValidUrl = o, ue.throttle = a, ue.isReact = l, ue.isPlainObject = d, ue.sleep = u;
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
    return (...g) => {
      !y && f ? (c(...g), y = Date.now()) : (m && clearTimeout(m), m = setTimeout(() => {
        Date.now() - y >= p && (c(...g), y = Date.now());
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
  function d(c) {
    return !!c && Object.getPrototypeOf(c) === Object.prototype;
  }
  function u(c) {
    return t(this, void 0, void 0, function* () {
      return new Promise((p) => setTimeout(p, c));
    });
  }
  return ue;
}
var Ei;
function Sr() {
  return Ei || (Ei = 1, (function(t) {
    var e = At && At.__awaiter || function(s, l, d, u) {
      function c(p) {
        return p instanceof d ? p : new d(function(f) {
          f(p);
        });
      }
      return new (d || (d = Promise))(function(p, f) {
        function m(h) {
          try {
            g(u.next(h));
          } catch (_) {
            f(_);
          }
        }
        function y(h) {
          try {
            g(u.throw(h));
          } catch (_) {
            f(_);
          }
        }
        function g(h) {
          h.done ? p(h.value) : c(h.value).then(m, y);
        }
        g((u = u.apply(s, l || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.DEFAULT_RETRY_OPTIONS = t.DEFAULT_RETRYABLE_STATUS_CODES = void 0, t.isRetryableError = i, t.calculateBackoffDelay = o, t.executeWithRetry = a;
    const r = Qe(), n = $e();
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
    function o(s, l, d, u, c) {
      const p = Math.min(l * Math.pow(u, s), d);
      if (c) {
        const f = 0.25 * p * (Math.random() * 2 - 1);
        return Math.max(0, p + f);
      }
      return p;
    }
    function a(s, l, d) {
      return e(this, void 0, void 0, function* () {
        const u = {
          totalAttempts: 0,
          totalDelay: 0
        };
        let c;
        for (let p = 0; p <= l.maxRetries; p++) {
          u.totalAttempts++;
          try {
            return { result: yield s(), metrics: u };
          } catch (f) {
            if (c = f, u.lastError = f, p === l.maxRetries || !i(f, l.retryableStatusCodes))
              throw f;
            const m = o(p, l.baseDelay, l.maxDelay, l.backoffMultiplier, l.enableJitter);
            u.totalDelay += m, d && d(p + 1, f, m), yield (0, n.sleep)(m);
          }
        }
        throw c;
      });
    }
  })(At)), At;
}
var jt = {};
const hl = "@fal-ai/client", gl = "1.9.4", yl = {
  name: hl,
  version: gl
};
var vi;
function Cn() {
  if (vi) return jt;
  vi = 1, Object.defineProperty(jt, "__esModule", { value: !0 }), jt.isBrowser = t, jt.getUserAgent = r;
  function t() {
    return typeof window < "u" && typeof window.document < "u";
  }
  let e = null;
  function r() {
    if (e !== null)
      return e;
    const n = yl;
    return e = `${n.name}/${n.version}`, e;
  }
  return jt;
}
var Ti;
function Ln() {
  return Ti || (Ti = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.credentialsFromEnv = void 0, t.resolveDefaultFetch = o, t.createConfig = d, t.getRestApiUrl = u;
    const e = ra(), r = Qe(), n = Sr(), i = Cn();
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
    function d(c) {
      var p;
      let f = Object.assign(Object.assign(Object.assign({}, l), c), {
        fetch: (p = c.fetch) !== null && p !== void 0 ? p : o(),
        // Merge retry configuration with defaults
        retry: Object.assign(Object.assign({}, n.DEFAULT_RETRY_OPTIONS), c.retry || {})
      });
      c.proxyUrl && (f = Object.assign(Object.assign({}, f), { requestMiddleware: (0, e.withMiddleware)(f.requestMiddleware, (0, e.withProxy)({ targetUrl: c.proxyUrl })) }));
      const { credentials: m, suppressLocalCredentialsWarning: y } = f, g = typeof m == "function" ? m() : m;
      return (0, i.isBrowser)() && g && !y && console.warn("The fal credentials are exposed in the browser's environment. That's not recommended for production use cases."), f;
    }
    function u() {
      return "https://rest.fal.ai";
    }
  })(zr)), zr;
}
var Ie = {}, xe = {}, Si;
function Yt() {
  if (Si) return xe;
  Si = 1;
  var t = xe && xe.__awaiter || function(l, d, u, c) {
    function p(f) {
      return f instanceof u ? f : new u(function(m) {
        m(f);
      });
    }
    return new (u || (u = Promise))(function(f, m) {
      function y(_) {
        try {
          h(c.next(_));
        } catch (b) {
          m(b);
        }
      }
      function g(_) {
        try {
          h(c.throw(_));
        } catch (b) {
          m(b);
        }
      }
      function h(_) {
        _.done ? f(_.value) : p(_.value).then(y, g);
      }
      h((c = c.apply(l, d || [])).next());
    });
  }, e = xe && xe.__rest || function(l, d) {
    var u = {};
    for (var c in l) Object.prototype.hasOwnProperty.call(l, c) && d.indexOf(c) < 0 && (u[c] = l[c]);
    if (l != null && typeof Object.getOwnPropertySymbols == "function")
      for (var p = 0, c = Object.getOwnPropertySymbols(l); p < c.length; p++)
        d.indexOf(c[p]) < 0 && Object.prototype.propertyIsEnumerable.call(l, c[p]) && (u[c[p]] = l[c[p]]);
    return u;
  };
  Object.defineProperty(xe, "__esModule", { value: !0 }), xe.dispatchRequest = a, xe.buildUrl = s;
  const r = Sr(), n = Cn(), i = $e(), o = typeof navigator < "u" && (navigator == null ? void 0 : navigator.userAgent) === "Cloudflare-Workers";
  function a(l) {
    return t(this, void 0, void 0, function* () {
      var d;
      const { targetUrl: u, input: c, config: p, options: f = {} } = l, { credentials: m, requestMiddleware: y, responseHandler: g, fetch: h } = p, _ = Object.assign(Object.assign({}, p.retry), f.retry || {}), b = () => t(this, void 0, void 0, function* () {
        var S, T, I;
        const v = (0, n.isBrowser)() ? {} : { "User-Agent": (0, n.getUserAgent)() }, A = typeof m == "function" ? m() : m, { method: q, url: N, headers: D } = yield y({
          method: ((T = (S = l.method) !== null && S !== void 0 ? S : f.method) !== null && T !== void 0 ? T : "post").toUpperCase(),
          url: u,
          headers: l.headers
        }), $ = A ? { Authorization: `Key ${A}` } : {}, G = Object.assign(Object.assign(Object.assign(Object.assign({}, $), { Accept: "application/json", "Content-Type": "application/json" }), v), D ?? {}), { responseHandler: z, retry: k } = f, P = e(f, ["responseHandler", "retry"]), H = yield h(N, Object.assign(Object.assign(Object.assign(Object.assign({}, P), { method: q, headers: Object.assign(Object.assign({}, G), (I = P.headers) !== null && I !== void 0 ? I : {}) }), !o && { mode: "cors" }), { signal: f.signal, body: q.toLowerCase() !== "get" && c ? JSON.stringify(c) : void 0 }));
        return yield (z ?? g)(H);
      });
      let E;
      for (let S = 0; S <= _.maxRetries; S++)
        try {
          return yield b();
        } catch (T) {
          if (E = T, S === _.maxRetries || !(0, r.isRetryableError)(T, _.retryableStatusCodes) || ((d = f.signal) === null || d === void 0 ? void 0 : d.aborted))
            throw T;
          const v = (0, r.calculateBackoffDelay)(S, _.baseDelay, _.maxDelay, _.backoffMultiplier, _.enableJitter);
          yield (0, i.sleep)(v);
        }
      throw E;
    });
  }
  function s(l, d = {}) {
    var u, c;
    const p = ((u = d.method) !== null && u !== void 0 ? u : "post").toLowerCase(), f = ((c = d.path) !== null && c !== void 0 ? c : "").replace(/^\//, "").replace(/\/{2,}/, "/"), m = d.input, y = Object.assign(Object.assign({}, d.query || {}), p === "get" ? m : {}), g = Object.keys(y).length > 0 ? `?${new URLSearchParams(y).toString()}` : "";
    if ((0, i.isValidUrl)(l))
      return `${l.endsWith("/") ? l : `${l}/`}${f}${g}`;
    const h = (0, i.ensureEndpointIdFormat)(l);
    return `${`https://${d.subdomain ? `${d.subdomain}.` : ""}fal.run/${h}/${f}`.replace(/\/$/, "")}${g}`;
  }
  return xe;
}
var kt = {}, Ii;
function na() {
  return Ii || (Ii = 1, (function(t) {
    var e = kt && kt.__awaiter || function(m, y, g, h) {
      function _(b) {
        return b instanceof g ? b : new g(function(E) {
          E(b);
        });
      }
      return new (g || (g = Promise))(function(b, E) {
        function S(v) {
          try {
            I(h.next(v));
          } catch (A) {
            E(A);
          }
        }
        function T(v) {
          try {
            I(h.throw(v));
          } catch (A) {
            E(A);
          }
        }
        function I(v) {
          v.done ? b(v.value) : _(v.value).then(S, T);
        }
        I((h = h.apply(m, y || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = void 0, t.getExpirationDurationSeconds = a, t.buildObjectLifecycleHeaders = s, t.createStorageClient = f;
    const r = Ln(), n = Yt(), i = $e();
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
      const [, g] = m.split("/");
      return (y = g.split(/[-;]/)[0]) !== null && y !== void 0 ? y : "bin";
    }
    function d(m, y, g, h) {
      return e(this, void 0, void 0, function* () {
        const _ = m.name || `${Date.now()}.${l(g)}`, b = {};
        if (h) {
          const E = {
            expiration_duration_seconds: a(h),
            allow_io_storage: h.expiresIn !== "immediate"
          };
          b["X-Fal-Object-Lifecycle"] = JSON.stringify(E);
        }
        return yield (0, n.dispatchRequest)({
          method: "POST",
          // NOTE: We want to test V3 without making it the default at the API level
          targetUrl: `${(0, r.getRestApiUrl)()}/storage/upload/initiate?storage_type=fal-cdn-v3`,
          input: {
            content_type: g,
            file_name: _
          },
          config: y,
          headers: b
        });
      });
    }
    function u(m, y, g, h) {
      return e(this, void 0, void 0, function* () {
        const _ = m.name || `${Date.now()}.${l(g)}`, b = {};
        return h && (b["X-Fal-Object-Lifecycle"] = JSON.stringify(h)), yield (0, n.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, r.getRestApiUrl)()}/storage/upload/initiate-multipart?storage_type=fal-cdn-v3`,
          input: {
            content_type: g,
            file_name: _
          },
          config: y,
          headers: b
        });
      });
    }
    function c(m, y, g) {
      return e(this, arguments, void 0, function* (h, _, b, E = 3) {
        if (E === 0)
          throw new Error("Part upload failed, retries exhausted");
        const { fetch: S, responseHandler: T } = b;
        try {
          const I = yield S(h, {
            method: "PUT",
            body: _
          });
          return yield T(I);
        } catch {
          return yield c(h, _, b, E - 1);
        }
      });
    }
    function p(m, y, g) {
      return e(this, void 0, void 0, function* () {
        const { fetch: h, responseHandler: _ } = y, b = m.type || "application/octet-stream", { upload_url: E, file_url: S } = yield u(m, y, b, g), T = 10 * 1024 * 1024, I = Math.ceil(m.size / T), v = new URL(E), A = [];
        for (let D = 0; D < I; D++) {
          const $ = D * T, G = Math.min($ + T, m.size), z = m.slice($, G), k = D + 1, P = `${v.origin}${v.pathname}/${k}${v.search}`;
          A.push(yield c(P, z, y));
        }
        const q = `${v.origin}${v.pathname}/complete${v.search}`, N = yield h(q, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parts: A.map((D) => ({
              partNumber: D.partNumber,
              etag: D.etag
            }))
          })
        });
        return yield _(N), S;
      });
    }
    function f({ config: m }) {
      const y = {
        upload: (g, h) => e(this, void 0, void 0, function* () {
          const _ = h == null ? void 0 : h.lifecycle;
          if (g.size > 94371840)
            return yield p(g, m, _);
          const b = g.type || "application/octet-stream", { fetch: E, responseHandler: S } = m, { upload_url: T, file_url: I } = yield d(g, m, b, _), v = yield E(T, {
            method: "PUT",
            body: g,
            headers: {
              "Content-Type": g.type || "application/octet-stream"
            }
          });
          return yield S(v), I;
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformInput: (g) => e(this, void 0, void 0, function* () {
          if (Array.isArray(g))
            return Promise.all(g.map((h) => y.transformInput(h)));
          if (g instanceof Blob)
            return yield y.upload(g);
          if ((0, i.isPlainObject)(g)) {
            const _ = Object.entries(g).map((E) => e(this, [E], void 0, function* ([S, T]) {
              return [S, yield y.transformInput(T)];
            })), b = yield Promise.all(_);
            return Object.fromEntries(b);
          }
          return g;
        })
      };
      return y;
    }
  })(kt)), kt;
}
var me = {}, rr = {}, xi;
function _l() {
  if (xi) return rr;
  xi = 1, Object.defineProperty(rr, "__esModule", {
    value: !0
  });
  function t(n) {
    let i, o, a, s, l, d, u;
    return c(), {
      feed: p,
      reset: c
    };
    function c() {
      i = !0, o = "", a = 0, s = -1, l = void 0, d = void 0, u = "";
    }
    function p(m) {
      o = o ? o + m : m, i && r(o) && (o = o.slice(e.length)), i = !1;
      const y = o.length;
      let g = 0, h = !1;
      for (; g < y; ) {
        h && (o[g] === `
` && ++g, h = !1);
        let _ = -1, b = s, E;
        for (let S = a; _ < 0 && S < y; ++S)
          E = o[S], E === ":" && b < 0 ? b = S - g : E === "\r" ? (h = !0, _ = S - g) : E === `
` && (_ = S - g);
        if (_ < 0) {
          a = y - g, s = b;
          break;
        } else
          a = 0, s = -1;
        f(o, g, b, _), g += _ + 1;
      }
      g === y ? o = "" : g > 0 && (o = o.slice(g));
    }
    function f(m, y, g, h) {
      if (h === 0) {
        u.length > 0 && (n({
          type: "event",
          id: l,
          event: d || void 0,
          data: u.slice(0, -1)
          // remove trailing newline
        }), u = "", l = void 0), d = void 0;
        return;
      }
      const _ = g < 0, b = m.slice(y, y + (_ ? h : g));
      let E = 0;
      _ ? E = h : m[y + g + 1] === " " ? E = g + 2 : E = g + 1;
      const S = y + E, T = h - E, I = m.slice(S, S + T).toString();
      if (b === "data")
        u += I ? "".concat(I, `
`) : `
`;
      else if (b === "event")
        d = I;
      else if (b === "id" && !I.includes("\0"))
        l = I;
      else if (b === "retry") {
        const v = parseInt(I, 10);
        Number.isNaN(v) || n({
          type: "reconnect-interval",
          value: v
        });
      }
    }
  }
  const e = [239, 187, 191];
  function r(n) {
    return e.every((i, o) => n.charCodeAt(o) === i);
  }
  return rr.createParser = t, rr;
}
var Rt = {}, Ai;
function ia() {
  return Ai || (Ai = 1, (function(t) {
    var e = Rt && Rt.__awaiter || function(a, s, l, d) {
      function u(c) {
        return c instanceof l ? c : new l(function(p) {
          p(c);
        });
      }
      return new (l || (l = Promise))(function(c, p) {
        function f(g) {
          try {
            y(d.next(g));
          } catch (h) {
            p(h);
          }
        }
        function m(g) {
          try {
            y(d.throw(g));
          } catch (h) {
            p(h);
          }
        }
        function y(g) {
          g.done ? c(g.value) : u(g.value).then(f, m);
        }
        y((d = d.apply(a, s || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.TOKEN_EXPIRATION_SECONDS = void 0, t.getTemporaryAuthToken = o;
    const r = Ln(), n = Yt(), i = $e();
    t.TOKEN_EXPIRATION_SECONDS = 120;
    function o(a, s) {
      return e(this, void 0, void 0, function* () {
        const l = (0, i.parseEndpointId)(a), d = yield (0, n.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, r.getRestApiUrl)()}/tokens/`,
          config: s,
          input: {
            allowed_apps: [l.alias],
            token_expiration: t.TOKEN_EXPIRATION_SECONDS
          }
        });
        return typeof d != "string" && d.detail ? d.detail : d;
      });
    }
  })(Rt)), Rt;
}
var ji;
function oa() {
  if (ji) return me;
  ji = 1;
  var t = me && me.__awaiter || function(p, f, m, y) {
    function g(h) {
      return h instanceof m ? h : new m(function(_) {
        _(h);
      });
    }
    return new (m || (m = Promise))(function(h, _) {
      function b(T) {
        try {
          S(y.next(T));
        } catch (I) {
          _(I);
        }
      }
      function E(T) {
        try {
          S(y.throw(T));
        } catch (I) {
          _(I);
        }
      }
      function S(T) {
        T.done ? h(T.value) : g(T.value).then(b, E);
      }
      S((y = y.apply(p, f || [])).next());
    });
  }, e = me && me.__await || function(p) {
    return this instanceof e ? (this.v = p, this) : new e(p);
  }, r = me && me.__asyncGenerator || function(p, f, m) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var y = m.apply(p, f || []), g, h = [];
    return g = {}, b("next"), b("throw"), b("return", _), g[Symbol.asyncIterator] = function() {
      return this;
    }, g;
    function _(A) {
      return function(q) {
        return Promise.resolve(q).then(A, I);
      };
    }
    function b(A, q) {
      y[A] && (g[A] = function(N) {
        return new Promise(function(D, $) {
          h.push([A, N, D, $]) > 1 || E(A, N);
        });
      }, q && (g[A] = q(g[A])));
    }
    function E(A, q) {
      try {
        S(y[A](q));
      } catch (N) {
        v(h[0][3], N);
      }
    }
    function S(A) {
      A.value instanceof e ? Promise.resolve(A.value.v).then(T, I) : v(h[0][2], A);
    }
    function T(A) {
      E("next", A);
    }
    function I(A) {
      E("throw", A);
    }
    function v(A, q) {
      A(q), h.shift(), h.length && E(h[0][0], h[0][1]);
    }
  };
  Object.defineProperty(me, "__esModule", { value: !0 }), me.FalStream = void 0, me.createStreamingClient = c;
  const n = /* @__PURE__ */ _l(), i = ia(), o = Yt(), a = Qe(), s = $e(), l = "text/event-stream", d = 15 * 1e3;
  class u {
    constructor(f, m, y) {
      var g;
      this.listeners = /* @__PURE__ */ new Map(), this.buffer = [], this.currentData = void 0, this.lastEventTimestamp = 0, this.streamClosed = !1, this._requestId = null, this.abortController = new AbortController(), this.start = () => t(this, void 0, void 0, function* () {
        var h, _, b;
        const { endpointId: E, options: S } = this, { input: T, method: I = "post", connectionMode: v = "server", tokenProvider: A } = S;
        try {
          if (v === "client") {
            const q = (0, s.ensureEndpointIdFormat)(E), N = (h = (0, s.resolveEndpointPath)(E, void 0, "/stream")) !== null && h !== void 0 ? h : "", $ = yield (A ? () => A(`${q}${N}`) : () => (console.warn('[fal.stream] Using the default token provider is deprecated. Please provide a `tokenProvider` function when using `connectionMode: "client"`. See https://docs.fal.ai/fal-client/authentication for more information.'), (0, i.getTemporaryAuthToken)(E, this.config)))(), { fetch: G } = this.config, z = new URL(this.url);
            z.searchParams.set("fal_jwt_token", $);
            const k = yield G(z.toString(), {
              method: I.toUpperCase(),
              headers: {
                accept: (_ = S.accept) !== null && _ !== void 0 ? _ : l,
                "content-type": "application/json"
              },
              body: T && I !== "get" ? JSON.stringify(T) : void 0,
              signal: this.abortController.signal
            });
            return this._requestId = k.headers.get("x-fal-request-id"), yield this.handleResponse(k);
          }
          return yield (0, o.dispatchRequest)({
            method: I.toUpperCase(),
            targetUrl: this.url,
            input: T,
            config: this.config,
            options: {
              headers: {
                accept: (b = S.accept) !== null && b !== void 0 ? b : l
              },
              responseHandler: (q) => t(this, void 0, void 0, function* () {
                return this._requestId = q.headers.get("x-fal-request-id"), yield this.handleResponse(q);
              }),
              signal: this.abortController.signal
            }
          });
        } catch (q) {
          this.handleError(q);
        }
      }), this.handleResponse = (h) => t(this, void 0, void 0, function* () {
        var _, b;
        if (!h.ok) {
          try {
            yield (0, a.defaultResponseHandler)(h);
          } catch (N) {
            this.emit("error", N);
          }
          return;
        }
        const E = h.body;
        if (!E) {
          this.emit("error", new a.ApiError({
            message: "Response body is empty.",
            status: 400,
            body: void 0,
            requestId: this._requestId || void 0
          }));
          return;
        }
        if (!((_ = h.headers.get("content-type")) !== null && _ !== void 0 ? _ : "").startsWith(l)) {
          const N = E.getReader(), D = () => {
            N.read().then(({ done: $, value: G }) => {
              if ($) {
                this.emit("done", this.currentData);
                return;
              }
              this.buffer.push(G), this.currentData = G, this.emit("data", G), D();
            });
          };
          D();
          return;
        }
        const T = new TextDecoder("utf-8"), I = h.body.getReader(), v = (0, n.createParser)((N) => {
          if (N.type === "event") {
            const D = N.data;
            try {
              const $ = JSON.parse(D);
              this.buffer.push($), this.currentData = $, this.emit("data", $), this.emit("message", $);
            } catch ($) {
              this.emit("error", $);
            }
          }
        }), A = (b = this.options.timeout) !== null && b !== void 0 ? b : d, q = () => t(this, void 0, void 0, function* () {
          const { value: N, done: D } = yield I.read();
          this.lastEventTimestamp = Date.now(), v.feed(T.decode(N)), Date.now() - this.lastEventTimestamp > A && this.emit("error", new a.ApiError({
            message: `Event stream timed out after ${(A / 1e3).toFixed(0)} seconds with no messages.`,
            status: 408,
            requestId: this._requestId || void 0
          })), D ? this.emit("done", this.currentData) : q().catch(this.handleError);
        });
        q().catch(this.handleError);
      }), this.handleError = (h) => {
        var _;
        if (h.name === "AbortError" || this.signal.aborted)
          return;
        const b = h instanceof a.ApiError ? h : new a.ApiError({
          message: (_ = h.message) !== null && _ !== void 0 ? _ : "An unknown error occurred",
          status: 500,
          requestId: this._requestId || void 0
        });
        this.emit("error", b);
      }, this.on = (h, _) => {
        var b;
        this.listeners.has(h) || this.listeners.set(h, []), (b = this.listeners.get(h)) === null || b === void 0 || b.push(_);
      }, this.emit = (h, _) => {
        const b = this.listeners.get(h) || [];
        for (const E of b)
          E(_);
      }, this.done = () => t(this, void 0, void 0, function* () {
        return this.donePromise;
      }), this.abort = (h) => {
        this.streamClosed || this.abortController.abort(h);
      }, this.endpointId = f, this.config = m, this.url = (g = y.url) !== null && g !== void 0 ? g : (0, o.buildUrl)(f, {
        path: (0, s.resolveEndpointPath)(f, void 0, "/stream"),
        query: y.queryParams
      }), this.options = y, this.donePromise = new Promise((h, _) => {
        this.streamClosed && _(new a.ApiError({
          message: "Streaming connection is already closed.",
          status: 400,
          body: void 0,
          requestId: this._requestId || void 0
        })), this.signal.addEventListener("abort", () => {
          var b;
          h((b = this.currentData) !== null && b !== void 0 ? b : {});
        }), this.on("done", (b) => {
          this.streamClosed = !0, h(b);
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
          const g = this.buffer.shift();
          g && (yield yield e(g)), yield e(new Promise((h) => setTimeout(h, 16)));
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
  me.FalStream = u;
  function c({ config: p, storage: f }) {
    return {
      stream(m, y) {
        return t(this, void 0, void 0, function* () {
          const g = y.input ? yield f.transformInput(y.input) : void 0;
          return new u(m, p, Object.assign(Object.assign({}, y), { input: g }));
        });
      }
    };
  }
  return me;
}
var ki;
function wl() {
  if (ki) return Ie;
  ki = 1;
  var t = Ie && Ie.__awaiter || function(f, m, y, g) {
    function h(_) {
      return _ instanceof y ? _ : new y(function(b) {
        b(_);
      });
    }
    return new (y || (y = Promise))(function(_, b) {
      function E(I) {
        try {
          T(g.next(I));
        } catch (v) {
          b(v);
        }
      }
      function S(I) {
        try {
          T(g.throw(I));
        } catch (v) {
          b(v);
        }
      }
      function T(I) {
        I.done ? _(I.value) : h(I.value).then(E, S);
      }
      T((g = g.apply(f, m || [])).next());
    });
  }, e = Ie && Ie.__rest || function(f, m) {
    var y = {};
    for (var g in f) Object.prototype.hasOwnProperty.call(f, g) && m.indexOf(g) < 0 && (y[g] = f[g]);
    if (f != null && typeof Object.getOwnPropertySymbols == "function")
      for (var h = 0, g = Object.getOwnPropertySymbols(f); h < g.length; h++)
        m.indexOf(g[h]) < 0 && Object.prototype.propertyIsEnumerable.call(f, g[h]) && (y[g[h]] = f[g[h]]);
    return y;
  };
  Object.defineProperty(Ie, "__esModule", { value: !0 }), Ie.createQueueClient = void 0;
  const r = qn(), n = Yt(), i = Qe(), o = Sr(), a = na(), s = oa(), l = $e(), d = 500, u = {
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
      submit(g, h) {
        return t(this, void 0, void 0, function* () {
          const { webhookUrl: _, priority: b, hint: E, startTimeout: S, headers: T, storageSettings: I } = h, v = e(h, ["webhookUrl", "priority", "hint", "startTimeout", "headers", "storageSettings"]), A = h.input ? yield m.transformInput(h.input) : void 0, q = Object.fromEntries(Object.entries(T ?? {}).map(([N, D]) => [
            N.toLowerCase(),
            D
          ]));
          return (0, n.dispatchRequest)({
            method: h.method,
            targetUrl: (0, n.buildUrl)(g, Object.assign(Object.assign({}, v), { subdomain: "queue", query: _ ? { fal_webhook: _ } : void 0 })),
            headers: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, q), (0, a.buildObjectLifecycleHeaders)(I)), { [r.QUEUE_PRIORITY_HEADER]: b ?? "normal" }), E && { [r.RUNNER_HINT_HEADER]: E }), (0, r.buildTimeoutHeaders)(S)),
            input: A,
            config: f,
            options: {
              signal: h.abortSignal,
              retry: u
            }
          });
        });
      },
      status(g, h) {
        return t(this, arguments, void 0, function* (_, { requestId: b, logs: E = !1, abortSignal: S }) {
          const T = (0, l.parseEndpointId)(_), I = T.namespace ? `${T.namespace}/` : "";
          return (0, n.dispatchRequest)({
            method: "get",
            targetUrl: (0, n.buildUrl)(`${I}${T.owner}/${T.alias}`, {
              subdomain: "queue",
              query: { logs: E ? "1" : "0" },
              path: `/requests/${b}/status`
            }),
            config: f,
            options: {
              signal: S,
              retry: c
            }
          });
        });
      },
      streamStatus(g, h) {
        return t(this, arguments, void 0, function* (_, { requestId: b, logs: E = !1, connectionMode: S }) {
          const T = (0, l.parseEndpointId)(_), I = T.namespace ? `${T.namespace}/` : "", v = {
            logs: E ? "1" : "0"
          }, A = (0, n.buildUrl)(`${I}${T.owner}/${T.alias}`, {
            subdomain: "queue",
            path: `/requests/${b}/status/stream`,
            query: v
          });
          return new s.FalStream(_, f, {
            url: A,
            method: "get",
            connectionMode: S,
            queryParams: v
          });
        });
      },
      subscribeToStatus(g, h) {
        return t(this, void 0, void 0, function* () {
          const _ = h.requestId, b = h.timeout;
          let E;
          const S = () => {
          };
          if (h.mode === "streaming") {
            const T = yield y.streamStatus(g, {
              requestId: _,
              logs: h.logs,
              connectionMode: "connectionMode" in h ? h.connectionMode : void 0
            }), I = [];
            b && (E = setTimeout(() => {
              throw T.abort(), y.cancel(g, { requestId: _ }).catch(S), new Error(`Client timed out waiting for the request to complete after ${b}ms`);
            }, b)), T.on("data", (A) => {
              h.onQueueUpdate && ("logs" in A && Array.isArray(A.logs) && A.logs.length > 0 && I.push(...A.logs), h.onQueueUpdate("logs" in A ? Object.assign(Object.assign({}, A), { logs: I }) : A));
            });
            const v = yield T.done();
            return E && clearTimeout(E), v;
          }
          return new Promise((T, I) => {
            var v;
            let A;
            const q = "pollInterval" in h && typeof h.pollInterval == "number" && (v = h.pollInterval) !== null && v !== void 0 ? v : d, N = () => {
              E && clearTimeout(E), A && clearTimeout(A);
            };
            b && (E = setTimeout(() => {
              N(), y.cancel(g, { requestId: _ }).catch(S), I(new Error(`Client timed out waiting for the request to complete after ${b}ms`));
            }, b));
            const D = () => t(this, void 0, void 0, function* () {
              var $;
              try {
                const G = yield y.status(g, {
                  requestId: _,
                  logs: ($ = h.logs) !== null && $ !== void 0 ? $ : !1,
                  abortSignal: h.abortSignal
                });
                if (h.onQueueUpdate && h.onQueueUpdate(G), G.status === "COMPLETED") {
                  N(), T(G);
                  return;
                }
                A = setTimeout(D, q);
              } catch (G) {
                N(), I(G);
              }
            });
            D().catch(I);
          });
        });
      },
      result(g, h) {
        return t(this, arguments, void 0, function* (_, { requestId: b, abortSignal: E }) {
          const S = (0, l.parseEndpointId)(_), T = S.namespace ? `${S.namespace}/` : "";
          return (0, n.dispatchRequest)({
            method: "get",
            targetUrl: (0, n.buildUrl)(`${T}${S.owner}/${S.alias}`, {
              subdomain: "queue",
              path: `/requests/${b}`
            }),
            config: Object.assign(Object.assign({}, f), { responseHandler: i.resultResponseHandler }),
            options: {
              signal: E,
              retry: u
            }
          });
        });
      },
      cancel(g, h) {
        return t(this, arguments, void 0, function* (_, { requestId: b, abortSignal: E }) {
          const S = (0, l.parseEndpointId)(_), T = S.namespace ? `${S.namespace}/` : "";
          yield (0, n.dispatchRequest)({
            method: "put",
            targetUrl: (0, n.buildUrl)(`${T}${S.owner}/${S.alias}`, {
              subdomain: "queue",
              path: `/requests/${b}/cancel`
            }),
            config: f,
            options: {
              signal: E
            }
          });
        });
      }
    };
    return y;
  };
  return Ie.createQueueClient = p, Ie;
}
var rt = {};
function bl(t) {
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
function El(t, e, r) {
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
const vl = new TextEncoder(), Tl = 50;
function Sl(t, e, r) {
  vl.encodeInto(t, e.subarray(r));
}
function Il(t, e, r) {
  t.length > Tl ? Sl(t, e, r) : El(t, e, r);
}
const xl = 4096;
function aa(t, e, r) {
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
      const l = t[n++] & 63, d = t[n++] & 63;
      o.push((s & 31) << 12 | l << 6 | d);
    } else if ((s & 248) === 240) {
      const l = t[n++] & 63, d = t[n++] & 63, u = t[n++] & 63;
      let c = (s & 7) << 18 | l << 12 | d << 6 | u;
      c > 65535 && (c -= 65536, o.push(c >>> 10 & 1023 | 55296), c = 56320 | c & 1023), o.push(c);
    } else
      o.push(s);
    o.length >= xl && (a += String.fromCharCode(...o), o.length = 0);
  }
  return o.length > 0 && (a += String.fromCharCode(...o)), a;
}
const Al = new TextDecoder(), jl = 200;
function kl(t, e, r) {
  const n = t.subarray(e, e + r);
  return Al.decode(n);
}
function Rl(t, e, r) {
  return r > jl ? kl(t, e, r) : aa(t, e, r);
}
class Lt {
  constructor(e, r) {
    U(this, "type");
    U(this, "data");
    this.type = e, this.data = r;
  }
}
class se extends Error {
  constructor(e) {
    super(e);
    const r = Object.create(se.prototype);
    Object.setPrototypeOf(this, r), Object.defineProperty(this, "name", {
      configurable: !0,
      enumerable: !1,
      value: se.name
    });
  }
}
const Ot = 4294967295;
function Ol(t, e, r) {
  const n = r / 4294967296, i = r;
  t.setUint32(e, n), t.setUint32(e + 4, i);
}
function sa(t, e, r) {
  const n = Math.floor(r / 4294967296), i = r;
  t.setUint32(e, n), t.setUint32(e + 4, i);
}
function la(t, e) {
  const r = t.getInt32(e), n = t.getUint32(e + 4);
  return r * 4294967296 + n;
}
function Pl(t, e) {
  const r = t.getUint32(e), n = t.getUint32(e + 4);
  return r * 4294967296 + n;
}
const da = -1, Nl = 4294967296 - 1, ql = 17179869184 - 1;
function ua({ sec: t, nsec: e }) {
  if (t >= 0 && e >= 0 && t <= ql)
    if (e === 0 && t <= Nl) {
      const r = new Uint8Array(4);
      return new DataView(r.buffer).setUint32(0, t), r;
    } else {
      const r = t / 4294967296, n = t & 4294967295, i = new Uint8Array(8), o = new DataView(i.buffer);
      return o.setUint32(0, e << 2 | r & 3), o.setUint32(4, n), i;
    }
  else {
    const r = new Uint8Array(12), n = new DataView(r.buffer);
    return n.setUint32(0, e), sa(n, 4, t), r;
  }
}
function ca(t) {
  const e = t.getTime(), r = Math.floor(e / 1e3), n = (e - r * 1e3) * 1e6, i = Math.floor(n / 1e9);
  return {
    sec: r + i,
    nsec: n - i * 1e9
  };
}
function fa(t) {
  if (t instanceof Date) {
    const e = ca(t);
    return ua(e);
  } else
    return null;
}
function pa(t) {
  const e = new DataView(t.buffer, t.byteOffset, t.byteLength);
  switch (t.byteLength) {
    case 4:
      return { sec: e.getUint32(0), nsec: 0 };
    case 8: {
      const r = e.getUint32(0), n = e.getUint32(4), i = (r & 3) * 4294967296 + n, o = r >>> 2;
      return { sec: i, nsec: o };
    }
    case 12: {
      const r = la(e, 4), n = e.getUint32(0);
      return { sec: r, nsec: n };
    }
    default:
      throw new se(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${t.length}`);
  }
}
function ma(t) {
  const e = pa(t);
  return new Date(e.sec * 1e3 + e.nsec / 1e6);
}
const Cl = {
  type: da,
  encode: fa,
  decode: ma
}, Er = class Er {
  constructor() {
    // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
    // this will make type errors a lot more clear
    // eslint-disable-next-line @typescript-eslint/naming-convention
    U(this, "__brand");
    // built-in extensions
    U(this, "builtInEncoders", []);
    U(this, "builtInDecoders", []);
    // custom extensions
    U(this, "encoders", []);
    U(this, "decoders", []);
    this.register(Cl);
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
          return new Lt(a, o);
        }
      }
    }
    for (let n = 0; n < this.encoders.length; n++) {
      const i = this.encoders[n];
      if (i != null) {
        const o = i(e, r);
        if (o != null) {
          const a = n;
          return new Lt(a, o);
        }
      }
    }
    return e instanceof Lt ? e : null;
  }
  decode(e, r, n) {
    const i = r < 0 ? this.builtInDecoders[-1 - r] : this.decoders[r];
    return i ? i(e, r, n) : new Lt(r, e);
  }
};
U(Er, "defaultCodec", new Er());
let Kt = Er;
function Ll(t) {
  return t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer;
}
function pn(t) {
  return t instanceof Uint8Array ? t : ArrayBuffer.isView(t) ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : Ll(t) ? new Uint8Array(t) : Uint8Array.from(t);
}
const Ul = 100, Dl = 2048;
class Ir {
  constructor(e) {
    U(this, "extensionCodec");
    U(this, "context");
    U(this, "useBigInt64");
    U(this, "maxDepth");
    U(this, "initialBufferSize");
    U(this, "sortKeys");
    U(this, "forceFloat32");
    U(this, "ignoreUndefined");
    U(this, "forceIntegerToFloat");
    U(this, "pos");
    U(this, "view");
    U(this, "bytes");
    U(this, "entered", !1);
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? Kt.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.maxDepth = (e == null ? void 0 : e.maxDepth) ?? Ul, this.initialBufferSize = (e == null ? void 0 : e.initialBufferSize) ?? Dl, this.sortKeys = (e == null ? void 0 : e.sortKeys) ?? !1, this.forceFloat32 = (e == null ? void 0 : e.forceFloat32) ?? !1, this.ignoreUndefined = (e == null ? void 0 : e.ignoreUndefined) ?? !1, this.forceIntegerToFloat = (e == null ? void 0 : e.forceIntegerToFloat) ?? !1, this.pos = 0, this.view = new DataView(new ArrayBuffer(this.initialBufferSize)), this.bytes = new Uint8Array(this.view.buffer);
  }
  clone() {
    return new Ir({
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
    const n = bl(e);
    this.ensureBufferSizeToWrite(5 + n), this.writeStringHeader(n), Il(e, this.bytes, this.pos), this.pos += n;
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
    const n = pn(e);
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
    this.ensureBufferSizeToWrite(8), Ol(this.view, this.pos, e), this.pos += 8;
  }
  writeI64(e) {
    this.ensureBufferSizeToWrite(8), sa(this.view, this.pos, e), this.pos += 8;
  }
  writeBigUint64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigUint64(this.pos, e), this.pos += 8;
  }
  writeBigInt64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigInt64(this.pos, e), this.pos += 8;
  }
}
function Ml(t, e) {
  return new Ir(e).encodeSharedRef(t);
}
function Wr(t) {
  return `${t < 0 ? "-" : ""}0x${Math.abs(t).toString(16).padStart(2, "0")}`;
}
const $l = 16, Fl = 16;
class Bl {
  constructor(e = $l, r = Fl) {
    U(this, "hit", 0);
    U(this, "miss", 0);
    U(this, "caches");
    U(this, "maxKeyLength");
    U(this, "maxLengthPerKey");
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
    const o = aa(e, r, n), a = Uint8Array.prototype.slice.call(e, r, r + n);
    return this.store(a, o), o;
  }
}
const mn = "array", $t = "map_key", ha = "map_value", Hl = (t) => {
  if (typeof t == "string" || typeof t == "number")
    return t;
  throw new se("The type of key must be string or number but " + typeof t);
};
class Gl {
  constructor() {
    U(this, "stack", []);
    U(this, "stackHeadPosition", -1);
  }
  get length() {
    return this.stackHeadPosition + 1;
  }
  top() {
    return this.stack[this.stackHeadPosition];
  }
  pushArrayState(e) {
    const r = this.getUninitializedStateFromPool();
    r.type = mn, r.position = 0, r.size = e, r.array = new Array(e);
  }
  pushMapState(e) {
    const r = this.getUninitializedStateFromPool();
    r.type = $t, r.readCount = 0, r.size = e, r.map = {};
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
    if (e.type === mn) {
      const n = e;
      n.size = 0, n.array = void 0, n.position = 0, n.type = void 0;
    }
    if (e.type === $t || e.type === ha) {
      const n = e;
      n.size = 0, n.map = void 0, n.readCount = 0, n.type = void 0;
    }
    this.stackHeadPosition--;
  }
  reset() {
    this.stack.length = 0, this.stackHeadPosition = -1;
  }
}
const Pt = -1, Un = new DataView(new ArrayBuffer(0)), zl = new Uint8Array(Un.buffer);
try {
  Un.getInt8(0);
} catch (t) {
  if (!(t instanceof RangeError))
    throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
}
const Ri = new RangeError("Insufficient data"), Vl = new Bl();
class Fe {
  constructor(e) {
    U(this, "extensionCodec");
    U(this, "context");
    U(this, "useBigInt64");
    U(this, "rawStrings");
    U(this, "maxStrLength");
    U(this, "maxBinLength");
    U(this, "maxArrayLength");
    U(this, "maxMapLength");
    U(this, "maxExtLength");
    U(this, "keyDecoder");
    U(this, "mapKeyConverter");
    U(this, "totalPos", 0);
    U(this, "pos", 0);
    U(this, "view", Un);
    U(this, "bytes", zl);
    U(this, "headByte", Pt);
    U(this, "stack", new Gl());
    U(this, "entered", !1);
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? Kt.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.rawStrings = (e == null ? void 0 : e.rawStrings) ?? !1, this.maxStrLength = (e == null ? void 0 : e.maxStrLength) ?? Ot, this.maxBinLength = (e == null ? void 0 : e.maxBinLength) ?? Ot, this.maxArrayLength = (e == null ? void 0 : e.maxArrayLength) ?? Ot, this.maxMapLength = (e == null ? void 0 : e.maxMapLength) ?? Ot, this.maxExtLength = (e == null ? void 0 : e.maxExtLength) ?? Ot, this.keyDecoder = (e == null ? void 0 : e.keyDecoder) !== void 0 ? e.keyDecoder : Vl, this.mapKeyConverter = (e == null ? void 0 : e.mapKeyConverter) ?? Hl;
  }
  clone() {
    return new Fe({
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
    this.totalPos = 0, this.headByte = Pt, this.stack.reset();
  }
  setBuffer(e) {
    const r = pn(e);
    this.bytes = r, this.view = new DataView(r.buffer, r.byteOffset, r.byteLength), this.pos = 0;
  }
  appendBuffer(e) {
    if (this.headByte === Pt && !this.hasRemaining(1))
      this.setBuffer(e);
    else {
      const r = this.bytes.subarray(this.pos), n = pn(e), i = new Uint8Array(r.length + n.length);
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
      throw new RangeError(`Insufficient data in parsing ${Wr(i)} at ${a} (${o} in the current buffer)`);
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
        throw new se(`Unrecognized type byte: ${Wr(e)}`);
      this.complete();
      const n = this.stack;
      for (; n.length > 0; ) {
        const i = n.top();
        if (i.type === mn)
          if (i.array[i.position] = r, i.position++, i.position === i.size)
            r = i.array, n.release(i);
          else
            continue e;
        else if (i.type === $t) {
          if (r === "__proto__")
            throw new se("The key __proto__ is not allowed");
          i.key = this.mapKeyConverter(r), i.type = ha;
          continue e;
        } else if (i.map[i.key] = r, i.readCount++, i.readCount === i.size)
          r = i.map, n.release(i);
        else {
          i.key = null, i.type = $t;
          continue e;
        }
      }
      return r;
    }
  }
  readHeadByte() {
    return this.headByte === Pt && (this.headByte = this.readU8()), this.headByte;
  }
  complete() {
    this.headByte = Pt;
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
        throw new se(`Unrecognized array type byte: ${Wr(e)}`);
      }
    }
  }
  pushMapState(e) {
    if (e > this.maxMapLength)
      throw new se(`Max length exceeded: map length (${e}) > maxMapLengthLength (${this.maxMapLength})`);
    this.stack.pushMapState(e);
  }
  pushArrayState(e) {
    if (e > this.maxArrayLength)
      throw new se(`Max length exceeded: array length (${e}) > maxArrayLength (${this.maxArrayLength})`);
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
      throw new se(`Max length exceeded: UTF-8 byte length (${e}) > maxStrLength (${this.maxStrLength})`);
    if (this.bytes.byteLength < this.pos + r + e)
      throw Ri;
    const n = this.pos + r;
    let i;
    return this.stateIsMapKey() && ((o = this.keyDecoder) != null && o.canBeCached(e)) ? i = this.keyDecoder.decode(this.bytes, n, e) : i = Rl(this.bytes, n, e), this.pos += r + e, i;
  }
  stateIsMapKey() {
    return this.stack.length > 0 ? this.stack.top().type === $t : !1;
  }
  /**
   * @throws {@link RangeError}
   */
  decodeBinary(e, r) {
    if (e > this.maxBinLength)
      throw new se(`Max length exceeded: bin length (${e}) > maxBinLength (${this.maxBinLength})`);
    if (!this.hasRemaining(e + r))
      throw Ri;
    const n = this.pos + r, i = this.bytes.subarray(n, n + e);
    return this.pos += r + e, i;
  }
  decodeExtension(e, r) {
    if (e > this.maxExtLength)
      throw new se(`Max length exceeded: ext length (${e}) > maxExtLength (${this.maxExtLength})`);
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
    const e = Pl(this.view, this.pos);
    return this.pos += 8, e;
  }
  readI64() {
    const e = la(this.view, this.pos);
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
function Wl(t, e) {
  return new Fe(e).decode(t);
}
function Xl(t, e) {
  return new Fe(e).decodeMulti(t);
}
function Jl(t) {
  return t[Symbol.asyncIterator] != null;
}
async function* Kl(t) {
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
function Dn(t) {
  return Jl(t) ? t : Kl(t);
}
async function Yl(t, e) {
  const r = Dn(t);
  return new Fe(e).decodeAsync(r);
}
function Ql(t, e) {
  const r = Dn(t);
  return new Fe(e).decodeArrayStream(r);
}
function Zl(t, e) {
  const r = Dn(t);
  return new Fe(e).decodeStream(r);
}
const ed = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecodeError: se,
  Decoder: Fe,
  EXT_TIMESTAMP: da,
  Encoder: Ir,
  ExtData: Lt,
  ExtensionCodec: Kt,
  decode: Wl,
  decodeArrayStream: Ql,
  decodeAsync: Yl,
  decodeMulti: Xl,
  decodeMultiStream: Zl,
  decodeTimestampExtension: ma,
  decodeTimestampToTimeSpec: pa,
  encode: Ml,
  encodeDateToTimeSpec: ca,
  encodeTimeSpecToTimestamp: ua,
  encodeTimestampExtension: fa
}, Symbol.toStringTag, { value: "Module" })), td = /* @__PURE__ */ ml(ed);
var ce = {}, Oi;
function rd() {
  if (Oi) return ce;
  Oi = 1, Object.defineProperty(ce, "__esModule", { value: !0 });
  function t(j) {
    return { enumerable: !0, value: j };
  }
  function e(j) {
    return { enumerable: !0, writable: !0, value: j };
  }
  let r = {}, n = () => !0, i = () => ({}), o = (j) => j, a = (j, O, C, L) => j.apply(C, L) && O.apply(C, L), s = (j, O, C, [L, V]) => O.call(C, j.call(C, L, V), V), l = (j, O) => Object.freeze(Object.create(j, O));
  function d(j, O, C) {
    return j.reduce((L, V) => function(...re) {
      return C(L, V, this, re);
    }, O);
  }
  function u(j) {
    return l(this, { fn: t(j) });
  }
  let c = {}, p = u.bind(c), f = (j) => p((O, C) => !!~j(O, C) && O), m = {}, y = u.bind(m);
  function g(j, O) {
    return O.filter((C) => j.isPrototypeOf(C));
  }
  function h(j, O, ...C) {
    let L = d(g(m, C).map((re) => re.fn), n, a), V = d(g(c, C).map((re) => re.fn), o, s);
    return l(this, {
      from: t(j),
      to: t(O),
      guards: t(L),
      reducers: t(V)
    });
  }
  let _ = {}, b = {}, E = h.bind(_), S = h.bind(b, null);
  function T(j, O, C) {
    return z(O, j, C, this.immediates) || j;
  }
  function I(j) {
    let O = /* @__PURE__ */ new Map();
    for (let C of j)
      O.has(C.from) || O.set(C.from, []), O.get(C.from).push(C);
    return O;
  }
  let v = { enter: o };
  function A(...j) {
    let O = g(_, j), C = g(b, j), L = {
      final: t(j.length === 0),
      transitions: t(I(O))
    };
    return C.length && (L.immediates = t(C), L.enter = t(T)), l(v, L);
  }
  let q = {
    enter(j, O, C) {
      let L = this.fn.call(O, O.context, C);
      return $.isPrototypeOf(L) ? l(N, {
        machine: t(L),
        transitions: t(this.transitions)
      }).enter(j, O, C) : (L.then((V) => O.send({ type: "done", data: V })).catch((V) => O.send({ type: "error", error: V })), j);
    }
  }, N = {
    enter(j, O, C) {
      if (O.child = H(this.machine, (L) => {
        O.onChange(L), O.child == L && L.machine.state.value.final && (delete O.child, O.send({ type: "done", data: L.context }));
      }, O.context, C), O.child.machine.state.value.final) {
        let L = O.child.context;
        return delete O.child, z(O, j, { type: "done", data: L }, this.transitions.get("done"));
      }
      return j;
    }
  };
  function D(j, ...O) {
    let C = t(I(O));
    return $.isPrototypeOf(j) ? l(N, {
      machine: t(j),
      transitions: C
    }) : l(q, {
      fn: t(j),
      transitions: C
    });
  }
  let $ = {
    get state() {
      return {
        name: this.current,
        value: this.states[this.current]
      };
    }
  };
  function G(j, O, C = i) {
    return typeof j != "string" && (C = O || i, O = j, j = Object.keys(O)[0]), r._create && r._create(j, O), l($, {
      context: t(C),
      current: t(j),
      states: t(O)
    });
  }
  function z(j, O, C, L) {
    let { context: V } = j;
    for (let { to: re, guards: Se, reducers: le } of L)
      if (Se(V, C)) {
        j.context = le.call(j, V, C);
        let je = O.original || O, bt = l(je, {
          current: t(re),
          original: { value: je }
        });
        return r._onEnter && r._onEnter(O, re, j.context, V, C), bt.state.value.enter(bt, j, C);
      }
  }
  function k(j, O) {
    let C = O.type || O, { machine: L } = j, { value: V, name: re } = L.state;
    return V.transitions.has(C) ? z(j, L, O, V.transitions.get(C)) || L : (r._send && r._send(C, re), L);
  }
  let P = {
    send(j) {
      this.machine = k(this, j), this.onChange(this);
    }
  };
  function H(j, O, C, L) {
    let V = Object.create(P, {
      machine: e(j),
      context: e(j.context(C, L)),
      onChange: t(O)
    });
    return V.send = V.send.bind(V), V.machine = V.machine.state.value.enter(V.machine, V, L), V;
  }
  return ce.action = f, ce.createMachine = G, ce.d = r, ce.guard = y, ce.immediate = S, ce.interpret = H, ce.invoke = D, ce.reduce = p, ce.state = A, ce.transition = E, ce;
}
var Pi;
function nd() {
  if (Pi) return rt;
  Pi = 1;
  var t = rt && rt.__awaiter || function(k, P, H, j) {
    function O(C) {
      return C instanceof H ? C : new H(function(L) {
        L(C);
      });
    }
    return new (H || (H = Promise))(function(C, L) {
      function V(le) {
        try {
          Se(j.next(le));
        } catch (je) {
          L(je);
        }
      }
      function re(le) {
        try {
          Se(j.throw(le));
        } catch (je) {
          L(je);
        }
      }
      function Se(le) {
        le.done ? C(le.value) : O(le.value).then(V, re);
      }
      Se((j = j.apply(k, P || [])).next());
    });
  };
  Object.defineProperty(rt, "__esModule", { value: !0 }), rt.createRealtimeClient = z;
  const e = td, r = rd(), n = ia(), i = Qe(), o = Cn(), a = $e(), s = () => ({
    enqueuedMessage: void 0
  });
  function l(k) {
    return k.token !== void 0;
  }
  function d(k) {
    return !l(k);
  }
  function u(k, P) {
    return Object.assign(Object.assign({}, k), { enqueuedMessage: P.message });
  }
  function c(k) {
    return k.websocket && k.websocket.readyState === WebSocket.OPEN && k.websocket.close(), Object.assign(Object.assign({}, k), { websocket: void 0 });
  }
  function p(k, P) {
    return k.websocket && k.websocket.readyState === WebSocket.OPEN ? (P.message instanceof Uint8Array || typeof P.message == "string" ? k.websocket.send(P.message) : k.websocket.send((0, e.encode)(P.message)), Object.assign(Object.assign({}, k), { enqueuedMessage: void 0 })) : Object.assign(Object.assign({}, k), { enqueuedMessage: P.message });
  }
  function f(k) {
    return Object.assign(Object.assign({}, k), { token: void 0 });
  }
  function m(k, P) {
    return Object.assign(Object.assign({}, k), { token: P.token });
  }
  function y(k, P) {
    return Object.assign(Object.assign({}, k), { websocket: P.websocket });
  }
  const g = (0, r.createMachine)("idle", {
    idle: (0, r.state)((0, r.transition)("send", "connecting", (0, r.reduce)(u)), (0, r.transition)("expireToken", "idle", (0, r.reduce)(f)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    connecting: (0, r.state)((0, r.transition)("connecting", "connecting"), (0, r.transition)("connected", "active", (0, r.reduce)(y)), (0, r.transition)("connectionClosed", "idle", (0, r.reduce)(c)), (0, r.transition)("send", "connecting", (0, r.reduce)(u)), (0, r.transition)("close", "idle", (0, r.reduce)(c)), (0, r.immediate)("authRequired", (0, r.guard)(d))),
    authRequired: (0, r.state)((0, r.transition)("initiateAuth", "authInProgress"), (0, r.transition)("send", "authRequired", (0, r.reduce)(u)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    authInProgress: (0, r.state)((0, r.transition)("authenticated", "connecting", (0, r.reduce)(m)), (0, r.transition)("unauthorized", "idle", (0, r.reduce)(f), (0, r.reduce)(c)), (0, r.transition)("send", "authInProgress", (0, r.reduce)(u)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    active: (0, r.state)((0, r.transition)("send", "active", (0, r.reduce)(p)), (0, r.transition)("authenticated", "active", (0, r.reduce)(m)), (0, r.transition)("unauthorized", "idle", (0, r.reduce)(f)), (0, r.transition)("connectionClosed", "idle", (0, r.reduce)(c)), (0, r.transition)("close", "idle", (0, r.reduce)(c))),
    failed: (0, r.state)((0, r.transition)("send", "failed"), (0, r.transition)("close", "idle", (0, r.reduce)(c)))
  }, s);
  function h(k, { token: P, maxBuffering: H, path: j }) {
    var O;
    if (H !== void 0 && (H < 1 || H > 60))
      throw new Error("The `maxBuffering` must be between 1 and 60 (inclusive)");
    const C = new URLSearchParams({
      fal_jwt_token: P
    });
    H !== void 0 && C.set("max_buffering", H.toFixed(0));
    const L = (0, a.ensureEndpointIdFormat)(k), V = (O = (0, a.resolveEndpointPath)(k, j, "/realtime")) !== null && O !== void 0 ? O : "";
    return `wss://fal.run/${L}${V}?${C.toString()}`;
  }
  const _ = 128;
  function b(k) {
    return k.status === "error" && k.error === "Unauthorized";
  }
  const E = {
    NORMAL_CLOSURE: 1e3
  }, S = /* @__PURE__ */ new Map(), T = /* @__PURE__ */ new Map();
  function I(k, P, H) {
    if (!S.has(k)) {
      const j = (0, r.interpret)(g, H);
      S.set(k, Object.assign(Object.assign({}, j), { throttledSend: P > 0 ? (0, a.throttle)(j.send, P, !0) : j.send }));
    }
    return S.get(k);
  }
  const v = () => {
  }, A = {
    send: v,
    close: v
  };
  function q(k) {
    return k.status !== "error" && k.type !== "x-fal-message" && !N(k);
  }
  function N(k) {
    return k.type === "x-fal-error";
  }
  function D(k) {
    return t(this, void 0, void 0, function* () {
      if (typeof k == "string")
        return JSON.parse(k);
      const P = (H) => t(this, void 0, void 0, function* () {
        return H instanceof Uint8Array ? H : H instanceof Blob ? new Uint8Array(yield H.arrayBuffer()) : new Uint8Array(H);
      });
      return k instanceof ArrayBuffer || k instanceof Uint8Array ? (0, e.decode)(yield P(k)) : k instanceof Blob ? (0, e.decode)(yield P(k)) : k;
    });
  }
  function $(k) {
    return k instanceof Uint8Array ? k : (0, e.encode)(k);
  }
  function G({ data: k, decodeMessage: P, onResult: H, onError: j, send: O }) {
    const C = (L) => {
      if (b(L)) {
        O({
          type: "unauthorized",
          error: new Error("Unauthorized")
        });
        return;
      }
      if (q(L)) {
        H(L);
        return;
      }
      if (N(L)) {
        if (L.error === "TIMEOUT")
          return;
        j(new i.ApiError({
          message: `${L.error}: ${L.reason}`,
          // TODO better error status code
          status: 400,
          body: L
        }));
        return;
      }
    };
    Promise.resolve(P ? P(k) : k).then(C).catch((L) => {
      var V;
      j(new i.ApiError({
        message: (V = L == null ? void 0 : L.message) !== null && V !== void 0 ? V : "Failed to decode realtime message",
        status: 400
      }));
    });
  }
  function z({ config: k }) {
    return {
      connect(P, H) {
        const {
          // if running on React in the server, set clientOnly to true by default
          clientOnly: j = (0, a.isReact)() && !(0, o.isBrowser)(),
          connectionKey: O = crypto.randomUUID(),
          maxBuffering: C,
          path: L,
          throttleInterval: V = _,
          encodeMessage: re,
          decodeMessage: Se,
          tokenProvider: le,
          tokenExpirationSeconds: je
        } = H;
        if (j && !(0, o.isBrowser)())
          return A;
        const bt = re ?? ((Be) => $(Be)), Nr = Se ?? ((Be) => D(Be));
        let Qt, di, Et, vt = 0;
        T.set(O, {
          decodeMessage: Nr,
          onError: H.onError,
          onResult: H.onResult
        });
        const qr = () => T.get(O), Tt = I(O, V, ({ context: Be, machine: He, send: ke }) => {
          var Cr;
          const { enqueuedMessage: Lr, token: Ur, websocket: Dr } = Be;
          if (di = Lr, He.current === "active" && Lr && (Dr == null ? void 0 : Dr.readyState) === WebSocket.OPEN && ke({ type: "send", message: Lr }), He.current === "authRequired" && Ur === void 0 && Qt !== He.current) {
            ke({ type: "initiateAuth" }), vt++;
            const ve = vt, de = (0, a.ensureEndpointIdFormat)(P), ge = (Cr = (0, a.resolveEndpointPath)(P, L, "/realtime")) !== null && Cr !== void 0 ? Cr : "", Ge = le ? () => le(`${de}${ge}`) : () => (console.warn("[fal.realtime] Using the default token provider is deprecated. Please provide a `tokenProvider` function to `fal.realtime.connect()`. See https://docs.fal.ai/model-apis/client#client-side-usage-with-token-provider for more information."), (0, n.getTemporaryAuthToken)(P, k)), St = le ? je : n.TOKEN_EXPIRATION_SECONDS, Mr = St !== void 0 ? () => {
              clearTimeout(Et);
              const It = Math.round(St * 0.9 * 1e3);
              Et = setTimeout(() => {
                ve === vt && Ge().then(($r) => {
                  ve === vt && (queueMicrotask(() => {
                    ke({ type: "authenticated", token: $r });
                  }), Mr());
                }).catch(() => {
                  if (ve !== vt)
                    return;
                  const $r = Math.round(St * 0.05 * 1e3);
                  Et = setTimeout(() => {
                    Mr();
                  }, $r);
                });
              }, It);
            } : v;
            Ge().then((It) => {
              queueMicrotask(() => {
                ke({ type: "authenticated", token: It });
              }), Mr();
            }).catch((It) => {
              queueMicrotask(() => {
                ke({ type: "unauthorized", error: It });
              });
            });
          }
          if (He.current === "connecting" && Qt !== He.current && Ur !== void 0) {
            const ve = new WebSocket(h(P, { token: Ur, maxBuffering: C, path: L }));
            ve.onopen = () => {
              var de, ge;
              ke({ type: "connected", websocket: ve });
              const Ge = (ge = (de = Tt.context) === null || de === void 0 ? void 0 : de.enqueuedMessage) !== null && ge !== void 0 ? ge : di;
              Ge && (ve.send(bt(Ge)), Tt.context = Object.assign(Object.assign({}, Tt.context), { enqueuedMessage: void 0 }));
            }, ve.onclose = (de) => {
              if (de.code !== E.NORMAL_CLOSURE) {
                const { onError: ge = v } = qr();
                ge(new i.ApiError({
                  message: `Error closing the connection: ${de.reason}`,
                  status: de.code
                }));
              }
              ke({ type: "connectionClosed", code: de.code });
            }, ve.onerror = (de) => {
              const { onError: ge = v } = qr();
              ge(new i.ApiError({ message: "Unknown error", status: 500 }));
            }, ve.onmessage = (de) => {
              const { decodeMessage: ge = Nr, onResult: Ge, onError: St = v } = qr();
              G({
                data: de.data,
                decodeMessage: ge,
                onResult: Ge,
                onError: St,
                send: ke
              });
            };
          }
          Qt === "active" && He.current !== "active" && (clearTimeout(Et), Et = void 0), Qt = He.current;
        });
        return {
          send: (Be) => {
            Tt.throttledSend({
              type: "send",
              message: bt(Be)
            });
          },
          close: () => {
            Tt.send({ type: "close" });
          }
        };
      }
    };
  }
  return rt;
}
var Ni;
function qi() {
  if (Ni) return tt;
  Ni = 1;
  var t = tt && tt.__awaiter || function(u, c, p, f) {
    function m(y) {
      return y instanceof p ? y : new p(function(g) {
        g(y);
      });
    }
    return new (p || (p = Promise))(function(y, g) {
      function h(E) {
        try {
          b(f.next(E));
        } catch (S) {
          g(S);
        }
      }
      function _(E) {
        try {
          b(f.throw(E));
        } catch (S) {
          g(S);
        }
      }
      function b(E) {
        E.done ? y(E.value) : m(E.value).then(h, _);
      }
      b((f = f.apply(u, c || [])).next());
    });
  };
  Object.defineProperty(tt, "__esModule", { value: !0 }), tt.createFalClient = d;
  const e = Ln(), r = qn(), n = wl(), i = nd(), o = Yt(), a = Qe(), s = na(), l = oa();
  function d(u = {}) {
    const c = (0, e.createConfig)(u), p = (0, s.createStorageClient)({ config: c }), f = (0, n.createQueueClient)({ config: c, storage: p }), m = (0, l.createStreamingClient)({ config: c, storage: p }), y = (0, i.createRealtimeClient)({ config: c });
    return {
      queue: f,
      realtime: y,
      storage: p,
      streaming: m,
      stream: m.stream,
      run(g) {
        return t(this, arguments, void 0, function* (h, _ = {}) {
          const b = _.input ? yield p.transformInput(_.input) : void 0;
          return (0, o.dispatchRequest)({
            method: _.method,
            targetUrl: (0, o.buildUrl)(h, _),
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
      subscribe: (g, h) => t(this, void 0, void 0, function* () {
        const { request_id: _ } = yield f.submit(g, h);
        return h.onEnqueue && h.onEnqueue(_), yield f.subscribeToStatus(g, Object.assign({ requestId: _ }, h)), f.result(g, { requestId: _ });
      })
    };
  }
  return tt;
}
var Nt = {}, Ci;
function id() {
  if (Ci) return Nt;
  Ci = 1, Object.defineProperty(Nt, "__esModule", { value: !0 }), Nt.isQueueStatus = t, Nt.isCompletedQueueStatus = e;
  function t(r) {
    return r && r.status && r.response_url;
  }
  function e(r) {
    return t(r) && r.status === "COMPLETED";
  }
  return Nt;
}
var Li;
function od() {
  return Li || (Li = 1, (function(t) {
    var e = ze && ze.__createBinding || (Object.create ? (function(d, u, c, p) {
      p === void 0 && (p = c);
      var f = Object.getOwnPropertyDescriptor(u, c);
      (!f || ("get" in f ? !u.__esModule : f.writable || f.configurable)) && (f = { enumerable: !0, get: function() {
        return u[c];
      } }), Object.defineProperty(d, p, f);
    }) : (function(d, u, c, p) {
      p === void 0 && (p = c), d[p] = u[c];
    })), r = ze && ze.__exportStar || function(d, u) {
      for (var c in d) c !== "default" && !Object.prototype.hasOwnProperty.call(u, c) && e(u, d, c);
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.fal = t.parseEndpointId = t.isRetryableError = t.ValidationError = t.ApiError = t.withProxy = t.withMiddleware = t.createFalClient = void 0;
    const n = qi();
    var i = qi();
    Object.defineProperty(t, "createFalClient", { enumerable: !0, get: function() {
      return i.createFalClient;
    } });
    var o = ra();
    Object.defineProperty(t, "withMiddleware", { enumerable: !0, get: function() {
      return o.withMiddleware;
    } }), Object.defineProperty(t, "withProxy", { enumerable: !0, get: function() {
      return o.withProxy;
    } });
    var a = Qe();
    Object.defineProperty(t, "ApiError", { enumerable: !0, get: function() {
      return a.ApiError;
    } }), Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
      return a.ValidationError;
    } });
    var s = Sr();
    Object.defineProperty(t, "isRetryableError", { enumerable: !0, get: function() {
      return s.isRetryableError;
    } }), r(id(), t);
    var l = $e();
    Object.defineProperty(t, "parseEndpointId", { enumerable: !0, get: function() {
      return l.parseEndpointId;
    } }), t.fal = (function() {
      let u = (0, n.createFalClient)();
      return {
        config(c) {
          u = (0, n.createFalClient)(c);
        },
        get queue() {
          return u.queue;
        },
        get realtime() {
          return u.realtime;
        },
        get storage() {
          return u.storage;
        },
        get streaming() {
          return u.streaming;
        },
        run(c, p) {
          return u.run(c, p);
        },
        subscribe(c, p) {
          return u.subscribe(c, p);
        },
        stream(c, p) {
          return u.stream(c, p);
        }
      };
    })();
  })(ze)), ze;
}
var K = od();
const ad = /* @__PURE__ */ JSON.parse('[{"display_name":"3D Rigging","job_set_type":"3d_rigging","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height_meters","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true}]},{"display_name":"Brain Activity","job_set_type":"brain_activity","type":"text","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Bytedance Image Upscale","job_set_type":"bytedance_image_upscale","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"4k","required":false,"enum":["2k","4k"]}]},{"display_name":"Bytedance Video Upscale","job_set_type":"bytedance_video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"fps","type":"integer","default":24,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"model_version","type":"string","default":"standard","required":false,"enum":["standard","pro"]},{"name":"preset","type":"string","default":"common","required":false,"enum":["common","aigc","short_series","ugc","old_film"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1080p","2k","4k"]}]},{"display_name":"Cinematic Studio 2.5","job_set_type":"cinematic_studio_2_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"auto","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio 3.0","job_set_type":"cinematic_studio_3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Cinematic Studio Image","job_set_type":"cinematic_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"string","default":null,"required":true},{"name":"camera_lens_id","type":"string","default":null,"required":true},{"name":"camera_model_id","type":"string","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio Soul Cast","job_set_type":"cinematic_studio_soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinematic Studio Soul Location","job_set_type":"cinematic_studio_soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Cinematic Studio Video","job_set_type":"cinematic_studio_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"slow_motion","type":"boolean","default":false,"required":false},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Cinematic Studio Video 3.5","job_set_type":"cinematic_studio_video_3_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"camera_style","type":"object","default":null,"required":false},{"name":"color_grading","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"light_scheme","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"style_id","type":"object","default":null,"required":false},{"name":"style_prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinema Studio 4.0","job_set_type":"cinematic_studio_video_4_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"color_palette","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"era_id","type":"object","default":null,"required":false},{"name":"extension_mode","type":"object","default":null,"required":false},{"name":"film_era","type":"null","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"null","default":null,"required":false},{"name":"genre_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"light","type":"object","default":null,"required":false},{"name":"light_custom","type":"object","default":null,"required":false},{"name":"light_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"model","type":"string","default":"default","required":false,"enum":["default","video_edit","video_extension"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"pacing_id","type":"object","default":null,"required":false},{"name":"preset_id","type":"null","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"speedramp","type":"object","default":"auto","required":false},{"name":"use_blur","type":"boolean","default":false,"required":false},{"name":"use_eye_mask","type":"boolean","default":false,"required":false},{"name":"use_transparency","type":"boolean","default":false,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Cinematic Studio Video V2","job_set_type":"cinematic_studio_video_v2","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"cfg_scale","type":"number","default":0.5,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","western","suspense","intimate","spectacle"]},{"name":"kling_element_ids","type":"array","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Clipify","job_set_type":"clipify","type":"video","params":[{"name":"clip_aspect","type":"string","default":"9:16","required":false,"enum":["9:16","1:1","16:9"]},{"name":"clips_num","type":"integer","default":10,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"max_height","type":"integer","default":1080,"required":false},{"name":"segment_seconds","type":"integer","default":10,"required":false},{"name":"subtitle_case","type":"string","default":"as-is","required":false,"enum":["lower","upper","as-is"]},{"name":"subtitle_font","type":"string","default":"notosans","required":false},{"name":"subtitle_highlight_hex","type":"string","default":"#FFE84D","required":false},{"name":"subtitle_position","type":"string","default":"bottom","required":false,"enum":["bottom","center","top"]},{"name":"track_face_crop","type":"boolean","default":true,"required":false},{"name":"urls","type":"array","default":null,"required":true}]},{"display_name":"Draw To Video","job_set_type":"draw_to_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"ref_image","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"sketch","type":"object","default":null,"required":true},{"name":"video","type":"object","default":null,"required":true}]},{"display_name":"dubbing","job_set_type":"dubbing","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"target_language","type":"string","default":null,"required":true,"enum":["eng","cmn","fra","hin","ita","jpn","kor","por","rus","tur","spa","deu","ara","pol","ind","fil","swe","fin"]}]},{"display_name":"Explainer Video","job_set_type":"explainer_video","type":"video","params":[{"name":"height","type":"integer","default":null,"required":true},{"name":"items","type":"array","default":null,"required":true},{"name":"subtitles","type":"object","default":null,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"FLUX.2","job_set_type":"flux_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"pro","required":false,"enum":["pro","flex","max"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"FLUX.2 Pro Outpaint","job_set_type":"flux_2_pro_outpaint","type":"image","params":[{"name":"expand_bottom","type":"integer","default":0,"required":false},{"name":"expand_left","type":"integer","default":0,"required":false},{"name":"expand_right","type":"integer","default":0,"required":false},{"name":"expand_top","type":"integer","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"FLUX 3 Video","job_set_type":"flux_3_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Flux Kontext","job_set_type":"flux_kontext","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Gemini Omni Flash","job_set_type":"gemini_omni","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"integer","default":8,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false}]},{"display_name":"GPT Image 2","job_set_type":"gpt_image_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"high","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Grok Image","job_set_type":"grok_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","1:2","2:1","3:2","2:3","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","quality"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Grok Video","job_set_type":"grok_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Grok Video 1.5","job_set_type":"grok_video_v15","type":"video","params":[{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Happy Horse Video","job_set_type":"happy_horse_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Hunyuan 3D v3.1 Text to 3D","job_set_type":"hunyuan3d_v3_1_text_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Hunyuan3D v3 Image to 3D","job_set_type":"hunyuan3d_v3_image_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"integer","default":500000,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"string","default":"Normal","required":false,"enum":["Normal","LowPoly","Geometry"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"polygon_type","type":"string","default":"triangle","required":false,"enum":["triangle","quadrilateral"]}]},{"display_name":"Image Auto","job_set_type":"image_auto","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Image Background Remover","job_set_type":"image_background_remover","type":"image","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Image Decompose","job_set_type":"image_decompose","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"granular","required":false,"enum":["granular","standard"]}]},{"display_name":"Image to 3D","job_set_type":"image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Inworld Text to Speech","job_set_type":"inworld_text_to_speech","type":"audio","params":[{"name":"prompt","type":"string","default":null,"required":true},{"name":"voice","type":"string","default":null,"required":true}]},{"display_name":"Kimodo","job_set_type":"kimodo","type":"3d","params":[{"name":"diffusion_steps","type":"integer","default":10,"required":false},{"name":"duration","type":"object","default":null,"required":false},{"name":"durations","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_version","type":"string","default":"ardy-core","required":false,"enum":["ardy-core","ardy-core-h8"]},{"name":"prompt","type":"object","default":null,"required":false},{"name":"prompts","type":"object","default":null,"required":false},{"name":"seed","type":"integer","default":42,"required":false}]},{"display_name":"Kling O1 Image","job_set_type":"kling_omni_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","auto","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Kling 2.6 Video","job_set_type":"kling2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Kling v3.0","job_set_type":"kling3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std","4k"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]}]},{"display_name":"Kling 3.0 Motion Control","job_set_type":"kling3_0_motion_control","type":"video","params":[{"name":"background_source","type":"string","default":"input_image","required":false,"enum":["input_image","input_video"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","pro"]}]},{"display_name":"Kling 3.0 Turbo","job_set_type":"kling3_0_turbo","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"LLM Generation","job_set_type":"llm_text","type":"video","params":[{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":null,"required":true},{"name":"reasoning_effort","type":"object","default":null,"required":false},{"name":"system_prompt","type":"string","default":"","required":false},{"name":"user_prompt","type":"string","default":"","required":false}]},{"display_name":"Marketing Studio Image","job_set_type":"marketing_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Marketing Studio Video","job_set_type":"marketing_studio_video","type":"video","params":[{"name":"ad_reference_id","type":"object","default":null,"required":false},{"name":"aspect_ratio","type":"string","default":"9:16","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"avatar_ids","type":"array","default":null,"required":false},{"name":"avatars","type":"array","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"hook_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"ugc","required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"setting_id","type":"object","default":null,"required":false},{"name":"specific_mode","type":"string","default":"default","required":false,"enum":["default","web_product","from_storyboard"]},{"name":"storyboard_id","type":"object","default":null,"required":false},{"name":"web_product_ids","type":"array","default":null,"required":false},{"name":"web_product_type","type":"object","default":null,"required":false}]},{"display_name":"Meshy 5 Remesh","job_set_type":"meshy_v5_remesh","type":"3d","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true},{"name":"origin_at","type":"object","default":null,"required":false},{"name":"resize_height","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Meshy 6 Text to 3D","job_set_type":"meshy_v6_text_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"enable_prompt_expansion","type":"boolean","default":false,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"full","required":false},{"name":"model_type","type":"string","default":"standard","required":false},{"name":"pose_mode","type":"string","default":"","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"boolean","default":true,"required":false},{"name":"symmetry_mode","type":"string","default":"auto","required":false},{"name":"target_polycount","type":"integer","default":30000,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"string","default":"triangle","required":false}]},{"display_name":"MiniMax H3","job_set_type":"minimax_h3","type":"video","params":[{"name":"aigc_watermark","type":"boolean","default":false,"required":false},{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":4,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"resolution","type":"string","default":"2K","required":false,"enum":["768P","2K"]},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Minimax Hailuo","job_set_type":"minimax_hailuo","type":"video","params":[{"name":"duration","type":"string","default":6,"required":false,"enum":["6","10"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"minimax-2.3","required":false,"enum":["minimax","minimax-fast","minimax-2.3","minimax-2.3-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"768","required":false,"enum":["512","768","1080"]}]},{"display_name":"Mirelo Text to Audio","job_set_type":"mirelo_text_to_audio","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"MS Image","job_set_type":"ms_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"avatars","type":"array","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"brand_kit_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"low","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Multi-Image to 3D","job_set_type":"multi_image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Nano Banana","job_set_type":"nano_banana","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_ai_stylist","type":"image","params":[{"name":"background_preset_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"outfit_preset_ids","type":"array","default":null,"required":false},{"name":"pose_preset_id","type":"object","default":null,"required":false},{"name":"user_outfit_ids","type":"array","default":null,"required":false}]},{"display_name":"Nano Banana 2 Lite","job_set_type":"nano_banana_2_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"thinking","type":"string","default":"HIGH","required":false,"enum":["MINIMAL","HIGH"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_relight","type":"image","params":[{"name":"brightness","type":"integer","default":null,"required":true},{"name":"color","type":"string","default":null,"required":true},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"light_quality","type":"string","default":null,"required":true,"enum":["hard","sharp","soft"]},{"name":"light_source","type":"string","default":null,"required":true,"enum":["mdl","mdr","mul","mur","bml","fml","fmr","bmm","mml","mmr","fmm","bmr","mdm","mum","bdr","fdl","bur","ful","bdl","fdr","bul","fur","bdm","fdm","bum","fum"]},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_shots","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_skin_enhancer","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"preset_id","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana 2","job_set_type":"nano_banana_flash","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"OpenAI Hazel","job_set_type":"openai_hazel","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","auto"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"medium","required":false,"enum":["low","medium","high"]}]},{"display_name":"Outpaint","job_set_type":"outpaint","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"21:9","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Qwen Audio 3.0 TTS Flash","job_set_type":"qwen_audio_tts","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"instruction","type":"object","default":null,"required":false},{"name":"language","type":"object","default":null,"required":false},{"name":"pitch_rate","type":"number","default":1,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","22050","24000","44100","48000"]},{"name":"seed","type":"integer","default":0,"required":false},{"name":"speech_rate","type":"number","default":1,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"integer","default":50,"required":false}]},{"display_name":"Angles","job_set_type":"qwen_camera_control","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"move_forward_level","type":"integer","default":0,"required":false},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"rotate_degree","type":"integer","default":0,"required":false},{"name":"vertical_angle","type":"integer","default":0,"required":false},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Recraft V4.1","job_set_type":"recraft_v4_1","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:4","4:3","4:5","5:4","3:2","2:3","16:9","9:16","21:9"]},{"name":"background_color","type":"object","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"colors","type":"array","default":null,"required":false},{"name":"model_type","type":"string","default":"standard","required":false,"enum":["standard","vector","utility","utility_vector"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Reframe","job_set_type":"reframe","type":"video","params":[{"name":"aspect_ratio","type":"string","default":null,"required":true,"enum":["21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"3D Objects","job_set_type":"sam_3_3d","type":"3d","params":[{"name":"detection_threshold","type":"object","default":null,"required":false},{"name":"export_textured_glb","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"3D Body","job_set_type":"sam_3_3d_body","type":"3d","params":[{"name":"export_meshes","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"include_3d_keypoints","type":"boolean","default":true,"required":false},{"name":"include_mhr_params","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Remove Background","job_set_type":"sam_3_video","type":"video","params":[{"name":"apply_mask","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false}]},{"display_name":"Seed Audio 1.0","job_set_type":"seed_audio","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"expression_intensity","type":"integer","default":5,"required":false},{"name":"format","type":"string","default":"wav","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"loudness_rate","type":"integer","default":0,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mood","type":"number","default":0,"required":false},{"name":"pitch_rate","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","24000","32000","44100","48000"]},{"name":"speech_rate","type":"integer","default":0,"required":false},{"name":"voice_id","type":"object","default":null,"required":false},{"name":"voice_style","type":"object","default":null,"required":false},{"name":"voice_type","type":"object","default":null,"required":false},{"name":"voices","type":"array","default":null,"required":false}]},{"display_name":"Seedance 2.0","job_set_type":"seedance_2_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]}]},{"display_name":"Seedance 2.0 Mini","job_set_type":"seedance_2_0_mini","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p"]}]},{"display_name":"Seedance 2.5","job_set_type":"seedance_2_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"audio_references","type":"array","default":null,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"end_image","type":"object","default":null,"required":false},{"name":"extension_mode","type":"string","default":null,"required":false,"enum":["backward","forward"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"image_references","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"t2v","required":false,"enum":["t2v","omni_reference","video_edit","video_extension"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"start_image","type":"object","default":null,"required":false},{"name":"video_references","type":"array","default":null,"required":false}]},{"display_name":"Seedance 1.5 Pro","job_set_type":"seedance1_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"duration","type":"string","default":4,"required":false,"enum":["4","8","12"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Seedream 4.5","job_set_type":"seedream_v4_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","4:3","16:9","3:2","21:9","3:4","9:16","2:3"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Lite","job_set_type":"seedream_v5_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Pro","job_set_type":"seedream_v5_pro","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"height","type":"object","default":null,"required":false},{"name":"is_inpaint","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","1.5k","2k"]},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Sonilo Music","job_set_type":"sonilo_music","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Soul Cast","job_set_type":"soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"soul_cinema_studio","job_set_type":"soul_cinema_studio","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Soul Cinematic","job_set_type":"soul_cinematic","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]}]},{"display_name":"Soul Location","job_set_type":"soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Sync Lipsync 3","job_set_type":"sync_so","type":"video","params":[{"name":"active_speaker_detection","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_audio","type":"object","default":null,"required":true},{"name":"input_video","type":"object","default":null,"required":true},{"name":"occlusion_detection_enabled","type":"boolean","default":false,"required":false},{"name":"sync_mode","type":"string","default":"bounce","required":false,"enum":["bounce","loop","cut_off","silence","remap"]},{"name":"temperature","type":"number","default":0.5,"required":false}]},{"display_name":"Higgsfield Soul 2.0","job_set_type":"text2image_soul_v2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"Text to Speech V2","job_set_type":"text2speech_v2","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"emotion","type":"object","default":null,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["mp3","wav"]},{"name":"language_boost","type":"string","default":"auto","required":false,"enum":["auto","af","ar","bg","ca","cs","da","de","el","en","es","fa","fi","fil","fr","he","hi","hr","hu","id","it","ja","ko","ms","nl","nn","no","pl","pt","ro","ru","sk","sl","sv","ta","th","tr","uk","vi","yue","zh"]},{"name":"model","type":"string","default":null,"required":true,"enum":["elevenlabs","minimax","seed_speech","vibe_voice","cozy_voice"]},{"name":"pitch","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":32000,"required":false,"enum":["8000","16000","22050","24000","32000","44100"]},{"name":"speed","type":"number","default":1,"required":false},{"name":"stability","type":"object","default":null,"required":false},{"name":"text_normalization","type":"boolean","default":false,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"number","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image","type":"image","params":[{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Standard V2","required":false,"enum":["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"sharpen","type":"number","default":0,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image_generative","type":"image","params":[{"name":"autoprompt","type":"boolean","default":true,"required":false},{"name":"creativity","type":"integer","default":1,"required":false},{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Redefine","required":false,"enum":["Standard MAX","Redefine","Recovery","Recovery V2"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"sharpen","type":"number","default":0,"required":false},{"name":"texture","type":"integer","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancement","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frame_interpolation","type":"object","default":null,"required":false},{"name":"frame_rate","type":"number","default":30,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"input_height","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":false},{"name":"input_video_size","type":"integer","default":0,"required":false},{"name":"input_width","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"1080p","required":false,"enum":["1080p","2160p"]}]},{"display_name":"Text to 3D","job_set_type":"tripo_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"negative_prompt","type":"object","default":null,"required":false},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]}]},{"display_name":"Tripo H3.1 Image to 3D","job_set_type":"tripo_h3_1_image_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Tripo H3.1 Multiview to 3D","job_set_type":"tripo_h3_1_multiview_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Google Veo 3","job_set_type":"veo3","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"veo-3-fast","required":false,"enum":["veo-3-preview","veo-3-fast"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Google Veo 3.1","job_set_type":"veo3_1","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"model","type":"string","default":"veo-3-1-fast","required":false,"enum":["veo-3-1-preview","veo-3-1-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high","ultra"]}]},{"display_name":"Google Veo 3.1 Lite","job_set_type":"veo3_1_lite","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","auto"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Video Background Remover","job_set_type":"video_background_remover","type":"video","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Video Deflicker","job_set_type":"video_deflicker","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"Video Upscale","job_set_type":"video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"voice_change","job_set_type":"voice_change","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":"preset","required":false,"enum":["preset","element"]}]},{"display_name":"Wan 2.6 Video","job_set_type":"wan2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10","15"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 2.7","job_set_type":"wan2_7","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 3.0","job_set_type":"wan3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enable_thinking","type":"boolean","default":false,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Z Image","job_set_type":"z_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"prompt","type":"string","default":null,"required":true}]}]'), sd = {
  models: ad
}, ld = sd, ga = ld.models, dd = {
  text2image_soul_v2: "hf-soul-v2",
  nano_banana_2: "hf-nano-banana-pro",
  gpt_image_2: "hf-gpt-image-2",
  seedance_2_0: "hf-seedance-2",
  kling3_0: "hf-kling-3",
  veo3_1: "hf-veo-3-1"
}, ud = /* @__PURE__ */ new Set([
  "input_image",
  "ref_image",
  "sketch",
  "texture_image_url"
]), cd = /* @__PURE__ */ new Set(["input_images"]), fd = /* @__PURE__ */ new Set(["input_video", "video"]), pd = /* @__PURE__ */ new Set(["input_audio"]);
function Mn(t) {
  return t.split(/[_-]+/).filter(Boolean).map((e) => e.charAt(0).toUpperCase() + e.slice(1)).join(" ");
}
function md(t) {
  return dd[t] ?? `hf-${t.replaceAll("_", "-")}`;
}
function hd(t) {
  return t === "3d" ? "model3d" : t;
}
function gd(t, e) {
  let r, n, i = !1;
  if (ud.has(e.name) ? (r = "image", n = t.type === "video" && e.name === "input_image" ? "start_image" : "image") : cd.has(e.name) ? (r = "image", n = "image", i = !0) : fd.has(e.name) ? (r = "video", n = "video") : pd.has(e.name) ? (r = "audio", n = "audio") : e.name === "model_url" ? r = "model3d" : e.name === "urls" ? (r = "media", i = !0) : e.name === "medias" && (i = !0, t.type === "image" || t.type === "3d" ? (r = "image", n = "image") : t.type === "text" ? (r = "video", n = "video") : r = "media"), !!r)
    return {
      id: e.name,
      portType: r,
      label: Mn(e.name),
      required: e.required,
      falParam: e.name,
      fieldType: "port",
      schemaType: e.type,
      multiple: i,
      mediaRole: n,
      ...e.default !== void 0 ? { default: e.default } : {}
    };
}
function yd(t, e) {
  var i;
  const r = gd(t, e);
  if (r) return r;
  const n = {
    id: e.name,
    portType: "config",
    label: Mn(e.name),
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
function _d(t, e) {
  var r, n, i, o, a;
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
function wd(t, e) {
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
const bd = ["prompt", "user_prompt", "instruction"];
function Ed(t) {
  for (const e of bd) {
    const r = t.findIndex((n) => n.id === e);
    if (r > 0) return [t[r], ...t.slice(0, r), ...t.slice(r + 1)];
    if (r === 0) return t;
  }
  return t;
}
function vd(t) {
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
function Td(t = ga) {
  const e = {};
  for (const r of t) {
    const n = md(r.job_set_type), i = hd(r.type);
    if (e[n]) throw new Error(`Duplicate Higgsfield node type: ${n}`);
    const o = Ed(r.params.flatMap((s) => [
      _d(r, yd(r, s)),
      ...wd(r, s)
    ])), a = o.findIndex((s) => s.id === "prompt") + 1;
    o.splice(a, 0, ...vd(r)), e[n] = {
      id: r.job_set_type,
      nodeType: n,
      name: r.display_name,
      category: i,
      description: `Higgsfield ${r.type.toUpperCase()} model`,
      inputs: o,
      outputType: i,
      outputs: [{ id: i, portType: i, label: i === "model3d" ? "3D Model" : Mn(i) }],
      provider: "higgsfield",
      responseMapping: { path: i === "text" ? "text" : "output.url" }
    };
  }
  return e;
}
const ay = Td();
function Sd(t, e, r = ga) {
  if (!e) return e;
  const n = r.find((a) => a.job_set_type === t);
  if (!n) return e;
  const i = new Set(n.params.map((a) => a.name)), o = {};
  for (const [a, s] of Object.entries(e))
    i.has(a) && (o[a] = s);
  return o;
}
const Id = {
  image: "--image",
  start_image: "--start-image",
  end_image: "--end-image",
  video: "--video",
  audio: "--audio"
}, xd = /^[A-Za-z][A-Za-z0-9_]*$/, Ad = /* @__PURE__ */ new Set(["json", "wait", "no_color"]);
function jd(t) {
  const e = ["generate", "create", t.model], r = {
    ...Sd(t.model, { ...t.extra, ...t.params }) ?? {}
  }, n = (o, a) => {
    if (a == null) return;
    if (!xd.test(o) || Ad.has(o))
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
  }, i = t.prompt !== void 0 ? t.prompt : r.prompt;
  delete r.prompt, n("prompt", i);
  for (const o of t.medias ?? [])
    o.value && e.push(Id[o.role], o.value);
  t.aspectRatio !== void 0 && (delete r.aspect_ratio, n("aspect_ratio", t.aspectRatio)), t.durationSec !== void 0 && (delete r.duration, t.durationSec > 0 && n("duration", t.durationSec)), t.count !== void 0 && (delete r.count, t.count >= 1 && n("count", t.count));
  for (const [o, a] of Object.entries(r))
    n(o, a);
  return e.push("--json"), e;
}
class hn extends Error {
  constructor(e, r = "", n = "") {
    super(e), this.name = "HiggsfieldCliError", this.stdout = r, this.stderr = n;
  }
}
function gn(t) {
  return /HTTP\s*50[234]|50[234]\s+[\w\s]*Unavailable|502 Bad Gateway|504 Gateway|ECONNRESET|ETIMEDOUT|socket hang up|no response received|HTTP\s*429|rate limit|temporarily unavailable|service unavailable/i.test(t);
}
const kd = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function Rd(t) {
  return /^(queued|queue|pending|running|processing|waiting|in_progress|ns|created)$/.test(t.trim());
}
function $n(t, e) {
  if (!("outputs" in t) && !("mediaType" in t)) return !1;
  const r = t;
  return typeof r.url == "string" && r.url.trim() ? !0 : e === "text" && typeof r.text == "string" && !!r.text.trim();
}
function Od(t) {
  for (const e of ["results", "jobs"]) {
    const r = t[e];
    if (Array.isArray(r) && r.length > 0 && Ue(r[0])) return r[0];
  }
  return t;
}
function Fn(t) {
  const e = t.trim();
  if (!e) throw new Error("Higgsfield CLI returned no output");
  const r = (a) => Array.isArray(a) ? { results: a } : Ue(a) ? a : { result: a };
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
  const i = Od(n), o = i.job_id ?? i.id ?? i.jobId;
  return {
    status: String(i.state ?? i.status ?? "").toLowerCase(),
    jobId: typeof o == "string" && o.trim() ? o.trim() : void 0,
    record: i,
    parsed: n
  };
}
function Ui(...t) {
  var r;
  const e = t.filter(Boolean).join(`
`);
  try {
    const n = Fn(e).jobId;
    if (n) return n;
  } catch {
  }
  return (r = e.match(kd)) == null ? void 0 : r[0];
}
function Ue(t) {
  return !!t && typeof t == "object" && !Array.isArray(t);
}
const Pd = /* @__PURE__ */ new Set(["params", "prompt", "input_images", "inputs", "extra", "request"]), Di = [
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
], Mi = [
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
function st(t, e = 0) {
  if (e > 12) return [];
  if (typeof t == "string") {
    const n = t.trim().replace(/[),.;]+$/, "");
    return /^https?:\/\//i.test(n) ? [n] : [];
  }
  if (Array.isArray(t))
    return [...new Set(t.flatMap((n) => st(n, e + 1)))];
  if (!Ue(t)) return [];
  const r = [];
  for (const n of Di)
    t[n] !== void 0 && r.push(...st(t[n], e + 1));
  if (typeof t.result_json == "string" && t.result_json.trim())
    try {
      r.push(...st(JSON.parse(t.result_json), e + 1));
    } catch {
    }
  for (const n of Mi)
    t[n] !== void 0 && r.push(...st(t[n], e + 1));
  for (const [n, i] of Object.entries(t))
    Pd.has(n) || Di.includes(n) || Mi.includes(n) || n === "result_json" || (Ue(i) || Array.isArray(i)) && r.push(...st(i, e + 1));
  return [...new Set(r)];
}
const Nd = /https?:\/\/[^\s"'<>\\]+/gi;
function ya(t) {
  const e = t.match(Nd) ?? [];
  return [...new Set(e.map((r) => r.replace(/[),.;]+$/, "")))].filter((r) => /^https?:\/\//i.test(r) && !/higgsfield\.ai\/(docs|cli|skills)/i.test(r));
}
function dr(t, e = 0) {
  if (e > 12) return;
  if (typeof t == "string") {
    const n = t.trim();
    return n && !/^https?:\/\//i.test(n) ? n : void 0;
  }
  if (Array.isArray(t)) {
    for (const n of t) {
      const i = dr(n, e + 1);
      if (i) return i;
    }
    return;
  }
  if (!Ue(t)) return;
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
      const n = dr(JSON.parse(r), e + 1);
      if (n) return n;
    } catch {
    }
    return r.trim();
  }
  for (const n of ["output", "result", "data", "job", "results", "outputs", "items"]) {
    const i = dr(t[n], e + 1);
    if (i) return i;
  }
}
function _a(t, e) {
  const r = Fn(t);
  if (r.status === "failed" || r.status === "error" || r.status === "fail")
    throw new Error(typeof r.record.error == "string" ? r.record.error : "Higgsfield generation failed");
  if (Rd(r.status))
    throw new Error("Higgsfield job is still running");
  const n = Bn(r, e);
  if (e.mediaType === "text") {
    if (!n.url && !n.text) throw new Error("Higgsfield generation finished without a media URL or text output");
    return n;
  }
  if (n.url) return n;
  const i = ya(t);
  if (i[0])
    return { ...n, url: i[0], urls: i, outputs: i.map((o) => ({ kind: e.mediaType, url: o })) };
  throw new Error("Higgsfield generation finished without a media URL");
}
function Bn(t, e) {
  var l;
  const r = st(t.parsed), n = r[0], i = dr(t.parsed), o = t.record.duration ?? ((l = t.record.output) == null ? void 0 : l.duration), a = e.mediaType, s = r.map((d) => ({ kind: a, url: d }));
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
function dt(t) {
  return t instanceof Error ? t.message : String(t);
}
function wa(t) {
  return t instanceof hn ? { stdout: t.stdout, stderr: t.stderr } : { stdout: "", stderr: "" };
}
async function yn(t, e) {
  if (t.trim())
    try {
      return _a(t, e);
    } catch {
      return;
    }
}
function qd(t = W.homedir()) {
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
function Cd(t) {
  return !t.includes("/") && !t.includes("\\");
}
function Ld(t = qd(), e = (r) => {
  try {
    return B.existsSync(r);
  } catch {
    return !1;
  }
}) {
  const r = [], n = [];
  for (const i of t) {
    if (Cd(i)) {
      n.includes(i) || n.push(i);
      continue;
    }
    e(i) && !r.includes(i) && r.push(i);
  }
  return [...r, ...n];
}
function Ud() {
  const t = W.homedir(), e = [w.join(t, ".npm-global/bin"), w.join(t, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...process.env, PATH: [...e, process.env.PATH ?? ""].filter(Boolean).join(w.delimiter), NO_COLOR: "1" };
}
const $i = 1260 * 1e3, Dd = 9e4, Fi = 4, Xr = "Higgsfield CLI not found. Install @higgsfield/cli, then run higgsfield auth login — or connect Higgsfield in Settings.";
function Md(t) {
  if (!t || typeof t != "object") return !1;
  const e = "code" in t ? String(t.code) : "", r = t instanceof Error ? t.message : String(t);
  return e === "ENOENT" || /ENOENT|spawn .* ENOENT/i.test(r);
}
let nt = null;
function $d(t, e, r) {
  return new Promise((n, i) => {
    var d, u;
    const o = ie(t, e, { env: Ud() });
    let a = "", s = "";
    const l = setTimeout(() => {
      o.kill("SIGTERM"), i(new hn("Higgsfield CLI timed out", a, s));
    }, r);
    (d = o.stdout) == null || d.on("data", (c) => {
      a += c.toString();
    }), (u = o.stderr) == null || u.on("data", (c) => {
      s += c.toString();
    }), o.on("error", (c) => {
      clearTimeout(l), i(c);
    }), o.on("close", (c) => {
      if (clearTimeout(l), c === 0) {
        n(a);
        return;
      }
      const p = s.trim() || a.trim() || `Higgsfield CLI exited with code ${c}`, f = /session expired/i.test(p) ? 'Higgsfield is not connected. Run "higgsfield auth login" or connect it in Settings.' : p;
      i(new hn(f, a, s));
    });
  });
}
async function De(t, e = 6e4) {
  const r = t.includes("--json") ? t : [...t, "--json"], n = Ld(), i = nt ? [nt, ...n.filter((l) => l !== nt)] : n;
  if (i.length === 0) throw new Error(Xr);
  let o;
  for (const l of i)
    try {
      const d = await $d(l, r, e);
      return nt = l, d;
    } catch (d) {
      if (Md(d)) {
        nt === l && (nt = null), o = d;
        continue;
      }
      throw d;
    }
  const a = i.join(", "), s = o instanceof Error ? o.message : "";
  throw new Error(s ? `${Xr} Tried: ${a}. ${s}` : `${Xr} Tried: ${a}.`);
}
const Fd = 6e4, ba = {
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
function Ea(t) {
  return t === "video" ? ".mp4" : t === "audio" ? ".mp3" : ".png";
}
function Bd(t, e, r) {
  const n = e ? ba[e.split(";", 1)[0].trim().toLowerCase()] : void 0;
  if (n) return n;
  const i = w.extname(t.split(/[?#]/, 1)[0]).toLowerCase();
  return i && i.length <= 5 ? i : Ea(r);
}
async function Hd(t) {
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
      const a = await fetch(o, { signal: AbortSignal.timeout(Fd) });
      if (!a.ok) throw new Error(`Failed to download media input (HTTP ${a.status}): ${o}`);
      const s = Bd(o, a.headers.get("content-type"), i.role), l = w.join(W.tmpdir(), `cinegen-hf-media-${Date.now()}-${n}${s}`);
      await B.promises.writeFile(l, Buffer.from(await a.arrayBuffer())), e.push(l), r.push({ ...i, value: l });
    } else if (o.startsWith("data:")) {
      const a = o.indexOf(",");
      if (a < 0) throw new Error("Malformed data: URI media input");
      const s = o.slice(5, a), l = s.replace(/;base64$/i, ""), d = o.slice(a + 1), u = /;base64$/i.test(s) ? Buffer.from(d, "base64") : Buffer.from(decodeURIComponent(d)), c = ba[l.toLowerCase()] ?? Ea(i.role), p = w.join(W.tmpdir(), `cinegen-hf-media-${Date.now()}-${n}${c}`);
      await B.promises.writeFile(p, u), e.push(p), r.push({ ...i, value: p });
    } else
      r.push(o === i.value ? i : { ...i, value: o });
  }
  return { medias: r, tempPaths: e };
}
async function _n(t) {
  const { medias: e, tempPaths: r } = await Hd(t.medias);
  let n;
  try {
    n = await Gd({ ...t, medias: e });
  } finally {
    for (const o of r)
      B.promises.unlink(o).catch(() => {
      });
  }
  if ($n(n, t.mediaType)) return n;
  const i = "jobId" in n ? n.jobId : void 0;
  if (!i) throw new Error("Higgsfield accepted the request but did not return a job id.");
  return t.wait === !1 ? {
    jobId: i,
    model: t.model,
    mediaType: t.mediaType,
    outputKind: t.mediaType,
    outputs: []
  } : Sa(i, t);
}
function va(t) {
  return new Promise((e) => setTimeout(e, t));
}
async function Gd(t) {
  const e = jd({ ...t });
  let r;
  for (let n = 1; n <= 3; n++)
    try {
      const i = await De(e, Dd), o = await yn(i, t);
      if (o) return o;
      const a = Ui(i);
      if (a) return { jobId: a };
      throw new Error("Higgsfield accepted the request but did not return a job id.");
    } catch (i) {
      r = i;
      const { stdout: o, stderr: a } = wa(i), s = await yn(o, t);
      if (s) return s;
      const l = Ui(o, a, dt(i));
      if (l) return { jobId: l };
      if (!gn(dt(i)) || n === 3) throw i;
      await va(1500 * n);
    }
  throw r instanceof Error ? r : new Error("Higgsfield submit failed");
}
function zd(t, e) {
  return t.find((r) => r.id === e || r.job_id === e || r.jobId === e || r.job_set_id === e || r.parent_id === e);
}
async function Ta(t, e) {
  try {
    const r = await Ia({ size: 50 }), n = zd(r, t);
    if (!n) return;
    const i = Bn({
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
async function Hn(t, e) {
  const r = await De(["generate", "get", t], 2e4), n = Fn(r);
  if (n.status === "failed" || n.status === "error" || n.status === "fail")
    throw new Error(typeof n.record.error == "string" ? n.record.error : "Higgsfield generation failed");
  const i = Bn(n, e);
  if (i.url || i.text) return i;
  const o = ya(r);
  return o[0] ? { ...i, url: o[0], urls: o, outputs: o.map((a) => ({ kind: e.mediaType, url: a })) } : Ta(t, e);
}
async function Vd(t) {
  try {
    return await De(
      ["generate", "wait", t, "--timeout", "20m", "--interval", "5s"],
      $i
    );
  } catch (e) {
    if (!/unknown|unexpected|unrecognized/i.test(dt(e))) throw e;
    return De(
      ["generate", "wait", t, "--wait-timeout", "20m", "--wait-interval", "5s"],
      $i
    );
  }
}
async function Sa(t, e) {
  let r;
  for (let i = 1; i <= Fi; i++)
    try {
      const o = await Vd(t);
      return _a(o, e);
    } catch (o) {
      r = o;
      const { stdout: a } = wa(o), s = await yn(a, e);
      if (s) return s;
      try {
        const u = await Hn(t, e);
        if (u) return u;
      } catch (u) {
        if (!gn(dt(u))) throw u;
      }
      const l = dt(o);
      if (!(gn(l) || /timed out/i.test(l) || /still running/i.test(l) || /without a media URL/i.test(l))) throw o;
      if (i === Fi) break;
      await va(2e3 * i);
    }
  const n = await Ta(t, e);
  if (n) return n;
  throw new Error(
    `${dt(r)} The job was submitted (${t}) and may still finish on Higgsfield.`
  );
}
function Bi(t) {
  if (Array.isArray(t)) return t.filter((e) => Ue(e));
  if (!Ue(t)) return [];
  for (const e of ["jobs", "results", "data", "items", "generations"]) {
    const r = t[e];
    if (Array.isArray(r)) return r.filter((n) => Ue(n));
  }
  return t.id || t.job_id ? [t] : [];
}
async function Ia(t) {
  const e = ["generate", "list"];
  t != null && t.video && e.push("--video"), e.push("--size", String((t == null ? void 0 : t.size) ?? 20));
  const n = (await De(e, 2e4)).trim();
  try {
    return Bi(JSON.parse(n));
  } catch {
    const i = Math.max(n.lastIndexOf("["), n.lastIndexOf("{"));
    return i < 0 ? [] : Bi(JSON.parse(n.slice(i)));
  }
}
async function Wd(t, e) {
  const r = await Hn(t, e);
  return r && $n(r, e.mediaType) ? r : Sa(t, e);
}
async function Hi() {
  try {
    const t = await De(["account", "status"], 15e3);
    return JSON.parse(t.trim());
  } catch {
    return null;
  }
}
function Gi(t) {
  if (!t) return { connected: !1 };
  const e = t.data && typeof t.data == "object" ? t.data : t, r = e.subscription_plan_type ?? e.plan;
  return {
    connected: !0,
    email: typeof e.email == "string" ? e.email : void 0,
    plan: typeof r == "string" ? r : void 0,
    credits: typeof e.credits == "number" ? e.credits : typeof e.balance == "number" ? e.balance : void 0
  };
}
function zi(t) {
  if (t.drawnFramePath && t.referenceMode === "frame") {
    const e = t.outputType === "video" ? "start_image" : "image", r = [{ value: t.drawnFramePath, role: e }];
    return t.guideFramePath && r.push({ value: t.guideFramePath, role: "image" }), r;
  }
  return t.extractedPaths.map((e, r) => ({
    value: e,
    role: t.extractedRoles[r] ?? "image"
  }));
}
function Xd() {
  x.handle("higgsfield:account-status", async () => Gi(await Hi())), x.handle("higgsfield:quick-edit", async (t, e) => {
    const { prepareClipReference: r, resolveLocalSourcePath: n } = await Promise.resolve().then(() => jo);
    console.log("[higgsfield:quick-edit] params:", { fileRef: e.fileRef, mode: e.referenceMode, model: e.model, range: [e.sourceStartSec, e.sourceEndSec] });
    let i = [];
    const o = /^https?:\/\//i.test(e.fileRef), a = o ? null : n(e.fileRef);
    if (e.drawnFramePath && e.referenceMode === "frame")
      i = zi({
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
        console.log("[higgsfield:quick-edit] extracted refs:", s.paths), i = zi({
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
    return _n({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: i.length > 0 ? i : void 0,
      aspectRatio: e.aspectRatio
    });
  }), x.handle("higgsfield:generate", async (t, e) => {
    const { resolveLocalSourcePath: r } = await Promise.resolve().then(() => jo);
    if (e.jobId) {
      const i = { model: e.model, mediaType: e.outputType };
      if (e.wait === !1) {
        const o = await Hn(e.jobId, i);
        if (o && $n(o, e.outputType)) return o;
        throw new Error("Higgsfield job is still running");
      }
      return Wd(e.jobId, i);
    }
    const n = [...e.medias ?? []].map((i) => {
      if (!i.value || /^https?:\/\//i.test(i.value)) return i;
      const o = r(i.value);
      return o ? { ...i, value: o } : i;
    });
    return e.referenceValue && n.push({
      value: e.referenceValue,
      role: e.outputType === "video" ? "start_image" : "image"
    }), _n({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: n.length > 0 ? n : void 0,
      params: e.params,
      wait: e.wait
    });
  }), x.handle("higgsfield:generate-list", async (t, e) => Ia(e)), x.handle("higgsfield:auth-login", async () => {
    try {
      await De(["auth", "login"], 300 * 1e3);
    } catch (t) {
      return { connected: !1, error: t instanceof Error ? t.message : String(t) };
    }
    return Gi(await Hi());
  }), x.handle("higgsfield:auth-logout", async () => {
    await De(["auth", "logout"], 15e3).catch(() => {
    });
  });
}
const Jd = {
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
}, Kd = {
  1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  2: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "CINEGEN_POSITIVE_PROMPT" } },
  3: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "CINEGEN_NEGATIVE_PROMPT" } },
  4: { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  5: { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 1, steps: 30, cfg: 7, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1 } },
  6: { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  7: { class_type: "SaveImage", inputs: { filename_prefix: "CineGen_SDXL", images: ["6", 0] } }
}, Yd = {
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
}, Qd = "notrius/ltx-2.5-serverless:cu130@sha256:73d1621ef915ae6a149f2a32f6c317dfc89f12075ed4b3abd7df707420267205", Gn = "https://rest.runpod.io/v1", Zd = "https://api.runpod.io/v2", xa = "https://api.runpod.io/graphql", zn = 8e3, Jr = 256 * 1024, eu = 1800, tu = 200, wn = 15e3, Aa = 6500, ru = 12e4, Vn = 12e3, ja = 14 * 1024 * 1024, nu = 100 * 1024 * 1024, Vi = 1024 * 1024, Wi = 4, ka = Object.freeze(["sdxl", "qwen-image-edit"]), iu = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYElEQVR4nO3PQQ0AIBDAMMD4WUcEj4ZkVbDtmVk/OzrgVQNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgPaBRFyAf0dnk7yAAAAAElFTkSuQmCC", ou = "balanced", Xi = Object.freeze({
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
}), au = String.raw`set -eo pipefail
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
class M extends Error {
  constructor(r, n = "RUNPOD_LTX_ERROR", i = 502) {
    super(r);
    U(this, "code");
    U(this, "statusCode");
    this.name = "RunpodLtx25Error", this.code = n, this.statusCode = i;
  }
}
class Wn extends Error {
  constructor(r) {
    super(`The provider did not respond within ${r} ms.`);
    U(this, "timeoutMs");
    this.name = "RunpodRequestTimeoutError", this.timeoutMs = r;
  }
}
function be(t, e) {
  if (typeof t != "string" || !t.trim())
    throw new M(`${e} is required.`, "MISSING_CONFIGURATION", 422);
  return t.trim();
}
function xr(t, e) {
  const r = be(t, e);
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(r))
    throw new M(`${e} is invalid.`, "INVALID_CONFIGURATION", 422);
  return r;
}
async function su(t) {
  const e = await t.text();
  if (e)
    try {
      return JSON.parse(e);
    } catch {
      return e;
    }
}
async function Ra(t, e, r = {}, n = wn) {
  const i = new AbortController(), o = r.signal, a = () => i.abort(o == null ? void 0 : o.reason);
  o != null && o.aborted ? a() : o == null || o.addEventListener("abort", a, { once: !0 });
  let s;
  const l = new Wn(n), d = new Promise((c, p) => {
    s = setTimeout(() => {
      i.abort(l), p(l);
    }, n);
  }), u = (async () => {
    const c = await t(e, { ...r, signal: i.signal }), p = await su(c);
    return { response: c, payload: p };
  })();
  try {
    return await Promise.race([u, d]);
  } finally {
    clearTimeout(s), o == null || o.removeEventListener("abort", a);
  }
}
function lu(t) {
  try {
    return new URL(t).pathname === "/health" ? Aa : wn;
  } catch {
    return wn;
  }
}
function Ar(t, e) {
  if (t && typeof t == "object") {
    const r = t, n = r.error ?? r.message ?? r.detail;
    if (typeof n == "string" && n.trim())
      return n.slice(0, 800);
    if (Array.isArray(r.errors) && r.errors.length)
      return JSON.stringify(r.errors).slice(0, 800);
  }
  return e;
}
async function Ee(t, e, r, n, i = [200, 201, 202, 204], o = lu(e)) {
  let a;
  try {
    a = await Ra(t, e, r, o);
  } catch (d) {
    throw d instanceof Wn ? new M(`${n} RunPod did not respond before the request timed out.`, "PROVIDER_TIMEOUT", 504) : new M(d instanceof Error ? d.message : n, "PROVIDER_UNREACHABLE", 502);
  }
  const { response: s, payload: l } = a;
  if (!i.includes(s.status))
    throw new M(Ar(l, `${n} (${s.status})`), "PROVIDER_ERROR", s.status);
  return l;
}
function Xn(t, e = !1) {
  return {
    Authorization: `Bearer ${t}`,
    Accept: "application/json",
    ...e ? { "Content-Type": "application/json" } : {}
  };
}
function du(t) {
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
async function uu(t, e, r) {
  var a;
  const n = new AbortController(), i = setTimeout(() => n.abort(), eu);
  let o;
  try {
    const s = new URL(`${Zd}/pods/${encodeURIComponent(r)}/logs`);
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
    const d = new TextDecoder();
    let u = "", c = await o.read();
    for (; !c.done && u.length < Jr && (u += d.decode(c.value, { stream: !0 }), !(u.length >= Jr)); ) {
      let p;
      const f = new Promise((m) => {
        p = setTimeout(() => m({ quiet: !0 }), tu);
      });
      if (c = await Promise.race([o.read(), f]), clearTimeout(p), c != null && c.quiet)
        break;
    }
    return u += d.decode(), du(u.slice(0, Jr));
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
function cu(t) {
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
const fu = Object.freeze([
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
function pu(t) {
  for (const e of fu)
    if (t.some((r) => e.patterns.some((n) => n.test(r))))
      return e;
}
function mu(t) {
  if (!Array.isArray(t))
    return [];
  const e = [];
  for (const r of t) {
    const n = r === "sdxl" ? "SDXL" : r === "qwen-image-edit" ? "Qwen Image Edit" : void 0;
    n && !e.includes(n) && e.push(n);
  }
  return e;
}
function hu(t) {
  if (!t || typeof t != "object")
    return;
  const e = typeof t.phase == "string" ? t.phase : "";
  if (e === "downloading-image-models") {
    const r = mu(t.missingModels);
    return r.length ? `Downloading ${r.join(" and ")} for this temporary session…` : "Downloading the selected image models for this temporary session…";
  }
  if (e === "loading-ltx" || e === "downloading")
    return "Downloading and loading LTX-2.5 into the GPU…";
  if (e === "verifying-models")
    return "ComfyUI is verifying the models and starting the session API…";
  if (e === "starting-comfyui")
    return "Starting ComfyUI and discovering the session models…";
}
function gu(t) {
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
async function Ji(t, e, r, n) {
  const i = `mutation { secretCreate(input: { name: ${JSON.stringify(r)}, value: ${JSON.stringify(n)}, description: "Temporary CineGen LTX-2.5 session credential" }) { id name } }`, o = new URL(xa);
  o.searchParams.set("api_key", e);
  const a = await Ee(t, o.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: i })
  }, "RunPod could not create the encrypted session secret."), s = a && Array.isArray(a.errors) ? a.errors : [], l = a == null ? void 0 : a.data, d = l == null ? void 0 : l.secretCreate;
  if (s.length || typeof (d == null ? void 0 : d.id) != "string")
    throw new M(Ar(a, "RunPod could not create the encrypted session secret."));
  return d.id;
}
async function Oa(t, e, r) {
  const n = `mutation { secretDelete(id: ${JSON.stringify(r)}) }`, i = new URL(xa);
  i.searchParams.set("api_key", e), await Ee(t, i.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: n })
  }, "RunPod could not remove a temporary session secret.");
}
function yu(t) {
  return `https://${t}-${zn}.proxy.runpod.net`;
}
function Jn(t, e) {
  const r = xr(e, "RunPod session ID"), n = new URL(be(t, "RunPod session URL"));
  if (n.protocol !== "https:" || n.username || n.password || n.hostname !== `${r}-${zn}.proxy.runpod.net`)
    throw new M("RunPod session URL is invalid.", "INVALID_CONFIGURATION", 422);
  return { podId: r, url: `${n.origin}` };
}
function _u() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
function Pa(t) {
  const e = t && typeof t == "object" ? t : {}, r = e.gpu && typeof e.gpu == "object" ? e.gpu : void 0, n = Number(e.adjustedCostPerHr ?? e.costPerHr);
  return {
    id: typeof e.id == "string" ? e.id : "",
    costPerHr: Number.isFinite(n) ? n : null,
    gpu: typeof (r == null ? void 0 : r.displayName) == "string" ? r.displayName : typeof (r == null ? void 0 : r.id) == "string" ? r.id : null,
    desiredStatus: typeof e.desiredStatus == "string" ? e.desiredStatus : "UNKNOWN"
  };
}
function wu(t) {
  const e = t === void 0 ? ou : t;
  if (typeof e != "string" || !Object.hasOwn(Xi, e))
    throw new M("Choose a valid LTX-2.5 GPU profile: economy, balanced, or performance.", "INVALID_GPU_PROFILE", 422);
  return { name: e, config: Xi[e] };
}
function bu(t) {
  if (t === void 0)
    return [];
  if (!Array.isArray(t))
    throw new M("Image models must be an array.", "INVALID_IMAGE_MODELS", 422);
  const e = [];
  for (const r of t) {
    if (typeof r != "string" || !ka.includes(r))
      throw new M("Choose only supported session image models: SDXL or Qwen Image Edit.", "INVALID_IMAGE_MODELS", 422);
    e.includes(r) || e.push(r);
  }
  return e;
}
function Eu(t, e) {
  return e.includes("qwen-image-edit") ? Math.max(t.containerDiskInGb, 200) : e.includes("sdxl") ? Math.max(t.containerDiskInGb, 160) : t.containerDiskInGb;
}
async function vu(t, e = fetch) {
  const r = be(t.runpodKey, "RunPod API key"), n = be(t.huggingFaceToken, "Hugging Face read token");
  if (!/^hf_[A-Za-z0-9]+$/.test(n))
    throw new M("Enter a valid Hugging Face read token.", "INVALID_HUGGINGFACE_TOKEN", 422);
  const i = wu(t.gpuProfile), o = bu(t.imageModels), a = _u(), s = `cinegen_ltx25_hf_${a}`, l = `cinegen_ltx25_session_${a}`, d = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ""), u = [];
  try {
    u.push(await Ji(e, r, s, n)), u.push(await Ji(e, r, l, d));
    const c = await Ee(e, `${Gn}/pods`, {
      method: "POST",
      headers: Xn(r, !0),
      body: JSON.stringify({
        name: `CineGen LTX-2.5 Session ${a}`,
        cloudType: "SECURE",
        computeType: "GPU",
        imageName: Qd,
        gpuTypeIds: [...i.config.gpuTypeIds],
        gpuTypePriority: "custom",
        gpuCount: 1,
        allowedCudaVersions: ["13.0"],
        containerDiskInGb: Eu(i.config, o),
        volumeInGb: 0,
        ports: [`${zn}/http`],
        supportPublicIp: !0,
        interruptible: !1,
        minRAMPerGPU: i.config.minRAMPerGPU,
        minVCPUPerGPU: i.config.minVCPUPerGPU,
        dockerEntrypoint: [],
        dockerStartCmd: ["bash", "-lc", au],
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
    }, "RunPod could not create the LTX-2.5 session Pod."), p = Pa(c);
    if (!p.id)
      throw new M("RunPod created a Pod without returning its ID.");
    return {
      podId: p.id,
      podUrl: yu(p.id),
      podAuthToken: d,
      secretIds: u,
      status: "downloading",
      phase: "downloading",
      message: "RunPod is downloading and loading LTX-2.5. The first session can take a while.",
      gpuProfile: i.name,
      imageModels: o,
      costPerHr: p.costPerHr,
      gpu: p.gpu
    };
  } catch (c) {
    throw await Promise.allSettled(u.map((p) => Oa(e, r, p))), c;
  }
}
async function Tu(t, e = fetch) {
  const r = be(t.runpodKey, "RunPod API key"), n = be(t.podAuthToken, "RunPod session token"), i = Jn(t.podUrl, t.podId);
  let o;
  try {
    o = await Ee(e, `${Gn}/pods/${i.podId}`, {
      headers: Xn(r)
    }, "RunPod could not read the LTX-2.5 session.");
  } catch (c) {
    if (c instanceof M && c.statusCode === 404)
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
  const a = Pa(o);
  let s;
  if (a.desiredStatus === "RUNNING")
    try {
      const { response: c, payload: p } = await Ra(e, `${i.url}/health`, {
        headers: { Authorization: `Bearer ${n}`, Accept: "application/json" }
      }, Aa);
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
        return Ma(p) ? {
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
      s = c instanceof Wn ? { kind: "timeout" } : { kind: "unreachable" };
    }
  const l = await uu(e, r, i.podId), d = pu(l);
  if (!d && cu(l))
    try {
      const c = await Na({
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
  if (d)
    return {
      status: "error",
      phase: "error",
      podId: i.podId,
      podUrl: i.url,
      message: d.message,
      startupFailure: d.kind,
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
  let u;
  return (s == null ? void 0 : s.kind) === "timeout" ? u = "RunPod reports the Pod is running, but its private gateway did not answer within 7 seconds. It may still be starting; check again shortly. Billing continues while the Pod runs." : (s == null ? void 0 : s.kind) === "response" && (s.status === 502 || s.status === 504) ? u = `RunPod reports the Pod is running, but its private gateway returned ${s.status}. The container may still be starting; check again shortly. Billing continues while the Pod runs.` : u = hu(s == null ? void 0 : s.body) ?? gu(l), !u && (s == null ? void 0 : s.kind) === "unreachable" ? u = "RunPod reports the Pod is running, but its private gateway is not reachable yet. The container may still be starting; check again shortly. Billing continues while the Pod runs." : !u && (s == null ? void 0 : s.kind) === "response" && s.status >= 400 && (u = `RunPod reports the Pod is running, but its private gateway returned HTTP ${s.status}. Check again shortly. Billing continues while the Pod runs.`), {
    status: "downloading",
    phase: "downloading",
    podId: i.podId,
    podUrl: i.url,
    message: u ?? "Downloading weights and loading LTX-2.5 into the GPU…",
    costPerHr: a.costPerHr,
    gpu: a.gpu
  };
}
async function Na(t, e = fetch) {
  const r = be(t.runpodKey, "RunPod API key"), n = xr(t.podId, "RunPod session ID");
  await Ee(e, `${Gn}/pods/${n}`, {
    method: "DELETE",
    headers: Xn(r)
  }, "RunPod could not end the LTX-2.5 session.", [200, 204, 404]);
  const i = Array.isArray(t.secretIds) ? t.secretIds.filter((s) => typeof s == "string" && /^[A-Za-z0-9_-]+$/.test(s)) : [];
  return (await Promise.allSettled(i.map((s) => Oa(e, r, s)))).filter((s) => s.status === "rejected").length ? { ok: !0, warning: "The Pod was deleted and billing stopped, but one temporary RunPod secret could not be removed." } : { ok: !0 };
}
function Su(t, e) {
  return t === "9:16" ? e === "1080p" ? { width: 1080, height: 1920 } : { width: 720, height: 1280 } : t === "1:1" ? e === "1080p" ? { width: 1080, height: 1080 } : { width: 1024, height: 1024 } : e === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}
function qa(t) {
  return Array.isArray(t.referenceImages) ? t.referenceImages.filter((e) => typeof e == "string" && e.trim()) : [];
}
function Iu(t) {
  const e = JSON.parse(JSON.stringify(Jd)), r = be(t.prompt, "Video prompt");
  if (r.length > Vn)
    throw new M("The LTX-2.5 video prompt is too long.", "PROMPT_TOO_LONG", 422);
  const n = Math.min(20, Math.max(1, Math.round(Number(t.durationSec) || 5))), i = ["16:9", "9:16", "1:1"].includes(t.aspectRatio ?? "") ? t.aspectRatio : "16:9", o = t.resolution === "1080p" ? "1080p" : "720p", a = Su(i, o);
  return e["398:376"].inputs.value = r, e[395].inputs.image = "cinegen-source.png", e["398:362"].inputs.value = n, e["398:372"].inputs.value = a.width, e["398:360"].inputs.value = a.height, e["398:361"].inputs.value = 24, e["398:380"].inputs.sampling_mode = "on", e["398:380"].inputs["sampling_mode.seed"] = Math.floor(Math.random() * 999999998) + 1, e["398:383"].inputs.value = t.generateAudio !== !1, e["398:363"].inputs.value = qa(t).length === 0, e["398:338"].inputs.noise_seed = Math.floor(Math.random() * 999999999999998) + 1, e["398:339"].inputs.noise_seed = Math.floor(Math.random() * 999999999999998) + 1, e;
}
function xu(t) {
  const e = qa(t), r = e.find((a) => a.startsWith("data:image/")) ?? (e.length ? "" : iu), n = /^data:(image\/(?:png|jpeg|webp|gif|bmp|avif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(r);
  if (!n || !n[2] || n[2].length % 4 === 1)
    throw new M("The LTX-2.5 reference image could not be prepared.", "INVALID_REFERENCE", 422);
  const i = n[2].endsWith("==") ? 2 : n[2].endsWith("=") ? 1 : 0;
  if (Math.floor(n[2].length * 0.75) - i > ja)
    throw new M("The first LTX-2.5 reference image is larger than 14 MB.", "REFERENCE_TOO_LARGE", 413);
  return r;
}
function Ca(t) {
  if (typeof t != "string" || !ka.includes(t))
    throw new M("Choose SDXL or Qwen Image Edit for this image job.", "INVALID_IMAGE_MODEL", 422);
  return t;
}
function Ki(t) {
  try {
    return Ca(t);
  } catch {
    return;
  }
}
function jr(t) {
  return t === "sdxl" ? "SDXL" : "Qwen Image Edit 2511";
}
function Yi(t, e) {
  if (t == null)
    return e;
  const r = Number(t);
  if (!Number.isInteger(r) || r < 256 || r > 2048)
    throw new M("Image width and height must be whole pixels from 256 to 2048.", "INVALID_DIMENSIONS", 422);
  return Math.max(256, Math.min(2048, Math.round(r / 16) * 16));
}
function Au(t) {
  if (t == null)
    return Math.floor(Math.random() * 999999999999998) + 1;
  const e = Number(t);
  if (!Number.isSafeInteger(e) || e < 0)
    throw new M("Image seed must be a non-negative whole number.", "INVALID_SEED", 422);
  return e;
}
function ju(t, e) {
  const r = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
    typeof t == "string" ? t.trim() : ""
  );
  if (!r || !r[2] || r[2].length % 4 === 1)
    throw new M(`Qwen reference image ${e + 1} could not be prepared.`, "INVALID_REFERENCE", 422);
  const n = r[2].endsWith("==") ? 2 : r[2].endsWith("=") ? 1 : 0;
  if (Math.floor(r[2].length * 0.75) - n > ja)
    throw new M(`Qwen reference image ${e + 1} is larger than 14 MB.`, "REFERENCE_TOO_LARGE", 413);
  return t.trim();
}
function ku(t, e) {
  const r = Array.isArray(t.referenceImages) ? t.referenceImages.filter((n) => typeof n == "string" && n.trim()) : [];
  if (e === "sdxl" && r.length)
    throw new M("SDXL session jobs are text-to-image and do not accept reference images.", "INVALID_REFERENCE", 422);
  if (e === "qwen-image-edit" && (r.length < 1 || r.length > 3))
    throw new M("Qwen Image Edit requires one to three reference images.", "INVALID_REFERENCE_COUNT", 422);
  return r.map(ju);
}
function Ru(t, e) {
  const r = be(t, e);
  if (r.length > Vn)
    throw new M(`${e} is too long.`, "PROMPT_TOO_LONG", 422);
  return r;
}
function Ou(t, e, r, n, i, o) {
  const a = JSON.parse(JSON.stringify(Kd));
  a[2].inputs.text = e, a[3].inputs.text = r, a[4].inputs.width = n, a[4].inputs.height = i, a[5].inputs.seed = o;
  const s = Number(t.steps);
  Number.isFinite(s) && (a[5].inputs.steps = Math.max(1, Math.min(100, Math.round(s))));
  const l = Number(t.guidanceScale);
  return Number.isFinite(l) && (a[5].inputs.cfg = Math.max(0, Math.min(30, l))), a;
}
function Pu(t, e, r, n) {
  const i = JSON.parse(JSON.stringify(Yd));
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
function Nu(t) {
  const e = Ca(t.model), r = Ru(t.prompt, "Image prompt"), n = typeof t.negativePrompt == "string" ? t.negativePrompt.trim().slice(0, Vn) : e === "sdxl" ? "text, watermark, logo, low quality, distorted" : "", i = Yi(t.width, 1024), o = Yi(t.height, 1024), a = Au(t.seed), s = ku(t, e), l = e === "sdxl" ? Ou(t, r, n, i, o, a) : Pu(r, n, a, s);
  return {
    model: e,
    label: jr(e),
    workflow: l,
    images: s.map((d, u) => ({
      name: `cinegen-qwen-reference-${u + 1}.png`,
      image: d
    })),
    // Qwen's official 2511 workflow scales and VAE-encodes Picture 1 as
    // the sampler latent. Keep this false so older active Pod gateways do
    // not try to inject width/height inputs into that VAEEncode node.
    preserveInputDimensions: !1
  };
}
function kr(t, e = 8) {
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
    for (const [l, d] of Object.entries(s))
      n(d, l, a + 1);
  };
  return n(t, "", 0), r;
}
function La(t) {
  for (const { record: e } of kr(t)) {
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
function Kn(t) {
  const e = t.media_type ?? t.mediaType ?? t.mime_type ?? t.mimeType;
  return typeof e == "string" && e.trim() ? e.trim() : "";
}
function mr(t, e = "video/mp4") {
  return Kn(t) || e;
}
function qu(t, e) {
  if (e === "videos" || e === "video" || Kn(t).startsWith("video/"))
    return !0;
  const n = t.filename ?? t.name;
  return typeof n == "string" && /\.(?:mp4|webm|mov|mkv|avi|m4v)(?:$|[?#])/i.test(n);
}
function Cu(t, e) {
  if (e === "images" || e === "image" || Kn(t).startsWith("image/"))
    return !0;
  const n = t.filename ?? t.name;
  return typeof n == "string" && /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(n);
}
function Ce(...t) {
  var e;
  return (e = t.find((r) => typeof r == "string" && r.trim())) == null ? void 0 : e.trim();
}
function Lu(t, e) {
  const r = La(t);
  if (r)
    throw new M(r, "GENERATION_FAILED", 502);
  for (const { record: n, parentKey: i } of kr(t)) {
    const o = Ce(n.video_url, n.videoUrl);
    if (o)
      return { url: o, durationSec: e, model: "LTX-2.5" };
    const a = Ce(n.video_base64, n.videoBase64);
    if (a)
      return { data: a, mediaType: mr(n), durationSec: e, model: "LTX-2.5" };
    if (!qu(n, i))
      continue;
    const s = Ce(n.url, n.download_url, n.downloadUrl), l = Ce(n.data, n.base64), d = s ?? (String(n.type ?? "").toLowerCase() === "url" ? l : void 0);
    if (d)
      return { url: d, durationSec: e, model: "LTX-2.5" };
    const u = String(n.type ?? "").toLowerCase() === "url" ? void 0 : l;
    if (u)
      return { data: u, mediaType: mr(n), durationSec: e, model: "LTX-2.5" };
  }
  throw new M("LTX-2.5 completed without returning a video.", "INVALID_PROVIDER_RESPONSE", 502);
}
function Uu(t, e) {
  const r = jr(e), n = La(t);
  if (n)
    throw new M(n, "GENERATION_FAILED", 502);
  for (const { record: i, parentKey: o } of kr(t)) {
    const a = Ce(i.image_url, i.imageUrl);
    if (a)
      return { url: a, model: r };
    const s = Ce(i.image_base64, i.imageBase64);
    if (s)
      return { data: s, mediaType: mr(i, "image/png"), model: r };
    if (!Cu(i, o))
      continue;
    const l = Ce(i.url, i.download_url, i.downloadUrl), d = Ce(i.data, i.base64), u = l ?? (String(i.type ?? "").toLowerCase() === "url" ? d : void 0);
    if (u)
      return { url: u, model: r };
    const c = String(i.type ?? "").toLowerCase() === "url" ? void 0 : d;
    if (c)
      return { data: c, mediaType: mr(i, "image/png"), model: r };
  }
  throw new M(`${r} completed without returning an image.`, "INVALID_PROVIDER_RESPONSE", 502);
}
function Ua(t, e = "video", r = "LTX-2.5") {
  for (const { record: n, parentKey: i } of kr(t)) {
    if (i !== "artifact")
      continue;
    const o = typeof n.id == "string" ? n.id.trim() : "", a = Number(n.byteSize ?? n.byte_size), s = typeof (n.mediaType ?? n.media_type) == "string" ? String(n.mediaType ?? n.media_type).trim() : "";
    if (!/^[A-Za-z0-9_-]{1,191}$/.test(o) || !Number.isSafeInteger(a) || a <= 0 || a > nu || s && !s.startsWith(`${e}/`))
      throw new M(`${r} returned invalid artifact metadata.`, "INVALID_PROVIDER_RESPONSE", 502);
    return { id: o, byteSize: a, mediaType: s };
  }
}
function Du(t, e = "LTX-2.5", r = "video") {
  if (typeof t != "string" || !t || t.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(t))
    throw new M(`${e} returned an invalid ${r} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
  if (typeof Buffer < "u")
    return new Uint8Array(Buffer.from(t, "base64"));
  if (typeof atob != "function")
    throw new M(`This CineGen runtime cannot decode the generated ${r}.`, "RUNTIME_UNSUPPORTED", 500);
  let n;
  try {
    n = atob(t);
  } catch {
    throw new M(`${e} returned an invalid ${r} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  const i = new Uint8Array(n.length);
  for (let o = 0; o < n.length; o += 1)
    i[o] = n.charCodeAt(o);
  return i;
}
function Mu(t, e, r = "video", n = "LTX-2.5") {
  const i = t.length >= 4 && t[0] === 26 && t[1] === 69 && t[2] === 223 && t[3] === 163, o = t.length >= 12 && String.fromCharCode(...t.subarray(4, 8)) === "ftyp", a = t.length >= 8 && t[0] === 137 && t[1] === 80 && t[2] === 78 && t[3] === 71 && t[4] === 13 && t[5] === 10 && t[6] === 26 && t[7] === 10, s = t.length >= 3 && t[0] === 255 && t[1] === 216 && t[2] === 255, l = t.length >= 12 && String.fromCharCode(...t.subarray(0, 4)) === "RIFF" && String.fromCharCode(...t.subarray(8, 12)) === "WEBP";
  if (r === "image") {
    if (a)
      return "image/png";
    if (s)
      return "image/jpeg";
    if (l)
      return "image/webp";
    throw new M(`${n} returned an unsupported image file.`, "INVALID_PROVIDER_RESPONSE", 502);
  }
  if (!i && !o)
    throw new M(`${n} returned an unsupported video file.`, "INVALID_PROVIDER_RESPONSE", 502);
  return i ? "video/webm" : e === "video/quicktime" ? "video/quicktime" : "video/mp4";
}
function $u(t, e = "media") {
  if (typeof Buffer < "u")
    return Buffer.from(t.buffer, t.byteOffset, t.byteLength).toString("base64");
  if (typeof btoa != "function")
    throw new M(`This CineGen runtime cannot encode the generated ${e}.`, "RUNTIME_UNSUPPORTED", 500);
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
async function Fu(t, e, r, n) {
  try {
    await (await t(`${e.url}/artifact/${encodeURIComponent(n)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
    })).arrayBuffer().catch(() => {
    });
  } catch {
  }
}
async function Da(t, e, r, n, i = "video", o = "LTX-2.5") {
  const a = new Uint8Array(n.byteSize);
  let s;
  const l = [];
  for (let c = 0; c < n.byteSize; c += Vi) {
    const p = Math.min(Vi, n.byteSize - c);
    l.push({ offset: c, length: p });
  }
  for (let c = 0; c < l.length; c += Wi) {
    const p = l.slice(c, c + Wi), f = await Promise.all(p.map(async ({ offset: m, length: y }) => {
      const g = new URL(`${e.url}/artifact/${encodeURIComponent(n.id)}`);
      g.searchParams.set("offset", String(m)), g.searchParams.set("length", String(y));
      const h = await Ee(t, g.toString(), {
        headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
      }, `CineGen could not download the ${o} ${i} chunk.`);
      if (!h || typeof h != "object")
        throw new M(`${o} returned an invalid ${i} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
      const _ = typeof h.id == "string" ? h.id : "", b = Number(h.offset), E = Number(h.byteSize ?? h.byte_size), S = typeof (h.mediaType ?? h.media_type) == "string" ? String(h.mediaType ?? h.media_type).trim() : "", T = Du(h.data, o, i);
      if (_ !== n.id || b !== m || E !== n.byteSize || n.mediaType && S !== n.mediaType || T.byteLength !== y)
        throw new M(`${o} returned an inconsistent ${i} chunk.`, "INVALID_PROVIDER_RESPONSE", 502);
      return { offset: m, bytes: T };
    }));
    for (const m of f)
      m.offset === 0 && (s = m.bytes.slice(0, 12)), a.set(m.bytes, m.offset);
  }
  const d = Mu(s ?? new Uint8Array(), n.mediaType, i, o), u = $u(a, i);
  return await Fu(t, e, r, n.id), { data: u, mediaType: d };
}
function Ma(t) {
  if (!t || typeof t != "object")
    return !1;
  const e = t.capabilities;
  return Number(t.apiVersion) >= 2 && e && typeof e == "object" && e.artifactChunks === !0;
}
async function $a(t, e, r) {
  const n = await Ee(t, `${e.url}/health`, {
    headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
  }, "CineGen could not verify the LTX-2.5 session.");
  if (Ma(n))
    return n;
  throw new M(
    "This LTX-2.5 Pod was started before CineGen's reliable video-transfer update. End this session in Settings, then start a new LTX-2.5 session before rendering again.",
    "SESSION_UPDATE_REQUIRED",
    409
  );
}
async function Bu(t, e, r, n) {
  const i = await $a(t, e, r), o = i == null ? void 0 : i.capabilities, a = Array.isArray(i == null ? void 0 : i.installedModels) ? i.installedModels : [];
  if ((o == null ? void 0 : o.imageArtifacts) !== !0)
    throw new M(
      "This Pod was started before CineGen added session image generation. End it, then start a new session with the image model selected.",
      "SESSION_UPDATE_REQUIRED",
      409
    );
  if (!a.includes(n))
    throw new M(
      `${jr(n)} was not installed when this Pod was created. Start a new session with that image model selected.`,
      "IMAGE_MODEL_NOT_INSTALLED",
      409
    );
  return i;
}
function Hu() {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}
function Gu(t) {
  return t instanceof M && (t.code === "PROVIDER_TIMEOUT" || t.code === "PROVIDER_UNREACHABLE" || t.statusCode === 502 || t.statusCode === 504);
}
async function zu(t, e, r, n) {
  try {
    const i = await Ee(t, `${e.url}/status/${n}`, {
      headers: { Authorization: `Bearer ${r}`, Accept: "application/json" }
    }, "CineGen could not recover the submitted generation.", [200, 404]);
    return i && typeof i == "object" && i.id === n ? i : void 0;
  } catch {
    return;
  }
}
async function Fa(t, e, r, n, i, o, a) {
  var c;
  const s = Hu(), l = ((c = i == null ? void 0 : i.capabilities) == null ? void 0 : c.idempotentSubmissions) === !0, d = JSON.stringify({ input: { ...o, cinegen_job_id: s } }), u = () => Ee(t, `${e.url}/run`, {
    method: "POST",
    headers: { ...n, "Idempotency-Key": s },
    body: d
  }, a, void 0, ru);
  for (let p = 0; p < (l ? 2 : 1); p += 1)
    try {
      const f = await u(), m = typeof (f == null ? void 0 : f.id) == "string" ? f.id : "";
      if (!m)
        throw new M("The session did not return a generation job ID.", "INVALID_PROVIDER_RESPONSE", 502);
      if (l && m !== s)
        throw new M("The session returned a different generation job ID.", "INVALID_PROVIDER_RESPONSE", 502);
      return { payload: f, jobId: m };
    } catch (f) {
      if (!l || !Gu(f))
        throw f;
      const m = await zu(t, e, r, s);
      if (m)
        return { payload: m, jobId: s };
      if (p === 1)
        throw f;
    }
  throw new M("CineGen could not confirm the generation submission.", "PROVIDER_TIMEOUT", 504);
}
async function Vu(t, e = fetch) {
  const r = Jn(t.podUrl, t.podId), n = be(t.podAuthToken, "RunPod session token"), i = { Authorization: `Bearer ${n}`, Accept: "application/json", "Content-Type": "application/json" };
  if (t.jobId) {
    const d = xr(t.jobId, "RunPod generation job ID"), u = await Ee(e, `${r.url}/status/${d}`, {
      headers: { Authorization: `Bearer ${n}`, Accept: "application/json" }
    }, "CineGen could not read the LTX-2.5 generation status."), c = String(u.status ?? "").toUpperCase();
    if (c === "IN_QUEUE")
      return { jobId: d, status: "queued", phase: "rendering", message: "Waiting for the LTX-2.5 renderer…" };
    if (c === "IN_PROGRESS")
      return { jobId: d, status: "in_progress", phase: "rendering", message: "LTX-2.5 is rendering the video…" };
    if (c === "FAILED")
      return { jobId: d, status: "failed", phase: "error", error: Ar(u, "LTX-2.5 generation failed.") };
    if (c === "COMPLETED") {
      const p = Math.min(20, Math.max(1, Math.round(Number(u.durationSec) || 5)));
      try {
        const f = Ua(u.output), m = f ? { ...await Da(e, r, n, f), durationSec: p, model: "LTX-2.5" } : Lu(u.output, p);
        return { jobId: d, status: "completed", phase: "ready", output: m };
      } catch (f) {
        return { jobId: d, status: "failed", phase: "error", error: f instanceof Error ? f.message : "LTX-2.5 generation failed." };
      }
    }
    return { jobId: d, status: "in_progress", phase: "rendering", message: "LTX-2.5 is preparing the video…" };
  }
  if (!t.input)
    throw new M("Video generation input is required.", "MISSING_INPUT", 422);
  const o = Math.min(20, Math.max(1, Math.round(Number(t.input.durationSec) || 5))), a = {
    workflow: Iu(t.input),
    images: [{ name: "cinegen-source.png", image: xu(t.input) }],
    cinegen_duration_sec: o,
    cinegen_task: "ltx-2.5"
  }, s = await $a(e, r, n), { jobId: l } = await Fa(e, r, n, i, s, a, "CineGen could not submit the LTX-2.5 generation.");
  return { jobId: l, status: "queued", phase: "rendering", message: "LTX-2.5 generation queued." };
}
async function Wu(t, e = fetch) {
  var l;
  const r = Jn(t.podUrl, t.podId), n = be(t.podAuthToken, "RunPod session token"), i = { Authorization: `Bearer ${n}`, Accept: "application/json", "Content-Type": "application/json" };
  if (t.jobId) {
    const d = xr(t.jobId, "RunPod generation job ID"), u = await Ee(e, `${r.url}/status/${d}`, {
      headers: { Authorization: `Bearer ${n}`, Accept: "application/json" }
    }, "CineGen could not read the session image generation status."), c = Ki(u == null ? void 0 : u.task), p = Ki(t.model ?? ((l = t.input) == null ? void 0 : l.model));
    if (c && p && c !== p)
      return { jobId: d, status: "failed", phase: "error", error: "The Pod returned an image-generation task that does not match this job." };
    const f = c ?? p;
    if (!f)
      return { jobId: d, status: "failed", phase: "error", error: "The Pod returned an invalid image-generation task." };
    const m = jr(f), y = String(u.status ?? "").toUpperCase();
    if (y === "IN_QUEUE")
      return { jobId: d, status: "queued", phase: "rendering", message: `Waiting for the ${m} renderer…` };
    if (y === "IN_PROGRESS")
      return { jobId: d, status: "in_progress", phase: "rendering", message: `${m} is rendering the image…` };
    if (y === "FAILED")
      return { jobId: d, status: "failed", phase: "error", error: Ar(u, `${m} generation failed.`) };
    if (y === "COMPLETED")
      try {
        const g = Ua(u.output, "image", m), h = g ? { ...await Da(e, r, n, g, "image", m), model: m } : Uu(u.output, f);
        return { jobId: d, status: "completed", phase: "ready", output: h };
      } catch (g) {
        return { jobId: d, status: "failed", phase: "error", error: g instanceof Error ? g.message : `${m} generation failed.` };
      }
    return { jobId: d, status: "in_progress", phase: "rendering", message: `${m} is preparing the image…` };
  }
  if (!t.input)
    throw new M("Image generation input is required.", "MISSING_INPUT", 422);
  const o = Nu(t.input), a = await Bu(e, r, n, o.model), { jobId: s } = await Fa(e, r, n, i, a, {
    workflow: o.workflow,
    images: o.images,
    cinegen_task: o.model,
    cinegen_preserve_input_dimensions: o.preserveInputDimensions
  }, `CineGen could not submit the ${o.label} generation.`);
  return { jobId: s, status: "queued", phase: "rendering", message: `${o.label} generation queued.` };
}
const Xu = vu, Ju = Tu, Ku = Na, Yu = Vu, Qu = Wu, lt = "https://api.kie.ai/api/v1", Zu = 3e3, ec = 120, tc = {
  runway: `${lt}/runway/generate`,
  veo: `${lt}/veo/generate`,
  "4o-image": `${lt}/gpt4o-image/generate`,
  "suno-music": `${lt}/generate`
};
function rc(t) {
  for (const [e, r] of Object.entries(tc))
    if (t.startsWith(e)) return r;
}
async function nc(t, e, r) {
  const n = rc(t), i = n ?? `${lt}/jobs/createTask`, o = n ? { ...e, callBackUrl: "" } : { model: t, input: e, callBackUrl: "" }, a = await fetch(i, {
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
async function ic(t, e) {
  for (let r = 0; r < ec; r++) {
    await new Promise((a) => setTimeout(a, Zu));
    const n = await fetch(`${lt}/jobs/recordInfo?taskId=${t}`, {
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
async function oc(t, e, r) {
  const n = await nc(t, e, r);
  return await ic(n, r);
}
const ac = /* @__PURE__ */ new Set([
  "image",
  "start_image",
  "end_image",
  "video",
  "audio"
]), sc = {
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
function Ba(t) {
  if (!t.startsWith("local-media://file")) return t;
  try {
    return decodeURIComponent(t.slice(18));
  } catch {
    return t.slice(18);
  }
}
function lc(t, e) {
  const r = t.role ?? t.media_role ?? t.mediaRole;
  if (typeof r == "string" && ac.has(r))
    return { role: r, explicit: !0 };
  const n = String(t.type ?? t.kind ?? t.media_type ?? t.mediaType ?? t.mime_type ?? "").toLowerCase();
  return n === "start_image" || n === "start-image" ? { role: "start_image", explicit: !0 } : n === "end_image" || n === "end-image" ? { role: "end_image", explicit: !0 } : n.includes("audio") ? { role: "audio", explicit: !0 } : n.includes("video") ? { role: "video", explicit: !0 } : n.includes("image") ? { role: "image", explicit: !0 } : { role: e, explicit: !1 };
}
function dc(t, e) {
  const r = t.split(/[?#]/, 1)[0].toLowerCase();
  return r.startsWith("data:audio/") || /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/.test(r) ? "audio" : r.startsWith("data:video/") || /\.(?:avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(r) ? "video" : e;
}
function uc(t) {
  return t === "video" ? "start_image" : t === "text" ? "video" : t === "audio" ? "audio" : "image";
}
function Ft(t, e, r = !1) {
  if (typeof t == "string") {
    const a = Ba(t).trim(), s = r ? dc(a, e) : e;
    return a ? [{ value: a, role: s }] : [];
  }
  if (Array.isArray(t))
    return t.flatMap((a) => Ft(a, e, r));
  if (!t || typeof t != "object") return [];
  const n = t, i = lc(n, e);
  if (Array.isArray(n.allUrls))
    return n.allUrls.flatMap((a) => Ft(
      a,
      i.role,
      r && !i.explicit
    ));
  const o = n.value ?? n.url ?? n.fileRef ?? n.path ?? n.id ?? n.uuid ?? n.media_id ?? n.mediaId ?? n.frontalImageUrl;
  return Ft(
    o,
    i.role,
    r && !i.explicit
  );
}
function cc(t, e, r) {
  const n = [], i = {}, o = t === "seedance_2_5" ? "image" : uc(r);
  for (const [a, s] of Object.entries(e)) {
    if (s == null) continue;
    if (a === "medias" || a === "higgsfield_media_inputs") {
      n.push(...Ft(
        s,
        o,
        !0
      ));
      continue;
    }
    const l = sc[a];
    if (l) {
      const d = l === "legacy-image" ? r === "video" ? "start_image" : "image" : l;
      n.push(...Ft(s, d));
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
function fc(t) {
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
async function pc(t, e, r) {
  const n = await _n(cc(t, e, r));
  return fc(n);
}
const Qi = "https://api.runpod.ai/v2", mc = 3e3, hc = 120;
async function gc(t, e, r) {
  if (!t) throw new Error("No RunPod endpoint ID configured for this model. Set it in the model definition.");
  const n = await fetch(`${Qi}/${t}/run`, {
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
  for (let o = 0; o < hc; o++) {
    await new Promise((l) => setTimeout(l, mc));
    const a = await fetch(`${Qi}/${t}/status/${i}`, {
      headers: { Authorization: `Bearer ${r}` }
    });
    if (!a.ok) continue;
    const s = await a.json();
    if (s.status === "COMPLETED") {
      const l = s.output, d = (l == null ? void 0 : l.image_url) ?? (l == null ? void 0 : l.image);
      if (d && !d.startsWith("http") && !d.startsWith("local-media://")) {
        const u = d.includes(",") ? d.split(",")[1] : d, c = w.join(W.tmpdir(), `cinegen-runpod-${Date.now()}.png`);
        return await R.writeFile(c, Buffer.from(u, "base64")), { output: { ...l, image_url: `local-media://file${c}` } };
      }
      return { output: l };
    }
    if (s.status === "FAILED")
      throw new Error(s.error || "RunPod job failed");
  }
  throw new Error("RunPod job timed out");
}
async function yc(t, e, r) {
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
async function Zi(t, e, r) {
  const n = `https://api.runpod.io/graphql?api_key=${t}`, i = r === "start" ? `mutation { podResume(input: { podId: "${e}" }) { id desiredStatus } }` : `mutation { podStop(input: { podId: "${e}" }) { id desiredStatus } }`, a = await (await fetch(n, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: i })
  })).json();
  if (a.errors)
    throw new Error(`RunPod pod ${r} failed: ${JSON.stringify(a.errors)}`);
  return a;
}
async function _c(t, e) {
  var l, d, u;
  const r = `https://api.runpod.io/graphql?api_key=${t}`, n = `{ pod(input: { podId: "${e}" }) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort type } } } }`, a = (l = (await (await fetch(r, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: n })
  })).json()).data) == null ? void 0 : l.pod;
  if (!a) throw new Error("Pod not found");
  const s = (u = (d = a.runtime) == null ? void 0 : d.ports) == null ? void 0 : u.find((c) => c.privatePort === 8e3 && c.isIpPublic);
  return {
    status: a.desiredStatus,
    ip: (s == null ? void 0 : s.ip) ?? null,
    port: (s == null ? void 0 : s.publicPort) ?? null
  };
}
const ut = 14 * 1024 * 1024, eo = 100 * 1024 * 1024, to = 100 * 1024 * 1024, wc = 45e3;
function Yn(t) {
  if (t.length >= 8 && t.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (t.length >= 3 && t[0] === 255 && t[1] === 216 && t[2] === 255) return "image/jpeg";
  if (t.length >= 12 && t.subarray(0, 4).toString("ascii") === "RIFF" && t.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (t.length >= 6 && /^GIF8[79]a$/.test(t.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (t.length >= 2 && t.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  if (t.length >= 12 && t.subarray(4, 8).toString("ascii") === "ftyp" && /^(avif|avis)$/.test(t.subarray(8, 12).toString("ascii"))) return "image/avif";
}
function bc(t) {
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
async function Ec(t) {
  const e = Number(t.headers.get("content-length"));
  if (Number.isFinite(e) && e > ut)
    throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
  if (!t.body) {
    const o = Buffer.from(await t.arrayBuffer());
    if (o.byteLength > ut) throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
    return o;
  }
  const r = t.body.getReader(), n = [];
  let i = 0;
  try {
    for (; ; ) {
      const { done: o, value: a } = await r.read();
      if (o) break;
      if (i += a.byteLength, i > ut)
        throw await r.cancel(), new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
      n.push(Buffer.from(a));
    }
  } finally {
    r.releaseLock();
  }
  return Buffer.concat(n, i);
}
function ro(t) {
  const e = Yn(t);
  if (!e) throw new Error("LTX-2.5 requires a supported raster image as its first-frame reference.");
  return `data:${e};base64,${t.toString("base64")}`;
}
async function Ha(t) {
  if (t.startsWith("data:image/")) return t;
  if (t.startsWith("local-media://file")) {
    const e = Ba(t), r = await R.stat(e);
    if (!r.isFile()) throw new Error("The LTX-2.5 first-frame reference is not a file.");
    if (r.size > ut) throw new Error("The LTX-2.5 first-frame reference is larger than 14 MB.");
    const n = await R.readFile(e);
    return ro(n);
  }
  if (/^https?:\/\//i.test(t)) {
    const e = bc(t), r = new AbortController(), n = setTimeout(() => r.abort(), wc);
    let i;
    try {
      i = await fetch(e, { redirect: "error", signal: r.signal });
    } catch {
      throw clearTimeout(n), new Error("Could not load the LTX-2.5 first-frame reference.");
    }
    try {
      if (!i.ok) throw new Error(`Could not load the LTX-2.5 first-frame reference (${i.status}).`);
      return ro(await Ec(i));
    } catch (o) {
      throw r.signal.aborted ? new Error("Loading the LTX-2.5 first-frame reference timed out.") : o;
    } finally {
      clearTimeout(n);
    }
  }
  throw new Error("The LTX-2.5 first-frame reference is not available to the desktop app.");
}
async function vc(t) {
  var r;
  const e = (r = t.referenceImages) == null ? void 0 : r.find((n) => typeof n == "string" && n.trim());
  return {
    ...t,
    referenceImages: e ? [await Ha(e)] : void 0
  };
}
function Tc(t, e) {
  var a;
  const r = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(t.trim()), n = ((a = r == null ? void 0 : r[1]) == null ? void 0 : a.replace(/\s+/g, "")) ?? "";
  if (!n || n.length > Math.ceil(ut / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(n) || n.length % 4 === 1)
    throw new Error(`RunPod reference image ${e + 1} is invalid or larger than 14 MB.`);
  const i = Buffer.from(n, "base64");
  if (!i.length || i.byteLength > ut)
    throw new Error(`RunPod reference image ${e + 1} is invalid or larger than 14 MB.`);
  const o = Yn(i);
  if (o !== "image/png" && o !== "image/jpeg" && o !== "image/webp")
    throw new Error(`RunPod reference image ${e + 1} must be a PNG, JPEG, or WebP image.`);
  return `data:${o};base64,${i.toString("base64")}`;
}
async function Sc(t) {
  const e = Array.isArray(t.referenceImages) ? t.referenceImages.filter((n) => typeof n == "string" && n.trim()) : [];
  if (e.length > 3)
    throw new Error("RunPod session image jobs support up to three reference images.");
  const r = await Promise.all(e.map(async (n, i) => {
    const o = n.trim().startsWith("data:") ? n : await Ha(n.trim());
    return Tc(o, i);
  }));
  return {
    ...t,
    referenceImages: r.length ? r : void 0
  };
}
async function Ic(t) {
  var s;
  const e = (s = t.output) == null ? void 0 : s.data;
  if (!e) return t;
  const r = e.includes(",") ? e.slice(e.indexOf(",") + 1) : e;
  if (!r || r.length > Math.ceil(eo / 3) * 4 + 8)
    throw new Error("The LTX-2.5 video is larger than CineGen can import automatically.");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(r) || r.length % 4 === 1)
    throw new Error("LTX-2.5 returned an invalid video file.");
  const n = Buffer.from(r, "base64");
  if (n.byteLength > eo) throw new Error("The LTX-2.5 video is larger than CineGen can import automatically.");
  const i = n.length >= 4 && n.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")) ? ".webm" : n.length >= 12 && n.subarray(4, 8).toString("ascii") === "ftyp" ? ".mp4" : void 0;
  if (!i) throw new Error("LTX-2.5 returned an unsupported video file.");
  const o = await R.mkdtemp(w.join(W.tmpdir(), "cinegen-ltx25-")), a = w.join(o, `result${i}`);
  return await R.writeFile(a, n, { flag: "wx", mode: 384 }), {
    ...t,
    output: {
      ...t.output,
      url: `local-media://file${a}`,
      mediaType: i === ".webm" ? "video/webm" : "video/mp4",
      data: void 0
    }
  };
}
async function xc(t) {
  var c, p;
  const e = (p = (c = t.output) == null ? void 0 : c.data) == null ? void 0 : p.trim();
  if (!e) return t;
  const r = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(e), n = ((r == null ? void 0 : r[1]) ?? e).replace(/\s+/g, "");
  if (!n || n.length > Math.ceil(to / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(n) || n.length % 4 === 1)
    throw new Error("RunPod returned an invalid or oversized image file.");
  const i = Buffer.from(n, "base64");
  if (!i.length || i.byteLength > to)
    throw new Error("RunPod returned an invalid or oversized image file.");
  const o = Yn(i), a = o === "image/png" ? ".png" : o === "image/jpeg" ? ".jpg" : o === "image/webp" ? ".webp" : void 0;
  if (!a || !o) throw new Error("RunPod returned an unsupported image file.");
  const s = await R.mkdtemp(w.join(W.tmpdir(), "cinegen-runpod-image-")), l = w.join(s, `result${a}`);
  await R.writeFile(l, i, { flag: "wx", mode: 384 });
  const { data: d, ...u } = t.output;
  return {
    ...t,
    output: {
      ...u,
      url: `local-media://file${l}`,
      mediaType: o
    }
  };
}
function bn(t) {
  K.fal.config({ credentials: t });
}
function Ac(t) {
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
async function no(t) {
  const e = decodeURIComponent(t.replace("local-media://file", "")), r = await R.readFile(e), n = Ac(e), i = new Blob([r], { type: n }), o = new File([i], w.basename(e), { type: n });
  return K.fal.storage.upload(o);
}
async function hr(t) {
  const e = {};
  for (const [r, n] of Object.entries(t))
    typeof n == "string" && n.startsWith("local-media://file") ? e[r] = await no(n) : Array.isArray(n) ? e[r] = await Promise.all(
      n.map(async (i) => typeof i == "string" && i.startsWith("local-media://file") ? no(i) : i && typeof i == "object" && !Array.isArray(i) ? hr(i) : i)
    ) : n && typeof n == "object" && !Array.isArray(n) ? e[r] = await hr(n) : e[r] = n;
  return e;
}
async function io(t, e, r) {
  var n;
  bn(r), console.log("[fal] Calling model:", t, "with input:", JSON.stringify(e, null, 2));
  try {
    return await K.fal.subscribe(t, { input: e, logs: !0 });
  } catch (i) {
    throw console.error("[fal] Error details:", JSON.stringify((i == null ? void 0 : i.body) ?? i, null, 2)), (n = i == null ? void 0 : i.body) != null && n.detail && console.error("[fal] Validation errors:", JSON.stringify(i.body.detail, null, 2)), i;
  }
}
function jc() {
  x.handle("workflow:run", async (e, r) => {
    const {
      apiKey: n,
      kieKey: i,
      runpodKey: o,
      runpodEndpointId: a,
      podUrl: s,
      nodeId: l,
      nodeType: d,
      modelId: u,
      outputType: c,
      inputs: p
    } = r, { ALL_MODELS: f, resolveVideoModelEndpoint: m, sanitizeVideoInputsForEndpoint: y } = await import("./models-DlHvZjyX.js"), g = f[u] ?? Object.values(f).find(
      (v) => v.id === u || v.altId === u || v.nodeType === u
    );
    if (!g) {
      if (u.startsWith("fal-ai/")) {
        const v = n;
        if (!v) throw new Error("No fal.ai API key provided. Add one in Settings.");
        bn(v);
        const A = await hr(p), q = await io(u, A, v);
        return q.data ?? q;
      }
      throw new Error(`Unknown model: ${u}`);
    }
    const h = g.provider;
    let _ = p;
    h !== "higgsfield" && (n && bn(n), _ = await hr(p));
    let b = u.includes("/") ? u : g.id;
    const E = g.nodeType ?? u, S = Object.keys(_).some(
      (v) => v === "image_url" || v === "start_image_url" || v === "image_urls" || v === "imageUrl"
    );
    b = m(E, g, {
      hasImageInputs: S,
      quality: _.quality
    }), y(E, b, _);
    let T;
    if (h === "kie") {
      const v = i;
      if (!v) throw new Error("No kie.ai API key provided. Add one in Settings.");
      T = await oc(b, _, v);
    } else if (h === "pod") {
      if (!s) throw new Error("No pod URL configured. Start your pod and set the URL in Settings.");
      const v = g.podRoute ?? b;
      T = await yc(s, v, _);
    } else if (h === "runpod") {
      const v = o;
      if (!v) throw new Error("No RunPod API key provided. Add one in Settings.");
      const A = a || g.runpodEndpointId || "";
      T = await gc(A, _, v);
    } else if (h === "higgsfield") {
      const v = g.outputType;
      T = await pc(b, _, c ?? (v === "video" ? "video" : v === "audio" ? "audio" : v === "text" ? "text" : v === "3d" || v === "model3d" || v === "model" ? "3d" : "image"));
    } else {
      const v = n;
      if (!v) throw new Error("No fal.ai API key provided. Add one in Settings.");
      T = await io(b, _, v);
    }
    return T.data ?? T;
  });
  const t = /* @__PURE__ */ new Map();
  x.handle("workflow:poll-job", async (e, r) => {
    const n = t.get(r);
    if (!n) throw new Error("Job not found");
    return n;
  }), x.handle("pod:start", async (e, r) => await Zi(r.runpodKey, r.podId, "start")), x.handle("pod:stop", async (e, r) => await Zi(r.runpodKey, r.podId, "stop")), x.handle("pod:status", async (e, r) => await _c(r.runpodKey, r.podId)), x.handle("pod:setup-ltx25", async (e, r) => await Xu(r)), x.handle("pod:status-ltx25", async (e, r) => await Ju(r)), x.handle("pod:terminate-ltx25", async (e, r) => await Ku(r)), x.handle("pod:generate-ltx25", async (e, r) => {
    const n = r.input ? await vc(r.input) : void 0;
    return await Ic(await Yu({ ...r, input: n }));
  }), x.handle("pod:generate-session-image", async (e, r) => {
    const n = r.input ? await Sc(r.input) : void 0;
    return await xc(await Qu({ ...r, input: n }));
  });
}
const ht = vr(pt), Ga = "https://mcp.artlist.io/mcp", gt = "artlist", kc = 1200 * 1e3, Rc = [
  w.join(W.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
];
function yt() {
  const t = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [w.join(W.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", t].filter(Boolean).join(w.delimiter)
  };
}
async function nr() {
  for (const t of Rc)
    try {
      const { stdout: e } = await ht(t, ["--version"], {
        env: yt(),
        timeout: 8e3
      });
      if (e.toLowerCase().includes("claude")) return t;
    } catch {
    }
  return null;
}
function Oc() {
  return JSON.stringify({
    mcpServers: {
      [gt]: {
        type: "http",
        url: Ga
      }
    }
  });
}
function Pc(t) {
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
function Bt(t) {
  if (!t || typeof t != "object") return [];
  const e = t, r = ["result", "data", "output"].flatMap((n) => {
    const i = e[n];
    if (i && typeof i == "object") return Bt(i);
    if (typeof i == "string")
      try {
        return Bt(JSON.parse(i));
      } catch {
        return [];
      }
    return [];
  });
  return [e, ...r];
}
function Ve(t, e) {
  for (const r of e) {
    const n = t[r];
    if (typeof n == "string" && n.trim()) return n.trim();
  }
}
function Nc(t) {
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
    const d = r;
    for (const u of ["result", "text", "message"])
      typeof d[u] == "string" && n.unshift(d[u]);
  }
  const i = Bt(r);
  for (const d of n) {
    const u = (a = d.match(/```(?:json)?\s*([\s\S]*?)```/i)) == null ? void 0 : a[1];
    for (const p of [u, d])
      if (p)
        try {
          i.unshift(...Bt(JSON.parse(p)));
        } catch {
        }
    const c = (s = d.match(/\{[\s\S]*\}/)) == null ? void 0 : s[0];
    if (c)
      try {
        i.unshift(...Bt(JSON.parse(c)));
      } catch {
      }
  }
  for (const d of i) {
    const u = Ve(d, ["url", "videoUrl", "video_url", "downloadUrl", "download_url", "mediaUrl", "media_url"]);
    if (!u || !/^https?:\/\//i.test(u)) continue;
    const c = Number(d.durationSec ?? d.duration_sec ?? d.duration);
    return {
      url: u,
      mediaType: "video",
      ...Number.isFinite(c) && c > 0 ? { durationSec: c } : {},
      ...Ve(d, ["generationId", "generation_id", "id"]) ? { generationId: Ve(d, ["generationId", "generation_id", "id"]) } : {},
      ...Ve(d, ["accountUrl", "account_url", "sessionUrl", "session_url"]) ? { accountUrl: Ve(d, ["accountUrl", "account_url", "sessionUrl", "session_url"]) } : {},
      ...Ve(d, ["model", "modelId", "model_id"]) ? { model: Ve(d, ["model", "modelId", "model_id"]) } : {}
    };
  }
  const o = (l = n.join(`
`).match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/i)) == null ? void 0 : l[0];
  if (o) return { url: o, mediaType: "video" };
  throw new Error("Artlist finished without returning a downloadable video URL. Open the Artlist MCP session in your account to retrieve the generation.");
}
async function Ht(t) {
  try {
    const { stdout: e, stderr: r } = await ht(t, ["mcp", "get", gt], {
      env: yt(),
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
async function qc(t) {
  (await Ht(t)).configured || await ht(t, [
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    "user",
    gt,
    Ga
  ], {
    env: yt(),
    timeout: 2e4
  });
}
function Cc(t) {
  return `'${t.replace(/'/g, "'\\''")}'`;
}
function Lc(t, e = process.platform, r = "/tmp/cinegen-artlist-login.command") {
  if (e === "darwin") {
    const n = [
      "#!/bin/zsh",
      "printf '\\033]0;Artlist sign in\\007'",
      `${Cc(t)} mcp login ${gt}`,
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
  return { file: t, args: ["mcp", "login", gt], detached: !1 };
}
function Uc(t) {
  const e = t && typeof t == "object" ? `${String(t.message ?? "")}
${String(t.stderr ?? "")}` : String(t ?? "");
  return /stdin isn't a terminal|interactive terminal|authentication can't be completed/i.test(e) ? "Artlist sign-in needs an interactive window. Update Claude Code, then try Connect Artlist again." : /timed out|ETIMEDOUT/i.test(e) ? "Artlist sign-in timed out before browser authorization finished. Try connecting again." : "Artlist sign-in did not complete. Try Connect Artlist again.";
}
async function Dc(t, e = 180 * 1e3) {
  const r = Date.now() + e;
  for (; Date.now() < r; ) {
    const n = await Ht(t);
    if (n.connected) return n;
    await new Promise((i) => setTimeout(i, 2e3));
  }
  throw new Error("Artlist authorization was not completed. Finish sign-in in the browser, then try Connect Artlist again.");
}
async function Mc(t, e) {
  const r = w.join(J.getPath("userData"), "artlist-mcp-workspace");
  await Je(r, { recursive: !0 });
  const n = Pc(e), { stdout: i } = await ht(t, [
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
    Oc(),
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--disable-slash-commands",
    "--no-session-persistence"
  ], {
    cwd: r,
    env: yt(),
    timeout: kc,
    maxBuffer: 10 * 1024 * 1024
  });
  return Nc(i);
}
function $c() {
  x.handle("artlist:account-status", async () => {
    const t = await nr();
    return t ? Ht(t) : { connected: !1, configured: !1, error: "Claude Code is required for the Artlist MCP connection." };
  }), x.handle("artlist:auth-login", async () => {
    const t = await nr();
    if (!t) throw new Error("Install Claude Code before connecting Artlist.");
    await qc(t);
    const e = Lc(
      t,
      process.platform,
      w.join(J.getPath("userData"), "artlist-login.command")
    );
    try {
      e.script && (await Ks(e.script.path, e.script.contents, { mode: 448 }), await Ys(e.script.path, 448)), await ht(e.file, e.args, {
        env: yt(),
        timeout: e.detached ? 2e4 : 300 * 1e3,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch (r) {
      throw new Error(Uc(r));
    }
    return e.detached ? Dc(t) : Ht(t);
  }), x.handle("artlist:auth-logout", async () => {
    const t = await nr();
    t && await ht(t, ["mcp", "logout", gt], {
      env: yt(),
      timeout: 2e4
    });
  }), x.handle("artlist:generate", async (t, e) => {
    var i;
    const r = await nr();
    if (!r) throw new Error("Claude Code is required to use the Artlist MCP.");
    if (!(await Ht(r)).connected) throw new Error("Connect your Artlist account in Settings before generating.");
    if (!((i = e == null ? void 0 : e.prompt) != null && i.trim())) throw new Error("Artlist generation requires a prompt.");
    return Mc(r, e);
  });
}
const Fc = "https://mcp.topview.ai/mcp", Kr = "https://mcp.topview.ai", Bc = "https://www.topview.ai/mcp_oauth/oauth/authorize", Hc = "https://www.topview.ai/mcp_oauth/oauth/token", Gc = "https://www.topview.ai/mcp_oauth/oauth/register", oo = "https://www.topview.ai/mcp_oauth/oauth/userinfo", zc = 300 * 1e3, ao = 1200 * 1e3, Vc = 90 * 1e3, Wc = 30 * 1e3, gr = 45 * 1024 * 1024, so = 50;
function F(t) {
  return typeof t == "object" && t !== null && !Array.isArray(t);
}
function Yr(t) {
  return t.toString("base64url");
}
function lo(t, e) {
  return t instanceof Error && t.message.trim() ? t.message.trim() : typeof t == "string" && t.trim() ? t.trim() : e;
}
function Qr(t) {
  return t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function Xc(t, e) {
  const r = t ? "Topview connected" : "Topview connection failed";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${Qr(r)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f2eee8;font-family:system-ui,sans-serif}main{width:min(440px,calc(100vw - 48px));padding:34px;border:1px solid #343239;border-radius:22px;background:#191a20;box-shadow:0 24px 80px #0008}small{color:#d7a552;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;margin:10px 0 8px}p{color:#aaa6a0;line-height:1.55;margin:0}</style></head><body><main><small>CineGen + Topview</small><h1>${Qr(r)}</h1><p>${Qr(e)}</p></main><script>setTimeout(()=>window.close(),1100)<\/script></body></html>`;
}
function uo(t, e, r) {
  const n = Xc(e, r);
  t.writeHead(e ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(n),
    "Cache-Control": "no-store"
  }), t.end(n);
}
class Jc {
  constructor() {
    this.root = w.join(J.getPath("userData"), "integrations", "topview");
  }
  availabilityError() {
    try {
      return Zt.isEncryptionAvailable() ? process.platform === "linux" && Zt.getSelectedStorageBackend() === "basic_text" ? "Topview sign-in requires a Linux secret store such as GNOME Keyring or KWallet." : void 0 : "Secure credential storage is unavailable on this device. Configure the operating-system keychain, then restart CineGen.";
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
      const r = JSON.parse(await R.readFile(w.join(this.root, `${e}.safe.json`), "utf8"));
      if (r.version !== 1 || typeof r.data != "string")
        throw new Error("Topview credentials are stored in an unsupported format. Connect the account again.");
      const n = Zt.decryptString(Buffer.from(r.data, "base64")), i = JSON.parse(n);
      if (!F(i)) throw new Error("Topview credentials are invalid. Connect the account again.");
      return i;
    } catch (r) {
      if (r.code === "ENOENT") return null;
      throw r;
    }
  }
  async write(e, r) {
    this.assertAvailable(), await R.mkdir(this.root, { recursive: !0 });
    const n = JSON.stringify({
      version: 1,
      data: Zt.encryptString(JSON.stringify(r)).toString("base64")
    }), i = w.join(this.root, `${e}.safe.json`), o = `${i}.${process.pid}.${X.randomUUID()}.tmp`;
    try {
      await R.writeFile(o, `${n}
`, { mode: 384 }), await R.rename(o, i), await R.chmod(i, 384).catch(() => {
      });
    } catch (a) {
      throw await R.unlink(o).catch(() => {
      }), a;
    }
  }
  async remove(e) {
    await R.unlink(w.join(this.root, `${e}.safe.json`)).catch((r) => {
      if (r.code !== "ENOENT") throw r;
    });
  }
}
async function za(t) {
  const e = await t.text();
  if (e)
    try {
      return JSON.parse(e);
    } catch {
      return e;
    }
}
function En(t, e, r) {
  const n = F(e) ? e.error_description ?? e.message ?? e.error : e;
  return new Error(typeof n == "string" && n.trim() ? n.trim() : `${r} (${t})`);
}
async function Zr(t, e, r) {
  let n;
  try {
    n = await fetch(t, e);
  } catch (o) {
    throw new Error(`Could not reach Topview. ${r}`, { cause: o });
  }
  const i = await za(n);
  if (!n.ok) throw En(n.status, i, r);
  if (!F(i)) throw new Error(`${r} Topview returned an invalid response.`);
  return i;
}
function Kc(t, e) {
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
  return r.find((n) => F(n) && n.id === e) ?? r.find((n) => F(n) && (n.result !== void 0 || n.error !== void 0)) ?? r.at(-1);
}
function Ke(t, e = [], r = 0) {
  if (r > 14 || t === null || t === void 0) return e;
  if (Array.isArray(t))
    for (const n of t) Ke(n, e, r + 1);
  else if (F(t)) {
    e.push(t);
    for (const n of Object.values(t)) Ke(n, e, r + 1);
  }
  return e;
}
function yr(t, e = [], r = 0) {
  if (r > 14 || t === null || t === void 0) return e;
  if (typeof t == "string") e.push(t);
  else if (Array.isArray(t)) for (const n of t) yr(n, e, r + 1);
  else if (F(t)) for (const n of Object.values(t)) yr(n, e, r + 1);
  return e;
}
function _e(t) {
  const e = [t];
  if (!F(t)) return e;
  if (t.structuredContent !== void 0 && e.unshift(t.structuredContent), Array.isArray(t.content)) {
    for (const r of t.content)
      if (!(!F(r) || typeof r.text != "string"))
        try {
          e.unshift(JSON.parse(r.text));
        } catch {
          e.push(r.text);
        }
  }
  return e;
}
function oe(t, e) {
  const r = new Set(e.map((n) => n.toLowerCase()));
  for (const n of Ke(t))
    for (const [i, o] of Object.entries(n))
      if (r.has(i.toLowerCase()) && typeof o == "string" && o.trim()) return o.trim();
}
function co(t) {
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
  for (const r of Ke(t))
    for (const [n, i] of Object.entries(r)) {
      if (!e.has(n.toLowerCase())) continue;
      const o = typeof i == "number" ? i : typeof i == "string" ? Number(i) : Number.NaN;
      if (Number.isFinite(o)) return o;
    }
}
function Yc(t) {
  if (typeof t == "boolean") return t;
  for (const e of Ke(t))
    for (const [r, n] of Object.entries(e))
      if (/^(ok|success|exists|ready|verified)$/i.test(r) && typeof n == "boolean") return n;
}
function ir(t) {
  const e = oe(t, [
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
  return e && /^https?:\/\//i.test(e) ? e : yr(t).find((r) => /^https?:\/\//i.test(r) && (/\.(?:mp4|mov|webm|png|jpe?g|webp|avif)(?:[?#]|$)/i.test(r) || /cloudfront|cdn|output|result/i.test(r)));
}
function or(t) {
  return (oe(t, ["status", "taskStatus", "task_status", "state"]) ?? "").toLowerCase();
}
function Va(t, e) {
  if (!F(e)) return t;
  const r = Array.isArray(e.type) ? e.type : [e.type];
  if (r.includes("boolean") && typeof t == "string") {
    if (/^(?:true|1|yes|on)$/i.test(t)) return !0;
    if (/^(?:false|0|no|off)$/i.test(t)) return !1;
  }
  if ((r.includes("integer") || r.includes("number")) && typeof t == "string" && t.trim()) {
    const n = Number(t);
    if (Number.isFinite(n) && (!r.includes("integer") || Number.isInteger(n))) return n;
  }
  return r.includes("array") && Array.isArray(t) ? t.map((n) => Va(n, e.items)) : r.includes("object") && F(t) ? Wa(e, t) : t;
}
function Wa(t, e) {
  if (!F(t)) return { ...e };
  const r = F(t.properties) ? t.properties : {}, i = (F(r.req) ? r.req : void 0) ?? t, o = F(i.properties) ? i.properties : {}, a = i.additionalProperties === !1 && Object.keys(o).length > 0, s = {};
  for (const [l, d] of Object.entries(e))
    a && !Object.hasOwn(o, l) || (s[l] = Va(d, o[l]));
  return s;
}
function Qc(t, e) {
  var i;
  const r = F((i = t.inputSchema) == null ? void 0 : i.properties) ? t.inputSchema.properties : {}, n = Wa(t.inputSchema, e);
  return Object.hasOwn(r, "req") ? { req: n } : n;
}
function Xa(t, e) {
  for (const r of Ke(t))
    for (const [n, i] of Object.entries(r))
      if (e.test(n) && Array.isArray(i)) return i;
}
function Zc(t) {
  const r = (Xa(t, /boards|list|items|records/i) ?? []).filter(F).map((n) => ({
    boardId: String(n.boardId ?? n.board_id ?? n.id ?? "").trim(),
    name: typeof n.name == "string" ? n.name : typeof n.boardName == "string" ? n.boardName : void 0,
    isSystemDefault: n.isSystemDefault === !0 || n.is_system_default === !0
  })).filter((n) => n.boardId);
  return r.find((n) => n.isSystemDefault) ?? r.find((n) => n.name === "My First Board") ?? r[0];
}
function ef(t) {
  return (Xa(t, /^models$/i) ?? []).filter(F);
}
function Ja(t, e) {
  const r = t.submitParameterOptions;
  if (F(r)) {
    const n = r[e];
    if (Array.isArray(n)) return n.map(en);
    if (F(n)) {
      for (const i of ["values", "options", "enum", "allowedValues"])
        if (Array.isArray(n[i])) return n[i].map(en);
    }
  }
  if (Array.isArray(r)) {
    const n = r.find((i) => F(i) && (i.name === e || i.key === e || i.field === e));
    if (F(n)) {
      for (const i of ["values", "options", "enum", "allowedValues"])
        if (Array.isArray(n[i])) return n[i].map(en);
    }
  }
  return [];
}
function en(t) {
  return F(t) ? t.value ?? t.key ?? t.id ?? t.name : t;
}
function Qn(t) {
  return F(t.requiredSubmitFields) ? Object.entries(t.requiredSubmitFields).filter(([, e]) => e === !0 || F(e)).map(([e]) => e) : Array.isArray(t.requiredSubmitFields) ? t.requiredSubmitFields.map((e) => {
    if (typeof e == "string") return e;
    if (!F(e)) return "";
    const r = e.name ?? e.key ?? e.field;
    return typeof r == "string" ? r : "";
  }).filter(Boolean) : [];
}
function tf(t) {
  const e = t.submitParameterOptions;
  return F(e) ? Object.keys(e) : Array.isArray(e) ? e.map((r) => {
    if (!F(r)) return "";
    const n = r.name ?? r.key ?? r.field;
    return typeof n == "string" ? n : "";
  }).filter(Boolean) : [];
}
function Gt(t, e) {
  const r = F(t.defaultSubmitParameters) ? t.defaultSubmitParameters : {};
  return Object.hasOwn(r, e) || Qn(t).includes(e) || tf(t).includes(e);
}
function vn(t) {
  if (t.nativeAudio === !1 || t.supportsNativeAudio === !1) return !1;
  if (t.nativeAudio === !0 || t.supportsNativeAudio === !0) return !0;
  const e = Ja(t, "sound");
  if (e.length) return Qa(e, "on") !== void 0;
  if ((F(t.defaultSubmitParameters) ? t.defaultSubmitParameters : {}).sound === "on" || Gt(t, "sound")) return !0;
}
function ct(t) {
  return [t.submitModel, t.displayName, t.name].filter((e) => typeof e == "string" && !!e.trim());
}
function Ka(t, e, r = !1) {
  const n = ef(t);
  if (!n.length) throw new Error("Topview did not return a compatible model for this request.");
  const i = e == null ? void 0 : e.trim();
  if (i && i !== "auto") {
    const s = n.find((l) => ct(l).some((d) => d.toLowerCase() === i.toLowerCase()));
    if (!s)
      throw new Error(`Topview model "${i}" is not available for this generation type. Refresh the model choice and try again.`);
    if (r && vn(s) === !1)
      throw new Error(`Topview model "${i}" does not support native sound. Disable sound or choose a model that does.`);
    return s;
  }
  const o = oe(t, ["preferredSubmitModel", "preferred_submit_model"]), a = n.find((s) => ct(s).includes(o ?? "")) ?? n.find((s) => s.preferred === !0) ?? n[0];
  if (r && vn(a) === !1)
    throw new Error(`Topview's default model "${ct(a)[0] ?? "selected"}" does not support native sound. Disable sound or explicitly choose another model.`);
  return a;
}
function rf(t) {
  return (t ?? []).flatMap((e) => typeof (e == null ? void 0 : e.value) == "string" && e.value.trim() ? [{ value: e.value.trim(), role: "image" }] : []).filter((e, r, n) => n.findIndex((i) => i.value === e.value) === r);
}
function fo(t) {
  var a;
  const e = t.references.length ? "image_edit" : "text_to_image", r = Ka(t.config, t.params.model), n = (a = ct(r)[0]) == null ? void 0 : a.trim();
  if (!n) throw new Error("Topview returned an image model without a submit identifier.");
  const i = F(r.defaultSubmitParameters) ? r.defaultSubmitParameters : {}, o = {
    taskType: e,
    model: n,
    prompt: Ya(t.params.prompt),
    generateCount: Math.max(1, Math.min(4, Math.round(t.params.generateCount ?? 1))),
    boardId: t.boardId,
    ...t.references.length ? { inputImageFileIds: t.references.map((s) => s.fileId) } : {}
  };
  for (const [s, l, d] of [
    ["aspectRatio", t.params.aspectRatio, "16:9"],
    ["resolution", t.params.resolution, "1K"]
  ])
    Gt(r, s) && (o[s] = Tn({ model: r, field: s, requested: l, fallback: d }));
  for (const s of Qn(r))
    if ((o[s] === void 0 || o[s] === null || o[s] === "") && i[s] !== void 0 && (o[s] = i[s]), o[s] === void 0 || o[s] === null || o[s] === "")
      throw new Error(`Topview's selected image model requires the unsupported field "${s}".`);
  return { req: o, model: n, taskType: e };
}
function Ya(t) {
  return `${t.replace(/@([A-Za-z0-9][A-Za-z0-9_-]*)/g, (r, n) => n.replaceAll("-", " ")).replace(/\s{2,}/g, " ").trim()}

Do not render labels, mention tags, captions, subtitles, watermarks, interface text, or any other on-screen text.`;
}
function Qa(t, e) {
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
function nf(t, e) {
  const r = t.submitParameterOptions;
  let n;
  if (F(r) ? n = r[e] : Array.isArray(r) && (n = r.find((s) => F(s) && (s.name === e || s.key === e || s.field === e))), !F(n)) return {};
  const i = Number(n.min ?? n.minimum), o = Number(n.max ?? n.maximum), a = Number(n.step ?? n.multipleOf);
  return {
    ...Number.isFinite(i) ? { min: i } : {},
    ...Number.isFinite(o) ? { max: o } : {},
    ...Number.isFinite(a) && a > 0 ? { step: a } : {}
  };
}
function Tn(t) {
  const e = F(t.model.defaultSubmitParameters) ? t.model.defaultSubmitParameters : {}, r = t.requested !== void 0, n = e[t.field] !== void 0 && e[t.field] !== null, i = t.requested ?? e[t.field] ?? t.fallback;
  if (i === void 0) {
    if (t.required) throw new Error(`Topview model configuration requires "${t.field}", but did not provide a usable default.`);
    return;
  }
  const o = Ja(t.model, t.field);
  if (o.length) {
    const s = Qa(o, i);
    if (s === void 0) {
      if (!r && !n) return o[0];
      throw new Error(`Topview model "${ct(t.model)[0] ?? "selected"}" does not allow ${t.field}=${String(i)}. Allowed values: ${o.map(String).join(", ")}.`);
    }
    return s;
  }
  const a = nf(t.model, t.field);
  if (a.min !== void 0 || a.max !== void 0 || a.step !== void 0) {
    const s = Number(i);
    if (!Number.isFinite(s) || a.min !== void 0 && s < a.min || a.max !== void 0 && s > a.max || a.step !== void 0 && a.min !== void 0 && Math.abs((s - a.min) / a.step - Math.round((s - a.min) / a.step)) > 1e-9)
      throw new Error(`Topview model "${ct(t.model)[0] ?? "selected"}" does not allow ${t.field}=${String(i)}.`);
    return s;
  }
  return i;
}
function Za(t) {
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
function of(t) {
  const e = Za(t);
  if (!e.length) return "text_to_video";
  const r = e.filter((i) => i.role === "start_image"), n = e.every((i) => i.role === "start_image" || i.role === "end_image");
  return r.length === 1 && n ? "image_to_video" : "omni_reference";
}
function po(t) {
  var p, f;
  const e = Ka(t.config, t.params.model, t.params.generateAudio === !0), r = String(e.submitModel ?? "").trim();
  if (!r) throw new Error("Topview returned a video model without a submit identifier.");
  const n = F(e.defaultSubmitParameters) ? e.defaultSubmitParameters : {}, i = new Set(Qn(e)), o = t.params.durationSec === void 0 ? void 0 : Math.round(t.params.durationSec);
  if (o !== void 0 && (!Number.isFinite(o) || o === 0 || o < -1))
    throw new Error("Topview video duration must be a positive whole number of seconds.");
  let a = Ya(t.params.prompt);
  const s = {
    ...n,
    taskType: t.taskType,
    model: r,
    prompt: a,
    boardId: t.boardId
  };
  delete s.generateAudio;
  const l = (m, y, g) => {
    if (!Gt(e, m)) {
      if (y !== void 0)
        throw new Error(`Topview model "${r}" does not accept ${m} for this generation type.`);
      return;
    }
    const _ = Tn({ model: e, field: m, requested: y, fallback: g, required: i.has(m) });
    _ !== void 0 && (s[m] = _);
  };
  if (l("resolution", t.params.resolution === void 0 ? void 0 : Number.parseInt(t.params.resolution, 10), 720), l("duration", o, 5), l("generatingCount", void 0, 1), t.taskType !== "image_to_video" ? l("aspectRatio", (p = t.params.aspectRatio) == null ? void 0 : p.trim(), "16:9") : (t.params.aspectRatio !== void 0 || i.has("aspectRatio")) && l("aspectRatio", (f = t.params.aspectRatio) == null ? void 0 : f.trim(), "16:9"), vn(e) !== !1 && (Gt(e, "sound") || t.params.generateAudio === !0))
    s.sound = Tn({
      model: e,
      field: "sound",
      requested: t.params.generateAudio === !0 ? "on" : "off",
      required: i.has("sound")
    });
  else if (t.params.generateAudio === !0)
    throw new Error(`Topview model "${r}" does not support native sound.`);
  if (t.taskType === "image_to_video") {
    const m = t.references.find((g) => g.role === "start_image"), y = t.references.find((g) => g.role === "end_image");
    if (!m) throw new Error("Topview image-to-video generation requires an explicit start-frame element.");
    s.firstFrameFileId = m.fileId, y && (s.endFrameFileId = y.fileId);
  }
  if (t.taskType === "omni_reference") {
    let m = 0, y = 0, g = 0;
    const h = [], _ = [], b = [], E = [];
    for (const S of t.references)
      if (S.role === "video") {
        const T = `Video${++y}`;
        _.push({ fileId: S.fileId, name: T }), E.push(`<<<${T}>>> is an authoritative motion and timing reference.`);
      } else if (S.role === "audio") {
        const T = `Audio${++g}`;
        b.push({ fileId: S.fileId, name: T }), E.push(`<<<${T}>>> is an authoritative audio reference.`);
      } else {
        const T = `Image${++m}`;
        h.push({ fileId: S.fileId, name: T });
        const I = S.role === "start_image" ? "the requested opening-frame visual reference" : S.role === "end_image" ? "the requested closing-frame visual reference" : "an authoritative visual reference";
        E.push(`<<<${T}>>> is ${I}.`);
      }
    if (b.length && !Gt(e, "inputAudios"))
      throw new Error(`Topview model "${r}" does not accept audio reference elements for omni-reference video.`);
    a = `${E.join(`
`)} Match every supplied subject, setting, prop, wardrobe, silhouette, material, color, and requested motion.

${a}`, s.prompt = a, h.length && (s.inputImages = h), _.length && (s.inputVideos = _), b.length && (s.inputAudios = b);
  }
  for (const m of i)
    if (s[m] === void 0 || s[m] === null || s[m] === "")
      throw new Error(`Topview model "${r}" requires "${m}" for this request.`);
  const u = Number(s.duration ?? n.duration ?? o ?? 5), c = Number.isFinite(u) ? u : 5;
  return { req: s, model: r, durationSec: c };
}
const af = {
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
}, tn = {
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
function mo(t) {
  return t === "video" ? /* @__PURE__ */ new Set(["mp4", "avi", "mov"]) : t === "audio" ? /* @__PURE__ */ new Set(["mp3", "wav", "m4a"]) : /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "bmp", "webp"]);
}
function rn(t, e, r) {
  const n = (r ?? "").split(";", 1)[0].trim().toLowerCase(), i = n ? af[n] : void 0, o = (() => {
    try {
      return new URL(t).pathname;
    } catch {
      return t;
    }
  })(), a = w.extname(o).slice(1).toLowerCase(), s = i ?? a;
  if (!s || !mo(e).has(s)) {
    const l = e === "video" ? "video" : e === "audio" ? "audio" : "image";
    throw new Error(`Topview received an unsupported ${l} reference format. Supported formats: ${[...mo(e)].join(", ")}.`);
  }
  if (n && !i)
    throw new Error(`Topview refused a remote reference with content type "${n}".`);
  return s;
}
function es(t) {
  const e = t.split(".").map(Number);
  return e.length === 4 && e.every((r) => Number.isInteger(r) && r >= 0 && r <= 255) ? e : void 0;
}
function sf(t) {
  var l;
  let e = t.toLowerCase().split("%", 1)[0];
  e.startsWith("[") && e.endsWith("]") && (e = e.slice(1, -1));
  const r = (l = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(e)) == null ? void 0 : l[1];
  if (r) {
    const d = es(r);
    if (!d) return;
    e = `${e.slice(0, -r.length)}${(d[0] << 8 | d[1]).toString(16)}:${(d[2] << 8 | d[3]).toString(16)}`;
  }
  const n = e.split("::");
  if (n.length > 2) return;
  const i = n[0] ? n[0].split(":") : [], o = n[1] ? n[1].split(":") : [], a = 8 - i.length - o.length;
  if (n.length === 1 && a !== 0 || a < 0) return;
  const s = [...i, ...Array.from({ length: a }, () => "0"), ...o];
  if (!(s.length !== 8 || s.some((d) => !/^[0-9a-f]{1,4}$/.test(d))))
    return s.flatMap((d) => {
      const u = Number.parseInt(d, 16);
      return [u >>> 8, u & 255];
    });
}
function ho(t) {
  const e = es(t);
  if (!e) return !1;
  const [r, n, i] = e;
  return !(r === 0 || r === 10 || r === 100 && n >= 64 && n <= 127 || r === 127 || r === 169 && n === 254 || r === 172 && n >= 16 && n <= 31 || r === 192 && n === 0 && i === 0 || r === 192 && n === 0 && i === 2 || r === 192 && n === 88 && i === 99 || r === 192 && n === 168 || r === 198 && (n === 18 || n === 19) || r === 198 && n === 51 && i === 100 || r === 203 && n === 0 && i === 113 || r >= 224);
}
function lf(t) {
  const e = t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t, r = On(e.split("%", 1)[0]);
  if (r === 4) return ho(e);
  if (r !== 6) return !1;
  const n = sf(e);
  return n ? n.slice(0, 10).every((o) => o === 0) && n[10] === 255 && n[11] === 255 ? ho(n.slice(12).join(".")) : !(n[0] < 32 || n[0] > 63 || n[0] === 32 && n[1] === 1 && (n[2] & 254) === 0 || n[0] === 32 && n[1] === 1 && n[2] === 0 && n[3] === 2 || n[0] === 32 && n[1] === 1 && n[2] === 13 && n[3] === 184 || n[0] === 32 && n[1] === 1 && (n[2] & 240) === 16 || n[0] === 32 && n[1] === 1 && (n[2] & 240) === 32 || n[0] === 32 && n[1] === 2 || n[0] === 63 && (n[1] & 240) === 240) : !1;
}
async function df(t) {
  const e = t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t, r = e.toLowerCase().replace(/\.$/, "");
  if (r === "localhost" || r.endsWith(".localhost") || r.endsWith(".local") || r.endsWith(".internal"))
    throw new Error("Topview remote references must use a public HTTPS host.");
  const n = On(e), i = n ? [{ address: e, family: n }] : await Qs(e, { all: !0, verbatim: !0 });
  if (!i.length || i.some((o) => !lf(o.address)))
    throw new Error("Topview remote references cannot resolve to a private, local, or reserved network address.");
  return { address: i[0].address, family: i[0].family };
}
async function ts(t, e = 0) {
  if (e > 5) throw new Error("Topview remote reference redirected too many times.");
  const r = new URL(t);
  if (r.protocol !== "https:" || r.username || r.password || r.port && r.port !== "443")
    throw new Error("Topview remote references must use public HTTPS URLs without credentials or custom ports.");
  const n = await df(r.hostname);
  return new Promise((i, o) => {
    const a = el({
      protocol: "https:",
      hostname: n.address,
      family: n.family,
      port: 443,
      path: `${r.pathname}${r.search}`,
      method: "GET",
      servername: On(r.hostname.replace(/^\[|\]$/g, "")) ? void 0 : r.hostname,
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
        ts(new URL(p, r).href, e + 1).then(i, o);
        return;
      }
      if (l < 200 || l >= 300) {
        s.resume(), o(new Error(`Topview could not download an element reference (${l}).`));
        return;
      }
      const d = Number(s.headers["content-length"] ?? 0);
      if (Number.isFinite(d) && d > gr) {
        s.destroy(), o(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
        return;
      }
      const u = [];
      let c = 0;
      s.on("data", (p) => {
        if (c += p.length, c > gr) {
          s.destroy(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
          return;
        }
        u.push(Buffer.from(p));
      }), s.once("error", o), s.once("end", () => i({
        bytes: Buffer.concat(u),
        contentType: typeof s.headers["content-type"] == "string" ? s.headers["content-type"] : void 0,
        finalUrl: r.href
      }));
    });
    a.setTimeout(Wc, () => {
      a.destroy(new Error("Topview timed out while downloading an element reference."));
    }), a.once("error", o), a.end();
  });
}
async function uf(t, e) {
  const r = t.trim();
  if (!r) throw new Error("Topview received an empty element reference.");
  if (r.startsWith("data:")) {
    const a = /^data:([^;,]+)?;base64,(.+)$/s.exec(r);
    if (!a) throw new Error("Topview received an unsupported inline element reference.");
    const s = Buffer.from(a[2], "base64");
    if (s.length > gr) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const l = rn("", e, a[1]);
    return { bytes: s, format: l, contentType: tn[l] };
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
    const a = await R.stat(n);
    if (!a.isFile()) throw new Error("A Topview element reference is not a file.");
    if (a.size > gr) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const s = rn(n, e);
    return { bytes: await R.readFile(n), format: s, contentType: tn[s] };
  }
  const i = await ts(r), o = rn(i.finalUrl, e, i.contentType);
  return { bytes: i.bytes, format: o, contentType: tn[o] };
}
function cf(t) {
  var r;
  const e = (r = Ke(t).find((n) => F(n.headers))) == null ? void 0 : r.headers;
  return F(e) ? Object.fromEntries(Object.entries(e).filter((n) => typeof n[1] == "string")) : {};
}
class ff {
  constructor() {
    this.store = new Jc();
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
    return n.set("client_id", r.client_id), r.client_secret && n.set("client_secret", r.client_secret), Zr(Hc, {
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
        resource: Kr
      }, r);
      return (await this.saveToken(n, e)).access_token;
    } catch (n) {
      throw await this.store.remove("token"), new Error("Your Topview connection expired. Connect it again in Settings.", { cause: n });
    }
  }
  async mcpRequest(e, r, n) {
    var a;
    const i = new AbortController(), o = setTimeout(() => i.abort(), Vc);
    (a = o.unref) == null || a.call(o);
    try {
      const s = await fetch(Fc, {
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
      }), l = await s.text(), d = (s.headers.get("content-type") || "").includes("text/event-stream") ? Kc(l, r.id) : l ? (() => {
        try {
          return JSON.parse(l);
        } catch {
          return l;
        }
      })() : {};
      if (!s.ok) throw En(s.status, d, "Topview MCP request failed.");
      if (F(d) && d.error !== void 0) throw En(400, d.error, "Topview MCP returned an error.");
      return {
        payload: F(d) ? d : {},
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
      id: `init-${X.randomUUID()}`,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "CineGen Desktop", version: "1.0.0" }
      }
    });
    let i = (await this.mcpRequest(e, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    }, r.sessionId)).sessionId || r.sessionId, o;
    const a = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Map();
    for (let l = 0; l < so; l += 1) {
      const d = await this.mcpRequest(e, {
        jsonrpc: "2.0",
        id: `tools-${X.randomUUID()}`,
        method: "tools/list",
        params: o === void 0 ? {} : { cursor: o }
      }, i);
      i = d.sessionId || i;
      const u = F(d.payload.result) ? d.payload.result : {}, c = Array.isArray(u.tools) ? u.tools.filter((f) => F(f) && typeof f.name == "string") : [];
      for (const f of c) s.set(f.name, f);
      const p = u.nextCursor;
      if (typeof p != "string" || !p)
        return { token: e, sessionId: i, tools: [...s.values()] };
      if (a.has(p)) throw new Error("Topview returned a repeated MCP tools cursor.");
      a.add(p), o = p;
    }
    throw new Error(`Topview returned more than ${so} MCP tool pages.`);
  }
  async callTool(e, r, n) {
    const i = e.tools.find((s) => s.name === r);
    if (!i) throw new Error(`Your Topview account does not currently expose ${r}.`);
    const o = await this.mcpRequest(e.token, {
      jsonrpc: "2.0",
      id: `call-${X.randomUUID()}`,
      method: "tools/call",
      params: {
        name: r,
        arguments: Qc(i, n)
      }
    }, e.sessionId);
    e.sessionId = o.sessionId || e.sessionId;
    const a = F(o.payload) ? o.payload.result : void 0;
    if (F(a) && a.isError === !0)
      throw new Error(yr(a).join(" ").slice(0, 700) || `Topview could not run ${r}.`);
    return a;
  }
  async chooseBoard(e) {
    const r = await this.callTool(e, "topview_list_boards", {
      pageNo: 1,
      pageSize: 20,
      mode: "editable-by-me"
    }), n = Zc(_e(r));
    if (n) return n.boardId;
    const i = await this.callTool(e, "topview_create_board", { name: "CineGen" }), o = oe(_e(i), ["boardId", "board_id", "id"]);
    if (!o) throw new Error("Topview did not return a board ID for the CineGen board.");
    return o;
  }
  async uploadReference(e, r) {
    if (r.value.startsWith("topview-file:")) {
      const c = r.value.slice(13).trim();
      if (!c) throw new Error("Topview received an empty existing file ID.");
      return { ...r, fileId: c };
    }
    const n = await uf(r.value, r.role), i = await this.callTool(e, "ta_upload_credential", {
      format: n.format,
      needAccelerateUrl: !1
    }), o = _e(i), a = oe(o, ["fileId", "file_id"]), s = oe(o, ["uploadUrl", "upload_url", "accelerateUrl", "accelerate_url"]);
    if (!a || !s) throw new Error("Topview did not return a usable upload destination for an element.");
    const l = (oe(o, ["method", "httpMethod", "http_method"]) || "PUT").toUpperCase(), d = await fetch(s, {
      method: l,
      headers: { ...cf(o), ...n.contentType ? { "Content-Type": n.contentType } : {} },
      body: n.bytes
    });
    if (!d.ok) throw new Error(`Topview could not upload an element reference (${d.status}).`);
    const u = await this.callTool(e, "ta_upload_check_file", { fileId: a });
    if (Yc(_e(u)) === !1) throw new Error("Topview could not verify an uploaded element reference.");
    return { ...r, fileId: a };
  }
  async accountStatus() {
    const e = this.store.availabilityError();
    if (e) return { connected: !1, configured: !1, error: e };
    try {
      const r = await this.store.read("token");
      if (!(r != null && r.access_token)) return { connected: !1, configured: !0 };
      const n = await this.accessToken(), i = await Zr(oo, {
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
      ].filter((d) => !o.tools.some((u) => u.name === d));
      if (s.length)
        throw new Error(`This Topview account is missing required MCP capabilities: ${s.join(", ")}.`);
      let l = co(i);
      if (o.tools.some((d) => d.name === "topview_get_credit"))
        try {
          l = co(_e(await this.callTool(o, "topview_get_credit", {}))) ?? l;
        } catch {
        }
      return {
        connected: !0,
        configured: !0,
        ...typeof (i == null ? void 0 : i.email) == "string" ? { email: i.email } : {},
        ...l !== void 0 ? { credits: l } : {}
      };
    } catch (r) {
      return { connected: !1, configured: !0, error: lo(r, "Topview connection expired.") };
    }
  }
  async authLogin() {
    var p;
    const e = this.store.availabilityError();
    if (e) throw new Error(e);
    const r = Zs();
    await new Promise((f, m) => {
      r.once("error", m), r.listen(0, "127.0.0.1", () => f());
    });
    const n = r.address();
    if (!n || typeof n == "string")
      throw r.close(), new Error("CineGen could not open a secure local return address for Topview.");
    const i = `http://127.0.0.1:${n.port}/oauth/callback`, o = Yr(X.randomBytes(48)), a = Yr(X.createHash("sha256").update(o).digest()), s = Yr(X.randomBytes(32));
    let l, d;
    const u = new Promise((f, m) => {
      d = m, r.on("request", (y, g) => {
        const h = new URL(y.url || "/", i);
        if (h.pathname !== "/oauth/callback") {
          g.writeHead(404).end();
          return;
        }
        l = g, f(h);
      });
    }), c = setTimeout(() => d == null ? void 0 : d(new Error("Topview sign-in timed out. Try connecting again.")), zc);
    (p = c.unref) == null || p.call(c);
    try {
      const f = await Zr(Gc, {
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
      const y = new URL(Bc);
      y.search = new URLSearchParams({
        response_type: "code",
        client_id: m.client_id,
        redirect_uri: i,
        scope: "openid email mcp:tools",
        state: s,
        code_challenge: a,
        code_challenge_method: "S256",
        resource: Kr
      }).toString(), await Ho.openExternal(y.href);
      const g = await u, h = g.searchParams.get("error_description") || g.searchParams.get("error");
      if (h) throw new Error(h);
      if (g.searchParams.get("state") !== s) throw new Error("Topview sign-in could not be verified. Try again.");
      const _ = g.searchParams.get("code");
      if (!_) throw new Error("Topview did not return an authorization code.");
      const b = await this.tokenExchange({
        grant_type: "authorization_code",
        code: _,
        redirect_uri: i,
        code_verifier: o,
        resource: Kr
      }, m), E = await this.saveToken(b);
      try {
        const S = await fetch(oo, {
          headers: { Accept: "application/json", Authorization: `Bearer ${E.access_token}` }
        }), T = await za(S);
        S.ok && F(T) && await this.store.write("profile", T);
      } catch {
      }
      return uo(l, !0, "You can close this window and return to CineGen."), this.accountStatus();
    } catch (f) {
      throw l && !l.writableEnded && uo(l, !1, lo(f, "Topview sign-in did not complete.")), f;
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
  async submitWithSession(e, r) {
    this.validateGenerateParams(r);
    const n = Za(r.medias), i = of(r.medias), o = await this.chooseBoard(e), a = _e(await this.callTool(e, "topview_get_generation_config", {
      type: "video",
      taskType: i
    }));
    po({
      config: a,
      taskType: i,
      params: r,
      boardId: o,
      references: n.map((p, f) => ({ ...p, fileId: `preflight-${f + 1}` }))
    });
    const s = [];
    for (const p of n) s.push(await this.uploadReference(e, p));
    const l = po({ config: a, taskType: i, params: r, references: s, boardId: o }), d = await this.callTool(e, "topview_generate_video", l.req), u = _e(d), c = oe(u, ["taskId", "task_id", "generationId", "generation_id"]);
    if (!c) throw new Error("Topview did not return a task ID for this generation.");
    return {
      result: { taskId: c, taskType: i, boardId: o, model: l.model, durationSec: l.durationSec },
      documents: u
    };
  }
  async submit(e) {
    return (await this.submitWithSession(await this.session(), e)).result;
  }
  validateQueryParams(e) {
    if (!e || typeof e.taskId != "string" || !e.taskId.trim())
      throw new Error("Topview task query requires a task ID.");
    if (!["text_to_video", "image_to_video", "omni_reference"].includes(e.taskType))
      throw new Error("Topview task query received an unsupported task type.");
    if (typeof e.boardId != "string" || !e.boardId.trim())
      throw new Error("Topview task query requires the board ID returned by submit.");
    if (typeof e.model != "string" || !e.model.trim() || !Number.isFinite(e.durationSec))
      throw new Error("Topview task query requires the complete result returned by submit.");
  }
  async queryWithSession(e, r) {
    this.validateQueryParams(r);
    const n = await this.callTool(e, "topview_query_task", {
      taskType: r.taskType,
      taskId: r.taskId.trim(),
      needCloudFrontUrl: !0
    }), i = _e(n), o = or(i), a = ir(i), s = /fail|error|cancel/.test(o), l = !!a || /success|complete|done/.test(o), d = s ? "fail" : l && a ? "success" : l ? "fail" : /^(init|created|queued)$/.test(o) ? "init" : "running", u = oe(i, ["boardTaskId", "board_task_id"]), c = oe(i, [
      "errorMsg",
      "error_msg",
      "errorMessage",
      "error_message",
      "failureReason",
      "failure_reason"
    ]), p = d === "fail" ? c ?? (l ? "Topview completed the task without returning a video URL." : "Topview could not complete this video.") : void 0;
    return {
      ...r,
      taskId: r.taskId.trim(),
      status: d,
      ...a ? { url: a } : {},
      ...p ? { error: p } : {},
      boardUrl: `https://www.topview.ai/board/${encodeURIComponent(r.boardId)}${u ? `?boardResultId=${encodeURIComponent(u)}` : ""}`
    };
  }
  async query(e) {
    return this.queryWithSession(await this.session(), e);
  }
  async generate(e) {
    const r = await this.session(), n = await this.submitWithSession(r, e), i = ir(n.documents);
    if (i)
      return {
        url: i,
        mediaType: "video",
        durationSec: n.result.durationSec,
        taskId: n.result.taskId,
        model: n.result.model,
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(n.result.boardId)}`
      };
    const o = or(n.documents);
    if (/fail|error|cancel/.test(o))
      throw new Error(oe(n.documents, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this video.");
    const a = Date.now() + ao;
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
    const r = await this.session(), n = rf(e.medias), i = n.length ? "image_edit" : "text_to_image", o = await this.chooseBoard(r), a = _e(await this.callTool(r, "topview_get_generation_config", {
      type: "image",
      taskType: i
    }));
    fo({
      config: a,
      params: e,
      boardId: o,
      references: n.map((y, g) => ({ ...y, fileId: `preflight-${g + 1}` }))
    });
    const s = [];
    for (const y of n) s.push(await this.uploadReference(r, y));
    const l = fo({ config: a, params: e, references: s, boardId: o }), d = await this.callTool(r, "topview_generate_image", l.req), u = _e(d), c = oe(u, ["taskId", "task_id", "generationId", "generation_id"]), p = ir(u);
    if (p)
      return {
        url: p,
        mediaType: "image",
        taskId: c,
        model: l.model,
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(o)}`
      };
    if (!c) throw new Error("Topview did not return a task ID for this image generation.");
    const f = or(u);
    if (/fail|error|cancel/.test(f))
      throw new Error(oe(u, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this image.");
    const m = Date.now() + ao;
    for (; Date.now() < m; ) {
      await new Promise((b) => setTimeout(b, 3e3));
      const y = await this.callTool(r, "topview_query_task", {
        taskType: l.taskType,
        taskId: c,
        needCloudFrontUrl: !0
      }), g = _e(y), h = ir(g), _ = or(g);
      if (h) {
        const b = oe(g, ["boardTaskId", "board_task_id"]);
        return {
          url: h,
          mediaType: "image",
          taskId: c,
          model: l.model,
          boardUrl: `https://www.topview.ai/board/${encodeURIComponent(o)}${b ? `?boardResultId=${encodeURIComponent(b)}` : ""}`
        };
      }
      if (/fail|error|cancel/.test(_))
        throw new Error(oe(g, ["errorMsg", "error_msg", "errorMessage", "error_message"]) ?? "Topview could not complete this image.");
    }
    throw new Error(`Topview is still processing image task ${c}. Open your Topview board to check it; do not submit the same render again.`);
  }
}
function pf() {
  const t = new ff();
  x.handle("topview:account-status", () => t.accountStatus()), x.handle("topview:auth-login", () => t.authLogin()), x.handle("topview:auth-logout", () => t.authLogout()), x.handle("topview:submit", (e, r) => t.submit(r)), x.handle("topview:query", (e, r) => t.query(r)), x.handle("topview:generate", (e, r) => t.generate(r)), x.handle("topview:generate-image", (e, r) => t.generateImage(r));
}
const rs = zo(import.meta.url);
function ns(t) {
  return J.isPackaged ? t.replace("app.asar", "app.asar.unpacked") : t;
}
function Te() {
  const t = rs("ffmpeg-static");
  return ns(t);
}
function is() {
  const t = rs("ffprobe-static").path;
  return ns(t);
}
function os() {
  if (J.isPackaged)
    return w.join(process.resourcesPath, "vendor", "fpcalc");
  const t = w.dirname(Pn(import.meta.url));
  return w.resolve(t, "..", "vendor", "fpcalc", "fpcalc");
}
const go = {
  draft: { crf: 28, scale: 0.5 },
  standard: { crf: 20, scale: 1 },
  high: { crf: 16, scale: 1 }
}, ae = /* @__PURE__ */ new Map(), zt = /* @__PURE__ */ new Map();
function mf(t, e) {
  for (const r of Q.getAllWindows())
    r.webContents.send("export:progress", { jobId: t, progress: e });
}
function hf(t, e) {
  const r = t.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
  if (!r) return null;
  const n = parseInt(r[1], 10), i = parseInt(r[2], 10), o = parseInt(r[3], 10), a = parseInt(r[4], 10) / 100, s = n * 3600 + i * 60 + o + a;
  return e > 0 ? Math.min(100, s / e * 100) : 0;
}
async function gf(t, e) {
  const r = ae.get(t);
  if (!r) return;
  const n = Te(), i = go[e.preset || "standard"] || go.standard, o = e.fps || 30, a = e.outputPath || w.join(process.cwd(), `export_${t}.mp4`);
  ae.set(t, { ...r, status: "rendering" });
  const s = e.clips.filter(
    (p) => (p.type === "video" || p.type === "image") && p.inputPath
  );
  if (s.length === 0) {
    ae.set(t, { ...r, status: "failed", error: "No video clips to export" });
    return;
  }
  const l = [];
  for (const p of s)
    p.trimStart > 0 && l.push("-ss", String(p.trimStart)), l.push("-t", String(p.duration / (p.speed || 1))), l.push("-i", p.inputPath);
  const d = [];
  for (let p = 0; p < s.length; p++) {
    const f = s[p], m = f.speed || 1, y = f.volume ?? 1, g = [];
    m !== 1 && g.push(`setpts=${(1 / m).toFixed(4)}*PTS`), i.scale !== 1 && g.push(`scale=iw*${i.scale}:ih*${i.scale}`), g.push(`fps=${o}`), d.push(`[${p}:v]${g.join(",")}[v${p}]`);
    const h = f.duration / m;
    if (f.type === "image")
      d.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${h.toFixed(4)}[a${p}]`);
    else {
      const _ = [];
      m !== 1 && _.push(`atempo=${m}`), y !== 1 && _.push(`volume=${y}`), _.length > 0 ? d.push(`[${p}:a]${_.join(",")}[a${p}]`) : d.push(`[${p}:a]anull[a${p}]`);
    }
  }
  const u = s.map((p, f) => `[v${f}]`).join(""), c = s.map((p, f) => `[a${f}]`).join("");
  return d.push(
    `${u}${c}concat=n=${s.length}:v=1:a=1[outv][outa]`
  ), l.push("-filter_complex", d.join(";")), l.push("-map", "[outv]", "-map", "[outa]"), l.push("-c:v", "libx264", "-crf", String(i.crf), "-preset", "fast"), l.push("-c:a", "aac", "-b:a", "192k"), l.push("-y", a), new Promise((p, f) => {
    var g;
    const m = ie(n, l);
    zt.set(t, m);
    let y = "";
    (g = m.stderr) == null || g.on("data", (h) => {
      y += h.toString();
      const _ = y.split("\r"), b = _[_.length - 1] || _[_.length - 2];
      if (b) {
        const E = hf(b, e.totalDuration);
        if (E !== null) {
          const S = ae.get(t);
          S && (ae.set(t, { ...S, progress: E }), mf(t, E));
        }
      }
      y.length > 2048 && (y = y.slice(-1024));
    }), m.on("close", (h) => {
      zt.delete(t);
      const _ = ae.get(t);
      if (!_) {
        p();
        return;
      }
      if (h === 0) {
        let b;
        try {
          b = B.statSync(a).size;
        } catch {
        }
        ae.set(t, {
          ..._,
          status: "complete",
          progress: 100,
          outputUrl: a,
          fileSize: b,
          completedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else
        ae.set(t, {
          ..._,
          status: "failed",
          error: `ffmpeg exited with code ${h}`
        });
      p();
    }), m.on("error", (h) => {
      zt.delete(t);
      const _ = ae.get(t);
      _ && ae.set(t, { ..._, status: "failed", error: h.message }), f(h);
    });
  });
}
function yf() {
  x.handle("export:start", async (t, e) => {
    const { preset: r = "standard", fps: n = 30 } = e, i = {
      id: X.randomUUID(),
      status: "queued",
      progress: 0,
      preset: r,
      fps: n,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return ae.set(i.id, i), gf(i.id, e).catch((o) => {
      console.error("[export] Render failed:", o);
    }), i;
  }), x.handle("export:poll", async (t, e) => {
    const r = ae.get(e);
    if (!r) throw new Error("Export not found");
    return r;
  }), x.handle("export:cancel", async (t, e) => {
    const r = zt.get(e);
    r && (r.kill("SIGTERM"), zt.delete(e));
    const n = ae.get(e);
    if (n && (ae.set(e, { ...n, status: "failed", error: "Cancelled by user" }), n.outputUrl))
      try {
        B.unlinkSync(n.outputUrl);
      } catch {
      }
    return { ok: !0 };
  });
}
const _f = {
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
function nn(t) {
  const e = w.extname(t).toLowerCase();
  return _f[e] ?? "application/octet-stream";
}
function yo(t) {
  try {
    const e = new URL(t);
    if (e.protocol !== "local-media:" || e.hostname !== "file") return null;
    let r = decodeURIComponent(e.pathname);
    return process.platform === "win32" && r.startsWith("/") && (r = r.slice(1)), w.normalize(r);
  } catch {
    return null;
  }
}
async function wf(t) {
  const e = w.join(
    W.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), r = Te(), n = [
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
    const a = ie(r, n, { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    (l = a.stderr) == null || l.on("data", (d) => {
      s += d.toString();
    }), a.on("error", o), a.on("close", (d) => {
      if (d === 0) {
        i();
        return;
      }
      o(new Error(s.trim() || `ffmpeg exited with code ${d}`));
    });
  }), e;
}
function bf() {
  x.handle(
    "elements:upload",
    async (t, e, r) => {
      if (!r) throw new Error("No API key provided");
      K.fal.config({ credentials: r });
      const n = new Blob([e.buffer], { type: e.type }), i = new File([n], e.name, { type: e.type });
      return { url: await K.fal.storage.upload(i) };
    }
  ), x.handle(
    "elements:upload-transcription-source",
    async (t, e, r) => {
      if (!r) throw new Error("No API key provided");
      const n = yo(e);
      if (!n) {
        if (e.startsWith("http://") || e.startsWith("https://"))
          return { url: e };
        throw new Error("Transcription upload requires a local-media or remote URL source");
      }
      K.fal.config({ credentials: r });
      const i = await wf(n);
      try {
        const o = await R.readFile(i), s = `${w.basename(n, w.extname(n))}.m4a`, l = nn(i), d = new Blob([o], { type: l }), u = new File([d], s, { type: l });
        return { url: await K.fal.storage.upload(u) };
      } finally {
        await R.unlink(i).catch(() => {
        });
      }
    }
  ), x.handle(
    "elements:upload-media-source",
    async (t, e, r) => {
      if (!r) throw new Error("No API key provided");
      K.fal.config({ credentials: r });
      const n = yo(e);
      if (n) {
        const i = await R.readFile(n), o = w.basename(n), a = nn(n), s = new Blob([i], { type: a }), l = new File([s], o, { type: a });
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
          await R.writeFile(a, Buffer.from(m));
        } catch (f) {
          throw new Error(
            f instanceof Error ? f.message : "Failed to download remote media. The URL may have expired."
          );
        }
        const s = await R.readFile(a), l = w.basename(a), d = nn(a), u = new Blob([s], { type: d }), c = new File([u], l, { type: d }), p = await K.fal.storage.upload(c);
        return await R.unlink(a).catch(() => {
        }), { url: p };
      }
      throw new Error("Media upload requires a local-media, remote URL, or data URI source");
    }
  );
}
const Ef = `
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
`, vf = `
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
function Ze() {
  return w.join(W.homedir(), "Documents", "CINEGEN");
}
function Ye(t) {
  return w.join(Ze(), t);
}
function Ut() {
  return X.randomUUID();
}
function Vt() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function as(t) {
  const e = Ye(t), r = [
    w.join(e, "media", "generated"),
    w.join(e, "media", "imported"),
    w.join(e, ".cache", "thumbnails"),
    w.join(e, ".cache", "filmstrips"),
    w.join(e, ".cache", "waveforms"),
    w.join(e, ".cache", "proxies")
  ];
  for (const n of r)
    B.mkdirSync(n, { recursive: !0 });
}
class Tf {
  constructor(e) {
    as(e);
    const r = w.join(Ye(e), "project.db");
    this.db = new Rn(r), this.db.pragma("journal_mode = WAL"), this.db.pragma("foreign_keys = ON"), this.initSchema();
  }
  /**
   * Runs SCHEMA_SQL and INDEXES_SQL to create all tables and indexes if they
   * do not already exist.
   */
  initSchema() {
    this.db.exec(Ef), this.db.exec(vf);
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
function ss() {
  return { version: 1, folders: [], elements: [] };
}
function ls(t) {
  if (!t || typeof t != "object") return null;
  const e = t, r = typeof e.id == "string" ? e.id : "";
  if (!r) return null;
  const n = e.type === "character" || e.type === "location" || e.type === "prop" || e.type === "vehicle" ? e.type : "character", i = typeof e.folderId == "string" && e.folderId ? e.folderId : typeof e.folder_id == "string" && e.folder_id ? e.folder_id : void 0;
  return {
    id: r,
    name: typeof e.name == "string" ? e.name : "Untitled",
    type: n,
    description: typeof e.description == "string" ? e.description : "",
    images: Sf(e.images),
    createdAt: typeof e.createdAt == "string" ? e.createdAt : typeof e.created_at == "string" ? e.created_at : "",
    updatedAt: typeof e.updatedAt == "string" ? e.updatedAt : typeof e.updated_at == "string" ? e.updated_at : "",
    folderId: i
  };
}
function Sf(t) {
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
function If(t) {
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
function ds(t) {
  if (!t || typeof t != "object") return ss();
  const e = t, r = Array.isArray(e.folders) ? e.folders.map(If).filter((o) => o !== null) : [], n = new Set(r.map((o) => o.id)), i = Array.isArray(e.elements) ? e.elements.map(ls).filter((o) => o !== null) : [];
  return {
    version: 1,
    folders: r,
    elements: i.map((o) => o.folderId && !n.has(o.folderId) ? { ...o, folderId: void 0 } : o)
  };
}
function xf(t, e) {
  const r = ss(), n = new Map(r.elements.map((o) => [o.id, o])), i = [...r.folders];
  for (const o of e) {
    const a = o.elements.map(ls).filter((l) => l !== null);
    if (a.length === 0) continue;
    let s = i.find((l) => l.sourceProjectId === o.id);
    s || (s = {
      id: crypto.randomUUID(),
      name: o.name.trim() || "Untitled project",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceProjectId: o.id
    }, i.push(s));
    for (const l of a)
      n.has(l.id) || n.set(l.id, { ...l, folderId: l.folderId && i.some((d) => d.id === l.folderId) ? l.folderId : s.id });
  }
  return { version: 1, folders: i, elements: [...n.values()] };
}
function Af(t, e, r) {
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
function us() {
  return w.join(Ze(), "elements-library.json");
}
function jf() {
  return w.join(Ze(), "projects.json");
}
function _o(t) {
  return w.join(Ze(), t);
}
async function Sn(t) {
  await R.mkdir(Ze(), { recursive: !0 });
  const e = us(), r = `${e}.tmp`;
  await R.writeFile(r, JSON.stringify(t, null, 2), "utf-8"), await R.rename(r, e);
}
async function kf() {
  try {
    const t = await R.readFile(us(), "utf-8");
    return ds(JSON.parse(t));
  } catch {
    return null;
  }
}
function Rf(t) {
  const e = w.join(_o(t.id), "project.db"), r = w.join(_o(t.id), "project.json");
  if (t.useSqlite || B.existsSync(e))
    try {
      const n = new Rn(e, { readonly: !0 }), i = n.prepare("SELECT * FROM elements").all();
      return n.close(), { id: t.id, name: t.name, elements: i };
    } catch {
      return { id: t.id, name: t.name, elements: [] };
    }
  if (B.existsSync(r))
    try {
      const n = JSON.parse(B.readFileSync(r, "utf-8"));
      return { id: t.id, name: t.name, elements: Array.isArray(n.elements) ? n.elements : [] };
    } catch {
      return { id: t.id, name: t.name, elements: [] };
    }
  return { id: t.id, name: t.name, elements: [] };
}
async function Of() {
  const t = await kf();
  if (t) return t;
  let e = [];
  try {
    const i = JSON.parse(await R.readFile(jf(), "utf-8"));
    e = Array.isArray(i.projects) ? i.projects : [];
  } catch {
    e = [];
  }
  const r = e.map(Rf), n = xf(null, r);
  return await Sn(n), n;
}
function Pf() {
  x.handle(
    "elements-library:load",
    async (t, e) => {
      let r = await Of();
      if (e != null && e.projectId && e.projectName) {
        const n = Af(r, e.projectId, e.projectName);
        n !== r && (await Sn(n), r = n);
      }
      return r;
    }
  ), x.handle("elements-library:save", async (t, e) => {
    const r = ds(e);
    return await Sn(r), r;
  });
}
const wo = {
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
}, cs = {
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
function Nf(t) {
  return t ? { ...wo, ...cs[t].weights } : wo;
}
function bo(t, e) {
  if (!t) return !1;
  const r = t.toLowerCase();
  return e.some((n) => r.includes(n.toLowerCase()));
}
function qf(t, e, r) {
  const n = Nf(r.persona), i = r.persona ? cs[r.persona] : void 0, o = [];
  let a = 0;
  if (e.length === 0)
    a += t.words.length > 0 ? 3 : 1;
  else {
    const s = t.text.toLowerCase(), l = `${t.assetName} ${t.text} ${t.words.map((u) => u.word).join(" ")}`.toLowerCase();
    let d = 0;
    for (const u of e)
      l.includes(u) && (d += 1, a += s.includes(u) ? n.termInText : n.termElsewhere);
    d > 0 && o.push(`matched ${e.slice(0, 4).join(", ")}`);
  }
  return t.timelinePlacements.some((s) => s.timelineId === r.activeTimelineId) && r.activeTimelineId && (a += n.activeTimeline, o.push("already on the active timeline")), t.words.length > 0 && (a += n.wordTiming), t.emotion && (a += n.hasEmotion), t.delivery && (a += n.hasDelivery, o.push("has vocal delivery notes")), i && (bo(t.energy, i.preferredEnergy) && (a += n.energyMatch, o.push(`${t.energy} energy fits ${r.persona}`)), bo(t.pace, i.preferredPace) && (a += n.paceMatch, o.push(`${t.pace} pace fits ${r.persona}`)), t.emotion && i.emotionBias.some((s) => t.emotion.toLowerCase().includes(s)) && (a += n.emotionBias, o.push(`${t.emotion} emotion favored by ${r.persona}`))), t.emotion && r.queryEmotions.some((s) => t.emotion.toLowerCase().includes(s) || s.includes(t.emotion.toLowerCase())) && (a += n.emotionQueryMatch, o.push(`emotion (${t.emotion}) matches the query`)), t.notable && t.notable.length > 0 && (a += n.notableSignal * t.notable.length, o.push(`notable: ${t.notable.slice(0, 2).join("; ")}`)), { score: a, reasons: o };
}
function Cf(t) {
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
function Lf(t) {
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
function Uf(t, e) {
  const r = Lf(e);
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
    const d = o.get(l);
    d && !a.has(l) && (s.push(d), a.add(l));
  }
  for (const l of t)
    a.has(l.id) || s.push(l);
  return s;
}
function Df(t) {
  return [...new Set(
    t.toLowerCase().split(/[^a-z0-9']+/).map((e) => e.trim()).filter((e) => e.length >= 3)
  )];
}
const Mf = [
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
function $f(t) {
  const e = t.toLowerCase();
  return Mf.filter((r) => e.includes(r));
}
function Ff(t, e, r = 24) {
  const n = typeof r == "number" ? { limit: r } : r, i = n.limit ?? 24, o = Df(e), a = {
    activeTimelineId: t.activeTimelineId,
    persona: n.persona,
    queryEmotions: $f(e)
  };
  return t.moments.map((s) => ({ moment: s, ...qf(s, o, a) })).filter((s) => s.score > 0).sort((s, l) => l.score - s.score || s.moment.sourceStart - l.moment.sourceStart).slice(0, i).map(({ moment: s, score: l, reasons: d }) => ({
    id: s.id,
    assetId: s.assetId,
    assetName: s.assetName,
    text: s.text,
    sourceStart: s.sourceStart,
    sourceEnd: s.sourceEnd,
    words: s.words.slice(0, 32),
    timelinePlacements: s.timelinePlacements,
    score: l,
    reason: d.length > 0 ? `${d.slice(0, 3).join("; ")}.` : `${s.words.length > 0 ? "Word-level" : "Segment-level"} transcript candidate.`
  }));
}
const Ne = "google/gemini-2.5-flash";
function it(t, e, r) {
  return Math.min(r, Math.max(e, t));
}
function on(t) {
  try {
    return JSON.parse(t), t;
  } catch {
    return null;
  }
}
function pe(t) {
  return typeof t == "string" ? t : Array.isArray(t) ? t.map((e) => pe(e)).filter(Boolean).join(`
`) : t && typeof t == "object" ? Object.values(t).map((e) => pe(e)).filter(Boolean).join(`
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
function fs(t) {
  var o;
  const e = t.trim();
  if (!e) return null;
  const r = on(e);
  if (r) return r;
  const n = [...e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const a of n) {
    const s = (o = a[1]) == null ? void 0 : o.trim();
    if (!s) continue;
    const l = on(s);
    if (l) return l;
  }
  const i = /* @__PURE__ */ new Map([
    ["{", "}"],
    ["[", "]"]
  ]);
  for (let a = 0; a < e.length; a++) {
    const s = e[a], l = i.get(s);
    if (!l) continue;
    const d = [l];
    let u = !1, c = !1;
    for (let p = a + 1; p < e.length; p++) {
      const f = e[p];
      if (c) {
        c = !1;
        continue;
      }
      if (f === "\\") {
        u && (c = !0);
        continue;
      }
      if (f === '"') {
        u = !u;
        continue;
      }
      if (u) continue;
      const m = i.get(f);
      if (m) {
        d.push(m);
        continue;
      }
      if (f === d[d.length - 1]) {
        if (d.pop(), d.length === 0) {
          const y = e.slice(a, p + 1), g = on(y);
          if (g) return g;
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
function Bf(t) {
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
function Hf(t) {
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
async function Rr(t, e) {
  if (/^https?:\/\//.test(e)) return e;
  if (e.startsWith("data:")) {
    const s = e.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
    if (!s) return null;
    const l = s[1] || "application/octet-stream", d = s[3] || "", u = s[2] ? Buffer.from(d, "base64") : Buffer.from(decodeURIComponent(d), "utf8"), c = new Blob([u], { type: l }), p = new File([c], `auto-segment.${l.split("/")[1] || "bin"}`, { type: l });
    return K.fal.config({ credentials: t }), K.fal.storage.upload(p);
  }
  const r = Hf(e);
  if (!r) return null;
  const n = await R.readFile(r), i = Bf(r), o = new Blob([n], { type: i }), a = new File([o], w.basename(r), { type: i });
  return K.fal.config({ credentials: t }), K.fal.storage.upload(a);
}
async function Gf(t, e) {
  return Rr(t, e);
}
function Eo(t, e) {
  const n = (Array.isArray(t.objects) ? t.objects : Array.isArray(t.detections) ? t.detections : Array.isArray(t.items) ? t.items : Array.isArray(t.regions) ? t.regions : Array.isArray(t.subjects) ? t.subjects : typeof t.label == "string" || typeof t.name == "string" || typeof t.object == "string" ? [t] : []).map((o) => {
    if (!o || typeof o != "object") return null;
    const a = o, s = [
      a.label,
      a.name,
      a.object,
      a.subject,
      a.class,
      a.type
    ].find((I) => typeof I == "string" && I.trim()), l = typeof s == "string" ? s.trim() : "";
    if (!l) return null;
    let d = null, u = null, c = null, p = null;
    const f = Array.isArray(a.box) ? a.box : Array.isArray(a.cxcywh) ? a.cxcywh : null;
    f && f.length >= 4 && (d = Y(f[0]), u = Y(f[1]), c = Y(f[2]), p = Y(f[3]));
    const m = Array.isArray(a.bbox) ? a.bbox : Array.isArray(a.bounds) ? a.bounds : Array.isArray(a.rect) ? a.rect : Array.isArray(a.xyxy) ? a.xyxy : null;
    if ((d === null || u === null || c === null || p === null) && m && m.length >= 4) {
      const I = Y(m[0]), v = Y(m[1]), A = Y(m[2]), q = Y(m[3]);
      [I, v, A, q].every((N) => N !== null) && (d = (I + A) / 2, u = (v + q) / 2, c = A - I, p = q - v);
    }
    const y = Array.isArray(a.box_3d) ? a.box_3d : Array.isArray(a.box3d) ? a.box3d : null;
    if ((d === null || u === null || c === null || p === null) && y && y.length >= 6) {
      const I = Y(y[0]), v = Y(y[1]), A = Y(y[3]), q = Y(y[4]), N = Y(y[5]);
      [I, v, A, q, N].every((D) => D !== null) && (d = I, u = v, c = Math.max(A, q), p = Math.max(q, N));
    }
    if (d === null || u === null || c === null || p === null) {
      const I = Y(a.center_x ?? a.cx ?? a.mid_x), v = Y(a.center_y ?? a.cy ?? a.mid_y), A = Y(a.width ?? a.w), q = Y(a.height ?? a.h);
      [I, v, A, q].every((N) => N !== null) && (d = I, u = v, c = A, p = q);
    }
    if (d === null || u === null || c === null || p === null) {
      const I = Y(a.x_min ?? a.left), v = Y(a.y_min ?? a.top), A = Y(a.x_max ?? a.right), q = Y(a.y_max ?? a.bottom);
      [I, v, A, q].every((N) => N !== null) && (d = (I + A) / 2, u = (v + q) / 2, c = A - I, p = q - v);
    }
    if ([d, u, c, p].some((I) => I === null || !Number.isFinite(I))) return null;
    const g = it(c, 0.02, 1), h = it(p, 0.02, 1), _ = [
      it(d, g / 2, 1 - g / 2),
      it(u, h / 2, 1 - h / 2),
      g,
      h
    ], b = Y(a.score ?? a.confidence ?? a.probability), E = b !== null ? it(b, 0, 1) : 0.75, S = Y(a.priority ?? a.salience ?? a.importance), T = S !== null ? it(S, 0, 1) : E;
    return {
      label: l,
      box: _,
      score: E,
      priority: T
    };
  }).filter((o) => !!o).sort((o, a) => a.priority - o.priority || a.score - o.score), i = [];
  for (const o of n)
    if (i.some((s) => {
      const l = s.label.toLowerCase() === o.label.toLowerCase(), d = Math.abs(s.box[0] - o.box[0]), u = Math.abs(s.box[1] - o.box[1]), c = Math.abs(s.box[2] - o.box[2]), p = Math.abs(s.box[3] - o.box[3]);
      return l && d < 0.06 && u < 0.06 && c < 0.08 && p < 0.08;
    }) || i.push(o), i.length >= e) break;
  return i;
}
function ur(t) {
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
        const o = ur(n[i]);
        if (o) return o;
      }
  }
  const e = pe(t);
  if (!e) return null;
  const r = fs(e);
  if (!r) return null;
  try {
    const n = JSON.parse(r);
    return Array.isArray(n) ? { objects: n } : n && typeof n == "object" ? n : null;
  } catch {
    return null;
  }
}
async function vo(t, e, r, n, i) {
  K.fal.config({ credentials: t });
  const a = (await K.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: r,
      prompt: i,
      image_urls: [e],
      max_tokens: 700
    },
    logs: !0
  })).data, s = ur(a.output) ?? ur(a.text) ?? ur(a);
  return s || console.warn("[vision:auto-seg] Could not extract object JSON from vision response", {
    outputPreview: pe(a.output || a.text || a).slice(0, 1e3),
    maxObjects: n
  }), s;
}
async function ps(t) {
  var a, s, l, d, u;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = (await Promise.all(
    t.framePaths.slice(0, 6).map((c) => Rr(t.apiKey, c).catch(() => null))
  )).filter((c) => !!c);
  if (e.length === 0)
    return {
      assetId: t.assetId,
      status: "missing",
      model: ((a = t.model) == null ? void 0 : a.trim()) || Ne,
      error: "No visual frames were available to upload for analysis."
    };
  K.fal.config({ credentials: t.apiKey });
  const n = (await K.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((s = t.model) == null ? void 0 : s.trim()) || Ne,
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
  })).data, i = pe(n.output) || pe(n.text) || "", o = fs(i);
  if (!o)
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((l = t.model) == null ? void 0 : l.trim()) || Ne,
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
      model: ((d = t.model) == null ? void 0 : d.trim()) || Ne,
      sourceFrameCount: e.length
    };
  } catch {
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((u = t.model) == null ? void 0 : u.trim()) || Ne,
      error: "Vision analysis JSON parse failed."
    };
  }
}
async function ms(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await Gf(t.apiKey, t.videoPath).catch(() => null);
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
  })).data, i = pe(n.output) || pe(n.text) || pe(n.description) || pe(n);
  if (!i.trim())
    throw new Error("Video analysis returned an empty response.");
  return i.trim();
}
async function zf(t) {
  var o;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await Rr(t.apiKey, t.imagePath).catch(() => null);
  if (!e)
    throw new Error("Could not upload the image file for analysis.");
  K.fal.config({ credentials: t.apiKey });
  const n = (await K.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((o = t.model) == null ? void 0 : o.trim()) || Ne,
      prompt: t.prompt.trim() || "Describe this image in detail.",
      image_urls: [e],
      max_tokens: 900
    },
    logs: !0
  })).data, i = pe(n.output) || pe(n.text) || pe(n);
  if (!i.trim())
    throw new Error("Image analysis returned an empty response.");
  return i.trim();
}
async function Vf(t) {
  var a, s;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = Math.min(12, Math.max(1, Math.round(t.maxObjects ?? 6))), r = await Rr(t.apiKey, t.imagePath).catch(() => null);
  if (!r)
    return {
      status: "missing",
      model: ((a = t.model) == null ? void 0 : a.trim()) || Ne,
      objects: [],
      error: "No image was available to upload for auto segmentation."
    };
  const n = ((s = t.model) == null ? void 0 : s.trim()) || Ne, i = [
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
    const l = await vo(t.apiKey, r, n, e, i), d = l ? Eo(l, e) : [];
    if (d.length > 0)
      return console.info("[vision:auto-seg] Primary object proposals", {
        model: n,
        count: d.length,
        objects: d,
        context: t.context ?? null
      }), {
        status: "ready",
        model: n,
        objects: d
      };
    const u = await vo(t.apiKey, r, n, e, o), c = u ? Eo(u, e) : [];
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
      retryKeys: u ? Object.keys(u).slice(0, 12) : [],
      primaryPreview: l ? JSON.stringify(l).slice(0, 1e3) : "",
      retryPreview: u ? JSON.stringify(u).slice(0, 1e3) : "",
      context: t.context ?? null
    }), {
      status: "ready",
      model: n,
      objects: []
    });
  } catch (l) {
    const d = l instanceof Error ? l.message : String(l);
    return console.error("[vision:auto-seg] Detection failed", {
      model: n,
      context: t.context ?? null,
      error: d,
      stack: l instanceof Error ? l.stack : void 0
    }), {
      status: "failed",
      model: n,
      objects: [],
      error: d || "Vision auto-segmentation failed."
    };
  }
}
function Wf() {
  x.handle("vision:index-asset", async (t, e) => ps(e)), x.handle("vision:detect-objects", async (t, e) => Vf(e));
}
const Xf = "anthropic/claude-sonnet-4.6";
function ne(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : null;
}
function Jf(t) {
  if (!t || typeof t != "object") return;
  const e = t, r = ne(e.prompt_tokens) ?? 0, n = ne(e.completion_tokens) ?? 0, i = ne(e.total_tokens) ?? r + n, o = ne(e.cost) ?? 0;
  if (!(r <= 0 && n <= 0 && i <= 0 && o <= 0))
    return { promptTokens: r, completionTokens: n, totalTokens: i, cost: o };
}
function Wt(t, e) {
  return t ? e ? {
    promptTokens: t.promptTokens + e.promptTokens,
    completionTokens: t.completionTokens + e.completionTokens,
    totalTokens: t.totalTokens + e.totalTokens,
    cost: t.cost + e.cost
  } : t : e;
}
function Kf(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
async function _t(t) {
  var o;
  K.fal.config({ credentials: t.apiKey });
  const e = {
    model: ((o = t.model) == null ? void 0 : o.trim()) || Xf,
    prompt: t.prompt,
    max_tokens: Number.isFinite(t.maxTokens) ? Math.max(1, Math.floor(t.maxTokens)) : 1600
  };
  typeof t.systemPrompt == "string" && t.systemPrompt.trim() && (e.system_prompt = t.systemPrompt.trim()), typeof t.temperature == "number" && Number.isFinite(t.temperature) && (e.temperature = t.temperature);
  const n = (await K.fal.subscribe("openrouter/router", { input: e, logs: !0 })).data;
  return {
    message: (typeof n.output == "string" ? n.output : typeof n.text == "string" ? n.text : "").trim(),
    usage: Jf(n.usage)
  };
}
function Zn(t) {
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
function Yf(t) {
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
function Qf(t, e = 3) {
  const r = ne(t);
  return r === null ? e : r <= 1 ? 1 : 3;
}
function Zf(t, e) {
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
function ep(t) {
  return Array.isArray(t) ? t.flatMap((e, r) => {
    if (!e || typeof e != "object") return [];
    const n = e, i = typeof n.question == "string" ? n.question.trim() : "";
    if (!i) return [];
    const o = Array.isArray(n.options) ? n.options.flatMap((a, s) => {
      if (!a || typeof a != "object") return [];
      const l = a, d = typeof l.label == "string" ? l.label.trim() : "";
      return d ? [{
        id: typeof l.id == "string" && l.id.trim() ? l.id.trim() : `opt_${r + 1}_${s + 1}`,
        label: d,
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
function tp(t, e) {
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
      targetDurationSeconds: Math.max(5, ne(r.targetDurationSeconds) ?? e.targetDurationSeconds),
      variantCount: Qf(r.variantCount, e.variantCount),
      persona: Yf(r.persona),
      storyGoal: typeof r.storyGoal == "string" && r.storyGoal.trim() ? r.storyGoal.trim() : e.storyGoal,
      hook: typeof r.hook == "string" && r.hook.trim() ? r.hook.trim() : e.hook,
      formatNotes: typeof r.formatNotes == "string" && r.formatNotes.trim() ? r.formatNotes.trim() : e.formatNotes,
      qualityGoal: r.qualityGoal === "story" || r.qualityGoal === "retention" || r.qualityGoal === "clarity" || r.qualityGoal === "auto" ? r.qualityGoal : e.qualityGoal,
      referenceTimelineId: typeof r.referenceTimelineId == "string" && r.referenceTimelineId.trim() ? r.referenceTimelineId.trim() : e.referenceTimelineId,
      referenceTimelineName: typeof r.referenceTimelineName == "string" && r.referenceTimelineName.trim() ? r.referenceTimelineName.trim() : e.referenceTimelineName,
      useBrollPlaceholders: typeof r.useBrollPlaceholders == "boolean" ? r.useBrollPlaceholders : e.useBrollPlaceholders,
      confidence: Math.min(1, Math.max(0, ne(r.confidence) ?? e.confidence)),
      rationale: typeof r.rationale == "string" && r.rationale.trim() ? r.rationale.trim() : e.rationale
    },
    clarifyingQuestions: ep(r.clarifyingQuestions)
  };
}
function rp(t, e, r) {
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
function To(t) {
  const e = Number(t);
  return Number.isFinite(e) ? Math.max(0, e) : null;
}
function np(t) {
  if (!t || typeof t != "object") return null;
  const e = t, r = To(e.source_start), n = To(e.source_end);
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
function ip(t, e) {
  if (!t || typeof t != "object") return null;
  const r = t, n = Array.isArray(r.segments) ? r.segments.map(np).filter((i) => !!i) : [];
  return n.length === 0 ? null : {
    type: "cut_proposal",
    summary: typeof r.summary == "string" && r.summary.trim() ? r.summary.trim() : `Proposed ${n.length} cut segments.`,
    timeline_name: typeof r.timeline_name == "string" && r.timeline_name.trim() ? r.timeline_name.trim() : e,
    should_create_timeline: typeof r.should_create_timeline == "boolean" ? r.should_create_timeline : !1,
    segments: n
  };
}
function op(t) {
  if (!t || typeof t != "object") return [];
  const e = t;
  return Array.isArray(e.variants) ? e.variants.flatMap((r, n) => {
    var a;
    if (!r || typeof r != "object") return [];
    const i = r, o = Array.isArray(i.proposals) ? i.proposals.map((s) => ip(s, `AI Cut ${n + 1}`)).filter((s) => !!s) : [];
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
function ap(t, e) {
  if (!t || typeof t != "object") return e;
  const r = t, n = Array.isArray(r.scorecards) ? r.scorecards : [], i = /* @__PURE__ */ new Map();
  for (const s of n) {
    if (!s || typeof s != "object") continue;
    const l = s, d = typeof l.variant_id == "string" ? l.variant_id.trim() : "";
    d && i.set(d, {
      overall: ne(l.overall) ?? 78,
      storyArc: ne(l.storyArc) ?? 78,
      pacing: ne(l.pacing) ?? 78,
      clarity: ne(l.clarity) ?? 78,
      visualFit: ne(l.visualFit) ?? 78,
      completeness: ne(l.completeness) ?? 78,
      formatFit: ne(l.formatFit) ?? 78,
      strengths: Array.isArray(l.strengths) ? l.strengths.filter((u) => typeof u == "string") : [],
      cautions: Array.isArray(l.cautions) ? l.cautions.filter((u) => typeof u == "string") : [],
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
    const d = o.indexOf(s.id), u = o.indexOf(l.id);
    return d === -1 && u === -1 ? l.scorecard.overall - s.scorecard.overall : d === -1 ? 1 : u === -1 ? -1 : d - u;
  }), a;
}
function sp(t) {
  return t.referenceTimelines.slice(0, 5).map((e) => `- ${e.timelineName}${e.isActive ? " (active)" : ""}: ${e.structureSummary}; primary assets: ${e.primaryAssets.join(", ") || "none"}`).join(`
`);
}
function hs(t) {
  return t.slice(0, 18).map((e, r) => {
    const n = e.timelinePlacements[0], i = n ? ` | timeline: ${n.timelineName} @ ${n.timelineTime.toFixed(1)}` : "", o = e.words.length > 0 ? `
   Word timings: ${e.words.slice(0, 18).map((a) => `${a.word}@${a.start.toFixed(1)}-${a.end.toFixed(1)}`).join(" ")}` : "";
    return `${r + 1}. ${e.assetName} ${e.sourceStart.toFixed(1)}-${e.sourceEnd.toFixed(1)}${i}
   ${e.text}
   Reason: ${e.reason}${o}`;
  }).join(`
`);
}
function lp(t) {
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
async function dp(t) {
  var i;
  const e = new Set(t.retrievedMoments.map((o) => o.assetId)), r = t.visualCandidates.filter((o) => e.has(o.assetId)).slice(0, 4), n = [];
  for (const o of r) {
    if (((i = o.storedSummary) == null ? void 0 : i.status) === "ready" && (!t.model || o.storedSummary.model === t.model)) {
      n.push(o.storedSummary);
      continue;
    }
    n.push(await ps({
      apiKey: t.apiKey,
      assetId: o.assetId,
      assetName: o.assetName,
      framePaths: o.framePaths,
      model: t.model
    }));
  }
  return n;
}
async function up(t) {
  var o;
  const e = Zf(t.request, t.index), r = [
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
    sp(t.index)
  ].join(`
`), n = await _t({
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
  }), i = Zn(n.message);
  if (!i)
    return { brief: e, clarifyingQuestions: [], usage: n.usage };
  try {
    const a = JSON.parse(i);
    return { ...tp(a, e), usage: n.usage };
  } catch {
    return { brief: e, clarifyingQuestions: [], usage: n.usage };
  }
}
async function So(t, e, r, n, i = {}) {
  const o = [e, r.storyGoal, r.hook, r.tone, r.audience].join(" ");
  let a = Ff(t, o, { limit: 20, persona: r.persona });
  if (i.rerank && i.apiKey && a.length > 1)
    try {
      const l = Cf({ query: o, brief: r, candidates: a }), d = await _t({
        apiKey: i.apiKey,
        model: i.model,
        systemPrompt: "You re-rank candidate video moments for an editor. Return JSON only.",
        prompt: l,
        maxTokens: 500,
        temperature: 0.2
      });
      a = Uf(a, d.message);
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
async function cp(t) {
  var d;
  const e = (u, c) => {
    const p = Zn(u);
    if (!p) return null;
    try {
      const f = JSON.parse(p), y = op({ variants: [f] })[0];
      return y ? {
        variant: y,
        usage: c
      } : null;
    } catch {
      return null;
    }
  }, r = async (u, c) => {
    const p = [
      `Repair this malformed cut-variant response into valid JSON for variant ${c + 1}.`,
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "Do not add commentary before or after the JSON.",
      "If part of the raw output was truncated, salvage one valid variant.",
      "",
      "Malformed response:",
      u
    ].join(`
`), f = await _t({
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
  for (let u = 0; u < a.length; u += 1) {
    const p = [
      "You are CineGen's lead editor creating one high-quality cut proposal.",
      `Generate exactly one editorial variant using this strategy: ${a[u]}`,
      "Use the retrieved moments and visual findings as evidence. Do not invent content outside them.",
      "Use word-level source timings when possible and cut tighter than sentence edges when the request calls for it.",
      "Do not include any prose before or after the JSON.",
      "Keep notes concise and practical.",
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "If the user asked for multiple parts, the variant may include multiple proposals, one per part.",
      l.length > 0 ? `Already generated variants (do something meaningfully different):
${JSON.stringify(l.map((g) => ({ title: g.title, strategy: g.strategy, summary: g.summary })), null, 2)}` : "",
      "",
      "Editorial brief:",
      JSON.stringify(t.brief, null, 2),
      "",
      "Retrieved moments:",
      hs(t.retrievalSummary.topMoments),
      "",
      "Reference timelines:",
      t.retrievalSummary.referenceTimelines.map((g) => `- ${g.timelineName}: ${g.structureSummary}`).join(`
`) || "- none",
      "",
      "Visual findings:",
      lp(t.visualFindings) || "- none",
      "",
      `Original request: ${t.request}`
    ].filter(Boolean).join(`
`), f = await _t({
      apiKey: t.apiKey,
      model: t.model,
      systemPrompt: [
        "You are a world-class editor. Make proposals that feel genuinely cuttable, not generic.",
        "When the brief reads documentary/interview, think like a documentary filmmaker shaping a story arc.",
        "When the brief reads promo/trailer/social, think like a promo editor optimizing hook, pacing, and payoff.",
        ((d = t.customSystemPrompt) == null ? void 0 : d.trim()) || ""
      ].filter(Boolean).join(`

`),
      prompt: p,
      maxTokens: 2400,
      temperature: 0.45
    });
    s = Wt(s, f.usage);
    const m = e(f.message, f.usage);
    if (m != null && m.variant) {
      l.push({
        ...m.variant,
        id: `variant_${u + 1}`
      });
      continue;
    }
    const y = await r(f.message, u);
    s = Wt(s, y.usage), y.variant && l.push({
      ...y.variant,
      id: `variant_${u + 1}`
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
async function fp(t) {
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
    hs(t.retrievalSummary.topMoments.slice(0, 10)),
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
`), r = await _t({
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
  }), n = Zn(r.message);
  if (!n) return { variants: t.variants, usage: r.usage };
  try {
    const o = JSON.parse(n);
    return {
      variants: ap(o, t.variants),
      usage: r.usage
    };
  } catch {
    return { variants: t.variants, usage: r.usage };
  }
}
async function pp(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = t.index, r = t.request.trim();
  if (!r) throw new Error("No cut request provided.");
  let n;
  const i = await up({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: r,
    index: e
  });
  n = Wt(n, i.usage);
  const o = rp(i.brief, t.briefOverride, t.questionAnswers), a = await So(e, r, o, []);
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
  const s = await dp({
    apiKey: t.apiKey,
    visualCandidates: e.visualInputs,
    retrievedMoments: a.topMoments,
    model: t.visionModel
  }), l = await So(e, r, o, s, {
    apiKey: t.apiKey,
    model: t.model,
    rerank: o.qualityGoal !== "auto"
  }), d = await cp({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: r,
    brief: o,
    retrievalSummary: l,
    visualFindings: s
  });
  if (n = Wt(n, d.usage), d.variants.length === 0)
    return {
      stage: "brief",
      summaryMessage: d.summaryMessage,
      editorialBrief: o,
      clarifyingQuestions: i.clarifyingQuestions,
      retrievalSummary: l,
      visualFindings: s,
      variants: [],
      ...n ? { usage: n } : {}
    };
  const u = await fp({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    brief: o,
    retrievalSummary: l,
    variants: d.variants
  });
  return n = Wt(n, u.usage), {
    stage: "variants",
    summaryMessage: d.summaryMessage,
    editorialBrief: o,
    clarifyingQuestions: i.clarifyingQuestions,
    retrievalSummary: l,
    visualFindings: s,
    variants: u.variants,
    ...n ? { usage: n } : {}
  };
}
const gs = "http://127.0.0.1:11434";
function mp() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
async function hp(t, e) {
  var y, g;
  const r = ((y = e.model) == null ? void 0 : y.trim()) || "qwen3.5:latest", n = [];
  (g = e.systemPrompt) != null && g.trim() && n.push({ role: "system", content: e.systemPrompt.trim() });
  for (const h of e.messages ?? [])
    h.content.trim() && n.push({ role: h.role, content: h.content.trim() });
  if (n.length === 0 || n.every((h) => h.role === "system"))
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
  }, o = await fetch(`${gs}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(i)
  });
  if (!o.ok) {
    const h = await o.text().catch(() => "");
    throw new Error(`Ollama request failed (${o.status}): ${h || o.statusText}`);
  }
  const a = mp();
  let s = "", l = 0, d = 0, u = !1, c = "";
  const p = o.body.getReader(), f = new TextDecoder();
  let m = "";
  for (; ; ) {
    const { done: h, value: _ } = await p.read();
    if (h) break;
    m += f.decode(_, { stream: !0 });
    let b;
    for (; (b = m.indexOf(`
`)) >= 0; ) {
      const E = m.slice(0, b).trim();
      if (m = m.slice(b + 1), !!E)
        try {
          const S = JSON.parse(E), T = S.message, I = typeof (T == null ? void 0 : T.content) == "string" ? T.content : "";
          if (I)
            for (const v of I)
              u ? (c += v, c.endsWith("</think>") && (u = !1, c = "")) : (c += v, c === "<think>" ? (u = !0, c = "") : "<think>".startsWith(c) || (s += c, a == null || a.webContents.send("llm:local-stream", { requestId: t, token: c }), c = ""));
          S.done && (l = ne(S.prompt_eval_count) ?? 0, d = ne(S.eval_count) ?? 0);
        } catch {
        }
    }
  }
  return c && !u && (s += c, a == null || a.webContents.send("llm:local-stream", { requestId: t, token: c })), a == null || a.webContents.send("llm:local-stream", { requestId: t, done: !0 }), {
    message: s.trim(),
    usage: l > 0 || d > 0 ? { promptTokens: l, completionTokens: d, totalTokens: l + d, cost: 0 } : void 0
  };
}
async function gp() {
  try {
    const t = await fetch(`${gs}/api/tags`);
    return t.ok ? ((await t.json()).models ?? []).map((r) => r.name) : [];
  } catch {
    return [];
  }
}
function yp() {
  x.handle("llm:chat", async (t, e) => {
    const r = e.apiKey;
    if (!r) throw new Error("No fal.ai API key provided.");
    const n = Array.isArray(e.messages) ? e.messages : [], i = Kf(n);
    if (!i.trim()) throw new Error("No chat prompt provided.");
    const o = await _t({
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
  }), x.handle("llm:local-chat", async (t, e) => {
    const r = e.requestId || crypto.randomUUID(), n = await hp(r, e);
    return {
      message: n.message,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), x.handle("llm:local-models", async () => gp()), x.handle("llm:run-cut-workflow", async (t, e) => pp(e));
}
const ys = vr(pt), _p = [
  w.join(W.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
], wp = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "When an ACTIVE SKILL section is present, follow it directly in chat — never invoke Skill tool or slash commands.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), bp = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "CineGen SKILLS are in the system prompt — list them directly; never use Skill tool or say you will check.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), Ep = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" "), vp = "", Tp = "2";
let ar, We = null;
function ei() {
  const t = W.homedir(), e = [
    w.join(t, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ], r = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...e, r].filter(Boolean).join(w.delimiter)
  };
}
async function _s() {
  if (ar !== void 0) return ar;
  for (const t of _p)
    try {
      const { stdout: e } = await ys(t, ["--version"], {
        env: ei(),
        timeout: 8e3
      });
      if (e.toLowerCase().includes("claude"))
        return ar = t, t;
    } catch {
    }
  return ar = null, null;
}
function Sp() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function Ip(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
function Io(t) {
  const e = t.usage;
  if (!e || typeof e != "object") return;
  const r = Number(e.input_tokens) || 0, n = Number(e.cache_creation_input_tokens) || 0, i = Number(e.cache_read_input_tokens) || 0, o = r + n + i, a = Number(e.output_tokens) || 0, s = o + a, l = Number(t.total_cost_usd) || 0;
  if (!(o <= 0 && a <= 0 && s <= 0 && l <= 0))
    return { promptTokens: o, completionTokens: a, totalTokens: s, cost: l };
}
function xp(t, e, r) {
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
function xo(t) {
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
function Ap() {
  return w.join(J.getPath("userData"), "claude-code-workspace");
}
function jp(t) {
  return t.purpose === "json-job" ? !0 : t.purpose === "copilot" || t.purpose === "enhance-prompt" ? !1 : !t.injectProjectContext && !t.resumeSessionId && !(t.messages && t.messages.length > 0);
}
function kp(t, e) {
  if (t.injectProjectContext) {
    const r = (t.messages ?? []).filter((n) => n.content.trim());
    if (r.length > 0)
      return Ip(r);
  }
  return e ? t.userMessage.trim() : `${t.userMessage.trim()}

Assistant:
`;
}
async function Rp(t, e) {
  var g, h, _, b;
  const r = await _s();
  if (!r)
    throw new Error("Claude Code is not installed. Install it from https://code.claude.com");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const n = ((g = e.model) == null ? void 0 : g.trim()) || "sonnet", i = !!e.resumeSessionId && !e.injectProjectContext, o = jp(e), a = [
    "-p",
    i ? e.userMessage.trim() : kp(e, o),
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    Tp,
    "--model",
    n,
    "--tools",
    vp,
    "--disable-slash-commands",
    // No --mcp-config is passed, so this loads ZERO MCP servers. These jobs never use
    // them, and booting/tearing down the user's fleet dominated the call's wall clock.
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk"
  ];
  if (o ? (a.push("--safe-mode", "--effort", "low", "--include-partial-messages"), !i && ((h = e.systemPrompt) != null && h.trim()) && a.push("--system-prompt", e.systemPrompt.trim())) : a.push("--include-partial-messages"), i && e.resumeSessionId) {
    if (a.push("--resume", e.resumeSessionId), !o) {
      const E = [(_ = e.systemPrompt) == null ? void 0 : _.trim(), bp].filter(Boolean).join(`

`);
      a.push("--append-system-prompt", E);
    }
  } else if (!o && e.injectProjectContext && ((b = e.systemPrompt) != null && b.trim())) {
    const E = e.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "", S = e.purpose === "enhance-prompt" ? Ep : wp;
    a.push("--append-system-prompt", `${E}${e.systemPrompt.trim()}

${S}`);
  }
  const s = Sp(), l = o ? Ap() : void 0;
  l && await Je(l, { recursive: !0 });
  let d = "", u = "", c, p = !1, f = !1, m, y;
  return new Promise((E, S) => {
    var q, N;
    const T = ie(r, a, {
      env: ei(),
      ...l ? { cwd: l } : {},
      stdio: ["ignore", "pipe", "pipe"]
    });
    We = { child: T, requestId: t };
    let I = "", v = !1;
    const A = (D) => {
      v || (v = !0, We = null, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, done: !0 }), D(), T.killed || T.kill());
    };
    (q = T.stdout) == null || q.on("data", (D) => {
      I += D.toString();
      let $;
      for (; ($ = I.indexOf(`
`)) >= 0; ) {
        const G = I.slice(0, $).trim();
        if (I = I.slice($ + 1), !!G)
          try {
            const z = JSON.parse(G);
            if (z.type === "system" && z.subtype === "init" && typeof z.session_id == "string" && (c = z.session_id), z.type === "assistant" && z.error === "authentication_failed" && (p = !0), z.type === "result") {
              y = z;
              const H = xo(z);
              H && !d.trim() && (d = H, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: H }));
              const j = d.trim();
              if (j && !p && !j.includes("Not logged in")) {
                A(() => E({ message: j, sessionId: c, usage: m, resumed: i }));
                return;
              }
            }
            const k = Io(z);
            if (k)
              m = k;
            else if (z.type === "assistant") {
              const H = z.message;
              if (H != null && H.usage) {
                const j = Io({ usage: H.usage });
                j && (m = j);
              }
            }
            const P = xo(z);
            if (!P) continue;
            if (z.type === "stream_event") {
              f = !0, d += P, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: P });
              continue;
            }
            z.type === "assistant" && !f ? (d = P, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: P })) : z.type === "result" && !d.trim() && (d = P, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: P }));
          } catch {
          }
      }
    }), (N = T.stderr) == null || N.on("data", (D) => {
      u += D.toString();
    }), T.on("error", (D) => {
      A(() => S(D));
    }), T.on("close", (D) => {
      A(() => {
        const $ = d.trim();
        if (p || $.includes("Not logged in")) {
          S(new Error("Claude Code is not logged in. Open Terminal, run `claude`, and sign in with your subscription."));
          return;
        }
        if ($) {
          E({ message: $, sessionId: c, usage: m, resumed: i });
          return;
        }
        S(new Error(xp(D, u, y)));
      });
    });
  });
}
function Op() {
  x.handle("llm:claude-code-detect", async () => {
    const t = await _s();
    if (!t)
      return { installed: !1 };
    try {
      const { stdout: e } = await ys(t, ["--version"], {
        env: ei(),
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
  }), x.handle("llm:claude-code-chat", async (t, e) => {
    const r = e.requestId || X.randomUUID(), n = await Rp(r, e);
    return {
      message: n.message,
      sessionId: n.sessionId,
      resumed: n.resumed,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), x.handle("llm:claude-code-cancel", async (t, e) => {
    (We == null ? void 0 : We.requestId) === e && (We.child.kill("SIGTERM"), We = null);
  });
}
const ws = vr(pt), Pp = {
  "claude-code": [
    w.join(W.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "claude"
  ],
  codex: [
    w.join(W.homedir(), ".npm-global/bin/codex"),
    w.join(W.homedir(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "codex"
  ],
  gemini: [
    w.join(W.homedir(), ".npm-global/bin/gemini"),
    w.join(W.homedir(), ".local/bin/gemini"),
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
    "gemini"
  ]
}, sr = /* @__PURE__ */ new Map();
function Or() {
  const t = W.homedir(), e = [
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
function bs() {
  return {
    ...Or(),
    GEMINI_CLI_TRUST_WORKSPACE: "true",
    TERM: "dumb",
    NO_COLOR: "1"
  };
}
function In(t) {
  return t.replace(/\u001b\[[0-9;]*m/g, "");
}
async function Pr(t) {
  if (sr.has(t))
    return sr.get(t) ?? null;
  for (const e of Pp[t])
    try {
      const { stdout: r } = await ws(e, ["--version"], {
        env: Or(),
        timeout: 8e3
      });
      if (r.trim())
        return sr.set(t, e), e;
    } catch {
    }
  return sr.set(t, null), null;
}
async function an(t) {
  const e = await Pr(t);
  if (!e)
    return { id: t, installed: !1 };
  try {
    const { stdout: r } = await ws(e, ["--version"], {
      env: Or(),
      timeout: 8e3
    });
    return {
      id: t,
      installed: !0,
      path: e,
      version: r.trim()
    };
  } catch {
    return { id: t, installed: !1 };
  }
}
async function Np() {
  return Promise.all([
    an("claude-code"),
    an("codex"),
    an("gemini")
  ]);
}
function Es() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function xn(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
const vs = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), qp = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), Ts = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" ");
function Cp() {
  x.handle("llm:cli-detect", async () => ({ providers: await Np() }));
}
function Lp(t, e) {
  const r = t.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "").trim(), n = r.match(/You've hit your usage limit\.[^\n]*/i);
  return n ? `${n[0].trim()} Luna and Codex share your ChatGPT Codex quota — pick fal.ai in the LLM picker, or wait for the reset.` : r.split(`
`).filter((o) => {
    const a = o.trim();
    return !(!a || /^Reading additional input from stdin/i.test(a) || /codex_models_manager::cache/i.test(a) || /rmcp::transport/i.test(a) || /AuthRequiredError|AuthRequired\(/i.test(a));
  }).join(`
`).trim() || `Codex exited with code ${e ?? "unknown"}`;
}
let Ae = null;
function Up() {
  return w.join(J.getPath("userData"), "codex-workspace");
}
function Dp(t) {
  return t.purpose === "json-job" ? !0 : t.purpose === "copilot" || t.purpose === "enhance-prompt" ? !1 : !t.injectProjectContext && !t.resumeSessionId && !(t.messages && t.messages.length > 0);
}
function Mp(t, e) {
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

` : "", l = t.purpose === "enhance-prompt" ? Ts : vs;
      r.push(`${s}${t.systemPrompt.trim()}

${l}`);
    } else
      r.push(t.systemPrompt.trim());
  const n = (t.messages ?? []).filter((s) => s.content.trim()), i = n.length > 0 ? xn(n) : `${t.userMessage.trim()}

Assistant:
`;
  return r.length > 0 ? `${r.join(`

`)}

${i}` : t.userMessage.trim();
}
function $p(t) {
  const e = t.usage;
  if (!e) return;
  const r = Number(e.input_tokens) || 0, n = Number(e.cached_input_tokens) || 0, i = r + n, o = Number(e.output_tokens) || 0, a = i + o;
  if (!(a <= 0))
    return { promptTokens: i, completionTokens: o, totalTokens: a, cost: 0 };
}
function Fp(t) {
  if (t.type !== "item.completed" && t.type !== "item.updated") return "";
  const e = t.item;
  return (e == null ? void 0 : e.type) === "agent_message" && typeof e.text == "string" ? e.text : "";
}
async function Bp(t, e) {
  var y;
  const r = await Pr("codex");
  if (!r)
    throw new Error("Codex CLI is not installed. Install it from https://developers.openai.com/codex");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const n = ((y = e.model) == null ? void 0 : y.trim()) || "gpt-5.3-codex", i = !!e.resumeSessionId && !e.injectProjectContext, o = Dp(e), a = i ? e.userMessage.trim() : Mp(e, o), s = o ? Up() : void 0;
  s && await Je(s, { recursive: !0 });
  const l = ["exec", "--json", "-s", "read-only", "-m", n, "--skip-git-repo-check"];
  o && (l.push("--ignore-user-config", "--ignore-rules"), s && l.push("-C", s)), i && e.resumeSessionId && l.push("resume", e.resumeSessionId), o || l.push(a);
  const d = Es();
  let u = "", c = "", p, f, m = "";
  return new Promise((g, h) => {
    var E, S, T, I;
    const _ = ie(r, l, {
      env: Or(),
      cwd: s,
      stdio: o ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    o && ((E = _.stdin) == null || E.write(a), (S = _.stdin) == null || S.end()), Ae = { child: _, requestId: t, provider: "codex" };
    let b = "";
    (T = _.stdout) == null || T.on("data", (v) => {
      b += v.toString();
      let A;
      for (; (A = b.indexOf(`
`)) >= 0; ) {
        const q = b.slice(0, A).trim();
        if (b = b.slice(A + 1), !!q)
          try {
            const N = JSON.parse(q);
            N.type === "thread.started" && typeof N.thread_id == "string" && (p = N.thread_id);
            const D = $p(N);
            if (D && (f = D), N.type === "turn.failed") {
              const G = N.error;
              c += (G == null ? void 0 : G.message) ?? "Codex turn failed.";
            }
            const $ = Fp(N);
            if ($) {
              const G = $.startsWith(m) ? $.slice(m.length) : $;
              m = $, u = $, G && (d == null || d.webContents.send("llm:codex-stream", { requestId: t, token: G }));
            }
          } catch {
          }
      }
    }), (I = _.stderr) == null || I.on("data", (v) => {
      c += v.toString();
    }), _.on("error", (v) => {
      Ae = null, h(v);
    }), _.on("close", (v) => {
      Ae = null, d == null || d.webContents.send("llm:codex-stream", { requestId: t, done: !0 });
      const A = u.trim();
      if (!A) {
        h(new Error(Lp(c, v)));
        return;
      }
      g({ message: A, sessionId: p, usage: f, resumed: i });
    });
  });
}
function Hp() {
  x.handle("llm:codex-chat", async (t, e) => {
    const r = e.requestId || X.randomUUID(), n = await Bp(r, e);
    return {
      message: n.message,
      sessionId: n.sessionId,
      resumed: n.resumed,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), x.handle("llm:codex-cancel", async (t, e) => {
    (Ae == null ? void 0 : Ae.requestId) !== e || Ae.provider !== "codex" || (Ae.child.kill("SIGTERM"), Ae = null);
  });
}
const Gp = 272e3, Ao = {
  short: { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
  long: { input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 }
};
function qt(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? Math.floor(e) : 0;
}
function zp(t) {
  if (!t || typeof t != "object" || Array.isArray(t)) return;
  const e = t.usage;
  if (!e || typeof e != "object" || Array.isArray(e)) return;
  const r = e, n = r.prompt_tokens_details && typeof r.prompt_tokens_details == "object" && !Array.isArray(r.prompt_tokens_details) ? r.prompt_tokens_details : {}, i = qt(r.prompt_tokens ?? r.input_tokens), o = qt(r.completion_tokens ?? r.output_tokens), a = qt(n.cached_tokens), s = qt(n.cache_write_tokens), l = qt(r.total_tokens) || i + o;
  if (!(i <= 0 && o <= 0 && l <= 0))
    return { promptTokens: i, completionTokens: o, totalTokens: l, cachedTokens: a, cacheWriteTokens: s };
}
function Vp(t) {
  const e = t.promptTokens > Gp ? Ao.long : Ao.short, r = Math.min(t.cachedTokens, t.promptTokens), n = Math.min(t.cacheWriteTokens, Math.max(0, t.promptTokens - r)), o = (Math.max(0, t.promptTokens - r - n) * e.input + r * e.cached + n * e.cacheWrite + t.completionTokens * e.output) / 1e6;
  return { ...t, cost: Math.round(o * 1e8) / 1e8 };
}
const Wp = "https://api.openai.com/v1/chat/completions", Xp = "gpt-5.6-luna", Jp = 6e4;
function Kp(t, e = []) {
  const r = t.trim(), n = e.map((i) => i.trim()).filter(Boolean);
  return n.length === 0 ? r : [
    { type: "text", text: r },
    ...n.map((i) => ({ type: "image_url", image_url: { url: i, detail: "low" } }))
  ];
}
function Yp(t) {
  var i, o;
  const e = [], r = ((i = t.systemPrompt) == null ? void 0 : i.trim()) ?? "";
  r && e.push({ role: "system", content: r }), e.push({ role: "user", content: Kp(t.userMessage, t.imageUrls) });
  const n = {
    model: ((o = t.model) == null ? void 0 : o.trim()) || Xp,
    messages: e,
    reasoning_effort: t.reasoningEffort ?? "low",
    max_completion_tokens: Number.isFinite(t.maxCompletionTokens) ? Math.max(1, Math.floor(t.maxCompletionTokens)) : Jp
  };
  return t.jsonObject !== !1 && (n.response_format = { type: "json_object" }), n;
}
function Qp(t, e) {
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
function Zp(t) {
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
async function em(t) {
  const e = t.apiKey.trim();
  if (!e) throw new Error("No OpenAI API key provided.");
  const r = t.userMessage.trim();
  if (!r) throw new Error("No OpenAI prompt provided.");
  const n = t.fetchImpl ?? globalThis.fetch;
  if (typeof n != "function") throw new Error("This runtime does not provide fetch.");
  const i = await n(Wp, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${e}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(Yp({
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
    throw new Error(Qp(a, `OpenAI request failed (${i.status}).`));
  const s = zp(a);
  return {
    message: Zp(a),
    ...s ? { usage: Vp(s) } : {}
  };
}
function tm(t) {
  return t.startsWith("local-media://file") ? decodeURIComponent(t.replace(/^local-media:\/\/file/, "")) : null;
}
function rm(t) {
  const e = w.extname(t).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : e === ".gif" ? "image/gif" : "image/jpeg";
}
function nm(t) {
  const e = t.trim();
  if (!e) return null;
  if (/^data:image\//i.test(e) || /^https?:\/\//i.test(e)) return e;
  const r = tm(e) ?? (e.startsWith("/") || /^[A-Za-z]:[\\/]/.test(e) ? e : null);
  if (!r || !B.existsSync(r)) return null;
  const n = B.readFileSync(r);
  return `data:${rm(r)};base64,${n.toString("base64")}`;
}
function im(t) {
  return Array.isArray(t) ? t.flatMap((e) => {
    if (typeof e != "string") return [];
    const r = nm(e);
    return r ? [r] : [];
  }) : [];
}
function om() {
  x.handle("llm:openai-chat", async (t, e) => {
    const r = e && typeof e == "object" && !Array.isArray(e) ? e : {}, n = typeof r.apiKey == "string" ? r.apiKey : "", i = typeof r.userMessage == "string" ? r.userMessage : "";
    return em({
      apiKey: n,
      model: typeof r.model == "string" ? r.model : void 0,
      systemPrompt: typeof r.systemPrompt == "string" ? r.systemPrompt : void 0,
      userMessage: i,
      imageUrls: im(r.imageUrls),
      maxCompletionTokens: typeof r.maxCompletionTokens == "number" ? r.maxCompletionTokens : void 0,
      jsonObject: r.jsonObject === !1 ? !1 : void 0
    });
  }), x.handle("llm:openai-realtime-session", async (t, e) => {
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
    const d = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${n}`,
        "OpenAI-Safety-Identifier": "cinegen-desktop-user"
      },
      body: l
    }), u = await d.text();
    if (!d.ok) {
      let p = `OpenAI Realtime failed (${d.status}).`;
      try {
        const f = JSON.parse(u);
        (c = f.error) != null && c.message && (p = f.error.message);
      } catch {
      }
      throw new Error(p);
    }
    return { sdp: u };
  });
}
const Ss = vr(pt), am = 90;
function ft(t) {
  const e = t.trim();
  if (!e) return null;
  const r = [
    e,
    w.resolve(e)
  ];
  for (const n of r)
    if (B.existsSync(n)) return n;
  return null;
}
async function Is(t, e, r, n) {
  const i = Te(), o = Math.max(0, e), a = Math.max(0.1, Math.min(r, am));
  try {
    return await Ss(i, [
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
    ], { timeout: Math.max(12e4, Math.ceil(a * 4e3)) }), B.existsSync(n) ? n : null;
  } catch {
    return null;
  }
}
async function cr(t, e, r) {
  const n = Te();
  try {
    return await Ss(n, [
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
    ], { timeout: 15e3 }), B.existsSync(r) ? r : null;
  } catch {
    return null;
  }
}
function An(t) {
  return X.createHash("sha1").update(JSON.stringify({
    label: t.label,
    fileRef: t.fileRef,
    trimStartSec: t.trimStartSec,
    trimDurationSec: t.trimDurationSec
  })).digest("hex").slice(0, 12);
}
function xs(t) {
  return /\s/.test(t);
}
function As(t, e) {
  try {
    if (B.existsSync(e)) return e;
    try {
      B.linkSync(t, e);
    } catch {
      B.copyFileSync(t, e);
    }
    return B.existsSync(e) ? e : null;
  } catch {
    return null;
  }
}
function sn(t, e, r) {
  if (!xs(t))
    return { mediaPath: t, ephemeral: !1 };
  const n = w.extname(t) || (e.mediaType === "image" ? ".jpg" : ".mp4"), i = w.join(r, `${An(e)}-source${n}`), o = As(t, i);
  return o ? { mediaPath: o, ephemeral: !0 } : null;
}
async function ti(t, e) {
  const r = w.join(e, "visual-refs");
  B.mkdirSync(r, { recursive: !0 });
  const n = [];
  for (const i of t) {
    const o = ft(i.fileRef);
    if (!o) continue;
    if (i.mediaType === "image") {
      const u = sn(o, i, r);
      if (!u) continue;
      n.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: u.mediaPath,
        ephemeral: u.ephemeral
      });
      continue;
    }
    if (i.trimStartSec !== void 0 && i.trimDurationSec !== void 0) {
      const u = w.join(r, `${An(i)}.mp4`), c = await Is(
        o,
        i.trimStartSec,
        i.trimDurationSec,
        u
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
      const u = sn(o, i, r);
      if (!u) continue;
      n.push({
        label: i.label,
        kind: i.kind,
        mediaType: "video",
        mediaPath: u.mediaPath,
        ephemeral: u.ephemeral
      });
      continue;
    }
    const s = (i.framePaths ?? []).map((u) => ft(u)).find(Boolean);
    if (s) {
      const u = sn(s, {
        ...i,
        mediaType: "image",
        fileRef: s
      }, r);
      if (!u) continue;
      n.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: u.mediaPath,
        ephemeral: u.ephemeral
      });
      continue;
    }
    const l = w.join(r, `${An(i)}.jpg`), d = await cr(o, i.trimStartSec ?? 0, l);
    d && n.push({
      label: i.label,
      kind: i.kind,
      mediaType: "image",
      mediaPath: d,
      ephemeral: !0
    });
  }
  return n;
}
function js(t, e) {
  if (e.length === 0) return t.trim();
  const r = e.map((o) => `@${o.mediaPath}`).join(" "), n = t.trim();
  return e.some((o) => o.mediaType === "video") ? n ? `${r} ${n}` : `${r} describe this video in detail. Include what you see on screen, the setting, actions, and any spoken audio.` : n ? `${r} ${n}` : `${r} describe this image in detail.`;
}
function ri(t) {
  for (const e of t)
    if (e.ephemeral)
      try {
        B.unlinkSync(e.mediaPath);
      } catch {
      }
}
function ks(t) {
  const e = t.trim();
  if (!e) return null;
  if (e.startsWith("local-media://file/")) {
    const r = decodeURIComponent(e.replace("local-media://file", ""));
    return ft(r);
  }
  if (e.startsWith("file://"))
    try {
      return ft(decodeURIComponent(new URL(e).pathname));
    } catch {
      return null;
    }
  return ft(e);
}
async function sm(t, e) {
  const r = ks(t);
  if (!r) throw new Error(`Could not resolve a local source file for: ${t}`);
  const n = w.join(W.tmpdir(), "cinegen-higgsfield-refs");
  B.mkdirSync(n, { recursive: !0 });
  const i = X.randomBytes(6).toString("hex"), o = Math.max(0, e.sourceStartSec ?? 0), a = e.sourceEndSec ?? o;
  if (e.mode === "first-last") {
    const u = w.join(n, `${i}-first.jpg`), c = w.join(n, `${i}-last.jpg`), p = await cr(r, o, u), f = await cr(r, Math.max(o, a - 0.05), c), m = [], y = [];
    if (p && (m.push(p), y.push("start_image")), f && (m.push(f), y.push("end_image")), m.length === 0) throw new Error("Failed to extract first/last frames");
    return { paths: m, roles: y };
  }
  if (e.mode === "segment") {
    const u = w.join(n, `${i}-segment.mp4`), c = Math.max(0.1, a > o ? a - o : e.maxSegmentSec ?? 30), p = await Is(r, o, Math.min(c, e.maxSegmentSec ?? 30), u);
    if (!p) throw new Error("Failed to extract clip segment");
    return { paths: [p], roles: ["image"] };
  }
  const s = e.frameTimeSec ?? (a > o ? (o + a) / 2 : o), l = w.join(n, `${i}-frame.jpg`), d = await cr(r, s, l);
  if (!d) throw new Error("Failed to extract reference frame");
  return { paths: [d], roles: ["image"] };
}
function lm(t) {
  return /\b(cannot|can't|do not have the ability|unable to|not able to)\b[\s\S]{0,100}\b(video|visual|auditory|audio|mp4|mov|footage|media file)\b/i.test(t) || /\btools do not allow\b[\s\S]{0,60}\b(video|visual|auditory|mp4)\b/i.test(t);
}
class _r extends Error {
}
const dm = 18e4, um = 600 * 1e3;
async function Rs(t) {
  var u;
  const e = await Pr("gemini");
  if (!e)
    throw new _r("Gemini CLI is not installed.");
  const r = ft(t.mediaPath);
  if (!r)
    throw new Error(`Media file not found: ${t.mediaPath}`);
  const n = w.join(W.tmpdir(), "cinegen-gemini-acoustic");
  await Je(n, { recursive: !0 });
  let i = r, o = !1;
  if (xs(r)) {
    const c = w.extname(r) || ".mp4", p = w.join(n, `${X.randomUUID()}${c}`), f = As(r, p);
    if (!f)
      throw new Error("Could not stage the media file for Gemini analysis.");
    i = f, o = !0;
  }
  const a = ((u = t.model) == null ? void 0 : u.trim()) || "gemini-2.5-flash", l = [
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
    X.randomUUID(),
    "--include-directories",
    w.dirname(i)
  ], d = () => {
    if (o)
      try {
        B.unlinkSync(i);
      } catch {
      }
  };
  return new Promise((c, p) => {
    var T, I;
    const f = ie(e, l, { env: bs(), cwd: n, stdio: ["ignore", "pipe", "pipe"] });
    let m = "", y = "", g = "", h = !1, _ = !1;
    const b = (v) => {
      h || (h = !0, clearTimeout(E), clearTimeout(S), d(), v());
    }, E = setTimeout(() => {
      f.kill("SIGTERM"), b(() => p(new Error("Gemini CLI media analysis timed out.")));
    }, um), S = setTimeout(() => {
      _ || (f.kill("SIGTERM"), b(() => p(new Error("Gemini CLI is still reading the media file. Try a shorter clip."))));
    }, dm);
    (T = f.stdout) == null || T.on("data", (v) => {
      g += v.toString();
      let A;
      for (; (A = g.indexOf(`
`)) >= 0; ) {
        const q = g.slice(0, A).trim();
        if (g = g.slice(A + 1), !!q)
          try {
            const N = JSON.parse(q);
            N.type === "message" && N.role === "assistant" && typeof N.content == "string" && N.content && (_ = !0, m += N.content), N.type === "error" && typeof N.message == "string" && (y += N.message);
          } catch {
          }
      }
    }), (I = f.stderr) == null || I.on("data", (v) => {
      y += v.toString();
    }), f.on("error", (v) => b(() => p(v))), f.on("close", (v) => {
      const A = m.trim();
      if (!A) {
        const q = In(y.trim()) || `Gemini CLI exited with code ${v ?? "unknown"}`;
        b(() => p(new Error(q)));
        return;
      }
      if (lm(A)) {
        b(() => p(new _r("Gemini CLI declined to analyze the media.")));
        return;
      }
      b(() => c(A));
    });
  });
}
const jo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GeminiMediaUnavailableError: _r,
  analyzeMediaWithGeminiCli: Rs,
  buildGeminiUserMessageWithVisualRefs: js,
  cleanupEphemeralVisualRefs: ri,
  prepareClipReference: sm,
  prepareCopilotVisualRefs: ti,
  resolveLocalSourcePath: ks
}, Symbol.toStringTag, { value: "Module" }));
let he = null;
const cm = 9e4, fm = 18e4, pm = 8e3;
function Os() {
  return w.join(J.getPath("userData"), "gemini-cli-workspace");
}
function mm() {
  return w.join(W.tmpdir(), "cinegen-gemini-visual-refs");
}
function hm(t) {
  var n;
  const e = [];
  if ((n = t.systemPrompt) != null && n.trim())
    if (t.injectProjectContext) {
      const i = t.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "";
      e.push(`${i}${t.systemPrompt.trim()}

${t.purpose === "enhance-prompt" ? Ts : vs}`);
    } else
      e.push(t.systemPrompt.trim());
  const r = (t.messages ?? []).filter((i) => i.content.trim());
  return r.length > 0 ? e.length > 0 ? `${e.join(`

`)}

${xn(r)}` : xn(r) : e.length > 0 ? `${e.join(`

`)}

User:
${t.userMessage.trim()}

Assistant:
` : t.userMessage.trim();
}
function gm(t) {
  var r;
  const e = [
    (r = t.systemPrompt) == null ? void 0 : r.trim(),
    qp
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
function ym(t) {
  const e = t.stats;
  if (!e) return;
  const r = Number(e.input_tokens) || 0, n = Number(e.output_tokens) || 0, i = Number(e.total_tokens) || r + n;
  if (!(i <= 0))
    return { promptTokens: r, completionTokens: n, totalTokens: i, cost: 0 };
}
function _m(t) {
  if (typeof t != "string" || !t.trim()) return "Gemini CLI is working…";
  const e = t.replace(/_/g, " ").toLowerCase();
  return e.includes("read") && e.includes("file") ? "Gemini CLI: Reading attached video…" : `Gemini CLI: ${t.replace(/_/g, " ")}…`;
}
function wm(t) {
  return /malformed tool call|empty response|API Error|INVALID_ARGUMENT/i.test(t);
}
function bm(t) {
  return /no previous sessions found/i.test(t);
}
async function ko(t, e, r) {
  var g;
  const n = await Pr("gemini");
  if (!n)
    throw new Error("Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli");
  const i = ((g = e.model) == null ? void 0 : g.trim().replace(/^[^/]+\//, "")) || "gemini-2.5-flash", o = r.canResume ? gm(e) : hm(e), a = o.length > pm, s = Os();
  await Je(s, { recursive: !0 });
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
    l.push("--session-id", X.randomUUID());
    const h = [...new Set(
      r.preparedVisualRefs.map((_) => w.dirname(_.mediaPath))
    )];
    for (const _ of h)
      l.push("--include-directories", _);
  } else r.canResume && e.resumeSessionId && l.push("-r", e.resumeSessionId);
  const d = Es();
  let u = "", c = "", p, f;
  const m = 900 * 1e3, y = r.hasVisualRefs ? fm : cm;
  return new Promise((h, _) => {
    var q, N, D, $;
    const b = ie(n, l, {
      env: bs(),
      cwd: s,
      stdio: a ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    a && ((q = b.stdin) == null || q.write(o), (N = b.stdin) == null || N.end()), he = { child: b, requestId: t, provider: "gemini" };
    let E = "", S = !1, T = !1;
    const I = (G) => {
      S || (S = !0, clearTimeout(v), clearTimeout(A), ri(r.preparedVisualRefs), G());
    }, v = setTimeout(() => {
      he = null, b.kill("SIGTERM"), I(() => _(new Error("Gemini CLI timed out after 15 minutes. Try again or switch models.")));
    }, m), A = setTimeout(() => {
      T || S || (he = null, b.kill("SIGTERM"), I(() => _(new Error(
        r.hasVisualRefs ? "Gemini CLI is still reading the attached video. Try again or use a shorter clip." : "Gemini CLI is taking too long to respond. Try gemini-2.5-flash, shorten the question, or start a new chat."
      ))));
    }, y);
    (D = b.stdout) == null || D.on("data", (G) => {
      E += G.toString();
      let z;
      for (; (z = E.indexOf(`
`)) >= 0; ) {
        const k = E.slice(0, z).trim();
        if (E = E.slice(z + 1), !!k)
          try {
            const P = JSON.parse(k);
            P.type === "init" && typeof P.session_id == "string" && (p = P.session_id);
            const H = ym(P);
            if (H && (f = H), P.type === "tool_use" && (d == null || d.webContents.send("llm:gemini-stream", {
              requestId: t,
              status: _m(P.tool_name)
            })), P.type === "message" && P.role === "assistant" && typeof P.content == "string") {
              const j = P.content;
              j && (T = !0, u += j, d == null || d.webContents.send("llm:gemini-stream", { requestId: t, token: j }));
            }
            if (P.type === "error" && typeof P.message == "string") {
              const j = P.message;
              c += j, !u.trim() && wm(j) && (he = null, b.kill("SIGTERM"), I(() => _(new Error(In(j)))));
            }
            if (P.type === "result" && P.status === "error") {
              const j = typeof P.error == "string" ? P.error : typeof P.message == "string" ? P.message : "Gemini CLI returned an error.";
              c += j;
            }
          } catch {
          }
      }
    }), ($ = b.stderr) == null || $.on("data", (G) => {
      c += G.toString();
    }), b.on("error", (G) => {
      he = null, I(() => _(G));
    }), b.on("close", (G) => {
      he = null, d == null || d.webContents.send("llm:gemini-stream", { requestId: t, done: !0 });
      const z = u.trim();
      if (!z) {
        const k = In(c.trim()) || `Gemini CLI exited with code ${G ?? "unknown"}`;
        I(() => _(new Error(k)));
        return;
      }
      I(() => h({
        message: z,
        sessionId: p,
        usage: f,
        resumed: r.canResume
      }));
    });
  });
}
async function Em(t, e) {
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const r = Os(), n = mm();
  await Je(r, { recursive: !0 }), await Je(n, { recursive: !0 });
  const i = await ti(e.visualRefs ?? [], n);
  if ((e.visualRefs ?? []).length > 0 && i.length === 0)
    throw new Error("Could not load the attached /clip or /asset files for Gemini visual analysis. Use local video or image files.");
  const o = i.length > 0, a = {
    ...e,
    userMessage: js(e.userMessage, i)
  }, s = !!e.resumeSessionId && !e.injectProjectContext && !o;
  try {
    return await ko(t, a, {
      canResume: s,
      hasVisualRefs: o,
      preparedVisualRefs: i
    });
  } catch (l) {
    const d = l instanceof Error ? l.message : String(l);
    if (!s || !bm(d))
      throw l;
    return ko(t, {
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
function vm() {
  x.handle("llm:gemini-chat", async (t, e) => {
    const r = e.requestId || X.randomUUID(), n = await Em(r, e);
    return {
      message: n.message,
      sessionId: n.sessionId,
      resumed: n.resumed,
      ...n.usage ? { usage: n.usage } : {}
    };
  }), x.handle("llm:gemini-cancel", async (t, e) => {
    (he == null ? void 0 : he.requestId) !== e || he.provider !== "gemini" || (he.child.kill("SIGTERM"), he = null);
  });
}
const Tm = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;
function Sm(t, e) {
  const r = [];
  e && (r.push("I have a video that needs a music soundtrack. I've attached frames from the video for you to analyze."), r.push("Look at the visual content, mood, pacing, and subject matter to inform the music style."));
  const n = [];
  return t.genre && n.push(`Genre: ${t.genre}`), t.style && n.push(`Style: ${t.style}`), t.mood && n.push(`Mood: ${t.mood}`), t.tempo && n.push(`Tempo: ${t.tempo}`), t.additionalNotes && n.push(`Notes: ${t.additionalNotes}`), n.length > 0 && r.push(`User preferences:
` + n.join(`
`)), r.push("Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else."), r.join(`

`);
}
function Im() {
  x.handle("music:generate-prompt", async (t, e) => {
    const r = e.apiKey;
    if (!r) throw new Error("No fal.ai API key provided.");
    K.fal.config({ credentials: r });
    const n = e.frameUrls && e.frameUrls.length > 0, i = Sm(e, !!n), o = {
      model: "google/gemini-flash-1.5",
      system_prompt: Tm,
      prompt: i,
      max_tokens: 300
    }, a = n ? "fal-ai/any-llm/vision" : "fal-ai/any-llm";
    return n && (o.image_urls = e.frameUrls), { prompt: ((await K.fal.subscribe(a, { input: o, logs: !0 })).data.output ?? "").trim() };
  });
}
function xm() {
  x.handle("dialog:show-save", async (t, e) => {
    const r = Q.getFocusedWindow();
    if (!r) return null;
    const n = await ui.showSaveDialog(r, {
      defaultPath: e == null ? void 0 : e.defaultPath,
      filters: e == null ? void 0 : e.filters
    });
    return n.canceled ? null : n.filePath;
  }), x.handle("dialog:show-open", async (t, e) => {
    var i;
    const r = Q.getFocusedWindow();
    if (!r) return null;
    const n = await ui.showOpenDialog(r, {
      filters: e == null ? void 0 : e.filters,
      properties: (e == null ? void 0 : e.properties) ?? ["openFile"]
    });
    return n.canceled ? null : (i = e == null ? void 0 : e.properties) != null && i.includes("multiSelections") ? n.filePaths : n.filePaths[0];
  }), x.handle("shell:open-path", async (t, e) => await Ho.openPath(e));
}
const Am = {
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
function wt(t, e) {
  const r = Am[e], n = Object.entries(t).filter(
    ([a]) => a !== "id" && (!r || r.has(a))
  );
  if (n.length === 0) throw new Error("No valid fields to update");
  const i = n.map(([a]) => `${a} = ?`).join(", "), o = n.map(([, a]) => a);
  return { setClauses: i, values: o };
}
function Ps(t, e) {
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
function Ns(t, e) {
  return t.queryOne("SELECT * FROM projects WHERE id = ?", [e]);
}
function qs(t, e, r) {
  const { setClauses: n, values: i } = wt(r, "projects");
  return t.run(`UPDATE projects SET ${n} WHERE id = ?`, [...i, e]);
}
function Cs(t, e) {
  return t.query("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at", [
    e
  ]);
}
function Ls(t, e) {
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
function wr(t, e, r) {
  const { setClauses: n, values: i } = wt(r, "assets");
  return t.run(`UPDATE assets SET ${n} WHERE id = ?`, [...i, e]);
}
function Us(t, e) {
  return t.run("DELETE FROM assets WHERE id = ?", [e]);
}
function jm(t, e) {
  return t.query(
    "SELECT * FROM media_folders WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function km(t, e) {
  return t.run(
    `INSERT INTO media_folders (id, project_id, name, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.parent_id, e.created_at]
  );
}
function Rm(t, e, r) {
  const { setClauses: n, values: i } = wt(r, "media_folders");
  return t.run(`UPDATE media_folders SET ${n} WHERE id = ?`, [...i, e]);
}
function Om(t, e) {
  return t.query(
    "SELECT * FROM timelines WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function Ds(t, e) {
  return t.run(
    `INSERT INTO timelines (id, project_id, name, duration, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.duration, e.created_at]
  );
}
function Pm(t, e, r) {
  const { setClauses: n, values: i } = wt(r, "timelines");
  return t.run(`UPDATE timelines SET ${n} WHERE id = ?`, [...i, e]);
}
function Nm(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE timeline_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE timeline_id = ?", [e]), t.run("DELETE FROM tracks WHERE timeline_id = ?", [e]), t.run("DELETE FROM transitions WHERE timeline_id = ?", [e]), t.run("DELETE FROM timelines WHERE id = ?", [e]);
  });
}
function qm(t, e) {
  return t.query(
    "SELECT * FROM tracks WHERE timeline_id = ? ORDER BY sort_order",
    [e]
  );
}
function jn(t, e) {
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
function Cm(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE track_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE track_id = ?", [e]), t.run("DELETE FROM tracks WHERE id = ?", [e]);
  });
}
function Lm(t, e) {
  return t.query(
    "SELECT * FROM clips WHERE timeline_id = ? ORDER BY start_time",
    [e]
  );
}
function Um(t, e) {
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
function Dm(t, e) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]), t.run("DELETE FROM clips WHERE id = ?", [e]);
  });
}
function Mm(t, e) {
  return t.query(
    "SELECT * FROM keyframes WHERE clip_id = ? ORDER BY time",
    [e]
  );
}
function $m(t, e, r) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]);
    for (const n of r)
      t.run(
        "INSERT INTO keyframes (id, clip_id, time, property, value) VALUES (?, ?, ?, ?, ?)",
        [Ut(), n.clip_id, n.time, n.property, n.value]
      );
  });
}
function Fm(t, e) {
  return t.query(
    "SELECT * FROM transitions WHERE timeline_id = ?",
    [e]
  );
}
function Bm(t, e) {
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
function Hm(t, e) {
  return t.run("DELETE FROM transitions WHERE id = ?", [e]);
}
function Gm(t, e) {
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
function zm(t, e, r) {
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
function Vm(t, e) {
  return t.query(
    "SELECT * FROM elements WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function Wm(t, e) {
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
function Xm(t, e, r) {
  const { setClauses: n, values: i } = wt(r, "elements");
  return t.run(`UPDATE elements SET ${n} WHERE id = ?`, [...i, e]);
}
function Jm(t, e) {
  return t.run("DELETE FROM elements WHERE id = ?", [e]);
}
function Km(t, e) {
  return t.query(
    "SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC",
    [e]
  );
}
function Ym(t, e) {
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
function Qm(t, e, r) {
  const { setClauses: n, values: i } = wt(r, "export_jobs");
  return t.run(`UPDATE export_jobs SET ${n} WHERE id = ?`, [...i, e]);
}
function Ro(t, e) {
  const r = Ns(t, e);
  if (!r) throw new Error(`Project not found: ${e}`);
  const n = Cs(t, e), i = jm(t, e), o = Gm(t, e), a = Vm(t, e), s = Km(t, e), d = Om(t, e).map((c) => {
    const p = qm(t, c.id), f = Lm(t, c.id), m = Fm(t, c.id), y = f.map((g) => ({
      ...g,
      keyframes: Mm(t, g.id)
    }));
    return { ...c, tracks: p, clips: y, transitions: m };
  }), u = d.length > 0 ? d[0].id : "";
  return {
    project: r,
    assets: n,
    mediaFolders: i,
    timelines: d,
    activeTimelineId: u,
    workflow: o,
    elements: a,
    exports: s
  };
}
function Zm(t, e, r) {
  t.transaction(() => {
    Ns(t, e) ? qs(t, e, {
      name: r.project.name,
      updated_at: Vt(),
      resolution_width: r.project.resolution_width,
      resolution_height: r.project.resolution_height,
      frame_rate: r.project.frame_rate
    }) : Ps(t, { ...r.project, updated_at: Vt() });
    const i = new Set(
      t.query("SELECT id FROM media_folders WHERE project_id = ?", [e]).map((f) => f.id)
    ), o = new Set(r.mediaFolders.map((f) => f.id));
    for (const f of i)
      o.has(f) || (t.run("UPDATE assets SET folder_id = NULL WHERE folder_id = ?", [f]), t.run("DELETE FROM media_folders WHERE id = ?", [f]));
    for (const f of r.mediaFolders)
      i.has(f.id) ? Rm(t, f.id, {
        name: f.name,
        parent_id: f.parent_id
      }) : km(t, f);
    const a = new Set(
      t.query("SELECT id FROM assets WHERE project_id = ?", [e]).map((f) => f.id)
    ), s = new Set(r.assets.map((f) => f.id));
    for (const f of a)
      s.has(f) || Us(t, f);
    for (const f of r.assets)
      if (a.has(f.id)) {
        const { id: m, project_id: y, created_at: g, ...h } = f;
        wr(t, f.id, h);
      } else
        Ls(t, f);
    const l = new Set(
      t.query("SELECT id FROM timelines WHERE project_id = ?", [e]).map((f) => f.id)
    ), d = new Set(r.timelines.map((f) => f.id));
    for (const f of l)
      d.has(f) || Nm(t, f);
    for (const f of r.timelines) {
      if (l.has(f.id))
        Pm(t, f.id, { name: f.name, duration: f.duration });
      else {
        const { tracks: E, clips: S, transitions: T, ...I } = f;
        Ds(t, I);
      }
      const m = new Set(
        t.query("SELECT id FROM tracks WHERE timeline_id = ?", [f.id]).map((E) => E.id)
      ), y = new Set(f.tracks.map((E) => E.id));
      for (const E of m)
        y.has(E) || Cm(t, E);
      for (const E of f.tracks)
        jn(t, E);
      const g = new Set(
        t.query("SELECT id FROM clips WHERE timeline_id = ?", [f.id]).map((E) => E.id)
      ), h = new Set(f.clips.map((E) => E.id));
      for (const E of g)
        h.has(E) || Dm(t, E);
      for (const E of f.clips) {
        const { keyframes: S, ...T } = E;
        Um(t, T), $m(
          t,
          E.id,
          S.map(({ id: I, ...v }) => v)
        );
      }
      const _ = new Set(
        t.query("SELECT id FROM transitions WHERE timeline_id = ?", [f.id]).map((E) => E.id)
      ), b = new Set(f.transitions.map((E) => E.id));
      for (const E of _)
        b.has(E) || Hm(t, E);
      for (const E of f.transitions)
        Bm(t, E);
    }
    zm(t, e, r.workflow);
    const u = new Set(
      t.query("SELECT id FROM elements WHERE project_id = ?", [e]).map((f) => f.id)
    ), c = new Set(r.elements.map((f) => f.id));
    for (const f of u)
      c.has(f) || Jm(t, f);
    for (const f of r.elements)
      if (u.has(f.id)) {
        const { id: m, project_id: y, created_at: g, ...h } = f;
        Xm(t, f.id, { ...h, updated_at: Vt() });
      } else
        Wm(t, f);
    const p = new Set(
      t.query("SELECT id FROM export_jobs WHERE project_id = ?", [e]).map((f) => f.id)
    );
    for (const f of r.exports)
      if (p.has(f.id)) {
        const { id: m, project_id: y, created_at: g, ...h } = f;
        Qm(t, f.id, h);
      } else
        Ym(t, f);
  });
}
const Le = /* @__PURE__ */ new Map();
function Oe(t) {
  let e = Le.get(t);
  return e || (e = new Tf(t), Le.set(t, e)), e;
}
function Ms() {
  return w.join(Ze(), "projects.json");
}
async function ni() {
  try {
    const t = await R.readFile(Ms(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function ii(t) {
  await R.mkdir(Ze(), { recursive: !0 }), await R.writeFile(Ms(), JSON.stringify(t, null, 2), "utf-8");
}
async function eh(t) {
  const e = await ni(), r = e.projects.findIndex((n) => n.id === t.id);
  r >= 0 ? e.projects[r] = t : e.projects.push(t), await ii(e);
}
async function th(t) {
  const e = await ni();
  e.projects = e.projects.filter((r) => r.id !== t), await ii(e);
}
function rh() {
  x.handle("db:project:create", async (t, e) => {
    const r = Ut(), n = Vt();
    as(r);
    const i = Oe(r);
    Ps(i, {
      id: r,
      name: e,
      created_at: n,
      updated_at: n,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24
    });
    const a = Ut();
    return Ds(i, {
      id: a,
      project_id: r,
      name: "Timeline 1",
      duration: 0,
      created_at: n
    }), jn(i, {
      id: Ut(),
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
    }), jn(i, {
      id: Ut(),
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
    }), await eh({
      id: r,
      name: e,
      createdAt: n,
      updatedAt: n,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
      useSqlite: !0
    }), Ro(i, r);
  }), x.handle("db:project:load", async (t, e) => {
    const r = Oe(e), n = Ro(r, e);
    for (const i of n.assets)
      if (i.file_ref && !i.source_url) {
        const o = i.status;
        B.existsSync(i.file_ref) ? i.status === "offline" && (i.status = "online") : i.status = "offline", i.status !== o && wr(r, i.id, { status: i.status });
      }
    return n;
  }), x.handle("db:project:save", async (t, e, r) => {
    const n = Oe(e);
    Zm(n, e, r);
    const i = Vt(), o = await ni(), a = o.projects.find((s) => s.id === e);
    return a && (a.name = r.project.name, a.updatedAt = i, a.assetCount = r.assets.length, a.elementCount = r.elements.length, await ii(o)), { ok: !0 };
  }), x.handle("db:project:delete", async (t, e) => {
    const r = Le.get(e);
    r && (r.close(), Le.delete(e));
    const n = Ye(e);
    try {
      await R.rm(n, { recursive: !0, force: !0 });
    } catch (i) {
      console.error(`[db:project:delete] Failed to remove directory ${n}:`, i);
    }
    return await th(e), { ok: !0 };
  }), x.handle("db:project:close", async (t, e) => {
    const r = Le.get(e);
    return r && (r.close(), Le.delete(e)), { ok: !0 };
  }), x.handle(
    "db:project:update",
    async (t, e, r) => {
      const n = Oe(e);
      return qs(n, e, r), { ok: !0 };
    }
  ), x.handle("db:asset:insert", async (t, e) => {
    const r = Oe(e.project_id);
    return Ls(r, e), { ok: !0 };
  }), x.handle(
    "db:asset:update",
    async (t, e, r, n) => {
      const i = Oe(e);
      return wr(i, r, n), { ok: !0 };
    }
  ), x.handle("db:asset:delete", async (t, e, r) => {
    const n = Oe(e);
    return Us(n, r), { ok: !0 };
  });
}
function nh() {
  for (const [t, e] of Le)
    try {
      e.close();
    } catch (r) {
      console.error(`[closeAllDbs] Failed to close DB for project ${t}:`, r);
    }
  Le.clear();
}
const ih = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), oh = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
function ln(t, e) {
  const r = w.extname(t).toLowerCase();
  return ih.has(r) ? "video" : oh.has(r) ? "audio" : r ? "image" : e;
}
function ah(t, e) {
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
async function sh(t, e) {
  let r = [];
  try {
    r = await R.readdir(t);
  } catch {
    return null;
  }
  const n = r.find((i) => i === e || i.startsWith(`${e}.`));
  return n ? w.join(t, n) : null;
}
function lh(t) {
  return t.startsWith("local-media://file") ? decodeURIComponent(t.replace(/^local-media:\/\/file/, "")) : null;
}
function dh(t) {
  if (!(t != null && t.trim())) return null;
  const e = t.trim(), r = lh(e) ?? e;
  return B.existsSync(r) ? r : null;
}
async function uh(t, e) {
  await R.mkdir(w.dirname(e), { recursive: !0 }), await R.copyFile(t, e);
}
function fr(t) {
  const e = Ye(t.projectId), r = w.join(e, ".cache"), n = X.randomUUID(), i = {
    id: n,
    type: "extract_metadata",
    assetId: t.assetId,
    inputPath: t.inputPath,
    outputPath: "",
    projectDir: e
  };
  if (t.type !== "audio") {
    const o = w.join(r, "thumbnails");
    B.mkdirSync(o, { recursive: !0 }), we({
      id: X.randomUUID(),
      type: "generate_thumbnail",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(o, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((a) => console.error("[generated-asset-persist] Thumbnail failed:", a));
  }
  if (we(i).catch((o) => console.error("[generated-asset-persist] Metadata failed:", o)), t.type === "audio" || t.type === "video") {
    const o = w.join(r, "waveforms");
    B.mkdirSync(o, { recursive: !0 }), we({
      id: X.randomUUID(),
      type: "compute_waveform",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(o, `${t.assetId}.json`),
      projectDir: e
    }).catch((a) => console.error("[generated-asset-persist] Waveform failed:", a));
  }
  if (t.type === "video") {
    const o = w.join(r, "filmstrips");
    B.mkdirSync(o, { recursive: !0 }), we({
      id: X.randomUUID(),
      type: "generate_filmstrip",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(o, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Filmstrip failed:", s));
    const a = w.join(r, "proxies");
    B.mkdirSync(a, { recursive: !0 }), we({
      id: X.randomUUID(),
      type: "generate_proxy",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(a, `${t.assetId}.mp4`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Proxy failed:", s));
  }
  return n;
}
async function Oo(t) {
  var f;
  const { projectId: e, assetId: r, assetType: n } = t;
  if (!e || !r)
    throw new Error("projectId and assetId are required.");
  const i = Ye(e), o = w.join(i, "media", "generated");
  await R.mkdir(o, { recursive: !0 });
  const a = await sh(o, r);
  if (a)
    return fr({
      assetId: r,
      projectId: e,
      inputPath: a,
      type: ln(a, n)
    }), {
      path: a,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const s = t.extension || ah(t.remoteUrl ?? t.localPathHint, n), l = w.join(o, `${r}${s}`), d = dh(t.localPathHint);
  if (d)
    return await uh(d, l), fr({
      assetId: r,
      projectId: e,
      inputPath: l,
      type: ln(l, n)
    }), {
      path: l,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const u = (f = t.remoteUrl) == null ? void 0 : f.trim();
  if (!u)
    return { error: "No downloadable URL or local file path for this asset." };
  const c = await fetch(u);
  if (!c.ok)
    throw new Error(`Failed to download (HTTP ${c.status}). The URL may have expired.`);
  const p = await c.arrayBuffer();
  return await R.writeFile(l, Buffer.from(p)), fr({
    assetId: r,
    projectId: e,
    inputPath: l,
    type: ln(l, n)
  }), {
    path: l,
    sourceUrl: u,
    downloaded: !0
  };
}
let fe = null;
const Pe = /* @__PURE__ */ new Map(), Dt = /* @__PURE__ */ new Map(), ch = w.dirname(Pn(import.meta.url));
function $s() {
  let t = w.join(ch, "workers", "media-worker.js");
  return t.includes("app.asar") && (t = t.replace("app.asar", "app.asar.unpacked")), t;
}
function fh() {
  return fe || (fe = new Vo($s()), fe.on("message", (t) => {
    switch (t.type) {
      case "ready":
        console.log("[media-worker] Worker ready");
        break;
      case "job:progress":
        for (const e of Q.getAllWindows())
          e.webContents.send("media:job-progress", { jobId: t.jobId, progress: t.progress });
        break;
      case "job:complete": {
        const e = Dt.get(t.jobId);
        for (const n of Q.getAllWindows())
          n.webContents.send("media:job-complete", {
            jobId: t.jobId,
            result: t.result,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        Dt.delete(t.jobId);
        const r = Pe.get(t.jobId);
        r && (r.resolve(t.result), Pe.delete(t.jobId));
        break;
      }
      case "job:error": {
        const e = Dt.get(t.jobId);
        for (const n of Q.getAllWindows())
          n.webContents.send("media:job-error", {
            jobId: t.jobId,
            error: t.error,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        Dt.delete(t.jobId);
        const r = Pe.get(t.jobId);
        r && (r.reject(new Error(t.error)), Pe.delete(t.jobId));
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
  }), fe.on("error", (t) => {
    console.error("[media-worker] Worker error:", t);
  }), fe.on("exit", (t) => {
    console.log(`[media-worker] Worker exited with code ${t}`), fe = null;
    for (const [e, r] of Pe)
      r.reject(new Error("Worker exited")), Pe.delete(e);
  }), fe.postMessage({
    type: "config",
    ffmpegPath: Te(),
    ffprobePath: is(),
    fpcalcPath: os()
  }), fe);
}
function we(t) {
  return t.type === "sync_compute_offset" || t.type === "sync_batch_match" ? ph(t) : new Promise((e, r) => {
    Pe.set(t.id, { resolve: e, reject: r }), Dt.set(t.id, { assetId: t.assetId, jobType: t.type }), fh().postMessage({ type: "job:submit", job: t });
  });
}
function ph(t) {
  return new Promise((e, r) => {
    const n = new Vo($s());
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
          for (const d of Q.getAllWindows())
            d.webContents.send("sync:batch-progress", {
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
      ffmpegPath: Te(),
      ffprobePath: is(),
      fpcalcPath: os()
    });
  });
}
function mh(t) {
  const e = w.extname(t).toLowerCase(), r = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), n = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
  return r.has(e) ? "video" : n.has(e) ? "audio" : "image";
}
function hh() {
  x.handle("media:import", async (t, e) => {
    const { filePaths: r, projectId: n, mode: i } = e, o = Ye(n), a = [], s = [];
    for (const l of r) {
      const d = X.randomUUID();
      let u = l;
      if (i === "copy") {
        const f = w.join(o, "media", "imported");
        await R.mkdir(f, { recursive: !0 });
        const m = `${d}${w.extname(l)}`, y = w.join(f, m);
        await R.copyFile(l, y), u = y;
      }
      const c = mh(l), p = X.randomUUID();
      s.push({
        assetId: d,
        metadataJobId: p,
        inputPath: u,
        type: c,
        projectDir: o
      }), a.push({ assetId: d, jobId: p, filePath: u, type: c });
    }
    return setTimeout(() => {
      for (const l of s)
        fr({
          assetId: l.assetId,
          projectId: n,
          inputPath: l.inputPath,
          type: l.type
        });
    }, 0), a;
  }), x.handle("media:submit-job", async (t, e) => we(e)), x.handle("media:cancel-job", async (t, e) => {
    const r = fe;
    return r && r.postMessage({ type: "job:cancel", jobId: e }), Pe.delete(e), { ok: !0 };
  }), x.handle("media:extract-frame", async (t, e) => {
    const { inputPath: r, timeSec: n } = e, i = Te(), o = w.join(W.tmpdir(), `cinegen-frame-${X.randomUUID()}.jpg`);
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
      pt(i, s, { timeout: 15e3 }, (l, d, u) => {
        if (l || !B.existsSync(o)) {
          a(null);
          return;
        }
        a({ outputPath: o });
      });
    });
  }), x.handle("media:write-temp-image", async (t, e) => {
    const r = e.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!r) throw new Error("media:write-temp-image expects a base64 image data URL.");
    const n = r[1] === "jpeg" ? "jpg" : r[1], i = Buffer.from(r[2], "base64"), o = w.join(W.tmpdir(), `cinegen-frame-chat-${X.randomUUID()}.${n}`);
    return await R.writeFile(o, i), { outputPath: o };
  }), x.handle("media:extract-clip", async (t, e) => {
    const { inputPath: r, startTimeSec: n, durationSec: i } = e, o = Te(), a = w.join(W.tmpdir(), `cinegen-clip-${X.randomUUID()}.mp4`), s = Math.max(0, n), l = Math.max(0.1, i);
    return new Promise((d) => {
      const u = [
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
      pt(o, u, { timeout: Math.max(12e4, Math.ceil(l * 4e3)) }, (c, p, f) => {
        if (c || !B.existsSync(a)) {
          d(null);
          return;
        }
        d({ outputPath: a });
      });
    });
  }), x.handle("media:queue-processing", async (t, e) => {
    const {
      assetId: r,
      projectId: n,
      inputPath: i,
      needsProxy: o,
      includeThumbnail: a = !1,
      includeWaveform: s = !0,
      includeFilmstrip: l = !0
    } = e, d = Ye(n), u = w.join(d, ".cache");
    if (a) {
      const c = w.join(u, "thumbnails");
      B.mkdirSync(c, { recursive: !0 });
      const p = {
        id: X.randomUUID(),
        type: "generate_thumbnail",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.jpg`),
        projectDir: d
      };
      we(p).catch((f) => console.error("[media-import] Thumbnail failed:", f));
    }
    if (s) {
      const c = w.join(u, "waveforms");
      B.mkdirSync(c, { recursive: !0 });
      const p = {
        id: X.randomUUID(),
        type: "compute_waveform",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.json`),
        projectDir: d
      };
      we(p).catch((f) => console.error("[media-import] Waveform failed:", f));
    }
    if (l) {
      const c = w.join(u, "filmstrips");
      B.mkdirSync(c, { recursive: !0 });
      const p = {
        id: X.randomUUID(),
        type: "generate_filmstrip",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.jpg`),
        projectDir: d
      };
      we(p).catch((f) => console.error("[media-import] Filmstrip failed:", f));
    }
    if (o) {
      const c = w.join(u, "proxies");
      B.mkdirSync(c, { recursive: !0 });
      const p = {
        id: X.randomUUID(),
        type: "generate_proxy",
        assetId: r,
        inputPath: i,
        outputPath: w.join(c, `${r}.mp4`),
        projectDir: d
      };
      we(p).catch((f) => console.error("[media-import] Proxy failed:", f));
    }
    return { ok: !0 };
  }), x.handle(
    "media:download-remote",
    async (t, e) => {
      const { url: r, projectId: n, assetId: i, ext: o } = e;
      if (!r || !n) throw new Error("url and projectId are required");
      const a = await Oo({
        projectId: n,
        assetId: i,
        assetType: "video",
        remoteUrl: r,
        extension: o
      });
      if ("error" in a) throw new Error(a.error);
      return { path: a.path };
    }
  ), x.handle(
    "media:persist-generated-asset",
    async (t, e) => {
      try {
        return await Oo(e);
      } catch (r) {
        return {
          error: r instanceof Error ? r.message : String(r)
        };
      }
    }
  );
}
function gh() {
  fe && (fe.terminate(), fe = null);
}
function yh(t) {
  x.handle("sync:compute-offset", async (e, r) => {
    const n = ci();
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
  }), x.handle("sync:batch-match", async (e, r) => {
    const n = ci();
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
const _h = zo(import.meta.url), wh = w.dirname(Pn(import.meta.url));
function bh() {
  return J.isPackaged ? w.join(process.resourcesPath, "native", "cinegen_avfoundation.node") : w.resolve(wh, "../native/avfoundation/build/Release/cinegen_avfoundation.node");
}
let te = null, kn = null;
if (process.platform === "darwin")
  try {
    const t = bh();
    te = _h(t), console.log("[native-video] AVFoundation addon loaded:", t);
  } catch (t) {
    kn = t instanceof Error ? t.message : String(t), console.error("[native-video] Failed to load AVFoundation addon:", kn);
  }
function Re() {
  return te != null;
}
function Eh() {
  return kn;
}
function vh(t, e) {
  return te ? te.createSurface(t, e) : !1;
}
function Po(t) {
  te == null || te.destroySurface(t);
}
function Th(t, e, r, n, i) {
  te == null || te.setSurfaceRect(t, e, r, n, i);
}
function No(t, e) {
  te == null || te.setSurfaceHidden(t, e);
}
function qo(t) {
  te == null || te.clearSurface(t);
}
function Sh(t, e) {
  te == null || te.syncSurface(t, e);
}
function Ih() {
  x.handle("native-video:is-available", () => ({
    available: Re(),
    error: Eh()
  })), x.handle("native-video:reset-surfaces", (t, e) => {
    if (!Re()) return !1;
    for (const r of e)
      No(r, !0), qo(r), Po(r);
    return !0;
  }), x.handle("native-video:create-surface", (t, e) => {
    const r = Q.fromWebContents(t.sender);
    return !r || !Re() ? !1 : vh(e, r.getNativeWindowHandle());
  }), x.on("native-video:set-surface-rect", (t, e) => {
    Re() && Th(e.surfaceId, e.x, e.y, e.width, e.height);
  }), x.on("native-video:set-surface-hidden", (t, e) => {
    Re() && No(e.surfaceId, e.hidden);
  }), x.on("native-video:clear-surface", (t, e) => {
    Re() && qo(e);
  }), x.on("native-video:sync-surface", (t, e) => {
    Re() && Sh(e.surfaceId, e.descriptors);
  }), x.on("native-video:destroy-surface", (t, e) => {
    Re() && Po(e);
  });
}
const xh = "python3.12", Fs = w.join(W.homedir(), "Desktop", "Coding", "whisperx"), Ah = w.join(Fs, ".venv", "bin", "python");
function jh(...t) {
  return J.isPackaged ? w.join(process.resourcesPath, ...t) : w.join(process.cwd(), ...t);
}
const kh = jh("scripts", "whisperx", "cinegen_infer.py"), Rh = "fal-ai/whisper", Co = "3", Oh = {
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
function Ph(t) {
  const e = w.extname(t).toLowerCase();
  return Oh[e] ?? "application/octet-stream";
}
function br(t) {
  const e = Number(t);
  if (Number.isFinite(e))
    return Math.round(Math.max(0, e) * 1e3) / 1e3;
}
function Nh(t, e) {
  const r = e.trim();
  return r ? t ? /^[,.;:!?%)\]}]/.test(r) || /^['’]/.test(r) ? `${t}${r}` : `${t} ${r}` : r : t;
}
function qh(t) {
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
function Bs(t) {
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
    }), r.words.push(o), r.end = o.end, r.text = Nh(r.text, o.word), !r.speaker && o.speaker && (r.speaker = o.speaker);
    const a = t[i + 1], s = a ? Math.max(0, a.start - o.end) : 0, l = !!a && (a.speaker ?? null) !== (r.speaker ?? null), d = r.end - r.start, u = /[.!?]["')\]]*$/.test(o.word), c = s >= 0.85 || s >= 0.45 && /[,;:]$/.test(o.word), p = d >= 12;
    (!a || u || c || p || l) && n();
  }
  return n(), e;
}
function Ch(t) {
  const e = t.flatMap((r) => Array.isArray(r.words) ? r.words.flatMap((n) => {
    if (!n || typeof n.word != "string") return [];
    const i = br(n.start), o = br(n.end);
    return i === void 0 || o === void 0 ? [] : [{
      word: n.word.trim(),
      start: i,
      end: o,
      ...n.prob !== void 0 ? { prob: n.prob } : {},
      ...n.speaker !== void 0 ? { speaker: n.speaker } : {}
    }];
  }) : []);
  return e.length === 0 ? t : Bs(e);
}
function Lh(t) {
  const e = (t == null ? void 0 : t.data) ?? t, r = typeof (e == null ? void 0 : e.text) == "string" ? e.text : "", n = e == null ? void 0 : e.chunks, i = e, o = Array.isArray(n) ? n.flatMap((u) => {
    if (!u || typeof u != "object") return [];
    const c = typeof u.text == "string" ? u.text.trim() : "", p = u.timestamp, f = Array.isArray(p) ? br(p[0]) : void 0, m = Array.isArray(p) ? br(p[1]) : void 0, y = qh(u.speaker);
    return !c && f === void 0 && m === void 0 ? [] : [{ text: c, start: f, end: m, speaker: y }];
  }) : [], a = o.flatMap((u) => !u.text || u.start === void 0 || u.end === void 0 ? [] : [{
    word: u.text,
    start: u.start,
    end: u.end,
    ...u.speaker ? { speaker: u.speaker } : {}
  }]), s = a.length > 0 ? Bs(a) : o.map((u) => ({
    text: u.text,
    start: u.start ?? 0,
    end: u.end ?? u.start ?? 0,
    ...u.speaker ? { speaker: u.speaker } : {}
  }));
  let l = "";
  const d = [i.language, i.languages, i.inferred_languages];
  for (const u of d) {
    if (typeof u == "string" && u.trim()) {
      l = u.trim();
      break;
    }
    if (Array.isArray(u)) {
      const c = u.find((p) => typeof p == "string" && p.trim().length > 0);
      if (c) {
        l = c.trim();
        break;
      }
    }
  }
  return {
    text: r || s.map((u) => u.text).filter(Boolean).join(" "),
    segments: s,
    language: l
  };
}
async function Uh(t) {
  const e = w.join(
    W.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), r = Te(), n = [
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
    const a = ie(r, n, { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    (l = a.stderr) == null || l.on("data", (d) => {
      s += d.toString();
    }), a.on("error", o), a.on("close", (d) => {
      if (d === 0) {
        i();
        return;
      }
      o(new Error(s.trim() || `ffmpeg exited with code ${d}`));
    });
  }), e;
}
const Dh = `
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
`, Lo = /* @__PURE__ */ new Map();
function Mh() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function Me(t, e) {
  var r;
  (r = Mh()) == null || r.webContents.send("transcription:progress", {
    jobId: t.jobId,
    assetId: t.assetId,
    engine: t.engine,
    ...e
  });
}
async function $h(t) {
  try {
    const e = Oe(t.projectId), r = Cs(e, t.projectId).find((o) => o.id === t.assetId), i = {
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
    wr(e, t.assetId, { metadata: JSON.stringify(i) });
  } catch (e) {
    console.error("[transcription] failed to save to db:", e);
  }
}
async function oi(t) {
  t.status = "done", t.segments = Ch(t.segments), t.fullText.trim() || (t.fullText = t.segments.map((e) => e.text).filter(Boolean).join(" ")), await $h(t), Me(t, {
    type: "done",
    text: t.fullText,
    segments: t.segments,
    language: t.language
  });
}
function Xe(t, e) {
  t.status = "error", t.error = e, Me(t, { type: "error", error: e });
}
function Fh(t, e) {
  const r = e.model ?? "large", n = e.language ?? "auto";
  t.model = r, (async () => {
    const i = w.join(W.tmpdir(), `cinegen-whisper-${t.jobId}.py`);
    await R.writeFile(i, Dh, "utf-8");
    const o = ie(xh, [i, e.filePath, r, n], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    t.status = "running", Me(t, { type: "status", status: "running" }), o.stdout.on("data", (a) => {
      for (const s of a.toString().split(`
`)) {
        const l = s.trim();
        if (l)
          try {
            const d = JSON.parse(l);
            if (d.type === "segment") {
              const u = {
                text: d.text,
                start: d.start ?? 0,
                end: d.end ?? 0,
                ...Array.isArray(d.words) && d.words.length > 0 ? { words: d.words } : {}
              };
              t.segments.push(u), Me(t, { type: "segment", ...u });
            } else d.type === "done" && (t.fullText = d.text, t.language = d.language ?? "");
          } catch {
          }
      }
    }), o.stderr.on("data", () => {
    }), o.on("close", async (a) => {
      if (await R.unlink(i).catch(() => {
      }), a !== 0) {
        Xe(t, `whisper process exited with code ${a}`);
        return;
      }
      await oi(t);
    }), o.on("error", async (a) => {
      await R.unlink(i).catch(() => {
      }), Xe(t, a.message);
    });
  })().catch((i) => {
    Xe(t, i instanceof Error ? i.message : String(i));
  });
}
function Bh(t, e) {
  t.model = "base";
  const r = [
    kh,
    "--audio_path",
    e.filePath,
    "--model",
    "base",
    "--no_diarize"
  ];
  e.language && e.language !== "auto" && r.push("--language", e.language);
  const n = { ...process.env };
  process.env.HF_TOKEN && (n.HF_TOKEN = process.env.HF_TOKEN);
  const i = ie(Ah, r, {
    cwd: Fs,
    stdio: ["ignore", "pipe", "pipe"],
    env: n
  });
  t.status = "running", Me(t, { type: "status", status: "running" });
  let o;
  i.stdout.on("data", (a) => {
    for (const s of a.toString().split(`
`)) {
      const l = s.trim();
      if (l)
        try {
          const d = JSON.parse(l);
          d.type === "progress" ? (d.output_text !== void 0 && (t.fullText = d.output_text), d.segments && (t.segments = d.segments), d.language !== void 0 && (t.language = d.language), Me(t, {
            type: "progress",
            stage: d.stage,
            message: d.message,
            ...d.output_text !== void 0 ? { text: d.output_text } : {},
            ...d.segments ? { segments: d.segments } : {},
            ...d.language !== void 0 ? { language: d.language } : {}
          })) : d.type === "done" ? (d.output_text !== void 0 && (t.fullText = d.output_text), d.segments && (t.segments = d.segments), d.language !== void 0 && (t.language = d.language), o = d.transcript_path) : d.type === "error" && Xe(t, d.error ?? "WhisperX error");
        } catch {
        }
    }
  }), i.stderr.on("data", () => {
  }), i.on("close", async (a) => {
    if (t.status !== "error") {
      if (a !== 0) {
        Xe(t, `whisperx process exited with code ${a}`);
        return;
      }
      if (o)
        try {
          const s = await R.readFile(o, "utf-8"), l = JSON.parse(s);
          l.output_text !== void 0 && (t.fullText = l.output_text), l.segments && (t.segments = l.segments), l.language !== void 0 && (t.language = l.language), l.model && (t.model = l.model);
        } finally {
          await R.unlink(o).catch(() => {
          });
        }
      await oi(t);
    }
  }), i.on("error", (a) => {
    Xe(t, a.message);
  });
}
function Hh(t, e) {
  (async () => {
    if (!e.apiKey) throw new Error("No fal.ai API key provided. Add one in Settings.");
    t.model = Co, t.status = "running", Me(t, { type: "status", status: "running", stage: "uploading", message: "Preparing audio for cloud transcription" }), K.fal.config({ credentials: e.apiKey });
    const r = await Uh(e.filePath);
    let n = "";
    try {
      const s = await R.readFile(r), d = `${w.basename(e.filePath, w.extname(e.filePath))}.m4a`, u = Ph(r), c = new Blob([s], { type: u }), p = new File([c], d, { type: u });
      n = await K.fal.storage.upload(p);
    } finally {
      await R.unlink(r).catch(() => {
      });
    }
    Me(t, { type: "status", status: "running", stage: "transcribing", message: "Running cloud transcription" });
    const i = {
      audio_url: n,
      task: "transcribe",
      chunk_level: "word",
      version: Co,
      ...e.language && e.language !== "auto" ? { language: e.language } : {}
    }, o = await K.fal.subscribe(Rh, { input: i, logs: !0 }), a = Lh(o);
    t.fullText = a.text, t.segments = a.segments, t.language = a.language, await oi(t);
  })().catch((r) => {
    Xe(t, r instanceof Error ? r.message : String(r));
  });
}
function Gh() {
  x.handle("transcription:start", async (t, e) => {
    const {
      projectId: r,
      assetId: n,
      filePath: i,
      model: o = "large",
      language: a = "auto",
      engine: s = "faster-whisper-local",
      apiKey: l
    } = e, d = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, u = {
      jobId: d,
      assetId: n,
      projectId: r,
      engine: s,
      status: "pending",
      segments: [],
      fullText: "",
      language: ""
    };
    return Lo.set(d, u), s === "whisperx-local" ? Bh(u, { filePath: i, language: a }) : s === "whisper-cloud" ? Hh(u, { filePath: i, language: a, apiKey: l }) : Fh(u, { filePath: i, model: o, language: a }), { jobId: d };
  }), x.handle("transcription:get", (t, e) => {
    const r = Lo.get(e);
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
const ai = w.join(W.homedir(), "Desktop", "Coding", "ltx"), zh = w.join(ai, ".venv", "bin", "python"), Vh = w.join(ai, "cinegen_infer.py"), si = w.join(W.homedir(), "Desktop", "Coding", "qwen-edit"), Wh = w.join(si, ".venv", "bin", "python"), Xh = w.join(si, "cinegen_infer.py"), Hs = w.join(W.homedir(), "Desktop", "Coding", "layer-decompose"), Jh = w.join(Hs, ".venv", "bin", "python"), Gs = w.join(W.homedir(), "Desktop", "Coding", "whisperx"), Kh = w.join(Gs, ".venv", "bin", "python");
function zs(...t) {
  return J.isPackaged ? w.join(process.resourcesPath, ...t) : w.join(process.cwd(), ...t);
}
const Yh = zs("scripts", "layer-decompose", "cinegen_infer.py"), Qh = zs("scripts", "whisperx", "cinegen_infer.py"), Zh = {
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
}, Uo = /* @__PURE__ */ new Map();
function eg() {
  return Q.getAllWindows().find((t) => !t.isDestroyed());
}
function ot(t, e) {
  var r;
  (r = eg()) == null || r.webContents.send("local-model:progress", { jobId: t, ...e });
}
async function lr(t, e) {
  if (t.startsWith("http://") || t.startsWith("https://")) {
    const r = w.extname(new URL(t).pathname) || ".jpg", n = w.join(W.tmpdir(), `cinegen-img-${e}${r}`), i = await fetch(t);
    if (!i.ok) throw new Error(`Failed to download image: ${i.status}`);
    const o = await i.arrayBuffer();
    return await R.writeFile(n, Buffer.from(o)), { imagePath: n, tempPath: n };
  } else if (t.startsWith("local-media://file/"))
    return { imagePath: decodeURIComponent(t.replace("local-media://file", "")), tempPath: null };
  return { imagePath: t, tempPath: null };
}
function tg() {
  x.handle("local-model:run", async (t, e) => {
    const { inputs: r } = e, n = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, i = { jobId: n, status: "pending" };
    Uo.set(n, i);
    let o, a = null;
    if (e.nodeType === "qwen-edit-local") {
      const s = String(r.prompt ?? ""), l = Number(r.num_inference_steps ?? 50), d = Number(r.guidance_scale ?? 1), u = Number(r.true_cfg_scale ?? 4), c = Number(r.seed ?? 42);
      let p = null;
      if (r.image_url) {
        const m = await lr(String(r.image_url), n);
        p = m.imagePath, a = m.tempPath;
      }
      if (!p) throw new Error("Qwen Image Edit requires an input image");
      const f = [
        Xh,
        "--image_path",
        p,
        "--prompt",
        s,
        "--num_inference_steps",
        String(l),
        "--guidance_scale",
        String(d),
        "--true_cfg_scale",
        String(u),
        "--seed",
        String(c)
      ];
      o = ie(Wh, f, {
        cwd: si,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "layer-decompose") {
      console.log("[layer-decompose] inputs:", JSON.stringify(r, null, 2));
      const s = String(r.prompts ?? "").trim(), l = String(r.inpainter ?? "qwen-edit-local"), d = !!(r.reconstruct_bg ?? !0), u = Number(r.seed ?? 42);
      let c = null;
      if (r.image_url) {
        console.log("[layer-decompose] resolving image_url:", r.image_url);
        const m = await lr(String(r.image_url), n);
        c = m.imagePath, a = m.tempPath, console.log("[layer-decompose] resolved to:", c);
      }
      if (!c) throw new Error("Layer Decompose requires an input image");
      const f = [
        Yh,
        "--image_path",
        c,
        "--inpainter",
        d && l === "lama" ? "lama" : "none",
        "--seed",
        String(u)
      ];
      s && f.push("--prompts", s), o = ie(Jh, f, {
        cwd: Hs,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "whisperx-local") {
      console.log("[whisperx] inputs:", JSON.stringify(r, null, 2));
      const s = String(r.model ?? "base"), l = String(r.language ?? "").trim(), d = r.diarize !== !1;
      let u = null;
      if (r.audio_url) {
        console.log("[whisperx] resolving audio_url:", r.audio_url);
        const m = await lr(String(r.audio_url), n);
        u = m.imagePath, a = m.tempPath, console.log("[whisperx] resolved to:", u);
      }
      if (!u) throw new Error("WhisperX requires an audio input");
      const c = [
        Qh,
        "--audio_path",
        u,
        "--model",
        s
      ];
      l && c.push("--language", l), d || c.push("--no_diarize");
      const p = process.env.HF_TOKEN, f = { ...process.env };
      p && (f.HF_TOKEN = p), o = ie(Kh, c, {
        cwd: Gs,
        stdio: ["ignore", "pipe", "pipe"],
        env: f
      });
    } else {
      const s = String(r.prompt ?? ""), l = String(r.resolution ?? "896x512"), { height: d, width: u } = Zh[l] ?? { height: 512, width: 896 }, c = Number(r.frame_rate ?? 24), p = Number(r.duration_secs ?? 4), f = Math.round(p * c / 8) * 8 + 1, m = Math.max(9, f), y = Number(r.seed ?? 42), g = !!r.enhance_prompt;
      let h = null;
      if (r.image_url) {
        const b = await lr(String(r.image_url), n);
        h = b.imagePath, a = b.tempPath;
      }
      const _ = [
        Vh,
        "--prompt",
        s,
        "--height",
        String(d),
        "--width",
        String(u),
        "--num_frames",
        String(m),
        "--frame_rate",
        String(c),
        "--seed",
        String(y)
      ];
      h && _.push("--image_path", h), g && _.push("--enhance_prompt"), o = ie(zh, _, {
        cwd: ai,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }
    return i.status = "running", ot(n, { type: "status", status: "running" }), o.stdout.on("data", (s) => {
      for (const l of s.toString().split(`
`)) {
        const d = l.trim();
        if (d)
          try {
            const u = JSON.parse(d);
            u.type === "progress" ? (i.stage = u.stage, u.output_text !== void 0 && (i.outputText = u.output_text), u.segments && (i.segments = u.segments), u.language !== void 0 && (i.language = u.language), ot(n, {
              type: "progress",
              stage: u.stage,
              message: u.message,
              ...u.output_text !== void 0 && { output_text: u.output_text },
              ...u.segments && { segments: u.segments },
              ...u.language !== void 0 && { language: u.language }
            })) : u.type === "done" ? (i.status = "done", i.outputPath = u.output_path, i.outputText = u.output_text, i.transcriptPath = u.transcript_path, i.segments = u.segments, i.language = u.language, ot(n, {
              type: "done",
              output_path: u.output_path,
              ...u.output_text !== void 0 && { output_text: u.output_text },
              ...u.transcript_path !== void 0 && { transcript_path: u.transcript_path },
              ...u.segments && { segments: u.segments },
              ...u.language !== void 0 && { language: u.language },
              ...u.layers && { layers: u.layers },
              ...u.needs_inpainting !== void 0 && { needs_inpainting: u.needs_inpainting },
              ...u.combined_mask_path && { combined_mask_path: u.combined_mask_path }
            })) : u.type === "error" && (i.status = "error", i.error = u.error, ot(n, { type: "error", error: u.error }));
          } catch {
          }
      }
    }), o.stderr.on("data", () => {
    }), o.on("error", (s) => {
      i.status = "error", i.error = s.message, ot(n, { type: "error", error: s.message });
    }), o.on("close", (s) => {
      a && R.unlink(a).catch(() => {
      }), s !== 0 && i.status !== "done" && (i.status = "error", i.error = i.error ?? `Process exited with code ${s}`, ot(n, { type: "error", error: i.error }));
    }), { jobId: n };
  }), x.handle("local-model:get", (t, e) => {
    const r = Uo.get(e);
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
  }), x.handle("local-model:read-transcript", async (t, e) => {
    try {
      const r = await R.readFile(e, "utf8");
      return JSON.parse(r);
    } catch (r) {
      return console.error("[local-model] failed to read transcript:", r), null;
    }
  });
}
const li = w.join(W.homedir(), "Desktop", "Coding", "Sam3"), rg = w.join(li, ".venv", "bin", "python"), ng = w.join(li, "cinegen_server.py"), ig = 120 * 1e3, og = 500, ag = 60;
class sg {
  constructor() {
    this.proc = null, this.port = 0, this.idleTimer = null;
  }
  async start() {
    var e, r;
    return this.proc && !this.proc.killed ? this.port : (this.port = await this.findFreePort(), console.log(`[sam3] Starting server on port ${this.port}`), this.proc = ie(rg, [ng, "--port", String(this.port)], {
      cwd: li,
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
    }, ig);
  }
  async findFreePort() {
    return new Promise((e, r) => {
      const n = tl.createServer();
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
    for (let e = 0; e < ag; e++) {
      try {
        if ((await fetch(`http://127.0.0.1:${this.port}/health`)).ok) {
          console.log(`[sam3] Health check passed after ${e + 1} attempts`);
          return;
        }
      } catch {
      }
      await new Promise((r) => setTimeout(r, og));
    }
    throw console.error("[sam3] Health check timed out after 30 seconds"), new Error("SAM 3 server failed to start within 30 seconds");
  }
}
const Mt = new sg();
function lg() {
  x.handle("sam3:start", async () => ({ port: await Mt.ensureRunning() })), x.handle("sam3:stop", async () => {
    await Mt.stop();
  }), x.handle("sam3:port", () => ({ port: Mt.getPort(), running: Mt.isRunning() }));
}
function dg() {
  Mt.stop();
}
function ug(t, e, r) {
  const n = r === "video" ? "video clip" : "image";
  return [
    t.trim() || `Describe this ${n} in detail.`,
    `Attached ${n}: "${e}".`,
    "Describe what you actually see and hear — specific subjects, actions, setting, camera movement, on-screen text, and spoken dialogue.",
    "Do not answer from clip names, storyboard labels, or generic production terminology alone."
  ].join(`
`);
}
async function cg(t) {
  const e = t.workspaceDir ?? w.join(J.getPath("userData"), "gemini-cli-workspace"), r = await ti(t.visualRefs, e);
  if (r.length === 0)
    throw new Error("Could not load the attached clip or asset files for visual analysis.");
  try {
    const n = [];
    for (const i of r) {
      const o = ug(t.prompt, i.label, i.mediaType), a = i.mediaType === "video" ? await ms({
        apiKey: t.apiKey,
        videoPath: i.mediaPath,
        prompt: o,
        detailedAnalysis: !0
      }) : await zf({
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
    ri(r);
  }
}
function fg() {
  x.handle("copilot:analyze-visual-refs", async (t, e) => cg(e));
}
const pg = 1, mg = -30, hg = 0.3;
function gg(t) {
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
function Do(t) {
  return t.toFixed(2);
}
function yg(t) {
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
  const n = r.map((i) => `[${Do(i.start)}-${Do(i.end)}] ${i.text}`).join(`
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
function _g(t) {
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
    for (let d = s; d < e.length; d++) {
      const u = e[d];
      if (u === o) l++;
      else if (u === a && (l--, l === 0)) {
        const c = e.slice(s, d + 1), p = r(c);
        if (p) return p;
        break;
      }
    }
  }
  return null;
}
function dn(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : void 0;
}
function at(t) {
  return typeof t == "string" && t.trim() ? t.trim() : void 0;
}
function wg(t) {
  if (!Array.isArray(t)) return;
  const e = t.filter((r) => typeof r == "string" && r.trim().length > 0).map((r) => r.trim());
  return e.length > 0 ? e : void 0;
}
function bg(t) {
  const e = _g(t);
  if (!e) return [];
  let r;
  try {
    r = JSON.parse(e);
  } catch {
    return [];
  }
  return (Array.isArray(r) ? r : r && typeof r == "object" && Array.isArray(r.segments) ? r.segments : []).flatMap((i) => {
    if (!i || typeof i != "object") return [];
    const o = i, a = dn(o.start), s = dn(o.end);
    return a === void 0 || s === void 0 || s <= a ? [] : [{
      start: a,
      end: s,
      delivery: at(o.delivery),
      emotion: at(o.emotion),
      energy: at(o.energy),
      pace: at(o.pace),
      notable: wg(o.notable),
      content: at(o.content),
      shotType: at(o.shotType),
      cutawayCandidate: typeof o.cutawayCandidate == "boolean" ? o.cutawayCandidate : void 0,
      confidence: dn(o.confidence)
    }];
  });
}
function Eg(t) {
  return new Promise((e) => {
    const r = [
      "-i",
      t,
      "-af",
      `silencedetect=noise=${mg}dB:d=${hg}`,
      "-f",
      "null",
      "-"
    ], n = ie(Te(), r);
    let i = "";
    n.stderr.on("data", (o) => {
      i += o.toString();
    }), n.on("error", () => e("")), n.on("close", () => e(i));
  });
}
const Vs = "gemini-2.5-flash", vg = "fal-ai/video-understanding";
async function Tg(t, e) {
  var n;
  const r = ((n = t.model) == null ? void 0 : n.trim()) || Vs;
  try {
    return { rawText: await Rs({
      mediaPath: t.mediaPath,
      prompt: e,
      model: r
    }), model: r };
  } catch (i) {
    if (!(i instanceof _r)) throw i;
    if (!t.apiKey)
      throw new Error("Gemini CLI could not analyze this clip and no fal.ai API key is set for fallback.");
    return { rawText: await ms({
      apiKey: t.apiKey,
      videoPath: t.mediaPath,
      prompt: e,
      detailedAnalysis: !0
    }), model: vg };
  }
}
async function Sg(t) {
  var r;
  const e = {
    assetId: t.assetId,
    status: "failed",
    version: pg,
    model: ((r = t.model) == null ? void 0 : r.trim()) || Vs,
    silenceMap: [],
    segments: [],
    hasSpeech: t.transcript.length > 0,
    sourceDurationSec: t.durationSec
  };
  try {
    const n = await Eg(t.mediaPath).catch(() => ""), i = gg(n), o = yg({ assetName: t.assetName, transcript: t.transcript }), { rawText: a, model: s } = await Tg(t, o), l = bg(a);
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
function Ig() {
  x.handle("acoustic:analyze-asset", async (t, e) => Sg(e));
}
const xg = process.platform === "darwin" && !J.isPackaged;
xg && (J.disableHardwareAcceleration(), J.commandLine.appendSwitch("disable-gpu-compositing"), console.log("[app] hardware acceleration disabled for macOS dev wake stability"));
J.commandLine.appendSwitch("disable-renderer-backgrounding");
J.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
Go.registerSchemesAsPrivileged([
  {
    scheme: "local-media",
    privileges: {
      standard: !0,
      secure: !0,
      supportFetchAPI: !0,
      stream: !0,
      bypassCSP: !0
    }
  }
]);
let ee = null, Ct = null, Z = null, qe = null;
const Ag = Date.now(), Mo = "cinegen-desktop", $o = "CineGen", jg = ".cinegen-user-data-migrated.json", Fo = "CineGen", kg = 700;
process.on("message", (t) => {
  if (t === "electron-vite&type=hot-reload")
    for (const e of Q.getAllWindows())
      e.isDestroyed() || e.webContents.reload();
});
function un(t) {
  for (const e of Q.getAllWindows())
    e.isDestroyed() || e.webContents.send("app:power-event", { type: t });
}
const Rg = {
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
function Og() {
  try {
    const t = J.getPath("appData"), e = w.join(t, Mo), r = w.join(t, $o);
    return J.getPath("userData") !== r && J.setPath("userData", r), console.log("[app] userData path:", r), { preferredUserDataPath: r, legacyUserDataPath: e };
  } catch (t) {
    console.error("[app] failed to configure userData path:", t);
    const e = J.getPath("appData"), r = w.join(e, $o), n = w.join(e, Mo);
    return { preferredUserDataPath: r, legacyUserDataPath: n };
  }
}
const Pg = Og();
try {
  J.setName(Fo), process.platform === "darwin" && J.setAboutPanelOptions({
    applicationName: Fo,
    applicationVersion: J.getVersion(),
    version: J.getVersion()
  });
} catch (t) {
  console.error("[app] failed to configure app display name:", t);
}
async function Ng() {
  const { preferredUserDataPath: t, legacyUserDataPath: e } = Pg;
  if (t === e || !B.existsSync(e)) return;
  const r = w.join(t, jg);
  if (!B.existsSync(r))
    try {
      await R.mkdir(t, { recursive: !0 }), await R.cp(e, t, { recursive: !0, force: !0 }), await R.writeFile(
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
function qg() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    process.cwd(),
    J.getAppPath(),
    process.resourcesPath
  ], r = [];
  for (const n of e)
    for (const i of t) {
      const o = w.join(n, "build", i);
      B.existsSync(o) && r.push(o);
    }
  return r;
}
function Cg(t) {
  const e = w.extname(t).toLowerCase();
  return Rg[e] ?? "application/octet-stream";
}
function Lg(t, e) {
  return t.get(e) ?? t.get(e.toLowerCase()) ?? t.get(e.toUpperCase());
}
function Ug(t, e) {
  var a;
  if (!t.startsWith("bytes=")) return null;
  const r = ((a = t.slice(6).split(",")[0]) == null ? void 0 : a.trim()) ?? "", n = /^(\d*)-(\d*)$/.exec(r);
  if (!n) return null;
  const i = n[1], o = n[2];
  if (!i && o) {
    const s = Number.parseInt(o, 10);
    if (!Number.isFinite(s) || s <= 0) return null;
    const l = Math.max(e - s, 0), d = e - 1;
    return l <= d ? { start: l, end: d } : null;
  }
  if (i) {
    const s = Number.parseInt(i, 10), l = o ? Number.parseInt(o, 10) : e - 1;
    if (!Number.isFinite(s) || !Number.isFinite(l)) return null;
    const d = Math.min(l, e - 1);
    return s < 0 || d < s || s >= e ? null : { start: s, end: d };
  }
  return null;
}
function Dg(t) {
  const e = new URL(t);
  if (e.hostname !== "file") return null;
  let r = decodeURIComponent(e.pathname);
  return process.platform === "win32" && r.startsWith("/") && (r = r.slice(1)), w.normalize(r);
}
async function Mg() {
  var n, i, o, a;
  const t = w.join(process.cwd(), ".data", "dev", "project.json"), e = w.join(W.homedir(), "Documents", "CINEGEN"), r = w.join(e, "projects.json");
  try {
    await R.access(t);
  } catch {
    return;
  }
  try {
    await R.access(r);
    return;
  } catch {
  }
  try {
    const s = await R.readFile(t, "utf-8"), l = JSON.parse(s), d = ((n = l.project) == null ? void 0 : n.id) || X.randomUUID(), u = ((i = l.project) == null ? void 0 : i.name) || "Migrated Project";
    await R.mkdir(w.join(e, d), { recursive: !0 }), await R.writeFile(
      w.join(e, d, "project.json"),
      JSON.stringify(l, null, 2),
      "utf-8"
    );
    const c = {
      projects: [{
        id: d,
        name: u,
        createdAt: ((o = l.project) == null ? void 0 : o.createdAt) || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: ((a = l.project) == null ? void 0 : a.updatedAt) || (/* @__PURE__ */ new Date()).toISOString(),
        assetCount: Array.isArray(l.assets) ? l.assets.length : 0,
        elementCount: Array.isArray(l.elements) ? l.elements.length : 0,
        thumbnail: null
      }]
    };
    await R.writeFile(r, JSON.stringify(c, null, 2), "utf-8"), console.log(`[migration] Migrated legacy project "${u}" to ${e}/${d}`);
  } catch (s) {
    console.error("[migration] Failed to migrate legacy data:", s);
  }
}
J.whenReady().then(async () => {
  if (await Ng(), process.platform === "darwin") {
    const r = qg();
    console.log("[dock] icon candidates:", r);
    for (const n of r)
      try {
        const i = Js.createFromPath(n);
        if (console.log("[dock] testing icon:", n, "empty?", i.isEmpty()), !i.isEmpty()) {
          await Promise.resolve(J.dock.setIcon(i)), console.log("[dock] applied icon:", n);
          break;
        }
      } catch (i) {
        console.error("[dock] failed to apply icon:", n, i);
      }
  }
  Go.handle("local-media", async (r) => {
    try {
      const n = Dg(r.url);
      if (!n)
        return new Response("Invalid local-media host", { status: 400 });
      const i = await R.stat(n);
      if (!i.isFile())
        return new Response("Not a file", { status: 404 });
      const o = i.size, a = Cg(n), s = Lg(r.headers, "range");
      if (r.method.toUpperCase() === "HEAD")
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": a,
            "Content-Length": String(o),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      if (s) {
        const u = Ug(s, o);
        if (!u)
          return new Response("Invalid Range", { status: 416 });
        const c = u.start, p = u.end;
        if (c < 0 || p < c || c >= o)
          return new Response("Range Not Satisfiable", {
            status: 416,
            headers: {
              "Content-Range": `bytes */${o}`
            }
          });
        const f = p - c + 1, m = B.createReadStream(n, { start: c, end: p }), y = fi.toWeb(m);
        return new Response(y, {
          status: 206,
          headers: {
            "Content-Type": a,
            "Content-Length": String(f),
            "Content-Range": `bytes ${c}-${p}/${o}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }
      const l = B.createReadStream(n), d = fi.toWeb(l);
      return new Response(d, {
        status: 200,
        headers: {
          "Content-Type": a,
          "Content-Length": String(o),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      });
    } catch (n) {
      return console.error("[local-media] Failed request:", r.url, n), new Response("Invalid local-media URL", { status: 400 });
    }
  }), pl(), jc(), Xd(), $c(), pf(), yf(), bf(), Pf(), yp(), Op(), Cp(), Hp(), om(), vm(), Im(), xm(), rh(), hh(), yh(we), Wf(), fg(), Ig(), Ih(), Gh(), tg(), lg(), await Mg(), x.handle("pm:open-project", async (r, n, i) => n === "__close__" ? (Z == null || Z.close(), Z = null, { ok: !0 }) : ((!ee || ee.isDestroyed()) && (ee = gi()), ee.once("ready-to-show", () => {
    ee == null || ee.maximize(), ee == null || ee.show(), ee == null || ee.webContents.send("pm:open-project", n, i);
  }), ee.webContents.getURL() !== "" && (ee.maximize(), ee.show(), ee.webContents.send("pm:open-project", n, i)), Z == null || Z.close(), Z = null, { ok: !0 })), x.handle("pm:open", async () => Z && !Z.isDestroyed() ? (Z.focus(), { ok: !0 }) : (Z = Hr(), Z.on("closed", () => {
    Z = null;
  }), { ok: !0 })), Ct = dl(), ee = gi();
  const t = 3e3;
  ee.once("ready-to-show", () => {
    const r = Date.now() - Ag, n = Math.max(0, t - r);
    setTimeout(() => {
      Ct == null || Ct.close(), Ct = null, Z = Hr(), Z.on("closed", () => {
        Z = null;
      });
    }, n);
  }), J.on("activate", () => {
    Q.getAllWindows().length === 0 && (Z = Hr(), Z.on("closed", () => {
      Z = null;
    }));
  });
  const e = (r) => {
    qe && (clearTimeout(qe), qe = null), qe = setTimeout(() => {
      qe = null, console.log(`[app] Wake recovery triggered by ${r}`), ll(r);
    }, kg);
  };
  Fr.on("resume", () => {
    un("resume"), e("resume");
  }), Fr.on("unlock-screen", () => {
    un("unlock-screen"), e("unlock-screen");
  }), Fr.on("suspend", () => {
    un("suspend");
  });
});
J.on("before-quit", () => {
  qe && (clearTimeout(qe), qe = null), gh(), nh(), dg();
});
J.on("window-all-closed", () => {
  process.platform !== "darwin" && J.quit();
});
export {
  ay as H
};
