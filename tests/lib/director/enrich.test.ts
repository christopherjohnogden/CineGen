import { describe, expect, it } from 'vitest';
import { buildEnrichInput, parseEnrichResult, ENRICH_CHARACTER_SYSTEM_PROMPT } from '@/lib/director/enrich';
import type { DirectorBreakdownItem } from '@/types/director';

const item = (o: Partial<DirectorBreakdownItem>): DirectorBreakdownItem =>
  ({ id: 'i', kind: 'character', name: 'Dr Jordan', tag: '@Dr-Jordan', description: 'a weary scientist', ...o });

describe('ENRICH_CHARACTER_SYSTEM_PROMPT', () => {
  it('asks for a single character actingProfile + voice as JSON', () => {
    expect(ENRICH_CHARACTER_SYSTEM_PROMPT).toMatch(/actingProfile/);
    expect(ENRICH_CHARACTER_SYSTEM_PROMPT).toMatch(/voice/);
  });
});

describe('buildEnrichInput', () => {
  it('includes the character name/description and the scenes they appear in', () => {
    const src = 'INT. LAB - DAY\nDr Jordan studies a vial.\n\nEXT. PARK - DAY\nBirds sing.';
    const body = buildEnrichInput(item({}), src);
    expect(body).toMatch(/Dr Jordan/);
    expect(body).toMatch(/weary scientist/);
    expect(body).toMatch(/INT\. LAB - DAY/);       // scene they appear in
    expect(body).not.toMatch(/EXT\. PARK - DAY/);  // scene they do NOT appear in
  });
});

describe('parseEnrichResult', () => {
  it('extracts actingProfile and voice from clean JSON', () => {
    const r = parseEnrichResult({ actingProfile: 'holds still, watches', voice: 'low, measured' });
    expect(r.actingProfile).toBe('holds still, watches');
    expect(r.voice).toBe('low, measured');
  });
  it('tolerates missing voice', () => {
    const r = parseEnrichResult({ actingProfile: 'x' });
    expect(r.actingProfile).toBe('x');
    expect(r.voice).toBeUndefined();
  });
  it('returns {} on non-object', () => {
    expect(parseEnrichResult('nope')).toEqual({});
  });
});
