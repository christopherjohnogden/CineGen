import type { Node } from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';
import type { DirectorShow } from '@/types/director';
import type { WorkflowNodeData } from '@/types/workflow';
import {
  HIGGSFIELD_LLM_CLI_SUPPORTED,
  isDirectorLlmProvider,
  pickInstalledDirectorLlm,
  type DirectorLlmProvider,
  type DirectorLlmReadiness,
} from '@/lib/director/cli-provider';
import type { CliLlmProviderId } from '@/lib/llm/claude-code-session';
import { CUT_PLAN_CLOSE, CUT_PLAN_OPEN } from '@/lib/llm/cut-plan';
import { stripSkillActionBlock, type SkillActionPayload } from '@/lib/llm/skill-actions';
import { ASSISTANT_RESPONSE_STYLE } from '@/lib/llm/response-style';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  applied?: boolean;
  error?: boolean;
}

export interface AssistantThread {
  provider: DirectorLlmProvider;
  messages: AssistantMessage[];
}

export const ASSISTANT_SYSTEM = [
  'You are CineGen Assistant, the always-on chat from the header drawer.',
  'Help with questions and tasks across Elements, Spaces, Director, Edit, and Export.',
  'Answer from ACTIVE PROJECT CONTEXT and DIRECTOR. Be concise and specific.',
  ASSISTANT_RESPONSE_STYLE,
  'When writing image, video, or storyboard prompts, use the exact @Tags from DIRECTOR Tags in the prose (@Peter not Peter, @Sofa not sofa).',
  'Open the prompt with ACTIVE REFERENCES, one line per tag used: "@Tag. 100% matches the reference."',
  'Do not invent face, age, wardrobe, or set dressing for tagged elements — those come from the tagged stills. Untagged extras can be described normally.',
  'Never paste JSON, cinegen-skill-action fences, or cut-plan XML into the readable reply — those blocks are hidden and become a button.',
  'Do not ask "want me to add this" if you already emit the action block.',
  'If the user asks you to change the project, summarize what you will do; the app applies it from the action button.',
  'When SELECTED SPACE NODE is present and the user asks to change that node, emit an update_node action for its exact nodeId. Patch only the requested config fields; do not create a replacement node.',
  'Canvas vision is supplied automatically for the whole active canvas. Identify media from its pixels and match its label, position, and exact nodeId. A selected node is only an optional focus; named or visually described media takes precedence. For an edit to any identified node, use update_node with that nodeId. Ask for clarification only if the intended photo is genuinely ambiguous.',
].join(' ');

export function assistantStorageKey(projectId: string): string {
  return `cinegen_assistant:${projectId}`;
}

