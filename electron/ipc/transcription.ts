import { ipcMain, BrowserWindow, app } from 'electron';
import { fal } from '@fal-ai/client';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { getDb } from './db.js';
import * as pdb from '../db/project-db.js';
import { getFfmpegPath } from '../lib/ffmpeg-paths.js';

const PYTHON_BIN = 'python3.12';
const WHISPERX_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'whisperx');
const WHISPERX_PYTHON = path.join(WHISPERX_REPO, '.venv', 'bin', 'python');

function resolveRuntimeScript(...segments: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(process.cwd(), ...segments);
}

const WHISPERX_SCRIPT = resolveRuntimeScript('scripts', 'whisperx', 'cinegen_infer.py');
const CLOUD_WHISPER_MODEL = 'fal-ai/whisper';
const CLOUD_WHISPER_VERSION = '3';

type TranscriptionEngine = 'faster-whisper-local' | 'whisperx-local' | 'whisper-cloud';

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  prob?: number;
  speaker?: string | null;
}

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string | null;
  words?: TranscriptWord[];
}

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function roundTime(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(Math.max(0, parsed) * 1000) / 1000;
}

function appendTranscriptToken(text: string, token: string): string {
  const trimmedToken = token.trim();
  if (!trimmedToken) return text;
  if (!text) return trimmedToken;
  if (/^[,.;:!?%)\]}]/.test(trimmedToken) || /^['’]/.test(trimmedToken)) {
    return `${text}${trimmedToken}`;
  }
  return `${text} ${trimmedToken}`;
}

function normalizeSpeaker(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildSegmentsFromWords(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  const flushCurrent = () => {
    if (!current) return;
    current.text = current.text.trim();
    if (current.text || (current.words?.length ?? 0) > 0) {
      segments.push(current);
    }
    current = null;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!current) {
      current = {
        start: word.start,
        end: word.end,
        text: '',
        ...(word.speaker ? { speaker: word.speaker } : {}),
        words: [],
      };
    }

    current.words!.push(word);
    current.end = word.end;
    current.text = appendTranscriptToken(current.text, word.word);
    if (!current.speaker && word.speaker) current.speaker = word.speaker;

    const nextWord = words[i + 1];
    const gap = nextWord ? Math.max(0, nextWord.start - word.end) : 0;
    const speakerChange = Boolean(nextWord) && (nextWord.speaker ?? null) !== (current.speaker ?? null);
    const duration = current.end - current.start;
    const endsSentence = /[.!?]["')\]]*$/.test(word.word);
    const pauseBreak = gap >= 0.85 || (gap >= 0.45 && /[,;:]$/.test(word.word));
    const durationBreak = duration >= 12;

    if (!nextWord || endsSentence || pauseBreak || durationBreak || speakerChange) {
      flushCurrent();
    }
  }

  flushCurrent();
  return segments;
}

function normalizeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const words = segments.flatMap((segment) => (
    Array.isArray(segment.words)
      ? segment.words.flatMap((word) => {
        if (!word || typeof word.word !== 'string') return [];
        const start = roundTime(word.start);
        const end = roundTime(word.end);
        if (start === undefined || end === undefined) return [];
        return [{
          word: word.word.trim(),
          start,
          end,
          ...(word.prob !== undefined ? { prob: word.prob } : {}),
          ...(word.speaker !== undefined ? { speaker: word.speaker } : {}),
        }];
      })
      : []
  ));

  if (words.length === 0) return segments;
  return buildSegmentsFromWords(words);
}

