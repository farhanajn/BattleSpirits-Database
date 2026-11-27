import { type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, OperationType, type FirestoreErrorInfo } from '../firebase';
import { resolveAdminStatusFromUser } from '../hooks/useAdmin';
import { DEFAULT_FEATURED_MODE, type FeaturedCardsMode } from './featuredCards';
import {
  isCloudQuotaCooldownActive,
  isCloudWriteCooldownActive,
  isFirestoreQuotaError,
  markCloudQuotaExhausted,
} from './firestoreQuota';

export const SHARED_FEATURED_CONFIG_COLLECTION = 'appConfig';
export const SHARED_FEATURED_CONFIG_DOC_ID = 'featuredCards';
export const SHARED_FEATURED_CONFIG_PATH = `${SHARED_FEATURED_CONFIG_COLLECTION}/${SHARED_FEATURED_CONFIG_DOC_ID}`;
export const SHARED_FEATURED_CONFIG_CACHE_KEY = 'spiritsdex_shared_featured_config_v1';
export const SHARED_FEATURED_CONFIG_EVENT = 'spiritsdex:shared-featured-config';

export interface SharedFeaturedConfigState {
  mode: FeaturedCardsMode;
  updatedByUid?: string;
  updatedAtIso?: string;
  source: 'firestore' | 'cache' | 'default';
}

interface CachedSharedFeaturedConfig {
  mode: FeaturedCardsMode;
  updatedByUid?: string;
  updatedAtIso?: string;
  cachedAt: number;
}

function normalizeFeaturedMode(raw: unknown): FeaturedCardsMode {
  return raw === 'latest' ? 'latest' : 'random';
}

function logFeaturedConfigError(
  error: unknown,
  operationType: OperationType,
  path: string
): void {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
  const errInfo: FirestoreErrorInfo = {
    error: rawMessage,
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
  };
  if (/permission|insufficient|unauthenticated/i.test(rawMessage)) {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
}

function extractIsoTimestamp(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return new Date(raw).toISOString();
  }
  if (typeof raw === 'object') {
    const tsLike = raw as { toMillis?: () => number; seconds?: number };
    if (typeof tsLike.toMillis === 'function') {
      const ms = tsLike.toMillis();
      if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
    }
    if (typeof tsLike.seconds === 'number' && Number.isFinite(tsLike.seconds)) {
      return new Date(tsLike.seconds * 1000).toISOString();
    }
  }
  return undefined;
}

export function readCachedSharedFeaturedConfig(): SharedFeaturedConfigState {
  try {
    if (typeof localStorage === 'undefined') {
      return { mode: DEFAULT_FEATURED_MODE, source: 'default' };
    }
    const raw = localStorage.getItem(SHARED_FEATURED_CONFIG_CACHE_KEY);
    if (!raw) {
      return { mode: DEFAULT_FEATURED_MODE, source: 'default' };
    }
    const parsed = JSON.parse(raw) as Partial<CachedSharedFeaturedConfig>;
    if (!parsed || (parsed.mode !== 'random' && parsed.mode !== 'latest')) {
      return { mode: DEFAULT_FEATURED_MODE, source: 'default' };
    }
    return {
      mode: parsed.mode,
      updatedByUid: typeof parsed.updatedByUid === 'string' ? parsed.updatedByUid : undefined,
      updatedAtIso: typeof parsed.updatedAtIso === 'string' ? parsed.updatedAtIso : undefined,
      source: 'cache',
    };
  } catch {
    return { mode: DEFAULT_FEATURED_MODE, source: 'default' };
  }
}

function writeCachedSharedFeaturedConfig(config: SharedFeaturedConfigState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const payload: CachedSharedFeaturedConfig = {
        mode: normalizeFeaturedMode(config.mode),
        updatedByUid: config.updatedByUid,
        updatedAtIso: config.updatedAtIso,
        cachedAt: Date.now(),
      };
      localStorage.setItem(SHARED_FEATURED_CONFIG_CACHE_KEY, JSON.stringify(payload));
    }
  } catch {
    // ignore storage errors
  }
}

function broadcastSharedFeaturedConfig(config: SharedFeaturedConfigState): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent<SharedFeaturedConfigState>(SHARED_FEATURED_CONFIG_EVENT, {
        detail: config,
      })
    );
  } catch {
    // ignore environments without CustomEvent
  }
}

/**
 * Subscribes to the shared Firestore Featured Cards config document so mode updates
 * made by an administrator propagate globally to all active users with minimal reads.
 */
