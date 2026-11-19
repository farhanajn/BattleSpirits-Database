import { BattleSpiritsCard, ProductSet } from '../types/card';

const DB_NAME = 'spiritsdex_offline_db';
const DB_VERSION = 1;
const STORE_CARDS = 'cards';
const STORE_META = 'meta';

export type CardRestrictionValue = NonNullable<BattleSpiritsCard['restriction']>;

export interface CachedBanListSnapshot {
  effectiveDate?: string;
  byCardNumber: Record<string, CardRestrictionValue>;
  byName: Record<string, CardRestrictionValue>;
}

export interface OfflineSnapshot {
  cards: BattleSpiritsCard[];
  productSets?: ProductSet[];
  setSyncedAt?: number;
  banList?: CachedBanListSnapshot;
}

function openOfflineDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CARDS)) {
          db.createObjectStore(STORE_CARDS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadOfflineSnapshot(): Promise<OfflineSnapshot> {
  const db = await openOfflineDB();
  if (!db) return { cards: [] };

  try {
    const cards = await new Promise<BattleSpiritsCard[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_CARDS, 'readonly');
        const store = tx.objectStore(STORE_CARDS);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = Array.isArray(req.result)
            ? req.result.filter(
                (c): c is BattleSpiritsCard =>
                  Boolean(c && typeof c === 'object' && typeof c.id === 'string')
              )
            : [];
          resolve(list);
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });

    const metaEntries = await new Promise<Array<{ key: string; value: unknown }>>(
      (resolve) => {
        try {
          const tx = db.transaction(STORE_META, 'readonly');
          const store = tx.objectStore(STORE_META);
          const req = store.getAll();
          req.onsuccess = () => {
            resolve(Array.isArray(req.result) ? req.result : []);
          };
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      }
    );

    let productSets: ProductSet[] | undefined;
    let setSyncedAt: number | undefined;
    let banList: CachedBanListSnapshot | undefined;
    for (const entry of metaEntries) {
      if (entry?.key === 'productSets' && Array.isArray(entry.value)) {
        productSets = entry.value as ProductSet[];
      } else if (entry?.key === 'setSyncedAt' && typeof entry.value === 'number') {
        setSyncedAt = entry.value;
      } else if (
        entry?.key === 'banList' &&
        entry.value &&
        typeof entry.value === 'object'
      ) {
        banList = entry.value as CachedBanListSnapshot;
      }
    }

    return { cards, productSets, setSyncedAt, banList };
  } finally {
    db.close();
  }
}

export async function saveOfflineCards(cards: BattleSpiritsCard[]): Promise<void> {
  if (!cards.length) return;
  const db = await openOfflineDB();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_CARDS, 'readwrite');
        const store = tx.objectStore(STORE_CARDS);
        for (const card of cards) {
          if (card && card.id) {
            store.put(card);
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}

export async function saveOfflineMeta(meta: {
  productSets?: ProductSet[];
  setSyncedAt?: number;
  banList?: CachedBanListSnapshot;
}): Promise<void> {
  if (!meta.productSets && meta.setSyncedAt === undefined && !meta.banList) return;
  const db = await openOfflineDB();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_META, 'readwrite');
        const store = tx.objectStore(STORE_META);
        if (meta.productSets) {
          store.put({ key: 'productSets', value: meta.productSets });
        }
        if (typeof meta.setSyncedAt === 'number') {
          store.put({ key: 'setSyncedAt', value: meta.setSyncedAt });
        }
        if (meta.banList) {
          store.put({ key: 'banList', value: meta.banList });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}
