import { app, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ARTLIST_MCP_URL = 'https://mcp.artlist.io/mcp';
const ARTLIST_SERVER_NAME = 'artlist';
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;

const CLAUDE_CANDIDATES = [
  path.join(os.homedir(), '.local/bin/claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  'claude',
];

export interface ArtlistGenerateParams {
  prompt: string;
  model?: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
  medias?: Array<{ value: string; role?: string }>;
}

export interface ArtlistGenerateResult {
  url: string;
  mediaType: 'video';
  durationSec?: number;
  generationId?: string;
  accountUrl?: string;
  model?: string;
}

function cliEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? '';
  return {
    ...process.env,
    PATH: [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', currentPath]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

async function resolveClaudeBinary(): Promise<string | null> {
  for (const candidate of CLAUDE_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(candidate, ['--version'], {
        env: cliEnv(),
        timeout: 8000,
      });
      if (stdout.toLowerCase().includes('claude')) return candidate;
    } catch {
      // Try the next known install location.
    }
  }
  return null;
}

function mcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      [ARTLIST_SERVER_NAME]: {
        type: 'http',
        url: ARTLIST_MCP_URL,
      },
    },
  });
}

export function buildArtlistGenerationPrompt(params: ArtlistGenerateParams): string {
  const references = [...new Set((params.medias ?? [])
    .map((media) => media.value.trim())
    .filter(Boolean))]
    .slice(0, 3);
  const settings = [
    `duration: ${Math.max(1, Math.round(params.durationSec ?? 5))} seconds`,
    `aspect ratio: ${params.aspectRatio?.trim() || '16:9'}`,
    `resolution: ${params.resolution?.trim() || '720p'}`,
    `generated audio: ${params.generateAudio ? 'on' : 'off'}`,
    params.model?.trim() && params.model.trim() !== 'auto'
      ? `model: ${params.model.trim()}`
      : 'model: choose the best available Artlist video model for this request',
  ];
  const referenceBlock = references.length > 0
    ? [
        '',
        'REFERENCE IMAGES (identity and design are locked to these images):',
        ...references.map((url, index) => `${index + 1}. ${url}`),
        'Use every supplied reference. Preserve the depicted character, location, prop, vehicle, wardrobe, and design details in the video.',
      ].join('\n')
    : '';

  return [
    'Use the Artlist MCP to generate one finished video now. This request is already approved by the user and may consume Artlist credits.',
    'Do not merely recommend a model or explain how to generate it; call the Artlist generation tool and wait for the completed result.',
    '',
    'VIDEO BRIEF',
    params.prompt.trim(),
    '',
    'SETTINGS',
    ...settings,
    referenceBlock,
    '',
    'After generation, respond with JSON only in this shape:',
    '{"url":"direct downloadable video URL","generationId":"optional","accountUrl":"optional Artlist account/session URL","model":"optional","durationSec":5}',
  ].filter((line) => line !== '').join('\n');
}

function jsonCandidates(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  const nested = ['result', 'data', 'output'].flatMap((key) => {
    const candidate = row[key];
    if (candidate && typeof candidate === 'object') return jsonCandidates(candidate);
    if (typeof candidate === 'string') {
      try { return jsonCandidates(JSON.parse(candidate)); } catch { return []; }
    }
    return [];
  });
  return [row, ...nested];
}

function firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseArtlistGenerationOutput(stdout: string): ArtlistGenerateResult {
  const trimmed = stdout.trim();
  let envelope: unknown;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    envelope = undefined;
  }

  const textParts: string[] = [trimmed];
  if (envelope && typeof envelope === 'object') {
    const row = envelope as Record<string, unknown>;
    for (const key of ['result', 'text', 'message']) {
      if (typeof row[key] === 'string') textParts.unshift(row[key] as string);
    }
  }

  const candidates = jsonCandidates(envelope);
  for (const text of textParts) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    for (const candidate of [fenced, text]) {
      if (!candidate) continue;
      try { candidates.unshift(...jsonCandidates(JSON.parse(candidate))); } catch { /* keep scanning */ }
    }
    const inline = text.match(/\{[\s\S]*\}/)?.[0];
    if (inline) {
      try { candidates.unshift(...jsonCandidates(JSON.parse(inline))); } catch { /* keep scanning */ }
    }
  }

  for (const row of candidates) {
    const url = firstString(row, ['url', 'videoUrl', 'video_url', 'downloadUrl', 'download_url', 'mediaUrl', 'media_url']);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const duration = Number(row.durationSec ?? row.duration_sec ?? row.duration);
    return {
      url,
      mediaType: 'video',
      ...(Number.isFinite(duration) && duration > 0 ? { durationSec: duration } : {}),
      ...(firstString(row, ['generationId', 'generation_id', 'id']) ? { generationId: firstString(row, ['generationId', 'generation_id', 'id']) } : {}),
      ...(firstString(row, ['accountUrl', 'account_url', 'sessionUrl', 'session_url']) ? { accountUrl: firstString(row, ['accountUrl', 'account_url', 'sessionUrl', 'session_url']) } : {}),
      ...(firstString(row, ['model', 'modelId', 'model_id']) ? { model: firstString(row, ['model', 'modelId', 'model_id']) } : {}),
    };
  }

  const videoUrl = textParts.join('\n').match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/i)?.[0];
  if (videoUrl) return { url: videoUrl, mediaType: 'video' };
  throw new Error('Artlist finished without returning a downloadable video URL. Open the Artlist MCP session in your account to retrieve the generation.');
}

