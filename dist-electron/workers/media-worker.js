import { parentPort as V } from "worker_threads";
import { spawn as C } from "child_process";
import { createRequire as Y } from "node:module";
import N from "node:fs";
import M from "node:path";
import { fileURLToPath as K } from "node:url";
const J = {
  extract_metadata: 0,
  generate_thumbnail: 1,
  compute_waveform: 2,
  generate_filmstrip: 3,
  generate_proxy: 4,
  sync_compute_offset: 0,
  sync_batch_match: 0
}, W = 3, Q = 2, L = {
  extract_metadata: 0,
  generate_thumbnail: 1,
  compute_waveform: 1,
  generate_filmstrip: 1,
  generate_proxy: 2,
  sync_compute_offset: 2,
  sync_batch_match: 2
}, B = "1", Z = "2", j = 0.1, tt = 18, et = 160, at = /* @__PURE__ */ new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mxf", ".m4v"]);
let F = "", k = "", b = "";
const x = [], h = /* @__PURE__ */ new Map(), ot = Y(import.meta.url), q = M.dirname(K(import.meta.url));
function rt() {
  return [
    process.resourcesPath ? M.join(process.resourcesPath, "native", "cinegen_avfoundation.node") : null,
    M.resolve(process.cwd(), "native", "avfoundation", "build", "Release", "cinegen_avfoundation.node"),
    M.resolve(q, "../../native/avfoundation/build/Release/cinegen_avfoundation.node"),
    M.resolve(q, "../native/avfoundation/build/Release/cinegen_avfoundation.node")
  ].filter((e) => !!e).find((e) => N.existsSync(e)) ?? null;
}
let R = null;
if (process.platform === "darwin") {
  const t = rt();
  if (t)
    try {
      R = ot(t), console.log("[media-worker] AVFoundation addon loaded:", t);
    } catch (e) {
      console.error("[media-worker] Failed to load AVFoundation addon:", e);
    }
  else
    console.warn("[media-worker] AVFoundation addon not found, falling back to ffmpeg");
}
function I(t) {
  var e;
  (e = V) == null || e.postMessage(t);
}
function nt(t) {
  const e = J[t.type], r = x.findIndex((a) => J[a.type] > e);
  r === -1 ? x.push(t) : x.splice(r, 0, t);
}
function $() {
  for (; h.size < W && x.length > 0; ) {
    const t = Array.from(h.values()).reduce(
      (a, f) => a + L[f.job.type],
      0
    ), e = x.findIndex(
      (a) => t + L[a.type] <= Q
    );
    if (e === -1) break;
    const [r] = x.splice(e, 1);
    pt(r);
  }
}
function T(t, e, r) {
  const a = C(t, e), f = [];
  let u = "";
  return { promise: new Promise((o, c) => {
    var m, _;
    (m = a.stdout) == null || m.on("data", (l) => f.push(l)), (_ = a.stderr) == null || _.on("data", (l) => {
      u += l.toString();
    }), a.on("error", (l) => c(l)), a.on("close", (l) => {
      o({ stdout: Buffer.concat(f), stderr: u, code: l });
    });
  }), child: a };
}
function X(t) {
  return at.has(M.extname(t).toLowerCase());
}
async function G(t) {
  var i;
  const e = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    t.inputPath
  ], { promise: r, child: a } = T(k, e, t.id);
  h.set(t.id, { process: a, job: t });
  const { stdout: f, code: u } = await r;
  if (u !== 0)
    throw new Error(`ffprobe exited with code ${u}`);
  try {
    const o = JSON.parse(f.toString());
    return parseFloat(((i = o.format) == null ? void 0 : i.duration) ?? "0") || 0;
  } catch {
    throw new Error("Failed to parse ffprobe duration");
  }
}
async function st(t) {
  var l, p, P, y, n;
  const e = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    t.inputPath
  ], { promise: r, child: a } = T(k, e, t.id);
  h.set(t.id, { process: a, job: t });
  const { stdout: f, code: u } = await r;
  if (u !== 0)
    throw new Error(`ffprobe exited with code ${u}`);
  let i;
  try {
    i = JSON.parse(f.toString());
  } catch {
    throw new Error("Failed to parse ffprobe JSON output");
  }
  const o = (l = i.streams) == null ? void 0 : l.find((s) => s.codec_type === "video"), c = (p = i.streams) == null ? void 0 : p.find((s) => s.codec_type === "audio");
  let m = 0;
  if (o != null && o.r_frame_rate) {
    const s = o.r_frame_rate.split("/");
    if (s.length === 2) {
      const g = parseFloat(s[0]), w = parseFloat(s[1]);
      m = w !== 0 ? g / w : 0;
    } else
      m = parseFloat(s[0]) || 0;
  }
  return {
    duration: parseFloat(((P = i.format) == null ? void 0 : P.duration) ?? "0"),
    width: (o == null ? void 0 : o.width) ?? 0,
    height: (o == null ? void 0 : o.height) ?? 0,
    fps: Math.round(m * 100) / 100,
    codec: (o == null ? void 0 : o.codec_name) ?? "",
    fileSize: parseInt(((y = i.format) == null ? void 0 : y.size) ?? "0", 10),
    bitrate: parseInt(((n = i.format) == null ? void 0 : n.bit_rate) ?? "0", 10),
    audioChannels: (c == null ? void 0 : c.channels) ?? 0,
    audioCodec: (c == null ? void 0 : c.codec_name) ?? ""
  };
}
async function it(t) {
  const e = X(t.inputPath);
  if (R && e) {
    h.set(t.id, { job: t });
    try {
      return R.generateThumbnail(t.inputPath, t.outputPath, 0.5), { outputPath: t.outputPath };
    } finally {
      h.delete(t.id);
    }
  }
  let r = 0;
  if (e) {
    r = j;
    try {
      const c = await G(t);
      c > 0 && (r = Math.max(0, c * 0.5));
    } catch {
    }
  }
  const a = [
    "-y",
    "-threads",
    B,
    ...e ? ["-ss", `${r}`] : [],
    "-i",
    t.inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    t.outputPath
  ], { promise: f, child: u } = T(F, a, t.id);
  h.set(t.id, { process: u, job: t });
  const { code: i, stderr: o } = await f;
  if (i !== 0)
    throw new Error(`ffmpeg thumbnail exited with code ${i}: ${o}`);
  return { outputPath: t.outputPath };
}
async function ct(t) {
  const e = [
    "-threads",
    B,
    "-i",
    t.inputPath,
    "-vn",
    "-f",
    "f32le",
    "-ac",
    "1",
    "-ar",
    "8000",
    "pipe:1"
  ], r = C(F, e);
  h.set(t.id, { process: r, job: t });
  const a = [], u = await new Promise((n, s) => {
    var g, w;
    (g = r.stdout) == null || g.on("data", (d) => a.push(d)), (w = r.stderr) == null || w.on("data", () => {
    }), r.on("error", (d) => s(d)), r.on("close", (d) => {
      d !== 0 ? s(new Error(`ffmpeg waveform exited with code ${d}`)) : n(Buffer.concat(a));
    });
  }), i = Math.floor(u.length / 4), o = i / 8e3, c = Math.max(2e3, Math.round(o * 500)), m = Math.max(1, Math.floor(i / c)), _ = [];
  for (let n = 0; n < i; n += m) {
    let s = 0;
    const g = Math.min(n + m, i);
    for (let w = n; w < g; w++) {
      const d = Math.abs(u.readFloatLE(w * 4));
      d > s && (s = d);
    }
    _.push(s);
  }
  const l = _.reduce((n, s) => s > n ? s : n, 0.01), p = _.map((n) => Math.round(n / l * 1e3) / 1e3);
  N.mkdirSync(M.dirname(t.outputPath), { recursive: !0 }), N.writeFileSync(t.outputPath, JSON.stringify(p));
  const P = Math.max(1200, Math.min(4096, Math.round(o * 24)));
  let y = p;
  if (p.length > P) {
    const n = p.length / P;
    y = [];
    for (let s = 0; s < P; s++) {
      const g = Math.floor(s * n), w = Math.min(Math.floor((s + 1) * n), p.length);
      let d = 0, E = 0, v = 0;
      for (let A = g; A < w; A++) {
        const S = p[A];
        E += S, v++, S > d && (d = S);
      }
      const O = v > 0 ? E / v : 0;
      y.push(Math.round((O * 0.72 + d * 0.28) * 1e3) / 1e3);
    }
  }
  return { peaks: y, peaksPath: t.outputPath };
}
async function dt(t) {
  if (R && X(t.inputPath)) {
    h.set(t.id, { job: t });
    try {
      return { frames: R.generateFilmstripFrames(
        t.inputPath,
        M.dirname(t.outputPath),
        M.basename(t.outputPath, M.extname(t.outputPath)),
        tt,
        et
      ) };
    } finally {
      h.delete(t.id);
    }
  }
  const e = await G(t);
  if (e <= 0)
    throw new Error("Cannot generate filmstrip: duration is 0");
  const a = Math.min(Math.ceil(e), 120), f = e / a, u = `fps=1/${Math.max(1, Math.floor(f))},scale=160:-2,tile=${a}x1`, i = [
    "-y",
    "-threads",
    B,
    "-i",
    t.inputPath,
    "-vf",
    u,
    "-frames:v",
    "1",
    t.outputPath
  ], o = C(F, i);
  h.set(t.id, { process: o, job: t });
  const c = await new Promise((m, _) => {
    var P, y;
    const l = [];
    let p = "";
    (P = o.stdout) == null || P.on("data", (n) => l.push(n)), (y = o.stderr) == null || y.on("data", (n) => {
      p += n.toString();
    }), o.on("error", (n) => _(n)), o.on("close", (n) => {
      m({ stdout: Buffer.concat(l), stderr: p, code: n });
    });
  });
  if (c.code !== 0)
    throw new Error(
      `ffmpeg filmstrip exited with code ${c.code}: ${c.stderr}`
    );
  return { outputPath: t.outputPath };
}
async function ut(t) {
  var m;
  const e = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    t.inputPath
  ], { promise: r, child: a } = T(
    k,
    e,
    t.id
  );
  h.set(t.id, { process: a, job: t });
  const f = await r;
  let u = 0;
  try {
    const _ = JSON.parse(f.stdout.toString());
    u = parseFloat(((m = _.format) == null ? void 0 : m.duration) ?? "0");
  } catch {
  }
  const i = async (_) => {
    const l = [
      "-y",
      "-threads",
      Z,
      "-i",
      t.inputPath,
      "-vf",
      "scale=960:-2",
      ..._,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      t.outputPath
    ], p = C(F, l);
    return h.set(t.id, { process: p, job: t }), new Promise((P, y) => {
      var g, w;
      const n = [];
      let s = "";
      (g = p.stdout) == null || g.on("data", (d) => n.push(d)), (w = p.stderr) == null || w.on("data", (d) => {
        const E = d.toString();
        if (s += E, u > 0) {
          const v = E.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (v) {
            const O = parseInt(v[1], 10), A = parseInt(v[2], 10), S = parseInt(v[3], 10), H = parseInt(v[4], 10), U = O * 3600 + A * 60 + S + H / 100, z = Math.min(
              Math.round(U / u * 100),
              100
            );
            I({ type: "job:progress", jobId: t.id, progress: z });
          }
        }
      }), p.on("error", (d) => y(d)), p.on("close", (d) => {
        P({ stdout: Buffer.concat(n), stderr: s, code: d });
      });
    });
  }, o = process.platform === "darwin" ? ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "5M", "-maxrate", "8M"] : ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast"];
  let c = await i(o);
  if (c.code !== 0 && process.platform === "darwin" && (c = await i(["-c:v", "libx264", "-crf", "23", "-preset", "veryfast"])), c.code !== 0)
    throw new Error(`ffmpeg proxy exited with code ${c.code}: ${c.stderr}`);
  return { outputPath: t.outputPath };
}
async function pt(t) {
  try {
    let e;
    switch (t.type) {
      case "extract_metadata":
        e = await st(t);
        break;
      case "generate_thumbnail":
        e = await it(t);
        break;
      case "compute_waveform":
        e = await ct(t);
        break;
      case "generate_filmstrip":
        e = await dt(t);
        break;
      case "generate_proxy":
        e = await ut(t);
        break;
      case "sync_compute_offset": {
        const { computeSyncOffset: r } = await import("./audio-sync-dZi5Ub6p.js");
        e = await r(
          t.sourceFilePath,
          t.targetFilePath,
          F,
          k,
          b
        );
        break;
      }
      case "sync_batch_match": {
        const { computeBatchMatch: r } = await import("./audio-sync-dZi5Ub6p.js");
        e = await r(
          t.videoAssets,
          t.audioAssets,
          F,
          k,
          b,
          (a) => {
            I({
              type: "sync:batch-progress",
              jobId: t.id,
              ...a
            });
          }
        );
        break;
      }
    }
    h.delete(t.id), I({ type: "job:complete", jobId: t.id, result: e });
  } catch (e) {
    h.delete(t.id), I({
      type: "job:error",
      jobId: t.id,
      error: e instanceof Error ? e.message : String(e)
    });
  }
  $();
}
var D;
(D = V) == null || D.on("message", (t) => {
  var e;
  switch (t.type) {
    case "config":
      F = t.ffmpegPath, k = t.ffprobePath, b = t.fpcalcPath, I({ type: "ready" });
      break;
    case "job:submit":
      nt(t.job), $();
      break;
    case "job:cancel": {
      const r = x.findIndex((f) => f.id === t.jobId);
      if (r !== -1) {
        x.splice(r, 1), I({ type: "job:error", jobId: t.jobId, error: "Cancelled" });
        break;
      }
      const a = h.get(t.jobId);
      a && ((e = a.process) == null || e.kill("SIGTERM"), h.delete(t.jobId), I({ type: "job:error", jobId: t.jobId, error: "Cancelled" }), $());
      break;
    }
  }
});
