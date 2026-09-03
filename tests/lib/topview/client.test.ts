import { describe, expect, it } from 'vitest';
import {
  buildTopviewVideoRequest,
  isPublicTopviewReferenceAddress,
  normalizeTopviewToolRequest,
  topviewCreditBalance,
  topviewReferenceVideoFloorError,
  topviewReferenceVideoMinPixels,
  topviewRejectionHint,
  topviewTaskTypeForMedias,
} from '../../../electron/ipc/topview';
import { minimumEvenFrameSize, parseVideoFrameSize } from '../../../electron/lib/video-frame-size';
import {
  topviewRequiresInheritedVideoDuration,
  TOPVIEW_INHERITED_VIDEO_DURATION,
} from '../../../src/lib/topview/video-duration';

const videoConfig = {
  preferredSubmitModel: 'seedance-2-5',
  models: [{
    submitModel: 'seedance-2-5',
    displayName: 'Seedance 2.5',
    nativeAudio: true,
    requiredSubmitFields: [
      'taskType', 'model', 'prompt', 'boardId', 'aspectRatio', 'resolution', 'duration',
      'sound', 'generatingCount', 'inputImages',
    ],
    defaultSubmitParameters: {
      aspectRatio: '16:9',
      resolution: 720,
      duration: 5,
      sound: 'off',
      generatingCount: 1,
    },
    submitParameterOptions: {
      aspectRatio: ['16:9', '9:16'],
      resolution: [480, 720],
      duration: Array.from({ length: 27 }, (_, index) => index + 4),
      sound: ['on', 'off'],
      generatingCount: [1, 2, 3, 4],
    },
  }],
};

