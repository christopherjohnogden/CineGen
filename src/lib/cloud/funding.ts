import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { cloudDb, cloudFunctions } from './firebase';
import { getModelDefinition } from '@/lib/fal/models';

export type FundedProvider = 'fal' | 'higgsfield';

export interface ProjectFundingStatus {
  enabled: boolean;
  providers: FundedProvider[];
  monthlyLimit: number;
  used: number;
  month: string;
  role: 'owner' | 'editor';
  ownerId: string;
}

export interface WorkflowRunParams {
  apiKey?: string;
  kieKey?: string;
  runpodKey?: string;
  runpodEndpointId?: string;
  podUrl?: string;
  nodeId: string;
  nodeType: string;
  modelId: string;
  outputType?: 'image' | 'video' | 'audio' | 'text' | '3d';
  inputs: Record<string, unknown>;
}

function topviewMediaInputs(inputs: Record<string, unknown>, outputType: string): Array<{ value: string; role: string }> {
  const media: Array<{ value: string; role: string }> = [];
  const add = (value: unknown, role: string) => {
    if (typeof value === 'string' && value.trim()) media.push({ value: value.trim(), role });
    if (Array.isArray(value)) value.forEach((entry) => add(entry, role));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (typeof record.value === 'string') add(record.value, typeof record.role === 'string' ? record.role : role);
    }
  };
  add(inputs.medias, 'image');
  add(inputs.image_urls, 'image');
  add(inputs.input_image_urls, 'image');
  add(inputs.reference_images, 'image');
  add(inputs.image_url, outputType === 'video' ? 'start_image' : 'image');
  add(inputs.first_frame, 'start_image');
  add(inputs.first_frame_url, 'start_image');
  add(inputs.end_frame, 'end_image');
  add(inputs.end_frame_url, 'end_image');
  return media.filter((entry, index, all) => all.findIndex((candidate) => (
    candidate.value === entry.value && candidate.role === entry.role
  )) === index);
}

async function runTopviewWorkflow(params: WorkflowRunParams): Promise<unknown> {
  const model = getModelDefinition(params.nodeType);
  if (!model || model.provider !== 'topview') throw new Error('Topview model configuration is unavailable.');
  const prompt = String(params.inputs.prompt ?? '').trim();
  if (!prompt) throw new Error('Connect a prompt before running this Topview model.');
  const medias = topviewMediaInputs(params.inputs, model.outputType);
  const requestedModel = typeof params.inputs.model === 'string' ? params.inputs.model : 'auto';
  if (model.outputType === 'image') {
    return window.electronAPI.topview.generateImage({
      prompt,
      model: requestedModel,
      aspectRatio: typeof params.inputs.aspect_ratio === 'string' ? params.inputs.aspect_ratio : undefined,
      resolution: typeof params.inputs.resolution === 'string' ? params.inputs.resolution : undefined,
      generateCount: typeof params.inputs.generate_count === 'number' ? params.inputs.generate_count : 1,
      medias,
    });
  }
  if (model.outputType === 'video') {
    const duration = Number(params.inputs.duration ?? params.inputs.durationSec ?? 5);
    return window.electronAPI.topview.generate({
      prompt,
      model: requestedModel,
      durationSec: Number.isFinite(duration) ? duration : 5,
      aspectRatio: typeof params.inputs.aspect_ratio === 'string' ? params.inputs.aspect_ratio : undefined,
      resolution: typeof params.inputs.resolution === 'string' ? params.inputs.resolution : undefined,
      generateAudio: params.inputs.generate_audio === undefined ? undefined : Boolean(params.inputs.generate_audio),
      medias,
    });
  }
  throw new Error('Topview currently supports image and video nodes, not this node type.');
}

let activeProjectId = '';

export function setActiveFundingProject(projectId: string | null): void {
  activeProjectId = projectId ?? '';
}

function callableErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^FirebaseError:\s*/i, '');
  return String(error);
}

export async function getProjectFundingStatus(projectId: string): Promise<ProjectFundingStatus> {
  const call = httpsCallable<{ projectId: string }, ProjectFundingStatus>(cloudFunctions, 'getProjectFundingStatus');
  return (await call({ projectId })).data;
}

export async function configureProjectFunding(input: {
  projectId: string;
  enabled: boolean;
  monthlyLimit: number;
  shareFal: boolean;
  falKey?: string;
  higgsfieldRelay: boolean;
}): Promise<void> {
  const call = httpsCallable<typeof input, { ok: boolean }>(cloudFunctions, 'configureProjectFunding');
  await call(input);
  window.dispatchEvent(new CustomEvent('cinegen:funding-changed', { detail: { projectId: input.projectId } }));
}

function fundedProviderForFailure(params: WorkflowRunParams, error: unknown): FundedProvider | null {
  const message = callableErrorMessage(error).toLowerCase();
  if (
    message.includes('no fal.ai api key')
    || (!params.apiKey && params.modelId.startsWith('fal-ai/'))
  ) return 'fal';
  if (
    params.nodeType.startsWith('hf-')
    || message.includes('connect higgsfield')
    || message.includes('higgsfield generate is only available')
    || message.includes('higgsfield session')
  ) return 'higgsfield';
  return null;
}

function waitForRelayJob(jobId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      callback();
    };
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('The owner’s Higgsfield relay did not answer. Their CineGen desktop app must have this project open.')));
    }, 15 * 60_000);
    unsubscribe = onSnapshot(doc(cloudDb, 'projectFundingJobs', jobId), (snapshot) => {
      const data = snapshot.data();
      if (data?.status === 'complete') finish(() => resolve(data.result));
      if (data?.status === 'error') finish(() => reject(new Error(String(data.error ?? 'The owner-funded generation failed.'))));
    }, (error) => finish(() => reject(error)));
  });
}

async function runFunded(projectId: string, provider: FundedProvider, params: WorkflowRunParams): Promise<unknown> {
  const call = httpsCallable<
    { projectId: string; provider: FundedProvider; params: Omit<WorkflowRunParams, 'apiKey' | 'kieKey' | 'runpodKey' | 'podUrl'> },
    { result?: unknown; pendingRelay?: boolean; jobId?: string }
  >(cloudFunctions, 'runFundedGeneration', { timeout: 10 * 60_000 });
  const safeParams = {
    nodeId: params.nodeId,
    nodeType: params.nodeType,
    modelId: params.modelId,
    outputType: params.outputType,
    inputs: params.inputs,
  };
  const response = (await call({ projectId, provider, params: safeParams })).data;
  if (response.pendingRelay && response.jobId) return waitForRelayJob(response.jobId);
  return response.result;
}

export async function runWorkflow(params: WorkflowRunParams): Promise<unknown> {
  if (getModelDefinition(params.nodeType)?.provider === 'topview') {
    return runTopviewWorkflow(params);
  }
  try {
    return await window.electronAPI.workflow.run(params);
  } catch (localError) {
    const provider = fundedProviderForFailure(params, localError);
    if (!activeProjectId || !provider) throw localError;
    try {
      return await runFunded(activeProjectId, provider, params);
    } catch (fundedError) {
      throw new Error(callableErrorMessage(fundedError), { cause: fundedError });
    }
  }
}
