import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCineGenWebServer } from '../index.mjs';
import {
  buildTopviewImageRequest,
  buildTopviewVideoRequest,
  normalizeTopviewToolRequest,
  createTopviewService,
  parseTopviewMcpResult,
  sanitizeTopviewPrompt,
  topviewVideoReferences,
} from './topview.mjs';

test('conforms outgoing arguments to the connected MCP tool schema', () => {
  const inputSchema = {
    type: 'object',
    properties: {
      req: {
        type: 'object',
        properties: {
          taskType: { type: 'string' },
          duration: { type: 'integer' },
        },
        additionalProperties: false,
      },
    },
  };
  assert.deepEqual(normalizeTopviewToolRequest(inputSchema, {
    taskType: 'omni_reference', duration: '20', sound: 'on',
  }), { taskType: 'omni_reference', duration: 20 });
});

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function callbackResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) { this.body = body; },
  };
}

function wrappedTool(name, properties = {}) {
  return {
    name,
    inputSchema: {
      type: 'object',
      properties: {
        req: { type: 'object', properties },
      },
    },
  };
}

const LIVE_CONFIG = {
  modelSelectionPolicy: { preferredSubmitModel: 'seedance-2-5-live' },
  models: [{
    submitModel: 'seedance-2-5-live',
    displayName: 'Seedance 2.5',
    requiredSubmitFields: ['model', 'prompt', 'duration', 'resolution', 'aspectRatio'],
    defaultSubmitParameters: { sound: 'off' },
    submitParameterOptions: {
      duration: Array.from({ length: 27 }, (_, index) => index + 4),
      resolution: [720, 1080],
      aspectRatio: ['9:16', '16:9'],
      sound: ['off', 'on'],
    },
  }],
};

const LIVE_IMAGE_CONFIG = {
  modelSelectionPolicy: { preferredSubmitModel: 'gpt-image-2-live' },
  models: [{
    submitModel: 'gpt-image-2-live',
    displayName: 'GPT Image 2',
    requiredSubmitFields: ['model', 'prompt', 'aspectRatio', 'resolution'],
    defaultSubmitParameters: {},
    submitParameterOptions: {
      aspectRatio: ['1:1', '16:9'],
      resolution: ['1K', '2K', '4K'],
    },
  }],
};

test('builds Topview image edit requests from the live catalog and all supplied elements', () => {
  const built = buildTopviewImageRequest({
    config: LIVE_IMAGE_CONFIG,
    params: {
      prompt: 'Place @Peter in @Office without any labels.',
      model: 'auto',
      aspectRatio: '16:9',
      resolution: '2K',
      generateCount: 1,
    },
    fileIds: ['character-file', 'location-file'],
    boardId: 'board-default',
  });

  assert.equal(built.model, 'gpt-image-2-live');
  assert.equal(built.taskType, 'image_edit');
  assert.deepEqual(built.req.inputImageFileIds, ['character-file', 'location-file']);
  assert.equal(built.req.aspectRatio, '16:9');
  assert.equal(built.req.resolution, '2K');
  assert.doesNotMatch(built.req.prompt, /@Peter|@Office/);
  assert.match(built.req.prompt, /Do not render labels/);
});

