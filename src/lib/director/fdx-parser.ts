import type { Screenplay, ScreenplayElement, ScreenplayElementType } from '@/lib/director/screenplay';
import { generateId } from '@/lib/utils/ids';

const TYPE_MAP: Record<string, ScreenplayElementType> = {
  'scene heading': 'scene',
  action: 'action',
  general: 'action',
  shot: 'action',
  character: 'character',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Concatenate the text of all <Text> runs inside one paragraph's inner XML.
function paragraphText(inner: string): string {
  const runs = inner.match(/<Text[^>]*>([\s\S]*?)<\/Text>/gi);
  if (!runs) return '';
  return decodeEntities(
    runs.map((r) => r.replace(/<Text[^>]*>/i, '').replace(/<\/Text>/i, '')).join(''),
  ).trim();
}

export function parseFdx(raw: string): Screenplay | null {
  try {
    // Dual dialogue wraps nested <Paragraph>s; unwrap it so the inner paragraphs parse
    // as sequential character/dialogue (per spec: dual dialogue collapses to sequential).
    const unwrapped = raw.replace(/<\/?DualDialogue\b[^>]*>/gi, '');
    const paras = unwrapped.match(/<Paragraph\b[^>]*>[\s\S]*?<\/Paragraph>/gi);
    if (!paras || paras.length === 0) return null;
    const elements: ScreenplayElement[] = [];
    for (const p of paras) {
      const typeMatch = p.match(/<Paragraph\b[^>]*\bType\s*=\s*"([^"]*)"/i);
      const rawType = (typeMatch?.[1] ?? '').trim().toLowerCase();
      const type = TYPE_MAP[rawType] ?? 'action';
      const inner = p.replace(/^<Paragraph\b[^>]*>/i, '').replace(/<\/Paragraph>$/i, '');
      const text = paragraphText(inner);
      if (!text) continue; // skip empty paragraphs
      elements.push({ id: generateId(), type, text });
    }
    return elements.length > 0 ? { elements } : null;
  } catch {
    return null;
  }
}
