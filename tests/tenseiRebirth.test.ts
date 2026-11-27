import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BattleSpiritsCard, FilterState } from '../src/types/card';
import { BATTLE_SPIRITS_CARDS, PRODUCT_SETS } from '../src/data/cards';
import { mergeCardsIntoMap } from '../src/App';
import {
  extractTenseiSideInfo,
  linkTenseiRebirthPairs,
} from '../src/utils/cardRules';
import { consolidateCatalogCards } from '../src/utils/reprintConsolidation';
import {
  filterConsolidatedCatalogCards,
  INITIAL_FILTER_STATE,
} from '../src/utils/cardFilterNormalization';
import { CardThumbnail } from '../src/components/CardThumbnail';
import { CardDetailSheet } from '../src/components/CardDetailSheet';

const cardsJsonPath = path.resolve(process.cwd(), 'public/cards.json');
const cardsJsonRaw = JSON.parse(fs.readFileSync(cardsJsonPath, 'utf8'));
const REAL_CATALOG_CARDS: BattleSpiritsCard[] = Array.isArray(cardsJsonRaw)
  ? cardsJsonRaw
  : cardsJsonRaw.cards || [];

function makeCard(overrides: Partial<BattleSpiritsCard>): BattleSpiritsCard {
  return {
    id: overrides.id || 'test-card',
    cardNumber: overrides.cardNumber || 'BS52-001',
    name: overrides.name || 'Test Card',
    jpName: overrides.jpName || 'テストカード',
    color: 'Red',
    type: 'Spirit',
    rarity: 'R',
    setCode: 'BS52',
    setName: 'BS52 Set',
    formats: ['Eternal'],
    blockIcon: '7',
    cost: 4,
    reduction: { Red: 2 },
    symbols: { Red: 1 },
    families: ['Dragon', 'Rebirth'],
    levels: [
      { level: 1, cores: 1, bp: 4000 },
      { level: 2, cores: 3, bp: 7000 },
    ],
    effects: [{ timing: 'When Summoned', text: 'Draw 1 card.' }],
    keywords: ['Rebirth'],
    flavorText: '',
    illustrator: 'Artist',
    artworkImage: '/api/wiki/image?file=test.png',
    artVariant: 'dragon',
    wikiUrl: '',
    rulings: [],
    ...overrides,
  };
}

function makeFilters(overrides: Partial<FilterState>): FilterState {
  return {
    ...INITIAL_FILTER_STATE,
    ...overrides,
  };
}

function makeLeoPairFixture(includeReprint = true): BattleSpiritsCard[] {
  const leoLambdaOrig = makeCard({
    id: 'bs52-007-a',
    cardNumber: 'BS52-007(A)',
    setCode: 'BS52',
    setName: 'BS52: Saga Brave',
    name: 'Leo-Lambda',
    jpName: 'レオ・ラムダ',
    type: 'Nexus',
    color: 'Red',
    cost: 3,
    reduction: { Red: 2 },
    symbols: { Red: 1 },
    families: ['Astral Dragon'],
    levels: [{ level: 1, cores: 0, bp: 0 }],
    effects: [
      {
        timing: 'Rebirth: 4 or fewer counters',
        text: 'When your opponent destroys one of your Spirits, flip this Nexus to Leo-Breaker.',
      },
    ],
    keywords: ['Rebirth'],
    artworkImage: '/api/wiki/image?file=Leo-Lambda-BS52.png',
  });

  const leoBreakerOrig = makeCard({
    id: 'bs52-007-b',
    cardNumber: 'BS52-007(B)',
    setCode: 'BS52',
    setName: 'BS52: Saga Brave',
    name: 'Leo-Breaker',
    jpName: 'レオ・ブレイカー',
    type: 'Spirit',
    color: 'Red',
    cost: 6,
    reduction: { Red: 2 },
    symbols: { Red: 2 },
    families: ['Astral Dragon', 'Emperor Beast'],
    levels: [
      { level: 1, cores: 1, bp: 6000 },
      { level: 2, cores: 3, bp: 10000 },
    ],
    effects: [
      {
        timing: 'When Reborn',
        text: 'Destroy 1 opposing Spirit with 10000 BP or less.',
      },
    ],
    keywords: ['Rebirth'],
    artworkImage: '/api/wiki/image?file=Leo-Breaker-BS52.png',
  });

  if (!includeReprint) {
    return [leoLambdaOrig, leoBreakerOrig];
  }

  const leoLambdaReprint = makeCard({
    ...leoLambdaOrig,
    id: 'pb25-007-a',
    cardNumber: 'PB25-007(A)',
    setCode: 'PB25',
    setName: 'PB25: Special Memorial Set',
    rarity: 'P',
    artworkImage: '/api/wiki/image?file=Leo-Lambda-PB25.png',
  });

  const leoBreakerReprint = makeCard({
    ...leoBreakerOrig,
    id: 'pb25-007-b',
    cardNumber: 'PB25-007(B)',
    setCode: 'PB25',
    setName: 'PB25: Special Memorial Set',
    rarity: 'P',
    artworkImage: '/api/wiki/image?file=Leo-Breaker-PB25.png',
  });

  return [leoLambdaReprint, leoBreakerReprint, leoLambdaOrig, leoBreakerOrig];
}

