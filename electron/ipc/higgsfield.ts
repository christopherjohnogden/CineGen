// electron/ipc/higgsfield.ts
//
// Phase 0.2 — shared Higgsfield generation client. One service backs Spaces nodes, the Quick Edit
// modal, and the copilot agent; they differ only in how they gather inputs and where they place
// outputs.
//
// Transport: the official `higgsfield` CLI (aliases `higgs`/`hf`), spawned from the Electron main
// process (same pattern as gemini-cli.ts). The CLI owns auth (device login, local token store),
// auto-uploads local media paths passed to --image/--start-image/etc. Submit is `generate create
// --json` (no wait); a 503 while polling does not cancel the job — we `generate wait` / `get` the
// id. `generate create --wait --json` is still the default argv for callers that opt in.
//
// The arg-building and JSON-parsing logic is PURE and unit-tested (tests/lib/higgsfield/client.test.ts).
// The spawn itself is thin and mockable.

import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickKnownHiggsfieldParams } from '../../src/lib/higgsfield/model-catalog.js';

// Single source of truth for model ids (shared with the renderer).
export { HIGGSFIELD_MODELS } from '../../src/lib/higgsfield/higgsfield-models.js';

export type HiggsfieldMediaType = 'image' | 'video';
export type HiggsfieldOutputKind = HiggsfieldMediaType | 'audio' | 'text' | '3d';

/** A reference input. role maps to a CLI media flag; value is a local path, upload UUID, or job id. */
export interface HiggsfieldMedia {
  value: string;
  role: 'image' | 'start_image' | 'end_image' | 'video' | 'audio';
}

export interface HiggsfieldGenerateParams {
  model: string;                 // real Higgsfield model id (e.g. 'seedance_2_0')
  /** Optional because many utility, enhancement, audio, and 3D models do not accept a prompt. */
  prompt?: string;
  /** Kept as mediaType for compatibility with the existing Quick Edit and Copilot callers. */
  mediaType: HiggsfieldOutputKind;
  medias?: HiggsfieldMedia[];
  aspectRatio?: string;
  durationSec?: number;
  count?: number;                // 1-4
  /** Schema-driven model params. Arrays and objects are serialized as JSON CLI values. */
  params?: Record<string, unknown>;
  /** Backward-compatible alias for older callers. `params` wins when the same key is present. */
  extra?: Record<string, unknown>;
  /** When false, submit only (no `--wait`). Default true. */
  wait?: boolean;
}

export interface HiggsfieldOutput {
  kind: HiggsfieldOutputKind;
  url?: string;
  text?: string;
}

export interface HiggsfieldResult {
  /** First URL, retained for existing image/video callers. */
  url?: string;
  /** Every URL returned when a request creates more than one output. */
  urls?: string[];
  /** Text returned by text-output models. */
  text?: string;
  /** Retained for existing callers; now covers every Higgsfield output kind. */
  mediaType: HiggsfieldOutputKind;
  outputKind: HiggsfieldOutputKind;
  outputs: HiggsfieldOutput[];
  durationSec?: number;
  jobId?: string;
  model: string;
}

const MEDIA_ROLE_FLAG: Record<HiggsfieldMedia['role'], string> = {
  image: '--image',
  start_image: '--start-image',
  end_image: '--end-image',
  video: '--video',
  audio: '--audio',
};

const PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED_PARAM_NAMES = new Set(['json', 'wait', 'no_color']);

// --- Pure helpers (unit-tested) -------------------------------------------------

/**
 * Build argv for `higgsfield generate create <model> ...`. Pure.
 * Always includes `--wait --json` so the call blocks until the job finishes and emits machine JSON.
 */
