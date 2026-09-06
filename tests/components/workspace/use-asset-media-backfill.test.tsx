import { useCallback, useRef, useState } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Asset } from '@/types/project';
import type { WorkspaceAction } from '@/lib/mcp/workspace-state';
import { useAssetMediaBackfill } from '@/components/workspace/use-asset-media-backfill';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([true, false])('settles waveform processing with a short preview (file ready: %s)', (ready) => {
  const queueProcessing = vi.fn(async () => {});
  const previous = window.electronAPI;
  window.electronAPI = { media: { queueProcessing } } as unknown as typeof window.electronAPI;
  try {
    const { result } = renderHook(() => {
      const [assets, setAssets] = useState<Asset[]>([{
        id: 'phone-video', name: 'IMG_5387.MOV', type: 'video',
        url: '/media/projects/test/generated/phone.mov', fileRef: '/media/projects/test/generated/phone.mov',
        thumbnailUrl: '/cinegen-cloud/video.svg', createdAt: new Date().toISOString(),
        metadata: { waveform: [0], waveformPath: ready ? '/cinegen-cloud/empty-waveform.json' : undefined, filmstrip: ['preview.svg'], processingJobs: ready ? ['compute_waveform'] : [] },
      }]);
      const latest = useRef(assets); latest.current = assets;
      const updates = useRef(0);
      const inFlight = useRef(new Set<string>());
      const dispatch = useCallback((action: WorkspaceAction) => {
        if (++updates.current > 20) throw new Error('Media processing update loop');
        if (action.type !== 'UPDATE_ASSET') return;
        setAssets(current => current.map(asset => asset.id === action.asset.id
          ? { ...asset, ...action.asset, metadata: { ...asset.metadata, ...action.asset.metadata } } : asset));
      }, []);
      const updateJobs = useCallback((id: string, update: (jobs: Set<string>) => void) => {
        const asset = latest.current.find(entry => entry.id === id)!;
        const previousJobs = (asset.metadata?.processingJobs ?? []) as string[];
        const jobs = new Set(previousJobs); update(jobs);
        const next = [...jobs];
        if (next.length === previousJobs.length && next.every((job, i) => job === previousJobs[i])) return;
        latest.current = latest.current.map(entry => entry.id === id ? { ...entry, metadata: { ...entry.metadata, processingJobs: next } } : entry);
        dispatch({ type: 'UPDATE_ASSET', asset: { id, metadata: { processingJobs: next } } });
      }, [dispatch]);
      useAssetMediaBackfill(assets, 'test', inFlight, dispatch, updateJobs);
      return assets;
    });
    expect(result.current[0].metadata?.processingJobs).toEqual(ready ? [] : ['compute_waveform']);
    expect(queueProcessing).toHaveBeenCalledTimes(ready ? 0 : 1);
  } finally { window.electronAPI = previous; }
});
