import type { Edge, Node } from '@xyflow/react';
import type { DirectorBreakdownItem } from '@/types/director';
import type { Element } from '@/types/elements';
import type { WorkflowNodeData } from '@/types/workflow';
import { getModelDefinition } from '@/lib/fal/models';
import { generateId } from '@/lib/utils/ids';
import { NODE_REGISTRY, resolveElementNodeIds } from '@/lib/workflows/node-registry';

const TAG_PATTERN = /@([A-Za-z0-9][\w-]*)/g;
const ELEMENT_Y_OFFSET = 72;
const AUTO_PROMPT_IDS_KEY = '_mentionPromptNodeIds';

export function extractPromptTags(prompt: string): string[] {
  const tags: string[] = [];
  for (const match of prompt.matchAll(TAG_PATTERN)) {
    const tag = `@${match[1]}`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function mentionKey(value: string): string {
  return value.replace(/^@/, '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

export function resolveElementsForPrompt(
  prompt: string,
  elements: Element[],
  breakdown: DirectorBreakdownItem[] = [],
  options: { requireStill?: boolean } = {},
): Element[] {
  const requireStill = options.requireStill ?? true;
  const found: Element[] = [];
  const seen = new Set<string>();
  const byId = new Map(elements.map((element) => [element.id, element]));
  const byKey = new Map(elements.map((element) => [mentionKey(element.name), element]));

  for (const tag of extractPromptTags(prompt)) {
    const item = breakdown.find((entry) => mentionKey(entry.tag) === mentionKey(tag));
    const linked = item?.elementId ? byId.get(item.elementId) : undefined;
    const named = byKey.get(mentionKey(tag))
      ?? (item ? byKey.get(mentionKey(item.name)) : undefined);
    const element = linked ?? named;
    if (!element || seen.has(element.id)) continue;
    if (requireStill && element.images.length === 0) continue;
    seen.add(element.id);
    found.push(element);
  }
  return found;
}

export function bindPromptMentionsToGraph(params: {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  promptNodeIds: string[];
  elements: Element[];
  breakdown?: DirectorBreakdownItem[];
}): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] } {
  const promptNodes = params.nodes.filter((node) => params.promptNodeIds.includes(node.id));
  const mentioned = uniqueElements(promptNodes.flatMap((node) => (
    resolveElementsForPrompt(String(node.data.config.prompt ?? ''), params.elements, params.breakdown ?? [])
  )));
  if (mentioned.length === 0) return { nodes: params.nodes, edges: params.edges };

  return attachElementsToPromptGraph({
    nodes: params.nodes,
    edges: params.edges,
    promptNodeIds: params.promptNodeIds,
    elementIds: mentioned.map((element) => element.id),
  });
}

/**
 * Add an explicitly selected @-mention to a prompt's shared Element node.
 * Selection is ID-driven so element names containing spaces or punctuation are
 * not lost when the visible @mention is parsed later.
 */
export function attachElementMentionToGraph(params: {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  promptNodeId: string;
  elementId: string;
}): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] } {
  return attachElementsToPromptGraph({
    nodes: params.nodes,
    edges: params.edges,
    promptNodeIds: [params.promptNodeId],
    elementIds: [params.elementId],
  });
}

/** Reconnect a prompt's auto-created Element stack when its model is wired later. */
export function reconcilePromptMentionConnections(params: {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  promptNodeId: string;
}): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] } {
  const stack = params.nodes.find((node) => (
    node.type === 'element' && autoPromptIds(node.data.config).includes(params.promptNodeId)
  ));
  const elementIds = stack ? resolveElementNodeIds(stack.data.config) : [];
  if (elementIds.length === 0) return { nodes: params.nodes, edges: params.edges };
  return attachElementsToPromptGraph({
    nodes: params.nodes,
    edges: params.edges,
    promptNodeIds: [params.promptNodeId],
    elementIds,
  });
}

function attachElementsToPromptGraph(params: {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  promptNodeIds: string[];
  elementIds: string[];
}): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] } {
  const promptNodes = params.nodes.filter((node) => params.promptNodeIds.includes(node.id));
  const elementIds = [...new Set(params.elementIds.filter(Boolean))];
  if (promptNodes.length === 0 || elementIds.length === 0) {
    return { nodes: params.nodes, edges: params.edges };
  }

  const nodes = [...params.nodes];
  const edges = [...params.edges];
  const models = targetReferenceModels(nodes, edges, params.promptNodeIds);
  for (const prompt of promptNodes) {
    for (const model of models) {
      if (edges.some((edge) => edge.source === prompt.id && edge.target === model.id)) continue;
      const targetHandle = promptInputHandle(model);
      if (targetHandle) edges.push(makeEdge(prompt.id, 'text', model.id, targetHandle, 'text'));
    }
  }
  const modelIds = new Set(models.map((model) => model.id));
  const elementNodes = nodes.filter((node) => node.type === 'element');

  const taggedNode = elementNodes.find((node) => (
    autoPromptIds(node.data.config).some((id) => params.promptNodeIds.includes(id))
  ));
  const connectedNodes = elementNodes.filter((node) => (
    edges.some((edge) => edge.source === node.id && modelIds.has(edge.target))
  ));
  const matchingConnectedNode = connectedNodes.find((node) => (
    resolveElementNodeIds(node.data.config).some((id) => elementIds.includes(id))
  ));
  let elementNode = taggedNode
    ?? matchingConnectedNode
    ?? (connectedNodes.length === 1 ? connectedNodes[0] : undefined);

  if (elementNode) {
    const index = nodes.findIndex((node) => node.id === elementNode!.id);
    const mergedIds = [...new Set([...resolveElementNodeIds(elementNode.data.config), ...elementIds])];
    const promptIds = [...new Set([...autoPromptIds(elementNode.data.config), ...params.promptNodeIds])];
    elementNode = {
      ...elementNode,
      data: {
        ...elementNode.data,
        config: {
          ...elementNode.data.config,
          elementIds: mergedIds,
          elementId: '',
          [AUTO_PROMPT_IDS_KEY]: promptIds,
        },
      },
    };
    nodes[index] = elementNode;
  } else {
    const origin = promptNodes[0];
    elementNode = {
      id: generateId(),
      type: 'element',
      position: {
        x: origin.position.x,
        y: origin.position.y + (origin.measured?.height ?? origin.height ?? 240) + ELEMENT_Y_OFFSET,
      },
      ...(origin.parentId ? { parentId: origin.parentId, extent: origin.extent } : {}),
      data: {
        type: 'element',
        label: 'Element References',
        config: {
          ...NODE_REGISTRY.element.defaultData,
          elementIds,
          [AUTO_PROMPT_IDS_KEY]: params.promptNodeIds,
        },
      },
    };
    nodes.push(elementNode);
  }

  for (const model of models) {
    if (edges.some((edge) => edge.source === elementNode.id && edge.target === model.id)) continue;
    const target = nextReferenceHandle(model, edges);
    if (!target) continue;
    edges.push(makeEdge(elementNode.id, 'element', model.id, target.handle));
    if (target.elementCount !== undefined) {
      const index = nodes.findIndex((node) => node.id === model.id);
      const current = nodes[index];
      if (current) {
        nodes[index] = {
          ...current,
          data: {
            ...current.data,
            config: { ...current.data.config, _elementCount: target.elementCount },
          },
        };
      }
    }
  }

  return { nodes, edges };
}

