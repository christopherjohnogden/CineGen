import type { DirectorBeat, DirectorClip, IsolateMode } from '@/types/director';
import { axisLockLine, grammarLensLine, isolateMoveLock, resolveCameraMove } from './craft/coverage';
import {
  compileActingBlock,
  compileDialogueBlock,
  compileFormatMode,
  compileLocationMap,
  compilePositiveLocksBlock,
  compileReferenceBlock,
  compileSceneContext,
  compileStyleBlock,
  compileVoiceBlock,
  sceneIntent,
  type CompileClipOptions,
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
    `- IDENTITY comes ONLY from the character elements tagged in ACTIVE REFERENCES. Any person visible in ${tag} is a placeholder for framing and must not influence how anyone looks.`,
    `- WORLD comes ONLY from the LOCATION MAP and STYLE blocks in this prompt. If ${tag} disagrees with them about the room, the light or the colour, this prompt wins every time.`,
    `- The subjects MOVE inside that framing and the scene plays normally. ${tag} describes where the camera sits, not a pose to hold or a picture to recreate.`,
  ].join('\n');
}

function applyFramingReference(body: string, tag: string | undefined, isolated: boolean): string {
  if (!tag) return body;
  const normalized = tag.startsWith('@') ? tag : `@${tag}`;
  let out = body;
  const marker = '\n\nSEGMENT 1';
  const at = out.indexOf(marker);
  if (at !== -1) {
    out = `${out.slice(0, at)}\n\n${framingReferenceBlock(normalized)}${out.slice(at)}`;
  } else {
    out = `${out}\n\n${framingReferenceBlock(normalized)}`;
  }
  const lead = isolated
    ? `LENS: MATCH THE FRAMING OF ${normalized} (composition only, as defined above): same camera height, same angle, same subject size in frame, same left-to-right placement, same headroom. Where the description below disagrees with ${normalized} about framing, ${normalized} wins. Then: `
    : `LENS: ${normalized} is the ANCHOR FRAMING for this clip. Take its camera height, its angle, and its left-to-right placement of the subjects as the geometry every shot below sits inside. The shot SIZES below still stand as written — a wide stays wide and a close-up stays close — but they are all framed from the same position and eye level as ${normalized}. Then: `;
  if (/\nLENS: /.test(out)) {
    out = out.replace(/\nLENS: /, `\n${lead}`);
  } else if (/\nCAMERA — /.test(out)) {
    out = out.replace(/\nCAMERA — /, `\nCAMERA — ${lead.replace(/^LENS: /, '')}`);
  } else {
    const styleAt = out.indexOf('\n\nSTYLE\n');
    if (styleAt !== -1) {
      out = `${out.slice(0, styleAt)}\n\n${lead.trim()}${out.slice(styleAt)}`;
    }
  }
  const framingLock = `${normalized} is a framing reference ONLY — never a first frame, last frame or freeze, never a face or wardrobe source, never a lighting or set source. Reproducing it as a picture, or letting anyone in it change how the cast looks, is a FAILED TAKE.`;
  if (out.includes('POSITIVE LOCKS\n')) {
    out = out.replace('POSITIVE LOCKS\n', `POSITIVE LOCKS\n${framingLock}\n`);
  }
  return out;
}

