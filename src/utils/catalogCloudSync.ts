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
import { isPlaceholderArtworkUrl } from './cardCompletion';
import {
  isCloudQuotaCooldownActive,
  isCloudWriteCooldownActive,
  isFirestoreQuotaError,
  markCloudQuotaExhausted,
} from './firestoreQuota';

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
  if (isFirestoreQuotaError(error)) {
    return {
      diagnosticCategory: 'database_write_failure',
      recoverable: false,
      recommendedAction:
        'Firestore daily free-tier quota limit reached. Quota resets tomorrow; local catalog data remains intact.',
      message,
    };
  }
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
    lower.includes('aborted') ||
    lower.includes('offline') ||
    lower.includes('network') ||
    lower.includes('timeout')
  ) {
    return {
      diagnosticCategory: 'temporary_retryable',
      recoverable: true,
      recommendedAction: 'Transient network issue — click Retry Cloud Sync to retry automatically.',
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
      if (isFirestoreQuotaError(err)) {
        markCloudQuotaExhausted();
        throw err;
      }
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

const PUBLISHED_CATALOG_CACHE_KEY = 'spiritsdex_published_catalog_cache_v1';
const PUBLISHED_CATALOG_CACHE_TTL_MS = 30 * 60 * 1000;

interface PublishedCatalogCachePayload {
  fetchedAt: number;
  sets: ProductSet[];
  cards: BattleSpiritsCard[];
}

function readPublishedCatalogCache(): PublishedCatalogCachePayload | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PUBLISHED_CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublishedCatalogCachePayload;
    if (!parsed || !Array.isArray(parsed.sets) || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePublishedCatalogCache(sets: ProductSet[], cards: BattleSpiritsCard[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const payload: PublishedCatalogCachePayload = {
      fetchedAt: Date.now(),
      sets,
      cards,
    };
    localStorage.setItem(PUBLISHED_CATALOG_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota/storage errors
  }
}

export function invalidatePublishedCatalogCache(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PUBLISHED_CATALOG_CACHE_KEY);
    }
  } catch {
    // ignore
  }
}

export async function fetchPublishedCatalogAdditions(options?: {
  forceRefresh?: boolean;
}): Promise<{
  sets: ProductSet[];
  cards: BattleSpiritsCard[];
}> {
  const cached = readPublishedCatalogCache();
  if (isCloudQuotaCooldownActive()) {
    return cached ? { sets: cached.sets, cards: cached.cards } : { sets: [], cards: [] };
  }
  if (
    !options?.forceRefresh &&
    cached &&
    Date.now() - cached.fetchedAt < PUBLISHED_CATALOG_CACHE_TTL_MS
  ) {
    return { sets: cached.sets, cards: cached.cards };
  }

  const sets: ProductSet[] = [];
  const cards: BattleSpiritsCard[] = [];
  let hadError = false;

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
  } catch (err) {
    hadError = true;
    if (isFirestoreQuotaError(err)) {
      markCloudQuotaExhausted();
      return cached ? { sets: cached.sets, cards: cached.cards } : { sets: [], cards: [] };
    }
    // Non-fatal on offline or fresh project
  }

  try {
    const cardsSnap = await getDocs(
      query(collection(db, 'catalogCards'), where('isPublished', '==', true))
    );
    const extractDocTimestampIso = (rawTs: unknown): string | undefined => {
      if (!rawTs) return undefined;
      if (typeof rawTs === 'string' && rawTs.trim()) return rawTs.trim();
      if (typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs > 0) {
        return new Date(rawTs).toISOString();
      }
      if (typeof rawTs === 'object') {
        const tsObj = rawTs as { toMillis?: () => number; seconds?: number };
        if (typeof tsObj.toMillis === 'function') {
          const ms = tsObj.toMillis();
          if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
        }
        if (typeof tsObj.seconds === 'number' && Number.isFinite(tsObj.seconds)) {
          return new Date(tsObj.seconds * 1000).toISOString();
        }
      }
      return undefined;
    };

    for (const d of cardsSnap.docs) {
      const data = d.data();
      const docCreatedIso = extractDocTimestampIso(data.createdAt);
      const docImportedIso = extractDocTimestampIso(data.importedAt);
      if (typeof data.payloadJson === 'string' && data.payloadJson.trim()) {
        try {
          const parsed = JSON.parse(data.payloadJson) as BattleSpiritsCard;
          if (parsed && parsed.id && parsed.name) {
            const normalized = normalizeCardForCatalog(parsed);
            if (!normalized.createdAt && docCreatedIso) {
              normalized.createdAt = docCreatedIso;
            }
            if (!normalized.importedAt && docImportedIso) {
              normalized.importedAt = docImportedIso;
            }
            cards.push(normalized);
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
        ...(docCreatedIso ? { createdAt: docCreatedIso } : {}),
        ...(docImportedIso ? { importedAt: docImportedIso } : {}),
        rulings: [],
      });
    }
  } catch (err) {
    hadError = true;
    if (isFirestoreQuotaError(err)) {
      markCloudQuotaExhausted();
      return cached ? { sets: cached.sets, cards: cached.cards } : { sets: [], cards: [] };
    }
    // Non-fatal on offline or fresh project
  }

  if (!hadError) {
    writePublishedCatalogCache(sets, cards);
  }
  return { sets, cards };
}

function utf8ByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return str.length;
}

