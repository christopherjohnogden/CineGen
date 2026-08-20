import type { DirectorBeat, DirectorBeatTime, DirectorClip, DirectorTake } from '@/types/director';

function timecodeToSeconds(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const match = value.trim().match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const plain = Number(value.trim());
  return Number.isFinite(plain) ? Math.max(0, plain) : undefined;
}

/** Read `SEGMENT n — … (~0:07–0:13)` headings from the prompt that made a take. */
export function parseSegmentTimes(prompt: string): DirectorBeatTime[] {
  const pattern = /SEGMENT\s+(\d+)\s+[^\n]*\(~(\d+:\d{1,2}(?:\.\d+)?)[–—-](\d+:\d{1,2}(?:\.\d+)?)\)/gi;
  const rows: DirectorBeatTime[] = [];
  const seen = new Set<number>();
  for (const match of prompt.matchAll(pattern)) {
    const n = Number(match[1]);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    const from = match[2];
    const to = match[3];
    const fromSec = timecodeToSeconds(from) ?? 0;
    const toSec = timecodeToSeconds(to) ?? fromSec;
    seen.add(n);
    rows.push({ n, from, to, dur: Math.max(0, Math.round(toSec - fromSec)) });
  }
  return rows;
}

export function snapshotTakeBeatTimes(
  clip: Pick<DirectorClip, 'beats'>,
  prompt: string,
): DirectorBeatTime[] {
  const parsed = parseSegmentTimes(prompt);
  if (parsed.length >= 2) return parsed;
  if (parsed.length === 1 && clip.beats.length <= 1) return parsed;
  return clip.beats.map((beat) => ({ n: beat.n, from: beat.from, to: beat.to, dur: beat.dur }));
}

export function takeBeatTimes(
  take?: Pick<DirectorTake, 'beatTimes' | 'promptSnapshot'>,
): DirectorBeatTime[] {
  if (take?.beatTimes && take.beatTimes.length > 0) return take.beatTimes;
  if (take?.promptSnapshot) return parseSegmentTimes(take.promptSnapshot);
  return [];
}

/** Clip whose beat times are this take's video, not the live shotlist. */
export function takeTimelineClip(
  clip: DirectorClip,
  take?: Pick<DirectorTake, 'beatTimes' | 'promptSnapshot'>,
): DirectorClip {
  const times = takeBeatTimes(take);
  if (times.length < 2) return clip;
  const liveByN = new Map(clip.beats.map((beat) => [beat.n, beat]));
  const beats: DirectorBeat[] = times.map((row) => {
    const live = liveByN.get(row.n);
    return live
      ? { ...live, from: row.from, to: row.to, dur: row.dur }
      : { n: row.n, from: row.from, to: row.to, dur: row.dur, text: '' };
  });
  const lastTo = timecodeToSeconds(times[times.length - 1]?.to) ?? 0;
  return { ...clip, beats, seconds: lastTo > 0 ? lastTo : clip.seconds };
}
