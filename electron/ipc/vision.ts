import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AssetVisualSummary } from '@/lib/llm/editorial-workflow';

export const DEFAULT_VISION_MODEL = 'google/gemini-2.5-flash';

interface VisionIndexAssetParams {
  apiKey?: string;
  assetId: string;
  assetName: string;
  framePaths: string[];
  model?: string;
}

interface VisionDetectObjectsParams {
  apiKey?: string;
  imagePath: string;
  maxObjects?: number;
  context?: string;
  model?: string;
}

interface VisionDetectedObject {
  label: string;
  box: [number, number, number, number];
  score: number;
  priority: number;
}

interface VisionDetectObjectsResult {
  status: 'ready' | 'failed' | 'missing';
  model: string;
  objects: VisionDetectedObject[];
  error?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tryParseJson(candidate: string): string | null {
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => extractTextFromUnknown(entry)).filter(Boolean).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => extractTextFromUnknown(entry))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function parseFractionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) {
    const parsedPercent = Number(trimmed.slice(0, -1));
    return Number.isFinite(parsedPercent) ? parsedPercent / 100 : null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractJsonText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const direct = tryParseJson(trimmed);
  if (direct) return direct;

  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedBlocks) {
    const inner = match[1]?.trim();
    if (!inner) continue;
    const parsedFence = tryParseJson(inner);
    if (parsedFence) return parsedFence;
  }

  const openers = new Map<string, string>([
    ['{', '}'],
    ['[', ']'],
  ]);

  for (let start = 0; start < trimmed.length; start++) {
    const firstChar = trimmed[start];
    const expectedCloser = openers.get(firstChar);
    if (!expectedCloser) continue;

    const stack: string[] = [expectedCloser];
    let inString = false;
    let escaped = false;

    for (let end = start + 1; end < trimmed.length; end++) {
      const ch = trimmed[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        if (inString) escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      const nestedCloser = openers.get(ch);
      if (nestedCloser) {
        stack.push(nestedCloser);
        continue;
      }

      if (ch === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          const candidate = trimmed.slice(start, end + 1);
          const parsedCandidate = tryParseJson(candidate);
          if (parsedCandidate) return parsedCandidate;
          break;
        }
        continue;
      }

      if (ch === '}' || ch === ']') {
        break;
      }
    }
  }

  return null;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

function toFsPath(raw: string): string | null {
  if (!raw) return null;
  if (raw.startsWith('local-media://file/')) return decodeURIComponent(raw.replace('local-media://file', ''));
  if (raw.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  }
  if (raw.startsWith('/')) return raw;
  return null;
}

