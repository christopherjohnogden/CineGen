import type {
  DirectorClip, DirectorFraming, DirectorFramingLook, DirectorFramingRestore, DirectorShow, DirectorStagingMap, IsolateVariant,
} from '@/types/director';
import { generateId, timestamp } from '@/lib/utils/ids';
import { updateDirectorClip } from './director-state';
import { beatGrammarsForClip, grammarHeading, grammarLensLine, grammarShotTypeLabel, inferBeatGrammar, rewriteCoverageCopy } from './craft/coverage';
import { clipDisplayLabels } from './shotlist';

/** Isolated held/native share a bind — S1 is one framing, not two. */
export function stagingBindKey(variant: IsolateVariant): string {
  return variant.kind === 'full' ? 'full' : String(variant.beatN);
}

function timecodeToSeconds(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const match = value.trim().match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const plain = Number(value.trim());
  return Number.isFinite(plain) ? Math.max(0, plain) : undefined;
}

/** Map a playhead on the Full take onto S1 / S2 / S3… using beat from–to (or stacked durs). */
export function beatAtPlayhead(clip: DirectorClip, timeSec: number): DirectorClip['beats'][number] | undefined {
  if (clip.beats.length === 0) return undefined;
  let cursor = 0;
  const ranges = clip.beats.map((beat, index) => {
    const from = timecodeToSeconds(beat.from) ?? cursor;
    const explicitTo = timecodeToSeconds(beat.to);
    const to = explicitTo ?? from + Math.max(0, beat.dur);
    cursor = to;
    return { beat, from, to, last: index === clip.beats.length - 1 };
  });
  const t = Math.max(0, timeSec);
  const hit = ranges.find((row) => t >= row.from && t < row.to);
  return hit?.beat ?? ranges[ranges.length - 1]?.beat;
}

/** Isolated take → that shot. Full take → the beat under the playhead. */
export function bindKeyForFrameGrab(clip: DirectorClip, args: {
  variant?: IsolateVariant;
  timeSec?: number;
  durationSec?: number;
}): string {
  const variant = args.variant ?? clip.activeVariant;
  if (variant.kind === 'isolated') return String(variant.beatN);
  if (clip.beats.length <= 1) return 'full';
  if (typeof args.timeSec !== 'number' || !Number.isFinite(args.timeSec)) return 'full';
  const clipLen = clip.seconds > 0 ? clip.seconds : clip.beats.reduce((sum, beat) => sum + beat.dur, 0);
  const mediaLen = typeof args.durationSec === 'number' && Number.isFinite(args.durationSec) && args.durationSec > 0
    ? args.durationSec
    : clipLen;
  const t = mediaLen > 0 ? args.timeSec * (clipLen / mediaLen) : args.timeSec;
  const beat = beatAtPlayhead(clip, t);
  return beat ? String(beat.n) : 'full';
}

/** Storyboard cards show the liked take; the diagram still attaches last on Generate. */
export function framingThumb(map: DirectorStagingMap): string {
  return (map.sourceFrameUrl || map.diagramUrl || '').trim();
}

function grammarFromLook(look?: DirectorFramingLook) {
  if (look?.grammar?.size || look?.grammar?.bodies) return look.grammar;
  if (look?.cam) {
    return inferBeatGrammar({ n: 1, from: '', to: '', dur: 0, text: '', cam: look.cam });
  }
  return look?.grammar;
}

/** CU / OTS / 2-shot from the frozen look — never the clip title or action line. */
export function framingShotTypeLabel(framing: DirectorFraming): string {
  return grammarShotTypeLabel(grammarFromLook(framing.look ?? framing.map.sourceLook)) || 'Framing';
}

function shotTokenFromBindKey(key?: string): string | undefined {
  if (!key || key === 'full') return undefined;
  const beat = key.split(':')[0];
  return /^\d+$/.test(beat) ? `S${beat}` : undefined;
}

/** Where the framing was grabbed — `1A · S2 · CU`. */
export function framingPickerLabel(show: DirectorShow, framing: DirectorFraming): string {
  const type = framingShotTypeLabel(framing);
  const clip = framing.sourceClipId
    ? show.clips.find((entry) => entry.id === framing.sourceClipId)
    : undefined;
  const slate = clip ? clipDisplayLabels(show.scenes, show.clips).get(clip.id) : undefined;
  const shot = shotTokenFromBindKey(framing.variantKey ?? framing.map.sourceBindKey);
  return [slate, shot, type].filter(Boolean).join(' · ');
}

