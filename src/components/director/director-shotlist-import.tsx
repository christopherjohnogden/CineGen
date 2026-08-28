import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { useCopiedFlash } from '@/hooks/use-copied-flash';
import {
  applyClaudeShotlistImport,
  claudeShotlistImportPrompt,
  parseClaudeShotlistImport,
} from '@/lib/director/shotlist-import';
import { padTimecode } from '@/lib/director/prompt-compiler';

interface DirectorShotlistImportProps {
  show: DirectorShow;
  disabled?: boolean;
  onChange: (show: DirectorShow) => void;
}

export function DirectorShotlistImport({ show, disabled, onChange }: DirectorShotlistImportProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const copied = useCopiedFlash();
  const result = useMemo(() => parseClaudeShotlistImport(text, show), [text, show]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const readFile = async (file?: File) => {
    if (!file) return;
    setText(await file.text());
  };

  const importDraft = () => {
    if (!result.ok) return;
    onChange(applyClaudeShotlistImport(show, result.draft));
    setOpen(false);
    setText('');
  };

  return (
    <>
      <button type="button" className="director-tab__btn" disabled={disabled} onClick={() => setOpen(true)}>
        Import Claude JSON
      </button>

      {open && (
        <div className="dsl-import__backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="dsl-import" role="dialog" aria-modal="true" aria-labelledby="dsl-import-title">
            <header className="dsl-import__head">
              <div>
                <span className="dsl-import__eyebrow">External shotlist</span>
                <h2 id="dsl-import-title">Import from Claude</h2>
                <p>Bring in a full show or one scene. CineGen matches scene numbers, checks every shot, then replaces only the included scenes.</p>
              </div>
              <button type="button" className="dsl-import__close" onClick={() => setOpen(false)} aria-label="Close shotlist import">Close</button>
            </header>

            <div className="dsl-import__tools">
              <div>
                <strong>1. Give Claude the project-ready instructions</strong>
                <span>The copied prompt includes your scene IDs, elements, look, clip length, and screenplay.</span>
              </div>
              <button
                type="button"
                className="director-tab__btn"
                onClick={() => void copied.copyText(claudeShotlistImportPrompt(show), 'claude-shotlist-prompt')}
              >
                {copied.isCopied('claude-shotlist-prompt') ? 'Prompt copied' : 'Copy Claude prompt'}
              </button>
            </div>

            <div className="dsl-import__body">
              <div
                className={`dsl-import__input${dragging ? ' dsl-import__input--dragging' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void readFile(event.dataTransfer.files[0]);
                }}
              >
                <div className="dsl-import__input-head">
                  <label htmlFor="dsl-import-json">2. Paste Claude&rsquo;s JSON</label>
                  <button type="button" onClick={() => fileRef.current?.click()}>Choose .json file</button>
                  <input ref={fileRef} type="file" accept="application/json,.json,text/plain" hidden onChange={(event) => void readFile(event.target.files?.[0])} />
                </div>
                <textarea
                  id="dsl-import-json"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={'{\n  "scenes": [...],\n  "clips": [...]\n}'}
                  spellCheck={false}
                  autoFocus
                />
                <span>Drop a JSON file here, or paste Claude&rsquo;s entire response. Markdown fences are accepted.</span>
              </div>

              <aside className="dsl-import__check" aria-live="polite">
                <span className="dsl-import__check-label">Import check</span>
                {result.ok ? (
                  <>
                    <div className="dsl-import__metrics">
                      <div><strong>{result.draft.scenes.length}</strong><span>Scenes</span></div>
                      <div><strong>{result.draft.clipCount}</strong><span>Clips</span></div>
                      <div><strong>{result.draft.shotCount}</strong><span>Shots</span></div>
                      <div><strong>{padTimecode(result.draft.seconds)}</strong><span>Runtime</span></div>
                    </div>
                    <div className="dsl-import__scenes">
                      {result.draft.scenes.map((scene) => (
                        <div key={scene.id}>
                          <strong>{scene.label}</strong>
                          <span>{scene.clips} clip{scene.clips === 1 ? '' : 's'} · {scene.shots} shot{scene.shots === 1 ? '' : 's'} · {padTimecode(scene.seconds)}</span>
                        </div>
                      ))}
                    </div>
                    {result.draft.warnings.map((warning) => <p key={warning} className="dsl-import__warning">{warning}</p>)}
                    <p className="dsl-import__replace">Importing replaces existing clips, takes, and storyboard frames only in the scenes listed above. Other scenes and generated media assets stay untouched.</p>
                  </>
                ) : (
                  <div className="dsl-import__errors">
                    {result.errors.map((error) => <p key={error}>{error}</p>)}
                  </div>
                )}
              </aside>
            </div>

            <footer className="dsl-import__foot">
              <button type="button" className="director-tab__btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="director-tab__btn director-tab__btn--accent" disabled={!result.ok} onClick={importDraft}>
                {result.ok ? `Import ${result.draft.clipCount} clip${result.draft.clipCount === 1 ? '' : 's'}` : 'Check JSON to import'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
