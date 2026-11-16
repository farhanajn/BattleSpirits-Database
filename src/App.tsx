import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  BookOpen,
  Layers,
  Grid,
  X,
  Loader2,
  Globe,
  Share2,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { BATTLE_SPIRITS_CARDS, PRESET_DECKS, PRODUCT_SETS } from './data/cards';
import { ALL_COLORS, COLOR_META } from './data/theme';
import {
  BattleSpiritsCard,
  CardColor,
  CardRarity,
  CardType,
  ColorFilter,
  Deck,
  DeckEntry,
  FilterState,
  FormatFilter,
  GameFormat,
  ProductSet,
} from './types/card';
import { SymbolIcon } from './components/SymbolIcon';
import { CardThumbnail } from './components/CardThumbnail';
import { CardDetailSheet } from './components/CardDetailSheet';
import { FilterControls, FilterSheet } from './components/FilterSheet';
import { DeckBuilderView } from './components/DeckBuilderView';
import { RulingsView } from './components/RulingsView';
import { CatalogMenuView } from './components/CatalogMenuView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getMaxCardCopies, isTokenCard } from './utils/cardRules';
import { decodeSharedDeck, SharedDeckPayload } from './utils/deckShare';
import {
  buildImportedDeckEntries,
  compactCardNumber,
  extractSetCodeFromCardNumber,
  normalizeCardName,
  normalizeCardNumber,
} from './utils/decklistImport';

type AppTab = 'catalog' | 'search' | 'decks' | 'rules';

type CardRestrictionValue = NonNullable<BattleSpiritsCard['restriction']>;

interface BanListSnapshot {
  effectiveDate?: string;
  byCardNumber: Record<string, CardRestrictionValue>;
  byName: Record<string, CardRestrictionValue>;
}

const INITIAL_FILTERS: FilterState = {
  search: '',
  format: 'All',
  version: 'All',
  color: 'All',
  type: 'All',
  rarity: 'All',
  setCode: 'All',
  costBracket: 'All',
  keyword: 'All',
  sortBy: 'number',
};

