import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type ManualCardMapping,
  isValidManualFileName,
  isValidManualWikiTitle,
  listManualCardMappings,
} from './manualCardMappings.ts';
import { fetchWikiJson, WIKI_BASE } from './wikiService.ts';

export type ArtworkValidationStatus =
  | 'healthy'
  | 'broken'
  | 'redirected'
  | 'unverified'
  | 'temporarily_unavailable';

export type MappingType = 'direct_url' | 'wiki_file' | 'wiki_title';

export interface ArtworkValidationRecord {
  mappingKey: string;
  cardId: string;
  cardName: string;
  cardNumber: string;
  setCode: string;
  mappingType: MappingType;
  originalUrl: string;
  wikiTitle: string;
  fileName: string;
  status: ArtworkValidationStatus;
  httpStatus: number;
  finalUrl: string;
  redirectedFrom?: string;
  lastCheckedAt: string;
  lastSuccessAt: string;
  consecutiveFailures: number;
  failureReason: string;
  lastCycleId: string;
}

export interface ValidationCycleProgress {
  cycleId: string;
  triggerSource: 'manual' | 'scheduled' | 'retry_failed' | 'single' | 'resume';
  status: 'idle' | 'running' | 'paused' | 'completed';
  startedAt: string | null;
  completedAt: string | null;
  totalKeys: number;
  completedKeysCount: number;
  pendingKeys: string[];
}

export interface ValidationSchedulerState {
  intervalHours: number;
  inProcessTimerActive: boolean;
  lastScheduledRunAt: string | null;
  nextScheduledRunAt: string | null;
  cloudRunExternalCronEndpoint: string;
  cronSecretConfigured: boolean;
}

export interface ManualValidationState {
  updatedAt: string | null;
  cycle: ValidationCycleProgress;
  records: Record<string, ArtworkValidationRecord>;
  lastScheduledRunAt: string | null;
  nextScheduledRunAt: string | null;
}

export interface ManualValidationSummary {
  total: number;
  healthy: number;
  broken: number;
  redirected: number;
  temporarily_unavailable: number;
  unverified: number;
}

export interface ManualValidationDependencies {
  fetchFn?: typeof fetch;
  fetchWikiJsonFn?: (params: Record<string, string>) => Promise<Record<string, unknown>>;
  mappingsProvider?: () => ManualCardMapping[];
  stateFilePath?: string;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  concurrency?: number;
  batchSize?: number;
  intervalHours?: number;
}

const DEFAULT_RUNTIME_DIR =
  process.env.SPIRITSDEX_RUNTIME_DIR || '/tmp/spiritsdex-runtime';
const DEFAULT_VALIDATION_STATE_FILE = path.join(
  DEFAULT_RUNTIME_DIR,
  'manual-validation-state.json'
);

const DISALLOWED_ICON_RE =
  /(?:^|[_/\s:-])(?:(?:stan|red|purple|white|yellow|green|blue|gold|god|soul|ultimate|omni|all)[_\s]+)?(?:core|symbol|gem|ex[_\s]+symbol)(?:[_.\s]|$)|(?:stan_?soul_?core|soul_?core|ex_?symbol|reduction\.png|rarity_|button|banner\.jpe?g|flash\d+\.png|bursticon)/i;

const runningLocks = new Set<string>();
let activeSchedulerTimer: ReturnType<typeof setInterval> | null = null;
let activeCatchupTimer: ReturnType<typeof setTimeout> | null = null;

