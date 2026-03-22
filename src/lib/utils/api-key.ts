function getSettingsValue(key: string): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem('cinegen_settings');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : undefined;
  } catch {
    return undefined;
  }
}

export type DefaultTranscriptionEngine = 'faster-whisper-local' | 'whisperx-local' | 'whisper-cloud';
export type VisionModel = string;

const DEFAULT_TRANSCRIPTION_ENGINE: DefaultTranscriptionEngine = 'whisperx-local';
const DEFAULT_BACKGROUND_VISION_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_CUT_VISION_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_MAX_CONCURRENT_VISION_JOBS = 2;

export function getApiKey(): string | undefined {
  const value = getSettingsValue('falKey');
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function getKieApiKey(): string | undefined {
  const value = getSettingsValue('kieKey');
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function getRunpodApiKey(): string | undefined {
  const value = getSettingsValue('runpodKey');
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function getPodUrl(): string | undefined {
  const value = getSettingsValue('podUrl');
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function getPodId(): string | undefined {
  const value = getSettingsValue('podId');
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function getRunpodEndpointId(nodeType: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem('cinegen_settings');
    if (!raw) return undefined;
    const endpoints = JSON.parse(raw)['runpodEndpoints'] as Record<string, string> | undefined;
    return endpoints?.[nodeType] || undefined;
  } catch {
    return undefined;
  }
}

export type Provider = 'fal' | 'kie';

export function getProvider(): Provider {
  const value = getSettingsValue('provider');
  return value === 'kie' ? 'kie' : 'fal';
}

export function getDefaultTranscriptionEngine(): DefaultTranscriptionEngine {
  const value = getSettingsValue('defaultTranscriptionEngine');
  if (
    value === 'faster-whisper-local'
    || value === 'whisperx-local'
    || value === 'whisper-cloud'
  ) {
    return value;
  }
  return DEFAULT_TRANSCRIPTION_ENGINE;
}

export function getAutoVisualIndexingEnabled(): boolean {
  const value = getSettingsValue('autoVisualIndexing');
  return typeof value === 'boolean' ? value : true;
}

export function getAnalyzeVisionOnImportEnabled(): boolean {
  const value = getSettingsValue('analyzeVisionOnImport');
  return typeof value === 'boolean' ? value : true;
}

export function getBackgroundVisionModel(): VisionModel {
  const value = getSettingsValue('backgroundVisionModel');
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_BACKGROUND_VISION_MODEL;
}

export function getCutVisionModel(): VisionModel {
  const value = getSettingsValue('cutVisionModel');
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_CUT_VISION_MODEL;
}

export function getMaxConcurrentVisionJobs(): number {
  const value = Number(getSettingsValue('maxConcurrentVisionJobs'));
  if (!Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_VISION_JOBS;
  return Math.max(1, Math.min(6, Math.floor(value)));
}
