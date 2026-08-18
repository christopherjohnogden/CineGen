import { describe, expect, it } from 'vitest';
import {
  buildCreateArgs,
  parseGenerateJson,
  extractMediaUrl,
  extractMediaUrls,
  extractTextOutput,
  parseConnectionState,
} from '../../../electron/ipc/higgsfield';
import {
  buildHiggsfieldWorkflowRequest,
  normalizeHiggsfieldWorkflowResult,
} from '../../../electron/ipc/workflows';

describe('buildCreateArgs', () => {
  it('builds a minimal text-to-video create command with --wait --json', () => {
    const args = buildCreateArgs({ model: 'seedance_2_0', prompt: '  rain on a window  ', mediaType: 'video' });
    expect(args).toEqual(['generate', 'create', 'seedance_2_0', '--prompt', 'rain on a window', '--wait', '--json']);
  });

  it('maps media roles to the correct CLI flags', () => {
    const args = buildCreateArgs({
      model: 'seedance_2_0', prompt: 'p', mediaType: 'video',
      medias: [
        { value: './frame.png', role: 'start_image' },
        { value: 'uuid-123', role: 'end_image' },
      ],
    });
    expect(args).toContain('--start-image');
    expect(args[args.indexOf('--start-image') + 1]).toBe('./frame.png');
    expect(args).toContain('--end-image');
    expect(args[args.indexOf('--end-image') + 1]).toBe('uuid-123');
  });

  it('includes aspect ratio, duration, count, and extra params', () => {
    const args = buildCreateArgs({
      model: 'soul_2', prompt: 'a portrait', mediaType: 'image',
      aspectRatio: '16:9', durationSec: 5, count: 2, extra: { seed: 42 },
    });
    expect(args).toContain('--aspect_ratio'); expect(args[args.indexOf('--aspect_ratio') + 1]).toBe('16:9');
    expect(args).toContain('--duration'); expect(args[args.indexOf('--duration') + 1]).toBe('5');
    expect(args).toContain('--count'); expect(args[args.indexOf('--count') + 1]).toBe('2');
    expect(args).toContain('--seed'); expect(args[args.indexOf('--seed') + 1]).toBe('42');
  });

  it('skips media with empty values and omits non-positive durations', () => {
    const args = buildCreateArgs({ model: 'm', prompt: 'p', mediaType: 'video', medias: [{ value: '', role: 'image' }], durationSec: 0 });
    expect(args).not.toContain('--image');
    expect(args).not.toContain('--duration');
  });

  it('supports models without a prompt', () => {
    expect(buildCreateArgs({
      model: 'image_background_remover',
      mediaType: 'image',
      medias: [{ value: './source.png', role: 'image' }],
    })).toEqual([
      'generate', 'create', 'image_background_remover',
      '--image', './source.png', '--wait', '--json',
    ]);
  });

  it('serializes every non-null schema param while preserving false and zero', () => {
    const args = buildCreateArgs({
      model: 'schema_driven_model',
      mediaType: 'video',
      params: {
        prompt: '  keep intentional detail  ',
        generate_audio: false,
        temperature: 0,
        multi_shots: [{ prompt: 'wide', duration: 2 }],
        config: { mode: 'fast', strength: 0 },
        optional_value: null,
      },
    });

    expect(args).toEqual([
      'generate', 'create', 'schema_driven_model',
      '--prompt', 'keep intentional detail',
      '--generate_audio', 'false',
      '--temperature', '0',
      '--multi_shots', '[{"prompt":"wide","duration":2}]',
      '--config', '{"mode":"fast","strength":0}',
      '--wait', '--json',
    ]);
  });

  it('lets the new params map override the legacy extra map', () => {
    const args = buildCreateArgs({
      model: 'm', mediaType: 'audio',
      extra: { voice: 'old', stability: 0 },
      params: { voice: 'new', stability: false },
    });
    expect(args).toContain('--voice');
    expect(args[args.indexOf('--voice') + 1]).toBe('new');
    expect(args[args.indexOf('--stability') + 1]).toBe('false');
  });
});

