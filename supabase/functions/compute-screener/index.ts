import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// In-memory per-IP rate limiter (per function instance)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}


// ─── Stock universe (must match src/lib/stockScreener.ts) ─────────
const SCREENER_STOCKS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','AMD','INTC','CRM','ORCL','ADBE',
  'JPM','BAC','WFC','GS','MS','V','MA',
  'JNJ','UNH','PFE','ABBV','MRK','LLY',
  'WMT','PG','KO','COKE','PEP','COST','NKE','MCD','SBUX',
  'XOM','CVX','COP',
  'CAT','BA','HON','UPS','GE',
  'VZ','T','TMUS',
  'AMT','PLD',
  'LMT','RTX','NOC','GD',
  'COIN','SOFI','MSTR','SQ','PLTR','NET','CRWD','UBER',
  'AVGO','TSM','QCOM','ARM',
  'SPY','QQQ','DIA','IWM',
];

interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number; }

// ─── Indicator math (port of src/lib/stockData.ts) ────────────────
function sma(data: Candle[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const sum = data.slice(i - period + 1, i + 1).reduce((a, d) => a + d.close, 0);
    return sum / period;
  });
}
function ema(data: Candle[], period: number): (number | null)[] {
  const m = 2 / (period + 1);
  const out: (number | null)[] = [];
  data.forEach((d, i) => {
    if (i < period - 1) out.push(null);
    else if (i === period - 1) out.push(data.slice(0, period).reduce((a, d) => a + d.close, 0) / period);
    else out.push((d.close - (out[i - 1] as number)) * m + (out[i - 1] as number));
  });
  return out;
}
function rsi(data: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  const gains: number[] = [], losses: number[] = [];
  data.forEach((d, i) => {
    if (i === 0) { out.push(null); return; }
    const ch = d.close - data[i - 1].close;
    gains.push(ch > 0 ? ch : 0);
    losses.push(ch < 0 ? -ch : 0);
    if (i < period) { out.push(null); return; }
    const ag = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const al = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  });
  return out;
}
function macd(data: Candle[]) {
  const e12 = ema(data, 12), e26 = ema(data, 26);
  const m = e12.map((v, i) => v === null || e26[i] === null ? null : v - (e26[i] as number));
  const sig: (number | null)[] = [];
  const sp = 9, mult = 2 / (sp + 1);
  let curr: number | null = null, valid = 0;
  const validMacd = m.filter(x => x !== null) as number[];
  m.forEach(v => {
    if (v === null) { sig.push(null); return; }
    valid++;
    if (valid < sp) sig.push(null);
    else if (valid === sp) { curr = validMacd.slice(0, sp).reduce((a, b) => a + b, 0) / sp; sig.push(curr); }
    else { curr = (v - (curr as number)) * mult + (curr as number); sig.push(curr); }
  });
  return { macd: m, signal: sig };
}
function bb(data: Candle[], period = 20, sd = 2) {
  const mid = sma(data, period);
  const upper: (number | null)[] = [], lower: (number | null)[] = [];
  data.forEach((_, i) => {
    if (i < period - 1 || mid[i] === null) { upper.push(null); lower.push(null); return; }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = mid[i] as number;
    const variance = slice.reduce((a, d) => a + (d.close - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push(mean + sd * std);
    lower.push(mean - sd * std);
  });
  return { upper, middle: mid, lower };
}

// ─── Strategy analysis (port of src/lib/strategyRecommendation.ts) ─
type Regime = 'strong_uptrend'|'uptrend'|'sideways'|'downtrend'|'strong_downtrend';
type Vol = 'low'|'medium'|'high'|'extreme';
type Mom = 'overbought'|'bullish'|'neutral'|'bearish'|'oversold';

interface MarketCondition {
  regime: Regime; regimeScore: number;
  volatility: Vol; volatilityPercentile: number;
  momentum: Mom; rsiValue: number;
  trendStrength: number; priceVsSma: number; bandwidthPercentile: number;
}

function analyzeMarket(data: Candle[]): MarketCondition {
  const idx = data.length - 1;
  const p = data[idx].close;
  const s20 = sma(data, 20), s50 = sma(data, 50), s200 = sma(data, 200);
  const r = rsi(data, 14);
  const { macd: mc, signal: sg } = macd(data);
  const { upper, middle, lower } = bb(data, 20, 2);

  const sm20 = (s20[idx] as number) ?? p;
  const sm50 = (s50[idx] as number) ?? p;
  const sm200 = (s200[idx] as number) ?? p;
  const rv = (r[idx] as number) ?? 50;
  const lm = (mc[idx] as number) ?? 0;
  const ls = (sg[idx] as number) ?? 0;
  const lu = (upper[idx] as number) ?? p;
  const ll = (lower[idx] as number) ?? p;
  const lmid = (middle[idx] as number) ?? p;

  let score = 0;
  score += p > sm20 ? 15 : -15;
  score += p > sm50 ? 20 : -20;
  score += p > sm200 ? 25 : -25;
  score += sm20 > sm50 ? 15 : -15;
  score += sm50 > sm200 ? 15 : -15;
  score += lm > ls ? 10 : -10;

  let regime: Regime;
  if (score >= 60) regime = 'strong_uptrend';
  else if (score >= 20) regime = 'uptrend';
  else if (score >= -20) regime = 'sideways';
  else if (score >= -60) regime = 'downtrend';
  else regime = 'strong_downtrend';

  const bandwidth = ((lu - ll) / lmid) * 100;
  const histBws: number[] = [];
  for (let i = Math.max(0, idx - 252); i <= idx; i++) {
    if (upper[i] && lower[i] && middle[i]) {
      histBws.push((((upper[i] as number) - (lower[i] as number)) / (middle[i] as number)) * 100);
    }
  }
  const sortedBw = [...histBws].sort((a, b) => a - b);
  const idxBw = sortedBw.findIndex(b => b >= bandwidth);
  const bwPctile = (Math.max(0, idxBw) / Math.max(1, sortedBw.length)) * 100;

  const rets = data.slice(-20).map((d, i, arr) => i > 0 ? Math.abs((d.close - arr[i - 1].close) / arr[i - 1].close) * 100 : 0).slice(1);
  const avgVol = rets.reduce((a, b) => a + b, 0) / rets.length;

  let volatility: Vol;
  let volPct = bwPctile;
  if (avgVol > 3 || bwPctile > 90) { volatility = 'extreme'; volPct = Math.max(volPct, 90); }
  else if (avgVol > 2 || bwPctile > 70) volatility = 'high';
  else if (avgVol > 1 || bwPctile > 30) volatility = 'medium';
  else volatility = 'low';

  let momentum: Mom;
  if (rv >= 80) momentum = 'overbought';
  else if (rv >= 60) momentum = 'bullish';
  else if (rv >= 40) momentum = 'neutral';
  else if (rv >= 20) momentum = 'bearish';
  else momentum = 'oversold';

  return {
    regime, regimeScore: Math.round(score),
    volatility, volatilityPercentile: Math.round(volPct),
    momentum, rsiValue: Math.round(rv),
    trendStrength: Math.min(100, Math.abs(score)),
    priceVsSma: parseFloat((((p - sm50) / sm50) * 100).toFixed(2)),
    bandwidthPercentile: Math.round(bwPctile),
  };
}

interface StrategyRec {
  strategy: string; confidence: number;
  suitability: 'excellent'|'good'|'moderate'|'poor';
  reasoning: string[]; actionItems: string[];
  riskLevel: 'low'|'medium'|'high';
  action?: 'BUY'|'SELL'|'HOLD';
}

function suit(c: number): StrategyRec['suitability'] {
  if (c >= 75) return 'excellent';
  if (c >= 60) return 'good';
  if (c >= 40) return 'moderate';
  return 'poor';
}

function evalMA(c: MarketCondition): StrategyRec {
  let conf = 50; const reasoning: string[] = []; const actionItems: string[] = [];
  if (c.regime === 'strong_uptrend' || c.regime === 'strong_downtrend') { conf += 25; reasoning.push('Strong trend detected'); }
  else if (c.regime === 'uptrend' || c.regime === 'downtrend') { conf += 15; reasoning.push('Clear directional trend'); }
  else { conf -= 20; reasoning.push('Sideways may yield false signals'); }
  if (c.trendStrength > 60) conf += 10;
  if (c.volatility === 'medium') conf += 5;
  else if (c.volatility === 'extreme') conf -= 15;
  conf = Math.max(0, Math.min(100, conf));
  return { strategy: 'MA Crossover', confidence: conf, suitability: suit(conf), reasoning, actionItems,
    riskLevel: c.volatility === 'extreme' || c.volatility === 'high' ? 'high' : 'medium' };
}
function evalRSI(c: MarketCondition): StrategyRec {
  let conf = 50; const reasoning: string[] = []; const actionItems: string[] = [];
  if (c.regime === 'sideways') { conf += 25; reasoning.push('Range-bound favors mean-reversion'); }
  else if (c.regime === 'strong_uptrend' || c.regime === 'strong_downtrend') conf -= 15;
  if (c.momentum === 'overbought' || c.momentum === 'oversold') { conf += 20; reasoning.push(`RSI at ${c.rsiValue} - reversal zone`); }
  else if (c.momentum === 'neutral') conf -= 10;
  if (c.volatility === 'low' || c.volatility === 'medium') conf += 10;
  else if (c.volatility === 'extreme') conf -= 10;
  conf = Math.max(0, Math.min(100, conf));
  return { strategy: 'RSI Reversal', confidence: conf, suitability: suit(conf), reasoning, actionItems, riskLevel: 'medium' };
}
function evalMACD(c: MarketCondition): StrategyRec {
  let conf = 50; const reasoning: string[] = []; const actionItems: string[] = [];
  if (c.regime === 'uptrend' || c.regime === 'downtrend') conf += 20;
  else if (c.regime === 'sideways') conf -= 10;
  if (c.momentum === 'bullish' && (c.regime === 'uptrend' || c.regime === 'strong_uptrend')) conf += 15;
  else if (c.momentum === 'bearish' && (c.regime === 'downtrend' || c.regime === 'strong_downtrend')) conf += 15;
  if (c.volatility === 'medium' || c.volatility === 'high') conf += 5;
  else if (c.volatility === 'low') conf -= 5;
  conf = Math.max(0, Math.min(100, conf));
  return { strategy: 'MACD Crossover', confidence: conf, suitability: suit(conf), reasoning, actionItems, riskLevel: 'medium' };
}
function evalBB(c: MarketCondition): StrategyRec {
  let conf = 50; const reasoning: string[] = []; const actionItems: string[] = [];
  if (c.volatility === 'low' && c.bandwidthPercentile < 30) conf += 30;
  else if (c.volatility === 'medium' && c.bandwidthPercentile < 50) conf += 15;
  else if (c.volatility === 'extreme') conf -= 20;
  if (c.regime === 'sideways') conf += 10;
  else if (c.trendStrength > 70) conf -= 10;
  const risk: 'low'|'medium'|'high' = c.volatility === 'extreme' || c.volatility === 'high' ? 'high' : 'medium';
  conf = Math.max(0, Math.min(100, conf));
  return { strategy: 'Bollinger Breakout', confidence: conf, suitability: suit(conf), reasoning, actionItems, riskLevel: risk };
}
function evalCombined(c: MarketCondition, others: StrategyRec[]): StrategyRec {
  const high = others.filter(s => s.confidence >= 60);
  const aligned = high.length;
  let conf = 40 + aligned * 15;
  const reasoning: string[] = []; const actionItems: string[] = [];
  if (aligned >= 3) { conf += 10; reasoning.push(`${aligned} strategies show high confidence - strong consensus`); }
  else if (aligned >= 2) reasoning.push(`${aligned} strategies align - moderate consensus`);
  else if (aligned === 1) { conf -= 10; reasoning.push('Only one strategy shows high confidence - wait for more confirmation'); }
  else { conf -= 20; reasoning.push('No clear strategy consensus - mixed signals'); }
  if (c.regime !== 'sideways' && c.trendStrength > 50) { conf += 10; reasoning.push('Clear trend direction supports combined signal approach'); }
  const risk: 'low'|'medium'|'high' = conf >= 70 ? 'low' : conf >= 50 ? 'medium' : 'high';

  let action: 'BUY'|'SELL'|'HOLD' = 'HOLD';
  if (c.regime === 'strong_uptrend' || c.regime === 'uptrend') {
    if (c.momentum === 'overbought') action = 'HOLD';
    else if (c.momentum !== 'bearish' && c.momentum !== 'oversold') action = 'BUY';
  } else if (c.regime === 'strong_downtrend' || c.regime === 'downtrend') {
    if (c.momentum === 'oversold') action = 'HOLD';
    else if (c.momentum !== 'bullish' && c.momentum !== 'overbought') action = 'SELL';
  } else {
    if (c.momentum === 'bullish' && c.rsiValue > 55) action = 'BUY';
    else if (c.momentum === 'bearish' && c.rsiValue < 45) action = 'SELL';
  }
  if (conf < 40 && aligned < 2) action = 'HOLD';

  if (aligned >= 2) {
    const top = high.slice(0, 2).map(s => s.strategy);
    actionItems.push(`Primary signals: ${top.join(' + ')}`);
    if (action === 'BUY') { actionItems.push('Consider entering long position on pullback'); actionItems.push('Use tighter position sizing for higher confidence'); }
    else if (action === 'SELL') { actionItems.push('Consider reducing or exiting positions'); actionItems.push('Watch for support breakdown confirmation'); }
    else { actionItems.push('Wait for all indicators to align before entry'); actionItems.push('Use tighter position sizing for higher confidence'); }
    actionItems.push('Set stop-loss based on the most conservative strategy');
  } else {
    if (action === 'HOLD') { actionItems.push('Wait for multiple strategies to confirm same direction'); actionItems.push('Avoid forced entries when signals conflict'); actionItems.push('Consider staying in cash until clearer setup emerges'); }
    else { actionItems.push('Signal direction is tentative with low consensus'); actionItems.push('Use smaller position size due to limited confirmation'); actionItems.push('Set tight stop-loss to manage risk'); }
  }
  conf = Math.max(0, Math.min(100, conf));
  return { strategy: 'Combined Signal', confidence: conf, suitability: suit(conf), reasoning, actionItems, riskLevel: risk, action };
}

// ─── News sentiment via keyword counting ──────────────────────────
const BULL = ['surge','surges','rally','rallies','soar','soars','jump','jumps','gain','gains','rise','rises','climb','climbs','bull','bullish','upgrade','upgrades','upside','outperform','overweight','buy','beat','beats','exceed','exceeds','strong','positive','growth','record high','breakout','momentum','optimistic','optimism','recovery','rebound','boost','boosts','opportunity'];
const BEAR = ['fall','falls','drop','drops','decline','declines','plunge','plunges','crash','crashes','sink','sinks','tumble','tumbles','bear','bearish','downgrade','downgrades','downside','underperform','underweight','sell','miss','misses','weak','negative','loss','losses','risk','risks','concern','concerns','warning','warns','trouble','fear','fears','recession','slowdown','cut','cuts','lower','lowers','slash'];

function classify(text: string): 'bullish'|'bearish'|'neutral' {
  const t = text.toLowerCase();
  let bu = 0, be = 0;
  for (const k of BULL) if (t.includes(k)) bu++;
  for (const k of BEAR) if (t.includes(k)) be++;
  if (bu === 0 && be === 0) return 'neutral';
  if (bu > be) return 'bullish';
  if (be > bu) return 'bearish';
  return 'neutral';
}

async function getNewsSentiment(symbol: string, finnhubKey: string) {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 10 * 86400000);
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from.toISOString().slice(0,10)}&to=${to.toISOString().slice(0,10)}&token=${finnhubKey}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const articles = await r.json();
    if (!Array.isArray(articles) || articles.length === 0) return null;
    let bull = 0, bear = 0, neu = 0;
    for (const a of articles) {
      const s = classify(`${a.headline || ''} ${a.summary || ''}`);
      if (s === 'bullish') bull++; else if (s === 'bearish') bear++; else neu++;
    }
    const total = bull + bear + neu;
    const overall: 'bullish'|'bearish'|'neutral' =
      bull > bear && bull > neu ? 'bullish' :
      bear > bull && bear > neu ? 'bearish' : 'neutral';
    return { bullish: bull, bearish: bear, neutral: neu, total, overall };
  } catch { return null; }
}

