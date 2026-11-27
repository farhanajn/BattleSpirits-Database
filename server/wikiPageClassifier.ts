import {
  cleanWikitextInline,
  extractTaggedCardTableBlocks,
  parseSetTableRows,
  parseTemplateFields,
} from './wikiService.ts';
import type { ProductSet } from '../src/types/card.ts';

export type WikiPageClassification =
  | 'confirmed_card'
  | 'confirmed_card_list'
  | 'confirmed_set_or_product'
  | 'confirmed_non_card'
  | 'uncertain_needs_review';

export interface WikiPageAnalysis {
  classification: WikiPageClassification;
  confidence: number;
  signals: string[];
  reason: string;
  hasCardTable: boolean;
  hasSetTable: boolean;
  suggestedCardTitle?: string;
  detectedSetCode?: string;
  nonCardSubtype?: 'system' | 'character' | 'anime' | 'magazine' | 'glossary' | 'other';
}

const STRICT_SYSTEM_TITLE_RE =
  /^(?:Category|File|Image|Template|User|Talk|Help|Module|Special|MediaWiki):|^(?:Introduction|Contents|External Articles|Main Page|Card Sets|Banned and Restricted Cards|Battle Spirits Wiki)$/i;

const MAGAZINE_TITLE_RE = /^(?:V Jump|Saikyo Jump|Kerokero Ace|Card Gamer)$/i;

const ANIME_SERIES_TITLE_RE =
  /^(?:Battle Spirits\s+(?:Shounen\s+(?:Toppa\s+Bashin|Gekiha\s+Dan)|Brave|Heroes|Sword\s+Eyes|Burning\s+Soul|Double\s+Drive)|Saikyo\s+Ginga\s+Ultimate\s+Zero\s+(?:~?\s*)?Battle\s+Spirits(?:\s*~)?)$/i;

const SET_OR_PRODUCT_TITLE_RE =
  /^(?:Limited Pack(?:\s*:|\s+MAX|\s+\d{4}|.*Edition)|LM\d{2}[A-Z]?|SJ\d{2}[A-Z]?|Card Gamer Volume \d+.*Pack.*|(?:Standard\s+)?Promo Cards(?:\/.*)?)$/i;

const SET_OR_PRODUCT_CATEGORY_RE =
  /\[\[Category:(?:Sets|Booster Sets|Starter Decks|Structure Decks|Supplementary Sets|Collab Boosters|English Sets|Hong Kong Sets|Japanese Sets|Card Sets|Limited Pack|Promo Sets|Jump Promos|Promotional Packs)\]\]/i;