function resolveIntervalHours(overrideHours?: number): number {
  if (typeof overrideHours === 'number' && Number.isFinite(overrideHours) && overrideHours > 0) {
    return overrideHours;
  }
  const envRaw = Number(process.env.MANUAL_VALIDATION_INTERVAL_HOURS || 24);
  return Number.isFinite(envRaw) && envRaw > 0 ? envRaw : 24;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timingSafeSecretMatch(provided: string, expected: string): boolean {
  const hashProvided = crypto.createHash('sha256').update(provided).digest();
  const hashExpected = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

function extractHeaderValue(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return typeof val === 'string' ? val.trim() : '';
}

export function verifyScheduledValidationAuth(
  headers: Record<string, string | string[] | undefined>,
  expectedSecretInput = process.env.VALIDATION_CRON_SECRET
): {
  authorized: boolean;
  method: 'none' | 'x-validation-cron-secret' | 'bearer' | 'rejected';
} {
  const expected = (expectedSecretInput || '').trim();
  if (!expected) {
    return { authorized: true, method: 'none' };
  }

  const customSecret = extractHeaderValue(headers['x-validation-cron-secret']);
  if (customSecret && timingSafeSecretMatch(customSecret, expected)) {
    return { authorized: true, method: 'x-validation-cron-secret' };
  }

  const authHeader = extractHeaderValue(headers.authorization);
  if (/^Bearer\s+/i.test(authHeader)) {
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearerToken && timingSafeSecretMatch(bearerToken, expected)) {
      return { authorized: true, method: 'bearer' };
    }
  }

  return { authorized: false, method: 'rejected' };
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function buildDeterministicMappingKey(mapping: ManualCardMapping, index = 0): string {
  const seed =
    mapping.cardId?.trim() ||
    mapping.cardNumber?.trim() ||
    mapping.name?.trim() ||
    mapping.wikiTitle?.trim() ||
    `mapping-${index}`;
  const revTag =
    typeof mapping.isRevival === 'boolean' ? (mapping.isRevival ? '-rv' : '-orig') : '';
  const cleaned = `${seed}${revTag}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  const hash = crypto
    .createHash('sha1')
    .update(`${mapping.cardId || ''}|${mapping.cardNumber || ''}|${mapping.name || ''}|${mapping.isRevival ?? ''}|${index}`)
    .digest('hex')
    .slice(0, 8);
  return `${cleaned || 'mapping'}-${hash}`.slice(0, 128);
}

function inferSetCodeFromMapping(mapping: ManualCardMapping): string {
  const num = (mapping.cardNumber || '').trim().toUpperCase();
  const match = num.match(/^([A-Z0-9]+)-/);
  if (match) return match[1];
  const idMatch = (mapping.cardId || '').trim().toUpperCase().match(/^([A-Z0-9]+)-/);
  return idMatch ? idMatch[1] : '';
}

function classifyMappingType(mapping: ManualCardMapping): MappingType {
  if (mapping.artworkUrl?.trim()) return 'direct_url';
  if (mapping.fileName?.trim()) return 'wiki_file';
  return 'wiki_title';
}

function resolveDisplayOriginalUrl(mapping: ManualCardMapping): string {
  if (mapping.artworkUrl?.trim()) return mapping.artworkUrl.trim();
  if (mapping.fileName?.trim()) {
    return `${WIKI_BASE}File:${encodeURIComponent(
      mapping.fileName.trim().replace(/^File:/i, '').replace(/\s+/g, '_')
    )}`;
  }
  if (mapping.wikiTitle?.trim()) {
    return `${WIKI_BASE}${encodeURIComponent(
      mapping.wikiTitle.trim().replace(/\s+/g, '_')
    )}`;
  }
  return '';
}

function createInitialRecord(
  mapping: ManualCardMapping,
  index: number,
  existing?: ArtworkValidationRecord
): ArtworkValidationRecord {
  const mappingKey = buildDeterministicMappingKey(mapping, index);
  const mappingType = classifyMappingType(mapping);
  const originalUrl = resolveDisplayOriginalUrl(mapping);

  // If the URL or file/title changed cleanly on disk, reset status to unverified rather than keeping stale broken status
  const targetChanged =
    existing &&
    (existing.originalUrl !== originalUrl ||
      existing.wikiTitle !== (mapping.wikiTitle || '') ||
      existing.fileName !== (mapping.fileName || ''));

  return {
    mappingKey,
    cardId: (mapping.cardId || '').slice(0, 128),
    cardName: (mapping.name || mapping.wikiTitle || '').slice(0, 200),
    cardNumber: (mapping.cardNumber || '').slice(0, 64),
    setCode: inferSetCodeFromMapping(mapping).slice(0, 64),
    mappingType,
    originalUrl: originalUrl.slice(0, 1000),
    wikiTitle: (mapping.wikiTitle || '').slice(0, 200),
    fileName: (mapping.fileName || '').slice(0, 250),
    status: targetChanged ? 'unverified' : existing?.status || 'unverified',
    httpStatus: targetChanged ? 0 : existing?.httpStatus || 0,
    finalUrl: targetChanged ? '' : existing?.finalUrl || '',
    redirectedFrom: targetChanged ? undefined : existing?.redirectedFrom,
    lastCheckedAt: targetChanged ? '' : existing?.lastCheckedAt || '',
    lastSuccessAt: existing?.lastSuccessAt || '',
    consecutiveFailures: targetChanged ? 0 : existing?.consecutiveFailures || 0,
    failureReason: targetChanged ? '' : existing?.failureReason || '',
    lastCycleId: existing?.lastCycleId || '',
  };
}

function createEmptyState(): ManualValidationState {
  return {
    updatedAt: null,
    cycle: {
      cycleId: '',
      triggerSource: 'manual',
      status: 'idle',
      startedAt: null,
      completedAt: null,
      totalKeys: 0,
      completedKeysCount: 0,
      pendingKeys: [],
    },
    records: {},
    lastScheduledRunAt: null,
    nextScheduledRunAt: null,
  };
}

export function loadValidationState(
  stateFilePath = DEFAULT_VALIDATION_STATE_FILE
): ManualValidationState {
  try {
    if (fs.existsSync(stateFilePath)) {
      const raw = fs.readFileSync(stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ManualValidationState>;
      const base = createEmptyState();
      return {
        updatedAt: parsed.updatedAt || null,
        cycle: parsed.cycle ? { ...base.cycle, ...parsed.cycle } : base.cycle,
        records: parsed.records || {},
        lastScheduledRunAt: parsed.lastScheduledRunAt || null,
        nextScheduledRunAt: parsed.nextScheduledRunAt || null,
      };
    }
  } catch {
    // Corrupted state recovers cleanly
  }
  return createEmptyState();
}

export function saveValidationState(
  state: ManualValidationState,
  stateFilePath = DEFAULT_VALIDATION_STATE_FILE
): void {
  ensureDir(stateFilePath);
  state.updatedAt = new Date().toISOString();
  const tmpPath = `${stateFilePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, stateFilePath);
}

/**
 * Synchronizes current mappings from ManualWikiMapping into the validation state
 * without ever modifying or deleting original ManualWikiMapping entries.
 */
export function syncMappingsIntoValidationState(
  deps?: ManualValidationDependencies
): { state: ManualValidationState; entriesByKey: Map<string, ManualCardMapping> } {
  const filePath = deps?.stateFilePath || DEFAULT_VALIDATION_STATE_FILE;
  const state = loadValidationState(filePath);
  const mappings = (deps?.mappingsProvider || listManualCardMappings)();
  const entriesByKey = new Map<string, ManualCardMapping>();
  const activeKeys = new Set<string>();

  mappings.forEach((mapping, idx) => {
    const key = buildDeterministicMappingKey(mapping, idx);
    activeKeys.add(key);
    entriesByKey.set(key, mapping);
    state.records[key] = createInitialRecord(mapping, idx, state.records[key]);
  });

  // Remove orphaned validation status records only if mapping no longer exists in code
  for (const existingKey of Object.keys(state.records)) {
    if (!activeKeys.has(existingKey)) {
      delete state.records[existingKey];
    }
  }

  return { state, entriesByKey };
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function isPermanentBrokenHttpStatus(status: number): boolean {
  return status === 404 || status === 410;
}

function parseRetryAfterMs(headerVal: string | null): number {
  if (!headerVal) return 0;
  const secs = Number(headerVal);
  if (Number.isFinite(secs) && secs >= 0) {
    return Math.min(5000, Math.max(50, secs * 1000));
  }
  return 0;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface HttpCheckOutcome {
  status: ArtworkValidationStatus;
  httpStatus: number;
  finalUrl: string;
  redirectedFrom?: string;
  failureReason: string;
}

async function probeHttpUrlWithRedirects(
  targetUrl: string,
  deps?: ManualValidationDependencies
): Promise<HttpCheckOutcome> {
  const fetchFn = deps?.fetchFn || fetch;
  const timeoutMs = deps?.timeoutMs ?? 8000;
  const maxRetries = deps?.maxRetries ?? 2;
  const sleepFn = deps?.sleepFn || defaultSleep;

  let currentUrl = targetUrl;
  let redirectCount = 0;
  const maxHops = 5;
  let attempt = 0;

  while (true) {
    try {
      let method: 'HEAD' | 'GET' = 'HEAD';
      let res = await fetchWithTimeout(
        currentUrl,
        {
          method,
          redirect: 'manual',
          headers: { 'User-Agent': 'SpiritsdexLinkValidator/1.0' },
        },
        timeoutMs,
        fetchFn
      );

      // Fallback to lightweight ranged GET if server rejects HEAD
      if (res.status === 405 || res.status === 501 || res.status === 403 || res.status === 400) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        method = 'GET';
        res = await fetchWithTimeout(
          currentUrl,
          {
            method,
            redirect: 'manual',
            headers: {
              'User-Agent': 'SpiritsdexLinkValidator/1.0',
              Range: 'bytes=0-0',
            },
          },
          timeoutMs,
          fetchFn
        );
      }

      // Handle manual HTTP redirects
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        if (!location) {
          return {
            status: 'broken',
            httpStatus: res.status,
            finalUrl: currentUrl,
            failureReason: `HTTP ${res.status} redirect missing Location header`,
          };
        }
        if (redirectCount >= maxHops) {
          return {
            status: 'broken',
            httpStatus: res.status,
            finalUrl: currentUrl,
            failureReason: `Exceeded maximum redirect hops (${maxHops})`,
          };
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirectCount++;
        continue;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }

      if (res.status >= 200 && res.status < 300) {
        if (contentType.includes('text/html')) {
          return {
            status: 'broken',
            httpStatus: res.status,
            finalUrl: currentUrl,
            redirectedFrom: redirectCount > 0 ? targetUrl : undefined,
            failureReason: `Expected image resource but received ${contentType}`,
          };
        }
        return {
          status: redirectCount > 0 ? 'redirected' : 'healthy',
          httpStatus: res.status,
          finalUrl: currentUrl,
          redirectedFrom: redirectCount > 0 ? targetUrl : undefined,
          failureReason: redirectCount > 0 ? `Redirected (${redirectCount} hop${redirectCount > 1 ? 's' : ''}) to ${currentUrl}` : '',
        };
      }

      if (isPermanentBrokenHttpStatus(res.status)) {
        return {
          status: 'broken',
          httpStatus: res.status,
          finalUrl: currentUrl,
          redirectedFrom: redirectCount > 0 ? targetUrl : undefined,
          failureReason: `HTTP ${res.status} resource not found`,
        };
      }

      if (isTransientHttpStatus(res.status)) {
        if (attempt < maxRetries) {
          attempt++;
          const waitMs = parseRetryAfterMs(res.headers.get('retry-after')) || 150 * attempt;
          await sleepFn(waitMs);
          continue;
        }
        return {
          status: 'temporarily_unavailable',
          httpStatus: res.status,
          finalUrl: currentUrl,
          redirectedFrom: redirectCount > 0 ? targetUrl : undefined,
          failureReason:
            res.status === 429
              ? 'HTTP 429 rate limited after bounded retries'
              : `HTTP ${res.status} temporary upstream error`,
        };
      }

      return {
        status: 'broken',
        httpStatus: res.status,
        finalUrl: currentUrl,
        redirectedFrom: redirectCount > 0 ? targetUrl : undefined,
        failureReason: `Unexpected HTTP ${res.status}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = /timeout|abort/i.test(msg);
      if (attempt < maxRetries) {
        attempt++;
        await sleepFn(120 * attempt);
        continue;
      }
      return {
        status: 'temporarily_unavailable',
        httpStatus: 0,
        finalUrl: currentUrl,
        redirectedFrom: redirectCount > 0 ? targetUrl : undefined,
        failureReason: isTimeout ? `Timeout checking URL: ${msg}` : `Network error: ${msg}`,
      };
    }
  }
}

async function validateWikiMappingViaApi(
  mapping: ManualCardMapping,
  deps?: ManualValidationDependencies
): Promise<HttpCheckOutcome> {
  const wikiJsonFn = deps?.fetchWikiJsonFn || fetchWikiJson;
  const maxRetries = deps?.maxRetries ?? 2;
  const sleepFn = deps?.sleepFn || defaultSleep;

  // Step 1: Validate explicit File: image via MediaWiki API if fileName is set
  if (mapping.fileName?.trim()) {
    const cleanFile = mapping.fileName.trim().replace(/^File:/i, '').trim();
    if (!isValidManualFileName(cleanFile)) {
      return {
        status: 'broken',
        httpStatus: 400,
        finalUrl: '',
        failureReason: `Invalid fileName "${cleanFile}"`,
      };
    }

    let attempt = 0;
    while (true) {
      try {
        const data = await wikiJsonFn({
          action: 'query',
          titles: `File:${cleanFile}`,
          prop: 'imageinfo',
          iiprop: 'url|mime',
          redirects: '1',
        });
        const queryObj = (data.query || {}) as {
          pages?: Record<string, { missing?: unknown; imageinfo?: Array<{ url?: string; mime?: string }> }>;
          redirects?: Array<{ from: string; to: string }>;
        };
        const pages = Object.values(queryObj.pages || {});
        const page = pages[0];
        const info = page?.imageinfo?.[0];

        if (!page || page.missing !== undefined || !info?.url) {
          return {
            status: 'broken',
            httpStatus: 404,
            finalUrl: '',
            failureReason: `Wiki file "File:${cleanFile}" not found`,
          };
        }

        // Verify CDN artwork URL lightly with HTTP probe if fetchFn provided or external live mode
        const probe = await probeHttpUrlWithRedirects(info.url, deps);
        const wikiRedirected = (queryObj.redirects || []).length > 0;
        if (probe.status === 'healthy' && wikiRedirected) {
          return {
            ...probe,
            status: 'redirected',
            redirectedFrom: resolveDisplayOriginalUrl(mapping),
            failureReason: `Wiki File redirected to ${info.url}`,
          };
        }
        return probe;
      } catch (err) {
        if (attempt < maxRetries) {
          attempt++;
          await sleepFn(120 * attempt);
          continue;
        }
        return {
          status: 'temporarily_unavailable',
          httpStatus: 0,
          finalUrl: '',
          failureReason: `Wiki API error verifying File:${cleanFile}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        };
      }
    }
  }

  // Step 2: Validate wikiTitle page & confirm usable non-icon artwork/page exists
  const title = (mapping.wikiTitle || '').trim();
  if (!isValidManualWikiTitle(title)) {
    return {
      status: 'broken',
      httpStatus: 400,
      finalUrl: '',
      failureReason: `Invalid wikiTitle "${title}"`,
    };
  }

  let attempt = 0;
  while (true) {
    try {
      const data = await wikiJsonFn({
        action: 'query',
        titles: title,
        prop: 'revisions|images',
        rvprop: 'content',
        rvslots: 'main',
        imlimit: '50',
        redirects: '1',
      });
      const queryObj = (data.query || {}) as {
        pages?: Record<
          string,
          {
            title?: string;
            missing?: unknown;
            revisions?: Array<{ slots?: { main?: { '*'?: string } } }>;
            images?: Array<{ title?: string }>;
          }
        >;
        redirects?: Array<{ from: string; to: string }>;
      };

      const page = Object.values(queryObj.pages || {})[0];
      if (!page || page.missing !== undefined) {
        return {
          status: 'broken',
          httpStatus: 404,
          finalUrl: '',
          failureReason: `Wiki article "${title}" does not exist (missing)`,
        };
      }

      const wikitext = page.revisions?.[0]?.slots?.main?.['*'] || '';
      const imgMatch = wikitext.match(/\|\s*image\s*=\s*([^\n|}]+)/i);
      const rawImageFile = imgMatch ? imgMatch[1].replace(/^File:/i, '').trim() : '';
      const candidateFiles = [
        rawImageFile,
        ...(page.images || []).map((i) => (i.title || '').replace(/^File:/i, '').trim()),
      ].filter((f) => f && /\.(?:png|jpe?g|webp|gif)$/i.test(f) && !DISALLOWED_ICON_RE.test(f));

      const resolvedPageTitle = page.title || title;
      const redirected = (queryObj.redirects || []).length > 0;
      const pageUrl = `${WIKI_BASE}${encodeURIComponent(
        resolvedPageTitle.replace(/\s+/g, '_')
      )}`;

      if (candidateFiles.length === 0) {
        return {
          status: 'broken',
          httpStatus: 404,
          finalUrl: pageUrl,
          failureReason: `Wiki page "${resolvedPageTitle}" has no non-icon artwork file`,
        };
      }

      // Optionally resolve & HEAD-check top candidate image file
      const fileData = await wikiJsonFn({
        action: 'query',
        titles: `File:${candidateFiles[0]}`,
        prop: 'imageinfo',
        iiprop: 'url',
      });
      const filePages = Object.values(
        ((fileData.query || {}) as { pages?: Record<string, { imageinfo?: Array<{ url?: string }> }> }).pages || {}
      );
      const resolvedCdnUrl = filePages[0]?.imageinfo?.[0]?.url || pageUrl;

      if (resolvedCdnUrl !== pageUrl) {
        const cdnProbe = await probeHttpUrlWithRedirects(resolvedCdnUrl, deps);
        if (cdnProbe.status === 'healthy' && redirected) {
          return {
            ...cdnProbe,
            status: 'redirected',
            redirectedFrom: resolveDisplayOriginalUrl(mapping),
            failureReason: `Wiki title redirected from "${title}" to "${resolvedPageTitle}"`,
          };
        }
        return cdnProbe;
      }

      return {
        status: redirected ? 'redirected' : 'healthy',
        httpStatus: 200,
        finalUrl: resolvedCdnUrl,
        redirectedFrom: redirected ? resolveDisplayOriginalUrl(mapping) : undefined,
        failureReason: redirected ? `Wiki title redirected to "${resolvedPageTitle}"` : '',
      };
    } catch (err) {
      if (attempt < maxRetries) {
        attempt++;
        await sleepFn(120 * attempt);
        continue;
      }
      return {
        status: 'temporarily_unavailable',
        httpStatus: 0,
        finalUrl: '',
        failureReason: `Wiki API error checking title "${title}": ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      };
    }
  }
}

/**
 * Validates a single manual mapping record and produces an updated immutable status record.
 * Never alters or removes the underlying ManualWikiMapping entry.
 */
export async function validateSingleManualMapping(
  mapping: ManualCardMapping,
  existingRecord: ArtworkValidationRecord,
  cycleId: string,
  deps?: ManualValidationDependencies
): Promise<ArtworkValidationRecord> {
  const nowIso = new Date((deps?.nowFn || Date.now)()).toISOString();
  let outcome: HttpCheckOutcome;

  if (mapping.artworkUrl?.trim()) {
    const raw = mapping.artworkUrl.trim();
    if (raw.startsWith('/api/wiki/image')) {
      const qs = new URLSearchParams(raw.split('?')[1] || '');
      const synthetic: ManualCardMapping = {
        ...mapping,
        artworkUrl: undefined,
        fileName: qs.get('file') || undefined,
        wikiTitle: qs.get('title') || mapping.wikiTitle,
      };
      outcome = await validateWikiMappingViaApi(synthetic, deps);
    } else {
      outcome = await probeHttpUrlWithRedirects(raw, deps);
    }
  } else {
    outcome = await validateWikiMappingViaApi(mapping, deps);
  }

  const isSuccess = outcome.status === 'healthy' || outcome.status === 'redirected';
  const nextFailures = isSuccess
    ? 0
    : existingRecord.consecutiveFailures + 1;

  // CRITICAL: Temporary errors MUST NEVER permanently wipe out prior lastSuccessAt
  // or turn a healthy link into permanently broken!
  return {
    ...existingRecord,
    status: outcome.status,
    httpStatus: outcome.httpStatus,
    finalUrl: outcome.finalUrl,
    redirectedFrom: outcome.redirectedFrom,
    lastCheckedAt: nowIso,
    lastSuccessAt: isSuccess ? nowIso : existingRecord.lastSuccessAt,
    consecutiveFailures: nextFailures,
    failureReason: outcome.failureReason.slice(0, 500),
    lastCycleId: cycleId,
  };
}

export function summarizeValidationRecords(
  records: ArtworkValidationRecord[]
): ManualValidationSummary {
  const summary: ManualValidationSummary = {
    total: records.length,
    healthy: 0,
    broken: 0,
    redirected: 0,
    temporarily_unavailable: 0,
    unverified: 0,
  };
  for (const r of records) {
    summary[r.status]++;
  }
  return summary;
}

export function getValidationDashboardSnapshot(
  options?: { status?: string; q?: string },
  deps?: ManualValidationDependencies
): {
  summary: ManualValidationSummary;
  records: ArtworkValidationRecord[];
  cycle: ValidationCycleProgress;
  scheduler: ValidationSchedulerState;
} {
  const filePath = deps?.stateFilePath || DEFAULT_VALIDATION_STATE_FILE;
  const { state } = syncMappingsIntoValidationState(deps);
  const allRecords = Object.values(state.records);
  const summary = summarizeValidationRecords(allRecords);

  let filtered = allRecords;
  if (options?.status && options.status !== 'all') {
    filtered = filtered.filter((r) => r.status === options.status);
  }
  if (options?.q?.trim()) {
    const q = options.q.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.cardName.toLowerCase().includes(q) ||
        r.cardNumber.toLowerCase().includes(q) ||
        r.setCode.toLowerCase().includes(q) ||
        r.originalUrl.toLowerCase().includes(q) ||
        r.wikiTitle.toLowerCase().includes(q)
    );
  }

  filtered.sort((a, b) => a.cardNumber.localeCompare(b.cardNumber) || a.cardName.localeCompare(b.cardName));

  const intervalHours = resolveIntervalHours(deps?.intervalHours);
  return {
    summary,
    records: filtered,
    cycle: state.cycle,
    scheduler: {
      intervalHours,
      inProcessTimerActive: Boolean(activeSchedulerTimer),
      lastScheduledRunAt: state.lastScheduledRunAt,
      nextScheduledRunAt: state.nextScheduledRunAt,
      cloudRunExternalCronEndpoint: 'POST /api/admin/validation/scheduled',
      cronSecretConfigured: Boolean(process.env.VALIDATION_CRON_SECRET),
    },
  };
}

export async function runManualValidationJob(
  options?: {
    mappingKeys?: string[];
    retryFailedOnly?: boolean;
    resumeInterrupted?: boolean;
    triggerSource?: ValidationCycleProgress['triggerSource'];
  },
  deps?: ManualValidationDependencies
): Promise<{
  skippedOverlap?: boolean;
  summary: ManualValidationSummary;
  records: ArtworkValidationRecord[];
  cycle: ValidationCycleProgress;
}> {
  const filePath = deps?.stateFilePath || DEFAULT_VALIDATION_STATE_FILE;
  if (runningLocks.has(filePath)) {
    const snap = getValidationDashboardSnapshot(undefined, deps);
    return { skippedOverlap: true, ...snap };
  }
  runningLocks.add(filePath);

  const nowFn = deps?.nowFn || Date.now;
  try {
    const { state, entriesByKey } = syncMappingsIntoValidationState(deps);
    let targetKeys: string[] = [];

    if (options?.mappingKeys?.length) {
      targetKeys = options.mappingKeys.filter((k) => entriesByKey.has(k));
    } else if (options?.resumeInterrupted && state.cycle.pendingKeys.length > 0) {
      targetKeys = state.cycle.pendingKeys.filter((k) => entriesByKey.has(k));
    } else if (options?.retryFailedOnly) {
      targetKeys = Object.values(state.records)
        .filter(
          (r) =>
            r.status === 'broken' ||
            r.status === 'temporarily_unavailable' ||
            r.status === 'unverified'
        )
        .map((r) => r.mappingKey);
    } else {
      targetKeys = Array.from(entriesByKey.keys());
    }

    const resuming = Boolean(options?.resumeInterrupted && state.cycle.pendingKeys.length > 0);
    const cycleId = resuming && state.cycle.cycleId
      ? state.cycle.cycleId
      : `val-${nowFn()}-${crypto.randomBytes(3).toString('hex')}`;

    state.cycle = {
      cycleId,
      triggerSource: options?.triggerSource || (options?.retryFailedOnly ? 'retry_failed' : 'manual'),
      status: 'running',
      startedAt: resuming && state.cycle.startedAt ? state.cycle.startedAt : new Date(nowFn()).toISOString(),
      completedAt: null,
      totalKeys: resuming ? Math.max(state.cycle.totalKeys, targetKeys.length) : targetKeys.length,
      completedKeysCount: resuming ? state.cycle.completedKeysCount : 0,
      pendingKeys: [...targetKeys],
    };
    saveValidationState(state, filePath);

    const concurrency = Math.max(1, Math.min(8, deps?.concurrency ?? 4));
    const batchSize = Math.max(1, deps?.batchSize ?? 5);

    for (let i = 0; i < targetKeys.length; i += batchSize) {
      const batch = targetKeys.slice(i, i + batchSize);
      const pendingSet = new Set(state.cycle.pendingKeys);

      for (let j = 0; j < batch.length; j += concurrency) {
        const chunk = batch.slice(j, j + concurrency);
        await Promise.all(
          chunk.map(async (key) => {
            const mapping = entriesByKey.get(key);
            const rec = state.records[key];
            if (!mapping || !rec) return;
            const updated = await validateSingleManualMapping(mapping, rec, cycleId, deps);
            state.records[key] = updated;
            pendingSet.delete(key);
            state.cycle.completedKeysCount++;
          })
        );
      }

      state.cycle.pendingKeys = Array.from(pendingSet);
      saveValidationState(state, filePath);
    }

    const doneIso = new Date(nowFn()).toISOString();
    state.cycle.status = 'completed';
    state.cycle.completedAt = doneIso;
    state.cycle.pendingKeys = [];
    if (state.cycle.triggerSource === 'scheduled') {
      const intervalHours = resolveIntervalHours(deps?.intervalHours);
      state.lastScheduledRunAt = doneIso;
      state.nextScheduledRunAt = new Date(nowFn() + intervalHours * 3600_000).toISOString();
    }
    saveValidationState(state, filePath);

    const allRecords = Object.values(state.records);
    return {
      summary: summarizeValidationRecords(allRecords),
      records: allRecords,
      cycle: state.cycle,
    };
  } finally {
    runningLocks.delete(filePath);
  }
}

export async function validateSingleMappingByKey(
  mappingKey: string,
  deps?: ManualValidationDependencies
): Promise<ArtworkValidationRecord | null> {
  const filePath = deps?.stateFilePath || DEFAULT_VALIDATION_STATE_FILE;
  const { state, entriesByKey } = syncMappingsIntoValidationState(deps);
  if (!entriesByKey.has(mappingKey)) return null;

  await runManualValidationJob(
    { mappingKeys: [mappingKey], triggerSource: 'single' },
    deps
  );
  const refreshed = loadValidationState(filePath);
  return refreshed.records[mappingKey] || state.records[mappingKey] || null;
}

export async function triggerScheduledValidation(deps?: ManualValidationDependencies) {
  const nowFn = deps?.nowFn || Date.now;
  const intervalHours = resolveIntervalHours(deps?.intervalHours);
  const filePath = deps?.stateFilePath || DEFAULT_VALIDATION_STATE_FILE;
  const state = loadValidationState(filePath);

  const resumePending = state.cycle.status === 'running' && state.cycle.pendingKeys.length > 0;
  const result = await runManualValidationJob(
    {
      resumeInterrupted: resumePending,
      triggerSource: 'scheduled',
    },
    deps
  );

  // Ensure schedule timestamps are updated even if resumed or zero-item run
  if (!result.skippedOverlap) {
    const nextState = loadValidationState(filePath);
    const doneIso = new Date(nowFn()).toISOString();
    nextState.lastScheduledRunAt = doneIso;
    nextState.nextScheduledRunAt = new Date(nowFn() + intervalHours * 3600_000).toISOString();
    saveValidationState(nextState, filePath);
  }

  return result;
}

export function startManualValidationScheduler(deps?: ManualValidationDependencies): () => void {
  const intervalHours = resolveIntervalHours(deps?.intervalHours);
  const intervalMs = Math.max(60_000, Math.round(intervalHours * 3600_000));
  const filePath = deps?.stateFilePath || DEFAULT_VALIDATION_STATE_FILE;

  // Record next run estimate immediately if empty
  const { state } = syncMappingsIntoValidationState(deps);
  if (!state.nextScheduledRunAt) {
    state.nextScheduledRunAt = new Date(Date.now() + intervalMs).toISOString();
  }
  saveValidationState(state, filePath);

  if (activeSchedulerTimer) clearInterval(activeSchedulerTimer);
  if (activeCatchupTimer) clearTimeout(activeCatchupTimer);

  // Startup catch-up check after 15s: resumes interrupted cycle or runs if overdue by > intervalHours
  activeCatchupTimer = setTimeout(() => {
    const current = loadValidationState(filePath);
    const interrupted = current.cycle.pendingKeys.length > 0;
    const lastRunMs = current.lastScheduledRunAt ? Date.parse(current.lastScheduledRunAt) : 0;
    const overdue = !lastRunMs || Date.now() - lastRunMs >= intervalMs;
    if (interrupted || overdue) {
      void triggerScheduledValidation(deps).catch((err) => {
        console.warn('Scheduled manual artwork validation catch-up warning:', err);
      });
    }
  }, 15_000);
  if (typeof activeCatchupTimer.unref === 'function') {
    activeCatchupTimer.unref();
  }

  activeSchedulerTimer = setInterval(() => {
    void triggerScheduledValidation(deps).catch((err) => {
      console.warn('Periodic manual artwork validation warning:', err);
    });
  }, intervalMs);
  if (typeof activeSchedulerTimer.unref === 'function') {
    activeSchedulerTimer.unref();
  }

  return () => {
    if (activeCatchupTimer) {
      clearTimeout(activeCatchupTimer);
      activeCatchupTimer = null;
    }
    if (activeSchedulerTimer) {
      clearInterval(activeSchedulerTimer);
      activeSchedulerTimer = null;
    }
  };
}
