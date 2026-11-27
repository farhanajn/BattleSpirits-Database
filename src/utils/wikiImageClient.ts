import type { BattleSpiritsCard } from '../types/card';
import {
  getManualWikiMapping,
  isValidManualArtworkUrl,
  resolveManualMappingArtworkUrl,
  type ManualWikiMappingEntry,
} from './ManualWikiMapping';

export type WikiImageCacheStatus = 'loaded' | 'error';

export type ClientLookupStage =
  | 'manual-mapping'
  | 'exact-name'
  | 'normalized-name'
  | 'set-plus-number'
  | 'japanese-name';

export interface WikiImageApiMetadataResponse {
  ok: boolean;
  wikiUrl: string | null;
  proxyUrl?: string | null;
  resolvedFile?: string | null;
  resolvedTitle?: string | null;
  stage?: string | null;
  stagesAttempted?: string[];
  wikiSearchResults?: string[];
  failureReason?: string | null;
  needsManualMapping?: boolean;
}

export interface SequentialLookupResult {
  ok: boolean;
  url: string | null;
  proxyUrl: string | null;
  resolvedFile: string | null;
  resolvedTitle: string | null;
  stage: ClientLookupStage | null;
  stagesAttempted: ClientLookupStage[];
  wikiSearchResults: string[];
  failureReason: string | null;
  needsManualMapping: boolean;
  manualMapping?: ManualWikiMappingEntry;
  fromCache?: boolean;
}

interface PersistedImageEntry {
  s: WikiImageCacheStatus;
  t: number;
}

interface CachedSequentialEntry {
  result: SequentialLookupResult;
  expiresAt: number;
}

const STORAGE_KEY = 'spiritsdex_wiki_img_cache_v1';
const LOADED_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const ERROR_TTL_MS = 1000 * 60 * 5; // 5 minutes
const SESSION_FAIL_TTL_MS = 1000 * 60 * 15; // 15 minutes within active session
const MAX_PERSISTED_ENTRIES = 2500;
const MAX_RESOLUTION_CACHE = 4000;

const LEGACY_PLACEHOLDER_RE =
  /^bs_(?:red_dragon|purple_phantom|white_mecha|yellow_seraph|green_beast|blue_titan|contract_|standard_banner|arcane_magic|relic_brave)/i;

const DISALLOWED_CARD_ICON_RE =
  /(?:^|[_/\s:-])(?:(?:stan|red|purple|white|yellow|green|blue|gold|god|soul|ultimate|omni|all)[_\s]+)?(?:core|symbol|gem|ex[_\s]+symbol)(?:[_.\s]|$)|(?:^|[_/\s:-])(?:reduction|flash\d*|bursticon|burst_?mark|mirage\d*|contract\d*|flag\d*|lv\d+|block[_\s]?\d*|rarity|icon|symbol|banner|logo|mini|mark|counter|button|template)\.(?:png|jpe?g|webp|gif|svg)|^(?:(?:left|right|up|down|next|prev|back)[_\s-]*)?arrow\d*\.(?:png|jpe?g|webp|gif|svg)|(?:stan_?soul_?core|soul_?core|ex_?symbol|reduction\.png|rarity_|button|banner\.jpe?g)/i;

const memoryStatusCache = new Map<string, PersistedImageEntry>();
const inflightPreloads = new Map<string, Promise<boolean>>();
const sequentialResolutionCache = new Map<string, CachedSequentialEntry>();
const inflightCardResolutions = new Map<string, Promise<SequentialLookupResult>>();
const sessionFailedCards = new Map<string, { reason: string; failedAt: number }>();

let storageHydrated = false;
let persistTimer: number | null = null;

function hydrateStatusCache() {
  if (storageHydrated || typeof window === 'undefined') return;
  storageHydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PersistedImageEntry>;
    if (!parsed || typeof parsed !== 'object') return;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || (v.s !== 'loaded' && v.s !== 'error') || typeof v.t !== 'number') continue;
      const ttl = v.s === 'loaded' ? LOADED_TTL_MS : ERROR_TTL_MS;
      if (now - v.t < ttl) {
        memoryStatusCache.set(k, v);
      }
    }
  } catch {
    // ignore corrupted cache
  }
}