test('extractTenseiSideInfo and linkTenseiRebirthPairs cleanly link confirmed pairs and reject uncertain/non-flip cards', () => {
  const leoCards = makeLeoPairFixture(true);

  // Non-flip card that happens to have Rebirth in keywords/effects (like BS77-052)
  const nonFlipRebirthMention = makeCard({
    id: 'bs77-052',
    cardNumber: 'BS77-052',
    setCode: 'BS77',
    name: 'Devil Demon-God',
    type: 'Brave',
    keywords: ['Rebirth'],
    effects: [
      {
        timing: 'LV1',
        text: "You can't activate Burst effects/[Rebirth] via this effect.",
      },
    ],
  });

  // Unpaired Side A without Side B counterpart
  const orphanSideA = makeCard({
    id: 'bs61-012-a',
    cardNumber: 'BS61-012(A)',
    setCode: 'BS61',
    name: 'Lonely Side A',
  });

  // Ambiguous duplicate Side A records on the same card number
  const dupA1 = makeCard({
    id: 'bs62-001-a-1',
    cardNumber: 'BS62-001(A)',
    setCode: 'BS62',
    name: 'Dup A One',
  });
  const dupA2 = makeCard({
    id: 'bs62-001-a-2',
    cardNumber: 'BS62-001(A)',
    setCode: 'BS62',
    name: 'Dup A Two',
  });
  const dupB = makeCard({
    id: 'bs62-001-b',
    cardNumber: 'BS62-001(B)',
    setCode: 'BS62',
    name: 'Dup B',
  });

  assert.equal(extractTenseiSideInfo(nonFlipRebirthMention), null);

  const pool = [...leoCards, nonFlipRebirthMention, orphanSideA, dupA1, dupA2, dupB];
  const linked = linkTenseiRebirthPairs(pool);

  // Only BS52 Leo-Lambda/Breaker and PB25 Leo-Lambda/Breaker confirm cleanly
  assert.equal(linked.stats.confirmedPairCount, 2);
  assert.equal(linked.sideBBySideACardId['bs52-007-a'], 'bs52-007-b');
  assert.equal(linked.sideABySideBCardId['bs52-007-b'], 'bs52-007-a');
  assert.equal(linked.sideBBySideACardId['pb25-007-a'], 'pb25-007-b');
  assert.equal(linked.sideABySideBCardId['pb25-007-b'], 'pb25-007-a');

  // Non-flip BS77-052 never paired or flagged
  assert.equal(linked.pairByCardId['bs77-052'], undefined);

  // Uncertain candidates kept separate cleanly
  assert.equal(linked.stats.uncertainCandidateCount, 2);
  const reasons = new Set(linked.uncertainCandidates.map((u) => u.reason));
  assert.equal(reasons.has('missing_counterpart'), true);
  assert.equal(reasons.has('ambiguous_side_records'), true);

  // Idempotent when called repeatedly or with duplicate records
  const linkedRepeat = linkTenseiRebirthPairs([...pool, ...leoCards]);
  assert.equal(linkedRepeat.stats.confirmedPairCount, linked.stats.confirmedPairCount);
  assert.equal(linkedRepeat.stats.uncertainCandidateCount, linked.stats.uncertainCandidateCount);
});

