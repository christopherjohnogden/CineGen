import type { DirectorShow } from '@/types/director';
import { createEmptyDirectorShow, isDirectorShow } from './create-show';
import { lookBibleFrom } from './look-bible';
import { parseDirectorLlmProvider } from './cli-provider';
import { directorLlmSpendFrom } from '@/lib/llm/openai-usage';

export function normalizeDirectorShow(value: DirectorShow): DirectorShow {
  const empty = createEmptyDirectorShow();
  return {
    ...empty,
    ...value,
    lookBible: lookBibleFrom(value.lookBible),
    stylePrefix: typeof value.stylePrefix === 'string' ? value.stylePrefix : '',
    genre: typeof value.genre === 'string' && value.genre.trim() ? value.genre : 'auto',
    llmProvider: parseDirectorLlmProvider(value.llmProvider),
    llmSpend: directorLlmSpendFrom(value.llmSpend),
    sourceFileName: typeof value.sourceFileName === 'string' ? value.sourceFileName : undefined,
    jobStatus: null,
  };
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
