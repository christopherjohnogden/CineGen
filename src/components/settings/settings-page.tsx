import { ClaudeMcpConnect } from './claude-mcp-connect';
import { useState, useEffect, useCallback, useRef } from 'react';
import { renewalSummary } from '@/lib/providers/renewal';
import type { DefaultTranscriptionEngine } from '@/lib/utils/api-key';
import { CloudAccountCard } from '@/components/cloud/cloud-account';
import type { Ltx25GpuProfile } from '@/lib/runpod/ltx25-service';
import {
  DEFAULT_VIDEO_GENERATION_PROVIDER,
  VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION,
  type VideoGenerationProvider,
} from '@/lib/utils/video-generation-provider';
import {
  TEAM_PROVIDER_SENTINEL,
  connectWorkspaceProviders,
  getWorkspaceProviderStatus,
  removeWorkspaceProvider,
  saveWorkspaceProvider,
  type WorkspaceProviderId,
  type WorkspaceProviderStatus,
} from '@/lib/providers/workspace-connections';

/* -----------------------------------------------------------------------
   Types & constants
   ----------------------------------------------------------------------- */

const STORAGE_KEY = 'cinegen_settings';

type Provider = 'fal' | 'kie';
type SettingsTab = 'app' | 'project';
type RunpodLtxImageModel = 'sdxl' | 'qwen-image-edit';

/* Sidebar category IDs — these double as scroll-anchor IDs */
type AppCategory = 'claude' | 'cloud' | 'api-keys' | 'endpoints' | 'pod' | 'provider' | 'preferences';
type ProjectCategory = 'resolution' | 'frame-rate' | 'aspect-ratio';
type Category = AppCategory | ProjectCategory;

type RunpodLtxSetupStatus =
  | 'not-configured'
  | 'validating'
  | 'creating-pod'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'terminating'
  | 'error';

const APP_CATEGORIES: { id: AppCategory; label: string }[] = [
  { id: 'cloud', label: 'Cloud Account' },
  { id: 'claude', label: 'Claude Desktop' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'endpoints', label: 'RunPod Endpoints' },
  { id: 'pod', label: 'Generation Session' },
  { id: 'provider', label: 'Provider' },
  { id: 'preferences', label: 'Preferences' },
];

const PROJECT_CATEGORIES: { id: ProjectCategory; label: string }[] = [
  { id: 'resolution', label: 'Resolution' },
  { id: 'frame-rate', label: 'Frame Rate' },
  { id: 'aspect-ratio', label: 'Aspect Ratio' },
];

interface Settings {
  falKey: string;
  kieKey: string;
  openaiKey: string;
  runpodKey: string;
  runpodEndpoints: Record<string, string>;
  podId: string;
  podUrl: string;
  huggingFaceToken: string;
  runpodLtxPodId: string;
  runpodLtxPodUrl: string;
  runpodLtxPodAuthToken: string;
  runpodLtxSecretIds: string[];
  runpodLtxStatus: RunpodLtxSetupStatus;
  runpodLtxGpuProfile: Ltx25GpuProfile;
  runpodLtxImageModels: RunpodLtxImageModel[];
  runpodLtxActiveImageModels?: RunpodLtxImageModel[];
  provider: Provider;
  videoGenerationProvider: VideoGenerationProvider;
  videoGenerationProviderSettingsVersion: number;
  defaultTranscriptionEngine: DefaultTranscriptionEngine;
  autoVisualIndexing: boolean;
  analyzeVisionOnImport: boolean;
  backgroundVisionModel: string;
  cutVisionModel: string;
  maxConcurrentVisionJobs: number;
  reduceMotion: boolean;
  resolutionWidth: number;
  resolutionHeight: number;
  frameRate: 24 | 30 | 60;
  aspectRatio: string;
}

const DEFAULT_SETTINGS: Settings = {
  falKey: '',
  kieKey: '',
  openaiKey: '',
  runpodKey: '',
  runpodEndpoints: {},
  podId: '',
  podUrl: '',
  huggingFaceToken: '',
  runpodLtxPodId: '',
  runpodLtxPodUrl: '',
  runpodLtxPodAuthToken: '',
  runpodLtxSecretIds: [],
  runpodLtxStatus: 'not-configured',
  runpodLtxGpuProfile: 'balanced',
  runpodLtxImageModels: ['sdxl', 'qwen-image-edit'],
  provider: 'fal',
  videoGenerationProvider: DEFAULT_VIDEO_GENERATION_PROVIDER,
  videoGenerationProviderSettingsVersion: VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION,
  defaultTranscriptionEngine: 'whisperx-local',
  autoVisualIndexing: true,
  analyzeVisionOnImport: true,
  backgroundVisionModel: 'google/gemini-2.5-flash',
  cutVisionModel: 'google/gemini-2.5-flash',
  maxConcurrentVisionJobs: 2,
  reduceMotion: false,
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  frameRate: 24,
  aspectRatio: '16:9',
};

const RUNPOD_MODELS = [
  { key: 'runpod-sdxl',            label: 'Stable Diffusion XL (Serverless)' },
  { key: 'runpod-qwen-image-edit', label: 'Qwen Image Edit (Serverless)' },
  { key: 'runpod-wan-t2v',         label: 'Wan 2.1 T2V' },
  { key: 'runpod-wan-i2v',         label: 'Wan 2.1 I2V' },
  { key: 'runpod-flux-dev',        label: 'FLUX Dev' },
];

const TRANSCRIPTION_ENGINES: Array<{ value: DefaultTranscriptionEngine; label: string }> = [
  { value: 'whisperx-local', label: 'WhisperX Local' },
  { value: 'faster-whisper-local', label: 'Fast Local' },
  { value: 'whisper-cloud', label: 'Whisper Cloud' },
];

const VISION_MODEL_OPTIONS = [
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'openai/gpt-4.1', label: 'GPT-4.1' },
];

const RESOLUTION_PRESETS = [
  { label: 'HD',  w: 1280, h: 720,  tag: '720p' },
  { label: 'Full HD', w: 1920, h: 1080, tag: '1080p' },
  { label: '2K',  w: 2560, h: 1440, tag: '1440p' },
  { label: '4K',  w: 3840, h: 2160, tag: '2160p' },
];

const ASPECT_RATIOS = ['16:9', '4:3', '21:9', '1:1', '9:16'];

const RUNPOD_LTX_GPU_PROFILE_OPTIONS: ReadonlyArray<{
  id: Ltx25GpuProfile;
  name: string;
  tier: string;
  hardware: string;
  detail: string;
}> = [
  {
    id: 'economy',
    name: 'Lower cost',
    tier: 'COST',
    hardware: 'A40, A6000, or L40 · 48 GB VRAM',
    detail: 'The lowest-cost compatible pool. Expect video generation to take longer.',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    tier: 'DEFAULT',
    hardware: 'RTX PRO 6000 Blackwell · 96 GB VRAM',
    detail: 'Strong speed and memory headroom without moving to the premium compute pool.',
  },
  {
    id: 'performance',
    name: 'Maximum speed',
    tier: 'FAST',
    hardware: 'B200 or H200 first · 80–180 GB VRAM',
    detail: 'The fastest render pool, with H100 fallback. Usually the highest hourly rate.',
  },
];

const RUNPOD_LTX_IMAGE_MODEL_IDS = ['sdxl', 'qwen-image-edit'] as const;
const RUNPOD_LTX_BASE_WEIGHT_GB = 66;
const RUNPOD_LTX_IMAGE_MODEL_OPTIONS: ReadonlyArray<{
  id: RunpodLtxImageModel;
  name: string;
  sizeGb: number;
  purpose: string;
  requirement: string;
}> = [
  {
    id: 'sdxl',
    name: 'Stable Diffusion XL',
    sizeGb: 6.9,
    purpose: 'Text-to-image',
    requirement: 'Creates new storyboard and Spaces images from a prompt.',
  },
  {
    id: 'qwen-image-edit',
    name: 'Qwen Image Edit',
    sizeGb: 31,
    purpose: 'Image editing',
    requirement: 'Needs a source image; follows instructions to revise an existing frame.',
  },
];

function normalizeRunpodLtxGpuProfile(value: unknown): Ltx25GpuProfile {
  return value === 'economy' || value === 'performance' ? value : 'balanced';
}

function normalizeRunpodLtxImageModels(
  value: unknown,
  fallback: RunpodLtxImageModel[] = [...RUNPOD_LTX_IMAGE_MODEL_IDS],
): RunpodLtxImageModel[] {
  if (!Array.isArray(value)) return fallback;
  return RUNPOD_LTX_IMAGE_MODEL_IDS.filter((id) => value.includes(id));
}

function normalizeActiveRunpodLtxImageModels(value: unknown): RunpodLtxImageModel[] | undefined {
  return Array.isArray(value) ? normalizeRunpodLtxImageModels(value, []) : undefined;
}

