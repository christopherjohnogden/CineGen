import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AudioLines,
  Eye,
  Folder,
  FastForward,
  GitBranch,
  History as HistoryIcon,
  Lock,
  Magnet,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  Plus,
  Rewind,
  Scissors,
  Search as SearchIcon,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Video,
  Volume2,
} from 'lucide-react'
import type {
  AiRestructureProposal,
  AssetVersion,
  HistoryCommit,
  LeftRailTab,
  MergeOperation,
  RightRailTab,
  Sequence,
  VariationBranch,
} from '../types/engine'
import { formatDateTime } from '../utils/format'
import { formatTicksToTimecode, ticksToSeconds } from '../utils/time'

type EditLayoutMode = 'full' | 'compact' | 'drawer'

interface EditTabProps {
  sequence: Sequence | null
  assets: AssetVersion[]
  historyCommits: HistoryCommit[]
  variations: VariationBranch[]
  activeProposal: AiRestructureProposal | null
  activeLeftRailTab: LeftRailTab
  activeRightRailTab: RightRailTab
  leftRailVisible: boolean
  rightRailVisible: boolean
  leftRailCollapsed: boolean
  rightRailCompact: boolean
  timelineHeight: number
  viewerZoom: number
  timelineZoom: number
  layoutMode: EditLayoutMode
  semanticSearchQuery: string
  semanticSearchResults: AssetVersion[]
  onActiveLeftRailTabChange: (tab: LeftRailTab) => void
  onActiveRightRailTabChange: (tab: RightRailTab) => void
  onTimelineHeightChange: (value: number) => void
  onViewerZoomChange: (value: number) => void
  onTimelineZoomChange: (value: number) => void
  onSemanticSearchQueryChange: (query: string) => void
  onToggleSnap: (enabled: boolean) => void
  onToggleRipple: (enabled: boolean) => void
  onSelectClip: (clipId: string | null) => void
  onInsertAssetToTimeline: (assetVersionId: string) => void
  onImportMediaFiles: (files: File[]) => void
  onHistoryRestore: (commitId: string) => void
  onHistoryCompare: (commitId: string) => void
  onCreateVariation: (fromCommitId: string, name: string) => void
  onMergeVariation: (sourceBranchId: string, operation: MergeOperation) => void
  onCreateProposal: (instruction: string) => void
  onApplyProposal: (proposalId: string) => void
  onRejectProposal: (proposalId: string) => void
}

const leftRailTabs: LeftRailTab[] = ['media', 'search', 'effects']
const rightRailTabs: RightRailTab[] = ['inspector', 'history', 'variations']

const leftRailIcons: Record<LeftRailTab, LucideIcon> = {
  media: Folder,
  search: SearchIcon,
  effects: Sparkles,
}

const rightRailIcons: Record<RightRailTab, LucideIcon> = {
  inspector: SlidersHorizontal,
  history: HistoryIcon,
  variations: GitBranch,
}

interface MediaTileItem {
  id: string
  label: string
  sourceType: string
  mediaType: 'video' | 'audio'
  insertable: boolean
  assetVersionId?: string
  thumbnailDataUrl?: string
  durationSecs?: number
}

const mergeOperations: { value: MergeOperation; label: string }[] = [
  { value: 'replace_sequence', label: 'Replace Sequence' },
  { value: 'insert_time_range', label: 'Insert Time Range' },
  { value: 'import_tracks', label: 'Import Track(s)' },
  { value: 'import_clips', label: 'Import Clips' },
]

function labelForLeftRailTab(tab: LeftRailTab): string {
  switch (tab) {
    case 'media':
      return 'Media'
    case 'search':
      return 'Search'
    case 'effects':
      return 'Effects'
    default:
      return 'Media'
  }
}

function labelForRightRailTab(tab: RightRailTab): string {
  switch (tab) {
    case 'inspector':
      return 'Inspector'
    case 'history':
      return 'History'
    case 'variations':
      return 'Variations'
    default:
      return 'Inspector'
  }
}

