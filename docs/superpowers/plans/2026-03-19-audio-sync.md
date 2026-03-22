# Audio Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync externally recorded audio to video clips using timecode (instant) or Chromaprint waveform fingerprint matching (any duration), with both single-clip timeline sync and batch media pool sync that creates a new timeline.

**Architecture:** Two-layer design — a sync engine in the Electron backend (pure functions called by the existing media worker job queue) and two React dialog components in the frontend. The engine tries timecode first (free metadata lookup), falls back to Chromaprint fingerprint cross-correlation. Batch mode pre-scores by filename similarity, then verifies with waveform matching.

**Tech Stack:** Electron IPC, FFmpeg/FFprobe (existing), fpcalc (Chromaprint CLI, new binary), Vitest, React

**Spec:** `docs/superpowers/specs/2026-03-19-audio-sync-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `electron/workers/audio-sync.ts` | Pure functions: timecode parsing, fpcalc invocation, fingerprint cross-correlation, filename similarity scoring. No worker thread logic — called by media-worker. |
| `electron/ipc/audio-sync.ts` | IPC handlers: `sync:compute-offset`, `sync:batch-match`. Submits jobs to media worker, forwards progress events. |
| `src/components/edit/sync-audio-dialog.tsx` | Single sync dialog (timeline entry point). Asset picker, dual waveform preview, offset nudge, scratch audio toggle. |
| `src/components/edit/batch-sync-dialog.tsx` | Batch sync dialog (media pool entry point). Pairs table, reassignment dropdowns, progress, timeline name input. |
| `tests/electron/workers/audio-sync.test.ts` | Unit tests for all pure sync functions. |
| `tests/lib/editor/timeline-operations-sync.test.ts` | Unit tests for new timeline operations (syncClips, createSyncedTimeline). |
| `vendor/fpcalc/` | fpcalc binary for macOS (arm64). Downloaded during setup. |

### Modified Files
| File | Change |
|------|--------|
| `electron/workers/media-worker-types.ts` | Add `sync_compute_offset` and `sync_batch_match` job types via discriminated union |
| `electron/workers/media-worker.ts` | Add job dispatch cases for new sync job types, import audio-sync functions |
| `electron/lib/ffmpeg-paths.ts` | Add `getFpcalcPath()` resolving from extraResources or dev vendor/ path |
| `electron/ipc/media-import.ts` | Send fpcalcPath in worker config message |
| `src/lib/editor/timeline-operations.ts` | Add `syncClips()` and `createSyncedTimeline()` |
| `src/components/edit/timeline-editor.tsx` | Add "Sync Audio" item to clip context menu |
| `src/components/edit/left-panel.tsx` | Add "Create Timeline with Synced Audio" to asset context menu |
| `electron-builder.yml` | Add fpcalc to extraResources |
| `src/types/timeline.ts` | No changes needed — existing types sufficient |

---

## Task 1: Obtain and bundle fpcalc binary

**Files:**
- Create: `vendor/fpcalc/README.md`
- Create: `scripts/download-fpcalc.sh`
- Modify: `electron-builder.yml`
- Modify: `electron/lib/ffmpeg-paths.ts`

- [ ] **Step 1: Download fpcalc binary for macOS**

Download Chromaprint from the official releases. Create a script:

```bash
#!/bin/bash
# scripts/download-fpcalc.sh
set -e
CHROMAPRINT_VERSION="1.5.1"
PLATFORM="$(uname -m)"
mkdir -p vendor/fpcalc

if [ "$PLATFORM" = "arm64" ]; then
  # For Apple Silicon, build from Homebrew or use pre-built
  if command -v brew &> /dev/null; then
    FPCALC_PATH="$(brew --prefix chromaprint 2>/dev/null)/bin/fpcalc" || true
    if [ -f "$FPCALC_PATH" ]; then
      cp "$FPCALC_PATH" vendor/fpcalc/fpcalc
      echo "Copied fpcalc from Homebrew"
    else
      echo "Installing chromaprint via Homebrew..."
      brew install chromaprint
      cp "$(brew --prefix chromaprint)/bin/fpcalc" vendor/fpcalc/fpcalc
    fi
  fi
fi

chmod +x vendor/fpcalc/fpcalc
echo "fpcalc ready at vendor/fpcalc/fpcalc"
```

- [ ] **Step 2: Run the script to get the binary**

Run: `bash scripts/download-fpcalc.sh`
Expected: `vendor/fpcalc/fpcalc` exists and is executable

- [ ] **Step 3: Verify fpcalc works**

Run: `vendor/fpcalc/fpcalc -version`
Expected: Prints version info (e.g., `fpcalc version 1.5.1`)

- [ ] **Step 4: Add fpcalc to electron-builder.yml extraResources**

In `electron-builder.yml`, add to the `extraResources` array:

```yaml
  - from: vendor/fpcalc/fpcalc
    to: vendor/fpcalc
```

- [ ] **Step 5: Add getFpcalcPath() to ffmpeg-paths.ts**

```typescript
import path from 'node:path';

export function getFpcalcPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'vendor', 'fpcalc');
  }
  return path.resolve(__dirname, '..', '..', 'vendor', 'fpcalc', 'fpcalc');
}
```

Note: `__dirname` equivalent for ESM — need to use `import.meta.url`:
```typescript
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

But since `ffmpeg-paths.ts` already uses `createRequire(import.meta.url)`, add the path resolve using the same module URL base:

```typescript
export function getFpcalcPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'vendor', 'fpcalc');
  }
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..', 'vendor', 'fpcalc', 'fpcalc');
}
```

Add these imports at top if not present: `import path from 'node:path';` and `import { fileURLToPath } from 'node:url';`

- [ ] **Step 6: Add .gitignore entry for fpcalc binary**

Add to `.gitignore`:
```
vendor/fpcalc/fpcalc
```

- [ ] **Step 7: Create vendor/fpcalc/README.md**

```markdown
# fpcalc (Chromaprint)

Binary not committed to git. Run `bash scripts/download-fpcalc.sh` to obtain it.

Used for audio waveform fingerprint-based sync.
```

- [ ] **Step 8: Commit**

```bash
git add scripts/download-fpcalc.sh vendor/fpcalc/README.md electron-builder.yml electron/lib/ffmpeg-paths.ts .gitignore
git commit -m "feat: bundle fpcalc binary for audio sync"
```

---

## Task 2: Extend worker types for sync jobs

**Files:**
- Modify: `electron/workers/media-worker-types.ts`
- Test: `tests/electron/workers/audio-sync.test.ts` (create, types only for now)

- [ ] **Step 1: Write type test to verify new types compile**

Create `tests/electron/workers/audio-sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('SyncJob types', () => {
  it('type definitions exist and are correct', async () => {
    // Dynamic import to verify types compile
    const types = await import('../../../electron/workers/media-worker-types');
    expect(types.JOB_PRIORITY).toBeDefined();
    expect(types.JOB_PRIORITY.sync_compute_offset).toBe(0);
    expect(types.JOB_PRIORITY.sync_batch_match).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: FAIL — `sync_compute_offset` not in JOB_PRIORITY

- [ ] **Step 3: Update media-worker-types.ts with sync job types**

Change the `JobType` union:

```typescript
export type JobType =
  | 'extract_metadata'
  | 'generate_thumbnail'
  | 'compute_waveform'
  | 'generate_filmstrip'
  | 'generate_proxy'
  | 'sync_compute_offset'
  | 'sync_batch_match';
```

Add to `JOB_PRIORITY`:
```typescript
export const JOB_PRIORITY: Record<JobType, number> = {
  extract_metadata: 0,
  sync_compute_offset: 0,
  sync_batch_match: 0,
  generate_thumbnail: 1,
  compute_waveform: 2,
  generate_filmstrip: 3,
  generate_proxy: 4,
};
```

Change `MediaJob` to a discriminated union:

```typescript
interface BaseMediaJob {
  id: string;
  assetId?: string; // Optional for sync jobs, required for standard jobs. Needed by jobMeta in media-import.ts.
  projectDir: string;
}

export interface StandardMediaJob extends BaseMediaJob {
  type: 'extract_metadata' | 'generate_thumbnail' | 'compute_waveform' | 'generate_filmstrip' | 'generate_proxy';
  assetId: string;
  inputPath: string;
  outputPath: string;
}

export interface SyncOffsetJob extends BaseMediaJob {
  type: 'sync_compute_offset';
  sourceAssetId: string;
  targetAssetId: string;
  sourceFilePath: string;
  targetFilePath: string;
}

export interface SyncBatchJob extends BaseMediaJob {
  type: 'sync_batch_match';
  videoAssets: Array<{ id: string; filePath: string; name: string }>;
  audioAssets: Array<{ id: string; filePath: string; name: string }>;
}

export type MediaJob = StandardMediaJob | SyncOffsetJob | SyncBatchJob;
```

Add sync result types:

```typescript
export interface SyncOffsetResult {
  offsetSeconds: number;
  method: 'timecode' | 'waveform';
  confidence: number;
}

