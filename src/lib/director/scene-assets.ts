import type { ScriptScene } from '@/lib/director/scene-split';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import { normalizeTag } from '@/lib/director/breakdown';
import { generateId } from '@/lib/utils/ids';

export interface SceneAssetHit { kind: BreakdownKind; name: string; item?: DirectorBreakdownItem }
export interface HighlightRun { text: string; kind?: BreakdownKind }

/**
 * Tag a span of text as a breakdown element of `kind`, returning the updated breakdown list
 * and the resolved name/tag. If an item with the same tag exists, its kind is updated in
 * place (re-tagging); otherwise a new item is appended. The name is whitespace-normalized.
 */
export function applyManualTag(
  breakdown: DirectorBreakdownItem[],
  kind: BreakdownKind,
  rawName: string,
): { breakdown: DirectorBreakdownItem[]; name: string; tag: string } | null {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const tag = normalizeTag(name);
  const existing = breakdown.find((b) => b.tag === tag);
  if (existing) {
    // Tagging by hand takes ownership: clear `auto` so the live script
    // reconciliation never removes an item the user deliberately kept.
    const next = existing.kind === kind && !existing.auto
      ? breakdown
      : breakdown.map((b) => (b.tag === tag ? { ...b, kind, auto: false } : b));
    return { breakdown: next, name, tag };
  }
  const item: DirectorBreakdownItem = { id: generateId(), kind, name, tag, description: '' };
  return { breakdown: [...breakdown, item], name, tag };
}

function sceneText(scene: ScriptScene): string {
  return scene.elements.map((e) => e.text).join('\n');
}
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

interface Span { start: number; end: number; kind: BreakdownKind }

// non-overlapping matches across the text, longest breakdown name first
function findSpans(text: string, breakdown: DirectorBreakdownItem[]): Span[] {
  const terms = [...breakdown].sort((a, b) => b.name.length - a.name.length);
  const spans: Span[] = [];
  for (const item of terms) {
    const re = new RegExp('\\b(' + escapeRe(item.name) + ')\\b', 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index, end = start + m[0].length;
      if (spans.some((sp) => start < sp.end && end > sp.start)) continue;
      spans.push({ start, end, kind: item.kind });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function highlightRuns(text: string, breakdown: DirectorBreakdownItem[]): HighlightRun[] {
  const spans = findSpans(text, breakdown);
  const runs: HighlightRun[] = [];
  let pos = 0;
  for (const sp of spans) {
    if (sp.start > pos) runs.push({ text: text.slice(pos, sp.start) });
    runs.push({ text: text.slice(sp.start, sp.end), kind: sp.kind });
    pos = sp.end;
  }
  if (pos < text.length) runs.push({ text: text.slice(pos) });
  return runs;
}

/** Highlight using the same per-scene set as the assets panel — removed tags stay unmarked. */
export function highlightRunsForScene(
  text: string,
  show: DirectorShow,
  sceneIndex: number,
  scene: ScriptScene,
): HighlightRun[] {
  const items = resolveSceneAssets(show, sceneIndex, show.breakdown, scene).map((row) => row.item);
  return highlightRuns(text, items);
}

export function detectSceneAssets(scene: ScriptScene, breakdown: DirectorBreakdownItem[]): SceneAssetHit[] {
  const text = sceneText(scene);
  const seen = new Set<string>();
  const hits: SceneAssetHit[] = [];
  for (const item of [...breakdown].sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp('\\b' + escapeRe(item.name) + '\\b', 'i');
    if (re.test(text) && !seen.has(item.tag)) {
      seen.add(item.tag);
      hits.push({ kind: item.kind, name: item.name, item });
    }
  }
  return hits;
}

export function resolveSceneAssets(
  show: DirectorShow,
  sceneIndex: number,
  breakdown: DirectorBreakdownItem[],
  scene: ScriptScene,
): Array<{ item: DirectorBreakdownItem; source: 'auto' | 'ai' | 'manual' }> {
  const byTag = new Map(breakdown.map((b) => [b.tag, b]));
  const source = new Map<string, 'auto' | 'ai' | 'manual'>();
  for (const hit of detectSceneAssets(scene, breakdown)) if (hit.item) source.set(hit.item.tag, 'auto');
  for (const tag of show.sceneAssetSuggestions?.[sceneIndex] ?? []) if (!source.has(tag)) source.set(tag, 'ai');
  const ov = show.sceneAssetOverrides?.[sceneIndex];
  if (ov) {
    for (const tag of ov.added) source.set(tag, 'manual');
    for (const tag of ov.removed) source.delete(tag);
  }
  const out: Array<{ item: DirectorBreakdownItem; source: 'auto' | 'ai' | 'manual' }> = [];
  for (const [tag, src] of source) { const item = byTag.get(tag); if (item) out.push({ item, source: src }); }
  return out;
}
