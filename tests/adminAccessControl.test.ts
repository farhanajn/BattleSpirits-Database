import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test, { after, describe } from 'node:test';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IdTokenResult, User } from 'firebase/auth';
import { terminate } from 'firebase/firestore';
import { db } from '../src/firebase.ts';
import { resolveAdminStatusFromUser } from '../src/hooks/useAdmin.ts';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { AdminCatalogSection } from '../src/components/AdminCatalogSection.tsx';
import {
  createRequireAdminMiddleware,
  verifyFirebaseIdToken,
} from '../server/middleware/adminAuth.ts';
import { createArtworkValidationRouter } from '../server/controllers/artworkValidationController.ts';

// Ensure browser-like globals do not fail SSR rendering checks if referenced defensively
if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
  (globalThis as Record<string, unknown>).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function makeMockUser(overrides: {
  uid?: string;
  email?: string | null;
  emailVerified?: boolean;
  isAnonymous?: boolean;
  claims?: Record<string, unknown>;
  tokenError?: Error;
}): User {
  const claims = overrides.claims ?? {};
  const tokenResult = {
    token: 'mock-id-token',
    expirationTime: new Date(Date.now() + 3600_000).toISOString(),
    authTime: new Date().toISOString(),
    issuedAtTime: new Date().toISOString(),
    signInProvider: 'google.com',
    signInSecondFactor: null,
    claims: {
      email: overrides.email ?? undefined,
      email_verified: overrides.emailVerified ?? false,
      ...claims,
    },
  } as unknown as IdTokenResult;

  return {
    uid: overrides.uid ?? 'user-123',
    email: overrides.email === undefined ? 'player@example.com' : overrides.email,
    emailVerified: overrides.emailVerified ?? false,
    isAnonymous: overrides.isAnonymous ?? false,
    displayName: 'Test User',
    photoURL: '',
    getIdToken: async () => 'mock-id-token',
    getIdTokenResult: async () => {
      if (overrides.tokenError) throw overrides.tokenError;
      return tokenResult;
    },
  } as unknown as User;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signTestJwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid = 'test-key-1'
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

describe('Admin Access Control & Fail-Closed Authorization', () => {
  after(async () => {
    await terminate(db).catch(() => {});
  });

  test('resolveAdminStatusFromUser strictly authorizes only verified admin accounts and fails closed otherwise', async () => {
    const noAdminDoc = async () => false;

    // 1. Authorized admin via Firebase Auth `admin: true` custom claim
    const customClaimAdmin = makeMockUser({
      uid: 'admin-claim-uid',
      email: 'ops-admin@example.com',
      emailVerified: true,
      claims: { admin: true },
    });
    assert.equal(
      await resolveAdminStatusFromUser(customClaimAdmin, { hasFirestoreAdminRecord: noAdminDoc }),
      true
    );

    // 2. Authorized admin via verified owner email (matching firestore.rules)
    const ownerEmailAdmin = makeMockUser({
      uid: 'owner-uid',
      email: 'Farhana.Jn2000@gmail.com',
      emailVerified: true,
      claims: {},
    });
    assert.equal(
      await resolveAdminStatusFromUser(ownerEmailAdmin, { hasFirestoreAdminRecord: noAdminDoc }),
      true
    );

    // 3. Authorized admin via Firestore `admins/{uid}` marker doc
    const firestoreDocAdmin = makeMockUser({
      uid: 'delegated-admin-uid',
      email: 'delegate@example.com',
      emailVerified: true,
      claims: {},
    });
    assert.equal(
      await resolveAdminStatusFromUser(firestoreDocAdmin, {
        hasFirestoreAdminRecord: async (uid) => uid === 'delegated-admin-uid',
      }),
      true
    );

    // 4. Regular authenticated user MUST return false
    const regularUser = makeMockUser({
      uid: 'regular-user-1',
      email: 'regular.player@gmail.com',
      emailVerified: true,
      claims: { role: 'user', admin: false },
    });
    assert.equal(
      await resolveAdminStatusFromUser(regularUser, { hasFirestoreAdminRecord: noAdminDoc }),
      false
    );

    // 5. Unverified email MUST return false even if email matches allowlist
    const unverifiedUser = makeMockUser({
      uid: 'unverified-uid',
      email: 'farhana.jn2000@gmail.com',
      emailVerified: false,
      claims: {},
    });
    assert.equal(
      await resolveAdminStatusFromUser(unverifiedUser, {
        hasFirestoreAdminRecord: async () => true,
      }),
      false
    );

    // 6. Anonymous user MUST return false
    const anonUser = makeMockUser({
      uid: 'anon-uid',
      email: null,
      emailVerified: false,
      isAnonymous: true,
      claims: { admin: true },
    });
    assert.equal(
      await resolveAdminStatusFromUser(anonUser, { hasFirestoreAdminRecord: async () => true }),
      false
    );

    // 7. Logged-out visitor MUST return false
    assert.equal(
      await resolveAdminStatusFromUser(null, { hasFirestoreAdminRecord: async () => true }),
      false
    );

    // 8. Token inspection error MUST fail closed (false)
    const brokenTokenUser = makeMockUser({
      uid: 'error-uid',
      email: 'farhana.jn2000@gmail.com',
      emailVerified: true,
      tokenError: new Error('Firebase token refresh failed'),
    });
    assert.equal(
      await resolveAdminStatusFromUser(brokenTokenUser, { hasFirestoreAdminRecord: noAdminDoc }),
      false
    );
  });

  test('SettingsView and AdminCatalogSection render ZERO admin UI traces for logged-out visitors, loading states, and regular users', () => {
    const adminForbiddenStrings = [
      'Catalog Maintenance',
      'Artwork Link Health',
      'Wiki Catalog Sync',
      'Manual Artwork Validation',
      'Open Admin Tools',
      'Hide Admin Tools',
      'Discover Battle Spirits Wiki sets',
      'Skipped / Rejected Card Diagnostics',
    ];

    const renderSettings = (props: {
      currentUser: User | null;
      authReady: boolean;
      isAdmin?: boolean;
      adminLoading?: boolean;
    }) =>
      renderToStaticMarkup(
        React.createElement(SettingsView, {
          currentUser: props.currentUser,
          authReady: props.authReady,
          isAdmin: props.isAdmin,
          adminLoading: props.adminLoading,
          signingIn: false,
          cloudSyncing: false,
          deckCount: 2,
          folderCount: 1,
          onSignInGoogle: () => {},
          onSignOutGoogle: () => {},
          onSyncNow: () => {},
          onSaveProfile: async () => true,
        })
      );

    // A. Logged-out visitor
    const loggedOutHtml = renderSettings({ currentUser: null, authReady: true, isAdmin: false });
    assert.ok(loggedOutHtml.includes('Player Profile'), 'Logged-out settings page still renders');
    assert.ok(loggedOutHtml.includes('Sign in with Google'), 'Sign in CTA renders for visitor');
    for (const forbidden of adminForbiddenStrings) {
      assert.equal(
        loggedOutHtml.includes(forbidden),
        false,
        `Logged-out HTML leaked admin string: ${forbidden}`
      );
    }

    // B. Regular authenticated non-admin user (even if someone spoofed isAdmin={true} prop!)
    const regularUser = makeMockUser({
      uid: 'regular-user-42',
      email: 'duelist@example.com',
      emailVerified: true,
      claims: {},
    });
    const regularHtml = renderSettings({
      currentUser: regularUser,
      authReady: true,
      isAdmin: true, // adversarial prop spoof test
      adminLoading: false,
    });
    assert.ok(regularHtml.includes('duelist@example.com'), 'Regular user sees their own account');
    for (const forbidden of adminForbiddenStrings) {
      assert.equal(
        regularHtml.includes(forbidden),
        false,
        `Regular user HTML leaked admin string: ${forbidden}`
      );
    }

    // C. Loading auth state (must not flash admin tools before auth settles)
    const loadingHtml = renderSettings({
      currentUser: makeMockUser({
        uid: 'owner-uid',
        email: 'farhana.jn2000@gmail.com',
        emailVerified: true,
        claims: { admin: true },
      }),
      authReady: false,
      isAdmin: true,
      adminLoading: true,
    });
    for (const forbidden of adminForbiddenStrings) {
      assert.equal(
        loadingHtml.includes(forbidden),
        false,
        `Loading state HTML flashed admin string: ${forbidden}`
      );
    }

    // D. Direct render attempt on AdminCatalogSection itself fails closed cleanly
    const directLoggedOut = renderToStaticMarkup(
      React.createElement(AdminCatalogSection, { currentUser: null, authReady: true })
    );
    assert.equal(directLoggedOut, '');

    const directRegularUser = renderToStaticMarkup(
      React.createElement(AdminCatalogSection, { currentUser: regularUser, authReady: true })
    );
    assert.equal(directRegularUser, '');
  });

  test('Backend middleware rejects logged-out (401) and regular users (403) across all /api/admin/* endpoints while allowing verified admin & cron secret', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const projectId = 'totemic-day-3xq1s';
    const nowSec = Math.floor(Date.now() / 1000);
    const getPublicCerts = async () => ({ 'test-key-1': publicKey });

    const requireAdmin = createRequireAdminMiddleware({
      projectId,
      verifyToken: (token) => verifyFirebaseIdToken(token, { projectId, getPublicCerts }),
      checkFirestoreAdminRecord: async () => false,
    });

    const app = express();
    app.use(express.json());
    app.get('/api/health', (_req, res) => res.json({ ok: true }));

    // Mount scheduled validation cron router FIRST (matches server.ts)
    app.use(
      createArtworkValidationRouter({
        expectedSecret: 'cron-secret-value',
        deps: {
          nowFn: () => Date.parse('2026-11-23T00:00:00Z'),
          fetchFn: async () => new Response('', { status: 200 }),
          mappingsProvider: () => [],
          stateFilePath: `/tmp/spiritsdex-admin-test-val-${Date.now()}.json`,
        },
      })
    );

    // Protect all other /api/admin/* endpoints
    app.use('/api/admin', requireAdmin);

    const adminEndpoints: Array<{ method: 'GET' | 'POST'; path: string }> = [
      { method: 'GET', path: '/api/admin/catalog/status' },
      { method: 'POST', path: '/api/admin/catalog/discover-sets' },
      { method: 'POST', path: '/api/admin/catalog/scan' },
      { method: 'POST', path: '/api/admin/catalog/compare' },
      { method: 'POST', path: '/api/admin/catalog/review' },
      { method: 'POST', path: '/api/admin/catalog/validate-import' },
      { method: 'POST', path: '/api/admin/catalog/import' },
      { method: 'POST', path: '/api/admin/catalog/reprocess' },
      { method: 'GET', path: '/api/admin/validation/status' },
      { method: 'POST', path: '/api/admin/validation/run' },
      { method: 'POST', path: '/api/admin/validation/check-one' },
      { method: 'POST', path: '/api/admin/validation/rehydrate' },
    ];

    for (const ep of adminEndpoints) {
      if (ep.method === 'GET') {
        app.get(ep.path, (req, res) => {
          res.json({ ok: true, uid: (req as any).adminUser?.uid });
        });
      } else {
        app.post(ep.path, (req, res) => {
          res.json({ ok: true, uid: (req as any).adminUser?.uid });
        });
      }
    }

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const regularJwt = signTestJwt(
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'regular-user-uid',
          email: 'regular.user@example.com',
          email_verified: true,
          auth_time: nowSec - 60,
          iat: nowSec - 30,
          exp: nowSec + 3600,
          firebase: { sign_in_provider: 'google.com' },
        },
        privateKey
      );

      const unverifiedOwnerJwt = signTestJwt(
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'unverified-owner-uid',
          email: 'farhana.jn2000@gmail.com',
          email_verified: false,
          auth_time: nowSec - 60,
          iat: nowSec - 30,
          exp: nowSec + 3600,
          firebase: { sign_in_provider: 'password' },
        },
        privateKey
      );

      const expiredAdminJwt = signTestJwt(
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'expired-admin-uid',
          email: 'farhana.jn2000@gmail.com',
          email_verified: true,
          admin: true,
          auth_time: nowSec - 7200,
          iat: nowSec - 7200,
          exp: nowSec - 10,
          firebase: { sign_in_provider: 'google.com' },
        },
        privateKey
      );

      const adminClaimJwt = signTestJwt(
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'claim-admin-uid',
          email: 'ops@spiritsdex.app',
          email_verified: true,
          admin: true,
          auth_time: nowSec - 60,
          iat: nowSec - 30,
          exp: nowSec + 3600,
          firebase: { sign_in_provider: 'google.com' },
        },
        privateKey
      );

      const adminOwnerJwt = signTestJwt(
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'owner-admin-uid',
          email: 'farhana.jn2000@gmail.com',
          email_verified: true,
          auth_time: nowSec - 60,
          iat: nowSec - 30,
          exp: nowSec + 3600,
          firebase: { sign_in_provider: 'google.com' },
        },
        privateKey
      );

      // 1. Public health works logged out
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);

      // 2. Logged-out visitor receives 401 on ALL admin routes
      for (const ep of adminEndpoints) {
        const res = await fetch(`${baseUrl}${ep.path}`, { method: ep.method });
        assert.equal(res.status, 401, `Logged-out ${ep.method} ${ep.path} must return 401`);
      }

      // 3. Regular authenticated user receives 403 on ALL admin routes even with spoofed body/query flags
      for (const ep of adminEndpoints) {
        const url = `${baseUrl}${ep.path}?isAdmin=true&role=admin`;
        const res = await fetch(url, {
          method: ep.method,
          headers: {
            Authorization: `Bearer ${regularJwt}`,
            'Content-Type': 'application/json',
          },
          body:
            ep.method === 'POST'
              ? JSON.stringify({
                  isAdmin: true,
                  role: 'admin',
                  email: 'farhana.jn2000@gmail.com',
                })
              : undefined,
        });
        assert.equal(res.status, 403, `Regular user ${ep.method} ${ep.path} must return 403`);
      }

      // 4. Unverified admin email (403) and expired token (401) are rejected
      const unverifiedRes = await fetch(`${baseUrl}/api/admin/catalog/status`, {
        headers: { Authorization: `Bearer ${unverifiedOwnerJwt}` },
      });
      assert.equal(unverifiedRes.status, 403);

      const expiredRes = await fetch(`${baseUrl}/api/admin/catalog/status`, {
        headers: { Authorization: `Bearer ${expiredAdminJwt}` },
      });
      assert.equal(expiredRes.status, 401);

      // 5. Authorized Admin (custom claim `admin: true` and verified owner email) succeeds
      for (const ep of adminEndpoints) {
        const resClaim = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: { Authorization: `Bearer ${adminClaimJwt}` },
        });
        assert.equal(resClaim.status, 200, `Claim admin ${ep.method} ${ep.path} must succeed`);

        const resOwner = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: { Authorization: `Bearer ${adminOwnerJwt}` },
        });
        assert.equal(resOwner.status, 200, `Owner admin ${ep.method} ${ep.path} must succeed`);
      }

      // 6. Scheduled cron endpoint still rejects missing secret (401) and accepts valid X-Validation-Cron-Secret (200)
      const cronNoSecret = await fetch(`${baseUrl}/api/admin/validation/scheduled`, {
        method: 'POST',
      });
      assert.equal(cronNoSecret.status, 401);

      const cronValid = await fetch(`${baseUrl}/api/admin/validation/scheduled`, {
        method: 'POST',
        headers: { 'X-Validation-Cron-Secret': 'cron-secret-value' },
      });
      assert.equal(cronValid.status, 200);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