describe('Topview MCP video adapter', () => {
  it('reads the official MCP and API credit response shapes', () => {
    expect(topviewCreditBalance({ result: { remainCredit: 69.53 } })).toBe(69.53);
    expect(topviewCreditBalance({ remain_credit: '42.5' })).toBe(42.5);
    expect(topviewCreditBalance({ unrelated: 12 })).toBeUndefined();
  });

  it('conforms outgoing arguments to the connected MCP tool schema', () => {
    const inputSchema = {
      type: 'object',
      properties: {
        req: {
          type: 'object',
          properties: {
            taskType: { type: 'string' },
            duration: { type: 'integer' },
            needAccelerateUrl: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    };
    expect(normalizeTopviewToolRequest(inputSchema, {
      taskType: 'omni_reference',
      duration: '20',
      needAccelerateUrl: 'false',
      sound: 'on',
    })).toEqual({
      taskType: 'omni_reference',
      duration: 20,
      needAccelerateUrl: false,
    });
  });

  it('routes generic images to omni-reference and reserves image-to-video for a start frame', () => {
    expect(topviewTaskTypeForMedias([{ value: '/tmp/reference.png', role: 'image' }]))
      .toBe('omni_reference');
    expect(topviewTaskTypeForMedias([{ value: '/tmp/start.png', role: 'start_image' }]))
      .toBe('image_to_video');
    expect(topviewTaskTypeForMedias([
      { value: '/tmp/start.png', role: 'start_image' },
      { value: '/tmp/end.png', role: 'end_image' },
    ])).toBe('image_to_video');
  });

  it('uses exact live-config fields and the Topview sound enum', () => {
    const built = buildTopviewVideoRequest({
      config: videoConfig,
      taskType: 'omni_reference',
      params: {
        prompt: 'Keep the exact product design.',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSec: 8,
        generateAudio: true,
      },
      references: [{ value: '/tmp/product.png', role: 'image', fileId: 'file_product' }],
      boardId: 'board_1',
    });

    expect(built.model).toBe('seedance-2-5');
    expect(built.durationSec).toBe(8);
    expect(built.req).toMatchObject({
      taskType: 'omni_reference',
      model: 'seedance-2-5',
      boardId: 'board_1',
      aspectRatio: '9:16',
      resolution: 720,
      duration: 8,
      sound: 'on',
      generatingCount: 1,
      inputImages: [{ fileId: 'file_product', name: 'Image1' }],
    });
    expect(built.req).not.toHaveProperty('generateAudio');
    expect(built.req).not.toHaveProperty('firstFrameFileId');
    expect(String(built.req.prompt)).toContain('<<<Image1>>>');
  });

  it('does not mistake missing optional sound metadata for an unsupported model', () => {
    const model = videoConfig.models[0];
    const configWithoutSoundMetadata = {
      preferredSubmitModel: 'seedance-2-5',
      models: [{
        ...model,
        nativeAudio: undefined,
        requiredSubmitFields: model.requiredSubmitFields.filter((field) => field !== 'sound' && field !== 'inputImages'),
        defaultSubmitParameters: { ...model.defaultSubmitParameters, sound: undefined },
        submitParameterOptions: { ...model.submitParameterOptions, sound: undefined },
      }],
    };
    const built = buildTopviewVideoRequest({
      config: configWithoutSoundMetadata,
      taskType: 'text_to_video',
      params: { prompt: 'A dialogue scene with synchronized sound.', generateAudio: true },
      references: [],
      boardId: 'board_1',
    });

    expect(built.model).toBe('seedance-2-5');
    expect(built.req.sound).toBe('on');
  });

  it('submits fixed-length models that expose no duration parameter', () => {
    // Gemini Omni Flash, the Kling Omni editors, and Grok Video Edit advertise no
    // duration at all. Refusing the request here stopped them running from a Space.
    const fixedLength = {
      preferredSubmitModel: 'gemini-omni-flash-ext',
      models: [{
        submitModel: 'gemini-omni-flash-ext',
        displayName: 'Gemini Omni Flash',
        requiredSubmitFields: ['taskType', 'model', 'prompt', 'resolution', 'aspectRatio'],
        defaultSubmitParameters: { aspectRatio: '16:9', resolution: 720 },
        submitParameterOptions: { aspectRatio: ['9:16', '16:9'], resolution: [720] },
      }],
    };
    const built = buildTopviewVideoRequest({
      config: fixedLength,
      taskType: 'omni_reference',
      params: { prompt: 'Hold on the miner as the lamps flare.', durationSec: 5 },
      references: [{ value: '/tmp/face.png', role: 'image', fileId: 'file_face' }],
      boardId: 'board_1',
    });

    expect(built.model).toBe('gemini-omni-flash-ext');
    expect(built.durationSec).toBeUndefined();
    expect(built.req).not.toHaveProperty('duration');
    expect(built.req).toMatchObject({ taskType: 'omni_reference', resolution: 720, aspectRatio: '16:9' });
  });

  it('keeps prompts clear of the watermark wording Topview reads as a copyright request', () => {
    const built = buildTopviewVideoRequest({
      config: videoConfig,
      taskType: 'omni_reference',
      params: { prompt: 'A wide establishing shot of the valley.' },
      references: [{ value: '/tmp/valley.png', role: 'image', fileId: 'file_valley' }],
      boardId: 'board_1',
    });

    expect(String(built.req.prompt)).not.toMatch(/watermark/i);
    expect(String(built.req.prompt)).toContain('on-screen text');
  });

  it('does not invent a global reference cap or accept unsupported roles', () => {
    expect(topviewTaskTypeForMedias(Array.from({ length: 17 }, (_, index) => ({
      value: `/tmp/${index}.png`, role: 'image',
    })))).toBe('omni_reference');
    expect(() => topviewTaskTypeForMedias([{ value: '/tmp/thing.bin', role: 'document' }]))
      .toThrow(/does not support element role/i);
  });

  it('catches undersized Seedance reference videos before the upload spends credits', () => {
    // Seedance 2.x bills and refunds before reporting this, so the floor has to be local.
    expect(topviewReferenceVideoMinPixels('seedance-2-5')).toBe(407_696);
    expect(topviewReferenceVideoMinPixels('Seedance 2.5')).toBe(407_696);
    expect(topviewReferenceVideoMinPixels('Seedance_2_5')).toBe(407_696);
    expect(topviewReferenceVideoMinPixels('dreamina-seedance-2-0-260128')).toBe(409_600);
    expect(topviewReferenceVideoMinPixels('kling-o3-reference')).toBeUndefined();

    const undersized = topviewReferenceVideoFloorError({
      submitModel: 'seedance-2-5', width: 640, height: 360,
    });
    expect(undersized).toMatch(/640x360/);
    expect(undersized).toMatch(/407,696/);
    expect(undersized).toMatch(/854x480/);

    // 854x480 and 960x540 clear the floor; a model without a floor never blocks.
    expect(topviewReferenceVideoFloorError({ submitModel: 'seedance-2-5', width: 854, height: 480 }))
      .toBeUndefined();
    expect(topviewReferenceVideoFloorError({ submitModel: 'seedance-2-5', width: 960, height: 540 }))
      .toBeUndefined();
    expect(topviewReferenceVideoFloorError({ submitModel: 'kling-o3-reference', width: 640, height: 360 }))
      .toBeUndefined();
  });

  it('reads ffprobe frame dimensions used by the reference-video guard', () => {
    expect(parseVideoFrameSize('640x360\n')).toEqual({ width: 640, height: 360 });
    expect(parseVideoFrameSize('854,480\n')).toEqual({ width: 854, height: 480 });
    expect(parseVideoFrameSize('not-a-size')).toBeUndefined();
  });

  it('chooses even compatibility dimensions for common aspect ratios', () => {
    expect(minimumEvenFrameSize({ width: 640, height: 360 }, 409_600))
      .toEqual({ width: 854, height: 480 });
    expect(minimumEvenFrameSize({ width: 360, height: 640 }, 409_600))
      .toEqual({ width: 480, height: 854 });
    expect(minimumEvenFrameSize({ width: 320, height: 320 }, 409_600))
      .toEqual({ width: 640, height: 640 });
    expect(minimumEvenFrameSize({ width: 1280, height: 720 }, 409_600))
      .toEqual({ width: 1280, height: 720 });
  });

  it('explains the provider-side pixel-count rejection', () => {
    const hint = topviewRejectionHint(
      'The parameter `content[2]` specified in the request is not valid: the parameter video '
      + 'pixel count specified in the request must be greater than or equal to 407696 for '
      + 'model dreamina-seedance-2-5 in r2v',
    );
    expect(hint).toMatch(/reference video/i);
    expect(hint).toMatch(/407,696/);
    expect(hint).toMatch(/854x480/);
  });

  it('sends the inherited clip duration when Seedance treats the job as video editing', () => {
    // An edit takes its length from the attached clip, and the sentinel is deliberately
    // outside the advertised 4-30s duration options.
    const built = buildTopviewVideoRequest({
      config: videoConfig,
      taskType: 'omni_reference',
      params: { prompt: 'Replace the player in the video with the reference character.', durationSec: 4 },
      references: [
        { value: '/tmp/character.png', role: 'image', fileId: 'file_character' },
        { value: '/tmp/match.mp4', role: 'video', fileId: 'file_match' },
      ],
      boardId: 'board_1',
      inheritInputVideoDuration: true,
    });

    expect(built.req.duration).toBe(TOPVIEW_INHERITED_VIDEO_DURATION);
    // The render's length is the clip's, so submit must not claim the requested 4s.
    expect(built.durationSec).toBeUndefined();
    expect(built.req).toMatchObject({ inputVideos: [{ fileId: 'file_match', name: 'Video1' }] });
  });

  it('detects only the provider rejection that demands the inherited duration', () => {
    const rejection = 'The parameter `duration` specified in the request is not valid. Seedance '
      + 'identified your task as video editing based on your prompt. For this task type, the '
      + 'output ratio and duration follow the input video selected by the model for editing, and '
      + 'the video selected must satisfy the duration requirement of 4 to 30 seconds. '
      + 'Issues: [0] `duration` must be -1.';
    expect(topviewRequiresInheritedVideoDuration(rejection)).toBe(true);

    // The sentinel has to survive whichever dash the provider renders it with.
    for (const dash of ['-', '\u2010', '\u2012', '\u2013', '\u2014', '\u2212']) {
      expect(topviewRequiresInheritedVideoDuration(`Issues: [0] \`duration\` must be ${dash}1.`), dash)
        .toBe(true);
    }
    expect(topviewRequiresInheritedVideoDuration('Issues: [0] `duration` must be `-1`')).toBe(true);

    // A different parameter asking for -1 is not this rejection.
    expect(topviewRequiresInheritedVideoDuration('`generatingCount` must be -1')).toBe(false);
    expect(topviewRequiresInheritedVideoDuration('does not allow duration=3')).toBe(false);
    expect(topviewRequiresInheritedVideoDuration('video pixel count must be >= 407696')).toBe(false);

    const hint = topviewRejectionHint(rejection);
    expect(hint).toMatch(/edit of the attached clip/i);
    expect(hint).toMatch(/4-30 second/i);
  });

  it('treats a requested -1 duration as the inherit sentinel, not an allowed option', () => {
    // The renderer resubmits with -1 after the provider's verdict; the advertised duration
    // options are 4-30, so the option check must not reject the provider's own requirement.
    const built = buildTopviewVideoRequest({
      config: videoConfig,
      taskType: 'omni_reference',
      params: {
        prompt: 'Replace the player in the video with the reference character.',
        durationSec: TOPVIEW_INHERITED_VIDEO_DURATION,
      },
      references: [
        { value: '/tmp/character.png', role: 'image', fileId: 'file_character' },
        { value: '/tmp/match.mp4', role: 'video', fileId: 'file_match' },
      ],
      boardId: 'board_1',
    });

    expect(built.req.duration).toBe(TOPVIEW_INHERITED_VIDEO_DURATION);
    expect(built.durationSec).toBeUndefined();
  });

  it('rejects private, local, reserved, and transition IP addresses', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1', '2001:db8::1', '::ffff:127.0.0.1']) {
      expect(isPublicTopviewReferenceAddress(address), address).toBe(false);
    }
    expect(isPublicTopviewReferenceAddress('8.8.8.8')).toBe(true);
    expect(isPublicTopviewReferenceAddress('2606:4700:4700::1111')).toBe(true);
  });
});
