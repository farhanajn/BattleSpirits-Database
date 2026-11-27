import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Check, Ban, ChevronDown, ArrowLeftRight } from 'lucide-react';
import { BattleSpiritsCard, CardColor } from '../types/card';
import { COLOR_META } from '../data/theme';
import { CardArtwork } from './CardArtwork';
import { SymbolIcon } from './SymbolIcon';
import {
  getMaxCardCopies,
  getRestrictionBadgeLabel,
  isTokenCard,
  type TenseiSide,
} from '../utils/cardRules';
import type {
  CardPrintingOption,
  TenseiGroupPairInfo,
} from '../utils/reprintConsolidation';

interface CardThumbnailProps {
  card: BattleSpiritsCard;
  deckQty: number;
  printings?: CardPrintingOption[];
  tenseiPair?: TenseiGroupPairInfo;
  preferredPrintingId?: string;
  preferredSide?: TenseiSide;
  activeDeckQtyMap?: Record<string, number>;
  onSelect: (card: BattleSpiritsCard) => void;
  onAddToDeck: (card: BattleSpiritsCard) => void;
  onHoverOrFocus?: () => void;
}

function resolveDefaultTenseiSide(
  pair?: TenseiGroupPairInfo,
  prefSide?: TenseiSide,
  prefPrintingId?: string,
  baseCardId?: string
): TenseiSide {
  if (!pair) return 'A';
  if (prefSide === 'A' || prefSide === 'B') return prefSide;
  if (prefPrintingId && pair.sideBPrintings.some((p) => p.cardId === prefPrintingId)) {
    return 'B';
  }
  if (baseCardId && pair.sideBPrintings.some((p) => p.cardId === baseCardId)) {
    return 'B';
  }
  return 'A';
}

