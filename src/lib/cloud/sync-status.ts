type SyncScope = 'project' | 'elements';
const failures = new Map<SyncScope, string>();

/** Keep a persistent failure visible without repeatedly interrupting the user. */
export function reportCloudSyncFailure(error: unknown, scope: SyncScope): void {
  const reason = error instanceof Error ? error.message : String(error || 'Unknown sync error');
  const label = scope === 'elements' ? 'Shared Elements library' : 'Project';
  const detail = new Error(`${label}: ${/^(failed to fetch|load failed|networkerror)/i.test(reason)
    ? 'The network request failed. Cloud sync has not completed. Check your connection and try saving again.'
    : reason}`);
  Object.assign(detail, { scope });
  console.warn(`[cloud] ${label} sync failed`, error);
  if (failures.get(scope) === detail.message) return;
  failures.set(scope, detail.message);
  window.dispatchEvent(new CustomEvent('cinegen:cloud-sync-error', { detail }));
}

export function reportCloudSyncSuccess(scope: SyncScope): void {
  if (!failures.delete(scope)) return;
  window.dispatchEvent(new CustomEvent('cinegen:cloud-sync-recovered', { detail: { scope } }));
}
