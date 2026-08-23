import type { Element } from '@/types/elements';
import type {
  DirectorBeat,
  DirectorClip,
  DirectorScene,
  DirectorShow,
  DirectorStoryboardFrame,
  DirectorStoryboardModelId,
} from '@/types/director';
import { grammarLensLine } from './craft/coverage';
import { compileLookBible, lookBibleImageUrls } from './look-bible';
import { normalizeElementTag } from './prompt-compiler';
import { clipDisplayLabels } from './shotlist';

export const STORYBOARD_MODELS: Array<{ value: DirectorStoryboardModelId; label: string; shortLabel: string }> = [
  { value: 'nano_banana_2', label: 'Google Nano Banana 2', shortLabel: 'Nano Banana 2' },
  { value: 'gpt_image_2', label: 'GPT Image 2', shortLabel: 'GPT Image 2' },
];

export interface StoryboardPlanFrame {
  id: string;
  clip: DirectorClip;
  scene: DirectorScene;
  beat: DirectorBeat;
  clipLabel: string;
  derivedPrompt: string;
  prompt: string;
  sourceHash: string;
  saved?: DirectorStoryboardFrame;
  stale: boolean;
}

export interface StoryboardReference {
  id: string;
  name: string;
  url: string;
  source: 'element' | 'look-bible';
  type?: Element['type'];
  tag?: string;
}

export interface StoryboardReferenceSet {
  references: StoryboardReference[];
  missingElementTags: string[];
}

export function storyboardFrameId(clipId: string, beatN: number): string {
  return `${clipId}::${beatN}`;
}

