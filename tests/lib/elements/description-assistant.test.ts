import { describe, expect, it } from 'vitest';
import {
  cleanElementDescription,
  elementDescriptionStarter,
  elementDescriptionSystemPrompt,
} from '@/lib/elements/description-assistant';

describe('element description assistant', () => {
  it('gives character-specific continuity direction without locking a camera view', () => {
    const prompt = elementDescriptionSystemPrompt({
      type: 'character',
      name: 'Mara Voss',
      currentDescription: 'A salvage pilot in a faded orange flight suit.',
    });

    expect(prompt).toContain('repeatable identity');
    expect(prompt).toContain('faded orange flight suit');
    expect(prompt).toContain('Do not prescribe a camera angle');
    expect(prompt).toContain('Return only the description as plain text');
  });

  it('uses visual-development guidance tailored to every element type', () => {
    expect(elementDescriptionSystemPrompt({ type: 'location', name: 'Relay Nine' })).toContain('architecture');
    expect(elementDescriptionSystemPrompt({ type: 'prop', name: 'Signal Key' })).toContain('mechanisms');
    expect(elementDescriptionSystemPrompt({ type: 'vehicle', name: 'Night Ferry' })).toContain('propulsion');
  });

  it('removes common response wrappers before applying the description', () => {
    expect(cleanElementDescription('```text\nDescription: Weathered brass compass with a cracked enamel face.\n```'))
      .toBe('Weathered brass compass with a cracked enamel face.');
    expect(cleanElementDescription('“Long black wool coat with oxidized silver fasteners.”'))
      .toBe('Long black wool coat with oxidized silver fasteners.');
  });

  it('provides a concrete conversational starter for each type', () => {
    expect(elementDescriptionStarter('character')).toContain('wardrobe');
    expect(elementDescriptionStarter('location')).toContain('architecture');
    expect(elementDescriptionStarter('prop')).toContain('materials');
    expect(elementDescriptionStarter('vehicle')).toContain('modifications');
  });
});