export function EditTab({
  sequence,
  assets,
  historyCommits,
  variations,
  activeProposal,
  activeLeftRailTab,
  activeRightRailTab,
  leftRailVisible,
  rightRailVisible,
  leftRailCollapsed,
  rightRailCompact,
  timelineHeight,
  viewerZoom,
  timelineZoom,
  layoutMode,
  semanticSearchQuery,
  semanticSearchResults,
  onActiveLeftRailTabChange,
  onActiveRightRailTabChange,
  onTimelineHeightChange,
  onViewerZoomChange,
  onTimelineZoomChange,
  onSemanticSearchQueryChange,
  onToggleSnap,
  onToggleRipple,
  onSelectClip,
  onInsertAssetToTimeline,
  onImportMediaFiles,
  onHistoryRestore,
  onHistoryCompare,
  onCreateVariation,
  onMergeVariation,
  onCreateProposal,
  onApplyProposal,
  onRejectProposal,
}: EditTabProps) {
  const [variationName, setVariationName] = useState('Alt Cut')
  const [mergeBranchId, setMergeBranchId] = useState('main')
  const [mergeOperation, setMergeOperation] = useState<MergeOperation>('replace_sequence')
  const [expandedHistoryRows, setExpandedHistoryRows] = useState<Record<string, boolean>>({})
  const [proposalInstruction] = useState(
    'Tighten pacing for first 20 seconds and reduce dead air between clips.',
  )
  const [showLeftDrawer, setShowLeftDrawer] = useState(false)
  const [showRightDrawer, setShowRightDrawer] = useState(false)
  const [isMediaDropActive, setIsMediaDropActive] = useState(false)
  const [draggingAsset, setDraggingAsset] = useState<{ id: string; label: string } | null>(null)
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 })
  const [dragOverSection, setDragOverSection] = useState<'video' | 'audio' | null>(null)
  const draggingAssetRef = useRef<{ id: string; label: string } | null>(null)
  const mediaImportInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineTracksRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playheadSecs, setPlayheadSecs] = useState(0)
  const [playheadPx, setPlayheadPx] = useState(0)

  // Resizable panels
  const [leftRailWidth, setLeftRailWidth] = useState(260)
  const [rightRailWidth, setRightRailWidth] = useState(280)
  const [videoSectionHeight, setVideoSectionHeight] = useState(200)
  const [trackHeight, setTrackHeight] = useState(46)
  const gridRef = useRef<HTMLDivElement>(null)
  const editTabRef = useRef<HTMLElement>(null)

  const startResizeLeft = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = leftRailWidth
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX
      setLeftRailWidth(Math.max(180, Math.min(440, startWidth + delta)))
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }, [leftRailWidth])

  const startResizeRight = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = rightRailWidth
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX
      setRightRailWidth(Math.max(200, Math.min(480, startWidth + delta)))
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }, [rightRailWidth])

  const startResizeTimeline = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = timelineHeight
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY
      onTimelineHeightChange(Math.max(120, Math.min(560, startHeight + delta)))
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }, [timelineHeight, onTimelineHeightChange])

  const startResizeVideoSection = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = videoSectionHeight
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientY - startY
      setVideoSectionHeight(Math.max(46, startHeight + delta))
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }, [videoSectionHeight])

  const selectedClip = useMemo(() => {
    if (!sequence) {
      return null
    }
    for (const track of sequence.tracks) {
      const clip = track.clips.find((item) => item.id === sequence.selectedClipId)
      if (clip) {
        return clip
      }
    }
    for (const track of sequence.tracks) {
      if (track.clips.length > 0) {
        return track.clips[0]
      }
    }
    return null
  }, [sequence])

  const mediaTiles = useMemo<MediaTileItem[]>(() => {
    // Build a set of asset IDs that are paired audio (to hide them from media pool)
    const pairedAudioIds = new Set<string>()
    for (const asset of assets) {
      const withMeta = asset as AssetVersion & { pairedAudioId?: string }
      if (withMeta.pairedAudioId) pairedAudioIds.add(withMeta.pairedAudioId)
    }
    return assets
      .filter((asset) => (asset.mediaType === 'video' || asset.mediaType === 'audio') && !pairedAudioIds.has(asset.id))
      .map((asset) => ({
        id: asset.id,
        label: asset.label,
        sourceType: asset.sourceType,
        mediaType: asset.mediaType,
        insertable: true,
        assetVersionId: asset.id,
        thumbnailDataUrl: asset.thumbnailDataUrl,
        durationSecs: asset.durationSecs,
      }))
  }, [assets])

  const timelineTracks = useMemo(() => {
    const all = sequence?.tracks ?? []
    const video = all.filter((t) => t.kind === 'video')
    const audio = all.filter((t) => t.kind === 'audio')
    // Video renders highest-index first (top = V_max, bottom = V1)
    const videoDesc = [...video].sort((a, b) => b.index - a.index)
    // Audio renders lowest-index first (top = A1, bottom = A_max)
    const audioAsc = [...audio].sort((a, b) => a.index - b.index)
    return { videoDesc, audioAsc }
  }, [sequence])

  const assetById = useMemo(() => {
    const map = new Map<string, AssetVersion>()
    for (const a of assets) map.set(a.id, a)
    return map
  }, [assets])

  // Resolve the URL of the asset backing the selected clip (for viewer playback)
  const viewerAsset = useMemo(() => {
    if (!selectedClip) return null
    return assets.find((a) => a.id === selectedClip.assetVersionId && a.mediaType === 'video') ?? null
  }, [selectedClip, assets])

  const viewerUrl = viewerAsset?.url ?? null

  // Sync video element src when the active asset changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (viewerUrl) {
      video.src = viewerUrl
      video.load()
      setIsPlaying(false)
    } else {
      video.src = ''
      setIsPlaying(false)
    }
  }, [viewerUrl])

  // Wire video element events → playback state + playhead position
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)
    const onTimeUpdate = () => {
      setPlayheadSecs(video.currentTime)
      const dur = video.duration
      if (dur > 0) {
        const trackArea = timelineTracksRef.current
        const totalWidth = trackArea ? trackArea.scrollWidth - 120 : 800
        setPlayheadPx(Math.round((video.currentTime / dur) * totalWidth))
      }
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [])

  function handlePlayPause(): void {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }

  function handleSkipBack(): void {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
  }

  function handleSkipForward(): void {
    const video = videoRef.current
    if (!video) return
    video.currentTime = video.duration || 0
  }

  function handleRewind(): void {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, video.currentTime - 5)
  }

  function handleFastForward(): void {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
  }

  // Drag the playhead scrubber in the timeline ruler
  const startPlayheadScrub = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const ruler = e.currentTarget.parentElement
    if (!ruler) return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)

    const scrubToX = (clientX: number) => {
      const rect = ruler.getBoundingClientRect()
      const trackX = clientX - rect.left - 120 // subtract track header width
      const totalW = rect.width - 120
      const frac = Math.max(0, Math.min(1, trackX / totalW))
      setPlayheadPx(Math.round(frac * totalW))
      if (video && video.duration > 0) {
        video.currentTime = frac * video.duration
        setPlayheadSecs(video.currentTime)
      }
    }

    scrubToX(e.clientX)

    const onMove = (ev: PointerEvent) => scrubToX(ev.clientX)
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }, [])

  const isDrawer = layoutMode === 'drawer'
  const showLeftRail = leftRailVisible && (!leftRailCollapsed || isDrawer)
  const showRightRail = rightRailVisible

  const leftRailClassName = `edit-tab__left-rail ${leftRailCollapsed && !isDrawer ? 'is-collapsed' : ''}`
  const rightRailClassName = `edit-tab__right-rail ${rightRailCompact ? 'is-compact' : ''}`

  function handleImportInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files ? Array.from(event.target.files) : []
    if (files.length > 0) {
      onImportMediaFiles(files)
    }
    event.target.value = ''
  }

  function handleMediaDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files ?? [])
    setIsMediaDropActive(false)
    if (files.length > 0) {
      onImportMediaFiles(files)
    }
  }

  // Pointer-based drag from media pool — bypasses Tauri 2's HTML5 drag interception
  const startAssetDrag = useCallback((asset: { id: string; label: string }, e: ReactPointerEvent<HTMLLIElement>) => {
    e.preventDefault()
    draggingAssetRef.current = asset
    setDraggingAsset(asset)
    setGhostPos({ x: e.clientX, y: e.clientY })

    const onMove = (ev: PointerEvent) => {
      setGhostPos({ x: ev.clientX, y: ev.clientY })
      // Hit-test which section we're over
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const section = el?.closest('[data-section-id]')
      const id = section?.getAttribute('data-section-id')
      setDragOverSection(id === 'video' || id === 'audio' ? id : null)
    }

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const asset = draggingAssetRef.current
      draggingAssetRef.current = null
      setDraggingAsset(null)
      setDragOverSection(null)

      if (!asset) return
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const section = el?.closest('[data-section-id]')
      if (section) {
        onInsertAssetToTimeline(asset.id)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onInsertAssetToTimeline])

  return (
    <section className="edit-tab" aria-label="Edit workspace" ref={editTabRef}>
      {draggingAsset ? (
        <div
          className="asset-drag-ghost"
          style={{ transform: `translate(${ghostPos.x}px, ${ghostPos.y}px)` }}
          aria-hidden="true"
        >
          {draggingAsset.label}
        </div>
      ) : null}
      {sequence ? null : (
        <div className="empty-state">No active sequence found. Open a project to continue.</div>
      )}

      <div
        className="edit-tab__grid"
        ref={gridRef}
        style={{
          '--left-rail-width': `${leftRailWidth}px`,
          '--right-rail-width': `${rightRailWidth}px`,
        } as CSSProperties}
      >
        {showLeftRail ? (
          <aside className={leftRailClassName} aria-label="Edit left rail">
            <header className="panel-header">
              <h3>Assets</h3>
            </header>
            <div className="rail-body">
              <div className="rail-tab-strip" role="tablist" aria-label="Edit left rail tabs">
                {leftRailTabs.map((tab) => {
                  const Icon = leftRailIcons[tab]
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activeLeftRailTab === tab}
                      className={`rail-tab ${activeLeftRailTab === tab ? 'is-active' : ''}`}
                      onClick={() => onActiveLeftRailTabChange(tab)}
                      title={labelForLeftRailTab(tab)}
                    >
                      <Icon size={14} />
                      {leftRailCollapsed && !isDrawer ? null : <span>{labelForLeftRailTab(tab)}</span>}
                    </button>
                  )
                })}
              </div>

              <div className="rail-content">
                {activeLeftRailTab === 'media' ? (
                  <>
                    <div className="media-import-actions">
                      <button
                        type="button"
                        className="outline-button"
                        onClick={() => mediaImportInputRef.current?.click()}
                      >
                        <Upload size={14} />
                        Import Media
                      </button>
                      <span>Video, audio, image</span>
                      <input
                        ref={mediaImportInputRef}
                        type="file"
                        accept="video/*,audio/*"
                        multiple
                        className="hidden-file-input"
                        onChange={handleImportInputChange}
                      />
                    </div>
                    <div
                      className={`asset-drop-zone ${isMediaDropActive ? 'is-active' : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault()
                        setIsMediaDropActive(true)
                      }}
                      onDragLeave={() => setIsMediaDropActive(false)}
                      onDrop={handleMediaDrop}
                    >
                      Drop media files here to import
                    </div>
                    <input className="input" placeholder="Search assets" type="search" />
                    <ul className="asset-grid" aria-label="Media assets">
                      {mediaTiles.map((tile) => (
                        <li
                          key={tile.id}
                          className={`asset-tile ${tile.insertable ? 'is-draggable' : 'is-placeholder'} ${draggingAsset?.id === tile.id ? 'is-dragging' : ''}`}
                          onPointerDown={tile.insertable && tile.assetVersionId ? (e) => startAssetDrag({ id: tile.assetVersionId!, label: tile.label }, e) : undefined}
                        >
                          <div className={`asset-tile__thumb is-${tile.mediaType}`}>
                            {tile.thumbnailDataUrl ? (
                              <img src={tile.thumbnailDataUrl} alt="" className="asset-tile__thumb-img" />
                            ) : (
                              <span className="asset-tile__thumb-label">{tile.mediaType === 'video' ? 'VID' : 'AUD'}</span>
                            )}
                          </div>
                          <div className="asset-tile__meta">
                            <strong>{tile.label}</strong>
                            <span>{tile.sourceType}</span>
                          </div>
                          {tile.insertable && tile.assetVersionId ? (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => onInsertAssetToTimeline(tile.assetVersionId ?? '')}
                            >
                              Insert
                            </button>
                          ) : (
                            <span className="asset-tile__hint">Preview</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {activeLeftRailTab === 'search' ? (
                  <div className="rail-panel-stack">
                    <label htmlFor="semantic-search" className="field-label">
                      Semantic Search
                    </label>
                    <input
                      id="semantic-search"
                      type="search"
                      className="input"
                      placeholder="Describe the shot you need"
                      value={semanticSearchQuery}
                      onChange={(event) => onSemanticSearchQueryChange(event.target.value)}
                    />
                    <ul className="asset-list" aria-label="Semantic search results">
                      {semanticSearchResults.map((asset) => (
                        <li key={asset.id} className="asset-list__item">
                          <div>
                            <strong>{asset.label}</strong>
                            <p>{asset.sourceType}</p>
                          </div>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => onInsertAssetToTimeline(asset.id)}
                          >
                            Insert
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {activeLeftRailTab === 'effects' ? (
                  <ul className="effect-list" aria-label="Effects library">
                    <li>Transform</li>
                    <li>Color Balance</li>
                    <li>Sharpen</li>
                    <li>Speed Ramp</li>
                    <li>Glow</li>
                    <li>Film Grain</li>
                  </ul>
                ) : null}
              </div>
            </div>
          </aside>
        ) : null}
        {showLeftRail ? (
          <div className="panel-resizer panel-resizer--vertical" onPointerDown={startResizeLeft} aria-hidden="true" />
        ) : null}

        <section className="viewer" aria-label="Viewer panel">
          <header className="viewer__header">
            <div className="viewer__tabs" role="tablist" aria-label="Viewer modes">
              <button type="button" className="viewer-tab is-active">
                Preview
              </button>
              <button type="button" className="viewer-tab">
                Info
              </button>
              <button type="button" className="viewer-tab">
                Guides
              </button>
            </div>
            <div className="viewer__meta">
              <span>{sequence ? formatTicksToTimecode(sequence.playheadTick) : '00:00:00'}</span>
              <label className="slider-row">
                Zoom
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={viewerZoom}
                  onChange={(event) => onViewerZoomChange(Number(event.target.value))}
                />
              </label>
              {isDrawer ? (
                <>
                  <button type="button" className="outline-button" onClick={() => setShowLeftDrawer(true)}>
                    <PanelLeft size={13} />
                    Browser
                  </button>
                  <button type="button" className="outline-button" onClick={() => setShowRightDrawer(true)}>
                    <PanelRight size={13} />
                    Inspector
                  </button>
                </>
              ) : null}
              <button type="button" className="outline-button" onClick={() => onCreateProposal(proposalInstruction)}>
                <Sparkles size={13} />
                AI Restructure
              </button>
            </div>
          </header>

          <div className="viewer__canvas" style={{ '--viewer-zoom': String(viewerZoom) } as CSSProperties}>
            <div className="viewer__frame">
              {viewerUrl ? (
                <video
                  ref={videoRef}
                  className="viewer__video"
                  playsInline
                  onClick={handlePlayPause}
                />
              ) : (
                <div className="viewer__empty">
                  {assets.length === 0 ? 'Import media to begin' : 'Select a clip to preview'}
                </div>
              )}
            </div>
          </div>

          <footer className="viewer__controls">
            <div className="viewer__transport">
              <button type="button" className="icon-button" onClick={handleSkipBack} title="Go to start">
                <SkipBack size={13} />
              </button>
              <button type="button" className="icon-button" onClick={handleRewind} title="Back 5s">
                <Rewind size={13} />
              </button>
              <button type="button" className="icon-button is-play" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <button type="button" className="icon-button" onClick={handleFastForward} title="Forward 5s">
                <FastForward size={13} />
              </button>
              <button type="button" className="icon-button" onClick={handleSkipForward} title="Go to end">
                <SkipForward size={13} />
              </button>
            </div>
            <div className="viewer__transport-meta">
              <span>{formatTicksToTimecode(Math.round(playheadSecs * 240_000))}</span>
              <span>{viewerAsset?.durationSecs ? formatTicksToTimecode(Math.round(viewerAsset.durationSecs * 240_000)) : '00:00:00'}</span>
            </div>
          </footer>
        </section>

        {showRightRail ? (
          <div className="panel-resizer panel-resizer--vertical" onPointerDown={startResizeRight} aria-hidden="true" />
        ) : null}
        {showRightRail ? (
          <aside className={rightRailClassName} aria-label="Edit right rail">
            <header className="panel-header">
              <h3>Inspector</h3>
            </header>

            <div className="rail-tab-strip" role="tablist" aria-label="Edit right rail tabs">
              {rightRailTabs.map((tab) => {
                const Icon = rightRailIcons[tab]
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeRightRailTab === tab}
                    className={`rail-tab ${activeRightRailTab === tab ? 'is-active' : ''}`}
                    onClick={() => onActiveRightRailTabChange(tab)}
                    title={labelForRightRailTab(tab)}
                  >
                    <Icon size={14} />
                    {rightRailCompact ? null : <span>{labelForRightRailTab(tab)}</span>}
                  </button>
                )
              })}
            </div>

            <div className="rail-content">
              {activeRightRailTab === 'inspector' ? (
                <div className="rail-panel-stack">
                  {selectedClip ? (
                    <>
                      <div className="inspector-meta">
                        <strong>{selectedClip.label}</strong>
                        <p>{formatTicksToTimecode(selectedClip.startTick)}</p>
                      </div>

                      <section className="inspector-section">
                        <h4>Transform</h4>
                        <label className="inspector-control">
                          <span>Position X</span>
                          <input type="range" min={0} max={100} value={50} readOnly />
                        </label>
                        <label className="inspector-control">
                          <span>Scale</span>
                          <input type="range" min={0} max={100} value={65} readOnly />
                        </label>
                        <label className="inspector-control">
                          <span>Rotation</span>
                          <input type="range" min={0} max={100} value={15} readOnly />
                        </label>
                        <label className="inspector-control">
                          <span>Opacity</span>
                          <input type="range" min={0} max={100} value={90} readOnly />
                        </label>
                      </section>
                    </>
                  ) : (
                    <p>Select a clip to inspect.</p>
                  )}
                </div>
              ) : null}

              {activeRightRailTab === 'history' ? (
                <div className="rail-panel-stack">
                  <h3>History</h3>
                  <ul className="history-list">
                    {historyCommits.map((commit) => (
                      <li key={commit.id} className="history-list__item">
                        <button
                          type="button"
                          className="history-item__summary"
                          onClick={() =>
                            setExpandedHistoryRows((prev) => ({
                              ...prev,
                              [commit.id]: !prev[commit.id],
                            }))
                          }
                        >
                          <span>{formatDateTime(commit.timestamp)}</span>
                          <strong>{commit.summary}</strong>
                          <span>{commit.actor}</span>
                        </button>

                        {expandedHistoryRows[commit.id] ? (
                          <div className="history-item__details">
                            <p>{commit.source}</p>
                            <p>Events: {commit.eventTypes.join(', ')}</p>
                            <div className="inline-actions">
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => onHistoryRestore(commit.id)}
                              >
                                Restore
                              </button>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => onHistoryCompare(commit.id)}
                              >
                                Compare
                              </button>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => onCreateVariation(commit.id, variationName)}
                              >
                                Variation
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <label className="field-label" htmlFor="variation-name-input">
                    New Variation Name
                  </label>
                  <input
                    id="variation-name-input"
                    className="input"
                    value={variationName}
                    onChange={(event) => setVariationName(event.target.value)}
                  />
                </div>
              ) : null}

              {activeRightRailTab === 'variations' ? (
                <div className="rail-panel-stack">
                  <h3>Variations</h3>
                  <ul className="variation-list">
                    {variations.map((variation) => (
                      <li key={variation.id}>
                        <strong>{variation.name}</strong>
                        <p>Updated {formatDateTime(variation.lastModifiedAt)}</p>
                      </li>
                    ))}
                  </ul>

                  <label className="field-label" htmlFor="merge-branch">
                    Source Variation
                  </label>
                  <select
                    id="merge-branch"
                    className="input"
                    value={mergeBranchId}
                    onChange={(event) => setMergeBranchId(event.target.value)}
                  >
                    {variations.map((variation) => (
                      <option key={variation.id} value={variation.id}>
                        {variation.name}
                      </option>
                    ))}
                  </select>

                  <label className="field-label" htmlFor="merge-operation">
                    Merge Operation
                  </label>
                  <select
                    id="merge-operation"
                    className="input"
                    value={mergeOperation}
                    onChange={(event) => setMergeOperation(event.target.value as MergeOperation)}
                  >
                    {mergeOperations.map((operation) => (
                      <option key={operation.value} value={operation.value}>
                        {operation.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => onMergeVariation(mergeBranchId, mergeOperation)}
                  >
                    Merge Variation
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      <div className="panel-resizer panel-resizer--horizontal" onPointerDown={startResizeTimeline} aria-hidden="true" />
      <section className="timeline" aria-label="Timeline" style={{ height: `${timelineHeight}px` }}>
            <header className="timeline__header">
              <div className="timeline__title-group">
                <h2>Timeline 1</h2>
                <span>Library mode</span>
              </div>
              <div className="timeline__transport">
                <button type="button" className="icon-button" onClick={handleSkipBack} title="Go to start">
                  <SkipBack size={13} />
                </button>
                <button type="button" className="icon-button" onClick={handleRewind} title="Back 5s">
                  <Rewind size={13} />
                </button>
                <button type="button" className="icon-button is-play" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
                  {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <button type="button" className="icon-button" onClick={handleFastForward} title="Forward 5s">
                  <FastForward size={13} />
                </button>
                <button type="button" className="icon-button" onClick={handleSkipForward} title="Go to end">
                  <SkipForward size={13} />
                </button>
              </div>
              <div className="timeline__header-actions">
                <label className="slider-row">
                  Zoom
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={timelineZoom}
                    onChange={(event) => onTimelineZoomChange(Number(event.target.value))}
                  />
                </label>
                <label className="slider-row">
                  Height
                  <input
                    type="range"
                    min={28}
                    max={120}
                    step={2}
                    value={trackHeight}
                    onChange={(event) => setTrackHeight(Number(event.target.value))}
                  />
                </label>
              </div>
            </header>

            <div className="timeline__subtools">
              <button type="button" className="timeline-chip is-active">
                <MousePointer2 size={12} />
                Select
              </button>
              <button type="button" className="timeline-chip">
                <Scissors size={12} />
                Blade
              </button>
              <button
                type="button"
                className={`timeline-chip ${sequence?.snappingEnabled ? 'is-active' : ''}`}
                onClick={() => onToggleSnap(!(sequence?.snappingEnabled ?? false))}
              >
                <Magnet size={12} />
                Snap
              </button>
              <button
                type="button"
                className={`timeline-chip ${sequence?.rippleEnabled ? 'is-active' : ''}`}
                onClick={() => onToggleRipple(!(sequence?.rippleEnabled ?? false))}
              >
                <AudioLines size={12} />
                Ripple
              </button>
              <button type="button" className="timeline-chip">
                <Plus size={12} />
                Marker
              </button>
              <span className="timeline-zoom-readout">{Math.round(timelineZoom * 76)}%</span>
            </div>

            <div className="timeline__ruler">
              <div className="timeline__ruler-track-offset" />
              <div
                className="timeline__ruler-scrub"
                onPointerDown={startPlayheadScrub}
                title="Click or drag to scrub"
              >
                {/* tick marks rendered via CSS background */}
                <div
                  className="timeline__ruler-head"
                  style={{ left: `${playheadPx}px` }}
                  aria-hidden="true"
                />
              </div>
              <span className="timeline__ruler-timecode mono">
                {formatTicksToTimecode(Math.round(playheadSecs * 240_000))}
              </span>
            </div>

            <div
              className="timeline__tracks"
              ref={timelineTracksRef}
              style={{
                '--track-height': `${trackHeight}px`,
                '--timeline-zoom': String(timelineZoom),
              } as CSSProperties}
            >
              {/* Vertical playhead line over the clip area */}
              <div
                className="timeline__playhead-line"
                aria-hidden="true"
                style={{ left: `${120 + playheadPx}px` }}
              />

              {/* ── Video section — fixed height, scrollable ── */}
              <div
                className={`timeline__section timeline__section--video ${dragOverSection === 'video' ? 'is-drop-target' : ''}`}
                style={{ height: `${videoSectionHeight}px` }}
                data-section-id="video"
              >
              {/* ── Video tracks — highest index at top, V1 at bottom ── */}
              {timelineTracks.videoDesc.map((track) => (
                <div key={track.id} className="timeline-track is-video">
                  <div className="timeline-track__header">
                    <div className="timeline-track__name">
                      <Video size={12} />
                      <strong>{track.name}</strong>
                    </div>
                    <div className="timeline-track__actions">
                      <button type="button" className="track-action" aria-label={`Toggle ${track.name} visibility`}>
                        <Eye size={12} />
                      </button>
                      <button type="button" className="track-action" aria-label={`Lock ${track.name}`}>
                        <Lock size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="timeline-track__clips">
                    {track.clips.map((clip) => {
                      const clipAsset = assetById.get(clip.assetVersionId)
                      const thumb = clipAsset?.thumbnailDataUrl
                      const clipW = Math.max(96, ticksToSeconds(clip.durationTick) * 16 * timelineZoom)
                      // Tile the thumbnail as repeating film frames
                      const frameW = Math.max(32, trackHeight - 14) // square-ish frame cell
                      const thumbStyle: CSSProperties = thumb
                        ? {
                            backgroundImage: `url(${thumb})`,
                            backgroundSize: `${frameW}px 100%`,
                            backgroundRepeat: 'repeat-x',
                            backgroundPosition: 'left center',
                          }
                        : {}
                      return (
                        <button
                          key={clip.id}
                          type="button"
                          className={`timeline-clip is-video ${sequence?.selectedClipId === clip.id ? 'is-selected' : ''}`}
                          onClick={() => onSelectClip(clip.id)}
                          style={{ '--clip-width': `${clipW}px`, '--frame-w': `${frameW}px` } as CSSProperties}
                        >
                          <div
                            className="timeline-clip__frames"
                            aria-hidden="true"
                            style={thumbStyle}
                          />
                          <div className="timeline-clip__info">
                            <span className="timeline-clip__title">{clip.label}</span>
                            <span className="timeline-clip__time">{formatTicksToTimecode(clip.durationTick)}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}

              </div>

              {/* ── Video / Audio divider — draggable ── */}
              <div
                className="timeline-section-divider"
                onPointerDown={startResizeVideoSection}
              >
                <span>Audio</span>
              </div>

              {/* ── Audio section — fills remaining space, scrollable ── */}
              <div
                className={`timeline__section timeline__section--audio ${dragOverSection === 'audio' ? 'is-drop-target' : ''}`}
                data-section-id="audio"
              >
              {/* ── Audio tracks — A1 at top, highest index at bottom ── */}
              {timelineTracks.audioAsc.map((track) => (
                <div key={track.id} className="timeline-track is-audio">
                  <div className="timeline-track__header">
                    <div className="timeline-track__name">
                      <AudioLines size={12} />
                      <strong>{track.name}</strong>
                    </div>
                    <div className="timeline-track__actions">
                      <button type="button" className="track-action" aria-label={`Toggle ${track.name} mute`}>
                        <Volume2 size={12} />
                      </button>
                      <button type="button" className="track-action" aria-label={`Lock ${track.name}`}>
                        <Lock size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="timeline-track__clips">
                    {track.clips.map((clip) => (
                      <button
                        key={clip.id}
                        type="button"
                        className={`timeline-clip is-audio ${sequence?.selectedClipId === clip.id ? 'is-selected' : ''}`}
                        onClick={() => onSelectClip(clip.id)}
                        style={{ '--clip-width': `${Math.max(96, ticksToSeconds(clip.durationTick) * 16 * timelineZoom)}px` } as CSSProperties}
                      >
                        <div className="timeline-clip__frames" aria-hidden="true" />
                        <div className="timeline-clip__info">
                          <span className="timeline-clip__title">{clip.label}</span>
                          <span className="timeline-clip__time">{formatTicksToTimecode(clip.durationTick)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </section>

      {activeProposal ? (
        <aside className="proposal-drawer" aria-label="AI proposal drawer">
          <header className="proposal-drawer__header">
            <h2>AI Proposal Preview</h2>
            <p>{activeProposal.summary}</p>
          </header>

          <section className="proposal-drawer__section">
            <h3>Impacted Areas</h3>
            <ul>
              {activeProposal.impacts.map((impact) => (
                <li key={`${impact.kind}-${impact.label}`}>
                  {impact.kind.toUpperCase()}: {impact.label}
                </li>
              ))}
            </ul>
          </section>

          <section className="proposal-drawer__section">
            <h3>Operations</h3>
            <ul>
              {activeProposal.operations.map((operation) => (
                <li key={operation}>{operation}</li>
              ))}
            </ul>
          </section>

          <footer className="proposal-drawer__actions">
            <button type="button" className="outline-button" onClick={() => onRejectProposal(activeProposal.id)}>
              Reject
            </button>
            <button type="button" className="primary-button" onClick={() => onApplyProposal(activeProposal.id)}>
              Apply (Atomic)
            </button>
          </footer>
        </aside>
      ) : null}

      {isDrawer && showLeftDrawer ? (
        <div className="mobile-drawer-backdrop" onClick={() => setShowLeftDrawer(false)}>
          <div className="mobile-drawer mobile-drawer--left" onClick={(event) => event.stopPropagation()}>
            <header className="mobile-drawer__header">
              <h2>Browser</h2>
              <button type="button" className="icon-button" onClick={() => setShowLeftDrawer(false)}>
                Close
              </button>
            </header>
            <div className="mobile-drawer__content">
              {leftRailTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`rail-tab ${activeLeftRailTab === tab ? 'is-active' : ''}`}
                  onClick={() => {
                    onActiveLeftRailTabChange(tab)
                    setShowLeftDrawer(false)
                  }}
                >
                  {labelForLeftRailTab(tab)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isDrawer && showRightDrawer ? (
        <div className="mobile-drawer-backdrop" onClick={() => setShowRightDrawer(false)}>
          <div className="mobile-drawer mobile-drawer--right" onClick={(event) => event.stopPropagation()}>
            <header className="mobile-drawer__header">
              <h2>Inspector</h2>
              <button type="button" className="icon-button" onClick={() => setShowRightDrawer(false)}>
                Close
              </button>
            </header>
            <div className="mobile-drawer__content">
              {rightRailTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`rail-tab ${activeRightRailTab === tab ? 'is-active' : ''}`}
                  onClick={() => {
                    onActiveRightRailTabChange(tab)
                    setShowRightDrawer(false)
                  }}
                >
                  {labelForRightRailTab(tab)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
