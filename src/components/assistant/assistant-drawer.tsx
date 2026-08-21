import { useEffect, useRef, useState } from 'react';
import type { WorkspaceState } from '@/types/workspace';
import {
  ASSISTANT_SYSTEM,
  assistantProviderReady,
  directorBrief,
  loadAssistantThread,
  pickAssistantProvider,
  saveAssistantThread,
  selectedNodeAssistantContext,
  stampDirectorTags,
  type AssistantMessage,
} from '@/lib/assistant/assistant';
import { AssistantMessageView } from '@/components/assistant/assistant-message';
import { DirectorLlmPicker, type DirectorCliInfo } from '@/components/director/director-llm-picker';
import {
  HIGGSFIELD_LLM_CLI_SUPPORTED,
  type DirectorLlmProvider,
} from '@/lib/director/cli-provider';
import { runDirectorTextJob } from '@/lib/director/run-llm';
import { isCliCopilotProvider, type CliLlmProviderId } from '@/lib/llm/claude-code-session';
import { buildModeSystemPrompt, buildProjectContext } from '@/lib/llm/project-context';
import type { CopilotActionDispatch } from '@/lib/llm/skill-actions';
import { getApiKey, getOpenAiApiKey } from '@/lib/utils/api-key';
import '@/styles/director-tab.css';

interface AssistantDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  state: WorkspaceState;
  dispatch: CopilotActionDispatch;
}

const EMPTY_CLI: Record<CliLlmProviderId, DirectorCliInfo> = {
  'claude-code': { id: 'claude-code', installed: false },
  codex: { id: 'codex', installed: false },
  gemini: { id: 'gemini', installed: false },
};

