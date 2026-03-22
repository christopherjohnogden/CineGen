# SP3: Playback Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered playback code with a unified PlaybackEngine class using Web Audio API for audio mixing and the existing video pool pattern for video.

**Architecture:** `PlaybackEngine` is a plain TypeScript class (not React) that owns the RAF loop, video pool, and Web Audio graph. `usePlaybackEngine` hook wraps it for React lifecycle. EditTab delegates all playback to the engine instead of managing it inline.

**Tech Stack:** TypeScript, Web Audio API, React hooks

---

## Chunk 1: Core Engine + Hook

### Task 1: Add volume to Track type

**Files:**
- Modify: `src/types/timeline.ts`

- [ ] **Step 1: Add volume field to Track interface**

In `src/types/timeline.ts`, add `volume: number;` after `visible: boolean;` in the Track interface:

```typescript
export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  visible: boolean;
  volume: number;  // 0–1, default 1
}
```

- [ ] **Step 2: Update createDefaultTimeline**

In `timeline-operations.ts`, add `volume: 1` to each track in `createDefaultTimeline()`.

- [ ] **Step 3: Update timeline-migration.ts**

In `migrateSequenceToTimelines()`, ensure migrated tracks get `volume: 1` as default.

- [ ] **Step 4: Fix TypeScript errors**

Run `npx tsc --noEmit`. Fix any places that create Track objects without volume (search for `locked: false, visible: true` pattern — each needs `volume: 1` added after).

Files likely needing updates:
- `src/lib/editor/timeline-operations.ts` (addTrack function)
- `src/lib/editor/timeline-migration.ts`
- `tests/lib/editor/timeline-operations.test.ts` (test fixtures)

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add volume property to Track type (default 1)"
```

---

### Task 2: Create PlaybackEngine class

**Files:**
- Create: `src/lib/editor/playback-engine.ts`

- [ ] **Step 1: Write the PlaybackEngine class**

Create `src/lib/editor/playback-engine.ts` with the full engine implementation:

```typescript
import type { Timeline, Clip, Track } from '@/types/timeline';
import type { Asset } from '@/types/project';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';

export interface ActiveClipEntry {
  clip: Clip;
  asset: Asset;
}

export interface PlaybackEngineCallbacks {
  onTimeUpdate: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onActiveClipsChange: (clips: ActiveClipEntry[]) => void;
}

export class PlaybackEngine {
  private timeline: Timeline | null = null;
  private assets: Asset[] = [];
  private callbacks: PlaybackEngineCallbacks;

  // Transport state
  private _currentTime = 0;
  private _isPlaying = false;
  private _speed = 1;
  private _loop = false;

  // RAF
  private rafId: number | null = null;
  private lastFrameTime = 0;

  // Video pool
  private videoPool = new Map<string, HTMLVideoElement>();
  private videoContainer: HTMLDivElement | null = null;
  private activeVideoUrl: string | null = null;
  private zGen = 1;

  // Audio mixer (Web Audio API)
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackGains = new Map<string, GainNode>();
  private audioSources = new Map<string, { el: HTMLAudioElement; source: MediaElementAudioSourceNode }>();

  // Mute/solo cache
  private mutedTrackIds = new Set<string>();

  // Previous active clips for change detection
  private prevActiveClipIds = '';

  constructor(callbacks: PlaybackEngineCallbacks) {
    this.callbacks = callbacks;
  }

  // --- Public API ---

  get currentTime(): number { return this._currentTime; }
  get isPlaying(): boolean { return this._isPlaying; }
  get speed(): number { return this._speed; }
  get loop(): boolean { return this._loop; }

  play(): void {
    if (this._isPlaying) return;
    this.resumeAudioContext();
    this._isPlaying = true;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
    this.callbacks.onPlay();
    this.syncAudio();
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.callbacks.onPause();
    this.pauseAllAudio();
    this.pauseAllVideo();
  }

  seek(time: number): void {
    const duration = this.timeline?.duration ?? 0;
    this._currentTime = Math.max(0, Math.min(time, duration));
    this.callbacks.onTimeUpdate(this._currentTime);
    this.syncVideo();
    this.syncAudio();
    this.updateActiveClips();
  }

