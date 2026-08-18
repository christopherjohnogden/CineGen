import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicHandlers } from './music.mjs';

test('music prompt generation stages frames and uses the hosted vision route', async () => {
  const staged = [];
  const providerCalls = [];
  const handlers = createMusicHandlers({
    stageMedia: async (source, key, label) => {
      staged.push({ source, key, label });
      return `https://fal.media/${source.split('/').pop()}`;
    },
    falSubscribe: async (model, input, key) => {
      providerCalls.push({ model, input, key });
      return { data: { output: '  Pulsing analog synths rise into a warm orchestral release.  ' } };
    },
  });

  const result = await handlers.generatePrompt({
    apiKey: 'music-secret',
    frameUrls: ['/media/uploads/one/frame.jpg'],
    genre: 'cinematic electronic',
    mood: 'hopeful',
    tempo: 'mid-tempo',
    additionalNotes: 'Build toward the reveal.',
  });

  assert.deepEqual(result, {
    prompt: 'Pulsing analog synths rise into a warm orchestral release.',
  });
  assert.deepEqual(staged, [{
    source: '/media/uploads/one/frame.jpg',
    key: 'music-secret',
    label: 'Music prompt frame 1',
  }]);
  assert.equal(providerCalls[0].model, 'fal-ai/any-llm/vision');
  assert.equal(providerCalls[0].key, 'music-secret');
  assert.equal(providerCalls[0].input.model, 'google/gemini-flash-1.5');
  assert.deepEqual(providerCalls[0].input.image_urls, ['https://fal.media/frame.jpg']);
  assert.match(providerCalls[0].input.prompt, /Genre: cinematic electronic/);
  assert.match(providerCalls[0].input.prompt, /Build toward the reveal/);
});

test('music prompt generation uses the text route without frames', async () => {
  const providerCalls = [];
  const handlers = createMusicHandlers({
    stageMedia: async () => { throw new Error('stage should not run'); },
    falSubscribe: async (model, input, key) => {
      providerCalls.push({ model, input, key });
      return { data: { text: 'Minimal felt piano with restrained strings.' } };
    },
  });

  assert.deepEqual(
    await handlers.generatePrompt({ apiKey: 'secret', style: 'intimate' }),
    { prompt: 'Minimal felt piano with restrained strings.' },
  );
  assert.equal(providerCalls[0].model, 'fal-ai/any-llm');
  assert.equal('image_urls' in providerCalls[0].input, false);
});

test('music prompt generation validates keys, frames, and empty provider responses', async () => {
  const handlers = createMusicHandlers({
    stageMedia: async (source) => source,
    falSubscribe: async () => ({ data: { output: '   ' } }),
  });

  await assert.rejects(
    handlers.generatePrompt({ mood: 'quiet' }),
    (error) => error.code === 'INVALID_INPUT' && /API key/.test(error.message),
  );
  await assert.rejects(
    handlers.generatePrompt({ apiKey: 'secret', frameUrls: 'https://example.com/frame.jpg' }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    handlers.generatePrompt({ apiKey: 'secret' }),
    (error) => error.code === 'PROVIDER_BAD_RESPONSE',
  );
});
