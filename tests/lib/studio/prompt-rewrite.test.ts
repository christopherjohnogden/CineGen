import { expect, it } from 'vitest';
import { applyStudioPromptEdits } from '@/lib/studio/prompt-rewrite';
it('changes only targeted wording and retains every unrelated shot and constraint', () => {
  const original = '@Cody. SHOT 1 [0–5s] Hard sunlight. SHOT 2 [5–10s] Close-up. No dialogue.\nKeep the same clothes.';
  expect(applyStudioPromptEdits({ edits: [{ find: 'Hard sunlight', replace: 'Soft morning light' }] }, original)).toBe(original.replace('Hard sunlight', 'Soft morning light'));
});
it('applies non-overlapping edits against the original, independent of replacement length or ordering', () => {
  expect(applyStudioPromptEdits({ edits: [{ find: 'end', replace: 'a long ending' }, { find: 'start', replace: 'opening' }] }, 'start middle end')).toBe('opening middle a long ending');
});
it('rejects ambiguous, nonexistent, malformed and overlapping edits instead of guessing', () => {
  for (const edits of [
    [{ find: 'shot', replace: 'wide' }],
    [{ find: 'missing', replace: 'something' }],
    [{ find: '', replace: 'something' }],
    [{ find: 'shot one', replace: 'first' }, { find: 'one', replace: '1' }],
    [{ find: 'one', replace: null }],
  ]) expect(() => applyStudioPromptEdits({ edits }, 'shot one shot two')).toThrow();
});
it('supports creating a prompt from an empty field and no-op rewrites', () => {
  expect(applyStudioPromptEdits({ edits: [{ find: '', replace: 'New cinematic shot.' }] }, '')).toBe('New cinematic shot.');
  expect(applyStudioPromptEdits({ edits: [] }, 'Original unchanged.')).toBe('Original unchanged.');
});
