import { useRef, useCallback, useState, useEffect } from 'react';
import { PlaybackEngine, type ActiveClipEntry, type PlaybackProxyMode } from '@/lib/editor/playback-engine';
import type { Timeline } from '@/types/timeline';
import type { Asset } from '@/types/project';

interface UsePlaybackEngineOptions {
  initialProxyMode?: PlaybackProxyMode;
  onProxyFallbackRequest?: (assetIds: string[]) => void;
}

export function usePlaybackEngine(timeline: Timeline, assets: Asset[], options: UsePlaybackEngineOptions = {}) {
  const onProxyFallbackRequestRef = useRef<((assetIds: string[]) => void) | undefined>(options.onProxyFallbackRequest);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeClips, setActiveClips] = useState<ActiveClipEntry[]>([]);
  const [proxyMode, setProxyModeState] = useState<PlaybackProxyMode>(options.initialProxyMode ?? 'off');

  useEffect(() => {
    onProxyFallbackRequestRef.current = options.onProxyFallbackRequest;
  }, [options.onProxyFallbackRequest]);

  if (!engineRef.current) {
    engineRef.current = new PlaybackEngine({
      onTimeUpdate: setCurrentTime,
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onActiveClipsChange: setActiveClips,
      onProxyFallbackRequest: (assetIds) => onProxyFallbackRequestRef.current?.(assetIds),
    });
    engineRef.current.setProxyMode(options.initialProxyMode ?? 'off');
  }

  const engine = engineRef.current;

  useEffect(() => { engine.setTimeline(timeline); }, [engine, timeline]);
  useEffect(() => { engine.setAssets(assets); }, [engine, assets]);
  useEffect(() => { return () => { engine.destroy(); }; }, [engine]);

  const play = useCallback(() => engine.play(), [engine]);
  const pause = useCallback(() => engine.pause(), [engine]);
  const togglePlayPause = useCallback(() => {
    if (engine.isPlaying) engine.pause();
    else {
      const duration = timeline.duration || 0;
      const maxPlayback = duration + Math.max(10, duration * 0.5);
      if (engine.currentTime >= maxPlayback) engine.seek(0);
      engine.play();
    }
  }, [engine, timeline.duration]);
  const seek = useCallback((time: number) => engine.seek(time), [engine]);
  const handleSystemWake = useCallback(() => engine.handleSystemWake(), [engine]);
  const setSpeed = useCallback((rate: number) => engine.setSpeed(rate), [engine]);
  const toggleLoop = useCallback(() => engine.toggleLoop(), [engine]);
  const setProxyMode = useCallback((mode: PlaybackProxyMode) => {
    setProxyModeState(mode);
    engine.setProxyMode(mode);
  }, [engine]);
  const setMetadataPreloadEnabled = useCallback((enabled: boolean) => {
    engine.setMetadataPreloadEnabled(enabled);
  }, [engine]);
  const setVideoContainer = useCallback(
    (el: HTMLDivElement | null) => engine.setVideoContainer(el),
    [engine],
  );

  return {
    currentTime, isPlaying, activeClips, proxyMode,
    play, pause, togglePlayPause, seek, setSpeed, toggleLoop,
    setVideoContainer, setProxyMode, setMetadataPreloadEnabled, handleSystemWake, engine,
  };
}
