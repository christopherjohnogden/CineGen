/**
 * Spatial, physical and constraint doctrine distilled from CINEDANCE V4
 * (references/blocking.md, references/physics-lighting.md) and the
 * shotlist-builder prompt-craft notes.
 *
 * These strings are prompt payload for the Director LLM jobs, not for the video
 * model — the jobs read them and write the per-clip locks that ship.
 */

export const BLOCKING_DOCTRINE = `SPATIAL BLOCKING — write a "blocking" line for every clip with more than one subject, every dialogue clip, and every clip whose geography can flip.
- Give each subject a screen position, a body facing direction, a gaze target, and a foreground / midground / background placement. Body direction and eye direction are separate; write both.
- Anchor characters to landmarks physically. "Within 1 meter of the burned-out car, one hand on the scorched hood" works; "near the car", "beside him", "around the yard", "nearby" do not.
- If the shot must open on the characters, say so: the first visible frame already contains them in position, with no empty establishing frame and no delayed reveal.
- Across the cuts inside one clip, preserve the active cast, the geography, screen direction, gaze targets, lighting direction, wardrobe, wounds, prop and hand states. Nobody teleports and no action resets after a cut.
- Cut types are explicit and hard: HARD CUT, SMASH CUT, MATCH CUT, INSERT CUT, REVERSE CUT, WHIP CUT. No fades, crossfades or dissolves.`;

export const PHYSICS_DOCTRINE = `PHYSICS AND LIGHTING — treat both as constraints, not as decoration. Put whatever is constant for the whole show in the style prefix and only what changes per shot in the clip.
- Motion has cause and effect: weight transfer, inertia, friction, follow-through, cloth and hair delay. Walking has heel contact and toe push-off. Running has real ground contact, knee lift and torso lean. A carried prop shows its weight in the wrist and the arm.
- Liquids cling, drip, smear, pool and follow gravity. Particles travel with the wind and accumulate over time. Heat shimmers where hot air meets cold.
- Name the primary light source, its direction, which side the camera sits on, which side of the subject falls into shadow, and what the frame is exposed for.
- Backlit work: the camera stays on the shadow side, faces fall into shadow, rim light and speculars carry the image, and the exposure is priced for the backlight rather than the face.`;

/**
 * CINEDANCE dialogue/audio rules, compiled verbatim into any clip that carries
 * a spoken line. Deterministic — the LLM never has to remember to write it.
 */
export const DIALOGUE_DISCIPLINE = `DIALOGUE — Only the quoted scripted lines are spoken: no extra words, no ad-libs, no narration, no offscreen voices, no subtitles, no captions. Lips move only for the scripted line; whoever is not speaking listens in silence and says nothing. Each line lands inside its shot's time window. Ambient sound ducks under dialogue; the voice is close, clean and emotionally controlled.`;

export const CONTEXT_ISOLATION_DOCTRINE = `CONTEXT ISOLATION — each clip body is a sealed document describing one shot. Never carry in scene numbers, script headers, previous-scene summaries, production notes, a character or prop that is not visible in this exact shot, or the phrases "same as before", "continues from", "previously" and "as above". If a prior line matters only for emotional continuity, mark it as prior audio context and do not visualise anything from it.`;

export const CONSTRAINT_DOCTRINE = `CONSTRAINTS — name the failure you actually expect from THIS shot rather than working through a checklist; a constraint that did not come from something going wrong is filler. Write the wanted state positively first, then the failure it guards against, placed next to the rule it protects. The failures worth naming most often: it adds a cut; it moves a camera that should be locked (list the banned moves — no push, pan, drift, rack focus or reframe); it invents an untagged prop; it relocates a named object; it flips who is frame-left and who is frame-right; it goes slow-motion; it adds a person, a shadow or a reflection that should not be there.`;

/** Prepend the positive form of a lock and keep the failure clause local to it. */
export function firstFrameLock(subjects: string): string {
  return `The first visible frame already contains ${subjects} in their correct positions, with the spatial relationship readable immediately. No empty establishing frame, no delayed character reveal.`;
}

/**
 * A landmark anchor written the way the skill demands: contact stated, weak
 * proximity words absent.
 */
export function landmarkAnchor(subject: string, distanceMeters: number, landmark: string, contact: string): string {
  return `${subject} stands within ${distanceMeters} meter${distanceMeters === 1 ? '' : 's'} of ${landmark}, ${contact}.`;
}

/** Weak spatial words the blocking line should never contain. */
export const WEAK_SPATIAL_WORDS = ['near', 'around', 'beside', 'somewhere', 'nearby', 'in the area'] as const;

export function weakSpatialWordsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return WEAK_SPATIAL_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(lower));
}
