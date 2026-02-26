import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StatusStrip } from './components/StatusStrip'
import { ToastRegion, type ToastItem } from './components/ToastRegion'
import { TopBar } from './components/TopBar'
import { createEngineClient } from './engine'
import { loadThemeMode, saveThemeMode } from './state/workspace'
import { EditTab } from './tabs/EditTab'
import { ExportTab } from './tabs/ExportTab'
import { GenerateTab } from './tabs/GenerateTab'
import type {
  AppSnapshot,
  AssetMediaType,
  AssetVersion,
  EngineCommand,
  ExportJobStatus,
  ExportSettings,
  HistoryCompareResult,
  MergeOperation,
  ThemeMode,
  TopLevelTab,
  WorkspaceState,
} from './types/engine'
import './App.css'

const PROJECT_ID = 'cinegen-demo'

/**
 * Session-scoped objectURL store: maps file path → blob URL.
 * Kept alive for the duration of the app session so <video> elements can play them.
 */
const sessionObjectUrls = new Map<string, string>()

function makeToastId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
}

function findSequence(snapshot: AppSnapshot): AppSnapshot['sequences'][number] | null {
  const preferred =
    snapshot.workspace.lastSelectedSequenceId ?? snapshot.project.activeSequenceId
  return (
    snapshot.sequences.find((sequence) => sequence.id === preferred) ??
    snapshot.sequences.find((sequence) => sequence.id === snapshot.project.activeSequenceId) ??
    null
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAppSnapshot(value: unknown): value is AppSnapshot {
  return isObject(value) && 'project' in value && 'workspace' in value
}

function isAssetVersionArray(value: unknown): value is AssetVersion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isObject(item) &&
        typeof item.id === 'string' &&
        typeof item.assetId === 'string' &&
        typeof item.label === 'string',
    )
  )
}

function isHistoryCompareResult(value: unknown): value is HistoryCompareResult {
  return (
    isObject(value) &&
    typeof value.leftCommitId === 'string' &&
    typeof value.rightCommitId === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.added === 'number' &&
    typeof value.removed === 'number' &&
    typeof value.changed === 'number'
  )
}

function hasExportJobId(value: unknown): value is { exportJobId: string } {
  return (
    isObject(value) &&
    'exportJobId' in value &&
    typeof value.exportJobId === 'string'
  )
}

function inferMediaTypeFromFile(file: File): AssetMediaType | null {
  if (file.type.startsWith('video/')) {
    return 'video'
  }
  if (file.type.startsWith('audio/')) {
    return 'audio'
  }

  const lower = file.name.toLowerCase()
  if (/\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(lower)) {
    return 'video'
  }
  if (/\.(wav|mp3|aac|m4a|flac|ogg)$/i.test(lower)) {
    return 'audio'
  }
  return null
}

function filePathOrName(file: File): string {
  const maybePath = (file as File & { path?: string }).path
  if (typeof maybePath === 'string' && maybePath.length > 0) {
    return maybePath
  }
  return file.name
}

interface MediaProbeResult {
  url: string
  durationSecs: number
  hasAudio: boolean
  thumbnailDataUrl: string
}

/**
 * Load a file into a hidden video element to extract duration, hasAudio, and a thumbnail.
 * Creates a persistent blob URL stored in sessionObjectUrls so <video> elements can play it.
 */
