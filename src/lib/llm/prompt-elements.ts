import type { Edge, Node } from '@xyflow/react';
import type { DirectorBreakdownItem } from '@/types/director';
import type { Element } from '@/types/elements';
import type { WorkflowNodeData } from '@/types/workflow';
import { getModelDefinition } from '@/lib/fal/models';
import { generateId } from '@/lib/utils/ids';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';

const TAG_PATTERN = /@([A-Za-z0-9][\w-]*)/g;
const ELEMENT_X_OFFSET = 240;
const ELEMENT_ROW = 170;

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

  const nodes = [...params.nodes];
  const edges = [...params.edges];
  const elementNodeIds = new Map<string, string>();

  for (const node of nodes) {
    if (node.type !== 'element') continue;
    const elementId = String(node.data.config.elementId ?? '');
    if (elementId) elementNodeIds.set(elementId, node.id);
  }

  const origin = promptNodes[0] ?? nodes[0];
  let created = 0;
  for (const element of mentioned) {
    const existingId = elementNodeIds.get(element.id);
    if (existingId) continue;
    const elementNode: Node<WorkflowNodeData> = {
      id: generateId(),
      type: 'element',
      position: {
        x: origin.position.x - ELEMENT_X_OFFSET,
        y: origin.position.y + created * ELEMENT_ROW,
      },
      data: {
        type: 'element',
        label: element.name,
        config: { ...NODE_REGISTRY.element.defaultData, elementId: element.id },
      },
    };
    nodes.push(elementNode);
    elementNodeIds.set(element.id, elementNode.id);
    created += 1;
  }

  const models = targetImageModels(nodes, edges, params.promptNodeIds);
  for (const prompt of promptNodes) {
    for (const model of models) {
      const promptHandle = promptInputHandle(model);
      if (promptHandle && !hasEdge(edges, prompt.id, 'text', model.id, promptHandle)) {
        edges.push(makeEdge(prompt.id, 'text', model.id, promptHandle));
      }
    }
  }

  for (const model of models) {
    const needed = mentioned
      .map((element) => elementNodeIds.get(element.id))
      .filter((id): id is string => Boolean(id))
      .filter((id) => !edges.some((edge) => edge.source === id && edge.target === model.id));
    if (needed.length === 0) continue;
    const { handles, elementCount } = nextMediaHandles(model, edges, needed.length);
    for (const [index, sourceId] of needed.entries()) {
      const handle = handles[index];
      if (!handle) break;
      edges.push(makeEdge(sourceId, 'element', model.id, handle));
    }
    if (elementCount !== undefined) {
      const index = nodes.findIndex((node) => node.id === model.id);
      if (index >= 0) {
        nodes[index] = {
          ...nodes[index],
          data: {
            ...nodes[index].data,
            config: { ...nodes[index].data.config, _elementCount: elementCount },
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

function targetImageModels(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  promptNodeIds: string[],
): Node<WorkflowNodeData>[] {
  const imageModels = nodes.filter((node) => getModelDefinition(node.type ?? '')?.outputType === 'image');
  const wired = imageModels.filter((model) => (
    edges.some((edge) => promptNodeIds.includes(edge.source) && edge.target === model.id)
  ));
  if (wired.length > 0) return wired;
  return imageModels.length === 1 ? imageModels : [];
}

function promptInputHandle(model: Node<WorkflowNodeData>): string | undefined {
  const def = getModelDefinition(model.type ?? '');
  return def?.inputs.find((field) => field.portType === 'text' && field.id === 'prompt')?.id
    ?? def?.inputs.find((field) => field.portType === 'text' && field.required)?.id;
}

function nextMediaHandles(
  model: Node<WorkflowNodeData>,
  edges: Edge[],
  count: number,
): { handles: string[]; elementCount?: number } {
  const def = getModelDefinition(model.type ?? '');
  const used = new Set(edges.filter((edge) => edge.target === model.id).map((edge) => edge.targetHandle));
  const handles: string[] = [];
  if (!def) return { handles };

  const multi = def.inputs.find((field) => (
    field.fieldType === 'port'
    && field.multiple
    && (field.portType === 'image' || field.portType === 'media')
  ));
  if (multi) {
    return { handles: Array.from({ length: count }, () => multi.id) };
  }

  for (const field of def.inputs) {
    if (field.fieldType !== 'port') continue;
    if (field.portType !== 'image' && field.portType !== 'media') continue;
    if (used.has(field.id)) continue;
    handles.push(field.id);
    if (handles.length >= count) return { handles };
  }

  const listField = def.inputs.find((field) => (
    field.fieldType === 'element-list'
    && (field.portType === 'image' || field.portType === 'media')
  ));
  if (!listField) return { handles };
  let index = Number(model.data.config._elementCount ?? 0);
  while (handles.length < count) {
    handles.push(`${listField.id}_${index}`);
    index += 1;
  }
  return { handles, elementCount: index };
}

function hasEdge(
  edges: Edge[],
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): boolean {
  return edges.some((edge) => (
    edge.source === source
    && edge.sourceHandle === sourceHandle
    && edge.target === target
    && edge.targetHandle === targetHandle
  ));
}

function makeEdge(source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return {
    id: generateId(),
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}
