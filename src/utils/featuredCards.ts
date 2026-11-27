import { BattleSpiritsCard, FormatFilter, ProductSet } from '../types/card';
import {
  matchesFormatFilter,
  normalizeCardColors,
  normalizeCardTypes,
} from './cardFilterNormalization';
import { normalizeCardNumber } from './decklistImport';
import { normalizeSetIdentifier } from './setMetadataSync';

export type FeaturedCardsMode = 'random' | 'latest';

export const DEFAULT_FEATURED_MODE: FeaturedCardsMode = 'random';
export const DEFAULT_FEATURED_CARD_COUNT = 8;

/**
 * Indonesia Western Time (WIB / Asia/Jakarta) is fixed at UTC+07:00 year-round (no DST).
 * Rotation boundaries occur strictly at 00:00, 06:00, 12:00, and 18:00 WIB.
 */
export const WIB_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
export const ROTATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const WIB_ROTATION_HOURS = [0, 6, 12, 18] as const;

export type WibRotationHour = (typeof WIB_ROTATION_HOURS)[number];

export interface WibRotationWindow {
  windowIndex: number;
  windowStartMs: number;
  nextRotationMs: number;
  windowHourWib: WibRotationHour;
  nextHourWib: WibRotationHour;
  windowDateWib: string;
  windowKey: string;
  windowStartLabel: string;
  nextRotationLabel: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Computes the active fixed 6-hour WIB (Asia/Jakarta) rotation window for a given epoch ms.
 * Windows align strictly to 00:00, 06:00, 12:00, and 18:00 WIB.
 */
export function getWibRotationWindow(nowMs: number = Date.now()): WibRotationWindow {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const wibEpochMs = safeNow + WIB_UTC_OFFSET_MS;
  const windowIndex = Math.floor(wibEpochMs / ROTATION_INTERVAL_MS);
  const windowStartMs = windowIndex * ROTATION_INTERVAL_MS - WIB_UTC_OFFSET_MS;
  const nextRotationMs = (windowIndex + 1) * ROTATION_INTERVAL_MS - WIB_UTC_OFFSET_MS;

  const wibStartDate = new Date(windowStartMs + WIB_UTC_OFFSET_MS);
  const year = wibStartDate.getUTCFullYear();
  const month = pad2(wibStartDate.getUTCMonth() + 1);
  const day = pad2(wibStartDate.getUTCDate());
  const rawHour = wibStartDate.getUTCHours();
  const windowHourWib = (Math.floor(rawHour / 6) * 6) as WibRotationHour;
  const nextHourWib = (((windowHourWib + 6) % 24) as WibRotationHour);

  const windowDateWib = `${year}-${month}-${day}`;
  const windowHourStr = pad2(windowHourWib);
  const nextHourStr = pad2(nextHourWib);

  return {
    windowIndex,
    windowStartMs,
    nextRotationMs,
    windowHourWib,
    nextHourWib,
    windowDateWib,
    windowKey: `${windowDateWib}T${windowHourStr}:00+07:00`,
    windowStartLabel: `${windowHourStr}:00 WIB`,
    nextRotationLabel: `${nextHourStr}:00 WIB`,
  };
}

export function getMillisecondsUntilNextWibRotation(nowMs: number = Date.now()): number {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const window = getWibRotationWindow(safeNow);
  return Math.max(1000, window.nextRotationMs - safeNow + 50);
}

/**
 * Pure deterministic PRNG seeded from an arbitrary string (FNV-1a hash -> Mulberry32).
 * Produces identical sequences across all browsers and users for a given seed.
 */
export function createDeterministicRng(seed: string): () => number {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((i + 1) * 31);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  let state = (h1 ^ h2) >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export function parseCardTimestampMs(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (typeof raw === 'object') {
    const tsLike = raw as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof tsLike.toMillis === 'function') {
      const ms = tsLike.toMillis();
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
    if (typeof tsLike.seconds === 'number' && Number.isFinite(tsLike.seconds)) {
      const ms =
        tsLike.seconds * 1000 +
        (typeof tsLike.nanoseconds === 'number' && Number.isFinite(tsLike.nanoseconds)
          ? Math.floor(tsLike.nanoseconds / 1_000_000)
          : 0);
      return ms > 0 ? ms : null;
    }
  }
  return null;
}

export function getCardCreationTimestampMs(card: Partial<BattleSpiritsCard>): number | null {
  const importedTs = parseCardTimestampMs(card.importedAt);
  const createdTs = parseCardTimestampMs(card.createdAt);
  if (importedTs !== null && createdTs !== null) {
    return Math.max(importedTs, createdTs);
  }
  return importedTs ?? createdTs;
}

export function isEligibleFeaturedCard(card: Partial<BattleSpiritsCard> | null | undefined): card is BattleSpiritsCard {
  if (!card) return false;
  const id = typeof card.id === 'string' ? card.id.trim() : '';
  const name = typeof card.name === 'string' ? card.name.trim() : '';
  const cardNumber = typeof card.cardNumber === 'string' ? card.cardNumber.trim() : '';
  const setCode = typeof card.setCode === 'string' ? card.setCode.trim() : '';
  if (!id || !name || !cardNumber || !setCode) return false;

  if (/^(?:unknown|placeholder|n\/a)$/i.test(name)) return false;
  if (cardNumber.toUpperCase() === 'WIKI') return false;
  if (normalizeSetIdentifier(setCode) === 'BSS01') return false;

  if (!Array.isArray(card.formats) || card.formats.length === 0) return false;
  if (normalizeCardColors(card).length === 0) return false;
  if (normalizeCardTypes(card).length === 0) return false;

  return true;
}

function getDedupKey(card: BattleSpiritsCard): string {
  const numKey = normalizeCardNumber(card.cardNumber || '');
  if (!numKey || numKey === 'WIKI') return `id:${card.id}`;
  return `${numKey}|${card.isRevival ? 'rv' : 'orig'}`;
}

/**
 * Collects eligible, format-matching cards, deduplicates variants, and sorts canonically
 * by ID so client array ordering never causes divergent shared selections across users.
 */
function collectEligibleFormatPool(
  cards: BattleSpiritsCard[],
  format: FormatFilter
): BattleSpiritsCard[] {
  const seen = new Set<string>();
  const eligible: BattleSpiritsCard[] = [];

  // Sort deterministically by id first so deduplication picks the exact same representative across clients
  const canonicalInput = [...cards].sort((a, b) =>
    String(a?.id || '').localeCompare(String(b?.id || ''))
  );

  for (const card of canonicalInput) {
    if (!isEligibleFeaturedCard(card)) continue;
    if (!matchesFormatFilter(card.formats, format)) continue;
    const key = getDedupKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    eligible.push(card);
  }

  return eligible;
}

function computeSetFallbackRank(s: ProductSet, idx: number, total: number): number {
  const rd = (s.releaseDate || '').trim();
  const ym = rd.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i);
  if (ym) {
    const year = Number(ym[2]);
    const mon = MONTH_INDEX[ym[1].slice(0, 3).toLowerCase()] || 6;
    return year * 10000 + mon * 100 + Math.max(0, total - idx);
  }
  const iso = rd.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/);
  if (iso) {
    return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Math.max(0, total - idx);
  }
  const yOnly = rd.match(/\b(20\d{2})\b/);
  if (yOnly) {
    return Number(yOnly[1]) * 10000 + 600 + Math.max(0, total - idx);
  }

