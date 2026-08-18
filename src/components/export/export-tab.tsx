

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWorkspace, getActiveTimeline } from '@/components/workspace/workspace-shell';
import { ExportSettings } from './export-settings';
import { RenderProgress } from './render-progress';
import type { ExportPreset, ExportJob } from '@/types/export';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';

export function ExportTab() {
  const { state, dispatch } = useWorkspace();
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const activeTimeline = getActiveTimeline(state);
  const exportClips = useMemo(() => {
    const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
    return activeTimeline.clips.flatMap((clip) => {
      const asset = assetsById.get(clip.assetId);
      const inputPath = asset?.fileRef || asset?.url;
      const duration = clipEffectiveDuration(clip);
      if (!asset || !inputPath || duration <= 0) return [];
      return [{
        inputPath,
        startTime: clip.startTime,
        duration,
        trimStart: clip.trimStart,
        speed: clip.speed || 1,
        volume: clip.volume ?? 1,
        type: asset.type,
      }];
    });
  }, [activeTimeline.clips, state.assets]);
  const hasClips = exportClips.length > 0;
  const totalDuration = Math.max(
    activeTimeline.duration,
    ...activeTimeline.clips.map(clipEndTime),
  );
  const activeJob = state.exports.find(
    (e) => e.status === 'queued' || e.status === 'rendering'
  );
  const latestJob = state.exports[state.exports.length - 1];

  const handleRender = useCallback(async (preset: ExportPreset, fps: 24 | 30 | 60) => {
    try {
      const job = await window.electronAPI.export.start({
        preset,
        fps,
        clips: exportClips,
        totalDuration,
      });
      dispatch({ type: 'ADD_EXPORT', exportJob: job });
    } catch (error) {
      console.error('Failed to start render:', error);
    }
  }, [dispatch, exportClips, totalDuration]);

  useEffect(() => {
    if (!activeJob) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const updated = await window.electronAPI.export.poll(activeJob.id);
        dispatch({
          type: 'UPDATE_EXPORT',
          exportId: activeJob.id,
          updates: {
            status: updated.status,
            progress: updated.progress,
            outputUrl: updated.outputUrl,
            fileSize: updated.fileSize,
            error: updated.error,
            completedAt: updated.completedAt,
          },
        });
      } catch {
        /* polling failures are non-fatal */
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeJob?.id, dispatch]);

  return (
    <div className="export-tab">
      <div className="export-tab__panel">
        <h2 className="export-tab__title">Export</h2>
        <p className="export-tab__subtitle">
          Render your timeline as an MP4 video
        </p>

        <ExportSettings hasClips={hasClips} onRender={handleRender} />

        {latestJob && (
          <div className="export-tab__progress">
            <RenderProgress job={latestJob} />
          </div>
        )}

        {!hasClips && (
          <p className="export-tab__hint">
            Add clips to the timeline in the Edit tab before exporting.
          </p>
        )}
      </div>
    </div>
  );
}
