

import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { PORT_COLORS } from '@/lib/workflows/node-registry';
import type { PortType } from '@/types/workflow';

interface AnimatedEdgeData {
  sourcePortType?: PortType;
  isGenerating?: boolean;
  [key: string]: unknown;
}

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const edgeData = data as AnimatedEdgeData | undefined;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const portType = edgeData?.sourcePortType ?? 'text';
  const isGenerating = edgeData?.isGenerating ?? false;
  const color = PORT_COLORS[portType] ?? 'var(--port-text)';

  let className = 'cinegen-edge';
  if (selected) className += ' ne-edge-selected';
  if (isGenerating) className += ' ne-edge-generating';

  return (
    <g className={className}>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? 3 : 2,
          opacity: isGenerating ? 1 : 0.6,
        }}
      />
    </g>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);

export const edgeTypes = {
  animated: AnimatedEdge,
};
