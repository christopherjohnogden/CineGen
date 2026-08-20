import type {
  DirectorActingTask,
  DirectorBeat,
  DirectorClip,
  DirectorScene,
  DirectorStagingFigure,
  DirectorStagingMap,
} from '@/types/director';
import { generateId } from '@/lib/utils/ids';
import { nearestFovAnchor } from './craft/optics';
import { ensureBeatOrigin } from './craft/coverage';
import { padTimecode, retimeClipToSeconds, validateClipTimings } from './prompt-compiler';
import { STAGING_COLORS, STAGING_LETTERS } from './staging-map';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** "m:ss" or a plain number of seconds → seconds; null when unreadable. */
function timecodeSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+):(\d{1,2})$/);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    const plain = Number(value.trim());
    if (Number.isFinite(plain)) return Math.max(0, Math.round(plain));
  }
  return null;
}

function parseBeat(raw: unknown, index: number): DirectorBeat | null {
  const row = asRecord(raw);
  if (!row) return null;
  // Models drift between field names — a dropped beat turns a real clip into
  // "Clip has no shots", so accept the common variants.
  const text = firstString(row.text, row.action, row.description, row.desc, row.content);
  if (!text) return null;
  const fromSec = timecodeSeconds(row.from);
  const toSec = timecodeSeconds(row.to);
  let dur = typeof row.dur === 'number' ? row.dur
    : typeof row.duration === 'number' ? row.duration
      : 0;
  if (!dur && fromSec !== null && toSec !== null && toSec > fromSec) dur = toSec - fromSec;
  const quote = firstString(row.quote, row.dialogue, row.line);
  const speaker = firstString(row.speaker, row.character);
  const beat: DirectorBeat = {
    n: typeof row.n === 'number' ? row.n : index + 1,
    from: fromSec !== null ? padTimecode(fromSec) : '0:00',
    to: toSec !== null ? padTimecode(toSec) : '0:00',
    dur,
    text,
    cam: firstString(row.cam, row.camera) || undefined,
    framing: typeof row.framing === 'string' ? row.framing : undefined,
    gist: typeof row.gist === 'string' ? row.gist : undefined,
    quote: quote || undefined,
    speaker: speaker
      ? (speaker.startsWith('@') ? speaker : `@${speaker}`)
      : undefined,
    ...(typeof row.fov === 'number' && Number.isFinite(row.fov) ? { fov: nearestFovAnchor(row.fov) } : {}),
  };
  return ensureBeatOrigin(beat);
}

/** Replace one beat's camera. Duration, timecode, and dialogue stay. */
export function applyReshotBeat(clip: DirectorClip, beatN: number, incoming: DirectorBeat): DirectorClip {
  if (!clip.beats.some((beat) => beat.n === beatN)) return clip;
  const beats = clip.beats.map((beat) => {
    if (beat.n !== beatN) return beat;
    return ensureBeatOrigin({
      ...beat,
      n: beat.n,
      from: beat.from,
      to: beat.to,
      dur: beat.dur,
      quote: beat.quote,
      speaker: beat.speaker,
      text: incoming.text.trim() || beat.text,
      cam: incoming.cam,
      framing: incoming.framing,
      gist: incoming.gist,
      grammar: undefined,
      fov: incoming.fov ?? beat.fov,
      origin: undefined,
    });
  });
  return { ...clip, beats, bodyEdits: {} };
}

export function parseReshotBeatPayload(raw: unknown, beatN: number): DirectorBeat | null {
  const record = asRecord(raw);
  const parsed = parseBeat(record?.beat ?? record, Math.max(0, beatN - 1));
  return parsed ? { ...parsed, n: beatN } : null;
}

function parseActingTasks(raw: unknown): DirectorActingTask[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tasks = raw.flatMap((entry) => {
    const row = asRecord(entry);
    if (!row) return [];
    const tag = typeof row.tag === 'string' ? row.tag.trim() : '';
    if (!tag) return [];
    const moments = Array.isArray(row.moments)
      ? row.moments.filter((moment): moment is string => typeof moment === 'string' && moment.trim().length > 0)
      : undefined;
    return [{
      tag: tag.startsWith('@') ? tag : `@${tag}`,
      motive: typeof row.motive === 'string' ? row.motive : '',
      goal: typeof row.goal === 'string' ? row.goal : '',
      obstacle: typeof row.obstacle === 'string' ? row.obstacle : '',
      tactic: typeof row.tactic === 'string' ? row.tactic : '',
      moments: moments && moments.length > 0 ? moments : undefined,
    }];
  });
  return tasks.length > 0 ? tasks : undefined;
}

