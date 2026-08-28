// useMasterMatrix.ts — fetch + analyze the S&P 500 universe with the 12
// trading masters, rank into a "top 50", and record/accumulate daily
// snapshots into a persistent matrix (localStorage + SQLite + Supabase).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchStockQuote, fetchHistoricalData } from '@/lib/stockApi';
import { generateHistoricalData, popularStocks, Stock } from '@/lib/stockData';
import * as storage from '@/lib/storage';
import {
  analyzeStock,
  buildStockInput,
  filterToSP500,
  rankByScore,
  StockMasterResult,
  summarizeMasterResult,
  MASTER_MATRIX_SIZE,
  MASTER_ORDER,
  Verdict,
} from '@/lib/masterAnalysis';
import { fetchStoredHistory } from '@/lib/supabaseHistory';

const MATRIX_KEY = 'stockpulse_master_matrix';

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
  stocks: Record<string, MatrixStockRow>; // keyed by symbol
}

interface MatrixStore {
  snapshots: DailySnapshot[];
}

// ─── Matrix load / save helpers ────────────────────────────────────

function loadMatrix(): DailySnapshot[] {
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

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
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
  snapshots: DailySnapshot[];
  recordedToday: boolean;
  lastRecordedAt: string | null;
  runAnalysis: (force?: boolean) => Promise<void>;
  /** Build the matrix purely from history already stored in Supabase. */
  loadFromSupabase: () => Promise<void>;
  dataSource: MasterDataSource;
  supabaseInfo: SupabaseSourceInfo | null;
  recordToday: () => void;
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
  const universe = useMemoSP500(popularStocks);

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
          const histData = Array.isArray(hist?.data) && hist.data.length > 0
            ? hist.data
            : generateHistoricalData(price);
          const input = buildStockInput({ ...stock, price }, histData);
          const masters = analyzeStock(stock.symbol, input);
          return summarizeMasterResult(stock.symbol, stock, price, changePercent, masters, {
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

      const analyzed: StockMasterResult[] = [];
      const symbols = stored.coveredSymbols;
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const bars = stored.history.get(symbol);
        const stock = popularStocks.find(s => s.symbol === symbol);
        if (!stock || !bars || bars.length === 0) continue;
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
  }, []);

  useEffect(() => {
    runAnalysis();
    // once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const snapshot: DailySnapshot = { date, capturedAt: now, stocks };
      const next = [...existing, snapshot].sort((a, b) => a.date.localeCompare(b.date));
      saveMatrix(next);
      return next;
    });
  }, [results]);

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
    snapshots,
    recordedToday,
    lastRecordedAt,
    runAnalysis,
    loadFromSupabase,
    dataSource,
    supabaseInfo,
    recordToday,
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

// Small hook to memoize the SP500-filtered universe.
function useMemoSP500(stocks: Stock[]): Stock[] {
  return useMemo(() => filterToSP500(stocks), [stocks]);
}
