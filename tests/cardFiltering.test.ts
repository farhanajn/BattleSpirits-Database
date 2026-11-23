import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BATTLE_SPIRITS_CARDS, PRODUCT_SETS } from '../src/data/cards';
import type { BattleSpiritsCard, CardColor, CardType, FilterState } from '../src/types/card';
import {
  extractAvailableFamilies,
  filterCatalogCards,
  INITIAL_FILTER_STATE,
  matchesColorFilter,
  matchesCostBracket,
  matchesFamilyFilter,
  matchesTypeFilter,
  normalizeCardColors,
  normalizeCardCost,
  normalizeCardFamilies,
  normalizeCardForCatalog,
  normalizeCardTypes,
} from '../src/utils/cardFilterNormalization';
import { synchronizeAndIndexSets } from '../src/utils/setMetadataSync';
import { hydrateCardFromWikitext, normalizeColor, normalizeType } from '../server/wikiService';

const cardsJsonPath = path.resolve(process.cwd(), 'public/cards.json');
const cardsJsonRaw = JSON.parse(fs.readFileSync(cardsJsonPath, 'utf8'));
const REAL_CATALOG_CARDS: BattleSpiritsCard[] = Array.isArray(cardsJsonRaw)
  ? cardsJsonRaw
  : cardsJsonRaw.cards || [];

function makeCard(overrides: Partial<BattleSpiritsCard>): BattleSpiritsCard {
  return {
    id: overrides.id || 'test-card-1',
    cardNumber: overrides.cardNumber || 'BS01-001',
    name: overrides.name || 'Test Spirit',
    jpName: overrides.jpName || 'テストスピリット',
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

test('Attribute Color filter strictly matches single-color, multi-color, and normalized variants across real 2,353-card dataset', () => {
  assert.ok(REAL_CATALOG_CARDS.length >= 2000, 'Expected real catalog dataset from public/cards.json');

  const allColors: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];
  for (const targetColor of allColors) {
    const results = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ color: targetColor }));
    assert.ok(results.length > 0, `Expected non-empty results for ${targetColor}`);
    for (const card of results) {
      const cardColors = normalizeCardColors(card);
      assert.ok(
        cardColors.includes(targetColor),
        `Card ${card.cardNumber} (${card.name}) returned under ${targetColor} but normalized colors were [${cardColors.join(', ')}]`
      );
    }
  }

  // Multi-color cards appear under each constituent color AND Multi-Color filter
  const bs09Arc = REAL_CATALOG_CARDS.find((c) => c.cardNumber === 'BS09-009');
  assert.ok(bs09Arc, 'Expected multi-color card BS09-009 in dataset');

  const redResults = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ color: 'Red' }));
  const blueResults = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ color: 'Blue' }));
  const purpleResults = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ color: 'Purple' }));
  const multicolorResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ color: 'Multicolor' })
  );

  assert.ok(
    redResults.some((c) => c.cardNumber === 'BS09-009'),
    'Red filter must include Red/Blue multi-color BS09-009'
  );
  assert.ok(
    blueResults.some((c) => c.cardNumber === 'BS09-009'),
    'Blue filter must include Red/Blue multi-color BS09-009'
  );
  assert.ok(
    !purpleResults.some((c) => c.cardNumber === 'BS09-009'),
    'Purple filter must NEVER include Red/Blue card BS09-009'
  );
  assert.ok(
    multicolorResults.some((c) => c.cardNumber === 'BS09-009'),
    'Multi-Color filter must include Red/Blue card BS09-009'
  );

  // Every card under Multi-Color has >= 2 distinct colors
  for (const card of multicolorResults) {
    const cols = normalizeCardColors(card);
    assert.ok(
      cols.length >= 2,
      `Card ${card.cardNumber} returned under Multicolor only had [${cols.join(', ')}]`
    );
  }

  // Bundled cards without explicit colors[] array normalize cleanly via color + secondaryColor
  const bundledZeus = BATTLE_SPIRITS_CARDS.find((c) => c.cardNumber === 'BS71-CX01');
  if (bundledZeus) {
    const cols = normalizeCardColors(bundledZeus);
    assert.ok(cols.includes(bundledZeus.color));
  }

  // Edge cases: duplicate colors, lowercase/delimited strings, JP kanji, malformed color
  assert.equal(
    matchesColorFilter(makeCard({ color: 'Red', secondaryColor: 'Red', colors: ['Red', 'Red'] }), 'Multicolor'),
    false,
    'Duplicate [Red, Red] must NOT count as multi-color'
  );
  assert.deepEqual(
    normalizeCardColors({ color: 'red / purple' as unknown as CardColor }),
    ['Red', 'Purple']
  );
  assert.deepEqual(normalizeCardColors({ color: '紫' as unknown as CardColor }), ['Purple']);
  assert.deepEqual(
    normalizeCardColors({ color: 'Unknown' as unknown as CardColor, colors: [] }),
    []
  );
  assert.equal(
    matchesColorFilter(
      makeCard({ color: 'Unknown' as unknown as CardColor, colors: [] }),
      'Red'
    ),
    false,
    'Malformed unknown color must NOT leak into Red'
  );
});

