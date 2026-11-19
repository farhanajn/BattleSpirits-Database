#!/usr/bin/env node
/**
 * Standalone Battle Spirits Wiki Data Exporter
 *
 * Fetches sets, cards, English translations, rulings Q&A, and banlist restrictions
 * from battle-spirits.fandom.com and writes clean normalized data into public/cards.json
 * pointing artwork directly at the runtime /api/wiki/image proxy (zero local card image bloat).
 *
 * Usage:
 *   node download-data.js
 *   node download-data.js --sets=26RBS01,BS77,TOKENS
 *   node download-data.js --download-images
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');
const CARDS_JSON_PATH = path.join(PUBLIC_DIR, 'cards.json');
const SET_METADATA_TS_PATH = path.join(__dirname, 'server', 'setMetadata.ts');

const WIKI_API = 'https://battle-spirits.fandom.com/api.php';
const WIKI_BASE = 'https://battle-spirits.fandom.com/wiki/';
const USER_AGENT = 'BattleSpiritsDBOfflineSync/1.0 (https://battle-spirits.fandom.com)';

const ALL_COLORS = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];

const args = process.argv.slice(2);
const getArgVal = (prefix) => {
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};
const hasFlag = (flag) => args.includes(flag);

const requestedSetsRaw = getArgVal('--sets=');
const requestedSets = requestedSetsRaw
  ? requestedSetsRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  : null;
const maxSetsArg = getArgVal('--max-sets=');
const maxSets = maxSetsArg ? Math.max(1, Number(maxSetsArg) || 999) : null;
const downloadImagesLocally = hasFlag('--download-images');
const skipImages = !downloadImagesLocally || hasFlag('--no-images');
const freshMode = hasFlag('--fresh');
const imgConcurrency = Math.max(2, Math.min(24, Number(getArgVal('--concurrency=') || 12) || 12));
const maxAltImagesPerCard = Math.max(
  1,
  Math.min(10, Number(getArgVal('--max-art-per-card=') || 3) || 3)
);

const KNOWN_SET_META = {
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
    name: 'Contract Saga: Proof Volume 1 – Radiance of the Eternal Kings',
    releaseDate: 'May 30th, 2026',
    tagline: 'First Eternal Booster introducing Contract Nexuses and the Bannerace archetype.',
    colors: ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'],
  },
  BS75: {
    name: 'Contract Saga: Cycle Volume 4 – Assembling Heroes',
    releaseDate: 'February 14th, 2026',
    tagline: 'Final chapter of Contract Saga: Cycle featuring Indra and Khaos.',
    colors: ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'],
  },
  BS72: {
    name: 'Contract Saga: Cycle Volume 1 – Return and Reawake',
    releaseDate: 'May 17th, 2025',
    tagline: 'Introduces Contract Grandwalker Artemis, Nyx, Lugh, and AX-Rares.',
    colors: ['Red', 'Purple', 'White'],
  },
  BS71: {
    name: 'Contract Saga: True Volume 4 – Return of the King of Gods',
    releaseDate: 'Jan 25th, 2025',
    tagline: 'Crowning chapter of Contract Saga: True featuring Zeus and Olym deities.',
    colors: ['Red', 'Yellow'],
  },
  BS68: {
    name: 'Contract Saga: True Volume 1 – Battle of the Gods',
    releaseDate: 'April 27th, 2024',
    tagline: 'Introduced Contract Grandwalker Nexuses led by Hades and Athena.',
    colors: ['Purple', 'White'],
  },
  BS62: {
    name: 'Contract Saga Volume 3 – Rise of Rivals',
    releaseDate: '2022',
    tagline: 'Contract Era booster featuring XX-Rares and high-impact Ultimates.',
    colors: ['Yellow', 'Blue'],
  },
  BS52: {
    name: 'Rebirth Saga Volume 1 – The Returner',
    releaseDate: 'April 25th, 2020',
    tagline: 'Introduced Rebirth double-sided cards.',
    colors: ['Green', 'Purple', 'White'],
  },
  BS45: {
    name: 'Grand Advent Saga Volume 2 – Reincarnating Ultimate Deity',
    releaseDate: 'July 28th, 2018',
    tagline: 'Advent Era set featuring Grandwalker Nexuses and Divine Spirits.',
    colors: ['White', 'Purple', 'Yellow', 'Blue'],
  },
  BS19: {
    name: 'Sword Generation',
    releaseDate: 'October 13, 2012',
    tagline: 'Introduced Sword Braves and Curse/Trash recursion staples.',
    colors: ['Purple', 'Green', 'Blue'],
  },
  BS09: {
    name: 'Crush of Supernova',
    releaseDate: 'August 6, 2010',
    tagline: 'Home of Supernova Dragon Siegwurm Nova and Meteor Storm.',
    colors: ['Red', 'Purple', 'Yellow', 'Green'],
  },
  BS01: {
    name: 'Dawn of the Spirit (Call of the Core)',
    releaseDate: 'Sep 13, 2008',
    tagline: 'The inaugural Battle Spirits booster set introducing Awaken, High Speed, and Siegfried.',
    colors: ['Red', 'Purple', 'White', 'Green'],
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

const PROMO_PAGES = [
  {
    setCode: 'RP26-STD',
    wikiTitle: 'Standard Promo Cards/Regular Promos',
    name: 'Standard Format Regular Promos (RP26)',
    formats: ['Standard', 'Eternal'],
    releaseDate: 'Apr 2026+',
    tagline: 'Official Standard-legal regular promo cards (RP26 series).',
  },
  {
    setCode: 'PX26-STD',
    wikiTitle: 'Standard Promo Cards/Promo X-Rares',
    name: 'Standard Format Promo X-Rares (PX26)',
    formats: ['Standard', 'Eternal'],
    releaseDate: 'Apr 2026+',
    tagline: 'Official Standard-legal Promo X-Rares.',
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

const TK_TEXT_MAP = {
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

const STANDARD_KEYWORDS = [
  'Clash',
  'Awaken',
  'Curse',
  'Armor',
  'Heavy Armor',
  'Immune',
  'Brilliance',
  'High Speed',
  'Crush',
  'Great Crush',
  'Burst',
  'Soul Core',
  'Soul Burst',
  'Shadow',
  'Whirlwind',
  'Windstorm',
  'Charge',
  'Rush',
  'Divine Speed',
  'Ultimate Trigger',
  'Advent',
  'Contract Advent',
  'Ultra Advent',
  'Grand Advent',
  'Flag Contract Advent',
  'Core Charge',
  'Neo-Core Charge',
  'Release',
  'True Release',
  'Ultra Release',
  'Mirage',
  'Rebirth',
  'Grand Skill',
  'Grand Field',
  'Contract Skill',
  'Soul Magic',
  'Blood Curse',
  'Blood Crystal',
  'Manifest',
  'Zero Counter',
  'Acceleration',
  'Flash',
  'Main',
];

async function loadWikiSetMetadata() {
  try {
    const raw = await fs.readFile(SET_METADATA_TS_PATH, 'utf8');
    const eqIdx = raw.indexOf('= {');
    const startIdx = eqIdx !== -1 ? eqIdx + 2 : raw.indexOf('{');
    const endIdx = raw.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      return JSON.parse(raw.slice(startIdx, endIdx + 1));
    }
  } catch {
    // Fallback cleanly
  }
  return {};
}

function buildDirectory(WIKI_SET_METADATA) {
  const list = [];

  const standardBoosters = [
    '26RBS04',
    '26RBS03',
    '26RBS02',
    '26RBS01',
    '26REB01',
    '26RDB01',
    '26RCB03',
    '26RCB02',
    '26RCB01',
  ];
  for (const code of standardBoosters) {
    const known = KNOWN_SET_META[code];
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || known?.name || code;
    list.push({
      setCode: code,
      wikiTitle: wikiMeta?.wikiTitle || code,
      category: 'Standard Booster',
      name: setName,
      jpName: '',
      productType: 'Booster Set',
      releaseDate: wikiMeta?.releaseDate || known?.releaseDate || '2026+',
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
      wikiTitle: wikiMeta?.wikiTitle || code,
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
          : `${code} — Battle Spirits Standard Format starter deck.`,
      featuredCardId: `${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  for (let n = 77; n >= 1; n--) {
    const code = `BS${String(n).padStart(2, '0')}`;
    const known = KNOWN_SET_META[code];
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || known?.name || code;
    list.push({
      setCode: code,
      wikiTitle: wikiMeta?.wikiTitle || code,
      category: 'Booster',
      name: setName,
      jpName: '',
      productType: 'Booster Set',
      releaseDate:
        wikiMeta?.releaseDate || known?.releaseDate || (n >= 76 ? '2026' : n >= 68 ? '2024–2026' : 'Eternal Era'),
      formats: ['Eternal'],
      blockLabel: n >= 76 ? 'Eternal Booster' : 'Eternal Format (BS01–BS75)',
      isLatestEternal: code === 'BS77',
      tagline:
        known?.tagline ||
        (setName !== code ? `${setName} (${code}) — Main Booster expansion.` : `${code} — Main Booster expansion.`),
      featuredCardId: `${code.toLowerCase()}-001`,
      colors: known?.colors || ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

  for (let n = 70; n >= 1; n--) {
    const code = `SD${String(n).padStart(2, '0')}`;
    const known = KNOWN_SET_META[code];
    const wikiMeta = WIKI_SET_METADATA[code];
    const setName = wikiMeta?.name || known?.name || code;
    list.push({
      setCode: code,
      wikiTitle: wikiMeta?.wikiTitle || code,
      category: 'Starter Deck',
      name: setName,
      jpName: '',
      productType: setName.toLowerCase().includes('mega') ? 'Mega Deck' : 'Starter Deck',
      releaseDate: wikiMeta?.releaseDate || known?.releaseDate || 'Eternal Era',
      formats: ['Eternal'],
      blockLabel: 'Eternal Starter / Mega Deck',
      tagline:
        known?.tagline ||
        (setName !== code ? `${setName} (${code}) — Pre-constructed Deck.` : `${code} — Pre-constructed Deck.`),
      featuredCardId: `${code.toLowerCase()}-001`,
      colors: known?.colors || ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

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
          ? `${cbxName} (${cbxCode}) — Extra Collaboration Booster.`
          : `${cbxCode} — Extra Collaboration Booster.`,
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
      tagline: setName !== code ? `${setName} (${code}) — Collaboration Booster.` : `${code} — Collaboration Booster.`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

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
          ? `${setName} (${code}) — Supplementary / Diva / X-Rare expansion.`
          : `${code} — Supplementary / Diva / X-Rare expansion.`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

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
          : `${code} — Premium Bandai limited edition release.`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(wikiTitle)}`,
    });
  }

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
      tagline: setName !== code ? `${setName} (${code}) — Retail Premium Card Set.` : `${code} — Retail Premium Card Set.`,
      featuredCardId: `${code.toLowerCase()}-${code.toLowerCase()}-001`,
      colors: ALL_COLORS,
      totalCardsInSet: 0,
      wikiUrl: `${WIKI_BASE}${encodeURIComponent(code)}`,
    });
  }

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
    tagline: 'Complete Battle Spirits Revival collection (BSC22, BS35–BS77 RV, SD & Promo Revivals).',
    featuredCardId: 'revival-blizzard-wall',
    colors: ALL_COLORS,
    totalCardsInSet: 0,
    wikiUrl: `${WIKI_BASE}Category:Revival_Cards`,
  });

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

async function fetchWikiJson(params, retries = 3) {
  const search = new URLSearchParams({ ...params, format: 'json' });
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${WIKI_API}?${search.toString()}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          continue;
        }
        throw new Error(`Wiki API HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('Wiki API request failed');
}

function normalizeBanKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/\s*\(revival\)\s*/gi, '')
    .replace(/\s+/g, ' ');
}

