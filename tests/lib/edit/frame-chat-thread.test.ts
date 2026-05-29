import { describe, expect, it } from 'vitest';
import { detectFrameChatIntent } from '../../../src/lib/edit/frame-chat-thread';

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
