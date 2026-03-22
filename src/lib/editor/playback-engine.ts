import type { Timeline, Clip, Track } from '@/types/timeline';
import type { Asset } from '@/types/project';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';
import { interpolateProperty } from './timeline-operations';
import { toFileUrl } from '@/lib/utils/file-url';
import { mediaDebug, mediaDebugWarn } from '@/lib/debug/media-debug';

export interface ActiveClipEntry {
  clip: Clip;
  asset: Asset;
}

export type PlaybackProxyMode = 'off' | 'auto' | 'on';

export interface PlaybackEngineCallbacks {
  onTimeUpdate: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onActiveClipsChange: (clips: ActiveClipEntry[]) => void;
  onProxyFallbackRequest?: (assetIds: string[]) => void;
}

export class PlaybackEngine {
  private static readonly MAX_POOL_SIZE = 8;
  private static readonly LOOKAHEAD_SECONDS = 10;
  private static readonly POOL_REFRESH_STEP_SECONDS = PlaybackEngine.LOOKAHEAD_SECONDS / 2;
  private static readonly AUTO_PROXY_LAG_FRAMES_THRESHOLD = 22;
  private static readonly AUTO_PROXY_STAGNANT_FRAMES_THRESHOLD = 14;
  private static readonly AUTO_PROXY_DRIFT_SECONDS = 0.9;
  private static readonly DRIFT_CORRECTION_SECONDS = 1.2;
  private static readonly DRIFT_CORRECTION_COOLDOWN_MS = 500;
  private static readonly AUTO_PROXY_REQUEST_COOLDOWN_MS = 15000;
  private static readonly AUTO_PROXY_METADATA_TIMEOUT_MS = 3500;
  private static readonly AUDIO_DRIFT_CORRECTION_SECONDS = 0.12;
  private static readonly VIDEO_AUDIO_DRIFT_CORRECTION_SECONDS = 0.35;
  private static readonly NON_HTML_VIDEO_CODEC_HINTS = ['prores', 'dnxhr', 'dnxhd', 'cfhd', 'cineform', 'rawvideo'];
  private static readonly MAX_PRELOAD_CACHE_SIZE = 4;

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

  // Video pool — keyed by clip ID so each clip gets its own element
  private videoPool = new Map<string, HTMLVideoElement>();
  private videoContainer: HTMLDivElement | null = null;
  private pendingSeeks = new Map<HTMLVideoElement, number>();

  // Audio playback (HTML media elements with optional Web Audio gain routing for clip boost)
  private audioEls = new Map<string, HTMLAudioElement>();
  private audioContainer: HTMLDivElement | null = null;
  private trackVolumes = new Map<string, number>();
  private audioContext: AudioContext | null = null;
  private mediaAudioNodes = new Map<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>();
  private audioGraphUnavailable = false;

  // Proxy mode + runtime fallback state
  private _proxyMode: PlaybackProxyMode = 'off';
  private autoProxyAssetIds = new Set<string>();
  private autoProxyPendingAssetIds = new Set<string>();
  private proxyRequestTimestamps = new Map<string, number>();
  private compatibilityFallbackWarned = new Set<string>();
  private compatibilityProxyRequested = new Set<string>();
  private playbackHealth = new Map<string, { lastVideoTime: number; lagFrames: number; stagnantFrames: number }>();
  private driftCorrectionTimestamps = new WeakMap<HTMLVideoElement, number>();
  private metadataTimeouts = new WeakMap<HTMLVideoElement, number>();
  private activeClipIdsPrev = new Set<string>(); // tracks previous frame's active clip IDs for newly-active detection
  private clipEntryTimestamps = new Map<string, number>(); // clipId → wall time when it first became active

  // Mute/solo cache
  private mutedTrackIds = new Set<string>();

  // Asset lookup cache (rebuilt on setAssets)
  private assetMap = new Map<string, Asset>();

  // Cached track ID sets (rebuilt on setTimeline)
  private videoTrackIds = new Set<string>();
  private audioTrackIds = new Set<string>();
  private videoTrackOrder: string[] = [];

  // Previous active clips for change detection
  private prevActiveClipIds = '';
  private lastPoolAnchorTime = Number.NaN;

  // Metadata preload cache — eagerly fetches container headers for all video assets
  // so the browser HTTP cache is warm when updateVideoPool creates real elements.
  private metadataPreloadCache = new Map<string, { el: HTMLVideoElement; url: string }>();
  private preloadedAssetOrder: string[] = []; // LRU tracking (oldest first)
  private metadataPreloadEnabled = true;

  // Throttle: UI time updates and audio sync
  private lastUIUpdate = 0;
  private lastAudioSync = 0;

  constructor(callbacks: PlaybackEngineCallbacks) {
    this.callbacks = callbacks;
  }

  // --- Public API ---

