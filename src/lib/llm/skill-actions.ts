import type { Edge, Node } from '@xyflow/react';
import type { Element, ElementType } from '@/types/elements';
import type { Asset } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import type { ProjectTab } from '@/types/workspace';
import type { WorkflowNodeData } from '@/types/workflow';
import type { WorkflowSpace } from '@/types/workspace';
import {
  applyTimelineEditOps,
  resolveTimelineTarget,
  type TimelineEditOp,
} from '@/lib/llm/copilot-timeline-ops';
import {
  buildNodesFromSpecs,
  resolveSpaceTarget,
  type CopilotNodeSpec,
  type CopilotWireSpec,
} from '@/lib/llm/space-node-factory';
import {
  buildSpaceFromTemplate,
  normalizePrefillPrompts,
  type SpacePrefill,
  type SpacePromptEntry,
  type SpaceTemplateId,
  type VideoClipGroupSpec,
} from '@/lib/llm/space-templates';
import { generateId, timestamp } from '@/lib/utils/ids';

export { COPILOT_ACTIONS_GUIDE } from '@/lib/llm/copilot-actions-guide';

export type SkillActionTab = ProjectTab | 'spaces';

export interface SkillNavigateStep {
  type: 'navigate';
  tab: SkillActionTab;
}

export interface SkillCreateSpaceStep {
  type: 'create_space';
  name: string;
  template: SpaceTemplateId;
  prefill?: SpacePrefill;
}

export interface SkillAddNodesStep {
  type: 'add_nodes';
  spaceId?: string;
  nodes: CopilotNodeSpec[];
  wire?: CopilotWireSpec[];
  navigate?: boolean;
}

export interface SkillSaveElementsStep {
  type: 'save_elements';
  items: Array<{
    kind: ElementType | 'select';
    name: string;
    notes?: string;
    description?: string;
  }>;
}

export interface SkillEditTimelineStep {
  type: 'edit_timeline';
  timelineId?: string;
  ops: TimelineEditOp[];
}

export type SkillActionStep =
  | SkillNavigateStep
  | SkillCreateSpaceStep
  | SkillAddNodesStep
  | SkillSaveElementsStep
  | SkillEditTimelineStep;

export interface SkillActionPayload {
  label: string;
  steps: SkillActionStep[];
}

export interface CopilotActionContext {
  elements: Element[];
  spaces: WorkflowSpace[];
  activeSpaceId: string;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  timelines: Timeline[];
  activeTimelineId: string;
  assets: Asset[];
}

export type CopilotActionDispatch = (action: WorkspaceCopilotAction) => void;

export type WorkspaceCopilotAction =
  | { type: 'SET_TAB'; tab: ProjectTab }
  | { type: 'ADD_SPACE'; space: ReturnType<typeof buildSpaceFromTemplate> }
  | { type: 'OPEN_SPACE'; spaceId: string }
  | { type: 'SET_ACTIVE_SPACE'; spaceId: string }
  | { type: 'SET_NODES'; nodes: Node<WorkflowNodeData>[] }
  | { type: 'SET_EDGES'; edges: Edge[] }
  | { type: 'ADD_ELEMENT'; element: Element }
  | { type: 'SET_TIMELINE'; timelineId: string; timeline: Timeline };

const SKILL_ACTION_PATTERN = /```cinegen-skill-action\s*\n([\s\S]*?)```/i;
const SHOT_SECTION_PATTERN = /^###\s+(.+)$/gm;
const PROMPT_FIELD_PATTERN = /\*\*(?:Image\s+)?[Pp]rompt:\*\*\s*(?:\n)?(?:>\s*)?(?:\*"([^"]+)"\*|\*"([^"]+)"\*|"([^"]+)"|'([^']+)'|([^\n]+))/i;
const STANDALONE_PROMPT_PATTERN = /\*\*(?:Prompt|Image\s+prompt|Video prompt):\*\*\s*(.+)/gi;
const PLAIN_PROMPT_BLOCK_PATTERN = /(?:^|\n)\*{0,2}(?:Image\s+)?[Pp]rompt:\*{0,2}\s*\n+([\s\S]*?)(?=\n\n(?:Want me to|If you|\*\*|[A-Z])|\nWant me to|$)/i;

