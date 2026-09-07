import { elevenLabs } from './client';
import { enhancedAudioText, type AudioEnhanceKind } from './enhance-prompt';
export { audioEnhancePrompt, enhancedAudioText } from './enhance-prompt';
export type { AudioEnhanceKind } from './enhance-prompt';

export async function enhanceAudioText(kind: AudioEnhanceKind, text: string, signal?: AbortSignal, requestId: string = crypto.randomUUID(), feedback = ''): Promise<string> {
  // CineGen's hosted text enhancer uses no audio credits or additional sign-in.
  for (let attempt = 0; attempt < 45; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await elevenLabs.enhance({ requestId, kind, text, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (result.status === 'complete') return enhancedAudioText({ enhanced: result.text }, kind);
    if (result.status === 'error') throw Object.assign(new Error(result.error || 'The enhancer could not finish. Your text is unchanged.'), { enhancementFinished: true });
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, 2000);
      signal?.addEventListener('abort', stop, { once: true });
    });
  }
  throw new Error('The enhancer is still working. Tap Enhance wording to check this same request.');
}
