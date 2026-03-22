import type { Asset } from '@/types/project';
import type { Timeline, Clip } from '@/types/timeline';
import { clipEndTime } from '@/types/timeline';
import type { ActiveClipEntry, PlaybackProxyMode } from '@/lib/editor/playback-engine';
import { interpolateProperty } from '@/lib/editor/timeline-operations';

export interface NativeVisualDescriptor {
  id: string;
  kind: 'video' | 'image';
  source: string;
  currentTime: number;
  rate: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  playing: boolean;
  muted: boolean;
  flipH: boolean;
  flipV: boolean;
}

const MAX_NATIVE_PREWARM_CLIPS = 4;

export function isHtmlOnlyAsset(asset: Asset | null | undefined): boolean {
  return Boolean(asset?.metadata?.forceHtmlPlayback);
}

function applyTransitionOpacity(timeline: Timeline, clip: Clip, currentTime: number, baseOpacity: number): number {
  let opacity = baseOpacity;

  for (const transition of (timeline.transitions ?? [])) {
    if (transition.type === 'dissolve' && transition.clipBId) {
      const clipA = timeline.clips.find((c) => c.id === transition.clipAId);
      const clipB = timeline.clips.find((c) => c.id === transition.clipBId);
      if (!clipA || !clipB) continue;

      const overlapStart = clipB.startTime;
      const overlapEnd = clipEndTime(clipA);
      if (currentTime < overlapStart || currentTime >= overlapEnd) continue;

      const progress = (currentTime - overlapStart) / (overlapEnd - overlapStart);
      if (clip.id === transition.clipAId) opacity *= (1 - progress);
      else if (clip.id === transition.clipBId) opacity *= progress;
      continue;
    }

    if (transition.type === 'fadeFromBlack' && clip.id === transition.clipAId) {
      const fadeEnd = clip.startTime + transition.duration;
      if (currentTime >= clip.startTime && currentTime < fadeEnd) {
        const progress = (currentTime - clip.startTime) / transition.duration;
        opacity *= progress;
      }
      continue;
    }

    if (transition.type === 'fadeToBlack' && clip.id === transition.clipAId) {
      const clipEnd = clipEndTime(clip);
      const fadeStart = clipEnd - transition.duration;
      if (currentTime >= fadeStart && currentTime < clipEnd) {
        const progress = (currentTime - fadeStart) / transition.duration;
        opacity *= (1 - progress);
      }
    }
  }

  return opacity;
}

export function resolveNativePlaybackSource(asset: Asset, proxyMode: PlaybackProxyMode): string {
  if (proxyMode === 'on' && asset.proxyRef) return asset.proxyRef;
  if (asset.fileRef) return asset.fileRef;
  if (asset.url) return asset.url;
  return asset.proxyRef ?? '';
}

export function buildNativeVisualPlaybackDescriptors(
  timeline: Timeline,
  assets: Asset[],
  activeClips: ActiveClipEntry[],
  currentTime: number,
  isPlaying: boolean,
  proxyMode: PlaybackProxyMode,
): NativeVisualDescriptor[] {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset] as const));
  const videoTrackOrder = timeline.tracks.filter((track) => track.kind === 'video').map((track) => track.id);

  const activeVisuals = activeClips.filter((entry) =>
    (entry.asset.type === 'video' || entry.asset.type === 'image') && !isHtmlOnlyAsset(entry.asset),
  );

  activeVisuals.sort((a, b) => {
    const ai = videoTrackOrder.indexOf(a.clip.trackId);
    const bi = videoTrackOrder.indexOf(b.clip.trackId);
    return ai - bi;
  });

  const seenActiveSources = new Set<string>();
  const activeDescriptors = activeVisuals.flatMap((entry, index) => {
    const clipTime = currentTime - entry.clip.startTime;
    const baseOpacity = interpolateProperty(entry.clip, 'opacity', clipTime);
    const opacity = applyTransitionOpacity(timeline, entry.clip, currentTime, baseOpacity);
    const source = resolveNativePlaybackSource(entry.asset, proxyMode);
    if (!source) return [];
    // Only show the frontmost clip for each source file — skip duplicates on
    // lower tracks (same source already visible on a higher-priority track).
    if (seenActiveSources.has(source)) return [];
    seenActiveSources.add(source);

    return [{
      id: entry.clip.id,
      kind: entry.asset.type === 'image' ? 'image' : 'video',
      source,
      currentTime: entry.asset.type === 'video'
        ? Math.max(0, entry.clip.trimStart + clipTime * (entry.clip.speed ?? 1))
        : 0,
      rate: Math.max(0.01, entry.clip.speed ?? 1),
      opacity,
      zIndex: index + 1,
      visible: opacity > 0.001,
      playing: isPlaying && entry.asset.type === 'video',
      muted: true,
      flipH: entry.clip.flipH,
      flipV: entry.clip.flipV,
    } satisfies NativeVisualDescriptor];
  });

  const activeClipIds = new Set(activeVisuals.map((entry) => entry.clip.id));
  const prewarmDescriptors: NativeVisualDescriptor[] = [];
  const seenSources = new Set(activeDescriptors.map((descriptor) => descriptor.source));

  const prewarmCandidates = timeline.clips
    .filter((clip) => videoTrackOrder.includes(clip.trackId) && !activeClipIds.has(clip.id))
    .map((clip) => {
      const asset = assetMap.get(clip.assetId);
      if (!asset || (asset.type !== 'video' && asset.type !== 'image') || isHtmlOnlyAsset(asset)) return null;
      const source = resolveNativePlaybackSource(asset, proxyMode);
      if (!source || seenSources.has(source)) return null;
      const clipStart = clip.startTime;
      const clipEnd = clipEndTime(clip);
      const distance = currentTime < clipStart
        ? clipStart - currentTime
        : currentTime > clipEnd
          ? currentTime - clipEnd
          : 0;
      return { clip, asset, source, distance };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
    .sort((a, b) => a.distance - b.distance);

  for (const candidate of prewarmCandidates) {
    if (prewarmDescriptors.length >= MAX_NATIVE_PREWARM_CLIPS) break;
    seenSources.add(candidate.source);
    prewarmDescriptors.push({
      id: candidate.clip.id,
      kind: candidate.asset.type === 'image' ? 'image' : 'video',
      source: candidate.source,
      currentTime: candidate.asset.type === 'video' ? Math.max(0, candidate.clip.trimStart) : 0,
      rate: 1,
      opacity: 0,
      zIndex: -(prewarmDescriptors.length + 1),
      visible: false,
      playing: false,
      muted: true,
      flipH: candidate.clip.flipH,
      flipV: candidate.clip.flipV,
    });
  }

  return [...activeDescriptors, ...prewarmDescriptors];
}
