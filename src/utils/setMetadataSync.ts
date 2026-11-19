import type { BattleSpiritsCard, CardColor, GameFormat, ProductSet, SetCategory } from '../types/card';

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
    return {
      ...incoming,
      setCode: incoming.setCode.trim().toUpperCase(),
      name: (incoming.name || incoming.setCode).trim(),
      jpName: incoming.jpName || '',
      colors: Array.isArray(incoming.colors) && incoming.colors.length > 0 ? incoming.colors : ['Red'],
      formats: Array.isArray(incoming.formats) && incoming.formats.length > 0 ? incoming.formats : ['Eternal'],
      totalCardsInSet: Number(incoming.totalCardsInSet) || 0,
    };
  }

  const setCode = (incoming.setCode || existing.setCode).trim().toUpperCase();
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
      const code = rawSet.setCode.trim().toUpperCase();
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
      const code = (card.setCode || '').trim().toUpperCase();
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
        byCode.set(code, inferSetFromCard(stats.sample, stats.count, colorsArr));
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
