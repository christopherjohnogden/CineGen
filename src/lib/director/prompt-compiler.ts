import type {
  DirectorActingTask,
  DirectorBeat,
  DirectorBreakdownItem,
  DirectorClip,
  DirectorShow,
  IsolateVariant,
} from '@/types/director';
import { EYE_LIFE_SAFETY } from './craft/acting';
import { DIALOGUE_DISCIPLINE } from './craft/blocking';
import { isFovAnchor, nearestFovAnchor, opticsBlock } from './craft/optics';
import { stagingConnectorBlock } from './staging-map';
import { variantKey } from './slate';

/** Oneiric segment heading — `SEGMENT n — label (~from–to)`, not `SHOT n`. */
export function formatShotHeading(beat: DirectorBeat, _isLast = false): string {
  const label = beat.cam?.trim().replace(/[.]$/, '') || `BEAT ${beat.n}`;
  return `SEGMENT ${beat.n} — ${label} (~${beat.from}–${beat.to})`;
}

export interface CompileClipOptions {
  /** Locked voice prompts by character tag, pasted verbatim where they speak. */
  voices?: Record<string, string>;
  /** Breakdown copy for ACTIVE REFERENCES (`@tag: … 100% matches the reference.`). */
  breakdown?: DirectorBreakdownItem[];
  /** Scene event — compiled as SCENE DIRECTION on each ACTING TASK (tig-acting-task). */
  event?: string;
  /** Scene terrain — one line under SCENE CONTEXT (tig-acting-task §1c). */
  physicalAction?: string;
}

export function compileVoiceBlock(
  clip: Pick<DirectorClip, 'beats'>,
  voices: Record<string, string> = {},
  breakdown: DirectorBreakdownItem[] = [],
): string {
  const speakers: string[] = [];
  for (const beat of clip.beats) {
    const tag = beat.speaker;
    if (!tag || !beat.quote?.trim() || speakers.includes(tag)) continue;
    if (voices[tag]?.trim()) speakers.push(tag);
  }
  if (speakers.length === 0) return '';
  const lines = speakers.map((tag) => {
    const label = speakerDisplay(tag, breakdown);
    return `${label}'s voice: ${voices[tag].trim()}`;
  });
  return [
    'AUDIO (voice identity only — see DIALOGUE for words)',
    ...lines,
    'These voice identities are fixed and identical across all shots.',
  ].join('\n');
}

export function elementTagsLine(clip: Pick<DirectorClip, 'elementTags'>): string {
  if (clip.elementTags.length === 0) return 'none';
  return clip.elementTags.map((tag) => tag.startsWith('@') ? tag : `@${tag}`).join(' + ');
}

export function normalizeElementTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/** Oneiric ACTIVE REFERENCES: @tag: anchors. 100% matches the reference. */
export function compileReferenceBlock(
  clip: Pick<DirectorClip, 'elementTags'>,
  breakdown: DirectorBreakdownItem[] = [],
): string {
  const tags = clip.elementTags.map(normalizeElementTag).filter(Boolean);
  if (tags.length === 0) return '';
  const byTag = new Map(breakdown.map((item) => [normalizeElementTag(item.tag), item]));
  return `ACTIVE REFERENCES\n${tags.map((tag) => formatReferenceLine(tag, byTag.get(tag))).join('\n')}`;
}

function formatReferenceLine(tag: string, item?: DirectorBreakdownItem): string {
  if (!item) {
    if (/^@loc[_-]/i.test(tag)) {
      return `${tag}: Controls architecture, materials, clutter, and light only. 100% matches the reference.`;
    }
    return `${tag}. 100% matches the reference.`;
  }
  const desc = item.description.trim();
  const ended = desc && !/[.!?]$/.test(desc) ? `${desc}.` : desc;
  if (item.kind === 'location') {
    const body = ended || 'Controls architecture, materials, clutter, and light only.';
    const lock = /light only/i.test(body)
      ? body
      : `${body} Controls architecture, materials, clutter, and light only.`;
    const matched = /100%\s*matches/i.test(lock) ? lock : `${lock} 100% matches the reference.`;
    return `${tag}: ${matched}`;
  }
  if (item.kind === 'character') {
    if (!ended) return `${tag}. 100% matches the reference.`;
    return /100%\s*matches/i.test(ended) ? `${tag}: ${ended}` : `${tag}: ${ended} 100% matches the reference.`;
  }
  if (!ended) return `${tag}. 100% matches the reference.`;
  return /100%\s*matches/i.test(ended) ? `${tag}: ${ended}` : `${tag}: ${ended} 100% matches the reference.`;
}

/**
 * Oneiric / CINEDANCE V4 as Higgsfield filled it. Omit empty blocks.
 * SCENE CONTEXT → ACTIVE REFERENCES → LOCATION MAP → FORMAT MODE → SEGMENT n
 * → DIALOGUE → AUDIO → STYLE → POSITIVE LOCKS.
 */
