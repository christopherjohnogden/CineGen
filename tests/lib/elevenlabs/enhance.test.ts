import { expect, it, vi, afterEach } from 'vitest';
import { audioEnhancePrompt, enhancedAudioText, enhanceAudioText } from '@/lib/elevenlabs/enhance';
const mock = vi.hoisted(() => ({ enhance: vi.fn() }));
vi.mock('@/lib/elevenlabs/client', () => ({ elevenLabs: { enhance: mock.enhance } }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
it('requires real input and rejects malformed or oversized enhancements without truncating', () => {
  expect(() => audioEnhancePrompt('voice', ' ')).toThrow('Write');
  expect(audioEnhancePrompt('voice', 'Warm and gravelly').system).toContain('do not add');
  expect(() => enhancedAudioText({ enhanced: 'x'.repeat(1001) }, 'voice')).toThrow('unchanged');
  expect(() => enhancedAudioText({ dialogue: 'Different words' }, 'direction')).toThrow('unchanged');
});
it('recovers one hosted rewrite using the same request ID and needs no additional provider connection', async () => {
  vi.useFakeTimers();
  mock.enhance.mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce({ status: 'complete', text: 'A warm baritone, textured and measured.' });
  const promise = enhanceAudioText('voice', 'Warm voice', undefined, 'rewrite-one');
  await vi.advanceTimersByTimeAsync(2000);
  expect(await promise).toContain('baritone');
  expect(mock.enhance.mock.calls).toEqual([[{ requestId: 'rewrite-one', kind: 'voice', text: 'Warm voice' }], [{ requestId: 'rewrite-one', kind: 'voice', text: 'Warm voice' }]]);
});
it('marks a finished failure so a deliberate retry can start again, but never retries automatically', async () => {
  mock.enhance.mockResolvedValue({ status: 'error', error: 'Original unchanged.' });
  await expect(enhanceAudioText('voice', 'Warm voice')).rejects.toMatchObject({ enhancementFinished: true });
  expect(mock.enhance).toHaveBeenCalledTimes(1);
});
it('carries editing feedback separately from the draft through every recovery check', async () => {
  vi.useFakeTimers();
  const feedback = 'Change the accent to Scottish and make it brighter.';
  const prompt = audioEnhancePrompt('voice', 'A soft Southern voice.', feedback);
  expect(JSON.parse(prompt.user)).toEqual({ task: 'voice', original: 'A soft Southern voice.', feedback });
  expect(prompt.system).toContain('unless the feedback explicitly changes them');
  expect(audioEnhancePrompt('direction', '', 'Quiet and conversational.').user).toContain('Quiet and conversational.');
  mock.enhance.mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce({ status: 'complete', text: 'A bright Scottish voice with smooth, natural delivery.' });
  const result = enhanceAudioText('voice', 'A soft Southern voice.', undefined, 'feedback-one', feedback);
  await vi.advanceTimersByTimeAsync(2000);
  await result;
  expect(mock.enhance.mock.calls).toEqual(Array(2).fill([{ requestId: 'feedback-one', kind: 'voice', text: 'A soft Southern voice.', feedback }]));
});
