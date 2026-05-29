import { describe, expect, it } from 'vitest';
import { buildCreateArgs, parseGenerateJson, extractMediaUrl, parseConnectionState } from '../../../electron/ipc/higgsfield';

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
