import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildArtlistToolArguments,
  createArtlistService,
  parseArtlistMcpResult,
  selectArtlistVideoTool,
} from './artlist.mjs';

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

test('selects a generation tool and maps CineGen settings plus local elements', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cinegen-artlist-args-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const imagePath = path.join(root, 'character.png');
  await writeFile(imagePath, Buffer.from('reference-image'));
  const tools = [
    { name: 'search_generations', description: 'Search the account' },
    {
      name: 'generate_video',
      description: 'Generate a finished video from text and reference images',
      inputSchema: {
        type: 'object',
        required: ['prompt', 'output_type'],
        properties: {
          prompt: { type: 'string' },
          output_type: { type: 'string', enum: ['image', 'video'] },
          duration_seconds: { type: 'integer' },
          aspect_ratio: { type: 'string' },
          resolution: { type: 'string' },
          reference_images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                mime_type: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
      },
    },
  ];
  const tool = selectArtlistVideoTool(tools);
  assert.equal(tool.name, 'generate_video');
  const args = await buildArtlistToolArguments(tool, {
    prompt: 'A detective enters a rain-soaked diner.',
    durationSec: 8,
    aspectRatio: '16:9',
    resolution: '1080p',
    medias: [{ value: '/media/character.png', role: 'character' }],
  }, {
    pathForMediaReference: () => imagePath,
  });
  assert.equal(args.output_type, 'video');
  assert.equal(args.duration_seconds, 8);
  assert.match(args.prompt, /rain-soaked diner/);
  assert.match(args.reference_images[0].url, /^data:image\/png;base64,/);
  assert.equal(args.reference_images[0].mime_type, 'image/png');
  assert.equal(args.reference_images[0].role, 'character');
});

test('extracts finished Artlist video results', () => {
  assert.deepEqual(parseArtlistMcpResult({
    structuredContent: { generationId: 'gen-42' },
    content: [{ type: 'text', text: 'Finished: https://cdn.artlist.io/result/final.mp4' }],
  }), {
    url: 'https://cdn.artlist.io/result/final.mp4',
    mediaType: 'video',
    generationId: 'gen-42',
  });
});

test('reports a clear setup state when localhost has no approved Artlist client', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cinegen-artlist-unconfigured-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const service = createArtlistService({
    dataRoot,
    tokenSecret: 'unconfigured-test-secret',
    fetchImpl: async () => { throw new Error('No network call expected'); },
  });

  assert.deepEqual(await service.handlers.accountStatus(), {
    connected: false,
    configured: false,
    setupRequired: true,
    setupMessage: "Artlist must approve CineGen's web address before sign-in. Local testing cannot complete this connection yet.",
  });
  await assert.rejects(
    service.handlers.authLogin('http://localhost:5174'),
    (error) => error.code === 'ARTLIST_CLIENT_REGISTRATION_REQUIRED'
      && /localhost build/.test(error.message),
  );
});

test('completes OAuth, encrypts tokens, and generates directly through Artlist MCP', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cinegen-artlist-service-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const imagePath = path.join(dataRoot, 'element.png');
  await writeFile(imagePath, Buffer.from('product-reference'));
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/oidc/register')) {
      return jsonResponse({ client_id: 'cinegen-client', token_endpoint_auth_method: 'none' });
    }
    if (String(url).endsWith('/oauth/token')) {
      return jsonResponse({
        access_token: 'artlist-access-token',
        refresh_token: 'artlist-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    if (String(url).endsWith('/oauth/revoke')) return new Response(null, { status: 200 });
    if (String(url) === 'https://mcp.artlist.io/mcp') {
      const message = JSON.parse(String(init.body));
      if (message.method === 'initialize') {
        return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, {
          headers: { 'mcp-session-id': 'session-1' },
        });
      }
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (message.method === 'tools/list') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [{
              name: 'generate_video',
              description: 'Generate video with reference images',
              inputSchema: {
                type: 'object',
                properties: {
                  prompt: { type: 'string' },
                  media_type: { type: 'string', enum: ['image', 'video'] },
                  reference_images: { type: 'array', items: { type: 'string' } },
                },
              },
            }],
          },
        });
      }
      if (message.method === 'tools/call') {
        assert.equal(message.params.name, 'generate_video');
        assert.equal(message.params.arguments.media_type, 'video');
        assert.match(message.params.arguments.reference_images[0], /^data:image\/png;base64,/);
        return jsonResponse({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            structuredContent: { generationId: 'generation-7' },
            content: [{ type: 'text', text: 'https://cdn.artlist.io/generations/video-7.mp4' }],
          },
        });
      }
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const service = createArtlistService({
    dataRoot,
    fetchImpl,
    tokenSecret: 'test-only-encryption-secret',
    clientMetadataUrl: 'https://cinegen.example/api/artlist/oauth/client-metadata',
    pathForMediaReference: () => imagePath,
  });
  const started = await service.handlers.authLogin('http://localhost:5174');
  const authorizationUrl = new URL(started.authorizationUrl);
  assert.equal(authorizationUrl.origin, 'https://auth.artlist.io');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'https://cinegen.example/api/artlist/oauth/client-metadata');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorizationUrl.searchParams.get('resource'), 'https://mcp.artlist.io/');

  const callbackUrl = new URL('http://localhost:5174/api/artlist/oauth/callback');
  callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state'));
  callbackUrl.searchParams.set('code', 'authorization-code');
  const callbackResponse = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
  await service.handleCallback(callbackUrl, callbackResponse);
  assert.equal(callbackResponse.status, 200);
  assert.match(callbackResponse.body, /Artlist connected/);
  assert.deepEqual(await service.handlers.accountStatus(), { connected: true, configured: true });

  const encryptedToken = await readFile(path.join(dataRoot, 'integrations', 'artlist', 'token.enc.json'), 'utf8');
  assert.doesNotMatch(encryptedToken, /artlist-access-token|artlist-refresh-token/);

  const generated = await service.handlers.generate({
    prompt: 'A premium product turntable shot',
    durationSec: 5,
    medias: [{ value: '/media/element.png', role: 'product' }],
  });
  assert.deepEqual(generated, {
    url: 'https://cdn.artlist.io/generations/video-7.mp4',
    mediaType: 'video',
    generationId: 'generation-7',
    durationSec: 5,
  });
  assert.ok(requests.some((entry) => entry.url === 'https://mcp.artlist.io/mcp'));

  await service.handlers.authLogout();
  assert.deepEqual(await service.handlers.accountStatus(), { connected: false, configured: true });
});

test('publishes an OAuth client metadata document for an HTTPS deployment', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cinegen-artlist-metadata-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const service = createArtlistService({
    dataRoot,
    publicBaseUrl: 'https://cinegen.example',
    tokenSecret: 'metadata-test-secret',
    fetchImpl: async () => { throw new Error('No network call expected'); },
  });
  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
  service.handleClientMetadata(response);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    client_id: 'https://cinegen.example/api/artlist/oauth/client-metadata',
    client_name: 'CineGen Web',
    client_uri: 'https://cinegen.example',
    redirect_uris: ['https://cinegen.example/api/artlist/oauth/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
});
