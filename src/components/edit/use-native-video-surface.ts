import { useCallback, useEffect, useRef, useState } from 'react';

interface UseNativeVideoSurfaceOptions {
  surfaceId: string;
  enabled: boolean;
  destroyOnUnmount?: boolean;
  fitAspectRatio?: number | null;
}

export function useNativeVideoSurface({
  surfaceId,
  enabled,
  destroyOnUnmount = true,
  fitAspectRatio = null,
}: UseNativeVideoSurfaceOptions) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [surfaceVersion, setSurfaceVersion] = useState(0);
  const wakeRecoveryTimerRef = useRef<number | null>(null);

  const hasBlockingOverlay = useCallback(() => {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.querySelector(
        '.settings-backdrop, .element-modal__backdrop, .sync-dialog__overlay, .fullscreen-modal, [aria-modal="true"]',
      ),
    );
  }, []);

  const syncRect = useCallback(() => {
    if (!enabled) return;
    const element = elementRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const hidden = rect.width <= 0 || rect.height <= 0 || hasBlockingOverlay();
    let x = rect.left;
    let y = rect.top;
    let width = rect.width;
    let height = rect.height;

    if (!hidden && fitAspectRatio && Number.isFinite(fitAspectRatio) && fitAspectRatio > 0) {
      const containerAspect = rect.width / rect.height;
      if (containerAspect > fitAspectRatio) {
        width = rect.height * fitAspectRatio;
        x = rect.left + (rect.width - width) / 2;
      } else if (containerAspect < fitAspectRatio) {
        height = rect.width / fitAspectRatio;
        y = rect.top + (rect.height - height) / 2;
      }
    }

    window.electronAPI.nativeVideo.setSurfaceRect({
      surfaceId,
      x,
      y,
      width,
      height,
    });
    window.electronAPI.nativeVideo.setSurfaceHidden({
      surfaceId,
      hidden,
    });
  }, [enabled, fitAspectRatio, hasBlockingOverlay, surfaceId]);

  const createAndSyncSurface = useCallback(() => {
    if (!enabled || !elementRef.current) return;
    void window.electronAPI.nativeVideo.createSurface(surfaceId).then((created) => {
      if (!created) return;
      syncRect();
      window.requestAnimationFrame(syncRect);
      setSurfaceVersion((version) => version + 1);
    });
  }, [enabled, surfaceId, syncRect]);

  const recreateSurfaceAfterWake = useCallback(() => {
    if (!enabled || !elementRef.current) return;
    if (wakeRecoveryTimerRef.current !== null) {
      window.clearTimeout(wakeRecoveryTimerRef.current);
      wakeRecoveryTimerRef.current = null;
    }
    void window.electronAPI.nativeVideo.resetSurfaces([surfaceId]).catch(() => false).finally(() => {
      wakeRecoveryTimerRef.current = window.setTimeout(() => {
        wakeRecoveryTimerRef.current = null;
        createAndSyncSurface();
        syncRect();
        window.requestAnimationFrame(syncRect);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(syncRect);
        });
      }, 120);
    });
  }, [createAndSyncSurface, enabled, surfaceId, syncRect]);

  const ref = useCallback((node: HTMLDivElement | null) => {
    elementRef.current = node;
    if (!enabled || !node) return;
    createAndSyncSurface();
  }, [createAndSyncSurface, enabled]);

  useEffect(() => {
    if (!enabled || !elementRef.current) return undefined;
    const element = elementRef.current;
    const observer = new ResizeObserver(() => syncRect());
    const mutationObserver = new MutationObserver(() => syncRect());
    observer.observe(element);
    window.addEventListener('resize', syncRect);
    window.addEventListener('scroll', syncRect, true);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    syncRect();
    const frame = window.requestAnimationFrame(syncRect);
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', syncRect);
      window.removeEventListener('scroll', syncRect, true);
      window.cancelAnimationFrame(frame);
    };
  }, [enabled, syncRect]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handlePowerEvent = ({ type }: { type: 'suspend' | 'resume' | 'unlock-screen' }) => {
      if (type === 'suspend') {
        window.electronAPI.nativeVideo.setSurfaceHidden({ surfaceId, hidden: true });
        return;
      }
      recreateSurfaceAfterWake();
    };
    const handleVisible = () => {
      if (document.hidden) return;
      syncRect();
    };
    const unsubscribe = window.electronAPI.app.onPowerEvent(handlePowerEvent);
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('pageshow', handleVisible);
    window.addEventListener('focus', handleVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('pageshow', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
  }, [enabled, recreateSurfaceAfterWake, surfaceId, syncRect]);

  useEffect(() => {
    if (enabled) return undefined;
    if (destroyOnUnmount) {
      window.electronAPI.nativeVideo.destroySurface(surfaceId);
    } else {
      window.electronAPI.nativeVideo.setSurfaceHidden({ surfaceId, hidden: true });
    }
    return undefined;
  }, [destroyOnUnmount, enabled, surfaceId]);

  useEffect(() => () => {
    if (wakeRecoveryTimerRef.current !== null) {
      window.clearTimeout(wakeRecoveryTimerRef.current);
      wakeRecoveryTimerRef.current = null;
    }
    if (destroyOnUnmount) {
      window.electronAPI.nativeVideo.destroySurface(surfaceId);
    } else {
      window.electronAPI.nativeVideo.setSurfaceHidden({ surfaceId, hidden: true });
    }
  }, [destroyOnUnmount, surfaceId]);

  return { surfaceRef: ref, syncRect, surfaceVersion };
}
