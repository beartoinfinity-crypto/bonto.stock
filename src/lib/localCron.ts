// Local cron scheduler — runs in the browser
// Supabase jobs are primary (fetch + push to cloud); archive-sqlite flushes
// the local SQLite backup.

import * as storage from '@/lib/storage';

const HISTORY_KEY = 'stockpulse_cron_history';
const MAX_HISTORY = 200;

// ─── Types ─────────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  label: string;
  schedule: string;       // cron expression: "min hour dom month dow"
  description: string;
  enabled: boolean;
  run: () => Promise<{ ok: boolean; message: string }>;
}

export interface CronRun {
  jobId: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  error: string | null;
  message: string;
  durationMs: number;
}

// ─── Cron expression parser ────────────────────────────────────────

function expandRange(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? parseInt(stepRaw, 10) : 1;
    let lo = min, hi = max;
    if (range !== '*') {
      const bits = range.split('-');
      lo = parseInt(bits[0], 10);
      hi = bits[1] !== undefined ? parseInt(bits[1], 10) : (stepRaw ? max : lo);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].filter(v => v >= min && v <= max).sort((a, b) => a - b);
}

function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minF, hourF, domF, monthF, dowF] = parts;
  const mins = expandRange(minF, 0, 59);
  const hours = expandRange(hourF, 0, 23);
  const doms = expandRange(domF, 1, 31);
  const months = expandRange(monthF, 1, 12);
  const dows = expandRange(dowF, 0, 6).map(d => (d === 7 ? 0 : d));
  return mins.includes(date.getUTCMinutes()) &&
    hours.includes(date.getUTCHours()) &&
    doms.includes(date.getUTCDate()) &&
    months.includes(date.getUTCMonth() + 1) &&
    dows.includes(date.getUTCDay());
}

// ─── CORS proxy helper ─────────────────────────────────────────────

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(url: string, timeoutMs = 15000): Promise<Response> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* try proxies */ }
  for (const proxy of CORS_PROXIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(proxy(url), { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
    } catch { continue; }
  }
  throw new Error('All fetch methods failed');
}

// ─── Local job implementations ─────────────────────────────────────

function parseAmountRange(s: string): { from: number | null; to: number | null } {
  const clean = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || null;
  if (!s) return { from: null, to: null };
  const parts = s.split(/\s*[-–]\s*/);
  if (parts.length === 2) return { from: clean(parts[0]), to: clean(parts[1]) };
  return { from: clean(s), to: null };
}

function mapCapitolExposed(r: any) {
  const tt = String(r.transaction_type ?? '').toLowerCase();
  let side = 'OTHER';
  if (tt === 'purchase' || tt === 'buy') side = 'BUY';
  else if (tt === 'sale' || tt === 'sale_full' || tt === 'sell') side = 'SELL';
  else if (tt === 'exchange' || tt === 'exchange_received' || tt === 'exchange_sold') side = 'EXCHANGE';
  return {
    id: String(r.id ?? ''),
    symbol: String(r.ticker ?? ''),
    politician: String(r.member_name ?? ''),
    transaction_date: String(r.transaction_date ?? '').slice(0, 10),
    filing_date: r.disclosure_date ? String(r.disclosure_date).slice(0, 10) : null,
    transaction_type: side,
    amount_from: r.amount_min ? Number(String(r.amount_min).replace(/[^0-9.]/g, '')) || null : null,
    amount_to: r.amount_max ? Number(String(r.amount_max).replace(/[^0-9.]/g, '')) || null : null,
    asset_name: r.asset_description ? String(r.asset_description) : null,
    position_held: r.owner ? String(r.owner) : null,
  };
}

function mapCongressInvests(r: any) {
  const tt = String(r.trade_type ?? '').toLowerCase();
  let side = 'OTHER';
  if (tt === 'buy' || tt === 'purchase') side = 'BUY';
  else if (tt === 'sell' || tt === 'sale') side = 'SELL';
  const { from, to } = parseAmountRange(String(r.amount ?? ''));
  return {
    id: `ci-${r.link ?? ''}`,
    symbol: String(r.ticker ?? ''),
    politician: String(r.member ?? ''),
    transaction_date: String(r.tx_date ?? '').slice(0, 10),
    filing_date: r.disclosed ? String(r.disclosed).slice(0, 10) : null,
    transaction_type: side,
    amount_from: from,
    amount_to: to,
    asset_name: r.asset ? String(r.asset) : null,
    position_held: r.chamber ? String(r.chamber) : null,
  };
}

