import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { BattleSpiritsCard, ProductSet } from '../src/types/card';
import {
  compareSetIdentifiers,
  normalizeSetIdentifier,
  sortSetsForFilterDropdown,
  synchronizeAndIndexSets,
} from '../src/utils/setMetadataSync';

function makeSet(overrides: Partial<ProductSet> & Pick<ProductSet, 'setCode'>): ProductSet {
  return {
    setCode: overrides.setCode,
    category: overrides.category || 'Booster',
    name: overrides.name ?? overrides.setCode,
    jpName: overrides.jpName || '',
    productType: overrides.productType || 'Booster Set',
    releaseDate: overrides.releaseDate || 'Official Release',
    formats: overrides.formats || ['Eternal'],
    blockLabel: overrides.blockLabel || 'Eternal',
    tagline: overrides.tagline || `${overrides.setCode} set`,
    featuredCardId: overrides.featuredCardId || `${overrides.setCode.toLowerCase()}-001`,
    colors: overrides.colors || ['Red'],
    totalCardsInSet: overrides.totalCardsInSet || 0,
    wikiUrl: overrides.wikiUrl || `https://battle-spirits.fandom.com/wiki/${overrides.setCode}`,
  };
}

function makeCard(overrides: Partial<BattleSpiritsCard> & Pick<BattleSpiritsCard, 'id' | 'setCode'>): BattleSpiritsCard {
  return {
    id: overrides.id,
    name: overrides.name || 'Test Spirit',
    jpName: '',
    cardNumber: overrides.cardNumber || `${overrides.setCode}-001`,
    setCode: overrides.setCode,
    setName: overrides.setName || overrides.setCode,
    color: overrides.color || 'Red',
    cost: overrides.cost ?? 3,
    rarity: overrides.rarity || 'C',
    formats: overrides.formats || ['Eternal'],
    blockIcon: overrides.blockIcon || 'BS',
    restriction: overrides.restriction || 'Unlimited',
    type: overrides.type || 'Spirit',
    families: [],
    keywords: [],
    symbols: {},
    reduction: {},
    effects: [],
    flavorText: '',
    illustrator: '',
    artworkImage: '',
    artVariant: 'dragon',
    wikiTitle: overrides.name || 'Test Spirit',
    wikiUrl: 'https://battle-spirits.fandom.com/wiki/Test_Spirit',
    rulings: [],
  };
}

