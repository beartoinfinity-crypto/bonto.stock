import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Tickers we care about (matches the screener universe).
const SYMBOL_SET = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'INTC', 'NFLX',
  'JPM', 'BAC', 'WFC', 'GS', 'V', 'MA', 'PYPL',
  'JNJ', 'PFE', 'UNH', 'MRK', 'ABBV', 'LLY',
  'XOM', 'CVX', 'COP',
  'DIS', 'NKE', 'SBUX', 'MCD', 'WMT', 'TGT', 'COST', 'HD',
  'BA', 'CAT', 'GE', 'MMM', 'HON', 'UPS',
  'KO', 'PEP', 'PG',
  'CRM', 'ORCL', 'ADBE', 'NOW', 'SNOW',
  'VZ', 'T', 'TMUS',
  'LMT', 'RTX', 'NOC', 'GD',
  'COIN', 'SOFI', 'PLTR', 'NET', 'CRWD', 'UBER',
  'AVGO', 'TSM', 'QCOM', 'ARM',
  'SPY', 'QQQ',
]);

// CapitolExposed: free public API mirroring House Clerk + Senate eFD PTR filings.
const CAPITOL_BASE = 'https://www.capitolexposed.com/api/v1';

interface CapitolTrade {
  id: string;
  member_id?: string;
  member_name?: string;
  member_slug?: string;
  ticker?: string | null;
  asset_description?: string | null;
  transaction_type?: string;
  transaction_date?: string;
  disclosure_date?: string;
  amount_min?: string | number | null;
  amount_max?: string | number | null;
  owner?: string | null;
  source_url?: string | null;
}

interface NormalizedTrade {
  symbol: string;
  politician: string;
  transaction_date: string;
  filing_date: string | null;
  transaction_type: 'BUY' | 'SELL' | 'EXCHANGE' | 'OTHER';
  amount_from: number | null;
  amount_to: number | null;
  asset_name: string | null;
  owner_type: string | null;
  position_held: string | null;
  source: string;
}

function normalizeTxType(raw?: string): NormalizedTrade['transaction_type'] {
  const v = (raw || '').toLowerCase();
  if (v.includes('purchase') || v.includes('buy')) return 'BUY';
  if (v.includes('sale') || v.includes('sell')) return 'SELL';
  if (v.includes('exchange')) return 'EXCHANGE';
  return 'OTHER';
}

function parseNum(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cleanTicker(t?: string | null): string | null {
  if (!t) return null;
  const sym = t.toUpperCase().trim().replace(/[^A-Z.]/g, '');
  if (!sym || sym === '--' || sym === 'N/A') return null;
  return sym;
}

function chamberFromId(id?: string): string {
  if (!id) return 'Congress';
  if (id.includes('-house-')) return 'House';
  if (id.includes('-senate-')) return 'Senate';
  return 'Congress';
}

async function fetchPage(page: number, perPage: number): Promise<CapitolTrade[]> {
  const url = `${CAPITOL_BASE}/trades?page=${page}&per_page=${perPage}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'StockPulse-Sync/1.0' } });
  if (!res.ok) throw new Error(`CapitolExposed page ${page} failed: HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const SYNC_SECRET = Deno.env.get('SYNC_SECRET');
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : '';
    if (SYNC_SECRET && bearerToken !== SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: 'Service misconfigured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 5-year lookback.
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 5);
    const cutoff = cutoffDate.toISOString().slice(0, 10);

    const url = new URL(req.url);
    const overrideSymbols = url.searchParams.get('symbols');
    const filterSet = overrideSymbols
      ? new Set(overrideSymbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
      : SYMBOL_SET;
    const maxPages = Math.min(parseInt(url.searchParams.get('max_pages') || '500'), 1000);
    const perPage = 100;

    const normalized: NormalizedTrade[] = [];
    let pagesFetched = 0;
    let rowsSeen = 0;
    let stoppedReason = 'max_pages';

    for (let page = 1; page <= maxPages; page++) {
      let rows: CapitolTrade[];
      try {
        rows = await fetchPage(page, perPage);
      } catch (err) {
        stoppedReason = `fetch_error: ${(err as Error).message}`;
        break;
      }
      pagesFetched++;
      rowsSeen += rows.length;
      if (rows.length === 0) {
        stoppedReason = 'empty_page';
        break;
      }

      // Trades are returned newest-first. If the oldest row in this page is
      // already before the cutoff, we can stop after processing it.
      let oldestInPage: string | null = null;

      for (const r of rows) {
        const txDate = (r.transaction_date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate)) continue;
        if (!oldestInPage || txDate < oldestInPage) oldestInPage = txDate;
        if (txDate < cutoff) continue;

        const symbol = cleanTicker(r.ticker);
        if (!symbol || !filterSet.has(symbol)) continue;
        const politician = (r.member_name || '').trim();
        if (!politician) continue;

        normalized.push({
          symbol,
          politician,
          transaction_date: txDate,
          filing_date: r.disclosure_date ? r.disclosure_date.slice(0, 10) : null,
          transaction_type: normalizeTxType(r.transaction_type),
          amount_from: parseNum(r.amount_min),
          amount_to: parseNum(r.amount_max),
          asset_name: r.asset_description ?? null,
          owner_type: r.owner ?? null,
          position_held: chamberFromId(r.id),
          source: 'capitol-exposed',
        });
      }

      if (oldestInPage && oldestInPage < cutoff) {
        stoppedReason = 'cutoff_reached';
        break;
      }
    }

    // Deduplicate by upsert conflict key.
    const seen = new Set<string>();
    const unique: NormalizedTrade[] = [];
    for (const t of normalized) {
      const key = [
        t.symbol,
        t.politician,
        t.transaction_date,
        t.transaction_type,
        t.amount_from ?? '',
        t.amount_to ?? '',
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(t);
    }

    let inserted = 0;
    let failed = 0;
    const upsertErrors: string[] = [];
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('politician_trades')
        .upsert(chunk, {
          onConflict: 'symbol,politician,transaction_date,transaction_type,amount_from,amount_to',
          ignoreDuplicates: true,
        });
      if (error) {
        failed += chunk.length;
        upsertErrors.push(error.message);
      } else {
        inserted += chunk.length;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        source: 'capitol-exposed',
        cutoff,
        pages_fetched: pagesFetched,
        rows_seen: rowsSeen,
        normalized: normalized.length,
        unique: unique.length,
        upserted: inserted,
        failed,
        stopped_reason: stoppedReason,
        upsert_errors: upsertErrors.slice(0, 5),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('sync-politician-trades error', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unable to process request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
