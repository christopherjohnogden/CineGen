import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildHiggsfieldCreateArgs,
  createHiggsfieldHandlers,
  createHiggsfieldService,
  higgsfieldCapabilities,
  parseHiggsfieldConnectionState,
  parseHiggsfieldGenerateJson,
  parseHiggsfieldListJson,
} from './higgsfield.mjs';

const INSTALLED = Object.freeze({ installed: true, path: '/srv/cinegen/bin/higgsfield' });

function generationParams(overrides = {}) {
  return {
    prompt: 'Make the scene feel cinematic',
    model: 'seedance_2_0',
    outputType: 'video',
    ...overrides,
  };
}

function resultJson(overrides = {}) {
  return JSON.stringify({
    status: 'completed',
    result_url: 'https://cdn.example.com/generated.mp4',
    id: 'job_123',
    duration: 6,
    ...overrides,
  });
}

test('pure helpers preserve the desktop argv and result contracts', () => {
  assert.deepEqual(buildHiggsfieldCreateArgs({
    model: 'seedance_2_0',
    prompt: '  Animate this still  ',
    mediaType: 'video',
    medias: [
      { role: 'start_image', value: 'https://cdn.example.com/start.jpg' },
      { role: 'end_image', value: 'https://cdn.example.com/end.jpg' },
    ],
    aspectRatio: '16:9',
    durationSec: 5,
    count: 1,
  }), [
    'generate', 'create', 'seedance_2_0', '--prompt', 'Animate this still',
    '--start-image', 'https://cdn.example.com/start.jpg',
    '--end-image', 'https://cdn.example.com/end.jpg',
    '--aspect_ratio', '16:9', '--duration', '5', '--count', '1', '--wait', '--json',
  ]);

  assert.deepEqual(parseHiggsfieldGenerateJson(
    `[${resultJson({ result_url: 'https://cdn.example.com/output.mp4' })}]`,
    { model: 'seedance_2_0', mediaType: 'video' },
  ), {
    url: 'https://cdn.example.com/output.mp4',
    mediaType: 'video',
    durationSec: 6,
    jobId: 'job_123',
    model: 'seedance_2_0',
  });

  assert.deepEqual(parseHiggsfieldConnectionState({
    data: {
      email: 'editor@example.com',
      subscription_plan_type: 'ultra',
      credits: 12.5,
    },
  }), {
    connected: true,
    email: 'editor@example.com',
    plan: 'ultra',
    credits: 12.5,
  });
});

test('generic argv supports optional prompts, every output kind, and lossless JSON params', () => {
  assert.deepEqual(buildHiggsfieldCreateArgs({
    model: 'brain_activity',
    mediaType: 'text',
    params: {
      threshold: 0,
      enabled: false,
      labels: ['hook', 0, false],
      config: { mode: 'full', enabled: false, weight: 0 },
      omitted: null,
    },
  }), [
    'generate', 'create', 'brain_activity',
    '--threshold', '0',
    '--enabled', 'false',
    '--labels', '["hook",0,false]',
    '--config', '{"mode":"full","enabled":false,"weight":0}',
    '--wait', '--json',
  ]);

  for (const mediaType of ['image', 'video', 'audio', 'text', '3d']) {
    assert.doesNotThrow(() => buildHiggsfieldCreateArgs({
      model: 'model_name',
      mediaType,
    }));
  }

  assert.deepEqual(buildHiggsfieldCreateArgs({
    model: 'soul_cast',
    mediaType: 'image',
    prompt: { character_params: { custom_reference_id: 'soul-1' }, budget: 0 },
  }), [
    'generate', 'create', 'soul_cast',
    '--prompt', '{"character_params":{"custom_reference_id":"soul-1"},"budget":0}',
    '--wait', '--json',
  ]);

  assert.deepEqual(parseHiggsfieldGenerateJson(
    '{"status":"completed","output_text":"Hook score: 92","id":"text_job"}',
    { model: 'brain_activity', mediaType: 'text' },
  ), {
    text: 'Hook score: 92',
    mediaType: 'text',
    jobId: 'text_job',
    model: 'brain_activity',
  });
  assert.deepEqual(parseHiggsfieldGenerateJson(
    '{"status":"completed","result_url":"https://cdn.example.com/model.glb"}',
    { model: 'tripo_3d', mediaType: '3d' },
  ), {
    url: 'https://cdn.example.com/model.glb',
    mediaType: '3d',
    model: 'tripo_3d',
  });
  assert.equal(parseHiggsfieldGenerateJson(
    '{"status":"completed","audio_url":"https://cdn.example.com/voice.wav"}',
    { model: 'seed_audio', mediaType: 'audio' },
  ).url, 'https://cdn.example.com/voice.wav');

  assert.throws(
    () => parseHiggsfieldGenerateJson(
      '{"status":"queued","id":"job_queued"}',
      { model: 'seedance_2_5', mediaType: 'video' },
    ),
    (error) => error.code === 'HIGGSFIELD_JOB_PENDING',
  );

  assert.deepEqual(parseHiggsfieldListJson(JSON.stringify({
    jobs: [{ id: 'job-1', job_type: 'seedance_2_5' }],
  })), [{ id: 'job-1', job_type: 'seedance_2_5' }]);
});

