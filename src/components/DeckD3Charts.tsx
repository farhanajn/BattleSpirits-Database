import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BattleSpiritsCard, CardColor } from '../types/card';
import { ALL_COLORS, COLOR_META } from '../data/theme';
import { SymbolIcon } from './SymbolIcon';

export interface CostBucketSummary {
  bucket: number;
  total: number;
  byColor: { color: CardColor; count: number }[];
  cards: { card: BattleSpiritsCard; quantity: number }[];
}

interface DeckD3ChartsProps {
  resolvedEntries: { card: BattleSpiritsCard; quantity: number }[];
  totalCards: number;
  selectedCostBucket: number | null;
  onSelectCostBucket: (bucket: number | null) => void;
}

const VALID_COLOR_SET = new Set<CardColor>(ALL_COLORS);

function getCardColorList(card: BattleSpiritsCard): CardColor[] {
  const candidates: CardColor[] = [];
  if (Array.isArray(card.colors) && card.colors.length > 0) {
    for (const c of card.colors) {
      if (VALID_COLOR_SET.has(c) && !candidates.includes(c)) {
        candidates.push(c);
      }
    }
  }
  if (candidates.length === 0) {
    if (card.color && VALID_COLOR_SET.has(card.color)) {
      candidates.push(card.color);
    }
    if (
      card.secondaryColor &&
      VALID_COLOR_SET.has(card.secondaryColor) &&
      card.secondaryColor !== card.color
    ) {
      candidates.push(card.secondaryColor);
    }
  }
  return candidates.length > 0 ? candidates : ['Red'];
}

