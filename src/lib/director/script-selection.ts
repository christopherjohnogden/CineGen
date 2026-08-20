/** Highlighted script range attached to the Script Assistant as context. */
export interface ScriptQuote {
  text: string;
  elementIds: string[];
}

export function formatScriptQuote(parts: { id: string; text: string }[]): ScriptQuote | null {
  const cleaned = parts
    .map((part) => ({ id: part.id, text: part.text.replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n') }))
    .filter((part) => part.text.length > 0);
  if (cleaned.length === 0) return null;
  const text = cleaned.map((part) => part.text).join('\n').trim();
  if (!text) return null;
  const elementIds = [...new Set(cleaned.map((part) => part.id))];
  return { text, elementIds };
}

export function quotePreview(text: string, max = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

export function quoteFromIds(
  elements: { id: string; text: string }[],
  ids: Iterable<string>,
): ScriptQuote | null {
  const want = new Set(ids);
  return formatScriptQuote(elements.filter((el) => want.has(el.id)).map((el) => ({ id: el.id, text: el.text })));
}

/** Inclusive span of elements between two ids, in document order. */
export function quoteFromElementRange(
  elements: { id: string; text: string }[],
  fromId: string,
  toId: string,
): ScriptQuote | null {
  const start = elements.findIndex((el) => el.id === fromId);
  const end = elements.findIndex((el) => el.id === toId);
  if (start < 0 || end < 0) return null;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return formatScriptQuote(elements.slice(lo, hi + 1).map((el) => ({ id: el.id, text: el.text })));
}

export function resolveScriptQuote(opts: {
  elements: { id: string; text: string }[];
  fromId?: string;
  toId?: string;
  native: ScriptQuote | null;
  additive?: boolean;
  existingIds?: string[];
  extendFromId?: string;
}): ScriptQuote | null {
  const existing = opts.existingIds ?? [];
  if (opts.additive && opts.toId) {
    const ids = new Set(existing);
    if (ids.has(opts.toId)) ids.delete(opts.toId);
    else ids.add(opts.toId);
    return quoteFromIds(opts.elements, ids);
  }
  if (opts.extendFromId && opts.toId) {
    return quoteFromElementRange(opts.elements, opts.extendFromId, opts.toId);
  }
  // Separate contenteditables don't form one native range — use the drag span.
  if (opts.fromId && opts.toId && opts.fromId !== opts.toId) {
    return quoteFromElementRange(opts.elements, opts.fromId, opts.toId);
  }
  return opts.native;
}

function selectedTextInElement(range: Range, el: HTMLElement): string {
  if (!range.intersectsNode(el)) return '';
  const clipped = document.createRange();
  clipped.selectNodeContents(el);
  if (el.contains(range.startContainer) || el === range.startContainer) {
    clipped.setStart(range.startContainer, range.startOffset);
  }
  if (el.contains(range.endContainer) || el === range.endContainer) {
    clipped.setEnd(range.endContainer, range.endOffset);
  }
  return clipped.toString();
}

/** Read the current window selection if it covers one or more `.dse-el` blocks. */
export function readScriptQuote(root: HTMLElement | null): ScriptQuote | null {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer) && !range.intersectsNode(root)) return null;
  const parts: { id: string; text: string }[] = [];
  for (const node of root.querySelectorAll<HTMLElement>('.dse-el[data-el-id]')) {
    const id = node.getAttribute('data-el-id');
    if (!id || !range.intersectsNode(node)) continue;
    const text = selectedTextInElement(range, node);
    if (text) parts.push({ id, text });
  }
  return formatScriptQuote(parts);
}
