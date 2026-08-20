import { parseToScreenplay } from './screenplay';

/** How many fal.ai any-llm jobs we keep in flight. Each is an independent
 *  queue subscribe — fal has no client-side serial lock, and Gemini Flash
 *  is latency-bound, so 3 parallel 20s calls beat 3 sequential ones. */
export const FAL_SHOTLIST_CONCURRENCY = 3;

/** Clips per Flash call. 3–5 clips is the ~20s batch we already measured;
 *  asking for a whole 12-clip scene in one job is what made wall-clock jump to 60s. */
export const FAL_SHOTLIST_CLIP_BATCH = 5;

/** Split a long scene across this many parallel jobs. Short scenes stay at 1
 *  (splitting a 3-clip scene just adds merge risk). */
export function falSliceCount(estClips: number): number {
  if (estClips < 6) return 1;
  return Math.min(FAL_SHOTLIST_CONCURRENCY, Math.max(2, Math.ceil(estClips / FAL_SHOTLIST_CLIP_BATCH)));
}

export function falSliceBatchSize(estClips: number, sliceCount: number): number {
  const share = Math.ceil(estClips / Math.max(1, sliceCount));
  return Math.min(FAL_SHOTLIST_CLIP_BATCH, Math.max(4, share));
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

/** Character cue + its dialogue stays atomic; action lines are their own units.
 *  Scene scripts are joined with single newlines (no blank-line paragraphs),
 *  so blank-line splitting used to collapse a 12-clip scene into ONE job. */
export function screenplayUnits(text: string): string[] {
  const elements = parseToScreenplay(text).elements;
  const units: string[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (element.type === 'character') {
      const chunk = [element.text];
      while (index + 1 < elements.length) {
        const next = elements[index + 1];
        if (next.type !== 'dialogue' && next.type !== 'parenthetical') break;
        chunk.push(next.text);
        index += 1;
      }
      units.push(chunk.join('\n'));
      continue;
    }
    if (element.type === 'scene') continue;
    if (element.text.trim()) units.push(element.text.trim());
  }
  return units.length > 0 ? units : (text.trim() ? [text.trim()] : []);
}

function splitOversizedUnit(unit: string): [string, string] | null {
  const mid = Math.floor(unit.length / 2);
  const breakAt = unit.lastIndexOf('\n', mid) || unit.lastIndexOf('. ', mid);
  if (breakAt < 20 || breakAt > unit.length - 20) return null;
  return [unit.slice(0, breakAt).trim(), unit.slice(breakAt).trim()];
}

function packUnits(units: string[], sliceCount: number): string[] {
  const n = Math.max(1, sliceCount);
  const expandable = [...units];
  while (expandable.length < n) {
    let longest = 0;
    for (let index = 1; index < expandable.length; index += 1) {
      if (expandable[index].length > expandable[longest].length) longest = index;
    }
    const parts = splitOversizedUnit(expandable[longest] ?? '');
    if (!parts) break;
    expandable.splice(longest, 1, parts[0], parts[1]);
  }
  const count = Math.min(n, Math.max(1, expandable.length));
  if (count <= 1) return [expandable.join('\n')];

  const weights = expandable.map((unit) => Math.max(1, wordCount(unit)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const slices: string[] = [];
  let cursor = 0;
  let consumed = 0;
  for (let slice = 0; slice < count; slice += 1) {
    if (slice === count - 1) {
      slices.push(expandable.slice(cursor).join('\n'));
      break;
    }
    const goal = total * (slice + 1) / count;
    const remainingSlices = count - slice - 1;
    const lastIndexWeCanTake = expandable.length - remainingSlices;
    const start = cursor;
    while (cursor + 1 < lastIndexWeCanTake && consumed + weights[cursor] < goal) {
      consumed += weights[cursor];
      cursor += 1;
    }
    if (cursor < lastIndexWeCanTake) {
      consumed += weights[cursor];
      cursor += 1;
    }
    if (cursor <= start) {
      consumed += weights[start] ?? 0;
      cursor = start + 1;
    }
    slices.push(expandable.slice(start, cursor).join('\n'));
  }
  return slices.filter((slice) => slice.trim().length > 0);
}

/** Pack the scene into `sliceCount` chronological excerpts of similar length. */
export function splitScriptForCoverage(text: string, sliceCount: number): string[] {
  const trimmed = text.trim();
  if (!trimmed || sliceCount <= 1) return [trimmed];
  return packUnits(screenplayUnits(trimmed), sliceCount);
}

export function createGate(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        await new Promise<void>((resolve) => { waiting.push(resolve); });
      }
      active += 1;
      try {
        return await fn();
      } finally {
        active -= 1;
        waiting.shift()?.();
      }
    },
  };
}
