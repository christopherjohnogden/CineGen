

import { useState } from 'react';
import type { ExportPreset } from '@/types/export';

interface ExportSettingsProps {
  hasClips: boolean;
  onRender: (preset: ExportPreset, fps: 24 | 30 | 60) => void;
}

export function ExportSettings({ hasClips, onRender }: ExportSettingsProps) {
  const [preset, setPreset] = useState<ExportPreset>('standard');
  const [fps, setFps] = useState<24 | 30 | 60>(30);

  const presets: { value: ExportPreset; label: string; resolution: string }[] = [
    { value: 'draft', label: 'Draft', resolution: '720p' },
    { value: 'standard', label: 'Standard', resolution: '1080p' },
    { value: 'high', label: 'High Quality', resolution: '4K' },
  ];

  return (
    <div className="export-settings">
      <div className="export-settings__section">
        <div className="export-settings__label">Preset</div>
        <div className="export-settings__presets">
          {presets.map((p) => (
            <button
              key={p.value}
              className={`export-settings__preset-card${preset === p.value ? ' export-settings__preset-card--active' : ''}`}
              onClick={() => setPreset(p.value)}
            >
              <div className="export-settings__preset-name">{p.label}</div>
              <div className="export-settings__preset-res">{p.resolution}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="export-settings__section">
        <div className="export-settings__label">Frame Rate</div>
        <select
          className="export-settings__fps-select"
          value={fps}
          onChange={(e) => setFps(Number(e.target.value) as 24 | 30 | 60)}
        >
          <option value={24}>24 fps</option>
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
      </div>

      <button
        className="export-settings__render-btn"
        disabled={!hasClips}
        onClick={() => onRender(preset, fps)}
        title={hasClips ? undefined : 'Add clips to the timeline first'}
      >
        Render
      </button>
    </div>
  );
}
