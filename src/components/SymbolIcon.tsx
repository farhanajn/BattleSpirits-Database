import React from 'react';
import { BattleSymbolKind, CardColor } from '../types/card';
import { COLOR_META, SYMBOL_META } from '../data/theme';

interface SymbolIconProps {
  color: BattleSymbolKind;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'reduction' | 'gem';
}

export const SymbolIcon: React.FC<SymbolIconProps> = ({
  color,
  size = 'sm',
  variant = 'reduction',
}) => {
  const meta = SYMBOL_META[color];
  const dim = size === 'xs' ? 'w-4 h-4' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  if (variant === 'reduction') {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 align-middle rounded-full bg-slate-900/90 ring-1 ring-white/45 p-[1.5px] shadow-xs ${dim}`}
        title={`${meta.label} Reduction Symbol`}
        aria-label={`${meta.label} Reduction Symbol`}
      >
        <img
          src={meta.image}
          alt=""
          className="w-full h-full object-contain select-none pointer-events-none"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 align-middle ${dim}`}
      title={`${meta.label} Card Symbol`}
      aria-label={`${meta.label} Card Symbol`}
    >
      <img
        src={meta.image}
        alt=""
        className="w-full h-full object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)] select-none pointer-events-none"
        draggable={false}
      />
    </span>
  );
};

interface ColorSymbolBadgeProps {
  color: CardColor;
  secondaryColor?: CardColor;
  colors?: CardColor[];
  variant?: 'reduction' | 'gem';
  size?: 'xs' | 'sm';
  showLabel?: boolean;
  suffix?: string;
}

export const ColorSymbolBadge: React.FC<ColorSymbolBadgeProps> = ({
  color,
  secondaryColor,
  colors,
  variant = 'gem',
  size = 'xs',
  showLabel = true,
  suffix,
}) => {
  const resolvedColors =
    colors && colors.length > 0
      ? colors
      : secondaryColor
      ? [color, secondaryColor]
      : [color];

  return (
    <span className="inline-flex items-center gap-1 flex-wrap justify-end">
      {resolvedColors.map((c, idx) => {
        const meta = COLOR_META[c];
        return (
          <React.Fragment key={c}>
            {idx > 0 && <span className="text-slate-400">/</span>}
            <SymbolIcon color={c} size={size} variant={variant} />
            {showLabel && resolvedColors.length <= 3 && (
              <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
            )}
          </React.Fragment>
        );
      })}
      {showLabel && resolvedColors.length > 3 && (
        <span className="font-semibold text-slate-800">
          {resolvedColors.length}-Color
        </span>
      )}
      {suffix && <span className="font-semibold text-slate-900">{suffix}</span>}
    </span>
  );
};

const SYMBOL_LOOKUP: Record<string, BattleSymbolKind> = {
  red: 'Red',
  purple: 'Purple',
  white: 'White',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  god: 'God',
  ultimate: 'Ultimate',
};

const EFFECT_TOKEN_RE =
  /(\[(?:Red|Purple|White|Yellow|Green|Blue|God|Ultimate|Soul Core)\]|\((?:Red|Purple|White|Yellow|Green|Blue|God|Ultimate)\)|\b(?:Red|Purple|White|Yellow|Green|Blue)\b)/gi;

export const EffectTextWithSymbols: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;
  const parts = text.split(EFFECT_TOKEN_RE);

  return (
    <>
      {parts.map((part, idx) => {
        if (!part) return null;

        if (/^\[Soul Core\]$/i.test(part)) {
          return (
            <span
              key={idx}
              className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 font-semibold text-xs align-middle"
              title="Soul Core"
            >
              Soul Core
            </span>
          );
        }

        const bracketMatch = part.match(
          /^\[(Red|Purple|White|Yellow|Green|Blue|God|Ultimate)\]$/i
        );
        if (bracketMatch) {
          const sym = SYMBOL_LOOKUP[bracketMatch[1].toLowerCase()];
          if (sym) {
            return (
              <span
                key={idx}
                className="inline-flex items-center gap-1 mx-0.5 align-middle"
                title={`${sym} Symbol`}
              >
                <SymbolIcon color={sym} size="xs" variant="reduction" />
                <span className={`font-semibold text-xs ${SYMBOL_META[sym].text}`}>{sym}</span>
              </span>
            );
          }
        }

        const parenMatch = part.match(
          /^\((Red|Purple|White|Yellow|Green|Blue|God|Ultimate)\)$/i
        );
        if (parenMatch) {
          const sym = SYMBOL_LOOKUP[parenMatch[1].toLowerCase()];
          if (sym) {
            return (
              <span key={idx} className="inline-flex items-center gap-0.5 mx-0.5 align-middle">
                <span>(</span>
                <SymbolIcon color={sym} size="xs" variant="reduction" />
                <span className={`font-semibold ${SYMBOL_META[sym].text}`}>{sym}</span>
                <span>)</span>
              </span>
            );
          }
        }

        const wordMatch = part.match(/^(Red|Purple|White|Yellow|Green|Blue)$/i);
        if (wordMatch) {
          const c = SYMBOL_LOOKUP[wordMatch[1].toLowerCase()] as CardColor | undefined;
          if (c) {
            return (
              <span
                key={idx}
                className="inline-flex items-center gap-1 mx-0.5 align-baseline"
              >
                <SymbolIcon color={c} size="xs" variant="gem" />
                <span className={`font-semibold ${COLOR_META[c].text}`}>{part}</span>
              </span>
            );
          }
        }

        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
};
