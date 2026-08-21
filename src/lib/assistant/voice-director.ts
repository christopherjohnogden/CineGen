import type {
  CameraMoveId,
  CoverageKind,
  DirectorBeat,
  DirectorCameraMove,
  DirectorScene,
  DirectorShotGrammar,
  DirectorShow,
  ShotAngle,
  ShotBodies,
  ShotClean,
  ShotSize,
} from '@/types/director';
import type { WorkspaceState } from '@/types/workspace';
import { applyAssistantEdits, applyBeatEdits, type AssistantEdit, type BeatEdit } from '@/lib/director/script-assistant';
import { parseToScreenplay, serializeScreenplay, type Screenplay, type ScreenplayElement, type ScreenplayElementType } from '@/lib/director/screenplay';
import { serializeBeatSheet } from '@/lib/director/beatsheet';
import { retimeClipToSeconds } from '@/lib/director/prompt-compiler';
import { ensureBeatOrigin } from '@/lib/director/craft/coverage';
import { generateId } from '@/lib/utils/ids';

const COVERAGE = new Set<CoverageKind>(['master', 'singles', 'ots', 'two-shot', 'insert']);
const CAMERA_MOVES = new Set<CameraMoveId>([
  'locked', 'push-in', 'pull-out', 'track-left', 'track-right', 'crane-up', 'crane-down',
  'pan-left', 'pan-right', 'tilt-up', 'tilt-down',
]);
const SHOT_SIZES = new Set<ShotSize>(['ews', 'ws', 'ms', 'mcu', 'cu', 'ecu']);
const SHOT_ANGLES = new Set<ShotAngle>(['eye', 'high', 'low', 'dutch']);
const SHOT_BODIES = new Set<ShotBodies>(['one', 'two', 'group', 'ots', 'insert']);
const SHOT_CLEAN = new Set<ShotClean>(['clean', 'dirty']);
const ELEMENT_TYPES = new Set<ScreenplayElementType>([
  'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition',
]);

export interface VoiceDirectorApplyResult {
  director: DirectorShow;
  summary: string;
  appliedCount: number;
  warnings: string[];
}

interface NormalizedVoiceChanges {
  summary: string;
  scriptEdits: AssistantEdit[];
  beatEdits: BeatEdit[];
  sceneUpdates: Array<{ sceneId: string; patch: Partial<DirectorScene> }>;
  clipUpdates: Array<{ clipId: string; patch: Record<string, unknown> }>;
  shotUpdates: Array<{ clipId: string; beatN: number; patch: Partial<DirectorBeat> }>;
  replaceShots: Array<{ clipId: string; beats: DirectorBeat[] }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = 20_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function finite(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : undefined;
}

function cameraMove(value: unknown): DirectorCameraMove | undefined {
  const row = record(value);
  if (!row || typeof row.move !== 'string' || !CAMERA_MOVES.has(row.move as CameraMoveId)) return undefined;
  return {
    move: row.move as CameraMoveId,
    intensity: Math.round(finite(row.intensity, 0, 100) ?? 0),
  };
}

function shotGrammar(value: unknown): DirectorShotGrammar | undefined {
  const row = record(value);
  if (!row) return undefined;
  const grammar: DirectorShotGrammar = {};
  if (typeof row.size === 'string' && SHOT_SIZES.has(row.size as ShotSize)) grammar.size = row.size as ShotSize;
  if (typeof row.angle === 'string' && SHOT_ANGLES.has(row.angle as ShotAngle)) grammar.angle = row.angle as ShotAngle;
  if (typeof row.bodies === 'string' && SHOT_BODIES.has(row.bodies as ShotBodies)) grammar.bodies = row.bodies as ShotBodies;
  if (typeof row.clean === 'string' && SHOT_CLEAN.has(row.clean as ShotClean)) grammar.clean = row.clean as ShotClean;
  if (typeof row.move === 'string' && CAMERA_MOVES.has(row.move as CameraMoveId)) grammar.move = row.move as CameraMoveId;
  return Object.keys(grammar).length > 0 ? grammar : undefined;
}

function screenplayElements(value: unknown): ScreenplayElement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const elements = value.flatMap((entry) => {
    const row = record(entry);
    const elementText = text(row?.text);
    const type = row?.type;
    if (!row || !elementText || typeof type !== 'string' || !ELEMENT_TYPES.has(type as ScreenplayElementType)) return [];
    return [{
      id: text(row.id, 256) ?? generateId(),
      type: type as ScreenplayElementType,
      text: elementText,
    }];
  });
  return elements.length > 0 ? elements : undefined;
}

