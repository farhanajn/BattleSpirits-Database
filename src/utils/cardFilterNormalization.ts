import { ALL_COLORS, ALL_TYPES } from '../data/theme';
import {
  BattleSpiritsCard,
  CardColor,
  CardType,
  ColorFilter,
  CostBracketFilter,
  FilterState,
  FormatFilter,
  GameFormat,
  ProductSet,
} from '../types/card';
import { normalizeCardNumber } from './decklistImport';
import {
  matchesIndexedSetQuery,
  normalizeSetIdentifier,
  type IndexedSetDirectory,
} from './setMetadataSync';
import {
  evaluateCardSearchMatch,
  type CardSearchEvaluation,
} from './cardSearch';

export const COST_BRACKET_OPTIONS: readonly CostBracketFilter[] = [
  'All',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10+',
] as const;

export const INITIAL_FILTER_STATE: FilterState = {
  search: '',
  setQuery: '',
  format: 'All',
  version: 'All',
  color: 'All',
  type: [],
  family: 'All',
  rarity: [],
  setCode: 'All',
  costBracket: 'All',
  keyword: 'All',
  sortBy: 'number',
};

const JP_COLOR_MAP: Record<string, CardColor> = {
  赤: 'Red',
  紫: 'Purple',
  白: 'White',
  黄: 'Yellow',
  緑: 'Green',
  青: 'Blue',
};

const COLOR_SORT_ORDER: Record<CardColor, number> = {
  Red: 1,
  Purple: 2,
  Green: 3,
  White: 4,
  Yellow: 5,
  Blue: 6,
};

const RARITY_RANK: Record<string, number> = {
  XX: 12,
  XV: 11,
  CX: 10,
  AX: 9,
  NX: 8,
  TX: 7,
  X: 6,
  M: 5,
  R: 4,
  P: 3,
  U: 2,
  C: 1,
};

const JP_TYPE_MAP: Record<string, CardType> = {
  スピリット: 'Spirit',
  アルティメット: 'Ultimate',
  ブレイヴ: 'Brave',
  ネクサス: 'Nexus',
  マジック: 'Magic',
};

const JP_FAMILY_MAP: Record<string, string> = {
  地竜: 'Terra Dragon',
  星竜: 'Astral Dragon',
  古竜: 'Ancient Dragon',
  皇獣: 'Emperor Beast',
  剣獣: 'Blade Beast',
  想獣: 'Imaginary Beast',
  武装: 'Armed Machine',
  甲獣: 'Armored Beast',
  甲竜: 'Armored Dragon',
  妖蛇: 'Dark Snake',
  闘神: 'Fighting Spirit',
  造兵: 'Artificial Soldier',
  殻人: 'Shellman',
  怪虫: 'Blade Insect',
  魔影: 'Evil Shadow',
  無魔: 'Corpse',
  夜族: 'Nightling',
  呪鬼: 'Karmafiend',
  冥主: 'Netherworld',
  導魔: 'Devotee',
  楽族: 'Song Bird',
  機人: 'Android',
  獣頭: 'Beast Head',
  創界神: 'Grandwalker',
  化神: 'Avatar',
  締皇: 'Rouse Emperor',
  眷属: 'Vassal',
  起幻: 'Phantasprite',
  緋炎: 'Scarlet Flame',
  蒼波: 'Azure Wave',
  碧雷: 'Jade Thunder',
  血晶: 'Blood Crystal',
  銀零: 'Silver Zero',
  金雲: 'Golden Cloud',
  神皇: 'God-King',
  空契約: 'Sky Contract',
  炎契約: 'Flame Contract',
  熱契約: 'Heat Contract',
  雲契約: 'Cloud Contract',
  雷契約: 'Thunder Contract',
  冥契約: 'Dark Contract',
  碧契約: 'Jade Contract',
  銀契約: 'Silver Contract',
  血契約: 'Blood Contract',
  蒼契約: 'Azure Contract',
  刃契約: 'Blade Contract',
  数契約: 'Number Contract',
  極契約: 'Ultimate Contract',
};

