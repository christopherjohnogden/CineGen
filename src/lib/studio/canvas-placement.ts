import type { Edge, Node } from '@xyflow/react';
import type { Asset } from '@/types/project';
import type { WorkflowNodeData } from '@/types/workflow';
import { getModelDefinition } from '@/lib/fal/models';
import { toFileUrl } from '@/lib/utils/file-url';
import { createWorkflowNodeFromSpec } from '@/lib/llm/space-node-factory';
import { endFieldFor, promptFieldFor, referenceFieldFor, startFieldFor } from './fields';

/**
 * A Studio generation is one node carrying its whole recipe in config. Keeping
 * those nodes off the canvas until they are asked for is what stops fifty takes
 * from burying hand-built graph work; the Space feed reads the same nodes, so
 * hiding them here costs the feed nothing.
 */

/** Studio generations are canvas-hidden until explicitly placed. */
export function isStudioGenerated(node: Node<WorkflowNodeData>): boolean {
  return Boolean(node.data.config.__studioGenerated);
}

export function isPlacedOnCanvas(node: Node<WorkflowNodeData>): boolean {
  return !isStudioGenerated(node) || node.data.config.__studioCanvasPlaced === true;
}

/** Input nodes materialized alongside a placed generation, so they can be pulled back out with it. */
function placedInputIds(node: Node<WorkflowNodeData>): string[] {
  const ids = node.data.config.__studioPlacedInputIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function visibleCanvasNodes(nodes: Node<WorkflowNodeData>[]): Node<WorkflowNodeData>[] {
  return nodes.filter(isPlacedOnCanvas);
}

/** An edge is only drawable when both of its endpoints are on the canvas. */
export function visibleCanvasEdges(nodes: Node<WorkflowNodeData>[], edges: Edge[]): Edge[] {
  const visible = new Set(visibleCanvasNodes(nodes).map((node) => node.id));
  return edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
}

// A placed generation is a little cluster: its inputs stack in a column to the
// left, the generation sits to their right. The grid has to be wide and tall
// enough for the whole cluster or the next one lands on top of the last.
const INPUT_W = 360;
const INPUT_GAP = 220;
const STACK_GAP = 40;
const CLUSTER_W = INPUT_W + INPUT_GAP + 520;
const CLUSTER_H = 720;
const COLS = 3;

/** Roughly how tall each materialized input renders, so a stack never overlaps itself. */
const INPUT_HEIGHTS: Record<string, number> = {
  prompt: 430,
  element: 300,
  filePicker: 260,
};

/** Next free cell in the placed-generation grid, kept clear of authored work. */
export function nextPlacedSlot(nodes: Node<WorkflowNodeData>[]): { x: number; y: number } {
  const authored = nodes.filter((node) => !isStudioGenerated(node) && isPlacedOnCanvas(node));
  const placed = nodes.filter((node) => isStudioGenerated(node) && isPlacedOnCanvas(node));
  const originX = authored.length ? Math.max(...authored.map((node) => node.position.x)) + 720 : 640;
  const originY = authored.length ? Math.min(...authored.map((node) => node.position.y)) : 80;
  const index = placed.length;
  return {
    x: originX + (index % COLS) * CLUSTER_W,
    y: originY + Math.floor(index / COLS) * CLUSTER_H,
  };
}

function assetUrl(assets: Asset[], id: unknown): string {
  if (typeof id !== 'string') return '';
  const asset = assets.find((candidate) => candidate.id === id);
  // Match how the composer resolved the same asset, or the node renders as
  // "Media unavailable" for a file that is sitting right there on disk.
  return asset ? toFileUrl(asset.fileRef || asset.url) : '';
}

/**
 * Rebuilds the wired form of a generation: the prompt, elements and frames that
 * produced it become real nodes feeding its input handles. The executor already
 * reads config as a first-class fallback, so this is presentation — the graph
 * shows what went in, and stays runnable either way.
 */
export function expandStudioInputs(
  node: Node<WorkflowNodeData>,
  assets: Asset[],
): { nodes: Node<WorkflowNodeData>[]; edges: Edge[]; referenceSlots: number } {
  const model = getModelDefinition(node.data.type);
  if (!model) return { nodes: [], edges: [], referenceSlots: 0 };

  const config = node.data.config;
  const made: Node<WorkflowNodeData>[] = [];
  const edges: Edge[] = [];
  const originX = node.position.x - INPUT_W - INPUT_GAP;

  // Lay the stack out for real heights rather than a fixed step, then lift it so
  // the column reads as centred on the generation it feeds.
  const pending: Array<{ node: Node<WorkflowNodeData>; height: number }> = [];
  const stack = (created: Node<WorkflowNodeData>) => {
    pending.push({ node: created, height: INPUT_HEIGHTS[created.data.type] ?? 260 });
    made.push(created);
    return created;
  };

  const connect = (source: Node<WorkflowNodeData>, handle: string, sourceHandle: string) => {
    edges.push({
      id: `${source.id}-${node.id}-${handle}`,
      source: source.id,
      target: node.id,
      sourceHandle,
      targetHandle: handle,
    });
  };

  /**
   * A model exposes its reference inputs one of two ways. A plain `port` field is
   * a single handle named after the field. An `element-list` field renders one
   * handle per slot — `${id}_0`, `${id}_1` — and only as many as `_elementCount`
   * says exist, so the count has to be opened up before the edges have anywhere
   * to land. Targeting the bare field id in that case silently drops the edge,
   * which is what left the references dangling.
   */
  let referenceSlots = 0;

  const promptField = promptFieldFor(model);
  const promptText = typeof config.__studioPromptBody === 'string' && config.__studioPromptBody
    ? config.__studioPromptBody
    : typeof config.__studioPrompt === 'string' ? config.__studioPrompt : '';
  if (promptField && promptText) {
    const promptNode = stack(createWorkflowNodeFromSpec(
      { nodeType: 'prompt', label: 'Prompt', config: { prompt: promptText } },
      { x: originX, y: 0 },
    ));
    connect(promptNode, promptField.id, 'text');
  }

  const referenceField = referenceFieldFor(model);
  const nextReferenceHandle = (): string | undefined => {
    if (!referenceField) return undefined;
    if (referenceField.fieldType !== 'element-list') return referenceField.id;
    const handle = `${referenceField.id}_${referenceSlots}`;
    referenceSlots += 1;
    return handle;
  };

  const elementIds = Array.isArray(config.__studioElementIds)
    ? config.__studioElementIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (referenceField && elementIds.length > 0) {
    const elementNode = stack(createWorkflowNodeFromSpec(
      { nodeType: 'element', label: 'Element', config: { elementIds } },
      { x: originX, y: 0 },
    ));
    const handle = nextReferenceHandle();
    if (handle) connect(elementNode, handle, 'element');
  }

  // Attached references were pasted in as URLs rather than picked from Elements,
  // so each one comes back as its own file node.
  const attached = Array.isArray(config.__studioAttachedRefs)
    ? config.__studioAttachedRefs.filter((url): url is string => typeof url === 'string')
    : [];
  if (referenceField) {
    for (const url of attached) {
      const refNode = stack(createWorkflowNodeFromSpec(
        { nodeType: 'filePicker', label: 'Reference', config: { fileUrl: url, fileType: 'image' } },
        { x: originX, y: 0 },
      ));
      const handle = nextReferenceHandle();
      if (handle) connect(refNode, handle, 'media');
    }
  }

  for (const [field, assetId, label] of [
    [startFieldFor(model), config.__studioStartAssetId, 'Start Frame'],
    [endFieldFor(model), config.__studioEndAssetId, 'End Frame'],
  ] as const) {
    if (!field) continue;
    const url = assetUrl(assets, assetId);
    if (!url) continue;
    const frameNode = stack(createWorkflowNodeFromSpec(
      { nodeType: 'filePicker', label, config: { fileUrl: url, fileType: 'image' } },
      { x: originX, y: 0 },
    ));
    connect(frameNode, field.id, 'media');
  }

  const total = pending.reduce((sum, entry) => sum + entry.height, 0)
    + Math.max(0, pending.length - 1) * STACK_GAP;
  let y = node.position.y + 140 - total / 2;
  for (const entry of pending) {
    entry.node.position = { x: originX, y };
    y += entry.height + STACK_GAP;
  }

  return { nodes: made, edges, referenceSlots };
}

/**
 * Places a hidden generation on the canvas along with the inputs that made it.
 * Placing an already-placed node is a no-op so repeat opens focus rather than
 * duplicate.
 */
export function placeStudioNodeOnCanvas(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  nodeId: string,
  assets: Asset[],
): { nodes: Node<WorkflowNodeData>[]; edges: Edge[]; changed: boolean } {
  const target = nodes.find((node) => node.id === nodeId);
  if (!target || isPlacedOnCanvas(target)) return { nodes, edges, changed: false };

  const position = nextPlacedSlot(nodes);
  const placed: Node<WorkflowNodeData> = {
    ...target,
    position,
    data: { ...target.data, config: { ...target.data.config, __studioCanvasPlaced: true } },
  };
  const expanded = expandStudioInputs(placed, assets);
  placed.data.config.__studioPlacedInputIds = expanded.nodes.map((node) => node.id);
  // An element-list reference only renders as many handles as `_elementCount`
  // claims, so open up a slot for every reference edge about to land.
  if (expanded.referenceSlots > 0) {
    const existing = typeof placed.data.config._elementCount === 'number'
      ? placed.data.config._elementCount
      : 0;
    placed.data.config._elementCount = Math.max(existing, expanded.referenceSlots);
  }

  return {
    nodes: [...nodes.map((node) => (node.id === nodeId ? placed : node)), ...expanded.nodes],
    edges: [...edges, ...expanded.edges],
    changed: true,
  };
}

/** True when deleting this node on the canvas should only hide it. */
export function isHideOnDelete(node: Node<WorkflowNodeData>): boolean {
  return isStudioGenerated(node) && isPlacedOnCanvas(node);
}

/**
 * What "delete" means on the canvas depends on what is selected. A generation
 * belongs to the Studio feed and is only borrowed by the canvas, so removing it
 * here hides it; anything hand-built is genuinely deleted. Losing a render to a
 * Delete keypress meant for tidying the canvas is not a recoverable mistake.
 */
export function detachSelection(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  ids: Iterable<string>,
): { nodes: Node<WorkflowNodeData>[]; edges: Edge[]; hidden: number; deleted: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  const doomed = new Set<string>();
  let hidden = 0;

  for (const id of ids) {
    const node = nextNodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    if (isHideOnDelete(node)) {
      const result = removeStudioNodeFromCanvas(nextNodes, nextEdges, id);
      nextNodes = result.nodes;
      nextEdges = result.edges;
      hidden += 1;
    } else {
      doomed.add(id);
    }
  }

  if (doomed.size > 0) {
    nextNodes = nextNodes.filter((node) => !doomed.has(node.id));
    nextEdges = nextEdges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target));
  }

  return { nodes: nextNodes, edges: nextEdges, hidden, deleted: doomed.size };
}

