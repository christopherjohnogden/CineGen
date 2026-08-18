import { useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { extractScriptText, SCRIPT_ACCEPT } from '@/lib/director/look-bible';
import { parseScreenplay, type ScriptLine } from '@/lib/director/script-format';

interface DirectorScriptTabProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
  onBreakdown: () => void;
}

const CLASS: Record<ScriptLine['type'], string> = {
  'scene-heading': 'director-tab__fmt-scene',
  transition: 'director-tab__fmt-transition',
  character: 'director-tab__fmt-cue',
  parenthetical: 'director-tab__fmt-paren',
  dialogue: 'director-tab__fmt-dialogue',
  action: 'director-tab__fmt-action',
};

export function DirectorScriptTab({ show, onChange, onBreakdown }: DirectorScriptTabProps) {
  const [formatted, setFormatted] = useState(false);
  const [scriptError, setScriptError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (fileRef.current) fileRef.current.value = '';
  };

  const words = show.sourceText.trim() ? show.sourceText.trim().split(/\s+/).length : 0;
  const lines = formatted ? parseScreenplay(show.sourceText) : [];

  return (
    <div className="director-tab__stage">
      <div className="director-tab__row" style={{ alignItems: 'center' }}>
        <span className="director-tab__label" style={{ margin: 0 }}>Script</span>
        {show.sourceFileName && <span className="director-tab__meta">{show.sourceFileName}</span>}
        <input
          ref={fileRef}
          type="file"
          accept={SCRIPT_ACCEPT}
          className="director-tab__file-input"
          onChange={(event) => void loadScript(event.target.files?.[0])}
        />
        <div className="director-tab__row" style={{ marginLeft: 'auto' }}>
          <button type="button" className="director-tab__btn" onClick={() => fileRef.current?.click()}>Upload</button>
          <button type="button" className="director-tab__btn" onClick={() => setFormatted((value) => !value)} disabled={!show.sourceText.trim()}>
            {formatted ? 'Edit view' : 'Formatted view'}
          </button>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onBreakdown} disabled={!show.sourceText.trim()}>
            Run breakdown →
          </button>
        </div>
      </div>
      {scriptError && <p className="director-tab__warn">{scriptError}</p>}

      {formatted ? (
        <div className="director-tab__fmt">
          {lines.map((line, index) => (
            <div key={index} className={CLASS[line.type]}>{line.text || ' '}</div>
          ))}
        </div>
      ) : (
        <textarea
          className="director-tab__editor"
          value={show.sourceText}
          spellCheck={false}
          placeholder="Paste a script, treatment, or short idea — or upload .txt, .md, .fountain, .fdx."
          onChange={(event) => onChange({ ...show, sourceText: event.target.value })}
        />
      )}

      <span className="director-tab__meta">{words} words · source of truth for breakdown &amp; shotlist</span>
    </div>
  );
}