export const DeckD3Charts: React.FC<DeckD3ChartsProps> = ({
  resolvedEntries,
  totalCards,
  selectedCostBucket,
  onSelectCostBucket,
}) => {
  const curveContainerRef = useRef<HTMLDivElement>(null);
  const curveSvgRef = useRef<SVGSVGElement>(null);
  const colorContainerRef = useRef<HTMLDivElement>(null);
  const colorSvgRef = useRef<SVGSVGElement>(null);

  const [curveWidth, setCurveWidth] = useState(380);
  const [colorWidth, setColorWidth] = useState(380);
  const [hoveredCost, setHoveredCost] = useState<CostBucketSummary | null>(null);
  const [hoveredColor, setHoveredColor] = useState<{
    color: CardColor;
    count: number;
    pct: number;
  } | null>(null);

  // Measure containers responsively so D3 axes & bars adapt smoothly on phone & desktop
  useEffect(() => {
    const observers: ResizeObserver[] = [];

    if (curveContainerRef.current) {
      const obs = new ResizeObserver((entries) => {
        const w = Math.floor(entries[0]?.contentRect.width || 380);
        if (w > 120) setCurveWidth(w);
      });
      obs.observe(curveContainerRef.current);
      observers.push(obs);
    }

    if (colorContainerRef.current) {
      const obs = new ResizeObserver((entries) => {
        const w = Math.floor(entries[0]?.contentRect.width || 380);
        if (w > 120) setColorWidth(w);
      });
      obs.observe(colorContainerRef.current);
      observers.push(obs);
    }

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const costBreakdown = useMemo<CostBucketSummary[]>(() => {
    const buckets = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    return buckets.map((bucket) => {
      const matching = resolvedEntries.filter(({ card }) => {
        const c = Number.isFinite(Number(card.cost)) ? Number(card.cost) : 0;
        return bucket === 8 ? c >= 8 : c === bucket;
      });
      const total = matching.reduce(
        (sum, item) => sum + (Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0),
        0
      );
      const byColor = ALL_COLORS.map((color) => ({
        color,
        count: matching
          .filter((item) => getCardColorList(item.card)[0] === color)
          .reduce(
            (sum, item) =>
              sum + (Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0),
            0
          ),
      })).filter((c) => c.count > 0);
      return { bucket, total, byColor, cards: matching };
    });
  }, [resolvedEntries]);

  const colorStats = useMemo(() => {
    const counts = ALL_COLORS.reduce((acc, c) => {
      acc[c] = 0;
      return acc;
    }, {} as Record<CardColor, number>);

    let hasMulticolor = false;
    for (const { card, quantity } of resolvedEntries) {
      const safeQty = Number.isFinite(Number(quantity)) ? Number(quantity) : 0;
      const cardColors = getCardColorList(card);
      if (cardColors.length > 1) hasMulticolor = true;
      for (const c of cardColors) {
        if (c in counts) counts[c] += safeQty;
      }
    }

    const safeTotal = totalCards > 0 ? totalCards : 0;
    const items = ALL_COLORS.map((color) => ({
      color,
      count: counts[color],
      pct: safeTotal > 0 ? Math.round((counts[color] / safeTotal) * 100) : 0,
      hex: (COLOR_META[color] || COLOR_META.Red).hex,
    }));

    return { counts, items, hasMulticolor };
  }, [resolvedEntries, totalCards]);

  // 1. D3 Mana Curve Dynamic Stacked Bar Chart
  useEffect(() => {
    const svgEl = curveSvgRef.current;
    if (!svgEl) return;

    const width = Math.max(240, Number.isFinite(curveWidth) ? curveWidth : 380);
    const height = 184;
    const margin = { top: 22, right: 10, bottom: 26, left: 26 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(svgEl)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', height);

    let root = svg.select<SVGGElement>('g.d3-curve-root');
    if (root.empty()) {
      root = svg.append('g').attr('class', 'd3-curve-root');
      root.append('g').attr('class', 'd3-grid');
      root.append('g').attr('class', 'd3-x-axis');
      root.append('g').attr('class', 'd3-y-axis');
      root.append('g').attr('class', 'd3-bars');
    }
    root.attr('transform', `translate(${margin.left},${margin.top})`);

    const labels = costBreakdown.map((b) => (b.bucket === 8 ? '8+' : String(b.bucket)));
    const maxVal = Math.max(4, ...costBreakdown.map((b) => b.total));

    const x = d3.scaleBand().domain(labels).range([0, innerWidth]).padding(0.24);
    const y = d3.scaleLinear().domain([0, maxVal]).nice(4).range([innerHeight, 0]);

    // Horizontal dashed gridlines
    const gridAxis = d3
      .axisLeft(y)
      .ticks(4)
      .tickSize(-innerWidth)
      .tickFormat(() => '');

    root
      .select<SVGGElement>('g.d3-grid')
      .call(gridAxis)
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g
          .selectAll('line')
          .attr('stroke', '#e2e8f0')
          .attr('stroke-dasharray', '3,3')
      );

    // Y axis (updated synchronously on selection so tick/domain cleanup never races a D3 transition)
    root
      .select<SVGGElement>('g.d3-y-axis')
      .interrupt()
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((d) => (Number.isInteger(Number(d)) ? String(d) : ''))
      )
      .call((g) => g.select('.domain').remove())
      .call((g) => g.selectAll('.tick line').remove())
      .call((g) =>
        g
          .selectAll('text')
          .attr('fill', '#64748b')
          .attr('font-size', '10px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
      );

    // X axis
    root
      .select<SVGGElement>('g.d3-x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickSize(0))
      .call((g) => g.select('.domain').attr('stroke', '#cbd5e1'))
      .call((g) =>
        g
          .selectAll('text')
          .attr('dy', '1.1em')
          .attr('fill', (label) => {
            const b = label === '8+' ? 8 : Number(label);
            return selectedCostBucket === b ? '#0f172a' : '#64748b';
          })
          .attr('font-weight', (label) => {
            const b = label === '8+' ? 8 : Number(label);
            return selectedCostBucket === b ? '700' : '500';
          })
          .attr('font-size', '11px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
      );

    const barsLayer = root.select<SVGGElement>('g.d3-bars');

    const groups = barsLayer
      .selectAll<SVGGElement, CostBucketSummary>('g.d3-cost-col')
      .data(costBreakdown, (d) => String(d.bucket))
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', 'd3-cost-col').style('cursor', 'pointer');
          g.append('rect').attr('class', 'd3-col-highlight');
          g.append('rect').attr('class', 'd3-empty-tick');
          g.append('g').attr('class', 'd3-segments');
          g.append('text').attr('class', 'd3-bar-label').attr('y', innerHeight);
          g.append('rect').attr('class', 'd3-hit-area').attr('fill', 'transparent');
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      );

    groups.each(function (d) {
      const col = d3.select(this);
      const key = d.bucket === 8 ? '8+' : String(d.bucket);
      const bx = x(key) ?? 0;
      const bw = x.bandwidth();
      const isSelected = selectedCostBucket === d.bucket;

      col
        .select<SVGRectElement>('rect.d3-col-highlight')
        .attr('x', bx - 3)
        .attr('y', -4)
        .attr('width', bw + 6)
        .attr('height', innerHeight + 4)
        .attr('rx', 6)
        .attr('fill', isSelected ? 'rgba(15, 23, 42, 0.06)' : 'transparent')
        .attr('stroke', isSelected ? '#0f172a' : 'none')
        .attr('stroke-width', isSelected ? 1.25 : 0);

      // Baseline stub when 0
      col
        .select<SVGRectElement>('rect.d3-empty-tick')
        .attr('x', bx)
        .attr('y', innerHeight - 3)
        .attr('width', bw)
        .attr('height', d.total === 0 ? 3 : 0)
        .attr('rx', 1.5)
        .attr('fill', '#e2e8f0');

      // Stacked color segments
      let cumulative = 0;
      const segments = d.byColor.map((seg) => {
        const y0 = cumulative;
        cumulative += seg.count;
        const y1 = cumulative;
        return {
          color: seg.color,
          count: seg.count,
          hex: COLOR_META[seg.color].hex,
          yTop: y(y1),
          segHeight: Math.max(2, y(y0) - y(y1)),
          isTop: y1 === d.total,
        };
      });

      col
        .select<SVGGElement>('g.d3-segments')
        .selectAll<SVGRectElement, (typeof segments)[number]>('rect.d3-seg')
        .data(segments, (s) => s.color)
        .join(
          (enter) =>
            enter
              .append('rect')
              .attr('class', 'd3-seg')
              .attr('x', bx)
              .attr('width', bw)
              .attr('y', innerHeight)
              .attr('height', 0)
              .attr('fill', (s) => s.hex)
              .attr('rx', (s) => (s.isTop ? 3 : 0)),
          (update) => update,
          (exit) =>
            exit
              .interrupt()
              .transition()
              .duration(180)
              .attr('y', innerHeight)
              .attr('height', 0)
              .remove()
        )
        .interrupt()
        .transition()
        .duration(250)
        .ease(d3.easeCubicOut)
        .attr('x', bx)
        .attr('width', bw)
        .attr('y', (s) => s.yTop)
        .attr('height', (s) => s.segHeight)
        .attr('fill', (s) => s.hex)
        .attr('rx', (s) => (s.isTop ? 3 : 0));

      // Count label above bar
      col
        .select<SVGTextElement>('text.d3-bar-label')
        .interrupt()
        .attr('x', bx + bw / 2)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('font-weight', '700')
        .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
        .attr('fill', isSelected ? '#b91c1c' : '#0f172a')
        .text(d.total > 0 ? String(d.total) : '')
        .transition()
        .duration(250)
        .ease(d3.easeCubicOut)
        .attr('y', Math.max(10, y(d.total) - 5));

      // Invisible full-column click/hover hitbox
      col
        .select<SVGRectElement>('rect.d3-hit-area')
        .attr('x', bx - 3)
        .attr('y', -4)
        .attr('width', bw + 6)
        .attr('height', innerHeight + 24);
    });

    groups
      .on('click', (_event, d) => {
        onSelectCostBucket(selectedCostBucket === d.bucket ? null : d.bucket);
      })
      .on('mouseenter', (_event, d) => setHoveredCost(d))
      .on('mouseleave', () => setHoveredCost(null));
  }, [costBreakdown, curveWidth, selectedCostBucket, onSelectCostBucket]);

  // 2. D3 Color Distribution Dynamic Bar Chart
  useEffect(() => {
    const svgEl = colorSvgRef.current;
    if (!svgEl) return;

    const width = Math.max(240, Number.isFinite(colorWidth) ? colorWidth : 380);
    const height = 166;
    const margin = { top: 22, right: 10, bottom: 26, left: 26 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(svgEl)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', height);

    let root = svg.select<SVGGElement>('g.d3-color-root');
    if (root.empty()) {
      root = svg.append('g').attr('class', 'd3-color-root');
      root.append('g').attr('class', 'd3-color-grid');
      root.append('g').attr('class', 'd3-color-x-axis');
      root.append('g').attr('class', 'd3-color-y-axis');
      root.append('g').attr('class', 'd3-color-bars');
    }
    root.attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand<CardColor>()
      .domain(ALL_COLORS)
      .range([0, innerWidth])
      .padding(0.28);

    const maxCount = Math.max(4, ...colorStats.items.map((d) => d.count));
    const y = d3.scaleLinear().domain([0, maxCount]).nice(4).range([innerHeight, 0]);

    root
      .select<SVGGElement>('g.d3-color-grid')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g
          .selectAll('line')
          .attr('stroke', '#e2e8f0')
          .attr('stroke-dasharray', '3,3')
      );

    root
      .select<SVGGElement>('g.d3-color-y-axis')
      .interrupt()
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((d) => (Number.isInteger(Number(d)) ? String(d) : ''))
      )
      .call((g) => g.select('.domain').remove())
      .call((g) => g.selectAll('.tick line').remove())
      .call((g) =>
        g
          .selectAll('text')
          .attr('fill', '#64748b')
          .attr('font-size', '10px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
      );

    root
      .select<SVGGElement>('g.d3-color-x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickSize(0))
      .call((g) => g.select('.domain').attr('stroke', '#cbd5e1'))
      .call((g) =>
        g
          .selectAll('text')
          .attr('dy', '1.1em')
          .attr('fill', '#334155')
          .attr('font-weight', '600')
          .attr('font-size', '11px')
      );

    const barsLayer = root.select<SVGGElement>('g.d3-color-bars');
    const cols = barsLayer
      .selectAll<SVGGElement, (typeof colorStats.items)[number]>('g.d3-color-col')
      .data(colorStats.items, (d) => d.color)
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', 'd3-color-col');
          g.append('rect')
            .attr('class', 'd3-color-rect')
            .attr('y', innerHeight)
            .attr('height', 0);
          g.append('rect').attr('class', 'd3-color-zero');
          g.append('text').attr('class', 'd3-color-label').attr('y', innerHeight);
          g.append('rect').attr('class', 'd3-color-hit').attr('fill', 'transparent');
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      );

    cols.each(function (d) {
      const col = d3.select(this);
      const bx = x(d.color) ?? 0;
      const bw = x.bandwidth();
      const targetY = d.count > 0 ? y(d.count) : innerHeight;
      const targetH = d.count > 0 ? Math.max(3, innerHeight - targetY) : 0;

      col
        .select<SVGRectElement>('rect.d3-color-rect')
        .interrupt()
        .attr('rx', 5)
        .attr('fill', d.hex)
        .transition()
        .duration(250)
        .ease(d3.easeCubicOut)
        .attr('x', bx)
        .attr('width', bw)
        .attr('y', targetY)
        .attr('height', targetH);

      col
        .select<SVGRectElement>('rect.d3-color-zero')
        .attr('x', bx)
        .attr('y', innerHeight - 3)
        .attr('width', bw)
        .attr('height', d.count === 0 ? 3 : 0)
        .attr('rx', 1.5)
        .attr('fill', '#e2e8f0');

      col
        .select<SVGTextElement>('text.d3-color-label')
        .interrupt()
        .attr('x', bx + bw / 2)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('font-weight', '700')
        .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
        .attr('fill', '#0f172a')
        .text(d.count > 0 ? `${d.count}` : '')
        .transition()
        .duration(250)
        .ease(d3.easeCubicOut)
        .attr('y', Math.max(10, targetY - 5));

      col
        .select<SVGRectElement>('rect.d3-color-hit')
        .attr('x', bx - 2)
        .attr('y', -4)
        .attr('width', bw + 4)
        .attr('height', innerHeight + 24);
    });

    cols
      .on('mouseenter', (_event, d) => setHoveredColor(d))
      .on('mouseleave', () => setHoveredColor(null));
  }, [colorStats, colorWidth]);

  const activeBucketDetail =
    selectedCostBucket !== null
      ? costBreakdown.find((b) => b.bucket === selectedCostBucket) || null
      : null;

  return (
    <div className="space-y-4 pt-2 border-t border-slate-100">
      {/* D3 Mana Curve Bar Chart */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-slate-700">
            Mana Curve (D3 Bar Chart)
          </span>
          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
            {hoveredCost
              ? `Cost ${hoveredCost.bucket === 8 ? '8+' : hoveredCost.bucket}: ${hoveredCost.total} cards`
              : 'Tap bar to inspect'}
          </span>
        </div>

        <div
          ref={curveContainerRef}
          className="w-full rounded-xl bg-slate-50/70 border border-slate-200/70 px-2 pt-2 pb-1 overflow-hidden"
        >
          <svg
            ref={curveSvgRef}
            role="img"
            aria-label="Dynamic D3 Mana Curve stacked bar chart by card cost and color"
            className="block w-full select-none"
          />
        </div>

        {activeBucketDetail && (
          <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">
                Cost {activeBucketDetail.bucket === 8 ? '8+' : activeBucketDetail.bucket} Cards
              </span>
              <span className="font-mono text-slate-600 tabular-nums">
                {activeBucketDetail.total} cards (
                {totalCards > 0
                  ? Math.round((activeBucketDetail.total / totalCards) * 100)
                  : 0}
                %)
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

      {/* D3 Color Distribution Bar Chart */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-slate-700">
            Color Distribution (D3 Bar Chart)
          </span>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {hoveredColor
              ? `${hoveredColor.color}: ${hoveredColor.count} (${hoveredColor.pct}%)`
              : colorStats.hasMulticolor
              ? `${totalCards} cards · multicolor counted per color`
              : `${totalCards} total`}
          </span>
        </div>

        <div
          ref={colorContainerRef}
          className="w-full rounded-xl bg-slate-50/70 border border-slate-200/70 px-2 pt-2 pb-1 overflow-hidden"
        >
          <svg
            ref={colorSvgRef}
            role="img"
            aria-label="Dynamic D3 bar chart of card color distribution in deck"
            className="block w-full select-none"
          />
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {colorStats.items
            .filter((item) => item.count > 0)
            .map((item) => (
              <div
                key={item.color}
                className="flex items-center justify-between text-slate-700"
              >
                <span className="inline-flex items-center gap-1.5">
                  <SymbolIcon color={item.color} size="xs" variant="gem" />
                  <span className={`font-semibold ${COLOR_META[item.color].text}`}>
                    {item.color}
                  </span>
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {item.count}{' '}
                  <span className="text-[11px] font-normal text-slate-400">
                    ({item.pct}%)
                  </span>
                </span>
              </div>
            ))}
          {colorStats.items.every((item) => item.count === 0) && (
            <div className="text-slate-400 col-span-2">No cards added yet</div>
          )}
        </div>
      </div>
    </div>
  );
};