/**
 * Takes a generation back off the canvas. The generation itself survives — it
 * stays in the feed — but the input nodes materialized with it are removed, so
 * hiding leaves nothing orphaned behind.
 */
export function removeStudioNodeFromCanvas(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  nodeId: string,
): { nodes: Node<WorkflowNodeData>[]; edges: Edge[]; changed: boolean } {
  const target = nodes.find((node) => node.id === nodeId);
  if (!target || !isStudioGenerated(target) || !isPlacedOnCanvas(target)) {
    return { nodes, edges, changed: false };
  }

  // Only drop an input node this placement created, and only while nothing else
  // has been wired to it since.
  const owned = new Set(placedInputIds(target).filter((id) => !edges.some((edge) => (
    (edge.source === id && edge.target !== nodeId) || edge.target === id
  ))));

  // Drop the selection with the node. A hidden node that stays selected is
  // invisible but still counted — it drags selection bounds and counts toward
  // toolbars that are meant to describe what is on screen.
  const hidden: Node<WorkflowNodeData> = {
    ...target,
    selected: false,
    data: { ...target.data, config: { ...target.data.config } },
  };
  delete hidden.data.config.__studioCanvasPlaced;
  delete hidden.data.config.__studioPlacedInputIds;

  return {
    nodes: nodes.filter((node) => !owned.has(node.id)).map((node) => (node.id === nodeId ? hidden : node)),
    edges: edges.filter((edge) => (
      !owned.has(edge.source) && !owned.has(edge.target)
      && edge.source !== nodeId && edge.target !== nodeId
    )),
    changed: true,
  };
}
