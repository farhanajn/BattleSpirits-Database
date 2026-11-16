import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CardType } from '../types/card';
import { ALL_TYPES } from '../data/theme';

interface DeckCompositionChartProps {
  typeCounts: Record<CardType, number>;
  totalCards: number;
}

const TYPE_CHART_COLORS: Record<CardType, { hex: string; dotClass: string }> = {
  Spirit: { hex: '#dc2626', dotClass: 'bg-red-600' },
  Ultimate: { hex: '#d97706', dotClass: 'bg-amber-600' },
  Brave: { hex: '#0284c7', dotClass: 'bg-sky-600' },
  Nexus: { hex: '#059669', dotClass: 'bg-emerald-600' },
  Magic: { hex: '#7c3aed', dotClass: 'bg-violet-600' },
};

interface ChartDatum {
  name: CardType;
  value: number;
  pct: number;
  color: string;
}

export const DeckCompositionChart: React.FC<DeckCompositionChartProps> = ({
  typeCounts,
  totalCards,
}) => {
  const data: ChartDatum[] = ALL_TYPES.map((t) => {
    const value = typeCounts[t] || 0;
    const pct = totalCards > 0 ? Math.round((value / totalCards) * 100) : 0;
    return {
      name: t,
      value,
      pct,
      color: TYPE_CHART_COLORS[t].hex,
    };
  }).filter((d) => d.value > 0);

  return (
    <div className="pt-2 border-t border-slate-100 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">
          Deck Composition by Card Type
        </span>
        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
          {totalCards} {totalCards === 1 ? 'card' : 'cards'}
        </span>
      </div>

      {totalCards === 0 || data.length === 0 ? (
        <div className="py-6 px-4 rounded-xl bg-slate-50 border border-slate-200/80 text-center text-xs text-slate-500">
          Add Spirits, Ultimates, Braves, Nexuses, or Magic cards to visualize deck composition.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          <div className="sm:col-span-6 relative h-44 w-full min-w-0">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={140}
              minHeight={160}
              initialDimension={{ width: 220, height: 176 }}
            >
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={68}
                  paddingAngle={data.length > 1 ? 3 : 0}
                  stroke="#ffffff"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {data.map((entry) => (
                    <Cell key={`cell-${entry.name}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown, name: unknown) => {
                    const num = Number(value) || 0;
                    const pct = totalCards > 0 ? Math.round((num / totalCards) * 100) : 0;
                    return [`${num} cards (${pct}%)`, String(name)];
                  }}
                  contentStyle={{
                    borderRadius: '0.75rem',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
                    fontSize: '12px',
                    padding: '6px 10px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-lg font-bold text-slate-900 tabular-nums leading-none">
                {totalCards}
              </span>
              <span className="text-[10px] font-medium text-slate-500 mt-0.5">
                Total
              </span>
            </div>
          </div>

          <div className="sm:col-span-6 space-y-1.5">
            {ALL_TYPES.map((t) => {
              const count = typeCounts[t] || 0;
              const pct = totalCards > 0 ? Math.round((count / totalCards) * 100) : 0;
              return (
                <div
                  key={t}
                  className={`flex items-center justify-between text-xs py-1 px-2 rounded-lg ${
                    count > 0 ? 'bg-slate-50' : 'opacity-50'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 text-slate-800 font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: TYPE_CHART_COLORS[t].hex }}
                      aria-hidden="true"
                    />
                    <span>{t}</span>
                  </span>
                  <span className="font-mono tabular-nums text-slate-700">
                    <span className="font-semibold text-slate-900">{count}</span>
                    <span className="text-slate-400"> ({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
