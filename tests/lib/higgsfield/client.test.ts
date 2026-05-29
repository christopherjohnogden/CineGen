import { describe, expect, it } from 'vitest';
import { buildSubmitBody, parseJobStatus, extractMediaUrl } from '../../../electron/ipc/higgsfield';

describe('buildSubmitBody', () => {
  it('builds a minimal text-to-video body', () => {
    const body = buildSubmitBody({ model: 'seedance-2', prompt: '  rain on a window  ', mediaType: 'video' });
    expect(body).toEqual({ model: 'seedance-2', prompt: 'rain on a window', type: 'video' });
  });

  it('includes reference images, aspect ratio, and duration when present', () => {
    const body = buildSubmitBody({
      model: 'soul-v2', prompt: 'a portrait', mediaType: 'image',
      imageUrls: ['https://x/y.jpg'], aspectRatio: '16:9', durationSec: 5,
    });
    expect(body.image_urls).toEqual(['https://x/y.jpg']);
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.duration).toBe(5);
  });

  it('omits empty image arrays and non-positive durations', () => {
    const body = buildSubmitBody({ model: 'm', prompt: 'p', mediaType: 'video', imageUrls: [], durationSec: 0 });
    expect('image_urls' in body).toBe(false);
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

  it('defaults to running for unknown/empty input', () => {
    expect(parseJobStatus(null).state).toBe('running');
    expect(parseJobStatus({}).state).toBe('running');
  });
});