export function normalizeSingleColor(raw: unknown): CardColor | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const enMatch = ALL_COLORS.find((c) => c.toLowerCase() === lower);
  if (enMatch) return enMatch;
  if (JP_COLOR_MAP[trimmed]) return JP_COLOR_MAP[trimmed];
  return null;
}

function extractColorsFromToken(raw: unknown, out: CardColor[]): void {
  if (typeof raw !== 'string') return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  const lower = trimmed.toLowerCase();

  if (/^(?:all|omni|rainbow|all colors?|6[\s-]*colors?|全色)$/i.test(lower)) {
    for (const col of ALL_COLORS) {
      if (!out.includes(col)) out.push(col);
    }
    return;
  }

  const direct = normalizeSingleColor(trimmed);
  if (direct) {
    if (!out.includes(direct)) out.push(direct);
    return;
  }

  // Handle delimited strings such as "Red / Blue", "Red, Yellow", "赤・青", "Red & White"
  const parts = trimmed.split(/[/,&・、|]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const single = normalizeSingleColor(part);
    if (single) {
      if (!out.includes(single)) out.push(single);
      continue;
    }
    // Check standalone English words inside multi-word strings like "Red / Blue"
    const enMatches = part.match(/\b(Red|Purple|White|Yellow|Green|Blue)\b/gi);
    if (enMatches) {
      for (const word of enMatches) {
        const c = normalizeSingleColor(word);
        if (c && !out.includes(c)) out.push(c);
      }
    }
    for (const [jp, en] of Object.entries(JP_COLOR_MAP)) {
      if (part.includes(jp) && !out.includes(en)) {
        out.push(en);
      }
    }
  }
}

export function normalizeCardColors(card: Partial<BattleSpiritsCard>): CardColor[] {
  const result: CardColor[] = [];

  if (Array.isArray(card.colors)) {
    for (const c of card.colors) {
      extractColorsFromToken(c, result);
    }
  } else if (typeof (card.colors as unknown) === 'string') {
    extractColorsFromToken(card.colors, result);
  }

  if (card.color) {
    extractColorsFromToken(card.color, result);
  }

  if (card.secondaryColor) {
    extractColorsFromToken(card.secondaryColor, result);
  }

  return result;
}

export function matchesColorFilter(
  card: Partial<BattleSpiritsCard>,
  colorFilter: ColorFilter | ColorFilter[]
): boolean {
  if (!colorFilter) return true;
  const cardColors = normalizeCardColors(card);

  if (Array.isArray(colorFilter)) {
    if (colorFilter.length === 0) return true;
    if (colorFilter.some((c) => typeof c === 'string' && c.trim().toLowerCase() === 'all')) {
      return true;
    }

    const wantsMulticolor = colorFilter.some(
      (c) => typeof c === 'string' && /^multi[\s-]*color$/i.test(c.trim())
    );
    const requestedColors: CardColor[] = [];
    for (const item of colorFilter) {
      if (typeof item === 'string' && /^multi[\s-]*color$/i.test(item.trim())) continue;
      extractColorsFromToken(item, requestedColors);
    }

    if (wantsMulticolor && cardColors.length < 2) {
      return false;
    }
    if (requestedColors.length > 0) {
      return requestedColors.some((c) => cardColors.includes(c));
    }
    return wantsMulticolor;
  }

  const trimmed = String(colorFilter).trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') return true;
  if (/^multi[\s-]*color$/i.test(trimmed)) {
    return cardColors.length >= 2;
  }

  const normalizedSingle = normalizeSingleColor(trimmed);
  if (normalizedSingle) {
    return cardColors.includes(normalizedSingle);
  }

  const requestedColors: CardColor[] = [];
  extractColorsFromToken(trimmed, requestedColors);
  if (requestedColors.length === 0) return false;
  return requestedColors.some((c) => cardColors.includes(c));
}

