import { describe, expect, it } from 'vitest';
import { detectFrameChatIntent } from '../../../src/lib/edit/frame-chat-thread';
import { frameChatStorageKey, serializeThread, deserializeThread, type FrameChatMessage } from '../../../src/lib/edit/frame-chat-thread';

describe('detectFrameChatIntent', () => {
  it('routes change-verb prompts to generate', () => {
    expect(detectFrameChatIntent('make this car red')).toBe('generate');
    expect(detectFrameChatIntent('remove the logo from the shirt')).toBe('generate');
    expect(detectFrameChatIntent('clean plate of this shot')).toBe('generate');
    expect(detectFrameChatIntent('extend this 3 more seconds')).toBe('generate');
    expect(detectFrameChatIntent('stylize this as anime')).toBe('generate');
  });

  it('routes questions to ask', () => {
    expect(detectFrameChatIntent('what is happening in this shot?')).toBe('ask');
    expect(detectFrameChatIntent('how long is my current cut')).toBe('ask');
    expect(detectFrameChatIntent('is this frame too dark')).toBe('ask');
    expect(detectFrameChatIntent('who is in this scene?')).toBe('ask');
  });

  it('defaults ambiguous prompts to ask (no credits spent)', () => {
    expect(detectFrameChatIntent('the car')).toBe('ask');
    expect(detectFrameChatIntent('hmm')).toBe('ask');
    expect(detectFrameChatIntent('')).toBe('ask');
  });
});

describe('frame-chat thread persistence', () => {
  const msgs: FrameChatMessage[] = [
    { id: 'a', role: 'user', content: 'make the car red', createdAt: '2026-05-29T00:00:00.000Z', intent: 'generate' },
    { id: 'b', role: 'assistant', content: 'I can generate that.', createdAt: '2026-05-29T00:00:01.000Z' },
  ];

  it('builds a per-project storage key', () => {
    expect(frameChatStorageKey('proj-123')).toBe('cinegen_frame_chat:proj-123');
  });

  it('round-trips messages through serialize/deserialize', () => {
    expect(deserializeThread(serializeThread(msgs))).toEqual(msgs);
  });

  it('deserializes invalid JSON to an empty thread', () => {
    expect(deserializeThread('not json')).toEqual([]);
    expect(deserializeThread(null)).toEqual([]);
  });
});
