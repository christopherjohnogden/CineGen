import type { DirectorLookBible, DirectorShow } from '@/types/director';
import { parseFdx } from '@/lib/director/fdx-parser';
import { serializeScreenplay, trimFdxTrailer } from '@/lib/director/screenplay';

export const SCRIPT_ACCEPT = '.txt,.md,.fountain,.spmd,.fdx,.rtf';

export function emptyLookBible(): DirectorLookBible {
  return { filmRefs: [], moodBoards: [], notes: '', autoNotes: '' };
}

/** Cap so a look-bible rewrite stays cheap (vision tokens). */
export const MAX_LOOK_BIBLE_STILLS = 6;

export function lookBibleImageUrls(show: Pick<DirectorShow, 'lookBible'>): string[] {
  return (show.lookBible?.moodBoards ?? [])
    .map((still) => still.url.trim())
    .filter(Boolean)
    .slice(0, MAX_LOOK_BIBLE_STILLS);
}

export function lookBibleFrom(value: unknown): DirectorLookBible {
  const empty = emptyLookBible();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const record = value as Record<string, unknown>;
  return {
    filmRefs: Array.isArray(record.filmRefs)
      ? record.filmRefs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    moodBoards: Array.isArray(record.moodBoards)
      ? record.moodBoards.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const row = entry as Record<string, unknown>;
        if (typeof row.id !== 'string' || typeof row.url !== 'string') return [];
        return [{
          id: row.id,
          name: typeof row.name === 'string' ? row.name : 'Still',
          url: row.url,
        }];
      })
      : [],
    notes: typeof record.notes === 'string' ? record.notes : '',
    autoNotes: typeof record.autoNotes === 'string' ? record.autoNotes : '',
  };
}

export function addFilmRef(refs: string[], raw: string): string[] {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return refs;
  const key = name.toLowerCase();
  if (refs.some((entry) => entry.toLowerCase() === key)) return refs;
  return [...refs, name];
}

export function extractScriptText(fileName: string, raw: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') {
    throw new Error('PDF is not supported yet. Export the script as .txt, .md, or .fountain.');
  }
  if (ext === 'fdx' || /<FinalDraft\b/i.test(raw)) {
    const parsed = parseFdx(raw);
    if (parsed) return serializeScreenplay(parsed);
    return trimFdxTrailer(stripXml(raw));
  }
  if (ext === 'rtf') return stripRtf(raw);
  return trimFdxTrailer(raw.replace(/^\uFEFF/, '')).trim();
}

export function compiledLookFromRefs(show: Pick<DirectorShow, 'genre' | 'lookBible'>): string {
  const bible = show.lookBible ?? emptyLookBible();
  const blocks: string[] = [];
  if (show.genre && show.genre !== 'auto') {
    blocks.push(`Genre: ${show.genre}. Stay in that register without turning every clip into a genre gag.`);
  }
  if (bible.filmRefs.length > 0) {
    blocks.push(
      `Film references: ${bible.filmRefs.join('; ')}. Match their photographic grammar — grain, contrast, colour temperature, lens compression, camera height, and blocking density. Do not copy plots, faces, or trademarked wardrobe.`,
    );
  }
  if (bible.moodBoards.length > 0) {
    const names = bible.moodBoards.map((still) => still.name.replace(/\.[^.]+$/, '')).join(', ');
    blocks.push(
      `Mood board (${bible.moodBoards.length} still${bible.moodBoards.length === 1 ? '' : 's'}: ${names}). Take palette, lighting quality, texture, and production design. Ignore people, logos, letterbox bars, and any frozen action.`,
    );
  }
  return blocks.join('\n\n');
}

export function lookNotesAreCustom(show: Pick<DirectorShow, 'lookBible'>): boolean {
  const bible = show.lookBible ?? emptyLookBible();
  const notes = bible.notes.trim();
  if (!notes) return false;
  return notes !== (bible.autoNotes ?? '').trim();
}

export function lookNotesAreStale(show: Pick<DirectorShow, 'genre' | 'lookBible'>): boolean {
  if (!lookNotesAreCustom(show)) return false;
  return compiledLookFromRefs(show) !== (show.lookBible?.autoNotes ?? '');
}

export function syncLookNotes(
  show: DirectorShow,
  options?: { force?: boolean },
): DirectorShow {
  const bible = show.lookBible ?? emptyLookBible();
  const compiled = compiledLookFromRefs(show);
  const custom = lookNotesAreCustom(show);
  if (!options?.force && custom) return show;
  return {
    ...show,
    stylePrefix: compiled,
    lookBible: { ...bible, notes: compiled, autoNotes: compiled },
  };
}

export function setLookNotes(show: DirectorShow, notes: string): DirectorShow {
  const bible = show.lookBible ?? emptyLookBible();
  return {
    ...show,
    stylePrefix: notes,
    lookBible: { ...bible, notes },
  };
}

export function applyWrittenLook(show: DirectorShow, notes: string): DirectorShow {
  const bible = show.lookBible ?? emptyLookBible();
  return {
    ...show,
    stylePrefix: notes,
    lookBible: { ...bible, notes, autoNotes: compiledLookFromRefs(show) },
  };
}

/** Prefix used on generate: whatever is in Look notes, else the live refs compile. */
export function compileLookBible(show: Pick<DirectorShow, 'genre' | 'stylePrefix' | 'lookBible'>): string {
  const notes = (show.lookBible?.notes ?? '').trim();
  if (notes) return notes;
  const fromRefs = compiledLookFromRefs(show);
  if (fromRefs) return fromRefs;
  return (show.stylePrefix ?? '').trim();
}

function stripXml(raw: string): string {
  return raw
    .replace(/<Text[^>]*>/gi, '')
    .replace(/<\/Text>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripRtf(raw: string): string {
  return raw
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
