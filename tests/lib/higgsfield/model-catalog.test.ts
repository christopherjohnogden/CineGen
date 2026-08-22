import { describe, expect, it } from 'vitest';
import {
  HIGGSFIELD_CATALOG,
  HIGGSFIELD_MODEL_REGISTRY,
  HIGGSFIELD_MODEL_SCHEMAS,
  getHiggsfieldSchema,
  pickKnownHiggsfieldParams,
} from '@/lib/higgsfield/model-catalog';

describe('generated Higgsfield model catalog', () => {
  it('captures every model exposed by the authenticated CLI snapshot', () => {
    expect(HIGGSFIELD_CATALOG.cli.version).toBe('0.1.28');
    expect(HIGGSFIELD_MODEL_SCHEMAS).toHaveLength(100);
    expect(new Set(HIGGSFIELD_MODEL_SCHEMAS.map((model) => model.job_set_type)).size).toBe(100);
    expect(HIGGSFIELD_MODEL_SCHEMAS.reduce<Record<string, number>>((counts, model) => {
      counts[model.type] = (counts[model.type] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ '3d': 13, audio: 6, image: 39, text: 1, video: 41 });
  });

  it('preserves exact required/default/enum schema values', () => {
    const seedance = getHiggsfieldSchema('seedance_2_0');
    expect(seedance?.params.find((param) => param.name === 'prompt')).toEqual({
      name: 'prompt', type: 'string', default: null, required: true,
    });
    expect(seedance?.params.find((param) => param.name === 'resolution')).toEqual({
      name: 'resolution',
      type: 'string',
      default: '720p',
      required: false,
      enum: ['480p', '720p', '1080p', '4k'],
    });
    expect(getHiggsfieldSchema('sam_3_3d')?.params.find((param) => param.name === 'medias')?.required).toBe(true);
  });

  it('turns every raw model into one provider node and preserves legacy node ids', () => {
    expect(Object.keys(HIGGSFIELD_MODEL_REGISTRY)).toHaveLength(100);
    expect(HIGGSFIELD_MODEL_REGISTRY['hf-soul-v2']?.id).toBe('text2image_soul_v2');
    expect(HIGGSFIELD_MODEL_REGISTRY['hf-nano-banana-pro']?.id).toBe('nano_banana_2');
    expect(HIGGSFIELD_MODEL_REGISTRY['hf-seedance-2']?.id).toBe('seedance_2_0');
    expect(HIGGSFIELD_MODEL_REGISTRY['hf-sam-3-3d']?.outputType).toBe('model3d');
    expect(HIGGSFIELD_MODEL_REGISTRY['hf-inworld-text-to-speech']?.outputType).toBe('audio');
    expect(HIGGSFIELD_MODEL_REGISTRY['hf-brain-activity']?.outputType).toBe('text');
  });

  it('projects each CLI parameter to a node input without dropping it', () => {
    for (const schema of HIGGSFIELD_MODEL_SCHEMAS) {
      const nodeType = Object.keys(HIGGSFIELD_MODEL_REGISTRY)
        .find((key) => HIGGSFIELD_MODEL_REGISTRY[key].id === schema.job_set_type);
      expect(nodeType, schema.job_set_type).toBeDefined();
      const definition = HIGGSFIELD_MODEL_REGISTRY[nodeType!];
      const projectedParams = new Set(definition.inputs.map((field) => field.falParam));
      const schemaParams = schema.params.map((param) => param.name);
      expect([...projectedParams].filter((name) => schemaParams.includes(name)).sort(), schema.job_set_type)
        .toEqual([...schemaParams].sort());
      expect([...projectedParams].filter((name) => !schemaParams.includes(name)), schema.job_set_type)
        .toEqual(schema.job_set_type === 'seedance_2_5' ? ['medias'] : []);
      for (const param of schema.params) {
        const field = definition.inputs.find((candidate) => candidate.falParam === param.name);
        expect(field?.required, `${schema.job_set_type}.${param.name}`).toBe(param.required);
        expect(field?.default, `${schema.job_set_type}.${param.name}`).toEqual(param.default);
        expect(field?.schemaType, `${schema.job_set_type}.${param.name}`).toBe(param.type);
        if (param.enum) {
          expect(field?.options?.map((option) => option.value), `${schema.job_set_type}.${param.name}`)
            .toEqual(param.enum);
        }
      }
    }
  });

  it('matches the live Seedance 2.5 CLI schema (no genre / multi_shots)', () => {
    const names = getHiggsfieldSchema('seedance_2_5')?.params.map((param) => param.name) ?? [];
    expect(names).toContain('prompt');
    expect(names).toContain('duration');
    expect(names).toContain('mode');
    expect(names).not.toContain('genre');
    expect(names).not.toContain('multi_shots');
    expect(names).not.toContain('multi_prompt');
    expect(pickKnownHiggsfieldParams('seedance_2_5', {
      duration: 6,
      genre: 'noir',
      multi_shots: false,
      generate_audio: true,
    })).toEqual({ duration: 6, generate_audio: true });
    expect(pickKnownHiggsfieldParams('unknown_model', { genre: 'noir' })).toEqual({ genre: 'noir' });
  });

  it('adds a visible combined reference port to Seedance 2.5 workflow nodes', () => {
    const inputs = HIGGSFIELD_MODEL_REGISTRY['hf-seedance-2-5'].inputs;
    expect(inputs.slice(0, 2).map((input) => input.id)).toEqual(['prompt', 'medias']);
    expect(inputs[1]).toMatchObject({
      label: 'References',
      portType: 'media',
      fieldType: 'port',
      multiple: true,
    });

    expect(inputs.find((input) => input.id === 'duration')).toMatchObject({
      fieldType: 'range',
      min: 5,
      max: 30,
      step: 1,
      description: 'Length of the generated clip.',
    });
    expect(inputs.find((input) => input.id === 'mode')?.options).toContainEqual({
      value: 't2v',
      label: 'Auto (recommended)',
    });
    expect(inputs.find((input) => input.id === 'bitrate_mode')).toMatchObject({
      label: 'Quality',
    });
  });
});