test('builds an exact live-config Topview request and parses a completed result', () => {
  const generateTool = wrappedTool('topview_generate_video', {
    taskType: { type: 'string' },
    model: { type: 'string' },
    prompt: { type: 'string' },
    inputImages: { type: 'array' },
    duration: { type: 'number' },
    resolution: { type: 'number' },
    aspectRatio: { type: 'string' },
    sound: { type: 'string' },
  });
  const built = buildTopviewVideoRequest({
    config: LIVE_CONFIG,
    generateTool,
    taskType: 'omni_reference',
    params: {
      prompt: 'Track @Hero-One through a neon market.',
      model: 'auto',
      durationSec: 20,
      resolution: '1080p',
      aspectRatio: '16:9',
      generateAudio: true,
    },
    fileIds: ['file-a', 'file-b'],
    boardId: 'board-default',
  });

  assert.equal(built.model, 'seedance-2-5-live');
  assert.equal(built.durationSec, 20);
  assert.deepEqual(built.req.inputImages, [
    { fileId: 'file-a', name: 'Image1' },
    { fileId: 'file-b', name: 'Image2' },
  ]);
  assert.equal(built.req.taskType, 'omni_reference');
  assert.equal(built.req.duration, 20);
  assert.equal(built.req.resolution, 1080);
  assert.equal(built.req.aspectRatio, '16:9');
  assert.equal(built.req.sound, 'on');
  assert.match(built.req.prompt, /<IMAGE1>, <IMAGE2>/);
  assert.doesNotMatch(built.req.prompt, /@Hero-One/);
  assert.match(sanitizeTopviewPrompt('A clean frame'), /Do not render labels/);

  assert.deepEqual(parseTopviewMcpResult({
    structuredContent: {
      taskId: 'task-1',
      status: 'success',
      boardId: 'board-default',
      videos: [{ filePath: 'https://cdn.topview.example/result.mp4', boardTaskId: 'board-task-1' }],
    },
  }), {
    status: 'success',
    taskId: 'task-1',
    boardTaskId: 'board-task-1',
    boardId: 'board-default',
    url: 'https://cdn.topview.example/result.mp4',
  });
});

test('reads duration limits from the selected live model and rejects unsupported values without changing them', () => {
  const generateTool = wrappedTool('topview_generate_video', {
    sound: { type: 'string' },
  });
  assert.throws(() => buildTopviewVideoRequest({
    config: LIVE_CONFIG,
    generateTool,
    taskType: 'text_to_video',
    params: { prompt: 'Long shot', durationSec: 31 },
  }), (error) => error.code === 'TOPVIEW_MODEL_PARAMETERS_UNSUPPORTED');
  assert.throws(() => buildTopviewVideoRequest({
    config: LIVE_CONFIG,
    generateTool,
    taskType: 'text_to_video',
    params: { prompt: 'Shot', model: 'missing-model', durationSec: 5 },
  }), (error) => error.code === 'TOPVIEW_MODEL_UNAVAILABLE');
});

test('submits requested sound when normalized model metadata omits the optional sound field', () => {
  const generateTool = wrappedTool('topview_generate_video', {
    sound: { type: 'string' },
  });
  const model = LIVE_CONFIG.models[0];
  const built = buildTopviewVideoRequest({
    config: {
      ...LIVE_CONFIG,
      models: [{
        ...model,
        defaultSubmitParameters: {},
        submitParameterOptions: {
          duration: model.submitParameterOptions.duration,
          resolution: model.submitParameterOptions.resolution,
          aspectRatio: model.submitParameterOptions.aspectRatio,
        },
      }],
    },
    generateTool,
    taskType: 'text_to_video',
    params: { prompt: 'A dialogue scene with synchronized sound.', generateAudio: true },
    boardId: 'board-default',
  });

  assert.equal(built.req.sound, 'on');
});

test('routes a single CineGen element through omni reference, not first-frame video', () => {
  assert.deepEqual(topviewVideoReferences([
    { value: '/media/peter.png', role: 'image' },
  ]), {
    references: [{ value: '/media/peter.png', role: 'image' }],
    taskType: 'omni_reference',
  });
  assert.equal(topviewVideoReferences([
    { value: '/media/opening.png', role: 'start_image' },
  ]).taskType, 'image_to_video');
  assert.equal(topviewVideoReferences([
    { value: '/media/opening.png', role: 'start_image' },
    { value: '/media/closing.png', role: 'end_image' },
  ]).taskType, 'image_to_video');

  const framed = buildTopviewVideoRequest({
    config: {
      ...LIVE_CONFIG,
      models: [{
        ...LIVE_CONFIG.models[0],
        requiredSubmitFields: ['model', 'prompt', 'duration', 'resolution'],
      }],
    },
    generateTool: wrappedTool('topview_generate_video', {
      firstFrameFileId: { type: 'string' },
      endFrameFileId: { type: 'string' },
    }),
    taskType: 'image_to_video',
    params: { prompt: 'Move between the approved frames.' },
    references: [
      { value: '/media/opening.png', role: 'start_image' },
      { value: '/media/closing.png', role: 'end_image' },
    ],
    fileIds: ['file-open', 'file-close'],
  });
  assert.equal(framed.req.firstFrameFileId, 'file-open');
  assert.equal(framed.req.endFrameFileId, 'file-close');
});