async function uploadImagePath(apiKey: string, rawPath: string): Promise<string | null> {
  if (/^https?:\/\//.test(rawPath)) return rawPath;
  if (rawPath.startsWith('data:')) {
    const match = rawPath.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
    if (!match) return null;
    const type = match[1] || 'application/octet-stream';
    const payload = match[3] || '';
    const buffer = match[2]
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    const blob = new Blob([buffer], { type });
    const file = new File([blob], `auto-segment.${type.split('/')[1] || 'bin'}`, { type });
    fal.config({ credentials: apiKey });
    return fal.storage.upload(file);
  }
  const fsPath = toFsPath(rawPath);
  if (!fsPath) return null;
  const buffer = await fs.readFile(fsPath);
  const type = guessContentType(fsPath);
  const blob = new Blob([buffer], { type });
  const file = new File([blob], path.basename(fsPath), { type });
  fal.config({ credentials: apiKey });
  return fal.storage.upload(file);
}

function normalizeDetectedObjects(
  parsed: Record<string, unknown>,
  maxObjects: number,
): VisionDetectedObject[] {
  const rawObjects = Array.isArray(parsed.objects)
    ? parsed.objects
    : Array.isArray(parsed.detections)
      ? parsed.detections
      : Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray(parsed.regions)
          ? parsed.regions
          : Array.isArray(parsed.subjects)
            ? parsed.subjects
            : (typeof parsed.label === 'string' || typeof parsed.name === 'string' || typeof parsed.object === 'string')
              ? [parsed]
              : [];
  const nextObjects = rawObjects
    .map((rawObject) => {
      if (!rawObject || typeof rawObject !== 'object') return null;
      const record = rawObject as Record<string, unknown>;
      const label = [
        record.label,
        record.name,
        record.object,
        record.subject,
        record.class,
        record.type,
      ].find((value) => typeof value === 'string' && value.trim());
      const nextLabel = typeof label === 'string' ? label.trim() : '';
      if (!nextLabel) return null;

      let x: number | null = null;
      let y: number | null = null;
      let w: number | null = null;
      let h: number | null = null;

      const centerBox = Array.isArray(record.box) ? record.box : Array.isArray(record.cxcywh) ? record.cxcywh : null;
      if (centerBox && centerBox.length >= 4) {
        x = parseFractionalNumber(centerBox[0]);
        y = parseFractionalNumber(centerBox[1]);
        w = parseFractionalNumber(centerBox[2]);
        h = parseFractionalNumber(centerBox[3]);
      }

      const cornerArray = Array.isArray(record.bbox)
        ? record.bbox
        : Array.isArray(record.bounds)
          ? record.bounds
          : Array.isArray(record.rect)
            ? record.rect
            : Array.isArray(record.xyxy)
              ? record.xyxy
              : null;
      if ((x === null || y === null || w === null || h === null) && cornerArray && cornerArray.length >= 4) {
        const x0 = parseFractionalNumber(cornerArray[0]);
        const y0 = parseFractionalNumber(cornerArray[1]);
        const x1 = parseFractionalNumber(cornerArray[2]);
        const y1 = parseFractionalNumber(cornerArray[3]);
        if ([x0, y0, x1, y1].every((value) => value !== null)) {
          x = ((x0 as number) + (x1 as number)) / 2;
          y = ((y0 as number) + (y1 as number)) / 2;
          w = (x1 as number) - (x0 as number);
          h = (y1 as number) - (y0 as number);
        }
      }

      const box3d = Array.isArray(record.box_3d) ? record.box_3d : Array.isArray(record.box3d) ? record.box3d : null;
      if ((x === null || y === null || w === null || h === null) && box3d && box3d.length >= 6) {
        const centerX = parseFractionalNumber(box3d[0]);
        const centerY = parseFractionalNumber(box3d[1]);
        const dimA = parseFractionalNumber(box3d[3]);
        const dimB = parseFractionalNumber(box3d[4]);
        const dimC = parseFractionalNumber(box3d[5]);
        if ([centerX, centerY, dimA, dimB, dimC].every((value) => value !== null)) {
          x = centerX;
          y = centerY;
          w = Math.max(dimA as number, dimB as number);
          h = Math.max(dimB as number, dimC as number);
        }
      }

      if (x === null || y === null || w === null || h === null) {
        const cx = parseFractionalNumber(record.center_x ?? record.cx ?? record.mid_x);
        const cy = parseFractionalNumber(record.center_y ?? record.cy ?? record.mid_y);
        const width = parseFractionalNumber(record.width ?? record.w);
        const height = parseFractionalNumber(record.height ?? record.h);
        if ([cx, cy, width, height].every((value) => value !== null)) {
          x = cx;
          y = cy;
          w = width;
          h = height;
        }
      }

      if (x === null || y === null || w === null || h === null) {
        const xMin = parseFractionalNumber(record.x_min ?? record.left);
        const yMin = parseFractionalNumber(record.y_min ?? record.top);
        const xMax = parseFractionalNumber(record.x_max ?? record.right);
        const yMax = parseFractionalNumber(record.y_max ?? record.bottom);
        if ([xMin, yMin, xMax, yMax].every((value) => value !== null)) {
          x = ((xMin as number) + (xMax as number)) / 2;
          y = ((yMin as number) + (yMax as number)) / 2;
          w = (xMax as number) - (xMin as number);
          h = (yMax as number) - (yMin as number);
        }
      }

      if ([x, y, w, h].some((value) => value === null || !Number.isFinite(value as number))) return null;
      const width = clamp(w, 0.02, 1);
      const height = clamp(h, 0.02, 1);
      const nextBox: [number, number, number, number] = [
        clamp(x, width / 2, 1 - width / 2),
        clamp(y, height / 2, 1 - height / 2),
        width,
        height,
      ];
      const rawScore = parseFractionalNumber(record.score ?? record.confidence ?? record.probability);
      const score = rawScore !== null
        ? clamp(rawScore, 0, 1)
        : 0.75;
      const rawPriority = parseFractionalNumber(record.priority ?? record.salience ?? record.importance);
      const priority = rawPriority !== null
        ? clamp(rawPriority, 0, 1)
        : score;
      return {
        label: nextLabel,
        box: nextBox,
        score,
        priority,
      } satisfies VisionDetectedObject;
    })
    .filter((entry): entry is VisionDetectedObject => Boolean(entry))
    .sort((left, right) => right.priority - left.priority || right.score - left.score);

  const deduped: VisionDetectedObject[] = [];
  for (const candidate of nextObjects) {
    const duplicate = deduped.some((existing) => {
      const sameLabel = existing.label.toLowerCase() === candidate.label.toLowerCase();
      const dx = Math.abs(existing.box[0] - candidate.box[0]);
      const dy = Math.abs(existing.box[1] - candidate.box[1]);
      const dw = Math.abs(existing.box[2] - candidate.box[2]);
      const dh = Math.abs(existing.box[3] - candidate.box[3]);
      return sameLabel && dx < 0.06 && dy < 0.06 && dw < 0.08 && dh < 0.08;
    });
    if (!duplicate) deduped.push(candidate);
    if (deduped.length >= maxObjects) break;
  }

  return deduped;
}

function extractObjectPayload(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return { objects: value };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      Array.isArray(record.objects)
      || Array.isArray(record.detections)
      || Array.isArray(record.items)
      || Array.isArray(record.regions)
      || Array.isArray(record.subjects)
    ) {
      return record;
    }
    if (
      typeof record.label === 'string'
      || typeof record.name === 'string'
      || typeof record.object === 'string'
      || Array.isArray(record.box_3d)
      || Array.isArray(record.box3d)
      || Array.isArray(record.box)
      || Array.isArray(record.bbox)
    ) {
      return { objects: [record] };
    }
    for (const key of ['output', 'text', 'content', 'message', 'result', 'data', 'response']) {
      if (key in record) {
        const nested = extractObjectPayload(record[key]);
        if (nested) return nested;
      }
    }
  }

  const text = extractTextFromUnknown(value);
  if (!text) return null;
  const jsonText = extractJsonText(text);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (Array.isArray(parsed)) return { objects: parsed };
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function runVisionObjectProposal(
  apiKey: string,
  uploaded: string,
  model: string,
  maxObjects: number,
  prompt: string,
): Promise<Record<string, unknown> | null> {
  fal.config({ credentials: apiKey });
  const result = await fal.subscribe('fal-ai/any-llm/vision', {
    input: {
      model,
      prompt,
      image_urls: [uploaded],
      max_tokens: 700,
    },
    logs: true,
  });
  const data = result.data as Record<string, unknown>;
  const payload = extractObjectPayload(data.output) ?? extractObjectPayload(data.text) ?? extractObjectPayload(data);
  if (!payload) {
    console.warn('[vision:auto-seg] Could not extract object JSON from vision response', {
      outputPreview: extractTextFromUnknown(data.output || data.text || data).slice(0, 1000),
      maxObjects,
    });
  }
  return payload;
}