test('Card Type filter strictly matches normalized types without leaking subtype labels or effect text', () => {
  const allTypes: CardType[] = ['Spirit', 'Ultimate', 'Brave', 'Nexus', 'Magic'];

  for (const t of allTypes) {
    const results = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ type: [t] }));
    assert.ok(results.length > 0, `Expected non-empty results for type ${t}`);
    for (const card of results) {
      const types = normalizeCardTypes(card);
      assert.ok(
        types.includes(t),
        `Card ${card.cardNumber} (${card.type} / ${card.subtypeLabel || ''}) leaked into type ${t}`
      );
    }
  }

  // Subtype label 'Spirit/Burst' on BS45-068 must strictly remain Spirit only
  const burstSpirit = REAL_CATALOG_CARDS.find((c) => c.cardNumber === 'BS45-068');
  assert.ok(burstSpirit, 'Expected BS45-068 Spirit/Burst card');
  assert.deepEqual(normalizeCardTypes(burstSpirit), ['Spirit']);
  assert.equal(matchesTypeFilter(burstSpirit, ['Magic']), false);
  assert.equal(matchesTypeFilter(burstSpirit, ['Spirit', 'Magic']), true);

  // Magic card mentioning 'Spirit' in name & effect must NOT match Spirit
  const magicMentioningSpirit = makeCard({
    id: 'magic-spirit-text',
    cardNumber: 'BS01-130',
    name: 'Spirit Destruction Burst',
    type: 'Magic',
    effects: [{ timing: 'Flash', text: 'Destroy 1 opposing Spirit with 5000 BP or less.' }],
  });
  assert.equal(matchesTypeFilter(magicMentioningSpirit, ['Magic']), true);
  assert.equal(matchesTypeFilter(magicMentioningSpirit, ['Spirit']), false);

  // Structured dual types and Japanese aliases
  const dualCard = makeCard({ type: 'Spirit', subtypeLabel: 'Spirit / Ultimate' });
  assert.deepEqual(normalizeCardTypes(dualCard), ['Spirit', 'Ultimate']);
  assert.equal(matchesTypeFilter(dualCard, ['Ultimate']), true);

  const jpNexus = makeCard({ type: 'ネクサス' as unknown as CardType });
  assert.deepEqual(normalizeCardTypes(jpNexus), ['Nexus']);
});

