import initSqlJs, { Database } from 'sql.js';

// ─── Cache TTLs ───────────────────────────────────────────────────
const QUOTE_TTL = 15 * 60 * 1000;              // 15 min
const HISTORICAL_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days
const GENERIC_TTL = 24 * 60 * 60 * 1000;       // 24 hours

// ─── State ────────────────────────────────────────────────────────
let fsHandle: FileSystemFileHandle | null = null;
let db: Database | null = null;
let dbReady: Promise<Database>;
let dirty = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// ─── IndexedDB fallback ───────────────────────────────────────────
const IDB_DB_NAME = 'stockpulse_sqlite';
const IDB_STORE = 'sqlite_db';
const IDB_KEY = 'main';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIdb(): Promise<Uint8Array | null> {
  try {
    const idb = await openIdb();
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function saveToIdb(data: Uint8Array): Promise<void> {
  try {
    const idb = await openIdb();
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(data, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

// ─── File handle persistence in IndexedDB ─────────────────────────

async function saveFileHandle(handle: FileSystemFileHandle): Promise<void> {
  try {
    const idb = await openIdb();
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, 'db_file_handle');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

async function loadFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const idb = await openIdb();
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('db_file_handle');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function removeFileHandle(): Promise<void> {
  try {
    const idb = await openIdb();
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete('db_file_handle');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

// ─── File I/O ──────────────────────────────────────────────────────

async function readDbFile(): Promise<Uint8Array | null> {
  if (!fsHandle) return null;
  try {
    const file = await fsHandle.getFile();
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  } catch { return null; }
}

async function writeDbFile(data: Uint8Array): Promise<boolean> {
  if (!fsHandle) return false;
  try {
    const writable = await fsHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  } catch { return false; }
}

// ─── Public: file picker ──────────────────────────────────────────

export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export async function pickDbFile(): Promise<boolean> {
  if (!isFsAccessSupported()) return false;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'stockpulse.db',
      types: [
        { description: 'SQLite Database', accept: { 'application/x-sqlite3': ['.db'] } },
      ],
    } as SaveFilePickerOptions);
    // showSaveFilePicker already grants readwrite — no need to re-request
    fsHandle = handle;
    await saveFileHandle(handle);
    console.log('[LocalDB] File handle saved:', handle.name);
    return true;
  } catch (e) {
    console.log('[LocalDB] File picker cancelled:', e);
    return false;
  }
}

export async function resetDbFile(): Promise<boolean> {
  fsHandle = null;
  await removeFileHandle();
  return pickDbFile();
}

export function getDbFileName(): string | null {
  return fsHandle?.name ?? null;
}

// ─── Schema ────────────────────────────────────────────────────────

const TABLES = [
  `CREATE TABLE IF NOT EXISTS quotes (
    symbol    TEXT PRIMARY KEY,
    data      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS historical (
    symbol    TEXT NOT NULL,
    date      TEXT NOT NULL,
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    volume    INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, date)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

function ensureTables(d: Database) {
  for (const sql of TABLES) d.run(sql);
}

// ─── Init ──────────────────────────────────────────────────────────

async function initDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });

  let loaded = false;

  // 1. Try File System Access API
  if (isFsAccessSupported()) {
    const savedHandle = await loadFileHandle();
    if (savedHandle) {
      fsHandle = savedHandle;
      const data = await readDbFile();
      if (data && data.length > 0) {
        try {
          db = new SQL.Database(data);
          console.log('[LocalDB] Loaded from disk file:', savedHandle.name);
          loaded = true;
        } catch {
          console.log('[LocalDB] Disk file corrupt, creating fresh DB');
        }
      }
    }
  }

  // 2. Fallback: IndexedDB
  if (!loaded) {
    const saved = await loadFromIdb();
    if (saved && saved.length > 0) {
      try {
        db = new SQL.Database(saved);
        console.log('[LocalDB] Loaded from IndexedDB');
        loaded = true;
      } catch {
        console.log('[LocalDB] IndexedDB corrupt, creating fresh DB');
      }
    }
  }

  // 3. Fresh
  if (!loaded) {
    db = new SQL.Database();
    console.log('[LocalDB] Created fresh database');
  }

  ensureTables(db);

  // 4. Migrate localStorage → SQLite on first run
  migrateLocalStorage(db);

  return db;
}

dbReady = initDb();

// ─── localStorage → SQLite migration (one-time) ───────────────────

const LS_MIGRATION_KEY = 'stockpulse_db_migrated';

function migrateLocalStorage(d: Database) {
  if (localStorage.getItem(LS_MIGRATION_KEY)) return;

  // Config keys → config table
  const configKeys = [
    'stockpulse_watchlist',
    'stockpulse_users',
    'stockpulse_auth',
    'stockpulse_admin_auth',
    'stockpulse_api_config',
    'sp-lang',
    'stockpulse_recent_stocks',
  ];

  // Document keys → documents table
  const docKeys = [
    'stockpulse_screener_results',
    'stockpulse_avs_results',
    'stockpulse_politician_trades',
    'stockpulse_trump_trades',
    'stockpulse_cron_history',
    'stockpulse_alerts',
    'stockpulse_alert_config',
    'stockpulse_market_snapshot',
  ];

  let migrated = 0;

  for (const key of configKeys) {
    const val = localStorage.getItem(key);
    if (val !== null) {
      d.run(
        `INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`,
        [key, val],
      );
      migrated++;
    }
  }

  for (const key of docKeys) {
    const val = localStorage.getItem(key);
    if (val !== null) {
      d.run(
        `INSERT OR REPLACE INTO documents (id, data, updated_at) VALUES (?, ?, ?)`,
        [key, val, Date.now()],
      );
      migrated++;
    }
  }

  localStorage.setItem(LS_MIGRATION_KEY, '1');
  if (migrated > 0) {
    console.log(`[LocalDB] Migrated ${migrated} localStorage keys → SQLite`);
    dirty = true;
    schedulePersist();
  }
}

// ─── Persistence (debounced) ───────────────────────────────────────

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (!dirty || !db) return;
    dirty = false;
    await persistToAll();
  }, 5000);
}

function markDirty() {
  dirty = true;
  schedulePersist();
}

async function persistToAll(): Promise<void> {
  if (!db) return;
  const data = db.export();
  await saveToIdb(data);
  if (fsHandle) {
    try { await writeDbFile(data); } catch { /* disk write failed, data safe in IndexedDB */ }
  }
}

export async function persistNow(): Promise<void> {
  if (!db) return;
  dirty = false;
  await persistToAll();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (db && dirty) {
      const data = db.export();
      saveToIdb(data);
      if (fsHandle) writeDbFile(data);
    }
  });
}

// ─── Config API (small key-value pairs) ───────────────────────────

export async function getConfig(key: string): Promise<string | null> {
  const d = await dbReady;
  const row = d.exec(`SELECT value FROM config WHERE key = ?`, [key]);
  if (!row.length || !row[0].values.length) return null;
  return row[0].values[0][0] as string;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const d = await dbReady;
  d.run(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`, [key, value]);
  markDirty();
}

export async function deleteConfig(key: string): Promise<void> {
  const d = await dbReady;
  d.run(`DELETE FROM config WHERE key = ?`, [key]);
  markDirty();
}

/** Get all config keys as a record */
export async function getAllConfig(): Promise<Record<string, string>> {
  const d = await dbReady;
  const rows = d.exec(`SELECT key, value FROM config`);
  if (!rows.length) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of rows[0].values) out[k as string] = v as string;
  return out;
}

// ─── Documents API (large JSON blobs) ──────────────────────────────

export async function getDocument<T = unknown>(id: string): Promise<T | null> {
  const d = await dbReady;
  const row = d.exec(`SELECT data FROM documents WHERE id = ?`, [id]);
  if (!row.length || !row[0].values.length) return null;
  try {
    return JSON.parse(row[0].values[0][0] as string) as T;
  } catch { return null; }
}

export async function setDocument(id: string, data: unknown): Promise<void> {
  const d = await dbReady;
  d.run(
    `INSERT OR REPLACE INTO documents (id, data, updated_at) VALUES (?, ?, ?)`,
    [id, JSON.stringify(data), Date.now()],
  );
  markDirty();
}

export async function deleteDocument(id: string): Promise<void> {
  const d = await dbReady;
  d.run(`DELETE FROM documents WHERE id = ?`, [id]);
  markDirty();
}

// ─── Quotes API ────────────────────────────────────────────────────

export interface CachedQuote {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: string;
  pe: number;
  week52High: number;
  week52Low: number;
}

export async function getQuote(symbol: string): Promise<CachedQuote | null> {
  const d = await dbReady;
  const row = d.exec(
    `SELECT data, updated_at FROM quotes WHERE symbol = ?`,
    [symbol.toUpperCase()],
  );
  if (!row.length || !row[0].values.length) return null;
  const [dataStr, updatedAt] = row[0].values[0] as [string, number];
  if (Date.now() - updatedAt > QUOTE_TTL) return null;
  try { return JSON.parse(dataStr); } catch { return null; }
}

export async function putQuote(quote: CachedQuote): Promise<void> {
  const d = await dbReady;
  d.run(
    `INSERT OR REPLACE INTO quotes (symbol, data, updated_at) VALUES (?, ?, ?)`,
    [quote.symbol.toUpperCase(), JSON.stringify(quote), Date.now()],
  );
  markDirty();
}

// ─── Historical API ────────────────────────────────────────────────

export async function getHistorical(symbol: string): Promise<Record<string, unknown>[] | null> {
  const d = await dbReady;
  const meta = d.exec(
    `SELECT MAX(updated_at) FROM historical WHERE symbol = ?`,
    [symbol.toUpperCase()],
  );
  if (!meta.length || !meta[0].values.length || meta[0].values[0] === null) return null;
  const maxAge = meta[0].values[0] as number;
  if (Date.now() - maxAge > HISTORICAL_TTL) return null;

  const rows = d.exec(
    `SELECT date, open, high, low, close, volume FROM historical WHERE symbol = ? ORDER BY date ASC`,
    [symbol.toUpperCase()],
  );
  if (!rows.length) return null;

  return rows[0].values.map(([date, open, high, low, close, volume]) => ({
    date, open, high, low, close, volume,
  }));
}

export async function putHistorical(symbol: string, data: Record<string, unknown>[]): Promise<void> {
  const d = await dbReady;
  const now = Date.now();
  const sym = symbol.toUpperCase();

  d.run('BEGIN TRANSACTION');
  try {
    d.run(`DELETE FROM historical WHERE symbol = ?`, [sym]);
    const stmt = d.prepare(
      `INSERT INTO historical (symbol, date, open, high, low, close, volume, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of data) {
      stmt.run([sym, row.date as string, row.open as number, row.high as number, row.low as number, row.close as number, row.volume as number, now]);
    }
    stmt.free();
    d.run('COMMIT');
  } catch (e) {
    d.run('ROLLBACK');
    throw e;
  }
  markDirty();
}

// ─── Bulk dump / restore (for cloud sync) ─────────────────────────

export interface QuoteDumpRow {
  symbol: string;
  data: string;        // JSON-serialized CachedQuote
  updated_at: number;
}

export interface HistoricalDumpRow {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  updated_at: number;
}

/** Dump every cached quote row (no TTL filter — used by cloud push). */
export async function getAllCachedQuotes(): Promise<QuoteDumpRow[]> {
  const d = await dbReady;
  const res = d.exec(`SELECT symbol, data, updated_at FROM quotes`);
  if (!res.length) return [];
  return res[0].values.map(([symbol, data, updated_at]) => ({
    symbol: symbol as string,
    data: data as string,
    updated_at: updated_at as number,
  }));
}

/** Dump every historical bar (all symbols — used by cloud push). */
export async function getAllHistoricalRows(): Promise<HistoricalDumpRow[]> {
  const d = await dbReady;
  const res = d.exec(
    `SELECT symbol, date, open, high, low, close, volume, updated_at FROM historical ORDER BY symbol, date`
  );
  if (!res.length) return [];
  return res[0].values.map(([symbol, date, open, high, low, close, volume, updated_at]) => ({
    symbol: symbol as string,
    date: date as string,
    open: open as number | null,
    high: high as number | null,
    low: low as number | null,
    close: close as number | null,
    volume: volume as number | null,
    updated_at: updated_at as number,
  }));
}

/** Restore quotes from cloud dump (INSERT OR REPLACE). Returns count. */
export async function bulkPutQuotes(rows: QuoteDumpRow[]): Promise<number> {
  const d = await dbReady;
  d.run('BEGIN TRANSACTION');
  try {
    const stmt = d.prepare(
      `INSERT OR REPLACE INTO quotes (symbol, data, updated_at) VALUES (?, ?, ?)`
    );
    for (const r of rows) stmt.run([r.symbol.toUpperCase(), r.data, r.updated_at]);
    stmt.free();
    d.run('COMMIT');
  } catch (e) {
    d.run('ROLLBACK');
    throw e;
  }
  markDirty();
  return rows.length;
}

/** Restore historical bars from cloud dump (upsert per symbol+date). Returns count. */
export async function bulkPutHistoricalRows(rows: HistoricalDumpRow[]): Promise<number> {
  const d = await dbReady;
  d.run('BEGIN TRANSACTION');
  try {
    const stmt = d.prepare(
      `INSERT OR REPLACE INTO historical (symbol, date, open, high, low, close, volume, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of rows) {
      stmt.run([r.symbol.toUpperCase(), r.date, r.open, r.high, r.low, r.close, r.volume, r.updated_at]);
    }
    stmt.free();
    d.run('COMMIT');
  } catch (e) {
    d.run('ROLLBACK');
    throw e;
  }
  markDirty();
  return rows.length;
}

// ─── Generic metadata (with TTL) ─────────────────────────────────

export async function getMeta(key: string, ttlMs = GENERIC_TTL): Promise<unknown | null> {
  const d = await dbReady;
  const row = d.exec(`SELECT value FROM metadata WHERE key = ?`, [key]);
  if (!row.length || !row[0].values.length) return null;
  const [val] = row[0].values[0] as [string];
  try {
    const parsed = JSON.parse(val);
    if (parsed._ts && Date.now() - parsed._ts > ttlMs) return null;
    return parsed.value ?? parsed;
  } catch { return null; }
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  const d = await dbReady;
  d.run(
    `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`,
    [key, JSON.stringify({ value, _ts: Date.now() })],
  );
  markDirty();
}

// ─── Cleanup ───────────────────────────────────────────────────────

export async function clearSymbol(symbol?: string): Promise<void> {
  const d = await dbReady;
  if (symbol) {
    const sym = symbol.toUpperCase();
    d.run(`DELETE FROM quotes WHERE symbol = ?`, [sym]);
    d.run(`DELETE FROM historical WHERE symbol = ?`, [sym]);
  } else {
    d.run(`DELETE FROM quotes`);
    d.run(`DELETE FROM historical`);
  }
  markDirty();
}

export async function purgeExpired(): Promise<number> {
  const d = await dbReady;
  const now = Date.now();
  let count = 0;

  const q = d.exec(`SELECT COUNT(*) FROM quotes WHERE updated_at < ?`, [now - QUOTE_TTL]);
  if (q.length && q[0].values.length) count += (q[0].values[0] as number);
  d.run(`DELETE FROM quotes WHERE updated_at < ?`, [now - QUOTE_TTL]);

  const h = d.exec(`SELECT COUNT(*) FROM historical WHERE updated_at < ?`, [now - HISTORICAL_TTL]);
  if (h.length && h[0].values.length) count += (h[0].values[0] as number);
  d.run(`DELETE FROM historical WHERE updated_at < ?`, [now - HISTORICAL_TTL]);

  if (count > 0) markDirty();
  return count;
}

export async function getStats(): Promise<{ quotes: number; historical: number; config: number; documents: number; file: string | null }> {
  const d = await dbReady;
  const q = d.exec(`SELECT COUNT(*) FROM quotes`);
  const h = d.exec(`SELECT COUNT(*) FROM historical`);
  const c = d.exec(`SELECT COUNT(*) FROM config`);
  const doc = d.exec(`SELECT COUNT(*) FROM documents`);
  return {
    quotes: q.length ? (q[0].values[0] as number) : 0,
    historical: h.length ? (h[0].values[0] as number) : 0,
    config: c.length ? (c[0].values[0] as number) : 0,
    documents: doc.length ? (doc[0].values[0] as number) : 0,
    file: fsHandle?.name ?? null,
  };
}

// ─── Export / Import ────────────────────────────────────────────────

export async function exportDb(): Promise<void> {
  const d = await dbReady;
  await persistNow();
  const data = d.export();
  const blob = new Blob([data], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stockpulse_${new Date().toISOString().slice(0, 10)}.db`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importDb(file: File): Promise<void> {
  const buf = await file.arrayBuffer();
  const d = await dbReady;
  d.close();
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  db = new SQL.Database(new Uint8Array(buf));
  ensureTables(db);
  markDirty();
  await persistNow();
}

/**
 * Import a semicolon-delimited CSV of stock price history into the historical table.
 * Expected columns: id;symbol;date;open;high;low;close;volume;created_at
 * Returns the number of rows imported.
 */
export async function importHistoricalCsv(file: File): Promise<number> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return 0;

  // Skip header
  const dataLines = lines.slice(1);
  const d = await dbReady;
  const now = Date.now();
  let count = 0;

  d.run('BEGIN TRANSACTION');
  try {
    const stmt = d.prepare(
      `INSERT OR REPLACE INTO historical (symbol, date, open, high, low, close, volume, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const line of dataLines) {
      const parts = line.split(';');
      if (parts.length < 8) continue;
      const [, symbol, date, open, high, low, close, volume] = parts;
      if (!symbol || !date) continue;
      stmt.run([
        symbol.toUpperCase(),
        date,
        parseFloat(open) || 0,
        parseFloat(high) || 0,
        parseFloat(low) || 0,
        parseFloat(close) || 0,
        parseInt(volume, 10) || 0,
        now,
      ]);
      count++;
    }
    stmt.free();
    d.run('COMMIT');
  } catch (e) {
    d.run('ROLLBACK');
    throw e;
  }

  markDirty();
  await persistNow();
  console.log(`[LocalDB] Imported ${count} historical rows from CSV`);
  return count;
}

/**
 * Import politician trades CSV into the documents table.
 * Expected header: id;symbol;politician;transaction_date;filing_date;transaction_type;amount_from;amount_to;asset_name;...
 * Returns the number of rows imported.
 */
export async function importPoliticianTradesCsv(file: File): Promise<number> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return 0;

  const header = lines[0].split(';');
  const dataLines = lines.slice(1);
  const trades: Record<string, unknown>[] = [];
  const colIdx: Record<string, number> = {};
  header.forEach((h, i) => { colIdx[h.trim()] = i; });

  for (const line of dataLines) {
    const p = line.split(';');
    if (p.length < 8) continue;
    trades.push({
      id: p[colIdx['id'] ?? 0] || crypto.randomUUID(),
      symbol: p[colIdx['symbol'] ?? 1] || '',
      politician: p[colIdx['politician'] ?? 2] || '',
      transaction_date: p[colIdx['transaction_date'] ?? 3] || '',
      filing_date: p[colIdx['filing_date'] ?? 4] || null,
      transaction_type: p[colIdx['transaction_type'] ?? 5] || 'OTHER',
      amount_from: parseFloat(p[colIdx['amount_from'] ?? 6]) || null,
      amount_to: parseFloat(p[colIdx['amount_to'] ?? 7]) || null,
      asset_name: p[colIdx['asset_name'] ?? 8] || null,
      position_held: p[colIdx['position_held'] ?? 10] || null,
    });
  }

  if (trades.length === 0) return 0;

  const cache = { data: trades, fetchedAt: Date.now() };
  await setDocument('stockpulse_politician_trades', cache);
  // Also write to localStorage for PoliticianTrades component (reads from cache)
  localStorage.setItem('stockpulse_politician_trades', JSON.stringify(cache));
  console.log(`[LocalDB] Imported ${trades.length} politician trades from CSV`);
  return trades.length;
}

/**
 * Auto-detect CSV type from header and import accordingly.
 * Returns { type, count }.
 */
export async function importCsv(file: File): Promise<{ type: string; count: number }> {
  const text = await file.text();
  const headerLine = text.split(/\r?\n/)[0] || '';
  const header = headerLine.toLowerCase();

  if (header.includes('open') && header.includes('close') && header.includes('volume')) {
    const count = await importHistoricalCsv(file);
    return { type: 'stock price history', count };
  }
  if (header.includes('politician') && header.includes('transaction_type')) {
    const count = await importPoliticianTradesCsv(file);
    return { type: 'politician trades', count };
  }

  throw new Error('Unrecognized CSV format. Expected columns: symbol+date+open+close+volume (historical) or politician+transaction_type (trades).');
}
