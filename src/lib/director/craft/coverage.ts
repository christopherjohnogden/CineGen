import type {
  CameraMoveId, CoverageKind, DirectorBeat, DirectorCameraMove, DirectorScene,
  DirectorShow, DirectorShotGrammar, ShotSize,
} from '@/types/director';
import { updateDirectorClip } from '../director-state';

export const SHOT_SIZES: Array<{ id: ShotSize; label: string; lens: string; hint: string }> = [
  { id: 'ews', label: 'EWS', lens: 'extreme wide', hint: 'Extreme wide — the location first; people are small in the geography' },
  { id: 'ws', label: 'WS', lens: 'wide', hint: 'Wide shot — full bodies and the room they stand in' },
  { id: 'ms', label: 'MS', lens: 'medium', hint: 'Medium — waist-up; face and gesture both read' },
  { id: 'mcu', label: 'MCU', lens: 'medium close-up', hint: 'Medium close-up — chest-up; shoulders and face' },
  { id: 'cu', label: 'CU', lens: 'close-up', hint: 'Close-up — the face fills the frame' },
  { id: 'ecu', label: 'ECU', lens: 'extreme close-up', hint: 'Extreme close-up — an eye, a mouth, a hand, a detail' },
];

export const SHOT_BODIES = [
  { id: 'one', label: 'One', lens: 'single', hint: 'Single — one person owns the frame' },
  { id: 'two', label: 'Two-shot', lens: 'two-shot', hint: 'Two-shot — two people, both readable' },
  { id: 'group', label: 'Group', lens: 'group', hint: 'Group — three or more in frame' },
  { id: 'ots', label: 'OTS', lens: 'over-the-shoulder', hint: 'Over-the-shoulder — we look past one person to the other' },
  { id: 'insert', label: 'Insert', lens: 'insert', hint: 'Insert — a prop, hand, or detail; not a face' },
] as const;

export const SHOT_CLEAN = [
  { id: 'clean', label: 'Clean', lens: 'clean', hint: 'Clean — no other body in the foreground' },
  { id: 'dirty', label: 'Dirty', lens: 'dirty', hint: 'Dirty — a foreground shoulder, head, or object eats the edge' },
] as const;

export const SHOT_ANGLES = [
  { id: 'eye', label: 'Eye', lens: 'eye-level', hint: 'Eye-level — camera at the subject\'s eyeline' },
  { id: 'high', label: 'High', lens: 'high angle', hint: 'High angle — looking down on them' },
  { id: 'low', label: 'Low', lens: 'low angle', hint: 'Low angle — looking up at them' },
  { id: 'dutch', label: 'Dutch', lens: 'dutch angle', hint: 'Dutch — horizon tilted; unease' },
] as const;

export const CAMERA_MOVES: Array<{ id: CameraMoveId; label: string; verb: string }> = [
  { id: 'locked', label: 'Locked', verb: 'camera locked off — a move is a failed take' },
  { id: 'push-in', label: 'Dolly in', verb: 'dolly in toward the subject' },
  { id: 'pull-out', label: 'Dolly out', verb: 'dolly out, revealing more of the space' },
  { id: 'track-left', label: 'Track L', verb: 'lateral track left, height and distance held' },
  { id: 'track-right', label: 'Track R', verb: 'lateral track right, height and distance held' },
  { id: 'crane-up', label: 'Crane up', verb: 'crane up through the space' },
  { id: 'crane-down', label: 'Crane down', verb: 'crane down onto the subject' },
  { id: 'pan-left', label: 'Pan L', verb: 'slow pan left from a fixed position' },
  { id: 'pan-right', label: 'Pan R', verb: 'slow pan right from a fixed position' },
  { id: 'tilt-up', label: 'Tilt up', verb: 'slow tilt up from a fixed position' },
  { id: 'tilt-down', label: 'Tilt down', verb: 'slow tilt down from a fixed position' },
];

