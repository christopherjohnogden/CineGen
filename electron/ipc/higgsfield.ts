// electron/ipc/higgsfield.ts
//
// Phase 0.2 — shared Higgsfield generation client. One service backs Spaces nodes, the Quick Edit
// modal, and the copilot agent; they differ only in how they gather inputs and where they place
// outputs.
//
// Transport: the official `higgsfield` CLI (aliases `higgs`/`hf`), spawned from the Electron main
// process (same pattern as gemini-cli.ts). The CLI owns auth (device login, local token store),
// auto-uploads local media paths passed to --image/--start-image/etc., and `generate create
// --wait --json` does submit→poll→result in one call. This sidesteps an undocumented REST gateway
// and a bespoke OAuth/keychain flow.
//
// The arg-building and JSON-parsing logic is PURE and unit-tested (tests/lib/higgsfield/client.test.ts).
// The spawn itself is thin and mockable.

import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export type HiggsfieldMediaType = 'image' | 'video';

/**
 * Real CLI job_set_type ids from `higgsfield model list`, keyed by CineGen node intent.
 * (These are the CLI's ids, which differ from the MCP's model ids — the CLI is our transport.)
 */
export const HIGGSFIELD_MODELS = {
  seedance: 'seedance_2_0',          // reference-driven video, strong identity, multi-shot
  kling: 'kling3_0',                 // multi-shot video (Kling v3.0)
  veo: 'veo3_1',                     // Google Veo 3.1
  soul: 'text2image_soul_v2',        // Higgsfield Soul V2 — portraits / character image
  soulCast: 'soul_cast',             // Soul Cast (video)
  nanoBanana: 'nano_banana_2',       // Nano Banana Pro — top-quality 4K image, text/diagrams
  gptImage: 'gpt_image_2',           // GPT Image 2 — general / design
} as const;

/** A reference input. role maps to a CLI media flag; value is a local path, upload UUID, or job id. */
export interface HiggsfieldMedia {
  value: string;
  role: 'image' | 'start_image' | 'end_image' | 'video' | 'audio';
}

export interface HiggsfieldGenerateParams {
  model: string;                 // real Higgsfield model id (e.g. 'seedance_2_0')
  prompt: string;
  mediaType: HiggsfieldMediaType;
  medias?: HiggsfieldMedia[];
  aspectRatio?: string;
  durationSec?: number;
  count?: number;                // 1-4
  extra?: Record<string, string | number>; // additional --name value params
}

