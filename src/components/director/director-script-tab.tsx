import { useEffect, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { extractScriptText, SCRIPT_ACCEPT } from '@/lib/director/look-bible';
import { parseToScreenplay, serializeScreenplay, type Screenplay } from '@/lib/director/screenplay';
import { applyAssistantEdits, type AssistantEdit, type AssistantResponse } from '@/lib/director/script-assistant';
import { parseDirectorLlmProvider } from '@/lib/director/cli-provider';
import { CollapsiblePanel } from './collapsible-panel';
import { ScreenplayEditor, ELEMENT_TYPES } from './screenplay-editor';
import { DirectorScriptAssets } from './director-script-assets';
import { DirectorScriptChat } from './director-script-chat';

interface DirectorScriptTabProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
  onBreakdown: () => void;
}

export function DirectorScriptTab({ show, onChange, onBreakdown }: DirectorScriptTabProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pending, setPending] = useState<AssistantEdit[] | undefined>();
  const [scriptError, setScriptError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [doc, setDocState] = useState<Screenplay>(() => parseToScreenplay(show.sourceText));

  // Re-sync from sourceText ONLY when it changes externally (upload, or another tab),
  // not from our own serialize round-trip. We compare against what we last serialized.
  const lastSerialized = useRef(serializeScreenplay(doc));
  useEffect(() => {
    if (show.sourceText !== lastSerialized.current) {
      const next = parseToScreenplay(show.sourceText);
      lastSerialized.current = show.sourceText;
      setDocState(next);
    }
  }, [show.sourceText]);

  // Debounce the serialize-back to sourceText so we don't round-trip on every keystroke-commit.
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDoc = (next: Screenplay) => {
    setDocState(next);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const text = serializeScreenplay(next);
      lastSerialized.current = text;
      onChange({ ...show, sourceText: text });
    }, 400);
  };
  useEffect(() => () => { if (flushTimer.current) clearTimeout(flushTimer.current); }, []);

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

  const selectedText = doc.elements.find((e) => e.id === selectedId)?.text;
  const currentType = doc.elements.find((e) => e.id === selectedId)?.type;

  const acceptEdits = () => { if (pending) { setDoc(applyAssistantEdits(doc, pending)); setPending(undefined); } };
  const declineEdits = () => setPending(undefined);

  // scroll the editor to the Nth scene heading (spec: Scenes navigator scrolls the editor)
  const jumpToScene = (sceneIndex: number) => {
    const headings = doc.elements.filter((e) => e.type === 'scene');
    const target = headings[sceneIndex];
    if (!target) return;
    const node = document.querySelector(`[data-el-id="${target.id}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSelectedId(target.id);
  };

  return (
    <div className="director-tab" style={{ height: '100%' }}>
      <div className="director-tab__toolbar">
        <span className="director-tab__label" style={{ margin: 0 }}>Script</span>
        {show.sourceFileName && <span className="director-tab__meta">{show.sourceFileName}</span>}
        <input ref={fileRef} type="file" accept={SCRIPT_ACCEPT} className="director-tab__file-input" onChange={(e) => void loadScript(e.target.files?.[0])} />
        <div className="director-tab__row" style={{ marginLeft: 'auto' }}>
          <button type="button" className="director-tab__btn" onClick={() => fileRef.current?.click()}>⬆ Upload</button>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onBreakdown} disabled={!show.sourceText.trim()}>Run breakdown →</button>
        </div>
      </div>
      {scriptError && <p className="director-tab__warn" style={{ padding: '0 16px' }}>{scriptError}</p>}

      <div className="dse-shell" data-left={leftOpen ? 'open' : 'closed'} data-right={rightOpen ? 'open' : 'closed'}>
        {!leftOpen && <button type="button" className="dse-reopen dse-reopen--left" onClick={() => setLeftOpen(true)} title="Show panel">›</button>}
        {!rightOpen && <button type="button" className="dse-reopen dse-reopen--right" onClick={() => setRightOpen(true)} title="Show assistant">‹</button>}

        {leftOpen && (
          <CollapsiblePanel side="left" open={leftOpen} onToggle={setLeftOpen}>
            <DirectorScriptAssets doc={doc} breakdown={show.breakdown} onJumpToScene={jumpToScene} />
          </CollapsiblePanel>
        )}

        <ScreenplayEditor
          doc={doc}
          selectedId={selectedId}
          pendingEdits={pending}
          onChange={setDoc}
          onSelect={setSelectedId}
          onAcceptEdits={acceptEdits}
          onDeclineEdits={declineEdits}
        />

        {rightOpen && (
          <CollapsiblePanel side="right" open={rightOpen} onToggle={setRightOpen}>
            <DirectorScriptChat
              doc={doc}
              provider={parseDirectorLlmProvider(show.llmProvider)}
              selectedId={selectedId}
              selectedText={selectedText}
              onProposeEdits={(res: AssistantResponse) => setPending(res.edits)}
            />
          </CollapsiblePanel>
        )}
      </div>

      <div className="dse-legend">
        {ELEMENT_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dse-leg${currentType === t.id ? ' dse-leg--on' : ''}`}
            onClick={() => { if (selectedId) setDoc({ elements: doc.elements.map((e) => (e.id === selectedId ? { ...e, type: t.id } : e)) }); }}
          >
            <span className="sw" style={{ background: t.color }} /><span className="nm">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
