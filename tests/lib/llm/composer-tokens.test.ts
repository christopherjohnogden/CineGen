import { describe, expect, it } from 'vitest';
import {
  findSkillIdInText,
  insertSkillTokenInDraft,
  removeSkillTokens,
  splitComposerHighlightParts,
} from '@/lib/llm/composer-tokens';

describe('composer-tokens', () => {
  const skills = [
    { id: 'skill-1', name: 'shot-list' },
    { id: 'skill-2', name: 'storyboard' },
  ];

  it('inserts and replaces skill tokens', () => {
    const first = insertSkillTokenInDraft('', 0, 'shot-list', skills.map((skill) => skill.name));
    expect(first.text).toBe('#shot-list');

    const second = insertSkillTokenInDraft('#shot-list write coverage', 24, 'storyboard', skills.map((skill) => skill.name));
    expect(second.text).toBe('write coverage #storyboard');
    expect(findSkillIdInText(second.text, skills)).toBe('skill-2');
  });

  it('highlights known composer tokens', () => {
    const parts = splitComposerHighlightParts(
      '#shot-list ask about @hero /interview-a',
      {
        elementNames: new Set(['hero']),
        assetNames: new Set(['interview-a']),
        skillNames: new Set(['shot-list']),
      },
    );
    expect(parts).toEqual([
      { text: '#shot-list', kind: 'skill' },
      { text: ' ask about ' },
      { text: '@hero', kind: 'element' },
      { text: ' ' },
      { text: '/interview-a', kind: 'asset' },
    ]);
  });

  it('removes skill tokens from draft text', () => {
    expect(removeSkillTokens('#shot-list build a list', ['shot-list', 'storyboard'])).toBe('build a list');
  });
});