test('an unavailable server runtime returns explicit status and capability errors', async () => {
  let processCalls = 0;
  const handlers = createHiggsfieldHandlers({
    detector: async () => false,
    processRunner: async () => {
      processCalls += 1;
      return { code: 0, signal: null };
    },
  });

  assert.deepEqual(await handlers.accountStatus(), {
    connected: false,
    error: 'The Higgsfield CLI is not configured on the web server.',
  });
  assert.deepEqual(await handlers.authLogin(), {
    connected: false,
    error: 'The Higgsfield CLI is not configured on the web server.',
  });
  assert.equal(await handlers.authLogout(), undefined);
  await assert.rejects(
    handlers.generate(generationParams()),
    (error) => error.code === 'WEB_CAPABILITY_UNAVAILABLE' && error.statusCode === 422,
  );
  assert.equal(processCalls, 0);
});

test('account and opt-in auth commands use a configured executable with fixed argv', async () => {
  const specs = [];
  const detectorInputs = [];
  const handlers = createHiggsfieldHandlers({
    env: {
      PATH: '/usr/bin',
      CINEGEN_HIGGSFIELD_BIN: '/srv/cinegen/bin/higgsfield',
      CINEGEN_HIGGSFIELD_ALLOW_AUTH_COMMANDS: 'true',
    },
    detector: async (input) => {
      detectorInputs.push(input);
      return INSTALLED;
    },
    async processRunner(spec, io) {
      specs.push(spec);
      if (spec.args[0] === 'account') {
        io.onStdout(JSON.stringify({
          email: 'editor@example.com',
          subscription_plan_type: 'ultra',
          credits: 18,
        }));
      } else {
        io.onStdout('{"ok":true}');
      }
      return { code: 0, signal: null };
    },
  });

  assert.deepEqual(await handlers.accountStatus(), {
    connected: true,
    email: 'editor@example.com',
    plan: 'ultra',
    credits: 18,
  });
  assert.equal((await handlers.authLogin()).connected, true);
  assert.equal(await handlers.authLogout(), undefined);

  assert.equal(detectorInputs.every((input) => (
    input.candidates.length === 1
      && input.candidates[0] === '/srv/cinegen/bin/higgsfield'
      && input.env.CINEGEN_HIGGSFIELD_ALLOW_AUTH_COMMANDS === 'true'
  )), true);
  assert.equal(specs.length, 4);
  assert.equal(specs.every((spec) => spec.command === '/srv/cinegen/bin/higgsfield'), true);
  assert.equal(specs.every((spec) => spec.shell === false), true);
  assert.equal(specs.every((spec) => spec.args.at(-1) === '--json'), true);
  assert.deepEqual(specs.map((spec) => spec.args.slice(0, 2)), [
    ['account', 'status'],
    ['auth', 'login'],
    ['account', 'status'],
    ['auth', 'logout'],
  ]);
});

test('device auth remains disabled by default and never starts a login process', async () => {
  let processCalls = 0;
  const handlers = createHiggsfieldHandlers({
    env: { PATH: '/usr/bin' },
    detector: async () => INSTALLED,
    async processRunner() {
      processCalls += 1;
      return { code: 0, signal: null };
    },
  });

  const login = await handlers.authLogin();
  assert.equal(login.connected, false);
  assert.match(login.error, /device login is disabled/i);
  assert.equal(await handlers.authLogout(), undefined);
  assert.equal(processCalls, 0);
});

