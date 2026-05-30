# Frame Chat — Quick Edit Redesign

**Date:** 2026-05-29
**Status:** Approved (design)
**Supersedes:** the one-shot Quick Edit modal (`src/components/edit/quick-edit-modal.tsx`)

## Problem

The current Quick Edit is a one-shot textarea: select a clip, press `Cmd/Ctrl+Shift+Space`, type a prompt, and it routes straight to a Higgsfield generation (`routeQuickEdit` → `higgsfield.quickEdit`). It cannot answer questions, requires a selected clip, and has no way to point at *what* in the frame you mean.

Higgsfield's new Premiere tool demonstrates a better interaction: draw on the video frame to indicate a change, with a prompt. We want that, plus a conversational chat that can also *answer questions* about the video — a lightweight version of the main LLM chat tab, reachable from a shortcut, that works with or without a clip selected.

## Goals

- Shortcut opens a **persistent, chat-first** panel — no clip selection required.
- When the playhead is over a video/image clip, show the **extracted frame with drawing tools**; the drawing + prompt become visual context.
- **Auto-detect intent** from the prompt: *ask a question* (vision answer, no credits) vs *request a change* (Higgsfield generation).
- Generated results **preview in the chat first**; the user confirms before anything lands on the timeline.
- On confirm, place the result as an **overlay above the selected clip, aligned to it**.

## Non-Goals

- Replacing the main LLM chat tab (`llm-tab.tsx`). This is a focused quick panel; it reuses pieces but stays separate.
- Multi-clip editing. Intent resolution still targets a single editable clip (existing behavior).
- New generation backends. Generation stays on the existing `higgsfield.quickEdit` path.

## Behavior Overview

The shortcut (`Cmd/Ctrl+Shift+Space`) opens **Frame Chat** regardless of selection. The modal is **adaptive**:

- **State B — chat only:** playhead is over a gap, an audio-only clip, or nothing editable is selected. No frame to show. Pure chat composer.
- **State A — canvas + chat:** playhead is over a video/image clip. Left: the extracted frame at the playhead with drawing tools. Right: the chat thread + composer.

The layout is chosen when the modal opens, from the same playhead/selection logic the current shortcut uses (`timeline-editor.tsx:1416-1443`). One **continuous thread** persists across opens and across A/B switches; **frames attach per-message** (the frame baked in at the moment you send).

## Intent Routing (auto-detected)

On send, the prompt text decides the intent:

- **Generate intent** — the prompt matches `routeQuickEdit`'s change-verb rules (`make / remove / change / replace / wear / extend / stylize / clean plate …`). Routes to a Higgsfield generation.
- **Ask intent** — anything else: questions (`what / why / how / is / does / where / who …`) and prompts with no clear change-verb. Routes to a Gemini vision answer.
- **Ambiguity default:** if a prompt is neither a clear change request nor a question (e.g. "the car"), it defaults to **ask** (no credits spent). The assistant may then offer to generate.

Intent detection lives in a pure helper (`frame-chat-thread.ts`) that wraps `routeQuickEdit` (already rules-tested) and adds a question/verb classifier adapted from `inferAutoWorkMode` in `llm-tab.tsx`.

## Data Flow

Every send may carry an optional **flattened frame**: the extracted frame image with the user's drawing baked into a single PNG, written to a temp file.

### Ask turn

1. If a frame is attached, flatten canvas → temp PNG.
2. Call `geminiChat({ userMessage: prompt, visualRefs: [<drawn-frame image ref>], resumeSessionId, … })`.
3. Stream the text answer into the thread. No generation, no credits, nothing placed.

The chat may also reference selected `/clip` or `/asset` mentions (reusing the existing visual-ref plumbing) so the user can ask about the broader video, not just the frame.

### Generate turn

1. Flatten canvas → temp PNG.
2. `routeQuickEdit(prompt)` selects the Higgsfield model + reference mode + output type.
3. **Answer-first, generate-on-confirm:** the assistant replies in-thread with a short confirmation describing what it will do, plus a **Generate** button.
4. On click → `higgsfield.quickEdit({ fileRef, prompt, model, outputType, referenceMode, frameTimeSec, sourceStartSec, sourceEndSec, drawnFramePath })`.
   - The **drawn frame PNG** is passed as the reference image so the user's marks guide the edit. This is the point of drawing — without it, the drawing is decorative. (See "IPC Changes" — `quickEdit` gains an optional `drawnFramePath` that, when present, is used as the reference frame instead of re-extracting a clean frame at `frameTimeSec`.)
