import { useState, useRef, useCallback, useEffect } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { getApiKey } from '@/lib/utils/api-key';
import { toFileUrl } from '@/lib/utils/file-url';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import {
  type AutoSegmentObject,
  detectAutoSegmentObjects,
  getAutoSegmentFrameSource,
  sortAutoSegmentObjectsForPrompting,
} from '@/lib/vision/auto-segment';

interface SourceViewerMaskToolProps {
  asset: Asset;
  clip: Clip | null;
  onAcceptMaskedVideo: (result: {
    url: string;
    outputKind: 'image' | 'video';
    promptCount: number;
    detectionThreshold: number;
    currentFrameIndex: number;
    sourceTimeSeconds: number;
    sourceWasTrimmed?: boolean;
  }) => Promise<void> | void;
}

interface ImageSize { width: number; height: number; }
interface DisplayRect { left: number; top: number; width: number; height: number; }
type ToolMode = 'text' | 'click' | 'box';
type PromptMode = 'add' | 'subtract';
type ViewMode = 'source' | 'masked';
type MaskDisplay = 'transparent' | 'red-overlay' | 'white-on-black';
type MaskBackend = 'cloud' | 'local';
type MaskOutputMode = 'frame' | 'clip';

interface TextPrompt { id: string; kind: 'text'; text: string; frameIndex?: number; }
interface PointPrompt { id: string; kind: 'point'; positive: boolean; x: number; y: number; w: number; h: number; frameIndex: number; }
interface BoxPrompt { id: string; kind: 'box'; positive: boolean; x: number; y: number; w: number; h: number; frameIndex: number; }
type CloudPrompt = TextPrompt | PointPrompt | BoxPrompt;
interface MaskCandidate { url: string; box: number[]; score: number; index: number; }
interface AutoSegmentPromptObject extends AutoSegmentObject { id: string; frameIndex: number; }
type AutoSegmentSelection = 'all' | string | null;
type BadgePopover = 'prompts' | 'objects' | null;
interface FramePreviewResult {
  frameSourceUrl: string;
  maskCandidates: MaskCandidate[];
  selectedMaskCandidateIndex: number | null;
  rawMaskUrlOverride: string | null;
}

function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }
function createPromptId(): string { return `prompt-${Math.random().toString(36).slice(2, 10)}`; }
function buildAutoSegmentLabelPrompt(labels: string[]): string {
  const unique = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  return unique.slice(0, 6).join(', ');
}

function buildPromptHistoryForAutoSegmentSelection(
  objects: AutoSegmentPromptObject[],
  selection: AutoSegmentSelection,
): CloudPrompt[] {
  const relevantObjects = selection && selection !== 'all'
    ? objects.filter((object) => object.id === selection)
    : objects;
  if (relevantObjects.length === 0) return [];

  const labelPrompt = selection && selection !== 'all'
    ? relevantObjects[0]?.label.trim() ?? ''
    : buildAutoSegmentLabelPrompt(relevantObjects.map((object) => object.label));

  const nextHistory: CloudPrompt[] = [];
  if (labelPrompt) {
    nextHistory.push({
      id: createPromptId(),
      kind: 'text',
      text: labelPrompt,
      frameIndex: relevantObjects[0].frameIndex,
    });
  }

  nextHistory.push(...relevantObjects.map((object) => {
    const [x, y, w, h] = object.box;
    return {
      id: createPromptId(),
      kind: 'box' as const,
      positive: true,
      x,
      y,
      w,
      h,
      frameIndex: object.frameIndex,
    };
  }));

  return nextHistory;
}

function describePrompt(prompt: CloudPrompt): { title: string; detail: string } {
  if (prompt.kind === 'text') {
    return {
      title: prompt.text.trim() || 'Text prompt',
      detail: `Text${typeof prompt.frameIndex === 'number' ? ` • ${prompt.frameIndex}f` : ''}`,
    };
  }

  if (prompt.kind === 'point') {
    return {
      title: prompt.positive ? 'Add point' : 'Remove point',
      detail: `${Math.round(prompt.x * 100)}%, ${Math.round(prompt.y * 100)}% • ${prompt.frameIndex}f`,
    };
  }

  return {
    title: prompt.positive ? 'Add box' : 'Remove box',
    detail: `${Math.round(prompt.w * 100)}% × ${Math.round(prompt.h * 100)}% • ${prompt.frameIndex}f`,
  };
}

function computeContainedImageRect(container: ImageSize, image: ImageSize): DisplayRect | null {
  if (!container.width || !container.height || !image.width || !image.height) return null;
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { left: (container.width - w) / 2, top: (container.height - h) / 2, width: w, height: h };
}

function normalizeMaskCandidates(rawMasks: unknown[], rawBoxes: unknown[], rawScores: unknown[]): MaskCandidate[] {
  return rawMasks
    .map((mask, index) => {
      const url = typeof mask === 'string'
        ? mask
        : (mask && typeof mask === 'object' && typeof (mask as { url?: unknown }).url === 'string'
          ? (mask as { url: string }).url
          : '');
      if (!url) return null;
      return {
        url,
        box: Array.isArray(rawBoxes[index]) ? (rawBoxes[index] as number[]) : [],
        score: typeof rawScores[index] === 'number' ? Number(rawScores[index]) : 0,
        index,
      } satisfies MaskCandidate;
    })
    .filter((candidate): candidate is MaskCandidate => Boolean(candidate));
}

function toRectFromBox(box: number[] | null | undefined): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!box || box.length < 4) return null;
  const [a, b, c, d] = box.map((value) => Number(value));
  if (![a, b, c, d].every(Number.isFinite)) return null;
  if (c > a && d > b) return { x0: a, y0: b, x1: c, y1: d };
  if (c > 0 && d > 0) return { x0: a - c / 2, y0: b - d / 2, x1: a + c / 2, y1: b + d / 2 };
  return null;
}

function rectArea(rect: { x0: number; y0: number; x1: number; y1: number }): number {
  return Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0);
}

