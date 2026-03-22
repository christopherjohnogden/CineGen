import { ipcMain, BrowserWindow, app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const LTX_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'ltx');
const LTX_PYTHON = path.join(LTX_REPO, '.venv', 'bin', 'python');
const LTX_SCRIPT = path.join(LTX_REPO, 'cinegen_infer.py');

const QWEN_EDIT_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'qwen-edit');
const QWEN_EDIT_PYTHON = path.join(QWEN_EDIT_REPO, '.venv', 'bin', 'python');
const QWEN_EDIT_SCRIPT = path.join(QWEN_EDIT_REPO, 'cinegen_infer.py');

const LAYER_DECOMPOSE_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'layer-decompose');
const LAYER_DECOMPOSE_PYTHON = path.join(LAYER_DECOMPOSE_REPO, '.venv', 'bin', 'python');

const WHISPERX_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'whisperx');
const WHISPERX_PYTHON = path.join(WHISPERX_REPO, '.venv', 'bin', 'python');

function resolveRuntimeScript(...segments: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(process.cwd(), ...segments);
}

const LAYER_DECOMPOSE_SCRIPT = resolveRuntimeScript('scripts', 'layer-decompose', 'cinegen_infer.py');
const WHISPERX_SCRIPT = resolveRuntimeScript('scripts', 'whisperx', 'cinegen_infer.py');

// Resolution presets matching ui.py's _RES_MAP
const RESOLUTION_MAP: Record<string, { height: number; width: number }> = {
  '512x896':  { height: 896,  width: 512  }, // 9:16 portrait
  '896x512':  { height: 512,  width: 896  }, // 16:9 landscape
  '512x512':  { height: 512,  width: 512  }, // 1:1
  '704x1280': { height: 1280, width: 704  }, // 9:16 HD
  '1280x704': { height: 704,  width: 1280 }, // 16:9 HD
  '768x768':  { height: 768,  width: 768  }, // 1:1 medium
};

interface LocalJob {
  jobId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  stage?: string;
  outputPath?: string;
  outputText?: string;
  transcriptPath?: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string | null;
    words?: Array<{ word: string; start: number; end: number; prob?: number; speaker?: string | null }>;
  }>;
  language?: string;
  error?: string;
}

const jobs = new Map<string, LocalJob>();

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}

function sendProgress(jobId: string, data: object) {
  getMainWindow()?.webContents.send('local-model:progress', { jobId, ...data });
}

async function resolveImageUrl(
  raw: string,
  jobId: string,
): Promise<{ imagePath: string; tempPath: string | null }> {
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const ext = path.extname(new URL(raw).pathname) || '.jpg';
    const tempPath = path.join(os.tmpdir(), `cinegen-img-${jobId}${ext}`);
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    const buf = await res.arrayBuffer();
    await fs.writeFile(tempPath, Buffer.from(buf));
    return { imagePath: tempPath, tempPath };
  } else if (raw.startsWith('local-media://file/')) {
    return { imagePath: decodeURIComponent(raw.replace('local-media://file', '')), tempPath: null };
  }
  return { imagePath: raw, tempPath: null };
}

