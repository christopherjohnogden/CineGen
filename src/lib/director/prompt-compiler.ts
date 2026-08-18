import type {
  DirectorActingTask,
  DirectorBeat,
  DirectorBreakdownItem,
  DirectorClip,
  IsolateVariant,
} from '@/types/director';
import { EYE_LIFE_SAFETY } from './craft/acting';
import { isFovAnchor, nearestFovAnchor, opticsBlock } from './craft/optics';
import { stagingConnectorBlock } from './staging-map';
import { variantKey } from './slate';

export function formatShotHeading(beat: DirectorBeat, isLast: boolean): string {
  const ending = isLast ? 'HOLD to the end.' : 'HARD CUT.';
  const quote = beat.quote ? ` "${beat.quote}"` : '';
  return `SHOT ${beat.n} (${beat.from}–${beat.to}) — ${beat.text.trim()}${quote} ${ending}`.replace(/\s+/g, ' ').trim();
}

export interface CompileClipOptions {
  /** Locked voice prompts by character tag, pasted verbatim where they speak. */
  voices?: Record<string, string>;
}

/**
 * Voice is locked identity: it is never adapted per scene, and it is omitted
 * entirely for a character who is present but silent.
 */
export function compileVoiceBlock(clip: Pick<DirectorClip, 'beats'>, voices: Record<string, string> = {}): string {
  const speakers: string[] = [];
  for (const beat of clip.beats) {
    const tag = beat.speaker;
    if (!tag || !beat.quote?.trim() || speakers.includes(tag)) continue;
    if (voices[tag]?.trim()) speakers.push(tag);
  }
  if (speakers.length === 0) return '';
  const lines = speakers.map((tag) => `${tag} — ${voices[tag].trim()}`);
  return `VOICE —\n${lines.join('\n')}`;
}

export function compileClipBody(clip: DirectorClip, options: CompileClipOptions = {}): string {
  const tags = clip.elementTags.length > 0
    ? clip.elementTags.map((tag) => tag.startsWith('@') ? tag : `@${tag}`).join(' + ')
    : 'none';
  const shotCount = clip.beats.length;
  const shotWord = shotCount === 1 ? 'ONE SHOT' : `${numberWord(shotCount)} SHOTS`;
  const actionShots = clip.beats.map((beat, index) => (
    formatShotHeading(beat, index === clip.beats.length - 1)
  )).join('\n');

  const blocks = [
    `ELEMENTS — ${tags}`,
    `FORMAT — ${clip.seconds} SECONDS, ${shotWord} with hard cuts.`,
    `SUBJECT — ${clip.subject.trim()}`,
    `LOCATION — ${clip.location.trim()}`,
  ];
  // Spatial rules land before the camera and the style, and optics before any
  // general aesthetic language — burying them in prose is what lets them drift.
  const staging = compileStagingBlock(clip);
  if (staging) blocks.push(staging);
  if (clip.blocking?.trim()) blocks.push(`BLOCKING — ${clip.blocking.trim()}`);
  const optics = compileOpticsBlock(clip);
  if (optics) blocks.push(optics);
  blocks.push(`ACTION —\n${clip.intent ? `${clip.intent.trim()}\n` : ''}${actionShots}`);
  const acting = compileActingBlock(clip.acting);
  if (acting) blocks.push(acting);
  const voice = compileVoiceBlock(clip, options.voices);
  if (voice) blocks.push(voice);
  if (clip.camera?.trim()) blocks.push(`CAMERA — ${clip.camera.trim()}`);
  if (clip.style.trim()) blocks.push(`STYLE — ${clip.style.trim()}`);
  if (clip.lock?.trim()) blocks.push(clip.lock.trim());
  if (clip.constraints.trim()) blocks.push(clip.constraints.trim().startsWith('CONSTRAINTS')
    ? clip.constraints.trim()
    : `CONSTRAINTS — ${clip.constraints.trim()}`);
  return blocks.join('\n\n');
}