test('completes DCR + PKCE, encrypts tokens, uploads local references, and generates through exact MCP tools', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cinegen-topview-service-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  await writeFile(path.join(dataRoot, 'one.png'), Buffer.from('reference-one'));
  await writeFile(path.join(dataRoot, 'two.png'), Buffer.from('reference-two'));

  const requests = [];
  const toolCalls = [];
  const uploadedBodies = [];
  let uploadIndex = 0;
  const allTools = [
    wrappedTool('topview_list_boards', { pageNo: { type: 'number' } }),
    wrappedTool('topview_get_credit'),
    wrappedTool('topview_get_generation_config', { type: { type: 'string' }, taskType: { type: 'string' } }),
    wrappedTool('ta_upload_credential', { format: { type: 'string' } }),
    wrappedTool('ta_upload_check_file', { fileId: { type: 'string' } }),
    wrappedTool('topview_generate_video', {
      taskType: { type: 'string' }, model: { type: 'string' }, prompt: { type: 'string' },
      inputImages: { type: 'array' }, duration: { type: 'number' }, resolution: { type: 'number' },
      aspectRatio: { type: 'string' }, sound: { type: 'string' }, boardId: { type: 'string' },
    }),
    wrappedTool('topview_query_task', { taskType: { type: 'string' }, taskId: { type: 'string' } }),
  ];

  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    requests.push({ url: href, init });
    if (href.endsWith('/mcp_oauth/oauth/register')) {
      return jsonResponse({ client_id: 'topview-client', token_endpoint_auth_method: 'none' });
    }
    if (href.endsWith('/mcp_oauth/oauth/token')) {
      return jsonResponse({
        access_token: 'topview-access-token',
        refresh_token: 'topview-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    if (href.endsWith('/mcp_oauth/oauth/userinfo')) return jsonResponse({ email: 'artist@example.com' });
    if (href.startsWith('https://uploads.example/')) {
      assert.equal(new Headers(init.headers).has('authorization'), false);
      uploadedBodies.push(Buffer.from(init.body).toString('utf8'));
      return new Response(null, { status: 200 });
    }
    if (href === 'https://mcp.topview.ai/mcp') {
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer topview-access-token');
      const message = JSON.parse(String(init.body));
      if (message.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0', id: message.id,
          result: { protocolVersion: '2025-06-18', capabilities: {} },
        }, { headers: { 'mcp-session-id': 'topview-session' } });
      }
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (message.method === 'tools/list') {
        if (!message.params.cursor) {
          return jsonResponse({
            jsonrpc: '2.0', id: message.id,
            result: { tools: allTools.slice(0, 3), nextCursor: 'page-2' },
          });
        }
        assert.equal(message.params.cursor, 'page-2');
        return jsonResponse({
          jsonrpc: '2.0', id: message.id,
          result: { tools: allTools.slice(3) },
        });
      }
      if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params;
        toolCalls.push({ name, args });
        assert.ok(args.req, `${name} should use the MCP tool's req wrapper`);
        if (name === 'topview_list_boards') {
          return jsonResponse({ jsonrpc: '2.0', id: message.id, result: {
            // Match Topview's live response shape. Prefer the established
            // CineGen board with the most tasks instead of creating another.
            structuredContent: { data: [
              { boardId: 'board-default', name: 'My First Board', isSystemDefault: true, taskCount: 20 },
              { boardId: 'board-cinegen-new', name: 'CineGen', taskCount: 1 },
              { boardId: 'board-cinegen-shared', name: 'CineGen', taskCount: 12 },
            ] },
          } });
        }
        if (name === 'topview_get_credit') {
          return jsonResponse({ jsonrpc: '2.0', id: message.id, result: {
            structuredContent: { code: '200', result: { remainCredit: 69.53 } },
          } });
        }
        if (name === 'topview_get_generation_config') {
          return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: LIVE_CONFIG } });
        }
        if (name === 'ta_upload_credential') {
          uploadIndex += 1;
          return jsonResponse({ jsonrpc: '2.0', id: message.id, result: {
            structuredContent: {
              fileId: `file-${uploadIndex}`,
              uploadUrl: `https://uploads.example/${uploadIndex}`,
              method: 'PUT',
              headers: { 'x-upload-token': `signed-${uploadIndex}`, 'content-type': 'image/png' },
            },
          } });
        }
        if (name === 'ta_upload_check_file') {
          return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { success: true } } });
        }
        if (name === 'topview_generate_video') {
          assert.equal(args.req.taskType, 'omni_reference');
          assert.equal(args.req.boardId, 'board-cinegen-shared');
          assert.equal(args.req.model, 'seedance-2-5-live');
          assert.equal(args.req.duration, 15);
          assert.equal(args.req.resolution, 1080);
          assert.equal(args.req.sound, 'on');
          assert.deepEqual(args.req.inputImages, [
            { fileId: 'file-1', name: 'Image1' },
            { fileId: 'file-2', name: 'Image2' },
          ]);
          return jsonResponse({ jsonrpc: '2.0', id: message.id, result: {
            structuredContent: { taskId: 'task-42', status: 'init' },
          } });
        }
        if (name === 'topview_query_task') {
          assert.deepEqual(args.req, {
            taskType: 'omni_reference', taskId: 'task-42', needCloudFrontUrl: true,
          });
          return jsonResponse({ jsonrpc: '2.0', id: message.id, result: {
            structuredContent: {
              status: 'success',
              boardId: 'board-cinegen-shared',
              videos: [{
                status: 'success',
                filePath: 'https://cdn.topview.example/video-42.mp4',
                boardTaskId: 'board-task-42',
              }],
            },
          } });
        }
      }
    }
    throw new Error(`Unexpected request: ${href}`);
  };

  const service = createTopviewService({
    dataRoot,
    fetchImpl,
    sleep: async () => {},
    tokenSecret: 'topview-test-only-secret',
    pathForMediaReference(reference) {
      assert.match(reference, /^\/media\/(?:one|two)\.png$/);
      return path.join(dataRoot, path.basename(reference));
    },
  });

  assert.deepEqual(await service.handlers.accountStatus(), { connected: false, configured: true });
  const started = await service.handlers.authLogin('http://localhost:5174');
  const authorizationUrl = new URL(started.authorizationUrl);
  assert.equal(authorizationUrl.origin, 'https://www.topview.ai');
  assert.equal(authorizationUrl.pathname, '/mcp_oauth/oauth/authorize');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'topview-client');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), 'http://localhost:5174/api/topview/oauth/callback');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'openid email mcp:tools');
  assert.equal(authorizationUrl.searchParams.get('resource'), 'https://mcp.topview.ai');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));

  const callbackUrl = new URL('http://localhost:5174/api/topview/oauth/callback');
  callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state'));
  callbackUrl.searchParams.set('code', 'authorization-code');
  const response = callbackResponse();
  await service.handleCallback(callbackUrl, response);
  assert.equal(response.status, 200);
  assert.match(response.body, /Topview connected/);
  assert.deepEqual(await service.handlers.accountStatus(), {
    connected: true,
    configured: true,
    email: 'artist@example.com',
    credits: 69.53,
  });

  const tokenRequestEntry = requests.find((entry) => entry.url.endsWith('/mcp_oauth/oauth/token'));
  const tokenForm = new URLSearchParams(String(tokenRequestEntry.init.body));
  assert.equal(tokenForm.get('grant_type'), 'authorization_code');
  assert.equal(tokenForm.get('client_id'), 'topview-client');
  assert.equal(tokenForm.get('resource'), 'https://mcp.topview.ai');
  assert.ok(tokenForm.get('code_verifier'));

  const encrypted = await readFile(path.join(dataRoot, 'integrations', 'topview', 'token.enc.json'), 'utf8');
  assert.doesNotMatch(encrypted, /topview-access-token|topview-refresh-token/);

  const generated = await service.handlers.generate({
    prompt: 'A cinematic product reveal with both references.',
    model: 'auto',
    durationSec: 15,
    aspectRatio: '16:9',
    resolution: '1080p',
    generateAudio: true,
    medias: [
      { value: '/media/one.png', role: 'image' },
      { value: '/media/two.png', role: 'image' },
    ],
  });
  assert.deepEqual(generated, {
    url: 'https://cdn.topview.example/video-42.mp4',
    mediaType: 'video',
    durationSec: 15,
    taskId: 'task-42',
    model: 'seedance-2-5-live',
    boardUrl: 'https://www.topview.ai/board/board-cinegen-shared?boardResultId=board-task-42',
  });
  assert.deepEqual(uploadedBodies, ['reference-one', 'reference-two']);
  for (const credentialCall of toolCalls.filter((entry) => entry.name === 'ta_upload_credential')) {
    assert.equal(credentialCall.args.req.needAccelerateUrl, false);
  }
  assert.deepEqual(toolCalls.map((entry) => entry.name), [
    'topview_get_credit',
    'topview_list_boards',
    'topview_get_generation_config',
    'ta_upload_credential',
    'ta_upload_check_file',
    'ta_upload_credential',
    'ta_upload_check_file',
    'topview_generate_video',
    'topview_query_task',
  ]);
  assert.equal(toolCalls.some((entry) => entry.name === 'topview_create_board'), false);

  await service.handlers.authLogout();
  assert.deepEqual(await service.handlers.accountStatus(), { connected: false, configured: true });
  assert.ok(requests.some((entry) => entry.url === 'https://mcp.topview.ai/mcp'));
});