function normalizeScriptEdits(value: unknown): AssistantEdit[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    const row = record(entry);
    if (!row || (row.op !== 'replace' && row.op !== 'insert-after' && row.op !== 'delete')) return [];
    const targetElementId = text(row.targetElementId, 256);
    if ((row.op === 'replace' || row.op === 'delete') && !targetElementId) return [];
    const elements = screenplayElements(row.elements);
    if ((row.op === 'replace' || row.op === 'insert-after') && !elements) return [];
    return [{ op: row.op, targetElementId, elements } as AssistantEdit];
  });
}

function normalizeBeatEdits(value: unknown): BeatEdit[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    const row = record(entry);
    if (!row || (row.op !== 'replace' && row.op !== 'insert-after' && row.op !== 'delete')) return [];
    const targetBeatId = text(row.targetBeatId, 256);
    if ((row.op === 'replace' || row.op === 'delete') && !targetBeatId) return [];
    if ((row.op === 'replace' || row.op === 'insert-after') && !Array.isArray(row.beats)) return [];
    const beats = Array.isArray(row.beats) ? row.beats.flatMap((entryBeat) => {
      const beat = record(entryBeat);
      const action = text(beat?.action);
      const location = text(beat?.location);
      const shot = text(beat?.shot);
      if (!beat || !action || !location || !shot) return [];
      return [{
        id: text(beat.id, 256) ?? generateId(),
        n: 0,
        action,
        location,
        shot,
        mood: text(beat.mood),
      }];
    }) : undefined;
    if ((row.op === 'replace' || row.op === 'insert-after') && !beats?.length) return [];
    return [{ op: row.op, targetBeatId, beats } as BeatEdit];
  });
}

function normalizeSceneUpdates(value: unknown): NormalizedVoiceChanges['sceneUpdates'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((entry) => {
    const row = record(entry);
    const sceneId = text(row?.sceneId, 256);
    const rawPatch = record(row?.patch);
    if (!sceneId || !rawPatch) return [];
    const patch: Partial<DirectorScene> = {};
    for (const key of ['label', 'summary', 'event', 'physicalAction', 'axis'] as const) {
      const valueText = text(rawPatch[key]);
      if (valueText !== undefined) patch[key] = valueText;
    }
    if (Array.isArray(rawPatch.coverage)) {
      const coverage = rawPatch.coverage.filter((item): item is CoverageKind => (
        typeof item === 'string' && COVERAGE.has(item as CoverageKind)
      ));
      if (coverage.length > 0) patch.coverage = [...new Set(coverage)];
    }
    const move = cameraMove(rawPatch.cameraMove);
    if (move) patch.cameraMove = move;
    return Object.keys(patch).length > 0 ? [{ sceneId, patch }] : [];
  });
}

function normalizeClipUpdates(value: unknown): NormalizedVoiceChanges['clipUpdates'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).flatMap((entry) => {
    const row = record(entry);
    const clipId = text(row?.clipId, 256);
    const rawPatch = record(row?.patch);
    if (!clipId || !rawPatch) return [];
    const patch: Record<string, unknown> = {};
    for (const key of ['title', 'subject', 'location', 'intent', 'camera', 'style', 'constraints', 'lock', 'blocking'] as const) {
      const valueText = text(rawPatch[key]);
      if (valueText !== undefined) patch[key] = valueText;
    }
    const fov = finite(rawPatch.fov, 1, 180);
    if (fov !== undefined) patch.fov = fov;
    const move = cameraMove(rawPatch.cameraMove);
    if (move) patch.cameraMove = move;
    return Object.keys(patch).length > 0 ? [{ clipId, patch }] : [];
  });
}

