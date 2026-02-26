import { useMemo, useState } from 'react'
import type {
  ExportJob,
  ExportPresetId,
  ExportSettings,
} from '../types/engine'
import { formatDateTime, formatPercent } from '../utils/format'

interface ExportTabProps {
  sequenceId: string
  exportJobs: ExportJob[]
  onCreateAndEnqueue: (settings: ExportSettings) => void
  onCancelExport: (exportJobId: string) => void
  onRetryExport: (exportJobId: string) => void
  onRevealOutputPath: (path: string) => void
  onCopyOutputPath: (path: string) => void
}

const presetDefaults: Record<
  ExportPresetId,
  Pick<ExportSettings, 'codecProfile' | 'bitrateMbps' | 'resolution' | 'fps' | 'audioKbps'>
> = {
  h264_mp4: {
    codecProfile: 'H.264 High',
    bitrateMbps: 18,
    resolution: '1920x1080',
    fps: 30,
    audioKbps: 192,
  },
  h265_mp4: {
    codecProfile: 'H.265 Main10',
    bitrateMbps: 14,
    resolution: '1920x1080',
    fps: 30,
    audioKbps: 192,
  },
  prores_mov: {
    codecProfile: 'ProRes 422',
    bitrateMbps: 220,
    resolution: '1920x1080',
    fps: 30,
    audioKbps: 320,
  },
}

const presetLabels: Record<ExportPresetId, string> = {
  h264_mp4: 'H.264 MP4',
  h265_mp4: 'H.265 MP4',
  prores_mov: 'ProRes MOV',
}

function defaultSettingsFromPreset(preset: ExportPresetId): ExportSettings {
  return {
    preset,
    destinationName: `cinegen-${preset}-${Date.now()}.mp4`,
    ...presetDefaults[preset],
  }
}

export function ExportTab({
  sequenceId,
  exportJobs,
  onCreateAndEnqueue,
  onCancelExport,
  onRetryExport,
  onRevealOutputPath,
  onCopyOutputPath,
}: ExportTabProps) {
  const [selectedPreset, setSelectedPreset] = useState<ExportPresetId>('h264_mp4')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [settings, setSettings] = useState<ExportSettings>(defaultSettingsFromPreset('h264_mp4'))

  const activeJobs = useMemo(() => {
    return exportJobs.filter((job) => job.status === 'pending' || job.status === 'running')
  }, [exportJobs])

  function updatePreset(preset: ExportPresetId): void {
    setSelectedPreset(preset)
    setSettings((prev) => ({
      ...prev,
      preset,
      ...presetDefaults[preset],
      destinationName: `cinegen-${sequenceId}-${preset}.mov`,
    }))
  }

  return (
    <section className="export-tab" aria-label="Export workspace">
      <div className="export-tab__main">
        <h2>Presets</h2>
        <div className="preset-grid">
          {(Object.keys(presetLabels) as ExportPresetId[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={`preset-card ${selectedPreset === preset ? 'is-active' : ''}`}
              onClick={() => updatePreset(preset)}
            >
              <strong>{presetLabels[preset]}</strong>
              <span>{presetDefaults[preset].codecProfile}</span>
            </button>
          ))}
        </div>

        <div className="export-actions-row">
          <button type="button" className="primary-button" onClick={() => onCreateAndEnqueue(settings)}>
            Enqueue Export
          </button>
          <button
            type="button"
            className="outline-button"
            onClick={() => setShowAdvanced((prev) => !prev)}
          >
            {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
          </button>
        </div>

        {showAdvanced ? (
          <div className="advanced-settings">
            <h3>Advanced Settings</h3>
            <label className="field-label" htmlFor="destination-name">
              Destination name
            </label>
            <input
              id="destination-name"
              className="input"
              value={settings.destinationName}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  destinationName: event.target.value,
                }))
              }
            />

            <div className="advanced-grid">
              <label className="field-label" htmlFor="codec-profile">
                Codec profile
              </label>
              <input
                id="codec-profile"
                className="input"
                value={settings.codecProfile}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    codecProfile: event.target.value,
                  }))
                }
              />

              <label className="field-label" htmlFor="bitrate">
                Bitrate Mbps
              </label>
              <input
                id="bitrate"
                className="input"
                type="number"
                min={4}
                max={400}
                value={settings.bitrateMbps}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    bitrateMbps: Number(event.target.value),
                  }))
                }
              />

              <label className="field-label" htmlFor="resolution">
                Resolution
              </label>
              <select
                id="resolution"
                className="input"
                value={settings.resolution}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    resolution: event.target.value as ExportSettings['resolution'],
                  }))
                }
              >
                <option value="1920x1080">1920x1080</option>
                <option value="2560x1440">2560x1440</option>
                <option value="3840x2160">3840x2160</option>
              </select>

              <label className="field-label" htmlFor="fps">
                FPS
              </label>
              <select
                id="fps"
                className="input"
                value={settings.fps}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    fps: Number(event.target.value) as ExportSettings['fps'],
                  }))
                }
              >
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>

              <label className="field-label" htmlFor="audio-kbps">
                Audio kbps
              </label>
              <select
                id="audio-kbps"
                className="input"
                value={settings.audioKbps}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    audioKbps: Number(event.target.value) as ExportSettings['audioKbps'],
                  }))
                }
              >
                <option value={192}>192</option>
                <option value={256}>256</option>
                <option value={320}>320</option>
              </select>
            </div>
          </div>
        ) : null}
      </div>

      <aside className="export-tab__queue">
        <h2>Queue ({activeJobs.length} active)</h2>
        <ul className="job-list">
          {exportJobs.map((job) => (
            <li key={job.id} className="job-list__item">
              <div>
                <strong>{presetLabels[job.settings.preset]}</strong>
                <p>Status: {job.status}</p>
                <p>Progress: {formatPercent(job.progress)}</p>
                <p>{formatDateTime(job.updatedAt)}</p>
                {job.errorMessage ? <p className="error-text">{job.errorMessage}</p> : null}
              </div>

              <div className="inline-actions">
                {(job.status === 'pending' || job.status === 'running') && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onCancelExport(job.id)}
                  >
                    Cancel
                  </button>
                )}
                {(job.status === 'failed' || job.status === 'canceled') && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onRetryExport(job.id)}
                  >
                    Retry
                  </button>
                )}
                {job.status === 'completed' && job.outputPath ? (
                  <>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onRevealOutputPath(job.outputPath ?? '')}
                    >
                      Reveal in Finder
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onCopyOutputPath(job.outputPath ?? '')}
                    >
                      Copy Path
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
