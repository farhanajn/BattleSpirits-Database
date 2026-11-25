import React from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Search, X } from 'lucide-react';
import { CardRarity, CardType, FilterState, FormatFilter, SetCategory } from '../types/card';
import { ALL_COLORS, ALL_RARITIES, ALL_TYPES, COLOR_META } from '../data/theme';
import { SymbolIcon } from './SymbolIcon';
import { normalizeSetIdentifier, sortSetsForFilterDropdown } from '../utils/setMetadataSync';
import {
  canonicalizeFamilyLabel,
  COST_BRACKET_OPTIONS,
} from '../utils/cardFilterNormalization';

interface SetOption {
  setCode: string;
  name: string;
  category?: SetCategory;
}

type FilterCategoryKey =
  | 'format'
  | 'version'
  | 'color'
  | 'type'
  | 'cost'
  | 'rarity'
  | 'set'
  | 'family'
  | 'keyword'
  | 'sort';

interface FilterCategoryMeta {
  key: FilterCategoryKey;
  label: string;
  searchTerms: string;
}

const FILTER_CATEGORY_METADATA: FilterCategoryMeta[] = [
  { key: 'format', label: 'Game Format', searchTerms: 'game format standard eternal' },
  { key: 'version', label: 'Card Version', searchTerms: 'card version revival original non-revival' },
  {
    key: 'color',
    label: 'Attribute Color',
    searchTerms: 'attribute color red purple white yellow green blue multi-color multicolor',
  },
  {
    key: 'type',
    label: 'Card Type',
    searchTerms: 'card type spirit ultimate brave nexus magic',
  },
  {
    key: 'cost',
    label: 'Cost Bracket',
    searchTerms: 'cost bracket mana 0 1 2 3 4 5 6 7 8 9 10+',
  },
  { key: 'rarity', label: 'Rarity', searchTerms: 'rarity c u r m x xx cx nx ax tx xv p' },
  {
    key: 'set',
    label: 'Expansion Set',
    searchTerms: 'expansion set booster starter collab supplementary pb pc bs sd cb',
  },
  { key: 'family', label: 'Card Family', searchTerms: 'card family trait families' },
  { key: 'keyword', label: 'Keyword / Mechanic', searchTerms: 'keyword mechanic ability' },
  { key: 'sort', label: 'Sort By', searchTerms: 'sort by order relevance best match newest rarity cost bp name' },
];

interface FilterControlsProps {
  filters: FilterState;
  availableSets: SetOption[];
  availableFamilies: string[];
  availableKeywords: string[];
  onChange: (next: FilterState) => void;
  onReset: () => void;
}

