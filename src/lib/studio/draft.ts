/**
 * What is sitting in the Studio composer but has not been generated yet.
 *
 * Everything here is cheap to rebuild except the part that matters: the prompt
 * you just wrote and the files you just attached. Losing those to a reload, an
 * app restart, or a hot module replacement in dev is not a cosmetic annoyance —
 * a composer that quietly empties itself sends the *next* generation without the
 * references you thought were attached, and you pay for the render before you
 * find out. So the draft is written to local storage on every change and read
 * back on mount.
 *
 * It is per project and deliberately local: a half-written prompt is not worth a
 * cloud revision, and it should not follow you to another machine.
 */

import { parseStudioVideoMode, type StudioVideoMode } from './video-mode';

export interface ComposerAttachment {
  id: string;
  url: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
}

export interface ComposerDraft {
  prompt: string;
  outputKind: 'image' | 'video';
  videoMode: StudioVideoMode;
  elementIds: string[];
  attachments: ComposerAttachment[];
  startAssetId: string;
  endAssetId: string;
  /** The clip Edit video works on. Kept apart from attachments: it is the subject, not a reference. */
  editAssetId: string;
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  prompt: '',
  outputKind: 'video',
  videoMode: 'references',
  elementIds: [],
  attachments: [],
  startAssetId: '',
  endAssetId: '',
  editAssetId: '',
};

const DRAFT_KEY = 'cinegen_studio_draft';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function attachments(value: unknown): ComposerAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!url) return [];
    const kind = record.kind === 'video' || record.kind === 'audio' ? record.kind : 'image';
    return [{
      id: typeof record.id === 'string' && record.id ? record.id : url,
      url,
      name: typeof record.name === 'string' ? record.name : '',
      kind,
    }];
  });
}

export function readComposerDraft(projectId: string): ComposerDraft {
  const raw = storage()?.getItem(`${DRAFT_KEY}:${projectId}`);
  if (!raw) return EMPTY_COMPOSER_DRAFT;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      outputKind: parsed.outputKind === 'image' ? 'image' : 'video',
      videoMode: parseStudioVideoMode(parsed.videoMode, 'references'),
      elementIds: strings(parsed.elementIds),
      attachments: attachments(parsed.attachments),
      startAssetId: typeof parsed.startAssetId === 'string' ? parsed.startAssetId : '',
      endAssetId: typeof parsed.endAssetId === 'string' ? parsed.endAssetId : '',
      editAssetId: typeof parsed.editAssetId === 'string' ? parsed.editAssetId : '',
    };
  } catch {
    return EMPTY_COMPOSER_DRAFT;
  }
}

export function writeComposerDraft(projectId: string, draft: ComposerDraft): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(`${DRAFT_KEY}:${projectId}`, JSON.stringify(draft));
  } catch {
    // A full quota only costs the draft; never the generation.
  }
}
