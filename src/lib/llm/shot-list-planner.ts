import type { ParsedShotEntry } from '@/lib/llm/shot-list-parse';
import { buildFallbackVisualPrompt, suggestDurationForShot } from '@/lib/llm/shot-list-parse';
import type { SpacePromptEntry } from '@/lib/llm/space-templates';

export interface VideoClipPlan {
  label: string;
  shotNumbers: number[];
  totalDuration: number;
  mode: 'seedance-single' | 'kling-multi';
  shots: SpacePromptEntry[];
  combinedPrompt?: string;
}

export interface PlanVideoClipsOptions {
  combineShots: boolean;
  maxClipDuration?: number;
  preferKlingForMulti?: boolean;
}

function shotsAreAdjacent(a: ParsedShotEntry, b: ParsedShotEntry): boolean {
  return b.number - a.number === 1;
}

function sameScene(a: ParsedShotEntry, b: ParsedShotEntry): boolean {
  const aScene = a.label.split(/[—–-]/)[0]?.trim().toLowerCase() ?? '';
  const bScene = b.label.split(/[—–-]/)[0]?.trim().toLowerCase() ?? '';
  if (!aScene || !bScene) return true;
  return aScene === bScene || aScene.includes(bScene) || bScene.includes(aScene);
}

function toPromptEntry(shot: ParsedShotEntry): SpacePromptEntry {
  return {
    label: `Shot ${shot.number} — ${shot.label}`,
    prompt: buildFallbackVisualPrompt(shot),
    duration: suggestDurationForShot(shot),
  };
}

function buildCombinedPrompt(shots: ParsedShotEntry[]): string {
  return shots.map((shot) => {
    const duration = suggestDurationForShot(shot);
    return `[${duration}s] ${buildFallbackVisualPrompt(shot)}`;
  }).join(' Cut to: ');
}

export function planVideoClips(
  shots: ParsedShotEntry[],
  options: PlanVideoClipsOptions,
): VideoClipPlan[] {
  if (shots.length === 0) return [];

  const maxClip = options.maxClipDuration ?? 15;
  const plans: VideoClipPlan[] = [];

  if (!options.combineShots) {
    for (const shot of shots) {
      const duration = suggestDurationForShot(shot);
      plans.push({
        label: `Shot ${shot.number}`,
        shotNumbers: [shot.number],
        totalDuration: duration,
        mode: 'seedance-single',
        shots: [toPromptEntry(shot)],
        combinedPrompt: buildFallbackVisualPrompt(shot),
      });
    }
    return plans;
  }

  let index = 0;
  while (index < shots.length) {
    const group: ParsedShotEntry[] = [shots[index]];
    let totalDuration = suggestDurationForShot(shots[index]);

    while (index + group.length < shots.length) {
      const next = shots[index + group.length];
      const nextDuration = suggestDurationForShot(next);
      if (totalDuration + nextDuration > maxClip) break;
      if (!shotsAreAdjacent(group[group.length - 1], next)) break;
      if (!sameScene(group[group.length - 1], next) && group.length >= 2) break;
      group.push(next);
      totalDuration += nextDuration;
    }

    const shotNumbers = group.map((shot) => shot.number);
    const label = group.length === 1
      ? `Shot ${shotNumbers[0]}`
      : `Shots ${shotNumbers[0]}–${shotNumbers[shotNumbers.length - 1]}`;

    if (group.length === 1 || options.preferKlingForMulti === false) {
      plans.push({
        label,
        shotNumbers,
        totalDuration,
        mode: 'seedance-single',
        shots: group.map(toPromptEntry),
        combinedPrompt: buildCombinedPrompt(group),
      });
    } else {
      plans.push({
        label,
        shotNumbers,
        totalDuration,
        mode: 'kling-multi',
        shots: group.map(toPromptEntry),
      });
    }

    index += group.length;
  }

  return plans;
}

export function planStoryboardPanels(shots: ParsedShotEntry[]): SpacePromptEntry[] {
  return shots.map((shot) => ({
    label: `Panel ${shot.number} — ${shot.label}`,
    prompt: buildFallbackVisualPrompt(shot),
    duration: suggestDurationForShot(shot),
  }));
}
