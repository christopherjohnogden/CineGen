import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PRESETS,
  BUILTIN_PRESETS_REVISION,
  composePresetPrompt,
  mergeBuiltinPresets,
  parseStoredPresets,
  presetControlsFor,
  resolvePresetModel,
  type StudioPreset,
} from '@/lib/studio/presets';
import type { ModelDefinition } from '@/types/workflow';

const cinematic = BUILTIN_PRESETS.find((preset) => preset.id === 'builtin-cinematic')!;

describe('studio presets', () => {
  it('re-seeds a deleted built-in and refreshes stale copy on a revision bump', () => {
    const stale: StudioPreset = {
      ...cinematic,
      promptSuffix: 'old wording',
      presetRevision: 0,
    };

    const { presets, changed } = mergeBuiltinPresets([stale]);

    expect(changed).toBe(true);
    expect(presets.find((preset) => preset.id === cinematic.id)?.promptSuffix)
      .toBe(cinematic.promptSuffix);
    // Every shipped preset comes back, including ones the user deleted.
    expect(presets.filter((preset) => preset.builtIn)).toHaveLength(BUILTIN_PRESETS.length);
  });

  it('leaves a user preset alone and never rewrites an up-to-date built-in', () => {
    const mine: StudioPreset = {
      id: 'mine',
      name: 'My look',
      outputKind: 'video',
      modelPreference: [],
      promptSuffix: 'my words',
    };
    const current: StudioPreset = { ...cinematic, presetRevision: BUILTIN_PRESETS_REVISION };

    const { presets } = mergeBuiltinPresets([mine, current]);

    expect(presets.find((preset) => preset.id === 'mine')).toEqual(mine);
    // Built-ins sort ahead of user presets.
    expect(presets[0].builtIn).toBe(true);
  });

  it('drops malformed rows instead of throwing', () => {
    expect(parseStoredPresets('not json')).toEqual([]);
    expect(parseStoredPresets('{"not":"an array"}')).toEqual([]);
    expect(parseStoredPresets(JSON.stringify([
      { id: 'ok', name: 'Fine', outputKind: 'video', promptSuffix: '' },
      { id: 'bad', name: 'No kind', promptSuffix: '' },
      null,
    ]))).toHaveLength(1);
  });

  it('never appends a preset suffix twice', () => {
    const once = composePresetPrompt('A wide shot', cinematic);
    expect(once).toContain(cinematic.promptSuffix);

    // The trap: reusing a generation loads its prompt back into the composer
    // while the preset is still attached. Composing again must be a no-op, or
    // the prompt silently accretes style words on every reuse.
    expect(composePresetPrompt(once, cinematic)).toBe(once);
    expect(composePresetPrompt(once, cinematic).match(/anamorphic/g)).toHaveLength(1);
  });

  it('leaves the prompt untouched for a preset with no suffix', () => {
    const general = BUILTIN_PRESETS.find((preset) => preset.id === 'builtin-general-video')!;
    expect(composePresetPrompt('A wide shot', general)).toBe('A wide shot');
    expect(composePresetPrompt('A wide shot', undefined)).toBe('A wide shot');
  });

  it('only applies control values the chosen model accepts', () => {
    const model = {
      inputs: [{
        id: 'aspect_ratio',
        options: [{ value: '16:9', label: '16:9' }],
      }],
    } as unknown as ModelDefinition;

    expect(presetControlsFor(cinematic, model)).toEqual({ aspect_ratio: '16:9' });
    // A value the model does not offer is dropped rather than sent and rejected.
    const portrait = BUILTIN_PRESETS.find((preset) => preset.id === 'builtin-portrait')!;
    expect(presetControlsFor(portrait, model)).toEqual({});
  });

  it('falls back when a preferred model is unavailable', () => {
    const preset: StudioPreset = { ...cinematic, modelPreference: ['gone', 'here'] };
    expect(resolvePresetModel(preset, [{ key: 'here' }], 'current')).toBe('here');
    expect(resolvePresetModel(preset, [{ key: 'other' }], 'current')).toBe('current');
  });
});
