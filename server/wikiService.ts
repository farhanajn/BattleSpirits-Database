import fs from 'node:fs';
import path from 'node:path';
import type {
  BattleSpiritsCard,
  BattleSymbolKind,
  CardColor,
  CardGalleryImage,
  CardRarity,
  CardType,
  GameFormat,
  LevelTier,
  ProductSet,
  SetCategory,
} from '../src/types/card.ts';
import { WIKI_SET_METADATA } from './setMetadata.ts';
import {
  findManualCardMapping,
  listManualCardMappings,
  type ManualCardMapping,
} from './manualCardMappings.ts';
import {
  type ArtworkDiagnosticRecord,
  buildAlternateTitleCandidates,
  type CardLookupCriteria,
  expandWikiFileCandidates,
  generateRomanArabicVariants,
  isCardArtworkFile,
  isNonCardWikiIcon,
  KNOWN_CARD_NAME_ALIASES,
  type LookupResolutionTrace,
  normalizeCardSearchText,
  normalizeCompact,
  scoreWikiCandidatePage,
  stripCardNameDecorations,
  type WikiCandidatePage,
} from './wikiCardLookup.ts';

const WIKI_API = 'https://battle-spirits.fandom.com/api.php';
const WIKI_BASE = 'https://battle-spirits.fandom.com/wiki/';
const USER_AGENT = 'BattleSpiritsDB/1.0 (https://battle-spirits.fandom.com)';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const setCache = new Map<string, CacheEntry<{ set: ProductSet; cards: BattleSpiritsCard[] }>>();
const cardWikitextCache = new Map<string, CacheEntry<string>>();
const imageUrlCache = new Map<string, CacheEntry<string | null>>();

const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const BANLIST_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

const ALL_COLORS: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];

export type WikiCardRestriction =
  | 'Unlimited'
  | 'Banned'
  | 'Restricted <1>'
  | 'Restricted <2>'
  | 'Restricted <20>';

export interface WikiBanListSnapshot {
  effectiveDate: string;
  byCardNumber: Record<string, WikiCardRestriction>;
  byName: Record<string, WikiCardRestriction>;
}

const SEED_RESTRICTED_1_NAMES = [
  'The SevenShogunDemon Beelzebub',
  'The SevenShogun Demon Belzeebub',
  'Fruit of Life',
  'Dark Knight Mordred',
  'The CrimsonDragonLord Kaiser-Atlas',
];

function normalizeBanKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/\s*\(revival\)\s*/gi, '')
    .replace(/\s+/g, ' ');
}

function normalizeCardCodeKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

let banListCache: CacheEntry<WikiBanListSnapshot> | null = null;
let banListInflight: Promise<WikiBanListSnapshot> | null = null;

function buildSeedBanListSnapshot(): WikiBanListSnapshot {
  const byName: Record<string, WikiCardRestriction> = {};
  for (const name of SEED_RESTRICTED_1_NAMES) {
    byName[normalizeBanKey(name)] = 'Restricted <1>';
  }
  return {
    effectiveDate: 'Official Ban/Limit Seed',
    byCardNumber: {
      'P16-26': 'Restricted <20>',
    },
    byName,
  };
}

function parseBanListWikitext(wikitext: string): WikiBanListSnapshot {
  const snapshot = buildSeedBanListSnapshot();

  const dateMatch = wikitext.match(/effective from\s+'''([^']+)'''/i);
  if (dateMatch) {
    snapshot.effectiveDate = dateMatch[1].trim();
  }

  let currentRestriction: WikiCardRestriction | null = null;
  const headingRegex = /^(={2,3})\s*([^=\n]+?)\s*\1/gm;
  const sections: { title: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(wikitext)) !== null) {
    if (sections.length > 0) {
      sections[sections.length - 1].end = m.index;
    }
    sections.push({
      title: m[2].trim(),
      start: m.index + m[0].length,
      end: wikitext.length,
    });
  }

  const applyEntry = (
    restriction: WikiCardRestriction,
    namesRaw: string,
    numbersRaw: string,
    isRevival: boolean
  ) => {
    const cleanedNames = namesRaw
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .split('/')
      .map((n) => n.trim())
      .filter(Boolean);

    for (const nm of cleanedNames) {
      const baseKey = normalizeBanKey(nm);
      if (!baseKey) continue;
      if (isRevival) {
        snapshot.byName[`${baseKey}|rv`] = restriction;
      } else {
        snapshot.byName[`${baseKey}|orig`] = restriction;
        if (!snapshot.byName[baseKey]) {
          snapshot.byName[baseKey] = restriction;
        }
      }
    }

    const codeTokens = numbersRaw
      .split(/[/,\s]+/)
      .map((c) => normalizeCardCodeKey(c))
      .filter((c) => /^[A-Z0-9-]+$/.test(c) && /\d/.test(c));

    for (const code of codeTokens) {
      snapshot.byCardNumber[code] = restriction;
      // Handle BS/SD codes with missing leading zero in wiki captions (e.g. SD57-06 -> SD57-006)
      const padMatch = code.match(/^([A-Z0-9]+)-(\d{2})$/);
      if (padMatch) {
        snapshot.byCardNumber[`${padMatch[1]}-0${padMatch[2]}`] = restriction;
      }
      const trimMatch = code.match(/^([A-Z0-9]+)-0(\d{2})$/);
      if (trimMatch) {
        snapshot.byCardNumber[`${trimMatch[1]}-${trimMatch[2]}`] = restriction;
      }
    }
  };

  for (const sec of sections) {
    const t = sec.title.toLowerCase();
    if (t.includes('banning pair') || t.includes('update record')) {
      currentRestriction = null;
      continue;
    }
    if (/banned\s+cards/i.test(t)) {
      currentRestriction = 'Banned';
    } else if (/limited\s+cards.*<\s*20\s*>/i.test(t)) {
      currentRestriction = 'Restricted <20>';
    } else if (/limited\s+cards.*<\s*2\s*>/i.test(t)) {
      currentRestriction = 'Restricted <2>';
    } else if (/limited\s+cards.*<\s*1\s*>/i.test(t)) {
      currentRestriction = 'Restricted <1>';
    } else {
      currentRestriction = null;
    }
    if (!currentRestriction) continue;

    const body = wikitext.slice(sec.start, sec.end);
    // Gallery entries look like: File.jpg|[[Name]] (Revival) (CODE)
    const entryRegex =
      /\|((?:\[\[[^\]]+\]\](?:\s*\/\s*\[\[[^\]]+\]\])*))\s*(?:\((Revival)\)\s*)?\(([^)\n]+)\)/gi;
    let em: RegExpExecArray | null;
    while ((em = entryRegex.exec(body)) !== null) {
      const namesRaw = em[1] || '';
      const isRev = Boolean(em[2]);
      const numbersRaw = em[3] || '';
      applyEntry(currentRestriction, namesRaw, numbersRaw, isRev);
    }
  }

  return snapshot;
}

async function ensureBanListLoaded(): Promise<WikiBanListSnapshot> {
  const now = Date.now();
  if (banListCache && banListCache.expiresAt > now) {
    return banListCache.value;
  }
  if (banListInflight) {
    return banListInflight;
  }

  banListInflight = (async () => {
    try {
      const json = (await fetchWikiJson({
        action: 'query',
        titles: 'Banned_and_Restricted_Cards',
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        redirects: '1',
      })) as {
        query?: {
          pages?: Record<
            string,
            { revisions?: { slots?: { main?: { '*'?: string } } }[] }
          >;
        };
      };
      const page = Object.values(json.query?.pages || {})[0];
      const wt = page?.revisions?.[0]?.slots?.main?.['*'] || '';
      const parsed = wt ? parseBanListWikitext(wt) : buildSeedBanListSnapshot();
      banListCache = {
        value: parsed,
        expiresAt: Date.now() + BANLIST_TTL_MS,
      };
      return parsed;
    } catch {
      const fallback = banListCache?.value || buildSeedBanListSnapshot();
      banListCache = {
        value: fallback,
        expiresAt: Date.now() + 1000 * 60 * 5,
      };
      return fallback;
    } finally {
      banListInflight = null;
    }
  })();

  return banListInflight;
}

export async function getWikiBanList(): Promise<WikiBanListSnapshot> {
  return ensureBanListLoaded();
}

function resolveCardRestriction(
  cardNumber: string,
  cardName: string,
  isRevival?: boolean,
  fallback?: WikiCardRestriction
): WikiCardRestriction {
  const snap = banListCache?.value || buildSeedBanListSnapshot();
  const codeKey = normalizeCardCodeKey(cardNumber || '');
  if (codeKey && snap.byCardNumber[codeKey]) {
    return snap.byCardNumber[codeKey];
  }
  const baseNameKey = normalizeBanKey(cardName || '');
  if (baseNameKey) {
    const versionKey = `${baseNameKey}|${isRevival ? 'rv' : 'orig'}`;
    if (snap.byName[versionKey]) return snap.byName[versionKey];
    if (snap.byName[baseNameKey]) return snap.byName[baseNameKey];
  }
  return fallback || 'Unlimited';
}

// Curated titles for well-known sets so the directory is immediately informative before hydration
const KNOWN_SET_META: Record<
  string,
  { name: string; releaseDate?: string; tagline?: string; colors?: CardColor[] }
> = {
  '26RBS01': {
    name: 'The Genesis Pulse',
    releaseDate: 'Apr 2026',
    tagline: 'First Standard Format booster set featuring True Release and Soul Magic.',
    colors: ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'],
  },
  BS77: {
    name: 'Contract Saga: Proof Vol. 2 – Advent of the Battle God',
    releaseDate: 'Nov 2026',
    tagline: 'Second Eternal Booster featuring Red/Yellow/Blue Flag Nexuses and remade Twelve God-Kings.',
    colors: ['Red', 'Yellow', 'Blue'],
  },
  BS76: {
    name: 'Contract Saga: Proof Vol. 1 – Radiance of the Eternal Kings',
    releaseDate: 'May 2026',
    tagline: 'First Eternal Booster introducing Contract Nexuses and the Bannerace archetype.',
    colors: ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'],
  },
  BS75: {
    name: 'Contract Saga: Cycle Vol. 4 – Assembling Heroes',
    releaseDate: 'Feb 2026',
    tagline: 'Final chapter of Contract Saga: Cycle featuring Indra and Khaos.',
    colors: ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'],
  },
  BS74: {
    name: 'Contract Saga: Cycle Vol. 3 – Arrival of Ultimate Supremes',
    releaseDate: 'Nov 2025',
    tagline: 'Features Ultimate-focused Contract Grandwalkers Dionysus and Ometeotl.',
    colors: ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'],
  },
  BS73: {
    name: 'Contract Saga: Cycle Vol. 2 – Transmigrating Worlds',
    releaseDate: 'Aug 2025',
    tagline: 'Introduces Yum-Kaax, Morrigan, Yamato-Takeru, Token Nexuses, and Rebirth.',
    colors: ['Red', 'Green', 'Purple'],
  },
  BS72: {
    name: 'Contract Saga: Cycle Vol. 1 – Return and Reawake',
    releaseDate: 'May 2025',
    tagline: 'Introduces Contract Grandwalker Artemis, Nyx, Lugh, and AX-Rares.',
    colors: ['Red', 'Purple', 'White'],
  },
  BS71: {
    name: 'Contract Saga: True Vol. 4 – Return of the King of Gods',
    releaseDate: 'Jan 2025',
    tagline: 'Crowning chapter of Contract Saga: True featuring Zeus and Olym deities.',
    colors: ['Red', 'Yellow'],
  },
  BS68: {
    name: 'Contract Saga: True Vol. 1 – Battle of the Gods',
    releaseDate: 'Apr 2024',
    tagline: 'Introduced Contract Grandwalker Nexuses led by Hades and Athena.',
    colors: ['Purple', 'White'],
  },
  BS62: {
    name: 'Contract Saga Vol. 3 – Rise of Rivals',
    releaseDate: '2022',
    tagline: 'Contract Era booster featuring XX-Rares and high-impact Ultimates.',
    colors: ['Yellow', 'Blue'],
  },
  BS52: {
    name: 'Chronicle of Rebirth Vol. 1',
    releaseDate: '2020',
    tagline: 'Introduced Rebirth double-sided cards.',
    colors: ['Green', 'Purple', 'White'],
  },
  BS45: {
    name: 'Divine Awakening Vol. 2',
    releaseDate: '2018',
    tagline: 'Advent Era set featuring Grandwalker Nexuses and Divine Spirits.',
    colors: ['White', 'Purple', 'Yellow', 'Blue'],
  },
  BS19: {
    name: 'Sword-Eyes Era Vol. 1 – Darkness Awakening',
    releaseDate: '2012',
    tagline: 'Introduced Sword Braves and Curse/Trash recursion staples.',
    colors: ['Purple', 'Green', 'Blue'],
  },
  BS09: {
    name: 'Supernova',
    releaseDate: '2010',
    tagline: 'Home of Supernova Dragon Siegwurm Nova and Meteor Storm.',
    colors: ['Red', 'Purple', 'Yellow', 'Green'],
  },
  BS01: {
    name: 'Dawn of the Spirit (Call of the Core)',
    releaseDate: 'Sep 2008',
    tagline: 'The inaugural Battle Spirits booster set introducing Awaken, High Speed, and Siegfried.',
    colors: ['Red', 'Purple', 'White', 'Green'],
  },
  SD70: {
    name: 'Collab Starter: Persona 3 Reload',
    releaseDate: 'Feb 2025',
    tagline: 'Pre-constructed collaboration starter deck featuring Persona 3 Reload.',
    colors: ['Blue', 'Yellow'],
  },
  SD69: {
    name: 'Mega Deck: The Creation God of Hearty Flames',
    releaseDate: 'Jan 2025',
    tagline: 'Remake of Grandwalker Brahma introducing Token cards.',
    colors: ['Red', 'White'],
  },
  SD01: {
    name: 'Blazing Thunder & Diamond Deity',
    releaseDate: 'Sep 2009',
    tagline: 'First Battle Spirits starter half-decks featuring Dan Bashin and Yuuki Momose.',
    colors: ['Red', 'Purple', 'White', 'Green'],
  },
};

const PROMO_PAGES: {
  setCode: string;
  wikiTitle: string;
  name: string;
  formats: GameFormat[];
  releaseDate: string;
  tagline: string;
}[] = [
  {
    setCode: 'RP26-STD',
    wikiTitle: 'Standard Promo Cards/Regular Promos',
    name: 'Standard Format Regular Promos (RP26)',
    formats: ['Standard', 'Eternal'],
    releaseDate: 'Apr 2026+',
    tagline: 'Official Standard-legal regular promo cards (RP26 series) from Battle Spirits Wiki.',
  },
  {
    setCode: 'PX26-STD',
    wikiTitle: 'Standard Promo Cards/Promo X-Rares',
    name: 'Standard Format Promo X-Rares (PX26)',
    formats: ['Standard', 'Eternal'],
    releaseDate: 'Apr 2026+',
    tagline: 'Official Standard-legal Promo X-Rares from Battle Spirits Wiki.',
  },
  {
    setCode: 'PROMO-REG',
    wikiTitle: 'Promo Cards/Regular Promos',
    name: 'Regular Promos (P-Series)',
    formats: ['Eternal'],
    releaseDate: '2008–2026',
    tagline: 'Complete P-numbered tournament, magazine, and event promotional cards.',
  },
  {
    setCode: 'PROMO-PX',
    wikiTitle: 'Promo Cards/Promo X-Rares',
    name: 'Promo X-Rares (PX-Series)',
    formats: ['Eternal'],
    releaseDate: '2009–2026',
    tagline: 'High-rarity promotional X-Rare cards distributed at events and campaigns.',
  },
  {
    setCode: 'PROMO-X',
    wikiTitle: 'Promo Cards',
    name: 'X-Promos, P14-X & Video Game Promos',
    formats: ['Eternal'],
    releaseDate: '2008–2026',
    tagline: 'Special X-001 through X-022 promos, P14-X, Ace Promos, and console bundle cards.',
  },
  {
    setCode: 'PROMO-CMP',
    wikiTitle: 'Promo Cards/Campaign Promos',
    name: 'Campaign Promos',
    formats: ['Eternal'],
    releaseDate: 'All Eras',
    tagline: 'Box-topper and retail campaign promotional cards.',
  },
  {
    setCode: 'PROMO-LIM',
    wikiTitle: 'Promo Cards/Limited Pack Promos',
    name: 'Limited Pack Promos',
    formats: ['Eternal'],
    releaseDate: 'All Eras',
    tagline: 'Tournament and special Limited Pack exclusive promotional cards.',
  },
  {
    setCode: 'PROMO-JMP',
    wikiTitle: 'Promo Cards/Jump Promos',
    name: 'Jump & Magazine Promos',
    formats: ['Eternal'],
    releaseDate: 'All Eras',
    tagline: 'Saikyo Jump and V-Jump magazine insert promotional cards.',
  },
  {
    setCode: 'PROMO-ANM',
    wikiTitle: 'Promo Cards/Anime Promos',
    name: 'Anime & DVD Promos',
    formats: ['Eternal'],
    releaseDate: 'All Eras',
    tagline: 'Promotional cards bundled with Battle Spirits anime Blu-ray and DVD releases.',
  },
];

