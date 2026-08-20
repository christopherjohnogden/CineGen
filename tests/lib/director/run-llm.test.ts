import { describe, expect, it, vi } from 'vitest';
import { DIRECTOR_CLI_TIMEOUT_MS, directorCliJobPrompt, runDirectorJsonJob } from '@/lib/director/run-llm';
import { directorShotlistParallel, parseDirectorLlmProvider, pickInstalledDirectorLlm } from '@/lib/director/cli-provider';
import { invokeCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import { getOpenAiApiKey } from '@/lib/utils/api-key';

vi.mock('@/lib/llm/cli-copilot-client', () => ({
  invokeCliCopilotChat: vi.fn(async () => ({ message: '{"ok":true}' })),
  cancelCliCopilotChat: vi.fn(async () => undefined),
}));

vi.mock('@/lib/utils/api-key', () => ({
  getApiKey: vi.fn(() => undefined),
  getOpenAiApiKey: vi.fn(() => 'sk-test'),
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

  it('accepts hosted providers only when ready, and offers them as fallbacks', () => {
    expect(parseDirectorLlmProvider('luna')).toBe('luna');
    expect(parseDirectorLlmProvider('openai')).toBe('openai');
    expect(pickInstalledDirectorLlm('luna', [
      { id: 'claude-code', installed: false },
      { id: 'codex', installed: true },
    ])).toBe('luna');
    expect(pickInstalledDirectorLlm('luna', [
      { id: 'claude-code', installed: true },
      { id: 'codex', installed: false },
    ])).toBe('claude-code');
    expect(parseDirectorLlmProvider('higgsfield')).toBe('higgsfield');
    expect(parseDirectorLlmProvider('fal')).toBe('fal');
    // A ready hosted preference sticks.
    expect(pickInstalledDirectorLlm('fal', [
      { id: 'claude-code', installed: true },
    ], { falReady: true })).toBe('fal');
    expect(pickInstalledDirectorLlm('openai', [
      { id: 'claude-code', installed: true },
    ], { openaiReady: true })).toBe('openai');
    expect(pickInstalledDirectorLlm('higgsfield', [
      { id: 'claude-code', installed: true },
    ], { higgsfieldReady: true })).toBe('higgsfield');
    // A hosted preference that is not ready falls back to the first installed CLI.
    expect(pickInstalledDirectorLlm('fal', [
      { id: 'gemini', installed: true },
    ], {})).toBe('gemini');
    expect(pickInstalledDirectorLlm('openai', [
      { id: 'gemini', installed: true },
    ], {})).toBe('gemini');
    // Nothing installed → whichever hosted provider is ready, fal first, then OpenAI.
    expect(pickInstalledDirectorLlm('claude-code', [
      { id: 'claude-code', installed: false },
    ], { falReady: true })).toBe('fal');
    expect(pickInstalledDirectorLlm('claude-code', [
      { id: 'claude-code', installed: false },
    ], { openaiReady: true })).toBe('openai');
    expect(pickInstalledDirectorLlm('claude-code', [
      { id: 'claude-code', installed: false },
    ], { higgsfieldReady: true })).toBe('higgsfield');
    expect(directorShotlistParallel('fal')).toBe(true);
    expect(directorShotlistParallel('openai')).toBe(true);
    expect(directorShotlistParallel('luna')).toBe(false);
    expect(directorShotlistParallel('claude-code')).toBe(false);
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
        purpose: 'json-job',
      }),
    );
    const params = vi.mocked(invokeCliCopilotChat).mock.calls[0][1];
    expect(params.systemPrompt).toContain('sys');
    expect(params.userMessage).toBe('user');
    expect(params.userMessage).not.toContain('sys');
  });

  it('runs Luna jobs on Codex CLI with gpt-5.6-luna', async () => {
    vi.mocked(invokeCliCopilotChat).mockClear();
    await expect(runDirectorJsonJob('sys', 'user', 'luna')).resolves.toEqual({ ok: true });
    expect(vi.mocked(invokeCliCopilotChat)).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({
        model: 'gpt-5.6-luna',
        purpose: 'json-job',
        injectProjectContext: false,
      }),
    );
  });

  it('runs OpenAI Luna jobs through Chat Completions, not Codex', async () => {
    const openaiChat = vi.fn(async () => ({
      message: '{"ok":true}',
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.0008,
      },
    }));
    const previous = (window as Window & { electronAPI?: unknown }).electronAPI;
    (window as Window & { electronAPI?: unknown }).electronAPI = { llm: { openaiChat } };
    vi.mocked(invokeCliCopilotChat).mockClear();
    vi.mocked(getOpenAiApiKey).mockReturnValue('sk-test');
    const spent: number[] = [];
    try {
      await expect(runDirectorJsonJob('sys', 'user', 'openai', 'rid', undefined, {
        onUsage: (usage) => spent.push(usage.cost),
      })).resolves.toEqual({ ok: true });
      expect(vi.mocked(invokeCliCopilotChat)).not.toHaveBeenCalled();
      expect(openaiChat).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'sk-test',
        model: 'gpt-5.6-luna',
        systemPrompt: expect.stringContaining('sys'),
        userMessage: 'user',
      }));
      expect(spent[0]).toBeGreaterThan(0);
    } finally {
      (window as Window & { electronAPI?: unknown }).electronAPI = previous;
    }
  });

  it('passes mood-board stills to OpenAI and CLI look-bible jobs', async () => {
    const still = 'local-media://file/tmp/kitchen.jpg';
    vi.mocked(invokeCliCopilotChat).mockClear();
    await expect(runDirectorJsonJob('sys', 'user', 'claude-code', 'rid', undefined, {
      imageUrls: [still],
    })).resolves.toEqual({ ok: true });
    expect(vi.mocked(invokeCliCopilotChat)).toHaveBeenCalledWith(
      'claude-code',
      expect.objectContaining({
        userMessage: expect.stringContaining('@/tmp/kitchen.jpg'),
        visualRefs: [expect.objectContaining({ fileRef: '/tmp/kitchen.jpg', mediaType: 'image' })],
      }),
    );

    vi.mocked(invokeCliCopilotChat).mockClear();
    await expect(runDirectorJsonJob('sys', 'user', 'gemini', 'rid', undefined, {
      imageUrls: [still],
    })).resolves.toEqual({ ok: true });
    const gemini = vi.mocked(invokeCliCopilotChat).mock.calls[0][1];
    expect(gemini.userMessage).toBe('user');
    expect(gemini.visualRefs?.[0].fileRef).toBe('/tmp/kitchen.jpg');

    const openaiChat = vi.fn(async () => ({ message: '{"ok":true}' }));
    const previous = (window as Window & { electronAPI?: unknown }).electronAPI;
    (window as Window & { electronAPI?: unknown }).electronAPI = { llm: { openaiChat } };
    try {
      await expect(runDirectorJsonJob('sys', 'user', 'openai', 'rid', undefined, {
        imageUrls: ['https://example.test/still.jpg'],
      })).resolves.toEqual({ ok: true });
      expect(openaiChat).toHaveBeenCalledWith(expect.objectContaining({
        imageUrls: ['https://example.test/still.jpg'],
      }));
    } finally {
      (window as Window & { electronAPI?: unknown }).electronAPI = previous;
    }
  });

  it('uses Haiku for fast Claude Code jobs instead of duplicating the system prompt', async () => {
    vi.mocked(invokeCliCopilotChat).mockClear();
    await expect(runDirectorJsonJob('sys', 'user', 'claude-code', 'rid', undefined, { fast: true })).resolves.toEqual({ ok: true });
    expect(vi.mocked(invokeCliCopilotChat)).toHaveBeenCalledWith(
      'claude-code',
      expect.objectContaining({
        model: 'haiku',
        purpose: 'json-job',
        injectProjectContext: false,
      }),
    );
  });

  it('reuses a CLI session across Director job rounds', async () => {
    vi.mocked(invokeCliCopilotChat).mockClear();
    vi.mocked(invokeCliCopilotChat).mockResolvedValueOnce({
      message: '{"ok":true}',
      sessionId: 'sess-1',
    });
    const sessions: string[] = [];
    await expect(runDirectorJsonJob('sys', 'user', 'claude-code', 'rid', undefined, {
      resumeSessionId: 'sess-1',
      onSession: (id) => sessions.push(id),
    })).resolves.toEqual({ ok: true });
    expect(vi.mocked(invokeCliCopilotChat)).toHaveBeenCalledWith(
      'claude-code',
      expect.objectContaining({
        purpose: 'json-job',
        resumeSessionId: 'sess-1',
      }),
    );
    expect(sessions).toEqual(['sess-1']);
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
