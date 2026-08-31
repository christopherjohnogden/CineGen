import type { Edge, Node } from '@xyflow/react';
import { getModelDefinition } from '@/lib/fal/models';
import type { WorkflowNodeData } from '@/types/workflow';
import { normalizeTopviewVideoTask } from './video-task';
import {
  executeFromNode,
  type WorkflowDispatch,
} from '@/lib/workflows/execute';

type ExecuteNode = (
  nodeId: string,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  dispatch: WorkflowDispatch,
) => Promise<void>;

/**
 * Restart query loops for paid Topview video tasks restored from a saved Space.
 * The attempt set is scoped to the mounted canvas so React result updates do
 * not start overlapping pollers for the same remote task.
 */
export function resumePersistedTopviewVideoTasks(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  dispatch: WorkflowDispatch,
  attemptedTaskKeys: Set<string>,
  executeNode: ExecuteNode = executeFromNode,
): Promise<void>[] {
  const recoveries: Promise<void>[] = [];

  for (const node of nodes) {
    const model = getModelDefinition(node.data.type);
    if (model?.provider !== 'topview' || model.outputType !== 'video') continue;
    if (node.data.result?.status !== 'running' && node.data.result?.status !== 'error') continue;

    const task = normalizeTopviewVideoTask(node.data.result.topviewTask);
    if (!task) continue;
    const taskKey = `${node.id}:${task.taskType}:${task.taskId}`;
    if (attemptedTaskKeys.has(taskKey)) continue;

    attemptedTaskKeys.add(taskKey);
    recoveries.push(executeNode(node.id, nodes, edges, dispatch));
  }

  return recoveries;
}
