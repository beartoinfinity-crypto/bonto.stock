import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FinnhubQuote {
  c: number;  // Current price
  d: number;  // Change
  dp: number; // Percent change
  h: number;  // High price of the day
  l: number;  // Low price of the day
  o: number;  // Open price of the day
  pc: number; // Previous close price
  t: number;  // Timestamp
}

interface FinnhubCandle {
  c: number[];  // Close prices
  h: number[];  // High prices
  l: number[];  // Low prices
  o: number[];  // Open prices
  s: string;    // Status
  t: number[];  // Timestamps
  v: number[];  // Volume
}

interface FinnhubProfile {
  country: string;
  currency: string;
  exchange: string;
  finnhubIndustry: string;
  ipo: string;
  logo: string;
  marketCapitalization: number;
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
}

interface FinnhubMetrics {
  metric: {
    "52WeekHigh": number;
    "52WeekLow": number;
    peNormalizedAnnual: number;
  };
}

interface StockPriceRecord {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Helper to get historical data from database
async function getHistoricalFromDB(symbol: string): Promise<StockPriceRecord[] | null> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('Supabase credentials not available for DB lookup');
    return null;
  }
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  // Fetch all records - paginate to avoid the default 1000-row limit
  let allData: StockPriceRecord[] = [];
  let from = 0;
  const pageSize = 1000;
  
  while (true) {
    const { data, error } = await supabase
      .from('stock_price_history')
      .select('symbol, date, open, high, low, close, volume')
      .eq('symbol', symbol.toUpperCase())
      .order('date', { ascending: true })
      .range(from, from + pageSize - 1);
    
    if (error) {
      console.error('DB lookup error:', error);
      return null;
    }
    
    if (!data || data.length === 0) break;
    
    allData = allData.concat(data as StockPriceRecord[]);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  
  if (allData.length === 0) {
    console.log(`No DB data for ${symbol}`);
    return null;
  }
  
  console.log(`Found ${allData.length} records in DB for ${symbol}`);
  return allData;
}

// ---------- Quote providers with automatic fallback ----------
interface QuoteResult {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: string;
  pe: number;
  week52High: number;
  week52Low: number;
}

function formatMarketCapMillions(capMillions: number): string {
  if (!capMillions || capMillions <= 0) return 'N/A';
  if (capMillions >= 1_000_000) return `${(capMillions / 1_000_000).toFixed(1)}T`;
  if (capMillions >= 1_000) return `${(capMillions / 1_000).toFixed(1)}B`;
  return `${capMillions.toFixed(0)}M`;
}

async function fetchJson(url: string, timeoutMs = 8000, headers?: Record<string, string>) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function quoteFromFinnhub(symbol: string, key: string): Promise<QuoteResult | null> {
  const base = 'https://finnhub.io/api/v1';
  const [quote, profile, metrics] = await Promise.all([
    fetchJson(`${base}/quote?symbol=${symbol}&token=${key}`),
    fetchJson(`${base}/stock/profile2?symbol=${symbol}&token=${key}`).catch(() => ({})),
    fetchJson(`${base}/stock/metric?symbol=${symbol}&metric=all&token=${key}`).catch(() => ({})),
  ]);
  if (quote?.error || !quote?.c) return null;
  return {
    symbol,
    name: profile?.name || symbol,
    sector: profile?.finnhubIndustry || 'Unknown',
    price: quote.c,
    change: quote.d || 0,
    changePercent: quote.dp || 0,
    volume: metrics?.metric?.["10DayAverageTradingVolume"]
      ? metrics.metric["10DayAverageTradingVolume"] * 1_000_000
      : 0,
    marketCap: formatMarketCapMillions((profile?.marketCapitalization || 0) * 1000),
    pe: metrics?.metric?.peNormalizedAnnual || 0,
    week52High: metrics?.metric?.["52WeekHigh"] || quote.h || 0,
    week52Low: metrics?.metric?.["52WeekLow"] || quote.l || 0,
  };
}

