import { useEffect, useMemo, useRef, useState } from 'react';
import type { BattleSpiritsCard } from '../types/card';
import {
  buildFallbackWikiImageUrl,
  buildWikiImageUrl,
  getCachedWikiImageStatus,
  preloadWikiImage,
} from '../utils/wikiImageClient';

export interface UseWikiImagePrefetchOptions {
  /** Ordered list of cards in the active gallery, grid, or deck view */
  cards: BattleSpiritsCard[];
  /** Index of the active or furthest currently visible card */
  currentIndex?: number;
  /** Number of upcoming cards to pre-fetch after currentIndex */
  lookahead?: number;
  /** Number of preceding cards to keep warm for back navigation */
  lookbehind?: number;
  /** Additional artwork URLs (e.g. alternate arts on the active card) */
  extraUrls?: string[];
  /** Enable or pause pre-fetching */
  enabled?: boolean;
  /** Maximum concurrent image requests */
  maxConcurrent?: number;
  /** Delay before starting prefetch to avoid thrashing during rapid scroll/swipe */
  delayMs?: number;
}

interface PrefetchTarget {
  primaryUrl: string;
  fallbackUrl?: string;
}

/**
 * Pre-fetches and caches upcoming card artwork images via wikiImageClient
 * so gallery browsing, grid scrolling, and card-to-card swiping render smoothly.
 */
export function useWikiImagePrefetch({
  cards,
  currentIndex = 0,
  lookahead = 6,
  lookbehind = 1,
  extraUrls = [],
  enabled = true,
  maxConcurrent = 3,
  delayMs = 90,
}: UseWikiImagePrefetchOptions): {
  queuedCount: number;
  prefetchedCount: number;
  isPrefetching: boolean;
} {
  const [prefetchedCount, setPrefetchedCount] = useState(0);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const sessionCompletedRef = useRef(0);

  const safeAnchor = useMemo(() => {
    if (cards.length === 0) return 0;
    return Math.max(0, Math.min(cards.length - 1, Math.floor(currentIndex)));
  }, [cards.length, currentIndex]);

  const targets = useMemo<PrefetchTarget[]>(() => {
    if (!enabled) return [];

    const collected: PrefetchTarget[] = [];
    const seenPrimary = new Set<string>();

    const pushTarget = (primaryRaw: string, fallbackRaw?: string) => {
      const primaryUrl = primaryRaw.trim();
      if (!primaryUrl || seenPrimary.has(primaryUrl)) return;
      seenPrimary.add(primaryUrl);
      const primaryStatus = getCachedWikiImageStatus(primaryUrl);
      const fallbackUrl =
        fallbackRaw && fallbackRaw.trim() !== primaryUrl ? fallbackRaw.trim() : undefined;

      if (primaryStatus === 'loaded') return;
      if (primaryStatus === 'error') {
        if (fallbackUrl && getCachedWikiImageStatus(fallbackUrl) === null) {
          collected.push({ primaryUrl: fallbackUrl });
        }
        return;
      }

      collected.push({ primaryUrl, fallbackUrl });
    };

    // 1. Extra gallery URLs for currently inspected card take top priority
    for (const url of extraUrls) {
      if (url) pushTarget(url);
    }

    if (cards.length > 0) {
      // 2. Next few cards ahead in the view (interleaved lookahead priority)
      const maxEnd = Math.min(cards.length - 1, safeAnchor + Math.max(0, lookahead));
      for (let i = safeAnchor; i <= maxEnd; i++) {
        const card = cards[i];
        if (!card) continue;
        pushTarget(buildWikiImageUrl(card), buildFallbackWikiImageUrl(card));
      }

      // 3. Immediate previous cards for fast reverse swipe/scroll
      const minStart = Math.max(0, safeAnchor - Math.max(0, lookbehind));
      for (let i = safeAnchor - 1; i >= minStart; i--) {
        const card = cards[i];
        if (!card) continue;
        pushTarget(buildWikiImageUrl(card), buildFallbackWikiImageUrl(card));
      }
    }

    return collected;
  }, [enabled, cards, safeAnchor, lookahead, lookbehind, extraUrls]);

  useEffect(() => {
    if (!enabled || targets.length === 0 || typeof window === 'undefined') {
      setIsPrefetching(false);
      return;
    }

    let cancelled = false;
    const queue = [...targets];
    let activeWorkers = 0;

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setIsPrefetching(true);

      const pump = () => {
        if (cancelled) return;
        if (queue.length === 0 && activeWorkers === 0) {
          setIsPrefetching(false);
          return;
        }

        const concurrency = Math.max(1, Math.min(4, maxConcurrent));
        while (!cancelled && activeWorkers < concurrency && queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          activeWorkers++;

          preloadWikiImage(item.primaryUrl)
            .then(async (ok) => {
              if (cancelled) return false;
              if (!ok && item.fallbackUrl && getCachedWikiImageStatus(item.fallbackUrl) === null) {
                return preloadWikiImage(item.fallbackUrl);
              }
              return ok;
            })
            .then((ok) => {
              if (!cancelled && ok) {
                sessionCompletedRef.current += 1;
                setPrefetchedCount(sessionCompletedRef.current);
              }
            })
            .finally(() => {
              activeWorkers--;
              pump();
            });
        }
      };

      pump();
    }, Math.max(0, delayMs));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, targets, maxConcurrent, delayMs]);

  return {
    queuedCount: targets.length,
    prefetchedCount,
    isPrefetching,
  };
}
