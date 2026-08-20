import type { DirectorBreakdownItem, DirectorClip, DirectorScene, DirectorShow } from '@/types/director';
import { compiledLookFromRefs, compileLookBible, lookBibleImageUrls } from './look-bible';
import { parseToScreenplay } from './screenplay';
import { resolveSceneAssets } from './scene-assets';
import { splitScenes } from './scene-split';
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
  const lines = [`${scene.number}. [sceneId: ${scene.id}] ${scene.label} — ${scene.summary}`];
  if (scene.event?.trim()) lines.push(`  EVENT — ${scene.event.trim()}`);
  if (scene.physicalAction?.trim()) lines.push(`  PHYSICAL ACTION — ${scene.physicalAction.trim()}`);
  return lines.join('\n');
}

/** Numbered action-line script so the model must walk every slug, not skim. */
export function formatBreakdownScript(sourceText: string, headings?: Set<string>): string {
  const scenes = splitScenes(parseToScreenplay(sourceText));
  const picked = headings
    ? scenes.filter((scene) => headings.has(scene.heading.trim().toUpperCase()))
    : scenes;
  if (picked.length === 0) return sourceText;
  return picked.map((scene, index) => {
    const lines = [`=== SCENE ${index + 1}/${picked.length}  ${scene.heading || '(untitled)'} ===`];
    let action = 0;
    for (const el of scene.elements) {
      if (el.type === 'scene') continue;
      if (el.type === 'action') {
        action += 1;
        lines.push(`[A${action}] ACTION  ${el.text}`);
      } else if (el.type === 'character') {
        lines.push(`[C] ${el.text}`);
      } else if (el.type === 'dialogue') {
        lines.push(`[D] ${el.text}`);
      } else if (el.type === 'parenthetical') {
        lines.push(`[P] ${el.text}`);
      } else {
        lines.push(el.text);
      }
    }
    return lines.join('\n');
  }).join('\n\n');
}

function breakdownScriptSection(show: DirectorShow, scope?: { sceneIds: string[] }): string {
  if (!scope) return `SCRIPT:\n${formatBreakdownScript(show.sourceText)}`;
  const labels = new Set(
    show.scenes.filter((s) => scope.sceneIds.includes(s.id)).map((s) => s.label.trim().toUpperCase()),
  );
  return `SCRIPT (changed scenes only — return a complete element list for this excerpt):\n${formatBreakdownScript(show.sourceText, labels)}`;
}

export function breakdownJobInput(
  show: DirectorShow,
  existingElements: string,
  scope?: { sceneIds: string[] },
): string {
  return [
    `Clip length setting: ${show.clipLengthSec}s.`,
    `Existing library elements (reuse these names when they match): ${existingElements || 'none'}`,
    '',
    breakdownScriptSection(show, scope),
  ].join('\n');
}

/** Second pass: the same numbered script plus what the first pass already found. */
export function breakdownAuditInput(
  show: DirectorShow,
  items: DirectorBreakdownItem[],
  scope?: { sceneIds: string[] },
): string {
  const listed = items.length === 0
    ? '(none)'
    : items.map((item) => `- ${item.kind} ${item.tag} (${item.name})`).join('\n');
  return [
    'JUNIOR BREAKDOWN (already extracted — do NOT repeat these):',
    listed,
    '',
    breakdownScriptSection(show, scope),
  ].join('\n');
}

/** The scene's own script text, matched by heading. Empty when no heading matches. */
export function sceneScriptText(show: DirectorShow, scene: DirectorScene): string {
  const label = scene.label.trim().toUpperCase();
  const parsed = splitScenes(parseToScreenplay(show.sourceText));
  const match = parsed.find((entry) => entry.heading.trim().toUpperCase() === label);
  return match ? match.elements.map((element) => element.text).join('\n') : '';
}

/** Only the breakdown items the scoped scenes actually use — sending the full
 *  bible with every request dominated prompt size (and wall clock) on big
 *  shows. Falls back to everything when a scene can't be matched or nothing
 *  is detected. */
export function sceneScopedElements(show: DirectorShow, scopeScenes: DirectorScene[]): DirectorBreakdownItem[] {
  const parsed = splitScenes(parseToScreenplay(show.sourceText));
  const picked = new Map<string, DirectorBreakdownItem>();
  for (const scene of scopeScenes) {
    const label = scene.label.trim().toUpperCase();
    const index = parsed.findIndex((entry) => entry.heading.trim().toUpperCase() === label);
    if (index < 0) return show.breakdown; // can't scope safely — send everything
    for (const { item } of resolveSceneAssets(show, index, show.breakdown, parsed[index])) {
      picked.set(item.tag, item);
    }
  }
  return picked.size > 0 ? [...picked.values()] : show.breakdown;
}

/** Rough screen time: one script page ≈ one minute ≈ ~190 words, so ~3 words/second. */
export function estimateSceneSeconds(show: DirectorShow, scene: DirectorScene): number {
  const text = sceneScriptText(show, scene);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return Math.max(show.clipLengthSec, Math.round(words / 3));
}

