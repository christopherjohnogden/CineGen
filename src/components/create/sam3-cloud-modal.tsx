import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ImageCompare } from './image-compare';
import { getApiKey } from '@/lib/utils/api-key';
import {
  detectAutoSegmentObjects,
  getAutoSegmentFrameSource,
  sortAutoSegmentObjectsForPrompting,
} from '@/lib/vision/auto-segment';

interface Sam3CloudModalProps {
  sourceKind: 'image' | 'video';
  sourceUrl: string;
  sourceFps?: number;
  onAcceptSelected: (result: { url: string }) => void;
  onAcceptAll?: (result: { layers: Array<{ url: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }> }) => void;
  onClose: () => void;
}

interface MaskData {
  dataUri: string;
  box: number[];
  score: number;
}

interface ImageSize {
  width: number;
  height: number;
}

interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type PromptMode = 'add' | 'subtract';
type ToolMode = 'text' | 'click' | 'box';
type ImageViewMode = 'overlay' | 'cutout' | 'compare';
type MaskDisplay = 'color-overlay' | 'red-overlay' | 'white-on-black';
type VideoViewMode = 'source' | 'segmented';

interface TextCloudPrompt {
  id: string;
  kind: 'text';
  text: string;
}

interface PointCloudPrompt {
  id: string;
  kind: 'point';
  positive: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  frameIndex?: number;
}

interface BoxCloudPrompt {
  id: string;
  kind: 'box';
  positive: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  frameIndex?: number;
}

type CloudPrompt = TextCloudPrompt | PointCloudPrompt | BoxCloudPrompt;

const SEGMENT_COLORS = [
  'rgba(212, 160, 84, 0.45)',
  'rgba(91, 143, 212, 0.45)',
  'rgba(92, 184, 122, 0.45)',
  'rgba(207, 125, 96, 0.45)',
  'rgba(160, 108, 213, 0.45)',
  'rgba(224, 192, 96, 0.45)',
];

const SEGMENT_SOLID_COLORS = [
  '#d4a054',
  '#5b8fd4',
  '#5cb87a',
  '#cf7d60',
  '#a06cd5',
  '#e0c060',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createPromptId(): string {
  return `prompt-${Math.random().toString(36).slice(2, 10)}`;
}

function buildAutoSegmentLabelPrompt(labels: string[]): string {
  const unique = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  return unique.slice(0, 6).join(', ');
}

function computeContainedImageRect(container: ImageSize, image: ImageSize): DisplayRect | null {
  if (!container.width || !container.height || !image.width || !image.height) return null;

  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  };
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function buildMaskOverlayDataUri(maskDataUri: string, fillColor: string, imageSize: ImageSize): string {
  if (!imageSize.width || !imageSize.height) return maskDataUri;
  const maskHref = escapeXmlAttribute(maskDataUri);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageSize.width} ${imageSize.height}" width="${imageSize.width}" height="${imageSize.height}">
      <defs>
        <mask id="sam3-cloud-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${imageSize.width}" height="${imageSize.height}" style="mask-type:luminance">
          <image href="${maskHref}" x="0" y="0" width="${imageSize.width}" height="${imageSize.height}" preserveAspectRatio="none" />
        </mask>
      </defs>
      <rect x="0" y="0" width="${imageSize.width}" height="${imageSize.height}" fill="${fillColor}" mask="url(#sam3-cloud-mask)" />
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function buildMaskDisplayPreview(
  sourceUrl: string,
  maskDataUri: string,
  imageSize: ImageSize,
  options: { threshold: number; blur: number; feather: number },
  display: MaskDisplay,
): Promise<string> {
  const [sourceData, maskData] = await Promise.all([
    loadImageData(sourceUrl, imageSize.width || undefined, imageSize.height || undefined),
    loadImageData(maskDataUri, imageSize.width || undefined, imageSize.height || undefined),
  ]);
  const alpha = buildProcessedAlpha(maskData, options);
  const preview = new ImageData(sourceData.width, sourceData.height);

  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    const maskAlpha = alpha[i] ?? 0;
    const srcR = sourceData.data[offset] ?? 0;
    const srcG = sourceData.data[offset + 1] ?? 0;
    const srcB = sourceData.data[offset + 2] ?? 0;

    if (display === 'white-on-black') {
      const value = maskAlpha > 0 ? 255 : 0;
      preview.data[offset] = value;
      preview.data[offset + 1] = value;
      preview.data[offset + 2] = value;
      preview.data[offset + 3] = 255;
    } else {
      // red-overlay: blend red onto source where mask is present
      const overlayStrength = (maskAlpha / 255) * 0.5;
      preview.data[offset] = Math.round(srcR * (1 - overlayStrength) + 235 * overlayStrength);
      preview.data[offset + 1] = Math.round(srcG * (1 - overlayStrength) + 78 * overlayStrength);
      preview.data[offset + 2] = Math.round(srcB * (1 - overlayStrength) + 78 * overlayStrength);
      preview.data[offset + 3] = 255;
    }
  }
  return imageDataToDataUrl(preview);
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
  options: { blur: number; feather: number; threshold: number },
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
  options: { blur: number; feather: number; threshold: number },
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

async function buildLayerSetFromMasks(
  sourceUrl: string,
  imageSize: ImageSize,
  masks: MaskData[],
  options: { blur: number; feather: number; threshold: number },
): Promise<Array<{ url: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>> {
  const sourceData = await loadImageData(sourceUrl, imageSize.width || undefined, imageSize.height || undefined);
  const combinedAlpha = new Uint8ClampedArray(sourceData.width * sourceData.height);
  const layers: Array<{ url: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }> = [];

  for (let i = 0; i < masks.length; i++) {
    const maskData = await loadImageData(masks[i].dataUri, sourceData.width, sourceData.height);
    const alpha = buildProcessedAlpha(maskData, options);
    const cutout = new ImageData(sourceData.width, sourceData.height);

    for (let px = 0; px < alpha.length; px++) {
      const offset = px * 4;
      combinedAlpha[px] = Math.max(combinedAlpha[px], alpha[px] ?? 0);
      cutout.data[offset] = sourceData.data[offset] ?? 0;
      cutout.data[offset + 1] = sourceData.data[offset + 1] ?? 0;
      cutout.data[offset + 2] = sourceData.data[offset + 2] ?? 0;
      cutout.data[offset + 3] = alpha[px] ?? 0;
    }

    layers.push({
      url: imageDataToDataUrl(cutout),
      name: `Segment ${i + 1}`,
      type: 'segment',
      z_order: i + 1,
      metadata: {
        confidence: masks[i].score,
        bbox: masks[i].box,
      },
    });
  }

  const background = new ImageData(sourceData.width, sourceData.height);
  for (let px = 0; px < combinedAlpha.length; px++) {
    const offset = px * 4;
    background.data[offset] = sourceData.data[offset] ?? 0;
    background.data[offset + 1] = sourceData.data[offset + 1] ?? 0;
    background.data[offset + 2] = sourceData.data[offset + 2] ?? 0;
    background.data[offset + 3] = 255 - combinedAlpha[px];
  }

  return [
    {
      url: imageDataToDataUrl(background),
      name: 'Background',
      type: 'background',
      z_order: 0,
      metadata: { source: 'mask-inverse' },
    },
    ...layers,
  ];
}

const IconText = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 3h10v2.5M8 3v10M5.5 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconClick = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M6 2v8l2.5-2.5L11 12l1.5-1-2.5-4.5H13L6 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconBox = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2"/>
  </svg>
);
const IconAuto = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5l1.1 2.8L12 5.4l-2.2 1.5.8 2.7L8 8 5.4 9.6l.8-2.7L4 5.4l2.9-1.1L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M12.5 10.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" fill="currentColor"/>
  </svg>
);
const IconUndo = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M4 5.5L2 3.5L4 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2.5 3.5H9a3.5 3.5 0 010 7H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const IconClear = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M4.5 4.5l6 6M10.5 4.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }}>
    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconLayers = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5L1.5 4.5L7 7.5L12.5 4.5L7 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M1.5 7l5.5 3 5.5-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
    <path d="M1.5 9.5l5.5 3 5.5-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.3"/>
  </svg>
);
const IconSliders = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 4h3M7 4h5M2 7h7M11 7h1M2 10h1M5 10h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <circle cx="6" cy="4" r="1" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="10" cy="7" r="1" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="4" cy="10" r="1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);
const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
const Spinner = () => (
  <div className="sam3__spinner">
    <div className="sam3__spinner-ring" />
  </div>
);