function probeMediaFile(file: File, path: string): Promise<MediaProbeResult> {
  return new Promise((resolve) => {
    // Create a persistent objectURL for playback — stored in the session map, not revoked
    let persistentUrl = sessionObjectUrls.get(path)
    if (!persistentUrl) {
      persistentUrl = URL.createObjectURL(file)
      sessionObjectUrls.set(path, persistentUrl)
    }

    // Use a separate temporary objectURL just for probing, revoked after
    const probeUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.crossOrigin = 'anonymous'

    const playbackUrl = persistentUrl

    let settled = false
    const done = (result: MediaProbeResult) => {
      if (settled) return
      settled = true
      video.src = ''
      URL.revokeObjectURL(probeUrl)
      resolve(result)
    }

    const fallback = () => done({
      url: playbackUrl,
      durationSecs: isFinite(video.duration) ? video.duration : 0,
      hasAudio: file.type.startsWith('audio/'),
      thumbnailDataUrl: '',
    })

    video.addEventListener('error', fallback, { once: true })

    video.addEventListener('loadedmetadata', () => {
      const durationSecs = isFinite(video.duration) ? video.duration : 0
      const isAudioOnly = file.type.startsWith('audio/') || video.videoWidth === 0

      if (isAudioOnly) {
        done({ url: playbackUrl, durationSecs, hasAudio: true, thumbnailDataUrl: '' })
        return
      }

      // Seek to 10% for a representative frame
      video.currentTime = Math.max(0.1, durationSecs * 0.1)
    }, { once: true })

    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = Math.round(160 * (video.videoHeight / Math.max(video.videoWidth, 1)))
      const ctx = canvas.getContext('2d')
      let thumbnailDataUrl = ''
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.72)
      }
      const durationSecs = isFinite(video.duration) ? video.duration : 0
      // Best-effort audio detection — works in Chrome/WebKit
      const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean }
      const hasAudio = typeof v.webkitAudioDecodedByteCount === 'number'
        ? v.webkitAudioDecodedByteCount > 0
        : typeof v.mozHasAudio === 'boolean'
          ? v.mozHasAudio
          : true // assume audio present if we can't detect
      done({ url: playbackUrl, durationSecs, hasAudio, thumbnailDataUrl })
    }, { once: true })

    video.src = probeUrl
    video.load()
  })
}

