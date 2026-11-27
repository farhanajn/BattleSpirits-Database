import type { BattleSpiritsCard, GameFormat } from '../types/card.ts';
import { normalizeSetIdentifier } from './setMetadataSync.ts';

export type CardRestrictionLevel =
  | 'Unlimited'
  | 'Banned'
  | 'Restricted <1>'
  | 'Restricted <2>'
  | 'Restricted <20>';

export type CardLegalityTone = 'legal' | 'warning' | 'restricted' | 'banned' | 'token';

export interface CardLegalityBadgeInfo {
  label: string;
  tone: CardLegalityTone;
  detail: string;
}

/**
 * Returns true if the card is a Battle Spirits Token card
 * (Tokens are placed outside the main deck and cannot be added to a deck).
 */
export function isTokenCard(card?: BattleSpiritsCard | null): boolean {
  if (!card) return false;
  if (card.isToken) return true;
  if (/\btoken\b/i.test(card.subtypeLabel || '')) return true;
  if (/^TK\d+/i.test(card.cardNumber || '')) return true;
  if (card.setCode?.toUpperCase() === 'TOKENS') return true;
  return false;
}

export function getMaxCardCopies(
  cardOrRestriction?: BattleSpiritsCard | CardRestrictionLevel | null
): number {
  if (
    cardOrRestriction &&
    typeof cardOrRestriction !== 'string' &&
    isTokenCard(cardOrRestriction)
  ) {
    return 0;
  }

  const restriction =
    typeof cardOrRestriction === 'string'
      ? cardOrRestriction
      : cardOrRestriction?.restriction;

  switch (restriction) {
    case 'Banned':
      return 0;
    case 'Restricted <1>':
      return 1;
    case 'Restricted <2>':
      return 2;
    case 'Restricted <20>':
      return 20;
    default:
      return 3;
  }
}

export function getRestrictionBadgeLabel(
  restriction?: CardRestrictionLevel
): string | null {
  switch (restriction) {
    case 'Banned':
      return 'BANNED';
    case 'Restricted <1>':
      return '<1>';
    case 'Restricted <2>':
      return '<2>';
    case 'Restricted <20>':
      return '<20>';
    default:
      return null;
  }
}

export function getCardLegalityStatus(
  card: BattleSpiritsCard,
  activeDeckFormat: GameFormat
): CardLegalityBadgeInfo {
  const isToken = isTokenCard(card);
  const maxCopies = getMaxCardCopies(card);
  const isBanned = !isToken && (card.restriction === 'Banned' || maxCopies === 0);

  if (isBanned) {
    return {
      label: 'Banned',
      tone: 'banned',
      detail: 'Banned card — 0 copies allowed in official decks.',
    };
  }

  const cardFormats = Array.isArray(card.formats) ? card.formats : [];
  if (!cardFormats.includes(activeDeckFormat)) {
    return {
      label:
        activeDeckFormat === 'Standard'
          ? 'Not Legal in Standard'
          : `Not Legal in ${activeDeckFormat}`,
      tone: 'warning',
      detail:
        activeDeckFormat === 'Standard'
          ? 'Eternal-only card — not legal in your active Standard deck.'
          : `Not legal in your active ${activeDeckFormat} deck.`,
    };
  }

  if (isToken) {
    return {
      label: 'Token · Outside Deck',
      tone: 'token',
      detail: 'Token card placed outside the main deck.',
    };
  }

  if (maxCopies === 1) {
    return {
      label: 'Limit to 1',
      tone: 'restricted',
      detail: `Restricted <1> in ${activeDeckFormat} (max 1 copy per deck).`,
    };
  }

  if (maxCopies !== 3) {
    return {
      label: `Limit to ${maxCopies} per deck`,
      tone: 'restricted',
      detail: `Restricted to max ${maxCopies} copies per deck in ${activeDeckFormat}.`,
    };
  }

  return {
    label: 'Legal',
    tone: 'legal',
    detail: `Legal in ${activeDeckFormat} (max 3 copies per deck).`,
  };
}

export function formatRestrictionSummary(
  cardOrRestriction?: BattleSpiritsCard | CardRestrictionLevel | null
): string {
  if (
    cardOrRestriction &&
    typeof cardOrRestriction !== 'string' &&
    isTokenCard(cardOrRestriction)
  ) {
    return 'Token (Outside Main Deck · 0 copies)';
  }

  const restriction =
    typeof cardOrRestriction === 'string'
      ? cardOrRestriction
      : cardOrRestriction?.restriction;

  switch (restriction) {
    case 'Banned':
      return 'Banned (0 copies allowed)';
    case 'Restricted <1>':
      return 'Restricted <1> (Max 1)';
    case 'Restricted <2>':
      return 'Restricted <2> (Max 2)';
    case 'Restricted <20>':
      return 'Restricted <20> (Max 20)';
    default:
      return 'Unlimited (Max 3)';
  }
}