test('Card Family filter normalizes comma-separated families and excludes cards matching only by name or effect', () => {
  const available = extractAvailableFamilies(REAL_CATALOG_CARDS);
  assert.ok(available.includes('Terra Dragon'));
  assert.ok(available.includes('Dragon'));
  assert.ok(
    !available.some((f) => f.includes(',')),
    'Available dropdown families must never retain unsplit comma-joined strings'
  );

  // Real card BS09-003 has raw families ['Dragon, Terra Dragon']
  const bs09Dragon = REAL_CATALOG_CARDS.find((c) => c.families.some((f) => f === 'Dragon, Terra Dragon'));
  assert.ok(bs09Dragon, 'Expected real card with comma-joined "Dragon, Terra Dragon" family');

  const terraResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ family: 'Terra Dragon' })
  );
  assert.ok(
    terraResults.some((c) => c.cardNumber === bs09Dragon.cardNumber),
    'Terra Dragon filter must include split comma-joined card'
  );

  const dragonResults = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ family: 'Dragon' }));
  assert.ok(
    dragonResults.some((c) => c.cardNumber === bs09Dragon.cardNumber),
    'Dragon filter must include split comma-joined card'
  );

  for (const card of terraResults) {
    assert.ok(
      normalizeCardFamilies(card.families).includes('Terra Dragon'),
      `Card ${card.cardNumber} leaked into Terra Dragon`
    );
  }

  // Exact family boundary: 'Dragon' must NOT match 'Astral Dragon'-only cards, Magic with no family, or effect text
  const syntheticDeck = [
    makeCard({ id: 'd1', cardNumber: 'T-001', families: ['Dragon'] }),
    makeCard({ id: 'd2', cardNumber: 'T-002', families: ['Dragon, Terra Dragon'] }),
    makeCard({ id: 'd3', cardNumber: 'T-003', families: ['Astral Dragon'] }),
    makeCard({
      id: 'd4',
      cardNumber: 'T-004',
      type: 'Magic',
      name: 'Dragon Breath',
      families: [],
      effects: [{ timing: 'Main', text: 'Give 1 Dragon +3000 BP.' }],
    }),
    makeCard({ id: 'd5', cardNumber: 'T-005', families: ['地竜'] }),
  ];

  const matchDragon = filterCatalogCards(syntheticDeck, makeFilters({ family: 'Dragon' }));
  assert.deepEqual(
    matchDragon.map((c) => c.id),
    ['d1', 'd2']
  );

  const matchTerra = filterCatalogCards(syntheticDeck, makeFilters({ family: 'Terra Dragon' }));
  assert.deepEqual(
    matchTerra.map((c) => c.id),
    ['d2', 'd5']
  );

  assert.equal(matchesFamilyFilter(syntheticDeck[3], 'Dragon'), false);
});

test('Cost Bracket filter enforces strict integer bounds and blocks null, NaN, empty string, and non-numeric costs', () => {
  const b02 = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ costBracket: '0-2' }));
  const b34 = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ costBracket: '3-4' }));
  const b56 = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ costBracket: '5-6' }));
  const b7p = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ costBracket: '7+' }));

  for (const c of b02) assert.ok(c.cost >= 0 && c.cost <= 2);
  for (const c of b34) assert.ok(c.cost >= 3 && c.cost <= 4);
  for (const c of b56) assert.ok(c.cost >= 5 && c.cost <= 6);
  for (const c of b7p) assert.ok(c.cost >= 7);

  // Deduplicated counts across mutually exclusive brackets equal deduplicated All count
  const dedupedAll = filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ costBracket: 'All' }));
  assert.equal(b02.length + b34.length + b56.length + b7p.length, dedupedAll.length);

  // Malformed costs must NEVER leak into any specific bracket
  const malformedCosts: unknown[] = [undefined, null, '', '   ', Number.NaN, 'X', '-', 'abc', -1];
  for (const badCost of malformedCosts) {
    assert.equal(normalizeCardCost(badCost), null);
    const badCard = makeCard({ cost: badCost as unknown as number });
    assert.equal(matchesCostBracket(badCard, 'All'), true);
    assert.equal(matchesCostBracket(badCard, '0-2'), false, `Cost ${String(badCost)} leaked into 0-2`);
    assert.equal(matchesCostBracket(badCard, '3-4'), false, `Cost ${String(badCost)} leaked into 3-4`);
    assert.equal(matchesCostBracket(badCard, '5-6'), false, `Cost ${String(badCost)} leaked into 5-6`);
    assert.equal(matchesCostBracket(badCard, '7+'), false, `Cost ${String(badCost)} leaked into 7+`);
  }

  // Numeric string cost parses cleanly
  const strCostCard = makeCard({ cost: '4' as unknown as number });
  assert.equal(matchesCostBracket(strCostCard, '3-4'), true);
  assert.equal(matchesCostBracket(strCostCard, '0-2'), false);
});

