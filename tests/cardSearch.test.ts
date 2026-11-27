import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { BattleSpiritsCard, FilterState, SortOption } from '../src/types/card';
import {
  filterCatalogCards,
  INITIAL_FILTER_STATE,
  normalizeCardColors,
  normalizeCardCost,
  normalizeCardFamilies,
  normalizeCardTypes,
} from '../src/utils/cardFilterNormalization';
import { evaluateCardSearchMatch, scoreCardSearchMatch } from '../src/utils/cardSearch';
import { PRODUCT_SETS } from '../src/data/cards';
import { synchronizeAndIndexSets } from '../src/utils/setMetadataSync';

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

test('9-tier relevance ranking orders exact name > exact alias > prefix > name contains > alias contains > trait > effect > JP > metadata', () => {
  const tier1ExactName = makeCard({
    id: 't1-exact-name',
    cardNumber: 'BS10-001',
    name: 'Phoenix',
    families: ['Winged Beast'],
  });
  const tier2ExactAlias = makeCard({
    id: 't2-exact-alias',
    cardNumber: 'BS10-002',
    name: 'Vermilion Firebird',
    wikiTitle: 'Phoenix (Card)',
    families: ['Winged Beast'],
  });
  const tier3NamePrefix = makeCard({
    id: 't3-name-prefix',
    cardNumber: 'BS10-003',
    name: 'Phoenix Blade',
    families: ['Exalted Sword'],
    type: 'Brave',
  });
  const tier3NamePrefixWithArticle = makeCard({
    id: 't3-name-article-prefix',
    cardNumber: 'BS10-004',
    name: 'The Phoenix Sovereign',
    families: ['Emperor Beast'],
  });
  const tier4NameContains = makeCard({
    id: 't4-name-contains',
    cardNumber: 'BS10-005',
    name: 'Crimson Sky Phoenix Guard',
    families: ['Astral Dragon'],
  });
  const tier5AliasContains = makeCard({
    id: 't5-alias-contains',
    cardNumber: 'BS10-006',
    name: 'Solar Flame Wing',
    aliases: ['Reborn Phoenix Guardian'],
    families: ['Astral Spirit'],
  });
  const tier6TraitMatch = makeCard({
    id: 't6-trait',
    cardNumber: 'BS10-007',
    name: 'Ashen Hatchling',
    families: ['Phoenix'],
  });
  const tier7EffectMatch = makeCard({
    id: 't7-effect',
    cardNumber: 'BS10-008',
    name: 'Flame Shrine',
    type: 'Nexus',
    families: [],
    effects: [{ timing: 'LV1', text: 'Summon 1 Phoenix Spirit from your Trash.' }],
  });
  const tier9MetadataMatch = makeCard({
    id: 't9-metadata',
    cardNumber: 'BS10-009',
    name: 'Volcanic Rock',
    type: 'Nexus',
    families: [],
    setCode: 'BS10',
    setName: 'Rise of Phoenix',
    illustrator: 'Phoenix Studio',
  });

  const shuffled = [
    tier9MetadataMatch,
    tier7EffectMatch,
    tier6TraitMatch,
    tier5AliasContains,
    tier4NameContains,
    tier3NamePrefixWithArticle,
    tier3NamePrefix,
    tier2ExactAlias,
    tier1ExactName,
  ];

  const ranked = filterCatalogCards(shuffled, makeFilters({ search: 'Phoenix', sortBy: 'relevance' }));
  assert.deepEqual(
    ranked.map((c) => c.id),
    [
      't1-exact-name',
      't2-exact-alias',
      't3-name-prefix',
      't3-name-article-prefix',
      't4-name-contains',
      't5-alias-contains',
      't6-trait',
      't7-effect',
      't9-metadata',
    ]
  );

  // Japanese tier ranks ahead of metadata and strictly separates exact JP name > JP name contains > JP effect
  const jpExact = makeCard({
    id: 'jp-exact',
    cardNumber: 'BS11-001',
    name: 'Unrelated EN Name A',
    jpName: 'フェニックス',
    families: [],
  });
  const jpContains = makeCard({
    id: 'jp-contains',
    cardNumber: 'BS11-002',
    name: 'Unrelated EN Name B',
    jpName: '炎のフェニックス竜',
    families: [],
  });
  const jpEffectOnly = makeCard({
    id: 'jp-effect',
    cardNumber: 'BS11-003',
    name: 'Unrelated EN Name C',
    jpName: '炎の竜',
    jpEffect: '系統：「フェニックス」を持つスピリットを召喚する。',
    families: [],
  });
  const jpSetOnly = makeCard({
    id: 'jp-set',
    cardNumber: 'BS11-004',
    name: 'Unrelated EN Name D',
    jpName: '岩石の砦',
    setName: 'フェニックス覚醒',
    families: [],
  });

  const jpRanked = filterCatalogCards(
    [jpSetOnly, jpEffectOnly, jpContains, jpExact],
    makeFilters({ search: 'フェニックス', sortBy: 'relevance' })
  );
  assert.deepEqual(
    jpRanked.map((c) => c.id),
    ['jp-exact', 'jp-contains', 'jp-effect', 'jp-set']
  );
});

