import { describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { ModelDefinition } from '@/types/workflow';
import type { WorkflowNodeData } from '@/types/workflow';

const model = {
  nodeType: 'video-model',
  name: 'Video Model',
  provider: 'topview',
  outputType: 'video',
  inputs: [
    { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
    { id: 'extra_images', portType: 'image', label: 'Reference', required: false, falParam: 'image_urls', fieldType: 'element-list', max: 15 },
    { id: 'start_image', portType: 'image', label: 'Start Frame', required: false, falParam: 'start', fieldType: 'port', mediaRole: 'start_image' },
    { id: 'end_image', portType: 'image', label: 'End Frame', required: false, falParam: 'end', fieldType: 'port', mediaRole: 'end_image' },
  ],
} as unknown as ModelDefinition;

vi.mock('@/lib/fal/models', () => ({
  // The node registry builds its model nodes from ALL_MODELS at import time; the
  // materialized inputs are all utility nodes, so an empty catalog is enough.
  ALL_MODELS: {},
  getModelDefinition: (nodeType: string) => (nodeType === 'video-model' ? model : undefined),
}));

const {
  detachSelection,
  isHideOnDelete,
  isPlacedOnCanvas,
  nextPlacedSlot,
  placeStudioNodeOnCanvas,
  removeStudioNodeFromCanvas,
  visibleCanvasEdges,
  visibleCanvasNodes,
} = await import('@/lib/studio/canvas-placement');

function generation(id: string, config: Record<string, unknown> = {}): Node<WorkflowNodeData> {
  return {
    id,
    type: 'video-model',
    position: { x: 0, y: 0 },
    data: {
      type: 'video-model',
      label: 'Video Model',
      config: { __studioGenerated: true, __studioPromptBody: 'A tracking shot.', ...config },
    },
  } as Node<WorkflowNodeData>;
}

function authored(id: string, x = 100, y = 100): Node<WorkflowNodeData> {
  return {
    id,
    type: 'prompt',
    position: { x, y },
    data: { type: 'prompt', label: 'Prompt', config: {} },
  } as Node<WorkflowNodeData>;
}

/**
 * Fifty takes in the Studio used to mean fifty nodes buried on the canvas. The
 * generations still have to exist — the feed reads the same nodes — so the rule
 * is about what gets drawn, and about never losing a clip by hiding it.
 */
describe('studio canvas placement', () => {
  it('keeps generations off the canvas until they are placed, without hiding authored work', () => {
    const nodes = [authored('a1'), generation('g1'), generation('g2')];
    expect(visibleCanvasNodes(nodes).map((node) => node.id)).toEqual(['a1']);

    const placed = placeStudioNodeOnCanvas(nodes, [], 'g1', []);
    expect(placed.changed).toBe(true);
    expect(visibleCanvasNodes(placed.nodes).map((node) => node.id)).toContain('g1');
    expect(visibleCanvasNodes(placed.nodes).map((node) => node.id)).not.toContain('g2');
  });

  it('rebuilds the prompt, elements and frames that made the clip, wired to its inputs', () => {
    const nodes = [generation('g1', {
      __studioElementIds: ['el-peter'],
      __studioAttachedRefs: ['local-media://sheet.png'],
      __studioStartAssetId: 'asset-1',
    })];
    const assets = [{ id: 'asset-1', url: 'local-media://first.png' }] as never;

    const placed = placeStudioNodeOnCanvas(nodes, [], 'g1', assets);
    const made = placed.nodes.filter((node) => node.id !== 'g1');
    expect(made.map((node) => node.data.type).sort()).toEqual(['element', 'filePicker', 'filePicker', 'prompt']);

    // Every input feeds the generation on the handle the model names for it.
    const targets = placed.edges.map((edge) => edge.targetHandle).sort();
    expect(targets).toEqual(['extra_images_0', 'extra_images_1', 'prompt', 'start_image']);
    expect(placed.edges.every((edge) => edge.target === 'g1')).toBe(true);

    const promptNode = made.find((node) => node.data.type === 'prompt');
    expect(promptNode?.data.config.prompt).toBe('A tracking shot.');
  });

  it('leaves an end frame out when the generation never had one', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1')], [], 'g1', []);
    expect(placed.edges.map((edge) => edge.targetHandle)).toEqual(['prompt']);
  });

  it('focuses rather than duplicates when the clip is already on the canvas', () => {
    const first = placeStudioNodeOnCanvas([generation('g1')], [], 'g1', []);
    const second = placeStudioNodeOnCanvas(first.nodes, first.edges, 'g1', []);
    expect(second.changed).toBe(false);
    expect(second.nodes).toBe(first.nodes);
  });

  it('takes a clip back off the canvas with the inputs it brought, keeping the generation', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1', { __studioElementIds: ['el-peter'] })], [], 'g1', []);
    expect(placed.nodes).toHaveLength(3);

    const hidden = removeStudioNodeFromCanvas(placed.nodes, placed.edges, 'g1');
    expect(hidden.changed).toBe(true);
    // The generation survives — it is still a feed clip — but nothing is drawn.
    expect(hidden.nodes.map((node) => node.id)).toEqual(['g1']);
    expect(hidden.edges).toEqual([]);
    expect(isPlacedOnCanvas(hidden.nodes[0])).toBe(false);
  });

  it('keeps an input node that has since been wired into other work', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1'), authored('a1')], [], 'g1', []);
    const promptNode = placed.nodes.find((node) => node.data.type === 'prompt' && node.id !== 'g1');
    const reused: Edge = { id: 'e-reuse', source: promptNode!.id, target: 'a1' };

    const hidden = removeStudioNodeFromCanvas(placed.nodes, [...placed.edges, reused], 'g1');
    expect(hidden.nodes.map((node) => node.id)).toContain(promptNode!.id);
    expect(hidden.edges).toContainEqual(reused);
  });

  it('never draws an edge that dangles off a hidden generation', () => {
    const nodes = [authored('a1'), generation('g1')];
    const edges: Edge[] = [{ id: 'e1', source: 'a1', target: 'g1' }];
    expect(visibleCanvasEdges(nodes, edges)).toEqual([]);

    const placed = placeStudioNodeOnCanvas(nodes, edges, 'g1', []);
    expect(visibleCanvasEdges(placed.nodes, placed.edges)).toContainEqual(edges[0]);
  });

  /**
   * A model names its reference inputs one of two ways, and getting it wrong is
   * invisible: React Flow drops an edge pointing at a handle that does not
   * exist, so the nodes land on the canvas looking unwired.
   */
  it('targets the numbered handles an element-list reference actually renders', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1', {
      __studioElementIds: ['el-peter'],
      __studioAttachedRefs: ['local-media://sheet.png'],
    })], [], 'g1', []);

    const referenceEdges = placed.edges.filter((edge) => edge.targetHandle?.startsWith('extra_images'));
    expect(referenceEdges.map((edge) => edge.targetHandle)).toEqual(['extra_images_0', 'extra_images_1']);

    // The handles only exist if the node has been told how many slots to render.
    const target = placed.nodes.find((node) => node.id === 'g1');
    expect(target?.data.config._elementCount).toBe(2);
  });

  it('targets the field id directly when the reference is a plain port', () => {
    const portModel = {
      ...model,
      inputs: model.inputs.map((field) => (
        field.id === 'extra_images' ? { ...field, fieldType: 'port', multiple: true } : field
      )),
    } as unknown as ModelDefinition;
    const restore = model.inputs;
    Object.assign(model, { inputs: portModel.inputs });

    const placed = placeStudioNodeOnCanvas([generation('g1', {
      __studioAttachedRefs: ['local-media://sheet.png'],
    })], [], 'g1', []);
    expect(placed.edges.map((edge) => edge.targetHandle)).toContain('extra_images');
    expect(placed.nodes.find((node) => node.id === 'g1')?.data.config._elementCount).toBeUndefined();

    Object.assign(model, { inputs: restore });
  });

  it('stacks the inputs in a readable column instead of piling them up', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1', {
      __studioElementIds: ['el-peter'],
      __studioAttachedRefs: ['local-media://sheet.png'],
    })], [], 'g1', []);
    const made = placed.nodes.filter((node) => node.id !== 'g1');
    const target = placed.nodes.find((node) => node.id === 'g1')!;

    // One column, all of it left of the generation it feeds.
    expect(new Set(made.map((node) => node.position.x)).size).toBe(1);
    expect(made[0].position.x).toBeLessThan(target.position.x);

    // No two inputs occupy the same band.
    const ys = made.map((node) => node.position.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(260);
    }
  });

  it('gives each placed cluster room so a second one never lands on the first', () => {
    const first = placeStudioNodeOnCanvas([generation('g1'), generation('g2')], [], 'g1', []);
    const second = placeStudioNodeOnCanvas(first.nodes, first.edges, 'g2', []);
    const a = second.nodes.find((node) => node.id === 'g1')!;
    const b = second.nodes.find((node) => node.id === 'g2')!;
    // Far enough apart to clear the input column hanging off the left of each.
    expect(Math.abs(b.position.x - a.position.x)).toBeGreaterThan(580);
  });

  /**
   * Deleting a generation on the canvas used to destroy the render itself — the
   * clip vanished from the Studio feed too, with nothing to undo it. A Delete
   * keypress meant to tidy the canvas must never cost a paid generation.
   */
  it('hides a generation instead of destroying it when deleted from the canvas', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1', { __studioElementIds: ['el'] })], [], 'g1', []);
    const result = detachSelection(placed.nodes, placed.edges, ['g1']);

    expect(result.hidden).toBe(1);
    expect(result.deleted).toBe(0);
    // Still in state — the feed reads it — but no longer drawn.
    expect(result.nodes.map((node) => node.id)).toEqual(['g1']);
    expect(visibleCanvasNodes(result.nodes)).toEqual([]);
  });

  /**
   * A hidden node that stays flagged selected is invisible but still counted:
   * it pulls the multi-select bounding box toward a position nothing is drawn
   * at, which is what sent the floating Group button off above the selection.
   */
  it('drops the selection flag when a generation is hidden', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1')], [], 'g1', []);
    const selected = placed.nodes.map((node) => (
      node.id === 'g1' ? { ...node, selected: true } : node
    ));

    const hidden = removeStudioNodeFromCanvas(selected, placed.edges, 'g1');
    expect(hidden.nodes.find((node) => node.id === 'g1')?.selected).toBe(false);
    expect(visibleCanvasNodes(hidden.nodes).filter((node) => node.selected)).toEqual([]);
  });

  it('still deletes hand-built nodes outright', () => {
    const result = detachSelection([authored('a1'), authored('a2')], [], ['a1']);
    expect(result.deleted).toBe(1);
    expect(result.hidden).toBe(0);
    expect(result.nodes.map((node) => node.id)).toEqual(['a2']);
  });

  it('hides the generations and deletes the authored nodes in a mixed selection', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1'), authored('a1')], [], 'g1', []);
    const result = detachSelection(placed.nodes, placed.edges, ['g1', 'a1']);

    expect(result.hidden).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.nodes.map((node) => node.id)).toEqual(['g1']);
    expect(isPlacedOnCanvas(result.nodes[0])).toBe(false);
  });

  it('marks only placed generations as hide-on-delete', () => {
    const placed = placeStudioNodeOnCanvas([generation('g1'), authored('a1')], [], 'g1', []);
    expect(isHideOnDelete(placed.nodes.find((node) => node.id === 'g1')!)).toBe(true);
    expect(isHideOnDelete(placed.nodes.find((node) => node.id === 'a1')!)).toBe(false);
    // A generation that was never placed is not on the canvas to be deleted.
    expect(isHideOnDelete(generation('g9'))).toBe(false);
  });

  it('lays placed clips out clear of authored work rather than on top of it', () => {
    const slot = nextPlacedSlot([authored('a1', 400, 200)]);
    expect(slot.x).toBeGreaterThan(400);
    expect(slot.y).toBe(200);
  });

  it('does not count hidden generations when choosing the next slot', () => {
    const base = [authored('a1'), generation('g1'), generation('g2'), generation('g3')];
    expect(nextPlacedSlot(base)).toEqual(nextPlacedSlot([authored('a1')]));
  });
});