export function userRequestedNodeOrAppAction(userMessage: string | undefined): boolean {
  if (!userMessage?.trim()) return false;
  const text = userMessage.trim();
  return /\b(?:add|create|give|make|build|put|insert|generate)\b.{0,48}\b(?:node|prompt|workspace|spaces?|generation)\b/i.test(text)
    || /\bnode for shot\b/i.test(text)
    || /\b(?:add|create)\b.{0,24}\b(?:to|in|on)\b.{0,32}\b(?:space|workspace|spaces)\b/i.test(text)
    || /\bgive me a (?:node|prompt)\b/i.test(text);
}

function assistantOffersToAddPrompt(content: string): boolean {
  return /\b(?:want me to add|should i add|add this prompt|add to the active|as a generation node)\b/i.test(content);
}

function inferPromptLabel(content: string, index: number): string {
  const shotMatch = content.match(/(?:Bonus\s*[—–-]\s*)?(?:Shot|Panel)\s*(\d+)(?:\s*[\/—–-]\s*([^\n]+))?/i);
  if (shotMatch) {
    const suffix = shotMatch[2]?.trim();
    return suffix
      ? `Shot ${shotMatch[1]} — ${suffix}`
      : `Shot ${shotMatch[1]}`;
  }
  return index === 0 ? 'Prompt' : `Prompt ${index + 1}`;
}

const VALID_SPACE_TEMPLATES = [
  'storyboard',
  'storyboard-images',
  'shot-ideas',
  'multi-shot',
  'b-roll',
  'video-from-shot-list',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeTab(tab: string): ProjectTab | null {
  if (tab === 'spaces') return 'create';
  if (tab === 'elements' || tab === 'create' || tab === 'edit' || tab === 'llm' || tab === 'export' || tab === 'settings') {
    return tab;
  }
  return null;
}

function normalizeNodeSpecs(raw: unknown): CopilotNodeSpec[] {
  if (!Array.isArray(raw)) return [];
  const nodes: CopilotNodeSpec[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const nodeType = typeof entry.nodeType === 'string'
      ? entry.nodeType
      : typeof entry.type === 'string'
        ? entry.type
        : '';
    if (!nodeType) continue;
    nodes.push({
      nodeType,
      label: typeof entry.label === 'string' ? entry.label : undefined,
      config: isRecord(entry.config) ? entry.config : undefined,
      position: isRecord(entry.position)
        ? {
            x: typeof entry.position.x === 'number' ? entry.position.x : undefined,
            y: typeof entry.position.y === 'number' ? entry.position.y : undefined,
          }
        : undefined,
    });
  }
  return nodes;
}

function normalizeWireSpecs(raw: unknown): CopilotWireSpec[] {
  if (!Array.isArray(raw)) return [];
  const wires: CopilotWireSpec[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    if (
      typeof entry.from !== 'number'
      || typeof entry.to !== 'number'
      || typeof entry.sourceHandle !== 'string'
      || typeof entry.targetHandle !== 'string'
    ) {
      continue;
    }
    wires.push({
      from: entry.from,
      to: entry.to,
      sourceHandle: entry.sourceHandle,
      targetHandle: entry.targetHandle,
    });
  }
  return wires;
}

function normalizeTimelineOps(raw: unknown): TimelineEditOp[] {
  if (!Array.isArray(raw)) return [];
  const ops: TimelineEditOp[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.op !== 'string') continue;
    switch (entry.op) {
      case 'split_clip':
        if (typeof entry.clipId === 'string' && typeof entry.time === 'number') {
          ops.push({ op: 'split_clip', clipId: entry.clipId, time: entry.time });
        }
        break;
      case 'trim_clip':
        if (typeof entry.clipId === 'string') {
          ops.push({
            op: 'trim_clip',
            clipId: entry.clipId,
            trimStart: typeof entry.trimStart === 'number' ? entry.trimStart : 0,
            trimEnd: typeof entry.trimEnd === 'number' ? entry.trimEnd : 0,
            startTime: typeof entry.startTime === 'number' ? entry.startTime : undefined,
          });
        }
        break;
      case 'remove_clip':
        if (typeof entry.clipId === 'string') {
          ops.push({ op: 'remove_clip', clipId: entry.clipId });
        }
        break;
      case 'close_gaps':
        ops.push({
          op: 'close_gaps',
          maxGapSec: typeof entry.maxGapSec === 'number' ? entry.maxGapSec : undefined,
          ripple: typeof entry.ripple === 'boolean' ? entry.ripple : undefined,
        });
        break;
      case 'add_markers':
        if (Array.isArray(entry.markers)) {
          const markers = entry.markers
            .map((marker) => {
              if (!isRecord(marker) || typeof marker.time !== 'number' || typeof marker.label !== 'string') {
                return null;
              }
              return {
                time: marker.time,
                label: marker.label,
                color: typeof marker.color === 'string' ? marker.color : undefined,
              };
            })
            .filter((marker): marker is NonNullable<typeof marker> => marker !== null);
          if (markers.length > 0) ops.push({ op: 'add_markers', markers });
        }
        break;
      default:
        break;
    }
  }
  return ops;
}

