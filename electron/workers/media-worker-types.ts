// Job types the worker can process
export type JobType =
  | 'extract_metadata'
  | 'generate_thumbnail'
  | 'compute_waveform'
  | 'generate_filmstrip'
  | 'generate_proxy'
  | 'sync_compute_offset'
  | 'sync_batch_match';

// Lower number = higher priority
export const JOB_PRIORITY: Record<JobType, number> = {
  extract_metadata: 0,
  generate_thumbnail: 1,
  compute_waveform: 2,
  generate_filmstrip: 3,
  generate_proxy: 4,
  sync_compute_offset: 0,
  sync_batch_match: 0,
};

// Base fields shared by all job types
interface BaseMediaJob {
  id: string;
  assetId?: string;
  projectDir: string;
}

// Standard media processing jobs
export interface StandardMediaJob extends BaseMediaJob {
  type: 'extract_metadata' | 'generate_thumbnail' | 'compute_waveform' | 'generate_filmstrip' | 'generate_proxy';
  assetId: string;
  inputPath: string;
  outputPath: string;
}

// Compute audio/video sync offset between two assets
export interface SyncOffsetJob extends BaseMediaJob {
  type: 'sync_compute_offset';
  sourceAssetId: string;
  targetAssetId: string;
  sourceFilePath: string;
  targetFilePath: string;
}

// Batch match multiple video assets to audio assets
export interface SyncBatchJob extends BaseMediaJob {
  type: 'sync_batch_match';
  videoAssets: Array<{ id: string; filePath: string; name: string }>;
  audioAssets: Array<{ id: string; filePath: string; name: string }>;
}

// A job submitted to the worker (discriminated union)
export type MediaJob = StandardMediaJob | SyncOffsetJob | SyncBatchJob;

// Messages FROM worker TO main process
export type WorkerMessageToMain =
  | { type: 'ready' }
  | { type: 'job:progress'; jobId: string; progress: number }
  | { type: 'job:complete'; jobId: string; result: unknown }
  | { type: 'job:error'; jobId: string; error: string }
  | { type: 'sync:batch-progress'; jobId: string; completedPairs: number; totalPairs: number; currentVideoName: string; currentAudioName: string };

// Messages FROM main process TO worker
export type MainMessageToWorker =
  | { type: 'config'; ffmpegPath: string; ffprobePath: string; fpcalcPath: string }
  | { type: 'job:submit'; job: MediaJob }
  | { type: 'job:cancel'; jobId: string };

// Metadata extracted from a media file
export interface MediaMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  fileSize: number;
  bitrate: number;
  audioChannels: number;
  audioCodec: string;
}

// Result of a sync offset computation
export interface SyncOffsetResult {
  offsetSeconds: number;
  method: 'timecode' | 'waveform';
  confidence: number;
}

// Result of a batch sync match
export interface SyncBatchResult {
  pairs: Array<{
    videoAssetId: string;
    audioAssetId: string;
    offsetSeconds: number;
    matchMethod: 'timecode' | 'waveform';
    nameScore: number;
    waveformScore: number;
  }>;
  unmatchedVideos: string[];
  unmatchedAudio: string[];
}
