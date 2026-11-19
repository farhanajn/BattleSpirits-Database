import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Layers,
  ExternalLink,
  Loader2,
  Columns2,
  ArrowLeftRight,
  Search,
  Network,
  Maximize2,
  Ban,
  AlertTriangle,
  CheckCircle2,
  Scale,
  Share2,
  Copy,
  Check,
  Download,
  BookOpen,
} from 'lucide-react';
import { BattleSpiritsCard, BattleSymbolKind, GameFormat } from '../types/card';
import { COLOR_META } from '../data/theme';
import { CardArtwork } from './CardArtwork';
import {
  ColorSymbolBadge,
  EffectTextWithSymbols,
  SymbolIcon,
} from './SymbolIcon';
import { analyzeCardSynergies } from '../utils/cardSynergy';
import {
  formatRestrictionSummary,
  getCardLegalityStatus,
  getMaxCardCopies,
  isTokenCard,
} from '../utils/cardRules';
import {
  CardShareImageResult,
  generateCardShareImage,
} from '../utils/cardShareImage';
import { useWikiImagePrefetch } from '../hooks/useWikiImagePrefetch';

interface CardDetailSheetProps {
  card: BattleSpiritsCard | null;
  allCards?: BattleSpiritsCard[];
  navigableCards?: BattleSpiritsCard[];
  deckQty: number;
  activeDeckQtyMap?: Record<string, number>;
  activeDeckName: string;
  activeDeckFormat: GameFormat;
  onClose: () => void;
  onSelectCard?: (card: BattleSpiritsCard) => void;
  onUpdateDeckQty: (cardId: string, delta: number) => void;
}

function getMinCost(c: BattleSpiritsCard): number {
  const totalRed = (Object.values(c.reduction) as (number | undefined)[]).reduce<number>(
    (acc, n) => acc + (n || 0),
    0
  );
  return Math.max(0, c.cost - totalRed);
}

function getMaxBp(c: BattleSpiritsCard): number {
  if (!c.levels || c.levels.length === 0) return 0;
  return Math.max(...c.levels.map((l) => l.bp || 0));
}

