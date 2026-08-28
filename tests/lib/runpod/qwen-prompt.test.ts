import { describe, expect, it } from 'vitest';
import { qwenMultiImagePrompt } from '@/lib/runpod/qwen-prompt';

describe('Qwen multi-picture prompt compiler', () => {
  it('replaces CineGen tags with numbered natural-language roles without exposing tags', () => {
    const prompt = qwenMultiImagePrompt(
      "Close up on @PETER sitting on a sofa in @DR. JORDAN'S OFFICE",
      [
        { kind: 'location', key: 'office', name: "Dr. Jordan's Office" },
        { kind: 'character', key: 'peter', name: 'Peter' },
      ],
    );

    expect(prompt).toContain('the character shown in Picture 2');
    expect(prompt).toContain('the location shown in Picture 1');
    expect(prompt).toContain('Picture 1 is the base location');
    expect(prompt).toContain('Picture 2 is a character identity reference');
    expect(prompt).toContain('Use every supplied picture');
    expect(prompt).toContain("Do not render CineGen's internal element names");
    expect(prompt).not.toContain('@');
    expect(prompt).not.toContain('PETER');
  });

  it('identifies an alternate view without asking Qwen to duplicate the Element', () => {
    const prompt = qwenMultiImagePrompt('Place the referenced vehicle outside.', [
      { kind: 'vehicle', key: 'car', name: 'Hero Car' },
      { kind: 'location', key: 'street', name: 'Main Street' },
      { kind: 'vehicle', key: 'car', name: 'Hero Car' },
    ]);

    expect(prompt).toContain('Picture 3 is an additional view of the same vehicle as Picture 1');
    expect(prompt).toContain('do not create a second copy');
  });

  it('matches overlapping Element names longest-first and is idempotent', () => {
    const pictures = [
      { kind: 'character' as const, key: 'peter-boy', name: 'Peter Boy' },
      { kind: 'character' as const, key: 'peter', name: 'Peter' },
      { kind: 'location' as const, key: 'office', name: "Dr. Jordan's Office" },
    ];
    const first = qwenMultiImagePrompt(
      "Show @Peter-Boy beside @Peter in @Dr. Jordan's Office.",
      pictures,
    );
    const second = qwenMultiImagePrompt(first, pictures);

    expect(second).toBe(first);
    expect(first).toContain('the character shown in Picture 1 beside the character shown in Picture 2');
    expect(first).toContain('the location shown in Picture 3');
    expect(first).not.toMatch(/@|Peter-Boy|Jordan's Office/i);
  });

  it('does not ban text that the scene explicitly requests', () => {
    const prompt = qwenMultiImagePrompt('Change the sign to read OPEN.', [
      { kind: 'source', key: 'sign' },
    ]);

    expect(prompt).toContain('Change the sign to read OPEN.');
    expect(prompt).toContain('Only add visible text when the scene request explicitly asks for it.');
    expect(prompt).not.toContain('no recognizable text');
  });
});
