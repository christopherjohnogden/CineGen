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

export const cloudDb = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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