  const code = s.setCode.toUpperCase();
  if (/^26R/.test(code)) return 20260400 + Math.max(0, total - idx);
  const bsM = code.match(/^BS(\d{2})$/);
  if (bsM) {
    const num = Number(bsM[1]);
    return (200800 + Math.round((num / 77) * 1800)) * 100 + Math.max(0, total - idx);
  }
  const sdM = code.match(/^SD(\d{2})$/);
  if (sdM) {
    const num = Number(sdM[1]);
    return (200800 + Math.round((num / 70) * 1800)) * 100 + Math.max(0, total - idx);
  }
  const cbM = code.match(/^CB(\d{2})$/);
  if (cbM) {
    const num = Number(cbM[1]);
    return (201700 + Math.round((num / 35) * 900)) * 100 + Math.max(0, total - idx);
  }
  const bscM = code.match(/^BSC(\d{2})$/);
  if (bscM) {
    const num = Number(bscM[1]);
    return (200900 + Math.round((num / 51) * 1700)) * 100 + Math.max(0, total - idx);
  }
  return 20150000 + Math.max(0, total - idx);
}

export function buildSetReleaseRankMap(productSets: ProductSet[]): Map<string, number> {
  const map = new Map<string, number>();
  const total = productSets.length;
  productSets.forEach((s, idx) => {
    map.set(s.setCode.toUpperCase(), computeSetFallbackRank(s, idx, total));
  });
  return map;
}

