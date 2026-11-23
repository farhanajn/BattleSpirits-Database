import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type IdTokenResult, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ADMIN_EMAILS } from '../utils/catalogCloudSync';

export interface AdminStatusState {
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
}

export interface ResolveAdminDependencies {
  getIdTokenResult?: (user: User, forceRefresh?: boolean) => Promise<IdTokenResult>;
  hasFirestoreAdminRecord?: (uid: string) => Promise<boolean>;
}

async function defaultHasFirestoreAdminRecord(uid: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  try {
    const marker = await Promise.race([
      getDoc(doc(db, 'admins', uid)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!marker) return false;
    return marker.exists() && marker.data()?.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Strictly fail-closed administrator resolver.
 * Inspects the Firebase Auth user's ID token custom claims (`claims.admin === true`),
 * verified authorized admin email allowlist (`ADMIN_EMAILS`), and Firestore `admins/{uid}`
 * marker document. Never infers admin status from authentication alone.
 */
export async function resolveAdminStatusFromUser(
  user: User | null,
  deps?: ResolveAdminDependencies
): Promise<boolean> {
  if (!user || user.isAnonymous) {
    return false;
  }

  const readTokenResult =
    deps?.getIdTokenResult ?? ((u: User, forceRefresh?: boolean) => u.getIdTokenResult(forceRefresh));
  const checkAdminDoc = deps?.hasFirestoreAdminRecord ?? defaultHasFirestoreAdminRecord;

  try {
    const tokenResult = await readTokenResult(user, false);
    const claims = (tokenResult?.claims || {}) as Record<string, unknown>;

    // Primary check: explicit Firebase Auth custom claim `admin: true`
    if (claims.admin === true) {
      return true;
    }

    // Verified identity required before evaluating allowlist or Firestore admin record
    const emailVerified = user.emailVerified === true || claims.email_verified === true;
    if (!emailVerified) {
      return false;
    }

    const tokenEmail = typeof claims.email === 'string' ? claims.email : '';
    const candidateEmail = (tokenEmail || user.email || '').trim().toLowerCase();
    if (candidateEmail && ADMIN_EMAILS.has(candidateEmail)) {
      return true;
    }

    if (user.uid) {
      const hasAdminRecord = await checkAdminDoc(user.uid);
      if (hasAdminRecord) {
        return true;
      }
    }

    return false;
  } catch {
    // Fail closed on any token inspection or verification error
    return false;
  }
}

/**
 * React hook that verifies whether the current authenticated Firebase user
 * holds verified administrator privileges.
 *
 * Usage:
 * - `useAdmin()` observes `auth` state directly via `onAuthStateChanged`.
 * - `useAdmin(currentUser, authReady)` synchronizes immediately with parent auth state.
 *
 * Fail-closed guarantees:
 * - Never initializes `isAdmin` as `true`.
 * - Synchronously resets effective `isAdmin` to `false` on logout or account switch.
 * - Never leaks a prior administrator's state while a new verification is in flight.
 */
export function useAdmin(
  controlledUser?: User | null,
  controlledAuthReady?: boolean
): AdminStatusState {
  const isControlled = controlledUser !== undefined;

  const [internalUser, setInternalUser] = useState<User | null>(() =>
    isControlled ? controlledUser : auth.currentUser
  );
  const [internalAuthReady, setInternalAuthReady] = useState<boolean>(() =>
    isControlled ? (controlledAuthReady ?? true) : false
  );

  useEffect(() => {
    if (isControlled) {
      setInternalUser(controlledUser ?? null);
      setInternalAuthReady(controlledAuthReady ?? true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      setInternalUser(user);
      setInternalAuthReady(true);
    });
    return () => unsub();
  }, [isControlled, controlledUser, controlledAuthReady]);

  const activeUser = isControlled ? (controlledUser ?? null) : internalUser;
  const activeAuthReady = isControlled ? (controlledAuthReady ?? true) : internalAuthReady;
  const activeUid = activeUser?.uid ?? null;

  const [verifiedUid, setVerifiedUid] = useState<string | null>(null);
  const [verifiedResult, setVerifiedResult] = useState<boolean>(false);
  const [resolving, setResolving] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++requestSeqRef.current;

    if (!activeAuthReady) {
      setVerifiedUid(null);
      setVerifiedResult(false);
      setResolving(true);
      setError(null);
      return;
    }

    if (!activeUser || !activeUid) {
      setVerifiedUid(null);
      setVerifiedResult(false);
      setResolving(false);
      setError(null);
      return;
    }

    setVerifiedUid(null);
    setVerifiedResult(false);
    setResolving(true);
    setError(null);

    let cancelled = false;

    void resolveAdminStatusFromUser(activeUser)
      .then((ok) => {
        if (cancelled || requestSeqRef.current !== seq) return;
        setVerifiedUid(activeUid);
        setVerifiedResult(ok === true);
        setResolving(false);
      })
      .catch((err) => {
        if (cancelled || requestSeqRef.current !== seq) return;
        setVerifiedUid(activeUid);
        setVerifiedResult(false);
        setError(err instanceof Error ? err.message : 'Admin verification failed');
        setResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeAuthReady, activeUser, activeUid]);

  // Synchronous fail-closed gate: never leak previous user's admin state across re-renders
  const isSameUserVerified = Boolean(activeAuthReady && activeUser && activeUid && verifiedUid === activeUid);
  const effectiveLoading = !activeAuthReady || (Boolean(activeUser) && (resolving || !isSameUserVerified));
  const effectiveIsAdmin = Boolean(!effectiveLoading && isSameUserVerified && verifiedResult === true);

  return {
    isAdmin: effectiveIsAdmin,
    loading: effectiveLoading,
    error,
  };
}
