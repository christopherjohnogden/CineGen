/**
 * Performance doctrine distilled from the ACTING SYSTEM document and Tigran's
 * acting-task method (tig-acting-task).
 *
 * Two layers, deliberately separate:
 *  - the master profile, written once per character and adapted per scene;
 *  - the acting task, derived per scene from the scene's single shared event.
 */

export const ACTING_AXIOM = 'Acting is behaviour under pressure, never a display of emotion. A character wants something, something is in the way, and they act to get it — the feeling is the byproduct.';

export const ACTING_PROFILE_DOCTRINE = `CHARACTER ACTING PROFILE — one per character, one flowing paragraph of 150 to 220 words, in English, entirely observable and filmable. Block order is fixed:
Character acting as [NAME]. [Age, build, physique, posture — the body as a document of their biography]. [The psychological engine in one clause]. Vocal profile: [pitch and timbre, origin, pace and delivery, how the voice shifts under pressure]. Key physical habits and tics: [signature tic with its trigger; stress tic with its trigger; what they do to hide what they feel; the facial mask and the exact condition under which it cracks]. Eye life: [gaze targeting and scanning habit, blink quality, whether the eyes lead the head]. Walking style: [a named gait in quotes, then its weight, step, torso and arms]. However, when [trigger], [how posture, gait and face change]. [One softening target — a single person, animal or object the face genuinely softens for.]
Rules:
- Only observable behaviour. Never "he is nervous" — write the trembling lower lip, the heavy swallow, the long inhale and sharp exhale.
- Every tic carries a trigger. A tic without one is decoration; a tic with one is dramaturgy.
- Name the gait in quotes so the biomechanics have a handle: an "old boxer's walk", a "gallery walk", a "battering-ram stride".
- Every profile carries at least one "However, when X —" clause. The mask and its crack are the most cinematic thing in the paragraph.
- No wardrobe, no camera, no colour, no lighting. Those live in the look and the clip; the profile has to survive a costume change.
- The physique carries the biography: profession, past injuries and self-image must be readable in the body.`;

export const VOICE_DOCTRINE = `VOICE — one locked prompt per character, one or two sentences, never adapted per scene. It is pasted verbatim wherever the character speaks and omitted entirely when they are silent.
Formula: "A [age]-year-old [origin or accent descriptor]. [Timbre and register]; [pace and delivery manner]; [emotional character, and how it shifts under pressure]."
The vocal profile inside the acting paragraph describes how speech behaves dramatically; this locks the sound itself. The two must agree.`;

export const SCENE_EVENT_DOCTRINE = `SCENE EVENT — before directing anyone, read the whole scene and name its event.
- The scene has ONE goal: a single direction every character plays toward, usually unspoken. It belongs to all of them at once.
- Read the scene backward from how it ENDS. The last line or beat is the key; watch for a last line that is spoken about one thing and meant about another.
- The event must contain EVERY character in the scene, including the silent and the unconscious ones, as participants or mirrors of the same process. If anyone stands outside the named event, the event is named wrong.
- The event is never the film's theme or its reveal. Characters never play the film's purposes; those are accomplished through them as a byproduct.
- Name the PHYSICAL ACTION separately — the surface activity the scene runs on ("routine rounds", "packing a suitcase"). It is the terrain, not the event, and every character pursues the event through their own visible channel inside it.`;

export const ACTING_TASK_DOCTRINE = `ACTING TASK — one per character present in the clip, derived from the scene event. Never paste the master profile; rewrite it into this moment, keeping identity, vocal profile, signature tics and eye life constant.
- MOTIVE: why THIS character pushes the shared direction. Same vector, different fuel — that is what makes each performance distinct while the scene reads unified. Given circumstances constrain it: a man already compromised cannot play moral innocence.
- GOAL: what this person is fighting for inside the scene. Ordinary, personal, playable, never the scene goal's words and never the theme.
- OBSTACLE: what presses against the line, and what one crack would cost. The audience feels this precisely because nobody plays it — everyone plays keeping it out.
- TACTIC: the invested, moment-to-moment pursuit, written as verbs aimed at the partner with the eye-work named as purposeful action — checking both of the partner's eyes for a sparkle of trust, registering whether a point landed, stealing looks and snapping back before being caught, measuring and memorising.
- MOMENTS: key beats keyed to the actual dialogue words, including the point where a character's fuel runs out and the line breaks.
Never write emotion adjectives as direction ("sadly", "nervously") and never write facial choreography ("brows lift", "mouth trembles"). A silent listener still gets a real task: decide if he's serious, wait for the punchline, protect the mood.
A two-character clip is richer built on mirrored contrast: each character carries one plus and one minus inverted against the partner, with one essential axis the audience actually reads. The seeming trait is usually scar tissue over its opposite — "careless" means hope lost, not care absent.`;

/**
 * The one externally-described line the method allows, because the video model
 * needs it: without it the gaze freezes even when the task is written well.
 */
export const EYE_LIFE_SAFETY = 'Gaze stays engaged in the task at every moment — never a frozen, glassy or unfocused stare; natural blink cadence, with the eyes reaching a target a beat before the head turns.';

export const STATES_NOT_TRANSITIONS = 'STATES, NOT TRANSITIONS — video models fail transitions and land states. Write characters already in the action state (mid-throw, mid-pace, mid-argument), never the process of getting there. Chain states beat by beat instead of narrating a continuous process.';

/** Bad-acting symptoms worth catching before a clip ships. */
export const ACTING_FAILURES = [
  'Indication — the face depicts the emotion instead of pursuing the objective.',
  'Playing the result — the character plays the scene\'s outcome from the first second.',
  'Waiting for the cue — an empty face while the partner speaks; reactions must start mid-line.',
  'Monotactics — one colour for the whole clip instead of a new tactic per beat.',
  'Gesture illustration — the gesture duplicates the word.',
  'Free emotion — tears or rage with no build-up and no trigger.',
  'Synchronised ensemble — everyone reacts identically and at once instead of in a wave.',
  'Dead pauses — silence in which nothing is assessed or decided.',
  'Emotional reset — the character recovers instantly instead of carrying the state forward.',
  'Dead eyes — a frozen stare with no saccades and glassy catchlights.',
] as const;

export const ENSEMBLE_DOCTRINE = `ENSEMBLE — group reactions travel in a wave, never in sync: one person gets it first, the second half a beat later, the third not at all. The reaction is worth more than the action, so after any event the most valuable frame is the face of whoever saw it. The strong are still and quiet; the weak fidget and shout. Threat arrives without a wind-up. If a character is worn down across the show, carry it cumulatively and never reset it between clips.`;
