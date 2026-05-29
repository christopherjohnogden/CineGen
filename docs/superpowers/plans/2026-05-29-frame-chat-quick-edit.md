# Frame Chat (Quick Edit Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot Quick Edit modal with a persistent, chat-first "Frame Chat" panel that adapts to the playhead — chat-only when no frame is present, frame-canvas-plus-chat when over a video/image clip — auto-routing each message to either a Gemini vision answer or a Higgsfield generation, with results previewed in-chat and placed as an overlay above the selected clip on confirm.

**Architecture:** A new adaptive React modal (`frame-chat-modal.tsx`) owns a persistent per-project chat thread and renders a drawing canvas (`frame-canvas.tsx`) plus the chat. Pure intent/thread logic lives in `src/lib/edit/frame-chat-thread.ts`. The drawn frame is flattened to a PNG, written to a temp file via a new `media.writeTempImage` IPC, then passed to Gemini (existing `geminiChat` `visualRefs`, no IPC change) for asks or to Higgsfield (`higgsfield.quickEdit` extended with `drawnFramePath`) for generations. Placement reuses `addClipToTrack` and a new `addTrackAbove` helper.

**Tech Stack:** TypeScript, React (Electron renderer), Vitest, HTML5 Canvas, ffmpeg (existing), Gemini CLI (existing), Higgsfield CLI (existing).

---

## File Structure

**Create:**
- `src/lib/edit/frame-chat-thread.ts` — pure types + `detectFrameChatIntent()` + thread persistence helpers.
- `src/components/edit/frame-canvas.tsx` — frame image + drawing canvas + tool toolbar; `flatten()` → PNG Blob.
- `src/components/edit/frame-chat-modal.tsx` — adaptive container (State A/B), thread state, send/route, result preview.
- `tests/lib/edit/frame-chat-thread.test.ts` — intent detection + thread helpers.
- `tests/lib/editor/add-track-above.test.ts` — `addTrackAbove` placement.

**Modify:**
- `src/lib/editor/timeline-operations.ts` — add `addTrackAbove(timeline, targetTrackId, kind)`.
- `electron/ipc/media-import.ts` — add `media:write-temp-image` handler.
- `electron/preload.ts` — expose `media.writeTempImage`; extend `higgsfield.quickEdit` param type with `drawnFramePath`.
- `electron/ipc/higgsfield.ts` — `QuickEditParams.drawnFramePath`; use it as the reference image when present.
- `src/components/edit/timeline-editor.tsx` — open `FrameChatModal` from the shortcut (no selection required); add `handleFrameChatPlaceResult`; remove `QuickEditModal` usage.
- `electron.d.ts` — type the new `media.writeTempImage` and `quickEdit` `drawnFramePath`.

**Delete (final task):**
- `src/components/edit/quick-edit-modal.tsx` — replaced by `frame-chat-modal.tsx`.

**Reused as-is:** `routeQuickEdit` (`src/lib/higgsfield/quick-edit-intent.ts`), `media.extractFrame`, `geminiChat` IPC, `addClipToTrack`, `clipEffectiveDuration`.

---

## Task 1: Intent detection helper

**Files:**
- Create: `src/lib/edit/frame-chat-thread.ts`
- Test: `tests/lib/edit/frame-chat-thread.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/edit/frame-chat-thread.test.ts
import { describe, expect, it } from 'vitest';
import { detectFrameChatIntent } from '../../../src/lib/edit/frame-chat-thread';

describe('detectFrameChatIntent', () => {
  it('routes change-verb prompts to generate', () => {
    expect(detectFrameChatIntent('make this car red')).toBe('generate');
    expect(detectFrameChatIntent('remove the logo from the shirt')).toBe('generate');
    expect(detectFrameChatIntent('clean plate of this shot')).toBe('generate');
    expect(detectFrameChatIntent('extend this 3 more seconds')).toBe('generate');
    expect(detectFrameChatIntent('stylize this as anime')).toBe('generate');
  });

  it('routes questions to ask', () => {
    expect(detectFrameChatIntent('what is happening in this shot?')).toBe('ask');
    expect(detectFrameChatIntent('how long is my current cut')).toBe('ask');
    expect(detectFrameChatIntent('is this frame too dark')).toBe('ask');
    expect(detectFrameChatIntent('who is in this scene?')).toBe('ask');
  });

  it('defaults ambiguous prompts to ask (no credits spent)', () => {
    expect(detectFrameChatIntent('the car')).toBe('ask');
    expect(detectFrameChatIntent('hmm')).toBe('ask');
    expect(detectFrameChatIntent('')).toBe('ask');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/edit/frame-chat-thread.test.ts`
Expected: FAIL — cannot find module `frame-chat-thread`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/edit/frame-chat-thread.ts
import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';

export type FrameChatIntent = 'ask' | 'generate';

// Question heuristics adapted from inferAutoWorkMode in llm-tab.tsx.
const QUESTION_PREFIX = /^(what|who|where|when|why|how|which|is|are|do|does|did|can|could|should|would|will)\b/i;

/**
 * Decide whether a Frame Chat message is a generation request or a question.
 * - generate: matches routeQuickEdit's change-verb rules (and is NOT phrased as a question)
 * - ask: questions, or anything with no clear change intent (safer default — no credits)
 */
