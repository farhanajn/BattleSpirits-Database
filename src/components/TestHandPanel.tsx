import React, { useEffect, useMemo, useState } from 'react';
import {
  Shuffle,
  RotateCcw,
  Plus,
  Layers,
  Award,
  Eye,
  X,
} from 'lucide-react';
import { BattleSpiritsCard, BattleSymbolKind } from '../types/card';
import { COLOR_META } from '../data/theme';
import { CardArtwork } from './CardArtwork';
import { SymbolIcon } from './SymbolIcon';
import {
  applyBattleSpiritsRedraw,
  dealOpeningHand,
  drawNextCard,
  getContractCardsInDeck,
  TestHandState,
} from '../utils/testHand';

interface TestHandPanelProps {
  deckId: string;
  deckName: string;
  resolvedEntries: { card: BattleSpiritsCard; quantity: number }[];
  onInspectCard: (card: BattleSpiritsCard) => void;
  onClose?: () => void;
}

function getMinCost(card: BattleSpiritsCard): number {
  const totalRed = (Object.values(card.reduction) as (number | undefined)[]).reduce<number>(
    (sum, val) => sum + (val || 0),
    0
  );
  return Math.max(0, card.cost - totalRed);
}

export const TestHandPanel: React.FC<TestHandPanelProps> = ({
  deckId,
  deckName,
  resolvedEntries,
  onInspectCard,
  onClose,
}) => {
  const contractCards = useMemo(
    () => getContractCardsInDeck(resolvedEntries),
    [resolvedEntries]
  );

  const totalPlayableCards = useMemo(
    () =>
      resolvedEntries.reduce(
        (sum, e) => (e.card.isToken ? sum : sum + e.quantity),
        0
      ),
    [resolvedEntries]
  );

  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [revealContract, setRevealContract] = useState(true);
  const [handState, setHandState] = useState<TestHandState>(() =>
    dealOpeningHand(resolvedEntries, {
      preferredContractId: contractCards[0]?.id || null,
      revealContract: true,
      handSize: 4,
    })
  );

  // Sync preferred Contract card and reset simulated hand when switching decks or card pool
  useEffect(() => {
    const nextContractId = contractCards.some((c) => c.id === selectedContractId)
      ? selectedContractId
      : contractCards[0]?.id || '';
    if (nextContractId !== selectedContractId) {
      setSelectedContractId(nextContractId);
    }
    setHandState(
      dealOpeningHand(resolvedEntries, {
        preferredContractId: nextContractId || null,
        revealContract,
        handSize: 4,
      })
    );
  }, [deckId, totalPlayableCards, contractCards.length]);

  const handleDealNewHand = (overrideContractId?: string, overrideReveal?: boolean) => {
    const nextId = overrideContractId !== undefined ? overrideContractId : selectedContractId;
    const nextReveal = overrideReveal !== undefined ? overrideReveal : revealContract;
    setHandState(
      dealOpeningHand(resolvedEntries, {
        preferredContractId: nextId || null,
        revealContract: nextReveal,
        handSize: 4,
      })
    );
  };

  const handleRedraw = () => {
    if (handState.hand.length === 0 && handState.library.length === 0) return;
    setHandState((prev) => applyBattleSpiritsRedraw(prev, 4));
  };

  const handleDrawOne = () => {
    setHandState((prev) => drawNextCard(prev));
  };

  const handleContractChoice = (contractId: string) => {
    setSelectedContractId(contractId);
    setRevealContract(true);
    handleDealNewHand(contractId, true);
  };

  const handleToggleRevealContract = () => {
    const next = !revealContract;
    setRevealContract(next);
    handleDealNewHand(selectedContractId, next);
  };

  const handMetrics = useMemo(() => {
    const turnOnePlayable = handState.hand.filter((h) => h.card.cost <= 3).length;
    const avgCost =
      handState.hand.length > 0
        ? (
            handState.hand.reduce((sum, h) => sum + h.card.cost, 0) /
            handState.hand.length
          ).toFixed(1)
        : '0.0';
    const spiritsOrUlt = handState.hand.filter(
      (h) => h.card.type === 'Spirit' || h.card.type === 'Ultimate'
    ).length;
    const nexusCount = handState.hand.filter((h) => h.card.type === 'Nexus').length;
    return { turnOnePlayable, avgCost, spiritsOrUlt, nexusCount };
  }, [handState.hand]);

  const renderHandCardTile = (
    card: BattleSpiritsCard,
    keyId: string,
    isContractSlot: boolean = false
  ) => {
    const meta = COLOR_META[card.color];
    const minCost = getMinCost(card);
    const reductionEntries = (
      Object.entries(card.reduction || {}) as [BattleSymbolKind, number][]
    ).filter(([, n]) => n > 0);

    return (
      <button
        key={keyId}
        type="button"
        onClick={() => onInspectCard(card)}
        className={`group text-left rounded-xl border overflow-hidden transition-all cursor-pointer flex flex-col ${
          isContractSlot
            ? 'border-amber-400 bg-amber-50/40 ring-1 ring-amber-300/60 hover:border-amber-500'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
        }`}
      >
        <div className="relative aspect-[5/7] w-full bg-slate-950 overflow-hidden">
          <CardArtwork
            card={card}
            fit="contain"
            className="w-full h-full bg-slate-950 transition-transform duration-200 group-hover:scale-[1.02]"
          />
          <div
            className="absolute top-1.5 left-1.5 w-6 h-6 rounded-md flex items-center justify-center font-mono text-xs font-bold text-white shadow tabular-nums"
            style={{ backgroundColor: meta.hex }}
          >
            {card.cost}
          </div>
          {isContractSlot && (
            <div className="absolute bottom-1.5 inset-x-1.5 py-0.5 px-1.5 rounded bg-amber-600/95 text-white text-[10px] font-bold text-center tracking-tight">
              Revealed Contract
            </div>
          )}
        </div>
        <div className="p-2 flex-1 flex flex-col justify-between gap-1">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug group-hover:text-red-700 transition-colors">
              {card.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500 font-mono tabular-nums">
              <SymbolIcon color={card.color} size="xs" variant="gem" />
              <span className={meta.text}>{card.subtypeLabel || card.type}</span>
            </div>
          </div>

          <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-1 text-[10px] font-mono tabular-nums text-slate-500">
            <span>Min {minCost}</span>
            {reductionEntries.length > 0 && (
              <span className="inline-flex items-center gap-0.5">
                {reductionEntries.slice(0, 2).map(([sym, count]) =>
                  Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                    <SymbolIcon
                      key={`${sym}-${i}`}
                      color={sym}
                      size="xs"
                      variant="reduction"
                    />
                  ))
                )}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <section
      aria-label="Test Opening Hand Simulator"
      className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-red-700">Opening Hand Simulator</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-slate-700">{deckName}</span>
            {handState.redrawCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-semibold text-amber-700 tabular-nums">
                  Redraw #{handState.redrawCount}
                </span>
              </>
            )}
          </div>
          <h2 className="font-display text-base sm:text-lg font-bold text-slate-900">
            Test Hand (4-Card Draw{contractCards.length > 0 ? ' + 1 Contract Reveal' : ''})
          </h2>
          <p className="text-xs text-slate-500">
            Official Battle Spirits Redraw rule: return all 4 drawn cards to deck, shuffle, and draw 4 new cards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleDealNewHand()}
            disabled={totalPlayableCards === 0}
            className="min-h-[44px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-slate-800 disabled:opacity-40 cursor-pointer whitespace-nowrap"
          >
            <Shuffle className="w-4 h-4" />
            <span>New Hand</span>
          </button>

          <button
            type="button"
            onClick={handleRedraw}
            disabled={totalPlayableCards === 0 || handState.hand.length === 0}
            className="min-h-[44px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-red-700 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            title="Return all drawn cards to the deck, shuffle, and draw 4 new cards"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Redraw (New Rule)</span>
          </button>

          <button
            type="button"
            onClick={handleDrawOne}
            disabled={handState.library.length === 0}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Draw +1</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
              aria-label="Close Test Hand simulator"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Contract Selection Bar when deck has Contract card(s) */}
      {contractCards.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start sm:items-center gap-2 text-xs text-amber-950">
            <Award className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span className="font-semibold">Contract Card Rule: </span>
              <span>
                1 copy of your Contract card starts revealed outside your 4-card hand (extra copies stay in deck).
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {contractCards.length > 1 && (
              <select
                value={selectedContractId}
                onChange={(e) => handleContractChoice(e.target.value)}
                aria-label="Choose starting Contract card"
                className="min-h-[38px] px-2.5 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-600"
              >
                {contractCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.cardNumber})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleToggleRevealContract}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                revealContract
                  ? 'bg-amber-700 text-white border-amber-700'
                  : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{revealContract ? '1 Contract Revealed' : 'Reveal Contract'}</span>
            </button>
          </div>
        </div>
      )}

      {totalPlayableCards === 0 ? (
        <div className="py-8 px-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
          Add cards to this deck first to simulate a 4-card opening hand.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
              <span className="text-slate-500">In Hand</span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {handState.hand.length} {handState.revealedContract ? '+ 1 Contract' : 'cards'}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
              <span className="text-slate-500">Cost ≤ 3 Plays</span>
              <span className="font-mono font-bold text-emerald-700 tabular-nums">
                {handMetrics.turnOnePlayable}/{handState.hand.length}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
              <span className="text-slate-500">Avg. Hand Cost</span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {handMetrics.avgCost}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
              <span className="text-slate-500">Deck Left</span>
              <span className="font-mono font-bold text-slate-900 tabular-nums inline-flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                {handState.library.length}
              </span>
            </div>
          </div>

          {/* Card Slots: Revealed Contract (if any) + 4 Drawn Hand Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-stretch">
            {handState.revealedContract &&
              renderHandCardTile(
                handState.revealedContract.card,
                `contract-${handState.revealedContract.instanceId}`,
                true
              )}

            {handState.hand.map((item, idx) =>
              renderHandCardTile(
                item.card,
                `hand-${item.instanceId}-${idx}-${handState.redrawCount}`,
                false
              )
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              Tap any card to open full card details &amp; rulings.
              {handState.redrawCount > 0 &&
                ' Shuffled previous 4-card hand back into deck before drawing.'}
            </span>
            <span className="font-mono tabular-nums">
              {handMetrics.spiritsOrUlt} Spirits/Ult · {handMetrics.nexusCount} Nexus in hand
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
