# Extend Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Extend" timeline tool that lets users drag the start or end edge of a video clip into empty space, generate a seamlessly connected AI video extension, and place it as a new clip adjacent to the original.

**Architecture:** Mirrors the existing Fill Gap tool pattern exactly: drag → ghost preview → accept → placeholder clip → "Generate Extension" button → ExtendModal → generation promise → clip replacement. The modal extracts a reference frame from the source clip's anchored edge, uploads it, and calls the workflow API with a model-specific input mapping.

**Tech Stack:** React, TypeScript, Electron IPC (`workflow:run`), fal.ai and kie.ai video models, Canvas API for frame extraction, CSS in `src/styles/edit-tab.css` (NOT globals.css — all timeline/edit CSS lives there).

**Spec:** `docs/superpowers/specs/2026-03-14-extend-tool-design.md`

---

## Chunk 1: Type scaffolding + tool registration

### Task 1: Add `'extend'` to `ToolType`

**Files:**
- Modify: `src/types/timeline.ts:3-12`

- [ ] **Step 1: Add `'extend'` to the union**

Open `src/types/timeline.ts`. Change:
```ts
export type ToolType =
  | 'select'
  | 'trackForward'
  | 'blade'
  | 'ripple'
  | 'roll'
  | 'slip'
  | 'slide'
  | 'music'
  | 'fillGap';
```
To:
```ts
export type ToolType =
  | 'select'
  | 'trackForward'
  | 'blade'
  | 'ripple'
  | 'roll'
  | 'slip'
  | 'slide'
  | 'music'
  | 'fillGap'
  | 'extend';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: No new errors (no code references `'extend'` yet so no exhaustiveness errors).

---

### Task 2: Register extend tool in tool sidebar

**Files:**
- Modify: `src/components/edit/tool-sidebar.tsx:1-43`

- [ ] **Step 1: Add the import and icon**

At the top of `src/components/edit/tool-sidebar.tsx`, after the existing SVG imports, add:
```ts
import extendSvg from '@/assets/extend.svg';
```

After `FillGapIcon`:
```ts
const ExtendIcon = () => <img src={extendSvg} alt="Extend" width="20" height="20" className="tool-sidebar__img-icon" />;
```

- [ ] **Step 2: Add extend to the TOOLS array**

After the `fillGap` entry in `TOOLS`:
```ts
{ id: 'extend', label: 'Extend Tool', shortcut: 'E', icon: <ExtendIcon />, group: 'generate' },
```

- [ ] **Step 3: Verify the sidebar renders**

Run the app in dev mode (`npm run dev`) and open a project. Confirm the extend icon appears in the Generate section of the tool sidebar, below Fill Gap.

---

### Task 3: Wire the `E` keyboard shortcut in `edit-tab.tsx`

**Files:**
- Modify: `src/components/edit/edit-tab.tsx:~428-430`

The keydown shortcut handler is around line 414–430. After the `g`/`G` → `fillGap` case, add:

- [ ] **Step 1: Add shortcut case**

```ts
} else if (e.key === 'e' || e.key === 'E') {
  setActiveTool('extend');
}
```

- [ ] **Step 2: Verify**

Run app. Press `E` — the extend tool should become active in the sidebar (button lights up). Press `V` to switch back.

- [ ] **Step 3: Commit**

```bash
git add src/types/timeline.ts src/components/edit/tool-sidebar.tsx src/components/edit/edit-tab.tsx
git commit -m "feat: add extend ToolType, register in sidebar with E shortcut"
```

---

## Chunk 2: clip-card pending/generating states

### Task 4: Add `pendingExtend` rendering to `clip-card.tsx`

**Files:**
- Modify: `src/components/edit/clip-card.tsx:87-89, 243, 254-272`

- [ ] **Step 1: Add the `isPendingExtend` flag**

After line 88 (`const isPendingFillGap = ...`), add:
```ts
const isPendingExtend = !!(asset?.metadata?.pendingExtend);
```

- [ ] **Step 2: Update the root className**

Find the `isPendingMusic || isPendingFillGap` check in the `className` string (line 243). Change:
```ts
${isPendingMusic || isPendingFillGap ? ' clip-card--pending-music' : ''}
```
To:
```ts
${isPendingMusic || isPendingFillGap || isPendingExtend ? ' clip-card--pending-music' : ''}
```

Also update the filmstrip visibility guard (line ~129–132) to skip filmstrip for pending extend:
```ts
const showFilmstripPlaceholder =
  isVideo &&
  !isMissingAsset &&
  !isPendingMusic &&
  !isPendingFillGap &&
  !isPendingExtend &&
  !filmstripUrl &&
  visibleFrames.length === 0;
