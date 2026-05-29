import { describe, expect, it } from 'vitest';
import { ACOUSTIC_ANALYSIS_VERSION, emptyAcousticAnalysis } from '@/lib/llm/acoustic-analysis';

describe('acoustic-analysis types', () => {
  it('exposes a version and an empty/missing analysis factory', () => {
    const empty = emptyAcousticAnalysis('asset-1');
    expect(empty.status).toBe('missing');
    expect(empty.assetId).toBe('asset-1');
    expect(empty.silenceMap).toEqual([]);
    expect(empty.segments).toEqual([]);
    expect(typeof ACOUSTIC_ANALYSIS_VERSION).toBe('number');
  });
});
