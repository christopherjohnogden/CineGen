import type { Asset } from '@/types/project';
import type { Element } from '@/types/elements';
import type { Timeline } from '@/types/timeline';

export const CLAUDE_CODE_MODELS = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
] as const;

export type ClaudeCodeModelId = (typeof CLAUDE_CODE_MODELS)[number]['id'];

export type CliLlmProviderId = 'claude-code' | 'codex' | 'gemini';

export const CLI_LLM_PROVIDER_IDS: CliLlmProviderId[] = ['claude-code', 'codex', 'gemini'];

export const CODEX_MODELS = [
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'o3', label: 'o3' },
] as const;

export const GEMINI_MODELS = [
  { id: 'auto', label: 'Auto' },
  { id: 'flash', label: '3.x Flash' },
  { id: 'pro', label: 'Pro' },
  { id: 'flash-lite', label: 'Flash Lite' },
  { id: 'gemini-3.1-pro-preview', label: '3.1 Pro' },
  { id: 'gemini-3-flash-preview', label: '3 Flash' },
  { id: 'gemini-3.1-flash-lite-preview', label: '3.1 Flash Lite' },
  { id: 'gemini-2.5-pro', label: '2.5 Pro' },
  { id: 'gemini-2.5-flash', label: '2.5 Flash' },
] as const;

export interface CliLlmSessionState {
  provider: CliLlmProviderId;
  sessionId: string | null;
  contextFingerprint: string | null;
  model: string;
  forceContextRefresh: boolean;
}

export type ClaudeCodeSessionState = CliLlmSessionState;

export const DEFAULT_CLI_LLM_SESSION: CliLlmSessionState = {
  provider: 'claude-code',
  sessionId: null,
  contextFingerprint: null,
  model: 'sonnet',
  forceContextRefresh: false,
};

export const DEFAULT_CLAUDE_CODE_SESSION = DEFAULT_CLI_LLM_SESSION;

export function getDefaultModelForCliProvider(provider: CliLlmProviderId): string {
  switch (provider) {
    case 'claude-code':
      return 'sonnet';
    case 'codex':
      return 'gpt-5.3-codex';
    case 'gemini':
      return 'auto';
    default:
      return 'sonnet';
  }
}

export function getCliProviderLabel(provider: CliLlmProviderId): string {
  switch (provider) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'gemini':
      return 'Gemini CLI';
    default:
      return provider;
  }
}

export function isCliCopilotProvider(mode: string): mode is CliLlmProviderId {
  return mode === 'claude-code' || mode === 'codex' || mode === 'gemini';
}

function transcriptSignature(asset: Asset): string {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const transcription = (metadata.transcription ?? {}) as {
    text?: string;
    segments?: unknown[];
  };
  const segmentCount = Array.isArray(transcription.segments) ? transcription.segments.length : 0;
  const textLength = typeof transcription.text === 'string' ? transcription.text.length : 0;
  const status = metadata.transcriptionStatus ?? (textLength || segmentCount ? 'ready' : 'missing');
  return `${status}:${segmentCount}:${textLength}`;
}

export function computeProjectContextFingerprint(params: {
  projectId: string;
  assets: Asset[];
  timelines: Timeline[];
  elements: Element[];
  activeTimelineId: string;
}): string {
  const assetSig = params.assets
    .map((asset) => `${asset.id}:${asset.createdAt}:${asset.duration}:${asset.name}:${transcriptSignature(asset)}`)
    .sort()
    .join('|');
  const timelineSig = params.timelines
    .map((timeline) => `${timeline.id}:${timeline.name}:${timeline.clips.length}:${timeline.clips
      .map((clip) => `${clip.id}:${clip.assetId}:${clip.startTime}:${clip.duration}:${clip.trimStart}:${clip.trimEnd}`)
      .join(',')}`)
    .join('||');
  const elementSig = params.elements
    .map((element) => `${element.id}:${element.name}:${element.type}`)
    .sort()
    .join('|');

  return [
    params.projectId,
    params.activeTimelineId,
    assetSig,
    timelineSig,
    elementSig,
  ].join('::');
}

