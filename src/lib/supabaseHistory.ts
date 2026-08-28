// supabaseHistory.ts — reads stored OHLCV bar history from the build-time
// Supabase project (public.stock_price_history) to generate the Master Matrix
// without needing a live network fetch per stock.
//
// The sync-stock-data edge function + local cron populate stock_price_history
// with daily bars (symbol, date, open, high, low, close, volume). The anon key
// in .env can read it (RLS "publicly readable"), so the whole matrix can be
// rebuilt from this past data.

import { StockData } from './stockData';
import { SUPABASE_STOCK_PROJECT_URL, SUPABASE_STOCK_ANON_KEY } from './supabaseConfig';

// Prefer committed public anon credentials (available in every build, incl.
// Render). Fall back to VITE_ env vars if the operator overrode them.
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_STOCK_PROJECT_URL;
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || SUPABASE_STOCK_ANON_KEY;

const HISTORY_TABLE = 'stock_price_history';
const PAGE = 1000;

interface StoredBarRow {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

export function isSupabaseHistoryConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Fetch every row of stock_price_history (paginated) and group by symbol into
 * ascending daily StockData[] arrays. Returns all symbols with a usable bar count.
 */
export async function fetchStoredHistory(minBars = 100): Promise<StoredHistoryResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      ok: false,
      error: 'Supabase not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)',
      history: new Map(),
      totalBars: 0,
      coveredSymbols: [],
      lastBarDate: null,
    };
  }

  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  const bySymbol = new Map<string, StoredBarRow[]>();
  let totalBars = 0;

  try {
    let offset = 0;
    for (;;) {
      const url = `${SUPABASE_URL}/rest/v1/${HISTORY_TABLE}?select=symbol,date,open,high,low,close,volume&order=symbol.asc,date.asc&limit=${PAGE}&offset=${offset}`;
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
      const rows = (await res.json()) as StoredBarRow[];
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
    error: history.size > 0 ? null : 'No usable S&P 500 history found in Supabase',
    history,
    totalBars,
    coveredSymbols,
    lastBarDate,
  };
}
