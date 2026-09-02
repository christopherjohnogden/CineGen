

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, useReactFlow, useUpdateNodeInternals, type Node } from '@xyflow/react';
import { ALL_MODELS } from '@/lib/fal/models';
import { CATEGORY_COLORS, PORT_COLORS } from '@/lib/workflows/node-registry';
import { useRunNode } from '@/components/create/workflow-canvas';
import { useWorkspace, getActiveTimeline } from '@/components/workspace/workspace-shell';
import { extractWaveformPeaks } from '@/lib/editor/waveform';
import { ImageCompare } from '@/components/create/image-compare';
import { Sam3Modal } from '@/components/create/sam3-modal';
import { Sam3CloudModal } from '@/components/create/sam3-cloud-modal';
import { FullscreenModal } from '@/components/create/fullscreen-modal';
import { VideoNodePreview } from '@/components/create/nodes/video-node-preview';
import { addClipToTrack } from '@/lib/editor/timeline-operations';
import { clipEffectiveDuration } from '@/types/timeline';
import { generateId, timestamp } from '@/lib/utils/ids';
import { getLayerDecomposeStageLabel } from '@/lib/workflows/layer-decompose';
import { modelProvider, modelProviderLabel } from '@/lib/workflows/provider-model-options';
import type { TranscriptSegment, TranscriptWord, WorkflowNodeData } from '@/types/workflow';
import type { Asset } from '@/types/project';

type ModelNodeProps = NodeProps & { data: WorkflowNodeData };

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const HEADER_HEIGHT = 40;
const PORT_SPACING = 28;
const DEFAULT_MEDIA_NODE_WIDTH = 300;
const DEFAULT_MEDIA_NODE_HEIGHT = 168.75;

