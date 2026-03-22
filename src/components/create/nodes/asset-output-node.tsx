

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import type { WorkflowNodeData } from '@/types/workflow';

type AssetOutputNodeProps = NodeProps & { data: WorkflowNodeData };

function AssetOutputNodeInner({ id, data, selected }: AssetOutputNodeProps) {
  const { updateNodeData } = useReactFlow();
  const name = (data.config?.name as string) ?? 'Untitled';
  const url = data.result?.url;

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { config: { ...data.config, name: e.target.value } });
    },
    [id, data.config, updateNodeData],
  );

  return (
    <BaseNode nodeType="assetOutput" selected={!!selected} isRunning={data.result?.status === 'running'}>
      <label className="cinegen-node__label">Asset Name</label>
      <input
        type="text"
        className="nodrag"
        value={name}
        onChange={handleNameChange}
        style={{ width: '100%' }}
      />

      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="cinegen-node__thumbnail" />
      )}

      <button type="button" className="cinegen-node__send-btn nodrag">
        Send to Edit
      </button>
    </BaseNode>
  );
}

export const AssetOutputNode = memo(AssetOutputNodeInner);
