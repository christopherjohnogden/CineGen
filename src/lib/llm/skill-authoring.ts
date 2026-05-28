import {
  getDefaultModelForCliProvider,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';
import { invokeCliCopilotChat, subscribeCliCopilotStream } from '@/lib/llm/cli-copilot-client';
import {
  createBlankSkill,
  isSkillNameTaken,
  loadSkills,
  normalizeSkillName,
  saveSkills,
  updateSkillRecord,
  type LLMSkill,
} from '@/lib/llm/skills';

export interface ParsedSkillDraft {
  name: string;
  description: string;
  instructions: string;
}

export interface SkillAuthoringMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type SkillAuthoringBackend =
  | { kind: 'cloud'; apiKey: string; model: string }
  | { kind: 'local'; model: string }
  | { kind: 'cli'; provider: CliLlmProviderId; model: string; resumeSessionId?: string | null };

export interface SkillAuthoringTurnResult {
  message: string;
  displayMessage: string;
  draft: ParsedSkillDraft | null;
  sessionId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
}

const SKILL_DRAFT_PATTERN = /```cinegen-skill\s*\n([\s\S]*?)```/i;

export function buildSkillAuthoringSystemPrompt(): string {
  return [
    'You are CineGen\'s Skill Builder assistant. Help the user author a reusable Copilot skill in Claude/Cursor SKILL.md style.',
    '',
    'Each skill has:',
    '- name: lowercase letters, numbers, and hyphens only (max 64 chars)',
    '- description: third-person summary of WHAT the skill does and WHEN Copilot should use it (include trigger terms)',
    '- instructions: markdown body with step-by-step guidance, templates, and examples',
    '',
    'Workflow:',
    '1. Ask 1–2 focused clarifying questions at a time until you understand purpose, triggers, output format, and constraints.',
    '2. Do not dump the final skill until you have enough detail or the user asks you to draft it.',
    '3. When ready, write a concise conversational summary, then include ONE fenced code block tagged cinegen-skill containing JSON:',
    '',
    '```cinegen-skill',
    '{"name":"shot-list","description":"Builds structured shot lists from scripts and transcripts. Use when the user asks for a shot list, coverage plan, or scene breakdown.","instructions":"# Shot List\\n\\n1. ..."}',
    '```',
    '',
    'JSON rules: escape newlines in instructions as \\n. Keep instructions practical and production-minded.',
    'If revising, output an updated cinegen-skill block with the full revised skill.',
  ].join('\n');
}

export function detectSkillAuthoringIntent(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (!normalized) return false;

  const patterns = [
    /\b(create|build|make|write|author|design|add)\b.{0,40}\b(skill|skills)\b/,
    /\bnew\b.{0,24}\b(skill|skills)\b/,
    /\bskill\b.{0,24}\b(for|to)\b/,
    /\bhelp me\b.{0,32}\b(skill|skills)\b/,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

export function detectSkillAuthoringCancel(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return /^(cancel|stop|nevermind|never mind|exit skill builder|exit)$/.test(normalized);
}

export function isSkillAuthoringThread(messages: Array<{
  role: string;
  skillAuthoring?: boolean;
  skillDraft?: ParsedSkillDraft;
  skillDraftSaved?: boolean;
}>): boolean {
  for (let index = messages.length - 1; index >= Math.max(0, messages.length - 10); index -= 1) {
    const message = messages[index];
    if (message.skillDraft && !message.skillDraftSaved) return true;
    if (message.skillAuthoring) return true;
  }
  return false;
}

export function parseSkillDraftFromContent(content: string): ParsedSkillDraft | null {
  const match = content.match(SKILL_DRAFT_PATTERN);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1].trim()) as Partial<ParsedSkillDraft>;
    const name = normalizeSkillName(String(parsed.name ?? ''));
    const description = String(parsed.description ?? '').trim();
    const instructions = String(parsed.instructions ?? '').trim();
    if (!name || !description || !instructions) return null;
    return { name, description, instructions };
  } catch {
    return null;
  }
}

export function stripSkillDraftBlock(content: string): string {
  return content.replace(SKILL_DRAFT_PATTERN, '').trim();
}

