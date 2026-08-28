import { beforeEach, describe, expect, it } from 'vitest';
import {
  adapterIdForVideoProvider,
  getVideoGenerationProvider,
  VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION,
} from '@/lib/utils/video-generation-provider';

describe('video generation provider setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to Topview and maps it to the live MCP adapter', () => {
    expect(getVideoGenerationProvider()).toBe('topview');
    expect(adapterIdForVideoProvider('topview')).toBe('topview-auto');
    expect(adapterIdForVideoProvider('higgsfield')).toBe('seedance-2.5');
  });

  it('routes Artlist settings to the Artlist Director adapter', () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      videoGenerationProvider: 'artlist',
      videoGenerationProviderSettingsVersion: VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION,
    }));
    expect(getVideoGenerationProvider()).toBe('artlist');
    expect(adapterIdForVideoProvider('artlist')).toBe('artlist-auto');
  });

  it('routes RunPod settings to the LTX-2.5 Director adapter', () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      videoGenerationProvider: 'runpod',
      videoGenerationProviderSettingsVersion: VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION,
    }));
    expect(getVideoGenerationProvider()).toBe('runpod');
    expect(adapterIdForVideoProvider('runpod')).toBe('runpod-ltx-2.5');
  });

  it('falls back safely when an old or unknown provider value is stored', () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({ videoGenerationProvider: 'unknown-provider' }));
    expect(getVideoGenerationProvider()).toBe('topview');
  });

  it('migrates an old saved provider selection to the new Topview default once', () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({ videoGenerationProvider: 'higgsfield' }));
    expect(getVideoGenerationProvider()).toBe('topview');
  });
});
