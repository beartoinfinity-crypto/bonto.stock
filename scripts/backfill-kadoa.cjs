// One-time Kadoa full backfill orchestrator (local, resumable, sequential).
// Usage: node scripts/backfill-kadoa.cjs
// Resume: same command (progress: scripts/.kadoa-backfill-progress.json)

const fs = require('fs');
const path = require('path');

const CRON_SECRET = process.env.CRON_SECRET || '0mvixrnd7zl3ckow92us645jbhqet8yf1gap';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aqyaarnpmvvdzasjefje.supabase.co';
const KADOA_BASE = 'https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/main/public/data';
const PROGRESS_FILE = path.join(__dirname, '.kadoa-backfill-progress.json');
const POST_CHUNK = 500;
const GET_TIMEOUT_MS = 90000;
const POST_TIMEOUT_MS = 90000;
const MAX_RETRIES = 3;

function sideFrom(raw) {
  const tt = String(raw ?? '').toLowerCase();
  if (tt.includes('purchase') || tt.includes('buy')) return 'BUY';
  if (tt.includes('sale') || tt.includes('sell')) return 'SELL';
  if (tt.includes('exchange')) return 'EXCHANGE';
  return 'OTHER';
}

function unwrapTrades(body) {
  if (Array.isArray(body)) return body;
  const trades = body && typeof body === 'object' ? body.trades : null;
  return Array.isArray(trades) ? trades : [];
}

function mapTrade(r, filer) {
  const office = r.office ?? filer?.office ?? null;
  const agency = r.agency ?? filer?.agency ?? null;
  const txDate = String(r.transaction_date ?? '').slice(0, 10);
  const filing = r.filing_date ? String(r.filing_date).slice(0, 10) : null;
  if (!r.ticker || !/^\d{4}-\d{2}-\d{2}$/.test(txDate)) return null;
  return {
    symbol: String(r.ticker),
    politician: String(r.filer_name || filer?.full_name || ''),
    transaction_date: txDate,
    filing_date: filing && /^\d{4}-\d{2}-\d{2}$/.test(filing) ? filing : null,
    transaction_type: sideFrom(r.transaction_type),
    amount_from: typeof r.amount_range_low === 'number' ? r.amount_range_low : null,
    amount_to: typeof r.amount_range_high === 'number' ? r.amount_range_high : null,
    asset_name: r.asset_name ? String(r.asset_name) : null,
    owner_type: r.owner ? String(r.owner) : null,
    position_held: office || agency || null,
    source: 'kadoa',
    external_id: String(r.id ?? ''),
    metadata: {
      filer_id: r.filer_id ?? filer?.id ?? null,
      source_id: r.source_id ?? null,
      filing_type: r.filing_type ?? null,
      notification_date: r.notification_date ?? null,
      doc_url: r.doc_url ?? null,
      is_late: r.is_late ?? null,
      days_to_file: r.days_to_file ?? null,
      comment: r.comment ?? null,
      branch: r.branch ?? filer?.branch ?? null,
      chamber: filer?.chamber ?? null,
      party: filer?.party ?? null,
      state: filer?.state ?? null,
      office,
      agency,
      asset_type: r.asset_type ?? null,
    },
  };
}

async function withTimeout(promiseFactory, ms, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promiseFactory(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const text = await withTimeout(async (signal) => {
        const res = await fetch(url, {
          signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (StockPulse backfill)' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      }, GET_TIMEOUT_MS, url);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr;
}

async function postJson(pathname, body) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const text = await withTimeout(async (signal) => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${pathname}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
          body: JSON.stringify(body),
          signal,
        });
        const t = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
        return t;
      }, POST_TIMEOUT_MS, pathname);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr;
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { done: {}, failed: [], counts: {}, written: 0, fetched: 0, skipped: 0 };
  }
}