export function buildWikiDirectory(): ProductSet[] {
  const list: ProductSet[] = [];

  // 1. Standard Format Boosters & Decks (2026+)
  const standardBoosters = ['26RBS04', '26RBS03', '26RBS02', '26RBS01', '26REB01', '26RDB01', '26RCB03', '26RCB02', '26RCB01'];
  for (const code of standardBoosters) {
    const known = KNOWN_SET_META[code];
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || known?.name || code;
    list.push({
      setCode: code,
      wikiTitle: code,
      category: 'Standard Booster',
      name: setName,
      jpName: '',
      productType: 'Booster Set',
      releaseDate: known?.releaseDate || wikiMeta?.releaseDate || '2026+',
      formats: ['Standard', 'Eternal'],
      blockLabel: 'Standard Format (Block A+)',
      isLatestStandard: code === '26RBS01',
      tagline:
        known?.tagline ||
        (setName !== code
          ? `${setName} (${code}) — Official Battle Spirits Standard Format expansion.`
          : `${code} — Battle Spirits Standard Format expansion.`),
      featuredCardId: `${code.toLowerCase()}-001`,
      colors: known?.colors || ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  for (let n = 14; n >= 1; n--) {
    const code = `26RSD${String(n).padStart(2, '0')}`;
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || code;
    list.push({
      setCode: code,
      wikiTitle: code,
      category: 'Standard Starter',
      name: setName,
      jpName: '',
      productType: 'Starter Deck',
      releaseDate: wikiMeta?.releaseDate || '2026+',
      formats: ['Standard', 'Eternal'],
      blockLabel: 'Standard Format Starter',
      tagline:
        setName !== code
          ? `${setName} (${code}) — Pre-constructed Standard Format starter deck.`
          : `${code} — Pre-constructed Standard Format starter deck.`,
      featuredCardId: `${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  // 2. Main Booster Sets BS77 down to BS01
  for (let n = 77; n >= 1; n--) {
    const code = `BS${String(n).padStart(2, '0')}`;
    const known = KNOWN_SET_META[code];
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || known?.name || code;
    list.push({
      setCode: code,
      wikiTitle: code,
      category: 'Booster',
      name: setName,
      jpName: '',
      productType: 'Booster Set',
      releaseDate: known?.releaseDate || wikiMeta?.releaseDate || (n >= 76 ? '2026' : n >= 68 ? '2024–2026' : 'Eternal Era'),
      formats: ['Eternal'],
      blockLabel: n >= 76 ? 'Eternal Booster' : 'Eternal Format (BS01–BS75)',
      isLatestEternal: code === 'BS77',
      tagline:
        known?.tagline ||
        (setName !== code
          ? `${setName} (${code}) — Main Booster expansion synced from Battle Spirits Wiki.`
          : `${code} — Main Booster expansion synced from Battle Spirits Wiki.`),
      featuredCardId: `${code.toLowerCase()}-001`,
      colors: known?.colors || ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  // 3. Starter & Mega Decks SD70 down to SD01
  for (let n = 70; n >= 1; n--) {
    const code = `SD${String(n).padStart(2, '0')}`;
    const known = KNOWN_SET_META[code];
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || known?.name || code;
    list.push({
      setCode: code,
      wikiTitle: code,
      category: 'Starter Deck',
      name: setName,
      jpName: '',
      productType: setName.toLowerCase().includes('mega') ? 'Mega Deck' : 'Starter Deck',
      releaseDate: known?.releaseDate || wikiMeta?.releaseDate || 'Eternal Era',
      formats: ['Eternal'],
      blockLabel: 'Eternal Starter / Mega Deck',
      tagline:
        known?.tagline ||
        (setName !== code
          ? `${setName} (${code}) — Pre-constructed Deck synced from Battle Spirits Wiki.`
          : `${code} — Pre-constructed Deck synced from Battle Spirits Wiki.`),
      featuredCardId: `${code.toLowerCase()}-001`,
      colors: known?.colors || ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  // 4. Collab Boosters CB34 down to CB01 + CBX01
  {
    const cbxCode = 'CBX01';
    const cbxMeta = WIKI_SET_METADATA[cbxCode];
    const cbxName = cbxMeta?.name || cbxCode;
    list.push({
      setCode: cbxCode,
      wikiTitle: cbxMeta?.wikiTitle || cbxCode,
      category: 'Collab Booster',
      name: cbxName,
      jpName: '',
      productType: 'Collab Booster',
      releaseDate: cbxMeta?.releaseDate || 'Feb 2024',
      formats: ['Eternal'],
      blockLabel: 'Collab Booster EX',
      tagline:
        cbxName !== cbxCode
          ? `${cbxName} (${cbxCode}) — Extra Collaboration Booster synced from Battle Spirits Wiki.`
          : `${cbxCode} — Extra Collaboration Booster synced from Battle Spirits Wiki.`,
      featuredCardId: 'cbx01-cbx01-001',
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(cbxCode)}`,
    });
  }
  for (let n = 34; n >= 1; n--) {
    const code = `CB${String(n).padStart(2, '0')}`;
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || code;
    list.push({
      setCode: code,
      wikiTitle: wikiMeta?.wikiTitle || code,
      category: 'Collab Booster',
      name: setName,
      jpName: '',
      productType: 'Collab Booster',
      releaseDate: wikiMeta?.releaseDate || 'Eternal Era',
      formats: ['Eternal'],
      blockLabel: 'Collab Booster (CB01–CB34)',
      tagline:
        setName !== code
          ? `${setName} (${code}) — Collaboration Booster synced from Battle Spirits Wiki.`
          : `${code} — Collaboration Booster synced from Battle Spirits Wiki.`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  // 5. Supplementary Sets BSC51 down to BSC01
  for (let n = 51; n >= 1; n--) {
    const code = `BSC${String(n).padStart(2, '0')}`;
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || code;
    list.push({
      setCode: code,
      wikiTitle: wikiMeta?.wikiTitle || code,
      category: 'Supplementary',
      name: setName,
      jpName: '',
      productType: 'Supplementary Set',
      releaseDate: wikiMeta?.releaseDate || 'Eternal Era',
      formats: ['Eternal'],
      blockLabel: 'Supplementary Set (BSC01–BSC51)',
      tagline:
        setName !== code
          ? `${setName} (${code}) — Supplementary / Diva / X-Rare expansion synced from Battle Spirits Wiki.`
          : `${code} — Supplementary / Diva / X-Rare expansion synced from Battle Spirits Wiki.`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  // 6. Premium Bandai Sets PB50 down to PB01
  for (let n = 50; n >= 1; n--) {
    const code = `PB${String(n).padStart(2, '0')}`;
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || code;
    const wikiTitle = wikiMeta?.wikiTitle || code;
    list.push({
      setCode: code,
      wikiTitle,
      category: 'Premium Bandai',
      name: setName,
      jpName: '',
      productType: 'Premium Bandai',
      releaseDate: wikiMeta?.releaseDate || 'Premium Bandai',
      formats: ['Eternal'],
      blockLabel: 'Premium Bandai (PB01–PB50)',
      tagline:
        setName !== code
          ? `${setName} (${code}) — Premium Bandai limited edition release.`
          : `${code} — Premium Bandai catalog code (no separate Wiki release title listed).`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(wikiTitle)}`,
    });
  }

  // 7. Premium Card Sets PC12 down to PC01
  for (let n = 12; n >= 1; n--) {
    const code = `PC${String(n).padStart(2, '0')}`;
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || code;
    list.push({
      setCode: code,
      wikiTitle: wikiMeta?.wikiTitle || code,
      category: 'Premium Card Set',
      name: setName,
      jpName: '',
      productType: 'Premium Card Set',
      releaseDate: wikiMeta?.releaseDate || 'Premium Card Set',
      formats: ['Eternal'],
      blockLabel: 'Premium Card Set (PC01–PC12)',
      tagline:
        setName !== code
          ? `${setName} (${code}) — Retail Premium Card Set synced from Battle Spirits Wiki.`
          : `${code} — Retail Premium Card Set synced from Battle Spirits Wiki.`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  // 8. Token Cards Collection (Platinum Bug, Rig Avatar Dragon, Swordish, Fungal Bed, etc.)
  list.push({
    setCode: 'TOKENS',
    wikiTitle: 'TOKENS',
    category: 'Token',
    name: 'Official Token Cards (Spirits & Nexuses)',
    jpName: 'トークンカード',
    productType: 'Token Set',
    releaseDate: '2025–2026+',
    formats: ['Standard', 'Eternal'],
    blockLabel: 'Token Cards',
    tagline: 'All Battle Spirits Token Spirits and Token Nexuses (Rig Avatar Dragon, Platinum Bug, Fungal Bed, Swordish).',
    featuredCardId: 'sd69-t001',
    colors: ALL_COLORS,
    totalCardsInSet: 4,
    wikiUrl: `${WIKI_BASE}Token_Cards`,
  });

  // 8b. Complete Revival Cards Collection (Category:Revival Cards + Revival tabber cards)
  list.push({
    setCode: 'REVIVAL',
    wikiTitle: 'REVIVAL',
    category: 'Revival',
    name: 'All Revival Cards (BSC22, BS35–BS77, SD & Promos)',
    jpName: 'リバイバルカード',
    productType: 'Revival Set',
    releaseDate: '2015–2026+',
    formats: ['Eternal'],
    blockLabel: 'Revival Cards',
    tagline: 'Complete Battle Spirits Revival collection synced from Battle Spirits Wiki (BSC22, BS35–BS77 RV, SD & Promo Revivals).',
    featuredCardId: 'revival-blizzard-wall',
    colors: ALL_COLORS,
    totalCardsInSet: 727,
    wikiUrl: `${WIKI_BASE}Category:Revival_Cards`,
  });

  // 9. All Promotional Card Pages
  for (const promo of PROMO_PAGES) {
    list.push({
      setCode: promo.setCode,
      wikiTitle: promo.wikiTitle,
      category: 'Promo',
      name: promo.name,
      jpName: '',
      productType: 'Promo Set',
      releaseDate: promo.releaseDate,
      formats: promo.formats,
      blockLabel: promo.formats.includes('Standard') ? 'Standard Promo' : 'Eternal Promo',
      tagline: promo.tagline,
      featuredCardId: `${promo.setCode.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(promo.wikiTitle.replace(/ /g, '_'))}`,
    });
  }

  return list;
}

const DIRECTORY_MAP = new Map<string, ProductSet>();
const storedSetTokens = new Map<string, string[]>();
let storedSetListCache: ProductSet[] = [];
let setRegistrySyncedAt = Date.now();
let seededFromCardsJson = false;

const SERVER_GENERIC_NAME_RE =
  /^(?:Booster Set |Starter \/ Mega Deck |Standard (?:Booster|Entry \/ Starter Deck) |Collab Booster |Supplementary Set |Premium (?:Bandai Set|Card Set) )/i;
const SERVER_GENERIC_DATE_RE =
  /^(?:Legacy Era|Original Set|Original Starter|Eternal Era|Premium Bandai|Premium Card Set|2026\+|Official Release|All Eras)$/i;

function buildServerSetSearchTokens(set: ProductSet): string[] {
  const tokens = new Set<string>();
  const add = (val: string) => {
    const clean = val.trim().toLowerCase();
    if (clean) tokens.add(clean);
  };
  const codeLower = (set.setCode || '').trim().toLowerCase();
  const codeCompact = codeLower.replace(/[\s-]+/g, '');
  add(codeLower);
  add(codeCompact);

  const alphaNumMatch = codeCompact.match(/^([a-z]+?)(\d+)([a-z]*)$/i);
  if (alphaNumMatch) {
    const [, prefix, digits, suffix] = alphaNumMatch;
    add(`${prefix} ${digits}${suffix}`);
    add(`${prefix}-${digits}${suffix}`);
    add(digits);
    const unpadded = String(Number(digits));
    if (unpadded && unpadded !== 'NaN') {
      add(unpadded);
      add(`${prefix}${unpadded}${suffix}`);
    }
  } else if (/^\d+$/.test(codeCompact)) {
    const unpadded = String(Number(codeCompact));
    add(unpadded);
    add(codeCompact.padStart(2, '0'));
  }

  const nameLower = (set.name || '').trim().toLowerCase();
  if (nameLower) {
    add(nameLower);
    add(nameLower.replace(/[\s-]+/g, ''));
    if (/^\d+$/.test(nameLower)) {
      add(String(Number(nameLower)));
      add(nameLower.padStart(2, '0'));
    }
  }

  if (set.jpName) add(set.jpName);
  if (set.wikiTitle) add(set.wikiTitle);
  return Array.from(tokens);
}

function mergeStoredSetRecord(existing: ProductSet | undefined, incoming: ProductSet): ProductSet {
  if (!existing) {
    const code = incoming.setCode.trim().toUpperCase();
    return {
      ...incoming,
      setCode: code,
      name: (incoming.name || code).trim(),
      jpName: incoming.jpName || '',
      colors: Array.isArray(incoming.colors) && incoming.colors.length > 0 ? incoming.colors : ALL_COLORS,
      formats: Array.isArray(incoming.formats) && incoming.formats.length > 0 ? incoming.formats : ['Eternal'],
      totalCardsInSet: Number(incoming.totalCardsInSet) || 0,
    };
  }
  const code = (incoming.setCode || existing.setCode).trim().toUpperCase();
  const isPlaceholder = (n?: string) => {
    const clean = (n || '').trim();
    return !clean || clean.toUpperCase() === code || SERVER_GENERIC_NAME_RE.test(clean);
  };
  const nextName = !isPlaceholder(incoming.name)
    ? incoming.name.trim()
    : !isPlaceholder(existing.name)
    ? existing.name.trim()
    : (incoming.name || existing.name || code).trim();

  const incomingDateSpecific = Boolean(
    incoming.releaseDate && !SERVER_GENERIC_DATE_RE.test(incoming.releaseDate.trim())
  );
  const existingDateSpecific = Boolean(
    existing.releaseDate && !SERVER_GENERIC_DATE_RE.test(existing.releaseDate.trim())
  );
  const nextDate = incomingDateSpecific
    ? incoming.releaseDate
    : existingDateSpecific
    ? existing.releaseDate
    : incoming.releaseDate || existing.releaseDate;

  const nextTagline =
    (existing.tagline || '').length > (incoming.tagline || '').length &&
    existing.tagline &&
    !existing.tagline.includes('(no separate Wiki release title listed)')
      ? existing.tagline
      : incoming.tagline || existing.tagline;

  return {
    ...existing,
    ...incoming,
    setCode: code,
    name: nextName,
    jpName: incoming.jpName || existing.jpName || '',
    releaseDate: nextDate,
    tagline: nextTagline,
    formats: Array.from(new Set([...(existing.formats || []), ...(incoming.formats || [])])),
    colors:
      existing.colors && existing.colors.length > 0 && existing.colors.length < 6
        ? existing.colors
        : incoming.colors && incoming.colors.length > 0
        ? incoming.colors
        : existing.colors,
    totalCardsInSet: Math.max(Number(existing.totalCardsInSet) || 0, Number(incoming.totalCardsInSet) || 0),
    featuredCardId: existing.featuredCardId || incoming.featuredCardId,
    wikiTitle: incoming.wikiTitle || existing.wikiTitle || code,
    wikiUrl: existing.wikiUrl || incoming.wikiUrl || `${WIKI_BASE}${encodeURIComponent(code)}`,
  };
}

function upsertStoredSetMetadata(incoming: ProductSet): ProductSet {
  const code = (incoming.setCode || '').trim().toUpperCase();
  if (!code || code === 'BSS01') return incoming;
  const merged = mergeStoredSetRecord(DIRECTORY_MAP.get(code), incoming);
  DIRECTORY_MAP.set(code, merged);
  storedSetTokens.set(code, buildServerSetSearchTokens(merged));
  storedSetListCache = Array.from(DIRECTORY_MAP.values());
  setRegistrySyncedAt = Date.now();
  return merged;
}

function ensureStoredSetRegistryHydrated() {
  if (DIRECTORY_MAP.size === 0) {
    for (const entry of buildWikiDirectory()) {
      const code = entry.setCode.toUpperCase();
      DIRECTORY_MAP.set(code, entry);
      storedSetTokens.set(code, buildServerSetSearchTokens(entry));
    }
    storedSetListCache = Array.from(DIRECTORY_MAP.values());
  }

  if (!seededFromCardsJson) {
    seededFromCardsJson = true;
    try {
      const cardsJsonPath = path.resolve(process.cwd(), 'public', 'cards.json');
      if (fs.existsSync(cardsJsonPath)) {
        const raw = JSON.parse(fs.readFileSync(cardsJsonPath, 'utf8')) as {
          sets?: ProductSet[];
          cards?: BattleSpiritsCard[];
        };
        if (Array.isArray(raw.sets)) {
          for (const s of raw.sets) {
            if (s && s.setCode) upsertStoredSetMetadata(s);
          }
        }
        if (Array.isArray(raw.cards)) {
          const stats = new Map<string, { count: number; sample: BattleSpiritsCard; colors: Set<CardColor> }>();
          for (const c of raw.cards) {
            const sc = (c.setCode || '').trim().toUpperCase();
            if (!sc || sc === 'BSS01') continue;
            let st = stats.get(sc);
            if (!st) {
              st = { count: 0, sample: c, colors: new Set<CardColor>() };
              stats.set(sc, st);
            }
            st.count++;
            for (const col of c.colors && c.colors.length ? c.colors : [c.color]) {
              if (col) st.colors.add(col);
            }
          }
          for (const [sc, st] of stats.entries()) {
            const sample = st.sample;
            const colors = Array.from(st.colors);
            const isStd = Array.isArray(sample.formats) && sample.formats.includes('Standard');
            upsertStoredSetMetadata({
              setCode: sc,
              wikiTitle: sc,
              category: /^\d+$/.test(sc) ? (isStd ? 'Standard Booster' : 'Booster') : 'Promo',
              name: sample.setName && !SERVER_GENERIC_NAME_RE.test(sample.setName) ? sample.setName : sc,
              jpName: '',
              productType: /^\d+$/.test(sc) ? 'Booster Set' : 'Promo Set',
              releaseDate: isStd ? '2026+' : 'Official Release',
              formats: sample.formats?.length ? sample.formats : ['Eternal'],
              blockLabel: sample.blockIcon || 'Eternal',
              tagline: `${sc} — Battle Spirits set.`,
              featuredCardId: sample.id,
              colors: colors.length > 0 ? colors : [sample.color || 'Red'],
              totalCardsInSet: st.count,
              wikiUrl: `${WIKI_BASE}${encodeURIComponent(sc)}`,
            });
          }
        }
      }
    } catch {
      // ignore missing/unreadable cards.json; directory remains intact
    }
  }
}

export function getSyncedWikiDirectory(): { sets: ProductSet[]; syncedAt: number } {
  ensureStoredSetRegistryHydrated();
  return {
    sets: storedSetListCache,
    syncedAt: setRegistrySyncedAt,
  };
}

ensureStoredSetRegistryHydrated();

const TK_TEXT_MAP: Record<string, string> = {
  GWrule:
    'This Nexus can only be affected by effects that specify "Grandwalker Nexus". Cores can only be placed onto this Nexus via [Core Charge] or effects that specify "Grandwalker Nexus", also, cores on this Nexus can\'t be affected or moved except by effects that specify "Grandwalker Nexus".',
  GSTrule:
    'This Nexus can only be affected by effects that specify "Grandstone Nexus". Cores can only be placed on this Nexus through the effect of [Release] or effects that specify "Grandstone Nexus", also, cores on this Nexus can\'t be affected or moved except by effects that specify "Grandstone Nexus".',
  GPGWrule:
    'This Nexus/Spirit can only be affected by effects that specify "Grandwalker Nexus". Cores can only be placed onto this Nexus/Spirit via [Core Charge] or effects that specify "Grandwalker Nexus", also, cores on this Nexus/Spirit can\'t be affected or moved except by effects that specify "Grandwalker Nexus".',
  CArule:
    'While this card is in Soul State, you can [Contract Advent] onto it. When you do, you can put any number of cores from your Field/Reserve to the adventing card.',
  BCArule:
    'While this card is in Soul State/pre-advent condition, you can [Contract Advent] onto it. When you do, you can put any number of cores from your Field/Reserve to the adventing card.',
  BUDrule:
    'You can [Contract Advent] one of each target on the left and right of this card. This pre-advent card turns into refreshed state, and won\'t exhaust.',
  FArule:
    'This card/Nexus\' effects are unaffected by opposing effects, and you can [Flag Contract Advent] onto this Nexus, including when it\'s in Soul State, putting any number of cores from your Field/Reserve to it.',
  utb: '(Ultimate Trigger: Send a card from the opposing decktop to the Trash. If that card\'s cost is lower than this Ultimate\'s, it\'s a hit.)',
  wutb: '(Double Ultimate Trigger: Send two cards from the opposing decktop to the Trash. If each of those cards\' cost is lower than this Ultimate\'s, it\'s a hit.)',
  tutb: '(Triple Ultimate Trigger: Send three cards from the opposing decktop to the Trash. If each of those cards\' cost is lower than this Ultimate\'s, it\'s a hit.)',
  qutb: '(Quadruple Ultimate Trigger: Send four cards from the opposing decktop to the Trash. If each of those cards\' cost is lower than this Ultimate\'s, it\'s a hit.)',
  outb: '(Octa Ultimate Trigger: Send eight cards from the opposing decktop to the Trash. If each of those cards\' cost is lower than this Ultimate\'s, it\'s a hit.)',
  xutb: '(Ultimate Trigger/Cross Ultimate Trigger: Send a card from the opposing decktop to the Trash. If that card\'s cost is lower than this Ultimate\'s, it\'s a hit.)',
  cutb: '(Count Ultimate Trigger: Send a card from the opposing decktop to the Trash. If that card\'s cost is lower than the number of your counters, it\'s a hit.)',
  dcutb: '(Double Count Ultimate Trigger: Send two cards from the opposing decktop to the Trash. If the cards\' cost is lower than the number of your counters, it\'s a hit.)',
  heb: '(Heavily exhausted cards are turned upside down and become exhausted after refreshing once.)',
  rtp: '[Return to Prime]\nWhen this Spirit would leave the Field by opposing effects, you can flip and deploy it.',
  'S Un': '[Soul Unleash: [Soul Core]]',
  '+0': '(When you flip into this side, this card remains on the Field, and you gain no counters.)',
  '+1': '(When you flip into this side, this card remains on the Field, and your counter +1.)',
  'n+1': '(When you flip into this side, this card remains on the Field, and your counter +1.)',
  Rebirth: '[Rebirth]',
  Rebirth3: '[Rebirth: 3 or less Counters] (Only one Rebirth can be used at a time)',
  Rebirth5: '[Rebirth: 5 or less Counters] (Only one Rebirth can be used at a time)',
  Rebirth6: '[Rebirth: 6 or less Counters] (Only one Rebirth can be used at a time)',
  Rebirth1m: '[Rebirth: 1 or more Counters] (Only one Rebirth can be used at a time)',
  Rebirth2m: '[Rebirth: 2 or more Counters] (Only one Rebirth can be used at a time)',
  Rebirth3m: '[Rebirth: 3 or more Counters] (Only one Rebirth can be used at a time)',
  Rebirth4m: '[Rebirth: 4 or more Counters] (Only one Rebirth can be used at a time)',
  Rebirth6m: '[Rebirth: 6 or more Counters] (Only one Rebirth can be used at a time)',
  Rebirth7m: '[Rebirth: 7 or more Counters] (Only one Rebirth can be used at a time)',
  Rebirth4life: '[Rebirth: 4 Life or less] (Only one Rebirth can be used at a time)',
  Rebirth2life: '[Rebirth: 2 Life or more] (Only one Rebirth can be used at a time)',
  '0Rebirth': '[Zero Rebirth]',
  'Zero Rebirth': '[Zero Rebirth: 0 Counters] (Only one Rebirth can be used at a time)',
  zc: '[Zero Counter]\nWhen the opponent summons a Spirit/Brave without paying the cost, besides via a Burst effect, you can immediately use the following effect of this card from the Hand without paying the cost.',
  manis: 'manifests',
  manid: 'manifested',
  Mani: '[Manifest]',
  UMani: '[Ultra Manifest]',
  advents: 'advents',
  advented: 'advented',
  adventing: 'adventing',
  'Main Phase': '(Your Main Phase)',
  'Flash Step': '(Flash Step)',
};

function stripWikiNoise(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^/]*\/>/gi, '');
}

function normalizeColor(raw: string): CardColor[] {
  const cleaned = stripWikiNoise(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{|\}\}/g, ' ');
  const lower = cleaned.toLowerCase();
  if (/\b(all|omni|rainbow)\b/.test(lower) || /6[\s-]*colors?/.test(lower)) {
    return [...ALL_COLORS];
  }

  const found: CardColor[] = [];
  const regex = /\b(Red|Purple|White|Yellow|Green|Blue)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    const c = ALL_COLORS.find((col) => col.toLowerCase() === match![1].toLowerCase());
    if (c && !found.includes(c)) {
      found.push(c);
    }
  }
  return found.length > 0 ? found : ['Red'];
}

function normalizeType(raw: string): { type: CardType; subtypeLabel?: string } {
  const cleaned = cleanWikitextInline(stripWikiNoise(raw))
    .replace(/\s+/g, ' ')
    .trim();
  const primarySegment = cleaned.split('/')[0]?.trim() || cleaned;
  const lowerPrimary = primarySegment.toLowerCase();
  const lowerFull = cleaned.toLowerCase();

  let type: CardType = 'Spirit';
  if (/\bultimate\b/.test(lowerPrimary)) type = 'Ultimate';
  else if (/\bnexus\b/.test(lowerPrimary)) type = 'Nexus';
  else if (/\bmagic\b/.test(lowerPrimary)) type = 'Magic';
  else if (/\bbrave\b/.test(lowerPrimary)) type = 'Brave';
  else if (/\bspirit\b/.test(lowerPrimary)) type = 'Spirit';
  else if (/\bultimate\b/.test(lowerFull)) type = 'Ultimate';
  else if (/\bnexus\b/.test(lowerFull)) type = 'Nexus';
  else if (/\bmagic\b/.test(lowerFull)) type = 'Magic';
  else if (/\bbrave\b/.test(lowerFull)) type = 'Brave';

  const subtypeLabel =
    cleaned &&
    cleaned.toLowerCase() !== type.toLowerCase() &&
    cleaned.length <= 40 &&
    !/^(?:common|rare|uncommon|promo)$/i.test(cleaned)
      ? cleaned
      : undefined;

  return { type, subtypeLabel };
}

function normalizeRarity(raw: string): CardRarity {
  const cleaned = cleanWikitextInline(stripWikiNoise(raw)).trim();
  const lower = cleaned.toLowerCase();
  if (lower.includes('contract x') || lower === 'cx' || lower === 'cx-rare') return 'CX';
  if (lower.includes('ax')) return 'AX';
  if (lower.includes('nx')) return 'NX';
  if (lower.includes('tx')) return 'TX';
  if (lower.includes('xv')) return 'XV';
  if (lower.includes('xx')) return 'XX';
  if (lower === 'x' || lower.includes('x-rare')) return 'X';
  if (lower === 'm' || lower.includes('master')) return 'M';
  if (lower === 'r' || lower === 'rare' || lower.includes('rebirth rare')) return 'R';
  if (lower === 'u' || lower.includes('uncommon')) return 'U';
  if (lower.includes('promo') || lower === 'p' || lower.includes('campaign') || lower === 'cp') return 'P';
  return 'C';
}

function defaultVariant(type: CardType, color: CardColor): BattleSpiritsCard['artVariant'] {
  if (type === 'Magic') return 'magic';
  if (type === 'Nexus') return 'nexus';
  if (type === 'Brave') return 'brave';
  switch (color) {
    case 'Red':
      return 'dragon';
    case 'Purple':
      return 'phantom';
    case 'White':
      return 'mecha';
    case 'Yellow':
      return 'seraph';
    case 'Green':
      return 'beast';
    case 'Blue':
      return 'titan';
  }
}

function extractTabberSegment(raw: string, wantRevival: boolean): string {
  const replaceTagTabber = raw.replace(
    /\{\{#tag:tabber\|([\s\S]*?)\}\}/gi,
    (_m, inner: string) => `<tabber>${inner.replace(/\{\{!\}\}-\{\{!\}\}/g, '|-|')}</tabber>`
  );
  return replaceTagTabber.replace(
    /<tabber>([\s\S]*?)<\/tabber>/gi,
    (_m, inner: string) => {
      const parts = inner.split(/\|-\|/);
      const segments = parts
        .map((part) => {
          const eq = part.indexOf('=');
          if (eq === -1) return null;
          const label = part.slice(0, eq).trim();
          const body = part.slice(eq + 1).trim();
          return { label, body };
        })
        .filter((s): s is { label: string; body: string } => Boolean(s));

      if (segments.length === 0) return inner;
      const picked = wantRevival
        ? segments.find((s) => /\brevival\b/i.test(s.label) && !/non[-\s]?revival/i.test(s.label)) ||
          segments[segments.length - 1]
        : segments.find((s) => !/\brevival\b/i.test(s.label) || /non[-\s]?revival/i.test(s.label)) ||
          segments[0];
      return picked ? picked.body : inner;
    }
  );
}

function cleanWikitextInline(raw: string): string {
  let out = extractTabberSegment(stripWikiNoise(raw), false)
    .replace(/\u00A0/g, ' ')
    .replace(/\{\{!\}\}/g, '|')
    .replace(/\{\{Nihongo\|([^|}]+)\|[^}]*\}\}/gi, '$1')
    .replace(/\{\{ruby\|([^|}]+)\|[^}]*\}\}/gi, '$1')
    .replace(/\[\[(?:File|Image):Soul[\s_]+Core\.png[^\]]*\]\]/gi, '[Soul Core]')
    .replace(
      /\[\[(?:File|Image):God[\s_]+(?:EX[\s_]+)?(?:symbol|core|gem)\.png[^\]]*\]\]/gi,
      '[God]'
    )
    .replace(
      /\[\[(?:File|Image):(?:Gold|Ultimate)[\s_]+(?:EX[\s_]+)?(?:symbol|core|gem)\.png[^\]]*\]\]/gi,
      '[Ultimate]'
    )
    .replace(
      /\[\[(?:File|Image):([A-Za-z]+)(?:[\s_]+(?:EX[\s_]+)?(?:symbol|core|gem))\.png[^\]]*\]\]/gi,
      '[$1]'
    )
    .replace(/\[\[(?:File|Image):[^\]]+\]\]/gi, '')
    .replace(/\{\{gp\|([^}]+)\}\}/gi, '[Grandphosis: $1]')
    .replace(/\{\{SuAdcon\|([^}]+)\}\}/gi, (_m, p1: string) => `[Summon/Advent Condition: ${p1.trim()}]`)
    .replace(/\{\{Sumcon\|([^}]+)\}\}/gi, (_m, p1: string) => `[Summon Condition: ${p1.trim()}]`)
    .replace(/\{\{Adcon\|([^}]+)\}\}/gi, (_m, p1: string) => `[Advent Condition: ${p1.trim()}]`)
    .replace(/\{\{(?:Brcon|Bravecon)\|([^}]+)\}\}/gi, (_m, p1: string) => `[Brave Condition: ${p1.trim()}]`)
    .replace(/\{\{Mirage\|([^}]+)\}\}/gi, '[Mirage: $1]')
    .replace(/\{\{Seal\|([^}]+)\}\}/gi, '[$1]')
    .replace(/\{\{Unleash\|([^|}]+)(?:\|([^}]+))?\}\}/gi, (_m, p1: string, p2?: string) =>
      p2 ? `[${p2.trim()} Unleash: ${p1.trim()}]` : `[Unleash: ${p1.trim()}]`
    )
    .replace(
      /\{\{Advent2\|([^|}]+)\|([^|}]+)(?:\|([^}]+))?\}\}/gi,
      (_m, kind: string, p1: string, p2?: string) =>
        p2 ? `[${kind.trim()}: ${p1.trim()} (${p2.trim()})]` : `[${kind.trim()}: ${p1.trim()}]`
    )
    .replace(/\{\{Advent\|([^|}]+)(?:\|([^}]+))?\}\}/gi, (_m, p1: string, p2?: string) =>
      p2 ? `[Advent: ${p1.trim()} ${p2.trim()}]` : `[Advent: ${p1.trim()}]`
    )
    .replace(
      /\{\{(Grand Advent|Ultra Advent|Flag Contract Advent|Contract Advent|Seal Flag Contract Advent|Ultra Contract Advent|Final Contract Advent|DK Grand Advent|Reverse Contract Advent|SF Advent|Transcendent Advent|Contract)\|([^|}]+)(?:\|([^}]+))?\}\}/gi,
      (_m, kind: string, p1: string, p2?: string) =>
        p2 ? `[${kind}: ${p1.trim()} (${p2.trim()})]` : `[${kind}: ${p1.trim()}]`
    )
    .replace(/\{\{ST\|([^|}]+)(?:\|[^}]*)?\}\}/gi, '($1)')
    .replace(/\{\{All\}\}/gi, 'All Colors')
    .replace(/\{\{(Red|Purple|White|Yellow|Green|Blue)\}\}/gi, '$1')
    .replace(/\{\{tk\|([^}]+)\}\}/gi, (_m, inner: string) => {
      const parts = inner.split('|').map((p) => p.trim());
      const key = parts[0] || '';
      const p2 = parts[1] || '';
      const p3 = parts[2] || '';

      if (key === 'uhand') {
        return `[Ultimate Hand${p2 ? `: ${p2}` : ''}${p3 ? ` ${p3}` : ''}]`;
      }
      if (key === 'uhand all') {
        return `[Ultimate Hand: All${p2 ? ` ${p2}` : ''}]`;
      }
      if (key === 'deh') {
        return `[Dark Esoterica${p2 ? ` - ${p2}` : ''}]`;
      }
      if (key === 'team' || key === 'teams') {
        const list = parts.slice(1).filter(Boolean).join('/');
        return `[${key === 'teams' ? 'Teams' : 'Team'}${list ? `: ${list}` : ''}]`;
      }
      if (key === 'Core Charge:' || key === 'Neo-Core Charge:' || key === 'Release:') {
        const baseLabel = key.slice(0, -1);
        return p2 ? `[${baseLabel}: ${p2}]` : `[${baseLabel}]`;
      }
      if (TK_TEXT_MAP[key]) {
        return TK_TEXT_MAP[key];
      }
      if (p2) {
        return `[${key}] ${p2}`;
      }
      return `[${key}]`;
    })
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{([^}]+)\}\}/g, (_m, inner: string) =>
      inner
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
    );

  out = out
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}

function parseTemplateFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const chunks: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let tabberDepth = 0;
  let current = '';

  for (let i = 0; i < block.length; i++) {
    const two = block.slice(i, i + 2);
    if (two === '{{') {
      braceDepth++;
      current += '{{';
      i++;
      continue;
    }
    if (two === '}}') {
      braceDepth = Math.max(0, braceDepth - 1);
      if (braceDepth === 0) {
        chunks.push(current);
        current = '';
        break;
      }
      current += '}}';
      i++;
      continue;
    }
    if (two === '[[') {
      bracketDepth++;
      current += '[[';
      i++;
      continue;
    }
    if (two === ']]') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ']]';
      i++;
      continue;
    }
    if (block[i] === '<') {
      const slice9 = block.slice(i, i + 9).toLowerCase();
      if (slice9.startsWith('<tabber>') || slice9.startsWith('<tabber ')) {
        tabberDepth++;
      } else if (block.slice(i, i + 9).toLowerCase() === '</tabber>') {
        tabberDepth = Math.max(0, tabberDepth - 1);
      }
    }
    if (
      block[i] === '|' &&
      braceDepth === 1 &&
      bracketDepth === 0 &&
      tabberDepth === 0
    ) {
      chunks.push(current);
      current = '';
      continue;
    }
    current += block[i];
  }
  if (current.trim()) chunks.push(current);

  for (const chunk of chunks) {
    const eqIdx = chunk.indexOf('=');
    if (eqIdx === -1) continue;
    const key = chunk.slice(0, eqIdx).trim().toLowerCase();
    const val = chunk.slice(eqIdx + 1).trim();
    if (key && !(key in fields)) {
      fields[key] = val;
    }
  }
  return fields;
}

function extractTemplateField(block: string, field: string): string {
  const parsed = parseTemplateFields(block);
  return parsed[field.toLowerCase()] || '';
}

function parseColorCounts(raw: string): Partial<Record<BattleSymbolKind, number>> {
  const counts: Partial<Record<BattleSymbolKind, number>> = {};
  const cleaned = stripWikiNoise(raw).replace(/\u00A0/g, ' ');
  if (!cleaned || cleaned.trim() === '-' || cleaned.trim().toLowerCase() === 'none') {
    return counts;
  }

  const fileMatches = [
    ...cleaned.matchAll(
      /([A-Za-z]+)(?:[\s_]+(?:EX[\s_]+)?(?:symbol|core|gem))\.png/gi
    ),
  ];
  for (const m of fileMatches) {
    const token = m[1].toLowerCase();
    if (token === 'soul') continue;
    if (token === 'all' || token === 'omni' || token === 'rainbow') {
      for (const c of ALL_COLORS) {
        counts[c] = (counts[c] || 0) + 1;
      }
      continue;
    }
    if (token === 'god') {
      counts.God = (counts.God || 0) + 1;
      continue;
    }
    if (token === 'gold' || token === 'ultimate') {
      counts.Ultimate = (counts.Ultimate || 0) + 1;
      continue;
    }
    const colorName = ALL_COLORS.find((c) => c.toLowerCase() === token);
    if (colorName) {
      counts[colorName] = (counts[colorName] || 0) + 1;
    }
  }

  if (Object.keys(counts).length === 0) {
    const tmplMatches = [
      ...cleaned.matchAll(/\{\{(Red|Purple|White|Yellow|Green|Blue|God|Ultimate|Gold|All)\}\}/gi),
    ];
    for (const m of tmplMatches) {
      const token = m[1].toLowerCase();
      if (token === 'all') {
        for (const c of ALL_COLORS) counts[c] = (counts[c] || 0) + 1;
      } else if (token === 'god') {
        counts.God = (counts.God || 0) + 1;
      } else if (token === 'gold' || token === 'ultimate') {
        counts.Ultimate = (counts.Ultimate || 0) + 1;
      } else {
        const colorName = ALL_COLORS.find((c) => c.toLowerCase() === token);
        if (colorName) counts[colorName] = (counts[colorName] || 0) + 1;
      }
    }
  }

  return counts;
}

function parseLevels(raw: string): LevelTier[] | undefined {
  if (!raw) return undefined;
  const cleaned = cleanWikitextInline(raw);
  const tiers: LevelTier[] = [];
  const regex = /Level\s*([1-5])\s*:\s*(\d+)\s*cores?(?:\s*,\s*([\d,]+)\s*BP)?/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    const level = Number(match[1]) as 1 | 2 | 3 | 4 | 5;
    const cores = Number(match[2]);
    const bp = match[3] ? Number(match[3].replace(/,/g, '')) : 0;
    tiers.push({ level, cores, bp });
  }
  return tiers.length > 0 ? tiers : undefined;
}

function parseEffects(rawEffect: string): { timing: string; text: string }[] {
  if (!rawEffect) return [];
  const normalized = cleanWikitextInline(rawEffect);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.map((para) => {
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length >= 2) {
      return {
        timing: lines[0],
        text: lines.slice(1).join(' '),
      };
    }
    return {
      timing: 'Effect',
      text: lines[0] || para,
    };
  });
}

// Card artwork filename validation (`isNonCardWikiIcon` & `isCardArtworkFile`) imported from ./wikiCardLookup.ts

function normalizeImageKey(fileRaw: string): string {
  return fileRaw
    .replace(/^(?:File|Image):/i, '')
    .replace(/\u00A0/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cleanImageFieldValue(raw: string): string {
  let cleaned = stripWikiNoise(raw).replace(/\u00A0/g, ' ').trim();
  const fileLink = cleaned.match(/\[\[(?:File|Image):([^|\]]+)/i);
  if (fileLink) {
    cleaned = fileLink[1].trim();
  }
  return cleaned
    .replace(/^(?:File|Image):/i, '')
    .split('|')[0]
    .trim();
}

function extractGalleryImages(
  wikitext: string,
  primaryFile: string,
  fallbackNumber: string,
  cardName: string,
  pageImages: string[] = [],
  wikiTitle?: string
): CardGalleryImage[] {
  const seen = new Set<string>();
  const images: CardGalleryImage[] = [];
  const titleQuery = wikiTitle ? `&title=${encodeURIComponent(wikiTitle)}` : '';

  const addFile = (fileRaw: string, caption: string) => {
    const file = cleanImageFieldValue(fileRaw);
    if (!isCardArtworkFile(file)) return;
    const normKey = normalizeImageKey(file);
    if (!normKey || seen.has(normKey)) return;
    seen.add(normKey);
    images.push({
      url: `/api/wiki/image?file=${encodeURIComponent(file)}&fallback=${encodeURIComponent(fallbackNumber)}${titleQuery}`,
      caption: caption.replace(/\n+/g, ' ').trim() || `${cardName} — Card Art`,
    });
  };

  if (primaryFile) {
    addFile(primaryFile, `${cardName} — Card Art`);
  }

  // All image fields across ALL CardTable / tabber blocks (Original, Revival, Side A/B, image2, alt, secret)
  const tabMatches = [
    ...wikitext.matchAll(/\|\s*(?:image\d*|image_?b|bimage|art\d*|alt(?:image)?\d*|secret(?:image)?\d*)\s*=\s*([^\n}]+)/gi),
  ];
  tabMatches.forEach((m, idx) => {
    const fname = cleanImageFieldValue(m[1]);
    if (fname && !fname.includes('{{')) {
      addFile(fname, idx === 0 ? `${cardName} — Main Art` : `${cardName} — Alternate / Revival Art`);
    }
  });

  // <gallery>...</gallery> entries (supports Secret, Full Art, Parallel, Revival editions)
  const galleryMatches = [...wikitext.matchAll(/<gallery[^>]*>([\s\S]*?)<\/gallery>/gi)];
  for (const gm of galleryMatches) {
    const lines = gm[1].split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split('|');
      const filePart = (parts[0] || '').trim();
      const captionParts = parts.slice(1).filter((p) => !/^(?:link|alt)=/i.test(p.trim()));
      const captionRaw = captionParts.join(' · ');
      if (filePart && isCardArtworkFile(filePart)) {
        const cleanCap = cleanWikitextInline(captionRaw || 'Alternate / Full Art');
        addFile(filePart, cleanCap || 'Alternate / Full Art');
      }
    }
  }

  // Standalone [[File:...|thumb|...]] or [[Image:...]] gallery thumbnails
  const fileTagMatches = [...wikitext.matchAll(/\[\[(?:File|Image):([^|\]]+)(?:\|([^\]]*))?\]\]/gi)];
  for (const fm of fileTagMatches) {
    const filePart = (fm[1] || '').trim();
    if (!isCardArtworkFile(filePart)) continue;
    const rawOpts = (fm[2] || '')
      .split('|')
      .map((s) => s.trim())
      .filter(
        (s) =>
          s &&
          !/^(?:thumb|thumbnail|frame|frameless|border|left|right|center|none|\d*x?\d+px|upright|link=.*|alt=.*)$/i.test(
            s
          )
      );
    const caption = cleanWikitextInline(rawOpts.join(' · ')) || `${cardName} — Alternate Art`;
    addFile(filePart, caption);
  }

  // MediaWiki prop=images safety net catches uploaded Secret / FA / Campaign art not listed explicitly
  for (const imgTitle of pageImages) {
    if (isCardArtworkFile(imgTitle)) {
      const lowerImg = imgTitle.toLowerCase();
      const cap = lowerImg.includes('secret') || lowerImg.includes('scr')
        ? `${cardName} — Secret / Alt Art`
        : lowerImg.includes('fa') || lowerImg.includes('full')
        ? `${cardName} — Full Art`
        : `${cardName} — Alternate Art`;
      addFile(imgTitle, cap);
    }
  }

  return images;
}

interface TaggedCardBlock {
  label: string;
  isRevival: boolean;
  isSideB: boolean;
  block: string;
  sectionText: string;
}

function extractCardTableBlocks(wikitext: string): string[] {
  return extractTaggedCardTableBlocks(wikitext).map((t) => t.block);
}

function extractTaggedCardTableBlocks(wikitext: string): TaggedCardBlock[] {
  const blocks: TaggedCardBlock[] = [];
  const startRegex = /\{\{CardTable\d*/gi;
  let match: RegExpExecArray | null;
  const rawMatches: { index: number; endIndex: number; block: string }[] = [];

  while ((match = startRegex.exec(wikitext)) !== null) {
    let depth = 0;
    let i = match.index;
    while (i < wikitext.length) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
        depth++;
        i += 2;
      } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
        depth--;
        i += 2;
        if (depth <= 0) {
          rawMatches.push({
            index: match.index,
            endIndex: i,
            block: wikitext.slice(match.index, i),
          });
          break;
        }
      } else {
        i++;
      }
    }
  }

  rawMatches.forEach((item, idx) => {
    const prevEnd = idx > 0 ? rawMatches[idx - 1].endIndex : 0;
    const lookback = wikitext.slice(Math.max(prevEnd, item.index - 400), item.index);
    const nextStart =
      idx + 1 < rawMatches.length ? rawMatches[idx + 1].index : wikitext.length;
    const sectionText = wikitext.slice(item.index, nextStart);

    // Check immediate tabber tab label (`|-| Revival =` or `<tabber>Original =` or `{{!}}-{{!}} Revival =`)
    const tabLabels = [
      ...lookback.matchAll(
        /(?:<tabber>|\|-\||\{\{!\}\}-\{\{!\}\})\s*([^=\n<>{}]{1,60})\s*=/gi
      ),
    ];
    const lastTab = tabLabels[tabLabels.length - 1]?.[1]?.trim() || '';
    const isRevival =
      /\b(?:revival|rv|bsc22)\b/i.test(lastTab) && !/non[-\s]?revival/i.test(lastTab);
    const isSideB = /\b(?:side\s*b|rebirth|reverse|flipped)\b/i.test(lastTab);

    blocks.push({
      label: lastTab || (idx === 0 ? 'Original' : `Variant ${idx + 1}`),
      isRevival,
      isSideB,
      block: item.block,
      sectionText,
    });
  });

  return blocks;
}

function pickBestTaggedCardBlock(
  blocks: TaggedCardBlock[],
  base: BattleSpiritsCard
): TaggedCardBlock | undefined {
  if (blocks.length === 0) return undefined;
  if (blocks.length === 1) return blocks[0];

  const wantsRevival = Boolean(
    base.isRevival ||
      /\(revival\)/i.test(base.name) ||
      /(?:^|-)RV[A-Z0-9]*\d/i.test(base.cardNumber)
  );
  const baseNum = base.cardNumber.toUpperCase().replace(/\s*\([AB]\)\s*$/, '');
  const baseSet = base.setCode.toUpperCase();

  const matchesCardIdentity = (b: TaggedCardBlock): boolean => {
    const fields = parseTemplateFields(b.block);
    const imgVal = cleanImageFieldValue(fields.image || '').toUpperCase();
    if (baseNum && imgVal.includes(baseNum)) return true;
    for (let i = 1; i <= 15; i++) {
      const sVal = cleanWikitextInline(fields[`set${i}`] || '').toUpperCase();
      if (baseSet && sVal === baseSet) return true;
    }
    return false;
  };

  if (wantsRevival) {
    const revivalBlocks = blocks.filter((b) => b.isRevival);
    if (revivalBlocks.length > 0) {
      return revivalBlocks.find(matchesCardIdentity) || revivalBlocks[0];
    }
  } else {
    const nonRevivalBlocks = blocks.filter((b) => !b.isRevival);
    if (nonRevivalBlocks.length > 0) {
      if (/\(B\)$/i.test(base.cardNumber)) {
        const explicitSideB = nonRevivalBlocks.find(
          (b) =>
            b.isSideB ||
            /bimage|image_?b|(?:_b|\sb)\.(?:png|jpe?g|webp)/i.test(b.block)
        );
        if (explicitSideB) return explicitSideB;
        if (nonRevivalBlocks[1]) return nonRevivalBlocks[1];
      }
      return nonRevivalBlocks.find(matchesCardIdentity) || nonRevivalBlocks[0];
    }
  }

  return blocks.find(matchesCardIdentity) || blocks[0];
}

let activeWikiRequests = 0;
const MAX_WIKI_CONCURRENCY = 10;
const wikiWaitQueue: Array<() => void> = [];

async function withWikiSemaphore<T>(task: () => Promise<T>): Promise<T> {
  if (activeWikiRequests >= MAX_WIKI_CONCURRENCY) {
    await new Promise<void>((resolve) => wikiWaitQueue.push(resolve));
  }
  activeWikiRequests++;
  try {
    return await task();
  } finally {
    activeWikiRequests--;
    const next = wikiWaitQueue.shift();
    if (next) next();
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3,
  timeoutMs = 10000
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const retryAfterRaw = res.headers.get('retry-after');
        const retryAfterMs = retryAfterRaw ? Math.min(5000, Math.max(300, Number(retryAfterRaw) * 1000 || 500)) : 350 * 2 ** attempt;
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, retryAfterMs));
          continue;
        }
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Wiki request failed');
}

async function fetchWikiJson(params: Record<string, string>): Promise<Record<string, unknown>> {
  const search = new URLSearchParams({ ...params, format: 'json' });
  return withWikiSemaphore(async () => {
    const res = await fetchWithRetry(`${WIKI_API}?${search.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`Wiki API HTTP ${res.status}`);
    }
    const jsonPromise = res.json() as Promise<Record<string, unknown>>;
    return await Promise.race([
      jsonPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Wiki JSON body timeout')), 12000)
      ),
    ]);
  });
}

interface WikiPageBundle {
  wikitext: string;
  pageImages: string[];
}

const pageBundleCache = new Map<string, CacheEntry<WikiPageBundle>>();

async function batchFetchWikiPages(titles: string[]): Promise<Map<string, WikiPageBundle>> {
  const result = new Map<string, WikiPageBundle>();
  const toFetch: string[] = [];
  const now = Date.now();

  for (const title of titles) {
    const cached = pageBundleCache.get(title);
    if (cached && cached.expiresAt > now) {
      result.set(title, cached.value);
    } else {
      toFetch.push(title);
    }
  }

  const chunks: string[][] = [];
  for (let i = 0; i < toFetch.length; i += 50) {
    chunks.push(toFetch.slice(i, i + 50));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk.length === 0) return;
      try {
        const json = (await fetchWikiJson({
          action: 'query',
          titles: chunk.join('|'),
          prop: 'revisions|images',
          rvprop: 'content',
          rvslots: 'main',
          imlimit: '500',
          redirects: '1',
        })) as {
          query?: {
            normalized?: { from: string; to: string }[];
            redirects?: { from: string; to: string }[];
            pages?: Record<
              string,
              {
                title?: string;
                revisions?: { slots?: { main?: { '*'?: string } } }[];
                images?: { title?: string }[];
              }
            >;
          };
        };

        const pages = json.query?.pages || {};
        const titleToBundle = new Map<string, WikiPageBundle>();
        for (const p of Object.values(pages)) {
          const content = p.revisions?.[0]?.slots?.main?.['*'] || '';
          const imgs = (p.images || [])
            .map((img) => img.title || '')
            .filter(Boolean);
          if (p.title && (content || imgs.length > 0)) {
            titleToBundle.set(p.title, { wikitext: content, pageImages: imgs });
          }
        }

        const redirectMap = new Map<string, string>();
        for (const r of json.query?.redirects || []) {
          redirectMap.set(r.from, r.to);
        }
        const normMap = new Map<string, string>();
        for (const n of json.query?.normalized || []) {
          normMap.set(n.from, n.to);
        }

        for (const origTitle of chunk) {
          const normalized = normMap.get(origTitle) || origTitle;
          const finalTitle = redirectMap.get(normalized) || normalized;
          const bundle =
            titleToBundle.get(finalTitle) || titleToBundle.get(normalized);
          if (bundle && bundle.wikitext) {
            result.set(origTitle, bundle);
            pageBundleCache.set(origTitle, {
              value: bundle,
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
            cardWikitextCache.set(origTitle, {
              value: bundle.wikitext,
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
          }
        }
      } catch {
        // tolerate individual chunk error cleanly
      }
    })
  );

  return result;
}

export function hydrateCardFromWikitext(
  base: BattleSpiritsCard,
  wikitext: string,
  pageImages: string[] = [],
  forcedTaggedBlock?: TaggedCardBlock
): BattleSpiritsCard {
  const taggedBlocks = extractTaggedCardTableBlocks(wikitext);
  const chosenTagged = forcedTaggedBlock || pickBestTaggedCardBlock(taggedBlocks, base);
  if (!chosenTagged) {
    return { ...base, isWikiLoaded: true };
  }

  const block = chosenTagged.block;
  const fields = parseTemplateFields(block);
  const jpName =
    cleanWikitextInline(fields.kanji || '') ||
    cleanWikitextInline(fields.jpname || '') ||
    base.jpName;

  // Read color, color1..color6 across CardTable for accurate multi-color support
  const rawColorParts = [
    fields.color || '',
    fields.color1 || '',
    fields.color2 || '',
    fields.color3 || '',
    fields.color4 || '',
    fields.color5 || '',
    fields.color6 || '',
  ].filter(Boolean);

  const parsedColors: CardColor[] = [];
  if (rawColorParts.length > 0) {
    for (const part of rawColorParts) {
      for (const c of normalizeColor(part)) {
        if (!parsedColors.includes(c)) parsedColors.push(c);
      }
    }
  }
  const finalColors =
    parsedColors.length > 0
      ? parsedColors
      : base.colors && base.colors.length > 0
      ? base.colors
      : [base.color];
  const color = finalColors[0] || base.color;
  const secondaryColor =
    finalColors[1] || (finalColors.length === 1 ? undefined : base.secondaryColor);

  const inferTypeFromWikitext = (): CardType => {
    if (/\[\[Category:Magic Cards\]\]/i.test(wikitext)) return 'Magic';
    if (/\[\[Category:Ultimate Cards\]\]/i.test(wikitext)) return 'Ultimate';
    if (/\[\[Category:Brave Cards\]\]/i.test(wikitext)) return 'Brave';
    if (/\[\[Category:Nexus Cards\]\]/i.test(wikitext)) return 'Nexus';
    if (/\[\[Category:Spirit Cards\]\]/i.test(wikitext)) return 'Spirit';
    if (fields.bravebp || fields.brave || fields.bravecondition) return 'Brave';
    if (fields.summoncondition || fields.summon) return 'Ultimate';
    const rawLevelText = cleanWikitextInline(fields.level || '');
    if (!rawLevelText && /\b(?:Flash|Main)\b/i.test(fields.effect || '') && !fields.symbols) {
      return 'Magic';
    }
    if (rawLevelText && !/\b\d[\d,]*\s*BP\b/i.test(rawLevelText)) {
      return 'Nexus';
    }
    return base.type;
  };

  const isRevival =
    chosenTagged.isRevival ||
    Boolean(base.isRevival) ||
    /\(revival\)/i.test(base.name) ||
    /(?:^|-)RV[A-Z0-9]*\d/i.test(base.cardNumber);

  const rawType = extractTabberSegment(fields.type || '', isRevival);
  const typeResult = rawType
    ? normalizeType(rawType)
    : { type: inferTypeFromWikitext(), subtypeLabel: base.subtypeLabel };
  const type = typeResult.type;
  const subtypeLabel = typeResult.subtypeLabel;

  const isToken =
    Boolean(base.isToken) ||
    /\btoken\b/i.test(rawType) ||
    /\btoken\b/i.test(subtypeLabel || '') ||
    /-T\d+$/i.test(base.cardNumber);

  const wantsSideB = /\(B\)$/i.test(base.cardNumber || '');
  const sideBRawField = wantsSideB
    ? fields.bimage || fields.image_b || fields.imageb || ''
    : '';
  const rawImage = cleanImageFieldValue(
    extractTabberSegment(sideBRawField || fields.image || '', isRevival)
  );

  const costNum = Number(
    extractTabberSegment(fields.cost || '', isRevival).replace(/[^\d]/g, '')
  );
  const cost = fields.cost && Number.isFinite(costNum) && costNum >= 0 ? costNum : base.cost;

  const reductions = parseColorCounts(
    extractTabberSegment(fields.reductions || fields.reduction || '', isRevival)
  );
  const symbols = parseColorCounts(extractTabberSegment(fields.symbols || '', isRevival));

  const families = [
    cleanWikitextInline(extractTabberSegment(fields.family || '', isRevival)),
    cleanWikitextInline(extractTabberSegment(fields.family2 || '', isRevival)),
    cleanWikitextInline(extractTabberSegment(fields.family3 || '', isRevival)),
    cleanWikitextInline(extractTabberSegment(fields.family4 || '', isRevival)),
  ].filter(Boolean);

  const resolvedSymbols: Partial<Record<BattleSymbolKind, number>> =
    Object.keys(symbols).length > 0
      ? symbols
      : type === 'Magic' || isToken
      ? {}
      : type === 'Ultimate'
      ? { Ultimate: 1 }
      : families.some((f) => /grandwalker/i.test(f)) || /grandwalker/i.test(subtypeLabel || '')
      ? { God: 1 }
      : type === 'Spirit' && Object.keys(base.symbols).length === 0
      ? { [color]: 1 }
      : Object.keys(base.symbols).length > 0
      ? base.symbols
      : { [color]: 1 };

  const rawLevelStr = extractTabberSegment(fields.level || '', isRevival);
  const levels = parseLevels(rawLevelStr);
  const rawEffect = extractTabberSegment(fields.effect || '', isRevival);
  const effects = parseEffects(rawEffect);

  const keywordsRaw = [
    cleanWikitextInline(fields.keyword || ''),
    cleanWikitextInline(fields.keyword2 || ''),
    cleanWikitextInline(fields.keyword3 || ''),
    cleanWikitextInline(fields.keyword4 || ''),
  ].filter(Boolean);

  let summonCond =
    cleanWikitextInline(
      extractTabberSegment(
        fields.summoncondition || fields.summon || fields.sumcon || fields.suadcon || '',
        isRevival
      )
    ) || undefined;

  if (!summonCond && rawEffect) {
    const suAdMatch = rawEffect.match(/\{\{(SuAdcon|Sumcon|Adcon)\|([^}]+)\}\}/i);
    if (suAdMatch) {
      const cleanedCond = cleanWikitextInline(suAdMatch[2]);
      if (cleanedCond) summonCond = cleanedCond;
    } else {
      const cleanedEff = cleanWikitextInline(rawEffect);
      const textCondMatch = cleanedEff.match(
        /\[(?:Summon(?:\/Advent)?|Advent)\s+Condition:\s*([^\]]+)\]/i
      );
      if (textCondMatch) {
        summonCond = textCondMatch[1].trim();
      }
    }
  }

  let rawBraveCond = cleanWikitextInline(
    extractTabberSegment(
      fields.bravecondition ||
        fields.brave ||
        fields['brave condition'] ||
        fields.brave_condition ||
        '',
      isRevival
    )
  );
  if (!rawBraveCond && rawEffect && (type === 'Brave' || /\bbrave\b/i.test(subtypeLabel || ''))) {
    const brMatch = rawEffect.match(/\{\{(?:Brcon|Bravecon)\|([^}]+)\}\}/i);
    if (brMatch) {
      rawBraveCond = cleanWikitextInline(brMatch[1]);
    } else {
      const cleanedEff = cleanWikitextInline(rawEffect);
      const txtBrMatch = cleanedEff.match(/\[Brave\s+Condition:\s*([^\]]+)\]/i);
      if (txtBrMatch) {
        rawBraveCond = txtBrMatch[1].trim();
      }
    }
  }

  const braveCond =
    (type === 'Brave' || /\bbrave\b/i.test(subtypeLabel || '')) && rawBraveCond
      ? rawBraveCond
      : undefined;

  let braveBpRaw = extractTabberSegment(fields.bravebp || '', isRevival).replace(/[^\d]/g, '');
  if (!braveBpRaw && rawLevelStr) {
    const bravedLvlMatch = cleanWikitextInline(rawLevelStr).match(
      /Braved:\s*(?:[^\n,+]*,\s*)?\+?([\d,]+)\s*BP/i
    );
    if (bravedLvlMatch) {
      braveBpRaw = bravedLvlMatch[1].replace(/[^\d]/g, '');
    }
  }
  const braveBonusBp =
    (type === 'Brave' || /\bbrave\b/i.test(subtypeLabel || '')) && braveBpRaw
      ? Number(braveBpRaw)
      : undefined;

  const flavorText =
    cleanWikitextInline(fields.enflavor1 || '') ||
    cleanWikitextInline(fields.enflavor || '') ||
    base.flavorText;

  const illustrator =
    cleanWikitextInline(fields.artist1 || '') ||
    cleanWikitextInline(fields.artist || '') ||
    base.illustrator;

  const blockVal =
    cleanWikitextInline(fields.block1 || '') ||
    cleanWikitextInline(fields.block || '');

  const isAlphaStandardBlock = /^[A-Z]$/.test(blockVal);
  const formats: GameFormat[] =
    base.formats.includes('Standard') || isAlphaStandardBlock
      ? ['Standard', 'Eternal']
      : ['Eternal'];

  const blockIcon = isAlphaStandardBlock
    ? `Block ${blockVal}`
    : blockVal
    ? `Block ${blockVal}`
    : base.blockIcon;

  // If the page separates Original vs Revival in <tabber>, scope image extraction to the chosen tab section so Revival and Non-Revival don't mix primary art
  const hasBothRevivalAndOriginal =
    taggedBlocks.some((t) => t.isRevival) && taggedBlocks.some((t) => !t.isRevival);
  const hasSingleTableDualVersion =
    !hasBothRevivalAndOriginal &&
    (/\|-\|\s*Revival\s*=|\{\{!\}\}-\{\{!\}\}\s*Revival\s*=/i.test(wikitext) ||
      /\[\[Category:Revival Cards\]\]/i.test(wikitext));

  const isRevivalArtFilename = (fileRaw: string) => {
    const clean = cleanImageFieldValue(fileRaw).toLowerCase();
    if (!clean) return false;
    return (
      /(?:^|[^0-9])2\.(?:jpe?g|png|webp)$/.test(clean) ||
      clean.includes('-rv') ||
      clean.includes(' rv') ||
      clean.includes('revival') ||
      clean.startsWith('bsc22-')
    );
  };

  const isOriginalArtFilename = (fileRaw: string) => {
    const clean = cleanImageFieldValue(fileRaw).toLowerCase();
    if (!clean) return false;
    return (
      /(?:^|[^0-9])1[a-z]?\.(?:jpe?g|png|webp)$/.test(clean) ||
      /^victory\.(?:jpe?g|png|webp)$/.test(clean) ||
      /^(?:bs(?:0[1-9]|[12]\d|3[0-4])|sd(?:0[1-9]|[12]\d|3[0-3]))-\d+/i.test(clean)
    );
  };

  const imageSourceWikitext = hasBothRevivalAndOriginal
    ? chosenTagged.sectionText
    : wikitext;
  const scopedPageImages = hasBothRevivalAndOriginal
    ? pageImages.filter((img) => {
        const lowerImg = img.toLowerCase();
        if (isRevival) {
          return (
            lowerImg.includes('rv') ||
            lowerImg.includes('revival') ||
            (base.cardNumber && lowerImg.includes(base.cardNumber.toLowerCase())) ||
            (rawImage && lowerImg.includes(rawImage.replace(/\.[^.]+$/, '').toLowerCase()))
          );
        }
        return !lowerImg.includes('-rv') && !lowerImg.includes('revival');
      })
    : pageImages;

  let galleryImages = extractGalleryImages(
    imageSourceWikitext,
    rawImage || `${base.cardNumber}.png`,
    base.cardNumber,
    base.name,
    scopedPageImages,
    base.wikiTitle || base.name
  );

  // On 1-CardTable legacy pages (e.g. Silent Wall, Wild Power, Attack Shift, Dark Coffin, Victory Draw),
  // |image= holds the Revival artwork (...2.jpg) while the Original artwork (...1.jpg) sits in the Gallery.
  // Swap & separate primary art so Non-Revival uses Original art and Revival uses Revival art.
  if (hasSingleTableDualVersion && galleryImages.length > 1) {
    const extractFileFromUrl = (url: string) => {
      const m = url.match(/[?&]file=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    };
    if (!isRevival && isRevivalArtFilename(rawImage)) {
      const originalMatches = galleryImages.filter((g) => {
        const fname = extractFileFromUrl(g.url);
        return !isRevivalArtFilename(fname);
      });
      const preferredOrig =
        originalMatches.find((g) => isOriginalArtFilename(extractFileFromUrl(g.url))) ||
        originalMatches[0];
      if (preferredOrig) {
        galleryImages = [
          preferredOrig,
          ...originalMatches.filter((g) => g.url !== preferredOrig.url),
        ];
      }
    } else if (isRevival) {
      const revivalMatches = galleryImages.filter((g) => {
        const fname = extractFileFromUrl(g.url);
        return !isOriginalArtFilename(fname);
      });
      const preferredRev =
        revivalMatches.find((g) => isRevivalArtFilename(extractFileFromUrl(g.url))) ||
        revivalMatches[0];
      if (preferredRev) {
        galleryImages = [
          preferredRev,
          ...revivalMatches.filter((g) => g.url !== preferredRev.url),
        ];
      }
    }
  }

  const primaryArtUrl =
    galleryImages[0]?.url ||
    `/api/wiki/image?file=${encodeURIComponent(`${base.cardNumber}.png`)}&fallback=${encodeURIComponent(base.cardNumber)}&title=${encodeURIComponent(base.wikiTitle || base.name)}`;

  const restriction = resolveCardRestriction(
    base.cardNumber,
    base.name,
    isRevival,
    base.restriction
  );

  const resolvedName =
    isRevival && !/\(revival\)/i.test(base.name)
      ? `${base.name} (Revival)`
      : base.name;

  return {
    ...base,
    name: resolvedName,
    jpName,
    color,
    secondaryColor,
    colors: finalColors,
    type,
    subtypeLabel,
    isRevival,
    isToken,
    cost,
    reduction: Object.keys(reductions).length > 0 ? reductions : base.reduction,
    symbols: resolvedSymbols,
    families,
    levels,
    braveBonusBp,
    braveCondition: braveCond,
    summonCondition: summonCond,
    effects:
      effects.length > 0
        ? effects
        : [
            {
              timing: 'Card Text',
              text: 'No English effect text listed on this card.',
            },
          ],
    keywords: Array.from(new Set([...keywordsRaw, ...base.keywords])),
    flavorText,
    illustrator,
    artworkImage: primaryArtUrl,
    galleryImages: galleryImages.length > 0 ? galleryImages : undefined,
    artVariant: defaultVariant(type, color),
    formats,
    blockIcon,
    restriction,
    isWikiLoaded: true,
  };
}

function parseSetTableRows(
  wikitext: string,
  setMeta: ProductSet
): BattleSpiritsCard[] {
  const cards: BattleSpiritsCard[] = [];
  const seenKeys = new Set<string>();

  const tables = wikitext.split(/\{\|/);
  for (const table of tables) {
    let colIdxMap: {
      number?: number;
      name?: number;
      color?: number;
      type?: number;
      rarity?: number;
    } = {};
    let hasExplicitHeader = false;
    let sectionIsRevival = false;
    let sectionIsToken = false;

    const rows = table.split(/\n\|-/);
    for (const row of rows) {
      // Detect colspan section titles inside tables (e.g. Revival Cards, Token Card, Campaign Promo)
      const colspanHdrMatch = row.match(/!\s*colspan\s*=\s*"?\d+"?[^|\n]*\|([^\n]+)/i);
      if (colspanHdrMatch) {
        const secText = cleanWikitextInline(colspanHdrMatch[1]);
        sectionIsRevival = /\brevival\b/i.test(secText);
        sectionIsToken = /\btoken\b/i.test(secText);
      }

      // Capture header column layout robustly (supports both `!!` multi-line and single-line `! scope="col"` headers)
      if (row.includes('! scope="col"') || /^\s*!/m.test(row)) {
        const splitHeaderRow = row
          .replace(/!!/g, '\n!')
          .replace(
            /!\s*(?=(?:scope|width|align|valign|style|class|colspan|rowspan)\s*=|''')/gi,
            '\n!'
          );
        const headerCells = splitHeaderRow
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('!') && !/colspan\s*=/i.test(l))
          .map((l) =>
            cleanWikitextInline(
              l.replace(/^!+(?:\s*(?:scope|width|align|valign|style|class)\s*=\s*"?[^"|]*"?\s*)*\|?/i, '')
            ).toLowerCase()
          )
          .filter(Boolean);

        if (headerCells.length >= 3) {
          colIdxMap = {};
          hasExplicitHeader = true;
          headerCells.forEach((h, idx) => {
            if (h.includes('number') || h === 'no.' || h === 'id') colIdxMap.number = idx;
            else if (h.includes('name') || h === 'card') colIdxMap.name = idx;
            else if (h.includes('color') || h.includes('attribute')) colIdxMap.color = idx;
            else if (h.includes('type')) colIdxMap.type = idx;
            else if (h.includes('rarity')) colIdxMap.rarity = idx;
          });
        }
        if (!row.includes('[[')) continue;
      }

      if (!row.includes('[[')) continue;

      const normalizedRow = row
        .replace(/\|\|/g, '\n|')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('|') && !l.startsWith('|-') && !l.startsWith('|}'));

      if (normalizedRow.length < 3) continue;

      const cells = normalizedRow.map((c) => {
        const stripped = c.slice(1).trim();
        const attrMatch = stripped.match(
          /^(?:style|align|bgcolor|width|class|colspan|rowspan)\s*=[^|]*\|([\s\S]*)$/i
        );
        return attrMatch ? attrMatch[1].trim() : stripped;
      });

      const detectedNameIdx =
        colIdxMap.name !== undefined &&
        cells[colIdxMap.name] &&
        /\[\[[^\]]+\]\]/.test(cells[colIdxMap.name])
          ? colIdxMap.name
          : cells.findIndex((c) => /\[\[[^\]]+\]\]/.test(c) && !/\[\[File:/i.test(c));

      if (detectedNameIdx < 1) continue;

      const numberIdx =
        colIdxMap.number !== undefined ? colIdxMap.number : detectedNameIdx - 1;
      const numRaw = cleanWikitextInline(cells[numberIdx] || '').replace(/\s+/g, '');
      if (!numRaw || numRaw.length > 24 || /number/i.test(numRaw)) continue;

      const nameCellRaw = cells[detectedNameIdx] || '';
      const linkMatch = nameCellRaw.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (!linkMatch) continue;

      const wikiTitle = linkMatch[1].trim();
      const baseDisplayName = (linkMatch[2] || linkMatch[1]).trim();
      if (!wikiTitle || wikiTitle.startsWith('File:') || wikiTitle.startsWith('Category:')) {
        continue;
      }

      const colorCell =
        colIdxMap.color !== undefined
          ? cells[colIdxMap.color] || ''
          : cells[detectedNameIdx + 1] || '';
      const typeCell =
        colIdxMap.type !== undefined
          ? cells[colIdxMap.type] || ''
          : cells[detectedNameIdx + 2] || '';
      const rarityCell =
        colIdxMap.rarity !== undefined
          ? cells[colIdxMap.rarity] || ''
          : hasExplicitHeader
          ? ''
          : cells[detectedNameIdx + 3] || '';

      const colors = normalizeColor(colorCell);
      const { type, subtypeLabel } = normalizeType(typeCell);
      const rarity: CardRarity =
        setMeta.category === 'Promo' && !rarityCell
          ? 'P'
          : normalizeRarity(rarityCell || (setMeta.category === 'Promo' ? 'P' : 'C'));

      const hasFullSetPrefix =
        numRaw.includes('-') ||
        /^(?:BS\d+|BSC\d+|SD\d+|CBX?\d+|PC\d+|LM\d+|PB\d+|EX\d+|CP\d+|26R[A-Z0-9]+|RP\d+|PX\d+|P\d+)/i.test(
          numRaw
        );
      const fullNumber = hasFullSetPrefix
        ? numRaw
        : setMeta.setCode === 'PROMO-REG'
        ? `P-${numRaw}`
        : `${setMeta.setCode}-${numRaw}`;

      const isRevival =
        setMeta.setCode === 'BSC22' ||
        setMeta.setCode === 'REVIVAL' ||
        /^BSC22-/i.test(fullNumber) ||
        sectionIsRevival ||
        /\(revival\)/i.test(nameCellRaw) ||
        /\(revival\)/i.test(wikiTitle) ||
        /(?:^|-)RV[A-Z0-9]*\d/i.test(fullNumber);

      const isToken =
        sectionIsToken ||
        /\btoken\b/i.test(typeCell) ||
        /-T\d+$/i.test(fullNumber);

      const displayName =
        isRevival && !/\(revival\)/i.test(baseDisplayName)
          ? `${baseDisplayName} (Revival)`
          : baseDisplayName;

      const uniqueKey = `${setMeta.setCode}-${fullNumber}-${wikiTitle}-${isRevival ? 'rv' : 'orig'}`;
      if (seenKeys.has(uniqueKey)) continue;
      seenKeys.add(uniqueKey);

      const id = `${setMeta.setCode.toLowerCase()}-${fullNumber
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}${isRevival ? '-rv' : ''}`;
      const defaultFile = `${fullNumber}.jpg`;

      const defaultSymbols: Partial<Record<BattleSymbolKind, number>> =
        type === 'Magic' || isToken
          ? {}
          : type === 'Ultimate'
          ? { Ultimate: 1 }
          : { [colors[0]]: 1 };

      cards.push({
        id,
        cardNumber: fullNumber,
        name: displayName,
        jpName: '',
        color: colors[0],
        secondaryColor: colors[1],
        colors,
        type,
        subtypeLabel,
        rarity,
        setCode: setMeta.setCode,
        setName: setMeta.name,
        formats: setMeta.formats,
        blockIcon: setMeta.blockLabel,
        restriction: resolveCardRestriction(fullNumber, displayName, isRevival),
        isRevival,
        isToken,
        cost: 0,
        reduction: {},
        symbols: defaultSymbols,
        families: [],
        effects: [],
        keywords: [],
        flavorText: '',
        illustrator: '',
        artworkImage: `/api/wiki/image?file=${encodeURIComponent(defaultFile)}&fallback=${encodeURIComponent(fullNumber)}&title=${encodeURIComponent(wikiTitle)}`,
        artVariant: defaultVariant(type, colors[0]),
        wikiTitle,
        wikiUrl: `${WIKI_BASE}${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`,
        isWikiLoaded: false,
        rulings: [],
      });
    }
  }

  return cards;
}

function enrichSetMetadata(base: ProductSet, wikitext: string, parsedCards: BattleSpiritsCard[]): ProductSet {
  const introMatch = wikitext.match(/(?:Introduction|Overview)\s*\n\|-\s*\n\|\s*colspan="[^"]+"\s*\|\s*([\s\S]*?)(?=\n\|-|$)/i);
  const introRaw = introMatch ? cleanWikitextInline(introMatch[1]) : '';

  const infoboxNameMatch = wikitext.match(/^\|\s*(?:name|title|en_?name)\s*=\s*([^\n|}]+)/im);
  const infoboxDateMatch = wikitext.match(/^\|\s*(?:release(?:d|_?date)?|jp_?release)\s*=\s*([^\n|}]+)/im);

  let name = base.name;
  const isGenericBase =
    !name ||
    name === base.setCode ||
    /^(?:Booster Set |Starter \/ Mega Deck |Standard (?:Booster|Entry) )/i.test(name);
  const infoboxName = infoboxNameMatch ? cleanWikitextInline(infoboxNameMatch[1]).trim() : '';
  const entitledMatch = introRaw.match(/(?:entitled|titled|called)[:\s]+([^,.\n(]+)/i);
  if (isGenericBase && infoboxName && infoboxName.length > 2 && infoboxName.toUpperCase() !== base.setCode.toUpperCase()) {
    name = infoboxName.replace(/^['"]|['"]$/g, '');
  } else if (isGenericBase && entitledMatch && entitledMatch[1].trim().length > 3) {
    name = entitledMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }

  let releaseDate = base.releaseDate;
  const dateMatch = introRaw.match(/released(?:\s+in\s+Japan)?\s+on\s+([A-Za-z0-9 ,]+?\d{4})/i);
  const infoboxDate = infoboxDateMatch ? cleanWikitextInline(infoboxDateMatch[1]).trim() : '';
  if (dateMatch) {
    releaseDate = dateMatch[1].trim();
  } else if (infoboxDate && /\d{4}/.test(infoboxDate) && SERVER_GENERIC_DATE_RE.test(releaseDate || '')) {
    releaseDate = infoboxDate;
  }

  const firstSentence = introRaw.split(/\.\s+/)[0];
  const tagline =
    firstSentence && firstSentence.length > 20
      ? `${firstSentence}.`
      : base.tagline;

  const colorsPresent = Array.from(
    new Set(parsedCards.flatMap((c) => c.colors || [c.color]))
  );

  return upsertStoredSetMetadata({
    ...base,
    name,
    releaseDate,
    tagline,
    colors: colorsPresent.length > 0 ? colorsPresent : base.colors,
    totalCardsInSet: parsedCards.length || base.totalCardsInSet,
  });
}

async function getWikiTokenSet(baseMeta: ProductSet): Promise<{
  set: ProductSet;
  cards: BattleSpiritsCard[];
  totalInSet: number;
}> {
  const tokenTitles = new Set<string>([
    'Platinum Bug',
    'Rig Avatar Dragon',
    'Swordish',
    'Fungal Bed',
  ]);

  try {
    const catJson = (await fetchWikiJson({
      action: 'query',
      list: 'allcategories',
      acfrom: 'Token',
      acto: 'Tokenz',
      aclimit: '50',
    })) as { query?: { allcategories?: { '*'?: string }[] } };

    const tokenCats = (catJson.query?.allcategories || [])
      .map((c) => c['*'] || '')
      .filter((name) => /^Token\b/i.test(name));

    await Promise.all(
      [...tokenCats, "Can't put in deck"].map(async (cat) => {
        try {
          const m = (await fetchWikiJson({
            action: 'query',
            list: 'categorymembers',
            cmtitle: `Category:${cat}`,
            cmlimit: '200',
          })) as { query?: { categorymembers?: { title?: string }[] } };
          for (const item of m.query?.categorymembers || []) {
            if (item.title && !item.title.includes(':')) {
              tokenTitles.add(item.title);
            }
          }
        } catch {
          // ignore individual category lookup failure
        }
      })
    );
  } catch {
    // keep known seed token titles
  }

  const contents = await batchFetchWikiPages(Array.from(tokenTitles));
  const cards: BattleSpiritsCard[] = [];

  for (const title of tokenTitles) {
    const bundle = contents.get(title);
    const wt = bundle?.wikitext || '';
    if (!wt || !/\{\{CardTable/i.test(wt)) continue;
    const setCodeMatch = wt.match(/\|\s*set1\s*=\s*([^\n|}]+)/i);
    const rawSet = setCodeMatch ? cleanWikitextInline(setCodeMatch[1]) : 'TOKENS';
    const knownSet = DIRECTORY_MAP.get(rawSet.toUpperCase());
    const cardNumMatch = wt.match(/\|\s*image\s*=\s*([A-Z0-9-]+)\.(?:png|jpe?g|webp)/i);
    const cardNumber = cardNumMatch ? cardNumMatch[1] : `${rawSet}-T001`;
    const isStd = /^26R/i.test(rawSet) || /^26R/i.test(cardNumber);

    const base: BattleSpiritsCard = {
      id: `token-${cardNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      cardNumber,
      name: title,
      jpName: '',
      color: 'Red',
      type: 'Spirit',
      rarity: 'C',
      setCode: rawSet,
      setName: knownSet?.name || rawSet,
      formats: isStd ? ['Standard', 'Eternal'] : ['Eternal'],
      blockIcon: isStd ? 'Standard Token' : 'Eternal Token',
      restriction: 'Unlimited',
      isToken: true,
      cost: 0,
      reduction: {},
      symbols: {},
      families: [],
      effects: [],
      keywords: [],
      flavorText: '',
      illustrator: '',
      artworkImage: '',
      artVariant: 'dragon',
      wikiTitle: title,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}`,
      isWikiLoaded: false,
      rulings: [],
    };

    const hydrated = hydrateCardFromWikitext(base, wt, bundle?.pageImages || []);
    cards.push({ ...hydrated, isToken: true });
  }

  const enrichedSet = upsertStoredSetMetadata({
    ...baseMeta,
    totalCardsInSet: cards.length,
  });
  setCache.set('TOKENS', {
    value: { set: enrichedSet, cards },
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return { set: enrichedSet, cards, totalInSet: cards.length };
}

function inferCardSetAndNumber(
  fields: Record<string, string>,
  wikitext: string,
  isRevival: boolean,
  fallbackSlug: string
): { setCode: string; setName: string; cardNumber: string } {
  const rawImg = cleanImageFieldValue(
    extractTabberSegment(fields.image || '', isRevival)
  );
  const normalizedImgCode = rawImg
    .replace(/\.[^.]+$/, '')
    .trim()
    .replace(/\s+/g, '-');
  const strictCodeMatch = normalizedImgCode.match(
    /^((?:26RBS|26RSD|BSC|CBX|BS|SD|CB|PB|PC|LM|EX|CP|PX|RP|P)\d*-[A-Z0-9]+)/i
  );

  let setCode = cleanWikitextInline(
    extractTabberSegment(fields.set1 || '', isRevival)
  ).trim();

  if (!setCode && fields.releasedjp) {
    const relCodes = [
      ...cleanWikitextInline(fields.releasedjp).matchAll(
        /\b(BSC\d+|BS\d+|SD\d+|CBX?\d+|PB\d+|PC\d+|LM\d+)\b/gi
      ),
    ].map((m) => m[1].toUpperCase());
    if (isRevival) {
      setCode =
        relCodes.find((c) => c === 'BSC22' || /^BS(?:3[5-9]|[4-7]\d)$/.test(c)) ||
        relCodes[relCodes.length - 1] ||
        '';
    } else {
      setCode = relCodes[0] || '';
    }
  }

  if (!setCode && strictCodeMatch) {
    setCode = strictCodeMatch[1].split('-')[0].toUpperCase();
  }
  if (!setCode) setCode = isRevival ? 'BSC22' : 'WIKI';

  let cardNumber = strictCodeMatch ? strictCodeMatch[1].toUpperCase() : '';
  if (!cardNumber && !isRevival) {
    const galleryNumMatch = wikitext.match(
      /\b((?:BS|SD|BSC|CBX?|PB|PC)\d{2}-[A-Z0-9]+)\b/i
    );
    if (galleryNumMatch) {
      cardNumber = galleryNumMatch[1].toUpperCase();
    }
  }
  if (!cardNumber) {
    cardNumber = `${setCode}-${fallbackSlug.slice(0, 6).toUpperCase()}`;
  }

  const knownSet = DIRECTORY_MAP.get(setCode.toUpperCase());
  return {
    setCode: setCode.toUpperCase(),
    setName: knownSet?.name || setCode.toUpperCase(),
    cardNumber,
  };
}

async function getWikiRevivalSet(
  baseMeta: ProductSet,
  hydrateLimit = 800
): Promise<{
  set: ProductSet;
  cards: BattleSpiritsCard[];
  totalInSet: number;
}> {
  const revivalTitles = new Set<string>([
    'Blizzard Wall',
    'Silent Wall',
    'Wild Power',
    'Double Draw',
    'The DragonEmperor Siegfried',
    'The SupernovaDragon Siegwurm-Nova',
    'The ThunderEmperorDragon Siegwurm',
    'Flame Tempest',
    'Goradon',
    'Angelic Pressure',
    'Diamond Wall',
    'Burst Wall',
    'Danse Macabre',
    'Attack Shift',
    'Dark Coffin',
    'Storm Draw',
  ]);

  try {
    let cmcontinue = '';
    do {
      const params: Record<string, string> = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: 'Category:Revival Cards',
        cmlimit: '500',
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;
      const catJson = (await fetchWikiJson(params)) as {
        continue?: { cmcontinue?: string };
        query?: { categorymembers?: { title?: string }[] };
      };
      for (const item of catJson.query?.categorymembers || []) {
        if (item.title && !item.title.includes(':')) {
          revivalTitles.add(item.title);
        }
      }
      cmcontinue = catJson.continue?.cmcontinue || '';
    } while (cmcontinue && revivalTitles.size < 1200);
  } catch {
    // keep seed titles cleanly on transient network error
  }

  const targetTitles = Array.from(revivalTitles).slice(
    0,
    Math.max(250, Math.min(hydrateLimit, 1000))
  );
  const contents = await batchFetchWikiPages(targetTitles);
  const cards: BattleSpiritsCard[] = [];
  const seenIds = new Set<string>();

  for (const title of targetTitles) {
    const bundle = contents.get(title);
    const wt = bundle?.wikitext || '';
    if (!wt || !/\{\{CardTable/i.test(wt)) continue;

    const taggedBlocks = extractTaggedCardTableBlocks(wt);
    const revivalBlock = taggedBlocks.find((b) => b.isRevival);
    const chosenBlock =
      revivalBlock ||
      (taggedBlocks[0]
        ? { ...taggedBlocks[0], label: 'Revival', isRevival: true }
        : undefined);
    if (!chosenBlock) continue;

    const fields = parseTemplateFields(chosenBlock.block);
    const idSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = `wiki-${idSlug}-revival`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const { setCode, setName, cardNumber } = inferCardSetAndNumber(
      fields,
      wt,
      true,
      idSlug
    );
    const knownSet = DIRECTORY_MAP.get(setCode);
    const baseName = title.replace(/\s*\([^)]+\)\s*$/, '');

    const base: BattleSpiritsCard = {
      id,
      cardNumber,
      name: `${baseName} (Revival)`,
      jpName: '',
      color: 'Red',
      type: 'Spirit',
      rarity: normalizeRarity(fields.rarity1 || ''),
      setCode,
      setName,
      formats: knownSet?.formats || ['Eternal'],
      blockIcon: knownSet?.blockLabel || 'Revival',
      restriction: resolveCardRestriction(cardNumber, baseName, true),
      isRevival: true,
      cost: 0,
      reduction: {},
      symbols: {},
      families: [],
      effects: [],
      keywords: [],
      flavorText: '',
      illustrator: '',
      artworkImage: '',
      artVariant: 'dragon',
      wikiTitle: title,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}`,
      isWikiLoaded: false,
      rulings: [],
    };

    const hydrated = hydrateCardFromWikitext(
      base,
      wt,
      bundle?.pageImages || [],
      chosenBlock
    );
    cards.push({ ...hydrated, isRevival: true });
  }

  const enrichedSet = upsertStoredSetMetadata({
    ...baseMeta,
    totalCardsInSet: cards.length,
  });
  if (cards.length >= 200) {
    setCache.set('REVIVAL', {
      value: { set: enrichedSet, cards },
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
  return { set: enrichedSet, cards, totalInSet: cards.length };
}

export async function getWikiSet(
  setCodeInput: string,
  hydrateLimit = 60
): Promise<{ set: ProductSet; cards: BattleSpiritsCard[]; totalInSet: number }> {
  ensureStoredSetRegistryHydrated();
  const codeKey = setCodeInput.toUpperCase();
  const baseMeta = DIRECTORY_MAP.get(codeKey);
  if (!baseMeta) {
    throw new Error(`Unknown set code: ${setCodeInput}`);
  }

  const now = Date.now();
  const cached = setCache.get(codeKey);
  if (cached && cached.expiresAt > now) {
    return {
      set: cached.value.set,
      cards: cached.value.cards,
      totalInSet: cached.value.cards.length,
    };
  }

  await ensureBanListLoaded();

  if (codeKey === 'TOKENS') {
    return getWikiTokenSet(baseMeta);
  }
  if (codeKey === 'REVIVAL') {
    return getWikiRevivalSet(baseMeta, hydrateLimit);
  }

  const wikiTitle = baseMeta.wikiTitle || baseMeta.setCode;
  const json = (await fetchWikiJson({
    action: 'query',
    titles: wikiTitle,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
  })) as {
    query?: {
      pages?: Record<
        string,
        {
          missing?: string;
          revisions?: { slots?: { main?: { '*'?: string } } }[];
        }
      >;
    };
  };

  const page = Object.values(json.query?.pages || {})[0];
  const wikitext = page?.revisions?.[0]?.slots?.main?.['*'] || '';

  if (!wikitext) {
    return { set: baseMeta, cards: [], totalInSet: 0 };
  }

  const rawCards = parseSetTableRows(wikitext, baseMeta);
  const enrichedSet = enrichSetMetadata(baseMeta, wikitext, rawCards);

  // Batch hydrate up to hydrateLimit cards right away (each 50 cards = 1 MediaWiki request)
  const targetTitles = rawCards
    .slice(0, hydrateLimit)
    .map((c) => c.wikiTitle)
    .filter((t): t is string => Boolean(t));

  const cardContents = await batchFetchWikiPages(targetTitles);
  const hydratedCards = rawCards.map((card) => {
    const bundle = card.wikiTitle ? cardContents.get(card.wikiTitle) : undefined;
    const updatedBase = { ...card, setName: enrichedSet.name };
    return bundle
      ? hydrateCardFromWikitext(updatedBase, bundle.wikitext, bundle.pageImages)
      : updatedBase;
  });

  setCache.set(codeKey, {
    value: { set: enrichedSet, cards: hydratedCards },
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return {
    set: enrichedSet,
    cards: hydratedCards,
    totalInSet: hydratedCards.length,
  };
}

export async function getWikiCardDetail(
  wikiTitle: string,
  fallbackBase?: Partial<BattleSpiritsCard>
): Promise<BattleSpiritsCard> {
  const [, contents] = await Promise.all([
    ensureBanListLoaded(),
    batchFetchWikiPages([wikiTitle]),
  ]);
  const bundle = contents.get(wikiTitle);
  const wikitext = bundle?.wikitext || '';

  const base: BattleSpiritsCard = {
    id: fallbackBase?.id || `wiki-${wikiTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    cardNumber: fallbackBase?.cardNumber || 'WIKI',
    name: fallbackBase?.name || wikiTitle,
    jpName: fallbackBase?.jpName || '',
    color: fallbackBase?.color || 'Red',
    type: fallbackBase?.type || 'Spirit',
    rarity: fallbackBase?.rarity || 'C',
    setCode: fallbackBase?.setCode || 'WIKI',
    setName: fallbackBase?.setName || 'Battle Spirits Wiki',
    formats: fallbackBase?.formats || ['Eternal'],
    blockIcon: fallbackBase?.blockIcon || 'Wiki',
    restriction: fallbackBase?.restriction || 'Unlimited',
    isRevival: fallbackBase?.isRevival,
    isToken: fallbackBase?.isToken,
    cost: fallbackBase?.cost ?? 0,
    reduction: fallbackBase?.reduction || {},
    symbols: fallbackBase?.symbols || {},
    families: fallbackBase?.families || [],
    effects: fallbackBase?.effects || [],
    keywords: fallbackBase?.keywords || [],
    flavorText: fallbackBase?.flavorText || '',
    illustrator: fallbackBase?.illustrator || '',
    artworkImage: fallbackBase?.artworkImage || '',
    artVariant: fallbackBase?.artVariant || 'dragon',
    wikiTitle,
    wikiUrl: `${WIKI_BASE}${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`,
    isWikiLoaded: false,
    rulings: fallbackBase?.rulings || [],
  };

  return wikitext
    ? hydrateCardFromWikitext(base, wikitext, bundle?.pageImages || [])
    : { ...base, isWikiLoaded: true };
}

export async function hydrateWikiCardsBatch(
  cards: BattleSpiritsCard[]
): Promise<BattleSpiritsCard[]> {
  const titles = cards.map((c) => c.wikiTitle).filter((t): t is string => Boolean(t));
  const [, contents] = await Promise.all([
    ensureBanListLoaded(),
    batchFetchWikiPages(titles),
  ]);
  return cards.map((card) => {
    const bundle = card.wikiTitle ? contents.get(card.wikiTitle) : undefined;
    return bundle
      ? hydrateCardFromWikitext(card, bundle.wikitext, bundle.pageImages)
      : card;
  });
}

function toWikiTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function findMatchingSetCodesForQuery(rawQuery: string): string[] {
  ensureStoredSetRegistryHydrated();
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const compactUpper = trimmed.toUpperCase().replace(/[\s-]+/g, '');
  const compactLower = compactUpper.toLowerCase();
  const matches: string[] = [];
  const pushIfValid = (code: string) => {
    const upper = code.toUpperCase();
    if (DIRECTORY_MAP.has(upper) && !matches.includes(upper)) {
      matches.push(upper);
    }
  };

  // 1. Direct set code match (e.g. "bs 70" -> "BS70", "sd43" -> "SD43", "01" -> "01", "2026" -> "2026")
  pushIfValid(compactUpper);

  // 2. Normalized code stripped of optional prefix like "SET BS70" or "BS 1" -> "BS01"
  const strippedSet = trimmed.replace(/^set\s+/i, '').trim();
  const strippedCompact = strippedSet.replace(/[\s-]+/g, '').toUpperCase();
  pushIfValid(strippedCompact);
  const shortAlphaMatch = strippedCompact.match(/^(BS|SD|CB|BSC|PB|PC|RP|PX)(\d{1})$/);
  if (shortAlphaMatch) {
    pushIfValid(`${shortAlphaMatch[1]}0${shortAlphaMatch[2]}`);
  }

  const setTokenMatch = trimmed.match(/\b([A-Za-z0-9]{2,4}[\s-]*\d{2})\b/);
  if (setTokenMatch) {
    pushIfValid(setTokenMatch[1].replace(/[\s-]+/g, ''));
  }

  // 3. Pure numeric query (1-4 digits, e.g. "7", "43", "01", "2026", "set 24")
  // Check exact/padded/unpadded number-only sets first, then standard/eternal prefixed sets
  const numOnly = trimmed.match(/^(?:set\s*)?(\d{1,4})$/i);
  if (numOnly) {
    const rawDigits = numOnly[1];
    const padded2 = rawDigits.length <= 2 ? rawDigits.padStart(2, '0') : rawDigits;
    const unpadded = String(Number(rawDigits));
    pushIfValid(rawDigits);
    pushIfValid(padded2);
    pushIfValid(unpadded);

    for (const [code, tokens] of storedSetTokens.entries()) {
      if (/^\d+$/.test(code) && (tokens.includes(unpadded) || tokens.includes(padded2))) {
        pushIfValid(code);
      }
    }

    if (rawDigits.length <= 2) {
      const candidatePrefixes = ['BS', 'SD', 'CB', 'BSC', 'PB', 'PC', '26RBS', '26RSD'];
      for (const prefix of candidatePrefixes) {
        pushIfValid(`${prefix}${padded2}`);
        if (matches.length >= 4) break;
      }
    }
  } else if (compactLower.length >= 3) {
    // Fallback token lookup on synchronized set names / tokens
    for (const [code, tokens] of storedSetTokens.entries()) {
      if (tokens.some((t) => t === compactLower || t === trimmed.toLowerCase())) {
        pushIfValid(code);
        if (matches.length >= 3) break;
      }
    }
  }

  return matches.slice(0, 4);
}

async function fetchCategoryMemberTitles(categoryName: string): Promise<string[]> {
  try {
    const json = (await fetchWikiJson({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmlimit: '120',
      cmnamespace: '0',
    })) as {
      query?: { categorymembers?: { title: string }[] };
    };
    return (json.query?.categorymembers || [])
      .map((m) => m.title)
      .filter((t) => Boolean(t && !t.includes('/')));
  } catch {
    return [];
  }
}

export async function searchWikiCards(
  query: string,
  formatFilter: 'All' | 'Standard' | 'Eternal' = 'All'
): Promise<BattleSpiritsCard[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  await ensureBanListLoaded();

  const results: BattleSpiritsCard[] = [];
  const seenKeys = new Set<string>();
  const pushCard = (card: BattleSpiritsCard) => {
    const dedupeKey = `${card.cardNumber.toUpperCase()}|${card.isRevival ? 'rv' : 'orig'}`;
    const altNameKey = !card.isRevival
      ? `orig-name:${card.name.trim().toLowerCase()}`
      : `rv-name:${card.name.trim().toLowerCase()}`;

    if (seenKeys.has(dedupeKey) || seenKeys.has(altNameKey)) return;
    seenKeys.add(dedupeKey);
    seenKeys.add(altNameKey);

    if (formatFilter === 'All' || card.formats.includes(formatFilter)) {
      results.push(card);
    }
  };

  // 1. If query corresponds to one or more expansion set codes (e.g. "bs 70", "43", "12"), load full set rosters
  const matchedSets = findMatchingSetCodesForQuery(trimmed);
  if (matchedSets.length > 0) {
    const setBundles = await Promise.all(
      matchedSets.map((code) => getWikiSet(code, 500).catch(() => null))
    );
    for (const bundle of setBundles) {
      if (!bundle) continue;
      for (const c of bundle.cards) {
        pushCard(c);
      }
    }
    if (results.length > 0 && (/^[A-Za-z0-9\s-]{2,10}$/.test(trimmed) && /\d/.test(trimmed))) {
      return results;
    }
  }

  // 2. General / Family / Keyword Wiki search: combine multi-page full-text search + exact Wiki Category lookup
  const titleQuery = toWikiTitleCase(trimmed);
  const categoryCandidates = Array.from(
    new Set([
      titleQuery,
      `${titleQuery} Cards`,
      `Cards with ${titleQuery}`,
    ])
  );

  const [searchPage1, searchPage2, ...categoryLists] = await Promise.all([
    fetchWikiJson({
      action: 'query',
      list: 'search',
      srsearch: trimmed,
      srlimit: '50',
    }).catch(() => ({})) as Promise<{ query?: { search?: { title: string }[] } }>,
    trimmed.length >= 3
      ? (fetchWikiJson({
          action: 'query',
          list: 'search',
          srsearch: trimmed,
          srlimit: '50',
          sroffset: '50',
        }).catch(() => ({})) as Promise<{ query?: { search?: { title: string }[] } }>)
      : Promise.resolve({} as { query?: { search?: { title: string }[] } }),
    ...categoryCandidates.map((cat) => fetchCategoryMemberTitles(cat)),
  ]);

  const titleSet = new Set<string>();
  for (const list of categoryLists) {
    for (const t of list) {
      if (t && !t.includes('/')) titleSet.add(t);
    }
  }
  for (const item of searchPage1.query?.search || []) {
    if (item.title && !item.title.includes('/')) titleSet.add(item.title);
  }
  for (const item of searchPage2.query?.search || []) {
    if (item.title && !item.title.includes('/')) titleSet.add(item.title);
  }

  const titles = Array.from(titleSet).slice(0, 120);
  if (titles.length === 0) return results;

  const contents = await batchFetchWikiPages(titles);

  for (const title of titles) {
    const bundle = contents.get(title);
    const wt = bundle?.wikitext;
    if (!wt || !/\{\{CardTable/i.test(wt)) continue;

    const taggedBlocks = extractTaggedCardTableBlocks(wt);
    const originalBlock = taggedBlocks.find((t) => !t.isRevival);
    const revivalBlock = taggedBlocks.find((t) => t.isRevival);

    // Emit distinct entries for Original (Non-Revival) and Revival blocks on Wiki pages
    const versionsToEmit: TaggedCardBlock[] = [];
    if (originalBlock) versionsToEmit.push(originalBlock);
    if (revivalBlock) {
      versionsToEmit.push(revivalBlock);
    } else if (
      originalBlock &&
      /\|-\|\s*Revival\s*=|\{\{!\}\}-\{\{!\}\}\s*Revival\s*=/i.test(originalBlock.block)
    ) {
      versionsToEmit.push({ ...originalBlock, label: 'Revival', isRevival: true });
    }
    if (versionsToEmit.length === 0 && taggedBlocks[0]) {
      versionsToEmit.push(taggedBlocks[0]);
    }

    for (const vBlock of versionsToEmit) {
      const fields = parseTemplateFields(vBlock.block);
      const idSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { setCode: setCodeRaw, setName, cardNumber } = inferCardSetAndNumber(
        fields,
        wt,
        vBlock.isRevival,
        idSlug
      );
      const knownSet = DIRECTORY_MAP.get(setCodeRaw.toUpperCase());
      const baseName = title.replace(/\s*\([^)]+\)\s*$/, '');
      const displayName = vBlock.isRevival ? `${baseName} (Revival)` : baseName;

      const base: BattleSpiritsCard = {
        id: `wiki-${idSlug}${vBlock.isRevival ? '-revival' : ''}`,
        cardNumber,
        name: displayName,
        jpName: '',
        color: 'Red',
        type: 'Spirit',
        rarity: normalizeRarity(fields.rarity1 || ''),
        setCode: setCodeRaw,
        setName,
        formats: knownSet?.formats || ['Eternal'],
        blockIcon: knownSet?.blockLabel || 'Wiki',
        restriction: resolveCardRestriction(cardNumber, displayName, vBlock.isRevival),
        isRevival: vBlock.isRevival,
        cost: 0,
        reduction: {},
        symbols: {},
        families: [],
        effects: [],
        keywords: [],
        flavorText: '',
        illustrator: '',
        artworkImage: '',
        artVariant: 'dragon',
        wikiTitle: title,
        wikiUrl: `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}`,
        isWikiLoaded: false,
        rulings: [],
      };

      const hydrated = hydrateCardFromWikitext(
        base,
        wt,
        bundle?.pageImages || [],
        vBlock
      );
      pushCard(hydrated);
    }
  }

  return results;
}

const inflightImageUrl = new Map<string, Promise<string | null>>();
const inflightImageBytes = new Map<
  string,
  Promise<{ buffer: Buffer; contentType: string } | null>
>();
const imageBytesCache = new Map<
  string,
  CacheEntry<{ buffer: Buffer; contentType: string }>
>();
const IMAGE_BYTES_CACHE_TTL_MS = 1000 * 60 * 30;
const IMAGE_BYTES_MAX_ENTRIES = 160;
const NEGATIVE_IMAGE_TTL_MS = 1000 * 60 * 5;

function pruneImageUrlCache() {
  if (imageUrlCache.size <= 25000) return;
  const toDelete = imageUrlCache.size - 20000;
  let removed = 0;
  for (const key of imageUrlCache.keys()) {
    imageUrlCache.delete(key);
    removed++;
    if (removed >= toDelete) break;
  }
}

function setBoundedImageBytesCache(
  key: string,
  value: { buffer: Buffer; contentType: string }
) {
  if (value.buffer.byteLength > 2 * 1024 * 1024) return;
  if (imageBytesCache.size >= IMAGE_BYTES_MAX_ENTRIES) {
    const oldestKey = imageBytesCache.keys().next().value;
    if (oldestKey) imageBytesCache.delete(oldestKey);
  }
  imageBytesCache.set(key, {
    value,
    expiresAt: Date.now() + IMAGE_BYTES_CACHE_TTL_MS,
  });
}

const lookupTraceCache = new Map<string, CacheEntry<LookupResolutionTrace>>();
const inflightLookupTrace = new Map<string, Promise<LookupResolutionTrace>>();

function pruneLookupTraceCache() {
  if (lookupTraceCache.size <= 5000) return;
  const toDelete = lookupTraceCache.size - 4000;
  let removed = 0;
  for (const key of lookupTraceCache.keys()) {
    lookupTraceCache.delete(key);
    removed++;
    if (removed >= toDelete) break;
  }
}

function normalizeLookupCriteria(
  fileNameOrCriteria: string | CardLookupCriteria,
  fallbackNumber?: string,
  wikiTitle?: string,
  extra?: Partial<CardLookupCriteria>
): CardLookupCriteria {
  if (typeof fileNameOrCriteria === 'string') {
    return {
      fileName: fileNameOrCriteria.trim() || undefined,
      cardNumber: fallbackNumber?.trim() || undefined,
      wikiTitle: wikiTitle?.trim() || undefined,
      id: extra?.id?.trim() || undefined,
      name: extra?.name?.trim() || undefined,
      jpName: extra?.jpName?.trim() || undefined,
      setCode: extra?.setCode?.trim() || undefined,
      isRevival: extra?.isRevival,
    };
  }
  return {
    id: fileNameOrCriteria.id?.trim() || undefined,
    fileName: fileNameOrCriteria.fileName?.trim() || undefined,
    cardNumber: fileNameOrCriteria.cardNumber?.trim() || undefined,
    wikiTitle: fileNameOrCriteria.wikiTitle?.trim() || undefined,
    name: fileNameOrCriteria.name?.trim() || undefined,
    jpName: fileNameOrCriteria.jpName?.trim() || undefined,
    setCode: fileNameOrCriteria.setCode?.trim() || undefined,
    isRevival: fileNameOrCriteria.isRevival,
  };
}

function buildLookupCacheKey(criteria: CardLookupCriteria): string {
  return [
    (criteria.id || '').toLowerCase(),
    (criteria.fileName || '').toLowerCase(),
    (criteria.cardNumber || '').toLowerCase(),
    (criteria.wikiTitle || '').toLowerCase(),
    (criteria.name || '').toLowerCase(),
    (criteria.jpName || '').toLowerCase(),
    (criteria.setCode || '').toLowerCase(),
    criteria.isRevival ? 'rv' : 'orig',
  ].join('|');
}

function extractFilenameFromWikiUrl(url: string): string {
  const clean = url.split('/revision/')[0].split('/').pop() || '';
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function buildPseudoBaseCard(criteria: CardLookupCriteria): BattleSpiritsCard {
  const num = criteria.cardNumber || '';
  const name = criteria.name || criteria.wikiTitle || num || 'Unknown';
  const isRev = Boolean(
    criteria.isRevival ||
      /\(revival\)/i.test(name) ||
      /(?:^|-)RV[A-Z0-9]*\d/i.test(num) ||
      /^BSC22-/i.test(num)
  );
  return {
    id: criteria.id || `lookup-${normalizeCompact(name || num || 'card')}`,
    cardNumber: num,
    name,
    jpName: criteria.jpName || '',
    color: 'Red',
    type: 'Spirit',
    rarity: 'C',
    setCode: criteria.setCode || (num.includes('-') ? num.split('-')[0] : ''),
    setName: criteria.setCode || '',
    formats: ['Eternal'],
    blockIcon: 'Eternal',
    restriction: 'Unlimited',
    isRevival: isRev,
    cost: 0,
    reduction: {},
    symbols: {},
    families: [],
    effects: [],
    keywords: [],
    flavorText: '',
    illustrator: '',
    artworkImage: '',
    artVariant: 'dragon',
    wikiTitle: criteria.wikiTitle || criteria.name,
    wikiUrl: criteria.wikiTitle
      ? `${WIKI_BASE}${encodeURIComponent(criteria.wikiTitle.replace(/ /g, '_'))}`
      : '',
    isWikiLoaded: false,
    rulings: [],
  };
}

async function resolveWikiImageUrlWithFile(
  fileNames: string[]
): Promise<{ url: string; file: string } | null> {
  const url = await resolveWikiImageUrl(fileNames);
  if (!url) return null;
  if (isNonCardWikiIcon(url)) return null;
  return {
    url,
    file: extractFilenameFromWikiUrl(url) || fileNames[0] || '',
  };
}

async function extractPreferredArtworkFromPage(
  page: WikiCandidatePage,
  criteria: CardLookupCriteria
): Promise<{ url: string; file: string } | null> {
  const rawNum = (criteria.cardNumber || '').trim().toUpperCase();
  const isSideB = Boolean(/\(B\)$/i.test(rawNum));
  const isRevival = Boolean(
    criteria.isRevival ||
      /\(revival\)/i.test(criteria.name || criteria.wikiTitle || '') ||
      /(?:^|-)RV[A-Z0-9]*\d/i.test(rawNum) ||
      /^BSC22-/i.test(rawNum)
  );

  const taggedBlocks = extractTaggedCardTableBlocks(page.wikitext || '');
  const pseudoBase = buildPseudoBaseCard(criteria);
  const chosenBlock = pickBestTaggedCardBlock(taggedBlocks, pseudoBase);
  const fields = chosenBlock ? parseTemplateFields(chosenBlock.block) : {};

  const sideBField = isSideB
    ? fields.bimage || fields.image_b || fields.imageb || ''
    : '';
  const blockRawImage = cleanImageFieldValue(
    extractTabberSegment(sideBField || fields.image || '', isRevival)
  );

  const pageImages = (page.pageImages || [])
    .map((img) => img.replace(/^File:/i, '').trim())
    .filter((t) => Boolean(t) && isCardArtworkFile(t));

  const compactCode = rawNum.replace(/\s*\([AB]\)$/i, '').replace(/[^A-Z0-9]/g, '');

  const orderedCandidates: string[] = [];
  const pushCand = (f?: string) => {
    const clean = cleanImageFieldValue(f || '');
    if (!clean || !isCardArtworkFile(clean)) return;
    if (isSideB) {
      // For Side B flip cards, reject plain Side-A filenames unless explicitly b-tagged
      const norm = clean.toLowerCase();
      if (
        compactCode &&
        norm.replace(/[^a-z0-9]/g, '') === compactCode.toLowerCase()
      ) {
        return;
      }
    }
    if (!orderedCandidates.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      orderedCandidates.push(clean);
    }
  };

  // For Side (B) Rebirth cards: prioritize explicit Side-B CardTable fields & `_b` / ` b` images
  if (isSideB) {
    if (blockRawImage) {
      for (const c of expandWikiFileCandidates(blockRawImage, rawNum, {
        isSideB: true,
        isRevival,
      })) {
        pushCand(c);
      }
    }
    for (const img of pageImages) {
      const compactImg = img.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (
        compactCode &&
        compactImg.includes(compactCode) &&
        /(?:^|[^a-z])(?:b|_b|\sb|-b|\(b\))\.(?:png|jpe?g|webp|gif)$/i.test(img)
      ) {
        pushCand(img);
      }
    }
    for (const c of expandWikiFileCandidates(undefined, rawNum, {
      isSideB: true,
      isRevival,
    })) {
      pushCand(c);
    }
  } else {
    // Normal / Revival card resolution:
    // If CardTable |image= is a generic camera filename (IMG_1234.PNG) AND pageImages has a clean
    // card-number-matched Revival/Edition file, prefer the card-number file; otherwise prefer CardTable |image= first!
    const isGenericPhotoName = /^img[_-]?\d+/i.test(blockRawImage);
    const matchedCodePageImages = compactCode
      ? pageImages.filter((img) => {
          const compactImg = img.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!compactImg.includes(compactCode)) return false;
          if (
            isRevival &&
            !/rv|revival|bsc22|bsc36/i.test(img) &&
            !compactImg.includes(compactCode)
          ) {
            return false;
          }
          // Skip Side B art when Side A / normal card is requested
          if (/(?:_b|\sb|-b|\(b\))\.(?:png|jpe?g|webp|gif)$/i.test(img)) {
            return false;
          }
          return true;
        })
      : [];

    // Sort matched page images so base/main prints precede promo reprints (-PB/-SCR/-LM)
    matchedCodePageImages.sort((a, b) => {
      const aReprint = /-(?:pb|scr|lm|alt|fa)\b/i.test(a) ? 1 : 0;
      const bReprint = /-(?:pb|scr|lm|alt|fa)\b/i.test(b) ? 1 : 0;
      return aReprint - bReprint;
    });

    if (!isGenericPhotoName && blockRawImage) {
      for (const c of expandWikiFileCandidates(blockRawImage, undefined, {
        isSideB: false,
        isRevival,
      })) {
        pushCand(c);
      }
    }

    for (const img of matchedCodePageImages) {
      pushCand(img);
    }

    if (isGenericPhotoName && blockRawImage) {
      for (const c of expandWikiFileCandidates(blockRawImage, undefined, {
        isSideB: false,
        isRevival,
      })) {
        pushCand(c);
      }
    }

    // Scoped gallery/section images fallback (respecting Revival vs Original tab separation)
    const hasBothTabs =
      taggedBlocks.some((t) => t.isRevival) &&
      taggedBlocks.some((t) => !t.isRevival);
    const scopedSection =
      hasBothTabs && chosenBlock ? chosenBlock.sectionText : page.wikitext;

    const scopedGalleryMatches = [
      ...scopedSection.matchAll(
        /\|\s*(?:image\d*|art\d*|alt(?:image)?\d*)\s*=\s*([^\n}]+)/gi
      ),
    ];
    for (const m of scopedGalleryMatches) {
      const val = cleanImageFieldValue(extractTabberSegment(m[1], isRevival));
      if (val && !isGenericPhotoName) pushCand(val);
    }

    // Remaining non-icon pageImages scoped properly
    for (const img of pageImages) {
      const lower = img.toLowerCase();
      if (/(?:_b|\sb|-b|\(b\))\.(?:png|jpe?g|webp|gif)$/i.test(lower)) continue;
      if (
        hasBothTabs &&
        !isRevival &&
        (lower.includes('-rv') || lower.includes('revival'))
      ) {
        continue;
      }
      pushCand(img);
    }
  }

  if (orderedCandidates.length > 0) {
    const resolved = await resolveWikiImageUrlWithFile(orderedCandidates.slice(0, 16));
    if (resolved) return resolved;
  }

  if (
    !isSideB &&
    page.origSource &&
    !isNonCardWikiIcon(page.origSource) &&
    (!compactCode || !blockRawImage || page.origSource.includes(blockRawImage))
  ) {
    return {
      url: page.origSource,
      file: extractFilenameFromWikiUrl(page.origSource),
    };
  }

  return null;
}

async function fetchWikiCandidatePages(
  titles: string[]
): Promise<WikiCandidatePage[]> {
  const unique = Array.from(
    new Set(titles.map((t) => t.trim()).filter(Boolean))
  ).slice(0, 20);
  if (unique.length === 0) return [];

  const bundleMap = await batchFetchWikiPages(unique);
  const pages: WikiCandidatePage[] = [];
  for (const t of unique) {
    const b = bundleMap.get(t);
    if (b && b.wikitext) {
      pages.push({
        title: t,
        wikitext: b.wikitext,
        pageImages: b.pageImages || [],
      });
    }
  }
  return pages;
}

async function searchWikiPageTitles(
  srsearch: string,
  srlimit = 10
): Promise<string[]> {
  const clean = srsearch.trim();
  if (!clean) return [];
  try {
    const json = (await fetchWikiJson({
      action: 'query',
      list: 'search',
      srsearch: clean,
      srlimit: String(srlimit),
    })) as {
      query?: { search?: { title?: string }[] };
    };
    return (json.query?.search || [])
      .map((s) => s.title || '')
      .filter(
        (t) =>
          Boolean(t) &&
          !/^(?:Category|File|Image|Template|User|Talk|Help|Module|Special):/i.test(t)
      );
  } catch {
    return [];
  }
}

async function opensearchWikiTitles(
  query: string,
  limit = 10
): Promise<string[]> {
  const clean = query.trim();
  if (!clean) return [];
  try {
    const search = new URLSearchParams({
      action: 'opensearch',
      search: clean,
      limit: String(limit),
      redirects: 'resolve',
      format: 'json',
    });
    const res = await withWikiSemaphore(() =>
      fetchWithRetry(
        `${WIKI_API}?${search.toString()}`,
        { headers: { 'User-Agent': USER_AGENT } },
        2,
        8000
      )
    );
    if (!res.ok) return [];
    const data = (await res.json()) as unknown[];
    if (Array.isArray(data) && Array.isArray(data[1])) {
      return (data[1] as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

async function tryResolveFromCandidateTitles(
  titles: string[],
  criteria: CardLookupCriteria,
  discoveredResults: Set<string>,
  requireStrictScore = true
): Promise<{
  hit: { url: string; file: string; title: string } | null;
  diagnosticNote?: string;
}> {
  const pages = await fetchWikiCandidatePages(titles);
  for (const p of pages) discoveredResults.add(p.title);
  if (pages.length === 0) return { hit: null };

  const ranked = pages
    .map((page) => ({
      page,
      evalRes: scoreWikiCandidatePage(page, criteria),
    }))
    .sort((a, b) => b.evalRes.score - a.evalRes.score);

  let diagnosticNote: string | undefined;

  for (const item of ranked) {
    const canRelaxForTitleOnly =
      !requireStrictScore &&
      !criteria.name &&
      !criteria.cardNumber &&
      !criteria.jpName &&
      item.evalRes.meta.hasCardTable;

    if (!item.evalRes.accepted && !canRelaxForTitleOnly) continue;

    const art = await extractPreferredArtworkFromPage(item.page, criteria);
    if (art) {
      return {
        hit: {
          url: art.url,
          file: art.file,
          title: item.page.title,
        },
      };
    }

    const imgFields = item.evalRes.meta.images.filter(Boolean);
    diagnosticNote = imgFields.length
      ? `Wiki page "${item.page.title}" lists |image=${imgFields[0]}, but file is missing from Wiki repository`
      : `Wiki page "${item.page.title}" has no non-icon card artwork`;
  }

  return { hit: null, diagnosticNote };
}

async function resolveWikiImageUrl(fileNames: string[]): Promise<string | null> {
  const cleanNames = fileNames
    .map((f) => f.replace(/^File:/i, '').trim())
    .filter((f) => Boolean(f) && !isNonCardWikiIcon(f));
  if (cleanNames.length === 0) return null;

  const now = Date.now();
  for (const name of cleanNames) {
    const cached = imageUrlCache.get(name.toLowerCase());
    if (cached && cached.expiresAt > now && cached.value && !isNonCardWikiIcon(cached.value)) {
      return cached.value;
    }
  }

  const uncached = cleanNames.filter((name) => {
    const cached = imageUrlCache.get(name.toLowerCase());
    return !cached || cached.expiresAt <= now;
  });

  if (uncached.length === 0) return null;

  const batchKey = `files:${uncached.map((f) => f.toLowerCase()).join('|')}`;
  const existingInflight = inflightImageUrl.get(batchKey);
  if (existingInflight) return existingInflight;

  const task = (async () => {
    try {
      const fileTitles = uncached.slice(0, 45).map((f) => `File:${f}`).join('|');
      const json = (await fetchWikiJson({
        action: 'query',
        titles: fileTitles,
        prop: 'imageinfo',
        iiprop: 'url',
      })) as {
        query?: {
          normalized?: { from: string; to: string }[];
          pages?: Record<
            string,
            { title?: string; imageinfo?: { url?: string }[] }
          >;
        };
      };

      const foundByTitle = new Map<string, string>();
      for (const page of Object.values(json.query?.pages || {})) {
        const url = page.imageinfo?.[0]?.url;
        if (page.title && url && !isNonCardWikiIcon(url)) {
          foundByTitle.set(page.title.replace(/^File:/i, '').toLowerCase(), url);
        }
      }
      for (const norm of json.query?.normalized || []) {
        const fromKey = norm.from.replace(/^File:/i, '').toLowerCase();
        const toKey = norm.to.replace(/^File:/i, '').toLowerCase();
        const url = foundByTitle.get(toKey);
        if (url) foundByTitle.set(fromKey, url);
      }

      for (const name of uncached) {
        const resolved = foundByTitle.get(name.toLowerCase()) || null;
        pruneImageUrlCache();
        imageUrlCache.set(name.toLowerCase(), {
          value: resolved,
          expiresAt: Date.now() + (resolved ? CACHE_TTL_MS * 12 : NEGATIVE_IMAGE_TTL_MS),
        });
      }

      for (const name of cleanNames) {
        const resolved = imageUrlCache.get(name.toLowerCase())?.value;
        if (resolved && !isNonCardWikiIcon(resolved)) return resolved;
      }
      return null;
    } catch {
      return null;
    } finally {
      inflightImageUrl.delete(batchKey);
    }
  })();

  inflightImageUrl.set(batchKey, task);
  return task;
}

export async function resolveCardArtworkWithTrace(
  input: CardLookupCriteria
): Promise<LookupResolutionTrace> {
  const criteria: CardLookupCriteria = {
    id: input.id?.trim() || undefined,
    fileName: input.fileName?.trim() || undefined,
    cardNumber: input.cardNumber?.trim() || undefined,
    wikiTitle: input.wikiTitle?.trim() || undefined,
    name: input.name?.trim() || undefined,
    jpName: input.jpName?.trim() || undefined,
    setCode:
      input.setCode?.trim() ||
      (input.cardNumber?.includes('-')
        ? input.cardNumber.split('-')[0].trim()
        : undefined),
    isRevival: input.isRevival,
  };

  const cacheKey = buildLookupCacheKey(criteria);
  const now = Date.now();
  const cached = lookupTraceCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = inflightLookupTrace.get(cacheKey);
  if (inflight) return inflight;

  const task = (async (): Promise<LookupResolutionTrace> => {
    const stagesAttempted: string[] = [];
    const discoveredResults = new Set<string>();
    const diagnosticNotes: string[] = [];

    const isSideB = Boolean(/\(B\)$/i.test(criteria.cardNumber || ''));
    const isRevival = Boolean(
      criteria.isRevival ||
        /\(revival\)/i.test(criteria.name || criteria.wikiTitle || '') ||
        /(?:^|-)RV[A-Z0-9]*\d/i.test(criteria.cardNumber || '') ||
        /^BSC22-/i.test(criteria.cardNumber || '')
    );

    const finalize = (trace: LookupResolutionTrace): LookupResolutionTrace => {
      pruneLookupTraceCache();
      lookupTraceCache.set(cacheKey, {
        value: trace,
        expiresAt:
          Date.now() + (trace.ok ? CACHE_TTL_MS * 12 : NEGATIVE_IMAGE_TTL_MS),
      });
      return trace;
    };

    try {
      // STAGE 0: Manual Verified Card Mapping (Highest Priority)
      const manual = findManualCardMapping({
        id: criteria.id,
        cardNumber: criteria.cardNumber,
        name: criteria.name || criteria.wikiTitle,
        wikiTitle: criteria.wikiTitle,
        isRevival,
      });
      if (manual) {
        stagesAttempted.push('stage0:manual-mapping');
        if (manual.artworkUrl && !isNonCardWikiIcon(manual.artworkUrl)) {
          return finalize({
            ok: true,
            wikiUrl: manual.artworkUrl,
            resolvedFile: extractFilenameFromWikiUrl(manual.artworkUrl),
            resolvedTitle: manual.wikiTitle || criteria.wikiTitle || null,
            stage: 'stage0:manual-mapping',
            stagesAttempted,
            wikiSearchResults: Array.from(discoveredResults),
            failureReason: null,
            needsManualMapping: false,
          });
        }
        if (manual.fileName) {
          const manualCands = expandWikiFileCandidates(
            manual.fileName,
            criteria.cardNumber,
            { isSideB, isRevival }
          );
          const resolvedManual = await resolveWikiImageUrlWithFile(manualCands);
          if (resolvedManual) {
            return finalize({
              ok: true,
              wikiUrl: resolvedManual.url,
              resolvedFile: resolvedManual.file,
              resolvedTitle: manual.wikiTitle || criteria.wikiTitle || null,
              stage: 'stage0:manual-mapping',
              stagesAttempted,
              wikiSearchResults: Array.from(discoveredResults),
              failureReason: null,
              needsManualMapping: false,
            });
          }
        }
        if (manual.wikiTitle) {
          const pageRes = await tryResolveFromCandidateTitles(
            [manual.wikiTitle],
            { ...criteria, wikiTitle: manual.wikiTitle },
            discoveredResults,
            false
          );
          if (pageRes.hit) {
            return finalize({
              ok: true,
              wikiUrl: pageRes.hit.url,
              resolvedFile: pageRes.hit.file,
              resolvedTitle: pageRes.hit.title,
              stage: 'stage0:manual-mapping',
              stagesAttempted,
              wikiSearchResults: Array.from(discoveredResults),
              failureReason: null,
              needsManualMapping: false,
            });
          }
        }
      }

      // Fast-Path Direct File Check when an explicit artwork filename is provided
      if (criteria.fileName && isCardArtworkFile(criteria.fileName)) {
        stagesAttempted.push('stage1:direct-file');
        const fileCands = expandWikiFileCandidates(criteria.fileName, undefined, {
          isSideB,
          isRevival,
        });
        const directHit = await resolveWikiImageUrlWithFile(fileCands);
        if (directHit) {
          return finalize({
            ok: true,
            wikiUrl: directHit.url,
            resolvedFile: directHit.file,
            resolvedTitle: criteria.wikiTitle || criteria.name || null,
            stage: 'stage1:direct-file',
            stagesAttempted,
            wikiSearchResults: Array.from(discoveredResults),
            failureReason: null,
            needsManualMapping: false,
          });
        }
      }

      // STAGE 1: Exact Card Name / Wiki Page Title Lookup (with redirects=1 + CardTable verification)
      const exactTitleList = Array.from(
        new Set([criteria.wikiTitle, criteria.name].filter((x): x is string => Boolean(x)))
      );
      if (exactTitleList.length > 0) {
        stagesAttempted.push('stage1:exact-name-page');
        const exactRes = await tryResolveFromCandidateTitles(
          exactTitleList,
          criteria,
          discoveredResults,
          true
        );
        if (exactRes.hit) {
          return finalize({
            ok: true,
            wikiUrl: exactRes.hit.url,
            resolvedFile: exactRes.hit.file,
            resolvedTitle: exactRes.hit.title,
            stage: 'stage1:exact-name-page',
            stagesAttempted,
            wikiSearchResults: Array.from(discoveredResults),
            failureReason: null,
            needsManualMapping: false,
          });
        }
        if (exactRes.diagnosticNote) diagnosticNotes.push(exactRes.diagnosticNote);
      }

      // STAGE 2: Card Number / Card ID Lookup (File candidates first, then MediaWiki list=search)
      const cleanCardNumber = (criteria.cardNumber || '').trim();
      const hasValidNumber =
        cleanCardNumber &&
        cleanCardNumber.toUpperCase() !== 'WIKI' &&
        /[A-Z0-9]{2,}-[A-Z0-9]+/i.test(cleanCardNumber);
      if (hasValidNumber) {
        stagesAttempted.push('stage2:card-number');
        const numCands = expandWikiFileCandidates(undefined, cleanCardNumber, {
          isSideB,
          isRevival,
        });
        if (numCands.length > 0) {
          const numFileHit = await resolveWikiImageUrlWithFile(numCands);
          if (numFileHit) {
            return finalize({
              ok: true,
              wikiUrl: numFileHit.url,
              resolvedFile: numFileHit.file,
              resolvedTitle: criteria.wikiTitle || criteria.name || null,
              stage: 'stage2:card-number-file',
              stagesAttempted,
              wikiSearchResults: Array.from(discoveredResults),
              failureReason: null,
              needsManualMapping: false,
            });
          }
        }

        const baseNumberOnly = cleanCardNumber.replace(/\s*\([AB]\)$/i, '').trim();
        const numSearchTitles = await searchWikiPageTitles(`"${baseNumberOnly}"`, 8);
        for (const t of numSearchTitles) discoveredResults.add(t);
        if (numSearchTitles.length > 0) {
          const numPageRes = await tryResolveFromCandidateTitles(
            numSearchTitles,
            criteria,
            discoveredResults,
            true
          );
          if (numPageRes.hit) {
            return finalize({
              ok: true,
              wikiUrl: numPageRes.hit.url,
              resolvedFile: numPageRes.hit.file,
              resolvedTitle: numPageRes.hit.title,
              stage: 'stage2:card-number-search',
              stagesAttempted,
              wikiSearchResults: Array.from(discoveredResults),
              failureReason: null,
              needsManualMapping: false,
            });
          }
          if (numPageRes.diagnosticNote) diagnosticNotes.push(numPageRes.diagnosticNote);
        }
      }

      // STAGE 3: Normalized Card Name (punctuation, spaces, hyphens, apostrophes, Roman<->Arabic)
      const seedName = criteria.name || criteria.wikiTitle || '';
      if (seedName) {
        stagesAttempted.push('stage3:normalized-name');
        const romanArabic = generateRomanArabicVariants(seedName);
        const normalizedClean = normalizeCardSearchText(seedName);
        const titledVariants = Array.from(
          new Set([
            ...romanArabic,
            ...romanArabic.map((v) =>
              v
                .split(/\s+/)
                .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
                .join(' ')
            ),
            normalizedClean
              .split(' ')
              .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
              .join(' '),
          ])
        ).filter((v) => !exactTitleList.includes(v));

        if (titledVariants.length > 0) {
          const normTitleRes = await tryResolveFromCandidateTitles(
            titledVariants.slice(0, 8),
            criteria,
            discoveredResults,
            true
          );
          if (normTitleRes.hit) {
            return finalize({
              ok: true,
              wikiUrl: normTitleRes.hit.url,
              resolvedFile: normTitleRes.hit.file,
              resolvedTitle: normTitleRes.hit.title,
              stage: 'stage3:normalized-name',
              stagesAttempted,
              wikiSearchResults: Array.from(discoveredResults),
              failureReason: null,
              needsManualMapping: false,
            });
          }
          if (normTitleRes.diagnosticNote) diagnosticNotes.push(normTitleRes.diagnosticNote);
        }

        const searchQueries = Array.from(
          new Set(
            [normalizedClean, ...romanArabic.map((r) => normalizeCardSearchText(r))].filter(
              (q) => q.length >= 3
            )
          )
        ).slice(0, 3);

        for (const sq of searchQueries) {
          const hitTitles = await searchWikiPageTitles(sq, 8);
          for (const t of hitTitles) discoveredResults.add(t);
          if (hitTitles.length > 0) {
            const sr = await tryResolveFromCandidateTitles(
              hitTitles,
              criteria,
              discoveredResults,
              true
            );
            if (sr.hit) {
              return finalize({
                ok: true,
                wikiUrl: sr.hit.url,
                resolvedFile: sr.hit.file,
                resolvedTitle: sr.hit.title,
                stage: 'stage3:normalized-name-search',
                stagesAttempted,
                wikiSearchResults: Array.from(discoveredResults),
                failureReason: null,
                needsManualMapping: false,
              });
            }
            if (sr.diagnosticNote) diagnosticNotes.push(sr.diagnosticNote);
          }
        }
      }

      // STAGE 4: Alternate Name Formats & Known Aliases (subtitle-stripped, (Card), alias spelling)
      const altCandidates = buildAlternateTitleCandidates(criteria).filter(
        (t) => !exactTitleList.includes(t)
      );
      if (altCandidates.length > 0) {
        stagesAttempted.push('stage4:alternate-aliases');
        const altRes = await tryResolveFromCandidateTitles(
          altCandidates.slice(0, 10),
          criteria,
          discoveredResults,
          true
        );
        if (altRes.hit) {
          return finalize({
            ok: true,
            wikiUrl: altRes.hit.url,
            resolvedFile: altRes.hit.file,
            resolvedTitle: altRes.hit.title,
            stage: 'stage4:alternate-aliases',
            stagesAttempted,
            wikiSearchResults: Array.from(discoveredResults),
            failureReason: null,
            needsManualMapping: false,
          });
        }
        if (altRes.diagnosticNote) diagnosticNotes.push(altRes.diagnosticNote);

        // Search alias strings if direct page check missed
        const lowerSeed = seedName.toLowerCase();
        for (const [aliasKey, reps] of Object.entries(KNOWN_CARD_NAME_ALIASES)) {
          if (!lowerSeed.includes(aliasKey)) continue;
          for (const rep of reps) {
            const aliasQuery = seedName.replace(new RegExp(aliasKey, 'gi'), rep);
            const aliasSearchHits = await searchWikiPageTitles(aliasQuery, 6);
            for (const t of aliasSearchHits) discoveredResults.add(t);
            if (aliasSearchHits.length > 0) {
              const aliasRes = await tryResolveFromCandidateTitles(
                aliasSearchHits,
                criteria,
                discoveredResults,
                true
              );
              if (aliasRes.hit) {
                return finalize({
                  ok: true,
                  wikiUrl: aliasRes.hit.url,
                  resolvedFile: aliasRes.hit.file,
                  resolvedTitle: aliasRes.hit.title,
                  stage: 'stage4:alternate-aliases',
                  stagesAttempted,
                  wikiSearchResults: Array.from(discoveredResults),
                  failureReason: null,
                  needsManualMapping: false,
                });
              }
            }
          }
        }
      }

      // STAGE 5: Original Japanese Name (`jpName`) Search
      const cleanJp = (criteria.jpName || '').trim();
      const detectedJp =
        cleanJp ||
        (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(seedName) ? seedName : '');
      if (detectedJp) {
        stagesAttempted.push('stage5:japanese-name');
        const jpVariants = Array.from(
          new Set([
            detectedJp,
            detectedJp.replace(/[・\s]+/g, ' ').trim(),
          ])
        ).filter(Boolean);

        for (const jq of jpVariants) {
          const jpHits = await searchWikiPageTitles(jq, 10);
          for (const t of jpHits) discoveredResults.add(t);
          if (jpHits.length > 0) {
            const jpRes = await tryResolveFromCandidateTitles(
              jpHits,
              { ...criteria, jpName: detectedJp },
              discoveredResults,
              true
            );
            if (jpRes.hit) {
              return finalize({
                ok: true,
                wikiUrl: jpRes.hit.url,
                resolvedFile: jpRes.hit.file,
                resolvedTitle: jpRes.hit.title,
                stage: 'stage5:japanese-name',
                stagesAttempted,
                wikiSearchResults: Array.from(discoveredResults),
                failureReason: null,
                needsManualMapping: false,
              });
            }
            if (jpRes.diagnosticNote) diagnosticNotes.push(jpRes.diagnosticNote);
          }
        }
      }

      // STAGE 6: Set Code + Card Number Lookup (Wiki Search + Set Table Cross-Reference)
      const setUpper = (criteria.setCode || '').trim().toUpperCase();
      if (setUpper && setUpper !== 'WIKI' && (cleanCardNumber || seedName)) {
        stagesAttempted.push('stage6:set-plus-number');
        const setQueries = Array.from(
          new Set(
            [
              cleanCardNumber ? `"${setUpper}" "${cleanCardNumber}"` : '',
              cleanCardNumber
                ? `${setUpper} ${cleanCardNumber.replace(/\s*\([AB]\)$/i, '')}`
                : '',
              seedName ? `${setUpper} ${stripCardNameDecorations(seedName)}` : '',
            ].filter(Boolean)
          )
        );
        for (const sq of setQueries) {
          const sHits = await searchWikiPageTitles(sq, 8);
          for (const t of sHits) discoveredResults.add(t);
          if (sHits.length > 0) {
            const sRes = await tryResolveFromCandidateTitles(
              sHits,
              criteria,
              discoveredResults,
              true
            );
            if (sRes.hit) {
              return finalize({
                ok: true,
                wikiUrl: sRes.hit.url,
                resolvedFile: sRes.hit.file,
                resolvedTitle: sRes.hit.title,
                stage: 'stage6:set-plus-number',
                stagesAttempted,
                wikiSearchResults: Array.from(discoveredResults),
                failureReason: null,
                needsManualMapping: false,
              });
            }
          }
        }

        // Cross-reference set page card table if set exists in DIRECTORY_MAP
        const setEntry = DIRECTORY_MAP.get(setUpper);
        if (setEntry && hasValidNumber) {
          const setPageMap = await batchFetchWikiPages([setEntry.wikiTitle || setUpper]);
          const setBundle = setPageMap.get(setEntry.wikiTitle || setUpper);
          if (setBundle?.wikitext) {
            const parsedRows = parseSetTableRows(setBundle.wikitext, setEntry);
            const normTargetNum = normalizeCompact(
              cleanCardNumber.replace(/\s*\([AB]\)$/i, '')
            );
            const matchingRows = parsedRows.filter(
              (r) =>
                normalizeCompact(r.cardNumber.replace(/\s*\([AB]\)$/i, '')) ===
                normTargetNum
            );
            const discoveredTitles = matchingRows
              .map((r) => r.wikiTitle)
              .filter((t): t is string => Boolean(t));
            if (discoveredTitles.length > 0) {
              const rowRes = await tryResolveFromCandidateTitles(
                discoveredTitles,
                criteria,
                discoveredResults,
                true
              );
              if (rowRes.hit) {
                return finalize({
                  ok: true,
                  wikiUrl: rowRes.hit.url,
                  resolvedFile: rowRes.hit.file,
                  resolvedTitle: rowRes.hit.title,
                  stage: 'stage6:set-table-crossref',
                  stagesAttempted,
                  wikiSearchResults: Array.from(discoveredResults),
                  failureReason: null,
                  needsManualMapping: false,
                });
              }
            }
          }
        }
      }

      // STAGE 7: OpenSearch & Redirect Resolution
      const openQuery = stripCardNameDecorations(seedName) || cleanCardNumber;
      if (openQuery && openQuery.length >= 3) {
        stagesAttempted.push('stage7:opensearch-redirects');
        const openQueries = Array.from(
          new Set([openQuery, ...generateRomanArabicVariants(openQuery)])
        ).slice(0, 2);

        for (const oq of openQueries) {
          const openHits = await opensearchWikiTitles(oq, 8);
          for (const t of openHits) discoveredResults.add(t);
          if (openHits.length > 0) {
            const openRes = await tryResolveFromCandidateTitles(
              openHits,
              criteria,
              discoveredResults,
              true
            );
            if (openRes.hit) {
              return finalize({
                ok: true,
                wikiUrl: openRes.hit.url,
                resolvedFile: openRes.hit.file,
                resolvedTitle: openRes.hit.title,
                stage: 'stage7:opensearch-redirects',
                stagesAttempted,
                wikiSearchResults: Array.from(discoveredResults),
                failureReason: null,
                needsManualMapping: false,
              });
            }
            if (openRes.diagnosticNote) diagnosticNotes.push(openRes.diagnosticNote);
          }
        }
      }

      const failureReason =
        diagnosticNotes[0] ||
        (discoveredResults.size > 0
          ? `Searched ${discoveredResults.size} Wiki candidate(s), none passed validation with valid non-icon card artwork`
          : 'No matching Battle Spirits Wiki page or File image found across Stages 1-7');

      return finalize({
        ok: false,
        wikiUrl: null,
        resolvedFile: null,
        resolvedTitle: null,
        stage: null,
        stagesAttempted,
        wikiSearchResults: Array.from(discoveredResults),
        failureReason,
        needsManualMapping: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wiki lookup error';
      return finalize({
        ok: false,
        wikiUrl: null,
        resolvedFile: null,
        resolvedTitle: null,
        stage: null,
        stagesAttempted,
        wikiSearchResults: Array.from(discoveredResults),
        failureReason: msg,
        needsManualMapping: true,
      });
    } finally {
      inflightLookupTrace.delete(cacheKey);
    }
  })();

  inflightLookupTrace.set(cacheKey, task);
  return task;
}

export async function resolveWikiCardImageMetadata(
  fileNameOrCriteria: string | CardLookupCriteria,
  fallbackNumber?: string,
  wikiTitle?: string,
  extra?: Partial<CardLookupCriteria>
): Promise<{
  ok: boolean;
  wikiUrl: string | null;
  proxyUrl: string;
  resolvedFile?: string | null;
  resolvedTitle?: string | null;
  stage?: string | null;
  stagesAttempted?: string[];
  wikiSearchResults?: string[];
  failureReason?: string | null;
  needsManualMapping?: boolean;
}> {
  const criteria = normalizeLookupCriteria(
    fileNameOrCriteria,
    fallbackNumber,
    wikiTitle,
    extra
  );
  const trace = await resolveCardArtworkWithTrace(criteria);

  const params = new URLSearchParams();
  if (criteria.fileName) params.set('file', criteria.fileName);
  if (criteria.cardNumber) params.set('fallback', criteria.cardNumber);
  if (criteria.wikiTitle) params.set('title', criteria.wikiTitle);
  if (criteria.name) params.set('name', criteria.name);
  if (criteria.jpName) params.set('jp', criteria.jpName);
  if (criteria.setCode) params.set('set', criteria.setCode);
  if (criteria.isRevival) params.set('rv', '1');
  if (criteria.id) params.set('id', criteria.id);

  return {
    ok: trace.ok,
    wikiUrl: trace.wikiUrl,
    proxyUrl: `/api/wiki/image?${params.toString()}`,
    resolvedFile: trace.resolvedFile,
    resolvedTitle: trace.resolvedTitle,
    stage: trace.stage,
    stagesAttempted: trace.stagesAttempted,
    wikiSearchResults: trace.wikiSearchResults,
    failureReason: trace.failureReason,
    needsManualMapping: trace.needsManualMapping,
  };
}

export async function fetchWikiImageBytes(
  fileNameOrCriteria: string | CardLookupCriteria,
  fallbackNumber?: string,
  wikiTitle?: string,
  extra?: Partial<CardLookupCriteria>
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const criteria = normalizeLookupCriteria(
    fileNameOrCriteria,
    fallbackNumber,
    wikiTitle,
    extra
  );
  const reqKey = buildLookupCacheKey(criteria);
  const now = Date.now();
  const cachedBytes = imageBytesCache.get(reqKey);
  if (cachedBytes && cachedBytes.expiresAt > now) {
    return cachedBytes.value;
  }

  const inflight = inflightImageBytes.get(reqKey);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const trace = await resolveCardArtworkWithTrace(criteria);
      if (!trace.ok || !trace.wikiUrl) return null;

      const res = await withWikiSemaphore(() =>
        fetchWithRetry(
          trace.wikiUrl!,
          {
            headers: {
              'User-Agent': USER_AGENT,
              Referer: 'https://battle-spirits.fandom.com/',
            },
          },
          2,
          12000
        )
      );
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const entry = { buffer: Buffer.from(arrayBuf), contentType };
      setBoundedImageBytesCache(reqKey, entry);
      return entry;
    } catch {
      return null;
    } finally {
      inflightImageBytes.delete(reqKey);
    }
  })();

  inflightImageBytes.set(reqKey, task);
  return task;
}

export function getManualCardMappingsList(): ManualCardMapping[] {
  return listManualCardMappings();
}

export async function runMissingArtworkDiagnostic(options?: {
  cards?: BattleSpiritsCard[];
  setCode?: string;
  limit?: number;
  onlyMissing?: boolean;
  concurrency?: number;
}): Promise<{
  totalChecked: number;
  matchedCount: number;
  missingCount: number;
  needsManualMappingCount: number;
  records: ArtworkDiagnosticRecord[];
}> {
  let targetCards = options?.cards;
  if (!targetCards) {
    const cardsJsonPath = path.resolve(process.cwd(), 'public', 'cards.json');
    if (fs.existsSync(cardsJsonPath)) {
      const raw = JSON.parse(fs.readFileSync(cardsJsonPath, 'utf8')) as {
        cards?: BattleSpiritsCard[];
      };
      targetCards = Array.isArray(raw.cards) ? raw.cards : [];
    } else {
      targetCards = [];
    }
  }

  if (options?.setCode) {
    const sc = options.setCode.trim().toUpperCase();
    targetCards = targetCards.filter((c) => (c.setCode || '').toUpperCase() === sc);
  }
  if (options?.limit && options.limit > 0) {
    targetCards = targetCards.slice(0, options.limit);
  }

  const concurrency = Math.max(1, Math.min(10, options?.concurrency ?? 8));
  const results: ArtworkDiagnosticRecord[] = new Array(targetCards.length);
  let cursor = 0;

  const extractCriteriaFromCard = (c: BattleSpiritsCard): CardLookupCriteria => {
    let file = '';
    let fallback = c.cardNumber;
    let title = c.wikiTitle || c.name;
    try {
      const u = new URL(c.artworkImage || '', 'http://localhost');
      file = u.searchParams.get('file') || '';
      fallback = u.searchParams.get('fallback') || c.cardNumber;
      title = u.searchParams.get('title') || c.wikiTitle || c.name;
    } catch {
      if (c.artworkImage && !c.artworkImage.startsWith('/')) {
        file = c.artworkImage;
      }
    }
    return {
      id: c.id,
      fileName: file || undefined,
      cardNumber: fallback || undefined,
      wikiTitle: title || undefined,
      name: c.name,
      jpName: c.jpName,
      setCode: c.setCode,
      isRevival: c.isRevival,
    };
  };

  // Prewarm File: URL cache in 45-item batches when auditing many cards so 2,000+ card diagnostics complete quickly
  const allCriteria = targetCards.map(extractCriteriaFromCard);
  if (allCriteria.length > 15) {
    const uniqueFiles = new Set<string>();
    const nowPrewarm = Date.now();
    for (const cr of allCriteria) {
      const manual = findManualCardMapping({
        id: cr.id,
        cardNumber: cr.cardNumber,
        name: cr.name || cr.wikiTitle,
        wikiTitle: cr.wikiTitle,
        isRevival: cr.isRevival,
      });
      if (manual?.fileName) {
        const mc = expandWikiFileCandidates(manual.fileName, undefined)[0];
        if (mc) uniqueFiles.add(mc);
      }
      if (cr.fileName && isCardArtworkFile(cr.fileName)) {
        for (const cand of expandWikiFileCandidates(cr.fileName, undefined)) {
          uniqueFiles.add(cand);
        }
      }
    }
    const uncachedFiles = Array.from(uniqueFiles).filter((f) => {
      const entry = imageUrlCache.get(f.toLowerCase());
      return !entry || entry.expiresAt <= nowPrewarm;
    });
    const chunks: string[][] = [];
    for (let i = 0; i < uncachedFiles.length; i += 45) {
      chunks.push(uncachedFiles.slice(i, i + 45));
    }
    let chunkCursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, Math.max(1, chunks.length)) }, async () => {
        while (true) {
          const ci = chunkCursor++;
          if (ci >= chunks.length) break;
          await resolveWikiImageUrl(chunks[ci]).catch(() => null);
        }
      })
    );
  }

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= targetCards!.length) break;
      const card = targetCards![idx];
      const criteria = allCriteria[idx];
      const trace = await resolveCardArtworkWithTrace(criteria);
      results[idx] = {
        cardId: card.id,
        cardName: card.name,
        cardNumber: card.cardNumber,
        setCode: card.setCode,
        searchMethodAttempted: trace.stagesAttempted[0] || 'stage1:exact-name-page',
        stagesAttempted: trace.stagesAttempted,
        wikiSearchResults: trace.wikiSearchResults,
        resolvedUrl: trace.wikiUrl,
        resolvedFile: trace.resolvedFile,
        resolvedStage: trace.stage,
        ok: trace.ok,
        failureReason: trace.failureReason,
        needsManualMapping: trace.needsManualMapping,
      };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, targetCards.length)) }, () =>
      worker()
    )
  );

  const matchedCount = results.filter((r) => r.ok).length;
  const missingCount = results.length - matchedCount;
  const needsManualMappingCount = results.filter((r) => r.needsManualMapping).length;
  const filteredRecords = options?.onlyMissing
    ? results.filter((r) => !r.ok || r.needsManualMapping)
    : results;

  return {
    totalChecked: results.length,
    matchedCount,
    missingCount,
    needsManualMappingCount,
    records: filteredRecords,
  };
}
