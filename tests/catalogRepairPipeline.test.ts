import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BattleSpiritsCard } from '../src/types/card.ts';
import {
  evaluateCardCompleteness,
  isLikelyNonCardWikiTitle,
  isPlaceholderArtworkUrl,
  isSentinelEffectText,
  sanitizeEffectsArray,
} from '../src/utils/cardCompletion.ts';
import {
  auditCatalogRecords,
  resetCatalogRepairStateForTests,
  runCatalogRepairBatch,
  type RepairDependencies,
} from '../server/catalogRepairService.ts';
import {
  resetCachedStateForTests,
  saveCatalogScanState,
  type CatalogScanState,
} from '../server/catalogSyncService.ts';
import { hydrateCardFromWikitext, parseSetTableRows } from '../server/wikiService.ts';
import { expandWikiFileCandidates, isCardArtworkFile } from '../server/wikiCardLookup.ts';
import {
  registerManualWikiMapping,
  unregisterManualWikiMapping,
} from '../src/utils/ManualWikiMapping.ts';

function makeBaseCard(overrides: Partial<BattleSpiritsCard> = {}): BattleSpiritsCard {
  return {
    id: 'test-card-1',
    name: 'Test Spirit',
    jpName: '',
    cardNumber: 'BS01-001',
    setCode: 'BS01',
    setName: 'BS01',
    color: 'Red',
    cost: 3,
    rarity: 'C',
    formats: ['Eternal'],
    type: 'Spirit',
    families: ['Terra Dragon'],
    symbols: { Red: 1 },
    reduction: { Red: 1 },
    effects: [{ timing: '[Lv1-Lv2]', text: 'Draw 1 card.' }],
    keywords: [],
    flavorText: '',
    illustrator: '',
    artVariant: 'dragon',
    artworkImage: '/api/wiki/image?file=BS01-001.png',
    rulings: [],
    wikiUrl: 'https://battle-spirits.fandom.com/wiki/Test_Spirit',
    wikiTitle: 'Test Spirit',
    isWikiLoaded: true,
    ...overrides,
  };
}

function makeTempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiritsdex-repair-test-'));
  const publicCardsJsonPath = path.join(dir, 'cards.json');
  const stateFilePath = path.join(dir, 'catalog-sync-state.json');
  const repairStatePath = path.join(dir, 'catalog-repair-state.json');
  return { dir, publicCardsJsonPath, stateFilePath, repairStatePath };
}

function writeTestPublicCards(filePath: string, cards: BattleSpiritsCard[]) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        banList: { effectiveDate: 'test', byCardNumber: {}, byName: {} },
        sets: [],
        cards,
      },
      null,
      2
    ),
    'utf8'
  );
}

test('1. Sentinel effect stripping and completeness evaluation distinguish vanilla vs unavailable vs missing', () => {
  assert.equal(isSentinelEffectText('No English effect text listed on this card.'), true);
  assert.equal(isSentinelEffectText('No effect text recorded for this card.'), true);
  assert.equal(isSentinelEffectText('-'), true);
  assert.equal(isSentinelEffectText('When Summoned: Draw 1 card.'), false);

  const cleaned = sanitizeEffectsArray([
    { timing: 'Card Text', text: 'No English effect text listed on this card.' },
    { timing: '[Lv1-Lv2]', text: 'BP +2000.' },
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].text, 'BP +2000.');

  const vanillaEval = evaluateCardCompleteness(
    makeBaseCard({ effects: [], effectStatus: 'no_printed_effect' }),
    { hasNoPrintedEffectCategory: true, artworkFileExists: true }
  );
  assert.equal(vanillaEval.effectStatus, 'no_printed_effect');
  assert.equal(vanillaEval.effectVerified, true);
  assert.equal(vanillaEval.completionStatus, 'complete');

  const unavailEval = evaluateCardCompleteness(
    makeBaseCard({ effects: [], artworkImage: '', isWikiLoaded: false }),
    { wikitextEmpty: true, artworkFileExists: false, artworkFailureReason: 'unavailable_on_wiki' }
  );
  assert.equal(unavailEval.artworkStatus, 'unavailable');
  assert.equal(unavailEval.effectStatus, 'unavailable');
  assert.equal(unavailEval.completionStatus, 'incomplete');
  assert.ok(unavailEval.unavailableFields.includes('artwork'));
  assert.ok(unavailEval.unavailableFields.includes('effectText'));
});