function parseStagingMap(raw: unknown): DirectorStagingMap | undefined {
  const row = asRecord(raw);
  if (!row) return undefined;
  const stagingTag = typeof row.stagingTag === 'string' ? row.stagingTag.trim() : '';
  const locationTag = typeof row.locationTag === 'string' ? row.locationTag.trim() : '';
  if (!stagingTag || !locationTag) return undefined;
  const figures: DirectorStagingFigure[] = (Array.isArray(row.figures) ? row.figures : [])
    .flatMap((entry, index) => {
      const figure = asRecord(entry);
      if (!figure || typeof figure.tag !== 'string' || !figure.tag.trim()) return [];
      return [{
        letter: typeof figure.letter === 'string' && figure.letter.trim()
          ? figure.letter.trim().toUpperCase()
          : STAGING_LETTERS[index] ?? String(index + 1),
        color: typeof figure.color === 'string' && figure.color.trim()
          ? figure.color.trim()
          : STAGING_COLORS[index] ?? 'muted blue',
        tag: figure.tag.trim(),
        position: typeof figure.position === 'string' ? figure.position : '',
        visible: typeof figure.visible === 'string' ? figure.visible : undefined,
      }];
    });
  if (figures.length === 0) return undefined;
  return {
    enabled: row.enabled !== false,
    stagingTag,
    locationTag,
    figures,
    assetId: typeof row.assetId === 'string' ? row.assetId : undefined,
  };
}

export interface ParsedShotlist {
  stylePrefix?: string;
  scenes: DirectorScene[];
  clips: DirectorClip[];
  errors: string[];
  /** Clip entries in the raw payload, before validation — when this is larger
   *  than clips.length, the model answered but entries were unusable. */
  rawClipCount: number;
  /** The model's own report: did the last returned clip reach the scene's final
   *  line? undefined when the response omitted the field. */
  coveredToEnd?: boolean;
}

