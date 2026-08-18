import type { DirectorBreakdownItem, DirectorScene, DirectorShow } from '@/types/director';
import { compiledLookFromRefs, compileLookBible } from './look-bible';
import { shotDensityHint } from './shotlist';

/** Script slice sent with the look-bible job. The whole script would drown the look. */
const LOOK_SCRIPT_CHARS = 4000;

function elementLine(item: DirectorBreakdownItem): string {
  const lines = [`${item.tag} (${item.kind}): ${item.description}`];
  if (item.actingProfile?.trim()) lines.push(`  ACTING PROFILE — ${item.actingProfile.trim()}`);
  if (item.voice?.trim()) lines.push(`  VOICE (locked, never adapted) — ${item.voice.trim()}`);
  return lines.join('\n');
}

function sceneLine(scene: DirectorScene): string {
  const lines = [`${scene.number}. ${scene.label} — ${scene.summary}`];
  if (scene.event?.trim()) lines.push(`  EVENT — ${scene.event.trim()}`);
  if (scene.physicalAction?.trim()) lines.push(`  PHYSICAL ACTION — ${scene.physicalAction.trim()}`);
  return lines.join('\n');
}

export function breakdownJobInput(show: DirectorShow, existingElements: string): string {
  return [
    `Clip length setting: ${show.clipLengthSec}s.`,
    `Existing elements: ${existingElements || 'none'}`,
    '',
    `SCRIPT:\n${show.sourceText}`,
  ].join('\n');
}

export function shotlistJobInput(show: DirectorShow, scene: DirectorScene | undefined, sceneOnly: boolean): string {
  const scenes = sceneOnly && scene
    ? `Only this scene:\n${sceneLine(scene)}`
    : `Scenes:\n${show.scenes.map(sceneLine).join('\n')}`;

  return [
    `Style prefix:\n${compileLookBible(show) || '(none yet)'}`,
    `Elements:\n${show.breakdown.map(elementLine).join('\n')}`,
    scenes,
    `SCRIPT:\n${show.sourceText}`,
  ].filter(Boolean).join('\n\n');
}

export function lookBibleJobInput(show: DirectorShow): string {
  const compiled = compiledLookFromRefs(show);
  const notes = show.lookBible.notes.trim();
  return [
    compiled || '(no genre, films, or stills yet)',
    notes && notes !== compiled ? `Current look notes (keep useful edits):\n${notes}` : '',
    show.sourceText.trim() ? `Script excerpt:\n${show.sourceText.slice(0, LOOK_SCRIPT_CHARS)}` : '',
  ].filter(Boolean).join('\n\n');
}

export function shotlistDensity(show: DirectorShow): string {
  return shotDensityHint(show.clipLengthSec);
}
