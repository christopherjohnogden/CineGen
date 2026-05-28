import { describe, expect, it } from 'vitest';
import { detectAgenticDeflection } from '@/lib/llm/claude-code-session';

describe('detectAgenticDeflection', () => {
  it('flags skill tool deferrals', () => {
    expect(detectAgenticDeflection('Let me check the available skills using the Skill tool.')).toBe(true);
    expect(detectAgenticDeflection('Let me invoke the shot-list skill first.')).toBe(true);
  });

  it('allows direct skill inventory answers', () => {
    expect(detectAgenticDeflection('You have these skills:\n1. shot-list')).toBe(false);
  });
});
