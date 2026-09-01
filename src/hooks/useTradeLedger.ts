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

import { useCallback, useMemo, useState } from 'react';
import * as storage from '@/lib/storage';
import { calculateSMA, generateHistoricalData, popularStocks, Stock, StockData } from '@/lib/stockData';
import { fetchStockQuote, fetchHistoricalData } from '@/lib/stockApi';
import { runEngine, DEFAULT_PARAMS } from '@/lib/tacticalEngine';
import { runTradingAgents } from '@/lib/tradingAgents';
import { analyzeStock, buildStockInput, StockMasterResult, summarizeMasterResult } from '@/lib/masterAnalysis';
import {
  LEDGER_KEY,
  LedgerStore,
  PersonaDaySignals,
  PersonaId,
  SymbolSignal,
  createLedger,
  holdSignal,
  runDayForPerson,
  valueDecision,
  wealthDecision,
  contrarianDecision,
  momentumDecision,
  tacticalDecision,
  agentDecision,
} from '@/lib/tradeSimulator';

/** Symbols the heavy engines (Tactical/Agent) are allowed to evaluate per day. */
const HEAVY_TOPN = 8;

export function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

type MatrixRow = StockMasterResult;

function loadLedger(): LedgerStore {
  try {
    const raw = storage.getJson<LedgerStore>(LEDGER_KEY);
    if (raw && raw.accounts && raw.trades) return raw;
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

async function priceFor(symbol: string): Promise<number> {
  try {
    const q = await fetchStockQuote(symbol);
    if (q?.data?.price && q.data.price > 0) return q.data.price;
  } catch {
    /* ignore */
  }
  return 0;
}

async function trendUpFor(symbol: string): Promise<boolean> {
  try {
    const h = await fetchHistoricalData(symbol);
    const bars: StockData[] = Array.isArray(h?.data) && h.data.length > 0
      ? h.data
      : generateHistoricalData(100);
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

async function historyFor(stock: Stock): Promise<StockData[]> {
  try {
    const h = await fetchHistoricalData(stock.symbol);
    if (Array.isArray(h?.data) && h.data.length > 0) return h.data;
  } catch {
    /* ignore */
  }
  return generateHistoricalData(stock.price || 100);
}

/** Run a full simulation day across all personas. Returns the updated ledger. */
export async function simulateDay(ledger: LedgerStore, date = todayStr()): Promise<LedgerStore> {
  const rows = loadMatrixRows();
  const next = JSON.parse(JSON.stringify(ledger)) as LedgerStore;
  // clear lastRunDate on all accounts; we'll set per-person below
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
    universe.add(...held);
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

  // Apply each persona's day, persisting trades + account state.
  for (const day of days) {
    const { account, trades } = runDayForPerson(next.accounts[day.personaId], day);
    next.accounts[day.personaId] = account;
    next.trades.push(...trades);
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

  const lastRunDate = ledger?.lastRunDate ?? null;
  const ranToday = lastRunDate === todayStr();

  const load = useCallback(() => setLedger(loadLedger()), []);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const next = await simulateDay(loadLedger(), todayStr());
      setLedger(next);
    } finally {
      setRunning(false);
    }
  }, []);

  const reset = useCallback(() => {
    const fresh = createLedger();
    storage.setJson(LEDGER_KEY, fresh);
    setLedger(fresh);
  }, []);

  return useMemo(
    () => ({ ledger, running, ranToday, lastRunDate, load, run, reset }),
    [ledger, running, ranToday, lastRunDate, load, run, reset]
  );
}
