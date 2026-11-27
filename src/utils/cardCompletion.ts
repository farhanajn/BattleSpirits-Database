import type {
  BattleSpiritsCard,
  CardArtworkStatus,
  CardCompletionStatus,
  CardEffectStatus,
  CardMetadataStatus,
} from '../types/card.ts';

export const SENTINEL_EFFECT_PATTERNS: RegExp[] = [
  /^no english effect text listed on this card\.?$/i,
  /^no effect text recorded for this card\.?$/i,
  /^no english effect text available\.?$/i,
  /^no effect text\.?$/i,
  /^[-–—]+$/,
  /^(?:none|n\/a|tbd|unknown)$/i,
];

const PLACEHOLDER_OR_ICON_FILE_RE =
  /^bs_(?:red_dragon|purple_phantom|white_mecha|yellow_seraph|green_beast|blue_titan|contract_|standard_banner|arcane_magic|relic_brave)|(?:^|[_/\s:-])(?:(?:stan|red|purple|white|yellow|green|blue|gold|god|soul|ultimate|omni|all)[_\s]+)?(?:core|symbol|gem|ex[_\s]+symbol)(?:[_.\s]|$)|(?:^|[_/\s:-])(?:reduction|flash\d*|bursticon|burst_?mark|mirage\d*|contract\d*|flag\d*|lv\d+|block[_\s]?\d*|rarity|icon|symbol|banner|logo|mini|mark|counter|button|template)\.(?:png|jpe?g|webp|gif|svg)|^(?:(?:left|right|up|down|next|prev|back)[_\s-]*)?arrow\d*\.(?:png|jpe?g|webp|gif|svg)|(?:stan_?soul_?core|soul_?core|ex_?symbol|reduction\.png|rarity_|button|banner\.jpe?g)/i;

export function isSentinelEffectText(raw?: string | null): boolean {
  const clean = (raw || '').replace(/\s+/g, ' ').trim();
  if (!clean) return true;
  return SENTINEL_EFFECT_PATTERNS.some((re) => re.test(clean));
}

export function sanitizeEffectsArray(
  effects?: Array<{ timing?: string; text?: string }> | null
): Array<{ timing: string; text: string }> {
  if (!Array.isArray(effects) || effects.length === 0) return [];
  const cleaned: Array<{ timing: string; text: string }> = [];
  for (const eff of effects) {
    const text = (eff?.text || '').trim();
    if (!text || isSentinelEffectText(text)) continue;
    cleaned.push({
      timing: (eff?.timing || 'Effect').trim() || 'Effect',
      text,
    });
  }
  return cleaned;
}

export function hasMeaningfulEffects(
  effects?: Array<{ timing?: string; text?: string }> | null
): boolean {
  return sanitizeEffectsArray(effects).length > 0;
}

export function extractArtworkFileParam(artworkImage?: string | null): string {
  const raw = (artworkImage || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/api/wiki/image')) {
    const m = raw.match(/[?&]file=([^&]+)/);
    if (!m) return '';
    try {
      return decodeURIComponent(m[1]).trim();
    } catch {
      return m[1].trim();
    }
  }
  if (/^https?:\/\//i.test(raw)) {
    const lastSeg = raw.split('/revision/')[0].split('/').pop() || '';
    try {
      return decodeURIComponent(lastSeg).trim();
    } catch {
      return lastSeg.trim();
    }
  }
  if (raw.startsWith('/images/')) {
    return raw.slice('/images/'.length).trim();
  }
  return raw;
}

export function isPlaceholderArtworkUrl(artworkImage?: string | null): boolean {
  const raw = (artworkImage || '').trim();
  if (!raw) return false;
  if (/^data:image\/svg\+xml/i.test(raw)) return true;
  if (raw.startsWith('/images/')) {
    const fname = raw.slice('/images/'.length);
    return PLACEHOLDER_OR_ICON_FILE_RE.test(fname);
  }
  const fileParam = extractArtworkFileParam(raw);
  if (fileParam && PLACEHOLDER_OR_ICON_FILE_RE.test(fileParam)) return true;
  return false;
}

export function isDirectVerifiedArtworkUrl(artworkImage?: string | null): boolean {
  const raw = (artworkImage || '').trim();
  if (!raw || isPlaceholderArtworkUrl(raw)) return false;
  return (
    /^https:\/\/static\.wikia\.nocookie\.net\/battle-spirits\//i.test(raw) ||
    /^https:\/\/vignette\.wikia\.nocookie\.net\//i.test(raw)
  );
}

const NON_CARD_TITLE_RE =
  /^(?:Introduction|Contents|External Articles|Main Page|Card Sets|Banned and Restricted Cards|Battle Spirits Wiki|V Jump|Saikyo Jump|Kerokero Ace|Promo Cards(?:\/.*)?|Standard Promo Cards(?:\/.*)?)$/i;