test('hosted generation validates references and passes no renderer command or secret fields', async () => {
  const specs = [];
  const handlers = createHiggsfieldHandlers({
    detector: async () => INSTALLED,
    async processRunner(spec, io) {
      specs.push(spec);
      io.onStdout('{"status":"queued"}\n');
      io.onStdout(`${resultJson()}\n`);
      return { code: 0, signal: null };
    },
  });

  assert.deepEqual(await handlers.generate(generationParams({
    referenceValue: 'https://media.example.com/reference.jpg',
    executable: '/tmp/attacker-controlled',
    apiKey: 'renderer-secret-must-not-propagate',
  })), {
    url: 'https://cdn.example.com/generated.mp4',
    mediaType: 'video',
    durationSec: 6,
    jobId: 'job_123',
    model: 'seedance_2_0',
  });

  assert.deepEqual(specs[0].args, [
    'generate', 'create', 'seedance_2_0', '--prompt', 'Make the scene feel cinematic',
    '--start-image', 'https://media.example.com/reference.jpg', '--wait', '--json',
  ]);
  assert.equal(JSON.stringify(specs[0]).includes('renderer-secret-must-not-propagate'), false);
  assert.equal(JSON.stringify(specs[0]).includes('attacker-controlled'), false);

  await assert.rejects(
    handlers.generate(generationParams({ referenceValue: 'https://127.0.0.1/private.jpg' })),
    (error) => error.code === 'INVALID_URL',
  );
  await assert.rejects(
    handlers.generate(generationParams({ model: 'seedance; touch /tmp/nope' })),
    (error) => error.code === 'INVALID_INPUT',
  );
  assert.equal(specs.length, 1);
});

test('generic generation resolves web media and forwards scalar, object, and array inputs', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-higgsfield-generic-test-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const uploadDirectory = path.join(dataRoot, 'media', 'uploads');
  await fs.mkdir(uploadDirectory, { recursive: true });
  const audioPath = path.join(uploadDirectory, 'reference.wav');
  const imagePath = path.join(uploadDirectory, 'cover.png');
  await Promise.all([
    fs.writeFile(audioPath, 'audio'),
    fs.writeFile(imagePath, 'image'),
  ]);

  const specs = [];
  const handlers = createHiggsfieldHandlers({
    dataRoot,
    detector: async () => INSTALLED,
    async processRunner(spec, io) {
      specs.push(spec);
      io.onStdout(resultJson({ result_url: 'https://cdn.example.com/generated.wav' }));
      return { code: 0, signal: null };
    },
  });

  const generated = await handlers.generate({
    model: 'seed_audio',
    outputType: 'audio',
    inputs: {
      prompt: 'Cinematic rain ambience',
      higgsfield_media_inputs: [
        { value: '/media/uploads/cover.png', role: 'image' },
      ],
      input_audio: '/media/uploads/reference.wav',
      loudness_rate: 0,
      enable_safety_checker: false,
      voices: [{ id: 'narrator', weight: 0 }],
      config: {
        image_url: 'local-media://file/media/uploads/cover.png',
        enabled: false,
      },
    },
  });

  assert.equal(generated.mediaType, 'audio');
  assert.deepEqual(specs[0].args, [
    'generate', 'create', 'seed_audio', '--prompt', 'Cinematic rain ambience',
    '--image', await fs.realpath(imagePath),
    '--audio', await fs.realpath(audioPath),
    '--loudness_rate', '0',
    '--enable_safety_checker', 'false',
    '--voices', '[{"id":"narrator","weight":0}]',
    '--config', JSON.stringify({ image_url: await fs.realpath(imagePath), enabled: false }),
    '--wait', '--json',
  ]);

  await assert.rejects(
    handlers.generate({
      model: 'seed_audio',
      outputType: 'audio',
      inputs: { input_audio: 'https://127.0.0.1/private.wav' },
    }),
    (error) => error.code === 'INVALID_URL',
  );
  await assert.rejects(
    handlers.generate({
      model: 'seed_audio',
      outputType: 'audio',
      inputs: { input_audio: '/etc/passwd' },
    }),
    (error) => error.code === 'LOCAL_MEDIA_UNAVAILABLE',
  );
  assert.equal(specs.length, 1);
});