function normalizeCloudWhisperResult(result: unknown): {
  text: string;
  segments: TranscriptSegment[];
  language: string;
} {
  const data = (result as Record<string, unknown>)?.data ?? result;
  const rawText = typeof (data as { text?: unknown })?.text === 'string'
    ? (data as { text: string }).text
    : '';
  const rawChunks = (data as { chunks?: unknown })?.chunks;
  const rawLanguage = (data as { language?: unknown; languages?: unknown; inferred_languages?: unknown });

  const normalizedChunks = Array.isArray(rawChunks)
    ? rawChunks.flatMap((chunk) => {
      if (!chunk || typeof chunk !== 'object') return [];
      const text = typeof (chunk as { text?: unknown }).text === 'string'
        ? (chunk as { text: string }).text.trim()
        : '';
      const timestamp = (chunk as { timestamp?: unknown }).timestamp;
      const start = Array.isArray(timestamp) ? roundTime(timestamp[0]) : undefined;
      const end = Array.isArray(timestamp) ? roundTime(timestamp[1]) : undefined;
      const speaker = normalizeSpeaker((chunk as { speaker?: unknown }).speaker);
      if (!text && start === undefined && end === undefined) return [];
      return [{ text, start, end, speaker }];
    })
    : [];

  const words = normalizedChunks.flatMap((chunk): TranscriptWord[] => {
    if (!chunk.text || chunk.start === undefined || chunk.end === undefined) return [];
    return [{
      word: chunk.text,
      start: chunk.start,
      end: chunk.end,
      ...(chunk.speaker ? { speaker: chunk.speaker } : {}),
    }];
  });

  const segments = words.length > 0
    ? buildSegmentsFromWords(words)
    : normalizedChunks.map((chunk): TranscriptSegment => ({
      text: chunk.text,
      start: chunk.start ?? 0,
      end: chunk.end ?? chunk.start ?? 0,
      ...(chunk.speaker ? { speaker: chunk.speaker } : {}),
    }));

  let language = '';
  const candidates = [rawLanguage.language, rawLanguage.languages, rawLanguage.inferred_languages];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      language = candidate.trim();
      break;
    }
    if (Array.isArray(candidate)) {
      const first = candidate.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      if (first) {
        language = first.trim();
        break;
      }
    }
  }

  return {
    text: rawText || segments.map((segment) => segment.text).filter(Boolean).join(' '),
    segments,
    language,
  };
}