```

- [ ] **Step 3: Add the "Generate Extension" button branch**

Find the pending render block (line ~254–273):
```tsx
{isPendingMusic || isPendingFillGap ? (
  <div className="clip-card__pending-music-bg">
    <button ...>
      {isPendingFillGap ? (
        <img src={aiSvg} ... />
      ) : (
        <svg .../>
      )}
      <span>{isPendingFillGap ? 'Generate AI Fill' : 'Click to Generate'}</span>
    </button>
  </div>
) : isGenerating ? (
```

Change to:
```tsx
{isPendingMusic || isPendingFillGap || isPendingExtend ? (
  <div className="clip-card__pending-music-bg">
    <button
      className="clip-card__pending-music-btn"
      onPointerDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); onClickGenerate?.(clip.id); }}
    >
      {isPendingFillGap || isPendingExtend ? (
        <img src={aiSvg} alt="" className="clip-card__pending-ai-icon" aria-hidden="true" />
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" /></svg>
      )}
      <span>
        {isPendingFillGap ? 'Generate AI Fill' : isPendingExtend ? 'Generate Extension' : 'Click to Generate'}
      </span>
    </button>
  </div>
) : isGenerating ? (
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/edit/clip-card.tsx
git commit -m "feat: add pendingExtend visual state to clip-card"
```

---

## Chunk 3: ExtendModal component

### Task 5: Create `extend-modal.tsx`

**Files:**
- Create: `src/components/edit/extend-modal.tsx`

This mirrors `fill-gap-modal.tsx` but with one reference frame, a model dropdown, and model-specific input param mapping.

- [ ] **Step 1: Create the file with frame extraction utilities**

The `extractFrameAtTime` and `uploadFrame` functions are identical to those in `fill-gap-modal.tsx`. Copy them into the new file (do not import from fill-gap — the files are independent).

```tsx
import { useState, useCallback, useRef, useEffect } from 'react';
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
  // wan-2-2 and sora-2 handled specially below
};

function snapDuration(sec: number, modelId: string): number {
  if (modelId === 'sora-2') {
    return Math.min(20, Math.max(2, Math.round(sec)));
  }
  if (modelId === 'wan-2-2') {
    return 5; // fixed — always 81 frames
  }
  const opts = MODEL_DURATIONS[modelId] ?? [5, 10];
  for (const opt of opts) {
    if (opt >= sec) return opt;
  }
  return opts[opts.length - 1];
}

/* ── Model list for dropdown ── */
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

/* ── Build model inputs based on modelId + direction + frameUrl ── */
function buildModelInputs(
  modelId: string,
  direction: 'before' | 'after',
  frameUrl: string,
  prompt: string,
  duration: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = { prompt: prompt.trim() };

  // Duration param
  if (modelId === 'wan-2-2') {
    base.num_frames = 81;
  } else if (modelId === 'sora-2') {
    base.duration = duration;
  } else if (modelId === 'kie-kling3' || modelId === 'kling-3-image' || modelId === 'kling-first-last' || modelId === 'kie-wan' || modelId === 'kie-seedance2' || modelId === 'kie-runway') {
    base.duration = String(duration);
  } else {
    base.duration = String(duration);
  }

  // Aspect ratio defaults
  if (modelId !== 'wan-2-2' && modelId !== 'sora-2') {
    base.aspect_ratio = '16:9';
  }

  // Reference frame assignment
  if (direction === 'after') {
    // frameUrl is the LAST frame of source → use as START of generated clip
    if (modelId === 'kie-kling3')       { base.image_urls = [frameUrl]; }
    else if (modelId === 'kling-3-image') { base.start_image_url = frameUrl; }
    else if (modelId === 'kling-first-last') { base.image_url = frameUrl; }
    else if (modelId === 'kie-wan')     { base.image_urls = [frameUrl]; }
    else if (modelId === 'wan-2-2')     { base.image_url = frameUrl; }
    else if (modelId === 'kie-seedance2') { base.urls = [frameUrl]; }
    else if (modelId === 'kie-runway')  { base.imageUrl = frameUrl; }
    else if (modelId === 'sora-2')      { base.image_url = frameUrl; }
    else if (modelId === 'ltx-2-video') { base.image_url = frameUrl; }
  } else {
    // direction === 'before'
    // frameUrl is the FIRST frame of source → use as END of generated clip
    // Only kling-3-image has a clean end_image_url param; others use start param (model limitation)
    if (modelId === 'kling-3-image')    { base.end_image_url = frameUrl; }
    else if (modelId === 'kling-first-last') { base.tail_image_url = frameUrl; }
    else if (modelId === 'kie-kling3')  { base.image_urls = [frameUrl]; } // passes as first frame — known limitation
    else if (modelId === 'kie-wan')     { base.image_urls = [frameUrl]; }
    else if (modelId === 'wan-2-2')     { base.image_url = frameUrl; }
    else if (modelId === 'kie-seedance2') { base.urls = [frameUrl]; }
    else if (modelId === 'kie-runway')  { base.imageUrl = frameUrl; }
    else if (modelId === 'sora-2')      { base.image_url = frameUrl; }
    else if (modelId === 'ltx-2-video') { base.image_url = frameUrl; }
  }

  // Model-specific extras
  if (modelId === 'kie-kling3') { base.mode = 'pro'; base.sound = true; }
  if (modelId === 'kling-3-image') { base.generate_audio = true; }
  if (modelId === 'kling-first-last') { /* no extras */ }

  return base;
}

