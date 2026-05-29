import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';

interface QuickEditModalProps {
  clip: Clip;
  asset: Asset;
  /** Source time (seconds) at the playhead within the clip, for frame extraction. */
  playheadSourceSec: number;
  onStartGeneration: (
    clipId: string,
    generationPromise: Promise<{ url: string; durationSec: number }>,
    label: string,
  ) => void;
  onClose: () => void;
}

type Phase = 'input' | 'generating';

const PLACEHOLDERS = [
  'Create a clean plate of this shot',
  'Make the person wear a black suit',
  'Remove the logo from the shirt',
  'Extend this 3 more seconds with the same motion',
];

export function QuickEditModal({ clip, asset, playheadSourceSec, onStartGeneration, onClose }: QuickEditModalProps) {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const route = useMemo(() => (prompt.trim() ? routeQuickEdit(prompt) : null), [prompt]);

  const handleSubmit = useCallback(async () => {
    const text = prompt.trim();
    if (!text || phase !== 'input') return;
    if (!asset.fileRef) { setError('This clip has no local source file.'); return; }

    const decided = routeQuickEdit(text);
    setError(null);
    setPhase('generating');

    const sourceStartSec = clip.trimStart;
    const sourceEndSec = clip.duration - clip.trimEnd;

    const generationPromise = window.electronAPI.higgsfield.quickEdit({
      fileRef: asset.fileRef,
      prompt: text,
      model: decided.model,
      outputType: decided.outputType,
      referenceMode: decided.referenceMode,
      frameTimeSec: playheadSourceSec,
      sourceStartSec,
      sourceEndSec,
    }).then((res) => ({ url: res.url, durationSec: res.durationSec ?? clipEffectiveDuration(clip) }));

    // Hand the promise to the host (which adds a pending clip and swaps in the result).
    onStartGeneration(clip.id, generationPromise, text.slice(0, 40));

    // Surface failures inline too (the host also handles them), keeping the modal open on error.
    try {
      await generationPromise;
      onClose();
    } catch (err) {
      setPhase('input');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [prompt, phase, asset.fileRef, clip, playheadSourceSec, onStartGeneration, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit(); }
    if (e.key === 'Escape') onClose();
  }, [handleSubmit, onClose]);

  return (
    <div className="fgm__backdrop" onMouseDown={onClose}>
      <div
        ref={modalRef}
        className="fgm"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Edit with AI"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="fgm__header">
          <svg className="fgm__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 L14 9 L21 9 L15 13 L17 20 L12 16 L7 20 L9 13 L3 9 L10 9 Z" />
          </svg>
          <span className="fgm__title">Quick Edit with AI</span>
          <span className="fgm__duration">{asset.name}</span>
        </div>

        <div style={{ padding: '12px 16px', boxSizing: 'border-box' }}>
          <textarea
            ref={inputRef}
            className="fgm__prompt"
            value={prompt}
            disabled={phase === 'generating'}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={PLACEHOLDERS[0]}
            rows={3}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg-sunken, #1a1a1f)', color: 'inherit', border: '1px solid var(--border-medium, #333)', borderRadius: 6, padding: 8, fontFamily: 'inherit', fontSize: 14 }}
          />
          {route && (
            <div className="fgm__hint" style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              Auto: {route.reason} ({route.placement.replace('_', ' ')})
            </div>
          )}
          {error && (
            <div className="fgm__error" style={{ marginTop: 6, fontSize: 12, color: 'var(--danger, #e66)' }}>{error}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="fgm__btn" onClick={onClose} disabled={phase === 'generating'}>Cancel</button>
            <button className="fgm__btn fgm__btn--primary" onClick={() => void handleSubmit()} disabled={!prompt.trim() || phase === 'generating'}>
              {phase === 'generating' ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
