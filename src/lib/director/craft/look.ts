/**
 * Look and palette doctrine distilled from the Lira image-prompt skill, applied
 * to the Director's style prefix — the one block prepended to every clip.
 */

export const POSITIVE_ONLY_DOCTRINE = `POSITIVE, NEVER NEGATIVE — these models have no negative-prompt parameter, and a prose NOT-stack injects the very concept it bans. Describe the state you want instead of the one you don't: "clean dry skin", not "no acne"; "empty deserted street", not "no people"; "plain unbranded wrapper, blank matte surface", not the brand name followed by a ban. The one exception is an edit instruction on an existing frame, where removal is a legal operation and is always paired with what fills the gap.`;

export const PALETTE_DOCTRINE = `PALETTE — state it as a 60/30/10 split with real hues named in words: "60% warm ochre, 30% deep charcoal, 10% rust-red". Derive the split from the director's instructions, the scene, or the uploaded stills — never invent a palette over the references. A stated split holds the colour between clips more reliably than naming a grade does.`;

export const LIGHTING_DOCTRINE = `LIGHTING AND MATERIALS — technical beats atmospheric. "Single overhead key light, soft 2:1 ratio, smooth falloff" beats "dramatic cinematic lighting". Name real materials with their finish — board-formed concrete, oxidised copper verdigris — rather than reaching for mood adjectives.`;

export const PLATFORM_PARAMS_DOCTRINE = `PLATFORM PARAMETERS — aspect ratio and resolution are set in the UI and must never appear inside prompt text. No "--ar", no "16:9", no "4K" in prose. Composition words are fine: "wide panoramic frame", "vertical full-body framing".`;

export const RIGHTS_DOCTRINE = `NO NAMES — never put a real named person, a brand or an IP into a prompt. Translate a reference into descriptive features instead: face, build, energy, era. Film references contribute photographic grammar only — grain, contrast, colour temperature, lens compression, camera height, blocking density — never plots, faces or trademarked wardrobe.`;

export const PROSE_DOCTRINE = `NATURAL PROSE, NOT KEYWORD STACKING — these models parse coherent flowing description. Keyword spam ("4k, masterpiece, trending") does nothing. Precision beats verbosity: past a point every extra clause dilutes attention and details start dropping out.`;

/** The style prefix carries only what must never drift between clips. */
export const PREFIX_SCOPE_DOCTRINE = `WHAT BELONGS IN THE PREFIX — only what must be identical in every clip: film stock and rendering, lighting philosophy, colour discipline, lens character, skin and acting register, physics, frame rate, audio policy. Subject, location, action, framing and shot-specific constraints belong in the clip. If the same sentence is being pasted into every clip body, it belongs here instead.`;

/** Target length for the compiled style prefix, in characters. */
export const PREFIX_CHAR_TARGET = 2000;

export function prefixIsBloated(prefix: string): boolean {
  return prefix.trim().length > PREFIX_CHAR_TARGET;
}

/** Phrases that drag a photoreal look toward concept art. */
export const ILLUSTRATION_TRIGGERS = ['painterly', 'character reference sheet', 'concept art', 'digital painting'] as const;

export function illustrationTriggersIn(text: string): string[] {
  const lower = text.toLowerCase();
  return ILLUSTRATION_TRIGGERS.filter((trigger) => lower.includes(trigger));
}

/** Everything the look-bible job needs to know, in the order it should apply it. */
export const LOOK_DOCTRINE = [
  PREFIX_SCOPE_DOCTRINE,
  PROSE_DOCTRINE,
  POSITIVE_ONLY_DOCTRINE,
  PALETTE_DOCTRINE,
  LIGHTING_DOCTRINE,
  PLATFORM_PARAMS_DOCTRINE,
  RIGHTS_DOCTRINE,
].join('\n\n');
