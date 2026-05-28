import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getSkillAuthoringBackendLabel,
  resolveSkillAuthoringBackend,
  sendSkillAuthoringTurn,
  type ParsedSkillDraft,
  type SkillAuthoringBackend,
  type SkillAuthoringMessage,
} from '@/lib/llm/skill-authoring';
import {
  getDefaultModelForCliProvider,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';
import type { CliLlmSessionState } from '@/lib/llm/claude-code-session';

type LLMMode = 'cloud' | 'local' | CliLlmProviderId;

interface CliProviderInfo {
  id: CliLlmProviderId;
  installed: boolean;
}

interface SkillAuthoringPanelProps {
  seedPrompt?: string;
  mode: LLMMode;
  model: string;
  localModel: string;
  falKey?: string;
  cliProviders: Record<CliLlmProviderId, CliProviderInfo>;
  cliSession: CliLlmSessionState;
  onDraftReady?: (draft: ParsedSkillDraft) => void;
  onCancel?: () => void;
  showSaveButton?: boolean;
  onSave?: (draft: ParsedSkillDraft) => void;
  compact?: boolean;
}

export function SkillAuthoringPanel({
  seedPrompt = '',
  mode,
  model,
  localModel,
  falKey,
  cliProviders,
  cliSession,
  onDraftReady,
  onCancel,
  showSaveButton = false,
  onSave,
  compact = false,
}: SkillAuthoringPanelProps) {
  const [messages, setMessages] = useState<SkillAuthoringMessage[]>([]);
  const [draft, setDraft] = useState<ParsedSkillDraft | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [cliAuthoringSessionId, setCliAuthoringSessionId] = useState<string | null>(null);
  const startedRef = useRef(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const backend = useMemo(
    () => resolveSkillAuthoringBackend({
      mode,
      cliProviders,
      model,
      localModel,
      falKey,
      cliSession: cliAuthoringSessionId
        ? { provider: cliSession.provider, model: cliSession.model, sessionId: cliAuthoringSessionId }
        : cliSession,
    }),
    [cliAuthoringSessionId, cliProviders, cliSession, falKey, localModel, mode, model],
  );

  const backendLabel = backend ? getSkillAuthoringBackendLabel(backend) : null;

  const runTurn = useCallback(async (userMessage: string, history: SkillAuthoringMessage[]) => {
    if (!backend) {
      setError('Install a CLI, add a fal.ai API key, or select a local model to build skills with AI.');
      return;
    }

    setError('');
    setIsSending(true);

    const requestId = crypto.randomUUID();
    let streamed = '';

    try {
      const resolvedBackend: SkillAuthoringBackend = backend.kind === 'cli'
        ? {
            ...backend,
            resumeSessionId: cliAuthoringSessionId,
            model: cliSession.provider === backend.provider ? cliSession.model : getDefaultModelForCliProvider(backend.provider),
          }
        : backend;

      setMessages([...history, { role: 'user', content: userMessage }, { role: 'assistant', content: '' }]);

      const result = await sendSkillAuthoringTurn({
        backend: resolvedBackend,
        history,
        userMessage,
        requestId,
        onToken: (token) => {
          streamed += token;
          setMessages((current) => {
            const last = current[current.length - 1];
            if (!last || last.role !== 'assistant') return current;
            return [...current.slice(0, -1), { ...last, content: streamed }];
          });
        },
      });

      if (result.sessionId) setCliAuthoringSessionId(result.sessionId);

      setMessages((current) => {
        const last = current[current.length - 1];
        if (!last || last.role !== 'assistant') return current;
        return [...current.slice(0, -1), { ...last, content: result.displayMessage }];
      });

      if (result.draft) {
        setDraft(result.draft);
        onDraftReady?.(result.draft);
      }
    } catch (turnError) {
      const message = turnError instanceof Error ? turnError.message : 'Failed to reach the skill builder assistant.';
      setError(message);
      setMessages((current) => current.filter((_, index) => index < current.length - 1 || current[index]?.role !== 'assistant' || current[index]?.content));
    } finally {
      setIsSending(false);
    }
  }, [backend, cliAuthoringSessionId, cliSession.model, cliSession.provider, onDraftReady]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const initial = seedPrompt.trim()
      || 'Help me create a new Copilot skill. Ask me what you need to know.';
    void runTurn(initial, []);
  }, [runTurn, seedPrompt]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, isSending]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || isSending) return;
    setInput('');
    await runTurn(content, messages.filter((message) => message.content.trim()));
  }, [input, isSending, messages, runTurn]);

  return (
    <div className={`copilot__skill-author${compact ? ' copilot__skill-author--compact' : ''}`}>
      <div className="copilot__skill-author-head">
        <div>
          <span className="copilot__skill-author-title">AI Skill Builder</span>
          {backendLabel && <span className="copilot__skill-author-backend">via {backendLabel}</span>}
        </div>
        {onCancel && (
          <button type="button" className="copilot__btn copilot__btn--ghost copilot__btn--sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <div className="copilot__skill-author-thread" ref={threadRef}>
        {messages.map((message, index) => (
          <div
            key={`${index}-${message.role}`}
            className={`copilot__skill-author-msg copilot__skill-author-msg--${message.role}`}
          >
            {message.content || (isSending && index === messages.length - 1 ? 'Thinking…' : '')}
          </div>
        ))}
      </div>

      {draft && (
        <div className="copilot__skill-author-draft">
          <div className="copilot__skill-author-draft-head">
            <span className="copilot__skill-author-draft-title">Draft ready: {draft.name}</span>
            {showSaveButton && onSave && (
              <button type="button" className="copilot__btn copilot__btn--accent copilot__btn--sm" onClick={() => onSave(draft)}>
                Save skill
              </button>
            )}
          </div>
          <p className="copilot__skill-author-draft-desc">{draft.description}</p>
        </div>
      )}

      {error && <div className="copilot__alert copilot__alert--error copilot__alert--inline">{error}</div>}

      <div className="copilot__skill-author-composer">
        <textarea
          className="copilot__skill-author-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Answer or describe the skill you want…"
          disabled={isSending}
          rows={2}
        />
        <button
          type="button"
          className="copilot__btn copilot__btn--accent"
          onClick={() => void handleSend()}
          disabled={!input.trim() || isSending}
        >
          Send
        </button>
      </div>
    </div>
  );
}
