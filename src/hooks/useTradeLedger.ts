/**
 * useTradeLedger.ts — loads/persists the simulated trader ledger and runs the
 * daily simulation pass against real engine signals.
 *
 * The shared daily universe is derived from the Master Matrix's persisted top-50
 * cache (`stockpulse_masters_top50`), which already carries each symbol's 12-master
 * verdicts, buy/sell counts and score. Masters-based personas (Value / Wealth /
 * Contrarian) and Momentum consume those rows directly (no recompute). Tactical
 * and Agent run their own (heavier) engines on a bounded subset — the day's
 * top-Matrix symbols plus anything they already hold — to keep the pass cheap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as storage from '@/lib/storage';
import { calculateSMA, generateHistoricalData, popularStocks, Stock, StockData } from '@/lib/stockData';
import { fetchStockQuote, fetchHistoricalData } from '@/lib/stockApi';
import { runEngine, DEFAULT_PARAMS } from '@/lib/tacticalEngine';
import { runTradingAgents } from '@/lib/tradingAgents';
import { analyzeStock, buildStockInput, StockMasterResult, summarizeMasterResult, isIndexTrackedSymbol } from '@/lib/masterAnalysis';
import { fetchStoredHistoryForSymbol } from '@/lib/supabaseHistory';
import {
  LEDGER_KEY,
  LedgerStore,
  PersonaDaySignals,
  PersonaId,
  SymbolSignal,
  STARTING_CASH,
  createLedger,
  holdSignal,
  runDayForPerson,
  buildDecisionLog,
  valueDecision,
  wealthDecision,
  contrarianDecision,
  momentumDecision,
  tacticalDecision,
  agentDecision,
} from '@/lib/tradeSimulator';
import { overwriteLedger, pullLedger } from '@/lib/supabaseDb';
import { replayAccounts } from '@/lib/ledgerMerge';

/** Symbols the heavy engines (Tactical/Agent) are allowed to evaluate per day. */
const HEAVY_TOPN = 8;
/** Minimum bar count the tactical engine can meaningfully run on. */
const MIN_BARS = 30;

export function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

type MatrixRow = StockMasterResult;

function loadLedger(): LedgerStore {
  try {
    const raw = storage.getJson<LedgerStore>(LEDGER_KEY);
    if (raw && raw.accounts && raw.trades) {
      if (!raw.decisions) raw.decisions = [];
      if (!raw.prices) raw.prices = {};
      return raw;
    }
  } catch {
    /* ignore */
  }
  return createLedger();
}

function loadMatrixRows(): MatrixRow[] {
  try {
    const raw = storage.getItem('stockpulse_masters_top50');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
  } catch {
    /* ignore */
  }
  return [];
}

/** Real OHLCV bars stored in Supabase (`stock_price_history`, publicly readable).
 *  Used as the authoritative history when the live quote/history APIs are down —
 *  synthetic `generateHistoricalData` bars never carry tactical entry signals. */
async function storedHistoryFor(symbol: string): Promise<StockData[] | null> {
  try {
    const bars = await fetchStoredHistoryForSymbol(symbol);
    if (Array.isArray(bars) && bars.length >= MIN_BARS) return bars;
  } catch {
    /* ignore */
  }
  return null;
}

async function priceFor(symbol: string): Promise<number> {
  try {
    const q = await fetchStockQuote(symbol);
    if (q?.data?.price && q.data.price > 0) return q.data.price;
  } catch {
    /* ignore */
  }
  const stored = await storedHistoryFor(symbol);
  if (stored && stored.length) {
    const last = stored[stored.length - 1].close;
    if (last > 0) return last;
  }
  return 0;
}

async function trendUpFor(symbol: string): Promise<boolean> {
  try {
    const h = await fetchHistoricalData(symbol);
    const bars: StockData[] = Array.isArray(h?.data) && h.data.length > 0
      ? h.data
      : (await storedHistoryFor(symbol)) ?? generateHistoricalData(100);
    const sma20 = calculateSMA(bars, 20);
    const last = sma20[sma20.length - 1];
    const price = bars[bars.length - 1]?.close;
    if (last == null || !price) return false;
    return price > last;
  } catch {
    return false;
  }
}

