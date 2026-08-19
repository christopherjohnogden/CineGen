import type { Element, ElementType } from '@/types/elements';
import type { BreakdownKind, DirectorBreakdownItem, DirectorScene } from '@/types/director';
import { generateId } from '@/lib/utils/ids';

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
      next[matchIndex] = { ...next[matchIndex], ...linked, id: next[matchIndex].id };
    } else {
      next.push(linked);
    }
  }
  return next;
}

export function itemsMissingElements(
  items: DirectorBreakdownItem[],
  elements: Element[],
): DirectorBreakdownItem[] {
  return items.filter((item) => !item.elementId && !findMatchingElement(elements, item));
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