test('Leo-Lambda / Leo-Breaker consolidates into one paired entry with full dual-side search, facet matching, and side-preserving reprints', () => {
  const leoCards = makeLeoPairFixture(true);
  const unrelatedCard = makeCard({
    id: 'bs01-001',
    cardNumber: 'BS01-001',
    setCode: 'BS01',
    name: 'Unrelated Drake',
    keywords: [],
  });

  const consolidated = consolidateCatalogCards([...leoCards, unrelatedCard], PRODUCT_SETS);

  // 4 Leo cards (2 Side A reprints + 2 Side B reprints) consolidate into 1 paired entry + 1 unrelated = 2
  assert.equal(consolidated.pairedCatalogCards.length, 2);
  assert.equal(consolidated.stats.pairedCatalogCount, 2);
  assert.equal(consolidated.stats.tenseiConfirmedPairCount, 2);

  const leoGroup = consolidated.pairedGroupByCanonicalId['bs52-007-a'];
  assert.ok(leoGroup);
  assert.ok(leoGroup.tenseiPair);
  assert.equal(leoGroup.canonicalCard.name, 'Leo-Lambda');
  assert.equal(leoGroup.tenseiPair.sideACanonical.id, 'bs52-007-a');
  assert.equal(leoGroup.tenseiPair.sideBCanonical.id, 'bs52-007-b');
  assert.deepEqual(
    leoGroup.tenseiPair.sideAPrintings.map((p) => p.setCode),
    ['BS52', 'PB25']
  );
  assert.deepEqual(
    leoGroup.tenseiPair.sideBPrintings.map((p) => p.setCode),
    ['BS52', 'PB25']
  );
  assert.equal(leoGroup.tenseiPair.sideBBySideACardId['bs52-007-a'], 'bs52-007-b');
  assert.equal(leoGroup.tenseiPair.sideBBySideACardId['pb25-007-a'], 'pb25-007-b');

  // 1) Search "Leo-Lambda" -> finds paired card with Side A selected
  const searchSideA = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'Leo-Lambda', sortBy: 'relevance' })
  );
  assert.equal(searchSideA.cards.length, 1);
  assert.equal(searchSideA.groups[0].canonicalId, 'bs52-007-a');
  assert.equal(searchSideA.matchedSideByCanonicalId['bs52-007-a'], 'A');
  assert.equal(searchSideA.cards[0].id, 'bs52-007-a');

  // 2) Search "Leo-Breaker" -> finds the EXACT SAME paired card with Side B automatically selected
  const searchSideB = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'Leo-Breaker', sortBy: 'relevance' })
  );
  assert.equal(searchSideB.cards.length, 1);
  assert.equal(searchSideB.groups[0].canonicalId, 'bs52-007-a');
  assert.equal(searchSideB.matchedSideByCanonicalId['bs52-007-a'], 'B');
  assert.equal(searchSideB.cards[0].id, 'bs52-007-b');
  assert.equal(searchSideB.matchedPrintingIdByCanonicalId['bs52-007-a'], 'bs52-007-b');

  // 3) Search shared term ("Leo") -> defaults cleanly to Side A
  const searchShared = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'Leo', sortBy: 'relevance' })
  );
  assert.equal(searchShared.cards.length, 1);
  assert.equal(searchShared.matchedSideByCanonicalId['bs52-007-a'], 'A');
  assert.equal(searchShared.cards[0].name, 'Leo-Lambda');

  // 4) Search Side B reprint card number ("PB25-007(B)") -> selects PB25 AND Side B
  const searchReprintSideB = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'PB25-007(B)', sortBy: 'relevance' })
  );
  assert.equal(searchReprintSideB.cards.length, 1);
  assert.equal(searchReprintSideB.groups[0].canonicalId, 'bs52-007-a');
  assert.equal(searchReprintSideB.matchedSideByCanonicalId['bs52-007-a'], 'B');
  assert.equal(searchReprintSideB.matchedPrintingIdByCanonicalId['bs52-007-a'], 'pb25-007-b');

  // 5) Facet filter targeting Side B only (Side A is Nexus Cost 3, Side B is Spirit Cost 6)
  const filterBySpiritAndCost6 = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ type: ['Spirit'], costBracket: '6' })
  );
  assert.equal(filterBySpiritAndCost6.cards.length, 1);
  assert.equal(filterBySpiritAndCost6.groups[0].canonicalId, 'bs52-007-a');
  assert.equal(filterBySpiritAndCost6.matchedSideByCanonicalId['bs52-007-a'], 'B');
  assert.equal(filterBySpiritAndCost6.cards[0].id, 'bs52-007-b');
});

test('Incomplete Side B reprint falls back cleanly without breaking pairing or mixing artwork/data', () => {
  const leoOrig = makeLeoPairFixture(false);
  const partialReprintA = makeCard({
    ...leoOrig[0],
    id: 'pb25-007-a',
    cardNumber: 'PB25-007(A)',
    setCode: 'PB25',
    setName: 'PB25: Special Memorial Set',
    rarity: 'P',
    artworkImage: '/api/wiki/image?file=Leo-Lambda-PB25.png',
  });

  const consolidated = consolidateCatalogCards([...leoOrig, partialReprintA], PRODUCT_SETS);
  assert.equal(consolidated.pairedCatalogCards.length, 1);
  const group = consolidated.pairedCatalogGroups[0];
  assert.ok(group.tenseiPair);
  assert.equal(group.tenseiPair.sideAPrintings.length, 2);
  assert.equal(group.tenseiPair.sideBPrintings.length, 1);
  // Confirmed link exists for BS52, while PB25 Side A has no false Side B link
  assert.equal(group.tenseiPair.sideBBySideACardId['bs52-007-a'], 'bs52-007-b');
  assert.equal(group.tenseiPair.sideBBySideACardId['pb25-007-a'], undefined);
});

