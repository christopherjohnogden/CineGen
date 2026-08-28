import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateLtx25AndWait } from '@/lib/runpod/ltx25-client';

describe('RunPod LTX-2.5 client', () => {
  const generateLtx25 = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    generateLtx25.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { pod: { generateLtx25 } },
    });
  });

  it('submits to the configured endpoint and polls the returned job', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodKey: 'runpod-key',
      runpodLtxPodId: ' pod-123 ',
      runpodLtxPodUrl: ' https://pod-123-8000.proxy.runpod.net/ ',
      runpodLtxPodAuthToken: ' pod-bearer-token ',
    }));
    generateLtx25
      .mockResolvedValueOnce({ jobId: 'job-456', status: 'queued' })
      .mockResolvedValueOnce({
        jobId: 'job-456',
        status: 'completed',
        output: { url: 'https://cdn.example/result.mp4', durationSec: 5, model: 'LTX-2.5' },
      });
    const onJobId = vi.fn();
    const onStatus = vi.fn();

    const result = await generateLtx25AndWait({
      prompt: '  A locked cinematic close-up  ',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
      referenceImages: [' https://cdn.example/ref.png ', 'https://cdn.example/ref.png'],
    }, { sleep: async () => undefined, onJobId, onStatus });

    expect(generateLtx25).toHaveBeenNthCalledWith(1, {
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-bearer-token',
      input: {
        prompt: 'A locked cinematic close-up',
        durationSec: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        generateAudio: true,
        referenceImages: ['https://cdn.example/ref.png'],
      },
    });
    expect(generateLtx25).toHaveBeenNthCalledWith(2, {
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-bearer-token',
      jobId: 'job-456',
    });
    expect(onJobId).toHaveBeenCalledWith('job-456');
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      phase: 'submitting',
      message: 'Submitting one LTX-2.5 render…',
    }));
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-456',
      status: 'queued',
      phase: 'checking',
    }));
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      jobId: 'job-456',
      status: 'completed',
    }));
    expect(result).toEqual({
      jobId: 'job-456',
      url: 'https://cdn.example/result.mp4',
      durationSec: 5,
      model: 'LTX-2.5',
    });
  });

  it('surfaces a failed RunPod job with its message', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodKey: 'runpod-key',
      runpodLtxPodId: 'pod-123',
      runpodLtxPodUrl: 'https://pod-123-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'pod-bearer-token',
    }));
    generateLtx25.mockResolvedValue({
      jobId: 'job-456',
      status: 'failed',
      error: 'The worker ran out of memory.',
    });

    await expect(generateLtx25AndWait({
      prompt: 'A shot',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    })).rejects.toThrow('The worker ran out of memory.');
  });

  it('uses the Pod bearer token without resending the RunPod API key', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-123',
      runpodLtxPodUrl: 'https://pod-123-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'pod-bearer-token',
    }));
    generateLtx25.mockResolvedValue({
      jobId: 'job-456',
      status: 'completed',
      output: { url: 'https://cdn.example/result.mp4' },
    });

    await generateLtx25AndWait({
      prompt: 'A shot',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    });

    expect(generateLtx25).toHaveBeenCalledWith(expect.objectContaining({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-bearer-token',
    }));
    expect(generateLtx25.mock.calls[0][0]).not.toHaveProperty('runpodKey');
  });

  it('retries a transient proxy timeout while polling the same paid job', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-123',
      runpodLtxPodUrl: 'https://pod-123-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'pod-bearer-token',
    }));
    generateLtx25
      .mockResolvedValueOnce({ jobId: 'job-456', status: 'queued' })
      .mockRejectedValueOnce(new Error('The origin web server did not return a complete response within the 120-second Proxy Read Timeout window. 524'))
      .mockResolvedValueOnce({
        jobId: 'job-456',
        status: 'completed',
        output: { url: 'https://cdn.example/result.mp4' },
      });

    await expect(generateLtx25AndWait({
      prompt: 'A shot',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    }, { sleep: async () => undefined })).resolves.toMatchObject({
      jobId: 'job-456',
      url: 'https://cdn.example/result.mp4',
    });

    expect(generateLtx25).toHaveBeenCalledTimes(3);
    expect(generateLtx25.mock.calls.slice(1).map(([request]) => request)).toEqual([
      expect.objectContaining({ jobId: 'job-456' }),
      expect.objectContaining({ jobId: 'job-456' }),
    ]);
    expect(generateLtx25.mock.calls.slice(1).every(([request]) => !('input' in request))).toBe(true);
  });

  it('never retries an ambiguous initial submission timeout', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-123',
      runpodLtxPodUrl: 'https://pod-123-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'pod-bearer-token',
    }));
    generateLtx25.mockRejectedValueOnce(new Error('524 Proxy Read Timeout'));

    await expect(generateLtx25AndWait({
      prompt: 'A shot that must only be billed once',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    }, { sleep: async () => undefined })).rejects.toThrow('524 Proxy Read Timeout');

    expect(generateLtx25).toHaveBeenCalledOnce();
    expect(generateLtx25.mock.calls[0][0]).toHaveProperty('input');
    expect(generateLtx25.mock.calls[0][0]).not.toHaveProperty('jobId');
  });

  it('does not retry a non-transient polling error', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-123',
      runpodLtxPodUrl: 'https://pod-123-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'pod-bearer-token',
    }));
    generateLtx25
      .mockResolvedValueOnce({ jobId: 'job-456', status: 'queued' })
      .mockRejectedValueOnce(new Error('Unauthorized (401)'));

    await expect(generateLtx25AndWait({
      prompt: 'A shot',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    }, { sleep: async () => undefined })).rejects.toThrow('Unauthorized (401)');

    expect(generateLtx25).toHaveBeenCalledTimes(2);
  });

  it('resumes a saved job ID without submitting the prompt again', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-123',
      runpodLtxPodUrl: 'https://pod-123-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'pod-bearer-token',
    }));
    generateLtx25.mockResolvedValue({
      jobId: 'job-456',
      status: 'completed',
      output: { url: 'https://cdn.example/result.mp4' },
    });
    const onJobId = vi.fn();

    await generateLtx25AndWait({
      prompt: 'This must not be submitted twice.',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    }, { resumeJobId: ' job-456 ', onJobId });

    expect(generateLtx25).toHaveBeenCalledOnce();
    expect(generateLtx25).toHaveBeenCalledWith({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-bearer-token',
      jobId: 'job-456',
    });
    expect(onJobId).toHaveBeenCalledWith('job-456');
  });

  it('keeps polling a resumed job after a transient proxy timeout', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-123',
      runpodLtxPodUrl: 'https://pod-123-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'pod-bearer-token',
    }));
    generateLtx25
      .mockRejectedValueOnce(new Error('The origin timed out with 524'))
      .mockResolvedValueOnce({
        jobId: 'job-456',
        status: 'completed',
        output: { url: 'https://cdn.example/result.mp4' },
      });
    const onJobId = vi.fn();

    await expect(generateLtx25AndWait({
      prompt: 'This prompt is not resubmitted.',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    }, {
      resumeJobId: 'job-456',
      onJobId,
      sleep: async () => undefined,
    })).resolves.toMatchObject({ jobId: 'job-456' });

    expect(onJobId).toHaveBeenCalledOnce();
    expect(generateLtx25).toHaveBeenCalledTimes(2);
    expect(generateLtx25.mock.calls.every(([request]) => request.jobId === 'job-456' && !('input' in request))).toBe(true);
  });

  it('explains when setup has not been completed', async () => {
    await expect(generateLtx25AndWait({
      prompt: 'A shot',
      durationSec: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    })).rejects.toThrow('Start an LTX-2.5 Pod session in Settings');
  });
});
