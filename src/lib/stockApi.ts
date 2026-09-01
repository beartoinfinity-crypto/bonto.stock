import { Stock, StockData, popularStocks, generateHistoricalData } from './stockData';
import { getQuote, putQuote, getHistorical, putHistorical, getMeta, putMeta, type CachedQuote } from './localDb';

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

// Curated offline fundamentals (sector / market cap / P/E / name) for the
// tracked universe. Used as a reliable fallback whenever the live Yahoo
// quoteSummary endpoint is unreachable, so the UI never shows Unknown/N/A.
function localFundamentals(symbol: string): { sector: string; marketCap: string; pe: number; name: string | undefined } {
  const s = popularStocks.find(p => p.symbol.toUpperCase() === symbol.toUpperCase());
  return {
    sector: s?.sector ?? 'Unknown',
    marketCap: s?.marketCap ?? 'N/A',
    pe: s?.pe ?? 0,
    name: s?.name,
  };
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
      const local = localFundamentals(symbol);
      return {
        symbol,
        name: meta?.longName || meta?.shortName || local.name || symbol,
        sector: summary?.sector ?? local.sector,
        price,
        change: price - prevClose,
        changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
        volume: Math.round(avgVol),
        marketCap: summary?.marketCap ?? local.marketCap,
        pe: summary?.pe ?? local.pe,
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

    // Fetch P/E and market cap from Yahoo quoteSummary (non-blocking — fall back to curated local data)
    const summary = await fetchQuoteSummary(symbol).catch(() => null);
    const local = localFundamentals(symbol);

    return {
      symbol,
      name: (cols[8] || symbol).trim() || local.name || symbol,
      sector: summary?.sector ?? local.sector,
      price: close,
      change,
      changePercent,
      volume,
      marketCap: summary?.marketCap ?? local.marketCap,
      pe: summary?.pe ?? local.pe,
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
      // Self-heal stale/blank fundamentals from curated local data.
      const local = localFundamentals(symbol);
      const merged: Stock = {
        ...cached,
        sector: cached.sector && cached.sector !== 'Unknown' ? cached.sector : local.sector,
        marketCap: cached.marketCap && cached.marketCap !== 'N/A' ? cached.marketCap : local.marketCap,
        pe: cached.pe && cached.pe > 0 ? cached.pe : local.pe,
        name: cached.name && cached.name !== 'Unknown' ? cached.name : (local.name ?? cached.name),
      };
      return { data: merged, error: null, isRealData: true, fromCache: true };
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

// ─── Earnings surprises (PEAD input) ──────────────────────────────────

/**
 * Compute an EPS surprise % from a quarterly actual-minus-estimate pair.
 * Yahoo's quarterly `surprise`/`surprisePercent` fields are frequently blank,
 * so the surprise is derived from actual and estimate, falling back to Yahoo's
 * own numbers when present.
 */
interface YahooEarningsRow {
  date?: unknown;
  actual?: { raw?: number } | number;
  estimate?: { raw?: number } | number;
}

function rowNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && typeof (value as { raw?: unknown }).raw === 'number') {
    return (value as { raw: number }).raw;
  }
  return null;
}

function computeSurprisePair(q: YahooEarningsRow): { actual: number | null; estimate: number | null; surprise: number | null; surprisePercent: number | null } {
  const actual = rowNumber(q.actual);
  const estimate = rowNumber(q.estimate);
  if (actual == null || estimate == null) {
    return { actual, estimate, surprise: null, surprisePercent: null };
  }
  const surprise = Math.round((actual - estimate) * 100) / 100;
  const surprisePercent = estimate !== 0 ? Math.round((surprise / Math.abs(estimate)) * 10_000) / 100 : null;
  return { actual, estimate, surprise, surprisePercent };
}

export interface EarningsSurpriseRow {
  period: string;
  date: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprisePercent: number | null;
}

/**
 * Fetch recent quarterly earnings actuals vs estimates for a symbol via the
 * Yahoo quoteSummary `earnings` module (allows `earningsHistory` for a deeper
 * panel). Returns rows ordered by quarter ascending. Null if the provider is
 * unreachable.
 */
export async function fetchEarningsSurprises(symbol: string): Promise<EarningsSurpriseRow[] | null> {
  const crumb = await getYahooCrumb();
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  for (const host of hosts) {
    try {
      // The quoteSummary `earnings` module is 401-protected and needs a crumb,
      // exactly like `summaryDetail`/`assetProfile`. Build it the same way.
      const url = `${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol.toUpperCase())}?modules=earnings&crumb=${encodeURIComponent(crumb ?? '')}`;
      const data = await fetchJson(url, 8000, { 'User-Agent': 'Mozilla/5.0' });
      const quarterly = data?.quoteSummary?.result?.[0]?.earnings?.earningsChart?.quarterly;
      if (!Array.isArray(quarterly) || quarterly.length === 0) continue;
      const rows: EarningsSurpriseRow[] = quarterly.map((q: YahooEarningsRow) => {
        const pair = computeSurprisePair(q);
        return {
          period: typeof q?.date === 'string' ? q.date : '',
          date: typeof q?.date === 'string' ? parseQuarterLabelToISO(q.date) : '',
          actual: pair.actual,
          estimate: pair.estimate,
          surprise: pair.surprise,
          surprisePercent: pair.surprisePercent,
        };
      });
      return rows;
    } catch { continue; }
  }
  return null;
}

const EARNINGS_CACHE_KEY = (symbol: string) => `pead::${symbol.toUpperCase()}`;
const EARNINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — quarterly actuals are stable between reports

interface FinnhubEarningsRow {
  symbol: string;
  quarter: number;
  year: number;
  actual: number;
  estimate: number;
  surprise: number;
  surprisePercent: number;
}

/**
 * Backup earnings-surprise source via the Finnhub server proxy (requires
 * FINNHUB_API_KEY env var). Finnhub reports fields directly, unlike Yahoo's
 * `{raw}` objects, so map them onto the shared EarningsSurpriseRow shape.
 */
export async function fetchFinnhubEarningsSurprises(symbol: string): Promise<EarningsSurpriseRow[] | null> {
  const upper = symbol.toUpperCase();
  const res = await fetch(`/api/finnhub/earnings-surprises?symbol=${encodeURIComponent(upper)}`);
  if (!res.ok) return null;
  const data: FinnhubEarningsRow[] | { error?: string } = await res.json().catch(() => null);
  if (!Array.isArray(data) || data.length === 0) return null;

  const rows: EarningsSurpriseRow[] = data
    .map((r) => {
      const period = `${r.quarter}Q${r.year}`;
      const surprise = Number.isFinite(r.surprise) ? Math.round(r.surprise * 100) / 100 : null;
      const surprisePercent = Number.isFinite(r.surprisePercent) ? Math.round(r.surprisePercent * 100) / 100 : null;
      return {
        period,
        date: parseQuarterLabelToISO(period),
        actual: Number.isFinite(r.actual) ? r.actual : null,
        estimate: Number.isFinite(r.estimate) ? r.estimate : null,
        surprise,
        surprisePercent,
      };
    })
    .filter((r) => r.actual !== null && r.estimate !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return rows.length > 0 ? rows : null;
}

/**
 * Cached earnings surprises for the PEAD page. Hits the local sql.js metadata
 * store first (24h TTL), then tries Yahoo Finance, then the Finnhub proxy as a
 * backup, caching whatever succeeds so /hedge-fund doesn't hammer providers.
 */
export async function getEarningsSurprises(symbol: string): Promise<EarningsSurpriseRow[] | null> {
  const cached = await getMeta(EARNINGS_CACHE_KEY(symbol), EARNINGS_CACHE_TTL_MS);
  if (Array.isArray(cached)) return cached as EarningsSurpriseRow[];

  let rows = await fetchEarningsSurprises(symbol);
  if (!rows || rows.length === 0) {
    rows = await fetchFinnhubEarningsSurprises(symbol);
  }

  if (rows && rows.length > 0) {
    await putMeta(EARNINGS_CACHE_KEY(symbol), rows);
  }
  return rows;
}

/** Convert a Yahoo quarter label like "1Q2024" into an ISO end-of-quarter date string. */
function parseQuarterLabelToISO(period: string): string {
  const qEnd: Record<number, string> = { 1: '-03-31', 2: '-06-30', 3: '-09-30', 4: '-12-31' };
  const m = /(?:(\d)[Qq]|Q[Qq]?(\d))\s*[-/]?\s*(20\d\d)/.exec(period.trim());
  const qNum = m ? Number(m[1] ?? m[2]) : NaN;
  const year = m ? Number(m[3]) : NaN;
  if (!Number.isFinite(qNum) || qNum < 1 || qNum > 4 || !Number.isFinite(year) || !qEnd[qNum]) return '';
  return `${year}${qEnd[qNum]}`;
}
