/**
 * Trimming a video, shared by the canvas Trim node and the Studio reference
 * popover so both agree on what a range means and what a rendered trim is called.
 *
 * A trim is rendered on demand rather than on every handle nudge: re-encoding a
 * long source takes seconds, and scrubbing a range should stay free.
 */

/** Seconds → `HH:MM:SS`, the form the Start/End fields read and write. */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
}

/**
 * Parses `HH:MM:SS`, `MM:SS` or a plain seconds count. Returns null for anything
 * it cannot read, so a half-typed field never silently becomes 0 and moves the
 * handle out from under the user.
 */
export function parseTimecode(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part.trim())) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
}

export interface TrimRange {
  startSec: number;
  endSec: number;
}

/**
 * Keeps a range inside the source and the right way round. A zero-length or
 * inverted range would render a broken file, so the moved handle gives way.
 */
export function clampRange(range: TrimRange, duration: number, moved: 'start' | 'end' = 'end'): TrimRange {
  const limit = duration > 0 ? duration : Math.max(range.endSec, 0);
  const minLength = Math.min(0.05, limit);
  let start = Math.min(Math.max(0, range.startSec), limit);
  let end = Math.min(Math.max(0, range.endSec), limit);
  if (end - start < minLength) {
    if (moved === 'start') start = Math.max(0, end - minLength);
    else end = Math.min(limit, start + minLength);
  }
  return { startSec: start, endSec: end };
}

/** A range that covers the whole source needs no render. */
export function isWholeSource(range: TrimRange, duration: number): boolean {
  if (duration <= 0) return false;
  return range.startSec <= 0.01 && range.endSec >= duration - 0.01;
}

export function trimmedDuration(range: TrimRange): number {
  return Math.max(0, range.endSec - range.startSec);
}

/**
 * True when the rendered trim no longer matches the range on screen, which is
 * what puts the node into its "pending" state.
 */
export function isTrimStale(
  range: TrimRange,
  rendered: { startSec: number; endSec: number; url: string } | null,
): boolean {
  if (!rendered?.url) return true;
  return Math.abs(rendered.startSec - range.startSec) > 0.01
    || Math.abs(rendered.endSec - range.endSec) > 0.01;
}

/** Where a `local-media://` or plain path url points on disk, for ffmpeg. */
export function localPathFor(url: string): string {
  if (!url) return '';
  if (url.startsWith('local-media://file')) {
    return decodeURIComponent(url.slice('local-media://file'.length));
  }
  if (url.startsWith('file://')) return decodeURIComponent(url.slice('file://'.length));
  if (/^https?:/.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return '';
  return url;
}