async function stockFor(symbol: string, price: number): Promise<Stock> {
  const curated = popularStocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
  if (curated) return { ...curated, price: price || curated.price };
  return { symbol, name: symbol, sector: 'Custom', price: price || 0, change: 0, changePercent: 0, volume: 0, marketCap: '', pe: 0, week52High: 0, week52Low: 0 };
}

/** Resolve a symbol's daily bar series: live/cached API → stored Supabase
 *  history → synthetic. The tactical engine needs ≥ MIN_BARS real bars. */
async function historyFor(stock: Stock): Promise<StockData[]> {
  try {
    const h = await fetchHistoricalData(stock.symbol);
    if (Array.isArray(h?.data) && h.data.length > 0) return h.data;
  } catch {
    /* ignore */
  }
  const stored = await storedHistoryFor(stock.symbol);
  if (stored) return stored;
  return generateHistoricalData(stock.price || 100);
}

/**
 * Build the shared daily universe of analyzed rows.
 *
 * The shared universe is restricted to the two tracked index universes —
 * S&P 500 ∪ NASDAQ-100 (`isIndexTrackedSymbol`). Prefers the Master Matrix's
 * persisted top-50 cache (`stockpulse_masters_top50`, which carries each
 * symbol's 12-master verdicts/scores — no recompute); cached rows outside the
 * index universe are dropped. If that cache is empty (the Master Matrix page
 * hasn't been run in this browser yet), fall back to computing rows directly
 * from `popularStocks` (also filtered to the index universe) so the ledger
 * always has symbols to trade, independent of whether the Matrix page was ever
 * visited.
 */
async function buildUniverse(): Promise<MatrixRow[]> {
  const cached = loadMatrixRows();
  if (cached.length > 0) return cached.filter(r => isIndexTrackedSymbol(r.symbol));

  const rows: MatrixRow[] = [];
  const batchSize = 6;
  const universe = popularStocks.filter(s => isIndexTrackedSymbol(s.symbol));
  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const done = await Promise.all(batch.map(async stock => {
      try {
        const price = stock.price || 100;
        const hist = await historyFor(stock);
        const input = buildStockInput({ ...stock, price }, hist);
        const masters = analyzeStock(stock.symbol, input);
        return summarizeMasterResult(stock.symbol, stock, price, stock.changePercent ?? 0, masters, {
          isSimulated: true,
        });
      } catch {
        return null;
      }
    }));
    for (const r of done) if (r) rows.push(r);
  }
  return rows;
}

/**
 * Run a full simulation day across all personas. Returns the updated ledger.
 *
 * WRITE-PROTECTED: a day simulates at most once. If `date` is already the
 * ledger's `lastRunDate` the call is a no-op that returns the ledger unchanged
 * — re-running the same day with different (live) prices is what corrupted the
 * records. To re-run a day, clear it first with the hook's `reset` (Reset today).
 */
