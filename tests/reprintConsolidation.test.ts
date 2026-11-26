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
  compareCardPrintingChronology,
  resolveSetReleaseInfo,
} from '../src/utils/setChronology';
import {
  compareGameplayEquivalence,
  consolidateCatalogCards,
  consolidateWikiPreviewCards,
  normalizeEffectTextForComparison,
} from '../src/utils/reprintConsolidation';
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
    cardNumber: overrides.cardNumber || 'BS01-001',
    name: overrides.name || 'Test Spirit',
    jpName: overrides.jpName || 'テストスピリット',
    color: 'Green',
    type: 'Spirit',
    rarity: 'C',
    setCode: 'BS01',
    setName: 'BS01 Set',
    formats: ['Eternal'],
    blockIcon: '1',
    cost: 4,
    reduction: { Green: 2 },
    symbols: { Green: 1 },
    families: ['Jubilee', 'Fighter'],
    levels: [
      { level: 1, cores: 1, bp: 4000 },
      { level: 2, cores: 3, bp: 6000 },
    ],
    effects: [{ timing: 'When Summoned', text: 'Refresh 1 of your Spirits.' }],
    keywords: [],
    flavorText: '',
    illustrator: 'Artist',
    artworkImage: '/api/wiki/image?file=test.png',
    artVariant: 'beast',
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

function makeMultiSetReprintFixture(): BattleSpiritsCard[] {
  // Deliberately unsorted order (PB08, CB11, CB02, CB03) to prove chronology sorting, not input/alphabetical order
  return [
    makeCard({
      id: 'pb08-012',
      cardNumber: 'PB08-012',
      setCode: 'PB08',
      setName: 'PB08: Promotional Card',
      name: 'Savanna Fang Beast',
      jpName: 'サバンナファング',
      rarity: 'P',
      artworkImage: '/api/wiki/image?file=PB08-012.png',
    }),
    makeCard({
      id: 'cb11-045',
      cardNumber: 'CB11-045',
      setCode: 'CB11',
      setName: 'CB11: Collab Booster Eleven',
      name: 'Savanna Fang Beast',
      jpName: 'サバンナファング',
      rarity: 'R',
      artworkImage: '/api/wiki/image?file=CB11-045.png',
    }),
    makeCard({
      id: 'cb02-019',
      cardNumber: 'CB02-019',
      setCode: 'CB02',
      setName: 'CB02: Collab Booster Two',
      name: 'Savanna Fang Beast',
      jpName: 'サバンナファング',
      rarity: 'C',
      artworkImage: '/api/wiki/image?file=CB02-019.png',
    }),
    makeCard({
      id: 'cb03-041',
      cardNumber: 'CB03-041',
      setCode: 'CB03',
      setName: 'CB03: Collab Booster Three',
      name: 'Savanna Fang Beast',
      jpName: 'サバンナファング',
      rarity: 'U',
      artworkImage: '/api/wiki/image?file=CB03-041.png',
    }),
  ];
}

test('setChronology orders oldest official release first regardless of alphabetical set codes', () => {
  const sd01 = makeCard({ id: 'sd01-1', setCode: 'SD01', cardNumber: 'SD01-001' });
  const bs12 = makeCard({ id: 'bs12-1', setCode: 'BS12', cardNumber: 'BS12-001' });
  const cb02 = makeCard({ id: 'cb02-1', setCode: 'CB02', cardNumber: 'CB02-001' });
  const pb08 = makeCard({ id: 'pb08-1', setCode: 'PB08', cardNumber: 'PB08-001' });
  const bs70 = makeCard({ id: 'bs70-1', setCode: 'BS70', cardNumber: 'BS70-001' });
  const rp26 = makeCard({ id: 'rp26-1', setCode: 'RP26-STD', cardNumber: 'RP26-01' });

  const sorted = [rp26, bs70, pb08, cb02, bs12, sd01].sort((a, b) =>
    compareCardPrintingChronology(a, b)
  );
  assert.deepEqual(
    sorted.map((c) => c.setCode),
    ['SD01', 'BS12', 'CB02', 'PB08', 'BS70', 'RP26-STD']
  );

  // Verify release lookup provides known dates cleanly
  assert.equal(resolveSetReleaseInfo('CB02').releaseDate, '2017-09-30');
  assert.equal(resolveSetReleaseInfo('CB03').releaseDate, '2018-02-10');
  assert.equal(resolveSetReleaseInfo('CB11').releaseDate, '2020-02-29');
});

