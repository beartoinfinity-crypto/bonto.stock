import { Stock, StockData, popularStocks, generateHistoricalData } from './stockData';
import { getQuote, putQuote, getHistorical, putHistorical, type CachedQuote } from './localDb';

export interface FetchResult<T> {
  data: T | null;
  error: string | null;
  isRealData: boolean;
  fromCache?: boolean;
}

// ─── CORS proxy (browser only — adds CORS headers to any URL) ─────

const SERVER_PROXY = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(url: string, timeoutMs = 10000, headers?: Record<string, string>): Promise<Response> {
  // 1. Server-side proxy (primary — no CORS restrictions)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(SERVER_PROXY(url), { signal: ctrl.signal, headers });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* server proxy unavailable — try fallbacks */ }

  // 2. Try direct (works for same-origin or non-CORS URLs)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, headers });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* CORS blocked */ }

  // 3. Third-party CORS proxies (legacy fallback)
  for (const proxy of CORS_PROXIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(proxy(url), { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (res.ok) return res;
    } catch { continue; }
  }

  throw new Error('All fetch methods failed');
}

async function fetchJson(url: string, timeoutMs = 10000, headers?: Record<string, string>): Promise<any> {
  const res = await proxyFetch(url, timeoutMs, headers);
  return await res.json();
}

// ─── Yahoo crumb (session auth for v7/v10 APIs) ────────────────────

let yahooCrumb: string | null = null;
let yahooCrumbExpiry = 0;

/** Reset cached crumb — for testing only */
export function resetYahooCrumb() {
  yahooCrumb = null;
  yahooCrumbExpiry = 0;
}

async function getYahooCrumb(): Promise<string | null> {
  if (yahooCrumb && Date.now() < yahooCrumbExpiry) return yahooCrumb;
  try {
    // Use server-side crumb endpoint (cookies work from server, not browser)
    const res = await fetch('/api/yahoo/crumb');
    if (res.ok) {
      const data = await res.json();
      const crumb = data?.crumb;
      if (crumb && crumb.length > 2) {
        yahooCrumb = crumb;
        yahooCrumbExpiry = Date.now() + 30 * 60 * 1000;
        console.log('[YahooCrumb] Got crumb via server:', crumb.substring(0, 6) + '...');
        return yahooCrumb;
      }
    }
    console.warn('[YahooCrumb] Server crumb endpoint failed, status:', res.status);
  } catch (e) {
    console.warn('[YahooCrumb] Error fetching crumb from server:', e);
  }
  return null;
}

// ─── Quote providers ───────────────────────────────────────────────

function formatMarketCap(raw: number | undefined): string {
  if (!raw || raw <= 0) return 'N/A';
  if (raw >= 1e12) return (raw / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
  if (raw >= 1e9) return (raw / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (raw >= 1e6) return (raw / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  return raw.toLocaleString();
}

async function fetchQuoteSummary(symbol: string, preferredHost?: string): Promise<{ pe: number; marketCap: string; sector: string } | null> {
  const hosts = preferredHost
    ? [preferredHost, ...['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'].filter(h => h !== preferredHost)]
    : ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  const crumb = await getYahooCrumb();

  // Try v10/quoteSummary with crumb
  if (crumb) {
    for (const host of hosts) {
      try {
        const url = `${host}/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,assetProfile&crumb=${encodeURIComponent(crumb)}`;
        const data = await fetchJson(url, 8000, { 'User-Agent': 'Mozilla/5.0' });
        const result = data?.quoteSummary?.result?.[0];
        const detail = result?.summaryDetail;
        const profile = result?.assetProfile;
        if (!detail && !profile) continue;
        const pe = typeof detail?.trailingPE?.raw === 'number' ? detail.trailingPE.raw : 0;
        const marketCap = formatMarketCap(detail?.marketCap?.raw);
        const sector = (profile?.sector as string) || 'Unknown';
        console.log(`[quoteSummary] ${symbol}: v10+crumb success from ${host}`, { pe, marketCap, sector });
        return { pe, marketCap, sector };
      } catch { continue; }
    }
  }

  // Fallback: try v10 without crumb (may work through CORS proxies)
  for (const host of hosts) {
    try {
      const data = await fetchJson(
        `${host}/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,assetProfile`,
        8000,
        { 'User-Agent': 'Mozilla/5.0' },
      );
      const result = data?.quoteSummary?.result?.[0];
      const detail = result?.summaryDetail;
      const profile = result?.assetProfile;
      if (!detail && !profile) continue;
      const pe = typeof detail?.trailingPE?.raw === 'number' ? detail.trailingPE.raw : 0;
      const marketCap = formatMarketCap(detail?.marketCap?.raw);
      const sector = (profile?.sector as string) || 'Unknown';
      console.log(`[quoteSummary] ${symbol}: v10 no-crumb success from ${host}`, { pe, marketCap, sector });
      return { pe, marketCap, sector };
    } catch { continue; }
  }
  return null;
}

async function quoteFromYahoo(symbol: string): Promise<Stock | null> {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  for (const host of hosts) {
    try {
      const data = await fetchJson(
        `${host}/v8/finance/chart/${symbol}?range=1mo&interval=1d`,
        10000,
        { 'User-Agent': 'Mozilla/5.0' },
      );
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      const price = meta?.regularMarketPrice;
      if (!price) continue;
      // Compute change from the actual chart candles (most reliable)
      const closes: number[] = (result?.indicators?.quote?.[0]?.close || []).filter(
        (v: number | null) => typeof v === 'number' && v > 0,
      );
      const prevClose = closes.length >= 2 ? closes[closes.length - 2] : (meta?.previousClose ?? price);
      const volumes: number[] = (result?.indicators?.quote?.[0]?.volume || []).filter(
        (v: number | null) => typeof v === 'number',
      );
      const avgVol = volumes.length
        ? volumes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, volumes.length)
        : meta?.regularMarketVolume || 0;
      // Fetch P/E and market cap from quoteSummary — pass same host to avoid extra failures
      const summary = await fetchQuoteSummary(symbol, host).catch((e) => {
        console.warn(`[quoteSummary] ${symbol} failed on ${host}:`, e);
        return null;
      });
      return {
        symbol,
        name: meta?.longName || meta?.shortName || symbol,
        sector: summary?.sector ?? 'Unknown',
        price,
        change: price - prevClose,
        changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
        volume: Math.round(avgVol),
        marketCap: summary?.marketCap ?? 'N/A',
        pe: summary?.pe ?? 0,
        week52High: meta?.fiftyTwoWeekHigh || 0,
        week52Low: meta?.fiftyTwoWeekLow || 0,
      };
    } catch { continue; }
  }
  return null;
}

async function quoteFromStooq(symbol: string): Promise<Stock | null> {
  try {
    const res = await proxyFetch(
      `https://stooq.com/q/l/?s=${symbol.toLowerCase()}.us&f=sd2t2ohlcvn&h&e=csv`,
      10000,
    );
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const cols = lines[1].split(',');
    const close = parseFloat(cols[6]);
    const volume = parseInt(cols[7], 10) || 0;
    if (!close || Number.isNaN(close)) return null;

    // Stooq doesn't provide previous close — fetch last 5 days to find it
    let prevClose = 0;
    try {
      const histRes = await proxyFetch(
        `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`,
        10000,
      );
      const histCsv = await histRes.text();
      const histLines = histCsv.trim().split('\n');
      // Take the last 2 closes (last is today, second-to-last is previous close)
      const closes: number[] = [];
      for (const line of histLines.slice(1)) {
        const parts = line.split(',');
        const c = parseFloat(parts[4]);
        if (!Number.isNaN(c) && c > 0) closes.push(c);
      }
      if (closes.length >= 2) {
        prevClose = closes[closes.length - 2];
      }
    } catch { /* fall back to open-based calculation below */ }

    const change = prevClose > 0 ? close - prevClose : 0;
    const changePercent = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;

    // Fetch P/E and market cap from Yahoo quoteSummary (non-blocking — fall back to defaults)
    const summary = await fetchQuoteSummary(symbol).catch(() => null);

    return {
      symbol,
      name: (cols[8] || symbol).trim(),
      sector: summary?.sector ?? 'Unknown',
      price: close,
      change,
      changePercent,
      volume,
      marketCap: summary?.marketCap ?? 'N/A',
      pe: summary?.pe ?? 0,
      week52High: 0,
      week52Low: 0,
    };
  } catch { return null; }
}

// ─── Historical candle providers ───────────────────────────────────

async function historyFromYahoo(symbol: string): Promise<StockData[] | null> {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  for (const host of hosts) {
    try {
      const data = await fetchJson(
        `${host}/v8/finance/chart/${symbol}?range=10y&interval=1d`,
        15000,
        { 'User-Agent': 'Mozilla/5.0' },
      );
      const result = data?.chart?.result?.[0];
      const stamps: number[] = result?.timestamp || [];
      const q = result?.indicators?.quote?.[0];
      if (!stamps.length || !q) continue;
      const out: StockData[] = [];
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
    } catch { continue; }
  }
  return null;
}

async function historyFromStooq(symbol: string): Promise<StockData[] | null> {
  try {
    const res = await proxyFetch(
      `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`,
      15000,
    );
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 3) return null;
    const out: StockData[] = [];
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
  } catch { return null; }
}

// ─── Public API ────────────────────────────────────────────────────

export async function fetchStockQuote(symbol: string, forceRefresh = false): Promise<FetchResult<Stock>> {
  if (!forceRefresh) {
    const cached = await getQuote(symbol);
    if (cached) {
      return { data: cached as Stock, error: null, isRealData: true, fromCache: true };
    }
  }

  const providers: Array<{ name: string; run: () => Promise<Stock | null> }> = [
    { name: 'yahoo', run: () => quoteFromYahoo(symbol) },
    { name: 'stooq', run: () => quoteFromStooq(symbol) },
  ];

  for (const provider of providers) {
    try {
      const result = await provider.run();
      if (result && result.price > 0) {
        await putQuote(result as CachedQuote);
        return { data: result, error: null, isRealData: true, fromCache: false };
      }
    } catch { continue; }
  }

  const mockStock = popularStocks.find(s => s.symbol === symbol) || popularStocks[0];
  return {
    data: mockStock,
    error: 'All providers unavailable',
    isRealData: false,
    fromCache: false,
  };
}

export async function fetchHistoricalData(symbol: string, forceRefresh = false): Promise<FetchResult<StockData[]>> {
  if (!forceRefresh) {
    const cached = await getHistorical(symbol);
    if (cached) {
      return { data: cached as StockData[], error: null, isRealData: true, fromCache: true };
    }
  }

  const providers: Array<{ name: string; run: () => Promise<StockData[] | null> }> = [
    { name: 'yahoo', run: () => historyFromYahoo(symbol) },
    { name: 'stooq', run: () => historyFromStooq(symbol) },
  ];

  for (const provider of providers) {
    try {
      const rows = await provider.run();
      if (rows && rows.length > 0) {
        await putHistorical(symbol, rows as unknown as Record<string, unknown>[]);
        return { data: rows, error: null, isRealData: true, fromCache: false };
      }
    } catch { continue; }
  }

  const mockStock = popularStocks.find(s => s.symbol === symbol) || popularStocks[0];
  return {
    data: generateHistoricalData(mockStock.price),
    error: 'All providers unavailable',
    isRealData: false,
    fromCache: false,
  };
}
