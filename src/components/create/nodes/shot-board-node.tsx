import { memo, useCallback, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, type Node } from '@xyflow/react';
import { ALL_MODELS, getModelDefinition } from '@/lib/fal/models';
import { CATEGORY_COLORS, PORT_COLORS } from '@/lib/workflows/node-registry';
import { getApiKey, getKieApiKey, getRunpodApiKey, getRunpodEndpointId, getPodUrl } from '@/lib/utils/api-key';
import type { WorkflowNodeData } from '@/types/workflow';

type ShotBoardNodeProps = NodeProps & { data: WorkflowNodeData };

interface ShotEntry {
  prompt: string;
  url: string | null;
  status: 'idle' | 'running' | 'complete' | 'error';
  error?: string;
}

const SHOT_LABELS = [
  'Wide', 'Full front', 'Low angle',
  'Medium front', 'Side profile', 'Over shoulder',
  'Close front', '3/4 turn', 'Extreme CU',
];

const PROMPT_PREFIX = 'Recreate the exact same person from the reference image — same face, hair, skin tone, body type, clothing, and accessories. Keep the same environment, lighting, color palette, and atmosphere. Do not change or replace the character. Only change the camera angle and framing as described: ';

const HEADER_HEIGHT = 36;
const PORT_SPACING = 24;

