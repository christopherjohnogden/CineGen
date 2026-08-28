import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';
import type { Element } from '@/types/elements';

const { generateSessionImageAndWait } = vi.hoisted(() => ({
  generateSessionImageAndWait: vi.fn(),
}));

vi.mock('@/lib/runpod/session-image-client', () => ({
  generateSessionImageAndWait,
  isRetryableRunpodSessionImagePollError: (error: unknown) => /proxy read timeout|\b524\b/i.test(
    error instanceof Error ? error.message : String(error ?? ''),
  ),
}));

import { RUNPOD_MODEL_REGISTRY } from '@/lib/fal/models';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';
import { executeWorkflow } from '@/lib/workflows/execute';
import {
  buildRunpodSessionImageInput,
  RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE,
  RUNPOD_SDXL_SESSION_NODE_TYPE,
} from '@/lib/workflows/runpod-session-image';

function dispatch(elements: Element[] = []) {
  return {
    setNodeRunning: vi.fn(),
    setNodeResult: vi.fn(),
    addGeneration: vi.fn(),
    addAsset: vi.fn(),
    getElements: vi.fn(() => elements),
  };
}

describe('Spaces RunPod generation-session image nodes', () => {
  beforeEach(() => {
    generateSessionImageAndWait.mockReset();
  });

  it('registers distinct session nodes while preserving labeled Serverless nodes', () => {
    const sdxl = RUNPOD_MODEL_REGISTRY[RUNPOD_SDXL_SESSION_NODE_TYPE];
    const qwen = RUNPOD_MODEL_REGISTRY[RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE];

    expect(sdxl).toMatchObject({
      name: 'SDXL Session',
      provider: 'runpod',
      category: 'image',
      responseMapping: { path: 'url' },
    });
    expect(sdxl).not.toHaveProperty('runpodEndpointId');
    expect(qwen).toMatchObject({
      name: 'Qwen Image Edit Session',
      provider: 'runpod',
      category: 'image-edit',
      responseMapping: { path: 'url' },
    });
    expect(qwen).not.toHaveProperty('runpodEndpointId');
    expect(RUNPOD_MODEL_REGISTRY['runpod-sdxl'].name).toBe('Stable Diffusion XL (Serverless)');
    expect(RUNPOD_MODEL_REGISTRY['runpod-qwen-image-edit'].name).toBe('Qwen Image Edit (Serverless)');
    expect(NODE_REGISTRY[RUNPOD_SDXL_SESSION_NODE_TYPE].outputs).toEqual([
      { id: 'image', type: 'image', label: 'image' },
    ]);

    const qwenFields = Object.fromEntries(qwen.inputs.map((field) => [field.id, field]));
    expect(qwenFields.image_url).toMatchObject({ fieldType: 'port', required: true });
    expect(qwenFields.extra_images).toMatchObject({ fieldType: 'element-list', max: 2 });
    expect(qwenFields.width).toMatchObject({ default: '' });
    expect(qwenFields.height).toMatchObject({ default: '' });
  });

  it('maps SDXL controls and at most three Qwen references to the shared RPC contract', () => {
    expect(buildRunpodSessionImageInput(RUNPOD_SDXL_SESSION_NODE_TYPE, {
      prompt: '  A practical moonlit set  ',
      negativePrompt: '  painting  ',
      width: 1280,
      height: 768,
      steps: 30,
      guidanceScale: 6.5,
      seed: 11,
    })).toEqual({
      model: 'sdxl',
      prompt: 'A practical moonlit set',
      negativePrompt: 'painting',
      width: 1280,
      height: 768,
      steps: 30,
      guidanceScale: 6.5,
      seed: 11,
    });

    expect(buildRunpodSessionImageInput(RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE, {
      prompt: '  Change the jacket to red.  ',
      image_url: 'https://cdn.example/base.png',
      image_urls: [
        'https://cdn.example/look.png',
        'https://cdn.example/prop.png',
        'https://cdn.example/ignored.png',
      ],
      width: 1024,
      height: 768,
      seed: 12,
    })).toEqual({
      model: 'qwen-image-edit',
      prompt: 'Change the jacket to red.',
      referenceImages: [
        'https://cdn.example/base.png',
        'https://cdn.example/look.png',
        'https://cdn.example/prop.png',
      ],
      width: 1024,
      height: 768,
      seed: 12,
    });
  });

  it('special-routes an SDXL node and publishes its image URL', async () => {
    generateSessionImageAndWait.mockResolvedValue({
      jobId: 'job-sdxl',
      url: 'local-media://file/spaces-sdxl.png',
      model: 'SDXL',
    });
    const node: Node<WorkflowNodeData> = {
      id: 'sdxl-1',
      position: { x: 0, y: 0 },
      data: {
        type: RUNPOD_SDXL_SESSION_NODE_TYPE,
        label: 'SDXL Session',
        config: {
          prompt: 'A detective in a sodium-lit office.',
          negative_prompt: 'illustration',
          width: '1024',
          height: '768',
          num_inference_steps: 25,
          guidance_scale: 7.5,
          seed: 42,
        },
      },
    };
    const actions = dispatch();

    await executeWorkflow([node], [], actions);

    expect(generateSessionImageAndWait).toHaveBeenCalledWith({
      model: 'sdxl',
      prompt: 'A detective in a sodium-lit office.',
      negativePrompt: 'illustration',
      width: 1024,
      height: 768,
      steps: 25,
      guidanceScale: 7.5,
      seed: 42,
    }, expect.objectContaining({ onJobId: expect.any(Function) }));
    expect(actions.setNodeResult).toHaveBeenCalledWith('sdxl-1', {
      status: 'complete',
      url: 'local-media://file/spaces-sdxl.png',
    });
    expect(actions.addGeneration).toHaveBeenCalledWith('sdxl-1', 'local-media://file/spaces-sdxl.png');
  });

  it('passes every selected Element to Qwen through one required Image connection', async () => {
    const elements: Element[] = [
      {
        id: 'office', name: "Dr. Jordan's Office", type: 'location', description: '', createdAt: '', updatedAt: '',
        images: [
          { id: 'office-front', url: 'local-media://office-front.png', createdAt: '', source: 'upload' },
          { id: 'office-alt', url: 'local-media://office-alt.png', createdAt: '', source: 'upload' },
        ],
      },
      {
        id: 'peter', name: 'Peter', type: 'character', description: '', createdAt: '', updatedAt: '',
        images: [{ id: 'peter-front', url: 'local-media://peter-front.png', createdAt: '', source: 'upload' }],
      },
    ];
    const nodes: Node<WorkflowNodeData>[] = [
      {
        id: 'prompt', type: 'prompt', position: { x: 0, y: 0 },
        data: { type: 'prompt', label: 'Prompt', config: { prompt: "Close up on @Peter in @Dr-Jordans-Office" } },
      },
      {
        id: 'elements', type: 'element', position: { x: 0, y: 300 },
        data: { type: 'element', label: 'Element References', config: { elementIds: ['office', 'peter'] } },
      },
      {
        id: 'qwen', type: RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE, position: { x: 500, y: 0 },
        data: { type: RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE, label: 'Qwen Image Edit Session', config: {} },
      },
    ];
    generateSessionImageAndWait.mockResolvedValue({
      jobId: 'qwen-elements-job',
      url: 'local-media://qwen-elements.png',
    });

    await executeWorkflow(nodes, [
      { id: 'prompt-edge', source: 'prompt', sourceHandle: 'text', target: 'qwen', targetHandle: 'prompt' },
      { id: 'element-edge', source: 'elements', sourceHandle: 'element', target: 'qwen', targetHandle: 'image_url' },
    ], dispatch(elements));

    expect(generateSessionImageAndWait).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen-image-edit',
      referenceImages: [
        'local-media://office-front.png',
        'local-media://peter-front.png',
      ],
      prompt: expect.stringMatching(/Picture 1 is the base location[\s\S]*Picture 2 is a character identity reference/),
    }), expect.objectContaining({ onJobId: expect.any(Function) }));
    expect(generateSessionImageAndWait.mock.calls[0][0].prompt).toContain('the character shown in Picture 2');
    expect(generateSessionImageAndWait.mock.calls[0][0].prompt).toContain('the location shown in Picture 1');
    expect(generateSessionImageAndWait.mock.calls[0][0].prompt).toContain("Do not render CineGen's internal element names");
    expect(generateSessionImageAndWait.mock.calls[0][0].prompt).not.toContain('@');
  });

  it('retains a timed-out image job and resumes it without resubmitting', async () => {
    generateSessionImageAndWait.mockImplementationOnce(async (_input, options) => {
      options?.onJobId?.('job-image-timeout');
      throw new Error('The origin hit a Proxy Read Timeout. 524');
    });
    const node: Node<WorkflowNodeData> = {
      id: 'qwen-resume',
      position: { x: 0, y: 0 },
      data: {
        type: RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE,
        label: 'Qwen Image Edit Session',
        config: {
          prompt: 'Remove the sign.',
          image_url: 'https://cdn.example/source.png',
          width: '1024',
          height: '1024',
        },
      },
    };
    const actions = dispatch();

    await executeWorkflow([node], [], actions);
    expect(actions.setNodeResult).toHaveBeenLastCalledWith('qwen-resume', expect.objectContaining({
      status: 'error',
      remoteJobId: 'job-image-timeout',
    }));

    generateSessionImageAndWait.mockResolvedValueOnce({
      jobId: 'job-image-timeout',
      url: 'https://cdn.example/recovered.png',
    });
    await executeWorkflow([{
      ...node,
      data: {
        ...node.data,
        result: { status: 'error', error: 'Proxy Read Timeout', remoteJobId: 'job-image-timeout' },
      },
    }], [], actions);

    expect(generateSessionImageAndWait).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'qwen-image-edit' }),
      expect.objectContaining({ resumeJobId: 'job-image-timeout' }),
    );
  });
});
