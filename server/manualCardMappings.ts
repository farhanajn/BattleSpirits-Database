export interface ManualCardMapping {
  cardId?: string;
  cardNumber?: string;
  name?: string;
  isRevival?: boolean;
  wikiTitle?: string;
  fileName?: string;
  artworkUrl?: string;
  notes?: string;
  verified?: boolean;
}

export interface ManualMappingQuery {
  id?: string;
  cardNumber?: string;
  name?: string;
  wikiTitle?: string;
  isRevival?: boolean;
}

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

/**
 * Verified manual artwork overrides kept separate from public/cards.json and src/data/cards.ts.
 * Always evaluated at Stage 0 before automatic multi-stage Wiki lookup.
 */
export const MANUAL_CARD_MAPPINGS: ManualCardMapping[] = [
  {
    cardId: 'bs72-bs72-084',
    cardNumber: 'BS72-084',
    name: 'Kizuna Field',
    wikiTitle: 'Kizuna Field',
    fileName: 'BS72-084 (Toppa).png',
    notes: 'Stored filename uses underscore BS72-084_Toppa.png while Wiki uses parentheses.',
    verified: true,
  },
  {
    cardId: 'bs68-bs68-cx03',
    cardNumber: 'BS68-CX03',
    name: 'The ToolcraftContractor Kinich-Ahau',
    wikiTitle: 'The ToolcraftContractor Kinich-Ahau',
    fileName: 'pronouns_are_meow-meow.jpg',
    notes: 'Primary base art filename differs from card number; avoids falling back to PB40 reprint.',
    verified: true,
  },
  {
    cardId: 'bs52-bs52-025-b',
    cardNumber: 'BS52-025(B)',
    name: 'The BladeWolfKingBeast Gowlseed',
    wikiTitle: 'The BladeWolfKingBeast Gowlseed',
    fileName: 'BS52-025_b.png',
    notes: 'Rebirth Side B flip art.',
    verified: true,
  },
  {
    cardId: 'bs52-bs52-034-b',
    cardNumber: 'BS52-034(B)',
    name: 'The RouseEmperorMachine Ragna-Savior -Fighting Form-',
    wikiTitle: 'The RouseEmperorMachine Ragna-Savior -Fighting Form-',
    fileName: 'BS52-034_b.png',
    notes: 'Rebirth Side B flip art.',
    verified: true,
  },
  {
    cardId: 'bs52-bs52-046-b',
    cardNumber: 'BS52-046(B)',
    name: 'The EarthWitch Elneze',
    wikiTitle: 'The EarthWitch Elneze',
    fileName: 'BS52-046_b.png',
    notes: 'Rebirth Side B flip art.',
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
    fileName: 'set arrow.png',
    notes: 'Verified Battle Spirits Wiki CardTable |image= filename.',
    verified: true,
  },
];

const runtimeOverrides = new Map<string, ManualCardMapping>();

export function upsertManualCardMapping(mapping: ManualCardMapping): void {
  const key =
    normCode(mapping.cardId) ||
    normCode(mapping.cardNumber) ||
    normText(mapping.name);
  if (!key) return;
  runtimeOverrides.set(key, mapping);
}

export function listManualCardMappings(): ManualCardMapping[] {
  const merged: ManualCardMapping[] = [...MANUAL_CARD_MAPPINGS];
  for (const override of runtimeOverrides.values()) {
    const idx = merged.findIndex(
      (m) =>
        (override.cardId && normCode(m.cardId) === normCode(override.cardId)) ||
        (override.cardNumber &&
          normCode(m.cardNumber) === normCode(override.cardNumber))
    );
    if (idx >= 0) merged[idx] = override;
    else merged.push(override);
  }
  return merged;
}

export function findManualCardMapping(
  query: ManualMappingQuery
): ManualCardMapping | undefined {
  const all = listManualCardMappings();
  const qId = normCode(query.id);
  const qNum = normCode(query.cardNumber);
  const qName = normText(query.name || query.wikiTitle);

  if (qId) {
    const byId = all.find((m) => m.cardId && normCode(m.cardId) === qId);
    if (byId) return byId;
  }

  if (qNum) {
    const byNum = all.find((m) => {
      if (!m.cardNumber || normCode(m.cardNumber) !== qNum) return false;
      if (
        typeof m.isRevival === 'boolean' &&
        typeof query.isRevival === 'boolean' &&
        m.isRevival !== query.isRevival
      ) {
        return false;
      }
      return true;
    });
    if (byNum) return byNum;
  }

  if (qName) {
    const byName = all.find((m) => {
      if (!m.name || normText(m.name) !== qName) return false;
      // Avoid applying a manual mapping to a completely different cardNumber reprint
      if (m.cardNumber && qNum && normCode(m.cardNumber) !== qNum) return false;
      if (
        typeof m.isRevival === 'boolean' &&
        typeof query.isRevival === 'boolean' &&
        m.isRevival !== query.isRevival
      ) {
        return false;
      }
      return true;
    });
    if (byName) return byName;
  }

  return undefined;
}
