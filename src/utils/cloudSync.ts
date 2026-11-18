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

export async function syncUserAccountsOnSignIn(user: User): Promise<void> {
  if (!user?.uid) return;
  const uid = user.uid;
  const displayName = (user.displayName || user.email?.split('@')[0] || 'Card Battler')
    .trim()
    .slice(0, 60);
  const photoURL = (user.photoURL || '').slice(0, 500);
  const email = (user.email || '').slice(0, 254);

  const userRef = doc(db, 'users', uid);
  const profileRef = doc(db, 'publicProfiles', uid);

  try {
    const existingUser = await getDoc(userRef);
    if (existingUser.exists()) {
      await updateDoc(userRef, {
        email,
        displayName,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    } else {
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
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }

  try {
    const existingProfile = await getDoc(profileRef);
    if (existingProfile.exists()) {
      await updateDoc(profileRef, {
        displayName,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    } else {
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
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `publicProfiles/${uid}`);
  }
}

export async function fetchUserCloudLibrary(uid: string): Promise<{
  folders: DeckFolder[];
  decks: Deck[];
}> {
  const foldersPath = `users/${uid}/folders`;
  const decksPath = `users/${uid}/decks`;
  let folders: DeckFolder[] = [];
  let decks: Deck[] = [];

  try {
    const foldersSnap = await getDocs(
      query(collection(db, foldersPath), where('ownerUid', '==', uid))
    );
    folders = foldersSnap.docs.map((snap) => {
      const d = snap.data();
      return {
        id: String(d.id || snap.id),
        name: String(d.name || 'Untitled Folder'),
        color: VALID_COLORS.includes(d.color) ? (d.color as CardColor) : undefined,
        createdAt: String(d.clientCreatedAt || new Date().toISOString().slice(0, 10)),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, foldersPath);
  }

  try {
    const decksSnap = await getDocs(
      query(collection(db, decksPath), where('ownerUid', '==', uid))
    );
    decks = decksSnap.docs.map((snap) => {
      const d = snap.data();
      const entries: DeckEntry[] = Array.isArray(d.entries)
        ? d.entries
            .filter((e: any) => e && typeof e.cardId === 'string')
            .map((e: any) => ({
              cardId: String(e.cardId),
              quantity: Math.max(1, Math.min(20, Math.round(Number(e.quantity) || 1))),
            }))
        : [];
      return {
        id: String(d.id || snap.id),
        name: String(d.name || 'Untitled Deck'),
        format: d.format === 'Standard' ? 'Standard' : 'Eternal',
        archetype: String(d.archetype || 'Custom Build'),
        ...(typeof d.folderId === 'string' && d.folderId ? { folderId: d.folderId } : {}),
        ...(typeof d.category === 'string' && d.category ? { category: d.category } : {}),
        updatedAt: String(d.clientUpdatedAt || new Date().toISOString().slice(0, 10)),
        entries,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, decksPath);
  }

  return { folders, decks };
}

export async function syncAllDecksAndFoldersToCloud(
  uid: string,
  folders: DeckFolder[],
  decks: Deck[]
): Promise<void> {
  if (!uid) return;

  for (const folder of folders) {
    const folderId = sanitizeId(folder.id);
    const path = `users/${uid}/folders/${folderId}`;
    const ref = doc(db, path);
    try {
      const snap = await getDoc(ref);
      const colorVal = sanitizeOptionalColor(folder.color);
      const safeName = (folder.name || 'Untitled Folder').trim().slice(0, 80) || 'Folder';
      if (snap.exists()) {
        await updateDoc(ref, {
          name: safeName,
          color: colorVal,
          updatedAt: serverTimestamp(),
        });
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
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  for (const deck of decks) {
    const deckId = sanitizeId(deck.id);
    const path = `users/${uid}/decks/${deckId}`;
    const ref = doc(db, path);
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

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
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
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function deleteCloudDeck(uid: string, deckId: string): Promise<void> {
  const safeId = sanitizeId(deckId);
  const path = `users/${uid}/decks/${safeId}`;
  try {
    await deleteDoc(doc(db, path));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteCloudFolder(uid: string, folderId: string): Promise<void> {
  const safeId = sanitizeId(folderId);
  const path = `users/${uid}/folders/${safeId}`;
  try {
    await deleteDoc(doc(db, path));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
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

export async function updatePublicProfileBio(
  uid: string,
  bio: string,
  favoriteColor: CardColor
): Promise<void> {
  const path = `publicProfiles/${uid}`;
  try {
    await updateDoc(doc(db, path), {
      bio: bio.trim().slice(0, 240),
      favoriteColor: sanitizeColor(favoriteColor, 'Red'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
