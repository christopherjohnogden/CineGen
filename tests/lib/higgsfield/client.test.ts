import { describe, expect, it } from 'vitest';
import {
  buildCreateArgs,
  parseGenerateJson,
  parseJobSnapshot,
  extractHiggsfieldJobId,
  isTransientHiggsfieldError,
  extractMediaUrl,
  extractMediaUrls,
  extractTextOutput,
  matchListedJobRecord,
  buildCostArgs,
  creditsFromCostStdout,
  parseConnectionState,
  pickHiggsfieldBinaries,
  higgsfieldBinaryCandidates,
} from '../../../electron/ipc/higgsfield';
import {
  buildHiggsfieldWorkflowRequest,
  normalizeHiggsfieldWorkflowResult,
} from '../../../electron/ipc/workflows';

describe('generate cost', () => {
  it('asks only for a quote: no --wait, no media, and only params the model knows', () => {
    const args = buildCostArgs('seedance_2_5', {
      prompt: 'rain on a window',
      duration: 10,
      resolution: '1080p',
      generate_audio: true,
      // Not on seedance_2_5's schema, so it never reaches the CLI.
      not_a_param: 'x',
      // Empty and absent settings are simply not sent.
      aspect_ratio: '',
      seed: null,
    });
    expect(args[0]).toBe('generate');
    expect(args[1]).toBe('cost');
    expect(args[2]).toBe('seedance_2_5');
    expect(args).toContain('--duration');
    expect(args).toContain('10');
    expect(args).toContain('--resolution');
    expect(args).toContain('1080p');
    expect(args).toContain('--generate_audio');
    expect(args).not.toContain('--not_a_param');
    expect(args).not.toContain('--aspect_ratio');
    expect(args).not.toContain('--seed');
    expect(args).not.toContain('--wait');
    expect(args.at(-1)).toBe('--json');
  });

  it('reads the quote out of the CLI payload, and refuses anything else', () => {
    expect(creditsFromCostStdout('{"credits":45}')).toBe(45);
    expect(creditsFromCostStdout('warming up\n{"credits":12.5}\n')).toBe(12.5);
    expect(creditsFromCostStdout('{"credits":"lots"}')).toBeNull();
    expect(creditsFromCostStdout('not json at all')).toBeNull();
    expect(creditsFromCostStdout('')).toBeNull();
  });
});

