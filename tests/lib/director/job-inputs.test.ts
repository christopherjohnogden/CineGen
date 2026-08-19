import { describe, expect, it } from 'vitest';
import { breakdownJobInput } from '@/lib/director/job-inputs';
import type { DirectorShow, DirectorScene } from '@/types/director';

const show = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: {} as never,
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], ...over,
} as DirectorShow);

const SRC = 'INT. OFFICE - DAY\nDr Jordan enters.\n\nEXT. STREET - NIGHT\nHe walks fast.';
const SCENES: DirectorScene[] = [
  { id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
  { id: 's2', number: 2, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
];

describe('breakdownJobInput', () => {
  it('sends the full script when no scope', () => {
    const body = breakdownJobInput(show({ sourceText: SRC }), 'none');
    expect(body).toMatch(/Dr Jordan enters/);
    expect(body).toMatch(/He walks fast/);
  });
  it('sends only the changed scene text when scoped', () => {
    const body = breakdownJobInput(show({ sourceText: SRC, scenes: SCENES }), 'none', { sceneIds: ['s1'] });
    expect(body).toMatch(/changed scenes only/i);
    expect(body).toMatch(/Dr Jordan enters/);   // scene s1 kept
    expect(body).not.toMatch(/He walks fast/);  // scene s2 omitted
  });
});