const VALID_TABS: AppTab[] = ['catalog', 'search', 'decks', 'rules'];
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
const VALID_TYPES: (CardType | 'All')[] = [
  'All',
  'Spirit',
  'Ultimate',
  'Brave',
  'Nexus',
  'Magic',
];
const VALID_RARITIES: (CardRarity | 'All')[] = [
  'All',
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
const VALID_SORTS: FilterState['sortBy'][] = [
  'number',
  'cost-asc',
  'cost-desc',
  'bp-desc',
  'name',
];

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

  const rawTab = params.get('tab') as AppTab | null;
  const tab: AppTab =
    rawTab && VALID_TABS.includes(rawTab)
      ? rawTab
      : sharedDeck
      ? 'decks'
      : 'catalog';

  const rawFmt = params.get('fmt') as FormatFilter | null;
  const rawVer = params.get('ver') as FilterState['version'] | null;
  const rawColor = params.get('color') as ColorFilter | null;
  const rawType = params.get('type') as (CardType | 'All') | null;
  const rawRarity = params.get('rarity') as (CardRarity | 'All') | null;
  const rawCost = params.get('cost') as FilterState['costBracket'] | null;
  const rawSort = params.get('sort') as FilterState['sortBy'] | null;

  return {
    tab,
    sharedDeck,
    filters: {
      search: params.get('q') || '',
      format: rawFmt && VALID_FORMATS.includes(rawFmt) ? rawFmt : 'All',
      version: rawVer && VALID_VERSIONS.includes(rawVer) ? rawVer : 'All',
      color: rawColor && VALID_COLORS.includes(rawColor) ? rawColor : 'All',
      type: rawType && VALID_TYPES.includes(rawType) ? rawType : 'All',
      rarity: rawRarity && VALID_RARITIES.includes(rawRarity) ? rawRarity : 'All',
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
  if (filters.type !== 'All') params.set('type', filters.type);
  if (filters.rarity !== 'All') params.set('rarity', filters.rarity);
  if (filters.setCode !== 'All') params.set('set', filters.setCode);
  if (filters.costBracket !== 'All') params.set('cost', filters.costBracket);
  if (filters.keyword !== 'All') params.set('kw', filters.keyword);
  if (filters.sortBy !== 'number') params.set('sort', filters.sortBy);
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

function mergeCardsIntoMap(
  prev: Record<string, BattleSpiritsCard>,
  incomingCards: BattleSpiritsCard[],
  options?: {
    banList?: BanListSnapshot | null;
    forceRevival?: boolean;
    forceToken?: boolean;
  }
): { next: Record<string, BattleSpiritsCard>; addedCount: number } {
  const next = { ...prev };
  const keyToId = new Map<string, string>();

  const indexCard = (c: BattleSpiritsCard) => {
    const ver = c.isRevival ? 'rv' : 'orig';
    const normNum = normalizeCardNumber(c.cardNumber || '');
    if (normNum && normNum !== 'WIKI') {
      const nk = `num:${normNum}|${ver}`;
      if (!keyToId.has(nk)) keyToId.set(nk, c.id);
    }
    const cleanName = normalizeCardName(c.name || '').replace(/\s*\(revival\)\s*$/i, '');
    if (cleanName) {
      const nmKey = `name:${cleanName}|${ver}`;
      if (!keyToId.has(nmKey)) keyToId.set(nmKey, c.id);
    }
    if (!c.isRevival && c.wikiTitle) {
      const wkKey = `wiki:${c.wikiTitle.trim().toLowerCase()}|orig`;
      if (!keyToId.has(wkKey)) keyToId.set(wkKey, c.id);
    }
  };

  for (const b of BATTLE_SPIRITS_CARDS) indexCard(b);
  for (const existing of Object.values(next)) indexCard(existing);

  let addedCount = 0;

  for (const rawCard of incomingCards) {
    const c = sanitizeCardTextTemplates(rawCard);
    const isRev = options?.forceRevival ?? Boolean(c.isRevival);
    const ver = isRev ? 'rv' : 'orig';
    const normNum = normalizeCardNumber(c.cardNumber || '');
    const cleanName = normalizeCardName(c.name || '').replace(/\s*\(revival\)\s*$/i, '');

    let targetId = next[c.id] ? c.id : undefined;
    if (!targetId && normNum && normNum !== 'WIKI') {
      targetId = keyToId.get(`num:${normNum}|${ver}`);
    }
    if (!targetId && !isRev && c.wikiTitle) {
      targetId = keyToId.get(`wiki:${c.wikiTitle.trim().toLowerCase()}|orig`);
    }
    if (!targetId && !isRev && cleanName) {
      targetId = keyToId.get(`name:${cleanName}|orig`);
    }
    if (!targetId) targetId = c.id;

    const existing = next[targetId];
    if (!existing) addedCount++;

    const merged: BattleSpiritsCard = {
      ...(existing || {}),
      ...c,
      id: targetId,
      name: c.name || existing?.name || c.cardNumber || targetId,
      jpName: c.jpName || existing?.jpName || '',
      cardNumber: c.cardNumber || existing?.cardNumber || 'WIKI',
      setCode: c.setCode || existing?.setCode || 'BS01',
      setName: c.setName || existing?.setName || 'Battle Spirits',
      color: c.color && COLOR_META[c.color] ? c.color : existing?.color || 'Red',
      cost: Number.isFinite(Number(c.cost)) ? Number(c.cost) : existing?.cost ?? 0,
      rarity: c.rarity || existing?.rarity || 'C',
      formats:
        Array.isArray(c.formats) && c.formats.length > 0
          ? c.formats
          : Array.isArray(existing?.formats) && existing.formats.length > 0
          ? existing.formats
          : ['Eternal'],
      type: c.type || existing?.type || 'Spirit',
      subtypeLabel: c.subtypeLabel ?? existing?.subtypeLabel,
      isRevival: isRev,
      isToken: options?.forceToken ?? c.isToken ?? existing?.isToken,
      colors: c.colors && c.colors.length > 0 ? c.colors : existing?.colors,
      families: c.families && c.families.length > 0 ? c.families : existing?.families || [],
      levels: c.levels && c.levels.length > 0 ? c.levels : existing?.levels,
      braveCondition: c.braveCondition ?? existing?.braveCondition,
      braveBonusBp: c.braveBonusBp ?? existing?.braveBonusBp,
      summonCondition: c.summonCondition ?? existing?.summonCondition,
      symbols:
        c.symbols && Object.keys(c.symbols).length > 0
          ? c.symbols
          : existing?.symbols || {},
      reduction:
        c.reduction && Object.keys(c.reduction).length > 0
          ? c.reduction
          : existing?.reduction || {},
      effects: c.effects && c.effects.length > 0 ? c.effects : existing?.effects || [],
      keywords: c.keywords && c.keywords.length > 0 ? c.keywords : existing?.keywords || [],
      flavorText: c.flavorText || existing?.flavorText || '',
      illustrator: c.illustrator || existing?.illustrator || '',
      artworkImage: c.artworkImage || existing?.artworkImage || '',
      galleryImages:
        c.galleryImages && c.galleryImages.length > 0
          ? c.galleryImages
          : existing?.galleryImages,
      rulings: c.rulings && c.rulings.length > 0 ? c.rulings : existing?.rulings || [],
      wikiTitle: c.wikiTitle || existing?.wikiTitle,
      isWikiLoaded: Boolean(c.isWikiLoaded || existing?.isWikiLoaded),
    };

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
  const [syncingSharedCards, setSyncingSharedCards] = useState(false);
  const [banList, setBanList] = useState<BanListSnapshot | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<BattleSpiritsCard | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [productSets, setProductSets] = useState<ProductSet[]>(PRODUCT_SETS);
  const [loadedSetCodes, setLoadedSetCodes] = useState<Record<string, boolean>>({});
  const [loadingSetCode, setLoadingSetCode] = useState<string | null>(null);
  const [searchingWiki, setSearchingWiki] = useState(false);
  const [setErrorMsg, setSetErrorMsg] = useState<string | null>(null);

  const [cardsMap, setCardsMap] = useState<Record<string, BattleSpiritsCard>>(() => {
    const initial: Record<string, BattleSpiritsCard> = {};
    for (const c of BATTLE_SPIRITS_CARDS) {
      initial[c.id] = c;
    }
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

  // Fetch full wiki directory (BS01-BS77, SD01-SD70, 26R Standard, Promos) on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wiki/directory')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.sets)) return;
        const curatedByCode = new Map(PRODUCT_SETS.map((s) => [s.setCode.toUpperCase(), s]));
        const merged = (data.sets as ProductSet[]).map((wikiSet) => {
          const curated = curatedByCode.get(wikiSet.setCode.toUpperCase());
          if (!curated) return wikiSet;
          const isWikiGeneric = /^(?:Booster Set |Starter \/ Mega Deck |Standard (?:Booster|Entry) )/i.test(
            wikiSet.name
          );
          return {
            ...wikiSet,
            name: !isWikiGeneric && wikiSet.name ? wikiSet.name : curated.name,
            jpName: curated.jpName || wikiSet.jpName,
            releaseDate: curated.releaseDate || wikiSet.releaseDate,
            tagline: curated.tagline || wikiSet.tagline,
            featuredCardId: curated.featuredCardId || wikiSet.featuredCardId,
            colors: curated.colors.length > 0 ? curated.colors : wikiSet.colors,
            totalCardsInSet: curated.totalCardsInSet || wikiSet.totalCardsInSet,
          };
        });
        const seenCodes = new Set(merged.map((s) => s.setCode.toUpperCase()));
        for (const c of PRODUCT_SETS) {
          if (!seenCodes.has(c.setCode.toUpperCase())) {
            merged.push(c);
          }
        }
        setProductSets(merged);
      })
      .catch(() => {
        // fallback cleanly to initial PRODUCT_SETS
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch official Banned & Restricted list from Wiki and apply copy limits across all loaded cards
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wiki/banlist')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BanListSnapshot | null) => {
        if (cancelled || !data || !data.byCardNumber) return;
        setBanList(data);
        setCardsMap((prev) => {
          const next = { ...prev };
          for (const [id, card] of Object.entries(next)) {
            const updatedRestriction = resolveBanRestriction(card, data);
            if (updatedRestriction !== (card.restriction || 'Unlimited')) {
              next[id] = { ...card, restriction: updatedRestriction };
            }
          }
          return next;
        });
      })
      .catch(() => {
        // keep default restrictions gracefully if offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate bundled featured cards on startup so every bundled card gets real Wiki alt-art galleries & cleaned fields
  useEffect(() => {
    const toHydrate = BATTLE_SPIRITS_CARDS.filter((c) => c.wikiTitle && !c.isWikiLoaded);
    if (toHydrate.length === 0) return;

    let cancelled = false;
    fetch('/api/wiki/hydrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: toHydrate }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.cards)) return;
        setCardsMap(
          (prev) =>
            mergeCardsIntoMap(prev, data.cards as BattleSpiritsCard[], { banList }).next
        );
      })
      .catch(() => {
        // keep bundled fallback cleanly if offline
      });

    return () => {
      cancelled = true;
    };
  }, [banList]);

  // Automatically sync all official Wiki Token cards so Platinum Bug, Rig Avatar Dragon, Swordish, Fungal Bed, etc. appear in Search
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wiki/sets/TOKENS?hydrate=100')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.cards)) return;
        setCardsMap(
          (prev) =>
            mergeCardsIntoMap(prev, data.cards as BattleSpiritsCard[], {
              banList,
              forceToken: true,
            }).next
        );
      })
      .catch(() => {
        // keep bundled tokens cleanly if offline
      });
    return () => {
      cancelled = true;
    };
  }, [banList]);

  // Automatically sync official Wiki Revival cards (Category:Revival Cards + Revival tabber cards) so the Revival section is richly populated
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wiki/sets/REVIVAL?hydrate=800')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.cards)) return;
        setCardsMap(
          (prev) =>
            mergeCardsIntoMap(prev, data.cards as BattleSpiritsCard[], {
              banList,
              forceRevival: true,
            }).next
        );
      })
      .catch(() => {
        // keep bundled Revival cards cleanly if offline
      });
    return () => {
      cancelled = true;
    };
  }, [banList]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DECKS_KEY, JSON.stringify(decks));
    } catch {
      // ignore
    }
  }, [decks]);

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

  // Persist any non-bundled wiki cards used in saved decks so deck rosters survive reloads
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
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2400);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const allCardsList = useMemo(() => Object.values(cardsMap), [cardsMap]);

  const availableSets = useMemo(() => {
    return productSets
      .filter((s) => matchesFormatFilter(s.formats, filters.format))
      .map((s) => ({ setCode: s.setCode, name: s.name }));
  }, [productSets, filters.format]);

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

  const loadWikiSet = useCallback(
    async (setCode: string) => {
      if (!setCode || setCode === 'All') return;
      const upper = setCode.toUpperCase();
      if (loadedSetCodes[upper]) return;

      setLoadingSetCode(upper);
      setSetErrorMsg(null);
      try {
        const res = await fetch(`/api/wiki/sets/${encodeURIComponent(upper)}?hydrate=450`);
        if (!res.ok) {
          throw new Error(`Could not fetch ${upper} from Battle Spirits Wiki`);
        }
        const data = (await res.json()) as {
          set?: ProductSet;
          cards?: BattleSpiritsCard[];
        };

        if (data.set) {
          setProductSets((prev) =>
            prev.map((s) =>
              s.setCode.toUpperCase() === upper ? { ...s, ...data.set } : s
            )
          );
        }

        if (Array.isArray(data.cards) && data.cards.length > 0) {
          setCardsMap(
            (prev) => mergeCardsIntoMap(prev, data.cards!, { banList }).next
          );
        }

        setLoadedSetCodes((prev) => ({ ...prev, [upper]: true }));
      } catch (err) {
        setSetErrorMsg(
          err instanceof Error
            ? err.message
            : `Failed to fetch ${upper} from Battle Spirits Wiki`
        );
      } finally {
        setLoadingSetCode((prev) => (prev === upper ? null : prev));
      }
    },
    [loadedSetCodes, banList]
  );

  // Automatically fetch a set whenever filters.setCode is set to a specific set
  useEffect(() => {
    if (filters.setCode !== 'All') {
      loadWikiSet(filters.setCode);
    }
  }, [filters.setCode, loadWikiSet]);

  const updateFilters = useCallback(
    (next: FilterState) => {
      if (next.format !== filters.format) {
        let resolvedSetCode = next.setCode;
        if (resolvedSetCode !== 'All') {
          const matchedSet = productSets.find(
            (s) => s.setCode.toUpperCase() === resolvedSetCode.toUpperCase()
          );
          if (!matchedSet || !matchesFormatFilter(matchedSet.formats, next.format)) {
            resolvedSetCode = 'All';
          }
        }
        next = { ...next, setCode: resolvedSetCode };

        if (next.format === 'Standard') {
          loadWikiSet('26RBS01');
        } else if (next.format === 'Eternal') {
          loadWikiSet('BS77');
        }
      }
      setFilters(next);
    },
    [filters.format, productSets, loadWikiSet]
  );

  const handleFormatSwitch = useCallback(
    (format: FormatFilter) => {
      updateFilters({ ...filters, format });
    },
    [filters, updateFilters]
  );

  const handleWikiSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = filters.search.trim();
    if (!q) return;

    setSearchingWiki(true);
    try {
      const params = new URLSearchParams({
        q,
        format: filters.format,
      });
      const res = await fetch(`/api/wiki/search?${params.toString()}`);
      if (!res.ok) throw new Error('Wiki search failed');
      const data = (await res.json()) as { cards?: BattleSpiritsCard[] };
      if (Array.isArray(data.cards) && data.cards.length > 0) {
        setCardsMap(
          (prev) => mergeCardsIntoMap(prev, data.cards!, { banList }).next
        );
        showToast(`Synced ${data.cards.length} matching cards from Wiki`);
      } else {
        showToast(`No additional Wiki card pages matched "${q}"`);
      }
    } catch {
      showToast('Unable to reach Battle Spirits Wiki search right now');
    } finally {
      setSearchingWiki(false);
    }
  };

  const handleCardHydrated = useCallback(
    (hydrated: BattleSpiritsCard) => {
      const clean = {
        ...sanitizeCardTextTemplates(hydrated),
        restriction: banList
          ? resolveBanRestriction(hydrated, banList)
          : hydrated.restriction,
      };
      setCardsMap((prev) => ({
        ...prev,
        [clean.id]: clean,
      }));
      setSelectedCard((curr) => (curr && curr.id === clean.id ? clean : curr));
    },
    [banList]
  );

  const filteredCards = useMemo(() => {
    const q = filters.search.trim().toLowerCase();

    const list = allCardsList.filter((card) => {
      if (card.setCode.toUpperCase() === 'BSS01') return false;
      if (!matchesFormatFilter(card.formats, filters.format)) return false;
      if (filters.version === 'Original' && card.isRevival) return false;
      if (filters.version === 'Revival' && !card.isRevival) return false;

      if (filters.setCode !== 'All') {
        if (filters.setCode.toUpperCase() === 'TOKENS') {
          if (!card.isToken) return false;
        } else if (filters.setCode.toUpperCase() === 'REVIVAL') {
          if (!card.isRevival) return false;
        } else if (card.setCode.toUpperCase() !== filters.setCode.toUpperCase()) {
          return false;
        }
      }

      if (q) {
        const hay = `${card.name} ${card.jpName} ${card.cardNumber} ${card.subtypeLabel || ''} ${card.isToken ? 'token' : ''} ${card.isRevival ? 'revival' : ''} ${card.families.join(' ')} ${card.effects.map((e) => e.text).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      const cardColors = getCardColors(card);
      if (filters.color === 'Multicolor') {
        if (cardColors.length < 2) return false;
      } else if (filters.color !== 'All') {
        // Exclude multi-color cards from single-color search
        if (cardColors.length !== 1 || cardColors[0] !== filters.color) return false;
      }

      if (filters.type !== 'All' && card.type !== filters.type) return false;
      if (filters.rarity !== 'All' && card.rarity !== filters.rarity) return false;
      if (filters.keyword !== 'All' && !card.keywords.includes(filters.keyword)) return false;

      if (filters.costBracket === '0-2' && card.cost > 2) return false;
      if (filters.costBracket === '3-4' && (card.cost < 3 || card.cost > 4)) return false;
      if (filters.costBracket === '5-6' && (card.cost < 5 || card.cost > 6)) return false;
      if (filters.costBracket === '7+' && card.cost < 7) return false;

      return true;
    });

    // Deduplicate non-Revival cards so duplicate IDs from set tables vs Wiki search never appear together
    const seenOrigNums = new Set<string>();
    const seenOrigNames = new Set<string>();
    const dedupedList = list.filter((card) => {
      if (card.isRevival) return true;
      const numKey = normalizeCardNumber(card.cardNumber || '');
      const nameKey = normalizeCardName(card.name || '');
      if (numKey && numKey !== 'WIKI') {
        if (seenOrigNums.has(numKey)) return false;
        seenOrigNums.add(numKey);
      }
      if (nameKey) {
        if (seenOrigNames.has(nameKey)) return false;
        seenOrigNames.add(nameKey);
      }
      return true;
    });

    const getMaxBp = (c: BattleSpiritsCard) =>
      c.levels && c.levels.length > 0 ? c.levels[c.levels.length - 1].bp : 0;

    dedupedList.sort((a, b) => {
      if (filters.sortBy === 'cost-asc') return a.cost - b.cost || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'cost-desc') return b.cost - a.cost || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'bp-desc') return getMaxBp(b) - getMaxBp(a) || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'name') return a.name.localeCompare(b.name);
      return a.cardNumber.localeCompare(b.cardNumber);
    });

    return dedupedList;
  }, [allCardsList, filters]);

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
    if (filters.type !== 'All') count++;
    if (filters.rarity !== 'All') count++;
    if (filters.setCode !== 'All') count++;
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

  const handleCreateDeck = (name: string, format: GameFormat, archetype: string) => {
    const id = `deck-${Date.now()}`;
    const newDeck: Deck = {
      id,
      name,
      format,
      archetype,
      updatedAt: new Date().toISOString().slice(0, 10),
      entries: [],
    };
    setDecks((prev) => [newDeck, ...prev]);
    setActiveDeckId(id);
    showToast(`Created ${format} deck "${name}"`);
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
  };

  const handleImportDeckEntries = ({
    mode,
    entries,
    newDeckName,
    newDeckFormat,
    newDeckArchetype,
  }: {
    mode: 'replace' | 'merge' | 'new';
    entries: DeckEntry[];
    newDeckName?: string;
    newDeckFormat?: GameFormat;
    newDeckArchetype?: string;
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    if (mode === 'new' || !activeDeck) {
      const id = `deck-${Date.now()}`;
      const fmt: GameFormat = newDeckFormat || 'Eternal';
      const name = (newDeckName || '').trim() || `Imported ${fmt} Deck`;
      const newDeck: Deck = {
        id,
        name,
        format: fmt,
        archetype: (newDeckArchetype || '').trim() || 'Imported List',
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

  const handleSyncMissingImportCards = async ({
    setCodes,
    queries,
  }: {
    setCodes: string[];
    queries: string[];
  }): Promise<number> => {
    let addedCount = 0;
    const knownSetCodes = new Set(productSets.map((s) => s.setCode.toUpperCase()));
    const setsToFetch = Array.from(
      new Set(setCodes.map((s) => s.toUpperCase()).filter((s) => knownSetCodes.has(s)))
    ).slice(0, 5);

    if (setsToFetch.length > 0) {
      await Promise.all(setsToFetch.map((code) => loadWikiSet(code)));
    }

    const uniqueQueries = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean))).slice(
      0,
      6
    );
    if (uniqueQueries.length > 0) {
      const responses = await Promise.all(
        uniqueQueries.map(async (q) => {
          try {
            const res = await fetch(`/api/wiki/search?q=${encodeURIComponent(q)}&format=All`);
            if (!res.ok) return [];
            const data = (await res.json()) as { cards?: BattleSpiritsCard[] };
            return Array.isArray(data.cards) ? data.cards : [];
          } catch {
            return [];
          }
        })
      );

      const foundCards = responses.flat();
      if (foundCards.length > 0) {
        setCardsMap((prev) => {
          const resMerge = mergeCardsIntoMap(prev, foundCards, { banList });
          addedCount += resMerge.addedCount;
          return resMerge.next;
        });
      }
    }

    return addedCount + setsToFetch.length;
  };

  // Auto-sync missing cards referenced by a shared deck link (?share=...)
  useEffect(() => {
    if (!pendingSharedDeck) return;
    const missingSetCodes: string[] = [];
    const missingQueries: string[] = [];

    for (const item of pendingSharedDeck.entries) {
      const normNum = normalizeCardNumber(item.cardNumber);
      const compactNum = compactCardNumber(item.cardNumber);
      const normName = normalizeCardName(item.name);
      const exists =
        Boolean(item.cardId && cardsMap[item.cardId]) ||
        allCardsList.some(
          (c) =>
            (normNum &&
              (normalizeCardNumber(c.cardNumber) === normNum ||
                compactCardNumber(c.cardNumber) === compactNum)) ||
            (normName && normalizeCardName(c.name) === normName)
        );
      if (!exists) {
        if (item.cardNumber) {
          const sc = extractSetCodeFromCardNumber(item.cardNumber);
          if (sc) missingSetCodes.push(sc);
          missingQueries.push(item.cardNumber);
        } else if (item.name) {
          missingQueries.push(item.name);
        }
      }
    }

    if (missingSetCodes.length === 0 && missingQueries.length === 0) return;

    let cancelled = false;
    setSyncingSharedCards(true);
    handleSyncMissingImportCards({
      setCodes: missingSetCodes,
      queries: missingQueries,
    }).finally(() => {
      if (!cancelled) setSyncingSharedCards(false);
    });

    return () => {
      cancelled = true;
    };
  }, [pendingSharedDeck]);

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
    const targetSet = productSets.find(
      (s) => s.setCode.toUpperCase() === setCode.toUpperCase()
    );
    let nextFormat = filters.format;
    if (targetSet && !matchesFormatFilter(targetSet.formats, nextFormat)) {
      nextFormat = targetSet.formats.includes('Standard') ? 'Standard' : 'Eternal';
    }
    setFilters({ ...INITIAL_FILTERS, format: nextFormat, setCode });
    setActiveTab('search');
  };

  const openColorInSearch = (color: ColorFilter) => {
    if (filters.format === 'Standard') {
      loadWikiSet('26RBS01');
    } else if (filters.format === 'Eternal') {
      loadWikiSet('BS77');
    }
    setFilters((prev) => ({ ...INITIAL_FILTERS, format: prev.format, color }));
    setActiveTab('search');
  };

  const activeSetMeta =
    filters.setCode !== 'All'
      ? productSets.find((s) => s.setCode.toUpperCase() === filters.setCode.toUpperCase())
      : undefined;

  const navItems: {
    id: AppTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'catalog', label: 'Catalog', icon: Grid },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'decks', label: 'Decks', icon: Layers },
    { id: 'rules', label: 'Rules', icon: BookOpen },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] text-[#111318]">
      {/* Compact Sticky Top Bar: 48px on mobile, 64px on desktop */}
      <header className="sticky top-0 z-30 h-12 lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className="font-display text-lg lg:text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            BattleSpirits
          </button>

          <nav className="hidden lg:flex items-center gap-7" aria-label="Primary Navigation">
            {navItems.map((item) => {
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
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('decks')}
              className="min-h-[36px] lg:min-h-[40px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-semibold whitespace-nowrap shrink-0 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Deck <span className="font-mono tabular-nums">({activeDeckTotal})</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-24 lg:py-8">
        {activeTab === 'catalog' && (
          <CatalogMenuView
            productSets={productSets}
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
                      : 'Search across BS01–BS77, Collab, Supplementary, PB, PC, SD, 26R Standard, Tokens, and Promos.'}
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
                  <div className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                    {filteredCards.length} cards
                  </div>
                </div>
              </div>

              {/* Search Input + Live Wiki Query + Mobile Filter Trigger */}
              <form onSubmit={handleWikiSearch} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    placeholder="Search card name, number, family, or English effect..."
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

                {filters.search.trim().length >= 2 && (
                  <button
                    type="submit"
                    disabled={searchingWiki}
                    className="min-h-[44px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 hover:bg-red-700 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    {searchingWiki ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Globe className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">Search Wiki</span>
                  </button>
                )}

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
              </form>

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

              {/* Loading / Error State for Live Wiki Set Sync */}
              {loadingSetCode && (
                <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center justify-center gap-3 text-sm text-slate-600">
                  <Loader2 className="w-5 h-5 animate-spin text-red-600" />
                  <span>
                    Syncing {loadingSetCode} card list, English effects, and card art from Battle Spirits Wiki...
                  </span>
                </div>
              )}

              {setErrorMsg && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-950 flex items-center justify-between gap-3">
                  <span>{setErrorMsg}</span>
                  <button
                    type="button"
                    onClick={() => filters.setCode !== 'All' && loadWikiSet(filters.setCode)}
                    className="min-h-[36px] px-3 rounded-lg bg-amber-700 text-white font-semibold shrink-0 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Responsive Card Grid */}
              {!loadingSetCode && filteredCards.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
                  <p className="text-sm text-slate-600">
                    {filters.search.trim()
                      ? `No loaded cards matched "${filters.search}". Search the live Battle Spirits Wiki to pull matching cards.`
                      : 'No Battle Spirits cards match your current filters.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    {filters.search.trim() && (
                      <button
                        type="button"
                        onClick={() => handleWikiSearch()}
                        disabled={searchingWiki}
                        className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 inline-flex items-center gap-2 cursor-pointer"
                      >
                        <Globe className="w-4 h-4" />
                        <span>Search Entire Wiki for &ldquo;{filters.search}&rdquo;</span>
                      </button>
                    )}
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
                  {filteredCards.map((card) => (
                    <CardThumbnail
                      key={card.id}
                      card={card}
                      deckQty={activeDeckQtyMap[card.id] || 0}
                      onSelect={setSelectedCard}
                      onAddToDeck={handleQuickAddToDeck}
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
              activeDeckId={activeDeck?.id || ''}
              cardsById={cardsMap}
              onSelectDeck={setActiveDeckId}
              onCreateDeck={handleCreateDeck}
              onChangeDeckFormat={handleChangeDeckFormat}
              onRemoveIllegalCards={handleRemoveIllegalCards}
              onDeleteDeck={handleDeleteDeck}
              onUpdateCardQty={handleUpdateDeckQty}
              onImportDeckEntries={handleImportDeckEntries}
              onSyncMissingImportCards={handleSyncMissingImportCards}
              onInspectCard={setSelectedCard}
              onBrowseCatalog={openSearchTab}
              onNotify={showToast}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'rules' && <RulingsView />}
      </main>

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
              {syncingSharedCards && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2 text-xs text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin text-red-600 shrink-0" />
                  <span>Fetching shared cards from Battle Spirits Wiki...</span>
                </div>
              )}

              {sharedDeckResolution.unmatchedItems.length > 0 && !syncingSharedCards && (
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
        onCardHydrated={handleCardHydrated}
      />
    </div>
  );
}
