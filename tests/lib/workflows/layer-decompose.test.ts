import { describe, expect, it } from 'vitest';
import {
  getLayerDecomposeAutoPrompts,
  getLayerDecomposeStageLabel,
  getLayerDecomposeStageProgress,
  isLayerDecomposeNodeType,
  mergeLayerDecomposePrompts,
  parseLayerDecomposeVisionMaskLabels,
  parseLayerDecomposeVisionOutput,
} from '@/lib/workflows/layer-decompose';

describe('layer-decompose helpers', () => {
  it('maps known stages to stable progress values', () => {
    expect(getLayerDecomposeStageProgress('ocr')).toBe(14);
    expect(getLayerDecomposeStageProgress('inpainting')).toBe(88);
    expect(getLayerDecomposeStageProgress('missing')).toBeUndefined();
  });

  it('returns readable stage labels', () => {
    expect(getLayerDecomposeStageLabel('segmentation')).toBe('Finding layers');
    expect(getLayerDecomposeStageLabel('unknown')).toBeUndefined();
  });

  it('provides a bounded automatic prompt bank', () => {
    expect(getLayerDecomposeAutoPrompts(4)).toEqual([
      'main headline text',
      'subtitle text',
      'text block',
      'small caption text',
    ]);
    expect(getLayerDecomposeAutoPrompts()).toContain('flyer card');
    expect(getLayerDecomposeAutoPrompts().length).toBeGreaterThan(10);
  });

  it('identifies layer decompose nodes', () => {
    expect(isLayerDecomposeNodeType('layer-decompose')).toBe(true);
    expect(isLayerDecomposeNodeType('layer-decompose-cloud')).toBe(true);
    expect(isLayerDecomposeNodeType('qwen-image-layered')).toBe(false);
  });

  it('parses structured vision output into prompt labels', () => {
    const raw = '```json\n{"elements":["Main title","logo","photo","button","background"]}\n```';
    expect(parseLayerDecomposeVisionOutput(raw)).toEqual(['main title', 'logo', 'photo', 'button']);
  });

  it('merges generated prompts with defaults without duplicates', () => {
    expect(mergeLayerDecomposePrompts(['logo', 'photo'], ['photo', 'shape'])).toEqual(['logo', 'photo', 'shape']);
  });

  it('extracts ordered mask labels from [SEG] output', () => {
    const raw = '<p>main headline text</p> [SEG]\n<p>green flyer card</p> [SEG]\n<p>logo</p> [SEG]';
    expect(parseLayerDecomposeVisionMaskLabels(raw)).toEqual(['main headline text', 'green flyer card', 'logo']);
  });
});
