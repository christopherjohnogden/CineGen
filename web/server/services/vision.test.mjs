import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createVisionServices,
  visionCapabilities,
} from './vision.mjs';

function stagedUrl(source) {
  return source.startsWith('http') ? source : `https://fal.media/${source.split('/').pop()}`;
}

test('vision indexAsset returns the desktop-compatible visual summary shape', async () => {
  const calls = [];
  const { visionHandlers } = createVisionServices({
    stageMedia: async (source, key) => {
      assert.equal(key, 'vision-secret');
      return stagedUrl(source);
    },
    falSubscribe: async (model, input, key) => {
      calls.push({ model, input, key });
      return {
        data: {
          output: '```json\n{"summary":"A solitary runner crosses a rainy street.","tone":["moody"],"pacing":"measured","shotTypes":["wide"],"subjects":["runner"],"brollIdeas":["rain detail"],"confidence":0.88}\n```',
        },
      };
    },
  });

  const result = await visionHandlers.indexAsset({
    apiKey: 'vision-secret',
    assetId: 'asset-1',
    assetName: 'Rain Run',
    framePaths: ['/media/frames/a.jpg', 'https://cdn.example.com/b.jpg'],
  });

  assert.equal(result.assetId, 'asset-1');
  assert.equal(result.status, 'ready');
  assert.equal(result.model, 'google/gemini-2.5-flash');
  assert.equal(result.summary, 'A solitary runner crosses a rainy street.');
  assert.deepEqual(result.tone, ['moody']);
  assert.deepEqual(result.shotTypes, ['wide']);
  assert.equal(result.sourceFrameCount, 2);
  assert.match(result.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls[0].model, 'fal-ai/any-llm/vision');
  assert.equal(calls[0].key, 'vision-secret');
  assert.deepEqual(calls[0].input.image_urls, [
    'https://fal.media/a.jpg',
    'https://cdn.example.com/b.jpg',
  ]);
});

test('vision detectObjects retries empty proposals and normalizes provider boxes', async () => {
  const calls = [];
  const responses = [
    { data: { output: '{"objects":[]}' } },
    {
      data: {
        output: 'Result: {"detections":[{"name":"Car","bbox":[0.1,0.2,0.5,0.6],"confidence":"90%","salience":0.95},{"label":"Car","bbox":[0.11,0.2,0.51,0.6],"score":0.8}]}',
      },
    },
  ];
  const { visionHandlers } = createVisionServices({
    stageMedia: async (source) => stagedUrl(source),
    falSubscribe: async (model, input, key) => {
      calls.push({ model, input, key });
      return responses.shift();
    },
  });

  const result = await visionHandlers.detectObjects({
    apiKey: 'vision-secret',
    imagePath: '/media/frames/car.jpg',
    maxObjects: 4,
    context: 'Street scene',
  });

  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 2);
  assert.match(calls[1].input.prompt, /Retry object proposal/);
  assert.deepEqual(result.objects, [{
    label: 'Car',
    box: [0.3, 0.4, 0.4, 0.39999999999999997],
    score: 0.9,
    priority: 0.95,
  }]);
});

