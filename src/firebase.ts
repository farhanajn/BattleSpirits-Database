import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  disableNetwork,
  doc,
  enableNetwork,
  getDocFromServer,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  isCloudQuotaCooldownActive,
  isFirestoreQuotaError,
  markCloudQuotaExhausted,
  onCloudQuotaCleared,
  onCloudQuotaExhausted,
} from './utils/firestoreQuota';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (isCloudQuotaCooldownActive()) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markCloudQuotaExhausted();
      return;
    }
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

function installFirestoreQuotaErrorWatcher(): void {
  if (typeof window === 'undefined' || typeof console === 'undefined') return;
  const globalAny = window as unknown as { __spiritsdexFirestoreQuotaHook?: boolean };
  if (globalAny.__spiritsdexFirestoreQuotaHook) return;
  globalAny.__spiritsdexFirestoreQuotaHook = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const joined = args
        .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : String(a ?? '')))
        .join(' ');
      if (
        joined.includes('@firebase/firestore') &&
        (/resource-exhausted|Quota(?:\s+limit)?\s+exceeded|Free daily (?:write|read) units/i.test(
          joined
        ) ||
          joined.includes('Using maximum backoff delay'))
      ) {
        const alreadyCooling = isCloudQuotaCooldownActive();
        markCloudQuotaExhausted();
        if (alreadyCooling) {
          // Suppress repeated SDK 60-second backoff spam once cooldown & disableNetwork are active
          return;
        }
      }
    } catch {
      // never break console.error
    }
    originalConsoleError(...args);
  };
}

if (typeof document !== 'undefined') {
  installFirestoreQuotaErrorWatcher();

  if (isCloudQuotaCooldownActive()) {
    void disableNetwork(db).catch(() => {});
  }

  onCloudQuotaExhausted(() => {
    void disableNetwork(db).catch(() => {});
  });

  onCloudQuotaCleared(() => {
    void enableNetwork(db).catch(() => {});
  });

  void testConnection();
}

export async function signInWithGoogle(): Promise<User | null> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutGoogle(): Promise<void> {
  await signOut(auth);
}