function normalizeStructuredTypeSegment(rawSegment: string): CardType | null {
  const cleaned = rawSegment
    .trim()
    .replace(/\s*(?:\([^)]*\)|【[^】]*】)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  const exactEn = ALL_TYPES.find((t) => t.toLowerCase() === lower);
  if (exactEn) return exactEn;

  if (JP_TYPE_MAP[cleaned]) return JP_TYPE_MAP[cleaned];

  // Structured Battle Spirits card type phrases where the canonical type is the head noun
  // e.g. "Token Spirit", "Contract Spirit", "Contract Nexus", "Token Nexus", "Contract Grandwalker Nexus", "God Brave"
  for (const t of ALL_TYPES) {
    const suffixRe = new RegExp(`(?:^|\\s)${t.toLowerCase()}$`);
    if (suffixRe.test(lower)) {
      return t;
    }
  }

  for (const [jp, en] of Object.entries(JP_TYPE_MAP)) {
    if (cleaned.endsWith(jp)) {
      return en;
    }
  }

  return null;
}

function collectStructuredTypesFromField(rawField: unknown, out: CardType[]): void {
  if (Array.isArray(rawField)) {
    for (const item of rawField) {
      collectStructuredTypesFromField(item, out);
    }
    return;
  }
  if (typeof rawField !== 'string') return;
  const trimmed = rawField.trim();
  if (!trimmed) return;

  const segments = trimmed.split(/[/,&・、|+]+/).map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const mapped = normalizeStructuredTypeSegment(segment);
    if (mapped && !out.includes(mapped)) {
      out.push(mapped);
    }
  }
}

export function normalizeCardTypes(card: Partial<BattleSpiritsCard>): CardType[] {
  const result: CardType[] = [];
  const cardWithExtra = card as Partial<BattleSpiritsCard> & { types?: unknown };
  collectStructuredTypesFromField(cardWithExtra.types, result);
  collectStructuredTypesFromField(card.type, result);
  collectStructuredTypesFromField(card.subtypeLabel, result);
  return result;
}

export function matchesTypeFilter(
  card: Partial<BattleSpiritsCard>,
  selectedTypes: CardType[] | CardType | 'All'
): boolean {
  const rawList = Array.isArray(selectedTypes)
    ? selectedTypes
    : selectedTypes
    ? [selectedTypes]
    : [];
  if (rawList.length === 0) return true;
  if (rawList.some((t) => typeof t === 'string' && t.trim().toLowerCase() === 'all')) {
    return true;
  }

  const normalizedRequested: CardType[] = [];
  collectStructuredTypesFromField(rawList, normalizedRequested);
  if (normalizedRequested.length === 0) return false;

  const cardTypes = normalizeCardTypes(card);
  if (cardTypes.length === 0) return false;
  return normalizedRequested.some((reqType) => cardTypes.includes(reqType));
}

export function canonicalizeFamilyLabel(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  if (/^(?:-|—|–|none|n\/a|nil|null|undefined)$/i.test(trimmed)) return '';
  if (JP_FAMILY_MAP[trimmed]) return JP_FAMILY_MAP[trimmed];
  return trimmed;
}

export function normalizeCardFamilies(rawFamilies: unknown): string[] {
  const rawEntries: string[] = [];
  if (Array.isArray(rawFamilies)) {
    for (const item of rawFamilies) {
      if (typeof item === 'string') rawEntries.push(item);
    }
  } else if (typeof rawFamilies === 'string') {
    rawEntries.push(rawFamilies);
  }

  const result: string[] = [];
  const seenKeys = new Set<string>();

  for (const entry of rawEntries) {
    const parts = entry.split(/[,/・、／]+/);
    for (const part of parts) {
      const canonical = canonicalizeFamilyLabel(part);
      if (!canonical) continue;
      const key = canonical.toLowerCase();
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        result.push(canonical);
      }
    }
  }

  return result;
}

