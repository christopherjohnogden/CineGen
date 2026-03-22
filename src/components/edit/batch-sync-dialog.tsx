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
    const cleanup = (window as any).electronAPI.sync.onBatchProgress((data: BatchProgress) => {
      setProgress(data);
    });

    try {
      const result = await (window as any).electronAPI.sync.batchMatch({
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
    if (open && !matching && videoAssets.length > 0 && audioAssets.length > 0) {
      runBatchMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on open, not on matching state changes
  }, [open]);

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
      <div className="batch-sync-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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
