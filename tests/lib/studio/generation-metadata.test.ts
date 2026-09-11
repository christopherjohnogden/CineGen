import { describe, expect, it } from 'vitest';
import { getModelDefinition } from '@/lib/fal/models';
import { captureGenerationMetadata } from '@/lib/studio/generation-metadata';
import { assetFromRow, assetToRow } from '@/lib/db-converters';

describe('saved generation metadata', () => {
  it('captures actual wired inputs, including audio, and survives node edits and asset serialization', () => {
    const base = 'https://firebasestorage.googleapis.com/';
    const model = getModelDefinition('nano-banana-2')!;
    const node: any = { id: 'generation', type: model.nodeType, position: { x: 0, y: 0 }, data: {
      type: model.nodeType, label: 'Output', config: { prompt: 'Original prompt', image_url: base + 'unused.png' },
      result: { status: 'complete', url: base + 'output.png' },
    } };
    const image: any = { id: 'image', type: 'filePicker', data: { type: 'filePicker', label: 'Actual image', config: { fileUrl: base + 'actual.png', fileType: 'image' } } };
    const audio: any = { id: 'audio', type: 'filePicker', data: { type: 'filePicker', label: 'Actual audio', config: { fileUrl: base + 'actual.mp3', fileType: 'audio' } } };
    const space: any = { nodes: [node, image, audio], edges: [
      { id: 'image-edge', source: 'image', target: node.id, targetHandle: 'image_url' },
      { id: 'legacy-audio-edge', source: 'audio', target: node.id },
    ] };
    const generation = captureGenerationMetadata(node, model, space, { assets: [], elements: [] }, base + 'output.png');
    expect(generation.references.map(ref => [ref.kind, ref.url])).toEqual([
      ['image', base + 'actual.png'], ['audio', base + 'actual.mp3'],
    ]);
    node.data.config.prompt = 'New prompt'; image.data.config.fileUrl = base + 'changed.png';
    const asset = assetFromRow(assetToRow({ id: 'output', name: 'Saved', type: 'image', url: base + 'output.png',
      createdAt: 'now', metadata: { generation } }, 'project'));
    expect(asset.metadata?.generation).toMatchObject({ version: 1, prompt: 'Original prompt', sourceNodeId: node.id });
    expect((asset.metadata?.generation as any).references[0].url).toBe(base + 'actual.png');
  });
});
