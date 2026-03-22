import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { Asset, MediaFolder } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import { generateId } from '@/lib/utils/ids';
import { toFileUrl } from '@/lib/utils/file-url';
import { createSyncedTimeline } from '@/lib/editor/timeline-operations';
import { BatchSyncDialog } from './batch-sync-dialog';
import {
  getAnalyzeVisionOnImportEnabled,
  getApiKey,
  getAutoVisualIndexingEnabled,
  getBackgroundVisionModel,
  getDefaultTranscriptionEngine,
} from '@/lib/utils/api-key';

/* ============================================
   Types
   ============================================ */
type ViewMode = 'grid' | 'list';
type SortBy = 'name' | 'date' | 'type';
type TranscriptionEngine = 'faster-whisper-local' | 'whisperx-local' | 'whisper-cloud';
type TranscriptionViewMode = 'segments' | 'words';
type TranscriptStatus = 'queued' | 'transcribing' | 'ready' | 'failed';
type VisualIndexStatus = 'queued' | 'analyzing' | 'ready' | 'failed';

const TRANSCRIPTION_ENGINE_LABELS: Record<TranscriptionEngine, string> = {
  'faster-whisper-local': 'Fast Local',
  'whisperx-local': 'WhisperX Local',
  'whisper-cloud': 'Whisper Cloud',
};

const TRANSCRIPT_STATUS_LABELS: Record<TranscriptStatus, string> = {
  queued: 'Queued',
  transcribing: 'Transcribing',
  ready: 'Transcript Ready',
  failed: 'Transcript Failed',
};

const VISUAL_STATUS_LABELS: Record<VisualIndexStatus, string> = {
  queued: 'Vision Queued',
  analyzing: 'Indexing Vision',
  ready: 'Vision Ready',
  failed: 'Vision Failed',
};

interface LeftPanelProps {
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  onSwitchTimeline: (id: string) => void;
  onDragAsset: (asset: Asset) => void;
  panelMode: 'full' | 'compact';
  onToggleMode: () => void;
  onDeleteTimeline?: (id: string) => void;
  onAssetDoubleClick?: (asset: Asset) => void;
  onAddFolder: (folder: MediaFolder) => void;
  onRemoveFolder: (folderId: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onUpdateAsset: (asset: Partial<Asset> & { id: string }) => void;
  onRemoveAsset: (assetId: string) => void;
  onRemoveAssets?: (assetIds: string[]) => void;
  projectId?: string;
  onAddAsset?: (asset: Asset) => void;
  onAddTimeline?: (timeline: Timeline) => void;
}

/* ============================================
   SVG Icons (inline, minimal)
   ============================================ */
const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const ListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
  </svg>
);
const NewFolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
    <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);
const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const ImportIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/* ============================================
   Helpers
   ============================================ */
function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTranscriptTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00.0';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

const PROXY_CODEC_HINTS = ['prores', 'dnxhr', 'dnxhd', 'cfhd', 'cineform', 'rawvideo'];
const PROXY_SIZE_THRESHOLD_BYTES = 1_000_000_000;

function shouldGenerateProxyForAsset(asset: Pick<Asset, 'type' | 'width' | 'codec' | 'fileSize'>): boolean {
  if (asset.type !== 'video') return false;
  if ((asset.fileSize ?? 0) >= PROXY_SIZE_THRESHOLD_BYTES) return true;
  if ((asset.width ?? 0) > 1920) return true;
  const codec = (asset.codec ?? '').toLowerCase();
  return PROXY_CODEC_HINTS.some((hint) => codec.includes(hint));
}

function isAssetProcessing(asset: Asset): boolean {
  if (asset.status === 'offline') return false;

  // For non-local assets we don't have reliable artifact expectations.
  if (!asset.fileRef) return asset.status === 'processing';

  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const hasDuration = typeof asset.duration === 'number' && Number.isFinite(asset.duration) && asset.duration > 0;
  const hasThumbnail = typeof asset.thumbnailUrl === 'string' && asset.thumbnailUrl.length > 0;
  const hasWaveform = Array.isArray(metadata.waveform);
  const hasFilmstripUrl = typeof metadata.filmstripUrl === 'string' && metadata.filmstripUrl.length > 0;
  const hasFilmstripFrames = Array.isArray(metadata.filmstrip) && metadata.filmstrip.length > 0;
  const hasFilmstrip = hasFilmstripUrl || hasFilmstripFrames;
  const hasProxy = typeof asset.proxyRef === 'string' && asset.proxyRef.length > 0;
  const needsProxy = shouldGenerateProxyForAsset(asset);

  if (asset.type === 'image') return !hasThumbnail;
  if (asset.type === 'audio') return !hasDuration || !hasWaveform;
  return !hasDuration || !hasThumbnail || !hasWaveform || !hasFilmstrip || (needsProxy && !hasProxy);
}

function getAssetTranscriptionState(asset: Asset): {
  status?: TranscriptStatus;
  label?: string;
  error?: string;
  engine?: string;
} {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const transcription = (metadata.transcription ?? {}) as {
    text?: string;
    engine?: string;
    segments?: Array<{ text: string; start: number; end: number }>;
  };

  const hasTranscript = typeof transcription.text === 'string'
    ? transcription.text.trim().length > 0
    : Array.isArray(transcription.segments) && transcription.segments.length > 0;

  const status = (() => {
    const value = metadata.transcriptionStatus;
    if (value === 'queued' || value === 'transcribing' || value === 'ready' || value === 'failed') return value;
    if (hasTranscript) return 'ready';
    return undefined;
  })();

  const engine = typeof metadata.transcriptionEngine === 'string'
    ? metadata.transcriptionEngine
    : transcription.engine;
  const error = typeof metadata.transcriptionError === 'string' ? metadata.transcriptionError : undefined;

  return {
    status,
    label: status ? TRANSCRIPT_STATUS_LABELS[status] : undefined,
    error,
    engine,
  };
}

function getAssetVisualIndexState(asset: Asset): {
  status?: VisualIndexStatus;
  label?: string;
  error?: string;
} {
  if (asset.type !== 'video' && asset.type !== 'image') return {};
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const summary = (metadata.llmVisualSummary ?? {}) as Record<string, unknown>;
  const status = (() => {
    const value = metadata.llmVisualSummaryStatus ?? summary.status;
    return value === 'queued' || value === 'analyzing' || value === 'ready' || value === 'failed'
      ? value
      : undefined;
  })();
  return {
    status,
    label: status ? VISUAL_STATUS_LABELS[status] : undefined,
    error: typeof summary.error === 'string' ? summary.error : undefined,
  };
}

/* ============================================
   Component
   ============================================ */