test('Normalization handles CamelCase, hyphens, punctuation, smart quotes, apostrophes, and transliteration variants', () => {
  const camelCard = makeCard({
    id: 'camel',
    cardNumber: 'BS75-CX01',
    name: 'The CrimsonThunderEmperorDragon Siegwurm',
    families: ['Astral Dragon'],
  });
  const hyphenCard = makeCard({
    id: 'hyphen',
    cardNumber: 'BS09-X35',
    name: 'The SupernovaDragon Siegwurm-Nova',
    families: ['Astral Dragon'],
  });
  const apostropheCard = makeCard({
    id: 'apostrophe',
    cardNumber: 'BS45-088',
    name: "Artemis’ Lake",
    families: [],
  });
  const pepperCard = makeCard({
    id: 'pepper',
    cardNumber: 'BS40-001',
    name: "Pepper's Vanguard",
    families: [],
  });
  const belzeebubCard = makeCard({
    id: 'belzeebub',
    cardNumber: 'BS19-X02',
    name: 'The SevenShogun Demon Belzeebub',
    wikiTitle: 'The SevenShogun Beelzebeat',
    families: [],
  });
  const iceShieldCard = makeCard({
    id: 'ice-shield',
    cardNumber: 'BS19-106',
    name: 'Ice Age Shield',
    aliases: ['Absolute Ice Shield'],
    families: [],
  });

  const pool = [camelCard, hyphenCard, apostropheCard, pepperCard, belzeebubCard, iceShieldCard];

  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: 'Thunder Emperor Dragon' }))[0]?.id,
    'camel'
  );
  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: 'Siegwurm Nova' }))[0]?.id,
    'hyphen'
  );
  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: 'Seigwurm-Nova' }))[0]?.id,
    'hyphen'
  );
  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: "Artemis' Lake" }))[0]?.id,
    'apostrophe'
  );
  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: 'Peppers Vanguard' }))[0]?.id,
    'pepper'
  );
  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: 'Pepper Vanguard' }))[0]?.id,
    'pepper'
  );
  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: 'Beelzebub' }))[0]?.id,
    'belzeebub'
  );
  assert.equal(
    filterCatalogCards(pool, makeFilters({ search: 'Absolute Ice Shield' }))[0]?.id,
    'ice-shield'
  );
});

