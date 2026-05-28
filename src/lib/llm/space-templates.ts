import type { Node, Edge } from '@xyflow/react';
import type { Element } from '@/types/elements';
import type { WorkflowNodeData } from '@/types/workflow';
import type { WorkflowSpace } from '@/types/workspace';
import { ALL_MODELS } from '@/lib/fal/models';
import { planVideoClips } from '@/lib/llm/shot-list-planner';
import { parseShotListFromMarkdown } from '@/lib/llm/shot-list-parse';
import { generateId, timestamp } from '@/lib/utils/ids';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';

export type SpaceTemplateId =
  | 'storyboard'
  | 'storyboard-images'
  | 'shot-ideas'
  | 'multi-shot'
  | 'b-roll'
  | 'video-from-shot-list';

export interface SpacePromptEntry {
  label?: string;
  prompt: string;
  duration?: number;
  elementId?: string;
  elementName?: string;
}

export interface VideoClipGroupSpec {
  label?: string;
  mode?: 'seedance-single' | 'kling-multi';
  totalDuration?: number;
  combinedPrompt?: string;
  shots: SpacePromptEntry[];
}

export interface SpacePrefill {
  scene?: string;
  prompts?: Array<string | SpacePromptEntry>;
  elementIds?: string[];
  clipGroups?: VideoClipGroupSpec[];
  combineShots?: boolean;
}

const ROW_HEIGHT = 320;
const SCENE_ROW_HEIGHT = 220;
const ELEMENT_ROW_HEIGHT = 180;
const ELEMENT_X = 40;
const PROMPT_X = 280;
const MODEL_X = 620;
const OUTPUT_X = 980;
const BASE_Y = 80;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizePrefillPrompts(prefill?: SpacePrefill): SpacePromptEntry[] {
  if (!prefill?.prompts?.length) return [];
  return prefill.prompts
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return { label: `Shot ${index + 1}`, prompt: entry.trim(), duration: 5 };
      }
      return {
        label: entry.label ?? `Shot ${index + 1}`,
        prompt: entry.prompt.trim(),
        duration: entry.duration ?? 5,
        elementId: entry.elementId,
        elementName: entry.elementName,
      };
    })
    .filter((entry) => entry.prompt.length > 0);
}

function normalizeClipGroups(prefill: SpacePrefill, prompts: SpacePromptEntry[]): VideoClipGroupSpec[] {
  if (prefill.clipGroups?.length) {
    return prefill.clipGroups
      .map((group) => ({
        label: group.label,
        mode: group.mode ?? (group.shots.length > 1 ? 'kling-multi' : 'seedance-single'),
        totalDuration: group.totalDuration,
        combinedPrompt: group.combinedPrompt,
        shots: group.shots.filter((shot) => shot.prompt.trim().length > 0),
      }))
      .filter((group) => group.shots.length > 0);
  }

  const parsedShots = parseShotListFromMarkdown(
    prompts.map((entry) => `### ${entry.label ?? 'Shot'}\n**Prompt:** ${entry.prompt}`).join('\n\n'),
  );
  const sourceShots = parsedShots.length > 0 ? parsedShots : prompts.map((entry, index) => ({
    number: index + 1,
    label: entry.label ?? `Shot ${index + 1}`,
    imagePrompt: entry.prompt,
    durationSeconds: entry.duration,
    sectionText: '',
  }));

  return planVideoClips(sourceShots, {
    combineShots: prefill.combineShots ?? false,
  }).map((plan) => ({
    label: plan.label,
    mode: plan.mode,
    totalDuration: plan.totalDuration,
    combinedPrompt: plan.combinedPrompt,
    shots: plan.shots,
  }));
}

export function resolveElementMentionsInPrompt(prompt: string, elements: Element[]): string {
  let result = prompt;
  for (const element of elements) {
    const pattern = new RegExp(`(?<!@)\\b${escapeRegExp(element.name)}\\b`, 'g');
    result = result.replace(pattern, `@${element.name}`);
  }
  return result;
}

