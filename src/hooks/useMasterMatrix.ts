// useMasterMatrix.ts — analyze an index universe (S&P 500 / NASDAQ-100 / all)
// plus user-added custom stocks with the 12 trading masters, rank into a
// "top 50", and record/accumulate daily snapshots into a persistent matrix
// (localStorage + SQLite + Supabase).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchStockQuote, fetchHistoricalData } from '@/lib/stockApi';
import { generateHistoricalData, popularStocks, Stock } from '@/lib/stockData';
import * as storage from '@/lib/storage';
import {
  analyzeStock,
  buildStockInput,
  filterStocksByUniverse,
  filterToSP500,
  rankByScore,
  StockMasterResult,
  summarizeMasterResult,
  UniverseId,
  MASTER_MATRIX_SIZE,
  MASTER_ORDER,
  Verdict,
} from '@/lib/masterAnalysis';
import { fetchStoredHistory, fetchStoredHistoryForSymbol } from '@/lib/supabaseHistory';

const MATRIX_KEY = 'stockpulse_master_matrix';
const CUSTOM_KEY = 'stockpulse_master_matrix_custom';

export const MASTER_MATRIX_STORAGE_KEY = MATRIX_KEY;

// ─── Persistent daily-matrix shapes ────────────────────────────────

export interface MatrixStockRow {
  price: number;
  changePercent: number;
  verdicts: Record<string, Verdict>; // masterId -> verdict
  buyCount: number;
  score: number;
}

export interface DailySnapshot {
  date: string;                 // YYYY-MM-DD
  capturedAt: string;           // ISO timestamp
  source: 'live' | 'supabase';  // where the snapshot's numbers came from
  stocks: Record<string, MatrixStockRow>; // keyed by symbol
}

interface MatrixStore {
  snapshots: DailySnapshot[];
}

// ─── Matrix load / save helpers ────────────────────────────────────

export function loadMatrix(): DailySnapshot[] {
  try {
    const raw = storage.getJson<MatrixStore>(MATRIX_KEY);
    if (raw && Array.isArray(raw.snapshots)) return raw.snapshots;
  } catch {
    /* ignore */
  }
  return [];
}

function saveMatrix(snapshots: DailySnapshot[]): void {
  const data: MatrixStore = { snapshots };
  try {
    storage.setJson(MATRIX_KEY, data);
  } catch (e) {
    console.warn('Failed to save master matrix:', e);
  }
}

function loadCustomSymbols(): string[] {
  try {
    const raw = storage.getJson<string[]>(CUSTOM_KEY);
    if (Array.isArray(raw)) return raw.filter(Boolean).map(s => s.toUpperCase());
  } catch {
    /* ignore */
  }
  return [];
}

function saveCustomSymbols(symbols: string[]): void {
  try {
    storage.setJson(CUSTOM_KEY, symbols);
  } catch (e) {
    console.warn('Failed to save custom symbols:', e);
  }
}

/**
 * Standalone backfill: compute a stock's 12-master analysis for each stored
 * historical day (last `maxDays` days, default a full year) and write those as
 * daily snapshots into the persisted matrix. Replaces any existing snapshots
 * within the backfilled date range for this symbol, keeping other dates intact.
 */
export async function backfillStockHistory(symbol: string, maxDays = 365): Promise<BackfillResult> {
  const sym = symbol.toUpperCase();
  const bars = await fetchStoredHistoryForSymbol(sym);
  if (bars.length < 10) {
    return {
      ok: false,
      error: `No usable stored history for ${sym} (found ${bars.length} bars).`,
      symbol: sym,
      daysBackfilled: 0,
      fromDate: null,
      toDate: null,
    };
  }

  const stock: Stock = popularStocks.find(s => s.symbol === sym) ?? makeCustomStock(sym);
  const startIndex = Math.max(0, bars.length - maxDays);
  const days: DailySnapshot[] = [];

  for (let i = startIndex; i < bars.length; i++) {
    const day = bars[i];
    const prev = bars[i - 1];
    const price = day.close;
    const prevClose = prev ? prev.close : price;
    const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    const input = buildStockInput(
      { ...stock, price, change: price - prevClose, volume: day.volume },
      bars.slice(0, i + 1)
    );
    const masters = analyzeStock(sym, input);
    const summary = summarizeMasterResult(sym, stock, price, changePercent, masters, { isSimulated: false });
    days.push({
      date: day.date,
      capturedAt: `${day.date}T00:00:00.000Z`,
      source: 'supabase',
      stocks: { [sym]: matrixRowFromResult(summary) },
    });
  }

  const existing = loadMatrix();
  const fromDate = days[0]?.date;
  const toDate = days[days.length - 1]?.date;
  const keep = fromDate && toDate
    ? existing.filter(s => s.date < fromDate || s.date > toDate)
    : existing;
  const next = [...keep, ...days].sort((a, b) => a.date.localeCompare(b.date));
  saveMatrix(next);

  return {
    ok: true,
    error: null,
    symbol: sym,
    daysBackfilled: days.length,
    fromDate,
    toDate,
  };
}

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// Build a placeholder Stock entry for a user-added symbol that isn't in the
// curated popularStocks list. Live quote fetch overwrites the real metadata.
function makeCustomStock(symbol: string): Stock {
  return {
    symbol,
    name: symbol.toUpperCase(),
    sector: 'Custom',
    price: 0,
    change: 0,
    changePercent: 0,
    volume: 0,
    marketCap: '',
    pe: 0,
    week52High: 0,
    week52Low: 0,
  };
}

