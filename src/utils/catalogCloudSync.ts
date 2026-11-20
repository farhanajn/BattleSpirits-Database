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
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  BattleSpiritsCard,
  CardColor,
  CardType,
  GameFormat,
  ProductSet,
} from '../types/card';

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

const VALID_COLORS: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];
const VALID_TYPES: CardType[] = ['Spirit', 'Ultimate', 'Brave', 'Nexus', 'Magic'];
const ADMIN_EMAILS = new Set(['farhana.jn2000@gmail.com']);

function sanitizeFirestoreId(raw: string, fallbackPrefix = 'id'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
  return cleaned || `${fallbackPrefix}-${Date.now()}`;
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
        category: (String(data.category || 'Supplementary') as ProductSet['category']),
        productType: (String(data.productType || 'Supplementary Set') as ProductSet['productType']),
        releaseDate: String(data.releaseDate || ''),
        formats: Array.isArray(data.formats) && data.formats.length > 0
          ? (data.formats.map(String) as GameFormat[])
          : ['Eternal'],
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
            cards.push(parsed);
            continue;
          }
        } catch {
          // fall back to structured summary fields
        }
      }
      cards.push({
        id: String(data.id || d.id),
        cardNumber: String(data.cardNumber || d.id),
        name: String(data.name || d.id),
        jpName: String(data.jpName || ''),
        color: VALID_COLORS.includes(data.color) ? data.color : 'Red',
        ...(VALID_COLORS.includes(data.secondaryColor)
          ? { secondaryColor: data.secondaryColor as CardColor }
          : {}),
        colors: Array.isArray(data.colors) && data.colors.length > 0
          ? (data.colors.filter((c) => VALID_COLORS.includes(c)) as CardColor[])
          : ['Red'],
        type: VALID_TYPES.includes(data.type) ? (data.type as CardType) : 'Spirit',
        subtypeLabel: data.subtypeLabel ? String(data.subtypeLabel) : undefined,
        rarity: String(data.rarity || 'C') as BattleSpiritsCard['rarity'],
        setCode: String(data.setCode || 'WIKI'),
        setName: String(data.setName || data.setCode || 'Wiki Set'),
        formats: Array.isArray(data.formats) && data.formats.length > 0
          ? (data.formats.map(String) as GameFormat[])
          : ['Eternal'],
        blockIcon: String(data.blockIcon || 'Wiki'),
        restriction: String(data.restriction || 'Unlimited') as BattleSpiritsCard['restriction'],
        isRevival: Boolean(data.isRevival),
        isToken: Boolean(data.isToken),
        cost: Math.max(0, Math.min(99, Math.round(Number(data.cost) || 0))),
        reduction: {},
        symbols: {},
        families: [],
        effects: [],
        keywords: [],
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
): Promise<{ pushedSets: number; pushedCards: number }> {
  let pushedSets = 0;
  let pushedCards = 0;

  for (const s of sets) {
    const safeCode = sanitizeFirestoreId(s.setCode, 'set');
    const ref = doc(db, 'catalogSets', safeCode);
    const formats = (s.formats && s.formats.length > 0 ? s.formats : ['Eternal'])
      .slice(0, 4)
      .map((f) => String(f).slice(0, 20));
    const colors = (s.colors || [])
      .filter((c) => VALID_COLORS.includes(c))
      .slice(0, 6)
      .map((c) => String(c).slice(0, 20));
    const sources = (s.sources || ['CatalogSync'])
      .slice(0, 12)
      .map((src) => String(src).slice(0, 120));

    const basePayload = {
      setCode: safeCode,
      wikiTitle: String(s.wikiTitle || s.name || safeCode).slice(0, 200) || safeCode,
      name: String(s.name || safeCode).slice(0, 200) || safeCode,
      jpName: String(s.jpName || '').slice(0, 200),
      category: String(s.category || 'Supplementary').slice(0, 60) || 'Supplementary',
      productType: String(s.productType || '').slice(0, 60),
      releaseDate: String(s.releaseDate || '').slice(0, 80),
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
      updatedByUid: sanitizeFirestoreId(adminUid, 'admin'),
    };

    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        await updateDoc(ref, {
          ...basePayload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...basePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      pushedSets++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `catalogSets/${safeCode}`);
    }
  }

  for (const c of cards) {
    const safeId = sanitizeFirestoreId(c.id, 'card');
    const ref = doc(db, 'catalogCards', safeId);
    const primaryColor: CardColor = VALID_COLORS.includes(c.color) ? c.color : 'Red';
    const secondaryColor: CardColor | '' =
      c.secondaryColor && VALID_COLORS.includes(c.secondaryColor) ? c.secondaryColor : '';
    const colors = (c.colors && c.colors.length > 0 ? c.colors : [primaryColor])
      .filter((col) => VALID_COLORS.includes(col))
      .slice(0, 6);
    const formats = (c.formats && c.formats.length > 0 ? c.formats : ['Eternal'])
      .slice(0, 4)
      .map((f) => String(f).slice(0, 20));
    const cardType: CardType = VALID_TYPES.includes(c.type) ? c.type : 'Spirit';

    const compactCard: BattleSpiritsCard = {
      ...c,
      id: safeId,
      effects: (c.effects || []).slice(0, 12),
      rulings: (c.rulings || []).slice(0, 6),
    };
    let payloadJson = JSON.stringify(compactCard);
    if (payloadJson.length > 19500) {
      payloadJson = JSON.stringify({
        ...compactCard,
        rulings: [],
        galleryImages: [],
        effects: (compactCard.effects || []).slice(0, 6),
      }).slice(0, 19900);
    }

    const basePayload = {
      id: safeId,
      cardNumber: String(c.cardNumber || safeId).slice(0, 64) || safeId,
      name: String(c.name || c.jpName || safeId).slice(0, 200) || safeId,
      jpName: String(c.jpName || '').slice(0, 200),
      color: primaryColor,
      secondaryColor,
      colors: colors.length > 0 ? colors : [primaryColor],
      type: cardType,
      subtypeLabel: String(c.subtypeLabel || '').slice(0, 80),
      rarity: String(c.rarity || 'C').slice(0, 16) || 'C',
      setCode: String(c.setCode || 'WIKI').slice(0, 64) || 'WIKI',
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
      importedByUid: sanitizeFirestoreId(adminUid, 'admin'),
    };

    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        await updateDoc(ref, {
          ...basePayload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...basePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      pushedCards++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `catalogCards/${safeId}`);
    }
  }

  return { pushedSets, pushedCards };
}

export async function syncValidationRecordsToFirestore(
  records: ClientArtworkValidationRecord[]
): Promise<number> {
  let count = 0;
  for (const r of records) {
    const safeKey = sanitizeFirestoreId(r.mappingKey, 'val');
    const ref = doc(db, 'artworkValidations', safeKey);
    try {
      await setDoc(ref, {
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
      });
      count++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `artworkValidations/${safeKey}`);
    }
  }
  return count;
}