test('rejects a mismatched OAuth state and clears the pending login', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cinegen-topview-state-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const service = createTopviewService({
    dataRoot,
    tokenSecret: 'state-test-secret',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/mcp_oauth/oauth/register')) {
        return jsonResponse({ client_id: 'state-client', token_endpoint_auth_method: 'none' });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  await service.handlers.authLogin('http://127.0.0.1:8787');
  const response = callbackResponse();
  await service.handleCallback(new URL(
    'http://127.0.0.1:8787/api/topview/oauth/callback?state=wrong&code=code',
  ), response);
  assert.equal(response.status, 400);
  assert.match(response.body, /could not be verified/);
  assert.deepEqual(await service.handlers.accountStatus(), { connected: false, configured: true });
});

test('registers Topview RPC handlers and OAuth callback on the local web server', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cinegen-topview-web-route-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  let callbackCalls = 0;
  const topviewService = {
    handlers: {
      accountStatus: async () => ({ connected: true, configured: true, email: 'route@example.com' }),
    },
    async handleCallback(_url, response) {
      callbackCalls += 1;
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('callback-ok');
    },
  };
  const app = await createCineGenWebServer({ dataRoot, topviewService });
  const address = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const rpcResponse = await fetch(`${baseUrl}/api/rpc/topview/accountStatus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: [] }),
  });
  assert.equal(rpcResponse.status, 200);
  assert.deepEqual(await rpcResponse.json(), {
    ok: true,
    result: { connected: true, configured: true, email: 'route@example.com' },
  });

  const callback = await fetch(`${baseUrl}/api/topview/oauth/callback?state=s&code=c`);
  assert.equal(callback.status, 200);
  assert.equal(await callback.text(), 'callback-ok');
  assert.equal(callbackCalls, 1);
});