function normalizeDirectorBeat(value: unknown, index: number): DirectorBeat | null {
  const row = record(value);
  const beatText = text(row?.text);
  if (!row || !beatText) return null;
  const dur = Math.max(1, Math.round(finite(row.dur ?? row.duration, 1, 600) ?? 1));
  return ensureBeatOrigin({
    n: Math.max(1, Math.round(finite(row.n, 1, 999) ?? index + 1)),
    from: '0:00',
    to: '0:00',
    dur,
    text: beatText,
    cam: text(row.cam),
    framing: text(row.framing),
    gist: text(row.gist),
    quote: text(row.quote),
    speaker: text(row.speaker),
    grammar: shotGrammar(row.grammar),
    fov: finite(row.fov, 1, 180),
  });
}

function normalizeReplaceShots(value: unknown): NormalizedVoiceChanges['replaceShots'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((entry) => {
    const row = record(entry);
    const clipId = text(row?.clipId, 256);
    if (!clipId || !Array.isArray(row?.beats)) return [];
    const beats = row.beats.flatMap((beat, index) => {
      const parsed = normalizeDirectorBeat(beat, index);
      return parsed ? [parsed] : [];
    });
    return beats.length > 0 ? [{ clipId, beats }] : [];
  });
}

function normalizeShotUpdates(value: unknown): NormalizedVoiceChanges['shotUpdates'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 120).flatMap((entry) => {
    const row = record(entry);
    const clipId = text(row?.clipId, 256);
    const beatN = Math.round(finite(row?.beatN, 1, 999) ?? 0);
    const rawPatch = record(row?.patch);
    if (!clipId || beatN < 1 || !rawPatch) return [];
    const patch: Partial<DirectorBeat> = {};
    for (const key of ['text', 'cam', 'framing', 'gist', 'quote', 'speaker'] as const) {
      const valueText = text(rawPatch[key]);
      if (valueText !== undefined) patch[key] = valueText;
    }
    const dur = finite(rawPatch.dur ?? rawPatch.duration, 1, 600);
    if (dur !== undefined) patch.dur = Math.max(1, Math.round(dur));
    const fov = finite(rawPatch.fov, 1, 180);
    if (fov !== undefined) patch.fov = fov;
    const grammar = shotGrammar(rawPatch.grammar);
    if (grammar) patch.grammar = grammar;
    return Object.keys(patch).length > 0 ? [{ clipId, beatN, patch }] : [];
  });
}

export function normalizeVoiceDirectorChanges(value: unknown): NormalizedVoiceChanges | null {
  const row = record(value);
  if (!row) return null;
  const normalized: NormalizedVoiceChanges = {
    summary: text(row.summary, 500) ?? 'Applied Voice Director changes.',
    scriptEdits: normalizeScriptEdits(row.scriptEdits),
    beatEdits: normalizeBeatEdits(row.beatEdits),
    sceneUpdates: normalizeSceneUpdates(row.sceneUpdates),
    clipUpdates: normalizeClipUpdates(row.clipUpdates),
    shotUpdates: normalizeShotUpdates(row.shotUpdates),
    replaceShots: normalizeReplaceShots(row.replaceShots),
  };
  const count = normalized.scriptEdits.length + normalized.beatEdits.length
    + normalized.sceneUpdates.length + normalized.clipUpdates.length
    + normalized.shotUpdates.length + normalized.replaceShots.length;
  return count > 0 ? normalized : null;
}

export function voiceScreenplay(show: DirectorShow): Screenplay {
  if (show.sourceElements) return { elements: show.sourceElements };
  return {
    elements: parseToScreenplay(show.sourceText).elements.map((element, index) => ({
      ...element,
      id: `voice-script-${index + 1}`,
    })),
  };
}

