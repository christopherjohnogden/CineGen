import { useCallback, useEffect, useRef, useState } from 'react';

export const COPIED_FLASH_MS = 2000;

/** Idle label stays until a copy lands; then "Copied" for two seconds. */
export function copyButtonLabel(copied: boolean, idle: string): string {
  return copied ? 'Copied' : idle;
}

export function useCopiedFlash(durationMs = COPIED_FLASH_MS) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => clearTimer, []);

  const flash = useCallback((key = 'default') => {
    setCopiedKey(key);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
      timerRef.current = null;
    }, durationMs);
  }, [durationMs]);

  const copyText = useCallback(async (text: string, key = 'default') => {
    try {
      await navigator.clipboard.writeText(text);
      flash(key);
    } catch {
      // Leave the idle label — nothing landed on the clipboard.
    }
  }, [flash]);

  return {
    copied: copiedKey !== null,
    copiedKey,
    isCopied: (key = 'default') => copiedKey === key,
    flash,
    copyText,
  };
}