5. The result previews **inline in the chat** as a thumbnail with an **Add to timeline** button. Nothing touches the timeline until clicked.

## Placement (on confirm)

When the user clicks **Add to timeline** on a previewed result:

- Place the new clip on the **video track directly above** the selected clip's track, **aligned to the clip**: same `startTime`, duration trimmed/fit to the source clip's effective duration. It sits directly on top as an overlay.
- **Track ordering:** video tracks render reversed (`timeline-editor.tsx:3158,3198` — `[...videoTracks].reverse()`), so the *last* video track in the array is the *top* track. To place "directly above the selected clip," insert the new video track immediately **after** the source track's position within the video-track group. (`addTrack` currently appends to the end of the video group — we need an index-aware insert, or insert + reorder. Implementation will add an `addTrackAbove(timeline, targetTrackId)` helper or extend `addTrack` with an optional insert-after-track-id.)
- **No track above:** auto-create one (no prompt) and place there.
- This **overrides** `routeQuickEdit`'s per-intent `placement` field — every Frame Chat generation places as "overlay above, aligned." `routeQuickEdit` is kept for model + reference + output-type selection only; its `placement` is unused here.
- Because the result is already in hand at confirm time (preview happened first), the clip is placed as a **finished** clip — no pending/generating placeholder needed at placement. (The generating state is shown in the chat during step 3–4, not on the timeline.)

## Components & Files

### New

- **`src/components/edit/frame-chat-modal.tsx`** — adaptive container. Replaces `quick-edit-modal.tsx`. Owns thread state, picks State A vs B from props (`clip`/`asset`/`playheadSourceSec` optional now), renders `FrameCanvas` (State A only) + `FrameChatThread` + `Composer`. Calls `onPlaceResult(clipId, result)` when the user confirms placement.
- **`src/components/edit/frame-canvas.tsx`** — drawing surface. Renders the extracted-frame `<img>` beneath an HTML `<canvas>`. Toolbar: **brush, rectangle, ellipse, arrow, text, undo, clear**. Exposes `flatten(): Promise<Blob>` (frame + drawing composited to one PNG). Drawing state is local; cleared per send (each message gets a fresh canvas, or "keep marks" — default: clear after send).
- **`src/lib/edit/frame-chat-thread.ts`** — pure helpers: `FrameChatMessage` types, `detectFrameChatIntent(prompt): 'ask' | 'generate'` (wraps `routeQuickEdit` + question/verb classifier), thread persistence keyed per project (`localStorage`, same pattern as `llm-tab.tsx`).

### Modified

- **`src/components/edit/timeline-editor.tsx`** — the shortcut handler opens `FrameChatModal` instead of `QuickEditModal`; it no longer bails when nothing editable is selected (opens in State B). Replace `handleQuickEditStartGeneration` usage with an `onPlaceResult` handler that builds the overlay-above placement. Remove `quickEditClipId`-gated `QuickEditModal` render; render `FrameChatModal` (always available via shortcut).
- **`src/lib/editor/timeline-operations.ts`** — add `addTrackAbove(timeline, targetTrackId, kind)` (or extend `addTrack` with an optional insert position) so the overlay track lands directly above the source track in the reversed render order.
- **`electron/ipc/gemini-cli.ts` / `electron/ipc/copilot-visual-media.ts`** — allow a **direct image path** as a visual ref (the flattened drawn frame), not only a source `fileRef`. Today `prepareCopilotVisualRefs` resolves `fileRef` → staged file; add a branch for an already-prepared image path so the drawn PNG reaches Gemini via the existing `@path` mechanism.
- **`electron/ipc/higgsfield.ts`** (`higgsfield:quick-edit`) — accept optional `drawnFramePath`; when present, use it as the reference image instead of re-extracting a clean frame at `frameTimeSec`.
- **`electron/preload.ts`** — extend the `higgsfield.quickEdit` and `geminiChat` param types accordingly.