async function quoteFromTwelveData(symbol: string, key: string): Promise<QuoteResult | null> {
  const data = await fetchJson(
    `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${key}`
  );
  if (data?.status === 'error' || data?.code) return null;
  const price = parseFloat(data?.close ?? '0');
  if (!price) return null;
  return {
    symbol,
    name: data.name || symbol,
    sector: 'Unknown',
    price,
    change: parseFloat(data.change ?? '0') || 0,
    changePercent: parseFloat(data.percent_change ?? '0') || 0,
    volume: parseInt(data.average_volume ?? data.volume ?? '0', 10) || 0,
    marketCap: 'N/A',
    pe: 0,
    week52High: parseFloat(data?.fifty_two_week?.high ?? '0') || 0,
    week52Low: parseFloat(data?.fifty_two_week?.low ?? '0') || 0,
  };
}

async function quoteFromYahoo(symbol: string): Promise<QuoteResult | null> {
  const hosts = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ];
  for (const host of hosts) {
    try {
      const data = await fetchJson(
        `${host}/v8/finance/chart/${symbol}?range=1mo&interval=1d`,
        8000,
        { 'User-Agent': 'Mozilla/5.0' }
      );
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      const price = meta?.regularMarketPrice;
      if (!price) continue;
      const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? price;
      const volumes: number[] = (result?.indicators?.quote?.[0]?.volume || []).filter(
        (v: number | null) => typeof v === 'number'
      );
      const avgVol = volumes.length
        ? volumes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, volumes.length)
        : meta?.regularMarketVolume || 0;
      return {
        symbol,
        name: meta?.longName || meta?.shortName || symbol,
        sector: 'Unknown',
        price,
        change: price - prev,
        changePercent: prev ? ((price - prev) / prev) * 100 : 0,
        volume: Math.round(avgVol),
        marketCap: 'N/A',
        pe: 0,
        week52High: meta?.fiftyTwoWeekHigh || 0,
        week52Low: meta?.fiftyTwoWeekLow || 0,
      };
    } catch (_e) {
      continue;
    }
  }
  return null;
}

async function quoteFromStooq(symbol: string): Promise<QuoteResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://stooq.com/q/l/?s=${symbol.toLowerCase()}.us&f=sd2t2ohlcvn&h&e=csv`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const cols = lines[1].split(',');
    // Symbol,Date,Time,Open,High,Low,Close,Volume,Name
    const open = parseFloat(cols[3]);
    const close = parseFloat(cols[6]);
    const volume = parseInt(cols[7], 10) || 0;
    if (!close || Number.isNaN(close)) return null;
    return {
      symbol,
      name: (cols[8] || symbol).trim(),
      sector: 'Unknown',
      price: close,
      change: open ? close - open : 0,
      changePercent: open ? ((close - open) / open) * 100 : 0,
      volume,
      marketCap: 'N/A',
      pe: 0,
      week52High: 0,
      week52Low: 0,
    };
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function historyFromTwelveData(symbol: string, key: string): Promise<Candle[] | null> {
  const data = await fetchJson(
    `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=2500&apikey=${key}`,
    12000
  );
  if (data?.status === 'error' || data?.code || !Array.isArray(data?.values)) return null;
  const out: Candle[] = data.values
    .map((c: Record<string, string>) => ({
      date: c.datetime,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseInt(c.volume, 10) || 0,
    }))
    .reverse();
  return out.length ? out : null;
}

async function historyFromYahoo(symbol: string): Promise<Candle[] | null> {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  for (const host of hosts) {
    try {
      const data = await fetchJson(
        `${host}/v8/finance/chart/${symbol}?range=10y&interval=1d`,
        12000,
        { 'User-Agent': 'Mozilla/5.0' }
      );
      const result = data?.chart?.result?.[0];
      const stamps: number[] = result?.timestamp || [];
      const q = result?.indicators?.quote?.[0];
      if (!stamps.length || !q) continue;
      const out: Candle[] = [];
      for (let i = 0; i < stamps.length; i++) {
        const close = q.close?.[i];
        if (typeof close !== 'number') continue;
        out.push({
          date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
          open: q.open?.[i] ?? close,
          high: q.high?.[i] ?? close,
          low: q.low?.[i] ?? close,
          close,
          volume: q.volume?.[i] ?? 0,
        });
      }
      if (out.length) return out;
    } catch (_e) {
      continue;
    }
  }
  return null;
}