test('2. URL-encoded & .webp artwork filenames decode cleanly and non-card titles are rejected in set rows', () => {
  assert.equal(isCardArtworkFile('Barone,_or_not%3F.png'), true);
  const candidates = expandWikiFileCandidates('Barone,_or_not%3F.webp', 'BS50-RV012');
  assert.ok(candidates.includes('Barone,_or_not?.png'));
  assert.ok(candidates.includes('BS50-RV012.png'));

  assert.equal(isLikelyNonCardWikiTitle('Introduction'), true);
  assert.equal(isLikelyNonCardWikiTitle('Promo Cards/Campaign Cards'), true);

  const rows = parseSetTableRows(
    `== Cards ==
{| class="wikitable"
! Number !! Name !! Type !! Color !! Cost
|-
| SD50-001 || [[Introduction]] || Spirit || Red || 1
|-
| BS50-RV012 || [[The ArmoredDragon Emperor Siegwurm]] || Spirit || Red || 6
|}`,
    {
      setCode: 'BS50',
      category: 'Main',
      name: 'BS50',
      jpName: '',
      productType: 'Booster Pack',
      releaseDate: '2019',
      formats: ['Eternal'],
      blockLabel: 'Saga',
      tagline: '',
      featuredCardId: 'bs50-001',
      colors: ['Red'],
      totalCardsInSet: 2,
      wikiUrl: '',
    }
  );
  assert.equal(rows.some((r) => r.wikiTitle === 'Introduction'), false);
  const valid = rows.find((r) => r.cardNumber === 'BS50-RV012');
  assert.ok(valid);
  assert.equal(valid.artworkImage, '');
  assert.equal(valid.artworkStatus, 'missing');
  assert.equal(valid.completionStatus, 'incomplete');
});

