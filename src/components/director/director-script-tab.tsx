import { useEffect, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { extractScriptText, SCRIPT_ACCEPT } from '@/lib/director/look-bible';
import { parseToScreenplay, serializeScreenplay, type Screenplay } from '@/lib/director/screenplay';
import { parseFdx } from '@/lib/director/fdx-parser';
import { applyAssistantEdits, applyBeatEdits, type AssistantEdit, type AssistantResponse, type BeatEdit } from '@/lib/director/script-assistant';
import { parseDirectorLlmProvider } from '@/lib/director/cli-provider';
import { CollapsiblePanel } from './collapsible-panel';
import { PaginatedEditor, ELEMENT_TYPES } from './paginated-editor';
import { DirectorScriptAssets } from './director-script-assets';
import { DirectorScriptChat } from './director-script-chat';
import { ScriptEmptyState } from './script-empty-state';
import { BeatsheetEditor } from './beatsheet-editor';
import { emptyBeatSheet, serializeBeatSheet, type BeatSheet } from '@/lib/director/beatsheet';

interface DirectorScriptTabProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
  onBreakdown: () => void;
}

function docFromShow(show: DirectorShow): Screenplay {
  // Prefer structured elements (exact types, stable ids) when present; else parse the text.
  return show.sourceElements ? { elements: show.sourceElements } : parseToScreenplay(show.sourceText);
}

export function DirectorScriptTab({ show, onChange, onBreakdown }: DirectorScriptTabProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pending, setPending] = useState<AssistantEdit[] | undefined>();
  const [pendingBeats, setPendingBeats] = useState<BeatEdit[] | undefined>();
  const [createSeed, setCreateSeed] = useState<{ idea: string; mode: 'draft' | 'brainstorm' } | undefined>();
  const [scriptError, setScriptError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const docKind = show.docKind ?? 'screenplay';
  const beatSheet = show.beatSheet ?? emptyBeatSheet();
  const setBeatSheet = (bs: BeatSheet) => onChange({ ...show, beatSheet: bs, sourceText: serializeBeatSheet(bs) });

  const [doc, setDocState] = useState<Screenplay>(() => docFromShow(show));

  // Re-sync from sourceText ONLY when it changes externally (upload, or another tab),
  // not from our own serialize round-trip. We compare against what we last serialized.
  const lastSerialized = useRef(serializeScreenplay(doc));
  useEffect(() => {
    // Re-sync when an external change (upload, another tab) makes sourceText differ from what
    // we last serialized. Adopt sourceElements directly when present (no reparse, stable ids).
    if (show.sourceText !== lastSerialized.current) {
      const next = docFromShow(show);
      lastSerialized.current = serializeScreenplay(next);
      setDocState(next);
    }
  }, [show.sourceText, show.sourceElements]);

  // Debounce the serialize-back to sourceText so we don't round-trip on every keystroke-commit.
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDoc = (next: Screenplay) => {
    setDocState(next);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const text = serializeScreenplay(next);
      lastSerialized.current = text;
      // Keep sourceElements and sourceText coherent — both written from the same array.
      onChange({ ...show, sourceElements: next.elements, sourceText: text });
    }, 400);
  };
  useEffect(() => () => { if (flushTimer.current) clearTimeout(flushTimer.current); }, []);

  const loadScript = async (file: File | undefined) => {
    if (!file) return;
    setScriptError('');
    try {
      const raw = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext === 'fdx') {
        const parsed = parseFdx(raw);
        if (parsed) {
          onChange({
            ...show,
            sourceElements: parsed.elements,
            sourceText: serializeScreenplay(parsed),
            sourceFileName: file.name,
          });
          if (fileRef.current) fileRef.current.value = '';
          return;
        }
        // fall through to the plain-text path below on unparseable FDX
      }
      const text = extractScriptText(file.name, raw);
      if (!text.trim()) throw new Error('That file did not contain readable script text.');
      onChange({ ...show, sourceText: text, sourceFileName: file.name, sourceElements: undefined });
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

  const isEmpty = docKind === 'beatsheet' ? beatSheet.beats.length === 0 : (!show.sourceText.trim() && !show.sourceElements);
  const newScreenplay = () => onChange({ ...show, docKind: 'screenplay', sourceText: '', sourceElements: undefined });
  const newBeatSheet = () => onChange({ ...show, docKind: 'beatsheet', beatSheet: emptyBeatSheet(), sourceText: '' });
  const createFromPrompt = (idea: string, kind: 'screenplay' | 'beatsheet', mode: 'draft' | 'brainstorm') => {
    if (kind === 'beatsheet') onChange({ ...show, docKind: 'beatsheet', beatSheet: emptyBeatSheet(), sourceText: '' });
    else onChange({ ...show, docKind: 'screenplay', sourceText: '', sourceElements: undefined });
    setRightOpen(true);
    setCreateSeed({ idea, mode });
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

      {isEmpty ? (
        <ScriptEmptyState onNewScreenplay={newScreenplay} onNewBeatSheet={newBeatSheet} onUpload={() => fileRef.current?.click()} onCreateFromPrompt={createFromPrompt} />
      ) : (
        <div className="dse-shell" data-left={leftOpen ? 'open' : 'closed'} data-right={rightOpen ? 'open' : 'closed'}>
          {!leftOpen && <button type="button" className="dse-reopen dse-reopen--left" onClick={() => setLeftOpen(true)} title="Show panel">›</button>}
          {!rightOpen && <button type="button" className="dse-reopen dse-reopen--right" onClick={() => setRightOpen(true)} title="Show assistant">‹</button>}

          {leftOpen && (
            <CollapsiblePanel side="left" open={leftOpen} onToggle={setLeftOpen}>
              <DirectorScriptAssets doc={doc} breakdown={show.breakdown} onJumpToScene={jumpToScene} />
            </CollapsiblePanel>
          )}

          {docKind === 'beatsheet' ? (
            <BeatsheetEditor
              beatSheet={beatSheet}
              selectedBeatId={selectedId}
              pendingBeatEdits={pendingBeats}
              onChange={setBeatSheet}
              onSelect={setSelectedId}
              onAcceptEdits={() => { setBeatSheet(applyBeatEdits(beatSheet, pendingBeats ?? [])); setPendingBeats(undefined); }}
              onDeclineEdits={() => setPendingBeats(undefined)}
            />
          ) : (
            <PaginatedEditor
              doc={doc}
              selectedId={selectedId}
              pendingEdits={pending}
              onChange={setDoc}
              onSelect={setSelectedId}
              onAcceptEdits={acceptEdits}
              onDeclineEdits={declineEdits}
            />
          )}

          {rightOpen && (
            <CollapsiblePanel side="right" open={rightOpen} onToggle={setRightOpen}>
              <DirectorScriptChat
                doc={doc}
                provider={parseDirectorLlmProvider(show.llmProvider)}
                selectedId={selectedId}
                selectedText={selectedText}
                onProposeEdits={(res: AssistantResponse) => setPending(res.edits)}
                docKind={docKind}
                beatSheet={beatSheet}
                onProposeBeatEdits={(res: AssistantResponse) => setPendingBeats(res.beatEdits)}
                initialMessage={createSeed}
              />
            </CollapsiblePanel>
          )}
        </div>
      )}

      {docKind === 'screenplay' && (
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
      )}
    </div>
  );
}