test('raw medias infer roles from extensions and fall back by output kind', async () => {
  const specs = [];
  const handlers = createHiggsfieldHandlers({
    detector: async () => INSTALLED,
    async processRunner(spec, io) {
      specs.push(spec);
      io.onStdout(resultJson());
      return { code: 0, signal: null };
    },
  });

  await handlers.generate({
    model: 'brain_activity',
    outputType: 'text',
    inputs: {
      medias: ['https://cdn.example.com/ad.mp4', 'opaque-text-reference'],
    },
  });
  await handlers.generate({
    model: 'seedance_2_0',
    outputType: 'video',
    inputs: {
      medias: ['https://cdn.example.com/unknown-reference', 'https://cdn.example.com/track.wav'],
    },
  });
  await handlers.generate({
    model: 'seed_audio',
    outputType: 'audio',
    inputs: { medias: ['opaque-audio-reference'] },
  });
  await handlers.generate({
    model: 'tripo_3d',
    outputType: '3d',
    inputs: { medias: ['opaque-image-reference'] },
  });

  assert.deepEqual(specs[0].args, [
    'generate', 'create', 'brain_activity',
    '--video', 'https://cdn.example.com/ad.mp4',
    '--video', 'opaque-text-reference',
    '--wait', '--json',
  ]);
  assert.deepEqual(specs[1].args, [
    'generate', 'create', 'seedance_2_0',
    '--start-image', 'https://cdn.example.com/unknown-reference',
    '--audio', 'https://cdn.example.com/track.wav',
    '--wait', '--json',
  ]);
  assert.deepEqual(specs[2].args, [
    'generate', 'create', 'seed_audio',
    '--audio', 'opaque-audio-reference',
    '--wait', '--json',
  ]);
  assert.deepEqual(specs[3].args, [
    'generate', 'create', 'tripo_3d',
    '--image', 'opaque-image-reference',
    '--wait', '--json',
  ]);
});

test('Quick Edit resolves only staged web media, preserves roles, and always cleans up', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-higgsfield-test-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const uploadDirectory = path.join(dataRoot, 'media', 'uploads');
  await fs.mkdir(uploadDirectory, { recursive: true });
  const sourcePath = path.join(uploadDirectory, 'source.mp4');
  const cleanPath = path.join(uploadDirectory, 'clean.png');
  const guidePath = path.join(uploadDirectory, 'guide.png');
  await Promise.all([
    fs.writeFile(sourcePath, 'video'),
    fs.writeFile(cleanPath, 'clean'),
    fs.writeFile(guidePath, 'guide'),
  ]);

  const specs = [];
  const preparations = [];
  let cleanupCalls = 0;
  const handlers = createHiggsfieldHandlers({
    dataRoot,
    detector: async () => INSTALLED,
    async mediaPreparer(localPath, options) {
      preparations.push({ localPath, options });
      return {
        paths: ['/server/prepared/first.jpg', '/server/prepared/last.jpg'],
        roles: ['start_image', 'end_image'],
        cleanup: async () => { cleanupCalls += 1; },
      };
    },
    async processRunner(spec, io) {
      specs.push(spec);
      io.onStdout(resultJson());
      return { code: 0, signal: null };
    },
  });

  const first = await handlers.quickEdit({
    fileRef: 'local-media://file/media/uploads/source.mp4',
    prompt: 'Extend this camera move',
    model: 'seedance_2_0',
    outputType: 'video',
    referenceMode: 'first-last',
    sourceStartSec: 2,
    sourceEndSec: 8,
    aspectRatio: '16:9',
  });
  assert.equal(first.url, 'https://cdn.example.com/generated.mp4');
  assert.equal(preparations[0].localPath, await fs.realpath(sourcePath));
  assert.deepEqual(preparations[0].options, {
    referenceMode: 'first-last',
    frameTimeSec: undefined,
    sourceStartSec: 2,
    sourceEndSec: 8,
  });
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(specs[0].args, [
    'generate', 'create', 'seedance_2_0', '--prompt', 'Extend this camera move',
    '--start-image', '/server/prepared/first.jpg',
    '--end-image', '/server/prepared/last.jpg',
    '--aspect_ratio', '16:9', '--wait', '--json',
  ]);

  await handlers.quickEdit({
    fileRef: '/media/uploads/source.mp4',
    drawnFramePath: '/media/uploads/clean.png',
    guideFramePath: '/media/uploads/guide.png',
    prompt: 'Replace the marked sign',
    model: 'seedance_2_0',
    outputType: 'video',
    referenceMode: 'frame',
  });
  assert.equal(preparations.length, 1);
  assert.deepEqual(specs[1].args, [
    'generate', 'create', 'seedance_2_0', '--prompt', 'Replace the marked sign',
    '--start-image', await fs.realpath(cleanPath),
    '--image', await fs.realpath(guidePath), '--wait', '--json',
  ]);

  await assert.rejects(
    handlers.quickEdit({
      fileRef: '/etc/passwd',
      prompt: 'Unsafe source',
      model: 'seedance_2_0',
      outputType: 'video',
      referenceMode: 'frame',
    }),
    (error) => error.code === 'LOCAL_MEDIA_UNAVAILABLE',
  );
  await assert.rejects(
    handlers.quickEdit({
      fileRef: '/media/%2e%2e/secret.mp4',
      prompt: 'Unsafe source',
      model: 'seedance_2_0',
      outputType: 'video',
      referenceMode: 'frame',
    }),
    (error) => error.code === 'INVALID_URL',
  );
  assert.equal(specs.length, 2);
});

