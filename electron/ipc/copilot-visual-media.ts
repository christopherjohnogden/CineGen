import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { getFfmpegPath } from '../lib/ffmpeg-paths.js';
import {
  buildGeminiCliEnv,
  resolveCliBinary,
  stripAnsiCodes,
  type CopilotVisualRefInput,
} from './cli-llm-shared.js';

const execFileAsync = promisify(execFile);

export interface PreparedCopilotVisualRef {
  label: string;
  kind: 'asset' | 'clip';
  mediaType: 'image' | 'video';
  mediaPath: string;
  ephemeral: boolean;
}

const MAX_CLIP_SECONDS = 90;

function resolveExistingPath(fileRef: string): string | null {
  const trimmed = fileRef.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    path.resolve(trimmed),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function extractClipSegment(
  inputPath: string,
  startTimeSec: number,
  durationSec: number,
  outputPath: string,
): Promise<string | null> {
  const ffmpegPath = getFfmpegPath();
  const safeStart = Math.max(0, startTimeSec);
  const safeDuration = Math.max(0.1, Math.min(durationSec, MAX_CLIP_SECONDS));

  try {
    await execFileAsync(ffmpegPath, [
      '-y',
      '-ss', `${safeStart}`,
      '-i', inputPath,
      '-t', `${safeDuration}`,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ], { timeout: Math.max(120000, Math.ceil(safeDuration * 4000)) });

    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}

async function extractFrame(
  inputPath: string,
  timeSec: number,
  outputPath: string,
): Promise<string | null> {
  const ffmpegPath = getFfmpegPath();
  try {
    await execFileAsync(ffmpegPath, [
      '-y',
      '-ss', `${Math.max(0, timeSec)}`,
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ], { timeout: 15000 });
    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}

function hashRef(ref: CopilotVisualRefInput): string {
  return crypto.createHash('sha1')
    .update(JSON.stringify({
      label: ref.label,
      fileRef: ref.fileRef,
      trimStartSec: ref.trimStartSec,
      trimDurationSec: ref.trimDurationSec,
    }))
    .digest('hex')
    .slice(0, 12);
}

function hasWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function stagePathForGeminiAtReference(
  sourcePath: string,
  outputPath: string,
): string | null {
  try {
    if (fs.existsSync(outputPath)) return outputPath;
    try {
      fs.linkSync(sourcePath, outputPath);
    } catch {
      fs.copyFileSync(sourcePath, outputPath);
    }
    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}

function stageIfNeededForGeminiAtReference(
  sourcePath: string,
  ref: CopilotVisualRefInput,
  visualDir: string,
): { mediaPath: string; ephemeral: boolean } | null {
  if (!hasWhitespace(sourcePath)) {
    return { mediaPath: sourcePath, ephemeral: false };
  }

  const ext = path.extname(sourcePath) || (ref.mediaType === 'image' ? '.jpg' : '.mp4');
  const outputPath = path.join(visualDir, `${hashRef(ref)}-source${ext}`);
  const stagedPath = stagePathForGeminiAtReference(sourcePath, outputPath);
  return stagedPath ? { mediaPath: stagedPath, ephemeral: true } : null;
}

export async function prepareCopilotVisualRefs(
  refs: CopilotVisualRefInput[],
  workspaceDir: string,
): Promise<PreparedCopilotVisualRef[]> {
  const visualDir = path.join(workspaceDir, 'visual-refs');
  fs.mkdirSync(visualDir, { recursive: true });

  const prepared: PreparedCopilotVisualRef[] = [];

  for (const ref of refs) {
    const sourcePath = resolveExistingPath(ref.fileRef);
    if (!sourcePath) continue;

    if (ref.mediaType === 'image') {
      const staged = stageIfNeededForGeminiAtReference(sourcePath, ref, visualDir);
      if (!staged) continue;
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: 'image',
        mediaPath: staged.mediaPath,
        ephemeral: staged.ephemeral,
      });
      continue;
    }

    if (ref.trimStartSec !== undefined && ref.trimDurationSec !== undefined) {
      const outPath = path.join(visualDir, `${hashRef(ref)}.mp4`);
      const extracted = await extractClipSegment(
        sourcePath,
        ref.trimStartSec,
        ref.trimDurationSec,
        outPath,
      );
      if (extracted) {
        prepared.push({
          label: ref.label,
          kind: ref.kind,
          mediaType: 'video',
          mediaPath: extracted,
          ephemeral: true,
        });
        continue;
      }
    }

    const ext = path.extname(sourcePath).toLowerCase();
    if (['.mp4', '.mov', '.webm', '.m4v', '.avi'].includes(ext)) {
      const staged = stageIfNeededForGeminiAtReference(sourcePath, ref, visualDir);
      if (!staged) continue;
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: 'video',
        mediaPath: staged.mediaPath,
        ephemeral: staged.ephemeral,
      });
      continue;
    }

    const frameFromMeta = (ref.framePaths ?? [])
      .map((framePath) => resolveExistingPath(framePath))
      .find(Boolean);
    if (frameFromMeta) {
      const staged = stageIfNeededForGeminiAtReference(frameFromMeta, {
        ...ref,
        mediaType: 'image',
        fileRef: frameFromMeta,
      }, visualDir);
      if (!staged) continue;
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: 'image',
        mediaPath: staged.mediaPath,
        ephemeral: staged.ephemeral,
      });
      continue;
    }

    const fallbackFrame = path.join(visualDir, `${hashRef(ref)}.jpg`);
    const extractedFrame = await extractFrame(sourcePath, ref.trimStartSec ?? 0, fallbackFrame);
    if (extractedFrame) {
      prepared.push({
        label: ref.label,
        kind: ref.kind,
        mediaType: 'image',
        mediaPath: extractedFrame,
        ephemeral: true,
      });
    }
  }

  return prepared;
}

