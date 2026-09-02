import type { Node } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';

// Studio generations wrap into their own grid instead of marching down forever
// from max(y). The old formula grew the canvas by 340px per generation and, once
// a user dragged anything downward, compounded off that too.
const STUDIO_COLS = 4;
const STUDIO_CELL_W = 380;
const STUDIO_CELL_H = 330;

function isStudioNode(node: Node<WorkflowNodeData>): boolean {
  return Boolean(node.data.config.__studioGenerated);
}

/** Next free cell in the Studio grid, anchored clear of hand-built graph work. */
export function nextStudioSlot(nodes: Node<WorkflowNodeData>[]): { x: number; y: number } {
  const studioNodes = nodes.filter(isStudioNode);
  const authored = nodes.filter((node) => !isStudioNode(node));
  const originX = authored.length
    ? Math.max(...authored.map((node) => node.position.x)) + 520
    : 80;
  const originY = authored.length
    ? Math.min(...authored.map((node) => node.position.y))
    : 80;
  // Keep the grid stable across reloads by counting occupied cells, not by
  // reducing over positions — a dragged node must not move future slots.
  const index = studioNodes.length;
  return {
    x: originX + (index % STUDIO_COLS) * STUDIO_CELL_W,
    y: originY + Math.floor(index / STUDIO_COLS) * STUDIO_CELL_H,
  };
}