describe('extractMediaUrl', () => {
  it('reads direct url fields', () => {
    expect(extractMediaUrl({ url: 'https://a/b.mp4' })).toBe('https://a/b.mp4');
    expect(extractMediaUrl({ video_url: 'https://a/v.mp4' })).toBe('https://a/v.mp4');
    expect(extractMediaUrl({ image_url: 'https://a/i.png' })).toBe('https://a/i.png');
  });

  it('reads nested and array shapes', () => {
    expect(extractMediaUrl({ output: { url: 'https://a/o.mp4' } })).toBe('https://a/o.mp4');
    expect(extractMediaUrl({ results: ['https://a/1.png'] })).toBe('https://a/1.png');
    expect(extractMediaUrl({ medias: [{ url: 'https://a/2.png' }] })).toBe('https://a/2.png');
    expect(extractMediaUrl({ job: { outputs: [{ video_url: 'https://a/3.mp4' }] } })).toBe('https://a/3.mp4');
  });

  it('returns undefined when no url present', () => {
    expect(extractMediaUrl({ state: 'running' })).toBeUndefined();
  });

  it('collects every unique URL without traversing request params', () => {
    expect(extractMediaUrls({
      results: [
        { result_url: 'https://a/one.png', params: { image_url: 'https://a/input.png' } },
        { output: { url: 'https://a/two.png' } },
        { result_url: 'https://a/one.png' },
      ],
    })).toEqual(['https://a/one.png', 'https://a/two.png']);
  });
});

describe('extractTextOutput', () => {
  it('reads direct, nested, and streamed-array text result shapes', () => {
    expect(extractTextOutput({ text: 'analysis complete' })).toBe('analysis complete');
    expect(extractTextOutput({ output: { output_text: 'nested result' } })).toBe('nested result');
    expect(extractTextOutput({ results: [{ status: 'running' }, { result: 'final answer' }] })).toBe('final answer');
  });

  it('does not treat output URLs as text', () => {
    expect(extractTextOutput({ result: 'https://a/result.txt' })).toBeUndefined();
  });
});

describe('parseGenerateJson', () => {
  const p = { model: 'seedance_2_0', mediaType: 'video' as const };

  it('parses a single JSON object with a url', () => {
    const r = parseGenerateJson('{"state":"completed","url":"https://a/b.mp4","duration":5,"job_id":"j1"}', p);
    expect(r.url).toBe('https://a/b.mp4');
    expect(r.durationSec).toBe(5);
    expect(r.jobId).toBe('j1');
    expect(r.model).toBe('seedance_2_0');
  });

  it('takes the last JSON object when the CLI emits progress lines', () => {
    const out = [
      '{"state":"running"}',
      '{"state":"running","progress":0.5}',
      '{"state":"completed","output":{"url":"https://a/final.mp4"}}',
    ].join('\n');
    expect(parseGenerateJson(out, p).url).toBe('https://a/final.mp4');
  });

  it('throws on a failed job with the error message', () => {
    expect(() => parseGenerateJson('{"state":"failed","error":"nsfw blocked"}', p)).toThrow(/nsfw blocked/);
  });

  it('throws when output has no media url', () => {
    expect(() => parseGenerateJson('{"state":"completed"}', p)).toThrow(/without a media URL/);
  });

  it('throws on empty or non-JSON output', () => {
    expect(() => parseGenerateJson('', p)).toThrow(/no output/);
    expect(() => parseGenerateJson('not json', p)).toThrow(/not valid JSON/);
  });

  it('parses a pretty-printed multi-line array (the --wait output shape)', () => {
    // This is what `generate create --wait --json` actually emits — indented, multi-line.
    const real = `[
  {
    "id": "572aea65-7865-48f9-b550-cdc9e494d065",
    "status": "completed",
    "job_set_type": "nano_banana_2",
    "result_url": "https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_mug.png",
    "params": { "width": 2048, "height": 2048 }
  }
]`;
    const r = parseGenerateJson(real, { model: 'nano_banana_2', mediaType: 'image' });
    expect(r.url).toBe('https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_mug.png');
    expect(r.jobId).toBe('572aea65-7865-48f9-b550-cdc9e494d065');
  });

  it('parses the real CLI array payload (live-captured shape)', () => {
    // Captured verbatim from `higgsfield generate create nano_banana_2 --wait --json`.
    const real = JSON.stringify([{
      id: '0316caff-f73c-43d3-be1e-fa113bcb95d3',
      status: 'completed',
      display_name: 'Nano Banana Pro',
      job_set_type: 'nano_banana_2',
      result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_apple.png',
      params: { width: 2048, height: 2048, aspect_ratio: '1:1' },
    }]);
    const r = parseGenerateJson(real, { model: 'nano_banana_2', mediaType: 'image' });
    expect(r.url).toBe('https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_apple.png');
    expect(r.jobId).toBe('0316caff-f73c-43d3-be1e-fa113bcb95d3');
  });

  it.each(['image', 'video', 'audio', '3d'] as const)('preserves the %s output kind for URL results', (mediaType) => {
    const r = parseGenerateJson(
      '{"status":"completed","result_url":"https://a/output.bin"}',
      { model: 'model', mediaType },
    );
    expect(r.mediaType).toBe(mediaType);
    expect(r.outputKind).toBe(mediaType);
    expect(r.url).toBe('https://a/output.bin');
    expect(r.outputs).toEqual([{ kind: mediaType, url: 'https://a/output.bin' }]);
  });

  it('returns text-output models without requiring a media URL', () => {
    const r = parseGenerateJson(
      '{"status":"completed","output":{"text":"Detected sustained attention"},"id":"text-job"}',
      { model: 'brain_activity', mediaType: 'text' },
    );
    expect(r.url).toBeUndefined();
    expect(r.text).toBe('Detected sustained attention');
    expect(r.mediaType).toBe('text');
    expect(r.outputs).toEqual([{ kind: 'text', text: 'Detected sustained attention' }]);
    expect(r.jobId).toBe('text-job');
  });

  it('keeps all URLs while retaining the first-url compatibility field', () => {
    const r = parseGenerateJson(JSON.stringify([
      { status: 'completed', result_url: 'https://a/one.png' },
      { status: 'completed', result_url: 'https://a/two.png' },
    ]), { model: 'multi', mediaType: 'image' });
    expect(r.url).toBe('https://a/one.png');
    expect(r.urls).toEqual(['https://a/one.png', 'https://a/two.png']);
  });
});

