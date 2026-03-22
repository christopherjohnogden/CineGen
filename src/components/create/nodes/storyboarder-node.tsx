import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, type Node } from '@xyflow/react';
import { ALL_MODELS, getModelDefinition } from '@/lib/fal/models';
import { CATEGORY_COLORS, PORT_COLORS } from '@/lib/workflows/node-registry';
import { getApiKey, getKieApiKey, getRunpodApiKey, getRunpodEndpointId, getPodUrl } from '@/lib/utils/api-key';
import { useWorkspace, getActiveTimeline } from '@/components/workspace/workspace-shell';
import { addClipToTrack } from '@/lib/editor/timeline-operations';
import { clipEffectiveDuration } from '@/types/timeline';
import { generateId, timestamp } from '@/lib/utils/ids';
import type { WorkflowNodeData } from '@/types/workflow';
import type { Asset } from '@/types/project';

type StoryboarderNodeProps = NodeProps & { data: WorkflowNodeData };

interface ShotEntry {
  prompt: string;
  url: string | null;
  status: 'idle' | 'running' | 'complete' | 'error';
  error?: string;
  // Video mode fields
  videoUrl?: string | null;
  videoStatus?: 'idle' | 'running' | 'complete' | 'error';
  videoError?: string;
  cameraPrompt?: string;
  dialogue?: string;
  negativePrompt?: string;
  duration?: number;
  flipped?: boolean;
}

type StoryboardMode = 'image' | 'video';

const SHOT_COUNT_OPTIONS = [3, 6, 9, 12];

