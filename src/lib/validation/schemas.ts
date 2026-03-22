import { z } from 'zod';

export const runWorkflowSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  modelId: z.string(),
  inputs: z.record(z.string(), z.unknown()),
});

export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