export const COVERAGE_KINDS: Array<{ id: CoverageKind; label: string; hint: string; grammar: DirectorShotGrammar }> = [
  { id: 'master', label: 'Master', hint: 'Master — a wide that holds the whole scene geography', grammar: { size: 'ws', bodies: 'two', clean: 'clean' } },
  { id: 'singles', label: 'Singles', hint: 'Singles — clean close-up of one speaker at a time', grammar: { size: 'cu', bodies: 'one', clean: 'clean' } },
  { id: 'ots', label: 'OTS pair', hint: 'OTS pair — matching over-the-shoulders both ways', grammar: { size: 'mcu', bodies: 'ots', clean: 'dirty' } },
  { id: 'two-shot', label: 'Two-shot', hint: 'Two-shot — both people readable in one frame', grammar: { size: 'ms', bodies: 'two', clean: 'clean' } },
  { id: 'insert', label: 'Insert', hint: 'Insert — a detail cutaway (hands, prop, object)', grammar: { size: 'ecu', bodies: 'insert', clean: 'clean' } },
];

export interface ResolvedCameraMove {
  move: CameraMoveId;
  intensity: number;
  line: string;
  locked: boolean;
}

export function emptyCameraMove(): DirectorCameraMove {
  return { move: 'locked', intensity: 0 };
}

export function intensityAdverb(intensity: number): string {
  if (intensity <= 0) return '';
  if (intensity <= 25) return 'barely perceptible';
  if (intensity <= 50) return 'slow, almost still';
  if (intensity <= 75) return 'measured';
  return 'committed';
}

export function filmicMoveFor(intensity: number, size?: ShotSize): CameraMoveId {
  if (intensity <= 0) return 'locked';
  const tight = size === 'cu' || size === 'ecu' || size === 'mcu';
  if (intensity <= 50) return tight ? 'push-in' : 'track-left';
  if (intensity <= 75) return tight ? 'push-in' : 'track-right';
  return tight ? 'push-in' : 'crane-up';
}

export function resolveCameraMove(args: {
  beat?: DirectorShotGrammar;
  clip?: DirectorCameraMove;
  scene?: DirectorCameraMove;
}): ResolvedCameraMove {
  const source = args.clip ?? args.scene;
  const intensity = Math.max(0, Math.min(100, source?.intensity ?? 0));
  const beatMove = args.beat?.move && args.beat.move !== 'locked' ? args.beat.move : undefined;
  const planMove = source?.move && source.move !== 'locked' ? source.move : undefined;
  const explicit = beatMove ?? planMove;
  const move = explicit ?? filmicMoveFor(intensity, args.beat?.size);
  const locked = move === 'locked' || (!explicit && intensity <= 0);
  const resolved: CameraMoveId = locked ? 'locked' : move;
  const verb = CAMERA_MOVES.find((entry) => entry.id === resolved)?.verb ?? CAMERA_MOVES[0].verb;
  const adverb = intensityAdverb(intensity);
  const line = locked
    ? verb
    : [adverb, verb].filter(Boolean).join(' ');
  return { move: resolved, intensity, line, locked };
}

export function grammarLensLine(grammar?: DirectorShotGrammar): string {
  if (!grammar) return '';
  const size = SHOT_SIZES.find((entry) => entry.id === grammar.size)?.lens;
  const angle = SHOT_ANGLES.find((entry) => entry.id === grammar.angle)?.lens;
  const clean = SHOT_CLEAN.find((entry) => entry.id === grammar.clean)?.lens;
  const bodies = SHOT_BODIES.find((entry) => entry.id === grammar.bodies)?.lens;
  return [size, clean, bodies, angle].filter(Boolean).join(', ');
}

export function grammarChoiceHint(grammar?: DirectorShotGrammar): string {
  if (!grammar) return '';
  return [
    SHOT_SIZES.find((entry) => entry.id === grammar.size)?.hint,
    SHOT_BODIES.find((entry) => entry.id === grammar.bodies)?.hint,
    SHOT_CLEAN.find((entry) => entry.id === grammar.clean)?.hint,
    SHOT_ANGLES.find((entry) => entry.id === grammar.angle)?.hint,
  ].filter(Boolean).join(' · ');
}

export function captureBeatOrigin(beat: DirectorBeat): NonNullable<DirectorBeat['origin']> {
  return {
    text: beat.text,
    dur: beat.dur,
    cam: beat.cam,
    quote: beat.quote,
    speaker: beat.speaker,
    grammar: beat.grammar ? { ...beat.grammar } : undefined,
  };
}

function beatHasGrammarChips(beat: DirectorBeat): boolean {
  const grammar = beat.grammar;
  return Boolean(grammar?.size || grammar?.bodies || grammar?.clean || grammar?.angle);
}

