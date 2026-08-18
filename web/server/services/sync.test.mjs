import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { createSyncHandlers } from './sync.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => (
    fsp.rm(directory, { recursive: true, force: true })
  )));
});

function probeJson({ timecode, duration = 10, video = false }) {
  return JSON.stringify({
    format: { duration: String(duration), tags: timecode ? { timecode } : {} },
    streams: [
      ...(video ? [{ codec_type: 'video', r_frame_rate: '24/1' }] : []),
      { codec_type: 'audio' },
    ],
  });
}

async function createFixture(processRunner) {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-sync-test-'));
  temporaryRoots.push(dataRoot);
  const mediaRoot = path.join(dataRoot, 'media');
  const projectId = 'project_1';
  const importedRoot = path.join(mediaRoot, 'projects', projectId, 'imported');
  await fsp.mkdir(importedRoot, { recursive: true });
  const files = {
    videoA: path.join(importedRoot, 'scene-001.mov'),
    videoB: path.join(importedRoot, 'scene-002.mov'),
    audioA: path.join(importedRoot, 'scene-001.wav'),
    audioB: path.join(importedRoot, 'scene-002.wav'),
    audioExtra: path.join(importedRoot, 'wild-track.wav'),
  };
  await Promise.all(Object.values(files).map((filePath) => fsp.writeFile(filePath, 'fixture')));
  const emitted = [];
  const calls = [];
  const handlers = createSyncHandlers({
    dataRoot,
    ffmpegPath: '/fixture/ffmpeg',
    ffprobePath: '/fixture/ffprobe',
    fpcalcPath: '/fixture/fpcalc',
    processRunner: async (request) => {
      calls.push(request);
      return processRunner(request);
    },
    store: {
      async load(id) {
        if (id !== projectId) throw new Error('Project not found');
        return { project: { id } };
      },
    },
    events: { emit: (event, payload) => emitted.push({ event, payload }) },
    pathForMediaReference(reference) {
      const pathname = decodeURIComponent(new URL(reference, 'http://cinegen.test').pathname);
      if (!pathname.startsWith('/media/')) throw new Error('not media');
      return path.join(mediaRoot, pathname.slice('/media/'.length));
    },
  });
  const refs = Object.fromEntries(Object.entries(files).map(([key, filePath]) => [
    key,
    `/media/${path.relative(mediaRoot, filePath).split(path.sep).map(encodeURIComponent).join('/')}`,
  ]));
  return { calls, dataRoot, emitted, files, handlers, mediaRoot, projectId, refs };
}

test('computeOffset prefers embedded timecode and preserves the renderer result shape', async () => {
  const fixture = await createFixture(async ({ kind, args }) => {
    assert.equal(kind, 'ffprobe');
    const filePath = args.at(-1);
    const source = filePath.endsWith('scene-001.mov');
    return {
      code: 0,
      stdout: probeJson({ timecode: source ? '01:00:00:00' : '01:00:02:12', video: source }),
      stderr: '',
    };
  });

  const result = await fixture.handlers.computeOffset({
    sourceAssetId: 'video_a',
    targetAssetId: 'audio_a',
    sourceFilePath: fixture.refs.videoA,
    targetFilePath: fixture.refs.audioA,
    projectId: fixture.projectId,
  });
  assert.deepEqual(result, { offsetSeconds: 2.5, method: 'timecode', confidence: 1 });
  assert.equal(fixture.calls.length, 2);
});

test('computeOffset falls back to fingerprint waveform correlation', async () => {
  const sourceFingerprint = Array.from({ length: 32 }, (_, index) => (index * 7919 + 17) | 0);
  const targetFingerprint = [111, 222, 333, ...sourceFingerprint.slice(0, 29)];
  const fixture = await createFixture(async ({ kind, args }) => {
    if (kind === 'ffprobe') {
      return { code: 0, stdout: probeJson({ video: args.at(-1).endsWith('.mov') }), stderr: '' };
    }
    assert.equal(kind, 'fpcalc');
    const values = args.at(-1).endsWith('.mov') ? sourceFingerprint : targetFingerprint;
    return { code: 0, stdout: `DURATION=10\nFINGERPRINT=${values.join(',')}\n`, stderr: '' };
  });

  const result = await fixture.handlers.computeOffset({
    sourceAssetId: 'video_a',
    targetAssetId: 'audio_a',
    sourceFilePath: fixture.refs.videoA,
    targetFilePath: fixture.refs.audioA,
    projectId: fixture.projectId,
  });
  assert.equal(result.method, 'waveform');
  assert.ok(result.confidence >= 0.9);
  assert.ok(Math.abs(result.offsetSeconds + 3 * 0.1238) < 1e-9);
});

