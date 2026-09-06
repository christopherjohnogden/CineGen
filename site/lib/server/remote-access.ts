import { isAllowedCineGenEmail, SiteHttpError } from './common';
const FIREBASE_KEY='AIzaSyDhxfLpKNqAMJWFCiUPaQiINUk2U2Wv9gA';
export function isCineGenVercelOrigin(value:string):boolean {
  try {
    const url=new URL(value);
    return url.origin===value&&url.protocol==='https:'&&(
      url.hostname==='cinegen-kappa.vercel.app'
      || url.hostname==='cinegen-film.vercel.app'
      || url.hostname==='cinegen-christopher-ogdens-projects-8fd5f6aa.vercel.app'
      || /^cinegen-[a-z0-9]+-christopher-ogdens-projects-8fd5f6aa\.vercel\.app$/.test(url.hostname)
    );
  }catch{return false;}
}
export async function authenticateRemoteRequest(request:Request):Promise<Request> {
  const token=request.headers.get('x-cinegen-id-token');
  if(!token)return request;
  const origin=request.headers.get('x-cinegen-origin')||request.headers.get('origin')||'';
  if(!isCineGenVercelOrigin(origin))throw new SiteHttpError(403,'Origin not allowed.','ACCESS_DENIED');
  if(token.length>12000)throw new SiteHttpError(401,'Invalid sign-in.','AUTH_REQUIRED');
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token})});
  const data=await r.json() as {users?:Array<{localId?:string;email?:string;disabled?:boolean}>};const user=data.users?.[0];
  if(!r.ok||!user?.localId||!user.email||user.disabled)throw new SiteHttpError(401,'Sign in to CineGen again.','AUTH_REQUIRED');
  if(!isAllowedCineGenEmail(user.email))throw new SiteHttpError(403,'This account does not have access to CineGen.','ACCESS_DENIED');
  const headers=new Headers(request.headers);
  headers.delete('x-cinegen-id-token');headers.delete('cookie');
  headers.set('oai-authenticated-user-id',user.localId);headers.set('oai-authenticated-user-email',user.email);
  const url=new URL(request.url);const trustedUrl=new URL(url.pathname+url.search,origin);
  return new Request(trustedUrl,new Request(request,{headers}));
}