export function AssistantDrawer({ open, onClose, projectId, state, dispatch }: AssistantDrawerProps) {
  const [provider, setProvider] = useState<DirectorLlmProvider>('claude-code');
  const [cliProviders, setCliProviders] = useState(EMPTY_CLI);
  const [falReady, setFalReady] = useState(false);
  const [openaiReady, setOpenaiReady] = useState(false);
  const [higgsfieldReady, setHiggsfieldReady] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const installed = {
    'claude-code': cliProviders['claude-code'].installed,
    codex: cliProviders.codex.installed,
    gemini: cliProviders.gemini.installed,
  };
  const canSend = assistantProviderReady(provider, installed, { falReady, openaiReady, higgsfieldReady });
  const selectedNode = state.activeTab === 'create'
    ? state.nodes.find((node) => node.selected && node.type !== 'group') ?? null
    : null;
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId) ?? null;
  const nodeReferenceContext = selectedNodeAssistantContext(selectedNode, activeSpace);

  useEffect(() => {
    if (!open) {
      setHydrated(false);
      return;
    }
    const stored = loadAssistantThread(projectId);
    if (stored) {
      setMessages(stored.messages);
      setProvider(stored.provider);
    } else {
      setMessages([]);
    }
    const fal = Boolean(getApiKey());
    const openai = Boolean(getOpenAiApiKey());
    setFalReady(fal);
    setOpenaiReady(openai);
    let cancelled = false;
    window.electronAPI.llm.cliDetect().then(({ providers }) => {
      if (cancelled) return;
      const next = { ...EMPTY_CLI };
      for (const row of providers) {
        if (isCliCopilotProvider(row.id)) next[row.id] = { id: row.id, installed: row.installed };
      }
      setCliProviders(next);
      setProvider(pickAssistantProvider(stored?.provider, providers, {
        falReady: fal,
        openaiReady: openai,
        higgsfieldReady: HIGGSFIELD_LLM_CLI_SUPPORTED,
      }));
    }).catch(() => {});
    window.electronAPI.higgsfield.accountStatus().then((status) => {
      if (!cancelled) setHiggsfieldReady(Boolean(status.connected) && HIGGSFIELD_LLM_CLI_SUPPORTED);
    }).catch(() => {});
    setHydrated(true);
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !hydrated) return;
    saveAssistantThread(projectId, { provider, messages });
  }, [open, hydrated, projectId, provider, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if ((event.target as HTMLElement | null)?.closest?.('.dllm')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !canSend) return;
    setDraft('');
    const next = [...messagesRef.current, { role: 'user' as const, content: text }];
    messagesRef.current = next;
    setMessages(next);
    setBusy(true);
    try {
      const projectContext = buildProjectContext({
        projectId,
        assets: state.assets,
        mediaFolders: state.mediaFolders,
        timelines: state.timelines,
        activeTimelineId: state.activeTimelineId,
        elements: state.elements,
        spaces: state.spaces,
        activeSpaceId: state.activeSpaceId,
        mode: 'ask',
        focusQuery: text,
        compact: provider === 'gemini' || provider === 'fal',
      });
      const systemPrompt = [
        ASSISTANT_SYSTEM,
        buildModeSystemPrompt('ask'),
        directorBrief(state.director),
        projectContext,
        nodeReferenceContext || null,
      ].filter((section): section is string => Boolean(section)).join('\n\n');
      const reply = stampDirectorTags(
        (await runDirectorTextJob(systemPrompt, text, provider, next)).trim() || 'No reply.',
        state.director,
      );
      const withReply = [...messagesRef.current, { role: 'assistant' as const, content: reply }];
      messagesRef.current = withReply;
      setMessages(withReply);
    } catch (error) {
      const fail = error instanceof Error ? error.message : 'Assistant failed.';
      const withFail = [...messagesRef.current, { role: 'assistant' as const, content: fail }];
      messagesRef.current = withFail;
      setMessages(withFail);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="asst" role="dialog" aria-label="CineGen Assistant">
      <aside className="asst-panel">
        <header className="asst-head">
          <span className="asst-title">Assistant</span>
          <DirectorLlmPicker
            provider={provider}
            providers={cliProviders}
            falReady={falReady}
            openaiReady={openaiReady}
            higgsfieldReady={higgsfieldReady}
            onChange={setProvider}
            title="Model for this assistant"
            menuLabel="Director LLM"
          />
          <button type="button" className="asst-iconbtn" onClick={() => setMessages([])} title="New chat">New</button>
          <button type="button" className="asst-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="asst-msgs">
          {messages.length === 0 && !busy && (
            <div className="asst-empty">
              <p className="asst-empty__title">Ask or assign a task</p>
              <p className="asst-empty__sub">Questions about this project, shot notes, coverage, or what to do next. Same LLM list as Director.</p>
            </div>
          )}
          {messages.map((row, index) => (
            <AssistantMessageView
              key={`${row.role}-${index}`}
              message={row}
              priorUser={row.role === 'assistant'
                ? [...messages.slice(0, index)].reverse().find((entry) => entry.role === 'user')?.content
                : undefined}
              state={state}
              dispatch={dispatch}
              onApplied={() => setMessages((current) => current.map((entry, i) => (
                i === index ? { ...entry, applied: true } : entry
              )))}
            />
          ))}
          {busy && (
            <div className="asst-m asst-m--assistant asst-thinking" aria-label="Assistant is thinking">
              <span /><span /><span />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="asst-composer">
          {selectedNode && (
            <div className="asst-node-ref" aria-live="polite">
              <span className="asst-node-ref__icon" aria-hidden="true">◇</span>
              <span className="asst-node-ref__body">
                <span className="asst-node-ref__eyebrow">Referenced node</span>
                <span className="asst-node-ref__name">{selectedNode.data.label}</span>
              </span>
              <span className="asst-node-ref__type">{selectedNode.data.type}</span>
            </div>
          )}
          {!canSend && (
            <p className="asst-hint">Pick an installed CLI, or add a fal.ai / OpenAI key in Settings.</p>
          )}
          <div className="asst-inputbox">
            <textarea
              ref={inputRef}
              value={draft}
              placeholder={selectedNode
                ? `Ask me to change ${selectedNode.data.label}…`
                : 'Ask a question or tell me what to do…'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button type="button" className="asst-send" onClick={() => void send()} disabled={busy || !draft.trim() || !canSend}>
              {busy ? '…' : '↑'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