function rectIntersectionArea(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function rectIoU(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): number {
  const intersection = rectIntersectionArea(a, b);
  const union = rectArea(a) + rectArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

function chooseBestMaskCandidate(
  candidates: MaskCandidate[],
  prompts: CloudPrompt[],
  imageSize: ImageSize,
): MaskCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const framePrompts = prompts.filter((prompt) => (
    prompt.kind === 'text' ? true : prompt.positive
  ));
  const latestBox = [...framePrompts].reverse().find((prompt): prompt is BoxPrompt => prompt.kind === 'box');
  const latestPoint = [...framePrompts].reverse().find((prompt): prompt is PointPrompt => prompt.kind === 'point');

  if (latestBox && imageSize.width > 0 && imageSize.height > 0) {
    const promptRect = {
      x0: clamp((latestBox.x - latestBox.w / 2) * imageSize.width, 0, imageSize.width),
      y0: clamp((latestBox.y - latestBox.h / 2) * imageSize.height, 0, imageSize.height),
      x1: clamp((latestBox.x + latestBox.w / 2) * imageSize.width, 0, imageSize.width),
      y1: clamp((latestBox.y + latestBox.h / 2) * imageSize.height, 0, imageSize.height),
    };

    return [...candidates]
      .sort((left, right) => {
        const leftRect = toRectFromBox(left.box);
        const rightRect = toRectFromBox(right.box);

        const scoreCandidate = (candidate: MaskCandidate, rect: { x0: number; y0: number; x1: number; y1: number } | null) => {
          if (!rect) return candidate.score;
          const iou = rectIoU(promptRect, rect);
          const containment = rectIntersectionArea(promptRect, rect) / Math.max(1, rectArea(promptRect));
          const cxPrompt = (promptRect.x0 + promptRect.x1) / 2;
          const cyPrompt = (promptRect.y0 + promptRect.y1) / 2;
          const cxRect = (rect.x0 + rect.x1) / 2;
          const cyRect = (rect.y0 + rect.y1) / 2;
          const dist = Math.hypot(cxPrompt - cxRect, cyPrompt - cyRect) / Math.max(1, Math.hypot(imageSize.width, imageSize.height));
          return iou * 8 + containment * 4 + candidate.score * 0.5 - dist;
        };

        return scoreCandidate(right, rightRect) - scoreCandidate(left, leftRect);
      })[0];
  }

  if (latestPoint && imageSize.width > 0 && imageSize.height > 0) {
    const px = latestPoint.x * imageSize.width;
    const py = latestPoint.y * imageSize.height;
    return [...candidates]
      .sort((left, right) => {
        const scoreCandidate = (candidate: MaskCandidate) => {
          const rect = toRectFromBox(candidate.box);
          if (!rect) return candidate.score;
          const inside = px >= rect.x0 && px <= rect.x1 && py >= rect.y0 && py <= rect.y1 ? 1 : 0;
          const cxRect = (rect.x0 + rect.x1) / 2;
          const cyRect = (rect.y0 + rect.y1) / 2;
          const dist = Math.hypot(px - cxRect, py - cyRect) / Math.max(1, Math.hypot(imageSize.width, imageSize.height));
          return inside * 5 + candidate.score * 0.5 - dist;
        };
        return scoreCandidate(right) - scoreCandidate(left);
      })[0];
  }

  return [...candidates].sort((a, b) => b.score - a.score)[0];
}

function maskCandidateToPrompt(
  candidate: MaskCandidate | null,
  frameIndex: number,
  imageSize: ImageSize,
): BoxPrompt | null {
  if (!candidate || imageSize.width <= 0 || imageSize.height <= 0) return null;
  const rect = toRectFromBox(candidate.box);
  if (!rect) return null;
  const x0 = clamp(rect.x0 / imageSize.width, 0, 1);
  const y0 = clamp(rect.y0 / imageSize.height, 0, 1);
  const x1 = clamp(rect.x1 / imageSize.width, 0, 1);
  const y1 = clamp(rect.y1 / imageSize.height, 0, 1);
  const w = Math.max(0.01, x1 - x0);
  const h = Math.max(0.01, y1 - y0);
  return {
    id: 'selected-candidate',
    kind: 'box',
    positive: true,
    x: clamp((x0 + x1) / 2, 0, 1),
    y: clamp((y0 + y1) / 2, 0, 1),
    w,
    h,
    frameIndex,
  };
}

const Spinner = () => <div className="sam3__spinner"><div className="sam3__spinner-ring" /></div>;

function resolveLocalInputPath(asset: Asset): string {
  const raw = asset.fileRef || asset.url || '';
  if (!raw) return '';
  if (raw.startsWith('local-media://file')) {
    return decodeURIComponent(raw.replace('local-media://file', ''));
  }
  if (/^(https?|blob|data|file):/.test(raw)) return '';
  return raw;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

async function loadImageData(src: string, width?: number, height?: number): Promise<ImageData> {
  const img = await loadImageElement(src);
  const canvas = document.createElement('canvas');
  canvas.width = width ?? img.naturalWidth ?? img.width;
  canvas.height = height ?? img.naturalHeight ?? img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function buildMaskAlpha(maskData: ImageData): Uint8ClampedArray<ArrayBuffer> {
  const alpha = new Uint8ClampedArray(maskData.width * maskData.height);
  let hasRgbMaskSignal = false;

  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    const rgbMax = Math.max(maskData.data[offset] ?? 0, maskData.data[offset + 1] ?? 0, maskData.data[offset + 2] ?? 0);
    if (rgbMax > 0) {
      hasRgbMaskSignal = true;
      break;
    }
  }

  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    const rgbMax = Math.max(maskData.data[offset] ?? 0, maskData.data[offset + 1] ?? 0, maskData.data[offset + 2] ?? 0);
    alpha[i] = hasRgbMaskSignal ? rgbMax : (maskData.data[offset + 3] ?? 0);
  }

  return alpha;
}

function getPrimaryMaskUrlFromPreview(preview: FramePreviewResult): string | null {
  if (preview.rawMaskUrlOverride) return preview.rawMaskUrlOverride;
  const selectedCandidate = preview.maskCandidates.find((candidate) => candidate.index === preview.selectedMaskCandidateIndex)
    ?? preview.maskCandidates[0]
    ?? null;
  return selectedCandidate?.url ?? null;
}

async function buildCombinedMaskDataUri(
  maskUrls: string[],
  imageSize: ImageSize,
): Promise<string> {
  if (maskUrls.length === 0) throw new Error('No masks were available to combine.');

  const masks = await Promise.all(maskUrls.map((maskUrl) => loadImageData(maskUrl, imageSize.width || undefined, imageSize.height || undefined)));
  const firstMask = masks[0];
  const combinedAlpha = new Uint8ClampedArray(firstMask.width * firstMask.height);

  for (const mask of masks) {
    const alpha = buildMaskAlpha(mask);
    for (let pixelIndex = 0; pixelIndex < combinedAlpha.length; pixelIndex++) {
      combinedAlpha[pixelIndex] = Math.max(combinedAlpha[pixelIndex] ?? 0, alpha[pixelIndex] ?? 0);
    }
  }

  const combined = new ImageData(firstMask.width, firstMask.height);
  for (let pixelIndex = 0; pixelIndex < combinedAlpha.length; pixelIndex++) {
    const offset = pixelIndex * 4;
    const value = combinedAlpha[pixelIndex] ?? 0;
    combined.data[offset] = value;
    combined.data[offset + 1] = value;
    combined.data[offset + 2] = value;
    combined.data[offset + 3] = 255;
  }

  return imageDataToDataUrl(combined);
}

async function buildCombinedPreviewFromObjectCache(
  objects: AutoSegmentPromptObject[],
  previewCache: Record<string, FramePreviewResult>,
  imageSize: ImageSize,
): Promise<FramePreviewResult | null> {
  const objectPreviews = objects
    .map((object) => previewCache[object.id] ?? null)
    .filter((preview): preview is FramePreviewResult => Boolean(preview));
  if (objectPreviews.length === 0) return null;

  const maskUrls = objectPreviews
    .map((preview) => getPrimaryMaskUrlFromPreview(preview))
    .filter((maskUrl): maskUrl is string => Boolean(maskUrl));
  if (maskUrls.length === 0) return null;

  const firstPreview = objectPreviews[0];
  if (maskUrls.length === 1) {
    return {
      ...firstPreview,
      rawMaskUrlOverride: null,
    };
  }

  return {
    frameSourceUrl: firstPreview.frameSourceUrl,
    maskCandidates: [],
    selectedMaskCandidateIndex: null,
    rawMaskUrlOverride: await buildCombinedMaskDataUri(maskUrls, imageSize),
  };
}

function blurAlpha(alpha: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray<ArrayBuffer> {
  if (radius <= 0) return new Uint8ClampedArray(alpha);

  const horizontal = new Float32Array(alpha.length);
  const vertical = new Uint8ClampedArray(alpha.length);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += alpha[y * width + clamp(x, 0, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      const removeX = clamp(x - radius, 0, width - 1);
      const addX = clamp(x + radius + 1, 0, width - 1);
      sum += alpha[y * width + addX] - alpha[y * width + removeX];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += horizontal[clamp(y, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      vertical[y * width + x] = clamp(Math.round(sum / (radius * 2 + 1)), 0, 255);
      const removeY = clamp(y - radius, 0, height - 1);
      const addY = clamp(y + radius + 1, 0, height - 1);
      sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
    }
  }

  return new Uint8ClampedArray(vertical);
}

function buildProcessedAlpha(
  maskData: ImageData,
  options: { threshold: number; blur: number; feather: number },
): Uint8ClampedArray {
  const base = buildMaskAlpha(maskData);
  const binary = new Uint8ClampedArray(base.length);
  const thresholdValue = clamp(Math.round(options.threshold * 255), 0, 255);

  for (let i = 0; i < base.length; i++) {
    binary[i] = base[i] >= thresholdValue ? 255 : 0;
  }

  let processed = binary;
  if (options.feather > 0) {
    processed = blurAlpha(processed, maskData.width, maskData.height, options.feather);
  }
  if (options.blur > 0) {
    processed = blurAlpha(processed, maskData.width, maskData.height, options.blur);
  }

  return processed;
}

async function buildCutoutPreviewDataUri(
  imageUrl: string,
  maskDataUri: string,
  imageSize: ImageSize,
  options: { threshold: number; blur: number; feather: number },
): Promise<string> {
  const [sourceData, maskData] = await Promise.all([
    loadImageData(imageUrl, imageSize.width || undefined, imageSize.height || undefined),
    loadImageData(maskDataUri, imageSize.width || undefined, imageSize.height || undefined),
  ]);

  const alpha = buildProcessedAlpha(maskData, options);
  const cutout = new ImageData(sourceData.width, sourceData.height);

  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    cutout.data[offset] = sourceData.data[offset] ?? 0;
    cutout.data[offset + 1] = sourceData.data[offset + 1] ?? 0;
    cutout.data[offset + 2] = sourceData.data[offset + 2] ?? 0;
    cutout.data[offset + 3] = alpha[i] ?? 0;
  }

  return imageDataToDataUrl(cutout);
}

async function buildMaskPreviewDataUri(
  imageUrl: string,
  maskDataUri: string,
  imageSize: ImageSize,
  options: { threshold: number; blur: number; feather: number },
  display: MaskDisplay,
  invert: boolean,
): Promise<string> {
  const [sourceData, maskData] = await Promise.all([
    loadImageData(imageUrl, imageSize.width || undefined, imageSize.height || undefined),
    loadImageData(maskDataUri, imageSize.width || undefined, imageSize.height || undefined),
  ]);

  const alpha = buildProcessedAlpha(maskData, options);
  const preview = new ImageData(sourceData.width, sourceData.height);

  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    const maskAlpha = invert ? 255 - (alpha[i] ?? 0) : (alpha[i] ?? 0);
    const srcR = sourceData.data[offset] ?? 0;
    const srcG = sourceData.data[offset + 1] ?? 0;
    const srcB = sourceData.data[offset + 2] ?? 0;

    if (display === 'transparent') {
      preview.data[offset] = srcR;
      preview.data[offset + 1] = srcG;
      preview.data[offset + 2] = srcB;
      preview.data[offset + 3] = maskAlpha;
      continue;
    }

    if (display === 'white-on-black') {
      const value = maskAlpha > 0 ? 255 : 0;
      preview.data[offset] = value;
      preview.data[offset + 1] = value;
      preview.data[offset + 2] = value;
      preview.data[offset + 3] = 255;
      continue;
    }

    const overlayStrength = (maskAlpha / 255) * 0.5;
    const overlayR = 235;
    const overlayG = 78;
    const overlayB = 78;

    preview.data[offset] = Math.round(srcR * (1 - overlayStrength) + overlayR * overlayStrength);
    preview.data[offset + 1] = Math.round(srcG * (1 - overlayStrength) + overlayG * overlayStrength);
    preview.data[offset + 2] = Math.round(srcB * (1 - overlayStrength) + overlayB * overlayStrength);
    preview.data[offset + 3] = 255;
  }

  return imageDataToDataUrl(preview);
}

function extractFrameAtTime(
  videoUrl: string,
  timeSec: number,
): Promise<{ blob: Blob; dataUrl: string } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.src = videoUrl;

    const timeout = setTimeout(() => {
      video.src = '';
      resolve(null);
    }, 10000);

    video.addEventListener('loadedmetadata', () => {
      const seekTime = Math.min(Math.max(0, timeSec), video.duration || 0);
      video.currentTime = seekTime;
    }, { once: true });

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          canvas.toBlob((blob) => {
            if (blob) resolve({ blob, dataUrl });
            else resolve(null);
          }, 'image/png');
          return;
        }
      } catch {
        // Cross-origin / decode issues
      }
      resolve(null);
    }, { once: true });

    video.addEventListener('error', () => {
      clearTimeout(timeout);
      resolve(null);
    }, { once: true });
    video.load();
  });
}

