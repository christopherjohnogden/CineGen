import type { Node, Edge } from '@xyflow/react';
import { topologicalSort } from './topo-sort';
import { NODE_REGISTRY } from './node-registry';
import {
  getLayerDecomposeAutoPrompts,
  getLayerDecomposeStageLabel,
  getLayerDecomposeStageProgress,
  isLayerDecomposeNodeType,
  LAYER_DECOMPOSE_VISION_MODEL_ID,
  LAYER_DECOMPOSE_VISION_PROMPT,
  mergeLayerDecomposePrompts,
  parseLayerDecomposeVisionMaskLabels,
  parseLayerDecomposeVisionOutput,
} from './layer-decompose';
import { getModelDefinition } from '@/lib/fal/models';
import type { TranscriptSegment, TranscriptWord, WorkflowNodeData } from '@/types/workflow';
import type { Element } from '@/types/elements';
import { getApiKey, getKieApiKey, getRunpodApiKey, getRunpodEndpointId, getPodUrl } from '@/lib/utils/api-key';

interface WorkflowDispatch {
  setNodeRunning: (nodeId: string, running: boolean) => void;
  setNodeResult: (nodeId: string, result: WorkflowNodeData['result']) => void;
  addGeneration: (nodeId: string, url: string) => void;
  addAsset: (asset: {
    id: string;
    name: string;
    type: 'image' | 'video';
    url: string;
    createdAt: string;
  }) => void;
  getElements: () => Element[];
}

/** Data shape output by an Element node. */
interface ElementData {
  frontalImageUrl: string;
  referenceImageUrls: string[];
  allUrls: string[];
  name: string;
}

interface LayerDecomposeVisionHints {
  prompts: string[];
  masks: Array<{ url: string; label: string }>;
}

const LAYER_DECOMPOSE_CLOUD_CONFIG_VERSION = 2;
const LAYER_DECOMPOSE_CLOUD_DEFAULT_MAX_MASKS = 12;
const LAYER_DECOMPOSE_VISION_TIMEOUT_MS = 5000;
const LAYER_DECOMPOSE_VISION_COOLDOWN_MS = 60000;
const layerDecomposeVisionPromptCache = new Map<string, LayerDecomposeVisionHints>();
const layerDecomposeVisionCooldownCache = new Map<string, number>();
const WHISPERX_STAGE_PROGRESS: Record<string, number> = {
  init: 5,
  loading: 12,
  preparing_audio: 24,
  transcribing: 46,
  segments_ready: 58,
  loading_align_model: 62,
  aligning_words: 78,
  diarizing: 88,
  diarize_skip: 90,
  finalizing: 96,
};

function getNodeStageProgress(nodeType: string, stage?: string): number | undefined {
  if (!stage) return undefined;
  if (isLayerDecomposeNodeType(nodeType)) {
    return getLayerDecomposeStageProgress(stage);
  }
  if (nodeType === 'whisperx-local') {
    return WHISPERX_STAGE_PROGRESS[stage];
  }
  return undefined;
}

function buildRunningResult(
  nodeType: string,
  stage?: string,
  message?: string,
  extras?: Partial<NonNullable<WorkflowNodeData['result']>>,
): WorkflowNodeData['result'] {
  const progress = getNodeStageProgress(nodeType, stage);
  return {
    ...extras,
    status: 'running',
    ...(progress !== undefined && { progress }),
    ...(stage && { progressStage: stage }),
    ...((message ?? getLayerDecomposeStageLabel(stage)) && {
      progressMessage: message ?? getLayerDecomposeStageLabel(stage),
    }),
  };
}

function isRemoteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

async function generateLayerDecomposeVisionPrompts(
  nodeId: string,
  imageUrl: string,
): Promise<LayerDecomposeVisionHints> {
  if (!isRemoteUrl(imageUrl)) return { prompts: [], masks: [] };
  const apiKey = getApiKey();
  if (!apiKey) return { prompts: [], masks: [] };
  const cached = layerDecomposeVisionPromptCache.get(imageUrl);
  if (cached) return cached;
  const cooldownUntil = layerDecomposeVisionCooldownCache.get(imageUrl);
  if (cooldownUntil && cooldownUntil > Date.now()) return { prompts: [], masks: [] };

  try {
    const result = await Promise.race([
      window.electronAPI.workflow.run({
        apiKey,
        kieKey: getKieApiKey(),
        runpodKey: getRunpodApiKey(),
        runpodEndpointId: '',
        podUrl: getPodUrl(),
        nodeId,
        nodeType: 'layer-decompose-vision',
        modelId: LAYER_DECOMPOSE_VISION_MODEL_ID,
        inputs: {
          image_url: imageUrl,
          prompt: LAYER_DECOMPOSE_VISION_PROMPT,
        },
      }),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('Vision prepass timed out')), LAYER_DECOMPOSE_VISION_TIMEOUT_MS);
      }),
    ]);
    const rawOutput = extractValue(result, 'output')
      ?? extractValue(result, 'text')
      ?? extractValue(result, 'response')
      ?? extractValue(result, 'answer');
    const prompts = parseLayerDecomposeVisionOutput(rawOutput, 18);
    const maskLabels = parseLayerDecomposeVisionMaskLabels(rawOutput, 18);
    const rawMasks = extractValue(result, 'masks');
    const masks = Array.isArray(rawMasks)
      ? rawMasks
        .map((mask, index) => {
          const url = extractValue(mask, 'url');
          if (typeof url !== 'string') return null;
          return {
            url,
            label: maskLabels[index] ?? prompts[index] ?? `vision layer ${index + 1}`,
          };
        })
        .filter((mask): mask is { url: string; label: string } => Boolean(mask))
      : [];
    const hints = { prompts, masks };
    if (prompts.length > 0 || masks.length > 0) {
      layerDecomposeVisionPromptCache.set(imageUrl, hints);
    }
    return hints;
  } catch (error) {
    console.warn('[layer-decompose] Vision prepass failed:', error);
    layerDecomposeVisionCooldownCache.set(imageUrl, Date.now() + LAYER_DECOMPOSE_VISION_COOLDOWN_MS);
    return { prompts: [], masks: [] };
  }
}

