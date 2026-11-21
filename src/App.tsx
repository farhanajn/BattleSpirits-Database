import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Layers,
  Grid,
  X,
  Loader2,
  Share2,
  AlertTriangle,
  Ban,
  Settings,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BATTLE_SPIRITS_CARDS,
  PRESET_DECKS,
  PRESET_DECK_FOLDERS,
  PRODUCT_SETS,
} from './data/cards';
import { ALL_COLORS, COLOR_META } from './data/theme';
import {
  BattleSpiritsCard,
  CardColor,
  CardRarity,
  CardType,
  ColorFilter,
  Deck,
  DeckEntry,
  DeckFolder,
  FilterState,
  FormatFilter,
  GameFormat,
  ProductSet,
  SortOption,
} from './types/card';
import { SymbolIcon } from './components/SymbolIcon';
import { CardThumbnail } from './components/CardThumbnail';
import { CardDetailSheet } from './components/CardDetailSheet';
import { FilterControls, FilterSheet } from './components/FilterSheet';
import { DeckBuilderView } from './components/DeckBuilderView';
import { SettingsView } from './components/SettingsView';
import { CatalogMenuView } from './components/CatalogMenuView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineIndicator } from './components/PWAControls';
import { auth, signInWithGoogle, signOutGoogle } from './firebase';
import type { PublicBuilderProfile } from './types/social';
import {
  deleteCloudDeck,
  deleteCloudFolder,
  fetchPublicProfiles,
  fetchUserCloudLibrary,
  syncAllDecksAndFoldersToCloud,
  syncUserAccountsOnSignIn,
  updatePublicProfileBio,
} from './utils/cloudSync';
import { getMaxCardCopies, isTokenCard } from './utils/cardRules';
import { decodeSharedDeck, SharedDeckPayload } from './utils/deckShare';
import {
  buildImportedDeckEntries,
  compactCardNumber,
  normalizeCardName,
  normalizeCardNumber,
} from './utils/decklistImport';
import {
  loadOfflineSnapshot,
  saveOfflineCards,
  saveOfflineMeta,
} from './utils/offlineCardStore';
import { buildWikiImageUrl } from './utils/wikiImageClient';
import {
  getManualWikiMapping,
  resolveManualMappingArtworkUrl,
} from './utils/ManualWikiMapping';
import { useWikiImagePrefetch } from './hooks/useWikiImagePrefetch';
import {
  loadFastCachedSets,
  matchesIndexedSetQuery,
  saveFastCachedSets,
  synchronizeAndIndexSets,
} from './utils/setMetadataSync';
import { fetchPublishedCatalogAdditions } from './utils/catalogCloudSync';

type AppTab = 'catalog' | 'search' | 'decks' | 'settings';

type CardRestrictionValue = NonNullable<BattleSpiritsCard['restriction']>;

interface BanListSnapshot {
  effectiveDate?: string;
  byCardNumber: Record<string, CardRestrictionValue>;
  byName: Record<string, CardRestrictionValue>;
}

const INITIAL_FILTERS: FilterState = {
  search: '',
  setQuery: '',
  format: 'All',
  version: 'All',
  color: 'All',
  type: [],
  rarity: [],
  setCode: 'All',
  costBracket: 'All',
  keyword: 'All',
  sortBy: 'number',
};

const VALID_TABS: AppTab[] = ['catalog', 'search', 'decks', 'settings'];
const VALID_FORMATS: FormatFilter[] = ['All', 'Standard', 'Eternal'];
const VALID_VERSIONS: FilterState['version'][] = ['All', 'Original', 'Revival'];
const VALID_COLORS: ColorFilter[] = [
  'All',
  'Multicolor',
  'Red',
  'Purple',
  'Green',
  'White',
  'Yellow',
  'Blue',
];
const VALID_TYPES: CardType[] = [
  'Spirit',
  'Ultimate',
  'Brave',
  'Nexus',
  'Magic',
];
const VALID_RARITIES: CardRarity[] = [
  'C',
  'U',
  'R',
  'M',
  'X',
  'XX',
  'CX',
  'NX',
  'AX',
  'TX',
  'XV',
  'P',
];
const VALID_COSTS: FilterState['costBracket'][] = ['All', '0-2', '3-4', '5-6', '7+'];
const VALID_SORTS: SortOption[] = [
  'number',
  'newest',
  'rarity-desc',
  'color',
  'cost-asc',
  'cost-desc',
  'bp-desc',
  'name',
];

const RARITY_RANK: Record<string, number> = {
  XX: 12,
  XV: 11,
  CX: 10,
  AX: 9,
  NX: 8,
  TX: 7,
  X: 6,
  M: 5,
  R: 4,
  P: 3,
  U: 2,
  C: 1,
};

const COLOR_SORT_ORDER: Record<string, number> = {
  Red: 1,
  Purple: 2,
  Green: 3,
  White: 4,
  Yellow: 5,
  Blue: 6,
};

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function computeSetReleaseRank(s: ProductSet, idx: number, total: number): number {
  const rd = (s.releaseDate || '').trim();
  const ym = rd.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i);
  if (ym) {
    const year = Number(ym[2]);
    const mon = MONTH_INDEX[ym[1].slice(0, 3).toLowerCase()] || 6;
    return year * 10000 + mon * 100 + Math.max(0, total - idx);
  }
  const iso = rd.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/);
  if (iso) {
    return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Math.max(0, total - idx);
  }
  const yOnly = rd.match(/\b(20\d{2})\b/);
  if (yOnly) {
    return Number(yOnly[1]) * 10000 + 600 + Math.max(0, total - idx);
  }

  // Estimate chronological era from setCode when explicit releaseDate lacks year
  const code = s.setCode.toUpperCase();
  if (/^26R/.test(code)) return 20260400 + Math.max(0, total - idx);
  const bsM = code.match(/^BS(\d{2})$/);
  if (bsM) {
    const num = Number(bsM[1]);
    return (200800 + Math.round((num / 77) * 1800)) * 100 + Math.max(0, total - idx);
  }
  const sdM = code.match(/^SD(\d{2})$/);
  if (sdM) {
    const num = Number(sdM[1]);
    return (200800 + Math.round((num / 70) * 1800)) * 100 + Math.max(0, total - idx);
  }
  const cbM = code.match(/^CB(\d{2})$/);
  if (cbM) {
    const num = Number(cbM[1]);
    return (201700 + Math.round((num / 35) * 900)) * 100 + Math.max(0, total - idx);
  }
  const bscM = code.match(/^BSC(\d{2})$/);
  if (bscM) {
    const num = Number(bscM[1]);
    return (200900 + Math.round((num / 51) * 1700)) * 100 + Math.max(0, total - idx);
  }
  return 20150000 + Math.max(0, total - idx);
}

interface SearchSetIntent {
  exactSetCode?: string;
  paddedSetNum?: string;
  rawDigits?: string;
}

function resolveSearchSetIntent(
  rawQuery: string,
  knownSetCodes: Set<string>,
  numericSetCodes?: Set<string>
): SearchSetIntent | null {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return null;

  const explicitSetPrefix = /^set\s+/i.test(q);
  const numOnly = q.match(/^(?:set\s*)?(\d{1,4})$/i);
  if (numOnly) {
    const rawDigits = numOnly[1];
    const padded = rawDigits.length <= 2 ? rawDigits.padStart(2, '0') : rawDigits;
    const unpadded = String(Number(rawDigits));
    const exactNumCode = knownSetCodes.has(rawDigits)
      ? rawDigits
      : knownSetCodes.has(padded)
      ? padded
      : knownSetCodes.has(unpadded)
      ? unpadded
      : numericSetCodes?.has(rawDigits)
      ? rawDigits
      : numericSetCodes?.has(padded)
      ? padded
      : undefined;

    // Preserve literal text search for 3-4 digit numbers (e.g. BP values) unless it matches a known/numeric set code or has "set " prefix
    if (rawDigits.length <= 2 || exactNumCode || explicitSetPrefix) {
      return {
        ...(exactNumCode ? { exactSetCode: exactNumCode } : {}),
        paddedSetNum: rawDigits.length <= 2 ? padded : rawDigits,
        rawDigits,
      };
    }
  }

  const stripped = q.replace(/^set\s+/i, '').trim();
  const compact = stripped.replace(/[\s-]+/g, '').toUpperCase();

  // Normalize single-digit prefixes like "BS 1" -> "BS01", "SD 1" -> "SD01"
  const shortCodeMatch = compact.match(/^(BS|SD|CB|BSC|PB|PC|RP|PX)(\d{1})$/);
  const candidate = shortCodeMatch
    ? `${shortCodeMatch[1]}0${shortCodeMatch[2]}`
    : compact;

  if (knownSetCodes.has(candidate)) {
    return { exactSetCode: candidate };
  }
  return null;
}

export function normalizeSetCodeForClient(rawCode: string): string {
  const upper = (rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!upper) return '';
  return upper
    .replace(/^(26R)-(BS|SD|EB|DB|CB)(\d+)$/, '$1$2$3')
    .replace(/([A-Z])[-]+(\d)/g, '$1$2');
}

function getCardNumberPrefix(cardNumber: string): string {
  const m = (cardNumber || '').trim().match(/^([A-Z0-9]+)-/i);
  return m ? normalizeSetCodeForClient(m[1]) : '';
}

function parseStateFromUrl(): {
  tab: AppTab;
  filters: FilterState;
  sharedDeck: SharedDeckPayload | null;
} {
  if (typeof window === 'undefined') {
    return { tab: 'catalog', filters: INITIAL_FILTERS, sharedDeck: null };
  }
  const params = new URLSearchParams(window.location.search);
  const rawShare = params.get('share');
  const sharedDeck = rawShare ? decodeSharedDeck(rawShare) : null;

  const rawTabParam = params.get('tab');
  const mappedTab = rawTabParam === 'rules' ? 'settings' : (rawTabParam as AppTab | null);
  const tab: AppTab =
    mappedTab && VALID_TABS.includes(mappedTab)
      ? mappedTab
      : sharedDeck
      ? 'decks'
      : 'catalog';

  const rawFmt = params.get('fmt') as FormatFilter | null;
  const rawVer = params.get('ver') as FilterState['version'] | null;
  const rawColor = params.get('color') as ColorFilter | null;
  const rawType = params.get('type');
  const rawRarity = params.get('rarity');
  const rawCost = params.get('cost') as FilterState['costBracket'] | null;
  const rawSort = params.get('sort') as SortOption | null;

  const parsedTypes = rawType
    ? rawType
        .split(',')
        .map((t) => t.trim())
        .filter((t): t is CardType => VALID_TYPES.includes(t as CardType))
    : [];
  const parsedRarities = rawRarity
    ? rawRarity
        .split(',')
        .map((r) => r.trim())
        .filter((r): r is CardRarity => VALID_RARITIES.includes(r as CardRarity))
    : [];

  return {
    tab,
    sharedDeck,
    filters: {
      search: params.get('q') || '',
      setQuery: params.get('setq') || '',
      format: rawFmt && VALID_FORMATS.includes(rawFmt) ? rawFmt : 'All',
      version: rawVer && VALID_VERSIONS.includes(rawVer) ? rawVer : 'All',
      color: rawColor && VALID_COLORS.includes(rawColor) ? rawColor : 'All',
      type: parsedTypes,
      rarity: parsedRarities,
      setCode: params.get('set') || 'All',
      costBracket: rawCost && VALID_COSTS.includes(rawCost) ? rawCost : 'All',
      keyword: params.get('kw') || 'All',
      sortBy: rawSort && VALID_SORTS.includes(rawSort) ? rawSort : 'number',
    },
  };
}

