import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { BattleSpiritsCard } from '../src/types/card.ts';
import {
  getManualWikiMapping,
  listManualWikiMappings,
  MANUAL_WIKI_MAPPINGS,
  type ManualWikiMappingEntry,
} from '../src/utils/ManualWikiMapping.ts';
import {
  buildCardNumberCompareKeys,
  classifySetSourceCollection,
  compareCatalogWithWiki,
  discoverAllWikiSets,
  executeCatalogImport,
  extractCardNumberFromImageField,
  getCatalogDashboardSnapshot,
  getCatalogOverview,
  isSyntheticCardNumber,
  normalizeSetCode,
  reprocessAndRetryCatalogEntries,
  reprocessCachedCatalogEntries,
  runCatalogScanBatch,
  sanitizeCatalogDocumentId,
  sanitizeSetCode,
  scanWikiSetByCode,
  setDiscoveredCardApproval,
  validateCatalogImport,
  type CatalogDependencies,
} from '../server/catalogSyncService.ts';
import {
  buildDeterministicMappingKey,
  getValidationDashboardSnapshot,
  loadValidationState,
  mergeFirestoreValidationRecords,
  runManualValidationJob,
  saveValidationState,
  syncMappingsIntoValidationState,
  triggerScheduledValidation,
  validateSingleMappingByKey,
  verifyScheduledValidationAuth,
  type ManualValidationDependencies,
} from '../server/manualUrlValidator.ts';
import { createScheduledValidationHandler } from '../server/api/validation/scheduled.ts';
import { createArtworkValidationRouter } from '../server/controllers/artworkValidationController.ts';
import {
  enrichSetMetadata,
  extractPromoSectionsAndLinkedSets,
  normalizeRarity,
  parseSetTableRows,
  resolvePromoSubSeriesSetCode,
  type WikiPageBundle,
} from '../server/wikiService.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiritsdex-test-'));

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeBaselineCard(overrides: Partial<BattleSpiritsCard>): BattleSpiritsCard {
  return {
    id: 'bs01-bs01-001',
    cardNumber: 'BS01-001',
    name: 'Drake Knight',
    jpName: '龍騎士',
    color: 'Red',
    type: 'Spirit',
    rarity: 'C',
    setCode: 'BS01',
    setName: 'BS01',
    formats: ['Eternal'],
    blockIcon: 'BS',
    restriction: 'Unlimited',
    isRevival: false,
    cost: 3,
    reduction: { Red: 1 },
    symbols: { Red: 1 },
    families: ['Terra Dragon'],
    effects: [{ timing: 'Lv1', text: 'Gain +1000 BP.' }],
    keywords: [],
    flavorText: '',
    illustrator: '',
    artworkImage: '',
    artVariant: 'dragon',
    wikiTitle: 'Drake Knight',
    wikiUrl: 'https://battle-spirits.fandom.com/wiki/Drake_Knight',
    isWikiLoaded: true,
    rulings: [],
    ...overrides,
  };
}

