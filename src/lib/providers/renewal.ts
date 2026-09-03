/**
 * Topview bills monthly and resets the credit balance on the 27th.
 *
 * Their MCP does not expose it: `topview_get_credit` returns only a balance and
 * a (null) credit expiry, and the usage log records spends alone, so there is
 * nothing to read the date off. It is recorded here until an endpoint offers it.
 */
export const TOPVIEW_RENEWAL_DAY = 27;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The next reset, which is today when today is the billing day. */
export function nextRenewalDate(now: Date = new Date(), day: number = TOPVIEW_RENEWAL_DAY): Date {
  const today = startOfDay(now);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
  // A day past this month's date rolls into the next month, and December rolls
  // the year over on its own.
  return thisMonth >= today ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, day);
}

/** Whole days from today to the next reset; 0 on the day itself. */
export function daysUntilRenewal(now: Date = new Date(), day: number = TOPVIEW_RENEWAL_DAY): number {
  const today = startOfDay(now);
  const next = nextRenewalDate(now, day);
  // Rounded because a daylight-saving change makes a "day" 23 or 25 hours long.
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

/** Short form for a metric tile: `Today`, `Tomorrow`, or `25 days`. */
export function renewalCountdown(now: Date = new Date(), day: number = TOPVIEW_RENEWAL_DAY): string {
  const days = daysUntilRenewal(now, day);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

function ordinal(day: number): string {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';
  return `${day}${day % 10 <= 3 ? suffix : 'th'}`;
}

/** Sentence for Settings, naming the billing day and the next reset. */
export function renewalSummary(now: Date = new Date(), day: number = TOPVIEW_RENEWAL_DAY): string {
  const days = daysUntilRenewal(now, day);
  const date = nextRenewalDate(now, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return `Credits reset on the ${ordinal(day)} of each month — next on ${date} (${when}).`;
}