function buildUrlSearch(tab: AppTab, filters: FilterState): string {
  const params = new URLSearchParams();
  if (tab !== 'catalog') params.set('tab', tab);
  if (filters.format !== 'All') params.set('fmt', filters.format);
  if (filters.version !== 'All') params.set('ver', filters.version);
  if (filters.color !== 'All') params.set('color', filters.color);
  if (filters.type.length > 0) params.set('type', filters.type.join(','));
  if (filters.rarity.length > 0) params.set('rarity', filters.rarity.join(','));
  if (filters.setCode !== 'All') params.set('set', filters.setCode);
  if (filters.costBracket !== 'All') params.set('cost', filters.costBracket);
  if (filters.keyword !== 'All') params.set('kw', filters.keyword);
  if (filters.sortBy !== 'number') params.set('sort', filters.sortBy);
  if (filters.setQuery) params.set('setq', filters.setQuery);
  if (filters.search) params.set('q', filters.search);
  const str = params.toString();
  return str ? `?${str}` : '';
}

export function getCardColors(card: BattleSpiritsCard): CardColor[] {
  if (card.colors && card.colors.length > 0) return card.colors;
  if (card.secondaryColor && card.secondaryColor !== card.color) {
    return [card.color, card.secondaryColor];
  }
  return [card.color];
}

const STORAGE_DECKS_KEY = 'spiritsdex_decks_v1';
const STORAGE_DECK_FOLDERS_KEY = 'spiritsdex_deck_folders_v1';
const STORAGE_ACTIVE_DECK_KEY = 'spiritsdex_active_deck_v1';
const STORAGE_WIKI_CARDS_KEY = 'spiritsdex_wiki_cards_v4';

function matchesFormatFilter(formats: GameFormat[], filter: FormatFilter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Standard') return formats.includes('Standard');
  return !formats.includes('Standard') && formats.includes('Eternal');
}

function normalizeBanName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/\s*\(revival\)\s*/gi, '')
    .replace(/\s+/g, ' ');
}

function resolveBanRestriction(
  card: BattleSpiritsCard,
  banList: BanListSnapshot | null
): BattleSpiritsCard['restriction'] {
  if (!banList) return card.restriction || 'Unlimited';
  const codeKey = normalizeCardNumber(card.cardNumber || '');
  if (codeKey && banList.byCardNumber[codeKey]) {
    return banList.byCardNumber[codeKey];
  }
  const compactKey = compactCardNumber(card.cardNumber || '');
  if (compactKey && banList.byCardNumber[compactKey]) {
    return banList.byCardNumber[compactKey];
  }
  const nameKey = normalizeBanName(card.name || '');
  if (nameKey) {
    const verKey = `${nameKey}|${card.isRevival ? 'rv' : 'orig'}`;
    if (banList.byName[verKey]) return banList.byName[verKey];
    if (banList.byName[nameKey]) return banList.byName[nameKey];
  }
  return card.restriction || 'Unlimited';
}

function sanitizeCardTextTemplates(card: BattleSpiritsCard): BattleSpiritsCard {
  const cleanStr = (s: string) =>
    s
      .replace(/SuAdcon\s+([^\]\n]+)/gi, '[Summon/Advent Condition: $1]')
      .replace(/\bSumcon\s+([^\]\n]+)/gi, '[Summon Condition: $1]');

  const safeEffects = Array.isArray(card.effects) ? card.effects : [];
  const hasDirtyEffect = safeEffects.some((e) =>
    /\b(?:SuAdcon|Sumcon)\b/i.test(`${e?.timing || ''} ${e?.text || ''}`)
  );
  if (!hasDirtyEffect) return safeEffects === card.effects ? card : { ...card, effects: safeEffects };

  let extractedSummon = card.summonCondition;
  const cleanedEffects = card.effects.map((e) => {
    const nextText = cleanStr(e.text);
    const nextTiming = cleanStr(e.timing);
    if (!extractedSummon) {
      const m = `${nextTiming}\n${nextText}`.match(
        /\[(?:Summon(?:\/Advent)?|Advent)\s+Condition:\s*([^\]]+)\]/i
      );
      if (m) extractedSummon = m[1].trim();
    }
    return { timing: nextTiming, text: nextText };
  });

  return {
    ...card,
    effects: cleanedEffects,
    summonCondition: extractedSummon,
  };
}

export function mergeCardsIntoMap(
  prev: Record<string, BattleSpiritsCard>,
  incomingCards: BattleSpiritsCard[],
  options?: {
    banList?: BanListSnapshot | null;
    forceRevival?: boolean;
    forceToken?: boolean;
    preferExisting?: boolean;
    preserveSetCode?: boolean;
  }
): { next: Record<string, BattleSpiritsCard>; addedCount: number } {
  const next = { ...prev };
  const keyToId = new Map<string, string>();
  const productSetByCode = new Map(
    PRODUCT_SETS.map((s) => [normalizeSetCodeForClient(s.setCode), s])
  );

  const indexCard = (c: BattleSpiritsCard) => {
    const ver = c.isRevival ? 'rv' : 'orig';
    const normNum = normalizeCardNumber(c.cardNumber || '');
    const normSet = normalizeSetCodeForClient(c.setCode || '');
    if (normNum && normNum !== 'WIKI') {
      if (normSet) {
        const setNumKey = `num:${normNum}|${normSet}|${ver}`;
        if (!keyToId.has(setNumKey)) keyToId.set(setNumKey, c.id);
      }
      const nk = `num:${normNum}|${ver}`;
      if (!keyToId.has(nk)) keyToId.set(nk, c.id);
    }
    const cleanName = normalizeCardName(c.name || '').replace(/\s*\(revival\)\s*$/i, '');
    if (cleanName) {
      if (normSet) {
        const setNmKey = `name:${cleanName}|${normSet}|${ver}`;
        if (!keyToId.has(setNmKey)) keyToId.set(setNmKey, c.id);
      }
      const nmKey = `name:${cleanName}|${ver}`;
      if (!keyToId.has(nmKey)) keyToId.set(nmKey, c.id);
    }
    if (!c.isRevival && c.wikiTitle) {
      const wkKey = `wiki:${c.wikiTitle.trim().toLowerCase()}|${normSet || '*'}|orig`;
      if (!keyToId.has(wkKey)) keyToId.set(wkKey, c.id);
    }
  };

  for (const b of BATTLE_SPIRITS_CARDS) indexCard(b);
  for (const existing of Object.values(next)) indexCard(existing);

  let addedCount = 0;

  for (const rawCard of incomingCards) {
    let c = sanitizeCardTextTemplates(rawCard);
    const isRev = options?.forceRevival ?? Boolean(c.isRevival);
    const ver = isRev ? 'rv' : 'orig';
    const normNum = normalizeCardNumber(c.cardNumber || '');
    const cleanName = normalizeCardName(c.name || '').replace(/\s*\(revival\)\s*$/i, '');
    let normSet = normalizeSetCodeForClient(c.setCode || '');

    // Self-heal cross-set Booster reprint attribution ONLY when not explicitly keyed/imported into its set
    const prefix = getCardNumberPrefix(c.cardNumber || '');
    const cardIdEncodesSet =
      Boolean(normSet) && (c.id || '').toUpperCase().startsWith(`${normSet}-`);
    if (
      !options?.preserveSetCode &&
      !cardIdEncodesSet &&
      prefix &&
      prefix !== normSet &&
      !isRev
    ) {
      const curSet = productSetByCode.get(normSet);
      const prefixSet = productSetByCode.get(prefix);
      if (
        prefixSet &&
        curSet?.category === 'Booster' &&
        (prefixSet.category === 'Booster' ||
          prefixSet.category === 'Standard Booster' ||
          prefixSet.category === 'Standard Starter')
      ) {
        c = {
          ...c,
          setCode: prefixSet.setCode,
          setName: prefixSet.name,
          blockIcon: prefixSet.blockLabel || c.blockIcon,
          formats: prefixSet.formats.length > 0 ? prefixSet.formats : c.formats,
        };
        normSet = normalizeSetCodeForClient(prefixSet.setCode);
      }
    }

    let targetId = next[c.id] ? c.id : undefined;
    if (!targetId && normNum && normNum !== 'WIKI') {
      targetId =
        (normSet ? keyToId.get(`num:${normNum}|${normSet}|${ver}`) : undefined) ||
        undefined;
      if (!targetId) {
        const genericNumTarget = keyToId.get(`num:${normNum}|${ver}`);
        if (genericNumTarget) {
          const existingSet = normalizeSetCodeForClient(next[genericNumTarget]?.setCode || '');
          if (!normSet || !existingSet || existingSet === normSet) {
            targetId = genericNumTarget;
          }
        }
      }
    }
    if (!targetId && !isRev && c.wikiTitle) {
      targetId = keyToId.get(`wiki:${c.wikiTitle.trim().toLowerCase()}|${normSet || '*'}|orig`);
    }
    if (!targetId && !isRev && cleanName && normSet) {
      targetId = keyToId.get(`name:${cleanName}|${normSet}|orig`);
    }
    if (!targetId && !isRev && cleanName && (!normNum || normNum === 'WIKI')) {
      targetId = keyToId.get(`name:${cleanName}|orig`);
    }
    if (!targetId) targetId = c.id;

    const existing = next[targetId];
    if (!existing) addedCount++;

    const primary = options?.preferExisting && existing ? existing : c;
    const secondary = options?.preferExisting && existing ? c : existing;

    const merged: BattleSpiritsCard = {
      ...(secondary || {}),
      ...primary,
      id: targetId,
      name: primary.name || secondary?.name || c.cardNumber || targetId,
      jpName: primary.jpName || secondary?.jpName || '',
      cardNumber: primary.cardNumber || secondary?.cardNumber || 'WIKI',
      setCode: primary.setCode || secondary?.setCode || 'BS01',
      setName: primary.setName || secondary?.setName || 'Battle Spirits',
      color: primary.color && COLOR_META[primary.color] ? primary.color : secondary?.color || 'Red',
      cost: Number.isFinite(Number(primary.cost)) ? Number(primary.cost) : secondary?.cost ?? 0,
      rarity: primary.rarity || secondary?.rarity || 'C',
      formats:
        Array.isArray(primary.formats) && primary.formats.length > 0
          ? primary.formats
          : Array.isArray(secondary?.formats) && secondary.formats.length > 0
          ? secondary.formats
          : ['Eternal'],
      type: primary.type || secondary?.type || 'Spirit',
      subtypeLabel: primary.subtypeLabel ?? secondary?.subtypeLabel,
      isRevival: isRev,
      isToken: options?.forceToken ?? primary.isToken ?? secondary?.isToken,
      colors: primary.colors && primary.colors.length > 0 ? primary.colors : secondary?.colors,
      families: primary.families && primary.families.length > 0 ? primary.families : secondary?.families || [],
      levels: primary.levels && primary.levels.length > 0 ? primary.levels : secondary?.levels,
      braveCondition: primary.braveCondition ?? secondary?.braveCondition,
      braveBonusBp: primary.braveBonusBp ?? secondary?.braveBonusBp,
      summonCondition: primary.summonCondition ?? secondary?.summonCondition,
      symbols:
        primary.symbols && Object.keys(primary.symbols).length > 0
          ? primary.symbols
          : secondary?.symbols || {},
      reduction:
        primary.reduction && Object.keys(primary.reduction).length > 0
          ? primary.reduction
          : secondary?.reduction || {},
      effects: primary.effects && primary.effects.length > 0 ? primary.effects : secondary?.effects || [],
      keywords: primary.keywords && primary.keywords.length > 0 ? primary.keywords : secondary?.keywords || [],
      flavorText: primary.flavorText || secondary?.flavorText || '',
      illustrator: primary.illustrator || secondary?.illustrator || '',
      artworkImage: '',
      galleryImages:
        primary.galleryImages && primary.galleryImages.length > 0
          ? primary.galleryImages
          : secondary?.galleryImages,
      rulings: primary.rulings && primary.rulings.length > 0 ? primary.rulings : secondary?.rulings || [],
      wikiTitle: primary.wikiTitle || secondary?.wikiTitle,
      isWikiLoaded: Boolean(primary.isWikiLoaded || secondary?.isWikiLoaded),
    };

    const manualMapping = getManualWikiMapping(merged);
    const manualArtworkUrl = manualMapping
      ? resolveManualMappingArtworkUrl(merged, manualMapping)
      : null;

    if (manualMapping && manualArtworkUrl) {
      if (manualMapping.wikiTitle) {
        merged.wikiTitle = manualMapping.wikiTitle;
      }
      merged.artworkImage = manualArtworkUrl;
      if (merged.galleryImages && merged.galleryImages.length > 0) {
        const mappedRest = merged.galleryImages
          .map((g) => ({
            ...g,
            url: buildWikiImageUrl(merged, g.url),
          }))
          .filter((g) => g.url && g.url !== manualArtworkUrl);
        merged.galleryImages = [
          {
            url: manualArtworkUrl,
            caption: manualMapping.notes || `${merged.cardNumber} — Verified Artwork`,
          },
          ...mappedRest,
        ];
      }
    } else {
      merged.artworkImage = buildWikiImageUrl(
        merged,
        primary.artworkImage || secondary?.artworkImage || ''
      );
      if (merged.galleryImages && merged.galleryImages.length > 0) {
        merged.galleryImages = merged.galleryImages.map((g) => ({
          ...g,
          url: buildWikiImageUrl(merged, g.url),
        }));
      }
    }

    if (options?.banList) {
      merged.restriction = resolveBanRestriction(merged, options.banList);
    }

    next[targetId] = merged;
    indexCard(merged);
  }

  return { next, addedCount };
}