### Reused as-is

- `routeQuickEdit` (`src/lib/higgsfield/quick-edit-intent.ts`) — model/reference/output-type selection.
- `media.extractFrame` IPC — frame at the playhead.
- `geminiChat` IPC — vision answers (extended for direct image refs).
- `higgsfield.quickEdit` IPC — generation (extended for `drawnFramePath`).
- Citation rendering / markdown from `llm-tab.tsx` — for chat answers (extract shared bits if cheap; otherwise a trimmed local renderer).

## Error Handling

- **No local source file** for the clip (no `fileRef`): State A still opens for *ask* turns if a frame can be extracted; *generate* turns show the existing inline error ("This clip has no local source file.").
- **Frame extraction fails:** fall back to State B (chat only) with a note that the frame couldn't be loaded.
- **Gemini CLI not installed:** ask turns surface the existing install hint; the modal stays open.
- **Generation fails:** error shows inline in the chat thread (the preview step), nothing is placed. The user can retry from the same message.
- **Generation cancel:** the in-flight generation can be cancelled from the chat; no placeholder is left on the timeline (placement only happens on confirm).

## Testing

- **`frame-chat-thread.test.ts`** — `detectFrameChatIntent`: change-verb prompts → `generate`; questions → `ask`; ambiguous → `ask`. Reuses/extends the existing `routeQuickEdit` rule coverage.
- **`timeline-operations.test.ts`** — `addTrackAbove`: new track lands directly above the target in reversed render order; auto-creates when none exists; aligns `startTime` and duration to the source clip.
- **Component smoke (existing harness):** modal opens in State B with nothing selected; opens in State A over a video clip; sending an ask prompt calls `geminiChat`; sending a generate prompt shows a Generate button (not an immediate generation); confirming places an overlay clip above the source.
- **Manual:** draw a box on a frame, type "make the car red," confirm the drawn PNG reaches Higgsfield as the reference; confirm placement sits visually above the source clip.

## Open Implementation Notes

- `addTrack` appends to the end of the video group; the new helper must insert at the right index for "directly above the selected clip" given the reversed render.
- Decide whether drawing marks clear after each send (default: yes) or persist until the playhead moves.
- The flattened PNG temp files should live under a `cinegen-frame-chat` temp dir and be cleaned opportunistically (same pattern as `cinegen-higgsfield-refs` / `cinegen-gemini-visual-refs`).

## Post-implementation follow-ups (deferred — low impact)

- **Extend drawings are silently ignored.** `routeQuickEdit` returns `referenceMode:'first-last'` for "extend", and `selectQuickEditMedias` only uses the drawn frame when `referenceMode==='frame'`. So an extend request ignores the user's drawing (correct — extend needs source endpoints) but gives no feedback. Consider hiding/disabling the canvas or noting "drawing not used for extend" when `route.referenceMode !== 'frame'`.
- **Frame-extraction failure falls back to chat-only silently.** If `media.extractFrame` returns null (ffmpeg failure), the modal drops to State B with no notice. Consider a small inline "couldn't load the frame" message.
- **Frame URL passthrough caveat.** Frame URLs now route through `toFileUrl` → `local-media://` (canvas-clean). A `fileRef` that is already a bare `file://` URL is passed through unchanged and would still taint the canvas — not observed in practice (the app uses `local-media://`/raw paths), but worth normalizing if such refs ever appear.

## Version stack (added post-launch)

The left viewer now shows a version stack: index 0 is the original extracted frame; each confirmed
generation pushes (or, in Replace mode, overwrites) a version. Version tabs (Orig · v1 · v2 …) overlay
the top-right of the frame; a New version / Replace toggle controls iteration. The currently-shown
version is the base for the next edit — when a generated IMAGE version is active and the user hasn't
drawn a fresh annotation, its URL is passed as the Higgsfield reference so edits stack.

- **Known limitation:** a VIDEO result set as the active version renders in FrameCanvas's `<img>`,
  which won't display (and can't be drawn on meaningfully). Image versions are the common path.
  Follow-up: render video versions with a `<video>` element in the viewer, or disable drawing for them.
