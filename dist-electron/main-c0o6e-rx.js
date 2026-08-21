var es = Object.defineProperty;
var ts = (t, e, n) => e in t ? es(t, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : t[e] = n;
var D = (t, e, n) => ts(t, typeof e != "symbol" ? e + "" : e, n);
import { BrowserWindow as V, screen as ji, ipcMain as I, app as J, dialog as pr, shell as ns, protocol as qi, nativeImage as rs, powerMonitor as mn } from "electron";
import C, { mkdir as tt } from "node:fs/promises";
import F from "node:fs";
import w from "node:path";
import z from "node:os";
import K, { randomUUID as yr } from "node:crypto";
import { Readable as hr } from "node:stream";
import Hn from "better-sqlite3";
import { spawn as ne, execFile as kt } from "node:child_process";
import { createRequire as Ii } from "node:module";
import { fileURLToPath as Wn } from "node:url";
import { promisify as zn } from "node:util";
import { Worker as Ai } from "worker_threads";
import is from "node:net";
const as = 1200, ss = 150, os = 1e3, gr = 2800, ki = /* @__PURE__ */ new WeakMap(), Ri = /* @__PURE__ */ new WeakMap(), Gt = /* @__PURE__ */ new WeakMap(), Oi = /* @__PURE__ */ new WeakMap();
function ls() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    ...t.map((n) => w.resolve(process.cwd(), "build", n)),
    ...t.map((n) => w.resolve(import.meta.dirname, "../build", n))
  ];
  for (const n of e)
    if (F.existsSync(n)) return n;
}
const nt = ls(), Qt = w.join(import.meta.dirname, "."), Ni = w.join(Qt, "../dist"), Rt = process.env.VITE_DEV_SERVER_URL;
function _r(t) {
  return Rt ? t.loadURL(`${Rt}?pm=1`) : t.loadFile(w.join(Ni, "index.html"), { query: { pm: "1" } });
}
function wr(t) {
  return Rt ? t.loadURL(Rt) : t.loadFile(w.join(Ni, "index.html"));
}
function pn(t, e) {
  const n = Gt.get(t) ?? /* @__PURE__ */ new Set();
  n.add(e), Gt.set(t, n);
}
function Ut(t, e) {
  var n;
  (n = Gt.get(t)) == null || n.delete(e);
}
function Pi(t) {
  const e = Gt.get(t);
  if (e) {
    for (const n of e)
      clearTimeout(n);
    e.clear();
  }
}
function us(t) {
  return new Promise((e, n) => {
    let r = !1;
    const i = () => {
      t.webContents.removeListener("did-finish-load", a), t.webContents.removeListener("did-fail-load", s);
    }, a = () => {
      r || (r = !0, i(), e());
    }, s = (l, o, u, d, c) => {
      r || !c || o === -3 || (r = !0, i(), n(new Error(`did-fail-load ${o}: ${u}`)));
    };
    t.webContents.on("did-finish-load", a), t.webContents.on("did-fail-load", s), t.webContents.reloadIgnoringCache();
  });
}
async function In(t, e, n, r) {
  if (t.isDestroyed()) return;
  if (console.warn(`[window] ${e} reloading after wake: ${r}`), t.webContents.getURL()) {
    await us(t);
    return;
  }
  await n(t);
}
async function ds(t, e, n) {
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
      await In(t, e, n, "blank renderer DOM after resume");
    } catch (r) {
      console.warn(`[window] ${e} health check failed after wake:`, r), await In(t, e, n, "resume health check failed");
    }
}
function cs(t) {
  for (const e of V.getAllWindows()) {
    if (e.isDestroyed()) continue;
    const n = ki.get(e);
    if (!n) continue;
    const r = Ri.get(e) ?? "window";
    Pi(e), Oi.set(e, Date.now() + gr + 1e3);
    let i = null;
    const a = setTimeout(() => {
      Ut(e, a), !e.isDestroyed() && (console.log(`[window] ${r} wake recovery started: ${t}`), e.webContents.invalidate(), e.webContents.executeJavaScript(
        `(() => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
        !0
      ).catch(() => {
      }), e.isVisible() && (e.show(), e.focus()));
    }, ss);
    pn(e, a);
    const s = setTimeout(() => {
      Ut(e, s), (async () => {
        try {
          await ds(e, r, n), i && (clearTimeout(i), Ut(e, i), i = null);
        } catch (l) {
          console.warn(`[window] ${r} resume health check threw:`, l);
        }
      })();
    }, os);
    pn(e, s), i = setTimeout(() => {
      Ut(e, i), !e.isDestroyed() && In(e, r, n, `hard reload after ${t}`).catch((l) => {
        console.error(`[window] ${r} hard reload failed:`, l);
      });
    }, gr), pn(e, i);
  }
}
function Ci(t, e, n) {
  let r = null;
  ki.set(t, n), Ri.set(t, e);
  const i = (a) => {
    if (t.isDestroyed() || r) return;
    const s = Oi.get(t) ?? 0;
    if (a === "window became unresponsive" && Date.now() < s) {
      console.warn(`[window] ${e} suppressing reload during wake recovery: ${a}`);
      return;
    }
    console.warn(`[window] ${e} scheduling reload: ${a}`), r = setTimeout(() => {
      r = null, !t.isDestroyed() && n(t).catch((l) => {
        console.error(`[window] ${e} reload failed:`, l);
      });
    }, as);
  };
  t.on("unresponsive", () => {
    i("window became unresponsive");
  }), t.on("closed", () => {
    r && (clearTimeout(r), r = null), Pi(t);
  }), t.webContents.on("render-process-gone", (a, s) => {
    i(`render process gone (${s.reason})`);
  }), t.webContents.on("did-fail-load", (a, s, l, o, u) => {
    !u || s === -3 || i(`did-fail-load ${s}: ${l}`);
  });
}
function yn() {
  const { width: t, height: e } = ji.getPrimaryDisplay().workAreaSize, n = 900, r = 580, i = new V({
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
    ...nt ? { icon: nt } : {},
    webPreferences: {
      preload: w.join(Qt, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return Ci(i, "project-manager", _r), _r(i), i;
}
function fs() {
  const { width: t, height: e } = ji.getPrimaryDisplay().workAreaSize, n = 800, r = 395, i = new V({
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
    ...nt ? { icon: nt } : {},
    webPreferences: {
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return i.loadFile(w.join(Qt, "splash.html")), i;
}
function br() {
  const t = new V({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: !1,
    backgroundColor: "#08090c",
    titleBarStyle: "hiddenInset",
    ...nt ? { icon: nt } : {},
    webPreferences: {
      preload: w.join(Qt, "preload.js"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return Ci(t, "main", wr), wr(t), Rt && t.webContents.openDevTools({ mode: "detach" }), t;
}
function Gn() {
  return w.join(z.homedir(), "Documents", "CINEGEN");
}
function An() {
  return w.join(Gn(), "projects.json");
}
function Ot(t) {
  return w.join(Gn(), t);
}
function We(t) {
  return w.join(Ot(t), "project.json");
}
function Ui() {
  return K.randomUUID();
}
function Li() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function Di() {
  await C.mkdir(Gn(), { recursive: !0 });
}
async function Lt() {
  try {
    const t = await C.readFile(An(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function hn(t) {
  await Di();
  const e = An() + ".tmp";
  await C.writeFile(e, JSON.stringify(t, null, 2), "utf-8"), await C.rename(e, An());
}
function ms(t, e) {
  const n = Li(), r = {
    id: Ui(),
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
    elements: [],
    director: {
      sourceText: "",
      clipLengthSec: 20,
      stylePrefix: "",
      aspectRatio: "16:9",
      adapterId: "seedance-2.5",
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
function ps(t) {
  const e = w.join(Ot(t), "project.json");
  if (!F.existsSync(e)) return null;
  try {
    const n = F.readFileSync(e, "utf-8"), i = (JSON.parse(n).assets ?? []).find(
      (a) => (a.type === "video" || a.type === "image") && a.thumbnailUrl
    );
    return (i == null ? void 0 : i.thumbnailUrl) ?? null;
  } catch {
    return null;
  }
}
function ys(t) {
  const e = w.join(Ot(t), "project.db");
  if (!F.existsSync(e)) return null;
  try {
    const n = new Hn(e, { readonly: !0 }), r = n.prepare(
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
function hs() {
  I.handle("project:list", async () => (await Lt()).projects.map((e) => {
    const n = e.useSqlite ? ys(e.id) : ps(e.id);
    return { ...e, thumbnail: n };
  })), I.handle("project:create", async (t, e) => {
    const n = e.trim();
    if (!n || n.length > 100)
      throw new Error("Project name must be 1-100 characters");
    const r = Ui(), i = ms(r, n);
    await Di(), await C.mkdir(Ot(r), { recursive: !0 });
    const a = We(r) + ".tmp";
    await C.writeFile(a, JSON.stringify(i, null, 2), "utf-8"), await C.rename(a, We(r));
    const s = await Lt();
    return s.projects.unshift({
      id: r,
      name: n,
      createdAt: i.project.createdAt,
      updatedAt: i.project.updatedAt,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null
    }), await hn(s), i;
  }), I.handle("project:load", async (t, e) => {
    const n = await C.readFile(We(e), "utf-8");
    return JSON.parse(n);
  }), I.handle("project:save", async (t, e, n) => {
    let r;
    try {
      const o = await C.readFile(We(e), "utf-8");
      r = JSON.parse(o);
    } catch {
      throw new Error(`Project ${e} not found`);
    }
    const i = {
      ...r,
      ...n,
      project: {
        ...r.project,
        ...n.project ?? {},
        updatedAt: Li()
      }
    }, a = We(e) + ".tmp";
    await C.writeFile(a, JSON.stringify(i, null, 2), "utf-8"), await C.rename(a, We(e));
    const s = await Lt(), l = s.projects.find((o) => o.id === e);
    return l && (l.updatedAt = i.project.updatedAt, l.assetCount = Array.isArray(i.assets) ? i.assets.length : 0, l.elementCount = Array.isArray(i.elements) ? i.elements.length : 0, n.project && n.project.name && (l.name = n.project.name), await hn(s)), i;
  }), I.handle("project:delete", async (t, e) => {
    await C.rm(Ot(e), { recursive: !0, force: !0 });
    const n = await Lt();
    n.projects = n.projects.filter((r) => r.id !== e), await hn(n);
  });
}
function gs(t) {
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
var De = {}, ze = {}, gn = {}, ct = {}, Er;
function Mi() {
  return Er || (Er = 1, (function(t) {
    var e = ct && ct.__awaiter || function(i, a, s, l) {
      function o(u) {
        return u instanceof s ? u : new s(function(d) {
          d(u);
        });
      }
      return new (s || (s = Promise))(function(u, d) {
        function c(h) {
          try {
            f(l.next(h));
          } catch (_) {
            d(_);
          }
        }
        function m(h) {
          try {
            f(l.throw(h));
          } catch (_) {
            d(_);
          }
        }
        function f(h) {
          h.done ? u(h.value) : o(h.value).then(c, m);
        }
        f((l = l.apply(i, a || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.TARGET_URL_HEADER = void 0, t.withMiddleware = n, t.withProxy = r;
    function n(...i) {
      const a = (s) => typeof s == "function";
      return (s) => e(this, void 0, void 0, function* () {
        let l = Object.assign({}, s);
        for (const o of i.filter(a))
          l = yield o(l);
        return l;
      });
    }
    t.TARGET_URL_HEADER = "x-fal-target-url";
    function r(i) {
      const a = (s) => Promise.resolve(s);
      return typeof window > "u" ? a : (s) => s.headers && t.TARGET_URL_HEADER in s ? a(s) : Promise.resolve(Object.assign(Object.assign({}, s), { url: i.targetUrl, headers: Object.assign(Object.assign({}, s.headers || {}), { [t.TARGET_URL_HEADER]: s.url }) }));
    }
  })(ct)), ct;
}
var pe = {}, _n = {}, vr;
function Jn() {
  return vr || (vr = 1, (function(t) {
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
  })(_n)), _n;
}
var Tr;
function Be() {
  if (Tr) return pe;
  Tr = 1;
  var t = pe && pe.__awaiter || function(l, o, u, d) {
    function c(m) {
      return m instanceof u ? m : new u(function(f) {
        f(m);
      });
    }
    return new (u || (u = Promise))(function(m, f) {
      function h(p) {
        try {
          y(d.next(p));
        } catch (g) {
          f(g);
        }
      }
      function _(p) {
        try {
          y(d.throw(p));
        } catch (g) {
          f(g);
        }
      }
      function y(p) {
        p.done ? m(p.value) : c(p.value).then(h, _);
      }
      y((d = d.apply(l, o || [])).next());
    });
  };
  Object.defineProperty(pe, "__esModule", { value: !0 }), pe.ValidationError = pe.ApiError = void 0, pe.defaultResponseHandler = a, pe.resultResponseHandler = s;
  const e = Jn(), n = "x-fal-request-id";
  class r extends Error {
    constructor({ message: o, status: u, body: d, requestId: c, timeoutType: m }) {
      super(o), this.name = "ApiError", this.status = u, this.body = d, this.requestId = c || "", this.timeoutType = m;
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
    constructor(o) {
      super(o), this.name = "ValidationError";
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
    getFieldErrors(o) {
      return this.fieldErrors.filter((u) => u.loc[u.loc.length - 1] === o);
    }
  }
  pe.ValidationError = i;
  function a(l) {
    return t(this, void 0, void 0, function* () {
      var o;
      const { status: u, statusText: d } = l, c = (o = l.headers.get("Content-Type")) !== null && o !== void 0 ? o : "", m = l.headers.get(n) || void 0, f = l.headers.get(e.REQUEST_TIMEOUT_TYPE_HEADER) || void 0;
      if (!l.ok) {
        if (c.includes("application/json")) {
          const h = yield l.json(), _ = u === 422 ? i : r;
          throw new _({
            message: h.message || d,
            status: u,
            body: h,
            requestId: m,
            timeoutType: f
          });
        }
        throw new r({
          message: `HTTP ${u}: ${d}`,
          status: u,
          requestId: m,
          timeoutType: f
        });
      }
      return c.includes("application/json") ? l.json() : c.includes("text/html") ? l.text() : c.includes("application/octet-stream") ? l.arrayBuffer() : l.text();
    });
  }
  function s(l) {
    return t(this, void 0, void 0, function* () {
      return {
        data: yield a(l),
        requestId: l.headers.get(n) || ""
      };
    });
  }
  return pe;
}
var ft = {}, oe = {}, Sr;
function Ne() {
  if (Sr) return oe;
  Sr = 1;
  var t = oe && oe.__awaiter || function(c, m, f, h) {
    function _(y) {
      return y instanceof f ? y : new f(function(p) {
        p(y);
      });
    }
    return new (f || (f = Promise))(function(y, p) {
      function g(T) {
        try {
          E(h.next(T));
        } catch (S) {
          p(S);
        }
      }
      function b(T) {
        try {
          E(h.throw(T));
        } catch (S) {
          p(S);
        }
      }
      function E(T) {
        T.done ? y(T.value) : _(T.value).then(g, b);
      }
      E((h = h.apply(c, m || [])).next());
    });
  };
  Object.defineProperty(oe, "__esModule", { value: !0 }), oe.ensureEndpointIdFormat = e, oe.parseEndpointId = r, oe.resolveEndpointPath = i, oe.isValidUrl = a, oe.throttle = s, oe.isReact = o, oe.isPlainObject = u, oe.sleep = d;
  function e(c) {
    if (c.split("/").length > 1)
      return c;
    const [, f, h] = /^([0-9]+)-([a-zA-Z0-9-]+)$/.exec(c) || [];
    if (f && h)
      return `${f}/${h}`;
    throw new Error(`Invalid app id: ${c}. Must be in the format <appOwner>/<appId>`);
  }
  const n = ["workflows", "comfy"];
  function r(c) {
    const f = e(c).split("/");
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
  function i(c, m, f) {
    if (m)
      return `/${m.replace(/^\/+/, "")}`;
    if (!c.endsWith(f))
      return f;
  }
  function a(c) {
    try {
      const { host: m } = new URL(c);
      return /(fal\.(ai|run))$/.test(m);
    } catch {
      return !1;
    }
  }
  function s(c, m, f = !1) {
    let h, _;
    return (...y) => {
      !_ && f ? (c(...y), _ = Date.now()) : (h && clearTimeout(h), h = setTimeout(() => {
        Date.now() - _ >= m && (c(...y), _ = Date.now());
      }, m - (Date.now() - _)));
    };
  }
  let l;
  function o() {
    if (l === void 0) {
      const c = new Error().stack;
      l = !!c && (c.includes("node_modules/react-dom/") || c.includes("node_modules/next/"));
    }
    return l;
  }
  function u(c) {
    return !!c && Object.getPrototypeOf(c) === Object.prototype;
  }
  function d(c) {
    return t(this, void 0, void 0, function* () {
      return new Promise((m) => setTimeout(m, c));
    });
  }
  return oe;
}
var xr;
function Zt() {
  return xr || (xr = 1, (function(t) {
    var e = ft && ft.__awaiter || function(l, o, u, d) {
      function c(m) {
        return m instanceof u ? m : new u(function(f) {
          f(m);
        });
      }
      return new (u || (u = Promise))(function(m, f) {
        function h(p) {
          try {
            y(d.next(p));
          } catch (g) {
            f(g);
          }
        }
        function _(p) {
          try {
            y(d.throw(p));
          } catch (g) {
            f(g);
          }
        }
        function y(p) {
          p.done ? m(p.value) : c(p.value).then(h, _);
        }
        y((d = d.apply(l, o || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.DEFAULT_RETRY_OPTIONS = t.DEFAULT_RETRYABLE_STATUS_CODES = void 0, t.isRetryableError = i, t.calculateBackoffDelay = a, t.executeWithRetry = s;
    const n = Be(), r = Ne();
    t.DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504], t.DEFAULT_RETRY_OPTIONS = {
      maxRetries: 3,
      baseDelay: 1e3,
      maxDelay: 3e4,
      backoffMultiplier: 2,
      retryableStatusCodes: t.DEFAULT_RETRYABLE_STATUS_CODES,
      enableJitter: !0
    };
    function i(l, o) {
      return !(l instanceof n.ApiError) || l.isUserTimeout ? !1 : o.includes(l.status);
    }
    function a(l, o, u, d, c) {
      const m = Math.min(o * Math.pow(d, l), u);
      if (c) {
        const f = 0.25 * m * (Math.random() * 2 - 1);
        return Math.max(0, m + f);
      }
      return m;
    }
    function s(l, o, u) {
      return e(this, void 0, void 0, function* () {
        const d = {
          totalAttempts: 0,
          totalDelay: 0
        };
        let c;
        for (let m = 0; m <= o.maxRetries; m++) {
          d.totalAttempts++;
          try {
            return { result: yield l(), metrics: d };
          } catch (f) {
            if (c = f, d.lastError = f, m === o.maxRetries || !i(f, o.retryableStatusCodes))
              throw f;
            const h = a(m, o.baseDelay, o.maxDelay, o.backoffMultiplier, o.enableJitter);
            d.totalDelay += h, u && u(m + 1, f, h), yield (0, r.sleep)(h);
          }
        }
        throw c;
      });
    }
  })(ft)), ft;
}
var mt = {};
const _s = "@fal-ai/client", ws = "1.9.4", bs = {
  name: _s,
  version: ws
};
var jr;
function Kn() {
  if (jr) return mt;
  jr = 1, Object.defineProperty(mt, "__esModule", { value: !0 }), mt.isBrowser = t, mt.getUserAgent = n;
  function t() {
    return typeof window < "u" && typeof window.document < "u";
  }
  let e = null;
  function n() {
    if (e !== null)
      return e;
    const r = bs;
    return e = `${r.name}/${r.version}`, e;
  }
  return mt;
}
var qr;
function Xn() {
  return qr || (qr = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.credentialsFromEnv = void 0, t.resolveDefaultFetch = a, t.createConfig = u, t.getRestApiUrl = d;
    const e = Mi(), n = Be(), r = Zt(), i = Kn();
    function a() {
      if (typeof fetch > "u")
        throw new Error("Your environment does not support fetch. Please provide your own fetch implementation.");
      return fetch;
    }
    function s() {
      return typeof process < "u" && process.env && (typeof process.env.FAL_KEY < "u" || typeof process.env.FAL_KEY_ID < "u" && typeof process.env.FAL_KEY_SECRET < "u");
    }
    const l = () => {
      if (s())
        return typeof process.env.FAL_KEY < "u" ? process.env.FAL_KEY : process.env.FAL_KEY_ID ? `${process.env.FAL_KEY_ID}:${process.env.FAL_KEY_SECRET}` : void 0;
    };
    t.credentialsFromEnv = l;
    const o = {
      credentials: t.credentialsFromEnv,
      suppressLocalCredentialsWarning: !1,
      requestMiddleware: (c) => Promise.resolve(c),
      responseHandler: n.defaultResponseHandler,
      retry: r.DEFAULT_RETRY_OPTIONS
    };
    function u(c) {
      var m;
      let f = Object.assign(Object.assign(Object.assign({}, o), c), {
        fetch: (m = c.fetch) !== null && m !== void 0 ? m : a(),
        // Merge retry configuration with defaults
        retry: Object.assign(Object.assign({}, r.DEFAULT_RETRY_OPTIONS), c.retry || {})
      });
      c.proxyUrl && (f = Object.assign(Object.assign({}, f), { requestMiddleware: (0, e.withMiddleware)(f.requestMiddleware, (0, e.withProxy)({ targetUrl: c.proxyUrl })) }));
      const { credentials: h, suppressLocalCredentialsWarning: _ } = f, y = typeof h == "function" ? h() : h;
      return (0, i.isBrowser)() && y && !_ && console.warn("The fal credentials are exposed in the browser's environment. That's not recommended for production use cases."), f;
    }
    function d() {
      return "https://rest.fal.ai";
    }
  })(gn)), gn;
}
var we = {}, be = {}, Ir;
function Pt() {
  if (Ir) return be;
  Ir = 1;
  var t = be && be.__awaiter || function(o, u, d, c) {
    function m(f) {
      return f instanceof d ? f : new d(function(h) {
        h(f);
      });
    }
    return new (d || (d = Promise))(function(f, h) {
      function _(g) {
        try {
          p(c.next(g));
        } catch (b) {
          h(b);
        }
      }
      function y(g) {
        try {
          p(c.throw(g));
        } catch (b) {
          h(b);
        }
      }
      function p(g) {
        g.done ? f(g.value) : m(g.value).then(_, y);
      }
      p((c = c.apply(o, u || [])).next());
    });
  }, e = be && be.__rest || function(o, u) {
    var d = {};
    for (var c in o) Object.prototype.hasOwnProperty.call(o, c) && u.indexOf(c) < 0 && (d[c] = o[c]);
    if (o != null && typeof Object.getOwnPropertySymbols == "function")
      for (var m = 0, c = Object.getOwnPropertySymbols(o); m < c.length; m++)
        u.indexOf(c[m]) < 0 && Object.prototype.propertyIsEnumerable.call(o, c[m]) && (d[c[m]] = o[c[m]]);
    return d;
  };
  Object.defineProperty(be, "__esModule", { value: !0 }), be.dispatchRequest = s, be.buildUrl = l;
  const n = Zt(), r = Kn(), i = Ne(), a = typeof navigator < "u" && (navigator == null ? void 0 : navigator.userAgent) === "Cloudflare-Workers";
  function s(o) {
    return t(this, void 0, void 0, function* () {
      var u;
      const { targetUrl: d, input: c, config: m, options: f = {} } = o, { credentials: h, requestMiddleware: _, responseHandler: y, fetch: p } = m, g = Object.assign(Object.assign({}, m.retry), f.retry || {}), b = () => t(this, void 0, void 0, function* () {
        var T, S, x;
        const v = (0, r.isBrowser)() ? {} : { "User-Agent": (0, r.getUserAgent)() }, j = typeof h == "function" ? h() : h, { method: N, url: O, headers: L } = yield _({
          method: ((S = (T = o.method) !== null && T !== void 0 ? T : f.method) !== null && S !== void 0 ? S : "post").toUpperCase(),
          url: d,
          headers: o.headers
        }), M = j ? { Authorization: `Key ${j}` } : {}, B = Object.assign(Object.assign(Object.assign(Object.assign({}, M), { Accept: "application/json", "Content-Type": "application/json" }), v), L ?? {}), { responseHandler: H, retry: A } = f, R = e(f, ["responseHandler", "retry"]), $ = yield p(O, Object.assign(Object.assign(Object.assign(Object.assign({}, R), { method: N, headers: Object.assign(Object.assign({}, B), (x = R.headers) !== null && x !== void 0 ? x : {}) }), !a && { mode: "cors" }), { signal: f.signal, body: N.toLowerCase() !== "get" && c ? JSON.stringify(c) : void 0 }));
        return yield (H ?? y)($);
      });
      let E;
      for (let T = 0; T <= g.maxRetries; T++)
        try {
          return yield b();
        } catch (S) {
          if (E = S, T === g.maxRetries || !(0, n.isRetryableError)(S, g.retryableStatusCodes) || ((u = f.signal) === null || u === void 0 ? void 0 : u.aborted))
            throw S;
          const v = (0, n.calculateBackoffDelay)(T, g.baseDelay, g.maxDelay, g.backoffMultiplier, g.enableJitter);
          yield (0, i.sleep)(v);
        }
      throw E;
    });
  }
  function l(o, u = {}) {
    var d, c;
    const m = ((d = u.method) !== null && d !== void 0 ? d : "post").toLowerCase(), f = ((c = u.path) !== null && c !== void 0 ? c : "").replace(/^\//, "").replace(/\/{2,}/, "/"), h = u.input, _ = Object.assign(Object.assign({}, u.query || {}), m === "get" ? h : {}), y = Object.keys(_).length > 0 ? `?${new URLSearchParams(_).toString()}` : "";
    if ((0, i.isValidUrl)(o))
      return `${o.endsWith("/") ? o : `${o}/`}${f}${y}`;
    const p = (0, i.ensureEndpointIdFormat)(o);
    return `${`https://${u.subdomain ? `${u.subdomain}.` : ""}fal.run/${p}/${f}`.replace(/\/$/, "")}${y}`;
  }
  return be;
}
var pt = {}, Ar;
function Fi() {
  return Ar || (Ar = 1, (function(t) {
    var e = pt && pt.__awaiter || function(h, _, y, p) {
      function g(b) {
        return b instanceof y ? b : new y(function(E) {
          E(b);
        });
      }
      return new (y || (y = Promise))(function(b, E) {
        function T(v) {
          try {
            x(p.next(v));
          } catch (j) {
            E(j);
          }
        }
        function S(v) {
          try {
            x(p.throw(v));
          } catch (j) {
            E(j);
          }
        }
        function x(v) {
          v.done ? b(v.value) : g(v.value).then(T, S);
        }
        x((p = p.apply(h, _ || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = void 0, t.getExpirationDurationSeconds = s, t.buildObjectLifecycleHeaders = l, t.createStorageClient = f;
    const n = Xn(), r = Pt(), i = Ne();
    t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = "x-fal-object-lifecycle-preference";
    const a = {
      never: 31536e5,
      // 100 years
      immediate: void 0,
      "1h": 3600,
      "1d": 86400,
      "7d": 604800,
      "30d": 2592e3,
      "1y": 31536e3
    };
    function s(h) {
      const { expiresIn: _ } = h;
      return typeof _ == "number" ? _ : a[_];
    }
    function l(h) {
      if (!h)
        return {};
      const _ = s(h);
      return _ === void 0 ? {} : {
        [t.OBJECT_LIFECYCYLE_PREFERENCE_HEADER]: JSON.stringify({
          expiration_duration_seconds: _
        })
      };
    }
    function o(h) {
      var _;
      const [, y] = h.split("/");
      return (_ = y.split(/[-;]/)[0]) !== null && _ !== void 0 ? _ : "bin";
    }
    function u(h, _, y, p) {
      return e(this, void 0, void 0, function* () {
        const g = h.name || `${Date.now()}.${o(y)}`, b = {};
        if (p) {
          const E = {
            expiration_duration_seconds: s(p),
            allow_io_storage: p.expiresIn !== "immediate"
          };
          b["X-Fal-Object-Lifecycle"] = JSON.stringify(E);
        }
        return yield (0, r.dispatchRequest)({
          method: "POST",
          // NOTE: We want to test V3 without making it the default at the API level
          targetUrl: `${(0, n.getRestApiUrl)()}/storage/upload/initiate?storage_type=fal-cdn-v3`,
          input: {
            content_type: y,
            file_name: g
          },
          config: _,
          headers: b
        });
      });
    }
    function d(h, _, y, p) {
      return e(this, void 0, void 0, function* () {
        const g = h.name || `${Date.now()}.${o(y)}`, b = {};
        return p && (b["X-Fal-Object-Lifecycle"] = JSON.stringify(p)), yield (0, r.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, n.getRestApiUrl)()}/storage/upload/initiate-multipart?storage_type=fal-cdn-v3`,
          input: {
            content_type: y,
            file_name: g
          },
          config: _,
          headers: b
        });
      });
    }
    function c(h, _, y) {
      return e(this, arguments, void 0, function* (p, g, b, E = 3) {
        if (E === 0)
          throw new Error("Part upload failed, retries exhausted");
        const { fetch: T, responseHandler: S } = b;
        try {
          const x = yield T(p, {
            method: "PUT",
            body: g
          });
          return yield S(x);
        } catch {
          return yield c(p, g, b, E - 1);
        }
      });
    }
    function m(h, _, y) {
      return e(this, void 0, void 0, function* () {
        const { fetch: p, responseHandler: g } = _, b = h.type || "application/octet-stream", { upload_url: E, file_url: T } = yield d(h, _, b, y), S = 10 * 1024 * 1024, x = Math.ceil(h.size / S), v = new URL(E), j = [];
        for (let L = 0; L < x; L++) {
          const M = L * S, B = Math.min(M + S, h.size), H = h.slice(M, B), A = L + 1, R = `${v.origin}${v.pathname}/${A}${v.search}`;
          j.push(yield c(R, H, _));
        }
        const N = `${v.origin}${v.pathname}/complete${v.search}`, O = yield p(N, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parts: j.map((L) => ({
              partNumber: L.partNumber,
              etag: L.etag
            }))
          })
        });
        return yield g(O), T;
      });
    }
    function f({ config: h }) {
      const _ = {
        upload: (y, p) => e(this, void 0, void 0, function* () {
          const g = p == null ? void 0 : p.lifecycle;
          if (y.size > 94371840)
            return yield m(y, h, g);
          const b = y.type || "application/octet-stream", { fetch: E, responseHandler: T } = h, { upload_url: S, file_url: x } = yield u(y, h, b, g), v = yield E(S, {
            method: "PUT",
            body: y,
            headers: {
              "Content-Type": y.type || "application/octet-stream"
            }
          });
          return yield T(v), x;
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformInput: (y) => e(this, void 0, void 0, function* () {
          if (Array.isArray(y))
            return Promise.all(y.map((p) => _.transformInput(p)));
          if (y instanceof Blob)
            return yield _.upload(y);
          if ((0, i.isPlainObject)(y)) {
            const g = Object.entries(y).map((E) => e(this, [E], void 0, function* ([T, S]) {
              return [T, yield _.transformInput(S)];
            })), b = yield Promise.all(g);
            return Object.fromEntries(b);
          }
          return y;
        })
      };
      return _;
    }
  })(pt)), pt;
}
var ce = {}, Dt = {}, kr;
function Es() {
  if (kr) return Dt;
  kr = 1, Object.defineProperty(Dt, "__esModule", {
    value: !0
  });
  function t(r) {
    let i, a, s, l, o, u, d;
    return c(), {
      feed: m,
      reset: c
    };
    function c() {
      i = !0, a = "", s = 0, l = -1, o = void 0, u = void 0, d = "";
    }
    function m(h) {
      a = a ? a + h : h, i && n(a) && (a = a.slice(e.length)), i = !1;
      const _ = a.length;
      let y = 0, p = !1;
      for (; y < _; ) {
        p && (a[y] === `
` && ++y, p = !1);
        let g = -1, b = l, E;
        for (let T = s; g < 0 && T < _; ++T)
          E = a[T], E === ":" && b < 0 ? b = T - y : E === "\r" ? (p = !0, g = T - y) : E === `
` && (g = T - y);
        if (g < 0) {
          s = _ - y, l = b;
          break;
        } else
          s = 0, l = -1;
        f(a, y, b, g), y += g + 1;
      }
      y === _ ? a = "" : y > 0 && (a = a.slice(y));
    }
    function f(h, _, y, p) {
      if (p === 0) {
        d.length > 0 && (r({
          type: "event",
          id: o,
          event: u || void 0,
          data: d.slice(0, -1)
          // remove trailing newline
        }), d = "", o = void 0), u = void 0;
        return;
      }
      const g = y < 0, b = h.slice(_, _ + (g ? p : y));
      let E = 0;
      g ? E = p : h[_ + y + 1] === " " ? E = y + 2 : E = y + 1;
      const T = _ + E, S = p - E, x = h.slice(T, T + S).toString();
      if (b === "data")
        d += x ? "".concat(x, `
`) : `
`;
      else if (b === "event")
        u = x;
      else if (b === "id" && !x.includes("\0"))
        o = x;
      else if (b === "retry") {
        const v = parseInt(x, 10);
        Number.isNaN(v) || r({
          type: "reconnect-interval",
          value: v
        });
      }
    }
  }
  const e = [239, 187, 191];
  function n(r) {
    return e.every((i, a) => r.charCodeAt(a) === i);
  }
  return Dt.createParser = t, Dt;
}
var yt = {}, Rr;
function $i() {
  return Rr || (Rr = 1, (function(t) {
    var e = yt && yt.__awaiter || function(s, l, o, u) {
      function d(c) {
        return c instanceof o ? c : new o(function(m) {
          m(c);
        });
      }
      return new (o || (o = Promise))(function(c, m) {
        function f(y) {
          try {
            _(u.next(y));
          } catch (p) {
            m(p);
          }
        }
        function h(y) {
          try {
            _(u.throw(y));
          } catch (p) {
            m(p);
          }
        }
        function _(y) {
          y.done ? c(y.value) : d(y.value).then(f, h);
        }
        _((u = u.apply(s, l || [])).next());
      });
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.TOKEN_EXPIRATION_SECONDS = void 0, t.getTemporaryAuthToken = a;
    const n = Xn(), r = Pt(), i = Ne();
    t.TOKEN_EXPIRATION_SECONDS = 120;
    function a(s, l) {
      return e(this, void 0, void 0, function* () {
        const o = (0, i.parseEndpointId)(s), u = yield (0, r.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, n.getRestApiUrl)()}/tokens/`,
          config: l,
          input: {
            allowed_apps: [o.alias],
            token_expiration: t.TOKEN_EXPIRATION_SECONDS
          }
        });
        return typeof u != "string" && u.detail ? u.detail : u;
      });
    }
  })(yt)), yt;
}
var Or;
function Bi() {
  if (Or) return ce;
  Or = 1;
  var t = ce && ce.__awaiter || function(m, f, h, _) {
    function y(p) {
      return p instanceof h ? p : new h(function(g) {
        g(p);
      });
    }
    return new (h || (h = Promise))(function(p, g) {
      function b(S) {
        try {
          T(_.next(S));
        } catch (x) {
          g(x);
        }
      }
      function E(S) {
        try {
          T(_.throw(S));
        } catch (x) {
          g(x);
        }
      }
      function T(S) {
        S.done ? p(S.value) : y(S.value).then(b, E);
      }
      T((_ = _.apply(m, f || [])).next());
    });
  }, e = ce && ce.__await || function(m) {
    return this instanceof e ? (this.v = m, this) : new e(m);
  }, n = ce && ce.__asyncGenerator || function(m, f, h) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var _ = h.apply(m, f || []), y, p = [];
    return y = {}, b("next"), b("throw"), b("return", g), y[Symbol.asyncIterator] = function() {
      return this;
    }, y;
    function g(j) {
      return function(N) {
        return Promise.resolve(N).then(j, x);
      };
    }
    function b(j, N) {
      _[j] && (y[j] = function(O) {
        return new Promise(function(L, M) {
          p.push([j, O, L, M]) > 1 || E(j, O);
        });
      }, N && (y[j] = N(y[j])));
    }
    function E(j, N) {
      try {
        T(_[j](N));
      } catch (O) {
        v(p[0][3], O);
      }
    }
    function T(j) {
      j.value instanceof e ? Promise.resolve(j.value.v).then(S, x) : v(p[0][2], j);
    }
    function S(j) {
      E("next", j);
    }
    function x(j) {
      E("throw", j);
    }
    function v(j, N) {
      j(N), p.shift(), p.length && E(p[0][0], p[0][1]);
    }
  };
  Object.defineProperty(ce, "__esModule", { value: !0 }), ce.FalStream = void 0, ce.createStreamingClient = c;
  const r = /* @__PURE__ */ Es(), i = $i(), a = Pt(), s = Be(), l = Ne(), o = "text/event-stream", u = 15 * 1e3;
  class d {
    constructor(f, h, _) {
      var y;
      this.listeners = /* @__PURE__ */ new Map(), this.buffer = [], this.currentData = void 0, this.lastEventTimestamp = 0, this.streamClosed = !1, this._requestId = null, this.abortController = new AbortController(), this.start = () => t(this, void 0, void 0, function* () {
        var p, g, b;
        const { endpointId: E, options: T } = this, { input: S, method: x = "post", connectionMode: v = "server", tokenProvider: j } = T;
        try {
          if (v === "client") {
            const N = (0, l.ensureEndpointIdFormat)(E), O = (p = (0, l.resolveEndpointPath)(E, void 0, "/stream")) !== null && p !== void 0 ? p : "", M = yield (j ? () => j(`${N}${O}`) : () => (console.warn('[fal.stream] Using the default token provider is deprecated. Please provide a `tokenProvider` function when using `connectionMode: "client"`. See https://docs.fal.ai/fal-client/authentication for more information.'), (0, i.getTemporaryAuthToken)(E, this.config)))(), { fetch: B } = this.config, H = new URL(this.url);
            H.searchParams.set("fal_jwt_token", M);
            const A = yield B(H.toString(), {
              method: x.toUpperCase(),
              headers: {
                accept: (g = T.accept) !== null && g !== void 0 ? g : o,
                "content-type": "application/json"
              },
              body: S && x !== "get" ? JSON.stringify(S) : void 0,
              signal: this.abortController.signal
            });
            return this._requestId = A.headers.get("x-fal-request-id"), yield this.handleResponse(A);
          }
          return yield (0, a.dispatchRequest)({
            method: x.toUpperCase(),
            targetUrl: this.url,
            input: S,
            config: this.config,
            options: {
              headers: {
                accept: (b = T.accept) !== null && b !== void 0 ? b : o
              },
              responseHandler: (N) => t(this, void 0, void 0, function* () {
                return this._requestId = N.headers.get("x-fal-request-id"), yield this.handleResponse(N);
              }),
              signal: this.abortController.signal
            }
          });
        } catch (N) {
          this.handleError(N);
        }
      }), this.handleResponse = (p) => t(this, void 0, void 0, function* () {
        var g, b;
        if (!p.ok) {
          try {
            yield (0, s.defaultResponseHandler)(p);
          } catch (O) {
            this.emit("error", O);
          }
          return;
        }
        const E = p.body;
        if (!E) {
          this.emit("error", new s.ApiError({
            message: "Response body is empty.",
            status: 400,
            body: void 0,
            requestId: this._requestId || void 0
          }));
          return;
        }
        if (!((g = p.headers.get("content-type")) !== null && g !== void 0 ? g : "").startsWith(o)) {
          const O = E.getReader(), L = () => {
            O.read().then(({ done: M, value: B }) => {
              if (M) {
                this.emit("done", this.currentData);
                return;
              }
              this.buffer.push(B), this.currentData = B, this.emit("data", B), L();
            });
          };
          L();
          return;
        }
        const S = new TextDecoder("utf-8"), x = p.body.getReader(), v = (0, r.createParser)((O) => {
          if (O.type === "event") {
            const L = O.data;
            try {
              const M = JSON.parse(L);
              this.buffer.push(M), this.currentData = M, this.emit("data", M), this.emit("message", M);
            } catch (M) {
              this.emit("error", M);
            }
          }
        }), j = (b = this.options.timeout) !== null && b !== void 0 ? b : u, N = () => t(this, void 0, void 0, function* () {
          const { value: O, done: L } = yield x.read();
          this.lastEventTimestamp = Date.now(), v.feed(S.decode(O)), Date.now() - this.lastEventTimestamp > j && this.emit("error", new s.ApiError({
            message: `Event stream timed out after ${(j / 1e3).toFixed(0)} seconds with no messages.`,
            status: 408,
            requestId: this._requestId || void 0
          })), L ? this.emit("done", this.currentData) : N().catch(this.handleError);
        });
        N().catch(this.handleError);
      }), this.handleError = (p) => {
        var g;
        if (p.name === "AbortError" || this.signal.aborted)
          return;
        const b = p instanceof s.ApiError ? p : new s.ApiError({
          message: (g = p.message) !== null && g !== void 0 ? g : "An unknown error occurred",
          status: 500,
          requestId: this._requestId || void 0
        });
        this.emit("error", b);
      }, this.on = (p, g) => {
        var b;
        this.listeners.has(p) || this.listeners.set(p, []), (b = this.listeners.get(p)) === null || b === void 0 || b.push(g);
      }, this.emit = (p, g) => {
        const b = this.listeners.get(p) || [];
        for (const E of b)
          E(g);
      }, this.done = () => t(this, void 0, void 0, function* () {
        return this.donePromise;
      }), this.abort = (p) => {
        this.streamClosed || this.abortController.abort(p);
      }, this.endpointId = f, this.config = h, this.url = (y = _.url) !== null && y !== void 0 ? y : (0, a.buildUrl)(f, {
        path: (0, l.resolveEndpointPath)(f, void 0, "/stream"),
        query: _.queryParams
      }), this.options = _, this.donePromise = new Promise((p, g) => {
        this.streamClosed && g(new s.ApiError({
          message: "Streaming connection is already closed.",
          status: 400,
          body: void 0,
          requestId: this._requestId || void 0
        })), this.signal.addEventListener("abort", () => {
          var b;
          p((b = this.currentData) !== null && b !== void 0 ? b : {});
        }), this.on("done", (b) => {
          this.streamClosed = !0, p(b);
        }), this.on("error", (b) => {
          this.streamClosed = !0, g(b);
        });
      }), _.signal && _.signal.addEventListener("abort", () => {
        this.abortController.abort();
      }), this.start().catch(this.handleError);
    }
    [Symbol.asyncIterator]() {
      return n(this, arguments, function* () {
        let h = !0;
        const _ = () => h = !1;
        for (this.on("error", _), this.on("done", _); h || this.buffer.length > 0; ) {
          const y = this.buffer.shift();
          y && (yield yield e(y)), yield e(new Promise((p) => setTimeout(p, 16)));
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
  ce.FalStream = d;
  function c({ config: m, storage: f }) {
    return {
      stream(h, _) {
        return t(this, void 0, void 0, function* () {
          const y = _.input ? yield f.transformInput(_.input) : void 0;
          return new d(h, m, Object.assign(Object.assign({}, _), { input: y }));
        });
      }
    };
  }
  return ce;
}
var Nr;
function vs() {
  if (Nr) return we;
  Nr = 1;
  var t = we && we.__awaiter || function(f, h, _, y) {
    function p(g) {
      return g instanceof _ ? g : new _(function(b) {
        b(g);
      });
    }
    return new (_ || (_ = Promise))(function(g, b) {
      function E(x) {
        try {
          S(y.next(x));
        } catch (v) {
          b(v);
        }
      }
      function T(x) {
        try {
          S(y.throw(x));
        } catch (v) {
          b(v);
        }
      }
      function S(x) {
        x.done ? g(x.value) : p(x.value).then(E, T);
      }
      S((y = y.apply(f, h || [])).next());
    });
  }, e = we && we.__rest || function(f, h) {
    var _ = {};
    for (var y in f) Object.prototype.hasOwnProperty.call(f, y) && h.indexOf(y) < 0 && (_[y] = f[y]);
    if (f != null && typeof Object.getOwnPropertySymbols == "function")
      for (var p = 0, y = Object.getOwnPropertySymbols(f); p < y.length; p++)
        h.indexOf(y[p]) < 0 && Object.prototype.propertyIsEnumerable.call(f, y[p]) && (_[y[p]] = f[y[p]]);
    return _;
  };
  Object.defineProperty(we, "__esModule", { value: !0 }), we.createQueueClient = void 0;
  const n = Jn(), r = Pt(), i = Be(), a = Zt(), s = Fi(), l = Bi(), o = Ne(), u = 500, d = {
    maxRetries: 3,
    baseDelay: 1e3,
    maxDelay: 6e4,
    retryableStatusCodes: a.DEFAULT_RETRYABLE_STATUS_CODES
  }, c = {
    maxRetries: 5,
    baseDelay: 1e3,
    maxDelay: 3e4,
    retryableStatusCodes: [...a.DEFAULT_RETRYABLE_STATUS_CODES, 500]
  }, m = ({ config: f, storage: h }) => {
    const _ = {
      submit(y, p) {
        return t(this, void 0, void 0, function* () {
          const { webhookUrl: g, priority: b, hint: E, startTimeout: T, headers: S, storageSettings: x } = p, v = e(p, ["webhookUrl", "priority", "hint", "startTimeout", "headers", "storageSettings"]), j = p.input ? yield h.transformInput(p.input) : void 0, N = Object.fromEntries(Object.entries(S ?? {}).map(([O, L]) => [
            O.toLowerCase(),
            L
          ]));
          return (0, r.dispatchRequest)({
            method: p.method,
            targetUrl: (0, r.buildUrl)(y, Object.assign(Object.assign({}, v), { subdomain: "queue", query: g ? { fal_webhook: g } : void 0 })),
            headers: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, N), (0, s.buildObjectLifecycleHeaders)(x)), { [n.QUEUE_PRIORITY_HEADER]: b ?? "normal" }), E && { [n.RUNNER_HINT_HEADER]: E }), (0, n.buildTimeoutHeaders)(T)),
            input: j,
            config: f,
            options: {
              signal: p.abortSignal,
              retry: d
            }
          });
        });
      },
      status(y, p) {
        return t(this, arguments, void 0, function* (g, { requestId: b, logs: E = !1, abortSignal: T }) {
          const S = (0, o.parseEndpointId)(g), x = S.namespace ? `${S.namespace}/` : "";
          return (0, r.dispatchRequest)({
            method: "get",
            targetUrl: (0, r.buildUrl)(`${x}${S.owner}/${S.alias}`, {
              subdomain: "queue",
              query: { logs: E ? "1" : "0" },
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
      streamStatus(y, p) {
        return t(this, arguments, void 0, function* (g, { requestId: b, logs: E = !1, connectionMode: T }) {
          const S = (0, o.parseEndpointId)(g), x = S.namespace ? `${S.namespace}/` : "", v = {
            logs: E ? "1" : "0"
          }, j = (0, r.buildUrl)(`${x}${S.owner}/${S.alias}`, {
            subdomain: "queue",
            path: `/requests/${b}/status/stream`,
            query: v
          });
          return new l.FalStream(g, f, {
            url: j,
            method: "get",
            connectionMode: T,
            queryParams: v
          });
        });
      },
      subscribeToStatus(y, p) {
        return t(this, void 0, void 0, function* () {
          const g = p.requestId, b = p.timeout;
          let E;
          const T = () => {
          };
          if (p.mode === "streaming") {
            const S = yield _.streamStatus(y, {
              requestId: g,
              logs: p.logs,
              connectionMode: "connectionMode" in p ? p.connectionMode : void 0
            }), x = [];
            b && (E = setTimeout(() => {
              throw S.abort(), _.cancel(y, { requestId: g }).catch(T), new Error(`Client timed out waiting for the request to complete after ${b}ms`);
            }, b)), S.on("data", (j) => {
              p.onQueueUpdate && ("logs" in j && Array.isArray(j.logs) && j.logs.length > 0 && x.push(...j.logs), p.onQueueUpdate("logs" in j ? Object.assign(Object.assign({}, j), { logs: x }) : j));
            });
            const v = yield S.done();
            return E && clearTimeout(E), v;
          }
          return new Promise((S, x) => {
            var v;
            let j;
            const N = "pollInterval" in p && typeof p.pollInterval == "number" && (v = p.pollInterval) !== null && v !== void 0 ? v : u, O = () => {
              E && clearTimeout(E), j && clearTimeout(j);
            };
            b && (E = setTimeout(() => {
              O(), _.cancel(y, { requestId: g }).catch(T), x(new Error(`Client timed out waiting for the request to complete after ${b}ms`));
            }, b));
            const L = () => t(this, void 0, void 0, function* () {
              var M;
              try {
                const B = yield _.status(y, {
                  requestId: g,
                  logs: (M = p.logs) !== null && M !== void 0 ? M : !1,
                  abortSignal: p.abortSignal
                });
                if (p.onQueueUpdate && p.onQueueUpdate(B), B.status === "COMPLETED") {
                  O(), S(B);
                  return;
                }
                j = setTimeout(L, N);
              } catch (B) {
                O(), x(B);
              }
            });
            L().catch(x);
          });
        });
      },
      result(y, p) {
        return t(this, arguments, void 0, function* (g, { requestId: b, abortSignal: E }) {
          const T = (0, o.parseEndpointId)(g), S = T.namespace ? `${T.namespace}/` : "";
          return (0, r.dispatchRequest)({
            method: "get",
            targetUrl: (0, r.buildUrl)(`${S}${T.owner}/${T.alias}`, {
              subdomain: "queue",
              path: `/requests/${b}`
            }),
            config: Object.assign(Object.assign({}, f), { responseHandler: i.resultResponseHandler }),
            options: {
              signal: E,
              retry: d
            }
          });
        });
      },
      cancel(y, p) {
        return t(this, arguments, void 0, function* (g, { requestId: b, abortSignal: E }) {
          const T = (0, o.parseEndpointId)(g), S = T.namespace ? `${T.namespace}/` : "";
          yield (0, r.dispatchRequest)({
            method: "put",
            targetUrl: (0, r.buildUrl)(`${S}${T.owner}/${T.alias}`, {
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
    return _;
  };
  return we.createQueueClient = m, we;
}
var Ge = {};
function Ts(t) {
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
        const a = t.charCodeAt(r);
        (a & 64512) === 56320 && (++r, i = ((i & 1023) << 10) + (a & 1023) + 65536);
      }
      (i & 4294901760) === 0 ? n += 3 : n += 4;
    }
  }
  return n;
}
function Ss(t, e, n) {
  const r = t.length;
  let i = n, a = 0;
  for (; a < r; ) {
    let s = t.charCodeAt(a++);
    if ((s & 4294967168) === 0) {
      e[i++] = s;
      continue;
    } else if ((s & 4294965248) === 0)
      e[i++] = s >> 6 & 31 | 192;
    else {
      if (s >= 55296 && s <= 56319 && a < r) {
        const l = t.charCodeAt(a);
        (l & 64512) === 56320 && (++a, s = ((s & 1023) << 10) + (l & 1023) + 65536);
      }
      (s & 4294901760) === 0 ? (e[i++] = s >> 12 & 15 | 224, e[i++] = s >> 6 & 63 | 128) : (e[i++] = s >> 18 & 7 | 240, e[i++] = s >> 12 & 63 | 128, e[i++] = s >> 6 & 63 | 128);
    }
    e[i++] = s & 63 | 128;
  }
}
const xs = new TextEncoder(), js = 50;
function qs(t, e, n) {
  xs.encodeInto(t, e.subarray(n));
}
function Is(t, e, n) {
  t.length > js ? qs(t, e, n) : Ss(t, e, n);
}
const As = 4096;
function Hi(t, e, n) {
  let r = e;
  const i = r + n, a = [];
  let s = "";
  for (; r < i; ) {
    const l = t[r++];
    if ((l & 128) === 0)
      a.push(l);
    else if ((l & 224) === 192) {
      const o = t[r++] & 63;
      a.push((l & 31) << 6 | o);
    } else if ((l & 240) === 224) {
      const o = t[r++] & 63, u = t[r++] & 63;
      a.push((l & 31) << 12 | o << 6 | u);
    } else if ((l & 248) === 240) {
      const o = t[r++] & 63, u = t[r++] & 63, d = t[r++] & 63;
      let c = (l & 7) << 18 | o << 12 | u << 6 | d;
      c > 65535 && (c -= 65536, a.push(c >>> 10 & 1023 | 55296), c = 56320 | c & 1023), a.push(c);
    } else
      a.push(l);
    a.length >= As && (s += String.fromCharCode(...a), a.length = 0);
  }
  return a.length > 0 && (s += String.fromCharCode(...a)), s;
}
const ks = new TextDecoder(), Rs = 200;
function Os(t, e, n) {
  const r = t.subarray(e, e + n);
  return ks.decode(r);
}
function Ns(t, e, n) {
  return n > Rs ? Os(t, e, n) : Hi(t, e, n);
}
class Et {
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
const ht = 4294967295;
function Ps(t, e, n) {
  const r = n / 4294967296, i = n;
  t.setUint32(e, r), t.setUint32(e + 4, i);
}
function Wi(t, e, n) {
  const r = Math.floor(n / 4294967296), i = n;
  t.setUint32(e, r), t.setUint32(e + 4, i);
}
function zi(t, e) {
  const n = t.getInt32(e), r = t.getUint32(e + 4);
  return n * 4294967296 + r;
}
function Cs(t, e) {
  const n = t.getUint32(e), r = t.getUint32(e + 4);
  return n * 4294967296 + r;
}
const Gi = -1, Us = 4294967296 - 1, Ls = 17179869184 - 1;
function Ji({ sec: t, nsec: e }) {
  if (t >= 0 && e >= 0 && t <= Ls)
    if (e === 0 && t <= Us) {
      const n = new Uint8Array(4);
      return new DataView(n.buffer).setUint32(0, t), n;
    } else {
      const n = t / 4294967296, r = t & 4294967295, i = new Uint8Array(8), a = new DataView(i.buffer);
      return a.setUint32(0, e << 2 | n & 3), a.setUint32(4, r), i;
    }
  else {
    const n = new Uint8Array(12), r = new DataView(n.buffer);
    return r.setUint32(0, e), Wi(r, 4, t), n;
  }
}
function Ki(t) {
  const e = t.getTime(), n = Math.floor(e / 1e3), r = (e - n * 1e3) * 1e6, i = Math.floor(r / 1e9);
  return {
    sec: n + i,
    nsec: r - i * 1e9
  };
}
function Xi(t) {
  if (t instanceof Date) {
    const e = Ki(t);
    return Ji(e);
  } else
    return null;
}
function Vi(t) {
  const e = new DataView(t.buffer, t.byteOffset, t.byteLength);
  switch (t.byteLength) {
    case 4:
      return { sec: e.getUint32(0), nsec: 0 };
    case 8: {
      const n = e.getUint32(0), r = e.getUint32(4), i = (n & 3) * 4294967296 + r, a = n >>> 2;
      return { sec: i, nsec: a };
    }
    case 12: {
      const n = zi(e, 4), r = e.getUint32(0);
      return { sec: n, nsec: r };
    }
    default:
      throw new ie(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${t.length}`);
  }
}
function Yi(t) {
  const e = Vi(t);
  return new Date(e.sec * 1e3 + e.nsec / 1e6);
}
const Ds = {
  type: Gi,
  encode: Xi,
  decode: Yi
}, Yt = class Yt {
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
    this.register(Ds);
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
        const a = i(e, n);
        if (a != null) {
          const s = -1 - r;
          return new Et(s, a);
        }
      }
    }
    for (let r = 0; r < this.encoders.length; r++) {
      const i = this.encoders[r];
      if (i != null) {
        const a = i(e, n);
        if (a != null) {
          const s = r;
          return new Et(s, a);
        }
      }
    }
    return e instanceof Et ? e : null;
  }
  decode(e, n, r) {
    const i = n < 0 ? this.builtInDecoders[-1 - n] : this.decoders[n];
    return i ? i(e, n, r) : new Et(n, e);
  }
};
D(Yt, "defaultCodec", new Yt());
let Nt = Yt;
function Ms(t) {
  return t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer;
}
function kn(t) {
  return t instanceof Uint8Array ? t : ArrayBuffer.isView(t) ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : Ms(t) ? new Uint8Array(t) : Uint8Array.from(t);
}
const Fs = 100, $s = 2048;
class en {
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
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? Nt.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.maxDepth = (e == null ? void 0 : e.maxDepth) ?? Fs, this.initialBufferSize = (e == null ? void 0 : e.initialBufferSize) ?? $s, this.sortKeys = (e == null ? void 0 : e.sortKeys) ?? !1, this.forceFloat32 = (e == null ? void 0 : e.forceFloat32) ?? !1, this.ignoreUndefined = (e == null ? void 0 : e.ignoreUndefined) ?? !1, this.forceIntegerToFloat = (e == null ? void 0 : e.forceIntegerToFloat) ?? !1, this.pos = 0, this.view = new DataView(new ArrayBuffer(this.initialBufferSize)), this.bytes = new Uint8Array(this.view.buffer);
  }
  clone() {
    return new en({
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
    const r = Ts(e);
    this.ensureBufferSizeToWrite(5 + r), this.writeStringHeader(r), Is(e, this.bytes, this.pos), this.pos += r;
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
    const r = kn(e);
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
    for (const a of r) {
      const s = e[a];
      this.ignoreUndefined && s === void 0 || (this.encodeString(a), this.doEncode(s, n + 1));
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
    this.ensureBufferSizeToWrite(8), Ps(this.view, this.pos, e), this.pos += 8;
  }
  writeI64(e) {
    this.ensureBufferSizeToWrite(8), Wi(this.view, this.pos, e), this.pos += 8;
  }
  writeBigUint64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigUint64(this.pos, e), this.pos += 8;
  }
  writeBigInt64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigInt64(this.pos, e), this.pos += 8;
  }
}
function Bs(t, e) {
  return new en(e).encodeSharedRef(t);
}
function wn(t) {
  return `${t < 0 ? "-" : ""}0x${Math.abs(t).toString(16).padStart(2, "0")}`;
}
const Hs = 16, Ws = 16;
class zs {
  constructor(e = Hs, n = Ws) {
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
    e: for (const a of i) {
      const s = a.bytes;
      for (let l = 0; l < r; l++)
        if (s[l] !== e[n + l])
          continue e;
      return a.str;
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
    const a = Hi(e, n, r), s = Uint8Array.prototype.slice.call(e, n, n + r);
    return this.store(s, a), a;
  }
}
const Rn = "array", xt = "map_key", Qi = "map_value", Gs = (t) => {
  if (typeof t == "string" || typeof t == "number")
    return t;
  throw new ie("The type of key must be string or number but " + typeof t);
};
class Js {
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
    n.type = Rn, n.position = 0, n.size = e, n.array = new Array(e);
  }
  pushMapState(e) {
    const n = this.getUninitializedStateFromPool();
    n.type = xt, n.readCount = 0, n.size = e, n.map = {};
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
    if (e.type === Rn) {
      const r = e;
      r.size = 0, r.array = void 0, r.position = 0, r.type = void 0;
    }
    if (e.type === xt || e.type === Qi) {
      const r = e;
      r.size = 0, r.map = void 0, r.readCount = 0, r.type = void 0;
    }
    this.stackHeadPosition--;
  }
  reset() {
    this.stack.length = 0, this.stackHeadPosition = -1;
  }
}
const gt = -1, Vn = new DataView(new ArrayBuffer(0)), Ks = new Uint8Array(Vn.buffer);
try {
  Vn.getInt8(0);
} catch (t) {
  if (!(t instanceof RangeError))
    throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
}
const Pr = new RangeError("Insufficient data"), Xs = new zs();
class Pe {
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
    D(this, "view", Vn);
    D(this, "bytes", Ks);
    D(this, "headByte", gt);
    D(this, "stack", new Js());
    D(this, "entered", !1);
    this.extensionCodec = (e == null ? void 0 : e.extensionCodec) ?? Nt.defaultCodec, this.context = e == null ? void 0 : e.context, this.useBigInt64 = (e == null ? void 0 : e.useBigInt64) ?? !1, this.rawStrings = (e == null ? void 0 : e.rawStrings) ?? !1, this.maxStrLength = (e == null ? void 0 : e.maxStrLength) ?? ht, this.maxBinLength = (e == null ? void 0 : e.maxBinLength) ?? ht, this.maxArrayLength = (e == null ? void 0 : e.maxArrayLength) ?? ht, this.maxMapLength = (e == null ? void 0 : e.maxMapLength) ?? ht, this.maxExtLength = (e == null ? void 0 : e.maxExtLength) ?? ht, this.keyDecoder = (e == null ? void 0 : e.keyDecoder) !== void 0 ? e.keyDecoder : Xs, this.mapKeyConverter = (e == null ? void 0 : e.mapKeyConverter) ?? Gs;
  }
  clone() {
    return new Pe({
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
    this.totalPos = 0, this.headByte = gt, this.stack.reset();
  }
  setBuffer(e) {
    const n = kn(e);
    this.bytes = n, this.view = new DataView(n.buffer, n.byteOffset, n.byteLength), this.pos = 0;
  }
  appendBuffer(e) {
    if (this.headByte === gt && !this.hasRemaining(1))
      this.setBuffer(e);
    else {
      const n = this.bytes.subarray(this.pos), r = kn(e), i = new Uint8Array(n.length + r.length);
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
      for await (const l of e) {
        if (n)
          throw this.entered = !1, this.createExtraByteError(this.totalPos);
        this.appendBuffer(l);
        try {
          r = this.doDecodeSync(), n = !0;
        } catch (o) {
          if (!(o instanceof RangeError))
            throw o;
        }
        this.totalPos += this.pos;
      }
      if (n) {
        if (this.hasRemaining(1))
          throw this.createExtraByteError(this.totalPos);
        return r;
      }
      const { headByte: i, pos: a, totalPos: s } = this;
      throw new RangeError(`Insufficient data in parsing ${wn(i)} at ${s} (${a} in the current buffer)`);
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
      for await (const a of e) {
        if (n && i === 0)
          throw this.createExtraByteError(this.totalPos);
        this.appendBuffer(a), r && (i = this.readArraySize(), r = !1, this.complete());
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
        throw new ie(`Unrecognized type byte: ${wn(e)}`);
      this.complete();
      const r = this.stack;
      for (; r.length > 0; ) {
        const i = r.top();
        if (i.type === Rn)
          if (i.array[i.position] = n, i.position++, i.position === i.size)
            n = i.array, r.release(i);
          else
            continue e;
        else if (i.type === xt) {
          if (n === "__proto__")
            throw new ie("The key __proto__ is not allowed");
          i.key = this.mapKeyConverter(n), i.type = Qi;
          continue e;
        } else if (i.map[i.key] = n, i.readCount++, i.readCount === i.size)
          n = i.map, r.release(i);
        else {
          i.key = null, i.type = xt;
          continue e;
        }
      }
      return n;
    }
  }
  readHeadByte() {
    return this.headByte === gt && (this.headByte = this.readU8()), this.headByte;
  }
  complete() {
    this.headByte = gt;
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
        throw new ie(`Unrecognized array type byte: ${wn(e)}`);
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
    var a;
    if (e > this.maxStrLength)
      throw new ie(`Max length exceeded: UTF-8 byte length (${e}) > maxStrLength (${this.maxStrLength})`);
    if (this.bytes.byteLength < this.pos + n + e)
      throw Pr;
    const r = this.pos + n;
    let i;
    return this.stateIsMapKey() && ((a = this.keyDecoder) != null && a.canBeCached(e)) ? i = this.keyDecoder.decode(this.bytes, r, e) : i = Ns(this.bytes, r, e), this.pos += n + e, i;
  }
  stateIsMapKey() {
    return this.stack.length > 0 ? this.stack.top().type === xt : !1;
  }
  /**
   * @throws {@link RangeError}
   */
  decodeBinary(e, n) {
    if (e > this.maxBinLength)
      throw new ie(`Max length exceeded: bin length (${e}) > maxBinLength (${this.maxBinLength})`);
    if (!this.hasRemaining(e + n))
      throw Pr;
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
    const e = Cs(this.view, this.pos);
    return this.pos += 8, e;
  }
  readI64() {
    const e = zi(this.view, this.pos);
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
function Vs(t, e) {
  return new Pe(e).decode(t);
}
function Ys(t, e) {
  return new Pe(e).decodeMulti(t);
}
function Qs(t) {
  return t[Symbol.asyncIterator] != null;
}
async function* Zs(t) {
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
function Yn(t) {
  return Qs(t) ? t : Zs(t);
}
async function eo(t, e) {
  const n = Yn(t);
  return new Pe(e).decodeAsync(n);
}
function to(t, e) {
  const n = Yn(t);
  return new Pe(e).decodeArrayStream(n);
}
function no(t, e) {
  const n = Yn(t);
  return new Pe(e).decodeStream(n);
}
const ro = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecodeError: ie,
  Decoder: Pe,
  EXT_TIMESTAMP: Gi,
  Encoder: en,
  ExtData: Et,
  ExtensionCodec: Nt,
  decode: Vs,
  decodeArrayStream: to,
  decodeAsync: eo,
  decodeMulti: Ys,
  decodeMultiStream: no,
  decodeTimestampExtension: Yi,
  decodeTimestampToTimeSpec: Vi,
  encode: Bs,
  encodeDateToTimeSpec: Ki,
  encodeTimeSpecToTimestamp: Ji,
  encodeTimestampExtension: Xi
}, Symbol.toStringTag, { value: "Module" })), io = /* @__PURE__ */ gs(ro);
var le = {}, Cr;
function ao() {
  if (Cr) return le;
  Cr = 1, Object.defineProperty(le, "__esModule", { value: !0 });
  function t(q) {
    return { enumerable: !0, value: q };
  }
  function e(q) {
    return { enumerable: !0, writable: !0, value: q };
  }
  let n = {}, r = () => !0, i = () => ({}), a = (q) => q, s = (q, k, P, U) => q.apply(P, U) && k.apply(P, U), l = (q, k, P, [U, W]) => k.call(P, q.call(P, U, W), W), o = (q, k) => Object.freeze(Object.create(q, k));
  function u(q, k, P) {
    return q.reduce((U, W) => function(...ee) {
      return P(U, W, this, ee);
    }, k);
  }
  function d(q) {
    return o(this, { fn: t(q) });
  }
  let c = {}, m = d.bind(c), f = (q) => m((k, P) => !!~q(k, P) && k), h = {}, _ = d.bind(h);
  function y(q, k) {
    return k.filter((P) => q.isPrototypeOf(P));
  }
  function p(q, k, ...P) {
    let U = u(y(h, P).map((ee) => ee.fn), r, s), W = u(y(c, P).map((ee) => ee.fn), a, l);
    return o(this, {
      from: t(q),
      to: t(k),
      guards: t(U),
      reducers: t(W)
    });
  }
  let g = {}, b = {}, E = p.bind(g), T = p.bind(b, null);
  function S(q, k, P) {
    return H(k, q, P, this.immediates) || q;
  }
  function x(q) {
    let k = /* @__PURE__ */ new Map();
    for (let P of q)
      k.has(P.from) || k.set(P.from, []), k.get(P.from).push(P);
    return k;
  }
  let v = { enter: a };
  function j(...q) {
    let k = y(g, q), P = y(b, q), U = {
      final: t(q.length === 0),
      transitions: t(x(k))
    };
    return P.length && (U.immediates = t(P), U.enter = t(S)), o(v, U);
  }
  let N = {
    enter(q, k, P) {
      let U = this.fn.call(k, k.context, P);
      return M.isPrototypeOf(U) ? o(O, {
        machine: t(U),
        transitions: t(this.transitions)
      }).enter(q, k, P) : (U.then((W) => k.send({ type: "done", data: W })).catch((W) => k.send({ type: "error", error: W })), q);
    }
  }, O = {
    enter(q, k, P) {
      if (k.child = $(this.machine, (U) => {
        k.onChange(U), k.child == U && U.machine.state.value.final && (delete k.child, k.send({ type: "done", data: U.context }));
      }, k.context, P), k.child.machine.state.value.final) {
        let U = k.child.context;
        return delete k.child, H(k, q, { type: "done", data: U }, this.transitions.get("done"));
      }
      return q;
    }
  };
  function L(q, ...k) {
    let P = t(x(k));
    return M.isPrototypeOf(q) ? o(O, {
      machine: t(q),
      transitions: P
    }) : o(N, {
      fn: t(q),
      transitions: P
    });
  }
  let M = {
    get state() {
      return {
        name: this.current,
        value: this.states[this.current]
      };
    }
  };
  function B(q, k, P = i) {
    return typeof q != "string" && (P = k || i, k = q, q = Object.keys(k)[0]), n._create && n._create(q, k), o(M, {
      context: t(P),
      current: t(q),
      states: t(k)
    });
  }
  function H(q, k, P, U) {
    let { context: W } = q;
    for (let { to: ee, guards: _e, reducers: ae } of U)
      if (_e(W, P)) {
        q.context = ae.call(q, W, P);
        let ve = k.original || k, at = o(ve, {
          current: t(ee),
          original: { value: ve }
        });
        return n._onEnter && n._onEnter(k, ee, q.context, W, P), at.state.value.enter(at, q, P);
      }
  }
  function A(q, k) {
    let P = k.type || k, { machine: U } = q, { value: W, name: ee } = U.state;
    return W.transitions.has(P) ? H(q, U, k, W.transitions.get(P)) || U : (n._send && n._send(P, ee), U);
  }
  let R = {
    send(q) {
      this.machine = A(this, q), this.onChange(this);
    }
  };
  function $(q, k, P, U) {
    let W = Object.create(R, {
      machine: e(q),
      context: e(q.context(P, U)),
      onChange: t(k)
    });
    return W.send = W.send.bind(W), W.machine = W.machine.state.value.enter(W.machine, W, U), W;
  }
  return le.action = f, le.createMachine = B, le.d = n, le.guard = _, le.immediate = T, le.interpret = $, le.invoke = L, le.reduce = m, le.state = j, le.transition = E, le;
}
var Ur;
function so() {
  if (Ur) return Ge;
  Ur = 1;
  var t = Ge && Ge.__awaiter || function(A, R, $, q) {
    function k(P) {
      return P instanceof $ ? P : new $(function(U) {
        U(P);
      });
    }
    return new ($ || ($ = Promise))(function(P, U) {
      function W(ae) {
        try {
          _e(q.next(ae));
        } catch (ve) {
          U(ve);
        }
      }
      function ee(ae) {
        try {
          _e(q.throw(ae));
        } catch (ve) {
          U(ve);
        }
      }
      function _e(ae) {
        ae.done ? P(ae.value) : k(ae.value).then(W, ee);
      }
      _e((q = q.apply(A, R || [])).next());
    });
  };
  Object.defineProperty(Ge, "__esModule", { value: !0 }), Ge.createRealtimeClient = H;
  const e = io, n = ao(), r = $i(), i = Be(), a = Kn(), s = Ne(), l = () => ({
    enqueuedMessage: void 0
  });
  function o(A) {
    return A.token !== void 0;
  }
  function u(A) {
    return !o(A);
  }
  function d(A, R) {
    return Object.assign(Object.assign({}, A), { enqueuedMessage: R.message });
  }
  function c(A) {
    return A.websocket && A.websocket.readyState === WebSocket.OPEN && A.websocket.close(), Object.assign(Object.assign({}, A), { websocket: void 0 });
  }
  function m(A, R) {
    return A.websocket && A.websocket.readyState === WebSocket.OPEN ? (R.message instanceof Uint8Array || typeof R.message == "string" ? A.websocket.send(R.message) : A.websocket.send((0, e.encode)(R.message)), Object.assign(Object.assign({}, A), { enqueuedMessage: void 0 })) : Object.assign(Object.assign({}, A), { enqueuedMessage: R.message });
  }
  function f(A) {
    return Object.assign(Object.assign({}, A), { token: void 0 });
  }
  function h(A, R) {
    return Object.assign(Object.assign({}, A), { token: R.token });
  }
  function _(A, R) {
    return Object.assign(Object.assign({}, A), { websocket: R.websocket });
  }
  const y = (0, n.createMachine)("idle", {
    idle: (0, n.state)((0, n.transition)("send", "connecting", (0, n.reduce)(d)), (0, n.transition)("expireToken", "idle", (0, n.reduce)(f)), (0, n.transition)("close", "idle", (0, n.reduce)(c))),
    connecting: (0, n.state)((0, n.transition)("connecting", "connecting"), (0, n.transition)("connected", "active", (0, n.reduce)(_)), (0, n.transition)("connectionClosed", "idle", (0, n.reduce)(c)), (0, n.transition)("send", "connecting", (0, n.reduce)(d)), (0, n.transition)("close", "idle", (0, n.reduce)(c)), (0, n.immediate)("authRequired", (0, n.guard)(u))),
    authRequired: (0, n.state)((0, n.transition)("initiateAuth", "authInProgress"), (0, n.transition)("send", "authRequired", (0, n.reduce)(d)), (0, n.transition)("close", "idle", (0, n.reduce)(c))),
    authInProgress: (0, n.state)((0, n.transition)("authenticated", "connecting", (0, n.reduce)(h)), (0, n.transition)("unauthorized", "idle", (0, n.reduce)(f), (0, n.reduce)(c)), (0, n.transition)("send", "authInProgress", (0, n.reduce)(d)), (0, n.transition)("close", "idle", (0, n.reduce)(c))),
    active: (0, n.state)((0, n.transition)("send", "active", (0, n.reduce)(m)), (0, n.transition)("authenticated", "active", (0, n.reduce)(h)), (0, n.transition)("unauthorized", "idle", (0, n.reduce)(f)), (0, n.transition)("connectionClosed", "idle", (0, n.reduce)(c)), (0, n.transition)("close", "idle", (0, n.reduce)(c))),
    failed: (0, n.state)((0, n.transition)("send", "failed"), (0, n.transition)("close", "idle", (0, n.reduce)(c)))
  }, l);
  function p(A, { token: R, maxBuffering: $, path: q }) {
    var k;
    if ($ !== void 0 && ($ < 1 || $ > 60))
      throw new Error("The `maxBuffering` must be between 1 and 60 (inclusive)");
    const P = new URLSearchParams({
      fal_jwt_token: R
    });
    $ !== void 0 && P.set("max_buffering", $.toFixed(0));
    const U = (0, s.ensureEndpointIdFormat)(A), W = (k = (0, s.resolveEndpointPath)(A, q, "/realtime")) !== null && k !== void 0 ? k : "";
    return `wss://fal.run/${U}${W}?${P.toString()}`;
  }
  const g = 128;
  function b(A) {
    return A.status === "error" && A.error === "Unauthorized";
  }
  const E = {
    NORMAL_CLOSURE: 1e3
  }, T = /* @__PURE__ */ new Map(), S = /* @__PURE__ */ new Map();
  function x(A, R, $) {
    if (!T.has(A)) {
      const q = (0, n.interpret)(y, $);
      T.set(A, Object.assign(Object.assign({}, q), { throttledSend: R > 0 ? (0, s.throttle)(q.send, R, !0) : q.send }));
    }
    return T.get(A);
  }
  const v = () => {
  }, j = {
    send: v,
    close: v
  };
  function N(A) {
    return A.status !== "error" && A.type !== "x-fal-message" && !O(A);
  }
  function O(A) {
    return A.type === "x-fal-error";
  }
  function L(A) {
    return t(this, void 0, void 0, function* () {
      if (typeof A == "string")
        return JSON.parse(A);
      const R = ($) => t(this, void 0, void 0, function* () {
        return $ instanceof Uint8Array ? $ : $ instanceof Blob ? new Uint8Array(yield $.arrayBuffer()) : new Uint8Array($);
      });
      return A instanceof ArrayBuffer || A instanceof Uint8Array ? (0, e.decode)(yield R(A)) : A instanceof Blob ? (0, e.decode)(yield R(A)) : A;
    });
  }
  function M(A) {
    return A instanceof Uint8Array ? A : (0, e.encode)(A);
  }
  function B({ data: A, decodeMessage: R, onResult: $, onError: q, send: k }) {
    const P = (U) => {
      if (b(U)) {
        k({
          type: "unauthorized",
          error: new Error("Unauthorized")
        });
        return;
      }
      if (N(U)) {
        $(U);
        return;
      }
      if (O(U)) {
        if (U.error === "TIMEOUT")
          return;
        q(new i.ApiError({
          message: `${U.error}: ${U.reason}`,
          // TODO better error status code
          status: 400,
          body: U
        }));
        return;
      }
    };
    Promise.resolve(R ? R(A) : A).then(P).catch((U) => {
      var W;
      q(new i.ApiError({
        message: (W = U == null ? void 0 : U.message) !== null && W !== void 0 ? W : "Failed to decode realtime message",
        status: 400
      }));
    });
  }
  function H({ config: A }) {
    return {
      connect(R, $) {
        const {
          // if running on React in the server, set clientOnly to true by default
          clientOnly: q = (0, s.isReact)() && !(0, a.isBrowser)(),
          connectionKey: k = crypto.randomUUID(),
          maxBuffering: P,
          path: U,
          throttleInterval: W = g,
          encodeMessage: ee,
          decodeMessage: _e,
          tokenProvider: ae,
          tokenExpirationSeconds: ve
        } = $;
        if (q && !(0, a.isBrowser)())
          return j;
        const at = ee ?? ((Ce) => M(Ce)), an = _e ?? ((Ce) => L(Ce));
        let Ct, mr, st, ot = 0;
        S.set(k, {
          decodeMessage: an,
          onError: $.onError,
          onResult: $.onResult
        });
        const sn = () => S.get(k), lt = x(k, W, ({ context: Ce, machine: Ue, send: Te }) => {
          var on;
          const { enqueuedMessage: ln, token: un, websocket: dn } = Ce;
          if (mr = ln, Ue.current === "active" && ln && (dn == null ? void 0 : dn.readyState) === WebSocket.OPEN && Te({ type: "send", message: ln }), Ue.current === "authRequired" && un === void 0 && Ct !== Ue.current) {
            Te({ type: "initiateAuth" }), ot++;
            const he = ot, se = (0, s.ensureEndpointIdFormat)(R), me = (on = (0, s.resolveEndpointPath)(R, U, "/realtime")) !== null && on !== void 0 ? on : "", Le = ae ? () => ae(`${se}${me}`) : () => (console.warn("[fal.realtime] Using the default token provider is deprecated. Please provide a `tokenProvider` function to `fal.realtime.connect()`. See https://docs.fal.ai/model-apis/client#client-side-usage-with-token-provider for more information."), (0, r.getTemporaryAuthToken)(R, A)), ut = ae ? ve : r.TOKEN_EXPIRATION_SECONDS, cn = ut !== void 0 ? () => {
              clearTimeout(st);
              const dt = Math.round(ut * 0.9 * 1e3);
              st = setTimeout(() => {
                he === ot && Le().then((fn) => {
                  he === ot && (queueMicrotask(() => {
                    Te({ type: "authenticated", token: fn });
                  }), cn());
                }).catch(() => {
                  if (he !== ot)
                    return;
                  const fn = Math.round(ut * 0.05 * 1e3);
                  st = setTimeout(() => {
                    cn();
                  }, fn);
                });
              }, dt);
            } : v;
            Le().then((dt) => {
              queueMicrotask(() => {
                Te({ type: "authenticated", token: dt });
              }), cn();
            }).catch((dt) => {
              queueMicrotask(() => {
                Te({ type: "unauthorized", error: dt });
              });
            });
          }
          if (Ue.current === "connecting" && Ct !== Ue.current && un !== void 0) {
            const he = new WebSocket(p(R, { token: un, maxBuffering: P, path: U }));
            he.onopen = () => {
              var se, me;
              Te({ type: "connected", websocket: he });
              const Le = (me = (se = lt.context) === null || se === void 0 ? void 0 : se.enqueuedMessage) !== null && me !== void 0 ? me : mr;
              Le && (he.send(at(Le)), lt.context = Object.assign(Object.assign({}, lt.context), { enqueuedMessage: void 0 }));
            }, he.onclose = (se) => {
              if (se.code !== E.NORMAL_CLOSURE) {
                const { onError: me = v } = sn();
                me(new i.ApiError({
                  message: `Error closing the connection: ${se.reason}`,
                  status: se.code
                }));
              }
              Te({ type: "connectionClosed", code: se.code });
            }, he.onerror = (se) => {
              const { onError: me = v } = sn();
              me(new i.ApiError({ message: "Unknown error", status: 500 }));
            }, he.onmessage = (se) => {
              const { decodeMessage: me = an, onResult: Le, onError: ut = v } = sn();
              B({
                data: se.data,
                decodeMessage: me,
                onResult: Le,
                onError: ut,
                send: Te
              });
            };
          }
          Ct === "active" && Ue.current !== "active" && (clearTimeout(st), st = void 0), Ct = Ue.current;
        });
        return {
          send: (Ce) => {
            lt.throttledSend({
              type: "send",
              message: at(Ce)
            });
          },
          close: () => {
            lt.send({ type: "close" });
          }
        };
      }
    };
  }
  return Ge;
}
var Lr;
function Dr() {
  if (Lr) return ze;
  Lr = 1;
  var t = ze && ze.__awaiter || function(d, c, m, f) {
    function h(_) {
      return _ instanceof m ? _ : new m(function(y) {
        y(_);
      });
    }
    return new (m || (m = Promise))(function(_, y) {
      function p(E) {
        try {
          b(f.next(E));
        } catch (T) {
          y(T);
        }
      }
      function g(E) {
        try {
          b(f.throw(E));
        } catch (T) {
          y(T);
        }
      }
      function b(E) {
        E.done ? _(E.value) : h(E.value).then(p, g);
      }
      b((f = f.apply(d, c || [])).next());
    });
  };
  Object.defineProperty(ze, "__esModule", { value: !0 }), ze.createFalClient = u;
  const e = Xn(), n = Jn(), r = vs(), i = so(), a = Pt(), s = Be(), l = Fi(), o = Bi();
  function u(d = {}) {
    const c = (0, e.createConfig)(d), m = (0, l.createStorageClient)({ config: c }), f = (0, r.createQueueClient)({ config: c, storage: m }), h = (0, o.createStreamingClient)({ config: c, storage: m }), _ = (0, i.createRealtimeClient)({ config: c });
    return {
      queue: f,
      realtime: _,
      storage: m,
      streaming: h,
      stream: h.stream,
      run(y) {
        return t(this, arguments, void 0, function* (p, g = {}) {
          const b = g.input ? yield m.transformInput(g.input) : void 0;
          return (0, a.dispatchRequest)({
            method: g.method,
            targetUrl: (0, a.buildUrl)(p, g),
            input: b,
            // TODO: consider supporting custom headers in fal.run() as well
            headers: Object.assign(Object.assign({}, (0, l.buildObjectLifecycleHeaders)(g.storageSettings)), (0, n.buildTimeoutHeaders)(g.startTimeout)),
            config: Object.assign(Object.assign({}, c), { responseHandler: s.resultResponseHandler }),
            options: {
              signal: g.abortSignal,
              retry: {
                maxRetries: 3,
                baseDelay: 500,
                maxDelay: 15e3
              }
            }
          });
        });
      },
      subscribe: (y, p) => t(this, void 0, void 0, function* () {
        const { request_id: g } = yield f.submit(y, p);
        return p.onEnqueue && p.onEnqueue(g), yield f.subscribeToStatus(y, Object.assign({ requestId: g }, p)), f.result(y, { requestId: g });
      })
    };
  }
  return ze;
}
var _t = {}, Mr;
function oo() {
  if (Mr) return _t;
  Mr = 1, Object.defineProperty(_t, "__esModule", { value: !0 }), _t.isQueueStatus = t, _t.isCompletedQueueStatus = e;
  function t(n) {
    return n && n.status && n.response_url;
  }
  function e(n) {
    return t(n) && n.status === "COMPLETED";
  }
  return _t;
}
var Fr;
function lo() {
  return Fr || (Fr = 1, (function(t) {
    var e = De && De.__createBinding || (Object.create ? (function(u, d, c, m) {
      m === void 0 && (m = c);
      var f = Object.getOwnPropertyDescriptor(d, c);
      (!f || ("get" in f ? !d.__esModule : f.writable || f.configurable)) && (f = { enumerable: !0, get: function() {
        return d[c];
      } }), Object.defineProperty(u, m, f);
    }) : (function(u, d, c, m) {
      m === void 0 && (m = c), u[m] = d[c];
    })), n = De && De.__exportStar || function(u, d) {
      for (var c in u) c !== "default" && !Object.prototype.hasOwnProperty.call(d, c) && e(d, u, c);
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), t.fal = t.parseEndpointId = t.isRetryableError = t.ValidationError = t.ApiError = t.withProxy = t.withMiddleware = t.createFalClient = void 0;
    const r = Dr();
    var i = Dr();
    Object.defineProperty(t, "createFalClient", { enumerable: !0, get: function() {
      return i.createFalClient;
    } });
    var a = Mi();
    Object.defineProperty(t, "withMiddleware", { enumerable: !0, get: function() {
      return a.withMiddleware;
    } }), Object.defineProperty(t, "withProxy", { enumerable: !0, get: function() {
      return a.withProxy;
    } });
    var s = Be();
    Object.defineProperty(t, "ApiError", { enumerable: !0, get: function() {
      return s.ApiError;
    } }), Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
      return s.ValidationError;
    } });
    var l = Zt();
    Object.defineProperty(t, "isRetryableError", { enumerable: !0, get: function() {
      return l.isRetryableError;
    } }), n(oo(), t);
    var o = Ne();
    Object.defineProperty(t, "parseEndpointId", { enumerable: !0, get: function() {
      return o.parseEndpointId;
    } }), t.fal = (function() {
      let d = (0, r.createFalClient)();
      return {
        config(c) {
          d = (0, r.createFalClient)(c);
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
        run(c, m) {
          return d.run(c, m);
        },
        subscribe(c, m) {
          return d.subscribe(c, m);
        },
        stream(c, m) {
          return d.stream(c, m);
        }
      };
    })();
  })(De)), De;
}
var G = lo();
const uo = /* @__PURE__ */ JSON.parse('[{"display_name":"3D Rigging","job_set_type":"3d_rigging","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height_meters","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true}]},{"display_name":"Brain Activity","job_set_type":"brain_activity","type":"text","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Bytedance Image Upscale","job_set_type":"bytedance_image_upscale","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"4k","required":false,"enum":["2k","4k"]}]},{"display_name":"Bytedance Video Upscale","job_set_type":"bytedance_video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"fps","type":"integer","default":24,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"model_version","type":"string","default":"standard","required":false,"enum":["standard","pro"]},{"name":"preset","type":"string","default":"common","required":false,"enum":["common","aigc","short_series","ugc","old_film"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1080p","2k","4k"]}]},{"display_name":"Cinematic Studio 2.5","job_set_type":"cinematic_studio_2_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"auto","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio 3.0","job_set_type":"cinematic_studio_3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Cinematic Studio Image","job_set_type":"cinematic_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"string","default":null,"required":true},{"name":"camera_lens_id","type":"string","default":null,"required":true},{"name":"camera_model_id","type":"string","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio Soul Cast","job_set_type":"cinematic_studio_soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinematic Studio Soul Location","job_set_type":"cinematic_studio_soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Cinematic Studio Video","job_set_type":"cinematic_studio_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"slow_motion","type":"boolean","default":false,"required":false},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Cinematic Studio Video 3.5","job_set_type":"cinematic_studio_video_3_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"camera_style","type":"object","default":null,"required":false},{"name":"color_grading","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"light_scheme","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"style_id","type":"object","default":null,"required":false},{"name":"style_prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinema Studio 4.0","job_set_type":"cinematic_studio_video_4_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"color_palette","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"era_id","type":"object","default":null,"required":false},{"name":"extension_mode","type":"object","default":null,"required":false},{"name":"film_era","type":"null","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"null","default":null,"required":false},{"name":"genre_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"light","type":"object","default":null,"required":false},{"name":"light_custom","type":"object","default":null,"required":false},{"name":"light_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"model","type":"string","default":"default","required":false,"enum":["default","video_edit","video_extension"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"pacing_id","type":"object","default":null,"required":false},{"name":"preset_id","type":"null","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"speedramp","type":"object","default":"auto","required":false},{"name":"use_blur","type":"boolean","default":false,"required":false},{"name":"use_eye_mask","type":"boolean","default":false,"required":false},{"name":"use_transparency","type":"boolean","default":false,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Cinematic Studio Video V2","job_set_type":"cinematic_studio_video_v2","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"cfg_scale","type":"number","default":0.5,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","western","suspense","intimate","spectacle"]},{"name":"kling_element_ids","type":"array","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Clipify","job_set_type":"clipify","type":"video","params":[{"name":"clip_aspect","type":"string","default":"9:16","required":false,"enum":["9:16","1:1","16:9"]},{"name":"clips_num","type":"integer","default":10,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"max_height","type":"integer","default":1080,"required":false},{"name":"segment_seconds","type":"integer","default":10,"required":false},{"name":"subtitle_case","type":"string","default":"as-is","required":false,"enum":["lower","upper","as-is"]},{"name":"subtitle_font","type":"string","default":"notosans","required":false},{"name":"subtitle_highlight_hex","type":"string","default":"#FFE84D","required":false},{"name":"subtitle_position","type":"string","default":"bottom","required":false,"enum":["bottom","center","top"]},{"name":"track_face_crop","type":"boolean","default":true,"required":false},{"name":"urls","type":"array","default":null,"required":true}]},{"display_name":"Draw To Video","job_set_type":"draw_to_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"ref_image","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"sketch","type":"object","default":null,"required":true},{"name":"video","type":"object","default":null,"required":true}]},{"display_name":"dubbing","job_set_type":"dubbing","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"target_language","type":"string","default":null,"required":true,"enum":["eng","cmn","fra","hin","ita","jpn","kor","por","rus","tur","spa","deu","ara","pol","ind","fil","swe","fin"]}]},{"display_name":"Explainer Video","job_set_type":"explainer_video","type":"video","params":[{"name":"height","type":"integer","default":null,"required":true},{"name":"items","type":"array","default":null,"required":true},{"name":"subtitles","type":"object","default":null,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"FLUX.2","job_set_type":"flux_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"pro","required":false,"enum":["pro","flex","max"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"FLUX.2 Pro Outpaint","job_set_type":"flux_2_pro_outpaint","type":"image","params":[{"name":"expand_bottom","type":"integer","default":0,"required":false},{"name":"expand_left","type":"integer","default":0,"required":false},{"name":"expand_right","type":"integer","default":0,"required":false},{"name":"expand_top","type":"integer","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"FLUX 3 Video","job_set_type":"flux_3_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Flux Kontext","job_set_type":"flux_kontext","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Gemini Omni Flash","job_set_type":"gemini_omni","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"integer","default":8,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false}]},{"display_name":"GPT Image 2","job_set_type":"gpt_image_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"high","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Grok Image","job_set_type":"grok_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","1:2","2:1","3:2","2:3","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","quality"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Grok Video","job_set_type":"grok_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Grok Video 1.5","job_set_type":"grok_video_v15","type":"video","params":[{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Happy Horse Video","job_set_type":"happy_horse_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Hunyuan 3D v3.1 Text to 3D","job_set_type":"hunyuan3d_v3_1_text_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Hunyuan3D v3 Image to 3D","job_set_type":"hunyuan3d_v3_image_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"integer","default":500000,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"string","default":"Normal","required":false,"enum":["Normal","LowPoly","Geometry"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"polygon_type","type":"string","default":"triangle","required":false,"enum":["triangle","quadrilateral"]}]},{"display_name":"Image Auto","job_set_type":"image_auto","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Image Background Remover","job_set_type":"image_background_remover","type":"image","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Image Decompose","job_set_type":"image_decompose","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"granular","required":false,"enum":["granular","standard"]}]},{"display_name":"Image to 3D","job_set_type":"image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Inworld Text to Speech","job_set_type":"inworld_text_to_speech","type":"audio","params":[{"name":"prompt","type":"string","default":null,"required":true},{"name":"voice","type":"string","default":null,"required":true}]},{"display_name":"Kimodo","job_set_type":"kimodo","type":"3d","params":[{"name":"diffusion_steps","type":"integer","default":10,"required":false},{"name":"duration","type":"object","default":null,"required":false},{"name":"durations","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_version","type":"string","default":"ardy-core","required":false,"enum":["ardy-core","ardy-core-h8"]},{"name":"prompt","type":"object","default":null,"required":false},{"name":"prompts","type":"object","default":null,"required":false},{"name":"seed","type":"integer","default":42,"required":false}]},{"display_name":"Kling O1 Image","job_set_type":"kling_omni_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","auto","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Kling 2.6 Video","job_set_type":"kling2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Kling v3.0","job_set_type":"kling3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std","4k"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]}]},{"display_name":"Kling 3.0 Motion Control","job_set_type":"kling3_0_motion_control","type":"video","params":[{"name":"background_source","type":"string","default":"input_image","required":false,"enum":["input_image","input_video"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","pro"]}]},{"display_name":"Kling 3.0 Turbo","job_set_type":"kling3_0_turbo","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"LLM Generation","job_set_type":"llm_text","type":"video","params":[{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":null,"required":true},{"name":"reasoning_effort","type":"object","default":null,"required":false},{"name":"system_prompt","type":"string","default":"","required":false},{"name":"user_prompt","type":"string","default":"","required":false}]},{"display_name":"Marketing Studio Image","job_set_type":"marketing_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Marketing Studio Video","job_set_type":"marketing_studio_video","type":"video","params":[{"name":"ad_reference_id","type":"object","default":null,"required":false},{"name":"aspect_ratio","type":"string","default":"9:16","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"avatar_ids","type":"array","default":null,"required":false},{"name":"avatars","type":"array","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"hook_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"ugc","required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"setting_id","type":"object","default":null,"required":false},{"name":"specific_mode","type":"string","default":"default","required":false,"enum":["default","web_product","from_storyboard"]},{"name":"storyboard_id","type":"object","default":null,"required":false},{"name":"web_product_ids","type":"array","default":null,"required":false},{"name":"web_product_type","type":"object","default":null,"required":false}]},{"display_name":"Meshy 5 Remesh","job_set_type":"meshy_v5_remesh","type":"3d","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true},{"name":"origin_at","type":"object","default":null,"required":false},{"name":"resize_height","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Meshy 6 Text to 3D","job_set_type":"meshy_v6_text_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"enable_prompt_expansion","type":"boolean","default":false,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"full","required":false},{"name":"model_type","type":"string","default":"standard","required":false},{"name":"pose_mode","type":"string","default":"","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"boolean","default":true,"required":false},{"name":"symmetry_mode","type":"string","default":"auto","required":false},{"name":"target_polycount","type":"integer","default":30000,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"string","default":"triangle","required":false}]},{"display_name":"MiniMax H3","job_set_type":"minimax_h3","type":"video","params":[{"name":"aigc_watermark","type":"boolean","default":false,"required":false},{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":4,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"resolution","type":"string","default":"2K","required":false,"enum":["768P","2K"]},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Minimax Hailuo","job_set_type":"minimax_hailuo","type":"video","params":[{"name":"duration","type":"string","default":6,"required":false,"enum":["6","10"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"minimax-2.3","required":false,"enum":["minimax","minimax-fast","minimax-2.3","minimax-2.3-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"768","required":false,"enum":["512","768","1080"]}]},{"display_name":"Mirelo Text to Audio","job_set_type":"mirelo_text_to_audio","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"MS Image","job_set_type":"ms_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"avatars","type":"array","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"brand_kit_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"low","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Multi-Image to 3D","job_set_type":"multi_image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Nano Banana","job_set_type":"nano_banana","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_ai_stylist","type":"image","params":[{"name":"background_preset_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"outfit_preset_ids","type":"array","default":null,"required":false},{"name":"pose_preset_id","type":"object","default":null,"required":false},{"name":"user_outfit_ids","type":"array","default":null,"required":false}]},{"display_name":"Nano Banana 2 Lite","job_set_type":"nano_banana_2_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"thinking","type":"string","default":"HIGH","required":false,"enum":["MINIMAL","HIGH"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_relight","type":"image","params":[{"name":"brightness","type":"integer","default":null,"required":true},{"name":"color","type":"string","default":null,"required":true},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"light_quality","type":"string","default":null,"required":true,"enum":["hard","sharp","soft"]},{"name":"light_source","type":"string","default":null,"required":true,"enum":["mdl","mdr","mul","mur","bml","fml","fmr","bmm","mml","mmr","fmm","bmr","mdm","mum","bdr","fdl","bur","ful","bdl","fdr","bul","fur","bdm","fdm","bum","fum"]},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_shots","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_skin_enhancer","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"preset_id","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana 2","job_set_type":"nano_banana_flash","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"OpenAI Hazel","job_set_type":"openai_hazel","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","auto"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"medium","required":false,"enum":["low","medium","high"]}]},{"display_name":"Outpaint","job_set_type":"outpaint","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"21:9","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Qwen Audio 3.0 TTS Flash","job_set_type":"qwen_audio_tts","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"instruction","type":"object","default":null,"required":false},{"name":"language","type":"object","default":null,"required":false},{"name":"pitch_rate","type":"number","default":1,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","22050","24000","44100","48000"]},{"name":"seed","type":"integer","default":0,"required":false},{"name":"speech_rate","type":"number","default":1,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"integer","default":50,"required":false}]},{"display_name":"Angles","job_set_type":"qwen_camera_control","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"move_forward_level","type":"integer","default":0,"required":false},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"rotate_degree","type":"integer","default":0,"required":false},{"name":"vertical_angle","type":"integer","default":0,"required":false},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Recraft V4.1","job_set_type":"recraft_v4_1","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:4","4:3","4:5","5:4","3:2","2:3","16:9","9:16","21:9"]},{"name":"background_color","type":"object","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"colors","type":"array","default":null,"required":false},{"name":"model_type","type":"string","default":"standard","required":false,"enum":["standard","vector","utility","utility_vector"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Reframe","job_set_type":"reframe","type":"video","params":[{"name":"aspect_ratio","type":"string","default":null,"required":true,"enum":["21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"3D Objects","job_set_type":"sam_3_3d","type":"3d","params":[{"name":"detection_threshold","type":"object","default":null,"required":false},{"name":"export_textured_glb","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"3D Body","job_set_type":"sam_3_3d_body","type":"3d","params":[{"name":"export_meshes","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"include_3d_keypoints","type":"boolean","default":true,"required":false},{"name":"include_mhr_params","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Remove Background","job_set_type":"sam_3_video","type":"video","params":[{"name":"apply_mask","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false}]},{"display_name":"Seed Audio 1.0","job_set_type":"seed_audio","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"expression_intensity","type":"integer","default":5,"required":false},{"name":"format","type":"string","default":"wav","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"loudness_rate","type":"integer","default":0,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mood","type":"number","default":0,"required":false},{"name":"pitch_rate","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","24000","32000","44100","48000"]},{"name":"speech_rate","type":"integer","default":0,"required":false},{"name":"voice_id","type":"object","default":null,"required":false},{"name":"voice_style","type":"object","default":null,"required":false},{"name":"voice_type","type":"object","default":null,"required":false},{"name":"voices","type":"array","default":null,"required":false}]},{"display_name":"Seedance 2.0","job_set_type":"seedance_2_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]}]},{"display_name":"Seedance 2.0 Mini","job_set_type":"seedance_2_0_mini","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p"]}]},{"display_name":"Seedance 2.5","job_set_type":"seedance_2_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"audio_references","type":"array","default":null,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"end_image","type":"object","default":null,"required":false},{"name":"extension_mode","type":"string","default":null,"required":false,"enum":["backward","forward"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"image_references","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"t2v","required":false,"enum":["t2v","omni_reference","video_edit","video_extension"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"start_image","type":"object","default":null,"required":false},{"name":"video_references","type":"array","default":null,"required":false}]},{"display_name":"Seedance 1.5 Pro","job_set_type":"seedance1_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"duration","type":"string","default":4,"required":false,"enum":["4","8","12"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Seedream 4.5","job_set_type":"seedream_v4_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","4:3","16:9","3:2","21:9","3:4","9:16","2:3"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Lite","job_set_type":"seedream_v5_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Pro","job_set_type":"seedream_v5_pro","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"height","type":"object","default":null,"required":false},{"name":"is_inpaint","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","1.5k","2k"]},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Sonilo Music","job_set_type":"sonilo_music","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Soul Cast","job_set_type":"soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"soul_cinema_studio","job_set_type":"soul_cinema_studio","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Soul Cinematic","job_set_type":"soul_cinematic","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]}]},{"display_name":"Soul Location","job_set_type":"soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Sync Lipsync 3","job_set_type":"sync_so","type":"video","params":[{"name":"active_speaker_detection","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_audio","type":"object","default":null,"required":true},{"name":"input_video","type":"object","default":null,"required":true},{"name":"occlusion_detection_enabled","type":"boolean","default":false,"required":false},{"name":"sync_mode","type":"string","default":"bounce","required":false,"enum":["bounce","loop","cut_off","silence","remap"]},{"name":"temperature","type":"number","default":0.5,"required":false}]},{"display_name":"Higgsfield Soul 2.0","job_set_type":"text2image_soul_v2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"Text to Speech V2","job_set_type":"text2speech_v2","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"emotion","type":"object","default":null,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["mp3","wav"]},{"name":"language_boost","type":"string","default":"auto","required":false,"enum":["auto","af","ar","bg","ca","cs","da","de","el","en","es","fa","fi","fil","fr","he","hi","hr","hu","id","it","ja","ko","ms","nl","nn","no","pl","pt","ro","ru","sk","sl","sv","ta","th","tr","uk","vi","yue","zh"]},{"name":"model","type":"string","default":null,"required":true,"enum":["elevenlabs","minimax","seed_speech","vibe_voice","cozy_voice"]},{"name":"pitch","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":32000,"required":false,"enum":["8000","16000","22050","24000","32000","44100"]},{"name":"speed","type":"number","default":1,"required":false},{"name":"stability","type":"object","default":null,"required":false},{"name":"text_normalization","type":"boolean","default":false,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"number","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image","type":"image","params":[{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Standard V2","required":false,"enum":["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"sharpen","type":"number","default":0,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image_generative","type":"image","params":[{"name":"autoprompt","type":"boolean","default":true,"required":false},{"name":"creativity","type":"integer","default":1,"required":false},{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Redefine","required":false,"enum":["Standard MAX","Redefine","Recovery","Recovery V2"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"sharpen","type":"number","default":0,"required":false},{"name":"texture","type":"integer","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancement","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frame_interpolation","type":"object","default":null,"required":false},{"name":"frame_rate","type":"number","default":30,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"input_height","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":false},{"name":"input_video_size","type":"integer","default":0,"required":false},{"name":"input_width","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"1080p","required":false,"enum":["1080p","2160p"]}]},{"display_name":"Text to 3D","job_set_type":"tripo_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"negative_prompt","type":"object","default":null,"required":false},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]}]},{"display_name":"Tripo H3.1 Image to 3D","job_set_type":"tripo_h3_1_image_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Tripo H3.1 Multiview to 3D","job_set_type":"tripo_h3_1_multiview_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Google Veo 3","job_set_type":"veo3","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"veo-3-fast","required":false,"enum":["veo-3-preview","veo-3-fast"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Google Veo 3.1","job_set_type":"veo3_1","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"model","type":"string","default":"veo-3-1-fast","required":false,"enum":["veo-3-1-preview","veo-3-1-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high","ultra"]}]},{"display_name":"Google Veo 3.1 Lite","job_set_type":"veo3_1_lite","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","auto"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Video Background Remover","job_set_type":"video_background_remover","type":"video","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Video Deflicker","job_set_type":"video_deflicker","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"Video Upscale","job_set_type":"video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"voice_change","job_set_type":"voice_change","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":"preset","required":false,"enum":["preset","element"]}]},{"display_name":"Wan 2.6 Video","job_set_type":"wan2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10","15"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 2.7","job_set_type":"wan2_7","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 3.0","job_set_type":"wan3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enable_thinking","type":"boolean","default":false,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Z Image","job_set_type":"z_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"prompt","type":"string","default":null,"required":true}]}]'), co = {
  models: uo
}, fo = co, Zi = fo.models, mo = {
  text2image_soul_v2: "hf-soul-v2",
  nano_banana_2: "hf-nano-banana-pro",
  gpt_image_2: "hf-gpt-image-2",
  seedance_2_0: "hf-seedance-2",
  kling3_0: "hf-kling-3",
  veo3_1: "hf-veo-3-1"
}, po = /* @__PURE__ */ new Set([
  "input_image",
  "ref_image",
  "sketch",
  "texture_image_url"
]), yo = /* @__PURE__ */ new Set(["input_images"]), ho = /* @__PURE__ */ new Set(["input_video", "video"]), go = /* @__PURE__ */ new Set(["input_audio"]);
function Qn(t) {
  return t.split(/[_-]+/).filter(Boolean).map((e) => e.charAt(0).toUpperCase() + e.slice(1)).join(" ");
}
function _o(t) {
  return mo[t] ?? `hf-${t.replaceAll("_", "-")}`;
}
function wo(t) {
  return t === "3d" ? "model3d" : t;
}
function bo(t, e) {
  let n, r, i = !1;
  if (po.has(e.name) ? (n = "image", r = t.type === "video" && e.name === "input_image" ? "start_image" : "image") : yo.has(e.name) ? (n = "image", r = "image", i = !0) : ho.has(e.name) ? (n = "video", r = "video") : go.has(e.name) ? (n = "audio", r = "audio") : e.name === "model_url" ? n = "model3d" : e.name === "urls" ? (n = "media", i = !0) : e.name === "medias" && (i = !0, t.type === "image" || t.type === "3d" ? (n = "image", r = "image") : t.type === "text" ? (n = "video", r = "video") : n = "media"), !!n)
    return {
      id: e.name,
      portType: n,
      label: Qn(e.name),
      required: e.required,
      falParam: e.name,
      fieldType: "port",
      schemaType: e.type,
      multiple: i,
      mediaRole: r,
      ...e.default !== void 0 ? { default: e.default } : {}
    };
}
function Eo(t, e) {
  var i;
  const n = bo(t, e);
  if (n) return n;
  const r = {
    id: e.name,
    portType: "config",
    label: Qn(e.name),
    required: e.required,
    falParam: e.name,
    schemaType: e.type,
    ...e.default !== void 0 ? { default: e.default } : {}
  };
  return e.type === "string" ? (i = e.enum) != null && i.length ? {
    ...r,
    portType: "text",
    fieldType: "select",
    options: e.enum.map((a) => ({ value: a, label: a }))
  } : /(^|_)prompt$/.test(e.name) || e.name === "instruction" ? { ...r, portType: "text", fieldType: "port" } : { ...r, portType: "text", fieldType: "text" } : e.type === "integer" || e.type === "number" ? { ...r, portType: "number", fieldType: "number" } : e.type === "boolean" ? { ...r, fieldType: "toggle" } : {
    ...r,
    fieldType: "json",
    placeholder: e.type === "array" ? "[]" : e.type === "object" ? "{}" : "null"
  };
}
function vo(t, e) {
  const n = (r, i, a, s, l = !1) => ({
    id: r,
    portType: a,
    label: i,
    required: !1,
    falParam: e.name,
    fieldType: "port",
    schemaType: e.type,
    mediaRole: s,
    multiple: l
  });
  return t.job_set_type === "text2image_soul_v2" && e.name === "medias" ? [n("image_url", "Reference Image", "image", "image")] : t.job_set_type === "nano_banana_2" && e.name === "input_images" ? [n("image_url", "Reference Images", "image", "image", !0)] : t.job_set_type === "gpt_image_2" && e.name === "medias" ? [n("image_url", "Reference Images", "image", "image", !0)] : t.job_set_type === "seedance_2_0" && e.name === "medias" ? [
    n("start_image_url", "First Frame", "image", "start_image"),
    n("end_image_url", "Last Frame", "image", "end_image"),
    n("image_references", "Image References", "image", "image", !0),
    n("video_references", "Video References", "video", "video", !0),
    n("audio_references", "Audio References", "audio", "audio", !0)
  ] : t.job_set_type === "kling3_0" && e.name === "medias" ? [
    n("start_image_url", "First Frame", "image", "start_image"),
    n("end_image_url", "Last Frame", "image", "end_image")
  ] : t.job_set_type === "veo3_1" && e.name === "input_image" ? [n("start_image_url", "First Frame", "image", "start_image")] : [];
}
const To = ["prompt", "user_prompt", "instruction"];
function So(t) {
  for (const e of To) {
    const n = t.findIndex((r) => r.id === e);
    if (n > 0) return [t[n], ...t.slice(0, n), ...t.slice(n + 1)];
    if (n === 0) return t;
  }
  return t;
}
function xo(t = Zi) {
  const e = {};
  for (const n of t) {
    const r = _o(n.job_set_type), i = wo(n.type);
    if (e[r]) throw new Error(`Duplicate Higgsfield node type: ${r}`);
    e[r] = {
      id: n.job_set_type,
      nodeType: r,
      name: n.display_name,
      category: i,
      description: `Higgsfield ${n.type.toUpperCase()} model`,
      inputs: So(n.params.flatMap((a) => [
        Eo(n, a),
        ...vo(n, a)
      ])),
      outputType: i,
      outputs: [{ id: i, portType: i, label: i === "model3d" ? "3D Model" : Qn(i) }],
      provider: "higgsfield",
      responseMapping: { path: i === "text" ? "text" : "output.url" }
    };
  }
  return e;
}
const dm = xo();
function jo(t, e, n = Zi) {
  if (!e) return e;
  const r = n.find((s) => s.job_set_type === t);
  if (!r) return e;
  const i = new Set(r.params.map((s) => s.name)), a = {};
  for (const [s, l] of Object.entries(e))
    i.has(s) && (a[s] = l);
  return a;
}
const qo = {
  image: "--image",
  start_image: "--start-image",
  end_image: "--end-image",
  video: "--video",
  audio: "--audio"
}, Io = /^[A-Za-z][A-Za-z0-9_]*$/, Ao = /* @__PURE__ */ new Set(["json", "wait", "no_color"]);
function ko(t) {
  const e = ["generate", "create", t.model], n = {
    ...jo(t.model, { ...t.extra, ...t.params }) ?? {}
  }, r = (a, s) => {
    if (s == null) return;
    if (!Io.test(a) || Ao.has(a))
      throw new Error(`Invalid Higgsfield parameter name: ${a}`);
    let l;
    if (typeof s == "string")
      l = a === "prompt" ? s.trim() : s;
    else if (typeof s == "number") {
      if (!Number.isFinite(s)) throw new Error(`Higgsfield parameter ${a} must be finite`);
      l = String(s);
    } else if (typeof s == "boolean")
      l = s ? "true" : "false";
    else if (typeof s == "object")
      try {
        const o = JSON.stringify(s);
        if (o === void 0) throw new Error("not JSON serializable");
        l = o;
      } catch (o) {
        throw new Error(`Higgsfield parameter ${a} must be JSON serializable`, { cause: o });
      }
    else
      throw new Error(`Higgsfield parameter ${a} has an unsupported value type`);
    e.push(`--${a}`, l);
  }, i = t.prompt !== void 0 ? t.prompt : n.prompt;
  delete n.prompt, r("prompt", i);
  for (const a of t.medias ?? [])
    a.value && e.push(qo[a.role], a.value);
  t.aspectRatio !== void 0 && (delete n.aspect_ratio, r("aspect_ratio", t.aspectRatio)), t.durationSec !== void 0 && (delete n.duration, t.durationSec > 0 && r("duration", t.durationSec)), t.count !== void 0 && (delete n.count, t.count >= 1 && r("count", t.count));
  for (const [a, s] of Object.entries(n))
    r(a, s);
  return e.push("--json"), e;
}
class On extends Error {
  constructor(e, n = "", r = "") {
    super(e), this.name = "HiggsfieldCliError", this.stdout = n, this.stderr = r;
  }
}
function Nn(t) {
  return /HTTP\s*50[234]|50[234]\s+[\w\s]*Unavailable|502 Bad Gateway|504 Gateway|ECONNRESET|ETIMEDOUT|socket hang up|no response received|HTTP\s*429|rate limit|temporarily unavailable|service unavailable/i.test(t);
}
const Ro = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function Oo(t) {
  return /^(queued|queue|pending|running|processing|waiting|in_progress|ns|created)$/.test(t.trim());
}
function Zn(t, e) {
  if (!("outputs" in t) && !("mediaType" in t)) return !1;
  const n = t;
  return typeof n.url == "string" && n.url.trim() ? !0 : e === "text" && typeof n.text == "string" && !!n.text.trim();
}
function No(t) {
  for (const e of ["results", "jobs"]) {
    const n = t[e];
    if (Array.isArray(n) && n.length > 0 && ke(n[0])) return n[0];
  }
  return t;
}
function er(t) {
  const e = t.trim();
  if (!e) throw new Error("Higgsfield CLI returned no output");
  const n = (s) => Array.isArray(s) ? { results: s } : ke(s) ? s : { result: s };
  let r = null;
  try {
    r = n(JSON.parse(e));
  } catch {
    for (const s of e.split(/\r?\n/).reverse()) {
      const l = s.trim();
      if (!(!l.startsWith("{") && !l.startsWith("[")))
        try {
          r = n(JSON.parse(l));
          break;
        } catch {
        }
    }
  }
  if (!r) throw new Error("Higgsfield CLI output was not valid JSON");
  const i = No(r), a = i.job_id ?? i.id ?? i.jobId;
  return {
    status: String(i.state ?? i.status ?? "").toLowerCase(),
    jobId: typeof a == "string" && a.trim() ? a.trim() : void 0,
    record: i,
    parsed: r
  };
}
function $r(...t) {
  var n;
  const e = t.filter(Boolean).join(`
`);
  try {
    const r = er(e).jobId;
    if (r) return r;
  } catch {
  }
  return (n = e.match(Ro)) == null ? void 0 : n[0];
}
function ke(t) {
  return !!t && typeof t == "object" && !Array.isArray(t);
}
const Po = /* @__PURE__ */ new Set(["params", "prompt", "input_images", "inputs", "extra", "request"]), Br = [
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
], Hr = [
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
function Ye(t, e = 0) {
  if (e > 12) return [];
  if (typeof t == "string") {
    const r = t.trim().replace(/[),.;]+$/, "");
    return /^https?:\/\//i.test(r) ? [r] : [];
  }
  if (Array.isArray(t))
    return [...new Set(t.flatMap((r) => Ye(r, e + 1)))];
  if (!ke(t)) return [];
  const n = [];
  for (const r of Br)
    t[r] !== void 0 && n.push(...Ye(t[r], e + 1));
  if (typeof t.result_json == "string" && t.result_json.trim())
    try {
      n.push(...Ye(JSON.parse(t.result_json), e + 1));
    } catch {
    }
  for (const r of Hr)
    t[r] !== void 0 && n.push(...Ye(t[r], e + 1));
  for (const [r, i] of Object.entries(t))
    Po.has(r) || Br.includes(r) || Hr.includes(r) || r === "result_json" || (ke(i) || Array.isArray(i)) && n.push(...Ye(i, e + 1));
  return [...new Set(n)];
}
const Co = /https?:\/\/[^\s"'<>\\]+/gi;
function ea(t) {
  const e = t.match(Co) ?? [];
  return [...new Set(e.map((n) => n.replace(/[),.;]+$/, "")))].filter((n) => /^https?:\/\//i.test(n) && !/higgsfield\.ai\/(docs|cli|skills)/i.test(n));
}
function Bt(t, e = 0) {
  if (e > 12) return;
  if (typeof t == "string") {
    const r = t.trim();
    return r && !/^https?:\/\//i.test(r) ? r : void 0;
  }
  if (Array.isArray(t)) {
    for (const r of t) {
      const i = Bt(r, e + 1);
      if (i) return i;
    }
    return;
  }
  if (!ke(t)) return;
  for (const r of ["text", "output_text", "result_text", "response_text", "answer", "content"]) {
    const i = t[r];
    if (typeof i == "string") {
      const a = i.trim();
      if (a && !/^https?:\/\//i.test(a)) return a;
    }
  }
  const n = t.result_json;
  if (typeof n == "string" && n.trim()) {
    try {
      const r = Bt(JSON.parse(n), e + 1);
      if (r) return r;
    } catch {
    }
    return n.trim();
  }
  for (const r of ["output", "result", "data", "job", "results", "outputs", "items"]) {
    const i = Bt(t[r], e + 1);
    if (i) return i;
  }
}
function ta(t, e) {
  const n = er(t);
  if (n.status === "failed" || n.status === "error" || n.status === "fail")
    throw new Error(typeof n.record.error == "string" ? n.record.error : "Higgsfield generation failed");
  if (Oo(n.status))
    throw new Error("Higgsfield job is still running");
  const r = tr(n, e);
  if (e.mediaType === "text") {
    if (!r.url && !r.text) throw new Error("Higgsfield generation finished without a media URL or text output");
    return r;
  }
  if (r.url) return r;
  const i = ea(t);
  if (i[0])
    return { ...r, url: i[0], urls: i, outputs: i.map((a) => ({ kind: e.mediaType, url: a })) };
  throw new Error("Higgsfield generation finished without a media URL");
}
function tr(t, e) {
  var o;
  const n = Ye(t.parsed), r = n[0], i = Bt(t.parsed), a = t.record.duration ?? ((o = t.record.output) == null ? void 0 : o.duration), s = e.mediaType, l = n.map((u) => ({ kind: s, url: u }));
  return i && l.push({ kind: "text", text: i }), {
    ...r ? { url: r, urls: n } : {},
    ...i ? { text: i } : {},
    mediaType: s,
    outputKind: s,
    outputs: l,
    durationSec: typeof a == "number" ? a : typeof a == "string" && Number.isFinite(Number(a)) ? Number(a) : void 0,
    jobId: t.jobId,
    model: e.model
  };
}
function Ze(t) {
  return t instanceof Error ? t.message : String(t);
}
function na(t) {
  return t instanceof On ? { stdout: t.stdout, stderr: t.stderr } : { stdout: "", stderr: "" };
}
async function Pn(t, e) {
  if (t.trim())
    try {
      return ta(t, e);
    } catch {
      return;
    }
}
function Uo(t = z.homedir()) {
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
function Lo(t) {
  return !t.includes("/") && !t.includes("\\");
}
function Do(t = Uo(), e = (n) => {
  try {
    return F.existsSync(n);
  } catch {
    return !1;
  }
}) {
  const n = [], r = [];
  for (const i of t) {
    if (Lo(i)) {
      r.includes(i) || r.push(i);
      continue;
    }
    e(i) && !n.includes(i) && n.push(i);
  }
  return [...n, ...r];
}
function Mo() {
  const t = z.homedir(), e = [w.join(t, ".npm-global/bin"), w.join(t, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...process.env, PATH: [...e, process.env.PATH ?? ""].filter(Boolean).join(w.delimiter), NO_COLOR: "1" };
}
const Wr = 1260 * 1e3, Fo = 9e4, zr = 4, bn = "Higgsfield CLI not found. Install @higgsfield/cli, then run higgsfield auth login — or connect Higgsfield in Settings.";
function $o(t) {
  if (!t || typeof t != "object") return !1;
  const e = "code" in t ? String(t.code) : "", n = t instanceof Error ? t.message : String(t);
  return e === "ENOENT" || /ENOENT|spawn .* ENOENT/i.test(n);
}
let Je = null;
function Bo(t, e, n) {
  return new Promise((r, i) => {
    var u, d;
    const a = ne(t, e, { env: Mo() });
    let s = "", l = "";
    const o = setTimeout(() => {
      a.kill("SIGTERM"), i(new On("Higgsfield CLI timed out", s, l));
    }, n);
    (u = a.stdout) == null || u.on("data", (c) => {
      s += c.toString();
    }), (d = a.stderr) == null || d.on("data", (c) => {
      l += c.toString();
    }), a.on("error", (c) => {
      clearTimeout(o), i(c);
    }), a.on("close", (c) => {
      if (clearTimeout(o), c === 0) {
        r(s);
        return;
      }
      const m = l.trim() || s.trim() || `Higgsfield CLI exited with code ${c}`, f = /session expired/i.test(m) ? 'Higgsfield is not connected. Run "higgsfield auth login" or connect it in Settings.' : m;
      i(new On(f, s, l));
    });
  });
}
async function Re(t, e = 6e4) {
  const n = t.includes("--json") ? t : [...t, "--json"], r = Do(), i = Je ? [Je, ...r.filter((o) => o !== Je)] : r;
  if (i.length === 0) throw new Error(bn);
  let a;
  for (const o of i)
    try {
      const u = await Bo(o, n, e);
      return Je = o, u;
    } catch (u) {
      if ($o(u)) {
        Je === o && (Je = null), a = u;
        continue;
      }
      throw u;
    }
  const s = i.join(", "), l = a instanceof Error ? a.message : "";
  throw new Error(l ? `${bn} Tried: ${s}. ${l}` : `${bn} Tried: ${s}.`);
}
const Ho = 6e4, ra = {
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
function ia(t) {
  return t === "video" ? ".mp4" : t === "audio" ? ".mp3" : ".png";
}
function Wo(t, e, n) {
  const r = e ? ra[e.split(";", 1)[0].trim().toLowerCase()] : void 0;
  if (r) return r;
  const i = w.extname(t.split(/[?#]/, 1)[0]).toLowerCase();
  return i && i.length <= 5 ? i : ia(n);
}
async function zo(t) {
  if (!(t != null && t.length)) return { medias: t, tempPaths: [] };
  const e = [], n = [];
  for (const [r, i] of t.entries()) {
    let a = i.value;
    if (a.startsWith("local-media://file"))
      try {
        a = decodeURIComponent(a.slice(18));
      } catch {
        a = a.slice(18);
      }
    if (/^https?:\/\//i.test(a)) {
      const s = await fetch(a, { signal: AbortSignal.timeout(Ho) });
      if (!s.ok) throw new Error(`Failed to download media input (HTTP ${s.status}): ${a}`);
      const l = Wo(a, s.headers.get("content-type"), i.role), o = w.join(z.tmpdir(), `cinegen-hf-media-${Date.now()}-${r}${l}`);
      await F.promises.writeFile(o, Buffer.from(await s.arrayBuffer())), e.push(o), n.push({ ...i, value: o });
    } else if (a.startsWith("data:")) {
      const s = a.indexOf(",");
      if (s < 0) throw new Error("Malformed data: URI media input");
      const l = a.slice(5, s), o = l.replace(/;base64$/i, ""), u = a.slice(s + 1), d = /;base64$/i.test(l) ? Buffer.from(u, "base64") : Buffer.from(decodeURIComponent(u)), c = ra[o.toLowerCase()] ?? ia(i.role), m = w.join(z.tmpdir(), `cinegen-hf-media-${Date.now()}-${r}${c}`);
      await F.promises.writeFile(m, d), e.push(m), n.push({ ...i, value: m });
    } else
      n.push(a === i.value ? i : { ...i, value: a });
  }
  return { medias: n, tempPaths: e };
}
async function Cn(t) {
  const { medias: e, tempPaths: n } = await zo(t.medias);
  let r;
  try {
    r = await Go({ ...t, medias: e });
  } finally {
    for (const a of n)
      F.promises.unlink(a).catch(() => {
      });
  }
  if (Zn(r, t.mediaType)) return r;
  const i = "jobId" in r ? r.jobId : void 0;
  if (!i) throw new Error("Higgsfield accepted the request but did not return a job id.");
  return t.wait === !1 ? {
    jobId: i,
    model: t.model,
    mediaType: t.mediaType,
    outputKind: t.mediaType,
    outputs: []
  } : oa(i, t);
}
function aa(t) {
  return new Promise((e) => setTimeout(e, t));
}
async function Go(t) {
  const e = ko({ ...t });
  let n;
  for (let r = 1; r <= 3; r++)
    try {
      const i = await Re(e, Fo), a = await Pn(i, t);
      if (a) return a;
      const s = $r(i);
      if (s) return { jobId: s };
      throw new Error("Higgsfield accepted the request but did not return a job id.");
    } catch (i) {
      n = i;
      const { stdout: a, stderr: s } = na(i), l = await Pn(a, t);
      if (l) return l;
      const o = $r(a, s, Ze(i));
      if (o) return { jobId: o };
      if (!Nn(Ze(i)) || r === 3) throw i;
      await aa(1500 * r);
    }
  throw n instanceof Error ? n : new Error("Higgsfield submit failed");
}
function Jo(t, e) {
  return t.find((n) => n.id === e || n.job_id === e || n.jobId === e || n.job_set_id === e || n.parent_id === e);
}
async function sa(t, e) {
  try {
    const n = await la({ size: 50 }), r = Jo(n, t);
    if (!r) return;
    const i = tr({
      status: String(r.status ?? r.state ?? "completed").toLowerCase(),
      jobId: t,
      record: r,
      parsed: r
    }, e);
    return i.url || i.text ? i : void 0;
  } catch {
    return;
  }
}
async function nr(t, e) {
  const n = await Re(["generate", "get", t], 2e4), r = er(n);
  if (r.status === "failed" || r.status === "error" || r.status === "fail")
    throw new Error(typeof r.record.error == "string" ? r.record.error : "Higgsfield generation failed");
  const i = tr(r, e);
  if (i.url || i.text) return i;
  const a = ea(n);
  return a[0] ? { ...i, url: a[0], urls: a, outputs: a.map((s) => ({ kind: e.mediaType, url: s })) } : sa(t, e);
}
async function Ko(t) {
  try {
    return await Re(
      ["generate", "wait", t, "--timeout", "20m", "--interval", "5s"],
      Wr
    );
  } catch (e) {
    if (!/unknown|unexpected|unrecognized/i.test(Ze(e))) throw e;
    return Re(
      ["generate", "wait", t, "--wait-timeout", "20m", "--wait-interval", "5s"],
      Wr
    );
  }
}
async function oa(t, e) {
  let n;
  for (let i = 1; i <= zr; i++)
    try {
      const a = await Ko(t);
      return ta(a, e);
    } catch (a) {
      n = a;
      const { stdout: s } = na(a), l = await Pn(s, e);
      if (l) return l;
      try {
        const d = await nr(t, e);
        if (d) return d;
      } catch (d) {
        if (!Nn(Ze(d))) throw d;
      }
      const o = Ze(a);
      if (!(Nn(o) || /timed out/i.test(o) || /still running/i.test(o) || /without a media URL/i.test(o))) throw a;
      if (i === zr) break;
      await aa(2e3 * i);
    }
  const r = await sa(t, e);
  if (r) return r;
  throw new Error(
    `${Ze(n)} The job was submitted (${t}) and may still finish on Higgsfield.`
  );
}
function Gr(t) {
  if (Array.isArray(t)) return t.filter((e) => ke(e));
  if (!ke(t)) return [];
  for (const e of ["jobs", "results", "data", "items", "generations"]) {
    const n = t[e];
    if (Array.isArray(n)) return n.filter((r) => ke(r));
  }
  return t.id || t.job_id ? [t] : [];
}
async function la(t) {
  const e = ["generate", "list"];
  t != null && t.video && e.push("--video"), e.push("--size", String((t == null ? void 0 : t.size) ?? 20));
  const r = (await Re(e, 2e4)).trim();
  try {
    return Gr(JSON.parse(r));
  } catch {
    const i = Math.max(r.lastIndexOf("["), r.lastIndexOf("{"));
    return i < 0 ? [] : Gr(JSON.parse(r.slice(i)));
  }
}
async function Xo(t, e) {
  const n = await nr(t, e);
  return n && Zn(n, e.mediaType) ? n : oa(t, e);
}
async function Jr() {
  try {
    const t = await Re(["account", "status"], 15e3);
    return JSON.parse(t.trim());
  } catch {
    return null;
  }
}
function Kr(t) {
  if (!t) return { connected: !1 };
  const e = t.data && typeof t.data == "object" ? t.data : t, n = e.subscription_plan_type ?? e.plan;
  return {
    connected: !0,
    email: typeof e.email == "string" ? e.email : void 0,
    plan: typeof n == "string" ? n : void 0,
    credits: typeof e.credits == "number" ? e.credits : typeof e.balance == "number" ? e.balance : void 0
  };
}
function Xr(t) {
  if (t.drawnFramePath && t.referenceMode === "frame") {
    const e = t.outputType === "video" ? "start_image" : "image", n = [{ value: t.drawnFramePath, role: e }];
    return t.guideFramePath && n.push({ value: t.guideFramePath, role: "image" }), n;
  }
  return t.extractedPaths.map((e, n) => ({
    value: e,
    role: t.extractedRoles[n] ?? "image"
  }));
}
function Vo() {
  I.handle("higgsfield:account-status", async () => Kr(await Jr())), I.handle("higgsfield:quick-edit", async (t, e) => {
    const { prepareClipReference: n, resolveLocalSourcePath: r } = await Promise.resolve().then(() => fi);
    console.log("[higgsfield:quick-edit] params:", { fileRef: e.fileRef, mode: e.referenceMode, model: e.model, range: [e.sourceStartSec, e.sourceEndSec] });
    let i = [];
    const a = /^https?:\/\//i.test(e.fileRef), s = a ? null : r(e.fileRef);
    if (e.drawnFramePath && e.referenceMode === "frame")
      i = Xr({
        referenceMode: "frame",
        outputType: e.outputType,
        drawnFramePath: e.drawnFramePath,
        guideFramePath: e.guideFramePath,
        extractedPaths: [],
        extractedRoles: []
      });
    else if (s)
      try {
        const l = await n(e.fileRef, {
          mode: e.referenceMode,
          frameTimeSec: e.frameTimeSec,
          sourceStartSec: e.sourceStartSec,
          sourceEndSec: e.sourceEndSec
        });
        console.log("[higgsfield:quick-edit] extracted refs:", l.paths), i = Xr({
          referenceMode: e.referenceMode,
          outputType: e.outputType,
          drawnFramePath: e.drawnFramePath,
          extractedPaths: l.paths,
          extractedRoles: l.roles
        });
      } catch (l) {
        console.warn("[higgsfield:quick-edit] extraction failed, falling back to source path:", l), i = [{ value: s, role: e.outputType === "video" ? "start_image" : "image" }];
      }
    else if (a)
      console.log("[higgsfield:quick-edit] remote source, passing URL directly"), i = [{ value: e.fileRef, role: e.outputType === "video" ? "start_image" : "image" }];
    else
      throw new Error(`Quick Edit could not resolve the clip's source media: ${e.fileRef}`);
    return Cn({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: i.length > 0 ? i : void 0,
      aspectRatio: e.aspectRatio
    });
  }), I.handle("higgsfield:generate", async (t, e) => {
    const { resolveLocalSourcePath: n } = await Promise.resolve().then(() => fi);
    if (e.jobId) {
      const i = { model: e.model, mediaType: e.outputType };
      if (e.wait === !1) {
        const a = await nr(e.jobId, i);
        if (a && Zn(a, e.outputType)) return a;
        throw new Error("Higgsfield job is still running");
      }
      return Xo(e.jobId, i);
    }
    const r = [...e.medias ?? []].map((i) => {
      if (!i.value || /^https?:\/\//i.test(i.value)) return i;
      const a = n(i.value);
      return a ? { ...i, value: a } : i;
    });
    return e.referenceValue && r.push({
      value: e.referenceValue,
      role: e.outputType === "video" ? "start_image" : "image"
    }), Cn({
      model: e.model,
      prompt: e.prompt,
      mediaType: e.outputType,
      medias: r.length > 0 ? r : void 0,
      params: e.params,
      wait: e.wait
    });
  }), I.handle("higgsfield:generate-list", async (t, e) => la(e)), I.handle("higgsfield:auth-login", async () => {
    try {
      await Re(["auth", "login"], 300 * 1e3);
    } catch (t) {
      return { connected: !1, error: t instanceof Error ? t.message : String(t) };
    }
    return Kr(await Jr());
  }), I.handle("higgsfield:auth-logout", async () => {
    await Re(["auth", "logout"], 15e3).catch(() => {
    });
  });
}
const Qe = "https://api.kie.ai/api/v1", Yo = 3e3, Qo = 120, Zo = {
  runway: `${Qe}/runway/generate`,
  veo: `${Qe}/veo/generate`,
  "4o-image": `${Qe}/gpt4o-image/generate`,
  "suno-music": `${Qe}/generate`
};
function el(t) {
  for (const [e, n] of Object.entries(Zo))
    if (t.startsWith(e)) return n;
}
async function tl(t, e, n) {
  const r = el(t), i = r ?? `${Qe}/jobs/createTask`, a = r ? { ...e, callBackUrl: "" } : { model: t, input: e, callBackUrl: "" }, s = await fetch(i, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${n}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(a)
  });
  if (!s.ok) {
    const o = await s.json().catch(() => ({}));
    throw new Error(o.msg || `kie.ai error ${s.status}`);
  }
  const l = await s.json();
  if (l.code !== 200)
    throw new Error(l.msg || "Failed to create kie.ai task");
  return l.data.taskId;
}
async function nl(t, e) {
  for (let n = 0; n < Qo; n++) {
    await new Promise((s) => setTimeout(s, Yo));
    const r = await fetch(`${Qe}/jobs/recordInfo?taskId=${t}`, {
      headers: { Authorization: `Bearer ${e}` }
    });
    if (!r.ok) continue;
    const a = (await r.json()).data;
    if (a.state === "success")
      try {
        return JSON.parse(a.resultJson);
      } catch {
        return a;
      }
    if (a.state === "fail")
      throw new Error(a.failMsg || "kie.ai generation failed");
  }
  throw new Error("kie.ai generation timed out");
}
async function rl(t, e, n) {
  const r = await tl(t, e, n);
  return await nl(r, n);
}
const il = /* @__PURE__ */ new Set([
  "image",
  "start_image",
  "end_image",
  "video",
  "audio"
]), al = {
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
function sl(t) {
  if (!t.startsWith("local-media://file")) return t;
  try {
    return decodeURIComponent(t.slice(18));
  } catch {
    return t.slice(18);
  }
}
function ol(t, e) {
  const n = t.role ?? t.media_role ?? t.mediaRole;
  if (typeof n == "string" && il.has(n))
    return { role: n, explicit: !0 };
  const r = String(t.type ?? t.kind ?? t.media_type ?? t.mediaType ?? t.mime_type ?? "").toLowerCase();
  return r === "start_image" || r === "start-image" ? { role: "start_image", explicit: !0 } : r === "end_image" || r === "end-image" ? { role: "end_image", explicit: !0 } : r.includes("audio") ? { role: "audio", explicit: !0 } : r.includes("video") ? { role: "video", explicit: !0 } : r.includes("image") ? { role: "image", explicit: !0 } : { role: e, explicit: !1 };
}
function ll(t, e) {
  const n = t.split(/[?#]/, 1)[0].toLowerCase();
  return n.startsWith("data:audio/") || /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/.test(n) ? "audio" : n.startsWith("data:video/") || /\.(?:avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(n) ? "video" : e;
}
function ul(t) {
  return t === "video" ? "start_image" : t === "text" ? "video" : t === "audio" ? "audio" : "image";
}
function jt(t, e, n = !1) {
  if (typeof t == "string") {
    const s = sl(t).trim(), l = n ? ll(s, e) : e;
    return s ? [{ value: s, role: l }] : [];
  }
  if (Array.isArray(t))
    return t.flatMap((s) => jt(s, e, n));
  if (!t || typeof t != "object") return [];
  const r = t, i = ol(r, e);
  if (Array.isArray(r.allUrls))
    return r.allUrls.flatMap((s) => jt(
      s,
      i.role,
      n && !i.explicit
    ));
  const a = r.value ?? r.url ?? r.fileRef ?? r.path ?? r.id ?? r.uuid ?? r.media_id ?? r.mediaId ?? r.frontalImageUrl;
  return jt(
    a,
    i.role,
    n && !i.explicit
  );
}
function dl(t, e, n) {
  const r = [], i = {};
  for (const [a, s] of Object.entries(e)) {
    if (s == null) continue;
    if (a === "medias" || a === "higgsfield_media_inputs") {
      r.push(...jt(
        s,
        ul(n),
        !0
      ));
      continue;
    }
    const l = al[a];
    if (l) {
      const o = l === "legacy-image" ? n === "video" ? "start_image" : "image" : l;
      r.push(...jt(s, o));
      continue;
    }
    i[a] = s;
  }
  return {
    model: t,
    mediaType: n,
    ...r.length > 0 ? { medias: r } : {},
    ...Object.keys(i).length > 0 ? { params: i } : {}
  };
}
function cl(t) {
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
async function fl(t, e, n) {
  const r = await Cn(dl(t, e, n));
  return cl(r);
}
const Vr = "https://api.runpod.ai/v2", ml = 3e3, pl = 120;
async function yl(t, e, n) {
  if (!t) throw new Error("No RunPod endpoint ID configured for this model. Set it in the model definition.");
  const r = await fetch(`${Vr}/${t}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${n}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: e })
  });
  if (!r.ok) {
    const a = await r.json().catch(() => ({}));
    throw new Error(a.error || `RunPod error ${r.status}`);
  }
  const { id: i } = await r.json();
  for (let a = 0; a < pl; a++) {
    await new Promise((o) => setTimeout(o, ml));
    const s = await fetch(`${Vr}/${t}/status/${i}`, {
      headers: { Authorization: `Bearer ${n}` }
    });
    if (!s.ok) continue;
    const l = await s.json();
    if (l.status === "COMPLETED") {
      const o = l.output, u = (o == null ? void 0 : o.image_url) ?? (o == null ? void 0 : o.image);
      if (u && !u.startsWith("http") && !u.startsWith("local-media://")) {
        const d = u.includes(",") ? u.split(",")[1] : u, c = w.join(z.tmpdir(), `cinegen-runpod-${Date.now()}.png`);
        return await C.writeFile(c, Buffer.from(d, "base64")), { output: { ...o, image_url: `local-media://file${c}` } };
      }
      return { output: o };
    }
    if (l.status === "FAILED")
      throw new Error(l.error || "RunPod job failed");
  }
  throw new Error("RunPod job timed out");
}
async function hl(t, e, n) {
  const r = `${t.replace(/\/$/, "")}/generate/${e}`, i = await fetch(r, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: n })
  });
  if (!i.ok) {
    const a = await i.json().catch(() => ({}));
    throw new Error(a.detail || `Pod error ${i.status}`);
  }
  return await i.json();
}
async function Yr(t, e, n) {
  const r = `https://api.runpod.io/graphql?api_key=${t}`, i = n === "start" ? `mutation { podResume(input: { podId: "${e}" }) { id desiredStatus } }` : `mutation { podStop(input: { podId: "${e}" }) { id desiredStatus } }`, s = await (await fetch(r, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: i })
  })).json();
  if (s.errors)
    throw new Error(`RunPod pod ${n} failed: ${JSON.stringify(s.errors)}`);
  return s;
}
async function gl(t, e) {
  var o, u, d;
  const n = `https://api.runpod.io/graphql?api_key=${t}`, r = `{ pod(input: { podId: "${e}" }) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort type } } } }`, s = (o = (await (await fetch(n, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: r })
  })).json()).data) == null ? void 0 : o.pod;
  if (!s) throw new Error("Pod not found");
  const l = (d = (u = s.runtime) == null ? void 0 : u.ports) == null ? void 0 : d.find((c) => c.privatePort === 8e3 && c.isIpPublic);
  return {
    status: s.desiredStatus,
    ip: (l == null ? void 0 : l.ip) ?? null,
    port: (l == null ? void 0 : l.publicPort) ?? null
  };
}
function Un(t) {
  G.fal.config({ credentials: t });
}
function _l(t) {
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
async function Qr(t) {
  const e = decodeURIComponent(t.replace("local-media://file", "")), n = await C.readFile(e), r = _l(e), i = new Blob([n], { type: r }), a = new File([i], w.basename(e), { type: r });
  return G.fal.storage.upload(a);
}
async function Jt(t) {
  const e = {};
  for (const [n, r] of Object.entries(t))
    typeof r == "string" && r.startsWith("local-media://file") ? e[n] = await Qr(r) : Array.isArray(r) ? e[n] = await Promise.all(
      r.map(async (i) => typeof i == "string" && i.startsWith("local-media://file") ? Qr(i) : i && typeof i == "object" && !Array.isArray(i) ? Jt(i) : i)
    ) : r && typeof r == "object" && !Array.isArray(r) ? e[n] = await Jt(r) : e[n] = r;
  return e;
}
async function Zr(t, e, n) {
  var r;
  Un(n), console.log("[fal] Calling model:", t, "with input:", JSON.stringify(e, null, 2));
  try {
    return await G.fal.subscribe(t, { input: e, logs: !0 });
  } catch (i) {
    throw console.error("[fal] Error details:", JSON.stringify((i == null ? void 0 : i.body) ?? i, null, 2)), (r = i == null ? void 0 : i.body) != null && r.detail && console.error("[fal] Validation errors:", JSON.stringify(i.body.detail, null, 2)), i;
  }
}
function wl() {
  I.handle("workflow:run", async (e, n) => {
    const {
      apiKey: r,
      kieKey: i,
      runpodKey: a,
      runpodEndpointId: s,
      podUrl: l,
      nodeId: o,
      nodeType: u,
      modelId: d,
      outputType: c,
      inputs: m
    } = n, { ALL_MODELS: f, resolveVideoModelEndpoint: h, sanitizeVideoInputsForEndpoint: _ } = await import("./models-Cz1uS08F.js"), y = f[d] ?? Object.values(f).find(
      (v) => v.id === d || v.altId === d || v.nodeType === d
    );
    if (!y) {
      if (d.startsWith("fal-ai/")) {
        const v = r;
        if (!v) throw new Error("No fal.ai API key provided. Add one in Settings.");
        Un(v);
        const j = await Jt(m), N = await Zr(d, j, v);
        return N.data ?? N;
      }
      throw new Error(`Unknown model: ${d}`);
    }
    const p = y.provider;
    let g = m;
    p !== "higgsfield" && (r && Un(r), g = await Jt(m));
    let b = d.includes("/") ? d : y.id;
    const E = y.nodeType ?? d, T = Object.keys(g).some(
      (v) => v === "image_url" || v === "start_image_url" || v === "image_urls" || v === "imageUrl"
    );
    b = h(E, y, {
      hasImageInputs: T,
      quality: g.quality
    }), _(E, b, g);
    let S;
    if (p === "kie") {
      const v = i;
      if (!v) throw new Error("No kie.ai API key provided. Add one in Settings.");
      S = await rl(b, g, v);
    } else if (p === "pod") {
      if (!l) throw new Error("No pod URL configured. Start your pod and set the URL in Settings.");
      const v = y.podRoute ?? b;
      S = await hl(l, v, g);
    } else if (p === "runpod") {
      const v = a;
      if (!v) throw new Error("No RunPod API key provided. Add one in Settings.");
      const j = s || y.runpodEndpointId || "";
      S = await yl(j, g, v);
    } else if (p === "higgsfield") {
      const v = y.outputType;
      S = await fl(b, g, c ?? (v === "video" ? "video" : v === "audio" ? "audio" : v === "text" ? "text" : v === "3d" || v === "model3d" || v === "model" ? "3d" : "image"));
    } else {
      const v = r;
      if (!v) throw new Error("No fal.ai API key provided. Add one in Settings.");
      S = await Zr(b, g, v);
    }
    return S.data ?? S;
  });
  const t = /* @__PURE__ */ new Map();
  I.handle("workflow:poll-job", async (e, n) => {
    const r = t.get(n);
    if (!r) throw new Error("Job not found");
    return r;
  }), I.handle("pod:start", async (e, n) => await Yr(n.runpodKey, n.podId, "start")), I.handle("pod:stop", async (e, n) => await Yr(n.runpodKey, n.podId, "stop")), I.handle("pod:status", async (e, n) => await gl(n.runpodKey, n.podId));
}
const ua = Ii(import.meta.url);
function da(t) {
  return J.isPackaged ? t.replace("app.asar", "app.asar.unpacked") : t;
}
function ge() {
  const t = ua("ffmpeg-static");
  return da(t);
}
function ca() {
  const t = ua("ffprobe-static").path;
  return da(t);
}
function fa() {
  if (J.isPackaged)
    return w.join(process.resourcesPath, "vendor", "fpcalc");
  const t = w.dirname(Wn(import.meta.url));
  return w.resolve(t, "..", "vendor", "fpcalc", "fpcalc");
}
const ei = {
  draft: { crf: 28, scale: 0.5 },
  standard: { crf: 20, scale: 1 },
  high: { crf: 16, scale: 1 }
}, re = /* @__PURE__ */ new Map(), qt = /* @__PURE__ */ new Map();
function bl(t, e) {
  for (const n of V.getAllWindows())
    n.webContents.send("export:progress", { jobId: t, progress: e });
}
function El(t, e) {
  const n = t.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
  if (!n) return null;
  const r = parseInt(n[1], 10), i = parseInt(n[2], 10), a = parseInt(n[3], 10), s = parseInt(n[4], 10) / 100, l = r * 3600 + i * 60 + a + s;
  return e > 0 ? Math.min(100, l / e * 100) : 0;
}
async function vl(t, e) {
  const n = re.get(t);
  if (!n) return;
  const r = ge(), i = ei[e.preset || "standard"] || ei.standard, a = e.fps || 30, s = e.outputPath || w.join(process.cwd(), `export_${t}.mp4`);
  re.set(t, { ...n, status: "rendering" });
  const l = e.clips.filter(
    (m) => (m.type === "video" || m.type === "image") && m.inputPath
  );
  if (l.length === 0) {
    re.set(t, { ...n, status: "failed", error: "No video clips to export" });
    return;
  }
  const o = [];
  for (const m of l)
    m.trimStart > 0 && o.push("-ss", String(m.trimStart)), o.push("-t", String(m.duration / (m.speed || 1))), o.push("-i", m.inputPath);
  const u = [];
  for (let m = 0; m < l.length; m++) {
    const f = l[m], h = f.speed || 1, _ = f.volume ?? 1, y = [];
    h !== 1 && y.push(`setpts=${(1 / h).toFixed(4)}*PTS`), i.scale !== 1 && y.push(`scale=iw*${i.scale}:ih*${i.scale}`), y.push(`fps=${a}`), u.push(`[${m}:v]${y.join(",")}[v${m}]`);
    const p = f.duration / h;
    if (f.type === "image")
      u.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${p.toFixed(4)}[a${m}]`);
    else {
      const g = [];
      h !== 1 && g.push(`atempo=${h}`), _ !== 1 && g.push(`volume=${_}`), g.length > 0 ? u.push(`[${m}:a]${g.join(",")}[a${m}]`) : u.push(`[${m}:a]anull[a${m}]`);
    }
  }
  const d = l.map((m, f) => `[v${f}]`).join(""), c = l.map((m, f) => `[a${f}]`).join("");
  return u.push(
    `${d}${c}concat=n=${l.length}:v=1:a=1[outv][outa]`
  ), o.push("-filter_complex", u.join(";")), o.push("-map", "[outv]", "-map", "[outa]"), o.push("-c:v", "libx264", "-crf", String(i.crf), "-preset", "fast"), o.push("-c:a", "aac", "-b:a", "192k"), o.push("-y", s), new Promise((m, f) => {
    var y;
    const h = ne(r, o);
    qt.set(t, h);
    let _ = "";
    (y = h.stderr) == null || y.on("data", (p) => {
      _ += p.toString();
      const g = _.split("\r"), b = g[g.length - 1] || g[g.length - 2];
      if (b) {
        const E = El(b, e.totalDuration);
        if (E !== null) {
          const T = re.get(t);
          T && (re.set(t, { ...T, progress: E }), bl(t, E));
        }
      }
      _.length > 2048 && (_ = _.slice(-1024));
    }), h.on("close", (p) => {
      qt.delete(t);
      const g = re.get(t);
      if (!g) {
        m();
        return;
      }
      if (p === 0) {
        let b;
        try {
          b = F.statSync(s).size;
        } catch {
        }
        re.set(t, {
          ...g,
          status: "complete",
          progress: 100,
          outputUrl: s,
          fileSize: b,
          completedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else
        re.set(t, {
          ...g,
          status: "failed",
          error: `ffmpeg exited with code ${p}`
        });
      m();
    }), h.on("error", (p) => {
      qt.delete(t);
      const g = re.get(t);
      g && re.set(t, { ...g, status: "failed", error: p.message }), f(p);
    });
  });
}
function Tl() {
  I.handle("export:start", async (t, e) => {
    const { preset: n = "standard", fps: r = 30 } = e, i = {
      id: K.randomUUID(),
      status: "queued",
      progress: 0,
      preset: n,
      fps: r,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return re.set(i.id, i), vl(i.id, e).catch((a) => {
      console.error("[export] Render failed:", a);
    }), i;
  }), I.handle("export:poll", async (t, e) => {
    const n = re.get(e);
    if (!n) throw new Error("Export not found");
    return n;
  }), I.handle("export:cancel", async (t, e) => {
    const n = qt.get(e);
    n && (n.kill("SIGTERM"), qt.delete(e));
    const r = re.get(e);
    if (r && (re.set(e, { ...r, status: "failed", error: "Cancelled by user" }), r.outputUrl))
      try {
        F.unlinkSync(r.outputUrl);
      } catch {
      }
    return { ok: !0 };
  });
}
const Sl = {
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
function En(t) {
  const e = w.extname(t).toLowerCase();
  return Sl[e] ?? "application/octet-stream";
}
function ti(t) {
  try {
    const e = new URL(t);
    if (e.protocol !== "local-media:" || e.hostname !== "file") return null;
    let n = decodeURIComponent(e.pathname);
    return process.platform === "win32" && n.startsWith("/") && (n = n.slice(1)), w.normalize(n);
  } catch {
    return null;
  }
}
async function xl(t) {
  const e = w.join(
    z.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), n = ge(), r = [
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
  return await new Promise((i, a) => {
    var o;
    const s = ne(n, r, { stdio: ["ignore", "ignore", "pipe"] });
    let l = "";
    (o = s.stderr) == null || o.on("data", (u) => {
      l += u.toString();
    }), s.on("error", a), s.on("close", (u) => {
      if (u === 0) {
        i();
        return;
      }
      a(new Error(l.trim() || `ffmpeg exited with code ${u}`));
    });
  }), e;
}
function jl() {
  I.handle(
    "elements:upload",
    async (t, e, n) => {
      if (!n) throw new Error("No API key provided");
      G.fal.config({ credentials: n });
      const r = new Blob([e.buffer], { type: e.type }), i = new File([r], e.name, { type: e.type });
      return { url: await G.fal.storage.upload(i) };
    }
  ), I.handle(
    "elements:upload-transcription-source",
    async (t, e, n) => {
      if (!n) throw new Error("No API key provided");
      const r = ti(e);
      if (!r) {
        if (e.startsWith("http://") || e.startsWith("https://"))
          return { url: e };
        throw new Error("Transcription upload requires a local-media or remote URL source");
      }
      G.fal.config({ credentials: n });
      const i = await xl(r);
      try {
        const a = await C.readFile(i), l = `${w.basename(r, w.extname(r))}.m4a`, o = En(i), u = new Blob([a], { type: o }), d = new File([u], l, { type: o });
        return { url: await G.fal.storage.upload(d) };
      } finally {
        await C.unlink(i).catch(() => {
        });
      }
    }
  ), I.handle(
    "elements:upload-media-source",
    async (t, e, n) => {
      if (!n) throw new Error("No API key provided");
      G.fal.config({ credentials: n });
      const r = ti(e);
      if (r) {
        const i = await C.readFile(r), a = w.basename(r), s = En(r), l = new Blob([i], { type: s }), o = new File([l], a, { type: s });
        return { url: await G.fal.storage.upload(o) };
      }
      if (e.startsWith("data:"))
        return { url: e };
      if (e.startsWith("http://") || e.startsWith("https://")) {
        const i = await import("node:os");
        await import("node:fs");
        const a = w.extname(new URL(e).pathname) || ".mp4", s = w.join(i.tmpdir(), `cinegen-upload-${Date.now()}${a}`);
        try {
          const f = await fetch(e);
          if (!f.ok)
            throw new Error(`Remote file unavailable (HTTP ${f.status}). The URL may have expired. Try re-importing the asset.`);
          const h = await f.arrayBuffer();
          await C.writeFile(s, Buffer.from(h));
        } catch (f) {
          throw new Error(
            f instanceof Error ? f.message : "Failed to download remote media. The URL may have expired."
          );
        }
        const l = await C.readFile(s), o = w.basename(s), u = En(s), d = new Blob([l], { type: u }), c = new File([d], o, { type: u }), m = await G.fal.storage.upload(c);
        return await C.unlink(s).catch(() => {
        }), { url: m };
      }
      throw new Error("Media upload requires a local-media, remote URL, or data URI source");
    }
  );
}
const ql = `
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
`, Il = `
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
function He() {
  return w.join(z.homedir(), "Documents", "CINEGEN");
}
function $e(t) {
  return w.join(He(), t);
}
function vt() {
  return K.randomUUID();
}
function It() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function ma(t) {
  const e = $e(t), n = [
    w.join(e, "media", "generated"),
    w.join(e, "media", "imported"),
    w.join(e, ".cache", "thumbnails"),
    w.join(e, ".cache", "filmstrips"),
    w.join(e, ".cache", "waveforms"),
    w.join(e, ".cache", "proxies")
  ];
  for (const r of n)
    F.mkdirSync(r, { recursive: !0 });
}
class Al {
  constructor(e) {
    ma(e);
    const n = w.join($e(e), "project.db");
    this.db = new Hn(n), this.db.pragma("journal_mode = WAL"), this.db.pragma("foreign_keys = ON"), this.initSchema();
  }
  /**
   * Runs SCHEMA_SQL and INDEXES_SQL to create all tables and indexes if they
   * do not already exist.
   */
  initSchema() {
    this.db.exec(ql), this.db.exec(Il);
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
function pa() {
  return { version: 1, folders: [], elements: [] };
}
function ya(t) {
  if (!t || typeof t != "object") return null;
  const e = t, n = typeof e.id == "string" ? e.id : "";
  if (!n) return null;
  const r = e.type === "character" || e.type === "location" || e.type === "prop" || e.type === "vehicle" ? e.type : "character", i = typeof e.folderId == "string" && e.folderId ? e.folderId : typeof e.folder_id == "string" && e.folder_id ? e.folder_id : void 0;
  return {
    id: n,
    name: typeof e.name == "string" ? e.name : "Untitled",
    type: r,
    description: typeof e.description == "string" ? e.description : "",
    images: kl(e.images),
    createdAt: typeof e.createdAt == "string" ? e.createdAt : typeof e.created_at == "string" ? e.created_at : "",
    updatedAt: typeof e.updatedAt == "string" ? e.updatedAt : typeof e.updated_at == "string" ? e.updated_at : "",
    folderId: i
  };
}
function kl(t) {
  let e = t;
  if (typeof e == "string")
    try {
      e = JSON.parse(e);
    } catch {
      return [];
    }
  return Array.isArray(e) ? e.flatMap((n) => {
    if (!n || typeof n != "object") return [];
    const r = n;
    return typeof r.id != "string" || typeof r.url != "string" ? [] : [{
      id: r.id,
      url: r.url,
      createdAt: typeof r.createdAt == "string" ? r.createdAt : "",
      source: r.source === "generated" ? "generated" : "upload"
    }];
  }) : [];
}
function Rl(t) {
  if (!t || typeof t != "object") return null;
  const e = t, n = typeof e.id == "string" ? e.id : "";
  if (!n) return null;
  const r = typeof e.sourceProjectId == "string" && e.sourceProjectId ? e.sourceProjectId : void 0;
  return {
    id: n,
    name: typeof e.name == "string" && e.name.trim() ? e.name.trim() : "Untitled",
    createdAt: typeof e.createdAt == "string" ? e.createdAt : (/* @__PURE__ */ new Date()).toISOString(),
    sourceProjectId: r
  };
}
function ha(t) {
  if (!t || typeof t != "object") return pa();
  const e = t, n = Array.isArray(e.folders) ? e.folders.map(Rl).filter((a) => a !== null) : [], r = new Set(n.map((a) => a.id)), i = Array.isArray(e.elements) ? e.elements.map(ya).filter((a) => a !== null) : [];
  return {
    version: 1,
    folders: n,
    elements: i.map((a) => a.folderId && !r.has(a.folderId) ? { ...a, folderId: void 0 } : a)
  };
}
function Ol(t, e) {
  const n = pa(), r = new Map(n.elements.map((a) => [a.id, a])), i = [...n.folders];
  for (const a of e) {
    const s = a.elements.map(ya).filter((o) => o !== null);
    if (s.length === 0) continue;
    let l = i.find((o) => o.sourceProjectId === a.id);
    l || (l = {
      id: crypto.randomUUID(),
      name: a.name.trim() || "Untitled project",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceProjectId: a.id
    }, i.push(l));
    for (const o of s)
      r.has(o.id) || r.set(o.id, { ...o, folderId: o.folderId && i.some((u) => u.id === o.folderId) ? o.folderId : l.id });
  }
  return { version: 1, folders: i, elements: [...r.values()] };
}
function Nl(t, e, n) {
  const r = n.trim() || "Untitled project", i = t.folders.find((a) => a.sourceProjectId === e);
  if (!i) {
    const a = {
      id: crypto.randomUUID(),
      name: r,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceProjectId: e
    };
    return { ...t, folders: [...t.folders, a] };
  }
  return i.name === r ? t : {
    ...t,
    folders: t.folders.map((a) => a.id === i.id ? { ...a, name: r } : a)
  };
}
function ga() {
  return w.join(He(), "elements-library.json");
}
function Pl() {
  return w.join(He(), "projects.json");
}
function ni(t) {
  return w.join(He(), t);
}
async function Ln(t) {
  await C.mkdir(He(), { recursive: !0 });
  const e = ga(), n = `${e}.tmp`;
  await C.writeFile(n, JSON.stringify(t, null, 2), "utf-8"), await C.rename(n, e);
}
async function Cl() {
  try {
    const t = await C.readFile(ga(), "utf-8");
    return ha(JSON.parse(t));
  } catch {
    return null;
  }
}
function Ul(t) {
  const e = w.join(ni(t.id), "project.db"), n = w.join(ni(t.id), "project.json");
  if (t.useSqlite || F.existsSync(e))
    try {
      const r = new Hn(e, { readonly: !0 }), i = r.prepare("SELECT * FROM elements").all();
      return r.close(), { id: t.id, name: t.name, elements: i };
    } catch {
      return { id: t.id, name: t.name, elements: [] };
    }
  if (F.existsSync(n))
    try {
      const r = JSON.parse(F.readFileSync(n, "utf-8"));
      return { id: t.id, name: t.name, elements: Array.isArray(r.elements) ? r.elements : [] };
    } catch {
      return { id: t.id, name: t.name, elements: [] };
    }
  return { id: t.id, name: t.name, elements: [] };
}
async function Ll() {
  const t = await Cl();
  if (t) return t;
  let e = [];
  try {
    const i = JSON.parse(await C.readFile(Pl(), "utf-8"));
    e = Array.isArray(i.projects) ? i.projects : [];
  } catch {
    e = [];
  }
  const n = e.map(Ul), r = Ol(null, n);
  return await Ln(r), r;
}
function Dl() {
  I.handle(
    "elements-library:load",
    async (t, e) => {
      let n = await Ll();
      if (e != null && e.projectId && e.projectName) {
        const r = Nl(n, e.projectId, e.projectName);
        r !== n && (await Ln(r), n = r);
      }
      return n;
    }
  ), I.handle("elements-library:save", async (t, e) => {
    const n = ha(e);
    return await Ln(n), n;
  });
}
const ri = {
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
}, _a = {
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
function Ml(t) {
  return t ? { ...ri, ..._a[t].weights } : ri;
}
function ii(t, e) {
  if (!t) return !1;
  const n = t.toLowerCase();
  return e.some((r) => n.includes(r.toLowerCase()));
}
function Fl(t, e, n) {
  const r = Ml(n.persona), i = n.persona ? _a[n.persona] : void 0, a = [];
  let s = 0;
  if (e.length === 0)
    s += t.words.length > 0 ? 3 : 1;
  else {
    const l = t.text.toLowerCase(), o = `${t.assetName} ${t.text} ${t.words.map((d) => d.word).join(" ")}`.toLowerCase();
    let u = 0;
    for (const d of e)
      o.includes(d) && (u += 1, s += l.includes(d) ? r.termInText : r.termElsewhere);
    u > 0 && a.push(`matched ${e.slice(0, 4).join(", ")}`);
  }
  return t.timelinePlacements.some((l) => l.timelineId === n.activeTimelineId) && n.activeTimelineId && (s += r.activeTimeline, a.push("already on the active timeline")), t.words.length > 0 && (s += r.wordTiming), t.emotion && (s += r.hasEmotion), t.delivery && (s += r.hasDelivery, a.push("has vocal delivery notes")), i && (ii(t.energy, i.preferredEnergy) && (s += r.energyMatch, a.push(`${t.energy} energy fits ${n.persona}`)), ii(t.pace, i.preferredPace) && (s += r.paceMatch, a.push(`${t.pace} pace fits ${n.persona}`)), t.emotion && i.emotionBias.some((l) => t.emotion.toLowerCase().includes(l)) && (s += r.emotionBias, a.push(`${t.emotion} emotion favored by ${n.persona}`))), t.emotion && n.queryEmotions.some((l) => t.emotion.toLowerCase().includes(l) || l.includes(t.emotion.toLowerCase())) && (s += r.emotionQueryMatch, a.push(`emotion (${t.emotion}) matches the query`)), t.notable && t.notable.length > 0 && (s += r.notableSignal * t.notable.length, a.push(`notable: ${t.notable.slice(0, 2).join("; ")}`)), { score: s, reasons: a };
}
function $l(t) {
  const { query: e, brief: n, candidates: r } = t, i = r.map((a) => `- ${a.id}: ${a.text.replace(/\s+/g, " ").slice(0, 160)}`);
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
function Bl(t) {
  var s;
  const e = t.trim();
  if (!e) return null;
  const n = (l) => {
    try {
      return JSON.parse(l), l;
    } catch {
      return null;
    }
  }, r = n(e);
  if (r) return r;
  for (const l of e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const o = (s = l[1]) == null ? void 0 : s.trim();
    if (o && n(o)) return o;
  }
  const i = e.indexOf("{"), a = e.lastIndexOf("}");
  if (i !== -1 && a > i) {
    const l = e.slice(i, a + 1);
    if (n(l)) return l;
  }
  return null;
}
function Hl(t, e) {
  const n = Bl(e);
  if (!n) return t;
  let r;
  try {
    r = JSON.parse(n);
  } catch {
    return t;
  }
  const i = r.order;
  if (!Array.isArray(i) || i.length === 0) return t;
  const a = new Map(t.map((o) => [o.id, o])), s = /* @__PURE__ */ new Set(), l = [];
  for (const o of i) {
    if (typeof o != "string") continue;
    const u = a.get(o);
    u && !s.has(o) && (l.push(u), s.add(o));
  }
  for (const o of t)
    s.has(o.id) || l.push(o);
  return l;
}
function Wl(t) {
  return [...new Set(
    t.toLowerCase().split(/[^a-z0-9']+/).map((e) => e.trim()).filter((e) => e.length >= 3)
  )];
}
const zl = [
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
function Gl(t) {
  const e = t.toLowerCase();
  return zl.filter((n) => e.includes(n));
}
function Jl(t, e, n = 24) {
  const r = typeof n == "number" ? { limit: n } : n, i = r.limit ?? 24, a = Wl(e), s = {
    activeTimelineId: t.activeTimelineId,
    persona: r.persona,
    queryEmotions: Gl(e)
  };
  return t.moments.map((l) => ({ moment: l, ...Fl(l, a, s) })).filter((l) => l.score > 0).sort((l, o) => o.score - l.score || l.moment.sourceStart - o.moment.sourceStart).slice(0, i).map(({ moment: l, score: o, reasons: u }) => ({
    id: l.id,
    assetId: l.assetId,
    assetName: l.assetName,
    text: l.text,
    sourceStart: l.sourceStart,
    sourceEnd: l.sourceEnd,
    words: l.words.slice(0, 32),
    timelinePlacements: l.timelinePlacements,
    score: o,
    reason: u.length > 0 ? `${u.slice(0, 3).join("; ")}.` : `${l.words.length > 0 ? "Word-level" : "Segment-level"} transcript candidate.`
  }));
}
const qe = "google/gemini-2.5-flash";
function Ke(t, e, n) {
  return Math.min(n, Math.max(e, t));
}
function vn(t) {
  try {
    return JSON.parse(t), t;
  } catch {
    return null;
  }
}
function de(t) {
  return typeof t == "string" ? t : Array.isArray(t) ? t.map((e) => de(e)).filter(Boolean).join(`
`) : t && typeof t == "object" ? Object.values(t).map((e) => de(e)).filter(Boolean).join(`
`) : "";
}
function X(t) {
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
function wa(t) {
  var a;
  const e = t.trim();
  if (!e) return null;
  const n = vn(e);
  if (n) return n;
  const r = [...e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const s of r) {
    const l = (a = s[1]) == null ? void 0 : a.trim();
    if (!l) continue;
    const o = vn(l);
    if (o) return o;
  }
  const i = /* @__PURE__ */ new Map([
    ["{", "}"],
    ["[", "]"]
  ]);
  for (let s = 0; s < e.length; s++) {
    const l = e[s], o = i.get(l);
    if (!o) continue;
    const u = [o];
    let d = !1, c = !1;
    for (let m = s + 1; m < e.length; m++) {
      const f = e[m];
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
      const h = i.get(f);
      if (h) {
        u.push(h);
        continue;
      }
      if (f === u[u.length - 1]) {
        if (u.pop(), u.length === 0) {
          const _ = e.slice(s, m + 1), y = vn(_);
          if (y) return y;
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
function Kl(t) {
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
function Xl(t) {
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
async function tn(t, e) {
  if (/^https?:\/\//.test(e)) return e;
  if (e.startsWith("data:")) {
    const l = e.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
    if (!l) return null;
    const o = l[1] || "application/octet-stream", u = l[3] || "", d = l[2] ? Buffer.from(u, "base64") : Buffer.from(decodeURIComponent(u), "utf8"), c = new Blob([d], { type: o }), m = new File([c], `auto-segment.${o.split("/")[1] || "bin"}`, { type: o });
    return G.fal.config({ credentials: t }), G.fal.storage.upload(m);
  }
  const n = Xl(e);
  if (!n) return null;
  const r = await C.readFile(n), i = Kl(n), a = new Blob([r], { type: i }), s = new File([a], w.basename(n), { type: i });
  return G.fal.config({ credentials: t }), G.fal.storage.upload(s);
}
async function Vl(t, e) {
  return tn(t, e);
}
function ai(t, e) {
  const r = (Array.isArray(t.objects) ? t.objects : Array.isArray(t.detections) ? t.detections : Array.isArray(t.items) ? t.items : Array.isArray(t.regions) ? t.regions : Array.isArray(t.subjects) ? t.subjects : typeof t.label == "string" || typeof t.name == "string" || typeof t.object == "string" ? [t] : []).map((a) => {
    if (!a || typeof a != "object") return null;
    const s = a, l = [
      s.label,
      s.name,
      s.object,
      s.subject,
      s.class,
      s.type
    ].find((x) => typeof x == "string" && x.trim()), o = typeof l == "string" ? l.trim() : "";
    if (!o) return null;
    let u = null, d = null, c = null, m = null;
    const f = Array.isArray(s.box) ? s.box : Array.isArray(s.cxcywh) ? s.cxcywh : null;
    f && f.length >= 4 && (u = X(f[0]), d = X(f[1]), c = X(f[2]), m = X(f[3]));
    const h = Array.isArray(s.bbox) ? s.bbox : Array.isArray(s.bounds) ? s.bounds : Array.isArray(s.rect) ? s.rect : Array.isArray(s.xyxy) ? s.xyxy : null;
    if ((u === null || d === null || c === null || m === null) && h && h.length >= 4) {
      const x = X(h[0]), v = X(h[1]), j = X(h[2]), N = X(h[3]);
      [x, v, j, N].every((O) => O !== null) && (u = (x + j) / 2, d = (v + N) / 2, c = j - x, m = N - v);
    }
    const _ = Array.isArray(s.box_3d) ? s.box_3d : Array.isArray(s.box3d) ? s.box3d : null;
    if ((u === null || d === null || c === null || m === null) && _ && _.length >= 6) {
      const x = X(_[0]), v = X(_[1]), j = X(_[3]), N = X(_[4]), O = X(_[5]);
      [x, v, j, N, O].every((L) => L !== null) && (u = x, d = v, c = Math.max(j, N), m = Math.max(N, O));
    }
    if (u === null || d === null || c === null || m === null) {
      const x = X(s.center_x ?? s.cx ?? s.mid_x), v = X(s.center_y ?? s.cy ?? s.mid_y), j = X(s.width ?? s.w), N = X(s.height ?? s.h);
      [x, v, j, N].every((O) => O !== null) && (u = x, d = v, c = j, m = N);
    }
    if (u === null || d === null || c === null || m === null) {
      const x = X(s.x_min ?? s.left), v = X(s.y_min ?? s.top), j = X(s.x_max ?? s.right), N = X(s.y_max ?? s.bottom);
      [x, v, j, N].every((O) => O !== null) && (u = (x + j) / 2, d = (v + N) / 2, c = j - x, m = N - v);
    }
    if ([u, d, c, m].some((x) => x === null || !Number.isFinite(x))) return null;
    const y = Ke(c, 0.02, 1), p = Ke(m, 0.02, 1), g = [
      Ke(u, y / 2, 1 - y / 2),
      Ke(d, p / 2, 1 - p / 2),
      y,
      p
    ], b = X(s.score ?? s.confidence ?? s.probability), E = b !== null ? Ke(b, 0, 1) : 0.75, T = X(s.priority ?? s.salience ?? s.importance), S = T !== null ? Ke(T, 0, 1) : E;
    return {
      label: o,
      box: g,
      score: E,
      priority: S
    };
  }).filter((a) => !!a).sort((a, s) => s.priority - a.priority || s.score - a.score), i = [];
  for (const a of r)
    if (i.some((l) => {
      const o = l.label.toLowerCase() === a.label.toLowerCase(), u = Math.abs(l.box[0] - a.box[0]), d = Math.abs(l.box[1] - a.box[1]), c = Math.abs(l.box[2] - a.box[2]), m = Math.abs(l.box[3] - a.box[3]);
      return o && u < 0.06 && d < 0.06 && c < 0.08 && m < 0.08;
    }) || i.push(a), i.length >= e) break;
  return i;
}
function Ht(t) {
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
        const a = Ht(r[i]);
        if (a) return a;
      }
  }
  const e = de(t);
  if (!e) return null;
  const n = wa(e);
  if (!n) return null;
  try {
    const r = JSON.parse(n);
    return Array.isArray(r) ? { objects: r } : r && typeof r == "object" ? r : null;
  } catch {
    return null;
  }
}
async function si(t, e, n, r, i) {
  G.fal.config({ credentials: t });
  const s = (await G.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: n,
      prompt: i,
      image_urls: [e],
      max_tokens: 700
    },
    logs: !0
  })).data, l = Ht(s.output) ?? Ht(s.text) ?? Ht(s);
  return l || console.warn("[vision:auto-seg] Could not extract object JSON from vision response", {
    outputPreview: de(s.output || s.text || s).slice(0, 1e3),
    maxObjects: r
  }), l;
}
async function ba(t) {
  var s, l, o, u, d;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = (await Promise.all(
    t.framePaths.slice(0, 6).map((c) => tn(t.apiKey, c).catch(() => null))
  )).filter((c) => !!c);
  if (e.length === 0)
    return {
      assetId: t.assetId,
      status: "missing",
      model: ((s = t.model) == null ? void 0 : s.trim()) || qe,
      error: "No visual frames were available to upload for analysis."
    };
  G.fal.config({ credentials: t.apiKey });
  const r = (await G.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((l = t.model) == null ? void 0 : l.trim()) || qe,
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
  })).data, i = de(r.output) || de(r.text) || "", a = wa(i);
  if (!a)
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((o = t.model) == null ? void 0 : o.trim()) || qe,
      error: "Vision analysis did not return valid JSON."
    };
  try {
    const c = JSON.parse(a);
    return {
      assetId: t.assetId,
      status: "ready",
      summary: typeof c.summary == "string" ? c.summary.trim() : void 0,
      tone: Array.isArray(c.tone) ? c.tone.filter((m) => typeof m == "string") : void 0,
      pacing: typeof c.pacing == "string" ? c.pacing.trim() : void 0,
      shotTypes: Array.isArray(c.shotTypes) ? c.shotTypes.filter((m) => typeof m == "string") : void 0,
      subjects: Array.isArray(c.subjects) ? c.subjects.filter((m) => typeof m == "string") : void 0,
      brollIdeas: Array.isArray(c.brollIdeas) ? c.brollIdeas.filter((m) => typeof m == "string") : void 0,
      confidence: typeof c.confidence == "number" && Number.isFinite(c.confidence) ? c.confidence : void 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      model: ((u = t.model) == null ? void 0 : u.trim()) || qe,
      sourceFrameCount: e.length
    };
  } catch {
    return {
      assetId: t.assetId,
      status: "failed",
      model: ((d = t.model) == null ? void 0 : d.trim()) || qe,
      error: "Vision analysis JSON parse failed."
    };
  }
}
async function Ea(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await Vl(t.apiKey, t.videoPath).catch(() => null);
  if (!e)
    throw new Error("Could not upload the video file for analysis.");
  G.fal.config({ credentials: t.apiKey });
  const r = (await G.fal.subscribe("fal-ai/video-understanding", {
    input: {
      video_url: e,
      prompt: t.prompt.trim() || "Describe this video in detail.",
      detailed_analysis: t.detailedAnalysis ?? !0
    },
    logs: !0
  })).data, i = de(r.output) || de(r.text) || de(r.description) || de(r);
  if (!i.trim())
    throw new Error("Video analysis returned an empty response.");
  return i.trim();
}
async function Yl(t) {
  var a;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = await tn(t.apiKey, t.imagePath).catch(() => null);
  if (!e)
    throw new Error("Could not upload the image file for analysis.");
  G.fal.config({ credentials: t.apiKey });
  const r = (await G.fal.subscribe("fal-ai/any-llm/vision", {
    input: {
      model: ((a = t.model) == null ? void 0 : a.trim()) || qe,
      prompt: t.prompt.trim() || "Describe this image in detail.",
      image_urls: [e],
      max_tokens: 900
    },
    logs: !0
  })).data, i = de(r.output) || de(r.text) || de(r);
  if (!i.trim())
    throw new Error("Image analysis returned an empty response.");
  return i.trim();
}
async function Ql(t) {
  var s, l;
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = Math.min(12, Math.max(1, Math.round(t.maxObjects ?? 6))), n = await tn(t.apiKey, t.imagePath).catch(() => null);
  if (!n)
    return {
      status: "missing",
      model: ((s = t.model) == null ? void 0 : s.trim()) || qe,
      objects: [],
      error: "No image was available to upload for auto segmentation."
    };
  const r = ((l = t.model) == null ? void 0 : l.trim()) || qe, i = [
    "You are preparing object proposals for a promptable segmentation model.",
    t.context ? `Context: ${t.context}` : null,
    'Return compact JSON only with this shape: {"objects":[{"label":"person","box":[0.52,0.48,0.28,0.7],"score":0.96,"priority":0.99}]}',
    "Each object must include a normalized box in [center_x, center_y, width, height] with values between 0 and 1.",
    `List up to ${e} distinct, mask-worthy objects.`,
    "Prefer people, faces, pets, products, props, vehicles, furniture, signs, devices, and other clearly isolated subjects.",
    "Include partially visible or cropped people, cars, trucks, bikes, and handheld objects if they are recognizably present.",
    "Do not return an empty list unless there are truly no identifiable objects in the frame."
  ].filter(Boolean).join(`
`), a = [
    "Retry object proposal extraction for image segmentation.",
    t.context ? `Context: ${t.context}` : null,
    "Be less selective. Return the most salient visible objects even if they are partially cropped, small, or overlapping.",
    'Return strict JSON only: {"objects":[{"label":"car","box":[0.5,0.5,0.4,0.3],"score":0.81,"priority":0.8}]}',
    `Return between 1 and ${e} objects whenever any recognizable object exists.`
  ].filter(Boolean).join(`
`);
  try {
    const o = await si(t.apiKey, n, r, e, i), u = o ? ai(o, e) : [];
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
    const d = await si(t.apiKey, n, r, e, a), c = d ? ai(d, e) : [];
    return c.length > 0 ? (console.info("[vision:auto-seg] Retry object proposals", {
      model: r,
      count: c.length,
      objects: c,
      context: t.context ?? null
    }), {
      status: "ready",
      model: r,
      objects: c
    }) : (console.warn("[vision:auto-seg] No usable objects found after both prompts", {
      model: r,
      primaryKeys: o ? Object.keys(o).slice(0, 12) : [],
      retryKeys: d ? Object.keys(d).slice(0, 12) : [],
      primaryPreview: o ? JSON.stringify(o).slice(0, 1e3) : "",
      retryPreview: d ? JSON.stringify(d).slice(0, 1e3) : "",
      context: t.context ?? null
    }), {
      status: "ready",
      model: r,
      objects: []
    });
  } catch (o) {
    const u = o instanceof Error ? o.message : String(o);
    return console.error("[vision:auto-seg] Detection failed", {
      model: r,
      context: t.context ?? null,
      error: u,
      stack: o instanceof Error ? o.stack : void 0
    }), {
      status: "failed",
      model: r,
      objects: [],
      error: u || "Vision auto-segmentation failed."
    };
  }
}
function Zl() {
  I.handle("vision:index-asset", async (t, e) => ba(e)), I.handle("vision:detect-objects", async (t, e) => Ql(e));
}
const eu = "anthropic/claude-sonnet-4.6";
function te(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : null;
}
function tu(t) {
  if (!t || typeof t != "object") return;
  const e = t, n = te(e.prompt_tokens) ?? 0, r = te(e.completion_tokens) ?? 0, i = te(e.total_tokens) ?? n + r, a = te(e.cost) ?? 0;
  if (!(n <= 0 && r <= 0 && i <= 0 && a <= 0))
    return { promptTokens: n, completionTokens: r, totalTokens: i, cost: a };
}
function At(t, e) {
  return t ? e ? {
    promptTokens: t.promptTokens + e.promptTokens,
    completionTokens: t.completionTokens + e.completionTokens,
    totalTokens: t.totalTokens + e.totalTokens,
    cost: t.cost + e.cost
  } : t : e;
}
function nu(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
async function rt(t) {
  var a;
  G.fal.config({ credentials: t.apiKey });
  const e = {
    model: ((a = t.model) == null ? void 0 : a.trim()) || eu,
    prompt: t.prompt,
    max_tokens: Number.isFinite(t.maxTokens) ? Math.max(1, Math.floor(t.maxTokens)) : 1600
  };
  typeof t.systemPrompt == "string" && t.systemPrompt.trim() && (e.system_prompt = t.systemPrompt.trim()), typeof t.temperature == "number" && Number.isFinite(t.temperature) && (e.temperature = t.temperature);
  const r = (await G.fal.subscribe("openrouter/router", { input: e, logs: !0 })).data;
  return {
    message: (typeof r.output == "string" ? r.output : typeof r.text == "string" ? r.text : "").trim(),
    usage: tu(r.usage)
  };
}
function rr(t) {
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
function ru(t) {
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
function iu(t, e = 3) {
  const n = te(t);
  return n === null ? e : n <= 1 ? 1 : 3;
}
function au(t, e) {
  const n = t.toLowerCase(), r = /promo|trailer|hype|teaser|sizzle|ad|commercial/.test(n), i = /tiktok|reel|short|vertical|social/.test(n), a = r ? "promo" : i ? "social short" : "documentary interview", s = r ? "promo-trailer-editor" : i ? "social-shortform-editor" : "documentary-editor", l = e.referenceTimelines.find((o) => o.timelineId === e.activeTimelineId);
  return {
    pieceType: a,
    deliverable: a,
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
    referenceTimelineId: l == null ? void 0 : l.timelineId,
    referenceTimelineName: l == null ? void 0 : l.timelineName,
    useBrollPlaceholders: !0,
    confidence: 0.55,
    rationale: "Fallback brief inferred from request keywords and active project context."
  };
}
function su(t) {
  return Array.isArray(t) ? t.flatMap((e, n) => {
    if (!e || typeof e != "object") return [];
    const r = e, i = typeof r.question == "string" ? r.question.trim() : "";
    if (!i) return [];
    const a = Array.isArray(r.options) ? r.options.flatMap((s, l) => {
      if (!s || typeof s != "object") return [];
      const o = s, u = typeof o.label == "string" ? o.label.trim() : "";
      return u ? [{
        id: typeof o.id == "string" && o.id.trim() ? o.id.trim() : `opt_${n + 1}_${l + 1}`,
        label: u,
        description: typeof o.description == "string" ? o.description.trim() : void 0
      }] : [];
    }) : [];
    return [{
      id: typeof r.id == "string" && r.id.trim() ? r.id.trim() : `question_${n + 1}`,
      question: i,
      help: typeof r.help == "string" ? r.help.trim() : void 0,
      allowCustom: r.allowCustom !== !1,
      options: a
    }];
  }) : [];
}
function ou(t, e) {
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
      variantCount: iu(n.variantCount, e.variantCount),
      persona: ru(n.persona),
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
    clarifyingQuestions: su(n.clarifyingQuestions)
  };
}
function lu(t, e, n) {
  const r = { ...t, ...e ?? {} };
  if (n) {
    const i = Object.entries(n).map(([a, s]) => `${a}: ${s}`).filter((a) => !a.endsWith(": "));
    i.length > 0 && (r.formatNotes = `${r.formatNotes}
Clarifications:
${i.join(`
`)}`.trim(), r.rationale = `${r.rationale} Clarifications were provided by the user.`);
  }
  return r;
}
function oi(t) {
  const e = Number(t);
  return Number.isFinite(e) ? Math.max(0, e) : null;
}
function uu(t) {
  if (!t || typeof t != "object") return null;
  const e = t, n = oi(e.source_start), r = oi(e.source_end);
  if (n === null || r === null || r <= n) return null;
  const i = typeof e.asset_id == "string" && e.asset_id.trim() ? e.asset_id.trim() : void 0, a = typeof e.asset_name == "string" && e.asset_name.trim() ? e.asset_name.trim() : void 0;
  return !i && !a ? null : {
    ...i ? { asset_id: i } : {},
    ...a ? { asset_name: a } : {},
    source_start: n,
    source_end: r,
    ...typeof e.note == "string" && e.note.trim() ? { note: e.note.trim() } : {}
  };
}
function du(t, e) {
  if (!t || typeof t != "object") return null;
  const n = t, r = Array.isArray(n.segments) ? n.segments.map(uu).filter((i) => !!i) : [];
  return r.length === 0 ? null : {
    type: "cut_proposal",
    summary: typeof n.summary == "string" && n.summary.trim() ? n.summary.trim() : `Proposed ${r.length} cut segments.`,
    timeline_name: typeof n.timeline_name == "string" && n.timeline_name.trim() ? n.timeline_name.trim() : e,
    should_create_timeline: typeof n.should_create_timeline == "boolean" ? n.should_create_timeline : !1,
    segments: r
  };
}
function cu(t) {
  if (!t || typeof t != "object") return [];
  const e = t;
  return Array.isArray(e.variants) ? e.variants.flatMap((n, r) => {
    var s;
    if (!n || typeof n != "object") return [];
    const i = n, a = Array.isArray(i.proposals) ? i.proposals.map((l) => du(l, `AI Cut ${r + 1}`)).filter((l) => !!l) : [];
    return a.length === 0 ? [] : [{
      id: typeof i.id == "string" && i.id.trim() ? i.id.trim() : `variant_${r + 1}`,
      title: typeof i.title == "string" && i.title.trim() ? i.title.trim() : `Variant ${r + 1}`,
      strategy: typeof i.strategy == "string" && i.strategy.trim() ? i.strategy.trim() : "Balanced editorial approach",
      summary: typeof i.summary == "string" && i.summary.trim() ? i.summary.trim() : ((s = a[0]) == null ? void 0 : s.summary) ?? "Proposed edit.",
      rationale: typeof i.rationale == "string" && i.rationale.trim() ? i.rationale.trim() : "Generated from editorial brief, retrieval hits, and project context.",
      proposals: a,
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
function fu(t, e) {
  if (!t || typeof t != "object") return e;
  const n = t, r = Array.isArray(n.scorecards) ? n.scorecards : [], i = /* @__PURE__ */ new Map();
  for (const l of r) {
    if (!l || typeof l != "object") continue;
    const o = l, u = typeof o.variant_id == "string" ? o.variant_id.trim() : "";
    u && i.set(u, {
      overall: te(o.overall) ?? 78,
      storyArc: te(o.storyArc) ?? 78,
      pacing: te(o.pacing) ?? 78,
      clarity: te(o.clarity) ?? 78,
      visualFit: te(o.visualFit) ?? 78,
      completeness: te(o.completeness) ?? 78,
      formatFit: te(o.formatFit) ?? 78,
      strengths: Array.isArray(o.strengths) ? o.strengths.filter((d) => typeof d == "string") : [],
      cautions: Array.isArray(o.cautions) ? o.cautions.filter((d) => typeof d == "string") : [],
      rationale: typeof o.rationale == "string" ? o.rationale.trim() : ""
    });
  }
  const a = Array.isArray(n.ranked_variant_ids) ? n.ranked_variant_ids.filter((l) => typeof l == "string") : e.map((l) => l.id), s = [...e].map((l, o) => ({
    ...l,
    scorecard: i.get(l.id) ?? {
      overall: 78 - o,
      storyArc: 78 - o,
      pacing: 78 - o,
      clarity: 78 - o,
      visualFit: 78 - o,
      completeness: 78 - o,
      formatFit: 78 - o,
      strengths: ["No judge score available; kept generation order."],
      cautions: [],
      rationale: "Judge pass was unavailable, so the generation order was preserved."
    }
  }));
  return s.sort((l, o) => {
    const u = a.indexOf(l.id), d = a.indexOf(o.id);
    return u === -1 && d === -1 ? o.scorecard.overall - l.scorecard.overall : u === -1 ? 1 : d === -1 ? -1 : u - d;
  }), s;
}
function mu(t) {
  return t.referenceTimelines.slice(0, 5).map((e) => `- ${e.timelineName}${e.isActive ? " (active)" : ""}: ${e.structureSummary}; primary assets: ${e.primaryAssets.join(", ") || "none"}`).join(`
`);
}
function va(t) {
  return t.slice(0, 18).map((e, n) => {
    const r = e.timelinePlacements[0], i = r ? ` | timeline: ${r.timelineName} @ ${r.timelineTime.toFixed(1)}` : "", a = e.words.length > 0 ? `
   Word timings: ${e.words.slice(0, 18).map((s) => `${s.word}@${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(" ")}` : "";
    return `${n + 1}. ${e.assetName} ${e.sourceStart.toFixed(1)}-${e.sourceEnd.toFixed(1)}${i}
   ${e.text}
   Reason: ${e.reason}${a}`;
  }).join(`
`);
}
function pu(t) {
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
async function yu(t) {
  var i;
  const e = new Set(t.retrievedMoments.map((a) => a.assetId)), n = t.visualCandidates.filter((a) => e.has(a.assetId)).slice(0, 4), r = [];
  for (const a of n) {
    if (((i = a.storedSummary) == null ? void 0 : i.status) === "ready" && (!t.model || a.storedSummary.model === t.model)) {
      r.push(a.storedSummary);
      continue;
    }
    r.push(await ba({
      apiKey: t.apiKey,
      assetId: a.assetId,
      assetName: a.assetName,
      framePaths: a.framePaths,
      model: t.model
    }));
  }
  return r;
}
async function hu(t) {
  var a;
  const e = au(t.request, t.index), n = [
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
    mu(t.index)
  ].join(`
`), r = await rt({
    apiKey: t.apiKey,
    model: t.model,
    systemPrompt: [
      "You produce concise, grounded editorial briefs for film and promo editors.",
      ((a = t.customSystemPrompt) == null ? void 0 : a.trim()) || ""
    ].filter(Boolean).join(`

`),
    prompt: n,
    maxTokens: 900,
    temperature: 0.35
  }), i = rr(r.message);
  if (!i)
    return { brief: e, clarifyingQuestions: [], usage: r.usage };
  try {
    const s = JSON.parse(i);
    return { ...ou(s, e), usage: r.usage };
  } catch {
    return { brief: e, clarifyingQuestions: [], usage: r.usage };
  }
}
async function li(t, e, n, r, i = {}) {
  const a = [e, n.storyGoal, n.hook, n.tone, n.audience].join(" ");
  let s = Jl(t, a, { limit: 20, persona: n.persona });
  if (i.rerank && i.apiKey && s.length > 1)
    try {
      const o = $l({ query: a, brief: n, candidates: s }), u = await rt({
        apiKey: i.apiKey,
        model: i.model,
        systemPrompt: "You re-rank candidate video moments for an editor. Return JSON only.",
        prompt: o,
        maxTokens: 500,
        temperature: 0.2
      });
      s = Hl(s, u.message);
    } catch {
    }
  const l = r.filter((o) => o.status === "ready").length;
  return {
    topMoments: s,
    referenceTimelines: t.referenceTimelines.slice(0, 4),
    visualSummaryStatus: l <= 0 ? "none" : l < Math.max(1, s.length) ? "partial" : "ready",
    note: s.length > 0 ? `Retrieved ${s.length} transcript-driven source moments${l > 0 ? ` and ${l} visual summaries` : ""}.` : "No high-confidence transcript moments were retrieved; generation should stay conservative."
  };
}
async function gu(t) {
  var u;
  const e = (d, c) => {
    const m = rr(d);
    if (!m) return null;
    try {
      const f = JSON.parse(m), _ = cu({ variants: [f] })[0];
      return _ ? {
        variant: _,
        usage: c
      } : null;
    } catch {
      return null;
    }
  }, n = async (d, c) => {
    const m = [
      `Repair this malformed cut-variant response into valid JSON for variant ${c + 1}.`,
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "Do not add commentary before or after the JSON.",
      "If part of the raw output was truncated, salvage one valid variant.",
      "",
      "Malformed response:",
      d
    ].join(`
`), f = await rt({
      apiKey: t.apiKey,
      model: t.model,
      systemPrompt: "You repair malformed structured editor outputs. Return strict JSON only.",
      prompt: m,
      maxTokens: 4200,
      temperature: 0.1
    }), h = e(f.message, f.usage);
    return h || {
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
  let l;
  const o = [];
  for (let d = 0; d < s.length; d += 1) {
    const m = [
      "You are CineGen's lead editor creating one high-quality cut proposal.",
      `Generate exactly one editorial variant using this strategy: ${s[d]}`,
      "Use the retrieved moments and visual findings as evidence. Do not invent content outside them.",
      "Use word-level source timings when possible and cut tighter than sentence edges when the request calls for it.",
      "Do not include any prose before or after the JSON.",
      "Keep notes concise and practical.",
      "Return JSON only with this shape:",
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      "If the user asked for multiple parts, the variant may include multiple proposals, one per part.",
      o.length > 0 ? `Already generated variants (do something meaningfully different):
${JSON.stringify(o.map((y) => ({ title: y.title, strategy: y.strategy, summary: y.summary })), null, 2)}` : "",
      "",
      "Editorial brief:",
      JSON.stringify(t.brief, null, 2),
      "",
      "Retrieved moments:",
      va(t.retrievalSummary.topMoments),
      "",
      "Reference timelines:",
      t.retrievalSummary.referenceTimelines.map((y) => `- ${y.timelineName}: ${y.structureSummary}`).join(`
`) || "- none",
      "",
      "Visual findings:",
      pu(t.visualFindings) || "- none",
      "",
      `Original request: ${t.request}`
    ].filter(Boolean).join(`
`), f = await rt({
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
    l = At(l, f.usage);
    const h = e(f.message, f.usage);
    if (h != null && h.variant) {
      o.push({
        ...h.variant,
        id: `variant_${d + 1}`
      });
      continue;
    }
    const _ = await n(f.message, d);
    l = At(l, _.usage), _.variant && o.push({
      ..._.variant,
      id: `variant_${d + 1}`
    });
  }
  return o.length === 0 ? {
    variants: [],
    summaryMessage: "I hit a formatting issue while packaging the cut variants. Review the brief and try again.",
    usage: l
  } : {
    variants: o,
    summaryMessage: o.length === 1 ? "I generated one cut variant. Review it below." : `I generated ${o.length} cut variants. Review the options below.`,
    usage: l
  };
}
async function _u(t) {
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
    va(t.retrievalSummary.topMoments.slice(0, 10)),
    "",
    "Variants:",
    JSON.stringify(t.variants.map((a) => ({
      id: a.id,
      title: a.title,
      strategy: a.strategy,
      summary: a.summary,
      rationale: a.rationale,
      proposalSummaries: a.proposals.map((s) => ({
        timeline_name: s.timeline_name,
        summary: s.summary,
        segmentCount: s.segments.length,
        firstSegments: s.segments.slice(0, 4)
      }))
    })), null, 2)
  ].join(`
`), n = await rt({
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
  }), r = rr(n.message);
  if (!r) return { variants: t.variants, usage: n.usage };
  try {
    const a = JSON.parse(r);
    return {
      variants: fu(a, t.variants),
      usage: n.usage
    };
  } catch {
    return { variants: t.variants, usage: n.usage };
  }
}
async function wu(t) {
  if (!t.apiKey) throw new Error("No fal.ai API key provided.");
  const e = t.index, n = t.request.trim();
  if (!n) throw new Error("No cut request provided.");
  let r;
  const i = await hu({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: n,
    index: e
  });
  r = At(r, i.usage);
  const a = lu(i.brief, t.briefOverride, t.questionAnswers), s = await li(e, n, a, []);
  if (!t.confirmedBrief)
    return {
      stage: "brief",
      summaryMessage: i.clarifyingQuestions.length > 0 ? "I drafted an editorial brief and I need a bit of guidance before generating the cut variants." : "I drafted the editorial brief. Review it, adjust anything you want, then generate the cut variants.",
      editorialBrief: a,
      clarifyingQuestions: i.clarifyingQuestions,
      retrievalSummary: s,
      visualFindings: [],
      variants: [],
      ...r ? { usage: r } : {}
    };
  const l = await yu({
    apiKey: t.apiKey,
    visualCandidates: e.visualInputs,
    retrievedMoments: s.topMoments,
    model: t.visionModel
  }), o = await li(e, n, a, l, {
    apiKey: t.apiKey,
    model: t.model,
    rerank: a.qualityGoal !== "auto"
  }), u = await gu({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    request: n,
    brief: a,
    retrievalSummary: o,
    visualFindings: l
  });
  if (r = At(r, u.usage), u.variants.length === 0)
    return {
      stage: "brief",
      summaryMessage: u.summaryMessage,
      editorialBrief: a,
      clarifyingQuestions: i.clarifyingQuestions,
      retrievalSummary: o,
      visualFindings: l,
      variants: [],
      ...r ? { usage: r } : {}
    };
  const d = await _u({
    apiKey: t.apiKey,
    model: t.model,
    customSystemPrompt: t.systemPrompt,
    brief: a,
    retrievalSummary: o,
    variants: u.variants
  });
  return r = At(r, d.usage), {
    stage: "variants",
    summaryMessage: u.summaryMessage,
    editorialBrief: a,
    clarifyingQuestions: i.clarifyingQuestions,
    retrievalSummary: o,
    visualFindings: l,
    variants: d.variants,
    ...r ? { usage: r } : {}
  };
}
const Ta = "http://127.0.0.1:11434";
function bu() {
  return V.getAllWindows().find((t) => !t.isDestroyed());
}
async function Eu(t, e) {
  var _, y;
  const n = ((_ = e.model) == null ? void 0 : _.trim()) || "qwen3.5:latest", r = [];
  (y = e.systemPrompt) != null && y.trim() && r.push({ role: "system", content: e.systemPrompt.trim() });
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
  }, a = await fetch(`${Ta}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(i)
  });
  if (!a.ok) {
    const p = await a.text().catch(() => "");
    throw new Error(`Ollama request failed (${a.status}): ${p || a.statusText}`);
  }
  const s = bu();
  let l = "", o = 0, u = 0, d = !1, c = "";
  const m = a.body.getReader(), f = new TextDecoder();
  let h = "";
  for (; ; ) {
    const { done: p, value: g } = await m.read();
    if (p) break;
    h += f.decode(g, { stream: !0 });
    let b;
    for (; (b = h.indexOf(`
`)) >= 0; ) {
      const E = h.slice(0, b).trim();
      if (h = h.slice(b + 1), !!E)
        try {
          const T = JSON.parse(E), S = T.message, x = typeof (S == null ? void 0 : S.content) == "string" ? S.content : "";
          if (x)
            for (const v of x)
              d ? (c += v, c.endsWith("</think>") && (d = !1, c = "")) : (c += v, c === "<think>" ? (d = !0, c = "") : "<think>".startsWith(c) || (l += c, s == null || s.webContents.send("llm:local-stream", { requestId: t, token: c }), c = ""));
          T.done && (o = te(T.prompt_eval_count) ?? 0, u = te(T.eval_count) ?? 0);
        } catch {
        }
    }
  }
  return c && !d && (l += c, s == null || s.webContents.send("llm:local-stream", { requestId: t, token: c })), s == null || s.webContents.send("llm:local-stream", { requestId: t, done: !0 }), {
    message: l.trim(),
    usage: o > 0 || u > 0 ? { promptTokens: o, completionTokens: u, totalTokens: o + u, cost: 0 } : void 0
  };
}
async function vu() {
  try {
    const t = await fetch(`${Ta}/api/tags`);
    return t.ok ? ((await t.json()).models ?? []).map((n) => n.name) : [];
  } catch {
    return [];
  }
}
function Tu() {
  I.handle("llm:chat", async (t, e) => {
    const n = e.apiKey;
    if (!n) throw new Error("No fal.ai API key provided.");
    const r = Array.isArray(e.messages) ? e.messages : [], i = nu(r);
    if (!i.trim()) throw new Error("No chat prompt provided.");
    const a = await rt({
      apiKey: n,
      model: e.model,
      systemPrompt: e.systemPrompt,
      prompt: i,
      maxTokens: e.maxTokens,
      temperature: e.temperature
    });
    return {
      message: a.message,
      ...a.usage ? { usage: a.usage } : {}
    };
  }), I.handle("llm:local-chat", async (t, e) => {
    const n = e.requestId || crypto.randomUUID(), r = await Eu(n, e);
    return {
      message: r.message,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), I.handle("llm:local-models", async () => vu()), I.handle("llm:run-cut-workflow", async (t, e) => wu(e));
}
const Sa = zn(kt), Su = [
  w.join(z.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude"
], xu = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "When an ACTIVE SKILL section is present, follow it directly in chat — never invoke Skill tool or slash commands.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), ju = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "CineGen SKILLS are in the system prompt — list them directly; never use Skill tool or say you will check.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), qu = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" "), Iu = "", Au = "2";
let Mt, Me = null;
function ir() {
  const t = z.homedir(), e = [
    w.join(t, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ], n = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...e, n].filter(Boolean).join(w.delimiter)
  };
}
async function xa() {
  if (Mt !== void 0) return Mt;
  for (const t of Su)
    try {
      const { stdout: e } = await Sa(t, ["--version"], {
        env: ir(),
        timeout: 8e3
      });
      if (e.toLowerCase().includes("claude"))
        return Mt = t, t;
    } catch {
    }
  return Mt = null, null;
}
function ku() {
  return V.getAllWindows().find((t) => !t.isDestroyed());
}
function Ru(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
function ui(t) {
  const e = t.usage;
  if (!e || typeof e != "object") return;
  const n = Number(e.input_tokens) || 0, r = Number(e.cache_creation_input_tokens) || 0, i = Number(e.cache_read_input_tokens) || 0, a = n + r + i, s = Number(e.output_tokens) || 0, l = a + s, o = Number(t.total_cost_usd) || 0;
  if (!(a <= 0 && s <= 0 && l <= 0 && o <= 0))
    return { promptTokens: a, completionTokens: s, totalTokens: l, cost: o };
}
function Ou(t, e, n) {
  const r = Array.isArray(n == null ? void 0 : n.errors) ? n.errors.filter((a) => typeof a == "string") : [];
  if (r.length > 0)
    return r.join(" ");
  if (typeof (n == null ? void 0 : n.result) == "string" && n.result.trim())
    return n.result.trim();
  if ((n == null ? void 0 : n.subtype) === "error_max_turns")
    return "Claude Code hit its turn limit before finishing a reply. Retry your message — Copilot answers in chat only, without tools.";
  const i = e.trim();
  return i || `Claude Code exited with code ${t ?? "unknown"}`;
}
function di(t) {
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
function Nu() {
  return w.join(J.getPath("userData"), "claude-code-workspace");
}
function Pu(t) {
  return t.purpose === "json-job" ? !0 : t.purpose === "copilot" || t.purpose === "enhance-prompt" ? !1 : !t.injectProjectContext && !t.resumeSessionId && !(t.messages && t.messages.length > 0);
}
function Cu(t, e) {
  if (t.injectProjectContext) {
    const n = (t.messages ?? []).filter((r) => r.content.trim());
    if (n.length > 0)
      return Ru(n);
  }
  return e ? t.userMessage.trim() : `${t.userMessage.trim()}

Assistant:
`;
}
async function Uu(t, e) {
  var y, p, g, b;
  const n = await xa();
  if (!n)
    throw new Error("Claude Code is not installed. Install it from https://code.claude.com");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const r = ((y = e.model) == null ? void 0 : y.trim()) || "sonnet", i = !!e.resumeSessionId && !e.injectProjectContext, a = Pu(e), s = [
    "-p",
    i ? e.userMessage.trim() : Cu(e, a),
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    Au,
    "--model",
    r,
    "--tools",
    Iu,
    "--disable-slash-commands",
    // No --mcp-config is passed, so this loads ZERO MCP servers. These jobs never use
    // them, and booting/tearing down the user's fleet dominated the call's wall clock.
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk"
  ];
  if (a ? (s.push("--safe-mode", "--effort", "low", "--include-partial-messages"), !i && ((p = e.systemPrompt) != null && p.trim()) && s.push("--system-prompt", e.systemPrompt.trim())) : s.push("--include-partial-messages"), i && e.resumeSessionId) {
    if (s.push("--resume", e.resumeSessionId), !a) {
      const E = [(g = e.systemPrompt) == null ? void 0 : g.trim(), ju].filter(Boolean).join(`

`);
      s.push("--append-system-prompt", E);
    }
  } else if (!a && e.injectProjectContext && ((b = e.systemPrompt) != null && b.trim())) {
    const E = e.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "", T = e.purpose === "enhance-prompt" ? qu : xu;
    s.push("--append-system-prompt", `${E}${e.systemPrompt.trim()}

${T}`);
  }
  const l = ku(), o = a ? Nu() : void 0;
  o && await tt(o, { recursive: !0 });
  let u = "", d = "", c, m = !1, f = !1, h, _;
  return new Promise((E, T) => {
    var N, O;
    const S = ne(n, s, {
      env: ir(),
      ...o ? { cwd: o } : {},
      stdio: ["ignore", "pipe", "pipe"]
    });
    Me = { child: S, requestId: t };
    let x = "", v = !1;
    const j = (L) => {
      v || (v = !0, Me = null, l == null || l.webContents.send("llm:claude-code-stream", { requestId: t, done: !0 }), L(), S.killed || S.kill());
    };
    (N = S.stdout) == null || N.on("data", (L) => {
      x += L.toString();
      let M;
      for (; (M = x.indexOf(`
`)) >= 0; ) {
        const B = x.slice(0, M).trim();
        if (x = x.slice(M + 1), !!B)
          try {
            const H = JSON.parse(B);
            if (H.type === "system" && H.subtype === "init" && typeof H.session_id == "string" && (c = H.session_id), H.type === "assistant" && H.error === "authentication_failed" && (m = !0), H.type === "result") {
              _ = H;
              const $ = di(H);
              $ && !u.trim() && (u = $, l == null || l.webContents.send("llm:claude-code-stream", { requestId: t, token: $ }));
              const q = u.trim();
              if (q && !m && !q.includes("Not logged in")) {
                j(() => E({ message: q, sessionId: c, usage: h, resumed: i }));
                return;
              }
            }
            const A = ui(H);
            if (A)
              h = A;
            else if (H.type === "assistant") {
              const $ = H.message;
              if ($ != null && $.usage) {
                const q = ui({ usage: $.usage });
                q && (h = q);
              }
            }
            const R = di(H);
            if (!R) continue;
            if (H.type === "stream_event") {
              f = !0, u += R, l == null || l.webContents.send("llm:claude-code-stream", { requestId: t, token: R });
              continue;
            }
            H.type === "assistant" && !f ? (u = R, l == null || l.webContents.send("llm:claude-code-stream", { requestId: t, token: R })) : H.type === "result" && !u.trim() && (u = R, l == null || l.webContents.send("llm:claude-code-stream", { requestId: t, token: R }));
          } catch {
          }
      }
    }), (O = S.stderr) == null || O.on("data", (L) => {
      d += L.toString();
    }), S.on("error", (L) => {
      j(() => T(L));
    }), S.on("close", (L) => {
      j(() => {
        const M = u.trim();
        if (m || M.includes("Not logged in")) {
          T(new Error("Claude Code is not logged in. Open Terminal, run `claude`, and sign in with your subscription."));
          return;
        }
        if (M) {
          E({ message: M, sessionId: c, usage: h, resumed: i });
          return;
        }
        T(new Error(Ou(L, d, _)));
      });
    });
  });
}
function Lu() {
  I.handle("llm:claude-code-detect", async () => {
    const t = await xa();
    if (!t)
      return { installed: !1 };
    try {
      const { stdout: e } = await Sa(t, ["--version"], {
        env: ir(),
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
    const n = e.requestId || K.randomUUID(), r = await Uu(n, e);
    return {
      message: r.message,
      sessionId: r.sessionId,
      resumed: r.resumed,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), I.handle("llm:claude-code-cancel", async (t, e) => {
    (Me == null ? void 0 : Me.requestId) === e && (Me.child.kill("SIGTERM"), Me = null);
  });
}
const ja = zn(kt), Du = {
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
}, Ft = /* @__PURE__ */ new Map();
function nn() {
  const t = z.homedir(), e = [
    w.join(t, ".local/bin"),
    w.join(t, ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ], n = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...e, n].filter(Boolean).join(w.delimiter)
  };
}
function qa() {
  return {
    ...nn(),
    GEMINI_CLI_TRUST_WORKSPACE: "true",
    TERM: "dumb",
    NO_COLOR: "1"
  };
}
function Dn(t) {
  return t.replace(/\u001b\[[0-9;]*m/g, "");
}
async function rn(t) {
  if (Ft.has(t))
    return Ft.get(t) ?? null;
  for (const e of Du[t])
    try {
      const { stdout: n } = await ja(e, ["--version"], {
        env: nn(),
        timeout: 8e3
      });
      if (n.trim())
        return Ft.set(t, e), e;
    } catch {
    }
  return Ft.set(t, null), null;
}
async function Tn(t) {
  const e = await rn(t);
  if (!e)
    return { id: t, installed: !1 };
  try {
    const { stdout: n } = await ja(e, ["--version"], {
      env: nn(),
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
async function Mu() {
  return Promise.all([
    Tn("claude-code"),
    Tn("codex"),
    Tn("gemini")
  ]);
}
function Ia() {
  return V.getAllWindows().find((t) => !t.isDestroyed());
}
function Mn(t) {
  return t.filter((e) => e.role !== "system" && e.content.trim()).map((e) => `${e.role === "assistant" ? "Assistant" : "User"}:
${e.content.trim()}`).join(`

`).concat(`

Assistant:
`);
}
const Aa = [
  "CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.",
  "The user's video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.",
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  "CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.",
  "Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands."
].join(" "), Fu = [
  "CineGen Copilot follow-up: answer from project context already established in this conversation.",
  "Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.",
  "For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer."
].join(" "), ka = [
  "CineGen prompt-rewrite mode: rewrite the user's rough Copilot prompt only.",
  "Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.",
  "Do not search files or invoke tools.",
  "Return only the rewritten prompt text."
].join(" ");
function $u() {
  I.handle("llm:cli-detect", async () => ({ providers: await Mu() }));
}
function Bu(t, e) {
  const n = t.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "").trim(), r = n.match(/You've hit your usage limit\.[^\n]*/i);
  return r ? `${r[0].trim()} Luna and Codex share your ChatGPT Codex quota — pick fal.ai in the LLM picker, or wait for the reset.` : n.split(`
`).filter((a) => {
    const s = a.trim();
    return !(!s || /^Reading additional input from stdin/i.test(s) || /codex_models_manager::cache/i.test(s) || /rmcp::transport/i.test(s) || /AuthRequiredError|AuthRequired\(/i.test(s));
  }).join(`
`).trim() || `Codex exited with code ${e ?? "unknown"}`;
}
let Ee = null;
function Hu() {
  return w.join(J.getPath("userData"), "codex-workspace");
}
function Wu(t) {
  return t.purpose === "json-job" ? !0 : t.purpose === "copilot" || t.purpose === "enhance-prompt" ? !1 : !t.injectProjectContext && !t.resumeSessionId && !(t.messages && t.messages.length > 0);
}
function zu(t, e) {
  var a, s;
  if (e) {
    const l = ((a = t.systemPrompt) == null ? void 0 : a.trim()) ?? "", o = t.userMessage.trim();
    return l ? `${l}

${o}` : o;
  }
  const n = [];
  if ((s = t.systemPrompt) != null && s.trim())
    if (t.injectProjectContext) {
      const l = t.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "", o = t.purpose === "enhance-prompt" ? ka : Aa;
      n.push(`${l}${t.systemPrompt.trim()}

${o}`);
    } else
      n.push(t.systemPrompt.trim());
  const r = (t.messages ?? []).filter((l) => l.content.trim()), i = r.length > 0 ? Mn(r) : `${t.userMessage.trim()}

Assistant:
`;
  return n.length > 0 ? `${n.join(`

`)}

${i}` : t.userMessage.trim();
}
function Gu(t) {
  const e = t.usage;
  if (!e) return;
  const n = Number(e.input_tokens) || 0, r = Number(e.cached_input_tokens) || 0, i = n + r, a = Number(e.output_tokens) || 0, s = i + a;
  if (!(s <= 0))
    return { promptTokens: i, completionTokens: a, totalTokens: s, cost: 0 };
}
function Ju(t) {
  if (t.type !== "item.completed" && t.type !== "item.updated") return "";
  const e = t.item;
  return (e == null ? void 0 : e.type) === "agent_message" && typeof e.text == "string" ? e.text : "";
}
async function Ku(t, e) {
  var _;
  const n = await rn("codex");
  if (!n)
    throw new Error("Codex CLI is not installed. Install it from https://developers.openai.com/codex");
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const r = ((_ = e.model) == null ? void 0 : _.trim()) || "gpt-5.3-codex", i = !!e.resumeSessionId && !e.injectProjectContext, a = Wu(e), s = i ? e.userMessage.trim() : zu(e, a), l = a ? Hu() : void 0;
  l && await tt(l, { recursive: !0 });
  const o = ["exec", "--json", "-s", "read-only", "-m", r, "--skip-git-repo-check"];
  a && (o.push("--ignore-user-config", "--ignore-rules"), l && o.push("-C", l)), i && e.resumeSessionId && o.push("resume", e.resumeSessionId), a || o.push(s);
  const u = Ia();
  let d = "", c = "", m, f, h = "";
  return new Promise((y, p) => {
    var E, T, S, x;
    const g = ne(n, o, {
      env: nn(),
      cwd: l,
      stdio: a ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    a && ((E = g.stdin) == null || E.write(s), (T = g.stdin) == null || T.end()), Ee = { child: g, requestId: t, provider: "codex" };
    let b = "";
    (S = g.stdout) == null || S.on("data", (v) => {
      b += v.toString();
      let j;
      for (; (j = b.indexOf(`
`)) >= 0; ) {
        const N = b.slice(0, j).trim();
        if (b = b.slice(j + 1), !!N)
          try {
            const O = JSON.parse(N);
            O.type === "thread.started" && typeof O.thread_id == "string" && (m = O.thread_id);
            const L = Gu(O);
            if (L && (f = L), O.type === "turn.failed") {
              const B = O.error;
              c += (B == null ? void 0 : B.message) ?? "Codex turn failed.";
            }
            const M = Ju(O);
            if (M) {
              const B = M.startsWith(h) ? M.slice(h.length) : M;
              h = M, d = M, B && (u == null || u.webContents.send("llm:codex-stream", { requestId: t, token: B }));
            }
          } catch {
          }
      }
    }), (x = g.stderr) == null || x.on("data", (v) => {
      c += v.toString();
    }), g.on("error", (v) => {
      Ee = null, p(v);
    }), g.on("close", (v) => {
      Ee = null, u == null || u.webContents.send("llm:codex-stream", { requestId: t, done: !0 });
      const j = d.trim();
      if (!j) {
        p(new Error(Bu(c, v)));
        return;
      }
      y({ message: j, sessionId: m, usage: f, resumed: i });
    });
  });
}
function Xu() {
  I.handle("llm:codex-chat", async (t, e) => {
    const n = e.requestId || K.randomUUID(), r = await Ku(n, e);
    return {
      message: r.message,
      sessionId: r.sessionId,
      resumed: r.resumed,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), I.handle("llm:codex-cancel", async (t, e) => {
    (Ee == null ? void 0 : Ee.requestId) !== e || Ee.provider !== "codex" || (Ee.child.kill("SIGTERM"), Ee = null);
  });
}
const Vu = 272e3, ci = {
  short: { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
  long: { input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 }
};
function wt(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? Math.floor(e) : 0;
}
function Yu(t) {
  if (!t || typeof t != "object" || Array.isArray(t)) return;
  const e = t.usage;
  if (!e || typeof e != "object" || Array.isArray(e)) return;
  const n = e, r = n.prompt_tokens_details && typeof n.prompt_tokens_details == "object" && !Array.isArray(n.prompt_tokens_details) ? n.prompt_tokens_details : {}, i = wt(n.prompt_tokens ?? n.input_tokens), a = wt(n.completion_tokens ?? n.output_tokens), s = wt(r.cached_tokens), l = wt(r.cache_write_tokens), o = wt(n.total_tokens) || i + a;
  if (!(i <= 0 && a <= 0 && o <= 0))
    return { promptTokens: i, completionTokens: a, totalTokens: o, cachedTokens: s, cacheWriteTokens: l };
}
function Qu(t) {
  const e = t.promptTokens > Vu ? ci.long : ci.short, n = Math.min(t.cachedTokens, t.promptTokens), r = Math.min(t.cacheWriteTokens, Math.max(0, t.promptTokens - n)), a = (Math.max(0, t.promptTokens - n - r) * e.input + n * e.cached + r * e.cacheWrite + t.completionTokens * e.output) / 1e6;
  return { ...t, cost: Math.round(a * 1e8) / 1e8 };
}
const Zu = "https://api.openai.com/v1/chat/completions", ed = "gpt-5.6-luna", td = 6e4;
function nd(t, e = []) {
  const n = t.trim(), r = e.map((i) => i.trim()).filter(Boolean);
  return r.length === 0 ? n : [
    { type: "text", text: n },
    ...r.map((i) => ({ type: "image_url", image_url: { url: i, detail: "low" } }))
  ];
}
function rd(t) {
  var i, a;
  const e = [], n = ((i = t.systemPrompt) == null ? void 0 : i.trim()) ?? "";
  n && e.push({ role: "system", content: n }), e.push({ role: "user", content: nd(t.userMessage, t.imageUrls) });
  const r = {
    model: ((a = t.model) == null ? void 0 : a.trim()) || ed,
    messages: e,
    reasoning_effort: t.reasoningEffort ?? "low",
    max_completion_tokens: Number.isFinite(t.maxCompletionTokens) ? Math.max(1, Math.floor(t.maxCompletionTokens)) : td
  };
  return t.jsonObject !== !1 && (r.response_format = { type: "json_object" }), r;
}
function id(t, e) {
  if (typeof t == "string" && t.trim()) return t.trim().slice(0, 2e3);
  if (!t || typeof t != "object" || Array.isArray(t)) return e;
  const n = t, r = n.error;
  if (typeof r == "string" && r.trim()) return r.trim().slice(0, 2e3);
  if (r && typeof r == "object" && !Array.isArray(r)) {
    const i = r.message;
    if (typeof i == "string" && i.trim()) return i.trim().slice(0, 2e3);
  }
  return typeof n.message == "string" && n.message.trim() ? n.message.trim().slice(0, 2e3) : e;
}
function ad(t) {
  if (!t || typeof t != "object" || Array.isArray(t))
    throw new Error("OpenAI returned an invalid response.");
  const e = t, n = Array.isArray(e.choices) ? e.choices : [], r = n[0] && typeof n[0] == "object" && !Array.isArray(n[0]) ? n[0] : null, i = r != null && r.message && typeof r.message == "object" && !Array.isArray(r.message) ? r.message : null, a = typeof (i == null ? void 0 : i.refusal) == "string" ? i.refusal.trim() : "";
  if (a) throw new Error(a);
  const s = typeof (i == null ? void 0 : i.content) == "string" ? i.content.trim() : "";
  if (!s) throw new Error("OpenAI returned no text output.");
  if ((r == null ? void 0 : r.finish_reason) === "length")
    throw new Error("The model hit its output limit mid-answer. Try shotlisting one scene at a time.");
  return s;
}
async function sd(t) {
  const e = t.apiKey.trim();
  if (!e) throw new Error("No OpenAI API key provided.");
  const n = t.userMessage.trim();
  if (!n) throw new Error("No OpenAI prompt provided.");
  const r = t.fetchImpl ?? globalThis.fetch;
  if (typeof r != "function") throw new Error("This runtime does not provide fetch.");
  const i = await r(Zu, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${e}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(rd({
      model: t.model,
      systemPrompt: t.systemPrompt,
      userMessage: n,
      imageUrls: t.imageUrls,
      maxCompletionTokens: t.maxCompletionTokens,
      reasoningEffort: t.reasoningEffort,
      jsonObject: t.jsonObject
    }))
  }), a = await i.text();
  let s = a;
  if (a)
    try {
      s = JSON.parse(a);
    } catch {
    }
  if (!i.ok)
    throw new Error(id(s, `OpenAI request failed (${i.status}).`));
  const l = Yu(s);
  return {
    message: ad(s),
    ...l ? { usage: Qu(l) } : {}
  };
}
function od(t) {
  return t.startsWith("local-media://file") ? decodeURIComponent(t.replace(/^local-media:\/\/file/, "")) : null;
}
function ld(t) {
  const e = w.extname(t).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : e === ".gif" ? "image/gif" : "image/jpeg";
}
function ud(t) {
  const e = t.trim();
  if (!e) return null;
  if (/^data:image\//i.test(e) || /^https?:\/\//i.test(e)) return e;
  const n = od(e) ?? (e.startsWith("/") || /^[A-Za-z]:[\\/]/.test(e) ? e : null);
  if (!n || !F.existsSync(n)) return null;
  const r = F.readFileSync(n);
  return `data:${ld(n)};base64,${r.toString("base64")}`;
}
function dd(t) {
  return Array.isArray(t) ? t.flatMap((e) => {
    if (typeof e != "string") return [];
    const n = ud(e);
    return n ? [n] : [];
  }) : [];
}
function cd() {
  I.handle("llm:openai-chat", async (t, e) => {
    const n = e && typeof e == "object" && !Array.isArray(e) ? e : {}, r = typeof n.apiKey == "string" ? n.apiKey : "", i = typeof n.userMessage == "string" ? n.userMessage : "";
    return sd({
      apiKey: r,
      model: typeof n.model == "string" ? n.model : void 0,
      systemPrompt: typeof n.systemPrompt == "string" ? n.systemPrompt : void 0,
      userMessage: i,
      imageUrls: dd(n.imageUrls),
      maxCompletionTokens: typeof n.maxCompletionTokens == "number" ? n.maxCompletionTokens : void 0,
      jsonObject: n.jsonObject === !1 ? !1 : void 0
    });
  }), I.handle("llm:openai-realtime-session", async (t, e) => {
    var u;
    const n = e && typeof e == "object" && !Array.isArray(e) ? e : {}, r = typeof n.apiKey == "string" ? n.apiKey.trim() : "", i = typeof n.sdp == "string" ? n.sdp : "";
    if (!r) throw new Error("Add an OpenAI API key in Settings to use Voice Director.");
    if (!i || i.length > 1e6) throw new Error("Voice Director received an invalid audio session offer.");
    const a = JSON.stringify({
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
        output: { voice: "marin" }
      }
    }), s = new FormData();
    s.set("sdp", i), s.set("session", a);
    const l = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${r}`,
        "OpenAI-Safety-Identifier": "cinegen-desktop-user"
      },
      body: s
    }), o = await l.text();
    if (!l.ok) {
      let d = `OpenAI Realtime failed (${l.status}).`;
      try {
        const c = JSON.parse(o);
        (u = c.error) != null && u.message && (d = c.error.message);
      } catch {
      }
      throw new Error(d);
    }
    return { sdp: o };
  });
}
const Ra = zn(kt), fd = 90;
function et(t) {
  const e = t.trim();
  if (!e) return null;
  const n = [
    e,
    w.resolve(e)
  ];
  for (const r of n)
    if (F.existsSync(r)) return r;
  return null;
}
async function Oa(t, e, n, r) {
  const i = ge(), a = Math.max(0, e), s = Math.max(0.1, Math.min(n, fd));
  try {
    return await Ra(i, [
      "-y",
      "-ss",
      `${a}`,
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
    ], { timeout: Math.max(12e4, Math.ceil(s * 4e3)) }), F.existsSync(r) ? r : null;
  } catch {
    return null;
  }
}
async function Wt(t, e, n) {
  const r = ge();
  try {
    return await Ra(r, [
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
    ], { timeout: 15e3 }), F.existsSync(n) ? n : null;
  } catch {
    return null;
  }
}
function Fn(t) {
  return K.createHash("sha1").update(JSON.stringify({
    label: t.label,
    fileRef: t.fileRef,
    trimStartSec: t.trimStartSec,
    trimDurationSec: t.trimDurationSec
  })).digest("hex").slice(0, 12);
}
function Na(t) {
  return /\s/.test(t);
}
function Pa(t, e) {
  try {
    if (F.existsSync(e)) return e;
    try {
      F.linkSync(t, e);
    } catch {
      F.copyFileSync(t, e);
    }
    return F.existsSync(e) ? e : null;
  } catch {
    return null;
  }
}
function Sn(t, e, n) {
  if (!Na(t))
    return { mediaPath: t, ephemeral: !1 };
  const r = w.extname(t) || (e.mediaType === "image" ? ".jpg" : ".mp4"), i = w.join(n, `${Fn(e)}-source${r}`), a = Pa(t, i);
  return a ? { mediaPath: a, ephemeral: !0 } : null;
}
async function ar(t, e) {
  const n = w.join(e, "visual-refs");
  F.mkdirSync(n, { recursive: !0 });
  const r = [];
  for (const i of t) {
    const a = et(i.fileRef);
    if (!a) continue;
    if (i.mediaType === "image") {
      const d = Sn(a, i, n);
      if (!d) continue;
      r.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: d.mediaPath,
        ephemeral: d.ephemeral
      });
      continue;
    }
    if (i.trimStartSec !== void 0 && i.trimDurationSec !== void 0) {
      const d = w.join(n, `${Fn(i)}.mp4`), c = await Oa(
        a,
        i.trimStartSec,
        i.trimDurationSec,
        d
      );
      if (c) {
        r.push({
          label: i.label,
          kind: i.kind,
          mediaType: "video",
          mediaPath: c,
          ephemeral: !0
        });
        continue;
      }
    }
    const s = w.extname(a).toLowerCase();
    if ([".mp4", ".mov", ".webm", ".m4v", ".avi"].includes(s)) {
      const d = Sn(a, i, n);
      if (!d) continue;
      r.push({
        label: i.label,
        kind: i.kind,
        mediaType: "video",
        mediaPath: d.mediaPath,
        ephemeral: d.ephemeral
      });
      continue;
    }
    const l = (i.framePaths ?? []).map((d) => et(d)).find(Boolean);
    if (l) {
      const d = Sn(l, {
        ...i,
        mediaType: "image",
        fileRef: l
      }, n);
      if (!d) continue;
      r.push({
        label: i.label,
        kind: i.kind,
        mediaType: "image",
        mediaPath: d.mediaPath,
        ephemeral: d.ephemeral
      });
      continue;
    }
    const o = w.join(n, `${Fn(i)}.jpg`), u = await Wt(a, i.trimStartSec ?? 0, o);
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
function Ca(t, e) {
  if (e.length === 0) return t.trim();
  const n = e.map((a) => `@${a.mediaPath}`).join(" "), r = t.trim();
  return e.some((a) => a.mediaType === "video") ? r ? `${n} ${r}` : `${n} describe this video in detail. Include what you see on screen, the setting, actions, and any spoken audio.` : r ? `${n} ${r}` : `${n} describe this image in detail.`;
}
function sr(t) {
  for (const e of t)
    if (e.ephemeral)
      try {
        F.unlinkSync(e.mediaPath);
      } catch {
      }
}
function Ua(t) {
  const e = t.trim();
  if (!e) return null;
  if (e.startsWith("local-media://file/")) {
    const n = decodeURIComponent(e.replace("local-media://file", ""));
    return et(n);
  }
  if (e.startsWith("file://"))
    try {
      return et(decodeURIComponent(new URL(e).pathname));
    } catch {
      return null;
    }
  return et(e);
}
async function md(t, e) {
  const n = Ua(t);
  if (!n) throw new Error(`Could not resolve a local source file for: ${t}`);
  const r = w.join(z.tmpdir(), "cinegen-higgsfield-refs");
  F.mkdirSync(r, { recursive: !0 });
  const i = K.randomBytes(6).toString("hex"), a = Math.max(0, e.sourceStartSec ?? 0), s = e.sourceEndSec ?? a;
  if (e.mode === "first-last") {
    const d = w.join(r, `${i}-first.jpg`), c = w.join(r, `${i}-last.jpg`), m = await Wt(n, a, d), f = await Wt(n, Math.max(a, s - 0.05), c), h = [], _ = [];
    if (m && (h.push(m), _.push("start_image")), f && (h.push(f), _.push("end_image")), h.length === 0) throw new Error("Failed to extract first/last frames");
    return { paths: h, roles: _ };
  }
  if (e.mode === "segment") {
    const d = w.join(r, `${i}-segment.mp4`), c = Math.max(0.1, s > a ? s - a : e.maxSegmentSec ?? 30), m = await Oa(n, a, Math.min(c, e.maxSegmentSec ?? 30), d);
    if (!m) throw new Error("Failed to extract clip segment");
    return { paths: [m], roles: ["image"] };
  }
  const l = e.frameTimeSec ?? (s > a ? (a + s) / 2 : a), o = w.join(r, `${i}-frame.jpg`), u = await Wt(n, l, o);
  if (!u) throw new Error("Failed to extract reference frame");
  return { paths: [u], roles: ["image"] };
}
function pd(t) {
  return /\b(cannot|can't|do not have the ability|unable to|not able to)\b[\s\S]{0,100}\b(video|visual|auditory|audio|mp4|mov|footage|media file)\b/i.test(t) || /\btools do not allow\b[\s\S]{0,60}\b(video|visual|auditory|mp4)\b/i.test(t);
}
class Kt extends Error {
}
const yd = 18e4, hd = 600 * 1e3;
async function La(t) {
  var d;
  const e = await rn("gemini");
  if (!e)
    throw new Kt("Gemini CLI is not installed.");
  const n = et(t.mediaPath);
  if (!n)
    throw new Error(`Media file not found: ${t.mediaPath}`);
  const r = w.join(z.tmpdir(), "cinegen-gemini-acoustic");
  await tt(r, { recursive: !0 });
  let i = n, a = !1;
  if (Na(n)) {
    const c = w.extname(n) || ".mp4", m = w.join(r, `${K.randomUUID()}${c}`), f = Pa(n, m);
    if (!f)
      throw new Error("Could not stage the media file for Gemini analysis.");
    i = f, a = !0;
  }
  const s = ((d = t.model) == null ? void 0 : d.trim()) || "gemini-2.5-flash", o = [
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
    K.randomUUID(),
    "--include-directories",
    w.dirname(i)
  ], u = () => {
    if (a)
      try {
        F.unlinkSync(i);
      } catch {
      }
  };
  return new Promise((c, m) => {
    var S, x;
    const f = ne(e, o, { env: qa(), cwd: r, stdio: ["ignore", "pipe", "pipe"] });
    let h = "", _ = "", y = "", p = !1, g = !1;
    const b = (v) => {
      p || (p = !0, clearTimeout(E), clearTimeout(T), u(), v());
    }, E = setTimeout(() => {
      f.kill("SIGTERM"), b(() => m(new Error("Gemini CLI media analysis timed out.")));
    }, hd), T = setTimeout(() => {
      g || (f.kill("SIGTERM"), b(() => m(new Error("Gemini CLI is still reading the media file. Try a shorter clip."))));
    }, yd);
    (S = f.stdout) == null || S.on("data", (v) => {
      y += v.toString();
      let j;
      for (; (j = y.indexOf(`
`)) >= 0; ) {
        const N = y.slice(0, j).trim();
        if (y = y.slice(j + 1), !!N)
          try {
            const O = JSON.parse(N);
            O.type === "message" && O.role === "assistant" && typeof O.content == "string" && O.content && (g = !0, h += O.content), O.type === "error" && typeof O.message == "string" && (_ += O.message);
          } catch {
          }
      }
    }), (x = f.stderr) == null || x.on("data", (v) => {
      _ += v.toString();
    }), f.on("error", (v) => b(() => m(v))), f.on("close", (v) => {
      const j = h.trim();
      if (!j) {
        const N = Dn(_.trim()) || `Gemini CLI exited with code ${v ?? "unknown"}`;
        b(() => m(new Error(N)));
        return;
      }
      if (pd(j)) {
        b(() => m(new Kt("Gemini CLI declined to analyze the media.")));
        return;
      }
      b(() => c(j));
    });
  });
}
const fi = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GeminiMediaUnavailableError: Kt,
  analyzeMediaWithGeminiCli: La,
  buildGeminiUserMessageWithVisualRefs: Ca,
  cleanupEphemeralVisualRefs: sr,
  prepareClipReference: md,
  prepareCopilotVisualRefs: ar,
  resolveLocalSourcePath: Ua
}, Symbol.toStringTag, { value: "Module" }));
let fe = null;
const gd = 9e4, _d = 18e4, wd = 8e3;
function Da() {
  return w.join(J.getPath("userData"), "gemini-cli-workspace");
}
function bd() {
  return w.join(z.tmpdir(), "cinegen-gemini-visual-refs");
}
function Ed(t) {
  var r;
  const e = [];
  if ((r = t.systemPrompt) != null && r.trim())
    if (t.injectProjectContext) {
      const i = t.contextRefresh ? `The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.

` : "";
      e.push(`${i}${t.systemPrompt.trim()}

${t.purpose === "enhance-prompt" ? ka : Aa}`);
    } else
      e.push(t.systemPrompt.trim());
  const n = (t.messages ?? []).filter((i) => i.content.trim());
  return n.length > 0 ? e.length > 0 ? `${e.join(`

`)}

${Mn(n)}` : Mn(n) : e.length > 0 ? `${e.join(`

`)}

User:
${t.userMessage.trim()}

Assistant:
` : t.userMessage.trim();
}
function vd(t) {
  var n;
  const e = [
    (n = t.systemPrompt) == null ? void 0 : n.trim(),
    Fu
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
function Td(t) {
  const e = t.stats;
  if (!e) return;
  const n = Number(e.input_tokens) || 0, r = Number(e.output_tokens) || 0, i = Number(e.total_tokens) || n + r;
  if (!(i <= 0))
    return { promptTokens: n, completionTokens: r, totalTokens: i, cost: 0 };
}
function Sd(t) {
  if (typeof t != "string" || !t.trim()) return "Gemini CLI is working…";
  const e = t.replace(/_/g, " ").toLowerCase();
  return e.includes("read") && e.includes("file") ? "Gemini CLI: Reading attached video…" : `Gemini CLI: ${t.replace(/_/g, " ")}…`;
}
function xd(t) {
  return /malformed tool call|empty response|API Error|INVALID_ARGUMENT/i.test(t);
}
function jd(t) {
  return /no previous sessions found/i.test(t);
}
async function mi(t, e, n) {
  var y;
  const r = await rn("gemini");
  if (!r)
    throw new Error("Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli");
  const i = ((y = e.model) == null ? void 0 : y.trim().replace(/^[^/]+\//, "")) || "gemini-2.5-flash", a = n.canResume ? vd(e) : Ed(e), s = a.length > wd, l = Da();
  await tt(l, { recursive: !0 });
  const o = [
    "--skip-trust",
    ...s ? ["-p", ""] : ["-p", a],
    "-o",
    "stream-json",
    "-m",
    i,
    "--approval-mode",
    n.hasVisualRefs ? "yolo" : "default"
  ];
  if (n.hasVisualRefs) {
    o.push("--session-id", K.randomUUID());
    const p = [...new Set(
      n.preparedVisualRefs.map((g) => w.dirname(g.mediaPath))
    )];
    for (const g of p)
      o.push("--include-directories", g);
  } else n.canResume && e.resumeSessionId && o.push("-r", e.resumeSessionId);
  const u = Ia();
  let d = "", c = "", m, f;
  const h = 900 * 1e3, _ = n.hasVisualRefs ? _d : gd;
  return new Promise((p, g) => {
    var N, O, L, M;
    const b = ne(r, o, {
      env: qa(),
      cwd: l,
      stdio: s ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    s && ((N = b.stdin) == null || N.write(a), (O = b.stdin) == null || O.end()), fe = { child: b, requestId: t, provider: "gemini" };
    let E = "", T = !1, S = !1;
    const x = (B) => {
      T || (T = !0, clearTimeout(v), clearTimeout(j), sr(n.preparedVisualRefs), B());
    }, v = setTimeout(() => {
      fe = null, b.kill("SIGTERM"), x(() => g(new Error("Gemini CLI timed out after 15 minutes. Try again or switch models.")));
    }, h), j = setTimeout(() => {
      S || T || (fe = null, b.kill("SIGTERM"), x(() => g(new Error(
        n.hasVisualRefs ? "Gemini CLI is still reading the attached video. Try again or use a shorter clip." : "Gemini CLI is taking too long to respond. Try gemini-2.5-flash, shorten the question, or start a new chat."
      ))));
    }, _);
    (L = b.stdout) == null || L.on("data", (B) => {
      E += B.toString();
      let H;
      for (; (H = E.indexOf(`
`)) >= 0; ) {
        const A = E.slice(0, H).trim();
        if (E = E.slice(H + 1), !!A)
          try {
            const R = JSON.parse(A);
            R.type === "init" && typeof R.session_id == "string" && (m = R.session_id);
            const $ = Td(R);
            if ($ && (f = $), R.type === "tool_use" && (u == null || u.webContents.send("llm:gemini-stream", {
              requestId: t,
              status: Sd(R.tool_name)
            })), R.type === "message" && R.role === "assistant" && typeof R.content == "string") {
              const q = R.content;
              q && (S = !0, d += q, u == null || u.webContents.send("llm:gemini-stream", { requestId: t, token: q }));
            }
            if (R.type === "error" && typeof R.message == "string") {
              const q = R.message;
              c += q, !d.trim() && xd(q) && (fe = null, b.kill("SIGTERM"), x(() => g(new Error(Dn(q)))));
            }
            if (R.type === "result" && R.status === "error") {
              const q = typeof R.error == "string" ? R.error : typeof R.message == "string" ? R.message : "Gemini CLI returned an error.";
              c += q;
            }
          } catch {
          }
      }
    }), (M = b.stderr) == null || M.on("data", (B) => {
      c += B.toString();
    }), b.on("error", (B) => {
      fe = null, x(() => g(B));
    }), b.on("close", (B) => {
      fe = null, u == null || u.webContents.send("llm:gemini-stream", { requestId: t, done: !0 });
      const H = d.trim();
      if (!H) {
        const A = Dn(c.trim()) || `Gemini CLI exited with code ${B ?? "unknown"}`;
        x(() => g(new Error(A)));
        return;
      }
      x(() => p({
        message: H,
        sessionId: m,
        usage: f,
        resumed: n.canResume
      }));
    });
  });
}
async function qd(t, e) {
  if (!e.userMessage.trim())
    throw new Error("No chat message provided.");
  const n = Da(), r = bd();
  await tt(n, { recursive: !0 }), await tt(r, { recursive: !0 });
  const i = await ar(e.visualRefs ?? [], r);
  if ((e.visualRefs ?? []).length > 0 && i.length === 0)
    throw new Error("Could not load the attached /clip or /asset files for Gemini visual analysis. Use local video or image files.");
  const a = i.length > 0, s = {
    ...e,
    userMessage: Ca(e.userMessage, i)
  }, l = !!e.resumeSessionId && !e.injectProjectContext && !a;
  try {
    return await mi(t, s, {
      canResume: l,
      hasVisualRefs: a,
      preparedVisualRefs: i
    });
  } catch (o) {
    const u = o instanceof Error ? o.message : String(o);
    if (!l || !jd(u))
      throw o;
    return mi(t, {
      ...s,
      injectProjectContext: !a,
      contextRefresh: !a,
      resumeSessionId: void 0
    }, {
      canResume: !1,
      hasVisualRefs: a,
      preparedVisualRefs: i
    });
  }
}
function Id() {
  I.handle("llm:gemini-chat", async (t, e) => {
    const n = e.requestId || K.randomUUID(), r = await qd(n, e);
    return {
      message: r.message,
      sessionId: r.sessionId,
      resumed: r.resumed,
      ...r.usage ? { usage: r.usage } : {}
    };
  }), I.handle("llm:gemini-cancel", async (t, e) => {
    (fe == null ? void 0 : fe.requestId) !== e || fe.provider !== "gemini" || (fe.child.kill("SIGTERM"), fe = null);
  });
}
const Ad = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;
function kd(t, e) {
  const n = [];
  e && (n.push("I have a video that needs a music soundtrack. I've attached frames from the video for you to analyze."), n.push("Look at the visual content, mood, pacing, and subject matter to inform the music style."));
  const r = [];
  return t.genre && r.push(`Genre: ${t.genre}`), t.style && r.push(`Style: ${t.style}`), t.mood && r.push(`Mood: ${t.mood}`), t.tempo && r.push(`Tempo: ${t.tempo}`), t.additionalNotes && r.push(`Notes: ${t.additionalNotes}`), r.length > 0 && n.push(`User preferences:
` + r.join(`
`)), n.push("Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else."), n.join(`

`);
}
function Rd() {
  I.handle("music:generate-prompt", async (t, e) => {
    const n = e.apiKey;
    if (!n) throw new Error("No fal.ai API key provided.");
    G.fal.config({ credentials: n });
    const r = e.frameUrls && e.frameUrls.length > 0, i = kd(e, !!r), a = {
      model: "google/gemini-flash-1.5",
      system_prompt: Ad,
      prompt: i,
      max_tokens: 300
    }, s = r ? "fal-ai/any-llm/vision" : "fal-ai/any-llm";
    return r && (a.image_urls = e.frameUrls), { prompt: ((await G.fal.subscribe(s, { input: a, logs: !0 })).data.output ?? "").trim() };
  });
}
function Od() {
  I.handle("dialog:show-save", async (t, e) => {
    const n = V.getFocusedWindow();
    if (!n) return null;
    const r = await pr.showSaveDialog(n, {
      defaultPath: e == null ? void 0 : e.defaultPath,
      filters: e == null ? void 0 : e.filters
    });
    return r.canceled ? null : r.filePath;
  }), I.handle("dialog:show-open", async (t, e) => {
    var i;
    const n = V.getFocusedWindow();
    if (!n) return null;
    const r = await pr.showOpenDialog(n, {
      filters: e == null ? void 0 : e.filters,
      properties: (e == null ? void 0 : e.properties) ?? ["openFile"]
    });
    return r.canceled ? null : (i = e == null ? void 0 : e.properties) != null && i.includes("multiSelections") ? r.filePaths : r.filePaths[0];
  }), I.handle("shell:open-path", async (t, e) => await ns.openPath(e));
}
const Nd = {
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
function it(t, e) {
  const n = Nd[e], r = Object.entries(t).filter(
    ([s]) => s !== "id" && (!n || n.has(s))
  );
  if (r.length === 0) throw new Error("No valid fields to update");
  const i = r.map(([s]) => `${s} = ?`).join(", "), a = r.map(([, s]) => s);
  return { setClauses: i, values: a };
}
function Ma(t, e) {
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
function Fa(t, e) {
  return t.queryOne("SELECT * FROM projects WHERE id = ?", [e]);
}
function $a(t, e, n) {
  const { setClauses: r, values: i } = it(n, "projects");
  return t.run(`UPDATE projects SET ${r} WHERE id = ?`, [...i, e]);
}
function Ba(t, e) {
  return t.query("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at", [
    e
  ]);
}
function Ha(t, e) {
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
function Xt(t, e, n) {
  const { setClauses: r, values: i } = it(n, "assets");
  return t.run(`UPDATE assets SET ${r} WHERE id = ?`, [...i, e]);
}
function Wa(t, e) {
  return t.run("DELETE FROM assets WHERE id = ?", [e]);
}
function Pd(t, e) {
  return t.query(
    "SELECT * FROM media_folders WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function Cd(t, e) {
  return t.run(
    `INSERT INTO media_folders (id, project_id, name, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.parent_id, e.created_at]
  );
}
function Ud(t, e, n) {
  const { setClauses: r, values: i } = it(n, "media_folders");
  return t.run(`UPDATE media_folders SET ${r} WHERE id = ?`, [...i, e]);
}
function Ld(t, e) {
  return t.query(
    "SELECT * FROM timelines WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function za(t, e) {
  return t.run(
    `INSERT INTO timelines (id, project_id, name, duration, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.project_id, e.name, e.duration, e.created_at]
  );
}
function Dd(t, e, n) {
  const { setClauses: r, values: i } = it(n, "timelines");
  return t.run(`UPDATE timelines SET ${r} WHERE id = ?`, [...i, e]);
}
function Md(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE timeline_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE timeline_id = ?", [e]), t.run("DELETE FROM tracks WHERE timeline_id = ?", [e]), t.run("DELETE FROM transitions WHERE timeline_id = ?", [e]), t.run("DELETE FROM timelines WHERE id = ?", [e]);
  });
}
function Fd(t, e) {
  return t.query(
    "SELECT * FROM tracks WHERE timeline_id = ? ORDER BY sort_order",
    [e]
  );
}
function $n(t, e) {
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
function $d(t, e) {
  t.transaction(() => {
    t.run(
      "DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE track_id = ?)",
      [e]
    ), t.run("DELETE FROM clips WHERE track_id = ?", [e]), t.run("DELETE FROM tracks WHERE id = ?", [e]);
  });
}
function Bd(t, e) {
  return t.query(
    "SELECT * FROM clips WHERE timeline_id = ? ORDER BY start_time",
    [e]
  );
}
function Hd(t, e) {
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
function Wd(t, e) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]), t.run("DELETE FROM clips WHERE id = ?", [e]);
  });
}
function zd(t, e) {
  return t.query(
    "SELECT * FROM keyframes WHERE clip_id = ? ORDER BY time",
    [e]
  );
}
function Gd(t, e, n) {
  t.transaction(() => {
    t.run("DELETE FROM keyframes WHERE clip_id = ?", [e]);
    for (const r of n)
      t.run(
        "INSERT INTO keyframes (id, clip_id, time, property, value) VALUES (?, ?, ?, ?, ?)",
        [vt(), r.clip_id, r.time, r.property, r.value]
      );
  });
}
function Jd(t, e) {
  return t.query(
    "SELECT * FROM transitions WHERE timeline_id = ?",
    [e]
  );
}
function Kd(t, e) {
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
function Xd(t, e) {
  return t.run("DELETE FROM transitions WHERE id = ?", [e]);
}
function Vd(t, e) {
  const n = t.queryOne(
    "SELECT nodes, edges FROM workflow_state WHERE project_id = ?",
    [e]
  );
  if (!n) return { nodes: [], edges: [] };
  const r = JSON.parse(n.nodes), i = JSON.parse(n.edges);
  if (i && typeof i == "object" && !Array.isArray(i)) {
    const a = i;
    return {
      nodes: Array.isArray(r) ? r : [],
      edges: Array.isArray(a.edges) ? a.edges : [],
      spaces: Array.isArray(a.spaces) ? a.spaces : void 0,
      activeSpaceId: typeof a.activeSpaceId == "string" ? a.activeSpaceId : void 0,
      openSpaceIds: Array.isArray(a.openSpaceIds) ? a.openSpaceIds.filter((s) => typeof s == "string") : void 0,
      director: a.director
    };
  }
  return {
    nodes: Array.isArray(r) ? r : [],
    edges: Array.isArray(i) ? i : []
  };
}
function Yd(t, e, n) {
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
        openSpaceIds: n.openSpaceIds ?? [],
        director: n.director ?? null
      })
    ]
  );
}
function Qd(t, e) {
  return t.query(
    "SELECT * FROM elements WHERE project_id = ? ORDER BY created_at",
    [e]
  );
}
function Zd(t, e) {
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
function ec(t, e, n) {
  const { setClauses: r, values: i } = it(n, "elements");
  return t.run(`UPDATE elements SET ${r} WHERE id = ?`, [...i, e]);
}
function tc(t, e) {
  return t.run("DELETE FROM elements WHERE id = ?", [e]);
}
function nc(t, e) {
  return t.query(
    "SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC",
    [e]
  );
}
function rc(t, e) {
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
function ic(t, e, n) {
  const { setClauses: r, values: i } = it(n, "export_jobs");
  return t.run(`UPDATE export_jobs SET ${r} WHERE id = ?`, [...i, e]);
}
function pi(t, e) {
  const n = Fa(t, e);
  if (!n) throw new Error(`Project not found: ${e}`);
  const r = Ba(t, e), i = Pd(t, e), a = Vd(t, e), s = Qd(t, e), l = nc(t, e), u = Ld(t, e).map((c) => {
    const m = Fd(t, c.id), f = Bd(t, c.id), h = Jd(t, c.id), _ = f.map((y) => ({
      ...y,
      keyframes: zd(t, y.id)
    }));
    return { ...c, tracks: m, clips: _, transitions: h };
  }), d = u.length > 0 ? u[0].id : "";
  return {
    project: n,
    assets: r,
    mediaFolders: i,
    timelines: u,
    activeTimelineId: d,
    workflow: a,
    elements: s,
    exports: l
  };
}
function ac(t, e, n) {
  t.transaction(() => {
    Fa(t, e) ? $a(t, e, {
      name: n.project.name,
      updated_at: It(),
      resolution_width: n.project.resolution_width,
      resolution_height: n.project.resolution_height,
      frame_rate: n.project.frame_rate
    }) : Ma(t, { ...n.project, updated_at: It() });
    const i = new Set(
      t.query("SELECT id FROM media_folders WHERE project_id = ?", [e]).map((f) => f.id)
    ), a = new Set(n.mediaFolders.map((f) => f.id));
    for (const f of i)
      a.has(f) || (t.run("UPDATE assets SET folder_id = NULL WHERE folder_id = ?", [f]), t.run("DELETE FROM media_folders WHERE id = ?", [f]));
    for (const f of n.mediaFolders)
      i.has(f.id) ? Ud(t, f.id, {
        name: f.name,
        parent_id: f.parent_id
      }) : Cd(t, f);
    const s = new Set(
      t.query("SELECT id FROM assets WHERE project_id = ?", [e]).map((f) => f.id)
    ), l = new Set(n.assets.map((f) => f.id));
    for (const f of s)
      l.has(f) || Wa(t, f);
    for (const f of n.assets)
      if (s.has(f.id)) {
        const { id: h, project_id: _, created_at: y, ...p } = f;
        Xt(t, f.id, p);
      } else
        Ha(t, f);
    const o = new Set(
      t.query("SELECT id FROM timelines WHERE project_id = ?", [e]).map((f) => f.id)
    ), u = new Set(n.timelines.map((f) => f.id));
    for (const f of o)
      u.has(f) || Md(t, f);
    for (const f of n.timelines) {
      if (o.has(f.id))
        Dd(t, f.id, { name: f.name, duration: f.duration });
      else {
        const { tracks: E, clips: T, transitions: S, ...x } = f;
        za(t, x);
      }
      const h = new Set(
        t.query("SELECT id FROM tracks WHERE timeline_id = ?", [f.id]).map((E) => E.id)
      ), _ = new Set(f.tracks.map((E) => E.id));
      for (const E of h)
        _.has(E) || $d(t, E);
      for (const E of f.tracks)
        $n(t, E);
      const y = new Set(
        t.query("SELECT id FROM clips WHERE timeline_id = ?", [f.id]).map((E) => E.id)
      ), p = new Set(f.clips.map((E) => E.id));
      for (const E of y)
        p.has(E) || Wd(t, E);
      for (const E of f.clips) {
        const { keyframes: T, ...S } = E;
        Hd(t, S), Gd(
          t,
          E.id,
          T.map(({ id: x, ...v }) => v)
        );
      }
      const g = new Set(
        t.query("SELECT id FROM transitions WHERE timeline_id = ?", [f.id]).map((E) => E.id)
      ), b = new Set(f.transitions.map((E) => E.id));
      for (const E of g)
        b.has(E) || Xd(t, E);
      for (const E of f.transitions)
        Kd(t, E);
    }
    Yd(t, e, n.workflow);
    const d = new Set(
      t.query("SELECT id FROM elements WHERE project_id = ?", [e]).map((f) => f.id)
    ), c = new Set(n.elements.map((f) => f.id));
    for (const f of d)
      c.has(f) || tc(t, f);
    for (const f of n.elements)
      if (d.has(f.id)) {
        const { id: h, project_id: _, created_at: y, ...p } = f;
        ec(t, f.id, { ...p, updated_at: It() });
      } else
        Zd(t, f);
    const m = new Set(
      t.query("SELECT id FROM export_jobs WHERE project_id = ?", [e]).map((f) => f.id)
    );
    for (const f of n.exports)
      if (m.has(f.id)) {
        const { id: h, project_id: _, created_at: y, ...p } = f;
        ic(t, f.id, p);
      } else
        rc(t, f);
  });
}
const Ae = /* @__PURE__ */ new Map();
function xe(t) {
  let e = Ae.get(t);
  return e || (e = new Al(t), Ae.set(t, e)), e;
}
function Ga() {
  return w.join(He(), "projects.json");
}
async function or() {
  try {
    const t = await C.readFile(Ga(), "utf-8");
    return JSON.parse(t);
  } catch {
    return { projects: [] };
  }
}
async function lr(t) {
  await C.mkdir(He(), { recursive: !0 }), await C.writeFile(Ga(), JSON.stringify(t, null, 2), "utf-8");
}
async function sc(t) {
  const e = await or(), n = e.projects.findIndex((r) => r.id === t.id);
  n >= 0 ? e.projects[n] = t : e.projects.push(t), await lr(e);
}
async function oc(t) {
  const e = await or();
  e.projects = e.projects.filter((n) => n.id !== t), await lr(e);
}
function lc() {
  I.handle("db:project:create", async (t, e) => {
    const n = vt(), r = It();
    ma(n);
    const i = xe(n);
    Ma(i, {
      id: n,
      name: e,
      created_at: r,
      updated_at: r,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24
    });
    const s = vt();
    return za(i, {
      id: s,
      project_id: n,
      name: "Timeline 1",
      duration: 0,
      created_at: r
    }), $n(i, {
      id: vt(),
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
    }), $n(i, {
      id: vt(),
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
    }), await sc({
      id: n,
      name: e,
      createdAt: r,
      updatedAt: r,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
      useSqlite: !0
    }), pi(i, n);
  }), I.handle("db:project:load", async (t, e) => {
    const n = xe(e), r = pi(n, e);
    for (const i of r.assets)
      if (i.file_ref && !i.source_url) {
        const a = i.status;
        F.existsSync(i.file_ref) ? i.status === "offline" && (i.status = "online") : i.status = "offline", i.status !== a && Xt(n, i.id, { status: i.status });
      }
    return r;
  }), I.handle("db:project:save", async (t, e, n) => {
    const r = xe(e);
    ac(r, e, n);
    const i = It(), a = await or(), s = a.projects.find((l) => l.id === e);
    return s && (s.name = n.project.name, s.updatedAt = i, s.assetCount = n.assets.length, s.elementCount = n.elements.length, await lr(a)), { ok: !0 };
  }), I.handle("db:project:delete", async (t, e) => {
    const n = Ae.get(e);
    n && (n.close(), Ae.delete(e));
    const r = $e(e);
    try {
      await C.rm(r, { recursive: !0, force: !0 });
    } catch (i) {
      console.error(`[db:project:delete] Failed to remove directory ${r}:`, i);
    }
    return await oc(e), { ok: !0 };
  }), I.handle("db:project:close", async (t, e) => {
    const n = Ae.get(e);
    return n && (n.close(), Ae.delete(e)), { ok: !0 };
  }), I.handle(
    "db:project:update",
    async (t, e, n) => {
      const r = xe(e);
      return $a(r, e, n), { ok: !0 };
    }
  ), I.handle("db:asset:insert", async (t, e) => {
    const n = xe(e.project_id);
    return Ha(n, e), { ok: !0 };
  }), I.handle(
    "db:asset:update",
    async (t, e, n, r) => {
      const i = xe(e);
      return Xt(i, n, r), { ok: !0 };
    }
  ), I.handle("db:asset:delete", async (t, e, n) => {
    const r = xe(e);
    return Wa(r, n), { ok: !0 };
  });
}
function uc() {
  for (const [t, e] of Ae)
    try {
      e.close();
    } catch (n) {
      console.error(`[closeAllDbs] Failed to close DB for project ${t}:`, n);
    }
  Ae.clear();
}
const dc = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), cc = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
function xn(t, e) {
  const n = w.extname(t).toLowerCase();
  return dc.has(n) ? "video" : cc.has(n) ? "audio" : n ? "image" : e;
}
function fc(t, e) {
  if (t)
    try {
      const n = w.extname(new URL(t).pathname);
      if (n && n.length <= 8) return n;
    } catch {
      const n = w.extname(t);
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
async function mc(t, e) {
  let n = [];
  try {
    n = await C.readdir(t);
  } catch {
    return null;
  }
  const r = n.find((i) => i === e || i.startsWith(`${e}.`));
  return r ? w.join(t, r) : null;
}
function pc(t) {
  return t.startsWith("local-media://file") ? decodeURIComponent(t.replace(/^local-media:\/\/file/, "")) : null;
}
function yc(t) {
  if (!(t != null && t.trim())) return null;
  const e = t.trim(), n = pc(e) ?? e;
  return F.existsSync(n) ? n : null;
}
async function hc(t, e) {
  await C.mkdir(w.dirname(e), { recursive: !0 }), await C.copyFile(t, e);
}
function zt(t) {
  const e = $e(t.projectId), n = w.join(e, ".cache"), r = K.randomUUID(), i = {
    id: r,
    type: "extract_metadata",
    assetId: t.assetId,
    inputPath: t.inputPath,
    outputPath: "",
    projectDir: e
  };
  if (t.type !== "audio") {
    const a = w.join(n, "thumbnails");
    F.mkdirSync(a, { recursive: !0 }), ye({
      id: K.randomUUID(),
      type: "generate_thumbnail",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(a, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Thumbnail failed:", s));
  }
  if (ye(i).catch((a) => console.error("[generated-asset-persist] Metadata failed:", a)), t.type === "audio" || t.type === "video") {
    const a = w.join(n, "waveforms");
    F.mkdirSync(a, { recursive: !0 }), ye({
      id: K.randomUUID(),
      type: "compute_waveform",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(a, `${t.assetId}.json`),
      projectDir: e
    }).catch((s) => console.error("[generated-asset-persist] Waveform failed:", s));
  }
  if (t.type === "video") {
    const a = w.join(n, "filmstrips");
    F.mkdirSync(a, { recursive: !0 }), ye({
      id: K.randomUUID(),
      type: "generate_filmstrip",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(a, `${t.assetId}.jpg`),
      projectDir: e
    }).catch((l) => console.error("[generated-asset-persist] Filmstrip failed:", l));
    const s = w.join(n, "proxies");
    F.mkdirSync(s, { recursive: !0 }), ye({
      id: K.randomUUID(),
      type: "generate_proxy",
      assetId: t.assetId,
      inputPath: t.inputPath,
      outputPath: w.join(s, `${t.assetId}.mp4`),
      projectDir: e
    }).catch((l) => console.error("[generated-asset-persist] Proxy failed:", l));
  }
  return r;
}
async function yi(t) {
  var f;
  const { projectId: e, assetId: n, assetType: r } = t;
  if (!e || !n)
    throw new Error("projectId and assetId are required.");
  const i = $e(e), a = w.join(i, "media", "generated");
  await C.mkdir(a, { recursive: !0 });
  const s = await mc(a, n);
  if (s)
    return zt({
      assetId: n,
      projectId: e,
      inputPath: s,
      type: xn(s, r)
    }), {
      path: s,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const l = t.extension || fc(t.remoteUrl ?? t.localPathHint, r), o = w.join(a, `${n}${l}`), u = yc(t.localPathHint);
  if (u)
    return await hc(u, o), zt({
      assetId: n,
      projectId: e,
      inputPath: o,
      type: xn(o, r)
    }), {
      path: o,
      sourceUrl: t.remoteUrl,
      downloaded: !1
    };
  const d = (f = t.remoteUrl) == null ? void 0 : f.trim();
  if (!d)
    return { error: "No downloadable URL or local file path for this asset." };
  const c = await fetch(d);
  if (!c.ok)
    throw new Error(`Failed to download (HTTP ${c.status}). The URL may have expired.`);
  const m = await c.arrayBuffer();
  return await C.writeFile(o, Buffer.from(m)), zt({
    assetId: n,
    projectId: e,
    inputPath: o,
    type: xn(o, r)
  }), {
    path: o,
    sourceUrl: d,
    downloaded: !0
  };
}
let ue = null;
const je = /* @__PURE__ */ new Map(), Tt = /* @__PURE__ */ new Map(), gc = w.dirname(Wn(import.meta.url));
function Ja() {
  let t = w.join(gc, "workers", "media-worker.js");
  return t.includes("app.asar") && (t = t.replace("app.asar", "app.asar.unpacked")), t;
}
function _c() {
  return ue || (ue = new Ai(Ja()), ue.on("message", (t) => {
    switch (t.type) {
      case "ready":
        console.log("[media-worker] Worker ready");
        break;
      case "job:progress":
        for (const e of V.getAllWindows())
          e.webContents.send("media:job-progress", { jobId: t.jobId, progress: t.progress });
        break;
      case "job:complete": {
        const e = Tt.get(t.jobId);
        for (const r of V.getAllWindows())
          r.webContents.send("media:job-complete", {
            jobId: t.jobId,
            result: t.result,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        Tt.delete(t.jobId);
        const n = je.get(t.jobId);
        n && (n.resolve(t.result), je.delete(t.jobId));
        break;
      }
      case "job:error": {
        const e = Tt.get(t.jobId);
        for (const r of V.getAllWindows())
          r.webContents.send("media:job-error", {
            jobId: t.jobId,
            error: t.error,
            assetId: e == null ? void 0 : e.assetId,
            jobType: e == null ? void 0 : e.jobType
          });
        Tt.delete(t.jobId);
        const n = je.get(t.jobId);
        n && (n.reject(new Error(t.error)), je.delete(t.jobId));
        break;
      }
      case "sync:batch-progress":
        for (const e of V.getAllWindows())
          e.webContents.send("sync:batch-progress", {
            jobId: t.jobId,
            completedPairs: t.completedPairs,
            totalPairs: t.totalPairs,
            currentVideoName: t.currentVideoName,
            currentAudioName: t.currentAudioName
          });
        break;
    }
  }), ue.on("error", (t) => {
    console.error("[media-worker] Worker error:", t);
  }), ue.on("exit", (t) => {
    console.log(`[media-worker] Worker exited with code ${t}`), ue = null;
    for (const [e, n] of je)
      n.reject(new Error("Worker exited")), je.delete(e);
  }), ue.postMessage({
    type: "config",
    ffmpegPath: ge(),
    ffprobePath: ca(),
    fpcalcPath: fa()
  }), ue);
}
function ye(t) {
  return t.type === "sync_compute_offset" || t.type === "sync_batch_match" ? wc(t) : new Promise((e, n) => {
    je.set(t.id, { resolve: e, reject: n }), Tt.set(t.id, { assetId: t.assetId, jobType: t.type }), _c().postMessage({ type: "job:submit", job: t });
  });
}
function wc(t) {
  return new Promise((e, n) => {
    const r = new Ai(Ja());
    let i = !1;
    const a = () => {
      r.removeAllListeners(), r.terminate().catch(() => {
      });
    }, s = (o) => {
      i || (i = !0, a(), e(o));
    }, l = (o) => {
      i || (i = !0, a(), n(o));
    };
    r.on("message", (o) => {
      switch (o.type) {
        case "ready":
          r.postMessage({ type: "job:submit", job: t });
          break;
        case "job:complete":
          o.jobId === t.id && s(o.result);
          break;
        case "job:error":
          o.jobId === t.id && l(new Error(o.error));
          break;
        case "sync:batch-progress":
          for (const u of V.getAllWindows())
            u.webContents.send("sync:batch-progress", {
              jobId: o.jobId,
              completedPairs: o.completedPairs,
              totalPairs: o.totalPairs,
              currentVideoName: o.currentVideoName,
              currentAudioName: o.currentAudioName
            });
          break;
      }
    }), r.on("error", (o) => {
      l(o instanceof Error ? o : new Error(String(o)));
    }), r.on("exit", (o) => {
      !i && o !== 0 && l(new Error(`Sync worker exited with code ${o}`));
    }), r.postMessage({
      type: "config",
      ffmpegPath: ge(),
      ffprobePath: ca(),
      fpcalcPath: fa()
    });
  });
}
function bc(t) {
  const e = w.extname(t).toLowerCase(), n = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]), r = /* @__PURE__ */ new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a"]);
  return n.has(e) ? "video" : r.has(e) ? "audio" : "image";
}
function Ec() {
  I.handle("media:import", async (t, e) => {
    const { filePaths: n, projectId: r, mode: i } = e, a = $e(r), s = [], l = [];
    for (const o of n) {
      const u = K.randomUUID();
      let d = o;
      if (i === "copy") {
        const f = w.join(a, "media", "imported");
        await C.mkdir(f, { recursive: !0 });
        const h = `${u}${w.extname(o)}`, _ = w.join(f, h);
        await C.copyFile(o, _), d = _;
      }
      const c = bc(o), m = K.randomUUID();
      l.push({
        assetId: u,
        metadataJobId: m,
        inputPath: d,
        type: c,
        projectDir: a
      }), s.push({ assetId: u, jobId: m, filePath: d, type: c });
    }
    return setTimeout(() => {
      for (const o of l)
        zt({
          assetId: o.assetId,
          projectId: r,
          inputPath: o.inputPath,
          type: o.type
        });
    }, 0), s;
  }), I.handle("media:submit-job", async (t, e) => ye(e)), I.handle("media:cancel-job", async (t, e) => {
    const n = ue;
    return n && n.postMessage({ type: "job:cancel", jobId: e }), je.delete(e), { ok: !0 };
  }), I.handle("media:extract-frame", async (t, e) => {
    const { inputPath: n, timeSec: r } = e, i = ge(), a = w.join(z.tmpdir(), `cinegen-frame-${K.randomUUID()}.jpg`);
    return new Promise((s) => {
      const l = [
        "-y",
        "-ss",
        `${Math.max(0, r)}`,
        "-i",
        n,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        a
      ];
      kt(i, l, { timeout: 15e3 }, (o, u, d) => {
        if (o || !F.existsSync(a)) {
          s(null);
          return;
        }
        s({ outputPath: a });
      });
    });
  }), I.handle("media:write-temp-image", async (t, e) => {
    const n = e.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!n) throw new Error("media:write-temp-image expects a base64 image data URL.");
    const r = n[1] === "jpeg" ? "jpg" : n[1], i = Buffer.from(n[2], "base64"), a = w.join(z.tmpdir(), `cinegen-frame-chat-${K.randomUUID()}.${r}`);
    return await C.writeFile(a, i), { outputPath: a };
  }), I.handle("media:extract-clip", async (t, e) => {
    const { inputPath: n, startTimeSec: r, durationSec: i } = e, a = ge(), s = w.join(z.tmpdir(), `cinegen-clip-${K.randomUUID()}.mp4`), l = Math.max(0, r), o = Math.max(0.1, i);
    return new Promise((u) => {
      const d = [
        "-y",
        "-ss",
        `${l}`,
        "-i",
        n,
        "-t",
        `${o}`,
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
      kt(a, d, { timeout: Math.max(12e4, Math.ceil(o * 4e3)) }, (c, m, f) => {
        if (c || !F.existsSync(s)) {
          u(null);
          return;
        }
        u({ outputPath: s });
      });
    });
  }), I.handle("media:queue-processing", async (t, e) => {
    const {
      assetId: n,
      projectId: r,
      inputPath: i,
      needsProxy: a,
      includeThumbnail: s = !1,
      includeWaveform: l = !0,
      includeFilmstrip: o = !0
    } = e, u = $e(r), d = w.join(u, ".cache");
    if (s) {
      const c = w.join(d, "thumbnails");
      F.mkdirSync(c, { recursive: !0 });
      const m = {
        id: K.randomUUID(),
        type: "generate_thumbnail",
        assetId: n,
        inputPath: i,
        outputPath: w.join(c, `${n}.jpg`),
        projectDir: u
      };
      ye(m).catch((f) => console.error("[media-import] Thumbnail failed:", f));
    }
    if (l) {
      const c = w.join(d, "waveforms");
      F.mkdirSync(c, { recursive: !0 });
      const m = {
        id: K.randomUUID(),
        type: "compute_waveform",
        assetId: n,
        inputPath: i,
        outputPath: w.join(c, `${n}.json`),
        projectDir: u
      };
      ye(m).catch((f) => console.error("[media-import] Waveform failed:", f));
    }
    if (o) {
      const c = w.join(d, "filmstrips");
      F.mkdirSync(c, { recursive: !0 });
      const m = {
        id: K.randomUUID(),
        type: "generate_filmstrip",
        assetId: n,
        inputPath: i,
        outputPath: w.join(c, `${n}.jpg`),
        projectDir: u
      };
      ye(m).catch((f) => console.error("[media-import] Filmstrip failed:", f));
    }
    if (a) {
      const c = w.join(d, "proxies");
      F.mkdirSync(c, { recursive: !0 });
      const m = {
        id: K.randomUUID(),
        type: "generate_proxy",
        assetId: n,
        inputPath: i,
        outputPath: w.join(c, `${n}.mp4`),
        projectDir: u
      };
      ye(m).catch((f) => console.error("[media-import] Proxy failed:", f));
    }
    return { ok: !0 };
  }), I.handle(
    "media:download-remote",
    async (t, e) => {
      const { url: n, projectId: r, assetId: i, ext: a } = e;
      if (!n || !r) throw new Error("url and projectId are required");
      const s = await yi({
        projectId: r,
        assetId: i,
        assetType: "video",
        remoteUrl: n,
        extension: a
      });
      if ("error" in s) throw new Error(s.error);
      return { path: s.path };
    }
  ), I.handle(
    "media:persist-generated-asset",
    async (t, e) => {
      try {
        return await yi(e);
      } catch (n) {
        return {
          error: n instanceof Error ? n.message : String(n)
        };
      }
    }
  );
}
function vc() {
  ue && (ue.terminate(), ue = null);
}
function Tc(t) {
  I.handle("sync:compute-offset", async (e, n) => {
    const r = yr();
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
  }), I.handle("sync:batch-match", async (e, n) => {
    const r = yr();
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
const Sc = Ii(import.meta.url), xc = w.dirname(Wn(import.meta.url));
function jc() {
  return J.isPackaged ? w.join(process.resourcesPath, "native", "cinegen_avfoundation.node") : w.resolve(xc, "../native/avfoundation/build/Release/cinegen_avfoundation.node");
}
let Z = null, Bn = null;
if (process.platform === "darwin")
  try {
    const t = jc();
    Z = Sc(t), console.log("[native-video] AVFoundation addon loaded:", t);
  } catch (t) {
    Bn = t instanceof Error ? t.message : String(t), console.error("[native-video] Failed to load AVFoundation addon:", Bn);
  }
function Se() {
  return Z != null;
}
function qc() {
  return Bn;
}
function Ic(t, e) {
  return Z ? Z.createSurface(t, e) : !1;
}
function hi(t) {
  Z == null || Z.destroySurface(t);
}
function Ac(t, e, n, r, i) {
  Z == null || Z.setSurfaceRect(t, e, n, r, i);
}
function gi(t, e) {
  Z == null || Z.setSurfaceHidden(t, e);
}
function _i(t) {
  Z == null || Z.clearSurface(t);
}
function kc(t, e) {
  Z == null || Z.syncSurface(t, e);
}
function Rc() {
  I.handle("native-video:is-available", () => ({
    available: Se(),
    error: qc()
  })), I.handle("native-video:reset-surfaces", (t, e) => {
    if (!Se()) return !1;
    for (const n of e)
      gi(n, !0), _i(n), hi(n);
    return !0;
  }), I.handle("native-video:create-surface", (t, e) => {
    const n = V.fromWebContents(t.sender);
    return !n || !Se() ? !1 : Ic(e, n.getNativeWindowHandle());
  }), I.on("native-video:set-surface-rect", (t, e) => {
    Se() && Ac(e.surfaceId, e.x, e.y, e.width, e.height);
  }), I.on("native-video:set-surface-hidden", (t, e) => {
    Se() && gi(e.surfaceId, e.hidden);
  }), I.on("native-video:clear-surface", (t, e) => {
    Se() && _i(e);
  }), I.on("native-video:sync-surface", (t, e) => {
    Se() && kc(e.surfaceId, e.descriptors);
  }), I.on("native-video:destroy-surface", (t, e) => {
    Se() && hi(e);
  });
}
const Oc = "python3.12", Ka = w.join(z.homedir(), "Desktop", "Coding", "whisperx"), Nc = w.join(Ka, ".venv", "bin", "python");
function Pc(...t) {
  return J.isPackaged ? w.join(process.resourcesPath, ...t) : w.join(process.cwd(), ...t);
}
const Cc = Pc("scripts", "whisperx", "cinegen_infer.py"), Uc = "fal-ai/whisper", wi = "3", Lc = {
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
function Dc(t) {
  const e = w.extname(t).toLowerCase();
  return Lc[e] ?? "application/octet-stream";
}
function Vt(t) {
  const e = Number(t);
  if (Number.isFinite(e))
    return Math.round(Math.max(0, e) * 1e3) / 1e3;
}
function Mc(t, e) {
  const n = e.trim();
  return n ? t ? /^[,.;:!?%)\]}]/.test(n) || /^['’]/.test(n) ? `${t}${n}` : `${t} ${n}` : n : t;
}
function Fc(t) {
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
function Xa(t) {
  const e = [];
  let n = null;
  const r = () => {
    var i;
    n && (n.text = n.text.trim(), (n.text || (((i = n.words) == null ? void 0 : i.length) ?? 0) > 0) && e.push(n), n = null);
  };
  for (let i = 0; i < t.length; i++) {
    const a = t[i];
    n || (n = {
      start: a.start,
      end: a.end,
      text: "",
      ...a.speaker ? { speaker: a.speaker } : {},
      words: []
    }), n.words.push(a), n.end = a.end, n.text = Mc(n.text, a.word), !n.speaker && a.speaker && (n.speaker = a.speaker);
    const s = t[i + 1], l = s ? Math.max(0, s.start - a.end) : 0, o = !!s && (s.speaker ?? null) !== (n.speaker ?? null), u = n.end - n.start, d = /[.!?]["')\]]*$/.test(a.word), c = l >= 0.85 || l >= 0.45 && /[,;:]$/.test(a.word), m = u >= 12;
    (!s || d || c || m || o) && r();
  }
  return r(), e;
}
function $c(t) {
  const e = t.flatMap((n) => Array.isArray(n.words) ? n.words.flatMap((r) => {
    if (!r || typeof r.word != "string") return [];
    const i = Vt(r.start), a = Vt(r.end);
    return i === void 0 || a === void 0 ? [] : [{
      word: r.word.trim(),
      start: i,
      end: a,
      ...r.prob !== void 0 ? { prob: r.prob } : {},
      ...r.speaker !== void 0 ? { speaker: r.speaker } : {}
    }];
  }) : []);
  return e.length === 0 ? t : Xa(e);
}
function Bc(t) {
  const e = (t == null ? void 0 : t.data) ?? t, n = typeof (e == null ? void 0 : e.text) == "string" ? e.text : "", r = e == null ? void 0 : e.chunks, i = e, a = Array.isArray(r) ? r.flatMap((d) => {
    if (!d || typeof d != "object") return [];
    const c = typeof d.text == "string" ? d.text.trim() : "", m = d.timestamp, f = Array.isArray(m) ? Vt(m[0]) : void 0, h = Array.isArray(m) ? Vt(m[1]) : void 0, _ = Fc(d.speaker);
    return !c && f === void 0 && h === void 0 ? [] : [{ text: c, start: f, end: h, speaker: _ }];
  }) : [], s = a.flatMap((d) => !d.text || d.start === void 0 || d.end === void 0 ? [] : [{
    word: d.text,
    start: d.start,
    end: d.end,
    ...d.speaker ? { speaker: d.speaker } : {}
  }]), l = s.length > 0 ? Xa(s) : a.map((d) => ({
    text: d.text,
    start: d.start ?? 0,
    end: d.end ?? d.start ?? 0,
    ...d.speaker ? { speaker: d.speaker } : {}
  }));
  let o = "";
  const u = [i.language, i.languages, i.inferred_languages];
  for (const d of u) {
    if (typeof d == "string" && d.trim()) {
      o = d.trim();
      break;
    }
    if (Array.isArray(d)) {
      const c = d.find((m) => typeof m == "string" && m.trim().length > 0);
      if (c) {
        o = c.trim();
        break;
      }
    }
  }
  return {
    text: n || l.map((d) => d.text).filter(Boolean).join(" "),
    segments: l,
    language: o
  };
}
async function Hc(t) {
  const e = w.join(
    z.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`
  ), n = ge(), r = [
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
  return await new Promise((i, a) => {
    var o;
    const s = ne(n, r, { stdio: ["ignore", "ignore", "pipe"] });
    let l = "";
    (o = s.stderr) == null || o.on("data", (u) => {
      l += u.toString();
    }), s.on("error", a), s.on("close", (u) => {
      if (u === 0) {
        i();
        return;
      }
      a(new Error(l.trim() || `ffmpeg exited with code ${u}`));
    });
  }), e;
}
const Wc = `
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
`, bi = /* @__PURE__ */ new Map();
function zc() {
  return V.getAllWindows().find((t) => !t.isDestroyed());
}
function Oe(t, e) {
  var n;
  (n = zc()) == null || n.webContents.send("transcription:progress", {
    jobId: t.jobId,
    assetId: t.assetId,
    engine: t.engine,
    ...e
  });
}
async function Gc(t) {
  try {
    const e = xe(t.projectId), n = Ba(e, t.projectId).find((a) => a.id === t.assetId), i = {
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
    Xt(e, t.assetId, { metadata: JSON.stringify(i) });
  } catch (e) {
    console.error("[transcription] failed to save to db:", e);
  }
}
async function ur(t) {
  t.status = "done", t.segments = $c(t.segments), t.fullText.trim() || (t.fullText = t.segments.map((e) => e.text).filter(Boolean).join(" ")), await Gc(t), Oe(t, {
    type: "done",
    text: t.fullText,
    segments: t.segments,
    language: t.language
  });
}
function Fe(t, e) {
  t.status = "error", t.error = e, Oe(t, { type: "error", error: e });
}
function Jc(t, e) {
  const n = e.model ?? "large", r = e.language ?? "auto";
  t.model = n, (async () => {
    const i = w.join(z.tmpdir(), `cinegen-whisper-${t.jobId}.py`);
    await C.writeFile(i, Wc, "utf-8");
    const a = ne(Oc, [i, e.filePath, n, r], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    t.status = "running", Oe(t, { type: "status", status: "running" }), a.stdout.on("data", (s) => {
      for (const l of s.toString().split(`
`)) {
        const o = l.trim();
        if (o)
          try {
            const u = JSON.parse(o);
            if (u.type === "segment") {
              const d = {
                text: u.text,
                start: u.start ?? 0,
                end: u.end ?? 0,
                ...Array.isArray(u.words) && u.words.length > 0 ? { words: u.words } : {}
              };
              t.segments.push(d), Oe(t, { type: "segment", ...d });
            } else u.type === "done" && (t.fullText = u.text, t.language = u.language ?? "");
          } catch {
          }
      }
    }), a.stderr.on("data", () => {
    }), a.on("close", async (s) => {
      if (await C.unlink(i).catch(() => {
      }), s !== 0) {
        Fe(t, `whisper process exited with code ${s}`);
        return;
      }
      await ur(t);
    }), a.on("error", async (s) => {
      await C.unlink(i).catch(() => {
      }), Fe(t, s.message);
    });
  })().catch((i) => {
    Fe(t, i instanceof Error ? i.message : String(i));
  });
}
function Kc(t, e) {
  t.model = "base";
  const n = [
    Cc,
    "--audio_path",
    e.filePath,
    "--model",
    "base",
    "--no_diarize"
  ];
  e.language && e.language !== "auto" && n.push("--language", e.language);
  const r = { ...process.env };
  process.env.HF_TOKEN && (r.HF_TOKEN = process.env.HF_TOKEN);
  const i = ne(Nc, n, {
    cwd: Ka,
    stdio: ["ignore", "pipe", "pipe"],
    env: r
  });
  t.status = "running", Oe(t, { type: "status", status: "running" });
  let a;
  i.stdout.on("data", (s) => {
    for (const l of s.toString().split(`
`)) {
      const o = l.trim();
      if (o)
        try {
          const u = JSON.parse(o);
          u.type === "progress" ? (u.output_text !== void 0 && (t.fullText = u.output_text), u.segments && (t.segments = u.segments), u.language !== void 0 && (t.language = u.language), Oe(t, {
            type: "progress",
            stage: u.stage,
            message: u.message,
            ...u.output_text !== void 0 ? { text: u.output_text } : {},
            ...u.segments ? { segments: u.segments } : {},
            ...u.language !== void 0 ? { language: u.language } : {}
          })) : u.type === "done" ? (u.output_text !== void 0 && (t.fullText = u.output_text), u.segments && (t.segments = u.segments), u.language !== void 0 && (t.language = u.language), a = u.transcript_path) : u.type === "error" && Fe(t, u.error ?? "WhisperX error");
        } catch {
        }
    }
  }), i.stderr.on("data", () => {
  }), i.on("close", async (s) => {
    if (t.status !== "error") {
      if (s !== 0) {
        Fe(t, `whisperx process exited with code ${s}`);
        return;
      }
      if (a)
        try {
          const l = await C.readFile(a, "utf-8"), o = JSON.parse(l);
          o.output_text !== void 0 && (t.fullText = o.output_text), o.segments && (t.segments = o.segments), o.language !== void 0 && (t.language = o.language), o.model && (t.model = o.model);
        } finally {
          await C.unlink(a).catch(() => {
          });
        }
      await ur(t);
    }
  }), i.on("error", (s) => {
    Fe(t, s.message);
  });
}
function Xc(t, e) {
  (async () => {
    if (!e.apiKey) throw new Error("No fal.ai API key provided. Add one in Settings.");
    t.model = wi, t.status = "running", Oe(t, { type: "status", status: "running", stage: "uploading", message: "Preparing audio for cloud transcription" }), G.fal.config({ credentials: e.apiKey });
    const n = await Hc(e.filePath);
    let r = "";
    try {
      const l = await C.readFile(n), u = `${w.basename(e.filePath, w.extname(e.filePath))}.m4a`, d = Dc(n), c = new Blob([l], { type: d }), m = new File([c], u, { type: d });
      r = await G.fal.storage.upload(m);
    } finally {
      await C.unlink(n).catch(() => {
      });
    }
    Oe(t, { type: "status", status: "running", stage: "transcribing", message: "Running cloud transcription" });
    const i = {
      audio_url: r,
      task: "transcribe",
      chunk_level: "word",
      version: wi,
      ...e.language && e.language !== "auto" ? { language: e.language } : {}
    }, a = await G.fal.subscribe(Uc, { input: i, logs: !0 }), s = Bc(a);
    t.fullText = s.text, t.segments = s.segments, t.language = s.language, await ur(t);
  })().catch((n) => {
    Fe(t, n instanceof Error ? n.message : String(n));
  });
}
function Vc() {
  I.handle("transcription:start", async (t, e) => {
    const {
      projectId: n,
      assetId: r,
      filePath: i,
      model: a = "large",
      language: s = "auto",
      engine: l = "faster-whisper-local",
      apiKey: o
    } = e, u = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, d = {
      jobId: u,
      assetId: r,
      projectId: n,
      engine: l,
      status: "pending",
      segments: [],
      fullText: "",
      language: ""
    };
    return bi.set(u, d), l === "whisperx-local" ? Kc(d, { filePath: i, language: s }) : l === "whisper-cloud" ? Xc(d, { filePath: i, language: s, apiKey: o }) : Jc(d, { filePath: i, model: a, language: s }), { jobId: u };
  }), I.handle("transcription:get", (t, e) => {
    const n = bi.get(e);
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
const dr = w.join(z.homedir(), "Desktop", "Coding", "ltx"), Yc = w.join(dr, ".venv", "bin", "python"), Qc = w.join(dr, "cinegen_infer.py"), cr = w.join(z.homedir(), "Desktop", "Coding", "qwen-edit"), Zc = w.join(cr, ".venv", "bin", "python"), ef = w.join(cr, "cinegen_infer.py"), Va = w.join(z.homedir(), "Desktop", "Coding", "layer-decompose"), tf = w.join(Va, ".venv", "bin", "python"), Ya = w.join(z.homedir(), "Desktop", "Coding", "whisperx"), nf = w.join(Ya, ".venv", "bin", "python");
function Qa(...t) {
  return J.isPackaged ? w.join(process.resourcesPath, ...t) : w.join(process.cwd(), ...t);
}
const rf = Qa("scripts", "layer-decompose", "cinegen_infer.py"), af = Qa("scripts", "whisperx", "cinegen_infer.py"), sf = {
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
}, Ei = /* @__PURE__ */ new Map();
function of() {
  return V.getAllWindows().find((t) => !t.isDestroyed());
}
function Xe(t, e) {
  var n;
  (n = of()) == null || n.webContents.send("local-model:progress", { jobId: t, ...e });
}
async function $t(t, e) {
  if (t.startsWith("http://") || t.startsWith("https://")) {
    const n = w.extname(new URL(t).pathname) || ".jpg", r = w.join(z.tmpdir(), `cinegen-img-${e}${n}`), i = await fetch(t);
    if (!i.ok) throw new Error(`Failed to download image: ${i.status}`);
    const a = await i.arrayBuffer();
    return await C.writeFile(r, Buffer.from(a)), { imagePath: r, tempPath: r };
  } else if (t.startsWith("local-media://file/"))
    return { imagePath: decodeURIComponent(t.replace("local-media://file", "")), tempPath: null };
  return { imagePath: t, tempPath: null };
}
function lf() {
  I.handle("local-model:run", async (t, e) => {
    const { inputs: n } = e, r = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, i = { jobId: r, status: "pending" };
    Ei.set(r, i);
    let a, s = null;
    if (e.nodeType === "qwen-edit-local") {
      const l = String(n.prompt ?? ""), o = Number(n.num_inference_steps ?? 50), u = Number(n.guidance_scale ?? 1), d = Number(n.true_cfg_scale ?? 4), c = Number(n.seed ?? 42);
      let m = null;
      if (n.image_url) {
        const h = await $t(String(n.image_url), r);
        m = h.imagePath, s = h.tempPath;
      }
      if (!m) throw new Error("Qwen Image Edit requires an input image");
      const f = [
        ef,
        "--image_path",
        m,
        "--prompt",
        l,
        "--num_inference_steps",
        String(o),
        "--guidance_scale",
        String(u),
        "--true_cfg_scale",
        String(d),
        "--seed",
        String(c)
      ];
      a = ne(Zc, f, {
        cwd: cr,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "layer-decompose") {
      console.log("[layer-decompose] inputs:", JSON.stringify(n, null, 2));
      const l = String(n.prompts ?? "").trim(), o = String(n.inpainter ?? "qwen-edit-local"), u = !!(n.reconstruct_bg ?? !0), d = Number(n.seed ?? 42);
      let c = null;
      if (n.image_url) {
        console.log("[layer-decompose] resolving image_url:", n.image_url);
        const h = await $t(String(n.image_url), r);
        c = h.imagePath, s = h.tempPath, console.log("[layer-decompose] resolved to:", c);
      }
      if (!c) throw new Error("Layer Decompose requires an input image");
      const f = [
        rf,
        "--image_path",
        c,
        "--inpainter",
        u && o === "lama" ? "lama" : "none",
        "--seed",
        String(d)
      ];
      l && f.push("--prompts", l), a = ne(tf, f, {
        cwd: Va,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } else if (e.nodeType === "whisperx-local") {
      console.log("[whisperx] inputs:", JSON.stringify(n, null, 2));
      const l = String(n.model ?? "base"), o = String(n.language ?? "").trim(), u = n.diarize !== !1;
      let d = null;
      if (n.audio_url) {
        console.log("[whisperx] resolving audio_url:", n.audio_url);
        const h = await $t(String(n.audio_url), r);
        d = h.imagePath, s = h.tempPath, console.log("[whisperx] resolved to:", d);
      }
      if (!d) throw new Error("WhisperX requires an audio input");
      const c = [
        af,
        "--audio_path",
        d,
        "--model",
        l
      ];
      o && c.push("--language", o), u || c.push("--no_diarize");
      const m = process.env.HF_TOKEN, f = { ...process.env };
      m && (f.HF_TOKEN = m), a = ne(nf, c, {
        cwd: Ya,
        stdio: ["ignore", "pipe", "pipe"],
        env: f
      });
    } else {
      const l = String(n.prompt ?? ""), o = String(n.resolution ?? "896x512"), { height: u, width: d } = sf[o] ?? { height: 512, width: 896 }, c = Number(n.frame_rate ?? 24), m = Number(n.duration_secs ?? 4), f = Math.round(m * c / 8) * 8 + 1, h = Math.max(9, f), _ = Number(n.seed ?? 42), y = !!n.enhance_prompt;
      let p = null;
      if (n.image_url) {
        const b = await $t(String(n.image_url), r);
        p = b.imagePath, s = b.tempPath;
      }
      const g = [
        Qc,
        "--prompt",
        l,
        "--height",
        String(u),
        "--width",
        String(d),
        "--num_frames",
        String(h),
        "--frame_rate",
        String(c),
        "--seed",
        String(_)
      ];
      p && g.push("--image_path", p), y && g.push("--enhance_prompt"), a = ne(Yc, g, {
        cwd: dr,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }
    return i.status = "running", Xe(r, { type: "status", status: "running" }), a.stdout.on("data", (l) => {
      for (const o of l.toString().split(`
`)) {
        const u = o.trim();
        if (u)
          try {
            const d = JSON.parse(u);
            d.type === "progress" ? (i.stage = d.stage, d.output_text !== void 0 && (i.outputText = d.output_text), d.segments && (i.segments = d.segments), d.language !== void 0 && (i.language = d.language), Xe(r, {
              type: "progress",
              stage: d.stage,
              message: d.message,
              ...d.output_text !== void 0 && { output_text: d.output_text },
              ...d.segments && { segments: d.segments },
              ...d.language !== void 0 && { language: d.language }
            })) : d.type === "done" ? (i.status = "done", i.outputPath = d.output_path, i.outputText = d.output_text, i.transcriptPath = d.transcript_path, i.segments = d.segments, i.language = d.language, Xe(r, {
              type: "done",
              output_path: d.output_path,
              ...d.output_text !== void 0 && { output_text: d.output_text },
              ...d.transcript_path !== void 0 && { transcript_path: d.transcript_path },
              ...d.segments && { segments: d.segments },
              ...d.language !== void 0 && { language: d.language },
              ...d.layers && { layers: d.layers },
              ...d.needs_inpainting !== void 0 && { needs_inpainting: d.needs_inpainting },
              ...d.combined_mask_path && { combined_mask_path: d.combined_mask_path }
            })) : d.type === "error" && (i.status = "error", i.error = d.error, Xe(r, { type: "error", error: d.error }));
          } catch {
          }
      }
    }), a.stderr.on("data", () => {
    }), a.on("error", (l) => {
      i.status = "error", i.error = l.message, Xe(r, { type: "error", error: l.message });
    }), a.on("close", (l) => {
      s && C.unlink(s).catch(() => {
      }), l !== 0 && i.status !== "done" && (i.status = "error", i.error = i.error ?? `Process exited with code ${l}`, Xe(r, { type: "error", error: i.error }));
    }), { jobId: r };
  }), I.handle("local-model:get", (t, e) => {
    const n = Ei.get(e);
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
  }), I.handle("local-model:read-transcript", async (t, e) => {
    try {
      const n = await C.readFile(e, "utf8");
      return JSON.parse(n);
    } catch (n) {
      return console.error("[local-model] failed to read transcript:", n), null;
    }
  });
}
const fr = w.join(z.homedir(), "Desktop", "Coding", "Sam3"), uf = w.join(fr, ".venv", "bin", "python"), df = w.join(fr, "cinegen_server.py"), cf = 120 * 1e3, ff = 500, mf = 60;
class pf {
  constructor() {
    this.proc = null, this.port = 0, this.idleTimer = null;
  }
  async start() {
    var e, n;
    return this.proc && !this.proc.killed ? this.port : (this.port = await this.findFreePort(), console.log(`[sam3] Starting server on port ${this.port}`), this.proc = ne(uf, [df, "--port", String(this.port)], {
      cwd: fr,
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
    }, cf);
  }
  async findFreePort() {
    return new Promise((e, n) => {
      const r = is.createServer();
      r.listen(0, "127.0.0.1", () => {
        const i = r.address();
        if (i && typeof i == "object") {
          const a = i.port;
          r.close(() => e(a));
        } else
          n(new Error("Could not find free port"));
      });
    });
  }
  async waitForHealth() {
    console.log(`[sam3] Waiting for health on port ${this.port}...`);
    for (let e = 0; e < mf; e++) {
      try {
        if ((await fetch(`http://127.0.0.1:${this.port}/health`)).ok) {
          console.log(`[sam3] Health check passed after ${e + 1} attempts`);
          return;
        }
      } catch {
      }
      await new Promise((n) => setTimeout(n, ff));
    }
    throw console.error("[sam3] Health check timed out after 30 seconds"), new Error("SAM 3 server failed to start within 30 seconds");
  }
}
const St = new pf();
function yf() {
  I.handle("sam3:start", async () => ({ port: await St.ensureRunning() })), I.handle("sam3:stop", async () => {
    await St.stop();
  }), I.handle("sam3:port", () => ({ port: St.getPort(), running: St.isRunning() }));
}
function hf() {
  St.stop();
}
function gf(t, e, n) {
  const r = n === "video" ? "video clip" : "image";
  return [
    t.trim() || `Describe this ${r} in detail.`,
    `Attached ${r}: "${e}".`,
    "Describe what you actually see and hear — specific subjects, actions, setting, camera movement, on-screen text, and spoken dialogue.",
    "Do not answer from clip names, storyboard labels, or generic production terminology alone."
  ].join(`
`);
}
async function _f(t) {
  const e = t.workspaceDir ?? w.join(J.getPath("userData"), "gemini-cli-workspace"), n = await ar(t.visualRefs, e);
  if (n.length === 0)
    throw new Error("Could not load the attached clip or asset files for visual analysis.");
  try {
    const r = [];
    for (const i of n) {
      const a = gf(t.prompt, i.label, i.mediaType), s = i.mediaType === "video" ? await Ea({
        apiKey: t.apiKey,
        videoPath: i.mediaPath,
        prompt: a,
        detailedAnalysis: !0
      }) : await Yl({
        apiKey: t.apiKey,
        imagePath: i.mediaPath,
        prompt: a
      });
      r.push({
        label: i.label,
        mediaType: i.mediaType,
        analysis: s
      });
    }
    return r;
  } finally {
    sr(n);
  }
}
function wf() {
  I.handle("copilot:analyze-visual-refs", async (t, e) => _f(e));
}
const bf = 1, Ef = -30, vf = 0.3;
function Tf(t) {
  const e = [];
  let n = null;
  for (const r of t.split(/\r?\n/)) {
    const i = r.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (i) {
      n = Number(i[1]);
      continue;
    }
    const a = r.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (a && n !== null) {
      const s = Number(a[1]);
      Number.isFinite(s) && s > n && e.push({ start: n, end: s }), n = null;
    }
  }
  return e;
}
function vi(t) {
  return t.toFixed(2);
}
function Sf(t) {
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
  const r = n.map((i) => `[${vi(i.start)}-${vi(i.end)}] ${i.text}`).join(`
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
function xf(t) {
  var i;
  const e = t.trim();
  if (!e) return null;
  const n = (a) => {
    try {
      return JSON.parse(a), a;
    } catch {
      return null;
    }
  }, r = n(e);
  if (r) return r;
  for (const a of e.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const s = (i = a[1]) == null ? void 0 : i.trim();
    if (s && n(s)) return s;
  }
  for (const [a, s] of [["{", "}"], ["[", "]"]]) {
    const l = e.indexOf(a);
    if (l === -1) continue;
    let o = 0;
    for (let u = l; u < e.length; u++) {
      const d = e[u];
      if (d === a) o++;
      else if (d === s && (o--, o === 0)) {
        const c = e.slice(l, u + 1), m = n(c);
        if (m) return m;
        break;
      }
    }
  }
  return null;
}
function jn(t) {
  const e = Number(t);
  return Number.isFinite(e) ? e : void 0;
}
function Ve(t) {
  return typeof t == "string" && t.trim() ? t.trim() : void 0;
}
function jf(t) {
  if (!Array.isArray(t)) return;
  const e = t.filter((n) => typeof n == "string" && n.trim().length > 0).map((n) => n.trim());
  return e.length > 0 ? e : void 0;
}
function qf(t) {
  const e = xf(t);
  if (!e) return [];
  let n;
  try {
    n = JSON.parse(e);
  } catch {
    return [];
  }
  return (Array.isArray(n) ? n : n && typeof n == "object" && Array.isArray(n.segments) ? n.segments : []).flatMap((i) => {
    if (!i || typeof i != "object") return [];
    const a = i, s = jn(a.start), l = jn(a.end);
    return s === void 0 || l === void 0 || l <= s ? [] : [{
      start: s,
      end: l,
      delivery: Ve(a.delivery),
      emotion: Ve(a.emotion),
      energy: Ve(a.energy),
      pace: Ve(a.pace),
      notable: jf(a.notable),
      content: Ve(a.content),
      shotType: Ve(a.shotType),
      cutawayCandidate: typeof a.cutawayCandidate == "boolean" ? a.cutawayCandidate : void 0,
      confidence: jn(a.confidence)
    }];
  });
}
function If(t) {
  return new Promise((e) => {
    const n = [
      "-i",
      t,
      "-af",
      `silencedetect=noise=${Ef}dB:d=${vf}`,
      "-f",
      "null",
      "-"
    ], r = ne(ge(), n);
    let i = "";
    r.stderr.on("data", (a) => {
      i += a.toString();
    }), r.on("error", () => e("")), r.on("close", () => e(i));
  });
}
const Za = "gemini-2.5-flash", Af = "fal-ai/video-understanding";
async function kf(t, e) {
  var r;
  const n = ((r = t.model) == null ? void 0 : r.trim()) || Za;
  try {
    return { rawText: await La({
      mediaPath: t.mediaPath,
      prompt: e,
      model: n
    }), model: n };
  } catch (i) {
    if (!(i instanceof Kt)) throw i;
    if (!t.apiKey)
      throw new Error("Gemini CLI could not analyze this clip and no fal.ai API key is set for fallback.");
    return { rawText: await Ea({
      apiKey: t.apiKey,
      videoPath: t.mediaPath,
      prompt: e,
      detailedAnalysis: !0
    }), model: Af };
  }
}
async function Rf(t) {
  var n;
  const e = {
    assetId: t.assetId,
    status: "failed",
    version: bf,
    model: ((n = t.model) == null ? void 0 : n.trim()) || Za,
    silenceMap: [],
    segments: [],
    hasSpeech: t.transcript.length > 0,
    sourceDurationSec: t.durationSec
  };
  try {
    const r = await If(t.mediaPath).catch(() => ""), i = Tf(r), a = Sf({ assetName: t.assetName, transcript: t.transcript }), { rawText: s, model: l } = await kf(t, a), o = qf(s);
    return {
      ...e,
      model: l,
      status: "ready",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      silenceMap: i,
      segments: o,
      error: i.length === 0 ? "Silence detection returned no intervals." : void 0
    };
  } catch (r) {
    const i = r instanceof Error ? r.message : String(r);
    return { ...e, error: i || "Acoustic analysis failed." };
  }
}
function Of() {
  I.handle("acoustic:analyze-asset", async (t, e) => Rf(e));
}
const Nf = process.platform === "darwin" && !J.isPackaged;
Nf && (J.disableHardwareAcceleration(), J.commandLine.appendSwitch("disable-gpu-compositing"), console.log("[app] hardware acceleration disabled for macOS dev wake stability"));
J.commandLine.appendSwitch("disable-renderer-backgrounding");
J.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
qi.registerSchemesAsPrivileged([
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
let Q = null, bt = null, Y = null, Ie = null;
const Pf = Date.now(), Ti = "cinegen-desktop", Si = "CineGen", Cf = ".cinegen-user-data-migrated.json", xi = "CineGen", Uf = 700;
process.on("message", (t) => {
  if (t === "electron-vite&type=hot-reload")
    for (const e of V.getAllWindows())
      e.isDestroyed() || e.webContents.reload();
});
function qn(t) {
  for (const e of V.getAllWindows())
    e.isDestroyed() || e.webContents.send("app:power-event", { type: t });
}
const Lf = {
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
function Df() {
  try {
    const t = J.getPath("appData"), e = w.join(t, Ti), n = w.join(t, Si);
    return J.getPath("userData") !== n && J.setPath("userData", n), console.log("[app] userData path:", n), { preferredUserDataPath: n, legacyUserDataPath: e };
  } catch (t) {
    console.error("[app] failed to configure userData path:", t);
    const e = J.getPath("appData"), n = w.join(e, Si), r = w.join(e, Ti);
    return { preferredUserDataPath: n, legacyUserDataPath: r };
  }
}
const Mf = Df();
try {
  J.setName(xi), process.platform === "darwin" && J.setAboutPanelOptions({
    applicationName: xi,
    applicationVersion: J.getVersion(),
    version: J.getVersion()
  });
} catch (t) {
  console.error("[app] failed to configure app display name:", t);
}
async function Ff() {
  const { preferredUserDataPath: t, legacyUserDataPath: e } = Mf;
  if (t === e || !F.existsSync(e)) return;
  const n = w.join(t, Cf);
  if (!F.existsSync(n))
    try {
      await C.mkdir(t, { recursive: !0 }), await C.cp(e, t, { recursive: !0, force: !0 }), await C.writeFile(
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
function $f() {
  const t = process.platform === "darwin" ? ["CineGen.png", "CineGen.icns"] : process.platform === "win32" ? ["CineGen.ico", "CineGen.png"] : ["CineGen.png"], e = [
    process.cwd(),
    J.getAppPath(),
    process.resourcesPath
  ], n = [];
  for (const r of e)
    for (const i of t) {
      const a = w.join(r, "build", i);
      F.existsSync(a) && n.push(a);
    }
  return n;
}
function Bf(t) {
  const e = w.extname(t).toLowerCase();
  return Lf[e] ?? "application/octet-stream";
}
function Hf(t, e) {
  return t.get(e) ?? t.get(e.toLowerCase()) ?? t.get(e.toUpperCase());
}
function Wf(t, e) {
  var s;
  if (!t.startsWith("bytes=")) return null;
  const n = ((s = t.slice(6).split(",")[0]) == null ? void 0 : s.trim()) ?? "", r = /^(\d*)-(\d*)$/.exec(n);
  if (!r) return null;
  const i = r[1], a = r[2];
  if (!i && a) {
    const l = Number.parseInt(a, 10);
    if (!Number.isFinite(l) || l <= 0) return null;
    const o = Math.max(e - l, 0), u = e - 1;
    return o <= u ? { start: o, end: u } : null;
  }
  if (i) {
    const l = Number.parseInt(i, 10), o = a ? Number.parseInt(a, 10) : e - 1;
    if (!Number.isFinite(l) || !Number.isFinite(o)) return null;
    const u = Math.min(o, e - 1);
    return l < 0 || u < l || l >= e ? null : { start: l, end: u };
  }
  return null;
}
function zf(t) {
  const e = new URL(t);
  if (e.hostname !== "file") return null;
  let n = decodeURIComponent(e.pathname);
  return process.platform === "win32" && n.startsWith("/") && (n = n.slice(1)), w.normalize(n);
}
async function Gf() {
  var r, i, a, s;
  const t = w.join(process.cwd(), ".data", "dev", "project.json"), e = w.join(z.homedir(), "Documents", "CINEGEN"), n = w.join(e, "projects.json");
  try {
    await C.access(t);
  } catch {
    return;
  }
  try {
    await C.access(n);
    return;
  } catch {
  }
  try {
    const l = await C.readFile(t, "utf-8"), o = JSON.parse(l), u = ((r = o.project) == null ? void 0 : r.id) || K.randomUUID(), d = ((i = o.project) == null ? void 0 : i.name) || "Migrated Project";
    await C.mkdir(w.join(e, u), { recursive: !0 }), await C.writeFile(
      w.join(e, u, "project.json"),
      JSON.stringify(o, null, 2),
      "utf-8"
    );
    const c = {
      projects: [{
        id: u,
        name: d,
        createdAt: ((a = o.project) == null ? void 0 : a.createdAt) || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: ((s = o.project) == null ? void 0 : s.updatedAt) || (/* @__PURE__ */ new Date()).toISOString(),
        assetCount: Array.isArray(o.assets) ? o.assets.length : 0,
        elementCount: Array.isArray(o.elements) ? o.elements.length : 0,
        thumbnail: null
      }]
    };
    await C.writeFile(n, JSON.stringify(c, null, 2), "utf-8"), console.log(`[migration] Migrated legacy project "${d}" to ${e}/${u}`);
  } catch (l) {
    console.error("[migration] Failed to migrate legacy data:", l);
  }
}
J.whenReady().then(async () => {
  if (await Ff(), process.platform === "darwin") {
    const n = $f();
    console.log("[dock] icon candidates:", n);
    for (const r of n)
      try {
        const i = rs.createFromPath(r);
        if (console.log("[dock] testing icon:", r, "empty?", i.isEmpty()), !i.isEmpty()) {
          await Promise.resolve(J.dock.setIcon(i)), console.log("[dock] applied icon:", r);
          break;
        }
      } catch (i) {
        console.error("[dock] failed to apply icon:", r, i);
      }
  }
  qi.handle("local-media", async (n) => {
    try {
      const r = zf(n.url);
      if (!r)
        return new Response("Invalid local-media host", { status: 400 });
      const i = await C.stat(r);
      if (!i.isFile())
        return new Response("Not a file", { status: 404 });
      const a = i.size, s = Bf(r), l = Hf(n.headers, "range");
      if (n.method.toUpperCase() === "HEAD")
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": s,
            "Content-Length": String(a),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      if (l) {
        const d = Wf(l, a);
        if (!d)
          return new Response("Invalid Range", { status: 416 });
        const c = d.start, m = d.end;
        if (c < 0 || m < c || c >= a)
          return new Response("Range Not Satisfiable", {
            status: 416,
            headers: {
              "Content-Range": `bytes */${a}`
            }
          });
        const f = m - c + 1, h = F.createReadStream(r, { start: c, end: m }), _ = hr.toWeb(h);
        return new Response(_, {
          status: 206,
          headers: {
            "Content-Type": s,
            "Content-Length": String(f),
            "Content-Range": `bytes ${c}-${m}/${a}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }
      const o = F.createReadStream(r), u = hr.toWeb(o);
      return new Response(u, {
        status: 200,
        headers: {
          "Content-Type": s,
          "Content-Length": String(a),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      });
    } catch (r) {
      return console.error("[local-media] Failed request:", n.url, r), new Response("Invalid local-media URL", { status: 400 });
    }
  }), hs(), wl(), Vo(), Tl(), jl(), Dl(), Tu(), Lu(), $u(), Xu(), cd(), Id(), Rd(), Od(), lc(), Ec(), Tc(ye), Zl(), wf(), Of(), Rc(), Vc(), lf(), yf(), await Gf(), I.handle("pm:open-project", async (n, r, i) => r === "__close__" ? (Y == null || Y.close(), Y = null, { ok: !0 }) : ((!Q || Q.isDestroyed()) && (Q = br()), Q.once("ready-to-show", () => {
    Q == null || Q.maximize(), Q == null || Q.show(), Q == null || Q.webContents.send("pm:open-project", r, i);
  }), Q.webContents.getURL() !== "" && (Q.maximize(), Q.show(), Q.webContents.send("pm:open-project", r, i)), Y == null || Y.close(), Y = null, { ok: !0 })), I.handle("pm:open", async () => Y && !Y.isDestroyed() ? (Y.focus(), { ok: !0 }) : (Y = yn(), Y.on("closed", () => {
    Y = null;
  }), { ok: !0 })), bt = fs(), Q = br();
  const t = 3e3;
  Q.once("ready-to-show", () => {
    const n = Date.now() - Pf, r = Math.max(0, t - n);
    setTimeout(() => {
      bt == null || bt.close(), bt = null, Y = yn(), Y.on("closed", () => {
        Y = null;
      });
    }, r);
  }), J.on("activate", () => {
    V.getAllWindows().length === 0 && (Y = yn(), Y.on("closed", () => {
      Y = null;
    }));
  });
  const e = (n) => {
    Ie && (clearTimeout(Ie), Ie = null), Ie = setTimeout(() => {
      Ie = null, console.log(`[app] Wake recovery triggered by ${n}`), cs(n);
    }, Uf);
  };
  mn.on("resume", () => {
    qn("resume"), e("resume");
  }), mn.on("unlock-screen", () => {
    qn("unlock-screen"), e("unlock-screen");
  }), mn.on("suspend", () => {
    qn("suspend");
  });
});
J.on("before-quit", () => {
  Ie && (clearTimeout(Ie), Ie = null), vc(), uc(), hf();
});
J.on("window-all-closed", () => {
  process.platform !== "darwin" && J.quit();
});
export {
  dm as H
};