test('batchMatch pairs by filename, returns unmatched ids, and emits compatible progress', async () => {
  const fixture = await createFixture(async ({ kind, args }) => {
    assert.equal(kind, 'ffprobe');
    const fileName = path.basename(args.at(-1));
    const isVideo = fileName.endsWith('.mov');
    const timecode = fileName.includes('001') ? '00:00:01:00' : '00:00:02:00';
    return { code: 0, stdout: probeJson({ timecode, video: isVideo }), stderr: '' };
  });
  const result = await fixture.handlers.batchMatch({
    projectId: fixture.projectId,
    videoAssets: [
      { id: 'video_a', name: 'scene-001.mov', filePath: fixture.refs.videoA },
      { id: 'video_b', name: 'scene-002.mov', filePath: fixture.refs.videoB },
    ],
    audioAssets: [
      { id: 'audio_b', name: 'scene-002.wav', filePath: fixture.refs.audioB },
      { id: 'audio_extra', name: 'wild-track.wav', filePath: fixture.refs.audioExtra },
      { id: 'audio_a', name: 'scene-001.wav', filePath: fixture.refs.audioA },
    ],
  });

  assert.deepEqual(result.pairs.map(({ videoAssetId, audioAssetId }) => ({ videoAssetId, audioAssetId })), [
    { videoAssetId: 'video_a', audioAssetId: 'audio_a' },
    { videoAssetId: 'video_b', audioAssetId: 'audio_b' },
  ]);
  assert.deepEqual(result.unmatchedVideos, []);
  assert.deepEqual(result.unmatchedAudio, ['audio_extra']);
  assert.equal(result.pairs.every((pair) => (
    pair.matchMethod === 'timecode'
      && pair.nameScore === 1
      && pair.waveformScore === 1
  )), true);

  const progress = fixture.emitted.filter(({ event }) => event === 'sync:batch-progress');
  assert.ok(progress.length >= 3);
  assert.match(progress[0].payload.jobId, /^[0-9a-f-]{36}$/i);
  assert.equal(progress.at(-1).payload.completedPairs, 2);
  assert.equal(progress.at(-1).payload.totalPairs, 2);
  assert.equal(progress.at(-1).payload.currentVideoName, '');
  assert.equal(progress.at(-1).payload.currentAudioName, '');
});

test('rejects project-crossing media, upload staging paths, and symlink escapes', async () => {
  const fixture = await createFixture(async () => ({ code: 0, stdout: probeJson({ video: true }), stderr: '' }));
  const projectTwoFile = path.join(fixture.mediaRoot, 'projects', 'project_2', 'imported', 'other.wav');
  await fsp.mkdir(path.dirname(projectTwoFile), { recursive: true });
  await fsp.writeFile(projectTwoFile, 'fixture');

  await assert.rejects(fixture.handlers.computeOffset({
    sourceAssetId: 'video_a',
    targetAssetId: 'audio_a',
    sourceFilePath: fixture.refs.videoA,
    targetFilePath: '/media/projects/project_2/imported/other.wav',
    projectId: fixture.projectId,
  }), (error) => error.code === 'PROJECT_MEDIA_MISMATCH');

  const uploadPath = path.join(fixture.mediaRoot, 'uploads', 'upload_1', 'loose.wav');
  await fsp.mkdir(path.dirname(uploadPath), { recursive: true });
  await fsp.writeFile(uploadPath, 'fixture');
  await assert.rejects(fixture.handlers.computeOffset({
    sourceAssetId: 'video_a',
    targetAssetId: 'audio_a',
    sourceFilePath: fixture.refs.videoA,
    targetFilePath: '/media/uploads/upload_1/loose.wav',
    projectId: fixture.projectId,
  }), (error) => error.code === 'PROJECT_MEDIA_MISMATCH');

  const outside = path.join(fixture.dataRoot, 'outside.wav');
  const link = path.join(path.dirname(fixture.files.audioA), 'linked.wav');
  await fsp.writeFile(outside, 'fixture');
  await fsp.symlink(outside, link);
  await assert.rejects(fixture.handlers.computeOffset({
    sourceAssetId: 'video_a',
    targetAssetId: 'audio_a',
    sourceFilePath: fixture.refs.videoA,
    targetFilePath: `/media/projects/${fixture.projectId}/imported/linked.wav`,
    projectId: fixture.projectId,
  }), (error) => error.code === 'PROJECT_MEDIA_MISMATCH');
});