export function detectFrameChatIntent(prompt: string): FrameChatIntent {
  const text = prompt.trim();
  if (!text) return 'ask';

  const isQuestion = text.endsWith('?') || QUESTION_PREFIX.test(text);
  if (isQuestion) return 'ask';

  // routeQuickEdit returns 'ambiguous' when no change rule matched.
  const route = routeQuickEdit(text);
  return route.intent === 'ambiguous' ? 'ask' : 'generate';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/edit/frame-chat-thread.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/edit/frame-chat-thread.ts tests/lib/edit/frame-chat-thread.test.ts
git commit -m "feat(frame-chat): intent detection helper"
```

---

## Task 2: Thread types + persistence helpers

**Files:**
- Modify: `src/lib/edit/frame-chat-thread.ts`
- Test: `tests/lib/edit/frame-chat-thread.test.ts`

- [ ] **Step 1: Add failing tests for persistence**

Append to `tests/lib/edit/frame-chat-thread.test.ts`:

```typescript
import { frameChatStorageKey, serializeThread, deserializeThread, type FrameChatMessage } from '../../../src/lib/edit/frame-chat-thread';

describe('frame-chat thread persistence', () => {
  const msgs: FrameChatMessage[] = [
    { id: 'a', role: 'user', content: 'make the car red', createdAt: '2026-05-29T00:00:00.000Z', intent: 'generate' },
    { id: 'b', role: 'assistant', content: 'I can generate that.', createdAt: '2026-05-29T00:00:01.000Z' },
  ];

  it('builds a per-project storage key', () => {
    expect(frameChatStorageKey('proj-123')).toBe('cinegen_frame_chat:proj-123');
  });

  it('round-trips messages through serialize/deserialize', () => {
    expect(deserializeThread(serializeThread(msgs))).toEqual(msgs);
  });

  it('deserializes invalid JSON to an empty thread', () => {
    expect(deserializeThread('not json')).toEqual([]);
    expect(deserializeThread(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/edit/frame-chat-thread.test.ts`
Expected: FAIL — `frameChatStorageKey`/`serializeThread`/`deserializeThread` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/edit/frame-chat-thread.ts`:

```typescript
export type FrameChatRole = 'user' | 'assistant';

export interface FrameChatGenerationPreview {
  /** Higgsfield model + output type chosen by routeQuickEdit. */
  model: string;
  outputType: 'image' | 'video';
  referenceMode: 'frame' | 'segment' | 'first-last';
  /** Source clip the generation references (for placement on confirm). */
  sourceClipId: string;
  /** Resolved media URL once generated; absent until generation completes. */
  resultUrl?: string;
  resultDurationSec?: number;
  status: 'proposed' | 'generating' | 'ready' | 'failed' | 'placed';
  error?: string;
}

export interface FrameChatMessage {
  id: string;
  role: FrameChatRole;
  content: string;
  createdAt: string;
  intent?: FrameChatIntent;
  /** Present on assistant messages that propose/produce a generation. */
  generation?: FrameChatGenerationPreview;
}

export function frameChatStorageKey(projectId: string): string {
  return `cinegen_frame_chat:${projectId}`;
}

export function serializeThread(messages: FrameChatMessage[]): string {
  return JSON.stringify(messages);
}

export function deserializeThread(raw: string | null): FrameChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FrameChatMessage[]) : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/edit/frame-chat-thread.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/edit/frame-chat-thread.ts tests/lib/edit/frame-chat-thread.test.ts
git commit -m "feat(frame-chat): thread types and persistence helpers"
```

---

## Task 3: `addTrackAbove` timeline operation

**Files:**
- Modify: `src/lib/editor/timeline-operations.ts`
- Test: `tests/lib/editor/add-track-above.test.ts`

Context: video tracks render reversed (`timeline-editor.tsx` uses `[...videoTracks].reverse()`), so the track that appears **above** another is the one stored **after** it in the `tracks` array within the video group. `addTrackAbove` inserts a new track immediately after the target's array position so it renders directly above the target.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/editor/add-track-above.test.ts
import { describe, expect, it } from 'vitest';
import { addTrackAbove } from '../../../src/lib/editor/timeline-operations';
import type { Timeline } from '../../../src/types/timeline';

function makeTimeline(): Timeline {
  return {
    id: 't', name: 'T', duration: 0, clips: [],
    tracks: [
      { id: 'v1', name: 'V1', kind: 'video', color: '#111', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'v2', name: 'V2', kind: 'video', color: '#222', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'a1', name: 'A1', kind: 'audio', color: '#333', muted: false, solo: false, locked: false, visible: true, volume: 1 },
    ],
  } as unknown as Timeline;
}

describe('addTrackAbove', () => {
  it('inserts a new video track immediately after the target in array order (= above in reversed render)', () => {
    const { timeline, trackId } = addTrackAbove(makeTimeline(), 'v1', 'video');
    const ids = timeline.tracks.map((t) => t.id);
    expect(ids.indexOf(trackId)).toBe(ids.indexOf('v1') + 1);
    // audio stays last
    expect(ids[ids.length - 1]).toBe('a1');
  });

  it('appends after the target when target is the topmost video track', () => {
    const { timeline, trackId } = addTrackAbove(makeTimeline(), 'v2', 'video');
    const ids = timeline.tracks.map((t) => t.id);
    expect(ids.indexOf(trackId)).toBe(ids.indexOf('v2') + 1);
    expect(ids[ids.length - 1]).toBe('a1');
  });

  it('falls back to appending a track when the target id is unknown', () => {
    const before = makeTimeline().tracks.length;
    const { timeline, trackId } = addTrackAbove(makeTimeline(), 'nope', 'video');
    expect(timeline.tracks.length).toBe(before + 1);
    expect(timeline.tracks.some((t) => t.id === trackId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/editor/add-track-above.test.ts`
Expected: FAIL — `addTrackAbove` is not exported.

- [ ] **Step 3: Implement `addTrackAbove`**

Add to `src/lib/editor/timeline-operations.ts` (near `addTrack`, after its definition). It reuses the existing `nextTrackName`/`nextTrackColor` helpers and `generateId`:

```typescript
/**
 * Insert a new track directly "above" a target track in the timeline's visual stacking.
 * Video tracks render reversed, so "above" = inserted immediately AFTER the target in the
 * tracks array. Returns the updated timeline and the new track id. If the target is unknown,
 * falls back to appending via addTrack.
 */
export function addTrackAbove(
  timeline: Timeline,
  targetTrackId: string,
  kind: TrackKind,
): { timeline: Timeline; trackId: string } {
  const targetIndex = timeline.tracks.findIndex((t) => t.id === targetTrackId);
  const track: Track = {
    id: generateId(),
    name: nextTrackName(timeline.tracks, kind),
    kind,
    color: nextTrackColor(timeline.tracks, kind),
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1,
  };

  if (targetIndex < 0) {
    const appended = addTrack(timeline, kind);
    const added = appended.tracks[appended.tracks.length - 1];
    return { timeline: appended, trackId: added.id };
  }

  const nextTracks = [...timeline.tracks];
  nextTracks.splice(targetIndex + 1, 0, track);
  return { timeline: { ...timeline, tracks: nextTracks }, trackId: track.id };
}
```

Note: confirm `Track`, `TrackKind`, `generateId`, `nextTrackName`, `nextTrackColor`, and `addTrack` are already imported/defined in this file (they are — `addTrack` uses all of them).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/editor/add-track-above.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/timeline-operations.ts tests/lib/editor/add-track-above.test.ts
git commit -m "feat(timeline): addTrackAbove for overlay placement"
```

---

## Task 4: `media:write-temp-image` IPC

**Files:**
- Modify: `electron/ipc/media-import.ts`
- Modify: `electron/preload.ts`
- Modify: `electron.d.ts`

The renderer flattens the canvas to a PNG data URL; this handler decodes it to a temp file the Gemini and Higgsfield IPCs can read.

- [ ] **Step 1: Add the handler**

In `electron/ipc/media-import.ts`, add inside the same `registerMediaHandlers()` (or equivalent register function that holds `media:extract-frame`) — place it right after the `media:extract-frame` handler. Reuse the existing `os`, `path`, `crypto`, `fs` imports (verify `fs/promises` is imported; if only `fs` is present, use `fs.promises.writeFile`):

```typescript
  // Write a base64/dataURL image (the flattened Frame Chat drawing) to a temp PNG and return its path.
  ipcMain.handle('media:write-temp-image', async (_event, params: { dataUrl: string }): Promise<{ outputPath: string }> => {
    const match = params.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) throw new Error('media:write-temp-image expects a base64 image data URL.');
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const outputPath = path.join(os.tmpdir(), `cinegen-frame-chat-${crypto.randomUUID()}.${ext}`);
    await fs.promises.writeFile(outputPath, buffer);
    return { outputPath };
  });
```

- [ ] **Step 2: Expose in preload**

In `electron/preload.ts`, inside the `media:` object (after `extractFrame`, around line 124), add:

```typescript
    writeTempImage: (params: { dataUrl: string }) =>
      ipcRenderer.invoke('media:write-temp-image', params),
```

- [ ] **Step 3: Type it in electron.d.ts**

In `electron.d.ts`, find the `media:` block of the API typing and add:

```typescript
    writeTempImage: (params: { dataUrl: string }) => Promise<{ outputPath: string }>;
```

- [ ] **Step 4: Verify build + typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors related to `writeTempImage`.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/media-import.ts electron/preload.ts electron.d.ts
git commit -m "feat(media): write-temp-image IPC for flattened frame drawings"
```

---

## Task 5: Extend Higgsfield quickEdit with `drawnFramePath`

**Files:**
- Modify: `electron/ipc/higgsfield.ts:236-291`
- Modify: `electron/preload.ts` (param type only — `quickEdit` already forwards `params`)
- Modify: `electron.d.ts`
- Test: `tests/lib/higgsfield/quick-edit-drawn-frame.test.ts`

When the renderer sends a flattened drawn frame, use it as the reference image directly instead of re-extracting a clean frame from the source. We keep `prepareClipReference` for `first-last`/`segment` modes, but for a `frame`-mode generation with a `drawnFramePath`, the drawn PNG IS the reference.

- [ ] **Step 1: Write a failing unit test for the media-selection helper**

Create `tests/lib/higgsfield/quick-edit-drawn-frame.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { selectQuickEditMedias } from '../../../electron/ipc/higgsfield';

describe('selectQuickEditMedias', () => {
  it('uses the drawn frame path as the image reference when provided (frame mode)', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'frame', outputType: 'image',
      drawnFramePath: '/tmp/drawn.png', extractedPaths: ['/tmp/clean.jpg'], extractedRoles: ['image'],
    });
    expect(medias).toEqual([{ value: '/tmp/drawn.png', role: 'image' }]);
  });

  it('uses the drawn frame as start_image for a frame-mode video generation', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'frame', outputType: 'video',
      drawnFramePath: '/tmp/drawn.png', extractedPaths: ['/tmp/clean.jpg'], extractedRoles: ['image'],
    });
    expect(medias).toEqual([{ value: '/tmp/drawn.png', role: 'start_image' }]);
  });

  it('falls back to extracted paths when there is no drawn frame', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'first-last', outputType: 'video',
      extractedPaths: ['/tmp/a.jpg', '/tmp/b.jpg'], extractedRoles: ['start_image', 'end_image'],
    });
    expect(medias).toEqual([
      { value: '/tmp/a.jpg', role: 'start_image' },
      { value: '/tmp/b.jpg', role: 'end_image' },
    ]);
  });

  it('ignores the drawn frame for non-frame modes (first-last/segment keep extracted refs)', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'first-last', outputType: 'video',
      drawnFramePath: '/tmp/drawn.png', extractedPaths: ['/tmp/a.jpg', '/tmp/b.jpg'], extractedRoles: ['start_image', 'end_image'],
    });
    expect(medias).toEqual([
      { value: '/tmp/a.jpg', role: 'start_image' },
      { value: '/tmp/b.jpg', role: 'end_image' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/higgsfield/quick-edit-drawn-frame.test.ts`
Expected: FAIL — `selectQuickEditMedias` not exported.

- [ ] **Step 3: Implement the helper + wire it into the handler**

In `electron/ipc/higgsfield.ts`, first extend the interface (line 236-245):

```typescript
export interface QuickEditParams {
  fileRef: string;
  prompt: string;
  model: string;
  outputType: HiggsfieldMediaType;
  referenceMode: 'frame' | 'segment' | 'first-last';
  frameTimeSec?: number;
  sourceStartSec?: number;
  sourceEndSec?: number;
  /** Flattened drawn-on frame PNG (Frame Chat). When set with frame mode, used as the reference. */
  drawnFramePath?: string;
}
```

Add the exported pure helper (place above `registerHiggsfieldHandlers`):

```typescript
/**
 * Choose the media references for a Quick Edit generation. When the user drew on the frame
 * (frame mode), the flattened drawing IS the reference; otherwise use the extracted refs.
 */
export function selectQuickEditMedias(opts: {
  referenceMode: 'frame' | 'segment' | 'first-last';
  outputType: HiggsfieldMediaType;
  drawnFramePath?: string;
  extractedPaths: string[];
  extractedRoles: Array<'image' | 'start_image' | 'end_image'>;
}): HiggsfieldMedia[] {
  if (opts.drawnFramePath && opts.referenceMode === 'frame') {
    const role: HiggsfieldMedia['role'] = opts.outputType === 'video' ? 'start_image' : 'image';
    return [{ value: opts.drawnFramePath, role }];
  }
  return opts.extractedPaths.map((p, i) => ({
    value: p,
    role: (opts.extractedRoles[i] ?? 'image') as HiggsfieldMedia['role'],
  }));
}
```

Then in the `higgsfield:quick-edit` handler, replace the `medias = prepared.paths.map(...)` line (currently line 272) with a call through the helper:

```typescript
        console.log('[higgsfield:quick-edit] extracted refs:', prepared.paths);
        medias = selectQuickEditMedias({
          referenceMode: params.referenceMode,
          outputType: params.outputType,
          drawnFramePath: params.drawnFramePath,
          extractedPaths: prepared.paths,
          extractedRoles: prepared.roles,
        });
```

Also, when a `drawnFramePath` is present we can skip extraction entirely for frame mode. Replace the `if (localPath) { try { const prepared = ... } ... }` block's try body opener so that a drawn frame short-circuits:

```typescript
    if (params.drawnFramePath && params.referenceMode === 'frame') {
      // The user drew on the frame — that PNG is the reference; no extraction needed.
      medias = selectQuickEditMedias({
        referenceMode: 'frame', outputType: params.outputType,
        drawnFramePath: params.drawnFramePath, extractedPaths: [], extractedRoles: [],
      });
    } else if (localPath) {
      // ...existing extraction block unchanged...
```

(Keep the existing `else if (isRemote)` / `else` branches as-is. The `localPath` branch's inner `medias = ...` already routes through `selectQuickEditMedias` from the change above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/higgsfield/quick-edit-drawn-frame.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Update preload + electron.d.ts types and commit**

In `electron.d.ts`, extend the `quickEdit` param type to include `drawnFramePath?: string`. (`electron/preload.ts` forwards `params: unknown`, so no code change there — but if it has a typed signature, add `drawnFramePath?: string`.)

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

```bash
git add electron/ipc/higgsfield.ts electron.d.ts electron/preload.ts tests/lib/higgsfield/quick-edit-drawn-frame.test.ts
git commit -m "feat(higgsfield): use drawn frame as quick-edit reference"
```

---

## Task 6: FrameCanvas drawing component

**Files:**
- Create: `src/components/edit/frame-canvas.tsx`

A self-contained drawing surface. It loads the frame image (from a path the parent extracted via `media.extractFrame`, exposed as a `local-media://` or `file://` URL) into an `<img>` background, overlays a `<canvas>` for drawing, provides a tool toolbar, and exposes `flatten()` via a ref. No tests (canvas/DOM-heavy — verified manually in Task 9).

- [ ] **Step 1: Implement the component**

```typescript
// src/components/edit/frame-canvas.tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type FrameTool = 'brush' | 'rect' | 'ellipse' | 'arrow' | 'text';

export interface FrameCanvasHandle {
  /** Composite the frame image + drawing into one PNG data URL. Null if nothing to flatten. */
  flatten: () => string | null;
  clear: () => void;
}

interface FrameCanvasProps {
  /** Displayable URL for the extracted frame (file:// or local-media://). */
  frameUrl: string;
  width?: number;
  height?: number;
}

interface Stroke {
  tool: FrameTool;
  color: string;
  points: Array<{ x: number; y: number }>;
  text?: string;
}

const COLOR = '#ff3b30';

export const FrameCanvas = forwardRef<FrameCanvasHandle, FrameCanvasProps>(function FrameCanvas(
  { frameUrl, width = 512, height = 288 },
  ref,
) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<FrameTool>('brush');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineCap = 'round';
    ctx.font = '18px sans-serif';
    const all = drawingRef.current ? [...strokes, drawingRef.current] : strokes;
    for (const s of all) {
      const pts = s.points;
      if (s.tool === 'brush') {
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      } else if ((s.tool === 'rect' || s.tool === 'ellipse') && pts.length >= 2) {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        if (s.tool === 'rect') {
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        } else {
          ctx.beginPath();
          ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (s.tool === 'arrow' && pts.length >= 2) {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - 12 * Math.cos(angle - Math.PI / 6), b.y - 12 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(b.x - 12 * Math.cos(angle + Math.PI / 6), b.y - 12 * Math.sin(angle + Math.PI / 6));
        ctx.closePath(); ctx.fill();
      } else if (s.tool === 'text' && s.text && pts.length >= 1) {
        ctx.fillText(s.text, pts[0].x, pts[0].y);
      }
    }
  }, [strokes]);

  useEffect(() => { redraw(); }, [redraw]);

  const toPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (width / rect.width), y: (e.clientY - rect.top) * (height / rect.height) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toPoint(e);
    if (tool === 'text') {
      const text = window.prompt('Label text:')?.trim();
      if (text) setStrokes((prev) => [...prev, { tool, color: COLOR, points: [p], text }]);
      return;
    }
    drawingRef.current = { tool, color: COLOR, points: [p] };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(toPoint(e));
    redraw();
  };
  const onPointerUp = () => {
    if (drawingRef.current) setStrokes((prev) => [...prev, drawingRef.current!]);
    drawingRef.current = null;
  };

  useImperativeHandle(ref, () => ({
    flatten: () => {
      const img = imgRef.current;
      const draw = canvasRef.current;
      if (!img || !draw || !imgLoaded) return null;
      const out = document.createElement('canvas');
      out.width = width; out.height = height;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);
      ctx.drawImage(draw, 0, 0, width, height);
      return out.toDataURL('image/png');
    },
    clear: () => { setStrokes([]); drawingRef.current = null; },
  }), [imgLoaded, width, height]);

  return (
    <div className="frame-canvas">
      <div className="frame-canvas__tools">
        {(['brush', 'rect', 'ellipse', 'arrow', 'text'] as FrameTool[]).map((t) => (
          <button key={t} className={`frame-canvas__tool${tool === t ? ' is-active' : ''}`} onClick={() => setTool(t)}>{t}</button>
        ))}
        <button className="frame-canvas__tool" onClick={() => setStrokes((p) => p.slice(0, -1))}>undo</button>
        <button className="frame-canvas__tool" onClick={() => setStrokes([])}>clear</button>
      </div>
      <div className="frame-canvas__stage" style={{ position: 'relative', width, height }}>
        <img ref={imgRef} src={frameUrl} alt="frame" crossOrigin="anonymous" onLoad={() => setImgLoaded(true)}
          style={{ position: 'absolute', inset: 0, width, height, objectFit: 'contain', pointerEvents: 'none' }} />
        <canvas ref={canvasRef} width={width} height={height}
          style={{ position: 'absolute', inset: 0, width, height, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
      </div>
    </div>
  );
});
```

Note: ensure the import line reads exactly `import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';` — all six hooks are used.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `frame-canvas.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/frame-canvas.tsx
git commit -m "feat(frame-chat): drawing canvas component with brush/shape/arrow/text tools"
```

---

## Task 7: FrameChatModal (adaptive container + send/route)

**Files:**
- Create: `src/components/edit/frame-chat-modal.tsx`

Owns the persistent thread, decides State A/B from props, flattens the drawing on send, routes ask→Gemini / generate→Higgsfield-preview, and renders the result preview with a place button. State A shows `FrameCanvas`; both states show the thread + composer.

- [ ] **Step 1: Implement the modal**

```typescript
// src/components/edit/frame-chat-modal.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';
import { getCutVisionModel } from '@/lib/utils/api-key';
import {
  detectFrameChatIntent, deserializeThread, frameChatStorageKey, serializeThread,
  type FrameChatMessage,
} from '@/lib/edit/frame-chat-thread';
import { FrameCanvas, type FrameCanvasHandle } from './frame-canvas';

export interface FrameChatPlaceResult {
  sourceClipId: string;
  url: string;
  durationSec: number;
  label: string;
}

interface FrameChatModalProps {
  projectId: string;
  /** The clip under the playhead, if any (State A when present + has a frame). */
  clip?: Clip;
  asset?: Asset;
  /** Source time at the playhead within the clip, for frame extraction. */
  playheadSourceSec?: number;
  onPlaceResult: (result: FrameChatPlaceResult) => void;
  onClose: () => void;
}

async function writeTempImage(dataUrl: string): Promise<string> {
  const { outputPath } = await window.electronAPI.media.writeTempImage({ dataUrl });
  return outputPath;
}

export function FrameChatModal({ projectId, clip, asset, playheadSourceSec, onPlaceResult, onClose }: FrameChatModalProps) {
  const [messages, setMessages] = useState<FrameChatMessage[]>(() =>
    deserializeThread(typeof window !== 'undefined' ? localStorage.getItem(frameChatStorageKey(projectId)) : null));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const canvasRef = useRef<FrameCanvasHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);

  const hasFrame = Boolean(clip && asset && (asset.type === 'video' || asset.type === 'image') && frameUrl);

  // Persist thread
  useEffect(() => {
    try { localStorage.setItem(frameChatStorageKey(projectId), serializeThread(messages)); } catch {}
  }, [messages, projectId]);

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [messages, busy]);

  // Extract the frame at the playhead when over a clip.
  useEffect(() => {
    let cancelled = false;
    setFrameUrl(null);
    if (!clip || !asset || !(asset.type === 'video' || asset.type === 'image') || !asset.fileRef) return;
    const inputPath = asset.fileRef;
    if (asset.type === 'image') { setFrameUrl(inputPath.startsWith('http') || inputPath.startsWith('file') || inputPath.startsWith('local-media') ? inputPath : `file://${inputPath}`); return; }
    window.electronAPI.media.extractFrame({ inputPath, timeSec: playheadSourceSec ?? clip.trimStart }).then((res) => {
      if (cancelled || !res) return;
      setFrameUrl(`file://${res.outputPath}`);
    }).catch(() => { if (!cancelled) setFrameUrl(null); });
    return () => { cancelled = true; };
  }, [clip, asset, playheadSourceSec]);

  const addMessage = useCallback((m: FrameChatMessage) => setMessages((prev) => [...prev, m]), []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    const intent = detectFrameChatIntent(text);
    const drawnDataUrl = hasFrame ? canvasRef.current?.flatten() ?? null : null;
    const userMsg: FrameChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: new Date().toISOString(), intent };
    addMessage(userMsg);
    setDraft('');
    canvasRef.current?.clear();
    setBusy(true);

    try {
      let drawnPath: string | null = null;
      if (drawnDataUrl) drawnPath = await writeTempImage(drawnDataUrl);

      if (intent === 'ask') {
        const visualRefs = drawnPath
          ? [{ label: asset?.name ?? 'frame', kind: 'asset' as const, mediaType: 'image' as const, fileRef: drawnPath }]
          : [];
        const res = await window.electronAPI.llm.geminiChat({
          userMessage: text,
          model: getCutVisionModel(),
          resumeSessionId: sessionIdRef.current,
          visualRefs,
        }) as { message: string; sessionId?: string };
        sessionIdRef.current = res.sessionId ?? sessionIdRef.current;
        addMessage({ id: crypto.randomUUID(), role: 'assistant', content: res.message || '(no response)', createdAt: new Date().toISOString() });
      } else {
        // generate — propose, with the route + drawn frame captured for confirm
        const route = routeQuickEdit(text);
        addMessage({
          id: crypto.randomUUID(), role: 'assistant',
          content: `I can generate that — ${route.reason}. Press Generate to run it.`,
          createdAt: new Date().toISOString(),
          generation: {
            model: route.model, outputType: route.outputType, referenceMode: route.referenceMode,
            sourceClipId: clip!.id, status: 'proposed',
          },
        });
        // Stash the drawn path + prompt on the message via a side map keyed by message id.
        pendingGenRef.current[messages.length] = { prompt: text, drawnPath };
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, hasFrame, asset, clip, messages.length, addMessage]);

  // Holds prompt+drawnPath for proposed generations until the user presses Generate.
  const pendingGenRef = useRef<Record<number, { prompt: string; drawnPath: string | null }>>({});

  const handleGenerate = useCallback(async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.generation || !clip || !asset?.fileRef) return;
    const pending = pendingGenRef.current[msgIndex];
    if (!pending) return;
    setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation ? { ...m, generation: { ...m.generation, status: 'generating' } } : m));
    try {
      const sourceStartSec = clip.trimStart;
      const sourceEndSec = clip.duration - clip.trimEnd;
      const res = await window.electronAPI.higgsfield.quickEdit({
        fileRef: asset.fileRef, prompt: pending.prompt,
        model: msg.generation.model, outputType: msg.generation.outputType, referenceMode: msg.generation.referenceMode,
        frameTimeSec: playheadSourceSec, sourceStartSec, sourceEndSec,
        drawnFramePath: pending.drawnPath ?? undefined,
      }) as { url: string; durationSec?: number };
      const durationSec = res.durationSec ?? clipEffectiveDuration(clip);
      setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation
        ? { ...m, generation: { ...m.generation, status: 'ready', resultUrl: res.url, resultDurationSec: durationSec } } : m));
    } catch (err) {
      setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation
        ? { ...m, generation: { ...m.generation, status: 'failed', error: err instanceof Error ? err.message : String(err) } } : m));
    }
  }, [messages, clip, asset, playheadSourceSec]);

  const handlePlace = useCallback((msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.generation?.resultUrl || !msg.generation.resultDurationSec) return;
    onPlaceResult({
      sourceClipId: msg.generation.sourceClipId, url: msg.generation.resultUrl,
      durationSec: msg.generation.resultDurationSec, label: messages[msgIndex - 1]?.content.slice(0, 40) ?? 'Frame Chat',
    });
    setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation ? { ...m, generation: { ...m.generation, status: 'placed' } } : m));
  }, [messages, onPlaceResult]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fcm__backdrop" onMouseDown={onClose}>
      <div className={`fcm${hasFrame ? ' fcm--with-frame' : ''}`} role="dialog" aria-modal="true" aria-label="Frame Chat" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        {hasFrame && frameUrl && (
          <div className="fcm__canvas-pane">
            <FrameCanvas ref={canvasRef} frameUrl={frameUrl} />
          </div>
        )}
        <div className="fcm__chat-pane">
          <div className="fcm__thread" ref={threadRef}>
            {messages.length === 0 && <div className="fcm__empty">Ask about your project, or describe a change to generate.</div>}
            {messages.map((m, i) => (
              <div key={m.id} className={`fcm__msg fcm__msg--${m.role}`}>
                <div className="fcm__msg-content">{m.content}</div>
                {m.generation && (
                  <div className="fcm__gen">
                    {m.generation.status === 'proposed' && <button onClick={() => void handleGenerate(i)}>Generate</button>}
                    {m.generation.status === 'generating' && <span>Generating…</span>}
                    {m.generation.status === 'ready' && m.generation.resultUrl && (
                      <div>
                        {m.generation.outputType === 'video'
                          ? <video src={m.generation.resultUrl} muted loop autoPlay style={{ maxWidth: 220, borderRadius: 6 }} />
                          : <img src={m.generation.resultUrl} alt="result" style={{ maxWidth: 220, borderRadius: 6 }} />}
                        <button onClick={() => handlePlace(i)}>Add to timeline</button>
                      </div>
                    )}
                    {m.generation.status === 'placed' && <span>Placed above the clip ✓</span>}
                    {m.generation.status === 'failed' && <span className="fcm__error">{m.generation.error}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {error && <div className="fcm__error">{error}</div>}
          <div className="fcm__composer">
            <textarea value={draft} disabled={busy} placeholder={hasFrame ? 'Ask about the frame, or describe a change…' : 'Ask anything, or describe a change…'}
              onChange={(e) => setDraft(e.target.value)} rows={2} />
            <button onClick={() => void handleSend()} disabled={!draft.trim() || busy}>{busy ? '…' : 'Send'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note on `pendingGenRef`: declare it ABOVE `handleSend` (hoist the `useRef` line so it is defined before use). Move `const pendingGenRef = useRef<...>({});` to sit with the other refs near the top of the component.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: resolve any `window.electronAPI` typing gaps by ensuring `electron.d.ts` declares `media.writeTempImage`, `media.extractFrame`, `llm.geminiChat`, `higgsfield.quickEdit`. Fix the ref-ordering note. No errors when done.

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/frame-chat-modal.tsx
git commit -m "feat(frame-chat): adaptive modal with ask/generate routing and result preview"
```

---

## Task 8: Minimal styles for the modal

**Files:**
- Modify: the editor stylesheet that defines `.fgm` (search for it).

- [ ] **Step 1: Find where `.fgm` (old Quick Edit) styles live**

Run: `grep -rln "fgm__backdrop\|\.fgm\b" src/styles src/components`
Use that file. Add `.fcm` styles mirroring `.fgm` plus the two-pane layout.

- [ ] **Step 2: Add styles**

Append to that stylesheet:

```css
.fcm__backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.fcm { display: flex; background: var(--bg-panel, #16161a); border: 1px solid var(--border-subtle, #333); border-radius: 8px; overflow: hidden; max-width: 90vw; max-height: 80vh; }
.fcm--with-frame .fcm__canvas-pane { padding: 10px; border-right: 1px solid var(--border-subtle, #333); }
.fcm__chat-pane { display: flex; flex-direction: column; width: 360px; min-height: 360px; }
.fcm__thread { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.fcm__empty { opacity: .6; font-size: 13px; padding: 16px; }
.fcm__msg--user { align-self: flex-end; background: var(--accent-soft, #2a2a35); border-radius: 8px; padding: 6px 10px; max-width: 85%; }
.fcm__msg--assistant { align-self: flex-start; max-width: 95%; }
.fcm__gen { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.fcm__composer { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border-subtle, #333); }
.fcm__composer textarea { flex: 1; resize: none; background: var(--bg-input, #1a1a1f); color: inherit; border: 1px solid var(--border-subtle, #333); border-radius: 6px; padding: 8px; font-family: inherit; }
.fcm__error { color: var(--danger, #e66); font-size: 12px; padding: 4px 8px; }
.frame-canvas__tools { display: flex; gap: 4px; margin-bottom: 6px; flex-wrap: wrap; }
.frame-canvas__tool { font-size: 11px; padding: 3px 8px; background: var(--bg-input, #1a1a1f); border: 1px solid var(--border-subtle, #333); border-radius: 4px; color: inherit; cursor: pointer; }
.frame-canvas__tool.is-active { background: var(--accent, #4a6cf7); color: #fff; }
```

- [ ] **Step 3: Commit**

```bash
git add <the stylesheet>
git commit -m "feat(frame-chat): modal and canvas styles"
```

---

## Task 9: Wire into timeline-editor (shortcut + placement)

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`

- [ ] **Step 1: Replace the shortcut handler to open Frame Chat without requiring a selection**

In the `Cmd/Ctrl+Shift+Space` effect (around line 1416-1443), keep the editable-clip resolution but DO NOT bail when nothing is editable — instead open the modal with no clip. Replace the body after `e.preventDefault();`:

```typescript
      const selected = selectedClipIdsRef.current;
      const tl = timelineRef.current;
      const videoTrackIds = new Set(tl.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
      const selectedClips = [...selected].map((id) => tl.clips.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
      const editable = selectedClips
        .map((c) => ({ clip: c, asset: state.assets.find((a) => a.id === c.assetId) }))
        .filter((x) => x.asset && videoTrackIds.has(x.clip.trackId) && (x.asset.type === 'video' || x.asset.type === 'image'));
      // Exactly one editable clip → State A; otherwise open chat-only (State B).
      setFrameChatClipId(editable.length === 1 ? editable[0].clip!.id : null);
      setFrameChatOpen(true);
```

Add state near `quickEditClipId` (line 135):

```typescript
  const [frameChatOpen, setFrameChatOpen] = useState(false);
  const [frameChatClipId, setFrameChatClipId] = useState<string | null>(null);
```

- [ ] **Step 2: Add the place-result handler (overlay above, aligned)**

Add near `handleQuickEditStartGeneration` (line 2398). Reuse `addTrackAbove`, `addClipToTrack`, `clipEffectiveDuration`, `generateId`, `dispatch`:

```typescript
  const handleFrameChatPlaceResult = useCallback(
    ({ sourceClipId, url, durationSec, label }: { sourceClipId: string; url: string; durationSec: number; label: string }) => {
      const tl = timelineRef.current;
      const sourceClip = tl.clips.find((c) => c.id === sourceClipId);
      if (!sourceClip) return;

      // Ensure a video track directly above the source clip's track.
      const videoTracks = tl.tracks.filter((t) => t.kind === 'video');
      const sourceVideoIndex = videoTracks.findIndex((t) => t.id === sourceClip.trackId);
      const aboveTrack = sourceVideoIndex >= 0 ? videoTracks[sourceVideoIndex + 1] : undefined;

      let workingTl = tl;
      let targetTrackId: string;
      if (aboveTrack) {
        targetTrackId = aboveTrack.id;
      } else {
        const result = addTrackAbove(tl, sourceClip.trackId, 'video');
        workingTl = result.timeline;
        targetTrackId = result.trackId;
      }

      const assetId = generateId();
      const placedAsset: Asset = {
        id: assetId, name: label, type: 'video', url,
        duration: clipEffectiveDuration(sourceClip),
        metadata: { generatedVia: 'frame-chat', sourceClipId },
      } as unknown as Asset;
      dispatch({ type: 'ADD_ASSET', asset: placedAsset });

      // Align to the source clip: same startTime, fit to the source's effective duration.
      const withClip = addClipToTrack(workingTl, targetTrackId, placedAsset, sourceClip.startTime);
      const placed = withClip.clips.find((c) => c.assetId === assetId && c.trackId === targetTrackId);
      const fitted = placed
        ? { ...withClip, clips: withClip.clips.map((c) => c.id === placed.id ? { ...c, duration: clipEffectiveDuration(sourceClip), trimStart: 0, trimEnd: 0 } : c) }
        : withClip;
      setTimeline(fitted);
    },
    [dispatch, setTimeline],
  );
```

Add the import at the top with the other `timeline-operations` imports: `addTrackAbove`.

- [ ] **Step 3: Render FrameChatModal; remove QuickEditModal**

Replace the `quickEditClipId` IIFE block (lines 3244-3261) with:

```typescript
      {frameChatOpen && (() => {
        const fcClip = frameChatClipId ? timeline.clips.find((c) => c.id === frameChatClipId) : undefined;
        const fcAsset = fcClip ? assets.find((a) => a.id === fcClip.assetId) : undefined;
        const intoClip = fcClip ? Math.max(0, currentTimeRef.current - fcClip.startTime) : 0;
        const playheadSourceSec = fcClip ? fcClip.trimStart + Math.min(intoClip, clipEffectiveDuration(fcClip)) : undefined;
        return (
          <FrameChatModal
            projectId={projectId}
            clip={fcClip}
            asset={fcAsset}
            playheadSourceSec={playheadSourceSec}
            onPlaceResult={handleFrameChatPlaceResult}
            onClose={() => { setFrameChatOpen(false); setFrameChatClipId(null); }}
          />
        );
      })()}
```

Update imports: remove `import { QuickEditModal } from './quick-edit-modal';` (line 11), add `import { FrameChatModal } from './frame-chat-modal';`. Confirm `projectId` is available as a prop in this component (it is used elsewhere — if not in scope, thread it from the parent).

- [ ] **Step 4: Remove now-dead quick-edit state/handler**

Delete `const [quickEditClipId, setQuickEditClipId] = useState<string | null>(null);` (line 135) and `handleQuickEditStartGeneration` (lines 2398-2441) if nothing else references them. Run `grep -n "quickEditClipId\|handleQuickEditStartGeneration\|setQuickEditClipId" src/components/edit/timeline-editor.tsx` and remove all remaining references.

- [ ] **Step 5: Typecheck + run full test suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/edit/timeline-editor.tsx
git commit -m "feat(frame-chat): open from shortcut, place results as overlay above clip"
```

---

## Task 10: Delete the old Quick Edit modal

**Files:**
- Delete: `src/components/edit/quick-edit-modal.tsx`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "quick-edit-modal\|QuickEditModal" src/`
Expected: no matches (Task 9 removed the import). If any remain, fix them first.

- [ ] **Step 2: Delete and verify build**

```bash
git rm src/components/edit/quick-edit-modal.tsx
npx tsc --noEmit -p tsconfig.json && npx vitest run
```
Expected: clean typecheck, all tests pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(frame-chat): remove superseded quick-edit modal"
```

---

## Task 11: Manual verification

- [ ] **Step 1: Build and launch**

Run: `npm run build` then launch the app (existing run flow).

- [ ] **Step 2: Verify State B (chat only)**

Move the playhead over a gap / deselect everything. Press `Cmd+Shift+Space`. Expect a chat-only modal. Ask "how long is my current cut?" — expect a Gemini text answer, no canvas, no generation.

- [ ] **Step 3: Verify State A (canvas + chat)**

Select a single video clip, position the playhead over it, press `Cmd+Shift+Space`. Expect the extracted frame with draw tools beside the chat. Draw a box around an object, type "what is inside the box?" — expect a Gemini answer referencing the drawn region.

- [ ] **Step 4: Verify generate + place-above**

With the same frame, draw on a subject and type "make this red". Expect an assistant message with a **Generate** button. Click it; expect "Generating…" then an inline result preview with **Add to timeline**. Click it; confirm a new clip appears on a video track **directly above** the source clip, aligned to its start and duration. Confirm a track was auto-created if none existed above.

- [ ] **Step 5: Verify thread persistence**

Close the modal, reopen with the shortcut — the prior conversation is still there.

- [ ] **Step 6: Final commit (if any tweaks)**

```bash
git add -A && git commit -m "test(frame-chat): manual verification pass"
```

---

## Self-Review Notes

- **Spec coverage:** adaptive A/B (Tasks 7, 9) · persistent thread (Tasks 2, 7) · auto-detect intent (Task 1) · Gemini ask with drawn frame (Task 7, reuses existing `visualRefs` image path — no IPC change needed) · generate preview-then-confirm (Task 7) · overlay-above-aligned placement + auto-create track (Tasks 3, 9) · all four draw tools + brush + text (Task 6) · drawn frame as Higgsfield reference (Task 5) · temp-image bridge (Task 4) · old modal removed (Task 10).
- **Type consistency:** `FrameChatMessage`/`FrameChatGenerationPreview` defined in Task 2, used in Task 7. `addTrackAbove` returns `{ timeline, trackId }` (Task 3) and is consumed that way in Task 9. `selectQuickEditMedias` shape (Task 5) matches the handler wiring. `FrameCanvasHandle.flatten()` returns `string | null` (Task 6), consumed in Task 7.
- **Known follow-ups (not blocking):** citation rendering in chat answers is plain text in this plan (markdown/citation reuse from `llm-tab.tsx` is a possible enhancement); `/clip` `/asset` mentions in Frame Chat are out of scope for v1.
```
