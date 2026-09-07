import { Readable } from 'node:stream';
import { saveGeneratedMediaOnNode } from '../vercel/lib/generated-media-save.mjs';
const BACKEND='https://cinegen-api.christopherjohnogden.workers.dev';
const FIREBASE_KEY='AIzaSyDhxfLpKNqAMJWFCiUPaQiINUk2U2Wv9gA';
const ALLOWED=new Set(['christopherjohnogden@gmail.com','taylormichaelogden@gmail.com']);
export const config={api:{bodyParser:false}};
async function requestBody(req) {
  if(req.body!==undefined)return typeof req.body==='string'||Buffer.isBuffer(req.body)?req.body:JSON.stringify(req.body);
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>4*1024*1024)throw new Error('Request too large.');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const url=new URL(req.url,'https://'+req.headers.host);
    const path=url.searchParams.get('__route')||url.pathname;
    url.searchParams.delete('__route');
    const origin='https://'+req.headers.host;
    if(path==='/api/generated-media/save') {
      res.setHeader('Content-Type','application/json');
      if(req.method!=='POST'){res.statusCode=405;res.end();return;}
      try {
        // Explicit bearer authentication permits the remote worker to call this
        // route; browser cookies alone never authorize a transfer.
        const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
        if(!token){res.statusCode=401;res.end(JSON.stringify({ok:false,error:{message:'Sign in to CineGen.'}}));return;}
        const raw=String(await requestBody(req));
        if(raw.length>20000){res.statusCode=413;res.end();return;}
        const result=await saveGeneratedMediaOnNode(JSON.parse(raw),token,ALLOWED,FIREBASE_KEY);
        res.end(JSON.stringify({ok:true,result}));
      }catch(error){res.statusCode=[400,401,403].includes(error.status)?error.status:502;res.end(JSON.stringify({ok:false,error:{message:error.message?.replace(/https?:\/\/[^\s]+/g,'[media]')||'Saving generated media failed.'}}));}
      return;
    }
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin) {
      res.statusCode=403;res.end(JSON.stringify({ok:false,error:{message:'Origin not allowed.'}}));return;
    }
    if(path==='/api/session') {
      if(req.method==='DELETE'){res.setHeader('Set-Cookie','__Host-cinegen_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');res.statusCode=204;res.end();return;}
      if(req.method!=='POST'){res.statusCode=405;res.end();return;}
      const raw=String(await requestBody(req));if(raw.length>20000)throw new Error('Request too large.');
      const {idToken}=JSON.parse(raw);
      if(typeof idToken!=='string'||!/^[A-Za-z0-9_.-]+$/.test(idToken))throw new Error('Sign in again.');
      const verified=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+FIREBASE_KEY,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
      const data=await verified.json();const user=data.users?.[0];
      if(!verified.ok||!user?.localId||user.disabled||!ALLOWED.has(user.email?.toLowerCase())){res.statusCode=403;res.end(JSON.stringify({error:'This CineGen account is not approved.'}));return;}
      res.setHeader('Set-Cookie',`__Host-cinegen_session=${idToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3500`);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));return;
    }
    if(path==='/api/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,hosting:'vercel',backend:BACKEND}));return;}
    if(!/^\/(api\/(rpc\/|events$|higgsfield\/oauth\/callback$|topview\/oauth\/callback$)|media\/)/.test(path)){res.statusCode=404;res.end();return;}
    const token=req.headers.cookie?.match(/(?:^|;\s*)__Host-cinegen_session=([^;]+)/)?.[1];
    if(!token){res.statusCode=401;res.end(JSON.stringify({ok:false,error:{message:'Sign in to CineGen.',code:'AUTH_REQUIRED'}}));return;}
    const headers=new Headers({'X-CineGen-ID-Token':token,'X-CineGen-Origin':origin});
    for(const key of ['content-type','accept','range','if-range'])if(req.headers[key])headers.set(key,req.headers[key]);
    const target=new URL(path,BACKEND);target.search=url.search;
    if(target.origin!==BACKEND)throw new Error('Invalid request path.');
    const response=await fetch(target,{method:req.method,headers,redirect:'manual',signal:AbortSignal.timeout(240000),...(!['GET','HEAD'].includes(req.method)?{body:await requestBody(req)}:{})});
    res.statusCode=response.status;
    for(const key of ['content-type','content-length','content-range','accept-ranges','etag','location']){const value=response.headers.get(key);if(value)res.setHeader(key,value);}
    if(req.method==='HEAD'||!response.body){res.end();return;}
    Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);
  }catch{res.statusCode=502;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:{message:'CineGen could not reach its backend. Please try again.'}}));}
}