export function extractAvailableFamilies(cards: Partial<BattleSpiritsCard>[]): string[] {
  const byKey = new Map<string, string>();
  for (const card of cards) {
    for (const family of normalizeCardFamilies(card.families)) {
      const key = family.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, family);
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' })
  );
}

export function matchesFamilyFilter(
  card: Partial<BattleSpiritsCard>,
  selectedFamily: string | string[] | 'All'
): boolean {
  if (!selectedFamily) return true;
  const cardFamilies = normalizeCardFamilies(card.families);

  if (Array.isArray(selectedFamily)) {
    if (selectedFamily.length === 0) return true;
    if (selectedFamily.some((f) => typeof f === 'string' && f.trim().toLowerCase() === 'all')) {
      return true;
    }
    const targetKeys = selectedFamily
      .map((f) => canonicalizeFamilyLabel(String(f || '')).toLowerCase())
      .filter(Boolean);
    if (targetKeys.length === 0) return false;
    return cardFamilies.some((cf) => targetKeys.includes(cf.toLowerCase()));
  }

  const trimmed = String(selectedFamily).trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') return true;
  const targetCanonical = canonicalizeFamilyLabel(trimmed);
  if (!targetCanonical) return false;
  const targetKey = targetCanonical.toLowerCase();
  return cardFamilies.some((f) => f.toLowerCase() === targetKey);
}

export function normalizeCardCost(rawCost: unknown): number | null {
  if (typeof rawCost === 'number') {
    if (!Number.isFinite(rawCost) || !Number.isInteger(rawCost) || rawCost < 0 || rawCost > 99) {
      return null;
    }
    return rawCost;
  }
  if (typeof rawCost === 'string') {
    const trimmed = rawCost.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99) return null;
    return parsed;
  }
  return null;
}

export function matchesCostBracket(
  card: Partial<BattleSpiritsCard>,
  bracket: FilterState['costBracket']
): boolean {
  if (!bracket) return true;
  const trimmed = String(bracket).trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') return true;
  const cost = normalizeCardCost(card.cost);
  if (cost === null) return false;
  if (trimmed === '10+') return cost >= 10;
  if (/^[0-9]$/.test(trimmed)) {
    return cost === Number.parseInt(trimmed, 10);
  }
  return false;
}

export function normalizeCardForCatalog(card: BattleSpiritsCard): BattleSpiritsCard {
  const normalizedColors = normalizeCardColors(card);
  const normalizedTypes = normalizeCardTypes(card);
  const normalizedFamilies = normalizeCardFamilies(card.families);
  const parsedCost = normalizeCardCost(card.cost);

  const primaryColor: CardColor =
    normalizedColors[0] || normalizeSingleColor(card.color) || 'Red';
  const secondaryColor =
    normalizedColors.length >= 2 ? normalizedColors[1] : undefined;

  return {
    ...card,
    color: primaryColor,
    ...(secondaryColor ? { secondaryColor } : { secondaryColor: undefined }),
    colors: normalizedColors.length > 0 ? normalizedColors : undefined,
    type: normalizedTypes[0] || card.type || 'Spirit',
    families: normalizedFamilies,
    cost: parsedCost !== null ? parsedCost : Number.NaN,
    keywords: Array.isArray(card.keywords)
      ? Array.from(
          new Set(card.keywords.map((k) => (typeof k === 'string' ? k.trim() : '')).filter(Boolean))
        )
      : [],
  };
}

export interface SearchSetIntent {
  exactSetCode?: string;
  paddedSetNum?: string;
  rawDigits?: string;
}

