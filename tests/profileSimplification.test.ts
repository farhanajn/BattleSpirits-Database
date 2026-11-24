import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from 'firebase/auth';
import { SettingsView } from '../src/components/SettingsView';
import { db, auth } from '../src/firebase';

function makeMockFirebaseUser(overrides: {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}): User {
  return {
    uid: overrides.uid,
    displayName: overrides.displayName,
    email: overrides.email,
    photoURL: overrides.photoURL,
    emailVerified: true,
    isAnonymous: false,
    providerData: [],
    metadata: {},
    refreshToken: 'mock-refresh-token',
    tenantId: null,
    phoneNumber: null,
    providerId: 'firebase',
    delete: async () => {},
    getIdToken: async () => 'mock-id-token',
    getIdTokenResult: async () => ({
      authTime: '',
      expirationTime: '',
      issuedAtTime: '',
      signInProvider: 'google.com',
      signInSecondFactor: null,
      token: 'mock-id-token',
      claims: {},
    }),
    reload: async () => {},
    toJSON: () => ({}),
  } as unknown as User;
}

const REMOVED_PROFILE_CUSTOMIZATION_STRINGS = [
  'Builder Bio / Notes',
  'settings-profile-bio',
  'Share your favorite Battle Spirits archetype, format, or testing notes...',
  'Signature Core Color',
  'Synced to your Firebase profile document.',
  'Save Profile',
  'Profile Saved',
];

test('Simplified Profile Card renders only avatar, display name, email, and Log Out for signed-in users', () => {
  const userA = makeMockFirebaseUser({
    uid: 'user-a-123',
    displayName: 'Farhan Ahmadi',
    email: 'imaginebrave1@gmail.com',
    photoURL: 'https://example.com/avatar-a.png',
  });

  const htmlA = renderToStaticMarkup(
    React.createElement(SettingsView, {
      currentUser: userA,
      authReady: true,
      isAdmin: false,
      adminLoading: false,
      signingIn: false,
      cloudSyncing: false,
      deckCount: 4,
      folderCount: 2,
      onSignInGoogle: () => {},
      onSignOutGoogle: () => {},
      onSyncNow: () => {},
    })
  );

  // Required profile elements are present
  assert.ok(htmlA.includes('https://example.com/avatar-a.png'), 'Profile picture URL must display');
  assert.ok(htmlA.includes('Farhan Ahmadi'), 'Display name must display');
  assert.ok(htmlA.includes('imaginebrave1@gmail.com'), 'Email address must display');
  assert.ok(htmlA.includes('Log Out'), 'Log Out button must display');

  // Removed customization elements must not appear
  for (const forbidden of REMOVED_PROFILE_CUSTOMIZATION_STRINGS) {
    assert.equal(
      htmlA.includes(forbidden),
      false,
      `Simplified profile must not include removed element: ${forbidden}`
    );
  }
  assert.equal(htmlA.includes('<textarea'), false, 'Profile textarea must be removed');
  assert.equal(htmlA.includes('<form'), false, 'Profile customization form must be removed');

  // Account switching immediately updates displayed identity & avatar
  const userB = makeMockFirebaseUser({
    uid: 'user-b-456',
    displayName: 'Dan Bashin',
    email: 'dan.bashin@example.com',
    photoURL: null,
  });

  const htmlB = renderToStaticMarkup(
    React.createElement(SettingsView, {
      currentUser: userB,
      authReady: true,
      isAdmin: false,
      adminLoading: false,
      signingIn: false,
      cloudSyncing: false,
      deckCount: 1,
      folderCount: 0,
      onSignInGoogle: () => {},
      onSignOutGoogle: () => {},
      onSyncNow: () => {},
    })
  );

  assert.ok(htmlB.includes('Dan Bashin'), 'Switched display name must render');
  assert.ok(htmlB.includes('dan.bashin@example.com'), 'Switched email must render');
  assert.equal(htmlB.includes('Farhan Ahmadi'), false, 'Previous user name must not linger');
  assert.equal(htmlB.includes('imaginebrave1@gmail.com'), false, 'Previous email must not linger');
  assert.ok(htmlB.includes('Log Out'), 'Log Out button remains visible');

  // Rules/Turn Sequence & Cloud Sync remain intact while Reduction Cost Calculator is removed
  assert.ok(htmlA.includes('Deck Library &amp; Cloud Sync'), 'Deck Cloud Sync card preserved');
  assert.ok(htmlA.includes('Backup 4 Decks to Google Cloud'), 'Google Cloud Deck backup CTA preserved');
  assert.ok(htmlA.includes('Turn Sequence'), 'Official Turn Sequence guide preserved');
  assert.equal(htmlA.includes('Reduction Cost Calculator'), false, 'Reduction Cost Calculator must be removed');
  assert.equal(htmlA.includes('Cores Required to Pay'), false, 'Calculator output must be removed');
  assert.equal(htmlA.includes('Printed Card Cost'), false, 'Calculator inputs must be removed');
});

