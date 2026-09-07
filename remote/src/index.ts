import { OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CloudStore, FIREBASE_KEY, refreshIdentity, verifyIdentity, safeId, type Identity } from './firebase';
import { editProject, remoteTools } from './headless';
import { createDefaultProjectState } from '../../site/lib/server/project-store';
import { z } from 'zod';
z.config({ jitless: true });
import { requestedProvider, connectedModels, prepareProviderGeneration } from './providers';
import { generationTools, models, prepareGeneration } from './jobs';
export { GenerationJob } from './jobs';

interface Env { OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers; JOBS: DurableObjectNamespace; PUBLIC_ORIGIN: string; ALLOWED_EMAILS: string }
function html(value: unknown) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
function page(body:string, script='', nonce=crypto.randomUUID()) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CineGen Connect</title><style>body{margin:0;background:#101014;color:#ececf0;font:16px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(440px,calc(100vw - 48px));padding:32px 0}h1{font-size:28px}p{line-height:1.6;color:#bdbdc8}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;font:inherit;border-radius:8px;padding:12px;width:100%}input{background:#202028;border:1px solid #444454;color:white}button{margin-top:24px;background:#9c8bff;color:#101014;border:0;cursor:pointer}button:disabled{opacity:.6}a{color:#b8adff}small{display:block;line-height:1.6;color:#bdbdc8}#error{color:#ffb0b0}code{overflow-wrap:anywhere}</style><main>${body}</main>${script?`<script nonce="${nonce}">${script}</script>`:''}</html>`, { headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self' https://identitytoolkit.googleapis.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`}});
}
const projectTool = { name:'cinegen_project',description:'List or create saved CineGen cloud projects. Use the returned projectId for all other tools. Projects appear in the app and website when signed into the same CineGen Cloud account.',inputSchema:{type:'object' as const,properties:{action:{type:'string',enum:['list','create']},name:{type:'string',minLength:1,maxLength:100}},required:['action'],additionalProperties:false}};

