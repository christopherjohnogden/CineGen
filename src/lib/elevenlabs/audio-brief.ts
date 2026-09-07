import type { Element } from '@/types/elements';

export function elevenLabsAudioBrief(config: Record<string, unknown>, character?: Element, target?: { nodeId: string; spaceId?: string; projectId?: string }): string {
  const kind = String(config.kind || 'speech');
  return [
    `Create ${kind === 'sound' ? 'a sound effect' : 'spoken audio'} using my ElevenLabs MCP. Do not use fal.ai.`,
    character ? `Character: ${character.name}${character.voice?.voiceId ? `, ElevenLabs voice ID: ${character.voice.voiceId}` : ''}.` : '',
    character?.voice?.description ? `Character voice direction: ${character.voice.description}` : '',
    config.direction ? `Delivery / sound direction: ${config.direction}` : '',
    kind === 'speech' ? `Speak only this text:\n${config.text || '(Help me write the dialogue first.)'}` : `Sound prompt:\n${config.text || '(Help me write the sound brief first.)'}`,
    kind === 'speech' ? 'If no voice has been chosen, help me design or select one and let me hear the previews before saving it.' : '',
    target ? `When finished, call CineGen cinegen_audio with action "attach", nodeId "${target.nodeId}"${target.spaceId ? `, spaceId "${target.spaceId}"` : ''}${target.projectId ? `, projectId "${target.projectId}"` : ''}, and audioUrl from ElevenLabs. This saves the audio to the Canvas node and media library. Read the node again before attaching if I have changed the brief.` : '',
    'Return downloadable HTTPS audio (MP3 or WAV). A local output must be uploaded into CineGen first. Do not mark the task complete until CineGen confirms the audio is saved.',
  ].filter(Boolean).join('\n\n');
}
