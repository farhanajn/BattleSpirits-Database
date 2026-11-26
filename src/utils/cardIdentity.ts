import type { BattleSpiritsCard } from '../types/card';
import {
  compactCardNumber,
  extractSetCodeFromCardNumber,
  normalizeCardName,
  normalizeCardNumber,
} from './decklistImport';
import { normalizeSetIdentifier } from './setMetadataSync';

export type CardIdentityInput = Partial<
  Pick<
    BattleSpiritsCard,
    | 'id'
    | 'cardNumber'
    | 'setCode'
    | 'name'
    | 'jpName'
    | 'wikiTitle'
    | 'isRevival'
    | 'isToken'
    | 'subtypeLabel'
  >
>;

export function isSyntheticCardNumber(cardNumber?: string): boolean {
  const norm = normalizeCardNumber(cardNumber || '');
  if (!norm) return true;
  if (norm === 'WIKI' || norm === 'UNKNOWN' || norm === 'NONE' || norm === 'N/A') {
    return true;
  }
  return norm.startsWith('SYNTH-');
}

export function getCardVersionVariantKey(card: CardIdentityInput): string {
  const parts: string[] = [card.isRevival ? 'rv' : 'orig'];
  if (card.isToken || /^token/i.test((card.id || '').trim())) {
    parts.push('tok');
  }

  const numUpper = (card.cardNumber || '').trim().toUpperCase();
  const idLower = (card.id || '').trim().toLowerCase();
  const subtypeLower = (card.subtypeLabel || '').trim().toLowerCase();

  if (!/\([AB]\)$/i.test(numUpper)) {
    if (/(?:^|[-_])side[-_]?b(?:$|[-_])/i.test(idLower) || /\bside\s*b\b/i.test(subtypeLower)) {
      parts.push('side-b');
    } else if (
      /(?:^|[-_])side[-_]?a(?:$|[-_])/i.test(idLower) ||
      /\bside\s*a\b/i.test(subtypeLower)
    ) {
      parts.push('side-a');
    }
  }

  return parts.join(':');
}

export function resolveCanonicalIdentitySetCode(card: CardIdentityInput): string {
  const explicit = normalizeSetIdentifier(card.setCode || '');
  if (explicit && explicit !== 'WIKI' && explicit !== 'UNKNOWN') {
    return explicit;
  }
  const fromNum = extractSetCodeFromCardNumber(card.cardNumber || '');
  if (fromNum) {
    const normFromNum = normalizeSetIdentifier(fromNum);
    if (normFromNum && normFromNum !== 'WIKI') {
      return normFromNum;
    }
  }
  return '';
}

/**
 * Builds a composite identity key for a card entry using:
 * 1. Canonical set identifier (never name alone)
 * 2. Normalized card number (preserving variants/Side-A/Side-B while handling zero-padding)
 * 3. Version / variant flags (Revival vs Original, Token, Side A/B)
 *
 * Cards with the same name from different sets, or different card numbers, or distinct
 * variants ALWAYS produce distinct composite keys. Only genuine duplicate records of the
 * same card entry share a composite key.
 */
export function buildCompositeCardIdentityKey(card: CardIdentityInput): string {
  const setPart = resolveCanonicalIdentitySetCode(card) || 'UNSET';
  const compactNum = compactCardNumber(card.cardNumber || '');
  const verPart = getCardVersionVariantKey(card);

  if (!isSyntheticCardNumber(card.cardNumber) && compactNum) {
    return `set:${setPart}|num:${compactNum}|ver:${verPart}`;
  }

  const cleanName = normalizeCardName(card.name || card.wikiTitle || card.jpName || '')
    .replace(/\s*\(revival\)\s*$/i, '')
    .trim();

  if (cleanName && setPart !== 'UNSET') {
    return `set:${setPart}|name:${cleanName}|ver:${verPart}`;
  }

  const safeId = (card.id || '').trim().toLowerCase();
  if (safeId) {
    return `id:${safeId}`;
  }

  return `set:${setPart}|name:${cleanName || 'unknown'}|ver:${verPart}`;
}

/**
 * Returns true only when two card records genuinely refer to the same card entry.
 * Cards from different sets or with different real card numbers NEVER match.
 */
export function areSameCardIdentity(a: CardIdentityInput, b: CardIdentityInput): boolean {
  const setA = resolveCanonicalIdentitySetCode(a);
  const setB = resolveCanonicalIdentitySetCode(b);
  if (setA && setB && setA !== setB) {
    return false;
  }

  if (getCardVersionVariantKey(a) !== getCardVersionVariantKey(b)) {
    return false;
  }

  const synthA = isSyntheticCardNumber(a.cardNumber);
  const synthB = isSyntheticCardNumber(b.cardNumber);
  if (!synthA && !synthB) {
    return compactCardNumber(a.cardNumber || '') === compactCardNumber(b.cardNumber || '');
  }

  // If one has a real card number and the other is synthetic, check same set + same name/wikiTitle
  const nameA = normalizeCardName(a.name || a.wikiTitle || a.jpName || '')
    .replace(/\s*\(revival\)\s*$/i, '')
    .trim();
  const nameB = normalizeCardName(b.name || b.wikiTitle || b.jpName || '')
    .replace(/\s*\(revival\)\s*$/i, '')
    .trim();
  if (setA && setB && setA === setB && nameA && nameB && nameA === nameB) {
    return true;
  }

  return Boolean(a.id && b.id && a.id === b.id);
}
