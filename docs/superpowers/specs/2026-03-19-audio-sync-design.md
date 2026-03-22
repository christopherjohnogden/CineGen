# Audio Sync Feature Design

## Overview

Sync externally recorded audio to video clips with scratch audio, using timecode-based sync (instant, when available) with Chromaprint waveform fingerprint fallback (handles any duration). Two entry points: timeline right-click for individual clips, and media pool right-click for batch sync with automatic timeline creation.

## Entry Points

### 1. Timeline Right-Click — "Sync Audio"

Two behaviors based on selection state:

**Case A — Two clips selected (one video, one audio):**
- Context menu shows "Sync Audio" as a direct action
- Runs `sync:compute-offset` on the two clips' underlying assets
- Shows a confirmation popover with offset result, method used, and scratch audio handling toggle
- On confirm: adjusts audio clip position, links via `linkedClipId`

**Case B — One video clip selected:**
- Context menu shows "Sync Audio..."
- Opens the Single Sync Dialog where user picks an audio source from the media pool or an existing timeline audio clip
- Then same sync + link flow as Case A

**Disabled state:** Menu item disabled if selection doesn't include at least one video clip.

### 2. Media Pool Right-Click — "Create Timeline with Synced Audio"

- User selects multiple video assets + audio assets in the media pool
- Right-click → "Create Timeline with Synced Audio"
- Triggers batch matching pipeline
- Opens Batch Sync Dialog with proposed pairs
- On confirm: creates a new timeline with all clips synced and linked

## Core Sync Engine

### Pipeline

```
Input: sourceAssetId (video with scratch audio), targetAssetId (external audio)
                              |
                    +--------------------+
                    |  1. Try TC Sync    |
                    |  FFprobe both for  |
                    |  timecode metadata |
                    +--------+-----------+
                             |
                    TC found on both?
                    +---yes--+---no-----+
                    v                   v
            Calculate offset    +---------------+
            from TC difference  | 2. Chromaprint |
            Return immediately  | fpcalc both   |
                                | files, cross- |
                                | correlate     |
                                | fingerprints  |
                                +-------+-------+
                                        v
                                 Return offset
                                 (in seconds)
```

### Timecode Sync

- Extract timecode via FFprobe from both files, checking multiple locations:
  - `format.tags.timecode`
  - `stream.tags.timecode` (per-stream, especially video stream)
  - `com.apple.quicktime.timecode` (QuickTime-specific)
  - Stream `start_time` as fallback
- Parse timecode strings (HH:MM:SS:FF or HH:MM:SS;FF for drop-frame) to frame count using the video's FPS
- Calculate offset as frame difference converted to seconds
- Instant — no audio processing needed

### Chromaprint Waveform Sync

**fpcalc binary:**
- Unlike FFmpeg/FFprobe (which use npm packages `ffmpeg-static`/`ffprobe-static`), there is no equivalent npm package for fpcalc
- Bundle fpcalc in Electron Builder's `extraResources` with a custom path resolver
- Add a `getFpcalcPath()` function to `electron/lib/ffmpeg-paths.ts` that resolves the binary from `process.resourcesPath` (packaged) or a known dev-time path
- Platform-specific binaries for macOS (arm64 + x86_64) downloaded during postinstall or committed to a `vendor/` directory
- The path resolver handles both `app.asar.unpacked` (packaged) and local dev paths

**Fingerprint extraction:**
```
fpcalc -raw -json -length 0 <audio_file>
-> { "duration": 185.3, "fingerprint": [int32, int32, ...] }
```

For video scratch audio: first extract audio to a temp WAV via FFmpeg (reuse existing waveform extraction pattern), then run fpcalc on that temp file.