function normalizeCardCodeKey(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function buildSeedBanListSnapshot() {
  const byName = {};
  const seedNames = [
    'The SevenShogunDemon Beelzebub',
    'The SevenShogun Demon Belzeebub',
    'Fruit of Life',
    'Dark Knight Mordred',
    'The CrimsonDragonLord Kaiser-Atlas',
  ];
  for (const name of seedNames) {
    byName[normalizeBanKey(name)] = 'Restricted <1>';
  }
  return {
    effectiveDate: 'Official Ban/Limit Seed',
    byCardNumber: { 'P16-26': 'Restricted <20>' },
    byName,
  };
}

function parseBanListWikitext(wikitext) {
  const snapshot = buildSeedBanListSnapshot();
  const dateMatch = wikitext.match(/effective from\s+'''([^']+)'''/i);
  if (dateMatch) snapshot.effectiveDate = dateMatch[1].trim();

  const headingRegex = /^(={2,3})\s*([^=\n]+?)\s*\1/gm;
  const sections = [];
  let m;
  while ((m = headingRegex.exec(wikitext)) !== null) {
    if (sections.length > 0) sections[sections.length - 1].end = m.index;
    sections.push({ title: m[2].trim(), start: m.index + m[0].length, end: wikitext.length });
  }

  const applyEntry = (restriction, namesRaw, numbersRaw, isRevival) => {
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
        if (!snapshot.byName[baseKey]) snapshot.byName[baseKey] = restriction;
      }
    }

    const codeTokens = numbersRaw
      .split(/[/,\s]+/)
      .map((c) => normalizeCardCodeKey(c))
      .filter((c) => /^[A-Z0-9-]+$/.test(c) && /\d/.test(c));

    for (const code of codeTokens) {
      snapshot.byCardNumber[code] = restriction;
      const padMatch = code.match(/^([A-Z0-9]+)-(\d{2})$/);
      if (padMatch) snapshot.byCardNumber[`${padMatch[1]}-0${padMatch[2]}`] = restriction;
      const trimMatch = code.match(/^([A-Z0-9]+)-0(\d{2})$/);
      if (trimMatch) snapshot.byCardNumber[`${trimMatch[1]}-${trimMatch[2]}`] = restriction;
    }
  };

  for (const sec of sections) {
    const t = sec.title.toLowerCase();
    if (t.includes('banning pair') || t.includes('update record')) continue;
    let currentRestriction = null;
    if (/banned\s+cards/i.test(t)) currentRestriction = 'Banned';
    else if (/limited\s+cards.*<\s*20\s*>/i.test(t)) currentRestriction = 'Restricted <20>';
    else if (/limited\s+cards.*<\s*2\s*>/i.test(t)) currentRestriction = 'Restricted <2>';
    else if (/limited\s+cards.*<\s*1\s*>/i.test(t)) currentRestriction = 'Restricted <1>';
    if (!currentRestriction) continue;

    const body = wikitext.slice(sec.start, sec.end);
    const entryRegex =
      /\|((?:\[\[[^\]]+\]\](?:\s*\/\s*\[\[[^\]]+\]\])*))\s*(?:\((Revival)\)\s*)?\(([^)\n]+)\)/gi;
    let em;
    while ((em = entryRegex.exec(body)) !== null) {
      applyEntry(currentRestriction, em[1] || '', em[3] || '', Boolean(em[2]));
    }
  }

  return snapshot;
}

async function fetchBanList() {
  try {
    const json = await fetchWikiJson({
      action: 'query',
      titles: 'Banned_and_Restricted_Cards',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
    });
    const page = Object.values(json.query?.pages || {})[0];
    const wt = page?.revisions?.[0]?.slots?.main?.['*'] || '';
    return wt ? parseBanListWikitext(wt) : buildSeedBanListSnapshot();
  } catch {
    return buildSeedBanListSnapshot();
  }
}

