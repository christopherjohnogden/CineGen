import React, { useState, useEffect, useCallback } from 'react';
import type { Clip, Timeline } from '@/types/timeline';
import type { Asset } from '@/types/project';

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
      const result = await (window as any).electronAPI.sync.computeOffset({
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
      <div className="sync-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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
            onClick={() => onSync(initialAudioClipId, effectiveAudioAssetId ?? null, finalOffset, scratchMode)}
          >
            Sync
          </button>
        </div>
      </div>
    </div>
  );
}