test('3. Missing artwork only, missing effect only, and both missing repair cleanly & non-destructively', async () => {
  const env = makeTempEnv();
  resetCachedStateForTests(env.stateFilePath);
  resetCatalogRepairStateForTests(env.repairStatePath);

  const cards: BattleSpiritsCard[] = [
    // Scenario 1: Missing artwork only (has valid effect & family)
    makeBaseCard({
      id: 'bs01-001',
      cardNumber: 'BS01-001',
      name: 'Goradon',
      wikiTitle: 'Goradon',
      artworkImage: '',
      effects: [{ timing: '[Lv1-Lv2]', text: 'Existing valid effect.' }],
      families: ['Terra Dragon'],
      isWikiLoaded: true,
    }),
    // Scenario 2: Missing / sentinel effect only (has valid artwork)
    makeBaseCard({
      id: 'bs01-002',
      cardNumber: 'BS01-002',
      name: 'Lizardman',
      wikiTitle: 'Lizardman',
      artworkImage: '/api/wiki/image?file=BS01-002.png',
      effects: [{ timing: 'Card Text', text: 'No English effect text listed on this card.' }],
      families: [],
      isWikiLoaded: true,
    }),
    // Scenario 3: Both missing artwork & missing effect + placeholder SVG artwork
    makeBaseCard({
      id: 'bs01-003',
      cardNumber: 'BS01-003',
      name: 'Flame Dragon',
      wikiTitle: 'Flame Dragon',
      artworkImage: '/images/bs_red_dragon_card.png',
      effects: [],
      families: [],
      isWikiLoaded: true,
    }),
  ];

  writeTestPublicCards(env.publicCardsJsonPath, cards);

  const deps: RepairDependencies = {
    publicCardsJsonPath: env.publicCardsJsonPath,
    stateFilePath: env.stateFilePath,
    repairStatePath: env.repairStatePath,
    batchFetchPagesFn: async (titles) => {
      const m = new Map();
      if (titles.includes('Goradon')) {
        m.set('Goradon', {
          wikitext: `{{CardTableV2
|name=Goradon
|kanji=ゴラドン
|cardnum=BS01-001
|set1=BS01
|color=Red
|family=Terra Dragon
|image=BS01-001.png
|effect=[Lv1-Lv2] Wiki parsed effect.
}}`,
          pageImages: ['File:BS01-001.png'],
        });
      }
      if (titles.includes('Lizardman')) {
        m.set('Lizardman', {
          wikitext: `{{CardTableV2
|name=Lizardman
|kanji=リザードマン
|cardnum=BS01-002
|set1=BS01
|color=Red
|families=Terra Dragon
|image=BS01-002.png
|eneffect=[Lv1-Lv2] When Attacks: BP +1000.
}}`,
          pageImages: ['File:BS01-002.png'],
        });
      }
      if (titles.includes('Flame Dragon')) {
        m.set('Flame Dragon', {
          wikitext: `{{CardTableV2
|name=Flame Dragon
|kanji=フレイムドラゴン
|cardnum=BS01-003
|set1=BS01
|color=Red
|family=Astral Dragon
|altimage=BS01-003.jpg
|effect=[Lv1] Flash: Destroy 1 Spirit with 3000 BP or less.
}}`,
          pageImages: ['File:BS01-003.jpg'],
        });
      }
      return m;
    },
    batchVerifyFilesFn: async (files) => {
      const m = new Map<string, string | null>();
      for (const f of files) {
        if (['bs01-001.png', 'bs01-002.png', 'bs01-003.jpg'].includes(f.toLowerCase())) {
          m.set(f.toLowerCase(), `https://static.wikia.nocookie.net/battle-spirits/images/${f}`);
        } else {
          m.set(f.toLowerCase(), null);
        }
      }
      return m;
    },
    fetchWikiJsonFn: async () => ({ query: { search: [] } }),
  };

  const beforeAudit = await auditCatalogRecords({ verifyArtworkOnline: true }, deps);
  assert.equal(beforeAudit.categories.missingArtworkUrl, 1);
  assert.equal(beforeAudit.categories.placeholderArtwork, 1);
  assert.equal(beforeAudit.categories.missingEffectText, 2);
  assert.equal(beforeAudit.categories.incompleteDespiteSuccess, 3);

  const res = await runCatalogRepairBatch({ mode: 'all_incomplete', batchSize: 50 }, deps);
  assert.equal(res.jobStatus, 'completed');
  assert.equal(res.stats.repairedArtwork, 3);
  assert.equal(res.stats.repairedEffects, 2);

  const afterAudit = await auditCatalogRecords({ verifyArtworkOnline: true }, deps);
  assert.equal(afterAudit.completeVerifiedCount, 3);
  assert.equal(afterAudit.categories.missingArtworkUrl, 0);
  assert.equal(afterAudit.categories.placeholderArtwork, 0);
  assert.equal(afterAudit.categories.missingEffectText, 0);
  assert.equal(afterAudit.categories.incompleteDespiteSuccess, 0);

  const persisted = JSON.parse(fs.readFileSync(env.publicCardsJsonPath, 'utf8')) as {
    cards: BattleSpiritsCard[];
  };
  const goradon = persisted.cards.find((c) => c.id === 'bs01-001')!;
  assert.equal(goradon.artworkImage, '/api/wiki/image?file=BS01-001.png');
  assert.equal(goradon.effects[0].text, 'Existing valid effect.');
  const flame = persisted.cards.find((c) => c.id === 'bs01-003')!;
  assert.equal(flame.artworkImage, '/api/wiki/image?file=BS01-003.jpg');
  assert.equal(isPlaceholderArtworkUrl(flame.artworkImage), false);
});