function uniquifyLabels(rows: Array<{ id: string; label: string }>): Map<string, string> {
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const row of rows) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const row of rows) {
    if ((counts.get(row.label) ?? 0) < 2) {
      labels.set(row.id, row.label);
      continue;
    }
    const n = (seen.get(row.label) ?? 0) + 1;
    seen.set(row.label, n);
    labels.set(row.id, `${row.label} · ${n}`);
  }
  return labels;
}

/** Number colliding slates so two 1A · S2 · CU cards stay distinguishable. */
export function uniqueFramingPickerLabels(show: DirectorShow, framings: DirectorFraming[]): Map<string, string> {
  return uniquifyLabels(framings.map((entry) => ({ id: entry.id, label: framingPickerLabel(show, entry) })));
}

export function uniqueFramingName(show: DirectorShow, name: string): string {
  const used = new Set((show.framingReserve ?? []).map((entry) => entry.name));
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

export function boundFramingId(clip: DirectorClip, variant: IsolateVariant = clip.activeVariant): string | undefined {
  const key = stagingBindKey(variant);
  return clip.stagingBinds?.[key] ?? clip.staging?.reserveId;
}

/** Per-beat storyboard overlay only — the clip map must not light every card. */
export function beatFramingId(clip: DirectorClip, beatN: number): string | undefined {
  return clip.stagingBinds?.[String(beatN)];
}

export function resolveClipStaging(
  show: DirectorShow,
  clip: DirectorClip,
  variant: IsolateVariant = clip.activeVariant,
): DirectorStagingMap | undefined {
  const id = boundFramingId(clip, variant);
  const card = id ? (show.framingReserve ?? []).find((entry) => entry.id === id) : undefined;
  if (card) return { ...card.map, enabled: true, reserveId: card.id };
  return clip.staging;
}

export function clipWithResolvedStaging(
  show: DirectorShow,
  clip: DirectorClip,
  variant: IsolateVariant = clip.activeVariant,
): DirectorClip {
  const staging = resolveClipStaging(show, clip, variant);
  return staging ? { ...clip, staging } : clip;
}

export function captureFramingLook(
  clip: DirectorClip,
  bindKey = stagingBindKey(clip.activeVariant),
): DirectorFramingLook {
  const grammars = beatGrammarsForClip(clip.beats);
  const index = bindKey === 'full'
    ? 0
    : Math.max(0, clip.beats.findIndex((beat) => String(beat.n) === bindKey));
  const beat = clip.beats[index];
  const grammar = grammars[index];
  return {
    grammar: grammar ? { ...grammar } : undefined,
    cam: beat?.cam,
    fov: beat?.fov ?? clip.fov,
    cameraMove: clip.cameraMove ? { ...clip.cameraMove } : undefined,
  };
}

export function resolveFramingLook(show: DirectorShow, framing: DirectorFraming): DirectorFramingLook | undefined {
  if (framing.look?.grammar || framing.look?.cam) return framing.look;
  const source = framing.sourceClipId
    ? show.clips.find((entry) => entry.id === framing.sourceClipId)
    : undefined;
  return source ? captureFramingLook(source, framing.variantKey ?? 'full') : undefined;
}

function stampLookOnBeat(beat: DirectorClip['beats'][number], look: DirectorFramingLook): DirectorClip['beats'][number] {
  const grammar = look.grammar ? { ...look.grammar } : beat.grammar;
  const cam = look.cam?.trim()
    || grammarHeading(grammar)
    || grammarLensLine(grammar)
    || beat.cam;
  const text = look.grammar ? rewriteCoverageCopy(beat.text, grammar) : beat.text;
  return { ...beat, grammar, cam, text, fov: look.fov ?? beat.fov };
}

function clearLookEdits(clip: DirectorClip, target: 'variant' | 'clip'): DirectorClip['bodyEdits'] {
  const next = { ...clip.bodyEdits };
  if (target === 'clip' || clip.activeVariant.kind === 'full') {
    delete next.full;
    return next;
  }
  const beatN = clip.activeVariant.beatN;
  delete next[`${beatN}:held`];
  delete next[`${beatN}:native`];
  return next;
}

function withLook(clip: DirectorClip, look: DirectorFramingLook | undefined, target: 'variant' | 'clip'): Partial<DirectorClip> {
  if (!look) return {};
  const beatN = clip.activeVariant.kind === 'isolated' ? clip.activeVariant.beatN : undefined;
  const beats = target === 'clip' || beatN == null
    ? clip.beats.map((beat) => stampLookOnBeat(beat, look))
    : clip.beats.map((beat) => beat.n === beatN ? stampLookOnBeat(beat, look) : beat);
  return {
    beats,
    fov: look.fov ?? clip.fov,
    cameraMove: look.cameraMove ?? clip.cameraMove,
    camera: look.cam ?? clip.camera,
    bodyEdits: clearLookEdits(clip, target),
  };
}

/** Maps that already exist on clips become storyboard cards (older shows never saved a reserve). */
export function adoptClipFramings(show: DirectorShow): DirectorShow {
  let next = show;
  let changed = false;
  for (const clip of show.clips) {
    if (clip.altOf) continue;
    const map = clip.staging;
    const url = map?.diagramUrl?.trim();
    if (!map || !url) continue;
    const list = next.framingReserve ?? [];
    const existing = list.find((entry) => entry.id === map.reserveId || entry.map.diagramUrl === url);
    if (existing) {
      const stuck = map.status === 'generating';
      if (map.reserveId === existing.id && !stuck) continue;
      next = updateDirectorClip(next, clip.id, (entry) => ({
        ...entry,
        staging: {
          ...entry.staging!,
          reserveId: existing.id,
          status: stuck ? 'ready' : entry.staging?.status,
        },
        stagingBinds: {
          ...entry.stagingBinds,
          [stagingBindKey(entry.activeVariant)]: existing.id,
        },
      }));
      changed = true;
      continue;
    }
    const saved = upsertFramingReserve(next, {
      name: clip.title.trim() || 'Framing',
      map,
      sourceClipId: clip.id,
      sourceSceneId: clip.sceneId,
      variantKey: stagingBindKey(clip.activeVariant),
      look: captureFramingLook(clip),
    });
    next = updateDirectorClip(saved.show, clip.id, (entry) => ({
      ...entry,
      staging: {
        ...map,
        reserveId: saved.framing.id,
        status: map.status === 'generating' ? 'ready' : map.status,
      },
      stagingBinds: { ...entry.stagingBinds, [stagingBindKey(entry.activeVariant)]: saved.framing.id },
    }));
    changed = true;
  }
  return changed ? next : show;
}

export function upsertFramingReserve(show: DirectorShow, input: {
  name: string;
  map: DirectorStagingMap;
  sourceClipId?: string;
  sourceSceneId?: string;
  variantKey?: string;
  look?: DirectorFramingLook;
}): { show: DirectorShow; framing: DirectorFraming } {
  const list = show.framingReserve ?? [];
  const diagram = input.map.diagramUrl?.trim();
  const existing = diagram
    ? list.find((entry) => entry.map.diagramUrl === diagram)
    : undefined;
  const framing: DirectorFraming = existing
    ? { ...existing, map: { ...input.map, reserveId: existing.id }, look: input.look ?? existing.look }
    : {
      id: generateId(),
      name: uniqueFramingName(show, input.name),
      createdAt: timestamp(),
      sourceClipId: input.sourceClipId,
      sourceSceneId: input.sourceSceneId,
      variantKey: input.variantKey,
      map: input.map,
      look: input.look,
    };
  framing.map = { ...framing.map, reserveId: framing.id };
  const framingReserve = existing
    ? list.map((entry) => entry.id === framing.id ? framing : entry)
    : [...list, framing];
  return { show: { ...show, framingReserve }, framing };
}

export function applyFraming(
  show: DirectorShow,
  clipId: string,
  framingId: string,
  target: 'variant' | 'clip' | 'scene',
): DirectorShow {
  const framing = (show.framingReserve ?? []).find((entry) => entry.id === framingId);
  const clip = show.clips.find((entry) => entry.id === clipId);
  if (!framing || !clip) return show;
  const map: DirectorStagingMap = {
    ...framing.map,
    enabled: true,
    reserveId: framing.id,
    scope: target === 'scene' ? 'scene' : 'clip',
  };
  const look = resolveFramingLook(show, framing);
  if (target === 'scene' && clip.sceneId) {
    const sceneId = clip.sceneId;
    return {
      ...show,
      clips: show.clips.map((entry) => (
        entry.sceneId === sceneId && !entry.altOf
          ? { ...entry, staging: map, stagingBinds: undefined }
          : entry
      )),
    };
  }
  if (target === 'variant') {
    const key = stagingBindKey(clip.activeVariant);
    return updateDirectorClip(show, clipId, (entry) => ({
      ...entry,
      ...withLook(entry, look, 'variant'),
      stagingBinds: { ...entry.stagingBinds, [key]: framing.id },
    }));
  }
  return updateDirectorClip(show, clipId, (entry) => ({
    ...entry,
    ...withLook(entry, look, 'clip'),
    staging: map,
    stagingBinds: { ...entry.stagingBinds, full: framing.id },
  }));
}

function captureBeatRestore(clip: DirectorClip, beatN: number): DirectorFramingRestore | undefined {
  const beat = clip.beats.find((entry) => entry.n === beatN);
  if (!beat) return undefined;
  return {
    grammar: beat.grammar ? { ...beat.grammar } : undefined,
    cam: beat.cam,
    fov: beat.fov,
    text: beat.text,
    held: clip.bodyEdits[`${beatN}:held`],
    native: clip.bodyEdits[`${beatN}:native`],
    full: clip.bodyEdits.full,
  };
}

function withBeatBodyEdits(
  bodyEdits: DirectorClip['bodyEdits'],
  beatN: number,
  snap: Pick<DirectorFramingRestore, 'held' | 'native' | 'full'> | undefined,
): DirectorClip['bodyEdits'] {
  const next = { ...bodyEdits };
  if (!snap || snap.held === undefined) delete next[`${beatN}:held`];
  else next[`${beatN}:held`] = snap.held;
  if (!snap || snap.native === undefined) delete next[`${beatN}:native`];
  else next[`${beatN}:native`] = snap.native;
  if (!snap || snap.full === undefined) delete next.full;
  else next.full = snap.full;
  return next;
}

export function applyFramingToBeat(
  show: DirectorShow,
  clipId: string,
  framingId: string,
  beatN: number,
): DirectorShow {
  const framing = (show.framingReserve ?? []).find((entry) => entry.id === framingId);
  const clip = show.clips.find((entry) => entry.id === clipId);
  if (!framing || !clip) return show;
  const look = resolveFramingLook(show, framing);
  const key = String(beatN);
  return updateDirectorClip(show, clipId, (entry) => {
    const restores = { ...entry.framingRestores };
    if (!restores[key]) {
      const snap = captureBeatRestore(entry, beatN);
      if (snap) restores[key] = snap;
    }
    return {
      ...entry,
      beats: look
        ? entry.beats.map((beat) => beat.n === beatN ? stampLookOnBeat(beat, look) : beat)
        : entry.beats,
      bodyEdits: withBeatBodyEdits(entry.bodyEdits, beatN, undefined),
      stagingBinds: { ...entry.stagingBinds, [key]: framing.id },
      framingRestores: restores,
    };
  });
}

/** Unselect a storyboard card and put that beat’s coverage / body edit back. */
export function revertFramingOnBeat(show: DirectorShow, clipId: string, beatN: number): DirectorShow {
  const key = String(beatN);
  return updateDirectorClip(show, clipId, (entry) => {
    const snap = entry.framingRestores?.[key];
    const stagingBinds = { ...entry.stagingBinds };
    delete stagingBinds[key];
    if (!snap) return { ...entry, stagingBinds };
    const framingRestores = { ...entry.framingRestores };
    delete framingRestores[key];
    return {
      ...entry,
      beats: entry.beats.map((beat) => (
        beat.n === beatN
          ? { ...beat, grammar: snap.grammar, cam: snap.cam, fov: snap.fov, text: snap.text ?? beat.text }
          : beat
      )),
      bodyEdits: withBeatBodyEdits(entry.bodyEdits, beatN, snap),
      stagingBinds,
      framingRestores: Object.keys(framingRestores).length > 0 ? framingRestores : undefined,
    };
  });
}

export function clearFramingBind(
  show: DirectorShow,
  clipId: string,
  _variant: IsolateVariant,
): DirectorShow {
  return updateDirectorClip(show, clipId, (entry) => {
    const staging = entry.staging
      ? {
        ...entry.staging,
        enabled: false,
        sourceFrameUrl: undefined,
        sourceAssetId: undefined,
        sourceLook: undefined,
        sourceBindKey: undefined,
        diagramUrl: undefined,
        reserveId: undefined,
        jobId: undefined,
        error: undefined,
        status: 'idle' as const,
      }
      : entry.staging;
    return { ...entry, stagingBinds: undefined, staging };
  });
}
