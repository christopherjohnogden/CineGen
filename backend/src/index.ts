import { authenticateRemoteRequest,isCineGenVercelOrigin } from '../../site/lib/server/remote-access';
import { decodeMediaPath,errorResponse,success,workspaceIdForRequest } from '../../site/lib/server/common';
import { serveMedia,uploadMedia } from '../../site/lib/server/media-store';
import { handleRpc } from '../../site/lib/server/rpc-router';
import { handleHiggsfieldCallback } from '../../site/lib/server/higgsfield-mcp';
import { handleTopviewCallback } from '../../site/lib/server/topview-mcp';
export default {
  async fetch(request:Request,env:any):Promise<Response>{
    const originalUrl=new URL(request.url),origin=request.headers.get('origin')||'';
    if(originalUrl.pathname.startsWith('/__migration/'))return new Response('Not found',{status:404});
    if(originalUrl.pathname==='/api/health')return success({status:'ready',service:'cinegen-api',storage:'cloudflare',version:1});
    const cors=isCineGenVercelOrigin(origin);
    if(request.method==='OPTIONS')return cors?new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-CineGen-ID-Token, X-CineGen-Origin','Access-Control-Max-Age':'600','Vary':'Origin'}}):new Response('Origin not allowed',{status:403});
    let response:Response;
    try{
      // Unlike Sites, a public Worker has no trusted upstream identity headers.
      if(!request.headers.get('x-cinegen-id-token'))return Response.json({ok:false,error:{code:'AUTH_REQUIRED',message:'Sign in to CineGen.'}},{status:401,headers:{'cache-control':'no-store',...(cors?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
      request=await authenticateRemoteRequest(request);
      const url=new URL(request.url),workspace=workspaceIdForRequest(request);
      if(url.pathname==='/api/events'&&request.method==='GET')response=new Response('retry: 30000\n: CineGen cloud event bridge ready\n\n',{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});
      else if(url.pathname==='/api/uploads'&&request.method==='POST')response=success(await uploadMedia(request,env.MEDIA,workspace),{status:201});
      else if(url.pathname.startsWith('/media/')&&['GET','HEAD'].includes(request.method))response=await serveMedia(request,env.MEDIA,workspace,decodeMediaPath(url.pathname.slice(7).split('/')));
      else if(url.pathname==='/api/higgsfield/oauth/callback'&&request.method==='GET')response=await handleHiggsfieldCallback(request,env,workspace);
      else if(url.pathname==='/api/topview/oauth/callback'&&request.method==='GET')response=await handleTopviewCallback(request,env,workspace);
      else{
        const match=/^\/api\/rpc\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
        response=match&&request.method==='POST'?await handleRpc(request,{namespace:match[1],method:match[2]},env):new Response('Not found',{status:404});
      }
    }catch(e){response=errorResponse(e);}
    if(cors){response=new Response(response.body,response);response.headers.set('Access-Control-Allow-Origin',origin);response.headers.append('Vary','Origin');}
    return response;
  },
};