export default function App() {
  const initialFromUrl = useMemo(() => parseStateFromUrl(), []);
  const [activeTab, setActiveTab] = useState<AppTab>(initialFromUrl.tab);
  const [filters, setFilters] = useState<FilterState>(initialFromUrl.filters);
  const [pendingSharedDeck, setPendingSharedDeck] = useState<SharedDeckPayload | null>(
    initialFromUrl.sharedDeck
  );
  const [banList, setBanList] = useState<BanListSnapshot | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<BattleSpiritsCard | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [productSets, setProductSets] = useState<ProductSet[]>(() => {
    const cached = loadFastCachedSets();
    return cached
      ? synchronizeAndIndexSets([PRODUCT_SETS, cached.sets]).sets
      : PRODUCT_SETS;
  });
  const [loadingCardsJson, setLoadingCardsJson] = useState(true);
  const [searchAnchorIndex, setSearchAnchorIndex] = useState(0);

  // Google Firebase Auth & Cloud Sync State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [liveProfilesByUid, setLiveProfilesByUid] = useState<Record<string, PublicBuilderProfile>>({});
  const cloudHydratedUidRef = useRef<string | null>(null);
  const decksRef = useRef<Deck[]>([]);
  const foldersRef = useRef<DeckFolder[]>([]);

  const [cardsMap, setCardsMap] = useState<Record<string, BattleSpiritsCard>>(() => {
    const { next: initial } = mergeCardsIntoMap({}, BATTLE_SPIRITS_CARDS);
    try {
      const savedWiki = localStorage.getItem(STORAGE_WIKI_CARDS_KEY);
      if (savedWiki) {
        const parsed = JSON.parse(savedWiki);
        if (parsed && typeof parsed === 'object') {
          const cachedList = Object.values(parsed).filter(
            (c): c is BattleSpiritsCard => Boolean(c && typeof c === 'object')
          );
          const { next } = mergeCardsIntoMap(initial, cachedList);
          return next;
        }
      }
    } catch {
      // ignore storage errors
    }
    return initial;
  });

  const [deckFolders, setDeckFolders] = useState<DeckFolder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DECK_FOLDERS_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((f): f is Record<string, any> => Boolean(f && typeof f === 'object' && f.id))
            .map((f) => ({
              id: String(f.id),
              name: String(f.name || 'Untitled Folder').trim() || 'Untitled Folder',
              color: f.color && COLOR_META[f.color as CardColor] ? (f.color as CardColor) : undefined,
              createdAt: String(f.createdAt || new Date().toISOString().slice(0, 10)),
            }));
        }
      }
    } catch {
      // ignore storage errors
    }
    return PRESET_DECK_FOLDERS;
  });

  const [decks, setDecks] = useState<Deck[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DECKS_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((d): d is Record<string, any> => Boolean(d && typeof d === 'object' && d.id))
            .map((d) => ({
              id: String(d.id),
              name: String(d.name || 'Untitled Deck'),
              format: d.format === 'Standard' || d.format === 'Eternal' ? d.format : 'Eternal',
              archetype: String(d.archetype || 'Custom Build'),
              ...(typeof d.folderId === 'string' && d.folderId.trim()
                ? { folderId: d.folderId.trim() }
                : {}),
              ...(typeof d.category === 'string' && d.category.trim()
                ? { category: d.category.trim() }
                : {}),
              updatedAt: String(d.updatedAt || new Date().toISOString().slice(0, 10)),
              entries: Array.isArray(d.entries)
                ? d.entries
                    .filter(
                      (e: any): e is DeckEntry =>
                        Boolean(e && typeof e === 'object' && typeof e.cardId === 'string')
                    )
                    .map((e: DeckEntry) => ({
                      cardId: e.cardId,
                      quantity: Math.max(0, Math.round(Number(e.quantity) || 0)),
                    }))
                    .filter((e: DeckEntry) => e.quantity > 0 && !isTokenCard(cardsMap[e.cardId]))
                : [],
            }));
        }
      }
    } catch {
      // ignore storage errors
    }
    return PRESET_DECKS;
  });

  const [activeDeckId, setActiveDeckId] = useState<string>(() => {
    try {
      const savedId = localStorage.getItem(STORAGE_ACTIVE_DECK_KEY);
      if (savedId && decks.some((d) => d.id === savedId)) {
        return savedId;
      }
    } catch {
      // ignore
    }
    return decks[0]?.id || 'deck-std-genesis-pulse';
  });

  // Sync activeTab + filters to URL query string so refreshing stays on the exact view/filters
  useEffect(() => {
    if (pendingSharedDeck) return;
    const nextSearch = buildUrlSearch(activeTab, filters);
    if (window.location.search !== nextSearch) {
      const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeTab, filters, pendingSharedDeck]);

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseStateFromUrl();
      setActiveTab(parsed.tab);
      setFilters(parsed.filters);
      setPendingSharedDeck(parsed.sharedDeck);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    try {
      if (activeDeckId) {
        localStorage.setItem(STORAGE_ACTIVE_DECK_KEY, activeDeckId);
      }
    } catch {
      // ignore
    }
  }, [activeDeckId]);

  // Load 100% offline local /cards.json database (cached by Service Worker for instant offline access)
  useEffect(() => {
    let cancelled = false;
    setLoadingCardsJson(true);

    fetch('/cards.json')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            generatedAt?: string;
            sets?: ProductSet[];
            banList?: BanListSnapshot;
            cards?: BattleSpiritsCard[];
          } | null
        ) => {
          if (cancelled || !data) return;

          const nextBanList =
            data.banList && data.banList.byCardNumber ? data.banList : null;
          if (nextBanList) {
            setBanList(nextBanList);
            void saveOfflineMeta({ banList: nextBanList });
          }

          if (Array.isArray(data.sets) || (Array.isArray(data.cards) && data.cards.length > 0)) {
            const incomingCards = Array.isArray(data.cards) ? data.cards : [];
            const incomingSets = Array.isArray(data.sets) ? data.sets : [];
            setProductSets((curr) => {
              const synced = synchronizeAndIndexSets(
                [PRODUCT_SETS, curr, incomingSets],
                incomingCards
              );
              const syncedAt = Date.now();
              saveFastCachedSets(synced.sets, syncedAt);
              void saveOfflineMeta({ productSets: synced.sets, setSyncedAt: syncedAt });
              return synced.sets;
            });
          }

          if (Array.isArray(data.cards) && data.cards.length > 0) {
            setCardsMap((prev) => {
              const { next } = mergeCardsIntoMap(prev, data.cards!, {
                banList: nextBanList,
              });
              if (nextBanList) {
                for (const [id, card] of Object.entries(next)) {
                  const updatedRestriction = resolveBanRestriction(card, nextBanList);
                  if (updatedRestriction !== (card.restriction || 'Unlimited')) {
                    next[id] = { ...card, restriction: updatedRestriction };
                  }
                }
              }
              return next;
            });
          }
        }
      )
      .catch(() => {
        // IndexedDB + bundled fallback handles missing/corrupt response cleanly
      })
      .finally(() => {
        if (!cancelled) setLoadingCardsJson(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    decksRef.current = decks;
    try {
      localStorage.setItem(STORAGE_DECKS_KEY, JSON.stringify(decks));
    } catch {
      // ignore
    }
  }, [decks]);

  useEffect(() => {
    foldersRef.current = deckFolders;
    try {
      localStorage.setItem(STORAGE_DECK_FOLDERS_KEY, JSON.stringify(deckFolders));
    } catch {
      // ignore
    }
  }, [deckFolders]);

  // Listen for Firebase Auth state & sync cloud decks/folders on Google sign-in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setAuthReady(true);

      if (!user) {
        cloudHydratedUidRef.current = null;
        return;
      }

      setCloudSyncing(true);
      try {
        await syncUserAccountsOnSignIn(user);
        const cloudLib = await fetchUserCloudLibrary(user.uid);
        const presetIds = new Set(PRESET_DECKS.map((d) => d.id));
        const cloudDeckIds = new Set(cloudLib.decks.map((d) => d.id));
        const localUnsavedDecks = decksRef.current.filter(
          (d) => !cloudDeckIds.has(d.id) && (cloudLib.decks.length === 0 || !presetIds.has(d.id))
        );
        const mergedDecks = [...cloudLib.decks, ...localUnsavedDecks];

        const cloudFolderIds = new Set(cloudLib.folders.map((f) => f.id));
        const localUnsavedFolders = foldersRef.current.filter((f) => !cloudFolderIds.has(f.id));
        const mergedFolders = [...cloudLib.folders, ...localUnsavedFolders];

        if (mergedFolders.length > 0) {
          setDeckFolders(mergedFolders);
        }
        if (mergedDecks.length > 0) {
          setDecks(mergedDecks);
          if (!mergedDecks.some((d) => d.id === activeDeckId)) {
            setActiveDeckId(mergedDecks[0].id);
          }
        }

        if (localUnsavedDecks.length > 0 || localUnsavedFolders.length > 0) {
          await syncAllDecksAndFoldersToCloud(user.uid, mergedFolders, mergedDecks);
        }

        cloudHydratedUidRef.current = user.uid;

        const profs = await fetchPublicProfiles().catch(() => ({}));
        if (Object.keys(profs).length > 0) {
          setLiveProfilesByUid((prev) => ({ ...prev, ...profs }));
        }
      } catch (err) {
        console.warn('Cloud library sync warning:', err);
      } finally {
        setCloudSyncing(false);
      }
    });

    return () => unsub();
  }, []);

  // Debounced auto-save decks & folders to Firestore whenever signed-in user edits
  useEffect(() => {
    if (!currentUser || cloudHydratedUidRef.current !== currentUser.uid) return;
    const uid = currentUser.uid;
    const timer = window.setTimeout(() => {
      setCloudSyncing(true);
      syncAllDecksAndFoldersToCloud(uid, deckFolders, decks)
        .catch((err) => console.warn('Cloud auto-save error:', err))
        .finally(() => setCloudSyncing(false));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [currentUser, decks, deckFolders]);

  // Automatically strip any Token cards from saved decks once card metadata is loaded
  useEffect(() => {
    const hasAnyTokenEntry = decks.some((deck) =>
      deck.entries.some((entry) => isTokenCard(cardsMap[entry.cardId]))
    );
    if (!hasAnyTokenEntry) return;
    setDecks((prev) =>
      prev.map((deck) => ({
        ...deck,
        entries: deck.entries.filter((entry) => !isTokenCard(cardsMap[entry.cardId])),
      }))
    );
  }, [cardsMap, decks]);

  // Restore full cached Wiki cards, set directory, and banlist from IndexedDB on startup (offline resilience)
  useEffect(() => {
    let cancelled = false;
    loadOfflineSnapshot().then((snapshot) => {
      if (cancelled) return;
      if (snapshot.banList) {
        setBanList((curr) => curr || snapshot.banList!);
      }
      if (snapshot.productSets && snapshot.productSets.length > 0) {
        setProductSets((curr) => {
          const merged = synchronizeAndIndexSets([PRODUCT_SETS, curr, snapshot.productSets!]);
          saveFastCachedSets(merged.sets, snapshot.setSyncedAt || Date.now());
          return merged.sets;
        });
      }
      if (snapshot.cards.length > 0) {
        setCardsMap(
          (prev) =>
            mergeCardsIntoMap(prev, snapshot.cards, {
              banList: snapshot.banList || null,
              preferExisting: true,
            }).next
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-use cached set metadata or synchronize missing/stale directory metadata with Wiki server
  useEffect(() => {
    if (typeof window === 'undefined' || navigator.onLine === false) return;
    const SIX_HOURS_MS = 1000 * 60 * 60 * 6;
    const cached = loadFastCachedSets();
    if (
      cached &&
      cached.sets.length > PRODUCT_SETS.length &&
      Date.now() - cached.syncedAt < SIX_HOURS_MS
    ) {
      return;
    }

    let cancelled = false;
    fetch('/api/wiki/directory')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { sets?: ProductSet[]; syncedAt?: number } | null) => {
        if (cancelled || !payload || !Array.isArray(payload.sets) || payload.sets.length === 0) {
          return;
        }
        const syncedAt = typeof payload.syncedAt === 'number' ? payload.syncedAt : Date.now();
        setProductSets((curr) => {
          const merged = synchronizeAndIndexSets([PRODUCT_SETS, curr, payload.sets!]);
          saveFastCachedSets(merged.sets, syncedAt);
          void saveOfflineMeta({ productSets: merged.sets, setSyncedAt: syncedAt });
          return merged.sets;
        });
      })
      .catch(() => {
        // Offline or unreachable — existing fast cache / IndexedDB metadata remains active
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const applyImportedCatalogAdditions = useCallback(
    (incomingSets: ProductSet[], incomingCards: BattleSpiritsCard[]) => {
      if (incomingSets.length > 0 || incomingCards.length > 0) {
        setProductSets((curr) => {
          const synced = synchronizeAndIndexSets([PRODUCT_SETS, curr, incomingSets], incomingCards);
          const nowTs = Date.now();
          saveFastCachedSets(synced.sets, nowTs);
          void saveOfflineMeta({ productSets: synced.sets, setSyncedAt: nowTs });
          return synced.sets;
        });
      }
      if (incomingCards.length > 0) {
        setCardsMap((prev) => {
          const { next } = mergeCardsIntoMap(prev, incomingCards, {
            banList,
            preferExisting: true,
            preserveSetCode: true,
          });
          return next;
        });
      }
    },
    [banList]
  );

  // Merge non-destructive server-imported & Firestore-published Wiki catalog additions
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    fetch('/api/catalog/imported')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { sets?: ProductSet[]; cards?: BattleSpiritsCard[] } | null) => {
        if (cancelled || !payload) return;
        const sets = Array.isArray(payload.sets) ? payload.sets : [];
        const cards = Array.isArray(payload.cards) ? payload.cards : [];
        if (sets.length > 0 || cards.length > 0) {
          applyImportedCatalogAdditions(sets, cards);
        }
      })
      .catch(() => {
        // Offline / server unavailable — IndexedDB & local bundles handle cleanly
      });

    void fetchPublishedCatalogAdditions().then(({ sets, cards }) => {
      if (cancelled) return;
      if (sets.length > 0 || cards.length > 0) {
        applyImportedCatalogAdditions(sets, cards);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyImportedCatalogAdditions]);

  // Persist all hydrated or fetched card metadata into IndexedDB (debounced) so offline browsing & card details stay complete
  useEffect(() => {
    const bundledIds = new Set(BATTLE_SPIRITS_CARDS.map((c) => c.id));
    const timeout = window.setTimeout(() => {
      const toCache = Object.values(cardsMap).filter(
        (c) => Boolean(c.isWikiLoaded) || !bundledIds.has(c.id)
      );
      if (toCache.length > 0) {
        void saveOfflineCards(toCache);
      }
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [cardsMap]);

  // Persist any non-bundled wiki cards used in saved decks into localStorage as a fast synchronous backup
  useEffect(() => {
    try {
      const bundledIds = new Set(BATTLE_SPIRITS_CARDS.map((c) => c.id));
      const deckCardIds = new Set<string>();
      decks.forEach((d) => d.entries.forEach((e) => deckCardIds.add(e.cardId)));
      const toPersist: Record<string, BattleSpiritsCard> = {};
      deckCardIds.forEach((id) => {
        if (!bundledIds.has(id) && cardsMap[id]) {
          toPersist[id] = cardsMap[id];
        }
      });
      localStorage.setItem(STORAGE_WIKI_CARDS_KEY, JSON.stringify(toPersist));
    } catch {
      // ignore quota errors
    }
  }, [decks, cardsMap]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
  };

  useEffect(() => {
    const handleOfflineReady = () => {
      try {
        const flagKey = 'spiritsdex_sw_cached_notified_v1';
        if (!localStorage.getItem(flagKey)) {
          localStorage.setItem(flagKey, '1');
          setToastMsg('Core card database cached for offline browsing');
        }
      } catch {
        setToastMsg('Core card database cached for offline browsing');
      }
    };
    window.addEventListener('spiritsdex:offline-ready', handleOfflineReady);
    return () => window.removeEventListener('spiritsdex:offline-ready', handleOfflineReady);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2400);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const allCardsList = useMemo(() => Object.values(cardsMap), [cardsMap]);

  const indexedSetDirectory = useMemo(
    () => synchronizeAndIndexSets([productSets], allCardsList),
    [productSets, allCardsList]
  );

  const syncedProductSets = indexedSetDirectory.sets;

  const availableSets = useMemo(() => {
    return syncedProductSets
      .filter((s) => matchesFormatFilter(s.formats, filters.format))
      .map((s) => ({ setCode: s.setCode, name: s.name }));
  }, [syncedProductSets, filters.format]);

  const availableKeywords = useMemo(() => {
    const set = new Set<string>();
    allCardsList.forEach((c) => c.keywords.forEach((k) => set.add(k)));
    return Array.from(set).sort();
  }, [allCardsList]);

  const activeDeck = decks.find((d) => d.id === activeDeckId) || decks[0];
  const activeDeckFormat: GameFormat = activeDeck?.format || 'Eternal';

  const activeDeckQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (activeDeck) {
      activeDeck.entries.forEach((e) => {
        map[e.cardId] = e.quantity;
      });
    }
    return map;
  }, [activeDeck]);

  const activeDeckTotal = useMemo(() => {
    if (!activeDeck) return 0;
    return activeDeck.entries.reduce((sum, e) => sum + e.quantity, 0);
  }, [activeDeck]);

  const updateFilters = useCallback(
    (next: FilterState) => {
      if (next.format !== filters.format) {
        let resolvedSetCode = next.setCode;
        if (resolvedSetCode !== 'All') {
          const matchedSet =
            indexedSetDirectory.byCode.get(resolvedSetCode.toUpperCase()) ||
            indexedSetDirectory.byCode.get(normalizeSetCodeForClient(resolvedSetCode));
          if (!matchedSet || !matchesFormatFilter(matchedSet.formats, next.format)) {
            resolvedSetCode = 'All';
          }
        }
        next = { ...next, setCode: resolvedSetCode };
      }
      setFilters(next);
    },
    [filters.format, indexedSetDirectory]
  );

  const handleFormatSwitch = useCallback(
    (format: FormatFilter) => {
      updateFilters({ ...filters, format });
    },
    [filters, updateFilters]
  );

  const releaseRankBySetCode = useMemo(() => {
    const map = new Map<string, number>();
    const total = syncedProductSets.length;
    syncedProductSets.forEach((s, idx) => {
      map.set(s.setCode.toUpperCase(), computeSetReleaseRank(s, idx, total));
    });
    return map;
  }, [syncedProductSets]);

  const knownSetCodes = useMemo(() => {
    const codes = new Set<string>(['TOKENS', 'REVIVAL']);
    for (const code of indexedSetDirectory.byCode.keys()) {
      codes.add(code);
    }
    return codes;
  }, [indexedSetDirectory]);

  const setLookupByCode = indexedSetDirectory.byCode;

  const filteredCards = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const qCompact = q.replace(/[\s-]+/g, '');
    const qTokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const searchSetIntent = resolveSearchSetIntent(
      q,
      knownSetCodes,
      indexedSetDirectory.numericSetCodes
    );

    const setQ = filters.setQuery.trim().toLowerCase();
    const setQCompact = setQ.replace(/[\s-]+/g, '');
    const setQIntent = resolveSearchSetIntent(
      setQ,
      knownSetCodes,
      indexedSetDirectory.numericSetCodes
    );

    const matchesSetIntent = (card: BattleSpiritsCard, intent: SearchSetIntent) => {
      const cardSetUpper = normalizeSetCodeForClient(card.setCode);
      const cardPrefix = getCardNumberPrefix(card.cardNumber);
      if (intent.exactSetCode) {
        const normIntent = normalizeSetCodeForClient(intent.exactSetCode);
        if (normIntent === 'TOKENS') return Boolean(card.isToken);
        if (normIntent === 'REVIVAL') return Boolean(card.isRevival);
        if (cardSetUpper === normIntent || cardPrefix === normIntent) {
          return true;
        }
      }
      if (intent.rawDigits && cardSetUpper === intent.rawDigits.toUpperCase()) {
        return true;
      }
      if (intent.paddedSetNum) {
        const endRegex = new RegExp(`(?:^|[^0-9])${intent.paddedSetNum}$`, 'i');
        return (
          cardSetUpper === intent.paddedSetNum ||
          endRegex.test(cardSetUpper) ||
          endRegex.test(cardPrefix)
        );
      }
      return false;
    };

    const list = allCardsList.filter((card) => {
      if (card.setCode.toUpperCase() === 'BSS01') return false;
      if (!matchesFormatFilter(card.formats, filters.format)) return false;
      if (filters.version === 'Original' && card.isRevival) return false;
      if (filters.version === 'Revival' && !card.isRevival) return false;

      if (filters.setCode !== 'All') {
        const targetSetNorm = normalizeSetCodeForClient(filters.setCode);
        if (targetSetNorm === 'TOKENS') {
          if (!card.isToken) return false;
        } else if (targetSetNorm === 'REVIVAL') {
          if (!card.isRevival) return false;
        } else if (normalizeSetCodeForClient(card.setCode) !== targetSetNorm) {
          return false;
        }
      }

      // Dedicated Set Code / Set Name input filter
      if (setQ) {
        if (setQIntent) {
          if (!matchesSetIntent(card, setQIntent)) return false;
        } else {
          const matchedSet = setLookupByCode.get(card.setCode.toUpperCase());
          const indexedMatch = matchedSet
            ? matchesIndexedSetQuery(matchedSet, setQ, indexedSetDirectory.tokensByCode)
            : false;
          const setHay = `${card.setCode} ${card.setName} ${matchedSet?.jpName || ''} ${matchedSet?.tagline || ''}`.toLowerCase();
          const setHayCompact = setHay.replace(/[\s-]+/g, '');
          if (
            !indexedMatch &&
            !setHay.includes(setQ) &&
            !(setQCompact.length >= 2 && setHayCompact.includes(setQCompact))
          ) {
            return false;
          }
        }
      }

      // General Search Input
      if (q) {
        if (searchSetIntent) {
          if (!matchesSetIntent(card, searchSetIntent)) return false;
        } else {
          const hay = `${card.name} ${card.jpName} ${card.cardNumber} ${card.setCode} ${card.setName} ${card.subtypeLabel || ''} ${card.isToken ? 'token' : ''} ${card.isRevival ? 'revival' : ''} ${card.families.join(' ')} ${card.keywords.join(' ')} ${card.braveCondition || ''} ${card.summonCondition || ''} ${card.effects.map((e) => `${e.timing} ${e.text}`).join(' ')}`.toLowerCase();
          const compactHay = hay.replace(/[\s-]+/g, '');
          const matchesDirect = hay.includes(q) || (qCompact.length >= 2 && compactHay.includes(qCompact));
          const matchesTokens =
            qTokens.length > 1 &&
            qTokens.every((tok) => hay.includes(tok) || compactHay.includes(tok.replace(/-/g, '')));
          if (!matchesDirect && !matchesTokens) return false;
        }
      }

      const cardColors = getCardColors(card);
      if (filters.color === 'Multicolor') {
        if (cardColors.length < 2) return false;
      } else if (filters.color !== 'All') {
        // Exclude multi-color cards from single-color search
        if (cardColors.length !== 1 || cardColors[0] !== filters.color) return false;
      }

      if (filters.type.length > 0 && !filters.type.includes(card.type)) return false;
      if (filters.rarity.length > 0 && !filters.rarity.includes(card.rarity)) return false;
      if (filters.keyword !== 'All' && !card.keywords.includes(filters.keyword)) return false;

      if (filters.costBracket === '0-2' && card.cost > 2) return false;
      if (filters.costBracket === '3-4' && (card.cost < 3 || card.cost > 4)) return false;
      if (filters.costBracket === '5-6' && (card.cost < 5 || card.cost > 6)) return false;
      if (filters.costBracket === '7+' && card.cost < 7) return false;

      return true;
    });

    // Deduplicate by normalized cardNumber + version so duplicate IDs never appear twice
    // while keeping distinct card numbers even if they share a card name (e.g. reprints)
    const seenKeys = new Set<string>();
    const dedupedList = list.filter((card) => {
      const numKey = normalizeCardNumber(card.cardNumber || '');
      if (!numKey || numKey === 'WIKI') return true;
      const key = `${numKey}|${card.isRevival ? 'rv' : 'orig'}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    const getMaxBp = (c: BattleSpiritsCard) =>
      c.levels && c.levels.length > 0 ? c.levels[c.levels.length - 1].bp : 0;

    // Determine target set code priority for natural number ordering
    const targetExactSet =
      filters.setCode !== 'All'
        ? filters.setCode.toUpperCase()
        : setQIntent?.exactSetCode || searchSetIntent?.exactSetCode || '';
    const targetPaddedNum = setQIntent?.paddedSetNum || searchSetIntent?.paddedSetNum || '';

    const getNativePriority = (c: BattleSpiritsCard): number => {
      const prefix = getCardNumberPrefix(c.cardNumber);
      if (targetExactSet) {
        if (prefix === targetExactSet) return 0;
        if (c.setCode.toUpperCase() === targetExactSet) return 1;
        return 2;
      }
      if (targetPaddedNum) {
        if (prefix === `BS${targetPaddedNum}`) return 0;
        if (new RegExp(`(?:^|[^0-9])${targetPaddedNum}$`, 'i').test(prefix)) return 1;
        return 2;
      }
      return prefix === c.setCode.toUpperCase() ? 0 : 1;
    };

    dedupedList.sort((a, b) => {
      if (filters.sortBy === 'newest') {
        const ra = releaseRankBySetCode.get(a.setCode.toUpperCase()) || 0;
        const rb = releaseRankBySetCode.get(b.setCode.toUpperCase()) || 0;
        return rb - ra || getNativePriority(a) - getNativePriority(b) || a.cardNumber.localeCompare(b.cardNumber);
      }
      if (filters.sortBy === 'rarity-desc') {
        return (
          (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0) ||
          a.cardNumber.localeCompare(b.cardNumber)
        );
      }
      if (filters.sortBy === 'color') {
        const ca = COLOR_SORT_ORDER[a.color] || 99;
        const cb = COLOR_SORT_ORDER[b.color] || 99;
        const multiA = getCardColors(a).length;
        const multiB = getCardColors(b).length;
        return (
          ca - cb ||
          multiA - multiB ||
          a.cost - b.cost ||
          a.cardNumber.localeCompare(b.cardNumber)
        );
      }
      if (filters.sortBy === 'cost-asc') return a.cost - b.cost || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'cost-desc') return b.cost - a.cost || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'bp-desc') return getMaxBp(b) - getMaxBp(a) || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'name') return a.name.localeCompare(b.name);
      return getNativePriority(a) - getNativePriority(b) || a.cardNumber.localeCompare(b.cardNumber);
    });

    return dedupedList;
  }, [allCardsList, filters, knownSetCodes, releaseRankBySetCode, setLookupByCode, indexedSetDirectory]);

  useEffect(() => {
    setSearchAnchorIndex(0);
  }, [filteredCards]);

  // Pre-fetch upcoming card images in Search gallery using wikiImageClient cache
  useWikiImagePrefetch({
    cards: filteredCards,
    currentIndex: searchAnchorIndex,
    lookahead: 8,
    lookbehind: 2,
    enabled: activeTab === 'search' && filteredCards.length > 0,
  });

  const navigableCards = useMemo(() => {
    if (activeTab === 'search') {
      return filteredCards;
    }
    if (activeTab === 'decks' && activeDeck && Array.isArray(activeDeck.entries)) {
      return activeDeck.entries
        .map((e) => (e && e.cardId ? cardsMap[e.cardId] : undefined))
        .filter((c): c is BattleSpiritsCard => Boolean(c));
    }
    if (activeTab === 'catalog') {
      return allCardsList
        .filter((c) => matchesFormatFilter(c.formats, filters.format))
        .slice(0, 8);
    }
    return filteredCards;
  }, [activeTab, filteredCards, activeDeck, cardsMap, allCardsList, filters.format]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.format !== 'All') count++;
    if (filters.version !== 'All') count++;
    if (filters.color !== 'All') count++;
    if (filters.type.length > 0) count++;
    if (filters.rarity.length > 0) count++;
    if (filters.setCode !== 'All') count++;
    if (filters.setQuery.trim()) count++;
    if (filters.costBracket !== 'All') count++;
    if (filters.keyword !== 'All') count++;
    return count;
  }, [filters]);

  const getMaxCopies = (card?: BattleSpiritsCard) => getMaxCardCopies(card);

  const handleUpdateDeckQty = (cardId: string, delta: number) => {
    if (!activeDeck) {
      showToast('Create a deck in Decks first to add cards');
      return;
    }
    const card = cardsMap[cardId];
    if (delta > 0 && isTokenCard(card)) {
      showToast(`${card?.name || 'Token'} is a Token card and is used outside the main deck`);
      return;
    }

    const maxCopies = getMaxCopies(card);

    if (delta > 0 && maxCopies === 0) {
      showToast(`${card?.name || 'Card'} is Banned (0 copies allowed)`);
      return;
    }

    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== activeDeck.id) return deck;
        const existing = deck.entries.find((e) => e.cardId === cardId);
        const currentQty = existing ? existing.quantity : 0;
        const nextQty = Math.max(0, Math.min(maxCopies, currentQty + delta));

        if (nextQty === currentQty) {
          if (delta > 0 && currentQty >= maxCopies) {
            showToast(
              maxCopies === 0
                ? `${card?.name || 'Card'} is Banned (0 copies allowed)`
                : `Max ${maxCopies} ${maxCopies === 1 ? 'copy' : 'copies'} of ${
                    card?.name || 'card'
                  } allowed`
            );
          }
          return deck;
        }

        const nextEntries =
          nextQty === 0
            ? deck.entries.filter((e) => e.cardId !== cardId)
            : existing
            ? deck.entries.map((e) => (e.cardId === cardId ? { ...e, quantity: nextQty } : e))
            : [...deck.entries, { cardId, quantity: nextQty }];

        if (delta > 0 && card) {
          const isStdWarning =
            deck.format === 'Standard' && !card.formats.includes('Standard');
          showToast(
            isStdWarning
              ? `Added ${card.name} (Eternal Only — not legal in Standard)`
              : `${card.name} (${nextQty}/${maxCopies}) in ${deck.name}`
          );
        }

        return {
          ...deck,
          updatedAt: new Date().toISOString().slice(0, 10),
          entries: nextEntries,
        };
      })
    );
  };

  const handleQuickAddToDeck = (card: BattleSpiritsCard) => {
    const current = activeDeckQtyMap[card.id] || 0;
    if (isTokenCard(card)) {
      if (current > 0) {
        handleUpdateDeckQty(card.id, -current);
        showToast(`Removed Token ${card.name} from ${activeDeck?.name}`);
      } else {
        showToast(`${card.name} is a Token card and is used outside the main deck`);
      }
      return;
    }
    const maxCopies = getMaxCopies(card);
    if (current >= maxCopies) {
      handleUpdateDeckQty(card.id, -maxCopies);
      showToast(`Removed ${card.name} from ${activeDeck?.name}`);
    } else {
      handleUpdateDeckQty(card.id, 1);
    }
  };

  const handleCreateDeck = (
    name: string,
    format: GameFormat,
    archetype: string,
    folderId?: string
  ) => {
    const id = `deck-${Date.now()}`;
    const matchedFolder = folderId ? deckFolders.find((f) => f.id === folderId) : undefined;
    const newDeck: Deck = {
      id,
      name,
      format,
      archetype,
      ...(matchedFolder ? { folderId: matchedFolder.id, category: matchedFolder.name } : {}),
      updatedAt: new Date().toISOString().slice(0, 10),
      entries: [],
    };
    setDecks((prev) => [newDeck, ...prev]);
    setActiveDeckId(id);
    showToast(
      matchedFolder
        ? `Created ${format} deck "${name}" in ${matchedFolder.name}`
        : `Created ${format} deck "${name}"`
    );
  };

  const handleCreateFolder = (name: string, color?: CardColor): string => {
    const cleanName = name.trim();
    if (!cleanName) return '';
    const existing = deckFolders.find(
      (f) => f.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      showToast(`Folder "${existing.name}" already exists`);
      return existing.id;
    }
    const id = `folder-${Date.now()}`;
    const folder: DeckFolder = {
      id,
      name: cleanName,
      color,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setDeckFolders((prev) => [...prev, folder]);
    showToast(`Created folder "${cleanName}"`);
    return id;
  };

  const handleRenameFolder = (folderId: string, name: string, color?: CardColor) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    setDeckFolders((prev) =>
      prev.map((f) =>
        f.id === folderId ? { ...f, name: cleanName, color: color ?? f.color } : f
      )
    );
    setDecks((prev) =>
      prev.map((d) => (d.folderId === folderId ? { ...d, category: cleanName } : d))
    );
    showToast(`Updated folder "${cleanName}"`);
  };

  const handleDeleteFolder = (folderId: string) => {
    const target = deckFolders.find((f) => f.id === folderId);
    setDeckFolders((prev) => prev.filter((f) => f.id !== folderId));
    setDecks((prev) =>
      prev.map((d) =>
        d.folderId === folderId ? { ...d, folderId: undefined, category: undefined } : d
      )
    );
    if (target) {
      showToast(`Removed folder "${target.name}" (decks moved to Uncategorized)`);
    }
    if (currentUser) {
      void deleteCloudFolder(currentUser.uid, folderId).catch(() => {});
    }
  };

  const handleMoveDeckToFolder = (deckId: string, folderId?: string) => {
    const matchedFolder = folderId ? deckFolders.find((f) => f.id === folderId) : undefined;
    setDecks((prev) =>
      prev.map((d) =>
        d.id === deckId
          ? {
              ...d,
              folderId: matchedFolder?.id,
              category: matchedFolder?.name,
              updatedAt: new Date().toISOString().slice(0, 10),
            }
          : d
      )
    );
    const deck = decks.find((d) => d.id === deckId);
    if (deck) {
      showToast(
        matchedFolder
          ? `Moved "${deck.name}" to ${matchedFolder.name}`
          : `Moved "${deck.name}" to Uncategorized`
      );
    }
  };

  const handleChangeDeckFormat = (deckId: string, format: GameFormat) => {
    setDecks((prev) =>
      prev.map((d) =>
        d.id === deckId
          ? { ...d, format, updatedAt: new Date().toISOString().slice(0, 10) }
          : d
      )
    );
    showToast(`Switched deck format to ${format}`);
  };

  const handleRemoveIllegalCards = (deckId: string) => {
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== deckId) return deck;
        const cleaned = deck.entries
          .filter((entry) => {
            const card = cardsMap[entry.cardId];
            if (!card) return false;
            if (isTokenCard(card)) return false;
            if (deck.format === 'Standard' && !card.formats.includes('Standard')) {
              return false;
            }
            return true;
          })
          .map((entry) => {
            const card = cardsMap[entry.cardId];
            const maxCopies = getMaxCopies(card);
            return entry.quantity > maxCopies ? { ...entry, quantity: maxCopies } : entry;
          })
          .filter((entry) => entry.quantity > 0);
        return {
          ...deck,
          updatedAt: new Date().toISOString().slice(0, 10),
          entries: cleaned,
        };
      })
    );
    showToast('Removed banned/illegal cards and enforced restrictions');
  };

  const handleDeleteDeck = (deckId: string) => {
    const target = decks.find((d) => d.id === deckId);
    setDecks((prev) => {
      const filtered = prev.filter((d) => d.id !== deckId);
      if (activeDeckId === deckId) {
        setActiveDeckId(filtered[0]?.id || '');
      }
      return filtered;
    });
    if (target) {
      showToast(`Deleted "${target.name}"`);
    }
    if (currentUser) {
      void deleteCloudDeck(currentUser.uid, deckId).catch(() => {});
    }
  };

  const handleImportDeckEntries = ({
    mode,
    entries,
    newDeckName,
    newDeckFormat,
    newDeckArchetype,
    newDeckFolderId,
  }: {
    mode: 'replace' | 'merge' | 'new';
    entries: DeckEntry[];
    newDeckName?: string;
    newDeckFormat?: GameFormat;
    newDeckArchetype?: string;
    newDeckFolderId?: string;
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    if (mode === 'new' || !activeDeck) {
      const id = `deck-${Date.now()}`;
      const fmt: GameFormat = newDeckFormat || 'Eternal';
      const name = (newDeckName || '').trim() || `Imported ${fmt} Deck`;
      const matchedFolder = newDeckFolderId
        ? deckFolders.find((f) => f.id === newDeckFolderId)
        : undefined;
      const newDeck: Deck = {
        id,
        name,
        format: fmt,
        archetype: (newDeckArchetype || '').trim() || 'Imported List',
        ...(matchedFolder ? { folderId: matchedFolder.id, category: matchedFolder.name } : {}),
        updatedAt: today,
        entries,
      };
      setDecks((prev) => [newDeck, ...prev]);
      setActiveDeckId(id);
      const total = entries.reduce((s, e) => s + e.quantity, 0);
      showToast(`Imported ${total} cards into "${name}"`);
      return;
    }

    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== activeDeck.id) return deck;
        return {
          ...deck,
          updatedAt: today,
          entries,
        };
      })
    );
    const total = entries.reduce((s, e) => s + e.quantity, 0);
    showToast(
      mode === 'replace'
        ? `Replaced "${activeDeck.name}" with ${total} imported cards`
        : `Merged list into "${activeDeck.name}" (${total} cards total)`
    );
  };

  const sharedDeckResolution = useMemo(() => {
    if (!pendingSharedDeck) return null;
    const resolved: {
      payload: (typeof pendingSharedDeck.entries)[number];
      card?: BattleSpiritsCard;
    }[] = [];

    for (const item of pendingSharedDeck.entries) {
      const direct = item.cardId ? cardsMap[item.cardId] : undefined;
      let match = direct;
      if (!match && item.cardNumber) {
        const normNum = normalizeCardNumber(item.cardNumber);
        const compNum = compactCardNumber(item.cardNumber);
        match = allCardsList.find(
          (c) =>
            (normalizeCardNumber(c.cardNumber) === normNum ||
              compactCardNumber(c.cardNumber) === compNum) &&
            Boolean(c.isRevival) === Boolean(item.isRevival)
        ) ||
          allCardsList.find(
            (c) =>
              normalizeCardNumber(c.cardNumber) === normNum ||
              compactCardNumber(c.cardNumber) === compNum
          );
      }
      if (!match && item.name) {
        const normName = normalizeCardName(item.name);
        match = allCardsList.find((c) => normalizeCardName(c.name) === normName);
      }
      resolved.push({ payload: item, card: match });
    }

    const matchedItems = resolved.filter(
      (r): r is { payload: (typeof pendingSharedDeck.entries)[number]; card: BattleSpiritsCard } =>
        Boolean(r.card)
    );
    const unmatchedItems = resolved.filter((r) => !r.card);
    const totalSharedCount = pendingSharedDeck.entries.reduce((s, e) => s + e.quantity, 0);
    const totalMatchedCount = matchedItems.reduce((s, e) => s + e.payload.quantity, 0);

    return { resolved, matchedItems, unmatchedItems, totalSharedCount, totalMatchedCount };
  }, [pendingSharedDeck, cardsMap, allCardsList]);

  const handleConfirmSharedImport = (mode: 'new' | 'replace' | 'merge') => {
    if (!pendingSharedDeck || !sharedDeckResolution) return;
    const { entries, cappedCards } = buildImportedDeckEntries(
      sharedDeckResolution.matchedItems.map(({ card, payload }) => ({
        card,
        quantity: payload.quantity,
      })),
      activeDeck ? activeDeck.entries : [],
      mode
    );

    handleImportDeckEntries({
      mode,
      entries,
      newDeckName: pendingSharedDeck.name,
      newDeckFormat: pendingSharedDeck.format,
      newDeckArchetype: pendingSharedDeck.archetype || 'Shared Deck',
    });

    if (cappedCards.length > 0) {
      showToast(
        `Applied restriction limits to: ${cappedCards.slice(0, 3).join(', ')}${
          cappedCards.length > 3 ? ` +${cappedCards.length - 3} more` : ''
        }`
      );
    }

    setActiveTab('decks');
    setPendingSharedDeck(null);
  };

  const openSearchTab = () => {
    setActiveTab('search');
    setTimeout(() => searchInputRef.current?.focus(), 60);
  };

  const openSetInSearch = (setCode: string) => {
    const targetSet = indexedSetDirectory.byCode.get(setCode.toUpperCase());
    let nextFormat = filters.format;
    if (targetSet && !matchesFormatFilter(targetSet.formats, nextFormat)) {
      nextFormat = targetSet.formats.includes('Standard') ? 'Standard' : 'Eternal';
    }
    setFilters({ ...INITIAL_FILTERS, format: nextFormat, setCode });
    setActiveTab('search');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const openColorInSearch = (color: ColorFilter) => {
    setFilters((prev) => ({ ...INITIAL_FILTERS, format: prev.format, color }));
    setActiveTab('search');
  };

  const activeSetMeta = useMemo(() => {
    if (filters.setCode !== 'All') {
      return indexedSetDirectory.byCode.get(filters.setCode.toUpperCase());
    }
    if (filters.setQuery.trim()) {
      const intent = resolveSearchSetIntent(
        filters.setQuery,
        knownSetCodes,
        indexedSetDirectory.numericSetCodes
      );
      if (intent?.exactSetCode) {
        return setLookupByCode.get(intent.exactSetCode);
      }
    }
    return undefined;
  }, [filters.setCode, filters.setQuery, indexedSetDirectory, knownSetCodes, setLookupByCode]);

  const handleGoogleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      const user = await signInWithGoogle();
      if (user) {
        showToast(`Signed in as ${user.displayName || user.email || 'Player'} — Cloud Sync active`);
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        showToast('Google sign-in cancelled');
      } else {
        showToast('Could not complete Google sign-in — check popup permissions');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await signOutGoogle();
      showToast('Signed out from Google Cloud');
    } catch {
      showToast('Unable to sign out right now');
    }
  };

  const handleManualCloudSync = async () => {
    if (!currentUser || cloudSyncing) return;
    setCloudSyncing(true);
    try {
      await syncAllDecksAndFoldersToCloud(currentUser.uid, deckFolders, decks);
      showToast(`Saved ${decks.length} decks to Google Cloud`);
    } catch {
      showToast('Cloud sync failed — please retry');
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleUpdateOwnProfile = async (
    bio: string,
    favoriteColor: CardColor
  ): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      await updatePublicProfileBio(currentUser.uid, bio, favoriteColor);
      setLiveProfilesByUid((prev) => {
        const curr = prev[currentUser.uid] || {
          uid: currentUser.uid,
          displayName: currentUser.displayName || 'Player',
          photoURL: currentUser.photoURL || '',
          bio: '',
          favoriteColor: 'Red' as CardColor,
          followersCount: 0,
          isPublic: true,
        };
        return {
          ...prev,
          [currentUser.uid]: {
            ...curr,
            bio: bio.trim(),
            favoriteColor,
          },
        };
      });
      showToast('Updated player profile');
      return true;
    } catch {
      showToast('Could not update profile');
      return false;
    }
  };

  const navItems: {
    id: AppTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'catalog', label: 'Catalog', icon: Grid },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'decks', label: 'Decks', icon: Layers },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const centerNavItems = navItems.filter((item) => item.id !== 'settings');
  const ownProfile = currentUser ? liveProfilesByUid[currentUser.uid] : undefined;

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] text-[#111318]">
      {/* Compact Sticky Top Bar: 48px on mobile, 64px on desktop */}
      <header className="sticky top-0 z-30 h-12 lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto h-full px-3 sm:px-6 flex items-center justify-between gap-3 sm:gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className="font-display text-lg lg:text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            BattleSpirits
          </button>

          <nav className="hidden lg:flex items-center gap-6" aria-label="Primary Navigation">
            {centerNavItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => (item.id === 'search' ? openSearchTab() : setActiveTab(item.id))}
                  className={`py-2 text-sm font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                    active
                      ? 'text-slate-900 border-red-600'
                      : 'text-slate-500 border-transparent hover:text-slate-900'
                  }`}
                >
                  {item.id === 'search' && <Search className="w-3.5 h-3.5" />}
                  <span>{item.label}</span>
                  {item.id === 'decks' && (
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      ({decks.length})
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Most-Right Header Button: Settings (contains profile, Google sign-in/out, sync, offline DB, rules) */}
          <div className="flex items-center justify-end shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              aria-label="Settings, Profile, Account and Official Rules"
              className={`min-h-[36px] lg:min-h-[40px] px-3 sm:px-3.5 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
              }`}
            >
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'Account'}
                  referrerPolicy="no-referrer"
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : currentUser ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              ) : null}
              <Settings className="w-4 h-4 shrink-0" />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-24 lg:py-8">
        {activeTab === 'catalog' && (
          <CatalogMenuView
            productSets={syncedProductSets}
            cards={allCardsList}
            cardsById={cardsMap}
            activeDeckQtyMap={activeDeckQtyMap}
            activeFormat={filters.format}
            onChangeFormat={handleFormatSwitch}
            onOpenSetInSearch={openSetInSearch}
            onOpenColorInSearch={openColorInSearch}
            onOpenSearch={openSearchTab}
            onSelectCard={setSelectedCard}
            onAddToDeck={handleQuickAddToDeck}
          />
        )}

        {activeTab === 'search' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Desktop Inline Filter Sidebar (Fixed to Viewport with Independent Scroll) */}
            <aside className="hidden lg:flex lg:flex-col lg:col-span-3 sticky top-20 max-h-[calc(100vh-6rem)] bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0 bg-white">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm font-bold text-slate-900">Filters</h2>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setFilters(INITIAL_FILTERS)}
                      className="text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
                    >
                      Reset ({activeFilterCount})
                    </button>
                  )}
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {filteredCards.length} / {allCardsList.length}
                </span>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <FilterControls
                  filters={filters}
                  availableSets={availableSets}
                  availableKeywords={availableKeywords}
                  onChange={updateFilters}
                  onReset={() => setFilters(INITIAL_FILTERS)}
                />
              </div>
            </aside>

            {/* Card Search Feed */}
            <section className="lg:col-span-9 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                  <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                    {activeSetMeta
                      ? `${activeSetMeta.setCode}: ${activeSetMeta.name}`
                      : 'Find a Card'}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500">
                    {activeSetMeta
                      ? `${activeSetMeta.blockLabel} · ${activeSetMeta.releaseDate}`
                      : filters.format === 'Standard'
                      ? 'Standard Format: 26RBS, 26RSD, RP26, PX26 & Standard Tokens.'
                      : filters.format === 'Eternal'
                      ? 'Eternal Era: BS01–BS77, SD01–SD70, CB01–CB34, CBX01, BSC01–BSC51, PB01–PB50, PC01–PC12 & Promos.'
                      : 'Search offline English cards across BS01–BS77, Collab, Supplementary, PB, PC, SD, 26R Standard, Tokens, and Promos.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
                  <div
                    role="group"
                    aria-label="Filter search by card version"
                    className="inline-flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl"
                  >
                    {(
                      [
                        { id: 'All', label: 'All' },
                        { id: 'Original', label: 'Non-Revival' },
                        { id: 'Revival', label: 'Revival' },
                      ] as const
                    ).map((ver) => (
                      <button
                        key={ver.id}
                        type="button"
                        onClick={() => updateFilters({ ...filters, version: ver.id })}
                        className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          filters.version === ver.id
                            ? ver.id === 'Revival'
                              ? 'bg-emerald-700 text-white shadow-sm'
                              : 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {ver.label}
                      </button>
                    ))}
                  </div>

                  <div
                    role="group"
                    aria-label="Filter search by format"
                    className="inline-flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl"
                  >
                    {(['All', 'Standard', 'Eternal'] as FormatFilter[]).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => handleFormatSwitch(fmt)}
                        className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          filters.format === fmt
                            ? fmt === 'Standard'
                              ? 'bg-sky-700 text-white shadow-sm'
                              : fmt === 'Eternal'
                              ? 'bg-amber-700 text-white shadow-sm'
                              : 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="search-header-sort" className="sr-only">
                      Sort cards
                    </label>
                    <select
                      id="search-header-sort"
                      aria-label="Sort cards"
                      value={filters.sortBy}
                      onChange={(e) =>
                        updateFilters({
                          ...filters,
                          sortBy: e.target.value as SortOption,
                        })
                      }
                      className="min-h-[38px] px-2.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-600 cursor-pointer"
                    >
                      <option value="number">Sort: Set &amp; Number</option>
                      <option value="newest">Sort: Newest Release</option>
                      <option value="rarity-desc">Sort: Highest Rarity</option>
                      <option value="color">Sort: Color</option>
                      <option value="cost-asc">Sort: Cost (Low–High)</option>
                      <option value="cost-desc">Sort: Cost (High–Low)</option>
                      <option value="bp-desc">Sort: Highest BP</option>
                      <option value="name">Sort: Name (A–Z)</option>
                    </select>
                    <div className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                      {filteredCards.length} cards
                    </div>
                  </div>
                </div>
              </div>

              {/* Offline Search Inputs (Card Search + Focused Set Code / Name Input) + Mobile Filter Trigger */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    placeholder="Search card name, family, keyword, or English effect..."
                    className="w-full min-h-[44px] pl-10 pr-9 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                  {filters.search && (
                    <button
                      type="button"
                      onClick={() => setFilters({ ...filters, search: '' })}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 sm:w-64 lg:w-72 shrink-0">
                  <div className="relative flex-1 min-w-0">
                    <Layers className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={filters.setQuery}
                      onChange={(e) => setFilters({ ...filters, setQuery: e.target.value })}
                      placeholder="Set code or name (BS75, 43)..."
                      aria-label="Filter by set code or set name"
                      className="w-full min-h-[44px] pl-9 pr-9 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                    {filters.setQuery && (
                      <button
                        type="button"
                        onClick={() => setFilters({ ...filters, setQuery: '' })}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        aria-label="Clear set filter"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setFilterSheetOpen(true)}
                    className="lg:hidden min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-2 shrink-0 hover:bg-slate-50 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>Filter</span>
                    {activeFilterCount > 0 && (
                      <span className="font-mono text-red-700 tabular-nums">
                        ({activeFilterCount})
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Thumb-Friendly Horizontal Attribute Bar */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  onClick={() => setFilters({ ...filters, color: 'All' })}
                  className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filters.color === 'All'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  All Colors
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFilters({
                      ...filters,
                      color: filters.color === 'Multicolor' ? 'All' : 'Multicolor',
                    })
                  }
                  className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                    filters.color === 'Multicolor'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="inline-flex items-center -space-x-1">
                    <SymbolIcon color="Red" size="xs" variant="gem" />
                    <SymbolIcon color="Blue" size="xs" variant="gem" />
                  </span>
                  <span>Multi-Color</span>
                </button>
                {ALL_COLORS.map((color) => {
                  const active = filters.color === color;
                  const meta = COLOR_META[color];
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() =>
                        setFilters({ ...filters, color: active ? 'All' : color })
                      }
                      className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <SymbolIcon color={color} size="xs" variant="gem" />
                      <span className={active ? 'text-white' : meta.text}>{color}</span>
                    </button>
                  );
                })}
              </div>

              {/* Local Database Loading / Responsive Card Grid */}
              {loadingCardsJson && allCardsList.length <= BATTLE_SPIRITS_CARDS.length ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center justify-center gap-3 text-sm text-slate-600">
                  <Loader2 className="w-5 h-5 animate-spin text-red-600" />
                  <span>Loading local offline English card database (/cards.json)...</span>
                </div>
              ) : filteredCards.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
                  <p className="text-sm text-slate-600">
                    {filters.search.trim() || filters.setQuery.trim()
                      ? `No cards in the offline database matched "${[filters.search.trim(), filters.setQuery.trim()].filter(Boolean).join(' · ')}".`
                      : 'No Battle Spirits cards match your current filters.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setFilters(INITIAL_FILTERS)}
                      className="min-h-[44px] px-5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                  {filteredCards.map((card, idx) => (
                    <CardThumbnail
                      key={card.id}
                      card={card}
                      deckQty={activeDeckQtyMap[card.id] || 0}
                      onSelect={setSelectedCard}
                      onAddToDeck={handleQuickAddToDeck}
                      onHoverOrFocus={() => setSearchAnchorIndex(idx)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'decks' && (
          <ErrorBoundary
            fallbackTitle="Unable to render Deck Builder"
            resetLabel="Reset Deck View"
            onReset={() => setActiveTab('catalog')}
          >
            <DeckBuilderView
              decks={decks}
              folders={deckFolders}
              activeDeckId={activeDeck?.id || ''}
              cardsById={cardsMap}
              onSelectDeck={setActiveDeckId}
              onCreateDeck={handleCreateDeck}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveDeckToFolder={handleMoveDeckToFolder}
              onChangeDeckFormat={handleChangeDeckFormat}
              onRemoveIllegalCards={handleRemoveIllegalCards}
              onDeleteDeck={handleDeleteDeck}
              onUpdateCardQty={handleUpdateDeckQty}
              onImportDeckEntries={handleImportDeckEntries}
              onInspectCard={setSelectedCard}
              onBrowseCatalog={openSearchTab}
              cloudUserEmail={currentUser?.email || null}
              cloudSyncing={cloudSyncing}
              onSignInGoogle={() => void handleGoogleSignIn()}
              onSyncNow={() => void handleManualCloudSync()}
              onNotify={showToast}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'settings' && (
          <ErrorBoundary
            fallbackTitle="Unable to render Settings"
            resetLabel="Return to Catalog"
            onReset={() => setActiveTab('catalog')}
          >
            <SettingsView
              currentUser={currentUser}
              authReady={authReady}
              signingIn={signingIn}
              cloudSyncing={cloudSyncing}
              deckCount={decks.length}
              folderCount={deckFolders.length}
              initialBio={ownProfile?.bio || ''}
              initialFavoriteColor={ownProfile?.favoriteColor || 'Red'}
              onSignInGoogle={() => void handleGoogleSignIn()}
              onSignOutGoogle={() => void handleGoogleSignOut()}
              onSyncNow={() => void handleManualCloudSync()}
              onSaveProfile={handleUpdateOwnProfile}
              onCatalogImported={applyImportedCatalogAdditions}
              onNotify={showToast}
            />
          </ErrorBoundary>
        )}
      </main>

      {/* Offline Status Banner */}
      <OfflineIndicator />

      {/* Inline Toast Feedback */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-16 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow-lg whitespace-nowrap max-w-[90vw] truncate"
        >
          {toastMsg}
        </div>
      )}

      {/* Mobile Fixed Bottom Tab Bar: 52px + safe area */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-4 h-[52px]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => (item.id === 'search' ? openSearchTab() : setActiveTab(item.id))}
                className={`flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                  active ? 'text-red-600' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Shared Deck Import Prompt Modal (?share=...) */}
      {pendingSharedDeck && sharedDeckResolution && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shared-deck-import-title"
          onClick={() => setPendingSharedDeck(null)}
        >
          <div
            className="w-full sm:max-w-lg max-h-[88vh] bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sm:hidden pt-3 pb-1 flex justify-center shrink-0">
              <div className="w-10 h-1.5 bg-slate-300 rounded-full" />
            </div>

            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 mb-1">
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Shared Battle Spirits Deck Link</span>
                </div>
                <h2
                  id="shared-deck-import-title"
                  className="font-display text-lg font-bold text-slate-900 truncate"
                >
                  Import &ldquo;{pendingSharedDeck.name}&rdquo;?
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {pendingSharedDeck.format} Format · {pendingSharedDeck.archetype} ·{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {sharedDeckResolution.totalMatchedCount}/{sharedDeckResolution.totalSharedCount} cards ready
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingSharedDeck(null)}
                className="min-h-[40px] min-w-[40px] rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Dismiss shared deck prompt"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {sharedDeckResolution.unmatchedItems.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-950">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    {sharedDeckResolution.unmatchedItems.length} shared card
                    {sharedDeckResolution.unmatchedItems.length === 1 ? '' : 's'} could not be matched automatically.
                  </span>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {sharedDeckResolution.resolved.map(({ payload, card }, idx) => {
                  const maxC = card ? getMaxCardCopies(card) : 3;
                  return (
                    <div
                      key={`${payload.cardId}-${payload.cardNumber}-${idx}`}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        {card ? (
                          <SymbolIcon color={card.color} size="xs" variant="gem" />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full bg-slate-200 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">
                            {card?.name || payload.name}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {card?.cardNumber || payload.cardNumber}
                            {card && isTokenCard(card) ? (
                              <span className="ml-1.5 text-slate-600 font-sans font-semibold">
                                Token (Outside Deck)
                              </span>
                            ) : card && maxC === 0 ? (
                              <span className="ml-1.5 text-red-700 font-sans font-semibold inline-flex items-center gap-0.5">
                                <Ban className="w-3 h-3" /> Banned
                              </span>
                            ) : null}
                            {card && !isTokenCard(card) && maxC > 0 && card.restriction && card.restriction !== 'Unlimited' && (
                              <span className="ml-1.5 text-red-700 font-sans font-semibold">
                                {card.restriction}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-slate-900 tabular-nums shrink-0">
                        ×{payload.quantity}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-5 py-3.5 pb-safe border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPendingSharedDeck(null)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Dismiss
              </button>
              {activeDeck && (
                <>
                  <button
                    type="button"
                    disabled={sharedDeckResolution.matchedItems.length === 0}
                    onClick={() => handleConfirmSharedImport('merge')}
                    className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-45 text-xs font-semibold cursor-pointer"
                  >
                    Merge Into Active
                  </button>
                  <button
                    type="button"
                    disabled={sharedDeckResolution.matchedItems.length === 0}
                    onClick={() => handleConfirmSharedImport('replace')}
                    className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-45 text-xs font-semibold cursor-pointer"
                  >
                    Replace Active
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={sharedDeckResolution.matchedItems.length === 0}
                onClick={() => handleConfirmSharedImport('new')}
                className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-45 text-xs font-semibold cursor-pointer"
              >
                Import as New Deck
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Filter Bottom Sheet */}
      <FilterSheet
        open={filterSheetOpen}
        resultCount={filteredCards.length}
        filters={filters}
        availableSets={availableSets}
        availableKeywords={availableKeywords}
        onChange={updateFilters}
        onReset={() => setFilters(INITIAL_FILTERS)}
        onClose={() => setFilterSheetOpen(false)}
      />

      {/* Card Detail Bottom Sheet / Modal */}
      <CardDetailSheet
        card={selectedCard}
        allCards={allCardsList}
        navigableCards={navigableCards}
        deckQty={selectedCard ? activeDeckQtyMap[selectedCard.id] || 0 : 0}
        activeDeckQtyMap={activeDeckQtyMap}
        activeDeckName={activeDeck?.name || 'Deck'}
        activeDeckFormat={activeDeckFormat}
        onClose={() => setSelectedCard(null)}
        onSelectCard={setSelectedCard}
        onUpdateDeckQty={handleUpdateDeckQty}
      />
    </div>
  );
}