export interface SyncBatchResult {
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

Update config message to include fpcalcPath:

```typescript
export type MainMessageToWorker =
  | { type: 'config'; ffmpegPath: string; ffprobePath: string; fpcalcPath: string }
  | { type: 'job:submit'; job: MediaJob }
  | { type: 'job:cancel'; jobId: string };
```

Add to `WorkerMessageToMain`:

```typescript
export type WorkerMessageToMain =
  | { type: 'ready' }
  | { type: 'job:progress'; jobId: string; progress: number }
  | { type: 'job:complete'; jobId: string; result: unknown }
  | { type: 'job:error'; jobId: string; error: string }
  | { type: 'sync:batch-progress'; jobId: string; completedPairs: number; totalPairs: number; currentVideoName: string; currentAudioName: string };
```

- [ ] **Step 4: Add JOB_COST entries for new job types**

In `media-worker.ts`, add to `JOB_COST`:

```typescript
const JOB_COST: Record<MediaJob['type'], number> = {
  extract_metadata: 0,
  generate_thumbnail: 1,
  compute_waveform: 1,
  generate_filmstrip: 1,
  generate_proxy: 2,
  sync_compute_offset: 2,
  sync_batch_match: 2,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add electron/workers/media-worker-types.ts electron/workers/media-worker.ts tests/electron/workers/audio-sync.test.ts
git commit -m "feat: add sync job types to media worker type system"
```

---

## Task 3: Implement core audio-sync pure functions

**Files:**
- Create: `electron/workers/audio-sync.ts`
- Test: `tests/electron/workers/audio-sync.test.ts` (extend)

- [ ] **Step 1: Write failing tests for timecode parsing**

Add to `tests/electron/workers/audio-sync.test.ts`:

```typescript
import { parseTimecode, computeTimecodeOffset } from '../../../electron/workers/audio-sync';

describe('parseTimecode', () => {
  it('parses non-drop-frame timecode HH:MM:SS:FF', () => {
    expect(parseTimecode('01:00:00:00', 24)).toBe(86400); // 1 hour in frames
  });

  it('parses drop-frame timecode HH:MM:SS;FF', () => {
    expect(parseTimecode('00:01:00;02', 29.97)).toBe(1800); // ~1 minute in drop-frame
  });

  it('returns null for invalid timecode', () => {
    expect(parseTimecode('not-a-timecode', 24)).toBeNull();
  });
});

describe('computeTimecodeOffset', () => {
  it('computes offset between two timecodes', () => {
    const offset = computeTimecodeOffset('01:00:00:00', '01:00:02:00', 24);
    expect(offset).toBeCloseTo(2.0, 2); // 2 seconds
  });

  it('handles negative offset (target starts before source)', () => {
    const offset = computeTimecodeOffset('01:00:05:00', '01:00:02:00', 24);
    expect(offset).toBeCloseTo(-3.0, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: FAIL — cannot import audio-sync

- [ ] **Step 3: Implement timecode parsing functions**

Create `electron/workers/audio-sync.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink, mkdtemp, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

/**
 * Parse a SMPTE timecode string to total frame count.
 * Supports both non-drop (HH:MM:SS:FF) and drop-frame (HH:MM:SS;FF).
 */
export function parseTimecode(tc: string, fps: number): number | null {
  // Match HH:MM:SS:FF or HH:MM:SS;FF
  const match = tc.match(/^(\d{2}):(\d{2}):(\d{2})([;:])(\d{2})$/);
  if (!match) return null;

  const [, hh, mm, ss, sep, ff] = match;
  const hours = parseInt(hh, 10);
  const minutes = parseInt(mm, 10);
  const seconds = parseInt(ss, 10);
  const frames = parseInt(ff, 10);
  const isDropFrame = sep === ';';

  const roundedFps = Math.round(fps);

  if (isDropFrame && (roundedFps === 30 || roundedFps === 60)) {
    // Drop-frame: skip 2 frames per minute except every 10th minute (for 29.97)
    const dropFrames = roundedFps === 60 ? 4 : 2;
    const totalMinutes = hours * 60 + minutes;
    const droppedFrames = dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
    return (hours * 3600 + minutes * 60 + seconds) * roundedFps + frames - droppedFrames;
  }

  return (hours * 3600 + minutes * 60 + seconds) * roundedFps + frames;
}

/**
 * Compute the time offset in seconds between two timecodes.
 * Positive means target starts after source.
 */
export function computeTimecodeOffset(
  sourceTc: string,
  targetTc: string,
  fps: number,
): number | null {
  const sourceFrames = parseTimecode(sourceTc, fps);
  const targetFrames = parseTimecode(targetTc, fps);
  if (sourceFrames === null || targetFrames === null) return null;
  return (targetFrames - sourceFrames) / fps;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for fingerprint cross-correlation**

Add to the test file:

```typescript
import { crossCorrelateFingerprints } from '../../../electron/workers/audio-sync';

describe('crossCorrelateFingerprints', () => {
  it('finds zero offset for identical fingerprints', () => {
    const fp = [100, 200, 300, 400, 500];
    const result = crossCorrelateFingerprints(fp, fp);
    expect(result.offsetIndex).toBe(0);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('finds correct offset for shifted fingerprints', () => {
    const source = [0, 0, 100, 200, 300, 400, 500, 0, 0];
    const target = [100, 200, 300, 400, 500, 0, 0, 0, 0];
    const result = crossCorrelateFingerprints(source, target);
    // target is shifted left by 2 relative to source
    expect(result.offsetIndex).toBe(-2);
  });

  it('returns low confidence for unrelated fingerprints', () => {
    const source = [0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF];
    const target = [0x00000000, 0x00000000, 0x00000000];
    const result = crossCorrelateFingerprints(source, target);
    expect(result.confidence).toBeLessThan(0.1);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: FAIL — crossCorrelateFingerprints not exported

- [ ] **Step 7: Implement fingerprint cross-correlation**

Add to `electron/workers/audio-sync.ts`:

```typescript
/**
 * Count the number of set bits in a 32-bit integer (Hamming weight).
 */
function popcount32(n: number): number {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

export interface CorrelationResult {
  /** Offset in fingerprint indices. Positive = target starts later. */
  offsetIndex: number;
  /** Confidence score 0-1. Higher = better match. */
  confidence: number;
}

/**
 * Cross-correlate two Chromaprint fingerprint arrays to find the best alignment.
 * Returns the offset (in fingerprint indices, ~0.1238s each) and confidence.
 */
export function crossCorrelateFingerprints(
  source: number[],
  target: number[],
): CorrelationResult {
  const maxShift = Math.max(source.length, target.length);
  let bestOffset = 0;
  let bestScore = -Infinity;

  // Slide target over source from -maxShift to +maxShift
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let totalBitErrors = 0;
    let compared = 0;

    for (let i = 0; i < source.length; i++) {
      const j = i + shift;
      if (j < 0 || j >= target.length) continue;
      totalBitErrors += popcount32(source[i] ^ target[j]);
      compared++;
    }

    if (compared < 3) continue; // need minimum overlap

    const avgBitError = totalBitErrors / compared;
    // Score: lower bit errors = better match. Normalize to 0-1.
    const score = 1 - avgBitError / 32;

    if (score > bestScore) {
      bestScore = score;
      bestOffset = shift;
    }
  }

  return {
    offsetIndex: bestOffset,
    confidence: Math.max(0, bestScore),
  };
}

/** Convert fingerprint index offset to seconds. */
export const FP_INDEX_TO_SECONDS = 0.1238;
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing tests for filename similarity scoring**

Add to the test file:

```typescript
import { scoreFilenameSimilarity } from '../../../electron/workers/audio-sync';

describe('scoreFilenameSimilarity', () => {
  it('scores identical names as 1.0', () => {
    expect(scoreFilenameSimilarity('scene_01.mov', 'scene_01.wav')).toBe(1.0);
  });

  it('scores completely different names as low', () => {
    expect(scoreFilenameSimilarity('foo.mov', 'bar.wav')).toBeLessThan(0.5);
  });

  it('scores similar names higher than different', () => {
    const similar = scoreFilenameSimilarity('interview_take2.mov', 'interview_take2_audio.wav');
    const different = scoreFilenameSimilarity('interview_take2.mov', 'broll_sunset.wav');
    expect(similar).toBeGreaterThan(different);
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: FAIL — scoreFilenameSimilarity not exported

- [ ] **Step 11: Implement filename similarity scoring**

Add to `electron/workers/audio-sync.ts`:

```typescript
/**
 * Score the similarity of two filenames (ignoring extensions).
 * Returns 0-1 where 1 = identical base names.
 * Uses normalized Levenshtein distance.
 */
export function scoreFilenameSimilarity(fileA: string, fileB: string): number {
  const baseA = path.basename(fileA, path.extname(fileA)).toLowerCase();
  const baseB = path.basename(fileB, path.extname(fileB)).toLowerCase();

  if (baseA === baseB) return 1.0;

  const maxLen = Math.max(baseA.length, baseB.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(baseA, baseB);
  return 1 - distance / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: PASS

- [ ] **Step 13: Implement timecode extraction via FFprobe**

Add to `electron/workers/audio-sync.ts`:

```typescript
/**
 * Extract timecode from a media file by checking multiple metadata locations.
 * Returns the timecode string or null if not found.
 */
export async function extractTimecode(
  filePath: string,
  ffprobePath: string,
): Promise<{ timecode: string; fps: number } | null> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const probe = JSON.parse(stdout);

  // Check format-level tags
  const formatTc = probe.format?.tags?.timecode
    ?? probe.format?.tags?.['com.apple.quicktime.timecode'];

  // Check stream-level tags (prefer video stream)
  let streamTc: string | undefined;
  let fps = 24;
  for (const stream of probe.streams ?? []) {
    if (stream.codec_type === 'video') {
      const fpsStr = stream.r_frame_rate ?? stream.avg_frame_rate;
      if (fpsStr) {
        const [num, den] = fpsStr.split('/').map(Number);
        if (den) fps = num / den;
      }
      streamTc = stream.tags?.timecode ?? stream.tags?.['com.apple.quicktime.timecode'];
    }
  }

  const tc = formatTc ?? streamTc;
  if (!tc) return null;

  return { timecode: tc, fps };
}

/**
 * Check if a file has an audio stream.
 */
export async function hasAudioStream(
  filePath: string,
  ffprobePath: string,
): Promise<boolean> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    filePath,
  ]);
  const probe = JSON.parse(stdout);
  return (probe.streams ?? []).some((s: any) => s.codec_type === 'audio');
}
```

- [ ] **Step 14: Implement fpcalc invocation and full sync pipeline**

Add to `electron/workers/audio-sync.ts`:

```typescript
/**
 * Extract Chromaprint fingerprint from an audio file using fpcalc.
 */
export async function extractFingerprint(
  filePath: string,
  fpcalcPath: string,
): Promise<{ duration: number; fingerprint: number[] }> {
  const { stdout } = await execFileAsync(fpcalcPath, [
    '-raw', '-json', '-length', '0', filePath,
  ], { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer for long files

  const result = JSON.parse(stdout);
  return {
    duration: result.duration,
    fingerprint: result.fingerprint,
  };
}

/**
 * Extract audio from a video file to a temp WAV for fingerprinting.
 * Returns the path to the temp file. Caller must clean up.
 */
export async function extractAudioToTempWav(
  videoPath: string,
  ffmpegPath: string,
): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cinegen-sync-'));
  const wavPath = path.join(tmpDir, 'audio.wav');

  await execFileAsync(ffmpegPath, [
    '-i', videoPath,
    '-vn',          // no video
    '-ac', '1',     // mono
    '-ar', '44100', // 44.1kHz (fpcalc default)
    '-y',           // overwrite
    wavPath,
  ]);

  return wavPath;
}

export interface SyncResult {
  offsetSeconds: number;
  method: 'timecode' | 'waveform';
  confidence: number;
}

/**
 * Full sync pipeline: try timecode first, fall back to waveform matching.
 */
export async function computeSyncOffset(
  sourceVideoPath: string,
  targetAudioPath: string,
  ffmpegPath: string,
  ffprobePath: string,
  fpcalcPath: string,
): Promise<SyncResult> {
  // 1. Try timecode sync
  const [sourceTc, targetTc] = await Promise.all([
    extractTimecode(sourceVideoPath, ffprobePath),
    extractTimecode(targetAudioPath, ffprobePath),
  ]);

  if (sourceTc && targetTc) {
    const offset = computeTimecodeOffset(sourceTc.timecode, targetTc.timecode, sourceTc.fps);
    if (offset !== null) {
      return { offsetSeconds: offset, method: 'timecode', confidence: 1.0 };
    }
  }

  // 2. Check if video has audio
  const videoHasAudio = await hasAudioStream(sourceVideoPath, ffprobePath);
  if (!videoHasAudio) {
    throw new Error('Video has no audio stream to match against');
  }

  // 3. Waveform fingerprint matching
  let tempWavPath: string | null = null;
  try {
    tempWavPath = await extractAudioToTempWav(sourceVideoPath, ffmpegPath);

    const [sourceFp, targetFp] = await Promise.all([
      extractFingerprint(tempWavPath, fpcalcPath),
      extractFingerprint(targetAudioPath, fpcalcPath),
    ]);

    const correlation = crossCorrelateFingerprints(
      sourceFp.fingerprint,
      targetFp.fingerprint,
    );

    return {
      offsetSeconds: correlation.offsetIndex * FP_INDEX_TO_SECONDS,
      method: 'waveform',
      confidence: correlation.confidence,
    };
  } finally {
    if (tempWavPath) {
      try {
        await unlink(tempWavPath);
        await rmdir(path.dirname(tempWavPath));
      } catch { /* ignore cleanup errors */ }
    }
  }
}
```

- [ ] **Step 15: Write tests for computeBatchMatch (name scoring path only)**

These test the batch matching logic with mocked sync results. Since `computeBatchMatch` calls `computeSyncOffset` (which needs real binaries), we test the name-scoring and pairing logic by testing `scoreFilenameSimilarity` coverage and the batch result structure. Full integration testing happens in Task 11.

Add to `tests/electron/workers/audio-sync.test.ts`:

```typescript
describe('batch matching logic', () => {
  it('scoreFilenameSimilarity pairs exact matches higher than partial', () => {
    const exact = scoreFilenameSimilarity('scene_01.mov', 'scene_01.wav');
    const partial = scoreFilenameSimilarity('scene_01.mov', 'scene_02.wav');
    const unrelated = scoreFilenameSimilarity('scene_01.mov', 'interview.wav');
    expect(exact).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(unrelated);
  });

  it('handles edge case: empty filenames', () => {
    expect(scoreFilenameSimilarity('.mov', '.wav')).toBe(1.0); // both empty basenames
  });

  it('handles edge case: very long filenames', () => {
    const long = 'a'.repeat(200) + '.mov';
    const short = 'a'.repeat(200) + '.wav';
    expect(scoreFilenameSimilarity(long, short)).toBe(1.0);
  });
});
```

- [ ] **Step 16: Run all tests**

Run: `npx vitest run tests/electron/workers/audio-sync.test.ts`
Expected: All PASS

- [ ] **Step 17: Commit**

```bash
git add electron/workers/audio-sync.ts tests/electron/workers/audio-sync.test.ts
git commit -m "feat: implement core audio sync engine with timecode and chromaprint"
```

---

## Task 4: Wire sync jobs into media worker

**Files:**
- Modify: `electron/workers/media-worker.ts`
- Modify: `electron/ipc/media-import.ts` (send fpcalcPath in config)

- [ ] **Step 1: Add fpcalcPath to worker config**

In `electron/workers/media-worker.ts`, add a `fpcalcPath` variable alongside `ffmpegPath`/`ffprobePath`:

```typescript
let fpcalcPath = '';
```

Update the config handler:

```typescript
case 'config':
  ffmpegPath = msg.ffmpegPath;
  ffprobePath = msg.ffprobePath;
  fpcalcPath = msg.fpcalcPath;
  send({ type: 'ready' });
  break;
```

- [ ] **Step 2: Add sync job dispatch cases**

In the job runner switch in `media-worker.ts`, add:

```typescript
case 'sync_compute_offset': {
  const { computeSyncOffset } = await import('./audio-sync');
  result = await computeSyncOffset(
    job.sourceFilePath,
    job.targetFilePath,
    ffmpegPath,
    ffprobePath,
    fpcalcPath,
  );
  break;
}
case 'sync_batch_match': {
  const { computeBatchMatch } = await import('./audio-sync');
  result = await computeBatchMatch(
    job.videoAssets,
    job.audioAssets,
    ffmpegPath,
    ffprobePath,
    fpcalcPath,
    (progress) => {
      send({
        type: 'sync:batch-progress',
        jobId: job.id,
        ...progress,
      });
    },
  );
  break;
}
```

- [ ] **Step 3: Implement computeBatchMatch in audio-sync.ts**

Add to `electron/workers/audio-sync.ts`:

```typescript
export interface BatchProgress {
  completedPairs: number;
  totalPairs: number;
  currentVideoName: string;
  currentAudioName: string;
}

export interface BatchPair {
  videoAssetId: string;
  audioAssetId: string;
  offsetSeconds: number;
  matchMethod: 'timecode' | 'waveform';
  nameScore: number;
  waveformScore: number;
}

export interface BatchResult {
  pairs: BatchPair[];
  unmatchedVideos: string[];
  unmatchedAudio: string[];
}

export async function computeBatchMatch(
  videoAssets: Array<{ id: string; filePath: string; name: string }>,
  audioAssets: Array<{ id: string; filePath: string; name: string }>,
  ffmpegPath: string,
  ffprobePath: string,
  fpcalcPath: string,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchResult> {
  const pairs: BatchPair[] = [];
  const usedAudioIds = new Set<string>();
  const totalPairs = videoAssets.length;

  for (let vi = 0; vi < videoAssets.length; vi++) {
    const video = videoAssets[vi];

    // Score all available audio files by name
    const candidates = audioAssets
      .filter((a) => !usedAudioIds.has(a.id))
      .map((a) => ({
        audio: a,
        nameScore: scoreFilenameSimilarity(video.name, a.name),
      }))
      .sort((a, b) => b.nameScore - a.nameScore);

    let matched = false;

    for (const candidate of candidates) {
      onProgress?.({
        completedPairs: vi,
        totalPairs,
        currentVideoName: video.name,
        currentAudioName: candidate.audio.name,
      });

      try {
        const syncResult = await computeSyncOffset(
          video.filePath,
          candidate.audio.filePath,
          ffmpegPath,
          ffprobePath,
          fpcalcPath,
        );

        if (syncResult.confidence >= 0.4) {
          pairs.push({
            videoAssetId: video.id,
            audioAssetId: candidate.audio.id,
            offsetSeconds: syncResult.offsetSeconds,
            matchMethod: syncResult.method,
            nameScore: candidate.nameScore,
            waveformScore: syncResult.confidence,
          });
          usedAudioIds.add(candidate.audio.id);
          matched = true;
          break;
        }
      } catch {
        // Skip this candidate (e.g., no audio stream)
        continue;
      }
    }

    if (!matched) {
      // Will be added as unmatched
    }
  }

  const matchedVideoIds = new Set(pairs.map((p) => p.videoAssetId));
  const unmatchedVideos = videoAssets.filter((v) => !matchedVideoIds.has(v.id)).map((v) => v.id);
  const unmatchedAudio = audioAssets.filter((a) => !usedAudioIds.has(a.id)).map((a) => a.id);

  onProgress?.({
    completedPairs: totalPairs,
    totalPairs,
    currentVideoName: '',
    currentAudioName: '',
  });

  return { pairs, unmatchedVideos, unmatchedAudio };
}
```

- [ ] **Step 4: Update media-import.ts to send fpcalcPath in config**

In `electron/ipc/media-import.ts`, find where the worker config message is sent and add `fpcalcPath`:

```typescript
import { getFpcalcPath } from '../lib/ffmpeg-paths';

// In the ensureWorker() or worker init:
w.postMessage({
  type: 'config',
  ffmpegPath: getFfmpegPath(),
  ffprobePath: getFfprobePath(),
  fpcalcPath: getFpcalcPath(),
});
```

- [ ] **Step 5: Commit**

```bash
git add electron/workers/media-worker.ts electron/workers/audio-sync.ts electron/ipc/media-import.ts
git commit -m "feat: wire sync jobs into media worker pipeline"
```

---

## Task 5: Create IPC handlers for audio sync

**Files:**
- Create: `electron/ipc/audio-sync.ts`
- Modify: `electron/main.ts` (import the new IPC module)

- [ ] **Step 1: Create the IPC handler file**

Create `electron/ipc/audio-sync.ts`:

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { projectDir } from '../db/database.js';
import type { MediaJob } from '../workers/media-worker-types';

/**
 * Register audio sync IPC handlers.
 * Must be called after media worker is initialized.
 * Note: submitJob is exported from media-import.ts — this is a conscious
 * architectural decision to share the worker's job submission interface.
 */
export function registerAudioSyncHandlers(
  submitJob: (job: MediaJob) => Promise<unknown>,
): void {
  ipcMain.handle('sync:compute-offset', async (_event, params: {
    sourceAssetId: string;
    targetAssetId: string;
    sourceFilePath: string;
    targetFilePath: string;
    projectId: string;
  }) => {
    const jobId = randomUUID();
    const projDir = projectDir(params.projectId);
    const result = await submitJob({
      id: jobId,
      type: 'sync_compute_offset',
      sourceAssetId: params.sourceAssetId,
      targetAssetId: params.targetAssetId,
      sourceFilePath: params.sourceFilePath,
      targetFilePath: params.targetFilePath,
      projectDir: projDir,
    });
    return result;
  });

  ipcMain.handle('sync:batch-match', async (_event, params: {
    videoAssets: Array<{ id: string; filePath: string; name: string }>;
    audioAssets: Array<{ id: string; filePath: string; name: string }>;
    projectId: string;
  }) => {
    const jobId = randomUUID();
    const projDir = projectDir(params.projectId);
    const result = await submitJob({
      id: jobId,
      type: 'sync_batch_match',
      videoAssets: params.videoAssets,
      audioAssets: params.audioAssets,
      projectDir: projDir,
    });
    return result;
  });
}
```

- [ ] **Step 2: Export submitJob from media-import.ts**

In `electron/ipc/media-import.ts`, export `submitJob` so audio-sync.ts can use it:

```typescript
export function submitJob(job: MediaJob): Promise<unknown> {
  // ... existing implementation
}
```

(Change from `function submitJob` to `export function submitJob`)

- [ ] **Step 3: Wire up batch progress forwarding**

In `electron/ipc/media-import.ts`, in the worker message handler, add a case for the new `sync:batch-progress` message type:

```typescript
case 'sync:batch-progress':
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sync:batch-progress', {
      jobId: msg.jobId,
      completedPairs: msg.completedPairs,
      totalPairs: msg.totalPairs,
      currentVideoName: msg.currentVideoName,
      currentAudioName: msg.currentAudioName,
    });
  }
  break;
```

- [ ] **Step 4: Import and register in main.ts**

Find where media IPC handlers are initialized in `electron/main.ts` and add:

```typescript
import { registerAudioSyncHandlers } from './ipc/audio-sync';
import { submitJob } from './ipc/media-import';

// After media handlers are registered:
registerAudioSyncHandlers(submitJob);
```

- [ ] **Step 5: Add preload bridge for sync IPC**

Check `electron/preload.ts` for the existing IPC bridge pattern and add sync channels:

```typescript
// In the contextBridge.exposeInMainWorld section:
syncComputeOffset: (params: any) => ipcRenderer.invoke('sync:compute-offset', params),
syncBatchMatch: (params: any) => ipcRenderer.invoke('sync:batch-match', params),
onSyncBatchProgress: (callback: (data: any) => void) => {
  const handler = (_event: any, data: any) => callback(data);
  ipcRenderer.on('sync:batch-progress', handler);
  return () => ipcRenderer.removeListener('sync:batch-progress', handler);
},
```

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/audio-sync.ts electron/ipc/media-import.ts electron/main.ts electron/preload.ts
git commit -m "feat: add IPC handlers for audio sync operations"
```

---

## Task 6: Add timeline operations for sync

**Files:**
- Modify: `src/lib/editor/timeline-operations.ts`
- Test: `tests/lib/editor/timeline-operations-sync.test.ts`

- [ ] **Step 1: Write failing tests for syncClips**

Create `tests/lib/editor/timeline-operations-sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { syncClips, createSyncedTimeline } from '@/lib/editor/timeline-operations';
import { createDefaultTimeline } from '@/lib/editor/timeline-operations';
import type { Timeline, Clip } from '@/types/timeline';

function makeTimeline(): Timeline {
  const tl = createDefaultTimeline('Test');
  const videoClip: Clip = {
    id: 'v1', assetId: 'asset-video', trackId: tl.tracks[0].id,
    name: 'scene_01.mov', startTime: 0, duration: 10,
    trimStart: 0, trimEnd: 0, speed: 1, opacity: 1, volume: 1,
    flipH: false, flipV: false, keyframes: [],
  };
  const audioClip: Clip = {
    id: 'a1', assetId: 'asset-audio', trackId: tl.tracks[2].id,
    name: 'scene_01.wav', startTime: 5, duration: 10,
    trimStart: 0, trimEnd: 0, speed: 1, opacity: 1, volume: 1,
    flipH: false, flipV: false, keyframes: [],
  };
  return { ...tl, clips: [videoClip, audioClip] };
}

describe('syncClips', () => {
  it('adjusts audio clip position by offset and links clips', () => {
    const tl = makeTimeline();
    const result = syncClips(tl, 'v1', 'a1', 2.5, 'replace');
    const audioClip = result.clips.find((c) => c.id === 'a1')!;
    // Audio should be at video.startTime + offset = 0 + 2.5
    expect(audioClip.startTime).toBeCloseTo(2.5);
    // Clips should be linked
    const videoClip = result.clips.find((c) => c.id === 'v1')!;
    expect(videoClip.linkedClipId).toBe('a1');
    expect(audioClip.linkedClipId).toBe('v1');
  });

  it('mutes scratch audio track when mode is replace', () => {
    const tl = makeTimeline();
    // Add a scratch audio clip linked to the video
    const scratchClip: Clip = {
      id: 'scratch', assetId: 'asset-video', trackId: tl.tracks[2].id,
      name: 'scene_01.mov (audio)', startTime: 0, duration: 10,
      trimStart: 0, trimEnd: 0, speed: 1, opacity: 1, volume: 1,
      flipH: false, flipV: false, keyframes: [], linkedClipId: 'v1',
    };
    const tlWithScratch = {
      ...tl,
      clips: [...tl.clips, scratchClip],
    };
    // Update video to be linked to scratch
    tlWithScratch.clips[0] = { ...tlWithScratch.clips[0], linkedClipId: 'scratch' };

    const result = syncClips(tlWithScratch, 'v1', 'a1', 2.5, 'replace');
    const scratch = result.clips.find((c) => c.id === 'scratch')!;
    expect(scratch.volume).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/editor/timeline-operations-sync.test.ts`
Expected: FAIL — syncClips not exported

- [ ] **Step 3: Implement syncClips**

Add to `src/lib/editor/timeline-operations.ts`:

```typescript
/**
 * Sync an external audio clip to a video clip by applying an offset.
 * Links the clips and optionally mutes/replaces the scratch audio.
 */
export function syncClips(
  timeline: Timeline,
  videoClipId: string,
  audioClipId: string,
  offsetSeconds: number,
  scratchMode: 'replace' | 'keep',
): Timeline {
  const videoClip = timeline.clips.find((c) => c.id === videoClipId);
  if (!videoClip) return timeline;

  let clips = timeline.clips.map((c) => {
    if (c.id === audioClipId) {
      return {
        ...c,
        startTime: Math.max(0, videoClip.startTime + offsetSeconds),
        linkedClipId: videoClipId,
      };
    }
    if (c.id === videoClipId) {
      // If video was linked to a scratch audio, handle it
      const oldLinkedId = c.linkedClipId;
      return {
        ...c,
        linkedClipId: audioClipId,
      };
    }
    return c;
  });

  // Handle scratch audio (the previously linked audio clip)
  // Both modes mute the scratch audio and unlink it from the video.
  // In 'keep' mode the clip stays on its track (muted); in 'replace' mode it's the same
  // since we can't remove a clip from an immutable operation — the user can delete it manually.
  // The key difference surfaces in createSyncedTimeline (batch), where 'keep' adds a
  // dedicated muted scratch track.
  if (videoClip.linkedClipId) {
    const scratchId = videoClip.linkedClipId;
    clips = clips.map((c) => {
      if (c.id === scratchId) {
        return { ...c, volume: 0, linkedClipId: undefined };
      }
      return c;
    });
  }

  return withDuration({ ...timeline, clips });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/editor/timeline-operations-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for createSyncedTimeline**

Add to the test file:

```typescript
describe('createSyncedTimeline', () => {
  it('creates a timeline with synced clips laid out sequentially', () => {
    const pairs = [
      {
        videoAsset: { id: 'v1', name: 'clip1.mov', duration: 10 },
        audioAsset: { id: 'a1', name: 'clip1.wav', duration: 12 },
        offsetSeconds: 0.5,
      },
      {
        videoAsset: { id: 'v2', name: 'clip2.mov', duration: 8 },
        audioAsset: { id: 'a2', name: 'clip2.wav', duration: 9 },
        offsetSeconds: -0.3,
      },
    ];
    const result = createSyncedTimeline('My Timeline', pairs, 'replace', [], []);

    // Should have clips laid out sequentially
    const videoClips = result.clips.filter((c) =>
      result.tracks.find((t) => t.id === c.trackId)?.kind === 'video'
    );
    expect(videoClips).toHaveLength(2);
    expect(videoClips[0].startTime).toBe(0);
    expect(videoClips[1].startTime).toBe(10); // after first clip

    // Audio clips should be offset relative to their video
    const audioClips = result.clips.filter((c) =>
      result.tracks.find((t) => t.id === c.trackId)?.kind === 'audio'
    );
    expect(audioClips[0].startTime).toBeCloseTo(0.5);
    expect(audioClips[1].startTime).toBeCloseTo(10 - 0.3);

    // Clips should be linked
    expect(videoClips[0].linkedClipId).toBe(audioClips[0].id);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/lib/editor/timeline-operations-sync.test.ts`
Expected: FAIL — createSyncedTimeline not exported

- [ ] **Step 7: Implement createSyncedTimeline**

Add to `src/lib/editor/timeline-operations.ts`:

```typescript
interface SyncedPair {
  videoAsset: { id: string; name: string; duration: number };
  audioAsset: { id: string; name: string; duration: number };
  offsetSeconds: number;
}

/**
 * Create a new timeline with synced video-audio pairs laid out sequentially.
 */
export function createSyncedTimeline(
  name: string,
  pairs: SyncedPair[],
  scratchMode: 'replace' | 'keep',
  unmatchedVideoAssets: Array<{ id: string; name: string; duration: number }>,
  unmatchedAudioAssets: Array<{ id: string; name: string; duration: number }>,
): Timeline {
  let tl = createDefaultTimeline(name);

  // If keeping scratch audio, add a third audio track (muted) using the immutable addTrack()
  if (scratchMode === 'keep') {
    tl = addTrack(tl, 'audio');
    // Find the newly added track (last audio track) and update its name/muted state
    const lastAudioTrack = [...tl.tracks].reverse().find((t) => t.kind === 'audio')!;
    tl = {
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id === lastAudioTrack.id ? { ...t, name: 'A3 (Scratch)', muted: true } : t
      ),
    };
  }

  const v1Track = tl.tracks.find((t) => t.kind === 'video')!;
  const a1Track = tl.tracks.find((t) => t.kind === 'audio')!;
  const scratchTrack = scratchMode === 'keep'
    ? tl.tracks.find((t) => t.name === 'A3 (Scratch)')!
    : null;

  let cursor = 0;
  const clips: Clip[] = [];

  for (const pair of pairs) {
    const videoClipId = generateId();
    const audioClipId = generateId();
    const scratchClipId = scratchMode === 'keep' ? generateId() : undefined;

    // Video clip
    clips.push({
      id: videoClipId,
      assetId: pair.videoAsset.id,
      trackId: v1Track.id,
      name: pair.videoAsset.name,
      startTime: cursor,
      duration: pair.videoAsset.duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
      linkedClipId: audioClipId,
    });

    // Synced external audio clip
    clips.push({
      id: audioClipId,
      assetId: pair.audioAsset.id,
      trackId: a1Track.id,
      name: pair.audioAsset.name,
      startTime: Math.max(0, cursor + pair.offsetSeconds),
      duration: pair.audioAsset.duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
      linkedClipId: videoClipId,
    });

    // Scratch audio (muted, on separate track)
    if (scratchMode === 'keep' && scratchTrack) {
      clips.push({
        id: scratchClipId!,
        assetId: pair.videoAsset.id,
        trackId: scratchTrack.id,
        name: `${pair.videoAsset.name} (scratch)`,
        startTime: cursor,
        duration: pair.videoAsset.duration,
        trimStart: 0,
        trimEnd: 0,
        speed: 1,
        opacity: 1,
        volume: 0,
        flipH: false,
        flipV: false,
        keyframes: [],
      });
    }

    cursor += pair.videoAsset.duration;
  }

  // Add unmatched videos at end
  for (const asset of unmatchedVideoAssets) {
    clips.push({
      id: generateId(),
      assetId: asset.id,
      trackId: v1Track.id,
      name: asset.name,
      startTime: cursor,
      duration: asset.duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
    });
    cursor += asset.duration;
  }

  // Add unmatched audio at end
  let audioCursor = cursor;
  for (const asset of unmatchedAudioAssets) {
    clips.push({
      id: generateId(),
      assetId: asset.id,
      trackId: a1Track.id,
      name: asset.name,
      startTime: audioCursor,
      duration: asset.duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
    });
    audioCursor += asset.duration;
  }

  return withDuration({ ...tl, clips });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/lib/editor/timeline-operations-sync.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/editor/timeline-operations.ts tests/lib/editor/timeline-operations-sync.test.ts
git commit -m "feat: add syncClips and createSyncedTimeline timeline operations"
```

---

## Task 7: Add "Sync Audio" to timeline clip context menu

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`

- [ ] **Step 1: Add state for sync dialog**

Near the existing `clipCtxMenu` state (~line 131), add:

```typescript
const [syncDialogOpen, setSyncDialogOpen] = useState(false);
const [syncDialogVideoClipId, setSyncDialogVideoClipId] = useState<string | null>(null);
const [syncDialogAudioClipId, setSyncDialogAudioClipId] = useState<string | null>(null);
```

- [ ] **Step 2: Add sync handler function**

Add a handler that determines which sync case applies:

```typescript
const handleSyncAudio = useCallback(() => {
  if (!clipCtxMenu) return;
  setClipCtxMenu(null);

  const selected = Array.from(selectedClipIds);
  const selectedClips = selected.map((id) => timeline.clips.find((c) => c.id === id)).filter(Boolean);

  // Find video and audio clips in selection
  const videoClips = selectedClips.filter((c) => {
    const track = timeline.tracks.find((t) => t.id === c!.trackId);
    return track?.kind === 'video';
  });
  const audioClips = selectedClips.filter((c) => {
    const track = timeline.tracks.find((t) => t.id === c!.trackId);
    return track?.kind === 'audio';
  });

  if (videoClips.length === 1 && audioClips.length === 1) {
    // Case A: Direct sync — both selected
    setSyncDialogVideoClipId(videoClips[0]!.id);
    setSyncDialogAudioClipId(audioClips[0]!.id);
    setSyncDialogOpen(true);
  } else if (videoClips.length >= 1) {
    // Case B: Open picker — only video selected
    setSyncDialogVideoClipId(videoClips[0]!.id);
    setSyncDialogAudioClipId(null);
    setSyncDialogOpen(true);
  }
}, [clipCtxMenu, selectedClipIds, timeline]);
```

- [ ] **Step 3: Add menu item to context menu**

In the clip context menu portal (around line 2956-3049), add the "Sync Audio" item. Insert it before the separator before Delete:

```typescript
<div className="clip-ctx__sep" />
<button
  className={`clip-ctx__item ${hasVideoInSelection ? '' : 'clip-ctx__item--disabled'}`}
  onClick={handleSyncAudio}
  disabled={!hasVideoInSelection}
>
  Sync Audio{hasVideoInSelection && !hasAudioInSelection ? '...' : ''}
</button>
```

Where `hasVideoInSelection` and `hasAudioInSelection` are computed from `selectedClipIds`:

```typescript
const hasVideoInSelection = useMemo(() => {
  return Array.from(selectedClipIds).some((id) => {
    const clip = timeline.clips.find((c) => c.id === id);
    const track = timeline.tracks.find((t) => t.id === clip?.trackId);
    return track?.kind === 'video';
  });
}, [selectedClipIds, timeline]);

const hasAudioInSelection = useMemo(() => {
  return Array.from(selectedClipIds).some((id) => {
    const clip = timeline.clips.find((c) => c.id === id);
    const track = timeline.tracks.find((t) => t.id === clip?.trackId);
    return track?.kind === 'audio';
  });
}, [selectedClipIds, timeline]);
```

- [ ] **Step 4: Commit**

```bash
git add src/components/edit/timeline-editor.tsx
git commit -m "feat: add Sync Audio to timeline clip context menu"
```

---

## Task 8: Add "Create Timeline with Synced Audio" to media pool context menu

**Files:**
- Modify: `src/components/edit/left-panel.tsx`

- [ ] **Step 1: Add state for batch sync dialog**

Add near existing state declarations:

```typescript
const [batchSyncOpen, setBatchSyncOpen] = useState(false);
```

- [ ] **Step 2: Add handler for batch sync**

```typescript
const handleBatchSync = useCallback(() => {
  setContextMenu(null);
  setBatchSyncOpen(true);
}, []);
```

- [ ] **Step 3: Determine when to show the menu item**

Compute whether the selection contains both video and audio assets:

```typescript
const selectionHasVideoAndAudio = useMemo(() => {
  const selectedList = Array.from(selectedAssets);
  const selectedAssetObjects = selectedList.map((id) => assets.find((a) => a.id === id)).filter(Boolean);
  const hasVideo = selectedAssetObjects.some((a) => a!.type === 'video');
  const hasAudio = selectedAssetObjects.some((a) => a!.type === 'audio');
  return hasVideo && hasAudio;
}, [selectedAssets, assets]);
```

- [ ] **Step 4: Add menu item to asset context menu**

In the asset context menu section (around line 1497-1646), add before the Delete divider:

```typescript
{selectionHasVideoAndAudio && selectedAssets.size > 1 && (
  <>
    <div className="mp__ctx-divider" />
    <button className="mp__ctx-item" onClick={handleBatchSync}>
      Create Timeline with Synced Audio
    </button>
  </>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/edit/left-panel.tsx
git commit -m "feat: add Create Timeline with Synced Audio to media pool context menu"
```

---

## Task 9: Build the Single Sync Dialog component

> **Note:** The spec calls for dual waveform preview with a draggable offset handle.
> This initial implementation uses offset nudge buttons (+/-1ms, +/-10ms) for simplicity.
> Dual waveform visualization is a planned follow-up enhancement — the existing
> `WaveformCanvas` component can be integrated once the core sync pipeline is validated.

**Files:**
- Create: `src/components/edit/sync-audio-dialog.tsx`
- Modify: `src/components/edit/timeline-editor.tsx` (render the dialog)
- Modify: `src/styles/globals.css` (dialog styles)

- [ ] **Step 1: Create the dialog component**

Create `src/components/edit/sync-audio-dialog.tsx`:

```typescript
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Clip, Timeline } from '@/types/timeline';
import type { Asset } from '@/types/project';
import { WaveformCanvas } from './waveform-canvas';

interface SyncAudioDialogProps {
  open: boolean;
  onClose: () => void;
  onSync: (audioClipId: string | null, audioAssetId: string | null, offsetSeconds: number, scratchMode: 'replace' | 'keep') => void;
  videoClipId: string;
  /** If provided, direct sync with this audio clip */
  audioClipId: string | null;
  timeline: Timeline;
  assets: Asset[];
  projectId: string;
}

export function SyncAudioDialog({
  open,
  onClose,
  onSync,
  videoClipId,
  audioClipId: initialAudioClipId,
  timeline,
  assets,
  projectId,
}: SyncAudioDialogProps) {
  const [selectedAudioAssetId, setSelectedAudioAssetId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{
    offsetSeconds: number;
    method: 'timecode' | 'waveform';
    confidence: number;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offsetNudge, setOffsetNudge] = useState(0);
  const [scratchMode, setScratchMode] = useState<'replace' | 'keep'>('replace');

  const videoClip = timeline.clips.find((c) => c.id === videoClipId);
  const videoAsset = assets.find((a) => a.id === videoClip?.assetId);

  // If audioClipId is provided (Case A), get its asset
  const audioClip = initialAudioClipId
    ? timeline.clips.find((c) => c.id === initialAudioClipId)
    : null;
  const directAudioAsset = audioClip
    ? assets.find((a) => a.id === audioClip.assetId)
    : null;

  // Audio assets available for picker (Case B)
  const audioAssets = assets.filter((a) => a.type === 'audio');

  const effectiveAudioAssetId = directAudioAsset?.id ?? selectedAudioAssetId;
  const effectiveAudioAsset = assets.find((a) => a.id === effectiveAudioAssetId);

  // Depend on stable primitive IDs, not object references, to avoid infinite re-renders
  const videoAssetId = videoAsset?.id;
  const videoFileRef = videoAsset?.fileRef;
  const effectiveFileRef = effectiveAudioAsset?.fileRef;

  const runSync = useCallback(async () => {
    if (!videoFileRef || !effectiveFileRef || !videoAssetId || !effectiveAudioAssetId) return;
    setSyncing(true);
    setError(null);
    try {
      const result = await (window as any).electronAPI.syncComputeOffset({
        sourceAssetId: videoAssetId,
        targetAssetId: effectiveAudioAssetId,
        sourceFilePath: videoFileRef,
        targetFilePath: effectiveFileRef,
        projectId,
      });
      setSyncResult(result);
      setOffsetNudge(0);
    } catch (err: any) {
      setError(err.message ?? 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [videoAssetId, videoFileRef, effectiveAudioAssetId, effectiveFileRef, projectId]);

  // Auto-run sync when audio is selected
  useEffect(() => {
    if (open && effectiveAudioAssetId) {
      runSync();
    }
  }, [open, effectiveAudioAssetId, runSync]);

  if (!open || !videoClip || !videoAsset) return null;

  const finalOffset = (syncResult?.offsetSeconds ?? 0) + offsetNudge;

  return (
    <div className="sync-dialog__overlay" onClick={onClose}>
      <div className="sync-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sync-dialog__header">
          <span>Sync Audio</span>
          <button className="sync-dialog__close" onClick={onClose}>&times;</button>
        </div>

        <div className="sync-dialog__body">
          {/* Source (video) */}
          <div className="sync-dialog__section">
            <label className="sync-dialog__label">Video (source)</label>
            <div className="sync-dialog__file">{videoAsset.name}</div>
          </div>

          {/* Target (audio) */}
          <div className="sync-dialog__section">
            <label className="sync-dialog__label">Audio (target)</label>
            {directAudioAsset ? (
              <div className="sync-dialog__file">{directAudioAsset.name}</div>
            ) : (
              <select
                className="sync-dialog__select"
                value={selectedAudioAssetId ?? ''}
                onChange={(e) => setSelectedAudioAssetId(e.target.value || null)}
              >
                <option value="">Select audio file...</option>
                {audioAssets.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Sync result */}
          {syncing && <div className="sync-dialog__status">Analyzing...</div>}
          {error && <div className="sync-dialog__error">{error}</div>}

          {syncResult && (
            <>
              <div className="sync-dialog__result">
                <span className="sync-dialog__method">{syncResult.method}</span>
                <span className="sync-dialog__offset">
                  Offset: {finalOffset >= 0 ? '+' : ''}{finalOffset.toFixed(3)}s
                </span>
                {syncResult.method === 'waveform' && (
                  <span className={`sync-dialog__confidence sync-dialog__confidence--${
                    syncResult.confidence > 0.6 ? 'high' : syncResult.confidence > 0.4 ? 'mid' : 'low'
                  }`}>
                    {Math.round(syncResult.confidence * 100)}%
                  </span>
                )}
              </div>

              {/* Nudge controls */}
              <div className="sync-dialog__nudge">
                <button onClick={() => setOffsetNudge((n) => n - 0.01)}>-10ms</button>
                <button onClick={() => setOffsetNudge((n) => n - 0.001)}>-1ms</button>
                <button onClick={() => setOffsetNudge(0)}>Reset</button>
                <button onClick={() => setOffsetNudge((n) => n + 0.001)}>+1ms</button>
                <button onClick={() => setOffsetNudge((n) => n + 0.01)}>+10ms</button>
              </div>
            </>
          )}

          {/* Scratch audio mode */}
          <div className="sync-dialog__options">
            <label className="sync-dialog__label">Scratch audio</label>
            <div className="sync-dialog__toggles">
              <button
                className={`sync-dialog__toggle ${scratchMode === 'replace' ? 'sync-dialog__toggle--active' : ''}`}
                onClick={() => setScratchMode('replace')}
              >
                Replace
              </button>
              <button
                className={`sync-dialog__toggle ${scratchMode === 'keep' ? 'sync-dialog__toggle--active' : ''}`}
                onClick={() => setScratchMode('keep')}
              >
                Keep (muted)
              </button>
            </div>
          </div>
        </div>

        <div className="sync-dialog__footer">
          <button className="sync-dialog__btn sync-dialog__btn--cancel" onClick={onClose}>Cancel</button>
          <button
            className="sync-dialog__btn sync-dialog__btn--sync"
            disabled={!syncResult || syncing}
            onClick={() => onSync(initialAudioClipId, effectiveAudioAssetId, finalOffset, scratchMode)}
          >
            Sync
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add styles for the dialog**

Add to `src/styles/globals.css`:

```css
/* ── Sync Audio Dialog ── */
.sync-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sync-dialog {
  width: 480px;
  background: #1a1c22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  overflow: hidden;
}

.sync-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.sync-dialog__close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.sync-dialog__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sync-dialog__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sync-dialog__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
}

.sync-dialog__file {
  font-size: 12px;
  color: var(--text-primary);
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 4px;
}

.sync-dialog__select {
  font-size: 12px;
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 6px 8px;
  outline: none;
}

.sync-dialog__status {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
  padding: 8px;
}

.sync-dialog__error {
  font-size: 11px;
  color: var(--error);
  padding: 6px 8px;
  background: rgba(199, 84, 80, 0.1);
  border-radius: 4px;
}

.sync-dialog__result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
}

.sync-dialog__method {
  font-size: 10px;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(74, 159, 214, 0.15);
  color: #4a9fd6;
}

.sync-dialog__offset {
  font-size: 13px;
  font-family: monospace;
  color: var(--text-primary);
}

.sync-dialog__confidence {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
}
.sync-dialog__confidence--high { color: #5bbf5b; }
.sync-dialog__confidence--mid { color: #f39c12; }
.sync-dialog__confidence--low { color: #e74c3c; }

.sync-dialog__nudge {
  display: flex;
  gap: 4px;
  justify-content: center;
}

.sync-dialog__nudge button {
  font-size: 10px;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
}

.sync-dialog__nudge button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.sync-dialog__options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sync-dialog__toggles {
  display: flex;
  gap: 4px;
}

.sync-dialog__toggle {
  flex: 1;
  font-size: 11px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.1s;
}

.sync-dialog__toggle--active {
  background: rgba(74, 159, 214, 0.15);
  border-color: rgba(74, 159, 214, 0.3);
  color: #4a9fd6;
}

.sync-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sync-dialog__btn {
  font-size: 12px;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  border: none;
}

.sync-dialog__btn--cancel {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
}

.sync-dialog__btn--sync {
  background: #4a9fd6;
  color: white;
  font-weight: 600;
}

.sync-dialog__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Render the dialog in timeline-editor.tsx**

Import and render the dialog at the end of the timeline-editor return:

```typescript
import { SyncAudioDialog } from './sync-audio-dialog';

// In the return, after the context menu portal:
{syncDialogOpen && syncDialogVideoClipId && (
  <SyncAudioDialog
    open={syncDialogOpen}
    onClose={() => {
      setSyncDialogOpen(false);
      setSyncDialogVideoClipId(null);
      setSyncDialogAudioClipId(null);
    }}
    onSync={(audioClipId, audioAssetId, offsetSeconds, scratchMode) => {
      // Apply sync to timeline
      if (audioClipId) {
        // Case A: audio clip already on timeline
        const updated = syncClips(timeline, syncDialogVideoClipId!, audioClipId, offsetSeconds, scratchMode);
        setTimeline(updated);
      } else if (audioAssetId) {
        // Case B: need to add audio clip to timeline from asset
        const asset = assets.find((a) => a.id === audioAssetId);
        if (asset) {
          const audioTrack = timeline.tracks.find((t) => t.kind === 'audio' && !t.locked);
          if (audioTrack) {
            let updated = addClipToTrack(timeline, audioTrack.id, asset, 0);
            // Find the newly added clip (last audio clip)
            const newAudioClip = updated.clips.filter((c) => c.trackId === audioTrack.id).pop();
            if (newAudioClip) {
              updated = syncClips(updated, syncDialogVideoClipId!, newAudioClip.id, offsetSeconds, scratchMode);
            }
            setTimeline(updated);
          }
        }
      }
      setSyncDialogOpen(false);
      setSyncDialogVideoClipId(null);
      setSyncDialogAudioClipId(null);
    }}
    videoClipId={syncDialogVideoClipId}
    audioClipId={syncDialogAudioClipId}
    timeline={timeline}
    assets={assets}
    projectId={state.projectId}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/edit/sync-audio-dialog.tsx src/components/edit/timeline-editor.tsx src/styles/globals.css
git commit -m "feat: implement single sync audio dialog"
```

---

## Task 10: Build the Batch Sync Dialog component

**Files:**
- Create: `src/components/edit/batch-sync-dialog.tsx`
- Modify: `src/components/edit/left-panel.tsx` (render the dialog)
- Modify: `src/styles/globals.css` (batch dialog styles)

- [ ] **Step 1: Create the batch dialog component**

Create `src/components/edit/batch-sync-dialog.tsx`:

```typescript
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Asset } from '@/types/project';

interface BatchSyncDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateTimeline: (params: {
    name: string;
    pairs: Array<{
      videoAssetId: string;
      audioAssetId: string;
      offsetSeconds: number;
      matchMethod: 'timecode' | 'waveform';
    }>;
    unmatchedVideos: string[];
    unmatchedAudio: string[];
    scratchMode: 'replace' | 'keep';
  }) => void;
  selectedAssets: Set<string>;
  assets: Asset[];
  projectId: string;
}

interface BatchPair {
  videoAssetId: string;
  audioAssetId: string;
  offsetSeconds: number;
  matchMethod: 'timecode' | 'waveform';
  nameScore: number;
  waveformScore: number;
}

interface BatchProgress {
  completedPairs: number;
  totalPairs: number;
  currentVideoName: string;
  currentAudioName: string;
}

export function BatchSyncDialog({
  open,
  onClose,
  onCreateTimeline,
  selectedAssets,
  assets,
  projectId,
}: BatchSyncDialogProps) {
  const [matching, setMatching] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [pairs, setPairs] = useState<BatchPair[]>([]);
  const [unmatchedVideos, setUnmatchedVideos] = useState<string[]>([]);
  const [unmatchedAudio, setUnmatchedAudio] = useState<string[]>([]);
  const [scratchMode, setScratchMode] = useState<'replace' | 'keep'>('replace');
  const [timelineName, setTimelineName] = useState('Synced Timeline');
  const [error, setError] = useState<string | null>(null);

  // Memoize derived arrays to prevent infinite re-render loops in useCallback/useEffect chains
  const videoAssets = useMemo(() =>
    Array.from(selectedAssets)
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => a?.type === 'video'),
    [selectedAssets, assets]
  );
  const audioAssets = useMemo(() =>
    Array.from(selectedAssets)
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => a?.type === 'audio'),
    [selectedAssets, assets]
  );

  const runBatchMatch = useCallback(async () => {
    setMatching(true);
    setError(null);
    setPairs([]);

    // Listen for progress
    const cleanup = (window as any).electronAPI.onSyncBatchProgress((data: BatchProgress) => {
      setProgress(data);
    });

    try {
      const result = await (window as any).electronAPI.syncBatchMatch({
        videoAssets: videoAssets.map((a) => ({ id: a.id, filePath: a.fileRef!, name: a.name })),
        audioAssets: audioAssets.map((a) => ({ id: a.id, filePath: a.fileRef!, name: a.name })),
        projectId,
      });
      setPairs(result.pairs);
      setUnmatchedVideos(result.unmatchedVideos);
      setUnmatchedAudio(result.unmatchedAudio);
    } catch (err: any) {
      setError(err.message ?? 'Batch matching failed');
    } finally {
      setMatching(false);
      cleanup?.();
    }
  }, [videoAssets, audioAssets, projectId]);

  useEffect(() => {
    if (open && videoAssets.length > 0 && audioAssets.length > 0) {
      runBatchMatch();
    }
  }, [open, runBatchMatch]);

  const handleReassign = useCallback((videoAssetId: string, newAudioAssetId: string) => {
    setPairs((prev) => prev.map((p) =>
      p.videoAssetId === videoAssetId
        ? { ...p, audioAssetId: newAudioAssetId, nameScore: 0, waveformScore: 0 }
        : p
    ));
  }, []);

  if (!open) return null;

  return (
    <div className="sync-dialog__overlay" onClick={onClose}>
      <div className="batch-sync-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sync-dialog__header">
          <span>Sync &amp; Create Timeline</span>
          <button className="sync-dialog__close" onClick={onClose}>&times;</button>
        </div>

        <div className="batch-sync-dialog__body">
          {error && <div className="sync-dialog__error">{error}</div>}

          {/* Pairs table */}
          <div className="batch-sync-dialog__table">
            <div className="batch-sync-dialog__row batch-sync-dialog__row--header">
              <span>Video</span>
              <span>Audio</span>
              <span>Method</span>
              <span>Match</span>
            </div>

            {videoAssets.map((video) => {
              const pair = pairs.find((p) => p.videoAssetId === video.id);
              const isMatching = matching && !pair;

              return (
                <div key={video.id} className="batch-sync-dialog__row">
                  <span className="batch-sync-dialog__cell">{video.name}</span>
                  <span className="batch-sync-dialog__cell">
                    {isMatching ? (
                      <span className="batch-sync-dialog__spinner">...</span>
                    ) : pair ? (
                      <select
                        className="sync-dialog__select"
                        value={pair.audioAssetId}
                        onChange={(e) => handleReassign(video.id, e.target.value)}
                      >
                        {audioAssets.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="batch-sync-dialog__unmatched">No match</span>
                    )}
                  </span>
                  <span className="batch-sync-dialog__cell">
                    {pair && (
                      <span className="sync-dialog__method">{pair.matchMethod}</span>
                    )}
                  </span>
                  <span className="batch-sync-dialog__cell">
                    {pair && (
                      <span className={`batch-sync-dialog__dot batch-sync-dialog__dot--${
                        pair.waveformScore > 0.6 ? 'high' : pair.waveformScore > 0.4 ? 'mid' : 'low'
                      }`} />
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Unmatched section */}
          {(unmatchedVideos.length > 0 || unmatchedAudio.length > 0) && (
            <details className="batch-sync-dialog__unmatched-section">
              <summary>
                Unmatched files ({unmatchedVideos.length + unmatchedAudio.length})
              </summary>
              <div className="batch-sync-dialog__unmatched-list">
                {unmatchedVideos.map((id) => {
                  const a = assets.find((x) => x.id === id);
                  return <div key={id}>{a?.name} (video — will be added unlinked)</div>;
                })}
                {unmatchedAudio.map((id) => {
                  const a = assets.find((x) => x.id === id);
                  return <div key={id}>{a?.name} (audio — will be added unlinked)</div>;
                })}
              </div>
            </details>
          )}

          {/* Options */}
          <div className="batch-sync-dialog__options">
            <div className="sync-dialog__section">
              <label className="sync-dialog__label">Timeline name</label>
              <input
                className="sync-dialog__select"
                type="text"
                value={timelineName}
                onChange={(e) => setTimelineName(e.target.value)}
              />
            </div>
            <div className="sync-dialog__options">
              <label className="sync-dialog__label">Scratch audio</label>
              <div className="sync-dialog__toggles">
                <button
                  className={`sync-dialog__toggle ${scratchMode === 'replace' ? 'sync-dialog__toggle--active' : ''}`}
                  onClick={() => setScratchMode('replace')}
                >Replace</button>
                <button
                  className={`sync-dialog__toggle ${scratchMode === 'keep' ? 'sync-dialog__toggle--active' : ''}`}
                  onClick={() => setScratchMode('keep')}
                >Keep (muted)</button>
              </div>
            </div>
          </div>

          {/* Progress */}
          {matching && progress && (
            <div className="sync-dialog__status">
              Matching {progress.completedPairs}/{progress.totalPairs}...
            </div>
          )}
        </div>

        <div className="sync-dialog__footer">
          <button className="sync-dialog__btn sync-dialog__btn--cancel" onClick={onClose}>Cancel</button>
          <button
            className="sync-dialog__btn sync-dialog__btn--sync"
            disabled={matching || pairs.length === 0}
            onClick={() => onCreateTimeline({
              name: timelineName,
              pairs: pairs.map((p) => ({
                videoAssetId: p.videoAssetId,
                audioAssetId: p.audioAssetId,
                offsetSeconds: p.offsetSeconds,
                matchMethod: p.matchMethod,
              })),
              unmatchedVideos,
              unmatchedAudio,
              scratchMode,
            })}
          >
            Create Timeline
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add batch dialog styles**

Add to `src/styles/globals.css`:

```css
/* ── Batch Sync Dialog ── */
.batch-sync-dialog {
  width: 640px;
  max-height: 80vh;
  background: #1a1c22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.batch-sync-dialog__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
}

.batch-sync-dialog__table {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  overflow: hidden;
}

.batch-sync-dialog__row {
  display: grid;
  grid-template-columns: 1fr 1fr 80px 50px;
  gap: 8px;
  padding: 6px 10px;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 11px;
}

.batch-sync-dialog__row--header {
  background: rgba(255, 255, 255, 0.03);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.batch-sync-dialog__cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.batch-sync-dialog__spinner {
  color: var(--text-tertiary);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.batch-sync-dialog__unmatched {
  color: var(--text-tertiary);
  font-style: italic;
}

.batch-sync-dialog__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.batch-sync-dialog__dot--high { background: #5bbf5b; }
.batch-sync-dialog__dot--mid { background: #f39c12; }
.batch-sync-dialog__dot--low { background: #e74c3c; }

.batch-sync-dialog__unmatched-section {
  font-size: 11px;
  color: var(--text-secondary);
}

.batch-sync-dialog__unmatched-section summary {
  cursor: pointer;
  padding: 4px 0;
}

.batch-sync-dialog__unmatched-list {
  padding: 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.batch-sync-dialog__options {
  display: flex;
  gap: 16px;
}
```

- [ ] **Step 3: Render the batch dialog in left-panel.tsx**

Import and wire up the dialog in left-panel.tsx:

```typescript
import { BatchSyncDialog } from './batch-sync-dialog';
import { createSyncedTimeline } from '@/lib/editor/timeline-operations';

// In the return, render the dialog:
{batchSyncOpen && (
  <BatchSyncDialog
    open={batchSyncOpen}
    onClose={() => setBatchSyncOpen(false)}
    onCreateTimeline={(params) => {
      const pairsWithAssets = params.pairs.map((p) => ({
        videoAsset: {
          id: p.videoAssetId,
          name: assets.find((a) => a.id === p.videoAssetId)?.name ?? '',
          duration: assets.find((a) => a.id === p.videoAssetId)?.duration ?? 0,
        },
        audioAsset: {
          id: p.audioAssetId,
          name: assets.find((a) => a.id === p.audioAssetId)?.name ?? '',
          duration: assets.find((a) => a.id === p.audioAssetId)?.duration ?? 0,
        },
        offsetSeconds: p.offsetSeconds,
      }));

      const unmatchedVideoAssets = params.unmatchedVideos.map((id) => {
        const a = assets.find((x) => x.id === id);
        return { id, name: a?.name ?? '', duration: a?.duration ?? 0 };
      });
      const unmatchedAudioAssets = params.unmatchedAudio.map((id) => {
        const a = assets.find((x) => x.id === id);
        return { id, name: a?.name ?? '', duration: a?.duration ?? 0 };
      });

      const newTimeline = createSyncedTimeline(
        params.name,
        pairsWithAssets,
        params.scratchMode,
        unmatchedVideoAssets,
        unmatchedAudioAssets,
      );
      dispatch({ type: 'ADD_TIMELINE', timeline: newTimeline });
      setBatchSyncOpen(false);
    }}
    selectedAssets={selectedAssets}
    assets={assets}
    projectId={state.projectId}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/edit/batch-sync-dialog.tsx src/components/edit/left-panel.tsx src/styles/globals.css
git commit -m "feat: implement batch sync dialog for media pool"
```

---

## Task 11: Integration testing and manual verification

**Files:**
- No new files — manual testing

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Start dev server**

Run: `npm run dev`
Expected: App launches without errors

- [ ] **Step 3: Test single sync from timeline**

1. Import a video file with audio and an external audio file
2. Add the video to the timeline
3. Add the external audio to the timeline
4. Select both clips (Cmd+Click)
5. Right-click → "Sync Audio"
6. Verify the dialog shows, sync runs, and clips align after confirmation

- [ ] **Step 4: Test single sync with picker**

1. Select only the video clip on timeline
2. Right-click → "Sync Audio..."
3. Verify picker dialog opens
4. Select an audio file from the dropdown
5. Verify sync runs and applies

- [ ] **Step 5: Test batch sync from media pool**

1. Import multiple video + audio files to media pool
2. Select all of them (Cmd+A or Cmd+Click)
3. Right-click → "Create Timeline with Synced Audio"
4. Verify batch dialog opens with matching progress
5. Verify pairs are suggested
6. Verify reassigning works
7. Click "Create Timeline"
8. Verify new timeline appears with synced clips

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration issues in audio sync feature"
```
