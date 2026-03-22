import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { getApiKey, getKieApiKey } from '@/lib/utils/api-key';
import { toFileUrl } from '@/lib/utils/file-url';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import type { Asset } from '@/types/project';

/* ── Duration snap per model ── */
const MODEL_DURATIONS: Record<string, number[]> = {
  'kie-kling3':       [3, 5, 8, 10, 15],
  'kling-3-image':    [3, 5, 8, 10, 15],
  'kling-first-last': [5, 10],
  'kie-wan':          [5, 10, 15],
  'kie-seedance2':    [4, 5, 8, 12, 15],
  'kie-runway':       [5, 10],
  'ltx-2-video':      [6, 8, 10],
};

function snapDuration(sec: number, modelId: string): number {
  if (modelId === 'sora-2') {
    return Math.min(20, Math.max(2, Math.round(sec)));
  }
  if (modelId === 'wan-2-2') {
    return 5;
  }
  const opts = MODEL_DURATIONS[modelId] ?? [5, 10];
  for (const opt of opts) {
    if (opt >= sec) return opt;
  }
  return opts[opts.length - 1];
}

const EXTEND_MODELS = [
  { id: 'kie-kling3',       name: 'Kling 3.0' },
  { id: 'kling-3-image',    name: 'Kling 3 (fal)' },
  { id: 'kling-first-last', name: 'Kling First & Last' },
  { id: 'kie-wan',          name: 'Wan 2.6 Flash' },
  { id: 'wan-2-2',          name: 'Wan 2.2' },
  { id: 'kie-seedance2',    name: 'Seedance 2' },
  { id: 'kie-runway',       name: 'Runway Gen-4' },
  { id: 'sora-2',           name: 'Sora 2' },
  { id: 'ltx-2-video',      name: 'LTX 2' },
];

function buildModelInputs(
  modelId: string,
  direction: 'before' | 'after',
  frameUrl: string,
  prompt: string,
  duration: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = { prompt: prompt.trim() };

  if (modelId === 'wan-2-2') {
    base.num_frames = 81;
  } else if (modelId === 'sora-2') {
    base.duration = duration;
  } else {
    base.duration = String(duration);
  }

  if (modelId !== 'wan-2-2' && modelId !== 'sora-2') {
    base.aspect_ratio = '16:9';
  }

  if (direction === 'after') {
    if (modelId === 'kie-kling3')           { base.image_urls = [frameUrl]; }
    else if (modelId === 'kling-3-image')   { base.start_image_url = frameUrl; }
    else if (modelId === 'kling-first-last') { base.image_url = frameUrl; }
    else if (modelId === 'kie-wan')         { base.image_urls = [frameUrl]; }
    else if (modelId === 'wan-2-2')         { base.image_url = frameUrl; }
    else if (modelId === 'kie-seedance2')   { base.urls = [frameUrl]; }
    else if (modelId === 'kie-runway')      { base.imageUrl = frameUrl; }
    else if (modelId === 'sora-2')          { base.image_url = frameUrl; }
    else if (modelId === 'ltx-2-video')     { base.image_url = frameUrl; }
  } else {
    if (modelId === 'kling-3-image')        { base.end_image_url = frameUrl; }
    else if (modelId === 'kling-first-last') { base.tail_image_url = frameUrl; }
    else if (modelId === 'kie-kling3')      { base.image_urls = [frameUrl]; }
    else if (modelId === 'kie-wan')         { base.image_urls = [frameUrl]; }
    else if (modelId === 'wan-2-2')         { base.image_url = frameUrl; }
    else if (modelId === 'kie-seedance2')   { base.urls = [frameUrl]; }
    else if (modelId === 'kie-runway')      { base.imageUrl = frameUrl; }
    else if (modelId === 'sora-2')          { base.image_url = frameUrl; }
    else if (modelId === 'ltx-2-video')     { base.image_url = frameUrl; }
  }

  if (modelId === 'kie-kling3')   { base.mode = 'pro'; base.sound = true; }
  if (modelId === 'kling-3-image') { base.generate_audio = true; }

  return base;
}

function extractFrameAtTime(
  videoUrl: string,
  timeSec: number,
  signal: AbortSignal,
): Promise<{ blob: Blob; dataUrl: string } | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.src = videoUrl;

    const timeout = setTimeout(() => { video.src = ''; resolve(null); }, 10000);

    video.addEventListener('loadedmetadata', () => {
      const seekTime = Math.min(Math.max(0, timeSec), video.duration || 0);
      video.currentTime = seekTime;
    }, { once: true });

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      if (signal.aborted) { resolve(null); return; }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          canvas.toBlob((blob) => {
            if (blob) resolve({ blob, dataUrl });
            else resolve(null);
          }, 'image/jpeg', 0.85);
          return;
        }
      } catch { /* CORS */ }
      resolve(null);
    }, { once: true });

    video.addEventListener('error', () => { clearTimeout(timeout); resolve(null); }, { once: true });
    video.load();
  });
}

async function uploadFrame(blob: Blob): Promise<string | null> {
  try {
    const buffer = await blob.arrayBuffer();
    const result = await window.electronAPI.elements.upload(
      { buffer, name: 'extend-frame.jpg', type: 'image/jpeg' },
      getApiKey(),
    );
    return result.url;
  } catch {
    return null;
  }
}

export interface ExtendModalProps {
  clip: Clip;
  asset: Asset;
  sourceClip: Clip;
  sourceAsset: Asset;
  onStartGeneration: (
    clipId: string,
    generationPromise: Promise<{ url: string; durationSec: number }>,
    label: string,
  ) => void;
  onClose: () => void;
}

