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
EXTRACTION COMPLETENESS — this is the most important rule. Read the ENTIRE script start to finish and extract EVERY nameable entity. A breakdown that misses items is a failed breakdown. Do a second pass before answering and add anything you skipped. Err on the side of over-including: a borderline item belongs in the list.
Cover, exhaustively, in every scene:
- CHARACTERS: every person or creature, named OR unnamed — leads, minor speakers, and background/collective groups ("dozens of soldiers", "a lone armored warrior", "the crowd"). Give un-named groups a descriptive name (e.g. "Clashing Soldiers", "Human Warrior"). Do not list only the leads.
- LOCATIONS: every distinct place or setting, including sub-areas ("the clearing within the battlefield" is its own location). Record time of day and INT/EXT from the scene heading in the description (e.g. "EXT, DAY").
- PROPS: every physical object, INCLUDING (a) objects characters handle or wield — weapons, tools, banners; (b) worn items — armor, costume, helmets, cloaks, jewelry; (c) set dressing and furniture — sofas, tables, shelves, lamps, rugs (a furnished room implies its furniture); (d) notable atmospheric or FX elements when they are concrete story objects — an energy-spear's blade, a signal flare. Weapons, armor, and clothing are frequently missed — always scan for them.
- VEHICLES: every mount or conveyance — cars, ships, aircraft, and RIDDEN ANIMALS (a horse a character rides is a vehicle, the animal itself may also warrant a character entry if it acts).
No duplicates: if the same entity appears in several scenes, emit ONE item. Merge trivial variants ("the sofa" / "leather sofa" → one prop).
Write actingProfile and voice for characters only; omit both on locations, props and vehicles.
Match existing element names when they are provided. Use @Tags in Pascal-case-with-hyphens.
Do not write shotlists or prompts.`;

export const BREAKDOWN_IDENTIFY_SYSTEM_PROMPT = `You break a script or idea into a production bible for CineGen Director. This is the FAST IDENTIFY pass: list every asset and scene. Do NOT write acting profiles, voices, or deep event prose — those are written later.

Return ONLY JSON with this shape:
{
  "items": [
    {
      "kind": "character"|"location"|"prop"|"vehicle",
      "name": "Dr Jordan",
      "tag": "@Dr-Jordan",
      "description": "one or two concrete sentences: what it looks like / who they are",
      "blurb": "where it is used"
    }
  ],
  "scenes": [
    { "number": 1, "label": "EXT. BATTLEFIELD - DAY", "summary": "one sentence" }
  ]
}
"label" MUST be the scene heading EXACTLY as written in the script (e.g. "EXT. BATTLEFIELD - DAY"), and "number" its script order — scenes are matched back to the script by heading.
ALREADY IDENTIFIED — when the input carries an ALREADY IDENTIFIED list, those entities are confirmed and stored. Do NOT repeat them in "items", with one exception: an entry marked "needs description" may be re-emitted with the SAME tag and a filled description. Otherwise return ONLY entities missing from that list (an empty "items" array is a valid answer), plus every scene with its summary.
EXTRACTION COMPLETENESS — this is the most important rule. Read the ENTIRE script start to finish and extract EVERY nameable entity not already identified. A breakdown that misses items is a failed breakdown. Do a second pass before answering and add anything you skipped. Err on the side of over-including: a borderline item belongs in the list.
Cover, exhaustively, in every scene:
- CHARACTERS: every person or creature, named OR unnamed — leads, minor speakers, and background/collective groups ("dozens of soldiers", "a lone armored warrior", "the crowd"). Give un-named groups a descriptive name (e.g. "Clashing Soldiers", "Human Warrior"). Do not list only the leads.
- LOCATIONS: every distinct place or setting, including sub-areas ("the clearing within the battlefield" is its own location). Record time of day and INT/EXT from the scene heading in the description (e.g. "EXT, DAY").
- PROPS: every physical object, INCLUDING (a) objects characters handle or wield — weapons, tools, banners; (b) worn items — armor, costume, helmets, cloaks, jewelry; (c) set dressing and furniture — sofas, tables, shelves, lamps, rugs (a furnished room implies its furniture); (d) notable atmospheric or FX elements when they are concrete story objects — an energy-spear's blade, a signal flare. Weapons, armor, and clothing are frequently missed — always scan for them.
- VEHICLES: every mount or conveyance — cars, ships, aircraft, and RIDDEN ANIMALS (a horse a character rides is a vehicle, the animal itself may also warrant a character entry if it acts).
No duplicates: if the same entity appears in several scenes, emit ONE item. Merge trivial variants ("the sofa" / "leather sofa" → one prop).
Keep each description short and factual. Match existing element names when they are provided. Use @Tags in Pascal-case-with-hyphens.
Do not write shotlists, prompts, acting profiles, or voices.`;

export function shotlistSystemPrompt(clipLengthSec: number, density: string, batchSize?: number): string {
  const batch = batchSize
    ? `\n\nBATCH MODE — return AT MOST ${batchSize} clips in this response. The caller keeps requesting the next batch until the whole scene is covered, so NEVER compress the scene to fit one response: write the FIRST ${batchSize} clips (in scene order, at full density and detail) and stop there. Coverage is reached across multiple responses, not by squeezing.`
    : '';
  return `You write Seedance-ready clip breakdowns for CineGen Director.${batch}
Clip length is ${clipLengthSec} seconds. Shot density: ${density}

