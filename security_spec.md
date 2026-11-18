# Firestore Security Specification

## 1. Data Invariants
1. **Strict PII Isolation**: User `email` is stored only in `/users/{userId}` and is strictly readable and writable only when `request.auth.uid == userId`. `/publicProfiles/{userId}`, `/posts/{postId}`, and `/posts/{postId}/comments/{commentId}` never store emails.
2. **Private Deck & Folder Ownership**: Every document in `/users/{userId}/folders/{folderId}`, `/users/{userId}/decks/{deckId}`, and `/users/{userId}/bookmarks/{postId}` requires `request.auth.uid == userId`, verified email (`request.auth.token.email_verified == true`) for writes, and `ownerUid == request.auth.uid`.
3. **Public Community Readability Without Blanket Reads**: `/posts/{postId}` and `/publicProfiles/{userId}` enforce `resource.data.isPublic == true` on `get` and `list` so unauthenticated/authenticated readers only query public community items without `if true;` blanket rules.
4. **Atomic Counter Synchronization (`existsAfter`)**:
   - Creating or deleting `/posts/{postId}/likes/{userId}` requires a batched update to `/posts/{postId}` (`likesCount` incremented/decremented by 1) verified with `existsAfter` / `getAfter`.
   - Creating a `/posts/{postId}/comments/{commentId}` requires a batched increment to `/posts/{postId}.commentsCount` verified with `existsAfter` / `getAfter`.
   - Creating or deleting `/publicProfiles/{userId}/followers/{followerId}` requires a batched update to `/publicProfiles/{userId}.followersCount` verified with `existsAfter` / `getAfter`.
5. **Immutable Identity & Server Timestamps**: `createdAt`, `authorUid`, `ownerUid`, and `id` cannot be forged on creation (`== request.time` / `== request.auth.uid`) or altered on update.
6. **Volumetric & Array Bounds**: Every string check pairs with `.size()`, document IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128`), and arrays (`entries`, `colors`, `tags`) enforce `size() <= MAX`.

## 2. Adversarial "Dirty Dozen" Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unverified Email Write**: Creating `/posts/p1` with `request.auth.token.email_verified == false`.
2. **Identity Spoofing on Post**: Creating `/posts/p2` with `authorUid: "victim_uid"` while signed in as `"attacker_uid"`.
3. **Ghost Field Shadow Update**: Updating `/posts/p1` adding `"isFeaturedAdmin": true` (blocked by strict `keys().hasOnly(...)` and `affectedKeys().hasOnly(...)`).
4. **Unauthorized Profile PII Scrape**: Reading `/users/victim_uid` as `"attacker_uid"`.
5. **Private Deck Tampering**: Creating or updating `/users/victim_uid/decks/d1` as `"attacker_uid"`.
6. **Fake Counter Inflation**: Updating `/posts/p1` incrementing `likesCount` by `+500` directly without a corresponding `posts/p1/likes/{uid}` atomic batch.
7. **Other User's Like Deletion**: Deleting `/posts/p1/likes/victim_uid` as `"attacker_uid"`.
8. **Invalid ID Poisoning**: Creating `/posts/../../bad` or a 500-char ID string (blocked by `isValidId`).
9. **Oversized Summary DoS**: Submitting `/posts/p3` with a 50,000-character `summary` string (blocked by `<= 2000`).
10. **Client Timestamp Backdating**: Creating `/posts/p4` with `createdAt: Timestamp.fromDate(new Date('2020-01-01'))` instead of `serverTimestamp()` (`== request.time`).
11. **Non-Author Post Edit**: Updating `/posts/p1.title` or deleting `/posts/p1` as `"other_user"`.
12. **PII Injection into Public Profile**: Creating `/publicProfiles/u1` with an extra `email` field (blocked by `keys().hasOnly(...)`).
