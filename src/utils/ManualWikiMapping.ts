import type { BattleSpiritsCard } from '../types/card.ts';

export interface ManualWikiMappingEntry {
  /** Primary stable card id (e.g. 'bs72-bs72-084') */
  cardId?: string;
  /** Exact or normalized card number (e.g. 'BS52-025(B)', 'BS45-095') */
  cardNumber?: string;
  /** Card display name for fallback matching or human review */
  name?: string;
  /** Optional Revival flag so Original and Revival versions never collide */
  isRevival?: boolean;
  /** Verified Battle Spirits Wiki article title */
  wikiTitle?: string;
  /** Verified Battle Spirits Wiki File: filename */
  fileName?: string;
  /** Verified direct artwork URL (https://..., http://..., or /api/wiki/image?...) */
  artworkUrl?: string;
  /** Optional human review note explaining why the override is needed */
  notes?: string;
  /** Verification marker */
  verified?: boolean;
}

export interface ManualMappingLookupQuery {
  id?: string;
  cardNumber?: string;
  name?: string;
  wikiTitle?: string;
  isRevival?: boolean;
}

const DISALLOWED_ICON_RE =
  /(?:^|[_/\s:-])(?:(?:stan|red|purple|white|yellow|green|blue|gold|god|soul|ultimate|omni|all)[_\s]+)?(?:core|symbol|gem|ex[_\s]+symbol)(?:[_.\s]|$)|(?:stan_?soul_?core|soul_?core|ex_?symbol|reduction\.png|rarity_|button|banner\.jpe?g|flash\d+\.png|bursticon)/i;

const INVALID_TITLE_NAMESPACE_RE =
  /^(?:Category|File|Image|Template|User|Talk|Help|Module|MediaWiki|Special):/i;

function normCode(raw?: string): string {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normText(raw?: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/\s+/g, ' ');
}

export function isValidManualArtworkUrl(rawUrl?: string): boolean {
  const clean = (rawUrl || '').trim();
  if (!clean) return false;
  if (DISALLOWED_ICON_RE.test(clean)) return false;

  if (clean.startsWith('/api/wiki/image')) {
    return clean.length > '/api/wiki/image'.length;
  }

  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function isValidManualWikiTitle(rawTitle?: string): boolean {
  const clean = (rawTitle || '').trim();
  if (clean.length < 2 || clean.length > 200) return false;
  if (INVALID_TITLE_NAMESPACE_RE.test(clean)) return false;
  if (/[\x00-\x1F<>[\]{}|]/.test(clean)) return false;
  return true;
}

export function isValidManualFileName(rawFile?: string): boolean {
  const clean = (rawFile || '')
    .trim()
    .replace(/^File:/i, '')
    .trim();
  if (!clean || !/\.(?:png|jpe?g|webp|gif)$/i.test(clean)) return false;
  if (DISALLOWED_ICON_RE.test(clean)) return false;
  return !/[<>[\]{}|?*]/.test(clean);
}

export function validateManualWikiMappingEntry(
  entry: ManualWikiMappingEntry
): { valid: boolean; reason?: string } {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, reason: 'Mapping entry is not an object' };
  }
  const hasKey = Boolean(
    entry.cardId?.trim() || entry.cardNumber?.trim() || entry.name?.trim()
  );
  if (!hasKey) {
    return {
      valid: false,
      reason: 'Mapping entry requires cardId, cardNumber, or name key',
    };
  }
  if (entry.artworkUrl !== undefined && !isValidManualArtworkUrl(entry.artworkUrl)) {
    return {
      valid: false,
      reason: `Invalid artworkUrl: ${entry.artworkUrl}`,
    };
  }
  if (entry.wikiTitle !== undefined && !isValidManualWikiTitle(entry.wikiTitle)) {
    return {
      valid: false,
      reason: `Invalid wikiTitle: ${entry.wikiTitle}`,
    };
  }
  if (entry.fileName !== undefined && !isValidManualFileName(entry.fileName)) {
    return {
      valid: false,
      reason: `Invalid fileName: ${entry.fileName}`,
    };
  }
  if (
    !entry.artworkUrl?.trim() &&
    !entry.fileName?.trim() &&
    !entry.wikiTitle?.trim()
  ) {
    return {
      valid: false,
      reason: 'Mapping entry must specify artworkUrl, fileName, or wikiTitle',
    };
  }
  return { valid: true };
}

/**
 * Manually verified Battle Spirits artwork overrides kept completely separate
 * from public/cards.json and src/data/cards.ts.
 *
 * Precedence:
 * 1. Valid direct `artworkUrl` (highest priority)
 * 2. Valid `fileName` (+ optional `wikiTitle`) routed through /api/wiki/image
 * 3. Valid `wikiTitle` resolved against verified CardTable artwork
 */