export function parseShotlistPayload(raw: unknown, fallbackSceneId?: string): ParsedShotlist {
  const record = asRecord(raw);
  if (!record) return { scenes: [], clips: [], errors: ['Shotlist JSON was empty.'], rawClipCount: 0 };

  const errors: string[] = [];
  const scenesRaw = Array.isArray(record.scenes) ? record.scenes : [];
  const clipsRaw = Array.isArray(record.clips) ? record.clips : [];

  const scenes: DirectorScene[] = scenesRaw.flatMap((entry, index) => {
    const row = asRecord(entry);
    if (!row) return [];
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) return [];
    return [{
      id: typeof row.id === 'string' ? row.id : generateId(),
      number: typeof row.number === 'number' ? row.number : index + 1,
      label,
      summary: typeof row.summary === 'string' ? row.summary : '',
      elementIds: Array.isArray(row.elementIds) ? row.elementIds.filter((id): id is string => typeof id === 'string') : [],
      clipIds: [],
      event: typeof row.event === 'string' && row.event.trim() ? row.event.trim() : undefined,
      physicalAction: typeof row.physicalAction === 'string' && row.physicalAction.trim()
        ? row.physicalAction.trim()
        : undefined,
    }];
  });

  const clips: DirectorClip[] = clipsRaw.flatMap((entry) => {
    const row = asRecord(entry);
    if (!row) return [];
    // Be forgiving about identity: models drift between "id", "label" and
    // "clipId", and a silently dropped clip looks like a hung run to the user.
    const id = [row.id, row.label, row.clipId]
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .find((value) => value.length > 0) || generateId();
    const title = [row.title, row.name, row.gist]
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .find((value) => value.length > 0) || 'Untitled clip';
    const beatsRaw = Array.isArray(row.beats) ? row.beats : Array.isArray(row.shots) ? row.shots : [];
    const beats = beatsRaw.flatMap((beat, index) => {
      const parsed = parseBeat(beat, index);
      return parsed ? [parsed] : [];
    });
    const seconds = typeof row.seconds === 'number' ? row.seconds : beats.reduce((sum, beat) => sum + beat.dur, 0);
    const sceneId = typeof row.sceneId === 'string'
      ? row.sceneId
      : scenes.find((scene) => scene.label === row.scene)?.id
        ?? fallbackSceneId
        ?? scenes[0]?.id
        ?? generateId();
    const tags = Array.isArray(row.elementTags)
      ? row.elementTags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    const clip: DirectorClip = {
      id,
      title,
      seconds,
      sceneId,
      beats,
      subject: typeof row.subject === 'string' ? row.subject : '',
      location: typeof row.location === 'string' ? row.location : '',
      intent: typeof row.intent === 'string' ? row.intent : undefined,
      camera: typeof row.camera === 'string' ? row.camera : undefined,
      style: typeof row.style === 'string' ? row.style : '',
      constraints: typeof row.constraints === 'string' ? row.constraints : '',
      lock: typeof row.lock === 'string' ? row.lock : undefined,
      blocking: typeof row.blocking === 'string' && row.blocking.trim() ? row.blocking.trim() : undefined,
      fov: typeof row.fov === 'number' && Number.isFinite(row.fov) ? nearestFovAnchor(row.fov) : undefined,
      acting: parseActingTasks(row.acting),
      staging: parseStagingMap(row.staging),
      elementTags: tags,
      altOf: typeof row.altOf === 'string' ? row.altOf : undefined,
      framingRefTag: typeof row.framingRefTag === 'string' ? row.framingRefTag : undefined,
      activeVariant: { kind: 'full' },
      bodyEdits: {},
      takes: [],
    };
    // Self-heal mistimed clips instead of reporting them: shots that don't sum
    // to the clip length are proportionally retimed. Only a clip with no
    // usable shots at all is worth an error.
    if (clip.beats.length > 0) {
      const timingError = validateClipTimings(clip);
      if (timingError) return [retimeClipToSeconds(clip, clip.seconds > 0 ? clip.seconds : clip.beats.reduce((sum, beat) => sum + beat.dur, 0))];
    } else {
      errors.push(`${clip.id}: ${validateClipTimings(clip) ?? 'Clip has no shots.'}`);
    }
    return [clip];
  });

  for (const scene of scenes) {
    scene.clipIds = clips.filter((clip) => clip.sceneId === scene.id).map((clip) => clip.id);
  }

  const coveredRaw = record.coveredToEnd;
  return {
    stylePrefix: typeof record.stylePrefix === 'string' ? record.stylePrefix : undefined,
    scenes,
    clips,
    errors,
    rawClipCount: clipsRaw.length,
    coveredToEnd: coveredRaw === true || coveredRaw === 'true'
      ? true
      : coveredRaw === false || coveredRaw === 'false' ? false : undefined,
  };
}

