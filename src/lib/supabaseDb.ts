/**
 * supabaseDb.ts — optional cloud storage backend (third layer)
 *
 * Layer 1: localStorage  (sync reads, always on)
 * Layer 2: SQLite        (.db export, always on, via localDb.ts)
 * Layer 3: Supabase      (cloud backup/sync, opt-in, this file)
 *
 * Design: single KV table `stockpulse_kv` mirrors every CONFIG_KEY and
 * DOCUMENT_KEY. Writes from the app are debounced (3 s) and upserted.
 * Pull writes remote rows back through the local write path, with a guard
 * flag so pulled rows don't echo back up to Supabase.
 *
 * No circular imports: key lists come from syncKeys.ts; SQLite writes go
 * straight to localDb.ts.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CONFIG_KEYS, DOCUMENT_KEYS } from './syncKeys';
import {
  setConfig, setDocument,
  getAllCachedQuotes, getAllHistoricalRows,
  bulkPutQuotes, bulkPutHistoricalRows,
} from './localDb';

export const SUPABASE_CONFIG_KEY = 'stockpulse_supabase_config';
export const TABLE = 'stockpulse_kv';
export const QUOTES_TABLE = 'stock_quotes';
export const HISTORICAL_TABLE = 'stock_historical';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  enabled: boolean;
}

const SYNC_KEYS: string[] = [...CONFIG_KEYS, ...DOCUMENT_KEYS];

// ─── Config (localStorage only — never mirrored) ───────────────────

export function getSupabaseConfig(): SupabaseConfig {
  try {
    const raw = localStorage.getItem(SUPABASE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { url: parsed.url ?? '', anonKey: parsed.anonKey ?? '', enabled: !!parsed.enabled };
    }
  } catch { /* corrupted config */ }
  return { url: '', anonKey: '', enabled: false };
}

export function saveSupabaseConfig(cfg: SupabaseConfig): void {
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(cfg));
  resetClient();
}

// ─── Client (lazy singleton) ───────────────────────────────────────

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return null;
  if (!client) client = createClient(cfg.url, cfg.anonKey);
  return client;
}

export function resetClient(): void {
  client = null;
}

export function isConfigured(): boolean {
  const cfg = getSupabaseConfig();
  return !!(cfg.url && cfg.anonKey);
}

// ─── Connection test ───────────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const c = getClient();
  if (!c) return { ok: false, error: 'Not configured or disabled' };
  const { error } = await c.from(TABLE).select('key').limit(1);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─── Pull guard (prevents pull → auto-sync → push echo loop) ──────

let pulling = false;

// ─── Row helpers ───────────────────────────────────────────────────

interface KVRow {
  key: string;
  value: string;
  updated_at: string;
}

function rowFor(key: string): KVRow {
  return {
    key,
    value: localStorage.getItem(key) ?? '',
    updated_at: new Date().toISOString(),
  };
}

async function upsertRows(c: SupabaseClient, rows: KVRow[]): Promise<void> {
  // Chunk to stay well under request size limits
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await c.from(TABLE).upsert(chunk, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }
}

function writeLocal(key: string, value: string): void {
  // Mirror storage.setItem's dual-write without importing it (cycle-safe)
  localStorage.setItem(key, value);
  if ((CONFIG_KEYS as readonly string[]).includes(key)) {
    setConfig(key, value).catch(() => {});
  } else if ((DOCUMENT_KEYS as readonly string[]).includes(key)) {
    setDocument(key, value).catch(() => {});
  }
}

// ─── Push / Pull ───────────────────────────────────────────────────

/** Push all tracked keys (or a specific subset) to Supabase. Returns count. */
export async function pushKeys(keys?: string[]): Promise<number> {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');
  const targets = (keys && keys.length ? keys : SYNC_KEYS).filter(
    k => localStorage.getItem(k) !== null
  );
  if (!targets.length) return 0;
  await upsertRows(c, targets.map(rowFor));
  return targets.length;
}

/** Pull all remote rows into localStorage + SQLite. Returns count applied. */
export async function pullAll(): Promise<number> {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');
  pulling = true;
  try {
    let applied = 0;
    let from = 0;
    const PAGE = 500;
    for (;;) {
      const { data, error } = await c.from(TABLE).select('*').range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const row of data as { key: string; value: string | null }[]) {
        if (!row.key || row.value == null) continue;
        if (!(SYNC_KEYS as string[]).includes(row.key)) continue;
        writeLocal(row.key, row.value);
        applied++;
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return applied;
  } finally {
    pulling = false;
  }
}

// ─── Debounced auto-sync hook used by storage.ts ───────────────────

const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function maybeSyncToSupabase(key: string): void {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled || pulling) return;
  if (!(SYNC_KEYS as string[]).includes(key)) return;
  pending.add(key);
  if (!flushTimer) flushTimer = setTimeout(flushPending, 3000);
}

