import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Search } from 'lucide-react';
import {
  BattleSpiritsCard,
  ColorFilter,
  FormatFilter,
  ProductSet,
} from '../types/card';
import { ALL_COLORS, COLOR_META } from '../data/theme';
import { CardArtwork } from './CardArtwork';
import { CardThumbnail } from './CardThumbnail';
import { SymbolIcon } from './SymbolIcon';

type SetCategoryTab =
  | 'all'
  | 'booster'
  | 'starter'
  | 'collab'
  | 'supplementary'
  | 'pb'
  | 'pc'
  | 'standard'
  | 'tokens'
  | 'revival'
  | 'promo';

interface CatalogMenuViewProps {
  productSets: ProductSet[];
  cards: BattleSpiritsCard[];
  cardsById: Record<string, BattleSpiritsCard>;
  activeDeckQtyMap: Record<string, number>;
  activeFormat: FormatFilter;
  onChangeFormat: (format: FormatFilter) => void;
  onOpenSetInSearch: (setCode: string) => void;
  onOpenColorInSearch: (color: ColorFilter) => void;
  onOpenSearch: () => void;
  onSelectCard: (card: BattleSpiritsCard) => void;
  onAddToDeck: (card: BattleSpiritsCard) => void;
}

export const CatalogMenuView: React.FC<CatalogMenuViewProps> = ({
  productSets,
  cards,
  cardsById,
  activeDeckQtyMap,
  activeFormat,
  onChangeFormat,
  onOpenSetInSearch,
  onOpenColorInSearch,
  onOpenSearch,
  onSelectCard,
  onAddToDeck,
}) => {
  const [setCategory, setSetCategory] = useState<SetCategoryTab>('all');
  const [setQuery, setSetQuery] = useState('');
  const [visibleSetLimit, setVisibleSetLimit] = useState(24);

  useEffect(() => {
    setSetCategory('all');
    setVisibleSetLimit(24);
  }, [activeFormat]);

  const matchesFormat = (formats: ('Standard' | 'Eternal')[]) => {
    if (activeFormat === 'All') return true;
    if (activeFormat === 'Standard') return formats.includes('Standard');
    return !formats.includes('Standard') && formats.includes('Eternal');
  };

  const formatFilteredSets = useMemo(() => {
    return productSets.filter((s) => {
      if (activeFormat === 'All') return true;
      if (activeFormat === 'Standard') return s.formats.includes('Standard');
      return !s.formats.includes('Standard') && s.formats.includes('Eternal');
    });
  }, [productSets, activeFormat]);

  const latestSet =
    activeFormat === 'Standard'
      ? productSets.find((s) => s.setCode === '26RBS01') ||
        productSets.find((s) => s.isLatestStandard) ||
        formatFilteredSets[0] ||
        productSets[0]
      : productSets.find((s) => s.setCode === 'BS77') ||
        productSets.find((s) => s.isLatestEternal) ||
        formatFilteredSets[0] ||
        productSets[0];

  const latestFeaturedCard =
    cardsById[latestSet.featuredCardId] ||
    cards.find((c) => c.setCode === latestSet.setCode) ||
    cards.find((c) => matchesFormat(c.formats)) ||
    cards[0];

  const newestCards = useMemo(() => {
    const filtered = cards.filter((c) => {
      if (activeFormat === 'Standard') return c.formats.includes('Standard');
      if (activeFormat === 'Eternal') {
        return !c.formats.includes('Standard') && c.formats.includes('Eternal');
      }
      return true;
    });
    return filtered.slice(0, 8);
  }, [cards, activeFormat]);

  const filteredDirectorySets = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    return formatFilteredSets.filter((s) => {
      if (s.setCode.toUpperCase() === 'BSS01') return false;
      if (
        setCategory === 'booster' &&
        s.category !== 'Booster' &&
        s.category !== 'Standard Booster'
      ) {
        return false;
      }
      if (
        setCategory === 'starter' &&
        s.category !== 'Starter Deck' &&
        s.category !== 'Standard Starter'
      ) {
        return false;
      }
      if (setCategory === 'collab' && s.category !== 'Collab Booster') return false;
      if (setCategory === 'supplementary' && s.category !== 'Supplementary') return false;
      if (setCategory === 'pb' && s.category !== 'Premium Bandai') return false;
      if (setCategory === 'pc' && s.category !== 'Premium Card Set') return false;
      if (setCategory === 'tokens' && s.category !== 'Token' && s.setCode !== 'TOKENS') {
        return false;
      }
      if (setCategory === 'revival' && s.category !== 'Revival' && s.setCode !== 'REVIVAL' && s.setCode !== 'BSC22') {
        return false;
      }
      if (setCategory === 'standard' && !s.formats.includes('Standard')) {
        return false;
      }
      if (setCategory === 'promo' && s.category !== 'Promo') return false;

      if (q) {
        const hay = `${s.setCode} ${s.name} ${s.tagline} ${s.blockLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [formatFilteredSets, setCategory, setQuery]);

  const displayedSets = filteredDirectorySets.slice(0, visibleSetLimit);
  const remainingSets = Math.max(0, filteredDirectorySets.length - displayedSets.length);

  const countInDatabase = (setCode: string) => {
    if (setCode === 'TOKENS') {
      return cards.filter((c) => c.isToken).length;
    }
    if (setCode === 'REVIVAL') {
      return cards.filter((c) => c.isRevival).length;
    }
    return cards.filter((c) => {
      if (c.setCode !== setCode) return false;
      if (activeFormat === 'Standard') return c.formats.includes('Standard');
      if (activeFormat === 'Eternal') {
        return !c.formats.includes('Standard') && c.formats.includes('Eternal');
      }
      return true;
    }).length;
  };

  const formatSummary =
    activeFormat === 'Standard'
      ? 'Standard Format: 2026+ releases with Block A+ icons (26RBS, 26RSD, RP26, PX26, Tokens).'
      : activeFormat === 'Eternal'
      ? 'Eternal Era (BS01–BS77, SD01–SD70, CB01–CB34, CBX01, BSC01–BSC51, PB01–PB50, PC01–PC12 & Promos).'
      : 'Full Wiki Integration: BS01–BS77, Collab (CB), Supplementary (BSC), PB, PC, SD, 26R Standard, Tokens & Promos.';

  const categoryTabs: { id: SetCategoryTab; label: string }[] =
    activeFormat === 'Standard'
      ? [
          { id: 'all', label: 'All Standard Sets' },
          { id: 'booster', label: '26R Boosters' },
          { id: 'starter', label: '26R Starters' },
          { id: 'tokens', label: 'Tokens' },
          { id: 'promo', label: 'Standard Promos' },
        ]
      : activeFormat === 'Eternal'
      ? [
          { id: 'all', label: 'All Eternal Sets' },
          { id: 'booster', label: 'BS01–BS77' },
          { id: 'collab', label: 'Collab (CB)' },
          { id: 'supplementary', label: 'Supplementary (BSC)' },
          { id: 'pb', label: 'Premium Bandai (PB)' },
          { id: 'pc', label: 'Premium Card (PC)' },
          { id: 'starter', label: 'SD01–SD70' },
          { id: 'revival', label: 'Revival' },
          { id: 'promo', label: 'Eternal Promos' },
        ]
      : [
          { id: 'all', label: 'All Sets' },
          { id: 'booster', label: 'Boosters' },
          { id: 'collab', label: 'Collab (CB)' },
          { id: 'supplementary', label: 'Supplementary (BSC)' },
          { id: 'pb', label: 'Premium Bandai (PB)' },
          { id: 'pc', label: 'Premium Card (PC)' },
          { id: 'starter', label: 'Starter Decks' },
          { id: 'standard', label: 'Standard (26R)' },
          { id: 'revival', label: 'Revival' },
          { id: 'tokens', label: 'Tokens' },
          { id: 'promo', label: 'Promos' },
        ];

  return (
    <div className="space-y-8">
      {/* Workspace Format Switcher (Standard vs Eternal) */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-slate-500">Format &amp; Wiki Catalog</div>
          <p className="text-xs sm:text-sm text-slate-700">{formatSummary}</p>
        </div>

        <div
          role="group"
          aria-label="Filter catalog by format"
          className="inline-flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl self-start sm:self-auto shrink-0"
        >
          {(['All', 'Standard', 'Eternal'] as FormatFilter[]).map((fmt) => {
            const active = activeFormat === fmt;
            return (
              <button
                key={fmt}
                type="button"
                onClick={() => onChangeFormat(fmt)}
                className={`min-h-[40px] px-3.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? fmt === 'Standard'
                      ? 'bg-sky-700 text-white shadow-sm'
                      : fmt === 'Eternal'
                      ? 'bg-amber-700 text-white shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {fmt === 'All' ? 'All Formats' : fmt}
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Menu Focal Anchor: Latest Product / Set Reveal */}
      <section className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-6 p-5 sm:p-8 flex flex-col justify-between gap-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <span
                  className={`font-semibold ${
                    latestSet.formats.includes('Standard')
                      ? 'text-sky-700'
                      : 'text-amber-700'
                  }`}
                >
                  {latestSet.formats.includes('Standard')
                    ? 'Latest Standard Release'
                    : 'Latest Eternal Release'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-semibold text-slate-800">{latestSet.setCode}</span>
                <span aria-hidden="true">·</span>
                <span>{latestSet.blockLabel}</span>
                <span aria-hidden="true">·</span>
                <span>{latestSet.releaseDate}</span>
              </div>

              <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
                {latestSet.name}
              </h1>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
                {latestSet.tagline}
              </p>

              <div className="pt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <div className="flex flex-wrap items-center gap-2">
                  {latestSet.colors.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1">
                      <SymbolIcon color={c} size="xs" variant="gem" />
                      <span className={`font-semibold ${COLOR_META[c].text}`}>{c}</span>
                    </span>
                  ))}
                </div>
                <span aria-hidden="true">·</span>
                <span>Legal in {latestSet.formats.join(' & ')}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onOpenSetInSearch(latestSet.setCode)}
                className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white text-sm font-semibold inline-flex items-center gap-2 hover:bg-red-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Open {latestSet.setCode} Cards</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onOpenSearch}
                className="min-h-[44px] px-4 rounded-xl bg-slate-100 text-slate-800 text-sm font-semibold inline-flex items-center gap-2 hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Search className="w-4 h-4" />
                <span>Search Wiki</span>
              </button>

              <a
                href={latestSet.wikiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Wiki</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {latestFeaturedCard && (
            <button
              type="button"
              onClick={() => onSelectCard(latestFeaturedCard)}
              className="lg:col-span-6 relative min-h-[220px] sm:min-h-[280px] lg:h-full text-left group overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <CardArtwork card={latestFeaturedCard} className="w-full h-full" />
              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-black/85 via-black/45 to-transparent text-white">
                <div className="text-[11px] font-mono text-amber-300 font-semibold">
                  {latestFeaturedCard.cardNumber} · {latestFeaturedCard.rarity} ·{' '}
                  {latestFeaturedCard.formats.includes('Standard') ? 'STD & ETN' : 'ETN Only'}
                </div>
                <div className="font-display text-lg sm:text-xl font-bold leading-snug">
                  {latestFeaturedCard.name}
                </div>
              </div>
            </button>
          )}
        </div>
      </section>

      {/* Newest Release Cards Preview */}
      <section className="space-y-3.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
              {activeFormat === 'Standard'
                ? 'Standard Format Highlights'
                : activeFormat === 'Eternal'
                ? 'Eternal Format Highlights'
                : 'Featured Cards'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Tap any card for English effects, all card artworks, and deck builder controls.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenSetInSearch(latestSet.setCode)}
            className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-red-700 hover:bg-red-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Explore {latestSet.setCode}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {newestCards.map((card) => (
            <CardThumbnail
              key={card.id}
              card={card}
              deckQty={activeDeckQtyMap[card.id] || 0}
              onSelect={onSelectCard}
              onAddToDeck={onAddToDeck}
            />
          ))}
        </div>
      </section>

      {/* Quick Browse by Attribute */}
      <section className="space-y-3">
        <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
          Browse by Attribute
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {ALL_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onOpenColorInSearch(color)}
              className="min-h-[52px] px-3 py-2.5 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 flex items-center justify-center gap-2 text-xs font-semibold transition-colors cursor-pointer"
            >
              <SymbolIcon color={color} size="sm" variant="gem" />
              <span className={COLOR_META[color].text}>{color}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onOpenColorInSearch('Multicolor')}
            className="min-h-[52px] px-3 py-2.5 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 flex items-center justify-center gap-2 text-xs font-semibold transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center -space-x-1">
              <SymbolIcon color="Red" size="xs" variant="gem" />
              <SymbolIcon color="Blue" size="xs" variant="gem" />
            </span>
            <span className="text-slate-800">Multi-Color</span>
          </button>
        </div>
      </section>

      {/* Complete Wiki Sets Directory: BS01-BS77, SD01-SD70, 26R Standard, Promos */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
              Complete Set &amp; Promo Directory ({filteredDirectorySets.length})
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Select any booster, Collab (CB01–CB34 / CBX01), Supplementary (BSC01–BSC51), PB01–PB50, PC01–PC12, Starter, Tokens, or Promo set to sync live cards.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={setQuery}
              onChange={(e) => {
                setSetQuery(e.target.value);
                setVisibleSetLimit(24);
              }}
              placeholder="Jump to set (CB01, BSC22, PB01, PC01)..."
              className="w-full min-h-[44px] pl-9 pr-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {categoryTabs.map((tab) => {
            const active = setCategory === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setSetCategory(tab.id);
                  setVisibleSetLimit(24);
                }}
                className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {displayedSets.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
            No expansion sets match your current category or search query.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {displayedSets.map((set) => {
              const coverCard = cardsById[set.featuredCardId];
              const dbCount = countInDatabase(set.setCode);
              const hasStandard = set.formats.includes('Standard');
              return (
                <button
                  key={set.setCode}
                  type="button"
                  onClick={() => onOpenSetInSearch(set.setCode)}
                  className="group bg-white border border-slate-200 hover:border-slate-300 rounded-2xl overflow-hidden text-left flex flex-col transition-colors cursor-pointer"
                >
                  {coverCard && (
                    <div className="relative aspect-[16/9] w-full overflow-hidden">
                      <CardArtwork card={coverCard} className="w-full h-full" />
                      <div className="absolute top-2.5 left-2.5 bg-slate-950/80 backdrop-blur-sm text-white font-mono text-xs font-bold px-2.5 py-1 rounded-lg">
                        {set.setCode}
                      </div>
                    </div>
                  )}

                  <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
                        <span className="font-mono font-bold text-slate-900">{set.setCode}</span>
                        <span aria-hidden="true">·</span>
                        <span className={hasStandard ? 'text-sky-700 font-semibold' : 'text-amber-700 font-semibold'}>
                          {hasStandard ? 'Standard & Eternal' : 'Eternal Only'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{set.releaseDate}</span>
                      </div>
                      <h3 className="mt-1 font-display text-base font-bold text-slate-900 group-hover:text-red-700 transition-colors">
                        {set.name}
                      </h3>
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                        {set.tagline}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {set.colors.map((c) => (
                          <SymbolIcon key={c} color={c} size="xs" variant="gem" />
                        ))}
                      </div>
                      <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
                        {dbCount > 0 ? `${dbCount} loaded` : set.productType}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {remainingSets > 0 && (
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={() => setVisibleSetLimit((n) => n + 36)}
              className="min-h-[44px] px-6 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Show More Sets ({remainingSets} remaining)
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
