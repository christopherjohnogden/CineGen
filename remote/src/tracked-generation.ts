import { z } from 'zod';
import { assetGeneration } from '../../mcp/edit-schemas.mjs';
import { MEDIA_TOOL_METADATA } from '../../mcp/display-tools.mjs';
import { topviewCanvasTaskHandle } from '../../src/lib/topview/canvas-audio';
import { providerModels } from './providers';
import type { RecordValue } from './firebase';

const id = z.string().regex(/^[\w.:@-]{1,160}$/);
const schema = z.object({
  projectId: id, requestId: id.describe('Unique CineGen tracking ID. Reuse for retries of this registration.'),
  spaceId: id.optional(), provider: z.literal('topview').optional(),
  model: z.string().min(1).describe('CineGen nodeType for the original model, e.g. topview-video-seedance-2-5.'),
  taskId: id.describe('Exact original Topview taskId from its submission receipt. Never invent an ID.'),
  canvasId: id.optional().describe('For Topview Canvas tasks, supply both canvasId and providerNodeId from the receipt.'),
  providerNodeId: id.optional().describe('Original Topview Canvas output nodeId, not a CineGen node ID.'),
  boardId: id.optional(),
  taskType: z.enum(['text_to_image', 'image_edit', 'text_to_video', 'image_to_video', 'omni_reference', 'lip_sync', 'avatar_video']).optional(),
  title: z.string().min(1).max(200).optional(),
  startedAt: z.iso.datetime({ offset: true }).optional().describe('Original submission time, if known, for accurate elapsed time.'),
  generation: assetGeneration.optional().describe('Verified original prompt, settings, and image/video/audio references. Omit unknown history; never guess it.'),
}).strict();

export const trackGenerationTool = {
  name: 'cinegen_track_generation', title: 'Track a Topview render in CineGen',
  description: 'Show the CineGen prism viewer immediately for an EXISTING Topview render started outside CineGen. Call immediately after Topview returns its task receipt, without waiting for completion. Canvas tasks require taskId, canvasId and providerNodeId from that receipt. Other Topview tasks use taskId and optional boardId/taskType. Creates a CineGen Studio tracking node, polls the same task using the Topview account connected in CineGen, and saves its finished media and supplied provenance automatically. Never submits a render or spends generation credits. Reuse requestId on retries; do not call cinegen_generate for this existing task. Requires the same Topview account to be connected in CineGen Settings.',
  inputSchema: z.toJSONSchema(schema),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  _meta: MEDIA_TOOL_METADATA,
};

/** Tracking accepts historical settings without re-validating today's submission limits. */
export function prepareTrackedGeneration(raw: RecordValue) {
  const args = schema.parse(raw);
  if (Boolean(args.canvasId) !== Boolean(args.providerNodeId)) throw new Error('Canvas tracking requires both canvasId and providerNodeId from the original receipt.');
  const model = providerModels('topview').find(model => model.nodeType === args.model);
  if (!model) throw new Error('Choose the matching Topview nodeType from cinegen_list_models. Tracking never submits a new generation.');
  const provenance = { version: 1, references: [], ...args.generation, model: args.generation?.model || model.name, provider: 'topview',
    providerTaskId: args.taskId, ...(args.canvasId ? { providerCanvasId: args.canvasId, providerNodeId: args.providerNodeId } : {}) };
  const config = { prompt: args.generation?.prompt ?? '',
    ...(args.generation?.resolution ? { resolution: args.generation.resolution } : {}),
    ...(args.generation?.aspectRatio ? { aspect_ratio: args.generation.aspectRatio } : {}),
    __studioGenerationMetadata: provenance };
  const taskId = args.canvasId ? topviewCanvasTaskHandle({ canvasId: args.canvasId, nodeId: args.providerNodeId!, taskId: args.taskId }) : args.taskId;
  return {
    prepared: { provider: 'topview' as const, model, config, params: { model: model.name, outputType: model.outputType, medias: [] }, prompt: config.prompt },
    provenance,
    providerTask: { taskId, model: model.name, outputType: model.outputType, waitForCompletion: false,
      ...(args.boardId ? { boardId: args.boardId } : {}), ...(args.taskType ? { taskType: args.taskType } : {}) },
  };
}
