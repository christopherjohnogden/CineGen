export type TopLevelTab = 'generate' | 'edit' | 'export'

export type LeftRailTab = 'media' | 'search' | 'effects'
export type RightRailTab = 'inspector' | 'history' | 'variations'

export type ThemeMode = 'dark' | 'light'

export interface WorkspaceState {
  activeTab: TopLevelTab
  leftRailVisible: boolean
  rightRailVisible: boolean
  leftRailCollapsed: boolean
  rightRailCompact: boolean
  leftRailWidth: number
  rightRailWidth: number
  timelineHeight: number
  activeLeftRailTab: LeftRailTab
  activeRightRailTab: RightRailTab
  viewerZoom: number
  timelineZoom: number
  lastSelectedSequenceId: string | null
}

export interface ProjectInfo {
  projectId: string
  name: string
  dirty: boolean
  activeSequenceId: string
}

export type TrackKind = 'video' | 'audio'

export interface ClipInstance {
  id: string
  label: string
  assetVersionId: string
  startTick: number
  durationTick: number
  /** Clip-local in/out points in seconds (0 = start of source asset) */
  inPointSecs?: number
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  index: number
  clips: ClipInstance[]
}

export interface Sequence {
  id: string
  name: string
  tracks: Track[]
  playheadTick: number
  snappingEnabled: boolean
  rippleEnabled: boolean
  selectedClipId: string | null
}

export type AssetMediaType = 'video' | 'audio'
export type AssetSourceType = 'imported' | 'generated'

export interface AssetVersion {
  id: string
  assetId: string
  label: string
  mediaType: AssetMediaType
  sourceType: AssetSourceType
  path: string
  /** tauri://localhost URL for direct playback in <video>/<audio> elements */
  url?: string
  /** Duration in seconds, probed at import time */
  durationSecs?: number
  /** Whether the video file has an audio stream */
  hasAudio?: boolean
  /** Base64 thumbnail extracted from first frame */
  thumbnailDataUrl?: string
  promptClipId?: string
  createdAt: string
}

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface PromptClip {
  id: string
  title: string
  promptText: string
  provider: string
  outputAssetVersionIds: string[]
  activeAssetVersionId: string | null
}

export interface GenerationJob {
  id: string
  promptClipId: string
  provider: string
  status: GenerationStatus
  submittedAt: string
  updatedAt: string
  outputAssetVersionIds: string[]
  errorMessage?: string
}

export interface HistoryCommit {
  id: string
  branchId: string
  timestamp: string
  summary: string
  actor: string
  source: string
  eventCount: number
  eventTypes: string[]
}

export interface VariationBranch {
  id: string
  name: string
  headCommitId: string
  lastModifiedAt: string
}

export type MergeOperation =
  | 'replace_sequence'
  | 'insert_time_range'
  | 'import_tracks'
  | 'import_clips'

export interface ProposalImpact {
  kind: 'clip' | 'track' | 'range'
  label: string
}

export interface AiRestructureProposal {
  id: string
  sequenceId: string
  summary: string
  impacts: ProposalImpact[]
  operations: string[]
  createdAt: string
}

export type ExportPresetId = 'h264_mp4' | 'h265_mp4' | 'prores_mov'

export interface ExportSettings {
  preset: ExportPresetId
  codecProfile: string
  bitrateMbps: number
  resolution: '1920x1080' | '2560x1440' | '3840x2160'
  fps: 24 | 30 | 60
  audioKbps: 192 | 256 | 320
  destinationName: string
}

export type ExportJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled'

export interface ExportJob {
  id: string
  sequenceId: string
  settings: ExportSettings
  status: ExportJobStatus
  progress: number
  createdAt: string
  updatedAt: string
  outputPath?: string
  errorMessage?: string
}

export interface IngestJob {
  id: string
  filename: string
  status: 'queued' | 'running' | 'completed' | 'failed'
}

export interface WarningItem {
  id: string
  message: string
  level: 'warning' | 'error'
}

export interface AppSnapshot {
  project: ProjectInfo
  workspace: WorkspaceState
  sequences: Sequence[]
  assets: AssetVersion[]
  promptClips: PromptClip[]
  generationJobs: GenerationJob[]
  historyCommits: HistoryCommit[]
  variations: VariationBranch[]
  exportJobs: ExportJob[]
  ingestJobs: IngestJob[]
  warnings: WarningItem[]
  proposals: AiRestructureProposal[]
}

export type CommandName =
  | 'project.open'
  | 'project.save'
  | 'project.recent'
  | 'project.workspace.load'
  | 'project.workspace.store'
  | 'project.workspace.reset'
  | 'timeline.select'
  | 'timeline.trim'
  | 'timeline.cut'
  | 'timeline.ripple'
  | 'timeline.move'
  | 'timeline.insert_asset'
  | 'timeline.toggle_snap'
  | 'timeline.toggle_ripple'
  | 'history.list_commits'
  | 'history.restore'
  | 'history.compare'
  | 'history.create_variation'
  | 'history.merge'
  | 'ai.validate_config'
  | 'ai.submit_generation'
  | 'ai.poll_job'
  | 'ai.cancel_job'
  | 'ai.list_outputs'
  | 'ai.set_active_output'
  | 'ai.create_restructure_proposal'
  | 'ai.apply_proposal'
  | 'media.list_assets'
  | 'media.import'
  | 'media.relink'
  | 'media.semantic_query'
  | 'export.create_job'
  | 'export.enqueue'
  | 'export.cancel'
  | 'export.retry'
  | 'export.list_queue'

