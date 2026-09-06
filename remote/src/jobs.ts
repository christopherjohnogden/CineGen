import { DurableObject } from 'cloudflare:workers';
import { MODEL_REGISTRY, resolveVideoModelEndpoint, sanitizeVideoInputsForEndpoint } from '../../src/lib/fal/models';
import { CloudStore, refreshIdentity, type Identity, type RecordValue } from './firebase';
import { hydrate, serialize } from './headless';
import { createWorkflowNodeFromSpec } from '../../src/lib/llm/space-node-factory';

export const generationTools = [
  {name:'cinegen_list_models',description:'List the fal.ai models available for unattended cloud generation and their exact input fields. A fal.ai key must be connected during CineGen authorization.',inputSchema:{type:'object' as const,properties:{kind:{type:'string',enum:['image','video']}},additionalProperties:false}},
  {name:'cinegen_generate',description:'Generate an image or video in Spaces STUDIO mode (not Canvas). Results carry Studio metadata and are saved to the project and Studio feed even after you close chat. May spend fal.ai credits. Call cinegen_list_models first. Reuse requestId when retrying the same request; use a new ID only for a deliberately new generation.',inputSchema:{type:'object' as const,properties:{projectId:{type:'string'},spaceId:{type:'string'},requestId:{type:'string',description:'A unique ID for this logical generation, reused on retries.'},model:{type:'string',description:'Exact nodeType from cinegen_list_models.'},inputs:{type:'object',description:'Input values keyed by the advertised field IDs, including prompt and optional reference URLs.'}},required:['projectId','requestId','model','inputs'],additionalProperties:false}},
  {name:'cinegen_get_jobs',description:'Read a durable generation job. A completed job has already saved its media and project. Polling is optional; the job runs without a client.',inputSchema:{type:'object' as const,properties:{projectId:{type:'string'},requestId:{type:'string'}},required:['projectId','requestId'],additionalProperties:false}},
];
export function models(kind?:unknown) {
  return Object.values(MODEL_REGISTRY).filter(m=>(!m.provider||m.provider==='fal') && ['image','video'].includes(m.outputType) && (!kind||m.outputType===kind) && m.id.startsWith('fal-ai/'));
}
export function prepareGeneration(args:RecordValue) {
  const model=models().find(m=>m.nodeType===args.model);
  if(!model) throw new Error('Choose an exact fal.ai model from cinegen_list_models.');
  if(!args.inputs||typeof args.inputs!=='object'||Array.isArray(args.inputs)) throw new Error('Model inputs are required.');
  const inputs:RecordValue={}; const config:RecordValue={};
  for(const key of Object.keys(args.inputs)) if(!model.inputs.some(f=>f.id===key)) throw new Error(`Unknown model input: ${key}`);
  for(const field of model.inputs) {
    let value=args.inputs[field.id]??field.default;
    if(value===undefined||value==='') {if(field.required) throw new Error(`Missing ${field.id}`);continue;}
    if(field.schemaType==='integer'||field.schemaType==='number'||field.fieldType==='range'||field.fieldType==='number') {
      value=Number(value); if(!Number.isFinite(value)||(field.schemaType==='integer'&&!Number.isInteger(value))) throw new Error(`Invalid number for ${field.id}`);
      if(field.min!==undefined&&value<field.min||field.max!==undefined&&value>field.max) throw new Error(`Out of range: ${field.id}`);
      if(field.id==='seed'&&value===-1) continue;
    }
    if(field.fieldType==='toggle'&&typeof value!=='boolean') throw new Error(`Expected true or false for ${field.id}`);
    if(field.options&&!field.options.some(o=>o.value===String(value))) throw new Error(`Unsupported value for ${field.id}`);
    if(field.portType==='image'||field.portType==='video'||field.portType==='audio') {
      const urls=Array.isArray(value)?value:[value];
      if(urls.some(u=>typeof u!=='string'||!u.startsWith('https://'))) throw new Error(`Use saved HTTPS media URLs for ${field.id}`);
    }
    config[field.id]=value; inputs[field.falParam]=value;
  }
  const endpoint=resolveVideoModelEndpoint(model.nodeType,model,{hasImageInputs:model.inputs.some(f=>f.portType==='image'&&Boolean(inputs[f.falParam])),quality:config.quality});
  sanitizeVideoInputsForEndpoint(model.nodeType,endpoint,inputs);
  if(!/^fal-ai\/[A-Za-z0-9._/-]+$/.test(endpoint)) throw new Error('Invalid model endpoint.');
  return {model,inputs,config,endpoint};
}
interface Job extends RecordValue { identity:Identity & {falKey:string}; args:RecordValue; status:string; nodeId:string; createdAt:string; attempts:number }
function publicJob(j:Job) { return {requestId:j.args.requestId,projectId:j.args.projectId,nodeId:j.nodeId,status:j.status,createdAt:j.createdAt,url:j.url??null,error:j.error??null}; }
function falUrl(value:string) { const url=new URL(value);if(url.origin!=='https://queue.fal.run')throw new Error('Invalid provider response URL.');return url.href; }