export function buildGeminiVisualPromptSection(prepared: PreparedCopilotVisualRef[]): string {
  if (prepared.length === 0) return '';

  const lines = prepared.map((ref) => `@${ref.mediaPath}`);
  return [
    'VISUAL REFERENCES (attached with @paths — analyze and describe what you see in these files):',
    ...lines,
    prepared.map((ref) => `- ${ref.label}: ${ref.mediaType}${ref.kind === 'clip' ? ' clip' : ''}`).join('\n'),
    'Use the attached media for visual answers. Do not answer from clip names, durations, or timeline metadata alone.',
  ].join('\n');
}

/** Inline @paths in the user turn — matches interactive Gemini CLI (`@/path/to/video.mp4 describe this`). */
export function buildGeminiUserMessageWithVisualRefs(
  userMessage: string,
  prepared: PreparedCopilotVisualRef[],
): string {
  if (prepared.length === 0) return userMessage.trim();
  const attachments = prepared.map((ref) => `@${ref.mediaPath}`).join(' ');
  const question = userMessage.trim();
  const hasVideo = prepared.some((ref) => ref.mediaType === 'video');
  if (hasVideo) {
    return question
      ? `${attachments} ${question}`
      : `${attachments} describe this video in detail. Include what you see on screen, the setting, actions, and any spoken audio.`;
  }
  return question
    ? `${attachments} ${question}`
    : `${attachments} describe this image in detail.`;
}

export function cleanupEphemeralVisualRefs(prepared: PreparedCopilotVisualRef[]): void {
  for (const ref of prepared) {
    if (!ref.ephemeral) continue;
    try {
      fs.unlinkSync(ref.mediaPath);
    } catch {
      // ignore cleanup failures
    }
  }
}

