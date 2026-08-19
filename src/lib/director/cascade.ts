import type { DirectorScene, DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import { detectSceneAssets } from '@/lib/director/scene-assets';

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

/** Screenplay scene keys, content-stable: grouped by base heading, then each
 *  group's members are ordered by body-content hash (not document position)
 *  before the `#n` occurrence suffix is assigned. This is the single source
 *  of truth for scene-key derivation — sceneHashes and scenesForKeys both
 *  route through it so their keys can never diverge. */
function sceneKeysFromParsedScenes(
  scenes: { heading: string; elements: { text: string }[] }[],
): { key: string; body: string }[] {
  const groups = new Map<string, { body: string; h: string }[]>();
  for (const sc of scenes) {
    const base = sc.heading.trim().toUpperCase() || '(untitled)';
    const body = sc.elements.map((e) => e.text).join('\n');
    const list = groups.get(base) ?? [];
    list.push({ body, h: hash(body) });
    groups.set(base, list);
  }
  const out: { key: string; body: string }[] = [];
  for (const [base, list] of groups) {
    const ordered = list.length > 1
      ? [...list].sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
      : list;
    ordered.forEach((entry, n) => {
      const key = n === 0 ? base : `${base}#${n}`;
      out.push({ key, body: entry.body });
    });
  }
  return out;
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
  for (const { key, body } of sceneKeysFromParsedScenes(scenes)) {
    out.set(key, hash(body));
  }
  return out;
}

/** The DirectorScene entries whose derived key is in `keys`, in show.scenes
 *  order.
 *
 *  show.scenes is LLM-authored (parseBreakdownPayload + mergeShotlist) and is
 *  NOT re-derived from sourceText when the script is edited — the exact
 *  moment dirty-key resolution runs. So show.scenes can differ in order
 *  and/or length from a fresh parse of sourceText. Keys are therefore
 *  derived directly from each DirectorScene's OWN `label`, never by zipping
 *  show.scenes against a fresh sourceText parse by array index.
 *
 *  Duplicate-heading disambiguation is best-effort: sceneHashes assigns the
 *  `#n` suffix by sorting same-heading scenes by BODY content-hash, but a
 *  DirectorScene only has `summary`/`event`, not the raw body elements used
 *  in that hash, so it cannot be recomputed identically here. For scenes
 *  sharing a base heading, we fall back to occurrence order within
 *  show.scenes (first same-heading scene -> base key, second -> `#1`, ...).
 *  This matches sceneHashes exactly whenever a heading is unique (the common
 *  case) and is a reasonable approximation otherwise. Beats have no
 *  DirectorScene yet, so beatsheet docKind returns []. */
export function scenesForKeys(show: DirectorShow, keys: string[]): DirectorScene[] {
  if (show.docKind === 'beatsheet') return [];
  const want = new Set(keys);
  const seen = new Map<string, number>();
  const out: DirectorScene[] = [];
  for (const sc of show.scenes) {
    const base = sc.label.trim().toUpperCase() || '(untitled)';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = n === 0 ? base : `${base}#${n}`;
    if (want.has(key)) out.push(sc);
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

/** Drop clips whose scene is gone and breakdown items no surviving scene
 *  references. `next` supplies the surviving scenes/text. An item is kept when
 *  any surviving scene's text mentions it OR any surviving scene override still
 *  lists its tag under `added`. Pure. */
export function pruneRemovedScenes(show: DirectorShow, next: DirectorShow): DirectorShow {
  const surviving = new Set(next.scenes.map((s) => s.id));
  const clips = show.clips.filter((c) => surviving.has(c.sceneId));

  const referenced = new Set<string>();
  const scenes = splitScenes(parseToScreenplay(next.sourceText));
  for (const sc of scenes) {
    for (const hit of detectSceneAssets(sc, show.breakdown)) {
      if (hit.item) referenced.add(hit.item.tag);
    }
  }
  for (const [idx, ov] of Object.entries(next.sceneAssetOverrides ?? {})) {
    if (Number(idx) >= next.scenes.length) continue; // stale index — scene it referenced is gone
    for (const tag of ov.added) referenced.add(tag);
  }
  const breakdown = show.breakdown.filter((b) => referenced.has(b.tag));

  return { ...show, clips, breakdown };
}

function remapIndexMap<T>(map: Record<number, T> | undefined, prevKeys: string[], nextKeys: string[]): Record<number, T> | undefined {
  if (!map) return map;
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(map)) {
    const oldIdx = Number(k);
    const key = prevKeys[oldIdx];
    if (key === undefined) continue;
    const newIdx = nextKeys.indexOf(key);
    if (newIdx >= 0) out[newIdx] = v;
  }
  return out;
}

/** Rewrite the index-keyed per-scene maps so each entry follows its scene after
 *  an insert/remove. Entries whose scene vanished are dropped. */
export function remapSceneIndexMaps(show: DirectorShow, prevKeys: string[], nextKeys: string[]): DirectorShow {
  return {
    ...show,
    sceneAssetOverrides: remapIndexMap(show.sceneAssetOverrides, prevKeys, nextKeys),
    sceneAssetSuggestions: remapIndexMap(show.sceneAssetSuggestions, prevKeys, nextKeys),
  };
}
