import { describe, expect, it } from 'vitest';
import { compactCodexCliError } from '@/lib/llm/codex-cli-error';
import { cliChatErrorMessage } from '@/lib/llm/cli-chat-error';

describe('compactCodexCliError', () => {
  it('unwraps the screenshot error into a useful model-selection message', () => {
    const payload = JSON.stringify({ type: 'error', status: 400, error: {
      type: 'invalid_request_error', message: "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
    } });
    const wrapped = new Error(`Error invoking remote method 'llm:codex-chat': Error: ${payload}`);
    expect(cliChatErrorMessage(wrapped)).toBe('That model is unavailable with your ChatGPT account. Choose Codex default and try again.');
    expect(compactCodexCliError(payload, 1)).not.toContain('invalid_request_error');
  });
  it('keeps the ChatGPT usage-limit line and drops MCP/cache noise', () => {
    const stderr = [
      'Reading additional input from stdin...',
      '2026-08-20T01:16:49.633584Z ERROR codex_models_manager::cache: failed to load models cache: missing field `base_instructions` at line 94 column 5',
      '2026-08-20T01:16:50.830777Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\\"OAuth\\"" })',
      'You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 20th, 2026 9:48 AM.',
    ].join('\n');
    expect(compactCodexCliError(stderr, 1)).toMatch(/usage limit/i);
    expect(compactCodexCliError(stderr, 1)).toMatch(/ChatGPT Codex quota/i);
    expect(compactCodexCliError(stderr, 1)).not.toMatch(/rmcp::transport/);
    expect(compactCodexCliError(stderr, 1)).not.toMatch(/base_instructions/);
  });
});