test('consolidateCatalogCards consolidates identical multi-set reprints onto the oldest canonical release', () => {
  const cards = makeMultiSetReprintFixture();
  const result = consolidateCatalogCards(cards, PRODUCT_SETS);

  assert.equal(result.consolidatedCards.length, 1);
  assert.equal(result.stats.confirmedGroupCount, 1);
  assert.equal(result.stats.consolidatedReprintMembersCount, 3);
  assert.equal(result.stats.uncertainGroupCount, 0);

  // Oldest release is CB02 (2017-08-26), before CB03 (2018), CB11 (2020), PB08 (2020-05+)
  const canonical = result.consolidatedCards[0];
  assert.equal(canonical.id, 'cb02-019');
  assert.equal(canonical.setCode, 'CB02');

  const group = result.groupByCanonicalId['cb02-019'];
  assert.ok(group);
  assert.deepEqual(
    group.printings.map((p) => p.setCode),
    ['CB02', 'CB03', 'CB11', 'PB08']
  );
  assert.equal(group.printings[0].isCanonicalOriginal, true);
  assert.equal(group.printings[1].isCanonicalOriginal, false);

  // All member IDs resolve back to the same group and canonicalId
  for (const id of ['cb02-019', 'cb03-041', 'cb11-045', 'pb08-012']) {
    assert.equal(result.canonicalIdByMemberId[id], 'cb02-019');
    assert.equal(result.groupByMemberId[id]?.canonicalId, 'cb02-019');
  }
});

test('consolidateCatalogCards never merges different effects, Revival/Original, Token, Side-A/B, or uncertain/incomplete records', () => {
  const base = makeCard({
    id: 'bs20-010',
    cardNumber: 'BS20-010',
    setCode: 'BS20',
    name: 'Guardian Spirit',
    jpName: 'ガーディアン',
    effects: [{ timing: 'LV1-LV2', text: 'When Summoned: Draw 1 card.' }],
  });
  const revival = makeCard({
    ...base,
    id: 'bs50-rv010',
    cardNumber: 'BS50-RV010',
    setCode: 'BS50',
    name: 'Guardian Spirit (Revival)',
    isRevival: true,
  });
  const token = makeCard({
    ...base,
    id: 'bs50-t01',
    cardNumber: 'BS50-T01',
    setCode: 'BS50',
    isToken: true,
  });
  const sideA = makeCard({
    ...base,
    id: 'bs60-010-a',
    cardNumber: 'BS60-010(A)',
    setCode: 'BS60',
  });
  const sideB = makeCard({
    ...base,
    id: 'bs60-010-b',
    cardNumber: 'BS60-010(B)',
    setCode: 'BS60',
  });
  const alteredWording = makeCard({
    ...base,
    id: 'bs35-010',
    cardNumber: 'BS35-010',
    setCode: 'BS35',
    effects: [{ timing: 'LV1-LV2', text: 'When Summoned: Draw 2 cards and discard 1 card.' }],
  });
  const missingEffects = makeCard({
    ...base,
    id: 'bs40-010',
    cardNumber: 'BS40-010',
    setCode: 'BS40',
    effects: [],
  });
  const jpMismatch = makeCard({
    ...base,
    id: 'bs41-010',
    cardNumber: 'BS41-010',
    setCode: 'BS41',
    jpName: '別カード',
  });

  const pool = [base, revival, token, sideA, sideB, alteredWording, missingEffects, jpMismatch];
  const result = consolidateCatalogCards(pool, PRODUCT_SETS);

  assert.equal(result.consolidatedCards.length, pool.length);
  assert.equal(result.stats.confirmedGroupCount, 0);
  assert.ok(result.uncertainGroups.length >= 1);

  const eqWording = compareGameplayEquivalence(base, alteredWording);
  assert.equal(eqWording.classification, 'uncertain_review');
  assert.ok(eqWording.reasons.includes('effect_wording_differs'));

  const eqMissing = compareGameplayEquivalence(base, missingEffects);
  assert.equal(eqMissing.classification, 'uncertain_review');
  assert.ok(eqMissing.reasons.includes('missing_or_unverified_effects'));

  const eqRevival = compareGameplayEquivalence(base, revival);
  assert.equal(eqRevival.classification, 'distinct_card');

  const eqToken = compareGameplayEquivalence(base, token);
  assert.equal(eqToken.classification, 'distinct_card');

  const eqSide = compareGameplayEquivalence(sideA, sideB);
  assert.equal(eqSide.classification, 'distinct_card');

  // Trivial formatting differences (quotes, periods, [LV1][LV2] spacing) normalize identically
  assert.equal(
    normalizeEffectTextForComparison('“When Summoned”: Draw 1 card.'),
    normalizeEffectTextForComparison('"When Summoned": Draw 1 card')
  );
});