/* ── Frame extraction (same as fill-gap-modal) ── */
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

/* ── Props ── */
export interface ExtendModalProps {
  clip: Clip;          // the pending-extend placeholder
  asset: Asset;        // the placeholder asset
  sourceClip: Clip;    // the original clip being extended
  sourceAsset: Asset;  // the source clip's asset (for frame extraction)
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
  const direction = (asset.metadata?.extendDirection as 'before' | 'after') ?? 'after';
  const [prompt, setPrompt] = useState('');
  // Default: 'before' direction uses kling-3-image (has explicit end_image_url); 'after' uses kie-kling3
  const [modelId, setModelId] = useState(() => direction === 'before' ? 'kling-3-image' : 'kie-kling3');
  const [phase, setPhase] = useState<'input' | 'extracting' | 'uploading' | 'generating'>('input');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reference frame preview
  const [refFrame, setRefFrame] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(true);

  const placeholderDuration = clipEffectiveDuration(clip);

  // Stable seek time — memo so useEffect dep doesn't re-fire on every render
  const seekTime = useMemo(() =>
    direction === 'after'
      ? sourceClip.trimStart + clipEffectiveDuration(sourceClip)  // last frame
      : sourceClip.trimStart,                                       // first frame
    [direction, sourceClip],
  );

  const frameLabel = direction === 'after' ? 'End frame' : 'Start frame';

  // Extract reference frame on mount
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

  // Escape to close
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
      // Step 1: Extract frame
      setPhase('extracting');
      const videoUrl = toFileUrl(sourceAsset.fileRef || sourceAsset.url);
      const frameResult = await extractFrameAtTime(videoUrl, seekTime, controller.signal);
      if (controller.signal.aborted) return;

      // Step 2: Upload frame
      let frameUrl: string | null = null;
      if (frameResult) {
        setPhase('uploading');
        frameUrl = await uploadFrame(frameResult.blob);
        if (controller.signal.aborted) return;
      }

      // Step 3: Validate frame extracted
      if (!frameUrl) {
        setError('Could not extract reference frame from source clip. Try scrubbing the clip first.');
        setPhase('input');
        return;
      }

      // Step 4: Build inputs + kick off generation
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
  }, [prompt, modelId, direction, placeholderDuration, sourceAsset, seekTime, clip.id, onStartGeneration, onClose]);

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
        {/* Header */}
        <div className="em__header">
          <svg className="em__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
          </svg>
          <span className="em__title">Extend</span>
          <span className="em__duration">
            {Math.round(placeholderDuration * 10) / 10}s
          </span>
        </div>

        {/* Reference frame */}
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

        {/* Model dropdown */}
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

        {/* Prompt */}
        <textarea
          className="em__prompt"
          rows={3}
          placeholder="Describe what the extension should show..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isGenerating}
          autoFocus
        />

        {/* Controls */}
        <div className="em__controls">
          <button
            type="button"
            className="em__btn em__btn--secondary"
            onClick={() => { abortRef.current?.abort(); onClose(); }}
            disabled={isGenerating}
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

        {/* Progress */}
        {isGenerating && (
          <div className="em__progress">
            <div className="em__progress-bar" />
          </div>
        )}

        {/* Error */}
        {error && <div className="em__error">{error}</div>}

        {/* Hint */}
        <div className="em__hint">
          <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd><kbd>↵</kbd> generate · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `extend-modal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/extend-modal.tsx
git commit -m "feat: add ExtendModal component"
```

---

## Chunk 4: CSS for ExtendModal

### Task 6: Add `.em__*` CSS to `edit-tab.css`