export const CardThumbnail: React.FC<CardThumbnailProps> = ({
  card,
  deckQty,
  printings,
  tenseiPair,
  preferredPrintingId,
  preferredSide,
  activeDeckQtyMap,
  onSelect,
  onAddToDeck,
  onHoverOrFocus,
}) => {
  const [selectedSide, setSelectedSide] = useState<TenseiSide>(() =>
    resolveDefaultTenseiSide(tenseiPair, preferredSide, preferredPrintingId, card.id)
  );

  const effectivePrintings = useMemo<CardPrintingOption[]>(() => {
    if (tenseiPair) {
      return selectedSide === 'B'
        ? tenseiPair.sideBPrintings
        : tenseiPair.sideAPrintings;
    }
    if (printings && printings.length > 0) return printings;
    return [
      {
        card,
        cardId: card.id,
        setCode: card.setCode,
        setName: card.setName,
        cardNumber: card.cardNumber,
        rarity: card.rarity,
        formats: card.formats,
        isRevival: Boolean(card.isRevival),
        releaseDateLabel: '',
        releaseSortKey: 0,
        isCanonicalOriginal: true,
      },
    ];
  }, [tenseiPair, selectedSide, printings, card]);

  const [selectedPrintingId, setSelectedPrintingId] = useState<string>(() => {
    if (
      preferredPrintingId &&
      effectivePrintings.some((p) => p.cardId === preferredPrintingId)
    ) {
      return preferredPrintingId;
    }
    return effectivePrintings[0]?.cardId || card.id;
  });
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [maxInlineCount, setMaxInlineCount] = useState(3);

  const badgeRowRef = useRef<HTMLDivElement | null>(null);
  const popoverContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nextSide = resolveDefaultTenseiSide(
      tenseiPair,
      preferredSide,
      preferredPrintingId,
      card.id
    );
    const sidePool = tenseiPair
      ? nextSide === 'B'
        ? tenseiPair.sideBPrintings
        : tenseiPair.sideAPrintings
      : printings && printings.length > 0
      ? printings
      : [];
    const nextDefault =
      preferredPrintingId && sidePool.some((p) => p.cardId === preferredPrintingId)
        ? preferredPrintingId
        : sidePool[0]?.cardId || card.id;
    setSelectedSide(nextSide);
    setSelectedPrintingId(nextDefault);
    setOverflowOpen(false);
  }, [tenseiPair, preferredSide, preferredPrintingId, card.id, printings]);

  useEffect(() => {
    const el = badgeRowRef.current;
    if (!el || effectivePrintings.length <= 1) return;

    const computeCapacity = (width: number) => {
      if (!Number.isFinite(width) || width <= 0) return;
      // Reserve ~44px for the +N overflow trigger when more badges remain; each compact badge averages ~54px
      const withoutOverflowCapacity = Math.floor((width + 4) / 56);
      if (effectivePrintings.length <= withoutOverflowCapacity) {
        setMaxInlineCount(effectivePrintings.length);
        return;
      }
      const nextMax = Math.max(2, Math.min(4, Math.floor((width - 44) / 56)));
      setMaxInlineCount(nextMax);
    };

    computeCapacity(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        computeCapacity(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectivePrintings.length]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (popoverContainerRef.current && target && !popoverContainerRef.current.contains(target)) {
        setOverflowOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [overflowOpen]);

  const activePrinting =
    effectivePrintings.find((p) => p.cardId === selectedPrintingId) ||
    effectivePrintings[0];
  const activeCard = activePrinting?.card || card;

  const sideADisplayName = useMemo(() => {
    if (!tenseiPair) return '';
    if (selectedSide === 'A') return activeCard.name;
    const linkedId = tenseiPair.sideABySideBCardId[activeCard.id];
    const linkedCard = linkedId
      ? tenseiPair.sideAPrintings.find((p) => p.cardId === linkedId)?.card
      : undefined;
    return linkedCard?.name || tenseiPair.sideACanonical.name;
  }, [tenseiPair, selectedSide, activeCard]);

  const sideBDisplayName = useMemo(() => {
    if (!tenseiPair) return '';
    if (selectedSide === 'B') return activeCard.name;
    const linkedId = tenseiPair.sideBBySideACardId[activeCard.id];
    const linkedCard = linkedId
      ? tenseiPair.sideBPrintings.find((p) => p.cardId === linkedId)?.card
      : undefined;
    return linkedCard?.name || tenseiPair.sideBCanonical.name;
  }, [tenseiPair, selectedSide, activeCard]);

  const { inlinePrintings, overflowPrintings } = useMemo(() => {
    if (effectivePrintings.length <= 1) {
      return { inlinePrintings: effectivePrintings, overflowPrintings: [] as CardPrintingOption[] };
    }
    if (effectivePrintings.length <= maxInlineCount) {
      return { inlinePrintings: effectivePrintings, overflowPrintings: [] as CardPrintingOption[] };
    }
    const baseSlice = effectivePrintings.slice(0, maxInlineCount);
    const activeIsInline = baseSlice.some((p) => p.cardId === activeCard.id);
    if (activeIsInline || maxInlineCount < 2) {
      return {
        inlinePrintings: baseSlice,
        overflowPrintings: effectivePrintings.slice(maxInlineCount),
      };
    }
    // Keep oldest canonical badge first and swap active printing into the visible bar
    const visible = [...effectivePrintings.slice(0, maxInlineCount - 1), activePrinting];
    const visibleIds = new Set(visible.map((p) => p.cardId));
    const hidden = effectivePrintings.filter((p) => !visibleIds.has(p.cardId));
    return { inlinePrintings: visible, overflowPrintings: hidden };
  }, [effectivePrintings, maxInlineCount, activeCard.id, activePrinting]);

  const activeDeckQty =
    activeDeckQtyMap !== undefined ? activeDeckQtyMap[activeCard.id] ?? 0 : deckQty;

  const cardColors: CardColor[] =
    activeCard.colors && activeCard.colors.length > 0
      ? activeCard.colors
      : activeCard.secondaryColor
      ? [activeCard.color, activeCard.secondaryColor]
      : [activeCard.color];

  const meta = COLOR_META[cardColors[0] || activeCard.color];

  const isStandardLegal = activeCard.formats.includes('Standard');
  const isToken = isTokenCard(activeCard);
  const maxCopies = getMaxCardCopies(activeCard);
  const restrictionBadge = isToken ? 'TOKEN' : getRestrictionBadgeLabel(activeCard.restriction);
  const isBanned = !isToken && maxCopies === 0;
  const cannotAdd = (isToken || isBanned) && activeDeckQty === 0;

  const accentBackground =
    cardColors.length > 1
      ? `linear-gradient(to right, ${cardColors
          .map((c) => COLOR_META[c].hex)
          .join(', ')})`
      : meta.hex;

  const colorLabel =
    cardColors.length === 1
      ? cardColors[0]
      : cardColors.length === 2
      ? `${cardColors[0]}/${cardColors[1]}`
      : `${cardColors.length}-Color`;

  const handleSelectSide = (nextSide: TenseiSide, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!tenseiPair || nextSide === selectedSide) return;

    const currentId = activePrinting?.cardId || card.id;
    const nextPrintingId =
      nextSide === 'B'
        ? tenseiPair.sideBBySideACardId[currentId] ||
          tenseiPair.sideBPrintings[0]?.cardId
        : tenseiPair.sideABySideBCardId[currentId] ||
          tenseiPair.sideAPrintings[0]?.cardId;

    setSelectedSide(nextSide);
    if (nextPrintingId) {
      setSelectedPrintingId(nextPrintingId);
    }
    setOverflowOpen(false);
  };

  const handleSelectPrinting = (printing: CardPrintingOption, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPrintingId(printing.cardId);
    setOverflowOpen(false);
  };

  return (
    <article
      onMouseEnter={onHoverOrFocus}
      onFocus={onHoverOrFocus}
      className={`group relative bg-white border border-slate-200 rounded-2xl flex flex-col transition-colors hover:border-slate-300 ${
        overflowOpen ? 'z-30' : 'z-0'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(activeCard)}
        className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-inset cursor-pointer rounded-t-2xl overflow-hidden"
        aria-label={`View ${activeCard.name} (${activeCard.cardNumber}) details`}
      >
        <div className="relative aspect-[4/3] w-full bg-slate-900 overflow-hidden">
          <CardArtwork card={activeCard} className="w-full h-full" />

          <span
            data-testid="card-set-badge"
            title={
              activeCard.setName
                ? `${activeCard.setCode || 'WIKI'} — ${activeCard.setName}`
                : activeCard.setCode || 'WIKI'
            }
            className="pointer-events-none absolute top-2 right-2 z-10 inline-flex items-center px-2 py-0.5 rounded-full bg-slate-900/85 backdrop-blur-sm text-white font-mono text-[10px] font-bold tracking-wide shadow-sm ring-1 ring-white/25"
          >
            {activeCard.setCode?.trim() || 'WIKI'}
          </span>

          <div
            className="absolute bottom-0 inset-x-0 h-[3px]"
            style={{ background: accentBackground }}
          />
        </div>
      </button>

      {tenseiPair && (
        <div
          data-testid="card-side-selector"
          role="group"
          aria-label="Tensei / Rebirth side selector"
          className="px-3 pt-2 pb-0.5 flex items-center gap-1"
        >
          <button
            type="button"
            data-testid="side-a-btn"
            aria-pressed={selectedSide === 'A'}
            onClick={(e) => handleSelectSide('A', e)}
            title={`Side A: ${sideADisplayName}`}
            className={`min-w-0 flex-1 px-2 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
              selectedSide === 'A'
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            <span
              className={`font-mono text-[10px] font-bold px-1 rounded shrink-0 ${
                selectedSide === 'A' ? 'bg-white/20 text-amber-300' : 'bg-slate-200 text-slate-700'
              }`}
            >
              A
            </span>
            <span className="truncate">{sideADisplayName}</span>
          </button>

          <button
            type="button"
            data-testid="side-swap-btn"
            onClick={(e) => handleSelectSide(selectedSide === 'A' ? 'B' : 'A', e)}
            title={`Flip to Side ${selectedSide === 'A' ? 'B' : 'A'}: ${
              selectedSide === 'A' ? sideBDisplayName : sideADisplayName
            }`}
            aria-label={`Flip between Side A (${sideADisplayName}) and Side B (${sideBDisplayName})`}
            className="px-1.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 text-[11px] inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            <ArrowLeftRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            data-testid="side-b-btn"
            aria-pressed={selectedSide === 'B'}
            onClick={(e) => handleSelectSide('B', e)}
            title={`Side B: ${sideBDisplayName}`}
            className={`min-w-0 flex-1 px-2 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
              selectedSide === 'B'
                ? 'bg-red-700 text-white border-red-700 shadow-xs'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            <span
              className={`font-mono text-[10px] font-bold px-1 rounded shrink-0 ${
                selectedSide === 'B' ? 'bg-white/20 text-amber-200' : 'bg-slate-200 text-slate-700'
              }`}
            >
              B
            </span>
            <span className="truncate">{sideBDisplayName}</span>
          </button>
        </div>
      )}

      {effectivePrintings.length > 1 && (
        <div
          ref={popoverContainerRef}
          data-testid="card-printing-badges"
          className="relative px-3 pt-2 pb-0.5"
        >
          <div
            ref={badgeRowRef}
            className="flex items-center flex-wrap gap-1"
            role="group"
            aria-label={`Available printings for ${activeCard.name}`}
          >
            {inlinePrintings.map((printing) => {
              const isActive = printing.cardId === activeCard.id;
              return (
                <button
                  key={printing.cardId}
                  type="button"
                  data-testid={`printing-badge-${printing.setCode}`}
                  aria-pressed={isActive}
                  onClick={(e) => handleSelectPrinting(printing, e)}
                  title={`${printing.setCode} · ${printing.cardNumber}${
                    printing.setName ? ` — ${printing.setName}` : ''
                  }${printing.isCanonicalOriginal ? ' (Original Release)' : ''}`}
                  className={`px-1.5 py-0.5 rounded-md border font-mono text-[10px] font-bold tracking-tight transition-colors cursor-pointer leading-tight ${
                    isActive
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 hover:border-slate-300'
                  }`}
                >
                  {printing.setCode}
                </button>
              );
            })}

            {overflowPrintings.length > 0 && (
              <button
                type="button"
                data-testid="printing-badges-overflow"
                aria-expanded={overflowOpen}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOverflowOpen((prev) => !prev);
                }}
                title={`${overflowPrintings.length} more printing${
                  overflowPrintings.length === 1 ? '' : 's'
                }`}
                className={`px-1.5 py-0.5 rounded-md border font-mono text-[10px] font-bold tracking-tight inline-flex items-center gap-0.5 transition-colors cursor-pointer leading-tight ${
                  overflowOpen
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 hover:border-slate-300'
                }`}
              >
                <span>+{overflowPrintings.length}</span>
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          {overflowOpen && overflowPrintings.length > 0 && (
            <div
              role="menu"
              data-testid="printing-overflow-popover"
              aria-label="Additional card printings"
              className="absolute left-3 right-3 sm:right-auto sm:min-w-[220px] sm:max-w-[260px] top-full mt-1 z-40 rounded-xl border border-slate-200 bg-white shadow-xl p-1.5 space-y-0.5"
            >
              <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Other Printings ({overflowPrintings.length})
              </div>
              {overflowPrintings.map((printing) => {
                const isActive = printing.cardId === activeCard.id;
                return (
                  <button
                    key={printing.cardId}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    data-testid={`printing-overflow-item-${printing.setCode}`}
                    onClick={(e) => handleSelectPrinting(printing, e)}
                    className={`w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-mono font-bold text-[11px]">
                        <span>{printing.setCode}</span>
                        <span className={isActive ? 'text-slate-300' : 'text-slate-400'}>·</span>
                        <span className={isActive ? 'text-slate-200' : 'text-slate-600'}>
                          {printing.cardNumber}
                        </span>
                      </div>
                      <div
                        className={`text-[10px] truncate ${
                          isActive ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {printing.setName}
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[10px] font-bold shrink-0 ${
                        isActive ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      {printing.rarity}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onSelect(activeCard)}
        className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-inset flex-1 flex flex-col cursor-pointer"
      >
        <div
          className={`px-3 pb-2 ${
            effectivePrintings.length > 1 || Boolean(tenseiPair) ? 'pt-1.5' : 'pt-3'
          } flex-1 flex flex-col justify-between gap-1.5 w-full`}
        >
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className="font-mono tabular-nums shrink-0">{activeCard.cardNumber}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{activeCard.rarity}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 min-w-0">
                {cardColors.slice(0, 3).map((c) => (
                  <SymbolIcon key={c} color={c} size="xs" variant="gem" />
                ))}
                <span className={`${meta.text} font-semibold truncate`}>
                  {colorLabel} {activeCard.subtypeLabel || activeCard.type}
                </span>
              </span>
            </div>
            <h3 className="mt-1 font-display text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
              {activeCard.name}
            </h3>
          </div>

          <p
            className="text-[11px] text-slate-500 truncate"
            title={`${activeCard.setCode} — ${activeCard.setName}`}
          >
            {activeCard.families.length > 0 ? activeCard.families.join(' / ') : activeCard.setName}
          </p>
        </div>
      </button>

      <div className="px-3 pb-2.5 pt-1 border-t border-slate-100 flex items-center justify-between gap-2 rounded-b-2xl">
        <div
          className="min-w-0 flex items-center gap-1 text-[11px] text-slate-500 truncate"
          title={`${activeCard.setCode} — ${activeCard.setName}`}
        >
          <span className="font-mono font-semibold text-slate-700 shrink-0">{activeCard.setCode}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{activeCard.setName}</span>
          <span aria-hidden="true">·</span>
          <span
            className={`font-mono shrink-0 ${
              isStandardLegal ? 'text-sky-700 font-semibold' : 'text-amber-700 font-semibold'
            }`}
          >
            {isStandardLegal ? 'STD/ETN' : 'ETN'}
          </span>
          {activeCard.galleryImages && activeCard.galleryImages.length > 1 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-slate-700 font-mono font-semibold shrink-0">
                {activeCard.galleryImages.length} arts
              </span>
            </>
          )}
          {restrictionBadge && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-red-700 font-mono font-semibold shrink-0">
                {restrictionBadge}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onAddToDeck(activeCard)}
          disabled={cannotAdd}
          title={
            isToken
              ? 'Token cards are used outside the main deck'
              : isBanned
              ? 'Banned cards cannot be added to a deck'
              : undefined
          }
          className={`min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
            isToken && activeDeckQty === 0
              ? 'bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed'
              : isBanned && activeDeckQty === 0
              ? 'bg-red-50 text-red-700/80 border border-red-200 cursor-not-allowed'
              : activeDeckQty > 0
              ? 'bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer'
              : 'bg-slate-100 text-slate-800 hover:bg-slate-200 cursor-pointer'
          }`}
          aria-label={
            isToken
              ? `${activeCard.name} is a Token card used outside the main deck`
              : isBanned
              ? `${activeCard.name} is banned from deck construction`
              : `Add ${activeCard.name} to active deck`
          }
        >
          {isToken && activeDeckQty === 0 ? (
            <span className="whitespace-nowrap">Token</span>
          ) : isBanned && activeDeckQty === 0 ? (
            <>
              <Ban className="w-3.5 h-3.5" />
              <span className="whitespace-nowrap">Banned</span>
            </>
          ) : activeDeckQty > 0 ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums whitespace-nowrap">
                {activeDeckQty}/{maxCopies}
              </span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              <span className="whitespace-nowrap">Deck</span>
            </>
          )}
        </button>
      </div>
    </article>
  );
};
