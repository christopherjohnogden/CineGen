import type { Element } from '@/types/elements';

export function elevenLabsAudioBrief(config: Record<string, unknown>, character?: Element, target?: { nodeId: string; spaceId?: string; projectId?: string }): string {
  const kind = String(config.kind || 'speech');
  return [
    `Create ${kind === 'sound' ? 'a sound effect' : 'spoken audio'} inside CineGen using its connected ElevenLabs account.`,
    character ? `Character: ${character.name}${character.voice?.voiceId ? `, ElevenLabs voice ID: ${character.voice.voiceId}` : ''}.` : '',
    character?.voice?.description ? `Character voice direction: ${character.voice.description}` : '',
    config.direction ? `Delivery / sound direction: ${config.direction}` : '',
    kind === 'speech' ? `Speak only this text:\n${config.text || '(Help me write the dialogue first.)'}` : `Sound prompt:\n${config.text || '(Help me write the sound brief first.)'}`,
    kind === 'speech' ? 'If no voice has been chosen, choose or design a voice in the character voice panel before running the audio node.' : '',
    target ? `Run CineGen cinegen_audio with action "generate", nodeId "${target.nodeId}"${target.spaceId ? `, spaceId "${target.spaceId}"` : ''}${target.projectId ? `, projectId "${target.projectId}"` : ''}, and a unique requestId. Reuse that requestId to recover the same take. The result is saved and plays inside CineGen.` : '',
    'If audio already exists, use cinegen_audio action "attach" with its downloadable HTTPS URL instead of generating again.',
  ].filter(Boolean).join('\n\n');
}
