import { beforeEach, describe, expect, it } from 'vitest';
import {
  getRunpodSessionImageModels,
  isRunpodGenerationSessionReady,
} from '@/lib/utils/api-key';

describe('RunPod generation-session settings helpers', () => {
  beforeEach(() => localStorage.clear());

  it('uses immutable active model metadata for an existing Pod', () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-1',
      runpodLtxImageModels: ['sdxl', 'qwen-image-edit'],
    }));
    expect(getRunpodSessionImageModels()).toEqual([]);

    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-1',
      runpodLtxImageModels: ['sdxl'],
      runpodLtxActiveImageModels: ['qwen-image-edit', 'qwen-image-edit', 'unknown'],
    }));
    expect(getRunpodSessionImageModels()).toEqual(['qwen-image-edit']);
  });

  it('returns planned models without a Pod and requires ready authenticated state', () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxImageModels: ['sdxl', 'qwen-image-edit'],
      runpodLtxStatus: 'ready',
    }));
    expect(getRunpodSessionImageModels()).toEqual(['sdxl', 'qwen-image-edit']);
    expect(isRunpodGenerationSessionReady()).toBe(false);

    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxPodId: 'pod-1',
      runpodLtxPodUrl: 'https://pod-1-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'token',
      runpodLtxStatus: 'ready',
      runpodLtxActiveImageModels: ['sdxl'],
    }));
    expect(isRunpodGenerationSessionReady()).toBe(true);
  });
});
