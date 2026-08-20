import { useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  assistantActionRunnable,
  visibleAssistantContent,
  type AssistantMessage,
} from '@/lib/assistant/assistant';
import {
  describeSkillAction,
  executeSkillAction,
  resolveSkillActionForMessage,
  type CopilotActionDispatch,
} from '@/lib/llm/skill-actions';
import type { WorkspaceState } from '@/types/workspace';

const MD = {
  p: ({ children }: { children?: ReactNode }) => <p className="copilot__md-p">{children}</p>,
  strong: ({ children }: { children?: ReactNode }) => <strong className="copilot__md-strong">{children}</strong>,
  em: ({ children }: { children?: ReactNode }) => <em className="copilot__md-em">{children}</em>,
  h1: ({ children }: { children?: ReactNode }) => <h3 className="copilot__md-h">{children}</h3>,
  h2: ({ children }: { children?: ReactNode }) => <h3 className="copilot__md-h">{children}</h3>,
  h3: ({ children }: { children?: ReactNode }) => <h3 className="copilot__md-h">{children}</h3>,
  h4: ({ children }: { children?: ReactNode }) => <h4 className="copilot__md-h copilot__md-h--sm">{children}</h4>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="copilot__md-ul">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="copilot__md-ol">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="copilot__md-li">{children}</li>,
  hr: () => <hr className="copilot__md-hr" />,
  blockquote: ({ children }: { children?: ReactNode }) => <blockquote className="copilot__md-blockquote">{children}</blockquote>,
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    if (className?.startsWith('language-')) {
      return <pre className="copilot__md-pre"><code>{children}</code></pre>;
    }
    return <code className="copilot__md-code">{children}</code>;
  },
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
};

interface AssistantMessageViewProps {
  message: AssistantMessage;
  priorUser?: string;
  state: WorkspaceState;
  dispatch: CopilotActionDispatch;
  onApplied: () => void;
}

export function AssistantMessageView({
  message, priorUser, state, dispatch, onApplied,
}: AssistantMessageViewProps) {
  const action = useMemo(() => {
    if (message.role !== 'assistant') return null;
    const parsed = resolveSkillActionForMessage(message.content, {
      activeSpaceName: state.spaces.find((space) => space.id === state.activeSpaceId)?.name ?? null,
      userMessage: priorUser ?? null,
    });
    return parsed && assistantActionRunnable(parsed) ? parsed : null;
  }, [message, priorUser, state.activeSpaceId, state.spaces]);

  if (message.role === 'user') {
    return <div className="asst-m asst-m--user">{message.content}</div>;
  }

  const body = visibleAssistantContent(message.content);

  return (
    <div className="asst-turn">
      {body ? (
        <div className="asst-m asst-m--assistant">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{body}</ReactMarkdown>
        </div>
      ) : null}
      {action && !message.applied && (
        <div className="asst-action">
          <div>
            <div className="asst-action__title">
              {action.steps.some((step) => step.type === 'add_nodes') ? 'Ready to add' : 'Ready to apply'}
            </div>
            <div className="asst-action__desc">{describeSkillAction(action, {
              spaces: state.spaces,
              activeSpaceId: state.activeSpaceId,
              timelines: state.timelines,
              activeTimelineId: state.activeTimelineId,
            })}</div>
          </div>
          <button
            type="button"
            className="copilot__btn copilot__btn--accent"
            onClick={() => {
              executeSkillAction(action, dispatch, {
                elements: state.elements,
                spaces: state.spaces,
                activeSpaceId: state.activeSpaceId,
                nodes: state.nodes,
                edges: state.edges,
                timelines: state.timelines,
                activeTimelineId: state.activeTimelineId,
                assets: state.assets,
                director: state.director,
              });
              onApplied();
            }}
          >
            {action.label}
          </button>
        </div>
      )}
      {message.applied && (
        <div className="asst-action asst-action--done">Applied.</div>
      )}
    </div>
  );
}
