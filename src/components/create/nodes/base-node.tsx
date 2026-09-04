

import { memo, type CSSProperties, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_REGISTRY, CATEGORY_COLORS, PORT_COLORS } from '@/lib/workflows/node-registry';

interface BaseNodeProps {
  nodeType: string;
  selected: boolean;
  isRunning?: boolean;
  children: ReactNode;
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const HEADER_HEIGHT = 52;
const PORT_SPACING = 24;

const NODE_BADGES: Record<string, string> = {
  prompt: 'TXT',
  multiPrompt: 'SHT',
  shotPrompt: 'SHT',
  element: 'ELM',
  compositionPlan: 'PLN',
  musicPrompt: 'MUS',
  assetOutput: 'OUT',
  shotBoard: 'BRD',
  storyboarder: 'BRD',
  filePicker: 'REF',
  trim: 'CUT',
};

interface NodeHeaderProps {
  nodeType: string;
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function NodeHeader({ nodeType, title, meta, actions }: NodeHeaderProps) {
  const def = NODE_REGISTRY[nodeType];
  if (!def) return null;

  const accentColor = CATEGORY_COLORS[def.category];

  return (
    <div className="cinegen-node__header">
      <span className="cinegen-node__badge" style={{ background: accentColor }}>
        {NODE_BADGES[nodeType] ?? 'NOD'}
      </span>
      <span className="cinegen-node__title">{title ?? def.label}</span>
      {meta && <span className="cinegen-node__meta">{meta}</span>}
      {actions && <div className="cinegen-node__actions nodrag">{actions}</div>}
    </div>
  );
}

function BaseNodeInner({ nodeType, selected, isRunning, children, title, meta, actions, footer, className }: BaseNodeProps) {
  const def = NODE_REGISTRY[nodeType];
  if (!def) return null;

  const accentColor = CATEGORY_COLORS[def.category];

  const cls = [
    'cinegen-node',
    'cinegen-node--semantic',
    `cinegen-node--${nodeType}`,
    className,
    selected && 'cinegen-node--selected',
    isRunning && 'cinegen-node--running',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} style={{ '--node-accent': accentColor } as CSSProperties}>
      <div className="cinegen-node__content">
        <NodeHeader nodeType={nodeType} title={title} meta={meta} actions={actions} />
        <div className="cinegen-node__body">{children}</div>
        {footer && <div className="cinegen-node__footer">{footer}</div>}
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
