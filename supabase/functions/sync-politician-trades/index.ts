// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: sync-politician-trades
//
// Daily incremental job:
//   1. Kadoa -> public.politician_trades (source='kadoa')
//      filers.json + trades.json + trade_count meta-diff (stockpulse_kadoa_meta)
//      re-fetch only filers whose trade_count grew or are unknown.
//   2. CapitolExposed + CongressInvests -> stockpulse_kv
//      (legacy merge path; preserves imported records not refetched).
// Scheduled via pg_cron (see supabase/schedules.sql).

import { createClient } from 'npm:@supabase/supabase-js@2';

const KV_KEY = 'stockpulse_politician_trades';
const KADOA_META_KEY = 'stockpulse_kadoa_meta';
const KADOA_BASE = 'https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/main/public/data';

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

async function getJson(url: string, timeoutMs = 30000): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (StockPulse edge sync)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Kadoa → politician_trades ────────────────────────────────────

function sideFrom(raw: unknown): string {
  const tt = String(raw ?? '').toLowerCase();
  if (tt.includes('purchase') || tt.includes('buy')) return 'BUY';
  if (tt.includes('sale') || tt.includes('sell')) return 'SELL';
  if (tt.includes('exchange')) return 'EXCHANGE';
  return 'OTHER';
}

function unwrapTrades(body: unknown): any[] {
  if (Array.isArray(body)) return body as any[];
  const trades = (body as { trades?: unknown } | null)?.trades;
  return Array.isArray(trades) ? trades : [];
}

function mapKadoaTrade(r: any, filer: any) {
  const office = r.office ?? filer?.office ?? null;
  const agency = r.agency ?? filer?.agency ?? null;
  return {
    symbol: String(r.ticker ?? ''),
    politician: String(r.filer_name || filer?.full_name || ''),
    transaction_date: String(r.transaction_date ?? '').slice(0, 10),
    filing_date: r.filing_date ? String(r.filing_date).slice(0, 10) : null,
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

async function upsertKadoa(supabase: ReturnType<typeof createClient>, rows: any[]): Promise<number> {
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('politician_trades')
      .upsert(chunk, { onConflict: 'source,external_id' });
    if (error) throw new Error(`kadoa upsert failed: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

async function syncKadoa(supabase: ReturnType<typeof createClient>) {
  const filers = await getJson(`${KADOA_BASE}/filers.json`, 20000);
  if (!Array.isArray(filers) || filers.length === 0) {
    return { ok: false, filers: 0, recent: 0, grown: 0, written: 0 };
  }

  let metaCounts: Record<string, number> = {};
  const { data: metaRow } = await supabase
    .from('stockpulse_kv')
    .select('value')
    .eq('key', KADOA_META_KEY)
    .maybeSingle();
  try {
    metaCounts = metaRow?.value ? JSON.parse(metaRow.value)?.counts ?? {} : {};
  } catch { /* empty meta */ }

  const nextCounts: Record<string, number> = {};
  const toRefetch: any[] = [];
  for (const f of filers) {
    const id = String(f.id);
    const n = Number(f.trade_count ?? 0);
    nextCounts[id] = n;
    const prev = metaCounts[id];
    if (prev === undefined || n > prev) toRefetch.push(f);
  }

  // Always ingest the recent window (trades.json, bare array).
  const recentBody = await getJson(`${KADOA_BASE}/trades.json`, 30000);
  const recentTrades = unwrapTrades(recentBody);

  const allRows: any[] = [];
  for (const r of recentTrades) {
    if (!r?.ticker) continue;
    const filer = filers.find((f: any) => f.id === r.filer_id) ?? null;
    allRows.push(mapKadoaTrade(r, filer));
  }
  const recent = allRows.length;

  // Meta-diff: re-fetch full history only for filers that grew (or are new).
  // Cap per run so a cold meta does not re-download all 447 every day.
  const REFETCH_CAP = 80;
  const grown = Math.min(toRefetch.length, REFETCH_CAP);
  for (const filer of toRefetch.slice(0, REFETCH_CAP)) {
    const body = await getJson(`${KADOA_BASE}/filer/${filer.id}.json`, 30000);
    for (const r of unwrapTrades(body)) {
      if (!r?.ticker) continue;
      allRows.push(mapKadoaTrade(r, filer));
    }
  }

  const written = allRows.length > 0 ? await upsertKadoa(supabase, allRows) : 0;
  await supabase.from('stockpulse_kv').upsert({
    key: KADOA_META_KEY,
    value: JSON.stringify({ counts: nextCounts, at: Date.now() }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });

  return {
    ok: true,
    filers: filers.length,
    recent,
    grown: toRefetch.length,
    refetched: grown,
    written,
  };
}

// ─── Legacy mapping (Capitol + Congress -> KV) ────────────────────

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

  // 1. Kadoa table incremental
  let kadoa: Awaited<ReturnType<typeof syncKadoa>> = { ok: false, filers: 0, recent: 0, grown: 0, written: 0 };
  try {
    kadoa = await syncKadoa(supabase);
  } catch (e) {
    console.error('[sync-politician-trades] kadoa failed:', e);
  }

  // 2. Legacy: CapitolExposed (~last 30 days)
  const capitolRaw: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const j = await getJson(`https://www.capitolexposed.com/api/v1/trades?page=${page}&per_page=100`);
    const data = j?.data ?? (Array.isArray(j) ? j : []);
    if (!Array.isArray(data) || data.length === 0) break;
    capitolRaw.push(...data);
    if (!(j?.meta?.has_more ?? data.length >= 100)) break;
  }

  // 3. Legacy: CongressInvests (full history)
  const congressRaw: any[] = [];
  const PAGE_SIZE = 500;
  for (let offset = 0; offset < 6000; offset += PAGE_SIZE) {
    const j = await getJson(`https://congressinvests.com/trades?limit=${PAGE_SIZE}&offset=${offset}`);
    const trades = j?.trades ?? [];
    if (!Array.isArray(trades) || trades.length === 0) break;
    congressRaw.push(...trades);
    if (!j?.has_more) break;
  }

  const legacyFetched = capitolRaw.length + congressRaw.length;
  if (legacyFetched > 0) {
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const t of [...congressRaw.map(mapCongressInvests), ...capitolRaw.map(mapCapitolExposed)]) {
      const k = tradeKey(t);
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(t);
    }

    const { data: kvRow } = await supabase
      .from('stockpulse_kv')
      .select('value')
      .eq('key', KV_KEY)
      .maybeSingle();

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
    if (writeErr) return jsonRes({ ok: false, kadoa, error: writeErr.message }, 500);

    const total = merged.length;
    console.log(`[sync-politician-trades] kadoa=${JSON.stringify(kadoa)} capitol=${capitolRaw.length} congress=${congressRaw.length} unique=${deduped.length} preserved=${preserved.length} total=${total}`);
    return jsonRes({ ok: true, kadoa, capitol: capitolRaw.length, congress: congressRaw.length, unique: deduped.length, total });
  }

  // No legacy sources reachable — still report kadoa success.
  if (kadoa.ok) {
    console.log(`[sync-politician-trades] kadoa=${JSON.stringify(kadoa)} legacy=unreachable`);
    return jsonRes({ ok: true, kadoa, legacy: 'unreachable' });
  }

  return jsonRes({ ok: false, error: 'No data fetched from any source', kadoa }, 502);
});
