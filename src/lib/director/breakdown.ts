import type { Element, ElementType } from '@/types/elements';
import type { BreakdownKind, DirectorBreakdownItem, DirectorScene } from '@/types/director';
import { generateId } from '@/lib/utils/ids';
import { verbLike } from '@/lib/director/local-extract';

export interface ParsedBreakdown {
  items: DirectorBreakdownItem[];
  scenes: DirectorScene[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeTag(name: string, tag?: string): string {
  const raw = (tag || name).trim();
  const cleaned = raw.replace(/^@/, '').replace(/\s+/g, '-');
  return `@${cleaned}`;
}

function kindFrom(value: unknown): BreakdownKind {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'location' || raw === 'prop' || raw === 'vehicle' || raw === 'character') return raw;
  return 'character';
}

export function normalizeElementName(value: string): string {
  return value.trim().replace(/^@/, '').replace(/[-_]+/g, ' ').toLowerCase();
}

export function findMatchingElement(elements: Element[], item: Pick<DirectorBreakdownItem, 'name' | 'tag' | 'kind'>): Element | undefined {
  const names = [normalizeElementName(item.name), normalizeElementName(item.tag)];
  return elements.find((element) => {
    if (element.type !== item.kind) return false;
    const elementName = normalizeElementName(element.name);
    return names.includes(elementName);
  });
}

export function mergeBreakdownItems(
  existing: DirectorBreakdownItem[],
  incoming: DirectorBreakdownItem[],
  elements: Element[],
): DirectorBreakdownItem[] {
  const next = [...existing];
  for (const item of incoming) {
    const matchIndex = next.findIndex((entry) => (
      normalizeElementName(entry.name) === normalizeElementName(item.name)
      || entry.tag === item.tag
    ));
    const element = findMatchingElement(elements, item);
    const linked = { ...item, elementId: item.elementId ?? element?.id };
    if (matchIndex >= 0) {
      const prev = next[matchIndex];
      // Preserve lazily-enriched fields the identify pass does not carry: an
      // undefined/empty incoming actingProfile/voice/enrichedAt must NOT clobber
      // an existing non-empty value (otherwise every re-breakdown wipes enrichment).
      next[matchIndex] = {
        ...prev,
        ...linked,
        id: prev.id,
        // Same rule as the enrichment fields below: an empty/absent incoming
        // value must never wipe content we already have.
        description: linked.description?.trim() ? linked.description : prev.description,
        blurb: linked.blurb?.trim() ? linked.blurb : prev.blurb,
        actingProfile: linked.actingProfile?.trim() ? linked.actingProfile : prev.actingProfile,
        voice: linked.voice?.trim() ? linked.voice : prev.voice,
        enrichedAt: linked.enrichedAt ?? prev.enrichedAt,
      };
    } else {
      next.push(linked);
    }
  }
  return next;
}

const wordsOf = (name: string) => new Set(normalizeElementName(name).split(/\s+/).filter(Boolean));
const isWordSubset = (a: Set<string>, b: Set<string>) => [...a].every((word) => b.has(word));

/**
 * Add only items not already present; existing items are NEVER modified, so
 * LLM-written descriptions, profiles and manual edits always survive. A
 * same-kind name whose words are a subset or superset of an existing item's
 * counts as present ("Horse" vs "Massive Black Horse"). Returns `existing`
 * (same reference) when nothing new was found, so callers can use identity
 * as a no-change guard.
 */
export function addMissingItems(
  existing: DirectorBreakdownItem[],
  incoming: DirectorBreakdownItem[],
  elements: Element[],
): DirectorBreakdownItem[] {
  const next = [...existing];
  let added = false;
  for (const item of incoming) {
    const words = wordsOf(item.name);
    const present = next.some((entry) => {
      if (entry.tag === item.tag) return true;
      if (entry.kind !== item.kind) return false;
      const entryWords = wordsOf(entry.name);
      return isWordSubset(entryWords, words) || isWordSubset(words, entryWords);
    });
    if (present) continue;
    const element = findMatchingElement(elements, item);
    next.push({ ...item, elementId: item.elementId ?? element?.id });
    added = true;
  }
  return added ? next : existing;
}

const invested = (item: DirectorBreakdownItem): boolean =>
  Boolean(item.elementId || item.actingProfile?.trim() || item.voice?.trim() || item.enrichedAt);

/**
 * Reconcile auto (deterministically extracted) items against a fresh extraction:
 * an auto item the current script no longer yields is removed — the breakdown
 * tracks the script live in BOTH directions — unless an element link or
 * enrichment has invested in it. Manual and LLM items are never touched, with
 * one migration exception: an unflagged bare item whose name is a fresh item
 * prefixed by a verb ("Drives Green Sofa" vs fresh "Green Sofa") is an artifact
 * of the old modifier walk and is dropped so the clean item can take its place.
 * Returns `existing` (same reference) when nothing was removed.
 */
export function reconcileAutoItems(
  existing: DirectorBreakdownItem[],
  fresh: DirectorBreakdownItem[],
): DirectorBreakdownItem[] {
  const freshKeys = new Set(fresh.flatMap((f) => [f.tag, `${f.kind}:${normalizeElementName(f.name)}`]));
  const stillExtracted = (item: DirectorBreakdownItem) =>
    freshKeys.has(item.tag) || freshKeys.has(`${item.kind}:${normalizeElementName(item.name)}`);
  const verbArtifact = (item: DirectorBreakdownItem) => {
    if (item.auto || invested(item) || item.description.trim() || item.blurb?.trim()) return false;
    const [first, ...restWords] = normalizeElementName(item.name).split(/\s+/);
    if (!first || restWords.length === 0 || !verbLike(first)) return false;
    return freshKeys.has(`${item.kind}:${restWords.join(' ')}`);
  };
  const next = existing.filter((item) => {
    if (item.auto && !invested(item)) return stillExtracted(item);
    return !verbArtifact(item);
  });
  return next.length === existing.length ? existing : next;
}

export interface MergeScenesOptions {
  /** Incoming scenes are a deterministic full-script parse: their labels
   *  (exact headings), numbers and order are authoritative, but a summary the
   *  LLM/user already wrote is kept over the auto-derived one. */
  authoritative?: boolean;
}

function sameScene(a: DirectorScene, b: DirectorScene): boolean {
  return a.number === b.number && a.label === b.label && a.summary === b.summary
    && a.event === b.event && a.physicalAction === b.physicalAction;
}

/**
 * Merge scenes while PRESERVING existing scene ids — clips reference them, so a
 * re-breakdown must never mint fresh ids for scenes that are still there.
 * Matches by normalized label first (occurrence-aware), then by scene number.
 * Never drops unmatched existing scenes: a scoped run returns only the changed
 * scenes and must not wipe the rest. Returns `existing` (same reference) when
 * nothing changed.
 */
export function mergeScenes(
  existing: DirectorScene[],
  incoming: DirectorScene[],
  opts: MergeScenesOptions = {},
): DirectorScene[] {
  if (incoming.length === 0) return existing;
  const norm = (label: string) => label.trim().toUpperCase();

  const matched = new Set<string>();
  const assignment = new Map<DirectorScene, DirectorScene>();
  // Pass 1 — label matches (occurrence-aware for duplicate headings).
  for (const inc of incoming) {
    const hit = existing.find((sc) => !matched.has(sc.id) && norm(sc.label) === norm(inc.label));
    if (hit) { assignment.set(inc, hit); matched.add(hit.id); }
  }
  // Pass 2 — number fallback, so LLM-era labels ("SCENE 1 — ARRIVAL") still map
  // onto the deterministic heading-labelled scenes and vice versa.
  for (const inc of incoming) {
    if (assignment.has(inc)) continue;
    const hit = existing.find((sc) => !matched.has(sc.id) && sc.number === inc.number);
    if (hit) { assignment.set(inc, hit); matched.add(hit.id); }
  }

  const mergeOne = (inc: DirectorScene, prev: DirectorScene): DirectorScene => {
    const next: DirectorScene = {
      ...prev,
      number: opts.authoritative ? inc.number : prev.number,
      label: opts.authoritative ? inc.label : prev.label,
      summary: opts.authoritative
        ? (prev.summary.trim() ? prev.summary : inc.summary)
        : (inc.summary.trim() ? inc.summary : prev.summary),
      event: inc.event?.trim() ? inc.event : prev.event,
      physicalAction: inc.physicalAction?.trim() ? inc.physicalAction : prev.physicalAction,
    };
    return sameScene(prev, next) ? prev : next;
  };

  let out: DirectorScene[];
  if (opts.authoritative) {
    // Script order wins; existing scenes the script no longer contains are kept
    // at the end (the cascade's prune handles true removals).
    out = incoming.map((inc) => {
      const prev = assignment.get(inc);
      return prev ? mergeOne(inc, prev) : inc;
    });
    for (const sc of existing) if (!matched.has(sc.id)) out.push(sc);
  } else {
    // Possibly-partial LLM result: keep existing order, append genuinely new scenes.
    const mergedById = new Map<string, DirectorScene>();
    for (const [inc, prev] of assignment) mergedById.set(prev.id, mergeOne(inc, prev));
    out = existing.map((sc) => mergedById.get(sc.id) ?? sc);
    for (const inc of incoming) if (!assignment.has(inc)) out.push(inc);
  }

  const unchanged = out.length === existing.length && out.every((sc, i) => sc === existing[i]);
  return unchanged ? existing : out;
}

export function itemsMissingElements(
  items: DirectorBreakdownItem[],
  elements: Element[],
): DirectorBreakdownItem[] {
  return items.filter((item) => !item.elementId && !findMatchingElement(elements, item));
}

export function assignBreakdownElement(
  items: DirectorBreakdownItem[],
  tag: string,
  elementId: string | undefined,
): DirectorBreakdownItem[] {
  return items.map((item) => item.tag === tag ? { ...item, elementId } : item);
}

export function toElementType(kind: BreakdownKind): ElementType {
  return kind;
}

export function parseBreakdownPayload(raw: unknown): ParsedBreakdown {
  const record = asRecord(raw);
  if (!record) return { items: [], scenes: [] };
  const itemsRaw = Array.isArray(record.items) ? record.items : Array.isArray(record.breakdown) ? record.breakdown : [];
  const scenesRaw = Array.isArray(record.scenes) ? record.scenes : [];

  const items: DirectorBreakdownItem[] = itemsRaw.flatMap((entry) => {
    const row = asRecord(entry);
    if (!row || typeof row.name !== 'string' || !row.name.trim()) return [];
    const name = row.name.trim();
    return [{
      id: typeof row.id === 'string' ? row.id : generateId(),
      kind: kindFrom(row.kind ?? row.type),
      name,
      tag: normalizeTag(name, typeof row.tag === 'string' ? row.tag : undefined),
      description: typeof row.description === 'string' ? row.description : '',
      blurb: typeof row.blurb === 'string' ? row.blurb : undefined,
      actingProfile: typeof row.actingProfile === 'string' && row.actingProfile.trim()
        ? row.actingProfile.trim()
        : undefined,
      voice: typeof row.voice === 'string' && row.voice.trim() ? row.voice.trim() : undefined,
    }];
  });

  const scenes: DirectorScene[] = scenesRaw.flatMap((entry, index) => {
    const row = asRecord(entry);
    if (!row) return [];
    const label = typeof row.label === 'string' && row.label.trim()
      ? row.label.trim()
      : typeof row.name === 'string' ? row.name.trim() : `Scene ${index + 1}`;
    if (!label) return [];
    return [{
      id: typeof row.id === 'string' ? row.id : generateId(),
      number: typeof row.number === 'number' ? row.number : index + 1,
      label,
      summary: typeof row.summary === 'string' ? row.summary : '',
      elementIds: [],
      clipIds: [],
      event: typeof row.event === 'string' && row.event.trim() ? row.event.trim() : undefined,
      physicalAction: typeof row.physicalAction === 'string' && row.physicalAction.trim()
        ? row.physicalAction.trim()
        : undefined,
    }];
  });

  return { items, scenes };
}
