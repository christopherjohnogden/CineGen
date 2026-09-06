import { useEffect, type RefObject, type Dispatch } from 'react';
import type { Asset } from '@/types/project';
import type { WorkspaceAction } from '@/lib/mcp/workspace-state';

const STALE_DERIVE_JOB_MS = 15000;
const PROXY_CODEC_HINTS = ['prores', 'dnxhr', 'dnxhd', 'cfhd', 'cineform', 'rawvideo'];
const PROXY_SIZE_THRESHOLD_BYTES = 1_000_000_000;

function shouldGenerateProxyForAsset(asset: Pick<Asset, 'type' | 'width' | 'codec' | 'fileSize'>): boolean {
  if (asset.type !== 'video') return false;
  if ((asset.fileSize ?? 0) >= PROXY_SIZE_THRESHOLD_BYTES) return true;
  if ((asset.width ?? 0) > 1920) return true;
  const codec = (asset.codec ?? '').toLowerCase();
  return PROXY_CODEC_HINTS.some((hint) => codec.includes(hint));
}

export function useAssetMediaBackfill(
  assets: Asset[],
  projectId: string,
  deriveInFlightRef: RefObject<Set<string>>,
  wrappedDispatch: Dispatch<WorkspaceAction>,
  updateAssetProcessingJobs: (id: string, update: (jobs: Set<string>) => void) => void,
) {
  // Backfill missing derived media artifacts for existing assets (thumbnail/filmstrip/waveform).
  useEffect(() => {
    for (const asset of assets) {
      if (!asset.fileRef) continue;

      const md = (asset.metadata ?? {}) as Record<string, unknown>;
      const processingJobs = new Set(
        Array.isArray(md.processingJobs)
          ? md.processingJobs.filter((value): value is string => typeof value === 'string')
          : [],
      );
      const assetAgeMs = (() => {
        const createdAt = Date.parse(asset.createdAt ?? '');
        return Number.isFinite(createdAt) ? Date.now() - createdAt : Number.POSITIVE_INFINITY;
      })();
      const hasWaveformFile = typeof md.waveformPath === 'string' && md.waveformPath.length > 0;
      const hasFilmstripUrl = typeof md.filmstripUrl === 'string' && md.filmstripUrl.length > 0;
      const hasFilmstripFrames = Array.isArray(md.filmstrip) && md.filmstrip.length > 0;
      const hasThumbnail = typeof asset.thumbnailUrl === 'string' && asset.thumbnailUrl.length > 0;
      const hasProxy = typeof asset.proxyRef === 'string' && asset.proxyRef.length > 0;
      const needsThumbnail = asset.type !== 'audio' && !hasThumbnail;

      const pruneJobIfStale = (jobType: 'generate_thumbnail' | 'compute_waveform' | 'generate_filmstrip' | 'generate_proxy', artifactReady: boolean) => {
        if (!processingJobs.has(jobType)) return;
        if (artifactReady) {
          processingJobs.delete(jobType);
          return;
        }
        const deriveKey = `${asset.id}:${jobType}`;
        if (deriveInFlightRef.current.has(deriveKey)) return;
        if (assetAgeMs <= STALE_DERIVE_JOB_MS) return;
        processingJobs.delete(jobType);
      };

      pruneJobIfStale('generate_thumbnail', hasThumbnail);
      pruneJobIfStale('compute_waveform', hasWaveformFile);
      pruneJobIfStale('generate_filmstrip', hasFilmstripUrl || hasFilmstripFrames);
      pruneJobIfStale('generate_proxy', hasProxy);

      const nextProcessingJobs = [...processingJobs];
      const prevProcessingJobs = Array.isArray(md.processingJobs)
        ? md.processingJobs.filter((value): value is string => typeof value === 'string')
        : [];
      const processingJobsChanged =
        prevProcessingJobs.length !== nextProcessingJobs.length
        || prevProcessingJobs.some((job, index) => job !== nextProcessingJobs[index]);
      if (processingJobsChanged) {
        wrappedDispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: asset.id,
            metadata: { processingJobs: nextProcessingJobs },
          },
        });
      }

      // The preview may be short even when the waveform file is ready (web
      // uploads use a one-point placeholder). Use the same readiness rule as
      // pruning above, otherwise this effect repeatedly clears and requeues it.
      const needsWaveform = (asset.type === 'video' || asset.type === 'audio') && !hasWaveformFile;
      const needsFilmstrip = asset.type === 'video' && !(hasFilmstripUrl || hasFilmstripFrames);
      const needsProxy = shouldGenerateProxyForAsset(asset) && !asset.proxyRef;
      const queueThumbnail = needsThumbnail && !processingJobs.has('generate_thumbnail');
      const queueWaveform = needsWaveform && !processingJobs.has('compute_waveform');
      const queueFilmstrip = needsFilmstrip && !processingJobs.has('generate_filmstrip');
      const queueProxy = needsProxy && !processingJobs.has('generate_proxy');
      const jobsToQueue = [
        queueThumbnail ? 'generate_thumbnail' : null,
        queueWaveform ? 'compute_waveform' : null,
        queueFilmstrip ? 'generate_filmstrip' : null,
        queueProxy ? 'generate_proxy' : null,
      ].filter((value): value is string => Boolean(value));

      if (jobsToQueue.length === 0) continue;

      const queuedDeriveKeys = jobsToQueue.map((job) => `${asset.id}:${job}`);
      for (const deriveKey of queuedDeriveKeys) {
        deriveInFlightRef.current.add(deriveKey);
      }

      updateAssetProcessingJobs(asset.id, (jobs) => {
        for (const job of jobsToQueue) jobs.add(job);
      });

      window.electronAPI.media.queueProcessing({
        assetId: asset.id,
        projectId,
        inputPath: asset.fileRef,
        needsProxy: queueProxy,
        includeThumbnail: queueThumbnail,
        includeWaveform: queueWaveform,
        includeFilmstrip: queueFilmstrip,
      }).catch((err) => {
        console.error('[workspace] Backfill processing failed:', err);
        for (const deriveKey of queuedDeriveKeys) {
          deriveInFlightRef.current.delete(deriveKey);
        }
        updateAssetProcessingJobs(asset.id, (jobs) => {
          for (const job of jobsToQueue) jobs.delete(job);
        });
      });
    }
  }, [assets, projectId, deriveInFlightRef, wrappedDispatch, updateAssetProcessingJobs]);

}
