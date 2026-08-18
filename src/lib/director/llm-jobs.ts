import {
  ACTING_AXIOM,
  ACTING_PROFILE_DOCTRINE,
  ACTING_TASK_DOCTRINE,
  BLOCKING_DOCTRINE,
  CONSTRAINT_DOCTRINE,
  CONTEXT_ISOLATION_DOCTRINE,
  ENSEMBLE_DOCTRINE,
  LOOK_DOCTRINE,
  OPTICS_DOCTRINE,
  PHYSICS_DOCTRINE,
  PREFIX_CHAR_TARGET,
  SCENE_EVENT_DOCTRINE,
  STATES_NOT_TRANSITIONS,
  VOICE_DOCTRINE,
} from './craft';

export function extractJsonValue(text: string): unknown {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = (fence ? fence[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('The model did not return JSON.');
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

export const BREAKDOWN_SYSTEM_PROMPT = `You break a script or idea into a production bible for CineGen Director.

${ACTING_AXIOM}

${ACTING_PROFILE_DOCTRINE}

${VOICE_DOCTRINE}

${SCENE_EVENT_DOCTRINE}

Return ONLY JSON with this shape:
{
  "items": [
    {
      "kind": "character"|"location"|"prop"|"vehicle",
      "name": "Dr Jordan",
      "tag": "@Dr-Jordan",
      "description": "...",
      "blurb": "where it is used and what invention it guards against",
      "actingProfile": "characters only — the master profile paragraph",
      "voice": "characters only — the locked voice prompt, in quotes"
    }
  ],
  "scenes": [
    {
      "number": 1,
      "label": "SCENE 1 — ARRIVAL",
      "summary": "one sentence",
      "event": "the single event every character in the scene participates in or mirrors",
      "physicalAction": "the surface activity the event is played through"
    }
  ]
}
Write actingProfile and voice for characters only; omit both on locations, props and vehicles.
Match existing element names when they are provided. Use @Tags in Pascal-case-with-hyphens.
Do not write shotlists or prompts.`;

export function shotlistSystemPrompt(clipLengthSec: number, density: string): string {
  return `You write Seedance-ready clip breakdowns for CineGen Director.
Clip length is ${clipLengthSec} seconds. Shot density: ${density}

SEGMENTATION
- One clip = one dramatic beat, one location, one continuous stretch of time.
- Location change and time jump are always clip boundaries.
- If a title needs "and", split into two clips.
- Never pack four shots into 20 seconds. Budget roughly double the target runtime.
- Clip ids look like 2-9b (scene-index + letter). Alternates use altOf.

${BLOCKING_DOCTRINE}

${OPTICS_DOCTRINE}

${PHYSICS_DOCTRINE}

${ACTING_TASK_DOCTRINE}

${STATES_NOT_TRANSITIONS}

${ENSEMBLE_DOCTRINE}

${CONTEXT_ISOLATION_DOCTRINE}

${CONSTRAINT_DOCTRINE}

Return ONLY JSON:
{
  "stylePrefix": "global look that must not drift between clips",
  "scenes": [{ "id": "scene-1", "number": 1, "label": "SCENE 1 — ARRIVAL", "summary": "...", "event": "...", "physicalAction": "..." }],
  "clips": [{
    "id": "2-1a",
    "title": "plain language title",
    "seconds": ${clipLengthSec},
    "sceneId": "scene-1",
    "elementTags": ["@Dr-Jordan"],
    "subject": "...",
    "location": "...",
    "blocking": "positions, body facing, gaze targets, depth, landmark proximity, first-frame occupancy",
    "fov": 47,
    "intent": "ACTION —",
    "acting": [{
      "tag": "@Dr-Jordan",
      "motive": "why he pushes the scene's shared direction",
      "goal": "his personal fight inside the scene",
      "obstacle": "what presses against the line and what one crack costs",
      "tactic": "verbs aimed at the partner, with the eye-work as purposeful action",
      "moments": ["\\"dialogue words\\" — verb at the partner + what the eyes check"]
    }],
    "style": "Dominant ... 60% / Secondary ... 30% / Accent ... 10%.",
    "constraints": "CONSTRAINTS — TOTAL RUNTIME ${clipLengthSec} SECONDS. ..."
    ,
    "beats": [
      { "n": 1, "from": "0:00", "to": "0:07", "dur": 7, "text": "what happens, in direct visual verbs", "cam": "camera behaviour and framing", "quote": "the spoken line, or empty", "speaker": "@Dr-Jordan" }
    ]
  }]
}
"fov" must be one of 8, 18, 29, 47, 84, 107 — the Director writes the lens language from it, so do not put millimetres or f-stops in "cam".
Set "speaker" to the tag of whoever says "quote"; leave both out when the beat is silent. The Director pastes that character's locked voice in from the bible, so never write voice description into the beat.
Write an acting entry only for characters actually in the clip.
Shot durations MUST sum to seconds.`;
}

export const NOTES_REWRITE_SYSTEM_PROMPT = `You rewrite a Seedance clip prompt using the director's notes about the last take.
Keep the same heading structure (ELEMENTS, FORMAT, SUBJECT, LOCATION, BLOCKING, OPTICS, ACTION, ACTING TASK, CAMERA, STYLE, CONSTRAINTS) and keep every heading the prompt already has.
Change only what the notes ask for. When the notes say a take drifted or you overdid it, you changed too much: lock more and change less.

${CONSTRAINT_DOCTRINE}

Return ONLY JSON: { "body": "full rewritten clip body without the global style prefix" }`;

export const LOOK_BIBLE_SYSTEM_PROMPT = `You write a Seedance style prefix for CineGen Director from a look bible.
The prefix is prepended to every clip.

${LOOK_DOCTRINE}

Do not write shot lists. Keep the prefix under ${PREFIX_CHAR_TARGET} characters — past that, every extra clause dilutes attention and details start dropping out.
Return ONLY JSON: { "stylePrefix": "the prefix body, no title page" }`;
