import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { cloudAuth } from '@/lib/cloud/firebase';
import { CLOUD_AUTH_RESTORE_TIMEOUT, CLOUD_SIGN_IN_REQUIRED } from '@/lib/cloud/auth-errors';

/** Recover an unopened project when another window finishes signing in. */
export function useCloudAuthRecovery(error: string | null, retry: () => void): void {
  useEffect(() => {
    if (error !== CLOUD_SIGN_IN_REQUIRED && error !== CLOUD_AUTH_RESTORE_TIMEOUT) return;
    let retried = false;
    return onAuthStateChanged(cloudAuth, user => {
      if (!user || retried) return;
      retried = true;
      retry();
    });
  }, [error, retry]);
}
