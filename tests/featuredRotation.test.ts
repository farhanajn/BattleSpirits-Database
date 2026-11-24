import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IdTokenResult, User } from 'firebase/auth';
import { terminate } from 'firebase/firestore';
import { db } from '../src/firebase.ts';
import { BATTLE_SPIRITS_CARDS, PRODUCT_SETS } from '../src/data/cards';
import type { BattleSpiritsCard } from '../src/types/card';
import { CatalogMenuView } from '../src/components/CatalogMenuView';
import {
  getWibRotationWindow,
  selectFeaturedCards,
  selectLatestFeaturedCards,
  selectRandomFeaturedCards,
} from '../src/utils/featuredCards';
import { updateSharedFeaturedMode } from '../src/utils/featuredConfigSync';

function makeMockUser(overrides: {
  uid?: string;
  email?: string | null;
  emailVerified?: boolean;
  claims?: Record<string, unknown>;
}): User {
  const tokenResult = {
    token: 'mock-token',
    expirationTime: new Date(Date.now() + 3600_000).toISOString(),
    authTime: new Date().toISOString(),
    issuedAtTime: new Date().toISOString(),
    signInProvider: 'google.com',
    signInSecondFactor: null,
    claims: {
      email: overrides.email ?? undefined,
      email_verified: overrides.emailVerified ?? false,
      ...(overrides.claims ?? {}),
    },
  } as unknown as IdTokenResult;

  return {
    uid: overrides.uid ?? 'user-1',
    email: overrides.email ?? 'player@example.com',
    emailVerified: overrides.emailVerified ?? true,
    isAnonymous: false,
    displayName: 'Test User',
    photoURL: '',
    getIdToken: async () => 'mock-token',
    getIdTokenResult: async () => tokenResult,
  } as unknown as User;
}

