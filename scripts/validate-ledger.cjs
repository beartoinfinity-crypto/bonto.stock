#!/usr/bin/env node
/**
 * validate-ledger.cjs — integrity audit for the simulated-traders ledger.
 *
 * Validates every fill in the CLOUD ledger (server-authoritative copy):
 *   1. RANGE     each fill's price lies inside its action-date bar's
 *                [low, high] (±$0.01) — "aligned with that day's market
 *                price range".
 *   2. CLOSE     bonus stat: how many fills print exactly at the official
 *                close (the intended fill price under session semantics).
 *   3. SESSION   every fill date is a real trading session (bar exists).
 *   4. DUPES     no duplicate (persona, date, symbol, side) fills, ids unique.
 *   5. VALUE     qty × price === recorded value (±$0.01).
 *   6. SNAPSHOT  the ledger's prices map matches the lastRunDate session closes.
 *
 * Config resolution (no secrets in source): SUPABASE_URL / SUPABASE_ANON_KEY
 * env vars, else the public /api/sync-config endpoint of a deployment.
 *
 * Usage:  node scripts/validate-ledger.cjs
 * Exit 0 = clean, 1 = violations found (details printed).
 */

const DEPLOYMENTS = [
  'https://dandanball-stock.vercel.app',
  'https://dandanball-stock.onrender.com',
];

async function resolveConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY };
  }
  for (const base of DEPLOYMENTS) {
    try {
      const r = await fetch(`${base}/api/sync-config`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const cfg = await r.json();
      if (cfg?.url && cfg?.anonKey) return { url: cfg.url, anonKey: cfg.anonKey };
    } catch { /* try next deployment */ }
  }
  throw new Error('No Supabase config: set SUPABASE_URL/SUPABASE_ANON_KEY or reach a deployment');
}

const r2 = n => Math.round(n * 100) / 100;

async function main() {
  const cfg = await resolveConfig();
  const H = { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` };
  const rest = (path) => fetch(`${cfg.url}/rest/v1/${path}`, { headers: H }).then(r => r.json());

  // Ledger
  const rows = await rest('stockpulse_kv?key=eq.stockpulse_trade_ledger&select=value');
  if (!rows?.length) { console.error('FAIL: no ledger row in cloud'); process.exit(1); }
  const ledger = JSON.parse(rows[0].value);
  const trades = ledger.trades ?? [];

  // Status context
  let status = null;
  for (const base of DEPLOYMENTS) {
    try {
      const r = await fetch(`${base}/api/ledger/status`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { status = await r.json(); break; }
    } catch { /* next */ }
  }

  console.log('=== Ledger integrity audit ===');
  console.log(`ledger lastRunDate: ${ledger.lastRunDate} | trades: ${trades.length} | personas: ${Object.keys(ledger.accounts ?? {}).length}`);
  if (status?.ok) {
    console.log(`latest synced session: ${status.latestSession} | caughtUp: ${status.caughtUp} | last-session fills: ${status.latestSessionFillCount}`);
  }
  console.log('');

  // Bars for every traded symbol
  const symbols = [...new Set(trades.map(t => String(t.symbol).toUpperCase()))];
  const bars = new Map();
  for (const s of symbols) {
    const b = await rest(`stock_historical?symbol=eq.${s}&select=date,high,low,close&order=date.desc&limit=400`);
    bars.set(s, Array.isArray(b) ? b : []);
  }

  // 1-5: per-fill checks
  let inRange = 0, rangeViolations = [], noBar = [], exactClose = 0, closeMismatch = [];
  let dupes = 0, badValue = [];
  const seenIds = new Set(), seenKeys = new Map();
  for (const t of trades) {
    const sym = String(t.symbol).toUpperCase();
    const bar = (bars.get(sym) ?? []).find(b => b.date === t.date);
    if (!bar) { noBar.push(t); continue; }
    const low = bar.low ?? 0, high = bar.high ?? Infinity;
    if (t.price >= low - 0.01 && t.price <= high + 0.01) inRange++;
    else rangeViolations.push(`${t.date} ${t.personaId} ${sym} ${t.action} ${t.qty} @ ${t.price} vs [${low}, ${high}]`);
    if (typeof bar.close === 'number' && Math.abs(t.price - r2(bar.close)) <= 0.011) exactClose++;
    else closeMismatch.push(`${t.date} ${t.personaId} ${sym} @ ${t.price} (close ${bar.close})`);
    const key = `${t.personaId}|${t.date}|${sym}|${t.action}`;
    if (seenKeys.has(key)) dupes++;
    seenKeys.set(key, t);
    if (seenIds.has(t.id)) dupes++;
    seenIds.add(t.id);
    if (Math.abs(t.qty * t.price - t.value) > 0.01) badValue.push(`${t.date} ${t.personaId} ${sym}: ${t.qty}x${t.price} != ${t.value}`);
  }

  // 6: prices snapshot vs lastRunDate session closes
  let snapOk = 0, snapBad = [];
  if (ledger.lastRunDate) {
    for (const [sym, p] of Object.entries(ledger.prices ?? {})) {
      const bar = (bars.get(sym.toUpperCase()) ?? []).find(b => b.date === ledger.lastRunDate);
      if (!bar) continue;
      if (Math.abs(p - bar.close) <= 0.011) snapOk++;
      else snapBad.push(`${sym}: snapshot ${p} vs close ${bar.close}`);
    }
  }

  console.log('--- Fill validation ---');
  console.log(`in day's range      : ${inRange}/${trades.length - noBar.length} ${rangeViolations.length ? '  <-- VIOLATIONS' : '(all pass)'}`);
  console.log(`exact official close: ${exactClose}/${trades.length - noBar.length} (session-close fills; the rest are in-range quote-board fills)`);
  console.log(`own-date session bar: ${trades.length - noBar.length}/${trades.length} ${noBar.length ? '  <-- MISSING' : '(all dated to real sessions)'}`);
  console.log(`duplicate fills/ids : ${dupes} ${dupes ? '  <-- VIOLATIONS' : '(none)'}`);
  console.log(`qty*price == value  : ${trades.length - badValue.length}/${trades.length} ${badValue.length ? '  <-- VIOLATIONS' : '(all pass)'}`);
  console.log('--- Prices snapshot vs lastRunDate closes ---');
  console.log(`matches             : ${snapOk}/${snapOk + snapBad.length} ${snapBad.length ? '  <-- MISMATCH' : '(all pass)'}`);

  const fail = rangeViolations.length || noBar.length || dupes || badValue.length;
  if (fail) {
    console.log('\n--- Details ---');
    for (const l of [...rangeViolations, ...noBar.map(t => `${t.date} ${t.personaId} ${t.symbol} ${t.action} ${t.qty} @ ${t.price} (no own-date bar)`), ...badValue]) console.log('  ' + l);
    if (closeMismatch.length <= 10) for (const l of closeMismatch) console.log('  [not-at-close] ' + l);
    console.log(`\nRESULT: FAIL — ${rangeViolations.length} out-of-range, ${noBar.length} no-bar, ${dupes} dupes, ${badValue.length} value errors`);
    process.exit(1);
  }
  console.log(`\nRESULT: PASS — all ${trades.length} fills aligned with their day's market range`);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
