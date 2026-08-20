import {
  isFdxChromeLine,
  scrubFdxChrome,
  trimFdxTrailer,
  type Screenplay,
  type ScreenplayElement,
  type ScreenplayElementType,
} from '@/lib/director/screenplay';
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

export function looksLikeFdx(raw: string): boolean {
  return /<FinalDraft\b/i.test(raw) && /<Paragraph\b/i.test(raw);
}

function fdxScriptBody(raw: string): string {
  // Title page / headers / element settings also wrap <Content> or <Paragraph> in some exports.
  const scriptOnly = raw
    .replace(/<TitlePage\b[^>]*>[\s\S]*?<\/TitlePage>/gi, '')
    .replace(/<HeaderAndFooter\b[^>]*>[\s\S]*?<\/HeaderAndFooter>/gi, '')
    .replace(/<ElementSettings\b[^>]*>[\s\S]*?<\/ElementSettings>/gi, '');
  const content = scriptOnly.match(/<Content\b[^>]*>([\s\S]*?)<\/Content>/i);
  return content ? content[1] : scriptOnly;
}

export function parseFdx(raw: string): Screenplay | null {
  try {
    // Dual dialogue wraps nested <Paragraph>s; unwrap it so the inner paragraphs parse
    // as sequential character/dialogue (per spec: dual dialogue collapses to sequential).
    // Only the <Content> block is the script — ElementSettings / headers after it are chrome.
    const unwrapped = fdxScriptBody(raw).replace(/<\/?DualDialogue\b[^>]*>/gi, '');
    const paras = unwrapped.match(/<Paragraph\b[^>]*>[\s\S]*?<\/Paragraph>/gi);
    if (!paras || paras.length === 0) return null;
    const elements: ScreenplayElement[] = [];
    for (const p of paras) {
      const typeMatch = p.match(/<Paragraph\b[^>]*\bType\s*=\s*"([^"]*)"/i);
      const rawType = (typeMatch?.[1] ?? '').trim().toLowerCase();
      const type = TYPE_MAP[rawType] ?? 'action';
      const inner = p.replace(/^<Paragraph\b[^>]*>/i, '').replace(/<\/Paragraph>$/i, '');
      const text = trimFdxTrailer(paragraphText(inner));
      if (!text || isFdxChromeLine(text)) continue; // skip empty / file-chrome paragraphs
      elements.push({ id: generateId(), type, text });
    }
    const cleaned = scrubFdxChrome(elements);
    return cleaned.length > 0 ? { elements: cleaned } : null;
  } catch {
    return null;
  }
}