function resolveCardRestriction(banList, cardNumber, cardName, isRevival) {
  const codeKey = normalizeCardCodeKey(cardNumber || '');
  if (codeKey && banList.byCardNumber[codeKey]) return banList.byCardNumber[codeKey];
  const baseNameKey = normalizeBanKey(cardName || '');
  if (baseNameKey) {
    const verKey = `${baseNameKey}|${isRevival ? 'rv' : 'orig'}`;
    if (banList.byName[verKey]) return banList.byName[verKey];
    if (banList.byName[baseNameKey]) return banList.byName[baseNameKey];
  }
  return 'Unlimited';
}

function stripWikiNoise(raw) {
  return String(raw || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^/]*\/>/gi, '');
}

function extractTabberSegment(raw, wantRevival) {
  const replaceTagTabber = String(raw || '').replace(
    /\{\{#tag:tabber\|([\s\S]*?)\}\}/gi,
    (_m, inner) => `<tabber>${inner.replace(/\{\{!\}\}-\{\{!\}\}/g, '|-|')}</tabber>`
  );
  return replaceTagTabber.replace(/<tabber>([\s\S]*?)<\/tabber>/gi, (_m, inner) => {
    const parts = inner.split(/\|-\|/);
    const segments = parts
      .map((part) => {
        const eq = part.indexOf('=');
        if (eq === -1) return null;
        return { label: part.slice(0, eq).trim(), body: part.slice(eq + 1).trim() };
      })
      .filter(Boolean);

    if (segments.length === 0) return inner;
    const picked = wantRevival
      ? segments.find((s) => /\brevival\b/i.test(s.label) && !/non[-\s]?revival/i.test(s.label)) ||
        segments[segments.length - 1]
      : segments.find((s) => !/\brevival\b/i.test(s.label) || /non[-\s]?revival/i.test(s.label)) ||
        segments[0];
    return picked ? picked.body : inner;
  });
}

function cleanWikitextInline(raw) {
  let out = extractTabberSegment(stripWikiNoise(raw), false)
    .replace(/\u00A0/g, ' ')
    .replace(/\{\{!\}\}/g, '|')
    .replace(/\{\{Nihongo\|([^|}]+)\|[^}]*\}\}/gi, '$1')
    .replace(/\{\{ruby\|([^|}]+)\|[^}]*\}\}/gi, '$1')
    .replace(/\[\[(?:File|Image):Soul[\s_]+Core\.png[^\]]*\]\]/gi, '[Soul Core]')
    .replace(/\[\[(?:File|Image):God[\s_]+(?:EX[\s_]+)?(?:symbol|core|gem)\.png[^\]]*\]\]/gi, '[God]')
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
    .replace(/\{\{SuAdcon\|([^}]+)\}\}/gi, (_m, p1) => `[Summon/Advent Condition: ${p1.trim()}]`)
    .replace(/\{\{Sumcon\|([^}]+)\}\}/gi, (_m, p1) => `[Summon Condition: ${p1.trim()}]`)
    .replace(/\{\{Adcon\|([^}]+)\}\}/gi, (_m, p1) => `[Advent Condition: ${p1.trim()}]`)
    .replace(/\{\{(?:Brcon|Bravecon)\|([^}]+)\}\}/gi, (_m, p1) => `[Brave Condition: ${p1.trim()}]`)
    .replace(/\{\{Mirage\|([^}]+)\}\}/gi, '[Mirage: $1]')
    .replace(/\{\{Seal\|([^}]+)\}\}/gi, '[$1]')
    .replace(/\{\{Unleash\|([^|}]+)(?:\|([^}]+))?\}\}/gi, (_m, p1, p2) =>
      p2 ? `[${p2.trim()} Unleash: ${p1.trim()}]` : `[Unleash: ${p1.trim()}]`
    )
    .replace(/\{\{Advent2\|([^|}]+)\|([^|}]+)(?:\|([^}]+))?\}\}/gi, (_m, kind, p1, p2) =>
      p2 ? `[${kind.trim()}: ${p1.trim()} (${p2.trim()})]` : `[${kind.trim()}: ${p1.trim()}]`
    )
    .replace(/\{\{Advent\|([^|}]+)(?:\|([^}]+))?\}\}/gi, (_m, p1, p2) =>
      p2 ? `[Advent: ${p1.trim()} ${p2.trim()}]` : `[Advent: ${p1.trim()}]`
    )
    .replace(
      /\{\{(Grand Advent|Ultra Advent|Flag Contract Advent|Contract Advent|Seal Flag Contract Advent|Ultra Contract Advent|Final Contract Advent|DK Grand Advent|Reverse Contract Advent|SF Advent|Transcendent Advent|Contract)\|([^|}]+)(?:\|([^}]+))?\}\}/gi,
      (_m, kind, p1, p2) => (p2 ? `[${kind}: ${p1.trim()} (${p2.trim()})]` : `[${kind}: ${p1.trim()}]`)
    )
    .replace(/\{\{ST\|([^|}]+)(?:\|[^}]*)?\}\}/gi, '($1)')
    .replace(/\{\{All\}\}/gi, 'All Colors')
    .replace(/\{\{(Red|Purple|White|Yellow|Green|Blue)\}\}/gi, '$1')
    .replace(/\{\{tk\|([^}]+)\}\}/gi, (_m, inner) => {
      const parts = inner.split('|').map((p) => p.trim());
      const key = parts[0] || '';
      const p2 = parts[1] || '';
      const p3 = parts[2] || '';
      if (key === 'uhand') return `[Ultimate Hand${p2 ? `: ${p2}` : ''}${p3 ? ` ${p3}` : ''}]`;
      if (key === 'uhand all') return `[Ultimate Hand: All${p2 ? ` ${p2}` : ''}]`;
      if (key === 'deh') return `[Dark Esoterica${p2 ? ` - ${p2}` : ''}]`;
      if (key === 'team' || key === 'teams') {
        const list = parts.slice(1).filter(Boolean).join('/');
        return `[${key === 'teams' ? 'Teams' : 'Team'}${list ? `: ${list}` : ''}]`;
      }
      if (key === 'Core Charge:' || key === 'Neo-Core Charge:' || key === 'Release:') {
        const baseLabel = key.slice(0, -1);
        return p2 ? `[${baseLabel}: ${p2}]` : `[${baseLabel}]`;
      }
      if (TK_TEXT_MAP[key]) return TK_TEXT_MAP[key];
      if (p2) return `[${key}] ${p2}`;
      return `[${key}]`;
    })
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{([^}]+)\}\}/g, (_m, inner) =>
      inner
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
    );

  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeColor(raw) {
  const cleaned = stripWikiNoise(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{|\}\}/g, ' ');
  const lower = cleaned.toLowerCase();
  if (/\b(all|omni|rainbow)\b/.test(lower) || /6[\s-]*colors?/.test(lower)) {
    return [...ALL_COLORS];
  }
  const found = [];
  const regex = /\b(Red|Purple|White|Yellow|Green|Blue)\b/gi;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const c = ALL_COLORS.find((col) => col.toLowerCase() === match[1].toLowerCase());
    if (c && !found.includes(c)) found.push(c);
  }
  return found.length > 0 ? found : ['Red'];
}

function normalizeType(raw) {
  const cleaned = cleanWikitextInline(stripWikiNoise(raw)).replace(/\s+/g, ' ').trim();
  const primarySegment = cleaned.split('/')[0]?.trim() || cleaned;
  const lowerPrimary = primarySegment.toLowerCase();
  const lowerFull = cleaned.toLowerCase();

  let type = 'Spirit';
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

function normalizeRarity(raw) {
  const lower = cleanWikitextInline(stripWikiNoise(raw)).trim().toLowerCase();
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

function defaultVariant(type, color) {
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
    default:
      return 'dragon';
  }
}

function parseTemplateFields(block) {
  const fields = {};
  const chunks = [];
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
      if (slice9.startsWith('<tabber>') || slice9.startsWith('<tabber ')) tabberDepth++;
      else if (slice9 === '</tabber>') tabberDepth = Math.max(0, tabberDepth - 1);
    }
    if (block[i] === '|' && braceDepth === 1 && bracketDepth === 0 && tabberDepth === 0) {
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
    if (key && !(key in fields)) fields[key] = val;
  }
  return fields;
}

