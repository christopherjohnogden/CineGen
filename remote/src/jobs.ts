import { GeneratedMediaDownloadError, isTopviewSignedDownload, persistGeneratedMedia, generatedMediaLocation } from '../../shared/generated-media.mjs';
import { prepareProviderGeneration, providerRpc } from './providers';
import { DurableObject } from 'cloudflare:workers';
import { MODEL_REGISTRY, resolveVideoModelEndpoint, sanitizeVideoInputsForEndpoint } from '../../src/lib/fal/models';
import { CloudStore, refreshIdentity, type Identity, type RecordValue } from './firebase';
import { hydrate, serialize } from './headless';
import { createWorkflowNodeFromSpec } from '../../src/lib/llm/space-node-factory';
import { captureGenerationMetadata } from '../../src/lib/studio/generation-metadata';

export const generationTools = [
  {name:'cinegen_list_models',description:'List connected Topview models and input fields by default. Seedance 2.5 supports image, video, and audio references; audio input is separate from generated sound. Use provider higgsfield ONLY when the user explicitly requests Higgsfield. Uses the existing CineGen website provider connections; no fal key is needed.',inputSchema:{type:'object' as const,properties:{provider:{type:'string',enum:['topview','higgsfield'],description:'Defaults to topview. Higgsfield only on explicit user request.'},kind:{type:'string',enum:['image','video']}},additionalProperties:false}},
  {name:'cinegen_generate',description:'Generate an image or video in Spaces STUDIO mode (not Canvas). Results carry Studio metadata and are saved to the project and Studio feed even after you close chat. Uses Topview by default and its existing CineGen connection and credits. Use provider higgsfield ONLY when explicitly requested; never fall back automatically. No fal key is required. Call cinegen_list_models first. Reuse requestId when retrying the same request; use a new ID only for a deliberately new generation.',inputSchema:{type:'object' as const,properties:{provider:{type:'string',enum:['topview','higgsfield'],description:'Defaults to topview; use higgsfield only if the user explicitly asks.'},projectId:{type:'string'},spaceId:{type:'string'},requestId:{type:'string',description:'A unique ID for this logical generation, reused on retries.'},model:{type:'string',description:'Exact nodeType from cinegen_list_models.'},elementIds:{type:'array',items:{type:'string'},description:'Referenced character Element IDs. Automatically includes their saved voice direction in video prompts. Pass images/audio separately through the model input fields.'},inputs:{type:'object',description:'For Seedance 2.5 Clip Edit: video_mode="edit", source_video=one MP4/MOV URL (720p or larger), resolution="1080". Length and framing match the source. Other input values use advertised field IDs. For Seedance 2.5, use prompt plus image_url: [image/video URLs] and audio_references: [MP3/WAV audio URLs]. Combine audio with at least one image or video when audioReferenceConnection.requiresVisualReference is true. All three reference types can be combined. Audio guidance is separate from generate_audio.'}},required:['projectId','requestId','model','inputs'],additionalProperties:false}},
  {name:'cinegen_get_jobs',description:'Read a durable generation job. A completed job has already saved its media and project. Polling is optional; the job runs without a client. If a finished provider result failed to save, checking this job resumes saving that same result without a new generation or charge.',inputSchema:{type:'object' as const,properties:{projectId:{type:'string'},requestId:{type:'string'}},required:['projectId','requestId'],additionalProperties:false}},
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
interface Job extends RecordValue { identity:Identity & {falKey?:string}; prepared?:ReturnType<typeof prepareProviderGeneration>; args:RecordValue; status:string; nodeId:string; createdAt:string; attempts:number }
function publicJob(j:Job) { return {requestId:j.args.requestId,projectId:j.args.projectId,nodeId:j.nodeId,status:j.status,provider:j.args.provider??'fal',createdAt:j.createdAt,url:j.url??null,error:j.error??null}; }
function falUrl(value:string) { const url=new URL(value);if(url.origin!=='https://queue.fal.run')throw new Error('Invalid provider response URL.');return url.href; }

export { downloadGeneratedMedia } from '../../shared/generated-media.mjs';

async function persistMedia(source:string, store:CloudStore, ownerId:string, projectId:string, assetId:string, type:string, provider = 'fal') {
  try {
    return await persistGeneratedMedia({source, token:store.token, ownerId, projectId, assetId, type, provider});
  } catch(error) {
    // Topview's signed Canvas assets can be refused specifically from Workers.
    // Transfer the same asset via Node immediately; never submit a generation.
    if(provider!=='topview' || !(error instanceof GeneratedMediaDownloadError)
      || error.status!==403 || !isTopviewSignedDownload(source)) throw error;
    const response=await fetch('https://cinegen-film.vercel.app/api/generated-media/save', {
      method:'POST',headers:{authorization:`Bearer ${store.token}`,'content-type':'application/json'},
      body:JSON.stringify({source,ownerId,projectId,assetId,type}),
      redirect:'manual',signal:AbortSignal.timeout(240000),
    });
    const saved=await response.json() as RecordValue;
    if(!response.ok || !saved.ok) throw new Error(saved.error?.message || `Saving generated media failed (${response.status}).`);
    const expected=generatedMediaLocation(ownerId,projectId,assetId,type).objectUrl;
    const url=new URL(saved.result?.url);
    if(url.origin+url.pathname!==expected || url.searchParams.get('alt')!=='media' || !url.searchParams.get('token')) {
      throw new Error('Media transfer returned an unexpected saved location.');
    }
    return url.href;
  }
}

export class GenerationJob extends DurableObject {
  async fetch(request:Request) {
    return this.ctx.blockConcurrencyWhile(()=>this.handleRequest(request));
  }
  private async handleRequest(request:Request) {
    const body=await request.json() as {identity:Job['identity'];args:RecordValue;prepared?:Job['prepared']};
    let job=await this.ctx.storage.get<Job>('job');
    if(job && job.identity.uid!==body.identity.uid) return new Response('Forbidden',{status:403});
    if(new URL(request.url).pathname==='/snapshot') {
      // Viewing a result must not retry persistence, schedule alarms or submit jobs.
      return Response.json(job?{...publicJob(job),kind:job.prepared?.model.outputType??'image'}:{status:'not_found'});
    }
    if(new URL(request.url).pathname==='/read') {
      // A provider result already exists: refresh authorization and retry only
      // persistence. Never reopen queued/submitting jobs or send another paid request.
      if(job && job.sourceUrl && ['needs_attention','failed'].includes(job.status) && body.identity.refreshToken) {
        job.identity=body.identity;job.status='saving';job.attempts=0;job.refreshSource=true;
        await this.ctx.storage.put('job',job);
        await this.ctx.storage.setAlarm(Date.now()+100);
      }
      return Response.json(job?publicJob(job):{status:'not_found'});
    }
    if(job) {
      if(JSON.stringify(job.args)!==JSON.stringify(body.args)) return Response.json({error:'This requestId was already used with different inputs.'},{status:409});
      return Response.json(publicJob(job));
    }
    if(body.args.provider) prepareProviderGeneration(body.args, body.prepared ? [body.prepared.model] : undefined);
    else prepareGeneration(body.args); // Only legacy callers/jobs use fal; the public MCP always supplies provider.
    job={identity:body.identity,args:body.args,nodeId:crypto.randomUUID(),createdAt:new Date().toISOString(),status:'queued',attempts:0,...(body.prepared?{prepared:body.prepared}:{})};
    await this.ctx.storage.setAlarm(Date.now()+100);
    await this.ctx.storage.put('job',job);
    return Response.json(publicJob(job));
  }
  async alarm() {
    const job=await this.ctx.storage.get<Job>('job'); if(!job||['complete','failed','needs_attention'].includes(job.status))return;
    try {
      const auth=await refreshIdentity(job.identity.refreshToken);if(auth.uid!==job.identity.uid)throw new Error('Connection identity changed.');
      job.identity.refreshToken=auth.refreshToken;
      const store=new CloudStore(auth.token,auth.uid);const prepared=job.args.provider ? (job.prepared ?? prepareProviderGeneration(job.args)) : prepareGeneration(job.args);
      if(job.status==='submitting') {job.status='needs_attention';job.error='Submission was interrupted. Check your provider history before starting another generation to avoid a duplicate charge.';}
      else if(job.status==='queued') {
        const loaded=await store.load(job.args.projectId);const state=hydrate(loaded.state,loaded.library,loaded.metadata.useSqlite!==false);
        const space=state.spaces.find(s=>s.id===(job.args.spaceId??state.activeSpaceId));if(!space)throw new Error('Destination Space was removed.');
        const references = 'params' in prepared ? prepared.params.medias.filter((m:RecordValue)=>!['start_image','end_image'].includes(m.role)).map((m:RecordValue)=>m.value) : [];
        const node=createWorkflowNodeFromSpec({nodeType:prepared.model.nodeType,label:prepared.model.name,config:{...prepared.config,__studioGenerated:true,__studioCreatedAt:job.createdAt,__studioOutputType:prepared.model.outputType,__studioPrompt:prepared.config.prompt??'',__studioPromptBody:prepared.config.prompt??'',...(references.length?{__studioVideoMode:prepared.config.video_mode==='edit'?'edit':'references',__studioAttachedRefs:references}:{})}},{x:space.nodes.length*40,y:0});
        node.id=job.nodeId;node.data.result={status:'running'};
        if(!space.nodes.some(n=>n.id===node.id))space.nodes=[...space.nodes,node];
        if(space.id===state.activeSpaceId)state.nodes=space.nodes;
        await store.save(loaded,serialize(loaded.state,state,loaded.metadata.useSqlite!==false));
        job.status='submitting';await this.ctx.storage.put('job',job);
        // A watchdog marks an interrupted/ambiguous submission without ever replaying a paid POST.
        await this.ctx.storage.setAlarm(Date.now()+(job.args.provider?300000:60000));
        if(job.args.provider) {
          const result=await providerRpc(auth.token,job.args.provider,'generate',{...(prepared as NonNullable<Job['prepared']>).params,commandId:`cinegen-${job.nodeId}`});
          if(result.url){job.sourceUrl=result.url;job.status='saving';}
          else if(result.taskId && job.args.provider==='topview') {job.providerTask={taskId:result.taskId,taskType:result.taskType,model:result.model,boardId:result.boardId,outputType:prepared.model.outputType,waitForCompletion:false};job.status='running';}
          else if(result.jobId && job.args.provider==='higgsfield') {job.providerTask={jobId:result.jobId,model:result.model,outputType:prepared.model.outputType,wait:false};job.status='running';}
          else {job.status='needs_attention';job.error='Provider did not return a resumable task or finished media. Check provider history before retrying.';}
          if(result.status==='fail'){job.status='failed';job.error=result.error||'Provider generation failed.';}
        } else {
        const r=await fetch(`https://queue.fal.run/${(prepared as ReturnType<typeof prepareGeneration>).endpoint}`,{method:'POST',headers:{authorization:`Key ${job.identity.falKey}`,'content-type':'application/json'},body:JSON.stringify((prepared as ReturnType<typeof prepareGeneration>).inputs),signal:AbortSignal.timeout(45000)});
        if(!r.ok){job.status=r.status>=500?'needs_attention':'failed';job.error=`Provider submission returned ${r.status}. Check fal.ai before retrying.`;}
        else {const submitted=await r.json() as RecordValue;job.statusUrl=falUrl(submitted.status_url);job.responseUrl=falUrl(submitted.response_url);job.providerRequestId=submitted.request_id;job.status='running';}
        }
      } else if(job.status==='running') {
        if(job.args.provider==='topview' || job.args.provider==='higgsfield') {
          const result=await providerRpc(auth.token,job.args.provider,'generate',job.providerTask);
          if(result.status==='fail') {job.status='failed';job.error=result.error||'Provider generation failed.';}
          else if(result.url){job.sourceUrl=result.url;job.status='saving';}
        } else {
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
      }
      if(job.status==='saving') {
        let loaded=await store.load(job.args.projectId);
        const savingState=hydrate(loaded.state,loaded.library,loaded.metadata.useSqlite!==false);
        const savingSpace=savingState.spaces.find(s=>s.nodes.some(n=>n.id===job.nodeId));
        const savingNode=savingSpace?.nodes.find(n=>n.id===job.nodeId);
        const progressMessage='Saving generated media…';
        if(savingNode && savingNode.data.result?.progressMessage!==progressMessage) {
          savingNode.data.result={status:'running',progressStage:'saving',progressMessage,...(job.error?{error:job.error}:{})};
          if(savingSpace!.id===savingState.activeSpaceId)savingState.nodes=savingSpace!.nodes;
          await store.save(loaded,serialize(loaded.state,savingState,loaded.metadata.useSqlite!==false));
        }
        if(!job.url) {
          let sources=[job.sourceUrl];
          if(job.args.provider==='topview' && job.providerTask && (job.attempts>0||job.refreshSource)) {
            const refreshed=await providerRpc(auth.token,'topview','generate',job.providerTask);
            const fresh=[...new Set([refreshed.url,...(Array.isArray(refreshed.urls)?refreshed.urls:[])].filter((url):url is string=>typeof url==='string'&&url.startsWith('https://')))];
            if(fresh.length){sources=fresh;job.sourceUrl=fresh[0];await this.ctx.storage.put('job',job);}
          }
          for(let index=0;index<sources.length;index++) {
            try {job.url=await persistMedia(sources[index],store,loaded.ownerId,job.args.projectId,job.nodeId,prepared.model.outputType,job.args.provider??'fal');job.sourceUrl=sources[index];break;}
            catch(error) {
              if(!(error instanceof Error)||!error.message.startsWith('Generated media')||index===sources.length-1)throw error;
            }
          }
        }
        await this.ctx.storage.put('job',job);
        // Reload after uploading: another client may have edited the timeline while the file transferred.
        loaded=await store.load(job.args.projectId);const state=hydrate(loaded.state,loaded.library,loaded.metadata.useSqlite!==false);
        const space=state.spaces.find(s=>s.nodes.some(n=>n.id===job.nodeId));
        if(!space)throw new Error('Generation destination was removed. The generated file is saved; restore the Space or import the job URL.');
        const node=space.nodes.find(n=>n.id===job.nodeId)!;
        node.data.result={status:'complete',url:job.url};node.data.generations=[...new Set([...(node.data.generations??[]),job.url])];
        if(space.id===state.activeSpaceId)state.nodes=space.nodes;
        if(!state.assets.some(a=>a.id===job.nodeId))state.assets.push({id:job.nodeId,name:`${prepared.model.name} generation`,type:prepared.model.outputType as 'image'|'video',url:job.url,fileRef:job.url,thumbnailUrl:prepared.model.outputType==='image'?job.url:undefined,createdAt:job.createdAt,
          metadata:{generatedVia:'studio-generation',sourceNodeId:job.nodeId,generation:{...captureGenerationMetadata({...node,data:{...node.data,config:prepared.config}},prepared.model,{nodes:[],edges:[]},state,job.url),
            ...(job.providerTask?.taskId?{providerTaskId:job.providerTask.taskId}:{})}}});
        await store.save(loaded,serialize(loaded.state,state,loaded.metadata.useSqlite!==false));job.status='complete';delete job.error;
      }
      if(job.status==='running'&&Date.now()-Date.parse(job.createdAt)>24*3600000){job.status='needs_attention';job.error='Generation has been pending for more than 24 hours. Check the provider before retrying.';}
      job.attempts=0;
    } catch(e) {
      job.attempts++;job.error=e instanceof Error?e.message:'Generation interrupted.';
      if(job.status==='submitting'||job.attempts>=12)job.status='needs_attention';
    }
    if(['failed','needs_attention'].includes(job.status) || (job.status==='saving'&&job.error)) {
      try {
        const auth=await refreshIdentity(job.identity.refreshToken);
        if(auth.uid!==job.identity.uid)throw new Error('Identity changed');
        const store=new CloudStore(auth.token,auth.uid), loaded=await store.load(job.args.projectId);
        const state=hydrate(loaded.state,loaded.library,loaded.metadata.useSqlite!==false);
        const space=state.spaces.find(s=>s.nodes.some(n=>n.id===job.nodeId));
        if(space){space.nodes.find(n=>n.id===job.nodeId)!.data.result=job.status==='saving' ? {status:'running',progressStage:'saving',progressMessage:'Generation finished. Retrying save…',error:job.error} : {status:'error',progressStage:job.status,error:job.error};if(space.id===state.activeSpaceId)state.nodes=space.nodes;await store.save(loaded,serialize(loaded.state,state,loaded.metadata.useSqlite!==false));}
      }catch{/* The job status remains available even if project access was revoked. */}
    }
    if(['complete','failed','needs_attention'].includes(job.status)) { job.identity={...job.identity,refreshToken:'',falKey:''}; }
    console.info('generation_progress', { requestId: job.args.requestId, nodeId: job.nodeId, status: job.status, attempts: job.attempts, hasSource: Boolean(job.sourceUrl), providerTaskId: job.providerTask?.taskId, sourcePath: job.sourceUrl ? new URL(job.sourceUrl).pathname : undefined, sourceQueryKeys: job.sourceUrl ? [...new URL(job.sourceUrl).searchParams.keys()] : [], hasSavedMedia: Boolean(job.url), error: typeof job.error === 'string' ? job.error.replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 500) : undefined });
    await this.ctx.storage.put('job',job);
    if(!['complete','failed','needs_attention'].includes(job.status))await this.ctx.storage.setAlarm(Date.now()+(job.status==='running'?5000:30000));
  }
}
