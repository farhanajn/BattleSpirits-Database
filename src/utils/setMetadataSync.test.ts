import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProductSet } from '../types/card';
import {
  normalizeSetIdentifier,
  sortSetsForFilterDropdown,
} from './setMetadataSync';

function makeProductSet(
  overrides: Partial<ProductSet> & Pick<ProductSet, 'setCode'>
): ProductSet {
  return {
    setCode: overrides.setCode,
    category: overrides.category || 'Booster',
    name: overrides.name ?? overrides.setCode,
    jpName: overrides.jpName || '',
    productType: overrides.productType || 'Booster Set',
    releaseDate: overrides.releaseDate || 'Official Release',
    formats: overrides.formats || ['Eternal'],
    blockLabel: overrides.blockLabel || 'Eternal',
    tagline: overrides.tagline || `${overrides.setCode} test set`,
    featuredCardId:
      overrides.featuredCardId || `${overrides.setCode.toLowerCase()}-001`,
    colors: overrides.colors || ['Red'],
    totalCardsInSet: overrides.totalCardsInSet ?? 0,
    wikiUrl:
      overrides.wikiUrl ||
      `https://battle-spirits.fandom.com/wiki/${overrides.setCode}`,
  };
}

describe('setMetadataSync.sortSetsForFilterDropdown', () => {
  it('groups sets by type, sorts by year and integer number (BS9 before BS10, 26RBSxx, PX25/PX26), and preserves original metadata', () => {
    const unsortedSets: ProductSet[] = [
      makeProductSet({ setCode: 'PROMO-REG', name: 'Regular Promos (P-Series)', category: 'Promo', productType: 'Promo Set' }),
      makeProductSet({ setCode: '26RSD01', name: '26RSD01', category: 'Standard Starter', productType: 'Starter Deck', formats: ['Standard', 'Eternal'] }),
      makeProductSet({ setCode: 'CB10', name: 'Collab Booster 10', category: 'Collab Booster', productType: 'Collab Booster' }),
      makeProductSet({ setCode: 'BS10', name: 'Booster Set 10', category: 'Booster' }),
      makeProductSet({ setCode: 'PX26', name: 'Promo X-Rares 26 (PX26)', category: 'Promo', productType: 'Promo Set' }),
      makeProductSet({ setCode: '26RBS03', name: 'Standard Booster 03', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
      makeProductSet({ setCode: 'SD10', name: 'Starter Deck 10', category: 'Starter Deck', productType: 'Starter Deck' }),
      makeProductSet({ setCode: 'BS9', name: 'Supernova (BS09)', category: 'Booster' }),
      makeProductSet({ setCode: '27RBS01', name: '2027 Booster 01', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
      makeProductSet({ setCode: 'CB9', name: 'Collab Booster 9', category: 'Collab Booster', productType: 'Collab Booster' }),
      makeProductSet({ setCode: 'PX25', name: 'Promo X-Rares 25 (PX25)', category: 'Promo', productType: 'Promo Set' }),
      makeProductSet({ setCode: 'BS73', name: 'Transmigrating Worlds', category: 'Booster' }),
      makeProductSet({ setCode: '26RBS01', name: 'The Genesis Pulse', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
      makeProductSet({ setCode: 'SD02', name: 'Starter Deck 02', category: 'Starter Deck', productType: 'Starter Deck' }),
      makeProductSet({ setCode: 'BS01', name: 'Dawn of the Spirit', category: 'Booster' }),
      makeProductSet({ setCode: 'BS23', name: 'BS23 Expansion', category: 'Booster' }),
      makeProductSet({ setCode: 'RP26-STD', name: 'Standard Regular Promos (RP26)', category: 'Promo', productType: 'Promo Set', formats: ['Standard', 'Eternal'] }),
      makeProductSet({ setCode: 'CBX01', name: 'Collab Booster EX 01', category: 'Collab Booster', productType: 'Collab Booster' }),
      makeProductSet({ setCode: '26RBS02', name: 'Standard Booster 02', category: 'Standard Booster', formats: ['Standard', 'Eternal'] }),
    ];

    const sorted = sortSetsForFilterDropdown(unsortedSets);

    assert.deepEqual(
      sorted.map((s) => s.setCode),
      [
        'BS01',
        'BS9',
        'BS10',
        'BS23',
        'BS73',
        'SD02',
        'SD10',
        'CB9',
        'CB10',
        'CBX01',
        '26RBS01',
        '26RBS02',
        '26RBS03',
        '26RSD01',
        '27RBS01',
        'PX25',
        'PX26',
        'PROMO-REG',
        'RP26-STD',
      ]
    );

    // Original setCode and display name remain untouched
    assert.equal(sorted.find((s) => s.setCode === 'BS9')?.name, 'Supernova (BS09)');
    assert.equal(sorted.find((s) => s.setCode === '26RBS01')?.name, 'The Genesis Pulse');
    assert.equal(normalizeSetIdentifier('PX 25'), 'PX25');
    assert.equal(normalizeSetIdentifier('BS 9'), 'BS09');
  });

  it('sorts within each category group by chronological year first and integer suffix second', () => {
    const setsWithYears = [
      { setCode: 'PROMO-LATE', name: 'Late Promo', category: 'Promo', releaseDate: '2025-04-01' },
      { setCode: 'PROMO-EARLY', name: 'Early Promo', category: 'Promo', releaseDate: '2021-07-15' },
      { setCode: 'COLLAB-A1', name: 'Collab A1', category: 'Collab', releaseDate: '2024-03-01' },
      { setCode: 'COLLAB-Z10', name: 'Collab Z10', category: 'Collab', releaseDate: '2022-09-01' },
      { setCode: 'COLLAB-Z2', name: 'Collab Z2', category: 'Collab', releaseDate: '2022-05-01' },
      { setCode: 'SD10', name: 'Starter 10', category: 'Starter', releaseDate: '2012-09-08' },
      { setCode: 'SD2', name: 'Starter 2', category: 'Starter', releaseDate: '2009-12-10' },
      { setCode: 'BS10', name: 'BS10', category: 'Main', releaseDate: '2010-11-12' },
      { setCode: 'BS9', name: 'BS9', category: 'Main', releaseDate: '2010-08-06' },
      { setCode: 'BS01', name: 'BS01', category: 'Main', releaseDate: '2008-09-13' },
    ];

    const sorted = sortSetsForFilterDropdown(setsWithYears);
    assert.deepEqual(
      sorted.map((s) => s.setCode),
      [
        'BS01',
        'BS9',
        'BS10',
        'SD2',
        'SD10',
        'COLLAB-Z2',
        'COLLAB-Z10',
        'COLLAB-A1',
        'PROMO-EARLY',
        'PROMO-LATE',
      ]
    );
  });
});