async function historyFromStooq(symbol: string): Promise<Candle[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(
      `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 3) return null;
    const out: Candle[] = [];
    for (const line of lines.slice(1)) {
      const [date, open, high, low, close, volume] = line.split(',');
      const c = parseFloat(close);
      if (!c || Number.isNaN(c)) continue;
      out.push({
        date,
        open: parseFloat(open) || c,
        high: parseFloat(high) || c,
        low: parseFloat(low) || c,
        close: c,
        volume: parseInt(volume, 10) || 0,
      });
    }
    return out.length ? out : null;
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}



// Only the news action strictly requires Finnhub
function url_action_needs_finnhub(req: Request): boolean {
  try {
    return (new URL(req.url).searchParams.get('action') || 'quote') === 'news';
  } catch {
    return false;
  }
}

// Simple in-memory rate limiter (per-function instance)

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30; // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

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

/* ---------- provider config + usage logging (admin panel) ---------- */
function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key);
}

let providerKeyCache: { at: number; keys: Record<string, string | null> } | null = null;

async function getProviderKeys(): Promise<Record<string, string | null>> {
  const envKeys: Record<string, string | null> = {
    finnhub: Deno.env.get('FINNHUB_API_KEY') ?? null,
    twelvedata: Deno.env.get('TWELVE_DATA_API_KEY') ?? null,
  };
  if (providerKeyCache && Date.now() - providerKeyCache.at < 60_000) return providerKeyCache.keys;
  const admin = adminClient();
  if (admin) {
    try {
      const { data } = await admin.from('provider_config').select('provider, api_key, enabled');
      for (const row of data ?? []) {
        if (row.enabled === false) {
          envKeys[row.provider] = null;
        } else if (row.api_key) {
          envKeys[row.provider] = row.api_key;
        }
      }
    } catch (_) { /* ignore, fall back to env */ }
  }
  providerKeyCache = { at: Date.now(), keys: envKeys };
  return envKeys;
}

function canonProvider(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('finnhub')) return 'finnhub';
  if (n.includes('twelve')) return 'twelvedata';
  if (n.includes('yahoo')) return 'yahoo';
  if (n.includes('stooq')) return 'stooq';
  return n;
}

function logUsage(provider: string, action: string, symbol: string, success: boolean, note?: string) {
  const admin = adminClient();
  if (!admin) return;
  admin
    .from('api_usage_log')
    .insert({ provider, action, symbol, success, note: note?.slice(0, 200) ?? null })
    .then(() => {})
    .catch(() => {});
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Basic rate limiting by IP
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const providerKeys = await getProviderKeys();
    const FINNHUB_API_KEY = providerKeys.finnhub;
    if (!FINNHUB_API_KEY && (url_action_needs_finnhub(req))) {
      console.error('FINNHUB_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    const url = new URL(req.url);
    const rawSymbol = url.searchParams.get('symbol')?.toUpperCase() ?? '';
    const action = url.searchParams.get('action') || 'quote';

    // Strict symbol validation: 1-5 uppercase letters, optionally followed by .X suffix (e.g., BRK.B)
    if (!rawSymbol || !/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(rawSymbol)) {
      return new Response(
        JSON.stringify({ error: 'Invalid symbol format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const symbol = rawSymbol;

    console.log(`Fetching ${action} data for ${symbol}`);

    const baseUrl = 'https://finnhub.io/api/v1';

    if (action === 'quote') {
      const providers: Array<{ name: string; run: () => Promise<QuoteResult | null> }> = [];
      if (FINNHUB_API_KEY) {
        providers.push({ name: 'finnhub', run: () => quoteFromFinnhub(symbol, FINNHUB_API_KEY) });
      }
      const TWELVE_KEY = providerKeys.twelvedata;
      if (TWELVE_KEY) {
        providers.push({ name: 'twelve-data', run: () => quoteFromTwelveData(symbol, TWELVE_KEY) });
      }
      providers.push({ name: 'yahoo', run: () => quoteFromYahoo(symbol) });
      providers.push({ name: 'stooq', run: () => quoteFromStooq(symbol) });

      for (const provider of providers) {
        try {
          const result = await provider.run();
          if (result && result.price > 0) {
            console.log(`Quote for ${symbol} served by ${provider.name}`);
            logUsage(canonProvider(provider.name), 'quote', symbol, true);
            return new Response(JSON.stringify(result), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'X-Quote-Source': provider.name,
              },
            });
          }
          logUsage(canonProvider(provider.name), 'quote', symbol, false, 'empty response');
          console.warn(`Provider ${provider.name} returned no usable quote for ${symbol}`);
        } catch (e) {
          logUsage(canonProvider(provider.name), 'quote', symbol, false, e instanceof Error ? e.message : 'error');
          console.warn(`Provider ${provider.name} failed for ${symbol}:`, e instanceof Error ? e.message : e);
        }
      }

      return new Response(
        JSON.stringify({ error: 'No data available for this symbol' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    if (action === 'candles') {
      console.log(`Fetching candles data for ${symbol}`);
      
      // First, try to get data from database
      const dbData = await getHistoricalFromDB(symbol);
      
      if (dbData && dbData.length > 0) {
        // Convert volume from string (bigint serialization) to number
        const formattedData = dbData.map(record => ({
          ...record,
          volume: Number(record.volume) || 0,
        }));
        
        console.log(`Returning ${formattedData.length} records from database for ${symbol}`);
        return new Response(
          JSON.stringify(formattedData),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'X-Data-Source': 'database'
            } 
          }
        );
      }
      
      // Fallback chain: Twelve Data -> Yahoo Finance -> Stooq
      console.log(`No DB data for ${symbol}, trying external history providers`);

      const TWELVE_DATA_API_KEY = providerKeys.twelvedata;
      const historyProviders: Array<{ name: string; run: () => Promise<Candle[] | null> }> = [];
      if (TWELVE_DATA_API_KEY) {
        historyProviders.push({
          name: 'twelve-data-api',
          run: () => historyFromTwelveData(symbol, TWELVE_DATA_API_KEY),
        });
      }
      historyProviders.push({ name: 'yahoo', run: () => historyFromYahoo(symbol) });
      historyProviders.push({ name: 'stooq', run: () => historyFromStooq(symbol) });

      for (const provider of historyProviders) {
        try {
          const rows = await provider.run();
          if (rows && rows.length > 0) {
            console.log(`Fetched ${rows.length} candles for ${symbol} from ${provider.name}`);
            logUsage(canonProvider(provider.name), 'candles', symbol, true);
            return new Response(JSON.stringify(rows), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'X-Data-Source': provider.name,
              },
            });
          }
          logUsage(canonProvider(provider.name), 'candles', symbol, false, 'empty response');
          console.warn(`History provider ${provider.name} returned nothing for ${symbol}`);
        } catch (e) {
          logUsage(canonProvider(provider.name), 'candles', symbol, false, e instanceof Error ? e.message : 'error');
          console.warn(
            `History provider ${provider.name} failed for ${symbol}:`,
            e instanceof Error ? e.message : e
          );
        }
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Data-Fallback': 'true',
          'X-Data-Reason': 'All history providers unavailable',
        },
      });

    }

    if (action === 'news') {
      // Fetch company news from Finnhub (last 30 days)
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const toStr = now.toISOString().split('T')[0];
      const fromStr = from.toISOString().split('T')[0];

      let newsData: any;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const newsRes = await fetch(
          `${baseUrl}/company-news?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${FINNHUB_API_KEY}`,
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        newsData = await newsRes.json();
      } catch (e) {
        console.error('Finnhub news fetch failed/timed out:', e);
        return new Response(JSON.stringify([]), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Data-Fallback': 'timeout' },
        });
      }

      if (!Array.isArray(newsData)) {
        console.error('Finnhub news error:', newsData);
        return new Response(JSON.stringify([]), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Return top 20 news items
      const articles = newsData.slice(0, 20).map((item: any) => ({
        id: item.id,
        headline: item.headline,
        summary: item.summary,
        source: item.source,
        url: item.url,
        image: item.image,
        datetime: item.datetime,
        category: item.category,
        related: item.related,
      }));

      return new Response(JSON.stringify(articles), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use "quote", "candles", or "news"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching stock data:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to process request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
