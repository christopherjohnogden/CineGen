import type {
  DirectorBeat,
  DirectorBreakdownItem,
  DirectorClip,
  DirectorShow,
  IsolateVariant,
} from '@/types/director';
import { grammarLensLine, resolveCameraMove } from './craft/coverage';
import { clipWithResolvedStaging } from './framing-reserve';
import { compileLookBible } from './look-bible';
import { variantKey } from './slate';

/** The pinned LTX-2.5 worker rejects raw prompts above this size. */
export const LTX25_PROMPT_MAX_CHARS = 1_000;
export const LTX25_PROMPT_MAX_WORDS = 200;

export interface Ltx25DirectorPrompt {
  prompt: string;
  durationSec: number;
}

interface PromptUnit {
  order: number;
  priority: number;
  text: string;
}

interface ManualPromptEdits {
  actions: Map<number, string>;
  freeform?: string;
  style?: string;
}

const CAMERA_MOVE_COPY: Record<string, string> = {
  locked: 'The camera stays still',
  'push-in': 'The camera slowly dollies closer',
  'pull-out': 'The camera slowly dollies back',
  'track-left': 'The camera tracks left',
  'track-right': 'The camera tracks right',
  'crane-up': 'The camera cranes upward',
  'crane-down': 'The camera cranes downward',
  'pan-left': 'The camera pans left',
  'pan-right': 'The camera pans right',
  'tilt-up': 'The camera tilts upward',
  'tilt-down': 'The camera tilts downward',
};