export function applyVoiceDirectorChanges(show: DirectorShow, value: unknown): VoiceDirectorApplyResult {
  const changes = normalizeVoiceDirectorChanges(value);
  if (!changes) {
    return { director: show, summary: 'No valid CineGen changes were provided.', appliedCount: 0, warnings: [] };
  }

  let director = structuredClone(show);
  let appliedCount = 0;
  const warnings: string[] = [];

  if (changes.scriptEdits.length > 0) {
    const current = voiceScreenplay(director);
    const known = new Set(current.elements.map((element) => element.id));
    const valid = changes.scriptEdits.filter((edit) => (
      edit.op === 'insert-after'
        ? !edit.targetElementId || known.has(edit.targetElementId)
        : Boolean(edit.targetElementId && known.has(edit.targetElementId))
    ));
    if (valid.length > 0) {
      const next = applyAssistantEdits(current, valid);
      director.sourceElements = next.elements;
      director.sourceText = serializeScreenplay(next);
      director.docKind = 'screenplay';
      appliedCount += valid.length;
    }
    if (valid.length !== changes.scriptEdits.length) warnings.push('Some script edits referenced lines that no longer exist.');
  }

  if (changes.beatEdits.length > 0) {
    if (director.docKind === 'beatsheet' && director.beatSheet) {
      const known = new Set(director.beatSheet.beats.map((beat) => beat.id));
      const valid = changes.beatEdits.filter((edit) => (
        edit.op === 'insert-after'
          ? !edit.targetBeatId || known.has(edit.targetBeatId)
          : Boolean(edit.targetBeatId && known.has(edit.targetBeatId))
      ));
      if (valid.length > 0) {
        director.beatSheet = applyBeatEdits(director.beatSheet, valid);
        director.sourceText = serializeBeatSheet(director.beatSheet);
        appliedCount += valid.length;
      }
      if (valid.length !== changes.beatEdits.length) warnings.push('Some beat-sheet edits referenced beats that no longer exist.');
    } else {
      warnings.push('Beat-sheet edits were ignored because the active document is a screenplay.');
    }
  }

  for (const update of changes.sceneUpdates) {
    const index = director.scenes.findIndex((scene) => scene.id === update.sceneId);
    if (index < 0) {
      warnings.push(`Scene ${update.sceneId} no longer exists.`);
      continue;
    }
    director.scenes[index] = { ...director.scenes[index], ...update.patch };
    appliedCount += 1;
  }

  for (const update of changes.clipUpdates) {
    const index = director.clips.findIndex((clip) => clip.id === update.clipId);
    if (index < 0) {
      warnings.push(`Clip ${update.clipId} no longer exists.`);
      continue;
    }
    director.clips[index] = { ...director.clips[index], ...update.patch };
    appliedCount += 1;
  }

  for (const replacement of changes.replaceShots) {
    const index = director.clips.findIndex((clip) => clip.id === replacement.clipId);
    if (index < 0) {
      warnings.push(`Clip ${replacement.clipId} no longer exists.`);
      continue;
    }
    const clip = director.clips[index];
    const beats = replacement.beats.map((beat, beatIndex) => ({ ...beat, n: beatIndex + 1 }));
    director.clips[index] = retimeClipToSeconds({
      ...clip,
      beats,
      bodyEdits: {},
      pendingRewrite: undefined,
      activeVariant: { kind: 'full' },
    }, clip.seconds);
    appliedCount += 1;
  }

  for (const update of changes.shotUpdates) {
    const clipIndex = director.clips.findIndex((clip) => clip.id === update.clipId);
    if (clipIndex < 0) {
      warnings.push(`Clip ${update.clipId} no longer exists.`);
      continue;
    }
    const clip = director.clips[clipIndex];
    const beatIndex = clip.beats.findIndex((beat) => beat.n === update.beatN);
    if (beatIndex < 0) {
      warnings.push(`Shot ${update.beatN} no longer exists in ${update.clipId}.`);
      continue;
    }
    const beats = clip.beats.map((beat, index) => index === beatIndex
      ? ensureBeatOrigin({ ...beat, ...update.patch, origin: beat.origin })
      : beat);
    director.clips[clipIndex] = update.patch.dur !== undefined
      ? retimeClipToSeconds({ ...clip, beats, bodyEdits: {} }, clip.seconds)
      : { ...clip, beats, bodyEdits: {} };
    appliedCount += 1;
  }

  return { director, summary: changes.summary, appliedCount, warnings };
}

