import { execFile as nt } from "node:child_process";
import { promisify as et } from "node:util";
import { mkdtemp as z, readFile as ot, unlink as st, rmdir as ct } from "node:fs/promises";
import x from "node:path";
import U from "node:os";
const _ = et(nt), rt = 16e3;
function q(n, o) {
  const t = n.match(/^(\d{2}):(\d{2}):(\d{2})([;:])(\d{2})$/);
  if (!t) return null;
  const s = parseInt(t[1], 10), c = parseInt(t[2], 10), e = parseInt(t[3], 10), a = t[4], r = parseInt(t[5], 10);
  if (a === ";") {
    const d = Math.round(o), m = Math.round(o * 0.066666), l = 60 * s + c;
    return d * 3600 * s + d * 60 * c + d * e + r - m * (l - Math.floor(l / 10));
  } else
    return Math.round((s * 3600 + c * 60 + e) * o) + r;
}
function at(n, o, t) {
  const s = q(n, t), c = q(o, t);
  return s === null || c === null ? null : (c - s) / t;
}
const O = 0.1238;
function X(n) {
  return n = n >>> 0, n = n - (n >>> 1 & 1431655765), n = (n & 858993459) + (n >>> 2 & 858993459), (n + (n >>> 4) & 252645135) * 16843009 >>> 24;
}
function Nt(n, o, t = 120) {
  const s = Math.ceil(t / O), c = Math.min(s, Math.max(n.length, o.length) - 1);
  let e = 0, a = -1;
  for (let r = -c; r <= c; r++) {
    let i = 0, d = 0;
    for (let f = 0; f < n.length; f++) {
      const p = f + r;
      p < 0 || p >= o.length || (i += X((n[f] ^ o[p]) >>> 0), d++);
    }
    if (d < 3) continue;
    const l = 1 - i / d / 32;
    l > a && (a = l, e = r);
  }
  return {
    offsetIndex: e,
    confidence: Math.max(0, a),
    _offsetSeconds: e * O
  };
}
function it(n, o) {
  if (n.length < 3 || o.length < n.length)
    return { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  const t = o.length - n.length;
  let s = 0, c = -1;
  for (let e = 0; e <= t; e++) {
    let a = 0;
    for (let i = 0; i < n.length; i++)
      a += X((n[i] ^ o[e + i]) >>> 0);
    const r = 1 - a / (n.length * 32);
    r > c && (c = r, s = e);
  }
  return {
    offsetIndex: s,
    confidence: Math.max(0, c),
    _offsetSeconds: s * O
  };
}
function ft(n, o) {
  const t = n.length, s = o.length, c = Array.from(
    { length: t + 1 },
    (e, a) => Array.from({ length: s + 1 }, (r, i) => a === 0 ? i : i === 0 ? a : 0)
  );
  for (let e = 1; e <= t; e++)
    for (let a = 1; a <= s; a++)
      n[e - 1] === o[a - 1] ? c[e][a] = c[e - 1][a - 1] : c[e][a] = 1 + Math.min(c[e - 1][a], c[e][a - 1], c[e - 1][a - 1]);
  return c[t][s];
}
function G(n) {
  const o = x.basename(n), t = x.extname(o);
  return t === "" && o.startsWith(".") ? "" : x.basename(o, t);
}
function lt(n, o) {
  const t = G(n).toLowerCase(), s = G(o).toLowerCase();
  if (t.length === 0 && s.length === 0) return 1;
  const c = ft(t, s), e = Math.max(t.length, s.length);
  return e === 0 ? 1 : 1 - c / e;
}
async function Y(n, o) {
  var i, d, m;
  let t;
  try {
    t = (await _(o, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      n
    ])).stdout;
  } catch {
    return null;
  }
  let s;
  try {
    s = JSON.parse(t);
  } catch {
    return null;
  }
  let c = 24;
  const e = (i = s.streams) == null ? void 0 : i.find((l) => l.codec_type === "video");
  if (e != null && e.r_frame_rate) {
    const [l, f] = e.r_frame_rate.split("/").map(Number);
    f && f > 0 && (c = l / f);
  }
  const a = ((d = s.format) == null ? void 0 : d.tags) ?? {}, r = a.timecode ?? a["com.apple.quicktime.timecode"] ?? null;
  if (r) return { timecode: r, fps: c };
  for (const l of s.streams ?? []) {
    const f = (m = l.tags) == null ? void 0 : m.timecode;
    if (f) return { timecode: f, fps: c };
  }
  return null;
}
async function J(n, o) {
  var t;
  try {
    const { stdout: s } = await _(o, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-select_streams",
      "a",
      n
    ]);
    return (((t = JSON.parse(s).streams) == null ? void 0 : t.length) ?? 0) > 0;
  } catch {
    return !1;
  }
}
async function K(n, o, t = 300) {
  const s = !Number.isFinite(t) || t < 0 ? 300 : Math.round(t), { stdout: c } = await _(o, ["-raw", "-length", String(s), n], {
    maxBuffer: 10 * 1024 * 1024
  }), e = c.match(/FINGERPRINT=([^\n]+)/);
  if (!e) throw new Error("fpcalc: no FINGERPRINT in output");
  return e[1].split(",").map((a) => {
    const r = parseInt(a.trim(), 10);
    if (isNaN(r)) throw new Error(`fpcalc: invalid fingerprint value "${a}"`);
    return r;
  });
}
const E = 8e3, dt = 20, ut = 0.4, mt = 0.55;
async function R(n, o) {
  var t;
  try {
    const { stdout: s } = await _(o, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      n
    ]), c = JSON.parse(s), e = Number((t = c.format) == null ? void 0 : t.duration);
    return Number.isFinite(e) && e > 0 ? e : null;
  } catch {
    return null;
  }
}
function ht(n, o = dt) {
  if (!Number.isFinite(n) || n <= 0) return [];
  const t = Math.min(o, n), s = Math.max(0, n - t), c = [
    { label: "start", startSeconds: 0, durationSeconds: t },
    {
      label: "middle",
      startSeconds: Math.max(0, n / 2 - t / 2),
      durationSeconds: t
    },
    { label: "end", startSeconds: s, durationSeconds: t }
  ], e = Math.max(1, t * 0.1), a = [];
  for (const r of c) {
    const i = Math.max(0, Math.min(r.startSeconds, s));
    a.some((d) => Math.abs(d.startSeconds - i) < e) || a.push({
      label: r.label,
      startSeconds: i,
      durationSeconds: Math.min(t, n - i)
    });
  }
  return a;
}
function Q(n, o) {
  if (n.length === 0)
    return console.log(`[audio-sync] ${o}: no valid matches found`), { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  console.log(`[audio-sync] ${o} votes:`, n.map(
    (r) => `${r.label}: offset=${r.offsetSeconds.toFixed(2)}s conf=${r.confidence.toFixed(3)}`
  ).join(" | ")), n.sort((r, i) => r.offsetSeconds - i.offsetSeconds);
  let t = [], s = -1 / 0;
  for (let r = 0; r < n.length; r++) {
    const i = [n[r]];
    for (let l = r + 1; l < n.length; l++)
      Math.abs(n[l].offsetSeconds - n[r].offsetSeconds) < 1.5 && i.push(n[l]);
    const d = i.reduce((l, f) => l + f.confidence, 0) / i.length, m = i.length * d;
    m > s && (s = m, t = i);
  }
  const c = t.reduce((r, i) => r + i.confidence, 0), e = t.reduce((r, i) => r + i.offsetSeconds * i.confidence, 0) / c, a = c / t.length;
  return console.log(
    `[audio-sync] ${o} result: offset=${e.toFixed(3)}s confidence=${a.toFixed(3)} (${t.length}/${n.length} votes agreed)`
  ), {
    offsetIndex: 0,
    confidence: Math.min(1, a),
    _offsetSeconds: e
  };
}
async function H(n, o, t = {}) {
  const s = await z(x.join(U.tmpdir(), "cinegen-sync-")), c = x.join(s, "audio.raw"), e = [
    "-y"
  ];
  return typeof t.startSeconds == "number" && t.startSeconds > 0 && e.push("-ss", t.startSeconds.toFixed(3)), e.push("-i", n), typeof t.durationSeconds == "number" && t.durationSeconds > 0 && e.push("-t", t.durationSeconds.toFixed(3)), e.push(
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(E),
    "-ac",
    "1",
    "-f",
    "s16le",
    c
  ), await _(o, e, { maxBuffer: 10 * 1024 * 1024 }), c;
}
async function pt(n, o, t = {}) {
  const s = await z(x.join(U.tmpdir(), "cinegen-sync-")), c = x.join(s, "audio.wav"), e = ["-y"];
  return typeof t.startSeconds == "number" && t.startSeconds > 0 && e.push("-ss", t.startSeconds.toFixed(3)), e.push("-i", n), typeof t.durationSeconds == "number" && t.durationSeconds > 0 && e.push("-t", t.durationSeconds.toFixed(3)), e.push(
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(rt),
    "-ac",
    "1",
    c
  ), await _(o, e, { maxBuffer: 10 * 1024 * 1024 }), c;
}
async function V(n) {
  const o = await ot(n), t = new Int16Array(o.buffer, o.byteOffset, o.byteLength / 2), s = new Float32Array(t.length);
  for (let c = 0; c < t.length; c++)
    s[c] = t[c] / 32768;
  return s;
}
function St(n, o, t) {
  const s = Math.floor(t * 0.25), c = Math.floor(t * 0.01), e = n.length <= o.length ? n : o, a = n.length <= o.length ? o : n, r = n.length > o.length;
  console.log(`[audio-sync] Anchor file: ${(e.length / t).toFixed(1)}s, Search file: ${(a.length / t).toFixed(1)}s${r ? " (flipped)" : ""}`);
  const i = Math.min(5 * t, Math.floor(e.length * 0.05)), d = e.length - 2 * i, m = 10 * t, l = Math.max(1, Math.floor(t * 2)), f = Math.max(
    Math.min(m, d),
    Math.min(l, d)
  ), p = Math.min(6, Math.max(1, Math.floor(d / Math.max(1, f))));
  if (d <= 0 || f <= 0 || a.length < f)
    return { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  const w = Math.floor((d - f) / Math.max(1, p - 1)), g = [];
  for (let u = 0; u < p; u++) {
    const S = i + u * w, A = Math.min(S + f, e.length), b = e.subarray(S, A), M = b.length;
    if (M < f * 0.5) continue;
    let v = 0, D = 0;
    for (let h = 0; h < M; h++)
      v += b[h], D += b[h] * b[h];
    const T = v / M, W = D / M - T * T;
    if (W < 1e-10) continue;
    const j = (h) => {
      let y = 0, L = 0, P = 0;
      for (let I = 0; I < M; I++) {
        const C = a[h + I];
        y += C, L += C * C, P += b[I] * C;
      }
      const $ = y / M, k = L / M - $ * $;
      return k < 1e-10 ? -1 : (P / M - T * $) / Math.sqrt(W * k);
    }, B = a.length - M;
    let F = -1 / 0, N = 0;
    for (let h = 0; h <= B; h += s) {
      const y = j(h);
      y > F && (F = y, N = h);
    }
    const Z = Math.max(0, N - s * 2), tt = Math.min(B, N + s * 2);
    for (let h = Z; h <= tt; h += c) {
      const y = j(h);
      y > F && (F = y, N = h);
    }
    if (F > 0.15) {
      const h = (N - S) / t, y = r ? h : -h;
      g.push({ offsetSeconds: y, confidence: F, label: `a${u}` });
    }
  }
  return Q(g, "PCM anchor");
}
async function gt(n, o, t, s, c) {
  return Promise.all(
    s.map(async (e) => {
      const a = await pt(n, o, {
        startSeconds: e.startSeconds,
        durationSeconds: e.durationSeconds
      });
      c.push(a);
      const r = await K(a, t);
      return { ...e, fingerprint: r };
    })
  );
}
async function wt(n, o, t, s, c, e) {
  const [a, r] = await Promise.all([
    R(n, s),
    R(o, s)
  ]);
  if (!a || !r)
    return console.log("[audio-sync] Sampled pass skipped: missing duration metadata"), null;
  const i = a <= r, d = i ? n : o, m = i ? o : n, l = ht(Math.min(a, r));
  if (l.length === 0)
    return console.log("[audio-sync] Sampled pass skipped: no analysis windows"), null;
  console.log(
    `[audio-sync] Sampled fingerprint pass: ${l.length} anchor windows against full ${i ? "target" : "source"} fingerprint`
  );
  const [f, p] = await Promise.all([
    gt(d, t, c, l, e),
    K(m, c, 0)
  ]), w = [];
  for (const g of f) {
    const u = it(g.fingerprint, p);
    if (u.confidence < ut) continue;
    const S = u._offsetSeconds - g.startSeconds, A = i ? -S : S;
    w.push({
      offsetSeconds: A,
      confidence: u.confidence,
      label: g.label
    });
  }
  return Q(w, "Sampled fingerprint");
}
async function It(n, o, t, s, c, e) {
  const a = [], r = /* @__PURE__ */ new Set(), i = n.length;
  for (let f = 0; f < n.length; f++) {
    const p = n[f], w = o.filter((u) => !r.has(u.id)).map((u) => ({
      audio: u,
      nameScore: lt(p.name, u.name)
    })).sort((u, S) => S.nameScore - u.nameScore);
    let g = !1;
    for (const u of w) {
      e == null || e({
        completedPairs: f,
        totalPairs: i,
        currentVideoName: p.name,
        currentAudioName: u.audio.name
      });
      try {
        const S = await yt(
          p.filePath,
          u.audio.filePath,
          t,
          s,
          c
        );
        if (S.confidence >= 0.4) {
          a.push({
            videoAssetId: p.id,
            audioAssetId: u.audio.id,
            offsetSeconds: S.offsetSeconds,
            matchMethod: S.method,
            nameScore: u.nameScore,
            waveformScore: S.confidence
          }), r.add(u.audio.id), g = !0;
          break;
        }
      } catch {
        continue;
      }
    }
  }
  const d = new Set(a.map((f) => f.videoAssetId)), m = n.filter((f) => !d.has(f.id)).map((f) => f.id), l = o.filter((f) => !r.has(f.id)).map((f) => f.id);
  return e == null || e({ completedPairs: i, totalPairs: i, currentVideoName: "", currentAudioName: "" }), { pairs: a, unmatchedVideos: m, unmatchedAudio: l };
}
async function yt(n, o, t, s, c) {
  const e = [];
  try {
    const [a, r] = await Promise.all([
      Y(n, s),
      Y(o, s)
    ]);
    if (a && r) {
      const u = a.fps, S = at(a.timecode, r.timecode, u);
      if (S !== null)
        return { offsetSeconds: S, method: "timecode", confidence: 1 };
    }
    const [i, d] = await Promise.all([
      J(n, s),
      J(o, s)
    ]);
    if (!i) throw new Error("Source video has no audio stream");
    if (!d) throw new Error("Target audio file has no audio stream");
    const m = await wt(
      n,
      o,
      t,
      s,
      c,
      e
    );
    if (m && m.confidence >= mt)
      return console.log(
        `[audio-sync] Using sampled waveform result (confidence=${m.confidence.toFixed(3)})`
      ), {
        offsetSeconds: m._offsetSeconds,
        method: "waveform",
        confidence: m.confidence
      };
    console.log(
      `[audio-sync] Falling back to full-file waveform sync${m ? ` (sampled confidence=${m.confidence.toFixed(3)})` : ""}`
    );
    const [l, f] = await Promise.all([
      H(n, t),
      H(o, t)
    ]);
    e.push(l, f);
    const [p, w] = await Promise.all([
      V(l),
      V(f)
    ]);
    console.log(`[audio-sync] Source PCM: ${p.length} samples (${(p.length / E).toFixed(1)}s)`), console.log(`[audio-sync] Target PCM: ${w.length} samples (${(w.length / E).toFixed(1)}s)`);
    const g = St(p, w, E);
    return {
      offsetSeconds: g._offsetSeconds,
      method: "waveform",
      confidence: g.confidence
    };
  } finally {
    const a = async (r) => {
      if (r)
        try {
          await st(r), await ct(x.dirname(r));
        } catch {
        }
    };
    await Promise.all(e.map((r) => a(r)));
  }
}
export {
  O as FP_INDEX_TO_SECONDS,
  ht as buildAnalysisWindows,
  It as computeBatchMatch,
  yt as computeSyncOffset,
  at as computeTimecodeOffset,
  Nt as crossCorrelateFingerprints,
  St as crossCorrelatePcm,
  H as extractAudioToTempPcm,
  pt as extractAudioToTempWav,
  K as extractFingerprint,
  R as extractMediaDuration,
  Y as extractTimecode,
  J as hasAudioStream,
  ft as levenshteinDistance,
  q as parseTimecode,
  X as popcount32,
  V as readPcmAsFloat32,
  lt as scoreFilenameSimilarity,
  it as searchFingerprintAnchor
};
