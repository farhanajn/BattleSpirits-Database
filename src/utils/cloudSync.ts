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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
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
  CommunityComment,
  CommunityDeckEntry,
  CommunityPost,
  CommunityPostType,
  EventTier,
  PublicBuilderProfile,
  TournamentPlacement,
} from '../types/social';

import {
  clearCloudQuotaCooldown,
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

function sanitizeColor(c: unknown, fallback: CardColor = 'Red'): CardColor {
  return VALID_COLORS.includes(c as CardColor) ? (c as CardColor) : fallback;
}

function sanitizeOptionalColor(c: unknown): CardColor | '' {
  return VALID_COLORS.includes(c as CardColor) ? (c as CardColor) : '';
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  return cleaned || `id-${Date.now()}`;
}

function toTimestampMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as any).toMillis === 'function') {
    return (val as any).toMillis();
  }
  return Date.now();
}

function createQuotaExceededError(message = 'Quota limit exceeded. Daily free-tier limit reached.'): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = 'resource-exhausted';
  return err;
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
        await updateDoc(userRef, {
          email,
          displayName,
          photoURL,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      currentOp = OperationType.CREATE;
      await setDoc(userRef, {
        uid,
        email,
        displayName,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
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
        await updateDoc(profileRef, {
          displayName,
          photoURL,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      profileOp = OperationType.CREATE;
      await setDoc(profileRef, {
        uid,
        displayName,
        photoURL,
        bio: 'Battle Spirits deck architect & tournament contender.',
        favoriteColor: 'Red',
        followersCount: 0,
        isPublic: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
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
  if (!options?.force && isCloudQuotaCooldownActive()) return;

  const folderSnapshots = getUidSnapshotMap(syncedFolderSnapshotByUid, uid);
  const deckSnapshots = getUidSnapshotMap(syncedDeckSnapshotByUid, uid);

  for (const folder of folders) {
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
          await updateDoc(ref, {
            name: safeName,
            color: colorVal,
            updatedAt: serverTimestamp(),
          });
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
          await updateDoc(ref, {
            name: safeName,
            color: colorVal,
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        await setDoc(ref, {
          id: folderId,
          ownerUid: uid,
          name: safeName,
          color: colorVal,
          clientCreatedAt: (folder.createdAt || new Date().toISOString().slice(0, 10)).slice(0, 40),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      folderSnapshots.set(folderId, nextSig);
    } catch (error) {
      rethrowFirestoreError(error, OperationType.WRITE, path);
    }
  }

  for (const deck of decks) {
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
          await updateDoc(ref, {
            name: safeName,
            format: safeFmt,
            archetype: safeArch,
            folderId: safeFolderId,
            category: safeCat,
            clientUpdatedAt: safeUpdated,
            entries: cleanEntries,
            updatedAt: serverTimestamp(),
          });
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
          await updateDoc(ref, {
            name: safeName,
            format: safeFmt,
            archetype: safeArch,
            folderId: safeFolderId,
            category: safeCat,
            clientUpdatedAt: safeUpdated,
            entries: cleanEntries,
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        await setDoc(ref, {
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
        });
      }
      deckSnapshots.set(deckId, nextSig);
    } catch (error) {
      rethrowFirestoreError(error, OperationType.WRITE, path);
    }
  }

  if (options?.force) {
    clearCloudQuotaCooldown();
  }
}

export async function deleteCloudDeck(uid: string, deckId: string): Promise<void> {
  if (isCloudQuotaCooldownActive()) return;
  const safeId = sanitizeId(deckId);
  const path = `users/${uid}/decks/${safeId}`;
  try {
    await deleteDoc(doc(db, path));
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
    await deleteDoc(doc(db, path));
    syncedFolderSnapshotByUid.get(uid)?.delete(safeId);
  } catch (error) {
    rethrowFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchCommunityPosts(): Promise<CommunityPost[]> {
  const path = 'posts';
  try {
    const snap = await getDocs(
      query(collection(db, path), where('isPublic', '==', true))
    );
    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      const colorsList = Array.isArray(d.colors)
        ? d.colors.filter((c: any): c is CardColor => VALID_COLORS.includes(c))
        : [];
      return {
        id: String(d.id || docSnap.id),
        authorUid: String(d.authorUid || ''),
        authorName: String(d.authorName || 'Player'),
        authorPhoto: String(d.authorPhoto || ''),
        postType: d.postType === 'tournament' ? 'tournament' : 'deck',
        title: String(d.title || 'Shared Deck'),
        summary: String(d.summary || ''),
        deckName: String(d.deckName || 'Deck'),
        format: d.format === 'Standard' ? 'Standard' : 'Eternal',
        archetype: String(d.archetype || ''),
        primaryColor: sanitizeColor(d.primaryColor, 'Red'),
        colors: colorsList.length > 0 ? colorsList : ['Red'],
        cardCount: Number(d.cardCount) || 0,
        featuredCardId: String(d.featuredCardId || ''),
        entries: Array.isArray(d.entries) ? (d.entries as CommunityDeckEntry[]) : [],
        eventName: String(d.eventName || ''),
        eventTier: (d.eventTier || '') as EventTier,
        placement: (d.placement || '') as TournamentPlacement,
        record: String(d.record || ''),
        mvpCardId: String(d.mvpCardId || ''),
        mvpCardName: String(d.mvpCardName || ''),
        tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
        likesCount: Number(d.likesCount) || 0,
        commentsCount: Number(d.commentsCount) || 0,
        lastCommentId: String(d.lastCommentId || ''),
        importsCount: Number(d.importsCount) || 0,
        isPublic: true,
        createdAtMs: toTimestampMs(d.createdAt),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchPublicProfiles(): Promise<Record<string, PublicBuilderProfile>> {
  const path = 'publicProfiles';
  try {
    const snap = await getDocs(
      query(collection(db, path), where('isPublic', '==', true))
    );
    const map: Record<string, PublicBuilderProfile> = {};
    snap.docs.forEach((docSnap) => {
      const d = docSnap.data();
      const uid = String(d.uid || docSnap.id);
      map[uid] = {
        uid,
        displayName: String(d.displayName || 'Player'),
        photoURL: String(d.photoURL || ''),
        bio: String(d.bio || ''),
        favoriteColor: sanitizeColor(d.favoriteColor, 'Red'),
        followersCount: Number(d.followersCount) || 0,
        isPublic: true,
      };
    });
    return map;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchUserBookmarks(uid: string): Promise<string[]> {
  const path = `users/${uid}/bookmarks`;
  try {
    const snap = await getDocs(
      query(collection(db, path), where('ownerUid', '==', uid))
    );
    return snap.docs.map((d) => String(d.data().postId || d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function checkIsLikedByUser(postId: string, uid: string): Promise<boolean> {
  const path = `posts/${postId}/likes/${uid}`;
  try {
    const snap = await getDoc(doc(db, path));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function checkIsFollowingBuilder(targetUid: string, followerUid: string): Promise<boolean> {
  const path = `publicProfiles/${targetUid}/followers/${followerUid}`;
  try {
    const snap = await getDoc(doc(db, path));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function publishCommunityPost(
  user: User,
  input: {
    postType: CommunityPostType;
    title: string;
    summary: string;
    deckName: string;
    format: GameFormat;
    archetype: string;
    primaryColor: CardColor;
    colors: CardColor[];
    featuredCardId: string;
    entries: CommunityDeckEntry[];
    eventName?: string;
    eventTier?: EventTier;
    placement?: TournamentPlacement;
    record?: string;
    mvpCardId?: string;
    mvpCardName?: string;
    tags?: string[];
  }
): Promise<CommunityPost> {
  const postId = `post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const path = `posts/${postId}`;

  const safeEntries = input.entries
    .filter((e) => e && e.cardId && e.quantity > 0)
    .slice(0, 100)
    .map((e) => ({
      cardId: String(e.cardId).slice(0, 128),
      cardNumber: String(e.cardNumber || '').slice(0, 40),
      name: String(e.name || 'Card').slice(0, 120),
      color: sanitizeColor(e.color, input.primaryColor),
      type: e.type,
      cost: Math.max(0, Math.round(Number(e.cost) || 0)),
      quantity: Math.max(1, Math.min(20, Math.round(Number(e.quantity) || 1))),
      isRevival: Boolean(e.isRevival),
    }));

  const cardCount = Math.max(
    1,
    Math.min(
      120,
      safeEntries.reduce((sum, e) => sum + e.quantity, 0)
    )
  );

  const safeColors = Array.from(
    new Set(input.colors.filter((c) => VALID_COLORS.includes(c)))
  ).slice(0, 6);
  if (safeColors.length === 0) safeColors.push(input.primaryColor);

  const safeTags = (input.tags || [])
    .map((t) => t.trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, 6);

  const payload = {
    id: postId,
    authorUid: user.uid,
    authorName: (user.displayName || user.email?.split('@')[0] || 'Card Battler').trim().slice(0, 60),
    authorPhoto: (user.photoURL || '').slice(0, 500),
    postType: input.postType,
    title: input.title.trim().slice(0, 120) || input.deckName.trim().slice(0, 120),
    summary: input.summary.trim().slice(0, 2000),
    deckName: input.deckName.trim().slice(0, 100),
    format: input.format,
    archetype: (input.archetype || '').trim().slice(0, 100),
    primaryColor: sanitizeColor(input.primaryColor, 'Red'),
    colors: safeColors,
    cardCount,
    featuredCardId: (input.featuredCardId || safeEntries[0]?.cardId || '').slice(0, 128),
    entries: safeEntries,
    eventName: (input.eventName || '').trim().slice(0, 120),
    eventTier: (input.eventTier || '') as EventTier,
    placement: (input.placement || '') as TournamentPlacement,
    record: (input.record || '').trim().slice(0, 24),
    mvpCardId: (input.mvpCardId || '').slice(0, 128),
    mvpCardName: (input.mvpCardName || '').slice(0, 120),
    tags: safeTags,
    likesCount: 0,
    commentsCount: 0,
    lastCommentId: '',
    importsCount: 0,
    isPublic: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, path), payload);
    return {
      ...payload,
      createdAtMs: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCommunityPost(postId: string): Promise<void> {
  const path = `posts/${postId}`;
  try {
    await deleteDoc(doc(db, path));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function togglePostLike(
  userId: string,
  postId: string,
  currentlyLiked: boolean,
  currentLikesCount: number
): Promise<number> {
  const postRef = doc(db, 'posts', postId);
  const likeRef = doc(db, 'posts', postId, 'likes', userId);
  const nextCount = currentlyLiked ? Math.max(0, currentLikesCount - 1) : currentLikesCount + 1;

  try {
    const batch = writeBatch(db);
    if (currentlyLiked) {
      batch.delete(likeRef);
    } else {
      batch.set(likeRef, {
        userId,
        postId,
        createdAt: serverTimestamp(),
      });
    }
    batch.update(postRef, {
      likesCount: nextCount,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return nextCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `posts/${postId}/likes/${userId}`);
  }
}

export async function togglePostBookmark(
  userId: string,
  postId: string,
  currentlyBookmarked: boolean
): Promise<void> {
  const path = `users/${userId}/bookmarks/${postId}`;
  const ref = doc(db, path);
  try {
    if (currentlyBookmarked) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, {
        postId,
        ownerUid: userId,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function incrementPostImportCount(
  postId: string,
  currentCount: number
): Promise<void> {
  const path = `posts/${postId}`;
  try {
    await updateDoc(doc(db, path), {
      importsCount: currentCount + 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchPostComments(postId: string): Promise<CommunityComment[]> {
  const path = `posts/${postId}/comments`;
  try {
    const snap = await getDocs(
      query(collection(db, path), where('postId', '==', postId))
    );
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          postId: String(data.postId || postId),
          authorUid: String(data.authorUid || ''),
          authorName: String(data.authorName || 'Player'),
          authorPhoto: String(data.authorPhoto || ''),
          text: String(data.text || ''),
          createdAtMs: toTimestampMs(data.createdAt),
        };
      })
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function addPostComment(
  user: User,
  postId: string,
  currentCommentsCount: number,
  text: string
): Promise<CommunityComment> {
  const commentId = `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const postRef = doc(db, 'posts', postId);
  const commentRef = doc(db, 'posts', postId, 'comments', commentId);
  const cleanText = text.trim().slice(0, 500);
  const authorName = (user.displayName || user.email?.split('@')[0] || 'Card Battler')
    .trim()
    .slice(0, 60);
  const authorPhoto = (user.photoURL || '').slice(0, 500);

  try {
    const batch = writeBatch(db);
    batch.set(commentRef, {
      id: commentId,
      postId,
      authorUid: user.uid,
      authorName,
      authorPhoto,
      text: cleanText,
      createdAt: serverTimestamp(),
    });
    batch.update(postRef, {
      commentsCount: currentCommentsCount + 1,
      lastCommentId: commentId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return {
      id: commentId,
      postId,
      authorUid: user.uid,
      authorName,
      authorPhoto,
      text: cleanText,
      createdAtMs: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `posts/${postId}/comments/${commentId}`);
  }
}

export async function toggleFollowBuilder(
  followerUid: string,
  targetUid: string,
  currentlyFollowing: boolean,
  currentFollowersCount: number
): Promise<number> {
  const profileRef = doc(db, 'publicProfiles', targetUid);
  const followerRef = doc(db, 'publicProfiles', targetUid, 'followers', followerUid);
  const nextCount = currentlyFollowing
    ? Math.max(0, currentFollowersCount - 1)
    : currentFollowersCount + 1;

  try {
    const batch = writeBatch(db);
    if (currentlyFollowing) {
      batch.delete(followerRef);
    } else {
      batch.set(followerRef, {
        followerUid,
        targetUid,
        createdAt: serverTimestamp(),
      });
    }
    batch.update(profileRef, {
      followersCount: nextCount,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return nextCount;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `publicProfiles/${targetUid}/followers/${followerUid}`
    );
  }
}
