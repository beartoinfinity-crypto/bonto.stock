// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: sync-featured-trades
//
// Fetches featured politician trades (Trump + Pelosi) from their sources and
// upserts into public.politician_featured_trades:
//   Trump  <- Open Cabinet (OGE disclosures CSV) + UnusualWhales SSG scrape
//   Pelosi <- StockSpill Supabase (congress_trades) + UnusualWhales SSG scrape
// Mirrors the browser cron job's fetchUnusualWhalesTrades / fetchStockSpillTrades
// / fetchOpenCabinetTrades + pushFeaturedTrades + normalizeFeaturedTradeNames.
// Scheduled via pg_cron (see supabase/schedules.sql).

import { createClient } from 'npm:@supabase/supabase-js@2';

const FEATURED_POLITICIANS = [
  { name: 'Donald J Trump', sources: ['opencabinet', 'unusualwhales'] as const },
  { name: 'Nancy Pelosi', sources: ['stockspill', 'unusualwhales'] as const },
];

// StockSpill is a third-party public dataset in its own Supabase project
// (read-only anon access).
const STOCKSPILL_URL = 'https://artscweyrracfffoqvur.supabase.co';
const STOCKSPILL_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFydHNjd2V5cnJhY2ZmZm9xdnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMTM2MTgsImV4cCI6MjA4MTU4OTYxOH0.P9zsEmmEJvYDDFqMuMa_v4m-Ywa2zF90Lk6zDBmqwOU';

interface FeaturedTrade {
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

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return true;
  return req.headers.get('x-cron-secret') === secret;
}

// ─── Shared helpers ────────────────────────────────────────────────

function parseAmountRange(s: string | null): { from: number | null; to: number | null } {
  if (!s) return { from: null, to: null };
  const clean = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || null;
  const parts = s.split(/\s*[-–]\s*/);
  if (parts.length === 2) return { from: clean(parts[0]), to: clean(parts[1]) };
  return { from: clean(s), to: null };
}

function normSide(raw: unknown, buyWords: string[], sellWords: string[]): string {
  const v = String(raw ?? '').toLowerCase();
  if (buyWords.some(w => v === w || v.includes(w))) return 'BUY';
  if (sellWords.some(w => v === w || v.includes(w))) return 'SELL';
  return 'OTHER';
}

// ─── Source: UnusualWhales (SSG __NEXT_DATA__ scrape) ───────────────

