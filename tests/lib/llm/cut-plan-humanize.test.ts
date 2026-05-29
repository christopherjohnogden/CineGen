import { describe, expect, it } from 'vitest';
import { buildTimelineFromCutProposal, type CutProposal } from '@/lib/llm/cut-plan';
import { DEFAULT_HUMANIZE } from '@/lib/llm/cut-humanize';
import type { Asset } from '@/types/project';
import type { SilenceInterval } from '@/lib/llm/acoustic-analysis';

function asset(id: string, duration: number, silenceMap: SilenceInterval[] = []): Asset {
  return {
    id, name: id, type: 'video', duration,
    metadata: silenceMap.length ? { analysis: { status: 'ready', segments: [], silenceMap } } : {},
  } as unknown as Asset;
}

const proposal: CutProposal = {
  type: 'cut_proposal',
  summary: 's',
  timeline_name: 'Cut',
  should_create_timeline: true,
  segments: [
    { asset_id: 'a1', source_start: 0, source_end: 2.8 },
    { asset_id: 'a1', source_start: 20, source_end: 25 },
  ],
};

describe('buildTimelineFromCutProposal — humanize opt-in', () => {
  it('produces identical clips when no humanize option is passed (no regression)', () => {
    const assets = [asset('a1', 60, [{ start: 3.0, end: 3.5 }])];
    const baseline = buildTimelineFromCutProposal({ proposal, assets, existingTimelines: [] });
    expect(baseline).not.toBeNull();
    // Snapshot the boundary-defining fields.
    const shape = baseline!.timeline.clips.map((c) => ({
      assetId: c.assetId, startTime: c.startTime, trimStart: c.trimStart, trimEnd: c.trimEnd, duration: c.duration,
    }));
    expect(shape).toMatchInlineSnapshot(`
      [
        {
          "assetId": "a1",
          "duration": 60,
          "startTime": 0,
          "trimEnd": 57.2,
          "trimStart": 0,
        },
        {
          "assetId": "a1",
          "duration": 60,
          "startTime": 0,
          "trimEnd": 57.2,
          "trimStart": 0,
        },
        {
          "assetId": "a1",
          "duration": 60,
          "startTime": 2.8,
          "trimEnd": 35,
          "trimStart": 20,
        },
        {
          "assetId": "a1",
          "duration": 60,
          "startTime": 2.8,
          "trimEnd": 35,
          "trimStart": 20,
        },
      ]
    `);
  });

  it('snaps boundaries when humanize is passed with a silence-bearing asset', () => {
    const assets = [asset('a1', 60, [{ start: 3.0, end: 3.5 }])];
    const humanized = buildTimelineFromCutProposal({ proposal, assets, existingTimelines: [], humanize: DEFAULT_HUMANIZE });
    expect(humanized).not.toBeNull();
    // The first segment's out-point (2.8) should have snapped toward the silence at 3.0.
    const firstVideo = humanized!.timeline.clips.find((c) => c.trimStart === 0)!;
    const outPoint = firstVideo.duration - firstVideo.trimEnd;
    expect(outPoint).toBeGreaterThan(2.8);
  });
});
