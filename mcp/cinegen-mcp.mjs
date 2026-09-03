#!/usr/bin/env node
/**
 * The CineGen MCP server.
 *
 * Speaks MCP over stdio and forwards every tool call to the running CineGen
 * app through its loopback bridge. There is no SDK dependency: the protocol
 * surface a tool server needs is four methods, and the repo already hand-rolls
 * MCP clients, so this stays a single file with nothing to install.
 *
 *   claude mcp add cinegen -- node /absolute/path/to/mcp/cinegen-mcp.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { TOOL_CATALOG } from './tool-catalog.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const DISCOVERY_FILE = process.env.CINEGEN_MCP_BRIDGE_FILE
  || join(homedir(), 'Documents', 'CINEGEN', 'mcp-bridge.json');

function readBridge() {
  try {
    const raw = JSON.parse(readFileSync(DISCOVERY_FILE, 'utf8'));
    if (typeof raw?.port === 'number' && typeof raw?.token === 'string') return raw;
  } catch {
    // Falls through to the "app not running" message below.
  }
  return null;
}

const NOT_RUNNING =
  'CineGen is not running. Open the CineGen app (and a project) and try again — the tools act on the open project.';

async function callBridge(tool, args) {
  const bridge = readBridge();
  if (!bridge) throw new Error(NOT_RUNNING);

  let response;
  try {
    response = await fetch(`http://127.0.0.1:${bridge.port}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.token}` },
      body: JSON.stringify({ tool, args }),
    });
  } catch {
    throw new Error(NOT_RUNNING);
  }

  if (response.status === 401) throw new Error('The CineGen bridge rejected this token. Restart the app.');
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error('The CineGen bridge returned something unreadable.');
  if (!payload.ok) throw new Error(payload.error || 'The tool failed.');
  return payload.result;
}

// --- MCP plumbing --------------------------------------------------------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  // Notifications carry no id and take no reply.
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    result(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'cinegen', version: '0.1.0' },
      instructions:
        'Drives the open CineGen project. Call cinegen_get_context first to learn the real Spaces, Elements and Director state, then act with names and ids from it. You do the writing — breakdowns, shot lists, prompts — and these tools put the result in the app.',
    });
    return;
  }

  if (method === 'tools/list') {
    result(id, { tools: TOOL_CATALOG });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const tool = TOOL_CATALOG.find((entry) => entry.name === name);
    if (!tool) {
      failure(id, -32602, `Unknown tool "${name}".`);
      return;
    }
    try {
      const value = await callBridge(name, params?.arguments ?? {});
      result(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
    } catch (error) {
      // A tool failure is a result the model can read and react to, not a
      // protocol error: it should be able to fix its arguments and retry.
      result(id, {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      });
    }
    return;
  }

  if (method === 'ping') {
    result(id, {});
    return;
  }

  failure(id, -32601, `Unsupported method "${method}".`);
}

// A tool call can outlive the line that started it, so shutdown waits for the
// answers still in flight instead of cutting them off.
let inFlight = 0;
let closing = false;

function maybeExit() {
  if (closing && inFlight === 0) process.exit(0);
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  inFlight += 1;
  void handle(message)
    .catch((error) => {
      if (message?.id !== undefined && message?.id !== null) {
        failure(message.id, -32603, error instanceof Error ? error.message : String(error));
      }
    })
    .finally(() => {
      inFlight -= 1;
      maybeExit();
    });
});

lines.on('close', () => {
  closing = true;
  maybeExit();
});