/** Fill coverage chips from the LLM cam line when the beat has none yet. */
export function ensureBeatOrigin(beat: DirectorBeat): DirectorBeat {
  const inferred = beatHasGrammarChips(beat) ? undefined : inferBeatGrammar(beat);
  const next = inferred ? { ...beat, grammar: inferred } : beat;
  if (!next.origin) return { ...next, origin: captureBeatOrigin(next) };
  if (!next.origin.grammar && next.grammar && inferred) {
    return { ...next, origin: { ...next.origin, grammar: { ...next.grammar } } };
  }
  return next;
}

export function resetBeatToOrigin(beat: DirectorBeat): DirectorBeat {
  const origin = beat.origin ?? captureBeatOrigin(beat);
  return {
    ...beat,
    text: origin.text,
    dur: origin.dur,
    cam: origin.cam,
    quote: origin.quote,
    speaker: origin.speaker,
    grammar: origin.grammar ? { ...origin.grammar } : undefined,
    origin,
  };
}

export function beatIsDirtyFromOrigin(beat: DirectorBeat): boolean {
  const origin = beat.origin;
  if (!origin) return Boolean(beat.grammar);
  return beat.text !== origin.text
    || beat.dur !== origin.dur
    || (beat.cam ?? '') !== (origin.cam ?? '')
    || (beat.quote ?? '') !== (origin.quote ?? '')
    || (beat.speaker ?? '') !== (origin.speaker ?? '')
    || JSON.stringify(beat.grammar ?? null) !== JSON.stringify(origin.grammar ?? null);
}

/** Live coverage heading + action. Origin keeps the unused quote/speaker if chips change. */
export function beatScriptContext(beat: DirectorBeat): string {
  const source = beat.origin ?? beat;
  const who = (beat.speaker ?? source.speaker)?.replace(/^@/, '');
  const framing = grammarHeading(beat.grammar)
    || beat.cam?.trim().replace(/[.]$/, '')
    || source.cam?.trim().replace(/[.]$/, '')
    || '';
  const head = framing
    ? (who && !framing.toLowerCase().includes(who.toLowerCase()) ? `${framing} on ${who}` : framing)
    : (who ? `On ${who}` : `S${beat.n}`);
  const action = beat.text.trim();
  const quote = (beat.quote ?? source.quote)?.trim();
  const body = action ? `${head} — ${action}` : head;
  if (quote && !action.toLowerCase().includes(quote.toLowerCase())) {
    return `${body}. "${quote}"`;
  }
  return body;
}

export function grammarHeading(grammar?: DirectorShotGrammar): string {
  if (!grammar) return '';
  const size = SHOT_SIZES.find((entry) => entry.id === grammar.size)?.label;
  const bodies = SHOT_BODIES.find((entry) => entry.id === grammar.bodies)?.label;
  const clean = SHOT_CLEAN.find((entry) => entry.id === grammar.clean)?.label;
  return [size, clean, bodies].filter(Boolean).join(' ');
}

export function compileBeatLens(args: {
  beat: DirectorBeat;
  optics?: string;
  move: ResolvedCameraMove;
}): string {
  const framing = [grammarLensLine(args.beat.grammar), args.beat.cam?.trim(), args.optics]
    .filter(Boolean)
    .join('. ');
  if (args.move.locked) {
    if (framing) return framing.endsWith('.') ? framing : `${framing}.`;
    return `${args.move.line}.`;
  }
  const head = framing ? `${framing.endsWith('.') ? framing : `${framing}.`} ` : '';
  return `${head}Camera move (this one only): ${args.move.line}. No other move, no zoom, no cut.`;
}

export function isolateMoveLock(secs: number, camText: string, move: ResolvedCameraMove): string {
  if (move.locked) {
    return `LENS: ONE locked setup for the entire ${secs} seconds, held identically from the first frame to the last: ${camText} This is the ONLY camera position. It never changes — no cut, no second angle, no pan, no tilt, no push, no punch-in, no zoom, no dolly, no crane, no drift. If the frame changes, the take has failed.`;
  }
  return `LENS: ONE setup for the entire ${secs} seconds: ${camText} The camera performs only this move: ${move.line}. No cut, no second angle, no other move, no zoom, no punch-in, no rack. Any other camera change is a failed take.`;
}

export function coverageLockLine(kinds?: CoverageKind[]): string {
  if (!kinds || kinds.length === 0) return '';
  const labels = kinds.map((id) => COVERAGE_KINDS.find((entry) => entry.id === id)?.label ?? id);
  return `Coverage for this scene: ${labels.join(' + ')}.`;
}