function createEdge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Edge {
  return {
    id: generateId(),
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

function createPromptNode(params: {
  x: number;
  y: number;
  label: string;
  prompt: string;
}): Node<WorkflowNodeData> {
  const definition = NODE_REGISTRY.prompt;
  return {
    id: generateId(),
    type: 'prompt',
    position: { x: params.x, y: params.y },
    data: {
      type: 'prompt',
      label: params.label,
      config: { ...definition.defaultData, prompt: params.prompt },
    },
  };
}

function createMultiPromptNode(params: {
  x: number;
  y: number;
  label: string;
  shots: SpacePromptEntry[];
}): Node<WorkflowNodeData> {
  const definition = NODE_REGISTRY.multiPrompt;
  return {
    id: generateId(),
    type: 'multiPrompt',
    position: { x: params.x, y: params.y },
    data: {
      type: 'multiPrompt',
      label: params.label,
      config: {
        ...definition.defaultData,
        shots: params.shots.map((shot) => ({
          prompt: shot.prompt,
          duration: shot.duration ?? 5,
        })),
      },
    },
  };
}

function createModelNode(params: {
  x: number;
  y: number;
  modelId: 'nano-banana-2' | 'seedance-2' | 'kling-3-text';
  label?: string;
  config?: Record<string, unknown>;
}): Node<WorkflowNodeData> {
  const model = ALL_MODELS[params.modelId];
  const definition = NODE_REGISTRY[model.nodeType];
  return {
    id: generateId(),
    type: model.nodeType,
    position: { x: params.x, y: params.y },
    data: {
      type: model.nodeType,
      label: params.label ?? model.name,
      config: {
        ...definition.defaultData,
        __modelId: model.id,
        ...params.config,
      },
    },
  };
}

function createAssetOutputNode(params: {
  x: number;
  y: number;
  name: string;
}): Node<WorkflowNodeData> {
  const definition = NODE_REGISTRY.assetOutput;
  return {
    id: generateId(),
    type: 'assetOutput',
    position: { x: params.x, y: params.y },
    data: {
      type: 'assetOutput',
      label: 'Asset Output',
      config: { ...definition.defaultData, name: params.name },
    },
  };
}

function createElementNode(params: {
  x: number;
  y: number;
  elementId: string;
  label: string;
}): Node<WorkflowNodeData> {
  const definition = NODE_REGISTRY.element;
  return {
    id: generateId(),
    type: 'element',
    position: { x: params.x, y: params.y },
    data: {
      type: 'element',
      label: params.label,
      config: { ...definition.defaultData, elementId: params.elementId },
    },
  };
}

function collectElementIds(
  prompts: SpacePromptEntry[],
  elements: Element[],
  extraElementIds: string[] = [],
): string[] {
  const ids = new Set<string>(extraElementIds);
  for (const entry of prompts) {
    if (entry.elementId) ids.add(entry.elementId);
    for (const match of entry.prompt.matchAll(/@([^\s@]+(?:\s+[^\s@]+)*)/g)) {
      const name = match[1].trim();
      const element = elements.find((candidate) => candidate.name === name);
      if (element) ids.add(element.id);
    }
  }
  return [...ids];
}

function appendElementNodes(
  nodes: Node<WorkflowNodeData>[],
  elementIds: string[],
  elements: Element[],
  edges: Edge[],
  modelNodeIdByElementId: Map<string, string>,
): void {
  let y = BASE_Y;
  for (const elementId of elementIds) {
    const element = elements.find((candidate) => candidate.id === elementId);
    if (!element) continue;
    const elementNode = createElementNode({
      x: ELEMENT_X,
      y,
      elementId: element.id,
      label: element.name,
    });
    nodes.push(elementNode);
    modelNodeIdByElementId.set(element.id, elementNode.id);
    y += ELEMENT_ROW_HEIGHT;
  }
}

function findElementIdForPrompt(prompt: string, elements: Element[]): string | undefined {
  for (const match of prompt.matchAll(/@([^\s@]+(?:\s+[^\s@]+)*)/g)) {
    const name = match[1].trim();
    const element = elements.find((candidate) => candidate.name === name);
    if (element) return element.id;
  }
  return undefined;
}

function buildStoryboardImagesLayout(
  prompts: SpacePromptEntry[],
  elements: Element[],
  prefill: SpacePrefill,
): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] } {
  const nodes: Node<WorkflowNodeData>[] = [];
  const edges: Edge[] = [];
  let y = BASE_Y;

  if (prefill.scene?.trim()) {
    nodes.push(createPromptNode({
      x: PROMPT_X,
      y,
      label: 'Scene',
      prompt: prefill.scene.trim(),
    }));
    y += SCENE_ROW_HEIGHT;
  }

  const elementIds = collectElementIds(prompts, elements, prefill.elementIds ?? []);
  const elementNodeIds = new Map<string, string>();
  appendElementNodes(nodes, elementIds, elements, edges, elementNodeIds);

  prompts.forEach((entry, index) => {
    const label = entry.label ?? `Panel ${index + 1}`;
    const promptText = resolveElementMentionsInPrompt(entry.prompt, elements);
    const promptNode = createPromptNode({
      x: PROMPT_X,
      y,
      label,
      prompt: promptText,
    });
    const modelNode = createModelNode({
      x: MODEL_X,
      y,
      modelId: 'nano-banana-2',
      label: `Nano Banana 2 · ${label}`,
    });
    const outputNode = createAssetOutputNode({
      x: OUTPUT_X,
      y,
      name: label,
    });

    nodes.push(promptNode, modelNode, outputNode);
    edges.push(
      createEdge(promptNode.id, 'text', modelNode.id, 'prompt'),
      createEdge(modelNode.id, 'image', outputNode.id, 'image'),
    );

    const elementId = entry.elementId ?? findElementIdForPrompt(promptText, elements);
    if (elementId) {
      const elementNodeId = elementNodeIds.get(elementId);
      if (elementNodeId) {
        edges.push(createEdge(elementNodeId, 'element', modelNode.id, 'image_url'));
      }
    }

    y += ROW_HEIGHT;
  });

  return { nodes, edges };
}