export function mergeShotlist(
  existingScenes: DirectorScene[],
  existingClips: DirectorClip[],
  incoming: ParsedShotlist,
): { scenes: DirectorScene[]; clips: DirectorClip[] } {
  const scenes = [...existingScenes];
  // The LLM invents its own scene ids ("scene-1"), while merged scenes keep the
  // ids the breakdown assigned. Every incoming clip's sceneId must be remapped
  // through this table, or freshly written clips arrive pointing at scenes that
  // do not exist and become invisible orphans.
  const sceneIdMap = new Map<string, string>();
  for (const scene of incoming.scenes) {
    const label = scene.label.trim().toUpperCase();
    const index = scenes.findIndex((entry) => entry.id === scene.id
      || entry.label.trim().toUpperCase() === label
      || entry.number === scene.number);
    if (index >= 0) {
      sceneIdMap.set(scene.id, scenes[index].id);
      scenes[index] = { ...scenes[index], ...scene, id: scenes[index].id, clipIds: scenes[index].clipIds };
    } else {
      scenes.push(scene);
      sceneIdMap.set(scene.id, scene.id);
    }
  }
  const resolveSceneId = (clip: DirectorClip): string => {
    const mapped = sceneIdMap.get(clip.sceneId);
    if (mapped) return mapped;
    if (scenes.some((scene) => scene.id === clip.sceneId)) return clip.sceneId;
    // Last resort: clip ids carry the scene number as their prefix ("2-1a").
    const prefix = Number.parseInt(clip.id, 10);
    const byNumber = Number.isFinite(prefix) ? scenes.find((scene) => scene.number === prefix) : undefined;
    return byNumber?.id ?? clip.sceneId;
  };

  const clips = [...existingClips];
  const clipIdRemap = new Map<string, string>();
  for (const raw of incoming.clips) {
    // Clip ids are meant to be "2-1a" (scene NUMBER + letter), but a model that
    // was told to copy sceneIds verbatim sometimes bakes the scene's uuid into
    // the clip id too. Normalize BEFORE duplicate matching, or a re-run of the
    // same scene inserts a second copy of every clip.
    const sceneId = resolveSceneId(raw);
    const scene = scenes.find((entry) => entry.id === sceneId);
    let id = raw.id;
    if (scene) {
      for (const prefix of new Set([raw.sceneId, sceneId])) {
        if (prefix && id.startsWith(`${prefix}-`)) {
          id = `${scene.number}-${id.slice(prefix.length + 1)}`;
          break;
        }
      }
    }
    if (id !== raw.id) clipIdRemap.set(raw.id, id);
    const clip: DirectorClip = { ...raw, id, sceneId };
    const index = clips.findIndex((entry) => entry.id === clip.id);
    if (index >= 0) {
      clips[index] = {
        ...clip,
        sceneId: clips[index].sceneId,
        // (existing clips keep their scene; only their content is refreshed)
        takes: clips[index].takes,
        bodyEdits: clips[index].bodyEdits,
        queued: clips[index].queued,
        activeVariant: clips[index].activeVariant,
        framingRefOn: clips[index].framingRefOn,
        framingRefTag: clips[index].framingRefTag ?? clip.framingRefTag,
        // A staging map is hand-tuned and points at a generated asset, so a
        // re-shotlist must never replace one that already exists.
        staging: clips[index].staging ?? clip.staging,
      };
    } else {
      clips.push(clip);
    }
  }

  // Alternates point at their main clip by id — follow any id normalization.
  if (clipIdRemap.size > 0) {
    for (let i = 0; i < clips.length; i += 1) {
      const alt = clips[i].altOf;
      if (alt && clipIdRemap.has(alt)) clips[i] = { ...clips[i], altOf: clipIdRemap.get(alt) };
    }
  }

  for (const scene of scenes) {
    scene.clipIds = clips.filter((clip) => clip.sceneId === scene.id).map((clip) => clip.id);
  }

  return { scenes, clips };
}

/** Slate letters: no O — it reads as a zero next to the scene number. */
const SLATE_LETTERS = 'ABCDEFGHIJKLMNPQRSTUVWXYZ';

function letterFor(index: number): string {
  // Bijective numbering over the 25-letter slate alphabet: …Y, Z, AA, AB … AZ, BA…
  let n = index;
  let out = '';
  do {
    out = SLATE_LETTERS[n % SLATE_LETTERS.length] + out;
    n = Math.floor(n / SLATE_LETTERS.length) - 1;
  } while (n >= 0);
  return out;
}

/** Display labels per clip — "1A", "1B" (scene number + position letter), the
 *  way a paper shotlist numbers its setups. Derived from position, never from
 *  the stored clip id, so an ugly LLM-invented id can't leak into the UI.
 *  Alternates carry their main clip's label plus an ALT marker. */
export function clipDisplayLabels(scenes: DirectorScene[], clips: DirectorClip[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const scene of scenes) {
    let index = 0;
    for (const clip of clips) {
      if (clip.sceneId !== scene.id || clip.altOf) continue;
      labels.set(clip.id, `${scene.number}${letterFor(index)}`);
      index += 1;
    }
    for (const clip of clips) {
      if (clip.sceneId !== scene.id || !clip.altOf) continue;
      const main = labels.get(clip.altOf);
      labels.set(clip.id, main ? `${main} ALT` : `${scene.number}·ALT`);
    }
  }
  return labels;
}

export function shotDensityHint(clipLengthSec: number): string {
  if (clipLengthSec <= 10) return '1–2 shots (5–10s each)';
  if (clipLengthSec <= 15) return '2 shots (6–9s each)';
  if (clipLengthSec <= 20) return '2–3 shots (5–8s each). Never four shots in 20 seconds.';
  return '3–4 shots or one held single (6–10s each)';
}
