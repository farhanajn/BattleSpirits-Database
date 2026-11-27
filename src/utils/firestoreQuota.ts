const QUOTA_COOLDOWN_STORAGE_KEY = 'spiritsdex_firestore_quota_cooldown_until_v1';
const MIN_COOLDOWN_MS = 30 * 60 * 1000;
const FALLBACK_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000 + 60 * 1000;

/**
 * Firestore daily free-tier quotas reset at 00:00 Pacific Time (America/Los_Angeles).
 */
export function computeMsUntilNextPacificMidnight(nowMs = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(nowMs));
    const map = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
    const hour = Number.isFinite(map.hour) ? map.hour % 24 : 0;
    const minute = Number.isFinite(map.minute) ? map.minute : 0;
    const second = Number.isFinite(map.second) ? map.second : 0;
    const elapsedTodayMs = ((hour * 60 + minute) * 60 + second) * 1000;
    const remainingMs = 24 * 60 * 60 * 1000 - elapsedTodayMs + 60 * 1000;
    return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, remainingMs));
  } catch {
    return FALLBACK_COOLDOWN_MS;
  }
}

function readStoredCooldownUntil(): number {
  const stores: Storage[] = [];
  try {
    if (typeof localStorage !== 'undefined') stores.push(localStorage);
  } catch {
    // ignore storage access issues
  }
  try {
    if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage);
  } catch {
    // ignore storage access issues
  }

  let maxTs = 0;
  for (const store of stores) {
    try {
      const raw = Number(store.getItem(QUOTA_COOLDOWN_STORAGE_KEY) || 0);
      if (Number.isFinite(raw) && raw > maxTs) {
        maxTs = raw;
      }
    } catch {
      // ignore storage access issues
    }
  }
  return maxTs;
}

let cloudQuotaCooldownUntil = (() => {
  const stored = readStoredCooldownUntil();
  return stored > Date.now() ? stored : 0;
})();

const quotaExhaustedListeners = new Set<() => void>();
const quotaClearedListeners = new Set<() => void>();

export function onCloudQuotaExhausted(listener: () => void): () => void {
  quotaExhaustedListeners.add(listener);
  return () => {
    quotaExhaustedListeners.delete(listener);
  };
}

export function onCloudQuotaCleared(listener: () => void): () => void {
  quotaClearedListeners.add(listener);
  return () => {
    quotaClearedListeners.delete(listener);
  };
}

export function createQuotaExceededError(
  message = 'Quota limit exceeded. Free daily Firestore write/read quota reached; resets tomorrow.'
): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'resource-exhausted';
  return err;
}

export function isFirestoreQuotaError(error: unknown): boolean {
  if (!error) return false;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : String(error);
  return (
    code === 'resource-exhausted' ||
    /resource-exhausted|Quota(?:\s+limit)?\s+exceeded|Free daily (?:write|read) units/i.test(message)
  );
}

export function getCloudQuotaCooldownUntil(): number {
  const now = Date.now();
  if (now < cloudQuotaCooldownUntil) return cloudQuotaCooldownUntil;
  const stored = readStoredCooldownUntil();
  if (stored > now) {
    cloudQuotaCooldownUntil = stored;
    return stored;
  }
  return 0;
}

export function isCloudQuotaCooldownActive(): boolean {
  return getCloudQuotaCooldownUntil() > Date.now();
}

export function isCloudWriteCooldownActive(): boolean {
  return isCloudQuotaCooldownActive();
}

export function markCloudQuotaExhausted(durationMs?: number): void {
  const wasActive = isCloudQuotaCooldownActive();
  const effectiveDuration =
    typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : computeMsUntilNextPacificMidnight();
  cloudQuotaCooldownUntil = Math.max(cloudQuotaCooldownUntil, Date.now() + effectiveDuration);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(QUOTA_COOLDOWN_STORAGE_KEY, String(cloudQuotaCooldownUntil));
    }
  } catch {
    // ignore storage access issues
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(QUOTA_COOLDOWN_STORAGE_KEY, String(cloudQuotaCooldownUntil));
    }
  } catch {
    // ignore storage access issues
  }
  if (!wasActive) {
    for (const listener of quotaExhaustedListeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }
}

export function clearCloudQuotaCooldown(): void {
  const wasActive = cloudQuotaCooldownUntil > 0 || readStoredCooldownUntil() > 0;
  cloudQuotaCooldownUntil = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(QUOTA_COOLDOWN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(QUOTA_COOLDOWN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  if (wasActive) {
    for (const listener of quotaClearedListeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }
}

/**
 * Guards Firestore write operations against SDK WriteStream `resource-exhausted` backoff hangs.
 * Firestore Web SDK treats `resource-exhausted` on writes as transient and retries every 60s
 * without rejecting the promise; this guard short-circuits immediately when cooldown is active
 * or triggers as soon as a quota error is observed.
 */
export async function guardFirestoreWrite<T>(
  operation: () => Promise<T>,
  options?: { timeoutMs?: number }
): Promise<T> {
  if (isCloudWriteCooldownActive()) {
    throw createQuotaExceededError();
  }

  let cleanupQuota: () => void = () => {};
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const abortPromise = new Promise<never>((_, reject) => {
    cleanupQuota = onCloudQuotaExhausted(() => {
      reject(createQuotaExceededError());
    });
    if (options?.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        reject(new Error('Firestore write timed out.'));
      }, options.timeoutMs);
    }
  });

  try {
    return await Promise.race([operation(), abortPromise]);
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      markCloudQuotaExhausted();
    }
    throw err;
  } finally {
    cleanupQuota();
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