export function registerLocalModelHandlers(): void {
  ipcMain.handle('local-model:run', async (
    _event,
    params: {
      nodeType: string;
      inputs: Record<string, unknown>;
    },
  ) => {
    const { inputs } = params;

    const jobId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const job: LocalJob = { jobId, status: 'pending' };
    jobs.set(jobId, job);

    let proc: ReturnType<typeof spawn>;
    let tempImagePath: string | null = null;

    if (params.nodeType === 'qwen-edit-local') {
      // --- Qwen Image Edit ---
      const prompt = String(inputs.prompt ?? '');
      const num_inference_steps = Number(inputs.num_inference_steps ?? 50);
      const guidance_scale = Number(inputs.guidance_scale ?? 1.0);
      const true_cfg_scale = Number(inputs.true_cfg_scale ?? 4.0);
      const seed = Number(inputs.seed ?? 42);

      let image_path: string | null = null;
      if (inputs.image_url) {
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
      }
      if (!image_path) throw new Error('Qwen Image Edit requires an input image');

      const args: string[] = [
        QWEN_EDIT_SCRIPT,
        '--image_path', image_path,
        '--prompt', prompt,
        '--num_inference_steps', String(num_inference_steps),
        '--guidance_scale', String(guidance_scale),
        '--true_cfg_scale', String(true_cfg_scale),
        '--seed', String(seed),
      ];

      proc = spawn(QWEN_EDIT_PYTHON, args, {
        cwd: QWEN_EDIT_REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

    } else if (params.nodeType === 'layer-decompose') {
      // --- Layer Decompose ---
      console.log('[layer-decompose] inputs:', JSON.stringify(inputs, null, 2));
      const prompts = String(inputs.prompts ?? '').trim();
      const inpainterSetting = String(inputs.inpainter ?? 'qwen-edit-local');
      const reconstructBg = Boolean(inputs.reconstruct_bg ?? true);
      const seed = Number(inputs.seed ?? 42);

      let image_path: string | null = null;
      if (inputs.image_url) {
        console.log('[layer-decompose] resolving image_url:', inputs.image_url);
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
        console.log('[layer-decompose] resolved to:', image_path);
      }
      if (!image_path) throw new Error('Layer Decompose requires an input image');

      // Only 'lama' runs in Python; Qwen variants handled by execute.ts Phase 2
      const pythonInpainter = (reconstructBg && inpainterSetting === 'lama') ? 'lama' : 'none';

      const args: string[] = [
        LAYER_DECOMPOSE_SCRIPT,
        '--image_path', image_path,
        '--inpainter', pythonInpainter,
        '--seed', String(seed),
      ];
      if (prompts) args.push('--prompts', prompts);

      proc = spawn(LAYER_DECOMPOSE_PYTHON, args, {
        cwd: LAYER_DECOMPOSE_REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

    } else if (params.nodeType === 'whisperx-local') {
      // --- WhisperX ---
      console.log('[whisperx] inputs:', JSON.stringify(inputs, null, 2));
      const model = String(inputs.model ?? 'base');
      const language = String(inputs.language ?? '').trim();
      const diarize = inputs.diarize !== false;

      let audioPath: string | null = null;
      if (inputs.audio_url) {
        console.log('[whisperx] resolving audio_url:', inputs.audio_url);
        const resolved = await resolveImageUrl(String(inputs.audio_url), jobId);
        audioPath = resolved.imagePath;
        tempImagePath = resolved.tempPath;
        console.log('[whisperx] resolved to:', audioPath);
      }
      if (!audioPath) throw new Error('WhisperX requires an audio input');

      const args: string[] = [
        WHISPERX_SCRIPT,
        '--audio_path', audioPath,
        '--model', model,
      ];
      if (language) args.push('--language', language);
      if (!diarize) args.push('--no_diarize');

      const hfToken = process.env.HF_TOKEN;
      const env = { ...process.env };
      if (hfToken) env.HF_TOKEN = hfToken;

      proc = spawn(WHISPERX_PYTHON, args, {
        cwd: WHISPERX_REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

    } else {
      // --- LTX (existing) ---
      const prompt = String(inputs.prompt ?? '');
      const resolution = String(inputs.resolution ?? '896x512');
      const { height, width } = RESOLUTION_MAP[resolution] ?? { height: 512, width: 896 };
      const frame_rate = Number(inputs.frame_rate ?? 24);
      const duration_secs = Number(inputs.duration_secs ?? 4);
      const raw_frames = Math.round((duration_secs * frame_rate) / 8) * 8 + 1;
      const num_frames = Math.max(9, raw_frames);
      const seed = Number(inputs.seed ?? 42);
      const enhance_prompt = Boolean(inputs.enhance_prompt);

      let image_path: string | null = null;
      if (inputs.image_url) {
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
      }

      const args: string[] = [
        LTX_SCRIPT,
        '--prompt', prompt,
        '--height', String(height),
        '--width', String(width),
        '--num_frames', String(num_frames),
        '--frame_rate', String(frame_rate),
        '--seed', String(seed),
      ];
      if (image_path) args.push('--image_path', image_path);
      if (enhance_prompt) args.push('--enhance_prompt');

      proc = spawn(LTX_PYTHON, args, {
        cwd: LTX_REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    job.status = 'running';
    sendProgress(jobId, { type: 'status', status: 'running' });

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as {
            type: string;
            stage?: string;
            message?: string;
            output_path?: string;
            output_text?: string;
            transcript_path?: string;
            segments?: Array<{
              start: number;
              end: number;
              text: string;
              speaker?: string | null;
              words?: Array<{ word: string; start: number; end: number; prob?: number; speaker?: string | null }>;
            }>;
            language?: string;
            error?: string;
            layers?: Array<{ path: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>;
            needs_inpainting?: boolean;
            combined_mask_path?: string;
          };
          if (msg.type === 'progress') {
            job.stage = msg.stage;
            if (msg.output_text !== undefined) job.outputText = msg.output_text;
            if (msg.segments) job.segments = msg.segments;
            if (msg.language !== undefined) job.language = msg.language;
            sendProgress(jobId, {
              type: 'progress',
              stage: msg.stage,
              message: msg.message,
              ...(msg.output_text !== undefined && { output_text: msg.output_text }),
              ...(msg.segments && { segments: msg.segments }),
              ...(msg.language !== undefined && { language: msg.language }),
            });
          } else if (msg.type === 'done') {
            job.status = 'done';
            job.outputPath = msg.output_path;
            job.outputText = msg.output_text;
            job.transcriptPath = msg.transcript_path;
            job.segments = msg.segments;
            job.language = msg.language;
            sendProgress(jobId, {
              type: 'done',
              output_path: msg.output_path,
              ...(msg.output_text !== undefined && { output_text: msg.output_text }),
              ...(msg.transcript_path !== undefined && { transcript_path: msg.transcript_path }),
              ...(msg.segments && { segments: msg.segments }),
              ...(msg.language !== undefined && { language: msg.language }),
              ...(msg.layers && { layers: msg.layers }),
              ...(msg.needs_inpainting !== undefined && { needs_inpainting: msg.needs_inpainting }),
              ...(msg.combined_mask_path && { combined_mask_path: msg.combined_mask_path }),
            });
          } else if (msg.type === 'error') {
            job.status = 'error';
            job.error = msg.error;
            sendProgress(jobId, { type: 'error', error: msg.error });
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    proc.stderr.on('data', () => {
      // suppress model-load noise
    });

    proc.on('error', (err) => {
      job.status = 'error';
      job.error = err.message;
      sendProgress(jobId, { type: 'error', error: err.message });
    });

    proc.on('close', (code) => {
      if (tempImagePath) fs.unlink(tempImagePath).catch(() => {});
      if (code !== 0 && job.status !== 'done') {
        job.status = 'error';
        job.error = job.error ?? `Process exited with code ${code}`;
        sendProgress(jobId, { type: 'error', error: job.error });
      }
    });

    return { jobId };
  });

  ipcMain.handle('local-model:get', (_event, jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) return null;
    return {
      status: job.status,
      stage: job.stage,
      outputPath: job.outputPath,
      outputText: job.outputText,
      transcriptPath: job.transcriptPath,
      segments: job.segments,
      language: job.language,
      error: job.error,
    };
  });

  ipcMain.handle('local-model:read-transcript', async (_event, transcriptPath: string) => {
    try {
      const raw = await fs.readFile(transcriptPath, 'utf8');
      return JSON.parse(raw) as {
        output_text?: string;
        segments?: Array<{
          start: number;
          end: number;
          text: string;
          speaker?: string | null;
          words?: Array<{ word: string; start: number; end: number; prob?: number; speaker?: string | null }>;
        }>;
        language?: string;
      };
    } catch (error) {
      console.error('[local-model] failed to read transcript:', error);
      return null;
    }
  });
}