test('Real Battle Spirits catalog links all 40 official Tensei/Rebirth pairs accurately while keeping Original/Revival Worlds and BS77-052 separate', () => {
  const m1 = mergeCardsIntoMap({}, BATTLE_SPIRITS_CARDS).next;
  const m2 = mergeCardsIntoMap(m1, REAL_CATALOG_CARDS).next;
  const runtimeCards = Object.values(m2);
  const consolidated = consolidateCatalogCards(runtimeCards, PRODUCT_SETS);

  assert.equal(consolidated.stats.tenseiConfirmedPairCount, 40);
  assert.equal(consolidated.stats.tenseiUncertainCandidateCount, 0);
  assert.equal(
    consolidated.pairedCatalogCards.length,
    consolidated.consolidatedCards.length - 40
  );

  // Original Red World (BS52-TX01) vs Revival Red World (BS73-TCP01) stay 2 separate pairs
  const redWorldSearch = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'The Red World', sortBy: 'relevance' })
  );
  const redWorldExactEntries = redWorldSearch.cards.filter((c) =>
    /^The Red World(?:\s*\(Revival\))?$/i.test(c.name)
  );
  assert.equal(redWorldExactEntries.length, 2);
  const redWorldSets = new Set(redWorldExactEntries.map((c) => c.setCode));
  assert.equal(redWorldSets.has('BS52'), true);
  assert.equal(redWorldSets.has('BS73'), true);

  // Searching Side B "The Red Divine Dragon Emperor" matches the BS52 Red World pair with Side B preselected
  const redEmperorSearch = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'The Red Divine Dragon Emperor', sortBy: 'relevance' })
  );
  assert.ok(redEmperorSearch.cards.length >= 1);
  const topRedEmperor = redEmperorSearch.cards[0];
  const topRedEmperorGroup = redEmperorSearch.groups[0];
  assert.equal(topRedEmperor.cardNumber, 'BS52-TX01(B)');
  assert.equal(
    redEmperorSearch.matchedSideByCanonicalId[topRedEmperorGroup.canonicalId],
    'B'
  );
  assert.equal(topRedEmperorGroup.canonicalCard.cardNumber, 'BS52-TX01(A)');

  // Searching Side B "Braver Dragon" ranks BS52-007 paired entry #1 with Side B preselected
  const braverSearch = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'Braver Dragon', sortBy: 'relevance' })
  );
  assert.ok(braverSearch.cards.length >= 1);
  const fighterCanonicalId = braverSearch.groups[0].canonicalId;
  assert.equal(braverSearch.matchedSideByCanonicalId[fighterCanonicalId], 'B');
  assert.equal(braverSearch.cards[0].cardNumber, 'BS52-007(B)');
  assert.equal(braverSearch.groups[0].canonicalCard.cardNumber, 'BS52-007(A)');

  // Searching base card number "BS52-007" without (A)/(B) defaults cleanly to Side A
  const baseNumberSearch = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'BS52-007', sortBy: 'relevance' })
  );
  assert.equal(baseNumberSearch.cards.length, 1);
  assert.equal(baseNumberSearch.matchedSideByCanonicalId[fighterCanonicalId], 'A');
  assert.equal(baseNumberSearch.cards[0].cardNumber, 'BS52-007(A)');

  // Non-flip Rebirth-mention card BS77-052 stays standalone (no tenseiPair)
  const demonGodCard = runtimeCards.find((c) => c.cardNumber === 'BS77-052');
  assert.ok(demonGodCard);
  const demonGodGroup = consolidated.pairedGroupByMemberId[demonGodCard.id];
  assert.ok(demonGodGroup);
  assert.equal(demonGodGroup.tenseiPair, undefined);
});