function buildVideoFromShotListLayout(
  prefill: SpacePrefill,
  elements: Element[],
): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] } {
  const prompts = normalizePrefillPrompts(prefill);
  const clipGroups = normalizeClipGroups(prefill, prompts);
  const nodes: Node<WorkflowNodeData>[] = [];
  const edges: Edge[] = [];
  let y = BASE_Y;

  if (prefill.scene?.trim()) {
    nodes.push(createPromptNode({
      x: PROMPT_X,
      y,
      label: 'Scene / Brief',
      prompt: prefill.scene.trim(),
    }));
    y += SCENE_ROW_HEIGHT;
  }

  const allShots = clipGroups.flatMap((group) => group.shots);
  const elementIds = collectElementIds(allShots, elements, prefill.elementIds ?? []);
  const elementNodeIds = new Map<string, string>();
  appendElementNodes(nodes, elementIds, elements, edges, elementNodeIds);

  for (const [index, group] of clipGroups.entries()) {
    const label = group.label ?? `Clip ${index + 1}`;
    const mode = group.mode ?? (group.shots.length > 1 ? 'kling-multi' : 'seedance-single');
    const duration = String(group.totalDuration ?? group.shots.reduce((sum, shot) => sum + (shot.duration ?? 5), 0));

    if (mode === 'kling-multi' && group.shots.length > 1) {
      const resolvedShots = group.shots.map((shot) => ({
        ...shot,
        prompt: resolveElementMentionsInPrompt(shot.prompt, elements),
      }));
      const multiPromptNode = createMultiPromptNode({
        x: PROMPT_X,
        y,
        label,
        shots: resolvedShots,
      });
      const modelNode = createModelNode({
        x: MODEL_X,
        y,
        modelId: 'kling-3-text',
        label: `Kling 3 · ${label}`,
        config: { duration },
      });
      const outputNode = createAssetOutputNode({
        x: OUTPUT_X,
        y,
        name: label,
      });

      nodes.push(multiPromptNode, modelNode, outputNode);
      edges.push(
        createEdge(multiPromptNode.id, 'multi_prompt', modelNode.id, 'multi_prompt'),
        createEdge(modelNode.id, 'video', outputNode.id, 'video'),
      );
    } else {
      const promptText = resolveElementMentionsInPrompt(
        group.combinedPrompt ?? group.shots.map((shot) => shot.prompt).join(' Cut to: '),
        elements,
      );
      const promptNode = createPromptNode({
        x: PROMPT_X,
        y,
        label,
        prompt: promptText,
      });
      const modelNode = createModelNode({
        x: MODEL_X,
        y,
        modelId: 'seedance-2',
        label: `Seedance 2 · ${label}`,
        config: { duration },
      });
      const outputNode = createAssetOutputNode({
        x: OUTPUT_X,
        y,
        name: label,
      });

      nodes.push(promptNode, modelNode, outputNode);
      edges.push(
        createEdge(promptNode.id, 'text', modelNode.id, 'prompt'),
        createEdge(modelNode.id, 'video', outputNode.id, 'video'),
      );

      const elementId = findElementIdForPrompt(promptText, elements);
      if (elementId) {
        const elementNodeId = elementNodeIds.get(elementId);
        if (elementNodeId) {
          edges.push(createEdge(elementNodeId, 'element', modelNode.id, 'image_url'));
        }
      }
    }

    y += ROW_HEIGHT;
  }

  return { nodes, edges };
}

