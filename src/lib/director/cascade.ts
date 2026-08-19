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
  // Group by base heading first so duplicate-heading scenes can be assigned
  // their #n suffix by content (body hash) rather than by document position.
  // This keeps (key -> hash) pairs stable when two same-heading scenes with
  // different bodies are merely reordered.
  const groups = new Map<string, { body: string; h: string }[]>();
  for (const sc of scenes) {
    const base = sc.heading.trim().toUpperCase() || '(untitled)';
    const body = sc.elements.map((e) => e.text).join('\n');
    const list = groups.get(base) ?? [];
    list.push({ body, h: hash(body) });
    groups.set(base, list);
  }
  for (const [base, list] of groups) {
    const ordered = list.length > 1
      ? [...list].sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
      : list;
    ordered.forEach((entry, n) => {
      const key = n === 0 ? base : `${base}#${n}`;
      out.set(key, entry.h);
    });
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
