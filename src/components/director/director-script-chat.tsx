import { useEffect, useRef, useState } from 'react';
import type { CliLlmProviderId } from '@/lib/llm/claude-code-session';
import { invokeCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import type { Screenplay } from '@/lib/director/screenplay';
import type { DirectorChatMessage } from '@/types/director';
import {
  SCRIPT_ASSISTANT_SYSTEM_PROMPT, BEATSHEET_ASSISTANT_SYSTEM_PROMPT,
  buildAssistantMessage, buildBeatsheetMessage, parseAssistantResponse,
  needsJsonRetry, JSON_REPAIR_INSTRUCTION, type AssistantResponse,
} from '@/lib/director/script-assistant';
import { quotePreview, type ScriptQuote } from '@/lib/director/script-selection';

interface DirectorScriptChatProps {
  doc: Screenplay;
  provider: CliLlmProviderId;
  selectedId?: string;
  selectedText?: string;
  quote?: ScriptQuote;
  onClearQuote?: () => void;
  onProposeEdits: (res: AssistantResponse) => void;
  docKind: 'screenplay' | 'beatsheet';
  beatSheet?: import('@/lib/director/beatsheet').BeatSheet;
  onProposeBeatEdits: (res: import('@/lib/director/script-assistant').AssistantResponse) => void;
  initialMessage?: { idea: string; mode: 'draft' | 'brainstorm' };
  onInitialConsumed?: () => void;
  /** Persisted chat thread, owned by the parent (stored on the show) so it survives the
   *  panel unmounting and app refreshes. */
  messages: DirectorChatMessage[];
  onMessagesChange: (messages: DirectorChatMessage[]) => void;
}

export function DirectorScriptChat({ doc, provider, selectedId, selectedText, quote, onClearQuote, onProposeEdits, docKind, beatSheet, onProposeBeatEdits, initialMessage, onInitialConsumed, messages, onMessagesChange }: DirectorScriptChatProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // A ref mirror of the latest thread so an in-flight send() appends onto the freshest
  // array even though `messages` is a prop (no functional-updater form available).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const appendMessage = (m: DirectorChatMessage) => {
    const next = [...messagesRef.current, m];
    messagesRef.current = next;
    onMessagesChange(next);
  };

  const send = async (override?: { text: string; mode?: 'draft' | 'brainstorm' }) => {
    const text = (override?.text ?? draft).trim();
    if (!text || busy) return;
    setDraft('');
    appendMessage({ role: 'user', text });
    setBusy(true);
    try {
      const isBeat = docKind === 'beatsheet';
      const brainstorm = override?.mode === 'brainstorm';
      const systemPrompt = isBeat ? BEATSHEET_ASSISTANT_SYSTEM_PROMPT : SCRIPT_ASSISTANT_SYSTEM_PROMPT;
      // In brainstorm mode, nudge the model to converse only (no edits/beatEdits this turn).
      const userMessage = (isBeat
        ? buildBeatsheetMessage(beatSheet ?? { beats: [] }, text, selectedId ? { beatId: selectedId } : undefined)
        : buildAssistantMessage(doc, text, quote?.text
          ? { quote: quote.text, elementIds: quote.elementIds }
          : selectedId ? { elementId: selectedId } : undefined))
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
      appendMessage({ role: 'ai', text: res.reply + (count ? `\n(proposed ${count} change${count === 1 ? '' : 's'})` : '') });
      if (!brainstorm) { if (isBeat) { if (res.beatEdits?.length) onProposeBeatEdits(res); } else { if (res.edits?.length) onProposeEdits(res); } }
    } catch (err) {
      appendMessage({ role: 'ai', text: err instanceof Error ? err.message : 'Assistant failed.' });
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

  const isBeatKind = docKind === 'beatsheet';
  return (
    <div className="dch">
      <div className="dch-head">
        <span className="dch-avatar" aria-hidden="true">🤖</span>
        <span className="dch-title">Script Assistant</span>
        <span className={`dch-status${busy ? ' dch-status--busy' : ''}`}>{busy ? 'Thinking…' : 'Ready'}</span>
      </div>
      <div className="dch-msgs">
        {messages.length === 0 && !busy && (
          <div className="dch-empty">
            <div className="dch-empty__icon" aria-hidden="true">✨</div>
            <p className="dch-empty__title">Ask about your {isBeatKind ? 'beat sheet' : 'script'}</p>
            <p className="dch-empty__sub">Ask a question, or tell me what to write or change — edits show up as an inline diff you can accept or decline.</p>
          </div>
        )}
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
        {quote?.text ? (
          <span className="dch-sel">
            <span className="dch-sel-text">{chipLabel(quote)}</span>
            <button type="button" className="dch-sel-x" onClick={onClearQuote} title="Clear selection" aria-label="Clear selection">✕</button>
          </span>
        ) : selectedId ? (
          <span className="dch-sel">◉ Selected: {(selectedText ?? '').slice(0, 42) || 'element'}</span>
        ) : null}
        <div className="dch-inputbox">
          <textarea
            value={draft}
            placeholder={`Ask about your ${isBeatKind ? 'beat sheet' : 'script'}, or tell me what to write / change…`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
          />
          <button
            type="button"
            className="dch-send"
            onClick={() => void send()}
            disabled={busy || !draft.trim()}
            title="Send (⌘↵)"
            aria-label="Send"
          >{busy ? '…' : '↑'}</button>
        </div>
        <span className="dch-hint">Drag across lines or ⌘-click to add · ⌘↵ to send</span>
      </div>
    </div>
  );
}

function chipLabel(quote: ScriptQuote): string {
  const n = quote.elementIds.length;
  if (n > 1) return `Selected · ${n} lines: ${quotePreview(quote.text, 48)}`;
  return `Selected: ${quotePreview(quote.text)}`;
}
