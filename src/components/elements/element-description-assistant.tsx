import { useEffect, useMemo, useRef, useState } from 'react';
import { DirectorLlmPicker, type DirectorCliInfo } from '@/components/director/director-llm-picker';
import { assistantProviderReady } from '@/lib/assistant/assistant';
import {
  parseDirectorLlmProvider,
  pickInstalledDirectorLlm,
  type DirectorLlmProvider,
} from '@/lib/director/cli-provider';
import { runDirectorTextJob } from '@/lib/director/run-llm';
import {
  isCliCopilotProvider,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';
import {
  cleanElementDescription,
  elementDescriptionStarter,
  elementDescriptionSystemPrompt,
} from '@/lib/elements/description-assistant';
import { getApiKey, getOpenAiApiKey } from '@/lib/utils/api-key';
import type { ElementType } from '@/types/elements';
import '@/styles/director-tab.css';

interface ElementDescriptionAssistantProps {
  name: string;
  type: ElementType;
  description: string;
  onApply: (description: string) => void;
}

interface DescriptionMessage {
  role: 'user' | 'assistant';
  content: string;
  applied?: boolean;
}

const EMPTY_CLI: Record<CliLlmProviderId, DirectorCliInfo> = {
  'claude-code': { id: 'claude-code', installed: false },
  codex: { id: 'codex', installed: false },
  gemini: { id: 'gemini', installed: false },
};

const PROVIDER_STORAGE_KEY = 'cinegen_element_description_llm';

function storedProvider(): DirectorLlmProvider {
  try {
    return parseDirectorLlmProvider(localStorage.getItem(PROVIDER_STORAGE_KEY));
  } catch {
    return 'claude-code';
  }
}

export function ElementDescriptionAssistant({
  name,
  type,
  description,
  onApply,
}: ElementDescriptionAssistantProps) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<DirectorLlmProvider>(storedProvider);
  const [cliProviders, setCliProviders] = useState(EMPTY_CLI);
  const [falReady, setFalReady] = useState(false);
  const [openaiReady, setOpenaiReady] = useState(false);
  const [messages, setMessages] = useState<DescriptionMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const priorTypeRef = useRef(type);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const installed = useMemo(() => ({
    'claude-code': cliProviders['claude-code'].installed,
    codex: cliProviders.codex.installed,
    gemini: cliProviders.gemini.installed,
  }), [cliProviders]);
  const canSend = assistantProviderReady(provider, installed, { falReady, openaiReady });

  useEffect(() => {
    const fal = Boolean(getApiKey());
    const openai = Boolean(getOpenAiApiKey());
    setFalReady(fal);
    setOpenaiReady(openai);
    let cancelled = false;
    void window.electronAPI.llm.cliDetect().then(({ providers }) => {
      if (cancelled) return;
      const next = { ...EMPTY_CLI };
      for (const row of providers) {
        if (isCliCopilotProvider(row.id)) next[row.id] = { id: row.id, installed: row.installed };
      }
      setCliProviders(next);
      setProvider(pickInstalledDirectorLlm(storedProvider(), providers, {
        falReady: fal,
        openaiReady: openai,
      }));
    }).catch(() => {
      if (!cancelled) {
        setProvider(pickInstalledDirectorLlm(storedProvider(), [], {
          falReady: fal,
          openaiReady: openai,
        }));
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
    } catch {
      // Private browsing can reject storage; the assistant still works for this modal.
    }
  }, [provider]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (priorTypeRef.current === type) return;
    priorTypeRef.current = type;
    setMessages([]);
    setDraft('');
    setError('');
  }, [type]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !canSend) return;
    const next: DescriptionMessage[] = [...messagesRef.current, { role: 'user', content: text }];
    messagesRef.current = next;
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError('');
    try {
      const reply = cleanElementDescription(await runDirectorTextJob(
        elementDescriptionSystemPrompt({ type, name, currentDescription: description }),
        text,
        provider,
        next.map(({ role, content }) => ({ role, content })),
      ));
      if (!reply) throw new Error('The selected LLM returned an empty description.');
      const withReply: DescriptionMessage[] = [...next, { role: 'assistant', content: reply }];
      messagesRef.current = withReply;
      setMessages(withReply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The description assistant could not respond.');
    } finally {
      setBusy(false);
    }
  };

  const apply = (index: number, content: string) => {
    onApply(content);
    setMessages((current) => current.map((message, messageIndex) => ({
      ...message,
      applied: messageIndex === index && message.role === 'assistant',
    })));
  };

  return (
    <div className={`element-description-ai${open ? ' element-description-ai--open' : ''}`}>
      <button
        type="button"
        className="element-description-ai__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="element-description-ai__mark" aria-hidden="true">AI</span>
        <span>
          <strong>Write with an LLM</strong>
          <small>Explain the idea naturally, then apply a production-ready description.</small>
        </span>
        <span className="element-description-ai__toggle-action">{open ? 'Close' : 'Open assistant'}</span>
      </button>

      {open && (
        <div className="element-description-ai__panel">
          <div className="element-description-ai__toolbar">
            <div>
              <strong>Description assistant</strong>
              <small>Local or cloud—the choice stays on this device.</small>
            </div>
            <DirectorLlmPicker
              provider={provider}
              providers={cliProviders}
              falReady={falReady}
              openaiReady={openaiReady}
              onChange={setProvider}
              title="LLM used to write this element description"
              menuLabel="Description LLM"
            />
          </div>

          <div className="element-description-ai__messages" aria-live="polite">
            {messages.length === 0 && !busy && (
              <div className="element-description-ai__empty">
                <strong>Describe it in your own words</strong>
                <p>{elementDescriptionStarter(type)}</p>
                {description.trim() && <small>Your current description will be preserved and refined.</small>}
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`element-description-ai__message element-description-ai__message--${message.role}`}>
                <span>{message.role === 'user' ? 'You' : 'Assistant'}</span>
                <p>{message.content}</p>
                {message.role === 'assistant' && (
                  <button
                    type="button"
                    onClick={() => apply(index, message.content)}
                    disabled={message.applied}
                  >
                    {message.applied ? 'Applied to description' : 'Use this description'}
                  </button>
                )}
              </div>
            ))}
            {busy && (
              <div className="element-description-ai__thinking">
                <span /><span /><span />
                <small>Writing a consistent {type} description…</small>
              </div>
            )}
          </div>

          {error && <div className="element-description-ai__error" role="alert">{error}</div>}
          {!canSend && (
            <div className="element-description-ai__notice">
              Pick an installed local CLI, ChatGPT Luna, or a cloud provider connected in Settings.
            </div>
          )}

          <div className="element-description-ai__composer">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={messages.length ? 'Ask for a change…' : `Tell the assistant about this ${type}…`}
              rows={2}
            />
            <button type="button" onClick={() => void send()} disabled={!draft.trim() || busy || !canSend}>
              {busy ? 'Writing' : 'Send'}
            </button>
          </div>
          <div className="element-description-ai__foot">
            <span>Command or Control + Enter to send</span>
            {messages.length > 0 && (
              <button type="button" onClick={() => { setMessages([]); setError(''); }}>New conversation</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