test('acoustic analyzeAsset combines hosted descriptors with best-effort silence detection', async () => {
  const calls = [];
  const { acousticHandlers } = createVisionServices({
    dataRoot: '/unused-because-resolver-is-not-needed-by-injected-stage',
    stageMedia: async (source, key) => {
      assert.equal(source, 'https://cdn.example.com/interview.mp4');
      assert.equal(key, 'acoustic-secret');
      return source;
    },
    silenceDetector: async () => {
      throw new Error('remote media should not invoke local silence detection');
    },
    falSubscribe: async (model, input, key) => {
      calls.push({ model, input, key });
      return {
        data: {
          output: '{"segments":[{"start":0,"end":3.2,"delivery":"soft and reflective","emotion":"wistful","notable":["long breath"],"confidence":0.84}]}',
        },
      };
    },
  });

  const result = await acousticHandlers.analyzeAsset({
    apiKey: 'acoustic-secret',
    assetId: 'asset-audio',
    assetName: 'Interview',
    mediaPath: 'https://cdn.example.com/interview.mp4',
    isVideo: true,
    durationSec: 12,
    transcript: [{ start: 0, end: 3.2, text: 'This place was home.' }],
    model: 'gemini-2.5-flash',
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.model, 'fal-ai/video-understanding');
  assert.equal(result.version, 1);
  assert.equal(result.hasSpeech, true);
  assert.deepEqual(result.silenceMap, []);
  assert.equal(result.segments[0].delivery, 'soft and reflective');
  assert.equal(result.segments[0].confidence, 0.84);
  assert.match(result.error, /unavailable for remote media/);
  assert.equal(calls[0].model, 'fal-ai/video-understanding');
  assert.equal(calls[0].input.video_url, 'https://cdn.example.com/interview.mp4');
  assert.match(calls[0].input.prompt, /This place was home/);
});

test('acoustic analyzeAsset runs silence detection only against resolved web media', async (context) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-acoustic-test-'));
  context.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const mediaDirectory = path.join(dataRoot, 'media', 'uploads', 'clip');
  await fs.mkdir(mediaDirectory, { recursive: true });
  const diskPath = path.join(mediaDirectory, 'clip.mp4');
  await fs.writeFile(diskPath, Buffer.from('fake video'));
  const realDiskPath = await fs.realpath(diskPath);
  const detectedPaths = [];
  const { acousticHandlers } = createVisionServices({
    dataRoot,
    stageMedia: async () => 'https://fal.media/clip.mp4',
    silenceDetector: async (resolvedPath) => {
      detectedPaths.push(resolvedPath);
      return [
        '[silencedetect] silence_start: 1.25',
        '[silencedetect] silence_end: 2.75 | silence_duration: 1.5',
      ].join('\n');
    },
    falSubscribe: async () => ({ data: { output: '{"segments":[]}' } }),
  });

  const result = await acousticHandlers.analyzeAsset({
    apiKey: 'secret',
    assetId: 'clip',
    assetName: 'Clip',
    mediaPath: '/media/uploads/clip/clip.mp4',
    isVideo: true,
    transcript: [],
  });

  assert.deepEqual(detectedPaths, [realDiskPath]);
  assert.deepEqual(result.silenceMap, [{ start: 1.25, end: 2.75 }]);
  assert.equal(result.error, undefined);
});

test('copilot visual analysis uses hosted image/video routes and prompts video time ranges', async () => {
  const calls = [];
  const { copilotHandlers } = createVisionServices({
    stageMedia: async (source) => source,
    falSubscribe: async (model, input, key) => {
      calls.push({ model, input, key });
      return {
        data: {
          output: model === 'fal-ai/video-understanding'
            ? 'A handheld push-in follows the cyclist while traffic passes.'
            : 'A red bicycle leans against a brick wall.',
        },
      };
    },
  });

  const result = await copilotHandlers.analyzeVisualRefs({
    apiKey: 'copilot-secret',
    prompt: 'Identify the strongest story detail.',
    visualRefs: [
      {
        label: 'Bike still',
        kind: 'asset',
        mediaType: 'image',
        fileRef: 'https://cdn.example.com/bike.jpg',
      },
      {
        label: 'Cyclist clip',
        kind: 'clip',
        mediaType: 'video',
        fileRef: 'https://cdn.example.com/cyclist.mp4',
        trimStartSec: 5,
        trimDurationSec: 8,
      },
    ],
  });

  assert.deepEqual(result, [
    {
      label: 'Bike still',
      mediaType: 'image',
      analysis: 'A red bicycle leans against a brick wall.',
    },
    {
      label: 'Cyclist clip',
      mediaType: 'video',
      analysis: 'A handheld push-in follows the cyclist while traffic passes.',
    },
  ]);
  assert.equal(calls[0].model, 'fal-ai/any-llm/vision');
  assert.equal(calls[1].model, 'fal-ai/video-understanding');
  assert.match(calls[1].input.prompt, /5\.00s to 13\.00s/);
  assert.match(calls[1].input.prompt, /without physically trimming/);
  assert.equal(visionCapabilities.copilotClipPretrim, false);
});

test('vision services reject malformed models and return acoustic failures safely', async () => {
  const { visionHandlers, acousticHandlers } = createVisionServices({
    stageMedia: async () => { throw new Error('stage should not run'); },
    falSubscribe: async () => { throw new Error('provider should not run'); },
  });

  await assert.rejects(
    visionHandlers.indexAsset({
      apiKey: 'secret',
      assetId: 'asset',
      assetName: 'Asset',
      framePaths: ['/media/frame.jpg'],
      model: 'https://evil.example/model',
    }),
    (error) => error.code === 'INVALID_MODEL',
  );
  const result = await acousticHandlers.analyzeAsset({
    assetId: 'asset',
    assetName: 'Asset',
    mediaPath: 'https://cdn.example.com/asset.mp4',
    isVideo: true,
    transcript: [],
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /API key/);
});
