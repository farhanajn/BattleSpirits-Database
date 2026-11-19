import React from 'react';
import { Plus, Check, Ban } from 'lucide-react';
import { BattleSpiritsCard, CardColor } from '../types/card';
import { COLOR_META } from '../data/theme';
import { CardArtwork } from './CardArtwork';
import { SymbolIcon } from './SymbolIcon';
import { getMaxCardCopies, getRestrictionBadgeLabel, isTokenCard } from '../utils/cardRules';

interface CardThumbnailProps {
  card: BattleSpiritsCard;
  deckQty: number;
  onSelect: (card: BattleSpiritsCard) => void;
  onAddToDeck: (card: BattleSpiritsCard) => void;
  onHoverOrFocus?: () => void;
}

export const CardThumbnail: React.FC<CardThumbnailProps> = ({
  card,
  deckQty,
  onSelect,
  onAddToDeck,
  onHoverOrFocus,
}) => {
  const cardColors: CardColor[] =
    card.colors && card.colors.length > 0
      ? card.colors
      : card.secondaryColor
      ? [card.color, card.secondaryColor]
      : [card.color];

  const meta = COLOR_META[cardColors[0] || card.color];

  const isStandardLegal = card.formats.includes('Standard');
  const isToken = isTokenCard(card);
  const maxCopies = getMaxCardCopies(card);
  const restrictionBadge = isToken ? 'TOKEN' : getRestrictionBadgeLabel(card.restriction);
  const isBanned = !isToken && maxCopies === 0;
  const cannotAdd = (isToken || isBanned) && deckQty === 0;

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

  return (
    <article
      onMouseEnter={onHoverOrFocus}
      onFocus={onHoverOrFocus}
      className="group bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col transition-colors hover:border-slate-300"
    >
      <button
        type="button"
        onClick={() => onSelect(card)}
        className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-inset flex-1 flex flex-col cursor-pointer"
      >
        <div className="relative aspect-[4/3] w-full">
          <CardArtwork card={card} className="w-full h-full" />

          <div
            className="absolute bottom-0 inset-x-0 h-[3px]"
            style={{ background: accentBackground }}
          />
        </div>

        <div className="p-3 pb-2 flex-1 flex flex-col justify-between gap-1.5">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className="font-mono tabular-nums shrink-0">{card.cardNumber}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{card.rarity}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 min-w-0">
                {cardColors.slice(0, 3).map((c) => (
                  <SymbolIcon key={c} color={c} size="xs" variant="gem" />
                ))}
                <span className={`${meta.text} font-semibold truncate`}>
                  {colorLabel} {card.subtypeLabel || card.type}
                </span>
              </span>
            </div>
            <h3 className="mt-1 font-display text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
              {card.name}
            </h3>
          </div>

          <p className="text-[11px] text-slate-500 truncate" title={`${card.setCode} — ${card.setName}`}>
            {card.families.length > 0 ? card.families.join(' / ') : card.setName}
          </p>
        </div>
      </button>

      <div className="px-3 pb-2.5 pt-1 border-t border-slate-100 flex items-center justify-between gap-2">
        <div
          className="min-w-0 flex items-center gap-1 text-[11px] text-slate-500 truncate"
          title={`${card.setCode} — ${card.setName}`}
        >
          <span className="font-mono font-semibold text-slate-700 shrink-0">{card.setCode}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{card.setName}</span>
          <span aria-hidden="true">·</span>
          <span className={`font-mono shrink-0 ${isStandardLegal ? 'text-sky-700 font-semibold' : 'text-amber-700 font-semibold'}`}>
            {isStandardLegal ? 'STD/ETN' : 'ETN'}
          </span>
          {card.galleryImages && card.galleryImages.length > 1 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-slate-700 font-mono font-semibold shrink-0">
                {card.galleryImages.length} arts
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
          onClick={() => onAddToDeck(card)}
          disabled={cannotAdd}
          title={
            isToken
              ? 'Token cards are used outside the main deck'
              : isBanned
              ? 'Banned cards cannot be added to a deck'
              : undefined
          }
          className={`min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
            isToken && deckQty === 0
              ? 'bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed'
              : isBanned && deckQty === 0
              ? 'bg-red-50 text-red-700/80 border border-red-200 cursor-not-allowed'
              : deckQty > 0
              ? 'bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer'
              : 'bg-slate-100 text-slate-800 hover:bg-slate-200 cursor-pointer'
          }`}
          aria-label={
            isToken
              ? `${card.name} is a Token card used outside the main deck`
              : isBanned
              ? `${card.name} is banned from deck construction`
              : `Add ${card.name} to active deck`
          }
        >
          {isToken && deckQty === 0 ? (
            <span className="whitespace-nowrap">Token</span>
          ) : isBanned && deckQty === 0 ? (
            <>
              <Ban className="w-3.5 h-3.5" />
              <span className="whitespace-nowrap">Banned</span>
            </>
          ) : deckQty > 0 ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums whitespace-nowrap">
                {deckQty}/{maxCopies}
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