export const CardDetailSheet: React.FC<CardDetailSheetProps> = ({
  card,
  allCards = [],
  navigableCards = [],
  deckQty,
  activeDeckQtyMap = {},
  activeDeckName,
  activeDeckFormat,
  onClose,
  onSelectCard,
  onUpdateDeckQty,
}) => {
  const [openRulingIdx, setOpenRulingIdx] = useState<number | null>(0);
  const [selectedArtIdx, setSelectedArtIdx] = useState(0);
  const [fullImageOpen, setFullImageOpen] = useState(false);
  const [rulingsModalOpen, setRulingsModalOpen] = useState(false);
  const [rulingsQuery, setRulingsQuery] = useState('');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [generatingShareImage, setGeneratingShareImage] = useState(false);
  const [shareResult, setShareResult] = useState<CardShareImageResult | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<{
    kind: 'copied' | 'shared' | 'downloaded' | 'info';
    text: string;
  } | null>(null);

  const [compareMode, setCompareMode] = useState(false);
  const [synergyMode, setSynergyMode] = useState(false);
  const [synergyFilter, setSynergyFilter] = useState<'all' | 'family' | 'keyword'>('all');
  const [synergyOnlyLegal, setSynergyOnlyLegal] = useState(false);
  const [compareCardId, setCompareCardId] = useState<string | null>(null);
  const [compareAdHocCard, setCompareAdHocCard] = useState<BattleSpiritsCard | null>(
    null
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');

  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [slideStage, setSlideStage] = useState<'idle' | 'pre-next' | 'pre-prev'>('idle');
  const shareGenSeqRef = React.useRef(0);
  const touchGestureRef = React.useRef<{
    x: number;
    y: number;
    time: number;
    axis: 'none' | 'horizontal' | 'vertical';
    blocked: boolean;
  } | null>(null);

  useEffect(() => {
    shareGenSeqRef.current += 1;
    setSelectedArtIdx(0);
    setOpenRulingIdx(0);
    setRulingsModalOpen(false);
    setRulingsQuery('');
    setShareModalOpen(false);
    setShareError(null);
    setShareFeedback(null);
    setGeneratingShareImage(false);
    setShareResult(null);
    setCompareMode(false);
    setSynergyMode(false);
    setSynergyFilter('all');
    setSynergyOnlyLegal(false);
    setCompareCardId(null);
    setCompareAdHocCard(null);
    setPickerOpen(false);
    setCompareQuery('');
    setDragOffsetX(0);
    setIsDragging(false);
  }, [card?.id]);

  useEffect(() => {
    if (!card) {
      setFullImageOpen(false);
      setRulingsModalOpen(false);
      setShareModalOpen(false);
    }
  }, [card]);

  useEffect(() => {
    return () => {
      if (shareResult?.objectUrl) {
        URL.revokeObjectURL(shareResult.objectUrl);
      }
    };
  }, [shareResult]);

  // Settle brief directional slide-in transition when swiping/sliding to adjacent card
  useEffect(() => {
    if (slideStage === 'idle') return;
    const raf = requestAnimationFrame(() => {
      setSlideStage('idle');
    });
    return () => cancelAnimationFrame(raf);
  }, [slideStage]);

  const compareCard = useMemo(() => {
    if (!compareCardId) return null;
    return (
      allCards.find((c) => c.id === compareCardId) ||
      (compareAdHocCard?.id === compareCardId ? compareAdHocCard : null)
    );
  }, [allCards, compareCardId, compareAdHocCard]);

  const compareCandidates = useMemo(() => {
    if (!card) return [];
    const q = compareQuery.trim().toLowerCase();
    const pool = allCards.filter((c) => c.id !== card.id);

    if (q) {
      return pool
        .filter((c) => {
          const hay = `${c.name} ${c.jpName} ${c.cardNumber} ${c.setCode} ${c.type} ${c.color} ${c.families.join(' ')}`.toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 30);
    }

    // Prioritize counterpart (Revival <-> Non-Revival) and same-type/same-color cards
    const baseCleanName = card.name.replace(/\s*\(Revival\)\s*$/i, '').toLowerCase();
    return pool
      .slice()
      .sort((a, b) => {
        const score = (x: BattleSpiritsCard) => {
          let s = 0;
          const xClean = x.name.replace(/\s*\(Revival\)\s*$/i, '').toLowerCase();
          if (xClean === baseCleanName) s += 100;
          if (x.type === card.type) s += 20;
          if (x.color === card.color) s += 10;
          if (Math.abs(x.cost - card.cost) <= 1) s += 5;
          return s;
        };
        return score(b) - score(a);
      })
      .slice(0, 24);
  }, [allCards, card, compareQuery]);

  const synergyAnalysis = useMemo(() => {
    if (!card || !synergyMode) return null;
    return analyzeCardSynergies(card, allCards, activeDeckFormat);
  }, [card, allCards, activeDeckFormat, synergyMode]);

  const navIndex = useMemo(() => {
    if (!card || navigableCards.length === 0) return -1;
    return navigableCards.findIndex((c) => c.id === card.id);
  }, [navigableCards, card?.id]);

  const prevCard = navIndex > 0 ? navigableCards[navIndex - 1] : null;
  const nextCard =
    navIndex >= 0 && navIndex < navigableCards.length - 1
      ? navigableCards[navIndex + 1]
      : null;
  const hasNavigation = navIndex >= 0 && navigableCards.length > 1 && Boolean(onSelectCard);

  const detailExtraUrls = useMemo(() => {
    const urls: string[] = [];
    if (card?.galleryImages) {
      for (const item of card.galleryImages) {
        if (item?.url) urls.push(item.url);
      }
    }
    if (compareCard?.artworkImage) {
      urls.push(compareCard.artworkImage);
    }
    return urls;
  }, [card?.galleryImages, compareCard?.artworkImage]);

  useWikiImagePrefetch({
    cards: navigableCards,
    currentIndex: navIndex >= 0 ? navIndex : 0,
    lookahead: 4,
    lookbehind: 1,
    extraUrls: detailExtraUrls,
    enabled: Boolean(card),
  });

  const navigateAdjacent = React.useCallback(
    (direction: 'prev' | 'next') => {
      if (!onSelectCard) return;
      const target = direction === 'prev' ? prevCard : nextCard;
      if (!target) return;
      setDragOffsetX(0);
      setIsDragging(false);
      setSlideStage(direction === 'next' ? 'pre-next' : 'pre-prev');
      onSelectCard(target);
    },
    [onSelectCard, prevCard, nextCard]
  );

  // Keyboard navigation (ArrowLeft / ArrowRight / Escape) when modal is open
  useEffect(() => {
    if (!card) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft' && prevCard && !rulingsModalOpen && !shareModalOpen) {
        e.preventDefault();
        navigateAdjacent('prev');
      } else if (e.key === 'ArrowRight' && nextCard && !rulingsModalOpen && !shareModalOpen) {
        e.preventDefault();
        navigateAdjacent('next');
      } else if (e.key === 'Escape') {
        if (shareModalOpen) {
          setShareModalOpen(false);
        } else if (rulingsModalOpen) {
          setRulingsModalOpen(false);
        } else if (fullImageOpen) {
          setFullImageOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    card,
    prevCard,
    nextCard,
    fullImageOpen,
    rulingsModalOpen,
    shareModalOpen,
    navigateAdjacent,
    onClose,
  ]);

  if (!card) return null;

  const handleSwipeTouchStart = (e: React.TouchEvent) => {
    if (
      !hasNavigation ||
      e.touches.length !== 1 ||
      pickerOpen ||
      rulingsModalOpen ||
      shareModalOpen
    ) {
      return;
    }
    const targetEl = e.target as HTMLElement | null;
    const blocked = Boolean(
      targetEl?.closest('[data-no-swipe="true"], input, textarea, select')
    );
    touchGestureRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
      axis: 'none',
      blocked,
    };
  };

  const handleSwipeTouchMove = (e: React.TouchEvent) => {
    const g = touchGestureRef.current;
    if (!g || g.blocked || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - g.x;
    const dy = e.touches[0].clientY - g.y;

    if (g.axis === 'none') {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        g.axis = 'vertical';
        return;
      }
      g.axis = 'horizontal';
      setIsDragging(true);
    }

    if (g.axis === 'horizontal') {
      const movingIntoEdge = (dx > 0 && !prevCard) || (dx < 0 && !nextCard);
      const damped = movingIntoEdge
        ? dx * 0.2
        : Math.max(-140, Math.min(140, dx * 0.85));
      setDragOffsetX(damped);
    }
  };

  const handleSwipeTouchEnd = () => {
    const g = touchGestureRef.current;
    touchGestureRef.current = null;
    if (!g || g.axis !== 'horizontal') {
      if (dragOffsetX !== 0) setDragOffsetX(0);
      setIsDragging(false);
      return;
    }

    const elapsed = Date.now() - g.time;
    const shouldNext =
      nextCard && (dragOffsetX <= -46 || (dragOffsetX <= -22 && elapsed < 260));
    const shouldPrev =
      prevCard && (dragOffsetX >= 46 || (dragOffsetX >= 22 && elapsed < 260));

    setDragOffsetX(0);
    setIsDragging(false);

    if (shouldNext) {
      navigateAdjacent('next');
    } else if (shouldPrev) {
      navigateAdjacent('prev');
    }
  };

  const handleToggleCompare = () => {
    if (!compareMode) {
      setSynergyMode(false);
      setCompareMode(true);
      setPickerOpen(!compareCard);
    } else {
      setCompareMode(false);
      setPickerOpen(false);
    }
  };

  const handleToggleSynergy = () => {
    if (!synergyMode) {
      setCompareMode(false);
      setPickerOpen(false);
      setSynergyMode(true);
    } else {
      setSynergyMode(false);
    }
  };

  const handleSelectCompareCard = (chosen: BattleSpiritsCard) => {
    setCompareCardId(chosen.id);
    setCompareAdHocCard(chosen);
    setPickerOpen(false);
    setCompareMode(true);
  };

  const meta = COLOR_META[card.color];
  const reductionEntries = (
    Object.entries(card.reduction) as [BattleSymbolKind, number][]
  ).filter(([, n]) => n > 0);
  const symbolEntries = (
    Object.entries(card.symbols) as [BattleSymbolKind, number][]
  ).filter(([, n]) => n > 0);
  const minCost = getMinCost(card);

  const isStandardLegal = card.formats.includes('Standard');
  const isLegalInActiveDeck = card.formats.includes(activeDeckFormat);
  const isToken = isTokenCard(card);
  const maxCopies = getMaxCardCopies(card);
  const isBanned = !isToken && maxCopies === 0;
  const legalityStatus = getCardLegalityStatus(card, activeDeckFormat);
  const legalityBadgeClasses =
    legalityStatus.tone === 'legal'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : legalityStatus.tone === 'warning'
      ? 'bg-amber-50 border-amber-300 text-amber-900'
      : legalityStatus.tone === 'restricted'
      ? 'bg-orange-50 border-orange-300 text-orange-900'
      : legalityStatus.tone === 'banned'
      ? 'bg-red-50 border-red-300 text-red-800'
      : 'bg-slate-100 border-slate-300 text-slate-700';
  const usesAdventSummon =
    Boolean(card.subtypeLabel && /contract/i.test(card.subtypeLabel)) ||
    card.effects.some((e) => /Summon\/Advent Condition|Contract Advent|\bAdvent\b/i.test(`${e.timing} ${e.text}`));

  const gallery =
    card.galleryImages && card.galleryImages.length > 0
      ? card.galleryImages
      : [{ url: card.artworkImage, caption: `${card.name} — Card Art` }];
  const activeArt = gallery[selectedArtIdx] || gallery[0];

  const handleOpenShareModal = async () => {
    const seq = ++shareGenSeqRef.current;
    setShareModalOpen(true);
    setShareError(null);
    setShareFeedback(null);
    setGeneratingShareImage(true);
    try {
      const result = await generateCardShareImage(card, activeArt?.url);
      if (shareGenSeqRef.current !== seq) {
        URL.revokeObjectURL(result.objectUrl);
        return;
      }
      setShareResult(result);
    } catch {
      if (shareGenSeqRef.current === seq) {
        setShareError('Could not render card image in this browser.');
      }
    } finally {
      if (shareGenSeqRef.current === seq) {
        setGeneratingShareImage(false);
      }
    }
  };

  const handleCopyShareImage = async () => {
    if (!shareResult) return;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof ClipboardItem !== 'undefined'
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': shareResult.blob }),
        ]);
        setShareFeedback({
          kind: 'copied',
          text: 'Image copied! Ready to paste into Discord, WhatsApp, or X.',
        });
        return;
      }
    } catch {
      // Fall through to informative message below
    }
    setShareFeedback({
      kind: 'info',
      text: 'Clipboard image copy is blocked here — use Share or Save PNG.',
    });
  };

  const handleNativeShareImage = async () => {
    if (!shareResult) return;
    const shareTitle = `${card.name} (${card.cardNumber})`;
    const shareText = `${card.name} · ${card.color} ${card.type} · Cost ${card.cost} (${card.setCode})`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const imageFile = new File([shareResult.blob], shareResult.filename, {
          type: 'image/png',
        });
        if (
          typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [imageFile] })
        ) {
          await navigator.share({
            files: [imageFile],
            title: shareTitle,
            text: shareText,
          });
          setShareFeedback({
            kind: 'shared',
            text: 'Shared card image.',
          });
          return;
        }

        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: window.location.href,
        });
        setShareFeedback({
          kind: 'shared',
          text: 'Opened share sheet.',
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }

    setShareFeedback({
      kind: 'info',
      text: 'Device share sheet is unavailable here — use Copy Image or Save PNG.',
    });
  };

  const handleDownloadShareImage = () => {
    if (!shareResult) return;
    const link = document.createElement('a');
    link.href = shareResult.objectUrl;
    link.download = shareResult.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShareFeedback({
      kind: 'downloaded',
      text: 'Saved social card PNG.',
    });
  };

  const filteredModalRulings = rulingsQuery.trim()
    ? card.rulings.filter((r) => {
        const q = rulingsQuery.trim().toLowerCase();
        return (
          r.question.toLowerCase().includes(q) ||
          r.answer.toLowerCase().includes(q)
        );
      })
    : card.rulings;

  const renderSymbolsList = (
    entries: [BattleSymbolKind, number][],
    variant: 'reduction' | 'gem',
    emptyText: string
  ) => {
    if (entries.length === 0) {
      return <span className="text-xs font-medium text-slate-400">{emptyText}</span>;
    }
    return (
      <div className="flex flex-wrap items-center gap-1">
        {entries.map(([kind, count]) =>
          Array.from({ length: count }).map((_, i) => (
            <SymbolIcon
              key={`${variant}-${kind}-${i}`}
              color={kind}
              size="sm"
              variant={variant}
            />
          ))
        )}
      </div>
    );
  };

  const renderComparisonView = (left: BattleSpiritsCard, right: BattleSpiritsCard) => {
    const leftMeta = COLOR_META[left.color];
    const rightMeta = COLOR_META[right.color];
    const leftMin = getMinCost(left);
    const rightMin = getMinCost(right);
    const leftMaxBp = getMaxBp(left);
    const rightMaxBp = getMaxBp(right);

    const leftReductions = (
      Object.entries(left.reduction) as [BattleSymbolKind, number][]
    ).filter(([, n]) => n > 0);
    const rightReductions = (
      Object.entries(right.reduction) as [BattleSymbolKind, number][]
    ).filter(([, n]) => n > 0);

    const leftSymbols = (
      Object.entries(left.symbols) as [BattleSymbolKind, number][]
    ).filter(([, n]) => n > 0);
    const rightSymbols = (
      Object.entries(right.symbols) as [BattleSymbolKind, number][]
    ).filter(([, n]) => n > 0);

    const allLevels = Array.from(
      new Set([
        ...(left.levels || []).map((l) => l.level),
        ...(right.levels || []).map((l) => l.level),
      ])
    ).sort((a, b) => a - b);

    const costDiff = left.cost - right.cost;
    const bpDiff = leftMaxBp - rightMaxBp;

    return (
      <div className="space-y-5">
        {/* Side-by-Side Card Headers */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {[
            { c: left, m: leftMeta, label: 'Primary Card', canChange: false },
            { c: right, m: rightMeta, label: 'Compared Card', canChange: true },
          ].map(({ c, m, label, canChange }) => (
            <div
              key={`${label}-${c.id}`}
              className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden flex flex-col"
            >
              <div className="aspect-[5/7] w-full max-h-[260px] bg-slate-950 relative overflow-hidden p-1">
                <CardArtwork card={c} fit="contain" className="w-full h-full bg-slate-950" />
              </div>
              <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-slate-500 tabular-nums">
                    <span>{c.cardNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span>{c.setCode}</span>
                    <span aria-hidden="true">·</span>
                    <span className={`font-semibold ${m.text}`}>{c.rarity}</span>
                  </div>
                  <div className="font-display text-sm sm:text-base font-bold text-slate-900 leading-snug mt-0.5 line-clamp-2">
                    {c.name}
                  </div>
                </div>
                {canChange && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="min-h-[38px] px-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>Change Card</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Stats Comparison Matrix */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 mb-2">
            Stats &amp; Attributes Comparison
          </h3>
          <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 bg-white">
            {/* Attribute / Type */}
            <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-3 text-xs font-semibold text-slate-500">
                Attribute / Type
              </div>
              <div className="sm:col-span-9 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <ColorSymbolBadge
                    color={left.color}
                    secondaryColor={left.secondaryColor}
                    colors={left.colors}
                    variant="gem"
                    size="xs"
                    suffix={left.subtypeLabel || left.type}
                  />
                </div>
                <div className="min-w-0 border-l border-slate-100 pl-3">
                  <ColorSymbolBadge
                    color={right.color}
                    secondaryColor={right.secondaryColor}
                    colors={right.colors}
                    variant="gem"
                    size="xs"
                    suffix={right.subtypeLabel || right.type}
                  />
                </div>
              </div>
            </div>

            {/* Summon Cost */}
            <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-3 text-xs font-semibold text-slate-500">
                Summon Cost
              </div>
              <div className="sm:col-span-9 grid grid-cols-2 gap-3">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {left.cost}
                  </span>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    (Min {leftMin})
                  </span>
                  {costDiff !== 0 && (
                    <span
                      className={`text-[11px] font-mono font-semibold tabular-nums ${
                        costDiff < 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {costDiff > 0 ? `+${costDiff}` : costDiff}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-baseline gap-1.5 border-l border-slate-100 pl-3">
                  <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {right.cost}
                  </span>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    (Min {rightMin})
                  </span>
                  {costDiff !== 0 && (
                    <span
                      className={`text-[11px] font-mono font-semibold tabular-nums ${
                        costDiff > 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {-costDiff > 0 ? `+${-costDiff}` : -costDiff}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Reduction */}
            <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-3 text-xs font-semibold text-slate-500">
                Reduction
              </div>
              <div className="sm:col-span-9 grid grid-cols-2 gap-3">
                <div>{renderSymbolsList(leftReductions, 'reduction', '0 Red.')}</div>
                <div className="border-l border-slate-100 pl-3">
                  {renderSymbolsList(rightReductions, 'reduction', '0 Red.')}
                </div>
              </div>
            </div>

            {/* Card Symbols */}
            <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-3 text-xs font-semibold text-slate-500">
                Symbols
              </div>
              <div className="sm:col-span-9 grid grid-cols-2 gap-3">
                <div>{renderSymbolsList(leftSymbols, 'gem', 'None')}</div>
                <div className="border-l border-slate-100 pl-3">
                  {renderSymbolsList(rightSymbols, 'gem', 'None')}
                </div>
              </div>
            </div>

            {/* Peak BP */}
            {(leftMaxBp > 0 || rightMaxBp > 0) && (
              <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <div className="sm:col-span-3 text-xs font-semibold text-slate-500">
                  Max BP
                </div>
                <div className="sm:col-span-9 grid grid-cols-2 gap-3">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                      {leftMaxBp > 0 ? `${leftMaxBp.toLocaleString()} BP` : '—'}
                    </span>
                    {bpDiff !== 0 && leftMaxBp > 0 && rightMaxBp > 0 && (
                      <span
                        className={`text-[11px] font-mono font-semibold tabular-nums ${
                          bpDiff > 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {bpDiff > 0
                          ? `+${bpDiff.toLocaleString()}`
                          : bpDiff.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-1.5 border-l border-slate-100 pl-3">
                    <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                      {rightMaxBp > 0 ? `${rightMaxBp.toLocaleString()} BP` : '—'}
                    </span>
                    {bpDiff !== 0 && leftMaxBp > 0 && rightMaxBp > 0 && (
                      <span
                        className={`text-[11px] font-mono font-semibold tabular-nums ${
                          bpDiff < 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {-bpDiff > 0
                          ? `+${(-bpDiff).toLocaleString()}`
                          : (-bpDiff).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Families */}
            <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-3 text-xs font-semibold text-slate-500">
                Families
              </div>
              <div className="sm:col-span-9 grid grid-cols-2 gap-3 text-xs text-slate-800 font-medium">
                <div>{left.families.length > 0 ? left.families.join(' / ') : '—'}</div>
                <div className="border-l border-slate-100 pl-3">
                  {right.families.length > 0 ? right.families.join(' / ') : '—'}
                </div>
              </div>
            </div>

            {/* Format & Version */}
            <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-3 text-xs font-semibold text-slate-500">
                Format / Version
              </div>
              <div className="sm:col-span-9 grid grid-cols-2 gap-3 text-xs font-semibold">
                <div className="text-slate-700">
                  {left.formats.includes('Standard') ? 'Standard & Eternal' : 'Eternal Only'}
                  {left.isRevival ? ' · Revival' : ''}
                  {left.isToken ? ' · Token' : ''}
                </div>
                <div className="border-l border-slate-100 pl-3 text-slate-700">
                  {right.formats.includes('Standard') ? 'Standard & Eternal' : 'Eternal Only'}
                  {right.isRevival ? ' · Revival' : ''}
                  {right.isToken ? ' · Token' : ''}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Levels & Conditions Comparison */}
        {(allLevels.length > 0 ||
          left.summonCondition ||
          right.summonCondition ||
          left.braveBonusBp ||
          right.braveBonusBp) && (
          <section>
            <h3 className="text-xs font-semibold text-slate-500 mb-2">
              Level Thresholds &amp; Battle Points
            </h3>
            <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 bg-white">
              {allLevels.map((lvlNum) => {
                const lTier = left.levels?.find((l) => l.level === lvlNum);
                const rTier = right.levels?.find((l) => l.level === lvlNum);
                return (
                  <div
                    key={`cmp-lvl-${lvlNum}`}
                    className="px-3.5 py-2.5 grid grid-cols-12 gap-2 items-center text-xs sm:text-sm"
                  >
                    <div className="col-span-2 font-mono font-bold text-slate-900 tabular-nums">
                      LV{lvlNum}
                    </div>
                    <div className="col-span-5 flex items-center justify-between gap-2">
                      {lTier ? (
                        <>
                          <span className="text-xs text-slate-500 font-mono tabular-nums">
                            {lTier.cores} {lTier.cores === 1 ? 'Core' : 'Cores'}
                          </span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {lTier.bp > 0 ? `${lTier.bp.toLocaleString()} BP` : 'Nexus'}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                    <div className="col-span-5 flex items-center justify-between gap-2 border-l border-slate-100 pl-3">
                      {rTier ? (
                        <>
                          <span className="text-xs text-slate-500 font-mono tabular-nums">
                            {rTier.cores} {rTier.cores === 1 ? 'Core' : 'Cores'}
                          </span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {rTier.bp > 0 ? `${rTier.bp.toLocaleString()} BP` : 'Nexus'}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {(left.braveBonusBp !== undefined ||
                left.braveCondition ||
                right.braveBonusBp !== undefined ||
                right.braveCondition) && (
                <div className="px-3.5 py-2.5 grid grid-cols-12 gap-2 items-center text-xs bg-slate-50">
                  <div className="col-span-2 font-semibold text-slate-600">Brave</div>
                  <div className="col-span-5">
                    {left.braveBonusBp !== undefined || left.braveCondition ? (
                      <div>
                        {left.braveBonusBp !== undefined && (
                          <span className="font-mono font-semibold text-red-700 tabular-nums">
                            +{left.braveBonusBp.toLocaleString()} BP
                          </span>
                        )}
                        {left.braveCondition && (
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            <EffectTextWithSymbols text={left.braveCondition} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                  <div className="col-span-5 border-l border-slate-200 pl-3">
                    {right.braveBonusBp !== undefined || right.braveCondition ? (
                      <div>
                        {right.braveBonusBp !== undefined && (
                          <span className="font-mono font-semibold text-red-700 tabular-nums">
                            +{right.braveBonusBp.toLocaleString()} BP
                          </span>
                        )}
                        {right.braveCondition && (
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            <EffectTextWithSymbols text={right.braveCondition} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                </div>
              )}

              {(left.summonCondition || right.summonCondition) && (
                <div className="px-3.5 py-2.5 grid grid-cols-12 gap-2 items-start text-xs bg-amber-50/60">
                  <div className="col-span-2 font-semibold text-amber-900">Summon</div>
                  <div className="col-span-5 text-amber-950">
                    {left.summonCondition ? (
                      <EffectTextWithSymbols text={left.summonCondition} />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                  <div className="col-span-5 border-l border-amber-200/70 pl-3 text-amber-950">
                    {right.summonCondition ? (
                      <EffectTextWithSymbols text={right.summonCondition} />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* English Card Effects Side-by-Side */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 mb-2">
            English Card Effects
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {[
              { c: left, m: leftMeta },
              { c: right, m: rightMeta },
            ].map(({ c, m }, colIdx) => (
              <div key={`eff-col-${colIdx}-${c.id}`} className="space-y-2">
                <div className="text-xs font-bold text-slate-800 truncate pb-1 border-b border-slate-200">
                  {c.name}
                </div>
                {c.effects.length > 0 ? (
                  c.effects.map((eff, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1"
                    >
                      <div className={`text-xs font-semibold ${m.text}`}>
                        <EffectTextWithSymbols text={eff.timing} />
                      </div>
                      <p className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                        <EffectTextWithSymbols text={eff.text} />
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500">
                    No effect text recorded for this card.
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderSynergyView = () => {
    if (!synergyAnalysis) return null;

    const baseSuggestions = synergyAnalysis.suggestions;
    const familyFilteredCount = baseSuggestions.filter(
      (s) => s.sharedFamilies.length > 0 || s.mentionedFamilies.length > 0
    ).length;
    const keywordFilteredCount = baseSuggestions.filter(
      (s) => s.sharedKeywords.length > 0
    ).length;

    const filteredSuggestions = baseSuggestions
      .filter((item) => {
        if (synergyOnlyLegal && !item.isFormatLegal) return false;
        if (synergyFilter === 'family') {
          return item.sharedFamilies.length > 0 || item.mentionedFamilies.length > 0;
        }
        if (synergyFilter === 'keyword') {
          return item.sharedKeywords.length > 0;
        }
        return true;
      })
      .slice(0, 30);

    return (
      <div className="space-y-4">
        {/* Source Card Synergy Profile */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">
                Synergy Profile for
              </div>
              <h3 className="font-display text-base font-bold text-slate-900 truncate">
                {card.name}
              </h3>
            </div>
            <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums shrink-0">
              {baseSuggestions.length} {baseSuggestions.length === 1 ? 'match' : 'matches'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-1.5">
              <div className="font-semibold text-slate-600">
                Card Families ({synergyAnalysis.targetFamilies.length})
              </div>
              {synergyAnalysis.familyMatchCounts.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {synergyAnalysis.familyMatchCounts.map(({ family, count }) => (
                    <span
                      key={family}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-medium inline-flex items-center gap-1"
                    >
                      <span>{family}</span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        ({count})
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400">No families on this card</div>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-1.5">
              <div className="font-semibold text-slate-600">
                Keywords ({synergyAnalysis.targetKeywords.length})
              </div>
              {synergyAnalysis.keywordMatchCounts.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {synergyAnalysis.keywordMatchCounts.map(({ keyword, count }) => (
                    <span
                      key={keyword}
                      className="px-2 py-0.5 rounded-md bg-red-50 text-red-800 font-medium inline-flex items-center gap-1"
                    >
                      <span>{keyword}</span>
                      <span className="font-mono text-[11px] text-red-600/80 tabular-nums">
                        ({count})
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400">No keywords on this card</div>
              )}
            </div>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="group"
            aria-label="Filter synergy suggestions"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl"
          >
            {[
              { id: 'all' as const, label: `All (${baseSuggestions.length})` },
              { id: 'family' as const, label: `Families (${familyFilteredCount})` },
              { id: 'keyword' as const, label: `Keywords (${keywordFilteredCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSynergyFilter(tab.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  synergyFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSynergyOnlyLegal((v) => !v)}
            className={`min-h-[36px] px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              synergyOnlyLegal
                ? 'bg-sky-700 text-white border-sky-700'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
            aria-pressed={synergyOnlyLegal}
          >
            {activeDeckFormat} Legal Only
          </button>
        </div>

        {/* Suggested Synergistic Cards */}
        {filteredSuggestions.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-1.5">
            <div className="text-sm font-semibold text-slate-800">
              No matching synergy cards found
            </div>
            <p className="text-xs text-slate-500">
              {synergyOnlyLegal
                ? `Try turning off "${activeDeckFormat} Legal Only" or loading additional card sets from Search.`
                : 'No loaded cards currently share families or keywords with this card.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSuggestions.map((item) => {
              const cand = item.card;
              const candMeta = COLOR_META[cand.color];
              const inDeckQty = activeDeckQtyMap[cand.id] || 0;
              const candMax = getMaxCardCopies(cand);

              return (
                <div
                  key={`syn-${cand.id}`}
                  className="p-2.5 sm:p-3 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 flex items-center justify-between gap-3 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectCard) {
                        onSelectCard(cand);
                      } else {
                        handleSelectCompareCard(cand);
                      }
                    }}
                    className="min-w-0 flex-1 flex items-center gap-3 text-left cursor-pointer group"
                  >
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-900 shrink-0">
                      <CardArtwork card={cand} className="w-full h-full" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-500 tabular-nums">
                        <span>{cand.cardNumber}</span>
                        <span>·</span>
                        <span className={`font-sans font-semibold ${candMeta.text}`}>
                          {cand.color} {cand.type}
                        </span>
                        <span>·</span>
                        <span>Cost {cand.cost}</span>
                        <span>·</span>
                        <span
                          className={`font-sans font-semibold ${
                            cand.formats.includes('Standard')
                              ? 'text-sky-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {cand.formats.includes('Standard') ? 'STD' : 'ETN'}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-slate-900 truncate group-hover:text-red-700 transition-colors">
                        {cand.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {item.sharedFamilies.map((f) => (
                          <span
                            key={`sf-${f}`}
                            className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-semibold"
                          >
                            Family: {f}
                          </span>
                        ))}
                        {item.mentionedFamilies.map((f) => (
                          <span
                            key={`mf-${f}`}
                            className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 font-semibold"
                          >
                            Synergy: {f}
                          </span>
                        ))}
                        {item.sharedKeywords.map((k) => (
                          <span
                            key={`sk-${k}`}
                            className="px-1.5 py-0.5 rounded bg-red-50 text-red-800 font-semibold"
                          >
                            Keyword: {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>

                  {isTokenCard(cand) && inDeckQty === 0 ? (
                    <span className="px-2.5 py-2 rounded-xl bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-500 shrink-0 whitespace-nowrap">
                      Token · Outside Deck
                    </span>
                  ) : (
                    <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden shrink-0 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => onUpdateDeckQty(cand.id, -1)}
                        disabled={inDeckQty <= 0}
                        className="min-h-[40px] min-w-[36px] flex items-center justify-center text-slate-700 hover:bg-slate-200 disabled:opacity-35 cursor-pointer"
                        aria-label={`Remove ${cand.name} from deck`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-2 font-mono text-xs font-bold tabular-nums min-w-[2.25rem] text-center text-slate-900">
                        {inDeckQty}/{candMax}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateDeckQty(cand.id, 1)}
                        disabled={inDeckQty >= candMax}
                        className="min-h-[40px] min-w-[36px] flex items-center justify-center text-slate-700 hover:bg-slate-200 disabled:opacity-35 cursor-pointer"
                        aria-label={`Add ${cand.name} to deck`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-detail-title"
      onClick={onClose}
    >
      <div
        className={`w-full ${
          (compareMode && compareCard) || synergyMode
            ? 'lg:max-w-5xl'
            : 'sm:max-w-2xl lg:max-w-3xl'
        } max-h-[92vh] sm:max-h-[90vh] bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col shadow-2xl transition-[max-width] duration-200`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleSwipeTouchStart}
        onTouchMove={handleSwipeTouchMove}
        onTouchEnd={handleSwipeTouchEnd}
        onTouchCancel={handleSwipeTouchEnd}
      >
        <div className="sm:hidden pt-2.5 pb-1 flex items-center justify-center shrink-0">
          <div className="w-10 h-1.5 bg-slate-300 rounded-full" />
        </div>

        {/* Row 1: Title, Metadata & Close Button (Full-width readable across mobile/tablet/desktop) */}
        <div className="px-4 sm:px-6 pt-2 sm:pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0 bg-white">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-600">
              <span className="font-mono font-semibold text-slate-800 tabular-nums shrink-0">
                {card.cardNumber}
              </span>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className="font-semibold text-slate-700 truncate max-w-[160px] sm:max-w-none">
                {card.setCode}
                <span className="hidden sm:inline font-normal text-slate-500">
                  {' '}— {card.setName}
                </span>
              </span>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className={`font-bold shrink-0 ${meta.text}`}>{card.rarity}</span>
            </div>
            <h2
              id="card-detail-title"
              className="mt-1 font-display text-lg sm:text-xl lg:text-[22px] font-bold text-slate-950 leading-snug line-clamp-2"
            >
              {compareMode && compareCard
                ? `${card.name} vs ${compareCard.name}`
                : synergyMode
                ? `Synergy Analysis — ${card.name}`
                : card.name}
            </h2>
            {card.setName && (
              <p className="sm:hidden mt-0.5 text-[11px] text-slate-500 truncate">
                {card.setName}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">
                Legality ({activeDeckFormat}):
              </span>
              <span
                data-testid="card-legality-badge"
                title={legalityStatus.detail}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border text-xs font-bold leading-tight ${legalityBadgeClasses}`}
              >
                {legalityStatus.tone === 'legal' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : legalityStatus.tone === 'banned' ? (
                  <Ban className="w-3.5 h-3.5 shrink-0" />
                ) : legalityStatus.tone === 'token' ? (
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{legalityStatus.label}</span>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -mr-1.5 -mt-0.5 flex items-center justify-center rounded-xl text-slate-600 bg-slate-100/80 sm:bg-transparent hover:bg-slate-100 hover:text-slate-950 transition-colors shrink-0 cursor-pointer"
            aria-label="Close card details"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Row 2: Dedicated Action & Card Navigation Toolbar */}
        <div
          data-no-swipe="true"
          className="px-4 sm:px-6 py-2 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 flex-1 py-0.5">
            <button
              type="button"
              onClick={() => setRulingsModalOpen(true)}
              className="min-h-[44px] sm:min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              aria-label={`Official rulings for ${card.name}`}
            >
              <Scale className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>
                Rulings{card.rulings.length > 0 ? ` (${card.rulings.length})` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={handleOpenShareModal}
              className="min-h-[44px] sm:min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              aria-label={`Share social image for ${card.name}`}
            >
              <Share2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>Share</span>
            </button>

            <button
              type="button"
              onClick={handleToggleSynergy}
              className={`min-h-[44px] sm:min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                synergyMode
                  ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                  : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-100'
              }`}
              aria-pressed={synergyMode}
            >
              <Network className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {synergyMode ? 'Exit Synergy' : 'Analyze Synergy'}
              </span>
              <span className="sm:hidden">{synergyMode ? 'Exit' : 'Synergy'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleCompare}
              className={`min-h-[44px] sm:min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                compareMode
                  ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-100'
              }`}
              aria-pressed={compareMode}
            >
              <Columns2 className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {compareMode ? 'Exit Compare' : 'Compare'}
              </span>
              <span className="sm:hidden">{compareMode ? 'Exit' : 'Compare'}</span>
            </button>
          </div>

          {hasNavigation && (
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => navigateAdjacent('prev')}
                disabled={!prevCard}
                className="min-h-[44px] sm:min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                aria-label={prevCard ? `Previous card: ${prevCard.name}` : 'No previous card'}
                title={prevCard ? `Previous: ${prevCard.name}` : 'Start of list'}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-1.5 font-mono text-[11px] font-semibold text-slate-600 tabular-nums">
                {navIndex + 1}/{navigableCards.length}
              </span>
              <button
                type="button"
                onClick={() => navigateAdjacent('next')}
                disabled={!nextCard}
                className="min-h-[44px] sm:min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                aria-label={nextCard ? `Next card: ${nextCard.name}` : 'No next card'}
                title={nextCard ? `Next: ${nextCard.name}` : 'End of list'}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div
          className={`overflow-y-auto overflow-x-hidden flex-1 px-4 sm:px-6 py-4 space-y-5 ${
            isDragging || slideStage !== 'idle'
              ? ''
              : 'transition-[transform,opacity] duration-200 ease-out'
          }`}
          style={{
            transform:
              slideStage === 'pre-next'
                ? 'translate3d(44px, 0, 0)'
                : slideStage === 'pre-prev'
                ? 'translate3d(-44px, 0, 0)'
                : `translate3d(${dragOffsetX}px, 0, 0)`,
            opacity: slideStage !== 'idle' ? 0.55 : isDragging ? 0.92 : 1,
          }}
        >
          {/* Card Picker Panel for Compare Mode */}
          {compareMode && (pickerOpen || !compareCard) && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Select a second card to compare
                  </h3>
                  <p className="text-xs text-slate-500">
                    Compare stats, reduction symbols, levels, and English effects with{' '}
                    {card.name}.
                  </p>
                </div>
                {compareCard && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer"
                  >
                    Done
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={compareQuery}
                  onChange={(e) => setCompareQuery(e.target.value)}
                  placeholder="Search offline cards by name, card number, or family..."
                  className="w-full min-h-[44px] pl-9 pr-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                {compareCandidates.map((cand) => {
                  const candMeta = COLOR_META[cand.color];
                  const selected = compareCard?.id === cand.id;
                  return (
                    <button
                      key={`pick-${cand.id}`}
                      type="button"
                      onClick={() => handleSelectCompareCard(cand)}
                      className={`p-2 rounded-xl border text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                        selected
                          ? 'bg-red-50 border-red-500 ring-1 ring-red-500'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-900 shrink-0">
                        <CardArtwork card={cand} className="w-full h-full" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 tabular-nums">
                          <span>{cand.cardNumber}</span>
                          <span>·</span>
                          <span className={candMeta.text}>{cand.type}</span>
                          <span>·</span>
                          <span>Cost {cand.cost}</span>
                        </div>
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {cand.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {compareCandidates.length === 0 && (
                  <div className="col-span-full py-6 text-center text-xs text-slate-500">
                    No matching cards found in the offline database.
                  </div>
                )}
              </div>
            </div>
          )}

          {synergyMode ? (
            renderSynergyView()
          ) : compareMode && compareCard ? (
            renderComparisonView(card, compareCard)
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 sm:gap-5 items-start">
                <div className="sm:col-span-5 space-y-2">
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-950 p-1.5 sm:p-2">
                    <button
                      type="button"
                      onClick={() => setFullImageOpen(true)}
                      className="block w-full aspect-[5/7] max-w-[290px] sm:max-w-full mx-auto relative cursor-zoom-in group focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded-xl overflow-hidden"
                      aria-label={`View full size artwork for ${card.name}`}
                    >
                      <CardArtwork
                        card={card}
                        imageUrl={activeArt?.url}
                        fit="contain"
                        eager
                        className="w-full h-full bg-slate-950"
                      />
                      <span className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-slate-950/80 text-white text-[11px] font-semibold inline-flex items-center gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Maximize2 className="w-3 h-3" />
                        <span>Full View</span>
                      </span>
                    </button>
                  </div>

                  {gallery.length > 1 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-slate-700">
                          Artwork Versions ({gallery.length})
                        </span>
                        <span className="font-mono text-slate-400 tabular-nums shrink-0">
                          {Math.min(selectedArtIdx + 1, gallery.length)} / {gallery.length}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-slate-600 leading-snug">
                        {activeArt?.caption}
                      </div>
                      <div
                        data-no-swipe="true"
                        className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1"
                      >
                        {gallery.map((art, idx) => (
                          <button
                            key={`${art.url}-${idx}`}
                            type="button"
                            onClick={() => setSelectedArtIdx(idx)}
                            className={`relative w-12 h-16 rounded-lg overflow-hidden border-2 shrink-0 transition-all cursor-pointer bg-slate-950 ${
                              selectedArtIdx === idx
                                ? 'border-red-600 ring-1 ring-red-600'
                                : 'border-slate-200 opacity-75 hover:opacity-100'
                            }`}
                            aria-label={`View artwork ${idx + 1}: ${art.caption}`}
                          >
                            <CardArtwork
                              card={card}
                              imageUrl={art.url}
                              fit="contain"
                              className="w-full h-full bg-slate-950"
                            />
                            <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-slate-950/75 text-white font-mono text-[10px] leading-tight tabular-nums">
                              {idx + 1}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasNavigation && (
                    <div className="sm:hidden flex items-center justify-between text-[11px] text-slate-500 px-1">
                      <span>Swipe left or right for adjacent cards</span>
                      <span className="font-mono tabular-nums">
                        {navIndex + 1} / {navigableCards.length}
                      </span>
                    </div>
                  )}
                </div>

                <div className="sm:col-span-7 space-y-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <div className="text-xs text-slate-500">Summon Cost</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                          {card.cost}
                        </span>
                        <span className="text-xs text-slate-500 font-mono tabular-nums">
                          (Min {minCost})
                        </span>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <div className="text-xs text-slate-500">
                        Reduction &amp; Card Symbols
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {reductionEntries.length > 0 ? (
                            reductionEntries.map(([rColor, count]) => (
                              <span
                                key={`red-grp-${rColor}`}
                                className="inline-flex items-center gap-0.5"
                                title={`${count} ${rColor} Reduction`}
                              >
                                {Array.from({ length: count }).map((_, i) => (
                                  <SymbolIcon
                                    key={`red-${rColor}-${i}`}
                                    color={rColor}
                                    size="sm"
                                    variant="reduction"
                                  />
                                ))}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs font-medium text-slate-500">
                              0 Red.
                            </span>
                          )}
                        </div>
                        {symbolEntries.length > 0 && (
                          <span className="flex flex-wrap items-center gap-1 pl-2 border-l border-slate-300">
                            {symbolEntries.map(([sColor, count]) =>
                              Array.from({ length: count }).map((_, i) => (
                                <SymbolIcon
                                  key={`sym-${sColor}-${i}`}
                                  color={sColor}
                                  size="sm"
                                  variant="gem"
                                />
                              ))
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex items-center justify-between py-1 border-b border-slate-100 gap-2">
                      <span className="text-slate-500 shrink-0">Attribute / Type</span>
                      <ColorSymbolBadge
                        color={card.color}
                        secondaryColor={card.secondaryColor}
                        colors={card.colors}
                        variant="gem"
                        size="xs"
                        suffix={card.subtypeLabel || card.type}
                      />
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-slate-100 gap-2">
                      <span className="text-slate-500 shrink-0">
                        Legality ({activeDeckFormat})
                      </span>
                      <span
                        title={legalityStatus.detail}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold ${legalityBadgeClasses}`}
                      >
                        {legalityStatus.tone === 'legal' ? (
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                        ) : legalityStatus.tone === 'banned' ? (
                          <Ban className="w-3 h-3 shrink-0" />
                        ) : legalityStatus.tone === 'token' ? (
                          <Layers className="w-3 h-3 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                        )}
                        <span>{legalityStatus.label}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-slate-100 gap-2">
                      <span className="text-slate-500 shrink-0">Format Legality</span>
                      <span
                        className={`font-semibold text-right ${
                          isStandardLegal ? 'text-sky-700' : 'text-amber-700'
                        }`}
                      >
                        {isStandardLegal ? 'Standard & Eternal' : 'Eternal Only'} ·{' '}
                        {card.blockIcon}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-slate-100 gap-2">
                      <span className="text-slate-500 shrink-0">Copy Limit</span>
                      <span
                        className={`font-semibold text-right ${
                          isToken
                            ? 'text-slate-700'
                            : card.restriction && card.restriction !== 'Unlimited'
                            ? 'text-red-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {formatRestrictionSummary(card)}
                      </span>
                    </div>
                    {card.families.length > 0 && (
                      <div className="flex items-center justify-between py-1 border-b border-slate-100 gap-2">
                        <span className="text-slate-500 shrink-0">Families</span>
                        <span className="font-medium text-slate-900 text-right">
                          {card.families.join(' / ')}
                        </span>
                      </div>
                    )}
                    {card.jpName && (
                      <div className="flex items-center justify-between py-1 border-b border-slate-100 gap-2">
                        <span className="text-slate-500 shrink-0">Japanese Name</span>
                        <span className="font-medium text-slate-700 text-right truncate">
                          {card.jpName}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {!isLegalInActiveDeck && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950">
                  <span className="font-semibold">Format Notice: </span>
                  {card.name} is an Eternal-only card and is not legal in your active
                  Standard deck (&ldquo;{activeDeckName}&rdquo;).
                </div>
              )}

              {isToken && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-600 shrink-0" />
                  <span>
                    <span className="font-semibold text-slate-900">Token Card (Outside Main Deck): </span>
                    {card.name} is placed outside your main deck and cannot be added to deck construction.
                  </span>
                </div>
              )}

              {isBanned && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-center gap-2">
                  <Ban className="w-4 h-4 text-red-700 shrink-0" />
                  <span>
                    <span className="font-semibold">Banned Card: </span>
                    {card.name} cannot be included in official tournament decks (0 copies allowed).
                  </span>
                </div>
              )}

              {card.summonCondition && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950">
                  <span className="font-semibold">
                    {usesAdventSummon ? 'Summon / Advent Condition: ' : 'Summon Condition: '}
                  </span>
                  <EffectTextWithSymbols text={card.summonCondition} />
                </div>
              )}

              {!card.levels?.length && (card.braveCondition || card.braveBonusBp !== undefined) && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-700">
                    <span className="font-semibold text-slate-900">Brave Condition: </span>
                    <EffectTextWithSymbols text={card.braveCondition || 'None'} />
                  </span>
                  {card.braveBonusBp !== undefined && (
                    <span className="font-mono font-semibold text-red-700 tabular-nums shrink-0">
                      +{card.braveBonusBp.toLocaleString()} BP
                    </span>
                  )}
                </div>
              )}

              {card.levels && card.levels.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-2">
                    Level Thresholds &amp; Battle Points
                  </h3>
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                    {card.levels.map((lvl) => (
                      <div
                        key={lvl.level}
                        className="px-3.5 py-2.5 flex items-center justify-between text-sm bg-white"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-slate-900 tabular-nums">
                            LV{lvl.level}
                          </span>
                          <span className="text-xs text-slate-500 font-mono tabular-nums">
                            {lvl.cores} {lvl.cores === 1 ? 'Core' : 'Cores'}
                          </span>
                        </div>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {lvl.bp > 0 ? `${lvl.bp.toLocaleString()} BP` : 'Nexus Effect'}
                        </span>
                      </div>
                    ))}
                    {(card.braveBonusBp !== undefined || card.braveCondition) && (
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-sm bg-slate-50">
                        <span className="text-xs font-medium text-slate-600">
                          <span className="font-semibold text-slate-800">Brave Condition: </span>
                          <EffectTextWithSymbols text={card.braveCondition || '—'} />
                        </span>
                        {card.braveBonusBp !== undefined && (
                          <span className="font-mono font-semibold text-red-700 tabular-nums shrink-0">
                            +{card.braveBonusBp.toLocaleString()} BP
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-slate-500 mb-2">
                  English Card Effects
                </h3>
                {card.effects.length > 0 ? (
                  <div className="space-y-2.5">
                    {card.effects.map((eff, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1"
                      >
                        <div className={`text-xs font-semibold ${meta.text}`}>
                          <EffectTextWithSymbols text={eff.timing} />
                        </div>
                        <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                          <EffectTextWithSymbols text={eff.text} />
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500">
                    No effect text recorded for this card.
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  {card.flavorText && (
                    <p className="text-xs italic text-slate-500 leading-relaxed">
                      &ldquo;{card.flavorText}&rdquo;
                    </p>
                  )}
                  {card.illustrator && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Illustrated by {card.illustrator}
                    </p>
                  )}
                </div>

                <a
                  href={card.wikiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center justify-center gap-2 shrink-0 transition-colors"
                >
                  <span>Battle Spirits Wiki</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                </a>
              </div>

              {card.rulings.length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-xs font-semibold text-slate-500">
                      Official Card Rulings Q&amp;A ({card.rulings.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => setRulingsModalOpen(true)}
                      className="text-xs font-semibold text-red-700 hover:text-red-800 hover:underline cursor-pointer"
                    >
                      Open Rulings Modal
                    </button>
                  </div>
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                    {card.rulings.map((r, idx) => {
                      const isOpen = openRulingIdx === idx;
                      return (
                        <div key={idx}>
                          <button
                            type="button"
                            onClick={() => setOpenRulingIdx(isOpen ? null : idx)}
                            className="w-full min-h-[44px] px-3.5 py-2.5 text-left flex items-center justify-between gap-3 text-xs font-semibold text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <span>Q: {r.question}</span>
                            {isOpen ? (
                              <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                          </button>
                          {isOpen && (
                            <div className="px-3.5 pb-3 text-xs text-slate-600 leading-relaxed bg-slate-50/70">
                              A: <EffectTextWithSymbols text={r.answer} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 sm:px-6 py-3 pb-safe border-t border-slate-200 bg-white flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
          {compareMode && compareCard ? (
            <button
              type="button"
              onClick={() => setPickerOpen((prev) => !prev)}
              className="min-h-[44px] w-full sm:w-auto px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>{pickerOpen ? 'Hide Card Picker' : 'Switch 2nd Card'}</span>
            </button>
          ) : (
            <div className="hidden sm:block" />
          )}

          {isToken && deckQty === 0 ? (
            <div className="min-h-[44px] px-4 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold inline-flex items-center justify-center gap-2 w-full sm:w-auto">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>Token Card · Used Outside Main Deck</span>
            </div>
          ) : (
            <div className="flex items-center bg-red-600 text-white rounded-xl overflow-hidden w-full sm:w-auto justify-between sm:justify-start">
              <button
                type="button"
                onClick={() => onUpdateDeckQty(card.id, -1)}
                disabled={deckQty <= 0}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-red-700 disabled:opacity-40 cursor-pointer"
                aria-label="Remove one copy from deck"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="px-3 flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
                <Layers className="w-3.5 h-3.5" />
                <span className="truncate max-w-[140px]">{activeDeckName}</span>
                <span className="font-mono tabular-nums">
                  ({deckQty}/{maxCopies})
                </span>
              </div>
              <button
                type="button"
                onClick={() => onUpdateDeckQty(card.id, 1)}
                disabled={deckQty >= maxCopies}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-red-700 disabled:opacity-40 cursor-pointer"
                aria-label="Add one copy to deck"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {rulingsModalOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rulings-modal-title"
          data-no-swipe="true"
          onClick={(e) => {
            e.stopPropagation();
            setRulingsModalOpen(false);
          }}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[88vh] bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Scale className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {card.cardNumber}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Official Rulings ({card.rulings.length})
                  </span>
                </div>
                <h3
                  id="rulings-modal-title"
                  className="mt-1 font-display text-lg sm:text-xl font-bold text-slate-950 leading-snug line-clamp-2"
                >
                  {card.name}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setRulingsModalOpen(false)}
                className="min-h-[44px] min-w-[44px] -mr-1.5 -mt-0.5 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-950 shrink-0 cursor-pointer"
                aria-label="Close official rulings modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {card.rulings.length >= 3 && (
              <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-100 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={rulingsQuery}
                    onChange={(e) => setRulingsQuery(e.target.value)}
                    placeholder="Filter Q&A rulings by keyword..."
                    className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>
            )}

            <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4 space-y-3">
              {filteredModalRulings.length > 0 ? (
                filteredModalRulings.map((r, idx) => (
                  <div
                    key={`${idx}-${r.question.slice(0, 24)}`}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="font-mono text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-lg shrink-0 tabular-nums mt-0.5">
                        Q{idx + 1}
                      </span>
                      <p className="text-xs sm:text-sm font-bold text-slate-900 leading-snug">
                        <EffectTextWithSymbols text={r.question} />
                      </p>
                    </div>
                    <div className="pl-2 border-l-2 border-slate-300 ml-3 text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                      <span className="font-semibold text-slate-900">Answer: </span>
                      <EffectTextWithSymbols text={r.answer} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-3">
                  <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-slate-900">
                      {rulingsQuery.trim()
                        ? 'No rulings match your search'
                        : 'No official Q&A rulings recorded'}
                    </div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      {rulingsQuery.trim()
                        ? `No Q&A entries matched "${rulingsQuery.trim()}".`
                        : `${card.name} does not have card-specific Q&A entries in the current card dataset.`}
                    </p>
                  </div>
                  {!rulingsQuery.trim() && card.wikiUrl && (
                    <a
                      href={card.wikiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>View Card Page on Battle Spirits Wiki</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 sm:px-6 py-3 pb-safe border-t border-slate-200 bg-white flex items-center justify-between gap-2 shrink-0">
              {card.wikiUrl ? (
                <a
                  href={card.wikiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors"
                >
                  <span>Wiki Page</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setRulingsModalOpen(false)}
                className="min-h-[44px] px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
          data-no-swipe="true"
          onClick={(e) => {
            e.stopPropagation();
            setShareModalOpen(false);
          }}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[90vh] bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Share2 className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span>Social Card Image · 1200×630</span>
                </div>
                <h3
                  id="share-modal-title"
                  className="mt-1 font-display text-lg sm:text-xl font-bold text-slate-950 truncate"
                >
                  Share {card.name}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setShareModalOpen(false)}
                className="min-h-[44px] min-w-[44px] -mr-1.5 -mt-0.5 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-950 shrink-0 cursor-pointer"
                aria-label="Close share image modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4 space-y-4">
              <div className="rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 aspect-[1200/630] flex items-center justify-center">
                {generatingShareImage ? (
                  <div className="flex flex-col items-center gap-2 text-slate-300 text-xs">
                    <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                    <span>Rendering social share card...</span>
                  </div>
                ) : shareError ? (
                  <div className="p-6 text-center text-xs text-red-300">
                    {shareError}
                  </div>
                ) : shareResult ? (
                  <img
                    src={shareResult.objectUrl}
                    alt={`${card.name} social share preview`}
                    className="w-full h-full object-contain"
                  />
                ) : null}
              </div>

              {shareFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                    shareFeedback.kind === 'info'
                      ? 'bg-amber-50 border border-amber-200 text-amber-900'
                      : 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                  }`}
                >
                  {shareFeedback.kind !== 'info' && (
                    <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  )}
                  <span>{shareFeedback.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={handleCopyShareImage}
                  disabled={!shareResult || generatingShareImage}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-900 inline-flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  {shareFeedback?.kind === 'copied' ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-slate-600" />
                  )}
                  <span>Copy Image</span>
                </button>

                <button
                  type="button"
                  onClick={handleNativeShareImage}
                  disabled={!shareResult || generatingShareImage}
                  className="min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Share</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadShareImage}
                  disabled={!shareResult || generatingShareImage}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Save PNG</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {fullImageOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            setFullImageOpen(false);
          }}
          onTouchStart={handleSwipeTouchStart}
          onTouchMove={handleSwipeTouchMove}
          onTouchEnd={handleSwipeTouchEnd}
          onTouchCancel={handleSwipeTouchEnd}
        >
          <button
            type="button"
            onClick={() => setFullImageOpen(false)}
            className="absolute top-4 right-4 min-h-[44px] min-w-[44px] rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer z-10"
            aria-label="Close full image preview"
          >
            <X className="w-6 h-6" />
          </button>

          <div
            className="relative flex items-center justify-center w-full max-w-lg gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {hasNavigation && (
              <button
                type="button"
                onClick={() => navigateAdjacent('prev')}
                disabled={!prevCard}
                className="min-h-[44px] min-w-[44px] rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-25 text-white flex items-center justify-center cursor-pointer shrink-0"
                aria-label={prevCard ? `Previous card: ${prevCard.name}` : 'No previous card'}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            <div
              className="w-full max-w-md max-h-[80vh] aspect-[5/7] rounded-2xl overflow-hidden bg-slate-950 shadow-2xl transition-transform duration-150 ease-out"
              style={{
                transform: `translate3d(${dragOffsetX}px, 0, 0)`,
              }}
            >
              <CardArtwork
                card={card}
                imageUrl={activeArt?.url}
                fit="contain"
                eager
                className="w-full h-full bg-slate-950"
              />
            </div>

            {hasNavigation && (
              <button
                type="button"
                onClick={() => navigateAdjacent('next')}
                disabled={!nextCard}
                className="min-h-[44px] min-w-[44px] rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-25 text-white flex items-center justify-center cursor-pointer shrink-0"
                aria-label={nextCard ? `Next card: ${nextCard.name}` : 'No next card'}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="mt-3 text-center text-xs text-slate-200 max-w-md px-3">
            <div className="font-semibold">
              {card.name}
              {hasNavigation && (
                <span className="ml-2 font-mono text-slate-400 tabular-nums">
                  ({navIndex + 1}/{navigableCards.length})
                </span>
              )}
            </div>
            {activeArt?.caption && (
              <div className="text-slate-400 mt-0.5">{activeArt.caption}</div>
            )}
            {hasNavigation && (
              <div className="text-[11px] text-slate-400 mt-1 sm:hidden">
                Swipe left or right to switch cards
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
