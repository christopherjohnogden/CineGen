import { useState, useCallback, useRef, useEffect } from 'react';
import { getApiKey, getKieApiKey } from '@/lib/utils/api-key';
import { toFileUrl } from '@/lib/utils/file-url';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import type { Asset } from '@/types/project';

/* ── Kling 3.0 duration options (seconds) ── */
const KLING_DURATIONS = [3, 5, 8, 10, 15] as const;

/** Snap to the smallest Kling duration option >= requested seconds */
function snapKlingDuration(sec: number): number {
  for (const opt of KLING_DURATIONS) {
    if (opt >= sec) return opt;
  }
  return KLING_DURATIONS[KLING_DURATIONS.length - 1];
}

/* ── Frame extraction helpers ── */

/** Extract a specific frame from a video at a given time (seconds) */
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

/** Upload a frame blob and return a hosted URL */
async function uploadFrame(blob: Blob): Promise<string | null> {
  try {
    const buffer = await blob.arrayBuffer();
    const result = await window.electronAPI.elements.upload(
      { buffer, name: 'fill-gap-frame.jpg', type: 'image/jpeg' },
      getApiKey(),
    );
    return result.url;
  } catch {
    return null;
  }
}

/* ── Types ── */

interface FillGapModalProps {
  /** The placeholder clip in the gap */
  clip: Clip;
  /** The placeholder asset for this gap clip */
  asset: Asset;
  /** All clips on the same track, sorted by startTime */
  trackClips: Clip[];
  /** All assets in the project */
  assets: Asset[];
  /** Called when generation starts — hands off the promise */
  onStartGeneration: (
    clipId: string,
    generationPromise: Promise<{ url: string; durationSec: number }>,
    label: string,
  ) => void;
  onClose: () => void;
}

