export interface ClickMods {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function isAdditiveClick(mods: ClickMods): boolean {
  return mods.metaKey || mods.ctrlKey;
}

export function applyClickSelection(
  orderedIds: string[],
  selected: Set<string>,
  lastClicked: string | null,
  id: string,
  mods: ClickMods,
): { selected: Set<string>; lastClicked: string | null; shouldOpen: boolean } {
  if (mods.shiftKey && lastClicked) {
    const lastIdx = orderedIds.indexOf(lastClicked);
    const curIdx = orderedIds.indexOf(id);
    if (lastIdx !== -1 && curIdx !== -1) {
      const start = Math.min(lastIdx, curIdx);
      const end = Math.max(lastIdx, curIdx);
      const range = orderedIds.slice(start, end + 1);
      if (isAdditiveClick(mods)) {
        const next = new Set(selected);
        for (const rid of range) next.add(rid);
        return { selected: next, lastClicked, shouldOpen: false };
      }
      return { selected: new Set(range), lastClicked, shouldOpen: false };
    }
  }

  if (isAdditiveClick(mods)) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selected: next, lastClicked: id, shouldOpen: false };
  }

  return { selected: new Set([id]), lastClicked: id, shouldOpen: true };
}

/** Right-clicking an already-selected card keeps the group; otherwise select only that card. */
export function applyContextSelection(selected: Set<string>, id: string): Set<string> {
  if (selected.has(id)) return selected;
  return new Set([id]);
}

export function deleteIdsForContext(selected: Set<string>, contextId: string | null): string[] {
  if (contextId && selected.has(contextId) && selected.size > 0) return [...selected];
  if (contextId) return [contextId];
  return [...selected];
}

export function pruneSelection(selected: Set<string>, validIds: Iterable<string>): Set<string> {
  const valid = new Set(validIds);
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (valid.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

export function marqueeBox(startX: number, startY: number, x: number, y: number): MarqueeBox {
  return {
    left: Math.min(startX, x),
    top: Math.min(startY, y),
    width: Math.abs(x - startX),
    height: Math.abs(y - startY),
  };
}

export function boxToRect(box: MarqueeBox): Rect {
  return {
    left: box.left,
    top: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
  };
}

export function idsIntersectingMarquee(
  items: Array<{ id: string; rect: Rect }>,
  marquee: Rect,
): Set<string> {
  const hits = new Set<string>();
  for (const item of items) {
    if (rectsIntersect(item.rect, marquee)) hits.add(item.id);
  }
  return hits;
}

export function mergeMarqueeHits(preSelected: Set<string>, hits: Set<string>): Set<string> {
  if (preSelected.size === 0) return hits;
  const merged = new Set(preSelected);
  for (const id of hits) merged.add(id);
  return merged;
}

export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  pad = 8,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(pad, x), Math.max(pad, viewportWidth - menuWidth - pad)),
    y: Math.min(Math.max(pad, y), Math.max(pad, viewportHeight - menuHeight - pad)),
  };
}