async function persistMedia(source:string,store:CloudStore,ownerId:string,projectId:string,assetId:string,type:string) {
  const url=new URL(source);
  if(url.protocol!=='https:'||!(url.hostname.endsWith('.fal.media')||url.hostname==='fal.media'||url.hostname.endsWith('.fal.ai'))) throw new Error('Provider returned an unsupported media location.');
  const bucket='cinegen-734ba.firebasestorage.app';
  const name=`users/${ownerId}/projects/${projectId}/media/${assetId}/generated.${type==='video'?'mp4':'png'}`;
  const root=`https://firebasestorage.googleapis.com/v0/b/${bucket}/o`;
  const existing=await fetch(`${root}/${encodeURIComponent(name)}`,{headers:{authorization:`Firebase ${store.token}`}});
  let metadata:RecordValue;
  if(existing.ok) metadata=await existing.json() as RecordValue;
  else {
    if(existing.status!==404) throw new Error(`Media storage is unavailable (${existing.status}).`);
    const media=await fetch(url.href,{redirect:'error'});
    if(!media.ok||!media.body) throw new Error('Generated media could not be downloaded.');
    if(Number(media.headers.get('content-length')??0)>90*1024*1024) throw new Error('Generated media exceeds the 90 MB cloud upload limit.');
    const contentType=media.headers.get('content-type')?.split(';')[0]||`${type}/${type==='video'?'mp4':'png'}`;
    if(!/^(image|video)\/[a-zA-Z0-9.+-]+$/.test(contentType)) throw new Error('Provider returned an unexpected media type.');
    const boundary=crypto.randomUUID(); const encoder=new TextEncoder();const reader=media.body.getReader();let phase=0;let bytes=0;
    const body=new ReadableStream({async pull(controller){
      if(phase===0){phase=1;controller.enqueue(encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({name,contentType,metadata:{projectId,assetId}})}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`));return;}
      const chunk=await reader.read();
      if(chunk.done){controller.enqueue(encoder.encode(`\r\n--${boundary}--`));controller.close();return;}
      bytes+=chunk.value.byteLength;if(bytes>90*1024*1024){await reader.cancel();controller.error(new Error('Generated media is too large.'));return;}controller.enqueue(chunk.value);
    },cancel(){return reader.cancel();}});
    const upload=await fetch(`${root}?name=${encodeURIComponent(name)}`,{method:'POST',headers:{authorization:`Firebase ${store.token}`,'X-Goog-Upload-Protocol':'multipart','content-type':`multipart/related; boundary=${boundary}`},body});
    if(!upload.ok) throw new Error(`Saving generated media failed (${upload.status}).`);
    metadata=await upload.json() as RecordValue;
  }
  if(!metadata.downloadTokens) throw new Error('Media was stored but its download URL is unavailable.');
  return `${root}/${encodeURIComponent(name)}?alt=media&token=${encodeURIComponent(metadata.downloadTokens.split(',')[0])}`;
}

export class GenerationJob extends DurableObject {
  async fetch(request:Request) {
    return this.ctx.blockConcurrencyWhile(()=>this.handleRequest(request));
  }
  private async handleRequest(request:Request) {
    const body=await request.json() as {identity:Job['identity'];args:RecordValue};
    let job=await this.ctx.storage.get<Job>('job');
    if(job && job.identity.uid!==body.identity.uid) return new Response('Forbidden',{status:403});
    if(new URL(request.url).pathname==='/read') return Response.json(job?publicJob(job):{status:'not_found'});
    if(job) {
      if(JSON.stringify(job.args)!==JSON.stringify(body.args)) return Response.json({error:'This requestId was already used with different inputs.'},{status:409});
      return Response.json(publicJob(job));
    }
    prepareGeneration(body.args);
    job={identity:body.identity,args:body.args,nodeId:crypto.randomUUID(),createdAt:new Date().toISOString(),status:'queued',attempts:0};
    await this.ctx.storage.setAlarm(Date.now()+100);
    await this.ctx.storage.put('job',job);
    return Response.json(publicJob(job));
  }
  async alarm() {
    const job=await this.ctx.storage.get<Job>('job'); if(!job||['complete','failed','needs_attention'].includes(job.status))return;
    try {
      const auth=await refreshIdentity(job.identity.refreshToken);if(auth.uid!==job.identity.uid)throw new Error('Connection identity changed.');
      job.identity.refreshToken=auth.refreshToken;
      const store=new CloudStore(auth.token,auth.uid);const prepared=prepareGeneration(job.args);
      if(job.status==='submitting') {job.status='needs_attention';job.error='Submission was interrupted. Check your fal.ai history before starting another generation to avoid a duplicate charge.';}
      else if(job.status==='queued') {
        const loaded=await store.load(job.args.projectId);const state=hydrate(loaded.state,loaded.library,loaded.metadata.useSqlite!==false);
        const space=state.spaces.find(s=>s.id===(job.args.spaceId??state.activeSpaceId));if(!space)throw new Error('Destination Space was removed.');
        const node=createWorkflowNodeFromSpec({nodeType:prepared.model.nodeType,label:prepared.model.name,config:{...prepared.config,__studioGenerated:true,__studioCreatedAt:job.createdAt,__studioOutputType:prepared.model.outputType,__studioPrompt:prepared.config.prompt??'',__studioPromptBody:prepared.config.prompt??''}},{x:space.nodes.length*40,y:0});
        node.id=job.nodeId;node.data.result={status:'running'};
        if(!space.nodes.some(n=>n.id===node.id))space.nodes=[...space.nodes,node];
        if(space.id===state.activeSpaceId)state.nodes=space.nodes;
        await store.save(loaded,serialize(loaded.state,state,loaded.metadata.useSqlite!==false));
        job.status='submitting';await this.ctx.storage.put('job',job);
        // A watchdog marks an interrupted/ambiguous submission without ever replaying a paid POST.
        await this.ctx.storage.setAlarm(Date.now()+60000);
        const r=await fetch(`https://queue.fal.run/${prepared.endpoint}`,{method:'POST',headers:{authorization:`Key ${job.identity.falKey}`,'content-type':'application/json'},body:JSON.stringify(prepared.inputs),signal:AbortSignal.timeout(45000)});
        if(!r.ok){job.status=r.status>=500?'needs_attention':'failed';job.error=`Provider submission returned ${r.status}. Check fal.ai before retrying.`;}
        else {const submitted=await r.json() as RecordValue;job.statusUrl=falUrl(submitted.status_url);job.responseUrl=falUrl(submitted.response_url);job.providerRequestId=submitted.request_id;job.status='running';}
      } else if(job.status==='running') {
        const r=await fetch(falUrl(job.statusUrl),{headers:{authorization:`Key ${job.identity.falKey}`}});
        if(!r.ok)throw new Error(`Provider status unavailable (${r.status}).`);
        const status=await r.json() as RecordValue;
        if(status.error){job.status='failed';job.error='The provider could not generate this media.';}
        else if(status.status==='COMPLETED') {
          const response=await fetch(falUrl(job.responseUrl),{headers:{authorization:`Key ${job.identity.falKey}`}});
          if(!response.ok)throw new Error(`Provider result unavailable (${response.status}).`);
          const result=await response.json() as RecordValue;
          let value:any=result;for(const key of prepared.model.responseMapping.path.replace(/\[(\d+)\]/g,'.$1').split('.').filter(Boolean))value=value?.[key];
          job.sourceUrl=typeof value==='string'?value:value?.url;
          if(!job.sourceUrl)throw new Error('Provider result contained no media URL.');
          job.status='saving';
        }
      }
      if(job.status==='saving') {
        let loaded=await store.load(job.args.projectId);
        job.url??=await persistMedia(job.sourceUrl,store,loaded.ownerId,job.args.projectId,job.nodeId,prepared.model.outputType);
        await this.ctx.storage.put('job',job);
        // Reload after uploading: another client may have edited the timeline while the file transferred.
        loaded=await store.load(job.args.projectId);const state=hydrate(loaded.state,loaded.library,loaded.metadata.useSqlite!==false);
        const space=state.spaces.find(s=>s.nodes.some(n=>n.id===job.nodeId));
        if(!space)throw new Error('Generation destination was removed. The generated file is saved; restore the Space or import the job URL.');
        const node=space.nodes.find(n=>n.id===job.nodeId)!;
        node.data.result={status:'complete',url:job.url};node.data.generations=[...new Set([...(node.data.generations??[]),job.url])];
        if(space.id===state.activeSpaceId)state.nodes=space.nodes;
        if(!state.assets.some(a=>a.id===job.nodeId))state.assets.push({id:job.nodeId,name:`${prepared.model.name} generation`,type:prepared.model.outputType as 'image'|'video',url:job.url,fileRef:job.url,thumbnailUrl:prepared.model.outputType==='image'?job.url:undefined,createdAt:job.createdAt});
        await store.save(loaded,serialize(loaded.state,state,loaded.metadata.useSqlite!==false));job.status='complete';delete job.error;
      }
      if(job.status==='running'&&Date.now()-Date.parse(job.createdAt)>24*3600000){job.status='needs_attention';job.error='Generation has been pending for more than 24 hours. Check the provider before retrying.';}
      job.attempts=0;
    } catch(e) {
      job.attempts++;job.error=e instanceof Error?e.message:'Generation interrupted.';
      if(job.status==='submitting'||job.attempts>=12)job.status='needs_attention';
    }
    if(['failed','needs_attention'].includes(job.status)) {
      try {
        const auth=await refreshIdentity(job.identity.refreshToken);
        if(auth.uid!==job.identity.uid)throw new Error('Identity changed');
        const store=new CloudStore(auth.token,auth.uid), loaded=await store.load(job.args.projectId);
        const state=hydrate(loaded.state,loaded.library,loaded.metadata.useSqlite!==false);
        const space=state.spaces.find(s=>s.nodes.some(n=>n.id===job.nodeId));
        if(space){space.nodes.find(n=>n.id===job.nodeId)!.data.result={status:'error',error:job.error};if(space.id===state.activeSpaceId)state.nodes=space.nodes;await store.save(loaded,serialize(loaded.state,state,loaded.metadata.useSqlite!==false));}
      }catch{/* The job status remains available even if project access was revoked. */}
    }
    if(['complete','failed','needs_attention'].includes(job.status)) { job.identity={...job.identity,refreshToken:'',falKey:''}; }
    await this.ctx.storage.put('job',job);
    if(!['complete','failed','needs_attention'].includes(job.status))await this.ctx.storage.setAlarm(Date.now()+30000);
  }
}