export function axisLockLine(axis?: string): string {
  const text = axis?.trim();
  if (!text) return '';
  return `Line of action: ${text}. A reverse of this screen direction is a failed take.`;
}

export function beatSizeLabel(beat: DirectorBeat): string {
  if (beat.grammar?.size) {
    return SHOT_SIZES.find((entry) => entry.id === beat.grammar?.size)?.label ?? '';
  }
  const order: ShotSize[] = ['ews', 'ecu', 'mcu', 'cu', 'ms', 'ws'];
  for (const size of order) {
    if (beatLooksLikeSize(beat, size)) {
      return SHOT_SIZES.find((entry) => entry.id === size)?.label ?? '';
    }
  }
  return '';
}

export function beatLooksLikeSize(beat: DirectorBeat, size: ShotSize): boolean {
  if (beat.grammar?.size === size) return true;
  const cam = `${beat.cam ?? ''} ${beat.framing ?? ''} ${beat.text}`.toLowerCase();
  if (size === 'cu') return /close-?up|\bcu\b|\bclose\b|tight/.test(cam) && !/extreme close/.test(cam);
  if (size === 'ecu') return /extreme close|\becu\b|macro/.test(cam);
  if (size === 'mcu') return /medium close|\bmcu\b/.test(cam);
  if (size === 'ms') return /\bmedium\b|\bms\b/.test(cam) && !/close/.test(cam);
  if (size === 'ws') return /\bwide\b|\bws\b/.test(cam) && !/extreme/.test(cam);
  if (size === 'ews') return /extreme wide|\bews\b|establishing/.test(cam);
  return false;
}

function beatCamBlob(beat: DirectorBeat): string {
  return `${beat.cam ?? ''} ${beat.framing ?? ''} ${beat.gist ?? ''}`.toLowerCase();
}

const NEW_SETUP_RE = /hard cut|reverse cut|smash cut|match cut|insert cut|whip cut|\bcut to\b/;

export function beatIsNewSetup(beat: DirectorBeat): boolean {
  return NEW_SETUP_RE.test(beatCamBlob(beat));
}

function sizeFromPortrait(cam: string): ShotSize | undefined {
  if (/close portrait|tight portrait/.test(cam)) return 'cu';
  if (/medium portrait/.test(cam)) return 'ms';
  if (/\bportrait\b/.test(cam)) return 'mcu';
  return undefined;
}

/** Read size / bodies / clean / angle out of the LLM cam line so the chips match the shot. */
export function inferBeatGrammar(beat: DirectorBeat): DirectorShotGrammar | undefined {
  const cam = beatCamBlob(beat);
  const probe: DirectorBeat = { ...beat, grammar: undefined };
  const sized = (['ews', 'ecu', 'mcu', 'cu', 'ms', 'ws'] as const)
    .find((id) => beatLooksLikeSize({ ...probe, cam: beat.cam, framing: beat.framing, text: '' }, id));
  const size = sized ?? sizeFromPortrait(cam);
  let bodies: DirectorShotGrammar['bodies'];
  if (/\binsert\b|cutaway/.test(cam)) bodies = 'insert';
  else if (/over-?the-?shoulder|\bots\b|from behind .{0,80}shoulder|over .{0,40}shoulder|shoulder a (?:fixed |visible )?left foreground|foreground (?:edge|anchor)/.test(cam)) bodies = 'ots';
  else if (/two-?shot|2-?shot|two shot|both men|both women|both people/.test(cam)) bodies = 'two';
  else if (/\bgroup\b|three-?shot|\bcrowd\b/.test(cam)) bodies = 'group';
  else if (/\bsingle\b|one-?shot|\bportrait\b|reverse cut/.test(cam)) bodies = 'one';
  let clean: DirectorShotGrammar['clean'];
  if (bodies === 'ots' || /dirty|foreground|occlud/.test(cam)) clean = 'dirty';
  else if (/\bclean\b/.test(cam)) clean = 'clean';
  let angle: DirectorShotGrammar['angle'];
  if (/\bdutch\b|canted|horizon tilted/.test(cam)) angle = 'dutch';
  else if (/high[- ]angle|looking down|from above/.test(cam)) angle = 'high';
  else if (/low[- ]angle|looking up|from below/.test(cam)) angle = 'low';
  else if (/eye-?level|eye level/.test(cam)) angle = 'eye';
  const grammar: DirectorShotGrammar = { size, bodies, clean, angle };
  return grammar.size || grammar.bodies || grammar.clean || grammar.angle ? grammar : undefined;
}

