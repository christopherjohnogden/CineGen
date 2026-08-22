import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { cloudDb, cloudFunctions } from './firebase';

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
