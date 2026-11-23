import { type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  BattleSpiritsCard,
  CardColor,
  CardType,
  GameFormat,
  ProductSet,
} from '../types/card';
import {
  normalizeCardColors,
  normalizeCardCost,
  normalizeCardFamilies,
  normalizeCardForCatalog,
  normalizeCardTypes,
} from './cardFilterNormalization';

export interface ClientArtworkValidationRecord {
  mappingKey: string;
  cardId: string;
  cardName: string;
  cardNumber: string;
  setCode: string;
  mappingType: 'direct_url' | 'wiki_file' | 'wiki_title';
  originalUrl: string;
  wikiTitle: string;
  fileName: string;
  status: 'healthy' | 'broken' | 'redirected' | 'unverified' | 'temporarily_unavailable';
  httpStatus: number;
  finalUrl: string;
  redirectedFrom?: string;
  lastCheckedAt: string;
  lastSuccessAt: string;
  consecutiveFailures: number;
  failureReason: string;
  lastCycleId: string;
}

export type FirestoreDiagnosticCategory =
  | 'permission_failure'
  | 'temporary_retryable'
  | 'database_write_failure'
  | 'invalid_or_unsafe'
  | 'unexpected_error';

export interface FirestoreSyncFailureDetail {
  id: string;
  entityType: 'set' | 'card';
  error: string;
  diagnosticCategory: FirestoreDiagnosticCategory;
  recoverable: boolean;
  recommendedAction: string;
}

export interface PublishCatalogResult {
  pushedSets: number;
  pushedCards: number;
  failedSets: Array<{
    setCode: string;
    error: string;
    diagnosticCategory?: FirestoreDiagnosticCategory;
    recoverable?: boolean;
    recommendedAction?: string;
  }>;
  failedCards: Array<{
    cardId: string;
    error: string;
    diagnosticCategory?: FirestoreDiagnosticCategory;
    recoverable?: boolean;
    recommendedAction?: string;
  }>;
  failures: FirestoreSyncFailureDetail[];
}

export interface SyncValidationResult {
  syncedCount: number;
  failedKeys: Array<{ mappingKey: string; error: string }>;
}

const VALID_COLORS: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];
const VALID_TYPES: CardType[] = ['Spirit', 'Ultimate', 'Brave', 'Nexus', 'Magic'];
const VALID_FORMATS: GameFormat[] = ['Standard', 'Eternal'];
const VALID_SET_CATEGORIES = new Set<string>([
  'Booster',
  'Standard Booster',
  'Starter Deck',
  'Standard Starter',
  'Collab Booster',
  'Supplementary',
  'Premium Bandai',
  'Premium Card Set',
  'Promo',
  'Token',
  'Revival',
]);
export const ADMIN_EMAILS = new Set(['farhana.jn2000@gmail.com']);
const BATCH_CHUNK_SIZE = 200;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  };
}

function logStructuredFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const rawMessage = normalizeErrorMessage(error);
  const errInfo: FirestoreErrorInfo = {
    error: rawMessage,
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
    },
  };
  if (/permission|insufficient|unauthenticated/i.test(rawMessage)) {
    console.error('Firestore Error:', JSON.stringify(errInfo));
  }
  return rawMessage;
}

function classifyFirestoreError(error: unknown): {
  diagnosticCategory: FirestoreDiagnosticCategory;
  recoverable: boolean;
  recommendedAction: string;
  message: string;
} {
  const message = normalizeErrorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes('permission') || lower.includes('insufficient') || lower.includes('unauthenticated')) {
    return {
      diagnosticCategory: 'permission_failure',
      recoverable: true,
      recommendedAction: 'Ensure you are signed in with a verified Admin account and click Retry Cloud Sync.',
      message,
    };
  }
  if (
    lower.includes('unavailable') ||
    lower.includes('deadline-exceeded') ||
    lower.includes('resource-exhausted') ||
    lower.includes('aborted') ||
    lower.includes('offline') ||
    lower.includes('network') ||
    lower.includes('timeout')
  ) {
    return {
      diagnosticCategory: 'temporary_retryable',
      recoverable: true,
      recommendedAction: 'Transient network/Firestore quota issue — click Retry Cloud Sync to retry automatically.',
      message,
    };
  }
  if (lower.includes('invalid-argument') || lower.includes('exceeds') || lower.includes('failed-precondition')) {
    return {
      diagnosticCategory: 'invalid_or_unsafe',
      recoverable: false,
      recommendedAction: 'Inspect document fields for schema bounds (ID/name/payload length) and reprocess.',
      message,
    };
  }
  return {
    diagnosticCategory: 'database_write_failure',
    recoverable: true,
    recommendedAction: 'Retry Cloud Sync; check browser console for full Firestore write trace if persistent.',
    message,
  };
}