**Files:**
- Modify: `src/styles/edit-tab.css` (append after the `.fgm__*` section)

**Important:** All timeline/editor CSS lives in `src/styles/edit-tab.css`, NOT `globals.css`. The `.fgm__*` block and all `@keyframes fgm-*` are in `edit-tab.css`. Find the end of the `.fgm__*` block there and append:

- [ ] **Step 1: Append modal CSS**

```css
/* ── ExtendModal ── */
.em__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.em {
  background: var(--surface-2, #16181e);
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  border-radius: 10px;
  width: 400px;
  max-width: 96vw;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.6);
}
.em__header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.em__icon { opacity: 0.7; flex-shrink: 0; }
.em__title { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; flex: 1; }
.em__duration { font-size: 11px; opacity: 0.5; font-variant-numeric: tabular-nums; }

.em__viewer-wrap { display: flex; flex-direction: column; gap: 6px; }
.em__viewer-label { font-size: 10px; opacity: 0.45; text-transform: uppercase; letter-spacing: 0.06em; }
.em__frame {
  width: 100%;
  aspect-ratio: 16/9;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(255,255,255,0.04);
  display: flex;
  align-items: center;
  justify-content: center;
}
.em__frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.em__frame--loading { animation: em-pulse 1.2s ease-in-out infinite; }
@keyframes em-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.em__frame-loader {
  width: 24px; height: 24px;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: var(--accent, #e8a020);
  border-radius: 50%;
  animation: fgm-spin 0.8s linear infinite;
}
.em__frame-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  opacity: 0.3; font-size: 11px;
}

.em__field { display: flex; flex-direction: column; gap: 5px; }
.em__label { font-size: 10px; opacity: 0.45; text-transform: uppercase; letter-spacing: 0.06em; }
.em__select {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 5px;
  color: inherit;
  font-size: 12px;
  padding: 6px 8px;
  outline: none;
  cursor: pointer;
}
.em__select:focus { border-color: var(--accent, #e8a020); }

.em__prompt {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  color: inherit;
  font-size: 12px;
  padding: 9px 10px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
}
.em__prompt:focus { border-color: var(--accent, #e8a020); }
.em__prompt:disabled { opacity: 0.5; }

.em__controls { display: flex; gap: 8px; justify-content: flex-end; }
.em__btn {
  font-size: 12px; font-weight: 500;
  padding: 7px 16px; border-radius: 5px;
  border: 1px solid transparent; cursor: pointer;
  transition: opacity 0.15s;
}
.em__btn:disabled { opacity: 0.4; cursor: default; }
.em__btn--secondary {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.08);
  color: inherit;
}
.em__btn--secondary:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
.em__btn--primary {
  background: var(--accent, #e8a020);
  color: #000;
}
.em__btn--primary:hover:not(:disabled) { opacity: 0.85; }

.em__progress {
  height: 2px;
  background: rgba(255,255,255,0.08);
  border-radius: 1px;
  overflow: hidden;
}
.em__progress-bar {
  height: 100%;
  background: var(--accent, #e8a020);
  animation: fgm-progress 2s ease-in-out infinite;
}
.em__error {
  font-size: 11px;
  color: var(--error, #e74c3c);
  background: rgba(231,76,60,0.1);
  padding: 7px 10px;
  border-radius: 5px;
}
.em__hint {
  font-size: 10px;
  opacity: 0.3;
  display: flex;
  gap: 4px;
  align-items: center;
}
.em__hint kbd {
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  font-family: inherit;
}
```

- [ ] **Step 2: Verify modal renders visually**

Run the app. Temporarily hard-code the modal open in `timeline-editor.tsx` render to confirm styling. Then revert.

- [ ] **Step 3: Commit**

```bash
git add src/styles/edit-tab.css
git commit -m "feat: add ExtendModal CSS"
```

---

## Chunk 5: Timeline editor — extend drag + ghost + placeholder

