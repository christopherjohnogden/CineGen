import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalLlmHandlers,
  createLocalLlmService,
  localLlmCapabilities,
} from './llm-local.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function eventCollector() {
  const values = [];
  return {
    values,
    events: { emit: (event, payload) => values.push({ event, payload }) },
  };
}

function installedDetector(provider) {
  return {
    installed: true,
    path: `/configured/bin/${provider}`,
    version: `${provider} 1.2.3`,
  };
}

test('Ollama chat uses only the configured server URL and preserves local stream shape', async () => {
  const calls = [];
  const emitted = eventCollector();
  const handlers = createLocalLlmHandlers({
    events: emitted.events,
    ollamaUrl: 'http://10.0.0.5:11434/base/',
    fetchImpl: async (urlValue, init = {}) => {
      const url = String(urlValue);
      calls.push({ url, init });
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            { name: 'qwen3.5:latest' },
            { name: 'qwen3.5:latest' },
            { name: 'team/model-v2:8b' },
            { name: 'bad model' },
          ],
        });
      }
      return streamResponse([
        '{"message":{"content":"<think>private reasoning"}}\n{"message":',
        '{"content":" stays private</think>Hel"}}\n',
        '{"message":{"content":"lo"}}\n',
        '{"done":true,"prompt_eval_count":12,"eval_count":4}\n',
      ]);
    },
  });

  const result = await handlers.localChat({
    requestId: 'local-request-1',
    model: 'qwen3.5:latest',
    systemPrompt: 'Answer concisely.',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 300,
    temperature: 0.4,
    // RPC input cannot override this server-side network target.
    ollamaUrl: 'http://attacker.invalid:9999',
  });

  assert.deepEqual(result, {
    message: 'Hello',
    usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16, cost: 0 },
  });
  assert.equal(calls[0].url, 'http://10.0.0.5:11434/base/api/chat');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'qwen3.5:latest');
  assert.equal(body.think, false);
  assert.deepEqual(body.options, { temperature: 0.4, num_predict: 300 });
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Answer concisely.' },
    { role: 'user', content: 'Hello' },
  ]);
  const streamEvents = emitted.values.filter((entry) => entry.event === 'llm:local-stream');
  assert.equal(streamEvents.filter((entry) => entry.payload.token).map((entry) => entry.payload.token).join(''), 'Hello');
  assert.equal(streamEvents.some((entry) => JSON.stringify(entry).includes('private reasoning')), false);
  assert.deepEqual(streamEvents.at(-1)?.payload, { requestId: 'local-request-1', done: true });

  assert.deepEqual(await handlers.localModels(), ['qwen3.5:latest', 'team/model-v2:8b']);
  assert.equal(calls[1].url, 'http://10.0.0.5:11434/base/api/tags');
});

