import {build} from '../../node_modules/esbuild/lib/main.js';
import test from 'node:test';import assert from 'node:assert/strict';
await build({entryPoints:['backend/src/index.ts'],outfile:'backend/dist/test.mjs',bundle:true,platform:'browser',format:'esm',external:['node:*'],alias:{'@':new URL('../../src',import.meta.url).pathname}});
const {default:worker}=await import('../dist/test.mjs');
test('standalone backend rejects spoofed Sites headers without Firebase token',async()=>{
 const r=await worker.fetch(new Request('https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/project/list',{method:'POST',headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'christopherjohnogden@gmail.com'},body:'{"args":[]}'}),{});assert.equal(r.status,401);
});
test('retired migration endpoints are unavailable',async()=>{
 const r=await worker.fetch(new Request('https://example.com/__migration/inventory'),{});assert.equal(r.status,404);
 const expired=await worker.fetch(new Request('https://example.com/__migration/inventory',{headers:{authorization:'Bearer test'}}),{CINEGEN_MIGRATION_SECRET:'test',CINEGEN_MIGRATION_EXPIRES:'0'});assert.equal(expired.status,404);
});
test('verified Firebase request reaches the shared workspace service',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({users:[{localId:'owner',email:'christopherjohnogden@gmail.com'}]});
 try{const r=await worker.fetch(new Request('https://api.example/api/events',{headers:{'x-cinegen-id-token':'test','x-cinegen-origin':'https://cinegen-film.vercel.app'}}),{});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/event-stream/);}finally{globalThis.fetch=old;}
});
