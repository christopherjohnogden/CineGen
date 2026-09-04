import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type NodeProps, useReactFlow, useStore } from '@xyflow/react';
import { BaseNode } from './base-node';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { TrimStrip } from './trim-strip';
import {
  clampRange,
  formatTimecode,
  isTrimStale,
  isWholeSource,
  localPathFor,
  parseTimecode,
  trimmedDuration,
} from '@/lib/studio/trim';
import { toFileUrl } from '@/lib/utils/file-url';
import type { WorkflowNodeData } from '@/types/workflow';

type TrimNodeProps = NodeProps & { data: WorkflowNodeData };

/**
 * Trim takes a video in and hands a shortened one out. The range is free to
 * scrub; rendering only happens on Apply, because re-encoding a long source
 * costs seconds and dragging a handle should never pay that.
 */
function TrimNodeInner({ id, data, selected }: TrimNodeProps) {
  const { updateNodeData } = useReactFlow();
  const { projectId } = useWorkspace();
  const videoRef = useRef<HTMLVideoElement>(null);

  const config = data.config ?? {};
  const trimmedUrl = (config.trimmedUrl as string) ?? '';
  const renderedStart = (config.renderedStartSec as number) ?? 0;
  const renderedEnd = (config.renderedEndSec as number) ?? 0;

  // The source is whatever is wired into the input; a node with nothing
  // connected falls back to the last source it saw so it does not go blank.
  const incoming = useStore((store) => {
    const edge = store.edges.find((candidate) => candidate.target === id && candidate.targetHandle === 'video');
    if (!edge) return '';
    const source = store.nodeLookup.get(edge.source);
    if (!source) return '';
    const sourceConfig = (source.data as WorkflowNodeData | undefined)?.config ?? {};
    const fromResult = (source.data as WorkflowNodeData | undefined)?.result?.url;
    return (sourceConfig.fileUrl as string) || (sourceConfig.trimmedUrl as string) || fromResult || '';
  });
  const sourceUrl = incoming || ((config.sourceUrl as string) ?? '');

  const [duration, setDuration] = useState((config.durationSec as number) ?? 0);
  const [range, setRange] = useState({
    startSec: (config.startSec as number) ?? 0,
    endSec: (config.endSec as number) ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [startText, setStartText] = useState(() => formatTimecode(range.startSec));
  const [endText, setEndText] = useState(() => formatTimecode(range.endSec));

  // Remember the source so a reload still shows a player before the graph runs.
  useEffect(() => {
    if (sourceUrl && sourceUrl !== config.sourceUrl) {
      updateNodeData(id, { config: { ...config, sourceUrl } });
    }
  }, [sourceUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitRange = useCallback((next: { startSec: number; endSec: number }, moved: 'start' | 'end') => {
    const clamped = clampRange(next, duration, moved);
    setRange(clamped);
    setStartText(formatTimecode(clamped.startSec));
    setEndText(formatTimecode(clamped.endSec));
    updateNodeData(id, { config: { ...config, startSec: clamped.startSec, endSec: clamped.endSec } });
  }, [config, duration, id, updateNodeData]);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    setDuration(video.duration);
    // A node opened for the first time selects the whole clip.
    const end = range.endSec > 0 ? Math.min(range.endSec, video.duration) : video.duration;
    const next = clampRange({ startSec: range.startSec, endSec: end }, video.duration);
    setRange(next);
    setStartText(formatTimecode(next.startSec));
    setEndText(formatTimecode(next.endSec));
    updateNodeData(id, {
      config: { ...config, durationSec: video.duration, startSec: next.startSec, endSec: next.endSec },
    });
  }, [config, id, range.endSec, range.startSec, updateNodeData]);

  // Keep playback inside the selected range so the player previews the trim.
  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || range.endSec <= range.startSec) return;
    if (video.currentTime > range.endSec || video.currentTime < range.startSec - 0.25) {
      video.currentTime = range.startSec;
      if (video.currentTime >= range.endSec) video.pause();
    }
  }, [range.endSec, range.startSec]);

  const rendered = trimmedUrl ? { startSec: renderedStart, endSec: renderedEnd, url: trimmedUrl } : null;
  const stale = isTrimStale(range, rendered);
  const whole = isWholeSource(range, duration);

  const applyTrim = useCallback(async () => {
    const inputPath = localPathFor(sourceUrl);
    if (!inputPath) {
      setError('Trimming needs the video on disk. Import it into the project first.');
      return;
    }
    if (!window.electronAPI?.media?.trimVideo) {
      setError('Trimming is only available in the desktop app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.media.trimVideo({
        inputPath,
        startSec: range.startSec,
        endSec: range.endSec,
        projectId,
      });
      if (!result?.outputPath) {
        setError('Could not render the trim.');
        return;
      }
      updateNodeData(id, {
        config: {
          ...config,
          trimmedUrl: toFileUrl(result.outputPath),
          renderedStartSec: range.startSec,
          renderedEndSec: range.endSec,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not render the trim.');
    } finally {
      setBusy(false);
    }
  }, [config, id, projectId, range.endSec, range.startSec, sourceUrl, updateNodeData]);

  const meta = useMemo(() => {
    if (!duration) return 'No video';
    return `${formatTimecode(trimmedDuration(range))} of ${formatTimecode(duration)}`;
  }, [duration, range]);

  return (
    <BaseNode
      nodeType="trim"
      selected={!!selected}
      isRunning={busy}
      meta={meta}
      footer={
        <>
          <span>{whole ? 'Whole clip' : stale ? 'Not applied' : 'Trimmed'}</span>
          <span>{error ? '' : formatTimecode(range.startSec)} → {error ? '' : formatTimecode(range.endSec)}</span>
        </>
      }
    >
      {!sourceUrl ? (
        <div className="trim-node__empty">Connect a video to trim.</div>
      ) : (
        <div className="trim-node nodrag">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            key={sourceUrl}
            src={sourceUrl}
            className="trim-node__video nowheel"
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
          />

          <TrimStrip
            sourceUrl={sourceUrl}
            duration={duration}
            range={range}
            onChange={commitRange}
            onScrub={(seconds) => {
              const video = videoRef.current;
              if (video) video.currentTime = seconds;
            }}
          />

          <div className="trim-node__fields">
            <label>
              <span>Start</span>
              <input
                value={startText}
                onChange={(event) => setStartText(event.target.value)}
                onBlur={() => {
                  const parsed = parseTimecode(startText);
                  if (parsed === null) setStartText(formatTimecode(range.startSec));
                  else commitRange({ ...range, startSec: parsed }, 'start');
                }}
                aria-label="Trim start"
              />
            </label>
            <label>
              <span>End</span>
              <input
                value={endText}
                onChange={(event) => setEndText(event.target.value)}
                onBlur={() => {
                  const parsed = parseTimecode(endText);
                  if (parsed === null) setEndText(formatTimecode(range.endSec));
                  else commitRange({ ...range, endSec: parsed }, 'end');
                }}
                aria-label="Trim end"
              />
            </label>
          </div>

          {error && <p className="trim-node__error">{error}</p>}

          <button
            type="button"
            className="trim-node__apply"
            data-testid="trim-node-apply"
            disabled={busy || !stale}
            onClick={() => void applyTrim()}
          >
            {busy ? 'Trimming…' : stale ? 'Apply trim' : 'Trim applied'}
          </button>
        </div>
      )}
    </BaseNode>
  );
}

export const TrimNode = memo(TrimNodeInner);