export async function simulateDay(ledger: LedgerStore, date = todayStr()): Promise<LedgerStore> {
  if (ledger.lastRunDate === date) return ledger;
  const rows = await buildUniverse();
  const next = JSON.parse(JSON.stringify(ledger)) as LedgerStore;
  const symbols = new Map<string, MatrixRow>();
  for (const r of rows) symbols.set(r.symbol.toUpperCase(), r);

  // Build the shared ranked universe (by score) plus anything currently held.
  const allSymbols = new Set<string>(symbols.keys());
  for (const p of Object.keys(next.accounts) as PersonaId[]) {
    for (const pos of next.accounts[p].positions) allSymbols.add(pos.symbol.toUpperCase());
  }
  const rankedList = [...symbols.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const heavySymbols = rankedList.slice(0, HEAVY_TOPN).map(r => r.symbol.toUpperCase());

  // Fetch day prices for the whole universe once (shared across personas).
  const prices: Record<string, number> = {};
  for (const sym of allSymbols) {
    const row = symbols.get(sym);
    if (row && row.price > 0) prices[sym] = row.price;
    else prices[sym] = await priceFor(sym);
  }

  const watch = (sym: string): SymbolSignal => {
    const row = symbols.get(sym);
    if (row) return holdSignal(row.symbol, prices[sym] ?? row.price, row.changePercent);
    return holdSignal(sym, prices[sym] ?? 0);
  };

  // Resolve the daily signal set for each persona.
  const days: PersonaDaySignals[] = [];
  for (const p of PERSONA_IDS) {
    const acct = next.accounts[p];
    const held = new Set(acct.positions.map(x => x.symbol.toUpperCase()));
    const universe = new Set<string>(allSymbols);
    // NOTE: `universe.add(undefined)` when held is empty would corrupt the set —
    // spreading into `.add()` with zero args adds `undefined`. Always guard.
    for (const s of held) universe.add(s);
    const symbolsHere = [...universe];

    const buySignals: SymbolSignal[] = [];
    const dayWatch: SymbolSignal[] = [];

    for (const sym of symbolsHere) {
      const row = symbols.get(sym);
      if (!row) { dayWatch.push(watch(sym)); continue; }
      const price = prices[sym] ?? row.price;

      if (p === 'tactical' || p === 'agent') {
        const isHeavy = heavySymbols.includes(sym) || held.has(sym);
        if (!isHeavy) { dayWatch.push(holdSignal(sym, price, row.changePercent)); continue; }
      }

      const sig = await decisionFor(p, sym, row, price);
      dayWatch.push(sig);
      if (sig.action === 'BUY') buySignals.push(sig);
    }

    days.push({ date, personaId: p, buySignals, watch: dayWatch });
  }

  // Apply each persona's day, persisting trades + account state, and record the
  // full decision log for that persona+date (accumulating across days, `decisions`
  // is keyed/runs by (personaId, date); we replace any prior entry for the same
  // day so a re-run doesn't duplicate, while older days are kept).
  for (const day of days) {
    const { account, trades } = runDayForPerson(next.accounts[day.personaId], day);
    next.accounts[day.personaId] = account;
    next.trades.push(...trades);

    const logEntry = buildDecisionLog(day);
    next.decisions = (next.decisions ?? []).filter(
      d => !(d.personaId === day.personaId && d.date === day.date)
    );
    next.decisions.push(logEntry);
  }
  next.lastRunDate = date;
  next.prices = prices;
  storage.setJson(LEDGER_KEY, next);
  return next;
}

async function decisionFor(
  persona: PersonaId,
  sym: string,
  row: MatrixRow,
  price: number,
): Promise<SymbolSignal> {
  const changePercent = row.changePercent ?? 0;
  switch (persona) {
    case 'value':
      return valueDecision({ symbol: row.symbol, price, changePercent, score: row.score, buyCount: row.buyCount, sellCount: row.analyses.filter(a => a.verdict === 'SELL' || a.verdict === 'AVOID').length });
    case 'wealth':
      return wealthDecision({ symbol: row.symbol, price, changePercent, score: row.score, buyCount: row.buyCount, sellCount: row.analyses.filter(a => a.verdict === 'SELL' || a.verdict === 'AVOID').length });
    case 'contrarian':
      return contrarianDecision({ symbol: row.symbol, price, changePercent, score: row.score, buyCount: row.buyCount, sellCount: row.analyses.filter(a => a.verdict === 'SELL' || a.verdict === 'AVOID').length });
    case 'momentum': {
      const trendUp = await trendUpFor(sym);
      return momentumDecision({ symbol: row.symbol, price, changePercent, score: row.score, buyCount: row.buyCount, sellCount: row.analyses.filter(a => a.verdict === 'SELL' || a.verdict === 'AVOID').length }, trendUp);
    }
    case 'tactical': {
      const stock = await stockFor(sym, price);
      const hist = await historyFor(stock);
      const eng = runEngine(hist, { ...DEFAULT_PARAMS, accountEquity: 100_000 });
      if (!eng) return holdSignal(sym, price, changePercent);
      const action = eng.blocked ? 'HOLD' as const : eng.entry.action === 'BUY' ? 'BUY' as const : (eng.exit ? 'SELL' as const : 'HOLD' as const);
      const sizeFraction = eng.sizing?.finalSize && price > 0 ? Math.min(1, (eng.sizing.finalSize * price) / 100_000) : undefined;
      return tacticalDecision({ symbol: sym, price, action, stopLoss: eng.entry.stopLoss, takeProfit: eng.entry.takeProfit, sizeFraction });
    }
    case 'agent': {
      const stock = await stockFor(sym, price);
      const hist = await historyFor(stock);
      // Only hold / exit decisions run the full agent pipeline on current
      // holdings; non-holdings may be passed a simplified + bounded rating from
      // the matrix. For correctness we run the pipeline, bounded by HEAVY_TOPN.
      try {
        const res = await runTradingAgents(sym, { price, previousClose: price, volume: 0, marketCap: 0, historical: hist }, stock);
        return agentDecision({ symbol: sym, price: res.price || price, rating: res.final.rating, conviction: res.final.conviction });
      } catch {
        return holdSignal(sym, price, changePercent);
      }
    }
  }
}

const PERSONA_IDS: PersonaId[] = ['value', 'wealth', 'contrarian', 'momentum', 'tactical', 'agent'];

export function useTradeLedger() {
  const [ledger, setLedger] = useState<LedgerStore>(() => loadLedger());
  const [running, setRunning] = useState(false);
  const inFlightRef = useRef(false);

  const lastRunDate = ledger?.lastRunDate ?? null;
  const ranToday = lastRunDate === todayStr();

  const load = useCallback(() => setLedger(loadLedger()), []);

  // Reload after a cloud boot hydration (`pullAll`) merges other machines'
  // ledger days into localStorage — keeps multi-machine time line fresh.
  useEffect(() => {
    const onSync = () => load();
    window.addEventListener('stockpulse-sync', onSync);
    return () => window.removeEventListener('stockpulse-sync', onSync);
  }, [load]);

  // Run path shared by the manual button and the /ledger auto-run. Pulls the
  // CLOUD ledger first (lossless merge) so the day-once decision is made
  // against every machine's state, then simulates only if today has not run
  // anywhere yet (simulateDay itself is that write-protect). Returns true when
  // a fresh day was simulated, false when it was already run / skipped.
  const runOnceToday = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setRunning(true);
    try {
      const fresh = (await pullLedger()) ?? loadLedger();
      setLedger(fresh);
      if (fresh.lastRunDate === todayStr()) return false;
      const next = await simulateDay(fresh, todayStr());
      setLedger(next);
      return true;
    } catch {
      return false;
    } finally {
      inFlightRef.current = false;
      setRunning(false);
    }
  }, []);

  // Clear today's simulation so the day may run again (once). Keeps all earlier
  // history; accounts are rebuilt by replaying the remaining fills; the cloud
  // row is overwritten (not union-merged) so the cleared state wins there too.
  const reset = useCallback((): void => {
    const today = todayStr();
    const current = loadLedger();
    const trades = (current.trades ?? []).filter(t => t.date !== today);
    const decisions = (current.decisions ?? []).filter(d => d.date !== today);
    const accounts = replayAccounts(trades, current.initialCash ?? STARTING_CASH);
    const dates = trades.map(t => t.date).sort();
    const next: LedgerStore = {
      ...current,
      trades,
      decisions,
      accounts,
      lastRunDate: dates.length ? dates[dates.length - 1] : null,
    };
    storage.setJson(LEDGER_KEY, next);
    setLedger(next);
    void overwriteLedger(next);
  }, []);

  // Replace local ledger entirely with the Supabase copy — use after reset
  // when the user wants to discard local state and re-sync from the cloud.
  const syncFromCloud = useCallback(async (): Promise<boolean> => {
    setRunning(true);
    try {
      const cloud = await pullLedger();
      if (!cloud) return false;
      storage.setJson(LEDGER_KEY, cloud);
      setLedger(cloud);
      return true;
    } catch {
      return false;
    } finally {
      setRunning(false);
    }
  }, []);

  return useMemo(
    () => ({ ledger, running, ranToday, lastRunDate, load, run: runOnceToday, runOnceToday, reset, syncFromCloud }),
    [ledger, running, ranToday, lastRunDate, load, runOnceToday, reset, syncFromCloud]
  );
}
