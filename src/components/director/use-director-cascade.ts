import { useEffect, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { sceneHashes, diffScenes, scenesForKeys } from '@/lib/director/cascade';

interface Args {
  show: DirectorShow;
  autoSync: boolean;
  runBreakdown: (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
  runShotlist: (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
  commitSyncState: (next: NonNullable<DirectorShow['syncState']>) => void;
  debounceMs?: number;
}

export function useDirectorCascade({
  show,
  autoSync,
  runBreakdown,
  runShotlist,
  commitSyncState,
  debounceMs = 2500,
}: Args): { dirty: string[]; running: boolean } {
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Keep the latest props available to the debounced timer closure so that a
  // fire that lands after several edits reads the most recent show/callbacks.
  const ref = useRef({ show, autoSync, runBreakdown, runShotlist, commitSyncState });
  ref.current = { show, autoSync, runBreakdown, runShotlist, commitSyncState };

  async function fire() {
    const { show: cur, runBreakdown, runShotlist, commitSyncState } = ref.current;
    const next = sceneHashes(cur);
    const prev = new Map(Object.entries(cur.syncState?.hashes ?? {}));
    const d = diffScenes(prev, next);

    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    try {
      const scope: { sceneIds: string[] } | 'all' =
        d.changed.length && cur.docKind !== 'beatsheet'
          ? { sceneIds: scenesForKeys(cur, d.changed).map((s) => s.id) }
          : 'all';
      await runBreakdown(scope, controller.signal);
      if (controller.signal.aborted) return;
      await runShotlist(scope, controller.signal);
      if (controller.signal.aborted) return;
      commitSyncState({ hashes: Object.fromEntries(next), dirty: [], lastRunAt: Date.now() });
      setDirty([]);
    } finally {
      if (abort.current === controller) setRunning(false);
    }
  }

  useEffect(() => {
    const next = sceneHashes(show);
    const prev = new Map(Object.entries(show.syncState?.hashes ?? {}));
    const d = diffScenes(prev, next);
    setDirty(d.changed);
    if (!autoSync || (d.changed.length === 0 && d.removed.length === 0)) return;

    // Cancel any in-flight run and any pending timer, then re-arm from now.
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();

    timer.current = setTimeout(() => { void fire(); }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // Re-run when the source signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.sourceText, autoSync, debounceMs]);

  return { dirty, running };
}
