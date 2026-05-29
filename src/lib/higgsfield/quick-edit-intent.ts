// src/lib/higgsfield/quick-edit-intent.ts
//
// Phase 3 — pure intent routing for the Clip Quick Edit modal. Maps a free-text edit prompt to a
// Higgsfield model + the reference media to extract from the source clip + a default placement.
// Rules-first (deterministic, unit-tested); an optional LLM classifier can refine later.

import { HIGGSFIELD_MODELS } from './higgsfield-models';
import type { ClipReferenceMode } from './higgsfield-models';

export type QuickEditIntent = 'clean-plate' | 'object-change' | 'extend' | 'stylize' | 'ambiguous';

export interface QuickEditRoute {
  intent: QuickEditIntent;
  /** Higgsfield CLI job_set_type id. */
  model: string;
  outputType: 'image' | 'video';
  /** What to extract from the source clip as a reference. */
  referenceMode: ClipReferenceMode;
  /** Default timeline placement for this kind of edit. */
  placement: 'insert_after' | 'overlay' | 'replace';
  reason: string;
}

interface Rule {
  intent: QuickEditIntent;
  patterns: RegExp[];
}

// Order matters: more specific intents first.
const RULES: Rule[] = [
  { intent: 'clean-plate', patterns: [/clean ?plate/i, /remove (the )?background/i, /empty (the )?(room|scene|shot)/i, /erase the (background|people|person)/i] },
  { intent: 'extend', patterns: [/\bextend\b/i, /\bcontinue\b/i, /more of (this|the)/i, /keep (it )?going/i, /(\d+)\s*(more )?seconds/i] },
  { intent: 'object-change', patterns: [/\b(black|red|blue|green|white) (suit|shirt|dress|jacket|coat)/i, /change (the )?(clothes|outfit|wardrobe|shirt|jacket)/i, /replace .+ with/i, /remove the (logo|sign|text|watermark)/i, /give (him|her|them) (a|an)/i, /make (him|her|them) wear/i] },
  { intent: 'stylize', patterns: [/stylize/i, /make it look like/i, /in the style of/i, /turn (it|this) into/i, /\b(cinematic|vintage|noir|anime|painterly) (look|style|grade)/i] },
];

/**
 * Route an edit prompt to a Higgsfield model + reference + placement. Pure.
 * - clean-plate   → image edit on a single frame, placed as an overlay (track above)
 * - object-change → video edit using a clip segment, inserted after
 * - extend        → video continuation from the last frame, inserted after
 * - stylize       → image stylization of a frame, inserted after
 * - ambiguous     → reference-driven video (Seedance) using a clip segment, inserted after
 */
export function routeQuickEdit(prompt: string): QuickEditRoute {
  const text = prompt.trim();

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return buildRoute(rule.intent);
    }
  }
  return buildRoute('ambiguous');
}

function buildRoute(intent: QuickEditIntent): QuickEditRoute {
  switch (intent) {
    case 'clean-plate':
      return { intent, model: HIGGSFIELD_MODELS.nanoBanana, outputType: 'image', referenceMode: 'frame', placement: 'overlay', reason: 'background/clean-plate edit on a single frame' };
    case 'object-change':
      // A still frame is the reference image the video model starts from (image roles take images).
      return { intent, model: HIGGSFIELD_MODELS.seedance, outputType: 'video', referenceMode: 'frame', placement: 'insert_after', reason: 'wardrobe/object change via reference-driven video' };
    case 'extend':
      return { intent, model: HIGGSFIELD_MODELS.seedance, outputType: 'video', referenceMode: 'first-last', placement: 'insert_after', reason: 'continuation from the clip\'s last frame' };
    case 'stylize':
      return { intent, model: HIGGSFIELD_MODELS.nanoBanana, outputType: 'image', referenceMode: 'frame', placement: 'insert_after', reason: 'style change on a representative frame' };
    case 'ambiguous':
    default:
      return { intent: 'ambiguous', model: HIGGSFIELD_MODELS.seedance, outputType: 'video', referenceMode: 'frame', placement: 'insert_after', reason: 'general reference-driven video edit' };
  }
}