export default function App() {
  const engine = useMemo(() => createEngineClient(PROJECT_ID), [])

  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [semanticSearchQuery, setSemanticSearchQuery] = useState('')
  const [semanticSearchResults, setSemanticSearchResults] = useState<AppSnapshot['assets']>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [theme] = useState<ThemeMode>(() => loadThemeMode())
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  })
  const [dismissedProposalIds, setDismissedProposalIds] = useState<string[]>([])

  const exportStatusRef = useRef<Record<string, ExportJobStatus>>({})
  const workspaceSyncReady = useRef(false)

  const pushToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = makeToastId('toast')
    setToasts((prev) => [{ ...toast, id }, ...prev])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 8000)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const runCommand = useCallback(
    async (command: EngineCommand): Promise<Awaited<ReturnType<typeof engine.invoke>>> => {
      const result = await engine.invoke(command)
      if (!result.ok) {
        pushToast({
          title: 'Command failed',
          description: result.error,
          tone: 'error',
        })
      }
      return result
    },
    [engine, pushToast],
  )

  const refreshSnapshot = useCallback(async () => {
    const response = await runCommand({
      name: 'project.open',
      payload: { projectId: PROJECT_ID },
    })

    if (response.ok && isAppSnapshot(response.value)) {
      setSnapshot(response.value)
      setSemanticSearchResults(response.value.assets)
    }
  }, [runCommand])

  useEffect(() => {
    const initTimer = window.setTimeout(() => {
      void refreshSnapshot()
    }, 0)

    const unsubscribe = engine.subscribe((event) => {
      if (event.type === 'ProposalReady') {
        pushToast({
          title: 'Proposal Ready',
          description: 'AI restructure proposal is ready for review in Edit.',
          tone: 'info',
        })
      }
      void refreshSnapshot()
    })

    return () => {
      window.clearTimeout(initTimer)
      unsubscribe()
    }
  }, [engine, pushToast, refreshSnapshot])

  useEffect(() => {
    function onResize(): void {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    saveThemeMode(theme)
  }, [theme])

  useEffect(() => {
    if (!snapshot) {
      return
    }

    const current = Object.fromEntries(snapshot.exportJobs.map((job) => [job.id, job.status]))
    const nextToasts: Omit<ToastItem, 'id'>[] = []

    for (const job of snapshot.exportJobs) {
      const previousStatus = exportStatusRef.current[job.id]
      if (previousStatus === job.status) {
        continue
      }

      if (job.status === 'completed' && job.outputPath) {
        const outputPath = job.outputPath
        nextToasts.push({
          title: 'Export Completed',
          description: outputPath,
          tone: 'success',
          actions: [
            {
              label: 'Reveal in Finder',
              onClick: () => {
                window.open(`file://${outputPath}`)
              },
            },
            {
              label: 'Copy Path',
              onClick: () => {
                void navigator.clipboard.writeText(outputPath)
              },
            },
          ],
        })
      }

      if (job.status === 'failed') {
        nextToasts.push({
          title: 'Export Failed',
          description: job.errorMessage ?? 'Unknown export error',
          tone: 'error',
        })
      }
    }

    exportStatusRef.current = current
    if (nextToasts.length > 0) {
      queueMicrotask(() => {
        for (const toast of nextToasts) {
          pushToast(toast)
        }
      })
    }
  }, [pushToast, snapshot])

  useEffect(() => {
    if (!snapshot) {
      return
    }
    workspaceSyncReady.current = true
  }, [snapshot])

  const activeSequence = useMemo(() => {
    if (!snapshot) {
      return null
    }
    return findSequence(snapshot)
  }, [snapshot])

  const activeProposal = useMemo(() => {
    if (!snapshot) {
      return null
    }
    return (
      snapshot.proposals.find((proposal) => !dismissedProposalIds.includes(proposal.id)) ?? null
    )
  }, [dismissedProposalIds, snapshot])

  const layoutMode = useMemo(() => {
    if (windowSize.width < 1200) {
      return 'drawer' as const
    }
    if (windowSize.width < 1440) {
      return 'compact' as const
    }
    return 'full' as const
  }, [windowSize.width])

  const isWindowBelowMinimum = windowSize.width < 1100 || windowSize.height < 700

  const patchWorkspace = useCallback(
    async (patch: Partial<WorkspaceState>) => {
      if (!snapshot) {
        return
      }

      const nextWorkspace = {
        ...snapshot.workspace,
        ...patch,
      }

      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              workspace: nextWorkspace,
            }
          : prev,
      )

      if (!workspaceSyncReady.current) {
        return
      }

      await runCommand({
        name: 'project.workspace.store',
        payload: {
          projectId: snapshot.project.projectId,
          workspace: nextWorkspace,
        },
      })
    },
    [runCommand, snapshot],
  )

  const setActiveTab = useCallback(
    (tab: TopLevelTab) => {
      void patchWorkspace({ activeTab: tab })
    },
    [patchWorkspace],
  )

  const onSemanticSearchQueryChange = useCallback(
    async (query: string) => {
      setSemanticSearchQuery(query)
      const response = await runCommand({
        name: 'media.semantic_query',
        payload: { query },
      })
      if (response.ok && isAssetVersionArray(response.value)) {
        setSemanticSearchResults(response.value)
      }
    },
    [runCommand],
  )

  const onInsertAssetToTimeline = useCallback(
    async (assetVersionId: string) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'timeline.insert_asset',
        payload: {
          sequenceId: activeSequence.id,
          assetVersionId,
          insertAtTick: activeSequence.playheadTick,
        },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onImportMediaFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return
      }

      let importedCount = 0
      let skippedCount = 0

      for (const file of files) {
        const mediaType = inferMediaTypeFromFile(file)
        if (!mediaType) {
          skippedCount += 1
          continue
        }

        const path = filePathOrName(file)
        const probe = await probeMediaFile(file, path)

        await runCommand({
          name: 'media.import',
          payload: {
            label: file.name,
            mediaType,
            path,
            sourceType: 'imported',
            url: probe.url,
            durationSecs: probe.durationSecs,
            hasAudio: probe.hasAudio,
            thumbnailDataUrl: probe.thumbnailDataUrl,
          },
        })
        importedCount += 1
      }

      await refreshSnapshot()
      if (importedCount > 0) {
        pushToast({
          title: 'Media imported',
          description: `Imported ${importedCount} file${importedCount === 1 ? '' : 's'}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}.`,
          tone: 'success',
        })
      } else {
        pushToast({
          title: 'No supported files',
          description: 'Only video/audio files are currently supported.',
          tone: 'info',
        })
      }
    },
    [pushToast, refreshSnapshot, runCommand],
  )

  const onToggleSnap = useCallback(
    async (enabled: boolean) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'timeline.toggle_snap',
        payload: { sequenceId: activeSequence.id, enabled },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onToggleRipple = useCallback(
    async (enabled: boolean) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'timeline.toggle_ripple',
        payload: { sequenceId: activeSequence.id, enabled },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onSelectClip = useCallback(
    async (clipId: string | null) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'timeline.select',
        payload: { sequenceId: activeSequence.id, clipId },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onHistoryRestore = useCallback(
    async (commitId: string) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'history.restore',
        payload: { sequenceId: activeSequence.id, commitId },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onHistoryCompare = useCallback(
    async (commitId: string) => {
      if (!activeSequence || !snapshot || snapshot.historyCommits.length === 0) {
        return
      }
      const currentHead = snapshot.historyCommits[0]
      const response = await runCommand({
        name: 'history.compare',
        payload: {
          sequenceId: activeSequence.id,
          leftCommitId: commitId,
          rightCommitId: currentHead.id,
        },
      })

      if (response.ok && isHistoryCompareResult(response.value)) {
        pushToast({
          title: 'Compare Result',
          description: `${response.value.summary} (+${response.value.added} / -${response.value.removed} / Δ${response.value.changed})`,
          tone: 'info',
        })
      }
    },
    [activeSequence, pushToast, runCommand, snapshot],
  )

  const onCreateVariation = useCallback(
    async (fromCommitId: string, name: string) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'history.create_variation',
        payload: {
          sequenceId: activeSequence.id,
          fromCommitId,
          name: name.trim() || 'Variation',
        },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onMergeVariation = useCallback(
    async (sourceBranchId: string, operation: MergeOperation) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'history.merge',
        payload: {
          sequenceId: activeSequence.id,
          sourceBranchId,
          operation,
        },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onCreateProposal = useCallback(
    async (instruction: string) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'ai.create_restructure_proposal',
        payload: { sequenceId: activeSequence.id, instruction },
      })
      await patchWorkspace({ activeTab: 'edit' })
      await refreshSnapshot()
    },
    [activeSequence, patchWorkspace, refreshSnapshot, runCommand],
  )

  const onApplyProposal = useCallback(
    async (proposalId: string) => {
      if (!activeSequence) {
        return
      }
      await runCommand({
        name: 'ai.apply_proposal',
        payload: { sequenceId: activeSequence.id, proposalId },
      })
      await refreshSnapshot()
      pushToast({
        title: 'Proposal applied',
        description: 'AI change-set applied as one atomic batch.',
        tone: 'success',
      })
    },
    [activeSequence, pushToast, refreshSnapshot, runCommand],
  )

  const onRejectProposal = useCallback(
    (proposalId: string) => {
      setDismissedProposalIds((prev) => [...prev, proposalId])
      pushToast({
        title: 'Proposal rejected',
        description: 'Proposal discarded without timeline mutation.',
        tone: 'info',
      })
    },
    [pushToast],
  )

  const onSubmitGeneration = useCallback(
    async (title: string, promptText: string, provider: string) => {
      await runCommand({
        name: 'ai.submit_generation',
        payload: {
          title,
          promptText,
          provider,
        },
      })
      await refreshSnapshot()
    },
    [refreshSnapshot, runCommand],
  )

  const onCancelGeneration = useCallback(
    async (jobId: string) => {
      await runCommand({
        name: 'ai.cancel_job',
        payload: { jobId },
      })
      await refreshSnapshot()
    },
    [refreshSnapshot, runCommand],
  )

  const onAddToMediaPool = useCallback(
    (assetVersionId: string) => {
      if (!snapshot) {
        return
      }
      const asset = snapshot.assets.find((item) => item.id === assetVersionId)
      pushToast({
        title: 'Already in Media Pool',
        description: `${asset?.label ?? 'Asset'} is linked in this project media pool.`,
        tone: 'info',
      })
    },
    [pushToast, snapshot],
  )

  const onSetActiveOutput = useCallback(
    async (promptClipId: string, assetVersionId: string) => {
      await runCommand({
        name: 'ai.set_active_output',
        payload: { promptClipId, assetVersionId },
      })
      await refreshSnapshot()
    },
    [refreshSnapshot, runCommand],
  )

  const onCompareOutput = useCallback(
    (promptClipId: string, assetVersionId: string) => {
      pushToast({
        title: 'Output compare',
        description: `Comparing output ${assetVersionId} from prompt ${promptClipId}.`,
        tone: 'info',
      })
    },
    [pushToast],
  )

  const onRollbackOutput = useCallback(
    async (promptClipId: string) => {
      if (!snapshot) {
        return
      }
      const prompt = snapshot.promptClips.find((item) => item.id === promptClipId)
      if (!prompt || prompt.outputAssetVersionIds.length < 2) {
        pushToast({
          title: 'Rollback unavailable',
          description: 'Need at least two outputs to rollback.',
          tone: 'info',
        })
        return
      }

      const candidate =
        prompt.outputAssetVersionIds.find((id) => id !== prompt.activeAssetVersionId) ??
        prompt.outputAssetVersionIds[1]

      await runCommand({
        name: 'ai.set_active_output',
        payload: { promptClipId, assetVersionId: candidate },
      })
      await refreshSnapshot()
    },
    [pushToast, refreshSnapshot, runCommand, snapshot],
  )

  const onCreateAndEnqueueExport = useCallback(
    async (settings: ExportSettings) => {
      if (!activeSequence) {
        return
      }
      const createResponse = await runCommand({
        name: 'export.create_job',
        payload: { sequenceId: activeSequence.id, settings },
      })

      const exportJobId =
        createResponse.ok && hasExportJobId(createResponse.value)
          ? createResponse.value.exportJobId
          : null

      if (
        !createResponse.ok ||
        !exportJobId
      ) {
        return
      }

      await runCommand({
        name: 'export.enqueue',
        payload: { exportJobId },
      })
      await refreshSnapshot()
    },
    [activeSequence, refreshSnapshot, runCommand],
  )

  const onCancelExport = useCallback(
    async (exportJobId: string) => {
      await runCommand({
        name: 'export.cancel',
        payload: { exportJobId },
      })
      await refreshSnapshot()
    },
    [refreshSnapshot, runCommand],
  )

  const onRetryExport = useCallback(
    async (exportJobId: string) => {
      await runCommand({
        name: 'export.retry',
        payload: { exportJobId },
      })
      await refreshSnapshot()
    },
    [refreshSnapshot, runCommand],
  )

  const onRevealOutputPath = useCallback((path: string) => {
    window.open(`file://${path}`)
  }, [])

  const onCopyOutputPath = useCallback((path: string) => {
    void navigator.clipboard.writeText(path)
    pushToast({
      title: 'Path copied',
      description: path,
      tone: 'success',
    })
  }, [pushToast])

  if (!snapshot) {
    return <div className="app-loading">Loading project...</div>
  }

  return (
    <div className="app-shell">
      {isWindowBelowMinimum ? (
        <div className="min-window-warning" role="status">
          Window below 1100x700. UI has switched to compact drawer behavior.
        </div>
      ) : null}

      <TopBar
        activeTab={snapshot.workspace.activeTab}
        onTabChange={setActiveTab}
      />

      <main className="tab-panels">
        <section className={`tab-panel ${snapshot.workspace.activeTab === 'generate' ? 'is-active' : ''}`}>
          <GenerateTab
            promptClips={snapshot.promptClips}
            generationJobs={snapshot.generationJobs}
            generatedAssets={snapshot.assets.filter((asset) => asset.sourceType === 'generated')}
            onSubmitGeneration={onSubmitGeneration}
            onCancelGeneration={onCancelGeneration}
            onAddToMediaPool={onAddToMediaPool}
            onAddToTimeline={onInsertAssetToTimeline}
            onSetActiveOutput={onSetActiveOutput}
            onCompareOutput={onCompareOutput}
            onRollbackOutput={onRollbackOutput}
          />
        </section>

        <section className={`tab-panel ${snapshot.workspace.activeTab === 'edit' ? 'is-active' : ''}`}>
          <EditTab
            sequence={activeSequence}
            assets={snapshot.assets}
            historyCommits={snapshot.historyCommits}
            variations={snapshot.variations}
            activeProposal={activeProposal}
            activeLeftRailTab={snapshot.workspace.activeLeftRailTab}
            activeRightRailTab={snapshot.workspace.activeRightRailTab}
            leftRailVisible={snapshot.workspace.leftRailVisible}
            rightRailVisible={snapshot.workspace.rightRailVisible}
            leftRailCollapsed={layoutMode !== 'full'}
            rightRailCompact={layoutMode === 'compact'}
            timelineHeight={snapshot.workspace.timelineHeight}
            viewerZoom={snapshot.workspace.viewerZoom}
            timelineZoom={snapshot.workspace.timelineZoom}
            layoutMode={layoutMode}
            semanticSearchQuery={semanticSearchQuery}
            semanticSearchResults={semanticSearchResults}
            onActiveLeftRailTabChange={(tab) => {
              void patchWorkspace({ activeLeftRailTab: tab })
            }}
            onActiveRightRailTabChange={(tab) => {
              void patchWorkspace({ activeRightRailTab: tab })
            }}
            onTimelineHeightChange={(value) => {
              void patchWorkspace({ timelineHeight: value })
            }}
            onViewerZoomChange={(value) => {
              void patchWorkspace({ viewerZoom: value })
            }}
            onTimelineZoomChange={(value) => {
              void patchWorkspace({ timelineZoom: value })
            }}
            onSemanticSearchQueryChange={onSemanticSearchQueryChange}
            onToggleSnap={onToggleSnap}
            onToggleRipple={onToggleRipple}
            onSelectClip={onSelectClip}
            onInsertAssetToTimeline={onInsertAssetToTimeline}
            onImportMediaFiles={onImportMediaFiles}
            onHistoryRestore={onHistoryRestore}
            onHistoryCompare={onHistoryCompare}
            onCreateVariation={onCreateVariation}
            onMergeVariation={onMergeVariation}
            onCreateProposal={onCreateProposal}
            onApplyProposal={onApplyProposal}
            onRejectProposal={onRejectProposal}
          />
        </section>

        <section className={`tab-panel ${snapshot.workspace.activeTab === 'export' ? 'is-active' : ''}`}>
          <ExportTab
            sequenceId={activeSequence?.id ?? snapshot.project.activeSequenceId}
            exportJobs={snapshot.exportJobs}
            onCreateAndEnqueue={onCreateAndEnqueueExport}
            onCancelExport={onCancelExport}
            onRetryExport={onRetryExport}
            onRevealOutputPath={onRevealOutputPath}
            onCopyOutputPath={onCopyOutputPath}
          />
        </section>
      </main>

      <StatusStrip
        ingestJobs={snapshot.ingestJobs}
        generationJobs={snapshot.generationJobs}
        exportJobs={snapshot.exportJobs}
        warnings={snapshot.warnings}
      />

      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
