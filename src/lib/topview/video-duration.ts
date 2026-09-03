/**
 * Seedance reads a reference-to-video job as video editing when the prompt asks for a change
 * to the attached clip, and an edit takes its length and aspect ratio from that clip. This is
 * the sentinel the provider requires for that case instead of a real number of seconds.
 */
export const TOPVIEW_INHERITED_VIDEO_DURATION = -1;

/** Every dash the provider has been seen to use, including Unicode minus and en dash. */
const DASH = '[-\\u2010-\\u2015\\u2212]';

/** `Issues: [0] \`duration\` must be -1.` — the exact requirement, wherever it is worded. */
const SENTINEL_DEMAND = new RegExp(
  `duration\`?\\s*(?:must|should)\\s+be\\s*\`?\\s*${DASH}\\s*1\\b`,
  'i',
);

/** The verdict itself, for the day the sentinel is described instead of quoted. */
const VIDEO_EDIT_VERDICT = /task\s+as\s+video\s+editing|duration\s+follows?\s+the\s+input\s+video/i;

/**
 * Seedance decides generation-versus-editing from the prompt and only reports the verdict as
 * a rejection — usually after the task is created, charged, and refunded. Read what it asks
 * for rather than trying to infer editing intent from the prompt text.
 */
export function topviewRequiresInheritedVideoDuration(message: string): boolean {
  if (!/duration/i.test(message)) return false;
  return SENTINEL_DEMAND.test(message) || VIDEO_EDIT_VERDICT.test(message);
}