const LLM_OPTIONS = [
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { value: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
  { value: 'openai/gpt-4.1', label: 'GPT-4.1' },
  { value: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
];

const HEADER_HEIGHT = 36;
const PORT_SPACING = 24;

const STORYBOARD_SYSTEM_PROMPT = `You are a cinematic storyboard director. Given a reference image and a scene description, break the scene into a sequence of cinematic shots that tell the story visually.

For each shot, write a concise image generation prompt that describes:
- The camera angle and shot type (wide, medium, close-up, etc.)
- What is happening in the frame
- The character's pose, expression, and action
- The lighting, mood, and atmosphere

IMPORTANT RULES:
- Each shot description must describe a SINGLE STATIC FRAME — one moment frozen in time, one camera angle, one composition. Never describe camera movement, transitions, or sequences within a single shot. No "starting on X then widening to Y" or "pull-back revealing Z". Just describe what the camera sees in that one frozen instant.
- Maintain the SAME character appearance (face, clothing, body type) across ALL shots
- Keep the same environment and art style throughout
- Each shot should progress the story forward
- Think like a film director — vary camera angles for visual interest
- Start wide to establish the scene, then move in as tension builds
- Do NOT use words like "split", "collage", "grid", "side-by-side", "multiple panels", or "montage"

Respond with ONLY a JSON array of strings. Each string is a shot description prompt. No other text, no markdown, no explanation.

Example output format:
["Wide establishing shot of...", "Medium shot of the character...", "Close-up on..."]`;

function extractResultUrl(result: unknown, path: string): string | undefined {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = result;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function StoryboarderNodeInner({ id, data, selected }: StoryboarderNodeProps) {
  const { updateNodeData, getEdges, getNode } = useReactFlow();
  const { state, dispatch } = useWorkspace();
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planningStatus, setPlanningStatus] = useState<'idle' | 'planning' | 'generating' | 'done'>('idle');
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());

  const mode = (data.config?.mode as StoryboardMode) ?? 'image';
  const selectedModel = (data.config?.selectedModel as string) ?? 'nano-banana-2';
  const selectedVideoModel = (data.config?.selectedVideoModel as string) ?? 'kling-3-image';
  const selectedLlm = (data.config?.selectedLlm as string) ?? 'google/gemini-2.5-flash';
  const shotCount = (data.config?.shotCount as number) ?? 9;
  const rawShots = (data.config?.shots as ShotEntry[]) ?? [];
  const shots: ShotEntry[] = Array.from({ length: shotCount }, (_, i) =>
    rawShots[i] ?? { prompt: '', url: null, status: 'idle' as const, duration: 5 },
  );

  const imageModels = Object.entries(ALL_MODELS)
    .filter(([, m]) => m.category === 'image')
    .map(([key, m]) => ({ key, name: m.name }));

  const videoModels = Object.entries(ALL_MODELS)
    .filter(([, m]) => m.category === 'video')
    .map(([key, m]) => ({ key, name: m.name }));

  // Close settings when clicking outside
  useEffect(() => {
    if (!settingsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as HTMLElement)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [settingsOpen]);

  const findConnectedImageUrl = (): string | undefined => {
    const edges = getEdges();
    const edge = edges.find((e) => e.target === id && e.targetHandle === 'image');
    if (!edge) return undefined;
    const sourceNode = getNode(edge.source) as Node<WorkflowNodeData> | undefined;
    return sourceNode?.data?.result?.url
      ?? (sourceNode?.data?.config as Record<string, unknown>)?.fileUrl as string | undefined;
  };

  const findConnectedText = (): string | undefined => {
    const edges = getEdges();
    const edge = edges.find((e) => e.target === id && e.targetHandle === 'text');
    if (!edge) return undefined;
    const sourceNode = getNode(edge.source) as Node<WorkflowNodeData> | undefined;
    return (sourceNode?.data?.config as Record<string, unknown>)?.prompt as string | undefined
      ?? sourceNode?.data?.result?.text;
  };

  const latestConfigRef = useRef(data.config);
  latestConfigRef.current = data.config;

  const updateShot = useCallback((index: number, update: Partial<ShotEntry>) => {
    const currentConfig = latestConfigRef.current;
    const currentShots = (currentConfig?.shots as ShotEntry[]) ?? [];
    const newShots = [...currentShots];
    newShots[index] = { ...newShots[index], ...update };
    const newConfig = { ...currentConfig, shots: newShots };
    latestConfigRef.current = newConfig;
    updateNodeData(id, { config: newConfig });
  }, [id, updateNodeData]);

  // ─── Image Generation ───

  const generateImage = useCallback(async (index: number) => {
    const imageUrl = findConnectedImageUrl();
    const modelDef = getModelDefinition(selectedModel);
    if (!modelDef) { updateShot(index, { status: 'error', error: 'Model not found' }); return; }

    const provider = modelDef.provider ?? 'fal';
    const apiKey = provider === 'kie' ? getKieApiKey() : getApiKey();
    if (!apiKey) { updateShot(index, { status: 'error', error: `No ${provider} API key configured` }); return; }

    updateShot(index, { status: 'running', error: undefined });

    try {
      const currentShots = (latestConfigRef.current?.shots as ShotEntry[]) ?? [];
      const shotPrompt = currentShots[index]?.prompt ?? '';
      const inputs: Record<string, unknown> = { aspect_ratio: '16:9', resolution: '1K' };
      let effectiveModelId: string;

      if (imageUrl) {
        inputs.prompt = `Recreate the exact same person from the reference image — same face, hair, skin tone, body type, clothing, and accessories. Keep the same environment and atmosphere. ${shotPrompt}`;
        const imageField = modelDef.inputs.find((f) => f.portType === 'image' && f.fieldType === 'port');
        const imageParam = imageField?.falParam ?? 'image_urls';
        inputs[imageParam] = imageParam.endsWith('s') ? [imageUrl] : imageUrl;
        effectiveModelId = modelDef.altId ?? modelDef.id;
      } else {
        inputs.prompt = shotPrompt;
        effectiveModelId = modelDef.id;
      }

      const result = await window.electronAPI.workflow.run({
        apiKey: getApiKey(), kieKey: getKieApiKey(), runpodKey: getRunpodApiKey(),
        runpodEndpointId: getRunpodEndpointId(selectedModel), podUrl: getPodUrl(),
        nodeId: id, nodeType: selectedModel, modelId: effectiveModelId, inputs,
      });

      const resultData = (result as Record<string, unknown>)?.data ?? result;
      const url = extractResultUrl(resultData, modelDef.responseMapping.path);
      updateShot(index, url ? { status: 'complete', url } : { status: 'error', error: 'No image in response' });
    } catch (err) {
      updateShot(index, { status: 'error', error: err instanceof Error ? err.message : 'Generation failed' });
    }
  }, [id, selectedModel, updateShot, getEdges, getNode]);

  // ─── Video Generation ───

  const generateVideo = useCallback(async (index: number) => {
    const currentShots = (latestConfigRef.current?.shots as ShotEntry[]) ?? [];
    const shot = currentShots[index];
    if (!shot) return;

    const videoModelDef = getModelDefinition(selectedVideoModel);
    if (!videoModelDef) { updateShot(index, { videoStatus: 'error', videoError: 'Video model not found' }); return; }

    const provider = videoModelDef.provider ?? 'fal';
    const apiKey = provider === 'kie' ? getKieApiKey() : getApiKey();
    if (!apiKey) { updateShot(index, { videoStatus: 'error', videoError: `No ${provider} API key configured` }); return; }

    updateShot(index, { videoStatus: 'running', videoError: undefined });

    try {
      // Build video prompt from shot fields
      let videoPrompt = shot.prompt ?? '';
      if (shot.cameraPrompt) videoPrompt += ` Camera: ${shot.cameraPrompt}.`;
      if (shot.dialogue) videoPrompt += ` The character says: "${shot.dialogue}".`;

      const inputs: Record<string, unknown> = {
        prompt: videoPrompt,
        duration: shot.duration ?? 5,
        aspect_ratio: '16:9',
      };

      if (shot.negativePrompt) {
        inputs.negative_prompt = shot.negativePrompt;
      }

      // If the shot has a generated image, use it as the first frame
      if (shot.url) {
        const imageField = videoModelDef.inputs.find((f) => f.portType === 'image' && f.fieldType === 'port');
        if (imageField) {
          const imageParam = imageField.falParam;
          inputs[imageParam] = imageParam.endsWith('s') ? [shot.url] : shot.url;
        }
      }

      const effectiveModelId = videoModelDef.id;

      const result = await window.electronAPI.workflow.run({
        apiKey: getApiKey(), kieKey: getKieApiKey(), runpodKey: getRunpodApiKey(),
        runpodEndpointId: getRunpodEndpointId(selectedVideoModel), podUrl: getPodUrl(),
        nodeId: id, nodeType: selectedVideoModel, modelId: effectiveModelId, inputs,
      });

      const resultData = (result as Record<string, unknown>)?.data ?? result;
      const videoUrl = extractResultUrl(resultData, videoModelDef.responseMapping.path);
      updateShot(index, videoUrl ? { videoStatus: 'complete', videoUrl } : { videoStatus: 'error', videoError: 'No video in response' });
    } catch (err) {
      updateShot(index, { videoStatus: 'error', videoError: err instanceof Error ? err.message : 'Video generation failed' });
    }
  }, [id, selectedVideoModel, updateShot]);

  const generateAllVideos = useCallback(async () => {
    const currentShots = (latestConfigRef.current?.shots as ShotEntry[]) ?? [];
    const indices = currentShots.map((_, i) => i).filter((i) => currentShots[i]?.url);
    let next = 0;
    const runNext = async (): Promise<void> => {
      while (next < indices.length) {
        const idx = indices[next++];
        await generateVideo(idx);
      }
    };
    const pool: Promise<void>[] = [];
    for (let i = 0; i < Math.min(2, indices.length); i++) pool.push(runNext());
    await Promise.allSettled(pool);
  }, [generateVideo]);

  // ─── LLM Planning + Image Generation ───

  const generateAll = useCallback(async () => {
    const scenePrompt = findConnectedText();
    if (!scenePrompt) {
      const currentShots = (latestConfigRef.current?.shots as ShotEntry[]) ?? [];
      if (currentShots.length === 0) return;
      setPlanningStatus('generating');
      let next = 0;
      const runNext = async () => { while (next < currentShots.length) { const idx = next++; await generateImage(idx); } };
      const pool: Promise<void>[] = [];
      for (let i = 0; i < Math.min(3, currentShots.length); i++) pool.push(runNext());
      await Promise.allSettled(pool);
      setPlanningStatus('done');
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) return;

    setPlanningStatus('planning');
    try {
      const planPrompt = `Scene description: "${scenePrompt}"\n\nGenerate exactly ${shotCount} sequential cinematic shot descriptions for this scene. Each shot should progress the story.`;
      const llmResult = await window.electronAPI.workflow.run({
        apiKey, kieKey: getKieApiKey(), runpodKey: getRunpodApiKey(),
        runpodEndpointId: undefined, podUrl: getPodUrl(),
        nodeId: id, nodeType: 'openrouter-llm', modelId: 'openrouter/router',
        inputs: { prompt: planPrompt, system_prompt: STORYBOARD_SYSTEM_PROMPT, model: selectedLlm, temperature: 0.8, max_tokens: 2048 },
      });

      const llmData = (llmResult as Record<string, unknown>)?.data ?? llmResult;
      const rawText = (llmData as Record<string, unknown>)?.output as string ?? (llmData as Record<string, unknown>)?.text as string ?? '';

      let shotDescriptions: string[] = [];
      try {
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) shotDescriptions = JSON.parse(jsonMatch[0]);
      } catch {
        shotDescriptions = rawText.split('\n').filter((line) => line.trim().length > 10).slice(0, shotCount);
      }

      if (shotDescriptions.length === 0) { setPlanningStatus('idle'); return; }
      shotDescriptions = shotDescriptions.slice(0, shotCount);

      const newShots: ShotEntry[] = shotDescriptions.map((prompt) => ({
        prompt: prompt.replace(/^\d+[\.\):\-]\s*/, ''),
        url: null, status: 'idle' as const, duration: 5,
      }));

      const newConfig = { ...latestConfigRef.current, shots: newShots };
      latestConfigRef.current = newConfig;
      updateNodeData(id, { config: newConfig });

      setPlanningStatus('generating');
      let next = 0;
      const runNext = async () => { while (next < newShots.length) { const idx = next++; await generateImage(idx); } };
      const pool: Promise<void>[] = [];
      for (let i = 0; i < Math.min(3, newShots.length); i++) pool.push(runNext());
      await Promise.allSettled(pool);
      setPlanningStatus('done');
    } catch (err) {
      console.error('Storyboarder planning failed:', err);
      setPlanningStatus('idle');
    }
  }, [id, shotCount, selectedModel, selectedLlm, generateImage, updateNodeData, getEdges, getNode]);

  const clearAll = useCallback(() => {
    updateNodeData(id, { config: { ...data.config, shots: [] } });
    setSelectedCell(null);
    setPlanningStatus('idle');
  }, [id, data.config, updateNodeData]);

  // ─── Timeline Import ───

  const importToTimeline = useCallback(() => {
    let currentTimeline = getActiveTimeline(state);
    const track = currentTimeline.tracks[0];
    if (!track) return;

    let endTime = 0;
    for (const clip of currentTimeline.clips.filter((c) => c.trackId === track.id)) {
      const clipEnd = clip.startTime + clipEffectiveDuration(clip);
      if (clipEnd > endTime) endTime = clipEnd;
    }

    const currentShots = (latestConfigRef.current?.shots as ShotEntry[]) ?? [];
    for (const shot of currentShots) {
      const clipUrl = shot.videoUrl ?? shot.url;
      if (!clipUrl) continue;
      const isVideo = !!shot.videoUrl;
      const dur = shot.duration ?? 5;
      const asset: Asset = {
        id: generateId(),
        name: `Storyboard shot`,
        type: isVideo ? 'video' : 'image',
        url: clipUrl,
        thumbnailUrl: shot.url ?? clipUrl,
        duration: dur,
        createdAt: timestamp(),
      };
      dispatch({ type: 'ADD_ASSET', asset });
      currentTimeline = addClipToTrack(currentTimeline, track.id, asset, endTime);
      endTime += dur;
    }

    dispatch({
      type: 'SET_TIMELINE',
      timelineId: currentTimeline.id,
      timeline: currentTimeline,
    });
  }, [state, dispatch]);

  // ─── Duration drag ───

  const handleDurationDrag = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startDuration = shots[index]?.duration ?? 5;

    const onMove = (me: MouseEvent) => {
      const delta = (me.clientX - startX) / 20;
      const newDuration = Math.max(1, Math.min(30, Math.round(startDuration + delta)));
      updateShot(index, { duration: newDuration });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [shots, updateShot]);

  // ─── Drag to canvas ───

  const handleDragStart = useCallback((e: React.DragEvent, shot: ShotEntry, index: number) => {
    if (!shot.url) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/cinegen-shot', JSON.stringify({ url: shot.url, label: `Storyboard ${index + 1}` }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // ─── Playback ───

  const togglePlay = useCallback((index: number) => {
    const video = videoRefs.current.get(index);
    if (!video) return;
    if (playingIndex === index) {
      video.pause();
      setPlayingIndex(null);
    } else {
      video.currentTime = 0;
      video.play();
      setPlayingIndex(index);
    }
  }, [playingIndex]);

  const anyRunning = shots.some((s) => s.status === 'running') || planningStatus === 'planning' || planningStatus === 'generating';
  const anyVideoRunning = shots.some((s) => s.videoStatus === 'running');
  const accentColor = CATEGORY_COLORS['utility'];
  const cols = 3;
  const hasAnyImages = shots.some((s) => s.url);

  return (
    <div className={`cinegen-node storyboarder-node${selected ? ' cinegen-node--selected' : ''}`}>
      <div className="cinegen-node__accent" style={{ background: accentColor }} />
      <div className="cinegen-node__content">
        <div className="cinegen-node__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Storyboarder</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {/* Mode toggle */}
            <div className="storyboarder-node__mode-toggle nodrag">
              <button
                className={mode === 'image' ? 'active' : ''}
                onClick={() => updateNodeData(id, { config: { ...data.config, mode: 'image' } })}
              >
                Image
              </button>
              <button
                className={mode === 'video' ? 'active' : ''}
                onClick={() => updateNodeData(id, { config: { ...data.config, mode: 'video' } })}
              >
                Video
              </button>
            </div>
            {/* Settings */}
            <div style={{ position: 'relative' }} ref={settingsRef}>
              <button
                className="storyboarder-node__settings-btn nodrag"
                onClick={(e) => { e.stopPropagation(); setSettingsOpen(!settingsOpen); }}
                title="Settings"
              >
                &#x2699;
              </button>
              {settingsOpen && (
                <div className="storyboarder-node__settings-popover nodrag">
                  <div className="storyboarder-node__setting">
                    <label>Image Model</label>
                    <select value={selectedModel} onChange={(e) => updateNodeData(id, { config: { ...data.config, selectedModel: e.target.value } })}>
                      {imageModels.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                  </div>
                  {mode === 'video' && (
                    <div className="storyboarder-node__setting">
                      <label>Video Model</label>
                      <select value={selectedVideoModel} onChange={(e) => updateNodeData(id, { config: { ...data.config, selectedVideoModel: e.target.value } })}>
                        {videoModels.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="storyboarder-node__setting">
                    <label>Planning LLM</label>
                    <select value={selectedLlm} onChange={(e) => updateNodeData(id, { config: { ...data.config, selectedLlm: e.target.value } })}>
                      {LLM_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  <div className="storyboarder-node__setting">
                    <label>Shot Count</label>
                    <select value={shotCount} onChange={(e) => updateNodeData(id, { config: { ...data.config, shotCount: Number(e.target.value) } })}>
                      {SHOT_COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n} shots</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="cinegen-node__body">
          {/* Status bar */}
          {planningStatus === 'planning' && (
            <div className="storyboarder-node__status"><span className="storyboarder-node__spinner storyboarder-node__spinner--inline" /> Planning shots with {LLM_OPTIONS.find((o) => o.value === selectedLlm)?.label ?? 'LLM'}...</div>
          )}
          {planningStatus === 'generating' && (
            <div className="storyboarder-node__status"><span className="storyboarder-node__spinner storyboarder-node__spinner--inline" /> Generating images...</div>
          )}

          {/* Grid */}
          <div className="storyboarder-node__grid nodrag" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {shots.map((shot, i) => (
              <div
                key={i}
                className={[
                  'storyboarder-node__cell',
                  selectedCell === i && 'storyboarder-node__cell--selected',
                  shot.status === 'running' && 'storyboarder-node__cell--running',
                  shot.status === 'error' && 'storyboarder-node__cell--error',
                ].filter(Boolean).join(' ')}
                title={shot.status === 'error' ? shot.error : shot.prompt}
              >
                {/* Front / Back flip */}
                <div className={`storyboarder-node__card${shot.flipped ? ' storyboarder-node__card--flipped' : ''}`}>
                  {/* Front face */}
                  <div className="storyboarder-node__card-front" onClick={() => setSelectedCell(selectedCell === i ? null : i)}>
                    {shot.url ? (
                      <img className="storyboarder-node__cell-img" src={shot.url} alt={`Shot ${i + 1}`} draggable onDragStart={(e) => handleDragStart(e, shot, i)} />
                    ) : (
                      <div className="storyboarder-node__cell-placeholder">
                        <span style={{ fontSize: 16 }}>&#x1F3AC;</span>
                        <span>Shot {i + 1}</span>
                      </div>
                    )}
                    <span className="storyboarder-node__cell-label">
                      {shot.prompt ? `${i + 1}. ${shot.prompt.split(/[.!,]/).at(0)?.slice(0, 40) ?? ''}` : `Shot ${i + 1}`}
                    </span>
                    {shot.status === 'running' && (
                      <div className="storyboarder-node__cell-spinner"><div className="storyboarder-node__spinner" /></div>
                    )}
                    {/* Video badge */}
                    {mode === 'video' && shot.videoStatus === 'complete' && (
                      <span className="storyboarder-node__video-badge">&#x25B6;</span>
                    )}
                    {mode === 'video' && shot.videoStatus === 'running' && (
                      <div className="storyboarder-node__cell-spinner"><div className="storyboarder-node__spinner" /></div>
                    )}
                  </div>

                  {/* Back face — video settings */}
                  <div className="storyboarder-node__card-back">
                    <div className="storyboarder-node__back-field">
                      <label>Camera</label>
                      <input type="text" placeholder="e.g. slow dolly in" value={shot.cameraPrompt ?? ''} onChange={(e) => updateShot(i, { cameraPrompt: e.target.value })} />
                    </div>
                    <div className="storyboarder-node__back-field">
                      <label>Dialogue</label>
                      <input type="text" placeholder="Character says..." value={shot.dialogue ?? ''} onChange={(e) => updateShot(i, { dialogue: e.target.value })} />
                    </div>
                    <div className="storyboarder-node__back-field">
                      <label>Negative</label>
                      <input type="text" placeholder="Things to avoid" value={shot.negativePrompt ?? ''} onChange={(e) => updateShot(i, { negativePrompt: e.target.value })} />
                    </div>
                  </div>
                </div>

                {/* Flip button */}
                {mode === 'video' && (
                  <button
                    className="storyboarder-node__flip-btn"
                    onClick={(e) => { e.stopPropagation(); updateShot(i, { flipped: !shot.flipped }); }}
                    title={shot.flipped ? 'Show preview' : 'Shot settings'}
                  >
                    &#x21C5;
                  </button>
                )}

                {/* Regen button */}
                <button
                  className="storyboarder-node__cell-regen"
                  onClick={(e) => { e.stopPropagation(); mode === 'video' && shot.url ? generateVideo(i) : generateImage(i); }}
                  disabled={shot.status === 'running' || shot.videoStatus === 'running' || planningStatus === 'planning' || planningStatus === 'generating'}
                  title={mode === 'video' && shot.url ? 'Regenerate video' : 'Regenerate image'}
                >
                  &#x21BB;
                </button>
              </div>
            ))}
          </div>

          {/* Prompt editor for selected cell */}
          {selectedCell !== null && selectedCell < shots.length && (
            <div className="storyboarder-node__prompt-editor nodrag">
              <div className="storyboarder-node__prompt-editor-label">Shot {selectedCell + 1}</div>
              <textarea
                value={shots[selectedCell]?.prompt ?? ''}
                onChange={(e) => updateShot(selectedCell, { prompt: e.target.value })}
                rows={3}
              />
            </div>
          )}

          {/* ─── Video Timeline Strip ─── */}
          {mode === 'video' && hasAnyImages && (
            <div className="storyboarder-node__timeline nodrag">
              <div className="storyboarder-node__timeline-label">Timeline</div>
              <div className="storyboarder-node__timeline-strip">
                {shots.map((shot, i) => (
                  <div
                    key={i}
                    className={`storyboarder-node__timeline-clip${shot.videoStatus === 'complete' ? ' storyboarder-node__timeline-clip--has-video' : ''}`}
                  >
                    <div className="storyboarder-node__timeline-thumb">
                      {shot.videoUrl ? (
                        <video
                          ref={(el) => { if (el) videoRefs.current.set(i, el); }}
                          src={shot.videoUrl}
                          muted
                          playsInline
                          onEnded={() => setPlayingIndex(null)}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : shot.url ? (
                        <img src={shot.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{i + 1}</span>
                      )}
                      {shot.videoUrl && (
                        <button className="storyboarder-node__timeline-play" onClick={() => togglePlay(i)}>
                          {playingIndex === i ? '\u23F8' : '\u25B6'}
                        </button>
                      )}
                    </div>
                    <div
                      className="storyboarder-node__timeline-duration"
                      onMouseDown={(e) => handleDurationDrag(i, e)}
                      title="Drag to adjust duration"
                    >
                      {shot.duration ?? 5}s
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="storyboarder-node__actions">
            <button onClick={generateAll} disabled={anyRunning}>
              {planningStatus === 'planning' ? 'Planning...' : planningStatus === 'generating' ? 'Generating...' : rawShots.length > 0 ? '\u2192 Regenerate All' : '\u2192 Storyboard'}
            </button>
            {mode === 'video' && hasAnyImages && (
              <button onClick={generateAllVideos} disabled={anyVideoRunning || anyRunning}>
                {anyVideoRunning ? 'Generating Videos...' : '\u2192 Generate Videos'}
              </button>
            )}
            {hasAnyImages && (
              <button onClick={importToTimeline}>
                Import to Timeline
              </button>
            )}
            <button onClick={clearAll} disabled={anyRunning}>Clear All</button>
          </div>
        </div>
      </div>

      {/* Input handles */}
      <Handle type="target" position={Position.Left} id="image" style={{ background: PORT_COLORS['image'], width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--bg-raised)', top: HEADER_HEIGHT + PORT_SPACING / 2 }} />
      <Handle type="target" position={Position.Left} id="text" style={{ background: PORT_COLORS['text'], width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--bg-raised)', top: HEADER_HEIGHT + PORT_SPACING + PORT_SPACING / 2 }} />
      <span className="base-node__port-label base-node__port-label--left" style={{ top: HEADER_HEIGHT + PORT_SPACING / 2 }}>Image</span>
      <span className="base-node__port-label base-node__port-label--left" style={{ top: HEADER_HEIGHT + PORT_SPACING + PORT_SPACING / 2 }}>Scene</span>
    </div>
  );
}

export const StoryboarderNode = memo(StoryboarderNodeInner);
