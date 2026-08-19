import type { DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';

export interface SceneDiff { changed: string[]; removed: string[]; }

// FNV-1a — small, deterministic, dependency-free content hash.
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** One stable hash per scene. Key is content-derived so a pure reorder does not
 *  read as an edit; duplicate headings are disambiguated by an occurrence index. */
export function sceneHashes(show: DirectorShow): Map<string, string> {
  const out = new Map<string, string>();
  if (show.docKind === 'beatsheet') {
    for (const b of show.beatSheet?.beats ?? []) {
      out.set(`beat:${b.n}`, hash(`${b.action}|${b.location}|${b.shot}|${b.mood ?? ''}`));
    }
    return out;
  }
  const scenes = splitScenes(parseToScreenplay(show.sourceText));
  const seen = new Map<string, number>();
  for (const sc of scenes) {
    const base = sc.heading.trim().toUpperCase() || '(untitled)';
    const n = (seen.get(base) ?? 0);
    seen.set(base, n + 1);
    const key = n === 0 ? base : `${base}#${n}`;
    out.set(key, hash(sc.elements.map((e) => e.text).join('\n')));
  }
  return out;
}

export function diffScenes(prev: Map<string, string>, next: Map<string, string>): SceneDiff {
  const changed: string[] = [];
  for (const [key, h] of next) if (prev.get(key) !== h) changed.push(key);
  const removed: string[] = [];
  for (const key of prev.keys()) if (!next.has(key)) removed.push(key);
  return { changed, removed };
}
