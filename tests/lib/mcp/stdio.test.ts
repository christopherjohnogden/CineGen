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
    expect(responses.find(x=>x.id===1)?.result.serverInfo?.version).toBe('0.2.0');
    expect(responses.find(x=>x.id===2)?.result.tools).toHaveLength(TOOL_CATALOG.length);
  });
});
