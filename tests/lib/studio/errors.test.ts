import { describe, expect, it } from 'vitest';
import { classifyFeedError, cleanIpcError } from '@/lib/studio/errors';

describe('feed errors', () => {
  it("strips Electron's IPC wrapper so the user sees the real message", () => {
    expect(cleanIpcError(
      "Error invoking remote method 'topview:submit': Error: Connect your Topview account in Settings before generating.",
    )).toBe('Connect your Topview account in Settings before generating.');
    // Already clean messages pass through untouched.
    expect(cleanIpcError('Topview could not complete this video.')).toBe('Topview could not complete this video.');
  });

  it('classifies a missing connection as auth, which needs Settings rather than a retry', () => {
    const auth = classifyFeedError(
      "Error invoking remote method 'topview:submit': Error: Connect your Topview account in Settings before generating.",
    );
    expect(auth.kind).toBe('auth');
    expect(auth.message).not.toMatch(/invoking remote method/);

    expect(classifyFeedError('Your Topview connection expired. Connect it again in Settings.').kind).toBe('auth');
    expect(classifyFeedError('Topview could not complete this video.').kind).toBe('other');
    expect(classifyFeedError(undefined)).toEqual({ kind: 'other', message: 'Generation failed.' });
  });
});