test('Signed-out Settings view retains Google Sign-In flow without profile customization controls', () => {
  const loggedOutHtml = renderToStaticMarkup(
    React.createElement(SettingsView, {
      currentUser: null,
      authReady: true,
      isAdmin: false,
      adminLoading: false,
      signingIn: false,
      cloudSyncing: false,
      deckCount: 3,
      folderCount: 1,
      onSignInGoogle: () => {},
      onSignOutGoogle: () => {},
      onSyncNow: () => {},
    })
  );

  assert.ok(loggedOutHtml.includes('Player Profile &amp; Cloud Account'));
  assert.ok(loggedOutHtml.includes('Sign in with Google'));
  assert.ok(loggedOutHtml.includes('Sign in to Enable Cloud Backup'));

  for (const forbidden of REMOVED_PROFILE_CUSTOMIZATION_STRINGS) {
    assert.equal(loggedOutHtml.includes(forbidden), false);
  }
});

test('Firebase integration, config, rules, and cloud sync exports remain completely preserved', async () => {
  assert.ok(auth, 'Firebase Auth instance must still be initialized');
  assert.ok(db, 'Firestore instance must still be initialized');

  const root = process.cwd();
  assert.ok(fs.existsSync(path.join(root, 'firebase-applet-config.json')), 'firebase-applet-config.json preserved');
  assert.ok(fs.existsSync(path.join(root, 'firestore.rules')), 'firestore.rules preserved');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(
    pkg.dependencies?.firebase || pkg.devDependencies?.firebase,
    'firebase SDK dependency preserved in package.json'
  );

  const firebaseMod = await import('../src/firebase');
  assert.equal(typeof firebaseMod.signInWithGoogle, 'function');
  assert.equal(typeof firebaseMod.signOutGoogle, 'function');

  const cloudSyncMod = await import('../src/utils/cloudSync');
  assert.equal(typeof cloudSyncMod.syncUserAccountsOnSignIn, 'function');
  assert.equal(typeof cloudSyncMod.fetchUserCloudLibrary, 'function');
  assert.equal(typeof cloudSyncMod.syncAllDecksAndFoldersToCloud, 'function');
  assert.equal(typeof cloudSyncMod.deleteCloudDeck, 'function');
  assert.equal(typeof cloudSyncMod.deleteCloudFolder, 'function');

  const cardsMod = await import('../src/data/cards');
  const cardsWithReduction = cardsMod.BATTLE_SPIRITS_CARDS.filter(
    (c) => c.reduction && Object.values(c.reduction).some((v) => Number(v) > 0)
  );
  assert.ok(cardsWithReduction.length > 0, 'Card reduction symbols & printed costs remain intact');
  assert.ok(typeof cardsWithReduction[0].cost === 'number', 'Printed card cost remains intact');
});
