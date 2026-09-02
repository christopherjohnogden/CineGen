import type { ModelInputField } from '@/types/workflow';

// Duration, ratio, and resolution ride in the pill row; anything else a model
// exposes gets its own full-width row rather than competing for pill width.
const PILL_CONTROL_IDS = new Set([
  'duration', 'durationSec', 'duration_sec', 'aspect_ratio', 'aspectRatio', 'resolution',
]);

export function isPillControl(field: ModelInputField): boolean {
  return PILL_CONTROL_IDS.has(field.id) && field.fieldType === 'select';
}

const SLIDER_OPTION_THRESHOLD = 8;

/**
 * Numeric options dense enough that a menu stops being scannable — Seedance 2.5
 * offers 27 durations, and a 27-item dropdown is unusable.
 */
export function isSliderControl(field: ModelInputField): boolean {
  const options = field.options ?? [];
  if (options.length <= SLIDER_OPTION_THRESHOLD) return false;
  return options.every((option) => Number.isFinite(Number(option.value)));
}

/** Pills show a unit — a bare "5" or "720" tells the user nothing. */
export function controlOptionLabel(field: ModelInputField, label: string): string {
  const raw = label.trim();
  if (/duration/i.test(field.id) && /^\d+(\.\d+)?$/.test(raw)) return `${raw}s`;
  if (field.id === 'resolution' && /^\d+$/.test(raw)) return `${raw}p`;
  return raw;
}

/** Long provider labels overflow a pill; the pill's own row gives the context. */
export function controlPillLabel(field: ModelInputField): string {
  if (field.id === 'generate_audio' || field.id === 'generateAudio') return 'Audio';
  if (/duration/i.test(field.id)) return 'Duration';
  return field.label;
}
