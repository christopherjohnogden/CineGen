import { describe, expect, it } from 'vitest';
import type { ModelDefinition } from '@/types/workflow';
import { TOPVIEW_INHERITED_VIDEO_DURATION } from '@/lib/topview/video-duration';
import { topviewVideoCreditEstimate } from '@/lib/topview/video-pricing';

function videoModel(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: 'topview/video/Seedance 2.5',
    nodeType: 'topview-video-seedance-2-5',
    name: 'Seedance 2.5',
    category: 'video',
    description: 'Topview video model',
    outputType: 'video',
    provider: 'topview',
    responseMapping: { path: 'url' },
    inputs: [],
    ...overrides,
  };
}

/**
 * Every price Topview's own generate button quoted, at 16:9 and one generation:
 * the struck-through list figure and the discounted one beside it.
 */
const QUOTED = [
  { resolution: '480', seconds: 4, list: 2.8, billed: 2.24 },
  { resolution: '480', seconds: 8, list: 5.6, billed: 4.48 },
  { resolution: '480', seconds: 10, list: 7, billed: 5.6 },
  { resolution: '480', seconds: 15, list: 10.5, billed: 8.4 },
  { resolution: '480', seconds: 20, list: 14, billed: 11.2 },
  { resolution: '480', seconds: 30, list: 21, billed: 16.8 },
  { resolution: '720', seconds: 4, list: 6, billed: 4.8 },
  { resolution: '720', seconds: 8, list: 12, billed: 9.6 },
  { resolution: '720', seconds: 10, list: 15, billed: 12 },
  { resolution: '720', seconds: 15, list: 22.5, billed: 18 },
  { resolution: '720', seconds: 20, list: 30, billed: 24 },
  { resolution: '720', seconds: 30, list: 45, billed: 36 },
  { resolution: '1080', seconds: 4, list: 14.8, billed: 8.8 },
  { resolution: '1080', seconds: 8, list: 29.6, billed: 17.6 },
  { resolution: '1080', seconds: 10, list: 37, billed: 22 },
  { resolution: '1080', seconds: 15, list: 55.5, billed: 33 },
  { resolution: '1080', seconds: 20, list: 74, billed: 44 },
  { resolution: '1080', seconds: 30, list: 111, billed: 66 },
];

describe('Topview video pricing', () => {
  it.each(QUOTED)('quotes $resolution p at $seconds s as $list, billed $billed', ({ resolution, seconds, list, billed }) => {
    const estimate = topviewVideoCreditEstimate({
      model: videoModel(),
      resolution,
      duration: seconds,
      count: 1,
    });
    expect(estimate).toMatchObject({ listCredits: list, totalCredits: billed });
  });

  it('bills every version in a batch', () => {
    const estimate = topviewVideoCreditEstimate({
      model: videoModel(),
      resolution: '720',
      duration: 10,
      count: 4,
    });
    expect(estimate).toMatchObject({ unitCredits: 12, totalCredits: 48, listCredits: 60, count: 4 });
  });

  it('reads the height however the catalog spells it', () => {
    for (const resolution of ['480', '480p', '480P', 480]) {
      expect(topviewVideoCreditEstimate({
        model: videoModel(), resolution, duration: '10', count: 1,
      })?.totalCredits).toBe(5.6);
    }
  });

  it('prices the house tiers at the same rate as Seedance', () => {
    for (const name of ['Standard', 'Fast']) {
      expect(topviewVideoCreditEstimate({
        model: videoModel({ name }), resolution: '720', duration: 8, count: 1,
      })?.totalCredits).toBe(9.6);
    }
  });

  it('discounts each height by its own amount, not one shared multiplier', () => {
    const off = (resolution: string) => {
      const estimate = topviewVideoCreditEstimate({
        model: videoModel(), resolution, duration: 10, count: 1,
      });
      return Number((1 - estimate!.totalCredits / estimate!.listCredits).toFixed(3));
    };
    expect(off('480')).toBe(0.2);
    expect(off('720')).toBe(0.2);
    expect(off('1080')).toBe(0.405);
  });

  it('shows nothing rather than a guess for what has not been priced', () => {
    // 4K is not on the rate card.
    expect(topviewVideoCreditEstimate({
      model: videoModel(), resolution: '2160', duration: 10, count: 1,
    })).toBeNull();
    // Nor is any model the button was never read on.
    expect(topviewVideoCreditEstimate({
      model: videoModel({ name: 'Veo 3.1' }), resolution: '720', duration: 10, count: 1,
    })).toBeNull();
    // A video edit takes its length from the attached clip, so the seconds are unknown.
    expect(topviewVideoCreditEstimate({
      model: videoModel(), resolution: '720', duration: TOPVIEW_INHERITED_VIDEO_DURATION, count: 1,
    })).toBeNull();
    // And a model with no duration or resolution chosen yet.
    expect(topviewVideoCreditEstimate({
      model: videoModel(), resolution: '720', duration: '', count: 1,
    })).toBeNull();
    expect(topviewVideoCreditEstimate({
      model: videoModel(), resolution: undefined, duration: 10, count: 1,
    })).toBeNull();
  });

  it('leaves other providers and image models alone', () => {
    expect(topviewVideoCreditEstimate({
      model: videoModel({ provider: 'fal' }), resolution: '720', duration: 10, count: 1,
    })).toBeNull();
    expect(topviewVideoCreditEstimate({
      model: videoModel({ outputType: 'image' }), resolution: '720', duration: 10, count: 1,
    })).toBeNull();
  });
});
