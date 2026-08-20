import type { DirectorStagingFigure, DirectorStagingMap } from '@/types/director';

/**
 * Staging references from skills/tig-diagram.skill (tig-blocking-map v2): a
 * schematic outline drawing that tells the video model who is where and nothing else.
 *
 * Style bleed from the map into the shot is the method's known enemy and has three
 * feeds, all closed here: the image stays thin muted outlines, the connector text
 * never names the map's graphic style even as a negation, and the map is attached
 * after the photo references so those dominate the style vote.
 */

/** One maximally distinct muted hue per figure. Colour is identity, never wardrobe. */
export const STAGING_COLORS = [
  'muted blue',
  'muted orange',
  'muted yellow',
  'muted purple',
  'muted red',
  'muted green',
] as const;

export const STAGING_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '').trim();
}

export function stagingTagFor(project: string, scene: string, version = 1): string {
  return `@staging_${slug(project).toUpperCase()}_${slug(scene)}_v${version}`;
}

export function locationTagFor(project: string, name: string, scene: string, version = 1): string {
  return `@loc_${slug(project).toUpperCase()}_${slug(name)}_${slug(scene)}_v${version}`;
}

/** Bump the trailing version so a retake never collides with a stale map. */
export function bumpStagingVersion(tag: string): string {
  const match = tag.match(/_v(\d+)$/);
  if (!match) return `${tag}_v2`;
  return `${tag.slice(0, -match[0].length)}_v${Number(match[1]) + 1}`;
}

export function emptyStagingMap(project: string, sceneLabel: string): DirectorStagingMap {
  return {
    enabled: false,
    stagingTag: stagingTagFor(project || 'SHOW', sceneLabel || 'scene'),
    locationTag: locationTagFor(project || 'SHOW', 'location', sceneLabel || 'scene'),
    figures: [],
  };
}

export function assignStagingFigures(tags: string[]): DirectorStagingFigure[] {
  return tags.slice(0, STAGING_LETTERS.length).map((tag, index) => ({
    letter: STAGING_LETTERS[index],
    color: STAGING_COLORS[index],
    tag,
    position: '',
  }));
}

/**
 * Step 1 — the prompt that generates the schematic. Graphic vocabulary is allowed
 * here and only here, because this prompt never touches the video context.
 */
export function stagingDiagramPrompt(options: {
  figures: DirectorStagingFigure[];
  aspectRatio: string;
  anchors?: string;
  extras?: string;
  /** Higgsfield drops Midjourney flags; the still is attached as --image. */
  engine?: 'midjourney' | 'higgsfield';
}): string {
  const { figures, aspectRatio, anchors, extras, engine = 'midjourney' } = options;
  const figureLines = figures.map((figure) => {
    const visible = figure.visible?.trim() || 'full body';
    const position = figure.position.trim() || 'position as in the attached image';
    return `- A ${figure.color} outline figure: ${position}, ${visible}, pose exactly as in the image, facing direction exactly as in the image.`;
  });
  const count = figures.length > 0
    ? `${figures.length} outline figure${figures.length === 1 ? '' : 's'}`
    : 'every person visible in the attached image as a muted-color outline figure, one distinct hue each';
  const guide = engine === 'higgsfield'
    ? 'The attached image is a COMPOSITION-ONLY guide: copy its exact framing, camera angle, crop, and the positions, poses and scale of every person — but do NOT copy its photographic look: no photo textures, no realistic lighting, no realistic faces, no colors from the image. Do NOT add anything that is not in the attached image. Do NOT complete cropped bodies — if a body part is cut off by the frame edge in the image, cut it off in the drawing. The OUTPUT is a flat schematic:'
    : '@[Image 1](image_1) — use the attached image ONLY as the compositional guide: copy its exact framing, camera angle, crop, and the positions, poses and scale of every person — but do NOT copy its photographic look: no photo textures, no realistic lighting, no realistic faces, no colors from the image. Do NOT add anything that is not in the attached image. Do NOT complete cropped bodies — if a body part is cut off by the frame edge in the image, cut it off in the drawing. The OUTPUT is a flat schematic:';
  const close = engine === 'higgsfield'
    ? 'Nothing else — no ground line, no extra props, no extra figures. Simple, readable, diagrammatic — flat 2D line drawing, minimal detail, only who is where. Do not include photorealism, photo texture, realistic lighting, realistic faces, shading, solid color fills, color blocks, text, letters, labels, or typography.'
    : `Nothing else — no ground line, no extra props, no extra figures. Simple, readable, diagrammatic — flat 2D line drawing, minimal detail, only who is where. --ar ${aspectRatio} --style raw --stylize 30 --no photorealism, photo texture, realistic lighting, realistic faces, shading, solid color fills, color blocks, text, letters, labels, typography`;

  return [
    guide,
    'Flat minimalist technical LINE DRAWING, a staging plan for a film scene — an obviously schematic, non-photographic drawing on a white background with a very faint, thin, light-grey graph-paper grid. Figures are drawn as clean THIN OUTLINES in muted colors — NO fills, NO solid color blocks, NO shading, NO texture, NO realism, NO text, NO letters, NO labels anywhere.',
    `Front view matching the attached image's framing exactly: ${count}.`,
    ...figureLines,
    anchors?.trim() ? anchors.trim() : 'No furniture, open background.',
    extras?.trim() ?? '',
    close,
  ].filter((line) => line.trim().length > 0).join('\n');
}

/**
 * Step 2 — the connector pasted into the video prompt. Positive form only: naming
 * the map's graphic style here, even as a negation, primes the very look being banned.
 */
export function stagingConnectorBlock(map: DirectorStagingMap): string {
  if (!map.figures.length) return '';
  const { stagingTag, locationTag } = map;
  const legend = map.figures.map((figure) => {
    const position = figure.position.trim() || 'position as drawn';
    return `@${figure.letter} = the ${figure.color.toUpperCase()} figure on the staging reference = ${figure.tag} → ${position}.`;
  });

  return [
    `${stagingTag} — POSITION REFERENCE ONLY`,
    `Use this reference solely to read where each figure is placed, its pose, and its facing direction inside ${locationTag}. Every visual quality of the shot — style, light, color grade, faces, wardrobe, environment, props — comes exclusively from ${locationTag} and the character references. The shot is a fully photoreal live-action frame.`,
    '',
    'LETTER LEGEND (letters exist only in this prompt; they do not appear on the reference)',
    ...legend,
    '',
    `RENDER RULE: place the real, photoreal characters from their own references into the real location ${locationTag} at the positions this reference defines, and take nothing else from it.`,
    '',
    `LOCKS: All style, light, and texture come exclusively from ${locationTag} and the character references; ${stagingTag} defines positions only. The colors on the staging reference identify who is who on that reference only — wardrobe and grading come from the character and location references. Everyone stays in their staging-locked position until their scripted action.`,
  ].join('\n');
}

/** Graphic tokens that must never reach a video prompt, not even as a negation. */
export const BLEED_TOKENS = ['flat', 'vector', 'schematic', 'grid', 'color blocks', 'diagram', 'illustration'] as const;

export function bleedTokensIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BLEED_TOKENS.filter((token) => lower.includes(token));
}