function parseColorCounts(raw) {
  const counts = {};
  const cleaned = stripWikiNoise(raw).replace(/\u00A0/g, ' ');
  if (!cleaned || cleaned.trim() === '-' || cleaned.trim().toLowerCase() === 'none') return counts;

  const fileMatches = [...cleaned.matchAll(/([A-Za-z]+)(?:[\s_]+(?:EX[\s_]+)?(?:symbol|core|gem))\.png/gi)];
  for (const m of fileMatches) {
    const token = m[1].toLowerCase();
    if (token === 'soul') continue;
    if (token === 'all' || token === 'omni' || token === 'rainbow') {
      for (const c of ALL_COLORS) counts[c] = (counts[c] || 0) + 1;
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
    if (colorName) counts[colorName] = (counts[colorName] || 0) + 1;
  }

  if (Object.keys(counts).length === 0) {
    const tmplMatches = [...cleaned.matchAll(/\{\{(Red|Purple|White|Yellow|Green|Blue|God|Ultimate|Gold|All)\}\}/gi)];
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

function parseLevels(raw) {
  if (!raw) return undefined;
  const cleaned = cleanWikitextInline(raw);
  const tiers = [];
  const regex = /Level\s*([1-5])\s*:\s*(\d+)\s*cores?(?:\s*,\s*([\d,]+)\s*BP)?/gi;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    tiers.push({
      level: Number(match[1]),
      cores: Number(match[2]),
      bp: match[3] ? Number(match[3].replace(/,/g, '')) : 0,
    });
  }
  return tiers.length > 0 ? tiers : undefined;
}

function parseEffects(rawEffect) {
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
      return { timing: lines[0], text: lines.slice(1).join(' ') };
    }
    return { timing: 'Effect', text: lines[0] || para };
  });
}

function parseRulingsFromWikitext(wikitext) {
  const rulings = [];
  const seenQ = new Set();

  // Extract Q&A section if present
  const qaSecMatch = wikitext.match(/==+\s*(?:Rulings|Q&A|Card Rulings)\s*==+\s*([\s\S]*?)(?=\n==[^=]|$)/i);
  const targetText = qaSecMatch ? qaSecMatch[1] : wikitext;

  // Pattern 1: {{Q&A|Q=...|A=...}} or {{QA|...}}
  const qaTmplRe = /\{\{(?:Q&A|QA|Ruling)\s*\|([\s\S]*?)\}\}/gi;
  let tm;
  while ((tm = qaTmplRe.exec(targetText)) !== null) {
    const fields = parseTemplateFields(tm[0]);
    const q = cleanWikitextInline(fields.q || fields.question || fields['1'] || '');
    const a = cleanWikitextInline(fields.a || fields.answer || fields['2'] || '');
    if (q && a && !seenQ.has(q.toLowerCase())) {
      seenQ.add(q.toLowerCase());
      rulings.push({ question: q, answer: a });
    }
  }

  // Pattern 2: Bullet or plain Q: ... \n A: ... pairs inside Q&A section
  if (qaSecMatch) {
    const qaPairs = [
      ...targetText.matchAll(/(?:^|\n)[*:\s]*(?:Q\d*[:：.]\s*)([^\n]+)\n[*:\s]*(?:A\d*[:：.]\s*)([^\n]+)/gi),
    ];
    for (const pm of qaPairs) {
      const q = cleanWikitextInline(pm[1]);
      const a = cleanWikitextInline(pm[2]);
      if (q && a && !seenQ.has(q.toLowerCase())) {
        seenQ.add(q.toLowerCase());
        rulings.push({ question: q, answer: a });
      }
    }
  }

  return rulings;
}

const NON_CARD_ART_FILE_RE =
  /(?:^|[_ ])(core|icon|rarity|logo|symbol|burst\d*|flash\d*|main\d*|ut|soul[\s_]+core|mirage\d*|contract\d*|block[\s_]?\d*|ex[\s_]+symbol|flag\d*|lv\d+)\.(?:png|jpe?g|webp|gif)$/i;

function isCardArtworkFile(fileRaw) {
  const clean = String(fileRaw || '')
    .replace(/^(?:File|Image):/i, '')
    .replace(/\u00A0/g, ' ')
    .trim();
  if (!clean || !/\.(png|jpe?g|webp|gif)$/i.test(clean)) return false;
  if (NON_CARD_ART_FILE_RE.test(clean)) return false;
  if (/(?:core|ex[\s_]+symbol)\.png|rarity|button|arrow|template|banner\.jpe?g/i.test(clean)) return false;
  return true;
}

