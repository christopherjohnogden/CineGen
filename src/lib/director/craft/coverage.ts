import type {
  CameraMoveId, CoverageKind, DirectorBeat, DirectorCameraMove, DirectorScene,
  DirectorShow, DirectorShotGrammar, ShotSize,
} from '@/types/director';
import { updateDirectorClip } from '../director-state';

export const SHOT_SIZES: Array<{ id: ShotSize; label: string; lens: string }> = [
  { id: 'ews', label: 'EWS', lens: 'extreme wide' },
  { id: 'ws', label: 'WS', lens: 'wide' },
  { id: 'ms', label: 'MS', lens: 'medium' },
  { id: 'mcu', label: 'MCU', lens: 'medium close-up' },
  { id: 'cu', label: 'CU', lens: 'close-up' },
  { id: 'ecu', label: 'ECU', lens: 'extreme close-up' },
];

export const SHOT_BODIES = [
  { id: 'one', label: 'One', lens: 'single' },
  { id: 'two', label: 'Two-shot', lens: 'two-shot' },
  { id: 'group', label: 'Group', lens: 'group' },
  { id: 'ots', label: 'OTS', lens: 'over-the-shoulder' },
  { id: 'insert', label: 'Insert', lens: 'insert' },
] as const;

export const SHOT_CLEAN = [
  { id: 'clean', label: 'Clean', lens: 'clean' },
  { id: 'dirty', label: 'Dirty', lens: 'dirty' },
] as const;

export const SHOT_ANGLES = [
  { id: 'eye', label: 'Eye', lens: 'eye-level' },
  { id: 'high', label: 'High', lens: 'high angle' },
  { id: 'low', label: 'Low', lens: 'low angle' },
  { id: 'dutch', label: 'Dutch', lens: 'dutch angle' },
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

export const COVERAGE_KINDS: Array<{ id: CoverageKind; label: string; grammar: DirectorShotGrammar }> = [
  { id: 'master', label: 'Master', grammar: { size: 'ws', bodies: 'two', clean: 'clean' } },
  { id: 'singles', label: 'Singles', grammar: { size: 'cu', bodies: 'one', clean: 'clean' } },
  { id: 'ots', label: 'OTS pair', grammar: { size: 'mcu', bodies: 'ots', clean: 'dirty' } },
  { id: 'two-shot', label: 'Two-shot', grammar: { size: 'ms', bodies: 'two', clean: 'clean' } },
  { id: 'insert', label: 'Insert', grammar: { size: 'ecu', bodies: 'insert', clean: 'clean' } },
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

export function applyMatchSizeToScene(
  show: DirectorShow,
  sceneId: string,
  source: { clipId: string; beatN: number },
): DirectorShow {
  const sourceClip = show.clips.find((clip) => clip.id === source.clipId);
  const sourceBeat = sourceClip?.beats.find((beat) => beat.n === source.beatN);
  const size = sourceBeat?.grammar?.size;
  if (!sourceClip || !sourceBeat || !size) return show;
  const grammar = { ...sourceBeat.grammar };
  const fov = sourceBeat.fov ?? sourceClip.fov;
  let next = show;
  for (const clip of show.clips) {
    if (clip.sceneId !== sceneId || clip.altOf) continue;
    const beats = clip.beats.map((beat) => {
      if (!beatLooksLikeSize(beat, size) && !(beat.grammar?.size === size)) return beat;
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