export function compileOpticsBlock(clip: Pick<DirectorClip, 'fov'>): string {
  if (typeof clip.fov !== 'number' || !Number.isFinite(clip.fov)) return '';
  const anchor = isFovAnchor(clip.fov) ? clip.fov : nearestFovAnchor(clip.fov);
  return `OPTICS — ${opticsBlock(anchor)}`;
}

export function compileActingBlock(tasks: DirectorActingTask[] | undefined): string {
  if (!tasks || tasks.length === 0) return '';
  const blocks = tasks.map((task) => {
    const lines = [
      `ACTING TASK — ${task.tag} (fully invested in the tactic; the work happens in the eyes)`,
      `MOTIVE — ${task.motive.trim()}`,
      `GOAL — ${task.goal.trim()}`,
      `OBSTACLE — ${task.obstacle.trim()}`,
      `TACTIC — ${task.tactic.trim()}`,
    ];
    const moments = (task.moments ?? []).map((moment) => moment.trim()).filter(Boolean);
    if (moments.length > 0) {
      lines.push('MOMENT TO MOMENT —');
      lines.push(...moments.map((moment) => `— ${moment}`));
    }
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n\n${EYE_LIFE_SAFETY}`;
}

export function compileStagingBlock(clip: Pick<DirectorClip, 'staging'>): string {
  const map = clip.staging;
  if (!map?.enabled) return '';
  return stagingConnectorBlock(map);
}

export function prependPrefix(prefix: string, body: string, selfPrefixed = false): string {
  if (selfPrefixed || !prefix.trim()) return body;
  return `${prefix.trim()}\n\n${body}`;
}

export function bodyForVariant(
  clip: DirectorClip,
  variant: IsolateVariant,
  isolatedBody: string,
  options: CompileClipOptions = {},
): string {
  const key = variantKey(variant);
  return clip.bodyEdits[key] || (variant.kind === 'full' ? compileClipBody(clip, options) : isolatedBody);
}

/** Locked voices keyed by tag, for the characters that have one. */
export function voicesFromBreakdown(breakdown: DirectorBreakdownItem[]): Record<string, string> {
  const voices: Record<string, string> = {};
  for (const item of breakdown) {
    if (item.kind !== 'character' || !item.voice?.trim()) continue;
    voices[item.tag] = item.voice.trim();
  }
  return voices;
}

export function validateClipTimings(clip: Pick<DirectorClip, 'seconds' | 'beats'>): string | null {
  if (clip.beats.length === 0) return 'Clip has no shots.';
  const total = clip.beats.reduce((sum, beat) => sum + beat.dur, 0);
  if (total !== clip.seconds) {
    return `Shot timings sum to ${total}s but clip length is ${clip.seconds}s.`;
  }
  return null;
}

export function padTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function applyBeatDurations(clip: DirectorClip): DirectorClip {
  let elapsed = 0;
  const beats = clip.beats.map((beat) => {
    const from = padTimecode(elapsed);
    elapsed += beat.dur;
    return { ...beat, from, to: padTimecode(elapsed) };
  });
  return { ...clip, beats, seconds: elapsed };
}

export function retimeClipToSeconds(clip: DirectorClip, seconds: number): DirectorClip {
  if (clip.beats.length === 0) return { ...clip, seconds };
  const current = clip.beats.reduce((sum, beat) => sum + beat.dur, 0) || seconds;
  if (current === seconds) return applyBeatDurations({ ...clip, seconds });
  let allocated = 0;
  const beats = clip.beats.map((beat, index) => {
    if (index === clip.beats.length - 1) {
      return { ...beat, dur: Math.max(1, seconds - allocated) };
    }
    const dur = Math.max(1, Math.round((beat.dur * seconds) / current));
    allocated += dur;
    return { ...beat, dur };
  });
  return applyBeatDurations({ ...clip, beats });
}

function numberWord(n: number): string {
  const words = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
  return words[n] ?? String(n);
}
