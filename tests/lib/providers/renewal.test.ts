import { describe, expect, it } from 'vitest';
import {
  TOPVIEW_RENEWAL_DAY,
  daysUntilRenewal,
  nextRenewalDate,
  renewalCountdown,
  renewalSummary,
} from '@/lib/providers/renewal';

/** Local midday, so the maths never rides on a timezone edge. */
function at(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe('renewal countdown', () => {
  it('counts to the 27th of the current month', () => {
    expect(daysUntilRenewal(at(2026, 9, 2))).toBe(25);
    expect(daysUntilRenewal(at(2026, 9, 26))).toBe(1);
  });

  it('treats the billing day itself as a reset, not a month away', () => {
    expect(daysUntilRenewal(at(2026, 9, 27))).toBe(0);
    expect(renewalCountdown(at(2026, 9, 27))).toBe('Today');
  });

  it('rolls into the next month once the day has passed', () => {
    // September has 30 days: the 28th is 29 days from October's 27th.
    expect(daysUntilRenewal(at(2026, 9, 28))).toBe(29);
    expect(nextRenewalDate(at(2026, 9, 28)).getMonth()).toBe(9);
  });

  it('rolls the year over from December', () => {
    const next = nextRenewalDate(at(2026, 12, 30));
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(27);
  });

  it('handles a short month', () => {
    // 2028 is a leap year: 28 Feb to 27 Mar is 28 days.
    expect(daysUntilRenewal(at(2028, 2, 28))).toBe(28);
    expect(daysUntilRenewal(at(2027, 2, 28))).toBe(27);
  });

  it('reads naturally on the near days', () => {
    expect(renewalCountdown(at(2026, 9, 26))).toBe('Tomorrow');
    expect(renewalCountdown(at(2026, 9, 2))).toBe('25 days');
  });

  it('spells the billing day and the next date out for Settings', () => {
    expect(renewalSummary(at(2026, 9, 2))).toContain('on the 27th of each month');
    expect(renewalSummary(at(2026, 9, 2))).toContain('(in 25 days)');
    expect(renewalSummary(at(2026, 9, 27))).toContain('(today)');
    expect(renewalSummary(at(2026, 9, 26))).toContain('(tomorrow)');
  });

  it('is the 27th', () => {
    expect(TOPVIEW_RENEWAL_DAY).toBe(27);
  });
});
