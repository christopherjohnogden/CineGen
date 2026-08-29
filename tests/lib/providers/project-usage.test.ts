import { describe, expect, it } from 'vitest';
import {
  normalizeProjectProviderUsage,
  observeProviderBalance,
} from '@/lib/providers/project-usage';

describe('project provider usage', () => {
  it('starts tracking from the first real provider balance without inventing prior spend', () => {
    const usage = observeProviderBalance({}, {
      provider: 'topview',
      connected: true,
      credits: 100,
      observedAt: '2026-08-28T10:00:00.000Z',
    });

    expect(usage.topview).toMatchObject({
      connected: true,
      creditsRemaining: 100,
      creditsUsed: 0,
      lastObservedCredits: 100,
    });
  });

  it('adds actual credit deductions to the project total', () => {
    const started = observeProviderBalance({}, { provider: 'higgsfield', connected: true, credits: 69.53 });
    const afterFirstJob = observeProviderBalance(started, { provider: 'higgsfield', connected: true, credits: 64.03 });
    const afterSecondJob = observeProviderBalance(afterFirstJob, { provider: 'higgsfield', connected: true, credits: 60 });

    expect(afterSecondJob.higgsfield?.creditsRemaining).toBe(60);
    expect(afterSecondJob.higgsfield?.creditsUsed).toBeCloseTo(9.53, 5);
  });

  it('does not treat a credit top-up as negative project use', () => {
    const usage = normalizeProjectProviderUsage({
      topview: { connected: true, creditsRemaining: 20, lastObservedCredits: 20, creditsUsed: 7 },
    });
    const toppedUp = observeProviderBalance(usage, { provider: 'topview', connected: true, credits: 120 });
    const afterJob = observeProviderBalance(toppedUp, { provider: 'topview', connected: true, credits: 115 });

    expect(afterJob.topview?.creditsUsed).toBe(12);
  });

  it('preserves honest no-balance states for providers that do not report credits', () => {
    const usage = observeProviderBalance({}, { provider: 'artlist', connected: true });
    expect(usage.artlist).toEqual(expect.objectContaining({ connected: true, creditsUsed: 0 }));
    expect(usage.artlist?.creditsRemaining).toBeUndefined();
  });
});
