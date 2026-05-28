export type ComposerTokenKind = 'element' | 'asset' | 'skill';

export interface ComposerHighlightPart {
  text: string;
  kind?: ComposerTokenKind;
}

export function skillTokenFor(name: string): string {
  return `#${name}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function removeSkillTokens(text: string, skillNames: readonly string[]): string {
  let result = text;
  for (const name of skillNames) {
    if (!name) continue;
    result = result.replace(new RegExp(`#${escapeRegExp(name)}(?=\\s|$)`, 'g'), '');
  }
  return result.replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
}

export function findSkillIdInText(
  text: string,
  skills: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  for (const skill of skills) {
    const pattern = new RegExp(`#${escapeRegExp(skill.name)}(?=\\s|$)`);
    if (pattern.test(text)) return skill.id;
  }
  return null;
}

export function insertSkillTokenInDraft(
  draft: string,
  cursor: number,
  skillName: string,
  skillNames: readonly string[],
): { text: string; cursor: number } {
  const token = skillTokenFor(skillName);
  const withoutExisting = removeSkillTokens(draft, skillNames);
  const adjustedCursor = Math.min(cursor, withoutExisting.length);
  const before = withoutExisting.slice(0, adjustedCursor);
  const after = withoutExisting.slice(adjustedCursor);
  const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
  const insertion = `${needsSpaceBefore ? ' ' : ''}${token}`;
  const text = `${before}${insertion}${after}`;
  return { text, cursor: before.length + insertion.length };
}

export function splitComposerHighlightParts(
  text: string,
  lookup: {
    elementNames: ReadonlySet<string>;
    assetNames: ReadonlySet<string>;
    skillNames: ReadonlySet<string>;
  },
): ComposerHighlightPart[] {
  if (!text) return [{ text: '' }];

  const parts: ComposerHighlightPart[] = [];
  const tokenPattern = /(#([a-z0-9-]+)(?=\s|$)|@(\S+)|\/(\S+))/g;
  let lastIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index) });
    }

    const full = match[0];
    let kind: ComposerTokenKind | undefined;
    if (full.startsWith('#') && lookup.skillNames.has(match[2] ?? '')) {
      kind = 'skill';
    } else if (full.startsWith('@') && lookup.elementNames.has(match[3] ?? '')) {
      kind = 'element';
    } else if (full.startsWith('/') && lookup.assetNames.has(match[4] ?? '')) {
      kind = 'asset';
    }

    parts.push({ text: full, kind });
    lastIndex = index + full.length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ text }];
}
