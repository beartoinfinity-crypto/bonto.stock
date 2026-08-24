// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: sync-politician-trades
// Fetches CapitolExposed + CongressInvests disclosures, dedups, merges with
// the existing cloud copy in stockpulse_kv (key stockpulse_politician_trades),
// and writes the merged document back. Browser picks it up on boot hydration.
// Scheduled via pg_cron (see supabase/schedules.sql).

import { createClient } from 'npm:@supabase/supabase-js@2';

const KV_KEY = 'stockpulse_politician_trades';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return true;
  return req.headers.get('x-cron-secret') === secret;
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (StockPulse edge sync)' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Mapping (mirrors src/lib/localCron.ts) ────────────────────────

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

const tradeKey = (t: any) => `${t.symbol}|${t.politician}|${t.transaction_date}|${t.transaction_type}`;

Deno.serve(async (req) => {
  if (!(await authorized(req))) return jsonRes({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Source 1: CapitolExposed (~last 30 days)
  const capitolRaw: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const j = await getJson(`https://www.capitolexposed.com/api/v1/trades?page=${page}&per_page=100`);
    const data = j?.data ?? (Array.isArray(j) ? j : []);
    if (!Array.isArray(data) || data.length === 0) break;
    capitolRaw.push(...data);
    if (!(j?.meta?.has_more ?? data.length >= 100)) break;
  }

  // Source 2: CongressInvests (full history)
  const congressRaw: any[] = [];
  const PAGE_SIZE = 500;
  for (let offset = 0; offset < 6000; offset += PAGE_SIZE) {
    const j = await getJson(`https://congressinvests.com/trades?limit=${PAGE_SIZE}&offset=${offset}`);
    const trades = j?.trades ?? [];
    if (!Array.isArray(trades) || trades.length === 0) break;
    congressRaw.push(...trades);
    if (!j?.has_more) break;
  }

  if (capitolRaw.length === 0 && congressRaw.length === 0) {
    return jsonRes({ ok: false, error: 'No trades fetched from either source' }, 502);
  }

  // Dedup across sources
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const t of [...congressRaw.map(mapCongressInvests), ...capitolRaw.map(mapCapitolExposed)]) {
    const k = tradeKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(t);
  }

  // Merge with existing cloud copy — preserve imported records not refetched
  const { data: kvRow, error: readErr } = await supabase
    .from('stockpulse_kv')
    .select('value')
    .eq('key', KV_KEY)
    .maybeSingle();
  if (readErr) console.warn('[sync-politician-trades] kv read failed:', readErr.message);

  let existingData: any[] = [];
  try {
    const parsed = kvRow?.value ? JSON.parse(kvRow.value) : {};
    existingData = parsed?.data ?? (Array.isArray(parsed) ? parsed : []);
  } catch { /* corrupt value -> start fresh */ }

  const fetchedKeys = new Set(deduped.map(tradeKey));
  const preserved = existingData.filter((t: any) => !fetchedKeys.has(tradeKey(t)));

  const merged = [...deduped, ...preserved];
  merged.sort((a: any, b: any) => {
    const da = a.filing_date || a.transaction_date;
    const dbv = b.filing_date || b.transaction_date;
    return String(dbv).localeCompare(String(da));
  });

  const { error: writeErr } = await supabase.from('stockpulse_kv').upsert({
    key: KV_KEY,
    value: JSON.stringify({ data: merged, fetchedAt: Date.now(), source: 'edge-function' }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (writeErr) return jsonRes({ ok: false, error: writeErr.message }, 500);

  console.log(`[sync-politician-trades] capitol=${capitolRaw.length} congress=${congressRaw.length} unique=${deduped.length} preserved=${preserved.length}`);
  return jsonRes({
    ok: true,
    capitol: capitolRaw.length,
    congress: congressRaw.length,
    unique: deduped.length,
    preserved,
    total: merged.length,
  });
});