test('4. Johnny Bepp (26RCB02-057 vs SD50-CP01) prevents cross-edition false hydration & retry_matching discovers missing wikiTitle', async () => {
  const env = makeTempEnv();
  resetCachedStateForTests(env.stateFilePath);
  resetCatalogRepairStateForTests(env.repairStatePath);

  const cards: BattleSpiritsCard[] = [
    // Collab reprint missing its own Wiki page (Wiki only has SD50-CP01 under "Johnny Bepp")
    makeBaseCard({
      id: '26rcb02-057',
      cardNumber: '26RCB02-057',
      setCode: '26RCB02',
      setName: '26RCB02',
      name: 'Johnny Bepp',
      wikiTitle: 'Johnny Bepp',
      artworkImage: '',
      effects: [],
      families: [],
      isWikiLoaded: false,
    }),
    // Card missing wikiTitle but discoverable via cardNumber search
    makeBaseCard({
      id: 'bs50-rv012',
      cardNumber: 'BS50-RV012',
      setCode: 'BS50',
      setName: 'BS50',
      name: 'Mist Wyvern',
      wikiTitle: '',
      artworkImage: '/api/wiki/image?file=Mist_Wyvern.webp',
      effects: [],
      families: [],
      isWikiLoaded: false,
    }),
  ];

  writeTestPublicCards(env.publicCardsJsonPath, cards);

  const deps: RepairDependencies = {
    publicCardsJsonPath: env.publicCardsJsonPath,
    stateFilePath: env.stateFilePath,
    repairStatePath: env.repairStatePath,
    batchFetchPagesFn: async (titles) => {
      const m = new Map();
      if (titles.includes('Johnny Bepp')) {
        // Contains SD50-CP01 ONLY — does NOT contain 26RCB02 or 26RCB02-057!
        m.set('Johnny Bepp', {
          wikitext: `{{CardTableV2
|name=Johnny Bepp
|kanji=ジョニー別府
|cardnum=SD50-CP01
|set1=SD50
|color=Yellow
|family=Costume
|image=SD50-CP01.png
|effect=[Lv1-Lv2] SD50-only effect.
}}`,
          pageImages: ['File:SD50-CP01.png'],
        });
      }
      if (titles.includes('The Wyvern Mist Wyvern')) {
        m.set('The Wyvern Mist Wyvern', {
          wikitext: `{{CardTableV2
|name=Mist Wyvern
|kanji=ミストワイバーン
|cardnum=BS50-RV012
|set1=BS50
|color=White
|family=Winged Beast
|image=BS50-RV012.png
|effect=[Lv1-Lv2] Refresh all Spirits.
}}`,
          pageImages: ['File:BS50-RV012.png'],
        });
      }
      return m;
    },
    batchVerifyFilesFn: async (files) => {
      const m = new Map<string, string | null>();
      for (const f of files) {
        if (f.toLowerCase() === 'bs50-rv012.png') {
          m.set(f.toLowerCase(), 'https://static.wikia.nocookie.net/battle-spirits/images/BS50-RV012.png');
        } else {
          m.set(f.toLowerCase(), null);
        }
      }
      return m;
    },
    fetchWikiJsonFn: async (params) => {
      if (params.srsearch?.includes('BS50-RV012') || params.srsearch?.includes('Mist Wyvern')) {
        return { query: { search: [{ title: 'The Wyvern Mist Wyvern' }] } };
      }
      if (params.srsearch?.includes('Johnny Bepp')) {
        return { query: { search: [{ title: 'Johnny Bepp' }] } };
      }
      return { query: { search: [] } };
    },
  };

  const res = await runCatalogRepairBatch({ mode: 'retry_matching', batchSize: 50 }, deps);
  assert.equal(res.jobStatus, 'completed');

  const persisted = JSON.parse(fs.readFileSync(env.publicCardsJsonPath, 'utf8')) as {
    cards: BattleSpiritsCard[];
  };
  const johnny = persisted.cards.find((c) => c.id === '26rcb02-057')!;
  // Must NOT copy SD50-CP01 artwork or effects or claim isWikiLoaded: true!
  assert.equal(johnny.isWikiLoaded, false);
  assert.equal(johnny.artworkImage, '');
  assert.equal(johnny.artworkStatus, 'unavailable');
  assert.equal(johnny.effectStatus, 'unavailable');
  assert.equal(johnny.completionStatus, 'incomplete');

  const wyvern = persisted.cards.find((c) => c.id === 'bs50-rv012')!;
  assert.equal(wyvern.wikiTitle, 'The Wyvern Mist Wyvern');
  assert.equal(wyvern.artworkImage, '/api/wiki/image?file=BS50-RV012.png');
  assert.equal(wyvern.artworkVerified, true);
  assert.equal(wyvern.effectVerified, true);
  assert.equal(wyvern.completionStatus, 'complete');
});