export function isLikelyNonCardWikiTitle(title?: string | null): boolean {
  const clean = (title || '').trim();
  if (!clean) return false;
  if (/^(?:Category|File|Image|Template|User|Talk|Help|Module|Special|MediaWiki):/i.test(clean)) {
    return true;
  }
  if (NON_CARD_TITLE_RE.test(clean)) return true;
  if (/^(?:Promo Cards|Standard Promo Cards)\//i.test(clean)) return true;
  return false;
}

export interface CardCompletenessHints {
  hasCardTable?: boolean;
  wikitextEmpty?: boolean;
  hasNoPrintedEffectCategory?: boolean;
  hasJpEffectOnly?: boolean;
  artworkFileExists?: boolean;
  artworkFailureReason?: 'unavailable_on_wiki' | 'broken_url' | 'placeholder' | 'missing';
  isNonCardPage?: boolean;
  wikiPageType?:
    | 'confirmed_card'
    | 'confirmed_card_list'
    | 'confirmed_set_or_product'
    | 'confirmed_non_card'
    | 'uncertain_needs_review';
  wikiMatchConfidence?: number;
}

export interface EvaluatedCompleteness {
  artworkVerified: boolean;
  artworkStatus: CardArtworkStatus;
  effectVerified: boolean;
  effectStatus: CardEffectStatus;
  metadataVerified: boolean;
  metadataStatus: CardMetadataStatus;
  completionStatus: CardCompletionStatus;
  unavailableFields: string[];
  failedFields: string[];
  needsManualReview: boolean;
  wikiMatchConfidence?: number;
}

export function evaluateCardCompleteness(
  card: Partial<BattleSpiritsCard>,
  hints?: CardCompletenessHints
): EvaluatedCompleteness {
  const cleanEffects = sanitizeEffectsArray(card.effects);
  const hasRealEffects = cleanEffects.length > 0;
  const artRaw = (card.artworkImage || '').trim();
  const isPlaceholder = isPlaceholderArtworkUrl(artRaw);

  // Artwork evaluation
  let artworkStatus: CardArtworkStatus;
  let artworkVerified = false;
  if (hints?.artworkFileExists === true && artRaw && !isPlaceholder) {
    artworkStatus = 'verified';
    artworkVerified = true;
  } else if (hints?.artworkFileExists === false) {
    if (hints.artworkFailureReason === 'unavailable_on_wiki') {
      artworkStatus = 'unavailable';
    } else if (isPlaceholder) {
      artworkStatus = 'placeholder';
    } else if (!artRaw) {
      artworkStatus = hints.wikitextEmpty ? 'unavailable' : 'missing';
    } else {
      artworkStatus = 'broken';
    }
  } else if (isPlaceholder) {
    artworkStatus = 'placeholder';
  } else if (!artRaw) {
    artworkStatus =
      card.artworkStatus === 'unavailable' || hints?.wikitextEmpty ? 'unavailable' : 'missing';
  } else if (card.artworkVerified === true || card.artworkStatus === 'verified' || isDirectVerifiedArtworkUrl(artRaw)) {
    artworkStatus = 'verified';
    artworkVerified = true;
  } else if (card.artworkStatus === 'broken' || card.artworkStatus === 'unavailable') {
    artworkStatus = card.artworkStatus;
  } else {
    artworkStatus = card.artworkStatus || 'missing';
  }

  // Effect evaluation
  let effectStatus: CardEffectStatus;
  let effectVerified = false;
  if (hasRealEffects) {
    effectStatus = 'verified';
    effectVerified = true;
  } else if (hints?.hasNoPrintedEffectCategory || card.effectStatus === 'no_printed_effect') {
    effectStatus = 'no_printed_effect';
    effectVerified = true;
  } else if (hints?.hasJpEffectOnly || hints?.wikitextEmpty || card.effectStatus === 'unavailable') {
    effectStatus = 'unavailable';
  } else if (card.effectStatus === 'failed') {
    effectStatus = 'failed';
  } else {
    effectStatus = 'missing';
  }

  // Metadata evaluation
  const needsFamily =
    !card.isToken &&
    card.type !== 'Magic' &&
    card.type !== 'Nexus';
  const hasFamilies = Array.isArray(card.families) && card.families.length > 0;
  const hasBasicIdentity = Boolean(
    card.cardNumber?.trim() &&
      (card.name?.trim() || card.jpName?.trim()) &&
      card.setCode?.trim()
  );

  let metadataStatus: CardMetadataStatus;
  let metadataVerified = false;
  if (hints?.wikitextEmpty) {
    metadataStatus = 'unavailable';
  } else if (!hasBasicIdentity || !card.isWikiLoaded || (needsFamily && !hasFamilies)) {
    metadataStatus = 'incomplete';
  } else {
    metadataStatus = 'verified';
    metadataVerified = true;
  }

  const unavailableFields = Array.from(
    new Set([
      ...(artworkStatus === 'unavailable' ? ['artwork'] : []),
      ...(effectStatus === 'unavailable' ? ['effectText'] : []),
      ...(metadataStatus === 'unavailable' ? ['metadata'] : []),
    ])
  );

  const failedFields = Array.from(
    new Set([
      ...(artworkStatus === 'broken' || artworkStatus === 'placeholder' ? ['artwork'] : []),
      ...(effectStatus === 'failed' ? ['effectText'] : []),
    ])
  );

  const isNonCard = Boolean(
    hints?.isNonCardPage ||
      card.needsManualReview ||
      isLikelyNonCardWikiTitle(card.wikiTitle || card.name)
  );

  let completionStatus: CardCompletionStatus;
  if (isNonCard) {
    completionStatus = 'needs_review';
  } else if (artworkVerified && effectVerified && metadataVerified) {
    completionStatus = 'complete';
  } else if (card.isWikiLoaded || artworkVerified || effectVerified) {
    completionStatus = 'partial';
  } else {
    completionStatus = 'incomplete';
  }

  return {
    artworkVerified,
    artworkStatus,
    effectVerified,
    effectStatus,
    metadataVerified,
    metadataStatus,
    completionStatus,
    unavailableFields,
    failedFields,
    needsManualReview: isNonCard,
    wikiMatchConfidence: hints?.wikiMatchConfidence ?? card.wikiMatchConfidence,
  };
}
