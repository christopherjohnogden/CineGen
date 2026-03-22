

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

  const handleChange = useCallback(
    (value: string) => {
      updateNodeData(id, { config: { ...data.config, prompt: value } });
    },
    [id, data.config, updateNodeData],
  );

  return (
    <BaseNode nodeType="prompt" selected={!!selected} isRunning={data.result?.status === 'running'}>
      <MentionTextarea
        value={(data.config?.prompt as string) ?? ''}
        onChange={handleChange}
        placeholder="Describe what to generate..."
        rows={5}
        elements={state.elements}
      />
    </BaseNode>
  );
}

export const PromptNode = memo(PromptNodeInner);
