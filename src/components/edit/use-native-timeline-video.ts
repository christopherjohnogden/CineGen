import { useEffect } from 'react';
import type { Timeline } from '@/types/timeline';
import type { Asset } from '@/types/project';
import type { ActiveClipEntry, PlaybackProxyMode } from '@/lib/editor/playback-engine';
import { buildNativeVisualPlaybackDescriptors } from '@/lib/editor/visual-playback-state';

interface UseNativeTimelineVideoOptions {
  enabled: boolean;
  surfaceId: string;
  timeline: Timeline;
  assets: Asset[];
  activeClips: ActiveClipEntry[];
  currentTime: number;
  isPlaying: boolean;
  proxyMode: PlaybackProxyMode;
  surfaceVersion?: number;
}

export function useNativeTimelineVideo({
  enabled,
  surfaceId,
  timeline,
  assets,
  activeClips,
  currentTime,
  isPlaying,
  proxyMode,
  surfaceVersion = 0,
}: UseNativeTimelineVideoOptions) {
  useEffect(() => {
    if (!enabled) return undefined;
    const descriptors = buildNativeVisualPlaybackDescriptors(
      timeline,
      assets,
      activeClips,
      currentTime,
      isPlaying,
      proxyMode,
    );
    const hasActiveVisual = activeClips.some(
      (entry) => entry.asset.type === 'video' || entry.asset.type === 'image',
    );
    if (descriptors.length === 0) {
      window.electronAPI.nativeVideo.setSurfaceHidden({
        surfaceId,
        hidden: true,
      });
      return undefined;
    }
    window.electronAPI.nativeVideo.setSurfaceHidden({
      surfaceId,
      hidden: !hasActiveVisual,
    });
    window.electronAPI.nativeVideo.syncSurface({ surfaceId, descriptors });
    return undefined;
  }, [enabled, surfaceId, timeline, assets, activeClips, currentTime, isPlaying, proxyMode, surfaceVersion]);
}