function normalizeClipGroups(raw: unknown): VideoClipGroupSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const groups: VideoClipGroupSpec[] = [];

  for (const entry of raw) {
    if (!isRecord(entry) || !Array.isArray(entry.shots)) continue;
    const shots: SpacePromptEntry[] = [];
    for (const shot of entry.shots) {
      if (typeof shot === 'string') {
        const prompt = shot.trim();
        if (prompt) shots.push({ prompt, duration: 5 });
        continue;
      }
      if (!isRecord(shot) || typeof shot.prompt !== 'string') continue;
      const prompt = shot.prompt.trim();
      if (!prompt) continue;
      shots.push({
        label: typeof shot.label === 'string' ? shot.label : undefined,
        prompt,
        duration: typeof shot.duration === 'number' ? shot.duration : undefined,
        elementId: typeof shot.elementId === 'string' ? shot.elementId : undefined,
        elementName: typeof shot.elementName === 'string' ? shot.elementName : undefined,
      });
    }
    if (shots.length === 0) continue;
    groups.push({
      label: typeof entry.label === 'string' ? entry.label : undefined,
      mode: entry.mode === 'seedance-single' || entry.mode === 'kling-multi' ? entry.mode : undefined,
      totalDuration: typeof entry.totalDuration === 'number' ? entry.totalDuration : undefined,
      combinedPrompt: typeof entry.combinedPrompt === 'string' ? entry.combinedPrompt : undefined,
      shots,
    });
  }

  return groups.length > 0 ? groups : undefined;
}

function normalizeCreateSpaceStep(raw: Record<string, unknown>): SkillCreateSpaceStep | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const template = typeof raw.template === 'string' ? raw.template.trim() : '';
  if (!name || !VALID_SPACE_TEMPLATES.includes(template as typeof VALID_SPACE_TEMPLATES[number])) {
    return null;
  }

  const prefillRaw = isRecord(raw.prefill) ? raw.prefill : undefined;
  const prefill: SpacePrefill | undefined = prefillRaw
    ? {
        scene: typeof prefillRaw.scene === 'string' ? prefillRaw.scene : undefined,
        elementIds: Array.isArray(prefillRaw.elementIds)
          ? prefillRaw.elementIds.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
        prompts: Array.isArray(prefillRaw.prompts) ? prefillRaw.prompts as SpacePrefill['prompts'] : undefined,
        clipGroups: normalizeClipGroups(prefillRaw.clipGroups),
        combineShots: typeof prefillRaw.combineShots === 'boolean' ? prefillRaw.combineShots : undefined,
      }
    : undefined;

  return {
    type: 'create_space',
    name,
    template: template as SpaceTemplateId,
    prefill,
  };
}

