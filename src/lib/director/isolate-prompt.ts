import type { DirectorBeat, DirectorClip, IsolateMode } from '@/types/director';
import {
  compileActingBlock,
  compileDialogueBlock,
  compileOpticsBlock,
  compileStagingBlock,
  compileVoiceBlock,
  elementTagsLine,
} from './prompt-compiler';

function shotOf(clip: DirectorClip, n: number): DirectorBeat | undefined {
  return clip.beats.find((beat) => beat.n === n);
}

function rankOf(cam: string | undefined): number {
  const c = (cam || '').toLowerCase();
  if (/macro|extreme close/.test(c)) return 4;
  if (/close-?up|tight|85mm|100mm|135mm/.test(c)) return 3;
  if (/wide|24mm|30mm|35mm|establishing/.test(c)) return 1;
  return 2;
}

function scaleOf(cam: string | undefined): string {
  const c = (cam || '').toLowerCase();
  if (/macro|extreme close/.test(c)) return 'a very tight insert-scale framing';
  if (/close-?up|tight/.test(c)) return 'a close framing';
  if (/wide|24mm|30mm|establishing/.test(c)) return 'a wide framing';
  return 'a medium framing';
}

const FRAME = /(establishing|wide|medium|macro|insert|tight|close-?up|profile|reverse|over [^,.]*shoulder|low angle|high angle|overhead|two-shot|same frame|same position|same setup|back to the|split-frame)/i;

function scrub(text: string): string {
  let t = text;
  for (let pass = 0; pass < 2; pass += 1) {
    let match = t.match(/^([^.]{0,95}?)\.\s+(?=[A-Z@])/);
    if (match && FRAME.test(match[1]) && t.length - match[0].length > 40) {
      t = t.slice(match[0].length);
      continue;
    }
    match = t.match(/^([^,.]{0,70}?),\s+/);
    if (match && FRAME.test(match[1]) && t.length - match[0].length > 40) {
      t = t.slice(match[0].length);
      t = t.charAt(0).toUpperCase() + t.slice(1);
      continue;
    }
    break;
  }
  return t.trim();
}

function isoPrefix(prefix: string): string {
  return prefix
    .replace('identical across every cut', 'identical throughout the single continuous take')
    .replace('Technical: 24fps smooth motion.', 'Editing: NONE. This is ONE continuous unbroken take from a single fixed camera — there are no cuts, no shots, no segments and no angle changes anywhere in it. Technical: 24fps smooth motion.');
}

function isoLock(lock: string): string {
  return lock
    .replace(/ in every segment\./g, ' at every moment of the take.')
    .replace(/A segment with them reversed is a FAILED TAKE\./g, 'Any frame with them reversed is a FAILED TAKE.')
    .replace(/A segment with this reversed is a FAILED TAKE\./g, 'Any frame with this reversed is a FAILED TAKE.')
    .replace(/across every cut\./g, 'for the whole take.')
    .replace(/All coverage in every clip stays/g, 'The framing stays')
    .replace(/All coverage stays/g, 'The framing stays');
}

function padSecs(value: number): string {
  return value < 10 ? `0:0${value}` : `0:${value}`;
}

function framingReferenceBlock(tag: string): string {
  return [
    `FRAMING REFERENCE — ${tag} is a COMPOSITION REFERENCE ONLY. It is NOT a first frame, NOT a last frame, NOT a keyframe and NOT a shot to cut to. Nothing in the clip starts on it, ends on it, or matches it exactly.`,
    '- TAKE FROM IT, and only this: camera height relative to the subjects; camera angle and tilt; lens compression and how large the subjects sit in frame; where each figure is placed left to right and how much space is left beside them; headroom; how much of each body is in frame and where the bottom of frame cuts them; the depth relationship between foreground, subject and background.',
    '- IGNORE IN IT, completely: the people and their faces, hair, build and wardrobe; the lighting, exposure, colour and grade; the room, furniture, set dressing and props; the season, time of day and weather; the expressions, poses and whatever action is frozen in it; any text, logo, letterbox bar, watermark or grain in it.',
    `- IDENTITY comes ONLY from the character elements tagged in SUBJECT. Any person visible in ${tag} is a placeholder for framing and must not influence how anyone looks.`,
    `- WORLD comes ONLY from the LOCATION and STYLE blocks in this prompt. If ${tag} disagrees with them about the room, the light or the colour, this prompt wins every time.`,
    `- The subjects MOVE inside that framing and the scene plays normally. ${tag} describes where the camera sits, not a pose to hold or a picture to recreate.`,
  ].join('\n');
}

