import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { MediaJob } from '../workers/media-worker-types.js';

export function registerAudioSyncHandlers(
  submitJob: (job: MediaJob) => Promise<unknown>,
): void {
  ipcMain.handle('sync:compute-offset', async (_event, params: {
    sourceAssetId: string;
    targetAssetId: string;
    sourceFilePath: string;
    targetFilePath: string;
    projectId: string;
  }) => {
    const jobId = randomUUID();
    const result = await submitJob({
      id: jobId,
      type: 'sync_compute_offset',
      sourceAssetId: params.sourceAssetId,
      targetAssetId: params.targetAssetId,
      sourceFilePath: params.sourceFilePath,
      targetFilePath: params.targetFilePath,
      projectDir: '',  // Not needed for sync jobs
    });
    return result;
  });

  ipcMain.handle('sync:batch-match', async (_event, params: {
    videoAssets: Array<{ id: string; filePath: string; name: string }>;
    audioAssets: Array<{ id: string; filePath: string; name: string }>;
    projectId: string;
  }) => {
    const jobId = randomUUID();
    const result = await submitJob({
      id: jobId,
      type: 'sync_batch_match',
      videoAssets: params.videoAssets,
      audioAssets: params.audioAssets,
      projectDir: '',  // Not needed for sync jobs
    });
    return result;
  });
}