export function SourceViewerMaskTool({ asset, clip, onAcceptMaskedVideo }: SourceViewerMaskToolProps) {
  const { projectId } = useWorkspace();
  const [backend, setBackend] = useState<MaskBackend>('cloud');
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('text');
  const [promptMode, setPromptMode] = useState<PromptMode>('add');
  const [viewMode, setViewMode] = useState<ViewMode>('source');
  const [maskDisplay, setMaskDisplay] = useState<MaskDisplay>('red-overlay');
  const [invertMask, setInvertMask] = useState(false);
  const [outputMode, setOutputMode] = useState<MaskOutputMode>('frame');
  const [textPrompt, setTextPrompt] = useState('');
  const [promptHistory, setPromptHistory] = useState<CloudPrompt[]>([]);
  const [stageSize, setStageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [remoteSourceUrl, setRemoteSourceUrl] = useState<string | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [localMaskUrl, setLocalMaskUrl] = useState<string | null>(null);
  const [framePreviewUrl, setFramePreviewUrl] = useState<string | null>(null);
  const [frameMaskSourceUrl, setFrameMaskSourceUrl] = useState<string | null>(null);
  const [frameMaskRawUrl, setFrameMaskRawUrl] = useState<string | null>(null);
  const [frameMaskRawUrlOverride, setFrameMaskRawUrlOverride] = useState<string | null>(null);
  const [frameMaskCandidates, setFrameMaskCandidates] = useState<MaskCandidate[]>([]);
  const [frameMaskCandidatePreviews, setFrameMaskCandidatePreviews] = useState<Record<number, string>>({});
  const [selectedMaskCandidateIndex, setSelectedMaskCandidateIndex] = useState<number | null>(null);
  const [localServerPort, setLocalServerPort] = useState<number | null>(null);
  const [localVideoSessionId, setLocalVideoSessionId] = useState<string | null>(null);
  const [detectionThreshold, setDetectionThreshold] = useState(0.1);
  const [edgeBlur, setEdgeBlur] = useState(2);
  const [edgeFeather, setEdgeFeather] = useState(4);
  const [isDrawing, setIsDrawing] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [badgePopover, setBadgePopover] = useState<BadgePopover>(null);
  const [showAutoSegmentBoxes, setShowAutoSegmentBoxes] = useState(true);
  const [autoSegmenting, setAutoSegmenting] = useState(false);
  const [autoSegmentObjects, setAutoSegmentObjects] = useState<AutoSegmentPromptObject[]>([]);
  const [autoSegmentSelection, setAutoSegmentSelection] = useState<AutoSegmentSelection>(null);
  const [autoSegmentPreviewCache, setAutoSegmentPreviewCache] = useState<Record<string, FramePreviewResult>>({});

  const canvasRef = useRef<HTMLDivElement>(null);
  const badgeMenusRef = useRef<HTMLDivElement>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  const overlayUnderlayVideoRef = useRef<HTMLVideoElement>(null);
  const effectiveFps = asset.fps && Number.isFinite(asset.fps) && asset.fps > 0 ? asset.fps : 30;
  const currentFrameIndex = Math.max(0, Math.round(currentTime * effectiveFps));
  const displayedVideoRect = computeContainedImageRect(stageSize, videoSize);
  const geometryPrompts = promptHistory.filter((p): p is PointPrompt | BoxPrompt => p.kind === 'point' || p.kind === 'box');
  const displaySourceUrl = toFileUrl(asset.fileRef || asset.url);
  const localInputPath = resolveLocalInputPath(asset);
  const selectedMaskCandidate = frameMaskCandidates.find((candidate) => candidate.index === selectedMaskCandidateIndex) ?? null;
  const visibleAutoSegmentObjects = autoSegmentObjects.filter((object) => object.frameIndex === currentFrameIndex);

  useEffect(() => {
    const initialTime = clip ? Math.max(0, clip.trimStart) : 0;
    setCurrentTime(initialTime);
    setPlaying(false);
    setPromptHistory([]);
    setResultVideoUrl(null);
    setLocalMaskUrl(null);
    setFramePreviewUrl(null);
    setFrameMaskSourceUrl(null);
    setFrameMaskRawUrl(null);
    setFrameMaskRawUrlOverride(null);
    setFrameMaskCandidates([]);
    setFrameMaskCandidatePreviews({});
    setSelectedMaskCandidateIndex(null);
    setRemoteSourceUrl(null);
    setViewMode('source');
    setTextPrompt('');
    setShowSettings(false);
    setBadgePopover(null);
    setShowAutoSegmentBoxes(true);
    setAutoSegmentObjects([]);
    setAutoSegmentSelection(null);
    setAutoSegmentPreviewCache({});
    if (sourceVideoRef.current) {
      sourceVideoRef.current.pause();
      sourceVideoRef.current.currentTime = initialTime;
    }
  }, [asset.id, clip?.id, clip?.trimStart]);

  /* ── Initialize backend ── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPromptHistory([]);
    setResultVideoUrl(null);
    setLocalMaskUrl(null);
    setFramePreviewUrl(null);
    setFrameMaskSourceUrl(null);
    setFrameMaskRawUrl(null);
    setFrameMaskRawUrlOverride(null);
    setFrameMaskCandidates([]);
    setFrameMaskCandidatePreviews({});
    setSelectedMaskCandidateIndex(null);
    setViewMode('source');
    setBadgePopover(null);
    setShowAutoSegmentBoxes(true);
    setAutoSegmentObjects([]);
    setAutoSegmentSelection(null);
    setAutoSegmentPreviewCache({});

    if (backend === 'cloud') {
      (async () => {
        try {
          const apiKey = getApiKey();
          if (!apiKey) throw new Error('Add your fal.ai API key in Settings before using SAM 3 cloud.');
          if (!displaySourceUrl && !localInputPath) throw new Error('This asset does not have a source URL that can be used.');
          if (cancelled) return;
          setRemoteSourceUrl(null);
          setLoading(false);
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Failed to initialize cloud masking.');
        }
      })();
    } else {
      // Local SAM3 server with video support
      (async () => {
        try {
          // Resolve local file path — local SAM3 requires an on-disk file
          let videoPath = '';
          if (asset.fileRef) {
            videoPath = asset.fileRef;
            // Strip local-media:// protocol if present
            if (videoPath.startsWith('local-media://file')) {
              videoPath = decodeURIComponent(videoPath.replace('local-media://file', ''));
            }
          } else {
            // No local file — need to download it first for local SAM3
            const remoteUrl = asset.url || asset.sourceUrl || '';
            if (!remoteUrl) throw new Error('This asset has no local file or remote URL.');
            throw new Error('LOCAL_NEEDS_DOWNLOAD');
          }

          if (!videoPath) throw new Error('Could not resolve a local file path for this asset.');

          const { port } = await window.electronAPI.sam3.start();
          if (cancelled) return;
          setLocalServerPort(port);
          await new Promise((r) => setTimeout(r, 800));
          if (cancelled) return;

          // Start a video session (uses Sam3VideoPredictor for tracked masks)
          const res = await fetch(`http://localhost:${port}/video/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: videoPath }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || 'Failed to start video session');
          if (cancelled) return;
          setLocalVideoSessionId(data.session_id);
          setLoading(false);
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Failed to start local SAM 3 server.');
        }
      })();
    }

    return () => { cancelled = true; };
  }, [asset.fileRef, backend, displaySourceUrl, localInputPath]);

  useEffect(() => {
    if (!badgePopover) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (badgeMenusRef.current?.contains(target)) return;
      setBadgePopover(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBadgePopover(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [badgePopover]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setStageSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode, loading]);

  useEffect(() => {
    let cancelled = false;

    if (!frameMaskSourceUrl || !frameMaskRawUrl) {
      setFramePreviewUrl(null);
      setLocalMaskUrl(null);
      return;
    }

    (async () => {
      try {
        const [maskedOutputUrl, nextPreviewUrl] = await Promise.all([
          buildMaskPreviewDataUri(
            frameMaskSourceUrl,
            frameMaskRawUrl,
            videoSize,
            { threshold: detectionThreshold, blur: edgeBlur, feather: edgeFeather },
            'transparent',
            invertMask,
          ),
          buildMaskPreviewDataUri(
            frameMaskSourceUrl,
            frameMaskRawUrl,
            videoSize,
            { threshold: detectionThreshold, blur: edgeBlur, feather: edgeFeather },
            maskDisplay,
            invertMask,
          ),
        ]);

        if (cancelled) return;
        setLocalMaskUrl(maskedOutputUrl);
        setFramePreviewUrl(nextPreviewUrl);
      } catch {
        if (cancelled) return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detectionThreshold, edgeBlur, edgeFeather, frameMaskRawUrl, frameMaskSourceUrl, invertMask, maskDisplay, videoSize]);

  useEffect(() => {
    if (frameMaskRawUrlOverride) {
      setFrameMaskRawUrl(frameMaskRawUrlOverride);
      return;
    }
    if (!frameMaskCandidates.length) {
      setFrameMaskRawUrl(null);
      return;
    }
    const selected = frameMaskCandidates.find((candidate) => candidate.index === selectedMaskCandidateIndex)
      ?? frameMaskCandidates[0]
      ?? null;
    setFrameMaskRawUrl(selected?.url ?? null);
  }, [frameMaskCandidates, frameMaskRawUrlOverride, selectedMaskCandidateIndex]);

  useEffect(() => {
    let cancelled = false;
    if (!frameMaskSourceUrl || frameMaskCandidates.length <= 1) {
      setFrameMaskCandidatePreviews({});
      return;
    }

    (async () => {
      try {
        const previews = await Promise.all(
          frameMaskCandidates.map(async (candidate) => {
            const previewUrl = await buildMaskPreviewDataUri(
              frameMaskSourceUrl,
              candidate.url,
              videoSize,
              { threshold: detectionThreshold, blur: edgeBlur, feather: edgeFeather },
              'red-overlay',
              false,
            );
            return [candidate.index, previewUrl] as const;
          }),
        );
        if (cancelled) return;
        setFrameMaskCandidatePreviews(Object.fromEntries(previews));
      } catch {
        if (cancelled) return;
        setFrameMaskCandidatePreviews({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detectionThreshold, edgeBlur, edgeFeather, frameMaskCandidates, frameMaskSourceUrl, videoSize]);

  const getNormalizedEventPoint = useCallback((event: React.MouseEvent, clampToImage = false) => {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const lr = computeContainedImageRect({ width: rect.width, height: rect.height }, videoSize);
    if (!lr) return null;
    const x = (event.clientX - rect.left - lr.left) / lr.width;
    const y = (event.clientY - rect.top - lr.top) / lr.height;
    if (!clampToImage && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }, [videoSize]);

  const extractCloudPreviewFrame = useCallback(async (): Promise<{ frameUrl: string; uploadUrl: string } | null> => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Add your fal.ai API key in Settings.');

    if (localInputPath) {
      const extracted = await window.electronAPI.media.extractFrame({
        inputPath: localInputPath,
        timeSec: currentTime,
      });
      if (extracted?.outputPath) {
        const frameUrl = toFileUrl(extracted.outputPath);
        const uploaded = await window.electronAPI.elements.uploadMediaSource(frameUrl, apiKey);
        return { frameUrl, uploadUrl: uploaded.url };
      }
    }

    const extracted = await extractFrameAtTime(displaySourceUrl, currentTime);
    if (!extracted) return null;
    const uploaded = await window.electronAPI.elements.upload(
      { buffer: await extracted.blob.arrayBuffer(), name: 'sam3-frame-preview.png', type: 'image/png' },
      apiKey,
    );
    return { frameUrl: extracted.dataUrl, uploadUrl: uploaded.url };
  }, [currentTime, displaySourceUrl, localInputPath]);

  const ensureCloudTrackingSource = useCallback(async (): Promise<{ url: string; sourceWasTrimmed: boolean } | null> => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Add your fal.ai API key in Settings.');

    if (remoteSourceUrl) {
      return { url: remoteSourceUrl, sourceWasTrimmed: Boolean(clip) };
    }

    if (localInputPath && clip) {
      const clipDuration = Math.max(0.1, (clip.duration - clip.trimStart - clip.trimEnd) / Math.max(0.0001, clip.speed || 1));
      const extracted = await window.electronAPI.media.extractClip({
        inputPath: localInputPath,
        startTimeSec: clip.trimStart,
        durationSec: clipDuration,
      });
      if (!extracted?.outputPath) {
        throw new Error('Could not extract the current clip segment for cloud tracking.');
      }
      const uploaded = await window.electronAPI.elements.uploadMediaSource(toFileUrl(extracted.outputPath), apiKey);
      setRemoteSourceUrl(uploaded.url);
      return { url: uploaded.url, sourceWasTrimmed: true };
    }

    const sourceUrl = displaySourceUrl || asset.url || asset.sourceUrl || '';
    if (!sourceUrl) throw new Error('This asset does not have a source URL that can be uploaded.');
    const uploaded = await window.electronAPI.elements.uploadMediaSource(sourceUrl, apiKey);
    setRemoteSourceUrl(uploaded.url);
    return { url: uploaded.url, sourceWasTrimmed: false };
  }, [asset.sourceUrl, asset.url, clip, displaySourceUrl, localInputPath, remoteSourceUrl]);

  /* ── Local video segmentation ── */
  const restartLocalSession = useCallback(async () => {
    if (!localServerPort || !localVideoSessionId) return null;

    await fetch(`http://localhost:${localServerPort}/video/close-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: localVideoSessionId }),
    }).catch(() => {});

    let videoPath = asset.fileRef || asset.url;
    if (videoPath.startsWith('local-media://file')) {
      videoPath = decodeURIComponent(videoPath.replace('local-media://file', ''));
    }

    const startRes = await fetch(`http://localhost:${localServerPort}/video/start-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: videoPath }),
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.detail || 'Failed to restart video session');
    setLocalVideoSessionId(startData.session_id);
    return startData.session_id as string;
  }, [asset.fileRef, asset.url, localServerPort, localVideoSessionId]);

  const replayLocalImagePrompts = useCallback(async (history: CloudPrompt[]) => {
    if (!localServerPort || !localInputPath) return null;

    const extracted = await window.electronAPI.media.extractFrame({
      inputPath: localInputPath,
      timeSec: currentTime,
    });
    if (!extracted?.outputPath) {
      throw new Error('Could not extract the current frame for local preview.');
    }

    const frameSourceUrl = toFileUrl(extracted.outputPath);
    const frameHistory = history.filter((prompt) => (
      prompt.kind === 'text'
        ? (prompt.frameIndex ?? currentFrameIndex) === currentFrameIndex
        : prompt.frameIndex === currentFrameIndex
    ));

    const setImageRes = await fetch(`http://localhost:${localServerPort}/set-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: extracted.outputPath }),
    });
    const setImageData = await setImageRes.json();
    if (!setImageRes.ok) {
      throw new Error(setImageData.detail || 'Failed to prepare the current frame.');
    }

    let latestData: Record<string, unknown> | null = null;
    for (const prompt of frameHistory) {
      let body: Record<string, unknown> | null = null;
      if (prompt.kind === 'text') {
        body = { type: 'text', prompt: prompt.text };
      } else if (prompt.kind === 'point') {
        body = {
          type: 'box',
          box: [prompt.x, prompt.y, Math.max(prompt.w, 0.02), Math.max(prompt.h, 0.02)],
          label: prompt.positive,
        };
      } else if (prompt.kind === 'box') {
        body = {
          type: 'box',
          box: [prompt.x, prompt.y, prompt.w, prompt.h],
          label: prompt.positive,
        };
      }

      if (!body) continue;
      const res = await fetch(`http://localhost:${localServerPort}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to apply prompt to current frame');
      }
      latestData = data as Record<string, unknown>;
    }

    const thresholdRes = await fetch(`http://localhost:${localServerPort}/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'confidence', threshold: detectionThreshold }),
    });
    const thresholdData = await thresholdRes.json();
    if (!thresholdRes.ok) {
      throw new Error(thresholdData.detail || 'Failed to apply mask threshold');
    }

    const finalData = (thresholdData as Record<string, unknown>) ?? latestData;
    return { frameSourceUrl, finalData };
  }, [currentFrameIndex, currentTime, detectionThreshold, localInputPath, localServerPort]);

  const replayLocalPrompts = useCallback(async (history: CloudPrompt[]) => {
    const sessionId = await restartLocalSession();
    if (!sessionId || !localServerPort) return null;

    let latestPromptData: Record<string, unknown> | null = null;
    for (const prompt of history) {
      const body: Record<string, unknown> = {
        session_id: sessionId,
        frame_index: prompt.kind === 'text' ? (prompt.frameIndex ?? currentFrameIndex) : prompt.frameIndex,
      };

      if (prompt.kind === 'text') {
        body.text = prompt.text;
      } else if (prompt.kind === 'point') {
        // Local SAM3 video point prompts are unstable before tracker cache warmup.
        // Send a tiny box around the clicked point instead so click mode still works.
        const w = Math.max(prompt.w, 0.02);
        const h = Math.max(prompt.h, 0.02);
        body.boxes = [[
          clamp(prompt.x - w / 2, 0, 1 - w),
          clamp(prompt.y - h / 2, 0, 1 - h),
          w,
          h,
        ]];
        body.box_labels = [prompt.positive ? 1 : 0];
      } else if (prompt.kind === 'box') {
        body.boxes = [[
          clamp(prompt.x - prompt.w / 2, 0, 1 - prompt.w),
          clamp(prompt.y - prompt.h / 2, 0, 1 - prompt.h),
          prompt.w,
          prompt.h,
        ]];
        body.box_labels = [prompt.positive ? 1 : 0];
      }

      const promptRes = await fetch(`http://localhost:${localServerPort}/video/add-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const promptData = await promptRes.json();
      if (!promptRes.ok) {
        throw new Error(promptData.detail || 'Failed to add prompt');
      }
      latestPromptData = promptData as Record<string, unknown>;
    }

    return { sessionId, latestPromptData };
  }, [currentFrameIndex, localServerPort, restartLocalSession]);

  const getTrackingPromptHistory = useCallback((history: CloudPrompt[]) => {
    const selectedPrompt = maskCandidateToPrompt(selectedMaskCandidate, currentFrameIndex, videoSize);
    if (!selectedPrompt) return history;
    return [...history, selectedPrompt];
  }, [currentFrameIndex, selectedMaskCandidate, videoSize]);

  const clearFramePreview = useCallback(() => {
    setResultVideoUrl(null);
    setLocalMaskUrl(null);
    setFramePreviewUrl(null);
    setFrameMaskSourceUrl(null);
    setFrameMaskRawUrl(null);
    setFrameMaskRawUrlOverride(null);
    setFrameMaskCandidates([]);
    setFrameMaskCandidatePreviews({});
    setSelectedMaskCandidateIndex(null);
    setViewMode('source');
  }, []);

  const applyFramePreviewResult = useCallback((preview: FramePreviewResult | null) => {
    if (!preview || (!preview.rawMaskUrlOverride && preview.maskCandidates.length === 0)) {
      clearFramePreview();
      return;
    }

    setResultVideoUrl(null);
    setFrameMaskCandidatePreviews({});
    setFrameMaskSourceUrl(preview.frameSourceUrl);
    setFrameMaskCandidates(preview.maskCandidates);
    setSelectedMaskCandidateIndex(preview.selectedMaskCandidateIndex);
    setFrameMaskRawUrlOverride(preview.rawMaskUrlOverride);
    setViewMode('masked');
  }, [clearFramePreview]);

  const previewLocalFrameHistory = useCallback(async (history: CloudPrompt[]): Promise<FramePreviewResult | null> => {
    if (!localServerPort || !localVideoSessionId) return null;

    const previewResult = await replayLocalImagePrompts(history);
    const rawMasks = Array.isArray(previewResult?.finalData?.masks) ? previewResult.finalData.masks : [];
    const rawBoxes = Array.isArray(previewResult?.finalData?.boxes) ? previewResult.finalData.boxes : [];
    const rawScores = Array.isArray(previewResult?.finalData?.scores) ? previewResult.finalData.scores : [];
    const maskCandidates = normalizeMaskCandidates(rawMasks, rawBoxes, rawScores);
    const frameHistory = history.filter((prompt) => (
      prompt.kind === 'text'
        ? (prompt.frameIndex ?? currentFrameIndex) === currentFrameIndex
        : prompt.frameIndex === currentFrameIndex
    ));
    const maskCandidate = chooseBestMaskCandidate(maskCandidates, frameHistory, videoSize);
    const maskUrl = maskCandidate?.url ?? '';
    if (!maskUrl || !previewResult) return null;

    return {
      frameSourceUrl: previewResult.frameSourceUrl,
      maskCandidates,
      selectedMaskCandidateIndex: maskCandidate?.index ?? null,
      rawMaskUrlOverride: null,
    };
  }, [currentFrameIndex, localServerPort, localVideoSessionId, replayLocalImagePrompts, videoSize]);

  const previewCloudFrameHistory = useCallback(async (history: CloudPrompt[]): Promise<FramePreviewResult | null> => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Add your fal.ai API key in Settings.');

    const frameHistory = history.filter((prompt) => (
      prompt.kind === 'text'
        ? (prompt.frameIndex ?? currentFrameIndex) === currentFrameIndex
        : prompt.frameIndex === currentFrameIndex
    ));

    const textVal = frameHistory
      .filter((p): p is TextPrompt => p.kind === 'text')
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join(', ');
    const pts = frameHistory
      .filter((p): p is PointPrompt => p.kind === 'point')
      .map((p) => ({
        x: clamp(Math.round(p.x * videoSize.width), 0, videoSize.width),
        y: clamp(Math.round(p.y * videoSize.height), 0, videoSize.height),
        label: p.positive ? 1 : 0,
      }));
    const boxes = frameHistory
      .filter((p): p is BoxPrompt => p.kind === 'box')
      .map((p) => ({
        x_min: clamp(Math.round((p.x - p.w / 2) * videoSize.width), 0, videoSize.width),
        y_min: clamp(Math.round((p.y - p.h / 2) * videoSize.height), 0, videoSize.height),
        x_max: clamp(Math.round((p.x + p.w / 2) * videoSize.width), 0, videoSize.width),
        y_max: clamp(Math.round((p.y + p.h / 2) * videoSize.height), 0, videoSize.height),
        label: p.positive ? 1 : 0,
      }));
    if (!textVal && pts.length === 0 && boxes.length === 0) return null;

    const frameSource = await extractCloudPreviewFrame();
    if (!frameSource) {
      throw new Error('Could not extract the current frame for cloud preview.');
    }

    const result = await window.electronAPI.workflow.run({
      apiKey,
      nodeId: 'edit-sam3-mask-frame',
      nodeType: 'sam3-segment-cloud',
      modelId: 'fal-ai/sam-3/image',
      inputs: {
        image_url: frameSource.uploadUrl,
        ...(textVal ? { prompt: textVal } : {}),
        ...(pts.length > 0 ? { point_prompts: pts } : {}),
        ...(boxes.length > 0 ? { box_prompts: boxes } : {}),
        apply_mask: true,
        output_format: 'png',
        sync_mode: true,
        return_multiple_masks: true,
        max_masks: 8,
        include_scores: true,
        include_boxes: true,
      },
    }) as Record<string, unknown>;

    const rawMasks = Array.isArray(result.masks) ? result.masks : [];
    const rawBoxes = Array.isArray(result.boxes) ? result.boxes : [];
    const rawScores = Array.isArray(result.scores) ? result.scores : [];
    const maskCandidates = normalizeMaskCandidates(rawMasks, rawBoxes, rawScores);
    const maskCandidate = chooseBestMaskCandidate(maskCandidates, frameHistory, videoSize);
    const maskUrl = maskCandidate?.url ?? '';
    if (!maskUrl) return null;

    return {
      frameSourceUrl: frameSource.frameUrl,
      maskCandidates,
      selectedMaskCandidateIndex: maskCandidate?.index ?? null,
      rawMaskUrlOverride: null,
    };
  }, [currentFrameIndex, extractCloudPreviewFrame, videoSize]);

  const previewFrameHistory = useCallback(async (history: CloudPrompt[]) => {
    return backend === 'local' ? previewLocalFrameHistory(history) : previewCloudFrameHistory(history);
  }, [backend, previewCloudFrameHistory, previewLocalFrameHistory]);

  const runLocalFramePreview = useCallback(async (history: CloudPrompt[]) => {
    if (!localServerPort || !localVideoSessionId) return false;

    if (history.length === 0) {
      clearFramePreview();
      return true;
    }

    setRunning(true);
    setError(null);
    try {
      applyFramePreviewResult(await previewLocalFrameHistory(history));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local SAM 3 frame preview failed.');
      return false;
    } finally {
      setRunning(false);
    }
  }, [applyFramePreviewResult, clearFramePreview, localServerPort, localVideoSessionId, previewLocalFrameHistory]);

  const runLocalClipTracking = useCallback(async () => {
    if (!localServerPort || !localVideoSessionId) return false;
    if (promptHistory.length === 0) return false;

    setRunning(true);
    setError(null);
    try {
      const replayResult = await replayLocalPrompts(getTrackingPromptHistory(promptHistory));
      if (!replayResult) return false;

      const propRes = await fetch(`http://localhost:${localServerPort}/video/propagate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: replayResult.sessionId,
          apply_mask: true,
        }),
      });
      const propData = await propRes.json();
      if (!propRes.ok) throw new Error(propData.detail || 'Propagation failed');

      if (typeof propData.video_path === 'string' && propData.video_path) {
        const maskedUrl = toFileUrl(propData.video_path);
        setResultVideoUrl(maskedUrl);
        setViewMode('masked');
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local SAM 3 clip tracking failed.');
      return false;
    } finally {
      setRunning(false);
    }
  }, [getTrackingPromptHistory, localServerPort, localVideoSessionId, promptHistory, replayLocalPrompts]);

  /* ── Cloud segmentation ── */
  const runCloudFramePreview = useCallback(async (history: CloudPrompt[]) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('Add your fal.ai API key in Settings.');
      return false;
    }
    if (history.length === 0) {
      clearFramePreview();
      return true;
    }

    setRunning(true);
    setError(null);
    try {
      applyFramePreviewResult(await previewCloudFrameHistory(history));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SAM 3 frame masking failed.');
      return false;
    } finally {
      setRunning(false);
    }
  }, [applyFramePreviewResult, clearFramePreview, previewCloudFrameHistory]);

  const runCloudClipTracking = useCallback(async (history: CloudPrompt[]) => {
    const apiKey = getApiKey();
    if (!apiKey) { setError('Add your fal.ai API key in Settings.'); return false; }

    const trackingHistory = getTrackingPromptHistory(history);
    const textVal = trackingHistory.filter((p): p is TextPrompt => p.kind === 'text').map((p) => p.text.trim()).filter(Boolean).join(', ');
    const pts = trackingHistory.filter((p): p is PointPrompt => p.kind === 'point').map((p) => ({
      x: clamp(Math.round(p.x * videoSize.width), 0, videoSize.width),
      y: clamp(Math.round(p.y * videoSize.height), 0, videoSize.height),
      label: p.positive ? 1 : 0,
      frame_index: p.frameIndex ?? currentFrameIndex,
    }));
    const boxes = trackingHistory.filter((p): p is BoxPrompt => p.kind === 'box').map((p) => ({
      x_min: clamp(Math.round((p.x - p.w / 2) * videoSize.width), 0, videoSize.width),
      y_min: clamp(Math.round((p.y - p.h / 2) * videoSize.height), 0, videoSize.height),
      x_max: clamp(Math.round((p.x + p.w / 2) * videoSize.width), 0, videoSize.width),
      y_max: clamp(Math.round((p.y + p.h / 2) * videoSize.height), 0, videoSize.height),
      label: p.positive ? 1 : 0,
      frame_index: p.frameIndex ?? currentFrameIndex,
    }));

    if (!textVal && pts.length === 0 && boxes.length === 0) {
      setResultVideoUrl(null); setViewMode('source'); return true;
    }

    setRunning(true); setError(null);
    try {
      const trackingSource = await ensureCloudTrackingSource();
      if (!trackingSource) return false;
      const result = await window.electronAPI.workflow.run({
        apiKey, nodeId: 'edit-sam3-mask', nodeType: 'sam3-track-cloud', modelId: 'fal-ai/sam-3/video',
        inputs: {
          video_url: trackingSource.url,
          ...(textVal ? { prompt: textVal } : {}),
          ...(pts.length > 0 ? { point_prompts: pts } : {}),
          ...(boxes.length > 0 ? { box_prompts: boxes } : {}),
          apply_mask: true,
          detection_threshold: detectionThreshold,
        },
      }) as Record<string, unknown>;

      const video = result.video;
      const nextUrl = typeof video === 'string' ? video
        : (video && typeof video === 'object' && typeof (video as { url?: unknown }).url === 'string' ? (video as { url: string }).url : '');
      if (!nextUrl) throw new Error('SAM 3 did not return a masked video.');
      setLocalMaskUrl(null);
      setResultVideoUrl(nextUrl);
      setRemoteSourceUrl(trackingSource.url);
      setViewMode('masked');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SAM 3 video masking failed.');
      return false;
    } finally {
      setRunning(false);
    }
  }, [currentFrameIndex, detectionThreshold, ensureCloudTrackingSource, getTrackingPromptHistory, videoSize.height, videoSize.width]);

  const doSegmentation = useCallback(async (history: CloudPrompt[]) => {
    return backend === 'local' ? runLocalFramePreview(history) : runCloudFramePreview(history);
  }, [backend, runCloudFramePreview, runLocalFramePreview]);

  const handleTextSubmit = useCallback(async () => {
    if (autoSegmenting) return;
    const p = textPrompt.trim();
    if (!p) return;
    const next = [...promptHistory, { id: createPromptId(), kind: 'text' as const, text: p, frameIndex: currentFrameIndex }];
    if (await doSegmentation(next)) {
      setAutoSegmentObjects([]);
      setAutoSegmentSelection(null);
      setAutoSegmentPreviewCache({});
      setPromptHistory(next);
      setTextPrompt('');
    }
  }, [autoSegmenting, currentFrameIndex, promptHistory, doSegmentation, textPrompt]);

  const submitGeometricPrompt = useCallback(async (prompt: Omit<PointPrompt | BoxPrompt, 'id'>) => {
    const next = [...promptHistory, { ...prompt, id: createPromptId() }];
    if (await doSegmentation(next)) {
      setAutoSegmentObjects([]);
      setAutoSegmentSelection(null);
      setAutoSegmentPreviewCache({});
      setPromptHistory(next);
      return true;
    }
    return false;
  }, [promptHistory, doSegmentation]);

  const handleCanvasClick = useCallback(async (event: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'click' || running || viewMode !== 'source') return;
    sourceVideoRef.current?.pause(); setPlaying(false);
    const pt = getNormalizedEventPoint(event);
    if (pt) await submitGeometricPrompt({ kind: 'point', positive: promptMode === 'add', x: pt.x, y: pt.y, w: 0.01, h: 0.01, frameIndex: currentFrameIndex });
  }, [autoSegmenting, currentFrameIndex, getNormalizedEventPoint, promptMode, running, submitGeometricPrompt, toolMode, viewMode]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'box' || running || viewMode !== 'source') return;
    event.preventDefault(); sourceVideoRef.current?.pause(); setPlaying(false);
    const pt = getNormalizedEventPoint(event);
    if (pt) { setBoxStart(pt); setBoxEnd(pt); setIsDrawing(true); }
  }, [autoSegmenting, getNormalizedEventPoint, running, toolMode, viewMode]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing) return;
    const pt = getNormalizedEventPoint(event, true);
    if (pt) setBoxEnd(pt);
  }, [autoSegmenting, getNormalizedEventPoint, isDrawing]);

  const handleMouseUp = useCallback(async (event: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing || !boxStart) { setIsDrawing(false); return; }
    const end = getNormalizedEventPoint(event, true) ?? boxEnd;
    if (!end) { setIsDrawing(false); setBoxStart(null); setBoxEnd(null); return; }
    const w = Math.abs(end.x - boxStart.x); const h = Math.abs(end.y - boxStart.y);
    if (w > 0.01 && h > 0.01) {
      await submitGeometricPrompt({ kind: 'box', positive: promptMode === 'add', x: (boxStart.x + end.x) / 2, y: (boxStart.y + end.y) / 2, w, h, frameIndex: currentFrameIndex });
    }
    setIsDrawing(false); setBoxStart(null); setBoxEnd(null);
  }, [autoSegmenting, boxEnd, boxStart, currentFrameIndex, getNormalizedEventPoint, isDrawing, promptMode, submitGeometricPrompt]);

  const handleUndo = useCallback(async () => {
    const next = promptHistory.slice(0, -1);
    setPromptHistory(next);
    setAutoSegmentObjects([]);
    setAutoSegmentSelection(null);
    setAutoSegmentPreviewCache({});
    await doSegmentation(next);
  }, [promptHistory, doSegmentation]);

  const handleClear = useCallback(() => {
    setPromptHistory([]);
    setResultVideoUrl(null);
    setLocalMaskUrl(null);
    setFramePreviewUrl(null);
    setFrameMaskSourceUrl(null);
    setFrameMaskRawUrl(null);
    setFrameMaskRawUrlOverride(null);
    setFrameMaskCandidates([]);
    setFrameMaskCandidatePreviews({});
    setSelectedMaskCandidateIndex(null);
    setTextPrompt('');
    setViewMode('source');
    setBadgePopover(null);
    setShowAutoSegmentBoxes(true);
    setAutoSegmentObjects([]);
    setAutoSegmentSelection(null);
    setAutoSegmentPreviewCache({});
  }, []);

  const handleAutoSegment = useCallback(async () => {
    if (loading || running || autoSegmenting) return;

    setAutoSegmenting(true);
    try {
      sourceVideoRef.current?.pause();
      setPlaying(false);

      const frameSource = await getAutoSegmentFrameSource({
        sourceUrl: localInputPath || displaySourceUrl,
        timeSec: currentTime,
        videoEl: viewMode === 'source' ? sourceVideoRef.current : null,
      });
      if (!frameSource) {
        throw new Error('Could not capture the current frame for Auto Segment. Switch to Source view and try again.');
      }

      const detectedObjects = sortAutoSegmentObjectsForPrompting(await detectAutoSegmentObjects(frameSource, {
        context: 'Timeline mask tool auto segmentation on the current frame',
        maxObjects: 6,
      }));
      if (detectedObjects.length === 0) {
        window.alert('Auto Segment could not find any distinct objects on this frame.');
        return;
      }

      const nextObjects = detectedObjects.map((detectedObject, objectIndex) => ({
        ...detectedObject,
        id: `auto-segment-${currentFrameIndex}-${objectIndex}-${createPromptId()}`,
        frameIndex: currentFrameIndex,
      }));

      const nextPreviewCache: Record<string, FramePreviewResult> = {};
      const viableObjects: AutoSegmentPromptObject[] = [];
      for (const nextObject of nextObjects) {
        try {
          const objectHistory = buildPromptHistoryForAutoSegmentSelection(nextObjects, nextObject.id);
          const preview = await previewFrameHistory(objectHistory);
          if (!preview) continue;
          nextPreviewCache[nextObject.id] = preview;
          viableObjects.push(nextObject);
        } catch (previewError) {
          console.warn('[source-viewer-mask-tool] Auto segment object preview failed:', {
            label: nextObject.label,
            error: previewError instanceof Error ? previewError.message : previewError,
          });
        }
      }

      if (viableObjects.length === 0) {
        throw new Error('Auto Segment found objects, but SAM 3 could not turn them into usable masks.');
      }

      const combinedPreview = await buildCombinedPreviewFromObjectCache(viableObjects, nextPreviewCache, videoSize);
      if (!combinedPreview) {
        throw new Error('Auto Segment could not build a combined frame preview from the detected objects.');
      }
      nextPreviewCache.all = combinedPreview;

      const nextHistory = buildPromptHistoryForAutoSegmentSelection(viableObjects, 'all');
      applyFramePreviewResult(combinedPreview);
      setAutoSegmentObjects(viableObjects);
      setAutoSegmentPreviewCache(nextPreviewCache);
      if (nextHistory.length > 0) {
        setAutoSegmentSelection('all');
        setPromptHistory(nextHistory);
        setTextPrompt('');
        setToolMode('box');
      }
    } catch (nextError) {
      console.error('[source-viewer-mask-tool] Auto segment error:', nextError);
      window.alert(nextError instanceof Error ? nextError.message : 'Auto Segment failed.');
    } finally {
      setAutoSegmenting(false);
    }
  }, [
    autoSegmenting,
    currentFrameIndex,
    currentTime,
    displaySourceUrl,
    doSegmentation,
    applyFramePreviewResult,
    buildCombinedPreviewFromObjectCache,
    loading,
    localInputPath,
    previewFrameHistory,
    running,
    videoSize,
    viewMode,
  ]);

  const handleSelectAutoSegmentObject = useCallback(async (selection: 'all' | string) => {
    if (loading || running || autoSegmenting) return;
    if (visibleAutoSegmentObjects.length === 0) return;
    const nextHistory = buildPromptHistoryForAutoSegmentSelection(visibleAutoSegmentObjects, selection);
    if (nextHistory.length === 0) return;
    if (selection === 'all') {
      const combinedPreview = await buildCombinedPreviewFromObjectCache(
        visibleAutoSegmentObjects,
        autoSegmentPreviewCache,
        videoSize,
      );
      if (combinedPreview) {
        setAutoSegmentPreviewCache((currentCache) => ({ ...currentCache, all: combinedPreview }));
        applyFramePreviewResult(combinedPreview);
        setAutoSegmentSelection(selection);
        setPromptHistory(nextHistory);
        setTextPrompt('');
        setToolMode('box');
        return;
      }
    }
    const cachedPreview = autoSegmentPreviewCache[selection];
    if (cachedPreview) {
      applyFramePreviewResult(cachedPreview);
      setAutoSegmentSelection(selection);
      setPromptHistory(nextHistory);
      setTextPrompt('');
      setToolMode('box');
      return;
    }
    if (await doSegmentation(nextHistory)) {
      setAutoSegmentSelection(selection);
      setPromptHistory(nextHistory);
      setTextPrompt('');
      setToolMode('box');
    }
  }, [applyFramePreviewResult, autoSegmentPreviewCache, autoSegmenting, doSegmentation, loading, running, videoSize, visibleAutoSegmentObjects]);

  const handleSelectMaskCandidate = useCallback((candidateIndex: number) => {
    setSelectedMaskCandidateIndex(candidateIndex);
    setFrameMaskRawUrlOverride(null);
    setViewMode('masked');

    if (!autoSegmentSelection || autoSegmentSelection === 'all') return;
    setAutoSegmentPreviewCache((currentCache) => {
      const currentPreview = currentCache[autoSegmentSelection];
      if (!currentPreview) return currentCache;
      return {
        ...currentCache,
        [autoSegmentSelection]: {
          ...currentPreview,
          selectedMaskCandidateIndex: candidateIndex,
          rawMaskUrlOverride: null,
        },
      };
    });
  }, [autoSegmentSelection]);

  const togglePlayback = useCallback(() => {
    if (viewMode === 'masked' && localMaskUrl && !resultVideoUrl) {
      setViewMode('source');
    }
    const v = viewMode === 'masked' && resultVideoUrl ? resultVideoRef.current : sourceVideoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      if (viewMode === 'masked' && maskDisplay === 'red-overlay' && overlayUnderlayVideoRef.current) {
        overlayUnderlayVideoRef.current.currentTime = v.currentTime;
        void overlayUnderlayVideoRef.current.play().catch(() => {});
      }
      setPlaying(true);
    } else {
      v.pause();
      overlayUnderlayVideoRef.current?.pause();
      setPlaying(false);
    }
  }, [localMaskUrl, maskDisplay, resultVideoUrl, viewMode]);

  const handleAccept = useCallback(async () => {
    if (running) return;
    if (outputMode === 'frame') {
      if (!localMaskUrl) return;
      await onAcceptMaskedVideo({
        url: localMaskUrl,
        outputKind: 'image',
        promptCount: promptHistory.length,
        detectionThreshold,
        currentFrameIndex,
        sourceTimeSeconds: currentTime,
        sourceWasTrimmed: false,
      });
      return;
    }
    if (!resultVideoUrl) return;
    await onAcceptMaskedVideo({
      url: resultVideoUrl,
      outputKind: 'video',
      promptCount: promptHistory.length,
      detectionThreshold,
      currentFrameIndex,
      sourceTimeSeconds: currentTime,
      sourceWasTrimmed: backend === 'cloud' && Boolean(clip),
    });
  }, [backend, clip, currentFrameIndex, currentTime, detectionThreshold, localMaskUrl, onAcceptMaskedVideo, outputMode, promptHistory.length, resultVideoUrl, running]);

  const drawBoxStyle = isDrawing && boxStart && boxEnd && displayedVideoRect && stageSize.width && stageSize.height
    ? {
        left: `${((displayedVideoRect.left + Math.min(boxStart.x, boxEnd.x) * displayedVideoRect.width) / stageSize.width) * 100}%`,
        top: `${((displayedVideoRect.top + Math.min(boxStart.y, boxEnd.y) * displayedVideoRect.height) / stageSize.height) * 100}%`,
        width: `${(Math.abs(boxEnd.x - boxStart.x) * displayedVideoRect.width / stageSize.width) * 100}%`,
        height: `${(Math.abs(boxEnd.y - boxStart.y) * displayedVideoRect.height / stageSize.height) * 100}%`,
      }
    : null;

  /* ── Mask display CSS class ── */
  const maskVideoClass = viewMode === 'masked'
    ? `svm__video svm__video--mask-${maskDisplay}${invertMask ? ' svm__video--inverted' : ''}`
    : 'svm__video';
  const showRedOverlayComposite = viewMode === 'masked' && maskDisplay === 'red-overlay' && Boolean(resultVideoUrl);

  useEffect(() => {
    if (!showRedOverlayComposite || !overlayUnderlayVideoRef.current) return;
    const underlay = overlayUnderlayVideoRef.current;
    if (Number.isFinite(currentTime) && Math.abs((underlay.currentTime || 0) - currentTime) > 0.033) {
      underlay.currentTime = currentTime;
    }
  }, [currentTime, showRedOverlayComposite]);

  const handleDownloadAsset = useCallback(async () => {
    const remoteUrl = asset.url || asset.sourceUrl || '';
    if (!remoteUrl) return;
    setDownloading(true);
    try {
      const ext = asset.type === 'video' ? '.mp4' : asset.type === 'audio' ? '.mp3' : '.png';
      const result = await window.electronAPI.media.downloadRemote({
        url: remoteUrl,
        projectId,
        assetId: asset.id,
        ext,
      });
      // Update the asset's fileRef so it has a local path now
      // This is a workaround — ideally the workspace should dispatch UPDATE_ASSET
      (asset as { fileRef?: string }).fileRef = result.path;
      setError(null);
      // Re-trigger the backend init
      setBackend((b) => b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download asset.');
    } finally {
      setDownloading(false);
    }
  }, [asset]);

  if (error) {
    const needsDownload = error === 'LOCAL_NEEDS_DOWNLOAD';
    return (
      <div className="sam3__error-card">
        <div className="sam3__error-icon">{needsDownload ? '↓' : '!'}</div>
        <h3>{needsDownload ? 'Asset Not Saved Locally' : 'SAM 3 Error'}</h3>
        <p>
          {needsDownload
            ? 'This AI-generated asset only exists as a remote URL. Save it to your computer to use local masking.'
            : error}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {needsDownload && (
            <>
              <button
                className="sam3__btn sam3__btn--accent"
                onClick={() => void handleDownloadAsset()}
                disabled={downloading}
              >
                {downloading ? 'Downloading...' : 'Save to Computer'}
              </button>
              <button className="sam3__btn sam3__btn--ghost" onClick={() => { setError(null); setBackend('cloud'); }}>
                Use Cloud Instead
              </button>
            </>
          )}
          {!needsDownload && (
            <button className="sam3__btn sam3__btn--ghost" onClick={() => setError(null)}>Dismiss</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="svm svm--full">
      {/* ── Top bar: backend toggle + tools + text input ── */}
      <div className="svm__topbar">
        <div className="svm__backend-toggle">
          <button
            className={`svm__backend-btn${backend === 'cloud' ? ' svm__backend-btn--active' : ''}`}
            onClick={() => setBackend('cloud')}
            title="Cloud SAM 3 (fal.ai — video support)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
            Cloud
          </button>
          <button
            className={`svm__backend-btn${backend === 'local' ? ' svm__backend-btn--active' : ''}`}
            onClick={() => setBackend('local')}
            title="Local SAM 3 (on-device frame preview + clip tracking)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            Local
          </button>
        </div>
        <>
          <div className="svm__hud-sep" />
          <div className="svm__mode-toggle">
            <button
              className={`svm__mode-btn${outputMode === 'frame' ? ' svm__mode-btn--active' : ''}`}
              onClick={() => {
                setOutputMode('frame');
                setResultVideoUrl(null);
                if (localMaskUrl) setViewMode('masked');
              }}
              title="Preview or insert the current frame only"
            >
              Frame
            </button>
            <button
              className={`svm__mode-btn${outputMode === 'clip' ? ' svm__mode-btn--active' : ''}`}
              onClick={() => setOutputMode('clip')}
              title="Preview on the current frame, then track across the full clip"
            >
              Clip
            </button>
          </div>
        </>
        <div className="svm__hud-sep" />
        <div className="svm__hud-tools">
          <button className={`svm__hud-btn${toolMode === 'text' ? ' svm__hud-btn--active' : ''}`} onClick={() => setToolMode('text')} title="Text prompt">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3h10v2.5M8 3v10M5.5 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className={`svm__hud-btn${toolMode === 'click' ? ' svm__hud-btn--active' : ''}`} onClick={() => setToolMode('click')} title="Click to select">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2v8l2.5-2.5L11 12l1.5-1-2.5-4.5H13L6 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className={`svm__hud-btn${toolMode === 'box' ? ' svm__hud-btn--active' : ''}`} onClick={() => setToolMode('box')} title="Box selection">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" /></svg>
          </button>
          <button
            className="svm__hud-btn svm__hud-btn--sm"
            onClick={() => void handleAutoSegment()}
            disabled={loading || running || autoSegmenting}
            title="Detect objects on the current frame automatically"
          >
            {autoSegmenting ? 'Scanning...' : 'Auto'}
          </button>
        </div>

        {toolMode !== 'text' && (
          <>
            <div className="svm__hud-sep" />
            <div className="svm__hud-tools">
              <button className={`svm__hud-btn svm__hud-btn--sm${promptMode === 'add' ? ' svm__hud-btn--add' : ''}`} onClick={() => setPromptMode('add')}>
                <span className="svm__mode-dot svm__mode-dot--add" /> Add
              </button>
              <button className={`svm__hud-btn svm__hud-btn--sm${promptMode === 'subtract' ? ' svm__hud-btn--sub' : ''}`} onClick={() => setPromptMode('subtract')}>
                <span className="svm__mode-dot svm__mode-dot--sub" /> Remove
              </button>
            </div>
          </>
        )}

        {toolMode === 'text' && (
          <>
            <div className="svm__hud-sep" />
            <input
              type="text"
              className="svm__inline-input"
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleTextSubmit()}
              placeholder="Describe what to mask..."
              disabled={running || autoSegmenting}
            />
            <button className="svm__inline-submit" onClick={() => void handleTextSubmit()} disabled={running || autoSegmenting || !textPrompt.trim()}>
              {autoSegmenting ? 'Scanning...' : (running ? 'Previewing...' : 'Preview')}
            </button>
          </>
        )}

        <div className="svm__hud-spacer" />

        {(promptHistory.length > 0 || visibleAutoSegmentObjects.length > 0) && (
          <div className="svm__badge-menus" ref={badgeMenusRef}>
            {promptHistory.length > 0 && (
              <div className="svm__badge-menu">
                <button
                  type="button"
                  className={`svm__prompt-badge svm__prompt-badge--button${badgePopover === 'prompts' ? ' svm__prompt-badge--open' : ''}`}
                  onClick={() => setBadgePopover((current) => current === 'prompts' ? null : 'prompts')}
                >
                  <span>{promptHistory.length} prompt{promptHistory.length !== 1 ? 's' : ''}</span>
                  <span className="svm__prompt-badge-caret">▾</span>
                </button>
                {badgePopover === 'prompts' && (
                  <div className="svm__badge-popover">
                    <div className="svm__badge-popover-title">Prompt history</div>
                    <div className="svm__badge-list">
                      {promptHistory.map((prompt, promptIndex) => {
                        const promptInfo = describePrompt(prompt);
                        return (
                          <div key={prompt.id} className="svm__badge-item">
                            <span className="svm__badge-item-label">#{promptIndex + 1} {promptInfo.title}</span>
                            <span className="svm__badge-item-meta">{promptInfo.detail}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {visibleAutoSegmentObjects.length > 0 && (
              <div className="svm__badge-menu">
                <button
                  type="button"
                  className={`svm__prompt-badge svm__prompt-badge--object svm__prompt-badge--button${badgePopover === 'objects' ? ' svm__prompt-badge--open' : ''}`}
                  onClick={() => setBadgePopover((current) => current === 'objects' ? null : 'objects')}
                >
                  <span>{visibleAutoSegmentObjects.length} object{visibleAutoSegmentObjects.length !== 1 ? 's' : ''}</span>
                  <span className="svm__prompt-badge-caret">▾</span>
                </button>
                {badgePopover === 'objects' && (
                  <div className="svm__badge-popover">
                    <div className="svm__badge-popover-title">Detected objects</div>
                    <div className="svm__badge-list">
                      <button
                        type="button"
                        className={`svm__badge-item svm__badge-item--button${autoSegmentSelection === 'all' ? ' svm__badge-item--active' : ''}`}
                        onClick={() => {
                          setBadgePopover(null);
                          void handleSelectAutoSegmentObject('all');
                        }}
                      >
                        <span className="svm__badge-item-label">All objects</span>
                        <span className="svm__badge-item-meta">{visibleAutoSegmentObjects.length} selected</span>
                      </button>
                      {visibleAutoSegmentObjects.map((object) => (
                        <button
                          key={`object-badge-${object.id}`}
                          type="button"
                          className={`svm__badge-item svm__badge-item--button${autoSegmentSelection === object.id ? ' svm__badge-item--active' : ''}`}
                          onClick={() => {
                            setBadgePopover(null);
                            void handleSelectAutoSegmentObject(object.id);
                          }}
                        >
                          <span className="svm__badge-item-label">{object.label}</span>
                          <span className="svm__badge-item-meta">{object.score.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {visibleAutoSegmentObjects.length > 0 && (
              <button
                type="button"
                className={`svm__prompt-badge svm__prompt-badge--button svm__prompt-badge--toggle${showAutoSegmentBoxes ? ' svm__prompt-badge--open' : ''}`}
                onClick={() => setShowAutoSegmentBoxes((current) => !current)}
              >
                {showAutoSegmentBoxes ? 'Boxes on' : 'Boxes off'}
              </button>
            )}
          </div>
        )}

        <div className="svm__hud-tools">
          <button className="svm__hud-btn" onClick={() => void handleUndo()} disabled={promptHistory.length === 0 || running || autoSegmenting} title="Undo">
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M4 5.5L2 3.5L4 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.5 3.5H9a3.5 3.5 0 010 7H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
          <button className="svm__hud-btn" onClick={handleClear} disabled={promptHistory.length === 0 || running || autoSegmenting} title="Clear all">
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M4.5 4.5l6 6M10.5 4.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      {/* ── Video canvas ── */}
      <div className="svm__stage">
        {loading ? (
          <div className="sam3__loading"><Spinner /><span>Preparing SAM 3...</span></div>
        ) : (
          <div
            ref={canvasRef}
            className={`svm__canvas${toolMode !== 'text' && viewMode === 'source' ? ' svm__canvas--crosshair' : ''}`}
            onClick={(e) => void handleCanvasClick(e)}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={(e) => void handleMouseUp(e)}
          >
            {showRedOverlayComposite ? (
              <div className="svm__mask-stack">
                <video
                  ref={overlayUnderlayVideoRef}
                  src={displaySourceUrl}
                  className="svm__video svm__video--underlay"
                  playsInline
                  muted
                  onLoadedMetadata={(e) => {
                    const initialTime = clip ? Math.max(0, clip.trimStart) : currentTime;
                    if (Number.isFinite(initialTime) && initialTime >= 0) {
                      e.currentTarget.currentTime = initialTime;
                    }
                  }}
                />
                {resultVideoUrl ? (
                  <video
                    ref={resultVideoRef}
                    src={resultVideoUrl}
                    className={`${maskVideoClass} svm__video--mask-overlay`}
                    playsInline
                    muted
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  />
                ) : localMaskUrl ? (
                  <img
                    src={localMaskUrl}
                    alt="Masked frame preview"
                    className={`${maskVideoClass} svm__video--mask-overlay`}
                  />
                ) : null}
              </div>
            ) : viewMode === 'masked' && resultVideoUrl ? (
              <video ref={resultVideoRef} src={resultVideoUrl} className={maskVideoClass} playsInline muted
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} />
            ) : viewMode === 'masked' && localMaskUrl ? (
              <img src={framePreviewUrl ?? localMaskUrl} alt="Masked frame preview" className="svm__video" />
            ) : (
              <video ref={sourceVideoRef} src={displaySourceUrl} className="svm__video" playsInline muted
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  setVideoSize({ width: el.videoWidth || 0, height: el.videoHeight || 0 });
                  setDuration(el.duration || 0);
                  const initialTime = clip ? Math.max(0, clip.trimStart) : currentTime;
                  if (Number.isFinite(initialTime) && initialTime > 0) {
                    el.currentTime = initialTime;
                    setCurrentTime(initialTime);
                  }
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} />
            )}
            {viewMode === 'source' && geometryPrompts.map((prompt) => {
              if (!displayedVideoRect || !stageSize.width || !stageSize.height) return null;
              if (prompt.kind === 'point') {
                const left = displayedVideoRect.left + prompt.x * displayedVideoRect.width;
                const top = displayedVideoRect.top + prompt.y * displayedVideoRect.height;
                return (
                  <div key={prompt.id} className={`sam3__prompt-point ${prompt.positive ? 'is-positive' : 'is-negative'}`}
                    style={{ left: `${(left / stageSize.width) * 100}%`, top: `${(top / stageSize.height) * 100}%` }}>
                    {prompt.positive ? '+' : '–'}
                  </div>
                );
              }
              return (
                <div key={prompt.id} className={`sam3__prompt-box ${prompt.positive ? 'is-positive' : 'is-negative'}`}
                  style={{
                    left: `${((displayedVideoRect.left + (prompt.x - prompt.w / 2) * displayedVideoRect.width) / stageSize.width) * 100}%`,
                    top: `${((displayedVideoRect.top + (prompt.y - prompt.h / 2) * displayedVideoRect.height) / stageSize.height) * 100}%`,
                    width: `${(prompt.w * displayedVideoRect.width / stageSize.width) * 100}%`,
                    height: `${(prompt.h * displayedVideoRect.height / stageSize.height) * 100}%`,
                  }} />
              );
            })}
            {showAutoSegmentBoxes && visibleAutoSegmentObjects.map((object, objectIndex) => {
              if (!displayedVideoRect || !stageSize.width || !stageSize.height) return null;
              const [x, y, w, h] = object.box;
              const left = ((displayedVideoRect.left + (x - w / 2) * displayedVideoRect.width) / stageSize.width) * 100;
              const top = ((displayedVideoRect.top + (y - h / 2) * displayedVideoRect.height) / stageSize.height) * 100;
              const width = (w * displayedVideoRect.width / stageSize.width) * 100;
              const height = (h * displayedVideoRect.height / stageSize.height) * 100;
              const isActive = autoSegmentSelection === object.id;
              const isGrouped = autoSegmentSelection === 'all';

              return (
                <div
                  key={object.id}
                  className={`svm__auto-box${isActive ? ' svm__auto-box--active' : ''}${isGrouped ? ' svm__auto-box--grouped' : ''}`}
                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                >
                  <button
                    type="button"
                    className={`svm__auto-box-pill${isActive ? ' svm__auto-box-pill--active' : ''}${isGrouped ? ' svm__auto-box-pill--grouped' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleSelectAutoSegmentObject(object.id);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    disabled={running || autoSegmenting}
                    title={`Preview ${object.label}`}
                  >
                    <span className="svm__auto-box-pill-label">{object.label}</span>
                    <span className="svm__auto-box-pill-score">{object.score.toFixed(2)}</span>
                  </button>
                  <span className="svm__auto-box-index">#{objectIndex + 1}</span>
                </div>
              );
            })}
            {drawBoxStyle && viewMode === 'source' && <div className="sam3__draw-box" style={drawBoxStyle} />}
            {running && <div className="svm__running-overlay"><Spinner /></div>}
          </div>
        )}

        {/* Mask display overlay — bottom-right corner of stage, only when viewing mask */}
        {!loading && viewMode === 'masked' && (resultVideoUrl || localMaskUrl) && (
          <div className="svm__viewer-overlay">
            <button className={`svm__vo-opt${maskDisplay === 'transparent' ? ' svm__vo-opt--active' : ''}`} onClick={() => setMaskDisplay('transparent')} title="Transparent background">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="0" y="0" width="6" height="6" fill="#555" /><rect x="6" y="6" width="6" height="6" fill="#555" /><rect x="6" y="0" width="6" height="6" fill="#333" /><rect x="0" y="6" width="6" height="6" fill="#333" /></svg>
            </button>
            <button className={`svm__vo-opt${maskDisplay === 'red-overlay' ? ' svm__vo-opt--active' : ''}`} onClick={() => setMaskDisplay('red-overlay')} title="Red overlay on source">
              <span className="svm__mask-opt-dot" style={{ background: '#e05050' }} />
            </button>
            <button className={`svm__vo-opt${maskDisplay === 'white-on-black' ? ' svm__vo-opt--active' : ''}`} onClick={() => setMaskDisplay('white-on-black')} title="White on black">
              <span className="svm__mask-opt-dot svm__mask-opt-dot--split" />
            </button>
            <div className="svm__vo-sep" />
            <button className={`svm__vo-opt${invertMask ? ' svm__vo-opt--active' : ''}`} onClick={() => setInvertMask((v) => !v)} title="Invert mask">
              Inv
            </button>
          </div>
        )}
      </div>

      {visibleAutoSegmentObjects.length > 0 && (
        <div className="svm__object-strip">
          <div className="svm__candidate-strip-label">Detected objects</div>
          <div className="svm__object-list">
            <button
              type="button"
              className={`svm__object-chip${autoSegmentSelection === 'all' ? ' svm__object-chip--active' : ''}`}
              onClick={() => void handleSelectAutoSegmentObject('all')}
              disabled={running || autoSegmenting}
            >
              <span className="svm__object-chip-name">All objects</span>
              <span className="svm__object-chip-meta">{visibleAutoSegmentObjects.length}</span>
            </button>
            {visibleAutoSegmentObjects.map((object) => (
              <button
                key={`detected-object-${object.id}`}
                type="button"
                className={`svm__object-chip${autoSegmentSelection === object.id ? ' svm__object-chip--active' : ''}`}
                onClick={() => void handleSelectAutoSegmentObject(object.id)}
                disabled={running || autoSegmenting}
                title={`Preview ${object.label}`}
              >
                <span className="svm__object-chip-name">{object.label}</span>
                <span className="svm__object-chip-meta">{object.score.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'masked' && !resultVideoUrl && frameMaskCandidates.length > 1 && (
        <div className="svm__candidate-strip">
          <div className="svm__candidate-strip-label">Mask candidates</div>
          <div className="svm__candidate-list">
            {frameMaskCandidates.map((candidate, candidateIdx) => {
              const previewUrl = frameMaskCandidatePreviews[candidate.index] ?? candidate.url;
              const isSelected = candidate.index === selectedMaskCandidateIndex;
              return (
                <button
                  key={`candidate-${candidate.index}`}
                  type="button"
                  className={`svm__candidate-card${isSelected ? ' svm__candidate-card--active' : ''}`}
                  onClick={() => handleSelectMaskCandidate(candidate.index)}
                  title={`Candidate ${candidateIdx + 1} • score ${candidate.score.toFixed(2)}`}
                >
                  <div className="svm__candidate-thumb-wrap">
                    <img
                      src={previewUrl}
                      alt={`Mask candidate ${candidateIdx + 1}`}
                      className="svm__candidate-thumb"
                    />
                  </div>
                  <div className="svm__candidate-meta">
                    <span className="svm__candidate-name">#{candidateIdx + 1}</span>
                    <span className="svm__candidate-score">{candidate.score.toFixed(2)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bottom transport bar ── */}
      <div className="svm__transport">
        <button className="svm__transport-btn" onClick={togglePlayback} disabled={loading}>
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="10" rx="0.5" /><rect x="7" y="1" width="3" height="10" rx="0.5" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 1.5l8 4.5-8 4.5V1.5z" /></svg>
          )}
        </button>
        <input type="range" min={0} max={duration || 0} step={0.01} value={currentTime} className="svm__scrubber"
          onChange={(e) => {
            const t = Number(e.target.value); setCurrentTime(t);
            if (localMaskUrl && !resultVideoUrl && viewMode === 'masked') {
              setViewMode('source');
            }
            const v = viewMode === 'masked' && resultVideoUrl ? resultVideoRef.current : sourceVideoRef.current;
            if (v) v.currentTime = t;
            if (overlayUnderlayVideoRef.current) overlayUnderlayVideoRef.current.currentTime = t;
          }}
        />
        <span className="svm__frame-num">{Math.round(currentFrameIndex)}f</span>

        <div className="svm__hud-spacer" />

        {/* View mode toggle — centered */}
        <div className="svm__view-toggle">
          <button className={`svm__view-btn${viewMode === 'source' ? ' svm__view-btn--active' : ''}`} onClick={() => setViewMode('source')}>Src</button>
          <button
            className={`svm__view-btn${viewMode === 'masked' ? ' svm__view-btn--active' : ''}`}
            onClick={() => setViewMode('masked')}
            disabled={!resultVideoUrl && !localMaskUrl}
          >
            Mask
          </button>
        </div>

        <div className="svm__hud-spacer" />

        {/* Settings popover toggle */}
        <div className="svm__settings-wrap">
          <button className={`svm__hud-btn${showSettings ? ' svm__hud-btn--active' : ''}`} onClick={() => setShowSettings((v) => !v)} title="Mask cutoff and edge settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
            </svg>
          </button>
          {showSettings && (
            <div className="svm__settings-popover">
              <div className="svm__settings-row">
                <span>Mask Cutoff</span>
                <span className="svm__settings-val">{detectionThreshold.toFixed(2)}</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={detectionThreshold}
                onChange={(e) => setDetectionThreshold(Number(e.target.value))} />
              <div className="svm__settings-row">
                <span>Edge Blur</span>
                <span className="svm__settings-val">{edgeBlur}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={edgeBlur}
                onChange={(e) => setEdgeBlur(Number(e.target.value))}
              />
              <div className="svm__settings-row">
                <span>Feather</span>
                <span className="svm__settings-val">{edgeFeather}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={edgeFeather}
                onChange={(e) => setEdgeFeather(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <>
          <div className="svm__transport-sep" />
          <div className="svm__hud-tools">
            <button
              className="svm__hud-btn svm__hud-btn--sm"
              onClick={() => void doSegmentation(promptHistory)}
              disabled={promptHistory.length === 0 || running || autoSegmenting}
              title="Regenerate the current-frame preview"
            >
              Preview Frame
            </button>
            {outputMode === 'clip' && (
              <button
                className="svm__accept-btn svm__accept-btn--secondary"
                onClick={() => void (backend === 'local' ? runLocalClipTracking() : runCloudClipTracking(promptHistory))}
                disabled={promptHistory.length === 0 || running || autoSegmenting}
              >
                {running ? 'Tracking...' : 'Track Clip'}
              </button>
            )}
          </div>
        </>

        <div className="svm__transport-sep" />

        <button
          className="svm__accept-btn"
          onClick={() => void handleAccept()}
          disabled={outputMode === 'frame'
            ? (!localMaskUrl || running)
            : (!resultVideoUrl || running)}
        >
          {outputMode === 'frame'
            ? (clip ? 'Insert Frame' : 'Add Frame')
            : (clip ? 'Insert Clip' : 'Add Clip')}
        </button>
      </div>
    </div>
  );
}
