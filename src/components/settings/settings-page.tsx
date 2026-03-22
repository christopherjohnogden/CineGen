import { useState, useEffect, useCallback, useRef } from 'react';
import type { DefaultTranscriptionEngine } from '@/lib/utils/api-key';

/* -----------------------------------------------------------------------
   Types & constants
   ----------------------------------------------------------------------- */

const STORAGE_KEY = 'cinegen_settings';

type Provider = 'fal' | 'kie';
type SettingsTab = 'app' | 'project';

/* Sidebar category IDs — these double as scroll-anchor IDs */
type AppCategory = 'api-keys' | 'endpoints' | 'pod' | 'provider' | 'preferences';
type ProjectCategory = 'resolution' | 'frame-rate' | 'aspect-ratio';
type Category = AppCategory | ProjectCategory;

const APP_CATEGORIES: { id: AppCategory; label: string }[] = [
  { id: 'api-keys', label: 'API Keys' },
  { id: 'endpoints', label: 'RunPod Endpoints' },
  { id: 'pod', label: 'CineGen Pod' },
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
  runpodKey: string;
  runpodEndpoints: Record<string, string>;
  podId: string;
  podUrl: string;
  provider: Provider;
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
  runpodKey: '',
  runpodEndpoints: {},
  podId: '',
  podUrl: '',
  provider: 'fal',
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
  { key: 'runpod-sdxl',            label: 'Stable Diffusion XL' },
  { key: 'runpod-qwen-image-edit', label: 'Qwen Image Edit' },
  { key: 'runpod-ltx-video',       label: 'LTX Video' },
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

/* -----------------------------------------------------------------------
   Persistence
   ----------------------------------------------------------------------- */

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        />
        <button
          className="sp-field__eye-btn"
          onClick={() => setVisible((v) => !v)}
          title={visible ? 'Hide' : 'Reveal'}
          type="button"
        >
          <IconEye open={visible} />
        </button>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------
   Main component
   ----------------------------------------------------------------------- */

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTab] = useState<SettingsTab>('app');
  const [activeCategory, setActiveCategory] = useState<Category>('api-keys');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [podStatus, setPodStatus] = useState<'unknown' | 'starting' | 'stopping' | 'running' | 'stopped'>('unknown');
  const [podError, setPodError] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onBack();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onBack]);

  const update = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }, []);

  const scrollToCategory = useCallback((id: Category) => {
    setActiveCategory(id);
    const el = document.getElementById(`sp-section-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleTabChange = useCallback((t: SettingsTab) => {
    setTab(t);
    setActiveCategory(t === 'app' ? 'api-keys' : 'resolution');
    // scroll content to top
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  const matchingPreset = RESOLUTION_PRESETS.find(
    (p) => p.w === settings.resolutionWidth && p.h === settings.resolutionHeight,
  );

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
              <span className="sp-sidebar__version">CINEGEN Desktop v1</span>
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
              {/* --- API Keys --- */}
              <section className="sp-card" id="sp-section-api-keys">
                <h3 className="sp-card__title">API Keys</h3>
                <p className="sp-card__desc">Stored locally on this device — never sent to CINEGEN servers.</p>
                <div className="sp-card__fields">
                  <ApiKeyField
                    label="fal.ai"
                    value={settings.falKey}
                    onChange={(v) => update({ falKey: v })}
                    placeholder="Enter your fal.ai key..."
                  />
                  <ApiKeyField
                    label="kie.ai"
                    value={settings.kieKey}
                    onChange={(v) => update({ kieKey: v })}
                    placeholder="Enter your kie.ai key..."
                  />
                  <ApiKeyField
                    label="RunPod"
                    value={settings.runpodKey}
                    onChange={(v) => update({ runpodKey: v })}
                    placeholder="Enter your RunPod key..."
                  />
                </div>
              </section>

              {/* --- RunPod Endpoints --- */}
              <section className="sp-card" id="sp-section-endpoints">
                <h3 className="sp-card__title">RunPod Endpoints</h3>
                <p className="sp-card__desc">
                  Paste your serverless endpoint IDs from <strong>runpod.io/console/serverless</strong>.
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

              {/* --- CineGen Pod --- */}
              <section className="sp-card" id="sp-section-pod">
                <h3 className="sp-card__title">CineGen Pod</h3>
                <p className="sp-card__desc">
                  Personal GPU pod running the CineGen server. Start/stop to control billing.
                </p>
                <div className="sp-card__fields">
                  <div className="sp-field">
                    <label className="sp-field__label">Pod ID</label>
                    <input
                      type="text"
                      className="sp-field__input sp-field__input--mono"
                      placeholder="e.g. abc123xyz"
                      value={settings.podId}
                      onChange={(e) => update({ podId: e.target.value })}
                    />
                  </div>
                  <div className="sp-field">
                    <label className="sp-field__label">Pod URL</label>
                    <input
                      type="text"
                      className="sp-field__input sp-field__input--mono"
                      placeholder="http://1.2.3.4:8000"
                      value={settings.podUrl}
                      onChange={(e) => update({ podUrl: e.target.value })}
                    />
                  </div>
                </div>
                {podError && <p className="sp-card__error">{podError}</p>}
                <div className="sp-card__actions">
                  <button
                    className="sp-btn sp-btn--accent"
                    disabled={!settings.podId || !settings.runpodKey || podStatus === 'starting'}
                    onClick={async () => {
                      setPodStatus('starting');
                      setPodError('');
                      try {
                        await window.electronAPI.pod.start({ runpodKey: settings.runpodKey, podId: settings.podId });
                        for (let i = 0; i < 40; i++) {
                          await new Promise((r) => setTimeout(r, 5000));
                          const s = await window.electronAPI.pod.status({ runpodKey: settings.runpodKey, podId: settings.podId });
                          if (s.ip && s.port) {
                            const url = `http://${s.ip}:${s.port}`;
                            update({ podUrl: url });
                            setPodStatus('running');
                            return;
                          }
                        }
                        setPodError('Pod started but URL not available yet — check RunPod dashboard.');
                        setPodStatus('unknown');
                      } catch (e) {
                        setPodError(e instanceof Error ? e.message : 'Failed to start pod');
                        setPodStatus('unknown');
                      }
                    }}
                  >
                    {podStatus === 'starting' ? 'Starting...' : 'Start Pod'}
                  </button>
                  <button
                    className="sp-btn sp-btn--muted"
                    disabled={!settings.podId || !settings.runpodKey || podStatus === 'stopping'}
                    onClick={async () => {
                      setPodStatus('stopping');
                      setPodError('');
                      try {
                        await window.electronAPI.pod.stop({ runpodKey: settings.runpodKey, podId: settings.podId });
                        setPodStatus('stopped');
                      } catch (e) {
                        setPodError(e instanceof Error ? e.message : 'Failed to stop pod');
                        setPodStatus('unknown');
                      }
                    }}
                  >
                    {podStatus === 'stopping' ? 'Stopping...' : 'Stop Pod'}
                  </button>
                  {podStatus !== 'unknown' && (
                    <span className={`sp-card__status sp-card__status--${podStatus}`}>
                      {podStatus.charAt(0).toUpperCase() + podStatus.slice(1)}
                    </span>
                  )}
                </div>
              </section>

              {/* --- Provider --- */}
              <section className="sp-card" id="sp-section-provider">
                <h3 className="sp-card__title">Default Provider</h3>
                <p className="sp-card__desc">Controls which models appear in the palette and panel.</p>
                <div className="sp-toggle-group">
                  {(['fal', 'kie'] as Provider[]).map((p) => (
                    <button
                      key={p}
                      className={`sp-toggle-group__btn${settings.provider === p ? ' sp-toggle-group__btn--active' : ''}`}
                      onClick={() => update({ provider: p })}
                    >
                      {p === 'fal' ? 'fal.ai' : 'kie.ai'}
                    </button>
                  ))}
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
