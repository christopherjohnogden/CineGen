import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { cloudDb, cloudFunctions } from './firebase';
import { getModelDefinition } from '@/lib/fal/models';
import { topviewRequestedModel } from '@/lib/topview/model-catalog';
import { requestProviderUsageRefresh } from '@/lib/providers/project-usage';
import { isVideoGenerationProvider } from '@/lib/utils/video-generation-provider';
import type { TopviewVideoTaskState } from '@/types/workflow';
import {
  runTopviewVideoTask,
  type TopviewVideoTaskQuery,
} from '@/lib/topview/video-task';

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

export interface WorkflowRunOptions {
  topviewVideoTask?: TopviewVideoTaskState;
  onTopviewVideoTask?: (task: TopviewVideoTaskState) => void;
  onTopviewVideoStatus?: (query: TopviewVideoTaskQuery, task: TopviewVideoTaskState) => void;
}

const VIDEO_REFERENCE_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'];
const AUDIO_REFERENCE_EXTENSIONS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'aiff'];

/**
 * A reference list is mixed media. Topview sorts references into stills, clips
 * and audio by the role we send, so read the role off the file rather than off
 * the field it arrived in — otherwise a clip is submitted as a still image.
 */
function referenceRoleFor(value: string, fallback: string): string {
  const path = value.split(/[?#]/)[0];
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (VIDEO_REFERENCE_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_REFERENCE_EXTENSIONS.includes(ext)) return 'audio';
  return fallback;
}

export function workflowMediaInputs(inputs: Record<string, unknown>, outputType: string): Array<{ value: string; role: string }> {
  const media: Array<{ value: string; role: string }> = [];
  const add = (value: unknown, role: string) => {
    if (typeof value === 'string' && value.trim()) media.push({ value: value.trim(), role });
    if (Array.isArray(value)) value.forEach((entry) => add(entry, role));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (typeof record.value === 'string') add(record.value, typeof record.role === 'string' ? record.role : role);
    }
  };
  // Reference lists carry whatever the user attached; frames below are frames by
  // definition, so only these are classified per file.
  const addReferences = (value: unknown) => add(value, 'reference');
  addReferences(inputs.higgsfield_media_inputs);
  addReferences(inputs.medias);
  addReferences(inputs.image_urls);
  addReferences(inputs.input_image_urls);
  addReferences(inputs.reference_images);
  add(inputs.image_url, outputType === 'video' ? 'start_image' : 'image');
  add(inputs.first_frame, 'start_image');
  add(inputs.first_frame_url, 'start_image');
  add(inputs.reference_audio, 'audio');
  add(inputs.audio_url, 'audio');
  add(inputs.end_frame, 'end_image');
  add(inputs.end_frame_url, 'end_image');
  return media
    .map((entry) => (entry.role === 'reference' || entry.role === 'image'
      ? { ...entry, role: referenceRoleFor(entry.value, 'image') }
      : entry))
    .filter((entry, index, all) => all.findIndex((candidate) => (
      candidate.value === entry.value && candidate.role === entry.role
    )) === index);
}

async function runTopviewWorkflow(params: WorkflowRunParams, options: WorkflowRunOptions): Promise<unknown> {
  const model = getModelDefinition(params.nodeType);
  if (!model || model.provider !== 'topview') throw new Error('Topview model configuration is unavailable.');
  const prompt = String(params.inputs.prompt ?? '').trim();
  if (!prompt) throw new Error('Connect a prompt before running this Topview model.');
  const medias = workflowMediaInputs(params.inputs, model.outputType);
  const requestedModel = topviewRequestedModel(model, params.inputs.model);
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
    // Only forward the fields this model actually exposes. Topview refuses a submit
    // that carries a parameter the chosen model does not advertise, so inventing a
    // default duration here silently broke every fixed-length model (Gemini Omni
    // Flash, Kling Omni, Grok Video Edit) after the render had already been paid for.
    const requestedDuration = params.inputs.duration ?? params.inputs.durationSec;
    const duration = requestedDuration === undefined || requestedDuration === ''
      ? undefined
      : Number(requestedDuration);
    const request = {
      prompt,
      model: requestedModel,
      ...(duration !== undefined && Number.isFinite(duration) ? { durationSec: duration } : {}),
      aspectRatio: typeof params.inputs.aspect_ratio === 'string' ? params.inputs.aspect_ratio : undefined,
      resolution: typeof params.inputs.resolution === 'string' ? params.inputs.resolution : undefined,
      generateAudio: params.inputs.generate_audio === undefined ? undefined : Boolean(params.inputs.generate_audio),
      medias,
    };
    const submit = window.electronAPI.topview.submit;
    const query = window.electronAPI.topview.query;
    if (!submit || !query) {
      if (options.topviewVideoTask) {
        throw new Error('Resume this Topview video from CineGen Desktop so the existing render is not submitted twice.');
      }
      return window.electronAPI.topview.generate(request);
    }
    return runTopviewVideoTask({
      submit: (value) => submit(value),
      query: (task) => query(task),
    }, request, {
      resumeTask: options.topviewVideoTask,
      onTask: options.onTopviewVideoTask,
      onStatus: options.onTopviewVideoStatus,
    });
  }
  if (model.outputType === 'audio') {
    const audioReference = medias.find((entry) => entry.role === 'audio')?.value;
    const kind = model.inputs.some((field) => field.id === 'styles')
      ? 'music'
      : model.inputs.some((field) => field.id === 'voice_id') ? 'voice' : 'audio';
    return window.electronAPI.topview.generateAudio({
      prompt,
      model: requestedModel,
      kind,
      styles: typeof params.inputs.styles === 'string' ? params.inputs.styles : undefined,
      instrumental: params.inputs.instrumental === undefined ? undefined : Boolean(params.inputs.instrumental),
      voiceId: typeof params.inputs.voice_id === 'string' ? params.inputs.voice_id : undefined,
      voiceSpeed: typeof params.inputs.voice_speed === 'number' ? params.inputs.voice_speed : undefined,
      emotion: typeof params.inputs.emotion === 'string' ? params.inputs.emotion : undefined,
      emotionText: typeof params.inputs.emotion_text === 'string' ? params.inputs.emotion_text : undefined,
      referenceAudio: audioReference,
    });
  }
  throw new Error('This Topview node type is not supported.');
}