const CONTEXT_GAP_PATTERNS = [
  /don'?t have (access to|information about|enough (context|information|detail))/i,
  /not (included|provided|available|found) in (the )?(project|context|data|assets?)/i,
  /I don'?t see (that|this|any|the).{0,40}(in|on) (the )?(project|timeline|assets?|media pool)/i,
  /can you (provide|share|give me|paste|send).{0,30}(context|details|information|transcript)/i,
  /(which|what) (asset|clip|timeline|file) (is|are|was|were) you (referring to|asking about|talking about)/i,
  /I'?m not sure which (clip|asset|timeline|file)/i,
  /I don'?t have (the )?(latest|updated|current) project/i,
  /project context (may be|might be|is) (stale|outdated|missing)/i,
  /let me (look|check|search|find|explore|see where)/i,
  /where (timeline|project|clip) (data )?(is )?(stored|saved|kept)/i,
  /search (the )?(project|codebase|repo|files?|filesystem)/i,
];

export function detectContextGapInResponse(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return CONTEXT_GAP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function detectAgenticDeflection(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return /let me (look|check|search|find|explore|invoke|load|run|use)/i.test(trimmed)
    || /\busing the (skill tool|Skill tool)\b/i.test(trimmed)
    || /\b(use|invoke|call) (the )?(skill tool|Skill tool)\b/i.test(trimmed)
    || /\b(i don't have|don't have) (a )?`?Skill`? tool\b/i.test(trimmed)
    || /where (timeline|project) (data )?is stored/i.test(trimmed)
    || /search (the )?(project|codebase|filesystem)/i.test(trimmed);
}

export function isClaudeMaxTurnsError(message: string): boolean {
  return /maximum number of turns/i.test(message);
}

export const AGENTIC_DEFLECTION_RETRY_PROMPT = [
  'Your previous reply said you would look something up, load a skill, or use a tool.',
  'Do NOT. Follow any ACTIVE SKILL instructions directly in chat and answer from ACTIVE PROJECT CONTEXT and the CineGen SKILLS catalog.',
  'Never mention tools, Skill tool, slash commands, or searching.',
  'Original question:',
].join(' ');

export function detectBadClipListFormatting(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const hasTableSyntax = /\|[^|\n]{1,40}\|[^|\n]{1,40}\|/.test(trimmed)
    || /\|[-:\s|]{4,}\|/.test(trimmed);
  const looksLikeClipInventory = (
    /\b\d+\s+clips?\b/i.test(trimmed)
    || /\bclip(s)?\b/i.test(trimmed)
  ) && (
    /\bV\d+\b/.test(trimmed)
    || /\bA\d+\b/.test(trimmed)
    || /\bTrack\b/i.test(trimmed)
    || hasTableSyntax
  );

  if (!looksLikeClipInventory) return false;
  if (/\bi already (answered|gave|listed)\b/i.test(trimmed) && looksLikeClipInventory) return true;
  if (hasTableSyntax) return true;
  return false;
}

export function isRepeatUserQuestion(content: string, priorUserContent: string | undefined): boolean {
  if (!priorUserContent) return false;
  return priorUserContent.trim().toLowerCase() === content.trim().toLowerCase();
}

export const REPEAT_CLIP_FORMAT_HINT = [
  '[Same question as before — answer again using a numbered list with [timeline:Name / clip:ClipName @ time] on every line.',
  'No markdown tables. Do not say you already answered.]',
].join(' ');

export const CLIP_FORMAT_RETRY_PROMPT = [
  'Your previous reply used a markdown table without timeline citations.',
  'Re-answer with a numbered chronological list across all tracks.',
  'Each line: **ClipName** — Track, start to end [timeline:TimelineName / clip:ClipName @ start].',
  'Original question:',
].join(' ');

export function shouldInjectProjectContext(
  session: CliLlmSessionState,
  currentFingerprint: string,
): { inject: boolean; refresh: boolean } {
  const fingerprintChanged = session.contextFingerprint !== null && session.contextFingerprint !== currentFingerprint;
  const inject = !session.sessionId || fingerprintChanged || session.forceContextRefresh;
  const refresh = session.sessionId !== null && (fingerprintChanged || session.forceContextRefresh);
  return { inject, refresh };
}
