import type { Screenplay, ScreenplayElement } from '@/lib/director/screenplay';

export interface ScriptScene {
  index: number;
  heading: string;
  intExt?: string;
  timeOfDay?: string;
  elements: ScreenplayElement[];
}

const TIME_WORDS = /\b(DAY|NIGHT|DUSK|DAWN|MORNING|AFTERNOON|EVENING|CONTINUOUS|LATER|MOMENTS LATER|SAME)\b/i;

export function parseHeading(heading: string): { intExt?: string; timeOfDay?: string; place: string } {
  const intExtMatch = heading.match(/^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)\b/i);
  const intExt = intExtMatch ? intExtMatch[1].toUpperCase().replace(/\.$/, '') : undefined;
  // time-of-day: last ' - XXX' segment or a recognized time word
  let timeOfDay: string | undefined;
  const dash = heading.split(/\s[-—–]\s/);
  if (dash.length > 1) {
    const tail = dash[dash.length - 1].trim();
    if (TIME_WORDS.test(tail)) timeOfDay = tail.toUpperCase();
  }
  if (!timeOfDay) {
    const w = heading.match(TIME_WORDS);
    if (w) timeOfDay = w[1].toUpperCase();
  }
  // place: strip int/ext prefix and trailing time segment
  let place = heading.replace(/^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)\.?\s*/i, '');
  if (dash.length > 1 && timeOfDay) place = dash.slice(0, -1).join(' - ').replace(/^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)\.?\s*/i, '');
  place = place.trim();
  return { intExt, timeOfDay, place };
}

export function splitScenes(doc: Screenplay): ScriptScene[] {
  const scenes: ScriptScene[] = [];
  let current: ScriptScene | null = null;
  for (const el of doc.elements) {
    if (el.type === 'scene') {
      const meta = parseHeading(el.text);
      current = { index: scenes.length, heading: el.text, intExt: meta.intExt, timeOfDay: meta.timeOfDay, elements: [el] };
      scenes.push(current);
    } else {
      if (!current) { current = { index: 0, heading: '', elements: [] }; scenes.push(current); }
      current.elements.push(el);
    }
  }
  return scenes;
}