function ShotBoardNodeInner({ id, data, selected }: ShotBoardNodeProps) {
  const { updateNodeData, getEdges, getNode } = useReactFlow();
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const selectedModel = (data.config?.selectedModel as string) ?? 'nano-banana-2';
  const shots: ShotEntry[] = (data.config?.shots as ShotEntry[]) ?? [];

  const imageModels = Object.entries(ALL_MODELS)
    .filter(([, m]) => m.category === 'image')
    .map(([key, m]) => ({ key, name: m.name }));

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

  // Use a ref to avoid stale closures during concurrent Generate All
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

  const generateShot = useCallback(async (index: number) => {
    const imageUrl = findConnectedImageUrl();
    if (!imageUrl) {
      updateShot(index, { status: 'error', error: 'No reference image connected' });
      return;
    }

    const modelDef = getModelDefinition(selectedModel);
    if (!modelDef) {
      updateShot(index, { status: 'error', error: 'Model not found' });
      return;
    }

    const provider = modelDef.provider ?? 'fal';
    const apiKey = provider === 'kie' ? getKieApiKey() : getApiKey();
    if (!apiKey) {
      updateShot(index, { status: 'error', error: `No ${provider} API key configured` });
      return;
    }

    updateShot(index, { status: 'running', error: undefined });

    try {
      const currentShots = (latestConfigRef.current?.shots as ShotEntry[]) ?? shots;
      const basePrompt = findConnectedText();
      const fullPrompt = PROMPT_PREFIX + (basePrompt ? basePrompt + ' ' : '') + currentShots[index].prompt;

      // Build image input based on model's falParam
      const imageField = modelDef.inputs.find((f) => f.portType === 'image' && f.fieldType === 'port');
      const imageParam = imageField?.falParam ?? 'image_urls';
      const imageValue = imageParam.endsWith('s') ? [imageUrl] : imageUrl;

      // Use altId (edit endpoint) when available since we always have a reference image
      const effectiveModelId = modelDef.altId ?? modelDef.id;

      const result = await window.electronAPI.workflow.run({
        apiKey: getApiKey(),
        kieKey: getKieApiKey(),
        runpodKey: getRunpodApiKey(),
        runpodEndpointId: getRunpodEndpointId(selectedModel),
        podUrl: getPodUrl(),
        nodeId: id,
        nodeType: selectedModel,
        modelId: effectiveModelId,
        inputs: { prompt: fullPrompt, [imageParam]: imageValue, aspect_ratio: '16:9', resolution: '1K' },
      });

      // Extract URL from result using the model's response mapping
      const resultData = (result as Record<string, unknown>)?.data ?? result;
      const urlPath = modelDef.responseMapping.path;
      let url: string | undefined;
      const parts = urlPath.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current: unknown = resultData;
      for (const part of parts) {
        if (current == null || typeof current !== 'object') { current = undefined; break; }
        current = (current as Record<string, unknown>)[part];
      }
      url = typeof current === 'string' ? current : undefined;

      if (url) {
        updateShot(index, { status: 'complete', url });
      } else {
        updateShot(index, { status: 'error', error: 'No image in response' });
      }
    } catch (err) {
      updateShot(index, { status: 'error', error: err instanceof Error ? err.message : 'Generation failed' });
    }
  }, [id, shots, selectedModel, updateShot, getEdges, getNode]);

  const generateAll = useCallback(async () => {
    // Concurrency limit of 3
    const indices = shots.map((_, i) => i);
    let next = 0;

    const runNext = async (): Promise<void> => {
      while (next < indices.length) {
        const idx = next++;
        await generateShot(idx);
      }
    };

    const pool: Promise<void>[] = [];
    for (let i = 0; i < Math.min(3, indices.length); i++) {
      pool.push(runNext());
    }
    await Promise.allSettled(pool);
  }, [shots, generateShot]);

  const clearAll = useCallback(() => {
    const cleared = shots.map((s) => ({ ...s, url: null, status: 'idle' as const, error: undefined }));
    updateNodeData(id, { config: { ...data.config, shots: cleared } });
    setSelectedCell(null);
  }, [id, data.config, shots, updateNodeData]);

  const handleDragStart = useCallback((e: React.DragEvent, shot: ShotEntry, index: number) => {
    if (!shot.url) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/cinegen-shot', JSON.stringify({
      url: shot.url,
      label: SHOT_LABELS[index],
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const anyRunning = shots.some((s) => s.status === 'running');
  const accentColor = CATEGORY_COLORS['utility'];

  return (
    <div className={`cinegen-node shot-board-node${selected ? ' cinegen-node--selected' : ''}`}>
      <div className="cinegen-node__accent" style={{ background: accentColor }} />
      <div className="cinegen-node__content">
        <div className="cinegen-node__header">Shot Ideas</div>
        <div className="cinegen-node__body">
          {/* Model selector */}
          <select
            className="shot-board-node__model-select nodrag"
            value={selectedModel}
            onChange={(e) => updateNodeData(id, { config: { ...data.config, selectedModel: e.target.value } })}
          >
            {imageModels.map((m) => (
              <option key={m.key} value={m.key}>{m.name}</option>
            ))}
          </select>

          {/* 3x3 Grid */}
          <div className="shot-board-node__grid nodrag">
            {shots.map((shot, i) => (
              <div
                key={i}
                className={[
                  'shot-board-node__cell',
                  selectedCell === i && 'shot-board-node__cell--selected',
                  shot.status === 'running' && 'shot-board-node__cell--running',
                  shot.status === 'error' && 'shot-board-node__cell--error',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelectedCell(selectedCell === i ? null : i)}
                title={shot.status === 'error' ? shot.error : shot.prompt}
              >
                {shot.url ? (
                  <img
                    className="shot-board-node__cell-img"
                    src={shot.url}
                    alt={SHOT_LABELS[i]}
                    draggable
                    onDragStart={(e) => handleDragStart(e, shot, i)}
                  />
                ) : (
                  <div className="shot-board-node__cell-placeholder">
                    <span style={{ fontSize: 18 }}>&#x1F3AC;</span>
                    <span>{SHOT_LABELS[i]}</span>
                  </div>
                )}
                <span className="shot-board-node__cell-label">{SHOT_LABELS[i]}</span>
                {shot.status === 'running' && (
                  <div className="shot-board-node__cell-spinner"><div className="shot-board-node__spinner" /></div>
                )}
                <button
                  className="shot-board-node__cell-regen"
                  onClick={(e) => { e.stopPropagation(); generateShot(i); }}
                  disabled={anyRunning}
                  title="Regenerate"
                >
                  &#x21BB;
                </button>
              </div>
            ))}
          </div>

          {/* Prompt editor for selected cell */}
          {selectedCell !== null && (
            <div className="shot-board-node__prompt-editor nodrag">
              <div className="shot-board-node__prompt-editor-label">
                Shot {selectedCell + 1}: {SHOT_LABELS[selectedCell]}
              </div>
              <textarea
                value={shots[selectedCell]?.prompt ?? ''}
                onChange={(e) => updateShot(selectedCell, { prompt: e.target.value })}
                rows={2}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="shot-board-node__actions">
            <button onClick={generateAll} disabled={anyRunning}>
              {anyRunning ? 'Generating...' : '\u2192 Generate All'}
            </button>
            <button onClick={clearAll} disabled={anyRunning}>
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{
          background: PORT_COLORS['image'],
          width: 12, height: 12, borderRadius: '50%',
          border: '2px solid var(--bg-raised)',
          top: HEADER_HEIGHT + PORT_SPACING / 2,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{
          background: PORT_COLORS['text'],
          width: 12, height: 12, borderRadius: '50%',
          border: '2px solid var(--bg-raised)',
          top: HEADER_HEIGHT + PORT_SPACING + PORT_SPACING / 2,
        }}
      />

      {/* Port labels */}
      <span
        className="base-node__port-label base-node__port-label--left"
        style={{ top: HEADER_HEIGHT + PORT_SPACING / 2 }}
      >
        Image
      </span>
      <span
        className="base-node__port-label base-node__port-label--left"
        style={{ top: HEADER_HEIGHT + PORT_SPACING + PORT_SPACING / 2 }}
      >
        Prompt
      </span>
    </div>
  );
}

export const ShotBoardNode = memo(ShotBoardNodeInner);
