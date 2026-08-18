import { useState } from 'react';
import type { CliLlmProviderId } from '@/lib/llm/claude-code-session';
import { invokeCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import type { Screenplay } from '@/lib/director/screenplay';
import {
  SCRIPT_ASSISTANT_SYSTEM_PROMPT, buildAssistantMessage, parseAssistantResponse, type AssistantResponse,
} from '@/lib/director/script-assistant';

interface DirectorScriptChatProps {
  doc: Screenplay;
  provider: CliLlmProviderId;
  selectedId?: string;
  selectedText?: string;
  onProposeEdits: (res: AssistantResponse) => void;
}

interface ChatMsg { role: 'user' | 'ai'; text: string }

export function DirectorScriptChat({ doc, provider, selectedId, selectedText, onProposeEdits }: DirectorScriptChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const message = buildAssistantMessage(doc, text, selectedId ? { elementId: selectedId } : undefined);
      const result = await invokeCliCopilotChat(provider, {
        systemPrompt: SCRIPT_ASSISTANT_SYSTEM_PROMPT,
        userMessage: message,
        purpose: 'copilot',
      });
      const res = parseAssistantResponse(result.message);
      setMessages((m) => [...m, { role: 'ai', text: res.reply + (res.edits ? `\n(proposed ${res.edits.length} edit${res.edits.length === 1 ? '' : 's'})` : '') }]);
      if (res.edits?.length) onProposeEdits(res);
    } catch (err) {
      setMessages((m) => [...m, { role: 'ai', text: err instanceof Error ? err.message : 'Assistant failed.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dch-head"><span>🤖</span><span style={{ fontSize: 12, fontWeight: 700 }}>Script Assistant</span></div>
      <div className="dch-msgs">
        {messages.length === 0 && <p className="director-tab__empty">Ask about your script, or tell me what to change.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`dch-m dch-m--${m.role === 'user' ? 'user' : 'ai'}`}>{m.text}</div>
        ))}
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