export function isolatedPrompt(
  clip: DirectorClip,
  beatN: number,
  mode: IsolateMode,
  options?: CompileClipOptions & { aspectRatio?: string },
): string | null {
  const shot = shotOf(clip, beatN);
  if (!shot) return null;
  const native = mode === 'native';
  const secs = native ? shot.dur : clip.seconds;
  const last = native ? padSecs(shot.dur) : (clip.beats[clip.beats.length - 1]?.to ?? padSecs(secs));
  const aspect = options?.aspectRatio ?? '16:9';
  const intent = sceneIntent(clip);
  const breakdown = options?.breakdown ?? [];

  const isolatedClip = {
    ...clip,
    subject: clip.subject
      .replace(/MULTISHOT\./, 'SINGLE LOCKED SETUP — one continuous take, no cuts.')
      .replace(/MULTISHOT —/, 'SINGLE LOCKED SETUP —'),
  };

  const target = rankOf(shot.cam);
  let beats: string;
  if (native) {
    beats = scrub(shot.text.replace(/\s*Hard cut\.\s*$/i, '').trim());
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

  let camText = [
    grammarLensLine(shot.grammar),
    (shot.cam || shot.framing || '').replace(/\s{2,}/g, ' ').trim() || (shot.grammar ? '' : 'locked camera'),
  ].filter(Boolean).join('. ');
  if (!camText) camText = 'locked camera';
  if (!/[.!]$/.test(camText)) camText += '.';

  const move = resolveCameraMove({
    beat: shot.grammar,
    clip: options?.cameraMove ?? clip.cameraMove,
  });
  const lens = isolateMoveLock(secs, camText, move);

  const cameraPhrase = move.locked
    ? 'a single locked camera'
    : `a single camera whose only move is: ${move.line}`;
  const intro = native
    ? `${intent ? `${intent}\n` : ''}This is ONE continuous unbroken ${secs}-second take from ${cameraPhrase}. It is a SINGLE MOMENT only — no shots, no cuts — and it does not continue into whatever follows it in the scene.\n${beats}\nThe action above is the ENTIRE content of this clip. Do not add beats, do not carry the scene past it, and do not compress a longer sequence into ${secs} seconds — play this one moment at natural speed and end there. Any framing or lens word inside it is void and is overridden by the LENS line below. Hold one frame to ${last}.`
    : `${intent ? `${intent}\n` : ''}This is ONE continuous unbroken take from ${cameraPhrase}, running the full ${secs} seconds. It contains NO shots and NO cuts. The beats below are moments that happen in front of that camera, in order, without interruption.\n${beats}\nHOW TO READ THE BEATS: they describe WHAT HAPPENS, never how it is framed. Any framing or lens word surviving inside them is void and is overridden by the LENS line below. Several beats were originally written for tighter or wider framings than this one; this take is ${scaleOf(shot.cam)}, so some described detail will be small, soft, partly obscured or entirely outside the frame. THAT IS CORRECT AND INTENDED. Do not punch in, cut, crop, reframe, zoom or change lens to make any detail readable — an unresolvable detail simply plays unresolved, or happens off-frame and is carried by sound and by the performance inside the frame. Hold one frame to ${last}.`;

  const label = native
    ? (shot.cam?.trim().replace(/[.]$/, '') || grammarLensLine(shot.grammar) || 'NATIVE BEAT')
    : (move.locked ? 'LOCKED CONTINUOUS TAKE' : 'CONTINUOUS TAKE');
  const acting = compileActingBlock(
    native
      ? clip.acting?.filter((task) => {
        const tag = task.tag.startsWith('@') ? task.tag : `@${task.tag}`;
        return shot.speaker === task.tag || shot.speaker === tag
          || shot.text.includes(task.tag) || shot.text.includes(tag);
      })
      : clip.acting,
    { event: options?.event },
  );
  const segment = `SEGMENT 1 — ${label} (~0:00–${last})\n${intro}${acting ? `\n${acting}` : ''}\n${lens}`;

  const formatText = `SINGLE UNBROKEN TAKE, ${secs} SECONDS${native ? ' (one beat lifted out of a longer sequence and generated on its own).' : '.'} Single continuous take. Real-time motion. This prompt is ONE shot: one camera, ${move.locked ? 'one framing' : `one move (${move.line})`}, one continuous ${secs}-second run with no cuts${move.locked ? ' and no angle changes' : ' and no other camera move'}. Any instruction anywhere below that implies more than one shot is void. Generate a single continuous take.`;

  const lockLead = move.locked
    ? `${aspect}. SINGLE UNBROKEN TAKE — one locked framing for the full ${secs} seconds. Any cut, angle change or reframe is a FAILED TAKE.${native ? ` TOTAL RUNTIME IS ${secs} SECONDS — this clip covers ONE moment only and ends there; do not extend it, do not continue the scene, and do not speed anything up to fit more in.` : ''}`
    : `${aspect}. SINGLE UNBROKEN TAKE — one setup, one move (${move.line}) for the full ${secs} seconds. Any cut, second angle or other camera move is a FAILED TAKE.${native ? ` TOTAL RUNTIME IS ${secs} SECONDS — this clip covers ONE moment only and ends there.` : ''}`;
  const constraints = clip.constraints.trim().replace(/^CONSTRAINTS\s*—\s*/i, '')
    .replace(new RegExp(`^${aspect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\s*`), '');
  const locks = compilePositiveLocksBlock(
    { constraints, lock: clip.lock },
    { lead: [lockLead, axisLockLine(options?.axis)].filter(Boolean).join(' '), rewriteLock: isoLock },
  );

  const voiceScope = native ? { beats: [shot] } : clip;

  const body = [
    compileSceneContext(isolatedClip, options),
    compileReferenceBlock(clip, breakdown),
    compileLocationMap(clip, options),
    compileFormatMode(clip, { text: formatText }),
    segment,
    compileDialogueBlock(voiceScope, breakdown),
    compileVoiceBlock(voiceScope, options?.voices, breakdown),
    compileStyleBlock(clip),
    locks,
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
