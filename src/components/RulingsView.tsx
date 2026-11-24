import React, { useState } from 'react';
import { GameFormat } from '../types/card';

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
  const activeTurnSteps = turnFormat === 'Standard' ? STANDARD_TURN_STEPS : ETERNAL_TURN_STEPS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Formats, Turn Sequence &amp; Rules
        </h1>
        <p className="text-sm text-slate-500">
          Compare official Standard and Eternal formats and check turn phases.
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
  );
};
