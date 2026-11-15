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

type AppTab = 'catalog' | 'search' | 'decks' | 'rules';

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

function parseStateFromUrl(): { tab: AppTab; filters: FilterState } {
  if (typeof window === 'undefined') {
    return { tab: 'catalog', filters: INITIAL_FILTERS };
  }
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get('tab') as AppTab | null;
  const tab: AppTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'catalog';

  const rawFmt = params.get('fmt') as FormatFilter | null;
  const rawVer = params.get('ver') as FilterState['version'] | null;
  const rawColor = params.get('color') as ColorFilter | null;
  const rawType = params.get('type') as (CardType | 'All') | null;
  const rawRarity = params.get('rarity') as (CardRarity | 'All') | null;
  const rawCost = params.get('cost') as FilterState['costBracket'] | null;
  const rawSort = params.get('sort') as FilterState['sortBy'] | null;

  return {
    tab,
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

export default function App() {
  const initialFromUrl = useMemo(() => parseStateFromUrl(), []);
  const [activeTab, setActiveTab] = useState<AppTab>(initialFromUrl.tab);
  const [filters, setFilters] = useState<FilterState>(initialFromUrl.filters);
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
          for (const [id, card] of Object.entries(parsed)) {
            if (!initial[id] && card && typeof card === 'object') {
              initial[id] = card as BattleSpiritsCard;
            }
          }
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
          return parsed.map((d) => ({
            ...d,
            format: d.format === 'Standard' || d.format === 'Eternal' ? d.format : 'Eternal',
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
    const nextSearch = buildUrlSearch(activeTab, filters);
    if (window.location.search !== nextSearch) {
      const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeTab, filters]);

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseStateFromUrl();
      setActiveTab(parsed.tab);
      setFilters(parsed.filters);
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
        setCardsMap((prev) => {
          const next = { ...prev };
          for (const h of data.cards as BattleSpiritsCard[]) {
            const existing = next[h.id];
            if (!existing) {
              next[h.id] = h;
              continue;
            }
            next[h.id] = {
              ...existing,
              ...h,
              id: existing.id,
              name: h.name || existing.name,
              jpName: h.jpName || existing.jpName,
              type: h.type,
              subtypeLabel: h.subtypeLabel,
              isRevival: h.isRevival,
              isToken: h.isToken,
              colors: h.colors && h.colors.length > 0 ? h.colors : existing.colors,
              families: h.families.length > 0 ? h.families : existing.families,
              levels: h.levels,
              braveCondition: h.braveCondition,
              braveBonusBp: h.braveBonusBp,
              summonCondition: h.summonCondition,
              symbols: h.symbols,
              reduction: Object.keys(h.reduction || {}).length > 0 ? h.reduction : existing.reduction,
              effects: h.effects.length > 0 ? h.effects : existing.effects,
              keywords: h.keywords.length > 0 ? h.keywords : existing.keywords,
              flavorText: h.flavorText || existing.flavorText,
              illustrator: h.illustrator || existing.illustrator,
              artworkImage: h.artworkImage || existing.artworkImage,
              galleryImages:
                h.galleryImages && h.galleryImages.length > 0
                  ? h.galleryImages
                  : existing.galleryImages,
              rulings:
                h.rulings && h.rulings.length > 0 ? h.rulings : existing.rulings,
              isWikiLoaded: true,
            };
          }
          return next;
        });
      })
      .catch(() => {
        // keep bundled fallback cleanly if offline
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Automatically sync all official Wiki Token cards so Platinum Bug, Rig Avatar Dragon, Swordish, Fungal Bed, etc. appear in Search
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wiki/sets/TOKENS?hydrate=100')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.cards)) return;
        setCardsMap((prev) => {
          const next = { ...prev };
          const bundledByNum = new Map<string, string>();
          for (const b of BATTLE_SPIRITS_CARDS) {
            bundledByNum.set(b.cardNumber.toUpperCase(), b.id);
          }
          for (const c of data.cards as BattleSpiritsCard[]) {
            const targetId = next[c.id]
              ? c.id
              : bundledByNum.get(c.cardNumber.toUpperCase()) || c.id;
            next[targetId] = {
              ...(next[targetId] || {}),
              ...c,
              id: targetId,
              isToken: true,
            };
          }
          return next;
        });
      })
      .catch(() => {
        // keep bundled tokens cleanly if offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Automatically sync official Wiki Revival cards (Category:Revival Cards + Revival tabber cards) so the Revival section is richly populated
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wiki/sets/REVIVAL?hydrate=800')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.cards)) return;
        setCardsMap((prev) => {
          const next = { ...prev };
          const bundledByNum = new Map<string, string>();
          for (const b of BATTLE_SPIRITS_CARDS) {
            bundledByNum.set(
              `${b.cardNumber.toUpperCase()}|${b.isRevival ? 'rv' : 'orig'}`,
              b.id
            );
          }
          for (const c of data.cards as BattleSpiritsCard[]) {
            const key = `${c.cardNumber.toUpperCase()}|${c.isRevival ? 'rv' : 'orig'}`;
            const targetId = next[c.id] ? c.id : bundledByNum.get(key) || c.id;
            const existing = next[targetId];
            next[targetId] = {
              ...(existing || {}),
              ...c,
              id: targetId,
              isRevival: true,
              type: c.type,
              subtypeLabel: c.subtypeLabel,
              levels: c.levels,
              braveCondition: c.braveCondition,
              braveBonusBp: c.braveBonusBp,
              summonCondition: c.summonCondition,
              symbols: c.symbols ?? existing?.symbols ?? {},
              artworkImage: c.artworkImage || existing?.artworkImage || '',
              galleryImages:
                c.galleryImages && c.galleryImages.length > 0
                  ? c.galleryImages
                  : existing?.galleryImages,
            };
          }
          return next;
        });
      })
      .catch(() => {
        // keep bundled Revival cards cleanly if offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DECKS_KEY, JSON.stringify(decks));
    } catch {
      // ignore
    }
  }, [decks]);

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
          setCardsMap((prev) => {
            const next = { ...prev };
            const bundledByNum = new Map<string, string>();
            for (const c of BATTLE_SPIRITS_CARDS) {
              bundledByNum.set(
                `${c.cardNumber.toUpperCase()}|${c.isRevival ? 'rv' : 'orig'}`,
                c.id
              );
            }

            for (const c of data.cards!) {
              const key = `${c.cardNumber.toUpperCase()}|${c.isRevival ? 'rv' : 'orig'}`;
              const targetId = next[c.id]
                ? c.id
                : bundledByNum.get(key) || c.id;
              const existing = next[targetId];
              next[targetId] = {
                ...(existing || {}),
                ...c,
                id: targetId,
                name: c.name || existing?.name || c.cardNumber,
                jpName: c.jpName || existing?.jpName || '',
                type: c.type,
                subtypeLabel: c.subtypeLabel,
                isRevival: c.isRevival ?? existing?.isRevival,
                isToken: c.isToken ?? existing?.isToken,
                colors:
                  c.colors && c.colors.length > 0
                    ? c.colors
                    : existing?.colors,
                families: c.families.length > 0 ? c.families : existing?.families || [],
                levels: c.levels,
                braveCondition: c.braveCondition,
                braveBonusBp: c.braveBonusBp,
                summonCondition: c.summonCondition,
                symbols: c.symbols,
                reduction:
                  Object.keys(c.reduction || {}).length > 0
                    ? c.reduction
                    : existing?.reduction || {},
                effects: c.effects.length > 0 ? c.effects : existing?.effects || [],
                keywords: c.keywords.length > 0 ? c.keywords : existing?.keywords || [],
                artworkImage: c.artworkImage || existing?.artworkImage || '',
                galleryImages:
                  c.galleryImages && c.galleryImages.length > 0
                    ? c.galleryImages
                    : existing?.galleryImages,
                rulings:
                  c.rulings && c.rulings.length > 0
                    ? c.rulings
                    : existing?.rulings || [],
                wikiTitle: c.wikiTitle || existing?.wikiTitle,
                isWikiLoaded: c.isWikiLoaded || existing?.isWikiLoaded,
              };
            }
            return next;
          });
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
    [loadedSetCodes]
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
        setCardsMap((prev) => {
          const next = { ...prev };
          const bundledByNum = new Map<string, string>();
          for (const b of BATTLE_SPIRITS_CARDS) {
            bundledByNum.set(
              `${b.cardNumber.toUpperCase()}|${b.isRevival ? 'rv' : 'orig'}`,
              b.id
            );
          }
          for (const c of data.cards!) {
            const key = `${c.cardNumber.toUpperCase()}|${c.isRevival ? 'rv' : 'orig'}`;
            const targetId = next[c.id]
              ? c.id
              : bundledByNum.get(key) || c.id;
            const existing = next[targetId];
            next[targetId] = {
              ...(existing || {}),
              ...c,
              id: targetId,
              type: c.type,
              subtypeLabel: c.subtypeLabel,
              isRevival: c.isRevival ?? existing?.isRevival,
              isToken: c.isToken ?? existing?.isToken,
              levels: c.levels,
              braveCondition: c.braveCondition,
              braveBonusBp: c.braveBonusBp,
              summonCondition: c.summonCondition,
              symbols: c.symbols ?? existing?.symbols ?? {},
              rulings:
                c.rulings && c.rulings.length > 0
                  ? c.rulings
                  : existing?.rulings || [],
              galleryImages:
                c.galleryImages && c.galleryImages.length > 0
                  ? c.galleryImages
                  : existing?.galleryImages,
              artworkImage: c.artworkImage || existing?.artworkImage || '',
            };
          }
          return next;
        });
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

  const handleCardHydrated = useCallback((hydrated: BattleSpiritsCard) => {
    setCardsMap((prev) => ({
      ...prev,
      [hydrated.id]: hydrated,
    }));
    setSelectedCard((curr) => (curr && curr.id === hydrated.id ? hydrated : curr));
  }, []);

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

    const getMaxBp = (c: BattleSpiritsCard) =>
      c.levels && c.levels.length > 0 ? c.levels[c.levels.length - 1].bp : 0;

    list.sort((a, b) => {
      if (filters.sortBy === 'cost-asc') return a.cost - b.cost || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'cost-desc') return b.cost - a.cost || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'bp-desc') return getMaxBp(b) - getMaxBp(a) || a.cardNumber.localeCompare(b.cardNumber);
      if (filters.sortBy === 'name') return a.name.localeCompare(b.name);
      return a.cardNumber.localeCompare(b.cardNumber);
    });

    return list;
  }, [allCardsList, filters]);

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

  const getMaxCopies = (card?: BattleSpiritsCard) =>
    card?.restriction === 'Restricted <1>'
      ? 1
      : card?.restriction === 'Restricted <2>'
      ? 2
      : 3;

  const handleUpdateDeckQty = (cardId: string, delta: number) => {
    if (!activeDeck) {
      showToast('Create a deck in Decks first to add cards');
      return;
    }
    const card = cardsMap[cardId];
    const maxCopies = getMaxCopies(card);

    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== activeDeck.id) return deck;
        const existing = deck.entries.find((e) => e.cardId === cardId);
        const currentQty = existing ? existing.quantity : 0;
        const nextQty = Math.max(0, Math.min(maxCopies, currentQty + delta));

        if (nextQty === currentQty) {
          if (delta > 0 && currentQty >= maxCopies) {
            showToast(
              `Max ${maxCopies} ${maxCopies === 1 ? 'copy' : 'copies'} of ${
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
            if (deck.format === 'Standard' && !card.formats.includes('Standard')) {
              return false;
            }
            return true;
          })
          .map((entry) => {
            const card = cardsMap[entry.cardId];
            const maxCopies = getMaxCopies(card);
            return entry.quantity > maxCopies ? { ...entry, quantity: maxCopies } : entry;
          });
        return {
          ...deck,
          updatedAt: new Date().toISOString().slice(0, 10),
          entries: cleaned,
        };
      })
    );
    showToast('Removed illegal cards and enforced restrictions');
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
          const next = { ...prev };
          const bundledByNum = new Map<string, string>();
          for (const b of BATTLE_SPIRITS_CARDS) {
            bundledByNum.set(
              `${b.cardNumber.toUpperCase()}|${b.isRevival ? 'rv' : 'orig'}`,
              b.id
            );
          }
          for (const c of foundCards) {
            const key = `${c.cardNumber.toUpperCase()}|${c.isRevival ? 'rv' : 'orig'}`;
            const targetId = next[c.id] ? c.id : bundledByNum.get(key) || c.id;
            if (!next[targetId]) addedCount++;
            const existing = next[targetId];
            next[targetId] = {
              ...(existing || {}),
              ...c,
              id: targetId,
            };
          }
          return next;
        });
      }
    }

    return addedCount + setsToFetch.length;
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
            {/* Desktop Inline Filter Sidebar */}
            <aside className="hidden lg:block lg:col-span-3 sticky top-24 bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <h2 className="font-display text-sm font-bold text-slate-900">Filters</h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {filteredCards.length} / {allCardsList.length}
                </span>
              </div>
              <FilterControls
                filters={filters}
                availableSets={availableSets}
                availableKeywords={availableKeywords}
                onChange={updateFilters}
                onReset={() => setFilters(INITIAL_FILTERS)}
              />
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