function makeCard(overrides: Partial<BattleSpiritsCard>): BattleSpiritsCard {
  return {
    id: overrides.id || 'fr-1',
    cardNumber: overrides.cardNumber || 'BS01-001',
    name: overrides.name || 'Sample Spirit',
    jpName: 'サンプル',
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

describe('Featured Cards Shared 6-Hour WIB Rotation', () => {
  after(async () => {
    await terminate(db).catch(() => {});
  });

  test('WIB rotation windows strictly align to 00:00, 06:00, 12:00, and 18:00 Asia/Jakarta', () => {
    const cases = [
      {
        iso: '2026-11-24T00:00:00+07:00',
        expectedHour: 0,
        expectedStart: '00:00 WIB',
        expectedNext: '06:00 WIB',
        expectedKey: '2026-11-24T00:00+07:00',
      },
      {
        iso: '2026-11-24T05:59:59+07:00',
        expectedHour: 0,
        expectedStart: '00:00 WIB',
        expectedNext: '06:00 WIB',
        expectedKey: '2026-11-24T00:00+07:00',
      },
      {
        iso: '2026-11-24T06:00:00+07:00',
        expectedHour: 6,
        expectedStart: '06:00 WIB',
        expectedNext: '12:00 WIB',
        expectedKey: '2026-11-24T06:00+07:00',
      },
      {
        iso: '2026-11-24T11:45:00+07:00',
        expectedHour: 6,
        expectedStart: '06:00 WIB',
        expectedNext: '12:00 WIB',
        expectedKey: '2026-11-24T06:00+07:00',
      },
      {
        iso: '2026-11-24T12:00:00+07:00',
        expectedHour: 12,
        expectedStart: '12:00 WIB',
        expectedNext: '18:00 WIB',
        expectedKey: '2026-11-24T12:00+07:00',
      },
      {
        iso: '2026-11-24T17:59:59+07:00',
        expectedHour: 12,
        expectedStart: '12:00 WIB',
        expectedNext: '18:00 WIB',
        expectedKey: '2026-11-24T12:00+07:00',
      },
      {
        iso: '2026-11-24T18:00:00+07:00',
        expectedHour: 18,
        expectedStart: '18:00 WIB',
        expectedNext: '00:00 WIB',
        expectedKey: '2026-11-24T18:00+07:00',
      },
      {
        iso: '2026-11-24T23:59:59+07:00',
        expectedHour: 18,
        expectedStart: '18:00 WIB',
        expectedNext: '00:00 WIB',
        expectedKey: '2026-11-24T18:00+07:00',
      },
    ];

    for (const tc of cases) {
      const w = getWibRotationWindow(Date.parse(tc.iso));
      assert.equal(w.windowHourWib, tc.expectedHour, `Failed hour for ${tc.iso}`);
      assert.equal(w.windowStartLabel, tc.expectedStart, `Failed start label for ${tc.iso}`);
      assert.equal(w.nextRotationLabel, tc.expectedNext, `Failed next label for ${tc.iso}`);
      assert.equal(w.windowKey, tc.expectedKey, `Failed windowKey for ${tc.iso}`);
    }
  });

  test('Random mode stays identical across reloads and different clients within a 6-hour window, never duplicates, and rotates every 6 hours', () => {
    const clientCatalogA = BATTLE_SPIRITS_CARDS.slice(0, 60);
    // Reverse order simulates another client loading cached/Firestore cards in a different order
    const clientCatalogB = [...clientCatalogA].reverse();

    const t1 = Date.parse('2026-11-24T06:05:00+07:00');
    const t2SameWindow = Date.parse('2026-11-24T11:55:00+07:00');
    const tNextWindow = Date.parse('2026-11-24T12:00:00+07:00');

    const user1Draw = selectRandomFeaturedCards(clientCatalogA, {
      format: 'All',
      count: 8,
      nowMs: t1,
    });
    const user2DrawDifferentOrder = selectRandomFeaturedCards(clientCatalogB, {
      format: 'All',
      count: 8,
      nowMs: t2SameWindow,
    });

    assert.equal(user1Draw.length, 8);
    assert.equal(new Set(user1Draw.map((c) => c.id)).size, 8, 'No duplicate cards allowed');
    assert.deepEqual(
      user1Draw.map((c) => c.id),
      user2DrawDifferentOrder.map((c) => c.id),
      'All users and page reloads inside the same 6-hour WIB window must see the exact same selection'
    );

    const nextWindowDraw = selectRandomFeaturedCards(clientCatalogA, {
      format: 'All',
      count: 8,
      nowMs: tNextWindow,
    });
    assert.equal(nextWindowDraw.length, 8);
    assert.equal(new Set(nextWindowDraw.map((c) => c.id)).size, 8);
    assert.notDeepEqual(
      user1Draw.map((c) => c.id),
      nextWindowDraw.map((c) => c.id),
      'Crossing the 6-hour WIB boundary must generate a new shared selection'
    );
  });

  test('Latest mode sorts by real import/creation timestamp and queues cards imported mid-window for the next 6-hour rotation', () => {
    const cardBeforeWindow = makeCard({
      id: 'imported-before-1200',
      cardNumber: 'BS01-002',
      setCode: 'BS01',
      importedAt: '2026-11-24T11:30:00+07:00',
    });
    const olderHighCardNumber = makeCard({
      id: 'imported-earlier-bs77',
      cardNumber: 'BS77-088',
      setCode: 'BS77',
      importedAt: '2026-11-24T05:00:00+07:00',
    });
    const cardImportedDuringWindow = makeCard({
      id: 'imported-during-1200-window',
      cardNumber: '26RBS01-010',
      setCode: '26RBS01',
      formats: ['Standard', 'Eternal'],
      createdAt: '2026-11-24T14:20:00+07:00',
    });

    const pool = [olderHighCardNumber, cardBeforeWindow, cardImportedDuringWindow];

    // Inside the 12:00–18:00 WIB window (e.g. 15:00 WIB): mid-window import waits for 18:00 WIB rotation
    const midWindowResults = selectLatestFeaturedCards(pool, {
      format: 'All',
      count: 8,
      nowMs: Date.parse('2026-11-24T15:00:00+07:00'),
      productSets: PRODUCT_SETS,
    });
    assert.deepEqual(
      midWindowResults.map((c) => c.id),
      ['imported-before-1200', 'imported-earlier-bs77'],
      'Cards imported during the current window must wait until the next 6-hour rotation boundary'
    );

    // At the 18:00 WIB rotation boundary: newly imported card automatically surfaces first
    const nextRotationResults = selectLatestFeaturedCards(pool, {
      format: 'All',
      count: 8,
      nowMs: Date.parse('2026-11-24T18:00:00+07:00'),
      productSets: PRODUCT_SETS,
    });
    assert.deepEqual(
      nextRotationResults.map((c) => c.id),
      ['imported-during-1200-window', 'imported-before-1200', 'imported-earlier-bs77'],
      'Newly imported card must automatically become eligible on the next scheduled 6-hour rotation'
    );
  });

  test('CatalogMenuView keeps Featured Cards identical across repeated renders for same window and switches smoothly between Random and Latest shared modes', () => {
    const cardsById: Record<string, BattleSpiritsCard> = {};
    for (const c of BATTLE_SPIRITS_CARDS) {
      cardsById[c.id] = c;
    }

    const renderWithMode = (mode: 'random' | 'latest', nowIso: string, spoofAdminProp = false) =>
      renderToStaticMarkup(
        React.createElement(CatalogMenuView, {
          productSets: PRODUCT_SETS,
          cards: BATTLE_SPIRITS_CARDS,
          cardsById,
          activeDeckQtyMap: {},
          activeFormat: 'All',
          currentUser: spoofAdminProp
            ? makeMockUser({ uid: 'regular-u', email: 'player@example.com', emailVerified: true })
            : null,
          authReady: true,
          isAdmin: spoofAdminProp, // verifies fail-closed useAdmin rejects prop spoofing
          adminLoading: false,
          sharedFeaturedMode: mode,
          rotationNowMs: Date.parse(nowIso),
          onChangeFormat: () => {},
          onOpenSetInSearch: () => {},
          onOpenSearch: () => {},
          onSelectCard: () => {},
          onAddToDeck: () => {},
        })
      );

    const randomHtml1 = renderWithMode('random', '2026-11-24T12:10:00+07:00', false);
    const randomHtml2 = renderWithMode('random', '2026-11-24T17:45:00+07:00', true);
    assert.ok(randomHtml1.includes('Random Rotation · Next 18:00 WIB'));
    assert.equal(
      randomHtml1.includes('aria-label="Featured cards display mode"'),
      false,
      'Non-admin user must never see admin mode toggle even if prop is spoofed'
    );
    assert.equal(
      randomHtml2.includes('aria-label="Featured cards display mode"'),
      false
    );

    // Extract rendered featured card titles/links order — must be identical inside 12:00..18:00 WIB
    const expectedRandom = selectFeaturedCards(BATTLE_SPIRITS_CARDS, {
      mode: 'random',
      format: 'All',
      count: 8,
      nowMs: Date.parse('2026-11-24T12:10:00+07:00'),
    });
    for (const card of expectedRandom) {
      assert.ok(randomHtml1.includes(card.cardNumber), `Missing expected card ${card.cardNumber}`);
      assert.ok(randomHtml2.includes(card.cardNumber), `Selection drifted inside same 6h window`);
    }

    const latestHtml = renderWithMode('latest', '2026-11-24T12:10:00+07:00', false);
    assert.ok(latestHtml.includes('Latest Mode · Next 18:00 WIB'));
  });

  test('updateSharedFeaturedMode enforces admin-only authorization (rejects guests and non-admins) and persists globally for admins', async () => {
    let writesCount = 0;
    let lastSaved: { mode: string; uid: string } | null = null;

    const regularUser = makeMockUser({
      uid: 'non-admin-uid',
      email: 'duelist@gmail.com',
      emailVerified: true,
      claims: {},
    });

    const verifiedAdmin = makeMockUser({
      uid: 'admin-uid',
      email: 'farhana.jn2000@gmail.com',
      emailVerified: true,
      claims: { admin: true },
    });

    await assert.rejects(
      () =>
        updateSharedFeaturedMode('latest', null, {
          writeModeToCloud: async () => {
            writesCount++;
          },
        }),
      /Only authenticated administrators/
    );

    await assert.rejects(
      () =>
        updateSharedFeaturedMode('latest', regularUser, {
          verifyAdmin: async () => false,
          writeModeToCloud: async () => {
            writesCount++;
          },
        }),
      /Only authenticated administrators/
    );

    assert.equal(writesCount, 0, 'Rejected callers must never reach cloud write');

    const result = await updateSharedFeaturedMode('latest', verifiedAdmin, {
      verifyAdmin: async (u) => Boolean(u && u.uid === 'admin-uid'),
      writeModeToCloud: async (mode, adminUid) => {
        writesCount++;
        lastSaved = { mode, uid: adminUid };
      },
    });

    assert.equal(writesCount, 1);
    assert.deepEqual(lastSaved, { mode: 'latest', uid: 'admin-uid' });
    assert.equal(result.mode, 'latest');
    assert.equal(result.updatedByUid, 'admin-uid');
  });

  test('firestore.rules locks /appConfig/{configId} writes exclusively to isAdmin() with strict validation', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    assert.ok(rules.includes('match /appConfig/{configId}'));
    assert.ok(rules.includes('function isValidFeaturedCardsConfig(data, configId)'));
    assert.ok(rules.includes("allow get: if isValidId(configId) && configId == 'featuredCards';"));
    assert.ok(rules.includes('allow create: if isAdmin()'));
    assert.ok(rules.includes('allow update: if isAdmin()'));
  });
});
