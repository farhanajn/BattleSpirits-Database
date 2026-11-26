import type { BattleSpiritsCard, CardColor, GameFormat, ProductSet, SetCategory } from '../types/card.ts';

const FAST_SET_CACHE_KEY = 'spiritsdex_set_metadata_v1';
const GENERIC_NAME_RE =
  /^(?:Booster Set |Starter \/ Mega Deck |Standard (?:Booster|Entry \/ Starter Deck) |Collab Booster |Supplementary Set |Premium (?:Bandai Set|Card Set) )/i;
const GENERIC_RELEASE_DATE_RE =
  /^(?:Legacy Era|Original Set|Original Starter|Eternal Era|Premium Bandai|Premium Card Set|2026\+|Official Release|All Eras)$/i;

export interface CachedSetDirectoryPayload {
  sets: ProductSet[];
  syncedAt: number;
  version: number;
}

export interface IndexedSetDirectory {
  sets: ProductSet[];
  byCode: Map<string, ProductSet>;
  tokensByCode: Map<string, string[]>;
  numericSetCodes: Set<string>;
}

const PADDED_SERIES_PREFIX_RE = /^(26R(?:BS|SD|CB|EB|DB)|BS|SD|CBX|CB|BSC|PB|PC|LM|EX|CP|RPX|RP|PX|SJ|KA)(\d)$/;

/**
 * Normalizes spacing, hyphenation, casing, and single-digit padding variants of set codes
 * (e.g. "BS 23", "bs-23" -> "BS23"; "BS 9", "BS9" -> "BS09"; "26R-BS01" -> "26RBS01";
 * "PX 25", "PX-25" -> "PX25") while keeping distinct sets ("BS01", "SD01", "01",
 * "PROMO-REG", "RP26-STD") untouched.
 */