async function withTransientFirestoreRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const classified = classifyFirestoreError(err);
      if (classified.diagnosticCategory !== 'temporary_retryable' || attempt === maxAttempts - 1) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
    }
  }
  throw lastErr;
}

function sanitizeFirestoreId(raw: string, fallbackPrefix = 'id', maxLen = 128): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return cleaned || `${fallbackPrefix}-${Date.now()}`.slice(0, maxLen);
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown Firestore error');
}

function normalizeValidFormats(raw: unknown): GameFormat[] {
  const list = Array.isArray(raw)
    ? raw
        .map((f) => String(f || '').trim())
        .filter((f): f is GameFormat => VALID_FORMATS.includes(f as GameFormat))
    : [];
  const unique = Array.from(new Set(list));
  return unique.length > 0 ? unique.slice(0, 4) : ['Eternal'];
}

export async function isVerifiedAdminUser(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email && ADMIN_EMAILS.has(user.email.toLowerCase())) {
    return true;
  }
  try {
    const marker = await getDoc(doc(db, 'admins', user.uid));
    return marker.exists() && marker.data()?.role === 'admin';
  } catch {
    return false;
  }
}

export async function fetchPublishedCatalogAdditions(): Promise<{
  sets: ProductSet[];
  cards: BattleSpiritsCard[];
}> {
  const sets: ProductSet[] = [];
  const cards: BattleSpiritsCard[] = [];

  try {
    const setsSnap = await getDocs(
      query(collection(db, 'catalogSets'), where('isPublished', '==', true))
    );
    for (const d of setsSnap.docs) {
      const data = d.data();
      sets.push({
        setCode: String(data.setCode || d.id),
        name: String(data.name || data.setCode || d.id),
        jpName: String(data.jpName || ''),
        category: String(data.category || 'Supplementary') as ProductSet['category'],
        productType: String(data.productType || 'Supplementary Set') as ProductSet['productType'],
        releaseDate: String(data.releaseDate || ''),
        formats: normalizeValidFormats(data.formats),
        blockLabel: String(data.blockLabel || 'Wiki'),
        tagline: String(data.tagline || ''),
        featuredCardId: String(data.featuredCardId || ''),
        colors: Array.isArray(data.colors)
          ? (data.colors.filter((c) => VALID_COLORS.includes(c)) as CardColor[])
          : [],
        totalCardsInSet: Number(data.totalCardsInSet || 0),
        wikiUrl: String(data.wikiUrl || ''),
        isNumberOnly: Boolean(data.isNumberOnly),
      });
    }
  } catch {
    // Non-fatal on offline or fresh project
  }

  try {
    const cardsSnap = await getDocs(
      query(collection(db, 'catalogCards'), where('isPublished', '==', true))
    );
    for (const d of cardsSnap.docs) {
      const data = d.data();
      if (typeof data.payloadJson === 'string' && data.payloadJson.trim()) {
        try {
          const parsed = JSON.parse(data.payloadJson) as BattleSpiritsCard;
          if (parsed && parsed.id && parsed.name) {
            cards.push(normalizeCardForCatalog(parsed));
            continue;
          }
        } catch {
          // fall back to structured summary fields
        }
      }
      const parsedColors = normalizeCardColors({
        color: data.color,
        secondaryColor: data.secondaryColor,
        colors: data.colors,
      });
      const parsedTypes = normalizeCardTypes({
        type: data.type,
        subtypeLabel: data.subtypeLabel,
      });
      const parsedCost = normalizeCardCost(data.cost);
      cards.push({
        id: String(data.id || d.id),
        cardNumber: String(data.cardNumber || d.id),
        name: String(data.name || d.id),
        jpName: String(data.jpName || ''),
        color: parsedColors[0] || 'Red',
        ...(parsedColors[1] ? { secondaryColor: parsedColors[1] } : {}),
        ...(parsedColors.length > 0 ? { colors: parsedColors } : {}),
        type: parsedTypes[0] || 'Spirit',
        subtypeLabel: data.subtypeLabel ? String(data.subtypeLabel) : undefined,
        rarity: String(data.rarity || 'C') as BattleSpiritsCard['rarity'],
        setCode: String(data.setCode || 'WIKI'),
        setName: String(data.setName || data.setCode || 'Wiki Set'),
        formats: normalizeValidFormats(data.formats),
        blockIcon: String(data.blockIcon || 'Wiki'),
        restriction: String(data.restriction || 'Unlimited') as BattleSpiritsCard['restriction'],
        isRevival: Boolean(data.isRevival),
        isToken: Boolean(data.isToken),
        cost: parsedCost !== null ? parsedCost : Number.NaN,
        reduction: {},
        symbols: {},
        families: normalizeCardFamilies(data.families),
        effects: [],
        keywords: Array.isArray(data.keywords)
          ? data.keywords.map((k: unknown) => String(k || '').trim()).filter(Boolean)
          : [],
        flavorText: '',
        illustrator: '',
        artworkImage: '',
        artVariant: 'dragon',
        wikiUrl: '',
        isWikiLoaded: false,
        rulings: [],
      });
    }
  } catch {
    // Non-fatal on offline or fresh project
  }

  return { sets, cards };
}

