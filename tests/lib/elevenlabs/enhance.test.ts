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
