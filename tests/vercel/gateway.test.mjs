import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import handler from '../../api/gateway.mjs';
const nativeFetch=globalThis.fetch;
const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const host=`127.0.0.1:${server.address().port}`,base=`http://${host}`;
after(()=>server.close());

test('gateway rejects writes from another origin and private reads without a session',async()=>{
  assert.equal((await nativeFetch(base+'/api/gateway?__route=/api/session',{method:'POST',headers:{origin:'https://other.example'},body:'{}'})).status,403);
  assert.equal((await nativeFetch(base+'/api/gateway?__route=/api/rpc/project/list')).status,401);
});
test('session validates Firebase identity before issuing a protected cookie',async()=>{
  globalThis.fetch=async()=>Response.json({users:[{localId:'owner',email:'christopherjohnogden@gmail.com'}]});
  try{
    const r=await nativeFetch(base+'/api/gateway?__route=/api/session',{method:'POST',headers:{origin:`https://${host}`},body:JSON.stringify({idToken:'test.token'})});
    assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  }finally{globalThis.fetch=nativeFetch;}
});
test('gateway forwards authenticated media ranges without trusting caller identity headers',async()=>{
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://cinegen-team.cogden.chatgpt.site/media/clip.mp4');
    assert.equal(options.headers.get('x-cinegen-id-token'),'test.token');
    assert.equal(options.headers.get('oai-authenticated-user-id'),null);
    assert.equal(options.headers.get('range'),'bytes=0-2');
    return new Response('abc',{status:206,headers:{'content-range':'bytes 0-2/10','content-type':'video/mp4'}});
  };
  try{
    const r=await nativeFetch(base+'/api/gateway?__route=/media/clip.mp4',{headers:{cookie:'__Host-cinegen_session=test.token',range:'bytes=0-2','oai-authenticated-user-id':'spoofed'}});
    assert.equal(r.status,206);assert.equal(await r.text(),'abc');assert.equal(r.headers.get('content-range'),'bytes 0-2/10');
  }finally{globalThis.fetch=nativeFetch;}
});
