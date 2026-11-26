import type { BattleSpiritsCard, CardRarity, GameFormat, ProductSet } from '../types/card';
import {
  buildCompositeCardIdentityKey,
  getCardVersionVariantKey,
  isSyntheticCardNumber,
  resolveCanonicalIdentitySetCode,
} from './cardIdentity';
import { normalizeCardColors, normalizeCardFamilies } from './cardFilterNormalization';
import { isTokenCard } from './cardRules';
import { normalizeCardNumber } from './decklistImport';
import {
  compareCardPrintingChronology,
  resolveSetReleaseInfo,
} from './setChronology';
import { normalizeSetIdentifier } from './setMetadataSync';

export interface CardPrintingOption {
  card: BattleSpiritsCard;
  cardId: string;
  setCode: string;
  setName: string;
  cardNumber: string;
  rarity: CardRarity;
  formats: GameFormat[];
  isRevival: boolean;
  releaseDateLabel: string;
  releaseSortKey: number;
  isCanonicalOriginal: boolean;
}

export interface ConsolidatedCardGroup {
  canonicalId: string;
  canonicalCard: BattleSpiritsCard;
  printings: CardPrintingOption[];
  printingIds: string[];
  setCodes: string[];
  cardNumbers: string[];
}

export type UncertainReprintReason =
  | 'missing_or_unverified_effects'
  | 'incomplete_record_needs_review'
  | 'effect_wording_differs'
  | 'jp_name_mismatch'
  | 'stats_or_levels_differ'
  | 'families_differ'
  | 'same_set_different_card_number';

export interface UncertainReprintGroup {
  groupKey: string;
  name: string;
  reasons: UncertainReprintReason[];
  cards: BattleSpiritsCard[];
}

export interface ConsolidatedCatalogResult {
  consolidatedCards: BattleSpiritsCard[];
  groups: ConsolidatedCardGroup[];
  groupByCanonicalId: Record<string, ConsolidatedCardGroup>;
  groupByMemberId: Record<string, ConsolidatedCardGroup>;
  canonicalIdByMemberId: Record<string, string>;
  uncertainGroups: UncertainReprintGroup[];
  stats: {
    totalInputCards: number;
    consolidatedResultCount: number;
    confirmedGroupCount: number;
    consolidatedReprintMembersCount: number;
    uncertainGroupCount: number;
  };
}

