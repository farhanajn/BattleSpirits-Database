import type { BattleSpiritsCard, ProductSet } from '../types/card.ts';
import { compactCardNumber, normalizeCardNumber } from './decklistImport.ts';
import { normalizeSetIdentifier } from './setMetadataSync.ts';

const JAPANESE_CHAR_RE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

// General Battle Spirits transliteration / Romanization and US-UK spelling variants
// applied ONLY at whole-token level on card names and aliases (never per-card special rules).
const NAME_TOKEN_EQUIVALENTS: Record<string, readonly string[]> = {
  beelzebub: ['belzeebub', 'beelzebeat'],
  belzeebub: ['beelzebub', 'beelzebeat'],
  beelzebeat: ['beelzebub', 'belzeebub'],
  siegwurm: ['seigwurm'],
  seigwurm: ['siegwurm'],
  siegfried: ['siegefried', 'seigfried'],
  siegefried: ['siegfried', 'seigfried'],
  seigfried: ['siegfried', 'siegefried'],
  grey: ['gray'],
  gray: ['grey'],
  armour: ['armor'],
  armor: ['armour'],
  armoured: ['armored'],
  armored: ['armoured'],
  colour: ['color'],
  color: ['colour'],
  valour: ['valor'],
  valor: ['valour'],
};

export interface NormalizedSearchField {
  rawLower: string;
  phrase: string;
  splitPhrase: string;
  splitPhraseNoArticle: string;
  tokens: string[];
  tokenSet: Set<string>;
  wordTokens: string[];
  wordTokenSet: Set<string>;
  compact: string;
}

export interface NormalizedEffectBlock {
  phrase: string;
  tokens: string[];
  tokenSet: Set<string>;
}

export interface CardSearchIndexEntry {
  primaryName: NormalizedSearchField;
  baseName: NormalizedSearchField;
  aliases: NormalizedSearchField[];
  traits: NormalizedSearchField;
  effectBlocks: NormalizedEffectBlock[];
  allEffectTokens: Set<string>;
  allEffectPhrase: string;
  jpNameNorm: string;
  jpEffectNorm: string;
  cardNumberNorm: string;
  cardNumberCompact: string;
  cardNumberNoDash: string;
  setCodeNorm: string;
  setNameField: NormalizedSearchField;
  metadataField: NormalizedSearchField;
}

export type CardSearchMatchTier =
  | 'exact_name'
  | 'exact_card_number'
  | 'exact_alias'
  | 'name_prefix'
  | 'name_contains'
  | 'alias_contains'
  | 'trait_match'
  | 'effect_match'
  | 'japanese_match'
  | 'metadata_match';

export interface CardSearchEvaluation {
  matched: boolean;
  score: number;
  tier?: CardSearchMatchTier;
}

export interface ParsedSearchQuery {
  raw: string;
  rawLower: string;
  phrase: string;
  splitPhrase: string;
  compact: string;
  tokens: string[];
  hasJapanese: boolean;
  cardNumberQueryNorm: string;
  cardNumberQueryCompact: string;
  cardNumberQueryNoDash: string;
  looksLikeCardNumberQuery: boolean;
}

export interface CardSearchInputContext {
  families?: string[];
  types?: string[];
  colors?: string[];
  matchedSet?: ProductSet;
  matchedSetIntent?: boolean;
}

const cardIndexCache = new WeakMap<
  BattleSpiritsCard,
  { key: string; entry: CardSearchIndexEntry }
>();