export function resolveSearchSetIntent(
  rawQuery: string,
  knownSetCodes: Set<string>,
  numericSetCodes?: Set<string>
): SearchSetIntent | null {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return null;

  const explicitSetPrefix = /^set\s+/i.test(q);
  const numOnly = q.match(/^(?:set\s*)?(\d{1,4})$/i);
  if (numOnly) {
    const rawDigits = numOnly[1];
    const padded = rawDigits.length <= 2 ? rawDigits.padStart(2, '0') : rawDigits;
    const unpadded = String(Number(rawDigits));
    const exactNumCode = knownSetCodes.has(rawDigits)
      ? rawDigits
      : knownSetCodes.has(padded)
      ? padded
      : knownSetCodes.has(unpadded)
      ? unpadded
      : numericSetCodes?.has(rawDigits)
      ? rawDigits
      : numericSetCodes?.has(padded)
      ? padded
      : undefined;

    if (rawDigits.length <= 2 || exactNumCode || explicitSetPrefix) {
      return {
        ...(exactNumCode ? { exactSetCode: exactNumCode } : {}),
        paddedSetNum: rawDigits.length <= 2 ? padded : rawDigits,
        rawDigits,
      };
    }
  }

const CANONICAL_SET_CODE_RE =
  /^(?:26R(?:BS|SD|CB|EB|DB)\d{1,2}|(?:BS|SD|CBX|CB|BSC|PB|PC)\d{1,3}|RP26(?:-STD)?|PX26(?:-STD)?|RPX26)$/i;

  const stripped = q.replace(/^set\s+/i, '').trim();
  const compact = stripped.replace(/[\s-]+/g, '').toUpperCase();
  const shortCodeMatch = compact.match(/^(BS|SD|CB|BSC|PB|PC|RP|PX)(\d{1})$/);
  const candidate = shortCodeMatch
    ? `${shortCodeMatch[1]}0${shortCodeMatch[2]}`
    : compact;

  if (knownSetCodes.has(candidate) || CANONICAL_SET_CODE_RE.test(candidate)) {
    return { exactSetCode: normalizeSetIdentifier(candidate) || candidate };
  }
  return null;
}

export function getCardNumberPrefix(cardNumber: string): string {
  const m = (cardNumber || '').trim().match(/^([A-Z0-9]+)-/i);
  return m ? normalizeSetIdentifier(m[1]) : '';
}

export function matchesFormatFilter(formats: GameFormat[], filter: FormatFilter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Standard') return formats.includes('Standard');
  return !formats.includes('Standard') && formats.includes('Eternal');
}

export interface CatalogFilterContext {
  knownSetCodes?: Set<string>;
  indexedSetDirectory?: IndexedSetDirectory;
  setLookupByCode?: Map<string, ProductSet>;
  releaseRankBySetCode?: Map<string, number>;
  /** When true and filters.sortBy is 'number' during a text search, strictly sort by Set & Number instead of Relevance. */
  preserveRequestedSort?: boolean;
  precomputedSearchSetIntent?: SearchSetIntent | null;
  precomputedSetQIntent?: SearchSetIntent | null;
}

function matchesSetIntent(card: BattleSpiritsCard, intent: SearchSetIntent): boolean {
  const cardSetUpper = normalizeSetIdentifier(card.setCode);
  const cardPrefix = getCardNumberPrefix(card.cardNumber);
  if (intent.exactSetCode) {
    const normIntent = normalizeSetIdentifier(intent.exactSetCode);
    if (normIntent === 'TOKENS') return Boolean(card.isToken);
    if (normIntent === 'REVIVAL') return Boolean(card.isRevival);
    if (cardSetUpper === normIntent || cardPrefix === normIntent) {
      return true;
    }
  }
  if (intent.rawDigits && cardSetUpper === intent.rawDigits.toUpperCase()) {
    return true;
  }
  if (intent.paddedSetNum) {
    const endRegex = new RegExp(`(?:^|[^0-9])${intent.paddedSetNum}$`, 'i');
    return (
      cardSetUpper === intent.paddedSetNum ||
      endRegex.test(cardSetUpper) ||
      endRegex.test(cardPrefix)
    );
  }
  return false;
}