test('Ollama validation and timeout are bounded and emit completion', async () => {
  let fetchCalls = 0;
  const emitted = eventCollector();
  const handlers = createLocalLlmHandlers({
    events: emitted.events,
    ollamaTimeoutMs: 10,
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });

  await assert.rejects(
    handlers.localChat({
      requestId: 'timeout-request',
      messages: [{ role: 'user', content: 'Wait forever' }],
    }),
    (error) => error.code === 'PROVIDER_TIMEOUT',
  );
  assert.equal(fetchCalls, 1);
  assert.deepEqual(emitted.values.at(-1), {
    event: 'llm:local-stream',
    payload: { requestId: 'timeout-request', done: true },
  });

  await assert.rejects(
    handlers.localChat({
      requestId: 'bad/id',
      messages: [{ role: 'user', content: 'No fetch' }],
    }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    handlers.localChat({
      requestId: 'safe-id',
      model: 'qwen; touch /tmp/nope',
      messages: [{ role: 'user', content: 'No fetch' }],
    }),
    (error) => error.code === 'INVALID_INPUT',
  );
  assert.equal(fetchCalls, 1);
});

test('CLI detection is injectable and degrades failures to installed=false', async () => {
  const handlers = createLocalLlmHandlers({
    fetchImpl: async () => { throw new Error('Ollama should not run'); },
    detector: async (provider) => {
      if (provider === 'gemini') throw new Error('broken detector');
      return installedDetector(provider);
    },
  });

  assert.deepEqual(await handlers.claudeCodeDetect(), {
    installed: true,
    path: '/configured/bin/claude-code',
    version: 'claude-code 1.2.3',
  });
  assert.deepEqual(await handlers.cliDetect(), {
    providers: [
      {
        id: 'claude-code',
        installed: true,
        path: '/configured/bin/claude-code',
        version: 'claude-code 1.2.3',
      },
      {
        id: 'codex',
        installed: true,
        path: '/configured/bin/codex',
        version: 'codex 1.2.3',
      },
      { id: 'gemini', installed: false },
    ],
  });
});

test('Claude, Codex, and Gemini use fixed argv and renderer-compatible SSE streams', async () => {
  const specs = [];
  const emitted = eventCollector();
  const handlers = createLocalLlmHandlers({
    events: emitted.events,
    fetchImpl: async () => { throw new Error('Ollama should not run'); },
    detector: async (provider) => installedDetector(provider),
    geminiStdinThreshold: 10,
    async processRunner(spec, io) {
      specs.push(spec);
      if (spec.provider === 'claude-code') {
        io.onStdout('{"type":"system","subtype":"init","session_id":"claude_session"}\n');
        io.onStdout('{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hello "}}}\n');
        io.onStdout('{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Claude"}}}\n');
        io.onStdout('{"type":"result","result":"Hello Claude","usage":{"input_tokens":10,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":5},"total_cost_usd":0.02}\n');
      } else if (spec.provider === 'codex') {
        io.onStdout('{"type":"thread.started","thread_id":"codex_session"}\n');
        io.onStdout('{"type":"item.updated","item":{"type":"agent_message","text":"Hello"}}\n');
        io.onStdout('{"type":"item.completed","item":{"type":"agent_message","text":"Hello Codex"}}\n');
        io.onStdout('{"type":"turn.completed","usage":{"input_tokens":7,"cached_input_tokens":2,"output_tokens":3}}\n');
      } else {
        io.onStdout('{"type":"init","session_id":"gemini_session"}\n');
        io.onStdout('{"type":"tool_use","tool_name":"read_file"}\n');
        io.onStdout('{"type":"message","role":"assistant","content":"Hello "}\n');
        io.onStdout('{"type":"message","role":"assistant","content":"Gemini"}\n');
        io.onStdout('{"type":"result","stats":{"input_tokens":6,"output_tokens":2,"total_tokens":8}}\n');
      }
      return { code: 0, signal: null };
    },
  });

  const claude = await handlers.claudeCodeChat({
    requestId: 'claude-request',
    model: 'sonnet',
    userMessage: 'Hello Claude',
  });
  const codex = await handlers.codexChat({
    requestId: 'codex-request',
    model: 'gpt-5.3-codex',
    userMessage: 'Hello Codex',
  });
  const gemini = await handlers.geminiChat({
    requestId: 'gemini-request',
    model: 'google/gemini-2.5-flash',
    userMessage: 'Hello Gemini with a sufficiently long prompt',
  });

  assert.deepEqual(claude, {
    message: 'Hello Claude',
    sessionId: 'claude_session',
    resumed: false,
    usage: { promptTokens: 15, completionTokens: 5, totalTokens: 20, cost: 0.02 },
  });
  assert.deepEqual(codex, {
    message: 'Hello Codex',
    sessionId: 'codex_session',
    resumed: false,
    usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12, cost: 0 },
  });
  assert.deepEqual(gemini, {
    message: 'Hello Gemini',
    sessionId: 'gemini_session',
    resumed: false,
    usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8, cost: 0 },
  });

  for (const spec of specs) {
    assert.equal(spec.shell, false);
    assert.equal(Array.isArray(spec.args), true);
    assert.equal(spec.command, `/configured/bin/${spec.provider}`);
  }
  const claudeSpec = specs.find((spec) => spec.provider === 'claude-code');
  assert.equal(claudeSpec.args[claudeSpec.args.indexOf('--tools') + 1], '');
  assert.equal(claudeSpec.args[claudeSpec.args.indexOf('--permission-mode') + 1], 'dontAsk');
  const codexSpec = specs.find((spec) => spec.provider === 'codex');
  assert.deepEqual(codexSpec.args.slice(codexSpec.args.indexOf('-s'), codexSpec.args.indexOf('-s') + 2), ['-s', 'read-only']);
  const geminiSpec = specs.find((spec) => spec.provider === 'gemini');
  assert.equal(geminiSpec.args[geminiSpec.args.indexOf('-m') + 1], 'gemini-2.5-flash');
  assert.equal(geminiSpec.args[geminiSpec.args.indexOf('-p') + 1], '');
  assert.match(geminiSpec.stdin, /Hello Gemini/);

  for (const [event, requestId] of [
    ['llm:claude-code-stream', 'claude-request'],
    ['llm:codex-stream', 'codex-request'],
    ['llm:gemini-stream', 'gemini-request'],
  ]) {
    const providerEvents = emitted.values.filter((entry) => entry.event === event);
    assert.equal(providerEvents.some((entry) => entry.payload.token), true);
    assert.deepEqual(providerEvents.at(-1)?.payload, { requestId, done: true });
  }
  assert.equal(emitted.values.some((entry) => entry.payload.status === 'Gemini CLI: read file…'), true);
});

