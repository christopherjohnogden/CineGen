/**
 * How a video generation is guided. `frames` pins the first and last image,
 * `references` keeps characters and props consistent, and `edit` changes a clip
 * the user supplies — which is a different job to the provider, not a variation
 * on generation: an edit takes its length and framing from that clip.
 *
 * Shared so the composer, the draft it restores from, and the recipe read back
 * off a node can never disagree about what the modes are.
 */
export type StudioVideoMode = 'frames' | 'references' | 'edit';

const MODES: readonly string[] = ['frames', 'references', 'edit'];

/** Reads a stored mode, falling back when it is missing or from an older build. */
export function parseStudioVideoMode(value: unknown, fallback: StudioVideoMode): StudioVideoMode {
  return typeof value === 'string' && MODES.includes(value) ? (value as StudioVideoMode) : fallback;
}
