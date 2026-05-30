import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';

export type FrameChatIntent = 'ask' | 'generate';

// Question heuristics adapted from inferAutoWorkMode in llm-tab.tsx.
const QUESTION_PREFIX = /^(what|who|where|when|why|how|which|is|are|do|does|did|can|could|should|would|will)\b/i;

// Broad change-verb heuristic: prompts that clearly request a visual change but may
// not match routeQuickEdit's specific patterns (e.g. "make this car red").
const CHANGE_VERB = /^\s*(make|turn|change|swap|put|set|color|colour|paint|give|apply|convert|transform|render|replace|recolor|recolour|add|remove|erase|delete|darken|lighten|brighten)\b/i;

// Polite-imperative opener: an optional "please", an optional modal ("can/could/would/will" +
// optional "you"), and an optional trailing "please". Every group is optional and the regex is
// deliberately NON-GLOBAL — on a non-polite input it matches a zero-width prefix and strips
// nothing (stripped === text). When a change verb follows the opener, the message is an edit
// request phrased politely → generate. ("can you see the lamp?" has no change verb → stays ask.)
// NOTE: keep this all-optional and non-global; adding /g or required groups could corrupt input.
const POLITE_PREFIX = /^(?:please\s+)?(?:(?:can|could|would|will)\s+(?:you\s+)?)?(?:please\s+)?/i;

/**
 * Decide whether a Frame Chat message is a generation request or a question.
 * - generate: clear change requests — matches routeQuickEdit's rules, OR (after stripping a polite
 *             opener) begins with a change verb. Polite-imperative edits ("can you change…",
 *             "please make…") route to generate.
 * - ask: genuine questions, or anything with no clear change intent (safe default — no credits).
 * Residual edge cases (tolerable — credits are only spent on an explicit Generate press, and the
 * clarification step is non-destructive): "make me a sandwich" → generate; "is it possible to make
 * it red" → ask (modal not at position 0). Reasonable defaults, not exact intent classification.
 */
export function detectFrameChatIntent(prompt: string): FrameChatIntent {
  const text = prompt.trim();
  if (!text) return 'ask';

  // Strip a leading polite opener, then judge the core: "can you change the shirt" → "change the shirt".
  const core = text.replace(POLITE_PREFIX, '').trim();

  // A clear change request wins even when phrased as a question.
  if (routeQuickEdit(core).intent !== 'ambiguous') return 'generate';
  if (CHANGE_VERB.test(core)) return 'generate';

  // Otherwise, a question (or polite request with no change verb) → ask. No credits spent.
  if (text.endsWith('?') || QUESTION_PREFIX.test(text)) return 'ask';

  return 'ask';
}

export type FrameChatRole = 'user' | 'assistant';

export interface FrameChatGenerationPreview {
  /** Currently selected model + output type. Seeded from routeQuickEdit, overridable in the
   * clarification step before the user presses Generate. */
  model: string;
  outputType: 'image' | 'video';
  referenceMode: 'frame' | 'segment' | 'first-last';
  /** The referenceMode routeQuickEdit originally chose — restored when switching back to video so
   * a drawn-frame reference is still honored (image edits always use 'frame'). */
  routedReferenceMode?: 'frame' | 'segment' | 'first-last';
  /** The (possibly LLM-enhanced, user-editable) prompt sent to the generator. Seeded with the raw
   * text, replaced by the enhanced version when ready; the clarify UI lets the user edit it. */
  prompt?: string;
  /** True while the prompt is being enhanced by the LLM (clarify UI shows a hint). */
  enhancing?: boolean;
  /** Source clip the generation references (for placement on confirm). */
  sourceClipId: string;
  /** Resolved media URL once generated; absent until generation completes. */
  resultUrl?: string;
  resultDurationSec?: number;
  /** 'clarifying' = user is choosing output type + model; 'proposed' = confirmed, ready to run. */
  status: 'clarifying' | 'proposed' | 'generating' | 'ready' | 'failed' | 'placed';
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
    // A generation persisted while in-flight ('generating') or awaiting a choice ('clarifying')
    // can't resume after reload — its in-memory pending entry (prompt + drawn frame) is gone.
    // Normalize to 'failed' so the UI offers a resend instead of a stuck spinner or dead picker.
    return (parsed as FrameChatMessage[]).map((message) =>
      message.generation?.status === 'generating' || message.generation?.status === 'clarifying'
        ? { ...message, generation: { ...message.generation, status: 'failed', error: 'Interrupted — resend to retry.' } }
        : message,
    );
  } catch {
    return [];
  }
}