test('timeouts, output caps, auth failures, and server shutdown cancellation are bounded', async () => {
  const timeoutHandlers = createHiggsfieldHandlers({
    detector: async () => INSTALLED,
    generateTimeoutMs: 10,
    processRunner: async (spec) => new Promise((resolve) => {
      spec.signal.addEventListener('abort', () => resolve({ code: null, signal: 'SIGTERM' }), { once: true });
    }),
  });
  await assert.rejects(
    timeoutHandlers.generate(generationParams()),
    (error) => error.code === 'HIGGSFIELD_TIMEOUT' && error.statusCode === 504,
  );

  const cappedHandlers = createHiggsfieldHandlers({
    detector: async () => INSTALLED,
    maxOutputBytes: 64,
    async processRunner(_spec, io) {
      io.onStdout(Buffer.alloc(128, 65));
      return { code: 0, signal: null };
    },
  });
  await assert.rejects(
    cappedHandlers.generate(generationParams()),
    (error) => error.code === 'OUTPUT_LIMIT',
  );

  const unauthenticatedHandlers = createHiggsfieldHandlers({
    detector: async () => INSTALLED,
    async processRunner(_spec, io) {
      io.onStderr('session expired');
      return { code: 1, signal: null };
    },
  });
  await assert.rejects(
    unauthenticatedHandlers.generate(generationParams()),
    (error) => error.code === 'HIGGSFIELD_AUTH_REQUIRED' && error.statusCode === 422,
  );

  let runnerStarted = false;
  let observedAbort = false;
  const service = createHiggsfieldService({
    detector: async () => INSTALLED,
    processRunner: async (spec) => new Promise((resolve) => {
      runnerStarted = true;
      spec.signal.addEventListener('abort', () => {
        observedAbort = true;
        resolve({ code: null, signal: 'SIGTERM' });
      }, { once: true });
    }),
  });
  const pending = service.handlers.generate(generationParams());
  while (!runnerStarted) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.context.activeOperationCount(), 1);
  service.context.cancelAll();
  await assert.rejects(pending, (error) => error.code === 'REQUEST_CANCELLED');
  assert.equal(observedAbort, true);
  assert.equal(service.context.activeOperationCount(), 0);
  assert.equal(higgsfieldCapabilities.browserProgressEvents, false);
  assert.equal(higgsfieldCapabilities.browserCancellation, false);
  assert.equal(higgsfieldCapabilities.serverShutdownCancellation, true);
  assert.equal(higgsfieldCapabilities.generateList, true);
});

test('generateList, get-by-jobId, and submit-without-wait follow the desktop CLI contract', async () => {
  const specs = [];
  const handlers = createHiggsfieldHandlers({
    detector: async () => INSTALLED,
    async processRunner(spec, io) {
      specs.push(spec);
      if (spec.args[1] === 'list') {
        io.onStdout(JSON.stringify({
          jobs: [{ id: 'job-1', job_type: 'seedance_2_5' }],
        }));
      } else if (spec.args[1] === 'get') {
        io.onStdout(resultJson({ id: spec.args[2] }));
      } else {
        io.onStdout('{"status":"queued","id":"job_queued"}\n');
      }
      return { code: 0, signal: null };
    },
  });

  assert.deepEqual(await handlers.generateList({ video: true, size: 20 }), [
    { id: 'job-1', job_type: 'seedance_2_5' },
  ]);
  assert.deepEqual(specs[0].args, ['generate', 'list', '--video', '--size', '20', '--json']);

  assert.equal((await handlers.generate({
    jobId: '54a6e548-2a69-4073-80a0-bbce1641a7e9',
    model: 'seedance_2_5',
    outputType: 'video',
    wait: false,
  })).url, 'https://cdn.example.com/generated.mp4');
  assert.deepEqual(specs[1].args, [
    'generate', 'get', '54a6e548-2a69-4073-80a0-bbce1641a7e9', '--json',
  ]);

  assert.deepEqual(await handlers.generate(generationParams({ wait: false })), {
    jobId: 'job_queued',
    mediaType: 'video',
    model: 'seedance_2_0',
  });
  assert.equal(specs[2].args.includes('--wait'), false);
  assert.equal(specs[2].args.at(-1), '--json');
});
