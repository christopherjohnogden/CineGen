// src/lib/llm/cut-humanize.ts
//
// Phase 3 — human-feeling cut output. Pure functions only (timeline-in / timeline-out), so the
// boundary math is fully unit-testable with no Electron/network. Everything here is OPT-IN: the
// cut builder only runs this pass when a humanize option is supplied, so default output is
// unchanged. The Phase 1 objective silence map is the first downstream consumer here.

import type { Asset } from '@/types/project';
import type { SilenceInterval } from '@/lib/llm/acoustic-analysis';
import { extractSilenceMap } from '@/lib/llm/editorial-workflow';

export interface SilenceContext {
  forAsset(assetId: string): SilenceInterval[];
}

export function buildSilenceContext(assets: Asset[]): SilenceContext {
  const byAsset = new Map<string, SilenceInterval[]>();
  for (const asset of assets) {
    const map = extractSilenceMap(asset);
    if (map.length === 0) continue;
    byAsset.set(asset.id, [...map].sort((a, b) => a.start - b.start));
  }
  return {
    forAsset: (assetId: string) => byAsset.get(assetId) ?? [],
  };
}

/**
 * Nearest silence edge to `time` within `tolerance`, or null.
 * - side 'out' (a clip's out-point): snap to a silence START, so the cut ends as quiet begins.
 * - side 'in'  (a clip's in-point):  snap to a silence END, so the cut starts as quiet ends.
 */
export function nearestSilenceEdge(
  silences: SilenceInterval[],
  time: number,
  tolerance: number,
  side: 'in' | 'out',
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of silences) {
    const edge = side === 'out' ? s.start : s.end;
    const dist = Math.abs(edge - time);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = edge;
    }
  }
  return best;
}