export function compileClipBody(clip: DirectorClip, options: CompileClipOptions = {}): string {
  const breakdown = options.breakdown ?? [];
  const blocks = [
    compileSceneContext(clip, options),
    compileReferenceBlock(clip, breakdown),
    compileLocationMap(clip),
    compileFormatMode(clip),
    compileSegments(clip, options),
    compileDialogueBlock(clip, breakdown),
    compileVoiceBlock(clip, options.voices, breakdown),
    compileStyleBlock(clip),
    compilePositiveLocksBlock(clip),
  ];
  return blocks.filter(Boolean).join('\n\n');
}

export function compileOptionsForShow(show: DirectorShow, clip: DirectorClip): CompileClipOptions {
  const scene = show.scenes.find((entry) => entry.id === clip.sceneId);
  return {
    voices: voicesFromBreakdown(show.breakdown),
    breakdown: show.breakdown,
    event: scene?.event,
    physicalAction: scene?.physicalAction,
  };
}

export function compileSceneContext(
  clip: Pick<DirectorClip, 'subject' | 'intent'>,
  extras: Pick<CompileClipOptions, 'physicalAction'> = {},
): string {
  const intent = sceneIntent(clip);
  const lines = [[clip.subject.trim(), intent].filter(Boolean).join(' ')].filter(Boolean);
  if (extras.physicalAction?.trim()) {
    lines.push(`Physical action: ${extras.physicalAction.trim()}`);
  }
  if (lines.length === 0) return '';
  return `SCENE CONTEXT\n${lines.join('\n')}`;
}

export function compileLocationMap(clip: Pick<DirectorClip, 'location' | 'blocking' | 'staging'>): string {
  const parts: string[] = [];
  if (clip.location.trim()) parts.push(clip.location.trim());
  if (clip.blocking?.trim()) parts.push(clip.blocking.trim());
  const staging = compileStagingBlock(clip);
  if (staging) parts.push(staging);
  if (parts.length === 0) return '';
  return `LOCATION MAP (exact positions)\n${parts.join('\n')}`;
}

export function compileFormatMode(
  clip: Pick<DirectorClip, 'seconds' | 'beats' | 'camera'>,
  extras: { text?: string } = {},
): string {
  if (extras.text?.trim()) return `FORMAT MODE\n${extras.text.trim()}`;
  const shotCount = clip.beats.length;
  const dialogue = clip.beats.some((beat) => beat.quote?.trim())
    ? ' Dialogue delivered as spoken audio.'
    : '';
  const camera = clip.camera?.trim();
  const lead = shotCount === 1
    ? `Single continuous take, ${clip.seconds} seconds. Real-time motion. No internal cuts — a cut is a failed take.${dialogue}`
    : `Controlled ${numberWord(shotCount).toLowerCase()}-segment sequence with HARD CUTS. Real-time motion.${dialogue}`;
  return camera ? `FORMAT MODE\n${lead}\n${camera}` : `FORMAT MODE\n${lead}`;
}

export function compileStyleBlock(clip: Pick<DirectorClip, 'style'>): string {
  if (!clip.style.trim()) return '';
  return `STYLE\n${clip.style.trim()}`;
}

export function compileOpticsBlock(clip: Pick<DirectorClip, 'fov'>): string {
  if (typeof clip.fov !== 'number' || !Number.isFinite(clip.fov)) return '';
  const anchor = isFovAnchor(clip.fov) ? clip.fov : nearestFovAnchor(clip.fov);
  return `OPTICS — ${opticsBlock(anchor)}`;
}

export function compileCameraBlock(clip: Pick<DirectorClip, 'camera' | 'beats'>): string {
  if (clip.camera?.trim()) return `CAMERA — ${clip.camera.trim()}`;
  const lines = clip.beats
    .map((beat) => beat.cam?.trim())
    .map((cam, index) => (cam ? `SHOT ${clip.beats[index].n}: ${cam}` : ''))
    .filter(Boolean);
  if (lines.length === 0) return '';
  if (lines.length === 1 && clip.beats.length === 1) return `CAMERA — ${clip.beats[0].cam!.trim()}`;
  return `CAMERA — ${lines.join(' ')}`;
}

export function compilePositiveLocksBlock(
  clip: Pick<DirectorClip, 'constraints' | 'lock'>,
  extras: { lead?: string; rewriteLock?: (lock: string) => string } = {},
): string {
  const bits: string[] = [];
  if (extras.lead?.trim()) bits.push(extras.lead.trim());
  const constraints = clip.constraints.trim().replace(/^CONSTRAINTS\s*—\s*/i, '');
  if (constraints) bits.push(constraints);
  const lock = clip.lock?.trim();
  if (lock) bits.push(extras.rewriteLock ? extras.rewriteLock(lock) : lock);
  if (bits.length === 0) return '';
  return `POSITIVE LOCKS\n${bits.join('\n')}`;
}

