import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROFILE_URL = 'https://unusualwhales.com/politics/profile/Donald%20J%20Trump';

interface UwTrade {
  ticker: string | null;
  symbol: string | null;
  issuer: string | null;
  transaction_date: string | null;
  filed_at_date: string | null;
  txn_type: string | null;
  amounts: string | null;
  asset: string | null;
  ownership: string | null;
  notes: string | null;
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

function normTx(raw: string | null): NormalizedTrade['transaction_type'] {
  const v = (raw || '').toLowerCase();
  if (v.includes('buy') || v.includes('purchase')) return 'BUY';
  if (v.includes('sell') || v.includes('sale')) return 'SELL';
  if (v.includes('exchange')) return 'EXCHANGE';
  return 'OTHER';
}

function parseAmount(raw: string | null): { from: number | null; to: number | null } {
  if (!raw) return { from: null, to: null };
  const nums = raw.replace(/[^0-9\-,]/g, ' ').match(/[\d,]+/g) || [];
  const parsed = nums.map((n) => parseInt(n.replace(/,/g, ''), 10)).filter((n) => Number.isFinite(n));
  if (parsed.length === 0) return { from: null, to: null };
  if (parsed.length === 1) return { from: parsed[0], to: null };
  return { from: parsed[0], to: parsed[1] };
}

function pseudoSymbol(issuer: string | null): string {
  if (!issuer) return 'OTHER';
  const clean = issuer.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
  return clean ? `#${clean}` : 'OTHER';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const SYNC_SECRET = Deno.env.get('SYNC_SECRET');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (SYNC_SECRET && bearer !== SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: 'Service misconfigured' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch(PROFILE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 StockPulse-Sync/1.0' },
    });
    if (!res.ok) throw new Error(`UnusualWhales HTTP ${res.status}`);
    const html = await res.text();

    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('NEXT_DATA not found');
    const json = JSON.parse(m[1]);
    const groups = json?.props?.pageProps?.trades;
    if (!Array.isArray(groups)) throw new Error('trades array missing');

    const flat: UwTrade[] = [];
    for (const g of groups) if (Array.isArray(g)) flat.push(...g);

    const normalized: NormalizedTrade[] = [];
    for (const t of flat) {
      const txDate = (t.transaction_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate)) continue;
      const amt = parseAmount(t.amounts);
      const tickerRaw = (t.ticker || t.symbol || '').toUpperCase().replace(/[^A-Z.]/g, '');
      // Stock-only: skip non-equity assets (bonds, options, "other") and rows without a ticker.
      if (!tickerRaw || tickerRaw === 'N/A' || tickerRaw === '--') continue;
      if (t.asset && t.asset.toLowerCase() !== 'stock') continue;
      normalized.push({
        symbol: tickerRaw,
        politician: 'Donald J Trump',
        transaction_date: txDate,
        filing_date: t.filed_at_date ? t.filed_at_date.slice(0, 10) : null,
        transaction_type: normTx(t.txn_type),
        amount_from: amt.from,
        amount_to: amt.to,
        asset_name: t.issuer || t.notes || null,
        owner_type: t.ownership || null,
        position_held: 'President (White House Office)',
        source: 'unusualwhales',
      });
    }

    // Dedupe locally on conflict key.
    const seen = new Set<string>();
    const unique: NormalizedTrade[] = [];
    for (const t of normalized) {
      const key = [t.symbol, t.politician, t.transaction_date, t.transaction_type, t.amount_from ?? '', t.amount_to ?? ''].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(t);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    let upserted = 0;
    const errors: string[] = [];
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('politician_trades')
        .upsert(chunk, {
          onConflict: 'symbol,politician,transaction_date,transaction_type,amount_from,amount_to',
          ignoreDuplicates: true,
        });
      if (error) errors.push(error.message);
      else upserted += chunk.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      source: 'unusualwhales',
      politician: 'Donald J Trump',
      rows_seen: flat.length,
      normalized: normalized.length,
      unique: unique.length,
      upserted,
      errors: errors.slice(0, 3),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('sync-trump-trades error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unable to process request' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