function ImageSegmentationPane({
  sourceUrl,
  onAcceptSelected,
  onAcceptAll,
  onClose,
}: {
  sourceUrl: string;
  onAcceptSelected: (result: { url: string }) => void;
  onAcceptAll?: Sam3CloudModalProps['onAcceptAll'];
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('text');
  const [promptMode, setPromptMode] = useState<PromptMode>('add');
  const [viewMode, setViewMode] = useState<ImageViewMode>('overlay');
  const [maskDisplay, setMaskDisplay] = useState<MaskDisplay>('color-overlay');
  const [textPrompt, setTextPrompt] = useState('');
  const [allMasks, setAllMasks] = useState<MaskData[]>([]);
  const [promptHistory, setPromptHistory] = useState<CloudPrompt[]>([]);
  const [selectedMask, setSelectedMask] = useState(0);
  const [imageSize, setImageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [selectedCutoutPreviewUrl, setSelectedCutoutPreviewUrl] = useState<string | null>(null);
  const [isCutoutPreviewLoading, setIsCutoutPreviewLoading] = useState(false);
  const [maskDisplayPreviewUrl, setMaskDisplayPreviewUrl] = useState<string | null>(null);
  const [remoteSourceUrl, setRemoteSourceUrl] = useState<string | null>(null);
  const [autoSegmenting, setAutoSegmenting] = useState(false);
  const [blur, setBlur] = useState(2);
  const [feather, setFeather] = useState(4);
  const [threshold, setThreshold] = useState(0.5);
  const [confidence, setConfidence] = useState(0.3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState({ segments: true, postProcessing: true });

  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('Add your fal.ai API key in Settings before using SAM 3 cloud.');
        const uploaded = await window.electronAPI.elements.uploadMediaSource(sourceUrl, apiKey);
        const img = await loadImageElement(sourceUrl);
        if (cancelled) return;
        setRemoteSourceUrl(uploaded.url);
        setImageSize({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        setLoading(false);
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Failed to initialize cloud SAM 3.');
      }
    })();
    return () => { cancelled = true; };
  }, [sourceUrl]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const updateSize = () => setStageSize({ width: el.clientWidth, height: el.clientHeight });
    updateSize();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, viewMode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const masks = useMemo(
    () => allMasks.filter((mask) => mask.score >= confidence),
    [allMasks, confidence],
  );
  const selectedMaskData = masks[selectedMask];
  const displayedImageRect = computeContainedImageRect(stageSize, imageSize);
  const geometryPrompts = promptHistory.filter((prompt): prompt is Extract<CloudPrompt, { kind: 'point' | 'box' }> => prompt.kind === 'point' || prompt.kind === 'box');

  useEffect(() => {
    if (masks.length === 0) {
      if (selectedMask !== 0) setSelectedMask(0);
      return;
    }
    if (selectedMask >= masks.length) setSelectedMask(masks.length - 1);
  }, [masks.length, selectedMask]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedMaskData) {
      setSelectedCutoutPreviewUrl(null);
      setIsCutoutPreviewLoading(false);
      return;
    }
    setIsCutoutPreviewLoading(true);
    buildCutoutPreviewDataUri(sourceUrl, selectedMaskData.dataUri, imageSize, { blur, feather, threshold })
      .then((nextUrl) => {
        if (cancelled) return;
        setSelectedCutoutPreviewUrl(nextUrl);
        setIsCutoutPreviewLoading(false);
      })
      .catch((nextError) => {
        console.error('[sam3-cloud-image] Cutout preview error:', nextError);
        if (cancelled) return;
        setSelectedCutoutPreviewUrl(null);
        setIsCutoutPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [blur, feather, imageSize, selectedMaskData, sourceUrl, threshold]);

  // Build red-overlay / white-on-black preview when mask display mode changes
  useEffect(() => {
    let cancelled = false;
    if (maskDisplay === 'color-overlay' || !selectedMaskData) {
      setMaskDisplayPreviewUrl(null);
      return;
    }
    buildMaskDisplayPreview(sourceUrl, selectedMaskData.dataUri, imageSize, { blur, feather, threshold }, maskDisplay)
      .then((url) => { if (!cancelled) setMaskDisplayPreviewUrl(url); })
      .catch((err) => { console.error('[sam3-cloud-image] Mask display preview error:', err); if (!cancelled) setMaskDisplayPreviewUrl(null); });
    return () => { cancelled = true; };
  }, [blur, feather, imageSize, maskDisplay, selectedMaskData, sourceUrl, threshold]);

  const getNormalizedEventPoint = useCallback((e: React.MouseEvent, clampToImage = false) => {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const liveDisplayRect = computeContainedImageRect({ width: rect.width, height: rect.height }, imageSize);
    if (!liveDisplayRect) return null;

    const x = (e.clientX - rect.left - liveDisplayRect.left) / liveDisplayRect.width;
    const y = (e.clientY - rect.top - liveDisplayRect.top) / liveDisplayRect.height;

    if (!clampToImage && (x < 0 || x > 1 || y < 0 || y > 1)) return null;

    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
    };
  }, [imageSize]);

  const runSegmentation = useCallback(async (history: CloudPrompt[]) => {
    if (!remoteSourceUrl) return false;

    const apiKey = getApiKey();
    if (!apiKey) {
      setError('Add your fal.ai API key in Settings before using SAM 3 cloud.');
      return false;
    }

    const textPromptValue = history
      .filter((prompt): prompt is TextCloudPrompt => prompt.kind === 'text')
      .map((prompt) => prompt.text.trim())
      .filter(Boolean)
      .join(', ');
    const pointPrompts = history
      .filter((prompt): prompt is PointCloudPrompt => prompt.kind === 'point')
      .map((prompt) => ({
        x: clamp(Math.round(prompt.x * imageSize.width), 0, imageSize.width),
        y: clamp(Math.round(prompt.y * imageSize.height), 0, imageSize.height),
        label: prompt.positive ? 1 : 0,
      }));
    const boxPrompts = history
      .filter((prompt): prompt is BoxCloudPrompt => prompt.kind === 'box')
      .map((prompt) => ({
        x_min: clamp(Math.round((prompt.x - prompt.w / 2) * imageSize.width), 0, imageSize.width),
        y_min: clamp(Math.round((prompt.y - prompt.h / 2) * imageSize.height), 0, imageSize.height),
        x_max: clamp(Math.round((prompt.x + prompt.w / 2) * imageSize.width), 0, imageSize.width),
        y_max: clamp(Math.round((prompt.y + prompt.h / 2) * imageSize.height), 0, imageSize.height),
        label: prompt.positive ? 1 : 0,
      }));

    if (!textPromptValue && pointPrompts.length === 0 && boxPrompts.length === 0) {
      setAllMasks([]);
      return true;
    }

    setRunning(true);
    setError(null);
    try {
      const result = await window.electronAPI.workflow.run({
        apiKey,
        nodeId: 'sam3-cloud-image',
        nodeType: 'sam3-segment-cloud',
        modelId: 'fal-ai/sam-3/image',
        inputs: {
          image_url: remoteSourceUrl,
          ...(textPromptValue ? { prompt: textPromptValue } : {}),
          ...(pointPrompts.length > 0 ? { point_prompts: pointPrompts } : {}),
          ...(boxPrompts.length > 0 ? { box_prompts: boxPrompts } : {}),
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
      const rawScores = Array.isArray(result.scores) ? result.scores : [];
      const rawBoxes = Array.isArray(result.boxes) ? result.boxes : [];
      const nextMasks = rawMasks
        .map((mask, index) => {
          const dataUri = typeof mask === 'string'
            ? mask
            : (mask && typeof mask === 'object' && typeof (mask as { url?: unknown }).url === 'string' ? (mask as { url: string }).url : '');
          if (!dataUri) return null;
          return {
            dataUri,
            box: Array.isArray(rawBoxes[index]) ? (rawBoxes[index] as number[]) : [],
            score: typeof rawScores[index] === 'number' ? Number(rawScores[index]) : 1,
          } satisfies MaskData;
        })
        .filter((mask): mask is MaskData => Boolean(mask));

      setAllMasks(nextMasks);
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'SAM 3 image segmentation failed.');
      return false;
    } finally {
      setRunning(false);
    }
  }, [imageSize.height, imageSize.width, remoteSourceUrl]);

  const handleTextSubmit = useCallback(async () => {
    if (autoSegmenting) return;
    const prompt = textPrompt.trim();
    if (!prompt) return;
    const nextHistory = [...promptHistory, { id: createPromptId(), kind: 'text' as const, text: prompt }];
    const ok = await runSegmentation(nextHistory);
    if (!ok) return;
    setPromptHistory(nextHistory);
    setTextPrompt('');
  }, [autoSegmenting, promptHistory, runSegmentation, textPrompt]);

  const submitGeometricPrompt = useCallback(async (prompt: Omit<Extract<CloudPrompt, { kind: 'point' | 'box' }>, 'id'>) => {
    const nextHistory = [...promptHistory, { ...prompt, id: createPromptId() }];
    const ok = await runSegmentation(nextHistory);
    if (!ok) return false;
    setPromptHistory(nextHistory);
    return true;
  }, [promptHistory, runSegmentation]);

  const handleCanvasClick = useCallback(async (e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'click' || running) return;
    const point = getNormalizedEventPoint(e);
    if (!point) return;
    const clickPromptWidth = imageSize.width > 0 ? 4 / imageSize.width : 0.01;
    const clickPromptHeight = imageSize.height > 0 ? 4 / imageSize.height : 0.01;
    await submitGeometricPrompt({
      kind: 'point',
      positive: promptMode === 'add',
      x: point.x,
      y: point.y,
      w: clickPromptWidth,
      h: clickPromptHeight,
    });
  }, [autoSegmenting, getNormalizedEventPoint, imageSize.height, imageSize.width, promptMode, running, submitGeometricPrompt, toolMode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'box' || running) return;
    e.preventDefault();
    const point = getNormalizedEventPoint(e);
    if (!point) return;
    setBoxStart(point);
    setBoxEnd(point);
    setIsDrawing(true);
  }, [autoSegmenting, getNormalizedEventPoint, running, toolMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing) return;
    const point = getNormalizedEventPoint(e, true);
    if (!point) return;
    setBoxEnd(point);
  }, [autoSegmenting, getNormalizedEventPoint, isDrawing]);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing || !boxStart) {
      setIsDrawing(false);
      return;
    }
    const nextBoxEnd = getNormalizedEventPoint(e, true) ?? boxEnd;
    if (!nextBoxEnd) {
      setIsDrawing(false);
      setBoxStart(null);
      setBoxEnd(null);
      return;
    }
    const w = Math.abs(nextBoxEnd.x - boxStart.x);
    const h = Math.abs(nextBoxEnd.y - boxStart.y);
    if (w > 0.01 && h > 0.01) {
      await submitGeometricPrompt({
        kind: 'box',
        positive: promptMode === 'add',
        x: (boxStart.x + nextBoxEnd.x) / 2,
        y: (boxStart.y + nextBoxEnd.y) / 2,
        w,
        h,
      });
    }
    setIsDrawing(false);
    setBoxStart(null);
    setBoxEnd(null);
  }, [autoSegmenting, boxEnd, boxStart, getNormalizedEventPoint, isDrawing, promptMode, submitGeometricPrompt]);

  const handleUndo = useCallback(async () => {
    const nextHistory = promptHistory.slice(0, -1);
    setPromptHistory(nextHistory);
    await runSegmentation(nextHistory);
  }, [promptHistory, runSegmentation]);

  const handleClear = useCallback(() => {
    setPromptHistory([]);
    setAllMasks([]);
    setSelectedMask(0);
    setTextPrompt('');
  }, []);

  const handleAcceptSelected = useCallback(() => {
    if (!selectedCutoutPreviewUrl) return;
    onAcceptSelected({ url: selectedCutoutPreviewUrl });
  }, [onAcceptSelected, selectedCutoutPreviewUrl]);

  const handleAcceptAll = useCallback(async () => {
    if (!onAcceptAll || masks.length === 0) return;
    try {
      const layers = await buildLayerSetFromMasks(sourceUrl, imageSize, masks, { blur, feather, threshold });
      onAcceptAll({ layers });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to build extracted layers.');
    }
  }, [blur, feather, imageSize, masks, onAcceptAll, sourceUrl, threshold]);

  const handleAutoSegment = useCallback(async () => {
    if (loading || running || autoSegmenting) return;

    setAutoSegmenting(true);
    try {
      const detectedObjects = sortAutoSegmentObjectsForPrompting(await detectAutoSegmentObjects(sourceUrl, {
        context: 'Create-space SAM3 cloud image auto segmentation',
        maxObjects: 6,
      }));
      if (detectedObjects.length === 0) {
        window.alert('Auto Segment could not find any distinct objects in this image.');
        return;
      }

      const labelPrompt = buildAutoSegmentLabelPrompt(detectedObjects.map((detectedObject) => detectedObject.label));
      const nextHistory: CloudPrompt[] = [];
      if (labelPrompt) {
        nextHistory.push({
          id: createPromptId(),
          kind: 'text',
          text: labelPrompt,
        });
      }
      nextHistory.push(...detectedObjects.map((detectedObject) => {
        const [x, y, w, h] = detectedObject.box;
        return {
          id: createPromptId(),
          kind: 'box' as const,
          positive: true,
          x,
          y,
          w,
          h,
        };
      }));
      const ok = await runSegmentation(nextHistory);
      if (!ok) return;
      setPromptHistory(nextHistory);
      setTextPrompt('');
      setToolMode('box');
      setViewMode('overlay');
    } catch (nextError) {
      console.error('[sam3-cloud-image] Auto segment error:', nextError);
      window.alert(nextError instanceof Error ? nextError.message : 'Auto Segment failed.');
    } finally {
      setAutoSegmenting(false);
    }
  }, [autoSegmenting, loading, runSegmentation, running, sourceUrl]);

  const selectedMaskOverlayUrl = selectedMaskData
    ? buildMaskOverlayDataUri(selectedMaskData.dataUri, SEGMENT_COLORS[selectedMask % SEGMENT_COLORS.length], imageSize)
    : null;

  const drawBoxStyle = isDrawing && boxStart && boxEnd && displayedImageRect && stageSize.width && stageSize.height
    ? {
        left: `${((displayedImageRect.left + Math.min(boxStart.x, boxEnd.x) * displayedImageRect.width) / stageSize.width) * 100}%`,
        top: `${((displayedImageRect.top + Math.min(boxStart.y, boxEnd.y) * displayedImageRect.height) / stageSize.height) * 100}%`,
        width: `${(Math.abs(boxEnd.x - boxStart.x) * displayedImageRect.width / stageSize.width) * 100}%`,
        height: `${(Math.abs(boxEnd.y - boxStart.y) * displayedImageRect.height / stageSize.height) * 100}%`,
      }
    : null;

  const promptOverlay = (
    <div className="sam3__prompt-overlay">
      {geometryPrompts.map((prompt) => {
        if (!displayedImageRect || !stageSize.width || !stageSize.height) return null;

        if (prompt.kind === 'point') {
          const left = displayedImageRect.left + prompt.x * displayedImageRect.width;
          const top = displayedImageRect.top + prompt.y * displayedImageRect.height;
          return (
            <div
              key={prompt.id}
              className={`sam3__prompt-point ${prompt.positive ? 'is-positive' : 'is-negative'}`}
              style={{
                left: `${(left / stageSize.width) * 100}%`,
                top: `${(top / stageSize.height) * 100}%`,
              }}
            >
              {prompt.positive ? '+' : '–'}
            </div>
          );
        }

        return (
          <div
            key={prompt.id}
            className={`sam3__prompt-box ${prompt.positive ? 'is-positive' : 'is-negative'}`}
            style={{
              left: `${((displayedImageRect.left + (prompt.x - prompt.w / 2) * displayedImageRect.width) / stageSize.width) * 100}%`,
              top: `${((displayedImageRect.top + (prompt.y - prompt.h / 2) * displayedImageRect.height) / stageSize.height) * 100}%`,
              width: `${(prompt.w * displayedImageRect.width / stageSize.width) * 100}%`,
              height: `${(prompt.h * displayedImageRect.height / stageSize.height) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );

  if (error) {
    return (
      <div className="sam3__error-card">
        <div className="sam3__error-icon">!</div>
        <h3>SAM 3 Cloud Error</h3>
        <p>{error}</p>
        <button className="sam3__btn sam3__btn--ghost" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className="sam3">
      <button className="sam3__close" onClick={onClose} aria-label="Close">
        <IconClose />
      </button>

      <div className="sam3__header">
        <span className="sam3__badge">SAM 3</span>
        <span className="sam3__header-label">Cloud Image Segmentation</span>
      </div>

      <div className="sam3__canvas-area">
        <div className="sam3__toolbar">
          <div className="sam3__tool-group">
            <button className={`sam3__tool-btn ${toolMode === 'text' ? 'is-active' : ''}`} onClick={() => setToolMode('text')} title="Text prompt">
              <IconText />
              <span>Text</span>
            </button>
            <button className={`sam3__tool-btn ${toolMode === 'click' ? 'is-active' : ''}`} onClick={() => setToolMode('click')} title="Click to segment">
              <IconClick />
              <span>Click</span>
            </button>
            <button className={`sam3__tool-btn ${toolMode === 'box' ? 'is-active' : ''}`} onClick={() => setToolMode('box')} title="Box selection">
              <IconBox />
              <span>Box</span>
            </button>
            <button className="sam3__tool-btn" onClick={() => void handleAutoSegment()} title="Detect and segment objects automatically" disabled={loading || running || autoSegmenting}>
              <IconAuto />
              <span>{autoSegmenting ? 'Scanning' : 'Auto'}</span>
            </button>
          </div>

          {toolMode !== 'text' && (
            <>
              <div className="sam3__toolbar-divider" />
              <div className="sam3__tool-group">
                <button className={`sam3__mode-btn ${promptMode === 'add' ? 'is-active is-add' : ''}`} onClick={() => setPromptMode('add')}>
                  <span className="sam3__mode-dot is-add" />
                  Add
                </button>
                <button className={`sam3__mode-btn ${promptMode === 'subtract' ? 'is-active is-sub' : ''}`} onClick={() => setPromptMode('subtract')}>
                  <span className="sam3__mode-dot is-sub" />
                  Remove
                </button>
              </div>
            </>
          )}

          <div className="sam3__toolbar-spacer" />

          <div className="sam3__tool-group">
            <button className="sam3__icon-btn" onClick={() => void handleUndo()} title="Undo last prompt" disabled={promptHistory.length === 0 || running || autoSegmenting}>
              <IconUndo />
            </button>
            <button className="sam3__icon-btn" onClick={handleClear} title="Clear all" disabled={promptHistory.length === 0 || running || autoSegmenting}>
              <IconClear />
            </button>
          </div>
        </div>

        {toolMode === 'text' && (
          <div className="sam3__text-bar">
            <div className="sam3__text-input-wrap">
              <input
                type="text"
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleTextSubmit()}
                placeholder="Describe what to segment: person, car, sky..."
                disabled={autoSegmenting}
                autoFocus
              />
            </div>
            <button className="sam3__btn sam3__btn--accent" onClick={() => void handleTextSubmit()} disabled={running || autoSegmenting || !textPrompt.trim()}>
              {autoSegmenting ? 'Scanning…' : 'Segment'}
            </button>
          </div>
        )}

        <div className="sam3__stage-wrap">
          {loading ? (
            <div className="sam3__loading">
              <Spinner />
              <span>Preparing cloud SAM 3...</span>
            </div>
          ) : viewMode === 'overlay' ? (
            <div
              ref={canvasRef}
              className={`sam3__stage ${toolMode !== 'text' ? 'cursor-crosshair' : ''}`}
              onClick={(e) => void handleCanvasClick(e)}
              onDragStart={(e) => e.preventDefault()}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={(e) => void handleMouseUp(e)}
            >
              {maskDisplay !== 'color-overlay' && maskDisplayPreviewUrl ? (
                // Red overlay or white-on-black: single composited image
                // eslint-disable-next-line @next/next/no-img-element
                <img src={maskDisplayPreviewUrl} alt={`Mask ${selectedMask + 1}`} className="sam3__source-img" draggable={false} />
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sourceUrl} alt="Source" className="sam3__source-img" draggable={false} />
                  {selectedMaskOverlayUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedMaskOverlayUrl} alt={`Mask ${selectedMask + 1}`} className="sam3__mask-img" draggable={false} />
                  )}
                </>
              )}
              {promptOverlay}
              {drawBoxStyle && <div className="sam3__draw-box" style={drawBoxStyle} />}
            </div>
          ) : viewMode === 'cutout' ? (
            <div ref={canvasRef} className="sam3__stage sam3__stage--checker">
              {selectedCutoutPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedCutoutPreviewUrl} alt={`Cutout ${selectedMask + 1}`} className="sam3__cutout-img" draggable={false} />
              ) : (
                <div className="sam3__empty">
                  {isCutoutPreviewLoading ? 'Generating cutout…' : 'Select a segment to preview'}
                </div>
              )}
            </div>
          ) : (
            <div ref={canvasRef} className="sam3__stage sam3__stage--checker">
              {selectedCutoutPreviewUrl ? (
                <ImageCompare beforeUrl={sourceUrl} afterUrl={selectedCutoutPreviewUrl} className="sam3__compare" dragHandleOnly />
              ) : (
                <div className="sam3__empty">
                  {isCutoutPreviewLoading ? 'Generating cutout…' : 'Select a segment to preview'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sam3__view-tabs">
          {(['overlay', 'cutout', 'compare'] as ImageViewMode[]).map((mode) => (
            <button key={mode} className={`sam3__view-tab ${viewMode === mode ? 'is-active' : ''}`} onClick={() => setViewMode(mode)}>
              {mode === 'overlay' ? 'Original + Mask' : mode === 'cutout' ? 'Cutout' : 'Compare'}
            </button>
          ))}
          {viewMode === 'overlay' && selectedMaskData && (
            <div className="sam3__mask-display-opts">
              <button className={`sam3__mask-opt${maskDisplay === 'color-overlay' ? ' sam3__mask-opt--active' : ''}`} onClick={() => setMaskDisplay('color-overlay')} title="Color overlay">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" fill="currentColor" /></svg>
              </button>
              <button className={`sam3__mask-opt${maskDisplay === 'red-overlay' ? ' sam3__mask-opt--active' : ''}`} onClick={() => setMaskDisplay('red-overlay')} title="Red overlay on source">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#eb4e4e" opacity="0.6" /><rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="2" /></svg>
              </button>
              <button className={`sam3__mask-opt${maskDisplay === 'white-on-black' ? ' sam3__mask-opt--active' : ''}`} onClick={() => setMaskDisplay('white-on-black')} title="White on black">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#000" /><circle cx="12" cy="12" r="6" fill="#fff" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sam3__sidebar">
        <div className="sam3__panel">
          <button className="sam3__panel-header" onClick={() => setSectionsOpen((prev) => ({ ...prev, segments: !prev.segments }))}>
            <IconLayers />
            <span className="sam3__panel-title">Segments</span>
            {masks.length > 0 && <span className="sam3__panel-count">{masks.length}</span>}
            <IconChevron open={sectionsOpen.segments} />
          </button>
          {sectionsOpen.segments && (
            <div className="sam3__panel-body">
              {masks.length === 0 ? (
                <div className="sam3__panel-empty">{running ? 'Working on segmentation…' : 'No segments yet. Use the tools above to segment the image.'}</div>
              ) : (
                <div className="sam3__segment-list">
                  {masks.map((mask, index) => (
                    <button
                      key={`${index}-${mask.dataUri.slice(0, 32)}`}
                      className={`sam3__segment-item ${index === selectedMask ? 'is-selected' : ''}`}
                      onClick={() => setSelectedMask(index)}
                    >
                      <div className="sam3__segment-swatch" style={{ background: SEGMENT_SOLID_COLORS[index % SEGMENT_SOLID_COLORS.length] }} />
                      <span className="sam3__segment-name">Segment {index + 1}</span>
                      <span className="sam3__segment-score">{Math.round(mask.score * 100)}%</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sam3__panel">
          <button className="sam3__panel-header" onClick={() => setSectionsOpen((prev) => ({ ...prev, postProcessing: !prev.postProcessing }))}>
            <IconSliders />
            <span className="sam3__panel-title">Refinement</span>
            <IconChevron open={sectionsOpen.postProcessing} />
          </button>
          {sectionsOpen.postProcessing && (
            <div className="sam3__panel-body">
              <div className="sam3__slider-group">
                <div className="sam3__slider-row">
                  <label>Edge Blur</label>
                  <span className="sam3__slider-val">{blur}px</span>
                </div>
                <input type="range" min={0} max={20} value={blur} onChange={(e) => setBlur(Number(e.target.value))} />
              </div>
              <div className="sam3__slider-group">
                <div className="sam3__slider-row">
                  <label>Feather</label>
                  <span className="sam3__slider-val">{feather}px</span>
                </div>
                <input type="range" min={0} max={20} value={feather} onChange={(e) => setFeather(Number(e.target.value))} />
              </div>
              <div className="sam3__slider-group">
                <div className="sam3__slider-row">
                  <label>Alpha Threshold</label>
                  <span className="sam3__slider-val">{threshold.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
              </div>
              <div className="sam3__slider-group">
                <div className="sam3__slider-row">
                  <label>Confidence</label>
                  <span className="sam3__slider-val">{confidence.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
              </div>
            </div>
          )}
        </div>

        <div className="sam3__sidebar-spacer" />

        <div className="sam3__actions">
          <button className="sam3__btn sam3__btn--ghost" onClick={onClose}>Cancel</button>
          <button className="sam3__btn sam3__btn--accent" onClick={handleAcceptSelected} disabled={!selectedCutoutPreviewUrl || running}>Accept Selected</button>
          {onAcceptAll && (
            <button className="sam3__btn sam3__btn--outline" onClick={() => void handleAcceptAll()} disabled={masks.length === 0 || running}>
              Accept All Layers
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoSegmentationPane({
  sourceUrl,
  sourceFps,
  onAcceptSelected,
  onClose,
}: {
  sourceUrl: string;
  sourceFps?: number;
  onAcceptSelected: (result: { url: string }) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('text');
  const [promptMode, setPromptMode] = useState<PromptMode>('add');
  const [viewMode, setViewMode] = useState<VideoViewMode>('source');
  const [textPrompt, setTextPrompt] = useState('');
  const [promptHistory, setPromptHistory] = useState<CloudPrompt[]>([]);
  const [stageSize, setStageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [remoteSourceUrl, setRemoteSourceUrl] = useState<string | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [detectionThreshold, setDetectionThreshold] = useState(0.5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sectionsOpen, setSectionsOpen] = useState({ prompts: true, tracking: true });
  const [playing, setPlaying] = useState(false);
  const [autoSegmenting, setAutoSegmenting] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('Add your fal.ai API key in Settings before using SAM 3 cloud.');
        const uploaded = await window.electronAPI.elements.uploadMediaSource(sourceUrl, apiKey);
        if (cancelled) return;
        setRemoteSourceUrl(uploaded.url);
        setLoading(false);
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Failed to initialize cloud video SAM 3.');
      }
    })();
    return () => { cancelled = true; };
  }, [sourceUrl]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const updateSize = () => setStageSize({ width: el.clientWidth, height: el.clientHeight });
    updateSize();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, viewMode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const displayedVideoRect = computeContainedImageRect(stageSize, videoSize);
  const effectiveFps = sourceFps && Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30;
  const currentFrameIndex = Math.max(0, Math.round(currentTime * effectiveFps));
  const geometryPrompts = promptHistory.filter((prompt): prompt is Extract<CloudPrompt, { kind: 'point' | 'box' }> => prompt.kind === 'point' || prompt.kind === 'box');

  const getNormalizedEventPoint = useCallback((e: React.MouseEvent, clampToImage = false) => {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const liveDisplayRect = computeContainedImageRect({ width: rect.width, height: rect.height }, videoSize);
    if (!liveDisplayRect) return null;

    const x = (e.clientX - rect.left - liveDisplayRect.left) / liveDisplayRect.width;
    const y = (e.clientY - rect.top - liveDisplayRect.top) / liveDisplayRect.height;

    if (!clampToImage && (x < 0 || x > 1 || y < 0 || y > 1)) return null;

    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
    };
  }, [videoSize]);

  const runSegmentation = useCallback(async (history: CloudPrompt[]) => {
    if (!remoteSourceUrl) return false;
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('Add your fal.ai API key in Settings before using SAM 3 cloud.');
      return false;
    }

    const textPromptValue = history
      .filter((prompt): prompt is TextCloudPrompt => prompt.kind === 'text')
      .map((prompt) => prompt.text.trim())
      .filter(Boolean)
      .join(', ');
    const pointPrompts = history
      .filter((prompt): prompt is PointCloudPrompt => prompt.kind === 'point')
      .map((prompt) => ({
        x: clamp(Math.round(prompt.x * videoSize.width), 0, videoSize.width),
        y: clamp(Math.round(prompt.y * videoSize.height), 0, videoSize.height),
        label: prompt.positive ? 1 : 0,
        frame_index: prompt.frameIndex ?? currentFrameIndex,
      }));
    const boxPrompts = history
      .filter((prompt): prompt is BoxCloudPrompt => prompt.kind === 'box')
      .map((prompt) => ({
        x_min: clamp(Math.round((prompt.x - prompt.w / 2) * videoSize.width), 0, videoSize.width),
        y_min: clamp(Math.round((prompt.y - prompt.h / 2) * videoSize.height), 0, videoSize.height),
        x_max: clamp(Math.round((prompt.x + prompt.w / 2) * videoSize.width), 0, videoSize.width),
        y_max: clamp(Math.round((prompt.y + prompt.h / 2) * videoSize.height), 0, videoSize.height),
        label: prompt.positive ? 1 : 0,
        frame_index: prompt.frameIndex ?? currentFrameIndex,
      }));

    if (!textPromptValue && pointPrompts.length === 0 && boxPrompts.length === 0) {
      setResultVideoUrl(null);
      return true;
    }

    setRunning(true);
    setError(null);
    try {
      const result = await window.electronAPI.workflow.run({
        apiKey,
        nodeId: 'sam3-cloud-video',
        nodeType: 'sam3-track-cloud',
        modelId: 'fal-ai/sam-3/video',
        inputs: {
          video_url: remoteSourceUrl,
          ...(textPromptValue ? { prompt: textPromptValue } : {}),
          ...(pointPrompts.length > 0 ? { point_prompts: pointPrompts } : {}),
          ...(boxPrompts.length > 0 ? { box_prompts: boxPrompts } : {}),
          apply_mask: true,
          detection_threshold: detectionThreshold,
        },
      }) as Record<string, unknown>;

      const video = result.video;
      const nextUrl = typeof video === 'string'
        ? video
        : (video && typeof video === 'object' && typeof (video as { url?: unknown }).url === 'string' ? (video as { url: string }).url : '');
      if (!nextUrl) throw new Error('SAM 3 video did not return a segmented video.');
      setResultVideoUrl(nextUrl);
      setViewMode('segmented');
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'SAM 3 video segmentation failed.');
      return false;
    } finally {
      setRunning(false);
    }
  }, [currentFrameIndex, detectionThreshold, remoteSourceUrl, videoSize.height, videoSize.width]);

  const handleTextSubmit = useCallback(async () => {
    if (autoSegmenting) return;
    const prompt = textPrompt.trim();
    if (!prompt) return;
    const nextHistory = [...promptHistory, { id: createPromptId(), kind: 'text' as const, text: prompt }];
    const ok = await runSegmentation(nextHistory);
    if (!ok) return;
    setPromptHistory(nextHistory);
    setTextPrompt('');
  }, [autoSegmenting, promptHistory, runSegmentation, textPrompt]);

  const submitGeometricPrompt = useCallback(async (prompt: Omit<Extract<CloudPrompt, { kind: 'point' | 'box' }>, 'id'>) => {
    const nextHistory = [...promptHistory, { ...prompt, id: createPromptId() }];
    const ok = await runSegmentation(nextHistory);
    if (!ok) return false;
    setPromptHistory(nextHistory);
    return true;
  }, [promptHistory, runSegmentation]);

  const handleCanvasClick = useCallback(async (e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'click' || running || viewMode !== 'source') return;
    sourceVideoRef.current?.pause();
    setPlaying(false);
    const point = getNormalizedEventPoint(e);
    if (!point) return;
    await submitGeometricPrompt({
      kind: 'point',
      positive: promptMode === 'add',
      x: point.x,
      y: point.y,
      w: 0.01,
      h: 0.01,
      frameIndex: currentFrameIndex,
    });
  }, [autoSegmenting, currentFrameIndex, getNormalizedEventPoint, promptMode, running, submitGeometricPrompt, toolMode, viewMode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'box' || running || viewMode !== 'source') return;
    e.preventDefault();
    sourceVideoRef.current?.pause();
    setPlaying(false);
    const point = getNormalizedEventPoint(e);
    if (!point) return;
    setBoxStart(point);
    setBoxEnd(point);
    setIsDrawing(true);
  }, [autoSegmenting, getNormalizedEventPoint, running, toolMode, viewMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing) return;
    const point = getNormalizedEventPoint(e, true);
    if (!point) return;
    setBoxEnd(point);
  }, [autoSegmenting, getNormalizedEventPoint, isDrawing]);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing || !boxStart) {
      setIsDrawing(false);
      return;
    }
    const nextBoxEnd = getNormalizedEventPoint(e, true) ?? boxEnd;
    if (!nextBoxEnd) {
      setIsDrawing(false);
      setBoxStart(null);
      setBoxEnd(null);
      return;
    }
    const w = Math.abs(nextBoxEnd.x - boxStart.x);
    const h = Math.abs(nextBoxEnd.y - boxStart.y);
    if (w > 0.01 && h > 0.01) {
      await submitGeometricPrompt({
        kind: 'box',
        positive: promptMode === 'add',
        x: (boxStart.x + nextBoxEnd.x) / 2,
        y: (boxStart.y + nextBoxEnd.y) / 2,
        w,
        h,
        frameIndex: currentFrameIndex,
      });
    }
    setIsDrawing(false);
    setBoxStart(null);
    setBoxEnd(null);
  }, [autoSegmenting, boxEnd, boxStart, currentFrameIndex, getNormalizedEventPoint, isDrawing, promptMode, submitGeometricPrompt]);

  const handleUndo = useCallback(async () => {
    const nextHistory = promptHistory.slice(0, -1);
    setPromptHistory(nextHistory);
    await runSegmentation(nextHistory);
  }, [promptHistory, runSegmentation]);

  const handleClear = useCallback(() => {
    setPromptHistory([]);
    setResultVideoUrl(null);
    setTextPrompt('');
    setViewMode('source');
  }, []);

  const handleAutoSegment = useCallback(async () => {
    if (loading || running || autoSegmenting) return;

    setAutoSegmenting(true);
    try {
      sourceVideoRef.current?.pause();
      setPlaying(false);

      const frameSource = await getAutoSegmentFrameSource({
        sourceUrl,
        timeSec: currentTime,
        videoEl: viewMode === 'source' ? sourceVideoRef.current : null,
      });
      if (!frameSource) {
        throw new Error('Could not capture the current frame for Auto Segment. Switch to Source Frame and try again.');
      }

      const detectedObjects = sortAutoSegmentObjectsForPrompting(await detectAutoSegmentObjects(frameSource, {
        context: 'Create-space SAM3 cloud video auto segmentation on the current frame',
        maxObjects: 6,
      }));
      if (detectedObjects.length === 0) {
        window.alert('Auto Segment could not find any distinct objects on this frame.');
        return;
      }

      const labelPrompt = buildAutoSegmentLabelPrompt(detectedObjects.map((detectedObject) => detectedObject.label));
      const nextHistory: CloudPrompt[] = [];
      if (labelPrompt) {
        nextHistory.push({
          id: createPromptId(),
          kind: 'text',
          text: labelPrompt,
        });
      }
      nextHistory.push(...detectedObjects.map((detectedObject) => {
        const [x, y, w, h] = detectedObject.box;
        return {
          id: createPromptId(),
          kind: 'box' as const,
          positive: true,
          x,
          y,
          w,
          h,
          frameIndex: currentFrameIndex,
        };
      }));
      const ok = await runSegmentation(nextHistory);
      if (!ok) return;
      setPromptHistory(nextHistory);
      setTextPrompt('');
      setToolMode('box');
    } catch (nextError) {
      console.error('[sam3-cloud-video] Auto segment error:', nextError);
      window.alert(nextError instanceof Error ? nextError.message : 'Auto Segment failed.');
    } finally {
      setAutoSegmenting(false);
    }
  }, [autoSegmenting, currentFrameIndex, currentTime, loading, runSegmentation, running, sourceUrl, viewMode]);

  const togglePlayback = useCallback(() => {
    const video = viewMode === 'segmented' ? resultVideoRef.current : sourceVideoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }, [viewMode]);

  const drawBoxStyle = isDrawing && boxStart && boxEnd && displayedVideoRect && stageSize.width && stageSize.height
    ? {
        left: `${((displayedVideoRect.left + Math.min(boxStart.x, boxEnd.x) * displayedVideoRect.width) / stageSize.width) * 100}%`,
        top: `${((displayedVideoRect.top + Math.min(boxStart.y, boxEnd.y) * displayedVideoRect.height) / stageSize.height) * 100}%`,
        width: `${(Math.abs(boxEnd.x - boxStart.x) * displayedVideoRect.width / stageSize.width) * 100}%`,
        height: `${(Math.abs(boxEnd.y - boxStart.y) * displayedVideoRect.height / stageSize.height) * 100}%`,
      }
    : null;

  const promptOverlay = (
    <div className="sam3__prompt-overlay">
      {geometryPrompts.map((prompt) => {
        if (!displayedVideoRect || !stageSize.width || !stageSize.height || viewMode !== 'source') return null;
        if (prompt.kind === 'point') {
          const left = displayedVideoRect.left + prompt.x * displayedVideoRect.width;
          const top = displayedVideoRect.top + prompt.y * displayedVideoRect.height;
          return (
            <div
              key={prompt.id}
              className={`sam3__prompt-point ${prompt.positive ? 'is-positive' : 'is-negative'}`}
              style={{
                left: `${(left / stageSize.width) * 100}%`,
                top: `${(top / stageSize.height) * 100}%`,
              }}
            >
              {prompt.positive ? '+' : '–'}
            </div>
          );
        }
        return (
          <div
            key={prompt.id}
            className={`sam3__prompt-box ${prompt.positive ? 'is-positive' : 'is-negative'}`}
            style={{
              left: `${((displayedVideoRect.left + (prompt.x - prompt.w / 2) * displayedVideoRect.width) / stageSize.width) * 100}%`,
              top: `${((displayedVideoRect.top + (prompt.y - prompt.h / 2) * displayedVideoRect.height) / stageSize.height) * 100}%`,
              width: `${(prompt.w * displayedVideoRect.width / stageSize.width) * 100}%`,
              height: `${(prompt.h * displayedVideoRect.height / stageSize.height) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );

  if (error) {
    return (
      <div className="sam3__error-card">
        <div className="sam3__error-icon">!</div>
        <h3>SAM 3 Cloud Error</h3>
        <p>{error}</p>
        <button className="sam3__btn sam3__btn--ghost" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className="sam3">
      <button className="sam3__close" onClick={onClose} aria-label="Close">
        <IconClose />
      </button>

      <div className="sam3__header">
        <span className="sam3__badge">SAM 3</span>
        <span className="sam3__header-label">Cloud Video Segmentation</span>
      </div>

      <div className="sam3__canvas-area">
        <div className="sam3__toolbar">
          <div className="sam3__tool-group">
            <button className={`sam3__tool-btn ${toolMode === 'text' ? 'is-active' : ''}`} onClick={() => setToolMode('text')}>
              <IconText />
              <span>Text</span>
            </button>
            <button className={`sam3__tool-btn ${toolMode === 'click' ? 'is-active' : ''}`} onClick={() => setToolMode('click')}>
              <IconClick />
              <span>Click</span>
            </button>
            <button className={`sam3__tool-btn ${toolMode === 'box' ? 'is-active' : ''}`} onClick={() => setToolMode('box')}>
              <IconBox />
              <span>Box</span>
            </button>
            <button className="sam3__tool-btn" onClick={() => void handleAutoSegment()} disabled={loading || running || autoSegmenting}>
              <IconAuto />
              <span>{autoSegmenting ? 'Scanning' : 'Auto'}</span>
            </button>
          </div>

          {toolMode !== 'text' && (
            <>
              <div className="sam3__toolbar-divider" />
              <div className="sam3__tool-group">
                <button className={`sam3__mode-btn ${promptMode === 'add' ? 'is-active is-add' : ''}`} onClick={() => setPromptMode('add')}>
                  <span className="sam3__mode-dot is-add" />
                  Add
                </button>
                <button className={`sam3__mode-btn ${promptMode === 'subtract' ? 'is-active is-sub' : ''}`} onClick={() => setPromptMode('subtract')}>
                  <span className="sam3__mode-dot is-sub" />
                  Remove
                </button>
              </div>
            </>
          )}

          <div className="sam3__toolbar-spacer" />

          <div className="sam3__tool-group">
            <button className="sam3__icon-btn" onClick={togglePlayback} title={playing ? 'Pause' : 'Play'} disabled={loading}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button className="sam3__icon-btn" onClick={() => void handleUndo()} title="Undo last prompt" disabled={promptHistory.length === 0 || running || autoSegmenting}>
              <IconUndo />
            </button>
            <button className="sam3__icon-btn" onClick={handleClear} title="Clear all" disabled={promptHistory.length === 0 || running || autoSegmenting}>
              <IconClear />
            </button>
          </div>
        </div>

        {toolMode === 'text' && (
          <div className="sam3__text-bar">
            <div className="sam3__text-input-wrap">
              <input
                type="text"
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleTextSubmit()}
                placeholder="Describe what to track: person, bicycle, sign..."
                disabled={autoSegmenting}
                autoFocus
              />
            </div>
            <button className="sam3__btn sam3__btn--accent" onClick={() => void handleTextSubmit()} disabled={running || autoSegmenting || !textPrompt.trim()}>
              {autoSegmenting ? 'Scanning…' : 'Track'}
            </button>
          </div>
        )}

        <div className="sam3__stage-wrap">
          {loading ? (
            <div className="sam3__loading">
              <Spinner />
              <span>Preparing cloud SAM 3...</span>
            </div>
          ) : (
            <div
              ref={canvasRef}
              className={`sam3__stage ${toolMode !== 'text' && viewMode === 'source' ? 'cursor-crosshair' : ''}`}
              onClick={(e) => void handleCanvasClick(e)}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={(e) => void handleMouseUp(e)}
            >
              {viewMode === 'segmented' && resultVideoUrl ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  ref={resultVideoRef}
                  src={resultVideoUrl}
                  className="sam3__video"
                  playsInline
                  onLoadedMetadata={(e) => {
                    const element = e.currentTarget;
                    setDuration(element.duration || 0);
                  }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
              ) : (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  ref={sourceVideoRef}
                  src={sourceUrl}
                  className="sam3__video"
                  playsInline
                  onLoadedMetadata={(e) => {
                    const element = e.currentTarget;
                    setVideoSize({ width: element.videoWidth || 0, height: element.videoHeight || 0 });
                    setDuration(element.duration || 0);
                  }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
              )}
              {promptOverlay}
              {drawBoxStyle && viewMode === 'source' && <div className="sam3__draw-box" style={drawBoxStyle} />}
            </div>
          )}
        </div>

        <div className="sam3__video-controls">
          <button className="sam3__btn sam3__btn--ghost" onClick={togglePlayback} disabled={loading}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={currentTime}
            onChange={(e) => {
              const nextTime = Number(e.target.value);
              setCurrentTime(nextTime);
              if (viewMode === 'source' && sourceVideoRef.current) sourceVideoRef.current.currentTime = nextTime;
              if (viewMode === 'segmented' && resultVideoRef.current) resultVideoRef.current.currentTime = nextTime;
            }}
            disabled={loading || duration <= 0}
          />
          <span className="sam3__slider-val">{Math.round(currentFrameIndex)}f</span>
        </div>

        <div className="sam3__view-tabs">
          {(['source', 'segmented'] as VideoViewMode[]).map((mode) => (
            <button
              key={mode}
              className={`sam3__view-tab ${viewMode === mode ? 'is-active' : ''}`}
              onClick={() => setViewMode(mode)}
              disabled={mode === 'segmented' && !resultVideoUrl}
            >
              {mode === 'source' ? 'Source Frame' : 'Segmented Video'}
            </button>
          ))}
        </div>
      </div>

      <div className="sam3__sidebar">
        <div className="sam3__panel">
          <button className="sam3__panel-header" onClick={() => setSectionsOpen((prev) => ({ ...prev, prompts: !prev.prompts }))}>
            <IconLayers />
            <span className="sam3__panel-title">Prompts</span>
            {promptHistory.length > 0 && <span className="sam3__panel-count">{promptHistory.length}</span>}
            <IconChevron open={sectionsOpen.prompts} />
          </button>
          {sectionsOpen.prompts && (
            <div className="sam3__panel-body">
              {promptHistory.length === 0 ? (
                <div className="sam3__panel-empty">Add a text prompt, click, or draw a box on the frame to track something.</div>
              ) : (
                <div className="sam3__segment-list">
                  {promptHistory.map((prompt) => (
                    <div key={prompt.id} className="sam3__segment-item">
                      <div className="sam3__segment-swatch" style={{ background: prompt.kind === 'text' ? '#d4a054' : (prompt.positive ? '#5cb87a' : '#cf7d60') }} />
                      <span className="sam3__segment-name">
                        {prompt.kind === 'text'
                          ? prompt.text
                          : `${prompt.kind === 'point' ? 'Point' : 'Box'} • ${prompt.positive ? 'Add' : 'Remove'} • frame ${prompt.frameIndex ?? currentFrameIndex}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sam3__panel">
          <button className="sam3__panel-header" onClick={() => setSectionsOpen((prev) => ({ ...prev, tracking: !prev.tracking }))}>
            <IconSliders />
            <span className="sam3__panel-title">Tracking</span>
            <IconChevron open={sectionsOpen.tracking} />
          </button>
          {sectionsOpen.tracking && (
            <div className="sam3__panel-body">
              <div className="sam3__slider-group">
                <div className="sam3__slider-row">
                  <label>Detection Threshold</label>
                  <span className="sam3__slider-val">{detectionThreshold.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={detectionThreshold} onChange={(e) => setDetectionThreshold(Number(e.target.value))} />
              </div>
              <div className="sam3__slider-group">
                <div className="sam3__slider-row">
                  <label>FPS</label>
                  <span className="sam3__slider-val">{effectiveFps.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sam3__sidebar-spacer" />

        <div className="sam3__actions">
          <button className="sam3__btn sam3__btn--ghost" onClick={onClose}>Cancel</button>
          <button className="sam3__btn sam3__btn--accent" onClick={() => resultVideoUrl && onAcceptSelected({ url: resultVideoUrl })} disabled={!resultVideoUrl || running}>
            Accept Video
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sam3CloudModal(props: Sam3CloudModalProps) {
  return createPortal(
    <div className="sam3__backdrop">
      {props.sourceKind === 'image' ? (
        <ImageSegmentationPane
          sourceUrl={props.sourceUrl}
          onAcceptSelected={props.onAcceptSelected}
          onAcceptAll={props.onAcceptAll}
          onClose={props.onClose}
        />
      ) : (
        <VideoSegmentationPane
          sourceUrl={props.sourceUrl}
          sourceFps={props.sourceFps}
          onAcceptSelected={props.onAcceptSelected}
          onClose={props.onClose}
        />
      )}
    </div>,
    document.body,
  );
}
