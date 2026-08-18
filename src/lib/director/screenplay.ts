import { generateId } from '@/lib/utils/ids';

export type ScreenplayElementType =
  | 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';

export interface ScreenplayElement { id: string; type: ScreenplayElementType; text: string }
export interface Screenplay { elements: ScreenplayElement[] }

export const ELEMENT_CYCLE: ScreenplayElementType[] =
  ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];

const SCENE_HEADING = /^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)[\s.]/i;
const TRANSITION = /(TO:|^FADE (IN|OUT)|^DISSOLVE|^SMASH CUT|^MATCH CUT)/;

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
  for (const raw of source.replace(/^﻿/, '').split('\n')) {
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

export function serializeScreenplay(doc: Screenplay): string {
  // blank line before scene headings and character cues for readability; text is source of truth
  const out: string[] = [];
  doc.elements.forEach((el, i) => {
    if (i > 0 && (el.type === 'scene' || el.type === 'character' || el.type === 'transition')) out.push('');
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