export function ExtendModal({
  clip,
  asset,
  sourceClip,
  sourceAsset,
  onStartGeneration,
  onClose,
}: ExtendModalProps) {
  const direction = asset.metadata?.extendDirection === 'before' ? 'before' : 'after';
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState(() => direction === 'before' ? 'kling-3-image' : 'kie-kling3');
  const [phase, setPhase] = useState<'input' | 'extracting' | 'uploading' | 'generating'>('input');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [refFrame, setRefFrame] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(true);

  const placeholderDuration = clipEffectiveDuration(clip);

  const seekTime = useMemo(() =>
    direction === 'after'
      ? sourceClip.trimStart + clipEffectiveDuration(sourceClip)
      : sourceClip.trimStart,
    [direction, sourceClip],
  );

  const frameLabel = direction === 'after' ? 'End frame' : 'Start frame';

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    const videoUrl = toFileUrl(sourceAsset.fileRef || sourceAsset.url);
    setFrameLoading(true);
    extractFrameAtTime(videoUrl, seekTime, controller.signal).then((result) => {
      if (result && !controller.signal.aborted) {
        setRefFrame(result.dataUrl);
      }
      if (!controller.signal.aborted) setFrameLoading(false);
    });

    return () => controller.abort();
  }, [sourceAsset, seekTime]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); abortRef.current?.abort(); onClose(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) { abortRef.current?.abort(); onClose(); }
  }, [onClose]);

  const isGenerating = phase !== 'input';

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Enter a prompt describing what the extension should show');
      return;
    }
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPhase('extracting');
      const videoUrl = toFileUrl(sourceAsset.fileRef || sourceAsset.url);
      const frameResult = await extractFrameAtTime(videoUrl, seekTime, controller.signal);
      if (controller.signal.aborted) return;

      let frameUrl: string | null = null;
      if (frameResult) {
        setPhase('uploading');
        frameUrl = await uploadFrame(frameResult.blob);
        if (controller.signal.aborted) return;
      }

      if (!frameUrl) {
        setError('Could not extract reference frame from source clip. Try scrubbing the clip first.');
        setPhase('input');
        return;
      }

      setPhase('generating');
      const snappedDuration = snapDuration(placeholderDuration, modelId);
      const inputs = buildModelInputs(modelId, direction, frameUrl, prompt, snappedDuration);

      const generationPromise = (async (): Promise<{ url: string; durationSec: number }> => {
        const data = await window.electronAPI.workflow.run({
          apiKey: getApiKey(),
          kieKey: getKieApiKey(),
          nodeId: 'timeline-extend',
          nodeType: 'video',
          modelId,
          inputs,
        }) as Record<string, unknown>;

        const resultUrls = data.resultUrls as string[] | undefined;
        const url = resultUrls?.[0]
          ?? (data.video_url as string)
          ?? (data.url as string)
          ?? ((data as { video?: { url?: string } }).video?.url);
        if (typeof url !== 'string') throw new Error('No video URL in response');
        return { url, durationSec: snappedDuration };
      })();

      const label = prompt.trim().length > 40
        ? prompt.trim().slice(0, 40).trimEnd() + '...'
        : prompt.trim();

      onStartGeneration(clip.id, generationPromise, label);
      onClose();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
        setPhase('input');
      }
    }
  }, [prompt, modelId, direction, placeholderDuration, sourceAsset, seekTime, clip, onStartGeneration, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isGenerating) handleGenerate();
    }
  }, [handleGenerate, isGenerating]);

  const phaseLabel =
    phase === 'extracting' ? 'Extracting frame...'
    : phase === 'uploading' ? 'Uploading frame...'
    : phase === 'generating' ? 'Generating video...'
    : '';

  return (
    <div className="em__backdrop" onMouseDown={handleBackdropClick}>
      <div
        className="em"
        role="dialog"
        aria-modal="true"
        aria-label="Extend Clip"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="em__header">
          <svg className="em__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
          </svg>
          <span className="em__title">Extend</span>
          <span className="em__duration">
            {Math.round(placeholderDuration * 10) / 10}s
          </span>
        </div>

        <div className="em__viewer-wrap">
          <div className="em__viewer-label">{frameLabel}</div>
          <div className={`em__frame${frameLoading && !refFrame ? ' em__frame--loading' : ''}`}>
            {refFrame ? (
              <img src={refFrame} alt={`${frameLabel} of source clip`} draggable={false} />
            ) : frameLoading ? (
              <div className="em__frame-loader" />
            ) : (
              <div className="em__frame-empty">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <line x1="2" y1="16" x2="22" y2="16" />
                </svg>
                <span>No frame</span>
              </div>
            )}
          </div>
        </div>

        <div className="em__field">
          <label className="em__label">Model</label>
          <select
            className="em__select"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={isGenerating}
          >
            {EXTEND_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <textarea
          className="em__prompt"
          rows={3}
          placeholder="Describe what the extension should show..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isGenerating}
          autoFocus
        />

        <div className="em__controls">
          <button
            type="button"
            className="em__btn em__btn--secondary"
            onClick={() => { abortRef.current?.abort(); onClose(); }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="em__btn em__btn--primary"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? phaseLabel : 'Generate'}
          </button>
        </div>

        {isGenerating && (
          <div className="em__progress">
            <div className="em__progress-bar" />
          </div>
        )}

        {error && <div className="em__error">{error}</div>}

        <div className="em__hint">
          <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd><kbd>↵</kbd> generate · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
