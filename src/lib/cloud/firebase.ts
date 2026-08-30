import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  type User,
} from 'firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyDhxfLpKNqAMJWFCiUPaQiINUk2U2Wv9gA',
  authDomain: 'cinegen-734ba.firebaseapp.com',
  projectId: 'cinegen-734ba',
  storageBucket: 'cinegen-734ba.firebasestorage.app',
  messagingSenderId: '48352992061',
  appId: '1:48352992061:web:70dd038a4dc607a0070354',
};

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const cloudAuth = getAuth(firebaseApp);

void setPersistence(cloudAuth, browserLocalPersistence).catch((error) => {
  console.warn('[cloud] Firebase auth persistence could not be enabled:', error);
});

function needsMobileSafeFirestore(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  const embeddedBrowser = /FBAN|FBAV|Instagram|Line\//i.test(userAgent)
    || (/AppleWebKit/i.test(userAgent) && !/Safari/i.test(userAgent));
  return iOSDevice || embeddedBrowser;
}

export const cloudDb = initializeFirestore(firebaseApp, {
  // IndexedDB multi-tab persistence can deadlock in iOS link previews and
  // embedded browsers. The cloud remains the source of truth, so use memory
  // caching there and keep durable multi-tab caching on full desktop browsers.
  localCache: needsMobileSafeFirestore()
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  // Mobile privacy relays and embedded browsers can block Firestore's normal
  // streaming transport. Auto-detect and fall back to long polling.
  experimentalAutoDetectLongPolling: true,
});
export const cloudStorage = getStorage(firebaseApp);
export const cloudFunctions = getFunctions(firebaseApp, 'us-central1');

const AUTH_READY_TIMEOUT_MS = 12_000;

export function waitForCloudAuth(): Promise<User | null> {
  if (cloudAuth.currentUser) return Promise.resolve(cloudAuth.currentUser);
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: number | undefined;
    let unsubscribe = () => {};
    const finish = (user: User | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(user);
    };
    unsubscribe = onAuthStateChanged(cloudAuth, finish);
    // Some iOS in-app browsers can leave Firebase persistence initialization
    // pending indefinitely. Treat that as signed out so the UI can offer a
    // recovery path instead of showing a permanent loading screen.
    timeoutId = window.setTimeout(() => finish(cloudAuth.currentUser), AUTH_READY_TIMEOUT_MS);
  });
}
