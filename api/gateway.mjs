import { Readable } from 'node:stream';
const BACKEND='https://cinegen-team.cogden.chatgpt.site';
const FIREBASE_KEY='AIzaSyDhxfLpKNqAMJWFCiUPaQiINUk2U2Wv9gA';
const ALLOWED=new Set(['christopherjohnogden@gmail.com','taylormichaelogden@gmail.com']);
export const config={api:{bodyParser:false}};
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const url=new URL(req.url,'https://'+req.headers.host);
    const path=url.searchParams.get('__route')||url.pathname;
    url.searchParams.delete('__route');
    const origin='https://'+req.headers.host;
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin) {
      res.statusCode=403;res.end(JSON.stringify({ok:false,error:{message:'Origin not allowed.'}}));return;
    }
    if(path==='/api/session') {
      if(req.method==='DELETE'){res.setHeader('Set-Cookie','__Host-cinegen_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');res.statusCode=204;res.end();return;}
      if(req.method!=='POST'){res.statusCode=405;res.end();return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw new Error('Request too large.');}
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
    const response=await fetch(target,{method:req.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
    res.statusCode=response.status;
    for(const key of ['content-type','content-length','content-range','accept-ranges','etag','location']){const value=response.headers.get(key);if(value)res.setHeader(key,value);}
    if(req.method==='HEAD'||!response.body){res.end();return;}
    Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);
  }catch{res.statusCode=502;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:{message:'CineGen could not reach its backend. Please try again.'}}));}
}