export function FillGapModal({
  clip,
  asset,
  trackClips,
  assets,
  onStartGeneration,
  onClose,
}: FillGapModalProps) {
  const [prompt, setPrompt] = useState(
    typeof asset.metadata?.fillGapPrompt === 'string' ? asset.metadata.fillGapPrompt : '',
  );
  const [phase, setPhase] = useState<'input' | 'extracting' | 'uploading' | 'generating'>('input');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Frame preview state
  const [leftFrame, setLeftFrame] = useState<string | null>(null);
  const [rightFrame, setRightFrame] = useState<string | null>(null);
  const [framesLoading, setFramesLoading] = useState(true);

  const gapDuration = clipEffectiveDuration(clip);
  const klingDuration = snapKlingDuration(gapDuration);

  // Find adjacent clips
  const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime);
  const gapIdx = sorted.findIndex((c) => c.id === clip.id);
  const leftClip = gapIdx > 0 ? sorted[gapIdx - 1] : null;
  const rightClip = gapIdx < sorted.length - 1 ? sorted[gapIdx + 1] : null;
  const leftAsset = leftClip ? assets.find((a) => a.id === leftClip.assetId) : null;
  const rightAsset = rightClip ? assets.find((a) => a.id === rightClip.assetId) : null;

  // Extract frames on mount
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    async function loadFrames() {
      setFramesLoading(true);
      const promises: Promise<void>[] = [];

      if (leftClip && leftAsset) {
        const videoUrl = toFileUrl(leftAsset.fileRef || leftAsset.url);
        // Last frame of left clip = trimStart + effectiveDuration
        const seekTime = leftClip.trimStart + clipEffectiveDuration(leftClip);
        promises.push(
          extractFrameAtTime(videoUrl, seekTime, controller.signal).then((result) => {
            if (result && !controller.signal.aborted) setLeftFrame(result.dataUrl);
          }),
        );
      }

      if (rightClip && rightAsset) {
        const videoUrl = toFileUrl(rightAsset.fileRef || rightAsset.url);
        // First frame of right clip = trimStart
        const seekTime = rightClip.trimStart;
        promises.push(
          extractFrameAtTime(videoUrl, seekTime, controller.signal).then((result) => {
            if (result && !controller.signal.aborted) setRightFrame(result.dataUrl);
          }),
        );
      }

      await Promise.allSettled(promises);
      if (!controller.signal.aborted) setFramesLoading(false);
    }

    loadFrames();
    return () => controller.abort();
  }, [leftClip, rightClip, leftAsset, rightAsset]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        abortRef.current?.abort();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      abortRef.current?.abort();
      onClose();
    }
  }, [onClose]);

  const isGenerating = phase !== 'input';

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Enter a prompt describing what should happen in this gap');
      return;
    }
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Step 1: Extract frames from adjacent clips for Kling start/end frame
      setPhase('extracting');
      let startFrameUrl: string | null = null;
      let endFrameUrl: string | null = null;

      if (leftClip && leftAsset) {
        const videoUrl = toFileUrl(leftAsset.fileRef || leftAsset.url);
        const seekTime = leftClip.trimStart + clipEffectiveDuration(leftClip);
        const frame = await extractFrameAtTime(videoUrl, seekTime, controller.signal);
        if (controller.signal.aborted) return;
        if (frame) {
          setPhase('uploading');
          startFrameUrl = await uploadFrame(frame.blob);
        }
      }

      if (rightClip && rightAsset) {
        const videoUrl = toFileUrl(rightAsset.fileRef || rightAsset.url);
        const seekTime = rightClip.trimStart;
        const frame = await extractFrameAtTime(videoUrl, seekTime, controller.signal);
        if (controller.signal.aborted) return;
        if (frame) {
          if (phase !== 'uploading') setPhase('uploading');
          endFrameUrl = await uploadFrame(frame.blob);
        }
      }

      if (controller.signal.aborted) return;

      // Step 2: Call Kling 3.0 via workflow API
      setPhase('generating');

      const inputs: Record<string, unknown> = {
        prompt: prompt.trim(),
        duration: String(klingDuration),
        aspect_ratio: '16:9',
        mode: 'pro',
        sound: true,
      };

      // Kling 3.0 via kie.ai: image_urls = [firstFrame, lastFrame]
      if (startFrameUrl && endFrameUrl) {
        inputs.image_urls = [startFrameUrl, endFrameUrl];
      } else if (startFrameUrl) {
        inputs.image_urls = [startFrameUrl];
      }

      const generationPromise = (async (): Promise<{ url: string; durationSec: number }> => {
        const data = await window.electronAPI.workflow.run({
          apiKey: getApiKey(),
          kieKey: getKieApiKey(),
          nodeId: 'timeline-fill-gap',
          nodeType: 'video',
          modelId: 'kie-kling3',
          inputs,
        }) as Record<string, unknown>;

        // kie.ai returns resultUrls array
        const resultUrls = data.resultUrls as string[] | undefined;
        const url = resultUrls?.[0] ?? (data.video_url as string) ?? (data.url as string);
        if (typeof url !== 'string') throw new Error('No video URL in response');
        return { url, durationSec: klingDuration };
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
  }, [prompt, klingDuration, leftClip, leftAsset, rightClip, rightAsset, clip.id, onStartGeneration, onClose, phase]);

  // Cmd/Ctrl+Enter to generate
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isGenerating) handleGenerate();
      }
    },
    [handleGenerate, isGenerating],
  );

  const phaseLabel =
    phase === 'extracting' ? 'Extracting frames...'
    : phase === 'uploading' ? 'Uploading frames...'
    : phase === 'generating' ? 'Generating video...'
    : '';

  return (
    <div className="fgm__backdrop" onMouseDown={handleBackdropClick}>
      <div
        ref={modalRef}
        className="fgm"
        role="dialog"
        aria-modal="true"
        aria-label="Fill Gap"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="fgm__header">
          <svg className="fgm__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span className="fgm__title">Fill Gap</span>
          <span className="fgm__duration">
            {Math.round(gapDuration * 10) / 10}s
            {klingDuration !== Math.round(gapDuration) && (
              <span className="fgm__duration-api"> &rarr; {klingDuration}s</span>
            )}
          </span>
        </div>

        {/* Frame Viewers */}
        <div className="fgm__viewers">
          <div className="fgm__viewer">
            <div className="fgm__viewer-label">Last frame</div>
            <div className={`fgm__frame${framesLoading && !leftFrame ? ' fgm__frame--loading' : ''}`}>
              {leftFrame ? (
                <img src={leftFrame} alt="Last frame of previous clip" draggable={false} />
              ) : framesLoading ? (
                <div className="fgm__frame-loader" />
              ) : (
                <div className="fgm__frame-empty">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="2" y1="16" x2="22" y2="16" />
                  </svg>
                  <span>No clip</span>
                </div>
              )}
            </div>
          </div>

          {/* Bridge arrow */}
          <div className="fgm__bridge">
            <svg width="48" height="24" viewBox="0 0 48 24" fill="none">
              <line x1="0" y1="12" x2="38" y2="12" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
              <polygon points="38,6 48,12 38,18" fill="var(--accent)" opacity="0.7" />
            </svg>
            <span className="fgm__bridge-label">AI Fill</span>
          </div>

          <div className="fgm__viewer">
            <div className="fgm__viewer-label">First frame</div>
            <div className={`fgm__frame${framesLoading && !rightFrame ? ' fgm__frame--loading' : ''}`}>
              {rightFrame ? (
                <img src={rightFrame} alt="First frame of next clip" draggable={false} />
              ) : framesLoading ? (
                <div className="fgm__frame-loader" />
              ) : (
                <div className="fgm__frame-empty">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="2" y1="16" x2="22" y2="16" />
                  </svg>
                  <span>No clip</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Prompt */}
        <textarea
          className="fgm__prompt"
          rows={3}
          placeholder="Describe what should happen in this gap..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isGenerating}
          autoFocus
        />

        {/* Controls */}
        <div className="fgm__controls">
          <button
            type="button"
            className="fgm__btn fgm__btn--secondary"
            onClick={() => { abortRef.current?.abort(); onClose(); }}
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fgm__btn fgm__btn--primary"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? phaseLabel : 'Generate'}
          </button>
        </div>

        {/* Progress */}
        {isGenerating && (
          <div className="fgm__progress">
            <div className="fgm__progress-bar" />
          </div>
        )}

        {/* Error */}
        {error && <div className="fgm__error">{error}</div>}

        {/* Hint */}
        <div className="fgm__hint">
          <kbd>{navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}</kbd><kbd>&crarr;</kbd> generate &middot; <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