export type TenseiSide = 'A' | 'B';

export interface TenseiCardSideInfo {
  side: TenseiSide;
  baseCardNumber: string;
  compactBaseNumber: string;
  setCode: string;
  isRevival: boolean;
  pairKey: string;
  detectionSource: 'card_number' | 'id' | 'subtype';
}

export interface TenseiLinkedPair {
  pairKey: string;
  baseCardNumber: string;
  setCode: string;
  isRevival: boolean;
  sideACard: BattleSpiritsCard;
  sideBCard: BattleSpiritsCard;
  sideACardId: string;
  sideBCardId: string;
}

export type UncertainTenseiReason =
  | 'missing_counterpart'
  | 'ambiguous_side_records'
  | 'incompatible_pair';

export interface UncertainTenseiCandidate {
  pairKey: string;
  baseCardNumber: string;
  setCode: string;
  isRevival: boolean;
  reason: UncertainTenseiReason;
  sideACandidates: BattleSpiritsCard[];
  sideBCandidates: BattleSpiritsCard[];
}

export interface TenseiLinkingResult {
  pairs: TenseiLinkedPair[];
  pairByCardId: Record<string, TenseiLinkedPair>;
  sideByCardId: Record<string, TenseiSide>;
  sideBBySideACardId: Record<string, string>;
  sideABySideBCardId: Record<string, string>;
  uncertainCandidates: UncertainTenseiCandidate[];
  stats: {
    confirmedPairCount: number;
    linkedCardCount: number;
    uncertainCandidateCount: number;
  };
}

function normalizeTenseiCardNumberRaw(raw: string): string {
  return (raw || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '');
}

function isRealBaseCardNumber(baseNum: string): boolean {
  if (!baseNum) return false;
  if (/^(?:WIKI|UNKNOWN|NONE|N\/A)$/i.test(baseNum)) return false;
  if (baseNum.startsWith('SYNTH-')) return false;
  return /^[A-Z0-9]+-[A-Z0-9]+$/.test(baseNum) || /\d/.test(baseNum);
}

/**
 * Extracts official Tensei / Rebirth Side A or Side B designation from a card record
 * using explicit card numbers (e.g. `BS52-007(A)` / `BS52-007(B)`) or explicit side metadata.
 *
 * Strictly ignores cards that merely mention "Rebirth" in keywords/effects (e.g. BS77-052)
 * and never infers pairs from name or artwork similarity.
 */
export function extractTenseiSideInfo(
  card?: BattleSpiritsCard | null
): TenseiCardSideInfo | null {
  if (!card) return null;

  const normNum = normalizeTenseiCardNumberRaw(card.cardNumber || '');
  let side: TenseiSide | null = null;
  let baseCardNumber = normNum;
  let detectionSource: TenseiCardSideInfo['detectionSource'] = 'card_number';

  const explicitNumSide = normNum.match(/^(.*?)(?:\(([AB])\)|\[([AB])\])$/);
  if (explicitNumSide) {
    baseCardNumber = explicitNumSide[1].trim();
    side = ((explicitNumSide[2] || explicitNumSide[3]) as TenseiSide) || null;
    detectionSource = 'card_number';
  } else {
    const idLower = (card.id || '').trim().toLowerCase();
    const subtypeLower = (card.subtypeLabel || '').trim().toLowerCase();
    const idMatch = idLower.match(/(?:^|[-_])side[-_]?([ab])(?:$|[-_])/i);
    const subtypeMatch = subtypeLower.match(/\bside\s*([ab])\b/i);

    if (idMatch) {
      side = idMatch[1].toUpperCase() as TenseiSide;
      detectionSource = 'id';
    } else if (subtypeMatch) {
      side = subtypeMatch[1].toUpperCase() as TenseiSide;
      detectionSource = 'subtype';
    }
  }

  if (!side || !isRealBaseCardNumber(baseCardNumber)) {
    return null;
  }

  const compactBaseNumber = baseCardNumber.replace(/-0+(\d)/g, '-$1');
  const prefixMatch = baseCardNumber.match(/^([A-Z0-9]+)-/);
  const explicitSet = normalizeSetIdentifier(card.setCode || '');
  const prefixSet = prefixMatch ? normalizeSetIdentifier(prefixMatch[1]) : '';
  const setCode =
    (explicitSet && explicitSet !== 'WIKI' && explicitSet !== 'UNKNOWN'
      ? explicitSet
      : prefixSet) ||
    (card.setCode || '').trim().toUpperCase() ||
    'UNSET';
  const isRevival = Boolean(card.isRevival);

  return {
    side,
    baseCardNumber,
    compactBaseNumber,
    setCode,
    isRevival,
    pairKey: `${setCode}|${compactBaseNumber}|${isRevival ? 'rv' : 'orig'}`,
    detectionSource,
  };
}

