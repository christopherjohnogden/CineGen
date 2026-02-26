import {
  getDefaultWorkspaceState,
  loadWorkspaceState,
  resetWorkspaceState,
  saveWorkspaceState,
} from '../state/workspace'
import type {
  AiRestructureProposal,
  AppSnapshot,
  AssetMediaType,
  AssetVersion,
  ClipInstance,
  EngineClient,
  EngineCommand,
  EngineCommandResult,
  EngineEvent,
  EngineEventListener,
  ExportJob,
  ExportSettings,
  GenerationJob,
  HistoryCommit,
  HistoryCompareResult,
  IngestJob,
  ProjectInfo,
  PromptClip,
  Sequence,
  Track,
  TrackKind,
  VariationBranch,
  WarningItem,
  WorkspaceState,
} from '../types/engine'

const TICKS_PER_SECOND = 240_000
const DEFAULT_CLIP_DURATION_TICK = 5 * TICKS_PER_SECOND

type TimeoutHandle = ReturnType<typeof setTimeout>

interface EngineState {
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

function nowIso(): string {
  return new Date().toISOString()
}

function createId(prefix: string): string {
  const random = Math.random().toString(16).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

function createTrackName(kind: TrackKind, index: number): string {
  return kind === 'video' ? `V${index + 1}` : `A${index + 1}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isExportFinalState(status: ExportJob['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled'
}

function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.index - b.index)
}

function createInitialState(projectId: string): EngineState {
  const sequenceId = createId('seq')

  const sequence: Sequence = {
    id: sequenceId,
    name: 'Main Sequence',
    tracks: [],
    playheadTick: 0,
    snappingEnabled: true,
    rippleEnabled: false,
    selectedClipId: null,
  }

  const initialCommitId = createId('commit')

  return {
    project: {
      projectId,
      name: 'CineGen Demo Project',
      dirty: false,
      activeSequenceId: sequenceId,
    },
    workspace: getDefaultWorkspaceState(),
    sequences: [sequence],
    assets: [],
    promptClips: [],
    generationJobs: [],
    historyCommits: [
      {
        id: initialCommitId,
        branchId: 'main',
        timestamp: nowIso(),
        summary: 'Project initialized',
        actor: 'system',
        source: 'project.open',
        eventCount: 1,
        eventTypes: ['ProjectInitialized'],
      },
    ],
    variations: [
      {
        id: 'main',
        name: 'Main',
        headCommitId: initialCommitId,
        lastModifiedAt: nowIso(),
      },
    ],
    exportJobs: [],
    ingestJobs: [
      {
        id: createId('ingest'),
        filename: 'opening-drone.mov',
        status: 'completed',
      },
    ],
    warnings: [],
    proposals: [],
  }
}

class MockEngineClient implements EngineClient {
  private readonly listeners = new Set<EngineEventListener>()

  private readonly timers = new Map<string, TimeoutHandle[]>()

  private readonly state: EngineState

  constructor(projectId: string) {
    this.state = createInitialState(projectId)
    this.state.workspace = loadWorkspaceState(projectId)
    if (!this.state.workspace.lastSelectedSequenceId) {
      this.state.workspace.lastSelectedSequenceId = this.state.project.activeSequenceId
      saveWorkspaceState(projectId, this.state.workspace)
    }
  }

  public subscribe(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public async invoke(command: EngineCommand): Promise<EngineCommandResult> {
    switch (command.name) {
      case 'project.open': {
        if (command.payload.projectId !== this.state.project.projectId) {
          return { ok: false, error: `Unknown project ${command.payload.projectId}` }
        }
        this.state.workspace = loadWorkspaceState(this.state.project.projectId)
        return { ok: true, value: this.snapshot() }
      }
      case 'project.save': {
        this.state.project.dirty = false
        return { ok: true, value: null }
      }
      case 'project.recent': {
        return { ok: true, value: [this.state.project.projectId] }
      }
      case 'project.workspace.load': {
        if (command.payload.projectId !== this.state.project.projectId) {
          return { ok: false, error: 'Mismatched project ID for workspace load' }
        }
        const loaded = loadWorkspaceState(command.payload.projectId)
        this.state.workspace = loaded
        return { ok: true, value: clone(loaded) }
      }
      case 'project.workspace.store': {
        if (command.payload.projectId !== this.state.project.projectId) {
          return { ok: false, error: 'Mismatched project ID for workspace store' }
        }
        this.state.workspace = clone(command.payload.workspace)
        saveWorkspaceState(this.state.project.projectId, this.state.workspace)
        return { ok: true, value: null }
      }
      case 'project.workspace.reset': {
        if (command.payload.projectId !== this.state.project.projectId) {
          return { ok: false, error: 'Mismatched project ID for workspace reset' }
        }
        this.state.workspace = resetWorkspaceState(this.state.project.projectId)
        return { ok: true, value: clone(this.state.workspace) }
      }
      case 'timeline.select': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        sequence.selectedClipId = command.payload.clipId
        this.emit({
          type: 'TimelineSelectionChanged',
          payload: { sequenceId: sequence.id, selectedClipId: sequence.selectedClipId },
        })
        return { ok: true, value: clone(sequence) }
      }
      case 'timeline.trim': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        const clip = this.findClip(sequence, command.payload.clipId)
        if (!clip) {
          return { ok: false, error: 'Clip not found' }
        }
        clip.durationTick = Math.max(TICKS_PER_SECOND, command.payload.durationTick)
        this.commit(sequence.id, 'Clip trimmed', 'timeline.trim', ['ClipTrimmed'])
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: clone(sequence) }
      }
      case 'timeline.cut': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        const track = sequence.tracks.find((item) => item.id === command.payload.trackId)
        if (!track) {
          return { ok: false, error: 'Track not found' }
        }

        const target = track.clips.find(
          (clip) =>
            command.payload.atTick > clip.startTick &&
            command.payload.atTick < clip.startTick + clip.durationTick,
        )

        if (!target) {
          return { ok: false, error: 'No clip intersects the cut point' }
        }

        const firstDuration = command.payload.atTick - target.startTick
        const secondDuration = target.durationTick - firstDuration
        target.durationTick = firstDuration
        const newClip: ClipInstance = {
          ...clone(target),
          id: createId('clip'),
          startTick: command.payload.atTick,
          durationTick: secondDuration,
          label: `${target.label} (part 2)`,
        }
        track.clips.push(newClip)
        track.clips = [...track.clips].sort((a, b) => a.startTick - b.startTick)
        this.commit(sequence.id, 'Clip cut', 'timeline.cut', ['ClipCut'])
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: clone(sequence) }
      }
      case 'timeline.ripple': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        for (const track of sequence.tracks) {
          for (const clip of track.clips) {
            if (clip.startTick >= command.payload.fromTick) {
              clip.startTick += command.payload.deltaTick
            }
          }
        }
        this.commit(sequence.id, 'Ripple shift applied', 'timeline.ripple', ['RippleShift'])
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: clone(sequence) }
      }
      case 'timeline.move': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        const clip = this.findClip(sequence, command.payload.clipId)
        if (!clip) {
          return { ok: false, error: 'Clip not found' }
        }
        clip.startTick = Math.max(0, command.payload.startTick)
        for (const track of sequence.tracks) {
          track.clips = [...track.clips].sort((a, b) => a.startTick - b.startTick)
        }
        this.commit(sequence.id, 'Clip moved', 'timeline.move', ['ClipMoved'])
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: clone(sequence) }
      }
      case 'timeline.insert_asset': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        const asset = this.state.assets.find(
          (item) => item.id === command.payload.assetVersionId,
        )
        if (!asset) {
          return { ok: false, error: 'Asset version not found' }
        }

        const targetTrack = this.resolveTargetTrack(
          sequence,
          asset.mediaType,
          command.payload.preferredTrackId,
        )

        if (!targetTrack) {
          return { ok: false, error: 'Unable to resolve target track' }
        }

        const assetWithMeta = asset as AssetVersion & { clipDurationTick?: number; pairedAudioId?: string }
        const durationTick = assetWithMeta.clipDurationTick ?? DEFAULT_CLIP_DURATION_TICK
        const startTick = Math.max(0, command.payload.insertAtTick)

        const clip: ClipInstance = {
          id: createId('clip'),
          label: asset.label,
          assetVersionId: asset.id,
          startTick,
          durationTick,
        }

        targetTrack.clips.push(clip)
        targetTrack.clips = [...targetTrack.clips].sort((a, b) => a.startTick - b.startTick)
        sequence.selectedClipId = clip.id
        sequence.playheadTick = clip.startTick

        // Auto-insert paired audio clip when dragging a video that has audio
        if (assetWithMeta.pairedAudioId) {
          const audioAsset = this.state.assets.find((a) => a.id === assetWithMeta.pairedAudioId)
          if (audioAsset) {
            const audioTrack = this.resolveTargetTrack(sequence, 'audio', undefined)
            if (audioTrack) {
              const audioClip: ClipInstance = {
                id: createId('clip'),
                label: audioAsset.label,
                assetVersionId: audioAsset.id,
                startTick,
                durationTick,
              }
              audioTrack.clips.push(audioClip)
              audioTrack.clips = [...audioTrack.clips].sort((a, b) => a.startTick - b.startTick)
            }
          }
        }

        this.commit(sequence.id, `Inserted ${asset.label}`, 'timeline.insert_asset', [
          'ClipAdded',
        ])
        this.emit({
          type: 'TimelineSelectionChanged',
          payload: { sequenceId: sequence.id, selectedClipId: sequence.selectedClipId },
        })
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: clone(sequence) }
      }
      case 'timeline.toggle_snap': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        sequence.snappingEnabled = command.payload.enabled
        return { ok: true, value: clone(sequence) }
      }
      case 'timeline.toggle_ripple': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        sequence.rippleEnabled = command.payload.enabled
        return { ok: true, value: clone(sequence) }
      }
      case 'history.list_commits': {
        return { ok: true, value: clone(this.state.historyCommits) }
      }
      case 'history.restore': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        this.commit(
          sequence.id,
          `Restored from commit ${command.payload.commitId}`,
          'history.restore',
          ['RestoreApplied'],
        )
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: null }
      }
      case 'history.compare': {
        const result: HistoryCompareResult = {
          leftCommitId: command.payload.leftCommitId,
          rightCommitId: command.payload.rightCommitId,
          summary: 'Metadata diff preview',
          added: 2,
          removed: 1,
          changed: 4,
        }
        return { ok: true, value: result }
      }
      case 'history.create_variation': {
        const branch: VariationBranch = {
          id: createId('branch'),
          name: command.payload.name,
          headCommitId: command.payload.fromCommitId,
          lastModifiedAt: nowIso(),
        }
        this.state.variations.push(branch)
        this.emit({
          type: 'VariationUpdated',
          payload: { sequenceId: command.payload.sequenceId },
        })
        return { ok: true, value: clone(this.state.variations) }
      }
      case 'history.merge': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }
        this.commit(
          sequence.id,
          `Merged variation using ${command.payload.operation}`,
          'history.merge',
          ['MergeOperation'],
        )
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: null }
      }
      case 'ai.validate_config': {
        const apiKey = command.payload.config.apiKey
        if (!apiKey || apiKey.trim().length < 8) {
          return {
            ok: true,
            value: { valid: false, message: 'API key is missing or too short.' },
          }
        }
        return { ok: true, value: { valid: true } }
      }
      case 'ai.submit_generation': {
        const promptClip: PromptClip = {
          id: createId('prompt'),
          title: command.payload.title,
          promptText: command.payload.promptText,
          provider: command.payload.provider,
          outputAssetVersionIds: [],
          activeAssetVersionId: null,
        }
        this.state.promptClips.unshift(promptClip)

        const job: GenerationJob = {
          id: createId('gen'),
          promptClipId: promptClip.id,
          provider: command.payload.provider,
          status: 'queued',
          submittedAt: nowIso(),
          updatedAt: nowIso(),
          outputAssetVersionIds: [],
        }

        this.state.generationJobs.unshift(job)
        this.emit({ type: 'AiJobUpdated', payload: { jobId: job.id, status: job.status } })

        const queuedTimer = setTimeout(() => {
          const currentJob = this.state.generationJobs.find((item) => item.id === job.id)
          if (!currentJob || currentJob.status !== 'queued') {
            return
          }
          currentJob.status = 'running'
          currentJob.updatedAt = nowIso()
          this.emit({
            type: 'AiJobUpdated',
            payload: { jobId: currentJob.id, status: currentJob.status },
          })
        }, 600)

        const completedTimer = setTimeout(() => {
          const currentJob = this.state.generationJobs.find((item) => item.id === job.id)
          if (!currentJob || (currentJob.status !== 'queued' && currentJob.status !== 'running')) {
            return
          }

          const outputAsset: AssetVersion = {
            id: createId('assetv'),
            assetId: createId('asset'),
            label: `${promptClip.title} v1`,
            mediaType: 'video',
            sourceType: 'generated',
            path: `/projects/${this.state.project.projectId}/generated/${currentJob.id}.mov`,
            promptClipId: promptClip.id,
            createdAt: nowIso(),
          }

          this.state.assets.unshift(outputAsset)
          currentJob.status = 'succeeded'
          currentJob.updatedAt = nowIso()
          currentJob.outputAssetVersionIds = [outputAsset.id]

          const livePrompt = this.state.promptClips.find((item) => item.id === promptClip.id)
          if (livePrompt) {
            livePrompt.outputAssetVersionIds.unshift(outputAsset.id)
            livePrompt.activeAssetVersionId = outputAsset.id
          }

          this.commit(
            this.state.project.activeSequenceId,
            `AI generation completed: ${promptClip.title}`,
            'ai.submit_generation',
            ['PromptClipOutputSelected'],
          )
          this.emit({
            type: 'AiJobUpdated',
            payload: { jobId: currentJob.id, status: currentJob.status },
          })
          this.emit({
            type: 'HistoryUpdated',
            payload: { sequenceId: this.state.project.activeSequenceId },
          })
        }, 2000)

        this.timers.set(job.id, [queuedTimer, completedTimer])

        return { ok: true, value: { generationJobId: job.id } }
      }
      case 'ai.poll_job': {
        const job = this.state.generationJobs.find((item) => item.id === command.payload.jobId)
        if (!job) {
          return { ok: false, error: 'Generation job not found' }
        }
        return { ok: true, value: clone(this.state.generationJobs) }
      }
      case 'ai.cancel_job': {
        const job = this.state.generationJobs.find((item) => item.id === command.payload.jobId)
        if (!job) {
          return { ok: false, error: 'Generation job not found' }
        }
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
          return { ok: true, value: null }
        }
        job.status = 'canceled'
        job.updatedAt = nowIso()
        this.clearTimers(job.id)
        this.emit({ type: 'AiJobUpdated', payload: { jobId: job.id, status: 'canceled' } })
        return { ok: true, value: null }
      }
      case 'ai.list_outputs': {
        return { ok: true, value: clone(this.state.promptClips) }
      }
      case 'ai.set_active_output': {
        const prompt = this.state.promptClips.find(
          (item) => item.id === command.payload.promptClipId,
        )
        if (!prompt) {
          return { ok: false, error: 'Prompt clip not found' }
        }
        if (!prompt.outputAssetVersionIds.includes(command.payload.assetVersionId)) {
          return { ok: false, error: 'Asset is not output of this prompt clip' }
        }
        prompt.activeAssetVersionId = command.payload.assetVersionId
        this.commit(
          this.state.project.activeSequenceId,
          'Prompt output activated',
          'ai.set_active_output',
          ['PromptClipOutputSelected'],
        )
        this.emit({
          type: 'HistoryUpdated',
          payload: { sequenceId: this.state.project.activeSequenceId },
        })
        return { ok: true, value: clone(this.state.promptClips) }
      }
      case 'ai.create_restructure_proposal': {
        const proposal: AiRestructureProposal = {
          id: createId('proposal'),
          sequenceId: command.payload.sequenceId,
          summary: command.payload.instruction,
          impacts: [
            { kind: 'track', label: 'Video track alignment' },
            { kind: 'range', label: '00:00:05 to 00:00:20 tightened' },
            { kind: 'clip', label: 'Three clip trims' },
          ],
          operations: ['RippleShift +3s', 'ClipTrimmed x3', 'ClipMoved x2'],
          createdAt: nowIso(),
        }
        this.state.proposals.unshift(proposal)
        this.emit({
          type: 'ProposalReady',
          payload: { sequenceId: proposal.sequenceId, proposalId: proposal.id },
        })
        return { ok: true, value: clone(proposal) }
      }
      case 'ai.apply_proposal': {
        const sequence = this.findSequence(command.payload.sequenceId)
        if (!sequence) {
          return { ok: false, error: 'Sequence not found' }
        }

        const proposal = this.state.proposals.find(
          (item) => item.id === command.payload.proposalId,
        )
        if (!proposal) {
          return { ok: false, error: 'Proposal not found' }
        }

        for (const track of sequence.tracks) {
          track.clips = track.clips.map((clip, index) => {
            if (index % 2 === 0) {
              return {
                ...clip,
                startTick: Math.max(0, clip.startTick - TICKS_PER_SECOND / 2),
              }
            }
            return clip
          })
        }

        this.state.proposals = this.state.proposals.filter(
          (item) => item.id !== command.payload.proposalId,
        )

        this.commit(sequence.id, `Applied proposal: ${proposal.summary}`, 'ai.apply_proposal', [
          'ProposalApplied',
        ])
        this.emit({ type: 'HistoryUpdated', payload: { sequenceId: sequence.id } })
        return { ok: true, value: { accepted: true } }
      }
      case 'media.list_assets': {
        return { ok: true, value: clone(this.state.assets) }
      }
      case 'media.import': {
        const durationSecs = command.payload.durationSecs ?? 0
        const durationTick = durationSecs > 0
          ? Math.round(durationSecs * TICKS_PER_SECOND)
          : DEFAULT_CLIP_DURATION_TICK

        const imported: AssetVersion = {
          id: createId('assetv'),
          assetId: createId('asset'),
          label: command.payload.label,
          mediaType: command.payload.mediaType,
          sourceType: command.payload.sourceType,
          path: command.payload.path,
          url: command.payload.url,
          durationSecs,
          hasAudio: command.payload.hasAudio,
          thumbnailDataUrl: command.payload.thumbnailDataUrl,
          createdAt: nowIso(),
        }
        this.state.assets.unshift(imported)

        // If a video has audio, also create a paired audio asset version
        if (command.payload.mediaType === 'video' && command.payload.hasAudio) {
          const audioAsset: AssetVersion = {
            id: createId('assetv'),
            assetId: imported.assetId, // same parent asset
            label: command.payload.label,
            mediaType: 'audio',
            sourceType: command.payload.sourceType,
            path: command.payload.path,
            url: command.payload.url,
            durationSecs,
            createdAt: nowIso(),
          }
          this.state.assets.unshift(audioAsset)
          // Store a reference so insert_asset can link them
          ;(imported as AssetVersion & { pairedAudioId?: string }).pairedAudioId = audioAsset.id
        }

        // Use real duration for clips inserted from this asset
        ;(imported as AssetVersion & { clipDurationTick?: number }).clipDurationTick = durationTick

        const ingest: IngestJob = {
          id: createId('ingest'),
          filename: imported.label,
          status: 'running',
        }
        this.state.ingestJobs.unshift(ingest)
        this.emit({
          type: 'IngestJobUpdated',
          payload: { ingestJobId: ingest.id, status: ingest.status },
        })

        const doneTimer = setTimeout(() => {
          const current = this.state.ingestJobs.find((item) => item.id === ingest.id)
          if (!current) {
            return
          }
          current.status = 'completed'
          this.emit({
            type: 'IngestJobUpdated',
            payload: { ingestJobId: current.id, status: current.status },
          })
        }, 900)

        this.timers.set(ingest.id, [doneTimer])
        return { ok: true, value: clone(this.state.assets) }
      }
      case 'media.relink': {
        const asset = this.state.assets.find((item) => item.id === command.payload.assetVersionId)
        if (!asset) {
          return { ok: false, error: 'Asset version not found' }
        }
        asset.path = command.payload.newPath
        return { ok: true, value: clone(this.state.assets) }
      }
      case 'media.semantic_query': {
        const query = command.payload.query.trim().toLowerCase()
        if (!query) {
          return { ok: true, value: clone(this.state.assets) }
        }
        const matches = this.state.assets.filter((asset) =>
          asset.label.toLowerCase().includes(query),
        )
        return { ok: true, value: clone(matches) }
      }
      case 'export.create_job': {
        const job = this.makeExportJob(command.payload.sequenceId, command.payload.settings)
        this.state.exportJobs.unshift(job)
        return { ok: true, value: { exportJobId: job.id } }
      }
      case 'export.enqueue': {
        const job = this.state.exportJobs.find((item) => item.id === command.payload.exportJobId)
        if (!job) {
          return { ok: false, error: 'Export job not found' }
        }
        if (isExportFinalState(job.status)) {
          job.status = 'pending'
          job.progress = 0
          job.updatedAt = nowIso()
        }
        this.runExportQueue()
        return { ok: true, value: clone(this.state.exportJobs) }
      }
      case 'export.cancel': {
        const job = this.state.exportJobs.find((item) => item.id === command.payload.exportJobId)
        if (!job) {
          return { ok: false, error: 'Export job not found' }
        }

        if (job.status === 'pending' || job.status === 'running') {
          this.clearTimers(job.id)
          job.status = 'canceled'
          job.updatedAt = nowIso()
          this.emit({
            type: 'ExportJobUpdated',
            payload: { exportJobId: job.id, status: job.status },
          })
          this.runExportQueue()
        }

        return { ok: true, value: clone(this.state.exportJobs) }
      }
      case 'export.retry': {
        const job = this.state.exportJobs.find((item) => item.id === command.payload.exportJobId)
        if (!job) {
          return { ok: false, error: 'Export job not found' }
        }

        if (job.status === 'failed' || job.status === 'canceled') {
          job.status = 'pending'
          job.progress = 0
          job.updatedAt = nowIso()
          this.runExportQueue()
        }

        return { ok: true, value: clone(this.state.exportJobs) }
      }
      case 'export.list_queue': {
        return { ok: true, value: clone(this.state.exportJobs) }
      }
      default: {
        return { ok: false, error: `Unhandled command ${(command as EngineCommand).name}` }
      }
    }
  }

  private clearTimers(key: string): void {
    const timerList = this.timers.get(key)
    if (!timerList) {
      return
    }
    for (const timer of timerList) {
      clearTimeout(timer)
    }
    this.timers.delete(key)
  }

  private runExportQueue(): void {
    const running = this.state.exportJobs.find((job) => job.status === 'running')
    if (running) {
      return
    }

    const next = this.state.exportJobs
      .slice()
      .reverse()
      .find((job) => job.status === 'pending')

    if (!next) {
      return
    }

    next.status = 'running'
    next.progress = 0
    next.updatedAt = nowIso()
    this.emit({
      type: 'ExportJobUpdated',
      payload: { exportJobId: next.id, status: next.status },
    })

    const progressTimer = setTimeout(() => {
      const runningJob = this.state.exportJobs.find((job) => job.id === next.id)
      if (!runningJob || runningJob.status !== 'running') {
        return
      }
      runningJob.progress = 55
      runningJob.updatedAt = nowIso()
      this.emit({
        type: 'ExportJobUpdated',
        payload: { exportJobId: runningJob.id, status: runningJob.status },
      })
    }, 700)

    const completeTimer = setTimeout(() => {
      const runningJob = this.state.exportJobs.find((job) => job.id === next.id)
      if (!runningJob || runningJob.status !== 'running') {
        return
      }

      const shouldFail = runningJob.settings.destinationName
        .toLowerCase()
        .includes('fail')

      if (shouldFail) {
        runningJob.status = 'failed'
        runningJob.errorMessage = 'Encoder rejected destination profile.'
        runningJob.progress = 0
      } else {
        runningJob.status = 'completed'
        runningJob.progress = 100
        runningJob.outputPath = `/projects/${this.state.project.projectId}/exports/${runningJob.settings.destinationName}`
        this.commit(
          runningJob.sequenceId,
          `Export completed: ${runningJob.settings.destinationName}`,
          'export.enqueue',
          ['ExportCompleted', 'SnapshotCreated'],
        )
      }

      runningJob.updatedAt = nowIso()
      this.emit({
        type: 'ExportJobUpdated',
        payload: { exportJobId: runningJob.id, status: runningJob.status },
      })
      this.emit({
        type: 'HistoryUpdated',
        payload: { sequenceId: runningJob.sequenceId },
      })
      this.clearTimers(next.id)
      this.runExportQueue()
    }, 1800)

    this.timers.set(next.id, [progressTimer, completeTimer])
  }

  private makeExportJob(sequenceId: string, settings: ExportSettings): ExportJob {
    return {
      id: createId('export'),
      sequenceId,
      settings,
      status: 'pending',
      progress: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
  }

  private resolveTargetTrack(
    sequence: Sequence,
    mediaType: AssetMediaType,
    preferredTrackId?: string,
  ): Track | null {
    const kind: TrackKind = mediaType === 'video' ? 'video' : 'audio'

    if (preferredTrackId) {
      const preferred = sequence.tracks.find((track) => track.id === preferredTrackId)
      if (preferred && preferred.kind === kind) {
        return preferred
      }
    }

    const compatible = sortTracks(sequence.tracks).find((track) => track.kind === kind)
    if (compatible) {
      return compatible
    }

    const index = sequence.tracks.length
    const newTrack: Track = {
      id: createId('track'),
      name: createTrackName(kind, index),
      kind,
      index,
      clips: [],
    }
    sequence.tracks.push(newTrack)
    sequence.tracks = sortTracks(sequence.tracks)
    return newTrack
  }

  private commit(
    sequenceId: string,
    summary: string,
    source: string,
    eventTypes: string[],
  ): void {
    const branch =
      this.state.variations.find((item) => item.name === 'Main') ?? this.state.variations[0]

    const commit: HistoryCommit = {
      id: createId('commit'),
      branchId: branch.id,
      timestamp: nowIso(),
      summary,
      actor: 'user',
      source,
      eventCount: eventTypes.length,
      eventTypes,
    }

    this.state.historyCommits.unshift(commit)
    if (branch) {
      branch.headCommitId = commit.id
      branch.lastModifiedAt = commit.timestamp
    }

    this.state.project.activeSequenceId = sequenceId
    this.state.project.dirty = true
  }

  private findSequence(sequenceId: string): Sequence | null {
    return this.state.sequences.find((sequence) => sequence.id === sequenceId) ?? null
  }

  private findClip(sequence: Sequence, clipId: string): ClipInstance | null {
    for (const track of sequence.tracks) {
      const clip = track.clips.find((item) => item.id === clipId)
      if (clip) {
        return clip
      }
    }
    return null
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private snapshot(): AppSnapshot {
    return {
      project: clone(this.state.project),
      workspace: clone(this.state.workspace),
      sequences: clone(this.state.sequences),
      assets: clone(this.state.assets),
      promptClips: clone(this.state.promptClips),
      generationJobs: clone(this.state.generationJobs),
      historyCommits: clone(this.state.historyCommits),
      variations: clone(this.state.variations),
      exportJobs: clone(this.state.exportJobs),
      ingestJobs: clone(this.state.ingestJobs),
      warnings: clone(this.state.warnings),
      proposals: clone(this.state.proposals),
    }
  }
}

export function createEngineClient(projectId: string): EngineClient {
  return new MockEngineClient(projectId)
}

export { TICKS_PER_SECOND }