/** True when Gemini's reply is a "I can't analyze video/audio" refusal rather than real analysis. */
function isGeminiMediaRefusal(text: string): boolean {
  return /\b(cannot|can't|do not have the ability|unable to|not able to)\b[\s\S]{0,100}\b(video|visual|auditory|audio|mp4|mov|footage|media file)\b/i.test(text)
    || /\btools do not allow\b[\s\S]{0,60}\b(video|visual|auditory|mp4)\b/i.test(text);
}

export class GeminiMediaUnavailableError extends Error {}

const GEMINI_MEDIA_FIRST_TOKEN_TIMEOUT_MS = 180_000;
const GEMINI_MEDIA_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Run a one-shot Gemini CLI analysis of a single local media file with a prompt and return the text.
 * Throws `GeminiMediaUnavailableError` when Gemini CLI is not installed or refuses the media — the
 * caller should fall back to another transport in that case. Throws a plain Error on other failures.
 */
export async function analyzeMediaWithGeminiCli(params: {
  mediaPath: string;
  prompt: string;
  model?: string;
}): Promise<string> {
  const binary = await resolveCliBinary('gemini');
  if (!binary) {
    throw new GeminiMediaUnavailableError('Gemini CLI is not installed.');
  }

  const source = resolveExistingPath(params.mediaPath);
  if (!source) {
    throw new Error(`Media file not found: ${params.mediaPath}`);
  }

  const workDir = path.join(os.tmpdir(), 'cinegen-gemini-acoustic');
  await mkdir(workDir, { recursive: true });

  // Gemini's @path attach can't handle whitespace; stage a hardlink/copy with a safe name.
  let stagedPath = source;
  let ephemeral = false;
  if (hasWhitespace(source)) {
    const ext = path.extname(source) || '.mp4';
    const out = path.join(workDir, `${crypto.randomUUID()}${ext}`);
    const staged = stagePathForGeminiAtReference(source, out);
    if (!staged) {
      throw new Error('Could not stage the media file for Gemini analysis.');
    }
    stagedPath = staged;
    ephemeral = true;
  }

  const model = params.model?.trim() || 'gemini-2.5-flash';
  const prompt = `@${stagedPath} ${params.prompt.trim()}`;
  const args = [
    '--skip-trust',
    '-p', prompt,
    '-o', 'stream-json',
    '-m', model,
    '--approval-mode', 'yolo',
    '--session-id', crypto.randomUUID(),
    '--include-directories', path.dirname(stagedPath),
  ];

  const cleanup = () => {
    if (!ephemeral) return;
    try { fs.unlinkSync(stagedPath); } catch { /* ignore */ }
  };

  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { env: buildGeminiCliEnv(), cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] });

    let fullContent = '';
    let stderrBuffer = '';
    let lineBuffer = '';
    let settled = false;
    let firstTokenReceived = false;

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeoutId);
      clearTimeout(firstTokenTimeoutId);
      cleanup();
      handler();
    };

    const totalTimeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error('Gemini CLI media analysis timed out.')));
    }, GEMINI_MEDIA_TOTAL_TIMEOUT_MS);

    const firstTokenTimeoutId = setTimeout(() => {
      if (firstTokenReceived) return;
      child.kill('SIGTERM');
      finish(() => reject(new Error('Gemini CLI is still reading the media file. Try a shorter clip.')));
    }, GEMINI_MEDIA_FIRST_TOKEN_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      let idx: number;
      while ((idx = lineBuffer.indexOf('\n')) >= 0) {
        const line = lineBuffer.slice(0, idx).trim();
        lineBuffer = lineBuffer.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string') {
            if (obj.content) {
              firstTokenReceived = true;
              fullContent += obj.content;
            }
          }
          if (obj.type === 'error' && typeof obj.message === 'string') {
            stderrBuffer += obj.message;
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => { stderrBuffer += chunk.toString(); });

    child.on('error', (error) => finish(() => reject(error)));

    child.on('close', (code) => {
      const trimmed = fullContent.trim();
      if (!trimmed) {
        const errorMessage = stripAnsiCodes(stderrBuffer.trim()) || `Gemini CLI exited with code ${code ?? 'unknown'}`;
        finish(() => reject(new Error(errorMessage)));
        return;
      }
      if (isGeminiMediaRefusal(trimmed)) {
        finish(() => reject(new GeminiMediaUnavailableError('Gemini CLI declined to analyze the media.')));
        return;
      }
      finish(() => resolve(trimmed));
    });
  });
}
