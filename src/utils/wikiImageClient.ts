import type { BattleSpiritsCard } from '../types/card';

export type WikiImageCacheStatus = 'loaded' | 'error';

interface PersistedImageEntry {
  s: WikiImageCacheStatus;
  t: number;
}

const STORAGE_KEY = 'spiritsdex_wiki_img_cache_v1';
const LOADED_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const ERROR_TTL_MS = 1000 * 60 * 5; // 5 minutes
const MAX_PERSISTED_ENTRIES = 2500;

const LEGACY_PLACEHOLDER_RE =
  /^bs_(?:red_dragon|purple_phantom|white_mecha|yellow_seraph|green_beast|blue_titan|contract_|standard_banner|arcane_magic|relic_brave)/i;

const memoryStatusCache = new Map<string, PersistedImageEntry>();
const inflightPreloads = new Map<string, Promise<boolean>>();
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

function buildWikiEndpointUrl(params: {
  id?: string;
  file?: string;
  fallback?: string;
  title?: string;
  name?: string;
  jpName?: string;
  setCode?: string;
  isRevival?: boolean;
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
  const str = qs.toString();
  return str ? `/api/wiki/image?${str}` : '';
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
      baseName && !LEGACY_PLACEHOLDER_RE.test(baseName) ? baseName : undefined;
    return buildWikiEndpointUrl({ ...meta, file: usableFile });
  }

  // Bare wiki filename
  if (!trimmed.startsWith('/')) {
    return buildWikiEndpointUrl({ ...meta, file: trimmed });
  }

  return trimmed;
}

export function buildWikiImageUrl(
  card: BattleSpiritsCard,
  overrideUrl?: string
): string {
  const raw = overrideUrl !== undefined ? overrideUrl : card.artworkImage || '';
  return normalizeCandidateSrc(raw, card);
}

export function buildFallbackWikiImageUrl(card: BattleSpiritsCard): string {
  return buildWikiEndpointUrl(getCardMetaParams(card));
}

export function preloadWikiImage(src: string): Promise<boolean> {
  if (!src || typeof Image === 'undefined') return Promise.resolve(false);
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
