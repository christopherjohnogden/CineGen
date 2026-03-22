

import { type Node, useReactFlow } from '@xyflow/react';

const SNAP_THRESHOLD = 5;

interface HelperLineResult {
  horizontal: number | null;
  vertical: number | null;
  snapX: number | undefined;
  snapY: number | undefined;
}

export function getHelperLines(
  draggingNode: Node,
  allNodes: Node[],
): HelperLineResult {
  const nodeW = draggingNode.measured?.width ?? 200;
  const nodeH = draggingNode.measured?.height ?? 100;

  const nodeLeft = draggingNode.position.x;
  const nodeCenterX = nodeLeft + nodeW / 2;
  const nodeRight = nodeLeft + nodeW;

  const nodeTop = draggingNode.position.y;
  const nodeCenterY = nodeTop + nodeH / 2;
  const nodeBottom = nodeTop + nodeH;

  let closestDistX = SNAP_THRESHOLD + 1;
  let closestDistY = SNAP_THRESHOLD + 1;
  let snapX: number | undefined;
  let snapY: number | undefined;
  let verticalLine: number | null = null;
  let horizontalLine: number | null = null;

  const dragPoints = {
    x: [nodeLeft, nodeCenterX, nodeRight],
    y: [nodeTop, nodeCenterY, nodeBottom],
  };

  for (const other of allNodes) {
    if (other.id === draggingNode.id) continue;

    const oW = other.measured?.width ?? 200;
    const oH = other.measured?.height ?? 100;

    const otherPoints = {
      x: [other.position.x, other.position.x + oW / 2, other.position.x + oW],
      y: [other.position.y, other.position.y + oH / 2, other.position.y + oH],
    };

    for (let di = 0; di < 3; di++) {
      for (let oi = 0; oi < 3; oi++) {
        const distX = Math.abs(dragPoints.x[di] - otherPoints.x[oi]);
        if (distX < closestDistX) {
          closestDistX = distX;
          verticalLine = otherPoints.x[oi];
          snapX = draggingNode.position.x + (otherPoints.x[oi] - dragPoints.x[di]);
        }

        const distY = Math.abs(dragPoints.y[di] - otherPoints.y[oi]);
        if (distY < closestDistY) {
          closestDistY = distY;
          horizontalLine = otherPoints.y[oi];
          snapY = draggingNode.position.y + (otherPoints.y[oi] - dragPoints.y[di]);
        }
      }
    }
  }

  if (closestDistX > SNAP_THRESHOLD) { verticalLine = null; snapX = undefined; }
  if (closestDistY > SNAP_THRESHOLD) { horizontalLine = null; snapY = undefined; }

  return { horizontal: horizontalLine, vertical: verticalLine, snapX, snapY };
}

interface HelperLinesProps {
  horizontal: number | null;
  vertical: number | null;
}

export function HelperLines({ horizontal, vertical }: HelperLinesProps) {
  const { getViewport } = useReactFlow();
  const { x: tx, y: ty, zoom } = getViewport();

  if (horizontal === null && vertical === null) return null;

  return (
    <svg className="helper-lines">
      {vertical !== null && (
        <line
          x1={vertical * zoom + tx}
          y1={0}
          x2={vertical * zoom + tx}
          y2="100%"
          className="helper-lines__line"
        />
      )}
      {horizontal !== null && (
        <line
          x1={0}
          y1={horizontal * zoom + ty}
          x2="100%"
          y2={horizontal * zoom + ty}
          className="helper-lines__line"
        />
      )}
    </svg>
  );
}