async function extractAudioForTranscription(inputPath: string): Promise<string> {
  const outputPath = path.join(
    os.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`,
  );
  const ffmpegPath = getFfmpegPath();
  const args = [
    '-y',
    '-i', inputPath,
    '-vn',
    '-sn',
    '-dn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'aac',
    '-b:a', '96k',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });

  return outputPath;
}

// Inline Python script: transcribe a file with faster-whisper and emit JSON progress lines
const TRANSCRIBE_SCRIPT = `
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
`;

interface TranscriptionJob {
  jobId: string;
  assetId: string;
  projectId: string;
  engine: TranscriptionEngine;
  status: 'pending' | 'running' | 'done' | 'error';
  segments: TranscriptSegment[];
  fullText: string;
  language: string;
  model?: string;
  error?: string;
}

const jobs = new Map<string, TranscriptionJob>();

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}

function sendProgress(job: TranscriptionJob, data: Record<string, unknown>) {
  getMainWindow()?.webContents.send('transcription:progress', {
    jobId: job.jobId,
    assetId: job.assetId,
    engine: job.engine,
    ...data,
  });
}

async function persistTranscription(job: TranscriptionJob): Promise<void> {
  try {
    const db = getDb(job.projectId);
    const existing = pdb.getAssets(db, job.projectId).find((a) => a.id === job.assetId);
    const existingMeta = existing?.metadata
      ? (JSON.parse(existing.metadata) as Record<string, unknown>)
      : {};

    const updatedMeta = {
      ...existingMeta,
      transcription: {
        text: job.fullText,
        segments: job.segments,
        language: job.language,
        engine: job.engine,
        ...(job.model ? { model: job.model } : {}),
        processedAt: new Date().toISOString(),
      },
      transcriptionJobId: undefined,
    };

    pdb.updateAsset(db, job.assetId, { metadata: JSON.stringify(updatedMeta) });
  } catch (err) {
    console.error('[transcription] failed to save to db:', err);
  }
}

async function finishJob(job: TranscriptionJob): Promise<void> {
  job.status = 'done';
  job.segments = normalizeTranscriptSegments(job.segments);
  if (!job.fullText.trim()) {
    job.fullText = job.segments.map((segment) => segment.text).filter(Boolean).join(' ');
  }
  await persistTranscription(job);
  sendProgress(job, {
    type: 'done',
    text: job.fullText,
    segments: job.segments,
    language: job.language,
  });
}

function failJob(job: TranscriptionJob, error: string): void {
  job.status = 'error';
  job.error = error;
  sendProgress(job, { type: 'error', error });
}

function startFastWhisperJob(job: TranscriptionJob, params: {
  filePath: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  language?: string;
}): void {
  const model = params.model ?? 'large';
  const language = params.language ?? 'auto';
  job.model = model;

  void (async () => {
    const scriptPath = path.join(os.tmpdir(), `cinegen-whisper-${job.jobId}.py`);
    await fs.writeFile(scriptPath, TRANSCRIBE_SCRIPT, 'utf-8');

    const proc = spawn(PYTHON_BIN, [scriptPath, params.filePath, model, language], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    job.status = 'running';
    sendProgress(job, { type: 'status', status: 'running' });

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as {
            type: string;
            text: string;
            start?: number;
            end?: number;
            language?: string;
            words?: TranscriptWord[];
          };
          if (msg.type === 'segment') {
            const segment: TranscriptSegment = {
              text: msg.text,
              start: msg.start ?? 0,
              end: msg.end ?? 0,
              ...(Array.isArray(msg.words) && msg.words.length > 0 ? { words: msg.words } : {}),
            };
            job.segments.push(segment);
            sendProgress(job, { type: 'segment', ...segment });
          } else if (msg.type === 'done') {
            job.fullText = msg.text;
            job.language = msg.language ?? '';
          }
        } catch {
          // ignore non-JSON stdout lines
        }
      }
    });

    proc.stderr.on('data', () => {
      // suppress stderr — faster-whisper logs model load info there
    });

    proc.on('close', async (code) => {
      await fs.unlink(scriptPath).catch(() => {});

      if (code !== 0) {
        failJob(job, `whisper process exited with code ${code}`);
        return;
      }

      await finishJob(job);
    });

    proc.on('error', async (err) => {
      await fs.unlink(scriptPath).catch(() => {});
      failJob(job, err.message);
    });
  })().catch((err) => {
    failJob(job, err instanceof Error ? err.message : String(err));
  });
}

function startWhisperXJob(job: TranscriptionJob, params: {
  filePath: string;
  language?: string;
}): void {
  job.model = 'base';
  const args = [
    WHISPERX_SCRIPT,
    '--audio_path', params.filePath,
    '--model', 'base',
    '--no_diarize',
  ];
  if (params.language && params.language !== 'auto') {
    args.push('--language', params.language);
  }

  const env = { ...process.env };
  if (process.env.HF_TOKEN) env.HF_TOKEN = process.env.HF_TOKEN;

  const proc = spawn(WHISPERX_PYTHON, args, {
    cwd: WHISPERX_REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  job.status = 'running';
  sendProgress(job, { type: 'status', status: 'running' });

  let transcriptPath: string | undefined;

  proc.stdout.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as {
          type: string;
          stage?: string;
          message?: string;
          output_text?: string;
          transcript_path?: string;
          segments?: TranscriptSegment[];
          language?: string;
          error?: string;
        };
        if (msg.type === 'progress') {
          if (msg.output_text !== undefined) job.fullText = msg.output_text;
          if (msg.segments) job.segments = msg.segments;
          if (msg.language !== undefined) job.language = msg.language;
          sendProgress(job, {
            type: 'progress',
            stage: msg.stage,
            message: msg.message,
            ...(msg.output_text !== undefined ? { text: msg.output_text } : {}),
            ...(msg.segments ? { segments: msg.segments } : {}),
            ...(msg.language !== undefined ? { language: msg.language } : {}),
          });
        } else if (msg.type === 'done') {
          if (msg.output_text !== undefined) job.fullText = msg.output_text;
          if (msg.segments) job.segments = msg.segments;
          if (msg.language !== undefined) job.language = msg.language;
          transcriptPath = msg.transcript_path;
        } else if (msg.type === 'error') {
          failJob(job, msg.error ?? 'WhisperX error');
        }
      } catch {
        // ignore non-JSON stdout lines
      }
    }
  });

  proc.stderr.on('data', () => {
    // suppress model-load noise
  });

  proc.on('close', async (code) => {
    if (job.status === 'error') return;
    if (code !== 0) {
      failJob(job, `whisperx process exited with code ${code}`);
      return;
    }

    if (transcriptPath) {
      try {
        const raw = await fs.readFile(transcriptPath, 'utf-8');
        const transcript = JSON.parse(raw) as {
          output_text?: string;
          segments?: TranscriptSegment[];
          language?: string;
          model?: string;
        };
        if (transcript.output_text !== undefined) job.fullText = transcript.output_text;
        if (transcript.segments) job.segments = transcript.segments;
        if (transcript.language !== undefined) job.language = transcript.language;
        if (transcript.model) job.model = transcript.model;
      } finally {
        await fs.unlink(transcriptPath).catch(() => {});
      }
    }

    await finishJob(job);
  });

  proc.on('error', (err) => {
    failJob(job, err.message);
  });
}

function startCloudWhisperJob(job: TranscriptionJob, params: {
  filePath: string;
  language?: string;
  apiKey?: string;
}): void {
  void (async () => {
    if (!params.apiKey) throw new Error('No fal.ai API key provided. Add one in Settings.');
    job.model = CLOUD_WHISPER_VERSION;
    job.status = 'running';
    sendProgress(job, { type: 'status', status: 'running', stage: 'uploading', message: 'Preparing audio for cloud transcription' });

    fal.config({ credentials: params.apiKey });

    const extractedPath = await extractAudioForTranscription(params.filePath);
    let uploadedUrl = '';
    try {
      const buffer = await fs.readFile(extractedPath);
      const baseName = path.basename(params.filePath, path.extname(params.filePath));
      const fileName = `${baseName}.m4a`;
      const type = guessContentType(extractedPath);
      const blob = new Blob([buffer], { type });
      const file = new File([blob], fileName, { type });
      const url = await fal.storage.upload(file);
      uploadedUrl = url;
    } finally {
      await fs.unlink(extractedPath).catch(() => {});
    }

    sendProgress(job, { type: 'status', status: 'running', stage: 'transcribing', message: 'Running cloud transcription' });

    const input = {
      audio_url: uploadedUrl,
      task: 'transcribe' as const,
      chunk_level: 'word' as const,
      version: CLOUD_WHISPER_VERSION,
      ...(params.language && params.language !== 'auto' ? { language: params.language } : {}),
    };

    const result = await fal.subscribe(CLOUD_WHISPER_MODEL as any, { input: input as any, logs: true });
    const normalized = normalizeCloudWhisperResult(result);
    job.fullText = normalized.text;
    job.segments = normalized.segments;
    job.language = normalized.language;
    await finishJob(job);
  })().catch((err) => {
    failJob(job, err instanceof Error ? err.message : String(err));
  });
}

export function registerTranscriptionHandlers(): void {
  ipcMain.handle('transcription:start', async (
    _event,
    params: {
      projectId: string;
      assetId: string;
      filePath: string;
      model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
      language?: string;
      engine?: TranscriptionEngine;
      apiKey?: string;
    },
  ) => {
    const {
      projectId,
      assetId,
      filePath,
      model = 'large',
      language = 'auto',
      engine = 'faster-whisper-local',
      apiKey,
    } = params;

    const jobId = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: TranscriptionJob = {
      jobId, assetId, projectId,
      engine,
      status: 'pending',
      segments: [],
      fullText: '',
      language: '',
    };
    jobs.set(jobId, job);

    if (engine === 'whisperx-local') {
      startWhisperXJob(job, { filePath, language });
    } else if (engine === 'whisper-cloud') {
      startCloudWhisperJob(job, { filePath, language, apiKey });
    } else {
      startFastWhisperJob(job, { filePath, model, language });
    }

    return { jobId };
  });

  ipcMain.handle('transcription:get', (_event, jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) return null;
    return {
      status: job.status,
      fullText: job.fullText,
      segments: job.segments,
      language: job.language,
      engine: job.engine,
      error: job.error,
    };
  });
}