/**
 * Links confirmed Tensei / Rebirth Side A and Side B cards into non-destructive pairs.
 * - Requires exact 1 Side A + 1 Side B with matching set code, base card number, and Revival flag.
 * - Unpaired, duplicate, or incompatible candidates are kept separate and reported in `uncertainCandidates`.
 * - Idempotent across repeated invocations and never mutates original card records.
 */
export function linkTenseiRebirthPairs(cards: BattleSpiritsCard[]): TenseiLinkingResult {
  const uniqueById = new Map<string, BattleSpiritsCard>();
  for (const card of cards) {
    if (!card || !card.id) continue;
    if (!uniqueById.has(card.id)) {
      uniqueById.set(card.id, card);
    }
  }

  interface Bucket {
    baseCardNumber: string;
    setCode: string;
    isRevival: boolean;
    sideA: BattleSpiritsCard[];
    sideB: BattleSpiritsCard[];
  }

  const buckets = new Map<string, Bucket>();

  for (const card of uniqueById.values()) {
    const info = extractTenseiSideInfo(card);
    if (!info) continue;

    let bucket = buckets.get(info.pairKey);
    if (!bucket) {
      bucket = {
        baseCardNumber: info.baseCardNumber,
        setCode: info.setCode,
        isRevival: info.isRevival,
        sideA: [],
        sideB: [],
      };
      buckets.set(info.pairKey, bucket);
    }

    if (info.side === 'A') {
      bucket.sideA.push(card);
    } else {
      bucket.sideB.push(card);
    }
  }

  const pairs: TenseiLinkedPair[] = [];
  const pairByCardId: Record<string, TenseiLinkedPair> = {};
  const sideByCardId: Record<string, TenseiSide> = {};
  const sideBBySideACardId: Record<string, string> = {};
  const sideABySideBCardId: Record<string, string> = {};
  const uncertainCandidates: UncertainTenseiCandidate[] = [];

  for (const [pairKey, bucket] of buckets.entries()) {
    if (bucket.sideA.length === 1 && bucket.sideB.length === 1) {
      const sideACard = bucket.sideA[0];
      const sideBCard = bucket.sideB[0];

      const incompatible =
        sideACard.id === sideBCard.id ||
        Boolean(sideACard.isRevival) !== Boolean(sideBCard.isRevival) ||
        isTokenCard(sideACard) !== isTokenCard(sideBCard);

      if (incompatible) {
        uncertainCandidates.push({
          pairKey,
          baseCardNumber: bucket.baseCardNumber,
          setCode: bucket.setCode,
          isRevival: bucket.isRevival,
          reason: 'incompatible_pair',
          sideACandidates: bucket.sideA,
          sideBCandidates: bucket.sideB,
        });
        continue;
      }

      const pair: TenseiLinkedPair = {
        pairKey,
        baseCardNumber: bucket.baseCardNumber,
        setCode: bucket.setCode,
        isRevival: bucket.isRevival,
        sideACard,
        sideBCard,
        sideACardId: sideACard.id,
        sideBCardId: sideBCard.id,
      };

      pairs.push(pair);
      pairByCardId[sideACard.id] = pair;
      pairByCardId[sideBCard.id] = pair;
      sideByCardId[sideACard.id] = 'A';
      sideByCardId[sideBCard.id] = 'B';
      sideBBySideACardId[sideACard.id] = sideBCard.id;
      sideABySideBCardId[sideBCard.id] = sideACard.id;
    } else {
      const reason: UncertainTenseiReason =
        bucket.sideA.length > 1 || bucket.sideB.length > 1
          ? 'ambiguous_side_records'
          : 'missing_counterpart';

      uncertainCandidates.push({
        pairKey,
        baseCardNumber: bucket.baseCardNumber,
        setCode: bucket.setCode,
        isRevival: bucket.isRevival,
        reason,
        sideACandidates: bucket.sideA,
        sideBCandidates: bucket.sideB,
      });
    }
  }

  return {
    pairs,
    pairByCardId,
    sideByCardId,
    sideBBySideACardId,
    sideABySideBCardId,
    uncertainCandidates,
    stats: {
      confirmedPairCount: pairs.length,
      linkedCardCount: pairs.length * 2,
      uncertainCandidateCount: uncertainCandidates.length,
    },
  };
}

