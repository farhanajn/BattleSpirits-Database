import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BATTLE_SPIRITS_CARDS, PRODUCT_SETS } from '../src/data/cards';
import type { BattleSpiritsCard } from '../src/types/card';
import { CatalogMenuView } from '../src/components/CatalogMenuView';
import { FilterControls, FilterSheet } from '../src/components/FilterSheet';
import {
  COST_BRACKET_OPTIONS,
  INITIAL_FILTER_STATE,
} from '../src/utils/cardFilterNormalization';
import {
  isEligibleFeaturedCard,
  selectFeaturedCards,
  selectLatestFeaturedCards,
  selectRandomFeaturedCards,
} from '../src/utils/featuredCards';

function makeCard(overrides: Partial<BattleSpiritsCard>): BattleSpiritsCard {
  return {
    id: overrides.id || 'fc-1',
    cardNumber: overrides.cardNumber || 'BS01-001',
    name: overrides.name || 'Sample Spirit',
    jpName: overrides.jpName || 'サンプル',
    color: 'Red',
    type: 'Spirit',
    rarity: 'R',
    setCode: 'BS01',
    setName: 'BS01',
    formats: ['Eternal'],
    blockIcon: '1',
    cost: 4,
    reduction: {},
    symbols: { Red: 1 },
    families: ['Terra Dragon'],
    effects: [],
    keywords: [],
    flavorText: '',
    illustrator: '',
    artworkImage: '',
    artVariant: 'dragon',
    wikiUrl: '',
    rulings: [],
    ...overrides,
  };
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('selectRandomFeaturedCards produces varied non-duplicate selections and excludes invalid/BSS01/WIKI cards', () => {
  const validPool = BATTLE_SPIRITS_CARDS.slice(0, 30);
  const invalidCards: BattleSpiritsCard[] = [
    makeCard({ id: 'bad-empty-name', cardNumber: 'BS01-990', name: '' }),
    makeCard({ id: 'bad-unknown-name', cardNumber: 'BS01-991', name: 'Unknown' }),
    makeCard({ id: 'bad-bss01', cardNumber: 'BSS01-001', setCode: 'BSS01', name: 'BSS01 Card' }),
    makeCard({ id: 'bad-wiki-num', cardNumber: 'WIKI', name: 'Placeholder Wiki Card' }),
    makeCard({ id: 'bad-no-formats', cardNumber: 'BS01-992', formats: [] }),
  ];

  for (const bad of invalidCards) {
    assert.equal(isEligibleFeaturedCard(bad), false, `Expected ${bad.id} to be ineligible`);
  }

  const combined = [...invalidCards, ...validPool];
  const drawA = selectRandomFeaturedCards(combined, {
    format: 'All',
    count: 8,
    rng: seededRng(101),
  });
  const drawB = selectRandomFeaturedCards(combined, {
    format: 'All',
    count: 8,
    rng: seededRng(2026),
  });

  assert.equal(drawA.length, 8);
  assert.equal(drawB.length, 8);
  assert.equal(new Set(drawA.map((c) => c.id)).size, 8, 'Random selection must never contain duplicates');
  assert.equal(new Set(drawB.map((c) => c.id)).size, 8, 'Random selection must never contain duplicates');

  const idsA = drawA.map((c) => c.id);
  const idsB = drawB.map((c) => c.id);
  assert.notDeepEqual(idsA, idsB, 'Different random seeds must yield different selections');

  const invalidIds = new Set(invalidCards.map((c) => c.id));
  for (const card of [...drawA, ...drawB]) {
    assert.ok(!invalidIds.has(card.id), `Invalid card ${card.id} leaked into random featured cards`);
  }
});

test('selectLatestFeaturedCards strictly sorts by actual database creation/import timestamp descending', () => {
  // Note: low-numbered BS01 card imported MORE RECENTLY than high-numbered BS99 card
  // proves sorting uses actual creation/import timestamps rather than assuming higher cardNumber/setCode = newer.
  const newlyImportedLowNum = makeCard({
    id: 'wiki-bs01-005-new',
    cardNumber: 'BS01-005',
    setCode: 'BS01',
    name: 'Newly Imported Low-Numbered Card',
    importedAt: '2026-11-24T08:00:00.000Z',
  });
  const olderImportedHighNum = makeCard({
    id: 'wiki-bs77-099-older',
    cardNumber: 'BS77-099',
    setCode: 'BS77',
    name: 'Older Imported High-Numbered Card',
    importedAt: '2026-11-20T08:00:00.000Z',
  });
  const newestCloudCard = makeCard({
    id: 'cloud-sd01-001',
    cardNumber: 'SD01-001',
    setCode: 'SD01',
    name: 'Most Recently Published Cloud Card',
    createdAt: '2026-11-24T12:30:00.000Z',
  });
  const legacyNoTimestampLatestSet = makeCard({
    id: 'legacy-bs77-001',
    cardNumber: 'BS77-001',
    setCode: 'BS77',
    name: 'Legacy BS77 Without Timestamp',
  });
  const legacyNoTimestampOldSet = makeCard({
    id: 'legacy-bs01-001',
    cardNumber: 'BS01-001',
    setCode: 'BS01',
    name: 'Legacy BS01 Without Timestamp',
  });

  const afterImportWindowMs = Date.parse('2026-11-25T00:00:00+07:00');
  const ordered = selectLatestFeaturedCards(
    [
      legacyNoTimestampOldSet,
      olderImportedHighNum,
      legacyNoTimestampLatestSet,
      newlyImportedLowNum,
      newestCloudCard,
    ],
    {
      format: 'All',
      count: 5,
      nowMs: afterImportWindowMs,
      productSets: PRODUCT_SETS,
    }
  );

  assert.deepEqual(
    ordered.map((c) => c.id),
    [
      'cloud-sd01-001',
      'wiki-bs01-005-new',
      'wiki-bs77-099-older',
      'legacy-bs77-001',
      'legacy-bs01-001',
    ]
  );

  // Safe fallback must NOT mutate historical cards to invent fake dates
  assert.equal(legacyNoTimestampLatestSet.createdAt, undefined);
  assert.equal(legacyNoTimestampLatestSet.importedAt, undefined);

  // Also test selectFeaturedCards dispatcher
  const latestViaDispatch = selectFeaturedCards(
    [legacyNoTimestampOldSet, newlyImportedLowNum, newestCloudCard],
    {
      mode: 'latest',
      format: 'All',
      count: 2,
      nowMs: afterImportWindowMs,
      productSets: PRODUCT_SETS,
    }
  );
  assert.deepEqual(
    latestViaDispatch.map((c) => c.id),
    ['cloud-sd01-001', 'wiki-bs01-005-new']
  );
});

test('CatalogMenuView renders shared 6-hour Featured Cards schedule, removes Browse by Attribute and Refresh, and hides mode controls from non-admins', () => {
  const cardsById: Record<string, BattleSpiritsCard> = {};
  for (const c of BATTLE_SPIRITS_CARDS) {
    cardsById[c.id] = c;
  }

  const html = renderToStaticMarkup(
    React.createElement(CatalogMenuView, {
      productSets: PRODUCT_SETS,
      cards: BATTLE_SPIRITS_CARDS,
      cardsById,
      activeDeckQtyMap: {},
      activeFormat: 'All',
      currentUser: null,
      authReady: true,
      isAdmin: false,
      sharedFeaturedMode: 'random',
      rotationNowMs: Date.parse('2026-11-24T09:15:00+07:00'),
      onChangeFormat: () => {},
      onOpenSetInSearch: () => {},
      onOpenSearch: () => {},
      onSelectCard: () => {},
      onAddToDeck: () => {},
    })
  );

  assert.equal(
    html.includes('Browse by Attribute'),
    false,
    'Browse by Attribute must be completely removed from CatalogMenuView'
  );
  assert.equal(
    html.includes('Shuffle featured cards'),
    false,
    'Client-side Refresh/Shuffle button must be removed so selection stays fixed for 6 hours'
  );
  assert.equal(
    html.includes('aria-label="Featured cards display mode"'),
    false,
    'Non-admin users must NOT see Featured Cards mode switcher controls'
  );
  assert.ok(html.includes('Featured Cards'), 'Featured Cards section must render');
  assert.ok(html.includes('12:00 WIB'), 'Next 6-hour WIB rotation boundary must render');
  assert.ok(html.includes('All Product Sets Directory'), 'Product Sets Directory must remain intact');
});

test('FilterControls and FilterSheet retain Attribute Color filters, render new Cost Bracket options (0-9, 10+), and include Filter Category search', () => {
  const html = renderToStaticMarkup(
    React.createElement(FilterSheet, {
      open: true,
      resultCount: 42,
      onClose: () => {},
      filters: INITIAL_FILTER_STATE,
      availableSets: PRODUCT_SETS.slice(0, 5).map((s) => ({
        setCode: s.setCode,
        name: s.name,
        category: s.category,
      })),
      availableFamilies: ['Terra Dragon', 'Astral Dragon'],
      availableKeywords: ['Awaken'],
      onChange: () => {},
      onReset: () => {},
    })
  );

  // Attribute Color filters remain preserved in Search/Filter panel
  assert.ok(html.includes('Attribute Color'));
  assert.ok(html.includes('Multi-Color'));
  for (const color of ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue']) {
    assert.ok(html.includes(color), `FilterSheet must keep Attribute Color "${color}"`);
  }

  // New Cost Bracket options rendered; legacy ranges removed
  for (const bracket of COST_BRACKET_OPTIONS) {
    assert.ok(html.includes(`>${bracket}<`), `FilterSheet must render cost button "${bracket}"`);
  }
  assert.equal(html.includes('>0-2<'), false, 'Legacy 0-2 bracket must be removed');
  assert.equal(html.includes('>3-4<'), false, 'Legacy 3-4 bracket must be removed');
  assert.equal(html.includes('>5-6<'), false, 'Legacy 5-6 bracket must be removed');
  assert.equal(html.includes('>7+<'), false, 'Legacy 7+ bracket must be removed');

  // Filter category search input & category markers exist
  assert.ok(html.includes('id="filter-category-search"'));
  assert.ok(html.includes('data-filter-category="set"'));
  assert.ok(html.includes('data-filter-category="cost"'));
  assert.ok(html.includes('data-filter-category="color"'));
});