export function isValidSymbol(symbol: string): boolean {
  return /^[A-Za-z][A-Za-z0-9.\-]{0,5}$/.test(symbol.trim());
}

// Convert a fully-analyzed stock result into a persisted matrix row.
function matrixRowFromResult(r: StockMasterResult): MatrixStockRow {
  const verdicts: Record<string, Verdict> = {};
  for (const m of r.analyses) verdicts[m.id] = m.verdict;
  return {
    price: r.price,
    changePercent: r.changePercent,
    verdicts,
    buyCount: r.buyCount,
    score: r.score,
  };
}

// ─── Hook state/result types ───────────────────────────────────────

export type VerdictFilter = 'all' | 'any-buy' | Verdict;
export type MasterDataSource = 'live' | 'supabase' | null;

export interface SupabaseSourceInfo {
  coveredSymbols: string[];
  totalBars: number;
  lastBarDate: string | null;
  error: string | null;
}

export interface BackfillResult {
  ok: boolean;
  error: string | null;
  symbol: string;
  daysBackfilled: number;
  fromDate: string | null;
  toDate: string | null;
}

export interface UseMasterMatrixResult {
  universe: Stock[];
  results: StockMasterResult[];      // analyzed + ranked, capped at top 50
  isLoading: boolean;
  progress: number;
  totalStocks: number;
  lastUpdated: Date | null;
  fromCache: boolean;
  search: string;
  setSearch: (s: string) => void;
  sectorFilter: string;
  setSectorFilter: (s: string) => void;
  verdictFilter: VerdictFilter;
  setVerdictFilter: (v: VerdictFilter) => void;
  universeId: UniverseId;
  setUniverseId: (u: UniverseId) => void;
  customSymbols: string[];
  addCustomSymbol: (symbol: string) => boolean;
  removeCustomSymbol: (symbol: string) => void;
  snapshots: DailySnapshot[];
  recordedToday: boolean;
  lastRecordedAt: string | null;
  runAnalysis: (force?: boolean) => Promise<void>;
  /** Build the matrix purely from history already stored in Supabase. */
  loadFromSupabase: () => Promise<void>;
  dataSource: MasterDataSource;
  supabaseInfo: SupabaseSourceInfo | null;
  recordToday: () => void;
  /** Compute a stock's 12-master analysis for every stored historical day and
   *  write those as historical daily snapshots (backfill the past year). */
  backfillHistory: (symbol: string, maxDays?: number) => Promise<BackfillResult>;
  masterLabels: { id: string; name: string }[];
  sectors: string[];
}

const masterNames: Record<string, string> = {
  'buffett-graham': 'Buffett/Graham',
  'peter-lynch': 'Lynch',
  'greenblatt': 'Greenblatt',
  'livermore': 'Livermore',
  'munger': 'Munger',
  'marks': 'Marks',
  'templeton': 'Templeton',
  'minervini': 'Minervini',
  'oneil': "O'Neil",
  'weinstein': 'Weinstein',
  'darvas': 'Darvas',
  'wyckoff': 'Wyckoff',
};

const CACHE_KEY = 'stockpulse_masters_top50';

interface StoredCache {
  entries: StockMasterResult[];
  computedAt: string;
}