test('Combined AND logic filters across Format, Color, Type, Family, Cost Bracket, Search, and Set simultaneously', () => {
  const combinedInput = [...REAL_CATALOG_CARDS, ...BATTLE_SPIRITS_CARDS];
  const indexedDirectory = synchronizeAndIndexSets([PRODUCT_SETS], combinedInput);
  const context = {
    knownSetCodes: new Set<string>(['TOKENS', 'REVIVAL', ...indexedDirectory.byCode.keys()]),
    indexedSetDirectory: indexedDirectory,
    setLookupByCode: indexedDirectory.byCode,
  };

  // Multi-condition query: Red + Spirit + Terra Dragon + Cost 3-4 + Eternal
  const multi = filterCatalogCards(
    combinedInput,
    makeFilters({
      format: 'Eternal',
      color: 'Red',
      type: ['Spirit'],
      family: 'Terra Dragon',
      costBracket: '3-4',
    }),
    context
  );
  assert.ok(multi.length > 0, 'Expected matches for Red + Spirit + Terra Dragon + Cost 3-4 + Eternal');
  for (const c of multi) {
    assert.ok(normalizeCardColors(c).includes('Red'));
    assert.ok(normalizeCardTypes(c).includes('Spirit'));
    assert.ok(normalizeCardFamilies(c.families).includes('Terra Dragon'));
    assert.ok(c.cost >= 3 && c.cost <= 4);
    assert.ok(!c.formats.includes('Standard') && c.formats.includes('Eternal'));
  }

  // Conflicting combination -> strictly empty result (e.g. Purple + Terra Dragon + 0-2 if contradictory or specific non-matching query)
  const impossible = filterCatalogCards(
    combinedInput,
    makeFilters({
      color: 'Purple',
      type: ['Magic'],
      family: 'Terra Dragon',
      costBracket: '7+',
      search: 'ImpossibleCardNameXYZ999',
    }),
    context
  );
  assert.equal(impossible.length, 0);

  // Set + Color + Cost combined
  const setAndColor = filterCatalogCards(
    combinedInput,
    makeFilters({
      setCode: 'BS01',
      color: 'Red',
      type: ['Spirit'],
      costBracket: '5-6',
    }),
    context
  );
  assert.ok(setAndColor.length > 0);
  for (const c of setAndColor) {
    assert.equal(c.setCode.toUpperCase(), 'BS01');
    assert.ok(normalizeCardColors(c).includes('Red'));
    assert.ok(normalizeCardTypes(c).includes('Spirit'));
    assert.ok(c.cost >= 5 && c.cost <= 6);
  }
});

test('normalizeCardForCatalog and Wiki hydration normalize imported color, type, and split families consistently', () => {
  assert.deepEqual(normalizeColor('紫'), ['Purple']);
  assert.deepEqual(normalizeColor('赤・青'), ['Red', 'Blue']);
  assert.equal(normalizeType('ネクサス').type, 'Nexus');
  assert.equal(normalizeType('マジック').type, 'Magic');

  const baseWikiCard = makeCard({
    id: 'wiki-bs09-003',
    cardNumber: 'BS09-003',
    name: 'Dinodragon',
    families: [],
  });
  const wikitext = `{{CardTable2
|color=Red / Blue
|type=Spirit/Burst
|cost=5
|family=Dragon, Terra Dragon
}}`;
  const hydrated = hydrateCardFromWikitext(baseWikiCard, wikitext);
  assert.deepEqual(hydrated.colors, ['Red', 'Blue']);
  assert.equal(hydrated.type, 'Spirit');
  assert.equal(hydrated.subtypeLabel, 'Spirit/Burst');
  assert.deepEqual(hydrated.families, ['Dragon', 'Terra Dragon']);
  assert.equal(hydrated.cost, 5);

  const clientNorm = normalizeCardForCatalog({
    ...hydrated,
    cost: '5' as unknown as number,
    families: ['Dragon, Terra Dragon', 'Terra Dragon'],
  });
  assert.deepEqual(clientNorm.colors, ['Red', 'Blue']);
  assert.equal(clientNorm.secondaryColor, 'Blue');
  assert.deepEqual(clientNorm.families, ['Dragon', 'Terra Dragon']);
  assert.equal(clientNorm.cost, 5);
});