export function shotlistJobInput(show: DirectorShow, scopeScenes: DirectorScene[] | undefined): string {
  // A scoped run (auto-sync fires one per edit) may cover several scenes at
  // once — every one of them must reach the job, not just the first.
  const scenes = scopeScenes && scopeScenes.length > 0
    ? `Only ${scopeScenes.length === 1 ? 'this scene' : 'these scenes'}:\n${scopeScenes.map(sceneLine).join('\n')}`
    : `Scenes:\n${show.scenes.map(sceneLine).join('\n')}`;

  // Scoped runs get only the scoped scenes' script text plus a coverage target,
  // so the model walks THIS scene end to end instead of summarizing the show.
  let scriptSection = `SCRIPT:\n${show.sourceText}`;
  let coverage = '';
  if (scopeScenes && scopeScenes.length > 0) {
    const slices = scopeScenes.map((scene) => sceneScriptText(show, scene));
    if (slices.every((slice) => slice.trim().length > 0)) {
      scriptSection = `SCRIPT (the scoped scene${scopeScenes.length === 1 ? '' : 's'} only — cover ALL of it):\n${slices.join('\n\n')}`;
    }
    coverage = scopeScenes.map((scene) => {
      const seconds = estimateSceneSeconds(show, scene);
      const clips = Math.max(1, Math.round(seconds / show.clipLengthSec));
      return `${scene.label}: ~${seconds}s of screen time ≈ ${clips} clip${clips === 1 ? '' : 's'} of ${show.clipLengthSec}s. The clips must cover it end to end.`;
    }).join('\n');
  }

  const elements = scopeScenes && scopeScenes.length > 0
    ? sceneScopedElements(show, scopeScenes)
    : show.breakdown;
  return [
    `Style prefix:\n${compileLookBible(show) || '(none yet)'}`,
    `Elements:\n${elements.map(elementLine).join('\n')}`,
    scenes,
    coverage ? `COVERAGE TARGET:\n${coverage}` : '',
    scriptSection,
  ].filter(Boolean).join('\n\n');
}

/** Input for a coverage continuation: the scene, what already exists, and where to pick up. */
export function shotlistContinuationInput(
  show: DirectorShow,
  scene: DirectorScene,
  existingClips: DirectorClip[],
  labels: Map<string, string>,
): string {
  const expected = estimateSceneSeconds(show, scene);
  const covered = existingClips.reduce((sum, clip) => sum + clip.seconds, 0);
  const existing = existingClips.map((clip) => {
    const last = clip.beats[clip.beats.length - 1];
    return `- [${labels.get(clip.id) ?? clip.id}] (id: ${clip.id}) "${clip.title}" — ${clip.seconds}s, ends on: ${last?.text ?? '(no beats)'}`;
  }).join('\n');
  const count = existingClips.length;
  const nextId = `${scene.number}-${count < 26 ? String.fromCharCode(97 + count) : String(count + 1)}`;
  return [
    `Style prefix:\n${compileLookBible(show) || '(none yet)'}`,
    `Elements:\n${sceneScopedElements(show, [scene]).map(elementLine).join('\n')}`,
    `Scene:\n${sceneLine(scene)}`,
    `The scene runs ~${expected}s of screen time but the EXISTING clips below cover only ~${covered}s:\n${existing}`,
    `NEW CLIP IDS — never reuse an id from the list above. Give the first new clip the id "${nextId}" and continue that sequence.`,
    `SCRIPT (the whole scene — find where the existing clips stop and continue from there to the END):\n${sceneScriptText(show, scene) || show.sourceText}`,
  ].join('\n\n');
}

/** One chronological excerpt of a scene, for a parallel fal.ai shotlist job.
 *  Clip ids are prefixed per slice so concurrent merges cannot collide. */
export function shotlistSliceInput(
  show: DirectorShow,
  scene: DirectorScene,
  slice: { index: number; of: number; text: string },
): string {
  const prefix = `${scene.number}-p${slice.index}`;
  return [
    `Style prefix:\n${compileLookBible(show) || '(none yet)'}`,
    `Elements:\n${sceneScopedElements(show, [scene]).map(elementLine).join('\n')}`,
    `Scene:\n${sceneLine(scene)}`,
    `SLICE ${slice.index + 1} of ${slice.of} — cover ONLY the excerpt below, first line to last. Do not shotlist material from earlier or later in the scene; sibling jobs cover those in parallel. coveredToEnd is true when the last clip lands on THIS excerpt's final line (not the whole scene).`,
    `CLIP IDS — every id MUST start with "${prefix}" (e.g. ${prefix}a, ${prefix}b) so parallel slices cannot collide.`,
    `SCRIPT (this slice only):\n${slice.text.trim() || show.sourceText}`,
  ].join('\n\n');
}