function buildLegacyStoryboardLayout(
  prompts: SpacePromptEntry[],
  elements: Element[],
  prefill: SpacePrefill,
): Node<WorkflowNodeData>[] {
  return buildStoryboardImagesLayout(prompts, elements, prefill).nodes;
}

function buildMultiPromptLayout(
  prompts: SpacePromptEntry[],
  elements: Element[],
  prefill: SpacePrefill,
): Node<WorkflowNodeData>[] {
  const nodes: Node<WorkflowNodeData>[] = [];
  let y = BASE_Y;

  if (prefill.scene?.trim()) {
    nodes.push(createPromptNode({
      x: PROMPT_X,
      y,
      label: 'Scene / Brief',
      prompt: prefill.scene.trim(),
    }));
    y += SCENE_ROW_HEIGHT;
  }

  const resolvedPrompts = prompts.map((entry, index) => ({
    ...entry,
    label: entry.label ?? `Shot ${index + 1}`,
    prompt: resolveElementMentionsInPrompt(entry.prompt, elements),
  }));

  if (resolvedPrompts.length > 0) {
    nodes.push(createMultiPromptNode({ x: PROMPT_X, y, label: 'Multi Prompt', shots: resolvedPrompts }));
  }

  const elementIds = collectElementIds(resolvedPrompts, elements, prefill.elementIds ?? []);
  const elementNodeIds = new Map<string, string>();
  appendElementNodes(nodes, elementIds, elements, [], elementNodeIds);
  return nodes;
}

export function buildSpaceFromTemplate(
  name: string,
  template: SpaceTemplateId,
  prefill: SpacePrefill,
  elements: Element[],
): WorkflowSpace {
  const prompts = normalizePrefillPrompts(prefill);

  if (template === 'storyboard-images' || template === 'storyboard') {
    const { nodes, edges } = buildStoryboardImagesLayout(prompts, elements, prefill);
    return {
      id: generateId(),
      name: name.trim() || 'Copilot Space',
      createdAt: timestamp(),
      nodes,
      edges,
    };
  }

  if (template === 'video-from-shot-list') {
    const { nodes, edges } = buildVideoFromShotListLayout(prefill, elements);
    return {
      id: generateId(),
      name: name.trim() || 'Copilot Space',
      createdAt: timestamp(),
      nodes,
      edges,
    };
  }

  const nodes = template === 'shot-ideas' || template === 'b-roll' || template === 'multi-shot'
    ? buildMultiPromptLayout(prompts, elements, prefill)
    : buildLegacyStoryboardLayout(prompts, elements, prefill);

  return {
    id: generateId(),
    name: name.trim() || 'Copilot Space',
    createdAt: timestamp(),
    nodes,
    edges: [] as Edge[],
  };
}