function saveProgress(p) {
  // Windows EPERM on rename is common (AV/indexer briefly holds the file).
  // Retry rename, then fall back to a direct overwrite.
  const tmp = `${PROGRESS_FILE}.tmp`;
  const data = JSON.stringify(p);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, PROGRESS_FILE);
      return;
    } catch (e) {
      if (attempt === 5) {
        try {
          fs.writeFileSync(PROGRESS_FILE, data, 'utf8');
          return;
        } catch {
          throw e;
        }
      }
      // Busy: wait and retry (progress loss is worse than a pause).
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * attempt);
    }
  }
}

async function flushRows(rows, progress) {
  for (let i = 0; i < rows.length; i += POST_CHUNK) {
    const slice = rows.slice(i, i + POST_CHUNK);
    const res = await postJson('upsert-kadoa-trades', { rows: slice });
    progress.written += res.written || 0;
    progress.skipped += res.skipped || 0;
  }
}

async function main() {
  const offset = Number(process.env.OFFSET || 0);
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;

  console.log('[backfill] fetching filers.json...');
  const filers = await getJson(`${KADOA_BASE}/filers.json`);
  if (!Array.isArray(filers) || filers.length === 0) throw new Error('filers.json empty');
  const window = filers.slice(offset, offset + (Number.isFinite(limit) ? limit : filers.length));

  const progress = loadProgress();
  const pending = window.filter((f) => !progress.done[String(f.id)]);
  console.log(`[backfill] window=${window.length} pending=${pending.length} alreadyDone=${window.length - pending.length}`);
  if (pending.length === 0) {
    const allDone = filers.every((f) => progress.done[String(f.id)]);
    if (allDone) await finalizeMeta(progress, filers);
    console.log('[backfill] window already complete');
    return;
  }

  const buffer = [];
  const failed = [];

  for (let i = 0; i < pending.length; i++) {
    const filer = pending[i];
    const t0 = Date.now();
    try {
      const body = await getJson(`${KADOA_BASE}/filer/${filer.id}.json`);
      const trades = unwrapTrades(body);
      const mapped = [];
      for (const r of trades) {
        const row = mapTrade(r, filer);
        if (row) mapped.push(row);
        else progress.skipped++;
      }
      progress.counts[String(filer.id)] = trades.length;
      buffer.push(...mapped);
      progress.fetched += mapped.length;
      if (buffer.length >= POST_CHUNK) {
        await flushRows(buffer, progress);
        buffer.length = 0;
      }
      progress.done[String(filer.id)] = { trades: trades.length, at: Date.now() };
      console.log(`[backfill] ${i + 1}/${pending.length} ok ${filer.id} trades=${trades.length} rows=${mapped.length} ${Date.now() - t0}ms written=${progress.written}`);
      saveProgress(progress);
    } catch (e) {
      failed.push(filer.id);
      console.warn(`[backfill] fail ${filer.id}: ${e.message} ${Date.now() - t0}ms`);
      saveProgress(progress);
    }
  }

  if (buffer.length) {
    await flushRows(buffer, progress);
    buffer.length = 0;
  }

  const remaining = window.filter((f) => !progress.done[String(f.id)]);
  progress.failed = Array.from(new Set([...(progress.failed || []), ...failed]));
  saveProgress(progress);

  const allDone = filers.every((f) => progress.done[String(f.id)]);
  if (allDone) await finalizeMeta(progress, filers);

  console.log(JSON.stringify({
    ok: remaining.length === 0,
    remaining: remaining.length,
    allDone,
    fetched: progress.fetched,
    written: progress.written,
    skipped: progress.skipped,
    failed: failed.length,
  }, null, 2));
  if (remaining.length > 0) process.exitCode = 2;
}

async function finalizeMeta(progress, filers) {
  // Only send counts for filers we fully processed.
  const counts = {};
  for (const f of filers) {
    const id = String(f.id);
    if (progress.done[id]) counts[id] = progress.counts[id] ?? f.trade_count ?? 0;
  }
  await postJson('upsert-kadoa-trades', { rows: [], counts });
  console.log(`[backfill] meta counts written for ${Object.keys(counts).length} filers`);
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});