async function artlistStatus(binary: string): Promise<{ connected: boolean; configured: boolean; error?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['mcp', 'get', ARTLIST_SERVER_NAME], {
      env: cliEnv(),
      timeout: 20_000,
    });
    const output = `${stdout}\n${stderr}`;
    const disconnected = /not connected|authentication required|needs authentication|login required|failed|error/i.test(output);
    return {
      connected: !disconnected,
      configured: true,
      ...(disconnected ? { error: 'Artlist needs to be authorized.' } : {}),
    };
  } catch (error) {
    void error;
    return { connected: false, configured: false };
  }
}

async function ensureConfigured(binary: string): Promise<void> {
  const status = await artlistStatus(binary);
  if (status.configured) return;
  await execFileAsync(binary, [
    'mcp', 'add', '--transport', 'http', '--scope', 'user', ARTLIST_SERVER_NAME, ARTLIST_MCP_URL,
  ], {
    env: cliEnv(),
    timeout: 20_000,
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function artlistLoginCommand(
  binary: string,
  platform = process.platform,
  loginScriptPath = '/tmp/cinegen-artlist-login.command',
): { file: string; args: string[]; detached: boolean; script?: { path: string; contents: string } } {
  if (platform === 'darwin') {
    // Claude's MCP OAuth flow must remain attached to a real terminal until the
    // browser callback completes. Opening an executable .command file gives it
    // that terminal without requiring macOS Automation access to Terminal.
    const contents = [
      '#!/bin/zsh',
      `printf '\\033]0;Artlist sign in\\007'`,
      `${shellQuote(binary)} mcp login ${ARTLIST_SERVER_NAME}`,
      'status=$?',
      'if (( status != 0 )); then',
      '  echo',
      '  echo "Artlist sign-in did not complete. Press Return to close."',
      '  read -r',
      'fi',
      'exit $status',
      '',
    ].join('\n');
    return {
      file: '/usr/bin/open',
      args: [loginScriptPath],
      detached: true,
      script: { path: loginScriptPath, contents },
    };
  }
  return { file: binary, args: ['mcp', 'login', ARTLIST_SERVER_NAME], detached: false };
}

function friendlyArtlistLoginError(error: unknown): string {
  const detail = error && typeof error === 'object'
    ? `${String((error as { message?: unknown }).message ?? '')}\n${String((error as { stderr?: unknown }).stderr ?? '')}`
    : String(error ?? '');
  if (/stdin isn't a terminal|interactive terminal|authentication can't be completed/i.test(detail)) {
    return 'Artlist sign-in needs an interactive window. Update Claude Code, then try Connect Artlist again.';
  }
  if (/timed out|ETIMEDOUT/i.test(detail)) {
    return 'Artlist sign-in timed out before browser authorization finished. Try connecting again.';
  }
  return 'Artlist sign-in did not complete. Try Connect Artlist again.';
}

async function waitForArtlistLogin(binary: string, timeoutMs = 3 * 60 * 1000): Promise<{ connected: boolean; configured: boolean; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await artlistStatus(binary);
    if (status.connected) return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Artlist authorization was not completed. Finish sign-in in the browser, then try Connect Artlist again.');
}

async function generateWithArtlist(binary: string, params: ArtlistGenerateParams): Promise<ArtlistGenerateResult> {
  const workspace = path.join(app.getPath('userData'), 'artlist-mcp-workspace');
  await mkdir(workspace, { recursive: true });
  const prompt = buildArtlistGenerationPrompt(params);
  const { stdout } = await execFileAsync(binary, [
    '-p', prompt,
    '--output-format', 'json',
    '--model', 'sonnet',
    '--max-turns', '8',
    '--tools', '',
    '--allowedTools', 'mcp__artlist__*',
    '--mcp-config', mcpConfig(),
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk',
    '--disable-slash-commands',
    '--no-session-persistence',
  ], {
    cwd: workspace,
    env: cliEnv(),
    timeout: GENERATION_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseArtlistGenerationOutput(stdout);
}

export function registerArtlistHandlers(): void {
  ipcMain.handle('artlist:account-status', async () => {
    const binary = await resolveClaudeBinary();
    if (!binary) {
      return { connected: false, configured: false, error: 'Claude Code is required for the Artlist MCP connection.' };
    }
    return artlistStatus(binary);
  });

  ipcMain.handle('artlist:auth-login', async () => {
    const binary = await resolveClaudeBinary();
    if (!binary) throw new Error('Install Claude Code before connecting Artlist.');
    await ensureConfigured(binary);
    const command = artlistLoginCommand(
      binary,
      process.platform,
      path.join(app.getPath('userData'), 'artlist-login.command'),
    );
    try {
      if (command.script) {
        await writeFile(command.script.path, command.script.contents, { mode: 0o700 });
        await chmod(command.script.path, 0o700);
      }
      await execFileAsync(command.file, command.args, {
        env: cliEnv(),
        timeout: command.detached ? 20_000 : 5 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(friendlyArtlistLoginError(error));
    }
    return command.detached ? waitForArtlistLogin(binary) : artlistStatus(binary);
  });

  ipcMain.handle('artlist:auth-logout', async () => {
    const binary = await resolveClaudeBinary();
    if (!binary) return;
    await execFileAsync(binary, ['mcp', 'logout', ARTLIST_SERVER_NAME], {
      env: cliEnv(),
      timeout: 20_000,
    });
  });

  ipcMain.handle('artlist:generate', async (_event, params: ArtlistGenerateParams) => {
    const binary = await resolveClaudeBinary();
    if (!binary) throw new Error('Claude Code is required to use the Artlist MCP.');
    const status = await artlistStatus(binary);
    if (!status.connected) throw new Error('Connect your Artlist account in Settings before generating.');
    if (!params?.prompt?.trim()) throw new Error('Artlist generation requires a prompt.');
    return generateWithArtlist(binary, params);
  });
}