export function loadAssistantThread(projectId: string): AssistantThread | null {
  try {
    const raw = localStorage.getItem(assistantStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssistantThread;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    const provider = isDirectorLlmProvider(parsed.provider) ? parsed.provider : 'claude-code';
    const messages = parsed.messages.filter((row) => (
      (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string'
    )).map((row) => ({
      role: row.role,
      content: row.content,
      ...(row.applied ? { applied: true } : {}),
      ...(row.role === 'assistant' && (row.error || /^Error invoking remote method 'llm:/.test(row.content)) ? { error: true } : {}),
    }));
    return { provider, messages };
  } catch {
    return null;
  }
}

export function saveAssistantThread(projectId: string, thread: AssistantThread): void {
  localStorage.setItem(assistantStorageKey(projectId), JSON.stringify(thread));
}

export function pickAssistantProvider(
  preferred: DirectorLlmProvider | undefined,
  providers: Array<{ id: string; installed: boolean; authenticated?: boolean }>,
  readiness: DirectorLlmReadiness = {},
): DirectorLlmProvider {
  return pickInstalledDirectorLlm(preferred ?? 'claude-code', providers, readiness);
}

/** Use the live canvas, not its last persisted Space snapshot. This is node
 * metadata; URLs and filenames alone must never be described as image vision. */
export function canvasAssistantContext(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  space?: { id: string; name: string } | null,
): string {
  const rows = nodes.filter((node) => node.type !== 'group');
  return [
    'ACTIVE CANVAS (live node inventory; supersedes saved Space counts)',
    space ? `Space: ${space.name} (${space.id})` : null,
    `Nodes: ${rows.length}`,
    'This inventory contains names, positions, prompts and connections. Actual images for the whole canvas are supplied separately in CURRENT CANVAS VISION. Use that current manifest to determine what you can see; selection does not limit vision.',
    ...rows.map((node) => {
      const definition = NODE_REGISTRY[node.data.type];
      return JSON.stringify({
        nodeId: node.id,
        type: node.data.type,
        label: node.data.label,
        selected: Boolean(node.selected),
        position: node.position,
        parentId: node.parentId,
        outputs: definition?.outputs.map((port) => port.type),
        config: compactNodeConfig(node.data.config),
        status: node.data.result?.status ?? 'idle',
        hasMedia: Boolean(node.data.result?.url || node.data.config.fileUrl),
      });
    }),
    'Connections:',
    ...edges.map((edge) => `${edge.source}:${edge.sourceHandle ?? 'output'} -> ${edge.target}:${edge.targetHandle ?? 'input'}`),
  ].filter((line): line is string => Boolean(line)).join('\n');
}

const APPLYABLE_STEPS = new Set([
  'navigate', 'create_space', 'add_nodes', 'update_node', 'save_elements', 'edit_timeline',
]);

function compactNodeConfig(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[nested value omitted]';
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return `[data URL omitted · ${value.length} chars]`;
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.slice(0, 24).map((entry) => compactNodeConfig(entry, depth + 1));
  if (typeof value === 'object' && value) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 64)) {
      result[key] = compactNodeConfig(entry, depth + 1);
    }
    return result;
  }
  return String(value);
}

export function selectedNodeAssistantContext(
  node: Node<WorkflowNodeData> | null | undefined,
  space?: { id: string; name: string } | null,
): string {
  if (!node) return '';
  const config = JSON.stringify(compactNodeConfig(node.data.config), null, 2);
  return [
    'SELECTED SPACE NODE (optional focus; all other canvas media remains available)',
    space ? `Space: ${space.name} (${space.id})` : null,
    `nodeId: ${node.id}`,
    `type: ${node.data.type}`,
    `label: ${node.data.label}`,
    node.data.modelId ? `modelId: ${node.data.modelId}` : null,
    `editable config:\n${config}`,
    'For requested edits, use update_node with this exact nodeId and a config patch containing only changed fields.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

const OFFER_TAIL = /\n+(?:want me to add|should i add)[^\n]*\??\s*$/i;

export function visibleAssistantContent(content: string): string {
  let text = stripSkillActionBlock(content);
  const cutOpen = text.indexOf(CUT_PLAN_OPEN);
  if (cutOpen >= 0) {
    const cutClose = text.indexOf(CUT_PLAN_CLOSE, cutOpen);
    if (cutClose >= 0) {
      text = `${text.slice(0, cutOpen)}${text.slice(cutClose + CUT_PLAN_CLOSE.length)}`;
    }
  }
  return text.replace(OFFER_TAIL, '').trim();
}

export function assistantActionRunnable(action: SkillActionPayload): boolean {
  return action.steps.some((step) => APPLYABLE_STEPS.has(step.type));
}

export function assistantProviderReady(
  provider: DirectorLlmProvider,
  installed: Record<CliLlmProviderId, boolean>,
  readiness: DirectorLlmReadiness,
): boolean {
  if (provider === 'fal') return Boolean(readiness.falReady);
  if (provider === 'openai') return Boolean(readiness.openaiReady);
  if (provider === 'higgsfield') return Boolean(readiness.higgsfieldReady && HIGGSFIELD_LLM_CLI_SUPPORTED);
  if (provider === 'luna') return Boolean(installed.codex);
  return Boolean(installed[provider]);
}

export function directorBrief(show: DirectorShow): string {
  const selected = show.clips.find((clip) => clip.id === show.selectedClipId);
  const scenes = show.scenes.slice(0, 12)
    .map((scene) => `SC${scene.number} ${scene.label}`)
    .join(' · ') || 'none';
  const tagLines = show.breakdown.slice(0, 40).map((item) => {
    const note = (item.blurb || item.description).replace(/\s+/g, ' ').trim().slice(0, 72);
    return `- ${item.kind} ${normalizeBriefTag(item.tag)} ${item.name}${note ? ` — ${note}` : ''}`;
  });
  const clips = show.clips
    .filter((clip) => !clip.altOf)
    .slice(0, 16)
    .map((clip) => formatBriefClip(clip, clip.id === show.selectedClipId));
  return [
    'DIRECTOR',
    `Page: ${show.mode ?? 'source'}`,
    selected ? `Selected clip: ${selected.title}` : null,
    `Scenes: ${scenes}`,
    tagLines.length > 0 ? `Tags:\n${tagLines.join('\n')}` : 'Tags: none — do not invent @Tags',
    clips.length > 0 ? `Clips:\n${clips.join('\n')}` : 'Clips: none',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function stampDirectorTags(text: string, show: DirectorShow): string {
  const replacements = briefTagReplacements(show);
  let result = text;
  for (const { pattern, tag } of replacements) {
    result = result.replace(pattern, tag);
  }
  return result;
}

function normalizeBriefTag(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function formatBriefClip(clip: DirectorShow['clips'][number], selected: boolean): string {
  const tags = clip.elementTags.length > 0 ? ` ${clip.elementTags.map(normalizeBriefTag).join(' + ')}` : '';
  const mark = selected ? ' (selected)' : '';
  const shots = clip.beats.map((beat) => {
    const gist = (beat.gist || beat.text || beat.cam || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return `  S${beat.n} ${beat.from}–${beat.to}${gist ? ` — ${gist}` : ''}`;
  });
  return [`- ${clip.title}${mark} (${clip.seconds}s)${tags}`, ...shots].join('\n');
}

function briefTagReplacements(show: DirectorShow): Array<{ pattern: RegExp; tag: string }> {
  const seen = new Set<string>();
  const rows: Array<{ needle: string; tag: string }> = [];
  for (const item of show.breakdown) {
    const tag = normalizeBriefTag(item.tag);
    if (!tag || /^@staging[_-]/i.test(tag)) continue;
    const needles = [item.name.trim(), tag.slice(1).replace(/-/g, ' ')]
      .filter((needle) => needle.length >= 3);
    for (const needle of needles) {
      const key = needle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ needle, tag });
    }
  }
  rows.sort((a, b) => b.needle.length - a.needle.length);
  return rows.map(({ needle, tag }) => ({
    pattern: new RegExp(`(?<!@)\\b${escapeRegExp(needle)}\\b`, 'gi'),
    tag,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
