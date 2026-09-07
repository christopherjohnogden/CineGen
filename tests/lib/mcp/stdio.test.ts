// @vitest-environment node
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '../../../mcp/tool-catalog.mjs';

describe('MCP stdio protocol', () => {
  it('drains the entire catalogue before exiting when the client closes stdin', async () => {
    const responses=await new Promise<Array<{id:number;result:{serverInfo?:{version:string};tools?:unknown[]}}>>((resolve,reject)=>{
      const child=spawn(process.execPath,['mcp/cinegen-mcp.mjs'],{stdio:['pipe','pipe','pipe']});
      let output='',error='';
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
      child.on('error',reject);
      child.on('close',code=>{
        if(code!==0) {reject(new Error(error));return;}
        try {resolve(output.trim().split('\n').map(line=>JSON.parse(line)));} catch(cause) {reject(cause);}
      });
      child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');
    });
    expect(responses.find(x=>x.id===1)?.result.serverInfo?.version).toBe('0.6.2');
    expect(responses.find(x=>x.id===2)?.result.tools).toHaveLength(TOOL_CATALOG.length);
  });
});

it('serves the UI resource and forwards display data as structuredContent over stdio', async () => {
  const { createServer } = await import('node:http');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = await mkdtemp(join(tmpdir(), 'cinegen-display-test-'));
  const data = { title: 'Generations', items: [], total: 0, offset: 0, limit: 12, hasMore: false, mode: 'generations', refresh: { name: 'cinegen_show_generations', arguments: {} } };
  const bridge = createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer test-token');
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: data }));
  });
  await new Promise<void>(resolve => bridge.listen(0, '127.0.0.1', resolve));
  try {
    const port = (bridge.address() as { port: number }).port;
    const bridgeFile = join(folder, 'bridge.json');
    await writeFile(bridgeFile, JSON.stringify({ port, token: 'test-token' }));
    const output = await new Promise<any[]>((resolve, reject) => {
      const child = spawn(process.execPath, ['mcp/cinegen-mcp.mjs'], { env: { ...process.env, CINEGEN_MCP_BRIDGE_FILE: bridgeFile }, stdio: ['pipe', 'pipe', 'pipe'] });
      let text = ''; child.stdout.on('data', chunk => text += chunk); child.on('error', reject);
      child.on('close', code => { try { if (code !== 0) throw new Error('stdio failed'); resolve(text.trim().split('\n').map(line => JSON.parse(line))); } catch (error) { reject(error); } });
      child.stdin.end([
        { id: 1, method: 'resources/list' },
        { id: 2, method: 'resources/read', params: { uri: 'ui://cinegen/media-viewer-v7.html' } },
        { id: 3, method: 'tools/call', params: { name: 'cinegen_show_generations', arguments: {} } },
      ].map(message => JSON.stringify({ jsonrpc: '2.0', ...message })).join('\n') + '\n');
    });
    expect(output.find(item => item.id === 1).result.resources[0].uri).toBe('ui://cinegen/media-viewer-v7.html');
    expect(output.find(item => item.id === 2).result.contents[0].text).toContain('ui/initialize');
    expect(output.find(item => item.id === 3).result.structuredContent).toEqual(data);
    expect(output.find(item => item.id === 3).result.content[0].text).toContain('No matching media');
  } finally { await new Promise<void>(resolve => bridge.close(() => resolve())); await rm(folder, { recursive: true, force: true }); }
});
