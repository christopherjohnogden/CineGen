import { generateId } from '@/lib/utils/ids';

export type ScreenplayElementType =
  | 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';

export interface ScreenplayElement { id: string; type: ScreenplayElementType; text: string }
export interface Screenplay { elements: ScreenplayElement[] }

export const ELEMENT_CYCLE: ScreenplayElementType[] =
  ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];

const SCENE_HEADING = /^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)[\s.]/i;
const TRANSITION = /(TO:|^FADE (IN|OUT)|^DISSOLVE|^SMASH CUT|^MATCH CUT)/;
/** File-format chrome after </Content> — not the <FinalDraft> root (that would wipe a raw .fdx). */
const FDX_CHROME = /<(ElementSettings|FontSpec|ParagraphSpec|Behavior|Outline|WindowState|SmartType|HeaderAndFooter|MoresAndContinueds)\b/i;

/** True when a line is Final Draft file chrome, not script. */
export function isFdxChromeLine(text: string): boolean {
  return FDX_CHROME.test(text)
    || /\bAdornmentStyle\s*=/.test(text)
    || /\bPaginateAs\s*=/.test(text)
    || /\bFont\s*=\s*"Courier Final Draft"/i.test(text);
}

/** Drop the ElementSettings / FontSpec trailer Final Draft appends after the script. */
export function trimFdxTrailer(text: string): string {
  const tagIdx = text.search(FDX_CHROME);
  const lines = text.split('\n');
  const lineIdx = lines.findIndex((line) => isFdxChromeLine(line));
  const lineCut = lineIdx === -1 ? -1 : lines.slice(0, lineIdx).join('\n').length;
  const cuts = [tagIdx, lineCut].filter((n) => n >= 0);
  if (cuts.length === 0) return text;
  return text.slice(0, Math.min(...cuts)).replace(/\s+$/, '');
}

/** Drop trailing FDX-chrome elements (and trim chrome off the last real line). */
export function scrubFdxChrome(elements: ScreenplayElement[]): ScreenplayElement[] {
  const out: ScreenplayElement[] = [];
  for (const el of elements) {
    if (isFdxChromeLine(el.text)) break;
    const text = trimFdxTrailer(el.text);
    if (!text) break;
    out.push(text === el.text ? el : { ...el, text });
  }
  return out;
}

function isAllCaps(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}
function isCharacterCue(t: string): boolean {
  if (t.length === 0 || t.length > 30) return false;
  if (SCENE_HEADING.test(t)) return false;
  return isAllCaps(t) && !t.endsWith(':');
}

export function parseToScreenplay(source: string): Screenplay {
  const elements: ScreenplayElement[] = [];
  let inDialogue = false;
  for (const raw of trimFdxTrailer(source.replace(/^\uFEFF/, '')).split('\n')) {
    const t = raw.trim();
    if (t === '') { inDialogue = false; continue; }
    let type: ScreenplayElementType;
    if (SCENE_HEADING.test(t)) { type = 'scene'; inDialogue = false; }
    else if (isAllCaps(t) && TRANSITION.test(t)) { type = 'transition'; inDialogue = false; }
    else if (isCharacterCue(t)) { type = 'character'; inDialogue = true; }
    else if (inDialogue && /^\(.*\)$/.test(t)) { type = 'parenthetical'; }
    else if (inDialogue) { type = 'dialogue'; }
    else { type = 'action'; }
    elements.push({ id: generateId(), type, text: t });
  }
  return { elements };
}

/** Prefer the screenplay's typed blocks when they are available. Re-parsing the
 * flattened text can otherwise turn action immediately after dialogue into more
 * dialogue, because plain text has no Final Draft paragraph metadata. */
export function screenplayFromSource(source: {
  sourceText: string;
  sourceElements?: ScreenplayElement[];
}): Screenplay {
  if (source.sourceElements) {
    return { elements: scrubFdxChrome(source.sourceElements) };
  }
  return parseToScreenplay(source.sourceText);
}

export function serializeScreenplay(doc: Screenplay): string {
  // Preserve screenplay block boundaries in the plain-text mirror. In
  // particular, action after a dialogue block needs a blank line or a later
  // plain-text parse will incorrectly keep it in the dialogue column.
  const out: string[] = [];
  doc.elements.forEach((el, i) => {
    const previous = doc.elements[i - 1];
    const startsNewBlock = el.type === 'scene'
      || el.type === 'character'
      || el.type === 'transition'
      || (el.type === 'action' && previous != null && (
        previous.type === 'character'
        || previous.type === 'parenthetical'
        || previous.type === 'dialogue'
      ));
    if (i > 0 && startsNewBlock && out[out.length - 1] !== '') out.push('');
    out.push(el.text);
  });
  return out.join('\n');
}

export function nextElementType(t: ScreenplayElementType, reverse = false): ScreenplayElementType {
  const i = ELEMENT_CYCLE.indexOf(t);
  const n = ELEMENT_CYCLE.length;
  return ELEMENT_CYCLE[(i + (reverse ? -1 : 1) + n) % n];
}

export function typeAfterEnter(t: ScreenplayElementType): ScreenplayElementType {
  switch (t) {
    case 'character': return 'dialogue';
    case 'parenthetical': return 'dialogue';
    case 'dialogue': return 'dialogue';
    case 'scene': return 'action';
    case 'transition': return 'scene';
    default: return 'action';
  }
}