function buildCompactCardPayloadJson(card: BattleSpiritsCard, safeId: string): string {
  const baseCard: BattleSpiritsCard = {
    ...card,
    id: safeId,
    effects: (card.effects || []).slice(0, 12),
    rulings: (card.rulings || []).slice(0, 6),
  };
  let json = JSON.stringify(baseCard);
  if (utf8ByteLength(json) <= 19800) return json;

  json = JSON.stringify({
    ...baseCard,
    rulings: [],
    galleryImages: [],
    flavorText: (baseCard.flavorText || '').slice(0, 300),
    effects: (baseCard.effects || []).slice(0, 6),
  });
  if (utf8ByteLength(json) <= 19800) return json;

  json = JSON.stringify({
    ...baseCard,
    rulings: [],
    galleryImages: [],
    flavorText: '',
    effects: [],
  });
  return utf8ByteLength(json) <= 19800 ? json : '';
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

  // Pre-fetch ALL existing document data (including unpublished docs) so batches know create vs update AND skip unchanged docs
  const existingSetsById = new Map<string, Record<string, unknown>>();
  const existingCardsById = new Map<string, Record<string, unknown>>();
  if (sets.length > 0 && !isCloudQuotaCooldownActive()) {
    try {
      const snap = await withTransientFirestoreRetry(() => getDocs(collection(db, 'catalogSets')));
      for (const d of snap.docs) existingSetsById.set(d.id, d.data() as Record<string, unknown>);
    } catch (err) {
      if (isFirestoreQuotaError(err)) {
        markCloudQuotaExhausted();
      } else {
        logStructuredFirestoreError(err, OperationType.LIST, 'catalogSets');
      }
    }
  }
  if (cards.length > 0 && !isCloudQuotaCooldownActive()) {
    try {
      const snap = await withTransientFirestoreRetry(() => getDocs(collection(db, 'catalogCards')));
      for (const d of snap.docs) existingCardsById.set(d.id, d.data() as Record<string, unknown>);
    } catch (err) {
      if (isFirestoreQuotaError(err)) {
        markCloudQuotaExhausted();
      } else {
        logStructuredFirestoreError(err, OperationType.LIST, 'catalogCards');
      }
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

    const basePayload: Record<string, unknown> = {
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
    };

    const existingSet = existingSetsById.get(safeCode);
    if (existingSet) {
      const unchanged =
        String(existingSet.name || '') === String(basePayload.name) &&
        String(existingSet.jpName || '') === String(basePayload.jpName) &&
        String(existingSet.category || '') === String(basePayload.category) &&
        String(existingSet.productType || '') === String(basePayload.productType) &&
        String(existingSet.releaseDate || '') === String(basePayload.releaseDate) &&
        JSON.stringify(existingSet.formats || []) === JSON.stringify(basePayload.formats) &&
        JSON.stringify(existingSet.colors || []) === JSON.stringify(basePayload.colors) &&
        Number(existingSet.totalCardsInSet || 0) === Number(basePayload.totalCardsInSet) &&
        Number(existingSet.discoveredCount || 0) === Number(basePayload.discoveredCount) &&
        Boolean(existingSet.isPublished) === true;
      if (unchanged) continue;
    }

    setEntries.push({
      safeCode,
      basePayload,
    });
  }

  let quotaHit = isCloudWriteCooldownActive();

  for (let i = 0; i < setEntries.length && !quotaHit; i += BATCH_CHUNK_SIZE) {
    const chunk = setEntries.slice(i, i + BATCH_CHUNK_SIZE);
    const commitChunk = async () => {
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, 'catalogSets', item.safeCode);
        if (existingSetsById.has(item.safeCode)) {
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
      for (const item of chunk) existingSetsById.set(item.safeCode, item.basePayload);
      pushedSets += chunk.length;
    } catch (chunkErr) {
      if (isFirestoreQuotaError(chunkErr)) {
        markCloudQuotaExhausted();
        quotaHit = true;
        const info = classifyFirestoreError(chunkErr);
        for (const item of chunk) {
          failedSets.push({
            setCode: item.safeCode,
            error: info.message,
            diagnosticCategory: info.diagnosticCategory,
            recoverable: info.recoverable,
            recommendedAction: info.recommendedAction,
          });
        }
        failures.push({
          id: chunk[0]?.safeCode || 'catalogSets',
          entityType: 'set',
          error: info.message,
          diagnosticCategory: info.diagnosticCategory,
          recoverable: info.recoverable,
          recommendedAction: info.recommendedAction,
        });
        break;
      }
      // Fallback per-doc isolation with retry so one bad doc never aborts the chunk
      for (const item of chunk) {
        if (quotaHit) break;
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
          existingSetsById.set(item.safeCode, item.basePayload);
          pushedSets++;
        } catch (err) {
          if (isFirestoreQuotaError(err)) {
            markCloudQuotaExhausted();
            quotaHit = true;
          }
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

    const basePayload: Record<string, unknown> = {
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
      missingArtwork:
        !c.artworkVerified &&
        (!c.artworkImage ||
          isPlaceholderArtworkUrl(c.artworkImage) ||
          c.artworkStatus === 'broken' ||
          c.artworkStatus === 'unavailable' ||
          c.artworkStatus === 'missing') &&
        (!c.galleryImages || c.galleryImages.length === 0),
      isPublished: true,
      importedByUid: safeAdminUid,
    };

    const existingCard = existingCardsById.get(safeId);
    if (existingCard) {
      const unchanged =
        String(existingCard.payloadJson || '') === payloadJson &&
        String(existingCard.name || '') === String(basePayload.name) &&
        String(existingCard.setCode || '') === String(basePayload.setCode) &&
        String(existingCard.restriction || '') === String(basePayload.restriction) &&
        Number(existingCard.cost ?? -1) === Number(basePayload.cost) &&
        Boolean(existingCard.missingArtwork) === Boolean(basePayload.missingArtwork) &&
        Boolean(existingCard.isPublished) === true;
      if (unchanged) continue;
    }

    cardEntries.push({
      safeId,
      basePayload,
    });
  }

  for (let i = 0; i < cardEntries.length && !quotaHit; i += BATCH_CHUNK_SIZE) {
    const chunk = cardEntries.slice(i, i + BATCH_CHUNK_SIZE);
    const commitChunk = async () => {
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, 'catalogCards', item.safeId);
        if (existingCardsById.has(item.safeId)) {
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
      for (const item of chunk) existingCardsById.set(item.safeId, item.basePayload);
      pushedCards += chunk.length;
    } catch (chunkErr) {
      if (isFirestoreQuotaError(chunkErr)) {
        markCloudQuotaExhausted();
        quotaHit = true;
        const info = classifyFirestoreError(chunkErr);
        for (const item of chunk) {
          failedCards.push({
            cardId: item.safeId,
            error: info.message,
            diagnosticCategory: info.diagnosticCategory,
            recoverable: info.recoverable,
            recommendedAction: info.recommendedAction,
          });
        }
        failures.push({
          id: chunk[0]?.safeId || 'catalogCards',
          entityType: 'card',
          error: info.message,
          diagnosticCategory: info.diagnosticCategory,
          recoverable: info.recoverable,
          recommendedAction: info.recommendedAction,
        });
        break;
      }
      // Fallback per-doc isolation with transient retry so one bad card never aborts valid cards
      for (const item of chunk) {
        if (quotaHit) break;
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
          existingCardsById.set(item.safeId, item.basePayload);
          pushedCards++;
        } catch (err) {
          if (isFirestoreQuotaError(err)) {
            markCloudQuotaExhausted();
            quotaHit = true;
          }
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

  if (pushedSets > 0 || pushedCards > 0) {
    invalidatePublishedCatalogCache();
  }

  return { pushedSets, pushedCards, failedSets, failedCards, failures };
}

export async function syncValidationRecordsToFirestore(
  records: ClientArtworkValidationRecord[]
): Promise<SyncValidationResult> {
  let syncedCount = 0;
  const failedKeys: Array<{ mappingKey: string; error: string }> = [];

  if (isCloudWriteCooldownActive()) {
    return {
      syncedCount,
      failedKeys: records.slice(0, 1).map((r) => ({
        mappingKey: sanitizeFirestoreId(r.mappingKey, 'val'),
        error: 'Firestore daily free-tier write quota cooldown active.',
      })),
    };
  }

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

  let quotaHit = false;
  for (let i = 0; i < entries.length && !quotaHit; i += BATCH_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const item of chunk) {
      batch.set(doc(db, 'artworkValidations', item.safeKey), item.payload);
    }

    try {
      await batch.commit();
      syncedCount += chunk.length;
    } catch (chunkErr) {
      if (isFirestoreQuotaError(chunkErr)) {
        markCloudQuotaExhausted();
        quotaHit = true;
        failedKeys.push({
          mappingKey: chunk[0]?.safeKey || 'artworkValidations',
          error: normalizeErrorMessage(chunkErr),
        });
        break;
      }
      for (const item of chunk) {
        if (quotaHit) break;
        try {
          await setDoc(doc(db, 'artworkValidations', item.safeKey), item.payload);
          syncedCount++;
        } catch (err) {
          if (isFirestoreQuotaError(err)) {
            markCloudQuotaExhausted();
            quotaHit = true;
          }
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
  if (isCloudQuotaCooldownActive()) return [];
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
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      markCloudQuotaExhausted();
    }
    return [];
  }
}
