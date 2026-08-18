import assert from 'node:assert/strict';
import test from 'node:test';
import { createLlmHandlers } from './llm.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('hosted chat keeps fal credentials request-scoped and normalizes usage', async () => {
  const calls = [];
  const fetchImpl = async (urlValue, init = {}) => {
    const url = String(urlValue);
    const authorization = init.headers.Authorization;
    calls.push({ url, init, authorization });
    const keyName = authorization === 'Key alpha-secret' ? 'alpha' : 'beta';
    if (init.method === 'POST') return jsonResponse({ request_id: `${keyName}-job` });
    if (url.includes('/status?')) return jsonResponse({ status: 'COMPLETED' });
    return jsonResponse({
      output: ` ${keyName} response `,
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
        cost: 0.004,
      },
    });
  };
  const handlers = createLlmHandlers({
    fetchImpl,
    falPollIntervalMs: 0,
    falMaxPollAttempts: 2,
  });

  const [alpha, beta] = await Promise.all([
    handlers.chat({
      apiKey: 'alpha-secret',
      model: 'openai/gpt-4.1',
      systemPrompt: 'Be concise.',
      messages: [
        { role: 'system', content: 'This message is intentionally excluded from the conversation prompt.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Draft a logline' },
      ],
      maxTokens: 900,
      temperature: 0.4,
    }),
    handlers.chat({
      apiKey: 'beta-secret',
      messages: [{ role: 'user', content: 'Second request' }],
    }),
  ]);

  assert.equal(alpha.message, 'alpha response');
  assert.deepEqual(alpha.usage, {
    promptTokens: 12,
    completionTokens: 8,
    totalTokens: 20,
    cost: 0.004,
  });
  assert.equal(beta.message, 'beta response');
  assert.equal(calls.filter((call) => call.authorization === 'Key alpha-secret').length, 3);
  assert.equal(calls.filter((call) => call.authorization === 'Key beta-secret').length, 3);

  const alphaSubmit = calls.find((call) => (
    call.authorization === 'Key alpha-secret' && call.init.method === 'POST'
  ));
  assert.ok(alphaSubmit);
  const input = JSON.parse(alphaSubmit.init.body);
  assert.equal(input.model, 'openai/gpt-4.1');
  assert.equal(input.system_prompt, 'Be concise.');
  assert.equal(input.max_tokens, 900);
  assert.equal(input.temperature, 0.4);
  assert.equal(
    input.prompt,
    'User:\nHello\n\nAssistant:\nHi\n\nUser:\nDraft a logline\n\nAssistant:\n',
  );
});

test('hosted chat rejects malformed conversations and models before fetch', async () => {
  const handlers = createLlmHandlers({
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  });

  await assert.rejects(
    handlers.chat({
      apiKey: 'key',
      messages: [{ role: 'system', content: 'Only a system prompt' }],
    }),
    (error) => error.code === 'INVALID_INPUT' && /No chat prompt/.test(error.message),
  );
  await assert.rejects(
    handlers.chat({
      apiKey: 'key',
      model: 'https://evil.example/model',
      messages: [{ role: 'user', content: 'Hello' }],
    }),
    (error) => error.code === 'INVALID_MODEL',
  );
  await assert.rejects(
    handlers.chat({
      apiKey: 'key',
      maxTokens: 200_000,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
    (error) => error.code === 'INVALID_INPUT',
  );
});

test('desktop-only LLM methods expose safe capability responses', async () => {
  const handlers = createLlmHandlers({
    falSubscribe: async () => { throw new Error('fal should not run'); },
  });

  assert.deepEqual(await handlers.localModels(), []);
  assert.deepEqual(await handlers.claudeCodeDetect(), { installed: false });
  assert.deepEqual(await handlers.cliDetect(), {
    providers: [
      { id: 'claude-code', installed: false },
      { id: 'codex', installed: false },
      { id: 'gemini', installed: false },
    ],
  });
  await assert.rejects(
    handlers.localChat({}),
    (error) => error.code === 'WEB_CAPABILITY_UNAVAILABLE',
  );
  await assert.rejects(
    handlers.runCutWorkflow({}),
    (error) => error.code === 'WEB_CAPABILITY_UNAVAILABLE',
  );
  await assert.rejects(
    handlers.geminiChat({}),
    (error) => error.code === 'WEB_CAPABILITY_UNAVAILABLE',
  );
  assert.equal(await handlers.codexCancel('request-1'), undefined);
});