export function normalizeReprintBaseName(rawName: string): string {
  return (rawName || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019`´＇]/g, "'")
    .replace(/[\u201C\u201D＂]/g, '"')
    .replace(/\s*\(Revival\)\s*/gi, ' ')
    .replace(/\s*\((?:A|B)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeJpNameForComparison(rawJp: string): string {
  return (rawJp || '')
    .normalize('NFKC')
    .replace(/\s*[（(]?(?:リバイバル|revival)[)）]?\s*/gi, '')
    .replace(/[\s・･\-ー]+/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeEffectTextForComparison(rawText: string): string {
  return (rawText || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019`´＇]/g, "'")
    .replace(/[\u201C\u201D＂]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\[(Soul Core)\]\(\1\)/gi, '(Soul Core)')
    .replace(/\[LV\s*(\d+)\s*\]\s*\[LV\s*(\d+)\s*\](?:\s*\[LV\s*(\d+)\s*\])?/gi, (_, a, b, c) =>
      c ? `[lv${a}][lv${b}][lv${c}]` : `[lv${a}][lv${b}]`
    )
    .replace(/\(Lv\.?\s*(\d+)\s*[-~–]\s*(\d+)\)/gi, '[lv$1-lv$2]')
    .replace(/\[([a-z0-9\s/+-]+)\]/gi, '[$1]')
    .replace(/[.:;]+(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getNormalizedEffectsList(card: BattleSpiritsCard): Array<{ timing: string; text: string }> {
  return (Array.isArray(card.effects) ? card.effects : [])
    .map((eff) => ({
      timing: normalizeEffectTextForComparison(eff.timing || ''),
      text: normalizeEffectTextForComparison(eff.text || ''),
    }))
    .filter((eff) => Boolean(eff.timing || eff.text));
}

function haveEquivalentEffects(a: BattleSpiritsCard, b: BattleSpiritsCard): {
  equivalent: boolean;
  reason?: UncertainReprintReason;
} {
  const aNeedsReview = Boolean(
    a.needsManualReview || a.completionStatus === 'needs_review' || a.completionStatus === 'incomplete'
  );
  const bNeedsReview = Boolean(
    b.needsManualReview || b.completionStatus === 'needs_review' || b.completionStatus === 'incomplete'
  );
  if (aNeedsReview || bNeedsReview) {
    return { equivalent: false, reason: 'incomplete_record_needs_review' };
  }

  const effA = getNormalizedEffectsList(a);
  const effB = getNormalizedEffectsList(b);
  const aVanilla = effA.length === 0 && a.effectStatus === 'no_printed_effect';
  const bVanilla = effB.length === 0 && b.effectStatus === 'no_printed_effect';

  if (aVanilla && bVanilla) {
    return { equivalent: true };
  }

  if (effA.length === 0 || effB.length === 0) {
    return { equivalent: false, reason: 'missing_or_unverified_effects' };
  }

  if (effA.length === effB.length) {
    const exactBlockMatch = effA.every(
      (ea, idx) => ea.timing === effB[idx].timing && ea.text === effB[idx].text
    );
    if (exactBlockMatch) {
      return { equivalent: true };
    }
  }

  // Fallback: compare concatenated normalized timing+text when a single effect split differently across parser revisions
  const joinedA = effA.map((e) => `${e.timing} ${e.text}`.trim()).join(' | ');
  const joinedB = effB.map((e) => `${e.timing} ${e.text}`.trim()).join(' | ');
  if (joinedA === joinedB) {
    return { equivalent: true };
  }

  // Compare pure effect body texts if timing header wording varies only trivially (e.g. "[When Summoned]" vs "When Summoned")
  const textOnlyA = effA.map((e) => `${e.timing} ${e.text}`.replace(/[\[\]()]/g, '').replace(/\s+/g, ' ').trim()).join(' ');
  const textOnlyB = effB.map((e) => `${e.timing} ${e.text}`.replace(/[\[\]()]/g, '').replace(/\s+/g, ' ').trim()).join(' ');
  if (textOnlyA === textOnlyB && textOnlyA.length > 0) {
    return { equivalent: true };
  }

  return { equivalent: false, reason: 'effect_wording_differs' };
}

function serializeSymbolRecord(rec?: Partial<Record<string, number>>): string {
  if (!rec) return '';
  return Object.entries(rec)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort(([kA], [kB]) => kA.localeCompare(kB))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

function serializeLevels(levels?: BattleSpiritsCard['levels']): string {
  if (!Array.isArray(levels) || levels.length === 0) return '';
  return levels
    .map((l) => `${l.level}:${l.cores}:${l.bp}`)
    .sort()
    .join('|');
}

export interface GameplayEquivalenceResult {
  classification: 'confirmed_reprint' | 'uncertain_review' | 'distinct_card';
  reasons: UncertainReprintReason[];
}

/**
 * Evaluates whether two Battle Spirits card records are genuinely identical gameplay reprints.
 * Strictly separates distinct versions (Revival/Original, Token, Side A/B, stat remakes, wording changes)
 * and flags uncertain or incomplete pairs instead of blindly merging.
 */
function getCardStrictVariantSignature(card: BattleSpiritsCard): string {
  let ver = getCardVersionVariantKey(card);
  const numUpper = (card.cardNumber || '').trim().toUpperCase();
  if (/\(A\)$/.test(numUpper) && !ver.includes('side-a')) {
    ver = `${ver}:side-a`;
  } else if (/\(B\)$/.test(numUpper) && !ver.includes('side-b')) {
    ver = `${ver}:side-b`;
  }
  return ver;
}

export function compareGameplayEquivalence(
  a: BattleSpiritsCard,
  b: BattleSpiritsCard
): GameplayEquivalenceResult {
  // Never consolidate distinct versions or distinct card variants
  if (Boolean(a.isRevival) !== Boolean(b.isRevival)) {
    return { classification: 'distinct_card', reasons: [] };
  }
  if (isTokenCard(a) !== isTokenCard(b)) {
    return { classification: 'distinct_card', reasons: [] };
  }
  if (getCardStrictVariantSignature(a) !== getCardStrictVariantSignature(b)) {
    return { classification: 'distinct_card', reasons: [] };
  }

  // Must share normalized base name
  if (normalizeReprintBaseName(a.name) !== normalizeReprintBaseName(b.name)) {
    return { classification: 'distinct_card', reasons: [] };
  }

  // Fundamental card identity mismatch (different cost / type / colors) = distinct cards
  if (a.type !== b.type || a.cost !== b.cost) {
    return { classification: 'distinct_card', reasons: [] };
  }
  const colorsA = normalizeCardColors(a).join('/');
  const colorsB = normalizeCardColors(b).join('/');
  if (colorsA !== colorsB) {
    return { classification: 'distinct_card', reasons: [] };
  }

  const reasons: UncertainReprintReason[] = [];

  // Same canonical set + distinct card numbers (e.g. bundled Wiki vs set table mismatch) -> keep separate & flag
  const setA = resolveCanonicalIdentitySetCode(a);
  const setB = resolveCanonicalIdentitySetCode(b);
  const numA = normalizeCardNumber(a.cardNumber || '');
  const numB = normalizeCardNumber(b.cardNumber || '');
  if (setA && setB && setA === setB && numA !== numB) {
    reasons.push('same_set_different_card_number');
  }

  // Check Japanese name if both populated (prevents false merges like Burst Wall vs Zekkou Hyojun)
  const jpA = normalizeJpNameForComparison(a.jpName || '');
  const jpB = normalizeJpNameForComparison(b.jpName || '');
  if (jpA && jpB && jpA !== jpB) {
    reasons.push('jp_name_mismatch');
  }

  // Check levels, reductions, symbols, brave stats, summon condition
  const statsMatch =
    serializeSymbolRecord(a.reduction) === serializeSymbolRecord(b.reduction) &&
    serializeSymbolRecord(a.symbols) === serializeSymbolRecord(b.symbols) &&
    serializeLevels(a.levels) === serializeLevels(b.levels) &&
    (a.braveBonusBp ?? null) === (b.braveBonusBp ?? null) &&
    normalizeEffectTextForComparison(a.braveCondition || '') ===
      normalizeEffectTextForComparison(b.braveCondition || '') &&
    normalizeEffectTextForComparison(a.summonCondition || '') ===
      normalizeEffectTextForComparison(b.summonCondition || '');

  const famsA = normalizeCardFamilies(a.families).sort().join('|').toLowerCase();
  const famsB = normalizeCardFamilies(b.families).sort().join('|').toLowerCase();
  const familiesMatch = famsA === famsB;

  const effectCheck = haveEquivalentEffects(a, b);

  // Remade card with different levels AND different families AND different effects -> distinctly different gameplay card (e.g. Siegwurm SD01 vs RP26-STD)
  if (!statsMatch && !familiesMatch && !effectCheck.equivalent && effectCheck.reason === 'effect_wording_differs') {
    return { classification: 'distinct_card', reasons: [] };
  }

  if (!statsMatch) {
    reasons.push('stats_or_levels_differ');
  }
  if (!familiesMatch) {
    reasons.push('families_differ');
  }
  if (!effectCheck.equivalent && effectCheck.reason) {
    reasons.push(effectCheck.reason);
  }

  if (reasons.length > 0) {
    return { classification: 'uncertain_review', reasons };
  }

  // Require both records to represent real distinct printings (synthetic numbers without distinct sets aren't reliable reprints)
  const samePrintingIdentity = buildCompositeCardIdentityKey(a) === buildCompositeCardIdentityKey(b);
  if (samePrintingIdentity) {
    return { classification: 'confirmed_reprint', reasons: [] };
  }

  if (
    isSyntheticCardNumber(a.cardNumber) &&
    isSyntheticCardNumber(b.cardNumber) &&
    setA === setB
  ) {
    return { classification: 'uncertain_review', reasons: ['incomplete_record_needs_review'] };
  }

  return { classification: 'confirmed_reprint', reasons: [] };
}

function buildPrintingOption(
  card: BattleSpiritsCard,
  isCanonicalOriginal: boolean,
  setLookupByCode: Map<string, ProductSet>
): CardPrintingOption {
  const normSet =
    normalizeSetIdentifier(card.setCode || '') ||
    resolveCanonicalIdentitySetCode(card) ||
    (card.setCode || '').trim().toUpperCase() ||
    'WIKI';
  const matchedSet = setLookupByCode.get(normSet);
  const rel = resolveSetReleaseInfo(normSet, matchedSet);

  return {
    card,
    cardId: card.id,
    setCode: card.setCode?.trim() || normSet,
    setName: card.setName?.trim() || matchedSet?.name || normSet,
    cardNumber: card.cardNumber?.trim() || 'WIKI',
    rarity: card.rarity || 'C',
    formats: Array.isArray(card.formats) && card.formats.length > 0 ? card.formats : ['Eternal'],
    isRevival: Boolean(card.isRevival),
    releaseDateLabel: rel.releaseDate,
    releaseSortKey: rel.sortKey,
    isCanonicalOriginal,
  };
}

/**
 * Consolidates identical gameplay reprints across sets into a single canonical group
 * sorted chronologically so the oldest official release is ALWAYS the canonical entry.
 * Uncertain, incomplete, Revival/Original, Token, Side-A/B, and mechanically altered cards
 * are never merged and uncertain clusters are surfaced in `uncertainGroups`.
 */
export function consolidateCatalogCards(
  cards: BattleSpiritsCard[],
  productSets: ProductSet[] = []
): ConsolidatedCatalogResult {
  const setLookupByCode = new Map<string, ProductSet>();
  for (const s of productSets) {
    const norm = normalizeSetIdentifier(s.setCode || '') || s.setCode.trim().toUpperCase();
    if (norm) setLookupByCode.set(norm, s);
  }

  // Step 1: Remove only genuine same-card duplicate records (preferring more complete/repaired copy)
  const dedupedByComposite = new Map<string, BattleSpiritsCard>();
  const isMoreComplete = (incoming: BattleSpiritsCard, current: BattleSpiritsCard): boolean => {
    if (!current.isWikiLoaded && incoming.isWikiLoaded) return true;
    if (current.completionStatus !== 'complete' && incoming.completionStatus === 'complete') return true;
    if ((incoming.lastRepairedAt || '') > (current.lastRepairedAt || '')) return true;
    return false;
  };
  for (const card of cards) {
    if (!card || !card.id) continue;
    if (normalizeSetIdentifier(card.setCode || '') === 'BSS01') continue;
    const baseKey = buildCompositeCardIdentityKey(card);
    const existing = dedupedByComposite.get(baseKey);
    if (!existing) {
      dedupedByComposite.set(baseKey, card);
      continue;
    }
    const sameCardConcept =
      normalizeReprintBaseName(existing.name) === normalizeReprintBaseName(card.name) ||
      (existing.type === card.type && existing.cost === card.cost);
    if (sameCardConcept) {
      if (isMoreComplete(card, existing)) {
        dedupedByComposite.set(baseKey, card);
      }
    } else {
      const distinctKey = `${baseKey}|id:${card.id}`;
      const existingDistinct = dedupedByComposite.get(distinctKey);
      if (!existingDistinct || isMoreComplete(card, existingDistinct)) {
        dedupedByComposite.set(distinctKey, card);
      }
    }
  }
  const uniqueRecords = Array.from(dedupedByComposite.values());

  // Step 2: Partition by coarse bucket (normalized base name + version variant + type + cost + colors)
  // Cards in different coarse buckets can never be identical reprints.
  const coarseBuckets = new Map<string, BattleSpiritsCard[]>();
  for (const card of uniqueRecords) {
    const baseName = normalizeReprintBaseName(card.name || card.id);
    const ver = getCardStrictVariantSignature(card);
    const colors = normalizeCardColors(card).join('/');
    const bucketKey = `${baseName}|${ver}|${card.type}|${card.cost}|${colors}`;
    const arr = coarseBuckets.get(bucketKey);
    if (arr) arr.push(card);
    else coarseBuckets.set(bucketKey, [card]);
  }

  const groups: ConsolidatedCardGroup[] = [];
  const uncertainGroups: UncertainReprintGroup[] = [];

  for (const [bucketKey, members] of coarseBuckets.entries()) {
    if (members.length === 1) {
      const only = members[0];
      const printing = buildPrintingOption(only, true, setLookupByCode);
      groups.push({
        canonicalId: only.id,
        canonicalCard: only,
        printings: [printing],
        printingIds: [only.id],
        setCodes: [printing.setCode],
        cardNumbers: [printing.cardNumber],
      });
      continue;
    }

    // Connected-component clustering for strictly confirmed identical reprints inside this bucket
    const visited = new Array<boolean>(members.length).fill(false);
    const confirmedClusters: BattleSpiritsCard[][] = [];
    const uncertainReasonsSet = new Set<UncertainReprintReason>();

    for (let i = 0; i < members.length; i++) {
      if (visited[i]) continue;
      const cluster = [members[i]];
      visited[i] = true;

      for (let j = i + 1; j < members.length; j++) {
        if (visited[j]) continue;
        // Require transitivity with all cluster members so inconsistent pairs can't bridge cleanly
        let allConfirmed = true;
        for (const existingMember of cluster) {
          const eq = compareGameplayEquivalence(existingMember, members[j]);
          if (eq.classification !== 'confirmed_reprint') {
            allConfirmed = false;
            if (eq.classification === 'uncertain_review') {
              for (const r of eq.reasons) uncertainReasonsSet.add(r);
            }
            break;
          }
        }
        if (allConfirmed) {
          cluster.push(members[j]);
          visited[j] = true;
        }
      }

      confirmedClusters.push(cluster);
    }

    if (uncertainReasonsSet.size > 0 && confirmedClusters.length > 1) {
      uncertainGroups.push({
        groupKey: bucketKey,
        name: members[0].name,
        reasons: Array.from(uncertainReasonsSet),
        cards: [...members].sort((a, b) =>
          compareCardPrintingChronology(a, b, setLookupByCode)
        ),
      });
    }

    for (const cluster of confirmedClusters) {
      const sortedMembers = [...cluster].sort((a, b) =>
        compareCardPrintingChronology(a, b, setLookupByCode)
      );
      const canonicalCard = sortedMembers[0];
      const printings = sortedMembers.map((card, idx) =>
        buildPrintingOption(card, idx === 0, setLookupByCode)
      );
      groups.push({
        canonicalId: canonicalCard.id,
        canonicalCard,
        printings,
        printingIds: printings.map((p) => p.cardId),
        setCodes: Array.from(new Set(printings.map((p) => p.setCode))),
        cardNumbers: Array.from(new Set(printings.map((p) => p.cardNumber))),
      });
    }
  }

  const groupByCanonicalId: Record<string, ConsolidatedCardGroup> = {};
  const groupByMemberId: Record<string, ConsolidatedCardGroup> = {};
  const canonicalIdByMemberId: Record<string, string> = {};
  const consolidatedCards: BattleSpiritsCard[] = [];

  let confirmedGroupCount = 0;
  let consolidatedReprintMembersCount = 0;

  for (const group of groups) {
    consolidatedCards.push(group.canonicalCard);
    groupByCanonicalId[group.canonicalId] = group;
    if (group.printings.length > 1) {
      confirmedGroupCount++;
      consolidatedReprintMembersCount += group.printings.length - 1;
    }
    for (const printing of group.printings) {
      groupByMemberId[printing.cardId] = group;
      canonicalIdByMemberId[printing.cardId] = group.canonicalId;
    }
  }

  return {
    consolidatedCards,
    groups,
    groupByCanonicalId,
    groupByMemberId,
    canonicalIdByMemberId,
    uncertainGroups,
    stats: {
      totalInputCards: uniqueRecords.length,
      consolidatedResultCount: consolidatedCards.length,
      confirmedGroupCount,
      consolidatedReprintMembersCount,
      uncertainGroupCount: uncertainGroups.length,
    },
  };
}

/**
 * Consolidates live Wiki preview results (skipping cards already present in the local catalog)
 * so preview results also display clean consolidated entries rather than raw reprint duplicates.
 */
export function consolidateWikiPreviewCards(
  wikiCards: BattleSpiritsCard[],
  localCards: BattleSpiritsCard[],
  productSets: ProductSet[] = []
): ConsolidatedCatalogResult {
  const localIds = new Set(localCards.map((c) => c.id));
  const localCompositeKeys = new Set(
    localCards.map((c) => buildCompositeCardIdentityKey(c))
  );

  const unseen = wikiCards.filter((card) => {
    if (!card || !card.id) return false;
    if (localIds.has(card.id)) return false;
    const compKey = buildCompositeCardIdentityKey(card);
    if (localCompositeKeys.has(compKey)) return false;
    return true;
  });

  return consolidateCatalogCards(unseen, productSets);
}
