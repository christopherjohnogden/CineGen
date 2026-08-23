import type { DirectorShow } from '@/types/director';
import { DEFAULT_DIRECTOR_ADAPTER_ID } from '@/types/director';
import { emptyLookBible } from './look-bible';

export function createEmptyDirectorShow(): DirectorShow {
  return {
    sourceText: '',
    clipLengthSec: 20,
    stylePrefix: '',
    lookBible: emptyLookBible(),
    aspectRatio: '16:9',
    adapterId: DEFAULT_DIRECTOR_ADAPTER_ID,
    resolution: '720p',
    generateAudio: true,
    genre: 'auto',
    llmProvider: 'claude-code',
    mode: 'source',
    breakdown: [],
    breakdownApproved: false,
    scenes: [],
    clips: [],
    storyboardFrames: [],
    storyboardModelId: 'nano_banana_2',
    framingReserve: [],
    jobStatus: null,
  };
}

export function isDirectorShow(value: unknown): value is DirectorShow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sourceText === 'string'
    && typeof record.clipLengthSec === 'number'
    && Array.isArray(record.breakdown)
    && Array.isArray(record.scenes)
    && Array.isArray(record.clips);
}