function evaluateCardFiltersAndSearch(
  card: BattleSpiritsCard,
  filters: FilterState,
  context: CatalogFilterContext = {}
): { matched: boolean; searchEval: CardSearchEvaluation } {
  const emptyEval: CardSearchEvaluation = { matched: false, score: 0 };
  if (normalizeSetIdentifier(card.setCode || '') === 'BSS01') {
    return { matched: false, searchEval: emptyEval };
  }

  const formatMatches = matchesFormatFilter(
    Array.isArray(card.formats) ? card.formats : ['Eternal'],
    filters.format
  );
  if (!formatMatches) return { matched: false, searchEval: emptyEval };

  if (filters.version === 'Original' && card.isRevival) {
    return { matched: false, searchEval: emptyEval };
  }
  if (filters.version === 'Revival' && !card.isRevival) {
    return { matched: false, searchEval: emptyEval };
  }

  if (filters.setCode !== 'All') {
    const targetSetNorm = normalizeSetIdentifier(filters.setCode);
    if (targetSetNorm === 'TOKENS') {
      if (!card.isToken) return { matched: false, searchEval: emptyEval };
    } else if (targetSetNorm === 'REVIVAL') {
      if (!card.isRevival) return { matched: false, searchEval: emptyEval };
    } else if (normalizeSetIdentifier(card.setCode) !== targetSetNorm) {
      return { matched: false, searchEval: emptyEval };
    }
  }

  const knownSetCodes = context.knownSetCodes || new Set<string>(['TOKENS', 'REVIVAL']);
  const numericSetCodes = context.indexedSetDirectory?.numericSetCodes;
  const setLookup = context.setLookupByCode || context.indexedSetDirectory?.byCode;
  const matchedSet = setLookup?.get((card.setCode || '').toUpperCase());

  const setQ = (filters.setQuery || '').trim().toLowerCase();
  if (setQ) {
    const setQCompact = setQ.replace(/[\s-]+/g, '');
    const setQIntent =
      context.precomputedSetQIntent !== undefined
        ? context.precomputedSetQIntent
        : resolveSearchSetIntent(setQ, knownSetCodes, numericSetCodes);
    if (setQIntent) {
      if (!matchesSetIntent(card, setQIntent)) {
        return { matched: false, searchEval: emptyEval };
      }
    } else {
      const indexedMatch =
        matchedSet && context.indexedSetDirectory
          ? matchesIndexedSetQuery(matchedSet, setQ, context.indexedSetDirectory.tokensByCode)
          : false;
      const setHay = `${card.setCode || ''} ${card.setName || ''} ${matchedSet?.jpName || ''} ${matchedSet?.tagline || ''}`.toLowerCase();
      const setHayCompact = setHay.replace(/[\s-]+/g, '');
      if (
        !indexedMatch &&
        !setHay.includes(setQ) &&
        !(setQCompact.length >= 2 && setHayCompact.includes(setQCompact))
      ) {
        return { matched: false, searchEval: emptyEval };
      }
    }
  }

  const normalizedRarities = (filters.rarity || [])
    .map((r) => String(r || '').trim().toUpperCase())
    .filter(Boolean);
  const rarityMatches =
    normalizedRarities.length === 0 ||
    normalizedRarities.includes((card.rarity || '').trim().toUpperCase());

  const keywordMatches =
    !filters.keyword ||
    filters.keyword === 'All' ||
    (card.keywords || []).some(
      (k) => k.trim().toLowerCase() === filters.keyword.trim().toLowerCase()
    );

  // Strict AND combination across all active facet filters before/alongside text search
  const facetsMatch =
    matchesColorFilter(card, filters.color) &&
    matchesTypeFilter(card, filters.type) &&
    matchesFamilyFilter(card, filters.family) &&
    matchesCostBracket(card, filters.costBracket) &&
    rarityMatches &&
    keywordMatches;

  if (!facetsMatch) {
    return { matched: false, searchEval: emptyEval };
  }

  const rawSearch = (filters.search || '').trim();
  if (!rawSearch) {
    return { matched: true, searchEval: { matched: true, score: 0 } };
  }

  const searchSetIntent =
    context.precomputedSearchSetIntent !== undefined
      ? context.precomputedSearchSetIntent
      : resolveSearchSetIntent(rawSearch, knownSetCodes, numericSetCodes);
  const matchedSetIntent = searchSetIntent ? matchesSetIntent(card, searchSetIntent) : false;

  if (searchSetIntent) {
    if (!matchedSetIntent) {
      // Allow literal card-name matches when query wasn't prefixed with "set "
      if (/^set\s+/i.test(rawSearch)) {
        return { matched: false, searchEval: emptyEval };
      }
    } else {
      const evalWithSet = evaluateCardSearchMatch(card, rawSearch, {
        matchedSet,
        matchedSetIntent: true,
      });
      return { matched: true, searchEval: evalWithSet };
    }
  }

  const searchEval = evaluateCardSearchMatch(card, rawSearch, {
    matchedSet,
    matchedSetIntent: false,
  });

  if (!searchEval.matched) {
    return { matched: false, searchEval: emptyEval };
  }

  return { matched: true, searchEval };
}

