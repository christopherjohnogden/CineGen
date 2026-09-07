import { beforeEach, expect, it, vi } from 'vitest';
import { executeFromNode } from '@/lib/workflows/execute';
import type { WorkflowDispatch } from '@/lib/workflows/execute';
import type { Node } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';
const generate = vi.fn();
vi.mock('@/lib/elevenlabs/client', () => ({ elevenLabs: { generate: (...args: unknown[]) => generate(...args) } }));
const node = (result?: WorkflowNodeData['result']): Node<WorkflowNodeData> => ({ id: 'audio', type: 'elevenLabsAudio', position: { x: 0, y: 0 }, data: { type: 'elevenLabsAudio', label: 'Cody dialogue', config: { kind: 'speech', elementId: 'cody', text: 'Hello there.' }, result } });
const dispatch = (): WorkflowDispatch => ({ projectId: 'project', setNodeResult: vi.fn(), setNodeRunning: vi.fn(), addGeneration: vi.fn(), addAsset: vi.fn(), getElements: () => [{ id: 'cody', type: 'character', name: 'Cody', description: '', images: [], createdAt: '', updatedAt: '', voice: { description: 'Low, calm', voiceId: 'voice-cody' } }] });
beforeEach(() => { generate.mockReset(); });
it('executes an audio utility node with the character voice and inserts playable audio', async () => {
  generate.mockResolvedValue({ requestId: 'take-1', assetId: 'take-1', status: 'complete', url: 'https://media.example/audio.mp3' });
  const d = dispatch(); await executeFromNode('audio', [node()], [], d);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'voice-cody', text: 'Hello there.', kind: 'speech', projectId: 'project' }));
  expect(d.setNodeResult).toHaveBeenLastCalledWith('audio', expect.objectContaining({ status: 'complete', url: 'https://media.example/audio.mp3' }));
  expect(d.addAsset).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio', url: 'https://media.example/audio.mp3' }));
});
it('reuses the paid request ID after an interrupted save and surfaces the error', async () => {
  generate.mockResolvedValue({ requestId: 'paid-take', status: 'saving', error: 'Storage unavailable' });
  const d = dispatch(); await expect(executeFromNode('audio', [node({ status: 'error', audioRequestId: 'paid-take' })], [], d)).rejects.toThrow('Storage unavailable');
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'paid-take' }));
  expect(d.addAsset).not.toHaveBeenCalled();
  expect(d.setNodeResult).toHaveBeenLastCalledWith('audio', expect.objectContaining({ status: 'error', audioRequestId: 'paid-take' }));
});
it('explicitly generating another take uses a new request even on an MCP-created node', async () => {
  generate.mockResolvedValue({ requestId: 'next', assetId: 'next', status: 'complete', url: 'https://media.example/next.mp3' });
  const prior = node({ status: 'complete', audioRequestId: 'paid-take', url: 'https://media.example/old.mp3' });
  prior.data.config.audioRequestId = 'paid-take';
  await executeFromNode('audio', [prior], [], dispatch());
  expect(generate.mock.calls[0][0].requestId).not.toBe('paid-take');
});