function compactScript(show: DirectorShow): string {
  if (show.docKind === 'beatsheet' && show.beatSheet) {
    return show.beatSheet.beats.slice(0, 240).map((beat) => (
      `[${beat.id}] BEAT ${beat.n} @ ${beat.location} | ${beat.action} | SHOT: ${beat.shot}${beat.mood ? ` | ${beat.mood}` : ''}`
    )).join('\n');
  }
  return voiceScreenplay(show).elements.slice(0, 400)
    .map((element) => `[${element.id}] (${element.type}) ${element.text}`)
    .join('\n');
}

function compactVoiceValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[nested value omitted]';
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return `[data URL omitted · ${value.length} chars]`;
    return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((entry) => compactVoiceValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !['takes', 'llmOrigin', 'diagramUrl', 'sourceFrameUrl', 'promptSnapshot'].includes(key))
      .slice(0, 80)
      .map(([key, entry]) => [key, compactVoiceValue(entry, depth + 1)]));
  }
  return String(value);
}

export function buildVoiceDirectorContext(state: WorkspaceState): string {
  const show = state.director;
  const scene = show.scenes.find((entry) => entry.id === show.selectedSceneId);
  const clip = show.clips.find((entry) => entry.id === show.selectedClipId);
  const activeTimeline = state.timelines.find((entry) => entry.id === state.activeTimelineId);
  const selectedNodes = state.nodes.filter((node) => node.selected && node.type !== 'group');
  const sections = [
    `ACTIVE TAB: ${state.activeTab}`,
    `DIRECTOR PAGE: ${show.mode}`,
    scene ? `SELECTED SCENE:\n${JSON.stringify(compactVoiceValue(scene), null, 2)}` : 'SELECTED SCENE: none',
    clip ? `SELECTED CLIP AND SHOTS:\n${JSON.stringify(compactVoiceValue(clip), null, 2)}` : 'SELECTED CLIP: none',
    selectedNodes.length > 0 ? `SELECTED SPACE NODES:\n${JSON.stringify(compactVoiceValue(selectedNodes.map((node) => ({ id: node.id, type: node.data.type, label: node.data.label, config: node.data.config }))), null, 2)}` : null,
    activeTimeline ? `ACTIVE TIMELINE: ${activeTimeline.name} (${activeTimeline.id}), ${activeTimeline.clips.length} clips` : null,
    `DIRECTOR TAGS:\n${show.breakdown.slice(0, 80).map((item) => `${item.tag} = ${item.name} (${item.kind})`).join('\n') || 'none'}`,
    `ACTIVE ${show.docKind === 'beatsheet' ? 'BEAT SHEET' : 'SCRIPT'}:\n${compactScript(show) || '(empty)'}`,
  ];
  return sections.filter((section): section is string => Boolean(section)).join('\n\n');
}

export const VOICE_DIRECTOR_INSTRUCTIONS = `You are Voice Director inside CineGen, a concise, collaborative filmmaking partner.
Have a natural spoken conversation about shots, blocking, coverage, pacing, performances, and scripts. Let the user brainstorm freely. Track the decisions you agree on across the conversation.
The current CineGen project context is included below. Exact ids in that context are the only ids you may target.
NEVER change the project while merely brainstorming. Only call apply_director_changes after the user gives explicit execution language such as "execute it", "apply that", "make those changes", or an equally clear command.
When execution is explicit, translate the agreed plan into one apply_director_changes call. Keep it atomic. Prefer updating the selected scene or clip. Use scriptEdits for screenplay lines, beatEdits for beat-sheet rows, clipUpdates for blocking and clip-level intent, shotUpdates for individual shots, and replaceShots when the shot flow changes structurally.
When replacing shots, provide concrete filmable text, camera/framing, and positive integer durations. CineGen will retime them to the clip length.
After a tool result, briefly say what CineGen applied. If the tool returns warnings, mention them. Never claim a change happened before the tool result confirms it.
The user can interrupt you. Speak in short paragraphs and ask at most one question at a time.`;