### Task 7: Add extend drag state and edge detection to `timeline-editor.tsx`

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`

This is the most complex task. Follow the fill-gap pattern precisely.

- [ ] **Step 1: Add extend state variables**

Near the existing fill-gap state declarations (around line 108–109), add:

```ts
// Extend tool state
const [extendDrag, setExtendDrag] = useState<{
  sourceClipId: string;
  trackId: string;
  direction: 'before' | 'after'; // 'before' = dragging left from start edge, 'after' = dragging right from end edge
  anchorTime: number;             // fixed end of drag zone (source clip edge)
  currentTime: number;            // moving end (where user has dragged to)
  trackTop: number;
  trackHeight: number;
} | null>(null);
const [extendModalClipId, setExtendModalClipId] = useState<string | null>(null);
const extendDragRef = useRef<typeof extendDrag>(null);
```

- [ ] **Step 1a: Add `clipEndTime` to the existing import**

In `timeline-editor.tsx`, find the existing import from `@/types/timeline` (line ~30):
```ts
import { clipEffectiveDuration, DEFAULT_VIDEO_COLOR, DEFAULT_AUDIO_COLOR } from '@/types/timeline';
```
Change to:
```ts
import { clipEffectiveDuration, clipEndTime, DEFAULT_VIDEO_COLOR, DEFAULT_AUDIO_COLOR } from '@/types/timeline';
```

- [ ] **Step 2: Add `isExtendEdge` helper**

After `findFillGapAtTime`, add a helper that checks whether a point is near the start or end edge of a clip and that clip is on a video track and is not a pending placeholder:

```ts
const findExtendEdge = useCallback((
  trackId: string,
  time: number,
): { clip: Clip; edge: 'start' | 'end'; edgeTime: number } | null => {
  const tl = timelineRef.current;
  const track = tl.tracks.find((t) => t.id === trackId);
  if (!track || track.kind !== 'video' || track.locked) return null;

  const EDGE_THRESHOLD_SEC = 8 / pxPerSecondRef.current; // 8px in seconds
  const trackClips = tl.clips.filter((c) => c.trackId === trackId);

  for (const c of trackClips) {
    const asset = assets.find((a) => a.id === c.assetId);
    // Skip pending placeholders
    if (asset?.metadata?.pendingExtend || asset?.metadata?.pendingFillGap || asset?.metadata?.pendingMusic) continue;

    const startEdge = c.startTime;
    const endEdge = clipEndTime(c);

    if (Math.abs(time - startEdge) <= EDGE_THRESHOLD_SEC) {
      return { clip: c, edge: 'start', edgeTime: startEdge };
    }
    if (Math.abs(time - endEdge) <= EDGE_THRESHOLD_SEC) {
      return { clip: c, edge: 'end', edgeTime: endEdge };
    }
  }
  return null;
}, [assets]);
```

Note: `clipEndTime` is already imported from `@/types/timeline`.

- [ ] **Step 3: Add `isSpaceEmpty` helper**

```ts
const isSpaceEmpty = useCallback((trackId: string, startTime: number, endTime: number, excludeClipId?: string): boolean => {
  const tl = timelineRef.current;
  return !tl.clips.some((c) => {
    if (c.trackId !== trackId) return false;
    if (c.id === excludeClipId) return false;
    const cs = c.startTime;
    const ce = clipEndTime(c);
    return cs < endTime && ce > startTime;
  });
}, []);
```

- [ ] **Step 4: Wire extend cursor into `handleBladeMove`**

The fill-gap hover detection lives in `handleBladeMove` (a `React.MouseEvent` handler, wired to `onMouseMove`). Add extend edge cursor detection after the `fillGap` block. Use the exact same `clipsEl.getBoundingClientRect()` x-calculation pattern as fill-gap (do NOT use `tracksEl.scrollLeft` — `getBoundingClientRect()` already accounts for scroll):

```ts
if (activeTool === 'extend' && !extendDragRef.current) {
  // Cursor hover: find which track row we're over
  const trackRows = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.track-row[data-track-id]');
  for (const row of trackRows) {
    if (e.clientY >= row.getBoundingClientRect().top && e.clientY <= row.getBoundingClientRect().bottom) {
      const clipsEl = row.querySelector('.track-row__clips') as HTMLElement | null;
      if (!clipsEl) break;
      const clipsRect = clipsEl.getBoundingClientRect();
      const x = e.clientX - clipsRect.left;
      if (x < 0 || x > clipsRect.width) break;
      const time = Math.max(0, x / pxPerSecondRef.current);
      const trackId = row.dataset.trackId ?? '';
      const edgeHit = findExtendEdge(trackId, time);
      if (edgeHit) {
        (e.currentTarget as HTMLElement).style.cursor = edgeHit.edge === 'start' ? 'w-resize' : 'e-resize';
      } else {
        (e.currentTarget as HTMLElement).style.cursor = '';
      }
      break;
    }
  }
}
```

- [ ] **Step 4b: Wire extend drag tracking into `handleTrackAreaPointerMove`**

`handleTrackAreaPointerMove` is the pointer-event handler (wired to `onPointerMove`). Add at the top of that callback, before the music drag block:

```ts
// Extend drag tracking
if (activeTool === 'extend' && extendDragRef.current) {
  const drag = extendDragRef.current;
  const tracksEl = tracksRef.current;
  if (!tracksEl) return;
  const rect = tracksEl.getBoundingClientRect();
  const x = e.clientX - rect.left - LABEL_WIDTH;
  const rawTime = Math.max(0, x / pxPerSecondRef.current);
  let currentTime: number;
  if (drag.direction === 'before') {
    currentTime = Math.max(drag.anchorTime - 10, Math.min(drag.anchorTime, rawTime));
  } else {
    currentTime = Math.min(drag.anchorTime + 10, Math.max(drag.anchorTime, rawTime));
  }
  setExtendDrag({ ...drag, currentTime });
  extendDragRef.current = { ...drag, currentTime };
  return;
}
```

Note: In `handleTrackAreaPointerMove` the rect is the tracks container and there is no scroll involved in the pointer coordinate (pointer capture keeps events firing even outside). Use `e.clientX - rect.left - LABEL_WIDTH` (same pattern as the music drag).

- [ ] **Step 5: Wire extend into `handleTrackAreaPointerDown`**

`handleTrackAreaPointerDown` is the pointer-event handler (wired to `onPointerDown`). It already has a `if ((e.target as Element).closest('.clip-card, .track-row__label')) return;` guard at the top. Add the extend handling after the `fillGap` preventDefault block (around line 910):

```ts
if (activeTool === 'extend') {
  const tracksEl = tracksRef.current;
  if (!tracksEl) return;
  const rect = tracksEl.getBoundingClientRect();
  // Use same x calc as music drag (no scrollLeft — rect is scroll-adjusted)
  const x = e.clientX - rect.left - LABEL_WIDTH;
  const time = Math.max(0, x / pxPerSecondRef.current);

  // Find which track row
  const trackRows = tracksEl.querySelectorAll<HTMLElement>('.track-row[data-track-id]');
  let trackId: string | null = null;
  let trackTop = 0;
  let trackHeight = 48;
  for (const row of trackRows) {
    const rowRect = row.getBoundingClientRect();
    if (e.clientY >= rowRect.top && e.clientY <= rowRect.bottom) {
      trackId = row.dataset.trackId ?? null;
      trackTop = rowRect.top - rect.top;
      trackHeight = rowRect.height;
      break;
    }
  }
  if (!trackId) return;

  const edgeHit = findExtendEdge(trackId, time);
  if (!edgeHit) return;

  e.preventDefault();

  const direction: 'before' | 'after' = edgeHit.edge === 'start' ? 'before' : 'after';

  // Check for adjacent empty space (probe 0.5s in drag direction)
  const PROBE_SEC = 0.5;
  const probeStart = direction === 'before' ? edgeHit.edgeTime - PROBE_SEC : edgeHit.edgeTime;
  const probeEnd = direction === 'before' ? edgeHit.edgeTime : edgeHit.edgeTime + PROBE_SEC;
  if (!isSpaceEmpty(trackId, probeStart, probeEnd, edgeHit.clip.id)) return;

  const newDrag = {
    sourceClipId: edgeHit.clip.id,
    trackId,
    direction,
    anchorTime: edgeHit.edgeTime,
    currentTime: edgeHit.edgeTime,
    trackTop,
    trackHeight,
  };
  setExtendDrag(newDrag);
  extendDragRef.current = newDrag;
  // Capture pointer so drag events keep firing outside the element boundary
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  return;
}
```

- [ ] **Step 6: Wire extend into `handleTrackAreaPointerUp`**

`handleTrackAreaPointerUp` is wired to `onPointerUp` and `onPointerCancel`. Add at the top of that callback:

```ts
if (extendDragRef.current) {
  const drag = extendDragRef.current;
  const duration = Math.abs(drag.currentTime - drag.anchorTime);
  if (duration >= 0.1) {
    handleAcceptExtend(drag);
  }
  setExtendDrag(null);
  extendDragRef.current = null;
  return;
}
```

- [ ] **Step 7: Clear extend drag when tool changes**

Alongside the existing `useEffect` that clears `fillGapPreview` when `activeTool !== 'fillGap'`, add:

```ts
useEffect(() => {
  if (activeTool !== 'extend') {
    setExtendDrag(null);
    extendDragRef.current = null;
  }
}, [activeTool]);
```

---

### Task 8: `handleAcceptExtend` and `handleExtendStartGeneration`

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`

