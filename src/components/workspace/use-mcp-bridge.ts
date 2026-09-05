import { prepareElementReferences } from '@/lib/cloud/elements';
import { buildElementDraft, type ElementBuildRequest } from '@/lib/elements/build-element';
import type { Element } from '@/types/elements';
import { flushSync } from 'react-dom';
import { useEffect, useRef } from 'react';
import { executeFromNode, type WorkflowDispatch } from '@/lib/workflows/execute';
import { createMcpHandlers } from '@/lib/mcp/handlers';
import { invokeMcpCommand } from '@/lib/mcp/app-commands';
import type { McpAction, McpHost, McpHostState } from '@/lib/mcp/types';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';

interface McpBridgeApi {
  onInvoke?: (handler: (payload: { id: string; tool: string; args?: Record<string, unknown> }) => void) => () => void;
  respond?: (payload: { id: string; ok: boolean; result?: unknown; error?: string }) => void;
  ready?: (ready: boolean) => void;
}
interface Job { id: string; action: string; status: 'running' | 'complete' | 'failed'; result?: unknown; error?: string }

export function useMcpBridge(
  state: McpHostState,
  dispatch: (action: McpAction) => void,
  options: { projectId?: string; projectName?: string; ready?: boolean; reduce?: (state: McpHostState, action: McpAction) => McpHostState } = {},
): () => boolean {
  const hostRef = useRef<McpHost | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const drafts = useRef(new Map<string, { element: Element; original?: string; existingId?: string; durable: boolean; approved: boolean }>());
  const jobs = useRef(new Map<string, Job>());
  const send = (action: McpAction) => {
    // React batches updates: sequential tools and multi-node batches must see their own writes.
    if (options.reduce) stateRef.current = options.reduce(stateRef.current, action);
    flushSync(() => dispatch(action));
  };
  const workflowDispatch = (): WorkflowDispatch => ({
    setNodeRunning: (nodeId, running) => send({ type: 'SET_NODE_RUNNING', nodeId, running }),
    setNodeResult: (nodeId, result) => send({ type: 'SET_NODE_RESULT', nodeId, result }),
    addGeneration: (nodeId, url) => send({ type: 'ADD_GENERATION', nodeId, url }),
    addAsset: (asset) => send({ type: 'ADD_ASSET', asset: { ...asset, thumbnailUrl: asset.url } }),
    getElements: () => stateRef.current.elements,
  });

  const approveDraft = (jobId: string) => {
    const draft = drafts.current.get(jobId);
    if (!draft?.durable) throw new Error('The Element draft is not ready. Wait for its build to complete.');
    if (draft.approved) return { element: draft.element, approved: true };
    const current = stateRef.current.elements.find(element => element.id === draft.existingId);
    if (draft.existingId && JSON.stringify(current) !== draft.original) throw new Error('This Element changed during the build. Read it and build a new draft to avoid overwriting edits.');
    if (draft.existingId) send({ type: 'UPDATE_ELEMENT', elementId: draft.existingId, updates: draft.element });
    else send({ type: 'ADD_ELEMENT', element: draft.element });
    draft.approved = true;
    const result = { element: draft.element, approved: true };
    const job = jobs.current.get(jobId); if (job) job.result = result;
    return result;
  };

  hostRef.current = {
    getState: () => stateRef.current,
    dispatch: send,
    projectName: options.projectName,
    runNode: (nodeId, nodes, edges) => {
      const adapter = workflowDispatch();
      void executeFromNode(nodeId, nodes, edges, adapter).catch((error: unknown) => {
        adapter.setNodeRunning(nodeId, false);
        adapter.setNodeResult(nodeId, { status: 'error', error: error instanceof Error ? error.message : 'Generation failed.' });
      });
    },
    appAction: async (action, args) => {
      if (action === 'jobs') {
        if (args.jobId) {
          const job = jobs.current.get(String(args.jobId));
          if (!job) throw new Error('Unknown MCP job ID.');
          return { ...job };
        }
        return [...jobs.current.values()].map(job => ({ ...job }));
      }
      if (action === 'persist_element') {
        if (!options.projectId) throw new Error('Open a project before saving references.');
        return prepareElementReferences(args.element as Element, options.projectId);
      }
      if (action === 'approve_element') return approveDraft(String(args.jobId));
      if (action === 'build_element') {
        if (!options.projectId) throw new Error('Open a project before building an Element.');
        const existing = args.elementId ? stateRef.current.elements.find(element => element.id === args.elementId) : undefined;
        if (args.elementId && !existing) throw new Error('Unknown Element ID.');
        if ([...jobs.current.values()].some(job => job.status === 'running')) throw new Error('Wait for the current MCP job to finish before starting another build.');
        const job: Job = { id: crypto.randomUUID(), action: 'build_element', status: 'running' };
        jobs.current.set(job.id, job);
        void buildElementDraft(args as unknown as ElementBuildRequest, existing, options.projectId, element => {
          job.result = { element, approved: false, building: true };
        }).then(element => {
          drafts.current.set(job.id, { element, original: existing ? JSON.stringify(existing) : undefined, existingId: existing?.id, durable: true, approved: false });
          job.result = args.approve === true ? approveDraft(job.id) : { element, approved: false, readyForApproval: true };
          job.status = 'complete';
        }).catch(error => { job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error); });
        return { ...job };
      }
      if (action === 'view') return invokeMcpCommand('view', args);
      if (action === 'extract_media') {
        const asset = stateRef.current.assets.find(asset => asset.id === args.assetId);
        if (!asset) throw new Error('Unknown asset.');
        const api = window.electronAPI?.media;
        if (!api) throw new Error('Media extraction requires CineGen Desktop.');
        if (asset.type === 'image') throw new Error('Choose a video or audio source.');
        if (args.kind === 'frame' && asset.type !== 'video') throw new Error('Frame extraction requires video.');
        const inputPath = asset.fileRef || asset.url;
        const start = Number(args.startSec);
        if (asset.duration && start >= asset.duration) throw new Error('Start is beyond the source duration.');
        if (args.kind === 'clip' && !(Number(args.durationSec) > 0)) throw new Error('durationSec is required for clips.');
        const result = args.kind === 'frame'
          ? await api.extractFrame({ inputPath, timeSec: start })
          : await api.extractClip({ inputPath, startTimeSec: start, durationSec: Number(args.durationSec) });
        if (!result?.outputPath) throw new Error('Media extraction returned no output file.');
        const created = { id: crypto.randomUUID(), name: String(args.name ?? `${asset.name} ${args.kind}`), type: args.kind === 'frame' ? 'image' as const : asset.type, url: result.outputPath, fileRef: result.outputPath, createdAt: new Date().toISOString(), ...(args.kind === 'clip' ? { duration: Number(args.durationSec) } : {}) };
        send({ type: 'ADD_ASSET', asset: created }); return created;
      }
      if (action === 'export') {
        const api = window.electronAPI?.export;
        if (!api) throw new Error('Export requires CineGen Desktop.');
        if (args.action === 'poll' || args.action === 'cancel') {
          const id = String(args.jobId ?? '');
          if (!stateRef.current.exports?.some(job => job.id === id)) throw new Error('Unknown export job ID.');
          if (args.action === 'cancel') await api.cancel(id);
          const job = await api.poll(id);
          send({ type: 'UPDATE_EXPORT', exportId: id, updates: job }); return job;
        }
        const current = stateRef.current;
        const timeline = current.timelines.find(t => t.id === (args.timelineId ?? current.activeTimelineId));
        if (!timeline) throw new Error('Unknown timeline.');
        const clips = timeline.clips.map(clip => {
          const asset = current.assets.find(a => a.id === clip.assetId);
          if (!asset || !(asset.fileRef || asset.url)) throw new Error(`Missing media for ${clip.name}.`);
          return { inputPath: asset.fileRef || asset.url, startTime: clip.startTime, duration: clipEffectiveDuration(clip), trimStart: clip.trimStart, speed: clip.speed || 1, volume: clip.volume ?? 1, type: asset.type };
        });
        if (!clips.length) throw new Error('Timeline has no clips to export.');
        const job = await api.start({ preset: (args.preset as 'draft' | 'standard' | 'high') ?? 'standard', fps: (args.fps as number) ?? 24, clips, totalDuration: Math.max(timeline.duration, ...timeline.clips.map(clipEndTime)) });
        send({ type: 'ADD_EXPORT', exportJob: job }); return job;
      }
      if (action === 'director') {
        const interrupt = ['stop_shotlist', 'cancel_look_bible', 'cancel_staging'].includes(String(args.action));
        if (!interrupt && [...jobs.current.values()].some(job => job.status === 'running')) throw new Error('A Director MCP action is still running. Poll cinegen_get_jobs first.');
        send({ type: 'SET_TAB', tab: 'director' });
        const job: Job = { id: crypto.randomUUID(), action: String(args.action), status: 'running' };
        jobs.current.set(job.id, job);
        void invokeMcpCommand('director', args).then(result => { job.status = 'complete'; job.result = result; }, error => { job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error); });
        return { ...job };
      }
      throw new Error(`Unknown app action ${action}.`);
    },
  };

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { mcpBridge?: McpBridgeApi } }).electronAPI?.mcpBridge;
    if (!api?.onInvoke || !api.respond) return undefined;
    api.ready?.(options.ready !== false);
    // Serialize writes; each response is sent after its handler has completed.
    let pending = Promise.resolve();
    let disposed = false;
    const stop = api.onInvoke(({ id, tool, args }) => {
      if (tool === 'cinegen_project') return; // Owned by App, including at the project launcher.
      pending = pending.then(async () => {
        try {
          if (disposed) throw new Error('The project was closed.');
          if (options.ready === false) throw new Error('The project is still loading. Retry after it opens.');
          const host = hostRef.current;
          if (!host) throw new Error('CineGen is still starting up.');
          const handler = createMcpHandlers(host)[tool];
          if (!handler) throw new Error(`CineGen has no tool called "${tool}".`);
          api.respond?.({ id, ok: true, result: await handler(args ?? {}) });
        } catch (error) {
          api.respond?.({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    });
    return () => { disposed = true; api.ready?.(false); stop(); };
  }, [options.ready]);
  return () => [...jobs.current.values()].some(job => job.status === 'running');
}
