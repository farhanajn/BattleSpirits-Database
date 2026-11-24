const QUOTA_COOLDOWN_STORAGE_KEY = 'spiritsdex_firestore_quota_cooldown_until_v1';
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

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

export function isCloudQuotaCooldownActive(): boolean {
  const now = Date.now();
  if (now < cloudQuotaCooldownUntil) return true;
  const stored = readStoredCooldownUntil();
  if (stored > now) {
    cloudQuotaCooldownUntil = stored;
    return true;
  }
  return false;
}

export function isCloudWriteCooldownActive(): boolean {
  return isCloudQuotaCooldownActive();
}

export function markCloudQuotaExhausted(durationMs = DEFAULT_COOLDOWN_MS): void {
  cloudQuotaCooldownUntil = Math.max(cloudQuotaCooldownUntil, Date.now() + durationMs);
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
}

export function clearCloudQuotaCooldown(): void {
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
}
