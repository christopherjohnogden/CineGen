var wo = Object.defineProperty;
var Eo = (t, e, n) => e in t ? wo(t, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : t[e] = n;
var D = (t, e, n) => Eo(t, typeof e != "symbol" ? e + "" : e, n);
import { BrowserWindow as Y, screen as ni, ipcMain as R, app as X, dialog as er, shell as _o, protocol as ri, nativeImage as To, powerMonitor as sn } from "electron";
import L, { mkdir as Dt } from "node:fs/promises";
import B from "node:fs";
import _ from "node:path";
import W from "node:os";
import G, { randomUUID as tr } from "node:crypto";
import { Readable as nr } from "node:stream";
import ii from "better-sqlite3";
import { spawn as ne, execFile as vt } from "node:child_process";
import { createRequire as oi } from "node:module";
import { fileURLToPath as Cn } from "node:url";
import { promisify as Un } from "node:util";
import { Worker as si } from "worker_threads";
import vo from "node:net";
const bo = 1200, So = 150, xo = 1e3, rr = 2800, ai = /* @__PURE__ */ new WeakMap(), ci = /* @__PURE__ */ new WeakMap(), Mt = /* @__PURE__ */ new WeakMap(), li = /* @__PURE__ */ new WeakMap();
function Io() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    ...t.map((n) => _.resolve(process.cwd(), "build", n)),
    ...t.map((n) => _.resolve(import.meta.dirname, "../build", n))
  ];
  for (const n of e)
    if (B.existsSync(n)) return n;
}
const Je = Io(), zt = _.join(import.meta.dirname, "."), ui = _.join(zt, "../dist"), bt = process.env.VITE_DEV_SERVER_URL;
function ir(t) {
  return bt ? t.loadURL(`${bt}?pm=1`) : t.loadFile(_.join(ui, "index.html"), { query: { pm: "1" } });
}
function or(t) {
  return bt ? t.loadURL(bt) : t.loadFile(_.join(ui, "index.html"));
}
function an(t, e) {
  const n = Mt.get(t) ?? /* @__PURE__ */ new Set();
  n.add(e), Mt.set(t, n);
}
function Rt(t, e) {
  var n;
  (n = Mt.get(t)) == null || n.delete(e);
}
function di(t) {
  const e = Mt.get(t);
  if (e) {
    for (const n of e)
      clearTimeout(n);
    e.clear();
  }
}
function Ao(t) {
  return new Promise((e, n) => {
    let r = !1;
    const i = () => {
      t.webContents.removeListener("did-finish-load", o), t.webContents.removeListener("did-fail-load", s);
    }, o = () => {
      r || (r = !0, i(), e());
    }, s = (c, a, u, l, d) => {
      r || !d || a === -3 || (r = !0, i(), n(new Error(`did-fail-load ${a}: ${u}`)));
    };
    t.webContents.on("did-finish-load", o), t.webContents.on("did-fail-load", s), t.webContents.reloadIgnoringCache();
  });
}
async function _n(t, e, n, r) {
  if (t.isDestroyed()) return;
  if (console.warn(`[window] ${e} reloading after wake: ${r}`), t.webContents.getURL()) {
    await Ao(t);
    return;
  }
  await n(t);
}
async function Ro(t, e, n) {
  if (!t.isDestroyed())
    try {
      const r = await t.webContents.executeJavaScript(
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
      if (!(!(r != null && r.hasRoot) && (r == null ? void 0 : r.bodyChildren) === 0 && (r == null ? void 0 : r.bodyTextLength) === 0)) return;
      await _n(t, e, n, "blank renderer DOM after resume");
    } catch (r) {
      console.warn(`[window] ${e} health check failed after wake:`, r), await _n(t, e, n, "resume health check failed");
    }
}
function No(t) {
  for (const e of Y.getAllWindows()) {
    if (e.isDestroyed()) continue;
    const n = ai.get(e);
    if (!n) continue;
    const r = ci.get(e) ?? "window";
    di(e), li.set(e, Date.now() + rr + 1e3);
    let i = null;
    const o = setTimeout(() => {
      Rt(e, o), !e.isDestroyed() && (console.log(`[window] ${r} wake recovery started: ${t}`), e.webContents.invalidate(), e.webContents.executeJavaScript(
        `(() => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
        !0
      ).catch(() => {
      }), e.isVisible() && (e.show(), e.focus()));
    }, So);
    an(e, o);
    const s = setTimeout(() => {
      Rt(e, s), (async () => {
        try {
          await Ro(e, r, n), i && (clearTimeout(i), Rt(e, i), i = null);
        } catch (c) {
          console.warn(`[window] ${r} resume health check threw:`, c);
        }
      })();
    }, xo);
    an(e, s), i = setTimeout(() => {
      Rt(e, i), !e.isDestroyed() && _n(e, r, n, `hard reload after ${t}`).catch((c) => {
        console.error(`[window] ${r} hard reload failed:`, c);
      });
    }, rr), an(e, i);
  }
}
function fi(t, e, n) {
  let r = null;
  ai.set(t, n), ci.set(t, e);
  const i = (o) => {
    if (t.isDestroyed() || r) return;
    const s = li.get(t) ?? 0;
    if (o === "window became unresponsive" && Date.now() < s) {
      console.warn(`[window] ${e} suppressing reload during wake recovery: ${o}`);
      return;
    }
    console.warn(`[window] ${e} scheduling reload: ${o}`), r = setTimeout(() => {
      r = null, !t.isDestroyed() && n(t).catch((c) => {
        console.error(`[window] ${e} reload failed:`, c);
      });
    }, bo);
  };
  t.on("unresponsive", () => {
    i("window became unresponsive");
  }), t.on("closed", () => {
    r && (clearTimeout(r), r = null), di(t);
  }), t.webContents.on("render-process-gone", (o, s) => {
    i(`render process gone (${s.reason})`);
  }), t.webContents.on("did-fail-load", (o, s, c, a, u) => {
    !u || s === -3 || i(`did-fail-load ${s}: ${c}`);
  });
}
function cn() {
  const { width: t, height: e } = ni.getPrimaryDisplay().workAreaSize, n = 900, r = 580, i = new Y({
    width: n,
    height: r,
    x: Math.round((t - n) / 2),
    y: Math.round((e - r) / 2),
    frame: !1,
    resizable: !1,
    transparent: !0,
    hasShadow: !0,
    alwaysOnTop: !1,
    skipTaskbar: !1,
    ...Je ? { icon: Je } : {},
    webPreferences: {
      preload: _.join(zt, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return fi(i, "project-manager", ir), ir(i), i;
}
function Oo() {
  const { width: t, height: e } = ni.getPrimaryDisplay().workAreaSize, n = 800, r = 395, i = new Y({
    width: n,
    height: r,
    x: Math.round((t - n) / 2),
    y: Math.round((e - r) / 2),
    frame: !1,
    resizable: !1,
    transparent: !0,
    hasShadow: !1,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    ...Je ? { icon: Je } : {},
    webPreferences: {
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return i.loadFile(_.join(zt, "splash.html")), i;
}
function sr() {
  const t = new Y({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: !1,
    backgroundColor: "#08090c",
    titleBarStyle: "hiddenInset",
    ...Je ? { icon: Je } : {},
    webPreferences: {
      preload: _.join(zt, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return fi(t, "main", or), or(t), bt && t.webContents.openDevTools({ mode: "detach" }), t;
}
function jn() {
  return _.join(W.homedir(), "Documents", "CINEGEN");
}
function Tn() {
  return _.join(jn(), "projects.json");
}
function St(t) {
  return _.join(jn(), t);
}
function Be(t) {
  return _.join(St(t), "project.json");
}
function mi() {
  return G.randomUUID();
}
function pi() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function hi() {
  await L.mkdir(jn(), { recursive: !0 });
}
async function Nt() {
  try {
    const t = await L.readFile(Tn(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function ln(t) {
  await hi();
  const e = Tn() + ".tmp";
  await L.writeFile(e, JSON.stringify(t, null, 2), "utf-8"), await L.rename(e, Tn());
}
function Po(t, e) {
  const n = pi(), r = {
    id: mi(),
    name: "Space 1",
    createdAt: n,
    nodes: [],
    edges: []
  };
  return {
    project: { id: t, name: e, createdAt: n, updatedAt: n },
    workflow: { nodes: [], edges: [] },
    spaces: [r],
    activeSpaceId: r.id,
    openSpaceIds: [r.id],
    sequence: { id: "default", tracks: [{ id: "track-1", name: "Track 1", clips: [] }], duration: 0 },
    assets: [],
    mediaFolders: [],
    exports: [],
    elements: []
  };
}
function ko(t) {
  const e = _.join(St(t), "project.json");
  if (!B.existsSync(e)) return null;
  try {
    const n = B.readFileSync(e, "utf-8"), i = (JSON.parse(n).assets ?? []).find(
      (o) => (o.type === "video" || o.type === "image") && o.thumbnailUrl
    );
    return (i == null ? void 0 : i.thumbnailUrl) ?? null;
  } catch {
    return null;
  }
}
function Co(t) {
  const e = _.join(St(t), "project.db");
  if (!B.existsSync(e)) return null;
  try {
    const n = new ii(e, { readonly: !0 }), r = n.prepare(
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
    if (r != null && r.thumbnail_url)
      return n.close(), `file://${r.thumbnail_url}`;
    const i = n.prepare(
      `SELECT thumbnail_url FROM assets
       WHERE project_id = ?
         AND type IN ('video', 'image')
         AND thumbnail_url IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`
    ).get(t);
    return n.close(), i != null && i.thumbnail_url ? `file://${i.thumbnail_url}` : null;
  } catch {
    return null;
  }
}
function Uo() {
  R.handle("project:list", async () => (await Nt()).projects.map((e) => {
    const n = e.useSqlite ? Co(e.id) : ko(e.id);
    return { ...e, thumbnail: n };
  })), R.handle("project:create", async (t, e) => {
    const n = e.trim();
    if (!n || n.length > 100)
      throw new Error("Project name must be 1-100 characters");
    const r = mi(), i = Po(r, n);
    await hi(), await L.mkdir(St(r), { recursive: !0 });
    const o = Be(r) + ".tmp";
    await L.writeFile(o, JSON.stringify(i, null, 2), "utf-8"), await L.rename(o, Be(r));
    const s = await Nt();
    return s.projects.unshift({
      id: r,
      name: n,
      createdAt: i.project.createdAt,
      updatedAt: i.project.updatedAt,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null
    }), await ln(s), i;
  }), R.handle("project:load", async (t, e) => {
    const n = await L.readFile(Be(e), "utf-8");
    return JSON.parse(n);
  }), R.handle("project:save", async (t, e, n) => {
    let r;
    try {
      const a = await L.readFile(Be(e), "utf-8");
      r = JSON.parse(a);
    } catch {
      throw new Error(`Project ${e} not found`);
    }
    const i = {
      ...r,
      ...n,
      project: {
        ...r.project,
        ...n.project ?? {},
        updatedAt: pi()
      }
    }, o = Be(e) + ".tmp";
    await L.writeFile(o, JSON.stringify(i, null, 2), "utf-8"), await L.rename(o, Be(e));
    const s = await Nt(), c = s.projects.find((a) => a.id === e);
    return c && (c.updatedAt = i.project.updatedAt, c.assetCount = Array.isArray(i.assets) ? i.assets.length : 0, c.elementCount = Array.isArray(i.elements) ? i.elements.length : 0, n.project && n.project.name && (c.name = n.project.name), await ln(s)), i;
  }), R.handle("project:delete", async (t, e) => {
    await L.rm(St(e), { recursive: !0, force: !0 });
    const n = await Nt();
    n.projects = n.projects.filter((r) => r.id !== e), await ln(n);
  });
}
function jo(t) {
  if (Object.prototype.hasOwnProperty.call(t, "__esModule")) return t;
  var e = t.default;
  if (typeof e == "function") {
    var n = function r() {
      return this instanceof r ? Reflect.construct(e, arguments, this.constructor) : e.apply(this, arguments);
    };
    n.prototype = e.prototype;
  } else n = {};
  return Object.defineProperty(n, "__esModule", { value: !0 }), Object.keys(t).forEach(function(r) {
    var i = Object.getOwnPropertyDescriptor(t, r);
    Object.defineProperty(n, r, i.get ? i : {
      enumerable: !0,
      get: function() {
        return t[r];
      }
    });
  }), n;
}
var De = {}, He = {}, un = {}, it = {}, ar;
function gi() {
  return ar || (ar = 1, (function(t) {
    var e = it && it.__awaiter || function(i, o, s, c) {
      function a(u) {
        return u instanceof s ? u : new s(function(l) {
          l(u);
        });
      }
      return new (s || (s = Promise))(function(u, l) {
        function d(g) {
          try {
            f(c.next(g));
          } catch (y) {
            l(y);
          }
        }
        function m(g) {
          try {
            f(c.throw(g));
          } catch (y) {
            l(y);
          }
        }
        function f(g) {
          g.done ? u(g.value) : a(g.value).then(d, m);
        }
        f((c = c.apply(i, o || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.TARGET_URL_HEADER = void 0, t.withMiddleware = n, t.withProxy = r;
    function n(...i) {
      const o = (s) => typeof s == "function";
      return (s) => e(this, void 0, void 0, function* () {
        let c = Object.assign({}, s);
        for (const a of i.filter(o))
          c = yield a(c);
        return c;
      });
    }
    t.TARGET_URL_HEADER = "x-fal-target-url";
    function r(i) {
      const o = (s) => Promise.resolve(s);
      return typeof window > "u" ? o : (s) => s.headers && t.TARGET_URL_HEADER in s ? o(s) : Promise.resolve(Object.assign(Object.assign({}, s), { url: i.targetUrl, headers: Object.assign(Object.assign({}, s.headers || {}), { [t.TARGET_URL_HEADER]: s.url }) }));
    }
  })(it)), it;
}
var pe = {}, dn = {}, cr;
function Ln() {
  return cr || (cr = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.RUNNER_HINT_HEADER = t.QUEUE_PRIORITY_HEADER = t.REQUEST_TIMEOUT_TYPE_HEADER = t.REQUEST_TIMEOUT_HEADER = t.MIN_REQUEST_TIMEOUT_SECONDS = void 0, t.validateTimeoutHeader = e, t.buildTimeoutHeaders = n, t.MIN_REQUEST_TIMEOUT_SECONDS = 1, t.REQUEST_TIMEOUT_HEADER = "x-fal-request-timeout", t.REQUEST_TIMEOUT_TYPE_HEADER = "x-fal-request-timeout-type", t.QUEUE_PRIORITY_HEADER = "x-fal-queue-priority", t.RUNNER_HINT_HEADER = "x-fal-runner-hint";
    function e(r) {
      if (typeof r != "number" || isNaN(r))
        throw new Error(`Timeout must be a number, got ${r}`);
      if (r <= t.MIN_REQUEST_TIMEOUT_SECONDS)
        throw new Error(`Timeout must be greater than ${t.MIN_REQUEST_TIMEOUT_SECONDS} seconds`);
      return r.toString();
    }
    function n(r) {
      return r === void 0 ? {} : {
        [t.REQUEST_TIMEOUT_HEADER]: e(r)
      };
    }
  })(dn)), dn;
}
var lr;
function $e() {
  if (lr) return pe;
  lr = 1;
  var t = pe && pe.__awaiter || function(c, a, u, l) {
    function d(m) {
      return m instanceof u ? m : new u(function(f) {
        f(m);
      });
    }
    return new (u || (u = Promise))(function(m, f) {
      function g(p) {
        try {
          h(l.next(p));
        } catch (w) {
          f(w);
        }
      }
      function y(p) {
        try {
          h(l.throw(p));
        } catch (w) {
          f(w);
        }
      }
      function h(p) {
        p.done ? m(p.value) : d(p.value).then(g, y);
      }
      h((l = l.apply(c, a || [])).next());
    });
  };
  Object.defineProperty(pe, "__esModule", { value: !0 }), pe.ValidationError = pe.ApiError = void 0, pe.defaultResponseHandler = o, pe.resultResponseHandler = s;
  const e = Ln(), n = "x-fal-request-id";
  class r extends Error {
    constructor({ message: a, status: u, body: l, requestId: d, timeoutType: m }) {
      super(a), this.name = "ApiError", this.status = u, this.body = l, this.requestId = d || "", this.timeoutType = m;
    }
    /**
     * Returns true if this error was caused by a user-specified timeout
     * (via startTimeout parameter). These errors should NOT be retried.
     */
    get isUserTimeout() {
      return this.status === 504 && this.timeoutType === "user";
    }
  }
  pe.ApiError = r;
  class i extends r {
    constructor(a) {
      super(a), this.name = "ValidationError";
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
    getFieldErrors(a) {
      return this.fieldErrors.filter((u) => u.loc[u.loc.length - 1] === a);
    }
  }
  pe.ValidationError = i;
  function o(c) {
    return t(this, void 0, void 0, function* () {
      var a;
      const { status: u, statusText: l } = c, d = (a = c.headers.get("Content-Type")) !== null && a !== void 0 ? a : "", m = c.headers.get(n) || void 0, f = c.headers.get(e.REQUEST_TIMEOUT_TYPE_HEADER) || void 0;
      if (!c.ok) {
        if (d.includes("application/json")) {
          const g = yield c.json(), y = u === 422 ? i : r;
          throw new y({
            message: g.message || l,
            status: u,
            body: g,
            requestId: m,
            timeoutType: f
          });
        }
        throw new r({
          message: `HTTP ${u}: ${l}`,
          status: u,
          requestId: m,
          timeoutType: f
        });
      }
      return d.includes("application/json") ? c.json() : d.includes("text/html") ? c.text() : d.includes("application/octet-stream") ? c.arrayBuffer() : c.text();
    });
  }
  function s(c) {
    return t(this, void 0, void 0, function* () {
      return {
        data: yield o(c),
        requestId: c.headers.get(n) || ""
      };
    });
  }
  return pe;
}
var ot = {}, ae = {}, ur;
function ke() {
  if (ur) return ae;
  ur = 1;
  var t = ae && ae.__awaiter || function(d, m, f, g) {
    function y(h) {
      return h instanceof f ? h : new f(function(p) {
        p(h);
      });
    }
    return new (f || (f = Promise))(function(h, p) {
      function w(x) {
        try {
          T(g.next(x));
        } catch (b) {
          p(b);
        }
      }
      function E(x) {
        try {
          T(g.throw(x));
        } catch (b) {
          p(b);
        }
      }
      function T(x) {
        x.done ? h(x.value) : y(x.value).then(w, E);
      }
      T((g = g.apply(d, m || [])).next());
    });
  };
  Object.defineProperty(ae, "__esModule", { value: !0 }), ae.ensureEndpointIdFormat = e, ae.parseEndpointId = r, ae.resolveEndpointPath = i, ae.isValidUrl = o, ae.throttle = s, ae.isReact = a, ae.isPlainObject = u, ae.sleep = l;
  function e(d) {
    if (d.split("/").length > 1)
      return d;
    const [, f, g] = /^([0-9]+)-([a-zA-Z0-9-]+)$/.exec(d) || [];
    if (f && g)
      return `${f}/${g}`;
    throw new Error(`Invalid app id: ${d}. Must be in the format <appOwner>/<appId>`);
  }
  const n = ["workflows", "comfy"];
  function r(d) {
    const f = e(d).split("/");
    return n.includes(f[0]) ? {
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
  function i(d, m, f) {
    if (m)
      return `/${m.replace(/^\/+/, "")}`;
    if (!d.endsWith(f))
      return f;
  }
  function o(d) {
    try {
      const { host: m } = new URL(d);
      return /(fal\.(ai|run))$/.test(m);
    } catch {
      return !1;
    }
  }
  function s(d, m, f = !1) {
    let g, y;
    return (...h) => {
      !y && f ? (d(...h), y = Date.now()) : (g && clearTimeout(g), g = setTimeout(() => {
        Date.now() - y >= m && (d(...h), y = Date.now());
      }, m - (Date.now() - y)));
    };
  }
  let c;
  function a() {
    if (c === void 0) {
      const d = new Error().stack;
      c = !!d && (d.includes("node_modules/react-dom/") || d.includes("node_modules/next/"));
    }
    return c;
  }
  function u(d) {
    return !!d && Object.getPrototypeOf(d) === Object.prototype;
  }
  function l(d) {
    return t(this, void 0, void 0, function* () {
      return new Promise((m) => setTimeout(m, d));
    });
  }
  return ae;
}
var dr;
function Xt() {
  return dr || (dr = 1, (function(t) {
    var e = ot && ot.__awaiter || function(c, a, u, l) {
      function d(m) {
        return m instanceof u ? m : new u(function(f) {
          f(m);
        });
      }
      return new (u || (u = Promise))(function(m, f) {
        function g(p) {
          try {
            h(l.next(p));
          } catch (w) {
            f(w);
          }
        }
        function y(p) {
          try {
            h(l.throw(p));
          } catch (w) {
            f(w);
          }
        }
        function h(p) {
          p.done ? m(p.value) : d(p.value).then(g, y);
        }
        h((l = l.apply(c, a || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.DEFAULT_RETRY_OPTIONS = t.DEFAULT_RETRYABLE_STATUS_CODES = void 0, t.isRetryableError = i, t.calculateBackoffDelay = o, t.executeWithRetry = s;
    const n = $e(), r = ke();
    t.DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504], t.DEFAULT_RETRY_OPTIONS = {
      maxRetries: 3,
      baseDelay: 1e3,
      maxDelay: 3e4,
      backoffMultiplier: 2,
      retryableStatusCodes: t.DEFAULT_RETRYABLE_STATUS_CODES,
      enableJitter: !0
    };
    function i(c, a) {
      return !(c instanceof n.ApiError) || c.isUserTimeout ? !1 : a.includes(c.status);
    }
    function o(c, a, u, l, d) {
      const m = Math.min(a * Math.pow(l, c), u);
      if (d) {
        const f = 0.25 * m * (Math.random() * 2 - 1);
        return Math.max(0, m + f);
      }
      return m;
    }
    function s(c, a, u) {
      return e(this, void 0, void 0, function* () {
        const l = {
          totalAttempts: 0,
          totalDelay: 0
        };
        let d;
        for (let m = 0; m <= a.maxRetries; m++) {
          l.totalAttempts++;
          try {
            return { result: yield c(), metrics: l };
          } catch (f) {
            if (d = f, l.lastError = f, m === a.maxRetries || !i(f, a.retryableStatusCodes))
              throw f;
            const g = o(m, a.baseDelay, a.maxDelay, a.backoffMultiplier, a.enableJitter);
            l.totalDelay += g, u && u(m + 1, f, g), yield (0, r.sleep)(g);
          }
        }
        throw d;
      });
    }
  })(ot)), ot;
}
var st = {};
const Lo = "@fal-ai/client", Do = "1.9.4", Mo = {
  name: Lo,
  version: Do
};
var fr;
function Dn() {
  if (fr) return st;
  fr = 1, Object.defineProperty(st, "__esModule", { value: !0 }), st.isBrowser = t, st.getUserAgent = n;
  function t() {
    return typeof window < "u" && typeof window.document < "u";
  }
  let e = null;
  function n() {
    if (e !== null)
      return e;
    const r = Mo;
    return e = `${r.name}/${r.version}`, e;
  }
  return st;
}
var mr;
function Mn() {
  return mr || (mr = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.credentialsFromEnv = void 0, t.resolveDefaultFetch = o, t.createConfig = u, t.getRestApiUrl = l;
    const e = gi(), n = $e(), r = Xt(), i = Dn();
    function o() {
      if (typeof fetch > "u")
        throw new Error("Your environment does not support fetch. Please provide your own fetch implementation.");
      return fetch;
    }
    function s() {
      return typeof process < "u" && process.env && (typeof process.env.FAL_KEY < "u" || typeof process.env.FAL_KEY_ID < "u" && typeof process.env.FAL_KEY_SECRET < "u");
    }
    const c = () => {
      if (s())
        return typeof process.env.FAL_KEY < "u" ? process.env.FAL_KEY : process.env.FAL_KEY_ID ? `${process.env.FAL_KEY_ID}:${process.env.FAL_KEY_SECRET}` : void 0;
    };
    t.credentialsFromEnv = c;
    const a = {
      credentials: t.credentialsFromEnv,
      suppressLocalCredentialsWarning: !1,
      requestMiddleware: (d) => Promise.resolve(d),
      responseHandler: n.defaultResponseHandler,
      retry: r.DEFAULT_RETRY_OPTIONS
    };
    function u(d) {
      var m;
      let f = Object.assign(Object.assign(Object.assign({}, a), d), {
        fetch: (m = d.fetch) !== null && m !== void 0 ? m : o(),
        // Merge retry configuration with defaults
        retry: Object.assign(Object.assign({}, r.DEFAULT_RETRY_OPTIONS), d.retry || {})
      });
      d.proxyUrl && (f = Object.assign(Object.assign({}, f), { requestMiddleware: (0, e.withMiddleware)(f.requestMiddleware, (0, e.withProxy)({ targetUrl: d.proxyUrl })) }));
      const { credentials: g, suppressLocalCredentialsWarning: y } = f, h = typeof g == "function" ? g() : g;
      return (0, i.isBrowser)() && h && !y && console.warn("The fal credentials are exposed in the browser's environment. That's not recommended for production use cases."), f;
    }
    function l() {
      return "https://rest.fal.ai";
    }
  })(un)), un;
}
var Ee = {}, _e = {}, pr;
function It() {
  if (pr) return _e;
  pr = 1;
  var t = _e && _e.__awaiter || function(a, u, l, d) {
    function m(f) {
      return f instanceof l ? f : new l(function(g) {
        g(f);
      });
    }
    return new (l || (l = Promise))(function(f, g) {
      function y(w) {
        try {
          p(d.next(w));
        } catch (E) {
          g(E);
        }
      }
      function h(w) {
        try {
          p(d.throw(w));
        } catch (E) {
          g(E);
        }
      }
      function p(w) {
        w.done ? f(w.value) : m(w.value).then(y, h);
      }
      p((d = d.apply(a, u || [])).next());
    });
  }, e = _e && _e.__rest || function(a, u) {
    var l = {};
    for (var d in a) Object.prototype.hasOwnProperty.call(a, d) && u.indexOf(d) < 0 && (l[d] = a[d]);
    if (a != null && typeof Object.getOwnPropertySymbols == "function")
      for (var m = 0, d = Object.getOwnPropertySymbols(a); m < d.length; m++)
        u.indexOf(d[m]) < 0 && Object.prototype.propertyIsEnumerable.call(a, d[m]) && (l[d[m]] = a[d[m]]);
    return l;
  };
  Object.defineProperty(_e, "__esModule", { value: !0 }), _e.dispatchRequest = s, _e.buildUrl = c;
  const n = Xt(), r = Dn(), i = ke(), o = typeof navigator < "u" && (navigator == null ? void 0 : navigator.userAgent) === "Cloudflare-Workers";
  function s(a) {
    return t(this, void 0, void 0, function* () {
      var u;
      const { targetUrl: l, input: d, config: m, options: f = {} } = a, { credentials: g, requestMiddleware: y, responseHandler: h, fetch: p } = m, w = Object.assign(Object.assign({}, m.retry), f.retry || {}), E = () => t(this, void 0, void 0, function* () {
        var x, b, S;
        const v = (0, r.isBrowser)() ? {} : { "User-Agent": (0, r.getUserAgent)() }, I = typeof g == "function" ? g() : g, { method: O, url: U, headers: M } = yield y({
          method: ((b = (x = a.method) !== null && x !== void 0 ? x : f.method) !== null && b !== void 0 ? b : "post").toUpperCase(),
          url: l,
          headers: a.headers
        }), $ = I ? { Authorization: `Key ${I}` } : {}, H = Object.assign(Object.assign(Object.assign(Object.assign({}, $), { Accept: "application/json", "Content-Type": "application/json" }), v), M ?? {}), { responseHandler: J, retry: N } = f, C = e(f, ["responseHandler", "retry"]), q = yield p(U, Object.assign(Object.assign(Object.assign(Object.assign({}, C), { method: O, headers: Object.assign(Object.assign({}, H), (S = C.headers) !== null && S !== void 0 ? S : {}) }), !o && { mode: "cors" }), { signal: f.signal, body: O.toLowerCase() !== "get" && d ? JSON.stringify(d) : void 0 }));
        return yield (J ?? h)(q);
      });
      let T;
      for (let x = 0; x <= w.maxRetries; x++)
        try {
          return yield E();
        } catch (b) {
          if (T = b, x === w.maxRetries || !(0, n.isRetryableError)(b, w.retryableStatusCodes) || ((u = f.signal) === null || u === void 0 ? void 0 : u.aborted))
            throw b;
          const v = (0, n.calculateBackoffDelay)(x, w.baseDelay, w.maxDelay, w.backoffMultiplier, w.enableJitter);
          yield (0, i.sleep)(v);
        }
      throw T;
    });
  }
  function c(a, u = {}) {
    var l, d;
    const m = ((l = u.method) !== null && l !== void 0 ? l : "post").toLowerCase(), f = ((d = u.path) !== null && d !== void 0 ? d : "").replace(/^\//, "").replace(/\/{2,}/, "/"), g = u.input, y = Object.assign(Object.assign({}, u.query || {}), m === "get" ? g : {}), h = Object.keys(y).length > 0 ? `?${new URLSearchParams(y).toString()}` : "";
    if ((0, i.isValidUrl)(a))
      return `${a.endsWith("/") ? a : `${a}/`}${f}${h}`;
    const p = (0, i.ensureEndpointIdFormat)(a);
    return `${`https://${u.subdomain ? `${u.subdomain}.` : ""}fal.run/${p}/${f}`.replace(/\/$/, "")}${h}`;
  }
  return _e;
}
var at = {}, hr;
function yi() {
  return hr || (hr = 1, (function(t) {
    var e = at && at.__awaiter || function(g, y, h, p) {
      function w(E) {
        return E instanceof h ? E : new h(function(T) {
          T(E);
        });
      }
      return new (h || (h = Promise))(function(E, T) {
        function x(v) {
          try {
            S(p.next(v));
          } catch (I) {
            T(I);
          }
        }
        function b(v) {
          try {
            S(p.throw(v));
          } catch (I) {
            T(I);
          }
        }
        function S(v) {
          v.done ? E(v.value) : w(v.value).then(x, b);
        }
        S((p = p.apply(g, y || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = void 0, t.getExpirationDurationSeconds = s, t.buildObjectLifecycleHeaders = c, t.createStorageClient = f;
    const n = Mn(), r = It(), i = ke();
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
    function s(g) {
      const { expiresIn: y } = g;
      return typeof y == "number" ? y : o[y];
    }
    function c(g) {
      if (!g)
        return {};
      const y = s(g);
      return y === void 0 ? {} : {
        [t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER]: JSON.stringify({
          expiration_duration_seconds: y
        })
      };
    }
    function a(g) {
      var y;
      const [, h] = g.split("/");
      return (y = h.split(/[-;]/)[0]) !== null && y !== void 0 ? y : "bin";
    }
    function u(g, y, h, p) {
      return e(this, void 0, void 0, function* () {
        const w = g.name || `${Date.now()}.${a(h)}`, E = {};
        if (p) {
          const T = {
            expiration_duration_seconds: s(p),
            allow_io_storage: p.expiresIn !== "immediate"
          };
          E["X-Fal-Object-Lifecycle"] = JSON.stringify(T);
        }
        return yield (0, r.dispatchRequest)({
          method: "POST",
          // NOTE: We want to test V3 without making it the default at the API level
          targetUrl: `${(0, n.getRestApiUrl)()}/storage/upload/initiate?storage_type=fal-cdn-v3`,
          input: {
            content_type: h,
            file_name: w
          },
          config: y,
          headers: E
        });
      });
    }
    function l(g, y, h, p) {
      return e(this, void 0, void 0, function* () {
        const w = g.name || `${Date.now()}.${a(h)}`, E = {};
        return p && (E["X-Fal-Object-Lifecycle"] = JSON.stringify(p)), yield (0, r.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, n.getRestApiUrl)()}/storage/upload/initiate-multipart?storage_type=fal-cdn-v3`,
          input: {
            content_type: h,
            file_name: w
          },
          config: y,
          headers: E
        });
      });
    }
    function d(g, y, h) {
      return e(this, arguments, void 0, function* (p, w, E, T = 3) {
        if (T === 0)
          throw new Error("Part upload failed, retries exhausted");
        const { fetch: x, responseHandler: b } = E;
        try {
          const S = yield x(p, {
            method: "PUT",
            body: w
          });
          return yield b(S);
        } catch {
          return yield d(p, w, E, T - 1);
        }
      });
    }
    function m(g, y, h) {
      return e(this, void 0, void 0, function* () {
        const { fetch: p, responseHandler: w } = y, E = g.type || "application/octet-stream", { upload_url: T, file_url: x } = yield l(g, y, E, h), b = 10 * 1024 * 1024, S = Math.ceil(g.size / b), v = new URL(T), I = [];
        for (let M = 0; M < S; M++) {
          const $ = M * b, H = Math.min($ + b, g.size), J = g.slice($, H), N = M + 1, C = `${v.origin}${v.pathname}/${N}${v.search}`;
          I.push(yield d(C, J, y));
        }
        const O = `${v.origin}${v.pathname}/complete${v.search}`, U = yield p(O, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parts: I.map((M) => ({
              partNumber: M.partNumber,
              etag: M.etag
            }))
          })
        });
        return yield w(U), x;
      });
    }
    function f({ config: g }) {
      const y = {
        upload: (h, p) => e(this, void 0, void 0, function* () {
          const w = p == null ? void 0 : p.lifecycle;
          if (h.size > 94371840)
            return yield m(h, g, w);
          const E = h.type || "application/octet-stream", { fetch: T, responseHandler: x } = g, { upload_url: b, file_url: S } = yield u(h, g, E, w), v = yield T(b, {
            method: "PUT",
            body: h,
            headers: {
              "Content-Type": h.type || "application/octet-stream"
            }
          });
          return yield x(v), S;
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformInput: (h) => e(this, void 0, void 0, function* () {
          if (Array.isArray(h))
            return Promise.all(h.map((p) => y.transformInput(p)));
          if (h instanceof Blob)
            return yield y.upload(h);
          if ((0, i.isPlainObject)(h)) {
            const w = Object.entries(h).map((T) => e(this, [T], void 0, function* ([x, b]) {
              return [x, yield y.transformInput(b)];
            })), E = yield Promise.all(w);
            return Object.fromEntries(E);
          }
          return h;
        })
      };
      return y;
    }
  })(at)), at;
}
var de = {}, Ot = {}, gr;
function Fo() {
  if (gr) return Ot;
  gr = 1, Object.defineProperty(Ot, "__esModule", {
    value: !0
  });
  function t(r) {
    let i, o, s, c, a, u, l;
    return d(), {
      feed: m,
      reset: d
    };
    function d() {
      i = !0, o = "", s = 0, c = -1, a = void 0, u = void 0, l = "";
    }
    function m(g) {
      o = o ? o + g : g, i && n(o) && (o = o.slice(e.length)), i = !1;
      const y = o.length;
      let h = 0, p = !1;
      for (; h < y; ) {
        p && (o[h] === `
` && ++h, p = !1);
        let w = -1, E = c, T;
        for (let x = s; w < 0 && x < y; ++x)
          T = o[x], T === ":" && E < 0 ? E = x - h : T === "\r" ? (p = !0, w = x - h) : T === `
` && (w = x - h);
        if (w < 0) {
          s = y - h, c = E;
          break;
        } else
          s = 0, c = -1;
        f(o, h, E, w), h += w + 1;
      }
      h === y ? o = "" : h > 0 && (o = o.slice(h));
    }
    function f(g, y, h, p) {
      if (p === 0) {
        l.length > 0 && (r({
          type: "event",
          id: a,
          event: u || void 0,
          data: l.slice(0, -1)
          // remove trailing newline
        }), l = "", a = void 0), u = void 0;
        return;
      }
      const w = h < 0, E = g.slice(y, y + (w ? p : h));
      let T = 0;
      w ? T = p : g[y + h + 1] === " " ? T = h + 2 : T = h + 1;
      const x = y + T, b = p - T, S = g.slice(x, x + b).toString();
      if (E === "data")
        l += S ? "".concat(S, `
`) : `
`;
      else if (E === "event")
        u = S;
      else if (E === "id" && !S.includes("\0"))
        a = S;
      else if (E === "retry") {
        const v = parseInt(S, 10);
        Number.isNaN(v) || r({
          type: "reconnect-interval",
          value: v
        });
      }
    }
  }
  const e = [239, 187, 191];
  function n(r) {
    return e.every((i, o) => r.charCodeAt(o) === i);
  }
  return Ot.createParser = t, Ot;
}
var ct = {}, yr;
function wi() {
  return yr || (yr = 1, (function(t) {
    var e = ct && ct.__awaiter || function(s, c, a, u) {
      function l(d) {
        return d instanceof a ? d : new a(function(m) {
          m(d);
        });
      }
      return new (a || (a = Promise))(function(d, m) {
        function f(h) {
          try {
            y(u.next(h));
          } catch (p) {
            m(p);
          }
        }
        function g(h) {
          try {
            y(u.throw(h));
          } catch (p) {
            m(p);
          }
        }
        function y(h) {
          h.done ? d(h.value) : l(h.value).then(f, g);
        }
        y((u = u.apply(s, c || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.TOKEN_EXPIRATION_SECONDS = void 0, t.getTemporaryAuthToken = o;
    const n = Mn(), r = It(), i = ke();
    t.TOKEN_EXPIRATION_SECONDS = 120;
    function o(s, c) {
      return e(this, void 0, void 0, function* () {
        const a = (0, i.parseEndpointId)(s), u = yield (0, r.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, n.getRestApiUrl)()}/tokens/`,
          config: c,
          input: {
            allowed_apps: [a.alias],
            token_expiration: t.TOKEN_EXPIRATION_SECONDS
          }
        });
        return typeof u != "string" && u.detail ? u.detail : u;
      });
    }
  })(ct)), ct;
}
var wr;
function Ei() {
  if (wr) return de;
  wr = 1;
  var t = de && de.__awaiter || function(m, f, g, y) {
    function h(p) {
      return p instanceof g ? p : new g(function(w) {
        w(p);
      });
    }
    return new (g || (g = Promise))(function(p, w) {
      function E(b) {
        try {
          x(y.next(b));
        } catch (S) {
          w(S);
        }
      }
      function T(b) {
        try {
          x(y.throw(b));
        } catch (S) {
          w(S);
        }
      }
      function x(b) {
        b.done ? p(b.value) : h(b.value).then(E, T);
      }
      x((y = y.apply(m, f || [])).next());
    });
  }, e = de && de.__await || function(m) {
    return this instanceof e ? (this.v = m, this) : new e(m);
  }, n = de && de.__asyncGenerator || function(m, f, g) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var y = g.apply(m, f || []), h, p = [];
    return h = {}, E("next"), E("throw"), E("return", w), h[Symbol.asyncIterator] = function() {
      return this;
    }, h;
    function w(I) {
      return function(O) {
        return Promise.resolve(O).then(I, S);
      };
    }
    function E(I, O) {
      y[I] && (h[I] = function(U) {
        return new Promise(function(M, $) {
          p.push([I, U, M, $]) > 1 || T(I, U);
        });
      }, O && (h[I] = O(h[I])));
    }
    function T(I, O) {
      try {
        x(y[I](O));
      } catch (U) {
        v(p[0][3], U);
      }
    }
    function x(I) {
      I.value instanceof e ? Promise.resolve(I.value.v).then(b, S) : v(p[0][2], I);
    }
    function b(I) {
      T("next", I);
    }
    function S(I) {
      T("throw", I);
    }
    function v(I, O) {
      I(O), p.shift(), p.length && T(p[0][0], p[0][1]);
    }
  };
  Object.defineProperty(de, "__esModule", { value: !0 }), de.FalStream = void 0, de.createStreamingClient = d;
  const r = /* @__PURE__ */ Fo(), i = wi(), o = It(), s = $e(), c = ke(), a = "text/event-stream", u = 15 * 1e3;
  class l {
    constructor(f, g, y) {
      var h;
      this.listeners = /* @__PURE__ */ new Map(), this.buffer = [], this.currentData = void 0, this.lastEventTimestamp = 0, this.streamClosed = !1, this._requestId = null, this.abortController = new AbortController(), this.start = () => t(this, void 0, void 0, function* () {
        var p, w, E;
        const { endpointId: T, options: x } = this, { input: b, method: S = "post", connectionMode: v = "server", tokenProvider: I } = x;
        try {
          if (v === "client") {
            const O = (0, c.ensureEndpointIdFormat)(T), U = (p = (0, c.resolveEndpointPath)(T, void 0, "/stream")) !== null && p !== void 0 ? p : "", $ = yield (I ? () => I(`${O}${U}`) : () => (console.warn('[fal.stream] Using the default token provider is deprecated. Please provide a `tokenProvider` function when using `connectionMode: "client"`. See https://docs.fal.ai/fal-client/authentication for more information.'), (0, i.getTemporaryAuthToken)(T, this.config)))(), { fetch: H } = this.config, J = new URL(this.url);
            J.searchParams.set("fal_jwt_token", $);
            const N = yield H(J.toString(), {
              method: S.toUpperCase(),
              headers: {
                accept: (w = x.accept) !== null && w !== void 0 ? w : a,
                "content-type": "application/json"
              },
              body: b && S !== "get" ? JSON.stringify(b) : void 0,
              signal: this.abortController.signal
            });
            return this._requestId = N.headers.get("x-fal-request-id"), yield this.handleResponse(N);
          }
          return yield (0, o.dispatchRequest)({
            method: S.toUpperCase(),
            targetUrl: this.url,
            input: b,
            config: this.config,
            options: {
              headers: {
                accept: (E = x.accept) !== null && E !== void 0 ? E : a
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
      }), this.handleResponse = (p) => t(this, void 0, void 0, function* () {
        var w, E;
        if (!p.ok) {
          try {
            yield (0, s.defaultResponseHandler)(p);
          } catch (U) {
            this.emit("error", U);
          }
          return;
        }
        const T = p.body;
        if (!T) {
          this.emit("error", new s.ApiError({
            message: "Response body is empty.",
            status: 400,
            body: void 0,
            requestId: this._requestId || void 0
          }));
          return;
        }
        if (!((w = p.headers.get("content-type")) !== null && w !== void 0 ? w : "").startsWith(a)) {
          const U = T.getReader(), M = () => {
            U.read().then(({ done: $, value: H }) => {
              if ($) {
                this.emit("done", this.currentData);
                return;
              }
              this.buffer.push(H), this.currentData = H, this.emit("data", H), M();
            });
          };
          M();
          return;
        }
        const b = new TextDecoder("utf-8"), S = p.body.getReader(), v = (0, r.createParser)((U) => {
          if (U.type === "event") {
            const M = U.data;
            try {
              const $ = JSON.parse(M);
              this.buffer.push($), this.currentData = $, this.emit("data", $), this.emit("message", $);
            } catch ($) {
              this.emit("error", $);
            }
          }
        }), I = (E = this.options.timeout) !== null && E !== void 0 ? E : u, O = () => t(this, void 0, void 0, function* () {
          const { value: U, done: M } = yield S.read();
          this.lastEventTimestamp = Date.now(), v.feed(b.decode(U)), Date.now() - this.lastEventTimestamp > I && this.emit("error", new s.ApiError({
            message: `Event stream timed out after ${(I / 1e3).toFixed(0)} seconds with no messages.`,
            status: 408,
            requestId: this._requestId || void 0
          })), M ? this.emit("done", this.currentData) : O().catch(this.handleError);
        });
        O().catch(this.handleError);
      }), this.handleError = (p) => {
        var w;
        if (p.name === "AbortError" || this.signal.aborted)
          return;
        const E = p instanceof s.ApiError ? p : new s.ApiError({
          message: (w = p.message) !== null && w !== void 0 ? w : "An unknown error occurred",
          status: 500,
          requestId: this._requestId || void 0
        });
        this.emit("error", E);
      }, this.on = (p, w) => {
        var E;
        this.listeners.has(p) || this.listeners.set(p, []), (E = this.listeners.get(p)) === null || E === void 0 || E.push(w);
      }, this.emit = (p, w) => {
        const E = this.listeners.get(p) || [];
        for (const T of E)
          T(w);
      }, this.done = () => t(this, void 0, void 0, function* () {
        return this.donePromise;
      }), this.abort = (p) => {
        this.streamClosed || this.abortController.abort(p);
      }, this.endpointId = f, this.config = g, this.url = (h = y.url) !== null && h !== void 0 ? h : (0, o.buildUrl)(f, {
        path: (0, c.resolveEndpointPath)(f, void 0, "/stream"),
        query: y.queryParams
      }), this.options = y, this.donePromise = new Promise((p, w) => {
        this.streamClosed && w(new s.ApiError({
          message: "Streaming connection is already closed.",
          status: 400,
          body: void 0,
          requestId: this._requestId || void 0
        })), this.signal.addEventListener("abort", () => {
          var E;
          p((E = this.currentData) !== null && E !== void 0 ? E : {});
        }), this.on("done", (E) => {
          this.streamClosed = !0, p(E);
        }), this.on("error", (E) => {
          this.streamClosed = !0, w(E);
        });
      }), y.signal && y.signal.addEventListener("abort", () => {
        this.abortController.abort();
      }), this.start().catch(this.handleError);
    }
    [Symbol.asyncIterator]() {
      return n(this, arguments, function* () {
        let g = !0;
        const y = () => g = !1;
        for (this.on("error", y), this.on("done", y); g || this.buffer.length > 0; ) {
          const h = this.buffer.shift();
          h && (yield yield e(h)), yield e(new Promise((p) => setTimeout(p, 16)));
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
  de.FalStream = l;
  function d({ config: m, storage: f }) {
    return {
      stream(g, y) {
        return t(this, void 0, void 0, function* () {
          const h = y.input ? yield f.transformInput(y.input) : void 0;
          return new l(g, m, Object.assign(Object.assign({}, y), { input: h }));
        });
      }
    };
  }
  return de;
}
var Er;
function $o() {
  if (Er) return Ee;
  Er = 1;
  var t = Ee && Ee.__awaiter || function(f, g, y, h) {
    function p(w) {
      return w instanceof y ? w : new y(function(E) {
        E(w);
      });
    }
    return new (y || (y = Promise))(function(w, E) {
      function T(S) {
        try {
          b(h.next(S));
        } catch (v) {
          E(v);
        }
      }
      function x(S) {
        try {
          b(h.throw(S));
        } catch (v) {
          E(v);
        }
      }
      function b(S) {
        S.done ? w(S.value) : p(S.value).then(T, x);
      }
      b((h = h.apply(f, g || [])).next());
    });
  }, e = Ee && Ee.__rest || function(f, g) {
    var y = {};
    for (var h in f) Object.prototype.hasOwnProperty.call(f, h) && g.indexOf(h) < 0 && (y[h] = f[h]);
    if (f != null && typeof Object.getOwnPropertySymbols == "function")
      for (var p = 0, h = Object.getOwnPropertySymbols(f); p < h.length; p++)
        g.indexOf(h[p]) < 0 && Object.prototype.propertyIsEnumerable.call(f, h[p]) && (y[h[p]] = f[h[p]]);
    return y;
  };
  Object.defineProperty(Ee, "__esModule", { value: !0 }), Ee.createQueueClient = void 0;
  const n = Ln(), r = It(), i = $e(), o = Xt(), s = yi(), c = Ei(), a = ke(), u = 500, l = {
    maxRetries: 3,
    baseDelay: 1e3,
    maxDelay: 6e4,
    retryableStatusCodes: o.DEFAULT_RETRYABLE_STATUS_CODES
  }, d = {
    maxRetries: 5,
    baseDelay: 1e3,
    maxDelay: 3e4,
    retryableStatusCodes: [...o.DEFAULT_RETRYABLE_STATUS_CODES, 500]
  }, m = ({ config: f, storage: g }) => {
    const y = {
      submit(h, p) {
        return t(this, void 0, void 0, function* () {
          const { webhookUrl: w, priority: E, hint: T, startTimeout: x, headers: b, storageSettings: S } = p, v = e(p, ["webhookUrl", "priority", "hint", "startTimeout", "headers", "storageSettings"]), I = p.input ? yield g.transformInput(p.input) : void 0, O = Object.fromEntries(Object.entries(b ?? {}).map(([U, M]) => [
            U.toLowerCase(),
            M
          ]));
          return (0, r.dispatchRequest)({
            method: p.method,
            targetUrl: (0, r.buildUrl)(h, Object.assign(Object.assign({}, v), { subdomain: "queue", query: w ? { fal_webhook: w } : void 0 })),
            headers: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, O), (0, s.buildObjectLifecycleHeaders)(S)), { [n.QUEUE_PRIORITY_HEADER]: E ?? "normal" }), T && { [n.RUNNER_HINT_HEADER]: T }), (0, n.buildTimeoutHeaders)(x)),
            input: I,
            config: f,
            options: {
              signal: p.abortSignal,
              retry: l
            }
          });
        });
      },
      status(h, p) {
        return t(this, arguments, void 0, function* (w, { requestId: E, logs: T = !1, abortSignal: x }) {
          const b = (0, a.parseEndpointId)(w), S = b.namespace ? `${b.namespace}/` : "";
          return (0, r.dispatchRequest)({
            method: "get",
            targetUrl: (0, r.buildUrl)(`${S}${b.owner}/${b.alias}`, {
              subdomain: "queue",
              query: { logs: T ? "1" : "0" },
              path: `/requests/${E}/status`
            }),
            config: f,
            options: {
              signal: x,
              retry: d
            }
          });
        });
      },
      streamStatus(h, p) {
        return t(this, arguments, void 0, function* (w, { requestId: E, logs: T = !1, connectionMode: x }) {
          const b = (0, a.parseEndpointId)(w), S = b.namespace ? `${b.namespace}/` : "", v = {
            logs: T ? "1" : "0"
          }, I = (0, r.buildUrl)(`${S}${b.owner}/${b.alias}`, {
            subdomain: "queue",
            path: `/requests/${E}/status/stream`,
            query: v
          });
          return new c.FalStream(w, f, {
            url: I,
            method: "get",
            connectionMode: x,
            queryParams: v
          });
        });
      },
      subscribeToStatus(h, p) {
        return t(this, void 0, void 0, function* () {
          const w = p.requestId, E = p.timeout;
          let T;
          const x = () => {
          };
          if (p.mode === "streaming") {
            const b = yield y.streamStatus(h, {
              requestId: w,
              logs: p.logs,
              connectionMode: "connectionMode" in p ? p.connectionMode : void 0
            }), S = [];
            E && (T = setTimeout(() => {
              throw b.abort(), y.cancel(h, { requestId: w }).catch(x), new Error(`Client timed out waiting for the request to complete after ${E}ms`);
            }, E)), b.on("data", (I) => {
              p.onQueueUpdate && ("logs" in I && Array.isArray(I.logs) && I.logs.length > 0 && S.push(...I.logs), p.onQueueUpdate("logs" in I ? Object.assign(Object.assign({}, I), { logs: S }) : I));
            });
            const v = yield b.done();
            return T && clearTimeout(T), v;
          }
          return new Promise((b, S) => {
            var v;
            let I;
            const O = "pollInterval" in p && typeof p.pollInterval == "number" && (v = p.pollInterval) !== null && v !== void 0 ? v : u, U = () => {
              T && clearTimeout(T), I && clearTimeout(I);
            };
            E && (T = setTimeout(() => {
              U(), y.cancel(h, { requestId: w }).catch(x), S(new Error(`Client timed out waiting for the request to complete after ${E}ms`));
            }, E));
            const M = () => t(this, void 0, void 0, function* () {
              var $;
              try {
                const H = yield y.status(h, {
                  requestId: w,
                  logs: ($ = p.logs) !== null && $ !== void 0 ? $ : !1,
                  abortSignal: p.abortSignal
                });
                if (p.onQueueUpdate && p.onQueueUpdate(H), H.status === "COMPLETED") {
                  U(), b(H);
                  return;
                }
                I = setTimeout(M, O);
              } catch (H) {
                U(), S(H);
              }
            });
            M().catch(S);
          });
        });
      },
      result(h, p) {
        return t(this, arguments, void 0, function* (w, { requestId: E, abortSignal: T }) {
          const x = (0, a.parseEndpointId)(w), b = x.namespace ? `${x.namespace}/` : "";
          return (0, r.dispatchRequest)({
            method: "get",
            targetUrl: (0, r.buildUrl)(`${b}${x.owner}/${x.alias}`, {
              subdomain: "queue",
              path: `/requests/${E}`
            }),
            config: Object.assign(Object.assign({}, f), { responseHandler: i.resultResponseHandler }),
            options: {
              signal: T,
              retry: l
            }
          });
        });
      },
      cancel(h, p) {
        return t(this, arguments, void 0, function* (w, { requestId: E, abortSignal: T }) {
          const x = (0, a.parseEndpointId)(w), b = x.namespace ? `${x.namespace}/` : "";
          yield (0, r.dispatchRequest)({
            method: "put",
            targetUrl: (0, r.buildUrl)(`${b}${x.owner}/${x.alias}`, {
              subdomain: "queue",
              path: `/requests/${E}/cancel`
            }),
            config: f,
            options: {
              signal: T
            }
          });
        });
      }
    };
    return y;
  };
  return Ee.createQueueClient = m, Ee;
}
var qe = {};
function Bo(t) {
  const e = t.length;
  let n = 0, r = 0;
  for (; r < e; ) {
    let i = t.charCodeAt(r++);
    if ((i & 4294967168) === 0) {
      n++;
      continue;
    } else if ((i & 4294965248) === 0)
      n += 2;
    else {
      if (i >= 55296 && i <= 56319 && r < e) {
        const o = t.charCodeAt(r);
        (o & 64512) === 56320 && (++r, i = ((i & 1023) << 10) + (o & 1023) + 65536);
      }
      (i & 4294901760) === 0 ? n += 3 : n += 4;
    }
  }
  return n;
}
function Ho(t, e, n) {
  const r = t.length;
  let i = n, o = 0;
  for (; o < r; ) {
    let s = t.charCodeAt(o++);
    if ((s & 4294967168) === 0) {
      e[i++] = s;
      continue;
    } else if ((s & 4294965248) === 0)
      e[i++] = s >> 6 & 31 | 192;
    else {
      if (s >= 55296 && s <= 56319 && o < r) {
        const c = t.charCodeAt(o);
        (c & 64512) === 56320 && (++o, s = ((s & 1023) << 10) + (c & 1023) + 65536);
      }
      (s & 4294901760) === 0 ? (e[i++] = s >> 12 & 15 | 224, e[i++] = s >> 6 & 63 | 128) : (e[i++] = s >> 18 & 7 | 240, e[i++] = s >> 12 & 63 | 128, e[i++] = s >> 6 & 63 | 128);
    }
    e[i++] = s & 63 | 128;
  }
}
const qo = new TextEncoder(), Wo = 50;
function zo(t, e, n) {
  qo.encodeInto(t, e.subarray(n));
}
function Xo(t, e, n) {
  t.length > Wo ? zo(t, e, n) : Ho(t, e, n);
}
const Go = 4096;
function _i(t, e, n) {
  let r = e;
  const i = r + n, o = [];
  let s = "";
  for (; r < i; ) {
    const c = t[r++];
    if ((c & 128) === 0)
      o.push(c);
    else if ((c & 224) === 192) {
      const a = t[r++] & 63;
      o.push((c & 31) << 6 | a);
    } else if ((c & 240) === 224) {
      const a = t[r++] & 63, u = t[r++] & 63;
      o.push((c & 31) << 12 | a << 6 | u);
    } else if ((c & 248) === 240) {
      const a = t[r++] & 63, u = t[r++] & 63, l = t[r++] & 63;
      let d = (c & 7) << 18 | a << 12 | u << 6 | l;
      d > 65535 && (d -= 65536, o.push(d >>> 10 & 1023 | 55296), d = 56320 | d & 1023), o.push(d);
    } else
      o.push(c);
    o.length >= Go && (s += String.fromCharCode(...o), o.length = 0);
  }
  return o.length > 0 && (s += String.fromCharCode(...o)), s;
}
const Ko = new TextDecoder(), Jo = 200;
function Vo(t, e, n) {
  const r = t.subarray(e, e + n);
  return Ko.decode(r);
}
function Yo(t, e, n) {
  return n > Jo ? Vo(t, e, n) : _i(t, e, n);
}
class mt {
  constructor(e, n) {
    D(this, "type");
    D(this, "data");
    this.type = e, this.data = n;
  }
}
class ie extends Error {
  constructor(e) {
    super(e);
    const n = Object.create(ie.prototype);
    Object.setPrototypeOf(this, n), Object.defineProperty(this, "name", {
      configurable: !0,
      enumerable: !1,
      value: ie.name
    });
  }
}
const lt = 4294967295;
function Qo(t, e, n) {
  const r = n / 4294967296, i = n;
  t.setUint32(e, r), t.setUint32(e + 4, i);
}
function Ti(t, e, n) {
  const r = Math.floor(n / 4294967296), i = n;
  t.setUint32(e, r), t.setUint32(e + 4, i);
}
function vi(t, e) {
  const n = t.getInt32(e), r = t.getUint32(e + 4);
  return n * 4294967296 + r;
}
function Zo(t, e) {
  const n = t.getUint32(e), r = t.getUint32(e + 4);
  return n * 4294967296 + r;
}
const bi = -1, es = 4294967296 - 1, ts = 17179869184 - 1;
function Si({ sec: t, nsec: e }) {
  if (t >= 0 && e >= 0 && t <= ts)
    if (e === 0 && t <= es) {
      const n = new Uint8Array(4);
      return new DataView(n.buffer).setUint32(0, t), n;
    } else {
      const n = t / 4294967296, r = t & 4294967295, i = new Uint8Array(8), o = new DataView(i.buffer);
      return o.setUint32(0, e << 2 | n & 3), o.setUint32(4, r), i;
    }
  else {
    const n = new Uint8Array(12), r = new DataView(n.buffer);
    return r.setUint32(0, e), Ti(r, 4, t), n;
  }
}
function xi(t) {
  const e = t.getTime(), n = Math.floor(e / 1e3), r = (e - n * 1e3) * 1e6, i = Math.floor(r / 1e9);
  return {
    sec: n + i,
    nsec: r - i * 1e9
  };
}
function Ii(t) {
  if (t instanceof Date) {
    const e = xi(t);
    return Si(e);
  } else
    return null;
}
function Ai(t) {
  const e = new DataView(t.buffer, t.byteOffset, t.byteLength);
  switch (t.byteLength) {
    case 4:
      return { sec: e.getUint32(0), nsec: 0 };
    case 8: {
      const n = e.getUint32(0), r = e.getUint32(4), i = (n & 3) * 4294967296 + r, o = n >>> 2;
      return { sec: i, nsec: o };
    }
    case 12: {
      const n = vi(e, 4), r = e.getUint32(0);
      return { sec: n, nsec: r };
    }
    default:
      throw new ie(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${t.length}`);
  }
}
function Ri(t) {
  const e = Ai(t);
  return new Date(e.sec * 1e3 + e.nsec / 1e6);
}
const ns = {
  type: bi,
  encode: Ii,
  decode: Ri
}, Wt = class Wt {
  constructor() {
    // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
    // this will make type errors a lot more clear
    // eslint-disable-next-line @typescript-eslint/naming-convention
    D(this, "__brand");
    // built-in extensions
    D(this, "builtInEncoders", []);
    D(this, "builtInDecoders", []);
    // custom extensions
    D(this, "encoders", []);
    D(this, "decoders", []);
    this.register(ns);
  }
  register({ type: e, encode: n, decode: r }) {
    if (e >= 0)
      this.encoders[e] = n, this.decoders[e] = r;
    else {
      const i = -1 - e;
      this.builtInEncoders[i] = n, this.builtInDecoders[i] = r;
    }
  }
  tryToEncode(e, n) {
    for (let r = 0; r < this.builtInEncoders.length; r++) {
      const i = this.builtInEncoders[r];
      if (i != null) {
        const o = i(e, n);
        if (o != null) {
          const s = -1 - r;
          return new mt(s, o);
        }
      }
    }
    for (let r = 0; r < this.encoders.length; r++) {
      const i = this.encoders[r];
      if (i != null) {
        const o = i(e, n);
        if (o != null) {
          const s = r;
          return new mt(s, o);
        }
      }
    }
    return e instanceof mt ? e : null;
  }
  decode(e, n, r) {
    const i = n < 0 ? this.builtInDecoders[-1 - n] : this.decoders[n];
    return i ? i(e, n, r) : new mt(n, e);
  }
};
D(Wt, "defaultCodec", new Wt());
let xt = Wt;
function rs(t) {
  return t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer;
}
function vn(t) {
  return t instanceof Uint8Array ? t : ArrayBuffer.isView(t) ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : rs(t) ? new Uint8Array(t) : Uint8Array.from(t);
}
const is = 100, os = 2048;
class Gt {
  constructor(e) {
    D(this, "extensionCodec");
    D(this, "context");
    D(this, "useBigInt64");
    D(this, "maxDepth");
    D(this, "initialBufferSize");
    D(this, "sortKeys");
    D(this, "forceFloat32");
    D(this, "ignoreUndefined");
    D(this, "forceIntegerToFloat");
    D(this, "pos");
    D(this, "view");
    D(this, "bytes");
    D(this, "entered", !1);
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? xt.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.maxDepth = (e == null ? void 0 : e.maxDepth) ?? is, this.initialBufferSize = (e == null ? void 0 : e.initialBufferSize) ?? os, this.sortKeys = (e == null ? void 0 : e.sortKeys) ?? !1, this.forceFloat32 = (e == null ? void 0 : e.forceFloat32) ?? !1, this.ignoreUndefined = (e == null ? void 0 : e.ignoreUndefined) ?? !1, this.forceIntegerToFloat = (e == null ? void 0 : e.forceIntegerToFloat) ?? !1, this.pos = 0, this.view = new DataView(new ArrayBuffer(this.initialBufferSize)), this.bytes = new Uint8Array(this.view.buffer);
  }
  clone() {
    return new Gt({
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
  doEncode(e, n) {
    if (n > this.maxDepth)
      throw new Error(`Too deep objects in depth ${n}`);
    e == null ? this.encodeNil() : typeof e == "boolean" ? this.encodeBoolean(e) : typeof e == "number" ? this.forceIntegerToFloat ? this.encodeNumberAsFloat(e) : this.encodeNumber(e) : typeof e == "string" ? this.encodeString(e) : this.useBigInt64 && typeof e == "bigint" ? this.encodeBigInt64(e) : this.encodeObject(e, n);
  }
  ensureBufferSizeToWrite(e) {
    const n = this.pos + e;
    this.view.byteLength < n && this.resizeBuffer(n * 2);
  }
  resizeBuffer(e) {
    const n = new ArrayBuffer(e), r = new Uint8Array(n), i = new DataView(n);
    r.set(this.bytes), this.view = i, this.bytes = r;
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
    const r = Bo(e);
    this.ensureBufferSizeToWrite(5 + r), this.writeStringHeader(r), Xo(e, this.bytes, this.pos), this.pos += r;
  }
  encodeObject(e, n) {
    const r = this.extensionCodec.tryToEncode(e, this.context);
    if (r != null)
      this.encodeExtension(r);
    else if (Array.isArray(e))
      this.encodeArray(e, n);
    else if (ArrayBuffer.isView(e))
      this.encodeBinary(e);
    else if (typeof e == "object")
      this.encodeMap(e, n);
    else
      throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(e)}`);
  }
  encodeBinary(e) {
    const n = e.byteLength;
    if (n < 256)
      this.writeU8(196), this.writeU8(n);
    else if (n < 65536)
      this.writeU8(197), this.writeU16(n);
    else if (n < 4294967296)
      this.writeU8(198), this.writeU32(n);
    else
      throw new Error(`Too large binary: ${n}`);
    const r = vn(e);
    this.writeU8a(r);
  }
  encodeArray(e, n) {
    const r = e.length;
    if (r < 16)
      this.writeU8(144 + r);
    else if (r < 65536)
      this.writeU8(220), this.writeU16(r);
    else if (r < 4294967296)
      this.writeU8(221), this.writeU32(r);
    else
      throw new Error(`Too large array: ${r}`);
    for (const i of e)
      this.doEncode(i, n + 1);
  }
  countWithoutUndefined(e, n) {
    let r = 0;
    for (const i of n)
      e[i] !== void 0 && r++;
    return r;
  }
  encodeMap(e, n) {
    const r = Object.keys(e);
    this.sortKeys && r.sort();
    const i = this.ignoreUndefined ? this.countWithoutUndefined(e, r) : r.length;
    if (i < 16)
      this.writeU8(128 + i);
    else if (i < 65536)
      this.writeU8(222), this.writeU16(i);
    else if (i < 4294967296)
      this.writeU8(223), this.writeU32(i);
    else
      throw new Error(`Too large map object: ${i}`);
    for (const o of r) {
      const s = e[o];
      this.ignoreUndefined && s === void 0 || (this.encodeString(o), this.doEncode(s, n + 1));
    }
  }
  encodeExtension(e) {
    if (typeof e.data == "function") {
      const r = e.data(this.pos + 6), i = r.length;
      if (i >= 4294967296)
        throw new Error(`Too large extension object: ${i}`);
      this.writeU8(201), this.writeU32(i), this.writeI8(e.type), this.writeU8a(r);
      return;
    }
    const n = e.data.length;
    if (n === 1)
      this.writeU8(212);
    else if (n === 2)
      this.writeU8(213);
    else if (n === 4)
      this.writeU8(214);
    else if (n === 8)
      this.writeU8(215);
    else if (n === 16)
      this.writeU8(216);
    else if (n < 256)
      this.writeU8(199), this.writeU8(n);
    else if (n < 65536)
      this.writeU8(200), this.writeU16(n);
    else if (n < 4294967296)
      this.writeU8(201), this.writeU32(n);
    else
      throw new Error(`Too large extension object: ${n}`);
    this.writeI8(e.type), this.writeU8a(e.data);
  }
  writeU8(e) {
    this.ensureBufferSizeToWrite(1), this.view.setUint8(this.pos, e), this.pos++;
  }
  writeU8a(e) {
    const n = e.length;
    this.ensureBufferSizeToWrite(n), this.bytes.set(e, this.pos), this.pos += n;
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
    this.ensureBufferSizeToWrite(8), Qo(this.view, this.pos, e), this.pos += 8;
  }
  writeI64(e) {
    this.ensureBufferSizeToWrite(8), Ti(this.view, this.pos, e), this.pos += 8;
  }
  writeBigUint64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigUint64(this.pos, e), this.pos += 8;
  }
  writeBigInt64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigInt64(this.pos, e), this.pos += 8;
  }
}
function ss(t, e) {
  return new Gt(e).encodeSharedRef(t);
}
function fn(t) {
  return `${t < 0 ? "-" : ""}0x${Math.abs(t).toString(16).padStart(2, "0")}`;
}
const as = 16, cs = 16;
class ls {
  constructor(e = as, n = cs) {
    D(this, "hit", 0);
    D(this, "miss", 0);
    D(this, "caches");
    D(this, "maxKeyLength");
    D(this, "maxLengthPerKey");
    this.maxKeyLength = e, this.maxLengthPerKey = n, this.caches = [];
    for (let r = 0; r < this.maxKeyLength; r++)
      this.caches.push([]);
  }
  canBeCached(e) {
    return e > 0 && e <= this.maxKeyLength;
  }
  find(e, n, r) {
    const i = this.caches[r - 1];
    e: for (const o of i) {
      const s = o.bytes;
      for (let c = 0; c < r; c++)
        if (s[c] !== e[n + c])
          continue e;
      return o.str;
    }
    return null;
  }
  store(e, n) {
    const r = this.caches[e.length - 1], i = { bytes: e, str: n };
    r.length >= this.maxLengthPerKey ? r[Math.random() * r.length | 0] = i : r.push(i);
  }
  decode(e, n, r) {
    const i = this.find(e, n, r);
    if (i != null)
      return this.hit++, i;
    this.miss++;
    const o = _i(e, n, r), s = Uint8Array.prototype.slice.call(e, n, n + r);
    return this.store(s, o), o;
  }
}
const bn = "array", yt = "map_key", Ni = "map_value", us = (t) => {
  if (typeof t == "string" || typeof t == "number")
    return t;
  throw new ie("The type of key must be string or number but " + typeof t);
};
class ds {
  constructor() {
    D(this, "stack", []);
    D(this, "stackHeadPosition", -1);
  }
  get length() {
    return this.stackHeadPosition + 1;
  }
  top() {
    return this.stack[this.stackHeadPosition];
  }
  pushArrayState(e) {
    const n = this.getUninitializedStateFromPool();
    n.type = bn, n.position = 0, n.size = e, n.array = new Array(e);
  }
  pushMapState(e) {
    const n = this.getUninitializedStateFromPool();
    n.type = yt, n.readCount = 0, n.size = e, n.map = {};
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
    if (e.type === bn) {
      const r = e;
      r.size = 0, r.array = void 0, r.position = 0, r.type = void 0;
    }
    if (e.type === yt || e.type === Ni) {
      const r = e;
      r.size = 0, r.map = void 0, r.readCount = 0, r.type = void 0;
    }
    this.stackHeadPosition--;
  }
  reset() {
    this.stack.length = 0, this.stackHeadPosition = -1;
  }
}
const ut = -1, Fn = new DataView(new ArrayBuffer(0)), fs = new Uint8Array(Fn.buffer);
try {
  Fn.getInt8(0);
} catch (t) {
  if (!(t instanceof RangeError))
    throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
}
const _r = new RangeError("Insufficient data"), ms = new ls();
class Ce {
  constructor(e) {
    D(this, "extensionCodec");
    D(this, "context");
    D(this, "useBigInt64");
    D(this, "rawStrings");
    D(this, "maxStrLength");
    D(this, "maxBinLength");
    D(this, "maxArrayLength");
    D(this, "maxMapLength");
    D(this, "maxExtLength");
    D(this, "keyDecoder");
    D(this, "mapKeyConverter");
    D(this, "totalPos", 0);
    D(this, "pos", 0);
    D(this, "view", Fn);
    D(this, "bytes", fs);
    D(this, "headByte", ut);
    D(this, "stack", new ds());
    D(this, "entered", !1);
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? xt.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.rawStrings = (e == null ? void 0 : e.rawStrings) ?? !1, this.maxStrLength = (e == null ? void 0 : e.maxStrLength) ?? lt, this.maxBinLength = (e == null ? void 0 : e.maxBinLength) ?? lt, this.maxArrayLength = (e == null ? void 0 : e.maxArrayLength) ?? lt, this.maxMapLength = (e == null ? void 0 : e.maxMapLength) ?? lt, this.maxExtLength = (e == null ? void 0 : e.maxExtLength) ?? lt, this.keyDecoder = (e == null ? void 0 : e.keyDecoder) !== void 0 ? e.keyDecoder : ms, this.mapKeyConverter = (e == null ? void 0 : e.mapKeyConverter) ?? us;
  }
  clone() {
    return new Ce({
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
    this.totalPos = 0, this.headByte = ut, this.stack.reset();
  }
  setBuffer(e) {
    const n = vn(e);
    this.bytes = n, this.view = new DataView(n.buffer, n.byteOffset, n.byteLength), this.pos = 0;
  }
  appendBuffer(e) {
    if (this.headByte === ut && !this.hasRemaining(1))
      this.setBuffer(e);
    else {
      const n = this.bytes.subarray(this.pos), r = vn(e), i = new Uint8Array(n.length + r.length);
      i.set(n), i.set(r, n.length), this.setBuffer(i);
    }
  }
  hasRemaining(e) {
    return this.view.byteLength - this.pos >= e;
  }
  createExtraByteError(e) {
    const { view: n, pos: r } = this;
    return new RangeError(`Extra ${n.byteLength - r} of ${n.byteLength} byte(s) found at buffer[${e}]`);
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
      const n = this.doDecodeSync();
      if (this.hasRemaining(1))
        throw this.createExtraByteError(this.pos);
      return n;
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
      let n = !1, r;
      for await (const c of e) {
        if (n)
          throw this.entered = !1, this.createExtraByteError(this.totalPos);
        this.appendBuffer(c);
        try {
          r = this.doDecodeSync(), n = !0;
        } catch (a) {
          if (!(a instanceof RangeError))
            throw a;
        }
        this.totalPos += this.pos;
      }
      if (n) {
        if (this.hasRemaining(1))
          throw this.createExtraByteError(this.totalPos);
        return r;
      }
      const { headByte: i, pos: o, totalPos: s } = this;
      throw new RangeError(`Insufficient data in parsing ${fn(i)} at ${s} (${o} in the current buffer)`);
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
  async *decodeMultiAsync(e, n) {
    if (this.entered) {
      yield* this.clone().decodeMultiAsync(e, n);
      return;
    }
    try {
      this.entered = !0;
      let r = n, i = -1;
      for await (const o of e) {
        if (n && i === 0)
          throw this.createExtraByteError(this.totalPos);
        this.appendBuffer(o), r && (i = this.readArraySize(), r = !1, this.complete());
        try {
          for (; yield this.doDecodeSync(), --i !== 0; )
            ;
        } catch (s) {
          if (!(s instanceof RangeError))
            throw s;
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
      let n;
      if (e >= 224)
        n = e - 256;
      else if (e < 192)
        if (e < 128)
          n = e;
        else if (e < 144) {
          const i = e - 128;
          if (i !== 0) {
            this.pushMapState(i), this.complete();
            continue e;
          } else
            n = {};
        } else if (e < 160) {
          const i = e - 144;
          if (i !== 0) {
            this.pushArrayState(i), this.complete();
            continue e;
          } else
            n = [];
        } else {
          const i = e - 160;
          n = this.decodeString(i, 0);
        }
      else if (e === 192)
        n = null;
      else if (e === 194)
        n = !1;
      else if (e === 195)
        n = !0;
      else if (e === 202)
        n = this.readF32();
      else if (e === 203)
        n = this.readF64();
      else if (e === 204)
        n = this.readU8();
      else if (e === 205)
        n = this.readU16();
      else if (e === 206)
        n = this.readU32();
      else if (e === 207)
        this.useBigInt64 ? n = this.readU64AsBigInt() : n = this.readU64();
      else if (e === 208)
        n = this.readI8();
      else if (e === 209)
        n = this.readI16();
      else if (e === 210)
        n = this.readI32();
      else if (e === 211)
        this.useBigInt64 ? n = this.readI64AsBigInt() : n = this.readI64();
      else if (e === 217) {
        const i = this.lookU8();
        n = this.decodeString(i, 1);
      } else if (e === 218) {
        const i = this.lookU16();
        n = this.decodeString(i, 2);
      } else if (e === 219) {
        const i = this.lookU32();
        n = this.decodeString(i, 4);
      } else if (e === 220) {
        const i = this.readU16();
        if (i !== 0) {
          this.pushArrayState(i), this.complete();
          continue e;
        } else
          n = [];
      } else if (e === 221) {
        const i = this.readU32();
        if (i !== 0) {
          this.pushArrayState(i), this.complete();
          continue e;
        } else
          n = [];
      } else if (e === 222) {
        const i = this.readU16();
        if (i !== 0) {
          this.pushMapState(i), this.complete();
          continue e;
        } else
          n = {};
      } else if (e === 223) {
        const i = this.readU32();
        if (i !== 0) {
          this.pushMapState(i), this.complete();
          continue e;
        } else
          n = {};
      } else if (e === 196) {
        const i = this.lookU8();
        n = this.decodeBinary(i, 1);
      } else if (e === 197) {
        const i = this.lookU16();
        n = this.decodeBinary(i, 2);
      } else if (e === 198) {
        const i = this.lookU32();
        n = this.decodeBinary(i, 4);
      } else if (e === 212)
        n = this.decodeExtension(1, 0);
      else if (e === 213)
        n = this.decodeExtension(2, 0);
      else if (e === 214)
        n = this.decodeExtension(4, 0);
      else if (e === 215)
        n = this.decodeExtension(8, 0);
      else if (e === 216)
        n = this.decodeExtension(16, 0);
      else if (e === 199) {
        const i = this.lookU8();
        n = this.decodeExtension(i, 1);
      } else if (e === 200) {
        const i = this.lookU16();
        n = this.decodeExtension(i, 2);
      } else if (e === 201) {
        const i = this.lookU32();
        n = this.decodeExtension(i, 4);
      } else
        throw new ie(`Unrecognized type byte: ${fn(e)}`);
      this.complete();
      const r = this.stack;
      for (; r.length > 0; ) {
        const i = r.top();
        if (i.type === bn)
          if (i.array[i.position] = n, i.position++, i.position === i.size)
            n = i.array, r.release(i);
          else
            continue e;
        else if (i.type === yt) {
          if (n === "__proto__")
            throw new ie("The key __proto__ is not allowed");
          i.key = this.mapKeyConverter(n), i.type = Ni;
          continue e;
        } else if (i.map[i.key] = n, i.readCount++, i.readCount === i.size)
          n = i.map, r.release(i);
        else {
          i.key = null, i.type = yt;
          continue e;
        }
      }
      return n;
    }
  }
  readHeadByte() {
    return this.headByte === ut && (this.headByte = this.readU8()), this.headByte;
  }
  complete() {
    this.headByte = ut;
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
        throw new ie(`Unrecognized array type byte: ${fn(e)}`);
      }
    }
  }
  pushMapState(e) {
    if (e > this.maxMapLength)
      throw new ie(`Max length exceeded: map length (${e}) > maxMapLengthLength (${this.maxMapLength})`);
    this.stack.pushMapState(e);
  }
  pushArrayState(e) {
    if (e > this.maxArrayLength)
      throw new ie(`Max length exceeded: array length (${e}) > maxArrayLength (${this.maxArrayLength})`);
    this.stack.pushArrayState(e);
  }
  decodeString(e, n) {
    return !this.rawStrings || this.stateIsMapKey() ? this.decodeUtf8String(e, n) : this.decodeBinary(e, n);
  }
  /**
   * @throws {@link RangeError}
   */
  decodeUtf8String(e, n) {
    var o;
    if (e > this.maxStrLength)
      throw new ie(`Max length exceeded: UTF-8 byte length (${e}) > maxStrLength (${this.maxStrLength})`);
    if (this.bytes.byteLength < this.pos + n + e)
      throw _r;
    const r = this.pos + n;
    let i;
    return this.stateIsMapKey() && ((o = this.keyDecoder) != null && o.canBeCached(e)) ? i = this.keyDecoder.decode(this.bytes, r, e) : i = Yo(this.bytes, r, e), this.pos += n + e, i;
  }
  stateIsMapKey() {
    return this.stack.length > 0 ? this.stack.top().type === yt : !1;
  }
  /**
   * @throws {@link RangeError}
   */
  decodeBinary(e, n) {
    if (e > this.maxBinLength)
      throw new ie(`Max length exceeded: bin length (${e}) > maxBinLength (${this.maxBinLength})`);
    if (!this.hasRemaining(e + n))
      throw _r;
    const r = this.pos + n, i = this.bytes.subarray(r, r + e);
    return this.pos += n + e, i;
  }
  decodeExtension(e, n) {
    if (e > this.maxExtLength)
      throw new ie(`Max length exceeded: ext length (${e}) > maxExtLength (${this.maxExtLength})`);
    const r = this.view.getInt8(this.pos + n), i = this.decodeBinary(
      e,
      n + 1
      /* extType */
    );
    return this.extensionCodec.decode(i, r, this.context);
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
    const e = Zo(this.view, this.pos);
    return this.pos += 8, e;
  }
  readI64() {
    const e = vi(this.view, this.pos);
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
function ps(t, e) {
  return new Ce(e).decode(t);
}
function hs(t, e) {
  return new Ce(e).decodeMulti(t);
}
function gs(t) {
  return t[Symbol.asyncIterator] != null;
}
async function* ys(t) {
  const e = t.getReader();
  try {
    for (; ; ) {
      const { done: n, value: r } = await e.read();
      if (n)
        return;
      yield r;
    }
  } finally {
    e.releaseLock();
  }
}
function $n(t) {
  return gs(t) ? t : ys(t);
}
async function ws(t, e) {
  const n = $n(t);
  return new Ce(e).decodeAsync(n);
}
function Es(t, e) {
  const n = $n(t);
  return new Ce(e).decodeArrayStream(n);
}
function _s(t, e) {
  const n = $n(t);
  return new Ce(e).decodeStream(n);
}
const Ts = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecodeError: ie,
  Decoder: Ce,
  EXT_TIMESTAMP: bi,
  Encoder: Gt,
  ExtData: mt,
  ExtensionCodec: xt,
  decode: ps,
  decodeArrayStream: Es,
  decodeAsync: ws,
  decodeMulti: hs,
  decodeMultiStream: _s,
  decodeTimestampExtension: Ri,
  decodeTimestampToTimeSpec: Ai,
  encode: ss,
  encodeDateToTimeSpec: xi,
  encodeTimeSpecToTimestamp: Si,
  encodeTimestampExtension: Ii
}, Symbol.toStringTag, { value: "Module" })), vs = /* @__PURE__ */ jo(Ts);
var ce = {}, Tr;
function bs() {
  if (Tr) return ce;
  Tr = 1, Object.defineProperty(ce, "__esModule", { value: !0 });
  function t(A) {
    return { enumerable: !0, value: A };
  }
  function e(A) {
    return { enumerable: !0, writable: !0, value: A };
  }
  let n = {}, r = () => !0, i = () => ({}), o = (A) => A, s = (A, P, k, j) => A.apply(k, j) && P.apply(k, j), c = (A, P, k, [j, F]) => P.call(k, A.call(k, j, F), F), a = (A, P) => Object.freeze(Object.create(A, P));
  function u(A, P, k) {
    return A.reduce((j, F) => function(...ee) {
      return k(j, F, this, ee);
    }, P);
  }
  function l(A) {
    return a(this, { fn: t(A) });
  }
  let d = {}, m = l.bind(d), f = (A) => m((P, k) => !!~A(P, k) && P), g = {}, y = l.bind(g);
  function h(A, P) {
    return P.filter((k) => A.isPrototypeOf(k));
  }
  function p(A, P, ...k) {
    let j = u(h(g, k).map((ee) => ee.fn), r, s), F = u(h(d, k).map((ee) => ee.fn), o, c);
    return a(this, {
      from: t(A),
      to: t(P),
      guards: t(j),
      reducers: t(F)
    });
  }
  let w = {}, E = {}, T = p.bind(w), x = p.bind(E, null);
  function b(A, P, k) {
    return J(P, A, k, this.immediates) || A;
  }
  function S(A) {
    let P = /* @__PURE__ */ new Map();
    for (let k of A)
      P.has(k.from) || P.set(k.from, []), P.get(k.from).push(k);
    return P;
  }
  let v = { enter: o };
  function I(...A) {
    let P = h(w, A), k = h(E, A), j = {
      final: t(A.length === 0),
      transitions: t(S(P))
    };
    return k.length && (j.immediates = t(k), j.enter = t(b)), a(v, j);
  }
  let O = {
    enter(A, P, k) {
      let j = this.fn.call(P, P.context, k);
      return $.isPrototypeOf(j) ? a(U, {
        machine: t(j),
        transitions: t(this.transitions)
      }).enter(A, P, k) : (j.then((F) => P.send({ type: "done", data: F })).catch((F) => P.send({ type: "error", error: F })), A);
    }
  }, U = {
    enter(A, P, k) {
      if (P.child = q(this.machine, (j) => {
        P.onChange(j), P.child == j && j.machine.state.value.final && (delete P.child, P.send({ type: "done", data: j.context }));
      }, P.context, k), P.child.machine.state.value.final) {
        let j = P.child.context;
        return delete P.child, J(P, A, { type: "done", data: j }, this.transitions.get("done"));
      }
      return A;
    }
  };
  function M(A, ...P) {
    let k = t(S(P));
    return $.isPrototypeOf(A) ? a(U, {
      machine: t(A),
      transitions: k
    }) : a(O, {
      fn: t(A),
      transitions: k
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
  function H(A, P, k = i) {
    return typeof A != "string" && (k = P || i, P = A, A = Object.keys(P)[0]), n._create && n._create(A, P), a($, {
      context: t(k),
      current: t(A),
      states: t(P)
    });
  }
  function J(A, P, k, j) {
    let { context: F } = A;
    for (let { to: ee, guards: we, reducers: oe } of j)
      if (we(F, k)) {
        A.context = oe.call(A, F, k);
        let ve = P.original || P, Qe = a(ve, {
          current: t(ee),
          original: { value: ve }
        });
        return n._onEnter && n._onEnter(P, ee, A.context, F, k), Qe.state.value.enter(Qe, A, k);
      }
  }
  function N(A, P) {
    let k = P.type || P, { machine: j } = A, { value: F, name: ee } = j.state;
    return F.transitions.has(k) ? J(A, j, P, F.transitions.get(k)) || j : (n._send && n._send(k, ee), j);
  }
  let C = {
    send(A) {
      this.machine = N(this, A), this.onChange(this);
    }
  };
  function q(A, P, k, j) {
    let F = Object.create(C, {
      machine: e(A),
      context: e(A.context(k, j)),
      onChange: t(P)
    });
    return F.send = F.send.bind(F), F.machine = F.machine.state.value.enter(F.machine, F, j), F;
  }
  return ce.action = f, ce.createMachine = H, ce.d = n, ce.guard = y, ce.immediate = x, ce.interpret = q, ce.invoke = M, ce.reduce = m, ce.state = I, ce.transition = T, ce;
}
var vr;
function Ss() {
  if (vr) return qe;
  vr = 1;
  var t = qe && qe.__awaiter || function(N, C, q, A) {
    function P(k) {
      return k instanceof q ? k : new q(function(j) {
        j(k);
      });
    }
    return new (q || (q = Promise))(function(k, j) {
      function F(oe) {
        try {
          we(A.next(oe));
        } catch (ve) {
          j(ve);
        }
      }
      function ee(oe) {
        try {
          we(A.throw(oe));
        } catch (ve) {
          j(ve);
        }
      }
      function we(oe) {
        oe.done ? k(oe.value) : P(oe.value).then(F, ee);
      }
      we((A = A.apply(N, C || [])).next());
    });
  };
  Object.defineProperty(qe, "__esModule", { value: !0 }), qe.createRealtimeClient = J;
  const e = vs, n = bs(), r = wi(), i = $e(), o = Dn(), s = ke(), c = () => ({
    enqueuedMessage: void 0
  });
  function a(N) {
    return N.token !== void 0;
  }
  function u(N) {
    return !a(N);
  }
  function l(N, C) {
    return Object.assign(Object.assign({}, N), { enqueuedMessage: C.message });
  }
  function d(N) {
    return N.websocket && N.websocket.readyState === WebSocket.OPEN && N.websocket.close(), Object.assign(Object.assign({}, N), { websocket: void 0 });
  }
  function m(N, C) {
    return N.websocket && N.websocket.readyState === WebSocket.OPEN ? (C.message instanceof Uint8Array || typeof C.message == "string" ? N.websocket.send(C.message) : N.websocket.send((0, e.encode)(C.message)), Object.assign(Object.assign({}, N), { enqueuedMessage: void 0 })) : Object.assign(Object.assign({}, N), { enqueuedMessage: C.message });
  }
  function f(N) {
    return Object.assign(Object.assign({}, N), { token: void 0 });
  }
  function g(N, C) {
    return Object.assign(Object.assign({}, N), { token: C.token });
  }
  function y(N, C) {
    return Object.assign(Object.assign({}, N), { websocket: C.websocket });
  }
  const h = (0, n.createMachine)("idle", {
    idle: (0, n.state)((0, n.transition)("send", "connecting", (0, n.reduce)(l)), (0, n.transition)("expireToken", "idle", (0, n.reduce)(f)), (0, n.transition)("close", "idle", (0, n.reduce)(d))),
    connecting: (0, n.state)((0, n.transition)("connecting", "connecting"), (0, n.transition)("connected", "active", (0, n.reduce)(y)), (0, n.transition)("connectionClosed", "idle", (0, n.reduce)(d)), (0, n.transition)("send", "connecting", (0, n.reduce)(l)), (0, n.transition)("close", "idle", (0, n.reduce)(d)), (0, n.immediate)("authRequired", (0, n.guard)(u))),
    authRequired: (0, n.state)((0, n.transition)("initiateAuth", "authInProgress"), (0, n.transition)("send", "authRequired", (0, n.reduce)(l)), (0, n.transition)("close", "idle", (0, n.reduce)(d))),
    authInProgress: (0, n.state)((0, n.transition)("authenticated", "connecting", (0, n.reduce)(g)), (0, n.transition)("unauthorized", "idle", (0, n.reduce)(f), (0, n.reduce)(d)), (0, n.transition)("send", "authInProgress", (0, n.reduce)(l)), (0, n.transition)("close", "idle", (0, n.reduce)(d))),
    active: (0, n.state)((0, n.transition)("send", "active", (0, n.reduce)(m)), (0, n.transition)("authenticated", "active", (0, n.reduce)(g)), (0, n.transition)("unauthorized", "idle", (0, n.reduce)(f)), (0, n.transition)("connectionClosed", "idle", (0, n.reduce)(d)), (0, n.transition)("close", "idle", (0, n.reduce)(d))),
    failed: (0, n.state)((0, n.transition)("send", "failed"), (0, n.transition)("close", "idle", (0, n.reduce)(d)))
  }, c);
  function p(N, { token: C, maxBuffering: q, path: A }) {
    var P;
    if (q !== void 0 && (q < 1 || q > 60))
      throw new Error("The `maxBuffering` must be between 1 and 60 (inclusive)");
    const k = new URLSearchParams({
      fal_jwt_token: C
    });
    q !== void 0 && k.set("max_buffering", q.toFixed(0));
    const j = (0, s.ensureEndpointIdFormat)(N), F = (P = (0, s.resolveEndpointPath)(N, A, "/realtime")) !== null && P !== void 0 ? P : "";
    return `wss://fal.run/${j}${F}?${k.toString()}`;
  }
  const w = 128;
  function E(N) {
    return N.status === "error" && N.error === "Unauthorized";
  }
  const T = {
    NORMAL_CLOSURE: 1e3
  }, x = /* @__PURE__ */ new Map(), b = /* @__PURE__ */ new Map();
  function S(N, C, q) {
    if (!x.has(N)) {
      const A = (0, n.interpret)(h, q);
      x.set(N, Object.assign(Object.assign({}, A), { throttledSend: C > 0 ? (0, s.throttle)(A.send, C, !0) : A.send }));
    }
    return x.get(N);
  }
  const v = () => {
  }, I = {
    send: v,
    close: v
  };
  function O(N) {
    return N.status !== "error" && N.type !== "x-fal-message" && !U(N);
  }
  function U(N) {
    return N.type === "x-fal-error";
  }
  function M(N) {
    return t(this, void 0, void 0, function* () {
      if (typeof N == "string")
        return JSON.parse(N);
      const C = (q) => t(this, void 0, void 0, function* () {
        return q instanceof Uint8Array ? q : q instanceof Blob ? new Uint8Array(yield q.arrayBuffer()) : new Uint8Array(q);
      });
      return N instanceof ArrayBuffer || N instanceof Uint8Array ? (0, e.decode)(yield C(N)) : N instanceof Blob ? (0, e.decode)(yield C(N)) : N;
    });
  }
  function $(N) {
    return N instanceof Uint8Array ? N : (0, e.encode)(N);
  }
  function H({ data: N, decodeMessage: C, onResult: q, onError: A, send: P }) {
    const k = (j) => {
      if (E(j)) {
        P({
          type: "unauthorized",
          error: new Error("Unauthorized")
        });
        return;
      }
      if (O(j)) {
        q(j);
        return;
      }
      if (U(j)) {
        if (j.error === "TIMEOUT")
          return;
        A(new i.ApiError({
          message: `${j.error}: ${j.reason}`,
          // TODO better error status code
          status: 400,
          body: j
        }));
        return;
      }
    };
    Promise.resolve(C ? C(N) : N).then(k).catch((j) => {
      var F;
      A(new i.ApiError({
        message: (F = j == null ? void 0 : j.message) !== null && F !== void 0 ? F : "Failed to decode realtime message",
        status: 400
      }));
    });
  }
  function J({ config: N }) {
    return {
      connect(C, q) {
        const {
          // if running on React in the server, set clientOnly to true by default
          clientOnly: A = (0, s.isReact)() && !(0, o.isBrowser)(),
          connectionKey: P = crypto.randomUUID(),
          maxBuffering: k,
          path: j,
          throttleInterval: F = w,
          encodeMessage: ee,
          decodeMessage: we,
          tokenProvider: oe,
          tokenExpirationSeconds: ve
        } = q;
        if (A && !(0, o.isBrowser)())
          return I;
        const Qe = ee ?? ((Ue) => $(Ue)), Yt = we ?? ((Ue) => M(Ue));
        let At, Zn, Ze, et = 0;
        b.set(P, {
          decodeMessage: Yt,
          onError: q.onError,
          onResult: q.onResult
        });
        const Qt = () => b.get(P), tt = S(P, F, ({ context: Ue, machine: je, send: be }) => {
          var Zt;
          const { enqueuedMessage: en, token: tn, websocket: nn } = Ue;
          if (Zn = en, je.current === "active" && en && (nn == null ? void 0 : nn.readyState) === WebSocket.OPEN && be({ type: "send", message: en }), je.current === "authRequired" && tn === void 0 && At !== je.current) {
            be({ type: "initiateAuth" }), et++;
            const ge = et, se = (0, s.ensureEndpointIdFormat)(C), me = (Zt = (0, s.resolveEndpointPath)(C, j, "/realtime")) !== null && Zt !== void 0 ? Zt : "", Le = oe ? () => oe(`${se}${me}`) : () => (console.warn("[fal.realtime] Using the default token provider is deprecated. Please provide a `tokenProvider` function to `fal.realtime.connect()`. See https://docs.fal.ai/model-apis/client#client-side-usage-with-token-provider for more information."), (0, r.getTemporaryAuthToken)(C, N)), nt = oe ? ve : r.TOKEN_EXPIRATION_SECONDS, rn = nt !== void 0 ? () => {
              clearTimeout(Ze);
              const rt = Math.round(nt * 0.9 * 1e3);
              Ze = setTimeout(() => {
                ge === et && Le().then((on) => {
                  ge === et && (queueMicrotask(() => {
                    be({ type: "authenticated", token: on });
                  }), rn());
                }).catch(() => {
                  if (ge !== et)
                    return;
                  const on = Math.round(nt * 0.05 * 1e3);
                  Ze = setTimeout(() => {
                    rn();
                  }, on);
                });
              }, rt);
            } : v;
            Le().then((rt) => {
              queueMicrotask(() => {
                be({ type: "authenticated", token: rt });
              }), rn();
            }).catch((rt) => {
              queueMicrotask(() => {
                be({ type: "unauthorized", error: rt });
              });
            });
          }
          if (je.current === "connecting" && At !== je.current && tn !== void 0) {
            const ge = new WebSocket(p(C, { token: tn, maxBuffering: k, path: j }));
            ge.onopen = () => {
              var se, me;
              be({ type: "connected", websocket: ge });
              const Le = (me = (se = tt.context) === null || se === void 0 ? void 0 : se.enqueuedMessage) !== null && me !== void 0 ? me : Zn;
              Le && (ge.send(Qe(Le)), tt.context = Object.assign(Object.assign({}, tt.context), { enqueuedMessage: void 0 }));
            }, ge.onclose = (se) => {
              if (se.code !== T.NORMAL_CLOSURE) {
                const { onError: me = v } = Qt();
                me(new i.ApiError({
                  message: `Error closing the connection: ${se.reason}`,
                  status: se.code
                }));
              }
              be({ type: "connectionClosed", code: se.code });
            }, ge.onerror = (se) => {
              const { onError: me = v } = Qt();
              me(new i.ApiError({ message: "Unknown error", status: 500 }));
            }, ge.onmessage = (se) => {
              const { decodeMessage: me = Yt, onResult: Le, onError: nt = v } = Qt();
              H({
                data: se.data,
                decodeMessage: me,
                onResult: Le,
                onError: nt,
                send: be
              });
            };
          }
          At === "active" && je.current !== "active" && (clearTimeout(Ze), Ze = void 0), At = je.current;
        });
        return {
          send: (Ue) => {
            tt.throttledSend({
              type: "send",
              message: Qe(Ue)
            });
          },
          close: () => {
            tt.send({ type: "close" });
          }
        };
      }
    };
  }
  return qe;
}
var br;
function Sr() {
  if (br) return He;
  br = 1;
  var t = He && He.__awaiter || function(l, d, m, f) {
    function g(y) {
      return y instanceof m ? y : new m(function(h) {
        h(y);
      });
    }
    return new (m || (m = Promise))(function(y, h) {
      function p(T) {
        try {
          E(f.next(T));
        } catch (x) {
          h(x);
        }
      }
      function w(T) {
        try {
          E(f.throw(T));
        } catch (x) {
          h(x);
        }
      }
      function E(T) {
        T.done ? y(T.value) : g(T.value).then(p, w);
      }
      E((f = f.apply(l, d || [])).next());
    });
  };
  Object.defineProperty(He, "__esModule", { value: !0 }), He.createFalClient = u;
  const e = Mn(), n = Ln(), r = $o(), i = Ss(), o = It(), s = $e(), c = yi(), a = Ei();
  function u(l = {}) {
    const d = (0, e.createConfig)(l), m = (0, c.createStorageClient)({ config: d }), f = (0, r.createQueueClient)({ config: d, storage: m }), g = (0, a.createStreamingClient)({ config: d, storage: m }), y = (0, i.createRealtimeClient)({ config: d });
    return {
      queue: f,
      realtime: y,
      storage: m,
      streaming: g,
      stream: g.stream,
      run(h) {
        return t(this, arguments, void 0, function* (p, w = {}) {
          const E = w.input ? yield m.transformInput(w.input) : void 0;
          return (0, o.dispatchRequest)({
            method: w.method,
            targetUrl: (0, o.buildUrl)(p, w),
            input: E,
            // TODO: consider supporting custom headers in fal.run() as well
            headers: Object.assign(Object.assign({}, (0, c.buildObjectLifecycleHeaders)(w.storageSettings)), (0, n.buildTimeoutHeaders)(w.startTimeout)),
            config: Object.assign(Object.assign({}, d), { responseHandler: s.resultResponseHandler }),
            options: {
              signal: w.abortSignal,
              retry: {
                maxRetries: 3,
                baseDelay: 500,
                maxDelay: 15e3
              }
            }
          });
        });
      },
      subscribe: (h, p) => t(this, void 0, void 0, function* () {
        const { request_id: w } = yield f.submit(h, p);
        return p.onEnqueue && p.onEnqueue(w), yield f.subscribeToStatus(h, Object.assign({ requestId: w }, p)), f.result(h, { requestId: w });
      })
    };
  }
  return He;
}
var dt = {}, xr;
function xs() {
  if (xr) return dt;
  xr = 1, Object.defineProperty(dt, "__esModule", { value: !0 }), dt.isQueueStatus = t, dt.isCompletedQueueStatus = e;
  function t(n) {
    return n && n.status && n.response_url;
  }
  function e(n) {
    return t(n) && n.status === "COMPLETED";
  }
  return dt;
}
var Ir;
function Is() {
  return Ir || (Ir = 1, (function(t) {
    var e = De && De.__createBinding || (Object.create ? (function(u, l, d, m) {
      m === void 0 && (m = d);
      var f = Object.getOwnPropertyDescriptor(l, d);
      (!f || ("get" in f ? !l.__esModule : f.writable || f.configurable)) && (f = { enumerable: !0, get: function() {
        return l[d];
      } }), Object.defineProperty(u, m, f);
    }) : (function(u, l, d, m) {
      m === void 0 && (m = d), u[m] = l[d];
    })), n = De && De.__exportStar || function(u, l) {
      for (var d in u) d !== "default" && !Object.prototype.hasOwnProperty.call(l, d) && e(l, u, d);
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.fal = t.parseEndpointId = t.isRetryableError = t.ValidationError = t.ApiError = t.withProxy = t.withMiddleware = t.createFalClient = void 0;
    const r = Sr();
    var i = Sr();
    Object.defineProperty(t, "createFalClient", { enumerable: !0, get: function() {
      return i.createFalClient;
    } });
    var o = gi();
    Object.defineProperty(t, "withMiddleware", { enumerable: !0, get: function() {
      return o.withMiddleware;
    } }), Object.defineProperty(t, "withProxy", { enumerable: !0, get: function() {
      return o.withProxy;
    } });
    var s = $e();
    Object.defineProperty(t, "ApiError", { enumerable: !0, get: function() {
      return s.ApiError;
    } }), Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
      return s.ValidationError;
    } });
    var c = Xt();
    Object.defineProperty(t, "isRetryableError", { enumerable: !0, get: function() {
      return c.isRetryableError;
    } }), n(xs(), t);
    var a = ke();
    Object.defineProperty(t, "parseEndpointId", { enumerable: !0, get: function() {
      return a.parseEndpointId;
    } }), t.fal = (function() {
      let l = (0, r.createFalClient)();
      return {
        config(d) {
          l = (0, r.createFalClient)(d);
        },
        get queue() {
          return l.queue;
        },
        get realtime() {
          return l.realtime;
        },
        get storage() {
          return l.storage;
        },
        get streaming() {
          return l.streaming;
        },
        run(d, m) {
          return l.run(d, m);
        },
        subscribe(d, m) {
          return l.subscribe(d, m);
        },
        stream(d, m) {
          return l.stream(d, m);
        }
      };
    })();
  })(De)), De;
}
var z = Is();
const As = {
  image: "--image",
  start_image: "--start-image",
  end_image: "--end-image",
  video: "--video",
  audio: "--audio"
}, Rs = /^[A-Za-z][A-Za-z0-9_]*$/, Ns = /* @__PURE__ */ new Set(["json", "wait", "no_color"]);
function Os(t) {
  const e = ["generate", "create", t.model], n = { ...t.extra, ...t.params }, r = (o, s) => {
    if (s == null) return;
    if (!Rs.test(o) || Ns.has(o))
      throw new Error(`Invalid Higgsfield parameter name: ${o}`);
    let c;
    if (typeof s == "string")
      c = o === "prompt" ? s.trim() : s;
    else if (typeof s == "number") {
      if (!Number.isFinite(s)) throw new Error(`Higgsfield parameter ${o} must be finite`);
      c = String(s);
    } else if (typeof s == "boolean")
      c = s ? "true" : "false";
    else if (typeof s == "object")
      try {
        const a = JSON.stringify(s);
        if (a === void 0) throw new Error("not JSON serializable");
        c = a;
      } catch (a) {
        throw new Error(`Higgsfield parameter ${o} must be JSON serializable`, { cause: a });
      }
    else
      throw new Error(`Higgsfield parameter ${o} has an unsupported value type`);
    e.push(`--${o}`, c);
  }, i = t.prompt !== void 0 ? t.prompt : n.prompt;
  delete n.prompt, r("prompt", i);
  for (const o of t.medias ?? [])
    o.value && e.push(As[o.role], o.value);
  t.aspectRatio !== void 0 && (delete n.aspect_ratio, r("aspect_ratio", t.aspectRatio)), t.durationSec !== void 0 && (delete n.duration, t.durationSec > 0 && r("duration", t.durationSec)), t.count !== void 0 && (delete n.count, t.count >= 1 && r("count", t.count));
  for (const [o, s] of Object.entries(n))
    r(o, s);
  return e.push("--wait", "--json"), e;
}
function Bn(t) {
  return !!t && typeof t == "object" && !Array.isArray(t);
}
function Sn(t, e = 0) {
  if (e > 12) return [];
  if (typeof t == "string") return /^https?:\/\//i.test(t) ? [t] : [];
  if (Array.isArray(t))
    return [...new Set(t.flatMap((r) => Sn(r, e + 1)))];
  if (!Bn(t)) return [];
  const n = [];
  for (const r of ["url", "video_url", "image_url", "audio_url", "model_url", "output_url", "result_url"]) {
    const i = t[r];
    typeof i == "string" && /^https?:\/\//i.test(i) && n.push(i);
  }
  for (const r of ["output", "result", "data", "job", "results", "outputs", "medias", "jobs", "items"])
    n.push(...Sn(t[r], e + 1));
  return [...new Set(n)];
}
function xn(t, e = 0) {
  if (!(e > 12)) {
    if (typeof t == "string") {
      const n = t.trim();
      return n && !/^https?:\/\//i.test(n) ? n : void 0;
    }
    if (Array.isArray(t)) {
      for (const n of t) {
        const r = xn(n, e + 1);
        if (r) return r;
      }
      return;
    }
    if (Bn(t)) {
      for (const n of ["text", "output_text", "result_text", "response_text", "answer", "content"]) {
        const r = t[n];
        if (typeof r == "string") {
          const i = r.trim();
          if (i && !/^https?:\/\//i.test(i)) return i;
        }
      }
      for (const n of ["output", "result", "data", "job", "results", "outputs", "items"]) {
        const r = xn(t[n], e + 1);
        if (r) return r;
      }
    }
  }
}
function Ps(t, e) {
  var y;
  const n = t.trim();
  if (!n) throw new Error("Higgsfield CLI returned no output");
  const r = (h) => Array.isArray(h) ? { results: h } : Bn(h) ? h : { result: h };
  let i = null;
  try {
    i = r(JSON.parse(n));
  } catch {
    for (const h of n.split(/\r?\n/).reverse()) {
      const p = h.trim();
      if (!(!p.startsWith("{") && !p.startsWith("[")))
        try {
          i = r(JSON.parse(p));
          break;
        } catch {
        }
    }
  }
  if (!i) throw new Error("Higgsfield CLI output was not valid JSON");
  const o = i.results, s = Array.isArray(o) && o.length > 0 && typeof o[0] == "object" ? o[0] : i, c = String(s.state ?? s.status ?? "").toLowerCase();
  if (c === "failed" || c === "error" || c === "fail")
    throw new Error(typeof s.error == "string" ? s.error : "Higgsfield generation failed");
  const a = Sn(i), u = a[0], l = xn(i);
  if (!u && !l) throw new Error("Higgsfield generation finished without a media URL or text output");
  const d = s.duration ?? ((y = s.output) == null ? void 0 : y.duration), m = s.job_id ?? s.id ?? s.jobId, f = e.mediaType, g = a.map((h) => ({ kind: f, url: h }));
  return l && g.push({ kind: "text", text: l }), {
    ...u ? { url: u, urls: a } : {},
    ...l ? { text: l } : {},
    mediaType: f,
    outputKind: f,
    outputs: g,
    durationSec: typeof d == "number" ? d : typeof d == "string" && Number.isFinite(Number(d)) ? Number(d) : void 0,
    jobId: typeof m == "string" ? m : void 0,
    model: e.model
  };
}
const ks = [
  _.join(W.homedir(), ".npm-global/bin/higgsfield"),
  _.join(W.homedir(), ".local/bin/hf"),
  "/opt/homebrew/bin/higgsfield",
  "/usr/local/bin/higgsfield",
  "higgsfield"
];
function Cs() {
  const t = W.homedir(), e = [_.join(t, ".npm-global/bin"), _.join(t, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...process.env, PATH: [...e, process.env.PATH ?? ""].filter(Boolean).join(_.delimiter), NO_COLOR: "1" };
}
const Us = 480 * 1e3;
function Ft(t, e = 6e4) {
  return new Promise((n, r) => {
    var l, d;
    const i = ks[0], o = t.includes("--json") ? t : [...t, "--json"], s = ne(i, o, { env: Cs() });
    let c = "", a = "";
    const u = setTimeout(() => {
      s.kill("SIGTERM"), r(new Error("Higgsfield CLI timed out"));
    }, e);
    (l = s.stdout) == null || l.on("data", (m) => {
      c += m.toString();
    }), (d = s.stderr) == null || d.on("data", (m) => {
      a += m.toString();
    }), s.on("error", (m) => {
      clearTimeout(u), r(m);
    }), s.on("close", (m) => {
      if (clearTimeout(u), m === 0) {
        n(c);
        return;
      }
      const f = a.trim() || c.trim() || `Higgsfield CLI exited with code ${m}`;
      r(new Error(/session expired/i.test(f) ? 'Higgsfield is not connected. Run "higgsfield auth login" or connect it in Settings.' : f));
    });
  });
}
async function In(t) {
  const e = await Ft(Os(t), Us);
  return Ps(e, t);
}
async function Ar() {
  try {
    const t = await Ft(["account", "status"], 15e3);
    return JSON.parse(t.trim());
  } catch {
    return null;
  }
}
function Rr(t) {
  if (!t) return { connected: !1 };
  const e = t.data && typeof t.data == "object" ? t.data : t, n = e.subscription_plan_type ?? e.plan;
  return {
    connected: !0,
    email: typeof e.email == "string" ? e.email : void 0,
    plan: typeof n == "string" ? n : void 0,
    credits: typeof e.credits == "number" ? e.credits : typeof e.balance == "number" ? e.balance : void 0
  };
}
function Nr(t) {
  if (t.drawnFramePath && t.referenceMode === "frame") {
    const e = t.outputType === "video" ? "start_image" : "image", n = [{ value: t.drawnFramePath, role: e }];
    return t.guideFramePath && n.push({ value: t.guideFramePath, role: "image" }), n;
  }
  return t.extractedPaths.map((e, n) => ({
    value: e,
    role: t.extractedRoles[n] ?? "image"
  }));
}
function js() {
  R.handle("higgsfield:account-status", async () => Rr(await Ar())), R.handle("higgsfield:quick-edit", async (t, e) => {
    const { prepareClipReference: n, resolveLocalSourcePath: r } = await Promise.resolve().then(() => Sc);
    console.log("[higgsfield:quick-edit] params:", { fileRef: e.fileRef, mode: e.referenceMode, model: e.model, range: [e.sourceStartSec, e.sourceEndSec] });
    let i = [];
    const o = /^https?:\/\//i.test(e.fileRef), s = o ? null : r(e.fileRef);
    if (e.drawnFramePath && e.referenceMode === "frame")
      i = Nr({
        referenceMode: "frame",
        outputType: e.outputType,
        drawnFramePath: e.drawnFramePath,
        guideFramePath: e.guideFramePath,
        extractedPaths: [],
        extractedRoles: []
      });
    else if (s)
      try {
        const c = await n(e.fileRef, {
          mode: e.referenceMode,
          frameTimeSec: e.frameTimeSec,
          sourceStartSec: e.sourceStartSec,
          sourceEndSec: e.sourceEndSec
        });
        console.log("[higgsfield:quick-edit] extracted refs:", c.paths), i = Nr({
          referenceMode: e.referenceMode,
          outputType: e.outputType,
          drawnFramePath: e.drawnFramePath,
          extractedPaths: c.paths,
          extractedRoles: c.roles
        });
      } catch (c) {
        console.warn("[higgsfield:quick-edit] extraction failed, falling back to source path:", c), i = [{ value: s, role: e.outputType === "video" ? "start_image" : "image" }];
      }
    else if (o)
      console.log("[higgsfield:quick-edit] remote source, passing URL directly"), i = [{ value: e.fileRef, role: e.outputType === "video" ? "start_image" : "image" }];
    else
      throw new Error(`Quick Edit could not resolve the clip's source media: ${e.fileRef}`);
    return In({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: i.length > 0 ? i : void 0,
      aspectRatio: e.aspectRatio
    });
  }), R.handle("higgsfield:generate", async (t, e) => {
    const n = [...e.medias ?? []];
    return e.referenceValue && n.push({
      value: e.referenceValue,
      role: e.outputType === "video" ? "start_image" : "image"
    }), In({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: n.length > 0 ? n : void 0,
      params: e.params
    });
  }), R.handle("higgsfield:auth-login", async () => {
    try {
      await Ft(["auth", "login"], 300 * 1e3);
    } catch (t) {
      return { connected: !1, error: t instanceof Error ? t.message : String(t) };
    }
    return Rr(await Ar());
  }), R.handle("higgsfield:auth-logout", async () => {
    await Ft(["auth", "logout"], 15e3).catch(() => {
    });
  });
}
const Ge = "https://api.kie.ai/api/v1", Ls = 3e3, Ds = 120, Ms = {
  runway: `${Ge}/runway/generate`,
  veo: `${Ge}/veo/generate`,
  "4o-image": `${Ge}/gpt4o-image/generate`,
  "suno-music": `${Ge}/generate`
};
function Fs(t) {
  for (const [e, n] of Object.entries(Ms))
    if (t.startsWith(e)) return n;
}
async function $s(t, e, n) {
  const r = Fs(t), i = r ?? `${Ge}/jobs/createTask`, o = r ? { ...e, callBackUrl: "" } : { model: t, input: e, callBackUrl: "" }, s = await fetch(i, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${n}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(o)
  });
  if (!s.ok) {
    const a = await s.json().catch(() => ({}));
    throw new Error(a.msg || `kie.ai error ${s.status}`);
  }
  const c = await s.json();
  if (c.code !== 200)
    throw new Error(c.msg || "Failed to create kie.ai task");
  return c.data.taskId;
}
async function Bs(t, e) {
  for (let n = 0; n < Ds; n++) {
    await new Promise((s) => setTimeout(s, Ls));
    const r = await fetch(`${Ge}/jobs/recordInfo?taskId=${t}`, {
      headers: { Authorization: `Bearer ${e}` }
    });
    if (!r.ok) continue;
    const o = (await r.json()).data;
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
async function Hs(t, e, n) {
  const r = await $s(t, e, n);
  return await Bs(r, n);
}
const qs = /* @__PURE__ */ new Set([
  "image",
  "start_image",
  "end_image",
  "video",
  "audio"
]), Ws = {
  // Exact CLI role keys and their common URL aliases.
  image: "image",
  start_image: "start_image",
  start_image_url: "start_image",
  end_image: "end_image",
  end_image_url: "end_image",
  video: "video",
  video_url: "video",
  audio: "audio",
  audio_url: "audio",
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
function zs(t) {
  if (!t.startsWith("local-media://file")) return t;
  try {
    return decodeURIComponent(t.slice(18));
  } catch {
    return t.slice(18);
  }
}
function Xs(t, e) {
  const n = t.role ?? t.media_role ?? t.mediaRole;
  if (typeof n == "string" && qs.has(n))
    return { role: n, explicit: !0 };
  const r = String(t.type ?? t.kind ?? t.media_type ?? t.mediaType ?? t.mime_type ?? "").toLowerCase();
  return r === "start_image" || r === "start-image" ? { role: "start_image", explicit: !0 } : r === "end_image" || r === "end-image" ? { role: "end_image", explicit: !0 } : r.includes("audio") ? { role: "audio", explicit: !0 } : r.includes("video") ? { role: "video", explicit: !0 } : r.includes("image") ? { role: "image", explicit: !0 } : { role: e, explicit: !1 };
}
function Gs(t, e) {
  const n = t.split(/[?#]/, 1)[0].toLowerCase();
  return n.startsWith("data:audio/") || /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/.test(n) ? "audio" : n.startsWith("data:video/") || /\.(?:avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(n) ? "video" : e;
}
function Ks(t) {
  return t === "video" ? "start_image" : t === "text" ? "video" : t === "audio" ? "audio" : "image";
}
function wt(t, e, n = !1) {
  if (typeof t == "string") {
    const s = zs(t).trim(), c = n ? Gs(s, e) : e;
    return s ? [{ value: s, role: c }] : [];
  }
  if (Array.isArray(t))
    return t.flatMap((s) => wt(s, e, n));
  if (!t || typeof t != "object") return [];
  const r = t, i = Xs(r, e);
  if (Array.isArray(r.allUrls))
    return r.allUrls.flatMap((s) => wt(
      s,
      i.role,
      n && !i.explicit
    ));
  const o = r.value ?? r.url ?? r.fileRef ?? r.path ?? r.id ?? r.uuid ?? r.media_id ?? r.mediaId ?? r.frontalImageUrl;
  return wt(
    o,
    i.role,
    n && !i.explicit
  );
}
function Js(t, e, n) {
  const r = [], i = {};
  for (const [o, s] of Object.entries(e)) {
    if (s == null) continue;
    if (o === "medias" || o === "higgsfield_media_inputs") {
      r.push(...wt(
        s,
        Ks(n),
        !0
      ));
      continue;
    }
    const c = Ws[o];
    if (c) {
      const a = c === "legacy-image" ? n === "video" ? "start_image" : "image" : c;
      r.push(...wt(s, a));
      continue;
    }
    i[o] = s;
  }
  return {
    model: t,
    mediaType: n,
    ...r.length > 0 ? { medias: r } : {},
    ...Object.keys(i).length > 0 ? { params: i } : {}
  };
}
function Vs(t) {
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
async function Ys(t, e, n) {
  const r = await In(Js(t, e, n));
  return Vs(r);
}
const Or = "https://api.runpod.ai/v2", Qs = 3e3, Zs = 120;
async function ea(t, e, n) {
  if (!t) throw new Error("No RunPod endpoint ID configured for this model. Set it in the model definition.");
  const r = await fetch(`${Or}/${t}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${n}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: e })
  });
  if (!r.ok) {
    const o = await r.json().catch(() => ({}));
    throw new Error(o.error || `RunPod error ${r.status}`);
  }
  const { id: i } = await r.json();
  for (let o = 0; o < Zs; o++) {
    await new Promise((a) => setTimeout(a, Qs));
    const s = await fetch(`${Or}/${t}/status/${i}`, {
      headers: { Authorization: `Bearer ${n}` }
    });
    if (!s.ok) continue;
    const c = await s.json();
    if (c.status === "COMPLETED") {
      const a = c.output, u = (a == null ? void 0 : a.image_url) ?? (a == null ? void 0 : a.image);
      if (u && !u.startsWith("http") && !u.startsWith("local-media://")) {
        const l = u.includes(",") ? u.split(",")[1] : u, d = _.join(W.tmpdir(), `cinegen-runpod-${Date.now()}.png`);
        return await L.writeFile(d, Buffer.from(l, "base64")), { output: { ...a, image_url: `local-media://file${d}` } };
      }
      return { output: a };
    }
    if (c.status === "FAILED")
      throw new Error(c.error || "RunPod job failed");
  }
  throw new Error("RunPod job timed out");
}
async function ta(t, e, n) {
  const r = `${t.replace(/\/$/, "")}/generate/${e}`, i = await fetch(r, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: n })
  });
  if (!i.ok) {
    const o = await i.json().catch(() => ({}));
    throw new Error(o.detail || `Pod error ${i.status}`);
  }
  return await i.json();
}
async function Pr(t, e, n) {
  const r = `https://api.runpod.io/graphql?api_key=${t}`, i = n === "start" ? `mutation { podResume(input: { podId: "${e}" }) { id desiredStatus } }` : `mutation { podStop(input: { podId: "${e}" }) { id desiredStatus } }`, s = await (await fetch(r, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: i })
  })).json();
  if (s.errors)
    throw new Error(`RunPod pod ${n} failed: ${JSON.stringify(s.errors)}`);
  return s;
}
async function na(t, e) {
  var a, u, l;
  const n = `https://api.runpod.io/graphql?api_key=${t}`, r = `{ pod(input: { podId: "${e}" }) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort type } } } }`, s = (a = (await (await fetch(n, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: r })
  })).json()).data) == null ? void 0 : a.pod;
  if (!s) throw new Error("Pod not found");
  const c = (l = (u = s.runtime) == null ? void 0 : u.ports) == null ? void 0 : l.find((d) => d.privatePort === 8e3 && d.isIpPublic);
  return {
    status: s.desiredStatus,
    ip: (c == null ? void 0 : c.ip) ?? null,
    port: (c == null ? void 0 : c.publicPort) ?? null
  };
}
function An(t) {
  z.fal.config({ credentials: t });
}
function ra(t) {
  const e = _.extname(t).toLowerCase();
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
async function kr(t) {
  const e = decodeURIComponent(t.replace("local-media://file", "")), n = await L.readFile(e), r = ra(e), i = new Blob([n], { type: r }), o = new File([i], _.basename(e), { type: r });
  return z.fal.storage.upload(o);
}
async function $t(t) {
  const e = {};
  for (const [n, r] of Object.entries(t))
    typeof r == "string" && r.startsWith("local-media://file") ? e[n] = await kr(r) : Array.isArray(r) ? e[n] = await Promise.all(
      r.map(async (i) => typeof i == "string" && i.startsWith("local-media://file") ? kr(i) : i && typeof i == "object" && !Array.isArray(i) ? $t(i) : i)
    ) : r && typeof r == "object" && !Array.isArray(r) ? e[n] = await $t(r) : e[n] = r;
  return e;
}
async function Cr(t, e, n) {
  var r;
  An(n), console.log("[fal] Calling model:", t, "with input:", JSON.stringify(e, null, 2));
  try {
    return await z.fal.subscribe(t, { input: e, logs: !0 });
  } catch (i) {
    throw console.error("[fal] Error details:", JSON.stringify((i == null ? void 0 : i.body) ?? i, null, 2)), (r = i == null ? void 0 : i.body) != null && r.detail && console.error("[fal] Validation errors:", JSON.stringify(i.body.detail, null, 2)), i;
  }
}
function ia() {
  R.handle("workflow:run", async (e, n) => {
    const {
      apiKey: r,
      kieKey: i,
      runpodKey: o,
      runpodEndpointId: s,
      podUrl: c,
      nodeId: a,
      nodeType: u,
      modelId: l,
      outputType: d,
      inputs: m
    } = n, { ALL_MODELS: f, resolveVideoModelEndpoint: g, sanitizeVideoInputsForEndpoint: y } = await import("./models-CdtgKKT8.js"), h = f[l] ?? Object.values(f).find(
      (v) => v.id === l || v.altId === l || v.nodeType === l
    );
    if (!h) {
      if (l.startsWith("fal-ai/")) {
        const v = r;
        if (!v) throw new Error("No fal.ai API key provided. Add one in Settings.");
        An(v);
        const I = await $t(m), O = await Cr(l, I, v);
        return O.data ?? O;
      }
      throw new Error(`Unknown model: ${l}`);
    }
    const p = h.provider;
    let w = m;
    p !== "higgsfield" && (r && An(r), w = await $t(m));
    let E = l.includes("/") ? l : h.id;
    const T = h.nodeType ?? l, x = Object.keys(w).some(
      (v) => v === "image_url" || v === "start_image_url" || v === "image_urls" || v === "imageUrl"
    );
    E = g(T, h, {
      hasImageInputs: x,
      quality: w.quality
    }), y(T, E, w);
    let b;
    if (p === "kie") {
      const v = i;
      if (!v) throw new Error("No kie.ai API key provided. Add one in Settings.");
      b = await Hs(E, w, v);
    } else if (p === "pod") {
      if (!c) throw new Error("No pod URL configured. Start your pod and set the URL in Settings.");
      const v = h.podRoute ?? E;
      b = await ta(c, v, w);
    } else if (p === "runpod") {
      const v = o;
      if (!v) throw new Error("No RunPod API key provided. Add one in Settings.");
      const I = s || h.runpodEndpointId || "";
      b = await ea(I, w, v);
    } else if (p === "higgsfield") {
      const v = h.outputType;
      b = await Ys(E, w, d ?? (v === "video" ? "video" : v === "audio" ? "audio" : v === "text" ? "text" : v === "3d" || v === "model3d" || v === "model" ? "3d" : "image"));
    } else {
      const v = r;
      if (!v) throw new Error("No fal.ai API key provided. Add one in Settings.");
      b = await Cr(E, w, v);
    }
    return b.data ?? b;
  });
  const t = /* @__PURE__ */ new Map();
  R.handle("workflow:poll-job", async (e, n) => {
    const r = t.get(n);
    if (!r) throw new Error("Job not found");
    return r;
  }), R.handle("pod:start", async (e, n) => await Pr(n.runpodKey, n.podId, "start")), R.handle("pod:stop", async (e, n) => await Pr(n.runpodKey, n.podId, "stop")), R.handle("pod:status", async (e, n) => await na(n.runpodKey, n.podId));
}
const Oi = oi(import.meta.url);
function Pi(t) {
  return X.isPackaged ? t.replace("app.asar", "app.asar.unpacked") : t;
}
function ye() {
  const t = Oi("ffmpeg-static");
  return Pi(t);
}
function ki() {
  const t = Oi("ffprobe-static").path;
  return Pi(t);
}
function Ci() {
  if (X.isPackaged)
    return _.join(process.resourcesPath, "vendor", "fpcalc");
  const t = _.dirname(Cn(import.meta.url));
  return _.resolve(t, "..", "vendor", "fpcalc", "fpcalc");
}
const Ur = {
  draft: { crf: 28, scale: 0.5 },
  standard: { crf: 20, scale: 1 },
  high: { crf: 16, scale: 1 }
}, re = /* @__PURE__ */ new Map(), Et = /* @__PURE__ */ new Map();
function oa(t, e) {
  for (const n of Y.getAllWindows())
    n.webContents.send("export:progress", { jobId: t, progress: e });
}
function sa(t, e) {
  const n = t.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
  if (!n) return null;
  const r = parseInt(n[1], 10), i = parseInt(n[2], 10), o = parseInt(n[3], 10), s = parseInt(n[4], 10) / 100, c = r * 3600 + i * 60 + o + s;
  return e > 0 ? Math.min(100, c / e * 100) : 0;
}
async function aa(t, e) {
  const n = re.get(t);
  if (!n) return;
  const r = ye(), i = Ur[e.preset || "standard"] || Ur.standard, o = e.fps || 30, s = e.outputPath || _.join(process.cwd(), `export_${t}.mp4`);
  re.set(t, { ...n, status: "rendering" });
  const c = e.clips.filter(
    (m) => (m.type === "video" || m.type === "image") && m.inputPath
  );
  if (c.length === 0) {
    re.set(t, { ...n, status: "failed", error: "No video clips to export" });
    return;
  }
  const a = [];
  for (const m of c)
    m.trimStart > 0 && a.push("-ss", String(m.trimStart)), a.push("-t", String(m.duration / (m.speed || 1))), a.push("-i", m.inputPath);
  const u = [];
  for (let m = 0; m < c.length; m++) {
    const f = c[m], g = f.speed || 1, y = f.volume ?? 1, h = [];
    g !== 1 && h.push(`setpts=${(1 / g).toFixed(4)}*PTS`), i.scale !== 1 && h.push(`scale=iw*${i.scale}:ih*${i.scale}`), h.push(`fps=${o}`), u.push(`[${m}:v]${h.join(",")}[v${m}]`);
    const p = f.duration / g;
    if (f.type === "image")
      u.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${p.toFixed(4)}[a${m}]`);
    else {
      const w = [];
      g !== 1 && w.push(`atempo=${g}`), y !== 1 && w.push(`volume=${y}`), w.length > 0 ? u.push(`[${m}:a]${w.join(",")}[a${m}]`) : u.push(`[${m}:a]anull[a${m}]`);
    }
  }
  const l = c.map((m, f) => `[v${f}]`).join(""), d = c.map((m, f) => `[a${f}]`).join("");
  return u.push(
    `${l}${d}concat=n=${c.length}:v=1:a=1[outv][outa]`
  ), a.push("-filter_complex", u.join(";")), a.push("-map", "[outv]", "-map", "[outa]"), a.push("-c:v", "libx264", "-crf", String(i.crf), "-preset", "fast"), a.push("-c:a", "aac", "-b:a", "192k"), a.push("-y", s), new Promise((m, f) => {
    var h;
    const g = ne(r, a);
    Et.set(t, g);
    let y = "";
    (h = g.stderr) == null || h.on("data", (p) => {
      y += p.toString();
      const w = y.split("\r"), E = w[w.length - 1] || w[w.length - 2];
      if (E) {
        const T = sa(E, e.totalDuration);
        if (T !== null) {
          const x = re.get(t);
          x && (re.set(t, { ...x, progress: T }), oa(t, T));
        }
      }
      y.length > 2048 && (y = y.slice(-1024));
    }), g.on("close", (p) => {
      Et.delete(t);
      const w = re.get(t);
      if (!w) {
        m();
        return;
      }
      if (p === 0) {
        let E;
        try {
          E = B.statSync(s).size;
        } catch {
        }
        re.set(t, {
          ...w,
          status: "complete",
          progress: 100,
          outputUrl: s,
          fileSize: E,
          completedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else
        re.set(t, {
          ...w,
          status: "failed",
          error: `ffmpeg exited with code ${p}`
        });
      m();
    }), g.on("error", (p) => {
      Et.delete(t);
      const w = re.get(t);
      w && re.set(t, { ...w, status: "failed", error: p.message }), f(p);
    });
  });
}
function ca() {
  R.handle("export:start", async (t, e) => {
    const { preset: n = "standard", fps: r = 30 } = e, i = {
      id: G.randomUUID(),
      status: "queued",
      progress: 0,
      preset: n,
      fps: r,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return re.set(i.id, i), aa(i.id, e).catch((o) => {
      console.error("[export] Render failed:", o);
    }), i;
  }), R.handle("export:poll", async (t, e) => {
    const n = re.get(e);
    if (!n) throw new Error("Export not found");
    return n;
  }), R.handle("export:cancel", async (t, e) => {
    const n = Et.get(e);
    n && (n.kill("SIGTERM"), Et.delete(e));
    const r = re.get(e);
    if (r && (re.set(e, { ...r, status: "failed", error: "Cancelled by user" }), r.outputUrl))
      try {
        B.unlinkSync(r.outputUrl);
      } catch {
      }
    return { ok: !0 };
  });
}
const la = {
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
function mn(t) {
  const e = _.extname(t).toLowerCase();
  return la[e] ?? "application/octet-stream";
}
function jr(t) {
  try {
    const e = new URL(t);
    if (e.protocol !== "local-media:" || e.hostname !== "file") return null;
    let n = decodeURIComponent(e.pathname);
    return process.platform === "win32" && n.startsWith("/") && (n = n.slice(1)), _.normalize(n);
  } catch {
    return null;
  }
}
async function ua(t) {
  const e = _.join(
    W.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), n = ye(), r = [
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
    var a;
    const s = ne(n, r, { stdio: ["ignore", "ignore", "pipe"] });
    let c = "";
    (a = s.stderr) == null || a.on("data", (u) => {
      c += u.toString();
    }), s.on("error", o), s.on("close", (u) => {
      if (u === 0) {
        i();
        return;
      }
      o(new Error(c.trim() || `ffmpeg exited with code ${u}`));
    });
  }), e;
}
function da() {
  R.handle(
    "elements:upload",
    async (t, e, n) => {
      if (!n) throw new Error("No API key provided");
      z.fal.config({ credentials: n });
      const r = new Blob([e.buffer], { type: e.type }), i = new File([r], e.name, { type: e.type });
      return { url: await z.fal.storage.upload(i) };
    }
  ), R.handle(
    "elements:upload-transcription-source",
    async (t, e, n) => {
      if (!n) throw new Error("No API key provided");
      const r = jr(e);
      if (!r) {
        if (e.startsWith("http://") || e.startsWith("https://"))
          return { url: e };
        throw new Error("Transcription upload requires a local-media or remote URL source");
      }
      z.fal.config({ credentials: n });
      const i = await ua(r);
      try {
        const o = await L.readFile(i), c = `${_.basename(r, _.extname(r))}.m4a`, a = mn(i), u = new Blob([o], { type: a }), l = new File([u], c, { type: a });
        return { url: await z.fal.storage.upload(l) };
      } finally {
        await L.unlink(i).catch(() => {
        });
      }
    }
  ), R.handle(
    "elements:upload-media-source",
    async (t, e, n) => {
      if (!n) throw new Error("No API key provided");
      z.fal.config({ credentials: n });
      const r = jr(e);
      if (r) {
        const i = await L.readFile(r), o = _.basename(r), s = mn(r), c = new Blob([i], { type: s }), a = new File([c], o, { type: s });
        return { url: await z.fal.storage.upload(a) };
      }
      if (e.startsWith("data:"))
        return { url: e };
      if (e.startsWith("http://") || e.startsWith("https://")) {
        const i = await import("node:os");
        await import("node:fs");
        const o = _.extname(new URL(e).pathname) || ".mp4", s = _.join(i.tmpdir(), `cinegen-upload-${Date.now()}${o}`);
        try {
          const f = await fetch(e);
          if (!f.ok)
            throw new Error(`Remote file unavailable (HTTP ${f.status}). The URL may have expired. Try re-importing the asset.`);
          const g = await f.arrayBuffer();
          await L.writeFile(s, Buffer.from(g));
        } catch (f) {
          throw new Error(
            f instanceof Error ? f.message : "Failed to download remote media. The URL may have expired."
          );
        }
        const c = await L.readFile(s), a = _.basename(s), u = mn(s), l = new Blob([c], { type: u }), d = new File([l], a, { type: u }), m = await z.fal.storage.upload(d);
        return await L.unlink(s).catch(() => {
        }), { url: m };
      }
      throw new Error("Media upload requires a local-media, remote URL, or data URI source");
    }
  );
}
const Lr = {
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
}, Ui = {
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
function fa(t) {
  return t ? { ...Lr, ...Ui[t].weights } : Lr;
}
function Dr(t, e) {
  if (!t) return !1;
  const n = t.toLowerCase();
  return e.some((r) => n.includes(r.toLowerCase()));
}
function ma(t, e, n) {
  const r = fa(n.persona), i = n.persona ? Ui[n.persona] : void 0, o = [];
  let s = 0;
  if (e.length === 0)
    s += t.words.length > 0 ? 3 : 1;
  else {
    const c = t.text.toLowerCase(), a = `${t.assetName} ${t.text} ${t.words.map((l) => l.word).join(" ")}`.toLowerCase();
    let u = 0;
    for (const l of e)
      a.includes(l) && (u += 1, s += c.includes(l) ? r.termInText : r.termElsewhere);
    u > 0 && o.push(`matched ${e.slice(0, 4).join(", ")}`);
  }
  return t.timelinePlacements.some((c) => c.timelineId === n.activeTimelineId) && n.activeTimelineId && (s += r.activeTimeline, o.push("already on the active timeline")), t.words.length > 0 && (s += r.wordTiming), t.emotion && (s += r.hasEmotion), t.delivery && (s += r.hasDelivery, o.push("has vocal delivery notes")), i && (Dr(t.energy, i.preferredEnergy) && (s += r.energyMatch, o.push(`${t.energy} energy fits ${n.persona}`)), Dr(t.pace, i.preferredPace) && (s += r.paceMatch, o.push(`${t.pace} pace fits ${n.persona}`)), t.emotion && i.emotionBias.some((c) => t.emotion.toLowerCase().includes(c)) && (s += r.emotionBias, o.push(`${t.emotion} emotion favored by ${n.persona}`))), t.emotion && n.queryEmotions.some((c) => t.emotion.toLowerCase().includes(c) || c.includes(t.emotion.toLowerCase())) && (s += r.emotionQueryMatch, o.push(`emotion (${t.emotion}) matches the query`)), t.notable && t.notable.length > 0 && (s += r.notableSignal * t.notable.length, o.push(`notable: ${t.notable.slice(0, 2).join("; ")}`)), { score: s, reasons: o };
}
function pa(t) {
  const { query: e, brief: n, candidates: r } = t, i = r.map((o) => `- ${o.id}: ${o.text.replace(/\s+/g, " ").slice(0, 160)}`);
  return [
    `You are a ${n.persona} selecting the strongest moments for a cut.`,
    `Story goal: ${n.storyGoal}. Tone: ${n.tone}. Pacing: ${n.pacing}.`,
    `Viewer query: "${e}".`,
    "Re-order these candidate moments from most to least useful for this cut.",
    "Candidates (id: text):",
    ...i,
    'Return compact JSON ONLY: {"order":["id1","id2",...]} listing the ids best-first.',
    "Include only ids from the list. No prose."
  ].join(`
`);
}
function ha(t) {
  var s;
  const e = t.trim();
  if (!e) return null;
  const n = (c) => {
    try {
      return JSON.parse(c), c;
    } catch {
      return null;
    }
  }, r = n(e);
  if (r) return r;
  for (const c of e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const a = (s = c[1]) == null ? void 0 : s.trim();
    if (a && n(a)) return a;
  }
  const i = e.indexOf("{"), o = e.lastIndexOf("}");
  if (i !== -1 && o > i) {
    const c = e.slice(i, o + 1);
    if (n(c)) return c;
  }
  return null;
}
function ga(t, e) {
  const n = ha(e);
  if (!n) return t;
  let r;
  try {
    r = JSON.parse(n);
  } catch {
    return t;
  }
  const i = r.order;
  if (!Array.isArray(i) || i.length === 0) return t;
  const o = new Map(t.map((a) => [a.id, a])), s = /* @__PURE__ */ new Set(), c = [];
  for (const a of i) {
    if (typeof a != "string") continue;
    const u = o.get(a);
    u && !s.has(a) && (c.push(u), s.add(a));
  }
  for (const a of t)
    s.has(a.id) || c.push(a);
  return c;
}
function ya(t) {
  return [...new Set(
    t.toLowerCase().split(/[^a-z0-9']+/).map((e) => e.trim()).filter((e) => e.length >= 3)
  )];
}
const wa = [
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
function Ea(t) {
  const e = t.toLowerCase();
  return wa.filter((n) => e.includes(n));
}
function _a(t, e, n = 24) {
  const r = typeof n == "number" ? { limit: n } : n, i = r.limit ?? 24, o = ya(e), s = {
    activeTimelineId: t.activeTimelineId,
    persona: r.persona,
    queryEmotions: Ea(e)
  };
  return t.moments.map((c) => ({ moment: c, ...ma(c, o, s) })).filter((c) => c.score > 0).sort((c, a) => a.score - c.score || c.moment.sourceStart - a.moment.sourceStart).slice(0, i).map(({ moment: c, score: a, reasons: u }) => ({
    id: c.id,
    assetId: c.assetId,
    assetName: c.assetName,
    text: c.text,
    sourceStart: c.sourceStart,
    sourceEnd: c.sourceEnd,
    words: c.words.slice(0, 32),
    timelinePlacements: c.timelinePlacements,
    score: a,
    reason: u.length > 0 ? `${u.slice(0, 3).join("; ")}.` : `${c.words.length > 0 ? "Word-level" : "Segment-level"} transcript candidate.`
  }));
}
const Ae = "google/gemini-2.5-flash";
function We(t, e, n) {
  return Math.min(n, Math.max(e, t));
}
function pn(t) {
  try {
    return JSON.parse(t), t;
  } catch {
    return null;
  }
}
function ue(t) {
  return typeof t == "string" ? t : Array.isArray(t) ? t.map((e) => ue(e)).filter(Boolean).join(`
`) : t && typeof t == "object" ? Object.values(t).map((e) => ue(e)).filter(Boolean).join(`
`) : "";
}
function K(t) {
  if (typeof t == "number" && Number.isFinite(t)) return t;
  if (typeof t != "string") return null;
  const e = t.trim();
  if (!e) return null;
  if (e.endsWith("%")) {
    const r = Number(e.slice(0, -1));
    return Number.isFinite(r) ? r / 100 : null;
  }
  const n = Number(e);
  return Number.isFinite(n) ? n : null;
}
function ji(t) {
  var o;
  const e = t.trim();
  if (!e) return null;
  const n = pn(e);
  if (n) return n;
  const r = [...e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const s of r) {
    const c = (o = s[1]) == null ? void 0 : o.trim();
    if (!c) continue;
    const a = pn(c);
    if (a) return a;
  }
  const i = /* @__PURE__ */ new Map([
    ["{", "}"],
    ["[", "]"]
  ]);
  for (let s = 0; s < e.length; s++) {
    const c = e[s], a = i.get(c);
    if (!a) continue;
    const u = [a];
    let l = !1, d = !1;
    for (let m = s + 1; m < e.length; m++) {
      const f = e[m];
      if (d) {
        d = !1;
        continue;
      }
      if (f === "\\") {
        l && (d = !0);
        continue;
      }
      if (f === '"') {
        l = !l;
        continue;
      }
      if (l) continue;
      const g = i.get(f);
      if (g) {
        u.push(g);
        continue;
      }
      if (f === u[u.length - 1]) {
        if (u.pop(), u.length === 0) {
          const y = e.slice(s, m + 1), h = pn(y);
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
function Ta(t) {
  switch (_.extname(t).toLowerCase()) {
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
function va(t) {
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
async function Kt(t, e) {
  if (/^https?:\/\//.test(e)) return e;
  if (e.startsWith("data:")) {
    const c = e.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
    if (!c) return null;
    const a = c[1] || "application/octet-stream", u = c[3] || "", l = c[2] ? Buffer.from(u, "base64") : Buffer.from(decodeURIComponent(u), "utf8"), d = new Blob([l], { type: a }), m = new File([d], `auto-segment.${a.split("/")[1] || "bin"}`, { type: a });
    return z.fal.config({ credentials: t }), z.fal.storage.upload(m);
  }
  const n = va(e);
  if (!n) return null;
  const r = await L.readFile(n), i = Ta(n), o = new Blob([r], { type: i }), s = new File([o], _.basename(n), { type: i });
  return z.fal.config({ credentials: t }), z.fal.storage.upload(s);
}
async function ba(t, e) {
  return Kt(t, e);
}
function Mr(t, e) {
  const r = (Array.isArray(t.objects) ? t.objects : Array.isArray(t.detections) ? t.detections : Array.isArray(t.items) ? t.items : Array.isArray(t.regions) ? t.regions : Array.isArray(t.subjects) ? t.subjects : typeof t.label == "string" || typeof t.name == "string" || typeof t.object == "string" ? [t] : []).map((o) => {
    if (!o || typeof o != "object") return null;
    const s = o, c = [
      s.label,
      s.name,
      s.object,
      s.subject,
      s.class,
      s.type
    ].find((S) => typeof S == "string" && S.trim()), a = typeof c == "string" ? c.trim() : "";
    if (!a) return null;
    let u = null, l = null, d = null, m = null;
    const f = Array.isArray(s.box) ? s.box : Array.isArray(s.cxcywh) ? s.cxcywh : null;
    f && f.length >= 4 && (u = K(f[0]), l = K(f[1]), d = K(f[2]), m = K(f[3]));
    const g = Array.isArray(s.bbox) ? s.bbox : Array.isArray(s.bounds) ? s.bounds : Array.isArray(s.rect) ? s.rect : Array.isArray(s.xyxy) ? s.xyxy : null;
    if ((u === null || l === null || d === null || m === null) && g && g.length >= 4) {
      const S = K(g[0]), v = K(g[1]), I = K(g[2]), O = K(g[3]);
      [S, v, I, O].every((U) => U !== null) && (u = (S + I) / 2, l = (v + O) / 2, d = I - S, m = O - v);
    }
    const y = Array.isArray(s.box_3d) ? s.box_3d : Array.isArray(s.box3d) ? s.box3d : null;
    if ((u === null || l === null || d === null || m === null) && y && y.length >= 6) {
      const S = K(y[0]), v = K(y[1]), I = K(y[3]), O = K(y[4]), U = K(y[5]);
      [S, v, I, O, U].every((M) => M !== null) && (u = S, l = v, d = Math.max(I, O), m = Math.max(O, U));
    }
    if (u === null || l === null || d === null || m === null) {
      const S = K(s.center_x ?? s.cx ?? s.mid_x), v = K(s.center_y ?? s.cy ?? s.mid_y), I = K(s.width ?? s.w), O = K(s.height ?? s.h);
      [S, v, I, O].every((U) => U !== null) && (u = S, l = v, d = I, m = O);
    }
    if (u === null || l === null || d === null || m === null) {
      const S = K(s.x_min ?? s.left), v = K(s.y_min ?? s.top), I = K(s.x_max ?? s.right), O = K(s.y_max ?? s.bottom);
      [S, v, I, O].every((U) => U !== null) && (u = (S + I) / 2, l = (v + O) / 2, d = I - S, m = O - v);
    }
    if ([u, l, d, m].some((S) => S === null || !Number.isFinite(S))) return null;
    const h = We(d, 0.02, 1), p = We(m, 0.02, 1), w = [
      We(u, h / 2, 1 - h / 2),
      We(l, p / 2, 1 - p / 2),
      h,
      p
    ], E = K(s.score ?? s.confidence ?? s.probability), T = E !== null ? We(E, 0, 1) : 0.75, x = K(s.priority ?? s.salience ?? s.importance), b = x !== null ? We(x, 0, 1) : T;
    return {
      label: a,
      box: w,
      score: T,
      priority: b
    };
  }).filter((o) => !!o).sort((o, s) => s.priority - o.priority || s.score - o.score), i = [];
  for (const o of r)
    if (i.some((c) => {
      const a = c.label.toLowerCase() === o.label.toLowerCase(), u = Math.abs(c.box[0] - o.box[0]), l = Math.abs(c.box[1] - o.box[1]), d = Math.abs(c.box[2] - o.box[2]), m = Math.abs(c.box[3] - o.box[3]);
      return a && u < 0.06 && l < 0.06 && d < 0.08 && m < 0.08;
    }) || i.push(o), i.length >= e) break;
  return i;
}
function Ut(t) {
  if (Array.isArray(t))
    return { objects: t };
  if (t && typeof t == "object") {
    const r = t;
    if (Array.isArray(r.objects) || Array.isArray(r.detections) || Array.isArray(r.items) || Array.isArray(r.regions) || Array.isArray(r.subjects))
      return r;
    if (typeof r.label == "string" || typeof r.name == "string" || typeof r.object == "string" || Array.isArray(r.box_3d) || Array.isArray(r.box3d) || Array.isArray(r.box) || Array.isArray(r.bbox))
      return { objects: [r] };
    for (const i of ["output", "text", "content", "message", "result", "data", "response"])
      if (i in r) {
        const o = Ut(r[i]);
        if (o) return o;
      }
  }
  const e = ue(t);
  if (!e) return null;
  const n = ji(e);
  if (!n) return null;
  try {
    const r = JSON.parse(n);
    return Array.isArray(r) ? { objects: r } : r && typeof r == "object" ? r : null;
  } catch {
    return null;
  }
}
async function Fr(t, e, n, r, i) {
  z.fal.config({ credentials: t });
  const s = (await z.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: n,
      prompt: i,
      image_urls: [e],
      max_tokens: 700
    },
    logs: !0
  })).data, c = Ut(s.output) ?? Ut(s.text) ?? Ut(s);
  return c || console.warn("[vision:auto-seg] Could not extract object JSON from vision response", {
    outputPreview: ue(s.output || s.text || s).slice(0, 1e3),
    maxObjects: r
  }), c;
}
async function Li(t) {
  var s, c, a, u, l;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = (await Promise.all(
    t.framePaths.slice(0, 6).map((d) => Kt(t.apiKey, d).catch(() => null))
  )).filter((d) => !!d);
  if (e.length === 0)
    return {
      assetId: t.assetId,
      status: "missing",
      model: ((s = t.model) == null ? void 0 : s.trim()) || Ae,
      error: "No visual frames were available to upload for analysis."
    };
  z.fal.config({ credentials: t.apiKey });
  const r = (await z.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((c = t.model) == null ? void 0 : c.trim()) || Ae,
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
  })).data, i = ue(r.output) || ue(r.text) || "", o = ji(i);
  if (!o)
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((a = t.model) == null ? void 0 : a.trim()) || Ae,
      error: "Vision analysis did not return valid JSON."
    };
  try {
    const d = JSON.parse(o);
    return {
      assetId: t.assetId,
      status: "ready",
      summary: typeof d.summary == "string" ? d.summary.trim() : void 0,
      tone: Array.isArray(d.tone) ? d.tone.filter((m) => typeof m == "string") : void 0,
      pacing: typeof d.pacing == "string" ? d.pacing.trim() : void 0,
      shotTypes: Array.isArray(d.shotTypes) ? d.shotTypes.filter((m) => typeof m == "string") : void 0,
      subjects: Array.isArray(d.subjects) ? d.subjects.filter((m) => typeof m == "string") : void 0,
      brollIdeas: Array.isArray(d.brollIdeas) ? d.brollIdeas.filter((m) => typeof m == "string") : void 0,
      confidence: typeof d.confidence == "number" && Number.isFinite(d.confidence) ? d.confidence : void 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      model: ((u = t.model) == null ? void 0 : u.trim()) || Ae,
      sourceFrameCount: e.length
    };
  } catch {
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((l = t.model) == null ? void 0 : l.trim()) || Ae,
      error: "Vision analysis JSON parse failed."
    };
  }
}
async function Di(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await ba(t.apiKey, t.videoPath).catch(() => null);
  if (!e)
    throw new Error("Could not upload the video file for analysis.");
  z.fal.config({ credentials: t.apiKey });
  const r = (await z.fal.subscribe("fal-ai/video-understanding", {
    input: {
      video_url: e,
      prompt: t.prompt.trim() || "Describe this video in detail.",
      detailed_analysis: t.detailedAnalysis ?? !0
    },
    logs: !0
  })).data, i = ue(r.output) || ue(r.text) || ue(r.description) || ue(r);
  if (!i.trim())
    throw new Error("Video analysis returned an empty response.");
  return i.trim();
}
async function Sa(t) {
  var o;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await Kt(t.apiKey, t.imagePath).catch(() => null);
  if (!e)
    throw new Error("Could not upload the image file for analysis.");
  z.fal.config({ credentials: t.apiKey });
  const r = (await z.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((o = t.model) == null ? void 0 : o.trim()) || Ae,
      prompt: t.prompt.trim() || "Describe this image in detail.",
      image_urls: [e],
      max_tokens: 900
    },
    logs: !0
  })).data, i = ue(r.output) || ue(r.text) || ue(r);
  if (!i.trim())
    throw new Error("Image analysis returned an empty response.");
  return i.trim();
}
async function xa(t) {
  var s, c;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = Math.min(12, Math.max(1, Math.round(t.maxObjects ?? 6))), n = await Kt(t.apiKey, t.imagePath).catch(() => null);
  if (!n)
    return {
      status: "missing",
      model: ((s = t.model) == null ? void 0 : s.trim()) || Ae,
      objects: [],
      error: "No image was available to upload for auto segmentation."
    };
  const r = ((c = t.model) == null ? void 0 : c.trim()) || Ae, i = [
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
    const a = await Fr(t.apiKey, n, r, e, i), u = a ? Mr(a, e) : [];
    if (u.length > 0)
      return console.info("[vision:auto-seg] Primary object proposals", {
        model: r,
        count: u.length,
        objects: u,
        context: t.context ?? null
      }), {
        status: "ready",
        model: r,
        objects: u
      };
    const l = await Fr(t.apiKey, n, r, e, o), d = l ? Mr(l, e) : [];
    return d.length > 0 ? (console.info("[vision:auto-seg] Retry object proposals", {
      model: r,
      count: d.length,
      objects: d,
      context: t.context ?? null
    }), {
      status: "ready",
      model: r,
      objects: d
    }) : (console.warn("[vision:auto-seg] No usable objects found after both prompts", {
      model: r,
      primaryKeys: a ? Object.keys(a).slice(0, 12) : [],
      retryKeys: l ? Object.keys(l).slice(0, 12) : [],
      primaryPreview: a ? JSON.stringify(a).slice(0, 1e3) : "",
      retryPreview: l ? JSON.stringify(l).slice(0, 1e3) : "",
      context: t.context ?? null
    }), {
      status: "ready",
      model: r,
      objects: []
    });
  } catch (a) {
    const u = a instanceof Error ? a.message : String(a);
    return console.error("[vision:auto-seg] Detection failed", {
      model: r,
      context: t.context ?? null,
      error: u,
      stack: a instanceof Error ? a.stack : void 0
    }), {
      status: "failed",
      model: r,
      objects: [],
      error: u || "Vision auto-segmentation failed."
    };
  }
}
function Ia() {
  R.handle("vision:index-asset", async (t, e) => Li(e)), R.handle("vision:detect-objects", async (t, e) => xa(e));
}
const Aa = "anthropic/claude-sonnet-4.6";
function te(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : null;
}
function Ra(t) {
  if (!t || typeof t != "object") return;
  const e = t, n = te(e.prompt_tokens) ?? 0, r = te(e.completion_tokens) ?? 0, i = te(e.total_tokens) ?? n + r, o = te(e.cost) ?? 0;
  if (!(n <= 0 && r <= 0 && i <= 0 && o <= 0))
    return { promptTokens: n, completionTokens: r, totalTokens: i, cost: o };
}
function _t(t, e) {
  return t ? e ? {
    promptTokens: t.promptTokens + e.promptTokens,
    completionTokens: t.completionTokens + e.completionTokens,
    totalTokens: t.totalTokens + e.totalTokens,
    cost: t.cost + e.cost
  } : t : e;
}
function Na(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
async function Ve(t) {
  var o;
  z.fal.config({ credentials: t.apiKey });
  const e = {
    model: ((o = t.model) == null ? void 0 : o.trim()) || Aa,
    prompt: t.prompt,
    max_tokens: Number.isFinite(t.maxTokens) ? Math.max(1, Math.floor(t.maxTokens)) : 1600
  };
  typeof t.systemPrompt == "string" && t.systemPrompt.trim() && (e.system_prompt = t.systemPrompt.trim()), typeof t.temperature == "number" && Number.isFinite(t.temperature) && (e.temperature = t.temperature);
  const r = (await z.fal.subscribe("openrouter/router", { input: e, logs: !0 })).data;
  return {
    message: (typeof r.output == "string" ? r.output : typeof r.text == "string" ? r.text : "").trim(),
    usage: Ra(r.usage)
  };
}
function Hn(t) {
  const e = t.trim();
  if (!e) return null;
  try {
    return JSON.parse(e), e;
  } catch {
  }
  const n = e.indexOf("{"), r = e.lastIndexOf("}");
  if (n >= 0 && r > n) {
    const i = e.slice(n, r + 1);
    try {
      return JSON.parse(i), i;
    } catch {
      return null;
    }
  }
  return null;
}
function Oa(t) {
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
function Pa(t, e = 3) {
  const n = te(t);
  return n === null ? e : n <= 1 ? 1 : 3;
}
function ka(t, e) {
  const n = t.toLowerCase(), r = /promo|trailer|hype|teaser|sizzle|ad|commercial/.test(n), i = /tiktok|reel|short|vertical|social/.test(n), o = r ? "promo" : i ? "social short" : "documentary interview", s = r ? "promo-trailer-editor" : i ? "social-shortform-editor" : "documentary-editor", c = e.referenceTimelines.find((a) => a.timelineId === e.activeTimelineId);
  return {
    pieceType: o,
    deliverable: o,
    audience: r ? "broad promotional audience" : "documentary/story audience",
    tone: r ? "energetic and emotionally propulsive" : "grounded, human, story-first",
    pacing: r ? "punchy" : "measured",
    targetDurationSeconds: i ? 30 : 180,
    variantCount: 3,
    persona: s,
    storyGoal: r ? "Hook quickly, escalate energy, and land a strong final beat." : "Find the emotional spine and shape it into a clear arc.",
    hook: r ? "Open with the strongest visual or emotional hook." : "Open on the most emotionally revealing line.",
    formatNotes: "Use word-level timestamps when available and prefer complete thoughts.",
    qualityGoal: "auto",
    referenceTimelineId: c == null ? void 0 : c.timelineId,
    referenceTimelineName: c == null ? void 0 : c.timelineName,
    useBrollPlaceholders: !0,
    confidence: 0.55,
    rationale: "Fallback brief inferred from request keywords and active project context."
  };
}
function Ca(t) {
  return Array.isArray(t) ? t.flatMap((e, n) => {
    if (!e || typeof e != "object") return [];
    const r = e, i = typeof r.question == "string" ? r.question.trim() : "";
    if (!i) return [];
    const o = Array.isArray(r.options) ? r.options.flatMap((s, c) => {
      if (!s || typeof s != "object") return [];
      const a = s, u = typeof a.label == "string" ? a.label.trim() : "";
      return u ? [{
        id: typeof a.id == "string" && a.id.trim() ? a.id.trim() : `opt_${n + 1}_${c + 1}`,
        label: u,
        description: typeof a.description == "string" ? a.description.trim() : void 0
      }] : [];
    }) : [];
    return [{
      id: typeof r.id == "string" && r.id.trim() ? r.id.trim() : `question_${n + 1}`,
      question: i,
      help: typeof r.help == "string" ? r.help.trim() : void 0,
      allowCustom: r.allowCustom !== !1,
      options: o
    }];
  }) : [];
}
function Ua(t, e) {
  if (!t || typeof t != "object")
    return { brief: e, clarifyingQuestions: [] };
  const n = t;
  return {
    brief: {
      pieceType: typeof n.pieceType == "string" && n.pieceType.trim() ? n.pieceType.trim() : e.pieceType,
      deliverable: typeof n.deliverable == "string" && n.deliverable.trim() ? n.deliverable.trim() : e.deliverable,
      audience: typeof n.audience == "string" && n.audience.trim() ? n.audience.trim() : e.audience,
      tone: typeof n.tone == "string" && n.tone.trim() ? n.tone.trim() : e.tone,
      pacing: typeof n.pacing == "string" && n.pacing.trim() ? n.pacing.trim() : e.pacing,
      targetDurationSeconds: Math.max(5, te(n.targetDurationSeconds) ?? e.targetDurationSeconds),
      variantCount: Pa(n.variantCount, e.variantCount),
      persona: Oa(n.persona),
      storyGoal: typeof n.storyGoal == "string" && n.storyGoal.trim() ? n.storyGoal.trim() : e.storyGoal,
      hook: typeof n.hook == "string" && n.hook.trim() ? n.hook.trim() : e.hook,
      formatNotes: typeof n.formatNotes == "string" && n.formatNotes.trim() ? n.formatNotes.trim() : e.formatNotes,
      qualityGoal: n.qualityGoal === "story" || n.qualityGoal === "retention" || n.qualityGoal === "clarity" || n.qualityGoal === "auto" ? n.qualityGoal : e.qualityGoal,
      referenceTimelineId: typeof n.referenceTimelineId == "string" && n.referenceTimelineId.trim() ? n.referenceTimelineId.trim() : e.referenceTimelineId,
      referenceTimelineName: typeof n.referenceTimelineName == "string" && n.referenceTimelineName.trim() ? n.referenceTimelineName.trim() : e.referenceTimelineName,
      useBrollPlaceholders: typeof n.useBrollPlaceholders == "boolean" ? n.useBrollPlaceholders : e.useBrollPlaceholders,
      confidence: Math.min(1, Math.max(0, te(n.confidence) ?? e.confidence)),
      rationale: typeof n.rationale == "string" && n.rationale.trim() ? n.rationale.trim() : e.rationale
    },
    clarifyingQuestions: Ca(n.clarifyingQuestions)
  };
}
function ja(t, e, n) {
  const r = { ...t, ...e ?? {} };
  if (n) {
    const i = Object.entries(n).map(([o, s]) => `${o}: ${s}`).filter((o) => !o.endsWith(": "));
    i.length > 0 && (r.formatNotes = `${r.formatNotes}
Clarifications:
${i.join(`
`)}`.trim(), r.rationale = `${r.rationale} Clarifications were provided by the user.`);
  }
  return r;
}
function $r(t) {
  const e = Number(t);
  return Number.isFinite(e) ? Math.max(0, e) : null;
}
function La(t) {
  if (!t || typeof t != "object") return null;
  const e = t, n = $r(e.source_start), r = $r(e.source_end);
  if (n === null || r === null || r <= n) return null;
  const i = typeof e.asset_id == "string" && e.asset_id.trim() ? e.asset_id.trim() : void 0, o = typeof e.asset_name == "string" && e.asset_name.trim() ? e.asset_name.trim() : void 0;
  return !i && !o ? null : {
    ...i ? { asset_id: i } : {},
    ...o ? { asset_name: o } : {},
    source_start: n,
    source_end: r,
    ...typeof e.note == "string" && e.note.trim() ? { note: e.note.trim() } : {}
  };
}
function Da(t, e) {
  if (!t || typeof t != "object") return null;
  const n = t, r = Array.isArray(n.segments) ? n.segments.map(La).filter((i) => !!i) : [];
  return r.length === 0 ? null : {
    type: "cut_proposal",
    summary: typeof n.summary == "string" && n.summary.trim() ? n.summary.trim() : `Proposed ${r.length} cut segments.`,
    timeline_name: typeof n.timeline_name == "string" && n.timeline_name.trim() ? n.timeline_name.trim() : e,
    should_create_timeline: typeof n.should_create_timeline == "boolean" ? n.should_create_timeline : !1,
    segments: r
  };
}
function Ma(t) {
  if (!t || typeof t != "object") return [];
  const e = t;
  return Array.isArray(e.variants) ? e.variants.flatMap((n, r) => {
    var s;
    if (!n || typeof n != "object") return [];
    const i = n, o = Array.isArray(i.proposals) ? i.proposals.map((c) => Da(c, `AI Cut ${r + 1}`)).filter((c) => !!c) : [];
    return o.length === 0 ? [] : [{
      id: typeof i.id == "string" && i.id.trim() ? i.id.trim() : `variant_${r + 1}`,
      title: typeof i.title == "string" && i.title.trim() ? i.title.trim() : `Variant ${r + 1}`,
      strategy: typeof i.strategy == "string" && i.strategy.trim() ? i.strategy.trim() : "Balanced editorial approach",
      summary: typeof i.summary == "string" && i.summary.trim() ? i.summary.trim() : ((s = o[0]) == null ? void 0 : s.summary) ?? "Proposed edit.",
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
function Fa(t, e) {
  if (!t || typeof t != "object") return e;
  const n = t, r = Array.isArray(n.scorecards) ? n.scorecards : [], i = /* @__PURE__ */ new Map();
  for (const c of r) {
    if (!c || typeof c != "object") continue;
    const a = c, u = typeof a.variant_id == "string" ? a.variant_id.trim() : "";
    u && i.set(u, {
      overall: te(a.overall) ?? 78,
      storyArc: te(a.storyArc) ?? 78,
      pacing: te(a.pacing) ?? 78,
      clarity: te(a.clarity) ?? 78,
      visualFit: te(a.visualFit) ?? 78,
      completeness: te(a.completeness) ?? 78,
      formatFit: te(a.formatFit) ?? 78,
      strengths: Array.isArray(a.strengths) ? a.strengths.filter((l) => typeof l == "string") : [],
      cautions: Array.isArray(a.cautions) ? a.cautions.filter((l) => typeof l == "string") : [],
      rationale: typeof a.rationale == "string" ? a.rationale.trim() : ""
    });
  }
  const o = Array.isArray(n.ranked_variant_ids) ? n.ranked_variant_ids.filter((c) => typeof c == "string") : e.map((c) => c.id), s = [...e].map((c, a) => ({
    ...c,
    scorecard: i.get(c.id) ?? {
      overall: 78 - a,
      storyArc: 78 - a,
      pacing: 78 - a,
      clarity: 78 - a,
      visualFit: 78 - a,
      completeness: 78 - a,
      formatFit: 78 - a,
      strengths: ["No judge score available; kept generation order."],
      cautions: [],
      rationale: "Judge pass was unavailable, so the generation order was preserved."
    }
  }));
  return s.sort((c, a) => {
    const u = o.indexOf(c.id), l = o.indexOf(a.id);
    return u === -1 && l === -1 ? a.scorecard.overall - c.scorecard.overall : u === -1 ? 1 : l === -1 ? -1 : u - l;
  }), s;
}
function $a(t) {
  return t.referenceTimelines.slice(0, 5).map((e) => `- ${e.timelineName}${e.isActive ? " (active)" : ""}: ${e.structureSummary}; primary assets: ${e.primaryAssets.join(", ") || "none"}`).join(`
`);
}
function Mi(t) {
  return t.slice(0, 18).map((e, n) => {
    const r = e.timelinePlacements[0], i = r ? ` | timeline: ${r.timelineName} @ ${r.timelineTime.toFixed(1)}` : "", o = e.words.length > 0 ? `
   Word timings: ${e.words.slice(0, 18).map((s) => `${s.word}@${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(" ")}` : "";
    return `${n + 1}. ${e.assetName} ${e.sourceStart.toFixed(1)}-${e.sourceEnd.toFixed(1)}${i}
   ${e.text}
   Reason: ${e.reason}${o}`;
  }).join(`
`);
}
function Ba(t) {
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
async function Ha(t) {
  var i;
  const e = new Set(t.retrievedMoments.map((o) => o.assetId)), n = t.visualCandidates.filter((o) => e.has(o.assetId)).slice(0, 4), r = [];
  for (const o of n) {
    if (((i = o.storedSummary) == null ? void 0 : i.status) === "ready" && (!t.model || o.storedSummary.model === t.model)) {
      r.push(o.storedSummary);
      continue;
    }
    r.push(await Li({
      apiKey: t.apiKey,
      assetId: o.assetId,
      assetName: o.assetName,
      framePaths: o.framePaths,
      model: t.model
    }));
  }
  return r;
}
async function qa(t) {
  var o;
  const e = ka(t.request, t.index), n = [
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
    $a(t.index)
  ].join(`
`), r = await Ve({
    apiKey: t.apiKey,
    model: t.model,
    systemPrompt: [
      "You produce concise, grounded editorial briefs for film and promo editors.",
      ((o = t.customSystemPrompt) == null ? void 0 : o.trim()) || ""
    ].filter(Boolean).join(`

`),
    prompt: n,
    maxTokens: 900,
    temperature: 0.35
  }), i = Hn(r.message);
  if (!i)
    return { brief: e, clarifyingQuestions: [], usage: r.usage };
  try {
    const s = JSON.parse(i);
    return { ...Ua(s, e), usage: r.usage };
  } catch {
    return { brief: e, clarifyingQuestions: [], usage: r.usage };
  }
}
async function Br(t, e, n, r, i = {}) {
  const o = [e, n.storyGoal, n.hook, n.tone, n.audience].join(" ");
  let s = _a(t, o, { limit: 20, persona: n.persona });
  if (i.rerank && i.apiKey && s.length > 1)
    try {
      const a = pa({ query: o, brief: n, candidates: s }), u = await Ve({
        apiKey: i.apiKey,
        model: i.model,
        systemPrompt: "You re-rank candidate video moments for an editor. Return JSON only.",
        prompt: a,
        maxTokens: 500,
        temperature: 0.2
      });
      s = ga(s, u.message);
    } catch {
    }
  const c = r.filter((a) => a.status === "ready").length;
  return {
    topMoments: s,
    referenceTimelines: t.referenceTimelines.slice(0, 4),
    visualSummaryStatus: c <= 0 ? "none" : c < Math.max(1, s.length) ? "partial" : "ready",
    note: s.length > 0 ? `Retrieved ${s.length} transcript-driven source moments${c > 0 ? ` and ${c} visual summaries` : ""}.` : "No high-confidence transcript moments were retrieved; generation should stay conservative."
  };
}
async function Wa(t) {
  var u;
  const e = (l, d) => {
    const m = Hn(l);
    if (!m) return null;
    try {
      const f = JSON.parse(m), y = Ma({ variants: [f] })[0];
      return y ? {
        variant: y,
        usage: d
      } : null;
    } catch {
      return null;
    }
  }, n = async (l, d) => {
    const m = [
      `Repair this malformed cut-variant response into valid JSON for variant ${d + 1}.`,
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "Do not add commentary before or after the JSON.",
      "If part of the raw output was truncated, salvage one valid variant.",
      "",
      "Malformed response:",
      l
    ].join(`
`), f = await Ve({
      apiKey: t.apiKey,
      model: t.model,
      systemPrompt: "You repair malformed structured editor outputs. Return strict JSON only.",
      prompt: m,
      maxTokens: 4200,
      temperature: 0.1
    }), g = e(f.message, f.usage);
    return g || {
      variant: null,
      usage: f.usage
    };
  }, r = t.brief.variantCount, i = `${t.brief.pieceType} ${t.brief.deliverable} ${t.brief.tone}`.toLowerCase(), s = (/promo|trailer|social|teaser|hype/.test(i) ? [
    "Hook-first build: open with the strongest reveal, escalate momentum, and land a clean payoff.",
    "Character-first build: anchor emotionally first, then accelerate into the strongest theme beat.",
    "Payoff-first reverse build: tease the outcome early, then build toward why it matters."
  ] : [
    "Chronological emotional arc: move from foundation into escalation and close on the strongest emotional beat.",
    "Theme-first structure: organize around the core idea instead of strict chronology, favoring emotional clarity.",
    "Cold-open documentary structure: open on the strongest line, then rewind and build a layered arc."
  ]).slice(0, r);
  let c;
  const a = [];
  for (let l = 0; l < s.length; l += 1) {
    const m = [
      "You are CineGen's lead editor creating one high-quality cut proposal.",
      `Generate exactly one editorial variant using this strategy: ${s[l]}`,
      "Use the retrieved moments and visual findings as evidence. Do not invent content outside them.",
      "Use word-level source timings when possible and cut tighter than sentence edges when the request calls for it.",
      "Do not include any prose before or after the JSON.",
      "Keep notes concise and practical.",
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "If the user asked for multiple parts, the variant may include multiple proposals, one per part.",
      a.length > 0 ? `Already generated variants (do something meaningfully different):
${JSON.stringify(a.map((h) => ({ title: h.title, strategy: h.strategy, summary: h.summary })), null, 2)}` : "",
      "",
      "Editorial brief:",
      JSON.stringify(t.brief, null, 2),
      "",
      "Retrieved moments:",
      Mi(t.retrievalSummary.topMoments),
      "",
      "Reference timelines:",
      t.retrievalSummary.referenceTimelines.map((h) => `- ${h.timelineName}: ${h.structureSummary}`).join(`
`) || "- none",
      "",
      "Visual findings:",
      Ba(t.visualFindings) || "- none",
      "",
      `Original request: ${t.request}`
    ].filter(Boolean).join(`
`), f = await Ve({
      apiKey: t.apiKey,
      model: t.model,
      systemPrompt: [
        "You are a world-class editor. Make proposals that feel genuinely cuttable, not generic.",
        "When the brief reads documentary/interview, think like a documentary filmmaker shaping a story arc.",
        "When the brief reads promo/trailer/social, think like a promo editor optimizing hook, pacing, and payoff.",
        ((u = t.customSystemPrompt) == null ? void 0 : u.trim()) || ""
      ].filter(Boolean).join(`

`),
      prompt: m,
      maxTokens: 2400,
      temperature: 0.45
    });
    c = _t(c, f.usage);
    const g = e(f.message, f.usage);
    if (g != null && g.variant) {
      a.push({
        ...g.variant,
        id: `variant_${l + 1}`
      });
      continue;
    }
    const y = await n(f.message, l);
    c = _t(c, y.usage), y.variant && a.push({
      ...y.variant,
      id: `variant_${l + 1}`
    });
  }
  return a.length === 0 ? {
    variants: [],
    summaryMessage: "I hit a formatting issue while packaging the cut variants. Review the brief and try again.",
    usage: c
  } : {
    variants: a,
    summaryMessage: a.length === 1 ? "I generated one cut variant. Review it below." : `I generated ${a.length} cut variants. Review the options below.`,
    usage: c
  };
}
async function za(t) {
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
    Mi(t.retrievalSummary.topMoments.slice(0, 10)),
    "",
    "Variants:",
    JSON.stringify(t.variants.map((o) => ({
      id: o.id,
      title: o.title,
      strategy: o.strategy,
      summary: o.summary,
      rationale: o.rationale,
      proposalSummaries: o.proposals.map((s) => ({
        timeline_name: s.timeline_name,
        summary: s.summary,
        segmentCount: s.segments.length,
        firstSegments: s.segments.slice(0, 4)
      }))
    })), null, 2)
  ].join(`
`), n = await Ve({
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
  }), r = Hn(n.message);
  if (!r) return { variants: t.variants, usage: n.usage };
  try {
    const o = JSON.parse(r);
    return {
      variants: Fa(o, t.variants),
      usage: n.usage
    };
  } catch {
    return { variants: t.variants, usage: n.usage };
  }
}
async function Xa(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = t.index, n = t.request.trim();
  if (!n) throw new Error("No cut request provided.");
  let r;
  const i = await qa({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: n,
    index: e
  });
  r = _t(r, i.usage);
  const o = ja(i.brief, t.briefOverride, t.questionAnswers), s = await Br(e, n, o, []);
  if (!t.confirmedBrief)
    return {
      stage: "brief",
      summaryMessage: i.clarifyingQuestions.length > 0 ? "I drafted an editorial brief and I need a bit of guidance before generating the cut variants." : "I drafted the editorial brief. Review it, adjust anything you want, then generate the cut variants.",
      editorialBrief: o,
      clarifyingQuestions: i.clarifyingQuestions,
      retrievalSummary: s,
      visualFindings: [],
      variants: [],
      ...r ? { usage: r } : {}
    };
  const c = await Ha({
    apiKey: t.apiKey,
    visualCandidates: e.visualInputs,
    retrievedMoments: s.topMoments,
    model: t.visionModel
  }), a = await Br(e, n, o, c, {
    apiKey: t.apiKey,
    model: t.model,
    rerank: o.qualityGoal !== "auto"
  }), u = await Wa({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: n,
    brief: o,
    retrievalSummary: a,
    visualFindings: c
  });
  if (r = _t(r, u.usage), u.variants.length === 0)
    return {
      stage: "brief",
      summaryMessage: u.summaryMessage,
      editorialBrief: o,
      clarifyingQuestions: i.clarifyingQuestions,
      retrievalSummary: a,
      visualFindings: c,
      variants: [],
      ...r ? { usage: r } : {}
    };
  const l = await za({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    brief: o,
    retrievalSummary: a,
    variants: u.variants
  });
  return r = _t(r, l.usage), {
    stage: "variants",
    summaryMessage: u.summaryMessage,
    editorialBrief: o,
    clarifyingQuestions: i.clarifyingQuestions,
    retrievalSummary: a,
    visualFindings: c,
    variants: l.variants,
    ...r ? { usage: r } : {}
  };
}
const Fi = "http://127.0.0.1:11434";
function Ga() {
  return Y.getAllWindows().find((t) => !t.isDestroyed());
}
async function Ka(t, e) {
  var y, h;
  const n = ((y = e.model) == null ? void 0 : y.trim()) || "qwen3.5:latest", r = [];
  (h = e.systemPrompt) != null && h.trim() && r.push({ role: "system", content: e.systemPrompt.trim() });
  for (const p of e.messages ?? [])
    p.content.trim() && r.push({ role: p.role, content: p.content.trim() });
  if (r.length === 0 || r.every((p) => p.role === "system"))
    throw new Error("No chat messages provided.");
  const i = {
    model: n,
    messages: r,
    stream: !0,
    think: !1,
    options: {
      ...Number.isFinite(e.temperature) ? { temperature: e.temperature } : {},
      ...Number.isFinite(e.maxTokens) && e.maxTokens > 0 ? { num_predict: Math.floor(e.maxTokens) } : {}
    }
  }, o = await fetch(`${Fi}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(i)
  });
  if (!o.ok) {
    const p = await o.text().catch(() => "");
    throw new Error(`Ollama request failed (${o.status}): ${p || o.statusText}`);
  }
  const s = Ga();
  let c = "", a = 0, u = 0, l = !1, d = "";
  const m = o.body.getReader(), f = new TextDecoder();
  let g = "";
  for (; ; ) {
    const { done: p, value: w } = await m.read();
    if (p) break;
    g += f.decode(w, { stream: !0 });
    let E;
    for (; (E = g.indexOf(`
`)) >= 0; ) {
      const T = g.slice(0, E).trim();
      if (g = g.slice(E + 1), !!T)
        try {
          const x = JSON.parse(T), b = x.message, S = typeof (b == null ? void 0 : b.content) == "string" ? b.content : "";
          if (S)
            for (const v of S)
              l ? (d += v, d.endsWith("</think>") && (l = !1, d = "")) : (d += v, d === "<think>" ? (l = !0, d = "") : "<think>".startsWith(d) || (c += d, s == null || s.webContents.send("llm:local-stream", { requestId: t, token: d }), d = ""));
          x.done && (a = te(x.prompt_eval_count) ?? 0, u = te(x.eval_count) ?? 0);
        } catch {
        }
    }
  }
  return d && !l && (c += d, s == null || s.webContents.send("llm:local-stream", { requestId: t, token: d })), s == null || s.webContents.send("llm:local-stream", { requestId: t, done: !0 }), {
    message: c.trim(),
    usage: a > 0 || u > 0 ? { promptTokens: a, completionTokens: u, totalTokens: a + u, cost: 0 } : void 0
  };
}
async function Ja() {
  try {
    const t = await fetch(`${Fi}/api/tags`);
    return t.ok ? ((await t.json()).models ?? []).map((n) => n.name) : [];
  } catch {
    return [];
  }
}
function Va() {
  R.handle("llm:chat", async (t, e) => {
    const n = e.apiKey;
    if (!n) throw new Error("No fal.ai API key provided.");
    const r = Array.isArray(e.messages) ? e.messages : [], i = Na(r);
    if (!i.trim()) throw new Error("No chat prompt provided.");
    const o = await Ve({
      apiKey: n,
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
  }), R.handle("llm:local-chat", async (t, e) => {
    const n = e.requestId || crypto.randomUUID(), r = await Ka(n, e);
    return {
      message: r.message,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), R.handle("llm:local-models", async () => Ja()), R.handle("llm:run-cut-workflow", async (t, e) => Xa(e));
}
const $i = Un(vt), Ya = [
  _.join(W.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
], Qa = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "When an ACTIVE SKILL section is present, follow it directly in chat — never invoke Skill tool or slash commands.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), Za = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "CineGen SKILLS are in the system prompt — list them directly; never use Skill tool or say you will check.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), ec = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" "), tc = "", nc = "2";
let Pt, Re = null;
function qn() {
  const t = W.homedir(), e = [
    _.join(t, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ], n = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...e, n].filter(Boolean).join(_.delimiter)
  };
}
async function Bi() {
  if (Pt !== void 0) return Pt;
  for (const t of Ya)
    try {
      const { stdout: e } = await $i(t, ["--version"], {
        env: qn(),
        timeout: 8e3
      });
      if (e.toLowerCase().includes("claude"))
        return Pt = t, t;
    } catch {
    }
  return Pt = null, null;
}
function rc() {
  return Y.getAllWindows().find((t) => !t.isDestroyed());
}
function ic(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
function Hr(t) {
  const e = t.usage;
  if (!e || typeof e != "object") return;
  const n = Number(e.input_tokens) || 0, r = Number(e.cache_creation_input_tokens) || 0, i = Number(e.cache_read_input_tokens) || 0, o = n + r + i, s = Number(e.output_tokens) || 0, c = o + s, a = Number(t.total_cost_usd) || 0;
  if (!(o <= 0 && s <= 0 && c <= 0 && a <= 0))
    return { promptTokens: o, completionTokens: s, totalTokens: c, cost: a };
}
function oc(t, e, n) {
  const r = Array.isArray(n == null ? void 0 : n.errors) ? n.errors.filter((o) => typeof o == "string") : [];
  if (r.length > 0)
    return r.join(" ");
  if (typeof (n == null ? void 0 : n.result) == "string" && n.result.trim())
    return n.result.trim();
  if ((n == null ? void 0 : n.subtype) === "error_max_turns")
    return "Claude Code hit its turn limit before finishing a reply. Retry your message — Copilot answers in chat only, without tools.";
  const i = e.trim();
  return i || `Claude Code exited with code ${t ?? "unknown"}`;
}
function sc(t) {
  if (t.type === "stream_event") {
    const e = t.event, n = e == null ? void 0 : e.delta;
    if ((n == null ? void 0 : n.type) === "text_delta" && typeof n.text == "string")
      return n.text;
  }
  if (t.type === "assistant") {
    const e = t.message;
    return ((e == null ? void 0 : e.content) ?? []).filter((n) => n.type === "text" && typeof n.text == "string").map((n) => n.text).join("");
  }
  return t.type === "result" && typeof t.result == "string" ? t.result : "";
}
function ac(t) {
  if (t.injectProjectContext) {
    const e = (t.messages ?? []).filter((n) => n.content.trim());
    if (e.length > 0)
      return ic(e);
  }
  return `${t.userMessage.trim()}

Assistant:
`;
}
async function cc(t, e) {
  var g, y, h;
  const n = await Bi();
  if (!n)
    throw new Error("Claude Code is not installed. Install it from https://code.claude.com");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const r = ((g = e.model) == null ? void 0 : g.trim()) || "sonnet", i = !!e.resumeSessionId && !e.injectProjectContext, o = [
    "-p",
    i ? e.userMessage.trim() : ac(e),
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--max-turns",
    nc,
    "--model",
    r,
    "--tools",
    tc,
    "--disable-slash-commands"
  ];
  if (i && e.resumeSessionId) {
    o.push("--resume", e.resumeSessionId);
    const p = [(y = e.systemPrompt) == null ? void 0 : y.trim(), Za].filter(Boolean).join(`

`);
    o.push("--append-system-prompt", p);
  } else if (e.injectProjectContext && ((h = e.systemPrompt) != null && h.trim())) {
    const p = e.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "", w = e.purpose === "enhance-prompt" ? ec : Qa;
    o.push("--append-system-prompt", `${p}${e.systemPrompt.trim()}

${w}`);
  }
  const s = rc();
  let c = "", a = "", u, l = !1, d = !1, m, f;
  return new Promise((p, w) => {
    var x, b;
    const E = ne(n, o, {
      env: qn(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    Re = { child: E, requestId: t };
    let T = "";
    (x = E.stdout) == null || x.on("data", (S) => {
      T += S.toString();
      let v;
      for (; (v = T.indexOf(`
`)) >= 0; ) {
        const I = T.slice(0, v).trim();
        if (T = T.slice(v + 1), !!I)
          try {
            const O = JSON.parse(I);
            O.type === "system" && O.subtype === "init" && typeof O.session_id == "string" && (u = O.session_id), O.type === "assistant" && O.error === "authentication_failed" && (l = !0), O.type === "result" && (f = O);
            const U = Hr(O);
            if (U)
              m = U;
            else if (O.type === "assistant") {
              const $ = O.message;
              if ($ != null && $.usage) {
                const H = Hr({ usage: $.usage });
                H && (m = H);
              }
            }
            const M = sc(O);
            if (!M) continue;
            if (O.type === "stream_event") {
              d = !0, c += M, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: M });
              continue;
            }
            O.type === "assistant" && !d ? (c = M, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: M })) : O.type === "result" && !c.trim() && (c = M, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, token: M }));
          } catch {
          }
      }
    }), (b = E.stderr) == null || b.on("data", (S) => {
      a += S.toString();
    }), E.on("error", (S) => {
      Re = null, w(S);
    }), E.on("close", (S) => {
      Re = null, s == null || s.webContents.send("llm:claude-code-stream", { requestId: t, done: !0 });
      const v = c.trim();
      if (l || v.includes("Not logged in")) {
        w(new Error("Claude Code is not logged in. Open Terminal, run `claude`, and sign in with your subscription."));
        return;
      }
      if (v) {
        p({ message: v, sessionId: u, usage: m, resumed: i });
        return;
      }
      w(new Error(oc(S, a, f)));
    });
  });
}
function lc() {
  R.handle("llm:claude-code-detect", async () => {
    const t = await Bi();
    if (!t)
      return { installed: !1 };
    try {
      const { stdout: e } = await $i(t, ["--version"], {
        env: qn(),
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
  }), R.handle("llm:claude-code-chat", async (t, e) => {
    const n = e.requestId || G.randomUUID(), r = await cc(n, e);
    return {
      message: r.message,
      sessionId: r.sessionId,
      resumed: r.resumed,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), R.handle("llm:claude-code-cancel", async (t, e) => {
    (Re == null ? void 0 : Re.requestId) === e && (Re.child.kill("SIGTERM"), Re = null);
  });
}
const Hi = Un(vt), uc = {
  "claude-code": [
    _.join(W.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "claude"
  ],
  codex: [
    _.join(W.homedir(), ".npm-global/bin/codex"),
    _.join(W.homedir(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "codex"
  ],
  gemini: [
    _.join(W.homedir(), ".npm-global/bin/gemini"),
    _.join(W.homedir(), ".local/bin/gemini"),
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
    "gemini"
  ]
}, kt = /* @__PURE__ */ new Map();
function Jt() {
  const t = W.homedir(), e = [
    _.join(t, ".local/bin"),
    _.join(t, ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ], n = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...e, n].filter(Boolean).join(_.delimiter)
  };
}
function qi() {
  return {
    ...Jt(),
    GEMINI_CLI_TRUST_WORKSPACE: "true",
    TERM: "dumb",
    NO_COLOR: "1"
  };
}
function Rn(t) {
  return t.replace(/\u001b\[[0-9;]*m/g, "");
}
async function Vt(t) {
  if (kt.has(t))
    return kt.get(t) ?? null;
  for (const e of uc[t])
    try {
      const { stdout: n } = await Hi(e, ["--version"], {
        env: Jt(),
        timeout: 8e3
      });
      if (n.trim())
        return kt.set(t, e), e;
    } catch {
    }
  return kt.set(t, null), null;
}
async function hn(t) {
  const e = await Vt(t);
  if (!e)
    return { id: t, installed: !1 };
  try {
    const { stdout: n } = await Hi(e, ["--version"], {
      env: Jt(),
      timeout: 8e3
    });
    return {
      id: t,
      installed: !0,
      path: e,
      version: n.trim()
    };
  } catch {
    return { id: t, installed: !1 };
  }
}
async function dc() {
  return Promise.all([
    hn("claude-code"),
    hn("codex"),
    hn("gemini")
  ]);
}
function Wi() {
  return Y.getAllWindows().find((t) => !t.isDestroyed());
}
function Nn(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
const zi = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), fc = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), Xi = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" ");
function mc() {
  R.handle("llm:cli-detect", async () => ({ providers: await dc() }));
}
let Te = null;
function pc(t) {
  var i;
  const e = [];
  if (t.injectProjectContext && ((i = t.systemPrompt) != null && i.trim())) {
    const o = t.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "", s = t.purpose === "enhance-prompt" ? Xi : zi;
    e.push(`${o}${t.systemPrompt.trim()}

${s}`);
  }
  const n = (t.messages ?? []).filter((o) => o.content.trim()), r = n.length > 0 ? Nn(n) : `${t.userMessage.trim()}

Assistant:
`;
  return e.length > 0 ? `${e.join(`

`)}

${r}` : t.userMessage.trim();
}
function hc(t) {
  const e = t.usage;
  if (!e) return;
  const n = Number(e.input_tokens) || 0, r = Number(e.cached_input_tokens) || 0, i = n + r, o = Number(e.output_tokens) || 0, s = i + o;
  if (!(s <= 0))
    return { promptTokens: i, completionTokens: o, totalTokens: s, cost: 0 };
}
function gc(t) {
  if (t.type !== "item.completed" && t.type !== "item.updated") return "";
  const e = t.item;
  return (e == null ? void 0 : e.type) === "agent_message" && typeof e.text == "string" ? e.text : "";
}
async function yc(t, e) {
  var m;
  const n = await Vt("codex");
  if (!n)
    throw new Error("Codex CLI is not installed. Install it from https://developers.openai.com/codex");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const r = ((m = e.model) == null ? void 0 : m.trim()) || "gpt-5.3-codex", i = !!e.resumeSessionId && !e.injectProjectContext, o = ["exec"];
  i && e.resumeSessionId ? o.push("resume", e.resumeSessionId, e.userMessage.trim()) : o.push(pc(e)), o.push(
    "--json",
    "-s",
    "read-only",
    "-m",
    r,
    "--skip-git-repo-check"
  );
  const s = Wi();
  let c = "", a = "", u, l, d = "";
  return new Promise((f, g) => {
    var p, w;
    const y = ne(n, o, {
      env: Jt(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    Te = { child: y, requestId: t, provider: "codex" };
    let h = "";
    (p = y.stdout) == null || p.on("data", (E) => {
      h += E.toString();
      let T;
      for (; (T = h.indexOf(`
`)) >= 0; ) {
        const x = h.slice(0, T).trim();
        if (h = h.slice(T + 1), !!x)
          try {
            const b = JSON.parse(x);
            b.type === "thread.started" && typeof b.thread_id == "string" && (u = b.thread_id);
            const S = hc(b);
            if (S && (l = S), b.type === "turn.failed") {
              const I = b.error;
              a += (I == null ? void 0 : I.message) ?? "Codex turn failed.";
            }
            const v = gc(b);
            if (v) {
              const I = v.startsWith(d) ? v.slice(d.length) : v;
              d = v, c = v, I && (s == null || s.webContents.send("llm:codex-stream", { requestId: t, token: I }));
            }
          } catch {
          }
      }
    }), (w = y.stderr) == null || w.on("data", (E) => {
      a += E.toString();
    }), y.on("error", (E) => {
      Te = null, g(E);
    }), y.on("close", (E) => {
      Te = null, s == null || s.webContents.send("llm:codex-stream", { requestId: t, done: !0 });
      const T = c.trim();
      if (!T) {
        g(new Error(a.trim() || `Codex exited with code ${E ?? "unknown"}`));
        return;
      }
      f({ message: T, sessionId: u, usage: l, resumed: i });
    });
  });
}
function wc() {
  R.handle("llm:codex-chat", async (t, e) => {
    const n = e.requestId || G.randomUUID(), r = await yc(n, e);
    return {
      message: r.message,
      sessionId: r.sessionId,
      resumed: r.resumed,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), R.handle("llm:codex-cancel", async (t, e) => {
    (Te == null ? void 0 : Te.requestId) !== e || Te.provider !== "codex" || (Te.child.kill("SIGTERM"), Te = null);
  });
}
const Gi = Un(vt), Ec = 90;
function Ke(t) {
  const e = t.trim();
  if (!e) return null;
  const n = [
    e,
    _.resolve(e)
  ];
  for (const r of n)
    if (B.existsSync(r)) return r;
  return null;
}
async function Ki(t, e, n, r) {
  const i = ye(), o = Math.max(0, e), s = Math.max(0.1, Math.min(n, Ec));
  try {
    return await Gi(i, [
      "-y",
      "-ss",
      `${o}`,
      "-i",
      t,
      "-t",
      `${s}`,
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
      r
    ], { timeout: Math.max(12e4, Math.ceil(s * 4e3)) }), B.existsSync(r) ? r : null;
  } catch {
    return null;
  }
}
async function jt(t, e, n) {
  const r = ye();
  try {
    return await Gi(r, [
      "-y",
      "-ss",
      `${Math.max(0, e)}`,
      "-i",
      t,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      n
    ], { timeout: 15e3 }), B.existsSync(n) ? n : null;
  } catch {
    return null;
  }
}
function On(t) {
  return G.createHash("sha1").update(JSON.stringify({
    label: t.label,
    fileRef: t.fileRef,
    trimStartSec: t.trimStartSec,
    trimDurationSec: t.trimDurationSec
  })).digest("hex").slice(0, 12);
}
function Ji(t) {
  return /\s/.test(t);
}
function Vi(t, e) {
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
function gn(t, e, n) {
  if (!Ji(t))
    return { mediaPath: t, ephemeral: !1 };
  const r = _.extname(t) || (e.mediaType === "image" ? ".jpg" : ".mp4"), i = _.join(n, `${On(e)}-source${r}`), o = Vi(t, i);
  return o ? { mediaPath: o, ephemeral: !0 } : null;
}
async function Wn(t, e) {
  const n = _.join(e, "visual-refs");
  B.mkdirSync(n, { recursive: !0 });
  const r = [];
  for (const i of t) {
    const o = Ke(i.fileRef);
    if (!o) continue;
    if (i.mediaType === "image") {
      const l = gn(o, i, n);
      if (!l) continue;
      r.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: l.mediaPath,
        ephemeral: l.ephemeral
      });
      continue;
    }
    if (i.trimStartSec !== void 0 && i.trimDurationSec !== void 0) {
      const l = _.join(n, `${On(i)}.mp4`), d = await Ki(
        o,
        i.trimStartSec,
        i.trimDurationSec,
        l
      );
      if (d) {
        r.push({
          label: i.label,
          kind: i.kind,
          mediaType: "video",
          mediaPath: d,
          ephemeral: !0
        });
        continue;
      }
    }
    const s = _.extname(o).toLowerCase();
    if ([".mp4", ".mov", ".webm", ".m4v", ".avi"].includes(s)) {
      const l = gn(o, i, n);
      if (!l) continue;
      r.push({
        label: i.label,
        kind: i.kind,
        mediaType: "video",
        mediaPath: l.mediaPath,
        ephemeral: l.ephemeral
      });
      continue;
    }
    const c = (i.framePaths ?? []).map((l) => Ke(l)).find(Boolean);
    if (c) {
      const l = gn(c, {
        ...i,
        mediaType: "image",
        fileRef: c
      }, n);
      if (!l) continue;
      r.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: l.mediaPath,
        ephemeral: l.ephemeral
      });
      continue;
    }
    const a = _.join(n, `${On(i)}.jpg`), u = await jt(o, i.trimStartSec ?? 0, a);
    u && r.push({
      label: i.label,
      kind: i.kind,
      mediaType: "image",
      mediaPath: u,
      ephemeral: !0
    });
  }
  return r;
}
function Yi(t, e) {
  if (e.length === 0) return t.trim();
  const n = e.map((o) => `@${o.mediaPath}`).join(" "), r = t.trim();
  return e.some((o) => o.mediaType === "video") ? r ? `${n} ${r}` : `${n} describe this video in detail. Include what you see on screen, the setting, actions, and any spoken audio.` : r ? `${n} ${r}` : `${n} describe this image in detail.`;
}
function zn(t) {
  for (const e of t)
    if (e.ephemeral)
      try {
        B.unlinkSync(e.mediaPath);
      } catch {
      }
}
function Qi(t) {
  const e = t.trim();
  if (!e) return null;
  if (e.startsWith("local-media://file/")) {
    const n = decodeURIComponent(e.replace("local-media://file", ""));
    return Ke(n);
  }
  if (e.startsWith("file://"))
    try {
      return Ke(decodeURIComponent(new URL(e).pathname));
    } catch {
      return null;
    }
  return Ke(e);
}
async function _c(t, e) {
  const n = Qi(t);
  if (!n) throw new Error(`Could not resolve a local source file for: ${t}`);
  const r = _.join(W.tmpdir(), "cinegen-higgsfield-refs");
  B.mkdirSync(r, { recursive: !0 });
  const i = G.randomBytes(6).toString("hex"), o = Math.max(0, e.sourceStartSec ?? 0), s = e.sourceEndSec ?? o;
  if (e.mode === "first-last") {
    const l = _.join(r, `${i}-first.jpg`), d = _.join(r, `${i}-last.jpg`), m = await jt(n, o, l), f = await jt(n, Math.max(o, s - 0.05), d), g = [], y = [];
    if (m && (g.push(m), y.push("start_image")), f && (g.push(f), y.push("end_image")), g.length === 0) throw new Error("Failed to extract first/last frames");
    return { paths: g, roles: y };
  }
  if (e.mode === "segment") {
    const l = _.join(r, `${i}-segment.mp4`), d = Math.max(0.1, s > o ? s - o : e.maxSegmentSec ?? 30), m = await Ki(n, o, Math.min(d, e.maxSegmentSec ?? 30), l);
    if (!m) throw new Error("Failed to extract clip segment");
    return { paths: [m], roles: ["image"] };
  }
  const c = e.frameTimeSec ?? (s > o ? (o + s) / 2 : o), a = _.join(r, `${i}-frame.jpg`), u = await jt(n, c, a);
  if (!u) throw new Error("Failed to extract reference frame");
  return { paths: [u], roles: ["image"] };
}
function Tc(t) {
  return /\b(cannot|can't|do not have the ability|unable to|not able to)\b[\s\S]{0,100}\b(video|visual|auditory|audio|mp4|mov|footage|media file)\b/i.test(t) || /\btools do not allow\b[\s\S]{0,60}\b(video|visual|auditory|mp4)\b/i.test(t);
}
class Bt extends Error {
}
const vc = 18e4, bc = 600 * 1e3;
async function Zi(t) {
  var l;
  const e = await Vt("gemini");
  if (!e)
    throw new Bt("Gemini CLI is not installed.");
  const n = Ke(t.mediaPath);
  if (!n)
    throw new Error(`Media file not found: ${t.mediaPath}`);
  const r = _.join(W.tmpdir(), "cinegen-gemini-acoustic");
  await Dt(r, { recursive: !0 });
  let i = n, o = !1;
  if (Ji(n)) {
    const d = _.extname(n) || ".mp4", m = _.join(r, `${G.randomUUID()}${d}`), f = Vi(n, m);
    if (!f)
      throw new Error("Could not stage the media file for Gemini analysis.");
    i = f, o = !0;
  }
  const s = ((l = t.model) == null ? void 0 : l.trim()) || "gemini-2.5-flash", a = [
    "--skip-trust",
    "-p",
    `@${i} ${t.prompt.trim()}`,
    "-o",
    "stream-json",
    "-m",
    s,
    "--approval-mode",
    "auto_edit",
    "--session-id",
    G.randomUUID(),
    "--include-directories",
    _.dirname(i)
  ], u = () => {
    if (o)
      try {
        B.unlinkSync(i);
      } catch {
      }
  };
  return new Promise((d, m) => {
    var b, S;
    const f = ne(e, a, { env: qi(), cwd: r, stdio: ["ignore", "pipe", "pipe"] });
    let g = "", y = "", h = "", p = !1, w = !1;
    const E = (v) => {
      p || (p = !0, clearTimeout(T), clearTimeout(x), u(), v());
    }, T = setTimeout(() => {
      f.kill("SIGTERM"), E(() => m(new Error("Gemini CLI media analysis timed out.")));
    }, bc), x = setTimeout(() => {
      w || (f.kill("SIGTERM"), E(() => m(new Error("Gemini CLI is still reading the media file. Try a shorter clip."))));
    }, vc);
    (b = f.stdout) == null || b.on("data", (v) => {
      h += v.toString();
      let I;
      for (; (I = h.indexOf(`
`)) >= 0; ) {
        const O = h.slice(0, I).trim();
        if (h = h.slice(I + 1), !!O)
          try {
            const U = JSON.parse(O);
            U.type === "message" && U.role === "assistant" && typeof U.content == "string" && U.content && (w = !0, g += U.content), U.type === "error" && typeof U.message == "string" && (y += U.message);
          } catch {
          }
      }
    }), (S = f.stderr) == null || S.on("data", (v) => {
      y += v.toString();
    }), f.on("error", (v) => E(() => m(v))), f.on("close", (v) => {
      const I = g.trim();
      if (!I) {
        const O = Rn(y.trim()) || `Gemini CLI exited with code ${v ?? "unknown"}`;
        E(() => m(new Error(O)));
        return;
      }
      if (Tc(I)) {
        E(() => m(new Bt("Gemini CLI declined to analyze the media.")));
        return;
      }
      E(() => d(I));
    });
  });
}
const Sc = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GeminiMediaUnavailableError: Bt,
  analyzeMediaWithGeminiCli: Zi,
  buildGeminiUserMessageWithVisualRefs: Yi,
  cleanupEphemeralVisualRefs: zn,
  prepareClipReference: _c,
  prepareCopilotVisualRefs: Wn,
  resolveLocalSourcePath: Qi
}, Symbol.toStringTag, { value: "Module" }));
let fe = null;
const xc = 9e4, Ic = 18e4, Ac = 8e3;
function eo() {
  return _.join(X.getPath("userData"), "gemini-cli-workspace");
}
function Rc() {
  return _.join(W.tmpdir(), "cinegen-gemini-visual-refs");
}
function Nc(t) {
  var r;
  const e = [];
  if (t.injectProjectContext && ((r = t.systemPrompt) != null && r.trim())) {
    const i = t.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "";
    e.push(`${i}${t.systemPrompt.trim()}

${t.purpose === "enhance-prompt" ? Xi : zi}`);
  }
  const n = (t.messages ?? []).filter((i) => i.content.trim());
  return n.length > 0 ? e.length > 0 ? `${e.join(`

`)}

${Nn(n)}` : Nn(n) : e.length > 0 ? `${e.join(`

`)}

User:
${t.userMessage.trim()}

Assistant:
` : t.userMessage.trim();
}
function Oc(t) {
  var n;
  const e = [
    (n = t.systemPrompt) == null ? void 0 : n.trim(),
    fc
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
function Pc(t) {
  const e = t.stats;
  if (!e) return;
  const n = Number(e.input_tokens) || 0, r = Number(e.output_tokens) || 0, i = Number(e.total_tokens) || n + r;
  if (!(i <= 0))
    return { promptTokens: n, completionTokens: r, totalTokens: i, cost: 0 };
}
function kc(t) {
  if (typeof t != "string" || !t.trim()) return "Gemini CLI is working…";
  const e = t.replace(/_/g, " ").toLowerCase();
  return e.includes("read") && e.includes("file") ? "Gemini CLI: Reading attached video…" : `Gemini CLI: ${t.replace(/_/g, " ")}…`;
}
function Cc(t) {
  return /malformed tool call|empty response|API Error|INVALID_ARGUMENT/i.test(t);
}
function Uc(t) {
  return /no previous sessions found/i.test(t);
}
async function qr(t, e, n) {
  var h;
  const r = await Vt("gemini");
  if (!r)
    throw new Error("Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli");
  const i = ((h = e.model) == null ? void 0 : h.trim().replace(/^[^/]+\//, "")) || "gemini-2.5-flash", o = n.canResume ? Oc(e) : Nc(e), s = o.length > Ac, c = eo();
  await Dt(c, { recursive: !0 });
  const a = [
    "--skip-trust",
    ...s ? ["-p", ""] : ["-p", o],
    "-o",
    "stream-json",
    "-m",
    i,
    "--approval-mode",
    n.hasVisualRefs ? "yolo" : "default"
  ];
  if (n.hasVisualRefs) {
    a.push("--session-id", G.randomUUID());
    const p = [...new Set(
      n.preparedVisualRefs.map((w) => _.dirname(w.mediaPath))
    )];
    for (const w of p)
      a.push("--include-directories", w);
  } else n.canResume && e.resumeSessionId && a.push("-r", e.resumeSessionId);
  const u = Wi();
  let l = "", d = "", m, f;
  const g = 900 * 1e3, y = n.hasVisualRefs ? Ic : xc;
  return new Promise((p, w) => {
    var O, U, M, $;
    const E = ne(r, a, {
      env: qi(),
      cwd: c,
      stdio: s ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    s && ((O = E.stdin) == null || O.write(o), (U = E.stdin) == null || U.end()), fe = { child: E, requestId: t, provider: "gemini" };
    let T = "", x = !1, b = !1;
    const S = (H) => {
      x || (x = !0, clearTimeout(v), clearTimeout(I), zn(n.preparedVisualRefs), H());
    }, v = setTimeout(() => {
      fe = null, E.kill("SIGTERM"), S(() => w(new Error("Gemini CLI timed out after 15 minutes. Try again or switch models.")));
    }, g), I = setTimeout(() => {
      b || x || (fe = null, E.kill("SIGTERM"), S(() => w(new Error(
        n.hasVisualRefs ? "Gemini CLI is still reading the attached video. Try again or use a shorter clip." : "Gemini CLI is taking too long to respond. Try gemini-2.5-flash, shorten the question, or start a new chat."
      ))));
    }, y);
    (M = E.stdout) == null || M.on("data", (H) => {
      T += H.toString();
      let J;
      for (; (J = T.indexOf(`
`)) >= 0; ) {
        const N = T.slice(0, J).trim();
        if (T = T.slice(J + 1), !!N)
          try {
            const C = JSON.parse(N);
            C.type === "init" && typeof C.session_id == "string" && (m = C.session_id);
            const q = Pc(C);
            if (q && (f = q), C.type === "tool_use" && (u == null || u.webContents.send("llm:gemini-stream", {
              requestId: t,
              status: kc(C.tool_name)
            })), C.type === "message" && C.role === "assistant" && typeof C.content == "string") {
              const A = C.content;
              A && (b = !0, l += A, u == null || u.webContents.send("llm:gemini-stream", { requestId: t, token: A }));
            }
            if (C.type === "error" && typeof C.message == "string") {
              const A = C.message;
              d += A, !l.trim() && Cc(A) && (fe = null, E.kill("SIGTERM"), S(() => w(new Error(Rn(A)))));
            }
            if (C.type === "result" && C.status === "error") {
              const A = typeof C.error == "string" ? C.error : typeof C.message == "string" ? C.message : "Gemini CLI returned an error.";
              d += A;
            }
          } catch {
          }
      }
    }), ($ = E.stderr) == null || $.on("data", (H) => {
      d += H.toString();
    }), E.on("error", (H) => {
      fe = null, S(() => w(H));
    }), E.on("close", (H) => {
      fe = null, u == null || u.webContents.send("llm:gemini-stream", { requestId: t, done: !0 });
      const J = l.trim();
      if (!J) {
        const N = Rn(d.trim()) || `Gemini CLI exited with code ${H ?? "unknown"}`;
        S(() => w(new Error(N)));
        return;
      }
      S(() => p({
        message: J,
        sessionId: m,
        usage: f,
        resumed: n.canResume
      }));
    });
  });
}
async function jc(t, e) {
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const n = eo(), r = Rc();
  await Dt(n, { recursive: !0 }), await Dt(r, { recursive: !0 });
  const i = await Wn(e.visualRefs ?? [], r);
  if ((e.visualRefs ?? []).length > 0 && i.length === 0)
    throw new Error("Could not load the attached /clip or /asset files for Gemini visual analysis. Use local video or image files.");
  const o = i.length > 0, s = {
    ...e,
    userMessage: Yi(e.userMessage, i)
  }, c = !!e.resumeSessionId && !e.injectProjectContext && !o;
  try {
    return await qr(t, s, {
      canResume: c,
      hasVisualRefs: o,
      preparedVisualRefs: i
    });
  } catch (a) {
    const u = a instanceof Error ? a.message : String(a);
    if (!c || !Uc(u))
      throw a;
    return qr(t, {
      ...s,
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
function Lc() {
  R.handle("llm:gemini-chat", async (t, e) => {
    const n = e.requestId || G.randomUUID(), r = await jc(n, e);
    return {
      message: r.message,
      sessionId: r.sessionId,
      resumed: r.resumed,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), R.handle("llm:gemini-cancel", async (t, e) => {
    (fe == null ? void 0 : fe.requestId) !== e || fe.provider !== "gemini" || (fe.child.kill("SIGTERM"), fe = null);
  });
}
const Dc = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;
function Mc(t, e) {
  const n = [];
  e && (n.push("I have a video that needs a music soundtrack. I've attached frames from the video for you to analyze."), n.push("Look at the visual content, mood, pacing, and subject matter to inform the music style."));
  const r = [];
  return t.genre && r.push(`Genre: ${t.genre}`), t.style && r.push(`Style: ${t.style}`), t.mood && r.push(`Mood: ${t.mood}`), t.tempo && r.push(`Tempo: ${t.tempo}`), t.additionalNotes && r.push(`Notes: ${t.additionalNotes}`), r.length > 0 && n.push(`User preferences:
` + r.join(`
`)), n.push("Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else."), n.join(`

`);
}
function Fc() {
  R.handle("music:generate-prompt", async (t, e) => {
    const n = e.apiKey;
    if (!n) throw new Error("No fal.ai API key provided.");
    z.fal.config({ credentials: n });
    const r = e.frameUrls && e.frameUrls.length > 0, i = Mc(e, !!r), o = {
      model: "google/gemini-flash-1.5",
      system_prompt: Dc,
      prompt: i,
      max_tokens: 300
    }, s = r ? "fal-ai/any-llm/vision" : "fal-ai/any-llm";
    return r && (o.image_urls = e.frameUrls), { prompt: ((await z.fal.subscribe(s, { input: o, logs: !0 })).data.output ?? "").trim() };
  });
}
function $c() {
  R.handle("dialog:show-save", async (t, e) => {
    const n = Y.getFocusedWindow();
    if (!n) return null;
    const r = await er.showSaveDialog(n, {
      defaultPath: e == null ? void 0 : e.defaultPath,
      filters: e == null ? void 0 : e.filters
    });
    return r.canceled ? null : r.filePath;
  }), R.handle("dialog:show-open", async (t, e) => {
    var i;
    const n = Y.getFocusedWindow();
    if (!n) return null;
    const r = await er.showOpenDialog(n, {
      filters: e == null ? void 0 : e.filters,
      properties: (e == null ? void 0 : e.properties) ?? ["openFile"]
    });
    return r.canceled ? null : (i = e == null ? void 0 : e.properties) != null && i.includes("multiSelections") ? r.filePaths : r.filePaths[0];
  }), R.handle("shell:open-path", async (t, e) => await _o.openPath(e));
}
const Bc = `
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
`, Hc = `
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
function Xn() {
  return _.join(W.homedir(), "Documents", "CINEGEN");
}
function Fe(t) {
  return _.join(Xn(), t);
}
function pt() {
  return G.randomUUID();
}
function Tt() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function to(t) {
  const e = Fe(t), n = [
    _.join(e, "media", "generated"),
    _.join(e, "media", "imported"),
    _.join(e, ".cache", "thumbnails"),
    _.join(e, ".cache", "filmstrips"),
    _.join(e, ".cache", "waveforms"),
    _.join(e, ".cache", "proxies")
  ];
  for (const r of n)
    B.mkdirSync(r, { recursive: !0 });
}
class qc {
  constructor(e) {
    to(e);
    const n = _.join(Fe(e), "project.db");
    this.db = new ii(n), this.db.pragma("journal_mode = WAL"), this.db.pragma("foreign_keys = ON"), this.initSchema();
  }
  /**
   * Runs SCHEMA_SQL and INDEXES_SQL to create all tables and indexes if they
   * do not already exist.
   */
  initSchema() {
    this.db.exec(Bc), this.db.exec(Hc);
  }
  /**
   * Executes a SELECT query and returns all matching rows typed as T.
   */
  query(e, n) {
    return this.db.prepare(e).all(...n ?? []);
  }
  /**
   * Executes a SELECT query and returns the first matching row typed as T,
   * or undefined if no rows match.
   */
  queryOne(e, n) {
    return this.db.prepare(e).get(...n ?? []);
  }
  /**
   * Executes an INSERT / UPDATE / DELETE statement and returns the RunResult.
   */
  run(e, n) {
    return this.db.prepare(e).run(...n ?? []);
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
const Wc = {
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
function Ye(t, e) {
  const n = Wc[e], r = Object.entries(t).filter(
    ([s]) => s !== "id" && (!n || n.has(s))
  );
  if (r.length === 0) throw new Error("No valid fields to update");
  const i = r.map(([s]) => `${s} = ?`).join(", "), o = r.map(([, s]) => s);
  return { setClauses: i, values: o };
}
function no(t, e) {
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
function ro(t, e) {
  return t.queryOne("SELECT * FROM projects WHERE id = ?", [e]);
}
function io(t, e, n) {
  const { setClauses: r, values: i } = Ye(n, "projects");
  return t.run(`UPDATE projects SET ${r} WHERE id = ?`, [...i, e]);
}
function oo(t, e) {
  return t.query("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at", [
    e
  ]);
}
function so(t, e) {
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
function Ht(t, e, n) {
  const { setClauses: r, values: i } = Ye(n, "assets");
  return t.run(`UPDATE assets SET ${r} WHERE id = ?`, [...i, e]);
}
function ao(t, e) {
  return t.run("DELETE FROM assets WHERE id = ?", [e]);
}
function zc(t, e) {
  return t.query(
    "SELECT * FROM media_folders WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function Xc(t, e) {
  return t.run(
    `INSERT INTO media_folders (id, project_id, name, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.parent_id, e.created_at]
  );
}
function Gc(t, e, n) {
  const { setClauses: r, values: i } = Ye(n, "media_folders");
  return t.run(`UPDATE media_folders SET ${r} WHERE id = ?`, [...i, e]);
}
function Kc(t, e) {
  return t.query(
    "SELECT * FROM timelines WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function co(t, e) {
  return t.run(
    `INSERT INTO timelines (id, project_id, name, duration, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.duration, e.created_at]
  );
}
function Jc(t, e, n) {
  const { setClauses: r, values: i } = Ye(n, "timelines");
  return t.run(`UPDATE timelines SET ${r} WHERE id = ?`, [...i, e]);
}
function Vc(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE timeline_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE timeline_id = ?", [e]), t.run("DELETE FROM tracks WHERE timeline_id = ?", [e]), t.run("DELETE FROM transitions WHERE timeline_id = ?", [e]), t.run("DELETE FROM timelines WHERE id = ?", [e]);
  });
}
function Yc(t, e) {
  return t.query(
    "SELECT * FROM tracks WHERE timeline_id = ? ORDER BY sort_order",
    [e]
  );
}
function Pn(t, e) {
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
function Qc(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE track_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE track_id = ?", [e]), t.run("DELETE FROM tracks WHERE id = ?", [e]);
  });
}
function Zc(t, e) {
  return t.query(
    "SELECT * FROM clips WHERE timeline_id = ? ORDER BY start_time",
    [e]
  );
}
function el(t, e) {
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
function tl(t, e) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]), t.run("DELETE FROM clips WHERE id = ?", [e]);
  });
}
function nl(t, e) {
  return t.query(
    "SELECT * FROM keyframes WHERE clip_id = ? ORDER BY time",
    [e]
  );
}
function rl(t, e, n) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]);
    for (const r of n)
      t.run(
        "INSERT INTO keyframes (id, clip_id, time, property, value) VALUES (?, ?, ?, ?, ?)",
        [pt(), r.clip_id, r.time, r.property, r.value]
      );
  });
}
function il(t, e) {
  return t.query(
    "SELECT * FROM transitions WHERE timeline_id = ?",
    [e]
  );
}
function ol(t, e) {
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
function sl(t, e) {
  return t.run("DELETE FROM transitions WHERE id = ?", [e]);
}
function al(t, e) {
  const n = t.queryOne(
    "SELECT nodes, edges FROM workflow_state WHERE project_id = ?",
    [e]
  );
  if (!n) return { nodes: [], edges: [] };
  const r = JSON.parse(n.nodes), i = JSON.parse(n.edges);
  if (i && typeof i == "object" && !Array.isArray(i)) {
    const o = i;
    return {
      nodes: Array.isArray(r) ? r : [],
      edges: Array.isArray(o.edges) ? o.edges : [],
      spaces: Array.isArray(o.spaces) ? o.spaces : void 0,
      activeSpaceId: typeof o.activeSpaceId == "string" ? o.activeSpaceId : void 0,
      openSpaceIds: Array.isArray(o.openSpaceIds) ? o.openSpaceIds.filter((s) => typeof s == "string") : void 0
    };
  }
  return {
    nodes: Array.isArray(r) ? r : [],
    edges: Array.isArray(i) ? i : []
  };
}
function cl(t, e, n) {
  return t.run(
    `INSERT INTO workflow_state (project_id, nodes, edges)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       nodes = excluded.nodes,
       edges = excluded.edges`,
    [
      e,
      JSON.stringify(n.nodes),
      JSON.stringify({
        edges: n.edges,
        spaces: n.spaces ?? [],
        activeSpaceId: n.activeSpaceId ?? null,
        openSpaceIds: n.openSpaceIds ?? []
      })
    ]
  );
}
function ll(t, e) {
  return t.query(
    "SELECT * FROM elements WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function ul(t, e) {
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
function dl(t, e, n) {
  const { setClauses: r, values: i } = Ye(n, "elements");
  return t.run(`UPDATE elements SET ${r} WHERE id = ?`, [...i, e]);
}
function fl(t, e) {
  return t.run("DELETE FROM elements WHERE id = ?", [e]);
}
function ml(t, e) {
  return t.query(
    "SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC",
    [e]
  );
}
function pl(t, e) {
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
function hl(t, e, n) {
  const { setClauses: r, values: i } = Ye(n, "export_jobs");
  return t.run(`UPDATE export_jobs SET ${r} WHERE id = ?`, [...i, e]);
}
function Wr(t, e) {
  const n = ro(t, e);
  if (!n) throw new Error(`Project not found: ${e}`);
  const r = oo(t, e), i = zc(t, e), o = al(t, e), s = ll(t, e), c = ml(t, e), u = Kc(t, e).map((d) => {
    const m = Yc(t, d.id), f = Zc(t, d.id), g = il(t, d.id), y = f.map((h) => ({
      ...h,
      keyframes: nl(t, h.id)
    }));
    return { ...d, tracks: m, clips: y, transitions: g };
  }), l = u.length > 0 ? u[0].id : "";
  return {
    project: n,
    assets: r,
    mediaFolders: i,
    timelines: u,
    activeTimelineId: l,
    workflow: o,
    elements: s,
    exports: c
  };
}
function gl(t, e, n) {
  t.transaction(() => {
    ro(t, e) ? io(t, e, {
      name: n.project.name,
      updated_at: Tt(),
      resolution_width: n.project.resolution_width,
      resolution_height: n.project.resolution_height,
      frame_rate: n.project.frame_rate
    }) : no(t, { ...n.project, updated_at: Tt() });
    const i = new Set(
      t.query("SELECT id FROM media_folders WHERE project_id = ?", [e]).map((f) => f.id)
    ), o = new Set(n.mediaFolders.map((f) => f.id));
    for (const f of i)
      o.has(f) || (t.run("UPDATE assets SET folder_id = NULL WHERE folder_id = ?", [f]), t.run("DELETE FROM media_folders WHERE id = ?", [f]));
    for (const f of n.mediaFolders)
      i.has(f.id) ? Gc(t, f.id, {
        name: f.name,
        parent_id: f.parent_id
      }) : Xc(t, f);
    const s = new Set(
      t.query("SELECT id FROM assets WHERE project_id = ?", [e]).map((f) => f.id)
    ), c = new Set(n.assets.map((f) => f.id));
    for (const f of s)
      c.has(f) || ao(t, f);
    for (const f of n.assets)
      if (s.has(f.id)) {
        const { id: g, project_id: y, created_at: h, ...p } = f;
        Ht(t, f.id, p);
      } else
        so(t, f);
    const a = new Set(
      t.query("SELECT id FROM timelines WHERE project_id = ?", [e]).map((f) => f.id)
    ), u = new Set(n.timelines.map((f) => f.id));
    for (const f of a)
      u.has(f) || Vc(t, f);
    for (const f of n.timelines) {
      if (a.has(f.id))
        Jc(t, f.id, { name: f.name, duration: f.duration });
      else {
        const { tracks: T, clips: x, transitions: b, ...S } = f;
        co(t, S);
      }
      const g = new Set(
        t.query("SELECT id FROM tracks WHERE timeline_id = ?", [f.id]).map((T) => T.id)
      ), y = new Set(f.tracks.map((T) => T.id));
      for (const T of g)
        y.has(T) || Qc(t, T);
      for (const T of f.tracks)
        Pn(t, T);
      const h = new Set(
        t.query("SELECT id FROM clips WHERE timeline_id = ?", [f.id]).map((T) => T.id)
      ), p = new Set(f.clips.map((T) => T.id));
      for (const T of h)
        p.has(T) || tl(t, T);
      for (const T of f.clips) {
        const { keyframes: x, ...b } = T;
        el(t, b), rl(
          t,
          T.id,
          x.map(({ id: S, ...v }) => v)
        );
      }
      const w = new Set(
        t.query("SELECT id FROM transitions WHERE timeline_id = ?", [f.id]).map((T) => T.id)
      ), E = new Set(f.transitions.map((T) => T.id));
      for (const T of w)
        E.has(T) || sl(t, T);
      for (const T of f.transitions)
        ol(t, T);
    }
    cl(t, e, n.workflow);
    const l = new Set(
      t.query("SELECT id FROM elements WHERE project_id = ?", [e]).map((f) => f.id)
    ), d = new Set(n.elements.map((f) => f.id));
    for (const f of l)
      d.has(f) || fl(t, f);
    for (const f of n.elements)
      if (l.has(f.id)) {
        const { id: g, project_id: y, created_at: h, ...p } = f;
        dl(t, f.id, { ...p, updated_at: Tt() });
      } else
        ul(t, f);
    const m = new Set(
      t.query("SELECT id FROM export_jobs WHERE project_id = ?", [e]).map((f) => f.id)
    );
    for (const f of n.exports)
      if (m.has(f.id)) {
        const { id: g, project_id: y, created_at: h, ...p } = f;
        hl(t, f.id, p);
      } else
        pl(t, f);
  });
}
const Oe = /* @__PURE__ */ new Map();
function xe(t) {
  let e = Oe.get(t);
  return e || (e = new qc(t), Oe.set(t, e)), e;
}
function lo() {
  return _.join(Xn(), "projects.json");
}
async function Gn() {
  try {
    const t = await L.readFile(lo(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function Kn(t) {
  await L.mkdir(Xn(), { recursive: !0 }), await L.writeFile(lo(), JSON.stringify(t, null, 2), "utf-8");
}
async function yl(t) {
  const e = await Gn(), n = e.projects.findIndex((r) => r.id === t.id);
  n >= 0 ? e.projects[n] = t : e.projects.push(t), await Kn(e);
}
async function wl(t) {
  const e = await Gn();
  e.projects = e.projects.filter((n) => n.id !== t), await Kn(e);
}
function El() {
  R.handle("db:project:create", async (t, e) => {
    const n = pt(), r = Tt();
    to(n);
    const i = xe(n);
    no(i, {
      id: n,
      name: e,
      created_at: r,
      updated_at: r,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24
    });
    const s = pt();
    return co(i, {
      id: s,
      project_id: n,
      name: "Timeline 1",
      duration: 0,
      created_at: r
    }), Pn(i, {
      id: pt(),
      timeline_id: s,
      name: "Video 1",
      kind: "video",
      color: "#4A90D9",
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 0
    }), Pn(i, {
      id: pt(),
      timeline_id: s,
      name: "Audio 1",
      kind: "audio",
      color: "#7ED321",
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 1
    }), await yl({
      id: n,
      name: e,
      createdAt: r,
      updatedAt: r,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
      useSqlite: !0
    }), Wr(i, n);
  }), R.handle("db:project:load", async (t, e) => {
    const n = xe(e), r = Wr(n, e);
    for (const i of r.assets)
      if (i.file_ref && !i.source_url) {
        const o = i.status;
        B.existsSync(i.file_ref) ? i.status === "offline" && (i.status = "online") : i.status = "offline", i.status !== o && Ht(n, i.id, { status: i.status });
      }
    return r;
  }), R.handle("db:project:save", async (t, e, n) => {
    const r = xe(e);
    gl(r, e, n);
    const i = Tt(), o = await Gn(), s = o.projects.find((c) => c.id === e);
    return s && (s.name = n.project.name, s.updatedAt = i, s.assetCount = n.assets.length, s.elementCount = n.elements.length, await Kn(o)), { ok: !0 };
  }), R.handle("db:project:delete", async (t, e) => {
    const n = Oe.get(e);
    n && (n.close(), Oe.delete(e));
    const r = Fe(e);
    try {
      await L.rm(r, { recursive: !0, force: !0 });
    } catch (i) {
      console.error(`[db:project:delete] Failed to remove directory ${r}:`, i);
    }
    return await wl(e), { ok: !0 };
  }), R.handle("db:project:close", async (t, e) => {
    const n = Oe.get(e);
    return n && (n.close(), Oe.delete(e)), { ok: !0 };
  }), R.handle(
    "db:project:update",
    async (t, e, n) => {
      const r = xe(e);
      return io(r, e, n), { ok: !0 };
    }
  ), R.handle("db:asset:insert", async (t, e) => {
    const n = xe(e.project_id);
    return so(n, e), { ok: !0 };
  }), R.handle(
    "db:asset:update",
    async (t, e, n, r) => {
      const i = xe(e);
      return Ht(i, n, r), { ok: !0 };
    }
  ), R.handle("db:asset:delete", async (t, e, n) => {
    const r = xe(e);
    return ao(r, n), { ok: !0 };
  });
}
function _l() {
  for (const [t, e] of Oe)
    try {
      e.close();
    } catch (n) {
      console.error(`[closeAllDbs] Failed to close DB for project ${t}:`, n);
    }
  Oe.clear();
}
const Tl = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), vl = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
function yn(t, e) {
  const n = _.extname(t).toLowerCase();
  return Tl.has(n) ? "video" : vl.has(n) ? "audio" : n ? "image" : e;
}
function bl(t, e) {
  if (t)
    try {
      const n = _.extname(new URL(t).pathname);
      if (n && n.length <= 8) return n;
    } catch {
      const n = _.extname(t);
      if (n && n.length <= 8) return n;
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
async function Sl(t, e) {
  let n = [];
  try {
    n = await L.readdir(t);
  } catch {
    return null;
  }
  const r = n.find((i) => i === e || i.startsWith(`${e}.`));
  return r ? _.join(t, r) : null;
}
function xl(t) {
  return t.startsWith("local-media://file") ? decodeURIComponent(t.replace(/^local-media:\/\/file/, "")) : null;
}
function Il(t) {
  if (!(t != null && t.trim())) return null;
  const e = t.trim(), n = xl(e) ?? e;
  return B.existsSync(n) ? n : null;
}
async function Al(t, e) {
  await L.mkdir(_.dirname(e), { recursive: !0 }), await L.copyFile(t, e);
}
function Lt(t) {
  const e = Fe(t.projectId), n = _.join(e, ".cache"), r = G.randomUUID(), i = {
    id: r,
    type: "extract_metadata",
    assetId: t.assetId,
    inputPath: t.inputPath,
    outputPath: "",
    projectDir: e
  };
  if (t.type !== "audio") {
    const o = _.join(n, "thumbnails");
    B.mkdirSync(o, { recursive: !0 }), he({
      id: G.randomUUID(),
      type: "generate_thumbnail",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: _.join(o, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Thumbnail failed:", s));
  }
  if (he(i).catch((o) => console.error("[generated-asset-persist] Metadata failed:", o)), t.type === "audio" || t.type === "video") {
    const o = _.join(n, "waveforms");
    B.mkdirSync(o, { recursive: !0 }), he({
      id: G.randomUUID(),
      type: "compute_waveform",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: _.join(o, `${t.assetId}.json`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Waveform failed:", s));
  }
  if (t.type === "video") {
    const o = _.join(n, "filmstrips");
    B.mkdirSync(o, { recursive: !0 }), he({
      id: G.randomUUID(),
      type: "generate_filmstrip",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: _.join(o, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((c) => console.error("[generated-asset-persist] Filmstrip failed:", c));
    const s = _.join(n, "proxies");
    B.mkdirSync(s, { recursive: !0 }), he({
      id: G.randomUUID(),
      type: "generate_proxy",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: _.join(s, `${t.assetId}.mp4`),
      projectDir: e
    }).catch((c) => console.error("[generated-asset-persist] Proxy failed:", c));
  }
  return r;
}
async function zr(t) {
  var f;
  const { projectId: e, assetId: n, assetType: r } = t;
  if (!e || !n)
    throw new Error("projectId and assetId are required.");
  const i = Fe(e), o = _.join(i, "media", "generated");
  await L.mkdir(o, { recursive: !0 });
  const s = await Sl(o, n);
  if (s)
    return Lt({
      assetId: n,
      projectId: e,
      inputPath: s,
      type: yn(s, r)
    }), {
      path: s,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const c = t.extension || bl(t.remoteUrl ?? t.localPathHint, r), a = _.join(o, `${n}${c}`), u = Il(t.localPathHint);
  if (u)
    return await Al(u, a), Lt({
      assetId: n,
      projectId: e,
      inputPath: a,
      type: yn(a, r)
    }), {
      path: a,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const l = (f = t.remoteUrl) == null ? void 0 : f.trim();
  if (!l)
    return { error: "No downloadable URL or local file path for this asset." };
  const d = await fetch(l);
  if (!d.ok)
    throw new Error(`Failed to download (HTTP ${d.status}). The URL may have expired.`);
  const m = await d.arrayBuffer();
  return await L.writeFile(a, Buffer.from(m)), Lt({
    assetId: n,
    projectId: e,
    inputPath: a,
    type: yn(a, r)
  }), {
    path: a,
    sourceUrl: l,
    downloaded: !0
  };
}
let le = null;
const Ie = /* @__PURE__ */ new Map(), ht = /* @__PURE__ */ new Map(), Rl = _.dirname(Cn(import.meta.url));
function uo() {
  let t = _.join(Rl, "workers", "media-worker.js");
  return t.includes("app.asar") && (t = t.replace("app.asar", "app.asar.unpacked")), t;
}
function Nl() {
  return le || (le = new si(uo()), le.on("message", (t) => {
    switch (t.type) {
      case "ready":
        console.log("[media-worker] Worker ready");
        break;
      case "job:progress":
        for (const e of Y.getAllWindows())
          e.webContents.send("media:job-progress", { jobId: t.jobId, progress: t.progress });
        break;
      case "job:complete": {
        const e = ht.get(t.jobId);
        for (const r of Y.getAllWindows())
          r.webContents.send("media:job-complete", {
            jobId: t.jobId,
            result: t.result,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        ht.delete(t.jobId);
        const n = Ie.get(t.jobId);
        n && (n.resolve(t.result), Ie.delete(t.jobId));
        break;
      }
      case "job:error": {
        const e = ht.get(t.jobId);
        for (const r of Y.getAllWindows())
          r.webContents.send("media:job-error", {
            jobId: t.jobId,
            error: t.error,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        ht.delete(t.jobId);
        const n = Ie.get(t.jobId);
        n && (n.reject(new Error(t.error)), Ie.delete(t.jobId));
        break;
      }
      case "sync:batch-progress":
        for (const e of Y.getAllWindows())
          e.webContents.send("sync:batch-progress", {
            jobId: t.jobId,
            completedPairs: t.completedPairs,
            totalPairs: t.totalPairs,
            currentVideoName: t.currentVideoName,
            currentAudioName: t.currentAudioName
          });
        break;
    }
  }), le.on("error", (t) => {
    console.error("[media-worker] Worker error:", t);
  }), le.on("exit", (t) => {
    console.log(`[media-worker] Worker exited with code ${t}`), le = null;
    for (const [e, n] of Ie)
      n.reject(new Error("Worker exited")), Ie.delete(e);
  }), le.postMessage({
    type: "config",
    ffmpegPath: ye(),
    ffprobePath: ki(),
    fpcalcPath: Ci()
  }), le);
}
function he(t) {
  return t.type === "sync_compute_offset" || t.type === "sync_batch_match" ? Ol(t) : new Promise((e, n) => {
    Ie.set(t.id, { resolve: e, reject: n }), ht.set(t.id, { assetId: t.assetId, jobType: t.type }), Nl().postMessage({ type: "job:submit", job: t });
  });
}
function Ol(t) {
  return new Promise((e, n) => {
    const r = new si(uo());
    let i = !1;
    const o = () => {
      r.removeAllListeners(), r.terminate().catch(() => {
      });
    }, s = (a) => {
      i || (i = !0, o(), e(a));
    }, c = (a) => {
      i || (i = !0, o(), n(a));
    };
    r.on("message", (a) => {
      switch (a.type) {
        case "ready":
          r.postMessage({ type: "job:submit", job: t });
          break;
        case "job:complete":
          a.jobId === t.id && s(a.result);
          break;
        case "job:error":
          a.jobId === t.id && c(new Error(a.error));
          break;
        case "sync:batch-progress":
          for (const u of Y.getAllWindows())
            u.webContents.send("sync:batch-progress", {
              jobId: a.jobId,
              completedPairs: a.completedPairs,
              totalPairs: a.totalPairs,
              currentVideoName: a.currentVideoName,
              currentAudioName: a.currentAudioName
            });
          break;
      }
    }), r.on("error", (a) => {
      c(a instanceof Error ? a : new Error(String(a)));
    }), r.on("exit", (a) => {
      !i && a !== 0 && c(new Error(`Sync worker exited with code ${a}`));
    }), r.postMessage({
      type: "config",
      ffmpegPath: ye(),
      ffprobePath: ki(),
      fpcalcPath: Ci()
    });
  });
}
function Pl(t) {
  const e = _.extname(t).toLowerCase(), n = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), r = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
  return n.has(e) ? "video" : r.has(e) ? "audio" : "image";
}
function kl() {
  R.handle("media:import", async (t, e) => {
    const { filePaths: n, projectId: r, mode: i } = e, o = Fe(r), s = [], c = [];
    for (const a of n) {
      const u = G.randomUUID();
      let l = a;
      if (i === "copy") {
        const f = _.join(o, "media", "imported");
        await L.mkdir(f, { recursive: !0 });
        const g = `${u}${_.extname(a)}`, y = _.join(f, g);
        await L.copyFile(a, y), l = y;
      }
      const d = Pl(a), m = G.randomUUID();
      c.push({
        assetId: u,
        metadataJobId: m,
        inputPath: l,
        type: d,
        projectDir: o
      }), s.push({ assetId: u, jobId: m, filePath: l, type: d });
    }
    return setTimeout(() => {
      for (const a of c)
        Lt({
          assetId: a.assetId,
          projectId: r,
          inputPath: a.inputPath,
          type: a.type
        });
    }, 0), s;
  }), R.handle("media:submit-job", async (t, e) => he(e)), R.handle("media:cancel-job", async (t, e) => {
    const n = le;
    return n && n.postMessage({ type: "job:cancel", jobId: e }), Ie.delete(e), { ok: !0 };
  }), R.handle("media:extract-frame", async (t, e) => {
    const { inputPath: n, timeSec: r } = e, i = ye(), o = _.join(W.tmpdir(), `cinegen-frame-${G.randomUUID()}.jpg`);
    return new Promise((s) => {
      const c = [
        "-y",
        "-ss",
        `${Math.max(0, r)}`,
        "-i",
        n,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        o
      ];
      vt(i, c, { timeout: 15e3 }, (a, u, l) => {
        if (a || !B.existsSync(o)) {
          s(null);
          return;
        }
        s({ outputPath: o });
      });
    });
  }), R.handle("media:write-temp-image", async (t, e) => {
    const n = e.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!n) throw new Error("media:write-temp-image expects a base64 image data URL.");
    const r = n[1] === "jpeg" ? "jpg" : n[1], i = Buffer.from(n[2], "base64"), o = _.join(W.tmpdir(), `cinegen-frame-chat-${G.randomUUID()}.${r}`);
    return await L.writeFile(o, i), { outputPath: o };
  }), R.handle("media:extract-clip", async (t, e) => {
    const { inputPath: n, startTimeSec: r, durationSec: i } = e, o = ye(), s = _.join(W.tmpdir(), `cinegen-clip-${G.randomUUID()}.mp4`), c = Math.max(0, r), a = Math.max(0.1, i);
    return new Promise((u) => {
      const l = [
        "-y",
        "-ss",
        `${c}`,
        "-i",
        n,
        "-t",
        `${a}`,
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
        s
      ];
      vt(o, l, { timeout: Math.max(12e4, Math.ceil(a * 4e3)) }, (d, m, f) => {
        if (d || !B.existsSync(s)) {
          u(null);
          return;
        }
        u({ outputPath: s });
      });
    });
  }), R.handle("media:queue-processing", async (t, e) => {
    const {
      assetId: n,
      projectId: r,
      inputPath: i,
      needsProxy: o,
      includeThumbnail: s = !1,
      includeWaveform: c = !0,
      includeFilmstrip: a = !0
    } = e, u = Fe(r), l = _.join(u, ".cache");
    if (s) {
      const d = _.join(l, "thumbnails");
      B.mkdirSync(d, { recursive: !0 });
      const m = {
        id: G.randomUUID(),
        type: "generate_thumbnail",
        assetId: n,
        inputPath: i,
        outputPath: _.join(d, `${n}.jpg`),
        projectDir: u
      };
      he(m).catch((f) => console.error("[media-import] Thumbnail failed:", f));
    }
    if (c) {
      const d = _.join(l, "waveforms");
      B.mkdirSync(d, { recursive: !0 });
      const m = {
        id: G.randomUUID(),
        type: "compute_waveform",
        assetId: n,
        inputPath: i,
        outputPath: _.join(d, `${n}.json`),
        projectDir: u
      };
      he(m).catch((f) => console.error("[media-import] Waveform failed:", f));
    }
    if (a) {
      const d = _.join(l, "filmstrips");
      B.mkdirSync(d, { recursive: !0 });
      const m = {
        id: G.randomUUID(),
        type: "generate_filmstrip",
        assetId: n,
        inputPath: i,
        outputPath: _.join(d, `${n}.jpg`),
        projectDir: u
      };
      he(m).catch((f) => console.error("[media-import] Filmstrip failed:", f));
    }
    if (o) {
      const d = _.join(l, "proxies");
      B.mkdirSync(d, { recursive: !0 });
      const m = {
        id: G.randomUUID(),
        type: "generate_proxy",
        assetId: n,
        inputPath: i,
        outputPath: _.join(d, `${n}.mp4`),
        projectDir: u
      };
      he(m).catch((f) => console.error("[media-import] Proxy failed:", f));
    }
    return { ok: !0 };
  }), R.handle(
    "media:download-remote",
    async (t, e) => {
      const { url: n, projectId: r, assetId: i, ext: o } = e;
      if (!n || !r) throw new Error("url and projectId are required");
      const s = await zr({
        projectId: r,
        assetId: i,
        assetType: "video",
        remoteUrl: n,
        extension: o
      });
      if ("error" in s) throw new Error(s.error);
      return { path: s.path };
    }
  ), R.handle(
    "media:persist-generated-asset",
    async (t, e) => {
      try {
        return await zr(e);
      } catch (n) {
        return {
          error: n instanceof Error ? n.message : String(n)
        };
      }
    }
  );
}
function Cl() {
  le && (le.terminate(), le = null);
}
function Ul(t) {
  R.handle("sync:compute-offset", async (e, n) => {
    const r = tr();
    return await t({
      id: r,
      type: "sync_compute_offset",
      sourceAssetId: n.sourceAssetId,
      targetAssetId: n.targetAssetId,
      sourceFilePath: n.sourceFilePath,
      targetFilePath: n.targetFilePath,
      projectDir: ""
      // Not needed for sync jobs
    });
  }), R.handle("sync:batch-match", async (e, n) => {
    const r = tr();
    return await t({
      id: r,
      type: "sync_batch_match",
      videoAssets: n.videoAssets,
      audioAssets: n.audioAssets,
      projectDir: ""
      // Not needed for sync jobs
    });
  });
}
const jl = oi(import.meta.url), Ll = _.dirname(Cn(import.meta.url));
function Dl() {
  return X.isPackaged ? _.join(process.resourcesPath, "native", "cinegen_avfoundation.node") : _.resolve(Ll, "../native/avfoundation/build/Release/cinegen_avfoundation.node");
}
let Z = null, kn = null;
if (process.platform === "darwin")
  try {
    const t = Dl();
    Z = jl(t), console.log("[native-video] AVFoundation addon loaded:", t);
  } catch (t) {
    kn = t instanceof Error ? t.message : String(t), console.error("[native-video] Failed to load AVFoundation addon:", kn);
  }
function Se() {
  return Z != null;
}
function Ml() {
  return kn;
}
function Fl(t, e) {
  return Z ? Z.createSurface(t, e) : !1;
}
function Xr(t) {
  Z == null || Z.destroySurface(t);
}
function $l(t, e, n, r, i) {
  Z == null || Z.setSurfaceRect(t, e, n, r, i);
}
function Gr(t, e) {
  Z == null || Z.setSurfaceHidden(t, e);
}
function Kr(t) {
  Z == null || Z.clearSurface(t);
}
function Bl(t, e) {
  Z == null || Z.syncSurface(t, e);
}
function Hl() {
  R.handle("native-video:is-available", () => ({
    available: Se(),
    error: Ml()
  })), R.handle("native-video:reset-surfaces", (t, e) => {
    if (!Se()) return !1;
    for (const n of e)
      Gr(n, !0), Kr(n), Xr(n);
    return !0;
  }), R.handle("native-video:create-surface", (t, e) => {
    const n = Y.fromWebContents(t.sender);
    return !n || !Se() ? !1 : Fl(e, n.getNativeWindowHandle());
  }), R.on("native-video:set-surface-rect", (t, e) => {
    Se() && $l(e.surfaceId, e.x, e.y, e.width, e.height);
  }), R.on("native-video:set-surface-hidden", (t, e) => {
    Se() && Gr(e.surfaceId, e.hidden);
  }), R.on("native-video:clear-surface", (t, e) => {
    Se() && Kr(e);
  }), R.on("native-video:sync-surface", (t, e) => {
    Se() && Bl(e.surfaceId, e.descriptors);
  }), R.on("native-video:destroy-surface", (t, e) => {
    Se() && Xr(e);
  });
}
const ql = "python3.12", fo = _.join(W.homedir(), "Desktop", "Coding", "whisperx"), Wl = _.join(fo, ".venv", "bin", "python");
function zl(...t) {
  return X.isPackaged ? _.join(process.resourcesPath, ...t) : _.join(process.cwd(), ...t);
}
const Xl = zl("scripts", "whisperx", "cinegen_infer.py"), Gl = "fal-ai/whisper", Jr = "3", Kl = {
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
function Jl(t) {
  const e = _.extname(t).toLowerCase();
  return Kl[e] ?? "application/octet-stream";
}
function qt(t) {
  const e = Number(t);
  if (Number.isFinite(e))
    return Math.round(Math.max(0, e) * 1e3) / 1e3;
}
function Vl(t, e) {
  const n = e.trim();
  return n ? t ? /^[,.;:!?%)\]}]/.test(n) || /^['’]/.test(n) ? `${t}${n}` : `${t} ${n}` : n : t;
}
function Yl(t) {
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
function mo(t) {
  const e = [];
  let n = null;
  const r = () => {
    var i;
    n && (n.text = n.text.trim(), (n.text || (((i = n.words) == null ? void 0 : i.length) ?? 0) > 0) && e.push(n), n = null);
  };
  for (let i = 0; i < t.length; i++) {
    const o = t[i];
    n || (n = {
      start: o.start,
      end: o.end,
      text: "",
      ...o.speaker ? { speaker: o.speaker } : {},
      words: []
    }), n.words.push(o), n.end = o.end, n.text = Vl(n.text, o.word), !n.speaker && o.speaker && (n.speaker = o.speaker);
    const s = t[i + 1], c = s ? Math.max(0, s.start - o.end) : 0, a = !!s && (s.speaker ?? null) !== (n.speaker ?? null), u = n.end - n.start, l = /[.!?]["')\]]*$/.test(o.word), d = c >= 0.85 || c >= 0.45 && /[,;:]$/.test(o.word), m = u >= 12;
    (!s || l || d || m || a) && r();
  }
  return r(), e;
}
function Ql(t) {
  const e = t.flatMap((n) => Array.isArray(n.words) ? n.words.flatMap((r) => {
    if (!r || typeof r.word != "string") return [];
    const i = qt(r.start), o = qt(r.end);
    return i === void 0 || o === void 0 ? [] : [{
      word: r.word.trim(),
      start: i,
      end: o,
      ...r.prob !== void 0 ? { prob: r.prob } : {},
      ...r.speaker !== void 0 ? { speaker: r.speaker } : {}
    }];
  }) : []);
  return e.length === 0 ? t : mo(e);
}
function Zl(t) {
  const e = (t == null ? void 0 : t.data) ?? t, n = typeof (e == null ? void 0 : e.text) == "string" ? e.text : "", r = e == null ? void 0 : e.chunks, i = e, o = Array.isArray(r) ? r.flatMap((l) => {
    if (!l || typeof l != "object") return [];
    const d = typeof l.text == "string" ? l.text.trim() : "", m = l.timestamp, f = Array.isArray(m) ? qt(m[0]) : void 0, g = Array.isArray(m) ? qt(m[1]) : void 0, y = Yl(l.speaker);
    return !d && f === void 0 && g === void 0 ? [] : [{ text: d, start: f, end: g, speaker: y }];
  }) : [], s = o.flatMap((l) => !l.text || l.start === void 0 || l.end === void 0 ? [] : [{
    word: l.text,
    start: l.start,
    end: l.end,
    ...l.speaker ? { speaker: l.speaker } : {}
  }]), c = s.length > 0 ? mo(s) : o.map((l) => ({
    text: l.text,
    start: l.start ?? 0,
    end: l.end ?? l.start ?? 0,
    ...l.speaker ? { speaker: l.speaker } : {}
  }));
  let a = "";
  const u = [i.language, i.languages, i.inferred_languages];
  for (const l of u) {
    if (typeof l == "string" && l.trim()) {
      a = l.trim();
      break;
    }
    if (Array.isArray(l)) {
      const d = l.find((m) => typeof m == "string" && m.trim().length > 0);
      if (d) {
        a = d.trim();
        break;
      }
    }
  }
  return {
    text: n || c.map((l) => l.text).filter(Boolean).join(" "),
    segments: c,
    language: a
  };
}
async function eu(t) {
  const e = _.join(
    W.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), n = ye(), r = [
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
    var a;
    const s = ne(n, r, { stdio: ["ignore", "ignore", "pipe"] });
    let c = "";
    (a = s.stderr) == null || a.on("data", (u) => {
      c += u.toString();
    }), s.on("error", o), s.on("close", (u) => {
      if (u === 0) {
        i();
        return;
      }
      o(new Error(c.trim() || `ffmpeg exited with code ${u}`));
    });
  }), e;
}
const tu = `
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
`, Vr = /* @__PURE__ */ new Map();
function nu() {
  return Y.getAllWindows().find((t) => !t.isDestroyed());
}
function Pe(t, e) {
  var n;
  (n = nu()) == null || n.webContents.send("transcription:progress", {
    jobId: t.jobId,
    assetId: t.assetId,
    engine: t.engine,
    ...e
  });
}
async function ru(t) {
  try {
    const e = xe(t.projectId), n = oo(e, t.projectId).find((o) => o.id === t.assetId), i = {
      ...n != null && n.metadata ? JSON.parse(n.metadata) : {},
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
    Ht(e, t.assetId, { metadata: JSON.stringify(i) });
  } catch (e) {
    console.error("[transcription] failed to save to db:", e);
  }
}
async function Jn(t) {
  t.status = "done", t.segments = Ql(t.segments), t.fullText.trim() || (t.fullText = t.segments.map((e) => e.text).filter(Boolean).join(" ")), await ru(t), Pe(t, {
    type: "done",
    text: t.fullText,
    segments: t.segments,
    language: t.language
  });
}
function Me(t, e) {
  t.status = "error", t.error = e, Pe(t, { type: "error", error: e });
}
function iu(t, e) {
  const n = e.model ?? "large", r = e.language ?? "auto";
  t.model = n, (async () => {
    const i = _.join(W.tmpdir(), `cinegen-whisper-${t.jobId}.py`);
    await L.writeFile(i, tu, "utf-8");
    const o = ne(ql, [i, e.filePath, n, r], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    t.status = "running", Pe(t, { type: "status", status: "running" }), o.stdout.on("data", (s) => {
      for (const c of s.toString().split(`
`)) {
        const a = c.trim();
        if (a)
          try {
            const u = JSON.parse(a);
            if (u.type === "segment") {
              const l = {
                text: u.text,
                start: u.start ?? 0,
                end: u.end ?? 0,
                ...Array.isArray(u.words) && u.words.length > 0 ? { words: u.words } : {}
              };
              t.segments.push(l), Pe(t, { type: "segment", ...l });
            } else u.type === "done" && (t.fullText = u.text, t.language = u.language ?? "");
          } catch {
          }
      }
    }), o.stderr.on("data", () => {
    }), o.on("close", async (s) => {
      if (await L.unlink(i).catch(() => {
      }), s !== 0) {
        Me(t, `whisper process exited with code ${s}`);
        return;
      }
      await Jn(t);
    }), o.on("error", async (s) => {
      await L.unlink(i).catch(() => {
      }), Me(t, s.message);
    });
  })().catch((i) => {
    Me(t, i instanceof Error ? i.message : String(i));
  });
}
function ou(t, e) {
  t.model = "base";
  const n = [
    Xl,
    "--audio_path",
    e.filePath,
    "--model",
    "base",
    "--no_diarize"
  ];
  e.language && e.language !== "auto" && n.push("--language", e.language);
  const r = { ...process.env };
  process.env.HF_TOKEN && (r.HF_TOKEN = process.env.HF_TOKEN);
  const i = ne(Wl, n, {
    cwd: fo,
    stdio: ["ignore", "pipe", "pipe"],
    env: r
  });
  t.status = "running", Pe(t, { type: "status", status: "running" });
  let o;
  i.stdout.on("data", (s) => {
    for (const c of s.toString().split(`
`)) {
      const a = c.trim();
      if (a)
        try {
          const u = JSON.parse(a);
          u.type === "progress" ? (u.output_text !== void 0 && (t.fullText = u.output_text), u.segments && (t.segments = u.segments), u.language !== void 0 && (t.language = u.language), Pe(t, {
            type: "progress",
            stage: u.stage,
            message: u.message,
            ...u.output_text !== void 0 ? { text: u.output_text } : {},
            ...u.segments ? { segments: u.segments } : {},
            ...u.language !== void 0 ? { language: u.language } : {}
          })) : u.type === "done" ? (u.output_text !== void 0 && (t.fullText = u.output_text), u.segments && (t.segments = u.segments), u.language !== void 0 && (t.language = u.language), o = u.transcript_path) : u.type === "error" && Me(t, u.error ?? "WhisperX error");
        } catch {
        }
    }
  }), i.stderr.on("data", () => {
  }), i.on("close", async (s) => {
    if (t.status !== "error") {
      if (s !== 0) {
        Me(t, `whisperx process exited with code ${s}`);
        return;
      }
      if (o)
        try {
          const c = await L.readFile(o, "utf-8"), a = JSON.parse(c);
          a.output_text !== void 0 && (t.fullText = a.output_text), a.segments && (t.segments = a.segments), a.language !== void 0 && (t.language = a.language), a.model && (t.model = a.model);
        } finally {
          await L.unlink(o).catch(() => {
          });
        }
      await Jn(t);
    }
  }), i.on("error", (s) => {
    Me(t, s.message);
  });
}
function su(t, e) {
  (async () => {
    if (!e.apiKey) throw new Error("No fal.ai API key provided. Add one in Settings.");
    t.model = Jr, t.status = "running", Pe(t, { type: "status", status: "running", stage: "uploading", message: "Preparing audio for cloud transcription" }), z.fal.config({ credentials: e.apiKey });
    const n = await eu(e.filePath);
    let r = "";
    try {
      const c = await L.readFile(n), u = `${_.basename(e.filePath, _.extname(e.filePath))}.m4a`, l = Jl(n), d = new Blob([c], { type: l }), m = new File([d], u, { type: l });
      r = await z.fal.storage.upload(m);
    } finally {
      await L.unlink(n).catch(() => {
      });
    }
    Pe(t, { type: "status", status: "running", stage: "transcribing", message: "Running cloud transcription" });
    const i = {
      audio_url: r,
      task: "transcribe",
      chunk_level: "word",
      version: Jr,
      ...e.language && e.language !== "auto" ? { language: e.language } : {}
    }, o = await z.fal.subscribe(Gl, { input: i, logs: !0 }), s = Zl(o);
    t.fullText = s.text, t.segments = s.segments, t.language = s.language, await Jn(t);
  })().catch((n) => {
    Me(t, n instanceof Error ? n.message : String(n));
  });
}
function au() {
  R.handle("transcription:start", async (t, e) => {
    const {
      projectId: n,
      assetId: r,
      filePath: i,
      model: o = "large",
      language: s = "auto",
      engine: c = "faster-whisper-local",
      apiKey: a
    } = e, u = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, l = {
      jobId: u,
      assetId: r,
      projectId: n,
      engine: c,
      status: "pending",
      segments: [],
      fullText: "",
      language: ""
    };
    return Vr.set(u, l), c === "whisperx-local" ? ou(l, { filePath: i, language: s }) : c === "whisper-cloud" ? su(l, { filePath: i, language: s, apiKey: a }) : iu(l, { filePath: i, model: o, language: s }), { jobId: u };
  }), R.handle("transcription:get", (t, e) => {
    const n = Vr.get(e);
    return n ? {
      status: n.status,
      fullText: n.fullText,
      segments: n.segments,
      language: n.language,
      engine: n.engine,
      error: n.error
    } : null;
  });
}
const Vn = _.join(W.homedir(), "Desktop", "Coding", "ltx"), cu = _.join(Vn, ".venv", "bin", "python"), lu = _.join(Vn, "cinegen_infer.py"), Yn = _.join(W.homedir(), "Desktop", "Coding", "qwen-edit"), uu = _.join(Yn, ".venv", "bin", "python"), du = _.join(Yn, "cinegen_infer.py"), po = _.join(W.homedir(), "Desktop", "Coding", "layer-decompose"), fu = _.join(po, ".venv", "bin", "python"), ho = _.join(W.homedir(), "Desktop", "Coding", "whisperx"), mu = _.join(ho, ".venv", "bin", "python");
function go(...t) {
  return X.isPackaged ? _.join(process.resourcesPath, ...t) : _.join(process.cwd(), ...t);
}
const pu = go("scripts", "layer-decompose", "cinegen_infer.py"), hu = go("scripts", "whisperx", "cinegen_infer.py"), gu = {
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
}, Yr = /* @__PURE__ */ new Map();
function yu() {
  return Y.getAllWindows().find((t) => !t.isDestroyed());
}
function ze(t, e) {
  var n;
  (n = yu()) == null || n.webContents.send("local-model:progress", { jobId: t, ...e });
}
async function Ct(t, e) {
  if (t.startsWith("http://") || t.startsWith("https://")) {
    const n = _.extname(new URL(t).pathname) || ".jpg", r = _.join(W.tmpdir(), `cinegen-img-${e}${n}`), i = await fetch(t);
    if (!i.ok) throw new Error(`Failed to download image: ${i.status}`);
    const o = await i.arrayBuffer();
    return await L.writeFile(r, Buffer.from(o)), { imagePath: r, tempPath: r };
  } else if (t.startsWith("local-media://file/"))
    return { imagePath: decodeURIComponent(t.replace("local-media://file", "")), tempPath: null };
  return { imagePath: t, tempPath: null };
}
function wu() {
  R.handle("local-model:run", async (t, e) => {
    const { inputs: n } = e, r = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, i = { jobId: r, status: "pending" };
    Yr.set(r, i);
    let o, s = null;
    if (e.nodeType === "qwen-edit-local") {
      const c = String(n.prompt ?? ""), a = Number(n.num_inference_steps ?? 50), u = Number(n.guidance_scale ?? 1), l = Number(n.true_cfg_scale ?? 4), d = Number(n.seed ?? 42);
      let m = null;
      if (n.image_url) {
        const g = await Ct(String(n.image_url), r);
        m = g.imagePath, s = g.tempPath;
      }
      if (!m) throw new Error("Qwen Image Edit requires an input image");
      const f = [
        du,
        "--image_path",
        m,
        "--prompt",
        c,
        "--num_inference_steps",
        String(a),
        "--guidance_scale",
        String(u),
        "--true_cfg_scale",
        String(l),
        "--seed",
        String(d)
      ];
      o = ne(uu, f, {
        cwd: Yn,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "layer-decompose") {
      console.log("[layer-decompose] inputs:", JSON.stringify(n, null, 2));
      const c = String(n.prompts ?? "").trim(), a = String(n.inpainter ?? "qwen-edit-local"), u = !!(n.reconstruct_bg ?? !0), l = Number(n.seed ?? 42);
      let d = null;
      if (n.image_url) {
        console.log("[layer-decompose] resolving image_url:", n.image_url);
        const g = await Ct(String(n.image_url), r);
        d = g.imagePath, s = g.tempPath, console.log("[layer-decompose] resolved to:", d);
      }
      if (!d) throw new Error("Layer Decompose requires an input image");
      const f = [
        pu,
        "--image_path",
        d,
        "--inpainter",
        u && a === "lama" ? "lama" : "none",
        "--seed",
        String(l)
      ];
      c && f.push("--prompts", c), o = ne(fu, f, {
        cwd: po,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "whisperx-local") {
      console.log("[whisperx] inputs:", JSON.stringify(n, null, 2));
      const c = String(n.model ?? "base"), a = String(n.language ?? "").trim(), u = n.diarize !== !1;
      let l = null;
      if (n.audio_url) {
        console.log("[whisperx] resolving audio_url:", n.audio_url);
        const g = await Ct(String(n.audio_url), r);
        l = g.imagePath, s = g.tempPath, console.log("[whisperx] resolved to:", l);
      }
      if (!l) throw new Error("WhisperX requires an audio input");
      const d = [
        hu,
        "--audio_path",
        l,
        "--model",
        c
      ];
      a && d.push("--language", a), u || d.push("--no_diarize");
      const m = process.env.HF_TOKEN, f = { ...process.env };
      m && (f.HF_TOKEN = m), o = ne(mu, d, {
        cwd: ho,
        stdio: ["ignore", "pipe", "pipe"],
        env: f
      });
    } else {
      const c = String(n.prompt ?? ""), a = String(n.resolution ?? "896x512"), { height: u, width: l } = gu[a] ?? { height: 512, width: 896 }, d = Number(n.frame_rate ?? 24), m = Number(n.duration_secs ?? 4), f = Math.round(m * d / 8) * 8 + 1, g = Math.max(9, f), y = Number(n.seed ?? 42), h = !!n.enhance_prompt;
      let p = null;
      if (n.image_url) {
        const E = await Ct(String(n.image_url), r);
        p = E.imagePath, s = E.tempPath;
      }
      const w = [
        lu,
        "--prompt",
        c,
        "--height",
        String(u),
        "--width",
        String(l),
        "--num_frames",
        String(g),
        "--frame_rate",
        String(d),
        "--seed",
        String(y)
      ];
      p && w.push("--image_path", p), h && w.push("--enhance_prompt"), o = ne(cu, w, {
        cwd: Vn,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }
    return i.status = "running", ze(r, { type: "status", status: "running" }), o.stdout.on("data", (c) => {
      for (const a of c.toString().split(`
`)) {
        const u = a.trim();
        if (u)
          try {
            const l = JSON.parse(u);
            l.type === "progress" ? (i.stage = l.stage, l.output_text !== void 0 && (i.outputText = l.output_text), l.segments && (i.segments = l.segments), l.language !== void 0 && (i.language = l.language), ze(r, {
              type: "progress",
              stage: l.stage,
              message: l.message,
              ...l.output_text !== void 0 && { output_text: l.output_text },
              ...l.segments && { segments: l.segments },
              ...l.language !== void 0 && { language: l.language }
            })) : l.type === "done" ? (i.status = "done", i.outputPath = l.output_path, i.outputText = l.output_text, i.transcriptPath = l.transcript_path, i.segments = l.segments, i.language = l.language, ze(r, {
              type: "done",
              output_path: l.output_path,
              ...l.output_text !== void 0 && { output_text: l.output_text },
              ...l.transcript_path !== void 0 && { transcript_path: l.transcript_path },
              ...l.segments && { segments: l.segments },
              ...l.language !== void 0 && { language: l.language },
              ...l.layers && { layers: l.layers },
              ...l.needs_inpainting !== void 0 && { needs_inpainting: l.needs_inpainting },
              ...l.combined_mask_path && { combined_mask_path: l.combined_mask_path }
            })) : l.type === "error" && (i.status = "error", i.error = l.error, ze(r, { type: "error", error: l.error }));
          } catch {
          }
      }
    }), o.stderr.on("data", () => {
    }), o.on("error", (c) => {
      i.status = "error", i.error = c.message, ze(r, { type: "error", error: c.message });
    }), o.on("close", (c) => {
      s && L.unlink(s).catch(() => {
      }), c !== 0 && i.status !== "done" && (i.status = "error", i.error = i.error ?? `Process exited with code ${c}`, ze(r, { type: "error", error: i.error }));
    }), { jobId: r };
  }), R.handle("local-model:get", (t, e) => {
    const n = Yr.get(e);
    return n ? {
      status: n.status,
      stage: n.stage,
      outputPath: n.outputPath,
      outputText: n.outputText,
      transcriptPath: n.transcriptPath,
      segments: n.segments,
      language: n.language,
      error: n.error
    } : null;
  }), R.handle("local-model:read-transcript", async (t, e) => {
    try {
      const n = await L.readFile(e, "utf8");
      return JSON.parse(n);
    } catch (n) {
      return console.error("[local-model] failed to read transcript:", n), null;
    }
  });
}
const Qn = _.join(W.homedir(), "Desktop", "Coding", "Sam3"), Eu = _.join(Qn, ".venv", "bin", "python"), _u = _.join(Qn, "cinegen_server.py"), Tu = 120 * 1e3, vu = 500, bu = 60;
class Su {
  constructor() {
    this.proc = null, this.port = 0, this.idleTimer = null;
  }
  async start() {
    var e, n;
    return this.proc && !this.proc.killed ? this.port : (this.port = await this.findFreePort(), console.log(`[sam3] Starting server on port ${this.port}`), this.proc = ne(Eu, [_u, "--port", String(this.port)], {
      cwd: Qn,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: "1"
      }
    }), (e = this.proc.stdout) == null || e.on("data", (r) => {
      console.log("[sam3-stdout]", r.toString().trim());
    }), (n = this.proc.stderr) == null || n.on("data", (r) => {
      const i = r.toString().trim();
      i && console.log("[sam3-stderr]", i);
    }), this.proc.on("exit", (r) => {
      console.log(`[sam3] Server exited with code ${r}`), this.proc = null;
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
    }, Tu);
  }
  async findFreePort() {
    return new Promise((e, n) => {
      const r = vo.createServer();
      r.listen(0, "127.0.0.1", () => {
        const i = r.address();
        if (i && typeof i == "object") {
          const o = i.port;
          r.close(() => e(o));
        } else
          n(new Error("Could not find free port"));
      });
    });
  }
  async waitForHealth() {
    console.log(`[sam3] Waiting for health on port ${this.port}...`);
    for (let e = 0; e < bu; e++) {
      try {
        if ((await fetch(`http://127.0.0.1:${this.port}/health`)).ok) {
          console.log(`[sam3] Health check passed after ${e + 1} attempts`);
          return;
        }
      } catch {
      }
      await new Promise((n) => setTimeout(n, vu));
    }
    throw console.error("[sam3] Health check timed out after 30 seconds"), new Error("SAM 3 server failed to start within 30 seconds");
  }
}
const gt = new Su();
function xu() {
  R.handle("sam3:start", async () => ({ port: await gt.ensureRunning() })), R.handle("sam3:stop", async () => {
    await gt.stop();
  }), R.handle("sam3:port", () => ({ port: gt.getPort(), running: gt.isRunning() }));
}
function Iu() {
  gt.stop();
}
function Au(t, e, n) {
  const r = n === "video" ? "video clip" : "image";
  return [
    t.trim() || `Describe this ${r} in detail.`,
    `Attached ${r}: "${e}".`,
    "Describe what you actually see and hear — specific subjects, actions, setting, camera movement, on-screen text, and spoken dialogue.",
    "Do not answer from clip names, storyboard labels, or generic production terminology alone."
  ].join(`
`);
}
async function Ru(t) {
  const e = t.workspaceDir ?? _.join(X.getPath("userData"), "gemini-cli-workspace"), n = await Wn(t.visualRefs, e);
  if (n.length === 0)
    throw new Error("Could not load the attached clip or asset files for visual analysis.");
  try {
    const r = [];
    for (const i of n) {
      const o = Au(t.prompt, i.label, i.mediaType), s = i.mediaType === "video" ? await Di({
        apiKey: t.apiKey,
        videoPath: i.mediaPath,
        prompt: o,
        detailedAnalysis: !0
      }) : await Sa({
        apiKey: t.apiKey,
        imagePath: i.mediaPath,
        prompt: o
      });
      r.push({
        label: i.label,
        mediaType: i.mediaType,
        analysis: s
      });
    }
    return r;
  } finally {
    zn(n);
  }
}
function Nu() {
  R.handle("copilot:analyze-visual-refs", async (t, e) => Ru(e));
}
const Ou = 1, Pu = -30, ku = 0.3;
function Cu(t) {
  const e = [];
  let n = null;
  for (const r of t.split(/\r?\n/)) {
    const i = r.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (i) {
      n = Number(i[1]);
      continue;
    }
    const o = r.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (o && n !== null) {
      const s = Number(o[1]);
      Number.isFinite(s) && s > n && e.push({ start: n, end: s }), n = null;
    }
  }
  return e;
}
function Qr(t) {
  return t.toFixed(2);
}
function Uu(t) {
  const { assetName: e, transcript: n } = t;
  if (n.length === 0)
    return [
      `Analyze the media "${e}", which has no spoken dialogue (b-roll / cutaway footage).`,
      "Listen and watch, then return compact JSON ONLY with this shape:",
      '{"segments":[{"start":0.0,"end":8.0,"content":"...","shotType":"wide","cutawayCandidate":true,"confidence":0.7}]}',
      "Break the clip into a few meaningful time ranges. For each range, describe the visual content and ambient sound,",
      "name a likely shotType, and set cutawayCandidate true when the range would work as a cutaway over interview audio.",
      "Return only JSON, no prose."
    ].join(`
`);
  const r = n.map((i) => `[${Qr(i.start)}-${Qr(i.end)}] ${i.text}`).join(`
`);
  return [
    `You are an assistant film editor analyzing the AUDIO performance in "${e}".`,
    "Here is the transcript with timecodes (seconds):",
    r,
    "",
    "Listen to the audio and, for each transcript segment (matched by its timecodes), describe HOW it was said.",
    "Return compact JSON ONLY with this shape:",
    `{"segments":[{"start":0.0,"end":3.2,"delivery":"voice steadies then cracks on 'home'","emotion":"reflective","energy":"low-and-deliberate","pace":"slow","notable":["400ms pause before 'home'","usable as hook"],"confidence":0.8}]}`,
    "Use rich descriptive text, NOT numeric scores. Capture vocal delivery, emotion, energy, pace, hesitations,",
    "laughter, breaths, and reflective pauses. Keep each field short. Return only JSON, no prose."
  ].join(`
`);
}
function ju(t) {
  var i;
  const e = t.trim();
  if (!e) return null;
  const n = (o) => {
    try {
      return JSON.parse(o), o;
    } catch {
      return null;
    }
  }, r = n(e);
  if (r) return r;
  for (const o of e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const s = (i = o[1]) == null ? void 0 : i.trim();
    if (s && n(s)) return s;
  }
  for (const [o, s] of [["{", "}"], ["[", "]"]]) {
    const c = e.indexOf(o);
    if (c === -1) continue;
    let a = 0;
    for (let u = c; u < e.length; u++) {
      const l = e[u];
      if (l === o) a++;
      else if (l === s && (a--, a === 0)) {
        const d = e.slice(c, u + 1), m = n(d);
        if (m) return m;
        break;
      }
    }
  }
  return null;
}
function wn(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : void 0;
}
function Xe(t) {
  return typeof t == "string" && t.trim() ? t.trim() : void 0;
}
function Lu(t) {
  if (!Array.isArray(t)) return;
  const e = t.filter((n) => typeof n == "string" && n.trim().length > 0).map((n) => n.trim());
  return e.length > 0 ? e : void 0;
}
function Du(t) {
  const e = ju(t);
  if (!e) return [];
  let n;
  try {
    n = JSON.parse(e);
  } catch {
    return [];
  }
  return (Array.isArray(n) ? n : n && typeof n == "object" && Array.isArray(n.segments) ? n.segments : []).flatMap((i) => {
    if (!i || typeof i != "object") return [];
    const o = i, s = wn(o.start), c = wn(o.end);
    return s === void 0 || c === void 0 || c <= s ? [] : [{
      start: s,
      end: c,
      delivery: Xe(o.delivery),
      emotion: Xe(o.emotion),
      energy: Xe(o.energy),
      pace: Xe(o.pace),
      notable: Lu(o.notable),
      content: Xe(o.content),
      shotType: Xe(o.shotType),
      cutawayCandidate: typeof o.cutawayCandidate == "boolean" ? o.cutawayCandidate : void 0,
      confidence: wn(o.confidence)
    }];
  });
}
function Mu(t) {
  return new Promise((e) => {
    const n = [
      "-i",
      t,
      "-af",
      `silencedetect=noise=${Pu}dB:d=${ku}`,
      "-f",
      "null",
      "-"
    ], r = ne(ye(), n);
    let i = "";
    r.stderr.on("data", (o) => {
      i += o.toString();
    }), r.on("error", () => e("")), r.on("close", () => e(i));
  });
}
const yo = "gemini-2.5-flash", Fu = "fal-ai/video-understanding";
async function $u(t, e) {
  var r;
  const n = ((r = t.model) == null ? void 0 : r.trim()) || yo;
  try {
    return { rawText: await Zi({
      mediaPath: t.mediaPath,
      prompt: e,
      model: n
    }), model: n };
  } catch (i) {
    if (!(i instanceof Bt)) throw i;
    if (!t.apiKey)
      throw new Error("Gemini CLI could not analyze this clip and no fal.ai API key is set for fallback.");
    return { rawText: await Di({
      apiKey: t.apiKey,
      videoPath: t.mediaPath,
      prompt: e,
      detailedAnalysis: !0
    }), model: Fu };
  }
}
async function Bu(t) {
  var n;
  const e = {
    assetId: t.assetId,
    status: "failed",
    version: Ou,
    model: ((n = t.model) == null ? void 0 : n.trim()) || yo,
    silenceMap: [],
    segments: [],
    hasSpeech: t.transcript.length > 0,
    sourceDurationSec: t.durationSec
  };
  try {
    const r = await Mu(t.mediaPath).catch(() => ""), i = Cu(r), o = Uu({ assetName: t.assetName, transcript: t.transcript }), { rawText: s, model: c } = await $u(t, o), a = Du(s);
    return {
      ...e,
      model: c,
      status: "ready",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      silenceMap: i,
      segments: a,
      error: i.length === 0 ? "Silence detection returned no intervals." : void 0
    };
  } catch (r) {
    const i = r instanceof Error ? r.message : String(r);
    return { ...e, error: i || "Acoustic analysis failed." };
  }
}
function Hu() {
  R.handle("acoustic:analyze-asset", async (t, e) => Bu(e));
}
const qu = process.platform === "darwin" && !X.isPackaged;
qu && (X.disableHardwareAcceleration(), X.commandLine.appendSwitch("disable-gpu-compositing"), console.log("[app] hardware acceleration disabled for macOS dev wake stability"));
X.commandLine.appendSwitch("disable-renderer-backgrounding");
X.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
ri.registerSchemesAsPrivileged([
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
let Q = null, ft = null, V = null, Ne = null;
const Wu = Date.now(), Zr = "cinegen-desktop", ei = "CineGen", zu = ".cinegen-user-data-migrated.json", ti = "CineGen", Xu = 700;
function En(t) {
  for (const e of Y.getAllWindows())
    e.isDestroyed() || e.webContents.send("app:power-event", { type: t });
}
const Gu = {
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
function Ku() {
  try {
    const t = X.getPath("appData"), e = _.join(t, Zr), n = _.join(t, ei);
    return X.getPath("userData") !== n && X.setPath("userData", n), console.log("[app] userData path:", n), { preferredUserDataPath: n, legacyUserDataPath: e };
  } catch (t) {
    console.error("[app] failed to configure userData path:", t);
    const e = X.getPath("appData"), n = _.join(e, ei), r = _.join(e, Zr);
    return { preferredUserDataPath: n, legacyUserDataPath: r };
  }
}
const Ju = Ku();
try {
  X.setName(ti), process.platform === "darwin" && X.setAboutPanelOptions({
    applicationName: ti,
    applicationVersion: X.getVersion(),
    version: X.getVersion()
  });
} catch (t) {
  console.error("[app] failed to configure app display name:", t);
}
async function Vu() {
  const { preferredUserDataPath: t, legacyUserDataPath: e } = Ju;
  if (t === e || !B.existsSync(e)) return;
  const n = _.join(t, zu);
  if (!B.existsSync(n))
    try {
      await L.mkdir(t, { recursive: !0 }), await L.cp(e, t, { recursive: !0, force: !0 }), await L.writeFile(
        n,
        JSON.stringify({
          migratedFrom: e,
          migratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, null, 2),
        "utf-8"
      ), console.log("[app] migrated userData:", e, "->", t);
    } catch (r) {
      console.error("[app] failed to migrate userData:", r);
    }
}
function Yu() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    process.cwd(),
    X.getAppPath(),
    process.resourcesPath
  ], n = [];
  for (const r of e)
    for (const i of t) {
      const o = _.join(r, "build", i);
      B.existsSync(o) && n.push(o);
    }
  return n;
}
function Qu(t) {
  const e = _.extname(t).toLowerCase();
  return Gu[e] ?? "application/octet-stream";
}
function Zu(t, e) {
  return t.get(e) ?? t.get(e.toLowerCase()) ?? t.get(e.toUpperCase());
}
function ed(t, e) {
  var s;
  if (!t.startsWith("bytes=")) return null;
  const n = ((s = t.slice(6).split(",")[0]) == null ? void 0 : s.trim()) ?? "", r = /^(\d*)-(\d*)$/.exec(n);
  if (!r) return null;
  const i = r[1], o = r[2];
  if (!i && o) {
    const c = Number.parseInt(o, 10);
    if (!Number.isFinite(c) || c <= 0) return null;
    const a = Math.max(e - c, 0), u = e - 1;
    return a <= u ? { start: a, end: u } : null;
  }
  if (i) {
    const c = Number.parseInt(i, 10), a = o ? Number.parseInt(o, 10) : e - 1;
    if (!Number.isFinite(c) || !Number.isFinite(a)) return null;
    const u = Math.min(a, e - 1);
    return c < 0 || u < c || c >= e ? null : { start: c, end: u };
  }
  return null;
}
function td(t) {
  const e = new URL(t);
  if (e.hostname !== "file") return null;
  let n = decodeURIComponent(e.pathname);
  return process.platform === "win32" && n.startsWith("/") && (n = n.slice(1)), _.normalize(n);
}
async function nd() {
  var r, i, o, s;
  const t = _.join(process.cwd(), ".data", "dev", "project.json"), e = _.join(W.homedir(), "Documents", "CINEGEN"), n = _.join(e, "projects.json");
  try {
    await L.access(t);
  } catch {
    return;
  }
  try {
    await L.access(n);
    return;
  } catch {
  }
  try {
    const c = await L.readFile(t, "utf-8"), a = JSON.parse(c), u = ((r = a.project) == null ? void 0 : r.id) || G.randomUUID(), l = ((i = a.project) == null ? void 0 : i.name) || "Migrated Project";
    await L.mkdir(_.join(e, u), { recursive: !0 }), await L.writeFile(
      _.join(e, u, "project.json"),
      JSON.stringify(a, null, 2),
      "utf-8"
    );
    const d = {
      projects: [{
        id: u,
        name: l,
        createdAt: ((o = a.project) == null ? void 0 : o.createdAt) || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: ((s = a.project) == null ? void 0 : s.updatedAt) || (/* @__PURE__ */ new Date()).toISOString(),
        assetCount: Array.isArray(a.assets) ? a.assets.length : 0,
        elementCount: Array.isArray(a.elements) ? a.elements.length : 0,
        thumbnail: null
      }]
    };
    await L.writeFile(n, JSON.stringify(d, null, 2), "utf-8"), console.log(`[migration] Migrated legacy project "${l}" to ${e}/${u}`);
  } catch (c) {
    console.error("[migration] Failed to migrate legacy data:", c);
  }
}
X.whenReady().then(async () => {
  if (await Vu(), process.platform === "darwin") {
    const n = Yu();
    console.log("[dock] icon candidates:", n);
    for (const r of n)
      try {
        const i = To.createFromPath(r);
        if (console.log("[dock] testing icon:", r, "empty?", i.isEmpty()), !i.isEmpty()) {
          await Promise.resolve(X.dock.setIcon(i)), console.log("[dock] applied icon:", r);
          break;
        }
      } catch (i) {
        console.error("[dock] failed to apply icon:", r, i);
      }
  }
  ri.handle("local-media", async (n) => {
    try {
      const r = td(n.url);
      if (!r)
        return new Response("Invalid local-media host", { status: 400 });
      const i = await L.stat(r);
      if (!i.isFile())
        return new Response("Not a file", { status: 404 });
      const o = i.size, s = Qu(r), c = Zu(n.headers, "range");
      if (n.method.toUpperCase() === "HEAD")
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": s,
            "Content-Length": String(o),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      if (c) {
        const l = ed(c, o);
        if (!l)
          return new Response("Invalid Range", { status: 416 });
        const d = l.start, m = l.end;
        if (d < 0 || m < d || d >= o)
          return new Response("Range Not Satisfiable", {
            status: 416,
            headers: {
              "Content-Range": `bytes */${o}`
            }
          });
        const f = m - d + 1, g = B.createReadStream(r, { start: d, end: m }), y = nr.toWeb(g);
        return new Response(y, {
          status: 206,
          headers: {
            "Content-Type": s,
            "Content-Length": String(f),
            "Content-Range": `bytes ${d}-${m}/${o}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }
      const a = B.createReadStream(r), u = nr.toWeb(a);
      return new Response(u, {
        status: 200,
        headers: {
          "Content-Type": s,
          "Content-Length": String(o),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      });
    } catch (r) {
      return console.error("[local-media] Failed request:", n.url, r), new Response("Invalid local-media URL", { status: 400 });
    }
  }), Uo(), ia(), js(), ca(), da(), Va(), lc(), mc(), wc(), Lc(), Fc(), $c(), El(), kl(), Ul(he), Ia(), Nu(), Hu(), Hl(), au(), wu(), xu(), await nd(), R.handle("pm:open-project", async (n, r, i) => r === "__close__" ? (V == null || V.close(), V = null, { ok: !0 }) : ((!Q || Q.isDestroyed()) && (Q = sr()), Q.once("ready-to-show", () => {
    Q == null || Q.maximize(), Q == null || Q.show(), Q == null || Q.webContents.send("pm:open-project", r, i);
  }), Q.webContents.getURL() !== "" && (Q.maximize(), Q.show(), Q.webContents.send("pm:open-project", r, i)), V == null || V.close(), V = null, { ok: !0 })), R.handle("pm:open", async () => V && !V.isDestroyed() ? (V.focus(), { ok: !0 }) : (V = cn(), V.on("closed", () => {
    V = null;
  }), { ok: !0 })), ft = Oo(), Q = sr();
  const t = 3e3;
  Q.once("ready-to-show", () => {
    const n = Date.now() - Wu, r = Math.max(0, t - n);
    setTimeout(() => {
      ft == null || ft.close(), ft = null, V = cn(), V.on("closed", () => {
        V = null;
      });
    }, r);
  }), X.on("activate", () => {
    Y.getAllWindows().length === 0 && (V = cn(), V.on("closed", () => {
      V = null;
    }));
  });
  const e = (n) => {
    Ne && (clearTimeout(Ne), Ne = null), Ne = setTimeout(() => {
      Ne = null, console.log(`[app] Wake recovery triggered by ${n}`), No(n);
    }, Xu);
  };
  sn.on("resume", () => {
    En("resume"), e("resume");
  }), sn.on("unlock-screen", () => {
    En("unlock-screen"), e("unlock-screen");
  }), sn.on("suspend", () => {
    En("suspend");
  });
});
X.on("before-quit", () => {
  Ne && (clearTimeout(Ne), Ne = null), Cl(), _l(), Iu();
});
X.on("window-all-closed", () => {
  process.platform !== "darwin" && X.quit();
});