export function normalizeSetIdentifier(rawCode: string): string {
  const trimmed = (rawCode || '').trim();
  if (!trimmed) return '';

  // Keep explicit multi-word promo / hyphenated std identifiers intact
  if (/^(?:PROMO|STD-PROMO|RP\d+|PX\d+|RPX\d+)-(?:STD|REG|PX|CMP|LIM|JMP|ANM|X|[A-Z0-9-]+)$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const compactUpper = trimmed
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^(26R)-(BS|SD|EB|DB|CB)(\d+)$/, '$1$2$3')
    .replace(/([A-Z])[-_]+(\d)/g, '$1$2');

  const padMatch = compactUpper.match(PADDED_SERIES_PREFIX_RE);
  if (padMatch) {
    return `${padMatch[1]}0${padMatch[2]}`;
  }

  // Keep original hyphenation on non-numeric-suffix sets such as PROMO-REG or RP26-STD
  if (/^[A-Z0-9]+(?:-[A-Z]+)+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return compactUpper;
}

const NATURAL_TOKEN_RE = /(\d+|\D+)/g;

/**
 * Compares arbitrary identifiers using natural numeric ordering for digit segments
 * so "BS9" sorts before "BS10" and "P2" sorts before "P10".
 */
export function naturalCompareSetCodes(aRaw: string, bRaw: string): number {
  const a = (aRaw || '').trim().toUpperCase();
  const b = (bRaw || '').trim().toUpperCase();
  if (a === b) return 0;

  const aTokens = a.match(NATURAL_TOKEN_RE) || [a];
  const bTokens = b.match(NATURAL_TOKEN_RE) || [b];
  const len = Math.min(aTokens.length, bTokens.length);

  for (let i = 0; i < len; i++) {
    const ta = aTokens[i];
    const tb = bTokens[i];
    const aIsNum = /^\d+$/.test(ta);
    const bIsNum = /^\d+$/.test(tb);

    if (aIsNum && bIsNum) {
      const diff = Number(ta) - Number(tb);
      if (diff !== 0) return diff;
      if (ta.length !== tb.length) return ta.length - tb.length;
    } else if (aIsNum !== bIsNum) {
      return aIsNum ? -1 : 1;
    } else {
      const cmp = ta.localeCompare(tb, 'en');
      if (cmp !== 0) return cmp;
    }
  }

  return aTokens.length - bTokens.length;
}

export type SetSortInput = {
  setCode: string;
  name?: string;
  category?: SetCategory | string;
  productType?: ProductSet['productType'] | string;
  releaseDate?: string;
};

interface ParsedSetSortKey {
  groupRank: number;
  subGroupRank: number;
  year: number;
  seriesRank: number;
  subPrefix: string;
  primaryNum: number;
  tail: string;
  rawUpper: string;
}

const YEAR_SERIES_ORDER: Record<string, number> = {
  BS: 1,
  SD: 2,
  CB: 3,
  EB: 4,
  DB: 5,
};

const SEQUENTIAL_SERIES_PREFIXES = new Set(['BS', 'SD', 'CB', 'CBX', 'BSC', 'PB', 'PC']);

function extractReleaseYear(releaseDate?: string): number | null {
  const raw = (releaseDate || '').trim();
  if (!raw || GENERIC_RELEASE_DATE_RE.test(raw)) return null;
  const match = raw.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function getCategoryFallbackRank(
  category?: SetCategory | string,
  productType?: ProductSet['productType'] | string
): number | null {
  const cat = (category || '').trim().toLowerCase();
  const prod = (productType || '').trim().toLowerCase();
  const combined = `${cat} ${prod}`.trim();
  if (!combined) return null;

  if (/\b(?:revival|token)\b/.test(combined)) return 95;
  if (/\bstandard\s*(?:booster|starter)\b/.test(combined)) return 70;
  if (/\bpromo\b/.test(combined)) return 80;
  if (/\bcollab/.test(combined)) return 30;
  if (/\b(?:starter|mega\s*deck)\b/.test(combined)) return 20;
  if (/\bsupplementary\b/.test(combined)) return 40;
  if (/\bpremium\s*bandai\b/.test(combined)) return 50;
  if (/\bpremium\s*card\s*set\b/.test(combined)) return 60;
  if (/\b(?:main|booster)\b/.test(combined)) return 10;
  return null;
}

function parseSetSortKey(
  set: SetSortInput,
  options?: { allowSequentialReleaseYear?: boolean }
): ParsedSetSortKey {
  const rawUpper = normalizeSetIdentifier(set.setCode || '') || (set.setCode || '').trim().toUpperCase();
  const releaseYear = extractReleaseYear(set.releaseDate);
  const base: ParsedSetSortKey = {
    groupRank: 90,
    subGroupRank: 0,
    year: 0,
    seriesRank: 0,
    subPrefix: rawUpper,
    primaryNum: Number.MAX_SAFE_INTEGER,
    tail: '',
    rawUpper,
  };

  // Special meta filters
  if (rawUpper === 'REVIVAL' || rawUpper === 'TOKENS') {
    return { ...base, groupRank: 95, subGroupRank: rawUpper === 'REVIVAL' ? 1 : 2 };
  }

  // Traditional BS boosters (BS01..BS77, BS80, etc.)
  const bsMatch = rawUpper.match(/^BS(\d+)([A-Z0-9-]*)$/);
  if (bsMatch) {
    return {
      ...base,
      groupRank: 10,
      year: options?.allowSequentialReleaseYear && releaseYear ? releaseYear : 0,
      subPrefix: 'BS',
      primaryNum: Number.parseInt(bsMatch[1], 10),
      tail: bsMatch[2],
    };
  }

  // Starter Decks (SD01..SD70)
  const sdMatch = rawUpper.match(/^SD(\d+)([A-Z0-9-]*)$/);
  if (sdMatch) {
    return {
      ...base,
      groupRank: 20,
      year: options?.allowSequentialReleaseYear && releaseYear ? releaseYear : 0,
      subPrefix: 'SD',
      primaryNum: Number.parseInt(sdMatch[1], 10),
      tail: sdMatch[2],
    };
  }

  // Collaboration Boosters (CB01..CB34, CBX01)
  const cbMatch = rawUpper.match(/^(CBX|CB)(\d+)([A-Z0-9-]*)$/);
  if (cbMatch) {
    return {
      ...base,
      groupRank: 30,
      subGroupRank: cbMatch[1] === 'CB' ? 1 : 2,
      year: options?.allowSequentialReleaseYear && releaseYear ? releaseYear : 0,
      subPrefix: cbMatch[1],
      primaryNum: Number.parseInt(cbMatch[2], 10),
      tail: cbMatch[3],
    };
  }

  // Supplementary Sets (BSC01..BSC51)
  const bscMatch = rawUpper.match(/^BSC(\d+)([A-Z0-9-]*)$/);
  if (bscMatch) {
    return {
      ...base,
      groupRank: 40,
      year: options?.allowSequentialReleaseYear && releaseYear ? releaseYear : 0,
      subPrefix: 'BSC',
      primaryNum: Number.parseInt(bscMatch[1], 10),
      tail: bscMatch[2],
    };
  }

  // Premium Bandai (PB01..PB50)
  const pbMatch = rawUpper.match(/^PB(\d+)([A-Z0-9-]*)$/);
  if (pbMatch) {
    return {
      ...base,
      groupRank: 50,
      year: options?.allowSequentialReleaseYear && releaseYear ? releaseYear : 0,
      subPrefix: 'PB',
      primaryNum: Number.parseInt(pbMatch[1], 10),
      tail: pbMatch[2],
    };
  }

  // Premium Card Sets (PC01..PC12)
  const pcMatch = rawUpper.match(/^PC(\d+)([A-Z0-9-]*)$/);
  if (pcMatch) {
    return {
      ...base,
      groupRank: 60,
      year: options?.allowSequentialReleaseYear && releaseYear ? releaseYear : 0,
      subPrefix: 'PC',
      primaryNum: Number.parseInt(pcMatch[1], 10),
      tail: pcMatch[2],
    };
  }

  // Newer year-based alphanumeric series (26RBS01..04, 26RSD01..14, 26RCB01.., 26REB01, 26RDB01, 27RBS01, etc.)
  const yearMatch = rawUpper.match(/^(\d{2})R([A-Z]+?)(\d+)([A-Z0-9-]*)$/);
  if (yearMatch) {
    const series = yearMatch[2];
    return {
      ...base,
      groupRank: 70,
      year: 2000 + Number.parseInt(yearMatch[1], 10),
      seriesRank: YEAR_SERIES_ORDER[series] ?? 9,
      subPrefix: series,
      primaryNum: Number.parseInt(yearMatch[3], 10),
      tail: yearMatch[4],
    };
  }

  // Promotional & special card series (PX, PX13..PX26+, P14..P26+, CP13..CP26+, PROMO-*, RP26-STD, PX26-STD, LM/SJ/KA/EX)
  if (rawUpper === 'PX') {
    return { ...base, groupRank: 80, subGroupRank: 1, year: 2008, subPrefix: 'PX', primaryNum: 0 };
  }
  const pxStdMatch = rawUpper.match(/^(PX|RPX|RP)(\d+)(-STD)?$/);
  if (pxStdMatch) {
    const prefix = pxStdMatch[1];
    const num = Number.parseInt(pxStdMatch[2], 10);
    const isStd = Boolean(pxStdMatch[3]) || prefix === 'RP' || prefix === 'RPX';
    return {
      ...base,
      groupRank: 80,
      subGroupRank: isStd ? 5 : 1,
      year: num < 100 ? 2000 + num : num,
      subPrefix: prefix,
      primaryNum: num,
      tail: pxStdMatch[3] || '',
    };
  }
  const promoNumSeriesMatch = rawUpper.match(/^(P|CP|SJ|LM|KA|EX)(\d+)([A-Z0-9-]*)$/);
  if (promoNumSeriesMatch) {
    const prefix = promoNumSeriesMatch[1];
    const num = Number.parseInt(promoNumSeriesMatch[2], 10);
    const promoFamilyRank = prefix === 'P' ? 2 : prefix === 'CP' ? 3 : 6;
    return {
      ...base,
      groupRank: 80,
      subGroupRank: promoFamilyRank,
      year: num < 100 ? 2000 + num : num,
      subPrefix: prefix,
      primaryNum: num,
      tail: promoNumSeriesMatch[3],
    };
  }
  if (
    /^(?:PROMO|STD-PROMO|RP\d*|RPX\d*|PX\d*|P\d+|SJ\d*|PR\d*|GX|KF|KFC|EX-?PROMO)(?:$|[-_A-Z0-9])/i.test(rawUpper) ||
    getCategoryFallbackRank(set.category, set.productType) === 80
  ) {
    const subRank = rawUpper.startsWith('PROMO-') ? 4 : rawUpper.startsWith('STD-PROMO-') ? 5 : 7;
    const trailingNum = rawUpper.match(/(\d+)$/);
    return {
      ...base,
      groupRank: 80,
      subGroupRank: subRank,
      year: releaseYear ?? Number.MAX_SAFE_INTEGER,
      primaryNum: trailingNum ? Number.parseInt(trailingNum[1], 10) : Number.MAX_SAFE_INTEGER,
    };
  }

  // Number-only sets (e.g. "01", "7", "24", "2026")
  if (/^\d+$/.test(rawUpper)) {
    return {
      ...base,
      groupRank: 85,
      subPrefix: '',
      primaryNum: Number.parseInt(rawUpper, 10),
    };
  }

  // Category-driven fallback for custom set prefixes (Main, Starter, Collab, Supplementary, PB, PC)
  const fallbackRank = getCategoryFallbackRank(set.category, set.productType);
  const genericAlphaNum = rawUpper.match(/^([A-Z-]+?)(\d+)([A-Z0-9-]*)$/);
  if (fallbackRank !== null) {
    return {
      ...base,
      groupRank: fallbackRank,
      subGroupRank: fallbackRank === 30 ? 5 : 9,
      year: releaseYear ?? Number.MAX_SAFE_INTEGER,
      subPrefix: genericAlphaNum ? genericAlphaNum[1].replace(/-+$/, '') : rawUpper,
      primaryNum: genericAlphaNum ? Number.parseInt(genericAlphaNum[2], 10) : Number.MAX_SAFE_INTEGER,
      tail: genericAlphaNum ? genericAlphaNum[3] : '',
    };
  }

  // Other alphanumeric prefix+number families (e.g. HKBP01, HKSP01)
  if (genericAlphaNum) {
    return {
      ...base,
      groupRank: 88,
      year: releaseYear ?? Number.MAX_SAFE_INTEGER,
      subPrefix: genericAlphaNum[1].replace(/-+$/, ''),
      primaryNum: Number.parseInt(genericAlphaNum[2], 10),
      tail: genericAlphaNum[3],
    };
  }

  return {
    ...base,
    year: releaseYear ?? Number.MAX_SAFE_INTEGER,
  };
}

function compareParsedSetKeys(ka: ParsedSetSortKey, kb: ParsedSetSortKey): number {
  if (ka.groupRank !== kb.groupRank) return ka.groupRank - kb.groupRank;
  if (ka.subGroupRank !== kb.subGroupRank) return ka.subGroupRank - kb.subGroupRank;
  if (ka.year !== kb.year) return ka.year - kb.year;
  if (ka.seriesRank !== kb.seriesRank) return ka.seriesRank - kb.seriesRank;

  const prefixCmp = ka.subPrefix.localeCompare(kb.subPrefix, 'en');
  if (prefixCmp !== 0) return prefixCmp;

  if (ka.primaryNum !== kb.primaryNum) return ka.primaryNum - kb.primaryNum;

  const tailCmp = naturalCompareSetCodes(ka.tail, kb.tail);
  if (tailCmp !== 0) return tailCmp;

  return naturalCompareSetCodes(ka.rawUpper, kb.rawUpper);
}

/**
 * Deterministic comparator for organizing Battle Spirits sets by category group,
 * chronological year, and integer-parsed numeric suffix for the Set filter dropdown.
 */
export function compareSetIdentifiers(a: SetSortInput, b: SetSortInput): number {
  const ka = parseSetSortKey(a);
  const kb = parseSetSortKey(b);
  return compareParsedSetKeys(ka, kb);
}

/**
 * Deduplicates identifier variations (e.g. "BS23" and "BS 23") without altering
 * valid set names/codes, and returns a new array sorted cleanly using multi-level
 * sorting: category group -> chronological year -> integer numeric suffix.
 */
export function sortSetsForFilterDropdown<T extends SetSortInput>(sets: T[]): T[] {
  const dedupedByKey = new Map<string, T>();

  for (const item of sets) {
    if (!item || !item.setCode) continue;
    const key = normalizeSetIdentifier(item.setCode);
    if (!key || key === 'BSS01') continue;

    const existing = dedupedByKey.get(key);
    if (!existing) {
      dedupedByKey.set(key, item);
      continue;
    }

    const existingHasOfficial = !isPlaceholderSetName(existing.name, existing.setCode);
    const incomingHasOfficial = !isPlaceholderSetName(item.name, item.setCode);
    const existingCanonicalExact = existing.setCode.trim().toUpperCase() === key;
    const incomingCanonicalExact = item.setCode.trim().toUpperCase() === key;

    if (
      (!existingHasOfficial && incomingHasOfficial) ||
      (existingHasOfficial === incomingHasOfficial && !existingCanonicalExact && incomingCanonicalExact)
    ) {
      dedupedByKey.set(key, item);
    }
  }

  const deduped = Array.from(dedupedByKey.values());

  // Determine which sequential series cohorts (e.g. BS, SD, CB) have explicit release years on every member
  const cohortAllHaveYears = new Map<string, boolean>();
  for (const item of deduped) {
    const preKey = parseSetSortKey(item);
    if (!SEQUENTIAL_SERIES_PREFIXES.has(preKey.subPrefix)) continue;
    const cohortId = `${preKey.groupRank}|${preKey.subPrefix}`;
    const hasYear = extractReleaseYear(item.releaseDate) !== null;
    cohortAllHaveYears.set(cohortId, (cohortAllHaveYears.get(cohortId) ?? true) && hasYear);
  }

  const keyed = deduped.map((item) => {
    const preKey = parseSetSortKey(item);
    const cohortId = `${preKey.groupRank}|${preKey.subPrefix}`;
    const allowSequentialReleaseYear = Boolean(cohortAllHaveYears.get(cohortId));
    return {
      item,
      sortKey: allowSequentialReleaseYear
        ? parseSetSortKey(item, { allowSequentialReleaseYear: true })
        : preKey,
    };
  });

  keyed.sort((a, b) => compareParsedSetKeys(a.sortKey, b.sortKey));
  return keyed.map((entry) => entry.item);
}

/**
 * Checks whether a set name is only an empty/generic boilerplate placeholder.
 * Note: Number-only set names (e.g. "01", "24", "2026") and intentional code-only
 * titles ("PB24") are preserved unless a distinct official subtitle is discovered.
 */
export function isPlaceholderSetName(name: string | undefined, setCode: string): boolean {
  const clean = (name || '').trim();
  if (!clean) return true;
  if (clean.toUpperCase() === setCode.trim().toUpperCase()) return true;
  return GENERIC_NAME_RE.test(clean);
}

/**
 * True when a set identifies primarily by numbers or code-only tokens (e.g. "01", "24", "PB24").
 */
export function isNumberOrCodeOnlySet(set: Pick<ProductSet, 'setCode' | 'name'>): boolean {
  const code = (set.setCode || '').trim().toUpperCase();
  const name = (set.name || '').trim().toUpperCase();
  return /^\d+$/.test(code) || /^\d+$/.test(name) || name === code;
}

/**
 * Builds normalized search & lookup tokens so number-only sets, code-only sets,
 * and named sets are indexed symmetrically.
 */
export function buildSetSearchTokens(set: ProductSet): string[] {
  const tokens = new Set<string>();
  const add = (val: string) => {
    const clean = val.trim().toLowerCase();
    if (clean) tokens.add(clean);
  };

  const code = (set.setCode || '').trim();
  const codeLower = code.toLowerCase();
  const codeCompact = codeLower.replace(/[\s-]+/g, '');
  add(codeLower);
  add(codeCompact);

  // Add spaced and hyphenated forms for codes like "PB24" -> "pb 24", "pb-24"
  const alphaNumMatch = codeCompact.match(/^([a-z]+?)(\d+)([a-z]*)$/i);
  if (alphaNumMatch) {
    const [, prefix, digits, suffix] = alphaNumMatch;
    add(`${prefix} ${digits}${suffix}`);
    add(`${prefix}-${digits}${suffix}`);
    add(digits);
    const unpadded = String(Number(digits));
    if (unpadded && unpadded !== 'NaN') {
      add(unpadded);
      add(`${prefix}${unpadded}${suffix}`);
      add(`${prefix} ${unpadded}${suffix}`);
    }
  } else if (/^\d+$/.test(codeCompact)) {
    // Pure number-only set code (e.g. "01", "7", "2026")
    const numVal = String(Number(codeCompact));
    add(numVal);
    add(codeCompact.padStart(2, '0'));
  }

  const nameLower = (set.name || '').trim().toLowerCase();
  if (nameLower) {
    add(nameLower);
    add(nameLower.replace(/[\s-]+/g, ''));
    if (/^\d+$/.test(nameLower)) {
      add(String(Number(nameLower)));
      add(nameLower.padStart(2, '0'));
    }
  }

  if (set.jpName) add(set.jpName);
  if (set.wikiTitle) add(set.wikiTitle);
  if (set.tagline) add(set.tagline);
  if (set.blockLabel) add(set.blockLabel);
  if (set.releaseDate) add(set.releaseDate);
  if (set.productType) add(set.productType);

  return Array.from(tokens);
}

/**
 * Merges two ProductSet records without discarding rich metadata or overwriting
 * official names with generic placeholders. Re-uses already stored release dates,
 * Japanese names, taglines, colors, featured card IDs, and card counts.
 */
export function mergeSetMetadataRecord(
  existing: ProductSet | undefined,
  incoming: ProductSet
): ProductSet {
  if (!existing) {
    const normalizedCode = normalizeSetIdentifier(incoming.setCode) || incoming.setCode.trim().toUpperCase();
    return {
      ...incoming,
      setCode: normalizedCode,
      name: (incoming.name || normalizedCode).trim(),
      jpName: incoming.jpName || '',
      colors: Array.isArray(incoming.colors) && incoming.colors.length > 0 ? incoming.colors : ['Red'],
      formats: Array.isArray(incoming.formats) && incoming.formats.length > 0 ? incoming.formats : ['Eternal'],
      totalCardsInSet: Number(incoming.totalCardsInSet) || 0,
    };
  }

  const setCode =
    normalizeSetIdentifier(incoming.setCode || existing.setCode) ||
    (incoming.setCode || existing.setCode).trim().toUpperCase();
  const incomingHasPlaceholder = isPlaceholderSetName(incoming.name, setCode);
  const existingHasPlaceholder = isPlaceholderSetName(existing.name, setCode);

  const resolvedName =
    !incomingHasPlaceholder
      ? incoming.name.trim()
      : !existingHasPlaceholder
      ? existing.name.trim()
      : (incoming.name || existing.name || setCode).trim();

  const incomingDateSpecific = Boolean(
    incoming.releaseDate && !GENERIC_RELEASE_DATE_RE.test(incoming.releaseDate.trim())
  );
  const existingDateSpecific = Boolean(
    existing.releaseDate && !GENERIC_RELEASE_DATE_RE.test(existing.releaseDate.trim())
  );

  const resolvedReleaseDate =
    incomingDateSpecific
      ? incoming.releaseDate
      : existingDateSpecific
      ? existing.releaseDate
      : incoming.releaseDate || existing.releaseDate || 'Official Release';

  const resolvedTagline =
    (existing.tagline || '').length > (incoming.tagline || '').length &&
    existing.tagline &&
    !existing.tagline.includes('(no separate Wiki release title listed)')
      ? existing.tagline
      : incoming.tagline || existing.tagline || `${setCode} — Battle Spirits set.`;

  const resolvedColors =
    existing.colors && existing.colors.length > 0 && existing.colors.length < 6
      ? existing.colors
      : incoming.colors && incoming.colors.length > 0
      ? incoming.colors
      : existing.colors || ['Red'];

  const resolvedFormats: GameFormat[] = Array.from(
    new Set([...(existing.formats || []), ...(incoming.formats || [])])
  );

  return {
    ...existing,
    ...incoming,
    setCode,
    wikiTitle: incoming.wikiTitle || existing.wikiTitle || setCode,
    category: incoming.category || existing.category,
    name: resolvedName,
    jpName: incoming.jpName || existing.jpName || '',
    productType: incoming.productType || existing.productType,
    releaseDate: resolvedReleaseDate,
    formats: resolvedFormats.length > 0 ? resolvedFormats : ['Eternal'],
    blockLabel: existing.blockLabel || incoming.blockLabel || 'Eternal',
    isLatestStandard: Boolean(existing.isLatestStandard || incoming.isLatestStandard),
    isLatestEternal: Boolean(existing.isLatestEternal || incoming.isLatestEternal),
    tagline: resolvedTagline,
    featuredCardId: existing.featuredCardId || incoming.featuredCardId || `${setCode.toLowerCase()}-001`,
    colors: resolvedColors,
    totalCardsInSet: Math.max(
      Number(existing.totalCardsInSet) || 0,
      Number(incoming.totalCardsInSet) || 0
    ),
    wikiUrl:
      existing.wikiUrl ||
      incoming.wikiUrl ||
      `https://battle-spirits.fandom.com/wiki/${encodeURIComponent(setCode)}`,
  };
}

function inferSetFromCard(card: BattleSpiritsCard, count: number, colors: CardColor[]): ProductSet {
  const sc = (card.setCode || '').trim().toUpperCase();
  const isStd = Array.isArray(card.formats) && card.formats.includes('Standard');
  const isNumberOnly = /^\d+$/.test(sc);

  let category: SetCategory = 'Promo';
  let productType: ProductSet['productType'] = 'Promo Set';
  if (/^(?:26RBS|26REB|26RDB|26RCB)/i.test(sc)) {
    category = 'Standard Booster';
    productType = 'Booster Set';
  } else if (/^26RSD/i.test(sc)) {
    category = 'Standard Starter';
    productType = 'Starter Deck';
  } else if (/^BS\d+/i.test(sc)) {
    category = 'Booster';
    productType = 'Booster Set';
  } else if (/^SD\d+/i.test(sc)) {
    category = 'Starter Deck';
    productType = 'Starter Deck';
  } else if (/^CBX?\d+/i.test(sc)) {
    category = 'Collab Booster';
    productType = 'Collab Booster';
  } else if (/^BSC\d+/i.test(sc)) {
    category = 'Supplementary';
    productType = 'Supplementary Set';
  } else if (/^PB\d+/i.test(sc)) {
    category = 'Premium Bandai';
    productType = 'Premium Bandai';
  } else if (/^PC\d+/i.test(sc)) {
    category = 'Premium Card Set';
    productType = 'Premium Card Set';
  } else if (card.isToken || sc === 'TOKENS') {
    category = 'Token';
    productType = 'Token Set';
  } else if (isNumberOnly) {
    category = isStd ? 'Standard Booster' : 'Booster';
    productType = 'Booster Set';
  }

  const rawCardSetName = (card.setName || '').trim();
  const name =
    rawCardSetName && !GENERIC_NAME_RE.test(rawCardSetName) ? rawCardSetName : sc;

  return {
    setCode: sc,
    wikiTitle: sc,
    category,
    name,
    jpName: '',
    productType,
    releaseDate: isStd ? '2026+' : 'Official Release',
    formats: card.formats?.length ? card.formats : ['Eternal'],
    blockLabel: card.blockIcon || (isStd ? 'Standard Format' : 'Eternal'),
    tagline:
      name !== sc
        ? `${name} (${sc}) — Battle Spirits expansion.`
        : `${sc} — Battle Spirits set.`,
    featuredCardId: card.id,
    colors: colors.length > 0 ? colors : [card.color || 'Red'],
    totalCardsInSet: count,
    wikiUrl: `https://battle-spirits.fandom.com/wiki/${encodeURIComponent(sc)}`,
  };
}

/**
 * Synchronizes multiple set sources cleanly (base/curated + cached + incoming + card-derived sets)
 * and builds an indexed lookup supporting named, code-only, and number-only sets equally well.
 */
export function synchronizeAndIndexSets(
  sources: ProductSet[][],
  cards: BattleSpiritsCard[] = []
): IndexedSetDirectory {
  const byCode = new Map<string, ProductSet>();
  const orderedCodes: string[] = [];

  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const rawSet of list) {
      if (!rawSet || typeof rawSet !== 'object' || !rawSet.setCode) continue;
      const code = normalizeSetIdentifier(rawSet.setCode);
      if (!code || code === 'BSS01') continue;
      if (!byCode.has(code)) {
        orderedCodes.push(code);
      }
      byCode.set(code, mergeSetMetadataRecord(byCode.get(code), rawSet));
    }
  }

  // Aggregate per-set card statistics & discover any orphan/number-only set codes
  if (cards.length > 0) {
    const cardStatsByCode = new Map<
      string,
      { count: number; sample: BattleSpiritsCard; colors: Set<CardColor> }
    >();

    for (const card of cards) {
      const code = normalizeSetIdentifier(card.setCode || '');
      if (!code || code === 'BSS01') continue;
      let entry = cardStatsByCode.get(code);
      if (!entry) {
        entry = { count: 0, sample: card, colors: new Set<CardColor>() };
        cardStatsByCode.set(code, entry);
      }
      entry.count += 1;
      const cardColors = card.colors && card.colors.length > 0 ? card.colors : [card.color];
      for (const col of cardColors) {
        if (col) entry.colors.add(col);
      }
    }

    for (const [code, stats] of cardStatsByCode.entries()) {
      const colorsArr = Array.from(stats.colors);
      const existing = byCode.get(code);
      if (!existing) {
        orderedCodes.push(code);
        byCode.set(
          code,
          inferSetFromCard({ ...stats.sample, setCode: code }, stats.count, colorsArr)
        );
      } else {
        byCode.set(code, {
          ...existing,
          featuredCardId: existing.featuredCardId || stats.sample.id,
          totalCardsInSet: Math.max(existing.totalCardsInSet || 0, stats.count),
          colors:
            existing.colors && existing.colors.length > 0 && existing.colors.length < 6
              ? existing.colors
              : colorsArr.length > 0
              ? colorsArr
              : existing.colors,
        });
      }
    }
  }

  const sets: ProductSet[] = [];
  const tokensByCode = new Map<string, string[]>();
  const numericSetCodes = new Set<string>();

  for (const code of orderedCodes) {
    const set = byCode.get(code);
    if (!set) continue;
    sets.push(set);
    tokensByCode.set(code, buildSetSearchTokens(set));
    if (isNumberOrCodeOnlySet(set)) {
      numericSetCodes.add(code);
    }
  }

  return { sets, byCode, tokensByCode, numericSetCodes };
}