describe('Wiki Catalog Discovery, Comparison, and Safe Import', () => {
  let stateFile = '';

  beforeEach(() => {
    stateFile = path.join(tmpDir, `catalog-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  function createMockCatalogDeps(options?: { failSetCode?: string }): CatalogDependencies {
    const baselineCards: BattleSpiritsCard[] = [
      makeBaselineCard({
        id: 'bs72-bs72-084',
        cardNumber: 'BS72-084',
        name: 'Kizuna Field',
        jpName: '',
        setCode: 'BS72',
        illustrator: '',
      }),
      makeBaselineCard({
        id: 'bs01-001',
        cardNumber: 'BS01-001',
        name: 'Drake Knight',
        jpName: '龍騎士',
        setCode: 'BS01',
        illustrator: 'Kenji',
      }),
      makeBaselineCard({
        id: 'bs01-002',
        cardNumber: 'BS01-002',
        name: 'Crimson Blade Dragon',
        setCode: 'BS01',
      }),
    ];

    const categoryPages: Record<string, Record<string, unknown>> = {
      'Category:Booster Sets|init': {
        continue: { cmcontinue: 'page2' },
        query: {
          categorymembers: [
            { title: 'BS01' },
            { title: 'BS72' },
          ],
        },
      },
      'Category:Booster Sets|page2': {
        query: {
          categorymembers: [
            { title: 'BS78' },
            { title: '09' },
          ],
        },
      },
      'Category:Starter Decks|init': {
        query: {
          categorymembers: [{ title: 'SD01' }],
        },
      },
    };

    const pageWikitext: Record<string, string> = {
      'Card Sets': `
== Main Series Booster Sets ==
* [[BS01]]
* [[BS78]] - Dragon Dawn
== Promotional Cards ==
* [[Promo Cards/P26]]
`,
      BS78: `
== Card List ==
* BS78-001 [[No Artwork Wing]] (Red / Spirit / R)
* BS78-002 [[Crimson Blade Dragon]] (Red / Spirit / X)
`,
      BS01: `
{{SetTable
|title=BS01
|release=2008-09-13
}}
{| class="wikitable"
! Card Number !! Card Name !! Card Type !! Color !! Rarity
|-
| BS01-001 || [[Drake Knight]] || Spirit || Red || C
|-
| BS01-099 || [[Missing Flame Tiger]] || Spirit || Red || R
|-
| BS01-100 || [[創界神ウル]] || Spirit || White || X
|-
| BS01-101 || [[Crimson Blade Dragon]] || Spirit || Red || X
|}
`,
      BS72: `
{| class="wikitable"
! Card Number !! Card Name !! Card Type !! Color !! Rarity
|-
| BS72-084 || [[Kizuna Field]] || Magic || White || C
|}
`,
      '09': `
{{SetRow|09-001|Nine Tail Fox|Spirit|Yellow|M}}
`,
      SD01: `
{{SetRow|SD01-001|Starter Wyrm|Spirit|Red|C}}
`,
      'Promo Cards/P26': `
{{SetRow|P26-01|Promo Phoenix|Spirit|Red|P}}
`,
    };

    const cardBundles: Record<string, WikiPageBundle> = {
      'Drake Knight': {
        wikitext: `{{CardTableV2|name=Drake Knight|jpname=龍騎士|color=Red|cost=3|image=BS01-001.png}}`,
        pageImages: ['BS01-001.png'],
      },
      'Missing Flame Tiger': {
        // Explicitly NO image -> tests independent discovery without artwork
        wikitext: `{{CardTableV2|name=Missing Flame Tiger|jpname=炎虎|color=Red|cost=4|families=Emperor Beast}}`,
        pageImages: [],
      },
      '創界神ウル': {
        // Japanese/Unicode card name & incomplete metadata (no cost, no image)
        wikitext: `{{CardTableV2|jpname=創界神ウル|color=White}}`,
        pageImages: [],
      },
      'Kizuna Field': {
        wikitext: `{{CardTableV2|name=Kizuna Field|jpname=キズナフィールド|illustrator=Takashi|image=BS72-084 (Toppa).png}}`,
        pageImages: ['BS72-084 (Toppa).png'],
      },
      'No Artwork Wing': {
        wikitext: `{{CardTableV2|name=No Artwork Wing|color=Red|cost=2}}`,
        pageImages: [],
      },
      'Crimson Blade Dragon': {
        wikitext: `{{CardTableV2|name=Crimson Blade Dragon|color=Red|cost=6}}`,
        pageImages: [],
      },
      'Same Set Ambiguous Guard': {
        wikitext: `{{CardTableV2|name=Same Edition Guard|color=Red|cost=4}}`,
        pageImages: [],
      },
    };

    return {
      stateFilePath: stateFile,
      existingCardsProvider: () => baselineCards,
      fetchWikiJsonFn: async (params) => {
        if (params.list === 'categorymembers') {
          const key = `${params.cmtitle}|${params.cmcontinue || 'init'}`;
          return categoryPages[key] || { query: { categorymembers: [] } };
        }
        if (params.list === 'allpages') {
          return { query: { allpages: [] } };
        }
        if (params.prop === 'revisions') {
          const title = params.titles;
          if (options?.failSetCode && title.toUpperCase() === options.failSetCode.toUpperCase()) {
            throw new Error(`Simulated network outage scanning ${title}`);
          }
          const wt = pageWikitext[title];
          if (!wt) {
            return { query: { pages: { '-1': { title, missing: '' } } } };
          }
          return {
            query: {
              pages: {
                '101': {
                  title,
                  revisions: [{ slots: { main: { '*': wt } } }],
                },
              },
            },
          };
        }
        return { query: {} };
      },
      batchFetchPagesFn: async (titles) => {
        const out = new Map<string, WikiPageBundle>();
        for (const t of titles) {
          if (cardBundles[t]) out.set(t, cardBundles[t]);
        }
        return out;
      },
    };
  }

  it('discovers paginated multi-source sets including number-only sets without truncation', async () => {
    const deps = createMockCatalogDeps();
    const res = await discoverAllWikiSets(deps);

    assert.ok(res.sets.some((s) => s.setCode === 'BS78'), 'Discovered BS78 from paginated Category:Booster Sets');
    assert.ok(res.sets.some((s) => s.setCode === '09'), 'Discovered number-only set 09 from page 2');
    assert.ok(res.sets.some((s) => s.setCode === 'SD01'), 'Discovered SD01 from Category:Starter Decks');
    assert.ok(res.sets.some((s) => s.setCode === 'PROMO-P26'), 'Discovered promo subpage PROMO-P26');

    const numOnly = res.sets.find((s) => s.setCode === '09');
    assert.equal(numOnly?.isNumberOnly, true);
    assert.equal(numOnly?.name, '09', 'Number-only set uses safe fallback without inventing a title');
  });

  it('scans unusual listings, cards without artwork, Unicode/JP cards, and classifies accurately', async () => {
    const deps = createMockCatalogDeps();
    await discoverAllWikiSets(deps);
    await scanWikiSetByCode('BS01', deps);
    await scanWikiSetByCode('BS78', deps);
    await scanWikiSetByCode('BS72', deps);

    const cmp = compareCatalogWithWiki(deps);
    const drake = cmp.entries.find((e) => e.card.cardNumber === 'BS01-001');
    const missingTiger = cmp.entries.find((e) => e.card.cardNumber === 'BS01-099');
    const unicodeCard = cmp.entries.find((e) => e.card.cardNumber === 'BS01-100');
    const sameSetAmbiguous = cmp.entries.find((e) => e.card.cardNumber === 'BS01-101');
    const unusualNoArt = cmp.entries.find((e) => e.card.cardNumber === 'BS78-001');
    const distinctSetReprint = cmp.entries.find((e) => e.card.cardNumber === 'BS78-002');
    const kizuna = cmp.entries.find((e) => e.card.cardNumber === 'BS72-084');

    assert.equal(drake?.classification, 'matched');
    assert.equal(missingTiger?.classification, 'missing');
    assert.equal(missingTiger?.hasArtworkHint, false, 'Card without artwork is still discovered');
    assert.equal(unicodeCard?.classification, 'missing');
    assert.equal(unicodeCard?.card.name, '創界神ウル', 'Japanese/Unicode name preserved safely');
    assert.ok(unicodeCard && unicodeCard.incompleteFields.length > 0, 'Incomplete fields flagged');
    assert.equal(unusualNoArt?.classification, 'missing', 'Unusual bullet listing fallback parsed');
    assert.equal(distinctSetReprint?.classification, 'missing', 'Distinct set card with its own canonical cardNumber imports cleanly');
    assert.equal(sameSetAmbiguous?.classification, 'uncertain', 'Same-set name collision flagged uncertain, not auto-merged');
    assert.equal(kizuna?.classification, 'updated_metadata', 'Safe enrichment detected for missing jpName/illustrator');
  });

  it('performs dry-run validation, idempotent non-destructive import, and protects ManualWikiMapping', async () => {
    const deps = createMockCatalogDeps();
    await discoverAllWikiSets(deps);
    await scanWikiSetByCode('BS01', deps);
    await scanWikiSetByCode('BS78', deps);
    await scanWikiSetByCode('BS72', deps);

    const validation = validateCatalogImport({}, deps);
    assert.ok(validation.willAddCards >= 4, 'Missing cards queued for safe add');
    assert.ok(validation.skippedUncertain >= 1, 'Uncertain match BS01-101 excluded unless manually approved');
    assert.ok(validation.manualMappingsProtected >= 1, 'BS72-084 manual mapping protected');

    const kizunaBefore = getManualWikiMapping({ id: 'bs72-bs72-084', cardNumber: 'BS72-084' });
    assert.equal(kizunaBefore?.fileName, 'BS72-084 (Toppa).png');

    // Approve Kizuna metadata update explicitly before executing import
    const cmp = compareCatalogWithWiki(deps);
    const kizunaEntry = cmp.entries.find((e) => e.card.cardNumber === 'BS72-084')!;
    setDiscoveredCardApproval(kizunaEntry.discoveryKey, true, deps);

    const firstImport = executeCatalogImport({}, deps);
    assert.ok(firstImport.addedCardsCount >= 3);
    assert.equal(firstImport.updatedMetadataCount, 1);

    // Repeat execution MUST be idempotent (0 duplicates added)
    const secondImport = executeCatalogImport({}, deps);
    assert.equal(secondImport.addedCardsCount, 0);
    assert.equal(secondImport.updatedMetadataCount, 0);
    assert.equal(secondImport.addedSetsCount, 0);

    // ManualWikiMapping must remain 100% intact
    const kizunaAfter = getManualWikiMapping({ id: 'bs72-bs72-084', cardNumber: 'BS72-084' });
    assert.equal(kizunaAfter?.fileName, 'BS72-084 (Toppa).png');
  });

  it('supports resumable interrupted scans and retrying failed sets', async () => {
    const failingDeps = createMockCatalogDeps({ failSetCode: 'BS78' });
    await discoverAllWikiSets(failingDeps);

    const firstRun = await runCatalogScanBatch(
      { mode: 'all', setCodes: ['BS01', 'BS78'], maxSetsPerRun: 1 },
      failingDeps
    );
    assert.deepEqual(firstRun.processedSets, ['BS01']);
    let overview = getCatalogOverview(failingDeps);
    assert.equal(overview.jobStatus, 'paused');
    assert.ok(overview.setsPending >= 1);

    // Resume hits simulated outage on BS78 and marks it failed
    const resumeRun = await runCatalogScanBatch({ mode: 'resume', maxSetsPerRun: 1 }, failingDeps);
    assert.deepEqual(resumeRun.failedSets, ['BS78']);
    overview = getCatalogOverview(failingDeps);
    assert.equal(overview.setsFailed, 1);

    // Retry failed once Wiki recovers
    const recoveredDeps = createMockCatalogDeps();
    const retryRun = await runCatalogScanBatch({ mode: 'retry_failed' }, recoveredDeps);
    assert.deepEqual(retryRun.processedSets, ['BS78']);
    assert.equal(retryRun.overview.setsFailed, 0);
  });

  it('normalizes set aliases (BS 23 -> BS23), parses 2-column & special card numbers, unblocks Revival vs Original comparisons, and outputs rejection diagnostics', async () => {
    assert.equal(normalizeSetCode('BS 23'), 'BS23');
    assert.equal(normalizeSetCode('bs-23'), 'BS23');
    assert.equal(sanitizeSetCode('BS 23'), 'BS23');
    assert.equal(sanitizeSetCode('26R SD 01'), '26RSD01');

    // Verify 2-column table parsing, (A)/(B) card numbers, and {{Nihongo|...}} set title extraction
    const twoColWikitext = `
{{SetTable
|title={{Nihongo|Starter Deck 2026|スタートデッキ}}
|release=2026-04-25
}}
{| class="wikitable"
! Card Number !! Card Name
|-
| 26RSD01-X01 || [[Solar Dragon]]
|-
| BS73-TCP01(A) || [[Tenkaku Dragon (Revival)]]
|}
`;
    const dummySet = {
      setCode: '26RSD01',
      wikiTitle: '26RSD01',
      category: 'Standard Starter' as const,
      name: '26RSD01',
      jpName: '',
      productType: 'Starter Deck' as const,
      releaseDate: '2026+',
      formats: ['Standard' as const, 'Eternal' as const],
      blockLabel: 'Standard',
      tagline: 'Test',
      featuredCardId: '26rsd01-001',
      colors: ['Red' as const],
      totalCardsInSet: 0,
      wikiUrl: 'https://battle-spirits.fandom.com/wiki/26RSD01',
    };
    const parsedTwoCol = parseSetTableRows(twoColWikitext, dummySet);
    assert.equal(parsedTwoCol.length, 2, 'Parses both 2-column table rows including (A) suffix');
    assert.equal(parsedTwoCol[0].cardNumber, '26RSD01-X01');
    assert.equal(parsedTwoCol[1].cardNumber, 'BS73-TCP01(A)');
    const enrichedMeta = enrichSetMetadata(dummySet, twoColWikitext, parsedTwoCol);
    assert.equal(enrichedMeta.name, 'Starter Deck 2026', 'Extracts English title cleanly from {{Nihongo|...}}');

    // Verify Revival vs Original distinct printing comparison + alias set scanning ('BS 23')
    const revivalDeps: CatalogDependencies = {
      stateFilePath: path.join(tmpDir, `catalog-rv-${Date.now()}.json`),
      existingCardsProvider: () => [
        makeBaselineCard({
          id: 'bs52-bs52-tx01',
          cardNumber: 'BS52-TX01',
          name: 'Tenkaku Dragon',
          setCode: 'BS52',
          isRevival: false,
        }),
        makeBaselineCard({
          id: 'bs43-rv025',
          cardNumber: 'BS43-RV025',
          name: 'Ushiwaka',
          setCode: 'BS43',
          isRevival: true,
        }),
        makeBaselineCard({
          id: 'bs73-002',
          cardNumber: 'BS73-002',
          name: 'Same Edition Guard',
          setCode: 'BS73',
          isRevival: false,
        }),
      ],
      fetchWikiJsonFn: async (params) => {
        if (params.list === 'categorymembers') {
          if (params.cmtitle === 'Category:Booster Sets' && !params.cmcontinue) {
            return {
              query: {
                categorymembers: [{ title: 'BS 23' }, { title: 'BS73' }],
              },
            };
          }
          return { query: { categorymembers: [] } };
        }
        if (params.list === 'allpages') return { query: { allpages: [] } };
        if (params.prop === 'revisions') {
          const t = String(params.titles || '');
          if (t === 'BS23') {
            return {
              query: {
                pages: {
                  '201': {
                    title: 'BS23',
                    revisions: [
                      {
                        slots: {
                          main: {
                            '*': `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| BS23-X05 || [[Ushiwaka]]\n|}`,
                          },
                        },
                      },
                    ],
                  },
                },
              },
            };
          }
          if (t === 'BS73') {
            return {
              query: {
                pages: {
                  '202': {
                    title: 'BS73',
                    revisions: [
                      {
                        slots: {
                          main: {
                            '*': `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| BS73-TCP01(A) || [[Tenkaku Dragon (Revival)]]\n|-\n| BS73-099 || [[Same Edition Guard]]\n|}`,
                          },
                        },
                      },
                    ],
                  },
                },
              },
            };
          }
          return { query: { pages: { '-1': { title: t, missing: '' } } } };
        }
        return { query: {} };
      },
      batchFetchPagesFn: async (titles) => {
        const out = new Map<string, WikiPageBundle>();
        for (const t of titles) {
          if (t.includes('Revival')) {
            out.set(t, { wikitext: '{{CardTableV2|name=Tenkaku Dragon (Revival)|color=Red|cost=5}}', pageImages: [] });
          } else {
            out.set(t, { wikitext: `{{CardTableV2|name=${t}|color=Red|cost=4}}`, pageImages: [] });
          }
        }
        return out;
      },
    };

    await discoverAllWikiSets(revivalDeps);
    const scan23 = await scanWikiSetByCode('BS 23', revivalDeps);
    assert.equal(scan23.set.setCode, 'BS23', 'Spaced BS 23 resolves to canonical BS23 cleanly');
    assert.equal(scan23.discoveredCount, 1);

    await scanWikiSetByCode('BS73', revivalDeps);
    const cmp = compareCatalogWithWiki(revivalDeps);
    const tcpRevival = cmp.entries.find((e) => e.card.cardNumber === 'BS73-TCP01(A)');
    const bs23Orig = cmp.entries.find((e) => e.card.cardNumber === 'BS23-X05');
    const sameVerUncertain = cmp.entries.find((e) => e.card.cardNumber === 'BS73-099');

    assert.equal(tcpRevival?.classification, 'missing', 'Revival TCP card compared against Original is missing (not uncertain)');
    assert.equal(bs23Orig?.classification, 'missing', 'Original BS23 card compared against Revival is missing');
    assert.equal(sameVerUncertain?.classification, 'uncertain', 'Same-version name collision in same set stays uncertain');

    const validation = validateCatalogImport({}, revivalDeps);
    assert.equal(validation.willAddCards, 2);
    assert.equal(validation.skippedUncertain, 1);
    assert.equal(validation.rejectedCards.length, 1, 'Rejection diagnostic emitted for skipped uncertain card');
    assert.equal(validation.rejectedCards[0].cardNumber, 'BS73-099');
  });

  it('normalizes PX/promo rarity and sub-series dynamically including future PX27+ and extracts promo hub sections', () => {
    assert.equal(normalizeRarity('PX'), 'P');
    assert.equal(normalizeRarity('SJ'), 'P');
    assert.equal(normalizeRarity('LM'), 'P');
    assert.equal(normalizeRarity('GX'), 'P');

    assert.equal(resolvePromoSubSeriesSetCode('PX25-01', '', 'PROMO-PX'), 'PX25');
    assert.equal(resolvePromoSubSeriesSetCode('PX26-01', '', 'PROMO-PX'), 'PX26');
    assert.equal(resolvePromoSubSeriesSetCode('PX27-01', '', 'PROMO-PX'), 'PX27');
    assert.equal(resolvePromoSubSeriesSetCode('RPX26-01', '', 'PROMO-REG'), 'PX26-STD');
    assert.equal(resolvePromoSubSeriesSetCode('RP26-01', '', 'PROMO-REG'), 'RP26-STD');
    assert.equal(resolvePromoSubSeriesSetCode('P25-03', '', 'PROMO-REG'), 'P25');
    assert.equal(resolvePromoSubSeriesSetCode('CP14-01', '', 'PROMO-REG'), 'CP14');
    assert.equal(resolvePromoSubSeriesSetCode('PX-01', '== PX19 ==', 'PROMO-PX'), 'PX19');
    assert.equal(resolvePromoSubSeriesSetCode('PX01', '== PX ==', 'PROMO-PX'), 'PX');

    assert.equal(
      classifySetSourceCollection({ setCode: 'PX26', name: 'PX26', wikiTitle: 'Promo Cards/Promo X-Rares' }),
      'px_series'
    );
    assert.equal(
      classifySetSourceCollection({ setCode: 'CP14', name: 'Campaign 2014' }),
      'campaign'
    );
    assert.equal(
      classifySetSourceCollection({ setCode: 'SJ15', name: 'Saikyou Jump 2015' }),
      'event_prize'
    );

    const promoHubText = `
== PX25 ==
{{SetRow|PX25-01|Apollo PX25|Spirit|Red|PX}}
== PX26 ==
{{SetRow|PX26-01|Solar PX26|Spirit|Red|PX}}
== PX27 ==
{{SetRow|PX27-01|Future PX27|Spirit|Blue|PX}}
* [[Promo Cards/P26]]
`;
    const extracted = extractPromoSectionsAndLinkedSets(promoHubText, 'Promo Cards/Promo X-Rares');
    assert.ok(extracted.some((s) => s.setCode === 'PX25'));
    assert.ok(extracted.some((s) => s.setCode === 'PX26'));
    assert.ok(extracted.some((s) => s.setCode === 'PX27'));
    assert.ok(extracted.some((s) => s.wikiTitle === 'Promo Cards/P26'));

    const inlineHubWikitext = `|}==Promo 25=={| align="center" border="1"| style="text-align: center;" |'''Number'''| style="text-align: center;" |'''Name'''| style="text-align: center;" |'''Color'''| style="text-align: center;" |'''Type'''|-|P25-01|[[The Dana Corporal]]|{{Blue}}|Spirit|-|}==Campaign Promos 14=={| align="center" border="1"| style="text-align: center;" |'''Number'''| style="text-align: center;" |'''Name'''| style="text-align: center;" |'''Color'''| style="text-align: center;" |'''Type'''|-|CP14-01|[[Ultimate-Siegfried-Baby]]|{{Red}}|Ultimate|-|}`;
    const inlineSections = extractPromoSectionsAndLinkedSets(inlineHubWikitext, 'Promo Cards/Regular Promos');
    assert.ok(inlineSections.some((s) => s.setCode === 'P25' && s.scanSection === 'Promo 25'));
    assert.ok(inlineSections.some((s) => s.setCode === 'CP14' && s.scanSection === 'Campaign Promos 14'));

    const p25Parsed = parseSetTableRows(
      inlineHubWikitext,
      {
        setCode: 'P25',
        name: 'Regular Promos P25',
        jpName: '',
        category: 'Promo',
        productType: 'Promo Set',
        releaseDate: '',
        blockLabel: 'Promo',
        formats: ['Eternal'],
        tagline: 'Promo cards',
        featuredCardId: '',
        colors: [],
        totalCardsInSet: 0,
        wikiUrl: '',
      },
      { sectionFilter: 'Promo 25', resolveSubSeriesSets: true }
    );
    assert.equal(p25Parsed.length, 1);
    assert.equal(p25Parsed[0].cardNumber, 'P25-01');
    assert.equal(p25Parsed[0].color, 'Blue');

    const cp14Parsed = parseSetTableRows(
      inlineHubWikitext,
      {
        setCode: 'CP14',
        name: 'Campaign Promos CP14',
        jpName: '',
        category: 'Promo',
        productType: 'Promo Set',
        releaseDate: '',
        blockLabel: 'Promo',
        formats: ['Eternal'],
        tagline: 'Campaign promo cards',
        featuredCardId: '',
        colors: [],
        totalCardsInSet: 0,
        wikiUrl: '',
      },
      { sectionFilter: 'Campaign Promos 14', resolveSubSeriesSets: true }
    );
    assert.equal(cp14Parsed.length, 1);
    assert.equal(cp14Parsed[0].cardNumber, 'CP14-01');
    assert.equal(cp14Parsed[0].type, 'Ultimate');
  });

  it('discovers PX/promo hubs & category sweeps, imports artwork-less promo cards idempotently, and enforces honest sourceCoverage warnings', async () => {
    const promoStateFile = path.join(tmpDir, `promo-coverage-${Date.now()}.json`);
    const promoDeps: CatalogDependencies = {
      stateFilePath: promoStateFile,
      existingCardsProvider: () => [
        makeBaselineCard({
          id: 'bs01-001',
          cardNumber: 'BS01-001',
          name: 'Drake Knight',
          setCode: 'BS01',
        }),
      ],
      fetchWikiJsonFn: async (params) => {
        if (params.list === 'categorymembers') {
          if (params.cmtitle === 'Category:Booster Sets' && !params.cmcontinue) {
            return { query: { categorymembers: [{ title: 'BS01' }] } };
          }
          if (params.cmtitle === 'Category:Promo X-Rare' && !params.cmcontinue) {
            return {
              query: {
                categorymembers: [{ title: 'Archive Cat PX28 Card' }],
              },
            };
          }
          return { query: { categorymembers: [] } };
        }
        if (params.list === 'allpages') {
          return { query: { allpages: [] } };
        }
        if (params.prop === 'revisions') {
          const t = String(params.titles || '');
          const pagesMap: Record<string, string> = {
            'Card Sets': `
== Booster Sets ==
* [[BS01]]
== Promotional Cards ==
* [[Promo Cards/Promo X-Rares]]
`,
            BS01: `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| BS01-001 || [[Drake Knight]]\n|}`,
            'Promo Cards/Promo X-Rares': `
== PX25 ==
{| class="wikitable"
! Card Number !! Card Name !! Card Type !! Color !! Rarity
|-
| PX25-01 || [[Flame Tiger PX25]] || Spirit || Red || PX
|}
== PX26 ==
{| class="wikitable"
! Card Number !! Card Name !! Card Type !! Color !! Rarity
|-
| PX26-01 || [[Artworkless Star PX26]] || Spirit || White || PX
|}
== PX27 ==
{| class="wikitable"
! Card Number !! Card Name !! Card Type !! Color !! Rarity
|-
| PX27-01 || [[Horizon Dragon PX27]] || Spirit || Blue || PX
|}
`,
          };
          const wt = pagesMap[t];
          if (!wt) return { query: { pages: { '-1': { title: t, missing: '' } } } };
          return {
            query: {
              pages: {
                '301': {
                  title: t,
                  revisions: [{ slots: { main: { '*': wt } } }],
                },
              },
            },
          };
        }
        return { query: {} };
      },
      batchFetchPagesFn: async (titles) => {
        const out = new Map<string, WikiPageBundle>();
        for (const t of titles) {
          if (t === 'Drake Knight') {
            out.set(t, { wikitext: '{{CardTableV2|name=Drake Knight|color=Red|cost=3}}', pageImages: ['BS01-001.png'] });
          } else if (t === 'Flame Tiger PX25') {
            out.set(t, { wikitext: '{{CardTableV2|name=Flame Tiger PX25|color=Red|cost=4|cardnum=PX25-01}}', pageImages: ['PX25-01.png'] });
          } else if (t === 'Artworkless Star PX26') {
            // Explicitly NO artwork
            out.set(t, { wikitext: '{{CardTableV2|name=Artworkless Star PX26|color=White|cost=5|cardnum=PX26-01}}', pageImages: [] });
          } else if (t === 'Horizon Dragon PX27') {
            out.set(t, { wikitext: '{{CardTableV2|name=Horizon Dragon PX27|color=Blue|cost=6|cardnum=PX27-01}}', pageImages: [] });
          } else if (t === 'Archive Cat PX28 Card') {
            out.set(t, { wikitext: '{{CardTableV2|name=Archive Cat PX28 Card|color=Yellow|cost=3|cardnum=PX28-01|rarity=PX}}', pageImages: [] });
          }
        }
        return out;
      },
    };

    const discovery = await discoverAllWikiSets(promoDeps);
    assert.ok(discovery.sets.some((s) => s.setCode === 'PX25'), 'PX25 sub-series discovered');
    assert.ok(discovery.sets.some((s) => s.setCode === 'PX26'), 'PX26 sub-series discovered');
    assert.ok(discovery.sets.some((s) => s.setCode === 'PX27'), 'Future PX27 sub-series discovered');
    assert.ok(
      discovery.sets.some((s) => s.setCode === 'PROMO-PX-ARCHIVE'),
      'Category-only PX archive sweep discovered'
    );

    // Before scanning anything, coverage must be marked incomplete with warning
    const initialOverview = getCatalogOverview(promoDeps);
    assert.equal(initialOverview.coverageComplete, false);
    assert.ok(initialOverview.coverageWarning, 'Emits honest incomplete coverage warning');

    // Run promo_special scoped batch: should scan promo/PX sources while leaving BS01 pending
    await runCatalogScanBatch({ mode: 'all', scope: 'promo_special', maxSetsPerRun: 50 }, promoDeps);
    const snapPromoOnly = getCatalogDashboardSnapshot({ setFilter: 'promo_special' }, promoDeps);
    assert.ok(snapPromoOnly.sets.every((s) => s.setCode !== 'BS01'));
    assert.ok(snapPromoOnly.sets.some((s) => s.setCode === 'PX26' && s.scanStatus === 'completed'));

    const postPromoOverview = getCatalogOverview(promoDeps);
    assert.equal(
      postPromoOverview.coverageComplete,
      false,
      'Must still report incomplete coverage because BS01 regular_booster remains pending'
    );
    assert.ok(postPromoOverview.promoCardsFound >= 4);
    assert.ok(postPromoOverview.promoCardsMissing >= 4);

    // Confirm artwork-less PX26-01 is flagged missing (not dropped) and imports cleanly
    const cmp = compareCatalogWithWiki(promoDeps);
    const px26Entry = cmp.entries.find((e) => e.card.cardNumber === 'PX26-01');
    const px28CatEntry = cmp.entries.find((e) => e.card.cardNumber === 'PX28-01');
    assert.equal(px26Entry?.classification, 'missing');
    assert.equal(px26Entry?.hasArtworkHint, false);
    assert.equal(px26Entry?.card.rarity, 'P');
    assert.equal(px28CatEntry?.classification, 'missing');

    const importRes1 = executeCatalogImport({}, promoDeps);
    assert.ok(importRes1.addedCardsCount >= 4, 'Imports PX25, artwork-less PX26, PX27, and category-sweep PX28 cards');
    assert.ok(
      importRes1.importedCards.some((c) => c.cardNumber === 'PX26-01' && c.setCode === 'PX26'),
      'Artwork-less PX26-01 imported cleanly with PX26 setCode'
    );

    // Repeat import is strictly idempotent
    const importRes2 = executeCatalogImport({}, promoDeps);
    assert.equal(importRes2.addedCardsCount, 0);

    // Scanning all remaining pending sets transitions coverageComplete to true when 0 pending/failed
    await runCatalogScanBatch({ mode: 'resume', maxSetsPerRun: 5000 }, promoDeps);
    const finalOverview = getCatalogOverview(promoDeps);
    assert.equal(finalOverview.setsPending, 0);
    assert.equal(finalOverview.setsFailed, 0);
    assert.equal(finalOverview.coverageComplete, true);
    assert.equal(finalOverview.coverageWarning, null);
  });

  it('extracts card numbers from Wiki image fields, sanitizes Unicode/long Firestore doc IDs, eliminates false Revival/cross-set/category rejections, and recovers stale cached rejections via reprocess', async () => {
    // 1. Card number extraction from {{CardTable3}} | image = filenames
    assert.equal(extractCardNumberFromImageField('P23-05.png'), 'P23-05');
    assert.equal(extractCardNumberFromImageField('File:PX26-06.png'), 'PX26-06');
    assert.equal(extractCardNumberFromImageField('SD37-012-OG.jpg'), 'SD37-012');
    assert.equal(extractCardNumberFromImageField('BS73-T001.png'), 'BS73-T001');
    assert.equal(extractCardNumberFromImageField('BS70-CP02.png'), 'BS70-CP02');
    assert.equal(extractCardNumberFromImageField('BSC22-132.jpg'), 'BSC22-132');
    assert.equal(isSyntheticCardNumber('BS01-CAT-1A2B3C4D'), true);
    assert.equal(isSyntheticCardNumber('PX26-06'), false);
    assert.ok(buildCardNumberCompareKeys('BS73-TCP01(A)').includes('BS73-TCP01'));
    assert.ok(buildCardNumberCompareKeys('BS73-TCP02B').includes('BS73-TCP02(B)'));
    assert.ok(buildCardNumberCompareKeys('CP02', 'BS45').includes('BS45-CP02'));

    // 2. Deterministic Firestore-safe document IDs (alphanumeric, _, -, <= 128 chars)
    const jpId = sanitizeCatalogDocumentId('26rbs01-創界神ウル-revival', 'fallback');
    assert.match(jpId, /^[a-zA-Z0-9_-]{1,128}$/);
    const longId = sanitizeCatalogDocumentId(`prefix-${'x'.repeat(200)}`, 'fallback');
    assert.ok(longId.length <= 128);
    assert.match(longId, /^[a-zA-Z0-9_-]{1,128}$/);
    // Distinct Unicode strings produce distinct hashed IDs rather than collapsing
    assert.notEqual(
      sanitizeCatalogDocumentId('聖龍皇'),
      sanitizeCatalogDocumentId('滅神星龍')
    );

    // 3. Cross-set reprints, same-number Original vs Revival, and category-sweep prefix sharing
    const statePath = path.join(tmpDir, `diagnostics-fix-${Date.now()}.json`);
    const baselineCards: BattleSpiritsCard[] = [
      makeBaselineCard({
        id: 'px01-px01',
        cardNumber: 'PX01',
        name: 'The KnightLord of Thunder',
        jpName: '雷皇騎',
        setCode: 'PX01',
        isRevival: false,
      }),
      makeBaselineCard({
        id: 'bs12-bs12-x01',
        cardNumber: 'BS12-X01',
        name: 'The BullDragonDeity Dragonic-Taurus',
        jpName: '龍星神',
        setCode: 'BS12',
        isRevival: false,
      }),
      makeBaselineCard({
        id: 'bs73-bs73-cp02-rv',
        cardNumber: 'BS73-CP02',
        name: 'Rekka Yukimura (Revival)',
        jpName: '烈火幸村',
        setCode: 'BS73',
        isRevival: true,
      }),
      makeBaselineCard({
        id: 'bs01-bs01-091',
        cardNumber: 'BS01-091',
        name: 'The Artifact Laguna',
        setCode: 'BS01',
        isRevival: false,
      }),
      makeBaselineCard({
        id: 'bs01-001',
        cardNumber: 'BS01-001',
        name: 'Drake Knight',
        setCode: 'BS01',
        isRevival: false,
      }),
    ];

    const deps: CatalogDependencies = {
      stateFilePath: statePath,
      existingCardsProvider: () => baselineCards,
      fetchWikiJsonFn: async (params) => {
        if (params.list === 'categorymembers') {
          if (params.cmtitle === 'Category:Booster Sets' && !params.cmcontinue) {
            return {
              query: {
                categorymembers: [{ title: '26RBS01' }, { title: 'BSC01' }, { title: 'BS01' }, { title: 'BS73' }],
              },
            };
          }
          if (params.cmtitle === 'Category:Promo X-Rare' && !params.cmcontinue) {
            return {
              query: {
                categorymembers: [
                  { title: 'HighEvo-Delphyne' },
                  { title: 'HighEvo-Harpuia' },
                  { title: 'HighEvo-Ophiotaurus' },
                ],
              },
            };
          }
          return { query: { categorymembers: [] } };
        }
        if (params.list === 'allpages') return { query: { allpages: [] } };
        if (params.prop === 'revisions') {
          const t = String(params.titles || '');
          const map: Record<string, string> = {
            'Card Sets': '* [[26RBS01]]\n* [[BSC01]]\n* [[BS01]]\n* [[BS73]]\n* [[RP26-STD]]',
            '26RBS01': `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| 26RBS01-001 || [[創界神ストライク]]\n|}`,
            BSC01: `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| BS01-001 || [[Drake Knight]]\n|}`,
            BS01: `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| BS01-091 || [[The ShieldSpirit Dis]]\n|}`,
            BS73: `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| BS73-CP02 || [[Rekka Yukimura]]\n|}`,
            'RP26-STD': `{| class="wikitable"\n! Card Number !! Card Name\n|-\n| RPX26-01 || [[The KnightLord of Thunder]]\n|}`,
            'Category:Revival': `{{SetRow|BS12-X01|The BullDragonDeity Dragonic-Taurus (Revival)|Spirit|Red|X}}`,
          };
          const wt = map[t];
          if (!wt) return { query: { pages: { '-1': { title: t, missing: '' } } } };
          return {
            query: {
              pages: { '401': { title: t, revisions: [{ slots: { main: { '*': wt } } }] } },
            },
          };
        }
        return { query: {} };
      },
      batchFetchPagesFn: async (titles) => {
        const out = new Map<string, WikiPageBundle>();
        for (const t of titles) {
          if (t === 'HighEvo-Delphyne') {
            out.set(t, { wikitext: '{{CardTable3|name=HighEvo-Delphyne|image=PX26-06.png|rarity1=PX}}', pageImages: ['PX26-06.png'] });
          } else if (t === 'HighEvo-Harpuia') {
            out.set(t, { wikitext: '{{CardTable3|name=HighEvo-Harpuia|image=PX26-07.png|rarity1=PX}}', pageImages: ['PX26-07.png'] });
          } else if (t === 'HighEvo-Ophiotaurus') {
            out.set(t, { wikitext: '{{CardTable3|name=HighEvo-Ophiotaurus|image=PX26-08.png|rarity1=PX}}', pageImages: ['PX26-08.png'] });
          } else if (t === '創界神ストライク') {
            out.set(t, { wikitext: '{{CardTable3|jpname=創界神ストライク|color=White}}', pageImages: [] });
          } else if (t === 'The KnightLord of Thunder') {
            out.set(t, { wikitext: '{{CardTable3|name=The KnightLord of Thunder|jpname=雷皇騎|color=White|image=RPX26-01.png}}', pageImages: ['RPX26-01.png'] });
          } else if (t === 'Rekka Yukimura') {
            out.set(t, {
              wikitext: '{{CardTable3|name=Rekka Yukimura|jpname=烈火幸村|cardnum=BS73-CP02}}\n==Revival==\n{{CardTable3|name=Rekka Yukimura (Revival)|jpname=烈火幸村|cardnum=BS73-CP02}}',
              pageImages: [],
            });
          } else if (t === 'The BullDragonDeity Dragonic-Taurus (Revival)') {
            out.set(t, { wikitext: '{{CardTable3|name=The BullDragonDeity Dragonic-Taurus (Revival)|jpname=龍星神|cardnum=BS12-X01}}', pageImages: [] });
          } else {
            out.set(t, { wikitext: `{{CardTable3|name=${t}|color=Red}}`, pageImages: [] });
          }
        }
        return out;
      },
    };

    await discoverAllWikiSets(deps);
    await scanWikiSetByCode('26RBS01', deps);
    await scanWikiSetByCode('BSC01', deps);
    await scanWikiSetByCode('BS01', deps);
    await scanWikiSetByCode('BS73', deps);
    await scanWikiSetByCode('RP26-STD', deps);
    await scanWikiSetByCode('PROMO-PX-ARCHIVE', deps);

    const cmp = compareCatalogWithWiki(deps);
    // Zero false rejections across HighEvo-* category sweep cards (card numbers extracted from image field & routed to PX26)
    const delphyne = cmp.entries.find((e) => e.card.cardNumber === 'PX26-06');
    const harpuia = cmp.entries.find((e) => e.card.cardNumber === 'PX26-07');
    const ophiotaurus = cmp.entries.find((e) => e.card.cardNumber === 'PX26-08');
    assert.equal(delphyne?.classification, 'missing');
    assert.equal(delphyne?.card.setCode, 'PX26');
    assert.equal(harpuia?.classification, 'missing');
    assert.equal(ophiotaurus?.classification, 'missing');

    // BSC01-scoped BS01-001 vs BS01-001 is distinct set reprint, NOT false duplicate
    const bscReprint = cmp.entries.find((e) => e.sourceSetCode === 'BSC01' && e.card.cardNumber === 'BS01-001');
    assert.equal(bscReprint?.classification, 'missing');

    // RPX26-01 vs PX01 (distinct set & distinct number) AND BS73-CP02 Original vs BS73-CP02 Revival (same number, opposite version) both import cleanly
    const rpx26Card = cmp.entries.find((e) => e.card.cardNumber === 'RPX26-01');
    const bs73Cp02Orig = cmp.entries.find((e) => e.card.cardNumber === 'BS73-CP02' && !e.card.isRevival);
    assert.equal(rpx26Card?.classification, 'missing');
    assert.equal(bs73Cp02Orig?.classification, 'missing');

    // Genuine BS01-091 conflict IS still flagged cleanly rather than overwritten
    const bs01Conflict = cmp.entries.find((e) => e.card.cardNumber === 'BS01-091');
    assert.notEqual(bs01Conflict?.classification, 'missing');

    const validation = validateCatalogImport({}, deps);
    assert.ok(validation.rejectedCards.every((r) => r.diagnosticCategory && typeof r.recoverable === 'boolean' && r.recommendedAction));
    assert.ok(!validation.rejectedCards.some((r) => r.cardNumber.startsWith('PX26-')), 'All PX26 category sweep cards pass validation');
    assert.ok(!validation.rejectedCards.some((r) => r.cardNumber === '26RBS01-001'), 'Japanese-name card in 26RBS01 passes validation');
    assert.ok(!validation.rejectedCards.some((r) => r.cardNumber === 'BS73-CP02'), 'Original vs Revival sharing BS73-CP02 passes validation');

    const execRes = executeCatalogImport({}, deps);
    assert.ok(execRes.importedCards.some((c) => c.cardNumber === 'PX26-06' && c.setCode === 'PX26'));
    assert.ok(execRes.importedCards.some((c) => c.cardNumber === 'BS73-CP02' && c.isRevival === false));
    assert.ok(execRes.importedCards.some((c) => c.cardNumber === '26RBS01-001' && /^[a-zA-Z0-9_-]{1,128}$/.test(c.id)));
    assert.equal(execRes.failedImports.length, 0);

    // 4. Reprocess & Retry recovery of stale synthetic cached entries without re-scanning Wiki sets
    const seedPath = path.join(tmpDir, `stale-seed-${Date.now()}.json`);
    await discoverAllWikiSets({ ...deps, stateFilePath: seedPath });
    const staleState = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    // Inject a stale synthetic pre-fix rejected entry + an entry missing required cardNumber
    staleState.discoveredCards['PROMO-PX-ARCHIVE::PROMO-PX-ARCHIVE-HIGHEVO-::orig::highevo-delphyne'] = {
      discoveryKey: 'PROMO-PX-ARCHIVE::PROMO-PX-ARCHIVE-HIGHEVO-::orig::highevo-delphyne',
      card: makeBaselineCard({
        id: 'promo-px-archive-HIGHEVO-bad$id',
        cardNumber: 'PROMO-PX-ARCHIVE-HIGHEVO-',
        name: 'HighEvo-Delphyne',
        setCode: 'PROMO-PX-ARCHIVE',
        wikiTitle: 'HighEvo-Delphyne',
      }),
      sourceSetCode: 'PROMO-PX-ARCHIVE',
      originalSetCode: 'PROMO-PX-ARCHIVE',
      sourceWikiTitle: 'HighEvo-Delphyne',
      rawArtworkFile: 'PX26-06.png',
      hasArtworkHint: true,
      incompleteFields: [],
      parseWarnings: [],
      classification: 'potential_duplicate',
      matchSignals: ['duplicate_card_number_in_scan'],
      matchConfidence: 50,
      metadataDeltas: [],
      approvedForImport: false,
      imported: false,
      importedAt: null,
    };
    staleState.discoveredCards['BS01::BROKEN::orig::empty'] = {
      discoveryKey: 'BS01::BROKEN::orig::empty',
      card: makeBaselineCard({ id: 'bs01-empty', cardNumber: '', name: '', jpName: '', setCode: 'BS01' }),
      sourceSetCode: 'BS01',
      originalSetCode: 'BS01',
      sourceWikiTitle: '',
      rawArtworkFile: '',
      hasArtworkHint: false,
      incompleteFields: ['artwork'],
      parseWarnings: [],
      classification: 'missing',
      matchSignals: [],
      matchConfidence: 0,
      metadataDeltas: [],
      approvedForImport: false,
      imported: false,
      importedAt: null,
    };
    // Write to a fresh uncached stateFilePath so getActiveCatalogState loads the pre-fix stale disk state cleanly
    const stalePath = path.join(tmpDir, `stale-reprocess-${Date.now()}.json`);
    fs.writeFileSync(stalePath, JSON.stringify(staleState));
    const staleDeps: CatalogDependencies = {
      ...deps,
      stateFilePath: stalePath,
    };

    const preCheck = validateCatalogImport({}, staleDeps);
    assert.ok(preCheck.rejectedCards.length >= 2, 'Pre-reprocess sees both stale duplicate and missing-identifier rejection');
    const missingIdDiag = preCheck.rejectedCards.find((r) => r.discoveryKey === 'BS01::BROKEN::orig::empty');
    assert.equal(missingIdDiag?.diagnosticCategory, 'insufficient_identifying_info');
    assert.equal(missingIdDiag?.recoverable, false);

    const reprocessed = await reprocessAndRetryCatalogEntries(
      { autoImport: true, rehydrateSynthetic: true },
      staleDeps
    );
    assert.ok(reprocessed.recoveredToReadyCount >= 1);
    assert.ok(
      reprocessed.importResult?.importedCards.some((c) => c.cardNumber === 'PX26-06' && c.setCode === 'PX26'),
      'Reprocess & retry recovers stale PROMO-PX-ARCHIVE-HIGHEVO- into PX26-06 and imports it cleanly'
    );
    // Sync call still works idempotently
    const syncOnly = reprocessCachedCatalogEntries({ autoImport: false }, staleDeps);
    assert.ok(syncOnly.reprocessedCount >= 1);
  });
});

describe('Manual Artwork URL Background & Manual Validation (All 13 Required Cases)', () => {
  let stateFile = '';

  beforeEach(() => {
    stateFile = path.join(tmpDir, `val-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  function makeDirectMapping(url: string, idx = 1): ManualWikiMappingEntry {
    return {
      cardId: `test-card-${idx}`,
      cardNumber: `TEST-00${idx}`,
      name: `Test Card ${idx}`,
      artworkUrl: url,
      verified: true,
    };
  }

  it('covers Cases 1-8 & 10: HTTP 200, 404, 410, Redirect, 500, Timeout, Network Error, 429 & Recovery without wiping lastSuccessAt', async () => {
    let dynamicStatus = 404;
    const mapping1 = makeDirectMapping('https://cdn.example.com/ok.png', 1);
    const mapping2 = makeDirectMapping('https://cdn.example.com/dynamic.png', 2);
    const mapping3 = makeDirectMapping('https://cdn.example.com/gone.png', 3);
    const mapping4 = makeDirectMapping('https://cdn.example.com/old.png', 4);
    const mapping5 = makeDirectMapping('https://cdn.example.com/err500.png', 5);
    const mapping6 = makeDirectMapping('https://cdn.example.com/slow.png', 6);
    const mapping7 = makeDirectMapping('https://cdn.example.com/netfail.png', 7);
    const mapping8 = makeDirectMapping('https://cdn.example.com/ratelimit.png', 8);

    const mappings = [mapping1, mapping2, mapping3, mapping4, mapping5, mapping6, mapping7, mapping8];
    const key2 = buildDeterministicMappingKey(mapping2, 1);

    let rateLimitCalls = 0;

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/ok.png')) {
        return new Response(null, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (url.endsWith('/dynamic.png')) {
        return new Response(null, { status: dynamicStatus, headers: { 'content-type': 'image/png' } });
      }
      if (url.endsWith('/gone.png')) {
        return new Response(null, { status: 410 });
      }
      if (url.endsWith('/old.png')) {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://cdn.example.com/final-art.webp' },
        });
      }
      if (url.endsWith('/final-art.webp')) {
        return new Response(null, { status: 200, headers: { 'content-type': 'image/webp' } });
      }
      if (url.endsWith('/err500.png')) {
        return new Response(null, { status: 500 });
      }
      if (url.endsWith('/slow.png')) {
        throw new Error('Request timeout after 15ms');
      }
      if (url.endsWith('/netfail.png')) {
        throw new Error('ECONNRESET');
      }
      if (url.endsWith('/ratelimit.png')) {
        rateLimitCalls++;
        return new Response(null, { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response(null, { status: 404 });
    };

    const deps: ManualValidationDependencies = {
      stateFilePath: stateFile,
      mappingsProvider: () => mappings,
      fetchFn: mockFetch,
      sleepFn: async () => {},
      maxRetries: 1,
      timeoutMs: 15,
    };

    // Seed prior healthy timestamp on mapping5 to verify transient 500 does NOT erase lastSuccessAt
    const seeded = syncMappingsIntoValidationState(deps);
    const key5 = buildDeterministicMappingKey(mapping5, 4);
    seeded.state.records[key5].status = 'healthy';
    seeded.state.records[key5].lastSuccessAt = '2026-01-01T00:00:00.000Z';
    saveValidationState(seeded.state, stateFile);

    const run1 = await runManualValidationJob({}, deps);
    const byNum = new Map(run1.records.map((r) => [r.cardNumber, r]));

    assert.equal(byNum.get('TEST-001')?.status, 'healthy');
    assert.equal(byNum.get('TEST-002')?.status, 'broken');
    assert.equal(byNum.get('TEST-002')?.httpStatus, 404);
    assert.equal(byNum.get('TEST-002')?.consecutiveFailures, 1);

    assert.equal(byNum.get('TEST-003')?.status, 'broken');
    assert.equal(byNum.get('TEST-003')?.httpStatus, 410);

    assert.equal(byNum.get('TEST-004')?.status, 'redirected');
    assert.equal(byNum.get('TEST-004')?.finalUrl, 'https://cdn.example.com/final-art.webp');

    assert.equal(byNum.get('TEST-005')?.status, 'temporarily_unavailable');
    assert.equal(
      byNum.get('TEST-005')?.lastSuccessAt,
      '2026-01-01T00:00:00.000Z',
      'Transient 500 preserves prior lastSuccessAt'
    );

    assert.equal(byNum.get('TEST-006')?.status, 'temporarily_unavailable');
    assert.equal(byNum.get('TEST-007')?.status, 'temporarily_unavailable');
    assert.equal(byNum.get('TEST-008')?.status, 'temporarily_unavailable');
    assert.equal(rateLimitCalls, 2, 'Respects bounded retries on 429');

    // Case 10: Fixed URL recovers broken -> healthy & resets consecutiveFailures
    dynamicStatus = 200;
    const recovered = await validateSingleMappingByKey(key2, deps);
    assert.equal(recovered?.status, 'healthy');
    assert.equal(recovered?.consecutiveFailures, 0);
    assert.ok(recovered?.lastSuccessAt);
  });

  it('covers Case 9, 11, 12, 13: Wiki file/title verification, scheduled run, interrupted batch resume, and ManualWikiMapping immutability', async () => {
    const initialCount = MANUAL_WIKI_MAPPINGS.length;
    const subset = listManualWikiMappings().slice(0, 4);

    let checkedCount = 0;
    const deps: ManualValidationDependencies = {
      stateFilePath: stateFile,
      mappingsProvider: () => subset,
      sleepFn: async () => {},
      concurrency: 1,
      batchSize: 2,
      fetchWikiJsonFn: async (params) => {
        checkedCount++;
        if (params.titles?.startsWith('File:')) {
          return {
            query: {
              pages: {
                '1': {
                  title: params.titles,
                  imageinfo: [{ url: `https://static.wikia.nocookie.net/battlespirits/${encodeURIComponent(params.titles)}.png`, mime: 'image/png' }],
                },
              },
            },
          };
        }
        return {
          query: {
            pages: {
              '2': {
                title: params.titles,
                revisions: [{ slots: { main: { '*': '{{CardTable|image=Sample_Art.png}}' } } }],
              },
            },
          },
        };
      },
      fetchFn: async () =>
        new Response(null, { status: 200, headers: { 'content-type': 'image/png' } }),
    };

    // Case 12: Scheduled run updates scheduler metadata & marks all healthy
    const schedRes = await triggerScheduledValidation(deps);
    assert.equal(schedRes.summary.healthy, 4);
    const snap = getValidationDashboardSnapshot({}, deps);
    assert.ok(snap.scheduler.lastScheduledRunAt);
    assert.ok(snap.scheduler.nextScheduledRunAt);

    // Case 13: Simulate interrupted run with 1 pending key remaining -> resume only checks remaining key
    const state = loadValidationState(stateFile);
    const allKeys = Object.keys(state.records);
    state.cycle.status = 'running';
    state.cycle.pendingKeys = [allKeys[3]];
    saveValidationState(state, stateFile);

    checkedCount = 0;
    await runManualValidationJob({ resumeInterrupted: true, triggerSource: 'resume' }, deps);
    assert.equal(checkedCount, 1, 'Resumed job checks only the single pending mapping');
    assert.equal(loadValidationState(stateFile).cycle.pendingKeys.length, 0);

    // Original ManualWikiMapping array NEVER mutated or deleted!
    assert.equal(MANUAL_WIKI_MAPPINGS.length, initialCount);
  });

  it('verifies X-Validation-Cron-Secret, preserves Bearer auth, and prevents overlapping runs', async () => {
    // 1. Custom header verification (constant-time)
    const customOk = verifyScheduledValidationAuth(
      { 'x-validation-cron-secret': '  my-super-secret-value  ' },
      'my-super-secret-value'
    );
    assert.equal(customOk.authorized, true);
    assert.equal(customOk.method, 'x-validation-cron-secret');

    // 2. String-array header normalization
    const arrayHeaderOk = verifyScheduledValidationAuth(
      { 'x-validation-cron-secret': ['my-super-secret-value'] },
      'my-super-secret-value'
    );
    assert.equal(arrayHeaderOk.authorized, true);
    assert.equal(arrayHeaderOk.method, 'x-validation-cron-secret');

    // 3. Existing Bearer token authentication preserved
    const bearerOk = verifyScheduledValidationAuth(
      { authorization: 'Bearer my-super-secret-value' },
      'my-super-secret-value'
    );
    assert.equal(bearerOk.authorized, true);
    assert.equal(bearerOk.method, 'bearer');

    // 4. Rejects missing or wrong secret when secret is configured
    const missingRejected = verifyScheduledValidationAuth({}, 'my-super-secret-value');
    assert.equal(missingRejected.authorized, false);
    assert.equal(missingRejected.method, 'rejected');

    const wrongRejected = verifyScheduledValidationAuth(
      { 'x-validation-cron-secret': 'wrong-secret', authorization: 'Bearer wrong-secret' },
      'my-super-secret-value'
    );
    assert.equal(wrongRejected.authorized, false);
    assert.equal(wrongRejected.method, 'rejected');

    // 5. Fallback behavior when VALIDATION_CRON_SECRET is unset
    const unsetFallback = verifyScheduledValidationAuth({}, '');
    assert.equal(unsetFallback.authorized, true);
    assert.equal(unsetFallback.method, 'none');

    // 6. Concurrent run overlap prevention via state-file lock
    const overlapStateFile = path.join(tmpDir, 'overlap-validation-state.json');
    let resolveProbeEntered!: () => void;
    const probeEntered = new Promise<void>((resolve) => {
      resolveProbeEntered = resolve;
    });
    let releaseFirstProbe!: () => void;
    const gateRelease = new Promise<void>((resolve) => {
      releaseFirstProbe = resolve;
    });
    let probeCount = 0;

    const slowDeps: ManualValidationDependencies = {
      stateFilePath: overlapStateFile,
      mappingsProvider: () => [
        {
          cardId: 'ov-001',
          cardNumber: 'OV-001',
          name: 'Overlap Dragon',
          artworkUrl: 'https://img.example.com/ov-001.jpg',
        },
      ],
      sleepFn: async () => {},
      fetchFn: async () => {
        probeCount++;
        resolveProbeEntered();
        await gateRelease;
        return new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      },
    };

    const firstRun = runManualValidationJob({ triggerSource: 'scheduled' }, slowDeps);
    await probeEntered;

    const secondRun = await runManualValidationJob({ triggerSource: 'scheduled' }, slowDeps);
    assert.equal(secondRun.skippedOverlap, true);
    assert.equal(probeCount, 1);

    releaseFirstProbe();
    const firstResult = await firstRun;
    assert.equal(Boolean(firstResult.skippedOverlap), false);
    assert.equal(firstResult.summary.healthy, 1);
    assert.equal(probeCount, 1);
  });

  it('scheduled endpoint handler enforces VALIDATION_CRON_SECRET, returns structured 200 JSON, and rehydrates Firestore validation state', async () => {
    const endpointStateFile = path.join(tmpDir, `endpoint-${Date.now()}.json`);
    const deps: ManualValidationDependencies = {
      stateFilePath: endpointStateFile,
      mappingsProvider: () => [
        {
          cardId: 'ep-001',
          cardNumber: 'EP-001',
          name: 'Endpoint Wyvern',
          artworkUrl: 'https://cdn.example.com/ep-001.png',
        },
      ],
      sleepFn: async () => {},
      fetchFn: async () => new Response(null, { status: 200, headers: { 'content-type': 'image/png' } }),
    };

    const callHandler = async (
      handler: ReturnType<typeof createScheduledValidationHandler>,
      headers: Record<string, string | string[] | undefined>
    ) => {
      let statusCode = 0;
      let jsonBody: unknown = null;
      const req = {
        headers,
        setTimeout: () => {},
      } as unknown as Parameters<typeof handler>[0];
      const res = {
        setTimeout: () => {},
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          jsonBody = payload;
          return this;
        },
      } as unknown as Parameters<typeof handler>[1];
      await handler(req, res);
      return { statusCode, jsonBody: jsonBody as Record<string, unknown> };
    };

    // 1. Fails with 401 when server secret is unconfigured
    const unconfiguredHandler = createScheduledValidationHandler({ expectedSecret: '', deps });
    const unconfiguredRes = await callHandler(unconfiguredHandler, {});
    assert.equal(unconfiguredRes.statusCode, 401);
    assert.equal(unconfiguredRes.jsonBody.ok, false);

    // 2. Fails with 401 when header missing or mismatched
    const securedHandler = createScheduledValidationHandler({
      expectedSecret: 'prod-cron-secret-123',
      deps,
    });
    const missingHdrRes = await callHandler(securedHandler, {});
    assert.equal(missingHdrRes.statusCode, 401);
    const wrongHdrRes = await callHandler(securedHandler, {
      'x-validation-cron-secret': 'wrong-secret',
    });
    assert.equal(wrongHdrRes.statusCode, 401);

    // 3. Succeeds with 200 + structured summary when X-Validation-Cron-Secret matches
    const validRes = await callHandler(securedHandler, {
      'x-validation-cron-secret': 'prod-cron-secret-123',
    });
    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.jsonBody.ok, true);
    assert.equal(
      (validRes.jsonBody.summary as { healthy?: number })?.healthy,
      1
    );

    // 4. Rehydrates Firestore records onto fresh server state without overwriting newer timestamps
    const freshRecord = loadValidationState(endpointStateFile).records[
      Object.keys(loadValidationState(endpointStateFile).records)[0]
    ];
    const freshKey = freshRecord.mappingKey;
    const rehydrateResult = mergeFirestoreValidationRecords(
      [
        {
          ...freshRecord,
          mappingKey: freshKey,
          status: 'broken',
          httpStatus: 404,
          lastCheckedAt: '2099-01-01T00:00:00.000Z',
          lastSuccessAt: '',
          consecutiveFailures: 2,
          failureReason: 'HTTP 404 from previous Cloud Run cycle',
          lastCycleId: 'val-cloud',
        },
      ],
      deps
    );
    assert.equal(rehydrateResult.mergedCount, 1);
    const restoredState = loadValidationState(endpointStateFile);
    assert.equal(restoredState.records[freshKey]?.status, 'broken');
    assert.equal(restoredState.records[freshKey]?.httpStatus, 404);
  });

  it('mounts createArtworkValidationRouter before catch-all 404 middleware and handles HTTP POST requests', async () => {
    const routerStateFile = path.join(tmpDir, `router-${Date.now()}.json`);
    const deps: ManualValidationDependencies = {
      stateFilePath: routerStateFile,
      mappingsProvider: () => [
        {
          cardId: 'rt-001',
          cardNumber: 'RT-001',
          name: 'Router Phoenix',
          artworkUrl: 'https://cdn.example.com/rt-001.png',
        },
      ],
      sleepFn: async () => {},
      fetchFn: async () => new Response(null, { status: 200, headers: { 'content-type': 'image/png' } }),
    };

    const app = express();
    app.use(express.json());
    app.use(
      createArtworkValidationRouter({
        expectedSecret: 'router-cron-secret-999',
        deps,
      })
    );
    app.use('/api', (_req, res) => {
      res.status(404).json({ ok: false, error: 'API route not found' });
    });

    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const unauthRes = await fetch(`${baseUrl}/api/admin/validation/scheduled`, {
        method: 'POST',
      });
      assert.equal(unauthRes.status, 401);

      const wrongRes = await fetch(`${baseUrl}/api/admin/validation/scheduled`, {
        method: 'POST',
        headers: { 'X-Validation-Cron-Secret': 'bad-secret' },
      });
      assert.equal(wrongRes.status, 401);

      const okRes = await fetch(`${baseUrl}/api/admin/validation/scheduled`, {
        method: 'POST',
        headers: { 'X-Validation-Cron-Secret': 'router-cron-secret-999' },
      });
      assert.equal(okRes.status, 200);
      const okJson = (await okRes.json()) as {
        ok: boolean;
        summary?: { total?: number; healthy?: number };
      };
      assert.equal(okJson.ok, true);
      assert.equal(okJson.summary?.healthy, 1);

      const notFoundRes = await fetch(`${baseUrl}/api/nonexistent-endpoint`, {
        method: 'POST',
      });
      assert.equal(notFoundRes.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});