SEGMENTATION
- One clip = one dramatic beat, one location, one continuous stretch of time.
- Location change and time jump are always clip boundaries.
- If a title needs "and", split into two clips.
- Never pack four shots into 20 seconds. Budget roughly double the target runtime.
- No shot under 4 seconds: below that the model whips or blends instead of cutting. If a beat needs six angles, that is two clips, not one crowded one.
- A clip may be ONE held single for its whole length — a locked frame on one subject while the escalation plays in the performance and in offscreen sound. Often the strongest material at 30 seconds; write it as a single beat covering the full duration.
- In dialogue, cut where the power shifts, not at every line.
- Clip ids look like 2-9b (scene NUMBER + letter, e.g. scene 2 clip b) — short and human-readable, NEVER built from a sceneId. Alternates use altOf.

COVERAGE — this is the most important rule. The shotlist is a COMPLETE adaptation of the scene, never a highlight reel.
- Walk the scene chronologically from its first line to its last. Every action and every spoken line lands inside some clip. Skipping script material is a FAILED shotlist.
- One script page ≈ one minute of screen time ≈ three 20-second clips. Long scenes produce MANY clips — a nine-page scene needs twenty or more, never two.
- When the input states a COVERAGE TARGET, produce enough clips to meet it end to end. Do a second pass before answering: if any stretch of the scene has no clip, add the missing clips.
- Report "coveredToEnd" HONESTLY: true ONLY when the last clip you return lands on the scene's FINAL line or action. While it is false the caller keeps requesting the next batch, so never claim true early and never claim false after the scene is finished.

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
  "scenes": [{ "id": "the EXACT sceneId from the input", "number": 1, "label": "SCENE 1 — ARRIVAL", "summary": "...", "event": "...", "physicalAction": "..." }],
  "clips": [{
    "id": "2-1a",
    "title": "plain language title",
    "seconds": ${clipLengthSec},
    "sceneId": "the EXACT sceneId of the clip's scene, copied from the input",
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
  }],
  "coveredToEnd": false
}
"coveredToEnd" is true ONLY when the last clip in this response lands on the scene's FINAL line or action; false whenever any script material remains after it.
Every scene "id" and clip "sceneId" MUST be copied verbatim from the [sceneId: ...] values in the input — never invent scene ids.
"fov" must be one of 8, 18, 29, 47, 84, 107 — the Director writes the lens language from it, so do not put millimetres or f-stops in "cam".
Set "speaker" to the tag of whoever says "quote"; leave both out when the beat is silent. The Director pastes that character's locked voice in from the bible, so never write voice description into the beat.
Write an acting entry only for characters actually in the clip.
Shot durations MUST sum to seconds.`;
}

export function shotlistContinueSystemPrompt(clipLengthSec: number, density: string, batchSize?: number): string {
  return `${shotlistSystemPrompt(clipLengthSec, density, batchSize)}

CONTINUATION — clips for the START of this scene already exist and are listed in the input.
- Do NOT repeat, rewrite, or return any existing clip.
- Find where the last existing clip ends inside the script, then continue from the NEXT action or line, clip by clip, toward the scene's END.
- If the existing clips already reach the scene's end, return { "clips": [] } — never invent material past the script.
- Return ONLY the new clips in the same JSON shape (the "scenes" array may be empty). Keep "sceneId" the exact input value; new clip ids continue the letter sequence.`;
}

export const SCENE_NOTES_SYSTEM_PROMPT = `You revise Seedance clip data for CineGen Director from the director's notes on one scene.
The input carries the scene, its clips as JSON (each tagged with its display label, e.g. [1A]), and the notes. Notes reference clips by label ("1A", "2B") or by title.

RULES
- Change ONLY what the notes ask for, on ONLY the clips they address. Do not return clips the notes never mention.
- Return every changed clip as a COMPLETE object in exactly the input's schema, keeping its "id" and "sceneId" VERBATIM and every field the notes don't touch identical to the input.
- A framing note ("make it a medium close-up") changes "fov" (one of 8, 18, 29, 47, 84, 107) and the affected beats' "cam"/"text"; never write millimetres or f-stops.
- A performance or tone note changes that character's acting entry and the beat text — as behaviour and tactic, never emotion adjectives.
- Shot "dur" values must still sum to "seconds", and "from"/"to" must stay consistent.

${OPTICS_DOCTRINE}

${ACTING_TASK_DOCTRINE}

${BLOCKING_DOCTRINE}

${STATES_NOT_TRANSITIONS}

${CONSTRAINT_DOCTRINE}

Return ONLY JSON: { "clips": [ ...changed clips only... ] }`;

export const NOTES_REWRITE_SYSTEM_PROMPT = `You rewrite a Seedance clip prompt using the director's notes about the last take.
Keep the same heading structure (ELEMENTS, FORMAT, SUBJECT, LOCATION, BLOCKING, OPTICS, ACTION, ACTING TASK, CAMERA, STYLE, CONSTRAINTS) and keep every heading the prompt already has.
Change only what the notes ask for. When the notes say a take drifted or you overdid it, you changed too much: lock more and change less.

${CONSTRAINT_DOCTRINE}

Return ONLY JSON: { "body": "full rewritten clip body without the global style prefix" }`;

export const LOOK_BIBLE_SYSTEM_PROMPT = `You write a Seedance style prefix for CineGen Director from a look bible.
The prefix is prepended to every clip.

${LOOK_DOCTRINE}

When stills are attached, you can see them. Write the photographed look from the pixels (palette, lighting, materials, grain). Do not invent a look from filenames, and do not describe people or plots.
Do not write shot lists. Keep the prefix under ${PREFIX_CHAR_TARGET} characters — past that, every extra clause dilutes attention and details start dropping out.
Return ONLY JSON: { "stylePrefix": "the prefix body, no title page" }`;