/**
 * Matches a user query against an indexed set entry, ensuring number-only queries
 * ("7", "07", "24", "2026") and code-only sets ("PB07", "PB24") match accurately.
 */
export function matchesIndexedSetQuery(
  set: ProductSet,
  rawQuery: string,
  tokensByCode?: Map<string, string[]>
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const qCompact = q.replace(/[\s-]+/g, '');
  const codeUpper = set.setCode.toUpperCase();

  // Exact number-only query matches exact numeric set names/codes or trailing set numbers
  if (/^\d+$/.test(qCompact)) {
    const padded = qCompact.length <= 2 ? qCompact.padStart(2, '0') : qCompact;
    const unpadded = String(Number(qCompact));
    const tokens = tokensByCode?.get(codeUpper) || buildSetSearchTokens(set);
    if (
      codeUpper === qCompact ||
      codeUpper === padded ||
      set.name.trim() === qCompact ||
      set.name.trim() === padded ||
      tokens.includes(qCompact) ||
      tokens.includes(padded) ||
      tokens.includes(unpadded)
    ) {
      return true;
    }
    return tokens.some((tok) => tok.includes(qCompact));
  }

  const tokens = tokensByCode?.get(codeUpper) || buildSetSearchTokens(set);
  return tokens.some((tok) => tok.includes(q) || (qCompact.length >= 2 && tok.includes(qCompact)));
}

export function loadFastCachedSets(): CachedSetDirectoryPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(FAST_SET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedSetDirectoryPayload>;
    if (!parsed || !Array.isArray(parsed.sets) || parsed.sets.length === 0) return null;
    return {
      sets: parsed.sets,
      syncedAt: typeof parsed.syncedAt === 'number' ? parsed.syncedAt : 0,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
    };
  } catch {
    return null;
  }
}

export function saveFastCachedSets(sets: ProductSet[], syncedAt = Date.now()): void {
  if (typeof window === 'undefined' || !sets.length) return;
  try {
    const payload: CachedSetDirectoryPayload = {
      sets,
      syncedAt,
      version: 1,
    };
    localStorage.setItem(FAST_SET_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore localStorage quota errors
  }
}