export async function analyzeAssetVisualSummary(params: VisionIndexAssetParams): Promise<AssetVisualSummary> {
  if (!params.apiKey) throw new Error('No fal.ai API key provided.');

  const uploaded = (await Promise.all(
    params.framePaths.slice(0, 6).map((framePath) => uploadImagePath(params.apiKey!, framePath).catch(() => null)),
  )).filter((url): url is string => Boolean(url));

  if (uploaded.length === 0) {
    return {
      assetId: params.assetId,
      status: 'missing',
      model: params.model?.trim() || DEFAULT_VISION_MODEL,
      error: 'No visual frames were available to upload for analysis.',
    };
  }

  fal.config({ credentials: params.apiKey });
  const result = await fal.subscribe('fal-ai/any-llm/vision', {
    input: {
      model: params.model?.trim() || DEFAULT_VISION_MODEL,
      prompt: [
        `Analyze these frames from asset "${params.assetName}" for editorial planning.`,
        'Return compact JSON only with this shape:',
        '{"summary":"...","tone":["..."],"pacing":"...","shotTypes":["..."],"subjects":["..."],"brollIdeas":["..."],"confidence":0.82}',
        'Focus on emotional tone, coverage value, pacing feel, character presence, likely shot type, and practical b-roll opportunities.',
      ].join('\n'),
      image_urls: uploaded,
      max_tokens: 450,
    },
    logs: true,
  });

  const data = result.data as Record<string, unknown>;
  const output = extractTextFromUnknown(data.output) || extractTextFromUnknown(data.text) || '';
  const jsonText = extractJsonText(output);
  if (!jsonText) {
    return {
      assetId: params.assetId,
      status: 'failed',
      model: params.model?.trim() || DEFAULT_VISION_MODEL,
      error: 'Vision analysis did not return valid JSON.',
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      assetId: params.assetId,
      status: 'ready',
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined,
      tone: Array.isArray(parsed.tone) ? parsed.tone.filter((entry): entry is string => typeof entry === 'string') : undefined,
      pacing: typeof parsed.pacing === 'string' ? parsed.pacing.trim() : undefined,
      shotTypes: Array.isArray(parsed.shotTypes) ? parsed.shotTypes.filter((entry): entry is string => typeof entry === 'string') : undefined,
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects.filter((entry): entry is string => typeof entry === 'string') : undefined,
      brollIdeas: Array.isArray(parsed.brollIdeas) ? parsed.brollIdeas.filter((entry): entry is string => typeof entry === 'string') : undefined,
      confidence: typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : undefined,
      updatedAt: new Date().toISOString(),
      model: params.model?.trim() || DEFAULT_VISION_MODEL,
      sourceFrameCount: uploaded.length,
    };
  } catch {
    return {
      assetId: params.assetId,
      status: 'failed',
      model: params.model?.trim() || DEFAULT_VISION_MODEL,
      error: 'Vision analysis JSON parse failed.',
    };
  }
}