function buildCompactCardPayloadJson(card: BattleSpiritsCard, safeId: string): string {
  const baseCard: BattleSpiritsCard = {
    ...card,
    id: safeId,
    effects: (card.effects || []).slice(0, 12),
    rulings: (card.rulings || []).slice(0, 6),
  };
  let json = JSON.stringify(baseCard);
  if (json.length <= 19800) return json;

  json = JSON.stringify({
    ...baseCard,
    rulings: [],
    galleryImages: [],
    flavorText: (baseCard.flavorText || '').slice(0, 300),
    effects: (baseCard.effects || []).slice(0, 6),
  });
  if (json.length <= 19800) return json;

  json = JSON.stringify({
    ...baseCard,
    rulings: [],
    galleryImages: [],
    flavorText: '',
    effects: [],
  });
  return json.length <= 19800 ? json : '';
}

export async function publishCatalogAdditionsToFirestore(
  adminUid: string,
  sets: Array<
    ProductSet & {
      wikiTitle?: string;
      sources?: string[];
      scanStatus?: string;
      discoveredCount?: number;
      existingCount?: number;
      missingCount?: number;
      lastScanAt?: string | null;
    }
  >,
  cards: BattleSpiritsCard[]
): Promise<PublishCatalogResult> {
  const safeAdminUid = sanitizeFirestoreId(adminUid, 'admin');
  let pushedSets = 0;
  let pushedCards = 0;
  const failedSets: PublishCatalogResult['failedSets'] = [];
  const failedCards: PublishCatalogResult['failedCards'] = [];
  const failures: FirestoreSyncFailureDetail[] = [];

  // Pre-fetch ALL existing document IDs (including unpublished docs) so batches know create vs update accurately
  const existingSetIds = new Set<string>();
  const existingCardIds = new Set<string>();
  if (sets.length > 0) {
    try {
      const snap = await withTransientFirestoreRetry(() => getDocs(collection(db, 'catalogSets')));
      for (const d of snap.docs) existingSetIds.add(d.id);
    } catch (err) {
      logStructuredFirestoreError(err, OperationType.LIST, 'catalogSets');
    }
  }
  if (cards.length > 0) {
    try {
      const snap = await withTransientFirestoreRetry(() => getDocs(collection(db, 'catalogCards')));
      for (const d of snap.docs) existingCardIds.add(d.id);
    } catch (err) {
      logStructuredFirestoreError(err, OperationType.LIST, 'catalogCards');
    }
  }

  // Deduplicate by Firestore document ID and enforce 100% firestore.rules schema bounds
  const setEntries: Array<{
    safeCode: string;
    basePayload: Record<string, unknown>;
  }> = [];
  const seenSetCodes = new Set<string>();
  for (const s of sets) {
    const safeCode = sanitizeFirestoreId(s.setCode, 'set', 48);
    if (seenSetCodes.has(safeCode)) continue;
    seenSetCodes.add(safeCode);

    const formats = normalizeValidFormats(s.formats);
    const colors = (s.colors || [])
      .filter((c) => VALID_COLORS.includes(c))
      .slice(0, 6)
      .map((c) => String(c).slice(0, 20));
    const sources = (s.sources && s.sources.length > 0 ? s.sources : ['CatalogSync'])
      .slice(0, 12)
      .map((src) => String(src || 'CatalogSync').slice(0, 120) || 'CatalogSync');
    const safeCategory = VALID_SET_CATEGORIES.has(String(s.category || ''))
      ? String(s.category)
      : 'Supplementary';

    setEntries.push({
      safeCode,
      basePayload: {
        setCode: safeCode,
        wikiTitle: String(s.wikiTitle || s.name || safeCode).slice(0, 200) || safeCode,
        name: String(s.name || safeCode).slice(0, 160) || safeCode,
        jpName: String(s.jpName || '').slice(0, 200),
        category: safeCategory,
        productType: String(s.productType || 'Set').slice(0, 80) || 'Set',
        releaseDate: String(s.releaseDate || '').slice(0, 60),
        formats,
        blockLabel: String(s.blockLabel || 'Wiki').slice(0, 80),
        tagline: String(s.tagline || '').slice(0, 500),
        featuredCardId: String(s.featuredCardId || '').slice(0, 128),
        colors,
        totalCardsInSet: Math.max(0, Math.round(Number(s.totalCardsInSet) || 0)),
        wikiUrl: String(s.wikiUrl || '').slice(0, 500),
        sources,
        isNumberOnly: Boolean(s.isNumberOnly),
        scanStatus: ['pending', 'scanning', 'completed', 'failed'].includes(String(s.scanStatus))
          ? String(s.scanStatus)
          : 'completed',
        discoveredCount: Math.max(0, Math.round(Number(s.discoveredCount) || 0)),
        existingCount: Math.max(0, Math.round(Number(s.existingCount) || 0)),
        missingCount: Math.max(0, Math.round(Number(s.missingCount) || 0)),
        lastScanAt: String(s.lastScanAt || new Date().toISOString()).slice(0, 40),
        isPublished: true,
        updatedByUid: safeAdminUid,
      },
    });
  }

  for (let i = 0; i < setEntries.length; i += BATCH_CHUNK_SIZE) {
    const chunk = setEntries.slice(i, i + BATCH_CHUNK_SIZE);
    const commitChunk = async () => {
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, 'catalogSets', item.safeCode);
        if (existingSetIds.has(item.safeCode)) {
          batch.update(ref, {
            ...item.basePayload,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(ref, {
            ...item.basePayload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    };

    try {
      await withTransientFirestoreRetry(commitChunk);
      for (const item of chunk) existingSetIds.add(item.safeCode);
      pushedSets += chunk.length;
    } catch {
      // Fallback per-doc isolation with retry so one bad doc never aborts the chunk
      for (const item of chunk) {
        const ref = doc(db, 'catalogSets', item.safeCode);
        try {
          await withTransientFirestoreRetry(async () => {
            const existing = await getDoc(ref);
            if (existing.exists()) {
              await updateDoc(ref, {
                ...item.basePayload,
                updatedAt: serverTimestamp(),
              });
            } else {
              await setDoc(ref, {
                ...item.basePayload,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          });
          existingSetIds.add(item.safeCode);
          pushedSets++;
        } catch (err) {
          logStructuredFirestoreError(err, OperationType.WRITE, `catalogSets/${item.safeCode}`);
          const info = classifyFirestoreError(err);
          failedSets.push({
            setCode: item.safeCode,
            error: info.message,
            diagnosticCategory: info.diagnosticCategory,
            recoverable: info.recoverable,
            recommendedAction: info.recommendedAction,
          });
          failures.push({
            id: item.safeCode,
            entityType: 'set',
            error: info.message,
            diagnosticCategory: info.diagnosticCategory,
            recoverable: info.recoverable,
            recommendedAction: info.recommendedAction,
          });
        }
      }
    }
  }

  const cardEntries: Array<{
    safeId: string;
    basePayload: Record<string, unknown>;
  }> = [];
  const seenCardIds = new Set<string>();
  for (const c of cards) {
    const safeId = sanitizeFirestoreId(c.id, 'card', 128);
    if (seenCardIds.has(safeId)) continue;
    seenCardIds.add(safeId);

    const primaryColor: CardColor = VALID_COLORS.includes(c.color) ? c.color : 'Red';
    const secondaryColor: CardColor | '' =
      c.secondaryColor && VALID_COLORS.includes(c.secondaryColor) ? c.secondaryColor : '';
    const colors = (c.colors && c.colors.length > 0 ? c.colors : [primaryColor])
      .filter((col) => VALID_COLORS.includes(col))
      .slice(0, 6);
    const formats = normalizeValidFormats(c.formats);
    const cardType: CardType = VALID_TYPES.includes(c.type) ? c.type : 'Spirit';
    const payloadJson = buildCompactCardPayloadJson(c, safeId);

    cardEntries.push({
      safeId,
      basePayload: {
        id: safeId,
        cardNumber: String(c.cardNumber || safeId).slice(0, 48) || safeId,
        name: String(c.name || c.jpName || safeId).slice(0, 160) || safeId,
        jpName: String(c.jpName || '').slice(0, 200),
        color: primaryColor,
        secondaryColor,
        colors: colors.length > 0 ? colors : [primaryColor],
        type: cardType,
        subtypeLabel: String(c.subtypeLabel || '').slice(0, 80),
        rarity: String(c.rarity || 'C').slice(0, 16) || 'C',
        setCode: String(c.setCode || 'WIKI').slice(0, 48) || 'WIKI',
        setName: String(c.setName || '').slice(0, 200),
        formats,
        blockIcon: String(c.blockIcon || 'Wiki').slice(0, 64),
        restriction: String(c.restriction || 'Unlimited').slice(0, 32),
        isRevival: Boolean(c.isRevival),
        isToken: Boolean(c.isToken),
        cost: Math.max(0, Math.min(99, Math.round(Number(c.cost) || 0))),
        payloadJson,
        sourceTag: String(c.wikiTitle || c.setCode || 'wiki-sync').slice(0, 120),
        missingArtwork: !c.artworkImage && (!c.galleryImages || c.galleryImages.length === 0),
        isPublished: true,
        importedByUid: safeAdminUid,
      },
    });
  }

  for (let i = 0; i < cardEntries.length; i += BATCH_CHUNK_SIZE) {
    const chunk = cardEntries.slice(i, i + BATCH_CHUNK_SIZE);
    const commitChunk = async () => {
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, 'catalogCards', item.safeId);
        if (existingCardIds.has(item.safeId)) {
          batch.update(ref, {
            ...item.basePayload,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(ref, {
            ...item.basePayload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    };

    try {
      await withTransientFirestoreRetry(commitChunk);
      for (const item of chunk) existingCardIds.add(item.safeId);
      pushedCards += chunk.length;
    } catch {
      // Fallback per-doc isolation with transient retry so one bad card never aborts valid cards
      for (const item of chunk) {
        const ref = doc(db, 'catalogCards', item.safeId);
        try {
          await withTransientFirestoreRetry(async () => {
            const existing = await getDoc(ref);
            if (existing.exists()) {
              await updateDoc(ref, {
                ...item.basePayload,
                updatedAt: serverTimestamp(),
              });
            } else {
              await setDoc(ref, {
                ...item.basePayload,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          });
          existingCardIds.add(item.safeId);
          pushedCards++;
        } catch (err) {
          logStructuredFirestoreError(err, OperationType.WRITE, `catalogCards/${item.safeId}`);
          const info = classifyFirestoreError(err);
          failedCards.push({
            cardId: item.safeId,
            error: info.message,
            diagnosticCategory: info.diagnosticCategory,
            recoverable: info.recoverable,
            recommendedAction: info.recommendedAction,
          });
          failures.push({
            id: item.safeId,
            entityType: 'card',
            error: info.message,
            diagnosticCategory: info.diagnosticCategory,
            recoverable: info.recoverable,
            recommendedAction: info.recommendedAction,
          });
        }
      }
    }
  }

  return { pushedSets, pushedCards, failedSets, failedCards, failures };
}

export async function syncValidationRecordsToFirestore(
  records: ClientArtworkValidationRecord[]
): Promise<SyncValidationResult> {
  let syncedCount = 0;
  const failedKeys: Array<{ mappingKey: string; error: string }> = [];

  const entries: Array<{ safeKey: string; payload: Record<string, unknown> }> = [];
  const seenKeys = new Set<string>();

  for (const r of records) {
    const safeKey = sanitizeFirestoreId(r.mappingKey, 'val');
    if (seenKeys.has(safeKey)) continue;
    seenKeys.add(safeKey);

    entries.push({
      safeKey,
      payload: {
        mappingKey: safeKey,
        cardId: String(r.cardId || '').slice(0, 128),
        cardName: String(r.cardName || '').slice(0, 200),
        cardNumber: String(r.cardNumber || '').slice(0, 64),
        setCode: String(r.setCode || '').slice(0, 64),
        mappingType: ['direct_url', 'wiki_file', 'wiki_title'].includes(r.mappingType)
          ? r.mappingType
          : 'wiki_title',
        originalUrl: String(r.originalUrl || '').slice(0, 1000),
        wikiTitle: String(r.wikiTitle || '').slice(0, 200),
        fileName: String(r.fileName || '').slice(0, 250),
        status: ['healthy', 'broken', 'redirected', 'unverified', 'temporarily_unavailable'].includes(
          r.status
        )
          ? r.status
          : 'unverified',
        httpStatus: Math.max(0, Math.min(999, Math.round(Number(r.httpStatus) || 0))),
        finalUrl: String(r.finalUrl || '').slice(0, 1000),
        lastCheckedAt: String(r.lastCheckedAt || '').slice(0, 40),
        lastSuccessAt: String(r.lastSuccessAt || '').slice(0, 40),
        consecutiveFailures: Math.max(0, Math.round(Number(r.consecutiveFailures) || 0)),
        failureReason: String(r.failureReason || '').slice(0, 500),
        lastCycleId: String(r.lastCycleId || '').slice(0, 80),
        updatedAt: serverTimestamp(),
      },
    });
  }

  for (let i = 0; i < entries.length; i += BATCH_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const item of chunk) {
      batch.set(doc(db, 'artworkValidations', item.safeKey), item.payload);
    }

    try {
      await batch.commit();
      syncedCount += chunk.length;
    } catch {
      for (const item of chunk) {
        try {
          await setDoc(doc(db, 'artworkValidations', item.safeKey), item.payload);
          syncedCount++;
        } catch (err) {
          failedKeys.push({
            mappingKey: item.safeKey,
            error: normalizeErrorMessage(err),
          });
        }
      }
    }
  }

  return { syncedCount, failedKeys };
}

export async function fetchValidationRecordsFromFirestore(): Promise<ClientArtworkValidationRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'artworkValidations'));
    const out: ClientArtworkValidationRecord[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      out.push({
        mappingKey: String(data.mappingKey || d.id),
        cardId: String(data.cardId || ''),
        cardName: String(data.cardName || ''),
        cardNumber: String(data.cardNumber || ''),
        setCode: String(data.setCode || ''),
        mappingType: ['direct_url', 'wiki_file', 'wiki_title'].includes(data.mappingType)
          ? (data.mappingType as ClientArtworkValidationRecord['mappingType'])
          : 'wiki_title',
        originalUrl: String(data.originalUrl || ''),
        wikiTitle: String(data.wikiTitle || ''),
        fileName: String(data.fileName || ''),
        status: ['healthy', 'broken', 'redirected', 'unverified', 'temporarily_unavailable'].includes(
          data.status
        )
          ? (data.status as ClientArtworkValidationRecord['status'])
          : 'unverified',
        httpStatus: Math.max(0, Math.min(999, Math.round(Number(data.httpStatus) || 0))),
        finalUrl: String(data.finalUrl || ''),
        lastCheckedAt: String(data.lastCheckedAt || ''),
        lastSuccessAt: String(data.lastSuccessAt || ''),
        consecutiveFailures: Math.max(0, Math.round(Number(data.consecutiveFailures) || 0)),
        failureReason: String(data.failureReason || ''),
        lastCycleId: String(data.lastCycleId || ''),
      });
    }
    return out;
  } catch {
    return [];
  }
}