function normalizeUnicodePunctuation(raw: string): string {
  return (raw || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019`´＇]/g, "'")
    .replace(/[\u201C\u201D＂]/g, '"')
    .replace(/[\u2010-\u2015\u2212・]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCamelCasePreserveWords(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function tokenizeNormalizedWords(input: string): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.split(' ') : [];
}

function extractWordTokensWithPossessiveVariants(rawNormalized: string): {
  phrase: string;
  tokens: string[];
} {
  // Turn apostrophes into split points too so "Pepper's" yields both "peppers" and "pepper"
  const rawLower = rawNormalized.toLowerCase();
  const collapsedPhrase = tokenizeNormalizedWords(rawLower).join(' ');
  const splitApostrophe = rawLower.replace(/(\w+)'s\b/g, '$1s $1').replace(/'/g, ' ');
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (tok: string) => {
    if (!tok || seen.has(tok)) return;
    seen.add(tok);
    tokens.push(tok);
  };

  for (const tok of tokenizeNormalizedWords(rawLower)) push(tok);
  for (const tok of tokenizeNormalizedWords(splitApostrophe)) push(tok);

  return { phrase: collapsedPhrase, tokens };
}

export function buildNormalizedSearchField(
  rawText: string,
  options?: { allowCamelSplit?: boolean; includeCompact?: boolean }
): NormalizedSearchField {
  const baseNorm = normalizeUnicodePunctuation(rawText);
  const rawLower = baseNorm.toLowerCase();
  const { phrase, tokens: baseWordTokens } = extractWordTokensWithPossessiveVariants(baseNorm);

  let splitPhrase = phrase;
  const allTokens: string[] = [];
  const allSeen = new Set<string>();
  const pushAll = (tok: string) => {
    if (!tok || allSeen.has(tok)) return;
    allSeen.add(tok);
    allTokens.push(tok);
  };

  if (options?.allowCamelSplit !== false) {
    const camelSplit = splitCamelCasePreserveWords(baseNorm);
    const splitRes = extractWordTokensWithPossessiveVariants(camelSplit);
    splitPhrase = splitRes.phrase || phrase;
    // Order: CamelCase-split tokens first (clean word boundaries), then unsplit compound tokens
    for (const tok of splitRes.tokens) pushAll(tok);
    for (const tok of baseWordTokens) pushAll(tok);
  } else {
    for (const tok of baseWordTokens) pushAll(tok);
  }

  const splitPhraseNoArticle = splitPhrase.replace(/^the\s+/i, '').trim();
  const compact =
    options?.includeCompact === true ? splitPhrase.replace(/[^a-z0-9]/g, '') : '';

  return {
    rawLower,
    phrase,
    splitPhrase,
    splitPhraseNoArticle,
    tokens: allTokens,
    tokenSet: new Set(allTokens),
    wordTokens: baseWordTokens,
    wordTokenSet: new Set(baseWordTokens),
    compact,
  };
}

function stripNameSuffixDecorations(raw: string): string {
  return (raw || '')
    .replace(/\s*\(Revival\)\s*$/i, '')
    .replace(/\s*\(Card\)\s*$/i, '')
    .replace(/\s*\((?:A|B)\)\s*$/i, '')
    .replace(/\s*\([A-Z]{1,6}\d{1,3}-[A-Z0-9-]+\)\s*$/i, '')
    .trim();
}

export function buildCardSearchIndexEntry(
  card: BattleSpiritsCard,
  context?: Pick<CardSearchInputContext, 'families' | 'types' | 'colors' | 'matchedSet'>
): CardSearchIndexEntry {
  const famKey = Array.isArray(context?.families)
    ? context.families.join(',')
    : Array.isArray(card.families)
    ? card.families.join(',')
    : '';
  const typeKey = Array.isArray(context?.types)
    ? context.types.join(',')
    : `${card.type || ''}|${card.subtypeLabel || ''}`;
  const setMeta = context?.matchedSet;

  const cached = cardIndexCache.get(card);
  if (
    cached &&
    (!setMeta || cached.key === `${famKey}|${typeKey}|${setMeta.name}|${setMeta.jpName || ''}`)
  ) {
    return cached.entry;
  }

  const famList =
    context?.families && context.families.length > 0
      ? context.families
      : Array.isArray(card.families)
      ? card.families
      : [];
  const typeList =
    context?.types && context.types.length > 0
      ? context.types
      : [card.type, card.subtypeLabel || ''].filter(Boolean);
  const colorList =
    context?.colors && context.colors.length > 0
      ? context.colors
      : [card.color, card.secondaryColor || '', ...(card.colors || [])].filter(Boolean);

  const cacheKey = `${famKey}|${typeKey}|${setMeta?.name || ''}|${setMeta?.jpName || ''}`;

  const primaryName = buildNormalizedSearchField(card.name || '', {
    allowCamelSplit: true,
    includeCompact: true,
  });

  const strippedBase = stripNameSuffixDecorations(card.name || '');
  const baseName =
    strippedBase && strippedBase.toLowerCase() !== (card.name || '').trim().toLowerCase()
      ? buildNormalizedSearchField(strippedBase, {
          allowCamelSplit: true,
          includeCompact: true,
        })
      : primaryName;

  // Alternative names / translations / aliases (wikiTitle when distinct, plus explicit aliases/altNames)
  const aliasRawCandidates: string[] = [];
  const seenAliasKeys = new Set<string>([
    primaryName.splitPhrase,
    baseName.splitPhrase,
  ]);
  const pushAlias = (rawAlias?: string) => {
    const clean = stripNameSuffixDecorations(rawAlias || '');
    if (!clean) return;
    const normCheck = buildNormalizedSearchField(clean, {
      allowCamelSplit: true,
      includeCompact: true,
    });
    if (!normCheck.splitPhrase || seenAliasKeys.has(normCheck.splitPhrase)) return;
    seenAliasKeys.add(normCheck.splitPhrase);
    aliasRawCandidates.push(clean);
  };

  if (card.wikiTitle) pushAlias(card.wikiTitle);
  if (Array.isArray(card.aliases)) {
    for (const a of card.aliases) pushAlias(a);
  }
  if (Array.isArray(card.altNames)) {
    for (const a of card.altNames) pushAlias(a);
  }

  const aliases = aliasRawCandidates.map((a) =>
    buildNormalizedSearchField(a, { allowCamelSplit: true, includeCompact: true })
  );

  // Traits: families, types, subtypeLabel, keywords, braveCondition, summonCondition, token/revival
  const traitStrings = [
    ...famList,
    ...typeList,
    card.subtypeLabel || '',
    ...(Array.isArray(card.keywords) ? card.keywords : []),
    card.braveCondition || '',
    card.summonCondition || '',
    card.isToken ? 'Token' : '',
    card.isRevival ? 'Revival' : '',
  ]
    .map((s) => (s || '').trim())
    .filter(Boolean);

  const traits = buildNormalizedSearchField(traitStrings.join(' '), {
    allowCamelSplit: true,
    includeCompact: false,
  });

  // English effect blocks kept isolated per effect entry (never glued across spaces)
  const effectBlocks: NormalizedEffectBlock[] = [];
  const allEffectTokens = new Set<string>();
  const effectPhrases: string[] = [];
  for (const eff of Array.isArray(card.effects) ? card.effects : []) {
    const combined = `${eff.timing || ''} ${eff.text || ''}`.trim();
    if (!combined) continue;
    const field = buildNormalizedSearchField(combined, {
      allowCamelSplit: false,
      includeCompact: false,
    });
    if (!field.phrase) continue;
    effectBlocks.push({
      phrase: field.phrase,
      tokens: field.tokens,
      tokenSet: field.tokenSet,
    });
    effectPhrases.push(field.phrase);
    for (const tok of field.tokens) {
      allEffectTokens.add(tok);
    }
  }

  const jpNameNorm = normalizeUnicodePunctuation(card.jpName || '').toLowerCase();
  const jpEffectParts: string[] = [];
  if (card.jpEffect) jpEffectParts.push(card.jpEffect);
  if (Array.isArray(card.jpEffects)) {
    for (const je of card.jpEffects) {
      jpEffectParts.push(`${je.timing || ''} ${je.text || ''}`.trim());
    }
  }
  const jpEffectNorm = normalizeUnicodePunctuation(jpEffectParts.join(' ')).toLowerCase();

  const cardNumberNorm = normalizeCardNumber(card.cardNumber || '');
  const cardNumberCompact = compactCardNumber(card.cardNumber || '');
  const cardNumberNoDash = cardNumberNorm.replace(/[^A-Z0-9]/g, '');
  const setCodeNorm = normalizeSetIdentifier(card.setCode || '');

  const setNameCombined = [
    card.setName || '',
    setMeta?.name || '',
    setMeta?.jpName || '',
  ]
    .filter(Boolean)
    .join(' ');
  const setNameField = buildNormalizedSearchField(setNameCombined, {
    allowCamelSplit: true,
    includeCompact: false,
  });

  const metadataCombined = [
    card.illustrator || '',
    card.blockIcon || '',
  ]
    .filter(Boolean)
    .join(' ');
  const metadataField = buildNormalizedSearchField(metadataCombined, {
    allowCamelSplit: true,
    includeCompact: false,
  });

  const entry: CardSearchIndexEntry = {
    primaryName,
    baseName,
    aliases,
    traits,
    effectBlocks,
    allEffectTokens,
    allEffectPhrase: effectPhrases.join(' '),
    jpNameNorm,
    jpEffectNorm,
    cardNumberNorm,
    cardNumberCompact,
    cardNumberNoDash,
    setCodeNorm,
    setNameField,
    metadataField,
  };

  cardIndexCache.set(card, { key: cacheKey, entry });
  return entry;
}

const parsedQueryCache = new Map<string, ParsedSearchQuery>();

export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const cacheKey = rawQuery || '';
  const cached = parsedQueryCache.get(cacheKey);
  if (cached) return cached;

  const normalized = normalizeUnicodePunctuation(cacheKey);
  const rawLower = normalized.toLowerCase();
  const { phrase } = extractWordTokensWithPossessiveVariants(normalized);
  const camelSplit = splitCamelCasePreserveWords(normalized);
  const splitRes = extractWordTokensWithPossessiveVariants(camelSplit);
  const splitPhrase = splitRes.phrase || phrase;

  // Query tokens stay clean user-intended words (avoiding duplicating possessive variants as required AND tokens)
  const cleanTokens = tokenizeNormalizedWords(splitPhrase);
  const compact = splitPhrase.replace(/[^a-z0-9]/g, '');

  const cardNumberQueryNorm = normalizeCardNumber(cacheKey);
  const cardNumberQueryCompact = compactCardNumber(cacheKey);
  const cardNumberQueryNoDash = cardNumberQueryNorm.replace(/[^A-Z0-9]/g, '');
  const looksLikeCardNumberQuery =
    /^[A-Z0-9]{1,8}-[A-Z0-9()]+$/i.test(cardNumberQueryNorm) ||
    /^(?:PX|EX|TK|BS|SD|CB|BSC|PB|PC)\d{2,4}[A-Z0-9]*$/i.test(cardNumberQueryNorm);

  const parsed: ParsedSearchQuery = {
    raw: cacheKey,
    rawLower,
    phrase,
    splitPhrase,
    compact,
    tokens: cleanTokens,
    hasJapanese: JAPANESE_CHAR_RE.test(cacheKey),
    cardNumberQueryNorm,
    cardNumberQueryCompact,
    cardNumberQueryNoDash,
    looksLikeCardNumberQuery,
  };

  if (parsedQueryCache.size >= 64) {
    const firstKey = parsedQueryCache.keys().next().value;
    if (firstKey !== undefined) parsedQueryCache.delete(firstKey);
  }
  parsedQueryCache.set(cacheKey, parsed);
  return parsed;
}

type TokenMatchStrength = 'exact' | 'prefix' | 'variant' | 'compound' | 'none';

function matchTokenInNameField(
  field: NormalizedSearchField,
  tok: string,
  isSingleTokenQuery: boolean
): TokenMatchStrength {
  if (field.tokenSet.has(tok)) return 'exact';

  // Safe spelling/Romanization variants (e.g. seigwurm <-> siegwurm, beelzebub <-> belzeebub)
  const equivalents = NAME_TOKEN_EQUIVALENTS[tok];
  if (equivalents) {
    for (const eq of equivalents) {
      if (field.tokenSet.has(eq)) return 'variant';
      if (eq.length >= 4 && field.tokens.some((wt) => wt.startsWith(eq))) return 'variant';
    }
  }

  // Word-prefix match in Name/Alias:
  // - len >= 3 can match the start of any word token (e.g., "leo" -> "leopard", "leoville", "leozard")
  // - len === 2 only matches if it is a prefix at the start of the whole name (e.g., "si" -> "siegwurm")
  if (tok.length >= 3) {
    if (field.tokens.some((wt) => wt.startsWith(tok))) return 'prefix';
  } else if (tok.length === 2 && isSingleTokenQuery) {
    if (
      field.splitPhrase.startsWith(tok) ||
      field.splitPhraseNoArticle.startsWith(tok)
    ) {
      return 'prefix';
    }
  }

  // Compound/mid-word substring match in Name/Alias ONLY for tok.length >= 5
  // Prevents short terms (like "leo", "ace", "art", "red", "over") from falsely matching
  // unrelated words such as "Cleomenes", "Chuleon", "Recovery", or "Sovereign".
  if (tok.length >= 5) {
    if (field.tokens.some((wt) => wt.includes(tok))) return 'compound';
    if (field.compact && field.compact.includes(tok)) return 'compound';
  }

  return 'none';
}

function matchTokenInTraitField(field: NormalizedSearchField, tok: string): TokenMatchStrength {
  if (field.tokenSet.has(tok)) return 'exact';
  if (tok.length >= 3 && field.tokens.some((wt) => wt.startsWith(tok))) {
    return 'prefix';
  }
  if (tok.length >= 5 && field.tokens.some((wt) => wt.includes(tok))) {
    return 'compound';
  }
  return 'none';
}

function matchTokenInEffectTokens(
  effectTokens: Set<string>,
  tok: string
): 'exact' | 'prefix' | 'none' {
  if (effectTokens.has(tok)) return 'exact';
  // For 3-letter words in English effect text, allow exact plural '-s' (e.g. "orb" -> "orbs")
  // without allowing unrelated startsWith ("red" -> "reduce"/"reduction") or mid-word substrings.
  if (tok.length === 3 && !tok.endsWith('s') && effectTokens.has(`${tok}s`)) {
    return 'exact';
  }
  // For 4+ char words in effect text, allow word-prefix ("destroy" -> "destroyed"/"destroys",
  // "exhaust" -> "exhausted"), NEVER mid-word substring ("nova" -> "supernova", "over" -> "recover").
  if (tok.length >= 4) {
    for (const et of effectTokens) {
      if (et.startsWith(tok)) return 'prefix';
    }
  }
  return 'none';
}

function matchTokenInMetadataWords(field: NormalizedSearchField, tok: string): 'exact' | 'prefix' | 'none' {
  if (field.tokenSet.has(tok)) return 'exact';
  if (tok.length >= 4 && field.tokens.some((wt) => wt.startsWith(tok))) {
    return 'prefix';
  }
  return 'none';
}

function hasWholePhraseBoundaryMatch(hayPhrase: string, queryPhrase: string): boolean {
  if (!hayPhrase || !queryPhrase) return false;
  if (hayPhrase === queryPhrase) return true;
  const paddedHay = ` ${hayPhrase} `;
  return paddedHay.includes(` ${queryPhrase} `);
}

function scoreFieldMatch(
  field: NormalizedSearchField,
  pq: ParsedSearchQuery,
  isPrimaryName: boolean
): number {
  const exactTierBase = isPrimaryName ? 990_000 : 890_000;
  const beginsTierBase = isPrimaryName ? 790_000 : 590_000;
  const containsTierBase = isPrimaryName ? 690_000 : 570_000;

  // 1. Exact full match
  if (
    field.rawLower === pq.rawLower ||
    field.phrase === pq.phrase ||
    field.splitPhrase === pq.splitPhrase ||
    (pq.compact.length >= 2 && field.compact === pq.compact)
  ) {
    return exactTierBase;
  }

  // Exact spelling-variant single-word/multi-word match on name/alias
  if (pq.tokens.length > 0 && pq.tokens.length === field.tokens.length) {
    const allVariantOrExact = pq.tokens.every((t, idx) => {
      const fTok = field.tokens[idx];
      if (fTok === t) return true;
      return Boolean(NAME_TOKEN_EQUIVALENTS[t]?.includes(fTok));
    });
    if (allVariantOrExact) {
      return isPrimaryName ? 880_000 : 875_000;
    }
  }

  // 2. Begins-with match (strict start or after leading "The ")
  if (
    pq.splitPhrase &&
    (field.splitPhrase.startsWith(pq.splitPhrase) ||
      field.phrase.startsWith(pq.phrase) ||
      (pq.compact.length >= 3 && field.compact.startsWith(pq.compact)))
  ) {
    const lenRatio = Math.min(500, Math.round((pq.splitPhrase.length / Math.max(1, field.splitPhrase.length)) * 500));
    return beginsTierBase + lenRatio;
  }

  if (
    pq.splitPhrase &&
    field.splitPhraseNoArticle &&
    field.splitPhraseNoArticle !== field.splitPhrase &&
    field.splitPhraseNoArticle.startsWith(pq.splitPhrase)
  ) {
    const lenRatio = Math.min(
      500,
      Math.round((pq.splitPhrase.length / Math.max(1, field.splitPhraseNoArticle.length)) * 500)
    );
    return (isPrimaryName ? 780_000 : 585_000) + lenRatio;
  }

  // 3. Contains query in Name or Alias
  if (pq.tokens.length === 0) return 0;

  const isSingle = pq.tokens.length === 1;
  const strengths = pq.tokens.map((tok) => matchTokenInNameField(field, tok, isSingle));
  if (strengths.some((s) => s === 'none')) {
    return 0;
  }

  const lenBonus = Math.min(
    450,
    Math.round((pq.splitPhrase.length / Math.max(1, field.splitPhrase.length)) * 450)
  );

  // Contiguous phrase match inside name (whole-word boundaries or compact multi-word compound)
  if (
    hasWholePhraseBoundaryMatch(field.splitPhrase, pq.splitPhrase) ||
    hasWholePhraseBoundaryMatch(field.phrase, pq.phrase) ||
    (pq.tokens.length >= 2 && pq.compact.length >= 4 && field.compact.includes(pq.compact))
  ) {
    return containsTierBase + lenBonus;
  }

  const hasCompound = strengths.includes('compound');
  const hasVariant = strengths.includes('variant');
  const hasPrefix = strengths.includes('prefix');

  if (!hasCompound && !hasVariant && !hasPrefix) {
    // All tokens exact words inside name (e.g. non-contiguous multi-word)
    return (isPrimaryName ? 680_000 : 560_000) + lenBonus;
  }
  if (!hasCompound && !hasVariant && hasPrefix) {
    return (isPrimaryName ? 665_000 : 550_000) + lenBonus;
  }
  if (hasVariant && !hasCompound) {
    return (isPrimaryName ? 540_000 : 535_000) + lenBonus;
  }
  // Compound substring (only reached when tok.length >= 4)
  return (isPrimaryName ? 625_000 : 520_000) + lenBonus;
}

export function evaluateCardSearchMatch(
  card: BattleSpiritsCard,
  rawQuery: string,
  context?: CardSearchInputContext
): CardSearchEvaluation {
  const pq = parseSearchQuery(rawQuery);
  if (!pq.rawLower) {
    return { matched: true, score: 0 };
  }

  const idx = buildCardSearchIndexEntry(card, context);

  // Exact card number match (Tier 1 priority for explicit card number queries like "BS01-001" or "26RCB02-057")
  const exactCardNumMatch =
    Boolean(idx.cardNumberNorm) &&
    (idx.cardNumberNorm === pq.cardNumberQueryNorm ||
      idx.cardNumberCompact === pq.cardNumberQueryCompact ||
      (pq.looksLikeCardNumberQuery &&
        pq.cardNumberQueryNoDash.length >= 4 &&
        idx.cardNumberNoDash === pq.cardNumberQueryNoDash));

  if (exactCardNumMatch) {
    return {
      matched: true,
      score: 975_000 + (card.isRevival ? 0 : 100),
      tier: 'exact_card_number',
    };
  }

  // 1. Primary card name (Tier 1: Exact, Tier 3: Begins With, Tier 4: Contains)
  const primaryScore = scoreFieldMatch(idx.primaryName, pq, true);
  if (primaryScore > 0) {
    const revBonus = card.isRevival ? 0 : 25;
    const tier: CardSearchMatchTier =
      primaryScore >= 900_000
        ? 'exact_name'
        : primaryScore >= 800_000
        ? 'exact_alias'
        : primaryScore >= 700_000
        ? 'name_prefix'
        : primaryScore >= 600_000
        ? 'name_contains'
        : 'alias_contains';
    return { matched: true, score: primaryScore + revBonus, tier };
  }

  // Check base name (e.g. "Ankillersaurus" matching "Ankillersaurus (Revival)")
  if (idx.baseName !== idx.primaryName) {
    const baseScore = scoreFieldMatch(idx.baseName, pq, true);
    if (baseScore > 0) {
      const adjusted = baseScore >= 990_000 ? 980_000 : baseScore - 10;
      const tier: CardSearchMatchTier =
        adjusted >= 900_000
          ? 'exact_name'
          : adjusted >= 800_000
          ? 'exact_alias'
          : adjusted >= 700_000
          ? 'name_prefix'
          : adjusted >= 600_000
          ? 'name_contains'
          : 'alias_contains';
      return { matched: true, score: adjusted, tier };
    }
  }

  // 2 & 5. Alternative names / wikiTitle / aliases
  let bestAliasScore = 0;
  for (const aliasField of idx.aliases) {
    const s = scoreFieldMatch(aliasField, pq, false);
    if (s > bestAliasScore) bestAliasScore = s;
  }
  if (bestAliasScore > 0) {
    const tier: CardSearchMatchTier =
      bestAliasScore >= 800_000 ? 'exact_alias' : 'alias_contains';
    return { matched: true, score: bestAliasScore, tier };
  }

  // Japanese query handling (when query includes Japanese characters)
  if (pq.hasJapanese) {
    if (idx.jpNameNorm && idx.jpNameNorm === pq.rawLower) {
      return { matched: true, score: 295_000, tier: 'japanese_match' };
    }
    if (idx.jpNameNorm && idx.jpNameNorm.startsWith(pq.rawLower)) {
      return { matched: true, score: 285_000, tier: 'japanese_match' };
    }
    if (idx.jpNameNorm && idx.jpNameNorm.includes(pq.rawLower)) {
      return { matched: true, score: 270_000, tier: 'japanese_match' };
    }
    if (idx.jpEffectNorm && idx.jpEffectNorm.includes(pq.rawLower)) {
      return { matched: true, score: 240_000, tier: 'japanese_match' };
    }
    if (idx.setNameField.rawLower.includes(pq.rawLower)) {
      return { matched: true, score: 150_000, tier: 'metadata_match' };
    }
    return { matched: false, score: 0 };
  }

  // Card number prefix match (e.g., "BS01-00" or "BS45-RV", NEVER zero-stripped compact startsWith
  // which would turn "BS01-001" -> "BS01-1" and falsely match "BS01-010").
  if (pq.looksLikeCardNumberQuery) {
    if (
      idx.cardNumberNorm &&
      (idx.cardNumberNorm.startsWith(pq.cardNumberQueryNorm) ||
        (pq.cardNumberQueryNoDash.length >= 4 &&
          idx.cardNumberNoDash.startsWith(pq.cardNumberQueryNoDash)))
    ) {
      return { matched: true, score: 190_000, tier: 'metadata_match' };
    }
    // Check if card's English effect explicitly mentions this exact card number
    if (
      pq.cardNumberQueryNorm &&
      idx.allEffectPhrase.includes(pq.cardNumberQueryNorm.toLowerCase())
    ) {
      return { matched: true, score: 340_000, tier: 'effect_match' };
    }
    return { matched: false, score: 0 };
  }

  if (pq.tokens.length === 0) {
    return { matched: false, score: 0 };
  }

  // 6. Card family, traits, species, type, or keywords
  const traitTokenMatches = pq.tokens.map((tok) => matchTokenInTraitField(idx.traits, tok));
  if (traitTokenMatches.every((m) => m !== 'none')) {
    let traitScore = 450_000;
    if (idx.traits.splitPhrase === pq.splitPhrase || hasWholePhraseBoundaryMatch(idx.traits.splitPhrase, pq.splitPhrase)) {
      const exactFamilyOrType = [
        ...(context?.families || card.families || []),
        ...(context?.types || [card.type]),
        card.subtypeLabel || '',
        ...(card.keywords || []),
      ].some((item) => {
        const nf = buildNormalizedSearchField(item, { allowCamelSplit: true });
        return nf.splitPhrase === pq.splitPhrase || nf.phrase === pq.phrase;
      });
      traitScore = exactFamilyOrType ? 490_000 : 475_000;
    } else if (traitTokenMatches.every((m) => m === 'exact')) {
      traitScore = 465_000;
    }
    return { matched: true, score: traitScore, tier: 'trait_match' };
  }

  // 7. English card effect text match (strict word / word-prefix boundary matching)
  const effectTokenMatches = pq.tokens.map((tok) =>
    matchTokenInEffectTokens(idx.allEffectTokens, tok)
  );
  if (effectTokenMatches.every((m) => m !== 'none')) {
    if (
      pq.phrase &&
      hasWholePhraseBoundaryMatch(idx.allEffectPhrase, pq.phrase)
    ) {
      return { matched: true, score: 390_000, tier: 'effect_match' };
    }
    const sameBlock = idx.effectBlocks.some((blk) =>
      pq.tokens.every((tok) => matchTokenInEffectTokens(blk.tokenSet, tok) !== 'none')
    );
    const allExactTokens = effectTokenMatches.every((m) => m === 'exact');
    const score = sameBlock
      ? allExactTokens
        ? 375_000
        : 365_000
      : allExactTokens
      ? 355_000
      : 345_000;
    return { matched: true, score, tier: 'effect_match' };
  }

  // Multi-word combined cross-field matches (e.g. Name + Trait, Name + Effect, Trait + Effect)
  // Requires every token to match strictly in at least one valid card field.
  if (pq.tokens.length >= 2) {
    let hitNameOrAlias = false;
    let hitTrait = false;
    let hitEffect = false;
    let hitMetadata = false;

    const allTokensCovered = pq.tokens.every((tok) => {
      if (
        matchTokenInNameField(idx.primaryName, tok, false) !== 'none' ||
        idx.aliases.some((af) => matchTokenInNameField(af, tok, false) !== 'none')
      ) {
        hitNameOrAlias = true;
        return true;
      }
      if (matchTokenInTraitField(idx.traits, tok) !== 'none') {
        hitTrait = true;
        return true;
      }
      if (matchTokenInEffectTokens(idx.allEffectTokens, tok) !== 'none') {
        hitEffect = true;
        return true;
      }
      if (
        matchTokenInMetadataWords(idx.setNameField, tok) !== 'none' ||
        matchTokenInMetadataWords(idx.metadataField, tok) !== 'none' ||
        (tok.length >= 3 && idx.setCodeNorm.toLowerCase() === tok)
      ) {
        hitMetadata = true;
        return true;
      }
      return false;
    });

    if (allTokensCovered) {
      if (hitNameOrAlias && hitTrait && !hitEffect && !hitMetadata) {
        return { matched: true, score: 420_000, tier: 'trait_match' };
      }
      if (hitNameOrAlias && !hitMetadata) {
        return { matched: true, score: 395_000, tier: 'effect_match' };
      }
      if (hitTrait && hitEffect && !hitMetadata) {
        return { matched: true, score: 340_000, tier: 'effect_match' };
      }
      if (!hitMetadata) {
        return { matched: true, score: 330_000, tier: 'effect_match' };
      }
      return { matched: true, score: 135_000, tier: 'metadata_match' };
    }
  }

  // 9. Set name, set identifier, card number, and metadata match
  if (context?.matchedSetIntent) {
    return { matched: true, score: 180_000, tier: 'metadata_match' };
  }

  if (
    pq.tokens.length === 1 &&
    idx.setCodeNorm &&
    normalizeSetIdentifier(pq.raw) === idx.setCodeNorm
  ) {
    return { matched: true, score: 180_000, tier: 'metadata_match' };
  }

  const setNameMatches = pq.tokens.every(
    (tok) => matchTokenInMetadataWords(idx.setNameField, tok) !== 'none'
  );
  if (setNameMatches) {
    const exactOrPhrase =
      idx.setNameField.splitPhrase === pq.splitPhrase ||
      hasWholePhraseBoundaryMatch(idx.setNameField.splitPhrase, pq.splitPhrase);
    return {
      matched: true,
      score: exactOrPhrase ? 160_000 : 150_000,
      tier: 'metadata_match',
    };
  }

  const metaMatches = pq.tokens.every(
    (tok) => matchTokenInMetadataWords(idx.metadataField, tok) !== 'none'
  );
  if (metaMatches) {
    return { matched: true, score: 120_000, tier: 'metadata_match' };
  }

  return { matched: false, score: 0 };
}

export function scoreCardSearchMatch(
  card: BattleSpiritsCard,
  rawQuery: string,
  context?: CardSearchInputContext
): number {
  return evaluateCardSearchMatch(card, rawQuery, context).score;
}