- [ ] **Step 1: Add `handleAcceptExtend`**

After `handleAcceptFillGap`:

```ts
const handleAcceptExtend = useCallback((drag: {
  sourceClipId: string;
  trackId: string;
  direction: 'before' | 'after';
  anchorTime: number;
  currentTime: number;
}) => {
  const duration = Math.abs(drag.currentTime - drag.anchorTime);
  if (duration < 0.1) return;

  const startTime = drag.direction === 'before'
    ? Math.max(0, drag.anchorTime - duration)
    : drag.anchorTime;

  // Final space check
  if (!isSpaceEmpty(drag.trackId, startTime, startTime + duration, undefined)) return;

  const assetId = generateId();
  const clipId = generateId();

  const placeholderAsset: Asset = {
    id: assetId,
    name: 'Generate Extension',
    type: 'video',
    url: '',
    duration,
    createdAt: new Date().toISOString(),
    status: 'online',
    metadata: {
      pendingExtend: true,
      extendDirection: drag.direction,
      extendSourceClipId: drag.sourceClipId,
      generating: false,
    },
  };
  dispatch({ type: 'ADD_ASSET', asset: placeholderAsset });

  const tl = timelineRef.current;
  const newClip: TimelineClip = {
    id: clipId,
    assetId,
    trackId: drag.trackId,
    name: 'Generate Extension',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    opacity: 1,
    volume: 1,
    flipH: false,
    flipV: false,
    keyframes: [],
  };
  setTimeline({ ...tl, clips: [...tl.clips, newClip] });
  onSelectClips(new Set([clipId]));
  onToolChange?.('select');
}, [dispatch, isSpaceEmpty, onSelectClips, onToolChange, setTimeline]);
```