function uniqueElements(elements: Element[]): Element[] {
  const seen = new Set<string>();
  return elements.filter((element) => {
    if (seen.has(element.id)) return false;
    seen.add(element.id);
    return true;
  });
}

function targetReferenceModels(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  promptNodeIds: string[],
): Node<WorkflowNodeData>[] {
  const models = nodes.filter((node) => {
    const model = getModelDefinition(node.type ?? '');
    return Boolean(model && hasReferenceInput(model));
  });
  const wired = models.filter((model) => (
    edges.some((edge) => promptNodeIds.includes(edge.source) && edge.target === model.id)
  ));
  if (wired.length > 0) return wired;
  return models.length === 1 ? models : [];
}

function hasReferenceInput(model: NonNullable<ReturnType<typeof getModelDefinition>>): boolean {
  return model.inputs.some((field) => (
    (field.portType === 'image' || field.portType === 'media')
    && (field.fieldType === 'port' || field.fieldType === 'element-list')
  ));
}

function promptInputHandle(model: Node<WorkflowNodeData>): string | undefined {
  const def = getModelDefinition(model.type ?? '');
  return def?.inputs.find((field) => field.fieldType === 'port' && field.id === 'prompt')?.id
    ?? def?.inputs.find((field) => field.fieldType === 'port' && field.portType === 'text' && field.required)?.id;
}

function nextReferenceHandle(
  model: Node<WorkflowNodeData>,
  edges: Edge[],
): { handle: string; elementCount?: number } | undefined {
  const def = getModelDefinition(model.type ?? '');
  const used = new Set(edges.filter((edge) => edge.target === model.id).map((edge) => edge.targetHandle));
  if (!def) return undefined;

  const multiPorts = def.inputs.filter((field) => (
    field.fieldType === 'port'
    && field.multiple
    && (field.portType === 'image' || field.portType === 'media')
  ));
  const preferredMulti = multiPorts.find((field) => field.id === 'medias') ?? multiPorts[0];
  if (preferredMulti) return { handle: preferredMulti.id };

  const singlePorts = def.inputs.filter((field) => (
    field.fieldType === 'port'
    && !field.multiple
    && (field.portType === 'image' || field.portType === 'media')
    && !used.has(field.id)
  ));
  // Image-edit models such as Qwen require a primary source image before any
  // optional references. Keep Nano Banana's optional primary/list behavior.
  const requiredSingle = singlePorts.find((field) => field.required && field.id === 'image_url')
    ?? singlePorts.find((field) => field.required);
  if (requiredSingle) return { handle: requiredSingle.id };

  const listFields = def.inputs.filter((field) => (
    field.fieldType === 'element-list'
    && (field.portType === 'image' || field.portType === 'media')
  ));
  const listField = listFields.find((field) => field.id === 'extra_images') ?? listFields[0];
  if (listField) {
    let index = 0;
    while (used.has(`${listField.id}_${index}`)) index += 1;
    return {
      handle: `${listField.id}_${index}`,
      elementCount: Math.max(Number(model.data.config._elementCount ?? 0), index + 1),
    };
  }

  const preferredSingle = singlePorts.find((field) => field.id === 'image_url')
    ?? singlePorts.find((field) => field.id === 'start_image')
    ?? singlePorts[0];
  return preferredSingle ? { handle: preferredSingle.id } : undefined;
}

function autoPromptIds(config: Record<string, unknown> | undefined): string[] {
  const raw = config?.[AUTO_PROMPT_IDS_KEY];
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === 'string' && id !== '');
  }
  const legacy = config?._mentionPromptNodeId;
  return typeof legacy === 'string' && legacy ? [legacy] : [];
}

function makeEdge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  sourcePortType = 'image',
): Edge {
  return {
    id: generateId(),
    source,
    sourceHandle,
    target,
    targetHandle,
    type: 'animated',
    data: { sourcePortType },
  };
}
