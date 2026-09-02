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
import { LEDGER_KEY } from './tradeSimulator';
import type { LedgerStore } from './tradeSimulator';
import { mergeLedgers } from './ledgerMerge';

export const SUPABASE_CONFIG_KEY = 'stockpulse_supabase_config';
export const TABLE = 'stockpulse_kv';
export const QUOTES_TABLE = 'stock_quotes';
export const HISTORICAL_TABLE = 'stock_historical';
export const FEATURED_TRADES_TABLE = 'politician_featured_trades';

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

// ─── Server-managed config (configure once on Render) ──────────────

let remoteConfigPromise: Promise<SupabaseConfig | null> | null = null;

/**
 * Fetch the sync config from the server (`/api/sync-config`, backed by the
 * Render env vars SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SYNC_ENABLED).
 * This is the "configure once, every browser obeys" path — when it returns a
 * config it is authoritative and overrides any per-browser Settings values.
 * Resolves null on 404/network failure so the app falls back to local config.
 */
export function fetchRemoteSyncConfig(): Promise<SupabaseConfig | null> {
  if (!remoteConfigPromise) {
    remoteConfigPromise = (async () => {
      try {
        const res = await fetch('/api/sync-config');
        if (!res.ok) return null;
        const cfg = (await res.json()) as { url?: string; anonKey?: string; enabled?: boolean };
        if (!cfg.url || !cfg.anonKey) return null;
        const remote: SupabaseConfig = { url: cfg.url, anonKey: cfg.anonKey, enabled: cfg.enabled !== false };
        saveSupabaseConfig(remote);
        return remote;
      } catch {
        return null;
      }
    })();
  }
  return remoteConfigPromise;
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

function safeParse<T = unknown>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Fetch a single remote KV row (null when absent). */
async function fetchRow(c: SupabaseClient, key: string): Promise<KVRow | null> {
  const { data, error } = await c.from(TABLE).select('key,value').eq('key', key).limit(1);
  if (error) throw new Error(error.message);
  return data && data.length ? ({ key: data[0].key, value: data[0].value as string } as KVRow) : null;
}

/**
 * Merge two ledger JSON values with the lossless `mergeLedgers` union so
 * concurrent machines never overwrite each other's simulated days. Falls back
 * to the local value when either side isn't a (parseable) ledger.
 */
function mergeLedgerValue(localValue: string, remoteValue: string | null): string {
  const local = safeParse<LedgerStore>(localValue);
  if (!local || !Array.isArray(local.trades)) return localValue;
  const remote = safeParse<LedgerStore>(remoteValue ?? '');
  if (!remote || !Array.isArray(remote.trades)) return localValue;
  try {
    return JSON.stringify(mergeLedgers(local, remote));
  } catch {
    return localValue;
  }
}

// ─── Push / Pull ───────────────────────────────────────────────────

/** Push all tracked keys (or a specific subset) to Supabase. Returns count. */
export async function pushKeys(keys?: string[]): Promise<number> {
  await fetchRemoteSyncConfig();
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');
  const targets = (keys && keys.length ? keys : SYNC_KEYS).filter(
    k => localStorage.getItem(k) !== null
  );
  if (!targets.length) return 0;
  const rows = targets.map(rowFor);
  await mergeLedgerRowInto(c, rows);
  await upsertRows(c, rows);
  return targets.length;
}

/**
 * Replace the cloud ledger row with `next` verbatim (no union merge). Used by
 * "Reset today" so the cleared state actually lands in the cloud — otherwise
 * the next auto-push would re-merge the removed fills back in. No-op (false)
 * when cloud sync is off.
 */
export async function overwriteLedger(next: LedgerStore): Promise<boolean> {
  await fetchRemoteSyncConfig();
  const c = getClient();
  if (!c) return false;
  try {
    await c.from(TABLE).upsert(
      { key: LEDGER_KEY, value: JSON.stringify(next), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    return true;
  } catch (e) {
    console.warn('[SupabaseSync] ledger overwrite failed:', e);
    return false;
  }
}

/** Pull all remote rows into localStorage + SQLite. Returns count applied. */
export async function pullAll(): Promise<number> {
  await fetchRemoteSyncConfig();
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
        if (row.key === LEDGER_KEY) {
          // True-merge the ledger: union this machine's days with the cloud's
          // (no last-writer-wins snapshots that drop another machine's history).
          writeLocal(LEDGER_KEY, mergeLedgerValue(localStorage.getItem(LEDGER_KEY) ?? '', row.value));
        } else {
          writeLocal(row.key, row.value);
        }
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

/**
 * Focused pre-decision pull: merge ONLY the cloud ledger into the local mirror
 * and return the fresh copy. Lets /ledger decide "has today's day run?" against
 * the *cloud* state right before auto-running, instead of its own stale local
 * snapshot. Returns null when cloud sync is off or unreachable (caller then
 * falls back to the local copy).
 */
export async function pullLedger(): Promise<LedgerStore | null> {
  await fetchRemoteSyncConfig();
  const c = getClient();
  if (!c) return null;
  try {
    const local = localStorage.getItem(LEDGER_KEY) ?? '';
    const remote = await fetchRow(c, LEDGER_KEY);
    const merged = mergeLedgerValue(local, remote?.value ?? null);
    if (merged !== local) writeLocal(LEDGER_KEY, merged);
    return safeParse<LedgerStore>(merged);
  } catch (e) {
    console.warn('[SupabaseSync] pre-run ledger pull failed:', e);
    return null;
  }
}

export function maybeSyncToSupabase(key: string): void {
  if (pulling) return;
  if (!(SYNC_KEYS as string[]).includes(key)) return;
  // The actual enable/disable decision happens at flush time so a browser that
  // has NO local config still starts syncing once the server config arrives.
  pending.add(key);
  if (!flushTimer) flushTimer = setTimeout(flushPending, 3000);
}

async function flushPending(): Promise<void> {
  flushTimer = null;
  const keys = [...pending];
  pending.clear();
  if (!keys.length) return;
  await fetchRemoteSyncConfig();
  const c = getClient();
  if (!c) return;
  const rows = keys.filter(k => localStorage.getItem(k) !== null).map(rowFor);
  if (!rows.length) return;
  try {
    await mergeLedgerRowInto(c, rows);
    await upsertRows(c, rows);
    console.log('[SupabaseSync] auto-pushed', rows.length, 'key(s):', rows.map(r => r.key).join(', '));
  } catch (e) {
    console.warn('[SupabaseSync] auto-push failed:', e);
  }
}

/**
 * If the outgoing rows contain the trade ledger, merge it against the current
 * cloud copy first (union, no history loss) and absorb the merged value back
 * into the local mirror so this machine sees the other machines' days too.
 */
async function mergeLedgerRowInto(c: SupabaseClient, rows: KVRow[]): Promise<void> {
  const ledgerRow = rows.find(r => r.key === LEDGER_KEY);
  if (!ledgerRow) return;
  const remote = await fetchRow(c, LEDGER_KEY);
  const merged = mergeLedgerValue(ledgerRow.value, remote?.value ?? null);
  ledgerRow.value = merged;
  if (remote) writeLocal(LEDGER_KEY, merged);
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

-- 4) Featured politician trades (Trump, Pelosi, etc.)
create table if not exists ${FEATURED_TRADES_TABLE} (
  id text primary key,
  politician text not null,
  symbol text not null,
  transaction_type text not null,
  transaction_date text,
  filing_date text,
  amount_from double precision,
  amount_to double precision,
  asset_name text,
  source_name text,
  source_url text,
  metadata jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists idx_featured_trades_politician on ${FEATURED_TRADES_TABLE}(politician);

alter table ${TABLE} enable row level security;
alter table ${QUOTES_TABLE} enable row level security;
alter table ${HISTORICAL_TABLE} enable row level security;
alter table ${FEATURED_TRADES_TABLE} enable row level security;

create policy "Allow all for anon" on ${TABLE}
  for all using (true) with check (true);
create policy "Allow all for anon" on ${QUOTES_TABLE}
  for all using (true) with check (true);
create policy "Allow all for anon" on ${HISTORICAL_TABLE}
  for all using (true) with check (true);
create policy "Allow all for anon" on ${FEATURED_TRADES_TABLE}
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

// ─── Featured politician trades sync ─────────────────────────────

export interface FeaturedTradeRow {
  id: string;
  politician: string;
  symbol: string;
  transaction_type: string;
  transaction_date: string | null;
  filing_date: string | null;
  amount_from: number | null;
  amount_to: number | null;
  asset_name: string | null;
  source_name: string;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
}

/** Push featured politician trades to Supabase. Upserts by id. */
export async function pushFeaturedTrades(trades: FeaturedTradeRow[]): Promise<number> {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');
  if (!trades.length) return 0;

  const CHUNK = 100;
  for (let i = 0; i < trades.length; i += CHUNK) {
    const chunk = trades.slice(i, i + CHUNK).map(t => ({
      ...t,
      metadata: t.metadata ? JSON.stringify(t.metadata) : null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await c.from(FEATURED_TRADES_TABLE).upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`Featured trades push failed: ${error.message}`);
  }
  return trades.length;
}

/** Pull all featured politician trades from Supabase. Returns array. */
export async function pullFeaturedTrades(): Promise<FeaturedTradeRow[]> {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');

  const all: FeaturedTradeRow[] = [];
  let from = 0;
  const PAGE = 500;
  for (;;) {
    const { data, error } = await c.from(FEATURED_TRADES_TABLE).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`Featured trades pull failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as FeaturedTradeRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/** One-time cleanup: rename old "Last, First" politician names to "First Last" format. */
export async function normalizeFeaturedTradeNames(): Promise<number> {
  const c = getClient();
  if (!c) return 0;
  const renames: Array<{ from: string; to: string }> = [
    { from: 'Trump, Donald J', to: 'Donald J Trump' },
    { from: 'Trump, Donald J.', to: 'Donald J Trump' },
    { from: 'Donald J. Trump', to: 'Donald J Trump' },
    { from: 'Pelosi, Nancy', to: 'Nancy Pelosi' },
  ];
  let total = 0;
  for (const { from, to } of renames) {
    const { data } = await c.from(FEATURED_TRADES_TABLE)
      .select('id').eq('politician', from);
    if (!data?.length) continue;
    const ids = data.map(r => r.id);
    const { error } = await c.from(FEATURED_TRADES_TABLE)
      .update({ politician: to }).in('id', ids);
    if (!error) total += ids.length;
  }
  return total;
}

/** Pull featured trades for a specific politician from Supabase. */
export async function pullFeaturedTradesFor(politician: string): Promise<FeaturedTradeRow[]> {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured or disabled');

  const { data, error } = await c.from(FEATURED_TRADES_TABLE)
    .select('*')
    .eq('politician', politician)
    .order('transaction_date', { ascending: false });
  if (error) throw new Error(`Featured trades pull failed: ${error.message}`);
  return (data as FeaturedTradeRow[]) ?? [];
}