export function compileActingBlock(
  tasks: DirectorActingTask[] | undefined,
  extras: Pick<CompileClipOptions, 'event'> = {},
): string {
  if (!tasks || tasks.length === 0) return '';
  return `${tasks.map((task) => formatActionTask(task, extras.event)).join('\n\n')}\n\n${EYE_LIFE_SAFETY}`;
}

export function compileDialogueBlock(
  clip: Pick<DirectorClip, 'beats'>,
  breakdown: DirectorBreakdownItem[] = [],
): string {
  const quoted = clip.beats.filter((beat) => beat.quote?.trim());
  if (quoted.length === 0) return '';
  const discipline = DIALOGUE_DISCIPLINE.replace(/^DIALOGUE — /, '');
  const lines = quoted.map((beat) => {
    const label = speakerDisplay(beat.speaker, breakdown);
    return `${label} ${beat.from}–${beat.to}: "${beat.quote!.trim()}"`;
  });
  return `DIALOGUE (spoken exactly as written, verbatim, word for word)\n${discipline}\n${lines.join('\n')}`;
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

export function sceneIntent(clip: Pick<DirectorClip, 'intent'>): string {
  const raw = clip.intent?.trim() ?? '';
  if (!raw || /^ACTION\s*—\s*$/i.test(raw)) return '';
  return raw.replace(/^ACTION\s*—\s*/i, '').trim();
}

function compileSegments(clip: DirectorClip, options: CompileClipOptions = {}): string {
  const tasks = clip.acting ?? [];
  const used = new Set<string>();
  const optics = compileOpticsBlock(clip).replace(/^OPTICS — /, '');
  const blocks = clip.beats.map((beat, index) => {
    const matched = tasks.filter((task) => actingMatchesBeat(task, beat));
    matched.forEach((task) => used.add(normalizeElementTag(task.tag)));
    const leftover = index === clip.beats.length - 1
      ? tasks.filter((task) => !used.has(normalizeElementTag(task.tag)))
      : [];
    return formatSegmentBlock(
      beat,
      [...matched, ...leftover],
      optics,
      index === clip.beats.length - 1,
      options.event,
    );
  });
  return blocks.join('\n\n');
}

function formatSegmentBlock(
  beat: DirectorBeat,
  tasks: DirectorActingTask[],
  optics: string,
  last: boolean,
  event?: string,
): string {
  const lines = [formatShotHeading(beat, last), beat.text.trim()].filter(Boolean);
  if (tasks.length > 0) {
    lines.push(tasks.map((task) => formatActionTask(task, event)).join('\n'));
    if (last) lines.push(EYE_LIFE_SAFETY);
  }
  const lens = [beat.cam?.trim(), optics].filter(Boolean).join('. ');
  if (lens) lines.push(`LENS: ${lens}`);
  return lines.join('\n');
}

/** tig-acting-task prompt block — scene direction, then motive / goal / obstacle / tactic. */
function formatActionTask(task: DirectorActingTask, event?: string): string {
  const lines = [
    `ACTING TASK — ${task.tag} (fully invested in the tactic; the work happens in the eyes):`,
  ];
  if (event?.trim()) {
    lines.push(`SCENE DIRECTION (shared, unspoken): ${event.trim()}`);
  }
  lines.push(
    `MOTIVE (his fuel): ${task.motive.trim()}`,
    `GOAL: ${task.goal.trim()}`,
    `OBSTACLE: ${task.obstacle.trim()}`,
    `TACTIC: ${task.tactic.trim()}`,
  );
  const moments = (task.moments ?? []).map((moment) => moment.trim()).filter(Boolean);
  if (moments.length > 0) {
    lines.push('Moment to moment:');
    lines.push(...moments.map((moment) => `— ${moment}`));
  }
  return lines.join('\n');
}

function actingMatchesBeat(task: DirectorActingTask, beat: DirectorBeat): boolean {
  const tag = normalizeElementTag(task.tag);
  if (beat.speaker && normalizeElementTag(beat.speaker) === tag) return true;
  return beat.text.includes(task.tag) || beat.text.includes(tag);
}

function speakerDisplay(tag: string | undefined, breakdown: DirectorBreakdownItem[]): string {
  if (!tag) return 'VOICE';
  const item = breakdown.find((entry) => normalizeElementTag(entry.tag) === normalizeElementTag(tag));
  if (item?.name.trim()) return item.name.trim().toUpperCase();
  return tag.replace(/^@/, '');
}

function numberWord(n: number): string {
  const words = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
  return words[n] ?? String(n);
}