test('CLI cancellation aborts only the matching request and emits done', async () => {
  const emitted = eventCollector();
  let observedAbort = false;
  let runnerStarted = false;
  const service = createLocalLlmService({
    events: emitted.events,
    fetchImpl: async () => { throw new Error('Ollama should not run'); },
    detector: async (provider) => installedDetector(provider),
    processRunner: async (spec) => new Promise((resolve) => {
      runnerStarted = true;
      spec.signal.addEventListener('abort', () => {
        observedAbort = true;
        resolve({ code: null, signal: 'SIGTERM' });
      }, { once: true });
    }),
  });
  const pending = service.handlers.codexChat({
    requestId: 'cancel-request',
    userMessage: 'Keep working',
  });
  while (!runnerStarted) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(await service.handlers.claudeCodeCancel('cancel-request'), undefined);
  assert.equal(service.context.activeRequestCount(), 1);
  assert.equal(await service.handlers.codexCancel('cancel-request'), undefined);
  await assert.rejects(pending, (error) => error.code === 'REQUEST_CANCELLED');
  assert.equal(observedAbort, true);
  assert.equal(service.context.activeRequestCount(), 0);
  assert.deepEqual(emitted.values.at(-1), {
    event: 'llm:codex-stream',
    payload: { requestId: 'cancel-request', done: true },
  });
});

