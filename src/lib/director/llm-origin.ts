import type { DirectorBeat, DirectorClip, DirectorClipLlmOrigin } from '@/types/director';

export function captureClipLlmOrigin(clip: DirectorClip): DirectorClipLlmOrigin {
  return {
    title: clip.title,
    subject: clip.subject,
    location: clip.location,
    intent: clip.intent,
    camera: clip.camera,
    style: clip.style,
    constraints: clip.constraints,
    lock: clip.lock,
    blocking: clip.blocking,
    fov: clip.fov,
    cameraMove: clip.cameraMove ? { ...clip.cameraMove } : undefined,
    acting: clip.acting ? structuredClone(clip.acting) : undefined,
    beats: clip.beats.map((beat) => structuredClone(beat)),
  };
}

export function ensureClipLlmOrigin(clip: DirectorClip): DirectorClip {
  return clip.llmOrigin ? clip : { ...clip, llmOrigin: captureClipLlmOrigin(clip) };
}

export function preserveClipLlmOrigin(existing: DirectorClip, next: DirectorClip): DirectorClip {
  return {
    ...next,
    llmOrigin: existing.llmOrigin ?? captureClipLlmOrigin(existing),
  };
}

function comparableOrigin(origin: DirectorClipLlmOrigin): unknown {
  return {
    title: origin.title,
    subject: origin.subject,
    location: origin.location,
    intent: origin.intent ?? '',
    camera: origin.camera ?? '',
    style: origin.style,
    constraints: origin.constraints,
    lock: origin.lock ?? '',
    blocking: origin.blocking ?? '',
    fov: origin.fov ?? null,
    cameraMove: origin.cameraMove ?? null,
    acting: origin.acting ?? [],
    beats: origin.beats.map((beat) => ({
      n: beat.n,
      from: beat.from,
      to: beat.to,
      dur: beat.dur,
      text: beat.text,
      cam: beat.cam ?? '',
      quote: beat.quote ?? '',
      speaker: beat.speaker ?? '',
      grammar: beat.grammar ?? null,
      fov: beat.fov ?? null,
    })),
  };
}

export function clipIsDirtyFromLlmOrigin(clip: DirectorClip): boolean {
  if (!clip.llmOrigin) return false;
  return JSON.stringify(comparableOrigin(captureClipLlmOrigin(clip)))
    !== JSON.stringify(comparableOrigin(clip.llmOrigin));
}

export function beatIsDirtyFromLlmOrigin(clip: DirectorClip, beatN: number): boolean {
  const current = clip.beats.find((beat) => beat.n === beatN);
  const origin = clip.llmOrigin?.beats.find((beat) => beat.n === beatN);
  if (!current || !origin) return false;
  return current.text !== origin.text
    || (current.cam ?? '') !== (origin.cam ?? '')
    || (current.quote ?? '') !== (origin.quote ?? '')
    || (current.speaker ?? '') !== (origin.speaker ?? '')
    || (current.fov ?? null) !== (origin.fov ?? null)
    || JSON.stringify(current.grammar ?? null) !== JSON.stringify(origin.grammar ?? null);
}

export function resetClipToLlmOrigin(clip: DirectorClip): DirectorClip {
  const origin = clip.llmOrigin;
  if (!origin) return clip;
  return {
    ...clip,
    title: origin.title,
    subject: origin.subject,
    location: origin.location,
    intent: origin.intent,
    camera: origin.camera,
    style: origin.style,
    constraints: origin.constraints,
    lock: origin.lock,
    blocking: origin.blocking,
    fov: origin.fov,
    cameraMove: origin.cameraMove ? { ...origin.cameraMove } : undefined,
    acting: origin.acting ? structuredClone(origin.acting) : undefined,
    beats: origin.beats.map((beat) => structuredClone(beat)),
    bodyEdits: {},
    pendingRewrite: undefined,
    activeVariant: { kind: 'full' },
    llmOrigin: origin,
  };
}

export function resetClipBeatToLlmOrigin(clip: DirectorClip, beatN: number): DirectorClip {
  const originBeat = clip.llmOrigin?.beats.find((beat) => beat.n === beatN);
  if (!originBeat) return clip;
  return {
    ...clip,
    bodyEdits: {},
    beats: clip.beats.map((beat) => (beat.n === beatN ? restoreBeatContent(beat, originBeat) : beat)),
  };
}

export function resetSceneClipsToLlmOrigin(clips: DirectorClip[], sceneId: string): DirectorClip[] {
  return clips.map((clip) => (clip.sceneId === sceneId ? resetClipToLlmOrigin(clip) : clip));
}

export function sceneIsDirtyFromLlmOrigin(clips: DirectorClip[], sceneId: string): boolean {
  return clips.some((clip) => clip.sceneId === sceneId && clipIsDirtyFromLlmOrigin(clip));
}

function restoreBeatContent(current: DirectorBeat, origin: DirectorBeat): DirectorBeat {
  return {
    ...current,
    text: origin.text,
    cam: origin.cam,
    quote: origin.quote,
    speaker: origin.speaker,
    grammar: origin.grammar ? structuredClone(origin.grammar) : undefined,
    fov: origin.fov,
    framing: origin.framing,
    gist: origin.gist,
    origin: origin.origin ? structuredClone(origin.origin) : current.origin,
  };
}