function compactGrammar(grammar?: DirectorShotGrammar): DirectorShotGrammar {
  if (!grammar) return {};
  return Object.fromEntries(
    Object.entries(grammar).filter(([, value]) => value !== undefined),
  ) as DirectorShotGrammar;
}

function grammarHasChips(grammar?: DirectorShotGrammar): boolean {
  return Boolean(grammar?.size || grammar?.bodies || grammar?.clean || grammar?.angle);
}

/** Fill blank coverage from the previous beat — a cam line with no size is the same setup continuing. */
export function resolveBeatGrammar(
  beat: DirectorBeat,
  previous?: DirectorShotGrammar,
): DirectorShotGrammar | undefined {
  const local = { ...compactGrammar(inferBeatGrammar(beat)), ...compactGrammar(beat.grammar) };
  if (beatDescribesOwnSetup(beat)) {
    return grammarHasChips(local) ? local : undefined;
  }
  const sizeChanged = Boolean(local.size && previous?.size && local.size !== previous.size);
  const resolved: DirectorShotGrammar = {
    size: local.size ?? previous?.size,
    bodies: local.bodies ?? (sizeChanged ? undefined : previous?.bodies),
    clean: local.clean ?? (sizeChanged ? undefined : previous?.clean),
    angle: local.angle ?? previous?.angle,
    move: local.move ?? previous?.move,
  };
  return grammarHasChips(resolved) ? resolved : undefined;
}

export function beatGrammarsForClip(beats: DirectorBeat[]): Array<DirectorShotGrammar | undefined> {
  const resolved: Array<DirectorShotGrammar | undefined> = [];
  for (const beat of beats) {
    resolved.push(resolveBeatGrammar(beat, resolved[resolved.length - 1]));
  }
  return resolved;
}

export function grammarSizeLabel(grammar?: DirectorShotGrammar): string {
  return grammar?.size ? (SHOT_SIZES.find((entry) => entry.id === grammar.size)?.label ?? '') : '';
}

/** Compact coverage tag for a storyboard option — CU, OTS, 2-shot — not the action line. */
export function grammarShotTypeLabel(grammar?: DirectorShotGrammar): string {
  if (!grammar) return '';
  if (grammar.bodies === 'ots') return 'OTS';
  if (grammar.bodies === 'two') return '2-shot';
  if (grammar.bodies === 'insert') return 'Insert';
  if (grammar.bodies === 'group') return 'Group';
  return grammarSizeLabel(grammar);
}

/** Prose coverage for rewriting leftover CU / two-shot language in cam and action. */
export function coveragePhrase(grammar?: DirectorShotGrammar): string {
  if (grammar?.bodies === 'ots') return 'over-the-shoulder';
  if (grammar?.bodies === 'two') return 'two-shot';
  if (grammar?.bodies === 'insert') return 'insert';
  if (grammar?.bodies === 'group') return 'group';
  return SHOT_SIZES.find((entry) => entry.id === grammar?.size)?.lens ?? '';
}

const COVERAGE_TOKEN = /\b(?:extreme\s+close-?ups?|medium\s+close-?ups?|close-?ups?|two-?shots?|2-?shots?|over-the-shoulders?|\bots\b)\b/gi;

export function rewriteCoverageCopy(text: string, grammar?: DirectorShotGrammar): string {
  const phrase = coveragePhrase(grammar);
  if (!phrase || !text.trim()) return text;
  return text.replace(COVERAGE_TOKEN, phrase);
}

export function beatInheritsSize(beat: DirectorBeat): boolean {
  return !beat.grammar?.size && !inferBeatGrammar(beat)?.size;
}

function beatDescribesOwnSetup(beat: DirectorBeat): boolean {
  if (beatIsNewSetup(beat) || beat.grammar?.size || beat.grammar?.bodies) return true;
  const inferred = inferBeatGrammar(beat);
  return Boolean(inferred?.size || inferred?.bodies);
}

export function beatHoldsPreviousSetup(beat: DirectorBeat): boolean {
  return !beatDescribesOwnSetup(beat);
}

export const SETUP_SWATCH_COUNT = 8;

