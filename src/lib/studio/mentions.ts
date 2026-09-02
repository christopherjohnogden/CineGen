export function mentionToken(name: string): string {
  return `@${name.trim().replace(/\s+/g, '-')}`;
}

/** The partial `@name` immediately before the caret, or null when there isn't one. */
export function activeMention(value: string, caret: number): string | null {
  const before = value.slice(0, caret);
  const match = /(^|[\s(])@([A-Za-z0-9_-]*)$/.exec(before);
  return match ? match[2] : null;
}

/** Split a prompt into plain text and `@mention` tokens for the highlight layer. */
export function splitPromptMentions(
  value: string,
  names: string[],
): Array<{ text: string; mention: boolean }> {
  if (names.length === 0) return [{ text: value, mention: false }];
  const tokens = names.map((name) => mentionToken(name));
  const known = new Set(tokens);
  const pattern = new RegExp(
    `(${[...tokens]
      .sort((left, right) => right.length - left.length)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})`,
    'g',
  );
  // Membership, not `pattern.test` — a global regex carries lastIndex between
  // calls and would report every other token as plain text.
  return value
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, mention: known.has(part) }));
}

