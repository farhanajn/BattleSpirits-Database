import React, { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import { ALL_SYMBOLS, SYMBOL_META } from '../data/theme';
import { BattleSymbolKind, GameFormat } from '../types/card';
import { SymbolIcon } from './SymbolIcon';

interface TurnStepItem {
  step: string;
  detail: string;
  badge?: string;
}

const STANDARD_TURN_STEPS: TurnStepItem[] = [
  {
    step: '01. Start Step',
    detail: 'Resolve effects that trigger "At the start of your turn."',
  },
  {
    step: '02. Core Step',
    detail: 'Place 1 core from the Void into your Reserve (skipped on Turn 1 going first).',
  },
  {
    step: '03. Draw Step',
    detail: 'Draw 1 card from your deck.',
  },
  {
    step: '04. Refresh Step',
    detail: 'Return all cores from Trash to Reserve and refresh all exhausted Spirits & Ultimates.',
  },
  {
    step: '05. Main Step 1',
    detail: 'Summon Spirits/Braves, deploy Nexuses, cast Main Magic, Set Burst, and freely move cores.',
  },
  {
    step: '06. Attack Step',
    detail: 'Declare attacks one Spirit at a time. Flash Timing opens for defender first, then attacker, before block & BP comparison.',
  },
  {
    step: '07. Main Step 2',
    badge: 'Standard Only',
    detail: 'Occurs right after the Attack Step. Summon Spirits/Braves, deploy Nexuses, cast Main Magic, Set Burst, and move cores before ending your turn.',
  },
  {
    step: '08. End Step',
    detail: 'Resolve end-of-turn triggers and pass turn to opponent.',
  },
];

const ETERNAL_TURN_STEPS: TurnStepItem[] = [
  {
    step: '01. Start Step',
    detail: 'Resolve effects that trigger "At the start of your turn."',
  },
  {
    step: '02. Core Step',
    detail: 'Place 1 core from the Void into your Reserve (skipped on Turn 1 going first).',
  },
  {
    step: '03. Draw Step',
    detail: 'Draw 1 card from your deck.',
  },
  {
    step: '04. Refresh Step',
    detail: 'Return all cores from Trash to Reserve and refresh all exhausted Spirits & Ultimates.',
  },
  {
    step: '05. Main Step',
    detail: 'Summon Spirits/Ultimates/Braves, deploy Nexuses, cast Main Magic, Set Burst, and freely move cores.',
  },
  {
    step: '06. Attack Step',
    detail: 'Declare attacks one Spirit/Ultimate at a time. Flash Timing opens for defender first, then attacker, before block & BP comparison.',
  },
  {
    step: '07. End Step',
    badge: 'No Main Step 2',
    detail: 'Eternal Format proceeds directly from Attack Step to End Step. Resolve end-of-turn triggers and pass turn to opponent.',
  },
];

export const RulingsView: React.FC = () => {
  const [turnFormat, setTurnFormat] = useState<GameFormat>('Standard');
  const [calcColor, setCalcColor] = useState<BattleSymbolKind>('Red');
  const [cardCost, setCardCost] = useState(6);
  const [cardReductionPips, setCardReductionPips] = useState(3);
  const [boardSymbols, setBoardSymbols] = useState(2);

  const effectiveReduction = Math.min(cardReductionPips, boardSymbols);
  const finalCostToPay = Math.max(0, cardCost - effectiveReduction);
  const activeTurnSteps = turnFormat === 'Standard' ? STANDARD_TURN_STEPS : ETERNAL_TURN_STEPS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Formats, Turn Sequence &amp; Rules
        </h1>
        <p className="text-sm text-slate-500">
          Compare official Standard and Eternal formats, check turn phases, and calculate reduction costs.
        </p>
      </div>

      {/* Standard vs Eternal Format Comparison */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-slate-900">Standard Format</h2>
            <span className="font-mono text-xs font-semibold text-sky-700">2026+ Block Icons</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Modern rotating format permitting only cards released from April 2026 onward carrying English alphabetic block icons (such as Block A).
          </p>
          <dl className="divide-y divide-slate-100 text-xs">
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-slate-500">Eligible Card Pool</dt>
              <dd className="font-semibold text-slate-900 text-right">26RBS01–04, 26RSD01–14, 26RCB/DB/EB, RP26/PX26</dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-slate-500">Deck Construction</dt>
              <dd className="font-semibold text-slate-900 text-right">40+ cards · Max 3 copies per card name</dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-slate-500">Starting Resources</dt>
              <dd className="font-semibold text-slate-900 text-right">5 Life · 3 Cores + 1 Soul Core · 4 Hand</dd>
            </div>
          </dl>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-slate-900">Eternal Format</h2>
            <span className="font-mono text-xs font-semibold text-amber-700">All-Era Legacy</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Comprehensive all-era format where cards from BS01 through BS77, Starter Decks SD01–SD70, Promo Cards, and Standard sets are legal except banned cards.
          </p>
          <dl className="divide-y divide-slate-100 text-xs">
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-slate-500">Eligible Card Pool</dt>
              <dd className="font-semibold text-slate-900 text-right">BS01–BS77, SD01–SD70, Promos &amp; Standard sets</dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-slate-500">Ban &amp; Restriction List</dt>
              <dd className="font-semibold text-slate-900 text-right">Enforces Restricted &lt;1&gt; / &lt;2&gt; limits</dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-slate-500">Featured Mechanics</dt>
              <dd className="font-semibold text-slate-900 text-right">Contract Nexuses, Ultimates, Braves, Burst</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-5 space-y-5">
          <section className="p-4 rounded-2xl bg-white border border-slate-200 space-y-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Reduction Cost Calculator
              </h2>
              <p className="text-xs text-slate-500">
                Each matching color symbol on your Field reduces summon cost by 1.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                  Attribute / Reduction Symbol (6 Colors + God + Ultimate)
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-8 lg:grid-cols-4 gap-1.5">
                  {ALL_SYMBOLS.map((sym) => {
                    const active = calcColor === sym;
                    return (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setCalcColor(sym)}
                        className={`min-h-[40px] px-1.5 rounded-lg border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                        title={SYMBOL_META[sym].label}
                        aria-label={`Select ${SYMBOL_META[sym].label} symbol`}
                      >
                        <SymbolIcon color={sym} size="sm" variant="gem" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Printed Card Cost</span>
                <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCardCost((c) => Math.max(0, c - 1))}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                    aria-label="Decrease printed cost"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono text-sm font-bold tabular-nums min-w-[2rem] text-center">
                    {cardCost}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCardCost((c) => Math.min(15, c + 1))}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                    aria-label="Increase printed cost"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-700">Reduction Symbols</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {cardReductionPips > 0 ? (
                      Array.from({ length: cardReductionPips }).map((_, i) => (
                        <SymbolIcon
                          key={`calc-red-${i}`}
                          color={calcColor}
                          size="xs"
                          variant="reduction"
                        />
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-400">0</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setCardReductionPips((c) => Math.max(0, c - 1))}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                    aria-label="Decrease reduction pips"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono text-sm font-bold tabular-nums min-w-[2rem] text-center">
                    {cardReductionPips}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCardReductionPips((c) => Math.min(8, c + 1))}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                    aria-label="Increase reduction pips"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-700">Field Symbols</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {boardSymbols > 0 ? (
                      Array.from({ length: boardSymbols }).map((_, i) => (
                        <SymbolIcon
                          key={`calc-sym-${i}`}
                          color={calcColor}
                          size="xs"
                          variant="gem"
                        />
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-400">0</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setBoardSymbols((c) => Math.max(0, c - 1))}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                    aria-label="Decrease matching board symbols"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono text-sm font-bold tabular-nums min-w-[2rem] text-center">
                    {boardSymbols}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBoardSymbols((c) => Math.min(10, c + 1))}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                    aria-label="Increase matching board symbols"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-300 flex items-center gap-1.5">
                  <SymbolIcon color={calcColor} size="xs" variant="gem" />
                  <span>Cores Required to Pay</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                  {cardCost} cost − {effectiveReduction} {calcColor} reduced
                </div>
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-white">
                {finalCostToPay}
              </div>
            </div>
          </section>
        </div>

        <div className="lg:col-span-7">
          <section className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">Turn Sequence</h2>
                <p className="text-xs text-slate-500">
                  Standard includes Main Step 2 after Attack Step; Eternal goes straight to End Step.
                </p>
              </div>
              <div
                role="group"
                aria-label="Turn sequence format"
                className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0 self-start sm:self-auto"
              >
                {(['Standard', 'Eternal'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTurnFormat(fmt)}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      turnFormat === fmt
                        ? fmt === 'Standard'
                          ? 'bg-sky-700 text-white shadow-sm'
                          : 'bg-amber-700 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <ol className="divide-y divide-slate-100">
              {activeTurnSteps.map((item) => (
                <li key={item.step} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">{item.step}</span>
                    {item.badge && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                          turnFormat === 'Standard'
                            ? 'bg-sky-50 text-sky-700 border border-sky-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.detail}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
};