export function resolveSkillAuthoringBackend(options: {
  mode: 'cloud' | 'local' | CliLlmProviderId;
  cliProviders: Record<CliLlmProviderId, { installed: boolean }>;
  model: string;
  localModel: string;
  falKey?: string;
  cliSession?: { provider: CliLlmProviderId; model: string; sessionId?: string | null };
}): SkillAuthoringBackend | null {
  const installedClis = (['claude-code', 'codex', 'gemini'] as CliLlmProviderId[])
    .filter((provider) => options.cliProviders[provider]?.installed);

  if (installedClis.includes(options.mode as CliLlmProviderId)) {
    const provider = options.mode as CliLlmProviderId;
    return {
      kind: 'cli',
      provider,
      model: options.cliSession?.provider === provider ? options.cliSession.model : getDefaultModelForCliProvider(provider),
      resumeSessionId: options.cliSession?.provider === provider ? options.cliSession.sessionId : null,
    };
  }

  if (installedClis.length > 0) {
    const provider = installedClis[0];
    return {
      kind: 'cli',
      provider,
      model: getDefaultModelForCliProvider(provider),
      resumeSessionId: null,
    };
  }

  if (options.falKey) {
    return { kind: 'cloud', apiKey: options.falKey, model: options.model };
  }

  if (options.localModel) {
    return { kind: 'local', model: options.localModel };
  }

  return null;
}

export function getSkillAuthoringBackendLabel(backend: SkillAuthoringBackend): string {
  if (backend.kind === 'cli') {
    if (backend.provider === 'claude-code') return 'Claude Code';
    if (backend.provider === 'codex') return 'Codex';
    return 'Gemini CLI';
  }
  if (backend.kind === 'cloud') return 'Cloud';
  return 'Local';
}

function buildAuthoringMessages(
  history: SkillAuthoringMessage[],
  userMessage: string,
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  return [
    ...history.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user' as const, content: userMessage },
  ];
}

export async function sendSkillAuthoringTurn(params: {
  backend: SkillAuthoringBackend;
  history: SkillAuthoringMessage[];
  userMessage: string;
  requestId?: string;
  onToken?: (token: string) => void;
}): Promise<SkillAuthoringTurnResult> {
  const systemPrompt = buildSkillAuthoringSystemPrompt();
  const apiMessages = buildAuthoringMessages(params.history, params.userMessage);
  const requestId = params.requestId ?? crypto.randomUUID();

  if (params.backend.kind === 'cloud') {
    const response = await window.electronAPI.llm.chat({
      apiKey: params.backend.apiKey,
      model: params.backend.model,
      systemPrompt,
      messages: apiMessages,
      maxTokens: 2200,
      temperature: 0.45,
    });
    const message = response.message?.trim() || '';
    const draft = parseSkillDraftFromContent(message);
    return {
      message,
      displayMessage: stripSkillDraftBlock(message) || message,
      draft,
      usage: response.usage,
    };
  }

  if (params.backend.kind === 'local') {
    const removeListener = params.onToken
      ? window.electronAPI.llm.onLocalStream((data) => {
        if (data.requestId !== requestId || !data.token) return;
        params.onToken?.(data.token);
      })
      : () => {};

    try {
      const response = await window.electronAPI.llm.localChat({
        requestId,
        model: params.backend.model,
        systemPrompt,
        messages: apiMessages,
        maxTokens: 2200,
        temperature: 0.45,
      });
      const message = response.message?.trim() || '';
      const draft = parseSkillDraftFromContent(message);
      return {
        message,
        displayMessage: stripSkillDraftBlock(message) || message,
        draft,
        usage: response.usage,
      };
    } finally {
      removeListener();
    }
  }

  const removeListener = params.onToken
    ? subscribeCliCopilotStream(params.backend.provider, (data) => {
      if (data.requestId !== requestId || !data.token) return;
      params.onToken?.(data.token);
    })
    : () => {};

  try {
    const response = await invokeCliCopilotChat(params.backend.provider, {
      requestId,
      model: params.backend.model,
      purpose: 'copilot',
      injectProjectContext: false,
      resumeSessionId: params.backend.resumeSessionId ?? undefined,
      systemPrompt,
      userMessage: params.userMessage,
      messages: apiMessages,
    });
    const message = response.message?.trim() || '';
    const draft = parseSkillDraftFromContent(message);
    return {
      message,
      displayMessage: stripSkillDraftBlock(message) || message,
      draft,
      sessionId: response.sessionId,
      usage: response.usage,
    };
  } finally {
    removeListener();
  }
}

export function saveSkillDraft(
  draft: ParsedSkillDraft,
  options?: { selectId?: (id: string) => void },
): { skill: LLMSkill } {
  const skills = loadSkills();
  let name = draft.name;
  if (isSkillNameTaken(name, skills)) {
    let suffix = 2;
    while (isSkillNameTaken(`${name}-${suffix}`, skills)) suffix += 1;
    name = `${name}-${suffix}`;
  }

  const skill = updateSkillRecord(createBlankSkill(), {
    name,
    description: draft.description,
    instructions: draft.instructions,
  });

  saveSkills([...skills, skill]);
  options?.selectId?.(skill.id);
  return { skill };
}
