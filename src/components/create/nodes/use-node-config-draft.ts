import { useLayoutEffect, useRef, useState } from 'react';

type Config = Record<string, unknown>;
type PendingField = { base: unknown; values: unknown[] };

/** React Flow batches node updates. Inputs need their new value during the
 * change event itself, otherwise React restores the old value and moves the
 * caret. Keep local edits until the node acknowledges them, without hiding
 * genuine external changes (including restored projects). */
export function useNodeConfigDraft(saved: Config) {
  const [edits, setEdits] = useState<Config>({});
  const pending = useRef(new Map<string, PendingField>());
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useLayoutEffect(() => {
    const acknowledged: string[] = [];
    for (const [field, change] of pending.current) {
      const incoming = saved[field];
      const isLatest = Object.is(incoming, change.values.at(-1));
      const isOlder = Object.is(incoming, change.base) || change.values.some(value => Object.is(value, incoming));
      if (isLatest || !isOlder) {
        pending.current.delete(field);
        acknowledged.push(field);
      }
    }
    if (acknowledged.length) setEdits(current => {
      const next = { ...current };
      for (const field of acknowledged) delete next[field];
      return next;
    });
  }, [saved]);

  function edit(patch: Config) {
    for (const [field, value] of Object.entries(patch)) {
      const change = pending.current.get(field) || { base: savedRef.current[field], values: [] };
      change.values.push(value);
      pending.current.set(field, change);
    }
    setEdits(current => ({ ...current, ...patch }));
  }

  return [{ ...saved, ...edits }, edit] as const;
}