export const MANUAL_WIKI_MAPPINGS: ManualWikiMappingEntry[] = [
  {
    cardId: 'bs72-bs72-084',
    cardNumber: 'BS72-084',
    name: 'Kizuna Field',
    wikiTitle: 'Kizuna Field',
    fileName: 'BS72-084 (Toppa).png',
    notes: 'Stored slug used underscore BS72-084_Toppa.png while Wiki uses parentheses.',
    verified: true,
  },
  {
    cardId: 'bs68-bs68-cx03',
    cardNumber: 'BS68-CX03',
    name: 'The ToolcraftContractor Kinich-Ahau',
    wikiTitle: 'The ToolcraftContractor Kinich-Ahau',
    fileName: 'pronouns_are_meow-meow.jpg',
    notes: 'Primary CardTable base artwork; prevents matching PB40 promo reprint.',
    verified: true,
  },
  {
    cardId: 'bs52-bs52-025-b',
    cardNumber: 'BS52-025(B)',
    name: 'The BladeWolfKingBeast Gowlseed',
    wikiTitle: 'The BladeWolfKingBeast Gowlseed',
    fileName: 'BS52-025_b.png',
    notes: 'Rebirth Side B flip artwork.',
    verified: true,
  },
  {
    cardId: 'bs52-bs52-034-b',
    cardNumber: 'BS52-034(B)',
    name: 'The RouseEmperorMachine Ragna-Savior -Fighting Form-',
    wikiTitle: 'The RouseEmperorMachine Ragna-Savior -Fighting Form-',
    fileName: 'BS52-034_b.png',
    notes: 'Rebirth Side B flip artwork.',
    verified: true,
  },
  {
    cardId: 'bs52-bs52-046-b',
    cardNumber: 'BS52-046(B)',
    name: 'The EarthWitch Elneze',
    wikiTitle: 'The EarthWitch Elneze',
    fileName: 'BS52-046_b.png',
    notes: 'Rebirth Side B flip artwork.',
    verified: true,
  },
  {
    cardId: 'bs45-bs45-009',
    cardNumber: 'BS45-009',
    name: 'Thunder-Z-Eagle',
    wikiTitle: 'Thunder-Z-Eagle',
    fileName: 'Energer_zzzzzzzzzzzzzzzzzzzzzzzz.png',
    notes: 'Verified Battle Spirits Wiki CardTable |image= filename.',
    verified: true,
  },
  {
    cardId: 'bs45-bs45-026',
    cardNumber: 'BS45-026',
    name: 'The TrojonLionheart Philoctetes',
    wikiTitle: 'The TrojonLionheart Philoctetes',
    fileName: 'The_dangers_of_masturbation.png',
    notes: 'Verified Battle Spirits Wiki CardTable |image= filename.',
    verified: true,
  },
  {
    cardId: 'bs45-bs45-053',
    cardNumber: 'BS45-053',
    name: 'The EarthAngelia Moridiel',
    wikiTitle: 'The EarthAngelia Moridiel',
    fileName: 'lesbian_angelia.png',
    notes: 'Verified Battle Spirits Wiki CardTable |image= filename.',
    verified: true,
  },
  {
    cardId: 'bs45-bs45-095',
    cardNumber: 'BS45-095',
    name: "Isis' Power",
    wikiTitle: "Isis' Power",
    fileName: 'Anal_showing_her_power.png',
    notes: 'Verified Battle Spirits Wiki CardTable |image= base print filename.',
    verified: true,
  },
  {
    cardId: 'bs45-bs45-096',
    cardNumber: 'BS45-096',
    name: 'Setnakt Arrow',
    wikiTitle: 'Setnakt Arrow',
    fileName: 'Set arrow.png',
    notes: 'Verified Battle Spirits Wiki CardTable |image= filename.',
    verified: true,
  },
  {
    cardId: 'bs43-rvx05',
    cardNumber: 'BS43-RVX05',
    name: 'The DoomKnightLord Ragna-Rock (Revival)',
    isRevival: true,
    wikiTitle: 'The DoomKnightLord Ragna-Rock',
    fileName: 'BS43-RV X05-BSC36.png',
    notes: 'Verified clean Revival print artwork for BS43-RVX05.',
    verified: true,
  },
];

const runtimeMappings = new Map<string, ManualWikiMappingEntry>();

function buildEntryKey(entry: ManualWikiMappingEntry): string {
  const revTag =
    typeof entry.isRevival === 'boolean' ? `|${entry.isRevival ? 'rv' : 'orig'}` : '';
  return (
    (normCode(entry.cardId) && `id:${normCode(entry.cardId)}`) ||
    (normCode(entry.cardNumber) && `num:${normCode(entry.cardNumber)}${revTag}`) ||
    `name:${normText(entry.name)}${revTag}`
  );
}

export function registerManualWikiMapping(
  entry: ManualWikiMappingEntry
): { ok: boolean; reason?: string } {
  const check = validateManualWikiMappingEntry(entry);
  if (!check.valid) return { ok: false, reason: check.reason };
  const key = buildEntryKey(entry);
  if (!key) return { ok: false, reason: 'Empty key' };
  runtimeMappings.set(key, entry);
  return { ok: true };
}