function normalizeSkillActionPayload(raw: unknown): SkillActionPayload | null {
  if (!isRecord(raw)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!label || !Array.isArray(raw.steps) || raw.steps.length === 0) return null;

  const steps: SkillActionStep[] = [];
  for (const step of raw.steps) {
    if (!isRecord(step) || typeof step.type !== 'string') continue;
    if (step.type === 'navigate') {
      const tab = typeof step.tab === 'string' ? normalizeTab(step.tab) : null;
      if (tab) steps.push({ type: 'navigate', tab });
      continue;
    }
    if (step.type === 'create_space') {
      const createStep = normalizeCreateSpaceStep(step);
      if (createStep) steps.push(createStep);
      continue;
    }
    if (step.type === 'add_nodes') {
      const nodes = normalizeNodeSpecs(step.nodes);
      if (nodes.length === 0) continue;
      steps.push({
        type: 'add_nodes',
        spaceId: typeof step.spaceId === 'string' ? step.spaceId : undefined,
        nodes,
        wire: normalizeWireSpecs(step.wire),
        navigate: step.navigate !== false,
      });
      continue;
    }
    if (step.type === 'save_elements') {
      if (!Array.isArray(step.items)) continue;
      const items = step.items
        .map((item) => {
          if (!isRecord(item) || typeof item.name !== 'string') return null;
          const kind = typeof item.kind === 'string' ? item.kind : 'character';
          if (!['character', 'location', 'prop', 'vehicle', 'select'].includes(kind)) return null;
          return {
            kind: kind as ElementType | 'select',
            name: item.name.trim(),
            notes: typeof item.notes === 'string' ? item.notes : undefined,
            description: typeof item.description === 'string' ? item.description : undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item?.name));
      if (items.length > 0) steps.push({ type: 'save_elements', items });
      continue;
    }
    if (step.type === 'edit_timeline') {
      const ops = normalizeTimelineOps(step.ops);
      if (ops.length === 0) continue;
      steps.push({
        type: 'edit_timeline',
        timelineId: typeof step.timelineId === 'string' ? step.timelineId : undefined,
        ops,
      });
    }
  }

  if (steps.length === 0) return null;
  return { label, steps };
}

export function parseSkillActionFromContent(content: string): SkillActionPayload | null {
  const match = content.match(SKILL_ACTION_PATTERN);
  if (!match) return null;
  try {
    return normalizeSkillActionPayload(JSON.parse(match[1].trim()));
  } catch {
    return null;
  }
}

export function stripSkillActionBlock(content: string): string {
  return content.replace(SKILL_ACTION_PATTERN, '').trim();
}

function parseDurationFromSection(section: string): number | undefined {
  const match = section.match(/\*\*Duration:\*\*\s*(\d+)/i);
  if (!match) return undefined;
  const duration = Number(match[1]);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function extractPromptFromSection(section: string): string {
  const fieldMatch = section.match(PROMPT_FIELD_PATTERN);
  if (fieldMatch) {
    return (fieldMatch[1] || fieldMatch[2] || fieldMatch[3] || fieldMatch[4] || fieldMatch[5] || '').trim();
  }

  const quotedMatch = section.match(/\*\s+\*\*Prompt:\*\*\s*\n?\s*(?:>\s*)?(?:\*([^*]+)\*|_"([^"]+)"_)/i);
  if (quotedMatch) {
    return (quotedMatch[1] || quotedMatch[2] || '').trim();
  }

  return '';
}

export function extractShotPromptsFromMarkdown(content: string): SpacePromptEntry[] {
  const entries: SpacePromptEntry[] = [];
  const matches = [...content.matchAll(SHOT_SECTION_PATTERN)];

  for (const match of matches) {
    const header = match[1]?.trim() ?? '';
    if (!header || !/(shot|panel|beat|scene|closing|wide|insert|drone)/i.test(header)) {
      continue;
    }

    const start = (match.index ?? 0) + match[0].length;
    const nextHeader = content.slice(start).search(/^###\s+/m);
    const section = nextHeader >= 0 ? content.slice(start, start + nextHeader) : content.slice(start);
    const prompt = extractPromptFromSection(section);
    if (!prompt) continue;

    entries.push({
      label: header.replace(/^(?:Shot|Panel)\s*/i, '').trim() || header,
      prompt,
      duration: parseDurationFromSection(section),
    });
  }

  return entries;
}

export function extractStandalonePrompts(content: string): Array<{ label: string; prompt: string }> {
  const entries: Array<{ label: string; prompt: string }> = [];
  const seen = new Set<string>();

  const pushPrompt = (raw: string, labelIndex: number) => {
    const cleaned = raw
      .replace(/^>\s?/gm, '')
      .replace(/^\*+"?|"?\*+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 16 || seen.has(cleaned)) return;
    seen.add(cleaned);
    entries.push({
      label: inferPromptLabel(content, labelIndex),
      prompt: cleaned,
    });
  };

  for (const match of content.matchAll(STANDALONE_PROMPT_PATTERN)) {
    pushPrompt(match[1], entries.length);
  }

  const blockMatch = content.match(PLAIN_PROMPT_BLOCK_PATTERN);
  if (blockMatch?.[1]) {
    pushPrompt(blockMatch[1], entries.length);
  }

  const fieldMatch = content.match(PROMPT_FIELD_PATTERN);
  if (fieldMatch) {
    pushPrompt(
      fieldMatch[1] || fieldMatch[2] || fieldMatch[3] || fieldMatch[4] || fieldMatch[5] || '',
      entries.length,
    );
  }

  const fencedMatch = content.match(/```(?:prompt|text)?\n([\s\S]+?)```/i);
  if (fencedMatch) {
    pushPrompt(fencedMatch[1], entries.length);
  }

  return entries;
}

function inferSpaceName(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 64);
  const themed = content.match(/(?:shot list|storyboard)(?:\s+for)?\s+(.+?)(?:[\.\n]|$)/i)?.[1]?.trim();
  if (themed) return themed.slice(0, 64);
  return fallback;
}

function inferAddPromptAction(
  content: string,
  context?: {
    activeSpaceName?: string | null;
    activeSkillName?: string | null;
    userMessage?: string | null;
  },
): SkillActionPayload | null {
  const prompts = extractStandalonePrompts(content);
  if (prompts.length === 0) return null;

  const userWantsNode = userRequestedNodeOrAppAction(context?.userMessage ?? undefined);
  const assistantOffers = assistantOffersToAddPrompt(content);
  const isPromptWriter = context?.activeSkillName === 'prompt-writer'
    || /\b(generation prompt|image prompt|video prompt|prompt writer)\b/i.test(content);

  if (!userWantsNode && !assistantOffers && !isPromptWriter && prompts.length !== 1) {
    return null;
  }

  const primary = prompts[0];
  const spaceLabel = context?.activeSpaceName?.trim() || 'active workspace';
  return {
    label: userWantsNode
      ? `Add ${primary.label} to ${spaceLabel}`
      : `Add prompt to ${spaceLabel}`,
    steps: [{
      type: 'add_nodes',
      spaceId: 'active',
      nodes: [{
        nodeType: 'prompt',
        label: primary.label,
        config: { prompt: primary.prompt },
      }],
      navigate: true,
    }],
  };
}

export function resolveSkillActionForMessage(
  content: string,
  options?: {
    activeSkillName?: string | null;
    activeSpaceName?: string | null;
    userMessage?: string | null;
  },
): SkillActionPayload | null {
  const explicit = parseSkillActionFromContent(content);
  if (explicit) return explicit;

  if (options?.activeSkillName === 'shot-list') {
    return null;
  }

  const addPromptAction = inferAddPromptAction(content, options);
  if (addPromptAction) return addPromptAction;

  const prompts = extractShotPromptsFromMarkdown(content);
  if (prompts.length < 2) return null;

  const isVideo = options?.activeSkillName === 'shot-list-video'
    || /\b(video clip|seedance|kling|video-from-shot-list)\b/i.test(content);
  const isStoryboard = options?.activeSkillName === 'storyboard'
    || /\b(storyboard|panel)\b/i.test(content);

  if (isVideo) {
    return {
      label: 'Create video workspace',
      steps: [{
        type: 'create_space',
        name: inferSpaceName(content, 'Video Clips'),
        template: 'video-from-shot-list',
        prefill: { prompts },
      }],
    };
  }

  if (isStoryboard) {
    return {
      label: 'Create storyboard workspace',
      steps: [{
        type: 'create_space',
        name: inferSpaceName(content, 'Storyboard'),
        template: 'storyboard-images',
        prefill: { prompts },
      }],
    };
  }

  return null;
}

export function describeSkillAction(
  action: SkillActionPayload,
  context?: Pick<CopilotActionContext, 'spaces' | 'activeSpaceId' | 'timelines' | 'activeTimelineId'>,
): string {
  const addStep = action.steps.find((step): step is SkillAddNodesStep => step.type === 'add_nodes');
  if (addStep) {
    const target = resolveSpaceTarget(addStep.spaceId, context?.spaces ?? [], context?.activeSpaceId ?? '');
    const spaceName = target?.space.name ?? 'Spaces';
    const nodeCount = addStep.nodes.length;
    const nodeLabel = addStep.nodes[0]?.label ?? addStep.nodes[0]?.nodeType ?? 'node';
    if (nodeCount === 1) return `${spaceName} · ${nodeLabel}`;
    return `${spaceName} · ${nodeCount} nodes`;
  }

  const editStep = action.steps.find((step): step is SkillEditTimelineStep => step.type === 'edit_timeline');
  if (editStep) {
    const timeline = resolveTimelineTarget(
      editStep.timelineId,
      context?.timelines ?? [],
      context?.activeTimelineId ?? '',
    );
    return `${timeline?.name ?? 'Timeline'} · ${editStep.ops.length} edit${editStep.ops.length === 1 ? '' : 's'}`;
  }

  const elementStep = action.steps.find((step): step is SkillSaveElementsStep => step.type === 'save_elements');
  if (elementStep) {
    return `${elementStep.items.length} element${elementStep.items.length === 1 ? '' : 's'}`;
  }

  const createStep = action.steps.find((step): step is SkillCreateSpaceStep => step.type === 'create_space');
  if (!createStep) return action.label;
  const clipCount = createStep.prefill?.clipGroups?.length ?? 0;
  const promptCount = clipCount > 0
    ? clipCount
    : normalizePrefillPrompts(createStep.prefill).length;
  if (promptCount <= 0) return `${createStep.name} workspace`;
  const unit = createStep.template === 'video-from-shot-list' ? 'clip' : 'panel';
  return `${createStep.name} · ${promptCount} ${unit}${promptCount === 1 ? '' : 's'}`;
}

function mapElementKind(kind: ElementType | 'select'): ElementType {
  return kind === 'select' ? 'character' : kind;
}

export function executeSkillAction(
  action: SkillActionPayload,
  dispatch: CopilotActionDispatch,
  context: CopilotActionContext,
): void {
  for (const step of action.steps) {
    if (step.type === 'navigate') {
      const tab = step.tab === 'spaces' ? 'create' : step.tab;
      dispatch({ type: 'SET_TAB', tab });
      continue;
    }

    if (step.type === 'create_space') {
      const space = buildSpaceFromTemplate(
        step.name,
        step.template,
        step.prefill ?? {},
        context.elements,
      );
      dispatch({ type: 'ADD_SPACE', space });
      dispatch({ type: 'SET_TAB', tab: 'create' });
      continue;
    }

    if (step.type === 'add_nodes') {
      const target = resolveSpaceTarget(step.spaceId, context.spaces, context.activeSpaceId);
      if (!target) continue;

      const baseNodes = target.spaceId === context.activeSpaceId
        ? context.nodes
        : target.space.nodes;
      const baseEdges = target.spaceId === context.activeSpaceId
        ? context.edges
        : target.space.edges;

      const createdNodes = buildNodesFromSpecs(step.nodes, baseNodes);
      const mergedNodes = [...baseNodes, ...createdNodes];
      const newEdges = step.wire?.map((wire) => ({
        id: generateId(),
        source: createdNodes[wire.from]?.id ?? '',
        sourceHandle: wire.sourceHandle,
        target: createdNodes[wire.to]?.id ?? '',
        targetHandle: wire.targetHandle,
      })).filter((edge) => edge.source && edge.target) ?? [];

      if (target.spaceId !== context.activeSpaceId) {
        dispatch({ type: 'OPEN_SPACE', spaceId: target.spaceId });
        dispatch({ type: 'SET_ACTIVE_SPACE', spaceId: target.spaceId });
      }

      dispatch({ type: 'SET_NODES', nodes: mergedNodes });
      if (newEdges.length > 0) {
        dispatch({ type: 'SET_EDGES', edges: [...baseEdges, ...newEdges] });
      }
      if (step.navigate !== false) {
        dispatch({ type: 'SET_TAB', tab: 'create' });
      }
      continue;
    }

    if (step.type === 'save_elements') {
      for (const item of step.items) {
        const now = timestamp();
        dispatch({
          type: 'ADD_ELEMENT',
          element: {
            id: generateId(),
            name: item.name,
            type: mapElementKind(item.kind),
            description: item.description ?? item.notes ?? '',
            images: [],
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      dispatch({ type: 'SET_TAB', tab: 'elements' });
      continue;
    }

    if (step.type === 'edit_timeline') {
      const timeline = resolveTimelineTarget(step.timelineId, context.timelines, context.activeTimelineId);
      if (!timeline) continue;
      const updated = applyTimelineEditOps(timeline, step.ops);
      dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
      dispatch({ type: 'SET_TAB', tab: 'edit' });
    }
  }
}