/** Continuation for one parallel slice — the excerpt, not the whole scene. */
export function shotlistSliceContinuationInput(
  show: DirectorShow,
  scene: DirectorScene,
  slice: { index: number; of: number; text: string },
  existingClips: DirectorClip[],
  labels: Map<string, string>,
): string {
  const prefix = `${scene.number}-p${slice.index}`;
  const existing = existingClips.map((clip) => {
    const last = clip.beats[clip.beats.length - 1];
    return `- [${labels.get(clip.id) ?? clip.id}] (id: ${clip.id}) "${clip.title}" — ends on: ${last?.text ?? '(no beats)'}`;
  }).join('\n');
  const nextLetter = existingClips.length < 26
    ? String.fromCharCode(97 + existingClips.length)
    : String(existingClips.length + 1);
  return [
    `Style prefix:\n${compileLookBible(show) || '(none yet)'}`,
    `Elements:\n${sceneScopedElements(show, [scene]).map(elementLine).join('\n')}`,
    `Scene:\n${sceneLine(scene)}`,
    `SLICE ${slice.index + 1} of ${slice.of} — continue THIS excerpt only. Existing clips for the slice:\n${existing || '(none)'}`,
    `NEW CLIP IDS — never reuse an id above. Give the first new clip the id "${prefix}${nextLetter}" and continue that sequence.`,
    `SCRIPT (this slice only — pick up after the existing clips and cover the rest of the excerpt):\n${slice.text.trim() || show.sourceText}`,
  ].join('\n\n');
}

/** One clip serialized for the scene-notes job — raw structured fields, tagged
 *  with the display label the director's notes refer to. */
function sceneNotesClip(clip: DirectorClip, label: string | undefined): Record<string, unknown> {
  return {
    label: label ?? clip.id,
    id: clip.id,
    sceneId: clip.sceneId,
    title: clip.title,
    seconds: clip.seconds,
    elementTags: clip.elementTags,
    subject: clip.subject,
    location: clip.location,
    ...(clip.blocking ? { blocking: clip.blocking } : {}),
    ...(typeof clip.fov === 'number' ? { fov: clip.fov } : {}),
    ...(clip.intent ? { intent: clip.intent } : {}),
    ...(clip.camera ? { camera: clip.camera } : {}),
    ...(clip.acting ? { acting: clip.acting } : {}),
    style: clip.style,
    constraints: clip.constraints,
    beats: clip.beats.map((beat) => ({
      n: beat.n, from: beat.from, to: beat.to, dur: beat.dur, text: beat.text,
      ...(beat.cam ? { cam: beat.cam } : {}),
      ...(beat.quote ? { quote: beat.quote, speaker: beat.speaker } : {}),
    })),
  };
}

export function sceneNotesJobInput(
  scene: DirectorScene,
  clips: DirectorClip[],
  labels: Map<string, string>,
  notes: string,
): string {
  return [
    `Scene:\n${sceneLine(scene)}`,
    `Clips:\n${JSON.stringify(clips.map((clip) => sceneNotesClip(clip, labels.get(clip.id))), null, 1)}`,
    `DIRECTOR'S NOTES:\n${notes.trim()}`,
  ].join('\n\n');
}

export function reshotBeatJobInput(
  scene: DirectorScene,
  clip: DirectorClip,
  clipLabel: string,
  beatN: number,
): string {
  const beat = clip.beats.find((entry) => entry.n === beatN);
  const neighbours = clip.beats
    .filter((entry) => entry.n !== beatN)
    .map((entry) => `S${entry.n} ${entry.from}–${entry.to} · ${entry.cam || entry.text}`);
  return [
    `Scene:\n${sceneLine(scene)}`,
    `Clip ${clipLabel} (${clip.seconds}s) — ${clip.title}`,
    `THIS SHOT (replace the camera):\n${JSON.stringify({
      n: beat?.n,
      from: beat?.from,
      to: beat?.to,
      dur: beat?.dur,
      text: beat?.text,
      cam: beat?.cam,
      quote: beat?.quote,
      speaker: beat?.speaker,
      fov: beat?.fov ?? clip.fov,
    }, null, 1)}`,
    neighbours.length > 0
      ? `NEIGHBOUR SHOTS (do not copy these setups):\n${neighbours.join('\n')}`
      : 'This is the only shot in the clip.',
    `LOCATION:\n${clip.location || clip.blocking || '(none)'}`,
  ].join('\n\n');
}

export function lookBibleJobInput(show: DirectorShow): string {
  const compiled = compiledLookFromRefs(show);
  const notes = show.lookBible.notes.trim();
  const stills = lookBibleImageUrls(show);
  return [
    compiled || '(no genre, films, or stills yet)',
    stills.length > 0
      ? `MOOD BOARD — ${stills.length} still${stills.length === 1 ? '' : 's'} attached as images. Look at the pixels. Derive palette (60/30/10), lighting, materials, grain, contrast, and production design from what you SEE. Filenames are labels only. Ignore people, logos, letterbox bars, and frozen action.`
      : '',
    notes && notes !== compiled ? `Current look notes (keep useful edits):\n${notes}` : '',
    show.sourceText.trim() ? `Script excerpt:\n${show.sourceText.slice(0, LOOK_SCRIPT_CHARS)}` : '',
  ].filter(Boolean).join('\n\n');
}

export function shotlistDensity(show: DirectorShow): string {
  return shotDensityHint(show.clipLengthSec);
}
