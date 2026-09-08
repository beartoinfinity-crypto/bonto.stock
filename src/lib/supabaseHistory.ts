// supabaseHistory.ts — reads stored OHLCV bar history from the current
// Supabase project (public.stock_historical) to generate the Master Matrix
// without needing a live network fetch per stock.
//
// The sync-stock-data edge function populates stock_historical with daily
// bars (symbol, date, open, high, low, close, volume) for the 80-symbol
// index universe (10y depth). The anon key can read it (RLS "publicly
// readable"), so the whole matrix can be rebuilt from this past data.
//
// Config resolution (secrets must never be baked into the committed dist
// bundle): runtime server config first (/api/sync-config — the Supabase
// project URL + anon key on Render), then VITE_ env vars for local dev.

import { StockData } from './stockData';

const HISTORY_TABLE = 'stock_historical';
const PAGE = 1000;

interface BarRow {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

interface RestConfig { url: string; anonKey: string; }

let restConfigPromise: Promise<RestConfig | null> | null = null;

function fetchRestConfig(): Promise<RestConfig | null> {
  if (!restConfigPromise) {
    restConfigPromise = (async () => {
      try {
        const res = await fetch('/api/sync-config');
        if (res.ok) {
          const cfg = await res.json();
          if (cfg.url && cfg.anonKey) return { url: cfg.url, anonKey: cfg.anonKey } as RestConfig;
        }
      } catch { /* cold start / not set — retry next call */ }
      restConfigPromise = null; // don't cache failures
      // Local dev fallback: VITE_ env vars (gitignored .env)
      const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
      const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
      return url && anonKey ? { url, anonKey } : null;
    })();
  }
  return restConfigPromise;
}

export interface StoredHistoryResult {
  ok: boolean;
  error: string | null;
  /** symbol -> sorted ascending daily bars */
  history: Map<string, StockData[]>;
  /** total bars fetched */
  totalBars: number;
  /** symbols that have enough bars to analyze */
  coveredSymbols: string[];
  /** most recent bar date across all symbols */
  lastBarDate: string | null;
  sim?: string;
}

export async function isSupabaseHistoryConfigured(): Promise<boolean> {
  return (await fetchRestConfig()) !== null;
}

/**
 * Fetch every row of stock_historical (paginated) and group by symbol into
 * ascending daily StockData[] arrays. Returns all symbols with a usable bar count.
 */
export async function fetchStoredHistory(minBars = 100): Promise<StoredHistoryResult> {
  const cfg = await fetchRestConfig();
  if (!cfg) {
    return {
      ok: false,
      error: 'Supabase not configured (set SUPABASE_URL / SUPABASE_ANON_KEY on Render, or VITE_SUPABASE_* in local .env)',
      history: new Map(),
      totalBars: 0,
      coveredSymbols: [],
      lastBarDate: null,
    };
  }

  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'Content-Type': 'application/json',
  };

  const bySymbol = new Map<string, BarRow[]>();
  let totalBars = 0;

  try {
    let offset = 0;
    for (;;) {
      const url = `${cfg.url}/rest/v1/${HISTORY_TABLE}?select=symbol,date,open,high,low,close,volume&order=symbol.asc,date.asc&limit=${PAGE}&offset=${offset}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        return {
          ok: false,
          error: `Supabase read failed: HTTP ${res.status}`,
          history: new Map(),
          totalBars,
          coveredSymbols: [],
          lastBarDate: null,
        };
      }
      const rows = (await res.json()) as BarRow[];
      if (!rows.length) break;

      for (const r of rows) {
        if (r.symbol == null) continue;
        if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
        bySymbol.get(r.symbol)!.push(r);
        totalBars++;
      }

      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Network error reading Supabase history',
      history: new Map(),
      totalBars,
      coveredSymbols: [],
      lastBarDate: null,
    };
  }

  const history = new Map<string, StockData[]>();
  const coveredSymbols: string[] = [];
  let lastBarDate: string | null = null;

  for (const [symbol, rows] of bySymbol) {
    // sort ascending by date for deterministic SMA/trend math
    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < minBars) continue;
    history.set(symbol, rows.map(r => ({
      date: r.date,
      open: r.open ?? 0,
      high: r.high ?? 0,
      low: r.low ?? 0,
      close: r.close ?? 0,
      volume: r.volume ?? 0,
    })));
    coveredSymbols.push(symbol);
    const symLast = rows[rows.length - 1].date;
    if (!lastBarDate || symLast > lastBarDate) lastBarDate = symLast;
  }

  coveredSymbols.sort();

  return {
    ok: history.size > 0,
    error: history.size > 0 ? null : 'No usable index-universe history found in Supabase',
    history,
    totalBars,
    coveredSymbols,
    lastBarDate,
  };
}

/**
 * Fetch the full stored OHLCV bar series for a single symbol (paginated),
 * sorted ascending by date. Returns [] when the symbol has no stored data.
 */
export async function fetchStoredHistoryForSymbol(symbol: string): Promise<StockData[]> {
  const cfg = await fetchRestConfig();
  if (!cfg) return [];
  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'Content-Type': 'application/json',
  };
  const bars: StockData[] = [];
  try {
    const sym = encodeURIComponent(symbol.toUpperCase());
    let offset = 0;
    for (;;) {
      const url = `${cfg.url}/rest/v1/${HISTORY_TABLE}?select=date,open,high,low,close,volume&symbol=eq.${sym}&order=date.asc&limit=${PAGE}&offset=${offset}`;
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const rows = (await res.json()) as BarRow[];
      if (!rows.length) break;
      bars.push(...rows.map(r => ({
        date: r.date,
        open: r.open ?? 0,
        high: r.high ?? 0,
        low: r.low ?? 0,
        close: r.close ?? 0,
        volume: r.volume ?? 0,
      })));
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  } catch {
    /* network failure -> empty series */
  }
  return bars;
}