export function LeftPanel({
  assets,
  mediaFolders,
  timelines,
  activeTimelineId,
  onSwitchTimeline,
  onDragAsset,
  panelMode,
  onToggleMode,
  onDeleteTimeline,
  onAssetDoubleClick,
  onAddFolder,
  onRemoveFolder,
  onRenameFolder,
  onUpdateAsset,
  onRemoveAsset,
  onRemoveAssets,
  projectId,
  onAddAsset,
  onAddTimeline,
}: LeftPanelProps) {
  // --- State ---
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [thumbScale, setThumbScale] = useState(100 / 70);
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'asset' | 'folder' | 'bg' | 'timeline'; id?: string } | null>(null);
  const [batchSyncOpen, setBatchSyncOpen] = useState(false);
  const [transcribingIds, setTranscribingIds] = useState<Set<string>>(new Set());
  const [transcriptionFailureModal, setTranscriptionFailureModal] = useState<{
    failed: Array<{ id: string; name: string; error?: string }>;
  } | null>(null);
  const [transcriptionModal, setTranscriptionModal] = useState<{
    assetName: string;
    text: string;
    language: string;
    engine?: string;
    segments: Array<{
      text: string;
      start: number;
      end: number;
      words?: Array<{ word: string; start: number; end: number; prob?: number; speaker?: string | null }>;
    }>;
  } | null>(null);
  const [transcriptionViewMode, setTranscriptionViewMode] = useState<TranscriptionViewMode>('segments');
  const [deleteTimelineConfirm, setDeleteTimelineConfirm] = useState<{ ids: string[]; names: string[] } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverCrumbId, setDragOverCrumbId] = useState<string | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [sortOpen, setSortOpen] = useState(false);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const lastClickedAssetRef = useRef<string | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number; scrollTop: number; preSelected: Set<string> } | null>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const transcriptionBatchAssetIdsRef = useRef(new Map<string, string[]>());

  const renameInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const folderDragCounter = useRef<Record<string, number>>({});
  const transcriptionModalWords = useMemo(
    () => transcriptionModal?.segments.flatMap((segment) => segment.words ?? []) ?? [],
    [transcriptionModal],
  );
  const transcriptionHasWordTimestamps = transcriptionModalWords.length > 0;

  // (timelines, activeTimelineId, onSwitchTimeline, onDeleteTimeline are used below)

  // --- Derived ---
  const currentFolder = currentFolderId ? mediaFolders.find((f) => f.id === currentFolderId) : null;

  // Build breadcrumb trail: [root, ..., grandparent, parent, current]
  const breadcrumbs = useMemo(() => {
    const crumbs: { id: string | null; name: string }[] = [{ id: null, name: 'Media Pool' }];
    if (!currentFolderId) return crumbs;
    const chain: MediaFolder[] = [];
    let fid: string | undefined = currentFolderId;
    while (fid) {
      const f = mediaFolders.find((mf) => mf.id === fid);
      if (!f) break;
      chain.unshift(f);
      fid = f.parentId;
    }
    for (const f of chain) crumbs.push({ id: f.id, name: f.name });
    return crumbs;
  }, [currentFolderId, mediaFolders]);

  const visibleAssets = useMemo(() => {
    let result = assets.filter((a) => {
      if (a.metadata?.pendingMusic || a.metadata?.pendingFillGap || a.metadata?.pendingExtend || a.metadata?.generating) return false;
      if (currentFolderId) return a.folderId === currentFolderId;
      return !a.folderId;
    });
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => a.name.toLowerCase().includes(q));
    }
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return result;
  }, [assets, currentFolderId, searchQuery, sortBy]);

  // Child folders of current location
  const visibleFolders = useMemo(() => {
    return mediaFolders.filter((f) => (f.parentId ?? null) === (currentFolderId ?? null));
  }, [mediaFolders, currentFolderId]);

  // Grid size from zoom slider
  const baseThumbSize = 70;
  const thumbSize = Math.round(baseThumbSize * thumbScale);
  const gridMinWidth = `${thumbSize}px`;

  // --- Actions ---
  const handleCreateFolder = useCallback(() => {
    const folder: MediaFolder = {
      id: generateId(),
      name: 'New Folder',
      parentId: currentFolderId ?? undefined,
      createdAt: new Date().toISOString(),
    };
    onAddFolder(folder);
    setRenamingId(folder.id);
    setRenameValue('New Folder');
    setTimeout(() => renameInputRef.current?.select(), 50);
  }, [onAddFolder, currentFolderId]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    onRemoveFolder(folderId);
    if (currentFolderId === folderId) setCurrentFolderId(null);
  }, [onRemoveFolder, currentFolderId]);

  const handleImport = useCallback(async () => {
    if (!projectId || !onAddAsset) return;

    const result = await window.electronAPI.dialog.showOpen({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mxf', 'm4v', 'wav', 'mp3', 'aac', 'flac', 'ogg', 'm4a', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'] },
        { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mxf', 'm4v'] },
        { name: 'Audio', extensions: ['wav', 'mp3', 'aac', 'flac', 'ogg', 'm4a'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'] },
      ],
    });

    if (!result) return;

    const filePaths = Array.isArray(result) ? result : [result];
    if (filePaths.length === 0) return;

    const autoTranscribeBatchId = `txn-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const defaultTranscriptionEngine = getDefaultTranscriptionEngine();
    const shouldQueueVisualIndexing = getAutoVisualIndexingEnabled() && getAnalyzeVisionOnImportEnabled();
    const backgroundVisionModel = getBackgroundVisionModel();
    const imported = await window.electronAPI.media.import({
      filePaths,
      projectId,
      mode: 'link',
    });

    const autoTranscribeAssetIds: string[] = [];

    for (const entry of imported) {
      const fileName = entry.filePath.split('/').pop() || entry.filePath.split('\\').pop() || 'Untitled';
      const shouldAutoTranscribe = entry.type === 'video' || entry.type === 'audio';
      const shouldAutoVisualIndex = shouldQueueVisualIndexing && (entry.type === 'video' || entry.type === 'image');
      if (shouldAutoTranscribe) autoTranscribeAssetIds.push(entry.assetId);
      const asset: Asset = {
        id: entry.assetId,
        name: fileName,
        type: entry.type,
        url: entry.filePath,
        fileRef: entry.filePath,
        status: 'processing',
        createdAt: new Date().toISOString(),
        metadata: {
          processingJobs: entry.type === 'video'
            ? ['extract_metadata', 'generate_thumbnail', 'compute_waveform', 'generate_filmstrip', 'generate_proxy']
            : entry.type === 'audio'
              ? ['extract_metadata', 'compute_waveform']
              : ['extract_metadata', 'generate_thumbnail'],
          ...(shouldAutoTranscribe
            ? {
              autoTranscribe: true,
              transcriptionBatchId: autoTranscribeBatchId,
              transcriptionEngine: defaultTranscriptionEngine,
              transcriptionStatus: 'queued' as const,
              transcriptionError: undefined,
            }
            : {}),
          ...(shouldAutoVisualIndex
            ? {
              llmVisualSummaryStatus: 'queued' as const,
              llmVisualSummaryModel: backgroundVisionModel,
              llmIndexVersion: 1,
            }
            : {}),
        },
        folderId: currentFolderId ?? undefined,
      };
      onAddAsset(asset);
    }

    if (autoTranscribeAssetIds.length > 0) {
      transcriptionBatchAssetIdsRef.current.set(autoTranscribeBatchId, autoTranscribeAssetIds);
    }
  }, [projectId, currentFolderId, onAddAsset]);

  const commitRename = useCallback(() => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    if (mediaFolders.some((f) => f.id === renamingId)) {
      onRenameFolder(renamingId, renameValue.trim());
    } else {
      onUpdateAsset({ id: renamingId, name: renameValue.trim() });
    }
    setRenamingId(null);
  }, [renamingId, renameValue, mediaFolders, onRenameFolder, onUpdateAsset]);

  const handleAssetClick = useCallback((assetId: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedAssetRef.current) {
      // Range select from last-clicked to current
      const lastIdx = visibleAssets.findIndex((a) => a.id === lastClickedAssetRef.current);
      const curIdx = visibleAssets.findIndex((a) => a.id === assetId);
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        const rangeIds = visibleAssets.slice(start, end + 1).map((a) => a.id);
        if (e.metaKey || e.ctrlKey) {
          // Additive range: add to existing selection
          setSelectedAssets((prev) => {
            const next = new Set(prev);
            for (const id of rangeIds) next.add(id);
            return next;
          });
        } else {
          setSelectedAssets(new Set(rangeIds));
        }
      }
      // Don't update lastClickedAssetRef on shift-click to allow extending ranges
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedAssets((prev) => {
        const next = new Set(prev);
        if (next.has(assetId)) next.delete(assetId);
        else next.add(assetId);
        return next;
      });
      lastClickedAssetRef.current = assetId;
    } else {
      setSelectedAssets(new Set([assetId]));
      lastClickedAssetRef.current = assetId;
    }
  }, [visibleAssets]);

  // --- Marquee drag selection ---
  const hitTestMarquee = useCallback((rect: { left: number; top: number; right: number; bottom: number }) => {
    if (!contentRef.current) return new Set<string>();
    const hits = new Set<string>();
    const items = contentRef.current.querySelectorAll('[data-asset-id]');
    items.forEach((el) => {
      const elRect = el.getBoundingClientRect();
      const contRect = contentRef.current!.getBoundingClientRect();
      // Convert element rect to content-relative coordinates
      const elLeft = elRect.left - contRect.left + contentRef.current!.scrollLeft;
      const elTop = elRect.top - contRect.top + contentRef.current!.scrollTop;
      const elRight = elLeft + elRect.width;
      const elBottom = elTop + elRect.height;
      // Check intersection
      if (elRight > rect.left && elLeft < rect.right && elBottom > rect.top && elTop < rect.bottom) {
        const id = el.getAttribute('data-asset-id');
        if (id) hits.add(id);
      }
    });
    return hits;
  }, []);

  const handleMarqueeDown = useCallback((e: React.MouseEvent) => {
    // Only start marquee on left button, on empty space (not on an asset/folder)
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-asset-id]') || target.closest('.mp__folder-tile') || target.closest('.mp__folder-row')) return;
    if (target.closest('input') || target.closest('button')) return;

    const contRect = contentRef.current!.getBoundingClientRect();
    const x = e.clientX - contRect.left + contentRef.current!.scrollLeft;
    const y = e.clientY - contRect.top + contentRef.current!.scrollTop;
    marqueeRef.current = {
      startX: x,
      startY: y,
      scrollTop: contentRef.current!.scrollTop,
      preSelected: e.metaKey || e.ctrlKey ? new Set(selectedAssets) : new Set(),
    };
    setMarquee({ startX: x, startY: y, x, y });

    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) {
      setSelectedAssets(new Set());
    }
  }, [selectedAssets]);

  const marqueeActive = marquee !== null;
  useEffect(() => {
    if (!marqueeActive) return;

    const handleMove = (e: MouseEvent) => {
      if (!marqueeRef.current || !contentRef.current) return;
      const contRect = contentRef.current.getBoundingClientRect();
      const x = e.clientX - contRect.left + contentRef.current.scrollLeft;
      const y = e.clientY - contRect.top + contentRef.current.scrollTop;
      const { startX, startY } = marqueeRef.current;

      setMarquee({ startX, startY, x, y });

      // Hit-test
      const rect = {
        left: Math.min(startX, x),
        top: Math.min(startY, y),
        right: Math.max(startX, x),
        bottom: Math.max(startY, y),
      };
      const hits = hitTestMarquee(rect);
      const pre = marqueeRef.current.preSelected;
      // Merge: pre-selected + hits (Cmd/Ctrl additive)
      const merged = new Set(pre);
      for (const id of hits) merged.add(id);
      setSelectedAssets(merged);
    };

    const handleUp = () => {
      marqueeRef.current = null;
      setMarquee(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [marqueeActive, hitTestMarquee]);

  const handleMoveToFolder = useCallback((assetId: string, folderId: string | undefined) => {
    onUpdateAsset({ id: assetId, folderId });
  }, [onUpdateAsset]);

  const deleteAssetIds = useCallback((assetIds: string[]) => {
    if (assetIds.length === 0) return;
    if (onRemoveAssets) onRemoveAssets(assetIds);
    else for (const id of assetIds) onRemoveAsset(id);
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      for (const id of assetIds) next.delete(id);
      return next;
    });
  }, [onRemoveAsset, onRemoveAssets]);

  const requestDeleteTimelines = useCallback((ids: string[]) => {
    if (ids.length === 0 || timelines.length <= ids.length) return;
    const names = ids.map((id) => timelines.find((tl) => tl.id === id)?.name ?? 'Untitled');
    setDeleteTimelineConfirm({ ids, names });
  }, [timelines]);

  const confirmDeleteTimelines = useCallback(() => {
    if (!deleteTimelineConfirm) return;
    for (const id of deleteTimelineConfirm.ids) onDeleteTimeline?.(id);
    setDeleteTimelineConfirm(null);
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      for (const id of deleteTimelineConfirm.ids) next.delete(id);
      return next;
    });
  }, [deleteTimelineConfirm, onDeleteTimeline]);

  const handleDeleteSelected = useCallback(() => {
    const assetIds: string[] = [];
    const timelineIds: string[] = [];
    const timelineIdSet = new Set(timelines.map((tl) => tl.id));

    for (const id of selectedAssets) {
      if (timelineIdSet.has(id)) {
        timelineIds.push(id);
      } else {
        assetIds.push(id);
      }
    }

    if (assetIds.length > 0) deleteAssetIds(assetIds);
    if (timelineIds.length > 0 && timelines.length > timelineIds.length) {
      requestDeleteTimelines(timelineIds);
    }
  }, [deleteAssetIds, selectedAssets, timelines, requestDeleteTimelines]);

  // Alias for backward compat with the delete button
  const handleDeleteSelectedAssets = handleDeleteSelected;

  // Delete key handler for media pool
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (selectedAssets.size === 0) return;
      e.preventDefault();
      handleDeleteSelected();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedAssets, handleDeleteSelected]);

  // --- Transcription ---
  const handleTranscribe = useCallback(async (assetIds: string[], engine: TranscriptionEngine) => {
    if (!projectId) return;
    const targets = assets.filter((a) => assetIds.includes(a.id) && (a.type === 'video' || a.type === 'audio') && a.fileRef);
    if (targets.length === 0) return;
    const apiKey = engine === 'whisper-cloud' ? getApiKey() : undefined;
    if (engine === 'whisper-cloud' && !apiKey) {
      window.alert('Add your fal.ai API key in Settings before using Whisper Cloud.');
      return;
    }
    const pendingIds = new Set(targets.map((asset) => asset.id));

    setTranscribingIds((prev) => {
      const next = new Set(prev);
      targets.forEach((a) => next.add(a.id));
      return next;
    });

    for (const asset of targets) {
      const existingMeta = (asset.metadata ?? {}) as Record<string, unknown>;
      onUpdateAsset({
        id: asset.id,
        metadata: {
          ...existingMeta,
          transcriptionStatus: 'queued',
          transcriptionError: undefined,
          transcriptionEngine: engine,
        },
      });
    }

    const unsub = window.electronAPI.transcription.onProgress((data) => {
      const assetId = data.assetId
        ?? targets.find((a) => (a.metadata as Record<string, unknown> | undefined)?.transcriptionJobId === data.jobId)?.id
        ?? targets.find((_, i) => i === 0)?.id;
      if (!assetId || !pendingIds.has(assetId)) return;

      if (data.type === 'status' || data.type === 'progress') {
        const asset = assets.find((a) => a.id === assetId);
        if (asset) {
          const existingMeta = (asset.metadata ?? {}) as Record<string, unknown>;
          onUpdateAsset({
            id: assetId,
            metadata: {
              ...existingMeta,
              transcriptionJobId: data.jobId,
              transcriptionStatus: 'transcribing',
              transcriptionEngine: data.engine ?? engine,
              transcriptionStage: data.message ?? data.stage,
              transcriptionError: undefined,
            },
          });
        }
      }

      if (data.type === 'done' || data.type === 'error') {
        if (assetId && data.type === 'done') {
          const asset = assets.find((a) => a.id === assetId);
          if (asset) {
            const existingMeta = (asset.metadata ?? {}) as Record<string, unknown>;
            onUpdateAsset({
              id: assetId,
              metadata: {
                ...existingMeta,
                transcription: {
                  text: data.text,
                  segments: data.segments,
                  language: data.language,
                  engine: data.engine ?? engine,
                  processedAt: new Date().toISOString(),
                },
                transcriptionJobId: undefined,
                transcriptionStatus: 'ready',
                transcriptionStage: undefined,
                transcriptionError: undefined,
                transcriptionBatchId: undefined,
              },
            });
          }
        } else if (assetId && data.type === 'error') {
          const asset = assets.find((a) => a.id === assetId);
          if (asset) {
            const existingMeta = (asset.metadata ?? {}) as Record<string, unknown>;
            onUpdateAsset({
              id: assetId,
              metadata: {
                ...existingMeta,
                transcriptionJobId: undefined,
                transcriptionStatus: 'failed',
                transcriptionStage: undefined,
                transcriptionError: data.error,
                transcriptionBatchId: undefined,
              },
            });
          }
        }

        setTranscribingIds((prev) => {
          const next = new Set(prev);
          next.delete(assetId);
          return next;
        });
        pendingIds.delete(assetId);
        if (pendingIds.size === 0) unsub();
      }
    });

    try {
      for (const asset of targets) {
        const { jobId } = await window.electronAPI.transcription.start({
          projectId,
          assetId: asset.id,
          filePath: asset.fileRef!,
          model: 'large',
          engine,
          apiKey,
        });
        // Store jobId in metadata so we can match progress events
        onUpdateAsset({
          id: asset.id,
          metadata: {
            ...((asset.metadata ?? {}) as Record<string, unknown>),
            transcriptionJobId: jobId,
            transcriptionStatus: 'transcribing',
            transcriptionStage: 'Starting transcription',
            transcriptionError: undefined,
            transcriptionEngine: engine,
          },
        });
      }
    } catch (error) {
      unsub();
      setTranscribingIds((prev) => {
        const next = new Set(prev);
        targets.forEach((asset) => next.delete(asset.id));
        return next;
      });
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Transcription failed to start: ${message}`);
    }
  }, [projectId, assets, onUpdateAsset]);

  useEffect(() => {
    if (!projectId) return;

    const queuedByEngine = new Map<TranscriptionEngine, string[]>();
    for (const asset of assets) {
      if ((asset.type !== 'video' && asset.type !== 'audio') || !asset.fileRef) continue;
      if (transcribingIds.has(asset.id)) continue;

      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      if (!metadata.autoTranscribe) continue;
      if (metadata.transcriptionJobId) continue;

      const transcriptState = getAssetTranscriptionState(asset);
      if (transcriptState.status !== 'queued') continue;

      const engine = (
        metadata.transcriptionEngine === 'faster-whisper-local'
        || metadata.transcriptionEngine === 'whisperx-local'
        || metadata.transcriptionEngine === 'whisper-cloud'
      )
        ? metadata.transcriptionEngine
        : getDefaultTranscriptionEngine();

      const existing = queuedByEngine.get(engine) ?? [];
      existing.push(asset.id);
      queuedByEngine.set(engine, existing);
    }

    for (const [engine, ids] of queuedByEngine.entries()) {
      if (ids.length === 0) continue;
      void handleTranscribe(ids, engine);
    }
  }, [assets, handleTranscribe, projectId, transcribingIds]);

  useEffect(() => {
    for (const [batchId, assetIds] of transcriptionBatchAssetIdsRef.current.entries()) {
      const batchAssets = assetIds
        .map((id) => assets.find((asset) => asset.id === id))
        .filter((asset): asset is Asset => Boolean(asset));

      if (batchAssets.length !== assetIds.length) continue;

      const statuses = batchAssets.map((asset) => getAssetTranscriptionState(asset));
      const isSettled = statuses.every((state) => state.status === 'ready' || state.status === 'failed');
      if (!isSettled) continue;

      transcriptionBatchAssetIdsRef.current.delete(batchId);
      const failed = batchAssets
        .map((asset) => ({
          id: asset.id,
          name: asset.name,
          error: getAssetTranscriptionState(asset).error,
          status: getAssetTranscriptionState(asset).status,
        }))
        .filter((entry) => entry.status === 'failed')
        .map(({ id, name, error }) => ({ id, name, error }));

      if (failed.length > 0) {
        setTranscriptionFailureModal({ failed });
      }
    }
  }, [assets]);

  // --- Context Menu ---
  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'asset' | 'folder' | 'bg' | 'timeline', id?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id });
  }, []);

  useEffect(() => {
    if (!transcriptionHasWordTimestamps && transcriptionViewMode === 'words') {
      setTranscriptionViewMode('segments');
    }
  }, [transcriptionHasWordTimestamps, transcriptionViewMode]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleBatchSync = useCallback(() => {
    setContextMenu(null);
    setBatchSyncOpen(true);
  }, []);

  const selectionHasVideoAndAudio = useMemo(() => {
    const selectedList = Array.from(selectedAssets);
    const selectedAssetObjects = selectedList.map((id) => assets.find((a) => a.id === id)).filter(Boolean);
    const hasVideo = selectedAssetObjects.some((a) => a!.type === 'video');
    const hasAudio = selectedAssetObjects.some((a) => a!.type === 'audio');
    return hasVideo && hasAudio;
  }, [selectedAssets, assets]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handle = () => setContextMenu(null);
    window.addEventListener('click', handle);
    return () => window.removeEventListener('click', handle);
  }, [contextMenu]);

  // Close sort dropdown on click outside
  useEffect(() => {
    if (!sortOpen) return;
    const handle = (e: MouseEvent) => {
      if (sortBtnRef.current?.contains(e.target as Node)) return;
      setSortOpen(false);
    };
    window.addEventListener('click', handle);
    return () => window.removeEventListener('click', handle);
  }, [sortOpen]);

  // --- Folder drag-drop (with counter to prevent flicker) ---
  const handleFolderDragEnter = useCallback((e: React.DragEvent, folderId: string) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    e.preventDefault();
    folderDragCounter.current[folderId] = (folderDragCounter.current[folderId] || 0) + 1;
    setDragOverFolderId(folderId);
  }, []);

  const handleFolderDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleFolderDragLeave = useCallback((_e: React.DragEvent, folderId: string) => {
    folderDragCounter.current[folderId] = (folderDragCounter.current[folderId] || 1) - 1;
    if (folderDragCounter.current[folderId] <= 0) {
      folderDragCounter.current[folderId] = 0;
      setDragOverFolderId((prev) => prev === folderId ? null : prev);
    }
  }, []);

  const handleFolderDrop = useCallback((e: React.DragEvent, folderId: string) => {
    folderDragCounter.current[folderId] = 0;
    setDragOverFolderId(null);
    const idsRaw = e.dataTransfer.getData('application/x-asset-ids');
    const assetId = e.dataTransfer.getData('application/x-asset-id');
    if (idsRaw || assetId) {
      e.preventDefault();
      e.stopPropagation();
      const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [assetId];
      for (const id of ids) handleMoveToFolder(id, folderId);
    }
  }, [handleMoveToFolder]);

  // Drop on content background when inside a folder = move asset back to root
  const handleBgDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-asset-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleBgDrop = useCallback((e: React.DragEvent) => {
    // Don't move assets on background drop — too easy to trigger accidentally
    // (e.g. cancelled timeline drags). Use context menu "Move to Root" instead.
    e.preventDefault();
  }, []);

  // --- Breadcrumb drag-drop ---
  const handleCrumbDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleCrumbDragEnter = useCallback((e: React.DragEvent, crumbId: string | null) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    e.preventDefault();
    setDragOverCrumbId(crumbId);
  }, []);

  const handleCrumbDragLeave = useCallback(() => {
    setDragOverCrumbId(null);
  }, []);

  const handleCrumbDrop = useCallback((e: React.DragEvent, crumbId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCrumbId(null);
    // Don't allow dropping on current folder (no-op)
    if (crumbId === currentFolderId) return;
    const idsRaw = e.dataTransfer.getData('application/x-asset-ids');
    const assetId = e.dataTransfer.getData('application/x-asset-id');
    if (idsRaw || assetId) {
      const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [assetId];
      for (const id of ids) handleMoveToFolder(id, crumbId ?? undefined);
    }
  }, [currentFolderId, handleMoveToFolder]);

  const folderAssetCount = useCallback((folderId: string) => {
    // Recursive count: direct assets + all assets in sub-folders
    const childFolderIds = new Set<string>();
    const collect = (parentId: string) => {
      childFolderIds.add(parentId);
      for (const f of mediaFolders) {
        if (f.parentId === parentId && !childFolderIds.has(f.id)) collect(f.id);
      }
    };
    collect(folderId);
    return assets.filter((a) => a.folderId && childFolderIds.has(a.folderId)).length;
  }, [assets, mediaFolders]);

  // --- Render helpers ---
  const typeIcons: Record<string, string> = { video: '\u25B6', audio: '\u266B', image: '\u{1F5BC}' };

  const renderAssetGrid = (asset: Asset) => {
    const transcriptState = getAssetTranscriptionState(asset);
    const visualState = getAssetVisualIndexState(asset);
    return (
      <div
        key={asset.id}
        className={`mp__asset-item ${selectedAssets.has(asset.id) ? 'mp__asset-item--selected' : ''}`}
        data-asset-id={asset.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-asset-id', asset.id);
          const dragIds = selectedAssets.has(asset.id) && selectedAssets.size > 1
            ? JSON.stringify([...selectedAssets])
            : JSON.stringify([asset.id]);
          e.dataTransfer.setData('application/x-asset-ids', dragIds);
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.dropEffect = 'move';
          // Hide the default browser drag ghost
          const ghost = document.createElement('div');
          ghost.style.width = '1px';
          ghost.style.height = '1px';
          ghost.style.opacity = '0';
          ghost.style.position = 'fixed';
          ghost.style.top = '-9999px';
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 0, 0);
          requestAnimationFrame(() => ghost.remove());
          onDragAsset(asset);
        }}
        onClick={(e) => handleAssetClick(asset.id, e)}
        onDoubleClick={() => onAssetDoubleClick?.(asset)}
        onContextMenu={(e) => handleContextMenu(e, 'asset', asset.id)}
        title={asset.name}
      >
        <div className="mp__asset-thumb-wrap">
          {asset.thumbnailUrl ? (
            <img src={toFileUrl(asset.thumbnailUrl)} alt={asset.name} className="mp__asset-thumb" draggable={false} />
          ) : (
            <div className={`mp__asset-placeholder mp__asset-placeholder--${asset.type}`}>
              {typeIcons[asset.type] || '?'}
            </div>
          )}
          {asset.type === 'video' && asset.duration != null && (
            <span className="mp__asset-duration">{formatDuration(asset.duration)}</span>
          )}
          {isAssetProcessing(asset) && (
            <div className="mp__asset-processing" title="Processing media...">
              <span className="mp__asset-processing-dot" />
              <span className="mp__asset-processing-label">Processing</span>
            </div>
          )}
          <div className="mp__asset-type-badge">{asset.type.charAt(0).toUpperCase()}</div>
          {asset.status === 'offline' && (
            <div className="mp__asset-offline" title="File not found — source file has been moved or deleted">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
          )}
          {transcriptState.status && (
            <div
              className={`mp__asset-transcript-badge mp__asset-transcript-badge--${transcriptState.status}`}
              title={transcriptState.error ? `${transcriptState.label}: ${transcriptState.error}` : transcriptState.label}
            >
              {transcriptState.label}
            </div>
          )}
          {visualState.status && (
            <div
              className={`mp__asset-vision-badge mp__asset-vision-badge--${visualState.status}`}
              title={visualState.error ? `${visualState.label}: ${visualState.error}` : visualState.label}
            >
              {visualState.label}
            </div>
          )}
        </div>
        {renamingId === asset.id ? (
          <input
            ref={renameInputRef}
            className="mp__rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="mp__asset-name">{asset.name}</span>
        )}
      </div>
    );
  };

  const renderAssetList = (asset: Asset) => {
    const transcriptState = getAssetTranscriptionState(asset);
    const visualState = getAssetVisualIndexState(asset);
    return (
      <div
        key={asset.id}
        className={`mp__asset-row ${selectedAssets.has(asset.id) ? 'mp__asset-row--selected' : ''}`}
        data-asset-id={asset.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-asset-id', asset.id);
          const dragIds = selectedAssets.has(asset.id) && selectedAssets.size > 1
            ? JSON.stringify([...selectedAssets])
            : JSON.stringify([asset.id]);
          e.dataTransfer.setData('application/x-asset-ids', dragIds);
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.dropEffect = 'move';
          const ghost = document.createElement('div');
          ghost.style.width = '1px';
          ghost.style.height = '1px';
          ghost.style.opacity = '0';
          ghost.style.position = 'fixed';
          ghost.style.top = '-9999px';
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 0, 0);
          requestAnimationFrame(() => ghost.remove());
          onDragAsset(asset);
        }}
        onClick={(e) => handleAssetClick(asset.id, e)}
        onDoubleClick={() => onAssetDoubleClick?.(asset)}
        onContextMenu={(e) => handleContextMenu(e, 'asset', asset.id)}
        title={asset.name}
      >
        <div className="mp__asset-row-thumb">
          {asset.thumbnailUrl ? (
            <img src={toFileUrl(asset.thumbnailUrl)} alt={asset.name} draggable={false} />
          ) : (
            <span className={`mp__row-placeholder mp__row-placeholder--${asset.type}`}>
              {typeIcons[asset.type] || '?'}
            </span>
          )}
          {asset.status === 'offline' && (
            <div className="mp__asset-offline" title="File not found — source file has been moved or deleted">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
          )}
          {isAssetProcessing(asset) && (
            <div className="mp__asset-processing mp__asset-processing--row" title="Processing media...">
              <span className="mp__asset-processing-dot" />
            </div>
          )}
        </div>
        <div className="mp__asset-row-info">
          {renamingId === asset.id ? (
            <input
              ref={renameInputRef}
              className="mp__rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="mp__asset-row-name">{asset.name}</span>
          )}
          <span className="mp__asset-row-meta">
            {asset.type}
            {asset.duration ? ` \u00B7 ${formatDuration(asset.duration)}` : ''}
            {asset.createdAt ? ` \u00B7 ${formatDate(asset.createdAt)}` : ''}
            {transcriptState.label ? ` \u00B7 ${transcriptState.label}` : ''}
            {visualState.label ? ` \u00B7 ${visualState.label}` : ''}
          </span>
        </div>
      </div>
    );
  };

  const renderFolderGrid = (folder: MediaFolder) => {
    const count = folderAssetCount(folder.id);
    const isDragOver = dragOverFolderId === folder.id;
    return (
      <div
        key={folder.id}
        className={`mp__folder-tile ${isDragOver ? 'mp__folder-tile--drag-over' : ''}`}
        onClick={() => { if (renamingId !== folder.id) setCurrentFolderId(folder.id); }}
        onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
        onDragEnter={(e) => handleFolderDragEnter(e, folder.id)}
        onDragOver={handleFolderDragOver}
        onDragLeave={(e) => handleFolderDragLeave(e, folder.id)}
        onDrop={(e) => handleFolderDrop(e, folder.id)}
      >
        <div className="mp__folder-tile-icon">
          <FolderIcon />
        </div>
        {renamingId === folder.id ? (
          <input
            ref={renameInputRef}
            className="mp__rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="mp__folder-tile-name">{folder.name}</span>
        )}
        <span className="mp__folder-tile-count">{count} item{count !== 1 ? 's' : ''}</span>
      </div>
    );
  };

  const renderFolderList = (folder: MediaFolder) => {
    const count = folderAssetCount(folder.id);
    const isDragOver = dragOverFolderId === folder.id;
    return (
      <div
        key={folder.id}
        className={`mp__folder-row ${isDragOver ? 'mp__folder-row--drag-over' : ''}`}
        onClick={() => { if (renamingId !== folder.id) setCurrentFolderId(folder.id); }}
        onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
        onDragEnter={(e) => handleFolderDragEnter(e, folder.id)}
        onDragOver={handleFolderDragOver}
        onDragLeave={(e) => handleFolderDragLeave(e, folder.id)}
        onDrop={(e) => handleFolderDrop(e, folder.id)}
      >
        <FolderIcon />
        {renamingId === folder.id ? (
          <input
            ref={renameInputRef}
            className="mp__rename-input mp__rename-input--folder"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="mp__folder-name">{folder.name}</span>
        )}
        <span className="mp__folder-count">{count}</span>
      </div>
    );
  };

  // --- Timeline render helpers ---
  const renderTimelineGrid = (tl: Timeline) => {
    const clipCount = tl.clips.length;
    const isActive = tl.id === activeTimelineId;
    const isSelected = selectedAssets.has(tl.id);
    return (
      <div
        key={tl.id}
        className={`mp__timeline-item ${isActive ? 'mp__timeline-item--active' : ''}${isSelected ? ' mp__asset-item--selected' : ''}`}
        title={tl.name}
        onClick={(e) => handleAssetClick(tl.id, e)}
        onDoubleClick={(e) => { e.stopPropagation(); onSwitchTimeline(tl.id); }}
        onContextMenu={(e) => handleContextMenu(e, 'timeline', tl.id)}
      >
        <div className="mp__asset-thumb-wrap">
          <div className="mp__timeline-placeholder">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="4" rx="1" />
              <rect x="2" y="13" width="20" height="4" rx="1" />
              <line x1="6" y1="7" x2="6" y2="11" /><line x1="10" y1="7" x2="10" y2="11" />
              <line x1="8" y1="13" x2="8" y2="17" /><line x1="14" y1="13" x2="14" y2="17" />
            </svg>
          </div>
          <div className="mp__asset-type-badge">TL</div>
        </div>
        <span className="mp__asset-name">{tl.name}</span>
        <span className="mp__timeline-clip-count">{clipCount} clip{clipCount !== 1 ? 's' : ''}</span>
      </div>
    );
  };

  const renderTimelineList = (tl: Timeline) => {
    const clipCount = tl.clips.length;
    const isActive = tl.id === activeTimelineId;
    const isSelected = selectedAssets.has(tl.id);
    return (
      <div
        key={tl.id}
        className={`mp__asset-row mp__timeline-row ${isActive ? 'mp__timeline-row--active' : ''}${isSelected ? ' mp__asset-row--selected' : ''}`}
        title={tl.name}
        onClick={(e) => handleAssetClick(tl.id, e)}
        onDoubleClick={(e) => { e.stopPropagation(); onSwitchTimeline(tl.id); }}
        onContextMenu={(e) => handleContextMenu(e, 'timeline', tl.id)}
      >
        <div className="mp__asset-row-thumb mp__timeline-row-thumb">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="4" rx="1" />
            <rect x="2" y="13" width="20" height="4" rx="1" />
            <line x1="6" y1="7" x2="6" y2="11" /><line x1="10" y1="7" x2="10" y2="11" />
            <line x1="8" y1="13" x2="8" y2="17" /><line x1="14" y1="13" x2="14" y2="17" />
          </svg>
        </div>
        <div className="mp__asset-row-info">
          <span className="mp__asset-row-name">{tl.name}</span>
          <span className="mp__asset-row-meta">{clipCount} clip{clipCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="left-panel">
      {/* Header / breadcrumb */}
      <div className="mp__header">
        {currentFolderId && (
          <button
            className="mp__back-btn"
            onClick={() => setCurrentFolderId(currentFolder?.parentId ?? null)}
            title="Go up"
          >
            <BackIcon />
          </button>
        )}
        <div className="mp__breadcrumb">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            const isDragOver = dragOverCrumbId === (crumb.id ?? '__root__') || (dragOverCrumbId === null && crumb.id === null && dragOverCrumbId === '__root__');
            const crumbKey = crumb.id ?? '__root__';
            return (
              <span key={crumbKey} className="mp__breadcrumb-segment">
                {i > 0 && <span className="mp__breadcrumb-sep">/</span>}
                {isLast ? (
                  <span
                    className={`mp__breadcrumb-current${dragOverCrumbId === crumbKey ? ' mp__breadcrumb--drag-over' : ''}`}
                    onDragOver={handleCrumbDragOver}
                    onDragEnter={(e) => handleCrumbDragEnter(e, crumbKey)}
                    onDragLeave={handleCrumbDragLeave}
                    onDrop={(e) => handleCrumbDrop(e, crumb.id)}
                  >{crumb.name}</span>
                ) : (
                  <button
                    className={`mp__breadcrumb-link${dragOverCrumbId === crumbKey || isDragOver ? ' mp__breadcrumb--drag-over' : ''}`}
                    onClick={() => setCurrentFolderId(crumb.id)}
                    onDragOver={handleCrumbDragOver}
                    onDragEnter={(e) => handleCrumbDragEnter(e, crumbKey)}
                    onDragLeave={handleCrumbDragLeave}
                    onDrop={(e) => handleCrumbDrop(e, crumb.id)}
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <div className="mp__header-tools">
          <button
            className={`mp__tool-btn ${viewMode === 'grid' ? 'mp__tool-btn--active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >
            <GridIcon />
          </button>
          <button
            className={`mp__tool-btn ${viewMode === 'list' ? 'mp__tool-btn--active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <ListIcon />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mp__search-bar">
        <svg className="mp__search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="mp__search-input"
          placeholder="Search assets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="mp__search-clear" onClick={() => setSearchQuery('')}>&times;</button>
        )}
      </div>

      {/* Content area */}
      <div
        className="mp__content"
        ref={contentRef}
        onContextMenu={(e) => handleContextMenu(e, 'bg')}
        onDragOver={handleBgDragOver}
        onDrop={handleBgDrop}
        onMouseDown={handleMarqueeDown}
        onDoubleClick={(e) => {
          // Only trigger import when double-clicking empty space (not on an asset/folder)
          const target = e.target as HTMLElement;
          if (target.closest('[data-asset-id], [data-folder-id]')) return;
          handleImport();
        }}
      >
        {viewMode === 'grid' ? (
          <div className="mp__grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMinWidth}, 1fr))` }}>
            {/* Timelines first (only at root, not inside folders), then folders, then assets */}
            {!searchQuery && !currentFolderId && timelines.map(renderTimelineGrid)}
            {!searchQuery && visibleFolders.map(renderFolderGrid)}
            {visibleAssets.map(renderAssetGrid)}
          </div>
        ) : (
          <div className="mp__list">
            {!searchQuery && !currentFolderId && timelines.map(renderTimelineList)}
            {!searchQuery && visibleFolders.map(renderFolderList)}
            {visibleAssets.map(renderAssetList)}
          </div>
        )}

        {visibleAssets.length === 0 && visibleFolders.length === 0 && (
          <div className="mp__empty">
            {searchQuery ? 'No results found' : currentFolderId ? 'Drag assets here or go back' : 'No assets imported'}
          </div>
        )}
        {marquee && (() => {
          const left = Math.min(marquee.startX, marquee.x);
          const top = Math.min(marquee.startY, marquee.y);
          const w = Math.abs(marquee.x - marquee.startX);
          const h = Math.abs(marquee.y - marquee.startY);
          return <div className="mp__marquee" style={{ left, top, width: w, height: h }} />;
        })()}
      </div>

      {/* Bottom toolbar */}
      <div className="mp__toolbar">
        <div className="mp__toolbar-left">
          {projectId && onAddAsset && (
            <button className="mp__tool-btn" onClick={handleImport} title="Import media files">
              <ImportIcon />
            </button>
          )}
          <button className="mp__tool-btn" onClick={handleCreateFolder} title="New folder">
            <NewFolderIcon />
          </button>
        </div>
        <div className="mp__toolbar-right">
          <button
            className="mp__tool-btn"
            onClick={handleDeleteSelectedAssets}
            title={selectedAssets.size > 1 ? `Delete ${selectedAssets.size} selected items` : 'Delete selected item'}
            disabled={selectedAssets.size === 0}
          >
            <TrashIcon />
          </button>
          <div className="mp__sort-wrapper">
            <button
              ref={sortBtnRef}
              className="mp__sort-btn"
              onClick={() => setSortOpen((p) => !p)}
              title="Sort by"
            >
              <span className="mp__sort-label">{sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {sortOpen && (
              <div className="mp__sort-dropdown">
                {(['date', 'name', 'type'] as const).map((opt) => (
                  <button
                    key={opt}
                    className={`mp__sort-option ${sortBy === opt ? 'mp__sort-option--active' : ''}`}
                    onClick={() => { setSortBy(opt); setSortOpen(false); }}
                  >
                    {sortBy === opt && (
                      <svg className="mp__sort-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            className="mp__zoom-slider"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={thumbScale}
            onChange={(e) => setThumbScale(Number(e.target.value))}
            onMouseUp={(e) => (e.target as HTMLElement).blur()}
            onKeyDown={(e) => { if (e.key.startsWith('Arrow')) e.preventDefault(); }}
            title="Thumbnail size"
          />
        </div>
      </div>

      {/* Compact/Full toggle */}
      <div className="left-panel__toggle">
        <button className="left-panel__toggle-btn" onClick={onToggleMode} title={panelMode === 'full' ? 'Compact' : 'Full'}>
          {panelMode === 'full' ? (
            <svg width="12" height="12" viewBox="0 0 28.359 28.359" fill="currentColor">
              <path d="M21.935,19.368h3.235c0.878-0.003,1.589-0.67,1.589-1.492c0-0.824-0.711-1.492-1.589-1.492h-6.764c-0.879,0-1.59,0.668-1.591,1.492c0.001,0.019,0.007,0.041,0.007,0.061c0,0.027-0.007,0.057-0.007,0.086v6.673c0,0.864,0.666,1.566,1.49,1.566c0.822-0.002,1.492-0.702,1.492-1.566v-3.252l6.018,6.02c0.582,0.583,1.525,0.583,2.108,0c0.58-0.582,0.58-1.526,0-2.108L21.935,19.368z" />
              <path d="M11.543,17.876c-0.002-0.824-0.712-1.492-1.592-1.492H3.189c-0.877,0-1.593,0.668-1.593,1.492c0,0.822,0.716,1.489,1.593,1.492h3.235l-5.991,5.986c-0.577,0.582-0.577,1.526,0,2.108c0.584,0.583,1.527,0.583,2.108,0l6.019-6.02v3.252c0,0.864,0.67,1.564,1.491,1.566c0.826,0,1.491-0.702,1.491-1.566v-6.673c0-0.029-0.008-0.059-0.008-0.086C11.535,17.917,11.541,17.895,11.543,17.876z" />
              <path d="M16.815,10.479c0.001,0.824,0.712,1.491,1.591,1.491h6.764c0.878,0,1.589-0.667,1.589-1.491c0-0.822-0.711-1.487-1.589-1.489h-3.235l5.989-5.987c0.58-0.584,0.58-1.528,0-2.109c-0.583-0.582-1.526-0.582-2.108,0l-6.018,6.02V3.662c0-0.867-0.67-1.568-1.492-1.568c-0.824,0-1.49,0.701-1.49,1.568v6.671c0,0.03,0.007,0.057,0.007,0.087C16.822,10.44,16.816,10.456,16.815,10.479z" />
              <path d="M10.052,2.094c-0.821,0-1.491,0.701-1.491,1.568v3.251l-6.019-6.02c-0.581-0.582-1.524-0.582-2.108,0c-0.577,0.581-0.577,1.525,0,2.109l5.991,5.987H3.189c-0.876,0.003-1.592,0.668-1.592,1.49c0,0.824,0.716,1.491,1.593,1.491h6.761c0.88,0,1.59-0.667,1.592-1.491c-0.002-0.023-0.008-0.039-0.008-0.06c0-0.03,0.008-0.057,0.008-0.087v-6.67C11.543,2.795,10.878,2.094,10.052,2.094z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 28.361 28.361" fill="currentColor">
              <path d="M28.36,19.595c0-0.868-0.665-1.57-1.491-1.57c-0.819,0.002-1.492,0.702-1.492,1.57v3.25l-6.018-6.021c-0.582-0.583-1.524-0.583-2.106,0c-0.582,0.582-0.582,1.527,0,2.109l5.989,5.987h-3.235c-0.881,0.002-1.591,0.669-1.591,1.491c0,0.824,0.71,1.49,1.591,1.49h6.761c0.881,0,1.59-0.665,1.593-1.49c-0.003-0.022-0.006-0.039-0.009-0.061c0.003-0.028,0.009-0.058,0.009-0.087v-6.668H28.36z" />
              <path d="M9,16.824l-6.015,6.021v-3.25c0-0.868-0.672-1.568-1.493-1.57c-0.824,0-1.49,0.702-1.49,1.57L0,26.264c0,0.029,0.008,0.059,0.01,0.087c-0.002,0.021-0.006,0.038-0.008,0.061c0.002,0.825,0.712,1.49,1.592,1.49h6.762c0.879,0,1.59-0.666,1.59-1.49c0-0.822-0.711-1.489-1.59-1.491H5.121l5.989-5.987c0.58-0.582,0.58-1.527,0-2.109C10.527,16.241,9.584,16.241,9,16.824z" />
              <path d="M19.359,11.535l6.018-6.017v3.25c0,0.865,0.673,1.565,1.492,1.568c0.826,0,1.491-0.703,1.491-1.568V2.097c0-0.029-0.006-0.059-0.009-0.085c0.003-0.021,0.006-0.041,0.009-0.062c-0.003-0.826-0.712-1.491-1.592-1.491h-6.761c-0.881,0-1.591,0.665-1.591,1.491c0,0.821,0.71,1.49,1.591,1.492h3.235l-5.989,5.987c-0.582,0.581-0.582,1.524,0,2.105C17.835,12.12,18.777,12.12,19.359,11.535z" />
              <path d="M5.121,3.442h3.234c0.879-0.002,1.59-0.671,1.59-1.492c0-0.826-0.711-1.491-1.59-1.491H1.594c-0.88,0-1.59,0.665-1.592,1.491C0.004,1.971,0.008,1.991,0.01,2.012C0.008,2.038,0,2.067,0,2.097l0.002,6.672c0,0.865,0.666,1.568,1.49,1.568c0.821-0.003,1.493-0.703,1.493-1.568v-3.25L9,11.535c0.584,0.585,1.527,0.585,2.11,0c0.58-0.581,0.58-1.524,0-2.105L5.121,3.442z" />
            </svg>
          )}
          <span>{panelMode === 'full' ? 'Compact' : 'Full'}</span>
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="mp__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'asset' && contextMenu.id && (
            <>
              <button className="mp__ctx-item" onClick={() => {
                const a = assets.find((a) => a.id === contextMenu.id);
                if (a) onAssetDoubleClick?.(a);
                closeContextMenu();
              }}>Open in Viewer</button>
              {(() => {
                const a = assets.find((x) => x.id === contextMenu.id);
                const txn = (a?.metadata as Record<string, unknown> | undefined)?.transcription as {
                  text?: string;
                  language?: string;
                  engine?: string;
                } | undefined;
                if (!txn?.text) return null;
                return (
                  <button className="mp__ctx-item" onClick={() => {
                    const segs = (txn as { segments?: Array<{ text: string; start: number; end: number; words?: Array<{ word: string; start: number; end: number; prob: number }> }> }).segments ?? [];
                    setTranscriptionModal({
                      assetName: a!.name,
                      text: txn.text!,
                      language: txn.language ?? '',
                      engine: txn.engine
                        ? (TRANSCRIPTION_ENGINE_LABELS[txn.engine as TranscriptionEngine] ?? txn.engine)
                        : undefined,
                      segments: segs,
                    });
                    setTranscriptionViewMode('segments');
                    closeContextMenu();
                  }}>View Transcription</button>
                );
              })()}
              <button className="mp__ctx-item" onClick={() => {
                const a = assets.find((a) => a.id === contextMenu.id);
                if (a) { setRenamingId(a.id); setRenameValue(a.name); }
                closeContextMenu();
              }}>Rename</button>
              {mediaFolders.length > 0 && (
                <div className="mp__ctx-sub">
                  <span className="mp__ctx-label">Move to folder</span>
                  {mediaFolders.map((f) => (
                    <button key={f.id} className="mp__ctx-item mp__ctx-item--indent" onClick={() => {
                      handleMoveToFolder(contextMenu.id!, f.id);
                      closeContextMenu();
                    }}>{f.name}</button>
                  ))}
                </div>
              )}
              {currentFolderId && (
                <button className="mp__ctx-item" onClick={() => {
                  handleMoveToFolder(contextMenu.id!, undefined);
                  closeContextMenu();
                }}>Move to Root</button>
              )}
              {(() => {
                const ctxAsset = assets.find((a) => a.id === contextMenu.id);
                const transcribableIds = selectedAssets.has(contextMenu.id!) && selectedAssets.size > 1
                  ? [...selectedAssets].filter((id) => { const a = assets.find((x) => x.id === id); return a && (a.type === 'video' || a.type === 'audio') && a.fileRef; })
                  : ctxAsset && (ctxAsset.type === 'video' || ctxAsset.type === 'audio') && ctxAsset.fileRef ? [ctxAsset.id] : [];
                if (transcribableIds.length === 0) return null;
                const isRunning = transcribableIds.some((id) => {
                  const asset = assets.find((entry) => entry.id === id);
                  const status = asset ? getAssetTranscriptionState(asset).status : undefined;
                  return status === 'queued' || status === 'transcribing' || transcribingIds.has(id);
                });
                return (
                  <div className="mp__ctx-sub">
                    <span className="mp__ctx-label">
                      {isRunning
                        ? `Transcribing${transcribableIds.length > 1 ? ` (${transcribableIds.length})` : ''}…`
                        : `Transcribe${transcribableIds.length > 1 ? ` (${transcribableIds.length})` : ''}`}
                    </span>
                    {(['faster-whisper-local', 'whisperx-local', 'whisper-cloud'] as TranscriptionEngine[]).map((engine) => (
                      <button
                        key={engine}
                        className="mp__ctx-item mp__ctx-item--indent"
                        disabled={isRunning}
                        onClick={() => {
                          void handleTranscribe(transcribableIds, engine);
                          closeContextMenu();
                        }}
                      >
                        {TRANSCRIPTION_ENGINE_LABELS[engine]}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const ctxAsset = assets.find((a) => a.id === contextMenu.id);
                const visualizableIds = selectedAssets.has(contextMenu.id!) && selectedAssets.size > 1
                  ? [...selectedAssets].filter((id) => {
                      const asset = assets.find((entry) => entry.id === id);
                      return asset && (asset.type === 'video' || asset.type === 'image');
                    })
                  : ctxAsset && (ctxAsset.type === 'video' || ctxAsset.type === 'image')
                    ? [ctxAsset.id]
                    : [];
                if (visualizableIds.length === 0) return null;
                const isRunning = visualizableIds.some((id) => {
                  const asset = assets.find((entry) => entry.id === id);
                  const status = asset ? getAssetVisualIndexState(asset).status : undefined;
                  return status === 'queued' || status === 'analyzing';
                });
                const hasFailures = visualizableIds.some((id) => {
                  const asset = assets.find((entry) => entry.id === id);
                  return asset ? getAssetVisualIndexState(asset).status === 'failed' : false;
                });
                return (
                  <button
                    className="mp__ctx-item"
                    disabled={isRunning}
                    onClick={() => {
                      const model = getBackgroundVisionModel();
                      for (const assetId of visualizableIds) {
                        const asset = assets.find((entry) => entry.id === assetId);
                        if (!asset) continue;
                        onUpdateAsset({
                          id: assetId,
                          metadata: {
                            ...((asset.metadata ?? {}) as Record<string, unknown>),
                            llmVisualSummary: undefined,
                            llmVisualSummaryStatus: 'queued',
                            llmVisualSummaryModel: model,
                            llmIndexVersion: 1,
                          },
                        });
                      }
                      closeContextMenu();
                    }}
                  >
                    {isRunning
                      ? `Visual Analysis Running${visualizableIds.length > 1 ? ` (${visualizableIds.length})` : ''}`
                      : `${hasFailures ? 'Retry' : 'Run'} Visual Analysis${visualizableIds.length > 1 ? ` (${visualizableIds.length})` : ''}`}
                  </button>
                );
              })()}
              {selectionHasVideoAndAudio && selectedAssets.size > 1 && (
                <>
                  <div className="mp__ctx-divider" />
                  <button className="mp__ctx-item" onClick={handleBatchSync}>
                    Create Timeline with Synced Audio
                  </button>
                </>
              )}
              <div className="mp__ctx-divider" />
              <button className="mp__ctx-item mp__ctx-item--danger" onClick={() => {
                const idsToDelete = selectedAssets.has(contextMenu.id!) && selectedAssets.size > 1
                  ? [...selectedAssets]
                  : [contextMenu.id!];
                deleteAssetIds(idsToDelete);
                closeContextMenu();
              }}>
                <TrashIcon /> {selectedAssets.has(contextMenu.id!) && selectedAssets.size > 1
                  ? `Delete ${selectedAssets.size} Items`
                  : 'Delete'}
              </button>
            </>
          )}
          {contextMenu.type === 'folder' && contextMenu.id && (
            <>
              <button className="mp__ctx-item" onClick={() => {
                setCurrentFolderId(contextMenu.id!);
                closeContextMenu();
              }}>Open</button>
              <button className="mp__ctx-item" onClick={() => {
                const f = mediaFolders.find((f) => f.id === contextMenu.id);
                if (f) { setRenamingId(f.id); setRenameValue(f.name); }
                closeContextMenu();
              }}>Rename</button>
              <div className="mp__ctx-divider" />
              <button className="mp__ctx-item mp__ctx-item--danger" onClick={() => {
                handleDeleteFolder(contextMenu.id!);
                closeContextMenu();
              }}>
                <TrashIcon /> Delete Folder
              </button>
            </>
          )}
          {contextMenu.type === 'timeline' && contextMenu.id && (
            <>
              <button className="mp__ctx-item" onClick={() => {
                onSwitchTimeline(contextMenu.id!);
                closeContextMenu();
              }}>Open Timeline</button>
              {timelines.length > 1 && (
                <>
                  <div className="mp__ctx-divider" />
                  <button className="mp__ctx-item mp__ctx-item--danger" onClick={() => {
                    requestDeleteTimelines([contextMenu.id!]);
                    closeContextMenu();
                  }}>
                    <TrashIcon /> Delete Timeline
                  </button>
                </>
              )}
            </>
          )}
          {contextMenu.type === 'bg' && (
            <>
              <button className="mp__ctx-item" onClick={() => { handleCreateFolder(); closeContextMenu(); }}>New Folder</button>
              <div className="mp__ctx-divider" />
              <button className="mp__ctx-item" onClick={() => { setSortBy('name'); closeContextMenu(); }}>Sort by Name</button>
              <button className="mp__ctx-item" onClick={() => { setSortBy('date'); closeContextMenu(); }}>Sort by Date</button>
              <button className="mp__ctx-item" onClick={() => { setSortBy('type'); closeContextMenu(); }}>Sort by Type</button>
            </>
          )}
        </div>
      )}

      {transcriptionFailureModal && (
        <div className="element-modal__backdrop" onClick={() => setTranscriptionFailureModal(null)}>
          <div className="element-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="element-modal__header">
              <span className="element-modal__title">Background Transcription Failed</span>
              <button className="element-modal__close" onClick={() => setTranscriptionFailureModal(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="element-modal__body">
              <p className="sp-card__desc" style={{ margin: 0 }}>
                Some imported assets could not be transcribed with the current default engine. You can retry them from the media pool context menu.
              </p>
              <div className="mp__transcription-failures">
                {transcriptionFailureModal.failed.map((entry) => (
                  <div key={entry.id} className="mp__transcription-failure">
                    <div className="mp__transcription-failure-name">{entry.name}</div>
                    {entry.error && <div className="mp__transcription-failure-error">{entry.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transcription viewer modal */}
      {transcriptionModal && (
        <div className="element-modal__backdrop" onClick={() => setTranscriptionModal(null)}>
          <div className="element-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="element-modal__header">
              <span className="element-modal__title">{transcriptionModal.assetName}</span>
              <button className="element-modal__close" onClick={() => setTranscriptionModal(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
              {(transcriptionModal.language || transcriptionModal.engine || transcriptionModal.segments.length > 0) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {transcriptionModal.engine ? `Engine: ${transcriptionModal.engine}` : 'Transcript'}
                    {transcriptionModal.language ? ` · Language: ${transcriptionModal.language}` : ''}
                    {` · ${transcriptionModal.segments.length} sentences`}
                    {transcriptionHasWordTimestamps ? ` · ${transcriptionModalWords.length} words` : ''}
                  </div>
                  {transcriptionHasWordTimestamps && (
                    <div className="whisperx-transcript__tabs">
                      <button
                        type="button"
                        className={`whisperx-transcript__tab ${transcriptionViewMode === 'segments' ? 'whisperx-transcript__tab--active' : ''}`}
                        onClick={() => setTranscriptionViewMode('segments')}
                      >
                        Sentences
                      </button>
                      <button
                        type="button"
                        className={`whisperx-transcript__tab ${transcriptionViewMode === 'words' ? 'whisperx-transcript__tab--active' : ''}`}
                        onClick={() => setTranscriptionViewMode('words')}
                      >
                        Words
                      </button>
                    </div>
                  )}
                </div>
              )}
              {transcriptionViewMode === 'words' && transcriptionHasWordTimestamps ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {transcriptionModalWords.map((word, i) => (
                    <div key={`${word.start}-${word.end}-${i}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', paddingTop: 2, minWidth: 100 }}>
                        {formatTranscriptTimestamp(word.start)}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{word.word}</span>
                    </div>
                  ))}
                </div>
              ) : transcriptionModal.segments.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {transcriptionModal.segments.map((seg, i) => (
                    <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', paddingTop: 2, minWidth: 100 }}>
                          {formatTranscriptTimestamp(seg.start)} → {formatTranscriptTimestamp(seg.end)}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{seg.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {transcriptionModal.text}
                </p>
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn btn--secondary"
                onClick={() => { void navigator.clipboard.writeText(transcriptionModal.text); }}
              >
                Copy Text
              </button>
              <button className="btn btn--primary" onClick={() => setTranscriptionModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete timeline confirmation */}
      {deleteTimelineConfirm && (
        <div className="mp-confirm__backdrop" onClick={() => setDeleteTimelineConfirm(null)}>
          <div className="mp-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="mp-confirm__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h3 className="mp-confirm__title">
              {deleteTimelineConfirm.ids.length === 1
                ? 'Delete Timeline'
                : `Delete ${deleteTimelineConfirm.ids.length} Timelines`}
            </h3>
            <p className="mp-confirm__desc">
              {deleteTimelineConfirm.ids.length === 1
                ? <><strong>{deleteTimelineConfirm.names[0]}</strong> and all its clips will be permanently removed.</>
                : <>All clips across these timelines will be permanently removed.</>}
            </p>
            <div className="mp-confirm__actions">
              <button className="mp-confirm__btn mp-confirm__btn--cancel" onClick={() => setDeleteTimelineConfirm(null)}>
                Cancel
              </button>
              <button className="mp-confirm__btn mp-confirm__btn--delete" onClick={confirmDeleteTimelines}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {batchSyncOpen && (
        <BatchSyncDialog
          open={batchSyncOpen}
          onClose={() => setBatchSyncOpen(false)}
          onCreateTimeline={(params) => {
            const pairsWithAssets = params.pairs.map((p) => ({
              videoAsset: {
                id: p.videoAssetId,
                name: assets.find((a) => a.id === p.videoAssetId)?.name ?? '',
                duration: assets.find((a) => a.id === p.videoAssetId)?.duration ?? 0,
              },
              audioAsset: {
                id: p.audioAssetId,
                name: assets.find((a) => a.id === p.audioAssetId)?.name ?? '',
                duration: assets.find((a) => a.id === p.audioAssetId)?.duration ?? 0,
              },
              offsetSeconds: p.offsetSeconds,
            }));

            const unmatchedVideoAssets = params.unmatchedVideos.map((id) => {
              const a = assets.find((x) => x.id === id);
              return { id, name: a?.name ?? '', duration: a?.duration ?? 0 };
            });
            const unmatchedAudioAssets = params.unmatchedAudio.map((id) => {
              const a = assets.find((x) => x.id === id);
              return { id, name: a?.name ?? '', duration: a?.duration ?? 0 };
            });

            const newTimeline = createSyncedTimeline(
              params.name,
              pairsWithAssets,
              params.scratchMode,
              unmatchedVideoAssets,
              unmatchedAudioAssets,
            );
            onAddTimeline?.(newTimeline);
            setBatchSyncOpen(false);
          }}
          selectedAssets={selectedAssets}
          assets={assets}
          projectId={projectId ?? ''}
        />
      )}
    </div>
  );
}