// ─── Social sentiment via existing edge function ──────────────────
async function getSocialSentiment(symbol: string, action: string, supabaseUrl: string, anonKey: string) {
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/social-sentiment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, action }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.success) return null;
    return {
      sentiment: j.data.sentiment, confirmation: j.data.confirmation,
      confidence: j.data.confidence, themes: j.data.themes || [], summary: j.data.summary || '',
    };
  } catch { return null; }
}

// ─── Quote (latest price + change) ────────────────────────────────
async function getQuote(symbol: string, finnhubKey: string) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`);
    if (!r.ok) return null;
    const q = await r.json();
    if (typeof q.c !== 'number') return null;
    return { price: q.c, change: q.d ?? null, changePercent: q.dp ?? null };
  } catch { return null; }
}

// ─── Main ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Per-IP rate limit
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Require shared-secret auth (same pattern as sync-stock-data)
    const COMPUTE_SECRET = Deno.env.get('COMPUTE_SECRET') || Deno.env.get('SYNC_SECRET');
    if (COMPUTE_SECRET) {
      const bearer = req.headers.get('Authorization')?.replace('Bearer ', '') || '';
      if (bearer !== COMPUTE_SECRET) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const FINNHUB_KEY = Deno.env.get('FINNHUB_API_KEY')!;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const url = new URL(req.url);
    const onlySymbol = url.searchParams.get('symbol')?.toUpperCase();

    // Strict symbol validation when provided
    if (onlySymbol && !/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(onlySymbol)) {
      return new Response(
        JSON.stringify({ error: 'Invalid symbol format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const symbols = onlySymbol ? [onlySymbol] : SCREENER_STOCKS;


    console.log(`Computing screener for ${symbols.length} symbols`);
    const summary: { symbol: string; status: string; error?: string }[] = [];

    for (const symbol of symbols) {
      try {
        // Fetch historical from DB (need at least 200+ candles for SMA200)
        const { data: hist, error: histErr } = await supabase
          .from('stock_price_history')
          .select('date, open, high, low, close, volume')
          .eq('symbol', symbol)
          .order('date', { ascending: true });

        if (histErr || !hist || hist.length < 100) {
          console.warn(`${symbol}: insufficient history (${hist?.length ?? 0} rows)`);
          summary.push({ symbol, status: 'insufficient_data' });
          continue;
        }

        const candles: Candle[] = hist.map(h => ({
          date: h.date, open: Number(h.open), high: Number(h.high),
          low: Number(h.low), close: Number(h.close), volume: Number(h.volume),
        }));

        const cond = analyzeMarket(candles);
        const ma = evalMA(cond), r = evalRSI(cond), mc = evalMACD(cond), bbs = evalBB(cond);
        const combined = evalCombined(cond, [ma, r, mc, bbs]);

        const quote = await getQuote(symbol, FINNHUB_KEY);
        const newsSentiment = await getNewsSentiment(symbol, FINNHUB_KEY);
        const socialSentiment = await getSocialSentiment(symbol, combined.action || 'HOLD', SUPABASE_URL, ANON_KEY);

        const signalData = {
          signal: combined,
          price: quote?.price ?? candles[candles.length - 1].close,
          change: quote?.change ?? null,
          changePercent: quote?.changePercent ?? null,
          newsSentiment,
          socialSentiment,
        };

        const { error: upErr } = await supabase
          .from('screener_results')
          .upsert({
            symbol,
            signal_data: signalData,
            computed_at: new Date().toISOString(),
          }, { onConflict: 'symbol' });

        if (upErr) {
          console.error(`${symbol} upsert error:`, upErr);
          summary.push({ symbol, status: 'error', error: upErr.message });
        } else {
          summary.push({ symbol, status: 'success' });
        }

        // Small delay to avoid hammering Finnhub & social-sentiment
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        console.error(`${symbol} failed:`, e);
        summary.push({ symbol, status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }

    const success = summary.filter(s => s.status === 'success').length;
    console.log(`Done: ${success}/${symbols.length} succeeded`);
    return new Response(
      JSON.stringify({ total: symbols.length, success, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('compute-screener fatal:', e);
    return new Response(
      JSON.stringify({ error: 'Unable to process request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
