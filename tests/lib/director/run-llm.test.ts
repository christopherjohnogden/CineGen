import { describe, expect, it, vi } from 'vitest';
import { DIRECTOR_CLI_TIMEOUT_MS, directorCliJobPrompt, runDirectorJsonJob } from '@/lib/director/run-llm';
import { parseDirectorLlmProvider, pickInstalledDirectorLlm } from '@/lib/director/cli-provider';
import { invokeCliCopilotChat } from '@/lib/llm/cli-copilot-client';

vi.mock('@/lib/llm/cli-copilot-client', () => ({
  invokeCliCopilotChat: vi.fn(async () => ({ message: '{"ok":true}' })),
  cancelCliCopilotChat: vi.fn(async () => undefined),
}));

describe('director CLI picker', () => {
  it('keeps an installed pick and otherwise takes the first installed CLI', () => {
    expect(parseDirectorLlmProvider('gemini')).toBe('gemini');
    expect(parseDirectorLlmProvider('nope')).toBe('claude-code');
    expect(pickInstalledDirectorLlm('codex', [
      { id: 'claude-code', installed: false },
      { id: 'codex', installed: false },
      { id: 'gemini', installed: true },
    ])).toBe('gemini');
    expect(pickInstalledDirectorLlm('codex', [
      { id: 'claude-code', installed: true },
      { id: 'codex', installed: true },
    ])).toBe('codex');
  });

  it('asks the CLI for JSON only', () => {
    const prompt = directorCliJobPrompt('Break the script.', 'SCRIPT:\nINT. KITCHEN');
    expect(prompt.systemPrompt).toContain('Break the script.');
    expect(prompt.systemPrompt).toMatch(/ONLY a JSON object/i);
    expect(prompt.userMessage).toContain('INT. KITCHEN');
  });

  it('runs Director jobs through the selected CLI without Copilot project-context mode', async () => {
    await expect(runDirectorJsonJob('sys', 'user', 'gemini')).resolves.toEqual({ ok: true });
    expect(vi.mocked(invokeCliCopilotChat)).toHaveBeenCalledWith(
      'gemini',
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        injectProjectContext: false,
      }),
    );
    const params = vi.mocked(invokeCliCopilotChat).mock.calls[0][1];
    expect(params.userMessage).toContain('sys');
    expect(params.userMessage).toContain('user');
  });

  it('times out a hung CLI instead of spinning forever', async () => {
    vi.mocked(invokeCliCopilotChat).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const pending = runDirectorJsonJob('sys', 'user', 'claude-code');
      const expectation = expect(pending).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(DIRECTOR_CLI_TIMEOUT_MS);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