test('CLI output caps and unsupported capabilities fail without running arbitrary commands', async () => {
  let processCalls = 0;
  const handlers = createLocalLlmHandlers({
    fetchImpl: async () => { throw new Error('Ollama should not run'); },
    detector: async (provider) => provider === 'gemini' ? false : installedDetector(provider),
    maxOutputBytes: 64,
    maxStderrBytes: 32,
    async processRunner(_spec, io) {
      processCalls += 1;
      io.onStdout(Buffer.alloc(128, 65));
      return { code: 0, signal: null };
    },
  });

  await assert.rejects(
    handlers.claudeCodeChat({
      requestId: 'output-limit',
      userMessage: 'Return too much',
    }),
    (error) => error.code === 'OUTPUT_LIMIT',
  );
  assert.equal(processCalls, 1);

  await assert.rejects(
    handlers.geminiChat({
      requestId: 'gemini-absent',
      userMessage: 'Hello',
    }),
    (error) => error.code === 'CLI_NOT_INSTALLED',
  );
  await assert.rejects(
    handlers.codexChat({
      requestId: 'unsafe-request',
      model: 'gpt;rm -rf',
      userMessage: 'No process',
    }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    handlers.codexChat({
      requestId: 'visual-request',
      userMessage: 'Describe this',
      visualRefs: [{ fileRef: '/etc/passwd' }],
    }),
    (error) => error.code === 'WEB_CLI_VISUAL_UNAVAILABLE',
  );
  assert.equal(processCalls, 1);
  assert.equal(localLlmCapabilities.runCutWorkflow, false);
  assert.equal(localLlmCapabilities.shellInterpolation, false);
});

test('Director JSON jobs are an allowed CLI purpose and skip Claude project discovery', async () => {
  const specs = [];
  const handlers = createLocalLlmHandlers({
    events: eventCollector().events,
    fetchImpl: async () => { throw new Error('Ollama should not run'); },
    detector: async (provider) => installedDetector(provider),
    async processRunner(spec, io) {
      specs.push(spec);
      io.onStdout('{"type":"system","subtype":"init","session_id":"json_session"}\n');
      io.onStdout('{"type":"result","result":"{\\"ok\\":true}"}\n');
      return { code: 0, signal: null };
    },
  });

  await assert.rejects(
    handlers.claudeCodeChat({
      requestId: 'bad-purpose',
      userMessage: 'Hello',
      purpose: 'pwn',
    }),
    (error) => error.code === 'INVALID_INPUT' && /purpose is invalid/i.test(error.message),
  );

  const result = await handlers.claudeCodeChat({
    requestId: 'json-job-request',
    model: 'haiku',
    purpose: 'json-job',
    injectProjectContext: false,
    systemPrompt: 'Return ONLY JSON.',
    userMessage: 'Cover this scene.',
  });
  assert.equal(result.message, '{"ok":true}');
  assert.equal(specs.length, 1);
  assert.equal(specs[0].args.includes('--safe-mode'), true);
  assert.equal(specs[0].args.includes('--effort'), true);
  assert.equal(specs[0].args.includes('--no-session-persistence'), false);
  assert.equal(specs[0].args.includes('--include-partial-messages'), true);
  const systemIdx = specs[0].args.indexOf('--system-prompt');
  assert.ok(systemIdx >= 0);
  assert.equal(specs[0].args[systemIdx + 1], 'Return ONLY JSON.');
  assert.equal(specs[0].args.includes('Cover this scene.'), true);
});

test('Director JSON jobs skip Codex user config and send the prompt on stdin', async () => {
  const specs = [];
  const handlers = createLocalLlmHandlers({
    events: eventCollector().events,
    fetchImpl: async () => { throw new Error('Ollama should not run'); },
    detector: async (provider) => installedDetector(provider),
    async processRunner(spec, io) {
      specs.push(spec);
      io.onStdout('{"type":"thread.started","thread_id":"codex_json"}\n');
      io.onStdout('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}\n');
      return { code: 0, signal: null };
    },
  });

  const result = await handlers.codexChat({
    requestId: 'codex-json-job',
    model: 'gpt-5.6-luna',
    purpose: 'json-job',
    injectProjectContext: false,
    systemPrompt: 'Return ONLY JSON.',
    userMessage: 'Cover this scene.',
  });
  assert.equal(result.message, '{"ok":true}');
  assert.equal(specs.length, 1);
  assert.equal(specs[0].args.includes('--ignore-user-config'), true);
  assert.equal(specs[0].args.includes('--ignore-rules'), true);
  assert.equal(specs[0].args.includes('Cover this scene.'), false);
  assert.match(specs[0].stdin, /Return ONLY JSON/);
  assert.match(specs[0].stdin, /Cover this scene/);
});