test('5. ManualWikiMapping preservation, vanilla no_printed_effect, resumable checkpointing & rejected recovery', async () => {
  const env = makeTempEnv();
  resetCachedStateForTests(env.stateFilePath);
  resetCatalogRepairStateForTests(env.repairStatePath);

  const manualKey = 'BS72-099|manual-protected';
  registerManualWikiMapping({
    cardNumber: 'BS72-099',
    name: 'Manual Protected Card',
    wikiTitle: 'Manual Protected Card',
    artworkUrl: 'https://static.wikia.nocookie.net/battle-spirits/images/VerifiedManual.png',
    notes: 'Test manual override',
  });

  try {
    const cards: BattleSpiritsCard[] = [
      makeBaseCard({
        id: 'bs72-099',
        cardNumber: 'BS72-099',
        setCode: 'BS72',
        name: 'Manual Protected Card',
        wikiTitle: 'Manual Protected Card',
        artworkImage: 'https://static.wikia.nocookie.net/battle-spirits/images/VerifiedManual.png',
        effects: [],
        families: [],
        isWikiLoaded: false,
      }),
      makeBaseCard({
        id: 'bs01-009',
        cardNumber: 'BS01-009',
        name: 'Vanilla Dino',
        wikiTitle: 'Vanilla Dino',
        artworkImage: '',
        effects: [{ timing: 'Card Text', text: 'No English effect text listed on this card.' }],
        families: ['Terra Dragon'],
        isWikiLoaded: true,
      }),
    ];
    writeTestPublicCards(env.publicCardsJsonPath, cards);

    // Seed a recoverable rejected entry (unsafe ID) and a non-card page in discoveredCards
    const initialState: CatalogScanState = {
      jobStatus: 'idle',
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      totalSetsToScan: 0,
      scannedSetsCount: 0,
      currentSetCode: null,
      pendingSetCodes: [],
      failedSetCodes: [],
      errorLogs: [],
      sets: {},
      discoveredCards: {
        'BS72::BS72-100::orig::recovered': {
          discoveryKey: 'BS72::BS72-100::orig::recovered',
          card: makeBaseCard({
            id: 'bad id with spaces!',
            cardNumber: 'BS72-100',
            setCode: 'BS72',
            name: 'Recovered Promo',
            wikiTitle: 'Recovered Promo',
            artworkImage: '/api/wiki/image?file=BS72-100.png',
          }),
          sourceSetCode: 'BS72',
          sourceWikiTitle: 'Recovered Promo',
          alternateNames: [],
          rawArtworkFile: 'BS72-100.png',
          hasArtworkHint: true,
          incompleteFields: [],
          parseWarnings: [],
          classification: 'missing',
          matchSignals: [],
          matchConfidence: 0,
          metadataDeltas: [],
          approvedForImport: false,
          imported: false,
        },
        'BS72::BS72-CAT-01::orig::Introduction': {
          discoveryKey: 'BS72::BS72-CAT-01::orig::Introduction',
          card: makeBaseCard({
            id: 'bs72-intro-noncard',
            cardNumber: 'BS72-CAT-01',
            setCode: 'BS72',
            name: 'Introduction',
            wikiTitle: 'Introduction',
            artworkImage: '',
            effects: [],
          }),
          sourceSetCode: 'BS72',
          sourceWikiTitle: 'Introduction',
          alternateNames: [],
          rawArtworkFile: '',
          hasArtworkHint: false,
          incompleteFields: ['effects', 'artwork'],
          parseWarnings: [],
          classification: 'uncertain',
          matchSignals: [],
          matchConfidence: 0,
          metadataDeltas: [],
          approvedForImport: false,
          imported: false,
        },
      },
      importedCards: {},
    };
    saveCatalogScanState(initialState, env.stateFilePath);

    const deps: RepairDependencies = {
      publicCardsJsonPath: env.publicCardsJsonPath,
      stateFilePath: env.stateFilePath,
      repairStatePath: env.repairStatePath,
      batchFetchPagesFn: async (titles) => {
        const m = new Map();
        if (titles.includes('Manual Protected Card')) {
          m.set('Manual Protected Card', {
            wikitext: `{{CardTableV2
|name=Manual Protected Card
|kanji=手動保護
|cardnum=BS72-099
|set1=BS72
|color=Red
|family=Astral Dragon
|image=WrongWikiFile.png
|effect=[Lv1] Enriched effect while preserving manual art.
}}`,
            pageImages: ['File:WrongWikiFile.png'],
          });
        }
        if (titles.includes('Vanilla Dino')) {
          m.set('Vanilla Dino', {
            wikitext: `{{CardTableV2
|name=Vanilla Dino
|kanji=バニラ恐竜
|cardnum=BS01-009
|set1=BS01
|color=Red
|family=Terra Dragon
|image=BS01-009.png
}}
[[Category:No printed effect]]`,
            pageImages: ['File:BS01-009.png'],
          });
        }
        return m;
      },
      batchVerifyFilesFn: async (files) => {
        const m = new Map<string, string | null>();
        for (const f of files) {
          m.set(
            f.toLowerCase(),
            f.toLowerCase() === 'bs01-009.png'
              ? 'https://static.wikia.nocookie.net/battle-spirits/images/BS01-009.png'
              : null
          );
        }
        return m;
      },
      fetchWikiJsonFn: async () => ({ query: { search: [] } }),
    };

    // Resumable execution with batchSize=1
    const step1 = await runCatalogRepairBatch(
      { mode: 'all_incomplete', batchSize: 1 },
      deps
    );
    assert.equal(step1.batchProcessedCount, 1);
    assert.equal(step1.remainingCount, 1);
    assert.equal(step1.jobStatus, 'paused');

    const step2 = await runCatalogRepairBatch(
      { mode: 'resume', batchSize: 10, autoImportRecovered: true },
      deps
    );
    assert.equal(step2.batchProcessedCount, 1);
    assert.equal(step2.remainingCount, 0);
    assert.equal(step2.jobStatus, 'completed');
    assert.ok(step2.reprocessResult && step2.reprocessResult.addedCardsCount >= 1);

    const persisted = JSON.parse(fs.readFileSync(env.publicCardsJsonPath, 'utf8')) as {
      cards: BattleSpiritsCard[];
    };
    const manualCard = persisted.cards.find((c) => c.id === 'bs72-099')!;
    // Manual artwork URL strictly preserved, yet effects & families were enriched!
    assert.equal(
      manualCard.artworkImage,
      'https://static.wikia.nocookie.net/battle-spirits/images/VerifiedManual.png'
    );
    assert.equal(manualCard.effects[0].text, '[Lv1] Enriched effect while preserving manual art.');
    assert.deepEqual(manualCard.families, ['Astral Dragon']);
    assert.equal(manualCard.completionStatus, 'complete');

    const vanilla = persisted.cards.find((c) => c.id === 'bs01-009')!;
    assert.equal(vanilla.effects.length, 0);
    assert.equal(vanilla.effectStatus, 'no_printed_effect');
    assert.equal(vanilla.effectVerified, true);
    assert.equal(vanilla.artworkStatus, 'verified');
    assert.equal(vanilla.completionStatus, 'complete');

    // Non-card page in discoveredCards is marked needsManualReview and not imported
    const savedState = JSON.parse(fs.readFileSync(env.stateFilePath, 'utf8')) as CatalogScanState;
    const introEntry = Object.values(savedState.discoveredCards).find(
      (d) => d.sourceWikiTitle === 'Introduction'
    );
    assert.ok(introEntry);
    assert.equal(introEntry.imported, false);
    assert.equal(introEntry.card.needsManualReview, true);

    const recoveredImported = Object.values(savedState.importedCards).find(
      (c) => c.cardNumber === 'BS72-100'
    );
    assert.ok(recoveredImported);
  } finally {
    unregisterManualWikiMapping(manualKey);
  }
});

test('6. hydrateCardFromWikitext marks non-CardTable pages as isWikiLoaded: false and never injects optimistic image URLs', () => {
  const base = makeBaseCard({
    id: 'non-card',
    cardNumber: 'SD01-001',
    name: 'Contents',
    wikiTitle: 'Contents',
    artworkImage: '',
    effects: [],
  });
  const nonCardHydrated = hydrateCardFromWikitext(base, '== Contents ==\nSome article text', []);
  assert.equal(nonCardHydrated.isWikiLoaded, false);
  assert.equal(nonCardHydrated.needsManualReview, true);

  const missingImgCard = hydrateCardFromWikitext(
    makeBaseCard({ artworkImage: '', effects: [] }),
    `{{CardTableV2|name=No Img Card|cardnum=BS99-001|set1=BS99|color=Blue|family=Android|effect=[Lv1] Test.}}`,
    []
  );
  assert.equal(missingImgCard.artworkImage, '');
  assert.equal(missingImgCard.artworkVerified, false);
  assert.equal(missingImgCard.effectVerified, true);
});