async function runPoliticianTrades(): Promise<{ ok: boolean; message: string }> {
  const start = Date.now();

  // Source 1: CapitolExposed API (recent ~30 days)
  const capitolTrades: unknown[] = [];
  for (let page = 1; page <= 10; page++) {
    try {
      const res = await proxyFetch(`https://www.capitolexposed.com/api/v1/trades?page=${page}&per_page=100`);
      const json = await res.json();
      const data = json?.data ?? (Array.isArray(json) ? json : []);
      if (!Array.isArray(data) || data.length === 0) break;
      capitolTrades.push(...data);
      const hasMore = json?.meta?.has_more ?? data.length >= 100;
      if (!hasMore) break;
    } catch { break; }
  }

  // Source 2: CongressInvests API (full history back to 2015, House + Senate)
  const congressTrades: unknown[] = [];
  const PAGE_SIZE = 500;
  const maxOffset = 6000;
  for (let offset = 0; offset < maxOffset; offset += PAGE_SIZE) {
    try {
      const res = await proxyFetch(`https://congressinvests.com/trades?limit=${PAGE_SIZE}&offset=${offset}`);
      const json = await res.json();
      const trades = json?.trades ?? [];
      if (!Array.isArray(trades) || trades.length === 0) break;
      congressTrades.push(...trades);
      if (!json?.has_more) break;
    } catch { break; }
  }

  if (capitolTrades.length === 0 && congressTrades.length === 0) {
    return { ok: false, message: 'No trades fetched from either API' };
  }

  // Map both sources to TradeRow format
  const mappedCapitol = capitolTrades.map(mapCapitolExposed);
  const mappedCongress = congressTrades.map(mapCongressInvests);

  // Merge: CongressInvests has broader history, CapitolExposed has latest — combine and dedup
  // Use a composite key (symbol+politician+date+type) to dedup across sources
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const t of [...mappedCongress, ...mappedCapitol]) {
    const key = `${t.symbol}|${t.politician}|${t.transaction_date}|${t.transaction_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  // Merge with existing data — keep imported trades that aren't in the fetched set
  const existingRaw = storage.getItem('stockpulse_politician_trades');
  let existing: { data?: unknown[]; fetchedAt?: number } = {};
  try { existing = JSON.parse(existingRaw || '{}'); } catch { /* ignore */ }
  const existingData: unknown[] = existing?.data ?? (Array.isArray(existing) ? existing : []);

  // Build a set of fetched trade IDs (also use composite keys for dedup with existing)
  const fetchedKeys = new Set(deduped.map((t: any) => `${t.symbol}|${t.politician}|${t.transaction_date}|${t.transaction_type}`));
  // Keep existing trades whose composite key is NOT in the fetched set
  const preserved = existingData.filter((t: any) => {
    const key = `${t.symbol}|${t.politician}|${t.transaction_date}|${t.transaction_type}`;
    return !fetchedKeys.has(key);
  });

  const merged = [...deduped, ...preserved];
  // Sort by disclosed date newest first, fall back to transaction date
  merged.sort((a: any, b: any) => {
    const da = a.filing_date || a.transaction_date;
    const db = b.filing_date || b.transaction_date;
    return db.localeCompare(da);
  });
  storage.setItem('stockpulse_politician_trades', JSON.stringify({ data: merged, fetchedAt: Date.now() }));
  window.dispatchEvent(new Event('stockpulse-politician-sync'));

  // PRIMARY TARGET: push merged trades to Supabase when cloud sync is on
  let cloudNote = '';
  try {
    const { getClient, pushKeys } = await import('@/lib/supabaseDb');
    if (getClient()) {
      const n = await pushKeys(['stockpulse_politician_trades']);
      cloudNote = n > 0 ? ` | Supabase: pushed` : ' | Supabase: nothing to push';
    }
  } catch (e) {
    console.warn('[LocalCron] Supabase push failed:', e);
    cloudNote = ' | Supabase push FAILED';
  }

  return {
    ok: true,
    message: `Fetched ${capitolTrades.length} from CapitolExposed + ${congressTrades.length} from CongressInvests (${deduped.length} unique), kept ${preserved.length} imported records (${((Date.now() - start) / 1000).toFixed(1)}s)${cloudNote}`,
  };
}

async function runSyncStockData(): Promise<{ ok: boolean; message: string }> {
  const { popularStocks } = await import('@/lib/stockData');
  const { fetchStockQuote, fetchHistoricalData } = await import('@/lib/stockApi');
  const symbols = popularStocks.slice(0, 20).map(s => s.symbol);
  let quotesSynced = 0;
  let historySynced = 0;
  for (const sym of symbols) {
    try {
      const q = await fetchStockQuote(sym, true);
      if (q.isRealData) quotesSynced++;
    } catch { /* skip */ }
    try {
      const h = await fetchHistoricalData(sym, true);
      if (h.isRealData) historySynced++;
    } catch { /* skip */ }
  }
  // Notify UI to refetch stale queries
  window.dispatchEvent(new Event('stockpulse-sync'));

  // PRIMARY TARGET: push fetched stock data to Supabase when cloud sync is on
  let cloudNote = '';
  try {
    const { getClient, pushStockData } = await import('@/lib/supabaseDb');
    if (getClient()) {
      const r = await pushStockData();
      cloudNote = r.quotes + r.bars > 0
        ? ` | Supabase: ${r.quotes} quotes + ${r.bars} bars pushed`
        : ' | Supabase: nothing to push';
    }
  } catch (e) {
    console.warn('[LocalCron] Supabase push failed:', e);
    cloudNote = ' | Supabase push FAILED';
  }

  return { ok: quotesSynced > 0, message: `Synced ${quotesSynced} quotes, ${historySynced} histories${cloudNote}` };
}

// ─── Local archive job (SQLite backup) ──────────────────────────────

async function runSqliteArchive(): Promise<{ ok: boolean; message: string }> {
  // Flush any debounced writes so the .db file / IndexedDB snapshot is current
  const { persistNow, getStats } = await import('@/lib/localDb');
  await persistNow();
  const s = await getStats();
  return {
    ok: true,
    message: `Archived to local SQLite: ${s.quotes} quotes, ${s.historical} bars, ${s.config} config, ${s.documents} docs${s.file ? ` (${s.file})` : ''}`,
  };
}

// ─── Job definitions ───────────────────────────────────────────────

const CRON_ENABLED_KEY = 'stockpulse_cron_enabled';

function loadEnabledState(): Record<string, boolean> {
  try { return JSON.parse(storage.getItem(CRON_ENABLED_KEY) || '{}'); } catch { return {}; }
}

function persistEnabledState() {
  const state: Record<string, boolean> = {};
  for (const j of CRON_JOBS) state[j.id] = j.enabled;
  storage.setItem(CRON_ENABLED_KEY, JSON.stringify(state));
}

export const CRON_JOBS: CronJob[] = [
  {
    id: 'sync-stock-data',
    label: 'Stock quotes → Supabase',
    schedule: '0 6 * * 1-5',
    description: 'Fetch quotes + history for top 20 stocks, store to Supabase (primary). SQLite copy happens automatically on write.',
    enabled: loadEnabledState()['sync-stock-data'] ?? false,
    run: runSyncStockData,
  },
  {
    id: 'sync-politician-trades',
    label: 'Politician trades → Supabase',
    schedule: '0 7 * * 1-5',
    description: 'Fetch congressional trading disclosures (CapitolExposed + CongressInvests), store to Supabase (primary).',
    enabled: loadEnabledState()['sync-politician-trades'] ?? false,
    run: runPoliticianTrades,
  },
  {
    id: 'archive-sqlite',
    label: 'Local SQLite archive',
    schedule: '30 8 * * *',
    description: 'Flush all pending writes into the local SQLite backup (.db file / IndexedDB) and report archive stats.',
    enabled: loadEnabledState()['archive-sqlite'] ?? false,
    run: runSqliteArchive,
  },
];

// ─── Run history ───────────────────────────────────────────────────

function loadHistory(): CronRun[] {
  try { return JSON.parse(storage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveHistory(runs: CronRun[]) {
  storage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(-MAX_HISTORY)));
}

function recordRun(run: CronRun) {
  const runs = loadHistory();
  runs.push(run);
  saveHistory(runs);
}

export function getRunHistory(jobId?: string): CronRun[] {
  const runs = loadHistory();
  if (jobId) return runs.filter(r => r.jobId === jobId);
  return runs;
}

export function getLastRun(jobId: string): CronRun | null {
  const runs = loadHistory().filter(r => r.jobId === jobId);
  return runs.length > 0 ? runs[runs.length - 1] : null;
}

// ─── Next run calculation ──────────────────────────────────────────

export function getNextRun(job: CronJob): Date | null {
  const now = new Date();
  for (let i = 0; i < 7 * 24 * 60; i++) {
    const candidate = new Date(now.getTime() + i * 60_000);
    candidate.setUTCSeconds(0, 0);
    if (cronMatches(job.schedule, candidate)) return candidate;
  }
  return null;
}

// ─── Execute a job ─────────────────────────────────────────────────

// Note: each job handles its own Supabase push explicitly inside run()
// (Supabase = primary store). The archive-sqlite job flushes the local
// SQLite backup. No generic post-run hook needed anymore.

async function runJob(job: CronJob): Promise<CronRun> {
  const run: CronRun = {
    jobId: job.id,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: false,
    error: null,
    message: '',
    durationMs: 0,
  };

  const start = Date.now();
  try {
    const result = await job.run();
    run.ok = result.ok;
    run.message = result.message;
  } catch (e) {
    run.error = e instanceof Error ? e.message : 'Unknown error';
  }

  run.durationMs = Date.now() - start;
  run.finishedAt = new Date().toISOString();
  recordRun(run);
  return run;
}

// ─── Scheduler loop ────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let runningJobs = new Set<string>();

function checkAndRun() {
  const now = new Date();
  now.setUTCSeconds(0, 0);

  for (const job of CRON_JOBS) {
    if (!job.enabled) continue;
    if (runningJobs.has(job.id)) continue;
    if (!cronMatches(job.schedule, now)) continue;

    const last = getLastRun(job.id);
    if (last) {
      const lastTime = new Date(last.startedAt);
      if (lastTime.getUTCFullYear() === now.getUTCFullYear() &&
          lastTime.getUTCMonth() === now.getUTCMonth() &&
          lastTime.getUTCDate() === now.getUTCDate() &&
          lastTime.getUTCHours() === now.getUTCHours() &&
          lastTime.getUTCMinutes() === now.getUTCMinutes()) {
        continue;
      }
    }

    runningJobs.add(job.id);
    console.log(`[LocalCron] Running: ${job.label}`);
    runJob(job).then(run => {
      runningJobs.delete(job.id);
      console.log(`[LocalCron] Finished: ${job.label} (${run.ok ? 'ok' : 'failed'} in ${run.durationMs}ms)`);
    });
  }
}

export function startScheduler() {
  if (intervalId) return;
  console.log('[LocalCron] Scheduler started (jobs disabled by default)');
  checkAndRun();
  intervalId = setInterval(checkAndRun, 60_000);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export async function triggerJob(jobId: string): Promise<CronRun> {
  const job = CRON_JOBS.find(j => j.id === jobId);
  if (!job) throw new Error(`Unknown job: ${jobId}`);
  runningJobs.add(job.id);
  try { return await runJob(job); } finally { runningJobs.delete(job.id); }
}

export function toggleJob(jobId: string, enabled: boolean) {
  const job = CRON_JOBS.find(j => j.id === jobId);
  if (job) {
    job.enabled = enabled;
    persistEnabledState();
  }
}

export function getJobStatuses() {
  return CRON_JOBS.map(job => ({
    ...job,
    lastRun: getLastRun(job.id),
    nextRun: getNextRun(job),
  }));
}
