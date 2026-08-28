import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';

const { generateLtx25AndWait } = vi.hoisted(() => ({
  generateLtx25AndWait: vi.fn(),
}));

vi.mock('@/lib/runpod/ltx25-client', () => ({
  generateLtx25AndWait,
  isRetryableRunpodLtx25PollError: (error: unknown) => /proxy read timeout|\b524\b/i.test(
    error instanceof Error ? error.message : String(error ?? ''),
  ),
}));

import { RUNPOD_MODEL_REGISTRY } from '@/lib/fal/models';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';
import { executeWorkflow } from '@/lib/workflows/execute';
import {
  buildRunpodLtx25SessionInput,
  runRunpodLtx25Session,
} from '@/lib/workflows/runpod-ltx25-session';

describe('Spaces RunPod LTX-2.5 session node', () => {
  beforeEach(() => {
    generateLtx25AndWait.mockReset();
  });

  it('is the first RunPod video node and stays distinct from the serverless model', () => {
    const runpodVideos = Object.values(RUNPOD_MODEL_REGISTRY).filter((model) => model.category === 'video');
    const session = RUNPOD_MODEL_REGISTRY['runpod-ltx25-session'];
    const serverless = RUNPOD_MODEL_REGISTRY['runpod-ltx-video'];

    expect(runpodVideos[0]).toBe(session);
    expect(session).toMatchObject({
      name: 'LTX-2.5 Session',
      description: 'Uses the active temporary LTX-2.5 Pod session',
      provider: 'runpod',
      outputType: 'video',
      responseMapping: { path: 'url' },
    });
    expect(session).not.toHaveProperty('runpodEndpointId');
    expect(serverless.name).toBe('LTX Video (Serverless)');
    expect(NODE_REGISTRY['runpod-ltx25-session'].outputs).toEqual([
      { id: 'video', type: 'video', label: 'video' },
    ]);

    const fields = Object.fromEntries(session.inputs.map((field) => [field.id, field]));
    expect(fields.prompt).toMatchObject({ fieldType: 'port', required: true, portType: 'text' });
    expect(fields.image_url).toMatchObject({ fieldType: 'port', required: false, portType: 'image' });
    expect(fields.duration_sec).toMatchObject({ falParam: 'durationSec', default: '5' });
    expect(fields.aspect_ratio).toMatchObject({ falParam: 'aspectRatio', default: '16:9' });
    expect(fields.resolution).toMatchObject({ default: '720p' });
    expect(fields.generate_audio).toMatchObject({ falParam: 'generateAudio', fieldType: 'toggle', default: true });
  });

  it('maps Spaces controls to the shared active-session client contract', async () => {
    generateLtx25AndWait.mockResolvedValue({
      jobId: 'job-1',
      url: 'local-media://file/result.mp4',
      durationSec: 15,
      model: 'LTX-2.5',
    });

    const inputs = buildRunpodLtx25SessionInput({
      prompt: '  A detective opens the book.  ',
      image_url: ' https://cdn.example/frame.png ',
      durationSec: 15,
      aspectRatio: '9:16',
      resolution: '1080p',
      generateAudio: false,
    });
    expect(inputs).toEqual({
      prompt: 'A detective opens the book.',
      referenceImages: ['https://cdn.example/frame.png'],
      durationSec: 15,
      aspectRatio: '9:16',
      resolution: '1080p',
      generateAudio: false,
    });

    await expect(runRunpodLtx25Session(inputs)).resolves.toMatchObject({
      url: 'local-media://file/result.mp4',
    });
    expect(generateLtx25AndWait).toHaveBeenCalledWith(inputs, undefined);
  });

  it('executes through the session client and publishes the returned video', async () => {
    generateLtx25AndWait.mockResolvedValue({
      jobId: 'job-2',
      url: 'local-media://file/spaces-result.mp4',
      durationSec: 10,
      model: 'LTX-2.5',
    });
    const nodes: Node<WorkflowNodeData>[] = [
      {
        id: 'prompt-1',
        position: { x: 0, y: 0 },
        data: { type: 'prompt', label: 'Prompt', config: { prompt: 'Rain crosses a neon window.' } },
      },
      {
        id: 'ltx-1',
        position: { x: 200, y: 0 },
        data: {
          type: 'runpod-ltx25-session',
          label: 'LTX-2.5 Session',
          config: {
            duration_sec: '10',
            aspect_ratio: '16:9',
            resolution: '720p',
            generate_audio: true,
          },
        },
      },
    ];
    const edges: Edge[] = [{
      id: 'prompt-to-ltx',
      source: 'prompt-1',
      sourceHandle: 'text',
      target: 'ltx-1',
      targetHandle: 'prompt',
    }];
    const dispatch = {
      setNodeRunning: vi.fn(),
      setNodeResult: vi.fn(),
      addGeneration: vi.fn(),
      addAsset: vi.fn(),
      getElements: vi.fn(() => []),
    };

    await executeWorkflow(nodes, edges, dispatch);

    expect(generateLtx25AndWait).toHaveBeenCalledWith(
      {
        prompt: 'Rain crosses a neon window.',
        durationSec: 10,
        aspectRatio: '16:9',
        resolution: '720p',
        generateAudio: true,
      },
      expect.objectContaining({ onJobId: expect.any(Function) }),
    );
    expect(dispatch.setNodeResult).toHaveBeenCalledWith('ltx-1', {
      status: 'complete',
      url: 'local-media://file/spaces-result.mp4',
    });
    expect(dispatch.addGeneration).toHaveBeenCalledWith('ltx-1', 'local-media://file/spaces-result.mp4');
  });

  it('retains a timed-out remote job so the next click resumes instead of resubmitting', async () => {
    generateLtx25AndWait.mockImplementationOnce(async (_input, options) => {
      options?.onJobId?.('job-timeout');
      throw new Error('The origin web server hit the 120-second Proxy Read Timeout. 524');
    });
    const node: Node<WorkflowNodeData> = {
      id: 'ltx-resume',
      position: { x: 0, y: 0 },
      data: {
        type: 'runpod-ltx25-session',
        label: 'LTX-2.5 Session',
        config: { prompt: 'A rain-soaked street.' },
      },
    };
    const dispatch = {
      setNodeRunning: vi.fn(),
      setNodeResult: vi.fn(),
      addGeneration: vi.fn(),
      addAsset: vi.fn(),
      getElements: vi.fn(() => []),
    };

    await executeWorkflow([node], [], dispatch);

    expect(dispatch.setNodeResult).toHaveBeenLastCalledWith('ltx-resume', expect.objectContaining({
      status: 'error',
      remoteJobId: 'job-timeout',
    }));

    generateLtx25AndWait.mockResolvedValueOnce({
      jobId: 'job-timeout',
      url: 'local-media://file/recovered.mp4',
    });
    await executeWorkflow([{
      ...node,
      data: {
        ...node.data,
        result: { status: 'error', error: 'Proxy Read Timeout', remoteJobId: 'job-timeout' },
      },
    }], [], dispatch);

    expect(generateLtx25AndWait).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'A rain-soaked street.' }),
      expect.objectContaining({ resumeJobId: 'job-timeout' }),
    );
  });
});