function getNormalizedLayerDecomposeCloudMaxMasks(data: WorkflowNodeData, falInputs: Record<string, unknown>): number {
  const raw = Number(falInputs.max_masks ?? data.config.max_masks ?? LAYER_DECOMPOSE_CLOUD_DEFAULT_MAX_MASKS);
  const normalized = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : LAYER_DECOMPOSE_CLOUD_DEFAULT_MAX_MASKS;
  const configVersion = Number(data.config.__layerDecomposeVersion ?? 1);
  if (data.type === 'layer-decompose-cloud' && configVersion < LAYER_DECOMPOSE_CLOUD_CONFIG_VERSION && normalized === 4) {
    return LAYER_DECOMPOSE_CLOUD_DEFAULT_MAX_MASKS;
  }
  return normalized;
}

async function loadImageDataFromUrl(
  url: string,
  width?: number,
  height?: number,
): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load image data: ${res.status}`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width ?? bitmap.width;
  canvas.height = height ?? bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function buildMaskAlpha(maskData: ImageData): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(maskData.width * maskData.height);
  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    alpha[i] = Math.max(
      maskData.data[offset] ?? 0,
      maskData.data[offset + 1] ?? 0,
      maskData.data[offset + 2] ?? 0,
      maskData.data[offset + 3] ?? 0,
    );
  }
  return alpha;
}

function computeMaskBBox(alpha: Uint8ClampedArray, width: number, height: number): number[] | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = alpha[y * width + x];
      if (value < 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) return undefined;
  return [minX, minY, maxX + 1, maxY + 1];
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function uploadCanvasAsPng(canvas: HTMLCanvasElement, name: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No fal.ai API key provided. Add one in Settings.');

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (!nextBlob) {
        reject(new Error('Could not encode PNG'));
        return;
      }
      resolve(nextBlob);
    }, 'image/png');
  });

  const buffer = await blob.arrayBuffer();
  const result = await window.electronAPI.elements.upload(
    { buffer, name, type: 'image/png' },
    apiKey,
  );
  return result.url;
}

function roundTranscriptTime(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(Math.max(0, parsed) * 1000) / 1000;
}

function appendTranscriptToken(text: string, token: string): string {
  const trimmedToken = token.trim();
  if (!trimmedToken) return text;
  if (!text) return trimmedToken;
  if (/^[,.;:!?%)\]}]/.test(trimmedToken) || /^['’]/.test(trimmedToken)) {
    return `${text}${trimmedToken}`;
  }
  return `${text} ${trimmedToken}`;
}

function normalizeTranscriptSpeaker(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractTranscriptLanguage(result: unknown): string {
  const candidates = [
    extractValue(result, 'language'),
    extractValue(result, 'languages'),
    extractValue(result, 'inferred_languages'),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (Array.isArray(candidate)) {
      const language = candidate.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      if (language) return language.trim();
    }
  }
  return '';
}

function buildSegmentsFromWordChunks(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  const flushCurrent = () => {
    if (!current) return;
    current.text = current.text.trim();
    if (current.text || (current.words?.length ?? 0) > 0) {
      segments.push(current);
    }
    current = null;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!current) {
      current = {
        start: word.start,
        end: word.end,
        text: '',
        ...(word.speaker ? { speaker: word.speaker } : {}),
        words: [],
      };
    }

    current.words!.push(word);
    current.end = word.end;
    current.text = appendTranscriptToken(current.text, word.word);
    if (!current.speaker && word.speaker) current.speaker = word.speaker;

    const nextWord = words[i + 1];
    const gap = nextWord ? Math.max(0, nextWord.start - word.end) : 0;
    const speakerChange = Boolean(nextWord) && (nextWord.speaker ?? null) !== (current.speaker ?? null);
    const duration = current.end - current.start;
    const endsSentence = /[.!?]["')\]]*$/.test(word.word);
    const pauseBreak = gap >= 0.85 || (gap >= 0.45 && /[,;:]$/.test(word.word));
    const durationBreak = duration >= 12;

    if (!nextWord || endsSentence || pauseBreak || durationBreak || speakerChange) {
      flushCurrent();
    }
  }

  flushCurrent();
  return segments;
}

function normalizeCloudTranscriptResult(
  result: unknown,
  options: { chunkLevel?: string },
): {
  transcript: string;
  segments: TranscriptSegment[];
  language: string;
  hasWordTimestamps: boolean;
} {
  const rawText = extractValue(result, 'text');
  const rawChunks = extractValue(result, 'chunks');
  const chunkLevel = String(options.chunkLevel ?? '').trim().toLowerCase();

  const normalizedChunks = Array.isArray(rawChunks)
    ? rawChunks.flatMap((chunk) => {
      if (!chunk || typeof chunk !== 'object') return [];
      const text = typeof (chunk as { text?: unknown }).text === 'string'
        ? (chunk as { text: string }).text.trim()
        : '';
      const timestamp = (chunk as { timestamp?: unknown }).timestamp;
      const start = Array.isArray(timestamp) ? roundTranscriptTime(timestamp[0]) : undefined;
      const end = Array.isArray(timestamp) ? roundTranscriptTime(timestamp[1]) : undefined;
      const speaker = normalizeTranscriptSpeaker((chunk as { speaker?: unknown }).speaker);
      if (!text && start === undefined && end === undefined) return [];
      return [{ text, start, end, speaker }];
    })
    : [];

  const wordChunks = chunkLevel === 'word'
    ? normalizedChunks.flatMap((chunk): TranscriptWord[] => {
      if (!chunk.text || chunk.start === undefined || chunk.end === undefined) return [];
      return [{
        word: chunk.text,
        start: chunk.start,
        end: chunk.end,
        ...(chunk.speaker ? { speaker: chunk.speaker } : {}),
      }];
    })
    : [];

  const segments = wordChunks.length > 0
    ? buildSegmentsFromWordChunks(wordChunks)
    : normalizedChunks.map((chunk): TranscriptSegment => ({
      start: chunk.start ?? 0,
      end: chunk.end ?? chunk.start ?? 0,
      text: chunk.text,
      ...(chunk.speaker ? { speaker: chunk.speaker } : {}),
    }));

  const transcript = typeof rawText === 'string'
    ? rawText
    : segments.map((segment) => segment.text).filter(Boolean).join(' ');
  const language = extractTranscriptLanguage(result);

  return {
    transcript,
    segments,
    language,
    hasWordTimestamps: wordChunks.length > 0,
  };
}

async function normalizeCloudTranscriptionInputs(
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const normalized = { ...inputs };
  if (normalized.version !== undefined && normalized.version !== null) {
    normalized.version = String(normalized.version).trim();
  }

  if (typeof normalized.language === 'string' && normalized.language.trim() === '') {
    delete normalized.language;
  }
  if (typeof normalized.prompt === 'string' && normalized.prompt.trim() === '') {
    delete normalized.prompt;
  }
  if (normalized.num_speakers !== undefined && normalized.num_speakers !== null) {
    const numSpeakers = Number(normalized.num_speakers);
    if (!Number.isFinite(numSpeakers) || numSpeakers <= 0) {
      delete normalized.num_speakers;
    } else {
      normalized.num_speakers = Math.floor(numSpeakers);
    }
  }

  if (typeof normalized.audio_url === 'string' && normalized.audio_url.startsWith('local-media://file')) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('No fal.ai API key provided. Add one in Settings.');
    }
    const uploaded = await window.electronAPI.elements.uploadTranscriptionSource(normalized.audio_url, apiKey);
    normalized.audio_url = uploaded.url;
  }

  return normalized;
}

async function buildCloudLayerAssets(
  nodeId: string,
  sourceImageUrl: string,
  masks: Array<{ url: string; label: string; score?: number; bbox?: number[]; source?: string }>,
): Promise<{
  backgroundPlateUrl: string;
  layers: Array<{ url: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>;
}> {
  const sourceData = await loadImageDataFromUrl(sourceImageUrl);
  const combinedAlpha = new Uint8ClampedArray(sourceData.width * sourceData.height);
  const extractedLayers: Array<{ url: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }> = [];

  for (let i = 0; i < masks.length; i++) {
    const maskData = await loadImageDataFromUrl(masks[i].url, sourceData.width, sourceData.height);
    const maskAlpha = buildMaskAlpha(maskData);
    const bbox = computeMaskBBox(maskAlpha, sourceData.width, sourceData.height);
    if (!bbox) continue;

    const layerImage = new ImageData(sourceData.width, sourceData.height);
    for (let px = 0; px < maskAlpha.length; px++) {
      const alpha = maskAlpha[px];
      combinedAlpha[px] = Math.max(combinedAlpha[px], alpha);
      const offset = px * 4;
      layerImage.data[offset] = sourceData.data[offset];
      layerImage.data[offset + 1] = sourceData.data[offset + 1];
      layerImage.data[offset + 2] = sourceData.data[offset + 2];
      layerImage.data[offset + 3] = alpha;
    }

    const layerCanvas = imageDataToCanvas(layerImage);
    const layerName = `${formatLayerLabel(masks[i].label)} ${i + 1}`;
    const uploadedUrl = await uploadCanvasAsPng(layerCanvas, `layer-decompose-${nodeId}-layer-${i + 1}.png`);
    extractedLayers.push({
      url: uploadedUrl,
      name: layerName,
      type: masks[i].label,
      z_order: i + 1,
      metadata: {
        ...(masks[i].score !== undefined && { confidence: masks[i].score }),
        bbox,
        ...(masks[i].source && { source: masks[i].source }),
      },
    });
  }

  const backgroundImage = new ImageData(sourceData.width, sourceData.height);
  for (let px = 0; px < combinedAlpha.length; px++) {
    const offset = px * 4;
    backgroundImage.data[offset] = sourceData.data[offset];
    backgroundImage.data[offset + 1] = sourceData.data[offset + 1];
    backgroundImage.data[offset + 2] = sourceData.data[offset + 2];
    backgroundImage.data[offset + 3] = 255 - combinedAlpha[px];
  }
  const backgroundCanvas = imageDataToCanvas(backgroundImage);
  const backgroundPlateUrl = await uploadCanvasAsPng(backgroundCanvas, `layer-decompose-${nodeId}-background-plate.png`);

  return {
    backgroundPlateUrl,
    layers: extractedLayers,
  };
}

async function enrichCloudMasksWithBBoxes(
  sourceImageUrl: string,
  masks: Array<{ url: string; label: string; score?: number; bbox?: number[]; source?: string }>,
): Promise<Array<{ url: string; label: string; score?: number; bbox?: number[]; source?: string }>> {
  if (masks.length === 0 || masks.every((mask) => Array.isArray(mask.bbox) && mask.bbox.length >= 4)) {
    return masks;
  }

  const sourceData = await loadImageDataFromUrl(sourceImageUrl);
  return Promise.all(masks.map(async (mask) => {
    if (Array.isArray(mask.bbox) && mask.bbox.length >= 4) return mask;
    try {
      const maskData = await loadImageDataFromUrl(mask.url, sourceData.width, sourceData.height);
      const maskAlpha = buildMaskAlpha(maskData);
      const bbox = computeMaskBBox(maskAlpha, sourceData.width, sourceData.height);
      return bbox ? { ...mask, bbox } : mask;
    } catch (error) {
      console.warn('[layer-decompose-cloud] Failed to compute mask bbox:', error);
      return mask;
    }
  }));
}

export async function executeWorkflow(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  dispatch: WorkflowDispatch,
): Promise<void> {
  const order = topologicalSort(nodes, edges);
  await runNodes(order, nodes, edges, dispatch);
}

export async function executeFromNode(
  targetNodeId: string,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  dispatch: WorkflowDispatch,
): Promise<void> {
  const upstream = getUpstreamNodes(targetNodeId, nodes, edges);
  upstream.push(targetNodeId);

  const subgraphNodes = nodes.filter((n) => upstream.includes(n.id));
  const subgraphEdges = edges.filter(
    (e) => upstream.includes(e.source) && upstream.includes(e.target),
  );

  const order = topologicalSort(subgraphNodes, subgraphEdges);
  await runNodes(order, nodes, edges, dispatch, targetNodeId);
}

function getUpstreamNodes(
  nodeId: string,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
): string[] {
  const visited = new Set<string>();
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const edge of edges) {
      if (edge.target === current && !visited.has(edge.source)) {
        visited.add(edge.source);
        stack.push(edge.source);
      }
    }
  }

  return Array.from(visited);
}

async function runNodes(
  order: string[],
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  dispatch: WorkflowDispatch,
  targetNodeId?: string,
): Promise<void> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const results = new Map<string, Record<string, unknown>>();

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const nodeType = node.data.type;
    const definition = NODE_REGISTRY[nodeType];
    if (!definition) continue;

    const portInputs = resolveInputs(definition.inputs, edges, nodeId, results);

    if (definition.category === 'utility') {
      results.set(nodeId, resolveUtilityOutputs(nodeType, definition.outputs, node.data, dispatch));
      continue;
    }

    if (definition.isModel) {
      const existingUrl = node.data.result?.url;
      if (targetNodeId && nodeId !== targetNodeId && existingUrl) {
        const modelDef = getModelDefinition(nodeType);
        if (modelDef) {
          results.set(nodeId, { [modelDef.outputType]: existingUrl });
        }
        continue;
      }

      // Resolve element-list indexed inputs from edges
      const elementListInputs = resolveElementListInputs(edges, nodeId, results);

      await executeModelNode(nodeId, nodeType, node.data, { ...portInputs, ...elementListInputs }, results, dispatch);
    }
  }
}

/**
 * Resolve standard port inputs from edges.
 */
function resolveInputs(
  portDefs: { id: string }[],
  edges: Edge[],
  nodeId: string,
  results: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const input of portDefs) {
    const incomingEdge = edges.find(
      (e) => e.target === nodeId && e.targetHandle === input.id,
    );
    if (incomingEdge) {
      const sourceResult = results.get(incomingEdge.source);
      if (sourceResult && incomingEdge.sourceHandle) {
        inputs[input.id] = sourceResult[incomingEdge.sourceHandle];
      }
    }
  }
  return inputs;
}

/**
 * Resolve dynamically-indexed element-list inputs (e.g., elements_0, elements_1, extra_images_0).
 * These are created by model-node.tsx for element-list fields.
 */
function resolveElementListInputs(
  edges: Edge[],
  nodeId: string,
  results: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const handle = edge.targetHandle;
    if (!handle || !/_\d+$/.test(handle)) continue;

    const sourceResult = results.get(edge.source);
    if (sourceResult && edge.sourceHandle) {
      inputs[handle] = sourceResult[edge.sourceHandle];
    }
  }
  return inputs;
}

function resolveUtilityOutputs(
  nodeType: string,
  outputs: { id: string }[],
  data: WorkflowNodeData,
  dispatch: WorkflowDispatch,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const port of outputs) {
    switch (nodeType) {
      case 'prompt':
        output[port.id] = data.config.prompt;
        break;
      case 'shotPrompt':
        output[port.id] = data.config.shots;
        break;
      case 'compositionPlan':
        output[port.id] = {
          positiveGlobalStyles: data.config.positiveGlobalStyles,
          negativeGlobalStyles: data.config.negativeGlobalStyles,
          sections: data.config.sections,
        };
        break;
      case 'musicPrompt':
        output[port.id] = data.config.generatedPrompt ?? '';
        break;
      case 'filePicker': {
        const fileUrl = data.config.fileUrl as string;
        if (fileUrl) {
          output['media'] = fileUrl;
        }
        break;
      }
      case 'element': {
        const elementId = data.config.elementId as string;
        if (elementId) {
          const elements = dispatch.getElements();
          const el = elements.find((e) => e.id === elementId);
          if (el && el.images.length > 0) {
            // Pick best references: 0=frontal, 1=full body front, 5=left portrait, 6=right portrait
            const refIndices = [1, 5, 6];
            const elementData: ElementData = {
              frontalImageUrl: el.images[0].url,
              referenceImageUrls: refIndices
                .filter((idx) => idx < el.images.length)
                .map((idx) => el.images[idx].url),
              allUrls: el.images.map((img) => img.url),
              name: el.name,
            };
            output[port.id] = elementData;
          }
        }
        break;
      }
    }
  }
  return output;
}

async function executeModelNode(
  nodeId: string,
  nodeType: string,
  data: WorkflowNodeData,
  portInputs: Record<string, unknown>,
  results: Map<string, Record<string, unknown>>,
  dispatch: WorkflowDispatch,
): Promise<void> {
  const modelDef = getModelDefinition(nodeType);
  if (!modelDef) return;

  dispatch.setNodeRunning(nodeId, true);

  // SAM 3 tools are interactive-only — use modals, not automated execution
  if (
    modelDef.nodeType === 'sam3-segment'
    || modelDef.nodeType === 'sam3-segment-cloud'
    || modelDef.nodeType === 'sam3-track-cloud'
  ) {
    if (data.result?.url || data.result?.layers) {
      // Use pre-existing result from modal
      const existingUrl = data.result.url;
      if (existingUrl) {
        results.set(nodeId, { [modelDef.outputType]: existingUrl });
      }
    } else {
      dispatch.setNodeResult(nodeId, {
        status: 'error',
        error: modelDef.nodeType === 'sam3-track-cloud'
          ? 'Open the Track modal to create a segmentation.'
          : 'Open the Segment modal to create a selection.',
      });
    }
    dispatch.setNodeRunning(nodeId, false);
    return;
  }

  dispatch.setNodeResult(nodeId, buildRunningResult(nodeType, isLayerDecomposeNodeType(nodeType) ? 'init' : undefined));

  try {
    let falInputs: Record<string, unknown> = {};

    // Collect element-list data grouped by field ID
    const elementListData = new Map<string, ElementData[]>();
    for (const field of modelDef.inputs) {
      if (field.fieldType !== 'element-list') continue;
      const items: ElementData[] = [];
      for (const [key, value] of Object.entries(portInputs)) {
        if (key.startsWith(field.id + '_') && value && typeof value === 'object') {
          items.push(value as ElementData);
        }
      }
      if (items.length > 0) {
        elementListData.set(field.id, items);
      }
    }

    for (const field of modelDef.inputs) {
      if (field.fieldType === 'element-list') {
        const items = elementListData.get(field.id);
        if (!items || items.length === 0) continue;

        if (field.falParam === 'elements') {
          // fal.ai Kling format: array of { frontal_image_url, reference_image_urls }
          // Kling allows max 3 reference images per element
          falInputs[field.falParam] = items.map((el) => ({
            frontal_image_url: el.frontalImageUrl,
            reference_image_urls: el.referenceImageUrls.slice(0, 3),
          }));
        } else if (field.falParam === 'kling_elements') {
          // kie.ai Kling 3.0 format: array of { name, description, element_input_urls }
          // 2-4 images per element
          falInputs[field.falParam] = items.map((el) => ({
            name: el.name.replace(/\s+/g, '_').toLowerCase(),
            description: el.name,
            element_input_urls: [el.frontalImageUrl, ...el.referenceImageUrls].slice(0, 4),
          }));
        } else if (field.falParam === 'image_input') {
          // kie.ai nano-banana format: flat array of all image URLs
          const existing = Array.isArray(falInputs[field.falParam]) ? falInputs[field.falParam] as string[] : [];
          falInputs[field.falParam] = [...existing, ...items.flatMap((el) => el.allUrls)];
        } else if (field.falParam === 'image_urls' || field.falParam.startsWith('image_url')) {
          // Nano-banana/generic format: flat array of all image URLs
          const existing = Array.isArray(falInputs[field.falParam]) ? falInputs[field.falParam] as string[] : [];
          falInputs[field.falParam] = [...existing, ...items.flatMap((el) => el.allUrls)];
        } else {
          // Fallback: pass frontal URLs as array
          falInputs[field.falParam] = items.map((el) => el.frontalImageUrl);
        }
        continue;
      }

      // Skip last_frame — handled separately when combining into image_urls
      if (field.id === 'last_frame') continue;

      const portValue = portInputs[field.id];
      const configValue = data.config[field.id];
      const value = portValue ?? configValue ?? field.default;

      if (value === undefined || value === null) continue;
      if (field.id === 'seed' && value === -1) continue;

      // If the value is an ElementData object (from element port connections),
      // extract the flat URL list for array-type params or the frontal URL for single params
      const isElementData = typeof value === 'object' && value !== null && !Array.isArray(value)
        && ('allUrls' in value || 'frontalImageUrl' in value);

      const needsArrayParam =
        (field.falParam.endsWith('s') && field.falParam.startsWith('image_url'))
        || field.falParam === 'filesUrl'
        || field.falParam === 'imageUrls'
        || field.falParam === 'image_input'
        || field.falParam === 'urls';

      if (isElementData && needsArrayParam) {
        const urls = (value as { allUrls?: string[] }).allUrls ?? [(value as { frontalImageUrl?: string }).frontalImageUrl].filter(Boolean);
        const existing = Array.isArray(falInputs[field.falParam]) ? falInputs[field.falParam] as string[] : [];
        falInputs[field.falParam] = [...existing, ...urls];
      } else if (isElementData) {
        // Single-value param from an element — use the frontal image URL
        falInputs[field.falParam] = (value as { frontalImageUrl?: string }).frontalImageUrl ?? (value as { allUrls?: string[] }).allUrls?.[0];
      } else if (typeof value === 'string' && needsArrayParam) {
        falInputs[field.falParam] = [value];
      } else if (field.portType === 'number' && field.fieldType === 'select' && typeof value === 'string') {
        falInputs[field.falParam] = Number(value);
      } else {
        falInputs[field.falParam] = value;
      }
    }

    // Transform composition_plan from utility node format to fal API format
    if (falInputs.composition_plan && typeof falInputs.composition_plan === 'object' && !Array.isArray(falInputs.composition_plan)) {
      const raw = falInputs.composition_plan as {
        positiveGlobalStyles?: string;
        negativeGlobalStyles?: string;
        sections?: { name: string; positiveStyles: string; negativeStyles?: string; durationMs: number; lines: string }[];
      };
      const splitStyles = (s?: string) => s ? s.split(',').map((t) => t.trim()).filter(Boolean) : [];
      falInputs.composition_plan = {
        positive_global_styles: splitStyles(raw.positiveGlobalStyles),
        negative_global_styles: splitStyles(raw.negativeGlobalStyles),
        sections: (raw.sections ?? []).map((sec) => ({
          section_name: sec.name,
          positive_local_styles: splitStyles(sec.positiveStyles),
          negative_local_styles: splitStyles(sec.negativeStyles),
          duration_ms: sec.durationMs,
          lines: sec.lines ? sec.lines.split('\n').filter(Boolean) : [],
        })),
      };
      // When composition_plan is provided, prompt and music_length_ms are ignored by the API
      delete falInputs.prompt;
      delete falInputs.music_length_ms;
    }

    // Combine first frame + last frame into image_urls array for kie Kling 3.0
    if (modelDef.provider === 'kie' && falInputs.image_urls) {
      const firstFrame = falInputs.image_urls;
      const lastFrame = portInputs['last_frame'];
      if (typeof firstFrame === 'string' && typeof lastFrame === 'string') {
        falInputs.image_urls = [firstFrame, lastFrame];
      } else if (typeof firstFrame === 'string') {
        falInputs.image_urls = [firstFrame];
      }
    }

    // Collect element names for @mention resolution
    const connectedElements: ElementData[] = [];
    for (const items of elementListData.values()) {
      connectedElements.push(...items);
    }

    // multi_prompt and prompt are mutually exclusive in Kling
    if (falInputs.multi_prompt && Array.isArray(falInputs.multi_prompt)) {
      const isKie = modelDef.provider === 'kie';
      falInputs.multi_prompt = (falInputs.multi_prompt as { prompt: string; duration: unknown }[]).map((shot) => ({
        prompt: resolveElementMentions(shot.prompt, connectedElements, isKie),
        duration: isKie ? Number(shot.duration) : String(shot.duration),
      }));
      delete falInputs.prompt;
      delete falInputs.duration;
      if (isKie) {
        falInputs.multi_shots = true;
      } else if (!falInputs.shot_type) {
        falInputs.shot_type = 'customize';
      }
    }

    // Also resolve @mentions in the regular prompt field
    const useKieMentions = modelDef.provider === 'kie';
    if (typeof falInputs.prompt === 'string' && connectedElements.length > 0) {
      falInputs.prompt = resolveElementMentions(falInputs.prompt, connectedElements, useKieMentions);
    }

    if (modelDef.nodeType === 'wizper' || modelDef.nodeType === 'whisper-cloud') {
      dispatch.setNodeResult(nodeId, buildRunningResult(nodeType, undefined, 'Preparing media for cloud transcription'));
      falInputs = await normalizeCloudTranscriptionInputs(falInputs);
      dispatch.setNodeResult(nodeId, buildRunningResult(nodeType, undefined, 'Submitting cloud transcription'));
    }

    if (isLayerDecomposeNodeType(modelDef.nodeType) && typeof falInputs.image_url === 'string') {
      dispatch.setNodeResult(nodeId, buildRunningResult(nodeType, 'init', 'Analyzing image for separable elements'));
      const visionHints = await generateLayerDecomposeVisionPrompts(nodeId, falInputs.image_url);
      const mergedPrompts = mergeLayerDecomposePrompts(
        visionHints.prompts,
        getLayerDecomposeAutoPrompts(),
      );
      (falInputs as any)._visionPrompts = mergedPrompts;
      (falInputs as any)._visionMasks = visionHints.masks;
      if (modelDef.nodeType === 'layer-decompose') {
        falInputs.prompts = mergedPrompts.join(', ');
      }
    }

    const hasImageInputs = modelDef.inputs.some(
      (f) => (f.portType === 'image' && (f.fieldType === 'port' || f.fieldType === 'element-list'))
        && (portInputs[f.id] || Object.keys(portInputs).some((k) => k.startsWith(f.id + '_'))),
    );
    const effectiveModelId = (hasImageInputs && modelDef.altId) ? modelDef.altId : modelDef.id;

    console.log('[workflow] Sending to model:', effectiveModelId, JSON.stringify(falInputs, null, 2));

    let result: unknown;

    if (modelDef.provider === 'local') {
      // Local model — run via IPC through the local Python runner, polling for completion
      const { jobId } = await window.electronAPI.localModel.run({ nodeType, inputs: falInputs });
      const partialLocalResult: Partial<NonNullable<WorkflowNodeData['result']>> = {};

      // Poll until done
      await new Promise<void>((resolve, reject) => {
        const unsub = window.electronAPI.localModel.onProgress((data) => {
          if (data.jobId !== jobId) return;
          if (data.type === 'progress') {
            if (data.segments) partialLocalResult.segments = data.segments;
            if (data.output_text !== undefined) partialLocalResult.text = data.output_text;
            if (data.language !== undefined) partialLocalResult.language = data.language;
            dispatch.setNodeResult(nodeId, buildRunningResult(nodeType, data.stage, data.message, partialLocalResult));
          } else if (data.type === 'done') {
            unsub();
            result = {
              output_path: data.output_path,
              ...(data.layers && { layers: data.layers }),
              ...(data.needs_inpainting !== undefined && { needs_inpainting: data.needs_inpainting }),
              ...(data.combined_mask_path && { combined_mask_path: data.combined_mask_path }),
              ...(data.transcript_path && { transcript_path: data.transcript_path }),
              ...((data.segments ?? partialLocalResult.segments) && { segments: data.segments ?? partialLocalResult.segments }),
              ...((data.output_text ?? partialLocalResult.text) && { output_text: data.output_text ?? partialLocalResult.text }),
              ...((data.language ?? partialLocalResult.language) && { language: data.language ?? partialLocalResult.language }),
            };
            resolve();
          } else if (data.type === 'error') {
            unsub();
            reject(new Error(data.error ?? 'Local model error'));
          }
        });
      });
    } else {
      // For cloud layer decompose, skip the standard API call — we handle everything in the block below
      let apiInputs = falInputs;
      if (modelDef.nodeType === 'layer-decompose-cloud') {
        const maxMasks = getNormalizedLayerDecomposeCloudMaxMasks(data, falInputs);
        falInputs.max_masks = maxMasks;
        const promptList = mergeLayerDecomposePrompts(
          ((falInputs as any)._visionPrompts as string[] | undefined) ?? [],
          getLayerDecomposeAutoPrompts(Math.max(maxMasks * 2, 12)),
        );
        (falInputs as any)._promptList = promptList;
        result = {}; // placeholder — all SAM 3 calls happen in the handler below
      } else {
        result = await window.electronAPI.workflow.run({
          apiKey: getApiKey(),
          kieKey: getKieApiKey(),
          runpodKey: getRunpodApiKey(),
          runpodEndpointId: getRunpodEndpointId(nodeType),
          podUrl: getPodUrl(),
          nodeId,
          nodeType,
          modelId: effectiveModelId,
          inputs: apiInputs,
        });
      }
    }

    // Qwen Image Layered: convert images array to layer gallery
    if (modelDef.nodeType === 'qwen-image-layered') {
      const layeredResult = result as any;
      const images: Array<{ url: string }> = layeredResult?.images ?? [];

      if (images.length > 0) {
        const layers = images.map((img: any, i: number) => ({
          url: img.url,
          name: i === 0 ? 'Background' : `Layer ${i}`,
          type: i === 0 ? 'background' : 'layer',
          z_order: i,
        }));
        const primaryUrl = images[0].url;
        results.set(nodeId, { [modelDef.outputType]: primaryUrl });
        dispatch.setNodeResult(nodeId, { status: 'complete', url: primaryUrl, layers, selectedLayerIndex: 0 });
        if (primaryUrl) dispatch.addGeneration(nodeId, primaryUrl);
      } else {
        throw new Error('No layers returned from Qwen Image Layered');
      }
    } else

    // Cloud layer decompose: SAM 3 returned masks, now call remaining prompts and build layers
    if (modelDef.nodeType === 'layer-decompose-cloud') {
      dispatch.setNodeResult(nodeId, buildRunningResult(nodeType, 'segmentation', 'Finding likely layers'));

      const sourceImageUrl = String(falInputs.image_url ?? '');
      const promptList: string[] = (falInputs as any)._promptList ?? [];
      const maxMasks = getNormalizedLayerDecomposeCloudMaxMasks(data, falInputs);
      const visionMasks: Array<{ url: string; label: string }> = (falInputs as any)._visionMasks ?? [];

      // Collect all masks from all prompt calls
      const allMasks: Array<{ url: string; label: string; score?: number; bbox?: number[]; source?: string }> = visionMasks.map((mask) => ({
        url: mask.url,
        label: mask.label,
        score: 0.99,
        source: 'vision',
      }));

      // Call SAM 3 for each prompt
      for (const prompt of promptList) {
        try {
          // Small delay between API calls to avoid rate limiting
          await new Promise(r => setTimeout(r, 500));
          console.log('[layer-decompose-cloud] Calling SAM 3 for prompt:', prompt);
          const promptResult = await window.electronAPI.workflow.run({
            apiKey: getApiKey(),
            kieKey: getKieApiKey(),
            runpodKey: getRunpodApiKey(),
            runpodEndpointId: '',
            podUrl: getPodUrl(),
            nodeId,
            nodeType: 'layer-decompose-cloud',
            modelId: 'fal-ai/sam-3/image',
            inputs: {
              image_url: sourceImageUrl,
              prompt,
            },
          }) as any;
          console.log('[layer-decompose-cloud] SAM 3 result for prompt "' + prompt + '":', JSON.stringify(promptResult, null, 2));
          if (promptResult?.masks?.length > 0) {
            for (let i = 0; i < promptResult.masks.length; i++) {
              allMasks.push({
                url: promptResult.masks[i].url,
                label: prompt,
                score: promptResult.scores?.[i],
                bbox: promptResult.boxes?.[i],
                source: 'sam3',
              });
            }
          }
        } catch (err) {
          console.warn('[layer-decompose-cloud] SAM 3 call failed for prompt "' + prompt + '":', err);
        }
      }

      const masksWithBBoxes = await enrichCloudMasksWithBBoxes(sourceImageUrl, allMasks);
      const dedupedMasks: typeof allMasks = [];
      for (const candidate of masksWithBBoxes) {
        const candidateScore = candidate.score ?? 0;
        let replacedExisting = false;
        let isDuplicate = false;

        for (let i = 0; i < dedupedMasks.length; i++) {
          const existing = dedupedMasks[i];
          const overlap = bboxIoU(existing.bbox, candidate.bbox);
          if (existing.bbox && candidate.bbox && overlap < 0.78) continue;
          if (!existing.bbox || !candidate.bbox) {
            if (existing.label !== candidate.label) continue;
          }

          const existingScore = existing.score ?? 0;
          const candidatePriority = candidate.source === 'vision' ? 1 : 0;
          const existingPriority = existing.source === 'vision' ? 1 : 0;
          if (candidatePriority > existingPriority || (candidatePriority === existingPriority && candidateScore > existingScore)) {
            dedupedMasks[i] = candidate;
            replacedExisting = true;
          } else {
            isDuplicate = true;
          }
          break;
        }

        if (!replacedExisting && !isDuplicate) {
          dedupedMasks.push(candidate);
        }
      }

      dedupedMasks.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const finalMasks = dedupedMasks.slice(0, maxMasks);

      if (finalMasks.length > 0) {
        const extracted = await buildCloudLayerAssets(nodeId, sourceImageUrl, finalMasks);
        const cloudLayers: Array<{ path: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }> = [
          {
            path: extracted.backgroundPlateUrl,
            name: 'Background',
            type: 'background',
            z_order: 0,
            metadata: { source: 'plate' },
          },
          ...extracted.layers.map((layer) => ({
            path: layer.url,
            name: layer.name,
            type: layer.type,
            z_order: layer.z_order,
            metadata: layer.metadata,
          })),
        ];

        // Inpaint background if requested
        const reconstructBg = Boolean(falInputs.reconstruct_bg ?? true);
        if (reconstructBg) {
          try {
            const inpaintPrompt = 'reconstruct the background behind the removed elements, maintain the style and context of the surrounding image';
            const qwenResult = await window.electronAPI.workflow.run({
              apiKey: getApiKey(),
              kieKey: getKieApiKey(),
              runpodKey: getRunpodApiKey(),
              runpodEndpointId: getRunpodEndpointId('runpod-qwen-image-edit'),
              podUrl: getPodUrl(),
              nodeId,
              nodeType: 'layer-decompose-cloud',
              modelId: 'fal-ai/qwen-image-edit-2511',
              inputs: {
                image_urls: [extracted.backgroundPlateUrl],
                prompt: inpaintPrompt,
              },
            });
            const inpaintedUrl = extractUrl(qwenResult, 'images.0.url');
            if (inpaintedUrl) {
              cloudLayers[0].path = inpaintedUrl;
            }
          } catch (inpaintErr) {
            console.warn('[layer-decompose-cloud] Inpainting failed, using original as background:', inpaintErr);
          }
        }

        // Convert to LayerInfo format and set result
        const layers = cloudLayers.map((l) => ({
          url: l.path,
          name: l.name,
          type: l.type,
          z_order: l.z_order,
          metadata: l.metadata,
        }));
        const primaryUrl = cloudLayers[0].path;
        results.set(nodeId, { [modelDef.outputType]: primaryUrl });
        dispatch.setNodeResult(nodeId, { status: 'complete', url: primaryUrl, layers, selectedLayerIndex: 0 });
        if (primaryUrl) dispatch.addGeneration(nodeId, primaryUrl);

      } else {
        // No masks found — just return original image
        const url = sourceImageUrl;
        results.set(nodeId, { [modelDef.outputType]: url });
        dispatch.setNodeResult(nodeId, { status: 'complete', url });
        if (url) dispatch.addGeneration(nodeId, url);
      }
    } else

    // Phase 2: Qwen inpainting for layer-decompose local (if needed)
    if (modelDef.nodeType === 'layer-decompose' && (result as any)?.needs_inpainting) {
      const inpainterSetting = String(falInputs.inpainter ?? 'qwen-edit-local');
      const reconstructBg = Boolean(falInputs.reconstruct_bg ?? true);

      if (reconstructBg && inpainterSetting.startsWith('qwen-edit')) {
        dispatch.setNodeResult(nodeId, buildRunningResult(nodeType, 'inpainting', 'Rebuilding clean background plate'));

        const bgLayerPath = (result as any).layers?.[0]?.path as string;
        const inpaintPrompt = 'reconstruct the background behind the removed elements, maintain the style and context of the surrounding image';

        let inpaintedUrl: string | undefined;

        if (inpainterSetting === 'qwen-edit-local') {
          const qwenResult = await window.electronAPI.localModel.run({
            nodeType: 'qwen-edit-local',
            inputs: { image_url: `local-media://file${bgLayerPath}`, prompt: inpaintPrompt },
          });
          await new Promise<void>((resolve, reject) => {
            const unsub = window.electronAPI.localModel.onProgress((qData) => {
              if (qData.jobId !== qwenResult.jobId) return;
              if (qData.type === 'done') { unsub(); inpaintedUrl = qData.output_path; resolve(); }
              else if (qData.type === 'error') { unsub(); reject(new Error(qData.error ?? 'Qwen Edit error')); }
            });
          });
        } else {
          const qwenInputs: Record<string, unknown> = {
            image_url: `local-media://file${bgLayerPath}`,
            prompt: inpaintPrompt,
          };
          const modelId = inpainterSetting === 'qwen-edit-cloud'
            ? 'fal-ai/qwen-image-edit-2511'
            : 'runpod-qwen-image-edit';
          const qwenResult = await window.electronAPI.workflow.run({
            apiKey: getApiKey(),
            kieKey: getKieApiKey(),
            runpodKey: getRunpodApiKey(),
            runpodEndpointId: getRunpodEndpointId('runpod-qwen-image-edit'),
            podUrl: getPodUrl(),
            nodeId,
            nodeType: inpainterSetting === 'qwen-edit-cloud' ? 'qwen-edit-cloud' : 'runpod-qwen-image-edit',
            modelId,
            inputs: qwenInputs,
          });
          inpaintedUrl = extractUrl(qwenResult, 'output.image_url')
            ?? extractUrl(qwenResult, 'images.0.url')
            ?? extractUrl(qwenResult, 'image.url');
        }

        // Update background layer with inpainted result
        if (inpaintedUrl && (result as any).layers?.[0]) {
          const bgLayer = (result as any).layers[0];
          if (inpaintedUrl.startsWith('http')) {
            bgLayer.path = inpaintedUrl;
          } else if (inpaintedUrl.startsWith('/')) {
            bgLayer.path = inpaintedUrl;
          }
          (result as any).output_path = bgLayer.path;
        }
      }
    }

    if (modelDef.nodeType === 'layer-decompose-cloud' || modelDef.nodeType === 'qwen-image-layered') {
      // Already handled above — skip normal result processing
    } else if (modelDef.nodeType === 'whisperx-local') {
      const transcript = (result as any)?.output_text ?? '';
      const segments = (result as any)?.segments ?? [];
      const language = (result as any)?.language ?? '';
      const transcriptPath = (result as any)?.transcript_path as string | undefined;
      const wordTimestampsStatus = transcriptPath ? 'loading' : (
        Array.isArray(segments) && segments.some((seg: any) => Array.isArray(seg?.words) && seg.words.length > 0)
          ? 'ready'
          : 'idle'
      );
      results.set(nodeId, { text: transcript, segments, language, transcriptPath });
      dispatch.setNodeResult(nodeId, {
        status: 'complete',
        text: transcript,
        segments,
        language,
        ...(transcriptPath && { transcriptPath }),
        wordTimestampsStatus,
      });
    } else if (modelDef.nodeType === 'wizper' || modelDef.nodeType === 'whisper-cloud') {
      const { transcript, segments, language, hasWordTimestamps } = normalizeCloudTranscriptResult(result, {
        chunkLevel: typeof falInputs.chunk_level === 'string' ? falInputs.chunk_level : undefined,
      });
      results.set(nodeId, { text: transcript, segments, language });
      dispatch.setNodeResult(nodeId, {
        status: 'complete',
        text: transcript,
        segments,
        language,
        wordTimestampsStatus: hasWordTimestamps ? 'ready' : 'idle',
      });
    } else if (modelDef.outputType === 'text') {
      const textValue = extractValue(result, modelDef.responseMapping.path);
      if (typeof textValue !== 'string') {
        throw new Error('No text output in response');
      }
      results.set(nodeId, { text: textValue });
      dispatch.setNodeResult(nodeId, { status: 'complete', text: textValue });
    } else {
      // Local models return a file path — convert to a local-media:// URL
      const rawPath = extractUrl(result, modelDef.responseMapping.path);
      const url = rawPath
        ? (rawPath.startsWith('/') ? `local-media://file${rawPath}` : rawPath)
        : extractUrl(result, 'resultUrls.0')
          ?? extractUrl(result, 'video_url')
          ?? extractUrl(result, 'image_url')
          ?? extractUrl(result, 'audio_url')
          ?? extractUrl(result, 'data.0.audio_url')
          ?? extractUrl(result, 'images.0.url')
          ?? extractUrl(result, 'video.url')
          ?? extractUrl(result, 'image.url')
          ?? extractUrl(result, 'url');

      // Handle multi-layer output (layer-decompose)
      const rawLayers = (result as any)?.layers;
      if (rawLayers && Array.isArray(rawLayers)) {
        const layers = rawLayers.map((l: any) => ({
          url: l.path?.startsWith('/') ? `local-media://file${l.path}` : (l.path ?? ''),
          name: l.name ?? 'Layer',
          type: l.type ?? 'unknown',
          z_order: l.z_order ?? 0,
          metadata: l.metadata,
        }));
        results.set(nodeId, { [modelDef.outputType]: url });
        dispatch.setNodeResult(nodeId, { status: 'complete', url, layers, selectedLayerIndex: 0 });
        if (url) dispatch.addGeneration(nodeId, url);
      } else {
        if (!url) {
          throw new Error('No output URL in response');
        }

        results.set(nodeId, { [modelDef.outputType]: url });
        dispatch.setNodeResult(nodeId, { status: 'complete', url });
        if (url) dispatch.addGeneration(nodeId, url);
      }
    }
  } catch (error) {
    dispatch.setNodeResult(nodeId, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    dispatch.setNodeRunning(nodeId, false);
  }
}

/**
 * Replace @ElementName mentions in prompts.
 * fal.ai Kling: @Element1, @Element2, etc.
 * kie.ai Kling: @element_name (snake_case matching kling_elements.name)
 */
function resolveElementMentions(prompt: string, elements: ElementData[], useKieFormat = false): string {
  let resolved = prompt;
  for (let i = 0; i < elements.length; i++) {
    const name = elements[i].name;
    const replacement = useKieFormat
      ? `@${name.replace(/\s+/g, '_').toLowerCase()}`
      : `@Element${i + 1}`;
    resolved = resolved.replace(
      new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'),
      replacement,
    );
  }
  return resolved;
}

function bboxIoU(a?: number[], b?: number[]): number {
  if (!a || !b || a.length < 4 || b.length < 4) return 0;
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection <= 0) return 0;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

function formatLayerLabel(label: string): string {
  return label
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractValue(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function extractUrl(obj: unknown, path: string): string | undefined {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}
