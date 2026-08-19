import { useEffect, useRef, useState } from 'react';
import type { CliLlmProviderId } from '@/lib/llm/claude-code-session';
import { invokeCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import type { Screenplay } from '@/lib/director/screenplay';
import {
  SCRIPT_ASSISTANT_SYSTEM_PROMPT, BEATSHEET_ASSISTANT_SYSTEM_PROMPT,
  buildAssistantMessage, buildBeatsheetMessage, parseAssistantResponse,
  needsJsonRetry, JSON_REPAIR_INSTRUCTION, type AssistantResponse,
} from '@/lib/director/script-assistant';

interface DirectorScriptChatProps {
  doc: Screenplay;
  provider: CliLlmProviderId;
  selectedId?: string;
  selectedText?: string;
  onProposeEdits: (res: AssistantResponse) => void;
  docKind: 'screenplay' | 'beatsheet';
  beatSheet?: import('@/lib/director/beatsheet').BeatSheet;
  onProposeBeatEdits: (res: import('@/lib/director/script-assistant').AssistantResponse) => void;
  initialMessage?: { idea: string; mode: 'draft' | 'brainstorm' };
  onInitialConsumed?: () => void;
}

interface ChatMsg { role: 'user' | 'ai'; text: string }

export function DirectorScriptChat({ doc, provider, selectedId, selectedText, onProposeEdits, docKind, beatSheet, onProposeBeatEdits, initialMessage, onInitialConsumed }: DirectorScriptChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (override?: { text: string; mode?: 'draft' | 'brainstorm' }) => {
    const text = (override?.text ?? draft).trim();
    if (!text || busy) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const isBeat = docKind === 'beatsheet';
      const brainstorm = override?.mode === 'brainstorm';
      const systemPrompt = isBeat ? BEATSHEET_ASSISTANT_SYSTEM_PROMPT : SCRIPT_ASSISTANT_SYSTEM_PROMPT;
      // In brainstorm mode, nudge the model to converse only (no edits/beatEdits this turn).
      const userMessage = (isBeat
        ? buildBeatsheetMessage(beatSheet ?? { beats: [] }, text, selectedId ? { beatId: selectedId } : undefined)
        : buildAssistantMessage(doc, text, selectedId ? { elementId: selectedId } : undefined))
        + (brainstorm ? '\n\n(Brainstorm mode: discuss and outline only — do NOT return edits/beatEdits this turn.)' : '');
      // injectProjectContext:true is REQUIRED — without it the electron handler drops the
      // systemPrompt entirely (it only appends it on resume or when this flag is set), so the
      // model never sees the JSON contract and always replies in prose.
      const result = await invokeCliCopilotChat(provider, { systemPrompt, userMessage, purpose: 'copilot', injectProjectContext: true });
      let res = parseAssistantResponse(result.message);
      let gotEdits = isBeat ? !!res.beatEdits?.length : !!res.edits?.length;
      // If the model answered a write request in prose (no edits), send one follow-up asking
      // it to convert its own answer into the required JSON, then use that.
      if (needsJsonRetry(text, gotEdits, brainstorm)) {
        const repair = await invokeCliCopilotChat(provider, {
          systemPrompt,
          userMessage: `${JSON_REPAIR_INSTRUCTION}\n\nYour previous answer:\n${res.reply}`,
          purpose: 'copilot',
          injectProjectContext: true,
        });
        const repaired = parseAssistantResponse(repair.message);
        if (isBeat ? repaired.beatEdits?.length : repaired.edits?.length) {
          res = repaired;
          gotEdits = true;
        }
      }
      const count = isBeat ? res.beatEdits?.length : res.edits?.length;
      setMessages((m) => [...m, { role: 'ai', text: res.reply + (count ? `\n(proposed ${count} change${count === 1 ? '' : 's'})` : '') }]);
      if (!brainstorm) { if (isBeat) { if (res.beatEdits?.length) onProposeBeatEdits(res); } else { if (res.edits?.length) onProposeEdits(res); } }
    } catch (err) {
      setMessages((m) => [...m, { role: 'ai', text: err instanceof Error ? err.message : 'Assistant failed.' }]);
    } finally {
      setBusy(false);
    }
  };

  // Keep the newest message / thinking indicator in view.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const seededRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (initialMessage && seededRef.current !== initialMessage.idea) {
      seededRef.current = initialMessage.idea;
      void send({ text: initialMessage.idea, mode: initialMessage.mode });
      onInitialConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  return (
    <>
      <div className="dch-head"><span>🤖</span><span style={{ fontSize: 12, fontWeight: 700 }}>Script Assistant</span></div>
      <div className="dch-msgs">
        {messages.length === 0 && <p className="director-tab__empty">Ask about your script, or tell me what to change.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`dch-m dch-m--${m.role === 'user' ? 'user' : 'ai'}`}>{m.text}</div>
        ))}
        {busy && (
          <div className="dch-m dch-m--ai dch-thinking" aria-label="Assistant is thinking">
            <span className="dch-dot" /><span className="dch-dot" /><span className="dch-dot" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="dch-composer">
        {selectedId && <span className="dch-sel">◉ Selected: {(selectedText ?? '').slice(0, 42) || 'element'}</span>}
        <textarea
          value={draft}
          placeholder="Ask about your script, or tell me what to write / change…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        />
        <div className="director-tab__row">
          <span className="director-tab__meta" style={{ marginRight: 'auto' }}>Edits appear as an inline diff in the script.</span>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => void send()} disabled={busy}>{busy ? '…' : 'Send'}</button>
        </div>
      </div>
    </>
  );
}