function cleanBeatAction(text: string): string {
  return text
    .replace(/\s*Hard cut\.\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function simpleHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function storyboardPrompt(
  show: DirectorShow,
  scene: DirectorScene,
  clip: DirectorClip,
  beat: DirectorBeat,
  clipLabel: string,
): string {
  const action = cleanBeatAction(beat.text) || beat.gist?.trim() || clip.intent?.trim() || clip.title;
  const lens = [
    grammarLensLine(beat.grammar),
    beat.cam?.trim(),
    beat.framing?.trim(),
  ].filter(Boolean).join('. ');
  const look = compileLookBible(show);
  const references = clip.elementTags.map(normalizeElementTag).filter(Boolean).join(' + ');
  const dialogue = beat.quote?.trim()
    ? `${beat.speaker ? `${normalizeElementTag(beat.speaker)} says` : 'Dialogue at this moment'}: “${beat.quote.trim()}”. Show a natural speaking moment, but do not render captions or text.`
    : '';
  const blocks = [
    `LIVE-ACTION FILM FRAME — ${clipLabel} / SHOT ${beat.n}`,
    'Create one photorealistic live-action motion-picture frame for this exact moment, as if photographed on the finished film set by the production cinematographer. This is a final-film previsualization still, not concept art. One image, one camera angle, no collage, no split panels, no captions, no labels, no border.',
    'IMAGE MEDIUM — Real actors, real wardrobe, a physically built or dressed location, practical props, natural skin and fabric texture, photographic depth of field, physically plausible light, restrained cinematic color grade, subtle film grain, and believable lens behavior. Preserve small human imperfections. The image must look like a frame captured from a live-action feature film.',
    `ACTION — ${action}`,
    lens ? `COMPOSITION — ${lens}` : '',
    `SCENE — ${scene.label}. ${clip.location.trim()} ${clip.subject.trim()}`.trim(),
    clip.blocking?.trim() ? `BLOCKING — ${clip.blocking.trim()}` : '',
    dialogue,
    references ? `ACTIVE REFERENCES — ${references}. Match every supplied Element image exactly: character identity and wardrobe, location architecture and dressing, prop design, and vehicle design. Treat these images as identity locks, not loose inspiration.` : '',
    clip.style.trim() ? `SHOT STYLE — ${clip.style.trim()}` : '',
    look ? `LOOK BIBLE — ${look}` : '',
    `FRAME — ${show.aspectRatio}. Compose this as a practical production frame that clearly communicates lens choice, camera height, angle, subject size, screen direction, and negative space. Preserve the action wording above; do not invent a later or earlier beat.`,
    'NON-NEGOTIABLE — No drawing, illustration, painting, anime, comic-book rendering, cel shading, concept-art treatment, 3D-rendered character look, game-cinematic look, plastic skin, exaggerated anatomy, or storyboard sketch aesthetic. Do not make the image look designed or hand-rendered. It must remain photographic and live action even when the scene is surreal.',
  ];
  return blocks.filter(Boolean).join('\n\n');
}

export function storyboardSourceHash(
  show: DirectorShow,
  scene: DirectorScene,
  clip: DirectorClip,
  beat: DirectorBeat,
): string {
  return simpleHash(JSON.stringify({
    scene: scene.label,
    subject: clip.subject,
    location: clip.location,
    blocking: clip.blocking,
    style: clip.style,
    tags: clip.elementTags,
    beat: {
      n: beat.n,
      text: beat.text,
      cam: beat.cam,
      framing: beat.framing,
      grammar: beat.grammar,
      quote: beat.quote,
      speaker: beat.speaker,
    },
    aspectRatio: show.aspectRatio,
    look: compileLookBible(show),
  }));
}

export function storyboardPlan(show: DirectorShow): StoryboardPlanFrame[] {
  const labels = clipDisplayLabels(show.scenes, show.clips);
  const savedById = new Map((show.storyboardFrames ?? []).map((frame) => [frame.id, frame]));
  const frames: StoryboardPlanFrame[] = [];
  for (const scene of show.scenes) {
    for (const clip of show.clips) {
      if (clip.sceneId !== scene.id || clip.altOf) continue;
      const clipLabel = labels.get(clip.id) ?? `${scene.number}`;
      for (const beat of clip.beats) {
        const id = storyboardFrameId(clip.id, beat.n);
        const saved = savedById.get(id);
        const derivedPrompt = storyboardPrompt(show, scene, clip, beat, clipLabel);
        const prompt = saved?.customPrompt ? saved.prompt : derivedPrompt;
        const sourceHash = storyboardSourceHash(show, scene, clip, beat);
        frames.push({
          id,
          clip,
          scene,
          beat,
          clipLabel,
          derivedPrompt,
          prompt,
          sourceHash,
          saved,
          stale: Boolean(saved?.imageUrl && (
            saved.generatedSourceHash !== sourceHash
            || saved.generatedPrompt !== prompt
          )),
        });
      }
    }
  }
  return frames;
}

export function upsertStoryboardFrame(
  show: DirectorShow,
  plan: StoryboardPlanFrame,
  patch: Partial<DirectorStoryboardFrame>,
): DirectorShow {
  const frames = show.storyboardFrames ?? [];
  const existing = frames.find((frame) => frame.id === plan.id);
  const base: DirectorStoryboardFrame = existing ?? {
    id: plan.id,
    clipId: plan.clip.id,
    beatN: plan.beat.n,
    prompt: plan.prompt,
    modelId: show.storyboardModelId ?? 'nano_banana_2',
    status: 'idle',
  };
  const next = { ...base, ...patch };
  return {
    ...show,
    storyboardFrames: existing
      ? frames.map((frame) => frame.id === plan.id ? next : frame)
      : [...frames, next],
  };
}

export function storyboardReferenceUrls(
  show: DirectorShow,
  clip: DirectorClip,
  elements: Element[],
  max = 8,
): string[] {
  return storyboardReferences(show, clip, elements, max).references.map((reference) => reference.url);
}

function referenceTagKey(value: string): string {
  return normalizeElementTag(value).replace(/^@/, '').replace(/[-_\s]+/g, ' ').trim().toLowerCase();
}

export function storyboardReferences(
  show: DirectorShow,
  clip: DirectorClip,
  elements: Element[],
  max = 8,
): StoryboardReferenceSet {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const breakdownByTag = new Map(show.breakdown.map((item) => [referenceTagKey(item.tag), item]));
  const references: StoryboardReference[] = [];
  const missingElementTags: string[] = [];
  for (const rawTag of clip.elementTags) {
    const tag = normalizeElementTag(rawTag);
    const tagName = referenceTagKey(tag);
    const breakdown = breakdownByTag.get(tagName);
    const element = (breakdown?.elementId ? byId.get(breakdown.elementId) : undefined)
      ?? elements.find((entry) => referenceTagKey(entry.name) === tagName);
    const url = element?.images[0]?.url?.trim();
    if (element && url && !references.some((reference) => reference.url === url)) {
      references.push({
        id: element.id,
        name: element.name,
        url,
        source: 'element',
        type: element.type,
        tag,
      });
    } else if (!url && !missingElementTags.includes(tag)) {
      missingElementTags.push(tag);
    }
  }
  for (const [index, url] of lookBibleImageUrls(show).entries()) {
    if (!references.some((reference) => reference.url === url)) {
      const moodBoard = show.lookBible?.moodBoards?.find((board) => board.url === url);
      references.push({
        id: moodBoard?.id ?? `look-${index}`,
        name: moodBoard?.name?.trim() || `Look reference ${index + 1}`,
        url,
        source: 'look-bible',
      });
    }
  }
  return { references: references.slice(0, max), missingElementTags };
}

export function storyboardPromptWithReferences(
  prompt: string,
  references: StoryboardReference[],
): string {
  if (references.length === 0) return prompt;
  const bindings = references.map((reference, index) => (
    `IMAGE ${index + 1} — ${reference.source === 'element' ? `ELEMENT ${reference.tag ?? reference.name}` : 'LOOK BIBLE'}: ${reference.name}. ${reference.source === 'element' ? 'Match its visible identity and design exactly.' : 'Use only its photographic lighting, palette, texture, and atmosphere; do not copy an illustrated medium.'}`
  ));
  return `${prompt}\n\nSUPPLIED IMAGE BINDINGS — Use these exact roles; do not merge identities or assign one image to another subject.\n${bindings.join('\n')}`;
}

export function storyboardModelLabel(modelId: string | undefined): string {
  return STORYBOARD_MODELS.find((model) => model.value === modelId)?.shortLabel ?? 'Nano Banana 2';
}

export function storyboardResultUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  if (typeof value === 'string') return /^https?:\/\//i.test(value) || value.startsWith('local-media://') || value.startsWith('/media/')
    ? value
    : undefined;
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = storyboardResultUrl(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['url', 'image_url', 'imageUrl', 'output_url', 'result_url']) {
    const found = storyboardResultUrl(record[key], depth + 1);
    if (found) return found;
  }
  for (const key of ['output', 'result', 'data', 'images', 'outputs']) {
    const found = storyboardResultUrl(record[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function storyboardErrorText(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^FirebaseError:\s*/i, '').trim();
  return String(error ?? '').trim();
}

export function isRetryableStoryboardError(error: unknown): boolean {
  const message = storyboardErrorText(error).toLowerCase();
  return [
    'internal [0]',
    'request failed',
    'no response received',
    'api request failed',
    'network error',
    'fetch failed',
    'socket hang up',
    'econnreset',
    'etimedout',
    'http 502',
    'http 503',
    'http 504',
  ].some((needle) => message.includes(needle));
}

export function storyboardGenerationErrorMessage(error: unknown): string {
  const message = storyboardErrorText(error);
  if (isRetryableStoryboardError(error)) {
    return 'Higgsfield could not accept the request after three attempts. Its image service may be temporarily unavailable—wait a moment, then retry this frame or select GPT Image 2.';
  }
  if (!message) return 'Storyboard generation failed. Retry this frame.';
  return message;
}

export async function runStoryboardWithRetry<T>(
  task: () => Promise<T>,
  options: { attempts?: number; wait?: (delayMs: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryableStoryboardError(error) || attempt === attempts) throw error;
      await wait(attempt === 1 ? 1_200 : 3_000);
    }
  }
  throw lastError;
}