function applyFramingReference(body: string, tag: string | undefined, isolated: boolean): string {
  if (!tag) return body;
  const normalized = tag.startsWith('@') ? tag : `@${tag}`;
  let out = body;
  const marker = '\n\nACTION —';
  const at = out.indexOf(marker);
  if (at !== -1) {
    out = `${out.slice(0, at)}\n\n${framingReferenceBlock(normalized)}${out.slice(at)}`;
  } else {
    out = `${out}\n\n${framingReferenceBlock(normalized)}`;
  }
  const lead = isolated
    ? `\nCAMERA — MATCH THE FRAMING OF ${normalized} (composition only, as defined above): same camera height, same angle, same subject size in frame, same left-to-right placement, same headroom. Where the description below disagrees with ${normalized} about framing, ${normalized} wins. Then: `
    : `\nCAMERA — ${normalized} is the ANCHOR FRAMING for this clip. Take its camera height, its angle, and its left-to-right placement of the subjects as the geometry every shot below sits inside. The shot SIZES below still stand as written — a wide stays wide and a close-up stays close — but they are all framed from the same position and eye level as ${normalized}. Then: `;
  out = out.replace(/\nCAMERA — /, lead);
  out = out.replace(
    'CONSTRAINTS — 16:9.',
    `CONSTRAINTS — 16:9. ${normalized} is a framing reference ONLY — never a first frame, last frame or freeze, never a face or wardrobe source, never a lighting or set source. Reproducing it as a picture, or letting anyone in it change how the cast looks, is a FAILED TAKE.`,
  );
  return out;
}

