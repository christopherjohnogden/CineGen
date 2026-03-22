

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { WorkflowNodeData } from '@/types/workflow';

type ElementNodeProps = NodeProps & { data: WorkflowNodeData };

function ElementNodeInner({ id, data, selected }: ElementNodeProps) {
  const { updateNodeData } = useReactFlow();
  const { state } = useWorkspace();

  const elementId = (data.config?.elementId as string) ?? '';
  const selectedElement = state.elements.find((el) => el.id === elementId);
  const thumbnail = selectedElement?.images[0]?.url;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateNodeData(id, { config: { ...data.config, elementId: e.target.value } });
    },
    [id, data.config, updateNodeData],
  );

  return (
    <BaseNode nodeType="element" selected={!!selected}>
      <div className="element-node__body">
        <select
          className="element-node__select nodrag nowheel"
          value={elementId}
          onChange={handleChange}
        >
          <option value="">Select element...</option>
          {state.elements.map((el) => (
            <option key={el.id} value={el.id}>
              {el.name} ({el.type})
            </option>
          ))}
        </select>
        {selectedElement && thumbnail && (
          <div className="element-node__preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnail} alt={selectedElement.name} className="element-node__thumbnail" />
            <span className="element-node__info">
              {selectedElement.name} &middot; {selectedElement.images.length} imgs
            </span>
          </div>
        )}
      </div>
    </BaseNode>
  );
}

export const ElementNode = memo(ElementNodeInner);
