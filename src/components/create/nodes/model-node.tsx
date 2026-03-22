

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, useUpdateNodeInternals, type Node } from '@xyflow/react';
import { ALL_MODELS } from '@/lib/fal/models';
import { CATEGORY_COLORS, PORT_COLORS } from '@/lib/workflows/node-registry';
import { useRunNode } from '@/components/create/workflow-canvas';
import { useWorkspace, getActiveTimeline } from '@/components/workspace/workspace-shell';
import { extractWaveformPeaks } from '@/lib/editor/waveform';
import { ImageCompare } from '@/components/create/image-compare';
import { Sam3Modal } from '@/components/create/sam3-modal';
import { Sam3CloudModal } from '@/components/create/sam3-cloud-modal';
import { FullscreenModal } from '@/components/create/fullscreen-modal';
import { addClipToTrack } from '@/lib/editor/timeline-operations';
import { clipEffectiveDuration } from '@/types/timeline';
import { generateId, timestamp } from '@/lib/utils/ids';
import { getLayerDecomposeStageLabel } from '@/lib/workflows/layer-decompose';
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

interface PortEntry {
  handleId: string;
  portType: string;
  label: string;
  required: boolean;
}

function ModelNodeInner({ id, data, selected }: ModelNodeProps) {
  const { updateNodeData, getEdges, getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { state, dispatch } = useWorkspace();
  const runNode = useRunNode();
  const modelDef = ALL_MODELS[data.type];
  if (!modelDef) return null;

  const status = data.result?.status ?? 'idle';
  const url = data.result?.url;
  const accentColor = CATEGORY_COLORS[modelDef.category];

  const elementField = modelDef.inputs.find((f) => f.fieldType === 'element-list');
  const elementCount = elementField ? (data.config._elementCount as number ?? 0) : 0;
  const elementMax = elementField?.max ?? 5;

  // Re-register handles with ReactFlow when dynamic ports are added/removed
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, elementCount, updateNodeInternals]);

  const portInputs: PortEntry[] = useMemo(() => {
    const ports: PortEntry[] = [];
    for (const f of modelDef.inputs) {
      if (f.fieldType === 'port') {
        ports.push({ handleId: f.id, portType: f.portType, label: f.label, required: f.required });
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
  }, [modelDef.inputs, elementCount]);

  const addElement = useCallback(() => {
    if (elementCount < elementMax) {
      updateNodeData(id, { config: { ...data.config, _elementCount: elementCount + 1 } });
    }
  }, [id, data.config, elementCount, elementMax, updateNodeData]);

  const isAudio = modelDef.outputType === 'audio';
  const isText = modelDef.outputType === 'text';
  const isRunning = status === 'running';
  const reportedProgress = typeof data.result?.progress === 'number' ? data.result.progress : undefined;
  const [progress, setProgress] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [comparing, setComparing] = useState(false);
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

  const generations = (data.generations as string[]) ?? [];
  const activeIdx = (data.activeGeneration as number) ?? generations.length - 1;
  // When layers exist, use result.url directly (updated by layer selection)
  const activeUrl = data.result?.layers?.length ? url : (generations[activeIdx] ?? url);
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

  const navigateGen = useCallback(
    (dir: -1 | 1) => {
      const next = Math.max(0, Math.min(generations.length - 1, activeIdx + dir));
      updateNodeData(id, { activeGeneration: next, result: { ...data.result, url: generations[next] } });
    },
    [id, data.result, generations, activeIdx, updateNodeData],
  );

  const handleAddToTimeline = useCallback(() => {
    if (!activeUrl) return;
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
    selected && 'cinegen-node--selected',
    status === 'running' && 'cinegen-node--running',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} style={{ width: 300, minWidth: 300, maxWidth: 300 }}>
      <div className="cinegen-node__accent" style={{ background: accentColor }} />
      <div className="cinegen-node__content">
        <div className="model-node__header">
          <span className="model-node__category-badge" style={{ background: accentColor }}>
            {modelDef.outputType === 'video' ? 'VID' : modelDef.outputType === 'audio' ? 'AUD' : modelDef.outputType === 'text' ? 'TXT' : 'IMG'}
          </span>
          <span className="model-node__name">{modelDef.name}</span>
          {activeUrl && (
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
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={activeUrl} className="model-node__preview-media" controls />
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
                  <span className="model-node__progress-text">{Math.round(progress)}%</span>
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
            top: HEADER_HEIGHT + PORT_SPACING * i + PORT_SPACING / 2,
          }}
        />
      ))}

      <Handle
        type="source"
        position={Position.Right}
        id={modelDef.outputType}
        style={{
          background: PORT_COLORS[modelDef.outputType],
          width: 12,
          height: 12,
          borderRadius: '50%',
          border: '2px solid var(--bg-raised)',
          top: HEADER_HEIGHT + PORT_SPACING / 2,
        }}
      />

      {portInputs.map((port, i) => (
        <span
          key={`label-in-${port.handleId}`}
          className="model-node__port-label model-node__port-label--left"
          style={{ top: HEADER_HEIGHT + PORT_SPACING * i + PORT_SPACING / 2 }}
        >
          {port.label}{port.required ? '*' : ''}
        </span>
      ))}

      <span
        className="model-node__port-label model-node__port-label--right"
        style={{ top: HEADER_HEIGHT + PORT_SPACING / 2 }}
      >
        {modelDef.outputType === 'video' ? 'Video' : modelDef.outputType === 'audio' ? 'Audio' : modelDef.outputType === 'text' ? 'Text' : 'Result'}
      </span>

      {fullscreen && activeUrl && (
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
