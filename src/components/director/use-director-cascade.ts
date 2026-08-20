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
}: Args): {
  dirty: string[];
  running: boolean;
  cancel: () => void;
  /** Mark this source as already handled so auto-sync will not re-fire it. */
  acknowledge: (sourceText: string, docKind?: DirectorShow['docKind']) => void;
} {
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Signature of the source we last auto-fired for. A failed run does NOT advance
  // syncState.hashes, so the scenes stay dirty — without this guard the effect would
  // re-fire the same failing job on every re-render, spamming the error. We only
  // auto-fire again once the source actually changes (a new signature).
  const attemptedSig = useRef<string | null>(null);

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
      const scopedIds = scenesForKeys(cur, d.changed).map((s) => s.id);
      const scope: { sceneIds: string[] } | 'all' =
        d.changed.length && cur.docKind !== 'beatsheet' && scopedIds.length > 0
          ? { sceneIds: scopedIds }
          : 'all';
      // Elements come from the LLM breakdown. A failed job must not shotlist
      // against an empty (or stale) bible — stay dirty so the next edit retries.
      try {
        await runBreakdown(scope, controller.signal);
      } catch {
        return;
      }
      if (controller.signal.aborted) return;
      await runShotlist(scope, controller.signal);
      if (controller.signal.aborted) return;
      // Reached only when this controller was never aborted, so a superseded
      // (cancel-and-restart) run bails out above and never commits stale state.
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
    // Turning auto-sync off clears the attempt guard, so flipping it back on retries.
    if (!autoSync) { attemptedSig.current = null; return; }
    if (d.changed.length === 0 && d.removed.length === 0) return;

    // Don't auto-fire again for a source we already attempted (and which is still
    // dirty because that attempt failed). Only fire once per distinct source
    // signature; editing the script produces a new signature and re-enables it.
    const sig = `${show.docKind ?? 'screenplay'}:${show.sourceText}`;
    if (attemptedSig.current === sig) return;
    attemptedSig.current = sig;

    // Cancel any in-flight run and any pending timer, then re-arm from now.
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();

    timer.current = setTimeout(() => { void fire().catch(() => {}); }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      abort.current?.abort();
    };
    // Re-run when the source signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.sourceText, autoSync, debounceMs]);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    setRunning(false);
  };

  // Upload / the Run-breakdown button already kicked a job for this source.
  // Drop the pending auto-sync timer so we don't pay for a second LLM pass
  // 2.5s later (and so we don't abort-restart the one that just started).
  const acknowledge = (sourceText: string, docKind?: DirectorShow['docKind']) => {
    attemptedSig.current = `${docKind ?? 'screenplay'}:${sourceText}`;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    abort.current?.abort();
    setRunning(false);
  };

  return { dirty, running, cancel, acknowledge };
}
