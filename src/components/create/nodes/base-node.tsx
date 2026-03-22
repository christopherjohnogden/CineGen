

import { memo, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_REGISTRY, CATEGORY_COLORS, PORT_COLORS } from '@/lib/workflows/node-registry';

interface BaseNodeProps {
  nodeType: string;
  selected: boolean;
  isRunning?: boolean;
  children: ReactNode;
}

const HEADER_HEIGHT = 36;
const PORT_SPACING = 24;

function BaseNodeInner({ nodeType, selected, isRunning, children }: BaseNodeProps) {
  const def = NODE_REGISTRY[nodeType];
  if (!def) return null;

  const accentColor = CATEGORY_COLORS[def.category];

  const cls = [
    'cinegen-node',
    selected && 'cinegen-node--selected',
    isRunning && 'cinegen-node--running',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <div className="cinegen-node__accent" style={{ background: accentColor }} />
      <div className="cinegen-node__content">
        <div className="cinegen-node__header">{def.label}</div>
        <div className="cinegen-node__body">{children}</div>
      </div>

      {def.inputs.map((port, i) => (
        <Handle
          key={`in-${port.id}`}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            background: PORT_COLORS[port.type],
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid var(--bg-raised)',
            top: HEADER_HEIGHT + PORT_SPACING * i + PORT_SPACING / 2,
          }}
        />
      ))}

      {def.outputs.map((port, i) => (
        <Handle
          key={`out-${port.id}`}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{
            background: PORT_COLORS[port.type],
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid var(--bg-raised)',
            top: HEADER_HEIGHT + PORT_SPACING * i + PORT_SPACING / 2,
          }}
        />
      ))}

      {def.inputs.map((port, i) => (
        <span
          key={`label-in-${port.id}`}
          className="base-node__port-label base-node__port-label--left"
          style={{ top: HEADER_HEIGHT + PORT_SPACING * i + PORT_SPACING / 2 }}
        >
          {port.label}
        </span>
      ))}

      {def.outputs.map((port, i) => (
        <span
          key={`label-out-${port.id}`}
          className="base-node__port-label base-node__port-label--right"
          style={{ top: HEADER_HEIGHT + PORT_SPACING * i + PORT_SPACING / 2 }}
        >
          {port.label}
        </span>
      ))}
    </div>
  );
}

export const BaseNode = memo(BaseNodeInner);
