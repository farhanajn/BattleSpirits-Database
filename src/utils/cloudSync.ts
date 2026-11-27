import { type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CardColor,
  Deck,
  DeckEntry,
  DeckFolder,
  GameFormat,
} from '../types/card';

import {
  clearCloudQuotaCooldown,
  createQuotaExceededError,
  guardFirestoreWrite,
  isCloudQuotaCooldownActive,
  isCloudWriteCooldownActive,
  isFirestoreQuotaError,
  markCloudQuotaExhausted,
} from './firestoreQuota';

export {
  clearCloudQuotaCooldown,
  isCloudQuotaCooldownActive,
  isCloudWriteCooldownActive,
  isFirestoreQuotaError,
  markCloudQuotaExhausted,
};

const VALID_COLORS: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];

function sanitizeOptionalColor(c: unknown): CardColor | '' {
  return VALID_COLORS.includes(c as CardColor) ? (c as CardColor) : '';
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  return cleaned || `id-${Date.now()}`;
}

function rethrowFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isFirestoreQuotaError(error)) {
    markCloudQuotaExhausted();
    throw error instanceof Error ? error : createQuotaExceededError(String(error));
  }
  handleFirestoreError(error, operationType, path);
}

const syncedAccountSignatureByUid = new Map<string, string>();
const syncedFolderSnapshotByUid = new Map<string, Map<string, string>>();
const syncedDeckSnapshotByUid = new Map<string, Map<string, string>>();

function getUidSnapshotMap(store: Map<string, Map<string, string>>, uid: string): Map<string, string> {
  let map = store.get(uid);
  if (!map) {
    map = new Map<string, string>();
    store.set(uid, map);
  }
  return map;
}

function serializeFolderSnapshot(name: string, color: string): string {
  return JSON.stringify([name, color]);
}

function serializeDeckSnapshot(
  name: string,
  format: GameFormat,
  archetype: string,
  folderId: string,
  category: string,
  updatedAt: string,
  entries: Array<{ cardId: string; quantity: number }>
): string {
  return JSON.stringify([name, format, archetype, folderId, category, updatedAt, entries]);
}

