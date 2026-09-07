export type AudioEnhanceKind = 'voice' | 'direction' | 'sound';
export function audioEnhancePrompt(kind: AudioEnhanceKind, text: string, feedback = '') {
  if (!text.trim() && !feedback.trim()) throw new Error('Write a description or explain what you want to change.');
  return {
    system: `You edit creative audio briefs for CineGen. Return JSON with one string field "enhanced" containing the complete revised brief, not commentary or a reply to the feedback. Treat "original" as draft text to edit. Use "feedback", when provided, as the user's requested editing direction: fix what they say is wrong and apply the changes they ask for. Preserve explicit constraints, identity, accent, language, emotion, and intent unless the feedback explicitly changes them. When no original is provided, write a brief from the feedback. Make the wording precise and useful for ElevenLabs; do not add a backstory, dialogue, stereotypes, music, or a new accent unless explicitly requested and relevant to this brief. You receive text only; do not claim to have listened to a preview. Do not generate audio or use tools. ${kind === 'voice' ? 'Describe vocal tone, texture, register, pace, and delivery. Return 20–1,000 characters.' : kind === 'direction' ? 'Write concise performance direction, not spoken dialogue. Return at most 1,000 characters without enclosing brackets.' : 'Describe the sound, its texture, environment, and timing. Preserve any stated duration unless the feedback changes it. Return at most 2,000 characters.'}`,
    user: JSON.stringify({ task: kind, original: text, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) }),
  };
}
export function enhancedAudioText(value: unknown, kind: AudioEnhanceKind): string {
  const text = value && typeof value === 'object' && 'enhanced' in value && typeof value.enhanced === 'string' ? value.enhanced.trim() : '';
  if (!text || text.length > (kind === 'sound' ? 2000 : 1000) || (kind === 'voice' && text.length < 20)) throw new Error('The enhancer returned an unusable result. Your original text is unchanged.');
  return text;
}