export async function detectObjectsInImage(params: VisionDetectObjectsParams): Promise<VisionDetectObjectsResult> {
  if (!params.apiKey) throw new Error('No fal.ai API key provided.');

  const maxObjects = Math.min(12, Math.max(1, Math.round(params.maxObjects ?? 6)));
  const uploaded = await uploadImagePath(params.apiKey, params.imagePath).catch(() => null);
  if (!uploaded) {
    return {
      status: 'missing',
      model: params.model?.trim() || DEFAULT_VISION_MODEL,
      objects: [],
      error: 'No image was available to upload for auto segmentation.',
    };
  }

  const model = params.model?.trim() || DEFAULT_VISION_MODEL;
  const primaryPrompt = [
    'You are preparing object proposals for a promptable segmentation model.',
    params.context ? `Context: ${params.context}` : null,
    `Return compact JSON only with this shape: {"objects":[{"label":"person","box":[0.52,0.48,0.28,0.7],"score":0.96,"priority":0.99}]}`,
    'Each object must include a normalized box in [center_x, center_y, width, height] with values between 0 and 1.',
    `List up to ${maxObjects} distinct, mask-worthy objects.`,
    'Prefer people, faces, pets, products, props, vehicles, furniture, signs, devices, and other clearly isolated subjects.',
    'Include partially visible or cropped people, cars, trucks, bikes, and handheld objects if they are recognizably present.',
    'Do not return an empty list unless there are truly no identifiable objects in the frame.',
  ].filter(Boolean).join('\n');

  const retryPrompt = [
    'Retry object proposal extraction for image segmentation.',
    params.context ? `Context: ${params.context}` : null,
    'Be less selective. Return the most salient visible objects even if they are partially cropped, small, or overlapping.',
    `Return strict JSON only: {"objects":[{"label":"car","box":[0.5,0.5,0.4,0.3],"score":0.81,"priority":0.8}]}`,
    `Return between 1 and ${maxObjects} objects whenever any recognizable object exists.`,
  ].filter(Boolean).join('\n');

  try {
    const primaryPayload = await runVisionObjectProposal(params.apiKey, uploaded, model, maxObjects, primaryPrompt);
    const primaryObjects = primaryPayload ? normalizeDetectedObjects(primaryPayload, maxObjects) : [];
    if (primaryObjects.length > 0) {
      console.info('[vision:auto-seg] Primary object proposals', {
        model,
        count: primaryObjects.length,
        objects: primaryObjects,
        context: params.context ?? null,
      });
      return {
        status: 'ready',
        model,
        objects: primaryObjects,
      };
    }

    const retryPayload = await runVisionObjectProposal(params.apiKey, uploaded, model, maxObjects, retryPrompt);
    const retryObjects = retryPayload ? normalizeDetectedObjects(retryPayload, maxObjects) : [];
    if (retryObjects.length > 0) {
      console.info('[vision:auto-seg] Retry object proposals', {
        model,
        count: retryObjects.length,
        objects: retryObjects,
        context: params.context ?? null,
      });
      return {
        status: 'ready',
        model,
        objects: retryObjects,
      };
    }

    console.warn('[vision:auto-seg] No usable objects found after both prompts', {
      model,
      primaryKeys: primaryPayload ? Object.keys(primaryPayload).slice(0, 12) : [],
      retryKeys: retryPayload ? Object.keys(retryPayload).slice(0, 12) : [],
      primaryPreview: primaryPayload ? JSON.stringify(primaryPayload).slice(0, 1000) : '',
      retryPreview: retryPayload ? JSON.stringify(retryPayload).slice(0, 1000) : '',
      context: params.context ?? null,
    });

    return {
      status: 'ready',
      model,
      objects: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[vision:auto-seg] Detection failed', {
      model,
      context: params.context ?? null,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      status: 'failed',
      model,
      objects: [],
      error: message || 'Vision auto-segmentation failed.',
    };
  }
}

export function registerVisionHandlers(): void {
  ipcMain.handle('vision:index-asset', async (_event: unknown, params: VisionIndexAssetParams) => {
    return analyzeAssetVisualSummary(params);
  });
  ipcMain.handle('vision:detect-objects', async (_event: unknown, params: VisionDetectObjectsParams) => {
    return detectObjectsInImage(params);
  });
}