async function mcp(request:Request, env:Env, ctx:ExecutionContext & {props:Identity}) {
  const origin=request.headers.get('origin');
  if(origin && origin!==env.PUBLIC_ORIGIN) return new Response('Origin not allowed',{status:403});
  const server = new Server({name:'cinegen',version:'1.2.1'},{capabilities:{tools:{}},instructions:'Topview is the default generation provider. Use Higgsfield only when the user explicitly requests it; never auto-fallback and never ask for a fal key. Both use the provider connections already set up in CineGen. For Spaces Studio mode, use cinegen_studio_create to prepare image/video items without spending credits. Use cinegen_generate for actual unattended Studio generation. cinegen_nodes creates Canvas nodes, and cinegen_create_space creates template-based Canvas layouts. Studio items retain prompts and settings and can later be placed on Canvas. Refresh tools/list if cinegen_studio_create is missing from your cached tool index.'});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[projectTool,...remoteTools,...generationTools]}));
  server.setRequestHandler(CallToolRequestSchema,async({params})=>{
    try {
      const identity=ctx.props as Identity & {falKey?:string};
      if(!identity?.uid || !identity.refreshToken) throw new Error('Reconnect your CineGen account.');
      const auth=await refreshIdentity(identity.refreshToken);
      if(auth.uid!==identity.uid) throw new Error('Connection identity changed. Reconnect.');
      const store=new CloudStore(auth.token,auth.uid);
      const args=params.arguments??{};
      const tool=[projectTool,...remoteTools,...generationTools].find(t=>t.name===params.name);
      if(!tool)throw new Error('Unknown CineGen tool.');
      const validated=z.fromJSONSchema(tool.inputSchema as any).safeParse(args);
      if(!validated.success)throw new Error(`Invalid tool arguments: ${validated.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}`);
      let result:unknown;
      if(params.name==='cinegen_list_models') {
        const provider=requestedProvider(args.provider);
        const catalog=await connectedModels(auth.token,provider,args.kind);
        result={provider,defaultProvider:'topview',backupProvider:'higgsfield',automaticFallback:false,connected:catalog.connected,models:catalog.models.map(m=>({nodeType:m.nodeType,name:m.name,kind:m.outputType,inputs:m.inputs}))};
      }
      else if(params.name==='cinegen_generate'||params.name==='cinegen_get_jobs') {
        const projectId=safeId(args.projectId),requestId=safeId(args.requestId);
        await store.load(projectId);
        let prepared;
        if(params.name==='cinegen_generate') {
          args.provider=requestedProvider(args.provider);
          const catalog=await connectedModels(auth.token,args.provider);
          prepared=prepareProviderGeneration(args,catalog.models);
        }
        const job=env.JOBS.get(env.JOBS.idFromName(`${identity.uid}:${projectId}:${requestId}`));
        const response=await job.fetch(`https://job/${params.name==='cinegen_get_jobs'?'read':'start'}`,{method:'POST',body:JSON.stringify({identity,args,prepared})});
        result=await response.json();
        if(!response.ok)throw new Error((result as any).error??'Job unavailable.');
      }
      else if(params.name==='cinegen_project') {
        if(args.action==='list') result=await store.projects();
        else if(args.action==='create') {
          if(typeof args.name!=='string' || !args.name.trim() || args.name.length>100) throw new Error('Project name must be 1–100 characters.');
          const state=createDefaultProjectState(args.name.trim());
          const projectId=String(state.project.id); const now=new Date().toISOString();
          // Firebase permissions require the owner project to exist before its access entry.
          const revision=crypto.randomUUID().replaceAll('-',''); const path=`users/${auth.uid}/projects/${projectId}`;
          await store.commit([
            store.write(`${path}/revisions/${revision}/chunks/000000`,{index:0,data:JSON.stringify(state)},undefined,true),
            store.write(`${path}/revisions/${revision}`,{chunkCount:1,complete:true,createdAt:now},undefined,true),
            store.write(path,{id:projectId,name:args.name.trim(),createdAt:now,updatedAt:now,assetCount:0,elementCount:0,thumbnail:null,useSqlite:true,currentRevision:revision,chunkCount:1,schemaVersion:1},undefined,true),
          ]);
          const teamId=`team_${auth.uid}`;
          if(!await store.get(`teams/${teamId}`)) await store.commit([store.write(`teams/${teamId}`,{teamId,name:'CineGen Team',ownerId:auth.uid,members:{[auth.uid]:'owner'},memberIds:[auth.uid],memberDetails:[{uid:auth.uid,email:identity.email,role:'owner',addedAt:now}],createdAt:now,updatedAt:now},undefined,true)]);
          await store.commit([store.write(`projectAccess/${projectId}`,{projectId,ownerId:auth.uid,teamId,members:{[auth.uid]:'owner'},memberIds:[auth.uid],memberDetails:[{uid:auth.uid,email:identity.email,role:'owner',addedAt:now}],createdAt:now,updatedAt:now},undefined,true)]);
          result={projectId,name:args.name,saved:true};
        } else throw new Error('Choose list or create.');
      } else {
        const loaded=await store.load(safeId(args.projectId));
        const {projectId,...toolArgs}=args;
        const edited=await editProject(loaded.state,loaded.library,params.name,toolArgs,loaded.metadata.useSqlite!==false);
        const revision=edited.changed ? await store.save(loaded,edited.state,edited.library) : loaded.metadata.currentRevision;
        result={result:edited.result,projectId,revision,saved:edited.changed};
      }
      return {content:[{type:'text' as const,text:JSON.stringify(result)}]};
    } catch(error) { return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:'CineGen could not finish the operation.'}]}; }
  });
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  return transport.handleRequest(request);
}
const defaultHandler={async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.origin!==env.PUBLIC_ORIGIN) return new Response('Unknown host',{status:400});
  if(url.pathname==='/health') return Response.json({status:'ready',service:'cinegen-remote',tools:remoteTools.length+generationTools.length+1});
  if(url.pathname==='/') return page(`<h1>CineGen Connect</h1><p>Work on your saved CineGen projects from Claude or ChatGPT, even while your Mac is closed.</p><label>Connection URL</label><code>${html(env.PUBLIC_ORIGIN)}/mcp</code><p>Add this URL as a custom connector, then sign in with your CineGen Cloud account.</p><small>Sign into the same cloud account in CineGen on desktop and the website to see your saved work. Local-only projects must sync first.</small>`);
  if(url.pathname!=='/authorize') return new Response('Not found',{status:404});
  try {
    if(request.method==='GET') {
      const auth=await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if(!auth.codeChallenge || auth.codeChallengeMethod!=='S256') throw new Error('This connection requires secure PKCE authorization.');
      if(auth.scope.some(s=>s!=='cinegen')) throw new Error('Unsupported permission requested.');
      const client=await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
      if(!client) throw new Error('Unknown application.');
      const nonce=crypto.randomUUID();
      await env.OAUTH_KV.put(`consent:${nonce}`,JSON.stringify(auth),{expirationTtl:600});
      const response=page(`<h1>Connect to CineGen</h1><p><strong>${html(client.clientName??'This application')}</strong> wants to read and edit projects in your CineGen Cloud account.</p><small>Connection returns to ${html(new URL(auth.redirectUri).origin)}. Only approve applications you intended to connect.</small><form id="login"><label for="email">CineGen Cloud email</label><input id="email" type="email" autocomplete="username" required><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required><small>Generation uses your existing CineGen Topview connection by default. Higgsfield is used only when you explicitly request it. Generation may spend provider credits.</small><button id="submit">Sign in and allow access</button><p id="error" role="alert"></p></form><small>This is your CineGen Cloud login, which may differ from your ChatGPT login. Your password is sent directly to Firebase.</small>`, `document.getElementById('login').onsubmit=async(e)=>{e.preventDefault();const b=document.getElementById('submit'),error=document.getElementById('error');b.disabled=true;error.textContent='';try{const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value,returnSecureToken:true})});document.getElementById('password').value='';const u=await r.json();if(!r.ok)throw new Error('Sign-in failed. Check your CineGen email and password.');const c=await fetch('/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nonce:${JSON.stringify(nonce)},idToken:u.idToken,refreshToken:u.refreshToken})});const d=await c.json();if(!c.ok)throw new Error(d.error);location.assign(d.redirectTo)}catch(err){error.textContent=err.message;b.disabled=false}};`);
      response.headers.set('set-cookie',`cinegen_consent=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/authorize; Max-Age=600`);
      return response;
    }
    if(request.method==='POST') {
      if(request.headers.get('origin')!==env.PUBLIC_ORIGIN) return Response.json({error:'Origin not allowed'},{status:403});
      if(Number(request.headers.get('content-length')??0)>20000) throw new Error('Request too large.');
      const text=await request.text(); if(text.length>20000) throw new Error('Request too large.');
      const body=JSON.parse(text); const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)cinegen_consent=([^;]+)/)?.[1];
      if(typeof body.nonce!=='string'||body.nonce!==cookie) throw new Error('Connection request expired. Start again from your assistant.');
      const stored=await env.OAUTH_KV.get(`consent:${body.nonce}`);
      if(!stored) throw new Error('Connection request expired. Start again.');
      const user=await verifyIdentity(String(body.idToken));
      const allowed=env.ALLOWED_EMAILS.split(',').map(s=>s.trim().toLowerCase());
      if(!allowed.includes(user.email)) throw new Error('This account is not invited to this CineGen connection.');
      const refreshed=await refreshIdentity(String(body.refreshToken));
      if(refreshed.uid!==user.uid) throw new Error('Account does not match.');
      if(body.falKey!==undefined&&(typeof body.falKey!=='string'||body.falKey.length>512))throw new Error('Invalid provider key.');
      const result=await env.OAUTH_PROVIDER.completeAuthorization({request:JSON.parse(stored),userId:user.uid,metadata:{email:user.email},scope:['cinegen'],props:{...user,refreshToken:refreshed.refreshToken,...(body.falKey?.trim()?{falKey:body.falKey.trim()}:{})}});
      await env.OAUTH_KV.delete(`consent:${body.nonce}`);
      return Response.json(result,{headers:{'cache-control':'no-store','set-cookie':'cinegen_consent=; Secure; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=0'}});
    }
    return new Response('Method not allowed',{status:405});
  } catch(e) { const error=e instanceof Error?e.message:'Connection failed.'; return request.method==='POST'?Response.json({error},{status:400}):page(`<h1>Connection unavailable</h1><p>${html(error)}</p>`); }
}};
export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext) {
    const provider=new OAuthProvider<Env>({apiRoute:'/mcp',apiHandler:{fetch:mcp as any},defaultHandler,authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',scopesSupported:['cinegen'],accessTokenTTL:3600,refreshTokenTTL:30*86400,allowPlainPKCE:false,resourceMetadata:{resource:`${env.PUBLIC_ORIGIN}/mcp`,authorization_servers:[env.PUBLIC_ORIGIN],scopes_supported:['cinegen'],resource_name:'CineGen'}});
    return provider.fetch(request,env,ctx);
  },
};
