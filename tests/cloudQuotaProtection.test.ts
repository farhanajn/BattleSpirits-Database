import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, beforeEach, describe } from 'node:test';
import { terminate } from 'firebase/firestore';
import { db } from '../src/firebase.ts';
import {
  clearCloudQuotaCooldown,
  isCloudQuotaCooldownActive,
  isCloudWriteCooldownActive,
  isFirestoreQuotaError,
  markCloudQuotaExhausted,
} from '../src/utils/firestoreQuota.ts';
import { fetchUserCloudLibrary } from '../src/utils/cloudSync.ts';
import {
  fetchPublishedCatalogAdditions,
  fetchValidationRecordsFromFirestore,
} from '../src/utils/catalogCloudSync.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('Firestore Read/Write Quota Protection & Cooldown', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).localStorage = createMemoryStorage();
    (globalThis as Record<string, unknown>).sessionStorage = createMemoryStorage();
    clearCloudQuotaCooldown();
  });

  after(async () => {
    clearCloudQuotaCooldown();
    await terminate(db).catch(() => {});
  });

  test('isFirestoreQuotaError detects both daily read-unit and write-unit quota errors', () => {
    const readQuotaErr = new Error(
      "Quota limit exceeded. Cause - Quota exceeded for quota metric 'Free daily read units per project (free tier database)'"
    );
    const writeQuotaErr = Object.assign(
      new Error("Quota exceeded for quota metric 'Free daily write units per project'"),
      { code: 'resource-exhausted' }
    );
    const permErr = new Error('Missing or insufficient permissions.');

    assert.equal(isFirestoreQuotaError(readQuotaErr), true);
    assert.equal(isFirestoreQuotaError(writeQuotaErr), true);
    assert.equal(isFirestoreQuotaError(permErr), false);
    assert.equal(isFirestoreQuotaError(null), false);
  });

  test('active quota cooldown persists across storage instances and blocks redundant Firestore reads', async () => {
    assert.equal(isCloudQuotaCooldownActive(), false);
    assert.equal(isCloudWriteCooldownActive(), false);

    markCloudQuotaExhausted(60_000);
    assert.equal(isCloudQuotaCooldownActive(), true);
    assert.equal(isCloudWriteCooldownActive(), true);

    await assert.rejects(
      () => fetchUserCloudLibrary('test-uid-123'),
      (err: unknown) => isFirestoreQuotaError(err)
    );

    const validationRows = await fetchValidationRecordsFromFirestore();
    assert.deepEqual(validationRows, []);
  });

  test('fetchPublishedCatalogAdditions returns cached data with zero Firestore reads when cache is fresh or cooldown active', async () => {
    const fakeCachePayload = {
      fetchedAt: Date.now(),
      sets: [
        {
          setCode: 'BS71',
          name: 'BS71 Test Set',
          jpName: '',
          category: 'Booster',
          productType: 'Booster Pack',
          releaseDate: '2025-01-01',
          formats: ['Standard'],
          blockLabel: 'Wiki',
          tagline: '',
          featuredCardId: '',
          colors: ['Red'],
          totalCardsInSet: 1,
          wikiUrl: '',
          isNumberOnly: false,
        },
      ],
      cards: [],
    };
    localStorage.setItem('spiritsdex_published_catalog_cache_v1', JSON.stringify(fakeCachePayload));

    const freshRes = await fetchPublishedCatalogAdditions();
    assert.equal(freshRes.sets.length, 1);
    assert.equal(freshRes.sets[0].setCode, 'BS71');

    // Even if cache is expired, active quota cooldown returns cached fallback instead of hitting Firestore
    localStorage.setItem(
      'spiritsdex_published_catalog_cache_v1',
      JSON.stringify({ ...fakeCachePayload, fetchedAt: 0 })
    );
    markCloudQuotaExhausted(60_000);

    const cooldownRes = await fetchPublishedCatalogAdditions({ forceRefresh: true });
    assert.equal(cooldownRes.sets.length, 1);
    assert.equal(cooldownRes.sets[0].setCode, 'BS71');
  });

  test('firestore.rules allows verified admins to list catalogSets and catalogCards alongside isPublished queries', () => {
    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const setsMatch = rulesSrc.match(/match \/catalogSets\/\{setCode\}\s*\{[\s\S]*?\n\s*\}/);
    const cardsMatch = rulesSrc.match(/match \/catalogCards\/\{cardId\}\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(setsMatch, 'Expected catalogSets rule block');
    assert.ok(cardsMatch, 'Expected catalogCards rule block');
    assert.match(
      setsMatch[0],
      /allow list:\s*if existing\(\)\.isPublished == true \|\| isAdmin\(\);/,
      'catalogSets allow list must support published public queries and verified admins'
    );
    assert.match(
      cardsMatch[0],
      /allow list:\s*if existing\(\)\.isPublished == true \|\| isAdmin\(\);/,
      'catalogCards allow list must support published public queries and verified admins'
    );
  });
});
