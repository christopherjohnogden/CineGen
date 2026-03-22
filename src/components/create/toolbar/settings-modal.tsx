

import { useState, useEffect, useRef, useCallback } from 'react';
import type { DefaultTranscriptionEngine } from '@/lib/utils/api-key';
import { getRunpodApiKey } from '@/lib/utils/api-key';

interface SettingsModalProps {
  onClose: () => void;
}

const STORAGE_KEY = 'cinegen_settings';

type Provider = 'fal' | 'kie';

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

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showFalKey, setShowFalKey] = useState(false);
  const [showKieKey, setShowKieKey] = useState(false);
  const [showRunpodKey, setShowRunpodKey] = useState(false);
  const [podStatus, setPodStatus] = useState<'unknown' | 'starting' | 'stopping' | 'running' | 'stopped'>('unknown');
  const [podError, setPodError] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const update = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }, []);

  return (
    <div className="settings-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="settings-modal">
        <div className="settings-modal__header">
          <h2 className="settings-modal__title">Settings</h2>
          <button className="settings-modal__close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-modal__body">
          <section className="settings-modal__section">
            <h3 className="settings-modal__section-title">API Keys</h3>
            <label className="settings-modal__label">fal.ai API Key</label>
            <div className="settings-modal__key-row">
              <input
                type={showFalKey ? 'text' : 'password'}
                className="settings-modal__input"
                placeholder="Enter your fal.ai key..."
                value={settings.falKey}
                onChange={(e) => update({ falKey: e.target.value })}
              />
              <button
                className="settings-modal__toggle-btn"
                onClick={() => setShowFalKey((v) => !v)}
              >
                {showFalKey ? 'Hide' : 'Show'}
              </button>
            </div>

            <label className="settings-modal__label" style={{ marginTop: 12 }}>kie.ai API Key</label>
            <div className="settings-modal__key-row">
              <input
                type={showKieKey ? 'text' : 'password'}
                className="settings-modal__input"
                placeholder="Enter your kie.ai key..."
                value={settings.kieKey}
                onChange={(e) => update({ kieKey: e.target.value })}
              />
              <button
                className="settings-modal__toggle-btn"
                onClick={() => setShowKieKey((v) => !v)}
              >
                {showKieKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <label className="settings-modal__label" style={{ marginTop: 12 }}>RunPod API Key</label>
            <div className="settings-modal__key-row">
              <input
                type={showRunpodKey ? 'text' : 'password'}
                className="settings-modal__input"
                placeholder="Enter your RunPod key..."
                value={settings.runpodKey}
                onChange={(e) => update({ runpodKey: e.target.value })}
              />
              <button
                className="settings-modal__toggle-btn"
                onClick={() => setShowRunpodKey((v) => !v)}
              >
                {showRunpodKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="settings-modal__hint">
              Stored locally in your browser.
            </p>
          </section>

          <section className="settings-modal__section">
            <h3 className="settings-modal__section-title">RunPod Endpoints</h3>
            <p className="settings-modal__hint" style={{ marginBottom: 10 }}>
              Paste your serverless endpoint IDs from <strong>runpod.io/console/serverless</strong>.
            </p>
            {RUNPOD_MODELS.map((m) => (
              <div key={m.key}>
                <label className="settings-modal__label" style={{ marginTop: 8 }}>{m.label}</label>
                <input
                  type="text"
                  className="settings-modal__input"
                  placeholder={`Endpoint ID (e.g. abc123xyz)`}
                  value={settings.runpodEndpoints[m.key] ?? ''}
                  onChange={(e) => update({
                    runpodEndpoints: { ...settings.runpodEndpoints, [m.key]: e.target.value },
                  })}
                />
              </div>
            ))}
          </section>

          <section className="settings-modal__section">
            <h3 className="settings-modal__section-title">CineGen Pod</h3>
            <p className="settings-modal__hint" style={{ marginBottom: 10 }}>
              Your personal GPU pod running the CineGen server. Start/stop to control billing.
            </p>
            <label className="settings-modal__label">Pod ID</label>
            <input
              type="text"
              className="settings-modal__input"
              placeholder="e.g. abc123xyz (from RunPod dashboard)"
              value={settings.podId}
              onChange={(e) => update({ podId: e.target.value })}
            />
            <label className="settings-modal__label" style={{ marginTop: 8 }}>Pod URL</label>
            <input
              type="text"
              className="settings-modal__input"
              placeholder="http://1.2.3.4:8000 (auto-filled after start)"
              value={settings.podUrl}
              onChange={(e) => update({ podUrl: e.target.value })}
            />
            {podError && <p className="settings-modal__hint" style={{ color: '#f87171', marginTop: 4 }}>{podError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                className="settings-modal__provider-btn"
                disabled={!settings.podId || !settings.runpodKey || podStatus === 'starting'}
                onClick={async () => {
                  setPodStatus('starting');
                  setPodError('');
                  try {
                    await window.electronAPI.pod.start({ runpodKey: settings.runpodKey, podId: settings.podId });
                    // Poll until running and we have an IP
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
                {podStatus === 'starting' ? 'Starting…' : '▶ Start Pod'}
              </button>
              <button
                className="settings-modal__provider-btn"
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
                {podStatus === 'stopping' ? 'Stopping…' : '■ Stop Pod'}
              </button>
              <span style={{ alignSelf: 'center', fontSize: 11, color: podStatus === 'running' ? '#4ade80' : podStatus === 'stopped' ? '#f87171' : 'var(--text-muted)' }}>
                {podStatus === 'unknown' ? '' : podStatus.charAt(0).toUpperCase() + podStatus.slice(1)}
              </span>
            </div>
          </section>

          <section className="settings-modal__section">
            <h3 className="settings-modal__section-title">Provider</h3>
            <div className="settings-modal__provider-toggle">
              <button
                className={`settings-modal__provider-btn${settings.provider === 'fal' ? ' settings-modal__provider-btn--active' : ''}`}
                onClick={() => update({ provider: 'fal' })}
              >
                fal.ai
              </button>
              <button
                className={`settings-modal__provider-btn${settings.provider === 'kie' ? ' settings-modal__provider-btn--active' : ''}`}
                onClick={() => update({ provider: 'kie' })}
              >
                kie.ai
              </button>
            </div>
            <p className="settings-modal__hint">
              Controls which models appear in the palette and panel.
            </p>
          </section>

          <section className="settings-modal__section">
            <h3 className="settings-modal__section-title">Preferences</h3>
            <label className="settings-modal__label">Default Auto-Transcription Engine</label>
            <select
              className="settings-modal__input"
              value={settings.defaultTranscriptionEngine}
              onChange={(e) => update({ defaultTranscriptionEngine: e.target.value as DefaultTranscriptionEngine })}
            >
              {TRANSCRIPTION_ENGINES.map((engine) => (
                <option key={engine.value} value={engine.value}>{engine.label}</option>
              ))}
            </select>
            <p className="settings-modal__hint" style={{ marginTop: 4 }}>
              Used for background transcription when new audio or video is imported into the media pool.
            </p>
            <div className="settings-modal__pref-row">
              <span className="settings-modal__pref-label">Auto visual indexing</span>
              <button
                className={`model-node__toggle${settings.autoVisualIndexing ? ' model-node__toggle--on' : ''}`}
                onClick={() => update({ autoVisualIndexing: !settings.autoVisualIndexing })}
              >
                {settings.autoVisualIndexing ? 'On' : 'Off'}
              </button>
            </div>
            <div className="settings-modal__pref-row">
              <span className="settings-modal__pref-label">Analyze new imports automatically</span>
              <button
                className={`model-node__toggle${settings.analyzeVisionOnImport ? ' model-node__toggle--on' : ''}`}
                onClick={() => update({ analyzeVisionOnImport: !settings.analyzeVisionOnImport })}
              >
                {settings.analyzeVisionOnImport ? 'On' : 'Off'}
              </button>
            </div>
            <label className="settings-modal__label" style={{ marginTop: 12 }}>Background Vision Model</label>
            <select
              className="settings-modal__input"
              value={settings.backgroundVisionModel}
              onChange={(e) => update({ backgroundVisionModel: e.target.value })}
            >
              {VISION_MODEL_OPTIONS.map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
            <p className="settings-modal__hint" style={{ marginTop: 4 }}>
              Used by the autonomous visual indexing pass that keeps project context warm for the LLM.
            </p>
            <label className="settings-modal__label" style={{ marginTop: 12 }}>Cut Vision Model</label>
            <select
              className="settings-modal__input"
              value={settings.cutVisionModel}
              onChange={(e) => update({ cutVisionModel: e.target.value })}
            >
              {VISION_MODEL_OPTIONS.map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
            <p className="settings-modal__hint" style={{ marginTop: 4 }}>
              Used for higher-quality visual analysis during cut generation.
            </p>
            <label className="settings-modal__label" style={{ marginTop: 12 }}>Max Concurrent Vision Jobs</label>
            <input
              type="number"
              min={1}
              max={6}
              className="settings-modal__input"
              value={settings.maxConcurrentVisionJobs}
              onChange={(e) => update({
                maxConcurrentVisionJobs: Math.max(1, Math.min(6, Number(e.target.value) || 1)),
              })}
            />
            <p className="settings-modal__hint" style={{ marginTop: 4 }}>
              Higher values index faster but spend more fal.ai credits in parallel.
            </p>
            <div className="settings-modal__pref-row">
              <span className="settings-modal__pref-label">Reduce animations</span>
              <button
                className={`model-node__toggle${settings.reduceMotion ? ' model-node__toggle--on' : ''}`}
                onClick={() => update({ reduceMotion: !settings.reduceMotion })}
              >
                {settings.reduceMotion ? 'On' : 'Off'}
              </button>
            </div>
          </section>

          <section className="settings-modal__section">
            <h3 className="settings-modal__section-title">About</h3>
            <p className="settings-modal__hint">
              CINEGEN Web v1 &mdash; Node-based AI media generation
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