export const APPLY_DIRECTOR_CHANGES_TOOL = {
  type: 'function',
  name: 'apply_director_changes',
  description: 'Apply an explicitly approved, undoable set of screenplay, beat-sheet, scene, clip, blocking, coverage, or shot changes to CineGen.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Short past-tense summary for the user.' },
      scriptEdits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['replace', 'insert-after', 'delete'] },
            targetElementId: { type: 'string' },
            elements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string', enum: ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'] },
                  text: { type: 'string' },
                },
                required: ['type', 'text'],
              },
            },
          },
          required: ['op'],
        },
      },
      beatEdits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['replace', 'insert-after', 'delete'] },
            targetBeatId: { type: 'string' },
            beats: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' }, action: { type: 'string' }, location: { type: 'string' },
                  shot: { type: 'string' }, mood: { type: 'string' },
                },
                required: ['action', 'location', 'shot'],
              },
            },
          },
          required: ['op'],
        },
      },
      sceneUpdates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sceneId: { type: 'string' },
            patch: {
              type: 'object',
              properties: {
                label: { type: 'string' }, summary: { type: 'string' }, event: { type: 'string' },
                physicalAction: { type: 'string' }, axis: { type: 'string' },
                coverage: { type: 'array', items: { type: 'string', enum: ['master', 'singles', 'ots', 'two-shot', 'insert'] } },
                cameraMove: { type: 'object', properties: { move: { type: 'string' }, intensity: { type: 'number' } }, required: ['move', 'intensity'] },
              },
            },
          },
          required: ['sceneId', 'patch'],
        },
      },
      clipUpdates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            clipId: { type: 'string' },
            patch: {
              type: 'object',
              properties: {
                title: { type: 'string' }, subject: { type: 'string' }, location: { type: 'string' },
                intent: { type: 'string' }, camera: { type: 'string' }, style: { type: 'string' },
                constraints: { type: 'string' }, lock: { type: 'string' }, blocking: { type: 'string' },
                fov: { type: 'number' },
                cameraMove: { type: 'object', properties: { move: { type: 'string' }, intensity: { type: 'number' } }, required: ['move', 'intensity'] },
              },
            },
          },
          required: ['clipId', 'patch'],
        },
      },
      shotUpdates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            clipId: { type: 'string' }, beatN: { type: 'number' },
            patch: {
              type: 'object',
              properties: {
                text: { type: 'string' }, cam: { type: 'string' }, framing: { type: 'string' },
                gist: { type: 'string' }, quote: { type: 'string' }, speaker: { type: 'string' },
                dur: { type: 'number' }, fov: { type: 'number' },
                grammar: {
                  type: 'object',
                  properties: {
                    size: { type: 'string', enum: ['ews', 'ws', 'ms', 'mcu', 'cu', 'ecu'] },
                    angle: { type: 'string', enum: ['eye', 'high', 'low', 'dutch'] },
                    bodies: { type: 'string', enum: ['one', 'two', 'group', 'ots', 'insert'] },
                    clean: { type: 'string', enum: ['clean', 'dirty'] },
                    move: { type: 'string' },
                  },
                },
              },
            },
          },
          required: ['clipId', 'beatN', 'patch'],
        },
      },
      replaceShots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            clipId: { type: 'string' },
            beats: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  n: { type: 'number' }, dur: { type: 'number' }, text: { type: 'string' },
                  cam: { type: 'string' }, framing: { type: 'string' }, gist: { type: 'string' },
                  quote: { type: 'string' }, speaker: { type: 'string' }, fov: { type: 'number' },
                  grammar: { type: 'object' },
                },
                required: ['dur', 'text'],
              },
            },
          },
          required: ['clipId', 'beats'],
        },
      },
    },
    required: ['summary'],
  },
} as const;

export const UNDO_VOICE_DIRECTOR_TOOL = {
  type: 'function',
  name: 'undo_last_voice_change',
  description: 'Undo the most recent CineGen change after the user explicitly asks to undo it.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
    },
  },
} as const;
