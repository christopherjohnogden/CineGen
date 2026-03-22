import { useCallback } from 'react';
import type { Clip } from '@/types/timeline';
import type { Asset } from '@/types/project';
import { clipEffectiveDuration } from '@/types/timeline';

interface ClipPropertiesPanelProps {
  clip: Clip | null;
  asset: Asset | null;
  onUpdateClip: (clipId: string, updates: Partial<Pick<Clip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>) => void;
  onAddKeyframe: (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => void;
  onRemoveKeyframe: (clipId: string, index: number) => void;
  onClose: () => void;
}

export function ClipPropertiesPanel({
  clip,
  asset,
  onUpdateClip,
  onAddKeyframe,
  onRemoveKeyframe,
  onClose,
}: ClipPropertiesPanelProps) {
  const isAudio = asset?.type === 'audio';

  const handleSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!clip) return;
      onUpdateClip(clip.id, { speed: parseFloat(e.target.value) });
    },
    [clip, onUpdateClip],
  );

  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!clip) return;
      onUpdateClip(clip.id, { opacity: parseFloat(e.target.value) });
    },
    [clip, onUpdateClip],
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!clip) return;
      onUpdateClip(clip.id, { volume: parseFloat(e.target.value) });
    },
    [clip, onUpdateClip],
  );

  const handleFlipH = useCallback(() => {
    if (!clip) return;
    onUpdateClip(clip.id, { flipH: !clip.flipH });
  }, [clip, onUpdateClip]);

  const handleFlipV = useCallback(() => {
    if (!clip) return;
    onUpdateClip(clip.id, { flipV: !clip.flipV });
  }, [clip, onUpdateClip]);

  const handleAddKeyframe = useCallback(
    (property: 'opacity' | 'volume') => {
      if (!clip) return;
      const midTime = clipEffectiveDuration(clip) / 2;
      const value = clip[property];
      onAddKeyframe(clip.id, property, midTime, value);
    },
    [clip, onAddKeyframe],
  );

  if (!clip) {
    return (
      <div className="clip-properties-panel">
        <div className="clip-properties-panel__header">
          <span className="clip-properties-panel__title">Inspector</span>
          <button className="clip-properties-panel__close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="m4.13 3.05a4.264 4.264 0 0 0 -1.08 1.08 6.143 6.143 0 0 0 -1.05 3.68v8.38c0 3.64 2.17 5.81 5.81 5.81h7.47v-20h-7.47a6.143 6.143 0 0 0 -3.68 1.05zm4.37 6.921a.75.75 0 1 1 1.056-1.061l2.56 2.56a.749.749 0 0 1 0 1.06l-2.56 2.56a.75.75 0 0 1 -1.056-1.061l2.025-2.029zm13.5-2.161v8.38a6.143 6.143 0 0 1 -1.05 3.68 4.264 4.264 0 0 1 -1.08 1.08 5.779 5.779 0 0 1 -3.09 1.03v-19.95c3.28.21 5.22 2.34 5.22 5.78z"/>
            </svg>
          </button>
        </div>
        <div className="clip-properties-panel__empty">
          <span className="clip-properties-panel__empty-text">No clip selected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="clip-properties-panel">
      <div className="clip-properties-panel__header">
        <span className="clip-properties-panel__title">{clip.name}</span>
        <button className="clip-properties-panel__close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="m4.13 3.05a4.264 4.264 0 0 0 -1.08 1.08 6.143 6.143 0 0 0 -1.05 3.68v8.38c0 3.64 2.17 5.81 5.81 5.81h7.47v-20h-7.47a6.143 6.143 0 0 0 -3.68 1.05zm4.37 6.921a.75.75 0 1 1 1.056-1.061l2.56 2.56a.749.749 0 0 1 0 1.06l-2.56 2.56a.75.75 0 0 1 -1.056-1.061l2.025-2.029zm13.5-2.161v8.38a6.143 6.143 0 0 1 -1.05 3.68 4.264 4.264 0 0 1 -1.08 1.08 5.779 5.779 0 0 1 -3.09 1.03v-19.95c3.28.21 5.22 2.34 5.22 5.78z"/>
          </svg>
        </button>
      </div>

      {/* Transform */}
      <div className="clip-properties-panel__section">
        <div className="clip-properties-panel__section-title">Transform</div>
        <div className="clip-properties-panel__toggle-row">
          <button
            className={`clip-properties-panel__toggle-btn${clip.flipH ? ' clip-properties-panel__toggle-btn--active' : ''}`}
            onClick={handleFlipH}
          >
            Flip H
          </button>
          <button
            className={`clip-properties-panel__toggle-btn${clip.flipV ? ' clip-properties-panel__toggle-btn--active' : ''}`}
            onClick={handleFlipV}
          >
            Flip V
          </button>
        </div>
      </div>

      {/* Speed */}
      <div className="clip-properties-panel__section">
        <div className="clip-properties-panel__section-title">Speed</div>
        <div className="clip-properties-panel__row">
          <span className="clip-properties-panel__label">Rate</span>
          <input
            type="range"
            className="clip-properties-panel__slider"
            min={0.25}
            max={4}
            step={0.25}
            value={clip.speed}
            onChange={handleSpeedChange}
          />
          <span className="clip-properties-panel__value">{clip.speed.toFixed(2)}x</span>
        </div>
      </div>

      {/* Opacity */}
      <div className="clip-properties-panel__section">
        <div className="clip-properties-panel__section-title">Opacity</div>
        <div className="clip-properties-panel__row">
          <span className="clip-properties-panel__label">Level</span>
          <input
            type="range"
            className="clip-properties-panel__slider"
            min={0}
            max={1}
            step={0.01}
            value={clip.opacity}
            onChange={handleOpacityChange}
          />
          <span className="clip-properties-panel__value">{Math.round(clip.opacity * 100)}%</span>
        </div>
      </div>

      {/* Volume (audio only) */}
      {isAudio && (
        <div className="clip-properties-panel__section">
          <div className="clip-properties-panel__section-title">Volume</div>
          <div className="clip-properties-panel__row">
            <span className="clip-properties-panel__label">Level</span>
            <input
              type="range"
              className="clip-properties-panel__slider"
              min={0}
              max={4}
              step={0.01}
              value={clip.volume}
              onChange={handleVolumeChange}
            />
            <span className="clip-properties-panel__value">{clip.volume <= 0 ? '-\u221EdB' : `${clip.volume >= 1 ? '+' : ''}${(20 * Math.log10(clip.volume)).toFixed(1)}dB`}</span>
          </div>
        </div>
      )}

      {/* Keyframes */}
      <div className="clip-properties-panel__section">
        <div className="clip-properties-panel__section-title">Keyframes</div>
        <div className="clip-properties-panel__kf-list">
          {clip.keyframes.map((kf, i) => (
            <div key={i} className="clip-properties-panel__kf-item">
              <span>{kf.time.toFixed(2)}s</span>
              <span>{kf.property}</span>
              <span>{kf.property === 'opacity' ? `${Math.round(kf.value * 100)}%` : kf.value.toFixed(2)}</span>
              <button
                className="clip-properties-panel__kf-remove"
                onClick={() => onRemoveKeyframe(clip.id, i)}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <button
          className="clip-properties-panel__add-kf"
          onClick={() => handleAddKeyframe('opacity')}
        >
          + Add Opacity Keyframe
        </button>
        {isAudio && (
          <button
            className="clip-properties-panel__add-kf"
            onClick={() => handleAddKeyframe('volume')}
          >
            + Add Volume Keyframe
          </button>
        )}
      </div>
    </div>
  );
}
