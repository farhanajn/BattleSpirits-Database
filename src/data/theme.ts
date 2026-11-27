import { BattleSymbolKind, CardColor, CardRarity, CardType } from '../types/card';

export interface ColorMeta {
  label: string;
  hex: string;
  softBg: string;
  border: string;
  text: string;
  darkText: string;
  gradient: string;
}

export const COLOR_META: Record<CardColor, ColorMeta> = {
  Red: {
    label: 'Red',
    hex: '#D92D20',
    softBg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    darkText: 'text-red-900',
    gradient: 'from-red-950 via-red-800 to-orange-700',
  },
  Purple: {
    label: 'Purple',
    hex: '#7A2E8E',
    softBg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    darkText: 'text-purple-950',
    gradient: 'from-purple-950 via-purple-800 to-fuchsia-900',
  },
  White: {
    label: 'White',
    hex: '#475467',
    softBg: 'bg-slate-100',
    border: 'border-slate-300',
    text: 'text-slate-700',
    darkText: 'text-slate-900',
    gradient: 'from-slate-800 via-slate-600 to-sky-700',
  },
  Yellow: {
    label: 'Yellow',
    hex: '#CA8A04',
    softBg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    darkText: 'text-amber-950',
    gradient: 'from-amber-900 via-amber-600 to-yellow-500',
  },
  Green: {
    label: 'Green',
    hex: '#15803D',
    softBg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    darkText: 'text-emerald-950',
    gradient: 'from-emerald-950 via-emerald-700 to-teal-700',
  },
  Blue: {
    label: 'Blue',
    hex: '#1D4ED8',
    softBg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    darkText: 'text-blue-950',
    gradient: 'from-blue-950 via-blue-800 to-cyan-700',
  },
};

export const SYMBOL_META: Record<
  BattleSymbolKind,
  {
    label: string;
    hex: string;
    text: string;
    image: string;
  }
> = {
  Red: {
    label: 'Red',
    hex: '#D92D20',
    text: 'text-red-700',
    image: '/assets/symbols/red.png',
  },
  Purple: {
    label: 'Purple',
    hex: '#7A2E8E',
    text: 'text-purple-700',
    image: '/assets/symbols/purple.png',
  },
  White: {
    label: 'White',
    hex: '#475467',
    text: 'text-slate-700',
    image: '/assets/symbols/white.png',
  },
  Yellow: {
    label: 'Yellow',
    hex: '#CA8A04',
    text: 'text-amber-700',
    image: '/assets/symbols/yellow.png',
  },
  Green: {
    label: 'Green',
    hex: '#15803D',
    text: 'text-emerald-700',
    image: '/assets/symbols/green.png',
  },
  Blue: {
    label: 'Blue',
    hex: '#1D4ED8',
    text: 'text-blue-700',
    image: '/assets/symbols/blue.png',
  },
  God: {
    label: 'God',
    hex: '#0D9488',
    text: 'text-teal-700',
    image: '/assets/symbols/god.png',
  },
  Ultimate: {
    label: 'Ultimate',
    hex: '#B45309',
    text: 'text-amber-700',
    image: '/assets/symbols/ultimate.png',
  },
};

export const ALL_COLORS: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];
export const ALL_SYMBOLS: BattleSymbolKind[] = [
  'Red',
  'Purple',
  'White',
  'Yellow',
  'Green',
  'Blue',
  'God',
  'Ultimate',
];
export const ALL_TYPES: CardType[] = ['Spirit', 'Ultimate', 'Brave', 'Nexus', 'Magic'];
export const ALL_RARITIES: CardRarity[] = ['C', 'U', 'R', 'M', 'X', 'XX', 'CX', 'NX', 'AX', 'TX', 'XV', 'P'];
