

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { MentionTextarea } from './mention-textarea';
import { useNodeConfigDraft } from './use-node-config-draft';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { WorkflowNodeData } from '@/types/workflow';

type PromptNodeProps = NodeProps & { data: WorkflowNodeData };

function PromptNodeInner({ id, data, selected }: PromptNodeProps) {
  const { updateNodeData } = useReactFlow();
  const { state, dispatch } = useWorkspace();
  const [config, editDraft] = useNodeConfigDraft(data.config);
  const prompt = (config.prompt as string) ?? '';
  const wordCount = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;

  const handleChange = useCallback(
    (value: string) => {
      editDraft({ prompt: value });
      updateNodeData(id, node => ({ config: { ...(node.data as WorkflowNodeData).config, prompt: value } }));
    },
    [id, editDraft, updateNodeData],
  );

  const handleMentionInsert = useCallback(
    (element: (typeof state.elements)[number], value: string) => {
      editDraft({ prompt: value });
      dispatch({
        type: 'APPLY_ELEMENT_MENTION',
        nodeId: id,
        elementId: element.id,
        config: { prompt: value },
      });
    },
    [dispatch, id, editDraft],
  );

  return (
    <BaseNode
      nodeType="prompt"
      selected={!!selected}
      isRunning={data.result?.status === 'running'}
      meta={prompt ? `${wordCount} word${wordCount === 1 ? '' : 's'}` : 'Ready'}
      footer={<><span>@ mentions supported</span><span>{prompt.length} chars</span></>}
    >
      <MentionTextarea
        value={prompt}
        onChange={handleChange}
        onMentionInsert={handleMentionInsert}
        placeholder="Describe the shot, movement, light, and feeling..."
        rows={5}
        elements={state.elements}
      />
    </BaseNode>
  );
}

export const PromptNode = memo(PromptNodeInner);
