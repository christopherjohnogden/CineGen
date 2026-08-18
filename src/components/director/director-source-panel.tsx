import { useRef, useState } from 'react';
import type { Element } from '@/types/elements';
import type { DirectorShow } from '@/types/director';
import { CLIP_LENGTHS } from '@/types/director';
import { findMatchingElement, itemsMissingElements } from '@/lib/director/breakdown';
import { extractScriptText, SCRIPT_ACCEPT } from '@/lib/director/look-bible';
import { listDirectorAdapters } from '@/lib/director/video-adapter';
import { DirectorLookBiblePanel } from './director-look-bible';

interface DirectorSourcePanelProps {
  show: DirectorShow;
  elements: Element[];
  lookBibleWriting: boolean;
  lookBibleError?: string;
  onChange: (show: DirectorShow) => void;
  onBreakdown: () => void;
  onApprove: () => void;
  onCreateMissing: () => void;
  onOpenElements: () => void;
  onWriteLookBible: () => void;
  onCancelLookBible: () => void;
}

export function DirectorSourcePanel({
  show,
  elements,
  lookBibleWriting,
  lookBibleError,
  onChange,
  onBreakdown,
  onApprove,
  onCreateMissing,
  onOpenElements,
  onWriteLookBible,
  onCancelLookBible,
}: DirectorSourcePanelProps) {
  const missing = itemsMissingElements(show.breakdown, elements);
  const adapters = listDirectorAdapters();
  const scriptRef = useRef<HTMLInputElement>(null);
  const [scriptError, setScriptError] = useState('');

  const loadScript = async (file: File | undefined) => {
    if (!file) return;
    setScriptError('');
    try {
      const raw = await file.text();
      const text = extractScriptText(file.name, raw);
      if (!text.trim()) throw new Error('That file did not contain readable script text.');
      onChange({ ...show, sourceText: text, sourceFileName: file.name });
    } catch (error) {
      setScriptError(error instanceof Error ? error.message : 'Could not read that script.');
    }
    if (scriptRef.current) scriptRef.current.value = '';
  };

  return (
    <aside className="director-tab__col">
      <div>
        <label className="director-tab__label" htmlFor="director-source">Script or idea</label>
        <input
          ref={scriptRef}
          type="file"
          accept={SCRIPT_ACCEPT}
          className="director-tab__file-input"
          onChange={(event) => void loadScript(event.target.files?.[0])}
        />
        <div className="director-tab__row">
          <button type="button" className="director-tab__btn" onClick={() => scriptRef.current?.click()}>
            Upload script
          </button>
          {show.sourceFileName && <span className="director-tab__meta">{show.sourceFileName}</span>}
        </div>
        {scriptError && <p className="director-tab__warn">{scriptError}</p>}
        <textarea
          id="director-source"
          value={show.sourceText}
          onChange={(event) => onChange({ ...show, sourceText: event.target.value, sourceFileName: show.sourceFileName })}
          placeholder="Paste a script, treatment, or a short idea — or upload .txt, .md, .fountain, .fdx."
        />
      </div>

      <div className="director-tab__row">
        <div style={{ flex: 1 }}>
          <label className="director-tab__label" htmlFor="director-length">Clip length</label>
          <select
            id="director-length"
            value={show.clipLengthSec}
            onChange={(event) => onChange({ ...show, clipLengthSec: Number(event.target.value) as typeof show.clipLengthSec })}
          >
            {CLIP_LENGTHS.map((value) => (
              <option key={value} value={value}>{value}s</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="director-tab__label" htmlFor="director-adapter">Adapter</label>
          <select
            id="director-adapter"
            value={show.adapterId}
            onChange={(event) => onChange({ ...show, adapterId: event.target.value })}
          >
            {adapters.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>{adapter.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="director-tab__row">
        <div style={{ flex: 1 }}>
          <label className="director-tab__label" htmlFor="director-aspect">Aspect</label>
          <select
            id="director-aspect"
            value={show.aspectRatio}
            onChange={(event) => onChange({ ...show, aspectRatio: event.target.value })}
          >
            {['16:9', '9:16', '1:1', '21:9', '4:3'].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="director-tab__label" htmlFor="director-res">Resolution</label>
          <select
            id="director-res"
            value={show.resolution}
            onChange={(event) => onChange({ ...show, resolution: event.target.value })}
          >
            {['480p', '720p', '1080p'].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
        <input
          type="checkbox"
          checked={show.generateAudio}
          onChange={(event) => onChange({ ...show, generateAudio: event.target.checked })}
        />
        Generate audio
      </label>

      <DirectorLookBiblePanel
        show={show}
        writing={lookBibleWriting}
        error={lookBibleError}
        onChange={onChange}
        onWrite={onWriteLookBible}
        onCancel={onCancelLookBible}
      />

      <div className="director-tab__row">
        <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onBreakdown} disabled={!show.sourceText.trim()}>
          Run breakdown
        </button>
        <button type="button" className="director-tab__btn" onClick={onApprove} disabled={show.breakdown.length === 0 || show.breakdownApproved}>
          {show.breakdownApproved ? 'Approved' : 'Approve'}
        </button>
      </div>

      <div>
        <span className="director-tab__label">Element registry</span>
        {show.breakdown.length === 0 ? (
          <p className="director-tab__empty">Run a breakdown to list characters, locations, props, and vehicles.</p>
        ) : (
          <div className="director-tab__list">
            {show.breakdown.map((item) => {
              const linked = item.elementId || findMatchingElement(elements, item)?.id;
              return (
                <div key={item.id} className="director-tab__item">
                  <span className="director-tab__item-title">{item.tag} · {item.name}</span>
                  <span className="director-tab__meta">
                    {item.kind}
                    {linked ? ' · linked' : ' · missing'}
                    {item.blurb ? ` — ${item.blurb}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="director-tab__row">
        <button type="button" className="director-tab__btn" onClick={onCreateMissing} disabled={missing.length === 0}>
          Create missing ({missing.length})
        </button>
        <button type="button" className="director-tab__btn" onClick={onOpenElements}>
          Generate refs
        </button>
      </div>
    </aside>
  );
}
