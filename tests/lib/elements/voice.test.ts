import { describe, expect, it } from 'vitest';
import { normalizeLibrary } from '@/lib/elements/library';
import { normalizeElementVoice, voiceElementsForPrompt, withCharacterVoices } from '@/lib/elements/voice';
import { materializeElementLooks } from '@/lib/elements/variations';

const character = { id: 'alice', name: 'Alice Smith', type: 'character' as const, description: 'A detective', images: [], createdAt: '', updatedAt: '', voice: { description: 'Low and warm. Measured pace.', provider: 'elevenlabs' as const, voiceId: 'voice-a', referenceAudio: { id: 'audio', url: 'https://media.example/voice.wav', createdAt: '', source: 'upload' as const } } };
describe('character vocal identity', () => {
  it('survives shared library serialization and continuity materialization', () => {
    const restored = normalizeLibrary(JSON.parse(JSON.stringify({ version: 1, folders: [], elements: [character] }))).elements[0];
    expect(materializeElementLooks(restored).voice).toEqual(character.voice);
    expect(normalizeLibrary({ elements: [{ ...character, type: 'prop' }] }).elements[0].voice).toBeUndefined();
  });
  it('keeps only voice settings, never arbitrary secrets', () => {
    expect(normalizeElementVoice({ description: ' Warm ', apiKey: 'private', voiceId: 'v' })).toEqual({ description: 'Warm', provider: 'elevenlabs', voiceId: 'v' });
    expect(normalizeElementVoice({ description: ' ' })).toBeUndefined();
  });
  it('includes only referenced characters, without duplicate direction or added dialogue', () => {
    const others = { ...character, id: 'bob', name: 'Bob' };
    expect(voiceElementsForPrompt('@Alice_Smith enters.', [character, others])).toEqual([character]);
    expect(voiceElementsForPrompt('Alice Smithson enters.', [character])).toEqual([]);
    const result = withCharacterVoices('She opens the door.', voiceElementsForPrompt('', [character, others], ['alice']));
    expect(result).toContain('Alice Smith: Low and warm. Measured pace.');
    expect(result).toContain('do not add dialogue');
    expect(withCharacterVoices(result, [character, character])).toBe(result);
    expect(result).not.toContain('voice-a');
  });
});