export function subscribeToSharedFeaturedConfig(
  onChange: (config: SharedFeaturedConfigState) => void
): () => void {
  const initial = readCachedSharedFeaturedConfig();
  onChange(initial);

  let unsubSnapshot: (() => void) | null = null;
  if (!isCloudQuotaCooldownActive()) {
    try {
      const ref = doc(db, SHARED_FEATURED_CONFIG_COLLECTION, SHARED_FEATURED_CONFIG_DOC_ID);
      unsubSnapshot = onSnapshot(
        ref,
        (snap) => {
          const next: SharedFeaturedConfigState = snap.exists()
            ? {
                mode: normalizeFeaturedMode(snap.data()?.mode),
                updatedByUid:
                  typeof snap.data()?.updatedByUid === 'string'
                    ? snap.data().updatedByUid
                    : undefined,
                updatedAtIso: extractIsoTimestamp(snap.data()?.updatedAt),
                source: 'firestore',
              }
            : {
                mode: DEFAULT_FEATURED_MODE,
                source: 'default',
              };
          writeCachedSharedFeaturedConfig(next);
          onChange(next);
        },
        (err) => {
          if (isFirestoreQuotaError(err)) {
            markCloudQuotaExhausted();
          } else {
            logFeaturedConfigError(err, OperationType.GET, SHARED_FEATURED_CONFIG_PATH);
          }
        }
      );
    } catch (err) {
      if (isFirestoreQuotaError(err)) {
        markCloudQuotaExhausted();
      }
    }
  }

  const handleLocalBroadcast = (event: Event) => {
    const custom = event as CustomEvent<SharedFeaturedConfigState>;
    if (custom?.detail && (custom.detail.mode === 'random' || custom.detail.mode === 'latest')) {
      onChange(custom.detail);
    }
  };

  const handleStorageSync = (event: StorageEvent) => {
    if (event.key === SHARED_FEATURED_CONFIG_CACHE_KEY) {
      onChange(readCachedSharedFeaturedConfig());
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(SHARED_FEATURED_CONFIG_EVENT, handleLocalBroadcast);
    window.addEventListener('storage', handleStorageSync);
  }

  return () => {
    if (unsubSnapshot) unsubSnapshot();
    if (typeof window !== 'undefined') {
      window.removeEventListener(SHARED_FEATURED_CONFIG_EVENT, handleLocalBroadcast);
      window.removeEventListener('storage', handleStorageSync);
    }
  };
}

export interface UpdateSharedFeaturedModeDeps {
  verifyAdmin?: (user: User | null) => Promise<boolean>;
  writeModeToCloud?: (mode: FeaturedCardsMode, adminUid: string) => Promise<void>;
}

/**
 * Updates the globally shared Featured Cards display mode ('random' | 'latest').
 * Strictly fail-closed: rejects unauthenticated users and verified non-admins before
 * issuing any database write, and relies on Firestore Security Rules as authoritative enforcement.
 */
export async function updateSharedFeaturedMode(
  mode: FeaturedCardsMode,
  user: User | null,
  deps?: UpdateSharedFeaturedModeDeps
): Promise<SharedFeaturedConfigState> {
  const normalizedMode = normalizeFeaturedMode(mode);
  const verify = deps?.verifyAdmin ?? resolveAdminStatusFromUser;
  const isVerifiedAdmin = await verify(user);
  if (!user || !user.uid || !isVerifiedAdmin) {
    throw new Error('Only authenticated administrators can change the Featured Cards mode.');
  }

  if (isCloudWriteCooldownActive()) {
    throw new Error(
      'Cloud database daily free-tier write quota limit reached. Try again after quota resets.'
    );
  }

  const performWrite =
    deps?.writeModeToCloud ??
    (async (targetMode: FeaturedCardsMode, adminUid: string) => {
      const ref = doc(db, SHARED_FEATURED_CONFIG_COLLECTION, SHARED_FEATURED_CONFIG_DOC_ID);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        await updateDoc(ref, {
          mode: targetMode,
          updatedByUid: adminUid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          id: SHARED_FEATURED_CONFIG_DOC_ID,
          mode: targetMode,
          updatedByUid: adminUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

  try {
    await performWrite(normalizedMode, user.uid);
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      markCloudQuotaExhausted();
      throw new Error(
        'Cloud database daily quota limit reached while saving Featured Cards mode.'
      );
    }
    logFeaturedConfigError(err, OperationType.WRITE, SHARED_FEATURED_CONFIG_PATH);
    throw err;
  }

  const nextState: SharedFeaturedConfigState = {
    mode: normalizedMode,
    updatedByUid: user.uid,
    updatedAtIso: new Date().toISOString(),
    source: 'firestore',
  };
  writeCachedSharedFeaturedConfig(nextState);
  broadcastSharedFeaturedConfig(nextState);
  return nextState;
}
