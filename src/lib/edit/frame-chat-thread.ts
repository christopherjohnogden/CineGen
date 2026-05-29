import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';

export type FrameChatIntent = 'ask' | 'generate';

// Question heuristics adapted from inferAutoWorkMode in llm-tab.tsx.
const QUESTION_PREFIX = /^(what|who|where|when|why|how|which|is|are|do|does|did|can|could|should|would|will)\b/i;

// Broad change-verb heuristic: prompts that clearly request a visual change but may
// not match routeQuickEdit's specific patterns (e.g. "make this car red").
// Known trade-off: polite-imperative forms ("can you darken this", "will you make this
// blue") are deliberately routed to `ask` (the QUESTION_PREFIX guard runs first) to match
// the inferAutoWorkMode heuristic in llm-tab.tsx.
const CHANGE_VERB = /^\s*(make|turn|change|swap|put|set|color|colour|paint|give|apply|convert|transform|render|replace|recolor|recolour|darken|lighten|brighten)\b/i;

/**
 * Decide whether a Frame Chat message is a generation request or a question.
 * - generate: matches routeQuickEdit's change-verb rules (and is NOT phrased as a question),
 *             or begins with a broad change-verb (make/turn/change/…)
 * - ask: questions, or anything with no clear change intent (safer default — no credits)
 */
export function detectFrameChatIntent(prompt: string): FrameChatIntent {
  const text = prompt.trim();
  if (!text) return 'ask';

  const isQuestion = text.endsWith('?') || QUESTION_PREFIX.test(text);
  if (isQuestion) return 'ask';

  // routeQuickEdit returns 'ambiguous' when no change rule matched.
  const route = routeQuickEdit(text);
  if (route.intent !== 'ambiguous') return 'generate';

  // Fallback: catch broad change-verb phrases not covered by routeQuickEdit rules.
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