export function unregisterManualWikiMapping(
  query: Pick<ManualMappingLookupQuery, 'id' | 'cardNumber' | 'name' | 'isRevival'>
): boolean {
  const revTag =
    typeof query.isRevival === 'boolean' ? `|${query.isRevival ? 'rv' : 'orig'}` : '';
  const candidates = [
    normCode(query.id) && `id:${normCode(query.id)}`,
    normCode(query.cardNumber) && `num:${normCode(query.cardNumber)}${revTag}`,
    normCode(query.cardNumber) && `num:${normCode(query.cardNumber)}`,
    normText(query.name) && `name:${normText(query.name)}${revTag}`,
    normText(query.name) && `name:${normText(query.name)}`,
  ].filter(Boolean) as string[];

  let deleted = false;
  for (const k of candidates) {
    if (runtimeMappings.delete(k)) deleted = true;
  }
  return deleted;
}

export function listManualWikiMappings(): ManualWikiMappingEntry[] {
  const merged: ManualWikiMappingEntry[] = [];
  for (const base of MANUAL_WIKI_MAPPINGS) {
    if (validateManualWikiMappingEntry(base).valid) {
      merged.push(base);
    }
  }
  for (const custom of runtimeMappings.values()) {
    if (!validateManualWikiMappingEntry(custom).valid) continue;
    const customId = normCode(custom.cardId);
    const customNum = normCode(custom.cardNumber);
    const idx = merged.findIndex(
      (m) =>
        (customId && normCode(m.cardId) === customId) ||
        (customNum &&
          normCode(m.cardNumber) === customNum &&
          (typeof custom.isRevival !== 'boolean' ||
            typeof m.isRevival !== 'boolean' ||
            custom.isRevival === m.isRevival))
    );
    if (idx >= 0) merged[idx] = custom;
    else merged.push(custom);
  }
  return merged;
}

export function getManualWikiMapping(
  cardOrQuery: BattleSpiritsCard | ManualMappingLookupQuery
): ManualWikiMappingEntry | undefined {
  const qId = normCode(cardOrQuery.id);
  const qNum = normCode(cardOrQuery.cardNumber);
  const qName = normText(cardOrQuery.name || cardOrQuery.wikiTitle);
  const qIsRev =
    typeof cardOrQuery.isRevival === 'boolean'
      ? cardOrQuery.isRevival
      : /\(revival\)/i.test(cardOrQuery.name || '') ||
        /(?:^|-)RV[A-Z0-9]*\d/i.test(cardOrQuery.cardNumber || '') ||
        /^BSC22-/i.test(cardOrQuery.cardNumber || '');

  const validEntries = listManualWikiMappings();

  // 1. Exact cardId match
  if (qId) {
    const byId = validEntries.find((m) => m.cardId && normCode(m.cardId) === qId);
    if (byId) return byId;
  }

  // 2. Exact normalized cardNumber match (respecting Revival state if set)
  if (qNum) {
    const byNum = validEntries.find((m) => {
      if (!m.cardNumber || normCode(m.cardNumber) !== qNum) return false;
      if (typeof m.isRevival === 'boolean' && m.isRevival !== qIsRev) {
        return false;
      }
      return true;
    });
    if (byNum) return byNum;
  }

  // 3. Exact normalized name match ONLY when it won't collide across different cardNumbers
  if (qName) {
    const byName = validEntries.find((m) => {
      if (!m.name || normText(m.name) !== qName) return false;
      if (m.cardNumber && qNum && normCode(m.cardNumber) !== qNum) return false;
      if (typeof m.isRevival === 'boolean' && m.isRevival !== qIsRev) {
        return false;
      }
      return true;
    });
    if (byName) return byName;
  }

  return undefined;
}

export function resolveManualMappingArtworkUrl(
  card: Pick<
    BattleSpiritsCard,
    'id' | 'cardNumber' | 'name' | 'wikiTitle' | 'jpName' | 'setCode' | 'isRevival'
  >,
  mapping: ManualWikiMappingEntry
): string | null {
  const check = validateManualWikiMappingEntry(mapping);
  if (!check.valid) return null;

  if (mapping.artworkUrl && isValidManualArtworkUrl(mapping.artworkUrl)) {
    return mapping.artworkUrl.trim();
  }

  const qs = new URLSearchParams();
  if (mapping.fileName && isValidManualFileName(mapping.fileName)) {
    qs.set('file', mapping.fileName.trim());
  }
  if (card.cardNumber?.trim()) {
    qs.set('fallback', card.cardNumber.trim());
  }
  const targetTitle =
    (mapping.wikiTitle && isValidManualWikiTitle(mapping.wikiTitle)
      ? mapping.wikiTitle.trim()
      : '') ||
    (card.wikiTitle || card.name || '').trim();
  if (targetTitle) qs.set('title', targetTitle);
  if (card.name?.trim() && card.name.trim() !== targetTitle) {
    qs.set('name', card.name.trim());
  }
  if (card.jpName?.trim()) qs.set('jp', card.jpName.trim());
  if (card.setCode?.trim()) qs.set('set', card.setCode.trim());
  if (card.isRevival) qs.set('rv', '1');
  if (card.id?.trim()) qs.set('id', card.id.trim());

  const str = qs.toString();
  return str ? `/api/wiki/image?${str}` : null;
}