test('real catalog preserves Siegwurm, Flame Tempest, Fruit of Life separately while consolidating Valiero XV onto BS67', () => {
  const m1 = mergeCardsIntoMap({}, BATTLE_SPIRITS_CARDS).next;
  const m2 = mergeCardsIntoMap(m1, REAL_CATALOG_CARDS).next;
  const runtimeCards = Object.values(m2);
  const result = consolidateCatalogCards(runtimeCards, PRODUCT_SETS);

  // Confirmed Valiero XV consolidation (BS67 < BS70)
  const valieroEntries = result.consolidatedCards.filter((c) => /Valiero/i.test(c.name));
  assert.equal(valieroEntries.length, 1);
  assert.equal(valieroEntries[0].setCode, 'BS67');
  const valieroGroup = result.groupByCanonicalId[valieroEntries[0].id];
  assert.ok(valieroGroup);
  assert.deepEqual(
    valieroGroup.printings.map((p) => p.setCode),
    ['BS67', 'BS70']
  );

  // Siegwurm (SD01 vs RP26-STD) MUST NOT consolidate (Standard 2026 remake has different effects/levels/families)
  const siegwurms = result.consolidatedCards.filter(
    (c) => c.name === 'The ThunderEmperorDragon Siegwurm'
  );
  assert.ok(siegwurms.length >= 2);
  const siegSets = new Set(siegwurms.map((c) => c.setCode));
  assert.equal(siegSets.has('SD01'), true);
  assert.equal(siegSets.has('RP26-STD'), true);

  // Flame Tempest & Deadly Balance collision on BS01-125 stays preserved without dropping either card
  const deadlyBalances = result.consolidatedCards.filter((c) => c.name === 'Deadly Balance');
  assert.equal(deadlyBalances.length, 2);
  const flameTempests = result.consolidatedCards.filter((c) => c.name === 'Flame Tempest');
  assert.ok(flameTempests.length >= 1);

  // Uncertain groups surfaced cleanly without false merges
  assert.ok(result.uncertainGroups.length >= 6);
  assert.ok(result.uncertainGroups.some((g) => g.name === 'Deadly Balance'));
  assert.ok(result.uncertainGroups.some((g) => g.name.includes('Burst Wall')));
});

test('filterConsolidatedCatalogCards keeps all printings searchable and auto-selects matching later printings', () => {
  const reprintCards = makeMultiSetReprintFixture();
  const unrelatedCard = makeCard({
    id: 'bs01-002',
    cardNumber: 'BS01-002',
    setCode: 'BS01',
    name: 'Unrelated Goblin',
    color: 'Red',
  });
  const consolidated = consolidateCatalogCards([...reprintCards, unrelatedCard], PRODUCT_SETS);

  // 1) Search by card name -> 1 entry defaulting to oldest canonical printing (CB02)
  const byName = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'Savanna Fang Beast', sortBy: 'relevance' })
  );
  assert.equal(byName.cards.length, 1);
  assert.equal(byName.cards[0].id, 'cb02-019');
  assert.equal(byName.matchedPrintingIdByCanonicalId['cb02-019'], undefined);

  // 2) Search by later printing set code ("CB03") -> finds consolidated card & selects CB03 printing
  const byLaterSetSearch = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'CB03', sortBy: 'relevance' })
  );
  assert.equal(byLaterSetSearch.cards.length, 1);
  assert.equal(byLaterSetSearch.groups[0].canonicalId, 'cb02-019');
  assert.equal(byLaterSetSearch.cards[0].id, 'cb03-041');
  assert.equal(byLaterSetSearch.matchedPrintingIdByCanonicalId['cb02-019'], 'cb03-041');

  // 3) Search by later printing card number ("CB11-045") -> finds consolidated card & selects CB11 printing
  const byLaterNumber = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ search: 'CB11-045', sortBy: 'relevance' })
  );
  assert.equal(byLaterNumber.cards.length, 1);
  assert.equal(byLaterNumber.groups[0].canonicalId, 'cb02-019');
  assert.equal(byLaterNumber.cards[0].id, 'cb11-045');
  assert.equal(byLaterNumber.matchedPrintingIdByCanonicalId['cb02-019'], 'cb11-045');

  // 4) Filter by setCode ('PB08') or rarity ('R' only on CB11) -> discovers consolidated card & preselects matching printing
  const bySetFilter = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ setCode: 'PB08' })
  );
  assert.equal(bySetFilter.cards.length, 1);
  assert.equal(bySetFilter.groups[0].canonicalId, 'cb02-019');
  assert.equal(bySetFilter.matchedPrintingIdByCanonicalId['cb02-019'], 'pb08-012');

  const byRarityFilter = filterConsolidatedCatalogCards(
    consolidated,
    makeFilters({ rarity: ['R'] })
  );
  assert.equal(byRarityFilter.cards.length, 1);
  assert.equal(byRarityFilter.groups[0].canonicalId, 'cb02-019');
  assert.equal(byRarityFilter.matchedPrintingIdByCanonicalId['cb02-019'], 'cb11-045');
});