export function cardMatchesFilters(
  card: BattleSpiritsCard,
  filters: FilterState,
  context: CatalogFilterContext = {}
): boolean {
  return evaluateCardFiltersAndSearch(card, filters, context).matched;
}

export function filterCatalogCards(
  cards: BattleSpiritsCard[],
  filters: FilterState,
  context: CatalogFilterContext = {}
): BattleSpiritsCard[] {
  const knownSetCodes = (() => {
    if (context.knownSetCodes) return context.knownSetCodes;
    const derived = new Set<string>(['TOKENS', 'REVIVAL']);
    for (const c of cards) {
      if (c.setCode) {
        derived.add(c.setCode.trim().toUpperCase());
        const norm = normalizeSetIdentifier(c.setCode);
        if (norm) derived.add(norm);
      }
    }
    return derived;
  })();

  const numericSetCodes = context.indexedSetDirectory?.numericSetCodes;
  const q = (filters.search || '').trim().toLowerCase();
  const setQ = (filters.setQuery || '').trim().toLowerCase();
  const searchSetIntent = q ? resolveSearchSetIntent(q, knownSetCodes, numericSetCodes) : null;
  const setQIntent = setQ ? resolveSearchSetIntent(setQ, knownSetCodes, numericSetCodes) : null;

  const effectiveContext: CatalogFilterContext = {
    ...context,
    knownSetCodes,
    precomputedSearchSetIntent: searchSetIntent,
    precomputedSetQIntent: setQIntent,
  };

  const scoredItems: { card: BattleSpiritsCard; score: number }[] = [];
  const seenKeys = new Set<string>();

  for (const card of cards) {
    const res = evaluateCardFiltersAndSearch(card, filters, effectiveContext);
    if (!res.matched) continue;

    const numKey = normalizeCardNumber(card.cardNumber || '');
    if (numKey && numKey !== 'WIKI') {
      const key = `${numKey}|${card.isRevival ? 'rv' : 'orig'}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }

    scoredItems.push({ card, score: res.searchEval.score });
  }

  const getMaxBp = (c: BattleSpiritsCard) =>
    c.levels && c.levels.length > 0 ? c.levels[c.levels.length - 1].bp : 0;

  const targetExactSet =
    filters.setCode !== 'All'
      ? normalizeSetIdentifier(filters.setCode)
      : setQIntent?.exactSetCode || searchSetIntent?.exactSetCode || '';
  const targetPaddedNum = setQIntent?.paddedSetNum || searchSetIntent?.paddedSetNum || '';

  const getNativePriority = (c: BattleSpiritsCard): number => {
    const prefix = getCardNumberPrefix(c.cardNumber);
    const cardSetNorm = normalizeSetIdentifier(c.setCode);
    if (targetExactSet) {
      if (prefix === targetExactSet) return 0;
      if (cardSetNorm === targetExactSet) return 1;
      return 2;
    }
    if (targetPaddedNum) {
      if (prefix === `BS${targetPaddedNum}`) return 0;
      if (new RegExp(`(?:^|[^0-9])${targetPaddedNum}$`, 'i').test(prefix)) return 1;
      return 2;
    }
    return prefix === cardSetNorm ? 0 : 1;
  };

  const getComparableCost = (c: BattleSpiritsCard): number => {
    const parsed = normalizeCardCost(c.cost);
    return parsed !== null ? parsed : Number.MAX_SAFE_INTEGER;
  };

  const releaseRankBySetCode = effectiveContext.releaseRankBySetCode;
  const useRelevanceRanking =
    q.length > 0 &&
    (filters.sortBy === 'relevance' ||
      (filters.sortBy === 'number' && !effectiveContext.preserveRequestedSort));

  scoredItems.sort((itemA, itemB) => {
    const a = itemA.card;
    const b = itemB.card;

    if (useRelevanceRanking) {
      const scoreDiff = itemB.score - itemA.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (
        (a.isRevival ? 1 : 0) - (b.isRevival ? 1 : 0) ||
        getNativePriority(a) - getNativePriority(b) ||
        a.cardNumber.localeCompare(b.cardNumber)
      );
    }

    if (filters.sortBy === 'newest') {
      const ra = releaseRankBySetCode?.get((a.setCode || '').toUpperCase()) || 0;
      const rb = releaseRankBySetCode?.get((b.setCode || '').toUpperCase()) || 0;
      return (
        rb - ra ||
        (q.length > 0 ? itemB.score - itemA.score : 0) ||
        getNativePriority(a) - getNativePriority(b) ||
        a.cardNumber.localeCompare(b.cardNumber)
      );
    }
    if (filters.sortBy === 'rarity-desc') {
      return (
        (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0) ||
        (q.length > 0 ? itemB.score - itemA.score : 0) ||
        a.cardNumber.localeCompare(b.cardNumber)
      );
    }
    if (filters.sortBy === 'color') {
      const colorsA = normalizeCardColors(a);
      const colorsB = normalizeCardColors(b);
      const ca = colorsA[0] ? COLOR_SORT_ORDER[colorsA[0]] || 99 : 99;
      const cb = colorsB[0] ? COLOR_SORT_ORDER[colorsB[0]] || 99 : 99;
      return (
        ca - cb ||
        colorsA.length - colorsB.length ||
        getComparableCost(a) - getComparableCost(b) ||
        a.cardNumber.localeCompare(b.cardNumber)
      );
    }
    if (filters.sortBy === 'cost-asc') {
      return (
        getComparableCost(a) - getComparableCost(b) ||
        (q.length > 0 ? itemB.score - itemA.score : 0) ||
        a.cardNumber.localeCompare(b.cardNumber)
      );
    }
    if (filters.sortBy === 'cost-desc') {
      const ca = normalizeCardCost(a.cost) ?? -1;
      const cb = normalizeCardCost(b.cost) ?? -1;
      return (
        cb - ca ||
        (q.length > 0 ? itemB.score - itemA.score : 0) ||
        a.cardNumber.localeCompare(b.cardNumber)
      );
    }
    if (filters.sortBy === 'bp-desc') {
      return (
        getMaxBp(b) - getMaxBp(a) ||
        (q.length > 0 ? itemB.score - itemA.score : 0) ||
        a.cardNumber.localeCompare(b.cardNumber)
      );
    }
    if (filters.sortBy === 'name') {
      return a.name.localeCompare(b.name) || a.cardNumber.localeCompare(b.cardNumber);
    }
    return getNativePriority(a) - getNativePriority(b) || a.cardNumber.localeCompare(b.cardNumber);
  });

  return scoredItems.map((item) => item.card);
}

export { evaluateCardSearchMatch, scoreCardSearchMatch } from './cardSearch';