export type EngineCommand =
  | { name: 'project.open'; payload: { projectId: string } }
  | { name: 'project.save'; payload: { projectId: string } }
  | { name: 'project.recent'; payload: Record<string, never> }
  | { name: 'project.workspace.load'; payload: { projectId: string } }
  | {
      name: 'project.workspace.store'
      payload: { projectId: string; workspace: WorkspaceState }
    }
  | { name: 'project.workspace.reset'; payload: { projectId: string } }
  | {
      name: 'timeline.select'
      payload: { sequenceId: string; clipId: string | null }
    }
  | {
      name: 'timeline.trim'
      payload: { sequenceId: string; clipId: string; durationTick: number }
    }
  | {
      name: 'timeline.cut'
      payload: { sequenceId: string; trackId: string; atTick: number }
    }
  | {
      name: 'timeline.ripple'
      payload: { sequenceId: string; fromTick: number; deltaTick: number }
    }
  | {
      name: 'timeline.move'
      payload: { sequenceId: string; clipId: string; startTick: number }
    }
  | {
      name: 'timeline.insert_asset'
      payload: {
        sequenceId: string
        assetVersionId: string
        insertAtTick: number
        preferredTrackId?: string
      }
    }
  | {
      name: 'timeline.toggle_snap'
      payload: { sequenceId: string; enabled: boolean }
    }
  | {
      name: 'timeline.toggle_ripple'
      payload: { sequenceId: string; enabled: boolean }
    }
  | {
      name: 'history.list_commits'
      payload: { sequenceId: string }
    }
  | {
      name: 'history.restore'
      payload: { sequenceId: string; commitId: string }
    }
  | {
      name: 'history.compare'
      payload: { sequenceId: string; leftCommitId: string; rightCommitId: string }
    }
  | {
      name: 'history.create_variation'
      payload: { sequenceId: string; fromCommitId: string; name: string }
    }
  | {
      name: 'history.merge'
      payload: {
        sequenceId: string
        sourceBranchId: string
        operation: MergeOperation
      }
    }
  | {
      name: 'ai.validate_config'
      payload: { provider: string; config: Record<string, string> }
    }
  | {
      name: 'ai.submit_generation'
      payload: {
        promptText: string
        provider: string
        title: string
      }
    }
  | { name: 'ai.poll_job'; payload: { jobId: string } }
  | { name: 'ai.cancel_job'; payload: { jobId: string } }
  | { name: 'ai.list_outputs'; payload: Record<string, never> }
  | {
      name: 'ai.set_active_output'
      payload: { promptClipId: string; assetVersionId: string }
    }
  | {
      name: 'ai.create_restructure_proposal'
      payload: { sequenceId: string; instruction: string }
    }
  | {
      name: 'ai.apply_proposal'
      payload: { sequenceId: string; proposalId: string }
    }
  | { name: 'media.list_assets'; payload: Record<string, never> }
  | {
      name: 'media.import'
      payload: {
        label: string
        mediaType: AssetMediaType
        path: string
        sourceType: AssetSourceType
        url?: string
        durationSecs?: number
        hasAudio?: boolean
        thumbnailDataUrl?: string
      }
    }
  | {
      name: 'media.relink'
      payload: { assetVersionId: string; newPath: string }
    }
  | {
      name: 'media.semantic_query'
      payload: { query: string }
    }
  | {
      name: 'export.create_job'
      payload: { sequenceId: string; settings: ExportSettings }
    }
  | { name: 'export.enqueue'; payload: { exportJobId: string } }
  | { name: 'export.cancel'; payload: { exportJobId: string } }
  | { name: 'export.retry'; payload: { exportJobId: string } }
  | { name: 'export.list_queue'; payload: Record<string, never> }

export type EngineCommandResult =
  | { ok: true; value: AppSnapshot }
  | { ok: true; value: WorkspaceState }
  | { ok: true; value: string[] }
  | { ok: true; value: Sequence }
  | { ok: true; value: Sequence[] }
  | { ok: true; value: AssetVersion[] }
  | { ok: true; value: PromptClip[] }
  | { ok: true; value: GenerationJob[] }
  | { ok: true; value: ExportJob[] }
  | { ok: true; value: VariationBranch[] }
  | { ok: true; value: HistoryCommit[] }
  | { ok: true; value: HistoryCompareResult }
  | { ok: true; value: AiRestructureProposal }
  | { ok: true; value: { accepted: boolean } }
  | { ok: true; value: { valid: boolean; message?: string } }
  | { ok: true; value: { exportJobId: string } }
  | { ok: true; value: { generationJobId: string } }
  | { ok: true; value: null }
  | { ok: false; error: string }

export interface HistoryCompareResult {
  leftCommitId: string
  rightCommitId: string
  summary: string
  added: number
  removed: number
  changed: number
}

export type EngineEvent =
  | { type: 'PlaybackStateChanged'; payload: { sequenceId: string; playing: boolean } }
  | {
      type: 'TimelineSelectionChanged'
      payload: { sequenceId: string; selectedClipId: string | null }
    }
  | { type: 'HistoryUpdated'; payload: { sequenceId: string } }
  | { type: 'VariationUpdated'; payload: { sequenceId: string } }
  | { type: 'AiJobUpdated'; payload: { jobId: string; status: GenerationStatus } }
  | { type: 'IngestJobUpdated'; payload: { ingestJobId: string; status: IngestJob['status'] } }
  | { type: 'ExportJobUpdated'; payload: { exportJobId: string; status: ExportJobStatus } }
  | {
      type: 'ProposalReady'
      payload: { sequenceId: string; proposalId: string }
    }

export type EngineEventListener = (event: EngineEvent) => void

export interface EngineClient {
  invoke(command: EngineCommand): Promise<EngineCommandResult>
  subscribe(listener: EngineEventListener): () => void
}