test('Prevents cross-word gluing, short-word mid-word leaks, and set-name false positives', () => {
  const noisyCards = [
    makeCard({
      id: 'glued-effect',
      cardNumber: 'BS01-112',
      name: 'The Castle of Eternal Snow',
      type: 'Nexus',
      families: [],
      effects: [{ timing: 'LV1', text: 'During the battle of winter spirits, draw 1 card.' }],
    }),
    makeCard({
      id: 'midword-leo',
      cardNumber: 'BS02-010',
      name: 'Scholar Cleomenes',
      families: ['Magician'],
    }),
    makeCard({
      id: 'genuine-leo',
      cardNumber: 'BS45-042',
      name: 'Nemean-Leo SVL-00',
      families: ['Emperor Beast'],
    }),
    makeCard({
      id: 'reduce-effect',
      cardNumber: 'BS03-010',
      name: 'Sapphire Golem',
      color: 'Blue',
      families: ['Artificial Soldier'],
      effects: [{ timing: 'LV1', text: 'Reduce the cost of this card by 1; cost cannot be ignored.' }],
    }),
    makeCard({
      id: 'pure-red-no-text',
      cardNumber: 'BS03-011',
      name: 'Flare Wyvern',
      color: 'Red',
      families: ['Terra Dragon'],
      effects: [{ timing: 'LV1', text: 'This Spirit gains +2000 BP.' }],
    }),
    makeCard({
      id: 'red-name',
      cardNumber: 'BS19-098',
      name: 'Red Ray',
      color: 'Red',
      type: 'Magic',
      families: [],
    }),
    makeCard({
      id: 'recover-effect',
      cardNumber: 'BS19-108',
      name: 'Recovery Rush',
      type: 'Magic',
      families: [],
      effects: [{ timing: 'Flash', text: 'Recover 1 sovereign core from Trash.' }],
    }),
    makeCard({
      id: 'over-name',
      cardNumber: 'BS62-072',
      name: 'Oracle XIV Over Temperance',
      families: ['Jade Thunder'],
    }),
    makeCard({
      id: 'supernova-set-only',
      cardNumber: 'BS09-001',
      name: 'Little Lizard',
      setCode: 'BS09',
      setName: 'Crush of Supernova',
      families: ['Terra Dragon'],
    }),
    makeCard({
      id: 'nova-name',
      cardNumber: 'BS09-X35',
      name: 'The SupernovaDragon Siegwurm-Nova',
      setCode: 'BS09',
      setName: 'Crush of Supernova',
      families: ['Astral Dragon'],
    }),
    makeCard({
      id: 'revival-bs01-001',
      cardNumber: '26RBS01-001',
      name: 'Petristar',
      setCode: '26RBS01',
      setName: '26RBS01',
      families: ['Star Dragon'],
    }),
    makeCard({
      id: 'bs01-010',
      cardNumber: 'BS01-010',
      name: 'Lizard Man',
      setCode: 'BS01',
      setName: 'BS01',
      families: ['Terra Dragon'],
    }),
    makeCard({
      id: 'bs01-001',
      cardNumber: 'BS01-001',
      name: 'Goradon',
      setCode: 'BS01',
      setName: 'BS01',
      families: ['Terra Dragon'],
    }),
  ];

  // "Leo" matches genuine Leo card only, never "battle of" or "Cleomenes"
  assert.deepEqual(
    filterCatalogCards(noisyCards, makeFilters({ search: 'Leo' })).map((c) => c.id),
    ['genuine-leo']
  );

  // "Red" excludes "reduce"/"ignored" and unrelated Red cards
  assert.deepEqual(
    filterCatalogCards(noisyCards, makeFilters({ search: 'Red' })).map((c) => c.id),
    ['red-name']
  );

  // "Over" excludes "Recovery"/"sovereign"
  assert.deepEqual(
    filterCatalogCards(noisyCards, makeFilters({ search: 'Over' })).map((c) => c.id),
    ['over-name']
  );

  // "Nova" excludes BS09 unrelated cards whose setName is "Crush of Supernova"
  assert.deepEqual(
    filterCatalogCards(noisyCards, makeFilters({ search: 'Nova' })).map((c) => c.id),
    ['nova-name']
  );

  // "BS01-001" matches strictly BS01-001, not 26RBS01-001 or BS01-010
  assert.deepEqual(
    filterCatalogCards(noisyCards, makeFilters({ search: 'BS01-001' })).map((c) => c.id),
    ['bs01-001']
  );
});