export interface HiggsfieldResult {
  url: string;
  mediaType: HiggsfieldMediaType;
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

// --- Pure helpers (unit-tested) -------------------------------------------------

/**
 * Build argv for `higgsfield generate create <model> ...`. Pure.
 * Always includes `--wait --json` so the call blocks until the job finishes and emits machine JSON.
 */
export function buildCreateArgs(params: HiggsfieldGenerateParams): string[] {
  const args = ['generate', 'create', params.model, '--prompt', params.prompt.trim()];
  for (const media of params.medias ?? []) {
    if (!media.value) continue;
    args.push(MEDIA_ROLE_FLAG[media.role], media.value);
  }
  if (params.aspectRatio) args.push('--aspect_ratio', params.aspectRatio);
  if (typeof params.durationSec === 'number' && params.durationSec > 0) args.push('--duration', String(params.durationSec));
  if (typeof params.count === 'number' && params.count >= 1) args.push('--count', String(params.count));
  for (const [key, value] of Object.entries(params.extra ?? {})) {
    args.push(`--${key}`, String(value));
  }
  args.push('--wait', '--json');
  return args;
}

/** Pull a media URL out of the CLI's JSON result, tolerant of envelope shape. Pure. */
export function extractMediaUrl(record: Record<string, unknown>): string | undefined {
  const direct = record.url ?? record.video_url ?? record.image_url ?? record.output_url ?? record.result_url;
  if (typeof direct === 'string' && direct) return direct;
  for (const key of ['output', 'result', 'data', 'job']) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const found = extractMediaUrl(nested as Record<string, unknown>);
      if (found) return found;
    }
  }
  for (const key of ['results', 'outputs', 'medias', 'jobs', 'items']) {
    const arr = record[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === 'string' && first.startsWith('http')) return first;
      if (first && typeof first === 'object') {
        const found = extractMediaUrl(first as Record<string, unknown>);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/** Parse the JSON emitted by `generate create --wait --json` into a result, or throw on failure. Pure. */
export function parseGenerateJson(
  stdout: string,
  params: Pick<HiggsfieldGenerateParams, 'model' | 'mediaType'>,
): HiggsfieldResult {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('Higgsfield CLI returned no output');

  // The CLI may print one JSON object, or JSON lines — take the last parseable object.
  let parsed: Record<string, unknown> | null = null;
  for (const line of trimmed.split(/\r?\n/).reverse()) {
    const s = line.trim();
    if (!s.startsWith('{') && !s.startsWith('[')) continue;
    try {
      const obj = JSON.parse(s);
      parsed = Array.isArray(obj) ? { results: obj } : obj as Record<string, unknown>;
      break;
    } catch { /* keep scanning */ }
  }
  if (!parsed) {
    try { parsed = JSON.parse(trimmed) as Record<string, unknown>; } catch { parsed = null; }
  }
  if (!parsed) throw new Error('Higgsfield CLI output was not valid JSON');

  const state = String(parsed.state ?? parsed.status ?? '').toLowerCase();
  if (state === 'failed' || state === 'error' || state === 'fail') {
    throw new Error(typeof parsed.error === 'string' ? parsed.error : 'Higgsfield generation failed');
  }

  const url = extractMediaUrl(parsed);
  if (!url) throw new Error('Higgsfield generation finished without a media URL');

  const duration = parsed.duration ?? (parsed.output as Record<string, unknown> | undefined)?.duration;
  const jobId = parsed.job_id ?? parsed.id ?? parsed.jobId;
  return {
    url,
    mediaType: params.mediaType,
    durationSec: typeof duration === 'number' ? duration : undefined,
    jobId: typeof jobId === 'string' ? jobId : undefined,
    model: params.model,
  };
}

// --- CLI transport (thin, mockable) ---------------------------------------------

const HIGGSFIELD_BINARIES = [
  path.join(os.homedir(), '.npm-global/bin/higgsfield'),
  path.join(os.homedir(), '.local/bin/hf'),
  '/opt/homebrew/bin/higgsfield',
  '/usr/local/bin/higgsfield',
  'higgsfield',
];

function higgsfieldEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extra = [path.join(home, '.npm-global/bin'), path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter), NO_COLOR: '1' };
}

const GENERATE_TIMEOUT_MS = 8 * 60 * 1000;

/** Run a higgsfield CLI subcommand, returning stdout. Throws on non-zero exit with stderr. */
export function runHiggsfieldCli(args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const binary = HIGGSFIELD_BINARIES[0];
    const finalArgs = args.includes('--json') ? args : [...args, '--json'];
    const child = spawn(binary, finalArgs, { env: higgsfieldEnv() });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Higgsfield CLI timed out')); }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(stdout); return; }
      const msg = stderr.trim() || stdout.trim() || `Higgsfield CLI exited with code ${code}`;
      reject(new Error(/session expired/i.test(msg) ? 'Higgsfield is not connected. Run "higgsfield auth login" or connect it in Settings.' : msg));
    });
  });
}

/** Submit + wait for a generation via the CLI. */
export async function generateHiggsfield(params: HiggsfieldGenerateParams): Promise<HiggsfieldResult> {
  const stdout = await runHiggsfieldCli(buildCreateArgs(params), GENERATE_TIMEOUT_MS);
  return parseGenerateJson(stdout, params);
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

export function registerHiggsfieldHandlers(): void {
  ipcMain.handle('higgsfield:account-status', async (): Promise<HiggsfieldConnectionState> => {
    return parseConnectionState(await getHiggsfieldAccountStatus());
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