export const FilterControls: React.FC<FilterControlsProps> = ({
  filters,
  availableSets,
  availableFamilies,
  availableKeywords,
  onChange,
  onReset,
}) => {
  const [categoryQuery, setCategoryQuery] = React.useState('');
  const [collapsedCategories, setCollapsedCategories] = React.useState<
    Partial<Record<FilterCategoryKey, boolean>>
  >({});
  const categoryRefs = React.useRef<Partial<Record<FilterCategoryKey, HTMLDivElement | null>>>({});

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

  const selectedFamilyValue = React.useMemo(() => {
    if (!filters.family || filters.family === 'All') return 'All';
    const targetCanonical = canonicalizeFamilyLabel(filters.family).toLowerCase();
    const matched = availableFamilies.find((f) => f.toLowerCase() === targetCanonical);
    return matched || filters.family;
  }, [filters.family, availableFamilies]);

  const matchingCategories = React.useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return [];
    return FILTER_CATEGORY_METADATA.filter(
      (meta) => meta.label.toLowerCase().includes(q) || meta.searchTerms.includes(q)
    );
  }, [categoryQuery]);

  const highlightedCategoryKeys = React.useMemo(
    () => new Set(matchingCategories.map((c) => c.key)),
    [matchingCategories]
  );

  const toggleCategoryCollapse = (key: FilterCategoryKey) => {
    setCollapsedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const jumpToCategory = (key: FilterCategoryKey) => {
    setCollapsedCategories((prev) => ({ ...prev, [key]: false }));
    const el = categoryRefs.current[key];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const getSectionContainerProps = (key: FilterCategoryKey) => {
    const highlighted = highlightedCategoryKeys.has(key);
    return {
      ref: (el: HTMLDivElement | null) => {
        categoryRefs.current[key] = el;
      },
      'data-filter-category': key,
      'data-highlighted': highlighted ? 'true' : 'false',
      className: highlighted
        ? 'rounded-xl p-2 -mx-2 bg-red-50/70 ring-2 ring-red-500/35 transition-colors'
        : 'transition-colors',
    };
  };

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
      {/* Quick Search for Filter Categories */}
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="filter-category-search"
            type="search"
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
            placeholder="Find filter category (Set, Cost, Color...)"
            aria-label="Find filter category"
            className="w-full min-h-[40px] lg:min-h-[34px] pl-8 pr-8 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          {categoryQuery && (
            <button
              type="button"
              onClick={() => setCategoryQuery('')}
              aria-label="Clear filter category search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {categoryQuery.trim() && (
          <div className="flex flex-wrap items-center gap-1.5">
            {matchingCategories.length > 0 ? (
              matchingCategories.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => jumpToCategory(cat.key)}
                  className="px-2 py-1 rounded-lg bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 transition-colors cursor-pointer"
                >
                  {cat.label}
                </button>
              ))
            ) : (
              <span className="text-[11px] text-slate-500">No matching filter category.</span>
            )}
          </div>
        )}
      </div>

      <div {...getSectionContainerProps('format')}>
        <button
          type="button"
          onClick={() => toggleCategoryCollapse('format')}
          aria-expanded={!collapsedCategories.format}
          className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 mb-1.5 cursor-pointer hover:text-slate-800"
        >
          <span>Game Format</span>
          {collapsedCategories.format ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        {!collapsedCategories.format && (
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
        )}
      </div>

      <div {...getSectionContainerProps('version')}>
        <button
          type="button"
          onClick={() => toggleCategoryCollapse('version')}
          aria-expanded={!collapsedCategories.version}
          className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 mb-1.5 cursor-pointer hover:text-slate-800"
        >
          <span>Card Version</span>
          {collapsedCategories.version ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        {!collapsedCategories.version && (
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
        )}
      </div>

      <div {...getSectionContainerProps('color')}>
        <button
          type="button"
          onClick={() => toggleCategoryCollapse('color')}
          aria-expanded={!collapsedCategories.color}
          className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 mb-1.5 cursor-pointer hover:text-slate-800"
        >
          <span>Attribute Color</span>
          {collapsedCategories.color ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        {!collapsedCategories.color && (
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
        )}
      </div>

      <div {...getSectionContainerProps('type')}>
        <div className="flex items-center justify-between mb-1.5">
          <button
            type="button"
            onClick={() => toggleCategoryCollapse('type')}
            aria-expanded={!collapsedCategories.type}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-800"
          >
            <span>Card Type</span>
            {collapsedCategories.type ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
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
        {!collapsedCategories.type && (
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
        )}
      </div>

      <div {...getSectionContainerProps('cost')}>
        <div className="flex items-center justify-between mb-1.5">
          <button
            type="button"
            onClick={() => toggleCategoryCollapse('cost')}
            aria-expanded={!collapsedCategories.cost}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-800"
          >
            <span>Cost Bracket</span>
            {collapsedCategories.cost ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          {filters.costBracket !== 'All' && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, costBracket: 'All' })}
              className="text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
            >
              Clear ({filters.costBracket})
            </button>
          )}
        </div>
        {!collapsedCategories.cost && (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-4 gap-1.5">
            {COST_BRACKET_OPTIONS.map((bracket) => (
              <button
                key={bracket}
                type="button"
                onClick={() => onChange({ ...filters, costBracket: bracket })}
                aria-pressed={filters.costBracket === bracket}
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
        )}
      </div>

      <div {...getSectionContainerProps('rarity')}>
        <div className="flex items-center justify-between mb-1.5">
          <button
            type="button"
            onClick={() => toggleCategoryCollapse('rarity')}
            aria-expanded={!collapsedCategories.rarity}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-800"
          >
            <span>Rarity</span>
            {collapsedCategories.rarity ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
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
        {!collapsedCategories.rarity && (
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
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
        <div {...getSectionContainerProps('set')}>
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

        <div {...getSectionContainerProps('family')}>
          <label htmlFor="filter-family" className="block text-xs font-semibold text-slate-500 mb-1">
            Card Family
          </label>
          <select
            id="filter-family"
            value={selectedFamilyValue}
            onChange={(e) => onChange({ ...filters, family: e.target.value })}
            className="w-full min-h-[44px] lg:min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white text-sm lg:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="All">All Families</option>
            {availableFamilies.map((fam) => (
              <option key={fam} value={fam}>
                {fam}
              </option>
            ))}
          </select>
        </div>

        <div {...getSectionContainerProps('keyword')}>
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

        <div {...getSectionContainerProps('sort')}>
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
            <option value="relevance">Best Match (Relevance)</option>
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