  get currentTime(): number {
    return this._currentTime;
  }
  get isPlaying(): boolean {
    return this._isPlaying;
  }
  get speed(): number {
    return this._speed;
  }
  get loop(): boolean {
    return this._loop;
  }

  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;
    this.ensureAudioContext()?.resume().catch(() => {});
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
    this._currentTime = Math.max(0, time);
    this.callbacks.onTimeUpdate(this._currentTime);
    // Clear newly-active tracking so all clips get force-seeked on the next syncVideo
    this.activeClipIdsPrev.clear();
    this.clipEntryTimestamps.clear();
    this.updateVideoPool(true);
    this.syncVideo();
    this.syncAudio();
    this.updateActiveClips();
  }

  handleSystemWake(): void {
    this.ensureAudioContext()?.resume().catch(() => {});
    this.lastFrameTime = performance.now();
    this.lastUIUpdate = 0;
    this.lastAudioSync = 0;
    this.activeClipIdsPrev.clear();
    this.clipEntryTimestamps.clear();
    this.updateVideoPool(true);
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

  setProxyMode(mode: PlaybackProxyMode): void {
    if (this._proxyMode === mode) return;
    mediaDebug('setProxyMode', { from: this._proxyMode, to: mode });
    this._proxyMode = mode;
    if (mode !== 'auto') {
      this.autoProxyAssetIds.clear();
      this.autoProxyPendingAssetIds.clear();
      this.playbackHealth.clear();
      for (const video of this.videoPool.values()) {
        this.clearMetadataTimeout(video);
      }
    }
    if (mode === 'on' || mode === 'off') {
      this.compatibilityFallbackWarned.clear();
    }
    this.updateVideoPool(true);
    this.syncVideo();
    this.updateMetadataPreloadCache();
  }

  setMetadataPreloadEnabled(enabled: boolean): void {
    if (this.metadataPreloadEnabled === enabled) return;
    this.metadataPreloadEnabled = enabled;
    if (!enabled) {
      this.clearMetadataPreloadCache();
      return;
    }
    this.updateMetadataPreloadCache();
  }

  get proxyMode(): PlaybackProxyMode {
    return this._proxyMode;
  }

  setUseProxies(value: boolean): void {
    this.setProxyMode(value ? 'on' : 'off');
  }

  get useProxies(): boolean {
    return this._proxyMode === 'on';
  }

  private isLikelyUnsupportedInHtmlVideo(asset: Asset): boolean {
    if (asset.type !== 'video') return false;
    const codec = (asset.codec ?? '').toLowerCase();
    return PlaybackEngine.NON_HTML_VIDEO_CODEC_HINTS.some((hint) => codec.includes(hint));
  }

  private requestCompatibilityProxy(asset: Asset, reason: string): void {
    if (asset.type !== 'video' || asset.proxyRef) return;
    if (this.compatibilityProxyRequested.has(asset.id)) return;
    this.compatibilityProxyRequested.add(asset.id);
    mediaDebugWarn('compatibility proxy requested', { assetId: asset.id, reason, codec: asset.codec });
    this.callbacks.onProxyFallbackRequest?.([asset.id]);
  }

  private resolvePlaybackUrl(asset: Asset): string {
    const originalUrl = toFileUrl(asset.fileRef || asset.url);
    if (!asset.proxyRef) return originalUrl;
    if (this._proxyMode === 'on') return toFileUrl(asset.proxyRef);
    if (this._proxyMode === 'auto' && this.autoProxyAssetIds.has(asset.id)) {
      return toFileUrl(asset.proxyRef);
    }
    if (this._proxyMode === 'off' && this.isLikelyUnsupportedInHtmlVideo(asset)) {
      if (!this.compatibilityFallbackWarned.has(asset.id)) {
        this.compatibilityFallbackWarned.add(asset.id);
        mediaDebugWarn('original mode compatibility fallback to proxy', {
          assetId: asset.id,
          codec: asset.codec,
          proxyRef: asset.proxyRef,
        });
      }
      return toFileUrl(asset.proxyRef);
    }
    return originalUrl;
  }

  private requestAutoProxy(asset: Asset, reason = 'unspecified'): void {
    if (this._proxyMode !== 'auto' || asset.type !== 'video') return;

    if (asset.proxyRef) {
      if (!this.autoProxyAssetIds.has(asset.id)) {
        this.autoProxyAssetIds.add(asset.id);
        mediaDebug('auto-proxy activated (proxy already exists)', { assetId: asset.id, reason, proxyRef: asset.proxyRef });
        this.updateVideoPool(true);
      }
      return;
    }

    const now = Date.now();
    const lastRequested = this.proxyRequestTimestamps.get(asset.id) ?? 0;
    if (now - lastRequested < PlaybackEngine.AUTO_PROXY_REQUEST_COOLDOWN_MS) {
      mediaDebug('auto-proxy request throttled', { assetId: asset.id, reason });
      return;
    }
    this.proxyRequestTimestamps.set(asset.id, now);
    this.autoProxyPendingAssetIds.add(asset.id);
    mediaDebugWarn('auto-proxy requested', { assetId: asset.id, reason });
    this.callbacks.onProxyFallbackRequest?.([asset.id]);
  }

  private clearMetadataTimeout(video: HTMLVideoElement): void {
    const timeout = this.metadataTimeouts.get(video);
    if (timeout === undefined) return;
    clearTimeout(timeout);
    this.metadataTimeouts.delete(video);
  }

  private armMetadataTimeout(video: HTMLVideoElement, assetId: string): void {
    this.clearMetadataTimeout(video);
    if (this._proxyMode !== 'auto') return;

    const asset = this.assetMap.get(assetId);
    if (!asset || asset.type !== 'video') return;

    const timeout = window.setTimeout(() => {
      const latest = this.assetMap.get(assetId);
      if (latest) this.requestAutoProxy(latest, 'metadata-timeout');
    }, PlaybackEngine.AUTO_PROXY_METADATA_TIMEOUT_MS);

    this.metadataTimeouts.set(video, timeout);
  }

  // --- State Sync ---

  setTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    this.videoTrackIds = new Set(timeline.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
    this.audioTrackIds = new Set(timeline.tracks.filter((t) => t.kind === 'audio').map((t) => t.id));
    this.videoTrackOrder = timeline.tracks.filter((t) => t.kind === 'video').map((t) => t.id);
    this.updateMutedTracks();
    this.updateVideoPool(true);
    this.updateAudioGraph();
    if (!this._isPlaying) {
      this.syncVideo();
      this.updateActiveClips();
    }
  }

  setAssets(assets: Asset[]): void {
    this.assets = assets;
    this.assetMap.clear();
    for (const a of assets) this.assetMap.set(a.id, a);
    if (this._proxyMode === 'auto' && this.autoProxyPendingAssetIds.size > 0) {
      for (const assetId of [...this.autoProxyPendingAssetIds]) {
        const asset = this.assetMap.get(assetId);
        if (asset?.proxyRef) {
          this.autoProxyPendingAssetIds.delete(assetId);
          this.autoProxyAssetIds.add(assetId);
          mediaDebug('auto-proxy became available', { assetId, proxyRef: asset.proxyRef });
        }
      }
    }
    for (const assetId of [...this.compatibilityProxyRequested]) {
      const asset = this.assetMap.get(assetId);
      if (asset?.proxyRef) {
        this.compatibilityProxyRequested.delete(assetId);
        mediaDebug('compatibility proxy became available', { assetId, proxyRef: asset.proxyRef });
      }
    }
    this.updateVideoPool(true);
    this.updateMetadataPreloadCache();
  }

  /**
   * Eagerly preload metadata for all video assets so the browser HTTP cache
   * is warm when updateVideoPool() creates real playback elements.
   * Elements are detached (not in the DOM) and use preload='metadata'
   * to fetch only the container headers (~100-500 KB per file).
   */
  private updateMetadataPreloadCache(): void {
    if (!this.metadataPreloadEnabled) {
      this.clearMetadataPreloadCache();
      return;
    }

    const currentAssetIds = new Set<string>();
    if (this.timeline) {
      for (const clip of this.timeline.clips) {
        if (this.videoTrackIds.has(clip.trackId)) currentAssetIds.add(clip.assetId);
      }
    }

    // Remove entries for assets that no longer exist
    for (const [assetId, entry] of this.metadataPreloadCache) {
      if (!currentAssetIds.has(assetId)) {
        entry.el.removeAttribute('src');
        entry.el.load();
        this.metadataPreloadCache.delete(assetId);
      }
    }
    this.preloadedAssetOrder = this.preloadedAssetOrder.filter((id) => currentAssetIds.has(id));

    // Determine which video assets need preloading
    const toPreload: Array<{ id: string; url: string }> = [];
    for (const asset of this.assets) {
      if (asset.type !== 'video' || !currentAssetIds.has(asset.id)) continue;
      const url = this.resolvePlaybackUrl(asset);
      if (!url) continue;

      const existing = this.metadataPreloadCache.get(asset.id);
      if (existing) {
        // URL changed (e.g., proxy became available) — update it
        if (existing.url !== url) {
          existing.el.src = url;
          existing.el.load();
          existing.url = url;
          mediaDebug('preload cache: url updated', { assetId: asset.id, url });
        }
        continue;
      }
      toPreload.push({ id: asset.id, url });
    }

    // Evict oldest entries if adding new ones would exceed limit
    const totalAfter = this.metadataPreloadCache.size + toPreload.length;
    if (totalAfter > PlaybackEngine.MAX_PRELOAD_CACHE_SIZE) {
      const evictCount = totalAfter - PlaybackEngine.MAX_PRELOAD_CACHE_SIZE;
      const toEvict = this.preloadedAssetOrder.splice(0, evictCount);
      for (const evictId of toEvict) {
        const entry = this.metadataPreloadCache.get(evictId);
        if (entry) {
          entry.el.removeAttribute('src');
          entry.el.load();
          this.metadataPreloadCache.delete(evictId);
          mediaDebug('preload cache: evicted', { assetId: evictId });
        }
      }
    }

    // Create preload elements for new assets
    for (const { id, url } of toPreload) {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.muted = true;
      el.src = url;
      el.load();
      this.metadataPreloadCache.set(id, { el, url });
      this.preloadedAssetOrder.push(id);
      mediaDebug('preload cache: started', { assetId: id, url });
    }
  }

  private clearMetadataPreloadCache(): void {
    for (const [, entry] of this.metadataPreloadCache) {
      entry.el.removeAttribute('src');
      entry.el.load();
    }
    this.metadataPreloadCache.clear();
    this.preloadedAssetOrder = [];
  }

  // --- Video Pool ---

  setVideoContainer(container: HTMLDivElement | null): void {
    if (this.videoContainer && (!container || this.videoContainer !== container)) {
      // Container cleared or changed — tear down all HTML playback elements.
      for (const [, el] of this.videoPool) {
        el.pause();
        this.clearMetadataTimeout(el);
        el.remove();
      }
      this.videoPool.clear();
    }
    this.videoContainer = container;
    if (container) {
      this.ensureAudioContainer(container.parentElement ?? document.body);
      this.updateVideoPool(true);
    } else {
      this.lastPoolAnchorTime = Number.NaN;
      this.ensureAudioContainer(document.body);
    }
  }

  private ensureAudioContainer(host: HTMLElement | null): void {
    if (!host) return;
    if (!this.audioContainer) {
      this.audioContainer = document.createElement('div');
      this.audioContainer.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
      host.appendChild(this.audioContainer);
      return;
    }
    if (this.audioContainer.parentElement !== host) {
      host.appendChild(this.audioContainer);
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioGraphUnavailable || typeof window === 'undefined') return null;
    if (this.audioContext) return this.audioContext;

    const AudioContextCtor = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      this.audioGraphUnavailable = true;
      return null;
    }

    try {
      this.audioContext = new AudioContextCtor();
      return this.audioContext;
    } catch (error) {
      this.audioGraphUnavailable = true;
      mediaDebugWarn('audio graph unavailable', { error });
      return null;
    }
  }

  private ensureMediaAudioNode(el: HTMLMediaElement): { source: MediaElementAudioSourceNode; gain: GainNode } | null {
    const existing = this.mediaAudioNodes.get(el);
    if (existing) return existing;

    const audioContext = this.ensureAudioContext();
    if (!audioContext) return null;

    try {
      const source = audioContext.createMediaElementSource(el);
      const gain = audioContext.createGain();
      source.connect(gain);
      gain.connect(audioContext.destination);
      const node = { source, gain };
      this.mediaAudioNodes.set(el, node);
      return node;
    } catch (error) {
      mediaDebugWarn('failed to create media audio node', { error });
      return null;
    }
  }

  private setMediaElementGain(el: HTMLMediaElement, gainValue: number, muted = false): void {
    const safeGain = Math.max(0, gainValue);
    const node = this.ensureMediaAudioNode(el);
    if (node) {
      el.volume = 1;
      el.muted = muted;
      node.gain.gain.value = muted ? 0 : safeGain;
      return;
    }

    el.muted = muted || safeGain === 0;
    el.volume = Math.max(0, Math.min(1, safeGain));
  }

  private disconnectMediaAudioNode(el: HTMLMediaElement): void {
    const node = this.mediaAudioNodes.get(el);
    if (!node) return;
    try {
      node.source.disconnect();
    } catch {}
    try {
      node.gain.disconnect();
    } catch {}
    this.mediaAudioNodes.delete(el);
  }

  /** Returns clip IDs that overlap [currentTime, currentTime + LOOKAHEAD_SECONDS] on video tracks. */
  private getLookaheadClips(): Set<string> {
    if (!this.timeline) return new Set();
    const start = this._currentTime;
    const end = start + PlaybackEngine.LOOKAHEAD_SECONDS;
    const ids = new Set<string>();
    for (const clip of this.timeline.clips) {
      if (!this.videoTrackIds.has(clip.trackId)) continue;
      const clipEnd = clip.startTime + clipEffectiveDuration(clip);
      // Clip overlaps the lookahead window if it starts before window end AND ends after window start
      if (clip.startTime < end && clipEnd > start) {
        ids.add(clip.id);
      }
    }
    return ids;
  }

  private updateVideoPool(force = false): void {
    if (!this.videoContainer || !this.timeline) return;
    if (
      !force
      && Number.isFinite(this.lastPoolAnchorTime)
      && Math.abs(this._currentTime - this.lastPoolAnchorTime) < PlaybackEngine.POOL_REFRESH_STEP_SECONDS
    ) {
      return;
    }
    this.lastPoolAnchorTime = this._currentTime;

    // Build set of clip IDs within the viewport window
    const lookaheadIds = this.getLookaheadClips();

    // Map clipId → playback URL/poster for clips that need video elements
    const allNeeded = new Map<string, { url: string; poster: string; assetId: string; distance: number }>();
    for (const clip of this.timeline.clips) {
      if (!this.videoTrackIds.has(clip.trackId)) continue;
      if (!lookaheadIds.has(clip.id)) continue;
      const asset = this.assetMap.get(clip.assetId);
      if (!asset) continue;
      if (this._proxyMode === 'off' && this.isLikelyUnsupportedInHtmlVideo(asset) && !asset.proxyRef) {
        this.requestCompatibilityProxy(asset, 'orig-mode-known-unsupported-codec');
      }
      const url = this.resolvePlaybackUrl(asset);
      const poster = asset.thumbnailUrl ? toFileUrl(asset.thumbnailUrl) : '';
      if ((asset.type === 'video' || asset.type === 'image') && url) {
        // Distance from playhead for priority ranking
        const clipEnd = clip.startTime + clipEffectiveDuration(clip);
        const distance = clip.startTime <= this._currentTime && clipEnd > this._currentTime
          ? 0 // Currently active — highest priority
          : Math.min(Math.abs(clip.startTime - this._currentTime), Math.abs(clipEnd - this._currentTime));
        allNeeded.set(clip.id, { url, poster, assetId: asset.id, distance });
      }
    }

    // Limit to MAX_POOL_SIZE — prioritize clips closest to playhead
    let neededClips: Map<string, { url: string; poster: string; assetId: string }>;
    if (allNeeded.size <= PlaybackEngine.MAX_POOL_SIZE) {
      neededClips = new Map([...allNeeded].map(([id, { url, poster, assetId }]) => [id, { url, poster, assetId }]));
    } else {
      const sorted = [...allNeeded.entries()].sort((a, b) => a[1].distance - b[1].distance);
      neededClips = new Map(
        sorted.slice(0, PlaybackEngine.MAX_POOL_SIZE).map(([id, { url, poster, assetId }]) => [id, { url, poster, assetId }]),
      );
    }

    // Remove stale
    for (const [clipId, el] of this.videoPool) {
      if (!neededClips.has(clipId)) {
        el.pause();
        el.removeAttribute('src');
        this.clearMetadataTimeout(el);
        this.disconnectMediaAudioNode(el);
        el.remove();
        this.videoPool.delete(clipId);
        this.playbackHealth.delete(clipId);
      }
    }

    // Add new or update src if asset changed
    for (const [clipId, source] of neededClips) {
      let video = this.videoPool.get(clipId);
      if (!video) {
        const createdVideo = document.createElement('video');
        createdVideo.preload = 'auto';
        createdVideo.muted = true;
        createdVideo.playsInline = true;
        createdVideo.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;pointer-events:none;';
        this.videoContainer.appendChild(createdVideo);
        this.videoPool.set(clipId, createdVideo);
        video = createdVideo;

        if (!createdVideo.dataset.autoProxyWatchers) {
          createdVideo.dataset.autoProxyWatchers = '1';
          const requestFromDataset = () => {
            if (this._proxyMode !== 'auto') return;
            const assetId = createdVideo.dataset.assetId;
            if (!assetId) return;
            const asset = this.assetMap.get(assetId);
            if (asset) this.requestAutoProxy(asset, 'media-element-event');
          };
          const clearTimeoutHandler = () => {
            this.clearMetadataTimeout(createdVideo);
          };
          createdVideo.addEventListener('error', (event) => {
            mediaDebugWarn('video error event', {
              assetId: createdVideo.dataset.assetId,
              currentTime: createdVideo.currentTime,
              readyState: createdVideo.readyState,
              eventType: event.type,
            });
            requestFromDataset();
          });
          createdVideo.addEventListener('stalled', (event) => {
            mediaDebugWarn('video stalled event', {
              assetId: createdVideo.dataset.assetId,
              currentTime: createdVideo.currentTime,
              readyState: createdVideo.readyState,
              eventType: event.type,
            });
            requestFromDataset();
          });
          createdVideo.addEventListener('abort', (event) => {
            mediaDebugWarn('video abort event', {
              assetId: createdVideo.dataset.assetId,
              currentTime: createdVideo.currentTime,
              readyState: createdVideo.readyState,
              eventType: event.type,
            });
            requestFromDataset();
          });
          createdVideo.addEventListener('loadedmetadata', clearTimeoutHandler);
          createdVideo.addEventListener('loadeddata', clearTimeoutHandler);
          createdVideo.addEventListener('canplay', clearTimeoutHandler);
          createdVideo.addEventListener('playing', clearTimeoutHandler);
        }
      }
      video.dataset.assetId = source.assetId;
      if (source.poster && video.poster !== source.poster) {
        video.poster = source.poster;
      } else if (!source.poster && video.poster) {
        video.removeAttribute('poster');
      }
      const currentSource = video.dataset.sourceUrl ?? '';
      if (currentSource !== source.url) {
        mediaDebug('clip source swap', {
          clipId,
          assetId: source.assetId,
          proxyMode: this._proxyMode,
          url: source.url,
        });
        video.dataset.sourceUrl = source.url;
        video.src = source.url;
        video.load();
        this.pendingSeeks.delete(video);
        this.playbackHealth.delete(clipId);
        this.armMetadataTimeout(video, source.assetId);
      }
    }
  }

  private syncVideo(): void {
    if (!this.timeline) return;
    const now = performance.now();

    // Collect all active visual clips on video tracks
    const activeVisuals = this.getActiveClips().filter(
      (e) => (e.asset.type === 'video' || e.asset.type === 'image') && this.videoTrackIds.has(e.clip.trackId),
    );
    const activeClipIds = new Set(activeVisuals.map((e) => e.clip.id));

    // Sort active visuals by track order (lower index = higher z)
    activeVisuals.sort((a, b) => {
      const ai = this.videoTrackOrder.indexOf(a.clip.trackId);
      const bi = this.videoTrackOrder.indexOf(b.clip.trackId);
      return ai - bi;
    });

    // Sync each active clip
    let z = 1;
    for (const entry of activeVisuals) {
      const el = this.videoPool.get(entry.clip.id);
      if (!el) continue;
      const isVideoAsset = entry.asset.type === 'video';

      const clipSpeed = entry.clip.speed ?? 1;
      const sourceTime =
        entry.clip.trimStart +
        (this._currentTime - entry.clip.startTime) * clipSpeed;

      // Detect first frame this clip becomes active — force-seek to sourceTime to
      // ensure the video decoder starts from a clean keyframe (prevents H.264 artifacts)
      const isNewlyActive = !this.activeClipIdsPrev.has(entry.clip.id);
      if (isNewlyActive && isVideoAsset) {
        this.clipEntryTimestamps.set(entry.clip.id, now);
        if (el.readyState >= 1) {
          el.currentTime = sourceTime;
        }
      }

      // Hold opacity to 0 for a brief window after entry to let the seek complete
      const entryTime = this.clipEntryTimestamps.get(entry.clip.id) ?? 0;
      const mssinceEntry = now - entryTime;
      const seekSettleMs = 80; // ~5 frames at 60fps
      const seekPending = isNewlyActive && isVideoAsset && mssinceEntry < seekSettleMs && el.seeking;

      // Keyframed opacity
      const clipTime = this._currentTime - entry.clip.startTime;
      let opacity = interpolateProperty(entry.clip, 'opacity', clipTime);

      // Transition effects (dissolve/fade)
      opacity = this.applyTransitionOpacity(entry.clip, opacity);

      // Suppress visibility until seek settles to avoid showing a corrupt/wrong frame
      if (seekPending) opacity = 0;

      // Flip transforms
      const scaleX = entry.clip.flipH ? -1 : 1;
      const scaleY = entry.clip.flipV ? -1 : 1;
      el.style.transform = `scale(${scaleX}, ${scaleY})`;

      el.style.opacity = String(opacity);
      el.style.zIndex = String(z++);
      if (!isVideoAsset) {
        el.pause();
        this.pendingSeeks.delete(el);
        this.playbackHealth.delete(entry.clip.id);
        continue;
      }
      const canSeek = el.readyState >= 1;
      const pendingSourceTime = this.pendingSeeks.get(el);
      const targetTime = pendingSourceTime ?? sourceTime;

      if (!canSeek) {
        this.pendingSeeks.set(el, sourceTime);
        if (!el.dataset.metadataQueued) {
          el.dataset.metadataQueued = '1';
          el.addEventListener(
            'loadedmetadata',
            () => {
              delete el.dataset.metadataQueued;
              const pending = this.pendingSeeks.get(el);
              if (pending !== undefined) {
                this.pendingSeeks.delete(el);
                el.currentTime = pending;
              }
              if (this._isPlaying && el.paused) {
                el.play().catch(() => {
                  if (this._proxyMode === 'auto') {
                    this.requestAutoProxy(entry.asset, 'play-rejected-after-metadata');
                  }
                });
              }
            },
            { once: true },
          );
        }
      }

      if (this._isPlaying) {
        el.playbackRate = this._speed * clipSpeed;
        const drift = canSeek ? Math.abs(el.currentTime - targetTime) : 0;
        if (canSeek && drift > PlaybackEngine.DRIFT_CORRECTION_SECONDS) {
          const lastCorrection = this.driftCorrectionTimestamps.get(el) ?? 0;
          if (now - lastCorrection >= PlaybackEngine.DRIFT_CORRECTION_COOLDOWN_MS) {
            el.currentTime = targetTime;
            this.driftCorrectionTimestamps.set(el, now);
          }
        }
        if (this._proxyMode === 'auto' && isVideoAsset && canSeek && !el.seeking) {
          const health = this.playbackHealth.get(entry.clip.id) ?? { lastVideoTime: -1, lagFrames: 0, stagnantFrames: 0 };
          const advanced = health.lastVideoTime < 0 || el.currentTime > health.lastVideoTime + 0.01;
          const stagnant = !el.paused && !el.ended && !advanced;
          health.lastVideoTime = el.currentTime;
          health.stagnantFrames = stagnant ? (health.stagnantFrames + 1) : 0;
          health.lagFrames = drift > PlaybackEngine.AUTO_PROXY_DRIFT_SECONDS ? (health.lagFrames + 1) : Math.max(0, health.lagFrames - 1);
          this.playbackHealth.set(entry.clip.id, health);

          if (
            health.stagnantFrames >= PlaybackEngine.AUTO_PROXY_STAGNANT_FRAMES_THRESHOLD
            || health.lagFrames >= PlaybackEngine.AUTO_PROXY_LAG_FRAMES_THRESHOLD
          ) {
            health.stagnantFrames = 0;
            health.lagFrames = 0;
            this.requestAutoProxy(entry.asset, 'decode-lag-or-stagnant');
          }
        }
        if (el.paused) {
          el.play().catch(() => {
            if (this._proxyMode === 'auto') {
              this.requestAutoProxy(entry.asset, 'play-rejected');
            }
          });
        }
      } else {
        el.pause();
        this.playbackHealth.delete(entry.clip.id);
        if (!canSeek) {
          // Keep poster visible until metadata is loaded.
          continue;
        }
        if (el.seeking) {
          this.pendingSeeks.set(el, targetTime);
          if (!el.dataset.seekQueued) {
            el.dataset.seekQueued = '1';
            el.addEventListener('seeked', () => {
              delete el.dataset.seekQueued;
              const pending = this.pendingSeeks.get(el);
              if (pending !== undefined) {
                this.pendingSeeks.delete(el);
                el.currentTime = pending;
              }
            }, { once: true });
          }
        } else {
          el.currentTime = targetTime;
          this.pendingSeeks.delete(el);
        }
      }
    }

    // Hide inactive clips; pre-seek clips that are about to start so they're frame-ready at the cut point
    const PRE_SEEK_WINDOW = 0.5; // seconds before clip start to pre-position the video element
    for (const [clipId, el] of this.videoPool) {
      if (activeClipIds.has(clipId)) continue;
      el.style.opacity = '0';
      el.style.zIndex = '0';
      el.style.transform = '';
      if (!el.paused) el.pause();
      this.playbackHealth.delete(clipId);

      // Pre-seek to trimStart for clips starting soon, so no stale frame shows at the cut
      if (this._isPlaying && this.timeline) {
        const clip = this.timeline.clips.find((c) => c.id === clipId);
        if (clip && el.readyState >= 1) {
          const timeUntilStart = clip.startTime - this._currentTime;
          if (timeUntilStart > 0 && timeUntilStart <= PRE_SEEK_WINDOW) {
            const targetSourceTime = clip.trimStart;
            if (Math.abs(el.currentTime - targetSourceTime) > 0.04) {
              el.currentTime = targetSourceTime;
            }
          }
        }
      }
    }

    // Update prev active set for next frame's newly-active detection
    this.activeClipIdsPrev = activeClipIds;
    // Clean up entry timestamps for clips no longer in the pool
    for (const clipId of this.clipEntryTimestamps.keys()) {
      if (!this.videoPool.has(clipId)) this.clipEntryTimestamps.delete(clipId);
    }
  }

  /** Find the video pool element for a given clip. */
  private findVideoElementForClip(clip: Clip): HTMLVideoElement | null {
    return this.videoPool.get(clip.id) ?? null;
  }

  /**
   * Apply transition opacity adjustments for dissolve/fade transitions.
   * Returns the modified opacity value for the clip.
   */
  private applyTransitionOpacity(clip: Clip, baseOpacity: number): number {
    if (!this.timeline) return baseOpacity;

    let opacity = baseOpacity;

    for (const transition of (this.timeline.transitions ?? [])) {
      if (transition.type === 'dissolve' && transition.clipBId) {
        const clipA = this.timeline.clips.find((c) => c.id === transition.clipAId);
        const clipB = this.timeline.clips.find((c) => c.id === transition.clipBId);
        if (!clipA || !clipB) continue;

        // Overlap region: [clipB.startTime, clipEndTime(clipA)]
        const overlapStart = clipB.startTime;
        const overlapEnd = clipEndTime(clipA);
        if (this._currentTime < overlapStart || this._currentTime >= overlapEnd) continue;

        const progress = (this._currentTime - overlapStart) / (overlapEnd - overlapStart);

        if (clip.id === transition.clipAId) {
          // Clip A fades out
          opacity *= (1 - progress);
        } else if (clip.id === transition.clipBId) {
          // Clip B fades in
          opacity *= progress;
        }
      } else if (transition.type === 'fadeFromBlack' && clip.id === transition.clipAId) {
        // Fade from black at clip start
        const fadeEnd = clip.startTime + transition.duration;
        if (this._currentTime >= clip.startTime && this._currentTime < fadeEnd) {
          const progress = (this._currentTime - clip.startTime) / transition.duration;
          opacity *= progress;
        }
      } else if (transition.type === 'fadeToBlack' && clip.id === transition.clipAId) {
        // Fade to black at clip end
        const clipEnd = clipEndTime(clip);
        const fadeStart = clipEnd - transition.duration;
        if (this._currentTime >= fadeStart && this._currentTime < clipEnd) {
          const progress = (this._currentTime - fadeStart) / transition.duration;
          opacity *= (1 - progress);
        }
      }
    }

    return opacity;
  }

  private pauseAllVideo(): void {
    for (const el of this.videoPool.values()) {
      if (!el.paused) el.pause();
    }
  }

  // --- Web Audio API ---

  private getTrackVolume(track: Track): number {
    return 'volume' in track
      ? ((track as unknown as Record<string, unknown>).volume as number)
      : 1;
  }

  private updateAudioGraph(): void {
    if (!this.timeline) return;
    // Cache track volumes and mute state for use in syncAudio
    for (const track of this.timeline.tracks) {
      if (track.kind !== 'audio') continue;
      const isMuted = this.mutedTrackIds.has(track.id);
      this.trackVolumes.set(track.id, isMuted ? 0 : this.getTrackVolume(track));
    }
  }

  // Track which video elements are being used for audio routing (unmuted)
  private videoElsUsedForAudio = new Set<string>();

  private findLinkedVideoPoolEntry(clip: Clip): { clipId: string; clip: Clip; el: HTMLVideoElement } | null {
    if (!this.timeline) return null;
    for (const linkedId of clip.linkedClipIds ?? []) {
      const linkedClip = this.timeline.clips.find((candidate) => candidate.id === linkedId);
      if (!linkedClip || !this.videoTrackIds.has(linkedClip.trackId)) continue;
      const el = this.videoPool.get(linkedId);
      if (!el) continue;
      return { clipId: linkedId, clip: linkedClip, el };
    }
    return null;
  }

  private syncAudio(): void {
    if (!this.timeline) return;

    // Audio clips: standalone audio assets OR video assets on audio tracks (linked audio)
    const activeAudio = this.getActiveClips().filter(
      (e) => e.asset.type === 'audio' || this.audioTrackIds.has(e.clip.trackId),
    );
    const activeIds = new Set(activeAudio.map((e) => e.clip.id));

    const newVideoElsUsedForAudio = new Set<string>();

    // Start/sync active audio
    for (const entry of activeAudio) {
      const clipSpeed = entry.clip.speed ?? 1;
      const sourceTime =
        entry.clip.trimStart + (this._currentTime - entry.clip.startTime) * clipSpeed;

      // Apply volume: track volume * keyframed clip volume
      const clipTime = this._currentTime - entry.clip.startTime;
      const kfVolume = interpolateProperty(entry.clip, 'volume', clipTime);
      const trackVol = this.trackVolumes.get(entry.clip.trackId) ?? 1;
      const vol = Math.max(0, kfVolume * trackVol);

      // Route linked scratch audio through the exact paired visual clip when
      // that HTML video element is active and shares timing with the audio clip.
      const poolEntry = entry.asset.type === 'video'
        ? this.findLinkedVideoPoolEntry(entry.clip)
        : null;
      const videoEl = poolEntry?.el ?? null;
      const timingMatches = poolEntry && videoEl
        && Math.abs(poolEntry.clip.startTime - entry.clip.startTime) < 0.01
        && Math.abs(poolEntry.clip.trimStart - entry.clip.trimStart) < 0.01
        && Math.abs((poolEntry.clip.speed ?? 1) - clipSpeed) < 0.01;

      if (videoEl && entry.asset.type === 'video' && timingMatches) {
        // Use the video element for audio — unmute it and set volume
        this.setMediaElementGain(videoEl, vol, vol === 0);
        newVideoElsUsedForAudio.add(poolEntry.clipId);

        // Clean up any stale <audio> element for this clip
        const staleAudio = this.audioEls.get(entry.clip.id);
        if (staleAudio) {
          staleAudio.pause();
          this.disconnectMediaAudioNode(staleAudio);
          staleAudio.remove();
          this.audioEls.delete(entry.clip.id);
        }
        continue;
      }

      // For pure audio assets or video assets without a matching video element:
      // use a separate <audio> element
      let el = this.audioEls.get(entry.clip.id);
      if (!el) {
        el = new Audio(this.resolvePlaybackUrl(entry.asset));
        el.preload = 'auto';
        this.audioContainer?.appendChild(el);
        this.audioEls.set(entry.clip.id, el);
      }
      if (this.audioContainer && el.parentElement !== this.audioContainer) {
        this.audioContainer.appendChild(el);
      }

      this.setMediaElementGain(el, vol);
      const ready = el.readyState >= 2;
      const driftThreshold = entry.asset.type === 'video'
        ? PlaybackEngine.VIDEO_AUDIO_DRIFT_CORRECTION_SECONDS
        : PlaybackEngine.AUDIO_DRIFT_CORRECTION_SECONDS;

      if (this._isPlaying) {
        el.playbackRate = this._speed * clipSpeed;
        if (ready && (el.paused || Math.abs(el.currentTime - sourceTime) > driftThreshold)) {
          el.currentTime = sourceTime;
        }
        if (ready && el.paused) el.play().catch(() => {});
      } else {
        el.pause();
        if (ready) el.currentTime = sourceTime;
      }
    }

    // Re-mute video elements that are no longer used for audio
    for (const clipId of this.videoElsUsedForAudio) {
      if (!newVideoElsUsedForAudio.has(clipId)) {
        const videoEl = this.videoPool.get(clipId);
        if (videoEl) {
          this.setMediaElementGain(videoEl, 0, true);
        }
      }
    }
    this.videoElsUsedForAudio = newVideoElsUsedForAudio;

    // Pause inactive audio elements
    for (const [id, el] of this.audioEls) {
      if (!activeIds.has(id)) {
        el.pause();
      }
    }
  }

  private pauseAllAudio(): void {
    for (const el of this.audioEls.values()) {
      el.pause();
    }
    // Re-mute any video elements that were being used for audio
    for (const clipId of this.videoElsUsedForAudio) {
      const videoEl = this.videoPool.get(clipId);
      if (videoEl) {
        this.setMediaElementGain(videoEl, 0, true);
      }
    }
    this.videoElsUsedForAudio.clear();
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
      if (
        this._currentTime >= clip.startTime &&
        this._currentTime < clipEndTime(clip)
      ) {
        const asset = this.assetMap.get(clip.assetId);
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

    const maxPlayback = duration + Math.max(30, duration * 0.5);
    if (nextTime >= maxPlayback) {
      if (this._loop) {
        nextTime = 0;
      } else {
        nextTime = maxPlayback;
        this.pause();
        this._currentTime = nextTime;
        this.callbacks.onTimeUpdate(nextTime);
        this.updateActiveClips();
        return;
      }
    }

    this._currentTime = nextTime;
    this.updateVideoPool();

    // Video sync every frame for smooth visuals
    this.syncVideo();

    // Throttle React state updates to ~30fps
    if (now - this.lastUIUpdate >= 33) {
      this.lastUIUpdate = now;
      this.callbacks.onTimeUpdate(nextTime);
      this.updateActiveClips();
    }

    // Keep audio tighter to the master timeline clock to reduce drift against native video.
    if (now - this.lastAudioSync >= 33) {
      this.lastAudioSync = now;
      this.syncAudio();
    }

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
      this.clearMetadataTimeout(el);
      this.disconnectMediaAudioNode(el);
      el.remove();
    }
    this.videoPool.clear();

    // Clean audio
    for (const el of this.audioEls.values()) {
      el.pause();
      el.src = '';
      this.disconnectMediaAudioNode(el);
    }
    this.audioEls.clear();
    this.trackVolumes.clear();
    this.autoProxyAssetIds.clear();
    this.autoProxyPendingAssetIds.clear();
    this.proxyRequestTimestamps.clear();
    this.playbackHealth.clear();
    this.videoElsUsedForAudio.clear();
    this.audioContainer?.remove();
    this.audioContainer = null;
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.mediaAudioNodes.clear();

    this.clearMetadataPreloadCache();
  }
}
