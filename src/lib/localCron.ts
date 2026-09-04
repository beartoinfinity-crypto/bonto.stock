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

// ─── Local job implementations ─────────────────────────────────────

// NOTE: sync-stock-data, sync-politician-trades, simulate-ledger and
// sync-featured-trades previously lived here. They now run as Supabase
// scheduled Edge Functions (pg_cron) — see supabase/functions/ and
// supabase/schedules.sql. The browser no longer runs them, to prevent
// duplicate runs against the same cloud rows.

// ─── Local archive job (SQLite backup) ──────────────────────────────

async function runSqliteArchive(): Promise<{ ok: boolean; message: string }> {  // Flush any debounced writes so the .db file / IndexedDB snapshot is current
  const { persistNow, getStats } = await import('@/lib/localDb');
  await persistNow();
  const s = await getStats();
  return {
    ok: true,
    message: `Archived to local SQLite: ${s.quotes} quotes, ${s.historical} bars, ${s.config} config, ${s.documents} docs${s.file ? ` (${s.file})` : ''}`,
  };
}

// ─── Cloud -> Local pull job ────────────────────────────────────────

// Keeps the local SQLite mirror in sync with Supabase (primary store).
// Server-side Edge Functions write fresh data to the cloud; this job
// brings it down so the offline .db archive never goes stale.
async function runPullFromSupabase(): Promise<{ ok: boolean; message: string }> {
  const { getClient, pullStockData } = await import('@/lib/supabaseDb');
  if (!getClient()) return { ok: false, message: 'Supabase not configured or disabled' };
  const r = await pullStockData();
  // Notify UI so React Query refetches from the refreshed cache
  window.dispatchEvent(new Event('stockpulse-sync'));
  return {
    ok: true,
    message: `Pulled ${r.quotes} quotes + ${r.bars} price bars from Supabase into local SQLite`,
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
  // simulate-ledger, sync-stock-data, sync-politician-trades and
  // sync-featured-trades run server-side as Supabase scheduled Edge
  // Functions (pg_cron) — see supabase/schedules.sql. Only local-machine
  // maintenance jobs remain here.
  {
    id: 'archive-sqlite',
    label: 'Local SQLite archive',
    schedule: '30 8 * * *',
    description: 'Flush any pending writes into the local SQLite backup (.db file / IndexedDB) and report archive stats.',
    enabled: loadEnabledState()['archive-sqlite'] ?? false,
    run: runSqliteArchive,
  },
  {
    id: 'pull-stock-data',
    label: 'Stock data ← Supabase',
    schedule: '0 9 * * 1-5',
    description: 'Pull quotes + price bars from Supabase (primary) into the local SQLite mirror so offline data stays fresh.',
    enabled: loadEnabledState()['pull-stock-data'] ?? false,
    run: runPullFromSupabase,
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
const runningJobs = new Set<string>();

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
