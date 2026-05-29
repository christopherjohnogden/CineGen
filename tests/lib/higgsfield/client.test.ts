import { describe, expect, it } from 'vitest';
import { buildSubmitBody, parseJobStatus, extractMediaUrl } from '../../../electron/ipc/higgsfield';

describe('buildSubmitBody', () => {
  it('builds a minimal text-to-video body (MCP-shaped, no type field)', () => {
    const body = buildSubmitBody({ model: 'seedance_2_0', prompt: '  rain on a window  ', mediaType: 'video' });
    expect(body).toEqual({ model: 'seedance_2_0', prompt: 'rain on a window' });
  });

  it('includes medias with roles, aspect ratio, duration, and count', () => {
    const body = buildSubmitBody({
      model: 'soul_2', prompt: 'a portrait', mediaType: 'image',
      medias: [{ value: 'https://x/y.jpg', role: 'image' }], aspectRatio: '16:9', durationSec: 5, count: 2,
    });
    expect(body.medias).toEqual([{ value: 'https://x/y.jpg', role: 'image' }]);
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.duration).toBe(5);
    expect(body.count).toBe(2);
  });

  it('omits empty medias arrays and non-positive durations', () => {
    const body = buildSubmitBody({ model: 'm', prompt: 'p', mediaType: 'video', medias: [], durationSec: 0 });
    expect('medias' in body).toBe(false);
    expect('duration' in body).toBe(false);
  });

  it('merges extra params', () => {
    const body = buildSubmitBody({ model: 'm', prompt: 'p', mediaType: 'image', extra: { seed: 42 } });
    expect(body.seed).toBe(42);
  });
});

describe('extractMediaUrl', () => {
  it('reads a direct url field', () => {
    expect(extractMediaUrl({ url: 'https://a/b.mp4' })).toBe('https://a/b.mp4');
    expect(extractMediaUrl({ video_url: 'https://a/v.mp4' })).toBe('https://a/v.mp4');
    expect(extractMediaUrl({ image_url: 'https://a/i.png' })).toBe('https://a/i.png');
  });

  it('reads a nested output.url', () => {
    expect(extractMediaUrl({ output: { url: 'https://a/o.mp4' } })).toBe('https://a/o.mp4');
  });

  it('reads the first of an outputs array (string or object)', () => {
    expect(extractMediaUrl({ outputs: ['https://a/1.png'] })).toBe('https://a/1.png');
    expect(extractMediaUrl({ outputs: [{ url: 'https://a/2.png' }] })).toBe('https://a/2.png');
  });

  it('returns undefined when no url present', () => {
    expect(extractMediaUrl({ state: 'running' })).toBeUndefined();
  });
});

describe('parseJobStatus', () => {
  it('maps a completed job with a url', () => {
    const s = parseJobStatus({ state: 'completed', url: 'https://a/b.mp4', duration: 5 });
    expect(s.state).toBe('completed');
    expect(s.url).toBe('https://a/b.mp4');
    expect(s.durationSec).toBe(5);
  });

  it('treats success/succeeded as completed', () => {
    expect(parseJobStatus({ status: 'success', url: 'u' }).state).toBe('completed');
    expect(parseJobStatus({ status: 'succeeded', video_url: 'u' }).state).toBe('completed');
  });

  it('maps failure with an error message', () => {
    const s = parseJobStatus({ state: 'failed', error: 'nsfw blocked' });
    expect(s.state).toBe('failed');
    expect(s.error).toBe('nsfw blocked');
  });

  it('maps queued and running', () => {
    expect(parseJobStatus({ state: 'queued' }).state).toBe('queued');
    expect(parseJobStatus({ state: 'running' }).state).toBe('running');
    expect(parseJobStatus({ status: 'pending' }).state).toBe('queued');
  });

  it('unwraps a { data: {...} } envelope', () => {
    const s = parseJobStatus({ data: { state: 'completed', url: 'https://a/b.mp4' } });
    expect(s.state).toBe('completed');
    expect(s.url).toBe('https://a/b.mp4');
  });

  it('surfaces poll_after_seconds for non-terminal jobs', () => {
    expect(parseJobStatus({ state: 'running', poll_after_seconds: 5 }).pollAfterSec).toBe(5);
    expect(parseJobStatus({ state: 'queued', poll_after_seconds: 8 }).pollAfterSec).toBe(8);
  });

  it('defaults to running for unknown/empty input', () => {
    expect(parseJobStatus(null).state).toBe('running');
    expect(parseJobStatus({}).state).toBe('running');
  });
});
