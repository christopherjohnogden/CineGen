export const LAYER_DECOMPOSE_STAGE_PROGRESS: Record<string, number> = {
  init: 4,
  ocr: 14,
  segmentation: 42,
  masks: 58,
  extraction: 74,
  inpainting: 88,
  saving: 96,
};

export const LAYER_DECOMPOSE_STAGE_LABELS: Record<string, string> = {
  init: 'Preparing image',
  ocr: 'Separating text',
  segmentation: 'Finding layers',
  masks: 'Cleaning masks',
  extraction: 'Extracting layers',
  inpainting: 'Rebuilding plate',
  saving: 'Saving layers',
};

export const LAYER_DECOMPOSE_VISION_MODEL_ID = 'fal-ai/sa2va/4b/image';
export const LAYER_DECOMPOSE_VISION_PROMPT = [
  'Analyze this image for automatic layer decomposition.',
  'Assume the goal is to separate every distinct foreground element in a flat graphic, poster, flyer, collage, or UI composition.',
  'List every visible item that should live on its own layer, including separate text groups, logos, icons, cards, photos, illustrations, stickers, and decorative clusters.',
  'Do not merge repeated instances into one label. If there are two cards or two text groups, describe them separately.',
  'Return one short label per layer, and put [SEG] immediately after each label so the segmentation masks align with the labels in order.',
  'Use short singular labels only, such as main headline text, subtitle text, before after banner, logo, green flyer card, orange flyer card, badge, icon, food photo, illustration, sticker, or decoration cluster.',
  'Exclude the background.',
  'Return labels only with [SEG] markers and no extra explanation.',
].join(' ');

const AUTO_PROMPT_BANK = [
  'main headline text',
  'subtitle text',
  'text block',
  'small caption text',
  'logo',
  'wordmark',
  'label',
  'badge',
  'button',
  'flyer card',
  'poster card',
  'card',
  'panel',
  'photo',
  'food photo',
  'product photo',
  'illustration',
  'graphic',
  'icon',
  'symbol',
  'sticker',
  'shape',
  'portrait',
  'person',
  'product',
  'device',
  'decoration',
  'decoration cluster',
  'object',
];

export function isLayerDecomposeNodeType(nodeType: string): boolean {
  return nodeType === 'layer-decompose' || nodeType === 'layer-decompose-cloud';
}

export function getLayerDecomposeStageProgress(stage?: string): number | undefined {
  if (!stage) return undefined;
  return LAYER_DECOMPOSE_STAGE_PROGRESS[stage];
}

export function getLayerDecomposeStageLabel(stage?: string): string | undefined {
  if (!stage) return undefined;
  return LAYER_DECOMPOSE_STAGE_LABELS[stage];
}

export function getLayerDecomposeAutoPrompts(limit?: number): string[] {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return AUTO_PROMPT_BANK.slice(0, Math.min(AUTO_PROMPT_BANK.length, Math.floor(limit)));
  }
  return [...AUTO_PROMPT_BANK];
}

function normalizePromptToken(value: string): string | undefined {
  const cleaned = value
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[seg\]/gi, ' ')
    .replace(/[`"'()[\]{}]/g, '')
    .replace(/^[\s\-*•\d.,:;]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.length > 32) return undefined;
  if (/^(the|a|an|background|foreground)$/.test(cleaned)) return undefined;
  return cleaned;
}

function collectPromptTokens(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => collectPromptTokens(item));
  }
  if (typeof raw === 'object' && raw) {
    return Object.values(raw as Record<string, unknown>).flatMap((value) => collectPromptTokens(value));
  }
  if (typeof raw !== 'string') return [];

  return raw
    .split(/\n|,|\[seg\]/i)
    .map((part) => part.replace(/^[-*•]\s*/, ''))
    .map((part) => normalizePromptToken(part))
    .filter((part): part is string => Boolean(part));
}

export function parseLayerDecomposeVisionOutput(output: unknown, limit = 12): string[] {
  if (typeof output !== 'string') return [];
  const trimmed = output.trim();
  if (!trimmed) return [];

  const unique: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const normalized = normalizePromptToken(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    unique.push(normalized);
  };

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fenceMatch?.[1] ?? trimmed;

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    for (const token of collectPromptTokens(parsed)) push(token);
  } catch {
    for (const token of collectPromptTokens(trimmed)) push(token);
  }

  return unique.slice(0, Math.max(1, limit));
}

export function mergeLayerDecomposePrompts(...lists: string[][]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      const normalized = normalizePromptToken(item);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(normalized);
    }
  }
  return merged;
}

export function parseLayerDecomposeVisionMaskLabels(output: unknown, limit = 12): string[] {
  if (typeof output !== 'string') return [];
  const matches = [...output.matchAll(/(?:<p>)?\s*([^<\n\r\[]+?)\s*(?:<\/p>)?\s*\[SEG\]/gi)];
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const normalized = normalizePromptToken(match[1] ?? '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    labels.push(normalized);
    if (labels.length >= Math.max(1, limit)) break;
  }

  return labels;
}
