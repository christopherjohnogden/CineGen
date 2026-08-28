export type QwenPictureKind = 'source' | 'look' | 'character' | 'location' | 'prop' | 'vehicle';

export interface QwenPromptPicture {
  kind: QwenPictureKind;
  /** Shared by alternate views of the same Element. */
  key: string;
  name?: string;
  tag?: string;
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionPattern(value: string): RegExp | undefined {
  const tokens = value.replace(/^@/, '').match(/[A-Za-z0-9]+/g);
  if (!tokens?.length) return undefined;
  return new RegExp(`@\\s*${tokens.map(escaped).join("[\\s._'’\\-]*")}(?![A-Za-z0-9_-])`, 'gi');
}

function withoutGeneratedBindings(value: string): string {
  let prompt = value.trim();
  for (const heading of [
    /\n+MULTI-PICTURE REFERENCE PLAN:[\s\S]*$/i,
    /\n+SUPPLIED IMAGE BINDINGS\s*[—-][\s\S]*$/i,
  ]) {
    prompt = prompt.replace(heading, '').trim();
  }
  return prompt;
}

function roleName(kind: QwenPictureKind): string {
  switch (kind) {
    case 'character': return 'character';
    case 'location': return 'location';
    case 'prop': return 'prop';
    case 'vehicle': return 'vehicle';
    case 'look': return 'visual style';
    default: return 'base scene';
  }
}

function primaryInstruction(kind: QwenPictureKind, pictureNumber: number): string {
  const picture = `Picture ${pictureNumber}`;
  switch (kind) {
    case 'source':
      return `${picture} is the base scene. Preserve its composition, camera angle, lighting, background, and every unmentioned detail.`;
    case 'location':
      return pictureNumber === 1
        ? `${picture} is the base location. Build the scene from its architecture, layout, furniture, materials, and lighting; do not copy people from it.`
        : `${picture} is the location reference. Recreate its architecture, layout, furniture, materials, and lighting as the scene; do not copy people from it.`;
    case 'character':
      return `${picture} is a character identity reference. Use the same person, face, hair, body, and wardrobe for the character assigned to this picture; do not copy its reference background.`;
    case 'prop':
      return `${picture} is a prop reference. Reproduce the same object's shape, materials, color, scale, and distinctive details; do not duplicate it.`;
    case 'vehicle':
      return `${picture} is a vehicle reference. Reproduce the same vehicle design, materials, color, scale, and distinctive details; do not duplicate it.`;
    case 'look':
      return `${picture} is a visual-style reference only. Apply its photographic lighting, palette, texture, and atmosphere without copying its subjects or composition.`;
  }
}

/** Compile app Element mentions into Qwen's explicit Picture 1/2/3 language. */
export function qwenMultiImagePrompt(prompt: string, pictures: QwenPromptPicture[]): string {
  const cleanPrompt = withoutGeneratedBindings(prompt);
  if (pictures.length === 0) {
    return cleanPrompt.replace(/@(?=[A-Za-z0-9])/g, '');
  }

  const firstPictureByKey = new Map<string, number>();
  pictures.forEach((picture, index) => {
    if (!firstPictureByKey.has(picture.key)) firstPictureByKey.set(picture.key, index + 1);
  });

  const aliases = pictures.flatMap((picture) => {
    const primaryNumber = firstPictureByKey.get(picture.key)!;
    const replacement = `the ${roleName(picture.kind)} shown in Picture ${primaryNumber}`;
    return [picture.tag, picture.name]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => ({ value, replacement }));
  }).sort((left, right) => right.value.length - left.value.length);

  let naturalPrompt = cleanPrompt;
  const seenAliases = new Set<string>();
  for (const alias of aliases) {
    const key = alias.value.toLowerCase();
    if (seenAliases.has(key)) continue;
    seenAliases.add(key);
    const pattern = mentionPattern(alias.value);
    if (pattern) naturalPrompt = naturalPrompt.replace(pattern, alias.replacement);
  }
  // Never expose CineGen's internal @-mention marker to an image model.
  naturalPrompt = naturalPrompt.replace(/@(?=[A-Za-z0-9])/g, '');

  const instructions = pictures.map((picture, index) => {
    const pictureNumber = index + 1;
    const primaryNumber = firstPictureByKey.get(picture.key)!;
    if (pictureNumber !== primaryNumber) {
      return `Picture ${pictureNumber} is an additional view of the same ${roleName(picture.kind)} as Picture ${primaryNumber}. Use it only to improve consistency; do not create a second copy.`;
    }
    return primaryInstruction(picture.kind, pictureNumber);
  });

  return [
    naturalPrompt.trim(),
    'MULTI-PICTURE REFERENCE PLAN:',
    ...instructions,
    'Use every supplied picture for exactly its assigned role. Keep identities separate and do not merge, swap, omit, or duplicate referenced subjects.',
    "Do not render CineGen's internal element names, mention tokens, Picture numbers, or this reference plan as visible typography. Only add visible text when the scene request explicitly asks for it.",
  ].join('\n');
}
