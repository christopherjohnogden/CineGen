import { describe, expect, it } from 'vitest';
import { buildEnhanceRequest, cleanEnhancedPrompt } from '../../../src/lib/edit/frame-chat-prompt';

describe('buildEnhanceRequest', () => {
  it('embeds the rules, an example, and the user instruction', () => {
    const req = buildEnhanceRequest('make the suit green');
    expect(req).toContain('EDITS an existing reference frame');
    expect(req).toContain('Do NOT invent a new scene');
    expect(req).toContain('Example input:');
    expect(req).toContain('make the suit green');
  });
});

describe('cleanEnhancedPrompt', () => {
  const FALLBACK = 'make the suit green';

  it('returns a clean one-liner unchanged', () => {
    const good = "Change the subject's suit to green, keeping the same person, pose, framing, and lighting unchanged.";
    expect(cleanEnhancedPrompt(good, FALLBACK)).toBe(good);
  });

  it('strips a leading meta clause ending in a colon', () => {
    const out = cleanEnhancedPrompt("Here's a stronger generation prompt: Change the suit to green, keeping everything else identical.", FALLBACK);
    expect(out).toBe('Change the suit to green, keeping everything else identical.');
    expect(out).not.toMatch(/stronger generation prompt/i);
  });

  it('unwraps a quoted answer', () => {
    const out = cleanEnhancedPrompt('Sure! "Change the suit to green, keeping the framing and lighting unchanged."', FALLBACK);
    expect(out).toBe('Change the suit to green, keeping the framing and lighting unchanged.');
  });

  it('recovers the real prompt after a refusal/meta opener (the reported bug)', () => {
    const messy = [
      'I cannot directly invoke higgsfield-generate as a sub-agent.',
      'However, I can still provide a rewritten prompt.',
      'Change the suit to green, keeping the same person, pose, framing, background, and lighting unchanged.',
    ].join('\n');
    const out = cleanEnhancedPrompt(messy, FALLBACK);
    expect(out).toMatch(/^Change the suit to green/);
    expect(out).not.toMatch(/higgsfield-generate|However|I cannot/i);
  });

  it('falls back to the original when nothing usable remains', () => {
    expect(cleanEnhancedPrompt('', FALLBACK)).toBe(FALLBACK);
    expect(cleanEnhancedPrompt('  ', FALLBACK)).toBe(FALLBACK);
  });
});
