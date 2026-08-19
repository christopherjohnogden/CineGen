export interface Beat {
  id: string;
  n: number;
  action: string;
  location: string;
  shot: string;
  mood?: string;
}
export interface BeatSheet { beats: Beat[] }

export function emptyBeatSheet(): BeatSheet {
  return { beats: [] };
}

export function renumberBeats(beats: Beat[]): Beat[] {
  return beats.map((b, i) => ({ ...b, n: i + 1 }));
}

function beatIsEmpty(b: Beat): boolean {
  return !b.action.trim() && !b.location.trim() && !b.shot.trim() && !(b.mood ?? '').trim();
}

export function serializeBeatSheet(bs: BeatSheet): string {
  const blocks: string[] = [];
  for (const b of bs.beats) {
    if (beatIsEmpty(b)) continue;
    const meta = (b.mood ?? '').trim();
    const head = `BEAT ${b.n} — ${b.location.trim()}${meta ? ` (${meta})` : ''}`;
    const lines = [head];
    if (b.action.trim()) lines.push(`Action: ${b.action.trim()}`);
    if (b.shot.trim()) lines.push(`Shot: ${b.shot.trim()}`);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}
