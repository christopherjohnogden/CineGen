import { expect, it, vi } from 'vitest';
import { reportCloudSyncFailure, reportCloudSyncSuccess } from '@/lib/cloud/sync-status';
it('reports a failure once until recovery and keeps project and Elements failures separate',()=>{
  const listener=vi.fn(), recovered=vi.fn();
  window.addEventListener('cinegen:cloud-sync-error',listener);
  window.addEventListener('cinegen:cloud-sync-recovered',recovered);
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try {
    reportCloudSyncFailure(new TypeError('Failed to fetch'),'elements');
    reportCloudSyncFailure(new TypeError('Failed to fetch'),'elements');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail.message).toContain('Shared Elements library');
    reportCloudSyncFailure(new Error('Failed to fetch'),'project');
    expect(listener).toHaveBeenCalledTimes(2);
    reportCloudSyncSuccess('elements');expect(recovered).toHaveBeenCalledTimes(1);
    reportCloudSyncFailure(new Error('Failed to fetch'),'elements');expect(listener).toHaveBeenCalledTimes(3);
  } finally {
    window.removeEventListener('cinegen:cloud-sync-error',listener);
    window.removeEventListener('cinegen:cloud-sync-recovered',recovered);
    reportCloudSyncSuccess('elements');reportCloudSyncSuccess('project');warn.mockRestore();
  }
});
