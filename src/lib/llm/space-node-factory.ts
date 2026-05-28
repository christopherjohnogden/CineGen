import type { Node } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';
import type { WorkflowSpace } from '@/types/workspace';
import { getModelDefinition } from '@/lib/fal/models';
import { generateId } from '@/lib/utils/ids';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';

export interface CopilotNodeSpec {
  nodeType: string;
  label?: string;
  config?: Record<string, unknown>;
  position?: { x?: number; y?: number };
}

export interface CopilotWireSpec {
  from: number;
  to: number;
  sourceHandle: string;
  targetHandle: string;
}

const DEFAULT_PROMPT_X = 280;
const ROW_HEIGHT = 280;

export function resolveSpaceTarget(
  ref: string | undefined,
  spaces: WorkflowSpace[],
  activeSpaceId: string,
): { spaceId: string; space: WorkflowSpace } | null {
  if (spaces.length === 0) return null;

  const normalized = ref?.trim().toLowerCase();
  if (!normalized || normalized === 'active') {
    const space = spaces.find((entry) => entry.id === activeSpaceId) ?? spaces[0];
    return space ? { spaceId: space.id, space } : null;
  }

  const byId = spaces.find((entry) => entry.id === ref);
  if (byId) return { spaceId: byId.id, space: byId };

  const byExactName = spaces.find((entry) => entry.name.toLowerCase() === normalized);
  if (byExactName) return { spaceId: byExactName.id, space: byExactName };

  const byPartialName = spaces.find((entry) => entry.name.toLowerCase().includes(normalized));
  if (byPartialName) return { spaceId: byPartialName.id, space: byPartialName };

  return null;
}

function computeAppendPosition(existingNodes: Node<WorkflowNodeData>[], index: number): { x: number; y: number } {
  const maxY = existingNodes.reduce((max, node) => Math.max(max, node.position.y), 80);
  const baseY = existingNodes.length === 0 ? 80 : maxY + ROW_HEIGHT;
  return {
    x: DEFAULT_PROMPT_X + (index % 2) * 48,
    y: baseY + index * 24,
  };
}

export function createWorkflowNodeFromSpec(
  spec: CopilotNodeSpec,
  position: { x: number; y: number },
): Node<WorkflowNodeData> {
  const definition = NODE_REGISTRY[spec.nodeType];
  if (!definition) {
    throw new Error(`Unknown node type: ${spec.nodeType}`);
  }

  const modelDef = getModelDefinition(spec.nodeType);
  const config = {
    ...definition.defaultData,
    ...(spec.config ?? {}),
  };

  return {
    id: generateId(),
    type: spec.nodeType,
    position,
    data: {
      type: spec.nodeType,
      label: spec.label ?? definition.label,
      config,
      ...(modelDef ? { modelId: modelDef.id } : {}),
    },
  };
}

export function buildNodesFromSpecs(
  specs: CopilotNodeSpec[],
  existingNodes: Node<WorkflowNodeData>[],
): Node<WorkflowNodeData>[] {
  return specs.map((spec, index) => {
    const position = {
      x: spec.position?.x ?? computeAppendPosition(existingNodes, index).x,
      y: spec.position?.y ?? computeAppendPosition(existingNodes, index).y,
    };
    return createWorkflowNodeFromSpec(spec, position);
  });
}
