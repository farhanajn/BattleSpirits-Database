import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BattleSpiritsCard, FilterState } from '../src/types/card';
import {
  areSameCardIdentity,
  buildCompositeCardIdentityKey,
  getCardVersionVariantKey,
  isSyntheticCardNumber,
  resolveCanonicalIdentitySetCode,
} from '../src/utils/cardIdentity';
import {
  filterCatalogCards,
  INITIAL_FILTER_STATE,
} from '../src/utils/cardFilterNormalization';
import { CardThumbnail } from '../src/components/CardThumbnail';
import { PRODUCT_SETS } from '../src/data/cards';
import { synchronizeAndIndexSets } from '../src/utils/setMetadataSync';
import { mergeCardsIntoMap } from '../src/App';

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
    jpName: overrides.jpName || 'テスト',
    color: 'Red',
    type: 'Spirit',
    rarity: 'C',
    setCode: 'BS01',
    setName: 'Bs01',
    formats: ['Eternal'],
    blockIcon: '1',
    cost: 3,
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

function makeFilters(overrides: Partial<FilterState>): FilterState {
  return {
    ...INITIAL_FILTER_STATE,
    ...overrides,
  };
}

test('composite card identity distinguishes same-name cards across different sets, numbers, and variants', () => {
  const leoBs62 = makeCard({
    id: 'bs62-bs62-069',
    cardNumber: 'BS62-069',
    setCode: 'BS62',
    setName: 'BS62',
    name: 'The Leozard Kingdom',
    type: 'Nexus',
  });
  const leoBsc45 = makeCard({
    id: 'bsc45-bsc45-069',
    cardNumber: 'BSC45-069',
    setCode: 'BSC45',
    setName: 'BSC45',
    name: 'The Leozard Kingdom',
    type: 'Nexus',
  });
  const leoBs70ReprintSameNum = makeCard({
    id: 'bs70-bs62-069',
    cardNumber: 'BS62-069',
    setCode: 'BS70',
    setName: 'BS70',
    name: 'The Leozard Kingdom',
    type: 'Nexus',
  });
  const leoRevival = makeCard({
    id: 'bs62-bs62-069-rv',
    cardNumber: 'BS62-069',
    setCode: 'BS62',
    setName: 'BS62',
    name: 'The Leozard Kingdom (Revival)',
    type: 'Nexus',
    isRevival: true,
  });

  assert.notEqual(
    buildCompositeCardIdentityKey(leoBs62),
    buildCompositeCardIdentityKey(leoBsc45)
  );
  assert.notEqual(
    buildCompositeCardIdentityKey(leoBs62),
    buildCompositeCardIdentityKey(leoBs70ReprintSameNum)
  );
  assert.notEqual(
    buildCompositeCardIdentityKey(leoBs62),
    buildCompositeCardIdentityKey(leoRevival)
  );
  assert.equal(areSameCardIdentity(leoBs62, leoBsc45), false);
  assert.equal(areSameCardIdentity(leoBs62, leoBs70ReprintSameNum), false);
  assert.equal(areSameCardIdentity(leoBs62, leoRevival), false);

  // Side-A vs Side-B, Token vs Spirit, Promo vs Main set
  const sideA = makeCard({ id: 'bs60-001-a', cardNumber: 'BS60-001(A)', setCode: 'BS60', name: 'Twin Form' });
  const sideB = makeCard({ id: 'bs60-001-b', cardNumber: 'BS60-001(B)', setCode: 'BS60', name: 'Twin Form' });
  const tokenCard = makeCard({
    id: 'token-dragon',
    cardNumber: 'BS60-T01',
    setCode: 'BS60',
    name: 'Twin Form',
    isToken: true,
  });
  assert.notEqual(buildCompositeCardIdentityKey(sideA), buildCompositeCardIdentityKey(sideB));
  assert.notEqual(buildCompositeCardIdentityKey(sideA), buildCompositeCardIdentityKey(tokenCard));
  assert.equal(getCardVersionVariantKey({ id: 'wiki-foo-side-b' }), 'orig:side-b');
  assert.equal(isSyntheticCardNumber('WIKI'), true);
  assert.equal(isSyntheticCardNumber('BS62-069'), false);
  assert.equal(resolveCanonicalIdentitySetCode({ cardNumber: 'BS62-069' }), 'BS62');
});