describe('Set Filter Normalization, Grouping, and Numeric Sorting', () => {
  it('normalizes identifier variants such as BS 23, BS-23, BS9, and 26R-BS01 without altering distinct sets', () => {
    assert.equal(normalizeSetIdentifier('BS 23'), 'BS23');
    assert.equal(normalizeSetIdentifier('bs-23'), 'BS23');
    assert.equal(normalizeSetIdentifier('BS23'), 'BS23');
    assert.equal(normalizeSetIdentifier('BS9'), 'BS09');
    assert.equal(normalizeSetIdentifier('BS 9'), 'BS09');
    assert.equal(normalizeSetIdentifier('SD 1'), 'SD01');
    assert.equal(normalizeSetIdentifier('26R-BS01'), '26RBS01');
    assert.equal(normalizeSetIdentifier('26R SD 1'), '26RSD01');
    assert.equal(normalizeSetIdentifier('BS100'), 'BS100');
    assert.equal(normalizeSetIdentifier('PROMO-REG'), 'PROMO-REG');
    assert.equal(normalizeSetIdentifier('RP26-STD'), 'RP26-STD');
    assert.equal(normalizeSetIdentifier('01'), '01');
    assert.equal(normalizeSetIdentifier('2026'), '2026');
  });

  it('sorts traditional BS sets numerically so BS9/BS09 always precedes BS19, BS23, BS70, and BS80', () => {
    const unsorted = [
      makeSet({ setCode: 'BS80' }),
      makeSet({ setCode: 'BS23' }),
      makeSet({ setCode: 'BS9' }),
      makeSet({ setCode: 'BS77' }),
      makeSet({ setCode: 'BS01' }),
      makeSet({ setCode: 'BS73' }),
      makeSet({ setCode: 'BS19' }),
      makeSet({ setCode: 'BS70' }),
    ];

    const sortedCodes = unsorted.slice().sort(compareSetIdentifiers).map((s) => s.setCode);
    assert.deepEqual(sortedCodes, ['BS01', 'BS9', 'BS19', 'BS23', 'BS70', 'BS73', 'BS77', 'BS80']);
  });

  it('groups BS, SD, CB/CBX, BSC, PB, PC, 26R year-based, Promo, and number-only sets logically without mixing types', () => {
    const scrambled = [
      makeSet({ setCode: 'PROMO-X', category: 'Promo' }),
      makeSet({ setCode: '26RSD01', category: 'Standard Starter', formats: ['Standard', 'Eternal'] }),
      makeSet({ setCode: 'PC12', category: 'Premium Card Set' }),
      makeSet({ setCode: 'SD70', category: 'Starter Deck' }),
      makeSet({ setCode: '2026', category: 'Booster', name: '2026' }),
      makeSet({ setCode: 'CBX01', category: 'Collab Booster' }),
      makeSet({ setCode: '26RBS04', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
      makeSet({ setCode: 'PB02', category: 'Premium Bandai' }),
      makeSet({ setCode: 'BS77', category: 'Booster' }),
      makeSet({ setCode: 'RP26-STD', category: 'Promo', formats: ['Standard', 'Eternal'] }),
      makeSet({ setCode: '26RBS01', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
      makeSet({ setCode: 'CB02', category: 'Collab Booster' }),
      makeSet({ setCode: 'BSC51', category: 'Supplementary' }),
      makeSet({ setCode: 'SD02', category: 'Starter Deck' }),
      makeSet({ setCode: '01', category: 'Booster', name: '01' }),
      makeSet({ setCode: 'PC01', category: 'Premium Card Set' }),
      makeSet({ setCode: '26RBS03', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
      makeSet({ setCode: 'TOKENS', category: 'Token' }),
      makeSet({ setCode: 'PB10', category: 'Premium Bandai' }),
      makeSet({ setCode: 'BS01', category: 'Booster' }),
      makeSet({ setCode: 'BSC05', category: 'Supplementary' }),
      makeSet({ setCode: '26RBS02', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
      makeSet({ setCode: 'CB34', category: 'Collab Booster' }),
      makeSet({ setCode: 'PROMO-REG', category: 'Promo' }),
      makeSet({ setCode: 'REVIVAL', category: 'Revival' }),
    ];

    const sorted = sortSetsForFilterDropdown(scrambled).map((s) => s.setCode);
    assert.deepEqual(sorted, [
      'BS01',
      'BS77',
      'SD02',
      'SD70',
      'CB02',
      'CB34',
      'CBX01',
      'BSC05',
      'BSC51',
      'PB02',
      'PB10',
      'PC01',
      'PC12',
      '26RBS01',
      '26RBS02',
      '26RBS03',
      '26RBS04',
      '26RSD01',
      'PROMO-REG',
      'PROMO-X',
      'RP26-STD',
      '01',
      '2026',
      'REVIVAL',
      'TOKENS',
    ]);
  });

  it('prevents duplicate set entries from identifier variations, preserves official names, and inserts newly imported sets in sorted order', () => {
    const existingSets = [
      makeSet({ setCode: 'BS77', name: 'Contract Saga: Proof Volume 2' }),
      makeSet({ setCode: 'BS23', name: 'Kenran Sengoku: BS23 Official Name' }),
      makeSet({ setCode: '26RBS01', name: 'The Genesis Pulse', formats: ['Standard', 'Eternal'] }),
    ];

    const newlyImportedCards = [
      makeCard({ id: 'bs-23-001', setCode: 'BS 23', setName: 'BS 23' }),
      makeCard({ id: 'bs78-001', setCode: 'BS78', setName: 'Future Booster 78' }),
      makeCard({ id: 'bs09-001', setCode: 'BS9', setName: 'BS9' }),
      makeCard({ id: 'num-07-001', setCode: '07', setName: '07' }),
      makeCard({ id: '26rbs05-001', setCode: '26RBS05', setName: '26RBS05', formats: ['Standard', 'Eternal'] }),
    ];

    const indexed = synchronizeAndIndexSets([existingSets], newlyImportedCards);
    const dropdownSets = sortSetsForFilterDropdown(indexed.sets);

    assert.deepEqual(
      dropdownSets.map((s) => s.setCode),
      ['BS09', 'BS23', 'BS77', 'BS78', '26RBS01', '26RBS05', '07']
    );

    const bs23 = dropdownSets.find((s) => s.setCode === 'BS23');
    assert.equal(bs23?.name, 'Kenran Sengoku: BS23 Official Name');

    const num07 = dropdownSets.find((s) => s.setCode === '07');
    assert.equal(num07?.name, '07');
  });

  it('sorts all sets in public/cards.json consistently and ensures set filtering matches normalized set codes alongside other filters', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'public/cards.json'), 'utf8')
    ) as { sets: ProductSet[]; cards: BattleSpiritsCard[] };

    const sortedAll = sortSetsForFilterDropdown(raw.sets);
    const bsOnly = sortedAll.filter((s) => /^BS\d+$/i.test(s.setCode)).map((s) => s.setCode);
    assert.equal(bsOnly[0], 'BS01');
    assert.equal(bsOnly[8], 'BS09');
    assert.equal(bsOnly[22], 'BS23');
    assert.equal(bsOnly[bsOnly.length - 1], 'BS77');

    // Verify filtering by selected set matches normalized variants while preserving other filters
    const cardsFixture: BattleSpiritsCard[] = [
      makeCard({ id: 'c1', setCode: 'BS23', color: 'Red', formats: ['Eternal'] }),
      makeCard({ id: 'c2', setCode: 'BS 23', color: 'Blue', formats: ['Eternal'] }),
      makeCard({ id: 'c3', setCode: 'BS70', color: 'Red', formats: ['Eternal'] }),
    ];

    const selectedSet = 'BS23';
    const targetNorm = normalizeSetIdentifier(selectedSet);
    const setOnlyMatches = cardsFixture.filter(
      (c) => normalizeSetIdentifier(c.setCode) === targetNorm
    );
    assert.deepEqual(
      setOnlyMatches.map((c) => c.id),
      ['c1', 'c2']
    );

    const combinedMatches = cardsFixture.filter(
      (c) => normalizeSetIdentifier(c.setCode) === targetNorm && c.color === 'Red'
    );
    assert.deepEqual(
      combinedMatches.map((c) => c.id),
      ['c1']
    );
  });
});