- [ ] **Step 2: Add `handleExtendStartGeneration`**

After `handleFillGapStartGeneration`:

```ts
const handleExtendStartGeneration = useCallback(
  (clipId: string, generationPromise: Promise<{ url: string; durationSec: number }>, label: string) => {
    const tl = timelineRef.current;
    const foundClip = tl.clips.find((c) => c.id === clipId);
    if (!foundClip) return;
    const assetId = foundClip.assetId;

    dispatch({
      type: 'UPDATE_ASSET',
      asset: { id: assetId, name: 'Generating...', metadata: { pendingExtend: false, generating: true } },
    });
    setTimeline({
      ...tl,
      clips: tl.clips.map((c) => c.id === clipId ? { ...c, name: 'Generating...' } : c),
    });
    setGeneratingClipIds((prev) => new Set(prev).add(clipId));

    generationPromise.then(({ url, durationSec: actualDuration }) => {
      dispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: assetId,
          name: label,
          url,
          duration: actualDuration,
          metadata: { generating: false, extend: true },
        },
      });
      const curTl = timelineRef.current;
      setTimeline({
        ...curTl,
        clips: curTl.clips.map((c) =>
          c.id === clipId ? { ...c, name: label, duration: actualDuration } : c,
        ),
      });
      setGeneratingClipIds((prev) => { const next = new Set(prev); next.delete(clipId); return next; });
    }).catch((err) => {
      if ((err as Error).name === 'AbortError') return;
      dispatch({
        type: 'UPDATE_ASSET',
        asset: { id: assetId, name: 'Generation Failed', metadata: { generating: false, error: true } },
      });
      setGeneratingClipIds((prev) => { const next = new Set(prev); next.delete(clipId); return next; });
    });
  },
  [dispatch, setTimeline],
);
```

---

### Task 9: Wire `handleClickGenerateClip` to open ExtendModal

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx:~1468-1471`

- [ ] **Step 1: Add extend check in `handleClickGenerateClip`**

After the `pendingFillGap` branch:
```ts
if (foundAsset?.metadata?.pendingExtend) {
  // Resolve source clip before opening modal
  const sourceClipId = foundAsset.metadata.extendSourceClipId as string | undefined;
  const sourceClip = sourceClipId ? tl.clips.find((c) => c.id === sourceClipId) : null;
  if (!sourceClip) {
    // Source deleted — revert placeholder to non-generating state
    dispatch({ type: 'UPDATE_ASSET', asset: { id: foundClip.assetId, metadata: { pendingExtend: true, generating: false } } });
    return;
  }
  setExtendModalClipId(clipId);
  return;
}
```

---

### Task 10: Render ghost preview and ExtendModal

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx:~2063 (renderFillGapPreview), ~2233 (modal rendering)`

- [ ] **Step 1: Add `renderExtendPreview` function**

After `renderFillGapPreview`:

