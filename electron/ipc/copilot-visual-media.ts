import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getFfmpegPath } from '../lib/ffmpeg-paths.js';
import type { CopilotVisualRefInput } from './cli-llm-shared.js';

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
