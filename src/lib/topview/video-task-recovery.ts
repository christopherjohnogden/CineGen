import type { Edge, Node } from '@xyflow/react';
import { getModelDefinition } from '@/lib/fal/models';
import type { WorkflowNodeData } from '@/types/workflow';
import { elementImagesForVariation } from '@/lib/elements/variations';
import {
  resolveElementNodeIds,
  resolveElementNodeVariationIds,
} from '@/lib/workflows/node-registry';
import { topviewRequestedModel } from './model-catalog';
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

type LegacyRecoveryCriteria = {
  projectId: string;
  nodeId: string;
  prompt: string;
  model: string;
  durationSec: number;
  resolution: string;
  aspectRatio: string;
  generateAudio: boolean;
  expectedReferenceCount: number;
};

function fieldValue(model: NonNullable<ReturnType<typeof getModelDefinition>>, data: WorkflowNodeData, id: string): unknown {
  const field = model.inputs.find((input) => input.id === id);
  return data.config[id] ?? field?.default;
}

function sourceValue(node: Node<WorkflowNodeData>, dispatch: WorkflowDispatch): unknown {
  if (node.data.type === 'prompt') return node.data.config.prompt;
  if (node.data.type === 'musicPrompt') return node.data.config.generatedPrompt;
  if (node.data.type === 'filePicker') return node.data.config.fileUrl;
  if (node.data.type !== 'element') return node.data.result?.url ?? node.data.result?.text;

  const variationIds = resolveElementNodeVariationIds(node.data.config);
  return resolveElementNodeIds(node.data.config).flatMap((elementId) => {
    const element = dispatch.getElements().find((candidate) => candidate.id === elementId);
    return element
      ? elementImagesForVariation(element, variationIds[elementId]).map((image) => image.url)
      : [];
  });
}

function stringUrls(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(stringUrls);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return stringUrls(record.allUrls ?? record.url ?? record.value ?? record.frontalImageUrl);
}

function incomingValues(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  nodeId: string,
  handle: string,
  dispatch: WorkflowDispatch,
): unknown[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .filter((edge) => edge.target === nodeId && edge.targetHandle === handle)
    .flatMap((edge) => {
      const source = nodeMap.get(edge.source);
      return source ? [sourceValue(source, dispatch)] : [];
    });
}

function legacyRecoveryCriteria(
  projectId: string,
  node: Node<WorkflowNodeData>,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  dispatch: WorkflowDispatch,
): LegacyRecoveryCriteria | null {
  const model = getModelDefinition(node.data.type);
  if (!model || model.provider !== 'topview' || model.outputType !== 'video') return null;

  const promptInput = incomingValues(nodes, edges, node.id, 'prompt', dispatch)[0];
  const prompt = String(promptInput ?? fieldValue(model, node.data, 'prompt') ?? '').trim();
  const requestedModel = topviewRequestedModel(model, node.data.config.model);
  const durationSec = Number(fieldValue(model, node.data, 'duration'));
  const resolution = String(fieldValue(model, node.data, 'resolution') ?? '').trim();
  const aspectRatio = String(fieldValue(model, node.data, 'aspect_ratio') ?? '').trim();
  const generateAudio = Boolean(fieldValue(model, node.data, 'generate_audio'));
  if (
    !prompt
    || !requestedModel
    || requestedModel.toLowerCase() === 'auto'
    || !Number.isFinite(durationSec)
    || durationSec <= 0
    || !resolution
    || !aspectRatio
  ) return null;

  const references = new Set<string>();
  for (const field of model.inputs.filter((input) => input.mediaRole === 'image')) {
    const handles = field.fieldType === 'element-list'
      ? edges
        .filter((edge) => edge.target === node.id && edge.targetHandle?.startsWith(`${field.id}_`))
        .map((edge) => edge.targetHandle as string)
      : [field.id];
    const connected = handles.flatMap((handle) => incomingValues(nodes, edges, node.id, handle, dispatch));
    const values = connected.length ? connected : [node.data.config[field.id]];
    for (const value of values) {
      for (const url of stringUrls(value)) references.add(url);
    }
  }

  return {
    projectId,
    nodeId: node.id,
    prompt,
    model: requestedModel,
    durationSec,
    resolution,
    aspectRatio,
    generateAudio,
    expectedReferenceCount: references.size,
  };
}

async function recoverLegacyTopviewVideo(
  node: Node<WorkflowNodeData>,
  criteria: LegacyRecoveryCriteria,
  dispatch: WorkflowDispatch,
): Promise<void> {
  const recoverVideo = window.electronAPI?.topview?.recoverVideo;
  if (!recoverVideo) return;
  dispatch.setNodeRunning(node.id, true);
  try {
    const recovered = await recoverVideo(criteria);
    if (recovered.status !== 'success' || !recovered.url?.trim()) return;
    dispatch.setNodeResult(node.id, { status: 'complete', url: recovered.url.trim() });
    dispatch.addGeneration(node.id, recovered.url.trim());
  } finally {
    dispatch.setNodeRunning(node.id, false);
  }
}

/**
 * Restart query loops for paid Topview video tasks restored from a saved Space.
 * The attempt set is scoped to the mounted canvas so React result updates do
 * not start overlapping pollers for the same remote task.
 */
export function resumePersistedTopviewVideoTasks(
  projectId: string,
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
    if (!task) {
      const criteria = legacyRecoveryCriteria(projectId, node, nodes, edges, dispatch);
      const recoverVideo = window.electronAPI?.topview?.recoverVideo;
      if (!criteria || !recoverVideo) continue;
      const recoveryKey = `${node.id}:legacy:${JSON.stringify(criteria)}`;
      if (attemptedTaskKeys.has(recoveryKey)) continue;
      attemptedTaskKeys.add(recoveryKey);
      recoveries.push(recoverLegacyTopviewVideo(node, criteria, dispatch));
      continue;
    }
    const taskKey = `${node.id}:${task.taskType}:${task.taskId}`;
    if (attemptedTaskKeys.has(taskKey)) continue;

    attemptedTaskKeys.add(taskKey);
    recoveries.push(executeNode(node.id, nodes, edges, dispatch));
  }

  return recoveries;
}
