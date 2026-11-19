import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BattleSpiritsCard, CardColor } from '../types/card';
import { COLOR_META } from '../data/theme';
import { SymbolIcon } from './SymbolIcon';

export interface RechartsCostBucketDatum {
  bucket: number;
  label: string;
  count: number;
  pct: number;
  dominantHex: string;
  byColor: { color: CardColor; count: number }[];
  cards: { card: BattleSpiritsCard; quantity: number }[];
}

interface DeckCostChartProps {
  resolvedEntries: { card: BattleSpiritsCard; quantity: number }[];
  totalCards: number;
  selectedCostBucket: number | null;
  onSelectCostBucket: (bucket: number | null) => void;
}

const VALID_COLORS: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];

function getPrimaryColor(card: BattleSpiritsCard): CardColor {
  if (card.color && VALID_COLORS.includes(card.color)) return card.color;
  if (card.colors && card.colors.length > 0 && VALID_COLORS.includes(card.colors[0])) {
    return card.colors[0];
  }
  return 'Red';
}

export const DeckCostChart: React.FC<DeckCostChartProps> = ({
  resolvedEntries,
  totalCards,
  selectedCostBucket,
  onSelectCostBucket,
}) => {
  const [hoveredBucket, setHoveredBucket] = useState<RechartsCostBucketDatum | null>(null);

  const costData = useMemo<RechartsCostBucketDatum[]>(() => {
    const buckets = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    return buckets.map((bucket) => {
      const matching = resolvedEntries.filter(({ card }) => {
        const c = Number.isFinite(Number(card.cost)) ? Number(card.cost) : 0;
        return bucket === 8 ? c >= 8 : c === bucket;
      });
      const count = matching.reduce(
        (sum, item) => sum + (Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0),
        0
      );

      const colorCounts = new Map<CardColor, number>();
      for (const item of matching) {
        const c = getPrimaryColor(item.card);
        const qty = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
        colorCounts.set(c, (colorCounts.get(c) || 0) + qty);
      }

      const byColor = VALID_COLORS.map((color) => ({
        color,
        count: colorCounts.get(color) || 0,
      }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count);

      const dominantColor = byColor[0]?.color;
      const dominantHex = dominantColor ? COLOR_META[dominantColor].hex : '#0f172a';
      const pct = totalCards > 0 ? Math.round((count / totalCards) * 100) : 0;

      return {
        bucket,
        label: bucket === 8 ? '8+' : String(bucket),
        count,
        pct,
        dominantHex,
        byColor,
        cards: matching,
      };
    });
  }, [resolvedEntries, totalCards]);

  const activeBucketDetail =
    selectedCostBucket !== null
      ? costData.find((d) => d.bucket === selectedCostBucket) || null
      : null;

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">
          Cost Distribution (Recharts)
        </span>
        <span className="text-[11px] font-mono text-slate-500 tabular-nums">
          {hoveredBucket
            ? `Cost ${hoveredBucket.label}: ${hoveredBucket.count} cards (${hoveredBucket.pct}%)`
            : 'Tap bar to inspect'}
        </span>
      </div>

      {totalCards === 0 ? (
        <div className="py-6 px-4 rounded-xl bg-slate-50 border border-slate-200/80 text-center text-xs text-slate-500">
          Add cards to visualize quantity across each cost level.
        </div>
      ) : (
        <div className="w-full h-48 rounded-xl bg-slate-50/70 border border-slate-200/70 px-2 pt-3 pb-1">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={200}
            minHeight={160}
            initialDimension={{ width: 340, height: 184 }}
          >
            <BarChart
              data={costData}
              margin={{ top: 16, right: 8, left: -18, bottom: 0 }}
              onMouseLeave={() => setHoveredBucket(null)}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                tick={{ fill: '#475569', fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                width={36}
                tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const datum = payload[0]?.payload as RechartsCostBucketDatum | undefined;
                  if (!datum) return null;
                  return (
                    <div className="rounded-xl bg-white border border-slate-200 shadow-lg px-3 py-2 text-xs space-y-1">
                      <div className="font-semibold text-slate-900">
                        Cost {datum.label}{' '}
                        <span className="font-mono text-slate-600 tabular-nums">
                          · {datum.count} {datum.count === 1 ? 'card' : 'cards'} ({datum.pct}%)
                        </span>
                      </div>
                      {datum.byColor.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {datum.byColor.map((seg) => (
                            <span
                              key={seg.color}
                              className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-700"
                            >
                              <SymbolIcon color={seg.color} size="xs" variant="gem" />
                              <span>{seg.count}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="count"
                radius={[5, 5, 0, 0]}
                maxBarSize={32}
                isAnimationActive={false}
                className="cursor-pointer"
                onClick={(barData) => {
                  const payload = (barData as unknown as { payload?: RechartsCostBucketDatum })
                    ?.payload || (barData as unknown as RechartsCostBucketDatum);
                  if (payload && typeof payload.bucket === 'number') {
                    onSelectCostBucket(
                      selectedCostBucket === payload.bucket ? null : payload.bucket
                    );
                  }
                }}
                onMouseEnter={(barData) => {
                  const payload = (barData as unknown as { payload?: RechartsCostBucketDatum })
                    ?.payload || (barData as unknown as RechartsCostBucketDatum);
                  if (payload && typeof payload.bucket === 'number') {
                    setHoveredBucket(payload);
                  }
                }}
              >
                {costData.map((entry) => {
                  const isSelected = selectedCostBucket === entry.bucket;
                  return (
                    <Cell
                      key={`cost-cell-${entry.bucket}`}
                      fill={entry.count > 0 ? entry.dominantHex : '#e2e8f0'}
                      fillOpacity={entry.count === 0 ? 0.5 : isSelected ? 1 : 0.88}
                      stroke={isSelected ? '#0f172a' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                    />
                  );
                })}
                <LabelList
                  dataKey="count"
                  position="top"
                  formatter={(v: unknown) => {
                    const num = Number(v) || 0;
                    return num > 0 ? String(num) : '';
                  }}
                  style={{
                    fill: '#0f172a',
                    fontSize: '10px',
                    fontWeight: 700,
                    fontFamily: 'ui-monospace, monospace',
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {activeBucketDetail && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-900">
              Cost {activeBucketDetail.label} Cards
            </span>
            <span className="font-mono text-slate-600 tabular-nums">
              {activeBucketDetail.count} cards ({activeBucketDetail.pct}%)
            </span>
          </div>
          {activeBucketDetail.cards.length === 0 ? (
            <p className="text-xs text-slate-500">No cards at this cost in deck.</p>
          ) : (
            <ul className="space-y-1.5">
              {activeBucketDetail.cards.map(({ card, quantity }) => (
                <li
                  key={card.id}
                  className="flex items-center justify-between gap-2 text-xs text-slate-700"
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <SymbolIcon color={card.color} size="xs" variant="gem" />
                    <span className="truncate">{card.name}</span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums shrink-0">
                    ×{quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
