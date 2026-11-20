import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BattleSpiritsCard } from '../src/types/card.ts';
import {
  getManualWikiMapping,
  listManualWikiMappings,
  MANUAL_WIKI_MAPPINGS,
  type ManualWikiMappingEntry,
} from '../src/utils/ManualWikiMapping.ts';
import {
  compareCatalogWithWiki,
  discoverAllWikiSets,
  executeCatalogImport,
  getCatalogOverview,
  runCatalogScanBatch,
  scanWikiSetByCode,
  setDiscoveredCardApproval,
  validateCatalogImport,
  type CatalogDependencies,
} from '../server/catalogSyncService.ts';
import {
  buildDeterministicMappingKey,
  getValidationDashboardSnapshot,
  loadValidationState,
  runManualValidationJob,
  saveValidationState,
  syncMappingsIntoValidationState,
  triggerScheduledValidation,
  validateSingleMappingByKey,
  verifyScheduledValidationAuth,
  type ManualValidationDependencies,
} from '../server/manualUrlValidator.ts';
import type { WikiPageBundle } from '../server/wikiService.ts';

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
|}
`,
      BS72: `
{| class="wikitable"
! Card Number !! Card Name !! Card Type !! Color !! Rarity
|-
| BS72-084 || [[Kizuna Field]] || Magic || White || C
|}
`,
      BS78: `
== Card List ==
* BS78-001 [[No Artwork Wing]] (Red / Spirit / R)
* BS78-002 [[Crimson Blade Dragon]] (Red / Spirit / X)
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
    const unusualNoArt = cmp.entries.find((e) => e.card.cardNumber === 'BS78-001');
    const ambiguousReprint = cmp.entries.find((e) => e.card.cardNumber === 'BS78-002');
    const kizuna = cmp.entries.find((e) => e.card.cardNumber === 'BS72-084');

    assert.equal(drake?.classification, 'matched');
    assert.equal(missingTiger?.classification, 'missing');
    assert.equal(missingTiger?.hasArtworkHint, false, 'Card without artwork is still discovered');
    assert.equal(unicodeCard?.classification, 'missing');
    assert.equal(unicodeCard?.card.name, '創界神ウル', 'Japanese/Unicode name preserved safely');
    assert.ok(unicodeCard && unicodeCard.incompleteFields.length > 0, 'Incomplete fields flagged');
    assert.equal(unusualNoArt?.classification, 'missing', 'Unusual bullet listing fallback parsed');
    assert.equal(ambiguousReprint?.classification, 'uncertain', 'Same name on different set number flagged uncertain, not auto-merged');
    assert.equal(kizuna?.classification, 'updated_metadata', 'Safe enrichment detected for missing jpName/illustrator');
  });

  it('performs dry-run validation, idempotent non-destructive import, and protects ManualWikiMapping', async () => {
    const deps = createMockCatalogDeps();
    await discoverAllWikiSets(deps);
    await scanWikiSetByCode('BS01', deps);
    await scanWikiSetByCode('BS78', deps);
    await scanWikiSetByCode('BS72', deps);

    const validation = validateCatalogImport({}, deps);
    assert.ok(validation.willAddCards >= 3, 'Missing cards queued for safe add');
    assert.ok(validation.skippedUncertain >= 1, 'Uncertain match BS78-002 excluded unless manually approved');
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
});