function runpodLtxEstimatedWeightGb(imageModels: RunpodLtxImageModel[]): number {
  return RUNPOD_LTX_BASE_WEIGHT_GB + RUNPOD_LTX_IMAGE_MODEL_OPTIONS.reduce(
    (total, model) => total + (imageModels.includes(model.id) ? model.sizeGb : 0),
    0,
  );
}

function runpodLtxStartupEstimate(imageModels: RunpodLtxImageModel[]): string {
  if (imageModels.includes('qwen-image-edit') && imageModels.includes('sdxl')) return 'Longest first start';
  if (imageModels.includes('qwen-image-edit')) return 'Significantly longer first start';
  if (imageModels.includes('sdxl')) return 'Slightly longer first start';
  return 'Standard LTX first start';
}

function runpodLtxModelSummary(imageModels: RunpodLtxImageModel[]): string {
  const names = RUNPOD_LTX_IMAGE_MODEL_OPTIONS
    .filter((model) => imageModels.includes(model.id))
    .map((model) => model.id === 'sdxl' ? 'SDXL' : 'Qwen Image Edit');
  return names.length ? `LTX-2.5 + ${names.join(' + ')}` : 'LTX-2.5 video only';
}

/* -----------------------------------------------------------------------
   Persistence
   ----------------------------------------------------------------------- */

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    const merged = {
      ...DEFAULT_SETTINGS,
      ...saved,
      videoGenerationProvider: saved.videoGenerationProviderSettingsVersion === VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION
        ? saved.videoGenerationProvider ?? DEFAULT_VIDEO_GENERATION_PROVIDER
        : DEFAULT_VIDEO_GENERATION_PROVIDER,
      videoGenerationProviderSettingsVersion: VIDEO_GENERATION_PROVIDER_SETTINGS_VERSION,
      runpodLtxGpuProfile: normalizeRunpodLtxGpuProfile(saved.runpodLtxGpuProfile),
      runpodLtxImageModels: normalizeRunpodLtxImageModels(saved.runpodLtxImageModels),
      runpodLtxActiveImageModels: normalizeActiveRunpodLtxImageModels(saved.runpodLtxActiveImageModels),
    };
    return merged.runpodLtxPodId
      ? merged
      : {
          ...merged,
          runpodLtxStatus: 'not-configured',
          videoGenerationProvider: merged.videoGenerationProvider === 'runpod' ? DEFAULT_VIDEO_GENERATION_PROVIDER : merged.videoGenerationProvider,
        };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cinegen:settings-changed'));
  }
}

const RUNPOD_LTX_STEPS: Array<{ status: RunpodLtxSetupStatus; label: string }> = [
  { status: 'validating', label: 'Validate accounts' },
  { status: 'creating-pod', label: 'Create GPU Pod' },
  { status: 'downloading', label: 'Download models' },
  { status: 'loading', label: 'Load models' },
  { status: 'ready', label: 'Ready' },
];

function normalizeRunpodLtxStatus(status: unknown, phase?: unknown): RunpodLtxSetupStatus {
  const statusValue = String(status ?? '').trim().toLowerCase();
  const phaseValue = String(phase ?? '').trim().toLowerCase();
  const value = `${statusValue} ${phaseValue}`.trim();
  if (/fail|error|cancel|\bended\b|\bstopped\b/.test(value)) return 'error';
  if (/ready|complete|healthy/.test(value)) return 'ready';
  if (/terminat|delet|remov/.test(value)) return 'terminating';
  if (/\bload(?:ing)?\b|warm|initializ|gpu memory/.test(phaseValue)) return 'loading';
  if (/download|fetch|cache/.test(phaseValue) || /download/.test(statusValue)) return 'downloading';
  if (/pod|creat|provision|deploy/.test(value)) return 'creating-pod';
  if (/valid|account|auth/.test(value)) return 'validating';
  return 'not-configured';
}

function friendlyRunpodLtxError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/401|403|unauthori|api key/i.test(message)) {
    return 'RunPod rejected the API key. Check that the key can create and delete Pods and secrets.';
  }
  if (/hugging\s*face|gated|model terms|license/i.test(message)) {
    return 'LTX-2.5 access was denied. Accept the model terms, then check your Hugging Face read token.';
  }
  if (/fund|balance|billing|payment|quota/i.test(message)) {
    return 'RunPod could not create the Pod. Check billing and account limits in the RunPod console.';
  }
  return 'The LTX-2.5 session did not start. No key or token was displayed. Try again or check the RunPod console.';
}

function friendlyRunpodLtxStatusCheckError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/401|403|unauthori|api key/i.test(message)) {
    return 'CineGen could not refresh the session because RunPod rejected the API key. Automatic checks will continue.';
  }
  return 'CineGen could not refresh the session status. Automatic checks will continue while the session starts.';
}

/* -----------------------------------------------------------------------
   Icons
   ----------------------------------------------------------------------- */

