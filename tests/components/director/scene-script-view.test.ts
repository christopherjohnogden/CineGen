import { describe, expect, it } from 'vitest';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import { sceneScriptItems } from '@/lib/director/scene-script-items';

describe('sceneScriptItems', () => {
  const scenes = splitScenes(parseToScreenplay([
    'INT. EDIT SUITE - NIGHT',
    '',
    'Mara studies the cut.',
    '',
    'EXT. BACKLOT - DAWN',
    '',
    'Theo crosses through the fog.',
  ].join('\n')));

  it('includes the complete screenplay when All scenes is selected', () => {
    const items = sceneScriptItems(scenes, 'all');

    expect(items.map((item) => item.element.text)).toEqual([
      'INT. EDIT SUITE - NIGHT',
      'Mara studies the cut.',
      'EXT. BACKLOT - DAWN',
      'Theo crosses through the fog.',
    ]);
    expect(new Set(items.map((item) => item.sceneIndex))).toEqual(new Set([0, 1]));
  });

  it('keeps individual scene selections scoped to that scene', () => {
    expect(sceneScriptItems(scenes, 1).map((item) => item.element.text)).toEqual([
      'EXT. BACKLOT - DAWN',
      'Theo crosses through the fog.',
    ]);
  });
});
