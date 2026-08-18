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
const x = [], h = /* @__PURE__ */ new Map(), rt = Y(import.meta.url), q = M.dirname(K(import.meta.url));
function ot() {
  return [
    process.resourcesPath ? M.join(process.resourcesPath, "native", "cinegen_avfoundation.node") : null,
    M.resolve(process.cwd(), "native", "avfoundation", "build", "Release", "cinegen_avfoundation.node"),
    M.resolve(q, "../../native/avfoundation/build/Release/cinegen_avfoundation.node"),
    M.resolve(q, "../native/avfoundation/build/Release/cinegen_avfoundation.node")
  ].filter((e) => !!e).find((e) => N.existsSync(e)) ?? null;
}
let R = null;
if (process.platform === "darwin") {
  const t = ot();
  if (t)
    try {
      R = rt(t), console.log("[media-worker] AVFoundation addon loaded:", t);
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
  const e = J[t.type], n = x.findIndex((r) => J[r.type] > e);
  n === -1 ? x.push(t) : x.splice(n, 0, t);
}
function $() {
  for (; h.size < W && x.length > 0; ) {
    const t = Array.from(h.values()).reduce(
      (r, f) => r + L[f.job.type],
      0
    ), e = x.findIndex(
      (r) => t + L[r.type] <= Q
    );
    if (e === -1) break;
    const [n] = x.splice(e, 1);
    pt(n);
  }
}
function T(t, e, n) {
  const r = C(t, e), f = [];
  let d = "";
  return { promise: new Promise((a, u) => {
    var m, _;
    (m = r.stdout) == null || m.on("data", (l) => f.push(l)), (_ = r.stderr) == null || _.on("data", (l) => {
      d += l.toString();
    }), r.on("error", (l) => u(l)), r.on("close", (l) => {
      a({ stdout: Buffer.concat(f), stderr: d, code: l });
    });
  }), child: r };
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
  ], { promise: n, child: r } = T(k, e, t.id);
  h.set(t.id, { process: r, job: t });
  const { stdout: f, code: d } = await n;
  if (d !== 0)
    throw new Error(`ffprobe exited with code ${d}`);
  try {
    const a = JSON.parse(f.toString());
    return parseFloat(((i = a.format) == null ? void 0 : i.duration) ?? "0") || 0;
  } catch {
    throw new Error("Failed to parse ffprobe duration");
  }
}
async function st(t) {
  var l, p, P, y, o;
  const e = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    t.inputPath
  ], { promise: n, child: r } = T(k, e, t.id);
  h.set(t.id, { process: r, job: t });
  const { stdout: f, code: d } = await n;
  if (d !== 0)
    throw new Error(`ffprobe exited with code ${d}`);
  let i;
  try {
    i = JSON.parse(f.toString());
  } catch {
    throw new Error("Failed to parse ffprobe JSON output");
  }
  const a = (l = i.streams) == null ? void 0 : l.find((s) => s.codec_type === "video"), u = (p = i.streams) == null ? void 0 : p.find((s) => s.codec_type === "audio");
  let m = 0;
  if (a != null && a.r_frame_rate) {
    const s = a.r_frame_rate.split("/");
    if (s.length === 2) {
      const g = parseFloat(s[0]), w = parseFloat(s[1]);
      m = w !== 0 ? g / w : 0;
    } else
      m = parseFloat(s[0]) || 0;
  }
  return {
    duration: parseFloat(((P = i.format) == null ? void 0 : P.duration) ?? "0"),
    width: (a == null ? void 0 : a.width) ?? 0,
    height: (a == null ? void 0 : a.height) ?? 0,
    fps: Math.round(m * 100) / 100,
    codec: (a == null ? void 0 : a.codec_name) ?? "",
    fileSize: parseInt(((y = i.format) == null ? void 0 : y.size) ?? "0", 10),
    bitrate: parseInt(((o = i.format) == null ? void 0 : o.bit_rate) ?? "0", 10),
    audioChannels: (u == null ? void 0 : u.channels) ?? 0,
    audioCodec: (u == null ? void 0 : u.codec_name) ?? ""
  };
}
async function it(t) {
  if (R && X(t.inputPath)) {
    h.set(t.id, { job: t });
    try {
      return R.generateThumbnail(t.inputPath, t.outputPath, 0.5), { outputPath: t.outputPath };
    } finally {
      h.delete(t.id);
    }
  }
  let e = j;
  try {
    const a = await G(t);
    a > 0 && (e = Math.max(0, a * 0.5));
  } catch {
  }
  const n = [
    "-y",
    "-threads",
    B,
    "-ss",
    `${e}`,
    "-i",
    t.inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    t.outputPath
  ], { promise: r, child: f } = T(F, n, t.id);
  h.set(t.id, { process: f, job: t });
  const { code: d, stderr: i } = await r;
  if (d !== 0)
    throw new Error(`ffmpeg thumbnail exited with code ${d}: ${i}`);
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
  ], n = C(F, e);
  h.set(t.id, { process: n, job: t });
  const r = [], d = await new Promise((o, s) => {
    var g, w;
    (g = n.stdout) == null || g.on("data", (c) => r.push(c)), (w = n.stderr) == null || w.on("data", () => {
    }), n.on("error", (c) => s(c)), n.on("close", (c) => {
      c !== 0 ? s(new Error(`ffmpeg waveform exited with code ${c}`)) : o(Buffer.concat(r));
    });
  }), i = Math.floor(d.length / 4), a = i / 8e3, u = Math.max(2e3, Math.round(a * 500)), m = Math.max(1, Math.floor(i / u)), _ = [];
  for (let o = 0; o < i; o += m) {
    let s = 0;
    const g = Math.min(o + m, i);
    for (let w = o; w < g; w++) {
      const c = Math.abs(d.readFloatLE(w * 4));
      c > s && (s = c);
    }
    _.push(s);
  }
  const l = _.reduce((o, s) => s > o ? s : o, 0.01), p = _.map((o) => Math.round(o / l * 1e3) / 1e3);
  N.mkdirSync(M.dirname(t.outputPath), { recursive: !0 }), N.writeFileSync(t.outputPath, JSON.stringify(p));
  const P = Math.max(1200, Math.min(4096, Math.round(a * 24)));
  let y = p;
  if (p.length > P) {
    const o = p.length / P;
    y = [];
    for (let s = 0; s < P; s++) {
      const g = Math.floor(s * o), w = Math.min(Math.floor((s + 1) * o), p.length);
      let c = 0, E = 0, v = 0;
      for (let A = g; A < w; A++) {
        const S = p[A];
        E += S, v++, S > c && (c = S);
      }
      const O = v > 0 ? E / v : 0;
      y.push(Math.round((O * 0.72 + c * 0.28) * 1e3) / 1e3);
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
  const r = Math.min(Math.ceil(e), 120), f = e / r, d = `fps=1/${Math.max(1, Math.floor(f))},scale=160:-2,tile=${r}x1`, i = [
    "-y",
    "-threads",
    B,
    "-i",
    t.inputPath,
    "-vf",
    d,
    "-frames:v",
    "1",
    t.outputPath
  ], a = C(F, i);
  h.set(t.id, { process: a, job: t });
  const u = await new Promise((m, _) => {
    var P, y;
    const l = [];
    let p = "";
    (P = a.stdout) == null || P.on("data", (o) => l.push(o)), (y = a.stderr) == null || y.on("data", (o) => {
      p += o.toString();
    }), a.on("error", (o) => _(o)), a.on("close", (o) => {
      m({ stdout: Buffer.concat(l), stderr: p, code: o });
    });
  });
  if (u.code !== 0)
    throw new Error(
      `ffmpeg filmstrip exited with code ${u.code}: ${u.stderr}`
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
  ], { promise: n, child: r } = T(
    k,
    e,
    t.id
  );
  h.set(t.id, { process: r, job: t });
  const f = await n;
  let d = 0;
  try {
    const _ = JSON.parse(f.stdout.toString());
    d = parseFloat(((m = _.format) == null ? void 0 : m.duration) ?? "0");
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
      const o = [];
      let s = "";
      (g = p.stdout) == null || g.on("data", (c) => o.push(c)), (w = p.stderr) == null || w.on("data", (c) => {
        const E = c.toString();
        if (s += E, d > 0) {
          const v = E.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (v) {
            const O = parseInt(v[1], 10), A = parseInt(v[2], 10), S = parseInt(v[3], 10), H = parseInt(v[4], 10), U = O * 3600 + A * 60 + S + H / 100, z = Math.min(
              Math.round(U / d * 100),
              100
            );
            I({ type: "job:progress", jobId: t.id, progress: z });
          }
        }
      }), p.on("error", (c) => y(c)), p.on("close", (c) => {
        P({ stdout: Buffer.concat(o), stderr: s, code: c });
      });
    });
  }, a = process.platform === "darwin" ? ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "5M", "-maxrate", "8M"] : ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast"];
  let u = await i(a);
  if (u.code !== 0 && process.platform === "darwin" && (u = await i(["-c:v", "libx264", "-crf", "23", "-preset", "veryfast"])), u.code !== 0)
    throw new Error(`ffmpeg proxy exited with code ${u.code}: ${u.stderr}`);
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
        const { computeSyncOffset: n } = await import("./audio-sync-dZi5Ub6p.js");
        e = await n(
          t.sourceFilePath,
          t.targetFilePath,
          F,
          k,
          b
        );
        break;
      }
      case "sync_batch_match": {
        const { computeBatchMatch: n } = await import("./audio-sync-dZi5Ub6p.js");
        e = await n(
          t.videoAssets,
          t.audioAssets,
          F,
          k,
          b,
          (r) => {
            I({
              type: "sync:batch-progress",
              jobId: t.id,
              ...r
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
      const n = x.findIndex((f) => f.id === t.jobId);
      if (n !== -1) {
        x.splice(n, 1), I({ type: "job:error", jobId: t.jobId, error: "Cancelled" });
        break;
      }
      const r = h.get(t.jobId);
      r && ((e = r.process) == null || e.kill("SIGTERM"), h.delete(t.jobId), I({ type: "job:error", jobId: t.jobId, error: "Cancelled" }), $());
      break;
    }
  }
});