function normalizeImageKey(fileRaw) {
  return String(fileRaw || '')
    .replace(/^(?:File|Image):/i, '')
    .replace(/\u00A0/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cleanImageFieldValue(raw) {
  let cleaned = stripWikiNoise(raw).replace(/\u00A0/g, ' ').trim();
  const fileLink = cleaned.match(/\[\[(?:File|Image):([^|\]]+)/i);
  if (fileLink) cleaned = fileLink[1].trim();
  return cleaned
    .replace(/^(?:File|Image):/i, '')
    .split('|')[0]
    .trim();
}

function toSafeLocalImageName(fileRaw) {
  const clean = String(fileRaw || '')
    .replace(/^(?:File|Image):/i, '')
    .trim();
  const extMatch = clean.match(/\.(png|jpe?g|webp|gif)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '.jpg';
  const stem = clean
    .replace(/\.(png|jpe?g|webp|gif)$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${stem || 'card_art'}${ext}`;
}

function extractGalleryCandidates(wikitext, primaryFile, fallbackNumber, cardName, pageImages = []) {
  const seen = new Set();
  const list = [];

  const addFile = (fileRaw, caption) => {
    const file = cleanImageFieldValue(fileRaw);
    if (!isCardArtworkFile(file)) return;
    const normKey = normalizeImageKey(file);
    if (!normKey || seen.has(normKey)) return;
    seen.add(normKey);
    list.push({
      fileName: file,
      fallbackNumber,
      caption: caption.replace(/\n+/g, ' ').trim() || `${cardName} — Card Art`,
    });
  };

  if (primaryFile) addFile(primaryFile, `${cardName} — Card Art`);

  const tabMatches = [
    ...wikitext.matchAll(/\|\s*(?:image\d*|image_?b|bimage|art\d*|alt(?:image)?\d*|secret(?:image)?\d*)\s*=\s*([^\n}]+)/gi),
  ];
  tabMatches.forEach((m, idx) => {
    const fname = cleanImageFieldValue(m[1]);
    if (fname && !fname.includes('{{')) {
      addFile(fname, idx === 0 ? `${cardName} — Main Art` : `${cardName} — Alternate / Revival Art`);
    }
  });

  const galleryMatches = [...wikitext.matchAll(/<gallery[^>]*>([\s\S]*?)<\/gallery>/gi)];
  for (const gm of galleryMatches) {
    const lines = gm[1].split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split('|');
      const filePart = (parts[0] || '').trim();
      const captionParts = parts.slice(1).filter((p) => !/^(?:link|alt)=/i.test(p.trim()));
      const captionRaw = captionParts.join(' · ');
      if (filePart && isCardArtworkFile(filePart)) {
        addFile(filePart, cleanWikitextInline(captionRaw || 'Alternate / Full Art') || 'Alternate / Full Art');
      }
    }
  }

  for (const imgTitle of pageImages) {
    if (isCardArtworkFile(imgTitle)) {
      const lowerImg = imgTitle.toLowerCase();
      const cap =
        lowerImg.includes('secret') || lowerImg.includes('scr')
          ? `${cardName} — Secret / Alt Art`
          : lowerImg.includes('fa') || lowerImg.includes('full')
          ? `${cardName} — Full Art`
          : `${cardName} — Alternate Art`;
      addFile(imgTitle, cap);
    }
  }

  return list.slice(0, maxAltImagesPerCard);
}

function extractTaggedCardTableBlocks(wikitext) {
  const blocks = [];
  const startRegex = /\{\{CardTable\d*/gi;
  let match;
  const rawMatches = [];

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
    const nextStart = idx + 1 < rawMatches.length ? rawMatches[idx + 1].index : wikitext.length;
    const sectionText = wikitext.slice(item.index, nextStart);
    const tabLabels = [
      ...lookback.matchAll(/(?:<tabber>|\|-\||\{\{!\}\}-\{\{!\}\})\s*([^=\n<>{}]{1,60})\s*=/gi),
    ];
    const lastTab = tabLabels[tabLabels.length - 1]?.[1]?.trim() || '';
    const isRevival = /\b(?:revival|rv|bsc22)\b/i.test(lastTab) && !/non[-\s]?revival/i.test(lastTab);
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

function pickBestTaggedCardBlock(blocks, base) {
  if (blocks.length === 0) return undefined;
  if (blocks.length === 1) return blocks[0];

  const wantsRevival = Boolean(
    base.isRevival || /\(revival\)/i.test(base.name) || /(?:^|-)RV[A-Z0-9]*\d/i.test(base.cardNumber)
  );
  const baseNum = base.cardNumber.toUpperCase().replace(/\s*\([AB]\)\s*$/, '');
  const baseSet = base.setCode.toUpperCase();

  const matchesCardIdentity = (b) => {
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
    if (revivalBlocks.length > 0) return revivalBlocks.find(matchesCardIdentity) || revivalBlocks[0];
  } else {
    const nonRevivalBlocks = blocks.filter((b) => !b.isRevival);
    if (nonRevivalBlocks.length > 0) {
      if (/\(B\)$/i.test(base.cardNumber) && nonRevivalBlocks[1]) return nonRevivalBlocks[1];
      return nonRevivalBlocks.find(matchesCardIdentity) || nonRevivalBlocks[0];
    }
  }
  return blocks.find(matchesCardIdentity) || blocks[0];
}

function extractKeywordsFromEffects(explicitKeywords, effects, summonCondition, braveCondition) {
  const kwSet = new Set(explicitKeywords.map((k) => k.trim()).filter(Boolean));
  const combined = [
    ...effects.map((e) => `${e.timing} ${e.text}`),
    summonCondition || '',
    braveCondition || '',
  ].join('\n');

  for (const kw of STANDARD_KEYWORDS) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:\\[|\\b)${escaped}(?:[:\\]\\b])`, 'i').test(combined)) {
      kwSet.add(kw);
    }
  }
  return Array.from(kwSet);
}

function hydrateCardFromWikitext(base, wikitext, pageImages, banList, forcedTaggedBlock) {
  const taggedBlocks = extractTaggedCardTableBlocks(wikitext);
  const chosenTagged = forcedTaggedBlock || pickBestTaggedCardBlock(taggedBlocks, base);
  if (!chosenTagged) {
    return { ...base, isWikiLoaded: true, _galleryCandidates: [] };
  }

  const block = chosenTagged.block;
  const fields = parseTemplateFields(block);
  const jpName =
    cleanWikitextInline(fields.kanji || '') || cleanWikitextInline(fields.jpname || '') || base.jpName;

  const rawColorParts = [
    fields.color || '',
    fields.color1 || '',
    fields.color2 || '',
    fields.color3 || '',
    fields.color4 || '',
    fields.color5 || '',
    fields.color6 || '',
  ].filter(Boolean);

  const parsedColors = [];
  for (const part of rawColorParts) {
    for (const c of normalizeColor(part)) {
      if (!parsedColors.includes(c)) parsedColors.push(c);
    }
  }
  const finalColors = parsedColors.length > 0 ? parsedColors : base.colors?.length ? base.colors : [base.color];
  const color = finalColors[0] || base.color;
  const secondaryColor = finalColors[1] || (finalColors.length === 1 ? undefined : base.secondaryColor);

  const inferTypeFromWikitext = () => {
    if (/\[\[Category:Magic Cards\]\]/i.test(wikitext)) return 'Magic';
    if (/\[\[Category:Ultimate Cards\]\]/i.test(wikitext)) return 'Ultimate';
    if (/\[\[Category:Brave Cards\]\]/i.test(wikitext)) return 'Brave';
    if (/\[\[Category:Nexus Cards\]\]/i.test(wikitext)) return 'Nexus';
    if (/\[\[Category:Spirit Cards\]\]/i.test(wikitext)) return 'Spirit';
    if (fields.bravebp || fields.brave || fields.bravecondition) return 'Brave';
    if (fields.summoncondition || fields.summon) return 'Ultimate';
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

  const rawImage = cleanImageFieldValue(extractTabberSegment(fields.image || '', isRevival));
  const costNum = Number(extractTabberSegment(fields.cost || '', isRevival).replace(/[^\d]/g, ''));
  const cost = fields.cost && Number.isFinite(costNum) && costNum >= 0 ? costNum : base.cost;

  const reductions = parseColorCounts(extractTabberSegment(fields.reductions || fields.reduction || '', isRevival));
  const symbols = parseColorCounts(extractTabberSegment(fields.symbols || '', isRevival));

  // Split packed families cleanly so search & synergy match individual families accurately
  const families = [
    cleanWikitextInline(extractTabberSegment(fields.family || '', isRevival)),
    cleanWikitextInline(extractTabberSegment(fields.family2 || '', isRevival)),
    cleanWikitextInline(extractTabberSegment(fields.family3 || '', isRevival)),
    cleanWikitextInline(extractTabberSegment(fields.family4 || '', isRevival)),
  ]
    .flatMap((f) => f.split(/\s*\/\s*/))
    .map((f) => f.trim())
    .filter(Boolean);

  const resolvedSymbols =
    Object.keys(symbols).length > 0
      ? symbols
      : type === 'Magic' || isToken
      ? {}
      : type === 'Ultimate'
      ? { Ultimate: 1 }
      : families.some((f) => /grandwalker/i.test(f)) || /grandwalker/i.test(subtypeLabel || '')
      ? { God: 1 }
      : type === 'Spirit' && Object.keys(base.symbols || {}).length === 0
      ? { [color]: 1 }
      : Object.keys(base.symbols || {}).length > 0
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
    if (suAdMatch) summonCond = cleanWikitextInline(suAdMatch[2]) || undefined;
  }

  let rawBraveCond = cleanWikitextInline(
    extractTabberSegment(
      fields.bravecondition || fields.brave || fields['brave condition'] || fields.brave_condition || '',
      isRevival
    )
  );
  if (!rawBraveCond && rawEffect && (type === 'Brave' || /\bbrave\b/i.test(subtypeLabel || ''))) {
    const brMatch = rawEffect.match(/\{\{(?:Brcon|Bravecon)\|([^}]+)\}\}/i);
    if (brMatch) rawBraveCond = cleanWikitextInline(brMatch[1]);
  }
  const braveCond =
    (type === 'Brave' || /\bbrave\b/i.test(subtypeLabel || '')) && rawBraveCond ? rawBraveCond : undefined;

  let braveBpRaw = extractTabberSegment(fields.bravebp || '', isRevival).replace(/[^\d]/g, '');
  const braveBonusBp =
    (type === 'Brave' || /\bbrave\b/i.test(subtypeLabel || '')) && braveBpRaw ? Number(braveBpRaw) : undefined;

  const flavorText =
    cleanWikitextInline(fields.enflavor1 || '') || cleanWikitextInline(fields.enflavor || '') || base.flavorText || '';
  const illustrator =
    cleanWikitextInline(fields.artist1 || '') || cleanWikitextInline(fields.artist || '') || base.illustrator || '';

  const blockVal = cleanWikitextInline(fields.block1 || '') || cleanWikitextInline(fields.block || '');
  const isAlphaStandardBlock = /^[A-Z]$/.test(blockVal);
  const formats =
    base.formats.includes('Standard') || isAlphaStandardBlock ? ['Standard', 'Eternal'] : ['Eternal'];
  const blockIcon = blockVal ? `Block ${blockVal}` : base.blockIcon;

  const hasBothRevivalAndOriginal =
    taggedBlocks.some((t) => t.isRevival) && taggedBlocks.some((t) => !t.isRevival);
  const imageSourceWikitext = hasBothRevivalAndOriginal ? chosenTagged.sectionText : wikitext;

  const galleryCandidates = extractGalleryCandidates(
    imageSourceWikitext,
    rawImage || `${base.cardNumber}.png`,
    base.cardNumber,
    base.name,
    pageImages
  );

  const restriction = resolveCardRestriction(banList, base.cardNumber, base.name, isRevival);
  const resolvedName = isRevival && !/\(revival\)/i.test(base.name) ? `${base.name} (Revival)` : base.name;
  const resolvedEffects =
    effects.length > 0 ? effects : [{ timing: 'Card Text', text: 'No English effect text listed on this card.' }];
  const rulings = parseRulingsFromWikitext(wikitext);
  const keywords = extractKeywordsFromEffects(
    [...keywordsRaw, ...(base.keywords || [])],
    resolvedEffects,
    summonCond,
    braveCond
  );

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
    reduction: Object.keys(reductions).length > 0 ? reductions : base.reduction || {},
    symbols: resolvedSymbols,
    families: Array.from(new Set(families)),
    levels,
    braveBonusBp,
    braveCondition: braveCond,
    summonCondition: summonCond,
    effects: resolvedEffects,
    keywords,
    flavorText,
    illustrator,
    artworkImage: '',
    galleryImages: undefined,
    artVariant: defaultVariant(type, color),
    formats,
    blockIcon,
    restriction,
    rulings: rulings.length > 0 ? rulings : base.rulings || [],
    isWikiLoaded: true,
    _galleryCandidates: galleryCandidates,
  };
}