export function buildCreateArgs(params: HiggsfieldGenerateParams): string[] {
  const args = ['generate', 'create', params.model];
  const genericParams: Record<string, unknown> = {
    ...(pickKnownHiggsfieldParams(params.model, { ...params.extra, ...params.params }) ?? {}),
  };

  const appendParam = (name: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (!PARAM_NAME_PATTERN.test(name) || RESERVED_PARAM_NAMES.has(name)) {
      throw new Error(`Invalid Higgsfield parameter name: ${name}`);
    }

    let serialized: string;
    if (typeof value === 'string') {
      serialized = name === 'prompt' ? value.trim() : value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Higgsfield parameter ${name} must be finite`);
      serialized = String(value);
    } else if (typeof value === 'boolean') {
      serialized = value ? 'true' : 'false';
    } else if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        if (json === undefined) throw new Error('not JSON serializable');
        serialized = json;
      } catch (error) {
        throw new Error(`Higgsfield parameter ${name} must be JSON serializable`, { cause: error });
      }
    } else {
      throw new Error(`Higgsfield parameter ${name} has an unsupported value type`);
    }
    args.push(`--${name}`, serialized);
  };

  const prompt = params.prompt !== undefined ? params.prompt : genericParams.prompt;
  delete genericParams.prompt;
  appendParam('prompt', prompt);

  for (const media of params.medias ?? []) {
    if (!media.value) continue;
    args.push(MEDIA_ROLE_FLAG[media.role], media.value);
  }

  if (params.aspectRatio !== undefined) {
    delete genericParams.aspect_ratio;
    appendParam('aspect_ratio', params.aspectRatio);
  }
  if (params.durationSec !== undefined) {
    delete genericParams.duration;
    if (params.durationSec > 0) appendParam('duration', params.durationSec);
  }
  if (params.count !== undefined) {
    delete genericParams.count;
    if (params.count >= 1) appendParam('count', params.count);
  }
  for (const [key, value] of Object.entries(genericParams)) {
    appendParam(key, value);
  }
  if (params.wait !== false) args.push('--wait');
  args.push('--json');
  return args;
}

export class HiggsfieldCliError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  constructor(message: string, stdout = '', stderr = '') {
    super(message);
    this.name = 'HiggsfieldCliError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function isTransientHiggsfieldError(message: string): boolean {
  return /HTTP\s*50[234]|50[234]\s+[\w\s]*Unavailable|502 Bad Gateway|504 Gateway|ECONNRESET|ETIMEDOUT|socket hang up|no response received|HTTP\s*429|rate limit|temporarily unavailable|service unavailable/i.test(message);
}

const JOB_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface HiggsfieldJobSnapshot {
  status: string;
  jobId?: string;
  record: Record<string, unknown>;
  parsed: Record<string, unknown>;
}

function firstJobRecord(parsed: Record<string, unknown>): Record<string, unknown> {
  const results = parsed.results;
  if (Array.isArray(results) && results.length > 0 && typeof results[0] === 'object' && results[0]) {
    return results[0] as Record<string, unknown>;
  }
  return parsed;
}

/** Parse CLI JSON into a job snapshot. Does not require a result URL. */
export function parseJobSnapshot(stdout: string): HiggsfieldJobSnapshot {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('Higgsfield CLI returned no output');

  const normalize = (obj: unknown): Record<string, unknown> => {
    if (Array.isArray(obj)) return { results: obj };
    if (isRecord(obj)) return obj;
    return { result: obj };
  };

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = normalize(JSON.parse(trimmed));
  } catch {
    for (const line of trimmed.split(/\r?\n/).reverse()) {
      const s = line.trim();
      if (!s.startsWith('{') && !s.startsWith('[')) continue;
      try { parsed = normalize(JSON.parse(s)); break; } catch { /* keep scanning */ }
    }
  }
  if (!parsed) throw new Error('Higgsfield CLI output was not valid JSON');

  const record = firstJobRecord(parsed);
  const jobIdRaw = record.job_id ?? record.id ?? record.jobId;
  return {
    status: String(record.state ?? record.status ?? '').toLowerCase(),
    jobId: typeof jobIdRaw === 'string' && jobIdRaw.trim() ? jobIdRaw.trim() : undefined,
    record,
    parsed,
  };
}

export function extractHiggsfieldJobId(...chunks: Array<string | undefined>): string | undefined {
  const text = chunks.filter(Boolean).join('\n');
  try {
    const id = parseJobSnapshot(text).jobId;
    if (id) return id;
  } catch { /* not JSON */ }
  return text.match(JOB_ID_RE)?.[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Pull every media URL out of the CLI's JSON result, tolerant of envelope shape. Pure. */
export function extractMediaUrls(value: unknown, depth = 0): string[] {
  if (depth > 12) return [];
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? [value] : [];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => extractMediaUrls(entry, depth + 1)))];
  }
  if (!isRecord(value)) return [];

  const urls: string[] = [];
  for (const key of ['url', 'video_url', 'image_url', 'audio_url', 'model_url', 'output_url', 'result_url']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) urls.push(candidate);
  }
  for (const key of ['output', 'result', 'data', 'job', 'results', 'outputs', 'medias', 'jobs', 'items']) {
    urls.push(...extractMediaUrls(value[key], depth + 1));
  }
  return [...new Set(urls)];
}

/** Pull the first media URL out of the CLI's JSON result. Retained for compatibility. */
export function extractMediaUrl(record: Record<string, unknown>): string | undefined {
  return extractMediaUrls(record)[0];
}

/** Pull a text result out of common Higgsfield response envelopes. Pure. */
export function extractTextOutput(value: unknown, depth = 0): string | undefined {
  if (depth > 12) return undefined;
  if (typeof value === 'string') {
    const text = value.trim();
    return text && !/^https?:\/\//i.test(text) ? text : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractTextOutput(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const key of ['text', 'output_text', 'result_text', 'response_text', 'answer', 'content']) {
    const candidate = value[key];
    if (typeof candidate === 'string') {
      const text = candidate.trim();
      if (text && !/^https?:\/\//i.test(text)) return text;
    }
  }
  // CLI ≥1.x llm_text jobs carry their answer in result_json — a JSON string
  // that may itself be an envelope, so try to dig before falling back to raw.
  const rawJson = value.result_json;
  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      const found = extractTextOutput(JSON.parse(rawJson) as unknown, depth + 1);
      if (found) return found;
    } catch { /* not JSON — the string is the answer */ }
    return rawJson.trim();
  }
  for (const key of ['output', 'result', 'data', 'job', 'results', 'outputs', 'items']) {
    const found = extractTextOutput(value[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Parse the JSON emitted by `generate create --wait --json` into a result, or throw on failure. Pure. */
export function parseGenerateJson(
  stdout: string,
  params: Pick<HiggsfieldGenerateParams, 'model' | 'mediaType'>,
): HiggsfieldResult {
  const snap = parseJobSnapshot(stdout);
  if (snap.status === 'failed' || snap.status === 'error' || snap.status === 'fail') {
    throw new Error(typeof snap.record.error === 'string' ? snap.record.error : 'Higgsfield generation failed');
  }
  const result = snapshotToResult(snap, params);
  if (!result.url && !result.text) throw new Error('Higgsfield generation finished without a media URL or text output');
  return result;
}

function snapshotToResult(
  snap: HiggsfieldJobSnapshot,
  params: Pick<HiggsfieldGenerateParams, 'model' | 'mediaType'>,
): HiggsfieldResult {
  const urls = extractMediaUrls(snap.parsed);
  const url = urls[0];
  const text = extractTextOutput(snap.parsed);
  const duration = snap.record.duration ?? (snap.record.output as Record<string, unknown> | undefined)?.duration;
  const outputKind = params.mediaType;
  const outputs: HiggsfieldOutput[] = urls.map((outputUrl) => ({ kind: outputKind, url: outputUrl }));
  if (text) outputs.push({ kind: 'text', text });
  return {
    ...(url ? { url, urls } : {}),
    ...(text ? { text } : {}),
    mediaType: outputKind,
    outputKind,
    outputs,
    durationSec: typeof duration === 'number'
      ? duration
      : (typeof duration === 'string' && Number.isFinite(Number(duration)) ? Number(duration) : undefined),
    jobId: snap.jobId,
    model: params.model,
  };
}

function cliErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cliErrorOutput(error: unknown): { stdout: string; stderr: string } {
  if (error instanceof HiggsfieldCliError) return { stdout: error.stdout, stderr: error.stderr };
  return { stdout: '', stderr: '' };
}

async function resultFromStdout(
  stdout: string,
  params: Pick<HiggsfieldGenerateParams, 'model' | 'mediaType'>,
): Promise<HiggsfieldResult | undefined> {
  if (!stdout.trim()) return undefined;
  try {
    return parseGenerateJson(stdout, params);
  } catch {
    return undefined;
  }
}

// --- CLI transport (thin, mockable) ---------------------------------------------

/** Absolute installs plus PATH names. Do not include a bare `hf` — that is often HuggingFace Hub. */
export function higgsfieldBinaryCandidates(home = os.homedir()): string[] {
  return [
    path.join(home, '.npm-global/bin/higgsfield'),
    path.join(home, '.npm-global/bin/higgs'),
    path.join(home, '.local/bin/higgsfield'),
    path.join(home, '.local/bin/higgs'),
    '/opt/homebrew/bin/higgsfield',
    '/opt/homebrew/bin/higgs',
    '/usr/local/bin/higgsfield',
    '/usr/local/bin/higgs',
    'higgsfield',
    'higgs',
  ];
}

export function isBareBinaryName(file: string): boolean {
  return !file.includes('/') && !file.includes('\\');
}

/** Keep PATH names; drop missing absolute paths so we never spawn HuggingFace `hf` by accident. */
export function pickHiggsfieldBinaries(
  candidates: readonly string[] = higgsfieldBinaryCandidates(),
  exists: (file: string) => boolean = (file) => {
    try { return fs.existsSync(file); } catch { return false; }
  },
): string[] {
  const found: string[] = [];
  const pathNames: string[] = [];
  for (const bin of candidates) {
    if (isBareBinaryName(bin)) {
      if (!pathNames.includes(bin)) pathNames.push(bin);
      continue;
    }
    if (exists(bin) && !found.includes(bin)) found.push(bin);
  }
  return [...found, ...pathNames];
}

function higgsfieldEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extra = [path.join(home, '.npm-global/bin'), path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter), NO_COLOR: '1' };
}

const GENERATE_TIMEOUT_MS = 21 * 60 * 1000;
const SUBMIT_TIMEOUT_MS = 90_000;
const WAIT_ATTEMPTS = 4;
const CLI_MISSING_MESSAGE = 'Higgsfield CLI not found. Install @higgsfield/cli, then run higgsfield auth login — or connect Higgsfield in Settings.';

function isMissingBinaryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'ENOENT' || /ENOENT|spawn .* ENOENT/i.test(message);
}

let cachedHiggsfieldBinary: string | null = null;

function spawnHiggsfield(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: higgsfieldEnv() });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new HiggsfieldCliError('Higgsfield CLI timed out', stdout, stderr));
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(stdout); return; }
      const msg = stderr.trim() || stdout.trim() || `Higgsfield CLI exited with code ${code}`;
      const message = /session expired/i.test(msg)
        ? 'Higgsfield is not connected. Run "higgsfield auth login" or connect it in Settings.'
        : msg;
      reject(new HiggsfieldCliError(message, stdout, stderr));
    });
  });
}

/** Run a higgsfield CLI subcommand, returning stdout. Throws on non-zero exit with stderr. */
export async function runHiggsfieldCli(args: string[], timeoutMs = 60_000): Promise<string> {
  const finalArgs = args.includes('--json') ? args : [...args, '--json'];
  const ordered = pickHiggsfieldBinaries();
  const candidates = cachedHiggsfieldBinary
    ? [cachedHiggsfieldBinary, ...ordered.filter((bin) => bin !== cachedHiggsfieldBinary)]
    : ordered;
  if (candidates.length === 0) throw new Error(CLI_MISSING_MESSAGE);

  let lastMissing: unknown;
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
  const tried = candidates.join(', ');
  const detail = lastMissing instanceof Error ? lastMissing.message : '';
  throw new Error(detail ? `${CLI_MISSING_MESSAGE} Tried: ${tried}. ${detail}` : `${CLI_MISSING_MESSAGE} Tried: ${tried}.`);
}

/** Submit the job, then wait — a 503 during poll does not cancel a job already on Higgsfield. */
export async function generateHiggsfield(params: HiggsfieldGenerateParams): Promise<HiggsfieldResult> {
  const submitted = await submitHiggsfieldJob(params);
  if ('outputs' in submitted) return submitted;
  return waitForHiggsfieldJob(submitted.jobId, params);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitHiggsfieldJob(
  params: HiggsfieldGenerateParams,
): Promise<HiggsfieldResult | { jobId: string }> {
  const args = buildCreateArgs({ ...params, wait: false });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stdout = await runHiggsfieldCli(args, SUBMIT_TIMEOUT_MS);
      const done = await resultFromStdout(stdout, params);
      if (done) return done;
      const jobId = extractHiggsfieldJobId(stdout);
      if (jobId) return { jobId };
      throw new Error('Higgsfield accepted the request but did not return a job id.');
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
  throw lastError instanceof Error ? lastError : new Error('Higgsfield submit failed');
}

async function readHiggsfieldJob(
  jobId: string,
  params: Pick<HiggsfieldGenerateParams, 'model' | 'mediaType'>,
): Promise<HiggsfieldResult | undefined> {
  const stdout = await runHiggsfieldCli(['generate', 'get', jobId], 20_000);
  const snap = parseJobSnapshot(stdout);
  if (snap.status === 'failed' || snap.status === 'error' || snap.status === 'fail') {
    throw new Error(typeof snap.record.error === 'string' ? snap.record.error : 'Higgsfield generation failed');
  }
  const result = snapshotToResult(snap, params);
  return result.url || result.text ? result : undefined;
}

async function waitForHiggsfieldJob(
  jobId: string,
  params: Pick<HiggsfieldGenerateParams, 'model' | 'mediaType'>,
): Promise<HiggsfieldResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt++) {
    try {
      const stdout = await runHiggsfieldCli(
        ['generate', 'wait', jobId, '--timeout', '20m', '--interval', '5s'],
        GENERATE_TIMEOUT_MS,
      );
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
      if (!isTransientHiggsfieldError(message) && !/timed out/i.test(message)) throw error;
      if (attempt === WAIT_ATTEMPTS) break;
      await sleep(2000 * attempt);
    }
  }
  throw new Error(
    `${cliErrorMessage(lastError)} The job was submitted (${jobId}) and may still finish on Higgsfield.`,
  );
}

/** Account/connection status (email, plan, credits) or null when not signed in. */
export async function getHiggsfieldAccountStatus(): Promise<Record<string, unknown> | null> {
  try {
    const stdout = await runHiggsfieldCli(['account', 'status'], 15_000);
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface HiggsfieldConnectionState {
  connected: boolean;
  email?: string;
  plan?: string;
  credits?: number;
  error?: string;
}

/** Normalize an `account status` JSON payload into a connection state. Pure. */
export function parseConnectionState(account: Record<string, unknown> | null): HiggsfieldConnectionState {
  if (!account) return { connected: false };
  const data = (account.data && typeof account.data === 'object' ? account.data : account) as Record<string, unknown>;
  // Live `account status --json` shape: { email, credits, subscription_plan_type }.
  const plan = data.subscription_plan_type ?? data.plan;
  return {
    connected: true,
    email: typeof data.email === 'string' ? data.email : undefined,
    plan: typeof plan === 'string' ? plan : undefined,
    credits: typeof data.credits === 'number' ? data.credits : (typeof data.balance === 'number' ? data.balance : undefined),
  };
}

export interface QuickEditParams {
  fileRef: string;
  prompt: string;
  model: string;
  outputType: HiggsfieldMediaType;
  referenceMode: 'frame' | 'segment' | 'first-last';
  frameTimeSec?: number;
  sourceStartSec?: number;
  sourceEndSec?: number;
  /** Clean frame PNG (Frame Chat). When set with frame mode, used as the edit reference. */
  drawnFramePath?: string;
  /** Annotated frame PNG (marking shows the region to change). Sent as a second image guide. */
  guideFramePath?: string;
  /** Output aspect ratio (e.g. '16:9'); defaults to the model's own default when omitted. */
  aspectRatio?: string;
}

/**
 * Choose the media references for a Quick Edit generation. When the user drew on the frame
 * (frame mode), the flattened drawing IS the reference; otherwise use the extracted refs.
 */
export function selectQuickEditMedias(opts: {
  referenceMode: 'frame' | 'segment' | 'first-last';
  outputType: HiggsfieldMediaType;
  drawnFramePath?: string;
  /** Annotated frame (marking shows where to edit). Sent as a SECOND image alongside the clean
   * reference so the marks guide placement without being baked into the output. */
  guideFramePath?: string;
  extractedPaths: string[];
  extractedRoles: Array<'image' | 'start_image' | 'end_image'>;
}): HiggsfieldMedia[] {
  if (opts.drawnFramePath && opts.referenceMode === 'frame') {
    const role: HiggsfieldMedia['role'] = opts.outputType === 'video' ? 'start_image' : 'image';
    const medias: HiggsfieldMedia[] = [{ value: opts.drawnFramePath, role }];
    // Attach the annotated guide frame as an additional image reference.
    if (opts.guideFramePath) medias.push({ value: opts.guideFramePath, role: 'image' });
    return medias;
  }
  return opts.extractedPaths.map((p, i) => ({
    value: p,
    role: (opts.extractedRoles[i] ?? 'image') as HiggsfieldMedia['role'],
  }));
}

export function registerHiggsfieldHandlers(): void {
  ipcMain.handle('higgsfield:account-status', async (): Promise<HiggsfieldConnectionState> => {
    return parseConnectionState(await getHiggsfieldAccountStatus());
  });

  // One-shot Quick Edit: extract reference media from the source clip, then generate. The CLI
  // auto-uploads the local reference paths. Returns the media URL for the renderer to place.
  ipcMain.handle('higgsfield:quick-edit', async (_event, params: QuickEditParams): Promise<HiggsfieldResult> => {
    const { prepareClipReference, resolveLocalSourcePath } = await import('./copilot-visual-media.js');
    console.log('[higgsfield:quick-edit] params:', { fileRef: params.fileRef, mode: params.referenceMode, model: params.model, range: [params.sourceStartSec, params.sourceEndSec] });

    let medias: HiggsfieldMedia[] = [];
    const isRemote = /^https?:\/\//i.test(params.fileRef);
    const localPath = isRemote ? null : resolveLocalSourcePath(params.fileRef);

    if (params.drawnFramePath && params.referenceMode === 'frame') {
      // The user drew on the frame — the clean PNG is the reference (no extraction needed); the
      // annotated guide frame, if present, rides along as a second image.
      medias = selectQuickEditMedias({
        referenceMode: 'frame', outputType: params.outputType,
        drawnFramePath: params.drawnFramePath, guideFramePath: params.guideFramePath,
        extractedPaths: [], extractedRoles: [],
      });
    } else if (localPath) {
      // Local source → extract a frame/segment (the CLI auto-uploads the local file).
      try {
        const prepared = await prepareClipReference(params.fileRef, {
          mode: params.referenceMode,
          frameTimeSec: params.frameTimeSec,
          sourceStartSec: params.sourceStartSec,
          sourceEndSec: params.sourceEndSec,
        });
        console.log('[higgsfield:quick-edit] extracted refs:', prepared.paths);
        medias = selectQuickEditMedias({
          referenceMode: params.referenceMode,
          outputType: params.outputType,
          drawnFramePath: params.drawnFramePath,
          extractedPaths: prepared.paths,
          extractedRoles: prepared.roles,
        });
      } catch (err) {
        console.warn('[higgsfield:quick-edit] extraction failed, falling back to source path:', err);
        medias = [{ value: localPath, role: params.outputType === 'video' ? 'start_image' : 'image' }];
      }
    } else if (isRemote) {
      // Remote URL → pass straight to the CLI (it accepts https media values).
      console.log('[higgsfield:quick-edit] remote source, passing URL directly');
      medias = [{ value: params.fileRef, role: params.outputType === 'video' ? 'start_image' : 'image' }];
    } else {
      throw new Error(`Quick Edit could not resolve the clip's source media: ${params.fileRef}`);
    }

    return generateHiggsfield({
      model: params.model,
      prompt: params.prompt,
      mediaType: params.outputType,
      medias: medias.length > 0 ? medias : undefined,
      aspectRatio: params.aspectRatio,
    });
  });

  // Prompt-only (text→media) generation, optionally with a reference media value (local path or
  // https URL the CLI accepts). Used by the copilot generate_media skill action.
  ipcMain.handle('higgsfield:generate', async (_event, params: {
    prompt?: string;
    model: string;
    outputType: HiggsfieldOutputKind;
    referenceValue?: string;
    medias?: HiggsfieldMedia[];
    params?: Record<string, unknown>;
  }): Promise<HiggsfieldResult> => {
    const { resolveLocalSourcePath } = await import('./copilot-visual-media.js');
    const medias: HiggsfieldMedia[] = [...(params.medias ?? [])].map((media) => {
      if (!media.value || /^https?:\/\//i.test(media.value)) return media;
      const local = resolveLocalSourcePath(media.value);
      return local ? { ...media, value: local } : media;
    });
    if (params.referenceValue) {
      medias.push({
        value: params.referenceValue,
        role: params.outputType === 'video' ? 'start_image' : 'image',
      });
    }
    return generateHiggsfield({
      model: params.model,
      prompt: params.prompt,
      mediaType: params.outputType,
      medias: medias.length > 0 ? medias : undefined,
      params: params.params,
    });
  });

  // Browser-based device login. Resolves when the CLI exits (user completed or aborted in browser).
  ipcMain.handle('higgsfield:auth-login', async (): Promise<HiggsfieldConnectionState> => {
    try {
      await runHiggsfieldCli(['auth', 'login'], 5 * 60 * 1000);
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error) };
    }
    return parseConnectionState(await getHiggsfieldAccountStatus());
  });

  ipcMain.handle('higgsfield:auth-logout', async (): Promise<void> => {
    await runHiggsfieldCli(['auth', 'logout'], 15_000).catch(() => {});
  });
}
