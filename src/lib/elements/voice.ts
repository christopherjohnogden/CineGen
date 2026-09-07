import type { Element, ElementVoice } from '../../types/elements';

export function normalizeElementVoice(raw: unknown): ElementVoice | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const text = (key: string) => typeof value[key] === 'string' ? value[key].trim() : '';
  const ref = value.referenceAudio as Record<string, unknown> | undefined;
  const referenceAudio = ref && typeof ref.id === 'string' && typeof ref.url === 'string' && ref.url
    ? { id: ref.id, url: ref.url, createdAt: typeof ref.createdAt === 'string' ? ref.createdAt : '', source: ref.source === 'generated' ? 'generated' as const : 'upload' as const }
    : undefined;
  if (!text('description') && !text('voiceId') && !text('voiceName') && !text('sampleText') && !referenceAudio) return undefined;
  return {
    description: text('description'),
    ...(value.provider === 'elevenlabs' || text('voiceId') ? { provider: 'elevenlabs' as const } : {}),
    ...(text('voiceId') ? { voiceId: text('voiceId') } : {}),
    ...(text('voiceName') ? { voiceName: text('voiceName') } : {}),
    ...(text('sampleText') ? { sampleText: text('sampleText') } : {}),
    ...(referenceAudio ? { referenceAudio } : {}),
  };
}

/** Apply only to video prompts: a voice brief must never be read aloud by TTS. */
export function withCharacterVoices(prompt: string, elements: Pick<Element, 'id' | 'name' | 'type' | 'voice'>[]): string {
  const seen = new Set<string>();
  const lines = elements.flatMap(element => {
    if (element.type !== 'character' || !element.voice?.description.trim() || seen.has(element.id)) return [];
    seen.add(element.id);
    const line = `${element.name}: ${element.voice.description.trim()}`;
    return prompt.includes(line) ? [] : [line];
  });
  return lines.length ? `${prompt}\n\nCharacter voice direction (when speaking; do not add dialogue):\n${lines.join('\n')}` : prompt;
}

export function voiceElementsForPrompt(prompt: string, elements: Element[], explicitIds: string[] = []): Element[] {
  const normalized = prompt.toLowerCase().replace(/[-_]/g, ' ');
  return elements.filter(element => {
    if (explicitIds.includes(element.id)) return true;
    const tag = element.name.toLowerCase().replace(/[-_]/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Boolean(tag) && new RegExp(`@${tag}(?![\\w])`).test(normalized);
  });
}

export function elevenLabsVoiceBrief(name: string, voice: ElementVoice | undefined, elementId?: string): string {
  return [
    `Use my ElevenLabs MCP to ${voice?.voiceId ? 'generate a voice sample' : 'design a voice'} for the CineGen character ${JSON.stringify(name || 'Untitled character')}.`,
    voice?.description ? `Voice direction: ${voice.description}` : 'Help me choose the character’s accent, tone, texture, pace and emotional delivery first.',
    voice?.voiceId ? `Use ElevenLabs voice ID: ${voice.voiceId}.` : 'Let me listen to the voice previews and choose a voice before saving it.',
    voice?.sampleText ? `Sample dialogue (speak only this text): ${voice.sampleText}` : 'Use a short sample line suited to the character.',
    elementId ? `Read CineGen Element ${elementId}, then use cinegen_edit_element to save the chosen voice under patch.voice (description, provider: "elevenlabs", voiceId, voiceName, sampleText). Attach the audio with cinegen_audio action "attach", elementId "${elementId}" and the returned audioUrl.` : 'Save the character in CineGen first, then attach the chosen ElevenLabs voice and sample to its Element.',
    'Use my ElevenLabs connection. Do not substitute fal.ai. If the audio is a local file, upload it into CineGen or provide a downloadable HTTPS URL before attaching it.',
  ].filter(Boolean).join('\n\n');
}
