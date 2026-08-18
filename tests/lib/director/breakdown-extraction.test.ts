import { describe, expect, it } from 'vitest';
import { BREAKDOWN_SYSTEM_PROMPT } from '@/lib/director/llm-jobs';

describe('breakdown prompt extraction requirements', () => {
  it('requires time-of-day / INT-EXT on locations', () => {
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/time of day/i);
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/INT\/EXT/i);
  });
  it('requires set dressing / furniture as props', () => {
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/set dressing/i);
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/furniture/i);
  });
});
