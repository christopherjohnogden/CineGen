import { useEffect, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { extractScriptText, SCRIPT_ACCEPT } from '@/lib/director/look-bible';
import { parseToScreenplay, serializeScreenplay, scrubFdxChrome, trimFdxTrailer, type Screenplay } from '@/lib/director/screenplay';
import { looksLikeFdx, parseFdx } from '@/lib/director/fdx-parser';
import { applyAssistantEdits, applyBeatEdits, type AssistantEdit, type AssistantResponse, type BeatEdit } from '@/lib/director/script-assistant';
import type { ScriptQuote } from '@/lib/director/script-selection';
import { cliProviderFor, parseDirectorLlmProvider } from '@/lib/director/cli-provider';
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
  /** Full reset: clears script, breakdown, scenes and clips, and stops running jobs. */
  onStartOver: () => void;
}

function docFromShow(show: DirectorShow): Screenplay {
  // Prefer structured elements (exact types, stable ids) when present; else parse the text.
  if (show.sourceElements) return { elements: scrubFdxChrome(show.sourceElements) };
  return parseToScreenplay(show.sourceText);
}

export function DirectorScriptTab({ show, onChange, onBreakdown, onStartOver }: DirectorScriptTabProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [scriptQuote, setScriptQuote] = useState<ScriptQuote | undefined>();
  const [pending, setPending] = useState<AssistantEdit[] | undefined>();
  const [pendingBeats, setPendingBeats] = useState<BeatEdit[] | undefined>();
  const [createSeed, setCreateSeed] = useState<{ idea: string; mode: 'draft' | 'brainstorm' } | undefined>();
  const [creating, setCreating] = useState(false);
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
    const next = docFromShow(show);
    const text = serializeScreenplay(next);
    const cleanedEls = show.sourceElements ? scrubFdxChrome(show.sourceElements) : undefined;
    const hadChrome = trimFdxTrailer(show.sourceText) !== show.sourceText
      || Boolean(
        show.sourceElements && cleanedEls && (
          cleanedEls.length !== show.sourceElements.length
          || cleanedEls.some((el, i) => el.text !== show.sourceElements![i].text)
        ),
      );
    if (hadChrome) {
      lastSerialized.current = text;
      setDocState(next);
      onChange({ ...show, sourceElements: next.elements, sourceText: text });
      return;
    }
    // Re-sync when an external change (upload, another tab) makes sourceText differ from what
    // we last serialized. Adopt sourceElements directly when present (no reparse, stable ids).
    if (show.sourceText !== lastSerialized.current) {
      lastSerialized.current = text;
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

  const commitUploadedScript = (patch: Partial<DirectorShow>) => {
    onChange({ ...show, ...patch });
    onBreakdown();
  };

  const loadScript = async (file: File | undefined) => {
    if (!file) return;
    setScriptError('');
    try {
      const raw = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext === 'fdx' || looksLikeFdx(raw)) {
        const parsed = parseFdx(raw);
        if (parsed) {
          commitUploadedScript({
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
      commitUploadedScript({ sourceText: text, sourceFileName: file.name, sourceElements: undefined });
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

  // A pending create (Draft/Brainstorm) latches us into the editor+chat view — the chat
  // delivers the seed — rather than staying on (or flipping back to) the empty state.
  const isEmpty = !creating && (docKind === 'beatsheet' ? beatSheet.beats.length === 0 : (!show.sourceText.trim() && !show.sourceElements));
  // Latch `creating` so a freshly-blank doc drops into the editor rather than re-showing
  // the empty state (a blank doc is otherwise indistinguishable from "no doc").
  const newScreenplay = () => {
    setCreateSeed(undefined);
    setCreating(true);
    onChange({ ...show, docKind: 'screenplay', sourceText: '', sourceElements: undefined });
  };
  const newBeatSheet = () => {
    setCreateSeed(undefined);
    setCreating(true);
    onChange({ ...show, docKind: 'beatsheet', beatSheet: emptyBeatSheet(), sourceText: '' });
  };
  const createFromPrompt = (idea: string, kind: 'screenplay' | 'beatsheet', mode: 'draft' | 'brainstorm') => {
    if (kind === 'beatsheet') onChange({ ...show, docKind: 'beatsheet', beatSheet: emptyBeatSheet(), sourceText: '' });
    else onChange({ ...show, docKind: 'screenplay', sourceText: '', sourceElements: undefined });
    setRightOpen(true);
    setCreating(true);
    setCreateSeed({ idea, mode });
  };
  // Full reset back to the empty state: script, breakdown, scenes and clips all
  // go (Elements in the library are untouched). Running jobs are stopped so a
  // late result can't repopulate the cleared board.
  const startOver = () => {
    if (!window.confirm('Start over? This clears the script, breakdown, and shotlist. Elements already in your library are kept.')) return;
    setCreating(false);
    setCreateSeed(undefined);
    setSelectedId(undefined);
    setPending(undefined);
    setPendingBeats(undefined);
    onStartOver();
  };

  return (
    <div className="director-tab" style={{ height: '100%' }}>
      <div className="director-tab__toolbar">
        <span className="director-tab__label" style={{ margin: 0 }}>Script</span>
        {show.sourceFileName && <span className="director-tab__meta">{show.sourceFileName}</span>}
        <input ref={fileRef} type="file" accept={SCRIPT_ACCEPT} className="director-tab__file-input" onChange={(e) => void loadScript(e.target.files?.[0])} />
        <div className="director-tab__row" style={{ marginLeft: 'auto', alignItems: 'center' }}>
          <div className="dtool">
            {!isEmpty && (
              <>
                <button type="button" className="dtool-btn" onClick={startOver} title="Discard the current script and start over">
                  <StartOverIcon />
                  Start over
                </button>
                <span className="dtool-vr" aria-hidden />
              </>
            )}
            <button type="button" className="dtool-btn" onClick={() => fileRef.current?.click()}>
              <UploadIcon />
              Upload
            </button>
          </div>
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
              <DirectorScriptAssets doc={doc} breakdown={show.breakdown} spend={show.llmSpend} onJumpToScene={jumpToScene} />
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
              contextIds={scriptQuote?.elementIds}
              onContextSelect={(quote) => setScriptQuote(quote ?? undefined)}
              onAcceptEdits={acceptEdits}
              onDeclineEdits={declineEdits}
            />
          )}

          {rightOpen && (
            <CollapsiblePanel side="right" open={rightOpen} onToggle={setRightOpen}>
              <DirectorScriptChat
                doc={doc}
                provider={cliProviderFor(parseDirectorLlmProvider(show.llmProvider))}
                selectedId={selectedId}
                selectedText={selectedText}
                quote={scriptQuote}
                onClearQuote={() => setScriptQuote(undefined)}
                onProposeEdits={(res: AssistantResponse) => setPending(res.edits)}
                docKind={docKind}
                beatSheet={beatSheet}
                onProposeBeatEdits={(res: AssistantResponse) => setPendingBeats(res.beatEdits)}
                initialMessage={createSeed}
                onInitialConsumed={() => setCreateSeed(undefined)}
                messages={show.chatMessages ?? []}
                onMessagesChange={(m) => onChange({ ...show, chatMessages: m })}
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

function StartOverIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.2 12a7.8 7.8 0 1 0 2.3-5.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M4.2 5.2v5.2h5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 15.5V5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.2 8.6 12 4.8l3.8 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 15.8v2.4A1.8 1.8 0 0 0 6.8 20h10.4A1.8 1.8 0 0 0 19 18.2v-2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