function schedulePersistStatusCache() {
  if (typeof window === 'undefined') return;
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      if (memoryStatusCache.size > MAX_PERSISTED_ENTRIES) {
        const overflow = memoryStatusCache.size - (MAX_PERSISTED_ENTRIES - 250);
        let removed = 0;
        for (const key of memoryStatusCache.keys()) {
          memoryStatusCache.delete(key);
          removed++;
          if (removed >= overflow) break;
        }
      }
      const obj: Record<string, PersistedImageEntry> = {};
      for (const [k, v] of memoryStatusCache.entries()) {
        obj[k] = v;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignore localStorage quota errors
    }
  }, 1200);
}

export function getCachedWikiImageStatus(url: string): WikiImageCacheStatus | null {
  if (!url) return null;
  hydrateStatusCache();
  const entry = memoryStatusCache.get(url);
  if (!entry) return null;
  const ttl = entry.s === 'loaded' ? LOADED_TTL_MS : ERROR_TTL_MS;
  if (Date.now() - entry.t >= ttl) {
    memoryStatusCache.delete(url);
    return null;
  }
  return entry.s;
}

export function markWikiImageLoaded(url: string) {
  if (!url) return;
  hydrateStatusCache();
  memoryStatusCache.set(url, { s: 'loaded', t: Date.now() });
  schedulePersistStatusCache();
}

export function markWikiImageError(url: string) {
  if (!url) return;
  hydrateStatusCache();
  memoryStatusCache.set(url, { s: 'error', t: Date.now() });
  schedulePersistStatusCache();
}