function positiveDimension(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

interface PortEntry {
  handleId: string;
  portType: string;
  label: string;
  required: boolean;
  /** Value lives in this node's config, so the port needs no incoming edge. */
  suppliedByConfig?: boolean;
}

interface GenerationTabsProps {
  activeIndex: number;
  count: number;
  label: string;
  onSelect: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function GenerationTabs({
  activeIndex,
  count,
  label,
  onSelect,
  onPrevious,
  onNext,
}: GenerationTabsProps) {
  const tabListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tabList = tabListRef.current;
    const activeTab = tabList?.querySelector<HTMLElement>(`[data-generation-index="${activeIndex}"]`);
    if (!tabList || !activeTab) return;

    const tabLeft = activeTab.offsetLeft;
    const tabRight = tabLeft + activeTab.offsetWidth;
    if (tabLeft < tabList.scrollLeft) {
      tabList.scrollTo({ left: tabLeft, behavior: 'smooth' });
    } else if (tabRight > tabList.scrollLeft + tabList.clientWidth) {
      tabList.scrollTo({ left: tabRight - tabList.clientWidth, behavior: 'smooth' });
    }
  }, [activeIndex]);

  const selectFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
    if (event.key === 'ArrowRight') nextIndex = Math.min(count - 1, index + 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = count - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    event.stopPropagation();
    onSelect(nextIndex);
    tabListRef.current
      ?.querySelector<HTMLElement>(`[data-generation-index="${nextIndex}"]`)
      ?.focus();
  };

  return (
    <div
      className="model-node__media-generations nodrag nowheel"
      aria-label={`${label} version navigation`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="model-node__media-generation-arrow"
        onClick={onPrevious}
        disabled={activeIndex <= 0}
        aria-label="Previous version"
      >
        &lsaquo;
      </button>
      <div ref={tabListRef} className="model-node__media-generation-tabs" role="tablist" aria-label={`${label} versions`}>
        {Array.from({ length: count }, (_, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            className={`model-node__media-generation-tab${index === activeIndex ? ' model-node__media-generation-tab--active' : ''}`}
            aria-selected={index === activeIndex}
            aria-label={`Version ${index + 1} of ${count}`}
            tabIndex={index === activeIndex ? 0 : -1}
            data-generation-index={index}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => selectFromKeyboard(event, index)}
          >
            V{index + 1}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="model-node__media-generation-arrow"
        onClick={onNext}
        disabled={activeIndex >= count - 1}
        aria-label="Next version"
      >
        &rsaquo;
      </button>
    </div>
  );
}

function modelOutputBadge(outputType: string): string {
  if (outputType === 'video') return 'VID';
  if (outputType === 'audio') return 'AUD';
  if (outputType === 'text') return 'TXT';
  if (outputType === 'model3d') return '3D';
  return 'IMG';
}

function modelOutputLabel(outputType: string): string {
  if (outputType === 'video') return 'Video';
  if (outputType === 'audio') return 'Audio';
  if (outputType === 'text') return 'Text';
  if (outputType === 'model3d') return '3D Model';
  return 'Result';
}

function ModelNodeInner({ id, data, selected, width, height }: ModelNodeProps) {
  const { updateNodeData, getEdges, getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { state, dispatch } = useWorkspace();
  const runNode = useRunNode();
  const modelDef = ALL_MODELS[data.type];
  if (!modelDef) return null;

  const status = data.result?.status ?? 'idle';
  const url = data.result?.url;
  const accentColor = CATEGORY_COLORS[modelDef.category];
  const provider = modelProvider(modelDef);
  const providerLabel = modelProviderLabel(modelDef);
  const outputPorts = modelDef.outputs?.length
    ? modelDef.outputs.map((output) => ({
        handleId: output.id,
        portType: output.portType,
        label: output.label,
      }))
    : [{
        handleId: modelDef.outputType,
        portType: modelDef.outputType,
        label: modelOutputLabel(modelDef.outputType),
      }];

  const elementField = modelDef.inputs.find((f) => f.fieldType === 'element-list');
  const elementCount = elementField ? (data.config._elementCount as number ?? 0) : 0;
  const elementMax = elementField?.max ?? 5;

  // Re-register handles with ReactFlow when dynamic ports are added/removed
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, elementCount, updateNodeInternals]);

  // An input satisfied from this node's own config is not missing. Marking it
  // required anyway drew a Studio generation — which carries its prompt and
  // frames in config and has no incoming edges at all — as a broken node.
  const isSuppliedByConfig = useCallback((fieldId: string): boolean => {
    const value = data.config[fieldId];
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') {
      const ids = (value as { elementIds?: unknown }).elementIds;
      return Array.isArray(ids) && ids.length > 0;
    }
    return false;
  }, [data.config]);

  const portInputs: PortEntry[] = useMemo(() => {
    const ports: PortEntry[] = [];
    for (const f of modelDef.inputs) {
      if (f.fieldType === 'port') {
        ports.push({
          handleId: f.id,
          portType: f.portType,
          label: f.label,
          required: f.required && !isSuppliedByConfig(f.id),
          suppliedByConfig: isSuppliedByConfig(f.id),
        });
      } else if (f.fieldType === 'element-list') {
        for (let i = 0; i < elementCount; i++) {
          ports.push({
            handleId: `${f.id}_${i}`,
            portType: f.portType,
            label: `${f.label} ${i + 2}`,
            required: false,
          });
        }
      }
    }
    return ports;
  }, [modelDef.inputs, elementCount, isSuppliedByConfig]);

  const addElement = useCallback(() => {
    if (elementCount < elementMax) {
      updateNodeData(id, { config: { ...data.config, _elementCount: elementCount + 1 } });
    }
  }, [id, data.config, elementCount, elementMax, updateNodeData]);

  const isAudio = modelDef.outputType === 'audio';
  const isText = modelDef.outputType === 'text';
  const isModel3d = modelDef.outputType === 'model3d';
  const isVisualOutput = modelDef.outputType === 'image' || modelDef.outputType === 'video';
  const isRunning = status === 'running';
  const isRunpodLtxSession = modelDef.nodeType === 'runpod-ltx25-session';
  const reportedProgress = typeof data.result?.progress === 'number' ? data.result.progress : undefined;
  const [progress, setProgress] = useState(0);
  const [runpodElapsedSeconds, setRunpodElapsedSeconds] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [visualMediaError, setVisualMediaError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sam3ModalOpen, setSam3ModalOpen] = useState(false);
  const [sam3CloudModalOpen, setSam3CloudModalOpen] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [whisperTranscriptMode, setWhisperTranscriptMode] = useState<'segments' | 'words'>('segments');
  const whisperTranscriptLoadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isRunning) { setProgress(0); return; }
    if (reportedProgress !== undefined) {
      setProgress(reportedProgress);
      return;
    }
    setProgress(5);
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 8 + 2, 95));
    }, 1500);
    return () => clearInterval(interval);
  }, [isRunning, reportedProgress]);

  useEffect(() => {
    if (!isRunning || !isRunpodLtxSession) {
      setRunpodElapsedSeconds(0);
      return;
    }
    const startedAt = data.result?.progressStartedAt ?? Date.now();
    const updateElapsed = () => setRunpodElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [data.result?.progressStartedAt, isRunning, isRunpodLtxSession]);

  const generations = (data.generations as string[]) ?? [];
  const storedActiveIdx = typeof data.activeGeneration === 'number' && Number.isFinite(data.activeGeneration)
    ? Math.trunc(data.activeGeneration)
    : generations.length - 1;
  const activeIdx = generations.length > 0
    ? Math.max(0, Math.min(generations.length - 1, storedActiveIdx))
    : -1;
  // When layers exist, use result.url directly (updated by layer selection)
  const activeUrl = data.result?.layers?.length ? url : ((activeIdx >= 0 ? generations[activeIdx] : undefined) ?? url);
  const activeVersionNumber = activeIdx >= 0 ? activeIdx + 1 : 1;
  const hasMultiple = generations.length > 1;
  const selectedLayerIndex = data.result?.selectedLayerIndex ?? 0;
  const selectedLayer = data.result?.layers?.[selectedLayerIndex];
  const transcriptSegments = data.result?.segments ?? [];
  const transcriptWords = useMemo(
    () => transcriptSegments.flatMap((seg) => (
      (seg.words ?? []).map((word) => ({
        ...word,
        speaker: word.speaker ?? seg.speaker,
      }))
    )),
    [transcriptSegments],
  );
  const hasWordTimestamps = transcriptWords.length > 0;
  const transcriptPath = data.result?.transcriptPath;
  const wordTimestampsStatus = data.result?.wordTimestampsStatus ?? (hasWordTimestamps ? 'ready' : 'idle');
  const canShowWordTab = hasWordTimestamps || Boolean(transcriptPath) || wordTimestampsStatus === 'loading';
  const isSam3ImageNode = modelDef.nodeType === 'sam3-segment' || modelDef.nodeType === 'sam3-segment-cloud';
  const isSam3VideoNode = modelDef.nodeType === 'sam3-track-cloud';
  const isTranscriptModel = modelDef.nodeType === 'whisperx-local'
    || modelDef.nodeType === 'wizper'
    || modelDef.nodeType === 'whisper-cloud';
  const showWhisperTranscript = isTranscriptModel
    && (transcriptSegments.length > 0 || Boolean(data.result?.text));
  const progressMessage = data.result?.progressMessage
    ?? getLayerDecomposeStageLabel(data.result?.progressStage)
    ?? (isRunning ? 'Running…' : undefined);
  const isFullBleedVisual = Boolean(isVisualOutput && !data.result?.layers?.length);

  useEffect(() => {
    setVisualMediaError(false);
  }, [activeUrl]);

  useEffect(() => {
    if (!hasWordTimestamps && whisperTranscriptMode === 'words') {
      setWhisperTranscriptMode('segments');
    }
  }, [hasWordTimestamps, whisperTranscriptMode]);

  useEffect(() => {
    if (modelDef.nodeType !== 'whisperx-local') return;
    if (!transcriptPath || hasWordTimestamps || wordTimestampsStatus !== 'loading') return;
    if (whisperTranscriptLoadRef.current === transcriptPath) return;
    whisperTranscriptLoadRef.current = transcriptPath;

    window.setTimeout(() => {
      void window.electronAPI.localModel.readTranscript(transcriptPath).then((transcript) => {
        if (!transcript) {
          updateNodeData(id, {
            result: {
              ...data.result,
              wordTimestampsStatus: 'error',
            },
          });
          return;
        }
        updateNodeData(id, {
          result: {
            ...data.result,
            text: transcript.output_text ?? data.result?.text,
            segments: transcript.segments ?? data.result?.segments,
            language: transcript.language ?? data.result?.language,
            wordTimestampsStatus: 'ready',
          },
        });
      }).catch(() => {
        updateNodeData(id, {
          result: {
            ...data.result,
            wordTimestampsStatus: 'error',
          },
        });
      });
    }, 0);
  }, [modelDef.nodeType, transcriptPath, hasWordTimestamps, wordTimestampsStatus, updateNodeData, id, data.result]);

  const findConnectedInputUrl = (portTypes: Array<'image' | 'video' | 'media'>): string | undefined => {
    const portIds = modelDef.inputs
      .filter((f) => f.fieldType === 'port' && portTypes.includes(f.portType as 'image' | 'video' | 'media'))
      .map((f) => f.id);
    if (portIds.length === 0) return undefined;

    const edges = getEdges();
    for (const portId of portIds) {
      const edge = edges.find((e) => e.target === id && e.targetHandle === portId);
      if (!edge) continue;
      const sourceNode = getNode(edge.source) as Node<WorkflowNodeData> | undefined;
      const sourceUrl = sourceNode?.data?.result?.url
        ?? (sourceNode?.data?.config as Record<string, unknown>)?.fileUrl as string | undefined;
      if (sourceUrl) return sourceUrl;
    }
    return undefined;
  };

  const inputImageUrl = findConnectedInputUrl(['image']);
  const inputVideoUrl = findConnectedInputUrl(['video', 'media']);
  const sam3SourceAsset = useMemo(() => state.assets.find((asset) => (
    asset.url === inputImageUrl
    || asset.sourceUrl === inputImageUrl
    || asset.url === inputVideoUrl
    || asset.sourceUrl === inputVideoUrl
  )), [state.assets, inputImageUrl, inputVideoUrl]);
  const sam3VideoFps = sam3SourceAsset?.fps ?? 30;

  const canCompare = !!inputImageUrl;

  const selectGeneration = useCallback(
    (next: number) => {
      const nextUrl = generations[next];
      if (!nextUrl || next === activeIdx) return;
      updateNodeData(id, { activeGeneration: next, result: { ...data.result, url: nextUrl } });
    },
    [id, data.result, generations, activeIdx, updateNodeData],
  );

  const navigateGen = useCallback(
    (dir: -1 | 1) => {
      selectGeneration(Math.max(0, Math.min(generations.length - 1, activeIdx + dir)));
    },
    [activeIdx, generations.length, selectGeneration],
  );

  const handleAddToTimeline = useCallback(() => {
    if (!activeUrl || modelDef.outputType === 'model3d') return;
    const isVideo = modelDef.outputType === 'video';
    const isAudioOutput = modelDef.outputType === 'audio';
    const fallbackDuration = isVideo ? (Number(data.config.duration) || 5) : 5;
    const timeline = getActiveTimeline(state);

    const createAssetAndClip = (thumbUrl: string, filmstrip?: string[], realDuration?: number, assetId?: string) => {
      const asset: Asset = {
        id: assetId ?? generateId(),
        name: `${modelDef.name} output`,
        type: isVideo ? 'video' : isAudioOutput ? 'audio' : 'image',
        url: activeUrl,
        thumbnailUrl: thumbUrl,
        duration: realDuration ?? fallbackDuration,
        createdAt: timestamp(),
        metadata: filmstrip ? { filmstrip } : undefined,
      };
      dispatch({ type: 'ADD_ASSET', asset });

      const track = timeline.tracks[0];
      if (track) {
        let endTime = 0;
        for (const clip of timeline.clips.filter((c) => c.trackId === track.id)) {
          const clipEnd = clip.startTime + clipEffectiveDuration(clip);
          if (clipEnd > endTime) endTime = clipEnd;
        }
        dispatch({
          type: 'SET_TIMELINE',
          timelineId: timeline.id,
          timeline: addClipToTrack(timeline, track.id, asset, endTime),
        });
      }
    };

    if (isVideo) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'auto';
      video.src = activeUrl;

      const assetId = generateId();

      video.addEventListener('loadedmetadata', () => {
        const realDuration = video.duration || fallbackDuration;

        // Add clip with correct duration as soon as metadata is available
        createAssetAndClip(activeUrl, undefined, realDuration, assetId);

        // Then extract filmstrip frames in the background
        const frames: string[] = [];
        let frameIdx = 0;
        const frameCount = Math.max(1, Math.round((realDuration * 3) / 5));

        const captureFrame = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 320;
            canvas.height = video.videoHeight || 180;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              frames.push(canvas.toDataURL('image/jpeg', 0.5));
            }
          } catch { /* CORS or other error — skip frame */ }

          frameIdx++;
          if (frameIdx < frameCount) {
            video.currentTime = ((frameIdx + 1) * realDuration) / (frameCount + 1);
          } else {
            dispatch({
              type: 'UPDATE_ASSET',
              asset: {
                id: assetId,
                thumbnailUrl: frames[0] ?? activeUrl,
                metadata: frames.length > 0 ? { filmstrip: frames } : undefined,
              },
            });
          }
        };

        video.addEventListener('seeked', captureFrame);
        video.currentTime = ((0 + 1) * realDuration) / (frameCount + 1);
      }, { once: true });

      video.addEventListener('error', () => createAssetAndClip(activeUrl), { once: true });
      video.load();
    } else if (isAudioOutput) {
      const assetId = generateId();
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = activeUrl;
      audio.addEventListener('loadedmetadata', () => {
        const realDuration = audio.duration || fallbackDuration;
        createAssetAndClip('', undefined, realDuration, assetId);

        extractWaveformPeaks(activeUrl).then((peaks) => {
          dispatch({
            type: 'UPDATE_ASSET',
            asset: { id: assetId, metadata: { waveform: peaks } },
          });
        }).catch(() => {});
      }, { once: true });
      audio.addEventListener('error', () => createAssetAndClip(''), { once: true });
      audio.load();
    } else {
      createAssetAndClip(activeUrl);
    }
  }, [activeUrl, modelDef, data.config.duration, dispatch, state]);

  const cls = [
    'cinegen-node model-node',
    isFullBleedVisual && 'model-node--media',
    selected && 'cinegen-node--selected',
    status === 'running' && 'cinegen-node--running',
  ].filter(Boolean).join(' ');
  const portTop = (index: number, count: number) => (
    isFullBleedVisual ? `${((index + 1) / (count + 1)) * 100}%` : HEADER_HEIGHT + PORT_SPACING * index + PORT_SPACING / 2
  );
  const inputPortTop = (port: PortEntry, index: number) => {
    const distributedTop = portTop(index, portInputs.length);
    if (!isFullBleedVisual || port.handleId !== 'medias') return distributedTop;

    const promptIndex = portInputs.findIndex((input) => input.handleId === 'prompt');
    if (promptIndex < 0 || promptIndex >= index) return distributedTop;

    const promptTop = ((promptIndex + 1) / (portInputs.length + 1)) * 100;
    return `min(${distributedTop}, calc(${promptTop}% + 64px))`;
  };
  const visualSourceUrl = !activeUrl
    ? (isSam3VideoNode ? inputVideoUrl : (isSam3ImageNode ? inputImageUrl : undefined))
    : undefined;
  const visualActionLabel = modelDef.nodeType === 'sam3-segment' || modelDef.nodeType === 'sam3-segment-cloud'
    ? 'Segment'
    : modelDef.nodeType === 'sam3-track-cloud'
      ? 'Track'
      : modelDef.nodeType === 'runpod-ltx25-session' && status === 'error' && data.result?.remoteJobId
        ? 'Resume render'
      : 'Run Model';
  const visualActionDisabled = (modelDef.nodeType === 'sam3-segment' || modelDef.nodeType === 'sam3-segment-cloud')
    ? !inputImageUrl
    : modelDef.nodeType === 'sam3-track-cloud'
      ? !inputVideoUrl
      : false;
  const runVisualAction = () => {
    if (modelDef.nodeType === 'sam3-segment') {
      setSam3ModalOpen(true);
    } else if (modelDef.nodeType === 'sam3-segment-cloud' || modelDef.nodeType === 'sam3-track-cloud') {
      setSam3CloudModalOpen(true);
    } else {
      void runNode(id);
    }
  };
  const mediaNodeWidth = positiveDimension(width, DEFAULT_MEDIA_NODE_WIDTH);
  const mediaNodeHeight = positiveDimension(height, DEFAULT_MEDIA_NODE_HEIGHT);

  return (
    <div
      className={cls}
      style={isFullBleedVisual
        ? { width: mediaNodeWidth, height: mediaNodeHeight, minWidth: 0, maxWidth: 'none' }
        : { width: 300, minWidth: 300, maxWidth: 300 }}
    >
      {isFullBleedVisual && (
        <NodeResizer
          isVisible={!!selected}
          minWidth={180}
          minHeight={101.25}
          maxWidth={960}
          maxHeight={540}
          keepAspectRatio
          lineClassName="media-node-resizer__line"
          handleClassName="media-node-resizer__handle"
        />
      )}

      {isFullBleedVisual ? (
        <div className="model-node__media-surface" data-output-type={modelDef.outputType}>
          {activeUrl && modelDef.outputType === 'video' ? (
            <VideoNodePreview
              sourceUrl={activeUrl}
              fallbackPosterUrl={inputImageUrl}
              className="model-node__media-output nodrag nowheel"
              ariaLabel={`Play ${modelDef.name} version ${activeVersionNumber}`}
              onError={() => setVisualMediaError(true)}
            />
          ) : activeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activeUrl}
              alt={`${modelDef.name} result`}
              className="model-node__media-output"
              draggable={false}
              onError={() => setVisualMediaError(true)}
            />
          ) : visualSourceUrl && isSam3VideoNode ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={visualSourceUrl}
              className="model-node__media-output model-node__media-output--source nodrag nowheel"
              controls
              playsInline
              preload="metadata"
            />
          ) : visualSourceUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={visualSourceUrl}
              alt="Connected input"
              className="model-node__media-output model-node__media-output--source"
              draggable={false}
            />
          ) : (
            <div className="model-node__media-empty" aria-label={`${modelDef.outputType} result will appear here`}>
              {modelDef.outputType === 'video' ? (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="13" height="14" rx="2" />
                  <path d="m16 10 5-3v10l-5-3" />
                </svg>
              ) : (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              )}
            </div>
          )}

          {activeUrl && comparing && inputImageUrl && (
            <ImageCompare beforeUrl={inputImageUrl} afterUrl={activeUrl!} className="model-node__compare" />
          )}

          {visualMediaError && (
            <div className="model-node__media-error" role="alert">Result media is unavailable</div>
          )}

          <div className={`model-node__media-bar${!activeUrl || isRunning ? ' model-node__media-bar--persistent' : ''}`}>
            <div className="model-node__media-identity">
              <span className="model-node__category-badge" style={{ background: accentColor }}>
                {modelOutputBadge(modelDef.outputType)}
              </span>
              <span className="model-node__media-name">{modelDef.name}</span>
              <span className={`model-node__provider model-node__provider--${provider}`}>{providerLabel}</span>
            </div>
            <div className="model-node__media-actions nodrag">
              {elementField && elementCount < elementMax && (
                <button
                  type="button"
                  className="model-node__media-action"
                  onClick={addElement}
                  title={elementField.id === 'elements' || elementField.id === 'kling_elements' ? 'Add element' : 'Add image input'}
                  aria-label={elementField.id === 'elements' || elementField.id === 'kling_elements' ? 'Add element' : 'Add image input'}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              )}
              {activeUrl && canCompare && (
                <button
                  type="button"
                  className={`model-node__media-action${comparing ? ' model-node__media-action--active' : ''}`}
                  onClick={() => setComparing((value) => !value)}
                  title="Compare input and result"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" /></svg>
                </button>
              )}
              {activeUrl && (
                <>
                  <button type="button" className="model-node__media-action" onClick={handleAddToTimeline} title="Add to Timeline">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="3" y1="7" x2="15" y2="7" /><line x1="3" y1="12" x2="12" y2="12" /><line x1="3" y1="17" x2="10" y2="17" /><path d="M18 13v8M14 17h8" />
                    </svg>
                  </button>
                  <button type="button" className="model-node__media-action" onClick={() => setFullscreen(true)} title="Fullscreen">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                  </button>
                </>
              )}
            </div>
          </div>

          {hasMultiple && (
            <GenerationTabs
              activeIndex={activeIdx}
              count={generations.length}
              label={modelOutputLabel(modelDef.outputType)}
              onSelect={selectGeneration}
              onPrevious={() => navigateGen(-1)}
              onNext={() => navigateGen(1)}
            />
          )}

          {isRunning ? (
            <div
              className="model-node__media-progress nodrag"
              aria-label={isRunpodLtxSession ? `${formatTime(runpodElapsedSeconds)} elapsed` : `${Math.round(progress)} percent complete`}
            >
              <div className="model-node__media-progress-copy">
                <span>{progressMessage || 'Generating…'}</span>
                <strong>{isRunpodLtxSession ? formatTime(runpodElapsedSeconds) : `${Math.round(progress)}%`}</strong>
              </div>
              <div className="model-node__media-progress-track">
                <span style={{ width: `${progress}%`, background: accentColor }} />
              </div>
            </div>
          ) : !activeUrl ? (
            <div className={`model-node__media-state nodrag${status === 'error' ? ' model-node__media-state--error' : ''}`}>
              {status === 'error' && data.result?.error && (
                <span className="model-node__media-state-message">{data.result.error}</span>
              )}
              <button
                type="button"
                className="model-node__media-run"
                onClick={runVisualAction}
                disabled={visualActionDisabled}
              >
                <span aria-hidden="true">{modelDef.nodeType.startsWith('sam3-') ? '✂' : '→'}</span>
                {visualActionLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="cinegen-node__accent" style={{ background: accentColor }} />
          <div className="cinegen-node__content">
            <div className="model-node__header">
          <span className="model-node__category-badge" style={{ background: accentColor }}>
            {modelOutputBadge(modelDef.outputType)}
          </span>
          <span className="model-node__name">{modelDef.name}</span>
          <span className={`model-node__provider model-node__provider--${provider}`}>{providerLabel}</span>
          {activeUrl && !isModel3d && (
            <button
              type="button"
              className="model-node__add-timeline-btn nodrag"
              onClick={handleAddToTimeline}
              title="Add to Timeline"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="6" x2="22" y2="6" />
                <line x1="2" y1="12" x2="16" y2="12" />
                <line x1="2" y1="18" x2="12" y2="18" />
                <line x1="19" y1="15" x2="19" y2="21" />
                <line x1="16" y1="18" x2="22" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="cinegen-node__body">
          {showWhisperTranscript ? (
            <div className="whisperx-transcript nodrag nowheel">
              <div className="whisperx-transcript__header">
                <span className="whisperx-transcript__title">Transcript</span>
                {data.result?.language && <span className="whisperx-transcript__lang">{data.result.language}</span>}
                {canShowWordTab && (
                  <div className="whisperx-transcript__tabs">
                    <button
                      type="button"
                      className={`whisperx-transcript__tab ${whisperTranscriptMode === 'segments' ? 'whisperx-transcript__tab--active' : ''}`}
                      onClick={() => setWhisperTranscriptMode('segments')}
                    >
                      Sentences
                    </button>
                    <button
                      type="button"
                      className={`whisperx-transcript__tab ${whisperTranscriptMode === 'words' ? 'whisperx-transcript__tab--active' : ''}`}
                      onClick={() => setWhisperTranscriptMode('words')}
                    >
                      Words
                    </button>
                  </div>
                )}
              </div>
              <div className="whisperx-transcript__body">
                {whisperTranscriptMode === 'words' && hasWordTimestamps ? (
                  transcriptWords.map((word: TranscriptWord, i: number) => (
                    <div key={`${word.start}-${word.end}-${i}`} className="whisperx-transcript__seg whisperx-transcript__seg--word">
                      <div className="whisperx-transcript__time">
                        {formatTime(word.start)}
                        {word.speaker && <span className="whisperx-transcript__speaker">{word.speaker}</span>}
                      </div>
                      <div className="whisperx-transcript__text">{word.word}</div>
                    </div>
                  ))
                ) : whisperTranscriptMode === 'words' && wordTimestampsStatus === 'loading' ? (
                  <div className="whisperx-transcript__seg whisperx-transcript__seg--status">
                    <div className="whisperx-transcript__text">Loading word timestamps...</div>
                  </div>
                ) : whisperTranscriptMode === 'words' && wordTimestampsStatus === 'error' ? (
                  <div className="whisperx-transcript__seg whisperx-transcript__seg--status">
                    <div className="whisperx-transcript__text">Word timestamps failed to load.</div>
                  </div>
                ) : transcriptSegments.length > 0 ? (
                  transcriptSegments.map((seg: TranscriptSegment, i: number) => (
                    <div key={i} className="whisperx-transcript__seg">
                      <div className="whisperx-transcript__time">
                        {formatTime(seg.start)}
                        {seg.speaker && <span className="whisperx-transcript__speaker">{seg.speaker}</span>}
                      </div>
                      <div className="whisperx-transcript__text">{seg.text}</div>
                    </div>
                  ))
                ) : (
                  <div className="whisperx-transcript__seg">
                    <div className="whisperx-transcript__text">{data.result?.text}</div>
                  </div>
                )}
              </div>
            </div>
          ) : isText ? (
            /* ── Text output layout ── */
            data.result?.text ? (
              <div className="text-output nodrag nowheel">
                <div className="text-output__content">{data.result.text}</div>
              </div>
            ) : (
              <div className="text-output text-output--empty">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
            )
          ) : isAudio ? (
            /* ── Audio player layout ── */
            activeUrl ? (
              <div className="audio-player nodrag nowheel">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  ref={audioRef}
                  src={activeUrl}
                  onTimeUpdate={() => { if (audioRef.current) setAudioTime(audioRef.current.currentTime); }}
                  onLoadedMetadata={() => { if (audioRef.current) setAudioDuration(audioRef.current.duration || 0); }}
                  onPlay={() => setAudioPlaying(true)}
                  onPause={() => setAudioPlaying(false)}
                  onEnded={() => setAudioPlaying(false)}
                />
                {hasMultiple && (
                  <div className="audio-player__gen-nav">
                    <button className="audio-player__gen-btn" onClick={() => navigateGen(-1)} disabled={activeIdx <= 0}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <span className="audio-player__gen-count">{activeIdx + 1} of {generations.length}</span>
                    <button className="audio-player__gen-btn" onClick={() => navigateGen(1)} disabled={activeIdx >= generations.length - 1}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                  </div>
                )}
                <div className="audio-player__row">
                  <button
                    type="button"
                    className="audio-player__play-btn"
                    onClick={() => {
                      if (!audioRef.current) return;
                      audioPlaying ? audioRef.current.pause() : audioRef.current.play();
                    }}
                  >
                    {audioPlaying ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="5" height="18" rx="1.5" /><rect x="14" y="3" width="5" height="18" rx="1.5" /></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8V4z" /></svg>
                    )}
                  </button>
                  <div className="audio-player__time">{formatTime(audioTime)}</div>
                  <input
                    type="range"
                    className="audio-player__scrubber"
                    min={0}
                    max={audioDuration || 1}
                    step={0.1}
                    value={audioTime}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      setAudioTime(t);
                      if (audioRef.current) audioRef.current.currentTime = t;
                    }}
                    style={{ '--audio-progress': `${audioDuration ? (audioTime / audioDuration) * 100 : 0}%` } as React.CSSProperties}
                  />
                  <div className="audio-player__time">{formatTime(audioDuration)}</div>
                </div>
              </div>
            ) : (
              <div className="audio-player audio-player--empty">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )
          ) : isModel3d ? (
            /* ── Download-only 3D asset layout ── */
            activeUrl ? (
              <div className="model-node__asset-card nodrag nowheel">
                <div className="model-node__asset-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2 21 7 12 12 3 7 12 2Z" />
                    <path d="m3 7 9 5 9-5" />
                    <path d="M3 7v10l9 5 9-5V7" />
                    <path d="M12 12v10" />
                  </svg>
                </div>
                <div className="model-node__asset-copy">
                  <span className="model-node__asset-title">3D asset ready</span>
                  <span className="model-node__asset-description">Open or download the generated model file.</span>
                </div>
                <a
                  className="model-node__asset-download"
                  href={activeUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  onClick={(event) => event.stopPropagation()}
                >
                  Download
                </a>
              </div>
            ) : (
              <div className="model-node__asset-card model-node__asset-card--empty">
                <div className="model-node__asset-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2 21 7 12 12 3 7 12 2Z" />
                    <path d="m3 7 9 5 9-5" />
                    <path d="M3 7v10l9 5 9-5V7" />
                    <path d="M12 12v10" />
                  </svg>
                </div>
                <span className="model-node__asset-description">3D output will appear here.</span>
              </div>
            )
          ) : (
            /* ── Video / Image preview layout ── */
            <>
              {data.result?.layers && data.result.layers.length > 0 && (
                <div className="layer-gallery">
                  <div className="layer-gallery__header">
                    <span className="layer-gallery__title">Layers</span>
                    <span className="layer-gallery__count">{selectedLayerIndex + 1} / {data.result.layers.length}</span>
                  </div>
                  <div className="layer-gallery__strip">
                    {data.result.layers.map((layer: { url: string; name: string }, idx: number) => (
                      <button
                        key={idx}
                        className={`layer-gallery__thumb ${idx === (data.result?.selectedLayerIndex ?? 0) ? 'layer-gallery__thumb--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateNodeData(id, {
                            result: {
                              ...data.result,
                              url: layer.url,
                              selectedLayerIndex: idx,
                            },
                          });
                        }}
                        title={layer.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={layer.url} alt={layer.name} />
                        <span className="layer-gallery__label">{layer.name}</span>
                      </button>
                    ))}
                  </div>
                  {selectedLayer && (
                    <div className="layer-gallery__meta">
                      <span className="layer-gallery__meta-type">{selectedLayer.type}</span>
                      {typeof selectedLayer.metadata?.confidence === 'number' && (
                        <span className="layer-gallery__meta-confidence">{Math.round(selectedLayer.metadata.confidence * 100)}%</span>
                      )}
                      <span className="layer-gallery__meta-name">{selectedLayer.name}</span>
                    </div>
                  )}
                </div>
              )}

              {activeUrl && (
                <div className="model-node__preview" style={{ aspectRatio: '16/9' }}>
                  {hasMultiple && (
                    <div className="model-node__gen-nav nodrag">
                      <button className="model-node__gen-btn" onClick={() => navigateGen(-1)} disabled={activeIdx <= 0}>&lsaquo;</button>
                      <span className="model-node__gen-count">{activeIdx + 1} / {generations.length}</span>
                      <button className="model-node__gen-btn" onClick={() => navigateGen(1)} disabled={activeIdx >= generations.length - 1}>&rsaquo;</button>
                    </div>
                  )}

                  <div className="model-node__preview-actions nodrag">
                    {canCompare && (
                      <button
                        className={`model-node__preview-btn${comparing ? ' model-node__preview-btn--active' : ''}`}
                        onClick={() => setComparing((v) => !v)}
                        title="Compare"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" /></svg>
                      </button>
                    )}
                    <button
                      className="model-node__preview-btn"
                      onClick={() => setFullscreen(true)}
                      title="Fullscreen"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                    </button>
                  </div>

                  {modelDef.outputType === 'video' ? (
                    <VideoNodePreview
                      sourceUrl={activeUrl}
                      fallbackPosterUrl={inputImageUrl}
                      className="model-node__preview-media"
                      ariaLabel={`Play ${modelDef.name} version ${activeVersionNumber}`}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activeUrl || (isSam3ImageNode ? inputImageUrl : undefined)} alt="Result" className="model-node__preview-media" />
                  )}

                  {comparing && inputImageUrl && (
                    <ImageCompare beforeUrl={inputImageUrl} afterUrl={activeUrl} className="model-node__compare" />
                  )}
                </div>
              )}

              {!activeUrl && isSam3ImageNode && inputImageUrl && (
                <div className="model-node__preview" style={{ aspectRatio: '16/9' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={inputImageUrl} alt="Input" className="model-node__preview-media" />
                </div>
              )}

              {!activeUrl && isSam3VideoNode && inputVideoUrl && (
                <div className="model-node__preview" style={{ aspectRatio: '16/9' }}>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={inputVideoUrl} className="model-node__preview-media" controls />
                </div>
              )}

              {!activeUrl && !((isSam3ImageNode && inputImageUrl) || (isSam3VideoNode && inputVideoUrl)) && (
                <div className="model-node__preview model-node__preview--empty" style={{ aspectRatio: '16/9' }}>
                  <span className="model-node__preview-placeholder" />
                </div>
              )}
            </>
          )}

          {status === 'error' && data.result?.error && (
            <div className="model-node__error">{data.result.error}</div>
          )}

          <div className="model-node__footer">
            {elementField && elementCount < elementMax && (
              <button
                type="button"
                className="model-node__add-element-btn nodrag"
                onClick={addElement}
              >
                + {elementField?.id === 'elements' || elementField?.id === 'kling_elements' ? 'Add element' : 'Add image input'}
              </button>
            )}
            {isRunning ? (
              <div className="model-node__progress-wrap nodrag">
                <div className="model-node__progress">
                  <div className="model-node__progress-bar" style={{ width: `${progress}%` }} />
                  <span className="model-node__progress-text">
                    {isRunpodLtxSession ? `${formatTime(runpodElapsedSeconds)} elapsed` : `${Math.round(progress)}%`}
                  </span>
                  <button
                    type="button"
                    className="model-node__progress-cancel"
                    onClick={() => {}}
                  >
                    &times;
                  </button>
                </div>
                {progressMessage && (
                  <div className="model-node__progress-stage">{progressMessage}</div>
                )}
              </div>
            ) : modelDef.nodeType === 'sam3-segment' ? (
              <button
                type="button"
                className="model-node__run-btn nodrag"
                onClick={() => setSam3ModalOpen(true)}
                disabled={!inputImageUrl}
              >
                ✂ Segment
              </button>
            ) : modelDef.nodeType === 'sam3-segment-cloud' ? (
              <button
                type="button"
                className="model-node__run-btn nodrag"
                onClick={() => setSam3CloudModalOpen(true)}
                disabled={!inputImageUrl}
              >
                ✂ Segment
              </button>
            ) : modelDef.nodeType === 'sam3-track-cloud' ? (
              <button
                type="button"
                className="model-node__run-btn nodrag"
                onClick={() => setSam3CloudModalOpen(true)}
                disabled={!inputVideoUrl}
              >
                ✂ Track
              </button>
            ) : (
              <button
                type="button"
                className="model-node__run-btn nodrag"
                onClick={() => runNode(id)}
              >
                &rarr; Run Model
              </button>
            )}
          </div>
            </div>
          </div>
        </>
      )}

      {portInputs.map((port, i) => (
        <Handle
          key={`in-${port.handleId}`}
          type="target"
          position={Position.Left}
          id={port.handleId}
          style={{
            background: PORT_COLORS[port.portType],
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid var(--bg-raised)',
            top: inputPortTop(port, i),
          }}
        />
      ))}

      {outputPorts.map((port, i) => (
        <Handle
          key={`out-${port.handleId}`}
          type="source"
          position={Position.Right}
          id={port.handleId}
          style={{
            background: PORT_COLORS[port.portType],
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid var(--bg-raised)',
            top: portTop(i, outputPorts.length),
          }}
        />
      ))}

      {portInputs.map((port, i) => (
        <span
          key={`label-in-${port.handleId}`}
          className={`model-node__port-label model-node__port-label--left${
            port.suppliedByConfig ? ' model-node__port-label--set' : ''
          }`}
          style={{ top: inputPortTop(port, i) }}
          title={port.suppliedByConfig ? `${port.label} is set on this node` : undefined}
        >
          {port.label}{port.required ? '*' : ''}{port.suppliedByConfig ? ' ·' : ''}
        </span>
      ))}

      {outputPorts.map((port, i) => (
        <span
          key={`label-out-${port.handleId}`}
          className="model-node__port-label model-node__port-label--right"
          style={{ top: portTop(i, outputPorts.length) }}
        >
          {port.label}
        </span>
      ))}

      {fullscreen && activeUrl && !isModel3d && (
        <FullscreenModal
          url={activeUrl}
          type={modelDef.outputType as 'image' | 'video' | 'audio'}
          beforeUrl={inputImageUrl}
          onClose={() => setFullscreen(false)}
        />
      )}

      {sam3ModalOpen && inputImageUrl && (
        <Sam3Modal
          imageUrl={inputImageUrl}
          onAcceptSelected={(result) => {
            updateNodeData(id, { result: { status: 'complete', url: result.url } });
            setSam3ModalOpen(false);
          }}
          onAcceptAll={(result) => {
            const primaryUrl = result.layers[0]?.url;
            updateNodeData(id, {
              result: { status: 'complete', url: primaryUrl, layers: result.layers, selectedLayerIndex: 0 },
            });
            setSam3ModalOpen(false);
          }}
          onClose={() => setSam3ModalOpen(false)}
        />
      )}

      {sam3CloudModalOpen && modelDef.nodeType === 'sam3-segment-cloud' && inputImageUrl && (
        <Sam3CloudModal
          sourceKind="image"
          sourceUrl={inputImageUrl}
          onAcceptSelected={(result) => {
            updateNodeData(id, { result: { status: 'complete', url: result.url } });
            setSam3CloudModalOpen(false);
          }}
          onAcceptAll={(result) => {
            const primaryUrl = result.layers[0]?.url;
            updateNodeData(id, {
              result: { status: 'complete', url: primaryUrl, layers: result.layers, selectedLayerIndex: 0 },
            });
            setSam3CloudModalOpen(false);
          }}
          onClose={() => setSam3CloudModalOpen(false)}
        />
      )}

      {sam3CloudModalOpen && modelDef.nodeType === 'sam3-track-cloud' && inputVideoUrl && (
        <Sam3CloudModal
          sourceKind="video"
          sourceUrl={inputVideoUrl}
          sourceFps={sam3VideoFps}
          onAcceptSelected={(result) => {
            updateNodeData(id, { result: { status: 'complete', url: result.url } });
            setSam3CloudModalOpen(false);
          }}
          onClose={() => setSam3CloudModalOpen(false)}
        />
      )}
    </div>
  );
}

export const ModelNode = ModelNodeInner;
