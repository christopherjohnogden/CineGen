

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import type { WorkflowNodeData } from '@/types/workflow';

type AssetOutputNodeProps = NodeProps & { data: WorkflowNodeData };

function AssetOutputNodeInner({ id, data, selected }: AssetOutputNodeProps) {
  const { updateNodeData } = useReactFlow();
  const name = (data.config?.name as string) ?? 'Untitled';
  const url = data.result?.url;
  const status = data.result?.status;

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { config: { ...data.config, name: e.target.value } });
    },
    [id, data.config, updateNodeData],
  );

  return (
    <BaseNode
      nodeType="assetOutput"
      selected={!!selected}
      isRunning={status === 'running'}
      title="Final Output"
      meta={status === 'running' ? 'Receiving' : url ? 'Ready' : 'Waiting'}
    >
      <div className="asset-output-node__status">
        <span className={`asset-output-node__dot${url ? ' asset-output-node__dot--ready' : ''}`} />
        {url ? 'Asset received' : 'Connect an image or video'}
      </div>
      <label className="cinegen-node__label">Output name</label>
      <input
        type="text"
        className="asset-output-node__name nodrag"
        value={name}
        onChange={handleNameChange}
        style={{ width: '100%' }}
      />

      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="cinegen-node__thumbnail asset-output-node__preview" />
      )}

      <button type="button" className="cinegen-node__send-btn nodrag">
        <span>→</span> Send to Edit
      </button>
    </BaseNode>
  );
}

export const AssetOutputNode = memo(AssetOutputNodeInner);
