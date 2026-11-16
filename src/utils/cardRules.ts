import { BattleSpiritsCard } from '../types/card';

export type CardRestrictionLevel =
  | 'Unlimited'
  | 'Banned'
  | 'Restricted <1>'
  | 'Restricted <2>'
  | 'Restricted <20>';

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