async function flushPending(): Promise<void> {
  flushTimer = null;
  const keys = [...pending];
  pending.clear();
  if (!keys.length) return;
  const c = getClient();
  if (!c) return;
  const rows = keys.filter(k => localStorage.getItem(k) !== null).map(rowFor);
  if (!rows.length) return;
  try {
    await upsertRows(c, rows);
  } catch (e) {
    console.warn('[SupabaseSync] auto-push failed:', e);
  }
}

// ─── SQL setup snippet shown in Settings ───────────────────────────

export const SETUP_SQL = `-- Run once in the Supabase SQL Editor

-- 1) Settings + documents mirror
create table if not exists ${TABLE} (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- 2) Cached quotes (one row per symbol, data = JSON)
create table if not exists ${QUOTES_TABLE} (
  symbol text primary key,
  data text not null,
  updated_at timestamptz not null default now()
);

-- 3) Historical OHLCV bars (one row per symbol+date)
create table if not exists ${HISTORICAL_TABLE} (
  symbol text not null,
  date text not null,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume bigint,
  updated_at timestamptz not null default now(),
  primary key (symbol, date)
);

alter table ${TABLE} enable row level security;
alter table ${QUOTES_TABLE} enable row level security;
alter table ${HISTORICAL_TABLE} enable row level security;

create policy "Allow all for anon" on ${TABLE}
  for all using (true) with check (true);
create policy "Allow all for anon" on ${QUOTES_TABLE}
  for all using (true) with check (true);
create policy "Allow all for anon" on ${HISTORICAL_TABLE}
  for all using (true) with check (true);`;

// ─── Stock data sync (quotes + historical bars) ────────────────────

interface RemoteQuoteRow {
  symbol: string;
  data: string;
  updated_at: string | number;
}

interface RemoteBarRow {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  updated_at: string | number;
}

/**
 * Push all cached quotes and historical bars from SQLite to Supabase.
 * Returns { quotes, bars } counts pushed.
 */
export async function pushStockData(): Promise<{ quotes: number; bars: number }> {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');

  const [quoteRows, barRows] = await Promise.all([getAllCachedQuotes(), getAllHistoricalRows()]);

  const CHUNK = 500;

  const quotePayload = quoteRows.map(r => ({
    symbol: r.symbol.toUpperCase(),
    data: r.data,
    updated_at: new Date(r.updated_at).toISOString(),
  }));
  for (let i = 0; i < quotePayload.length; i += CHUNK) {
    const { error } = await c.from(QUOTES_TABLE).upsert(quotePayload.slice(i, i + CHUNK), { onConflict: 'symbol' });
    if (error) throw new Error(`Quotes push failed: ${error.message}`);
  }

  const barPayload = barRows.map(r => ({
    symbol: r.symbol.toUpperCase(),
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    updated_at: new Date(r.updated_at).toISOString(),
  }));
  for (let i = 0; i < barPayload.length; i += CHUNK) {
    const { error } = await c.from(HISTORICAL_TABLE).upsert(barPayload.slice(i, i + CHUNK), { onConflict: 'symbol,date' });
    if (error) throw new Error(`Historical push failed: ${error.message}`);
  }

  return { quotes: quotePayload.length, bars: barPayload.length };
}

/** Pull all remote quotes + historical bars into local SQLite. Returns counts. */
export async function pullStockData(): Promise<{ quotes: number; bars: number }> {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');

  // Quotes
  let quoteCount = 0;
  {
    let from = 0;
    const PAGE = 500;
    for (;;) {
      const { data, error } = await c.from(QUOTES_TABLE).select('*').range(from, from + PAGE - 1);
      if (error) throw new Error(`Quotes pull failed: ${error.message}`);
      if (!data || data.length === 0) break;
      quoteCount += await bulkPutQuotes(
        (data as RemoteQuoteRow[]).map(r => ({
          symbol: r.symbol,
          data: r.data,
          updated_at: typeof r.updated_at === 'number' ? r.updated_at : Date.parse(r.updated_at),
        }))
      );
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // Historical bars
  let barCount = 0;
  {
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await c.from(HISTORICAL_TABLE).select('*').range(from, from + PAGE - 1);
      if (error) throw new Error(`Historical pull failed: ${error.message}`);
      if (!data || data.length === 0) break;
      barCount += await bulkPutHistoricalRows(data as RemoteBarRow[]);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  return { quotes: quoteCount, bars: barCount };
}
