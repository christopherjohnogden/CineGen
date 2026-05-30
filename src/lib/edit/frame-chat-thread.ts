import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';

export type FrameChatIntent = 'ask' | 'generate';

// Question heuristics adapted from inferAutoWorkMode in llm-tab.tsx.
const QUESTION_PREFIX = /^(what|who|where|when|why|how|which|is|are|do|does|did|can|could|should|would|will)\b/i;

// Broad change-verb heuristic: prompts that clearly request a visual change but may
// not match routeQuickEdit's specific patterns (e.g. "make this car red").
const CHANGE_VERB = /^\s*(make|turn|change|swap|put|set|color|colour|paint|give|apply|convert|transform|render|replace|recolor|recolour|add|remove|erase|delete|darken|lighten|brighten)\b/i;

// Polite-imperative opener ("can you", "could you please", "would you", "will you"). When a
// change verb follows it, the message is an edit request phrased as a question — route to
// generate, not ask. ("can you see the lamp?" has no change verb → stays a question.)
const POLITE_PREFIX = /^\s*(can|could|would|will)\s+(you\s+)?(please\s+)?/i;

/**
 * Decide whether a Frame Chat message is a generation request or a question.
 * - generate: clear change requests — matches routeQuickEdit's rules, OR begins with a change
 *             verb, OR is a polite-imperative ("can you change…/make…") wrapping a change verb.
 * - ask: genuine questions, or anything with no clear change intent (safe default — no credits).
 */
export function detectFrameChatIntent(prompt: string): FrameChatIntent {
  const text = prompt.trim();
  if (!text) return 'ask';

  // Strip a leading polite opener so "can you change the shirt" is judged on "change the shirt".
  const core = text.replace(POLITE_PREFIX, '').trim();

  // A clear change request wins even when phrased as a question:
  //   - routeQuickEdit matches a known edit rule (clean-plate/object-change/extend/stylize), or
  //   - the core (after stripping a polite opener) starts with a change verb.
  if (routeQuickEdit(text).intent !== 'ambiguous') return 'generate';
  if (routeQuickEdit(core).intent !== 'ambiguous') return 'generate';
  if (CHANGE_VERB.test(core)) return 'generate';

  // Otherwise, a question (or polite request with no change verb) → ask. No credits spent.
  const isQuestion = text.endsWith('?') || QUESTION_PREFIX.test(text);
  if (isQuestion) return 'ask';

  // Plain change verb at the very start (no polite opener) also generates.
  if (CHANGE_VERB.test(text)) return 'generate';

  return 'ask';
}

export type FrameChatRole = 'user' | 'assistant';

export interface FrameChatGenerationPreview {
  /** Higgsfield model + output type chosen by routeQuickEdit. */
  model: string;
  outputType: 'image' | 'video';
  referenceMode: 'frame' | 'segment' | 'first-last';
  /** Source clip the generation references (for placement on confirm). */
  sourceClipId: string;
  /** Resolved media URL once generated; absent until generation completes. */
  resultUrl?: string;
  resultDurationSec?: number;
  status: 'proposed' | 'generating' | 'ready' | 'failed' | 'placed';
  error?: string;
}

export interface FrameChatMessage {
  id: string;
  role: FrameChatRole;
  content: string;
  createdAt: string;
  intent?: FrameChatIntent;
  /** Present on assistant messages that propose/produce a generation. */
  generation?: FrameChatGenerationPreview;
}

export function frameChatStorageKey(projectId: string): string {
  return `cinegen_frame_chat:${projectId}`;
}

export function serializeThread(messages: FrameChatMessage[]): string {
  return JSON.stringify(messages);
}

export function deserializeThread(raw: string | null): FrameChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A generation persisted mid-flight (status 'generating') can never resume after reload —
    // its in-memory pending entry is gone. Normalize it to 'failed' so the UI offers a resend
    // instead of showing "Generating…" forever.
    return (parsed as FrameChatMessage[]).map((message) =>
      message.generation?.status === 'generating'
        ? { ...message, generation: { ...message.generation, status: 'failed', error: 'Interrupted — resend to retry.' } }
        : message,
    );
  } catch {
    return [];
  }
}
