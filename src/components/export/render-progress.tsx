

import type { ExportJob } from '@/types/export';

interface RenderProgressProps {
  job: ExportJob;
  onCancel?: () => void;
}

export function RenderProgress({ job, onCancel }: RenderProgressProps) {
  return (
    <div className="render-progress">
      <div className="render-progress__header">
        <span className="render-progress__status">
          {job.status === 'queued' && 'Queued...'}
          {job.status === 'rendering' && 'Rendering...'}
          {job.status === 'complete' && 'Complete'}
          {job.status === 'failed' && 'Failed'}
        </span>
        {job.status === 'complete' && job.fileSize && (
          <span className="render-progress__size">
            {(job.fileSize / (1024 * 1024)).toFixed(1)} MB
          </span>
        )}
      </div>

      <div className="render-progress__bar-track">
        <div
          className={`render-progress__bar-fill${job.status === 'failed' ? ' render-progress__bar-fill--error' : ''}`}
          style={{ width: `${job.progress}%` }}
        />
      </div>

      <div className="render-progress__footer">
        <span className="render-progress__percent">{Math.round(job.progress)}%</span>

        {(job.status === 'queued' || job.status === 'rendering') && onCancel && (
          <button className="render-progress__cancel-btn" onClick={onCancel}>
            Cancel
          </button>
        )}

        {job.status === 'complete' && job.outputUrl && (
          <button
            className="render-progress__download-btn"
            onClick={() => window.electronAPI.shell.openPath(job.outputUrl!)}
          >
            Open Export
          </button>
        )}

        {job.status === 'failed' && job.error && (
          <span className="render-progress__error">{job.error}</span>
        )}
      </div>
    </div>
  );
}