/** Only true holds share a swatch — a restated MS after a cut is a new shot. */
export function beatSetupColors(beats: DirectorBeat[]): Array<number | undefined> {
  const grammars = beatGrammarsForClip(beats);
  const runs: Array<number | undefined> = [];
  let run = -1;
  for (let index = 0; index < beats.length; index += 1) {
    if (!grammars[index]?.size) {
      runs.push(undefined);
      continue;
    }
    if (index === 0 || !beatHoldsPreviousSetup(beats[index])) run += 1;
    runs.push(run);
  }
  const counts = new Map<number, number>();
  for (const id of runs) {
    if (id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const remap = new Map<number, number>();
  for (const id of runs) {
    if (id == null || (counts.get(id) ?? 0) < 2 || remap.has(id)) continue;
    remap.set(id, remap.size);
  }
  return runs.map((id) => (id == null ? undefined : remap.get(id)));
}

export function applyMatchSizeToScene(
  show: DirectorShow,
  sceneId: string,
  source: { clipId: string; beatN: number },
): DirectorShow {
  const sourceClip = show.clips.find((clip) => clip.id === source.clipId);
  const sourceIndex = sourceClip?.beats.findIndex((beat) => beat.n === source.beatN) ?? -1;
  const sourceBeat = sourceIndex >= 0 ? sourceClip?.beats[sourceIndex] : undefined;
  const resolved = sourceClip ? beatGrammarsForClip(sourceClip.beats)[sourceIndex] : undefined;
  const size = resolved?.size;
  if (!sourceClip || !sourceBeat || !size) return show;
  const grammar = { ...sourceBeat.grammar, ...resolved };
  const fov = sourceBeat.fov ?? sourceClip.fov;
  let next = show;
  for (const clip of show.clips) {
    if (clip.sceneId !== sceneId || clip.altOf) continue;
    const resolvedBeats = beatGrammarsForClip(clip.beats);
    const beats = clip.beats.map((beat, index) => {
      if (resolvedBeats[index]?.size !== size && !beatLooksLikeSize(beat, size)) return beat;
      return {
        ...beat,
        grammar: { ...beat.grammar, ...grammar, size },
        fov: fov ?? beat.fov,
      };
    });
    next = updateDirectorClip(next, clip.id, (current) => ({
      ...current,
      beats,
      fov: current.id === source.clipId ? current.fov : (fov ?? current.fov),
    }));
  }
  return next;
}

function stampForBeat(beat: DirectorBeat, kinds: CoverageKind[], index: number, last: boolean): DirectorShotGrammar | undefined {
  if (beat.grammar?.size) return beat.grammar;
  if (index === 0 && kinds.includes('master')) {
    return { ...COVERAGE_KINDS.find((entry) => entry.id === 'master')!.grammar };
  }
  if (last && kinds.includes('insert') && !beat.speaker) {
    return { ...COVERAGE_KINDS.find((entry) => entry.id === 'insert')!.grammar };
  }
  if (beat.speaker && kinds.includes('ots')) {
    return { ...COVERAGE_KINDS.find((entry) => entry.id === 'ots')!.grammar };
  }
  if (beat.speaker && kinds.includes('singles')) {
    return { ...COVERAGE_KINDS.find((entry) => entry.id === 'singles')!.grammar };
  }
  if (kinds.includes('two-shot') && !beat.speaker) {
    return { ...COVERAGE_KINDS.find((entry) => entry.id === 'two-shot')!.grammar };
  }
  return beat.grammar;
}

export function applyCoverageToScene(show: DirectorShow, sceneId: string, kinds: CoverageKind[]): DirectorShow {
  let next: DirectorShow = {
    ...show,
    scenes: show.scenes.map((scene) => scene.id === sceneId ? { ...scene, coverage: kinds } : scene),
  };
  for (const clip of show.clips) {
    if (clip.sceneId !== sceneId || clip.altOf) continue;
    next = updateDirectorClip(next, clip.id, (current) => ({
      ...current,
      beats: current.beats.map((beat, index) => ({
        ...beat,
        grammar: stampForBeat(beat, kinds, index, index === current.beats.length - 1),
      })),
    }));
  }
  return next;
}

export function patchSceneCamera(
  show: DirectorShow,
  sceneId: string,
  patch: Partial<Pick<DirectorScene, 'axis' | 'coverage' | 'cameraMove'>>,
): DirectorShow {
  return {
    ...show,
    scenes: show.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene),
  };
}