**Cross-correlation algorithm:**
- Chromaprint fingerprints are arrays of 32-bit integers (~8 ints/sec, ~0.1238s per int)
- Compare using bit-error-rate: XOR each pair of ints, count differing bits (popcount)
- Slide one fingerprint array across the other, sum bit errors at each offset
- The offset with the lowest total error is the match point
- Convert fingerprint-index offset to seconds: `offset * 0.1238`
- Runs in milliseconds even for hour-long recordings (~29,000 ints per hour)
- **Confidence metric**: normalized bit-error-rate at the best offset. Score = `1 - (avgBitErrors / 32)` where `avgBitErrors` is the mean popcount of XOR results across the aligned region. Score > 0.6 = good match (green), 0.4-0.6 = uncertain (yellow), < 0.4 = poor match (red). Threshold for "matched" in batch mode: >= 0.4. Below that, try next candidate pair.
- **Temp file cleanup**: temp WAV files extracted for fingerprinting are deleted immediately after fpcalc completes, in a `finally` block

**Edge case — video with no audio stream:**
- Before attempting waveform sync, check if the video has an audio stream via FFprobe (`streams[].codec_type === 'audio'`)
- If no audio stream: skip waveform sync, return an error for single sync ("Video has no audio to match against"), or mark as unmatched in batch mode (name-only matching with no offset, user must manually place)

### Worker Architecture

Sync operations run as new job types in the existing `media-worker.ts` job queue, not as a separate worker. This ensures proper concurrency management with other media jobs (thumbnail generation, proxy creation, etc.).

New job types:
- `sync_compute_offset` — priority 0 (highest, same as metadata extraction). Cost: 2 (involves multiple subprocess calls). Takes `{ sourceAssetId, targetAssetId, sourceFilePath, targetFilePath }`, returns `{ offsetSeconds, method, confidence }`.
- `sync_batch_match` — priority 0, cost 2. Takes `{ videoAssets: Array<{id, filePath, name}>, audioAssets: Array<{id, filePath, name}> }`. Runs name scoring first (no subprocess), then dispatches individual `sync_compute_offset` sub-jobs for top candidates sequentially.

The actual sync logic (TC extraction, fpcalc invocation, cross-correlation) lives in `electron/workers/audio-sync.ts` as pure functions called by the media worker — not as a separate worker thread.

### IPC Channels

- `sync:compute-offset` — takes two asset IDs, submits a `sync_compute_offset` job to media worker, returns `{ offsetSeconds: number, method: 'timecode' | 'waveform', confidence: number }`
- `sync:batch-match` — takes arrays of video asset IDs + audio asset IDs, submits `sync_batch_match` job to media worker. Progress updates sent via `sync:batch-progress` events on the BrowserWindow (`{ completedPairs: number, totalPairs: number, currentPair: { videoName, audioName, status } }`), final result returned as the IPC handle response.

## Batch Matching (Media Pool)

### Matching Algorithm

1. **Name-based pre-scoring** — compare filenames stripped of extensions using string similarity (Levenshtein distance). `scene_01.mov` <-> `scene_01.wav` gets a high score. Produces candidate pairs ranked by name similarity.

2. **Chromaprint verification** — for the top candidate pair per video, run fingerprint correlation to get the precise offset. If correlation is weak (below threshold), try the next candidate.

3. **Unmatched handling** — any videos/audio files that couldn't be paired get added to the timeline unlinked, placed at the end.

### Result Structure

```typescript
interface BatchMatchResult {
  pairs: Array<{
    videoAssetId: string;
    audioAssetId: string;
    offsetSeconds: number;
    matchMethod: 'timecode' | 'waveform';
    nameScore: number;
    waveformScore: number;
  }>;
  unmatchedVideos: string[];
  unmatchedAudio: string[];
}
```

### Timeline Creation

- Calls `createDefaultTimeline(name)` which creates V1, V2, A1, A2 by default. If "keep both" mode is selected and we need a third audio track for scratch audio, call `addTrack()` after creation to add an A3 track (muted).
- For each pair: places video clip on V1, synced external audio on A1 with offset applied, links via `linkedClipId`
- If "keep both": scratch audio (from video) placed on A2 (muted)
- Videos laid out sequentially (end to end) in the order shown in the confirmation table
- Uses the existing `selectedAssets` set from the media pool's multi-select state — the context menu handler reads from this set, same pattern as the existing multi-select transcription menu item

