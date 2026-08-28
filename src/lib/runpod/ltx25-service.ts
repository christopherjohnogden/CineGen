import {
  LTX25_WORKER_COMMIT,
  LTX25_WORKER_IMAGE,
  LTX25_WORKER_RELEASE,
  DEFAULT_LTX25_GPU_PROFILE as DEFAULT_LTX25_GPU_PROFILE_RUNTIME,
  LTX25_GPU_PROFILES as LTX25_GPU_PROFILES_RUNTIME,
  RunpodLtx25Error,
  getRunpodLtx25Status as getRunpodLtx25StatusRuntime,
  runRunpodLtx25Job as runRunpodLtx25JobRuntime,
  runRunpodSessionImageJob as runRunpodSessionImageJobRuntime,
  setupRunpodLtx25 as setupRunpodLtx25Runtime,
  terminateRunpodLtx25 as terminateRunpodLtx25Runtime,
} from './ltx25-service.mjs';

export { LTX25_WORKER_COMMIT, LTX25_WORKER_IMAGE, LTX25_WORKER_RELEASE, RunpodLtx25Error };

export type Ltx25GpuProfile = 'economy' | 'balanced' | 'performance';
export type RunpodSessionImageModel = 'sdxl' | 'qwen-image-edit';

export interface Ltx25GpuProfileConfig {
  readonly gpuTypeIds: readonly string[];
  readonly containerDiskInGb: number;
  readonly minRAMPerGPU: number;
  readonly minVCPUPerGPU: number;
}

export const DEFAULT_LTX25_GPU_PROFILE = DEFAULT_LTX25_GPU_PROFILE_RUNTIME as Ltx25GpuProfile;
export const LTX25_GPU_PROFILES = LTX25_GPU_PROFILES_RUNTIME as Readonly<
  Record<Ltx25GpuProfile, Ltx25GpuProfileConfig>
>;

export type Ltx25Phase =
  | 'creating'
  | 'downloading'
  | 'ready'
  | 'rendering'
  | 'error'
  | 'ended'
  | 'startup-failed-cleaned'
  | 'startup-failed-cleanup-required';
export type Ltx25JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

/** Gateway v2 keeps job status small and transfers completed media in bounded chunks. */
export interface Ltx25ArtifactDescriptor {
  id: string;
  byteSize: number;
  mediaType: string;
  chunkSize: number;
  expiresAt?: number;
}

export interface Ltx25ArtifactChunk {
  id: string;
  offset: number;
  byteSize: number;
  mediaType: string;
  data: string;
}

export interface Ltx25GatewayCapabilities {
  asyncJobs: boolean;
  artifactChunks: boolean;
  maxArtifactChunkBytes: number;
  imageArtifacts?: boolean;
}

export interface Ltx25VideoInput {
  prompt: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
  referenceImages?: string[];
}

export interface Ltx25SetupResult {
  podId: string;
  podUrl: string;
  podAuthToken: string;
  secretIds: string[];
  status: 'downloading' | 'error';
  phase: Ltx25Phase;
  message: string;
  gpuProfile: Ltx25GpuProfile;
  imageModels: RunpodSessionImageModel[];
  costPerHr: number | null;
  gpu: string | null;
}

export interface Ltx25StatusResult {
  status: 'downloading' | 'ready' | 'error' | 'ended';
  phase: Ltx25Phase;
  message: string;
  podId: string;
  podUrl: string;
  costPerHr: number | null;
  gpu: string | null;
}

export interface Ltx25JobResult {
  jobId: string;
  status: Ltx25JobStatus;
  phase: Ltx25Phase;
  message?: string;
  output?: {
    url?: string;
    data?: string;
    mediaType?: string;
    durationSec: number;
    model: 'LTX-2.5';
  };
  error?: string;
}

export interface RunpodSessionImageInput {
  model: RunpodSessionImageModel;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  referenceImages?: string[];
}

export interface RunpodSessionImageJobResult {
  jobId: string;
  status: Ltx25JobStatus;
  phase: Ltx25Phase;
  message?: string;
  output?: {
    url?: string;
    data?: string;
    mediaType?: string;
    model: 'SDXL' | 'Qwen Image Edit 2511';
  };
  error?: string;
}

type FetchLike = typeof fetch;

export const setupRunpodLtx25 = setupRunpodLtx25Runtime as (
  params: {
    runpodKey: string;
    huggingFaceToken: string;
    gpuProfile?: Ltx25GpuProfile;
    imageModels?: RunpodSessionImageModel[];
  },
  fetchImpl?: FetchLike,
) => Promise<Ltx25SetupResult>;

export const getRunpodLtx25Status = getRunpodLtx25StatusRuntime as (
  params: { runpodKey: string; podId: string; podUrl: string; podAuthToken: string; secretIds?: string[] },
  fetchImpl?: FetchLike,
) => Promise<Ltx25StatusResult>;

export const terminateRunpodLtx25 = terminateRunpodLtx25Runtime as (
  params: { runpodKey: string; podId: string; secretIds?: string[] },
  fetchImpl?: FetchLike,
) => Promise<{ ok: true; warning?: string }>;

export const runRunpodLtx25Job = runRunpodLtx25JobRuntime as (
  params: {
    podId: string;
    podUrl: string;
    podAuthToken: string;
    jobId?: string;
    input?: Ltx25VideoInput;
  },
  fetchImpl?: FetchLike,
) => Promise<Ltx25JobResult>;

export const runRunpodSessionImageJob = runRunpodSessionImageJobRuntime as (
  params: {
    podId: string;
    podUrl: string;
    podAuthToken: string;
    model?: RunpodSessionImageModel;
    jobId?: string;
    input?: RunpodSessionImageInput;
  },
  fetchImpl?: FetchLike,
) => Promise<RunpodSessionImageJobResult>;
