// Prompt-enhancement helpers for Frame Chat generation. Pure + unit-tested. The renderer's
// Gemini IPC only applies a system prompt when injecting project context, so we fold all rules and
// a worked example into the user message, then defensively clean any leaked preamble from the reply.

/** Build the full enhancement request (rules + example + the user's instruction). */
export function buildEnhanceRequest(text: string): string {
  return [
    'You are a prompt rewriter for an AI that EDITS an existing reference frame (not a text-to-image generator).',
    "Rewrite the user's short edit instruction into one clear, specific instruction for the editing model.",
    'RULES:',
    '- Describe ONLY the requested change, concretely.',
    '- Explicitly say to keep everything else identical: the same person, pose, framing, background, lighting, and camera.',
    '- Do NOT invent a new scene, new subject, age, location, or setting. Do NOT change the shot.',
    '- Output ONE sentence. No preamble, no explanation, no quotes, no markdown, no lists. Just the instruction.',
    '',
    'Example input: change the suit to a green hazmat suit',
    "Example output: Change the subject's suit to a green hazmat suit, keeping the same person, pose, framing, background, lighting, and camera unchanged.",
    '',
    `Now rewrite this instruction:\n${text}`,
  ].join('\n');
}

/**
 * Strip any leaked preamble the model adds despite instructions ("Here's a stronger prompt:",
 * "I cannot…", surrounding quotes). Returns `fallback` if nothing usable remains.
 */
export function cleanEnhancedPrompt(raw: string, fallback: string): string {
  let out = (raw || '').trim();
  // If the model wrapped the real answer in quotes, prefer the quoted span.
  const quoted = out.match(/"([^"]{12,})"/);
  if (quoted) out = quoted[1];
  // If there's a refusal/meta opener, keep the last non-empty line (usually the actual prompt).
  if (/^(i cannot|i can(?:'|’)t|however|here(?:'|’)s|sure|okay|note that|as an ai|i can still|unfortunately)\b/i.test(out)) {
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    out = lines[lines.length - 1] ?? out;
  }
  // Drop a single leading meta clause ending in a colon ("Here's a stronger generation prompt:").
  out = out.replace(/^[^\n.!?]*:\s*/i, '').trim();
  out = out.replace(/^["'`]+|["'`]+$/g, '').trim();
  return out.length >= 8 ? out : fallback;
}