const COMPILED_HEADING = /^(?:SCENE CONTEXT|ACTIVE REFERENCES|LOCATION MAP|FORMAT MODE|DIALOGUE|AUDIO|STYLE|POSITIVE LOCKS|FRAMING REFERENCE|LETTER LEGEND|LOCKS|RENDER RULE)\b/i;
const COMPILED_DETAIL = /^(?:ACTING TASK|SCENE DIRECTION|MOTIVE|GOAL|OBSTACLE|TACTIC|TAKE NOTE|DIRECTION|Moment to moment|LENS:)\b/i;

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^@/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function fallbackTagName(tag: string): string {
  return tag.replace(/^@/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function itemForTag(tag: string, breakdown: DirectorBreakdownItem[]): DirectorBreakdownItem | undefined {
  const key = normalizeTag(tag);
  return breakdown.find((item) => normalizeTag(item.tag) === key);
}

function tagNames(show: Pick<DirectorShow, 'breakdown'>): Map<string, string> {
  return new Map(show.breakdown.map((item) => [normalizeTag(item.tag), item.name.trim() || fallbackTagName(item.tag)]));
}

function replaceTags(text: string, names: Map<string, string>): string {
  return text.replace(/@[A-Za-z0-9][A-Za-z0-9_-]*/g, (tag) => (
    names.get(normalizeTag(tag)) || fallbackTagName(tag)
  ));
}

function cleanText(text: string | undefined, names: Map<string, string>): string {
  if (!text) return '';
  return replaceTags(text, names)
    .replace(/\b(?:CONSTRAINTS|ACTION)\s*[—:-]\s*/gi, '')
    .replace(/\bMULTISHOT\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTerminalPunctuation(text: string): string {
  return text.replace(/[\s.!?;:,—-]+$/g, '').trim();
}

function withSentencePunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?]["”']?$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Shorten prose at a sentence/word boundary. Dialogue is never passed here. */
function compactProse(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized || maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, maxChars + 1);
  const sentenceEnds = [...slice.matchAll(/[.!?](?=\s|$)/g)];
  const sentenceEnd = sentenceEnds.at(-1)?.index;
  if (sentenceEnd != null && sentenceEnd >= Math.min(36, Math.floor(maxChars / 2))) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const wordEnd = slice.lastIndexOf(' ', maxChars);
  let cut = stripTerminalPunctuation(normalized.slice(0, wordEnd > 20 ? wordEnd : maxChars).trim());
  // A word-boundary cut can otherwise leave fragments such as "with a." or
  // "begins in one.". Peel incomplete connectors only on shortened prose.
  const danglingTail = /\b(?:a|an|the|and|or|but|with|without|of|to|in|on|at|by|for|from|as|into|onto|over|under|through|before|after|while|one)\s*$/i;
  let previous = '';
  while (cut && cut !== previous && danglingTail.test(cut)) {
    previous = cut;
    cut = stripTerminalPunctuation(cut.replace(danglingTail, '').trim());
  }
  return withSentencePunctuation(cut);
}

function lowerFirst(text: string): string {
  if (!text) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function continuationCase(text: string): string {
  return /^(?:A|An|The|He|She|It|They|This|That|His|Her|Their)\b/.test(text)
    ? lowerFirst(text)
    : text;
}

function indefiniteArticle(text: string): string {
  return /^[aeiou]/i.test(text.trim()) ? 'an' : 'a';
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function ltx25PromptWithinBudget(prompt: string): boolean {
  return prompt.length <= LTX25_PROMPT_MAX_CHARS && wordCount(prompt) <= LTX25_PROMPT_MAX_WORDS;
}

function compose(units: PromptUnit[]): string {
  return units
    .filter((unit) => unit.text.trim())
    .sort((a, b) => a.order - b.order)
    .map((unit) => withSentencePunctuation(unit.text))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addOptionalUnits(essential: PromptUnit[], optional: PromptUnit[]): PromptUnit[] {
  const chosen = [...essential];
  for (const candidate of [...optional].sort((a, b) => b.priority - a.priority)) {
    const next = [...chosen, candidate];
    if (ltx25PromptWithinBudget(compose(next))) chosen.push(candidate);
  }
  return chosen;
}

function parseManualEdits(body: string | undefined): ManualPromptEdits {
  const actions = new Map<number, string>();
  if (!body?.trim()) return { actions };
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let segment: number | undefined;
  let section = '';
  let compiledShape = false;
  let style: string | undefined;

  for (const line of lines) {
    const segmentMatch = line.match(/^SEGMENT\s+(\d+)\b/i);
    if (segmentMatch) {
      segment = Number(segmentMatch[1]);
      section = 'segment';
      compiledShape = true;
      continue;
    }
    if (COMPILED_HEADING.test(line)) {
      compiledShape = true;
      section = /^STYLE\b/i.test(line) ? 'style' : '';
      segment = undefined;
      continue;
    }
    if (COMPILED_DETAIL.test(line)) continue;
    if (section === 'segment' && segment != null && !actions.has(segment)) {
      actions.set(segment, line);
      continue;
    }
    if (section === 'style' && !style) style = line;
  }

  return {
    actions,
    style,
    ...(!compiledShape ? { freeform: body.replace(/\s+/g, ' ').trim() } : {}),
  };
}

function descriptionUnit(item: DirectorBreakdownItem, names: Map<string, string>, maxChars: number): string {
  const name = item.name.trim() || fallbackTagName(item.tag);
  const description = compactProse(cleanText(item.description, names), maxChars);
  if (!description) return '';
  const desc = stripTerminalPunctuation(description);
  if (item.kind === 'location') return `The setting is ${continuationCase(desc)}`;
  if (item.kind === 'character') return `${name} is ${continuationCase(desc)}`;
  return `The ${name} is ${continuationCase(desc)}`;
}

function rankedReferenceItems(show: DirectorShow, clip: DirectorClip): DirectorBreakdownItem[] {
  const mentioned = cleanText(clip.beats.map((beat) => `${beat.text} ${beat.speaker ?? ''}`).join(' '), tagNames(show)).toLowerCase();
  const items = clip.elementTags
    .map((tag) => itemForTag(tag, show.breakdown))
    .filter((item): item is DirectorBreakdownItem => Boolean(item));
  const rank = (item: DirectorBreakdownItem) => {
    const visible = mentioned.includes(item.name.trim().toLowerCase()) ? 10 : 0;
    const kind = item.kind === 'character' ? 4 : item.kind === 'location' ? 3 : 1;
    return visible + kind;
  };
  return items
    .filter((item, index) => items.findIndex((entry) => normalizeTag(entry.tag) === normalizeTag(item.tag)) === index)
    .sort((a, b) => rank(b) - rank(a));
}

function stagingSentence(clip: DirectorClip, names: Map<string, string>, limit: number): string {
  const figures = clip.staging?.enabled ? clip.staging.figures : [];
  if (figures.length === 0) return '';
  const positions = figures.map((figure) => {
    const name = names.get(normalizeTag(figure.tag)) || fallbackTagName(figure.tag);
    return `${name} ${cleanText(figure.position, names) || 'holds the supplied position'}`;
  });
  return compactProse(`${positions.join('; ')}. Their screen positions and facing remain stable across every cut.`, limit);
}

function actionWithoutRepeatedDialogue(text: string, quote: string | undefined): string {
  if (!quote?.trim()) return text;
  const exact = quote.trim();
  return text
    .replace(`“${exact}”`, '')
    .replace(`"${exact}"`, '')
    .replace(exact, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function beatFraming(beat: DirectorBeat, names: Map<string, string>): string {
  const grammar = grammarLensLine(beat.grammar);
  const source = grammar || beat.cam || beat.framing || 'cinematic eye-level view';
  const clean = cleanText(source, names)
    .replace(/^(?:hard|smash|match|reverse|insert|whip)\s+cut(?:\s+to)?[\s,:.—-]*/i, '')
    .replace(/\b(?:failed take|no cut|no zoom|no reframe)\b.*$/i, '')
    .trim();
  return stripTerminalPunctuation(compactProse(clean, 72)) || 'cinematic eye-level view';
}

function voiceForBeat(beat: DirectorBeat, show: DirectorShow, names: Map<string, string>): string {
  if (!beat.speaker) return '';
  const item = itemForTag(beat.speaker, show.breakdown);
  const voice = cleanText(item?.voice?.replace(/^["“]|["”]$/g, ''), names);
  return stripTerminalPunctuation(compactProse(voice, 72));
}

function speakerName(beat: DirectorBeat, show: DirectorShow): string {
  if (!beat.speaker) return 'A voice';
  return itemForTag(beat.speaker, show.breakdown)?.name.trim() || fallbackTagName(beat.speaker);
}

function dialoguePhrase(
  beat: DirectorBeat,
  show: DirectorShow,
  names: Map<string, string>,
  includeVoice = true,
): string {
  const quote = beat.quote?.trim();
  if (!quote) return '';
  const spoken = /^["“].*["”]$/.test(quote) ? quote : `"${quote}"`;
  const voice = includeVoice ? voiceForBeat(beat, show, names) : '';
  return voice
    ? `${speakerName(beat, show)} says in ${continuationCase(voice)}, ${spoken}`
    : `${speakerName(beat, show)} says ${spoken}`;
}

function cameraMoveSentence(show: DirectorShow, clip: DirectorClip, beat: DirectorBeat): string {
  const scene = show.scenes.find((entry) => entry.id === clip.sceneId);
  const move = resolveCameraMove({
    beat: beat.grammar,
    clip: clip.cameraMove,
    scene: scene?.cameraMove,
  });
  return CAMERA_MOVE_COPY[move.move] || CAMERA_MOVE_COPY.locked;
}

function beatSentence(args: {
  beat: DirectorBeat;
  index: number;
  show: DirectorShow;
  clip: DirectorClip;
  names: Map<string, string>;
  manualAction?: string;
  actionLimit: number;
  includeVoice: boolean;
  continuous: boolean;
  held: boolean;
}): string {
  const { beat, index, show, clip, names, manualAction, actionLimit, includeVoice, continuous, held } = args;
  const rawAction = cleanText(actionWithoutRepeatedDialogue(manualAction || beat.text, beat.quote), names)
    .replace(/^(?:hard|smash|match|reverse|insert|whip)\s+cut(?:\s+to)?[\s,:.—-]*/i, '');
  const action = stripTerminalPunctuation(compactProse(rawAction || clip.subject, actionLimit)) || 'the action continues naturally';
  const framing = beatFraming(beat, names);
  const dialogue = dialoguePhrase(beat, show, names, includeVoice);
  const explicitBeatMove = Boolean(beat.grammar?.move && beat.grammar.move !== 'locked');
  const motion = index === 0 || explicitBeatMove ? cameraMoveSentence(show, clip, beat) : '';
  const locked = motion === CAMERA_MOVE_COPY.locked;
  const view = `${locked ? 'locked ' : ''}${framing}`;
  const motionSuffix = motion && !locked ? ` ${withSentencePunctuation(motion)}` : '';
  const actionAndDialogue = `${withSentencePunctuation(continuationCase(action))}${dialogue ? ` ${withSentencePunctuation(dialogue)}` : ''}`;

  if (continuous) {
    if (index === 0) {
      return `In one continuous take from ${indefiniteArticle(view)} ${view}: ${actionAndDialogue}${motionSuffix}`;
    }
    return `${held ? 'Then' : 'Next'}, without a cut, ${actionAndDialogue}`;
  }
  if (index === 0) return `A ${view} shows the scene: ${actionAndDialogue}${motionSuffix}`;
  return `A hard cut transitions to ${indefiniteArticle(view)} ${view}: ${actionAndDialogue}${motionSuffix}`;
}

function selectedBeats(clip: DirectorClip, variant: IsolateVariant): { beats: DirectorBeat[]; continuous: boolean; held: boolean; durationSec: number } {
  if (variant.kind === 'full') {
    return { beats: clip.beats.slice(0, 4), continuous: clip.beats.length <= 1, held: false, durationSec: clip.seconds };
  }
  const selected = clip.beats.find((beat) => beat.n === variant.beatN);
  if (!selected) return { beats: clip.beats.slice(0, 1), continuous: true, held: false, durationSec: clip.seconds };
  if (variant.mode === 'native') {
    return { beats: [selected], continuous: true, held: false, durationSec: selected.dur || clip.seconds };
  }
  return { beats: clip.beats.slice(0, 4), continuous: true, held: true, durationSec: clip.seconds };
}

function promptForLimits(args: {
  show: DirectorShow;
  clip: DirectorClip;
  variant: IsolateVariant;
  hasFirstFrame: boolean;
  actionLimit: number;
  descriptionLimit: number;
  manualLimit: number;
  includeVoice: boolean;
}): string {
  const { show, clip, variant, hasFirstFrame, actionLimit, descriptionLimit, manualLimit, includeVoice } = args;
  const names = tagNames(show);
  const manual = parseManualEdits(clip.bodyEdits[variantKey(variant)]);
  const selection = selectedBeats(clip, variant);
  const references = rankedReferenceItems(show, clip);
  const essential: PromptUnit[] = [];
  const optional: PromptUnit[] = [];

  if (hasFirstFrame) {
    essential.push({ order: 0, priority: 100, text: 'The first frame locks composition and identity' });
  }

  for (const [index, item] of references.slice(0, 2).entries()) {
    const text = descriptionUnit(item, names, descriptionLimit);
    if (text) essential.push({ order: 10 + index, priority: 95 - index, text });
  }
  for (const [index, item] of references.slice(2, 5).entries()) {
    const text = descriptionUnit(item, names, descriptionLimit);
    if (text) optional.push({ order: 12 + index, priority: 70 - index, text });
  }

  if (manual.freeform) {
    // A freeform body edit replaced the old compiled body in Director, so it is
    // authoritative here too. Keep exact structured dialogue, but do not sneak
    // the superseded beat actions/location/style back into the LTX paragraph.
    const first = selection.beats[0];
    const framing = first ? beatFraming(first, names) : 'cinematic eye-level view';
    const direction = stripTerminalPunctuation(compactProse(cleanText(manual.freeform, names), manualLimit));
    essential.push({
      order: 50,
      priority: 100,
      text: first
        ? `In ${indefiniteArticle(framing)} ${framing}, ${continuationCase(direction || 'the revised action plays naturally')}. ${cameraMoveSentence(show, clip, first)}`
        : direction,
    });
    selection.beats.filter((beat) => beat.quote?.trim()).forEach((beat, index) => {
      essential.push({ order: 60 + index, priority: 100, text: dialoguePhrase(beat, show, names, includeVoice) });
    });
  } else {
    // LTX benefits from one concrete place/light anchor. Scene action and
    // blocking are represented by the beats/staging below, so repeating them
    // here would spend scarce prompt space without adding visual information.
    const setting = compactProse(cleanText(clip.location, names), 90);
    if (setting) essential.push({ order: 30, priority: 100, text: setting });
    const staging = stagingSentence(clip, names, 135);
    if (staging) optional.push({ order: 31, priority: 88, text: staging });

    const look = compactProse(cleanText(manual.style || clip.style || compileLookBible(show), names), 125);
    if (look) optional.push({ order: 35, priority: 72, text: look });

    selection.beats.forEach((beat, index) => {
      const manualAction = manual.actions.get(beat.n)
        || (variant.kind === 'isolated' ? manual.actions.get(index + 1) : undefined);
      essential.push({
        order: 50 + index,
        priority: 100,
        text: beatSentence({
          beat,
          index,
          show,
          clip,
          names,
          manualAction,
          actionLimit,
          includeVoice,
          continuous: selection.continuous,
          held: selection.held,
        }),
      });
    });
  }

  const audio = show.generateAudio
    ? selection.beats.length > 1
      ? 'Room tone continues across every cut; dialogue, movement and sound stay synchronized'
      : 'Dialogue, movement and natural room tone stay synchronized'
    : 'The scene is silent';
  essential.push({ order: 90, priority: 100, text: audio });

  return compose(addOptionalUnits(essential, optional));
}

/**
 * Compile the structured Director clip into the concise paragraph LTX-2.5 expects.
 * The function is pure: it never writes back to the clip or show.
 */
export function compileLtx25DirectorPrompt(args: {
  show: DirectorShow;
  clip: DirectorClip;
  variant: IsolateVariant;
  hasFirstFrame?: boolean;
}): Ltx25DirectorPrompt {
  const clip = clipWithResolvedStaging(args.show, args.clip, args.variant);
  const selection = selectedBeats(clip, args.variant);
  const limits = [
    { actionLimit: 110, descriptionLimit: 120, manualLimit: 170, includeVoice: true },
    { actionLimit: 90, descriptionLimit: 120, manualLimit: 170, includeVoice: false },
    { actionLimit: 72, descriptionLimit: 120, manualLimit: 150, includeVoice: false },
    { actionLimit: 52, descriptionLimit: 95, manualLimit: 120, includeVoice: false },
    { actionLimit: 32, descriptionLimit: 64, manualLimit: 80, includeVoice: false },
  ];

  let prompt = '';
  for (const limit of limits) {
    prompt = promptForLimits({
      show: args.show,
      clip,
      variant: args.variant,
      hasFirstFrame: Boolean(args.hasFirstFrame),
      ...limit,
    });
    if (ltx25PromptWithinBudget(prompt)) break;
  }

  return { prompt, durationSec: selection.durationSec };
}