export function getCardLookupKey(
  card: Pick<BattleSpiritsCard, 'id' | 'cardNumber' | 'name' | 'jpName' | 'isRevival'>
): string {
  const id = (card.id || '').trim().toLowerCase();
  const num = (card.cardNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  const rev = card.isRevival ? 'rv' : 'orig';
  if (id) return `${id}|${num}|${rev}`;
  const name = (card.name || card.jpName || '').trim().toLowerCase();
  return `num:${num}|name:${name}|${rev}`;
}

export function isCardSessionLookupFailed(
  card: Pick<BattleSpiritsCard, 'id' | 'cardNumber' | 'name' | 'jpName' | 'isRevival'>
): boolean {
  const key = getCardLookupKey(card);
  const entry = sessionFailedCards.get(key);
  if (!entry) return false;
  if (Date.now() - entry.failedAt >= SESSION_FAIL_TTL_MS) {
    sessionFailedCards.delete(key);
    return false;
  }
  return true;
}

export function markCardSessionLookupFailed(
  card: Pick<BattleSpiritsCard, 'id' | 'cardNumber' | 'name' | 'jpName' | 'isRevival'>,
  reason = 'Artwork unavailable on Wiki'
) {
  const key = getCardLookupKey(card);
  sessionFailedCards.set(key, { reason, failedAt: Date.now() });
}

export function clearCardSessionLookupFailure(
  card: Pick<BattleSpiritsCard, 'id' | 'cardNumber' | 'name' | 'jpName' | 'isRevival'>
) {
  sessionFailedCards.delete(getCardLookupKey(card));
}

export function normalizeCardNameForMatch(raw: string): string {
  return (raw || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC`´]/g, "'")
    .replace(/[\u201C\u201D"]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\((?:revival|alt(?:\s*art)?|parallel|secret|promo|side\s*[ab]|[ab])\)/gi, ' ')
    .replace(/['’]s\b/gi, 's')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ARABIC_TO_ROMAN: Array<[string, string]> = [
  ['12', 'XII'],
  ['11', 'XI'],
  ['10', 'X'],
  ['9', 'IX'],
  ['8', 'VIII'],
  ['7', 'VII'],
  ['6', 'VI'],
  ['5', 'V'],
  ['4', 'IV'],
  ['3', 'III'],
  ['2', 'II'],
  ['1', 'I'],
];

const ROMAN_TO_ARABIC: Record<string, string> = {
  XII: '12',
  XI: '11',
  X: '10',
  IX: '9',
  VIII: '8',
  VII: '7',
  VI: '6',
  V: '5',
  IV: '4',
  III: '3',
  II: '2',
  I: '1',
};

export function expandRomanNumeralVariants(raw: string): string[] {
  const base = (raw || '').trim();
  if (!base) return [];
  const variants = new Set<string>([base]);

  // Arabic -> Roman (e.g. "Type-10" -> "Type-X", "MK-8" -> "MK-VIII", "Ramsets 2" -> "Ramsets II")
  for (const [arabic, roman] of ARABIC_TO_ROMAN) {
    const re = new RegExp(`(^|[\\s\\-])${arabic}(?=$|[\\s\\-:,])`, 'g');
    if (re.test(base)) {
      variants.add(base.replace(re, `$1${roman}`));
    }
  }

  // Roman -> Arabic
  const romanRe = /(^|[\s-])(XII|XI|IX|VIII|VII|VI|IV|III|II|X|V|I)(?=$|[\s-:,])/gi;
  if (romanRe.test(base)) {
    variants.add(
      base.replace(romanRe, (_m, prefix: string, tok: string) => {
        const arabic = ROMAN_TO_ARABIC[tok.toUpperCase()];
        return arabic ? `${prefix}${arabic}` : `${prefix}${tok}`;
      })
    );
  }

  // Strip subtitle after " - " or ": "
  const noSubtitle = base.replace(/\s+[-–—:]\s+[^-–—:]+$/, '').trim();
  if (noSubtitle && noSubtitle !== base && noSubtitle.length >= 3) {
    variants.add(noSubtitle);
  }

  return Array.from(variants);
}

function tokenizeNormalizedTitle(raw: string): string[] {
  const spacedCamel = (raw || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return normalizeCardNameForMatch(spacedCamel)
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t !== 'the' && t !== 'of' && t !== 'and');
}

export function isNonCardArtworkUrlOrFile(urlOrFile?: string | null): boolean {
  const raw = (urlOrFile || '').trim();
  if (!raw) return true;
  const lastSegment = raw.split('/revision/')[0].split('/').pop() || raw;
  let decoded = lastSegment;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    // keep raw
  }
  const clean = decoded.replace(/^(?:File|Image):/i, '').trim();
  if (!clean) return true;
  if (LEGACY_PLACEHOLDER_RE.test(clean)) return true;
  return DISALLOWED_CARD_ICON_RE.test(clean);
}

export function validateClientCandidateMatch(
  card: Partial<BattleSpiritsCard>,
  candidate: WikiImageApiMetadataResponse,
  stage: ClientLookupStage
): { valid: boolean; reason?: string } {
  if (!candidate || !candidate.ok || (!candidate.wikiUrl && !candidate.proxyUrl)) {
    return { valid: false, reason: candidate?.failureReason || 'No artwork URL returned' };
  }

  if (candidate.resolvedFile && isNonCardArtworkUrlOrFile(candidate.resolvedFile)) {
    return { valid: false, reason: `Rejected non-card Wiki icon: ${candidate.resolvedFile}` };
  }
  if (candidate.wikiUrl && isNonCardArtworkUrlOrFile(candidate.wikiUrl)) {
    return { valid: false, reason: 'Rejected non-card Wiki asset URL' };
  }

  // Manual mappings are explicitly verified overrides
  if (stage === 'manual-mapping' || candidate.stage === 'stage0:manual-mapping') {
    return { valid: true };
  }

  // Enforce Side B consistency when cardNumber ends with (B)
  const cardNumUpper = (card.cardNumber || '').trim().toUpperCase();
  if (/\(B\)$/.test(cardNumUpper) && candidate.resolvedFile) {
    const fileLower = candidate.resolvedFile.toLowerCase();
    const basePrefix = cardNumUpper.replace(/\(B\)$/, '').toLowerCase();
    const looksLikeSideAFile =
      fileLower.includes(basePrefix) &&
      !/(?:_b\b|-b\b|\(b\)|side[\s_-]*b|back)/i.test(fileLower);
    if (looksLikeSideAFile) {
      return { valid: false, reason: `Rejected Side-A file (${candidate.resolvedFile}) for Side-B card` };
    }
  }

  // If stage searched by cardNumber or jpName or if card has no Latin name, verify resolvedTitle isn't wildly unrelated when comparable
  const queryTitle = (card.wikiTitle || card.name || '').trim();
  const resolvedTitle = (candidate.resolvedTitle || '').trim();
  const hasComparableLatinQuery = /[A-Za-z]{3,}/.test(queryTitle);
  const hasComparableLatinResult = /[A-Za-z]{3,}/.test(resolvedTitle);

  if (
    stage === 'exact-name' &&
    hasComparableLatinQuery &&
    hasComparableLatinResult &&
    normEqualsFuzzy(queryTitle, resolvedTitle) === false
  ) {
    const qTokens = tokenizeNormalizedTitle(queryTitle);
    const rTokens = new Set(tokenizeNormalizedTitle(resolvedTitle));
    const overlap = qTokens.filter((t) => rTokens.has(t)).length;
    const fileHasCardNum = Boolean(
      cardNumUpper &&
        candidate.resolvedFile &&
        candidate.resolvedFile.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(
          cardNumUpper.replace(/\(B\)$/, '').replace(/[^A-Z0-9]/g, '')
        )
    );
    if (qTokens.length > 0 && overlap < 1 && !fileHasCardNum) {
      return {
        valid: false,
        reason: `Title mismatch in exact stage (${resolvedTitle} vs ${queryTitle})`,
      };
    }
  }

  return { valid: true };
}

function normEqualsFuzzy(a: string, b: string): boolean {
  return normalizeCardNameForMatch(a) === normalizeCardNameForMatch(b);
}

function buildWikiEndpointUrl(params: {
  id?: string;
  file?: string;
  fallback?: string;
  title?: string;
  name?: string;
  jpName?: string;
  setCode?: string;
  isRevival?: boolean;
  stage?: 'exact' | 'normalized' | 'set_number' | 'japanese' | 'all';
  endpoint?: '/api/wiki/image' | '/api/wiki/image-url';
}): string {
  const qs = new URLSearchParams();
  if (params.file) qs.set('file', params.file);
  if (params.fallback) qs.set('fallback', params.fallback);
  if (params.title) qs.set('title', params.title);
  if (params.name && params.name.trim() && params.name.trim() !== params.title?.trim()) {
    qs.set('name', params.name.trim());
  }
  if (params.jpName) qs.set('jp', params.jpName);
  if (params.setCode) qs.set('set', params.setCode);
  if (params.isRevival) qs.set('rv', '1');
  if (params.id) qs.set('id', params.id);
  if (params.stage && params.stage !== 'all') qs.set('stage', params.stage);
  const str = qs.toString();
  const base = params.endpoint || '/api/wiki/image';
  return str ? `${base}?${str}` : '';
}

function getCardMetaParams(card: BattleSpiritsCard) {
  return {
    id: card.id?.trim() || undefined,
    fallback: card.cardNumber?.trim() || undefined,
    title: (card.wikiTitle || card.name || '').trim() || undefined,
    name: card.name?.trim() || undefined,
    jpName: card.jpName?.trim() || undefined,
    setCode: card.setCode?.trim() || undefined,
    isRevival: Boolean(card.isRevival),
  };
}

function normalizeCandidateSrc(rawUrl: string, card: BattleSpiritsCard): string {
  const trimmed = rawUrl.trim();
  const meta = getCardMetaParams(card);

  if (!trimmed) {
    return buildWikiEndpointUrl(meta);
  }

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }

  if (trimmed.startsWith('/api/wiki/image')) {
    try {
      const parsed = new URL(trimmed, 'http://localhost');
      if (meta.fallback && !parsed.searchParams.get('fallback')) {
        parsed.searchParams.set('fallback', meta.fallback);
      }
      if (meta.title && !parsed.searchParams.get('title')) {
        parsed.searchParams.set('title', meta.title);
      }
      if (
        meta.name &&
        meta.name !== (parsed.searchParams.get('title') || meta.title) &&
        !parsed.searchParams.get('name')
      ) {
        parsed.searchParams.set('name', meta.name);
      }
      if (meta.jpName && !parsed.searchParams.get('jp')) {
        parsed.searchParams.set('jp', meta.jpName);
      }
      if (meta.setCode && !parsed.searchParams.get('set')) {
        parsed.searchParams.set('set', meta.setCode);
      }
      if (meta.isRevival && !parsed.searchParams.get('rv')) {
        parsed.searchParams.set('rv', '1');
      }
      if (meta.id && !parsed.searchParams.get('id')) {
        parsed.searchParams.set('id', meta.id);
      }
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith('/images/')) {
    const baseName = trimmed.slice('/images/'.length).trim();
    const usableFile =
      baseName && !LEGACY_PLACEHOLDER_RE.test(baseName) && !DISALLOWED_CARD_ICON_RE.test(baseName)
        ? baseName
        : undefined;
    return buildWikiEndpointUrl({ ...meta, file: usableFile });
  }

  if (!trimmed.startsWith('/')) {
    const usableFile = !DISALLOWED_CARD_ICON_RE.test(trimmed) ? trimmed : undefined;
    return buildWikiEndpointUrl({ ...meta, file: usableFile });
  }

  return trimmed;
}

/**
 * Resolves the primary artwork URL for a card, strictly checking verified
 * ManualWikiMapping overrides BEFORE falling back to automated Wiki API lookup.
 */
export function buildWikiImageUrl(
  card: BattleSpiritsCard,
  overrideUrl?: string
): string {
  const manual = getManualWikiMapping(card);
  const trimmedOverride = (overrideUrl ?? '').trim();
  const isGalleryAlternate = Boolean(
    trimmedOverride &&
      Array.isArray(card.galleryImages) &&
      card.galleryImages.some((g, idx) => idx > 0 && g?.url?.trim() === trimmedOverride) &&
      !isNonCardArtworkUrlOrFile(trimmedOverride)
  );

  if (manual && !isGalleryAlternate) {
    const manualUrl = resolveManualMappingArtworkUrl(card, manual);
    if (manualUrl) return manualUrl;
  }

  const raw = overrideUrl !== undefined ? overrideUrl : card.artworkImage || '';
  if (raw && isNonCardArtworkUrlOrFile(raw) && !raw.startsWith('/api/wiki/image')) {
    return buildWikiEndpointUrl(getCardMetaParams(card));
  }
  return normalizeCandidateSrc(raw, card);
}

export function buildFallbackWikiImageUrl(card: BattleSpiritsCard): string {
  const manual = getManualWikiMapping(card);
  if (manual) {
    const manualUrl = resolveManualMappingArtworkUrl(card, manual);
    if (manualUrl) return manualUrl;
  }
  return buildWikiEndpointUrl(getCardMetaParams(card));
}

function extractFileFromCardArtwork(card: BattleSpiritsCard): string | undefined {
  const raw = (card.artworkImage || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('/api/wiki/image')) {
    try {
      const parsed = new URL(raw, 'http://localhost');
      const f = parsed.searchParams.get('file')?.trim();
      if (f && !isNonCardArtworkUrlOrFile(f)) return f;
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (!raw.startsWith('/') && !raw.startsWith('http') && !isNonCardArtworkUrlOrFile(raw)) {
    return raw;
  }
  return undefined;
}

function parseRetryAfterMs(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const secs = Number(headerVal);
  if (Number.isFinite(secs) && secs >= 0) {
    return Math.min(4000, Math.max(150, secs * 1000));
  }
  return null;
}

function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options?: { maxAttempts?: number; timeoutMs?: number; baseDelayMs?: number }
): Promise<Response> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? 8500);
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 300);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (init.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    init.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onExternalAbort);

      if (res.ok) return res;

      const retryableStatus =
        res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
      if (!retryableStatus || attempt >= maxAttempts) {
        return res;
      }

      const retryAfter =
        res.status === 429 ? parseRetryAfterMs(res.headers.get('retry-after')) : null;
      const waitMs = retryAfter ?? baseDelayMs * Math.pow(2, attempt - 1);
      await delayWithSignal(waitMs, init.signal ?? undefined);
    } catch (err) {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onExternalAbort);
      lastError = err;
      if (init.signal?.aborted || attempt >= maxAttempts) {
        throw err;
      }
      const waitMs = baseDelayMs * Math.pow(2, attempt - 1);
      await delayWithSignal(waitMs, init.signal ?? undefined);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Wiki request failed');
}

async function queryWikiImageStageEndpoint(
  url: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; data?: WikiImageApiMetadataResponse; error?: string }> {
  try {
    const res = await fetchWithRetry(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as WikiImageApiMetadataResponse;
    return { ok: Boolean(json?.ok), status: res.status, data: json };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { ok: false, status: 0, error: message };
  }
}

function cacheSequentialResult(key: string, result: SequentialLookupResult) {
  if (sequentialResolutionCache.size >= MAX_RESOLUTION_CACHE) {
    const firstKey = sequentialResolutionCache.keys().next().value;
    if (firstKey) sequentialResolutionCache.delete(firstKey);
  }
  const ttl = result.ok ? LOADED_TTL_MS : ERROR_TTL_MS;
  sequentialResolutionCache.set(key, {
    result,
    expiresAt: Date.now() + ttl,
  });
}

/**
 * Sequential Multi-Stage Card Artwork Lookup:
 * Stage 0: ManualWikiMapping (direct artworkUrl / manual wikiTitle / manual fileName)
 * Stage 1: Exact name search (card.wikiTitle / card.name)
 * Stage 2: Normalized name search (punctuation, spaces, hyphens, Roman<->Arabic, aliases)
 * Stage 3: Set code + card number search (setCode + cardNumber)
 * Stage 4: Japanese name search (card.jpName)
 *
 * Executes each stage sequentially only if the previous stage failed, and stops
 * immediately upon finding a validated match.
 */
export async function resolveCardArtworkSequential(
  card: BattleSpiritsCard,
  options?: { signal?: AbortSignal; forceRefresh?: boolean; skipApiForDirectManual?: boolean }
): Promise<SequentialLookupResult> {
  const cardKey = getCardLookupKey(card);

  // Stage 0 always takes immediate precedence — even over negative cache entries
  const manual = getManualWikiMapping(card);
  if (manual) {
    if (manual.artworkUrl && isValidManualArtworkUrl(manual.artworkUrl)) {
      const resolvedUrl = manual.artworkUrl.trim();
      markWikiImageLoaded(resolvedUrl);
      const manualResult: SequentialLookupResult = {
        ok: true,
        url: resolvedUrl,
        proxyUrl: resolvedUrl,
        resolvedFile: null,
        resolvedTitle: manual.wikiTitle || card.wikiTitle || card.name || null,
        stage: 'manual-mapping',
        stagesAttempted: ['manual-mapping'],
        wikiSearchResults: [],
        failureReason: null,
        needsManualMapping: false,
        manualMapping: manual,
      };
      cacheSequentialResult(cardKey, manualResult);
      return manualResult;
    }

    const manualProxyUrl = resolveManualMappingArtworkUrl(card, manual);
    if (options?.skipApiForDirectManual && manualProxyUrl) {
      const manualResult: SequentialLookupResult = {
        ok: true,
        url: manualProxyUrl,
        proxyUrl: manualProxyUrl,
        resolvedFile: manual.fileName || null,
        resolvedTitle: manual.wikiTitle || card.wikiTitle || card.name || null,
        stage: 'manual-mapping',
        stagesAttempted: ['manual-mapping'],
        wikiSearchResults: [],
        failureReason: null,
        needsManualMapping: false,
        manualMapping: manual,
      };
      cacheSequentialResult(cardKey, manualResult);
      return manualResult;
    }
  }

  if (!options?.forceRefresh) {
    const cached = sequentialResolutionCache.get(cardKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, fromCache: true };
    }
    if (cached) {
      sequentialResolutionCache.delete(cardKey);
    }

    if (isCardSessionLookupFailed(card)) {
      const failInfo = sessionFailedCards.get(cardKey);
      return {
        ok: false,
        url: null,
        proxyUrl: null,
        resolvedFile: null,
        resolvedTitle: null,
        stage: null,
        stagesAttempted: [],
        wikiSearchResults: [],
        failureReason: failInfo?.reason || 'Previously failed in current session',
        needsManualMapping: true,
        fromCache: true,
      };
    }
  } else {
    clearCardSessionLookupFailure(card);
  }

  const inflight = inflightCardResolutions.get(cardKey);
  if (inflight) return inflight;

  const task = (async (): Promise<SequentialLookupResult> => {
    const stagesAttempted: ClientLookupStage[] = [];
    const discoveredResults = new Set<string>();
    const failureReasons: string[] = [];

    const finalizeSuccess = (
      stage: ClientLookupStage,
      data: WikiImageApiMetadataResponse,
      manualEntry?: ManualWikiMappingEntry
    ): SequentialLookupResult => {
      clearCardSessionLookupFailure(card);
      const url = data.wikiUrl || data.proxyUrl || null;
      const proxyUrl = data.proxyUrl || (url ? buildWikiImageUrl(card) : null);
      if (url) markWikiImageLoaded(url);
      if (proxyUrl) markWikiImageLoaded(proxyUrl);

      const res: SequentialLookupResult = {
        ok: true,
        url,
        proxyUrl,
        resolvedFile: data.resolvedFile || null,
        resolvedTitle: data.resolvedTitle || manualEntry?.wikiTitle || card.wikiTitle || card.name || null,
        stage,
        stagesAttempted: [...stagesAttempted],
        wikiSearchResults: Array.from(discoveredResults),
        failureReason: null,
        needsManualMapping: false,
        manualMapping: manualEntry,
      };
      cacheSequentialResult(cardKey, res);
      return res;
    };

    const meta = getCardMetaParams(card);
    const storedFile = extractFileFromCardArtwork(card);

    // Stage 0 (Wiki-backed manual override: verified wikiTitle or fileName)
    if (manual) {
      stagesAttempted.push('manual-mapping');
      const manualEndpoint = buildWikiEndpointUrl({
        id: card.id,
        file: manual.fileName || undefined,
        fallback: card.cardNumber || manual.cardNumber,
        title: manual.wikiTitle || card.wikiTitle || card.name,
        name: card.name || manual.name,
        jpName: card.jpName,
        setCode: card.setCode,
        isRevival: Boolean(card.isRevival ?? manual.isRevival),
        stage: 'exact',
        endpoint: '/api/wiki/image-url',
      });
      const resp = await queryWikiImageStageEndpoint(manualEndpoint, options?.signal);
      if (resp.data?.wikiSearchResults) {
        resp.data.wikiSearchResults.forEach((r) => discoveredResults.add(r));
      }
      if (resp.data && validateClientCandidateMatch(card, resp.data, 'manual-mapping').valid) {
        return finalizeSuccess('manual-mapping', resp.data, manual);
      }
      failureReasons.push(
        `manual-mapping: ${resp.error || resp.data?.failureReason || 'Manual Wiki target unreachable'}`
      );
    }

    // Stage 1: Exact name search
    if (meta.title || meta.name || storedFile) {
      stagesAttempted.push('exact-name');
      const exactEndpoint = buildWikiEndpointUrl({
        ...meta,
        file: storedFile,
        stage: 'exact',
        endpoint: '/api/wiki/image-url',
      });
      const resp = await queryWikiImageStageEndpoint(exactEndpoint, options?.signal);
      if (resp.data?.wikiSearchResults) {
        resp.data.wikiSearchResults.forEach((r) => discoveredResults.add(r));
      }
      if (resp.data) {
        const check = validateClientCandidateMatch(card, resp.data, 'exact-name');
        if (check.valid) {
          return finalizeSuccess('exact-name', resp.data);
        }
        if (check.reason) failureReasons.push(`exact-name: ${check.reason}`);
      } else if (resp.error) {
        failureReasons.push(`exact-name: ${resp.error}`);
      }
    }

    // Stage 2: Normalized name search (only runs if Stage 1 failed)
    const rawName = (card.wikiTitle || card.name || '').trim();
    const romanVariants = expandRomanNumeralVariants(rawName);
    const normalizedName = normalizeCardNameForMatch(rawName);
    if (rawName || normalizedName) {
      stagesAttempted.push('normalized-name');
      const candidateQueryName =
        romanVariants.find((v) => v !== rawName) || normalizedName || rawName;
      const normEndpoint = buildWikiEndpointUrl({
        ...meta,
        title: candidateQueryName,
        name: rawName || candidateQueryName,
        stage: 'normalized',
        endpoint: '/api/wiki/image-url',
      });
      const resp = await queryWikiImageStageEndpoint(normEndpoint, options?.signal);
      if (resp.data?.wikiSearchResults) {
        resp.data.wikiSearchResults.forEach((r) => discoveredResults.add(r));
      }
      if (resp.data) {
        const check = validateClientCandidateMatch(card, resp.data, 'normalized-name');
        if (check.valid) {
          return finalizeSuccess('normalized-name', resp.data);
        }
        if (check.reason) failureReasons.push(`normalized-name: ${check.reason}`);
      } else if (resp.error) {
        failureReasons.push(`normalized-name: ${resp.error}`);
      }
    }

    // Stage 3: Set code + card number search (only runs if Stage 2 failed)
    const cleanNum = (card.cardNumber || '').trim();
    const inferredSet =
      (card.setCode || '').trim() ||
      (cleanNum.includes('-') ? cleanNum.split('-')[0].trim() : '');
    if ((cleanNum && cleanNum.toUpperCase() !== 'WIKI') || inferredSet) {
      stagesAttempted.push('set-plus-number');
      const numEndpoint = buildWikiEndpointUrl({
        id: meta.id,
        fallback: cleanNum || undefined,
        setCode: inferredSet || undefined,
        name: meta.name,
        title: meta.title,
        isRevival: meta.isRevival,
        stage: 'set_number',
        endpoint: '/api/wiki/image-url',
      });
      const resp = await queryWikiImageStageEndpoint(numEndpoint, options?.signal);
      if (resp.data?.wikiSearchResults) {
        resp.data.wikiSearchResults.forEach((r) => discoveredResults.add(r));
      }
      if (resp.data) {
        const check = validateClientCandidateMatch(card, resp.data, 'set-plus-number');
        if (check.valid) {
          return finalizeSuccess('set-plus-number', resp.data);
        }
        if (check.reason) failureReasons.push(`set-plus-number: ${check.reason}`);
      } else if (resp.error) {
        failureReasons.push(`set-plus-number: ${resp.error}`);
      }
    }

    // Stage 4: Japanese name search (only runs if Stage 3 failed and jpName exists)
    const jp = (card.jpName || '').trim();
    if (jp) {
      stagesAttempted.push('japanese-name');
      const jpEndpoint = buildWikiEndpointUrl({
        ...meta,
        jpName: jp,
        stage: 'japanese',
        endpoint: '/api/wiki/image-url',
      });
      const resp = await queryWikiImageStageEndpoint(jpEndpoint, options?.signal);
      if (resp.data?.wikiSearchResults) {
        resp.data.wikiSearchResults.forEach((r) => discoveredResults.add(r));
      }
      if (resp.data) {
        const check = validateClientCandidateMatch(card, resp.data, 'japanese-name');
        if (check.valid) {
          return finalizeSuccess('japanese-name', resp.data);
        }
        if (check.reason) failureReasons.push(`japanese-name: ${check.reason}`);
      } else if (resp.error) {
        failureReasons.push(`japanese-name: ${resp.error}`);
      }
    }

    const combinedReason =
      failureReasons[failureReasons.length - 1] ||
      'No verified card artwork found across sequential Wiki stages';
    markCardSessionLookupFailed(card, combinedReason);

    const failResult: SequentialLookupResult = {
      ok: false,
      url: null,
      proxyUrl: null,
      resolvedFile: null,
      resolvedTitle: null,
      stage: null,
      stagesAttempted,
      wikiSearchResults: Array.from(discoveredResults),
      failureReason: combinedReason,
      needsManualMapping: true,
    };
    cacheSequentialResult(cardKey, failResult);
    return failResult;
  })().finally(() => {
    inflightCardResolutions.delete(cardKey);
  });

  inflightCardResolutions.set(cardKey, task);
  return task;
}

export function preloadWikiImage(src: string): Promise<boolean> {
  if (!src || typeof Image === 'undefined') return Promise.resolve(false);
  if (isNonCardArtworkUrlOrFile(src)) return Promise.resolve(false);

  const cached = getCachedWikiImageStatus(src);
  if (cached === 'loaded') return Promise.resolve(true);
  if (cached === 'error') return Promise.resolve(false);

  const existing = inflightPreloads.get(src);
  if (existing) return existing;

  const task = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      markWikiImageLoaded(src);
      resolve(true);
    };
    img.onerror = () => {
      markWikiImageError(src);
      resolve(false);
    };
    img.src = src;
  }).finally(() => {
    inflightPreloads.delete(src);
  });

  inflightPreloads.set(src, task);
  return task;
}
