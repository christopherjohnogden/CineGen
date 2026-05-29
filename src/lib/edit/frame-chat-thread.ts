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
