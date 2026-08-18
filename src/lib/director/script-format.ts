export type ScriptLineType =
  | 'scene-heading'
  | 'transition'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'action';

export interface ScriptLine {
  type: ScriptLineType;
  text: string;
  /** 0-based scene number; set on scene-heading lines. */
  sceneIndex?: number;
}

const SCENE_HEADING = /^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)[\s.]/i;
const TRANSITION = /(TO:|^FADE (IN|OUT)|^DISSOLVE|^SMASH CUT|^MATCH CUT)/;

function isAllCaps(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

function isCharacterCue(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 30) return false;
  if (SCENE_HEADING.test(t)) return false;
  return isAllCaps(t) && !t.endsWith(':');
}

export function parseScreenplay(source: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  let sceneIndex = -1;
  let inDialogue = false;
  const rawLines = source.replace(/^﻿/, '').split('\n');

  for (const raw of rawLines) {
    const t = raw.trim();

    if (t === '') {
      out.push({ type: 'action', text: '' });
      inDialogue = false;
      continue;
    }
    if (SCENE_HEADING.test(t)) {
      sceneIndex += 1;
      out.push({ type: 'scene-heading', text: t, sceneIndex });
      inDialogue = false;
      continue;
    }
    if (isAllCaps(t) && TRANSITION.test(t)) {
      out.push({ type: 'transition', text: t });
      inDialogue = false;
      continue;
    }
    if (isCharacterCue(t)) {
      out.push({ type: 'character', text: t });
      inDialogue = true;
      continue;
    }
    if (inDialogue && /^\(.*\)$/.test(t)) {
      out.push({ type: 'parenthetical', text: t });
      continue;
    }
    if (inDialogue) {
      out.push({ type: 'dialogue', text: t });
      continue;
    }
    out.push({ type: 'action', text: t });
  }

  return out;
}
