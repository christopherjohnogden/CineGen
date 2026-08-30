import { describe, expect, it } from 'vitest';
import {
  buildTopviewVideoRequest,
  isPublicTopviewReferenceAddress,
  normalizeTopviewToolRequest,
  topviewCreditBalance,
  topviewTaskTypeForMedias,
} from '../../../electron/ipc/topview';

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
    expect(String(built.req.prompt)).toContain('<IMAGE1>');
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

  it('does not invent a global reference cap or accept unsupported roles', () => {
    expect(topviewTaskTypeForMedias(Array.from({ length: 17 }, (_, index) => ({
      value: `/tmp/${index}.png`, role: 'image',
    })))).toBe('omni_reference');
    expect(() => topviewTaskTypeForMedias([{ value: '/tmp/thing.bin', role: 'document' }]))
      .toThrow(/does not support element role/i);
  });

  it('rejects private, local, reserved, and transition IP addresses', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1', '2001:db8::1', '::ffff:127.0.0.1']) {
      expect(isPublicTopviewReferenceAddress(address), address).toBe(false);
    }
    expect(isPublicTopviewReferenceAddress('8.8.8.8')).toBe(true);
    expect(isPublicTopviewReferenceAddress('2606:4700:4700::1111')).toBe(true);
  });
});