function IconKey() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function IconEye({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconChevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {direction === 'left'
        ? <polyline points="15 18 9 12 15 6" />
        : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

/* -----------------------------------------------------------------------
   Sub-components
   ----------------------------------------------------------------------- */

function ApiKeyField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="sp-field">
      <label className="sp-field__label">
        <IconKey /> {label}
      </label>
      <div className="sp-field__key-row">
        <input
          type={visible ? 'text' : 'password'}
          className="sp-field__input sp-field__input--mono"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
        />
        <button
          className="sp-field__eye-btn"
          onClick={() => setVisible((v) => !v)}
          title={visible ? 'Hide' : 'Reveal'}
          type="button"
          disabled={disabled}
        >
          <IconEye open={visible} />
        </button>
      </div>
    </div>
  );
}

const TEAM_PROVIDER_FIELDS: Array<{
  id: WorkspaceProviderId;
  key: 'falKey' | 'openaiKey' | 'kieKey' | 'runpodKey' | 'huggingFaceToken';
  label: string;
  placeholder: string;
}> = [
  { id: 'fal', key: 'falKey', label: 'fal.ai', placeholder: 'Paste the fal.ai key for your team…' },
  { id: 'openai', key: 'openaiKey', label: 'OpenAI', placeholder: 'Paste the OpenAI key for your team…' },
  { id: 'kie', key: 'kieKey', label: 'kie.ai', placeholder: 'Paste the kie.ai key for your team…' },
  { id: 'runpod', key: 'runpodKey', label: 'RunPod', placeholder: 'Paste the RunPod key for your team…' },
  { id: 'huggingface', key: 'huggingFaceToken', label: 'Hugging Face', placeholder: 'Paste the HF read token for your team…' },
];

function TeamProviderConnections({
  settings,
  update,
}: {
  settings: Settings;
  update: (partial: Partial<Settings>) => void;
}) {
  const [status, setStatus] = useState<WorkspaceProviderStatus | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<Partial<Record<WorkspaceProviderId, string>>>({});
  const [busy, setBusy] = useState<WorkspaceProviderId | null>(null);
  const [error, setError] = useState('');
  const [connectingWorkspace, setConnectingWorkspace] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const applyStatus = useCallback((next: WorkspaceProviderStatus) => {
    setStatus(next);
    const connected = new Set(next.providers.filter((provider) => provider.connected).map((provider) => provider.id));
    const partial: Partial<Settings> = {};
    for (const field of TEAM_PROVIDER_FIELDS) {
      const current = settingsRef.current[field.key];
      if (connected.has(field.id) && current !== TEAM_PROVIDER_SENTINEL) partial[field.key] = TEAM_PROVIDER_SENTINEL;
      if (!connected.has(field.id) && current === TEAM_PROVIDER_SENTINEL) partial[field.key] = '';
    }
    if (Object.keys(partial).length) update(partial);
  }, [update]);

  useEffect(() => {
    let cancelled = false;
    void getWorkspaceProviderStatus().then((next) => {
      if (cancelled) return;
      if (next) applyStatus(next);
      else setStatus(null);
    });
    return () => { cancelled = true; };
  }, [applyStatus]);

  if (status === undefined) {
    return <p className="sp-card__desc">Checking your team&apos;s provider connections…</p>;
  }

  if (status === null) {
    return (
      <div className="sp-card__fields">
        <ApiKeyField label="fal.ai" value={settings.falKey} onChange={(value) => update({ falKey: value })} placeholder="Enter your fal.ai key..." />
        <ApiKeyField label="OpenAI" value={settings.openaiKey} onChange={(value) => update({ openaiKey: value })} placeholder="Enter your OpenAI key..." />
        <ApiKeyField label="kie.ai" value={settings.kieKey} onChange={(value) => update({ kieKey: value })} placeholder="Enter your kie.ai key..." />
        <ApiKeyField label="RunPod" value={settings.runpodKey} onChange={(value) => update({ runpodKey: value })} placeholder="Enter your RunPod key..." />
      </div>
    );
  }

  const connectedIds = new Set(status.providers.filter((provider) => provider.connected).map((provider) => provider.id));

  const save = async (provider: WorkspaceProviderId) => {
    const secret = drafts[provider]?.trim() || '';
    if (!secret) return;
    setBusy(provider);
    setError('');
    try {
      applyStatus(await saveWorkspaceProvider(provider, secret));
      setDrafts((current) => ({ ...current, [provider]: '' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The team connection could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: WorkspaceProviderId) => {
    setBusy(provider);
    setError('');
    try {
      applyStatus(await removeWorkspaceProvider(provider));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The team connection could not be removed.');
    } finally {
      setBusy(null);
    }
  };

  const connectWorkspace = async () => {
    setConnectingWorkspace(true);
    setError('');
    try {
      applyStatus(await connectWorkspaceProviders());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The desktop could not connect to the team workspace.');
    } finally {
      setConnectingWorkspace(false);
    }
  };

  return (
    <div className="sp-card__fields">
      <p className="sp-card__desc sp-team-provider-note">
        <strong>{status.desktop?.source === 'local-web' ? 'Connected to your local browser workspace.' : 'Shared with your CineGen team.'}</strong>{' '}
        {status.desktop?.source === 'local-web'
          ? 'Desktop can use the provider connections currently configured at localhost:3000. The credentials remain in the browser vault.'
          : 'Connect each service once. Teammates can use it, but the credential is never shown or downloaded to their device.'}
      </p>
      {status.desktop?.requiresLogin && (
        <div className="sp-team-provider__desktop-connect">
          <div>
            <strong>Connect desktop to your team</strong>
            <span>Sign in once so this Mac can use the same hosted provider connections as the browser app.</span>
          </div>
          <button
            type="button"
            className="sp-btn sp-btn--accent"
            disabled={connectingWorkspace}
            onClick={() => void connectWorkspace()}
          >{connectingWorkspace ? 'Connecting…' : 'Connect team workspace'}</button>
        </div>
      )}
      {TEAM_PROVIDER_FIELDS.map((field) => {
        const connected = connectedIds.has(field.id);
        const draft = drafts[field.id] ?? (
          settings[field.key] !== TEAM_PROVIDER_SENTINEL ? settings[field.key] : ''
        );
        return (
          <div className="sp-field sp-team-provider" key={field.id}>
            <label className="sp-field__label"><IconKey /> {field.label}</label>
            <div className="sp-field__key-row">
              <input
                type="password"
                className="sp-field__input sp-field__input--mono"
                value={draft}
                placeholder={connected ? 'Connected for team · paste a new key to replace' : field.placeholder}
                onChange={(event) => setDrafts((current) => ({ ...current, [field.id]: event.target.value }))}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="sp-btn sp-btn--accent"
                disabled={busy !== null || !draft.trim()}
                onClick={() => void save(field.id)}
              >{busy === field.id ? 'Saving…' : connected ? 'Replace' : 'Share'}</button>
              {connected && (
                <button
                  type="button"
                  className="sp-btn sp-btn--muted"
                  disabled={busy !== null}
                  onClick={() => void remove(field.id)}
                >Remove</button>
              )}
            </div>
            <span className={`sp-team-provider__status${connected ? ' is-connected' : ''}`}>
              <span aria-hidden="true" /> {connected ? 'Connected for everyone on the team' : 'Not connected for the team'}
            </span>
          </div>
        );
      })}
      {error && <p className="sp-card__error">{error}</p>}
    </div>
  );
}

type HiggsfieldState = { connected: boolean; email?: string; plan?: string; credits?: number; error?: string };

function HiggsfieldConnect() {
  const [status, setStatus] = useState<HiggsfieldState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await window.electronAPI.higgsfield.accountStatus();
      setStatus(s);
    } catch {
      setStatus({ connected: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const s = await window.electronAPI.higgsfield.authLogin();
      setStatus(s);
      if (!s.connected) setError(s.error || 'Higgsfield authorization did not complete.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message || 'Higgsfield sign-in did not complete. Try connecting again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await window.electronAPI.higgsfield.authLogout();
      setStatus({ connected: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Higgsfield could not be disconnected.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="sp-field" style={{ marginTop: 12 }}>
      <label className="sp-field__label">
        <IconKey /> Higgsfield
      </label>
      <div className="sp-field__key-row" style={{ alignItems: 'center', gap: 12 }}>
        {status?.connected ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Connected{status.email ? ` · ${status.email}` : ''}
              {typeof status.credits === 'number' ? ` · ${status.credits} credits` : ''}
              {status.plan ? ` · ${status.plan}` : ''}
            </span>
            <button className="sp-field__eye-btn" type="button" onClick={() => void disconnect()} disabled={busy} style={{ width: 'auto', padding: '4px 10px' }}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary, #888)' }}>Not connected</span>
            <button className="sp-field__eye-btn" type="button" onClick={() => void connect()} disabled={busy} style={{ width: 'auto', padding: '4px 10px' }}>
              {busy ? 'Waiting for browser…' : 'Connect Higgsfield'}
            </button>
          </>
        )}
      </div>
      {(error || status?.error) && (
        <p className="sp-card__desc" style={{ marginTop: 4, color: 'var(--danger, #d66)' }}>{error || status?.error}</p>
      )}
      <p className="sp-card__desc" style={{ marginTop: 4 }}>
        Connects securely through Higgsfield. On the hosted workspace, one MCP connection is shared by the whole team; desktop still uses the local CLI. Powers Higgsfield nodes, Quick Edit, and Copilot generation.
      </p>
    </div>
  );
}

type TopviewState = {
  connected: boolean;
  configured: boolean;
  email?: string;
  credits?: number;
  authMode?: 'oauth' | 'api_key';
  creditType?: 'mcp' | 'api_key';
  error?: string;
};

function friendlyTopviewError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/pop-?ups?/i.test(message)) return 'Allow pop-ups for CineGen, then try connecting Topview again.';
  if (/timed out/i.test(message)) return 'Topview sign-in timed out. Try connecting again.';
  if (/credit|balance|billing/i.test(message)) return 'Topview says the current connection has insufficient credits. If this is an API-key connection, share the desktop MCP connection with your team to use the MCP plan balance.';
  const remoteMessage = message.split(/Error:\s*/).filter(Boolean).pop()?.trim();
  return remoteMessage && remoteMessage.length < 260
    ? remoteMessage
    : 'Topview sign-in did not complete. Try connecting again.';
}

function TopviewConnect() {
  const [status, setStatus] = useState<TopviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [error, setError] = useState('');
  // Detect the native capability itself. Packaged builds can customize or mask
  // Electron's user agent, which previously hid the team-sharing control even
  // though the secure desktop bridge was available.
  const canShareTopviewWithTeam = typeof window !== 'undefined'
    && typeof window.electronAPI?.teamProviders?.shareTopview === 'function';
  const isHostedWorkspace = typeof window !== 'undefined'
    && (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    && window.location.hostname !== 'localhost'
    && window.location.hostname !== '127.0.0.1';

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.electronAPI.topview.accountStatus());
    } catch {
      setStatus({ connected: false, configured: true });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const next = await window.electronAPI.topview.authLogin();
      setStatus(next);
      if (!next.connected) setError(next.error || 'Topview authorization did not complete.');
    } catch (cause) {
      setError(friendlyTopviewError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await window.electronAPI.topview.authLogout();
      setStatus({ connected: false, configured: true });
    } catch (cause) {
      setError(friendlyTopviewError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const shareWithTeam = useCallback(async () => {
    setSharing(true);
    setError('');
    setShareMessage('');
    try {
      const shareTopview = window.electronAPI?.teamProviders?.shareTopview;
      if (typeof shareTopview !== 'function') {
        throw new Error('Topview MCP sharing is available in the CineGen desktop app.');
      }
      await shareTopview();
      setShareMessage('This Topview MCP connection is now shared with the hosted team workspace.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Topview MCP could not be shared with the team.');
    } finally {
      setSharing(false);
    }
  }, []);

  return (
    <div className="sp-field" style={{ marginTop: 12 }}>
      <label className="sp-field__label">
        <IconKey /> Topview AI MCP <span style={{ color: 'var(--accent, #d7a552)' }}>Default</span>
      </label>
      <div className="sp-field__key-row" style={{ alignItems: 'center', gap: 12 }}>
        {status?.connected ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Connected to Topview{status.email ? ` · ${status.email}` : ''}
              {typeof status.credits === 'number'
                ? ` · ${status.credits} ${status.creditType === 'api_key' ? 'API-key credits' : 'MCP plan credits'}`
                : ''}
            </span>
            <button className="sp-field__eye-btn" type="button" onClick={() => void disconnect()} disabled={busy} style={{ width: 'auto', padding: '4px 10px' }}>
              Disconnect
            </button>
          </>
        ) : isHostedWorkspace ? (
          <span style={{ fontSize: 13, color: 'var(--text-tertiary, #888)' }}>
            Waiting for the team&apos;s Topview MCP connection
          </span>
        ) : (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary, #888)' }}>Not connected</span>
            <button className="sp-field__eye-btn" type="button" onClick={() => void connect()} disabled={busy} style={{ width: 'auto', padding: '4px 10px' }}>
              {busy ? 'Waiting for browser…' : 'Connect Topview'}
            </button>
          </>
        )}
      </div>
      {(error || status?.error) && (
        <p className="sp-card__desc" style={{ marginTop: 4, color: 'var(--danger, #d66)' }}>{error || status?.error}</p>
      )}
      {shareMessage && (
        <p className="sp-card__desc" style={{ marginTop: 4, color: 'var(--success, #58c98b)' }}>{shareMessage}</p>
      )}
      {status?.connected && (
        <p className="sp-card__desc" style={{ marginTop: 4 }} data-testid="sp-topview-renewal">
          {renewalSummary()}
        </p>
      )}
      {status?.connected && status.authMode === 'api_key' && (
        <p className="sp-topview-credit-note">
          <strong>API-key connection:</strong> This web fallback uses Topview&apos;s separate API balance. To use the MCP plan balance shown on desktop, share the owner&apos;s desktop MCP connection with the team.
        </p>
      )}
      {status?.connected && canShareTopviewWithTeam && status.authMode !== 'api_key' && (
        <div style={{ marginTop: 8 }}>
          <button
            className="sp-btn sp-btn--accent"
            type="button"
            onClick={() => void shareWithTeam()}
            disabled={sharing}
          >{sharing ? 'Sharing MCP…' : 'Share MCP with team'}</button>
          <p className="sp-card__desc" style={{ marginTop: 5 }}>
            Securely shares this OAuth MCP connection with the hosted workspace so web and mobile use the same Topview plan balance.
          </p>
        </div>
      )}
      {!status?.connected && isHostedWorkspace && (
        <p className="sp-topview-credit-note">
          On the owner&apos;s Mac, open CineGen Desktop, then go to <strong>Settings → Provider → Topview AI MCP</strong> and choose <strong>Share MCP with team</strong>. Refresh this page afterward. Web and mobile will then use the same team MCP connection and plan balance.
        </p>
      )}
      <p className="sp-card__desc" style={{ marginTop: 4 }}>
        Signs in directly through Topview&apos;s official MCP. On the hosted workspace, one connection works for the whole team. CineGen selects a compatible live model, uploads selected elements as references, and saves results to your Topview board.
        {' '}<a href="https://www.topview.ai/mcp" target="_blank" rel="noreferrer">About Topview MCP</a>.
      </p>
    </div>
  );
}

type ArtlistState = {
  connected: boolean;
  configured: boolean;
  error?: string;
  setupRequired?: boolean;
  setupMessage?: string;
};

type RunpodLtxOperationResult = {
  podId?: string;
  podUrl?: string;
  podAuthToken?: string;
  secretIds?: string[];
  runpodLtxSecretIds?: string[];
  status?: string;
  phase?: string;
  message?: string;
  ready?: boolean;
  costPerHr?: number | null;
  gpu?: string | null;
  gpuProfile?: Ltx25GpuProfile;
  imageModels?: RunpodLtxImageModel[];
};

type RunpodLtxApi = {
  setupLtx25: (params: {
    runpodKey: string;
    huggingFaceToken: string;
    gpuProfile: Ltx25GpuProfile;
    imageModels: RunpodLtxImageModel[];
  }) => Promise<RunpodLtxOperationResult>;
  statusLtx25: (params: { runpodKey: string; podId: string; podUrl?: string; podAuthToken: string; secretIds?: string[] }) => Promise<RunpodLtxOperationResult>;
  terminateLtx25: (params: { runpodKey: string; podId: string; secretIds: string[] }) => Promise<{ ok?: boolean; status?: string }>;
};

function getRunpodLtxApi(): RunpodLtxApi {
  return window.electronAPI.pod as typeof window.electronAPI.pod & RunpodLtxApi;
}

function runpodLtxStatusMessage(status: RunpodLtxSetupStatus): string {
  switch (status) {
    case 'validating': return 'Checking RunPod access and permission for the selected generation models.';
    case 'creating-pod': return 'Creating a temporary RunPod generation Pod.';
    case 'downloading': return 'Downloading the models selected for this temporary session. Larger model sets take longer to start.';
    case 'loading': return 'Loading the selected generation models and checking the session.';
    case 'ready': return 'The RunPod generation session is ready. LTX-2.5 is available for Director video generation.';
    case 'terminating': return 'Deleting the Pod and its temporary model files to stop session charges.';
    case 'error': return 'The session needs attention. Any Pod already created was left in place so you can check or delete it.';
    default: return 'No RunPod generation Pod is running. Choose the models you want, then start a session.';
  }
}

function friendlyArtlistError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  const code = cause && typeof cause === 'object' && 'code' in cause
    ? String((cause as { code?: unknown }).code ?? '')
    : '';
  if (code === 'ARTLIST_CLIENT_REGISTRATION_REQUIRED') {
    return "Artlist hasn't approved this local test address. Connect from CineGen's hosted web app, or ask Artlist to issue CineGen an OAuth client.";
  }
  if (/pop-?ups?/i.test(message)) return 'Allow pop-ups for CineGen, then try connecting Artlist again.';
  if (/timed out/i.test(message)) return 'Artlist sign-in timed out. Try connecting again.';
  const remoteMessage = message.split(/Error:\s*/).filter(Boolean).pop()?.trim();
  return remoteMessage && remoteMessage.length < 220
    ? remoteMessage
    : 'Artlist sign-in did not complete. Try connecting again.';
}

function ArtlistConnect() {
  const [status, setStatus] = useState<ArtlistState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.electronAPI.artlist.accountStatus());
    } catch {
      setStatus({ connected: false, configured: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const next = await window.electronAPI.artlist.authLogin();
      setStatus(next);
      if (!next.connected) setError(next.error || 'Artlist authorization did not complete.');
    } catch (cause) {
      setError(friendlyArtlistError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await window.electronAPI.artlist.authLogout();
      setStatus({ connected: false, configured: true });
    } catch (cause) {
      setError(friendlyArtlistError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="sp-field" style={{ marginTop: 18 }}>
      <label className="sp-field__label">
        <IconKey /> Artlist MCP
      </label>
      <div className="sp-field__key-row" style={{ alignItems: 'center', gap: 12 }}>
        {status?.connected ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Connected to Artlist</span>
            <button className="sp-field__eye-btn" type="button" onClick={() => void disconnect()} disabled={busy} style={{ width: 'auto', padding: '4px 10px' }}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary, #888)' }}>
              {status?.setupRequired ? 'Requires Artlist approval' : 'Not connected'}
            </span>
            {!status?.setupRequired && (
              <button className="sp-field__eye-btn" type="button" onClick={() => void connect()} disabled={busy} style={{ width: 'auto', padding: '4px 10px' }}>
                {busy ? 'Waiting for browser…' : 'Connect Artlist'}
              </button>
            )}
          </>
        )}
      </div>
      {status?.setupMessage && !error && (
        <p className="sp-card__desc" style={{ marginTop: 4 }}>{status.setupMessage}</p>
      )}
      {(error || status?.error) && (
        <p className="sp-card__desc" style={{ marginTop: 4, color: 'var(--danger, #d66)' }}>{error || status?.error}</p>
      )}
      <p className="sp-card__desc" style={{ marginTop: 4 }}>
        When Artlist enables CineGen web access, Director generations will use the workspace's connected account and pass selected elements as references.
        {' '}<a href="https://artlist.io/mcp" target="_blank" rel="noreferrer">Check Artlist MCP availability</a>.
      </p>
    </div>
  );
}

/* -----------------------------------------------------------------------
   Main component
   ----------------------------------------------------------------------- */

interface SettingsPageProps {
  onBack: () => void;
  projectId?: string;
  useSqlite?: boolean;
}

export function SettingsPage({ onBack, projectId, useSqlite }: SettingsPageProps) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTab] = useState<SettingsTab>('app');
  const [activeCategory, setActiveCategory] = useState<Category>('cloud');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [runpodLtxStatus, setRunpodLtxStatus] = useState<RunpodLtxSetupStatus>(settings.runpodLtxStatus);
  const [runpodLtxBusy, setRunpodLtxBusy] = useState(false);
  const [runpodLtxChecking, setRunpodLtxChecking] = useState(false);
  const [runpodLtxError, setRunpodLtxError] = useState('');
  const [runpodLtxMessage, setRunpodLtxMessage] = useState('');
  const [runpodLtxLastCheckedAt, setRunpodLtxLastCheckedAt] = useState<number | null>(null);
  const [runpodLtxCostPerHr, setRunpodLtxCostPerHr] = useState<number | null>(null);
  const [runpodLtxGpu, setRunpodLtxGpu] = useState('');
  const [runpodCostConfirmed, setRunpodCostConfirmed] = useState(false);
  const [showRunpodEndConfirm, setShowRunpodEndConfirm] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const runpodLtxOperationRef = useRef(false);
  const runpodLtxSettingsRef = useRef(settings);
  const runpodLtxStatusRequestSequenceRef = useRef(0);
  const runpodLtxStatusRequestRef = useRef<{
    requestId: number;
    podId: string;
    promise: Promise<void>;
  } | null>(null);
  runpodLtxSettingsRef.current = settings;

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onBack();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onBack]);

  const update = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const refreshRunpodLtxStatus = useCallback((): Promise<void> => {
    const existingRequest = runpodLtxStatusRequestRef.current;
    if (existingRequest) return existingRequest.promise;

    const snapshot = runpodLtxSettingsRef.current;
    const runpodKey = snapshot.runpodKey.trim();
    const podId = snapshot.runpodLtxPodId.trim();
    if (!runpodKey || !podId) return Promise.resolve();

    const requestId = ++runpodLtxStatusRequestSequenceRef.current;
    setRunpodLtxChecking(true);
    const promise = (async () => {
      try {
        const result = await getRunpodLtxApi().statusLtx25({
          runpodKey,
          podId,
          podUrl: snapshot.runpodLtxPodUrl.trim(),
          podAuthToken: snapshot.runpodLtxPodAuthToken,
          secretIds: snapshot.runpodLtxSecretIds,
        });
        const current = runpodLtxSettingsRef.current;
        if (
          runpodLtxStatusRequestSequenceRef.current !== requestId
          || current.runpodLtxPodId.trim() !== podId
        ) return;

        setRunpodLtxLastCheckedAt(Date.now());
        setRunpodLtxMessage(result.message?.trim() || 'RunPod returned the latest session status.');
        if (String(result.status ?? '').toLowerCase() === 'ended') {
          setRunpodLtxStatus('not-configured');
          setRunpodLtxCostPerHr(null);
          setRunpodLtxGpu('');
          setRunpodLtxError('');
          setRunpodCostConfirmed(false);
          update({
            runpodLtxPodId: '',
            runpodLtxPodUrl: '',
            runpodLtxPodAuthToken: '',
            runpodLtxSecretIds: [],
            runpodLtxActiveImageModels: undefined,
            runpodLtxStatus: 'not-configured',
            ...(current.podId === podId ? { podId: '', podUrl: '' } : {}),
            ...(current.videoGenerationProvider === 'runpod' ? { videoGenerationProvider: DEFAULT_VIDEO_GENERATION_PROVIDER } : {}),
          });
          return;
        }
        const normalized = result.ready
          ? 'ready'
          : normalizeRunpodLtxStatus(result.status, result.phase);
        const nextStatus = normalized === 'not-configured' ? 'loading' : normalized;
        const failedPodWasCleaned = result.phase === 'startup-failed-cleaned';
        const cleanupMustBeConfirmed = result.phase === 'startup-failed-cleanup-required';
        setRunpodLtxStatus(nextStatus);
        setRunpodLtxCostPerHr(result.costPerHr ?? null);
        setRunpodLtxGpu(result.gpu || '');
        setRunpodLtxError(
          failedPodWasCleaned
            ? (/could not remove one temporary secret/i.test(result.message || '')
                ? 'The failed LTX-2.5 Pod was deleted and billing stopped. RunPod could not remove one temporary secret; check RunPod Secrets.'
                : 'The failed LTX-2.5 Pod and its temporary secrets were deleted. Billing stopped. Start a new session to retry.')
            : cleanupMustBeConfirmed
              ? 'The LTX-2.5 container could not start, and cleanup could not be confirmed. Delete this Pod in RunPod now to stop billing.'
              : nextStatus === 'error' ? result.message?.trim() || runpodLtxStatusMessage('error') : '',
        );
        const podUrl = result.podUrl?.trim() || current.runpodLtxPodUrl;
        if (failedPodWasCleaned) {
          setRunpodCostConfirmed(false);
          setShowRunpodEndConfirm(false);
          update({
            runpodLtxPodId: '',
            runpodLtxPodUrl: '',
            runpodLtxPodAuthToken: '',
            runpodLtxSecretIds: [],
            runpodLtxActiveImageModels: undefined,
            runpodLtxStatus: 'error',
            ...(current.podId === podId ? { podId: '', podUrl: '' } : {}),
            ...(current.videoGenerationProvider === 'runpod' ? { videoGenerationProvider: DEFAULT_VIDEO_GENERATION_PROVIDER } : {}),
          });
        } else {
          update({ runpodLtxStatus: nextStatus, runpodLtxPodUrl: podUrl, ...(podUrl ? { podUrl } : {}) });
        }
      } catch (cause) {
        const current = runpodLtxSettingsRef.current;
        if (
          runpodLtxStatusRequestSequenceRef.current !== requestId
          || current.runpodLtxPodId.trim() !== podId
        ) return;
        setRunpodLtxLastCheckedAt(Date.now());
        setRunpodLtxMessage(friendlyRunpodLtxStatusCheckError(cause));
      } finally {
        if (runpodLtxStatusRequestRef.current?.requestId === requestId) {
          runpodLtxStatusRequestRef.current = null;
          setRunpodLtxChecking(false);
        }
      }
    })();
    runpodLtxStatusRequestRef.current = { requestId, podId, promise };
    return promise;
  }, [update]);

  useEffect(() => {
    if (!settings.runpodLtxPodId || !settings.runpodKey) return;
    if (runpodLtxStatus === 'ready' || runpodLtxStatus === 'error') return;
    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async () => {
      await refreshRunpodLtxStatus();
      if (cancelled) return;
      timeoutId = window.setTimeout(() => void poll(), 6000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [refreshRunpodLtxStatus, runpodLtxStatus, settings.runpodKey, settings.runpodLtxPodId]);

  const setupRunpodLtx = useCallback(async () => {
    if (runpodLtxOperationRef.current) return;
    if (!settings.runpodKey.trim() || !settings.huggingFaceToken.trim() || !runpodCostConfirmed) return;
    runpodLtxStatusRequestSequenceRef.current += 1;
    runpodLtxOperationRef.current = true;
    setRunpodLtxBusy(true);
    setRunpodLtxStatus('validating');
    setRunpodLtxError('');
    setRunpodLtxMessage('');
    setRunpodLtxLastCheckedAt(null);
    update({ runpodLtxStatus: 'validating' });
    try {
      const selectedImageModels = [...settings.runpodLtxImageModels];
      const result = await getRunpodLtxApi().setupLtx25({
        runpodKey: settings.runpodKey.trim(),
        huggingFaceToken: settings.huggingFaceToken.trim(),
        gpuProfile: settings.runpodLtxGpuProfile,
        imageModels: selectedImageModels,
      });
      const podId = result.podId?.trim() || settings.runpodLtxPodId;
      const podUrl = result.podUrl?.trim() || settings.runpodLtxPodUrl;
      const podAuthToken = result.podAuthToken || settings.runpodLtxPodAuthToken;
      const secretIds = result.runpodLtxSecretIds || result.secretIds || settings.runpodLtxSecretIds;
      const normalized = result.ready
        ? 'ready'
        : normalizeRunpodLtxStatus(result.status, result.phase);
      const nextStatus = normalized === 'not-configured'
        ? (podId ? 'downloading' : 'creating-pod')
        : normalized;
      const activeImageModels = result.imageModels === undefined
        ? selectedImageModels
        : normalizeActiveRunpodLtxImageModels(result.imageModels) ?? selectedImageModels;
      setRunpodLtxStatus(nextStatus);
      setRunpodLtxCostPerHr(result.costPerHr ?? null);
      setRunpodLtxGpu(result.gpu || '');
      setRunpodLtxMessage(result.message?.trim() || 'RunPod created the session and is preparing its models.');
      update({
        runpodLtxPodId: podId,
        runpodLtxPodUrl: podUrl,
        runpodLtxPodAuthToken: podAuthToken,
        runpodLtxSecretIds: secretIds,
        runpodLtxActiveImageModels: activeImageModels,
        runpodLtxStatus: nextStatus,
        ...(podId ? { podId } : {}),
        ...(podUrl ? { podUrl } : {}),
      });
    } catch (cause) {
      setRunpodLtxStatus('error');
      setRunpodLtxError(friendlyRunpodLtxError(cause));
      update({ runpodLtxStatus: 'error' });
    } finally {
      runpodLtxOperationRef.current = false;
      setRunpodLtxBusy(false);
    }
  }, [runpodCostConfirmed, settings, update]);

  const terminateRunpodLtx = useCallback(async () => {
    if (runpodLtxOperationRef.current) return;
    if (!settings.runpodKey.trim() || !settings.runpodLtxPodId.trim()) return;
    runpodLtxStatusRequestSequenceRef.current += 1;
    runpodLtxOperationRef.current = true;
    setRunpodLtxBusy(true);
    setRunpodLtxStatus('terminating');
    setRunpodLtxError('');
    setRunpodLtxMessage('');
    setRunpodLtxLastCheckedAt(null);
    update({ runpodLtxStatus: 'terminating' });
    try {
      await getRunpodLtxApi().terminateLtx25({
        runpodKey: settings.runpodKey.trim(),
        podId: settings.runpodLtxPodId.trim(),
        secretIds: settings.runpodLtxSecretIds,
      });
      setRunpodLtxStatus('not-configured');
      setRunpodLtxCostPerHr(null);
      setRunpodLtxGpu('');
      setRunpodCostConfirmed(false);
      setShowRunpodEndConfirm(false);
      update({
        runpodLtxPodId: '',
        runpodLtxPodUrl: '',
        runpodLtxPodAuthToken: '',
        runpodLtxSecretIds: [],
        runpodLtxActiveImageModels: undefined,
        runpodLtxStatus: 'not-configured',
        ...(settings.podId === settings.runpodLtxPodId ? { podId: '', podUrl: '' } : {}),
        ...(settings.videoGenerationProvider === 'runpod' ? { videoGenerationProvider: DEFAULT_VIDEO_GENERATION_PROVIDER } : {}),
      });
    } catch (cause) {
      setRunpodLtxStatus('error');
      const safeError = friendlyRunpodLtxError(cause);
      setRunpodLtxError(
        /rejected|billing|account limits/i.test(safeError)
          ? safeError
          : 'RunPod did not confirm deletion. The Pod details are still saved; try ending the session again or delete it in the RunPod console.',
      );
      update({ runpodLtxStatus: 'error' });
    } finally {
      runpodLtxOperationRef.current = false;
      setRunpodLtxBusy(false);
    }
  }, [settings, update]);

  const scrollToCategory = useCallback((id: Category) => {
    setActiveCategory(id);
    const el = document.getElementById(`sp-section-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleTabChange = useCallback((t: SettingsTab) => {
    setTab(t);
    setActiveCategory(t === 'app' ? 'cloud' : 'resolution');
    // scroll content to top
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  const matchingPreset = RESOLUTION_PRESETS.find(
    (p) => p.w === settings.resolutionWidth && p.h === settings.resolutionHeight,
  );
  const hasRunpodLtxPod = Boolean(settings.runpodLtxPodId);
  const runpodLtxModelChoicesLocked = hasRunpodLtxPod || runpodLtxBusy;
  const runpodLtxDisplayedImageModels = hasRunpodLtxPod
    ? settings.runpodLtxActiveImageModels ?? []
    : settings.runpodLtxImageModels;
  const runpodLtxEstimatedWeight = runpodLtxEstimatedWeightGb(runpodLtxDisplayedImageModels);

  const categories = tab === 'app' ? APP_CATEGORIES : PROJECT_CATEGORIES;

  return (
    <div className="settings-page">
      {/* ---- Sidebar ---- */}
      <aside className={`sp-sidebar${sidebarOpen ? '' : ' sp-sidebar--collapsed'}`}>
        {sidebarOpen && (
          <>
            <div className="sp-sidebar__header">
              <span className="sp-sidebar__title">Settings</span>
              <button
                className="sp-sidebar__collapse"
                onClick={() => setSidebarOpen(false)}
                title="Collapse sidebar"
              >
                <IconChevron direction="left" />
              </button>
            </div>

            <nav className="sp-sidebar__nav">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  className={`sp-sidebar__nav-item${activeCategory === cat.id ? ' sp-sidebar__nav-item--active' : ''}`}
                  onClick={() => scrollToCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </nav>

            <div className="sp-sidebar__footer">
              <span className="sp-sidebar__version">CINEGEN Desktop v1.0.1</span>
            </div>
          </>
        )}

        {!sidebarOpen && (
          <button
            className="sp-sidebar__expand"
            onClick={() => setSidebarOpen(true)}
            title="Expand sidebar"
          >
            <IconChevron direction="right" />
          </button>
        )}
      </aside>

      {/* ---- Main panel ---- */}
      <div className="sp-main">
        {/* Tab bar */}
        <div className="sp-tabs">
          <button
            className={`sp-tabs__tab${tab === 'app' ? ' sp-tabs__tab--active' : ''}`}
            onClick={() => handleTabChange('app')}
          >
            App Settings
          </button>
          <button
            className={`sp-tabs__tab${tab === 'project' ? ' sp-tabs__tab--active' : ''}`}
            onClick={() => handleTabChange('project')}
          >
            Project Settings
          </button>
        </div>

        {/* Content */}
        <div className="sp-content" ref={contentRef}>
          {tab === 'app' && (
            <div className="sp-content__inner">
              <CloudAccountCard projectId={projectId} useSqlite={useSqlite} />
              <ClaudeMcpConnect />

              {/* --- API Keys --- */}
              <section className="sp-card" id="sp-section-api-keys">
                <h3 className="sp-card__title">Team Provider Access</h3>
                <p className="sp-card__desc">
                  Provider connections are shared through your secure team vault. Desktop uses a server-side relay, so teammates can generate without downloading or seeing the API keys.
                </p>
                <TeamProviderConnections settings={settings} update={update} />
                <TopviewConnect />
                <HiggsfieldConnect />
                <ArtlistConnect />
              </section>

              {/* --- RunPod Endpoints --- */}
              <section className="sp-card" id="sp-section-endpoints">
                <h3 className="sp-card__title">RunPod Endpoints</h3>
                <p className="sp-card__desc">
                  Paste serverless endpoint IDs used by legacy Spaces nodes. These stay separate from the temporary generation session below.
                </p>
                <div className="sp-card__fields sp-card__fields--grid">
                  {RUNPOD_MODELS.map((m) => (
                    <div key={m.key} className="sp-field">
                      <label className="sp-field__label">{m.label}</label>
                      <input
                        type="text"
                        className="sp-field__input sp-field__input--mono"
                        placeholder="Endpoint ID"
                        value={settings.runpodEndpoints[m.key] ?? ''}
                        onChange={(e) =>
                          update({ runpodEndpoints: { ...settings.runpodEndpoints, [m.key]: e.target.value } })
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>

              {/* --- Ephemeral LTX-2.5 GPU session --- */}
              <section className="sp-card" id="sp-section-pod">
                <div className="sp-ltx-header">
                  <div>
                    <h3 className="sp-card__title">RunPod Generation Session</h3>
                    <p className="sp-card__desc">One temporary GPU for LTX-2.5 video and the image models you choose.</p>
                  </div>
                  <span className={`sp-ltx-status sp-ltx-status--${runpodLtxStatus}`}>
                    <span aria-hidden />
                    {runpodLtxStatus === 'not-configured' ? 'No active session' : runpodLtxStatus.replaceAll('-', ' ')}
                  </span>
                </div>
                <p className="sp-card__desc">
                  Start Session creates a fresh Pod and downloads the selected model weights to temporary disk.
                  End Session permanently deletes that Pod and all of those weights so its GPU and storage charges stop.
                  Closing CineGen does not end a running Pod.
                </p>

                <div className="sp-ltx-prereqs" aria-label="RunPod generation session requirements">
                  <div><strong>1</strong><span>RunPod API key</span><small>{settings.runpodKey ? 'Added' : 'Add under API Keys'}</small></div>
                  <div><strong>2</strong><span>Model access</span><small>Accept the LTX-2.5 terms</small></div>
                  <div><strong>3</strong><span>HF read token</span><small>{settings.huggingFaceToken ? 'Added' : 'Required to download'}</small></div>
                </div>

                <fieldset
                  className="sp-ltx-gpu-picker"
                  aria-describedby="sp-ltx-gpu-profile-help"
                  disabled={runpodLtxModelChoicesLocked}
                >
                  <legend>
                    <span>GPU for next session</span>
                    <small>Choose cost or render speed before CineGen creates the Pod.</small>
                  </legend>
                  <div className="sp-ltx-gpu-options" role="radiogroup" aria-label="GPU for next session">
                    {RUNPOD_LTX_GPU_PROFILE_OPTIONS.map((option) => {
                      const selected = settings.runpodLtxGpuProfile === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={runpodLtxModelChoicesLocked}
                          className={`sp-ltx-gpu-option${selected ? ' is-selected' : ''}`}
                          onClick={() => update({ runpodLtxGpuProfile: option.id })}
                        >
                          <span className="sp-ltx-gpu-option__tier">{option.tier}</span>
                          <span className="sp-ltx-gpu-option__copy">
                            <strong>{option.name}</strong>
                            <small>{option.hardware}</small>
                            <span>{option.detail}</span>
                          </span>
                          <span className="sp-ltx-gpu-option__radio" aria-hidden><span /></span>
                        </button>
                      );
                    })}
                  </div>
                  <p id="sp-ltx-gpu-profile-help" className={`sp-ltx-gpu-help${settings.runpodLtxPodId ? ' is-locked' : ''}`}>
                    {settings.runpodLtxPodId
                      ? 'Locked while this Pod exists. This choice only applies to a new session and will not change or restart the active Pod.'
                      : runpodLtxBusy
                        ? 'Starting this session with the selected GPU profile.'
                        : 'Saved for the next Pod. Changing this setting does not create a session or begin charging.'}
                  </p>
                </fieldset>

                <div className="sp-ltx-model-builder" aria-labelledby="sp-ltx-model-builder-title">
                  <div className="sp-ltx-model-builder__header">
                    <div>
                      <strong id="sp-ltx-model-builder-title">Models in {hasRunpodLtxPod ? 'this active session' : 'the next session'}</strong>
                      <span>LTX-2.5 is required. Image generation is optional.</span>
                    </div>
                    <div className="sp-ltx-model-builder__estimate" aria-label={`Estimated ${runpodLtxEstimatedWeight.toFixed(1)} gigabytes of model weights`}>
                      <strong>~{runpodLtxEstimatedWeight.toFixed(1)} GB</strong>
                      <span>{runpodLtxStartupEstimate(runpodLtxDisplayedImageModels)}</span>
                    </div>
                  </div>

                  <div className="sp-ltx-model-row sp-ltx-model-row--required">
                    <span className="sp-ltx-model-row__tag">REQUIRED</span>
                    <span className="sp-ltx-model-row__copy">
                      <strong>LTX-2.5</strong>
                      <small>Video with synchronized audio · ~66 GB</small>
                      <span>Used by Director and RunPod video nodes during this session.</span>
                    </span>
                    <span className="sp-ltx-model-row__state">Always included</span>
                  </div>

                  <div className="sp-ltx-image-models" role="group" aria-label="Optional image models">
                    {RUNPOD_LTX_IMAGE_MODEL_OPTIONS.map((model) => {
                      const selected = runpodLtxDisplayedImageModels.includes(model.id);
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          disabled={runpodLtxModelChoicesLocked}
                          className={`sp-ltx-model-row sp-ltx-model-row--optional${selected ? ' is-selected' : ''}`}
                          onClick={() => update({
                            runpodLtxImageModels: selected
                              ? settings.runpodLtxImageModels.filter((id) => id !== model.id)
                              : normalizeRunpodLtxImageModels([...settings.runpodLtxImageModels, model.id], []),
                          })}
                        >
                          <span className="sp-ltx-model-row__tag">+{model.sizeGb} GB</span>
                          <span className="sp-ltx-model-row__copy">
                            <strong>{model.name}</strong>
                            <small>{model.purpose}</small>
                            <span>{model.requirement}</span>
                          </span>
                          <span className="sp-ltx-model-row__toggle" aria-hidden><span /></span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="sp-ltx-model-builder__note">
                    {hasRunpodLtxPod
                      ? 'This shows the models recorded for the active Pod. End Session before changing the model set for a new Pod.'
                      : 'Startup time varies with RunPod download speed. Every selected model is temporary and is deleted with End Session.'}
                  </p>
                </div>

                <div className="sp-card__fields">
                  <ApiKeyField
                    label="Hugging Face read token"
                    value={settings.huggingFaceToken === TEAM_PROVIDER_SENTINEL ? '' : settings.huggingFaceToken}
                    onChange={(value) => update({ huggingFaceToken: value })}
                    placeholder={settings.huggingFaceToken === TEAM_PROVIDER_SENTINEL ? 'Connected for team' : 'hf_...'}
                    disabled={settings.huggingFaceToken === TEAM_PROVIDER_SENTINEL}
                  />
                  <span className="sp-field__hint">
                    Used only to give this Pod access to the gated model download. CineGen never displays the token in session messages.
                    {' '}<a href="https://huggingface.co/Lightricks/LTX-2.5" target="_blank" rel="noreferrer">Accept the LTX-2.5 terms</a> before continuing.
                  </span>
                </div>

                {settings.runpodLtxPodId && (
                  <dl className="sp-ltx-resources">
                    <dt>Active Pod</dt><dd>{settings.runpodLtxPodId}</dd>
                    <dt>Models</dt><dd>{runpodLtxModelSummary(runpodLtxDisplayedImageModels)}</dd>
                    {runpodLtxGpu && <><dt>GPU</dt><dd>{runpodLtxGpu}</dd></>}
                    {typeof runpodLtxCostPerHr === 'number' && <><dt>Active rate</dt><dd>${runpodLtxCostPerHr.toFixed(2)} / hour</dd></>}
                    {settings.runpodLtxPodUrl && <><dt>Private address</dt><dd>{settings.runpodLtxPodUrl}</dd></>}
                  </dl>
                )}

                <div className="sp-ltx-progress" aria-label="RunPod generation session progress">
                  {RUNPOD_LTX_STEPS.map((step, index) => {
                    const currentIndex = RUNPOD_LTX_STEPS.findIndex((item) => item.status === runpodLtxStatus);
                    const completed = runpodLtxStatus === 'ready' || (currentIndex >= 0 && index < currentIndex);
                    const active = step.status === runpodLtxStatus;
                    return (
                      <div key={step.status} className={`sp-ltx-progress__step${active ? ' is-active' : ''}${completed ? ' is-complete' : ''}`}>
                        <span className="sp-ltx-progress__dot" aria-hidden>{completed ? '✓' : index + 1}</span>
                        <span>{step.label}</span>
                      </div>
                    );
                  })}
                </div>

                <div className={`sp-ltx-message${runpodLtxStatus === 'error' ? ' is-error' : ''}`} role={runpodLtxStatus === 'error' ? 'alert' : 'status'}>
                  <strong>{runpodLtxStatus === 'ready' ? 'Session ready' : runpodLtxStatus === 'error' ? 'Session needs attention' : 'Session status'}</strong>
                  <span>
                    {runpodLtxError || runpodLtxMessage || runpodLtxStatusMessage(runpodLtxStatus)}
                    {runpodLtxLastCheckedAt !== null && (
                      <> · Last checked at {new Date(runpodLtxLastCheckedAt).toLocaleTimeString()}.</>
                    )}
                  </span>
                </div>

                {!settings.runpodLtxPodId && (
                  <label className="sp-ltx-consent">
                    <input
                      type="checkbox"
                      checked={runpodCostConfirmed}
                      onChange={(event) => setRunpodCostConfirmed(event.target.checked)}
                    />
                    <span>
                      I understand RunPod charges begin when this Pod starts and continue until I end the session. The selected GPU and exact hourly rate appear after creation. All selected model weights are temporary and download again for a later session.
                    </span>
                  </label>
                )}

                <div className="sp-card__actions sp-ltx-actions">
                  {settings.runpodLtxPodId ? (
                    <div className="sp-ltx-session-actions">
                      <button
                        type="button"
                        className="sp-btn sp-btn--muted"
                        disabled={runpodLtxBusy || runpodLtxChecking || !settings.runpodKey}
                        onClick={() => void refreshRunpodLtxStatus()}
                      >
                        {runpodLtxChecking ? 'Checking…' : 'Check status'}
                      </button>
                      <button
                        type="button"
                        className="sp-btn sp-btn--danger"
                        disabled={runpodLtxBusy}
                        onClick={() => setShowRunpodEndConfirm(true)}
                      >
                        {runpodLtxStatus === 'terminating' ? 'Ending session…' : 'End session'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="sp-btn sp-btn--accent"
                      disabled={
                        runpodLtxBusy
                        || !settings.runpodKey
                        || !runpodCostConfirmed
                        || !settings.huggingFaceToken
                      }
                      onClick={() => void setupRunpodLtx()}
                    >
                      {runpodLtxBusy ? 'Starting generation session…' : 'Start generation session'}
                    </button>
                  )}
                  <a className="sp-ltx-console-link" href="https://console.runpod.io/pods" target="_blank" rel="noreferrer">Open RunPod console</a>
                </div>

                {showRunpodEndConfirm && settings.runpodLtxPodId && (
                  <div className="sp-ltx-end-confirm" role="alert">
                    <div>
                      <strong>Delete this RunPod generation Pod?</strong>
                      <span>This permanently removes the Pod and every temporary model weight, ending its GPU and storage charges. Starting again will redownload the selected models.</span>
                    </div>
                    <div>
                      <button type="button" className="sp-btn sp-btn--muted" disabled={runpodLtxBusy} onClick={() => setShowRunpodEndConfirm(false)}>Cancel</button>
                      <button type="button" className="sp-btn sp-btn--danger" disabled={runpodLtxBusy} onClick={() => void terminateRunpodLtx()}>
                        {runpodLtxBusy ? 'Deleting Pod…' : 'Delete Pod and end session'}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* --- Provider --- */}
              <section className="sp-card" id="sp-section-provider">
                <h3 className="sp-card__title">Generation providers</h3>
                <p className="sp-card__desc">Choose which connected service CineGen uses when Director renders video.</p>
                <div className="sp-provider-choice" role="radiogroup" aria-label="Video generation provider">
                  {([
                    { id: 'topview' as const, name: 'Topview AI', detail: 'Default · official MCP with live model selection and element references', disabled: false },
                    { id: 'higgsfield' as const, name: 'Higgsfield', detail: 'Generate through your connected Higgsfield account', disabled: false },
                    { id: 'artlist' as const, name: 'Artlist', detail: 'Generate through Artlist MCP with element references', disabled: false },
                    {
                      id: 'runpod' as const,
                      name: 'RunPod · LTX-2.5',
                      detail: runpodLtxStatus === 'ready' ? 'Your LTX-2.5 GPU session is ready' : 'Start an LTX-2.5 session above first',
                      disabled: runpodLtxStatus !== 'ready',
                    },
                  ]).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      disabled={option.disabled}
                      aria-checked={settings.videoGenerationProvider === option.id}
                      className={`sp-provider-choice__option${settings.videoGenerationProvider === option.id ? ' is-selected' : ''}`}
                      onClick={() => update({ videoGenerationProvider: option.id })}
                    >
                      <span className="sp-provider-choice__mark">{option.id === 'topview' ? 'T' : option.id === 'artlist' ? 'A' : option.id === 'runpod' ? 'R' : 'H'}</span>
                      <span className="sp-provider-choice__copy"><strong>{option.name}</strong><small>{option.detail}</small></span>
                      <span className="sp-provider-choice__radio" aria-hidden><span /></span>
                    </button>
                  ))}
                </div>
                <div className="sp-provider-catalog">
                  <div>
                    <strong>Spaces model catalog</strong>
                    <span>Controls which API-backed models appear in the node palette.</span>
                  </div>
                  <div className="sp-toggle-group">
                    {(['fal', 'kie'] as Provider[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`sp-toggle-group__btn${settings.provider === p ? ' sp-toggle-group__btn--active' : ''}`}
                        onClick={() => update({ provider: p })}
                      >
                        {p === 'fal' ? 'fal.ai' : 'kie.ai'}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* --- Preferences --- */}
              <section className="sp-card" id="sp-section-preferences">
                <h3 className="sp-card__title">Preferences</h3>
                <div className="sp-card__fields">
                  <div className="sp-field">
                    <label className="sp-field__label">Default Transcription Engine</label>
                    <select
                      className="sp-field__input"
                      value={settings.defaultTranscriptionEngine}
                      onChange={(e) => update({ defaultTranscriptionEngine: e.target.value as DefaultTranscriptionEngine })}
                    >
                      {TRANSCRIPTION_ENGINES.map((eng) => (
                        <option key={eng.value} value={eng.value}>{eng.label}</option>
                      ))}
                    </select>
                    <span className="sp-field__hint">
                      Used for background transcription when new audio/video is imported.
                    </span>
                  </div>
                  <div className="sp-pref-row">
                    <div>
                      <span className="sp-pref-row__label">Auto visual indexing</span>
                      <span className="sp-pref-row__hint">Keep project visual summaries warm in the background</span>
                    </div>
                    <button
                      className={`sp-switch${settings.autoVisualIndexing ? ' sp-switch--on' : ''}`}
                      onClick={() => update({ autoVisualIndexing: !settings.autoVisualIndexing })}
                      role="switch"
                      aria-checked={settings.autoVisualIndexing}
                    >
                      <span className="sp-switch__thumb" />
                    </button>
                  </div>
                  <div className="sp-pref-row">
                    <div>
                      <span className="sp-pref-row__label">Analyze new imports automatically</span>
                      <span className="sp-pref-row__hint">Queue visual indexing when video/image assets enter the media pool</span>
                    </div>
                    <button
                      className={`sp-switch${settings.analyzeVisionOnImport ? ' sp-switch--on' : ''}`}
                      onClick={() => update({ analyzeVisionOnImport: !settings.analyzeVisionOnImport })}
                      role="switch"
                      aria-checked={settings.analyzeVisionOnImport}
                    >
                      <span className="sp-switch__thumb" />
                    </button>
                  </div>
                  <div className="sp-field">
                    <label className="sp-field__label">Background Vision Model</label>
                    <select
                      className="sp-field__input"
                      value={settings.backgroundVisionModel}
                      onChange={(e) => update({ backgroundVisionModel: e.target.value })}
                    >
                      {VISION_MODEL_OPTIONS.map((model) => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </select>
                    <span className="sp-field__hint">
                      Used by the autonomous project-wide visual indexing queue.
                    </span>
                  </div>
                  <div className="sp-field">
                    <label className="sp-field__label">Cut Vision Model</label>
                    <select
                      className="sp-field__input"
                      value={settings.cutVisionModel}
                      onChange={(e) => update({ cutVisionModel: e.target.value })}
                    >
                      {VISION_MODEL_OPTIONS.map((model) => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </select>
                    <span className="sp-field__hint">
                      Used for higher-quality vision analysis when generating editorial cut variants.
                    </span>
                  </div>
                  <div className="sp-field">
                    <label className="sp-field__label">Max Concurrent Vision Jobs</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      className="sp-field__input"
                      value={settings.maxConcurrentVisionJobs}
                      onChange={(e) => update({
                        maxConcurrentVisionJobs: Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                      })}
                    />
                    <span className="sp-field__hint">
                      Higher values index faster but spend more fal.ai credits in parallel.
                    </span>
                  </div>
                  <div className="sp-pref-row">
                    <div>
                      <span className="sp-pref-row__label">Reduce animations</span>
                      <span className="sp-pref-row__hint">Minimize motion throughout the UI</span>
                    </div>
                    <button
                      className={`sp-switch${settings.reduceMotion ? ' sp-switch--on' : ''}`}
                      onClick={() => update({ reduceMotion: !settings.reduceMotion })}
                      role="switch"
                      aria-checked={settings.reduceMotion}
                    >
                      <span className="sp-switch__thumb" />
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'project' && (
            <div className="sp-content__inner">
              {/* --- Resolution --- */}
              <section className="sp-card" id="sp-section-resolution">
                <h3 className="sp-card__title">Resolution</h3>
                <p className="sp-card__desc">Default canvas size for new timelines and exports.</p>
                <div className="sp-res-presets">
                  {RESOLUTION_PRESETS.map((p) => {
                    const active = matchingPreset === p;
                    return (
                      <button
                        key={p.tag}
                        className={`sp-res-card${active ? ' sp-res-card--active' : ''}`}
                        onClick={() => update({ resolutionWidth: p.w, resolutionHeight: p.h })}
                      >
                        <span className="sp-res-card__label">{p.label}</span>
                        <span className="sp-res-card__dim">{p.w} x {p.h}</span>
                        <span className="sp-res-card__tag">{p.tag}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="sp-res-custom">
                  <div className="sp-field sp-field--inline">
                    <label className="sp-field__label">Width</label>
                    <input
                      type="number"
                      className="sp-field__input sp-field__input--narrow"
                      value={settings.resolutionWidth}
                      onChange={(e) => update({ resolutionWidth: Math.max(1, parseInt(e.target.value) || 0) })}
                      min={1}
                    />
                  </div>
                  <span className="sp-res-custom__x">x</span>
                  <div className="sp-field sp-field--inline">
                    <label className="sp-field__label">Height</label>
                    <input
                      type="number"
                      className="sp-field__input sp-field__input--narrow"
                      value={settings.resolutionHeight}
                      onChange={(e) => update({ resolutionHeight: Math.max(1, parseInt(e.target.value) || 0) })}
                      min={1}
                    />
                  </div>
                </div>
              </section>

              {/* --- Frame Rate --- */}
              <section className="sp-card" id="sp-section-frame-rate">
                <h3 className="sp-card__title">Frame Rate</h3>
                <p className="sp-card__desc">Default playback and render frame rate.</p>
                <div className="sp-fps-group">
                  {([24, 30, 60] as const).map((fr) => (
                    <button
                      key={fr}
                      className={`sp-fps-btn${settings.frameRate === fr ? ' sp-fps-btn--active' : ''}`}
                      onClick={() => update({ frameRate: fr })}
                    >
                      <span className="sp-fps-btn__num">{fr}</span>
                      <span className="sp-fps-btn__unit">fps</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* --- Aspect Ratio --- */}
              <section className="sp-card" id="sp-section-aspect-ratio">
                <h3 className="sp-card__title">Aspect Ratio</h3>
                <p className="sp-card__desc">Default aspect ratio for generated media.</p>
                <div className="sp-toggle-group">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar}
                      className={`sp-toggle-group__btn${settings.aspectRatio === ar ? ' sp-toggle-group__btn--active' : ''}`}
                      onClick={() => update({ aspectRatio: ar })}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </section>

              {/* --- About --- */}
              <section className="sp-card sp-card--muted">
                <p className="sp-card__about">
                  CINEGEN Desktop v1 — Node-based AI media generation
                </p>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
