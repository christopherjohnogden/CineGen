export type VideoGenerationProvider = 'topview' | 'higgsfield' | 'artlist' | 'runpod';

export const DEFAULT_VIDEO_GENERATION_PROVIDER: VideoGenerationProvider = 'topview';
export const VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION = 1;
export const VIDEO_PROVIDER_ADAPTERS: Record<VideoGenerationProvider, string> = {
  topview: 'topview-auto',
  higgsfield: 'seedance-2.5',
  artlist: 'artlist-auto',
  runpod: 'runpod-ltx-2.5',
};

export function isVideoGenerationProvider(value: unknown): value is VideoGenerationProvider {
  return value === 'topview' || value === 'higgsfield' || value === 'artlist' || value === 'runpod';
}

export function getVideoGenerationProvider(): VideoGenerationProvider {
  if (typeof window === 'undefined') return DEFAULT_VIDEO_GENERATION_PROVIDER;
  try {
    const raw = localStorage.getItem('cinegen_settings');
    if (!raw) return DEFAULT_VIDEO_GENERATION_PROVIDER;
    const parsed = JSON.parse(raw) as {
      videoGenerationProvider?: unknown;
      videoGenerationProviderSettingsVersion?: unknown;
    };
    if (parsed.videoGenerationProviderSettingsVersion !== VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION) {
      return DEFAULT_VIDEO_GENERATION_PROVIDER;
    }
    const value = parsed.videoGenerationProvider;
    return isVideoGenerationProvider(value) ? value : DEFAULT_VIDEO_GENERATION_PROVIDER;
  } catch {
    return DEFAULT_VIDEO_GENERATION_PROVIDER;
  }
}

export function adapterIdForVideoProvider(provider: VideoGenerationProvider): string {
  return VIDEO_PROVIDER_ADAPTERS[provider];
}
