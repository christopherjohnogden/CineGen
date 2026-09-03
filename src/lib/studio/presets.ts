import type { StudioVideoMode } from '@/lib/studio/video-mode';
import type { ModelDefinition } from '@/types/workflow';

/**
 * A Studio preset is a saved composer recipe — a look, not a shot.
 *
 * It pins the output kind, a model preference, the guidance mode, a short prompt
 * fragment, and control values. It deliberately does NOT carry Elements or frame
 * assets: those are project-scoped ids that would dangle in an app-global store.
 *
 * The name avoids two existing collisions: `SpaceTemplateId` (an LLM-facing
 * layout union) and `WorkflowTemplate` (a saved node graph).
 */
export interface StudioPreset {
  id: string;
  name: string;
  outputKind: 'video' | 'image';
  /** Node types in preference order; the first one available is used. */
  modelPreference: string[];
  /** Appended to the user's prompt at submit. Never replaces it. */
  promptSuffix: string;
  videoMode?: StudioVideoMode;
  controls?: Record<string, string>;
  /** Shipped default — re-seeded if deleted, refreshed when the revision bumps. */
  builtIn?: boolean;
  presetRevision?: number;
}

const PRESETS_STORAGE_KEY = 'cinegen_studio_presets';

/** Bump when built-in preset copy changes so existing installs pick up updates. */
export const BUILTIN_PRESETS_REVISION = 1;

/**
 * `General` exists for both kinds so the shelf is never empty and the hero card
 * always has something true to say. The rest earn their place by being visibly
 * different — a picker with one entry reads as decoration.
 *
 * Suffixes are positive-only and short: they ride on top of a user prompt that
 * still has to fit provider budgets, where style is the first thing dropped.
 */
export const BUILTIN_PRESETS: StudioPreset[] = [
  {
    id: 'builtin-general-video',
    name: 'General',
    outputKind: 'video',
    modelPreference: [],
    promptSuffix: '',
    builtIn: true,
    presetRevision: BUILTIN_PRESETS_REVISION,
  },
  {
    id: 'builtin-general-image',
    name: 'General',
    outputKind: 'image',
    modelPreference: [],
    promptSuffix: '',
    builtIn: true,
    presetRevision: BUILTIN_PRESETS_REVISION,
  },
  {
    id: 'builtin-cinematic',
    name: 'Cinematic',
    outputKind: 'video',
    modelPreference: [],
    promptSuffix: 'Cinematic anamorphic lensing, shallow depth of field, motivated practical light.',
    videoMode: 'references',
    controls: { aspect_ratio: '16:9' },
    builtIn: true,
    presetRevision: BUILTIN_PRESETS_REVISION,
  },
  {
    id: 'builtin-broll',
    name: 'B-roll',
    outputKind: 'video',
    modelPreference: [],
    promptSuffix: 'Handheld observational b-roll, natural light, slight camera drift.',
    videoMode: 'references',
    builtIn: true,
    presetRevision: BUILTIN_PRESETS_REVISION,
  },
  {
    id: 'builtin-product',
    name: 'Product',
    outputKind: 'image',
    modelPreference: [],
    promptSuffix: 'Clean studio product photography, seamless sweep background, soft key with subtle rim.',
    controls: { aspect_ratio: '1:1' },
    builtIn: true,
    presetRevision: BUILTIN_PRESETS_REVISION,
  },
  {
    id: 'builtin-portrait',
    name: 'Portrait',
    outputKind: 'image',
    modelPreference: [],
    promptSuffix: '85mm portrait, natural skin texture, soft window light.',
    controls: { aspect_ratio: '3:4' },
    builtIn: true,
    presetRevision: BUILTIN_PRESETS_REVISION,
  },
];

/** Tolerant per-entry validation: drop malformed rows, never throw on bad JSON. */
export function parseStoredPresets(raw: string | null): StudioPreset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is StudioPreset => (
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as StudioPreset).id === 'string'
      && typeof (entry as StudioPreset).name === 'string'
      && typeof (entry as StudioPreset).promptSuffix === 'string'
      && ((entry as StudioPreset).outputKind === 'video' || (entry as StudioPreset).outputKind === 'image')
    ));
  } catch {
    return [];
  }
}

export function sortPresets(presets: StudioPreset[]): StudioPreset[] {
  return [...presets].sort((left, right) => {
    if (Boolean(left.builtIn) !== Boolean(right.builtIn)) return left.builtIn ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** Re-seed shipped presets the user deleted; refresh built-in copy on a revision bump. */
export function mergeBuiltinPresets(stored: StudioPreset[]): { presets: StudioPreset[]; changed: boolean } {
  const next = [...stored];
  let changed = false;
  for (const builtin of BUILTIN_PRESETS) {
    const index = next.findIndex((preset) => preset.id === builtin.id);
    if (index < 0) {
      next.push({ ...builtin });
      changed = true;
      continue;
    }
    const existing = next[index];
    if (existing.builtIn && (existing.presetRevision ?? 0) < BUILTIN_PRESETS_REVISION) {
      next[index] = { ...existing, ...builtin };
      changed = true;
    }
  }
  return { presets: sortPresets(next), changed };
}

export function loadStudioPresets(): StudioPreset[] {
  if (typeof window === 'undefined') return sortPresets(BUILTIN_PRESETS);
  let stored: StudioPreset[] = [];
  try {
    stored = parseStoredPresets(window.localStorage.getItem(PRESETS_STORAGE_KEY));
  } catch {
    stored = [];
  }
  const { presets, changed } = mergeBuiltinPresets(stored);
  if (changed) saveStudioPresets(presets);
  return presets;
}

export function saveStudioPresets(presets: StudioPreset[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // A full or disabled store must not break generating.
  }
}

/** The first preferred model that is actually available, else the current one. */
export function resolvePresetModel(
  preset: StudioPreset,
  available: Array<{ key: string }>,
  fallback: string,
): string {
  for (const candidate of preset.modelPreference) {
    if (available.some((option) => option.key === candidate)) return candidate;
  }
  return fallback;
}

/**
 * Compose the prompt actually sent. Kept separate from the authored text so a
 * reused generation can restore the user's half without re-appending the suffix.
 */
export function composePresetPrompt(body: string, preset: StudioPreset | undefined): string {
  const suffix = preset?.promptSuffix?.trim();
  if (!suffix) return body;
  if (body.includes(suffix)) return body;
  return `${body.trim()} ${suffix}`.trim();
}

/** Control values a preset supplies that the chosen model actually accepts. */
export function presetControlsFor(
  preset: StudioPreset | undefined,
  model: ModelDefinition | undefined,
): Record<string, string> {
  if (!preset?.controls || !model) return {};
  const accepted: Record<string, string> = {};
  for (const [id, value] of Object.entries(preset.controls)) {
    const field = model.inputs.find((input) => input.id === id);
    if (!field) continue;
    if (field.options && !field.options.some((option) => String(option.value) === value)) continue;
    accepted[id] = value;
  }
  return accepted;
}