test('CardThumbnail renders sibling buttons, top-right active set badge, inline printing badges + overflow, and CardDetailSheet renders Printings selector', () => {
  const reprintCards = makeMultiSetReprintFixture();
  const consolidated = consolidateCatalogCards(reprintCards, PRODUCT_SETS);
  const group = consolidated.groupByCanonicalId['cb02-019'];
  assert.ok(group);

  // Default canonical rendering (CB02 active, 3 visible + "+1" overflow)
  const defaultHtml = renderToStaticMarkup(
    React.createElement(CardThumbnail, {
      card: group.canonicalCard,
      printings: group.printings,
      deckQty: 0,
      onSelect: () => {},
      onAddToDeck: () => {},
    })
  );

  assert.match(defaultHtml, /data-testid="card-set-badge"[^>]*>CB02<\/span>/);
  assert.match(defaultHtml, /data-testid="card-printing-badges"/);
  assert.match(defaultHtml, /data-testid="printing-badge-CB02"[^>]*aria-pressed="true"/);
  assert.match(defaultHtml, /data-testid="printing-badges-overflow"[^>]*><span>\+1<\/span>/);
  // Ensure no invalid nested <button> tags inside another <button>
  const nestedButtonCheck = /<button\b[^>]*>(?:(?!<\/button>).)*<button\b/s;
  assert.equal(nestedButtonCheck.test(defaultHtml), false, 'CardThumbnail must not nest <button> inside <button>');

  // Preferred printing pre-selection (e.g. searching CB11-045 selects CB11 in-place)
  const laterHtml = renderToStaticMarkup(
    React.createElement(CardThumbnail, {
      card: group.canonicalCard,
      printings: group.printings,
      preferredPrintingId: 'cb11-045',
      deckQty: 0,
      onSelect: () => {},
      onAddToDeck: () => {},
    })
  );

  assert.match(laterHtml, /data-testid="card-set-badge"[^>]*>CB11<\/span>/);
  assert.match(laterHtml, /data-testid="printing-badge-CB11"[^>]*aria-pressed="true"/);
  assert.match(laterHtml, /CB11-045/);
  assert.match(laterHtml, /View Savanna Fang Beast \(CB11-045\) details/);
  assert.match(laterHtml, /file=CB11-045\.png/);

  // CardDetailSheet renders Printings selector and preserves Prev/Next navigation even when opened on non-canonical printing
  const detailHtml = renderToStaticMarkup(
    React.createElement(CardDetailSheet, {
      card: group.printings[2].card, // CB11 non-canonical printing
      reprintGroup: group,
      canonicalIdByMemberId: consolidated.canonicalIdByMemberId,
      navigableCards: [
        group.canonicalCard,
        makeCard({ id: 'next-card', cardNumber: 'BS01-099', name: 'Next Card' }),
      ],
      deckQty: 0,
      activeDeckName: 'Test Deck',
      activeDeckFormat: 'Eternal',
      onClose: () => {},
      onSelectCard: () => {},
      onUpdateDeckQty: () => {},
    })
  );

  assert.match(detailHtml, /data-testid="detail-printings-selector"/);
  assert.match(detailHtml, /Printings \(4\)/);
  assert.match(detailHtml, /CB02-019/);
  assert.match(detailHtml, /CB11-045/);
  assert.match(detailHtml, /PB08-012/);
  // Next card navigation arrow should be enabled when CB11 maps to canonical CB02 (index 0 of 2)
  assert.match(detailHtml, /aria-label="Next card: Next Card"/);
  assert.match(detailHtml, />1\/2</);
  assert.equal(/aria-label="Next card: Next Card"[^>]*disabled/.test(detailHtml), false);
});

test('consolidateWikiPreviewCards skips already-imported local printings and consolidates unseen preview reprints', () => {
  const local = [
    makeCard({
      id: 'cb02-019',
      cardNumber: 'CB02-019',
      setCode: 'CB02',
      name: 'Savanna Fang Beast',
    }),
  ];
  const wiki = [
    makeCard({
      id: 'wiki-cb02-019',
      cardNumber: 'CB02-019',
      setCode: 'CB02',
      name: 'Savanna Fang Beast',
    }),
    makeCard({
      id: 'wiki-cb03-041',
      cardNumber: 'CB03-041',
      setCode: 'CB03',
      name: 'Savanna Fang Beast',
    }),
    makeCard({
      id: 'wiki-cb11-045',
      cardNumber: 'CB11-045',
      setCode: 'CB11',
      name: 'Savanna Fang Beast',
    }),
  ];

  const preview = consolidateWikiPreviewCards(wiki, local, PRODUCT_SETS);
  assert.equal(preview.consolidatedCards.length, 1);
  assert.equal(preview.consolidatedCards[0].setCode, 'CB03');
  assert.deepEqual(
    preview.groups[0].printings.map((p) => p.setCode),
    ['CB03', 'CB11']
  );
});