test('Real 2,353+ card catalog produces accurate, high-signal, fast relevance-ranked results', () => {
  assert.ok(REAL_CATALOG_CARDS.length >= 2000, 'Expected full public/cards.json catalog');
  const indexed = synchronizeAndIndexSets([PRODUCT_SETS], REAL_CATALOG_CARDS);
  const ctx = {
    knownSetCodes: new Set(['TOKENS', 'REVIVAL', ...indexed.byCode.keys()]),
    indexedSetDirectory: indexed,
    setLookupByCode: indexed.byCode,
    preserveRequestedSort: true,
  };

  // 1. "Leo": drops all 150+ "battle of"/"whale of" noise cards; keeps genuine Leo cards at the top
  const leoResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Leo', sortBy: 'relevance' }),
    ctx
  );
  assert.ok(leoResults.length >= 5 && leoResults.length <= 20, `Expected tight Leo results, got ${leoResults.length}`);
  assert.ok(
    leoResults.slice(0, 5).every((c) => /\bleo/i.test(c.name) || /leo/i.test(c.name)),
    `Expected top 5 Leo results to contain Leo in card name: ${leoResults.slice(0, 5).map((c) => c.name).join(', ')}`
  );
  assert.ok(
    !leoResults.some((c) => c.cardNumber === 'BS01-112' || c.cardNumber === '26RBS01-091'),
    'Cross-word "battle of" cards must not match "Leo"'
  );

  // 2. "Nova": excludes unrelated BS09 cards via "Crush of Supernova"
  const novaResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Nova', sortBy: 'relevance' }),
    ctx
  );
  assert.ok(novaResults.length >= 5 && novaResults.length <= 20, `Expected tight Nova results, got ${novaResults.length}`);
  assert.ok(
    novaResults.slice(0, 4).every((c) => /nova/i.test(c.name)),
    'Top Nova matches must have Nova in name'
  );

  // 3. "BS01-001": exact single card
  const bs01001 = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'BS01-001', sortBy: 'relevance' }),
    ctx
  );
  assert.deepEqual(
    bs01001.map((c) => c.cardNumber),
    ['BS01-001']
  );

  // 4. "SD01": strictly SD01 set cards, NOT 26RSD01
  const sd01 = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'SD01', sortBy: 'relevance' }),
    ctx
  );
  assert.ok(sd01.length > 0);
  assert.ok(sd01.every((c) => c.setCode === 'SD01'));

  // 5. "Red": never pulls unrelated cards just because effect says "reduce" / "reduction" / "ignored"
  const redResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Red', sortBy: 'relevance' }),
    ctx
  );
  assert.ok(redResults.length > 0 && redResults.length < 400);
  assert.ok(
    redResults
      .slice(0, 10)
      .every((c) => /\bred\b/i.test(c.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))),
    'Top "Red" matches must have Red in card name'
  );
  for (const c of redResults) {
    const score = scoreCardSearchMatch(c, 'Red', { matchedSet: indexed.byCode.get(c.setCode.toUpperCase()) });
    assert.ok(score > 0, `Matched card ${c.cardNumber} must have positive relevance score`);
  }

  // 6. "Siegwurm Nova": multi-word query ranks all Siegwurm-Nova cards
  const siegNova = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Siegwurm Nova', sortBy: 'relevance' }),
    ctx
  );
  assert.ok(siegNova.length >= 4);
  assert.ok(siegNova.every((c) => /siegwurm/i.test(c.name) && /nova/i.test(c.name)));

  // 7. Performance benchmark (warm query pass across entire catalog)
  const benchStart = performance.now();
  filterCatalogCards(REAL_CATALOG_CARDS, makeFilters({ search: 'Dragon', sortBy: 'relevance' }), ctx);
  const benchMs = performance.now() - benchStart;
  assert.ok(benchMs < 250, `Expected warm catalog search under 250ms, took ${benchMs.toFixed(1)}ms`);
});