test('CardThumbnail and CardDetailSheet render side selector above printing badges with valid sibling buttons and independent side display', () => {
  const leoCards = makeLeoPairFixture(true);
  const consolidated = consolidateCatalogCards(leoCards, PRODUCT_SETS);
  const group = consolidated.pairedCatalogGroups[0];
  assert.ok(group?.tenseiPair);

  // 1) CardThumbnail default (Side A)
  const thumbSideAHtml = renderToStaticMarkup(
    React.createElement(CardThumbnail, {
      card: group.canonicalCard,
      printings: group.printings,
      tenseiPair: group.tenseiPair,
      deckQty: 0,
      onSelect: () => {},
      onAddToDeck: () => {},
    })
  );

  assert.match(thumbSideAHtml, /data-testid="card-side-selector"/);
  assert.match(thumbSideAHtml, /data-testid="side-a-btn"[^>]*aria-pressed="true"/);
  assert.match(thumbSideAHtml, /data-testid="side-b-btn"[^>]*aria-pressed="false"/);
  assert.match(thumbSideAHtml, /data-testid="card-printing-badges"/);
  // Selector must appear AFTER artwork set badge and BEFORE printing badges
  const sideSelectorIdx = thumbSideAHtml.indexOf('data-testid="card-side-selector"');
  const setBadgeIdx = thumbSideAHtml.indexOf('data-testid="card-set-badge"');
  const printingBadgesIdx = thumbSideAHtml.indexOf('data-testid="card-printing-badges"');
  assert.ok(setBadgeIdx < sideSelectorIdx && sideSelectorIdx < printingBadgesIdx);
  // Zero nested <button> tags
  assert.equal(/<button\b[^>]*>(?:(?!<\/button>).)*<button\b/s.test(thumbSideAHtml), false);
  // Side A metadata & artwork
  assert.match(thumbSideAHtml, /BS52-007\(A\)/);
  assert.match(thumbSideAHtml, /file=Leo-Lambda-BS52\.png/);

  // 2) CardThumbnail pre-selected to Side B (e.g. searching "Leo-Breaker" / "PB25-007(B)")
  const thumbSideBHtml = renderToStaticMarkup(
    React.createElement(CardThumbnail, {
      card: group.canonicalCard,
      printings: group.printings,
      tenseiPair: group.tenseiPair,
      preferredSide: 'B',
      preferredPrintingId: 'pb25-007-b',
      deckQty: 0,
      onSelect: () => {},
      onAddToDeck: () => {},
    })
  );

  assert.match(thumbSideBHtml, /data-testid="side-a-btn"[^>]*aria-pressed="false"/);
  assert.match(thumbSideBHtml, /data-testid="side-b-btn"[^>]*aria-pressed="true"/);
  assert.match(thumbSideBHtml, /data-testid="card-set-badge"[^>]*>PB25<\/span>/);
  assert.match(thumbSideBHtml, /PB25-007\(B\)/);
  assert.match(thumbSideBHtml, /file=Leo-Breaker-PB25\.png/);
  assert.match(thumbSideBHtml, /View Leo-Breaker \(PB25-007\(B\)\) details/);
  assert.doesNotMatch(thumbSideBHtml, /file=Leo-Lambda-/);

  // 3) CardDetailSheet opened on Side B preserves navigation & renders Side A/B switcher + Side B printings
  const detailHtml = renderToStaticMarkup(
    React.createElement(CardDetailSheet, {
      card: group.tenseiPair.sideBPrintings[1].card, // PB25-007(B)
      reprintGroup: group,
      canonicalIdByMemberId: consolidated.pairedCanonicalIdByMemberId,
      navigableCards: [
        group.canonicalCard,
        makeCard({ id: 'next-card', cardNumber: 'BS52-008', name: 'Next Card' }),
      ],
      deckQty: 0,
      activeDeckName: 'Test Deck',
      activeDeckFormat: 'Eternal',
      onClose: () => {},
      onSelectCard: () => {},
      onUpdateDeckQty: () => {},
    })
  );

  assert.match(detailHtml, /data-testid="detail-side-selector"/);
  assert.match(detailHtml, /data-testid="detail-side-a-btn"[^>]*aria-pressed="false"/);
  assert.match(detailHtml, /data-testid="detail-side-b-btn"[^>]*aria-pressed="true"/);
  assert.match(detailHtml, /data-testid="detail-printings-selector"/);
  assert.match(detailHtml, /BS52-007\(B\)/);
  assert.match(detailHtml, /PB25-007\(B\)/);
  assert.match(detailHtml, /Destroy 1 opposing Spirit with 10000 BP or less\./);
  assert.doesNotMatch(detailHtml, /flip this Nexus to Leo-Breaker/);
  assert.match(detailHtml, />1\/2</);
  assert.equal(/aria-label="Next card: Next Card"[^>]*disabled/.test(detailHtml), false);
});