test('filterCatalogCards preserves all same-name versions from different sets across search queries and set filters', () => {
  const leoBs62 = makeCard({
    id: 'bs62-bs62-069',
    cardNumber: 'BS62-069',
    setCode: 'BS62',
    setName: 'BS62',
    name: 'The Leozard Kingdom',
    color: 'Yellow',
    type: 'Nexus',
    artworkImage: 'https://example.com/bs62-069.jpg',
  });
  const leoBsc45 = makeCard({
    id: 'bsc45-bsc45-069',
    cardNumber: 'BSC45-069',
    setCode: 'BSC45',
    setName: 'BSC45',
    name: 'The Leozard Kingdom',
    color: 'Yellow',
    type: 'Nexus',
    artworkImage: 'https://example.com/bsc45-069.jpg',
  });
  const leoSibling = makeCard({
    id: 'bs01-002',
    cardNumber: 'BS01-002',
    setCode: 'BS01',
    setName: 'BS01',
    name: 'Leozard',
    color: 'Red',
    type: 'Spirit',
  });

  const pool = [leoBs62, leoBsc45, leoSibling];

  for (const query of ['Leo', 'Leozard', 'The Leozard Kingdom']) {
    const results = filterCatalogCards(pool, makeFilters({ search: query, sortBy: 'relevance' }));
    const kingdomMatches = results.filter((c) => c.name === 'The Leozard Kingdom');
    assert.equal(
      kingdomMatches.length,
      2,
      `Query "${query}" must keep both BS62 and BSC45 versions of The Leozard Kingdom`
    );
    assert.deepEqual(
      new Set(kingdomMatches.map((c) => c.setCode)),
      new Set(['BS62', 'BSC45'])
    );
    assert.deepEqual(
      new Set(kingdomMatches.map((c) => c.id)),
      new Set(['bs62-bs62-069', 'bsc45-bsc45-069'])
    );
  }

  // Filtering by a single set isolates only that set's entry
  const bs62Only = filterCatalogCards(
    pool,
    makeFilters({ search: 'The Leozard Kingdom', setCode: 'BS62' })
  );
  assert.deepEqual(
    bs62Only.map((c) => c.id),
    ['bs62-bs62-069']
  );

  const bsc45Only = filterCatalogCards(
    pool,
    makeFilters({ search: 'The Leozard Kingdom', setCode: 'BSC45' })
  );
  assert.deepEqual(
    bsc45Only.map((c) => c.id),
    ['bsc45-bsc45-069']
  );
});

test('filterCatalogCards preserves cross-set same-number and same-name cards in real public/cards.json catalog', () => {
  const indexedSetDirectory = synchronizeAndIndexSets(
    [PRODUCT_SETS],
    REAL_CATALOG_CARDS
  );

  // Real catalog has BOTH BS67 and BS70 entries for The ArcAngelia Valiero XV (both BS67-XV04)
  const valieroResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Valiero', sortBy: 'relevance' }),
    { indexedSetDirectory }
  );
  const valieroSets = new Set(valieroResults.map((c) => c.setCode));
  assert.equal(valieroSets.has('BS67'), true, 'BS67 version of Valiero must be returned');
  assert.equal(valieroSets.has('BS70'), true, 'BS70 version of Valiero must NOT be dropped');

  // Real catalog has BOTH SD01-008 (SD01) and RP26-01 (RP26-STD) for The ThunderEmperorDragon Siegwurm
  const siegwurmResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'The ThunderEmperorDragon Siegwurm', sortBy: 'relevance' }),
    { indexedSetDirectory }
  );
  const exactSiegwurms = siegwurmResults.filter(
    (c) => c.name === 'The ThunderEmperorDragon Siegwurm'
  );
  assert.equal(exactSiegwurms.length >= 2, true);
  const siegwurmSets = new Set(exactSiegwurms.map((c) => c.setCode));
  assert.equal(siegwurmSets.has('SD01'), true);
  assert.equal(siegwurmSets.has('RP26-STD'), true);
});