const NON_CARD_INFOBOX_RE =
  /\{\{\s*(?:Template:)?(?:Infobox_Character|CharacterInfo|Infobox\s+Character|Anime\s+Infobox|Episode\s+Infobox|Magazine\s+Infobox|Manga\s+Infobox)\b/i;

const NON_CARD_CATEGORY_RE =
  /\[\[Category:(?:Characters|Episodes|Anime|Manga|Magazines|Keywords|Glossary|Mechanics|Rulings|Card Mechanics|Rulebook|Banners|Templates)\]\]/i;

export function isStrictSystemWikiTitle(title?: string | null): boolean {
  const clean = (title || '').trim();
  if (!clean) return false;
  return STRICT_SYSTEM_TITLE_RE.test(clean);
}

/**
 * Extracts disambiguation/hatnote pointer to the actual card article on non-card pages
 * e.g. `''For the card of the same name, see [[Cast Off (Card)]].''` -> `"Cast Off (Card)"`.
 */
export function extractSuggestedCardTitleFromWikitext(wikitext?: string | null): string | undefined {
  const wt = wikitext || '';
  if (!wt) return undefined;
  const hatnoteMatch = wt.match(
    /For\s+the\s+card(?:\s+of\s+the\s+same\s+name)?[^,\n]*,\s*see\s*\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/i
  );
  if (hatnoteMatch?.[1]) {
    const candidate = hatnoteMatch[1].trim();
    if (candidate && !STRICT_SYSTEM_TITLE_RE.test(candidate)) {
      return candidate;
    }
  }
  const directCardParen = wt.match(/\{\{(?:For|About|Redirect|Main)[^}]*\[\[([^\]|#]+\(Card\))(?:\|[^\]]+)?\]\]/i);
  if (directCardParen?.[1]) {
    return directCardParen[1].trim();
  }
  return undefined;
}

/**
 * Multi-signal Battle Spirits Wiki page classifier separating:
 * A. Confirmed individual card pages
 * B. Confirmed multi-card list pages
 * C. Confirmed set / limited pack / promo product pages
 * D. Confirmed non-card pages (characters, anime, magazines, keyword glossaries, system pages)
 * E. Uncertain pages requiring manual review
 */
export function classifyWikiPageBundle(
  title: string,
  wikitext: string,
  _pageImages: string[] = []
): WikiPageAnalysis {
  const cleanTitle = (title || '').trim();
  const wt = (wikitext || '').trim();
  const signals: string[] = [];

  if (isStrictSystemWikiTitle(cleanTitle)) {
    return {
      classification: 'confirmed_non_card',
      confidence: 99,
      signals: ['strict_system_title'],
      reason: `"${cleanTitle}" is a Wiki system/navigation page`,
      hasCardTable: false,
      hasSetTable: false,
      nonCardSubtype: 'system',
    };
  }

  const taggedBlocks = wt ? extractTaggedCardTableBlocks(wt) : [];
  const hasCardTable = taggedBlocks.length > 0 || /\{\{\s*CardTable/i.test(wt);
  let hasCardFields = false;
  if (taggedBlocks.length > 0) {
    const fields = parseTemplateFields(taggedBlocks[0].block);
    hasCardFields = Boolean(
      fields.cost ||
        fields.color ||
        fields.type ||
        fields.effect ||
        fields.level ||
        fields.family ||
        fields.kanji ||
        fields.cardnum ||
        fields.image
    );
  }
  const hasCardCategory =
    /\[\[Category:(?:Spirit Cards|Magic Cards|Nexus Cards|Brave Cards|Ultimate Cards|Revival Cards|Token Cards)\]\]/i.test(
      wt
    );

  if (hasCardTable) {
    signals.push('card_table_template');
    if (hasCardFields) signals.push('card_table_fields');
    if (hasCardCategory) signals.push('card_category');
    return {
      classification: 'confirmed_card',
      confidence: hasCardFields ? 99 : 90,
      signals,
      reason: 'Page contains CardTable template with card attributes',
      hasCardTable: true,
      hasSetTable: false,
    };
  }

  // Gather structural signals when CardTable is absent
  const suggestedCardTitle = extractSuggestedCardTitleFromWikitext(wt);
  const hasNonCardInfobox = NON_CARD_INFOBOX_RE.test(wt);
  const hasNonCardCategory = NON_CARD_CATEGORY_RE.test(wt);
  const isMagazineTitle = MAGAZINE_TITLE_RE.test(cleanTitle);
  const isAnimeTitle = ANIME_SERIES_TITLE_RE.test(cleanTitle);
  const hasKeywordGlossaryIntro =
    /'''[^']+'''\s*(?:\([^)]+\))?\s*(?:is|was)\s+a(?:n)?\s+(?:keyword|special\s+ability|effect|mechanic|card\s+type|term|anime|manga|magazine)/i.test(
      cleanWikitextInline(wt.slice(0, 700))
    );

  const hasSetIntroHeader =
    /!\s*colspan=["']?\d+["']?[^|\n]*\|\s*Introduction/i.test(wt) ||
    /(?:was|is)\s+an?\s+(?:event-limited|limited|promo(?:tional)?|booster|supplementary|starter|mega\s+deck)\s+(?:card\s+)?(?:set|pack|deck)/i.test(
      cleanWikitextInline(wt.slice(0, 700))
    ) ||
    /==\s*(?:Card\s+List|Set\s+Images|Set\s+List|Included\s+Cards)\s*==/i.test(wt);
  const hasSetCategory = SET_OR_PRODUCT_CATEGORY_RE.test(wt);
  const matchesSetTitlePattern = SET_OR_PRODUCT_TITLE_RE.test(cleanTitle);

  let parsedTableRowCount = 0;
  let bulletCardLinkCount = 0;
  if (wt) {
    const dummySet: ProductSet = {
      setCode: cleanTitle.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 32) || 'SET',
      category: 'Promo',
      name: cleanTitle,
      jpName: '',
      productType: 'Promo Set',
      releaseDate: '',
      formats: ['Eternal'],
      blockLabel: '',
      tagline: '',
      featuredCardId: '',
      colors: ['Red'],
      totalCardsInSet: 0,
      wikiUrl: '',
    };
    const tableCards = parseSetTableRows(wt, dummySet, { resolveSubSeriesSets: false });
    parsedTableRowCount = tableCards.length;

    const numberedBulletRe =
      /^[*#]\s*(?:[A-Z0-9]{1,8}-[A-Z0-9]{1,8}|\d{1,3}[.\s:-])\s*\[\[[^\]|#]+/i;
    for (const line of wt.split('\n')) {
      if (numberedBulletRe.test(line.trim())) bulletCardLinkCount++;
    }
  }

  const hasSetTable = parsedTableRowCount >= 2;
  const isSetOrProduct =
    (hasSetIntroHeader && (hasSetTable || hasSetCategory || matchesSetTitlePattern || bulletCardLinkCount >= 2)) ||
    (hasSetCategory && (hasSetTable || bulletCardLinkCount >= 2 || hasSetIntroHeader)) ||
    (matchesSetTitlePattern && (hasSetTable || hasSetIntroHeader || hasSetCategory || bulletCardLinkCount >= 1));

  if (isSetOrProduct) {
    if (hasSetIntroHeader) signals.push('set_intro_or_section');
    if (hasSetCategory) signals.push('set_category');
    if (matchesSetTitlePattern) signals.push('set_title_pattern');
    if (hasSetTable) signals.push(`set_table_${parsedTableRowCount}_rows`);
    if (bulletCardLinkCount > 0) signals.push(`numbered_bullets_${bulletCardLinkCount}`);

    return {
      classification: 'confirmed_set_or_product',
      confidence: 95,
      signals,
      reason: `"${cleanTitle}" is a Battle Spirits set or promotional product page rather than a single card`,
      hasCardTable: false,
      hasSetTable,
    };
  }

  if (parsedTableRowCount >= 2 || bulletCardLinkCount >= 3) {
    if (parsedTableRowCount >= 2) signals.push(`card_list_table_${parsedTableRowCount}_rows`);
    if (bulletCardLinkCount >= 3) signals.push(`card_list_bullets_${bulletCardLinkCount}`);
    return {
      classification: 'confirmed_card_list',
      confidence: 90,
      signals,
      reason: `"${cleanTitle}" is a multi-card list page (${parsedTableRowCount} table rows, ${bulletCardLinkCount} listed cards)`,
      hasCardTable: false,
      hasSetTable,
    };
  }

  if (
    hasNonCardInfobox ||
    hasNonCardCategory ||
    isMagazineTitle ||
    isAnimeTitle ||
    hasKeywordGlossaryIntro ||
    Boolean(suggestedCardTitle)
  ) {
    let subtype: WikiPageAnalysis['nonCardSubtype'] = 'other';
    if (hasNonCardInfobox || /\[\[Category:Characters\]\]/i.test(wt)) {
      subtype = 'character';
      signals.push('character_infobox_or_category');
    } else if (isAnimeTitle || /\[\[Category:(?:Anime|Episodes)\]\]/i.test(wt)) {
      subtype = 'anime';
      signals.push('anime_series_article');
    } else if (isMagazineTitle || /\[\[Category:Magazines\]\]/i.test(wt)) {
      subtype = 'magazine';
      signals.push('magazine_article');
    } else if (hasKeywordGlossaryIntro || suggestedCardTitle || /\[\[Category:(?:Keywords|Glossary|Mechanics)\]\]/i.test(wt)) {
      subtype = 'glossary';
      signals.push('keyword_glossary_article');
    } else {
      signals.push('non_card_category');
    }
    if (suggestedCardTitle) {
      signals.push(`hatnote_card_link:${suggestedCardTitle}`);
    }

    return {
      classification: 'confirmed_non_card',
      confidence: 94,
      signals,
      reason: suggestedCardTitle
        ? `"${cleanTitle}" is a ${subtype} article pointing to card "${suggestedCardTitle}"`
        : `"${cleanTitle}" is a non-card Wiki article (${subtype})`,
      hasCardTable: false,
      hasSetTable: false,
      suggestedCardTitle,
      nonCardSubtype: subtype,
    };
  }

  if (!wt) {
    return {
      classification: 'uncertain_needs_review',
      confidence: 0,
      signals: ['empty_wikitext'],
      reason: `"${cleanTitle}" has no readable Wiki content yet`,
      hasCardTable: false,
      hasSetTable: false,
    };
  }

  return {
    classification: 'uncertain_needs_review',
    confidence: 35,
    signals: ['no_card_table', 'no_set_table'],
    reason: `"${cleanTitle}" lacks both CardTable and multi-card set structure`,
    hasCardTable: false,
    hasSetTable: false,
  };
}
