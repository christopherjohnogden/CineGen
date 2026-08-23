import { useMemo } from 'react';
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
import { AssistantMarkdown } from './assistant-markdown';

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
          <AssistantMarkdown>{body}</AssistantMarkdown>
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
              nodes: state.nodes,
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