test('mergeCardsIntoMap preserves different sets/versions even on name or wiki ID collisions, while deduplicating genuine overlapping sources', () => {
  const bundledBs01 = makeCard({
    id: 'bs01-016',
    cardNumber: 'BS01-016',
    setCode: 'BS01',
    setName: 'BS01',
    name: 'The MeteorDragonMeteoWurm',
  });
  const jsonBs01Duplicate = makeCard({
    id: 'bs01-bs01-016',
    cardNumber: 'BS01-16',
    setCode: 'BS01',
    setName: 'Dawn of the Dragon',
    name: 'The MeteorDragonMeteoWurm',
    effects: [{ timing: 'LV1', text: 'Real effect text' }],
  });

  // Same card from different sources (bs01-016 vs bs01-bs01-016, BS01-016 vs BS01-16) MUST merge cleanly
  const { next: afterDupMerge } = mergeCardsIntoMap(
    { [bundledBs01.id]: bundledBs01 },
    [jsonBs01Duplicate]
  );
  assert.equal(Object.keys(afterDupMerge).length, 1);
  assert.equal(afterDupMerge['bs01-016']?.effects[0]?.text, 'Real effect text');

  // Same name & same wiki slug ID across two DIFFERENT sets MUST stay separate
  const leoWikiBs62 = makeCard({
    id: 'wiki-the-leozard-kingdom',
    cardNumber: 'BS62-069',
    setCode: 'BS62',
    setName: 'BS62',
    name: 'The Leozard Kingdom',
    wikiTitle: 'The Leozard Kingdom',
  });
  const leoWikiBs70SameSlug = makeCard({
    id: 'wiki-the-leozard-kingdom',
    cardNumber: 'BS62-069',
    setCode: 'BS70',
    setName: 'BS70',
    name: 'The Leozard Kingdom',
    wikiTitle: 'The Leozard Kingdom',
  });
  const leoBsc45DifferentNum = makeCard({
    id: 'bsc45-069',
    cardNumber: 'BSC45-069',
    setCode: 'BSC45',
    setName: 'BSC45',
    name: 'The Leozard Kingdom',
    wikiTitle: 'The Leozard Kingdom',
  });

  const { next: multiSetMap } = mergeCardsIntoMap(
    {},
    [leoWikiBs62, leoWikiBs70SameSlug, leoBsc45DifferentNum]
  );
  const mergedList = Object.values(multiSetMap);
  assert.equal(mergedList.length, 3, 'All 3 distinct set printings must remain distinct entries');
  assert.deepEqual(
    new Set(mergedList.map((c) => c.setCode)),
    new Set(['BS62', 'BS70', 'BSC45'])
  );

  // Genuine duplicate filtering in filterCatalogCards also collapses true same-set/same-number duplicates
  const dupFilterResult = filterCatalogCards(
    [bundledBs01, jsonBs01Duplicate],
    makeFilters({ search: 'MeteorDragonMeteoWurm' })
  );
  assert.equal(dupFilterResult.length, 1);
});

test('CardThumbnail displays prominent top-right pill-shaped set identifier badge and keeps card details distinct', () => {
  const leoBs62 = makeCard({
    id: 'bs62-bs62-069',
    cardNumber: 'BS62-069',
    setCode: 'BS62',
    setName: 'BS62: Great Clash',
    name: 'The Leozard Kingdom',
    rarity: 'R',
    color: 'Yellow',
    type: 'Nexus',
  });
  const leoBsc45 = makeCard({
    id: 'bsc45-bsc45-069',
    cardNumber: 'BSC45-069',
    setCode: 'BSC45',
    setName: 'BSC45: All-Star Booster',
    name: 'The Leozard Kingdom',
    rarity: 'R',
    color: 'Yellow',
    type: 'Nexus',
  });

  const htmlBs62 = renderToStaticMarkup(
    React.createElement(CardThumbnail, {
      card: leoBs62,
      deckQty: 0,
      onSelect: () => {},
      onAddToDeck: () => {},
    })
  );
  const htmlBsc45 = renderToStaticMarkup(
    React.createElement(CardThumbnail, {
      card: leoBsc45,
      deckQty: 1,
      onSelect: () => {},
      onAddToDeck: () => {},
    })
  );

  assert.match(htmlBs62, /data-testid="card-set-badge"[^>]*>BS62<\/span>/);
  assert.match(htmlBs62, /rounded-full/);
  assert.match(htmlBs62, /top-2 right-2/);
  assert.match(htmlBs62, /BS62-069/);

  assert.match(htmlBsc45, /data-testid="card-set-badge"[^>]*>BSC45<\/span>/);
  assert.match(htmlBsc45, /rounded-full/);
  assert.match(htmlBsc45, /top-2 right-2/);
  assert.match(htmlBsc45, /BSC45-069/);
});

test('server wikiService searchWikiCards uses composite identity instead of name-only deduplication', () => {
  const wikiServiceSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'server/wikiService.ts'),
    'utf8'
  );
  assert.equal(wikiServiceSrc.includes('altNameKey'), false);
  assert.equal(wikiServiceSrc.includes('orig-name:'), false);
  assert.equal(wikiServiceSrc.includes('buildCompositeCardIdentityKey'), true);
});