function parseSetTableRows(wikitext, setMeta, banList) {
  const cards = [];
  const seenKeys = new Set();
  const tables = wikitext.split(/\{\|/);

  for (const table of tables) {
    let colIdxMap = {};
    let hasExplicitHeader = false;
    let sectionIsRevival = false;
    let sectionIsToken = false;

    const rows = table.split(/\n\|-/);
    for (const row of rows) {
      const colspanHdrMatch = row.match(/!\s*colspan\s*=\s*"?\d+"?[^|\n]*\|([^\n]+)/i);
      if (colspanHdrMatch) {
        const secText = cleanWikitextInline(colspanHdrMatch[1]);
        sectionIsRevival = /\brevival\b/i.test(secText);
        sectionIsToken = /\btoken\b/i.test(secText);
      }

      if (row.includes('! scope="col"') || /^\s*!/m.test(row)) {
        const splitHeaderRow = row
          .replace(/!!/g, '\n!')
          .replace(/!\s*(?=(?:scope|width|align|valign|style|class|colspan|rowspan)\s*=|''')/gi, '\n!');
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
        const attrMatch = stripped.match(/^(?:style|align|bgcolor|width|class|colspan|rowspan)\s*=[^|]*\|([\s\S]*)$/i);
        return attrMatch ? attrMatch[1].trim() : stripped;
      });

      const detectedNameIdx =
        colIdxMap.name !== undefined && cells[colIdxMap.name] && /\[\[[^\]]+\]\]/.test(cells[colIdxMap.name])
          ? colIdxMap.name
          : cells.findIndex((c) => /\[\[[^\]]+\]\]/.test(c) && !/\[\[File:/i.test(c));
      if (detectedNameIdx < 1) continue;

      const numberIdx = colIdxMap.number !== undefined ? colIdxMap.number : detectedNameIdx - 1;
      const numRaw = cleanWikitextInline(cells[numberIdx] || '').replace(/\s+/g, '');
      if (!numRaw || numRaw.length > 24 || /number/i.test(numRaw)) continue;

      const nameCellRaw = cells[detectedNameIdx] || '';
      const linkMatch = nameCellRaw.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (!linkMatch) continue;

      const wikiTitle = linkMatch[1].trim();
      const baseDisplayName = (linkMatch[2] || linkMatch[1]).trim();
      if (!wikiTitle || wikiTitle.startsWith('File:') || wikiTitle.startsWith('Category:')) continue;

      const colorCell = colIdxMap.color !== undefined ? cells[colIdxMap.color] || '' : cells[detectedNameIdx + 1] || '';
      const typeCell = colIdxMap.type !== undefined ? cells[colIdxMap.type] || '' : cells[detectedNameIdx + 2] || '';
      const rarityCell =
        colIdxMap.rarity !== undefined ? cells[colIdxMap.rarity] || '' : hasExplicitHeader ? '' : cells[detectedNameIdx + 3] || '';

      const colors = normalizeColor(colorCell);
      const { type, subtypeLabel } = normalizeType(typeCell);
      const rarity =
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

      const isToken = sectionIsToken || /\btoken\b/i.test(typeCell) || /-T\d+$/i.test(fullNumber);
      const displayName =
        isRevival && !/\(revival\)/i.test(baseDisplayName) ? `${baseDisplayName} (Revival)` : baseDisplayName;

      const uniqueKey = `${setMeta.setCode}-${fullNumber}-${wikiTitle}-${isRevival ? 'rv' : 'orig'}`;
      if (seenKeys.has(uniqueKey)) continue;
      seenKeys.add(uniqueKey);

      const id = `${setMeta.setCode.toLowerCase()}-${fullNumber
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}${isRevival ? '-rv' : ''}`;

      const defaultSymbols =
        type === 'Magic' || isToken ? {} : type === 'Ultimate' ? { Ultimate: 1 } : { [colors[0]]: 1 };

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
        restriction: resolveCardRestriction(banList, fullNumber, displayName, isRevival),
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
        artworkImage: '',
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

async function batchFetchWikiPages(titles, concurrency = 5) {
  const uniqueTitles = Array.from(new Set(titles.filter(Boolean)));
  const result = new Map();
  const chunks = [];
  for (let i = 0; i < uniqueTitles.length; i += 50) {
    chunks.push(uniqueTitles.slice(i, i + 50));
  }

  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const idx = cursor++;
      const chunk = chunks[idx];
      try {
        const json = await fetchWikiJson({
          action: 'query',
          titles: chunk.join('|'),
          prop: 'revisions|images',
          rvprop: 'content',
          rvslots: 'main',
          imlimit: '500',
          redirects: '1',
        });

        const pages = json.query?.pages || {};
        const titleToBundle = new Map();
        for (const p of Object.values(pages)) {
          const content = p.revisions?.[0]?.slots?.main?.['*'] || '';
          const imgs = (p.images || []).map((img) => img.title || '').filter(Boolean);
          if (p.title && (content || imgs.length > 0)) {
            titleToBundle.set(p.title, { wikitext: content, pageImages: imgs });
          }
        }

        const redirectMap = new Map();
        for (const r of json.query?.redirects || []) redirectMap.set(r.from, r.to);
        const normMap = new Map();
        for (const n of json.query?.normalized || []) normMap.set(n.from, n.to);

        for (const origTitle of chunk) {
          const normalized = normMap.get(origTitle) || origTitle;
          const finalTitle = redirectMap.get(normalized) || normalized;
          const bundle = titleToBundle.get(finalTitle) || titleToBundle.get(normalized);
          if (bundle && bundle.wikitext) result.set(origTitle, bundle);
        }
      } catch (err) {
        console.warn(`  Warning: chunk fetch failed (${err.message})`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
  return result;
}

async function batchResolveWikiImageUrls(fileNames, concurrency = 5) {
  const cleanNames = Array.from(
    new Set(
      fileNames
        .map((f) => String(f || '').replace(/^File:/i, '').trim())
        .filter(Boolean)
    )
  );
  const urlByLowerName = new Map();
  const chunks = [];
  for (let i = 0; i < cleanNames.length; i += 50) {
    chunks.push(cleanNames.slice(i, i + 50));
  }

  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const idx = cursor++;
      const chunk = chunks[idx];
      try {
        const json = await fetchWikiJson({
          action: 'query',
          titles: chunk.map((f) => `File:${f}`).join('|'),
          prop: 'imageinfo',
          iiprop: 'url',
        });
        for (const page of Object.values(json.query?.pages || {})) {
          const url = page.imageinfo?.[0]?.url;
          if (page.title && url) {
            urlByLowerName.set(page.title.replace(/^File:/i, '').toLowerCase(), url);
          }
        }
      } catch {
        // tolerate individual batch errors cleanly
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
  return urlByLowerName;
}

async function downloadImageFile(remoteUrl, destPath) {
  try {
    const stat = await fs.stat(destPath);
    if (stat.size > 200) return true; // already downloaded
  } catch {
    // proceed to download
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(remoteUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://battle-spirits.fandom.com/',
        },
      });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      if (contentType && !contentType.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) continue;
      await fs.writeFile(destPath, buf);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

async function main() {
  console.log('=== BattleSpirits Wiki Data Exporter ===');
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  if (downloadImagesLocally) {
    await fs.mkdir(IMAGES_DIR, { recursive: true });
  }

  const wikiMetaMap = await loadWikiSetMetadata();
  const fullDirectory = buildDirectory(wikiMetaMap);
  const directoryByCode = new Map(fullDirectory.map((s) => [s.setCode.toUpperCase(), s]));

  // Load existing cards.json when running incremental --sets mode
  let existingData = null;
  if (!freshMode && existsSync(CARDS_JSON_PATH)) {
    try {
      existingData = JSON.parse(await fs.readFile(CARDS_JSON_PATH, 'utf8'));
    } catch {
      existingData = null;
    }
  }

  console.log('1/5 Fetching official Banned & Restricted card list...');
  const banList = await fetchBanList();
  console.log(
    `    Loaded ${Object.keys(banList.byCardNumber).length} restricted codes (${banList.effectiveDate}).`
  );

  // Determine which sets to fetch
  let targetSets = fullDirectory;
  if (requestedSets && requestedSets.length > 0) {
    targetSets = requestedSets
      .map((code) => directoryByCode.get(code))
      .filter(Boolean);
    if (targetSets.length === 0) {
      console.error(`No matching set codes found for --sets=${requestedSetsRaw}`);
      process.exit(1);
    }
  } else if (maxSets) {
    targetSets = fullDirectory.slice(0, maxSets);
  }

  console.log(`2/5 Fetching set rosters for ${targetSets.length} Battle Spirits Wiki sets...`);
  const regularSets = targetSets.filter(
    (s) => s.setCode !== 'TOKENS' && s.setCode !== 'REVIVAL'
  );
  const setPageTitles = regularSets.map((s) => s.wikiTitle || s.setCode);
  const setPages = await batchFetchWikiPages(setPageTitles, 6);

  const rawCardsByKey = new Map();
  const addCardDraft = (card) => {
    const key = `${card.cardNumber.toUpperCase()}|${card.isRevival ? 'rv' : 'orig'}`;
    const numPrefixMatch = card.cardNumber.match(/^([A-Z0-9]+)-/i);
    const numPrefix = numPrefixMatch ? numPrefixMatch[1].toUpperCase() : '';
    const prefixSetMeta = numPrefix ? directoryByCode.get(numPrefix) : undefined;
    const cardSetMeta = directoryByCode.get(card.setCode.toUpperCase());

    // For Booster set pages that include preview/reprint tables from other sets (e.g. 26RSD01-014 in BS75, BS72-077..BS75-085 in BS76),
    // attribute the card to its home set matching the cardNumber prefix when that set exists in the directory.
    let normalizedCard = card;
    if (
      prefixSetMeta &&
      numPrefix !== card.setCode.toUpperCase() &&
      cardSetMeta?.category === 'Booster' &&
      (prefixSetMeta.category === 'Booster' ||
        prefixSetMeta.category === 'Standard Booster' ||
        prefixSetMeta.category === 'Standard Starter')
    ) {
      normalizedCard = {
        ...card,
        id: `${prefixSetMeta.setCode.toLowerCase()}-${card.cardNumber
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')}${card.isRevival ? '-rv' : ''}`,
        setCode: prefixSetMeta.setCode,
        setName: prefixSetMeta.name,
        formats: prefixSetMeta.formats,
        blockIcon: prefixSetMeta.blockLabel,
      };
    }

    const existing = rawCardsByKey.get(key);
    if (!existing) {
      rawCardsByKey.set(key, normalizedCard);
      return;
    }
    const numUpper = normalizedCard.cardNumber.toUpperCase();
    const newMatchesPrefix = numUpper.startsWith(`${normalizedCard.setCode.toUpperCase()}-`);
    const existingMatchesPrefix = numUpper.startsWith(`${existing.setCode.toUpperCase()}-`);
    if (newMatchesPrefix && !existingMatchesPrefix) {
      rawCardsByKey.set(key, normalizedCard);
    }
  };

  for (const setMeta of regularSets) {
    const wt = setPages.get(setMeta.wikiTitle || setMeta.setCode)?.wikitext || '';
    if (!wt) continue;
    const rows = parseSetTableRows(wt, setMeta, banList);
    for (const c of rows) addCardDraft(c);
  }

  // Handle TOKENS set if requested
  if (targetSets.some((s) => s.setCode === 'TOKENS')) {
    const tokenTitles = new Set(['Platinum Bug', 'Rig Avatar Dragon', 'Swordish', 'Fungal Bed']);
    try {
      const catJson = await fetchWikiJson({
        action: 'query',
        list: 'allcategories',
        acfrom: 'Token',
        acto: 'Tokenz',
        aclimit: '50',
      });
      const tokenCats = (catJson.query?.allcategories || [])
        .map((c) => c['*'] || '')
        .filter((n) => /^Token\b/i.test(n));
      for (const cat of [...tokenCats, "Can't put in deck"]) {
        const m = await fetchWikiJson({
          action: 'query',
          list: 'categorymembers',
          cmtitle: `Category:${cat}`,
          cmlimit: '200',
        });
        for (const item of m.query?.categorymembers || []) {
          if (item.title && !item.title.includes(':')) tokenTitles.add(item.title);
        }
      }
    } catch {
      // keep seeds
    }

    const tokenContents = await batchFetchWikiPages(Array.from(tokenTitles), 5);
    for (const title of tokenTitles) {
      const bundle = tokenContents.get(title);
      const wt = bundle?.wikitext || '';
      if (!wt || !/\{\{CardTable/i.test(wt)) continue;
      const setCodeMatch = wt.match(/\|\s*set1\s*=\s*([^\n|}]+)/i);
      const rawSet = setCodeMatch ? cleanWikitextInline(setCodeMatch[1]) : 'TOKENS';
      const cardNumMatch = wt.match(/\|\s*image\s*=\s*([A-Z0-9-]+)\.(?:png|jpe?g|webp)/i);
      const cardNumber = cardNumMatch ? cardNumMatch[1] : `${rawSet}-T001`;
      const isStd = /^26R/i.test(rawSet) || /^26R/i.test(cardNumber);

      addCardDraft({
        id: `token-${cardNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        cardNumber,
        name: title,
        jpName: '',
        color: 'Red',
        type: 'Spirit',
        rarity: 'C',
        setCode: rawSet,
        setName: directoryByCode.get(rawSet.toUpperCase())?.name || rawSet,
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
      });
    }
  }

  const draftCards = Array.from(rawCardsByKey.values());
  console.log(`    Discovered ${draftCards.length} unique card entries across fetched sets.`);

  console.log('3/5 Fetching full English card pages & translating effects/rulings...');
  const cardBundles = await batchFetchWikiPages(
    draftCards.map((c) => c.wikiTitle),
    6
  );

  const hydratedCards = draftCards.map((card) => {
    const bundle = card.wikiTitle ? cardBundles.get(card.wikiTitle) : undefined;
    return bundle
      ? hydrateCardFromWikitext(card, bundle.wikitext, bundle.pageImages, banList)
      : { ...card, isWikiLoaded: true, _galleryCandidates: [{ fileName: `${card.cardNumber}.png`, fallbackNumber: card.cardNumber, caption: `${card.name} — Card Art` }] };
  });

  // Collect all unique candidate image filenames (with fallback .png / .jpg variants)
  const fileNamesToResolve = new Set();
  for (const card of hydratedCards) {
    for (const cand of card._galleryCandidates || []) {
      if (cand.fileName) fileNamesToResolve.add(cand.fileName);
      if (cand.fallbackNumber) {
        fileNamesToResolve.add(`${cand.fallbackNumber}.png`);
        fileNamesToResolve.add(`${cand.fallbackNumber}.jpg`);
      }
    }
  }

  const downloadedLocalMap = new Map(); // lower(fileName) -> '/images/...'

  if (!skipImages && fileNamesToResolve.size > 0) {
    console.log(`4/5 Resolving ${fileNamesToResolve.size} image URLs and downloading to public/images/...`);
    const resolvedUrls = await batchResolveWikiImageUrls(Array.from(fileNamesToResolve), 6);

    // Deduplicate physical downloads by target local filename
    const downloadJobs = new Map();
    for (const card of hydratedCards) {
      for (const cand of card._galleryCandidates || []) {
        const keys = [
          cand.fileName,
          cand.fallbackNumber ? `${cand.fallbackNumber}.png` : '',
          cand.fallbackNumber ? `${cand.fallbackNumber}.jpg` : '',
        ].filter(Boolean);

        for (const k of keys) {
          const url = resolvedUrls.get(k.toLowerCase());
          if (url) {
            const safeLocal = toSafeLocalImageName(k);
            downloadedLocalMap.set(cand.fileName.toLowerCase(), `/images/${safeLocal}`);
            if (!downloadJobs.has(safeLocal)) {
              downloadJobs.set(safeLocal, url);
            }
            break;
          }
        }
      }
    }

    const jobsArray = Array.from(downloadJobs.entries());
    let doneCount = 0;
    let okCount = 0;
    let cursor = 0;

    async function imgWorker() {
      while (cursor < jobsArray.length) {
        const i = cursor++;
        const [safeLocal, url] = jobsArray[i];
        const ok = await downloadImageFile(url, path.join(IMAGES_DIR, safeLocal));
        doneCount++;
        if (ok) okCount++;
        if (doneCount % 100 === 0 || doneCount === jobsArray.length) {
          process.stdout.write(`\r    Downloaded images: ${doneCount}/${jobsArray.length} (${okCount} ready)`);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(imgConcurrency, Math.max(1, jobsArray.length)) }, () => imgWorker())
    );
    if (jobsArray.length > 0) process.stdout.write('\n');
  } else {
    console.log('4/5 Skipping image download (--no-images flag or 0 candidates).');
  }

  // Finalize cards using runtime Wiki proxy URLs (or local /images/ only when --download-images is explicitly set)
  const buildProxyImageUrl = (file, fallback, title) => {
    const qs = new URLSearchParams();
    if (file) qs.set('file', file);
    if (fallback) qs.set('fallback', fallback);
    if (title) qs.set('title', title);
    return `/api/wiki/image?${qs.toString()}`;
  };

  const finalizedNewCards = hydratedCards.map((card) => {
    const cands = card._galleryCandidates || [];
    const resolvedGallery = [];
    const seenUrls = new Set();

    for (const cand of cands) {
      let chosen = '';
      if (downloadImagesLocally) {
        const localPath = downloadedLocalMap.get(cand.fileName.toLowerCase());
        const fallbackDiskPng = `/images/${toSafeLocalImageName(`${cand.fallbackNumber}.png`)}`;
        const fallbackDiskJpg = `/images/${toSafeLocalImageName(`${cand.fallbackNumber}.jpg`)}`;
        chosen =
          [localPath, fallbackDiskPng, fallbackDiskJpg].find(
            (p) => p && existsSync(path.join(PUBLIC_DIR, p.replace(/^\//, '')))
          ) || '';
      } else {
        chosen = buildProxyImageUrl(
          cand.fileName,
          cand.fallbackNumber || card.cardNumber,
          card.wikiTitle || card.name
        );
      }

      if (chosen && !seenUrls.has(chosen)) {
        seenUrls.add(chosen);
        resolvedGallery.push({ url: chosen, caption: cand.caption });
      }
    }

    const fallbackPrimary = buildProxyImageUrl(
      undefined,
      card.cardNumber,
      card.wikiTitle || card.name
    );

    const { _galleryCandidates, ...cleanCard } = card;
    return {
      ...cleanCard,
      artworkImage: resolvedGallery[0]?.url || fallbackPrimary,
      galleryImages: resolvedGallery.length > 0 ? resolvedGallery : undefined,
    };
  });

  // Merge with existing cards.json if running targeted --sets update
  const mergedCardMap = new Map();
  if (requestedSets && existingData && Array.isArray(existingData.cards)) {
    for (const oldCard of existingData.cards) {
      mergedCardMap.set(oldCard.id, oldCard);
    }
  }
  for (const c of finalizedNewCards) {
    mergedCardMap.set(c.id, c);
  }

  const allFinalCards = Array.from(mergedCardMap.values()).sort((a, b) =>
    a.cardNumber.localeCompare(b.cardNumber)
  );

  // Update set card counts accurately
  const countBySet = new Map();
  let tokenTotal = 0;
  let revivalTotal = 0;
  for (const c of allFinalCards) {
    const sc = c.setCode.toUpperCase();
    countBySet.set(sc, (countBySet.get(sc) || 0) + 1);
    if (c.isToken) tokenTotal++;
    if (c.isRevival) revivalTotal++;
  }

  const finalSets = fullDirectory.map((s) => {
    const sc = s.setCode.toUpperCase();
    const loadedCount =
      sc === 'TOKENS' ? tokenTotal : sc === 'REVIVAL' ? revivalTotal : countBySet.get(sc) || 0;
    return {
      ...s,
      totalCardsInSet: loadedCount || s.totalCardsInSet,
    };
  });

  console.log('5/5 Writing normalized public/cards.json...');
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    banList,
    sets: finalSets,
    cards: allFinalCards,
  };

  await fs.writeFile(CARDS_JSON_PATH, JSON.stringify(payload), 'utf8');
  const fileStat = await fs.stat(CARDS_JSON_PATH);
  const sizeMb = (fileStat.size / (1024 * 1024)).toFixed(2);
  console.log(
    `Done! Saved ${allFinalCards.length} cards (${finalSets.length} sets) to public/cards.json (${sizeMb} MB).`
  );
}

main().catch((err) => {
  console.error('Fatal download error:', err);
  process.exit(1);
});
