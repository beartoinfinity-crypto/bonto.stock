// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: sync-stock-data
// Fetches Yahoo Finance quotes + 10y daily history for top 20 stocks
// and upserts into public.stock_quotes / public.stock_historical.
// Scheduled via pg_cron (see supabase/schedules.sql).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK-B',
  'JPM', 'V', 'JNJ', 'WMT', 'PG', 'UNH', 'HD', 'MA',
  'DIS', 'BAC', 'XOM', 'KO',
];

const CHUNK = 500;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Optional shared-secret guard: set CRON_SECRET via `supabase secrets set`.
async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return true; // no secret configured -> open
  return req.headers.get('x-cron-secret') === secret;
}

async function fetchChart(symbol: string): Promise<any | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (StockPulse edge sync)' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.chart?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

function buildRows(symbol: string, result: any) {
  const meta = result?.meta ?? {};
  const stamps: number[] = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  const bars: any[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = q.close?.[i];
    if (close == null) continue; // skip null bars
    bars.push({
      symbol,
      date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? null,
      high: q.high?.[i] ?? null,
      low: q.low?.[i] ?? null,
      close,
      volume: q.volume?.[i] ?? null,
    });
  }

  const price = meta.regularMarketPrice ?? bars.at(-1)?.close ?? 0;
  const prev = meta.chartPreviousClose ?? bars.at(-2)?.close ?? price;
  const quote = {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    sector: 'Unknown',
    price,
    change: +(price - prev).toFixed(4),
    changePercent: prev ? +(((price - prev) / prev) * 100).toFixed(4) : 0,
    volume: meta.regularMarketVolume ?? bars.at(-1)?.volume ?? 0,
    marketCap: meta.marketCap != null ? String(meta.marketCap) : '0',
    pe: meta.trailingPE ?? 0,
    week52High: meta.fiftyTwoWeekHigh ?? Math.max(...bars.map(b => b.high ?? 0), 0),
    week52Low: meta.fiftyTwoWeekLow ?? Math.min(...bars.map(b => b.low ?? Infinity), Infinity),
  };

  return { quote, bars };
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) return jsonRes({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // bypasses RLS
  );

  let quotesOk = 0;
  let barsPushed = 0;
  const failed: string[] = [];

  for (const sym of SYMBOLS) {
    const result = await fetchChart(sym);
    if (!result) { failed.push(sym); continue; }

    const { quote, bars } = buildRows(sym, result);

    const { error: qErr } = await supabase
      .from('stock_quotes')
      .upsert({ symbol: sym, data: JSON.stringify(quote), updated_at: new Date().toISOString() }, { onConflict: 'symbol' });
    if (!qErr) quotesOk++; else failed.push(sym);

    for (let i = 0; i < bars.length; i += CHUNK) {
      const payload = bars.slice(i, i + CHUNK).map(b => ({ ...b, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from('stock_historical').upsert(payload, { onConflict: 'symbol,date' });
      if (error) break;
      barsPushed += payload.length;
    }
  }

  console.log(`[sync-stock-data] ok=${quotesOk}/${SYMBOLS.length} bars=${barsPushed} failed=${failed.join(',')}`);
  return jsonRes({
    ok: quotesOk > 0,
    quotes: quotesOk,
    totalSymbols: SYMBOLS.length,
    bars: barsPushed,
    failed,
  });
});
