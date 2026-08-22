// Instant, deterministic breakdown for the whole show — no LLM, no latency.
//
// Runs synchronously on every script edit so the Breakdown tab is already
// populated the moment the user switches to it. The LLM identify pass then only
// ADDS what the lexicons missed and writes richer descriptions; it never has to
// re-derive the structural facts extracted here (scene list, locations,
// speaking characters).

import type { DirectorBreakdownItem, DirectorScene, DirectorShow } from '@/types/director';
import { generateId } from '@/lib/utils/ids';
import { normalizeTag, type ParsedBreakdown } from './breakdown';
import { screenplayFromSource } from './screenplay';
import { splitScenes, type ScriptScene } from './scene-split';
import { extractFromBeatSheet, extractFromScreenplay, type ExtractedItem } from './local-extract';

const SUMMARY_MAX = 160;

function toBreakdownItem(item: ExtractedItem): DirectorBreakdownItem {
  return {
    id: generateId(),
    kind: item.kind,
    name: item.name,
    tag: normalizeTag(item.name),
    // Locations carry the structural INT/EXT + time facts; everything else waits
    // for the LLM description so we never clobber a richer one with filler.
    description: item.kind === 'location'
      ? [item.intExt, item.timeOfDay].filter(Boolean).join(', ')
      : '',
    intExt: item.intExt,
    timeOfDay: item.timeOfDay,
    auto: true,
  };
}

function sceneSummary(scene: ScriptScene): string {
  const action = scene.elements.find((el) => el.type === 'action')?.text ?? '';
  const first = action.split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  return first.length > SUMMARY_MAX ? `${first.slice(0, SUMMARY_MAX - 1)}…` : first;
}

/** Deterministic scenes straight from the script: label IS the scene heading, so
 *  they key-match the cascade's sceneHashes and the breakdown tab's scene list. */
function scenesFromScript(scenes: ScriptScene[]): DirectorScene[] {
  return scenes.map((scene, index) => ({
    id: generateId(),
    number: index + 1,
    label: scene.heading.trim() || `SCENE ${index + 1}`,
    summary: sceneSummary(scene),
    elementIds: [],
    clipIds: [],
  }));
}

/** Zero-LLM breakdown of the current document. Beat sheets yield items only —
 *  their scene structure is still the LLM's job. */
export function localBreakdownForShow(show: DirectorShow): ParsedBreakdown {
  if (show.docKind === 'beatsheet') {
    const beats = show.beatSheet;
    if (!beats || beats.beats.length === 0) return { items: [], scenes: [] };
    return { items: extractFromBeatSheet(beats).map(toBreakdownItem), scenes: [] };
  }
  if (!show.sourceText.trim()) return { items: [], scenes: [] };
  const scenes = splitScenes(screenplayFromSource(show));
  return {
    items: extractFromScreenplay(scenes).map(toBreakdownItem),
    scenes: scenesFromScript(scenes),
  };
}