export function isolatedPrompt(
  clip: DirectorClip,
  beatN: number,
  mode: IsolateMode,
  options?: { aspectRatio?: string; voices?: Record<string, string> },
): string | null {
  const shot = shotOf(clip, beatN);
  if (!shot) return null;
  const native = mode === 'native';
  const secs = native ? shot.dur : clip.seconds;
  const last = native ? padSecs(shot.dur) : (clip.beats[clip.beats.length - 1]?.to ?? padSecs(secs));
  const aspect = options?.aspectRatio ?? '16:9';

  const subject = clip.subject
    .replace(/MULTISHOT\./, 'SINGLE LOCKED SETUP — one continuous take, no cuts.')
    .replace(/MULTISHOT —/, 'SINGLE LOCKED SETUP —');

  const target = rankOf(shot.cam);
  let beats: string;
  if (native) {
    beats = `THE WHOLE TAKE (0:00–${last}) — ${scrub(shot.text.replace(/\s*Hard cut\.\s*$/i, '').trim())}`;
  } else {
    beats = clip.beats.map((entry, index) => {
      const text = scrub(entry.text.replace(/\s*Hard cut\.\s*$/i, '').trim());
      const delta = rankOf(entry.cam) - target;
      let note = '';
      if (delta >= 2) {
        note = ' [This detail was written for a much tighter framing. At THIS framing it stays small, soft and unemphasised, and may not read at all — that is intended. It is performed, not featured. Do NOT punch in, cut, crop or move the camera to reveal it.]';
      } else if (delta <= -2) {
        note = ' [This was written for a much wider framing. At THIS framing most of it falls OUTSIDE the frame — let it happen off-frame, carried by sound and by what the framing already holds. Do NOT pull out, cut, or widen to include it.]';
      }
      return `BEAT ${index + 1} of the same take (${entry.from}–${entry.to}, camera unchanged, no cut before or after) — ${text}${note}`;
    }).join('\n');
  }

  const action = native
    ? `ACTION — ${clip.intent ?? ''}\nThis is ONE continuous unbroken ${secs}-second take from a single fixed camera. It is a SINGLE MOMENT only — no shots, no segments, no cuts — and it does not continue into whatever follows it in the scene.\n${beats}\nThe action above is the ENTIRE content of this clip. Do not add beats, do not carry the scene past it, and do not compress a longer sequence into ${secs} seconds — play this one moment at natural speed and end there. Any framing or lens word inside it is void and is overridden by the CAMERA block below. Hold one frame to ${last}.`
    : `ACTION — ${clip.intent ?? ''}\nThis is ONE continuous unbroken take from a single fixed camera, running the full ${secs} seconds. It contains NO shots, NO segments and NO cuts. The beats below are moments that happen in front of one unmoving camera, in order, without interruption.\n${beats}\nHOW TO READ THE BEATS: they describe WHAT HAPPENS, never how it is framed. Any framing or lens word surviving inside them is void and is overridden by the CAMERA block below. Several beats were originally written for tighter or wider framings than this one; this take is ${scaleOf(shot.cam)}, so some described detail will be small, soft, partly obscured or entirely outside the frame. THAT IS CORRECT AND INTENDED. Do not punch in, push in, cut, crop, reframe, zoom or change lens to make any detail readable — an unresolvable detail simply plays unresolved, or happens off-frame and is carried by sound and by the performance inside the frame. Hold one frame to ${last}.`;

  let camText = (shot.cam || shot.framing || 'locked camera').replace(/\s{2,}/g, ' ').trim();
  if (!/[.!]$/.test(camText)) camText += '.';

  const camera = `CAMERA — ONE fixed setup for the entire ${secs} seconds, held identically from the first frame to the last: ${camText} This is the ONLY camera position in the prompt. It never changes — no cut, no second angle, no pan, no tilt, no push, no punch-in, no zoom, no dolly, no crane, no drift, no rack focus, no reframe and no crop at any point. If the frame changes at any moment, the take has failed.`;

  const constraintsBase = clip.constraints.trim().startsWith('CONSTRAINTS')
    ? clip.constraints.trim()
    : `CONSTRAINTS — ${aspect}. ${clip.constraints.trim()}`;
  const constraints = constraintsBase.replace(
    /CONSTRAINTS — [^.]+?\./,
    `CONSTRAINTS — ${aspect}. SINGLE UNBROKEN TAKE — one locked framing for the full ${secs} seconds. Any cut, angle change or reframe is a FAILED TAKE.${native ? ` TOTAL RUNTIME IS ${secs} SECONDS — this clip covers ONE moment only and ends there; do not extend it, do not continue the scene, and do not speed anything up to fit more in.` : ''}`,
  );

  const head = `FORMAT — SINGLE UNBROKEN TAKE, ${secs} SECONDS${native ? ' (one beat lifted out of a longer sequence and generated on its own).' : '.'} This prompt is ONE shot: one camera, one framing, one continuous ${secs}-second run with no cuts and no angle changes. Any instruction anywhere below that implies more than one shot is void. Generate a single continuous take.`;

  // A native isolate plays one beat only, so only that beat's speaker gets a voice.
  const voiceScope = native ? { beats: [shot] } : clip;

  const body = [
    head,
    `ELEMENTS — ${elementTagsLine(clip)}`,
    `SUBJECT — ${subject}`,
    `LOCATION — ${clip.location}`,
    compileStagingBlock(clip),
    clip.blocking?.trim() ? `BLOCKING — ${clip.blocking.trim()}` : '',
    compileOpticsBlock(clip),
    action,
    compileActingBlock(clip.acting),
    compileVoiceBlock(voiceScope, options?.voices),
    compileDialogueBlock(voiceScope),
    camera,
    clip.style ? `STYLE — ${clip.style}` : '',
    clip.lock ? isoLock(clip.lock) : '',
    constraints,
  ].filter(Boolean).join('\n\n');

  return withFramingReference(clip, body, true);
}

export function withFramingReference(clip: DirectorClip, body: string, isolated: boolean): string {
  if (!clip.framingRefOn || !clip.framingRefTag) return body;
  return applyFramingReference(body, clip.framingRefTag, isolated);
}

export function rewritePrefixForIsolate(prefix: string): string {
  return isoPrefix(prefix);
}
