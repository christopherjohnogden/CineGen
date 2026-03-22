import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ImageCompare } from './image-compare';
import { detectAutoSegmentObjects, sortAutoSegmentObjectsForPrompting } from '@/lib/vision/auto-segment';

interface Sam3ModalProps {
  imageUrl: string;
  onAcceptSelected: (result: { url: string }) => void;
  onAcceptAll: (result: { layers: Array<{ url: string; name: string; type: string; z_order: number }> }) => void;
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
type ViewMode = 'overlay' | 'cutout' | 'compare';

type LocalPrompt =
  | {
      id: string;
      kind: 'text';
      text: string;
    }
  | {
      id: string;
      kind: 'point' | 'box';
      positive: boolean;
      x: number;
      y: number;
      w: number;
      h: number;
    };

const SEGMENT_COLORS = [
  'rgba(212, 160, 84, 0.45)',   // gold
  'rgba(91, 143, 212, 0.45)',   // blue
  'rgba(92, 184, 122, 0.45)',   // green
  'rgba(207, 125, 96, 0.45)',   // coral
  'rgba(160, 108, 213, 0.45)',  // purple
  'rgba(224, 192, 96, 0.45)',   // yellow
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
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
}

function buildMaskOverlayDataUri(maskDataUri: string, fillColor: string, imageSize: ImageSize): string {
  if (!imageSize.width || !imageSize.height) return maskDataUri;

  const width = imageSize.width;
  const height = imageSize.height;
  const maskHref = escapeXmlAttribute(maskDataUri);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs>
        <mask id="sam3-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" style="mask-type:luminance">
          <image href="${maskHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" />
        </mask>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="${fillColor}" mask="url(#sam3-mask)" />
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 64)}`));
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

function buildMaskAlpha(maskData: ImageData): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(maskData.width * maskData.height);
  let hasRgbMaskSignal = false;

  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    const rgbMax = Math.max(
      maskData.data[offset] ?? 0,
      maskData.data[offset + 1] ?? 0,
      maskData.data[offset + 2] ?? 0,
    );
    if (rgbMax > 0) {
      hasRgbMaskSignal = true;
      break;
    }
  }

  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    const rgbMax = Math.max(
      maskData.data[offset] ?? 0,
      maskData.data[offset + 1] ?? 0,
      maskData.data[offset + 2] ?? 0,
    );
    alpha[i] = hasRgbMaskSignal ? rgbMax : (maskData.data[offset + 3] ?? 0);
  }
  return alpha;
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

async function buildCutoutPreviewDataUri(imageUrl: string, maskDataUri: string, imageSize: ImageSize): Promise<string> {
  const width = imageSize.width || undefined;
  const height = imageSize.height || undefined;
  const [sourceData, maskData] = await Promise.all([
    loadImageData(imageUrl, width, height),
    loadImageData(maskDataUri, width, height),
  ]);
  const alpha = buildMaskAlpha(maskData);
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

/* ── Icons ── */
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

/* ── Spinner ── */
const Spinner = () => (
  <div className="sam3__spinner">
    <div className="sam3__spinner-ring" />
  </div>
);

export function Sam3Modal({ imageUrl, onAcceptSelected, onAcceptAll, onClose }: Sam3ModalProps) {
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('text');
  const [promptMode, setPromptMode] = useState<PromptMode>('add');
  const [viewMode, setViewMode] = useState<ViewMode>('overlay');
  const [textPrompt, setTextPrompt] = useState('');
  const [masks, setMasks] = useState<MaskData[]>([]);
  const [promptHistory, setPromptHistory] = useState<LocalPrompt[]>([]);
  const [selectedMask, setSelectedMask] = useState(0);
  const [imageSize, setImageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [selectedCutoutPreviewUrl, setSelectedCutoutPreviewUrl] = useState<string | null>(null);
  const [isCutoutPreviewLoading, setIsCutoutPreviewLoading] = useState(false);
  const [autoSegmenting, setAutoSegmenting] = useState(false);

  // Post-processing
  const [blur, setBlur] = useState(2);
  const [feather, setFeather] = useState(4);
  const [threshold, setThreshold] = useState(0.5);
  const [confidence, setConfidence] = useState(0.3);

  // Box drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);

  // Collapsible sidebar sections
  const [sectionsOpen, setSectionsOpen] = useState({ segments: true, postProcessing: true });

  const canvasRef = useRef<HTMLDivElement>(null);

  const apiUrl = serverPort ? `http://localhost:${serverPort}` : null;
  const selectedMaskData = masks[selectedMask];
  const displayedImageRect = computeContainedImageRect(stageSize, imageSize);
  const geometryPrompts = promptHistory.filter((prompt): prompt is Extract<LocalPrompt, { kind: 'point' | 'box' }> => (
    prompt.kind === 'point' || prompt.kind === 'box'
  ));

  const toggleSection = (key: keyof typeof sectionsOpen) => {
    setSectionsOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Start server + load image
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        console.log('[sam3-modal] Starting SAM 3 server...');
        const { port } = await window.electronAPI.sam3.start();
        console.log('[sam3-modal] Server started on port:', port);
        if (cancelled) return;
        setServerPort(port);

        await new Promise(r => setTimeout(r, 1000));
        if (cancelled) return;

        let imagePath = imageUrl;
        if (imageUrl.startsWith('local-media://file')) {
          imagePath = decodeURIComponent(imageUrl.replace('local-media://file', ''));
        }

        const res = await fetch(`http://localhost:${port}/set-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            imagePath.startsWith('http') ? { image_url: imagePath } : { image_path: imagePath }
          ),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load image');
        setImageSize({ width: data.width, height: data.height });
        await fetch(`http://localhost:${port}/segment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'confidence', threshold: 0.3 }),
        });
        setLoading(false);
      } catch (e) {
        console.error('[sam3-modal] Error:', e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to start SAM 3 server');
      }
    })();
    return () => { cancelled = true; };
  }, [imageUrl]);

  useEffect(() => {
    if (masks.length === 0) {
      if (selectedMask !== 0) setSelectedMask(0);
      return;
    }
    if (selectedMask >= masks.length) {
      setSelectedMask(masks.length - 1);
    }
  }, [masks.length, selectedMask]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedMaskData) {
      setSelectedCutoutPreviewUrl(null);
      setIsCutoutPreviewLoading(false);
      return;
    }

    setIsCutoutPreviewLoading(true);
    buildCutoutPreviewDataUri(imageUrl, selectedMaskData.dataUri, imageSize)
      .then((nextUrl) => {
        if (cancelled) return;
        setSelectedCutoutPreviewUrl(nextUrl);
        setIsCutoutPreviewLoading(false);
      })
      .catch((nextError) => {
        console.error('[sam3-modal] Cutout preview error:', nextError);
        if (cancelled) return;
        setSelectedCutoutPreviewUrl(null);
        setIsCutoutPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, imageSize.width, imageSize.height, selectedMaskData?.dataUri]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const updateSize = () => {
      setStageSize({ width: el.clientWidth, height: el.clientHeight });
    };

    updateSize();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [loading, viewMode]);

  // Keyboard: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const getNormalizedEventPoint = useCallback((e: React.MouseEvent, clampToImage = false) => {
    const el = canvasRef.current;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const liveDisplayRect = computeContainedImageRect({ width: rect.width, height: rect.height }, imageSize);
    if (!liveDisplayRect) return null;

    const x = (e.clientX - rect.left - liveDisplayRect.left) / liveDisplayRect.width;
    const y = (e.clientY - rect.top - liveDisplayRect.top) / liveDisplayRect.height;

    if (!clampToImage && (x < 0 || x > 1 || y < 0 || y > 1)) {
      return null;
    }

    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
    };
  }, [imageSize]);

  const callSegment = useCallback(async (body: Record<string, unknown>) => {
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Segment failed');
      setMasks(data.masks.map((m: string, i: number) => ({
        dataUri: m,
        box: data.boxes[i] ?? [],
        score: data.scores[i] ?? 0,
      })));
      return data;
    } catch (e) {
      console.error('[sam3-modal] Segment error:', e);
      return null;
    }
  }, [apiUrl]);

  const handleTextSubmit = useCallback(async () => {
    if (autoSegmenting) return;
    if (!textPrompt.trim()) return;
    const prompt = textPrompt.trim();
    const data = await callSegment({ type: 'text', prompt });
    if (!data) return;
    setPromptHistory((prev) => [
      ...prev,
      { id: createPromptId(), kind: 'text', text: prompt },
    ]);
  }, [autoSegmenting, textPrompt, callSegment]);

  const submitGeometricPrompt = useCallback(async (
    prompt: Omit<Extract<LocalPrompt, { kind: 'point' | 'box' }>, 'id'>,
  ) => {
    const data = await callSegment({
      type: 'box',
      box: [prompt.x, prompt.y, prompt.w, prompt.h],
      label: prompt.positive,
    });
    if (!data) return false;
    setPromptHistory((prev) => [
      ...prev,
      { ...prompt, id: createPromptId() },
    ]);
    return true;
  }, [callSegment]);

  const handleCanvasClick = useCallback(async (e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'click') return;
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
  }, [autoSegmenting, toolMode, promptMode, imageSize.width, imageSize.height, getNormalizedEventPoint, submitGeometricPrompt]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (toolMode !== 'box') return;
    e.preventDefault();
    const point = getNormalizedEventPoint(e);
    if (!point) return;
    setBoxStart(point);
    setBoxEnd(point);
    setIsDrawing(true);
  }, [autoSegmenting, toolMode, getNormalizedEventPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing) return;
    const point = getNormalizedEventPoint(e, true);
    if (!point) return;
    setBoxEnd(point);
  }, [autoSegmenting, isDrawing, getNormalizedEventPoint]);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (autoSegmenting) return;
    if (!isDrawing || !boxStart) { setIsDrawing(false); return; }
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
  }, [autoSegmenting, isDrawing, boxStart, boxEnd, promptMode, getNormalizedEventPoint, submitGeometricPrompt]);

  const handleUndo = useCallback(async () => {
    const data = await callSegment({ type: 'undo' });
    if (!data) return;
    setPromptHistory((prev) => prev.slice(0, -1));
  }, [callSegment]);
  const handleClear = useCallback(async () => {
    const data = await callSegment({ type: 'reset' });
    if (!data) return;
    setPromptHistory([]);
    setMasks([]);
  }, [callSegment]);

  const handleConfidenceChange = useCallback((val: number) => {
    setConfidence(val);
    callSegment({ type: 'confidence', threshold: val });
  }, [callSegment]);

  const handleAutoSegment = useCallback(async () => {
    if (!apiUrl || loading || autoSegmenting) return;

    setAutoSegmenting(true);
    try {
      const detectedObjects = sortAutoSegmentObjectsForPrompting(await detectAutoSegmentObjects(imageUrl, {
        context: 'Create-space SAM3 image auto segmentation',
        maxObjects: 6,
      }));
      if (detectedObjects.length === 0) {
        window.alert('Auto Segment could not find any distinct objects in this image.');
        return;
      }

      const resetData = await callSegment({ type: 'reset' });
      if (!resetData) throw new Error('Could not reset the current SAM 3 session.');

      const labelPrompt = buildAutoSegmentLabelPrompt(detectedObjects.map((detectedObject) => detectedObject.label));
      if (labelPrompt) {
        const textSeed = await callSegment({ type: 'text', prompt: labelPrompt });
        if (!textSeed) throw new Error('SAM 3 could not seed the auto-seg text prompt.');
      }

      const nextPrompts: Array<{
        id: string;
        kind: 'text' | 'box';
        text?: string;
        positive?: boolean;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
      }> = [];
      if (labelPrompt) {
        nextPrompts.push({
          id: createPromptId(),
          kind: 'text',
          text: labelPrompt,
        });
      }
      for (const detectedObject of detectedObjects) {
        const [x, y, w, h] = detectedObject.box;
        const ok = await callSegment({
          type: 'box',
          box: [x, y, w, h],
          label: true,
        });
        if (!ok) {
          throw new Error(`SAM 3 could not segment "${detectedObject.label}".`);
        }
        nextPrompts.push({
          id: createPromptId(),
          kind: 'box',
          positive: true,
          x,
          y,
          w,
          h,
        });
      }

      setPromptHistory(nextPrompts as LocalPrompt[]);
      setSelectedMask(0);
      setTextPrompt('');
      setToolMode('box');
      setViewMode('overlay');
    } catch (nextError) {
      console.error('[sam3-modal] Auto segment error:', nextError);
      window.alert(nextError instanceof Error ? nextError.message : 'Auto Segment failed.');
    } finally {
      setAutoSegmenting(false);
    }
  }, [apiUrl, autoSegmenting, callSegment, imageUrl, loading]);

  const handleAcceptSelected = useCallback(async () => {
    if (!apiUrl || masks.length === 0) return;
    const res = await fetch(`${apiUrl}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mask_indices: [selectedMask], blur, feather, threshold }),
    });
    const data = await res.json();
    if (data.layers?.length > 1) {
      const cutoutPath = data.layers[1]?.path;
      if (cutoutPath) {
        onAcceptSelected({ url: `local-media://file${cutoutPath}` });
      }
    }
  }, [apiUrl, masks, selectedMask, blur, feather, threshold, onAcceptSelected]);

  const handleAcceptAll = useCallback(async () => {
    if (!apiUrl || masks.length === 0) return;
    const allIndices = masks.map((_, i) => i);
    const res = await fetch(`${apiUrl}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mask_indices: allIndices, blur, feather, threshold }),
    });
    const data = await res.json();
    if (data.layers?.length > 0) {
      const layers = data.layers.map((l: any) => ({
        url: `local-media://file${l.path}`,
        name: l.name,
        type: l.type,
        z_order: l.z_order,
      }));
      onAcceptAll({ layers });
    }
  }, [apiUrl, masks, blur, feather, threshold, onAcceptAll]);

  /* ── Error state ── */
  if (error) {
    return createPortal(
      <div className="sam3__backdrop">
        <div className="sam3__error-card">
          <div className="sam3__error-icon">!</div>
          <h3>SAM 3 Error</h3>
          <p>{error}</p>
          <button className="sam3__btn sam3__btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>,
      document.body,
    );
  }

  const selectedMaskOverlayUrl = selectedMaskData
    ? buildMaskOverlayDataUri(
        selectedMaskData.dataUri,
        SEGMENT_COLORS[selectedMask % SEGMENT_COLORS.length],
        imageSize,
      )
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
              {prompt.positive ? '+' : '\u2013'}
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

  const stageContent = (() => {
    if (loading) {
      return (
        <div className="sam3__loading">
          <Spinner />
          <span>Initializing SAM 3 model&hellip;</span>
        </div>
      );
    }
    if (viewMode === 'overlay') {
      return (
        <div
          ref={canvasRef}
          className={`sam3__stage ${toolMode !== 'text' ? 'cursor-crosshair' : ''}`}
          onClick={handleCanvasClick}
          onDragStart={(e) => e.preventDefault()}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Source" className="sam3__source-img" draggable={false} onDragStart={(e) => e.preventDefault()} />
          {selectedMaskOverlayUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selectedMaskOverlayUrl} alt={`Mask ${selectedMask + 1}`} className="sam3__mask-img" draggable={false} onDragStart={(e) => e.preventDefault()} />
          )}
          {promptOverlay}
          {drawBoxStyle && <div className="sam3__draw-box" style={drawBoxStyle} />}
        </div>
      );
    }
    if (viewMode === 'cutout') {
      return (
        <div ref={canvasRef} className="sam3__stage sam3__stage--checker">
          {selectedCutoutPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selectedCutoutPreviewUrl} alt={`Cutout ${selectedMask + 1}`} className="sam3__cutout-img" draggable={false} onDragStart={(e) => e.preventDefault()} />
          ) : (
            <div className="sam3__empty">
              {isCutoutPreviewLoading ? 'Generating cutout\u2026' : 'Select a segment to preview'}
            </div>
          )}
        </div>
      );
    }
    // compare
    return (
      <div ref={canvasRef} className="sam3__stage sam3__stage--checker">
        {selectedCutoutPreviewUrl ? (
          <ImageCompare beforeUrl={imageUrl} afterUrl={selectedCutoutPreviewUrl} className="sam3__compare" dragHandleOnly />
        ) : (
          <div className="sam3__empty">
            {isCutoutPreviewLoading ? 'Generating cutout\u2026' : 'Select a segment to preview'}
          </div>
        )}
      </div>
    );
  })();

  return createPortal(
    <div className="sam3__backdrop">
      <div className="sam3">
        {/* ── Close button ── */}
        <button className="sam3__close" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>

        {/* ── Header badge ── */}
        <div className="sam3__header">
          <span className="sam3__badge">SAM 3</span>
          <span className="sam3__header-label">Segment Anything</span>
        </div>

        {/* ── Main canvas area ── */}
        <div className="sam3__canvas-area">
          {/* Floating toolbar */}
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
              <button className="sam3__tool-btn" onClick={() => void handleAutoSegment()} title="Detect and segment objects automatically" disabled={loading || autoSegmenting}>
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
              <button className="sam3__icon-btn" onClick={handleUndo} title="Undo last prompt" disabled={promptHistory.length === 0 || autoSegmenting}>
                <IconUndo />
              </button>
              <button className="sam3__icon-btn" onClick={handleClear} title="Clear all" disabled={promptHistory.length === 0 || autoSegmenting}>
                <IconClear />
              </button>
            </div>
          </div>

          {/* Text prompt input */}
          {toolMode === 'text' && (
            <div className="sam3__text-bar">
              <div className="sam3__text-input-wrap">
                <input
                  type="text"
                  value={textPrompt}
                  onChange={(e) => setTextPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
                  placeholder="Describe what to segment: person, car, sky&hellip;"
                  disabled={autoSegmenting}
                  autoFocus
                />
              </div>
              <button className="sam3__btn sam3__btn--accent" onClick={handleTextSubmit} disabled={autoSegmenting || !textPrompt.trim()}>
                {autoSegmenting ? 'Scanning…' : 'Segment'}
              </button>
            </div>
          )}

          {/* Image stage */}
          <div className="sam3__stage-wrap">
            {stageContent}
          </div>

          {/* View mode tabs */}
          <div className="sam3__view-tabs">
            {(['overlay', 'cutout', 'compare'] as ViewMode[]).map((mode) => (
              <button key={mode} className={`sam3__view-tab ${viewMode === mode ? 'is-active' : ''}`} onClick={() => setViewMode(mode)}>
                {mode === 'overlay' ? 'Original + Mask' : mode === 'cutout' ? 'Cutout' : 'Compare'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="sam3__sidebar">
          {/* Segments section */}
          <div className="sam3__panel">
            <button className="sam3__panel-header" onClick={() => toggleSection('segments')}>
              <IconLayers />
              <span className="sam3__panel-title">Segments</span>
              {masks.length > 0 && <span className="sam3__panel-count">{masks.length}</span>}
              <IconChevron open={sectionsOpen.segments} />
            </button>
            {sectionsOpen.segments && (
              <div className="sam3__panel-body">
                {masks.length === 0 ? (
                  <div className="sam3__panel-empty">No segments yet. Use the tools above to segment the image.</div>
                ) : (
                  <div className="sam3__segment-list">
                    {masks.map((mask, i) => (
                      <button
                        key={i}
                        className={`sam3__segment-item ${i === selectedMask ? 'is-selected' : ''}`}
                        onClick={() => setSelectedMask(i)}
                      >
                        <div className="sam3__segment-swatch" style={{ background: SEGMENT_SOLID_COLORS[i % SEGMENT_SOLID_COLORS.length] }} />
                        <span className="sam3__segment-name">Segment {i + 1}</span>
                        <span className="sam3__segment-score">{Math.round(mask.score * 100)}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Post-processing section */}
          <div className="sam3__panel">
            <button className="sam3__panel-header" onClick={() => toggleSection('postProcessing')}>
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
                  <input type="range" min={0} max={1} step={0.05} value={confidence} onChange={(e) => handleConfidenceChange(Number(e.target.value))} />
                </div>
              </div>
            )}
          </div>

          {/* Spacer pushes actions to bottom */}
          <div className="sam3__sidebar-spacer" />

          {/* Actions */}
          <div className="sam3__actions">
            <button className="sam3__btn sam3__btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="sam3__btn sam3__btn--accent" onClick={handleAcceptSelected} disabled={masks.length === 0}>
              Accept Selected
            </button>
            <button className="sam3__btn sam3__btn--outline" onClick={handleAcceptAll} disabled={masks.length === 0}>
              Accept All Layers
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
