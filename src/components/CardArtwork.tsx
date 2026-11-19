import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BattleSpiritsCard } from '../types/card';
import { COLOR_META } from '../data/theme';
import {
  buildFallbackWikiImageUrl,
  buildWikiImageUrl,
  getCachedWikiImageStatus,
  markWikiImageError,
  markWikiImageLoaded,
} from '../utils/wikiImageClient';

interface CardArtworkProps {
  card: BattleSpiritsCard;
  imageUrl?: string;
  className?: string;
  fit?: 'cover' | 'contain';
  eager?: boolean;
}

export const CardArtwork: React.FC<CardArtworkProps> = ({
  card,
  imageUrl,
  className = '',
  fit = 'cover',
  eager = false,
}) => {
  const primarySrc = useMemo(
    () => buildWikiImageUrl(card, imageUrl),
    [card, imageUrl]
  );
  const fallbackSrc = useMemo(() => buildFallbackWikiImageUrl(card), [card]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<boolean>(
    () =>
      eager ||
      typeof IntersectionObserver === 'undefined' ||
      getCachedWikiImageStatus(primarySrc) === 'loaded'
  );
  const [useFallback, setUseFallback] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [finalError, setFinalError] = useState<boolean>(false);

  const meta = COLOR_META[card.color] || COLOR_META.Red;

  useEffect(() => {
    const primaryStatus = primarySrc ? getCachedWikiImageStatus(primarySrc) : 'error';
    const hasDistinctFallback = Boolean(fallbackSrc && fallbackSrc !== primarySrc);
    const fallbackStatus = hasDistinctFallback
      ? getCachedWikiImageStatus(fallbackSrc)
      : 'error';

    if (primaryStatus === 'error') {
      if (hasDistinctFallback && fallbackStatus !== 'error') {
        setUseFallback(true);
        setFinalError(false);
        setLoaded(false);
      } else {
        setUseFallback(false);
        setFinalError(true);
        setLoaded(false);
      }
    } else if (!primarySrc) {
      if (hasDistinctFallback && fallbackStatus !== 'error') {
        setUseFallback(true);
        setFinalError(false);
        setLoaded(false);
      } else {
        setUseFallback(false);
        setFinalError(true);
        setLoaded(false);
      }
    } else {
      setUseFallback(false);
      setFinalError(false);
      setLoaded(false);
    }
  }, [primarySrc, fallbackSrc]);

  useEffect(() => {
    if (eager || inView) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '260px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, inView]);

  const activeSrc = useFallback ? fallbackSrc : primarySrc;
  const shouldRenderImg = Boolean(activeSrc && !finalError && (eager || inView));

  const handleLoad = () => {
    if (activeSrc) markWikiImageLoaded(activeSrc);
    setLoaded(true);
  };

  const handleError = () => {
    if (activeSrc) markWikiImageError(activeSrc);
    if (!useFallback && fallbackSrc && fallbackSrc !== primarySrc) {
      const fbStatus = getCachedWikiImageStatus(fallbackSrc);
      if (fbStatus !== 'error') {
        setUseFallback(true);
        setLoaded(false);
        return;
      }
    }
    setFinalError(true);
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-gradient-to-br ${meta.gradient} ${className}`}
      aria-label={`${card.name} artwork`}
    >
      {/* Elemental SVG Illustration Backdrop / Final Fallback */}
      <svg
        viewBox="0 0 320 240"
        className={`w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
        preserveAspectRatio={fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`glow-${card.id}`} cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
            <stop offset="60%" stopColor={meta.hex} stopOpacity="0.18" />
            <stop offset="100%" stopColor="#090D16" stopOpacity="0.7" />
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill={`url(#glow-${card.id})`} />
        <g opacity="0.22" stroke="#FFFFFF" strokeWidth="1" fill="none">
          <circle cx="160" cy="112" r="78" />
          <circle cx="160" cy="112" r="54" strokeDasharray="6 5" />
          <polygon points="160,26 234,156 86,156" />
        </g>

        {card.artVariant === 'magic' && (
          <g transform="translate(160 112)" stroke="#FFFFFF" fill="none">
            <circle r="52" strokeWidth="2.2" opacity="0.9" />
            <circle r="36" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.75" />
            <polygon points="0,-46 40,24 -40,24" strokeWidth="2" opacity="0.9" />
            <polygon points="0,46 40,-24 -40,-24" strokeWidth="2" opacity="0.9" />
            <circle r="10" fill="#FFFFFF" opacity="0.9" />
          </g>
        )}

        {card.artVariant === 'nexus' && (
          <g transform="translate(160 120)" fill="#FFFFFF" opacity="0.88">
            <polygon points="-76,65 -42,-35 -12,65" opacity="0.55" />
            <polygon points="12,65 44,-45 78,65" opacity="0.55" />
            <polygon points="-32,65 0,-72 32,65" />
            <rect x="-85" y="62" width="170" height="6" rx="2" opacity="0.7" />
          </g>
        )}

        {card.artVariant === 'brave' && (
          <g transform="translate(160 115)" stroke="#FFFFFF" strokeWidth="2.5" fill="none" opacity="0.92">
            <path d="M0,-66 L14,-16 L0,64 L-14,-16 Z" fill="#FFFFFF" fillOpacity="0.22" />
            <path d="M-38,-14 L38,-14" strokeWidth="4" strokeLinecap="round" />
            <circle cx="0" cy="-14" r="9" fill="#FFFFFF" />
          </g>
        )}

        {['dragon', 'phantom', 'mecha', 'seraph', 'beast', 'titan'].includes(card.artVariant) && (
          <g transform="translate(160 114)" fill="#FFFFFF" opacity="0.9">
            <path
              d="M0,-58 L28,-12 L68,-26 L38,14 L46,56 L0,34 L-46,56 L-38,14 L-68,-26 L-28,-12 Z"
              fillOpacity="0.24"
              stroke="#FFFFFF"
              strokeWidth="2"
            />
            <polygon points="0,-34 20,10 0,34 -20,10" />
          </g>
        )}
      </svg>

      {/* Non-blocking loading shimmer + spinner while Wiki artwork loads */}
      {shouldRenderImg && !loaded && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/35 animate-pulse"
          aria-hidden="true"
        >
          <Loader2 className="w-5 h-5 text-white/80 animate-spin drop-shadow" />
        </div>
      )}

      {/* Wiki-streamed card artwork */}
      {shouldRenderImg && (
        <img
          src={activeSrc}
          alt={card.name}
          referrerPolicy="no-referrer"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${
            fit === 'contain'
              ? 'object-contain bg-slate-950'
              : 'object-cover transition-transform duration-300 group-hover:scale-[1.03]'
          }`}
        />
      )}

      {fit === 'cover' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
      )}
    </div>
  );
};