## UI Components

### Single Sync Dialog (Timeline -> "Sync Audio...")

Compact modal (~480px wide):

- **Header**: "Sync Audio" with close button
- **Source section**: Video clip name + mini waveform of scratch audio
- **Target section**: Dropdown/picker to select audio asset from media pool; shows mini waveform once selected
- **Method indicator**: Small pill showing "Timecode" or "Waveform" (auto-detected)
- **Dual waveform preview**: Both waveforms stacked vertically, aligned by computed offset. Draggable handle lets user nudge the offset. Shows offset value in seconds (e.g., `+2.341s`)
- **Options row**: "Replace scratch audio" / "Keep both (scratch muted)" toggle buttons
- **Footer**: "Cancel" and "Sync" buttons

### Batch Sync Dialog (Media Pool -> "Create Timeline with Synced Audio")

Wider modal (~640px):

- **Header**: "Sync & Create Timeline"
- **Pairs table**: Each row shows video name <-> audio name, match method, confidence indicator (green/yellow/red dot). Audio column is a dropdown so user can reassign pairings.
- **Unmatched section** (collapsible): Lists unmatched files with a note they'll be added unlinked
- **Options row**: "Replace / Keep both" toggle + "Timeline name" text input
- **Progress state**: While batch matching runs, table fills in progressively with spinner per row
- **Footer**: "Cancel" and "Create Timeline"

### Styling

Both dialogs follow existing app styling:
- `#1a1c22` background
- `rgba(255,255,255,0.1)` borders
- 6px border-radius
- 11-12px font sizes
- `backdrop-filter: blur(12px)`
- Same button patterns already in the app

## Post-Sync Behavior

- Clips become linked via `linkedClipId`
- If "Replace scratch audio": original audio track of the video clip gets muted
- If "Keep both": original stays on its track (muted), external audio placed on nearest available audio track
- Timeline duration recalculated
- **Undo/redo**: the entire sync operation (position adjustment, linking, mute changes) is applied as a single `setTimeline()` call, making it one undoable action
- **Context menu adaptation**: the timeline clip context menu handler inspects `selectedClipIds` (not just the right-clicked `clipCtxMenu.clipId`) to determine which sync case applies (Case A: two selected, Case B: one selected)

## New Files

| File | Purpose |
|------|---------|
| `electron/workers/audio-sync.ts` | Pure functions: TC extraction, fpcalc invocation, fingerprint cross-correlation, name scoring. Called by media-worker, not a standalone worker. |
| `electron/ipc/audio-sync.ts` | IPC handlers (`sync:compute-offset`, `sync:batch-match`, `sync:batch-progress`) exposing sync operations to renderer |
| `src/components/edit/sync-audio-dialog.tsx` | Single sync dialog component |
| `src/components/edit/batch-sync-dialog.tsx` | Batch sync dialog component |

## Modified Files

| File | Change |
|------|--------|
| `electron/workers/media-worker.ts` | Add `sync_compute_offset` and `sync_batch_match` job types, import audio-sync functions |
| `electron/lib/ffmpeg-paths.ts` | Add `getFpcalcPath()` function resolving from `extraResources` |
| `electron/ipc/media-import.ts` | Extract timecode metadata during import |
| `src/components/edit/timeline-editor.tsx` | Add "Sync Audio" to clip context menu, inspect `selectedClipIds` for multi-clip case |
| `src/components/edit/left-panel.tsx` | Add "Create Timeline with Synced Audio" to asset context menu, use `selectedAssets` set |
| `src/lib/editor/timeline-operations.ts` | Add `syncClips()` and batch timeline creation operations |
| `src/types/timeline.ts` | Add sync-related types if needed |
| `electron-builder config` | Add fpcalc to `extraResources` |
| `vendor/` or `postinstall` | fpcalc binary for macOS arm64/x86_64 |
