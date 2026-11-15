import React, { useMemo, useState } from 'react';
import { BattleSpiritsCard, BattleSymbolKind } from '../types/card';
import { ALL_SYMBOLS, SYMBOL_META } from '../data/theme';
import { SymbolIcon } from './SymbolIcon';

interface DeckStatsPanelProps {
  resolvedEntries: { card: BattleSpiritsCard; quantity: number }[];
  totalCards: number;
}

export const DeckStatsPanel: React.FC<DeckStatsPanelProps> = ({
  resolvedEntries,
  totalCards,
}) => {
  const [showAllFamilies, setShowAllFamilies] = useState(false);

  const stats = useMemo(() => {
    let weightedBaseCost = 0;
    let weightedMinCost = 0;
    let earlyCurveCount = 0; // cost 0-2
    let midCurveCount = 0; // cost 3-4
    let highCurveCount = 0; // cost 5+

    const boardSymbols: Record<BattleSymbolKind, number> = {
      Red: 0,
      Purple: 0,
      White: 0,
      Yellow: 0,
      Green: 0,
      Blue: 0,
      God: 0,
      Ultimate: 0,
    };

    const reductionSymbols: Record<BattleSymbolKind, number> = {
      Red: 0,
      Purple: 0,
      White: 0,
      Yellow: 0,
      Green: 0,
      Blue: 0,
      God: 0,
      Ultimate: 0,
    };

    const familyMap = new Map<
      string,
      { name: string; totalCopies: number; uniqueCards: number }
    >();
    let cardsWithFamily = 0;

    for (const { card, quantity } of resolvedEntries) {
      weightedBaseCost += card.cost * quantity;

      const cardTotalRed = (Object.values(card.reduction) as (number | undefined)[]).reduce<number>(
        (s, v) => s + (v || 0),
        0
      );
      const minCost = Math.max(0, card.cost - cardTotalRed);
      weightedMinCost += minCost * quantity;

      if (card.cost <= 2) earlyCurveCount += quantity;
      else if (card.cost <= 4) midCurveCount += quantity;
      else highCurveCount += quantity;

      for (const sym of ALL_SYMBOLS) {
        const boardQty = card.symbols?.[sym] || 0;
        if (boardQty > 0) boardSymbols[sym] += boardQty * quantity;

        const redQty = card.reduction?.[sym] || 0;
        if (redQty > 0) reductionSymbols[sym] += redQty * quantity;
      }

      if (card.families && card.families.length > 0) {
        cardsWithFamily += quantity;
        for (const fam of card.families) {
          const clean = fam.trim();
          if (!clean) continue;
          const existing = familyMap.get(clean);
          if (existing) {
            existing.totalCopies += quantity;
            existing.uniqueCards += 1;
          } else {
            familyMap.set(clean, {
              name: clean,
              totalCopies: quantity,
              uniqueCards: 1,
            });
          }
        }
      }
    }

    const avgBaseCost = totalCards > 0 ? (weightedBaseCost / totalCards).toFixed(1) : '0.0';
    const avgMinCost = totalCards > 0 ? (weightedMinCost / totalCards).toFixed(1) : '0.0';

    const totalBoardGems = ALL_SYMBOLS.reduce((s, sym) => s + boardSymbols[sym], 0);
    const totalReductionPips = ALL_SYMBOLS.reduce((s, sym) => s + reductionSymbols[sym], 0);

    const activeSymbols = ALL_SYMBOLS.map((sym) => ({
      symbol: sym,
      board: boardSymbols[sym],
      reduction: reductionSymbols[sym],
      combined: boardSymbols[sym] + reductionSymbols[sym],
    })).filter((item) => item.combined > 0);

    const maxSymbolActivity = Math.max(
      1,
      ...activeSymbols.map((s) => Math.max(s.board, s.reduction))
    );

    const families = Array.from(familyMap.values()).sort(
      (a, b) => b.totalCopies - a.totalCopies || b.uniqueCards - a.uniqueCards || a.name.localeCompare(b.name)
    );

    return {
      avgBaseCost,
      avgMinCost,
      earlyCurveCount,
      midCurveCount,
      highCurveCount,
      totalBoardGems,
      totalReductionPips,
      activeSymbols,
      maxSymbolActivity,
      families,
      cardsWithFamily,
    };
  }, [resolvedEntries, totalCards]);

  const visibleFamilies = showAllFamilies ? stats.families : stats.families.slice(0, 6);

  return (
    <div className="space-y-4 pt-2 border-t border-slate-100">
      {/* Average Card Cost & Tempo Metrics */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-slate-700">
            Deck Performance Stats
          </span>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {stats.families.length} {stats.families.length === 1 ? 'family' : 'families'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <div className="text-[11px] text-slate-500">Avg. Cost</div>
            <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
              {stats.avgBaseCost}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <div className="text-[11px] text-slate-500">Avg. Min Cost</div>
            <div className="font-mono text-base font-bold text-emerald-700 tabular-nums">
              {stats.avgMinCost}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <div className="text-[11px] text-slate-500">Board Gems</div>
            <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
              {stats.totalBoardGems}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <div className="text-[11px] text-slate-500">Reduction Pips</div>
            <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
              {stats.totalReductionPips}
            </div>
          </div>
        </div>

        {totalCards > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
            <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 flex items-center justify-between">
              <span>Cost 0–2</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {stats.earlyCurveCount} ({Math.round((stats.earlyCurveCount / totalCards) * 100)}%)
              </span>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 flex items-center justify-between">
              <span>Cost 3–4</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {stats.midCurveCount} ({Math.round((stats.midCurveCount / totalCards) * 100)}%)
              </span>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 flex items-center justify-between">
              <span>Cost 5+</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {stats.highCurveCount} ({Math.round((stats.highCurveCount / totalCards) * 100)}%)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Symbol Count Distribution */}
      <div className="pt-2 border-t border-slate-100 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">
            Symbol Count Distribution
          </span>
          <span className="text-[11px] text-slate-400">
            Gems Provided vs Reductions
          </span>
        </div>

        {stats.activeSymbols.length === 0 ? (
          <div className="py-3 px-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500 text-center">
            Add cards to inspect board symbol &amp; reduction pip distribution.
          </div>
        ) : (
          <div className="space-y-2">
            {stats.activeSymbols.map(({ symbol, board, reduction }) => {
              const meta = SYMBOL_META[symbol];
              const boardPct = Math.round((board / stats.maxSymbolActivity) * 100);
              const redPct = Math.round((reduction / stats.maxSymbolActivity) * 100);
              return (
                <div
                  key={symbol}
                  className="p-2 rounded-xl bg-slate-50/90 border border-slate-200/60 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                      <SymbolIcon color={symbol} size="xs" variant="gem" />
                      <span className={meta.text}>{meta.label}</span>
                    </span>
                    <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
                      <span className="text-slate-700">
                        <strong className="text-slate-900">{board}</strong> Gems
                      </span>
                      <span className="text-slate-500">
                        <strong className="text-slate-800">{reduction}</strong> Red.
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${boardPct}%`,
                          backgroundColor: meta.hex,
                        }}
                        title={`${meta.label} Board Gems: ${board}`}
                      />
                    </div>
                    <div className="h-1 w-full rounded-full bg-slate-200/60 overflow-hidden">
                      <div
                        className="h-full rounded-full opacity-55 transition-all duration-300"
                        style={{
                          width: `${redPct}%`,
                          backgroundColor: meta.hex,
                        }}
                        title={`${meta.label} Reduction Pips: ${reduction}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Family Count Distribution */}
      <div className="pt-2 border-t border-slate-100 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">
            Family Count
          </span>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {stats.cardsWithFamily}/{totalCards} cards w/ family
          </span>
        </div>

        {stats.families.length === 0 ? (
          <div className="py-3 px-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500 text-center">
            No Spirit, Ultimate, or Brave families in this deck yet.
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleFamilies.map((fam) => {
              const pct = totalCards > 0 ? Math.round((fam.totalCopies / totalCards) * 100) : 0;
              return (
                <div
                  key={fam.name}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/60 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-800 truncate">
                      {fam.name}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums shrink-0 text-slate-700">
                      <strong className="text-slate-900">{fam.totalCopies}</strong>{' '}
                      <span className="text-slate-400">
                        ({pct}% · {fam.uniqueCards} uniq)
                      </span>
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-slate-200/80 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-slate-800 transition-all duration-300"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {stats.families.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllFamilies((v) => !v)}
                className="w-full min-h-[36px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                {showAllFamilies
                  ? 'Show Top 6 Families'
                  : `Show All ${stats.families.length} Families`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
