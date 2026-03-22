import { getApiKey } from '@/lib/utils/api-key';

export interface AutoSegmentObject {
  label: string;
  box: [number, number, number, number];
  score: number;
  priority: number;
}

interface DetectAutoSegmentOptions {
  context?: string;
  maxObjects?: number;
  model?: string;
}

interface GetAutoSegmentFrameSourceOptions {
  sourceUrl: string;
  timeSec: number;
  videoEl?: HTMLVideoElement | null;
}

function resolveLocalSourcePath(raw: string): string | null {
  if (!raw) return null;
  if (raw.startsWith('local-media://file')) {
    return decodeURIComponent(raw.replace('local-media://file', ''));
  }
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

function resolveFrameExtractionInput(raw: string): string | null {
  if (!raw) return null;
  const localPath = resolveLocalSourcePath(raw);
  if (localPath) return localPath;
  if (/^https?:\/\//.test(raw)) return raw;
  return null;
}

function captureVideoFrameDataUrl(videoEl: HTMLVideoElement | null | undefined): string | null {
  if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export async function detectAutoSegmentObjects(
  imagePath: string,
  options: DetectAutoSegmentOptions = {},
): Promise<AutoSegmentObject[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Add your fal.ai API key in Settings before using Auto Segment.');
  }

  const result = await window.electronAPI.vision.detectObjects({
    apiKey,
    imagePath,
    context: options.context,
    maxObjects: options.maxObjects,
    model: options.model,
  });

  if (!result || result.status !== 'ready') {
    throw new Error(result?.error || 'Vision auto-segmentation failed.');
  }

  const objects = result.objects ?? [];
  console.info('[auto-segment] Vision proposals', {
    model: result.model,
    context: options.context ?? null,
    count: objects.length,
    objects,
    imagePathPreview: imagePath.slice(0, 180),
  });
  return objects;
}

export async function getAutoSegmentFrameSource({
  sourceUrl,
  timeSec,
  videoEl,
}: GetAutoSegmentFrameSourceOptions): Promise<string | null> {
  const extractionInput = resolveFrameExtractionInput(sourceUrl);
  if (extractionInput) {
    const frame = await window.electronAPI.media.extractFrame({
      inputPath: extractionInput,
      timeSec,
    });
    if (frame?.outputPath) return frame.outputPath;
  }

  return captureVideoFrameDataUrl(videoEl);
}

export function sortAutoSegmentObjectsForPrompting(objects: AutoSegmentObject[]): AutoSegmentObject[] {
  return [...objects].sort((left, right) => {
    const leftWeight = Number.isFinite(left.priority) ? left.priority : left.score;
    const rightWeight = Number.isFinite(right.priority) ? right.priority : right.score;
    return leftWeight - rightWeight;
  });
}
