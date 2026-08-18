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
import { validateClipTimings } from './prompt-compiler';
import { STAGING_COLORS, STAGING_LETTERS } from './staging-map';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseBeat(raw: unknown, index: number): DirectorBeat | null {
  const row = asRecord(raw);
  if (!row) return null;
  const text = typeof row.text === 'string' ? row.text : typeof row.action === 'string' ? row.action : '';
  if (!text.trim()) return null;
  const dur = typeof row.dur === 'number' ? row.dur
    : typeof row.duration === 'number' ? row.duration
      : 0;
  return {
    n: typeof row.n === 'number' ? row.n : index + 1,
    from: typeof row.from === 'string' ? row.from : '0:00',
    to: typeof row.to === 'string' ? row.to : '0:00',
    dur,
    text: text.trim(),
    cam: typeof row.cam === 'string' ? row.cam : undefined,
    framing: typeof row.framing === 'string' ? row.framing : undefined,
    gist: typeof row.gist === 'string' ? row.gist : undefined,
    quote: typeof row.quote === 'string' ? row.quote : undefined,
    speaker: typeof row.speaker === 'string' && row.speaker.trim()
      ? (row.speaker.trim().startsWith('@') ? row.speaker.trim() : `@${row.speaker.trim()}`)
      : undefined,
  };
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
}

export function parseShotlistPayload(raw: unknown, fallbackSceneId?: string): ParsedShotlist {
  const record = asRecord(raw);
  if (!record) return { scenes: [], clips: [], errors: ['Shotlist JSON was empty.'] };

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
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!id || !title) return [];
    const beats = (Array.isArray(row.beats) ? row.beats : []).flatMap((beat, index) => {
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
    const timingError = validateClipTimings(clip);
    if (timingError) errors.push(`${clip.id}: ${timingError}`);
    return [clip];
  });

  for (const scene of scenes) {
    scene.clipIds = clips.filter((clip) => clip.sceneId === scene.id).map((clip) => clip.id);
  }

  return {
    stylePrefix: typeof record.stylePrefix === 'string' ? record.stylePrefix : undefined,
    scenes,
    clips,
    errors,
  };
}

export function mergeShotlist(
  existingScenes: DirectorScene[],
  existingClips: DirectorClip[],
  incoming: ParsedShotlist,
): { scenes: DirectorScene[]; clips: DirectorClip[] } {
  const scenes = [...existingScenes];
  for (const scene of incoming.scenes) {
    const index = scenes.findIndex((entry) => entry.number === scene.number || entry.id === scene.id);
    if (index >= 0) scenes[index] = { ...scenes[index], ...scene, id: scenes[index].id, clipIds: scenes[index].clipIds };
    else scenes.push(scene);
  }

  const clips = [...existingClips];
  for (const clip of incoming.clips) {
    const index = clips.findIndex((entry) => entry.id === clip.id);
    if (index >= 0) {
      clips[index] = {
        ...clip,
        sceneId: clips[index].sceneId,
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

  for (const scene of scenes) {
    scene.clipIds = clips.filter((clip) => clip.sceneId === scene.id).map((clip) => clip.id);
  }

  return { scenes, clips };
}

export function shotDensityHint(clipLengthSec: number): string {
  if (clipLengthSec <= 10) return '1–2 shots (5–10s each)';
  if (clipLengthSec <= 15) return '2 shots (6–9s each)';
  if (clipLengthSec <= 20) return '2–3 shots (5–8s each). Never four shots in 20 seconds.';
  return '3–4 shots or one held single (6–10s each)';
}
