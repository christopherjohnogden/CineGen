

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { MentionTextarea } from './mention-textarea';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { WorkflowNodeData } from '@/types/workflow';

type PromptNodeProps = NodeProps & { data: WorkflowNodeData };

function PromptNodeInner({ id, data, selected }: PromptNodeProps) {
  const { updateNodeData } = useReactFlow();
  const { state } = useWorkspace();
  const prompt = (data.config?.prompt as string) ?? '';
  const wordCount = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;

  const handleChange = useCallback(
    (value: string) => {
      updateNodeData(id, { config: { ...data.config, prompt: value } });
    },
    [id, data.config, updateNodeData],
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
        placeholder="Describe the shot, movement, light, and feeling..."
        rows={5}
        elements={state.elements}
      />
    </BaseNode>
  );
}

export const PromptNode = memo(PromptNodeInner);
