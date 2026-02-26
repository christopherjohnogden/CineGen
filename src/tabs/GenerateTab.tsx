import { useMemo, useState } from 'react'
import type {
  AssetVersion,
  GenerationJob,
  PromptClip,
} from '../types/engine'
import { formatDateTime } from '../utils/format'

interface GenerateTabProps {
  promptClips: PromptClip[]
  generationJobs: GenerationJob[]
  generatedAssets: AssetVersion[]
  onSubmitGeneration: (title: string, promptText: string, provider: string) => void
  onCancelGeneration: (jobId: string) => void
  onAddToMediaPool: (assetVersionId: string) => void
  onAddToTimeline: (assetVersionId: string) => void
  onSetActiveOutput: (promptClipId: string, assetVersionId: string) => void
  onCompareOutput: (promptClipId: string, assetVersionId: string) => void
  onRollbackOutput: (promptClipId: string) => void
}

const providerOptions = ['fal.ai', 'comfyui', 'local-model-adapter']

export function GenerateTab({
  promptClips,
  generationJobs,
  generatedAssets,
  onSubmitGeneration,
  onCancelGeneration,
  onAddToMediaPool,
  onAddToTimeline,
  onSetActiveOutput,
  onCompareOutput,
  onRollbackOutput,
}: GenerateTabProps) {
  const [title, setTitle] = useState('Cinematic skyline')
  const [promptText, setPromptText] = useState(
    'Golden hour city skyline drone shot, smooth motion, cinematic contrast.',
  )
  const [provider, setProvider] = useState('comfyui')

  const assetsById = useMemo(() => {
    return new Map(generatedAssets.map((asset) => [asset.id, asset]))
  }, [generatedAssets])

  return (
    <section className="generate-tab" aria-label="Generate workspace">
      <aside className="generate-tab__left-panel">
        <h2>Prompt Builder</h2>

        <label className="field-label" htmlFor="prompt-title">
          Title
        </label>
        <input
          id="prompt-title"
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <label className="field-label" htmlFor="provider-select">
          Provider
        </label>
        <select
          id="provider-select"
          className="input"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          {providerOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <label className="field-label" htmlFor="prompt-text">
          Prompt
        </label>
        <textarea
          id="prompt-text"
          className="textarea"
          rows={6}
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
        />

        <button
          type="button"
          className="primary-button"
          onClick={() => onSubmitGeneration(title, promptText, provider)}
        >
          Submit Generation
        </button>
      </aside>

      <main className="generate-tab__center-panel">
        <h2>Output Gallery</h2>

        {promptClips.length === 0 ? <p>No prompt clips yet. Submit your first generation.</p> : null}

        <ul className="output-grid">
          {promptClips.map((promptClip) => (
            <li key={promptClip.id} className="output-card">
              <header className="output-card__header">
                <h3>{promptClip.title}</h3>
                <p>{promptClip.provider}</p>
              </header>

              <p className="output-card__prompt">{promptClip.promptText}</p>

              <ul className="output-card__versions">
                {promptClip.outputAssetVersionIds.map((assetVersionId) => {
                  const asset = assetsById.get(assetVersionId)
                  if (!asset) {
                    return null
                  }

                  const isActive = promptClip.activeAssetVersionId === assetVersionId

                  return (
                    <li key={assetVersionId}>
                      <div className="output-version-row">
                        <span>
                          {asset.label} {isActive ? '(Active)' : ''}
                        </span>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => onSetActiveOutput(promptClip.id, assetVersionId)}
                          >
                            Set Active Output
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => onCompareOutput(promptClip.id, assetVersionId)}
                          >
                            Compare
                          </button>
                        </div>
                      </div>

                      <div className="inline-actions">
                        <button
                          type="button"
                          className="outline-button"
                          onClick={() => onAddToTimeline(assetVersionId)}
                        >
                          Add to Timeline
                        </button>
                        <button
                          type="button"
                          className="outline-button"
                          onClick={() => onAddToMediaPool(assetVersionId)}
                        >
                          Add to Media Pool
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>

              <button
                type="button"
                className="link-button"
                onClick={() => onRollbackOutput(promptClip.id)}
              >
                Rollback to previous output
              </button>
            </li>
          ))}
        </ul>
      </main>

      <aside className="generate-tab__right-panel">
        <h2>Generation Queue</h2>
        <ul className="job-list">
          {generationJobs.map((job) => (
            <li key={job.id} className="job-list__item">
              <div>
                <strong>{job.provider}</strong>
                <p>Status: {job.status}</p>
                <p>{formatDateTime(job.updatedAt)}</p>
              </div>
              {(job.status === 'queued' || job.status === 'running') && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onCancelGeneration(job.id)}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
