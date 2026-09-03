import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_COMPOSER_DRAFT, readComposerDraft, writeComposerDraft } from '@/lib/studio/draft';

/**
 * The composer emptying itself is not cosmetic: the next Generate goes out
 * without the references you thought were attached, and the render is paid for
 * before you find out.
 */
describe('composer draft', () => {
  beforeEach(() => { localStorage.clear(); });

  it('brings back the prompt and the attached files after a reload', () => {
    writeComposerDraft('p1', {
      prompt: 'Replace the player wearing 13.',
      outputKind: 'video',
      videoMode: 'references',
      elementIds: ['el-peter'],
      attachments: [
        { id: 'a1', url: 'local-media://game.mp4', name: 'game.mp4', kind: 'video' },
        { id: 'a2', url: 'local-media://sheet.png', name: 'sheet.png', kind: 'image' },
      ],
      startAssetId: '',
      endAssetId: '',
    });

    const restored = readComposerDraft('p1');
    expect(restored.prompt).toBe('Replace the player wearing 13.');
    expect(restored.attachments.map((entry) => entry.url))
      .toEqual(['local-media://game.mp4', 'local-media://sheet.png']);
    expect(restored.attachments[0].kind).toBe('video');
    expect(restored.elementIds).toEqual(['el-peter']);
  });

  it('is scoped per project and survives a corrupt entry', () => {
    writeComposerDraft('p1', { ...EMPTY_COMPOSER_DRAFT, prompt: 'One.' });
    expect(readComposerDraft('p2')).toEqual(EMPTY_COMPOSER_DRAFT);

    localStorage.setItem('cinegen_studio_draft:p3', '{not json');
    expect(readComposerDraft('p3')).toEqual(EMPTY_COMPOSER_DRAFT);
  });

  it('drops attachment entries that lost their URL rather than restoring a blank chip', () => {
    localStorage.setItem('cinegen_studio_draft:p4', JSON.stringify({
      prompt: 'Keep me.',
      attachments: [{ id: 'a1' }, { id: 'a2', url: '   ' }, { id: 'a3', url: 'local-media://ok.png' }],
    }));

    const restored = readComposerDraft('p4');
    expect(restored.prompt).toBe('Keep me.');
    expect(restored.attachments).toEqual([
      { id: 'a3', url: 'local-media://ok.png', name: '', kind: 'image' },
    ]);
  });
});