test('User-selected sort options preserve exact search result set while applying requested order', () => {
  const indexed = synchronizeAndIndexSets([PRODUCT_SETS], REAL_CATALOG_CARDS);
  const ctx = {
    knownSetCodes: new Set(['TOKENS', 'REVIVAL', ...indexed.byCode.keys()]),
    indexedSetDirectory: indexed,
    setLookupByCode: indexed.byCode,
    preserveRequestedSort: true,
  };

  const relevanceResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Dragon', sortBy: 'relevance' }),
    ctx
  );
  assert.ok(relevanceResults.length >= 20);
  const expectedIds = new Set(relevanceResults.map((c) => c.id));

  const sortsToCheck: SortOption[] = ['number', 'newest', 'rarity-desc', 'color', 'cost-asc', 'cost-desc', 'bp-desc', 'name'];
  for (const sortBy of sortsToCheck) {
    const sorted = filterCatalogCards(
      REAL_CATALOG_CARDS,
      makeFilters({ search: 'Dragon', sortBy }),
      ctx
    );
    assert.equal(sorted.length, relevanceResults.length, `Sort "${sortBy}" changed matched count`);
    assert.deepEqual(
      new Set(sorted.map((c) => c.id)),
      expectedIds,
      `Sort "${sortBy}" changed matched card set`
    );
  }

  // Verify cost-asc actually orders by ascending cost
  const costAsc = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Dragon', sortBy: 'cost-asc' }),
    ctx
  );
  for (let i = 1; i < costAsc.length; i++) {
    const prev = normalizeCardCost(costAsc[i - 1].cost) ?? Number.MAX_SAFE_INTEGER;
    const curr = normalizeCardCost(costAsc[i].cost) ?? Number.MAX_SAFE_INTEGER;
    assert.ok(prev <= curr, `Expected ascending cost order at index ${i}: ${prev} <= ${curr}`);
  }

  // Verify alphabetical name sort actually orders by name
  const nameSorted = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({ search: 'Dragon', sortBy: 'name' }),
    ctx
  );
  for (let i = 1; i < nameSorted.length; i++) {
    assert.ok(
      nameSorted[i - 1].name.localeCompare(nameSorted[i].name) <= 0,
      `Expected alphabetical order at index ${i}`
    );
  }
});

test('Global Search strictly AND-combines with all facet filters and UI exposes Relevance consistently', () => {
  const indexed = synchronizeAndIndexSets([PRODUCT_SETS], REAL_CATALOG_CARDS);
  const ctx = {
    knownSetCodes: new Set(['TOKENS', 'REVIVAL', ...indexed.byCode.keys()]),
    indexedSetDirectory: indexed,
    setLookupByCode: indexed.byCode,
    preserveRequestedSort: true,
  };

  // Search + Color + Type + Cost Bracket + Family + Version
  const comboResults = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({
      search: 'Dragon',
      color: 'Red',
      type: ['Spirit'],
      family: 'Astral Dragon',
      version: 'Original',
      sortBy: 'relevance',
    }),
    ctx
  );
  assert.ok(comboResults.length > 0);
  for (const c of comboResults) {
    assert.ok(normalizeCardColors(c).includes('Red'));
    assert.ok(normalizeCardTypes(c).includes('Spirit'));
    assert.ok(normalizeCardFamilies(c.families).includes('Astral Dragon'));
    assert.ok(!c.isRevival);
    assert.ok(evaluateCardSearchMatch(c, 'Dragon').matched);
  }

  // Search + Multicolor
  const multiSearch = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({
      search: 'Sword',
      color: 'Multicolor',
      sortBy: 'relevance',
    }),
    ctx
  );
  for (const c of multiSearch) {
    assert.ok(normalizeCardColors(c).length >= 2);
  }

  // Search + Format + Cost Bracket
  const costSearch = filterCatalogCards(
    REAL_CATALOG_CARDS,
    makeFilters({
      search: 'Draw',
      format: 'Eternal',
      costBracket: '4',
      sortBy: 'relevance',
    }),
    ctx
  );
  assert.ok(costSearch.length > 0);
  for (const c of costSearch) {
    assert.equal(normalizeCardCost(c.cost), 4);
    assert.ok(!c.formats.includes('Standard') && c.formats.includes('Eternal'));
  }

  // Verify both Desktop (src/App.tsx) and Mobile (src/components/FilterSheet.tsx) expose 'relevance' sort option
  const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const filterSheetSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/FilterSheet.tsx'),
    'utf8'
  );
  assert.ok(appSource.includes('<option value="relevance">'), 'Desktop header sort must include relevance');
  assert.ok(filterSheetSource.includes('<option value="relevance">'), 'Mobile FilterSheet sort must include relevance');
  assert.ok(
    appSource.includes('handleSearchQueryChange'),
    'App.tsx must use handleSearchQueryChange so clearing search preserves filters'
  );
});
