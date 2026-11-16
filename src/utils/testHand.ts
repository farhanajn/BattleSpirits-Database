import { BattleSpiritsCard } from '../types/card';

export interface HandCardInstance {
  instanceId: string;
  card: BattleSpiritsCard;
}

export interface TestHandState {
  revealedContract: HandCardInstance | null;
  hand: HandCardInstance[];
  library: HandCardInstance[];
  redrawCount: number;
}

/**
 * Determines whether a card is a Battle Spirits Contract card
 * (Contract Spirit / Contract Ultimate / Contract Nexus / CX rarity / Soul State).
 */
export function isContractCard(card: BattleSpiritsCard): boolean {
  if (!card) return false;
  if (/\bcontract\b/i.test(card.subtypeLabel || '')) return true;
  if (card.rarity === 'CX') return true;
  if (card.effects?.some((eff) => /\bsoul state\b/i.test(eff.timing || ''))) {
    return true;
  }
  return false;
}

/**
 * Returns unique Contract cards present in the deck entries (preserving deck order).
 */
export function getContractCardsInDeck(
  entries: { card: BattleSpiritsCard; quantity: number }[]
): BattleSpiritsCard[] {
  const seen = new Set<string>();
  const contracts: BattleSpiritsCard[] = [];
  for (const { card, quantity } of entries) {
    if (quantity <= 0 || card.isToken) continue;
    if (isContractCard(card) && !seen.has(card.id)) {
      seen.add(card.id);
      contracts.push(card);
    }
  }
  return contracts;
}

/**
 * Expands deck entries into individual card instances for shuffling & drawing.
 */
export function expandDeckInstances(
  entries: { card: BattleSpiritsCard; quantity: number }[]
): HandCardInstance[] {
  const pool: HandCardInstance[] = [];
  for (const { card, quantity } of entries) {
    if (quantity <= 0 || card.isToken) continue;
    for (let i = 0; i < quantity; i++) {
      pool.push({
        instanceId: `${card.id}__copy_${i + 1}`,
        card,
      });
    }
  }
  return pool;
}

export function shuffleInstances<T>(
  items: T[],
  rng: () => number = Math.random
): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Deals a 4-card opening hand under Battle Spirits Contract rules:
 * - If a Contract card is chosen (or auto-selected), reveals 1 copy separately
 *   before drawing 4 random cards from the remaining shuffled deck.
 */
export function dealOpeningHand(
  entries: { card: BattleSpiritsCard; quantity: number }[],
  options?: {
    preferredContractId?: string | null;
    revealContract?: boolean;
    handSize?: number;
    rng?: () => number;
  }
): TestHandState {
  const handSize = options?.handSize ?? 4;
  const rng = options?.rng ?? Math.random;
  const shouldReveal = options?.revealContract ?? true;

  const pool = expandDeckInstances(entries);
  let revealedContract: HandCardInstance | null = null;

  if (shouldReveal) {
    const preferredId = options?.preferredContractId;
    let contractIdx = preferredId
      ? pool.findIndex((item) => item.card.id === preferredId)
      : -1;
    if (contractIdx === -1) {
      contractIdx = pool.findIndex((item) => isContractCard(item.card));
    }
    if (contractIdx !== -1) {
      revealedContract = pool[contractIdx];
      pool.splice(contractIdx, 1);
    }
  }

  const shuffled = shuffleInstances(pool, rng);
  const drawCount = Math.min(handSize, shuffled.length);

  return {
    revealedContract,
    hand: shuffled.slice(0, drawCount),
    library: shuffled.slice(drawCount),
    redrawCount: 0,
  };
}

/**
 * Applies the new Battle Spirits Redraw (Mulligan) rule:
 * Returns ALL drawn cards back to the deck, shuffles the deck,
 * and draws a new 4 random cards (keeping the 1 revealed Contract card out).
 */
export function applyBattleSpiritsRedraw(
  state: TestHandState,
  handSize: number = 4,
  rng: () => number = Math.random
): TestHandState {
  const combined = [...state.library, ...state.hand];
  const shuffled = shuffleInstances(combined, rng);
  const drawCount = Math.min(handSize, shuffled.length);

  return {
    revealedContract: state.revealedContract,
    hand: shuffled.slice(0, drawCount),
    library: shuffled.slice(drawCount),
    redrawCount: state.redrawCount + 1,
  };
}

/**
 * Draws one additional card from the remaining deck into hand.
 */
export function drawNextCard(state: TestHandState): TestHandState {
  if (state.library.length === 0) return state;
  const [nextCard, ...rest] = state.library;
  return {
    ...state,
    hand: [...state.hand, nextCard],
    library: rest,
  };
}
