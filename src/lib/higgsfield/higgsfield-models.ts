// src/lib/higgsfield/higgsfield-models.ts
//
// Shared (renderer + main) Higgsfield model ids and reference-mode type. Single source of truth so
// both the Electron client and renderer-side routing/UI agree on the real CLI job_set_type ids.

/** Real CLI job_set_type ids (from `higgsfield model list`), keyed by CineGen intent. */
export const HIGGSFIELD_MODELS = {
  seedance: 'seedance_2_0',      // reference-driven video, strong identity, multi-shot
  kling: 'kling3_0',             // multi-shot video (Kling v3.0)
  veo: 'veo3_1',                 // Google Veo 3.1
  soul: 'text2image_soul_v2',    // Higgsfield Soul V2 — portrait / character image
  soulCast: 'soul_cast',         // Soul Cast (video)
  nanoBanana: 'nano_banana_2',   // Nano Banana Pro — top-quality 4K image, text/diagrams
  gptImage: 'gpt_image_2',       // GPT Image 2 — general / design
} as const;

/** How a reference is extracted from a source clip for a generation. */
export type ClipReferenceMode = 'frame' | 'segment' | 'first-last';