export function selectRandomFeaturedCards(
  cards: BattleSpiritsCard[],
  options: {
    format?: FormatFilter;
    count?: number;
    nowMs?: number;
    window?: WibRotationWindow;
    rng?: () => number;
    excludeIds?: Set<string>;
  } = {}
): BattleSpiritsCard[] {
  const format = options.format ?? 'All';
  const count = Math.max(0, options.count ?? DEFAULT_FEATURED_CARD_COUNT);
  if (count === 0) return [];

  const rotationWindow = options.window ?? getWibRotationWindow(options.nowMs);
  const rng =
    options.rng ??
    createDeterministicRng(
      `spiritsdex:featured:random:v2|${rotationWindow.windowKey}|${format}`
    );

  let pool = collectEligibleFormatPool(cards, format);
  if (options.excludeIds && options.excludeIds.size > 0) {
    const nonExcluded = pool.filter((c) => !options.excludeIds!.has(c.id));
    if (nonExcluded.length > 0) {
      pool = nonExcluded;
    }
  }

  // Deterministic Fisher-Yates shuffle over the canonically sorted pool
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const rand = rng();
    const clamped = Number.isFinite(rand) ? Math.min(0.999999999, Math.max(0, rand)) : 0;
    const j = Math.floor(clamped * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  return shuffled.slice(0, count);
}

export function selectLatestFeaturedCards(
  cards: BattleSpiritsCard[],
  options: {
    format?: FormatFilter;
    count?: number;
    nowMs?: number;
    window?: WibRotationWindow;
    respectRotationWindow?: boolean;
    productSets?: ProductSet[];
    releaseRankBySetCode?: Map<string, number>;
  } = {}
): BattleSpiritsCard[] {
  const format = options.format ?? 'All';
  const count = Math.max(0, options.count ?? DEFAULT_FEATURED_CARD_COUNT);
  if (count === 0) return [];

  const rotationWindow = options.window ?? getWibRotationWindow(options.nowMs);
  const respectWindow = options.respectRotationWindow !== false;
  const cutoffMs = rotationWindow.windowStartMs;

  const rawPool = collectEligibleFormatPool(cards, format);
  // Cards imported after the current 6-hour rotation boundary wait until the next scheduled rotation
  const pool = respectWindow
    ? rawPool.filter((card) => {
        const ts = getCardCreationTimestampMs(card);
        return ts === null || ts <= cutoffMs;
      })
    : rawPool;

  const rankMap =
    options.releaseRankBySetCode ??
    (options.productSets ? buildSetReleaseRankMap(options.productSets) : new Map<string, number>());

  const sorted = [...pool].sort((a, b) => {
    const tsA = getCardCreationTimestampMs(a);
    const tsB = getCardCreationTimestampMs(b);

    // 1. Cards with actual DB creation/import timestamps ALWAYS sort strictly newest-first
    if (tsA !== null && tsB !== null) {
      if (tsB !== tsA) return tsB - tsA;
      return a.id.localeCompare(b.id);
    }
    if (tsA !== null && tsB === null) return -1;
    if (tsA === null && tsB !== null) return 1;

    // 2. Read-only fallback ONLY for historical bundled cards lacking DB timestamps
    const rankA = rankMap.get((a.setCode || '').toUpperCase()) ?? 0;
    const rankB = rankMap.get((b.setCode || '').toUpperCase()) ?? 0;
    if (rankB !== rankA) return rankB - rankA;

    return a.id.localeCompare(b.id);
  });

  return sorted.slice(0, count);
}

export function selectFeaturedCards(
  cards: BattleSpiritsCard[],
  options: {
    mode: FeaturedCardsMode;
    format?: FormatFilter;
    count?: number;
    nowMs?: number;
    window?: WibRotationWindow;
    respectRotationWindow?: boolean;
    rng?: () => number;
    productSets?: ProductSet[];
    releaseRankBySetCode?: Map<string, number>;
  }
): BattleSpiritsCard[] {
  const rotationWindow = options.window ?? getWibRotationWindow(options.nowMs);
  if (options.mode === 'latest') {
    return selectLatestFeaturedCards(cards, { ...options, window: rotationWindow });
  }
  return selectRandomFeaturedCards(cards, { ...options, window: rotationWindow });
}