async function runHiggsfieldWorkflow(params: WorkflowRunParams): Promise<unknown> {
  const model = getModelDefinition(params.nodeType);
  if (!model || model.provider !== 'higgsfield') throw new Error('Higgsfield model configuration is unavailable.');
  const prompt = typeof params.inputs.prompt === 'string' ? params.inputs.prompt.trim() : undefined;
  const medias = workflowMediaInputs(params.inputs, model.outputType);
  const outputType = model.outputType === 'model3d' ? '3d' : model.outputType;
  const result = await window.electronAPI.higgsfield.generate({
    prompt,
    model: model.id,
    outputType,
    medias,
    params: params.inputs,
    wait: true,
  });
  // Direct MCP calls return the URL at the root; workflow nodes expect the
  // provider's conventional output mapping. Expose both shapes to keep every
  // Higgsfield consumer compatible.
  if (result.url) return { ...result, output: { url: result.url } };
  return result;
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

export async function runWorkflow(params: WorkflowRunParams, options: WorkflowRunOptions = {}): Promise<unknown> {
  const modelProvider = getModelDefinition(params.nodeType)?.provider;
  if (modelProvider === 'topview') {
    const result = await runTopviewWorkflow(params, options);
    requestProviderUsageRefresh('topview');
    return result;
  }
  if (modelProvider === 'higgsfield') {
    const result = await runHiggsfieldWorkflow(params);
    requestProviderUsageRefresh('higgsfield');
    return result;
  }
  try {
    const result = await window.electronAPI.workflow.run(params);
    if (isVideoGenerationProvider(modelProvider)) requestProviderUsageRefresh(modelProvider);
    else if (params.nodeType.startsWith('hf-')) requestProviderUsageRefresh('higgsfield');
    return result;
  } catch (localError) {
    const provider = fundedProviderForFailure(params, localError);
    if (!activeProjectId || !provider) throw localError;
    try {
      const result = await runFunded(activeProjectId, provider, params);
      if (provider === 'higgsfield') requestProviderUsageRefresh(provider);
      return result;
    } catch (fundedError) {
      throw new Error(callableErrorMessage(fundedError), { cause: fundedError });
    }
  }
}
