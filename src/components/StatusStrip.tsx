import type { ExportJob, GenerationJob, IngestJob, WarningItem } from '../types/engine'

interface StatusStripProps {
  ingestJobs: IngestJob[]
  generationJobs: GenerationJob[]
  exportJobs: ExportJob[]
  warnings: WarningItem[]
}

function countActiveIngest(jobs: IngestJob[]): number {
  return jobs.filter((job) => job.status === 'queued' || job.status === 'running').length
}

function countActiveGeneration(jobs: GenerationJob[]): number {
  return jobs.filter((job) => job.status === 'queued' || job.status === 'running').length
}

function countActiveExports(jobs: ExportJob[]): number {
  return jobs.filter((job) => job.status === 'pending' || job.status === 'running').length
}

export function StatusStrip({ ingestJobs, generationJobs, exportJobs, warnings }: StatusStripProps) {
  const warningCount = warnings.filter((item) => item.level === 'warning').length
  const errorCount = warnings.filter((item) => item.level === 'error').length

  return (
    <footer className="status-strip" aria-label="System status strip">
      <span>Ingest: {countActiveIngest(ingestJobs)} active</span>
      <span>AI jobs: {countActiveGeneration(generationJobs)} active</span>
      <span>Export queue: {countActiveExports(exportJobs)} active</span>
      <span>Warnings: {warningCount}</span>
      <span>Errors: {errorCount}</span>
    </footer>
  )
}