```ts
const renderExtendPreview = (sectionTracks: typeof timeline.tracks) => {
  if (!extendDrag) return null;
  if (!sectionTracks.some((t) => t.id === extendDrag.trackId)) return null;
  const duration = Math.abs(extendDrag.currentTime - extendDrag.anchorTime);
  if (duration < 0.01) return null;

  const startTime = extendDrag.direction === 'before'
    ? extendDrag.anchorTime - duration
    : extendDrag.anchorTime;
  const width = duration * pxPerSecond;
  if (width <= 1) return null;

  return (
    <div
      className="timeline-editor__extend-preview"
      style={{
        left: startTime * pxPerSecond + LABEL_WIDTH,
        width,
        top: extendDrag.trackTop + 8,
        height: extendDrag.trackHeight - 16,
        pointerEvents: 'none',
      }}
    >
      <span className="timeline-editor__extend-preview-label">
        {Math.round(duration * 10) / 10}s
      </span>
    </div>
  );
};
```

- [ ] **Step 2: Call `renderExtendPreview` in the render output**

Find where `renderFillGapPreview(videoTracks)` is called in the JSX and add after it:
```tsx
{renderExtendPreview(videoTracks)}
```

- [ ] **Step 3: Import `ExtendModal` at top of file**

```ts
import { ExtendModal } from './extend-modal';
```

- [ ] **Step 4: Add close handler**

After `handleCloseFillGapModal`:
```ts
const handleCloseExtendModal = useCallback(() => {
  setExtendModalClipId(null);
}, []);
```

- [ ] **Step 5: Resolve extend modal data and render**

After the `fillGapModalClip` / `fillGapModalAsset` resolution:
```ts
const extendModalClip = extendModalClipId
  ? timeline.clips.find((c) => c.id === extendModalClipId) ?? null
  : null;
const extendModalAsset = extendModalClip
  ? assets.find((a) => a.id === extendModalClip.assetId) ?? null
  : null;
const extendModalSourceClipId = extendModalAsset?.metadata?.extendSourceClipId as string | undefined;
const extendModalSourceClip = extendModalSourceClipId
  ? timeline.clips.find((c) => c.id === extendModalSourceClipId) ?? null
  : null;
const extendModalSourceAsset = extendModalSourceClip
  ? assets.find((a) => a.id === extendModalSourceClip.assetId) ?? null
  : null;
```

In JSX, after the FillGapModal block:
```tsx
{extendModalClip && extendModalAsset && extendModalSourceClip && extendModalSourceAsset && (
  <ExtendModal
    clip={extendModalClip}
    asset={extendModalAsset}
    sourceClip={extendModalSourceClip}
    sourceAsset={extendModalSourceAsset}
    onStartGeneration={handleExtendStartGeneration}
    onClose={handleCloseExtendModal}
  />
)}
```

---

### Task 11: Add ghost preview CSS

**Files:**
- Modify: `src/styles/edit-tab.css`

- [ ] **Step 1: Add extend ghost styles**

After the fill-gap preview CSS (`.timeline-editor__fill-gap-preview`) in `edit-tab.css`, add:

```css
/* Extend tool ghost preview */
.timeline-editor__extend-preview {
  position: absolute;
  border: 1.5px dashed var(--accent, #e8a020);
  border-radius: 3px;
  background: rgba(232, 160, 32, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
}
.timeline-editor__extend-preview-label {
  font-size: 10px;
  color: var(--accent, #e8a020);
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
```

---

### Task 12: Final integration and commit

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Manual smoke test**

1. Open the app, open a project with video clips
2. Press `E` — extend tool activates
3. Hover near the end edge of a video clip — cursor changes to `e-resize`
4. Drag right into empty space — ghost zone appears with duration label
5. Release — placeholder "Generate Extension" clip appears, tool returns to Select
6. Click "Generate Extension" on the placeholder — ExtendModal opens
7. Select model, enter prompt, click Generate — modal closes, clip shows generating animation
8. (If API key set) wait for generation — clip updates with real video

- [ ] **Step 3: Commit everything**

```bash
git add src/components/edit/timeline-editor.tsx src/styles/edit-tab.css
git commit -m "feat: implement Extend tool drag, ghost preview, placeholder, modal wiring"
```

---

## Final commit

- [ ] **Create summary commit**

```bash
git log --oneline -6
# Review the 5-6 commits from this feature
```

The feature is complete when:
- `E` shortcut activates the extend tool
- Dragging left from start edge / right from end edge shows ghost zone (max 10s)
- Blocked if adjacent space is occupied
- Mouse-up places a "Generate Extension" placeholder
- Clicking placeholder opens ExtendModal with reference frame, model dropdown, prompt
- Generate closes modal and shows generating animation
- On success, clip is replaced with generated video
