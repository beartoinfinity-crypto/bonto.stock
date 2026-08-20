// Multi-tier cache: IndexedDB for large historical data, localStorage for small quotes
// Retention: quotes = 15 min, historical = 90 days, market data = 1 day

// ─── Types ───────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export type CacheType = 'QUOTE' | 'HISTORICAL' | 'MARKET_SENTIMENT' | 'MARKET_LIQUIDITY';

// Cache durations in milliseconds
const CACHE_DURATIONS: Record<CacheType, number> = {
  QUOTE: 15 * 60 * 1000,           // 15 minutes
  HISTORICAL: 90 * 24 * 60 * 60 * 1000, // 90 days (3 months)
  MARKET_SENTIMENT: 24 * 60 * 60 * 1000, // 24 hours
  MARKET_LIQUIDITY: 24 * 60 * 60 * 1000, // 24 hours
};

const LS_PREFIX: Record<CacheType, string> = {
  QUOTE: 'sp_q_',
  HISTORICAL: 'sp_h_',
  MARKET_SENTIMENT: 'sp_ms_',
  MARKET_LIQUIDITY: 'sp_ml_',
};

// ─── IndexedDB Layer (for large data like historical candles) ────────

const DB_NAME = 'stockpulse_cache';
const DB_VERSION = 1;
const STORE_NAME = 'cache_entries';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('IndexedDB open failed, falling back to localStorage');
        reject(request.error);
      };
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const result = req.result;
        if (!result) return resolve(null);
        if (Date.now() > result.expiresAt) {
          // Expired — schedule cleanup
          idbDelete(key).catch(() => {});
          return resolve(null);
        }
        resolve({ data: result.data, timestamp: result.timestamp, expiresAt: result.expiresAt });
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, ...entry });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

async function idbClearExpired(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('expiresAt');
      const range = IDBKeyRange.upperBound(Date.now());
      const req = index.openCursor(range);
      let deleted = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => resolve(deleted);
    });
  } catch {
    return 0;
  }
}

async function idbClearByPrefix(prefix: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

// ─── Determine storage tier ─────────────────────────────────────────

// Large data (historical) → IndexedDB; small data (quotes, market) → localStorage
const LARGE_TYPES: CacheType[] = ['HISTORICAL'];

function isLargeType(type: CacheType): boolean {
  return LARGE_TYPES.includes(type);
}

// ─── localStorage helpers ────────────────────────────────────────────

function lsKey(type: CacheType, symbol: string): string {
  return `${LS_PREFIX[type]}${symbol.toUpperCase()}`;
}

function lsGet<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function lsSet<T>(key: string, entry: CacheEntry<T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota exceeded — clear old stock caches and retry
    clearStockCache();
    try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* give up */ }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export async function getCachedData<T>(type: CacheType, symbol: string): Promise<T | null> {
  const key = lsKey(type, symbol);

  if (isLargeType(type)) {
    const entry = await idbGet<T>(key);
    if (entry) {
      console.log(`[Cache] IDB hit ${type}:${symbol} (expires in ${Math.round((entry.expiresAt - Date.now()) / 1000 / 60)}min)`);
      return entry.data;
    }
    return null;
  }

  const entry = lsGet<T>(key);
  if (entry) {
    console.log(`[Cache] LS hit ${type}:${symbol} (expires in ${Math.round((entry.expiresAt - Date.now()) / 1000 / 60)}min)`);
    return entry.data;
  }
  return null;
}

export async function setCachedData<T>(type: CacheType, symbol: string, data: T): Promise<void> {
  const key = lsKey(type, symbol);
  const duration = CACHE_DURATIONS[type];
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + duration,
  };

  if (isLargeType(type)) {
    await idbSet(key, entry);
    console.log(`[Cache] IDB stored ${type}:${symbol} (expires in ${Math.round(duration / 1000 / 60)}min)`);
    return;
  }

  lsSet(key, entry);
  console.log(`[Cache] LS stored ${type}:${symbol} (expires in ${Math.round(duration / 1000 / 60)}min)`);
}

export function clearStockCache(symbol?: string): void {
  // Clear localStorage entries
  try {
    if (symbol) {
      Object.keys(LS_PREFIX).forEach(type => {
        localStorage.removeItem(lsKey(type as CacheType, symbol));
      });
    } else {
      const prefixes = Object.values(LS_PREFIX);
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && prefixes.some(p => key.startsWith(p))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    }
  } catch { /* ignore */ }

  // Clear IndexedDB entries
  if (symbol) {
    Object.keys(LS_PREFIX).forEach(type => {
      idbDelete(lsKey(type as CacheType, symbol)).catch(() => {});
    });
  } else {
    Object.values(LS_PREFIX).forEach(prefix => {
      idbClearByPrefix(prefix).catch(() => {});
    });
  }
}

/** Periodically purge expired entries from IndexedDB */
export async function purgeExpiredCache(): Promise<number> {
  return idbClearExpired();
}

export function getCacheStats(): { quoteCached: number; historicalCached: number; marketCached: number } {
  let quoteCached = 0;
  let historicalCached = 0;
  let marketCached = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX.QUOTE)) quoteCached++;
      if (key?.startsWith(LS_PREFIX.MARKET_SENTIMENT)) marketCached++;
      if (key?.startsWith(LS_PREFIX.MARKET_LIQUIDITY)) marketCached++;
    }
  } catch { /* ignore */ }

  // Historical count requires async IDB scan — return 0 for sync call
  return { quoteCached, historicalCached, marketCached };
}
