import type { DirectorShow } from '@/types/director';
import { createEmptyDirectorShow, isDirectorShow } from './create-show';
import { lookBibleFrom } from './look-bible';
import { parseDirectorLlmProvider } from './cli-provider';
import { ensureBeatOrigin } from './craft/coverage';
import { ensureClipLlmOrigin } from './llm-origin';
import { adoptClipFramings } from './framing-reserve';
import { directorLlmSpendFrom } from '@/lib/llm/openai-usage';
import { looksLikeFdx, parseFdx } from './fdx-parser';
import { scrubFdxChrome, serializeScreenplay, trimFdxTrailer } from './screenplay';

/** Strip Final Draft file chrome from a saved show so breakdown/shotlist don't ingest it. */
function scrubLoadedScript(show: DirectorShow): Pick<DirectorShow, 'sourceText' | 'sourceElements'> {
  if (show.sourceElements) {
    const cleaned = scrubFdxChrome(show.sourceElements);
    const dirty = cleaned.length !== show.sourceElements.length
      || cleaned.some((el, i) => el.text !== show.sourceElements![i].text);
    if (dirty) {
      return { sourceElements: cleaned, sourceText: serializeScreenplay({ elements: cleaned }) };
    }
    const trimmed = trimFdxTrailer(show.sourceText);
    return { sourceElements: show.sourceElements, sourceText: trimmed };
  }
  if (looksLikeFdx(show.sourceText)) {
    const parsed = parseFdx(show.sourceText);
    if (parsed) return { sourceText: serializeScreenplay(parsed), sourceElements: parsed.elements };
  }
  return { sourceText: trimFdxTrailer(show.sourceText), sourceElements: show.sourceElements };
}

export function normalizeDirectorShow(value: DirectorShow): DirectorShow {
  const empty = createEmptyDirectorShow();
  const script = scrubLoadedScript(value);
  const normalized: DirectorShow = {
    ...empty,
    ...value,
    ...script,
    lookBible: lookBibleFrom(value.lookBible),
    stylePrefix: typeof value.stylePrefix === 'string' ? value.stylePrefix : '',
    genre: typeof value.genre === 'string' && value.genre.trim() ? value.genre : 'auto',
    llmProvider: parseDirectorLlmProvider(value.llmProvider),
    llmSpend: directorLlmSpendFrom(value.llmSpend),
    sourceFileName: typeof value.sourceFileName === 'string' ? value.sourceFileName : undefined,
    jobStatus: null,
    clips: (value.clips ?? []).map((clip) => ensureClipLlmOrigin({
      ...clip,
      beats: clip.beats.map(ensureBeatOrigin),
    })),
    framingReserve: Array.isArray(value.framingReserve) ? value.framingReserve : [],
  };
  return adoptClipFramings(normalized);
}

export function directorFromUnknown(value: unknown): DirectorShow {
  return isDirectorShow(value) ? normalizeDirectorShow(value) : createEmptyDirectorShow();
}

export function directorFromWorkflow(workflow: unknown): DirectorShow {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return createEmptyDirectorShow();
  }
  return directorFromUnknown((workflow as Record<string, unknown>).director);
}

export function directorFromSnapshot(snapshot: unknown): DirectorShow {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return createEmptyDirectorShow();
  }
  const record = snapshot as Record<string, unknown>;
  if (isDirectorShow(record.director)) return normalizeDirectorShow(record.director);
  return directorFromWorkflow(record.workflow);
}