export async function syncUserAccountsOnSignIn(user: User): Promise<void> {
  if (!user?.uid || !user.emailVerified || isCloudQuotaCooldownActive()) return;
  const uid = user.uid;
  const displayName = (
    user.displayName?.trim() ||
    user.email?.split('@')[0]?.trim() ||
    'Card Battler'
  ).slice(0, 60);
  const photoURL = (user.photoURL || '').slice(0, 500);
  const email = (user.email || '').trim().slice(0, 254);
  if (email.length < 3) return;

  const accountSig = `${email}|${displayName}|${photoURL}`;
  if (syncedAccountSignatureByUid.get(uid) === accountSig) {
    return;
  }

  const userRef = doc(db, 'users', uid);
  const profileRef = doc(db, 'publicProfiles', uid);

  let currentOp: OperationType = OperationType.GET;
  try {
    const existingUser = await getDoc(userRef);
    if (existingUser.exists()) {
      const existingData = existingUser.data();
      const unchanged =
        String(existingData.email || '') === email &&
        String(existingData.displayName || '') === displayName &&
        String(existingData.photoURL || '') === photoURL;
      if (!unchanged) {
        currentOp = OperationType.UPDATE;
        await guardFirestoreWrite(() =>
          updateDoc(userRef, {
            email,
            displayName,
            photoURL,
            updatedAt: serverTimestamp(),
          })
        );
      }
    } else {
      currentOp = OperationType.CREATE;
      await guardFirestoreWrite(() =>
        setDoc(userRef, {
          uid,
          email,
          displayName,
          photoURL,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
  } catch (error) {
    rethrowFirestoreError(error, currentOp, `users/${uid}`);
  }

  let profileOp: OperationType = OperationType.GET;
  try {
    const existingProfile = await getDoc(profileRef);
    if (existingProfile.exists()) {
      const existingProf = existingProfile.data();
      const unchanged =
        String(existingProf.displayName || '') === displayName &&
        String(existingProf.photoURL || '') === photoURL;
      if (!unchanged) {
        profileOp = OperationType.UPDATE;
        await guardFirestoreWrite(() =>
          updateDoc(profileRef, {
            displayName,
            photoURL,
            updatedAt: serverTimestamp(),
          })
        );
      }
    } else {
      profileOp = OperationType.CREATE;
      await guardFirestoreWrite(() =>
        setDoc(profileRef, {
          uid,
          displayName,
          photoURL,
          bio: 'Battle Spirits deck architect & tournament contender.',
          favoriteColor: 'Red',
          followersCount: 0,
          isPublic: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    syncedAccountSignatureByUid.set(uid, accountSig);
  } catch (error) {
    rethrowFirestoreError(error, profileOp, `publicProfiles/${uid}`);
  }
}

export async function fetchUserCloudLibrary(uid: string): Promise<{
  folders: DeckFolder[];
  decks: Deck[];
}> {
  if (!uid) return { folders: [], decks: [] };
  if (isCloudQuotaCooldownActive()) {
    throw createQuotaExceededError();
  }

  const foldersPath = `users/${uid}/folders`;
  const decksPath = `users/${uid}/decks`;
  let folders: DeckFolder[] = [];
  let decks: Deck[] = [];
  const folderSnapshots = getUidSnapshotMap(syncedFolderSnapshotByUid, uid);
  const deckSnapshots = getUidSnapshotMap(syncedDeckSnapshotByUid, uid);

  try {
    const foldersSnap = await getDocs(
      query(collection(db, foldersPath), where('ownerUid', '==', uid))
    );
    folderSnapshots.clear();
    folders = foldersSnap.docs.map((snap) => {
      const d = snap.data();
      const folderId = sanitizeId(String(d.id || snap.id));
      const safeName = String(d.name || 'Untitled Folder').trim().slice(0, 80) || 'Folder';
      const safeColor = VALID_COLORS.includes(d.color) ? (d.color as CardColor) : undefined;
      folderSnapshots.set(folderId, serializeFolderSnapshot(safeName, safeColor || ''));
      return {
        id: String(d.id || snap.id),
        name: String(d.name || 'Untitled Folder'),
        color: safeColor,
        createdAt: String(d.clientCreatedAt || new Date().toISOString().slice(0, 10)),
      };
    });
  } catch (error) {
    rethrowFirestoreError(error, OperationType.LIST, foldersPath);
  }

  try {
    const decksSnap = await getDocs(
      query(collection(db, decksPath), where('ownerUid', '==', uid))
    );
    deckSnapshots.clear();
    decks = decksSnap.docs.map((snap) => {
      const d = snap.data();
      const deckId = sanitizeId(String(d.id || snap.id));
      const entries: DeckEntry[] = Array.isArray(d.entries)
        ? d.entries
            .filter((e: any) => e && typeof e.cardId === 'string')
            .map((e: any) => ({
              cardId: String(e.cardId),
              quantity: Math.max(1, Math.min(20, Math.round(Number(e.quantity) || 1))),
            }))
        : [];
      const safeName = String(d.name || 'Untitled Deck').trim().slice(0, 100) || 'Deck';
      const safeFmt: GameFormat = d.format === 'Standard' ? 'Standard' : 'Eternal';
      const safeArch = String(d.archetype || '').trim().slice(0, 100);
      const safeFolderId = String(d.folderId || '').trim().slice(0, 128);
      const safeCat = String(d.category || '').trim().slice(0, 80);
      const safeUpdated = String(d.clientUpdatedAt || new Date().toISOString().slice(0, 10)).slice(0, 40);
      const cleanEntries = entries.slice(0, 100).map((e) => ({
        cardId: String(e.cardId).slice(0, 128),
        quantity: e.quantity,
      }));
      deckSnapshots.set(
        deckId,
        serializeDeckSnapshot(safeName, safeFmt, safeArch, safeFolderId, safeCat, safeUpdated, cleanEntries)
      );

      return {
        id: String(d.id || snap.id),
        name: String(d.name || 'Untitled Deck'),
        format: safeFmt,
        archetype: String(d.archetype || 'Custom Build'),
        ...(typeof d.folderId === 'string' && d.folderId ? { folderId: d.folderId } : {}),
        ...(typeof d.category === 'string' && d.category ? { category: d.category } : {}),
        updatedAt: safeUpdated,
        entries,
      };
    });
  } catch (error) {
    rethrowFirestoreError(error, OperationType.LIST, decksPath);
  }

  return { folders, decks };
}

export async function syncAllDecksAndFoldersToCloud(
  uid: string,
  folders: DeckFolder[],
  decks: Deck[],
  options?: { force?: boolean }
): Promise<void> {
  if (!uid) return;
  if (isCloudQuotaCooldownActive()) {
    if (options?.force) {
      throw createQuotaExceededError();
    }
    return;
  }

  const folderSnapshots = getUidSnapshotMap(syncedFolderSnapshotByUid, uid);
  const deckSnapshots = getUidSnapshotMap(syncedDeckSnapshotByUid, uid);

  for (const folder of folders) {
    if (isCloudQuotaCooldownActive()) {
      throw createQuotaExceededError();
    }
    const folderId = sanitizeId(folder.id);
    const colorVal = sanitizeOptionalColor(folder.color);
    const safeName = (folder.name || 'Untitled Folder').trim().slice(0, 80) || 'Folder';
    const nextSig = serializeFolderSnapshot(safeName, colorVal);

    if (!options?.force && folderSnapshots.get(folderId) === nextSig) {
      continue;
    }

    const path = `users/${uid}/folders/${folderId}`;
    const ref = doc(db, path);
    try {
      if (folderSnapshots.has(folderId)) {
        try {
          await guardFirestoreWrite(() =>
            updateDoc(ref, {
              name: safeName,
              color: colorVal,
              updatedAt: serverTimestamp(),
            })
          );
          folderSnapshots.set(folderId, nextSig);
          continue;
        } catch (updateErr) {
          const code = typeof updateErr === 'object' && updateErr !== null && 'code' in updateErr
            ? String((updateErr as { code?: unknown }).code || '')
            : '';
          if (code !== 'not-found') {
            throw updateErr;
          }
        }
      }

      const snap = await getDoc(ref);
      if (snap.exists()) {
        const existing = snap.data();
        const unchanged =
          String(existing.name || '') === safeName &&
          String(existing.color || '') === colorVal;
        if (!unchanged) {
          await guardFirestoreWrite(() =>
            updateDoc(ref, {
              name: safeName,
              color: colorVal,
              updatedAt: serverTimestamp(),
            })
          );
        }
      } else {
        await guardFirestoreWrite(() =>
          setDoc(ref, {
            id: folderId,
            ownerUid: uid,
            name: safeName,
            color: colorVal,
            clientCreatedAt: (folder.createdAt || new Date().toISOString().slice(0, 10)).slice(0, 40),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
      folderSnapshots.set(folderId, nextSig);
    } catch (error) {
      rethrowFirestoreError(error, OperationType.WRITE, path);
    }
  }

  for (const deck of decks) {
    if (isCloudQuotaCooldownActive()) {
      throw createQuotaExceededError();
    }
    const deckId = sanitizeId(deck.id);
    const cleanEntries = (deck.entries || [])
      .filter((e) => e && e.cardId && e.quantity > 0)
      .slice(0, 100)
      .map((e) => ({
        cardId: String(e.cardId).slice(0, 128),
        quantity: Math.max(1, Math.min(20, Math.round(Number(e.quantity) || 1))),
      }));

    const safeName = (deck.name || 'Untitled Deck').trim().slice(0, 100) || 'Deck';
    const safeFmt: GameFormat = deck.format === 'Standard' ? 'Standard' : 'Eternal';
    const safeArch = (deck.archetype || '').trim().slice(0, 100);
    const safeFolderId = (deck.folderId || '').trim().slice(0, 128);
    const safeCat = (deck.category || '').trim().slice(0, 80);
    const safeUpdated = (deck.updatedAt || new Date().toISOString().slice(0, 10)).slice(0, 40);
    const nextSig = serializeDeckSnapshot(
      safeName,
      safeFmt,
      safeArch,
      safeFolderId,
      safeCat,
      safeUpdated,
      cleanEntries
    );

    if (!options?.force && deckSnapshots.get(deckId) === nextSig) {
      continue;
    }

    const path = `users/${uid}/decks/${deckId}`;
    const ref = doc(db, path);
    try {
      if (deckSnapshots.has(deckId)) {
        try {
          await guardFirestoreWrite(() =>
            updateDoc(ref, {
              name: safeName,
              format: safeFmt,
              archetype: safeArch,
              folderId: safeFolderId,
              category: safeCat,
              clientUpdatedAt: safeUpdated,
              entries: cleanEntries,
              updatedAt: serverTimestamp(),
            })
          );
          deckSnapshots.set(deckId, nextSig);
          continue;
        } catch (updateErr) {
          const code = typeof updateErr === 'object' && updateErr !== null && 'code' in updateErr
            ? String((updateErr as { code?: unknown }).code || '')
            : '';
          if (code !== 'not-found') {
            throw updateErr;
          }
        }
      }

      const snap = await getDoc(ref);
      if (snap.exists()) {
        const existing = snap.data();
        const existingEntries = Array.isArray(existing.entries)
          ? existing.entries.map((e: any) => ({
              cardId: String(e?.cardId || ''),
              quantity: Number(e?.quantity || 0),
            }))
          : [];
        const unchanged =
          String(existing.name || '') === safeName &&
          String(existing.format || 'Eternal') === safeFmt &&
          String(existing.archetype || '') === safeArch &&
          String(existing.folderId || '') === safeFolderId &&
          String(existing.category || '') === safeCat &&
          String(existing.clientUpdatedAt || '') === safeUpdated &&
          JSON.stringify(existingEntries) === JSON.stringify(cleanEntries);
        if (!unchanged) {
          await guardFirestoreWrite(() =>
            updateDoc(ref, {
              name: safeName,
              format: safeFmt,
              archetype: safeArch,
              folderId: safeFolderId,
              category: safeCat,
              clientUpdatedAt: safeUpdated,
              entries: cleanEntries,
              updatedAt: serverTimestamp(),
            })
          );
        }
      } else {
        await guardFirestoreWrite(() =>
          setDoc(ref, {
            id: deckId,
            ownerUid: uid,
            name: safeName,
            format: safeFmt,
            archetype: safeArch,
            folderId: safeFolderId,
            category: safeCat,
            clientUpdatedAt: safeUpdated,
            entries: cleanEntries,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
      deckSnapshots.set(deckId, nextSig);
    } catch (error) {
      rethrowFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function deleteCloudDeck(uid: string, deckId: string): Promise<void> {
  if (isCloudQuotaCooldownActive()) return;
  const safeId = sanitizeId(deckId);
  const path = `users/${uid}/decks/${safeId}`;
  try {
    await guardFirestoreWrite(() => deleteDoc(doc(db, path)));
    syncedDeckSnapshotByUid.get(uid)?.delete(safeId);
  } catch (error) {
    rethrowFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteCloudFolder(uid: string, folderId: string): Promise<void> {
  if (isCloudQuotaCooldownActive()) return;
  const safeId = sanitizeId(folderId);
  const path = `users/${uid}/folders/${safeId}`;
  try {
    await guardFirestoreWrite(() => deleteDoc(doc(db, path)));
    syncedFolderSnapshotByUid.get(uid)?.delete(safeId);
  } catch (error) {
    rethrowFirestoreError(error, OperationType.DELETE, path);
  }
}
