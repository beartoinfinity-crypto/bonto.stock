import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_PARAMS, replayEngine, StockData } from "./engine.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOOKBACKS = [10, 30, 60, 120];

// Universe refreshed by the nightly cron (matches the screener universe).
const UNIVERSE = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','AMD','INTC','CRM','ORCL','ADBE',
  'JPM','BAC','WFC','GS','MS','V','MA',
  'JNJ','UNH','PFE','ABBV','MRK','LLY',
  'WMT','PG','KO','COKE','PEP','COST','NKE','MCD','SBUX',
  'XOM','CVX','COP','CAT','BA','HON','UPS','GE','VZ','T','TMUS',
  'AMT','PLD','LMT','RTX','NOC','GD',
  'COIN','SOFI','MSTR','SQ','PLTR','NET','CRWD','UBER',
  'AVGO','TSM','QCOM','ARM','SPY','QQQ','DIA','IWM',
];

// Per-IP rate limit for the ad-hoc (client) path.
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rateLimitMap.get(ip);
  if (!e || now > e.resetTime) { rateLimitMap.set(ip, { count: 1, resetTime: now + 60_000 }); return false; }
  e.count++;
  return e.count > 30;
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function loadHistory(symbol: string): Promise<StockData[]> {
  const rows: StockData[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('stock_price_history')
      .select('date, open, high, low, close, volume')
      .eq('symbol', symbol)
      .order('date', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data.map(d => ({
      date: d.date as string,
      open: Number(d.open), high: Number(d.high), low: Number(d.low),
      close: Number(d.close), volume: Number(d.volume),
    })));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function computeSymbol(symbol: string): Promise<number> {
  const history = await loadHistory(symbol);
  if (history.length < 40) return 0;
  const payloads: Record<string, unknown>[] = [];
  for (const lookback of LOOKBACKS) {
    const replay = replayEngine(history, DEFAULT_PARAMS, lookback);
    if (!replay) continue;
    payloads.push({
      symbol,
      lookback,
      last_bar_date: history[history.length - 1].date,
      payload: replay,
      computed_at: new Date().toISOString(),
    });
  }
  if (payloads.length === 0) return 0;
  const { error } = await supabase
    .from('tactical_action_history')
    .upsert(payloads, { onConflict: 'symbol,lookback' });
  if (error) throw error;
  return payloads.length;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (isRateLimited(ip)) {
      return new Response(JSON.stringify({ error: 'Rate limited, please try again later' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: { symbol?: string; all?: boolean } = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }

    // Ad-hoc single-symbol refresh (client "Recompute" button).
    if (body.symbol) {
      const symbol = String(body.symbol).toUpperCase();
      if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
        return new Response(JSON.stringify({ error: 'Invalid symbol' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const written = await computeSymbol(symbol);
      return new Response(JSON.stringify({ symbol, written }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Full universe pass (nightly cron after the close).
    let symbols = 0, written = 0;
    const failed: string[] = [];
    for (const symbol of UNIVERSE) {
      try {
        const n = await computeSymbol(symbol);
        if (n > 0) symbols++;
        written += n;
      } catch (_e) {
        failed.push(symbol);
      }
    }
    return new Response(JSON.stringify({ symbols, written, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
