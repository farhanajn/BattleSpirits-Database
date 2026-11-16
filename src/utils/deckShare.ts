import { BattleSpiritsCard, Deck, GameFormat } from '../types/card';

export interface SharedDeckEntryPayload {
  cardId: string;
  cardNumber: string;
  name: string;
  quantity: number;
  isRevival?: boolean;
}

export interface SharedDeckPayload {
  v: 1;
  name: string;
  format: GameFormat;
  archetype: string;
  entries: SharedDeckEntryPayload[];
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(base64Url: string): Uint8Array {
  const padded = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function serializeSharedDeckPayload(
  deck: Deck,
  resolvedEntries: { card: BattleSpiritsCard; quantity: number }[]
): SharedDeckPayload {
  return {
    v: 1,
    name: deck.name,
    format: deck.format,
    archetype: deck.archetype,
    entries: resolvedEntries.map(({ card, quantity }) => ({
      cardId: card.id,
      cardNumber: card.cardNumber,
      name: card.name,
      quantity,
      ...(card.isRevival ? { isRevival: true } : {}),
    })),
  };
}

export function encodeSharedDeck(
  deck: Deck,
  resolvedEntries: { card: BattleSpiritsCard; quantity: number }[]
): string {
  const payload = serializeSharedDeckPayload(deck, resolvedEntries);
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytes);
}

export function decodeSharedDeck(rawParam: string): SharedDeckPayload | null {
  const trimmed = rawParam.trim();
  if (!trimmed) return null;

  const tryParseJson = (str: string): SharedDeckPayload | null => {
    try {
      const parsed = JSON.parse(str) as Partial<SharedDeckPayload>;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
        return null;
      }
      const validEntries: SharedDeckEntryPayload[] = parsed.entries
        .filter((e) => e && typeof e === 'object' && Number(e.quantity) > 0)
        .map((e) => ({
          cardId: String(e.cardId || ''),
          cardNumber: String(e.cardNumber || ''),
          name: String(e.name || e.cardNumber || e.cardId || 'Unknown Card'),
          quantity: Math.max(1, Math.min(20, Math.round(Number(e.quantity) || 1))),
          isRevival: Boolean(e.isRevival),
        }))
        .filter((e) => Boolean(e.cardId || e.cardNumber || e.name));

      if (validEntries.length === 0) return null;

      return {
        v: 1,
        name: String(parsed.name || 'Shared Battle Spirits Deck').trim() || 'Shared Deck',
        format: parsed.format === 'Standard' ? 'Standard' : 'Eternal',
        archetype: String(parsed.archetype || 'Shared Deck').trim() || 'Shared Deck',
        entries: validEntries,
      };
    } catch {
      return null;
    }
  };

  // Support both Base64URL-encoded JSON and direct URL-encoded JSON
  if (trimmed.startsWith('{')) {
    return tryParseJson(trimmed);
  }

  try {
    const bytes = fromBase64Url(trimmed);
    const decodedJson = new TextDecoder().decode(bytes);
    const parsed = tryParseJson(decodedJson);
    if (parsed) return parsed;
  } catch {
    // ignore and try URI-decoded JSON fallback
  }

  try {
    return tryParseJson(decodeURIComponent(trimmed));
  } catch {
    return null;
  }
}

export function buildShareDeckUrl(
  deck: Deck,
  resolvedEntries: { card: BattleSpiritsCard; quantity: number }[]
): string {
  const encoded = encodeSharedDeck(deck, resolvedEntries);
  if (typeof window === 'undefined') {
    return `?tab=decks&share=${encoded}`;
  }
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('tab', 'decks');
  url.searchParams.set('share', encoded);
  return url.toString();
}