export function useMasterMatrix(): UseMasterMatrixResult {
  const [universeId, setUniverseId] = useState<UniverseId>('sp500');
  const [customSymbols, setCustomSymbols] = useState<string[]>(() => loadCustomSymbols());

  // The working universe = selected index filter + all custom symbols.
  const universe = useMemo(() => {
    const base = filterStocksByUniverse(popularStocks, universeId);
    const known = new Set(base.map(s => s.symbol));
    const custom = customSymbols
      .filter(sym => !known.has(sym))
      .map(makeCustomStock);
    return [...base, ...custom];
  }, [universeId, customSymbols]);

  const [results, setResults] = useState<StockMasterResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [dataSource, setDataSource] = useState<MasterDataSource>(null);
  const [supabaseInfo, setSupabaseInfo] = useState<SupabaseSourceInfo | null>(null);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>(() => loadMatrix());
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');

  const addCustomSymbol = useCallback((symbol: string): boolean => {
    const sym = symbol.trim().toUpperCase();
    if (!isValidSymbol(sym)) return false;
    let added = false;
    setCustomSymbols(prev => {
      const existing = new Set(prev.map(s => s.toUpperCase()));
      if (existing.has(sym)) return prev;
      added = true;
      const next = [...prev, sym];
      saveCustomSymbols(next);
      return next;
    });
    return added;
  }, []);

  const removeCustomSymbol = useCallback((symbol: string) => {
    setCustomSymbols(prev => {
      const next = prev.filter(s => s.toUpperCase() !== symbol.toUpperCase());
      saveCustomSymbols(next);
      return next;
    });
  }, []);

  const runAnalysis = useCallback(async (force = false) => {
    if (!force) {
      const cached = loadFromCache();
      if (cached && cached.entries.length > 0) {
        setResults(cached.entries);
        setLastUpdated(new Date(cached.computedAt));
        setFromCache(true);
        setDataSource('live');
        setIsLoading(false);
        setProgress(universe.length);
        return;
      }
    }

    setIsLoading(true);
    setFromCache(false);
    setDataSource('live');
    setProgress(0);

    const analyzed: StockMasterResult[] = [];
    const batchSize = 2;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchDone = batch.map(stock => {
        // Best-effort live fetch; fall back to simulated generation on failure.
        return Promise.all([
          fetchStockQuote(stock.symbol).catch(() => ({ data: null as unknown, isRealData: false, fromCache: false, error: null })),
          fetchHistoricalData(stock.symbol).catch(() => ({ data: null as unknown, isRealData: false, fromCache: false, error: null })),
        ]).then(([quote, hist]) => {
          const price = quote?.data?.price ?? stock.price;
          const changePercent = quote?.data?.changePercent ?? stock.changePercent;
          const resolved = quote?.data
            ? { ...stock, ...quote.data }
            : stock;
          const histData = Array.isArray(hist?.data) && hist.data.length > 0
            ? hist.data
            : generateHistoricalData(price);
          const input = buildStockInput({ ...resolved, price }, histData);
          const masters = analyzeStock(stock.symbol, input);
          return summarizeMasterResult(stock.symbol, resolved, price, changePercent, masters, {
            isSimulated: !hist?.isRealData,
          });
        });
      });
      const done = await Promise.all(batchDone);
      analyzed.push(...done);
      setResults([...analyzed].slice(0, MASTER_MATRIX_SIZE));
      setProgress(Math.min(i + batchSize, universe.length));
      if (i + batchSize < universe.length) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }

    const ranked = [...analyzed].sort(rankByScore).slice(0, MASTER_MATRIX_SIZE);
    setResults(ranked);
    saveToCache(ranked);
    setLastUpdated(new Date());
    setIsLoading(false);
  }, [universe]);

  // Build the matrix from history already stored in Supabase (stock_price_history),
  // without live per-stock fetching. Runs the 12 masters on each stored bar series.
  const loadFromSupabase = useCallback(async () => {
    setIsLoading(true);
    setFromCache(false);
    setProgress(0);
    try {
      const stored = await fetchStoredHistory();
      setSupabaseInfo({
        coveredSymbols: stored.coveredSymbols,
        totalBars: stored.totalBars,
        lastBarDate: stored.lastBarDate,
        error: stored.error,
      });
      if (!stored.ok || stored.history.size === 0) {
        setResults([]);
        setDataSource(null);
        setIsLoading(false);
        return;
      }

      const inUniverse = new Set(universe.map(s => s.symbol.toUpperCase()));
      const analyzed: StockMasterResult[] = [];
      const symbols = stored.coveredSymbols.filter(s => inUniverse.has(s.toUpperCase()));
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const bars = stored.history.get(symbol);
        const curated = popularStocks.find(s => s.symbol === symbol);
        const stock: Stock = curated ?? makeCustomStock(symbol);
        if (!bars || bars.length === 0) continue;
        const latest = bars[bars.length - 1];
        const prev = bars[bars.length - 2];
        const price = latest.close;
        const prevClose = prev ? prev.close : price;
        const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
        const input = buildStockInput({ ...stock, price }, bars);
        const masters = analyzeStock(symbol, input);
        analyzed.push(
          summarizeMasterResult(symbol, stock, price, changePercent, masters, { isSimulated: false })
        );
        setProgress(i + 1);
      }

      const ranked = analyzed.sort(rankByScore).slice(0, MASTER_MATRIX_SIZE);
      setResults(ranked);
      setDataSource('supabase');
      setLastUpdated(new Date());
    } catch (e) {
      setSupabaseInfo({
        coveredSymbols: [],
        totalBars: 0,
        lastBarDate: null,
        error: e instanceof Error ? e.message : 'Failed to read Supabase history',
      });
      setResults([]);
      setDataSource(null);
    } finally {
      setIsLoading(false);
    }
  }, [universe]);

  // Backfill a stock's full history: run the 12 masters against the stored OHLCV
  // bars for each past day and record those days as historical snapshots.
  const backfillHistory = useCallback(async (symbol: string, maxDays = 365): Promise<BackfillResult> => {
    const result = await backfillStockHistory(symbol, maxDays);
    setSnapshots(loadMatrix());
    return result;
  }, []);

  useEffect(() => {
    // Re-run when the universe (index or custom symbols) changes.
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe]);

  const recordToday = useCallback(() => {
    setSnapshots(prev => {
      const date = todayStr();
      const now = new Date().toISOString();
      const stocks: Record<string, MatrixStockRow> = {};
      for (const r of results) {
        const verdicts: Record<string, Verdict> = {};
        for (const m of r.analyses) verdicts[m.id] = m.verdict;
        stocks[r.symbol] = {
          price: r.price,
          changePercent: r.changePercent,
          verdicts,
          buyCount: r.buyCount,
          score: r.score,
        };
      }
      const existing = prev.filter(s => s.date !== date);
      const snapshot: DailySnapshot = {
        date,
        capturedAt: now,
        source: dataSource === 'supabase' ? 'supabase' : 'live',
        stocks,
      };
      const next = [...existing, snapshot].sort((a, b) => a.date.localeCompare(b.date));
      saveMatrix(next);
      return next;
    });
  }, [results, dataSource]);

  const recordedToday = snapshots.some(s => s.date === todayStr());
  const lastRecordedAt = snapshots.length > 0
    ? snapshots[snapshots.length - 1].capturedAt
    : null;

  // Filtering & search (client-side)
  const filtered = results.filter(r => {
    if (search && !r.symbol.toLowerCase().includes(search.toLowerCase()) && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (sectorFilter !== 'all' && r.sector !== sectorFilter) return false;
    if (verdictFilter === 'any-buy' && r.buyCount === 0) return false;
    if (verdictFilter !== 'all' && verdictFilter !== 'any-buy') {
      const any = r.analyses.some(a => a.verdict === verdictFilter);
      if (!any) return false;
    }
    return true;
  });

  const sectors = Array.from(new Set(results.map(r => r.sector))).sort();

  return {
    universe,
    results: filtered,
    isLoading,
    progress,
    totalStocks: universe.length,
    lastUpdated,
    fromCache,
    search,
    setSearch,
    sectorFilter,
    setSectorFilter,
    verdictFilter,
    setVerdictFilter,
    universeId,
    setUniverseId,
    customSymbols,
    addCustomSymbol,
    removeCustomSymbol,
    snapshots,
    recordedToday,
    lastRecordedAt,
    runAnalysis,
    loadFromSupabase,
    dataSource,
    supabaseInfo,
    recordToday,
    backfillHistory,
    masterLabels: MASTER_ORDER.map(id => ({ id, name: masterNames[id] ?? id })),
    sectors,
  };
}

function loadFromCache(): { entries: StockMasterResult[]; computedAt: string } | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const stored: StoredCache = JSON.parse(raw);
    if (!stored.entries || stored.entries.length === 0) return null;
    return stored;
  } catch {
    return null;
  }
}

function saveToCache(entries: StockMasterResult[]): void {
  try {
    const data: StoredCache = { entries, computedAt: new Date().toISOString() };
    storage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save master top-50 cache:', e);
  }
}

// Kept for backward-compat with the old memo helper usage.
function useMemoSP500(stocks: Stock[]): Stock[] {
  return useMemo(() => filterToSP500(stocks), [stocks]);
}
