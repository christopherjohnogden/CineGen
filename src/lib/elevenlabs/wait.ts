import { elevenLabs } from './client';
import type { ElevenLabsAudioResult } from './types';

/** Wait for the same paid take. A job check never submits speech again. */
export async function waitForElevenLabsAudio(initial: ElevenLabsAudioResult): Promise<ElevenLabsAudioResult> {
  let current = initial;
  const deadline = Date.now() + 10 * 60 * 1000;
  let failures = 0;
  for (;;) {
    if (current.status === 'complete' && current.url) return current;
    if (current.status === 'error') throw new Error(current.error || 'ElevenLabs could not finish this take.');
    if (current.error && ++failures >= 3) throw new Error(current.error);
    if (!current.error) failures = 0;
    if (Date.now() >= deadline) throw new Error('This take is still processing. Check this same take again to recover it.');
    await new Promise(resolve => setTimeout(resolve, 5000));
    try { current = await elevenLabs.job(initial.requestId); }
    catch (cause) {
      current = { ...current, error: cause instanceof Error ? cause.message : 'Could not check this audio take.' };
    }
  }
}