async function fetchUnusualWhalesTrades(politicianName: string): Promise<FeaturedTrade[]> {
  try {
    // NOTE: "Donald J Trump" (no period) — the period causes a 500 upstream.
    const url = `https://unusualwhales.com/politics/profile/${encodeURIComponent(politicianName)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return [];
    const json = JSON.parse(m[1]);
    const groups = json?.props?.pageProps?.trades;
    if (!Array.isArray(groups)) return [];
    const flat: any[] = groups.flat();

    return flat
      .filter((r: any) => r.ticker || r.symbol)
      .map((r: any) => {
        const { from, to } = parseAmountRange(r.amounts ?? null);
        const tt = String(r.txn_type ?? '').toLowerCase();
        let side = 'OTHER';
        if (tt === 'buy' || tt === 'purchase') side = 'BUY';
        else if (tt === 'sell' || tt === 'sale') side = 'SELL';
        return {
          id: `uw-${r.file_record_id ?? Math.random().toString(36).slice(2)}`,
          politician: String(r.name ?? politicianName),
          symbol: String(r.ticker ?? r.symbol ?? ''),
          transaction_type: side,
          transaction_date: String(r.transaction_date ?? '').slice(0, 10),
          filing_date: r.filed_at_date ? String(r.filed_at_date).slice(0, 10) : null,
          amount_from: from,
          amount_to: to,
          asset_name: r.issuer ? String(r.issuer) : null,
          source_name: 'unusualwhales',
          source_url: r.link_url ? String(r.link_url) : null,
          metadata: { affiliation: r.affiliation, member_type: r.member_type },
        } as FeaturedTrade;
      });
  } catch {
    return [];
  }
}

// ─── Source: StockSpill (third-party Supabase, read-only) ──────────

async function fetchStockSpillTrades(memberName: string): Promise<FeaturedTrade[]> {
  try {
    const url = `${STOCKSPILL_URL}/rest/v1/congress_trades?member_name=like.*${encodeURIComponent(memberName)}*&order=transaction_date.desc&limit=500`;
    const res = await fetch(url, {
      headers: { apikey: STOCKSPILL_KEY, Authorization: `Bearer ${STOCKSPILL_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows.map((r: any) => {
      const { from, to } = parseAmountRange(r.amount_range ?? '');
      const tt = String(r.transaction_type ?? '').toLowerCase();
      let side = 'OTHER';
      if (tt === 'purchase' || tt === 'buy') side = 'BUY';
      else if (tt === 'sale' || tt === 'sell') side = 'SELL';
      return {
        id: `ss-${r.id ?? ''}`,
        politician: String(r.member_name ?? memberName),
        symbol: String(r.ticker ?? ''),
        transaction_type: side,
        transaction_date: r.transaction_date ? String(r.transaction_date).slice(0, 10) : null,
        filing_date: r.disclosure_date ? String(r.disclosure_date).slice(0, 10) : null,
        amount_from: from,
        amount_to: to,
        asset_name: r.asset_name ? String(r.asset_name) : null,
        source_name: 'stockspill',
        source_url: null,
        metadata: { chamber: r.chamber, party: r.party, state: r.state },
      } as FeaturedTrade;
    });
  } catch {
    return [];
  }
}

// ─── Source: Open Cabinet (OGE presidential disclosures CSV) ───────

/** Minimal RFC-4180 CSV parser (handles quoted fields with embedded commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

function csvToObjects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

async function fetchOpenCabinetTrades(politician: string): Promise<FeaturedTrade[]> {
  try {
    const res = await fetch('https://open-cabinet.org/data/all-transactions.csv', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const rows = csvToObjects(await res.text());

    const polLower = politician.toLowerCase();
    const out: FeaturedTrade[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row.official_name || '';
      if (!name) continue;
      const csvNameLower = name.toLowerCase();
      const nameParts = csvNameLower.replace(/"/g, '').split(',').map(s => s.trim());
      const lastName = nameParts[0] || '';
      const firstName = nameParts[1] || '';
      const matches = csvNameLower.includes(polLower)
        || polLower.includes(lastName)
        || polLower.includes(firstName);
      if (!matches) continue;
      const ticker = row.ticker || '';
      if (!ticker || ticker === 'N/A') continue;
      if (ticker.toUpperCase() === 'THE' || ticker.length <= 1) continue;
      const desc = (row.description || '').toLowerCase();
      if (desc.includes('bond') || desc.includes('muni') || desc.includes('note ') || desc.includes('b/e ')) continue;
      const tt = (row.type || '').toLowerCase();
      let side = 'OTHER';
      if (tt === 'purchase') side = 'BUY';
      else if (tt === 'sale') side = 'SELL';
      else if (tt === 'exchange') side = 'EXCHANGE';
      const { from, to } = parseAmountRange(row.amount_range || '');
      const midpoint = row.amount_midpoint ? Number(String(row.amount_midpoint).replace(/[^0-9.]/g, '')) || null : null;
      const normalizedPol = name.replace(/[".]/g, '').split(',').map(s => s.trim()).reverse().join(' ').trim();
      out.push({
        id: `oc-${i}`,
        politician: normalizedPol,
        symbol: ticker,
        transaction_type: side,
        transaction_date: (row.date || '').slice(0, 10),
        filing_date: null,
        amount_from: from || midpoint,
        amount_to: to,
        asset_name: row.description || null,
        source_name: 'opencabinet',
        source_url: row.source_filing_url || null,
        metadata: { title: row.official_title, agency: row.agency, late_filing: row.late_filing === 'yes' },
      });
    }
    out.sort((a, b) => (b.transaction_date || '').localeCompare(a.transaction_date || ''));
    return out;
  } catch {
    return [];
  }
}

// ─── Main ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (!(await authorized(req))) return jsonRes({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const allTrades: FeaturedTrade[] = [];
  const perSource: Record<string, number> = {};

  for (const pol of FEATURED_POLITICIANS) {
    for (const src of pol.sources) {
      let trades: FeaturedTrade[] = [];
      try {
        if (src === 'unusualwhales') trades = await fetchUnusualWhalesTrades(pol.name);
        else if (src === 'stockspill') trades = await fetchStockSpillTrades(pol.name);
        else if (src === 'opencabinet') trades = await fetchOpenCabinetTrades(pol.name);
      } catch { /* skip failed source */ }
      perSource[src] = (perSource[src] ?? 0) + trades.length;
      allTrades.push(...trades);
    }
  }

  if (allTrades.length === 0) {
    return jsonRes({ ok: false, reason: 'no trades fetched from any source', perSource }, 502);
  }

  // Dedupe by id (sources are disjoint-prefixed, this only guards repeats).
  const seen = new Set<string>();
  const unique = allTrades.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  // Upsert into the featured-trades table (onConflict id).
  let upserted = 0;
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK).map(t => ({
      ...t,
      metadata: t.metadata ? JSON.stringify(t.metadata) : null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('politician_featured_trades').upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`featured trades upsert failed: ${error.message}`);
    upserted += chunk.length;
  }

  // One-time cleanup: rename legacy "Last, First" politician names.
  const RENAMES: Array<[string, string]> = [
    ['Trump, Donald J', 'Donald J Trump'],
    ['Trump, Donald J.', 'Donald J Trump'],
    ['Donald J. Trump', 'Donald J Trump'],
    ['Pelosi, Nancy', 'Nancy Pelosi'],
  ];
  let fixed = 0;
  for (const [from, to] of RENAMES) {
    const { data } = await supabase.from('politician_featured_trades')
      .update({ politician: to }).eq('politician', from).select('id');
    fixed += data?.length ?? 0;
  }

  console.log(`[sync-featured-trades] pushed=${upserted} perSource=${JSON.stringify(perSource)} fixed=${fixed}`);
  return jsonRes({ ok: true, fetched: allTrades.length, unique: unique.length, upserted, perSource, namesFixed: fixed });
});
