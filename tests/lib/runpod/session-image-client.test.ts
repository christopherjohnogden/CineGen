import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateSessionImageAndWait,
  isRetryableRunpodSessionImagePollError,
  normalizeRunpodSessionImageInput,
} from '@/lib/runpod/session-image-client';

describe('RunPod generation-session image client', () => {
  const generateSessionImage = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    generateSessionImage.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { pod: { generateSessionImage } },
    });
  });

  function configureSession(): void {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodKey: 'must-not-be-sent',
      runpodLtxPodId: ' pod-123 ',
      runpodLtxPodUrl: ' https://pod-123-8000.proxy.runpod.net/ ',
      runpodLtxPodAuthToken: ' pod-bearer-token ',
    }));
  }

  it('submits normalized SDXL input and polls the same authenticated job', async () => {
    configureSession();
    generateSessionImage
      .mockResolvedValueOnce({ jobId: 'job-image-1', status: 'queued' })
      .mockResolvedValueOnce({
        jobId: 'job-image-1',
        status: 'completed',
        output: { url: 'https://cdn.example/sdxl.png', model: 'SDXL' },
      });
    const onJobId = vi.fn();

    await expect(generateSessionImageAndWait({
      model: 'sdxl',
      prompt: '  A rain-soaked soundstage  ',
      negativePrompt: '  illustration  ',
      width: 1024,
      height: 768,
      steps: 25,
      guidanceScale: 7.5,
      seed: 42,
    }, { sleep: async () => undefined, onJobId })).resolves.toEqual({
      jobId: 'job-image-1',
      url: 'https://cdn.example/sdxl.png',
      model: 'SDXL',
    });

    expect(generateSessionImage).toHaveBeenNthCalledWith(1, {
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-bearer-token',
      model: 'sdxl',
      input: {
        model: 'sdxl',
        prompt: 'A rain-soaked soundstage',
        negativePrompt: 'illustration',
        width: 1024,
        height: 768,
        steps: 25,
        guidanceScale: 7.5,
        seed: 42,
      },
    });
    expect(generateSessionImage).toHaveBeenNthCalledWith(2, {
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-bearer-token',
      model: 'sdxl',
      jobId: 'job-image-1',
    });
    expect(generateSessionImage.mock.calls[0][0]).not.toHaveProperty('runpodKey');
    expect(onJobId).toHaveBeenCalledWith('job-image-1');
  });

  it('passes one to three unique images to Qwen Image Edit', async () => {
    configureSession();
    generateSessionImage.mockResolvedValue({
      jobId: 'job-qwen',
      status: 'completed',
      output: { url: 'local-media://file/result.png', model: 'Qwen Image Edit 2511' },
    });

    await generateSessionImageAndWait({
      model: 'qwen-image-edit',
      prompt: '  Replace the sky with storm clouds.  ',
      referenceImages: [
        ' https://cdn.example/base.png ',
        'https://cdn.example/look.png',
        'https://cdn.example/base.png',
      ],
      width: 1280,
      height: 768,
      seed: 77,
    });

    expect(generateSessionImage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen-image-edit',
      input: {
        model: 'qwen-image-edit',
        prompt: 'Replace the sky with storm clouds.',
        referenceImages: [
          'https://cdn.example/base.png',
          'https://cdn.example/look.png',
        ],
        width: 1280,
        height: 768,
        seed: 77,
      },
    }));
  });

  it('validates each model\'s truthful reference-image contract', () => {
    expect(() => normalizeRunpodSessionImageInput({
      model: 'qwen-image-edit',
      prompt: 'Edit this.',
    })).toThrow('requires at least one source image');

    expect(() => normalizeRunpodSessionImageInput({
      model: 'qwen-image-edit',
      prompt: 'Edit this.',
      referenceImages: ['1.png', '2.png', '3.png', '4.png'],
    })).toThrow('supports up to three reference images');

    expect(() => normalizeRunpodSessionImageInput({
      model: 'sdxl',
      prompt: 'Create this.',
      referenceImages: ['source.png'],
    })).toThrow('text-to-image');
  });

  it('keeps legacy missing-task failures resumable instead of creating another paid image', () => {
    expect(isRetryableRunpodSessionImagePollError(
      new Error('The Pod returned an invalid image-generation task.'),
    )).toBe(true);
  });

  it('retries transient polling failures without resubmitting the paid image', async () => {
    configureSession();
    generateSessionImage
      .mockResolvedValueOnce({ jobId: 'job-image-2', status: 'queued' })
      .mockRejectedValueOnce(new Error('524 Proxy Read Timeout'))
      .mockResolvedValueOnce({
        jobId: 'job-image-2',
        status: 'completed',
        output: { url: 'https://cdn.example/recovered.png' },
      });

    await expect(generateSessionImageAndWait({
      model: 'sdxl',
      prompt: 'A paid render.',
    }, { sleep: async () => undefined })).resolves.toMatchObject({ jobId: 'job-image-2' });

    expect(generateSessionImage).toHaveBeenCalledTimes(3);
    expect(generateSessionImage.mock.calls.slice(1).every(([request]) => (
      request.jobId === 'job-image-2' && request.model === 'sdxl' && !('input' in request)
    ))).toBe(true);
  });

  it('does not retry an ambiguous initial submission timeout', async () => {
    configureSession();
    generateSessionImage.mockRejectedValueOnce(new Error('524 Proxy Read Timeout'));

    await expect(generateSessionImageAndWait({
      model: 'sdxl',
      prompt: 'This request must only be submitted once.',
    }, { sleep: async () => undefined })).rejects.toThrow('524 Proxy Read Timeout');

    expect(generateSessionImage).toHaveBeenCalledOnce();
    expect(generateSessionImage.mock.calls[0][0]).toHaveProperty('input');
    expect(generateSessionImage.mock.calls[0][0]).not.toHaveProperty('jobId');
  });

  it('resumes a saved job ID without submitting another image', async () => {
    configureSession();
    generateSessionImage.mockResolvedValue({
      jobId: 'job-image-3',
      status: 'completed',
      output: { url: 'https://cdn.example/resumed.png' },
    });

    await generateSessionImageAndWait({
      model: 'qwen-image-edit',
      prompt: 'This prompt and its now-missing source must not be validated or sent again.',
    }, { resumeJobId: ' job-image-3 ' });

    expect(generateSessionImage).toHaveBeenCalledOnce();
    expect(generateSessionImage).toHaveBeenCalledWith({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-bearer-token',
      model: 'qwen-image-edit',
      jobId: 'job-image-3',
    });
  });
});