describe('schema-driven workflow adapter', () => {
  it('turns model media params into typed CLI refs and forwards every other value', () => {
    const request = buildHiggsfieldWorkflowRequest('all_inputs', {
      medias: [
        { value: 'generic.png', role: 'end_image' },
        { url: 'voice.wav', type: 'audio' },
      ],
      higgsfield_media_inputs: [
        { value: 'renderer-first.png', role: 'start_image' },
        { value: 'renderer-audio.wav', role: 'audio' },
      ],
      input_images: ['one.png', { id: 'upload-two' }],
      input_image: 'single.png',
      input_video: 'source.mp4',
      input_audio: 'voice-2.wav',
      video: { fileRef: 'motion.mp4' },
      sketch: 'sketch.png',
      ref_image: 'reference.png',
      urls: ['clip-a.mp4', 'clip-b.mp4'],
      start_image_url: 'first.png',
      end_image_url: 'last.png',
      generate_audio: false,
      temperature: 0,
      object_config: { strength: 0 },
      omitted: null,
    }, 'video');

    expect(request.params).toEqual({
      generate_audio: false,
      temperature: 0,
      object_config: { strength: 0 },
    });
    expect(request.medias).toEqual([
      { value: 'generic.png', role: 'end_image' },
      { value: 'voice.wav', role: 'audio' },
      { value: 'renderer-first.png', role: 'start_image' },
      { value: 'renderer-audio.wav', role: 'audio' },
      { value: 'one.png', role: 'image' },
      { value: 'upload-two', role: 'image' },
      { value: 'single.png', role: 'image' },
      { value: 'source.mp4', role: 'video' },
      { value: 'voice-2.wav', role: 'audio' },
      { value: 'motion.mp4', role: 'video' },
      { value: 'sketch.png', role: 'image' },
      { value: 'reference.png', role: 'image' },
      { value: 'clip-a.mp4', role: 'video' },
      { value: 'clip-b.mp4', role: 'video' },
      { value: 'first.png', role: 'start_image' },
      { value: 'last.png', role: 'end_image' },
    ]);
  });

  it('preserves legacy image-url behavior and resolves local-media paths for the CLI', () => {
    const video = buildHiggsfieldWorkflowRequest('legacy-video', {
      image_url: 'local-media://file/tmp/first%20frame.png',
      image_urls: ['second.png'],
      prompt: 'animate',
    }, 'video');
    expect(video.medias).toEqual([
      { value: '/tmp/first frame.png', role: 'start_image' },
      { value: 'second.png', role: 'start_image' },
    ]);
    expect(video.params).toEqual({ prompt: 'animate' });

    const image = buildHiggsfieldWorkflowRequest('legacy-image', { image_url: 'ref.png' }, 'image');
    expect(image.medias).toEqual([{ value: 'ref.png', role: 'image' }]);
  });

  it('infers raw media roles by extension and falls back according to the output kind', () => {
    expect(buildHiggsfieldWorkflowRequest('video-model', {
      medias: ['frame.png', 'motion.mp4?download=1', 'voice.wav'],
    }, 'video').medias).toEqual([
      { value: 'frame.png', role: 'start_image' },
      { value: 'motion.mp4?download=1', role: 'video' },
      { value: 'voice.wav', role: 'audio' },
    ]);

    expect(buildHiggsfieldWorkflowRequest('brain-activity', {
      medias: ['untyped-upload-id'],
    }, 'text').medias).toEqual([{ value: 'untyped-upload-id', role: 'video' }]);
    expect(buildHiggsfieldWorkflowRequest('audio-model', {
      medias: ['untyped-upload-id'],
    }, 'audio').medias).toEqual([{ value: 'untyped-upload-id', role: 'audio' }]);
    expect(buildHiggsfieldWorkflowRequest('mesh-model', {
      medias: ['untyped-upload-id'],
    }, '3d').medias).toEqual([{ value: 'untyped-upload-id', role: 'image' }]);
  });

  it('keeps explicit structured roles authoritative over file extensions', () => {
    expect(buildHiggsfieldWorkflowRequest('structured', {
      higgsfield_media_inputs: [
        { value: 'looks-like-video.mp4', role: 'end_image' },
        { value: 'looks-like-audio.wav', role: 'start_image' },
      ],
    }, 'video').medias).toEqual([
      { value: 'looks-like-video.mp4', role: 'end_image' },
      { value: 'looks-like-audio.wav', role: 'start_image' },
    ]);
  });

  it('normalizes both URL and text results to the renderer workflow envelope', () => {
    expect(normalizeHiggsfieldWorkflowResult({
      url: 'https://a/audio.mp3', urls: ['https://a/audio.mp3'], mediaType: 'audio', outputKind: 'audio',
      outputs: [{ kind: 'audio', url: 'https://a/audio.mp3' }], durationSec: 3, jobId: 'j1', model: 'tts',
    })).toMatchObject({
      output: { url: 'https://a/audio.mp3', urls: ['https://a/audio.mp3'], duration: 3 },
      url: 'https://a/audio.mp3', mediaType: 'audio', outputKind: 'audio', jobId: 'j1', model: 'tts',
    });

    expect(normalizeHiggsfieldWorkflowResult({
      text: 'done', mediaType: 'text', outputKind: 'text', outputs: [{ kind: 'text', text: 'done' }], model: 'brain',
    })).toMatchObject({ output: { text: 'done' }, text: 'done', mediaType: 'text', outputKind: 'text' });
  });
});

describe('parseConnectionState', () => {
  it('reports disconnected for null', () => {
    expect(parseConnectionState(null)).toEqual({ connected: false });
  });

  it('reads the live shape (email, credits, subscription_plan_type)', () => {
    const s = parseConnectionState({ email: 'a@b.com', credits: 156.65, subscription_plan_type: 'ultra' });
    expect(s).toEqual({ connected: true, email: 'a@b.com', plan: 'ultra', credits: 156.65 });
  });

  it('unwraps a { data: {...} } envelope and falls back to balance', () => {
    const s = parseConnectionState({ data: { email: 'x@y.com', balance: 50 } });
    expect(s.connected).toBe(true);
    expect(s.email).toBe('x@y.com');
    expect(s.credits).toBe(50);
  });
});
