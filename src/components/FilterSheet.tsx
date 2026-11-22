import React from 'react';
import { X, RotateCcw } from 'lucide-react';
import { CardRarity, CardType, FilterState, FormatFilter, SetCategory } from '../types/card';
import { ALL_COLORS, ALL_RARITIES, ALL_TYPES, COLOR_META } from '../data/theme';
import { SymbolIcon } from './SymbolIcon';
import { normalizeSetIdentifier, sortSetsForFilterDropdown } from '../utils/setMetadataSync';

interface SetOption {
  setCode: string;
  name: string;
  category?: SetCategory;
}

interface FilterControlsProps {
  filters: FilterState;
  availableSets: SetOption[];
  availableKeywords: string[];
  onChange: (next: FilterState) => void;
  onReset: () => void;
}

export const FilterControls: React.FC<FilterControlsProps> = ({
  filters,
  availableSets,
  availableKeywords,
  onChange,
  onReset,
}) => {
  const sortedSets = React.useMemo(
    () => sortSetsForFilterDropdown(availableSets),
    [availableSets]
  );

  const selectedSetValue = React.useMemo(() => {
    if (!filters.setCode || filters.setCode === 'All') return 'All';
    const targetNorm = normalizeSetIdentifier(filters.setCode);
    const matched = sortedSets.find(
      (s) => s.setCode === filters.setCode || normalizeSetIdentifier(s.setCode) === targetNorm
    );
    return matched ? matched.setCode : filters.setCode;
  }, [filters.setCode, sortedSets]);

  const toggleType = (target: CardType) => {
    const exists = filters.type.includes(target);
    const nextTypes = exists
      ? filters.type.filter((item) => item !== target)
      : [...filters.type, target];
    onChange({ ...filters, type: nextTypes });
  };

  const toggleRarity = (target: CardRarity) => {
    const exists = filters.rarity.includes(target);
    const nextRarities = exists
      ? filters.rarity.filter((item) => item !== target)
      : [...filters.rarity, target];
    onChange({ ...filters, rarity: nextRarities });
  };

  return (
    <div className="space-y-4 lg:space-y-3.5">
      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1.5">Game Format</div>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
          {(['All', 'Standard', 'Eternal'] as FormatFilter[]).map((fmt) => {
            const active = filters.format === fmt;
            return (
              <button
                key={fmt}
                type="button"
                onClick={() => onChange({ ...filters, format: fmt })}
                className={`min-h-[44px] lg:min-h-[36px] px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? fmt === 'Standard'
                      ? 'bg-sky-700 text-white shadow-sm'
                      : fmt === 'Eternal'
                      ? 'bg-amber-700 text-white shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {fmt}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1.5">Card Version</div>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
          {(
            [
              { id: 'All', label: 'All' },
              { id: 'Original', label: 'Non-Revival' },
              { id: 'Revival', label: 'Revival' },
            ] as const
          ).map((ver) => {
            const active = filters.version === ver.id;
            return (
              <button
                key={ver.id}
                type="button"
                onClick={() => onChange({ ...filters, version: ver.id })}
                className={`min-h-[44px] lg:min-h-[36px] px-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? ver.id === 'Revival'
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {ver.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1.5">Attribute Color</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...filters, color: 'All' })}
            className={`min-h-[44px] lg:min-h-[36px] px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
              filters.color === 'All'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...filters,
                color: filters.color === 'Multicolor' ? 'All' : 'Multicolor',
              })
            }
            className={`min-h-[44px] lg:min-h-[36px] px-2.5 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              filters.color === 'Multicolor'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
            }`}
          >
            <span className="inline-flex items-center -space-x-1">
              <SymbolIcon color="Red" size="xs" variant="gem" />
              <SymbolIcon color="Blue" size="xs" variant="gem" />
            </span>
            <span>Multi-Color</span>
          </button>
          {ALL_COLORS.map((color) => {
            const active = filters.color === color;
            const meta = COLOR_META[color];
            return (
              <button
                key={color}
                type="button"
                onClick={() => onChange({ ...filters, color: active ? 'All' : color })}
                className={`min-h-[44px] lg:min-h-[36px] px-2.5 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <SymbolIcon color={color} size="xs" variant="gem" />
                <span className={active ? 'text-white' : meta.text}>{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-slate-500">Card Type</span>
          {filters.type.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, type: [] })}
              className="text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
            >
              Clear ({filters.type.length})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...filters, type: [] })}
            aria-pressed={filters.type.length === 0}
            className={`min-h-[44px] lg:min-h-[34px] px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
              filters.type.length === 0
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            All
          </button>
          {ALL_TYPES.map((t) => {
            const selected = filters.type.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                aria-pressed={selected}
                className={`min-h-[44px] lg:min-h-[34px] px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1.5">Cost Bracket</div>
        <div className="grid grid-cols-5 lg:grid-cols-3 gap-1.5">
          {(['All', '0-2', '3-4', '5-6', '7+'] as const).map((bracket) => (
            <button
              key={bracket}
              type="button"
              onClick={() => onChange({ ...filters, costBracket: bracket })}
              className={`min-h-[44px] lg:min-h-[34px] px-2 rounded-xl text-xs font-semibold font-mono tabular-nums border transition-colors cursor-pointer ${
                filters.costBracket === bracket
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
            >
              {bracket}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-slate-500">Rarity</span>
          {filters.rarity.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, rarity: [] })}
              className="text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
            >
              Clear ({filters.rarity.length})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...filters, rarity: [] })}
            aria-pressed={filters.rarity.length === 0}
            className={`min-h-[44px] min-w-[44px] lg:min-h-[32px] lg:min-w-[36px] px-2.5 rounded-xl text-xs font-semibold font-mono border transition-colors cursor-pointer ${
              filters.rarity.length === 0
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            All
          </button>
          {ALL_RARITIES.map((r) => {
            const selected = filters.rarity.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => toggleRarity(r)}
                aria-pressed={selected}
                className={`min-h-[44px] min-w-[44px] lg:min-h-[32px] lg:min-w-[36px] px-2.5 rounded-xl text-xs font-semibold font-mono border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
        <div>
          <label htmlFor="filter-set" className="block text-xs font-semibold text-slate-500 mb-1">
            Expansion Set
          </label>
          <select
            id="filter-set"
            value={selectedSetValue}
            onChange={(e) => onChange({ ...filters, setCode: e.target.value })}
            className="w-full min-h-[44px] lg:min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white text-sm lg:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="All">All Sets</option>
            {sortedSets.map((s) => {
              const cleanName = (s.name || '').trim();
              const hasDistinctName =
                Boolean(cleanName) && cleanName.toUpperCase() !== s.setCode.trim().toUpperCase();
              return (
                <option key={s.setCode} value={s.setCode}>
                  {hasDistinctName ? `${s.setCode} — ${cleanName}` : s.setCode}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label htmlFor="filter-keyword" className="block text-xs font-semibold text-slate-500 mb-1">
            Keyword / Mechanic
          </label>
          <select
            id="filter-keyword"
            value={filters.keyword}
            onChange={(e) => onChange({ ...filters, keyword: e.target.value })}
            className="w-full min-h-[44px] lg:min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white text-sm lg:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="All">All Mechanics</option>
            {availableKeywords.map((kw) => (
              <option key={kw} value={kw}>
                {kw}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-sort" className="block text-xs font-semibold text-slate-500 mb-1">
            Sort By
          </label>
          <select
            id="filter-sort"
            value={filters.sortBy}
            onChange={(e) =>
              onChange({ ...filters, sortBy: e.target.value as FilterState['sortBy'] })
            }
            className="w-full min-h-[44px] lg:min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white text-sm lg:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="number">Set &amp; Card Number</option>
            <option value="newest">Newest Release</option>
            <option value="rarity-desc">Highest Rarity</option>
            <option value="color">Color</option>
            <option value="cost-asc">Cost: Low to High</option>
            <option value="cost-desc">Cost: High to Low</option>
            <option value="bp-desc">Highest Max BP</option>
            <option value="name">Alphabetical (A–Z)</option>
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="w-full min-h-[44px] lg:min-h-[38px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span>Reset All Filters</span>
      </button>
    </div>
  );
};

interface FilterSheetProps extends FilterControlsProps {
  open: boolean;
  resultCount: number;
  onClose: () => void;
}

export const FilterSheet: React.FC<FilterSheetProps> = ({
  open,
  resultCount,
  onClose,
  ...controlProps
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden flex items-end bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Filter cards"
      onClick={onClose}
    >
      <div
        className="w-full max-h-[88vh] bg-white rounded-t-3xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-3 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1.5 bg-slate-300 rounded-full" />
        </div>

        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h2 className="font-display text-base font-bold text-slate-900">
            Filter Catalog
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
            aria-label="Close filters"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4">
          <FilterControls {...controlProps} />
        </div>

        <div className="px-4 py-3 pb-safe border-t border-slate-200 bg-white shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-12 rounded-xl bg-slate-900 text-white font-semibold text-sm flex items-center justify-center cursor-pointer active:scale-[0.99] transition-transform"
          >
            Show {resultCount} {resultCount === 1 ? 'Card' : 'Cards'}
          </button>
        </div>
      </div>
    </div>
  );
};
