import { describe, expect, it } from 'vitest';
import {
  buildTopviewModelRegistry,
  topviewRequestedModel,
  type TopviewGenerationCatalog,
} from '@/lib/topview/model-catalog';

const catalog: TopviewGenerationCatalog = {
  configs: [
    {
      outputType: 'image',
      taskType: 'text_to_image',
      config: [{ result: { models: [{
        displayName: 'GPT Image 2',
        submitModel: 'gpt-image-2-submit-value',
        defaultSubmitParameters: { aspectRatio: '1:1', resolution: '1K', quality: 'medium' },
        submitParameterOptions: {
          aspectRatio: ['1:1', '16:9'],
          resolution: ['1K', '2K'],
          quality: ['low', 'medium', 'high'],
        },
      }] } }],
    },
    {
      outputType: 'video',
      taskType: 'text_to_video',
      config: [{ result: { models: [{
        displayName: 'Seedance 2.5',
        submitModel: 'Seedance 2.5',
        nativeAudio: true,
        defaultSubmitParameters: { aspectRatio: '16:9', resolution: '720p', duration: 20, sound: 'on' },
        submitParameterOptions: {
          aspectRatio: ['16:9', '9:16'],
          resolution: ['720p', '1080p'],
          duration: [4, 10, 20, 30],
          sound: ['on', 'off'],
        },
      }] } }],
    },
    {
      outputType: 'video',
      taskType: 'image_to_video',
      config: [{ result: { models: [{ displayName: 'Seedance 2.5', submitModel: 'Seedance 2.5' }] } }],
    },
    {
      outputType: 'video',
      taskType: 'omni_reference',
      config: [{ result: { models: [{ displayName: 'Seedance 2.5', submitModel: 'Seedance 2.5' }] } }],
    },
    {
      outputType: 'audio',
      taskType: 'music',
      catalogType: 'music',
      config: [{ result: { models: [{ displayName: 'Topview Music', submitModel: 'Topview Music' }] } }],
    },
    {
      outputType: 'audio',
      taskType: 'voice',
      catalogType: 'voice',
      config: [{ result: { models: [{ displayName: 'Qwen3 TTS', submitModel: 'Qwen3 TTS' }] } }],
    },
    {
      outputType: 'audio',
      taskType: 'audio',
      catalogType: 'audio',
      config: [{ result: { models: [{ displayName: 'Seed Audio 1.0', submitModel: 'Seed Audio 1.0' }] } }],
    },
  ],
};

describe('Topview live model catalog', () => {
  it('creates one selectable node per image and video model', () => {
    const registry = buildTopviewModelRegistry(catalog);

    expect(registry['topview-image-gpt-image-2']?.name).toBe('GPT Image 2');
    expect(registry['topview-video-seedance-2-5']?.name).toBe('Seedance 2.5');
    expect(registry['topview-video-seedance-2-5']?.inputs.find((field) => field.id === 'duration')?.options)
      .toEqual([
        { value: '4', label: '4' },
        { value: '10', label: '10' },
        { value: '20', label: '20' },
        { value: '30', label: '30' },
      ]);
    expect(registry['topview-video-seedance-2-5']?.inputs.some((field) => field.id === 'generate_audio')).toBe(true);
    expect(registry['topview-video-seedance-2-5']?.inputs.find((field) => field.id === 'image_url')).toMatchObject({
      label: 'References',
      falParam: 'reference_images',
      multiple: true,
      mediaRole: 'image',
    });
    expect(registry['topview-video-seedance-2-5']?.inputs.find((field) => field.id === 'start_frame')).toMatchObject({
      label: 'Start Frame',
      falParam: 'image_url',
      mediaRole: 'start_image',
    });
    expect(registry['topview-video-seedance-2-5']?.inputs.find((field) => field.id === 'end_frame')).toMatchObject({
      label: 'End Frame',
      falParam: 'end_frame_url',
      mediaRole: 'end_image',
    });
    expect(registry['topview-audio-topview-music']?.category).toBe('audio');
    expect(registry['topview-audio-qwen3-tts']?.inputs.some((field) => field.id === 'voice_id')).toBe(true);
    expect(registry['topview-audio-seed-audio-1-0']?.inputs.find((field) => field.id === 'reference_audio')?.required).toBe(true);
  });

  it('omits controls a live model does not advertise', () => {
    // Gemini Omni Flash has no duration. Offering one anyway sent a parameter Topview
    // refuses, which cost a submitted render for every fixed-length model.
    const registry = buildTopviewModelRegistry({
      configs: [{
        outputType: 'video',
        taskType: 'omni_reference',
        config: [{ result: { models: [{
          displayName: 'Gemini Omni Flash',
          submitModel: 'gemini-omni-flash-ext',
          requiredSubmitFields: ['taskType', 'model', 'prompt', 'resolution', 'aspectRatio'],
          defaultSubmitParameters: { aspectRatio: '16:9', resolution: 720 },
          submitParameterOptions: { aspectRatio: ['9:16', '16:9'], resolution: [720] },
        }] } }],
      }],
    });
    const model = registry['topview-video-gemini-omni-flash'];

    expect(model).toBeDefined();
    expect(model.inputs.map((field) => field.id)).not.toContain('duration');
    expect(model.inputs.map((field) => field.id)).toEqual(
      expect.arrayContaining(['prompt', 'aspect_ratio', 'resolution']),
    );
  });

  it('keeps the generic controls when no live catalog is available', () => {
    const fallback = buildTopviewModelRegistry(null);
    const seedance = fallback['topview-video-seedance-2-5'];

    expect(seedance.inputs.map((field) => field.id)).toEqual(
      expect.arrayContaining(['duration', 'aspect_ratio', 'resolution']),
    );
  });

  it('submits the actual selected Topview model name', () => {
    const registry = buildTopviewModelRegistry(catalog);
    expect(topviewRequestedModel(registry['topview-image-gpt-image-2'])).toBe('gpt-image-2-submit-value');
    expect(topviewRequestedModel(registry['topview-video-seedance-2-5'])).toBe('Seedance 2.5');
  });
});
