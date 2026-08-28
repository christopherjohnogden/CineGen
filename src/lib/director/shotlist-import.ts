import type { DirectorClip, DirectorScene, DirectorShow } from '@/types/director';
import { shotlistJobInput } from './job-inputs';
import { shotlistSystemPrompt } from './llm-jobs';
import { bindShotlistToScene, parseShotlistPayload, shotDensityHint } from './shotlist';

export interface ShotlistImportSceneSummary {
  id: string;
  label: string;
  clips: number;
  shots: number;
  seconds: number;
}

export interface ShotlistImportDraft {
  clips: DirectorClip[];
  sceneIds: string[];
  scenes: ShotlistImportSceneSummary[];
  stylePrefix?: string;
  warnings: string[];
  clipCount: number;
  shotCount: number;
  seconds: number;
}

export type ShotlistImportResult =
  | { ok: true; draft: ShotlistImportDraft }
  | { ok: false; errors: string[] };

function normalizeLabel(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function jsonObjectText(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
}

function sceneNumberFromClipId(id: string): number | undefined {
  const match = id.trim().match(/^(\d+)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function clipScene(
  clip: DirectorClip,
  scenes: DirectorScene[],
  incomingSceneMap: Map<string, DirectorScene>,
  soleIncomingScene?: DirectorScene,
): DirectorScene | undefined {
  return incomingSceneMap.get(clip.sceneId)
    ?? scenes.find((scene) => scene.id === clip.sceneId)
    ?? scenes.find((scene) => scene.number === sceneNumberFromClipId(clip.id))
    ?? soleIncomingScene;
}

export function parseClaudeShotlistImport(text: string, show: DirectorShow): ShotlistImportResult {
  if (!text.trim()) return { ok: false, errors: ['Paste Claude JSON or choose a .json file.'] };

  let raw: unknown;
  try {
    raw = JSON.parse(jsonObjectText(text));
  } catch (error) {
    return {
      ok: false,
      errors: [`This is not valid JSON yet: ${error instanceof Error ? error.message : 'check the punctuation and try again.'}`],
    };
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'shotlist' in raw) {
    raw = (raw as { shotlist?: unknown }).shotlist;
  }

  const parsed = parseShotlistPayload(raw);
  const errors = [...parsed.errors];
  if (parsed.rawClipCount === 0) errors.push('No clips were found. The JSON needs a top-level "clips" array.');
  if (parsed.rawClipCount > parsed.clips.length) {
    errors.push(`${parsed.rawClipCount - parsed.clips.length} clip entr${parsed.rawClipCount - parsed.clips.length === 1 ? 'y was' : 'ies were'} unreadable.`);
  }
  if (show.scenes.length === 0) errors.push('Run Breakdown first so imported clips have project scenes to attach to.');

  const existingByNumber = new Map(show.scenes.map((scene) => [scene.number, scene]));
  const existingByLabel = new Map(show.scenes.map((scene) => [normalizeLabel(scene.label), scene]));
  const incomingSceneMap = new Map<string, DirectorScene>();
  const declaredMatches: DirectorScene[] = [];

  for (const incoming of parsed.scenes) {
    const match = show.scenes.find((scene) => scene.id === incoming.id)
      ?? existingByNumber.get(incoming.number)
      ?? existingByLabel.get(normalizeLabel(incoming.label));
    if (!match) {
      errors.push(`Scene ${incoming.number} (${incoming.label}) does not match a scene in this project.`);
      continue;
    }
    incomingSceneMap.set(incoming.id, match);
    declaredMatches.push(match);
  }

  const soleIncomingScene = declaredMatches.length === 1 ? declaredMatches[0] : undefined;
  const grouped = new Map<string, DirectorClip[]>();
  for (const clip of parsed.clips) {
    const scene = clipScene(clip, show.scenes, incomingSceneMap, soleIncomingScene);
    if (!scene) {
      errors.push(`${clip.id}: could not match sceneId "${clip.sceneId}" to this project.`);
      continue;
    }
    if (clip.seconds <= 0 || clip.beats.some((beat) => beat.dur <= 0)) {
      errors.push(`${clip.id}: every shot needs a positive duration and the clip needs a positive runtime.`);
      continue;
    }
    const rows = grouped.get(scene.id) ?? [];
    rows.push(clip);
    grouped.set(scene.id, rows);
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  const clips: DirectorClip[] = [];
  const summaries: ShotlistImportSceneSummary[] = [];
  for (const scene of show.scenes) {
    const rows = grouped.get(scene.id);
    if (!rows?.length) continue;
    const bound = bindShotlistToScene({
      ...parsed,
      scenes: [],
      clips: rows,
    }, scene).clips;
    clips.push(...bound);
    summaries.push({
      id: scene.id,
      label: scene.label,
      clips: bound.filter((clip) => !clip.altOf).length,
      shots: bound.filter((clip) => !clip.altOf).reduce((sum, clip) => sum + clip.beats.length, 0),
      seconds: bound.filter((clip) => !clip.altOf).reduce((sum, clip) => sum + clip.seconds, 0),
    });
  }

  if (clips.length === 0) return { ok: false, errors: ['The JSON was valid, but no clips matched this project.'] };

  const mainClips = clips.filter((clip) => !clip.altOf);
  const warnings: string[] = [];
  if (summaries.length < show.scenes.length) {
    warnings.push(`Only ${summaries.length} of ${show.scenes.length} project scenes are included. Other scenes will stay unchanged.`);
  }
  if (parsed.coveredToEnd === false) warnings.push('Claude marked this shotlist as incomplete (coveredToEnd is false).');

  return {
    ok: true,
    draft: {
      clips,
      sceneIds: summaries.map((scene) => scene.id),
      scenes: summaries,
      stylePrefix: parsed.stylePrefix?.trim() || undefined,
      warnings,
      clipCount: mainClips.length,
      shotCount: mainClips.reduce((sum, clip) => sum + clip.beats.length, 0),
      seconds: mainClips.reduce((sum, clip) => sum + clip.seconds, 0),
    },
  };
}

export function applyClaudeShotlistImport(show: DirectorShow, draft: ShotlistImportDraft): DirectorShow {
  const affectedSceneIds = new Set(draft.sceneIds);
  const removedClipIds = new Set(show.clips.filter((clip) => affectedSceneIds.has(clip.sceneId)).map((clip) => clip.id));
  const importedClipIds = new Set(draft.clips.map((clip) => clip.id));
  const clips = show.scenes.flatMap((scene) => affectedSceneIds.has(scene.id)
    ? draft.clips.filter((clip) => clip.sceneId === scene.id)
    : show.clips.filter((clip) => clip.sceneId === scene.id));
  const scenes = show.scenes.map((scene) => ({
    ...scene,
    clipIds: clips.filter((clip) => clip.sceneId === scene.id).map((clip) => clip.id),
  }));
  const preservedSelectedClip = clips.find((clip) => clip.id === show.selectedClipId)
    && !removedClipIds.has(show.selectedClipId ?? '');
  const selectedClip = clips.find((clip) => clip.id === show.selectedClipId)
    ?? clips.find((clip) => affectedSceneIds.has(clip.sceneId))
    ?? clips[0];

  return {
    ...show,
    scenes,
    clips,
    stylePrefix: show.stylePrefix.trim() ? show.stylePrefix : (draft.stylePrefix ?? show.stylePrefix),
    storyboardFrames: show.storyboardFrames?.filter((frame) => !removedClipIds.has(frame.clipId) && !importedClipIds.has(frame.clipId)),
    selectedSceneId: selectedClip?.sceneId ?? show.selectedSceneId,
    selectedClipId: selectedClip?.id,
    selectedTakeId: preservedSelectedClip ? show.selectedTakeId : undefined,
    jobStatus: null,
  };
}

export function claudeShotlistImportPrompt(show: DirectorShow): string {
  return [
    'Create a CineGen Director shotlist for the project below.',
    'Return one raw JSON object only. Do not use Markdown fences, commentary, or ellipses.',
    'The result will be imported directly, so preserve every sceneId exactly and cover the script chronologically from first line to last.',
    '',
    shotlistSystemPrompt(show.clipLengthSec, shotDensityHint(show.clipLengthSec)),
    '',
    'PROJECT INPUT',
    shotlistJobInput(show, undefined),
  ].join('\n');
}