describe('buildCreateArgs', () => {
  it('builds a minimal text-to-video create command with --wait --json', () => {
    const args = buildCreateArgs({ model: 'seedance_2_0', prompt: '  rain on a window  ', mediaType: 'video' });
    expect(args).toEqual(['generate', 'create', 'seedance_2_0', '--prompt', 'rain on a window', '--wait', '--json']);
  });

  it('can submit without --wait so a later 503 poll can rejoin the job', () => {
    const args = buildCreateArgs({
      model: 'seedance_2_5', prompt: 'Peter waits', mediaType: 'video', wait: false,
    });
    expect(args).toEqual(['generate', 'create', 'seedance_2_5', '--prompt', 'Peter waits', '--json']);
    expect(args).not.toContain('--wait');
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

  it('drops Seedance 2.5 flags the live CLI rejects', () => {
    const args = buildCreateArgs({
      model: 'seedance_2_5',
      prompt: 'Peter waits',
      mediaType: 'video',
      params: {
        aspect_ratio: '16:9',
        duration: 6,
        genre: 'noir',
        multi_shots: false,
        generate_audio: true,
      },
    });
    expect(args).toEqual([
      'generate', 'create', 'seedance_2_5',
      '--prompt', 'Peter waits',
      '--aspect_ratio', '16:9',
      '--duration', '6',
      '--generate_audio', 'true',
      '--wait', '--json',
    ]);
    expect(args).not.toContain('--genre');
    expect(args).not.toContain('--multi_shots');
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

  it('reads image envelopes that put the file on urls / images / uri', () => {
    expect(extractMediaUrl({ status: 'completed', result: { urls: ['https://a/out.png'] } })).toBe('https://a/out.png');
    expect(extractMediaUrl({ status: 'completed', images: [{ url: 'https://a/shot.png' }] })).toBe('https://a/shot.png');
    expect(extractMediaUrl({ jobs: [{ uri: 'https://a/uri.png' }] })).toBe('https://a/uri.png');
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

  it('reads a Nano Banana Pro list row without picking the input still', () => {
    const urls = extractMediaUrls({
      id: '213375f2-df1d-45f5-8acb-a0c4fad312b7',
      job_type: 'nano_banana_pro',
      status: 'completed',
      result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_map.png',
      min_result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_map_min.webp',
      params: { input_images: [{ url: 'https://cdn/liked-frame.jpg' }] },
    });
    expect(urls[0]).toBe('https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_map.png');
    expect(urls).not.toContain('https://cdn/liked-frame.jpg');
  });

  it('reads seedance result_url and result_json video payloads', () => {
    expect(extractMediaUrls({
      status: 'completed',
      result_url: 'https://cdn/out.mp4',
    })).toEqual(['https://cdn/out.mp4']);
    expect(extractMediaUrls({
      result_json: '{"video":{"url":"https://cdn/from-json.mp4"}}',
    })).toEqual(['https://cdn/from-json.mp4']);
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

  it('reads CLI 1.x llm_text result_json — envelope or raw string', () => {
    // result_json carrying a text envelope digs the answer out.
    expect(extractTextOutput({ result_json: '{"text":"the answer"}' })).toBe('the answer');
    // result_json carrying arbitrary JSON (e.g. a shotlist payload) returns the raw string.
    expect(extractTextOutput({ result_json: '{"scenes":[],"clips":[]}' })).toBe('{"scenes":[],"clips":[]}');
    // result_json carrying plain text returns it as-is.
    expect(extractTextOutput({ result_json: 'plain answer' })).toBe('plain answer');
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

  it('scrapes a result URL when the wait payload is completed but the field is not result_url', () => {
    const r = parseGenerateJson(
      '{"status":"completed","id":"j1"}\nhttps://d8j0ntlcm91z4.cloudfront.net/user_x/map.png',
      { model: 'nano_banana_2', mediaType: 'image' },
    );
    expect(r.url).toBe('https://d8j0ntlcm91z4.cloudfront.net/user_x/map.png');
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

  it('parses a listed nano_banana_pro job with result_url', () => {
    const r = parseGenerateJson(JSON.stringify({
      id: '213375f2-df1d-45f5-8acb-a0c4fad312b7',
      job_type: 'nano_banana_pro',
      status: 'completed',
      result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_map.png',
      min_result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_map_min.webp',
      params: { prompt: 'COMPOSITION-ONLY', input_images: [{ url: 'https://cdn/frame.jpg' }] },
    }), { model: 'nano_banana_2', mediaType: 'image' });
    expect(r.url).toBe('https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_map.png');
    expect(r.jobId).toBe('213375f2-df1d-45f5-8acb-a0c4fad312b7');
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

describe('Higgsfield 503 / job rejoin', () => {
  it('treats HTTP 503 as transient', () => {
    expect(isTransientHiggsfieldError('Higgsfield API error (HTTP 503). request failed with status 503 Service Unavailable')).toBe(true);
    expect(isTransientHiggsfieldError('nsfw blocked')).toBe(false);
  });

  it('reads a queued job id from create --json output', () => {
    const queued = JSON.stringify([{
      id: '572aea65-7865-48f9-b550-cdc9e494d065',
      status: 'queued',
      job_set_type: 'seedance_2_5',
    }]);
    expect(parseJobSnapshot(queued)).toMatchObject({
      status: 'queued',
      jobId: '572aea65-7865-48f9-b550-cdc9e494d065',
    });
    expect(() => parseGenerateJson(queued, { model: 'seedance_2_5', mediaType: 'video' }))
      .toThrow(/still running/);
    expect(extractHiggsfieldJobId(
      'Error: Higgsfield API error (HTTP 503). request failed with status 503 Service Unavailable',
      queued,
    )).toBe('572aea65-7865-48f9-b550-cdc9e494d065');
  });

  it('rejoins a listed child when the waited id is the job set', () => {
    expect(matchListedJobRecord([
      { id: 'child-id', job_set_id: 'set-id', result_url: 'https://cdn/map.png' },
    ], 'set-id')).toMatchObject({ id: 'child-id' });
  });
});

describe('schema-driven workflow adapter', () => {
  it('switches Seedance 2.5 into reference mode for connected media and elements', () => {
    const request = buildHiggsfieldWorkflowRequest('seedance_2_5', {
      prompt: 'Keep the character consistent',
      mode: 't2v',
      medias: [
        { allUrls: ['hero-front.png', 'hero-profile.png'] },
        'camera-move.mp4',
        'dialogue.wav',
      ],
    }, 'video');

    expect(request.params).toMatchObject({
      prompt: 'Keep the character consistent',
      mode: 'omni_reference',
    });
    expect(request.medias).toEqual([
      { value: 'hero-front.png', role: 'image' },
      { value: 'hero-profile.png', role: 'image' },
      { value: 'camera-move.mp4', role: 'video' },
      { value: 'dialogue.wav', role: 'audio' },
    ]);
  });

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

describe('pickHiggsfieldBinaries', () => {
  it('skips missing absolute paths and keeps PATH names', () => {
    expect(pickHiggsfieldBinaries([
      '/missing/higgsfield',
      '/opt/homebrew/bin/higgsfield',
      'higgsfield',
      'higgs',
    ], (file) => file === '/opt/homebrew/bin/higgsfield')).toEqual([
      '/opt/homebrew/bin/higgsfield',
      'higgsfield',
      'higgs',
    ]);
  });

  it('does not treat HuggingFace Hub `hf` as the Higgsfield CLI', () => {
    const candidates = higgsfieldBinaryCandidates('/Users/me');
    expect(candidates).toContain('/Users/me/.npm-global/bin/higgsfield');
    expect(candidates).toContain('higgs');
    expect(candidates.some((bin) => bin === 'hf' || /(^|\/)hf$/.test(bin))).toBe(false);
  });
});