  setSpeed(rate: number): void {
    this._speed = Math.max(0.25, Math.min(4, rate));
  }

  toggleLoop(): void {
    this._loop = !this._loop;
  }

  // --- State Sync ---

  setTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    this.updateMutedTracks();
    this.updateVideoPool();
    this.updateAudioGraph();
    if (!this._isPlaying) {
      this.syncVideo();
      this.updateActiveClips();
    }
  }

  setAssets(assets: Asset[]): void {
    this.assets = assets;
    this.updateVideoPool();
  }

  // --- Video Pool ---

  setVideoContainer(container: HTMLDivElement | null): void {
    this.videoContainer = container;
    if (container) this.updateVideoPool();
  }

  private updateVideoPool(): void {
    if (!this.videoContainer || !this.timeline) return;

    const neededUrls = new Set<string>();
    for (const clip of this.timeline.clips) {
      const asset = this.assets.find((a) => a.id === clip.assetId);
      if (asset?.type === 'video') neededUrls.add(asset.url);
    }

    // Remove stale
    for (const [url, el] of this.videoPool) {
      if (!neededUrls.has(url)) {
        el.pause();
        el.removeAttribute('src');
        el.remove();
        this.videoPool.delete(url);
      }
    }

    // Add new
    for (const url of neededUrls) {
      if (!this.videoPool.has(url)) {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;pointer-events:none;';
        this.videoContainer.appendChild(video);
        this.videoPool.set(url, video);
      }
    }
  }

  private syncVideo(): void {
    if (!this.timeline) return;

    const activeVisual = this.getActiveClips().find(
      (e) => e.asset.type === 'video',
    );
    const targetUrl = activeVisual?.asset.url ?? null;

    for (const [url, el] of this.videoPool) {
      if (url === targetUrl && activeVisual) {
        const sourceTime = activeVisual.clip.trimStart + (this._currentTime - activeVisual.clip.startTime);
        el.style.opacity = '1';
        el.style.zIndex = String(++this.zGen);

        if (this._isPlaying) {
          el.playbackRate = this._speed;
          if (Math.abs(el.currentTime - sourceTime) > 0.3) {
            el.currentTime = sourceTime;
          }
          if (el.paused) el.play().catch(() => {});
        } else {
          el.pause();
          el.currentTime = sourceTime;
        }
      } else {
        el.style.opacity = '0';
        el.style.zIndex = '0';
        if (!el.paused) el.pause();
      }
    }

    this.activeVideoUrl = targetUrl;
  }

  private pauseAllVideo(): void {
    for (const el of this.videoPool.values()) {
      if (!el.paused) el.pause();
    }
  }

  // --- Web Audio API ---

  private ensureAudioContext(): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
    }
  }

  private resumeAudioContext(): void {
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  private updateAudioGraph(): void {
    if (!this.timeline) return;
    this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    // Update track gain nodes
    const currentTrackIds = new Set(this.timeline.tracks.map((t) => t.id));

    // Remove stale track gains
    for (const [id, gain] of this.trackGains) {
      if (!currentTrackIds.has(id)) {
        gain.disconnect();
        this.trackGains.delete(id);
      }
    }

    // Add/update track gains
    for (const track of this.timeline.tracks) {
      if (track.kind !== 'audio') continue;
      let gain = this.trackGains.get(track.id);
      if (!gain) {
        gain = this.audioContext.createGain();
        gain.connect(this.masterGain);
        this.trackGains.set(track.id, gain);
      }
      const isMuted = this.mutedTrackIds.has(track.id);
      gain.gain.value = isMuted ? 0 : track.volume;
    }
  }

  private syncAudio(): void {
    if (!this.timeline || !this.audioContext || !this.masterGain) return;

    const activeAudio = this.getActiveClips().filter((e) => e.asset.type === 'audio');
    const activeIds = new Set(activeAudio.map((e) => e.asset.id));

    // Start/sync active audio
    for (const entry of activeAudio) {
      const sourceTime = entry.clip.trimStart + (this._currentTime - entry.clip.startTime);
      let src = this.audioSources.get(entry.asset.id);

      if (!src) {
        const el = new Audio(entry.asset.url);
        el.preload = 'auto';
        const source = this.audioContext.createMediaElementSource(el);
        const trackGain = this.trackGains.get(entry.clip.trackId);
        if (trackGain) source.connect(trackGain);
        else source.connect(this.masterGain);
        src = { el, source };
        this.audioSources.set(entry.asset.id, src);
      }

      if (this._isPlaying) {
        src.el.playbackRate = this._speed;
        if (src.el.paused || Math.abs(src.el.currentTime - sourceTime) > 0.5) {
          src.el.currentTime = sourceTime;
        }
        if (src.el.paused) src.el.play().catch(() => {});
      } else {
        src.el.pause();
        src.el.currentTime = sourceTime;
      }
    }

    // Pause inactive
    for (const [id, src] of this.audioSources) {
      if (!activeIds.has(id)) {
        src.el.pause();
      }
    }
  }

  private pauseAllAudio(): void {
    for (const src of this.audioSources.values()) {
      src.el.pause();
    }
  }

  // --- Mute/Solo ---

  private updateMutedTracks(): void {
    if (!this.timeline) return;
    const hasSolo = this.timeline.tracks.some((t) => t.solo);
    this.mutedTrackIds.clear();
    for (const track of this.timeline.tracks) {
      if (hasSolo ? !track.solo : track.muted) {
        this.mutedTrackIds.add(track.id);
      }
    }
    this.updateAudioGraph();
  }

  // --- Active Clips ---

  private getActiveClips(): ActiveClipEntry[] {
    if (!this.timeline) return [];
    const clips: ActiveClipEntry[] = [];
    for (const clip of this.timeline.clips) {
      if (this.mutedTrackIds.has(clip.trackId)) continue;
      if (this._currentTime >= clip.startTime && this._currentTime < clipEndTime(clip)) {
        const asset = this.assets.find((a) => a.id === clip.assetId);
        if (asset) clips.push({ clip, asset });
      }
    }
    return clips;
  }

  private updateActiveClips(): void {
    const active = this.getActiveClips();
    const key = active.map((e) => e.clip.id).join(',');
    if (key !== this.prevActiveClipIds) {
      this.prevActiveClipIds = key;
      this.callbacks.onActiveClipsChange(active);
    }
  }

  // --- RAF Tick ---

  private tick = (now: number): void => {
    const dt = ((now - this.lastFrameTime) / 1000) * this._speed;
    this.lastFrameTime = now;
    const duration = this.timeline?.duration ?? 0;
    let nextTime = this._currentTime + dt;

    if (nextTime >= duration) {
      if (this._loop) {
        nextTime = 0;
      } else {
        nextTime = duration;
        this.pause();
        this._currentTime = nextTime;
        this.callbacks.onTimeUpdate(nextTime);
        this.updateActiveClips();
        return;
      }
    }

    this._currentTime = nextTime;
    this.callbacks.onTimeUpdate(nextTime);
    this.syncVideo();
    this.updateActiveClips();

    // Periodic audio drift correction (every ~500ms worth of ticks)
    // We correct in syncAudio which checks for >0.5s drift

    if (this._isPlaying) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  // --- Cleanup ---

  destroy(): void {
    this.pause();
    // Clean video pool
    for (const el of this.videoPool.values()) {
      el.pause();
      el.removeAttribute('src');
      el.remove();
    }
    this.videoPool.clear();

    // Clean audio
    for (const src of this.audioSources.values()) {
      src.el.pause();
      src.el.src = '';
      src.source.disconnect();
    }
    this.audioSources.clear();

    for (const gain of this.trackGains.values()) {
      gain.disconnect();
    }
    this.trackGains.clear();

    this.masterGain?.disconnect();
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.masterGain = null;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/playback-engine.ts
git commit -m "feat: add PlaybackEngine class with video pool + Web Audio mixer"
```

---

### Task 3: Create usePlaybackEngine hook

**Files:**
- Create: `src/components/edit/use-playback-engine.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useRef, useCallback, useState, useEffect } from 'react';
import { PlaybackEngine, type ActiveClipEntry } from '@/lib/editor/playback-engine';
import type { Timeline } from '@/types/timeline';
import type { Asset } from '@/types/project';

export function usePlaybackEngine(timeline: Timeline, assets: Asset[]) {
  const engineRef = useRef<PlaybackEngine | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeClips, setActiveClips] = useState<ActiveClipEntry[]>([]);

  // Create engine once
  if (!engineRef.current) {
    engineRef.current = new PlaybackEngine({
      onTimeUpdate: setCurrentTime,
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onActiveClipsChange: setActiveClips,
    });
  }

  const engine = engineRef.current;

  // Sync timeline changes
  useEffect(() => {
    engine.setTimeline(timeline);
  }, [engine, timeline]);

  // Sync assets
  useEffect(() => {
    engine.setAssets(assets);
  }, [engine, assets]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engine.destroy();
    };
  }, [engine]);

  // Transport controls
  const play = useCallback(() => engine.play(), [engine]);
  const pause = useCallback(() => engine.pause(), [engine]);
  const togglePlayPause = useCallback(() => {
    if (engine.isPlaying) engine.pause();
    else {
      // If at the end, restart from beginning
      if (engine.currentTime >= (timeline.duration || 0)) engine.seek(0);
      engine.play();
    }
  }, [engine, timeline.duration]);
  const seek = useCallback((time: number) => engine.seek(time), [engine]);
  const setSpeed = useCallback((rate: number) => engine.setSpeed(rate), [engine]);
  const toggleLoop = useCallback(() => engine.toggleLoop(), [engine]);

  // Video container ref callback
  const setVideoContainer = useCallback(
    (el: HTMLDivElement | null) => engine.setVideoContainer(el),
    [engine],
  );

  return {
    currentTime,
    isPlaying,
    activeClips,
    play,
    pause,
    togglePlayPause,
    seek,
    setSpeed,
    toggleLoop,
    setVideoContainer,
    engine,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/use-playback-engine.ts
git commit -m "feat: add usePlaybackEngine React hook"
```

---

### Task 4: Wire engine into EditTab

**Files:**
- Modify: `src/components/edit/edit-tab.tsx`
- Modify: `src/components/edit/timeline-viewer.tsx`

This is the big integration task. EditTab currently has ~80 lines of inline playback logic (RAF loop, activeClips, audioEntries, videoUrls, nextVideoHint, visual entry stabilization, muted track calculation). All of this moves into the engine.

- [ ] **Step 1: Add usePlaybackEngine to EditTab**

Add import and call the hook near the top of EditTab:
```typescript
import { usePlaybackEngine } from './use-playback-engine';
```

Call it after `timeline` and `state.assets` are available:
```typescript
const {
  currentTime,
  isPlaying,
  activeClips: engineActiveClips,
  togglePlayPause,
  seek: handleSeek,
  setVideoContainer,
} = usePlaybackEngine(timeline, state.assets);
```

- [ ] **Step 2: Remove old playback code from EditTab**

Delete these sections:
1. `const [currentTime, setCurrentTime] = useState(0)` and `const [isPlaying, setIsPlaying] = useState(false)` — replaced by hook
2. `rafRef` and `lastTimeRef` refs — moved into engine
3. The entire RAF `useEffect` (lines ~157-178) — engine handles this
4. `mutedTrackIds` useMemo — engine handles this
5. `activeClips` useMemo — engine provides via `engineActiveClips`
6. `visualEntryRaw` / `visualClipIdRef` / `visualEntryRef` stabilization — derive from engineActiveClips
7. `videoUrls` useMemo — engine manages pool internally
8. `nextVideoHint` useMemo — engine handles pre-seeking internally
9. `audioEntriesRaw` / `audioKeyRef` / `audioEntriesRef` stabilization — engine handles
10. `handlePlayPause` callback — replaced by `togglePlayPause` from hook
11. `handleSeek` callback — replaced by `seek` from hook

Keep derived state that UI needs:
```typescript
// Derive visual entry from engine's activeClips
const visualEntry = engineActiveClips.find(
  (e) => e.asset.type === 'video' || e.asset.type === 'image',
) ?? null;
const activeClip = visualEntry?.clip ?? null;
const activeAsset = visualEntry?.asset ?? null;

// Audio entries for any remaining UI display
const audioEntries = engineActiveClips.filter((e) => e.asset.type === 'audio');

// Duration
const sequenceDuration = Math.max(timeline.duration, 1);
```

- [ ] **Step 3: Update TimelineViewer to use engine's video container**

Simplify `timeline-viewer.tsx` — it no longer manages its own video pool. Instead, it receives a ref callback to set the video container:

```typescript
interface TimelineViewerProps {
  videoContainerRef: (el: HTMLDivElement | null) => void;
  activeAsset: Asset | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
}
```

The component just renders a container div and passes it to the engine:
```typescript
export function TimelineViewer({
  videoContainerRef,
  activeAsset,
  currentTime,
  duration,
  isPlaying,
  onPlayPause,
  onSeek,
}: TimelineViewerProps) {
  return (
    <div className="timeline-viewer">
      <div className="timeline-viewer__media">
        {!activeAsset && (
          <span className="text-tertiary" style={{ fontSize: 13, opacity: 0.5 }}>No clip at playhead</span>
        )}
        <div
          ref={videoContainerRef}
          style={{ position: 'relative', width: '100%', height: '100%' }}
        />
        {activeAsset?.type === 'image' && (
          <img src={activeAsset.url} alt={activeAsset.name}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        )}
      </div>
      <div className="timeline-viewer__transport">
        <button className="timeline-viewer__play-btn" onClick={onPlayPause}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="timeline-viewer__timecode">
          {formatTimecode(currentTime)} / {formatTimecode(duration)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update EditTab JSX to pass new props**

Where TimelineViewer is rendered, update props:
```typescript
<TimelineViewer
  videoContainerRef={setVideoContainer}
  activeAsset={activeAsset}
  currentTime={currentTime}
  duration={sequenceDuration}
  isPlaying={isPlaying}
  onPlayPause={togglePlayPause}
  onSeek={handleSeek}
/>
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire PlaybackEngine into EditTab, simplify TimelineViewer"
```

---

### Task 5: Add volume slider to TrackHeader

**Files:**
- Modify: `src/components/edit/track-header.tsx`
- Modify: `src/styles/edit-tab.css`

- [ ] **Step 1: Add volume slider to TrackHeader**

In `track-header.tsx`, add a volume slider for audio tracks alongside the M/S buttons. The `onUpdate` callback already accepts `Partial<Pick<Track, ...>>` — extend the Pick to include `'volume'`:

```typescript
{track.kind === 'audio' && (
  <input
    type="range"
    className="track-header__volume"
    min={0}
    max={1}
    step={0.01}
    value={track.volume}
    onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) })}
    title={`Volume: ${Math.round(track.volume * 100)}%`}
  />
)}
```

- [ ] **Step 2: Update onUpdate type**

Ensure the `onUpdate` prop type includes `volume`:
```typescript
onUpdate: (updates: Partial<Pick<Track, 'muted' | 'solo' | 'locked' | 'visible' | 'volume' | 'name' | 'color'>>) => void;
```

- [ ] **Step 3: Add CSS for volume slider**

Add to `src/styles/edit-tab.css`:
```css
.track-header__volume {
  width: 48px;
  height: 4px;
  accent-color: var(--accent, #c83232);
  cursor: pointer;
  opacity: 0.7;
}
.track-header__volume:hover {
  opacity: 1;
}
```

- [ ] **Step 4: Update handleUpdateTrack in edit-tab.tsx**

Add `'volume'` to the Pick type in the `handleUpdateTrack` callback.

- [ ] **Step 5: Verify TypeScript compiles and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: add volume slider to audio track headers"
```

---

### Task 6: Migrate preview-player.tsx to use engine

**Files:**
- Modify: `src/components/edit/preview-player.tsx`

The Create tab's `preview-player.tsx` currently has its own video pool and audio sync logic. For SP3, simplify it to create its own `PlaybackEngine` instance (Create tab has different lifecycle than Edit tab).

This task is deferred — the Create tab doesn't need the full engine yet. For now, `preview-player.tsx` continues working as-is with its own inline pool logic. The engine is specifically for the Edit tab.

Mark this as a future enhancement, not blocking SP3 completion.

- [ ] **Step 1: Skip (documented as future work)**

No changes needed. `preview-player.tsx` works correctly as-is.

- [ ] **Step 2: Commit (no-op, just verification)**

Run tests to ensure nothing is broken:
```bash
npx vitest run
npx tsc --noEmit
```
